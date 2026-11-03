// ★issue#46（v0.1.84-beta「NPC 一致性审计」）生成簇刀 C：
//   N01（P1）getSpawnRate 尾部三布尔错位 → 具名入参
//   N02（P2）RNG.int 闭区间误用（血月 Next(5)<2 / 天空盒 Next(3)==0 + 同类扩查 Next(8)）
//   N13（P3）修剪草入侵豁免用近前线代理而非全局 invasionType
//   N12-蜘蛛池（P2）lavaLine 误当地狱线（UnderworldLayer=maxTilesY-200）
//
// 纪律：
//   · 行为锁直调 VanillaSpawner 合成夹具（真 World/TileStore/Enemy.fromVanilla）；
//   · Game.ts 只读结构锁（并行刀 A 在同文件另一区段写，禁变异）；
//   · withMutation 只打 VanillaSpawner.ts（本刀独占）。
// 原版锚一律 Terarria1457（issue 所引 1.4.5.8 行号已逐条重锚）。

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { World } from '../src/world/World';
import { VanillaSpawner } from '../src/world/spawn/VanillaSpawner';
import { RNG } from '../src/core/rng';
import { TILE_BY_KEY } from '../src/data/tiles';
import { setDebugPool } from '../src/data/vanillaNpcs';
import { withMutation } from './mutation-guard';

const GAME = join(process.cwd(), 'src', 'core', 'Game.ts');
const SPAWNER = join(process.cwd(), 'src', 'world', 'spawn', 'VanillaSpawner.ts');
const TILE = 16;
const MOWED_GRASS = TILE_BY_KEY['v_477_mowed_grass_block'];

// ===================== 通用夹具 =====================

/** 400×800 经典地表世界（bj749a 同源几何）：ground=60 / rock=120 / 白天。 */
function makeRateWorld(difficulty = 0): World {
  const w = new World(400, 800, 42, 'issue46-rate');
  w.groundLevel = 60;
  w.rockLevel = 120;
  w.difficulty = difficulty;
  w.clock.timeOfDay = 12 / 24;
  return w;
}

interface FakeRng {
  calls: { next: number; int: Array<[number, number]>; nextInt: number[] };
  next(): number;
  int(a: number, b: number): number;
  nextInt(m: number): number;
  nextIntRange(a: number, b: number): number;
}

/** 可控样本 RNG：所有掷骰用同一 [0,1) 样本（nextInt/int 按 C# Next 语义取整）。
 *  `onInt` 可对指定 (a,b) 覆盖样本（N02 血月门定位用）。 */
function fixedRng(value: number, onInt?: (a: number, b: number) => number | undefined): FakeRng {
  const calls = { next: 0, int: [] as Array<[number, number]>, nextInt: [] as number[] };
  const pick = (a: number, b: number): number => onInt?.(a, b) ?? value;
  return {
    calls,
    next() { calls.next++; return value; },
    int(a: number, b: number) {
      calls.int.push([a, b]);
      return a + Math.floor(pick(a, b) * (b - a + 1));
    },
    nextInt(m: number) { calls.nextInt.push(m); return Math.floor(value * m); },
    nextIntRange(a: number, b: number) {
      calls.int.push([a, b]);
      return a + Math.floor(pick(a, b) * (b - a + 1));
    },
  };
}

interface SpawnerInternals {
  spawnTileX: number; spawnTileY: number; spawnTileType: number;
  spawnSpider: boolean; hardMode: boolean; dayTime: boolean; surfaceSpawn: boolean;
  deeperThanRockLayer: boolean; waterTile: boolean; underGround: boolean;
  spawnArmedZombies: boolean; zombieStyle: number; noWorms: boolean; noGroundWorms: boolean;
  ZoneGraveyard: boolean; ZoneSnow: boolean; ZoneJungle: boolean; ZoneCorrupt: boolean;
  ZoneCrimson: boolean; ZoneHallow: boolean; invaders: boolean; shadowCandle: boolean;
  ZoneDungeon: boolean;
  townNoWorms: boolean; spawnFriendlyCycle: boolean;
  spawnAnNPC(rng: unknown): { vanillaId?: number | null; vanillaNetId?: number } | null;
}
const internals = (sp: VanillaSpawner): SpawnerInternals => sp as unknown as SpawnerInternals;

