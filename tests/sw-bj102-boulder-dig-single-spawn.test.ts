// ★SW-BJ102 债②（2026-09-16）真实巨石挖路径多 Spawn 双口归一守卫。
// 金标（1457）：
//   · 巨石族弹体 Spawn 唯一位 = WorldGen.Check2x2 destroy 块尾 NewProjectile 表
//     （WorldGen.cs:49171-49235：138→99/484→727/654→1002/664→1013/665→1014/711→1047/
//     712→1048/713→1053/714→1054/715→1055/716→1057）——KillTile 本体【无】弹体 Spawn
//     【无】物品返还（:66120-66140 no-drop;Check2x2 num14 表无 138 族）。
//   · 触达面 = TileFrame 对 138 族的唯一派发 Check2x2（WorldGen.cs:87210）——支撑判据
//     ② BOTH 柱 SolidTileAllowBottomSlope（:48968-48984,单柱支撑仍在=保留）,
//     destroyObject 单飞（:48973 置位/:49206 复位）→ 同件单 Spawn。
//   · 本归一前实证（BJ102 登记）：挖一格=TrapShot×2+RollingBoulder×1 三口并存——
//     ①breakTileBody 挖除臂直发（spawnBoulderRoll/TrapShot）②checkFurnitureSupport
//     家具臂直发（ANY 柱判据+TrapShot）③Check2x2 convert（RollingBoulder）;且挖除臂
//     无闸时 convert destroy 循环 breakCell 重入挖除臂再发。归一后 Spawn 单口=
//     convertBoulderRoll（RollingBoulder,vanilla NewProjectile 位）,挖除/家具臂只清格。
// 变异证红（开发期实测）：M1 挖除臂摘 boulderDestroyGuard → B1 红（监听级联重入再发）;
//   M2 checkFurnitureSupport 巨石早退还原 ANY 柱臂 → B2 红（单柱支撑被拆=原版保留）;
//   M3 摖挖除臂尾 Spawn 改 TrapShot 直发 → B1/B3 红实体类断言。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game } from '../src/core/Game';
import { World } from '../src/world/World';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { RollingBoulder } from '../src/entities/RollingBoulder';
import { TrapShot } from '../src/entities/Dart';

const BOULDER = TILE_BY_KEY['v_138_boulder'];
const TNT = TILE_BY_KEY['v_654_tnt_barrel'];
const STONE = TILE_DEFS.findIndex((d) => d && d.vanilla?.sheet === 1);

interface DigHarness {
  game: Record<string, unknown> & { breakTile: Game['breakTile'] };
  world: World;
  spawned: unknown[];
}
/** 真实监听装配（Game afterWorldLoad :6860/:6863 双监听同序）+ breakTile 运行时台 */
function digHarness(): DigHarness {
  const world = new World(80, 80, 30, 'open');
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & { breakTile: Game['breakTile'] };
  g.world = world;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {} };
  g.spawnDrop = () => null;
  g.recLog = () => {};
  g.dumpChest = () => {};
  const spawned: unknown[] = [];
  g.entities = { add: (e: unknown) => { spawned.push(e); }, drops: [], critters: [], enemies: [], npcs: [], projectiles: [], props: [] };
  g.trackTile = 0;
  g.player = { equipStats: {}, cx: 0, cy: 0 };   // spawnBoulderFamilyRoll cs:48764 生成/读档门
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
  world.store.onTileChanged((cx: number, cy: number) => {
    (g as unknown as { scanBoulderFamilyNear(x: number, y: number): void }).scanBoulderFamilyNear(cx, cy);
  });
  world.store.onTileChanged((x: number, y: number) => {
    (g as unknown as { checkFurnitureSupport(x: number, y: number): void }).checkFurnitureSupport(x, y - 1);
  });
  return { game: g as unknown as DigHarness['game'], world, spawned };
}

/** 布局：2×2 巨石@锚 (ax,ay),支撑行 ay+2 两柱,再下基岩 */
function placeBoulder(world: World, ax: number, ay: number): void {
  const st = world.store;
  st.setTileSilent(ax, ay, BOULDER, 0, 0);
  st.setTileSilent(ax + 1, ay, BOULDER, 18, 0);
  st.setTileSilent(ax, ay + 1, BOULDER, 0, 18);
  st.setTileSilent(ax + 1, ay + 1, BOULDER, 18, 18);
  st.setTileSilent(ax, ay + 2, STONE, 0, 0);
  st.setTileSilent(ax + 1, ay + 2, STONE, 0, 0);
  for (let dx = -1; dx <= 2; dx++) st.setTileSilent(ax + dx, ay + 3, STONE, 0, 0);
}

