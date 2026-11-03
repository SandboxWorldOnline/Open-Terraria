// issue #46 刀 D —— 掉落 / 进度簇六项（N03, N11, N15, N16, N17, N12-活火块）。
//
// 原版锚（Terarria1457，逐条亲读重锚；issue 给的 1.4.5.8 第三方行号已漂移）：
//  · N03 NPC.cs:18178-18201 ScaleStats 每次现场读 `Main.hardMode`（:18183）；
//        NPC.cs:18545-18593 ScaleStats_ForExpertHardmode 现场读 `downedPlantBoss`（:18578）。
//  · N11 Main.cs:3003 `WindyEnoughForKiteDrops => Math.Abs(windSpeedTarget) >= _maxWind`；
//        :67637 `_maxWind = 0.4f`；Conditions.cs:1246-1252 直接消费。
//  · N15 NPC.cs:18528-18543 GetActivePlayerCount（netMode==0 恒 1；否则 active && !ghost）；
//        :18599-18602 克眼 type 4 吃 balance；:18756-18771 GetStatScalingFactors。
//  · N16 NPC.cs:79689-79706 补偿分支（IsNPCValidForBestiaryKillCredit 门内）+
//        :80375-80434 五实现；石巨人 245 走 lowTiles 且**不清 noTemple**。
//  · N17 Conditions.cs:825-871 SoulOfLight/Night 读 `info.player.Zone*`（= NPCLoot
//        closestPlayer，非房主）；:1574-1608 SoulOfWhateverConditionCanDrop。
//  · N12 Conditions.cs:935-944 LivingFlames `npc.position.Y/16f > Main.UnderworldLayer`
//        （严格 >）；Main.cs:2886 `UnderworldLayer => maxTilesY - 200`。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { withMutation } from './mutation-guard';
import { World } from '../src/world/World';
import { Achievements } from '../src/core/Achievements';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { Game } from '../src/core/Game';
import {
  bindScaleStatsWorld, scaleStatsWorldOf, CLASSIC_SCALE_WORLD, GDL,
} from '../src/stats/ScaleStats';
import {
  resolveDrops, rollSkyblockCompensation, pickClosestLootPlayer,
  type NpcDropCtx, type DropExtras,
} from '../src/drops/NpcDrops';
import { VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import { EMPTY_SCENE, scanScene, type SceneFlags } from '../src/world/SceneMetrics';
import { RNG } from '../src/core/rng';
import type { LootPlayerCtx } from '../src/entities/types';
import type { SkyblockFlags } from '../src/world/SkyblockRuntime';

const TILE = 16;

afterEach(() => { bindScaleStatsWorld(null); });

// ===========================================================================
// N03 — 世界进度缩放上下文实时化（hardMode / downedPlantBoss live getter）
// ===========================================================================
describe('issue#46 N03 进度缩放上下文快照化', () => {
  it('专家蓝史莱姆（NPC 1）三态：肉前(50,14,2) / 困难世花前(274,62,10) / 世花后(330,74,12)', () => {
    const w = new World(400, 400, 7, 'n03');
    w.difficulty = 1;                    // World.difficulty 1 = 专家（0 经典 / 1 专家 / 2 大师）
    w.flags.hardMode = false;
    w.flags['downed_262'] = false;
    bindScaleStatsWorld(scaleStatsWorldOf(w, () => false));
    const read = () => {
      const e = Enemy.fromVanilla(1, 100 * TILE, 100 * TILE)!;
      return [e.maxHp, e.def.damage, e.def.defense];
    };
    expect(read()).toEqual([50, 14, 2]);          // 肉前
    // ★同一绑定、同一会话内推进世界进度——不得重绑、不得重新读档
    w.flags.hardMode = true;
    expect(read()).toEqual([274, 62, 10]);        // 困难、世花前（ExpertHardmode 阈值 80）
    w.flags['downed_262'] = true;
    expect(read()).toEqual([330, 74, 12]);        // 世花后（阈值 100）
    // 回退同样即时（不是单向快照）
    w.flags.hardMode = false;
    w.flags['downed_262'] = false;
    expect(read()).toEqual([50, 14, 2]);
  });

  it('钱币价值随同一上下文（NPCLoot_DropMoney 的 value 已缩放）', () => {
    const w = new World(400, 400, 7, 'n03b');
    w.difficulty = 1;
    w.flags.hardMode = false;
    bindScaleStatsWorld(scaleStatsWorldOf(w, () => false));
    const v0 = Enemy.fromVanilla(1, 0, 0)!.def.value;
    w.flags.hardMode = true;
    const v1 = Enemy.fromVanilla(1, 0, 0)!.def.value;
    expect(v0).toBe(62);
    expect(v1).toBe(250);
  });

  it('结构锁：scaleStatsWorldOf 三项均为 live getter（防回退成读档快照）', () => {
    const text = readFileSync(new URL('../src/stats/ScaleStats.ts', import.meta.url), 'utf8');
    expect(text).toContain('get hardMode() { return !!world.flags?.hardMode; }');
    expect(text).toContain("get downedPlantBoss() { return !!world.flags?.['downed_262']; }");
    expect(text).toContain('get activePlayerCount() { return activePlayerCount ? activePlayerCount() : 1; }');
  });
});

// ===========================================================================
// N11 — 风筝掉落风门（windSpeedTarget >= 0.4）
// ===========================================================================
function mkDropGame(world: World, scene: SceneFlags = { ...EMPTY_SCENE }) {
  return { scene, world, net: null } as unknown as Game;
}

describe('issue#46 N11 风筝掉落风门', () => {
  const windyOf = (target: number, current: number): boolean => {
    const w = new World(200, 200, 7, 'n11');
    w.weather.windSpeedTarget = target;
    w.weather.windSpeedCurrent = current;
    return Game.prototype.dropContext.call(mkDropGame(w)).windy;
  };

  it('target/current 三段表：0.45/0.45 开、0.6/0.6 开、0/0.6 关', () => {
    expect(windyOf(0.45, 0.45)).toBe(true);    // 旧实现（current>0.5）漏发
    expect(windyOf(0.6, 0.6)).toBe(true);
    expect(windyOf(0, 0.6)).toBe(false);       // 旧实现（current>0.5）错发
  });

  it('阈值边界 >=0.4（Main.cs:3003）：0.4 开 / 0.3999 关 / 负向取绝对值', () => {
    expect(windyOf(0.4, 0)).toBe(true);
    expect(windyOf(0.3999, 0)).toBe(false);
    expect(windyOf(-0.4, 0)).toBe(true);
    expect(windyOf(-0.3999, 0)).toBe(false);
  });

  it('current 不参与判定（回落/追随途中的假阳性根除）', () => {
    expect(windyOf(0.1, 0.9)).toBe(false);
    expect(windyOf(0.9, 0.1)).toBe(true);
  });

  it('结构锁：判据单源在 NpcDrops 纯函数，Game 只注入 target', () => {
    const npc = readFileSync(new URL('../src/drops/NpcDrops.ts', import.meta.url), 'utf8');
    expect(npc).toContain('return Math.abs(windSpeedTarget) >= 0.4;');
    const text = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    expect(text).toContain('windy: windyEnoughForKiteDrops(this.world.weather.windSpeedTarget),');
    expect(text).not.toContain('windSpeedCurrent) > 0.5');
  });
});

// ===========================================================================
// N15 — 多人 Boss 血量缩放（activePlayerCount live getter）
// ===========================================================================
describe('issue#46 N15 多人 Boss 血量', () => {
  it('克眼（NPC 4）活跃玩家 1/2/3 → maxHP 3640/4914/6977', () => {
    const w = new World(400, 400, 7, 'n15');
    w.difficulty = 1;
    const hp = (n: number) => {
      bindScaleStatsWorld(scaleStatsWorldOf(w, () => false, () => n));
      return Enemy.fromVanilla(4, 100 * TILE, 100 * TILE)!.maxHp;
    };
    expect(hp(1)).toBe(3640);
    expect(hp(2)).toBe(4914);     // balance 1.35
    expect(hp(3)).toBe(6977);     // balance 1.91666…→ roundCS
  });

  it('经典档不吃人数缩放（原版只在 difficulty>=Expert 调 ByPlayerCount）', () => {
    const w = new World(400, 400, 7, 'n15b');
    w.difficulty = 0;
    const hp = (n: number) => {
      bindScaleStatsWorld(scaleStatsWorldOf(w, () => false, () => n));
      return Enemy.fromVanilla(4, 100 * TILE, 100 * TILE)!.maxHp;
    };
    expect(hp(1)).toBe(hp(3));
  });

  it('GetActivePlayerCount 1:1：单机恒 1；联机统计 active 且非 ghost 槽', () => {
    const world = new World(100, 100, 7, 'n15c');
    const mkPlayer = (ghost: boolean): Player => {
      const p = new Player(0, 0, new Inventory());
      if (ghost) {
        p.dead = true;
        p.appearance = { ...(p.appearance ?? {}), difficulty: 2 } as NonNullable<Player['appearance']>;   // 硬核
        p.baseMaxHp = 0;
        p.respawnTimer = 0;
        expect(p.isGhostPhase(world)).toBe(true);
      }
      return p;
    };
    const mkFake = (player: Player, remotes: Array<[number, boolean]>) => ({
      world, player,
      net: { active: true, mySlot: 0, players: new Map(remotes.map(([slot, active]) => [slot, { active }])) },
    }) as unknown as Game;

    // 单机：net 未激活 → 恒 1
    expect(Game.prototype.activePlayerCountForScale.call(
      { world, player: mkPlayer(false), net: null } as unknown as Game)).toBe(1);
    // 联机 1/2/3 活跃
    expect(Game.prototype.activePlayerCountForScale.call(mkFake(mkPlayer(false), []))).toBe(1);
    expect(Game.prototype.activePlayerCountForScale.call(mkFake(mkPlayer(false), [[1, true]]))).toBe(2);
    expect(Game.prototype.activePlayerCountForScale.call(mkFake(mkPlayer(false), [[1, true], [2, true]]))).toBe(3);
    // ghost 不计：本地硬核幽灵 + 2 活跃 = 2
    expect(Game.prototype.activePlayerCountForScale.call(mkFake(mkPlayer(true), [[1, true], [2, true]]))).toBe(2);
    // 未激活远端不计
    expect(Game.prototype.activePlayerCountForScale.call(mkFake(mkPlayer(false), [[1, true], [2, false]]))).toBe(2);
  });

  it('结构锁：Game 绑定注入 live 玩家数源（Enemy.ts 消费点零改）', () => {
    const text = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    expect(text).toContain('() => this.activePlayerCountForScale()));');
    expect(text).toContain('activePlayerCountForScale(): number {');
  });
});

// ===========================================================================
// N16 — 缺结构世界 Boss 补偿掉落 + 清旗
// ===========================================================================
type Spawned = { vid: number; n: number };

function keyToVid(key: string): number {
  for (const [vid, k] of Object.entries(VANILLA_ITEM_KEY_BY_ID)) {
    if (k === key) return Number(vid);
  }
  return -1;
}

function mkCompCtx(world: World) {
  const spawned: Spawned[] = [];
  const runtime = { flags: {
    lowTiles: world.skyblockLowTiles, noAltars: world.skyblockNoAltars,
    noDungeon: world.skyblockNoDungeon, noTemple: world.skyblockNoTemple,
    noHellstone: world.skyblockNoHellstone, noFossils: world.skyblockNoFossils,
    noLifeCrystals: world.skyblockNoLifeCrystals, noHellforge: world.skyblockNoHellforge,
  } as SkyblockFlags };
  const game = {
    world, skyblockRuntime: runtime,
    _worldNoAltars: world.skyblockNoAltars,
    spawnDrop: (_x: number, _y: number, key: string, n: number) => {
      spawned.push({ vid: keyToVid(key), n });
      return null;
    },
    clearSkyblockCensus: Game.prototype.clearSkyblockCensus,
  } as unknown as Game;
  return { game, spawned, runtime };
}

function mkEnemy(vanillaId: number, over: Partial<Enemy> = {}): Enemy {
  return {
    vanillaId, killBossFlag: false, spawnedFromStatue: false, netPuppet: false,
    cx: 1000, cy: 2000, ...over,
  } as unknown as Enemy;
}

function mkSkyWorld(flags: Partial<SkyblockFlags>): World {
  const w = new World(400, 400, 7, 'n16');
  w.skyblockLowTiles = !!flags.lowTiles;
  w.skyblockNoAltars = !!flags.noAltars;
  w.skyblockNoDungeon = !!flags.noDungeon;
  w.skyblockNoTemple = !!flags.noTemple;
  w.skyblockNoHellforge = !!flags.noHellforge;
  return w;
}

describe('issue#46 N16 缺结构补偿掉落', () => {
  it('克眼 4 + noAltars：腐化 5532 / 猩红 5533，并清 noAltars（清运行时旗+投影）', () => {
    const w = mkSkyWorld({ noAltars: true });
    const { game, spawned, runtime } = mkCompCtx(w);
    Game.prototype.skyblockBossCompensation.call(game, mkEnemy(4));
    expect(spawned).toEqual([{ vid: 5532, n: 1 }]);
    expect(w.skyblockNoAltars).toBe(false);
    expect(runtime.flags.noAltars).toBe(false);
    expect((game as unknown as { _worldNoAltars: boolean })._worldNoAltars).toBe(false);

    const wc = mkSkyWorld({ noAltars: true });
    wc.crimson = true;
    const cc = mkCompCtx(wc);
    Game.prototype.skyblockBossCompensation.call(cc.game, mkEnemy(4));
    expect(cc.spawned).toEqual([{ vid: 5533, n: 1 }]);
  });

  it('骷髅王 35 + noHellforge：221 并清 noHellforge', () => {
    const w = mkSkyWorld({ noHellforge: true });
    const { game, spawned, runtime } = mkCompCtx(w);
    Game.prototype.skyblockBossCompensation.call(game, mkEnemy(35));
    expect(spawned).toEqual([{ vid: 221, n: 1 }]);
    expect(w.skyblockNoHellforge).toBe(false);
    expect(runtime.flags.noHellforge).toBe(false);
  });

  it('克脑 266 + noDungeon：砖×500-600 + 墙×400-500 三件一组，并清 noDungeon', () => {
    const w = mkSkyWorld({ noDungeon: true });
    const { game, spawned, runtime } = mkCompCtx(w);
    Game.prototype.skyblockBossCompensation.call(game, mkEnemy(266));
    expect(spawned.length).toBe(4);
    // 三色组：{134,5365,5367,5366} / {137,5371,5373,5372} / {139,5368,5370,5369}
    const groups = [
      [134, 5365, 5367, 5366], [137, 5371, 5373, 5372], [139, 5368, 5370, 5369],
    ];
    expect(groups.some((g) => g.every((id) => spawned.some((s) => s.vid === id)))).toBe(true);
    const brick = spawned.find((s) => s.vid === 134 || s.vid === 137 || s.vid === 139)!;
    expect(brick.n).toBeGreaterThanOrEqual(500);
    expect(brick.n).toBeLessThanOrEqual(600);
    for (const s of spawned.filter((x) => x !== brick)) {
      expect(s.n).toBeGreaterThanOrEqual(400);
      expect(s.n).toBeLessThanOrEqual(500);
    }
    expect(w.skyblockNoDungeon).toBe(false);
    expect(runtime.flags.noDungeon).toBe(false);
  });

  it('世吞三段同源（13/14/15 需 boss 实例旗）：中间段不掉', () => {
    const w = mkSkyWorld({ noDungeon: true });
    const { game, spawned } = mkCompCtx(w);
    Game.prototype.skyblockBossCompensation.call(game, mkEnemy(13));
    expect(spawned).toEqual([]);                      // IsNPCValidForBestiaryKillCredit(13,false)=false
    Game.prototype.skyblockBossCompensation.call(game, mkEnemy(13, { killBossFlag: true }));
    expect(spawned.length).toBe(4);
  });

  it('世花 262 + noTemple：1294、1292、1101×500-600、5376×1200-1500，并清 noTemple', () => {
    const w = mkSkyWorld({ noTemple: true });
    const { game, spawned, runtime } = mkCompCtx(w);
    Game.prototype.skyblockBossCompensation.call(game, mkEnemy(262));
    expect(spawned.map((s) => s.vid).sort((a, b) => a - b)).toEqual([1101, 1292, 1294, 5376].sort((a, b) => a - b));
    const b = spawned.find((s) => s.vid === 1101)!;
    const wall = spawned.find((s) => s.vid === 5376)!;
    expect(b.n).toBeGreaterThanOrEqual(500); expect(b.n).toBeLessThanOrEqual(600);
    expect(wall.n).toBeGreaterThanOrEqual(1200); expect(wall.n).toBeLessThanOrEqual(1500);
    expect(w.skyblockNoTemple).toBe(false);
    expect(runtime.flags.noTemple).toBe(false);
  });

  it('石巨人 245 + lowTiles：机关材料×5-10，且**不清 noTemple**（原版 :80401-80406 负控）', () => {
    const w = mkSkyWorld({ lowTiles: true, noTemple: true });
    const { game, spawned, runtime } = mkCompCtx(w);
    Game.prototype.skyblockBossCompensation.call(game, mkEnemy(245));
    expect(spawned.length).toBe(1);
    expect([1146, 1149]).toContain(spawned[0].vid);   // 反编译平铺：0→1149 / 非0→1146
    expect(spawned[0].n).toBeGreaterThanOrEqual(5);
    expect(spawned[0].n).toBeLessThanOrEqual(10);
    expect(w.skyblockNoTemple).toBe(true);            // ★负控：不清旗
    expect(runtime.flags.noTemple).toBe(true);
  });

  it('门：结构在场不掉 / 雕像产怪照发（双门不相交）/ netPuppet 不结算 / 无交互仍掉', () => {
    const none = mkCompCtx(mkSkyWorld({}));
    Game.prototype.skyblockBossCompensation.call(none.game, mkEnemy(4));
    expect(none.spawned).toEqual([]);

    // ★issue#46 N16 红队勘正（2026-11-03）：原版雕像门是条件式双门
    // （NPC.cs:79662）——`NoEarlymodeLootWhenSpawnedFromStatue[type]`
    // （NPCID.cs:4801={480,82,86,170,180,171}）或 `StatueSpawnedDropRarity[type]!=-1`
    // （NPCID.cs:4797）。本补偿覆盖集 {4,13,14,15,266,35,262,245} 与两表均不相交
    // → 雕像产的同型怪在原版**照走**补偿分支。旧断言「雕像产怪不掉」是错误前提。
    // （vanilla 雕像表不含 Boss，正常流程不可达；此处锁的是域边界而非玩法。）
    const statue = mkCompCtx(mkSkyWorld({ noAltars: true }));
    Game.prototype.skyblockBossCompensation.call(statue.game, mkEnemy(4, { spawnedFromStatue: true }));
    expect(statue.spawned.length).toBe(1);
    expect([5532, 5533]).toContain(statue.spawned[0].vid);   // 便携祭坛（腐化/猩红）

    const puppet = mkCompCtx(mkSkyWorld({ noAltars: true }));
    Game.prototype.skyblockBossCompensation.call(puppet.game, mkEnemy(4, { netPuppet: true }));
    expect(puppet.spawned).toEqual([]);

    // 原版补偿分支在 GetWereThereAnyInteractions 之外（NPC.cs:79689 与 :79655 异门）
    const noInteract = mkCompCtx(mkSkyWorld({ noAltars: true }));
    Game.prototype.skyblockBossCompensation.call(noInteract.game, mkEnemy(4, { playerInteracted: false }));
    expect(noInteract.spawned.length).toBe(1);
  });

  it('端到端：真实 Game.onEnemyKilled 死亡口径发放补偿（克眼 4 + noAltars，清旗落 World）', () => {
    const w = new World(200, 200, 6, 'n16e2e');
    w.skyblockNoAltars = true;
    const spawned: Array<{ key: string; n: number }> = [];
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    g.world = w;
    g.achievements = new Achievements(null);
    g.entities = { enemies: [], npcs: [], projectiles: [], add: () => null };
    g.player = { lastCreatureHit: -1, maxHp: 100, maxMana: 20 };
    g.skyblockRuntime = { flags: { noAltars: true, noDungeon: false, noTemple: false, noHellforge: false, lowTiles: false } };
    g._worldNoAltars = true;
    g.spawnDrop = (_x: number, _y: number, key: string, n: number) => {
      spawned.push({ key, n }); return null;
    };
    const e = Enemy.fromVanilla(4, 100 * TILE, 100 * TILE)!;
    e.playerInteracted = true;   // 走完整死亡记账链（成就/图鉴块也过一遍）
    (g as unknown as { onEnemyKilled(k: string, e: Enemy): void }).onEnemyKilled('vi_4', e);
    expect(spawned).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[5532], n: 1 }]);
    expect(w.skyblockNoAltars).toBe(false);
    expect((g.skyblockRuntime as { flags: Record<string, boolean> }).flags.noAltars).toBe(false);
  });

  it('结构锁：onEnemyKilled 死亡结算口接线 + noHellforge 双投影在位', () => {
    const text = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    expect(text).toContain('if (enemy) this.skyblockBossCompensation(enemy);');
    expect(text).toContain('w.skyblockNoHellforge = sbf.noHellforge;');
    expect(text).toContain('this.world.skyblockNoHellforge = f.noHellforge;');
    expect(text).toContain('const plan = rollSkyblockCompensation({');
    // 原版 :79699 是 35+noHellforge，:79703 是 262+noTemple，:79701 是 245+lowTiles
    const npc = readFileSync(new URL('../src/drops/NpcDrops.ts', import.meta.url), 'utf8');
    expect(npc).toContain('if (s.type === 35 && s.noHellforge) {');
    expect(npc).toContain('if (s.type === 262 && s.noTemple) {');
    expect(npc).toContain('if (s.type === 245 && s.lowTiles) {');
    expect(npc).toContain("drop(next(0, 4) === 0 ? 1149 : 1146, next(5, 11));");
  });

  it('纯函数表：注入 rand 的确定性检查（分组/数量上下界/清旗集合）', () => {
    const base = {
      type: 0, crimson: false, noAltars: false, noDungeon: false,
      noTemple: false, noHellforge: false, lowTiles: false,
    };
    // 克眼：5532/5533 二选一 + clear=['noAltars']
    expect(rollSkyblockCompensation({ ...base, type: 4, noAltars: true }, () => 0))
      .toEqual({ drops: [{ id: 5532, n: 1 }], clear: ['noAltars'] });
    expect(rollSkyblockCompensation({ ...base, type: 4, noAltars: true, crimson: true }, () => 0))
      .toEqual({ drops: [{ id: 5533, n: 1 }], clear: ['noAltars'] });
    // rand=0 → 组 0：134×500 + 5365/5367/5366×400（Next 上界开）
    expect(rollSkyblockCompensation({ ...base, type: 266, noDungeon: true }, () => 0))
      .toEqual({
        drops: [{ id: 134, n: 500 }, { id: 5365, n: 400 }, { id: 5367, n: 400 }, { id: 5366, n: 400 }],
        clear: ['noDungeon'],
      });
    // rand→0.999… → 组 default：139×600 + 5368/5370/5369×500
    expect(rollSkyblockCompensation({ ...base, type: 13, noDungeon: true }, () => 0.999999))
      .toEqual({
        drops: [{ id: 139, n: 600 }, { id: 5368, n: 500 }, { id: 5370, n: 500 }, { id: 5369, n: 500 }],
        clear: ['noDungeon'],
      });
    // rand=0.5 → 组 1：137×550 + 5371/5373/5372×450
    expect(rollSkyblockCompensation({ ...base, type: 14, noDungeon: true }, () => 0.5))
      .toEqual({
        drops: [{ id: 137, n: 550 }, { id: 5371, n: 450 }, { id: 5373, n: 450 }, { id: 5372, n: 450 }],
        clear: ['noDungeon'],
      });
    // 石巨人：lowTiles 触发；noTemple 单独不触发；clear 恒空（★负控）
    expect(rollSkyblockCompensation({ ...base, type: 245, noTemple: true }, () => 0))
      .toEqual({ drops: [], clear: [] });
    const golem = rollSkyblockCompensation(
      { ...base, type: 245, lowTiles: true, noTemple: true }, () => 0);
    expect(golem.clear).toEqual([]);
    expect(golem.drops).toEqual([{ id: 1149, n: 5 }]);
    expect(rollSkyblockCompensation({ ...base, type: 245, lowTiles: true }, () => 0.99).drops)
      .toEqual([{ id: 1146, n: 10 }]);
  });
});

