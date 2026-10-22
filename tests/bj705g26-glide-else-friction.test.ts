// ★BJ705-G26 件1 [g25-glide-else-friction] 清偿守卫——滑行期 HorizontalMovement else
// 摩擦支 1:1（定谳+判别锁,1457 亲读）:
//
//   原版 HorizontalMovement else-if 链（Player.cs:19975-20215,1456 :19559-19810 同形）:
//     :19975/:20033 全速两支（1457 删 dashDelay 门——本仓由 dashMovement 滑行支承载）
//     :20091/:20121 爬坡两支（两版保 dashDelay>=0 门——滑行期不选）
//     :20151 矿车钳臂（本仓骑矿车=early return 不可达,不建模）
//     :20187-20196 else `vy==0` 地面摩擦 runSlowdown【不闸 dashDelay】
//     :20202-20212 else 空中摩擦 ×0.5【不闸 dashDelay】
//   ⇒ 滑行期(dashDelay<0)每拍 HM 先摩擦、DashMovement(:26958)后阻尼(:21424-21575)。
//   G25 期「净效≈阻尼带重叠 2-3 拍」估量勘误（本刀 oracle 重导,探针逐拍定谳）:
//   摩擦逐拍全程叠加——接地滑程 36→21 拍、悬空 36→28 拍、绳上离绳(1 接地+余悬空)
//   →26 拍;出口钉值不变(dashDelay=num17、vx=±num15)。
//
//   落刀（Player.ts HM 段）:glideElseFriction()（vanilla 字面谓词 this.vy===0,勿与
//   applyRunFriction 的 onGround 复合合并）+ 持键臂 else-if（全速支补集:ix>0 →
//   vx>=maxRun / ix<0 → vx<=-maxRun）+ 无键臂 else-if;两臂均门
//   !grappling[0] && !TheTongue（原版两支 :27598 else 整段不跑 HM）。pulley（绳支
//   无 HM）/pogo（:19921 早退）由外层门承载。
//
// 变异恰红（/tmp/bj705g26-mutations.mjs）:M1 无键臂摘除/M2 持键臂摘除/M3 谓词改
//   onGround 复合（悬空面红）/M4 持键臂补集翻转/M5 挂爪门摘除（舌缚结构性锁面）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];
const W = 80, H = 80;
const GROUND_ROW = 30;

/** 平地世界（接地滑行域） */
function dryWorld(): World {
  const w = new World(W, H, 11, 'g26-dry');
  for (let x = 4; x < 78; x++) w.store.setTile(x, GROUND_ROW, 1);
  return w;
}

/** 无地板世界（全程悬空滑行域——太空带重力 0.1,vy 恒非零不吃接地档） */
function airWorld(): World {
  return new World(W, H, 11, 'g26-air');
}

function fakeHooks(w: World, p: Player): GameHooks {
  return {
    world: w, player: p, enemies: () => [], critters: () => [], npcs: () => [],
    damagePlayer: (): number => 0, spawnDrop: () => null, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, recLog: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
  } as unknown as GameHooks;
}
function mkPlayer(w: World, row: number, tx: number): Player {
  const p = new Player(tx * TILE, row * TILE - 48, new Inventory());
  p.hp = 500;
  return p;
}
const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };
function injectDash(p: Player, held: boolean): void { p.inputDash = held; p.releaseDash ||= !p.inputDash; }
function armDash(p: Player, w: World): void { injectDash(p, false); tick(p, w); expect(p.releaseDash).toBe(true); }

/** 滑行 oracle 模拟（与实现同序同运算——HM 摩擦先、DM 阻尼后;:26889→:26958 序）:
 *  fr = 每滑行拍的 HM else 摩擦值（number=恒值;number[]=逐拍序列,尾值续航）。
 *  返回滑行拍数 N（第 N+1 拍落终止:dashDelay=num17、vx=±num15）。 */