// ===================== N01：具名入参 =====================

describe('issue46-N01 getSpawnRate 具名入参', () => {
  const SURFACE_Y = 1280;   // ty=80：地表带（< groundLevel*16+sHeight=2160）

  const baseOpts = () => ({
    playerYpx: SURFACE_Y,
    nearbySlots: 0,
    waterCandle: false,
    sHeightPx: 1200,
    playerXpx: 100 * TILE,
  });

  it('N01 无效果基线 + 隐身/渔夫套/影子蜡烛四单效果', () => {
    const w = makeRateWorld();
    const sp = new VanillaSpawner(w);
    const base = sp.getSpawnRateNamed(baseOpts());

    // 隐身（Player.invis；1457 NPC.cs:703-710）×1.2 / ×0.8
    const invis = sp.getSpawnRateNamed({ ...baseOpts(), invisibility: true });
    expect(invis.spawnRate).toBe(Math.floor(base.spawnRate * 1.2));
    expect(invis.maxSpawns).toBe(Math.floor(base.maxSpawns * 0.8));

    // 渔夫套（1457 NPC.cs:718-721）×1.3 / ×0.7
    const angler = sp.getSpawnRateNamed({ ...baseOpts(), anglerSetSpawnReduction: true });
    expect(angler.spawnRate).toBe(Math.floor(base.spawnRate * 1.3));
    expect(angler.maxSpawns).toBe(Math.floor(base.maxSpawns * 0.7));

    // 影子蜡烛（非丛林）不改进速率——但它必须落进 shadowCandle 字段
    const shadow = sp.getSpawnRateNamed({ ...baseOpts(), zoneShadowCandle: true });
    expect(shadow).toEqual(base);
    expect(internals(sp).shadowCandle).toBe(true);
  });

  it('N01 效果字段身份：隐身不得污染 shadowCandle 字段', () => {
    const w = makeRateWorld();
    const sp = new VanillaSpawner(w);
    internals(sp).shadowCandle = false;
    sp.getSpawnRateNamed({ ...baseOpts(), invisibility: true, zoneShadowCandle: false });
    expect(internals(sp).shadowCandle).toBe(false);   // 旧错位下 Invisibility 会写进此字段
    sp.getSpawnRateNamed({ ...baseOpts(), invisibility: false, zoneShadowCandle: true });
    expect(internals(sp).shadowCandle).toBe(true);
  });

  it('N01 影子蜡烛丛林覆写：清 noWorms/noGroundWorms（1457 NPC.cs:420-425），隐身不触发', () => {
    const w = makeRateWorld();
    const st = w.store;
    // 玩家中心 ±84×±61 扫描窗内铺 ≥140 丛林草 → zoneJungle
    const JUNGLE = TILE_BY_KEY['v_60_jungle_grass_block'];
    for (let y = 50; y <= 70; y++) for (let x = 80; x <= 140; x++) st.setTileSilent(x, y, JUNGLE);
    const sp = new VanillaSpawner(w);

    internals(sp).noWorms = true;
    internals(sp).noGroundWorms = true;
    sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 1, invisibility: true, zoneShadowCandle: false });
    expect(internals(sp).noWorms).toBe(true);          // 隐身不吃影子蜡烛覆写
    expect(internals(sp).noGroundWorms).toBe(true);

    sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 1, invisibility: false, zoneShadowCandle: true });
    expect(internals(sp).noWorms).toBe(false);         // 真影子蜡烛才清
    expect(internals(sp).noGroundWorms).toBe(false);
  });

  // ★issue#46 N01 红队补锁（2026-11-03）：三连写是**全局**语句（NPC.cs:420-427），
  //  旧实现嵌在 `else if (zoneJungle)` 内 → 非丛林影子蜡烛完全无效（照出小动物/
  //  照置 townNoWorms）。这两条锁的是「非丛林也生效」与「丛林内与城镇阶梯叠加」。
  it('N01 影子蜡烛全局作用域：非丛林同样清 noWorms 且关闭友好生物链', () => {
    const w = makeRateWorld();
    const sp = new VanillaSpawner(w);
    // 非丛林地表 + 城镇 1 人：原版友好链会置 townNoWorms 并掷 friendly
    const noCandle = sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 1, zoneShadowCandle: false });
    expect(internals(sp).townNoWorms).toBe(true);
    // 同一场景点亮影子蜡烛 → townNPCs 被改写为 0（:422-427），友好链整段不执行
    internals(sp).noWorms = true;
    internals(sp).noGroundWorms = true;
    const candle = sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 1, zoneShadowCandle: true });
    expect(internals(sp).noWorms).toBe(false);
    expect(internals(sp).noGroundWorms).toBe(false);
    expect(internals(sp).townNoWorms).toBe(false);      // 非丛林旧实现此处恒 true
    expect(internals(sp).spawnFriendlyCycle).toBe(false);
    // 且速率等同「townNPCs=0」档（改写后的 townNPCs），不是城镇 1 人档
    const zero = sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 0 });
    expect(candle).toEqual(zero);
    expect(candle).not.toEqual(noCandle);
  });

  it('N01 丛林 + 影子蜡烛：三连写与城镇阶梯叠加（改写后落 0 档 ×0.4/×1.5）', () => {
    const w = makeRateWorld();
    const st = w.store;
    const JUNGLE = TILE_BY_KEY['v_60_jungle_grass_block'];
    for (let y = 50; y <= 70; y++) for (let x = 80; x <= 140; x++) st.setTileSilent(x, y, JUNGLE);
    const sp = new VanillaSpawner(w);
    const candle = sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 1, zoneShadowCandle: true });
    // 原版 :422 先改写 townNPCs=0，:610-614 再吃 0 档；旧实现两支互斥 → 吃到 1 档
    const town0 = sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 0 });
    const town1 = sp.getSpawnRateNamed({ ...baseOpts(), townNPCs: 1 });
    expect(candle).toEqual(town0);
    expect(candle).not.toEqual(town1);
  });

  it('N01 组合效果：隐身+渔夫套次序叠加（invis→angler，1457 :703/:718 语句序）', () => {
    const w = makeRateWorld();
    const sp = new VanillaSpawner(w);
    const base = sp.getSpawnRateNamed(baseOpts());
    const both = sp.getSpawnRateNamed({ ...baseOpts(), invisibility: true, anglerSetSpawnReduction: true });
    expect(both.spawnRate).toBe(Math.floor(Math.floor(base.spawnRate * 1.2) * 1.3));
    expect(both.maxSpawns).toBe(Math.floor(Math.floor(base.maxSpawns * 0.8) * 0.7));
  });

  it('N01 旧位置序复现（改判史证据）：隐身值喂到 shadowCandle 槽 → 无隐身乘区', () => {
    const w = makeRateWorld();
    const sp = new VanillaSpawner(w);
    const base = sp.getSpawnRateNamed(baseOpts());
    // 旧调用形状：第 14 实参 = Invisibility（形参 shadowCandle）→ 速率不变
    const legacyWrong = sp.getSpawnRate(
      SURFACE_Y, 0, false, 1200, 100 * TILE,
      false, false, false, false, 0, true, false, false,
      true /*旧 Game 在此传 Invisibility*/, false, false);
    expect(legacyWrong).toEqual(base);                  // 事故本相：隐身完全失效
    const named = sp.getSpawnRateNamed({ ...baseOpts(), invisibility: true });
    expect(named).not.toEqual(base);                    // 具名入口恢复 ×1.2/×0.8
  });

  it('N01 Game.ts 结构锁：生产调用走具名入口且三效果字段名正确', () => {
    const src = readFileSync(GAME, 'utf8');
    const s = src.indexOf('getSpawnRateNamed({');
    expect(s).toBeGreaterThanOrEqual(0);
    const call = src.slice(s, src.indexOf('});', s));
    expect(call).toContain('invisibility: p.buffs.has(BuffType.Invisibility)');
    expect(call).toContain('anglerSetSpawnReduction: p.equipStats.anglerSetSpawnReduction');
    expect(call).toContain('zoneShadowCandle: this.scene?.zoneShadowCandle ?? false');
    expect(src).not.toContain('this.vanillaSpawner.getSpawnRate(');
  });
});

