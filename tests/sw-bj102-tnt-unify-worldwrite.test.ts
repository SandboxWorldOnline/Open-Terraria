// ★SW-BJ102（2026-09-16）BJ93 债① 1002 aiStyle16 建模余波单面归一 + 世界写入三小缺。
// 全部 1457 锚 1:1（1458 同域逐字,行号 = 1457 + 偏移见各注）：
//   债①四件同刀（RollingBoulder/Game/BoulderMech/types 四文件）：
//     ① life=2 承接（boulderTimeLeft carve-out 退役,json :9535 列）
//     ② Kill_Bombs 爆炸面=弹侧 rbKill1002Face→Game.explodeAt 单发;格侧
//        tntBarrelBlast 改 Spawn-only（0 爆炸面）——vanilla 格侧【无】爆炸面,
//        KillTile case 654 只经 Check2x2 destroy 块 NewProjectile（WorldGen.cs:49178,
//        num2*16+8/num6*16+8、dmg 400、kb 10f）;爆炸面全在弹体首 AI 拍
//        AI_016_Bombs :48031-48035 `owner==myPlayer ∧ timeLeft≤3 → Kill()`。
//     ③ Kill 拍 Damage() 面（dmg=DV(400)/2 :12971-75 逐字,explodeAt 1002 链承载）
//     ④ tileCollide=false（SetDefaults :9533）
//   ★BJ97 判定的 400×2 双自伤面消除判据：改前实证挖一格=3×格侧 explodeAt+2×幻影
//     弹（probe 取证）;归一后格侧 0 面+弹体 1 面 → 玩家承伤恰一次 400 面。
//   三小缺：
//     W1 solidTileAt OOB→false（WorldGen.SolidTile :70659-62 catch 臂;旧注把
//        :70646-49「null→true」怪癖误安 OOB 域——两域分离,repo 无未加载域）
//     W2 SpreadTile fall-through 窄表（DelegateMethods.cs:594-597
//        tileSolid∧!TileID.Sets.Platforms[TileID.cs:243={19,427,435,436,437,438,439}]）
//        ——旧 !d.platform 超集判放行 sheet 239（tileSolid[239]=true Main.cs:9797
//        ∧tileSolidTop :9798∧∉窄表 → vanilla 假=BFS 不穿过）
//     W3 rbCenterTileTruncX/Y=(int)Center/16 截断除（LavaBoulderExplosion :71650）
//        ——与 ToTileCoordinates :76482 之 `(int)vec.X>>4`（Utils.cs:1899-1902,
//        1048 铺置消费）两式并存,分消费点保真（LineOfSight L2 同判例）;负带分叉：
//        Center.X=-8 → 本式 0、>>4=-1
// 变异证红（开发期逐条实测,每缺至少一线;红=摘刀后本文件对应断言翻红）：
//   M1 1002 特支烘回 3600（carve-out 复辟）→ F1/F2 红（不承接）
//   M2 摘 fixedUpdate AI_016 Kill 闸 → F1 红（t+0 不 dead/位移/接触面复活）
//   M3 摘 rbKill1002Face（或其 rbKill 接线）→ F1/F2/F3 红（爆炸面零发）
//   M4 rbKill1002Face 内 explodeAt 双发 → F3 单发断言红
//   M5 摘 ctor tileCollide=false → S1 红（结构位）
//   M6 W2 窄表回退 !d.platform 超集 → W2 红（239 放行 BFS 穿过）
//   M7 W1 OOB 回退 →true → W1 红
//   M8 W3 截断除回退 >>4 → W3 红
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ★BJ743-A（R24 SEV-2）：require('node:fs') 旁路收口——改 ESM import 形经守卫。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { RollingBoulder, boulderTimeLeft } from '../src/entities/RollingBoulder';
import { solidTileAt } from '../src/physics/LineOfSight';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

const STONE = TILE_BY_KEY['stone'];
const BARREL = TILE_BY_KEY['v_654_tnt_barrel'];
const GRASS = TILE_BY_KEY['grass'];

// ================= 弹域单测夹具（sw-bj93 同构 + explodeAt 间谍） =================