// ===========================================================================
// N17 — 群系掉落读最近结算玩家的 zone
// ===========================================================================
const PEARLSTONE = TILE_INTERNAL_BY_SHEET.get(117)!;

/** 在 (tx,ty) 周围铺 13×13 珍珠岩 = 169 格 ≥ HALLOW_THRESHOLD(125) → zoneHallow */
function paintHallow(w: World, tx: number, ty: number): void {
  for (let y = ty - 6; y <= ty + 6; y++) {
    for (let x = tx - 6; x <= tx + 6; x++) w.store.setTile(x, y, PEARLSTONE);
  }
}

function lootCtx(slot: number, cx: number, cy: number): LootPlayerCtx {
  return {
    slot, x: cx, y: cy, dead: false, luck: 0, hp: 100, hpMax: 100,
    mana: 20, manaMax: 20, interacting: true,
  };
}

function extrasOf(world: World, hostScene: SceneFlags, net: { active: boolean; mySlot: number } | null,
  who: LootPlayerCtx | null): DropExtras {
  const fake = { scene: hostScene, world, net } as unknown as Game;
  return Game.prototype.dropContext.call(fake, who);
}

describe('issue#46 N17 群系掉落读最近玩家', () => {
  it('房主/最近访客四格表：光明魂只随访客（最近玩家）群系', () => {
    const w = new World(400, 400, 7, 'n17');
    w.groundLevel = 100; w.rockLevel = 120; w.difficulty = 1;
    w.flags.hardMode = true;
    const hostTile = { x: 60, y: 300 };     // 房主（无神圣）
    const guestTile = { x: 300, y: 300 };   // 最近访客（铺神圣）
    paintHallow(w, guestTile.x, guestTile.y);
    // 真实扫描自证：访客位 zoneHallow=true，房主位 false
    const gScan = scanScene(w, guestTile.x * TILE, guestTile.y * TILE, 0);
    const hScan = scanScene(w, hostTile.x * TILE, hostTile.y * TILE, 0);
    expect(gScan.zoneHallow).toBe(true);
    expect(hScan.zoneHallow).toBe(false);

    const hostHallow = (b: boolean): SceneFlags => ({ ...EMPTY_SCENE, zoneHallow: b });
    const net = { active: true, mySlot: 0 };
    const guest = lootCtx(1, guestTile.x * TILE, guestTile.y * TILE);
    const souls = (host: boolean, visitorHallow: boolean): number => {
      // 访客位固定铺神圣；"visitorHallow=false" 用远端的另一个无神圣坐标
      const who = { ...guest, x: visitorHallow ? guest.x : hostTile.x * TILE, y: visitorHallow ? guest.y : hostTile.y * TILE };
      const ex = extrasOf(w, hostHallow(host), net, who);
      expect(ex.zoneHallow).toBe(visitorHallow);   // extras 只取最近玩家位，房主 scene 不参与
      let n = 0;
      for (let seed = 0; seed < 120; seed++) {
        const res = resolveDrops(mkSoulCtx(seed, ex));
        n += res.drops.filter((d) => d.id === 520).length;
      }
      return n;
    };
    // 四格：房主神圣 / 最近访客神圣
    expect(souls(false, true)).toBeGreaterThan(0);   // 原版允许（旧实现 0）
    expect(souls(true, false)).toBe(0);              // 原版拒绝（旧实现错发）
    expect(souls(false, false)).toBe(0);
    expect(souls(true, true)).toBeGreaterThan(0);
  });

  it('单机（lootPlayers 缺席 → who=null）仍走房主 scene 快路', () => {
    const w = new World(200, 200, 7, 'n17b');
    const ex = extrasOf(w, { ...EMPTY_SCENE, zoneHallow: true }, null, null);
    expect(ex.zoneHallow).toBe(true);
    const ex2 = extrasOf(w, { ...EMPTY_SCENE, zoneCrimson: true }, { active: true, mySlot: 0 }, null);
    expect(ex2.zoneCrimson).toBe(true);
  });

  it('本端槽（slot===mySlot）仍用本地 scene，不做重复扫描', () => {
    const w = new World(200, 200, 7, 'n17c');
    const self = lootCtx(0, 100 * TILE, 100 * TILE);
    const ex = extrasOf(w, { ...EMPTY_SCENE, zoneJungle: true }, { active: true, mySlot: 0 }, self);
    expect(ex.zoneJungle).toBe(true);
  });

  it('结构锁：dropContext 接受最近玩家并据槽分派', () => {
    const text = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    expect(text).toContain('dropContext(who?: LootPlayerCtx | null): DropExtras {');
    expect(text).toContain('const s = remote ? scanScene(this.world, remote.x, remote.y, 0) : this.scene;');
  });
});

