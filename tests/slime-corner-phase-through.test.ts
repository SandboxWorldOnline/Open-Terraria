// SW-BJ9 2026-09-07 史莱姆坡角嵌固漂移穿墙——产品决策硬化守卫（**刻意偏离原版**）。
// 谱系：SW-BJ6 定谳穿墙通道=AI_001 嵌固回退漂移（NPC.cs:62139/:62331
// `position.X -= velocity.X + direction`，门 collideY+oldVelocity.Y≠0+SolidCollision）
// + SolidCollision(:2713) 坡格整块盒语义 + TileCollision 已重叠体忽略(:2440)
// = 原版本体在「地坡高端邻实心柱」几何下匀速相移穿越墙带（1px/t，流浪汉舌
// (1825,317) s1 坡角实录 t=188-211）。BJ6 批本文件钉的是「原版忠实穿越」语义；
// **SW-BJ9 产品拍板「避免穿墙，哪怕偏离原版」——语义翻转重钉为「不穿越」**：
// 漂移步应用前测「漂移后位盒全实心重叠」（Enemy.applyUnwedgeDrift + fullSolidBoxOverlap，
// 激活感知谓词；命中 → 本拍取消 + episode 终止闩 unwedgeBlocked，防逐拍磨墙；
// 只与坡格重叠 → 照常漂移，原版退坡楔保留）。偏离声明正本在 applyUnwedgeDrift 方法注。
// 本文件锁：
//   A. 门开启（现役行为）：合成坡角（1:1 复刻实录窗）两体型×6rep，实录「柱嘴内」
//      姿态全程【不穿越】+ 洁净后保持不进全实心格（sticky-clean；允许坡区漂移/
//      unembed ≤1 格推回坡侧）+ episode 闩最终置位（门确被行使）；
//   B. 反证（判别力）：原型补丁关断 unwedgeGateBlocksFullSolid → 同夹具复现原版
//      穿越（决定性翻转实验：穿越/不穿越唯一差异=本门）；
//   C. 致动器安全：门谓词激活感知（致动态 tile 不判全实心 → 闩不置位、本体自由
//      穿过致动区=致动功能不受门影响）+ episode 期间闩置位后 AI 不冻结（跳跃机
//      照常点火）、离楔后闩复位（episode 锚清位）；
//   D. K2 站顶单元（BJ6 原件，坡面贴合语义不受 BJ9 触碰的守卫）；
//   E. 结构锁（门只在 AI_001 漂移分支内；TileCollision 消费侧零触碰）；
//   F. 真实存档重放（wanderer-tongue-map.json 收编档，缺失时整组 skip）：
//      实录姿态两体型不穿越 + 门关闭复现穿越。
// ★夹具瞬态备案：柱嘴内 spawn 的 t=0 存在 BJ6 时代 K2 站顶 snap 瞬态（−12px 重锚，
//  门开/关两 run 逐字节相同=非漂移路径，BJ9 零触碰）——故「前缘不进全实心」采用
//  sticky-clean 不变式（首次洁净后不得再侵入），而非全程洁净。
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readLocalFixtureText, localFixtureMissing } from './fixturePath';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { moveAndCollide, type Body } from '../src/physics/TileCollision';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';
import type { TileStore } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';

// ★SW-BN6 2026-09-08 电池族 RNG 统一播种（范式=seeded-rng.ts,推广自 slime-item-ladder-parity）:
// 6× 重复/出生点扫描族（:153 describe）依赖 AI 掷流稳定,播种后 rep 间序列可控。
// 真实存档重放（beforeAll loadSave）在用例流之前,不受 beforeEach 影响（存档本身确定性）。
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

const DIRT = TILE_BY_KEY['dirt']!;
const GRASS = TILE_BY_KEY['grass']!;
const SAVE_PATH = 'wanderer-tongue-map.json';   // ★C档收编:原 ~/Downloads/map-流浪汉舌.json