function glideSim(v0: number, num13: number, num14: number, num15: number, num16: number,
  fr: number | number[]): number {
  const seq = Array.isArray(fr) ? fr : null;
  const frAt = (i: number): number => (seq ? seq[Math.min(i - 1, seq.length - 1)] : fr as number);
  let vx = v0; let n = 0;
  for (;;) {
    const f = frAt(n + 1);
    if (vx > f) vx -= f; else if (vx < -f) vx += f; else vx = 0;
    if (Math.abs(vx) > num13) { vx *= num14; n++; continue; }
    if (Math.abs(vx) > num15) { vx *= num16; n++; continue; }
    return n;
  }
}

// dash2 克盾裸装钉值:14.5 起步、12/0.985、num15=3、0.94、冷却 30（BJ524 同锚）
const V0 = 14.5, N13 = 12, N14 = 0.985, N15 = 3, N16 = 0.94, COOL = 30;
const GROUND_FR = 0.2, AIR_FR = 0.1;   // 裸装 runSlowdown / 空中 ×0.5（:20187/:20202）

/** 发起并逐拍回读滑行 vx（判别面:与 glideSim 逐拍对拍;hold 键在发起拍后注入
 *  ——发起拍持反向会经 dashKeyNum 把冲刺本身反向（:21736 持反向改持向）） */
function glideTimeline(w: World, row: number, tx: number, hold: 0 | 1 | -1): number[] {
  const p = mkPlayer(w, row, tx);
  p.inv.armor[3] = { id: iid(3097), stack: 1 };
  for (let i = 0; i < 10; i++) tick(p, w);
  p.facing = 1;
  armDash(p, w);
  injectDash(p, true);
  tick(p, w);
  expect(p.vx).toBeCloseTo(V0, 5);          // 发起拍钉值（摩擦对 vx=0/发起后覆写均无干扰）
  expect(p.dashDelay).toBe(-1);
  injectDash(p, false);
  if (hold === 1) { p.inputX = 1; p.inputRight = true; }
  else if (hold === -1) { p.inputX = -1; p.inputLeft = true; }
  const out: number[] = [];
  for (let i = 0; i < 60; i++) {
    tick(p, w);
    out.push(p.vx);
    if (p.dashDelay > 0) break;
  }
  if (hold !== 0) { p.inputX = 0; p.inputLeft = false; p.inputRight = false; }
  return out;
}

describe('BJ705-G26 §A 接地滑行:HM else 摩擦逐拍叠加（oracle 重导时间线）', () => {
  it('无键接地滑行:逐拍 vx=摩擦+阻尼同序模拟,恰 N 拍落冷却 30、出口钳 +3', () => {
    const N = glideSim(V0, N13, N14, N15, N16, GROUND_FR);
    expect(N).toBe(21);                      // 纯阻尼 36 → 摩擦叠加 21（估量勘误锚）
    const tl = glideTimeline(dryWorld(), GROUND_ROW, 24, 0);
    expect(tl.length).toBe(N + 1);           // N 拍滑行 + 终止拍
    // 逐拍对拍（同序同运算 → toBeCloseTo 12 位）
    let vx = V0;
    for (let i = 0; i < N; i++) {
      vx = vx > GROUND_FR ? vx - GROUND_FR : 0;
      vx = Math.abs(vx) > N13 ? vx * N14 : Math.abs(vx) > N15 ? vx * N16 : vx;
      expect(tl[i], `滑行第 ${i + 1} 拍 vx`).toBeCloseTo(vx, 12);
    }
    expect(tl[N]).toBe(3);                   // 终止拍出口钳 ±num15
  });

  it('终止拍后冷却 30 拍回就绪,冷却期无键 vx 由正常摩擦支衰减（旧路径不回归）', () => {
    const w = dryWorld();
    const p = mkPlayer(w, GROUND_ROW, 24);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    injectDash(p, false);
    const N = glideSim(V0, N13, N14, N15, N16, GROUND_FR);
    for (let i = 0; i < N; i++) tick(p, w);
    tick(p, w);
    expect(p.dashDelay).toBe(30);            // num17（dash2=30）
    expect(p.vx).toBe(3);
    tick(p, w);                              // 冷却第 1 拍:正常无键摩擦 −0.2
    expect(p.vx).toBeCloseTo(2.8, 12);
    for (let i = 0; i < 29; i++) { injectDash(p, false); tick(p, w); }
    expect(p.dashDelay).toBe(0);             // 冷却回就绪
  });
});