// ★issue#46 N17 红队补锁（2026-11-03）：原版 Player.FindClosest（Player.cs:4934-4958）
//  是「先取最小槽位 active（含 dead）→ 槽位升序严格 < 取最近存活者 → 全员死亡返回前者」
//  两步式。旧 Enemy 侧按 lootPlayers 的 [本地, …插入序] 直接遍历，等距破缺反了、
//  全员死亡时返回 null（→ dropContext 回落房主 scene）。
describe('issue#46 N17 最近玩家选择（Player.FindClosest 1:1）', () => {
  const P = (slot: number, x: number, y: number, dead = false): LootPlayerCtx => ({
    slot, x, y, dead, luck: slot, hp: 100, hpMax: 100, mana: 20, manaMax: 20, interacting: true,
  });

  it('最近存活者胜出，与数组排列无关（lootPlayers 是本地优先插入序）', () => {
    const near = P(3, 100, 100);
    const far = P(0, 9000, 9000);
    expect(pickClosestLootPlayer([far, near], 0, 0)).toBe(near);
    expect(pickClosestLootPlayer([near, far], 0, 0)).toBe(near);
  });

  it('等距 → 低槽胜出（原版槽位升序 + 严格 <，不是数组先到者）', () => {
    const slot0 = P(0, 100, 0);
    const slot5 = P(5, 0, 100);      // 曼哈顿距离同为 100
    expect(pickClosestLootPlayer([slot5, slot0], 0, 0)).toBe(slot0);
    expect(pickClosestLootPlayer([slot0, slot5], 0, 0)).toBe(slot0);
  });

  it('全员死亡 → 返回最小槽位的 active 玩家（原版 result 不清零，绝不返回 null）', () => {
    const a = P(4, 10, 10, true);
    const b = P(1, 500, 500, true);
    expect(pickClosestLootPlayer([a, b], 0, 0)).toBe(b);
    expect(pickClosestLootPlayer([a, b], 0, 0)).not.toBeNull();
  });

  it('负控：存活者优先于更近的死者', () => {
    const deadNear = P(0, 10, 10, true);
    const aliveFar = P(2, 400, 400);
    expect(pickClosestLootPlayer([deadNear, aliveFar], 0, 0)).toBe(aliveFar);
  });

  it('单玩家：无论死活都返回该玩家（单人联机边界）', () => {
    const solo = P(0, 123, 456);
    expect(pickClosestLootPlayer([solo], 0, 0)).toBe(solo);
    const soloDead = P(0, 123, 456, true);
    expect(pickClosestLootPlayer([soloDead], 0, 0)).toBe(soloDead);
  });
});