// ===================== N02：RNG 闭区间 =====================

describe('issue46-N02 RNG.int 闭区间映射', () => {
  it('N02 Next(N) ↔ int(0,N-1) 边界映射：int(0,2)≡nextInt(3)、int(0,4)≡nextInt(5)', () => {
    // 同种子双流：闭区间 int(0,N-1) 与 C# Next(N) 逐位同映射
    for (const [hi, N] of [[2, 3], [4, 5]] as const) {
      const a = new RNG(1234567);
      const b = new RNG(1234567);
      for (let k = 0; k < 2000; k++) {
        const viaInt = a.int(0, hi);
        const viaNext = b.nextInt(N);
        expect(viaInt).toBe(viaNext);
        expect(viaInt).toBeGreaterThanOrEqual(0);
        expect(viaInt).toBeLessThan(N);
      }
    }
    // 旧写法 int(0,N) = Next(N+1)：多出上界档（血月 2/6、天空盒 1/4 的来源）
    const c = new RNG(999);
    const d = new RNG(999);
    let sawBuggyUpper = false;
    for (let k = 0; k < 3000; k++) {
      const buggy = c.int(0, 5);
      expect(buggy).toBe(d.nextInt(6));
      if (buggy === 5) sawBuggyUpper = true;
    }
    expect(sawBuggyUpper).toBe(true);
  });

  it('N02 血月表：样本 0.35 → 旧 Next(6)=2 落空 / 新 Next(5)=1 进入血僵尸分支', () => {
    const w = new World(400, 800, 42, 'issue46-n02-blood');
    w.groundLevel = 60; w.rockLevel = 120;
    w.clock.timeOfDay = 23 / 24;        // 夜
    w.clock.bloodMoon = true;
    const sp = new VanillaSpawner(w);
    const s = internals(sp);
    s.spawnTileX = 100; s.spawnTileY = 80; s.spawnTileType = 0;
    s.surfaceSpawn = true; s.dayTime = false; s.deeperThanRockLayer = false;
    s.waterTile = false; s.underGround = false; s.ZoneGraveyard = false;
    s.ZoneSnow = s.ZoneJungle = s.ZoneCorrupt = s.ZoneCrimson = s.ZoneHallow = false;
    sp.setPlayerFlags(false, false);

    // 其余掷骰默认样本 0.9（错过各 1/N 门）；仅血月 2/5 门注入 0.35：
    //   旧 int(0,5)=floor(.35×6)=2 → 跳过；新 int(0,4)=floor(.35×5)=1 → 进入 2/5 支。
    //   门后 N(2) 同取 0.9 → 不命中 490 → 交 489 Blood Zombie（issue 表“开区间上界对照”行）。
    const rng = fixedRng(0.9, (a, b) => (a === 0 && (b === 4 || b === 5) ? 0.35 : undefined));
    const out = s.spawnAnNPC(rng as unknown);
    expect(rng.calls.int.some(([a, b]) => a === 0 && (b === 4 || b === 5))).toBe(true);
    expect(out?.vanillaId).toBe(489);                   // 489 Blood Zombie（旧实现落到普通僵尸族）
  });

  it('N02 天空盒表：样本 0.30 → 旧 Next(4)=1 不重掷 / 新 Next(3)=0 重掷 style 4', () => {
    const w = new World(400, 800, 42, 'issue46-n02-sky');
    w.groundLevel = 60; w.rockLevel = 120;
    w.clock.timeOfDay = 23 / 24;
    w.skyblockLowTiles = true;          // WorldGen.Skyblock.lowTiles
    w.flags.hardMode = false;
    const sp = new VanillaSpawner(w);
    sp.setPlayerFlags(false, false);
    const s = internals(sp);
    s.spawnTileX = 100; s.spawnTileY = 80; s.spawnTileType = 0;
    s.surfaceSpawn = true; s.dayTime = false;

    const out = s.spawnAnNPC(fixedRng(0.30) as unknown);
    // 入口 GetZombieSettings：Next(7)=2；门 Next(3)==0 命中 → 重掷 Next(3)==0→4
    expect(s.zombieStyle).toBe(4);
    expect(out).toBeTruthy();            // 链继续（不断言具体 id）
  });

  it('N02 同类扩查 SpawnHornet：Next(8) 必须映射为 int(0,7)（1457 NPC.cs:5289）', () => {
    const w = makeRateWorld();
    const sp = new VanillaSpawner(w);
    const s = internals(sp);
    s.spawnTileX = 100; s.spawnTileY = 80; s.spawnTileType = 0;
    const rng = fixedRng(0.99);
    (sp as unknown as { spawnHornet(x: number, y: number, r: unknown): unknown })
      .spawnHornet(100, 80, rng as unknown);
    expect(rng.calls.int[0]).toEqual([0, 7]);           // 旧 int(0,8) 复辟即红
  });
});