function fakeStore(w = 64, h = 64) {
  const cells = new Map<number, number>();
  const type = new Uint8Array(w * h);
  const flags = new Uint8Array(w * h);
  const liquid = new Float32Array(w * h);
  const liquidType = new Float32Array(w * h);
  return {
    w, h,
    type,
    flags,
    slope: new Uint8Array(w * h),
    half: new Uint8Array(w * h),
    liquid, liquidType,
    idx: (x: number, y: number) => y * w + x,
    inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h,
    isSolid: (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const id = cells.get(y * w + x);
      return !!id && !!TILE_DEFS[id]?.solid && !TILE_DEFS[id]?.platform;
    },
    isPlatform: () => false,
    isActive: (x: number, y: number) => cells.has(y * w + x),
    hasTile: (x: number, y: number) => cells.has(y * w + x),
    isActuated: () => false,
    get: (x: number, y: number) => cells.get(y * w + x) ?? 0,
    setTile: (x: number, y: number, t: number) => {
      cells.set(y * w + x, t);
      type[y * w + x] = t;                     // solidTileAt 消费 type/flags 数组域
      flags[y * w + x] = t !== 0 ? 1 : 0;
    },
    setLiquid: (x: number, y: number, amount: number, lt: number) => {
      liquid[y * w + x] = amount;
      liquidType[y * w + x] = lt;
    },
    wire: new Uint8Array(w * h),
    cells,
  };
}
type Store = ReturnType<typeof fakeStore>;

/** explodeAt 间谍（记录参,面 no-op——弹侧只钉「单发+参」,面的域内语义=Game 爆炸域钉测） */
function fakeGame(store: Store) {
  const player = { dead: false, iframes: 0, x: 290, y: 279, w: 20, h: 42, cx: 300, cy: 300, vx: 0, vy: 0, facing: 1, luck: 0, equipStats: {}, hostile: false };
  const exCalls: unknown[][] = [];
  const g = {
    world: { store, w: store.w, h: store.h },
    player,
    enemies: () => [],
    critters: () => [],
    npcs: () => [],
    projectiles: () => [],
    candidatePlayers: () => [player],
    explodeAt: (...a: unknown[]) => { exCalls.push(a); return 0; },
    damagePlayer: (dmg: number) => dmg,
    spawnParticles: () => {},
    spawnDust: () => null,
    playSfx: () => {},
    playSfxWav: () => {},
    playSfxFile: () => {},
    cutTile: () => {},
    spawnDrop: () => null,
    addLightAt: () => {},
    exCalls,
  };
  return g as unknown as GameHooks & { exCalls: unknown[][]; player: typeof player };
}

const mkBoulder = (sheet: number): RollingBoulder => new RollingBoulder(104, 104, sheet);
const internals = (b: RollingBoulder) => b as unknown as {
  rbKill: (g: GameHooks) => void;
  rbKillGrassAround: (x: number, y: number, g: GameHooks) => void;
  rbSpreadPoopPyramid: (g: GameHooks) => void;
  rbLavaBoulderExplosion: (g: GameHooks) => void;
  rbCenterTileTruncX: () => number;
  rbCenterTileTruncY: () => number;
  rbCenterTileX: () => number;
  tileCollide?: boolean;
  localAI2: number;
};

beforeEach(() => { vi.restoreAllMocks(); });

// ================= 债①：1002 四件归一（弹域拍序） =================

