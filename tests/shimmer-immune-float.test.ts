// 幻彩斗篷微光豁免 + 浮液物理 TryFloatingInFluid（2026-09-03 终波清偿锁定）。
// 原版真值：Terarria1457——
//   ① Chromatic Cloak 5355 → shimmerImmune（:15643-46）；按住下 ≥45t 例外失效
//      （controlDownHold = holdDownCardinalTimer[0] ≥ 45，:25260-25268）
//   ② 5355 在身时微光不再授予 buff 353（:27944 `!shimmerImmune` 门）
//   ③ TryFloatingInFluid（:23639-23679）：GetWaterLine 深处（else 支）vy−=0.4 无钳；
//      液面下沿支 −0.4 钳 −6；到线钉线（钳 −3，vy==0 置 float.Epsilon）
//   ④ wet && ShouldFloatInWater → accFlipper 湿授予（:13115）——脚蹼泳跃能力
//   ⑤ 湿态阻尼（:28061-28067）：wet 且浮源在身 → vy/=2 钳 3
//   ⑥ canFloatInWater 仅两源（R1-F1 勘误 2026-09-03）：甲件 4404 Floating Tube
//      （:13364-67）∪ buff 265 Flamingo 坐骑（:9982-86）；脚蹼药 109 只授
//      ignoreWater+accFlipper（:10257-59）【不授浮液】——浮液用例改 4404 驱动
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { BuffType } from '../src/stats/Buffs';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => {
  const key = vanillaItemKey(vid);
  return key ? ITEM_BY_KEY[key] : -1;
};

const mkHooks = (w: World, p: Player): GameHooks => ({
  world: w, player: p, enemies: () => [], critters: () => [],
  projectiles: () => [], spawnDrop: () => null, damagePlayer: (): number => 0,   // ★BJ744 改判史：G36-A BJ740-D2 清偿线 Player.ts:5159 读 game.projectiles?.()（GameHooks 契约=方法,旧数组形夹具炸 is not a function）
  addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
  spawnEnemy: () => {}, spawnParticles: vi.fn(), notifyInventoryChanged: () => {},
  playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: vi.fn(),
  spawnDust: vi.fn(), showPickupLabel: () => {}, recLog: () => {},
  achievements: undefined, scene: {},
} as never);

/** 地牢箱底水池：地板 y=floorY，水/微光 [waterTop, floorY) */
function mkPoolWorld(kind: LIQUID_TYPE.WATER | LIQUID_TYPE.SHIMMER): World {
  const w = new World(80, 300, 11, 'shimmer-float');   // h=300 → underworldLayer=100
  for (let x = 0; x < 80; x++) {
    w.store.setTileSilent(x, 120, 1);
    for (let y = 60; y < 120; y++) w.store.setLiquid(x, y, 255, kind);
  }
  return w;
}

// ============================================================
// ① ② 幻彩斗篷 5355
// ============================================================
describe('幻彩斗篷 5355 微光豁免（Player.cs:15643-46 / :27944）', () => {
  it('佩戴 → equipStats.shimmerImmune=true；微光浸身不授 buff 353', () => {
    const w = mkPoolWorld(LIQUID_TYPE.SHIMMER);
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.inv.armor[3] = { id: iid(5355), stack: 1 };
    expect(p.equipStats.shimmerImmune).toBe(true);
    const hooks = mkHooks(w, p);
    p.fixedUpdate(1 / 60, hooks);
    expect(p.inShimmer).toBe(true);
    expect(p.buffs.has(BuffType.Shimmered)).toBe(false);   // !shimmerImmune 门
  });

  it('未佩戴 → 微光浸身正常授予 buff 353（对照组）', () => {
    const w = mkPoolWorld(LIQUID_TYPE.SHIMMER);
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    const hooks = mkHooks(w, p);
    p.fixedUpdate(1 / 60, hooks);
    expect(p.inShimmer).toBe(true);
    expect(p.buffs.has(BuffType.Shimmered)).toBe(true);
  });

  it('按住下 44t 豁免有效；第 45t controlDownHold 置位 → 豁免失效 buff 授予', () => {
    const w = mkPoolWorld(LIQUID_TYPE.SHIMMER);
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.inv.armor[3] = { id: iid(5355), stack: 1 };
    const hooks = mkHooks(w, p);
    p.inputDown = true;
    for (let t = 0; t < 44; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.controlDownHold).toBe(false);
    expect(p.equipStats.shimmerImmune).toBe(true);
    expect(p.buffs.has(BuffType.Shimmered)).toBe(false);
    p.fixedUpdate(1 / 60, hooks);                            // 第 45t：hold 达标（:25268）
    expect(p.controlDownHold).toBe(true);
    expect(p.buffs.has(BuffType.Shimmered)).toBe(true);      // 例外窗口授予
  });

  it('旱地按住下 45t → controlDownHold；松开当拍清零（:25265）', () => {
    const w = new World(80, 300, 11, 'dry-hold');
    for (let x = 0; x < 80; x++) w.store.setTileSilent(x, 120, 1);
    const p = new Player(40 * TILE, 118 * TILE, new Inventory());
    const hooks = mkHooks(w, p);
    p.inputDown = true;
    for (let t = 0; t < 45; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.controlDownHold).toBe(true);
    p.inputDown = false;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.downHoldT).toBe(0);
    expect(p.controlDownHold).toBe(false);
  });
});