/** 空群系/季节/风上下文（DropExtras 全假） */
const NO_EXTRAS: DropExtras = {
  zoneHallow: false, zoneCorrupt: false, zoneCrimson: false, zoneJungle: false,
  zoneSnow: false, zoneDesert: false, zoneDungeon: false, zoneBeach: false,
  bloodMoon: false, halloween: false, xmas: false, windy: false,
};

function mkSoulCtx(seed: number, ex: DropExtras, over: Partial<NpcDropCtx> = {}): NpcDropCtx {
  return {
    rng: new RNG(seed * 7919 + 13), netId: 3, type: 3,
    isExpert: true, isMaster: false, hardMode: true, crimson: false, flags: {},
    x: 300 * TILE, y: 900 * TILE,
    worldSurfaceTile: 100, rockLayerTile: 120, underworldTileY: 1000,
    maxTilesX: 400, maxTilesY: 1200,
    lifeMax: 60, friendly: false, boss: false, damage: 20, value: 100,
    hp: 100, hpMax: 100, mana: 20, manaMax: 20, luck: 0,
    extras: ex,
    ...over,
  };
}

// ===========================================================================
// N12 — 活火块地狱线 = maxTilesY-200（不是 lavaLine）
// ===========================================================================
describe('issue#46 N12 活火块地狱线', () => {
  it('World.underworldLine = h-200，且与 lavaLine 可分离（h=1200 → 1000 vs 906）', () => {
    const w = new World(400, 1200, 7, 'n12');
    w.lavaLine = 906;
    expect(w.h).toBe(1200);
    expect(w.underworldLine).toBe(1000);
    expect(w.underworldLine).not.toBe(w.lavaLine);
  });

  it('h=1200：洞穴 Y950 零活火块；地狱 Y1010 有（同 200 种子）', () => {
    const w = new World(400, 1200, 7, 'n12b');
    w.lavaLine = 906;
    w.difficulty = 1; w.flags.hardMode = true;
    const count = (tileY: number): number => {
      let n = 0;
      for (let seed = 0; seed < 200; seed++) {
        const ctx = mkSoulCtx(seed, NO_EXTRAS, {
          y: tileY * TILE, underworldTileY: w.underworldLine,
        });
        n += resolveDrops(ctx).drops.filter((d) => d.id === 2701).length;
      }
      return n;
    };
    expect(count(950)).toBe(0);      // 用 lavaLine(906) 当线时此处会错发（issue 实测 3 次）
    expect(count(1010)).toBeGreaterThan(0);
    // 对照：若仍按 lavaLine=906 判，Y950 会放行 —— 证明测试有判别力
    let wrong = 0;
    for (let seed = 0; seed < 200; seed++) {
      wrong += resolveDrops(mkSoulCtx(seed, NO_EXTRAS, {
        y: 950 * TILE, underworldTileY: 906,
      })).drops.filter((d) => d.id === 2701).length;
    }
    expect(wrong).toBeGreaterThan(0);
  });

  it('严格 > 边界：Y=1000(h-200) 与 Y=999 不掉，Y=1001 掉', () => {
    const count = (tileY: number): number => {
      let n = 0;
      for (let seed = 0; seed < 200; seed++) {
        n += resolveDrops(mkSoulCtx(seed, NO_EXTRAS, {
          y: tileY * TILE, underworldTileY: 1000,
        })).drops.filter((d) => d.id === 2701).length;
      }
      return n;
    };
    expect(count(1000)).toBe(0);     // Conditions.cs:939 严格 >（== 不算地狱）
    expect(count(999)).toBe(0);
    expect(count(1001)).toBeGreaterThan(0);
  });

  it('消费端结构锁：NpcDrops 判据保持严格 >，数据源指向 underworldTileY', () => {
    const text = readFileSync(new URL('../src/drops/NpcDrops.ts', import.meta.url), 'utf8');
    expect(text).toContain('&& ctx.y / 16 > ctx.underworldTileY;');
    // World 只读派生
    const wtext = readFileSync(new URL('../src/world/World.ts', import.meta.url), 'utf8');
    expect(wtext).toContain('get underworldLine(): number { return this.h - 200; }');
  });
});