describe('SW-BJ102 债① 1002 拍序表（AI_016_Bombs :48031-35 → Kill :71766-71795）', () => {
  it('F1 拍序 t+0/t+1：首拍即 Kill+爆炸面单发、零位移、零接触结算（PVE/EVP/CutTiles 全不可达）;第二拍零追加', () => {
    const store = fakeStore();
    const game = fakeGame(store);
    const enemy = { id: 7, dead: false, x: 90, y: 90, w: 40, h: 40, cx: 110, cy: 110, hurt: vi.fn() };
    (game as unknown as { enemies: () => unknown[] }).enemies = () => [enemy];
    const b = mkBoulder(654);                          // 1002（timeLeft=2 承接）
    b.x = 90; b.y = 90;                                // 与敌盒相交（旧建模接触面必打）
    const x0 = b.x, y0 = b.y;
    b.fixedUpdate(1 / 60, game);                       // t+0：AI 段 Kill 闸 → rbKill1002Face
    expect(b.dead).toBe(true);                         // timeLeft=2≤3 → 首 AI 拍 Kill（M1/M2 红）
    expect(game.exCalls.length).toBe(1);               // 爆炸面恰一次（M3/M4 红）
    expect(enemy.hurt).not.toHaveBeenCalled();         // aiStyle25 PVE 接触环不可达（dmg/2 在 explodeAt 链）
    expect(b.x).toBe(x0); expect(b.y).toBe(y0);        // 零位移（tileCollide=false+无运动核+首拍死）
    b.fixedUpdate(1 / 60, game);                       // t+1：!active 闸（BJ97 债1）空转
    expect(game.exCalls.length).toBe(1);               // 二拍零追加
    expect(enemy.hurt).not.toHaveBeenCalled();
  });

  it('F1b ①承接值：boulderTimeLeft(1002)=2（json :9535 列;carve-out 3600 退役）', () => {
    expect(boulderTimeLeft(1002)).toBe(2);
    expect(mkBoulder(654).life).toBe(2);
  });

  it('S1 ④tileCollide=false 结构位（SetDefaults :9533/json 列）——M5 红', () => {
    expect(internals(mkBoulder(654)).tileCollide).toBe(false);   // 1002 显式 false
    expect(internals(mkBoulder(138)).tileCollide).toBeUndefined(); // 家族余型缺省真（原版缺省 true）
  });
});

// ================= 债①②：格侧 0 面 + 弹侧单面（真实 Game 流） =================

/** 真实 Game 原型桩（grenade-cracked mkGame 同款）+ 桶夹具 + 全监听接线。
 *  faceSpy 包真实 explodeAt（面全语义跑,伤害/地形用桩承接）→ 面计数=真计数。 */
function tntWorld() {
  const world = new World(64, 64, 7, 'j1');
  const st = world.store;
  for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) st.setTileSilent(x, y, STONE);
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
    st.setTileSilent(10 + dx, 10 + dy, BARREL, dx * 18, dy * 18);
  }
  const g = Object.create(Game.prototype) as Record<string, any> & { logs?: unknown[] };
  g.world = world;
  // 玩家置于 vanilla 260 爆盒 [168,428)²内（桶锚 (10,10) → 盒心 10*16+138=298）
  g.player = { dead: false, iframes: 0, x: 290, y: 279, w: 20, h: 42, cx: 300, cy: 300, vx: 0, vy: 0, facing: 1, luck: 0, equipStats: {}, hostile: false, lastDamageCause: null };
  g.chunks = { markDirtyArea: () => {} };
  const spawned: unknown[] = [];
  g.entities = { enemies: [], critters: [], npcs: [], drops: [], add: (e: unknown) => { spawned.push(e); } };
  const playerHits: number[] = [];
  g.damagePlayer = (dmg: number) => { playerHits.push(dmg); return dmg; };
  g.spawnParticles = () => {};
  g.spawnDrop = () => null;
  g.sfx = { play: () => {} };
  g.sfxAt = () => {};
  g.playSfxFiles = () => true;
  g.dumpChest = () => {};
  g.trackTile = 0;
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
  g.logs = [];
  const realRecLog = g.recLog.bind(g);
  g.recLog = (k: string, v: unknown) => realRecLog(k, v);
  // 面计数器：包真实 explodeAt
  const realExplode = (g.explodeAt as (...a: unknown[]) => unknown).bind(g);
  const faces: unknown[][] = [];
  g.explodeAt = (...a: unknown[]) => { faces.push(a); return realExplode(...a); };
  // 监听接线（Game bootstrap :6857/:6861 等价）
  world.store.onTileChanged((x: number, y: number) => (g as unknown as { scanBoulderFamilyNear(x: number, y: number): void }).scanBoulderFamilyNear(x, y));
  world.store.onTileChanged((x: number, y: number) => (g as unknown as { checkFurnitureSupport(x: number, y: number): void }).checkFurnitureSupport(x, y - 1));
  return { world, st, g, spawned, faces, playerHits, logs: g.logs as unknown[] };
}

