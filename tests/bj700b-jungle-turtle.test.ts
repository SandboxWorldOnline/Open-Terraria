// ★BJ700b（2026-10-20）丛林龟 617（同族 616 Turtle / 625 SeaTurtle）「跳起来旋转后的
// 行动状态」判别锁。
//
// 定谳（Terarria1457 亲读,NPC.cs FindFrame case 616/617 :77486-77530 / case 625
// :77532-77578 + SetDefaults :16936-16948/:17070-17080 + Main.cs :91626 调用时点
// ——FindFrame 在 UpdateCollision【后】跑,读碰撞末态 vx/vy/wet）:
//  · 干走带 0..7（num195=8 → 每 9t 进帧,>num*7 回卷 0）;站定（vx==0）清 counter 钉帧 0;
//    腾空（vy≠0）清 counter 钉帧 8（=蜷壳旋跳帧行）——625【无】腾空钉。
//  · ★落地节拍:腾空每拍清零 → 落地拍 counter 从 0 起步 → 帧 8 先保持 8 拍
//    （L..L+7）,L+8 拍进帧 8+1=9 → 回卷门 >num*7 → 帧 0,再 9 拍进 1。
//    即「跳起旋转落地 → 蜷壳定拍 → 出壳帧 0 → 起步」——旧实现（Renderer
//    Math.floor(t/9)%8 全局相位）落地即跳任意中幅帧 = 用户实报「旋转后的行动状态
//    也不对」的帧机面。
//  · 湿泳带 8..13（num196=5 走/10 停 → 6t/11t 一帧,>num*13 回 num*8）;616/617 入水
//    无带切换（帧号续走,原版 quirk）;625 湿带 6..11（num187=4 走/8 停 → 5t/9t）+
//    入水 <num*6 抬 6 / 出水 >num*5 回 0 双向带切换。
//  · 行为机（AI_007 critter 支）全链对勘=平价:速度表/跳档三档/跳点回位/家域约束/
//    危险扫描豁免(flag8)/水面钉(flag12)/受击链——探针（受控轨道 9 面 + 真丛林长跑）
//    逐拍取证在案,本文件只锁帧机（行为面平价结论与「双侧堵死槽内每拍掉头=原版同
//    槽 quirk」的判语见 docs/debts 与记忆 bj700b-jungle-turtle.md）。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { vanillaFrameIdx } from '../src/render/Renderer';

const ROOT = join(__dirname, '..');
const NPC_1457 = join(ROOT, '../Terarria1457/Terraria/NPC.cs');
const EXT_MISSING = !existsSync(NPC_1457);
const npc1457 = EXT_MISSING ? '' : readFileSync(NPC_1457, 'utf8');
const enemySrc = readFileSync(join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
const rendererSrc = readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8');

// ---------------------------------------------------------------------------
// 夹具（critter-ai.test.ts 同款:80×140 世界,60 行地板 10..70 列,可选注水）
// ---------------------------------------------------------------------------
function critterWorld(water = false) {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);
  if (water) {
    // 35..45 列 58..59 行注水（2 深,池底=60 行地板;水面 58*16）
    for (let x = 35; x <= 45; x++) for (let y = 58; y <= 59; y++) st.setLiquid(x, y, 255, 1);
  }
  const hooks = {
    world: w,
    player: null,
    playSfx: () => {}, addDamageNumber: () => {}, spawnParticles: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0,
    entities: { add: () => {} },
    enemies: () => [] as unknown[],
  } as never;
  return { w, hooks };
}

/** 生成 + 定态:落稳地板,强制走态(ai0=1,计时拉满)朝 facing */
function spawnWalker(vid: number, hooks: never, facing = 1, vx = 0.5) {
  const e = Enemy.fromVanilla(vid, 40 * 16, 58 * 16)!;
  for (let t = 0; t < 30; t++) e.fixedUpdate(1 / 60, hooks);   // 落稳
  e.ai0 = 1; e.ai1 = 999999; e.ai2 = 0; e.lai3 = -1;
  e.facing = facing; e.vx = facing * vx; e.vy = 0;
  e.critterHomeX = 40;
  return e;
}

/** 采样 turtleFrame 序列 n 拍 */
function sampleFrames(e: Enemy, hooks: never, n: number): number[] {
  const out: number[] = [];
  for (let t = 0; t < n; t++) {
    e.fixedUpdate(1 / 60, hooks);
    out.push(e.turtleFrame);
  }
  return out;
}

/** 等长游程:每个 distinct 值的连续拍数 */
function runLengths(seq: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let cur = seq[0], n = 0;
  for (const v of seq) {
    if (v === cur) n++;
    else { out.push([cur, n]); cur = v; n = 1; }
  }
  out.push([cur, n]);
  return out;
}