// ===================== N13：修剪草入侵豁免 =====================

describe('issue46-N13 修剪草 10% 拒刷门用全局 invasionType', () => {
  /** 1300×600 地表：y=104 整片修剪草（477）地板，玩家在 (650,96)。 */
  function makeMowedWorld(): World {
    const w = new World(1300, 600, 42, 'issue46-n13');
    w.groundLevel = 100;
    w.rockLevel = 200;
    const st = w.store;
    for (let x = 260; x < 1040; x++) {
      st.setTileSilent(x, 104, MOWED_GRASS);
      st.setTileSilent(x, 105, 1 /* dirt */);
    }
    return w;
  }

  /** 固定 Math.random=0.05（<10%）→ 全部门限命中；debugPoolOverride=[1] 保证过门即出怪。 */
  function reachesSelection(invasionType: number, invaders: boolean): boolean {
    const w = makeMowedWorld();
    const sp = new VanillaSpawner(w);
    w.invasionType = invasionType;
    sp.setPlayerFlags(false, false);   // setPlayerFlags 会重置 invaders —— 必须先调用再注入
    sp.invaders = invaders;
    setDebugPool([1]);
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.05);
    try {
      for (let k = 0; k < 400; k++) {
        const e = sp.spawn(650 * TILE + 8, 96 * TILE, new RNG(k * 7919 + 13), 24, 14);
        if (e) { e.dead = true; return true; }
      }
      return false;
    } finally {
      rand.mockRestore();
      setDebugPool(null);
    }
  }

  it('N13 四格：invasionType×invaders（原版只认全局 invasionType<=0）', () => {
    // 全域入侵未开 → 拒（此格也验证管线可产出，排除“找点失败恒 null”伪阴性）
    expect(reachesSelection(0, false)).toBe(false);
    // 全域入侵未开但附近前线代理 true → 原版仍拒；旧实现会错放
    expect(reachesSelection(0, true)).toBe(false);
    // 全域入侵已开、玩家不在前线 → 原版放行；旧实现错拒（issue 表格第二行）
    expect(reachesSelection(1, false)).toBe(true);
    // 全域入侵已开且在前线 → 放行（新旧同）
    expect(reachesSelection(1, true)).toBe(true);
  });
});