/**
 * 合成复刻流浪汉舌坡角（tile 坐标,行号对应实景观测）：
 *   x=19 列: r28,r29 实心（=(1823,315)/(1823,316)）; r30 slope4; r31+ 空（凹龛侧）
 *   x=20 列: r28..r31 实心（=(1824,315..318) 台阶柱=穿墙体）
 *   x=21 列: r28,r29 空（=(1825,315)/(1825,316) 壁龛）; r30 slope1（=(1825,317)）;
 *            r31,r32 实心（=(1825,318)/(1825,319)）
 *   x=22 列: r31 slope1（=(1826,318)）; x=23..30: r32 实心（大洞穴地面）
 */
// ★夹具行基线 140：applyGravity 高空衰减档（NPC.cs:91916-91934）在浅行把重力压到
//  0.075 → 贴合走 snap-down 支（不置 collideY）→ 嵌固回退漂移门永不点火;真实地形
//  （流浪汉舌 y≈317,全重力 0.3）必须以深行复刻,夹具才与实录同物理域。
const R = 140;
function buildCorner(w: World): void {
  const st = w.store;
  // 台阶柱 x=20 r(R-10)..(R+1)（高柱=跳跃不可越,复刻实体带柱顶无净空不可站形态）
  for (let r = R - 10; r <= R + 1; r++) st.setTile(20, r, GRASS);
  // 凹龛侧 x=19: (R-2),(R-1) 实心（=(1823,315)/(1823,316)）; R slope4; R+1+ 空
  st.setTile(19, R - 2, GRASS); st.setTile(19, R - 1, GRASS);
  // x=21: R+1,R+2 实心（=(1825,318)/(1825,319)）; R-2,R-1 空（壁龛=(1825,315/316)）
  st.setTile(21, R + 1, GRASS); st.setTile(21, R + 2, GRASS);
  // 右侧大洞穴地面
  for (let x = 22; x <= 30; x++) st.setTile(x, R + 2, x === 22 ? DIRT : GRASS);
  // ★setSlope 只写坡位,坡格本体须先 setTile（TileStore.setSlope :267）
  st.setTile(21, R, GRASS); st.setSlope(21, R, 1);     // =(1825,317) 坡角
  st.setTile(19, R, GRASS); st.setSlope(19, R, 4);     // =(1823,317) 天花板坡
}

function makeGame(world: World, player: unknown): GameHooks {
  return {
    world, player, enemies: () => [], critters: () => [], spawnDrop: () => null,
    damagePlayer: (): number => 0, addDamageNumber: () => {}, cutTile: () => {},
    spawnParticles: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    spawnDust: () => null, onEnemyKilled: () => {}, entities: { add: () => {} },
  } as unknown as GameHooks;
}

const GEOM = { h: 18, w59: 26, w1: 24 };
// 盒高（vanilla SetDefaults :8600/:9544 24×18×scale;59 scale1.1 → 26.4×19.8 → 26×19）
function bodyOf(vid: number): { w: number; h: number } {
  return vid === 59 ? { w: GEOM.w59, h: 19 } : { w: GEOM.w1, h: GEOM.h };
}

/** 测试侧全实心判定（与 Enemy.fullSolidBoxOverlap 同族：st.isSolid 激活感知 +
 *  坡/半砖/平台排除）——「前缘不进全实心格」不变式的判据 */
function isFullSolidOverlap(st: TileStore, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x / 16), x1 = Math.floor((x + w) / 16);
  const y0 = Math.floor(y / 16), y1 = Math.floor((y + h) / 16);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (!st.inBounds(tx, ty) || !st.isSolid(tx, ty)) continue;
      const j = st.idx(tx, ty);
      if (st.slope[j] !== 0 || st.half[j] || st.isPlatform(tx, ty)) continue;
      if (x + w > tx * 16 && x < tx * 16 + 16 && y + h > ty * 16 && y < ty * 16 + 16) return true;
    }
  }
  return false;
}

/** SW-BJ9 反证接缝：原型补丁关断全实心门 → 漂移步按原版字面无条件执行（=BJ6 前
 *  语义）。返回恢复函数,调用方 finally 恢复。 */