/** 流断言：破坏后（弹体未更新）格侧 0 爆炸面+1 弹;弹体首拍后 1 面+玩家恰 1 次 400 面 */
function assertUnifyFlow(ctx: ReturnType<typeof tntWorld>) {
  const { st, g, spawned, faces, playerHits, logs } = ctx;
  // ——格侧（弹体未更新）：0 爆炸面、1 弹体、桶清空、无掉落
  const bombLogs = logs.filter((l) => typeof l === 'object' && l !== null
    && (l as Record<string, unknown>).projId === 1002 && (l as Record<string, unknown>).r === 0);
  expect(bombLogs.length).toBe(0);                   // 格侧零爆炸面（M3 旧格侧面红）
  expect(spawned.length).toBe(1);                    // vanilla :49178 单弹（改前实证 2-3 弹）
  expect(spawned[0]).toBeInstanceOf(RollingBoulder);
  expect((spawned[0] as RollingBoulder).projId).toBe(1002);
  expect((spawned[0] as RollingBoulder).dmg).toBe(400);
  for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) expect(st.get(x, y)).toBe(0);
  // ——弹体首 AI 拍：Kill → 爆炸面单发（真面全语义）
  (spawned[0] as RollingBoulder).fixedUpdate(1 / 60, g as unknown as GameHooks);
  expect((spawned[0] as RollingBoulder).dead).toBe(true);
  expect(faces.length).toBe(1);                      // 爆炸面单发（M4 红）
  const [tx, ty, dmg, radius, destroyTiles, hurtBox, , projId, cpx, cpy] = faces[0]!;
  expect(dmg).toBe(400);
  expect(radius).toBe(0);                            // SW-J1：Kill 不炸地形（死代码定谳）
  expect(destroyTiles).toBe(false);
  expect(hurtBox).toBe(130);                         // vanilla 260×260 盒半宽
  expect(projId).toBe(1002);
  expect(cpx).toBe(10 * 16 + 8 + 130);               // 弹盒心=vanilla 出生位+130（:49178 num2*16+8）
  expect(cpy).toBe(10 * 16 + 8 + 130);
  void tx; void ty;
  // ——玩家承伤恰一次 400 面（DV ±15%）=BJ97 400×2 双发消除
  expect(playerHits.length).toBe(1);
  expect(playerHits[0]).toBeGreaterThanOrEqual(340);
  expect(playerHits[0]).toBeLessThanOrEqual(460);
}

describe('SW-BJ102 债①② 格侧 0 面+弹侧单面（三流归一）', () => {
  it('F2 挖除流：breakTile(桶格) → 单弹+零格侧面 → 弹体首拍单面+玩家恰一次', () => {
    const ctx = tntWorld();
    ctx.g.breakTile(10, 10);
    assertUnifyFlow(ctx);
  });

  it('F3 失撑流：清空双下支撑格 → Check2x2 → 单弹+零格侧面 → 弹体首拍单面+玩家恰一次', () => {
    const ctx = tntWorld();
    for (let x = 8; x <= 13; x++) for (let y = 12; y <= 15; y++) ctx.st.setTileSilent(x, y, 0);
    ctx.st.setTileSilent(10, 12, STONE);
    ctx.st.setTileSilent(11, 12, STONE);
    ctx.logs!.length = 0; ctx.faces.length = 0;
    ctx.st.setTile(10, 12, 0);
    ctx.st.setTile(11, 12, 0);
    assertUnifyFlow(ctx);
  });

  it('F4 爆炸破桶流：explodeAt 真面破桶格 → 链发单弹+零格侧面（殉爆自然串发）', () => {
    const ctx = tntWorld();
    // 用一颗炸弹 28 的真实爆炸面破桶（r=4 圆盘盖住桶体）——爆炸面 1 次（弹 28）+
    // 桶破经本链单发 1002（格侧零新增面）
    ctx.g.explodeAt(10, 10, 100, 4, true, 11, 0, 28);
    const bombFaces = ctx.faces.length;                // 炸弹面 1 次
    expect(bombFaces).toBe(1);
    expect(ctx.spawned.length).toBe(1);                // 桶破 → 单弹（无幻影连发）
    expect((ctx.spawned[0] as RollingBoulder).projId).toBe(1002);
    const tntFaces = ctx.faces.filter((f) => f[7] === 1002);
    expect(tntFaces.length).toBe(0);                   // 格侧零 1002 面
  });
});