// ===================== N12-蜘蛛池：地狱线 =====================

describe('issue46-N12 蜘蛛池用 UnderworldLayer=maxTilesY-200', () => {
  function spiderFixture(spawnTileY: number): { sp: VanillaSpawner; s: SpawnerInternals; w: World } {
    const w = new World(400, 1200, 42, 'issue46-n12');
    w.groundLevel = 100; w.rockLevel = 400;
    w.lavaLine = 906;                    // 生成期熔岩线（TerrainPass），≠ UnderworldLayer=1000
    w.seedFlags.notTheBees = true;
    w.seedFlags.getGoodWorld = true;
    w.seedFlags.tenthAnniversary = false;
    const st = w.store;
    st.wall[st.idx(200, spawnTileY)] = 62;   // 蜘蛛巢墙
    const sp = new VanillaSpawner(w);
    sp.setPlayerFlags(false, false);
    const s = internals(sp);
    s.spawnTileX = 200; s.spawnTileY = spawnTileY; s.spawnTileType = 0;
    s.spawnSpider = false; s.hardMode = false; s.spawnArmedZombies = false;
    s.deeperThanRockLayer = true; s.waterTile = false;
    s.surfaceSpawn = false; s.underGround = false;
    s.ZoneDungeon = false; s.invaders = false;
    s.ZoneSnow = s.ZoneJungle = s.ZoneCorrupt = s.ZoneCrimson = s.ZoneHallow = false;
    return { sp, s, w };
  }

  it('N12 夹具自证：lavaLine(906) ≠ h-200(1000)，Y=950 在洞穴层', () => {
    const { w } = spiderFixture(950);
    expect(w.lavaLine).toBe(906);
    expect(w.underworldLine).toBe(1000);       // 单源 = maxTilesY-200
    expect(w.lavaLine).not.toBe(w.underworldLine);
    expect(950).toBeLessThan(w.underworldLine);
  });

  it('N12 Y=950（lavaLine 与地狱线之间）→ 不触发 1/5 门，出墙爬蛛 164', () => {
    const { s } = spiderFixture(950);
    const out = s.spawnAnNPC(fixedRng(0.99) as unknown);
    expect(out?.vanillaId).toBe(164);
    // 旧实现比较 lavaLine=906 → 误入地狱门（!N(5)）跳过蜘蛛池 → 落到兜底 49
    expect(out?.vanillaId).not.toBe(49);
  });

  it('N12 边界：Y==h-200 受 1/5 门（样本 0.99 落空、样本 0.1 放行）；Y==h-201 恒放行', () => {
    const atLineMiss = spiderFixture(1000);
    expect(atLineMiss.s.spawnAnNPC(fixedRng(0.99) as unknown)?.vanillaId).not.toBe(164);
    const atLineHit = spiderFixture(1000);
    expect(atLineHit.s.spawnAnNPC(fixedRng(0.1) as unknown)?.vanillaId).toBe(164);
    const aboveLine = spiderFixture(999);
    expect(aboveLine.s.spawnAnNPC(fixedRng(0.99) as unknown)?.vanillaId).toBe(164);
  });

  it('N12/D-C-4 结构锁：地狱线判据单源 world.underworldLine（gem 松鼠/兔 + 双地牢粒子门）', () => {
    const game = readFileSync(GAME, 'utf8');
    // 雨天 gem 分支与宝石小动物主路径的 `y <= UnderworldLayer`（NPC.cs:2381 / :2557-2562）
    expect(game).toContain('groundY <= underworldT');
    expect(game).toContain('groundY <= this.world.underworldLine');
    // 负向锁只打这两处上下文（Game.ts 另有 voodoo 娃娃 `lavaLine || st.h-200` 为在册债，
    // 不在此刀域内——见 D-C-4 残余项，故不对全文件做裸 not.toContain）
    expect(game).not.toContain('groundY <= (this.world.lavaLine');
    // 双地牢 InScreenDungeonSpawn 门（NPC.cs:5265-5273）——像素域严格 <
    const spawner = readFileSync(SPAWNER, 'utf8');
    expect(spawner).toContain('y < w_.underworldLine * TILE');
    expect(spawner).not.toContain('w_.lavaLine * TILE');
  });
});