function patchGateOff(): () => void {
  const proto = Enemy.prototype as unknown as Record<string, unknown>;
  const orig = proto.unwedgeGateBlocksFullSolid;
  proto.unwedgeGateBlocksFullSolid = () => false;
  return () => { proto.unwedgeGateBlocksFullSolid = orig; };
}

/** 单次驱动：实录「柱嘴内」姿态（=实录 t=188 姿态,漂移通道确定性点火）。
 *  进深 d∈{8,12} 按 rep 扫描（子像素姿态采样;d=4 姿态 unembed 先于楔形成救出,
 *  漂移通道不点火,无门行使证据,不入扫描域）。返回逐拍观测量。 */
function driveCornerMouth(vid: number, seed: number, ticks: number, rep = 0) {
  const world = new World(48, 220, seed, 'sw-bj9');
  world.groundLevel = 40;  // cy(≈140) > 40 → underground=true → flag3（只影响索敌/跳频）
  buildCorner(world);
  const size = bodyOf(vid);
  const depth = 8 + (rep % 2) * 4;   // 柱左缘进深 {8,12}px（8=实录姿态）
  const e = Enemy.fromVanilla(vid, 20 * 16 + depth, R * 16 - size.h)!;
  e.facing = 1;
  // 钉跳机器（ai0=-3000 在全部 stage 窗之外）——纯化漂移物理通道
  e.ai0 = -3000;
  // ★钉 ai1=-1 抑制 slimeRollContainedItem 掷流（ai1!==0 早退）：否则首拍掷中
  //  3609 传送带档会换掉地面摩擦段（±0.1/t 替代 ×0.8）使漂移步长微变,sticky-clean/
  //  终态闩断言对 RNG 流位敏感（实测 rep 偶红）。与本批 ladder carrier 夹具同款卫生。
  e.ai1 = -1;
  e.ai2 = 1;
  const player = {
    x: 44 * 16, y: 20 * 16, w: 20, h: 42,
    get cx() { return this.x + this.w / 2; }, get cy() { return this.y + this.h / 2; },
    dead: false,
  };
  const game = makeGame(world, player);
  const drive = (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>).slimeAI;
  let prevX = e.x, prevY = e.y;
  let maxJump = 0;
  let crossed = false;
  let everClean = false;
  let cleanViolated = false;
  let latched = false;
  for (let t = 0; t < ticks; t++) {
    drive.call(e, game, player);
    e.facing = 1;   // 钉面向（复刻实录面向右姿态;索敌已由 flag3 域关闭）
    maxJump = Math.max(maxJump, Math.abs(e.x - prevX), Math.abs(e.y - prevY));
    prevX = e.x; prevY = e.y;
    if (e.cx < 20 * 16 && e.cy > (R - 11) * 16) crossed = true;   // 中心已越柱左缘
    const clean = !isFullSolidOverlap(world.store, e.x, e.y, e.w, e.h);
    if (!everClean && clean) everClean = true;
    else if (everClean && !clean) cleanViolated = true;
    if ((e as unknown as { unwedgeBlocked: boolean }).unwedgeBlocked) latched = true;
  }
  const blocked = (e as unknown as { unwedgeBlocked: boolean }).unwedgeBlocked;
  return { e, world, maxJump, crossed, everClean, cleanViolated, latched, blocked };
}