describe('SW-BJ102 债② 巨石挖路径单 Spawn（Check2x2 NewProjectile :49171 唯一位）', () => {
  it('B1 挖一格 → 整件清+恰 1 RollingBoulder(vid99)、0 TrapShot（改前=3 弹三口）', () => {
    const { game, world, spawned } = digHarness();
    placeBoulder(world, 30, 40);
    game.breakTile(31, 41);                    // 挖右下格（非锚）
    expect(world.store.get(30, 40)).toBe(0);   // 整件清
    expect(world.store.get(31, 40)).toBe(0);
    expect(world.store.get(30, 41)).toBe(0);
    expect(world.store.get(31, 41)).toBe(0);
    expect(spawned.length).toBe(1);            // 单 Spawn（改前 TrapShot×2+RollingBoulder×1）
    expect(spawned[0]).toBeInstanceOf(RollingBoulder);
    expect(spawned[0]).not.toBeInstanceOf(TrapShot);
    const rb = spawned[0] as RollingBoulder & { projId?: number; vanillaId?: number };
    const vid = rb.vanillaId ?? rb.projId;
    expect(vid === 99 || vid === undefined).toBe(true);
  });

  it('B2 支撑判据=Check2x2 判据② BOTH 柱（:48968-48984）：单柱支撑被拆 → 原样保留零弹', () => {
    const { game, world, spawned } = digHarness();
    placeBoulder(world, 30, 40);
    game.breakTile(30, 42);                    // 只拆左柱（右柱仍承放）
    expect(world.store.get(30, 40)).toBe(BOULDER);   // 原版保留（旧家具臂 ANY 柱判据=误塌+误发）
    expect(spawned.length).toBe(0);
    game.breakTile(31, 42);                    // 再拆右柱 → BOTH 失 → Check2x2 destroy+单发
    expect(world.store.get(30, 40)).toBe(0);
    expect(world.store.get(31, 41)).toBe(0);
    expect(spawned.length).toBe(1);
    expect(spawned[0]).toBeInstanceOf(RollingBoulder);
  });

  it('B3 654 TNT 桶回归：挖一格仍恰 1 弹（BJ93 归一不回退,类面=RollingBoulder 单口）', () => {
    const { game, world, spawned } = digHarness();
    const st = world.store;
    st.setTileSilent(50, 40, TNT, 0, 0);
    st.setTileSilent(51, 40, TNT, 18, 0);
    st.setTileSilent(50, 41, TNT, 0, 18);
    st.setTileSilent(51, 41, TNT, 18, 18);
    st.setTileSilent(50, 42, STONE, 0, 0);
    st.setTileSilent(51, 42, STONE, 0, 0);
    game.breakTile(51, 41);
    expect(st.get(50, 40)).toBe(0);
    expect(spawned.length).toBe(1);
    expect(spawned[0]).toBeInstanceOf(RollingBoulder);
    expect(spawned[0]).not.toBeInstanceOf(TrapShot);
  });

  it('B4 多弹口面结构锁：spawnBoulderRoll(TrapShot 直发)已退役、双臂只清格走单口', () => {
    // 源码锁（防回退）：挖除臂/家具臂不再含 TrapShot 直发;Spawn 单点=convertBoulderRoll
    // ★BJ743-A（R24 SEV-2）：函数内 require('node:fs') 旁路守卫——改用顶部既有 ESM
    //   import（readFileSync/join/dirname 同名同参,行为不变,经 fs-guard-shim）。
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const src = readFileSync(join(root, 'src/core/Game.ts'), 'utf8');
    expect(src).not.toContain('spawnBoulderRoll(');
    expect(src).toContain('private spawnBoulderFamilyRoll(');
    const i = src.indexOf('private spawnBoulderFamilyRoll(');
    expect(src.slice(i, i + 700).indexOf('convertBoulderRoll(ax, ay, sheet)')).toBeGreaterThan(0);
  });
});