// ===================== 变异恰红（withMutation，仅 VanillaSpawner.ts） =====================

describe.skipIf(process.env.SW_ISSUE46C_MUT)('issue46-C 变异恰红', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/issue46-spawn-domain.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_ISSUE46C_MUT: '1' },
    });
  const mutate = (trigger: string, replacement: string, filter: string): void => {
    withMutation(SPAWNER, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `issue46-C ${filter}` });
  };

  it('M0 对照：无变异时目标测试必须绿（排除 no-test-found 伪红）', () => {
    // 绿跑不打印测试名，故只断言 status=0；红跑失败摘要会打印名字（M1-M6 的
    // stdout.toContain(filter) 因此同时证明「是目标测试红的」）。
    const r = spawnVitest('N01 无效果基线');
    expect(r.status, r.stderr).toBe(0);
  });

  it('M1 N01 隐身乘区错接到影子蜡烛 → 隐形单效果测试红', () => {
    mutate(
      '    if (invisibility) {\n      spawnRate = Math.floor(spawnRate * 1.2);',
      '    if (zoneShadowCandle) { // ★issue46-C M1 变异：隐身乘区错接\n      spawnRate = Math.floor(spawnRate * 1.2);',
      'N01 无效果基线');
  });

  it('M2 N02 血月门回退 Next(6) → 血月表测试红', () => {
    mutate(
      'if (clock.bloodMoon && rng.int(0, 4) < 2) return D(N(2) ? 490 : 489);',
      'if (clock.bloodMoon && rng.int(0, 5) < 2) return D(N(2) ? 490 : 489); // ★issue46-C M2 变异',
      'N02 血月表');
  });

  it('M3 N02 天空盒重掷门回退 Next(4) → 天空盒表测试红', () => {
    mutate(
      '      && this.zombieStyle !== 4 && this.zombieStyle !== 5 && rng.int(0, 2) === 0) {\n      this.zombieStyle = rng.int(0, 2) === 0 ? 4 : 5;',
      '      && this.zombieStyle !== 4 && this.zombieStyle !== 5 && rng.int(0, 3) === 0) { // ★issue46-C M3 变异\n      this.zombieStyle = rng.int(0, 3) === 0 ? 4 : 5;',
      'N02 天空盒表');
  });

  it('M4 N02 蜂刺族选表回退 Next(9) → SpawnHornet 映射锁红', () => {
    mutate(
      '  private spawnHornet(x: number, y: number, rng: RNG): Enemy | null {\n    const v = rng.int(0, 7);',
      '  private spawnHornet(x: number, y: number, rng: RNG): Enemy | null {\n    const v = rng.int(0, 8); // ★issue46-C M4 变异',
      'N02 同类扩查 SpawnHornet');
  });

  it('M5 N13 修剪草门回退近前线代理 → 四格测试红', () => {
    mutate(
      '&& !this.world.clock.eclipse && this.world.invasionType <= 0',
      '&& !this.world.clock.eclipse && !this.invaders // ★issue46-C M5 变异',
      'N13 四格');
  });

  it('M6 N12 蜘蛛池门回退 lavaLine → Y=950 测试红', () => {
    mutate(
      '&& this.spawnTileY >= this.world.underworldLine && !N(5));',
      '&& this.spawnTileY >= this.world.lavaLine && !N(5)); // ★issue46-C M6 变异',
      'N12 Y=950');
  });

  it('M7 N01 覆盖门退回丛林专属 → 全局作用域锁红', () => {
    // 精确复现红队定谳的旧形状：三连写只对丛林生效（原版 :420-427 无条件）
    mutate(
      '    if (zoneShadowCandle) { townNPCs = 0; this.noWorms = false; this.noGroundWorms = false; }',
      '    if (zoneShadowCandle && zoneJungle) { townNPCs = 0; this.noWorms = false; this.noGroundWorms = false; } // ★issue46-C M7 变异',
      'N01 影子蜡烛全局作用域');
  });
});