// ================= W1：solidTileAt OOB→false（:70659-62 catch 臂） =================

describe('SW-BJ102 W1 solidTileAt OOB 域勘误（null→true 怪癖≠OOB 域）', () => {
  it('W1a 单元：界内走判定式、界外 false（:70659-62）——M7 红', () => {
    const st = fakeStore(8, 8);
    st.setTile(3, 3, STONE);
    expect(solidTileAt(st as never, 3, 3)).toBe(true);
    expect(solidTileAt(st as never, -1, 3)).toBe(false);   // OOB（旧实现=true=怪癖误安）
    expect(solidTileAt(st as never, 3, -1)).toBe(false);
    expect(solidTileAt(st as never, 8, 3)).toBe(false);
    expect(solidTileAt(st as never, 3, 8)).toBe(false);
  });

  it('W1b 消费面：rbKillGrassAround 3×3 全实心判（DelegateMethods.cs:563 WorldGen.SolidTile 同站）——世界缘草不转化、内陆草转化', () => {
    const g = fakeGame(fakeStore(8, 8));
    const st = (g.world as unknown as { store: Store }).store;
    // 内陆草 (4,4)：3×3 全石（含自身草=实心）→ SolidTile 全真 → 转化土
    for (let x = 3; x <= 5; x++) for (let y = 3; y <= 5; y++) if (!(x === 4 && y === 4)) st.setTile(x, y, STONE);
    st.setTile(4, 4, GRASS);
    internals(mkBoulder(712)).rbKillGrassAround(4, 4, g);
    expect(st.get(4, 4)).toBe(TILE_BY_KEY['dirt']);
    // 世界缘草 (0,0)：界内 3 邻全石、(−1..)² 5 格越界 → OOB 臂=false → flag=false → 不转化
    //  （旧 OOB=true 实现下 flag 保持 true → 会误转化=变异红）
    st.setTile(0, 0, GRASS);
    st.setTile(1, 0, STONE); st.setTile(0, 1, STONE); st.setTile(1, 1, STONE);
    internals(mkBoulder(712)).rbKillGrassAround(0, 0, g);
    expect(st.get(0, 0)).toBe(GRASS);
  });
});

// ================= W2：SpreadTile fall-through 窄表（:594-597 + TileID.cs:243） =================

describe('SW-BJ102 W2 SpreadTile fall-through 窄表（239 域）', () => {
  /** 1048 便便金字塔面：以弹心 tile=(px,py) 起 BFS;断言目标格 poo 落位 */
  function poopAt(b: RollingBoulder, px: number, py: number): Set<string> {
    const g = fakeGame(fakeStore(64, 64));
    b.x = px * 16 - 15.5; b.y = py * 16 - 15.5;        // Center→(px,py) 格（trunc((px*16-15.5)+15.5)=px*16 → >>4=px）
    internals(b).rbSpreadPoopPyramid(g);
    const st = (g.world as unknown as { store: Store }).store;
    const placed = new Set<string>();
    for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) {
      if (st.get(x, y) === TILE_BY_KEY['v_666_poo']) placed.add(`${x},${y}`);
    }
    return placed;
  }

  it('W2a 残型 239（tileSolid∧tileSolidTop∧∉窄表）→ fall-through 假=BFS 不穿过（:594-597）——M6 红', () => {
    const b = mkBoulder(712);                          // 1048 → rbKillTerrainFace → SpreadPoopPyramid
    const g = fakeGame(fakeStore(64, 64));
    const st = (g.world as unknown as { store: Store }).store;
    b.x = 32 * 16 - 15.5; b.y = 32 * 16 - 15.5;        // 心 tile (32,32)=种子;宽行 y=33（num3=ay+1）
    st.setTile(33, 33, TILE_BY_KEY['v_239_ore_bars']); // 残型 239 在宽行 (33,33)=通往 (34,33) 必经
    internals(b).rbSpreadPoopPyramid(g);
    expect(st.get(32, 33)).toBe(TILE_BY_KEY['v_666_poo']);        // 种子 poo 已落（harness 活性）
    expect(st.get(33, 33)).toBe(TILE_BY_KEY['v_239_ore_bars']);   // 239 本格不放（PlaceTile 失败）
    expect(st.get(34, 33)).toBe(0);                    // ★窄表：239 fall-through=假 → BFS 止于其右
    // 对照：旧超集判（!d.platform）此处会放行 → (34,33) 落 poo=变异红
  });

  it('W2b 对照正例：残型 19 平台（∈窄表）→ fall-through 真=BFS 穿过;380 种植箱特例真（:596）', () => {
    const b = mkBoulder(712);
    const g = fakeGame(fakeStore(64, 64));
    const st = (g.world as unknown as { store: Store }).store;
    b.x = 32 * 16 - 15.5; b.y = 32 * 16 - 15.5;
    st.setTile(33, 33, TILE_BY_KEY['platform']);       // 19 ∈ TileID.Sets.Platforms
    internals(b).rbSpreadPoopPyramid(g);
    expect(st.get(34, 33)).toBe(TILE_BY_KEY['v_666_poo']);   // 窄表放行 → BFS 穿过 19
    const g2 = fakeGame(fakeStore(64, 64));
    const st2 = (g2.world as unknown as { store: Store }).store;
    b.x = 32 * 16 - 15.5; b.y = 32 * 16 - 15.5;
    st2.setTile(33, 33, TILE_BY_KEY['v_380_planter_boxes']);  // 380 特例（tileSolid∧∉窄表 → 真）
    internals(b).rbSpreadPoopPyramid(g2);
    expect(st2.get(34, 33)).toBe(TILE_BY_KEY['v_666_poo']);
    void poopAt;
  });
});