describe('SW-BJ9 坡角嵌固漂移穿墙硬化（刻意偏离原版：不穿越）', () => {
  // ---- A. 门开启（现役行为）：实录姿态两体型×6rep 不穿越 ----
  const cases: Array<{ vid: number; tag: string }> = [
    { vid: 59, tag: '熔岩史莱姆(59) 26×19' },
    { vid: 1, tag: '蓝史莱姆(1) 24×18' },
  ];
  // ★6× 重复 + 出生点扫描（memory 判例:AI 走 Math.random 的实体 A/B 必须多跑统计）
  for (const { vid, tag } of cases) {
    for (let rep = 0; rep < 6; rep++) {
      it(`${tag} rep${rep}:门开启——全程不穿越,洁净后不进全实心,episode 闩置位`, () => {
        const r = driveCornerMouth(vid, 9000 + rep, 1200, rep);
        // 核心语义（SW-BJ9 刻意偏离原版）：漂移通道不得把身体带过台阶柱
        expect(r.crossed, `vid=${vid} rep=${rep} 发生穿越 (cx=${r.e.cx.toFixed(1)})`).toBe(false);
        // sticky-clean：初始化瞬态（BJ6 K2 站顶 snap,非漂移路径）后,前缘不得再进
        // 全实心格——漂移门「全程不进全实心」的直接不变式
        expect(r.everClean, `vid=${vid} rep=${rep} 全程未见洁净态`).toBe(true);
        expect(r.cleanViolated, `vid=${vid} rep=${rep} 洁净后再次侵入全实心`).toBe(false);
        // episode 闩曾置位 = 门确被行使（若漂移通道死掉此断言红）。★用「任意拍曾
        // 置位」而非终态：终态是否保持闩住取决于收尾姿态（如 d=4 姿态 unembed 先推
        // 出→楔锚断开→闩复位），门行使证据看历史不看终态。
        expect(r.latched, `vid=${vid} rep=${rep} episode 闩未置位（门未被行使）`).toBe(true);
        // 无单帧大位移：unembed 推回坡侧 ≤1 格(16px)+ε；旧实现 63px 弹射/多格传送必红
        expect(r.maxJump, `vid=${vid} rep=${rep} 单帧大位移=${r.maxJump}px`).toBeLessThanOrEqual(17.5);
      });
    }
  }

  // ---- B. 反证（判别力）：门关闭即复现原版穿越 ----
  it('反证:原型补丁关断全实心门 → 同夹具复现原版穿越（决定性翻转实验）', () => {
    const restore = patchGateOff();
    try {
      // 与 A 完全相同的夹具/姿态/钉扎,唯一差异=门关闭 → BJ6 定谳的原版穿越必须复现
      const r = driveCornerMouth(1, 9000, 1200);
      expect(r.crossed, '门关闭后未复现原版穿越——夹具失去判别力').toBe(true);
      expect(r.blocked, '门关闭下 episode 闩不得置位').toBe(false);
      // 原版忠实通道：漂移活跃旗每拍置位 → unembed 让位 → 无推回弹射（旧阈值 16.1 沿用）
      expect(r.maxJump, `原版通道出现单帧大位移=${r.maxJump}px`).toBeLessThanOrEqual(16.1);
    } finally {
      restore();
    }
  });

  // ---- C. 致动器安全：激活感知 + episode 期间行为不冻结 ----
  it('致动器 A/B:实心柱 → 闩置位;柱全致动 → 闩不置位且本体自由穿过致动区', () => {
    for (const actuated of [false, true]) {
      const world = new World(48, 220, 777, 'sw-bj9-act');
      world.groundLevel = 40;
      buildCorner(world);
      if (actuated) {
        // 致动器把台阶柱切成可穿态（WIRE_ACTUATED=碰撞本体语义,非裸 type/flags）
        for (let r = R - 10; r <= R + 1; r++) world.store.setActuated(20, r, true);
      }
      const e = Enemy.fromVanilla(1, 20 * 16 + 8, R * 16 - 18)!;
      e.facing = 1; e.ai0 = -3000; e.ai2 = 1; e.ai1 = -1;   // 钉掷流（同 driveCornerMouth）
      const player = { x: 44 * 16, y: 20 * 16, w: 20, h: 42, dead: false,
        get cx() { return this.x + this.w / 2; }, get cy() { return this.y + this.h / 2; } };
      const game = makeGame(world, player);
      const drive = (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>).slimeAI;
      let latched = false; let inActuatedZone = false;
      for (let t = 0; t < 600; t++) {
        drive.call(e, game, player);
        e.facing = 1;
        if ((e as unknown as { unwedgeBlocked: boolean }).unwedgeBlocked) latched = true;
        // 本体左缘进入柱 x 域 [320,336)（致动态=可穿,进入即致动功能未被门阻断）
        if (e.x < 20 * 16 && e.x + e.w > 20 * 16 - 16) inActuatedZone = true;
      }
      if (!actuated) {
        // 对照：实心柱 → 全实心门行使,episode 闩置位
        expect(latched, '实心柱对照:episode 闩未置位（门未被行使）').toBe(true);
      } else {
        // 致动态：激活感知谓词不判实心 → 门不得关闭（史莱姆不被卡在致动态地形上）
        expect(latched, '致动态柱:episode 闩置位=门误判致动格为全实心').toBe(false);
        expect(inActuatedZone, '致动态柱:本体未进入致动区（致动可穿功能受门阻断）').toBe(true);
        // 行为不冻结：本体最终远离柱区（AI/物理链持续运行）
        expect(Math.abs(e.cx - 20 * 16), '致动态柱:本体驻留柱区=行为冻结').toBeGreaterThan(16);
      }
    }
  });

  it('episode 生命周期:闩置位后跳跃机照常点火(不冻结),离楔后闩复位(锚清位)', () => {
    const world = new World(48, 220, 778, 'sw-bj9-life');
    world.groundLevel = 40;
    buildCorner(world);
    const e = Enemy.fromVanilla(1, 20 * 16 + 8, R * 16 - 18)!;
    e.facing = 1;
    e.ai0 = -140;        // 距 stage1 窗(ai0>=0)约 70 个贴地 tick → 闩置位后很快点火
    e.ai2 = 1; e.ai1 = -1;   // 钉掷流（同 driveCornerMouth）
    const player = { x: 44 * 16, y: 20 * 16, w: 20, h: 42, dead: false,
      get cx() { return this.x + this.w / 2; }, get cy() { return this.y + this.h / 2; } };
    const game = makeGame(world, player);
    const drive = (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>).slimeAI;
    let sawLatch = false; let sawJump = false; let clearedAfterJump = false;
    let jumpedBeforeClear = false;
    for (let t = 0; t < 600; t++) {
      drive.call(e, game, player);
      e.facing = 1;
      const blk = (e as unknown as { unwedgeBlocked: boolean }).unwedgeBlocked;
      if (blk) sawLatch = true;
      if (e.vy < 0) sawJump = true;                     // 跳跃机点火（AI 未被闩冻结）
      if (sawJump) jumpedBeforeClear = true;
      if (sawLatch && sawJump && !blk) clearedAfterJump = true;   // 离楔 → 锚清位
    }
    expect(sawLatch, 'episode 闩未观察到置位').toBe(true);
    expect(sawJump, '闩置位后跳跃机未点火=AI 冻结（违反应收约束）').toBe(true);
    expect(clearedAfterJump, '离楔后 episode 闩未复位（锚清位失效）').toBe(true);
    expect(jumpedBeforeClear, '不变式序').toBe(true);
  });

  // ---- D. K2 站顶单元（BJ6 原件：坡面贴合语义不受 BJ9 触碰的守卫） ----
  it('K2 单元:rawNum4<0 实心地坡走原版 else 支站格顶,无 shortfall 滑移（旧实现 -4px 必红）', () => {
    const world = new World(24, 24, 42, 'sw-bj6-k2');
    const st = world.store;
    // slope1 (10,10),高端邻柱 (9,7..10) 实心;壁龛 (10,8)/(10,9) 开放
    for (const [x, y] of [[9, 7], [9, 8], [9, 9], [9, 10], [10, 11]] as [number, number][]) {
      st.setTile(x, y, DIRT);
    }
    st.setTile(10, 10, DIRT);
    st.setSlope(10, 10, 1);
    const b: Body = {
      x: 10 * 16 - 0.1, y: 10 * 16 - 18 + 0.5, w: 24, h: 18,     // 左缘越柱 0.1px,脚沉坡线 0.5px
      vx: 0, vy: 0.3, onGround: false, hitWall: false, hitHead: false, collideY: false,
      stepUp: true,
    };
    moveAndCollide(b, world, 0, b.vy);
    expect(b.x).toBe(10 * 16 - 0.1);            // 无 ±4px shortfall 滑移（旧实现 x-=4）
    expect(b.y).toBe(10 * 16 - 18);             // 站顶支:脚 = 格顶（:1968-1977 num8）
    expect(b.onGround).toBe(true);
    expect(b.vy).toBe(0);
  });

  it('K2 回归:rawNum4>=0 正常坡面贴合不受影响（脚沉坡线仍被抬回坡面对角线）', () => {
    const world = new World(24, 24, 42, 'sw-bj6-k2b');
    const st = world.store;
    for (let x = 8; x <= 14; x++) st.setTile(x, 12, DIRT);   // 平地
    st.setTile(10, 11, DIRT);
    st.setSlope(10, 11, 1);                                   // 平地上的独立坡
    const b: Body = {
      x: 10 * 16 + 8, y: 11 * 16 - 18 + 12, w: 24, h: 18,     // 左缘进深 8px,脚沉对角线 4px
      vx: 0, vy: 0.3, onGround: false, hitWall: false, hitHead: false, collideY: false,
    };
    moveAndCollide(b, world, 0, b.vy);
    // 坡面对角线在左缘进深 8px 处 = 11*16+8;站顶支不触发（rawNum4=8≥0）,走贴合抬升
    expect(b.y + b.h).toBe(11 * 16 + 8);
    expect(b.onGround).toBe(true);
  });

  // ---- E. 结构锁：门只在 AI_001 漂移分支内；TileCollision 消费侧零触碰 ----
  it('结构锁:漂移门/episode 闩仅存于 applyUnwedgeDrift,两漂移点全数改道,unembed 消费侧原样', () => {
    const tc = readFileSync(new URL('../src/physics/TileCollision.ts', import.meta.url), 'utf8');
    // 消费侧零触碰（SW-BJ6 原样）：漂移活跃期 unembed 仍整段让位
    expect(tc).toContain('if (b.unwedgeDrift)');
    expect(tc).toContain('b.unwedgeDrift = false');
    expect(tc).toContain('bestStandTop');
    expect(tc).toContain('rawNum4 < 0');
    const en = readFileSync(new URL('../src/entities/Enemy.ts', import.meta.url), 'utf8');
    // 漂移旗写点收敛为 1（applyUnwedgeDrift 内）;两处 AI 漂移点全数改道经门
    expect(en.match(/this\.unwedgeDrift = true;/g)?.length).toBe(1);
    expect(en.match(/this\.applyUnwedgeDrift\(st, dir\);/g)?.length).toBe(2);
    // episode 闩唯一写点=门方法内;嵌固判定（SolidCollision 语义）仍在两漂移点原位评估
    expect(en.match(/this\.unwedgeBlocked = true;/g)?.length).toBe(1);
    // ★BJ731 改判史（2026-10-27）：BJ434 仙灵舞 AI 两处开域落地窗复用同款
    //   solidBoxOverlap 四参式（非漂移点,共享谓词合法消费）——计数锁改下界
    //   ≥2;漂移点路由仍由上行 applyUnwedgeDrift===2 精确锁定。
    expect(en.match(/solidBoxOverlap\(st, this\.x, this\.y, this\.w, this\.h\)/g)?.length)
      .toBeGreaterThanOrEqual(2);
    // 全实心谓词 + 刻意偏离声明在位
    expect(en).toContain('function fullSolidBoxOverlap(');
    expect(en.match(/刻意偏离原版/g)?.length).toBeGreaterThanOrEqual(2);
    expect(en).toContain('仅 AI_001 两处漂移应用点');
  });
});