// ===========================================================================
// 变异自证（withMutation；仅本刀独占域文件 src/stats/ScaleStats.ts /
//   src/drops/NpcDrops.ts）。★Game.ts 禁变异（刀 A/刀 C 并行改写 + 整文件窗口
//   风险）：N17 的宿主分派（dropContext 槽判定）与 N16 的死亡口接线由 fakeThis
//   行为测 + 源文本锁守卫；N11/N16 的判据与物品表已单源到 NpcDrops.ts 纯函数，
//   故其变异打 NpcDrops.ts（判据本体所在文件）。
//   ★过滤串=测试名独有片段 + 零正则元字符（vitest -t 是正则）。
// ===========================================================================
describe.skipIf(process.env.SW_ISSUE46D_MUT)('issue#46 刀D 变异恰红', () => {
  const SCALE = join(process.cwd(), 'src', 'stats', 'ScaleStats.ts');
  const NPCDROPS = join(process.cwd(), 'src', 'drops', 'NpcDrops.ts');
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/issue46-drops-progress.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_ISSUE46D_MUT: '1' },
    });
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout + r.stderr).toContain(filter);
    }, { label: `issue46-D ${filter}` });
  };

  it('M1 N03 hardMode getter→读档快照 → 三态表红', () => {
    mutate(SCALE,
      'get hardMode() { return !!world.flags?.hardMode; },',
      'hardMode: false, // ★M1 变异：快照化',
      'N03 进度缩放上下文快照化');
  });

  it('M2 N03 downedPlantBoss getter→读档快照 → 世花后档红', () => {
    mutate(SCALE,
      "get downedPlantBoss() { return !!world.flags?.['downed_262']; },",
      'downedPlantBoss: false, // ★M2 变异：快照化',
      'N03 进度缩放上下文快照化');
  });

  it('M3 N15 activePlayerCount getter→恒 1 → 多人克眼血量红', () => {
    mutate(SCALE,
      'get activePlayerCount() { return activePlayerCount ? activePlayerCount() : 1; },',
      'activePlayerCount: 1, // ★M3 变异：恒单人',
      'N15 多人 Boss 血量');
  });

  it('M4 N11 target/0.4 判据→current/0.5 旧式 → 三段表红', () => {
    mutate(NPCDROPS,
      'return Math.abs(windSpeedTarget) >= 0.4;',
      'return Math.abs(windSpeedTarget) > 0.5; // ★M4 变异：旧阈值',
      'N11 风筝掉落风门');
  });

  it('M5 N16 石巨人分支多清 noTemple → 负控红（issue 明示勿多修）', () => {
    mutate(NPCDROPS,
      'drop(next(0, 4) === 0 ? 1149 : 1146, next(5, 11));',
      "drop(next(0, 4) === 0 ? 1149 : 1146, next(5, 11)); out.clear.push('noTemple'); // ★M5 变异：多修",
      'N16 缺结构补偿掉落');
  });

  it('M7 N17 等距破缺摘除 → 低槽优先锁红', () => {
    mutate(NPCDROPS,
      '    if (bestD < 0 || d < bestD || (d === bestD && best !== null && c.slot < best.slot)) {',
      '    if (bestD < 0 || d < bestD) { // ★M7 变异：等距退回先到者',
      '等距 → 低槽胜出');
  });

  it('M8 N17 死者回退摘除 → 全员死亡锁红', () => {
    mutate(NPCDROPS,
      '  if (best) return best;\n  // 全员死亡：原版 result 仍停在首个 active 槽（Player.cs:4938-4946 只认 active）',
      '  if (best) return best;\n  return null; // ★M8 变异：全员死亡不回退\n  // 全员死亡：原版 result 仍停在首个 active 槽（Player.cs:4938-4946 只认 active）',
      '全员死亡 → 返回最小槽位');
  });

  it('M6 N12 活火块严格 > 改 >= → 地狱线边界红', () => {
    mutate(NPCDROPS,
      '&& ctx.y / 16 > ctx.underworldTileY;',
      '&& ctx.y / 16 >= ctx.underworldTileY; // ★M6 变异：边界含等号',
      'N12 活火块地狱线');
  });
});