// ================= W3：(int)Center/16 截断除（:71650）vs >>4（:76482） =================

describe('SW-BJ102 W3 心 tile 提取分式（负带分叉：trunc 除 vs >>4）', () => {
  it('W3a 截断除单元：Center.X=-184.5 → (int)-184.5/16 = -11（>>4=-12）——M8 红', () => {
    const b = new RollingBoulder(-200, -200, 713);     // 1053;Center=(-184.5,-184.5)
    expect(internals(b).rbCenterTileTruncX()).toBe(-11);
    expect(internals(b).rbCenterTileTruncY()).toBe(-11);
    expect(internals(b).rbCenterTileX()).toBe(-12);    // 对照：ToTileCoordinates >>4 式（:76482 消费,保持）
  });

  it('W3b 1053 注液面接线：rbLavaBoulderExplosion 用截断除（S 锁+正域 span 烟测）', () => {
    // ★S 锁（M8 判别线）：rbLavaBoulderExplosion 消费截断除变体——正域两式同值
    //  （W3a 钉负带分叉值,本锁钉 1053 面→截断除的接线,防「顺手统一成 >>4」回退）
    // ★BJ743-A：require 形退役——顶部 ESM import 经守卫（R24 SEV-2 旁路收口）。
    const src = readFileSync(join(__dirname, '../src/entities/RollingBoulder.ts'), 'utf8');
    const fn = src.slice(src.indexOf('private rbLavaBoulderExplosion'), src.indexOf('private rbPlaceLiquidLava'));
    expect(fn).toContain('this.rbCenterTileTruncX()');
    expect(fn).toContain('this.rbCenterTileTruncY()');
    expect(fn).not.toContain('this.rbCenterTileX()');
    const g = fakeGame(fakeStore(64, 64));
    const st = (g.world as unknown as { store: Store }).store;
    const b = mkBoulder(713);                          // 1053
    b.x = 13 * 16 + 0.5 - 15.5; b.y = 13 * 16 + 0.5 - 15.5;   // Center→(13.03,13.03) → tile 13
    internals(b).rbLavaBoulderExplosion(g);
    const liquidCells: string[] = [];
    for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) {
      if (st.liquid[st.idx(x, y)] > 0) liquidCells.push(`${x},${y}`);
    }
    expect(liquidCells.length).toBeGreaterThan(0);     // 注液面在场（r4 开圆盘）
    for (const c of liquidCells) {
      const [x, y] = c.split(',').map(Number);
      expect(Math.hypot(x - 13, y - 13)).toBeLessThan(4);   // 心=(13,13)（两式正域同值=接线烟测）
    }
  });
});