describe('BJ705-G26 §B 悬空滑行:空中摩擦 ×0.5 档（vy≠0 谓词面）', () => {
  it('无地板世界全程悬空:逐拍=空中摩擦 0.1 时间线,出口钳 +3 落冷却 30', () => {
    const N = glideSim(V0, N13, N14, N15, N16, AIR_FR);
    expect(N).toBe(27);                      // 悬空档（接地 21 → 空中 27）
    const tl = glideTimeline(airWorld(), 20, 24, 0);
    expect(tl.length).toBe(N + 1);
    let vx = V0;
    for (let i = 0; i < N; i++) {
      vx = vx > AIR_FR ? vx - AIR_FR : 0;
      vx = Math.abs(vx) > N13 ? vx * N14 : Math.abs(vx) > N15 ? vx * N16 : vx;
      expect(tl[i], `悬空滑行第 ${i + 1} 拍 vx`).toBeCloseTo(vx, 12);
    }
    expect(tl[N]).toBe(3);
  });
});

describe('BJ705-G26 §C 持键面:同向越帽落摩擦支,反向落全速支（补集门）', () => {
  it('同向持键(越帽):时间线与无键逐拍全等（else 摩擦同支）', () => {
    const wA = dryWorld(), wB = dryWorld();
    const a = glideTimeline(wA, GROUND_ROW, 24, 0);
    const b = glideTimeline(wB, GROUND_ROW, 24, 1);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i], 12);
  });

  it('反向持键:落全速支（dashMovement 滑行支承载）——HM 摩擦臂不写（首拍钉值）', () => {
    const tl = glideTimeline(dryWorld(), GROUND_ROW, 24, -1);
    // 首拍 = 制动 runSlow + 反向 runAcc 后阻尼（:19975 支）,非 HM 摩擦 −0.2:
    // (14.5 − 0.2 − 0.08) × 0.985 = 14.00667（若误走摩擦支 = 14.0855,判别差 0.079）
    expect(tl[0]).toBeCloseTo((V0 - GROUND_FR - 0.08) * N14, 12);
    expect(tl[0]).not.toBeCloseTo((V0 - GROUND_FR) * N14, 12);
  });
});

describe('BJ705-G26 §D 结构锁（源锚——防静默回退）', () => {
  const src = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8');
  it('D1 glideElseFriction 定义+vanilla 字面 vy===0 谓词（勿并 onGround 复合）', () => {
    expect(src).toContain('const glideElseFriction = (): void => {');
    expect(src).toContain('const fr = this.vy === 0 ? runSlow : runSlow * 0.5;');
    expect(src.match(/\[g25-glide-else-friction\]/g)?.length).toBe(3);   // 定义注+持键臂注+无键臂注
  });
  it('D2 持键臂补集门+双闸门（挂爪/舌缚）+ 无键臂', () => {
    expect(src).toContain('} else if (ix > 0 ? this.vx >= maxRun : this.vx <= -maxRun) {');
    expect(src.match(/if \(!this\.grappling\[0\] && !this\.buffs\.has\(BuffType\.TheTongue\)\) glideElseFriction\(\);/g)?.length).toBe(2);
    expect(src).toContain('else if (!this.grappling[0] && !this.buffs.has(BuffType.TheTongue)) glideElseFriction();');
  });
});