// ---------------------------------------------------------------------------
// A. 原版活体锚（1457 直读,漂移即爆红）
// ---------------------------------------------------------------------------
function caseBody(startMark: string, endMark: string): string {
  const s = npc1457.indexOf(startMark);
  if (s < 0) return '';
  const e = npc1457.indexOf(endMark, s);
  return npc1457.slice(s, e < 0 ? s + 3000 : e);
}
const case616 = caseBody('case 616:', 'case 625:');
const case625 = caseBody('case 625:', 'case 626:');

describe.skipIf(EXT_MISSING)('BJ700b 原版锚:FindFrame case 616/625 帧机常量', () => {
  it('616/617:阈值 8/5(停 10),干带回卷 >num*7,湿带回卷 >num*13→num*8,腾空钉 num*8', () => {
    expect(case616).toMatch(/int num195 = 8;\s*int num196 = 5;/);
    expect(case616).toMatch(/if \(velocity\.X == 0f\)\s*\{\s*num196 = 10;/);
    expect(case616).toMatch(/if \(frame\.Y > num \* 13\)\s*\{\s*frame\.Y = num \* 8;/);
    expect(case616).toMatch(/if \(frame\.Y > num \* 7\)\s*\{\s*frame\.Y = 0;/);
    expect(case616).toMatch(/if \(velocity\.Y != 0f\)\s*\{\s*frameCounter = 0\.0;\s*frame\.Y = num \* 8;/);
    // 湿支先 break(腾空/站定钉不跑)= 湿中恒泳带
    expect(case616.indexOf('if (wet)')).toBeLessThan(case616.indexOf('if (velocity.Y != 0f)'));
  });
  it('625:阈值 7/4(停 8),干带 0..5,湿带 6..11,入水 <num*6 抬 6,出水 >num*5 回 0,【无】腾空钉', () => {
    expect(case625).toMatch(/int num186 = 7;\s*int num187 = 4;/);
    expect(case625).toMatch(/if \(velocity\.X == 0f\)\s*\{\s*num187 = 8;/);
    expect(case625).toMatch(/if \(frame\.Y < num \* 6\)\s*\{\s*frame\.Y = num \* 6;/);
    expect(case625).toMatch(/if \(frame\.Y > num \* 11\)\s*\{\s*frame\.Y = num \* 6;/);
    expect(case625).toMatch(/if \(frame\.Y > num \* 5\)\s*\{\s*frame\.Y = 0;/);
    expect(case625).not.toMatch(/velocity\.Y != 0f/);   // 625 无腾空钉
  });
});

// ---------------------------------------------------------------------------
// B. 行为面:干走/停走重启/腾空钉/落地蜷壳定拍
// ---------------------------------------------------------------------------
describe('BJ700b 龟族帧机(Enemy turtleFrame 计数器)', () => {
  it('617 干走:9t/帧,带 0..7 升序回卷', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(617, hooks);
    const seq = sampleFrames(e, hooks, 90);
    const rl = runLengths(seq);
    // 首尾游程被采样窗截断,只验中段完整游程
    const mid = rl.slice(1, -1);
    expect(mid.length).toBeGreaterThanOrEqual(5);
    for (const [, n] of mid) expect(n).toBe(9);
    const vals = rl.map((r) => r[0]);
    for (let i = 1; i < vals.length; i++) expect((vals[i] - vals[i - 1] + 8) % 8).toBe(1);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThanOrEqual(7);
  });

  it('617 站定:钉帧 0 + 计数器清零;复走从帧 0 重启(旧全局相位=落地/停走后续走旧相位)', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(617, hooks);
    sampleFrames(e, hooks, 40);                       // 走一段(相位任意)
    e.ai0 = 0; e.ai1 = 600;                            // 站立态(±0.1 刹车)
    let stopped = -1;
    for (let t = 0; t < 60; t++) {
      e.fixedUpdate(1 / 60, hooks);
      if (e.vx === 0 && stopped < 0) stopped = t;
    }
    expect(stopped).toBeGreaterThanOrEqual(0);
    expect(e.turtleFrame).toBe(0);
    expect(e.turtleFrameT).toBe(0);
    // 复走:首 8 采样恒帧 0(连同末站定拍共 9 拍),第 9 采样进 1(周期重启,
    // 非全局相位续走——旧实现此处跳任意中幅帧)
    e.ai0 = 1; e.ai1 = 999999; e.facing = 1; e.vx = 0.5; e.lai3 = -1;
    const seq = sampleFrames(e, hooks, 20);
    for (let i = 0; i < 8; i++) expect(seq[i]).toBe(0);
    expect(seq[8]).toBe(1);
  });

  it('★617 跳旋→落地:腾空全程帧 8;落地后帧 8 保持 8 拍(L..L+7),L+8 拍回 0,再 9 拍进 1', () => {
    const { w, hooks } = critterWorld();
    for (let y = 58; y <= 59; y++) w.store.setTileSilent(45, y, 2);   // 2 格墙 → 跳档 −5×1.2
    const e = spawnWalker(617, hooks);
    const log: Array<{ fr: number; vy: number; gr: boolean }> = [];
    let jumped = false, landedAt = -1;
    for (let t = 0; t < 400; t++) {
      e.fixedUpdate(1 / 60, hooks);
      log.push({ fr: e.turtleFrame, vy: e.vy, gr: e.onGround });
      if (!jumped && e.vy < -1) jumped = true;
      if (jumped && e.onGround && e.vy === 0 && landedAt < 0) landedAt = log.length - 1;
      if (landedAt >= 0 && log.length > landedAt + 25) break;
    }
    expect(jumped).toBe(true);
    expect(landedAt).toBeGreaterThanOrEqual(0);
    // 腾空段(起跳拍..落地拍)全帧 8
    const jumpAt = log.findIndex((k) => k.vy < -1);
    for (let i = jumpAt; i <= landedAt; i++) expect(log[i].fr).toBe(8);
    // 落地蜷壳定拍:L..L+7 帧 8,L+8 帧 0(回卷),L+8..L+16 帧 0,L+17 帧 1
    for (let i = landedAt; i <= landedAt + 7; i++) expect(log[i].fr).toBe(8);
    expect(log[landedAt + 8].fr).toBe(0);
    for (let i = landedAt + 8; i <= landedAt + 16; i++) expect(log[i].fr).toBe(0);
    expect(log[landedAt + 17].fr).toBe(1);
  });

  it('617 湿泳:走 6t/帧;停 11t/帧;带内 8..13 回卷(入水帧号续走 quirk)', () => {
    // 宽池(35..55 列)防采样窗内出岸
    const w = new World(80, 140, 42, 'open');
    w.groundLevel = 42;
    const st = w.store;
    for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);
    for (let x = 35; x <= 55; x++) for (let y = 58; y <= 59; y++) st.setLiquid(x, y, 255, 1);
    const hooks = { world: w, player: null, playSfx: () => {}, addDamageNumber: () => {}, spawnParticles: () => {}, spawnDrop: () => null, damagePlayer: (): number => 0, entities: { add: () => {} }, enemies: () => [] } as never;
    const e = Enemy.fromVanilla(617, 33 * 16, 58 * 16)!;
    for (let t = 0; t < 30; t++) e.fixedUpdate(1 / 60, hooks);   // 落稳池左岸
    e.ai0 = 1; e.ai1 = 999999; e.lai3 = -1; e.facing = 1; e.vx = 0.5; e.critterHomeX = 45;
    // 走入水 → 湿;帧号续走 quirk 至 >13 首次回卷入泳带后开始采样
    let wetAt = -1, banded = false;
    for (let t = 0; t < 600 && !banded; t++) {
      e.fixedUpdate(1 / 60, hooks);
      if (e.wet && wetAt < 0) wetAt = t;
      if (wetAt >= 0 && e.turtleFrame >= 8 && e.turtleFrame <= 13) banded = true;
    }
    expect(wetAt).toBeGreaterThanOrEqual(0);
    expect(banded).toBe(true);                          // 入水帧号续走(≤7)→13→回卷 8
    expect(e.wet).toBe(true);
    expect(e.vx).toBeGreaterThan(0);                    // 湿速 2 档在走
    const seq: number[] = [];
    for (let t = 0; t < 60; t++) {
      e.fixedUpdate(1 / 60, hooks);
      seq.push(e.turtleFrame);
    }
    expect(Math.max(...seq)).toBeLessThanOrEqual(13);
    expect(Math.min(...seq)).toBeGreaterThanOrEqual(8);   // 稳态全程泳带内
    const rl = runLengths(seq);
    expect(rl.slice(1, -1).some(([v, n]) => v >= 8 && v <= 12 && n === 6)).toBe(true);
    // 停走(站立刹车)→ 11t/帧
    e.ai0 = 0; e.ai1 = 600;
    for (let t = 0; t < 40; t++) e.fixedUpdate(1 / 60, hooks);   // 刹车至 vx=0
    expect(e.vx).toBe(0);
    const still: number[] = [];
    for (let t = 0; t < 34; t++) {
      e.fixedUpdate(1 / 60, hooks);
      still.push(e.turtleFrame);
    }
    const srl = runLengths(still);
    expect(srl.slice(1, -1).some(([, n]) => n === 11)).toBe(true);
  });

  it('625:干走 8t/帧带 0..5;腾空【无】钉(帧续走);入水 <6 抬 6 / 出水 >5 回 0', () => {
    const { w, hooks } = critterWorld();
    const e = spawnWalker(625, hooks, 1, 0.2);          // 625 干速帽 0.2
    const seq = sampleFrames(e, hooks, 60);
    const rl = runLengths(seq);
    expect(rl.slice(1, -1).every(([, n]) => n === 8)).toBe(true);
    expect(Math.max(...seq)).toBeLessThanOrEqual(5);
    // 腾空无钉:2 格墙跳起,空中帧仍在 0..5 且变化(非恒 8)
    for (let y = 58; y <= 59; y++) w.store.setTileSilent(45, y, 2);
    const e2 = spawnWalker(625, hooks, 1, 0.2);
    const air: number[] = [];
    let jumped = false, done = false;
    for (let t = 0; t < 2000 && !done; t++) {
      e2.fixedUpdate(1 / 60, hooks);
      if (e2.vy < -1) jumped = true;
      if (jumped) {
        if (e2.onGround && e2.vy === 0 && air.length > 10) done = true;
        else air.push(e2.turtleFrame);
      }
    }
    expect(jumped).toBe(true);
    expect(air.length).toBeGreaterThan(12);
    expect(new Set(air).size).toBeGreaterThan(1);       // 帧在续走(625 无腾空钉)
    expect(Math.max(...air)).toBeLessThanOrEqual(5);
    // 入水抬带:干帧 <6 入水 → 首湿拍帧 ≥6(抬 6;同拍计数器可再进 1 → 7,原版同序)
    const { hooks: wh } = critterWorld(true);
    const e3 = Enemy.fromVanilla(625, 33 * 16, 58 * 16)!;
    for (let t = 0; t < 30; t++) e3.fixedUpdate(1 / 60, wh);
    e3.ai0 = 1; e3.ai1 = 999999; e3.lai3 = -1; e3.facing = 1; e3.vx = 0.2; e3.critterHomeX = 40;
    let snapAt = -1;
    for (let t = 0; t < 600 && snapAt < 0; t++) {
      const before = e3.turtleFrame;
      e3.fixedUpdate(1 / 60, wh);
      if (e3.wet && before < 6) {
        snapAt = t;
        expect(e3.turtleFrame).toBeGreaterThanOrEqual(6);
        expect(e3.turtleFrame).toBeLessThanOrEqual(7);
      }
    }
    expect(snapAt).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// C. 渲染消费 + 结构锁
// ---------------------------------------------------------------------------
describe('BJ700b 渲染消费与结构锁', () => {
  it('vanillaFrameIdx(616/617/625) 直读 e.turtleFrame(带 frames 钳)', () => {
    const { hooks } = critterWorld();
    const e = Enemy.fromVanilla(617, 40 * 16, 58 * 16)!;
    e.fixedUpdate(1 / 60, hooks);
    e.turtleFrame = 11;
    expect(vanillaFrameIdx(e, 14)).toBe(11);
    e.turtleFrame = 20;
    expect(vanillaFrameIdx(e, 14)).toBe(13);            // 钳 frames-1
    const e2 = Enemy.fromVanilla(625, 40 * 16, 58 * 16)!;
    e2.fixedUpdate(1 / 60, hooks);
    e2.turtleFrame = 9;
    expect(vanillaFrameIdx(e2, 12)).toBe(9);
  });

  it('结构锁:Enemy 计数器维护(findFrameRotation 层,读碰撞末态)+ Renderer 直读', () => {
    // Enemy:固定 Update 尾 FindFrame 层维护(三带常量 + 双钉 + 625 带切换)
    expect(enemySrc).toMatch(/private turtleFindFrameStep/);
    expect(enemySrc).toMatch(/turtleFrameT > wetStep/);
    expect(enemySrc).toMatch(/if \(!sea && this\.vy !== 0\) \{ this\.turtleFrameT = 0; this\.turtleFrame = 8; \}/);
    expect(enemySrc).toMatch(/if \(sea && this\.turtleFrame < wetBase\) this\.turtleFrame = wetBase;/);
    expect(enemySrc).toMatch(/if \(sea && this\.turtleFrame > wrap\) this\.turtleFrame = 0;/);
    // Renderer:616/617/625 支直读计数器(旧全局相位 Math.floor(t/9) 退役)
    const r616 = rendererSrc.slice(
      rendererSrc.indexOf('id === 616 || id === 617', rendererSrc.indexOf('vanillaFrameIdx')),
      rendererSrc.indexOf('case 625', rendererSrc.indexOf('vanillaFrameIdx')) + 400,
    );
    expect(r616).toMatch(/e\.turtleFrame/);
    expect(r616).not.toMatch(/Math\.floor\(t \/ 9\)/);
  });
});