// ---- F. 真实存档重放（标注点 (1825,317) 实景;存档缺失时整组 skip） ----
describe.skipIf(localFixtureMissing(SAVE_PATH))('SW-BJ9 真实存档重放:流浪汉舌坡角 (1825,317)', () => {
  let world: World;
  beforeAll(async () => {
    // 延迟 import（7MB 存档仅本组需要）
    const { loadSave } = await import('../src/save/SaveFile');
    ({ world } = loadSave(readLocalFixtureText(SAVE_PATH)));
  });

  it('夹具有效性:标注点周边地形与实录一致', () => {
    const st = world.store;
    // 台阶柱 (1824,315..318) 实心非坡;坡角 (1825,317) slope1;(1825,318) 实心
    for (const y of [315, 316, 317, 318]) {
      const j = st.idx(1824, y);
      expect(st.isSolid(1824, y), `(1824,${y}) 应为实心柱`).toBe(true);
      expect(st.slope[j], `(1824,${y}) 应为非坡全实心`).toBe(0);
    }
    expect(st.slope[st.idx(1825, 317)], '(1825,317) 应为 slope1 坡角').toBe(1);
    expect(st.isSolid(1825, 318), '(1825,318) 应为实心地坪').toBe(true);
  });

  for (const { vid, tag } of [{ vid: 1, tag: '蓝史莱姆(1)' }, { vid: 59, tag: '熔岩史莱姆(59)' }]) {
    it(`${tag}:实录「柱嘴内」姿态全程不穿越（真实存档重放）`, () => {
      const size = bodyOf(vid);
      const e = Enemy.fromVanilla(vid, 1824 * 16 + 8, 317 * 16 - size.h)!;
      e.facing = 1; e.ai0 = -3000; e.ai2 = 1; e.ai1 = -1;   // 钉掷流（同 driveCornerMouth）
      const player = { x: 1800 * 16, y: 300 * 16, w: 20, h: 42, dead: false,
        get cx() { return this.x + this.w / 2; }, get cy() { return this.y + this.h / 2; } };
      const game = makeGame(world, player);
      const drive = (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>).slimeAI;
      let prevX = e.x, prevY = e.y;
      let maxJump = 0; let crossed = false; let everClean = false; let cleanViolated = false;
      let blocked = false;
      for (let t = 0; t < 1200; t++) {
        drive.call(e, game, player);
        e.facing = 1;
        maxJump = Math.max(maxJump, Math.abs(e.x - prevX), Math.abs(e.y - prevY));
        prevX = e.x; prevY = e.y;
        if (e.cx < 1824 * 16) crossed = true;              // 中心越柱左缘=穿到井侧
        const clean = !isFullSolidOverlap(world.store, e.x, e.y, e.w, e.h);
        if (!everClean && clean) everClean = true;
        else if (everClean && !clean) cleanViolated = true;
        if ((e as unknown as { unwedgeBlocked: boolean }).unwedgeBlocked) blocked = true;
      }
      expect(crossed, `${tag} 真实存档发生穿越 (cx=${e.cx.toFixed(1)})`).toBe(false);
      expect(everClean, `${tag} 全程未见洁净态`).toBe(true);
      expect(cleanViolated, `${tag} 洁净后再次侵入全实心`).toBe(false);
      expect(blocked, `${tag} episode 闩未置位（门未被行使）`).toBe(true);
      expect(maxJump, `${tag} 单帧大位移=${maxJump}px`).toBeLessThanOrEqual(17.5);
    });
  }

  it('反证:门关闭 → 真实存档同姿态复现原版穿越（判别力）', () => {
    const restore = patchGateOff();
    try {
      const e = Enemy.fromVanilla(1, 1824 * 16 + 8, 317 * 16 - 18)!;
      e.facing = 1; e.ai0 = -3000; e.ai2 = 1; e.ai1 = -1;   // 钉掷流（同 driveCornerMouth）
      const player = { x: 1800 * 16, y: 300 * 16, w: 20, h: 42, dead: false,
        get cx() { return this.x + this.w / 2; }, get cy() { return this.y + this.h / 2; } };
      const game = makeGame(world, player);
      const drive = (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>).slimeAI;
      let crossed = false;
      for (let t = 0; t < 1200 && !crossed; t++) {
        drive.call(e, game, player);
        e.facing = 1;
        if (e.cx < 1824 * 16) crossed = true;
      }
      expect(crossed, '真实存档门关闭未复现穿越——重放 harness 失去判别力').toBe(true);
    } finally {
      restore();
    }
  });
});