// ============================================================
// ③ ④ ⑤ 浮液物理
// ============================================================
describe('TryFloatingInFluid（Player.cs:23639-23679）+ 湿阻尼（:28061）+ accFlipper（:13115）', () => {
  it('水上漂靴 4404（canFloatInWater :13364-67）深水中恒上浮（else 支 −0.4 无钳），无浮源对照组下沉', () => {
    const w = mkPoolWorld(LIQUID_TYPE.WATER);
    const p = new Player(40 * TILE, 90 * TILE, new Inventory());
    p.inv.armor[3] = { id: iid(4404), stack: 1 };          // Floating Tube：canFloat 两源之一
    const hooks = mkHooks(w, p);
    for (let t = 0; t < 90; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.inWater).toBe(true);
    expect(p.vy).toBeLessThanOrEqual(0.001);               // 上浮/钉线，不再下坠
    // 对照：无浮源
    const p2 = new Player(40 * TILE, 90 * TILE, new Inventory());
    const hooks2 = mkHooks(w, p2);
    for (let t = 0; t < 90; t++) p2.fixedUpdate(1 / 60, hooks2);
    expect(p2.vy).toBeGreaterThan(0);                      // 半重力下沉
    expect(p2.y).toBeGreaterThan(p.y);                     // 沉得更深
  });

  it('到液面钉线：vy 收敛到 |vy|≤3 且不被"落地"清零（float.Epsilon 档）', () => {
    const w = mkPoolWorld(LIQUID_TYPE.WATER);
    const p = new Player(40 * TILE, 90 * TILE, new Inventory());
    p.inv.armor[3] = { id: iid(4404), stack: 1 };
    const hooks = mkHooks(w, p);
    for (let t = 0; t < 300; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.vy).toBeLessThanOrEqual(3.001);
    expect(p.vy).toBeGreaterThanOrEqual(-6.001);
    expect(p.y / TILE).toBeLessThan(90);                   // 实际上浮到浅层
  });

  it('wet && ShouldFloatInWater → 脚蹼泳跃能力湿授予（:13115）', () => {
    const w = mkPoolWorld(LIQUID_TYPE.WATER);
    const p = new Player(40 * TILE, 90 * TILE, new Inventory());
    p.inv.armor[3] = { id: iid(4404), stack: 1 };          // 水上漂靴 canFloat
    const hooks = mkHooks(w, p);
    p.fixedUpdate(1 / 60, hooks);
    expect(p.inWater).toBe(true);
    const getter = (p as unknown as { shouldFloatInWater: boolean }).shouldFloatInWater;
    expect(getter).toBe(true);
  });

  // 反证锁（R1-F1 2026-09-03）：脚蹼药 vanilla buff 109 = ignoreWater + accFlipper
  // （Player.cs:10257-59），【不置 canFloatInWater】——不得再驱动浮液
  it('脚蹼药水（vanilla buff 109）不授浮液（:10257-59），只授 ignoreWater+泳跃', () => {
    const w = mkPoolWorld(LIQUID_TYPE.WATER);
    const p = new Player(40 * TILE, 90 * TILE, new Inventory());
    p.buffs.apply(BuffType.FlipperPotion, 600);
    const hooks = mkHooks(w, p);
    for (let t = 0; t < 90; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.inWater).toBe(true);
    expect((p as unknown as { shouldFloatInWater: boolean }).shouldFloatInWater).toBe(false);
    expect(p.vy).toBeGreaterThan(0);                       // 照常下沉（无浮液）
    expect(p.liqFactor).toBe(1);                           // ignoreWater：水中位移不折半（对照组 0.5）
    const p2 = new Player(40 * TILE, 90 * TILE, new Inventory());
    const hooks2 = mkHooks(w, p2);
    for (let t = 0; t < 5; t++) p2.fixedUpdate(1 / 60, hooks2);
    expect(p2.liqFactor).toBeCloseTo(0.5, 5);
    // 泳跃仍在：jumpEdge 拍 flipperJump（flag2&&flag3 :20407）放行水中起跳 → swimTime=30
    p.inputJump = true;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.swimTime).toBeGreaterThan(0);
    // 无药对照组：同拍边沿不起跳（vy>0 且无脚蹼/踩底门）→ swimTime 恒 0
    p2.inputJump = true;
    p2.fixedUpdate(1 / 60, hooks2);
    expect(p2.swimTime).toBe(0);
  });
});
