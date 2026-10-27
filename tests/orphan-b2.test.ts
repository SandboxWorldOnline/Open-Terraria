// 孤儿武器 B2 波·世界改造簇三件回归（2026-08-30，模型 tests/orphan-weapons-a.test.ts）：
//   工单1 肥料 5438 → 弹 1019 / 工单1b 富集肥料 5518 → 弹 1051（aiStyle6 肥料云,
//         FertilizerCloud + Game.growFertilizedSapling 世界管线,富集档 addon+15）
//   工单2 甲虫炸弹 4423 → 弹 773（EXTRACT_PATCH 补 noMelee → combatWeapon 归 grenade
//         数据面;GrenadeProj STICKY/FUSE 表扩 773;Game.scarabBombExplode 隧道爆破）
// 锚点：Item.cs case 5438 :42954-42967 / case 5518 :43433-43446 / case 4423 :37462-37474
//       （1457 与 1458 同行号）；Projectile.cs AI_006 肥料支 :24367-24505 /
//       SetDefaults :9646-9658(1019)/:9965-9977(1051)/:7904-7912(773) /
//       NewProjectile 引信 :11007-11009（773→timeLeft180）/ AI_016 粘附扫描 :47822-47891 /
//       PrepareBombToBlow 特例 :47641-47645（Resize(48,96)/dmg100/kb8）/
//       Kill 挖洞专支 :79951-80058 + GetScarabBombDigDirectionSnap8 :71606-71619；
//       WorldGen.cs AttemptToGrowTreeFromSapling :73395-73502 / GrowTree :30078 /
//       GrowPalmTree :27429/:27438 / GrowTreeWithSettings :30708（treeHeightAddon 加算）。
import { describe, it, expect, vi } from 'vitest';
import { Game, ORPHAN_B2_VIDS } from '../src/core/Game';
import { World } from '../src/world/World';
import { TileStore } from '../src/world/TileStore';
import { TILE } from '../src/core/constants';
import { RNG } from '../src/core/rng';
import { GrenadeProj, FertilizerCloud, FERTILIZER_PROJ_BY_ITEM } from '../src/entities/WeaponProj';
import { growTree, growPalmTree, growVanityTree, growAshTree, growGemTree } from '../src/world/gen/vanilla/TreePass';
import { itemCombat, combatWeapon, thrownCombat } from '../src/data/vanillaItemCombat';
import { projectileData } from '../src/data/vanillaProjectiles';
import { TILE_BY_KEY, TILE_DEFS, T } from '../src/data/tiles';
import { WALL_DROPS } from '../src/data/wallDrops';   // SW-BL1 2026-09-06 清墙掉落守卫
import { VI } from '../src/data/itemKeys';
import { ITEM_DEFS } from '../src/data/items';   // ★BJ731:清墙掉落键解析式同 src
import type { GameHooks } from '../src/entities/types';

const TREE_ID = () => TILE_BY_KEY['tree']!;
const grassId = (): number => {
  const i = TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === 2);
  expect(i).toBeGreaterThan(0);
  return i;
};

/** 实体级最小 hooks（同 orphan-weapons-a makeHooks 形制） */
function makeHooks(store: TileStore): GameHooks {
  return {
    world: { store } as never,
    player: { cx: 0, cy: 0, x: -10, y: -21, w: 20, h: 42, dead: false, equipStats: {} } as never,
    enemies: () => [], critters: () => [], npcs: () => [],
    projectiles: () => [],
    spawnParticles: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => true,
    showPickupLabel: () => {}, spawnDust: () => null,
  } as unknown as GameHooks;
}

/** Game 原型桩：真实 growFertilizedSapling / scarabBombExplode 方法消费面 */
function mkProtoGame(opts?: { px?: number; py?: number }) {
  const world = new World(280, 260, 120, 'open');
  world.groundLevel = 130;                       // 地表带判别用（苗/门均在地表附近）
  const playerRecords: Array<{ kind: string; v: unknown }> = [];
  const sfxNames: string[] = [];
  const g = Object.create(Game.prototype) as unknown as Record<string, any>;
  g.world = world;
  g.player = {
    inv: { slots: [], isItemSlotUnlockedAndUsable: () => false },   // ★刀I补桩(9545b31c 单点门):无 armor 表,谓词 false=无配饰
    cx: opts?.px ?? (40 * TILE), cy: opts?.py ?? (90 * TILE),
    x: (opts?.px ?? (40 * TILE)) - 10, y: (opts?.py ?? (90 * TILE)) - 21, w: 20, h: 42,
    dead: false, facing: 1,
    equipStats: {} as Record<string, unknown>,
    // ★BJ731 补桩（2026-10-27）：BJ652 件4 起 damagePlayer 飘字/语音面读
    //   p.mount.active（PlayHurtSound :38946-38982 mountType）与 p.buffs.has
    //   （wereWolf 位）——裸桩缺此两面=盒内自伤 TypeError,补静默桩（真 Player
    //   恒有 mount/buffs,缺省 false/空表=无坐骑/非狼人档）。
    mount: { active: false, type: 0 },
    buffs: { has: () => false },
    // ★BJ731 补桩（2026-10-27）：damagePlayer 头部乘区读位——luck（SelfHurtPlayers
    //   :15118 damageVarRoll(value,-luck)）与 modTakenMult（★五百四十六乘区,
    //   缺省 1;undefined!==1 → dmg×undefined=NaN）。
    luck: 0,
    modTakenMult: 1,
    damage: (d: number, sx: number, sy: number) =>
      playerRecords.push({ kind: 'damage', v: { d, sx, sy } }),
  };
  g.camera = { viewW: 1280, viewH: 800 };
  g.chunks = { markDirtyArea: (_a: number, _b: number, _c: number, _d: number) => {} };
  g.entities = { enemies: [], critters: [], npcs: [], drops: [], add: () => {} };
  g.drops = [];
  g.dmgNumbers = [];
  g.addDamageNumber = (x: number, y: number, n: number) => { (g as any).dmgNumbers.push(n); };
  g.playHurtVoice = () => {};                                        // breakTile→spawnDrop 掉落上限扫描面
  g.sfx = { play: (n: string) => { sfxNames.push(n); },
    playWavFile: (f: string) => { sfxNames.push(f); return true; } };
  g.spawnParticles = () => {};
  // SW-BL1 2026-09-06：爆炸清墙 KillWall 全语义掉落消费面（wallDrops 单源）录制桩
  g.spawnDrop = (x: number, y: number, key: string, count: number) => {
    (g as any).dropRecords.push({ x, y, key, count });
    return null;
  };
  g.dropRecords = [] as Array<{ x: number; y: number; key: string; count: number }>;
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };   // breakTile→inMiningWindow 面（SW-AF1 后新增消费）
  return { g, world, playerRecords, sfxNames };
}

describe('数据面：肥料二件（Item.cs case 5438/:42954 case 5518/:43433）', () => {
  it('5438→shoot1019 / 5518→shoot1051，consumable+noMelee 且 combatWeapon/thrownCombat 双门皆 null', () => {
    const cA = itemCombat(5438)!;
    const cB = itemCombat(5518)!;
    expect(cA.shoot).toBe(1019);
    expect(cB.shoot).toBe(1051);                       // 富集弹体独立 id（非任务稿误记的 1019）
    expect(cA.consumable).toBe(true);
    expect(cA.noMelee).toBe(true);
    expect(cB.useTime).toBe(15);
    for (const vid of [5438, 5518]) {
      expect(combatWeapon({ key: `vi_${vid}_x`, vid })).toBeNull();
      expect(thrownCombat({ key: `vi_${vid}_x`, vid })).toBeNull();   // 显式退出,不再射成 ai2 抛物 Arrow
    }
  });

  it('B2 分派注册面与弹映射表一致（ORPHAN_B2_VIDS={5438,5518}）', () => {
    expect([...ORPHAN_B2_VIDS].sort()).toEqual([5438, 5518]);
    expect(FERTILIZER_PROJ_BY_ITEM[5438]).toBe(1019);
    expect(FERTILIZER_PROJ_BY_ITEM[5518]).toBe(1051);
    expect(projectileData(1019)?.aiStyle).toBe(6);
    expect(projectileData(1051)?.aiStyle).toBe(6);
    expect(projectileData(1019)?.width).toBe(64);      // 云体命中盒 64×64
  });

  it('SetDefaults 覆盖项：两者 alpha=255 本体不可见（FertilizerCloud.draw no-op 由实体层成立）', () => {
    const cloud = new FertilizerCloud(0, 0, 0, 0, 1019, () => {});
    expect(cloud.w).toBe(64);
    expect(cloud.h).toBe(64);
    expect(cloud.dead).toBe(false);
  });
});

describe('行为面①：肥料云落苗成树（growFertilizedSapling 世界管线）', () => {
  function sapWorld() {
    const { g, world } = mkProtoGame();
    const st = world.store;
    const grass = grassId();
    for (let x = 42; x <= 58; x++) st.setTileSilent(x, 100, grass, 0, 0);
    st.setTileSilent(50, 99, T.SAPLING, 0, 0);          // style=frameX/54=0 默认树档
    return { g, world, st };
  }

  it('云窗覆盖苗格 → 苗被树干取代（等价断言：目标格 tile 变化 + 树体落成 + 登记进 world.trees）', () => {
    const { g, world, st } = sapWorld();
    expect(st.get(50, 99)).toBe(T.SAPLING);
    g.growFertilizedSapling(50 * TILE + 8 - 32, 99 * TILE + 8 - 32, 64, 64, 0);
    const tree = TREE_ID();
    expect(world.trees.length).toBeGreaterThan(0);
    let trunk = 0;
    for (let y = 80; y <= 99; y++) if (st.get(50, y) === tree) trunk++;
    expect(trunk).toBeGreaterThanOrEqual(5);            // 干身至少整高 Next(5,17)
    expect(st.get(50, 99)).not.toBe(T.SAPLING);         // 苗格被覆写（树干底部）
  });

  it('GrowTree addon==15 比 addon==0 干顶高恰 15 行（1458 WorldGen.cs:30078 掷后加算语义）', () => {
    const topAt = (addon: number): number | null => {
      const { world } = mkProtoGame();
      const st = world.store;
      const grass = grassId();
      for (let x = 46; x <= 54; x++) st.setTileSilent(x, 160, grass, 0, 0);
      st.setTileSilent(50, 159, T.SAPLING, 0, 0);
      const ok = growTree(st, new RNG(20260830),
        { genTrees: [] as unknown[], seedFlags: {} } as never as Parameters<typeof growTree>[2],   // 真实 worldgen gs.seedFlags 恒在(SeedEasterEggs 普通档={})
        50, 159, true /*ignoreWalls*/, addon);
      if (!ok) return null;
      for (let y = 100; y <= 158; y++) if (st.get(50, y) === TREE_ID()) return y;
      return null;
    };
    const top0 = topAt(0);
    const top15 = topAt(15);
    expect(top0).not.toBeNull();
    expect(top15).not.toBeNull();
    expect(top15! - top0!).toBe(-15);                   // 同种子等掷序列 → 干顶上移恰 15 格
  });
});

describe('行为面②：肥料云实体时序与富集档传参', () => {
  it('1019 档 scan 回调 addon=0、覆盖窗含苗格，~36 拍速度散尽后消亡（v<0.5 门 P.cs:24504）', () => {
    const store = new TileStore(200, 200);
    const captured: Array<{ has: boolean; addon: number }> = [];
    const cloud = new FertilizerCloud(50 * TILE, 40 * TILE, 3, 0, 1019,
      (gx, gy, gw, _gh, addon) => {
        captured.push({ has: gx < 52 * TILE && gx + gw > 48 * TILE && gy < 44 * TILE, addon });
      });
    let ticks = 0;
    while (!cloud.dead && ticks < 120) { cloud.fixedUpdate(1 / 60, makeHooks(store)); ticks++; }
    expect(cloud.dead).toBe(true);
    expect(ticks).toBeLessThanOrEqual(60);              // speed3×0.95^t <0.5 在 ~36 拍（ai[0]==180 兜底远未及）
    expect(captured.length).toBe(ticks);                // 存活期每拍一扫
    expect(captured[0]!.has).toBe(true);
    expect(captured[0]!.addon).toBe(0);
  });

  it('1051 富集档 scan 回调恒携带 treeHeightAddon=15（GrowTreeWithSettings/GrowPalm 同参贯通源头）', () => {
    const store = new TileStore(200, 200);
    const addons = new Set<number>();
    const cloud = new FertilizerCloud(50 * TILE, 40 * TILE, 3, 0, 1051,
      (_gx, _gy, _gw, _gh, addon) => { addons.add(addon); });
    let ticks = 0;
    while (!cloud.dead && ticks < 120) { cloud.fixedUpdate(1 / 60, makeHooks(store)); ticks++; }
    expect(cloud.dead).toBe(true);
    expect([...addons]).toEqual([15]);
  });

  // B2-F1 首拍尘爆塌缩回归（2026-08-30 红队 finding）：spawnDust 第8参=Alpha 非
  // 数量（P.cs:24399 NewDust 第7参 `int Alpha`=50,Dust.cs:75）——原实现误当数量
  // 只发 1-2 粒且无 flag2 分档。现钉：num52=40|50 逐粒 + 逐粒 rand(3)==0 换抽 309
  // + noGravity=i%3!=0 分档 scale/vel 后置覆写（P.cs:24379-24418）
  it('B2-F1 回归：首拍尘爆逐粒语义——数量 40|50、alpha=50、rand(3) 混抽 309、i%3 分档后置覆写（P.cs:24379-24418）', () => {
    const store = new TileStore(200, 200);
    /** 拍定 Math.random 序列 + 记录式 spawnDust 假尘（可观察实体侧的后置覆写） */
    function burst(projId: number, rnd: number[]) {
      let ri = 0;
      const spy = vi.spyOn(Math, 'random')
        .mockImplementation(() => rnd[ri++ % rnd.length]!);
      try {
        const draws: Array<{ type: number; sx: number; sy: number; alpha: number }> = [];
        const dusts: Array<{ vx: number; vy: number; scale: number; noGravity: boolean }> = [];
        const hk = {
          ...makeHooks(store),
          spawnDust: (_x: number, _y: number, w: number, h: number, type: number,
            sx: number, sy: number, alpha: number) => {
            void _x; void _y;
            expect(w).toBe(64); expect(h).toBe(64);           // NewDust(position,width,height)
            draws.push({ type, sx, sy, alpha });
            const d = { vx: sx + 2.5, vy: sy - 1.5, scale: 1.05, noGravity: false };
            dusts.push(d);
            return d;
          },
        } as unknown as GameHooks;
        const cloud = new FertilizerCloud(1000, 1000, 3, 1, projId, () => {});
        cloud.fixedUpdate(1 / 60, hk);
        return { draws, dusts };
      } finally {
        spy.mockRestore();
      }
    }

    // ——普通档 1019：40 粒全型 0，第8参 alpha=50 贯通；出手 speed3 首拍已 ×0.95（cs:24369 先于 ai[1] 尘爆）
    const norm = burst(1019, [0.5]);
    expect(norm.draws).toHaveLength(40);
    expect(new Set(norm.draws.map((x) => x.type))).toEqual(new Set([0]));
    expect(norm.draws.every((x) => x.alpha === 50)).toBe(true);
    expect(norm.draws[0]!.sx).toBeCloseTo(2.85, 10);
    // ——flag2 后置覆写（P.cs:24400-24418）：i=0 重力档 s×1.25/vel÷2/vy−2.2
    expect(norm.dusts[0]!.noGravity).toBe(false);
    expect(norm.dusts[0]!.scale).toBeCloseTo(1.05 * 1.25, 10);
    expect(norm.dusts[0]!.vx).toBeCloseTo((2.85 + 2.5) / 2, 10);
    expect(norm.dusts[0]!.vy).toBeCloseTo((0.95 - 1.5) / 2 - 2.2, 10);
    //   i%3!=0 浮空档：s×1.75/vel+弹速×0.65
    for (const i of [1, 2]) {
      expect(norm.dusts[i]!.noGravity).toBe(true);
      expect(norm.dusts[i]!.scale).toBeCloseTo(1.05 * 1.75, 10);
      expect(norm.dusts[i]!.vx).toBeCloseTo(2.85 + 2.5 + 2.85 * 0.65, 10);
      expect(norm.dusts[i]!.vy).toBeCloseTo(0.95 - 1.5 + 0.95 * 0.65, 10);
    }
    // ——富集档 1051：50 粒逐粒重掷 rand(3)==0?309:0（普档不掷,P.cs:24395-24398）
    const richNone = burst(1051, [0.99]);                    // Next(3) 恒非 0 → 全型 0
    expect(richNone.draws).toHaveLength(50);
    expect(richNone.draws.every((x) => x.type === 0)).toBe(true);
    const richAll = burst(1051, [0]);                        // 恒抽中 → 全 309,alpha 贯通
    expect(richAll.draws.every((x) => x.type === 309)).toBe(true);
    expect(richAll.draws.every((x) => x.alpha === 50)).toBe(true);
    const richMix = burst(1051, [0.1, 0.5, 0.9]);            // 循环序列 → ceil(50/3)=17 粒 309
    expect(richMix.draws.filter((x) => x.type === 309)).toHaveLength(17);
  });
});

describe('数据面：甲虫炸弹 4423（EXTRACT_PATCH noMelee → grenade 族）', () => {
  it('补丁后 merged noMelee=true 且 shoot=773/useTime25/noUseGraphic/consumable 原样', () => {
    const c = itemCombat(4423)!;
    expect(c.shoot).toBe(773);
    expect(c.useTime).toBe(25);
    expect(c.noUseGraphic).toBe(true);
    expect(c.consumable).toBe(true);
    expect(c.noMelee).toBe(true);                       // 派发等价门（P 层非字面行）
  });

  it('combatWeapon 归 grenade 族（aiStyle16），射速 5', () => {
    const cw = combatWeapon({ key: 'vi_4423_scarab_bomb', vid: 4423 });
    expect(cw?.kind).toBe('grenade');
    if (cw?.kind === 'grenade') {
      expect(cw.shoot).toBe(773);
      expect(cw.useTime).toBe(25);
      expect(cw.shootSpeed).toBe(5);
    }
    expect(projectileData(773)?.width).toBe(22);        // 22×22 引信盒（SetDefaults :7904）
  });

  it('GrenadeProj 773：碰撞盒 22×22 + 引信 timeLeft=180（NewProjectile :11007）+ 嘶声资格', () => {
    const b = new GrenadeProj(0, 0, 0, 0.001, 100, 180, 773, () => {});
    expect(b.w).toBe(22);
    expect(b.h).toBe(22);
    expect(b.fuse).toBe(180);
    void b;
    const hooksFused: string[] = [];
    const bomb = new GrenadeProj(10, 10, 0, 0, 100, 3, 773, () => {});
    const hk = makeHooks(new TileStore(40, 40));
    (hk as unknown as Record<string, unknown>).startTrackedLoop = (name: string) => { hooksFused.push(name); return { stop() {}, setPos() {} }; };
    for (let t = 0; t < 3; t++) bomb.fixedUpdate(1 / 60, hk);
    expect(bomb.dead).toBe(true);
    expect(hooksFused.filter((n) => n === 'bombFuse')).toHaveLength(1);  // IsABombWithFuse 表 773 在册
  });
});

describe('行为面③：甲虫炸弹引信嘶声一次 + 隧道掘进 + 对玩家定伤', () => {
  /** 石腹场景：甲虫嵌在岩块内部；玩家缺省在正上方 → 远离向 = 向下(+Y) */
  function scarabScene(opts?: { py?: number }) {
    const { g, world, playerRecords, sfxNames } = mkProtoGame(opts);
    const st = world.store;
    const stone = TILE_BY_KEY['v_1_stone'] ?? T.STONE;
    for (let x = 44; x <= 56; x++) {
      for (let y = 140; y <= 185; y++) st.setTileSilent(x, y, stone, 0, 0);
    }
    const bombPx = 50 * TILE - 3;                       // 盒左：中心=x+11 → 列 50 步盒心
    const bombTopY = 150 * TILE + 10;                   // 盒底探入 row150 实心 → 粘附扫描命中
    g.startTrackedLoopCalls = [] as string[];
    g.stoppedLoops = 0;
    const hooks = {
      world,
      player: g.player,                                // 773 贴附姿态取玩家方向（P.cs:47891）
      cutTile: () => {}, spawnParticles: () => {},
      enemies: () => [], critters: () => [], npcs: () => [],
      startTrackedLoop: (name: string) => {
        g.startTrackedLoopCalls.push(name);
        return { stop: () => { g.stoppedLoops++; }, setPos: () => {} };
      },
    } as unknown as GameHooks;
    void sfxNames;
    return { g, st, stone, bombPx, bombTopY, playerRecords, hooks };
  }

  it('满引信爆炸：沿远离玩家侧挖竖直隧道（步盒 3×3 全拆、盒外岩保留），玩家远在盒外不吃伤', () => {
    const scene = scarabScene({ py: 120 * TILE });       // 玩家在正上方 → 下挖
    const { g, st, stone, bombPx, bombTopY, playerRecords } = scene;
    expect(st.get(50, 152)).toBe(stone);                 // 爆前实心
    let exploded = 0;
    let killC: { ex: number; ey: number } | null = null;
    const bomb = new GrenadeProj(bombPx, bombTopY, 0, 0, 100, 180, 773,
      (ex, ey, edmg) => { exploded++; killC = { ex, ey }; (g as any).scarabBombExplode(ex, ey, edmg); });
    let ticks = 0;
    while (!bomb.dead && ticks < 400) { bomb.fixedUpdate(1 / 60, scene.hooks); ticks++; }
    expect(bomb.dead).toBe(true);
    expect(ticks).toBeLessThanOrEqual(181);              // 引信自然耗尽（粘附不提前爆）
    expect(g.startTrackedLoopCalls.filter((n: string) => n === 'bombFuse')).toHaveLength(1);
    expect(g.stoppedLoops).toBe(1);                      // Kill → GetActiveSound.Stop()
    expect(exploded).toBe(1);
    // ——隧道锚定实测爆心（粘附平衡点有数 px 悬停涨落）：Kill 心向下 15×√2 步全清，
    //   列 49..51 每步行全拆；步盒外列与射程尽头之下的岩体保留
    const kc = killC!;
    const cCol = Math.floor(kc.ex / TILE), cRow = Math.floor(kc.ey / TILE);
    expect(cCol).toBe(50);
    for (let k = 0; k <= 20; k++) {
      const r = cRow + k;
      if (st.get(49, r) !== undefined) expect(st.get(49, r)).toBe(0);
      if (st.get(51, r) !== undefined) expect(st.get(51, r)).toBe(0);
    }
    expect(st.get(47, cRow + 5)).toBe(stone);            // 步盒（±1）之外岩体保留
    expect(st.get(53, cRow + 15)).toBe(stone);
    expect(st.get(50, cRow + 24)).toBe(stone);           // 掘进射程（num79≈21）尽头之下完好
    // ——玩家远在爆点上方 >48px，在 48×96 直矩形外 → 不吃伤
    expect(playerRecords).toHaveLength(0);
  });

  it('Kill 态 48×96 直矩形伤害盒：盒内玩家 p.damage 恰一次且原值 100（SelfHurtPlayers,难度乘区前）；盒外不吃', () => {
    const scene = scarabScene();
    const { g, st, playerRecords } = scene;
    const ex = 50 * TILE + 8, ey = 152 * TILE;           // 单位化爆心（直调——集成路径已由前测覆盖）
    g.player.cx = ex;                                     // 盒内：|dy|=21 < 48+h/2
    g.player.cy = ey + 21;
    g.player.x = ex - 10; g.player.y = ey;
    (g as any).scarabBombExplode(ex, ey, 100);
    let hits = playerRecords.filter((r) => r.kind === 'damage');
    expect(hits).toHaveLength(1);
    // SW-S1 ①：SelfHurtPlayers :15118 DamageVar(value, -luck) ±15% 方差（原版自伤非定值）
    expect((hits[0]!.v as { d: number }).d).toBeGreaterThanOrEqual(85);
    expect((hits[0]!.v as { d: number }).d).toBeLessThanOrEqual(115);
    expect(st.get(50, 153)).toBe(0);                     // 隧道掘进照常发生
    // ——盒外（纵向 |dy|=61 > 48+42/2=69？否——拉到 130px 明确出盒）
    playerRecords.length = 0;
    const s2 = scarabScene();
    s2.g.player.cx = ex;
    s2.g.player.cy = ey + 130;
    s2.g.player.x = ex - 10; s2.g.player.y = ey + 130 - 21;
    (s2.g as any).scarabBombExplode(ex, ey, 100);
    expect(s2.playerRecords).toHaveLength(0);
  });

  it('wallSplode 清墙覆盖空气格邻域（B2-F2：ExplodeTiles flag 对非活性格保持 true，P.cs:80470-80488）', () => {
    const scene = scarabScene();
    const { g, st } = scene;
    // 预挖"已开采隧道"腔（cols 49..51 × rows 148..158 全空气+墙1），腔侧壁
    // （cols 48/52）实心岩上铺墙1作观察面——vanilla 逐格(含空气格)±1 清墙应把
    // 腔内墙与侧壁墙一并剥净；修复前空气格先行 continue 会留下整片残墙
    for (let y = 148; y <= 158; y++) {
      for (let x = 49; x <= 51; x++) {
        st.setTileSilent(x, y, 0, 0, 0);              // 挖空但留墙
        st.setWallSilent(x, y, 1);
      }
      for (const x of [47, 48, 52, 53]) st.setWallSilent(x, y, 1);
    }
    for (let x = 48; x <= 52; x++) st.setWallSilent(x, 146, 1);   // 上界负对照
    // 直调爆心钉死在第 50 列、行 149（粘附涨落不参与）：玩家在左上 → 垂直下掘
    (g as any).scarabBombExplode(50 * TILE + 8, 149 * TILE, 100);
    // ——腔体及 ±1 观察带内的墙全部被剥除（含只与空气格相邻的侧壁墙）
    for (let y = 148; y <= 158; y++) {
      for (let x = 48; x <= 52; x++) expect(st.wall[st.idx(x, y)]).toBe(0);
    }
    // ——巷道新挖段照常成形且其邻域墙同清（盒邻域带 rows ≤172）
    expect(st.get(50, 165)).toBe(0);
    for (let x = 48; x <= 52; x++) expect(st.wall[st.idx(x, 165)]).toBe(0);
    // ——负对照：步盒清墙窗之外（col 47/53 与 row 146）的墙原样保留，石体完好
    for (let y = 148; y <= 158; y++) {
      expect(st.wall[st.idx(47, y)]).toBe(1);
      expect(st.wall[st.idx(53, y)]).toBe(1);
    }
    for (let x = 48; x <= 52; x++) expect(st.wall[st.idx(x, 146)]).toBe(1);
    expect(st.get(47, 150)).toBe(scene.stone);
    expect(st.get(53, 170)).toBe(scene.stone);
    // ——SW-BL1：清墙掉落全语义（KillWall_DropItems WorldGen.cs:60934-60941）。墙 1 =
    //   Unsafe 泥墙 → 掉 vi_26（WALL_DROPS[1]=26）1 件@格中心（vy=-2）；负对照带
    //   （col 47/53、row 146）墙未清不掉。清墙格 5×11=55 + 巷道邻域带若干 → 至少 55 件
    // ★BJ731 改判史（2026-10-27）：R-A-M1 起清墙掉落键改 `ITEM_DEFS[vid].key ??
    //   VI(vid)`（mod 物品键直查,蛇形 def 键优先;spawnDrop 双注册域均可解析）
    //   ——26 号 def 键=vi_26_stone_wall ≠ VI(26)=vi_26_StoneWall,旧精确过滤
    //   恒 0。过滤键改与 src 同解析式（ITEM_DEFS 优先）。
    const wallDropKey731 = ITEM_DEFS[WALL_DROPS[1]]?.key ?? VI(WALL_DROPS[1]);
    const wallDrops = ((g as any).dropRecords as Array<{ x: number; y: number; key: string; count: number }>)
      .filter((d) => d.key === wallDropKey731);
    expect(wallDrops.length).toBeGreaterThanOrEqual(55);
    expect(wallDrops.every((d) =>
      Math.abs(d.x - (Math.round((d.x - 8) / TILE) * TILE + 8)) < 1e-6 && d.count === 1)).toBe(true);
  });

  it('SW-BL1：清墙 fail 门（KillWall_CheckFailure WorldGen.cs:60901-60912）——地牢墙未败骷髅王爆炸墙保持原状不掉物,败后同场景照清照掉', () => {
    const scene = scarabScene();
    const { g, st } = scene;
    // 步盒（col 50 ±1）邻域带铺墙 7（wallDungeon 表 Main.cs:10507-10515 {7,8,9,94-99}）
    for (let y = 148; y <= 152; y++) {
      for (let x = 48; x <= 52; x++) {
        st.setTileSilent(x, y, 0, 0, 0);
        st.setWallSilent(x, y, 7);
      }
    }
    (g as any).scarabBombExplode(50 * TILE + 8, 150 * TILE, 100);
    // fail → 铺墙带（cols 48-52,含步盒清墙窗全范围）墙全部保持原状
    for (let y = 148; y <= 152; y++) {
      for (let x = 48; x <= 52; x++) expect(st.wall[st.idx(x, y)]).toBe(7);
    }
    expect(((g as any).dropRecords as Array<{ key: string }>)
      .filter((d) => d.key === VI(WALL_DROPS[7]))).toHaveLength(0);
    // 败骷髅王（downed_35）后同场景 → 照清照掉（蓝砖墙 vi_135）
    const scene2 = scarabScene();
    const st2 = scene2.st;
    (scene2.g as any).world.flags['downed_35'] = true;
    for (let y = 148; y <= 152; y++) {
      for (let x = 48; x <= 52; x++) {
        st2.setTileSilent(x, y, 0, 0, 0);
        st2.setWallSilent(x, y, 7);
      }
    }
    (scene2.g as any).scarabBombExplode(50 * TILE + 8, 150 * TILE, 100);
    expect(st2.wall[st2.idx(50, 150)]).toBe(0);
    expect(((scene2.g as any).dropRecords as Array<{ key: string }>)
      .filter((d) => d.key === VI(WALL_DROPS[7])).length).toBeGreaterThan(0);
  });

  it('接触敌怪零伤零钳引信（SW-I1 2026-09-03 翻案：:48046 每 tick damage=0 → Damage_PVE :12576 damage<=0 早退——:13153 钳门只在 Kill 爆炸结算可达）→ 引信自然耗尽照常开挖', () => {
    const scene = scarabScene();
    const { g, st } = scene;
    const hits: number[] = [];
    const dummy = {
      dead: false, x: scene.bombPx - 10, y: scene.bombTopY - 10, w: 20, h: 20,
      cx: scene.bombPx, cy: scene.bombTopY + 11,
      hurt: (d: number) => { hits.push(d); return true; },
    };
    (scene.hooks as unknown as Record<string, unknown>).enemies = () => [dummy];
    const bomb = new GrenadeProj(scene.bombPx, scene.bombTopY, 0, 0, 100, 180, 773,
      (ex, ey, edmg) => (g as any).scarabBombExplode(ex, ey, edmg));
    let ticks = 0;
    while (!bomb.dead && ticks < 300) { bomb.fixedUpdate(1 / 60, scene.hooks); ticks++; }
    expect(bomb.dead).toBe(true);
    expect(ticks).toBe(178);                             // 773 不在 damage 豁免表 → 原版 AI timeLeft≤3 先 Kill 后尾减(:48030-48037)=180 引信第 178 拍爆(SW-L1 I-2 爆点前移)
    expect(hits.length).toBe(0);                         // 飞行接触零结算（爆炸伤只在 Kill 置值后走爆炸圈）
    expect(st.get(49, 154)).toBe(0);                     // 自然引信路径上隧道同样成形
  });

  it('对照断言：嵌墙无敌场不提前爆——AI_016 仅粘附扫描，无"无路即爆"分支（vanilla 真值钉）', () => {
    const scene = scarabScene();
    const bomb = new GrenadeProj(scene.bombPx, scene.bombTopY, 0, 0, 100, 180, 773,
      () => { throw new Error('不应在此窗内起爆'); });
    for (let t = 0; t < 100; t++) bomb.fixedUpdate(1 / 60, scene.hooks);
    expect(bomb.dead).toBe(false);                       // 嵌墙悬停至引信自然耗尽
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B2-F3/F4/S1/S2 成树门面贯通回归（2026-08-30 蓝队，红队 finding 四条逐一钉死）：
//   F3：ignoreWalls=true 全族贯通——调用侧恒真实参（1457 Projectile.cs:24486/:24488）
//       原本只有默认档 growTree 接住，GrowPalmTree/GrowTreeWithSettings 三处
//       flag=ignoreWalls||墙测（WorldGen.cs:27412/:30685）未贯通 → 棕榈/宝石/樱/
//       柳/灰烬五族墙面基座被误拒；
//   F4：case 590 案例首句地下门（WorldGen.cs:73462-73465 `if (!underground)
//       return false`）曾缺失（旧注释"case 590 无地下门"方向写反）→ 地表宝石苗
//       被肥料云整档放行；
//   S1：underground 判据 off-by-one——原版 `num59 > (int)Main.worldSurface - 1`
//       （Projectile.cs:24488）把 ws 行本身算地下，本仓曾写 `j > groundLevel`
//       从 ws+1 起；S2：case20 地下拒门少 ntb/remix 两豁免（WorldGen.cs:73417/
//       :73424 `underground && !notTheBeesWorld && !remixWorld`）。
describe('行为面④：B2-F3/F4/S1/S2 成树门面贯通回归', () => {
  /** 非适植墙：不在 DefaultTreeWallTest（WallID.cs:58 AllowsPlantsToGrow 27 项，
   *  cs:30417）也不在 GemTreeWallTest 补充表（cs:30426-30458） */
  const HOSTILE_WALL = 47;
  const GEM_SAP_KEY = 'v_590_gem_saplings';
  const SHEET_ID = (sheet: number): number => {
    const d = TILE_DEFS.find((dd) => dd?.vanilla?.sheet === sheet);
    expect(d).toBeTruthy();
    return TILE_BY_KEY[d!.key]!;
  };
  function countRect(st: TileStore, x0: number, y0: number, x1: number, y1: number, id: number): number {
    let n = 0;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) if (st.get(x, y) === id) n++;
    }
    return n;
  }
  /** 家族场景：苗格 (50,sapY) + ±4 列×4 行厚基座 + 干身带宿主墙（苗行含内）。
   *  groundLevel 缺省 130（mkProtoGame）——深层场景天然 underground。 */
  function fertScene(opts: { base: number; sapY: number; fx?: number; sapKey?: string;
    wallCols?: [number, number]; wallRows?: [number, number] }) {
    const { g, world } = mkProtoGame();
    const st = world.store;
    for (let x = 46; x <= 54; x++) {
      for (let y = opts.sapY + 1; y <= opts.sapY + 4; y++) st.setTileSilent(x, y, opts.base, 0, 0);
    }
    const sap = opts.sapKey ? TILE_BY_KEY[opts.sapKey]! : T.SAPLING;
    st.setTileSilent(50, opts.sapY, sap, opts.fx ?? 0, 0);
    if (opts.wallCols) {
      for (let x = opts.wallCols[0]; x <= opts.wallCols[1]; x++) {
        for (let y = opts.wallRows![0]; y <= opts.wallRows![1]; y++) st.setWallSilent(x, y, HOSTILE_WALL);
      }
    }
    return { g, world, st, sap };
  }
  /** 云窗恰覆单苗格（直调世界管线；addon 缺省 0=普通档 1019） */
  function cloudAt(g: Record<string, any>, sx: number, sy: number, addon = 0): void {
    g.growFertilizedSapling(sx * TILE + 8, sy * TILE + 8, TILE, TILE, addon);
  }

  it('B2-F3①：ignoreWalls=true 全族贯通——非适植墙(47)上默认/棕榈/灰烬/宝石/樱/柳照样成树', () => {
    // ★BJ283 钉种（BJ267 登记成树掷未播种随机红）：growFertilizedSapling 的成树 RNG
    //   种子源=Math.random（Game.ts:43451 new RNG((Math.random()*1e9)|0)）——树冠形状
    //   掷随种子抖动,countRect>=5 下界对坏种子低概率敏感。BJ283 实测 20 次 GREEN=20
    //   RED=0（假红未复现=罕见尾）→ 本钉种=防御性稳定化,非掩盖真红：成树门判定
    //   （ignoreWalls/墙 47/基座/style 地下门）与 RNG 无关,门真红=growTree false→
    //   tile 不变→断言仍红。mock 恒 0.5 → 种子恒 5e8 → 六族树冠形状确定。
    //   习语=本文件「拍定 Math.random 序列」同款;try/finally 恢复防污染真随机消费面。
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
    // —— 默认树 tile20 style0（grass 基座，地表带——默认档地下被拒另见 B2-S1③）：
    //    growTree(true 门)修复前已通，此为锚点
    {
      const { g, st } = fertScene({ base: grassId(), sapY: 99, fx: 0,
        wallCols: [48, 52], wallRows: [73, 99] });
      cloudAt(g, 50, 99);
      expect(st.get(50, 99)).toBe(TREE_ID());
      expect(countRect(st, 49, 74, 51, 98, TREE_ID())).toBeGreaterThanOrEqual(5);
    }
    // —— 棕榈 tile20 style6（sand 基座，地表带）：GrowPalmTree 1457 cs:27412
    //    ignoreWalls 直通（地下档拒门另见 B2-S2）
    {
      const palmTree = SHEET_ID(323);
      const { g, st } = fertScene({ base: TILE_BY_KEY['sand']!, sapY: 124, fx: 6 * 54,
        wallCols: [48, 52], wallRows: [98, 124] });
      cloudAt(g, 50, 124);
      expect(st.get(50, 124)).toBe(palmTree);
      expect(countRect(st, 50, 99, 50, 123, palmTree)).toBeGreaterThanOrEqual(5);
    }
    // —— 灰烬 tile20 style10（灰烬草 633 基座）：style10 无地下门（:73416），WallTest 经
    //    Tree_Ash profile（GrowTreeWithSettings cs:30685）—— B2-F3 前恒拒
    {
      const ashTree = SHEET_ID(634);
      const { g, st } = fertScene({ base: TILE_BY_KEY['v_633_ash_grass_block']!, sapY: 179,
        fx: 10 * 54, wallCols: [48, 52], wallRows: [153, 179] });
      cloudAt(g, 50, 179);
      expect(st.get(50, 179)).toBe(ashTree);
      expect(countRect(st, 49, 154, 51, 178, ashTree)).toBeGreaterThanOrEqual(5);
    }
    // —— 宝石苗 590 kind0→topaz 583（stone 基座，gl=130 深层）：GemTree profile 同式
    {
      const gemTree = SHEET_ID(583);
      const gemSap = TILE_BY_KEY[GEM_SAP_KEY]!;
      const { g, st } = fertScene({ base: TILE_BY_KEY['stone']!, sapY: 229, fx: 0,
        sapKey: GEM_SAP_KEY, wallCols: [48, 52], wallRows: [203, 229] });
      cloudAt(g, 50, 229);
      expect(st.get(50, 229)).toBe(gemTree);
      expect(countRect(st, 49, 204, 51, 228, gemTree)).toBeGreaterThanOrEqual(5);
      void gemSap;
    }
    // —— 观赏樱 595 / 柳 615（grass 基座，无地下门任意深度）：VanityTree profile 同式
    for (const [sapKey, treeSheet] of [['v_595_sakura_sapling', 596],
      ['v_615_yellow_willow_sapling', 616]] as const) {
      const vanityTree = SHEET_ID(treeSheet);
      const { g, st } = fertScene({ base: grassId(), sapY: 119, sapKey,
        wallCols: [48, 52], wallRows: [93, 119] });
      cloudAt(g, 50, 119);
      expect(st.get(50, 119)).toBe(vanityTree);
      expect(countRect(st, 49, 94, 51, 118, vanityTree)).toBeGreaterThanOrEqual(5);
    }
    } finally { rand.mockRestore(); }
  });

  it('B2-F3②零差负对照：缺省形参（不传 ignoreWalls）各族墙门照拒——既有调用点掷流零差', () => {
    const gsShim = { genTrees: [] as unknown[] } as never as Parameters<typeof growTree>[2];
    // 默认树（缺省 false 门）
    const t = fertScene({ base: grassId(), sapY: 199, fx: 0, wallCols: [48, 52], wallRows: [173, 199] });
    expect(growTree(t.st, new RNG(11), gsShim, 50, 199)).toBe(false);
    // 棕榈 / 灰烬 / 宝石 / 樱 / 柳（包装族缺省 false 门， GrowTreeWithSettings 同式）
    const p = fertScene({ base: TILE_BY_KEY['sand']!, sapY: 159, fx: 6 * 54, wallCols: [48, 52], wallRows: [133, 159] });
    expect(growPalmTree(p.st, new RNG(11), 50, 159, gsShim)).toBe(false);
    const a = fertScene({ base: TILE_BY_KEY['v_633_ash_grass_block']!, sapY: 179, fx: 10 * 54, wallCols: [48, 52], wallRows: [153, 179] });
    expect(growAshTree(a.st, new RNG(11), 50, 179)).toBe(false);
    const m = fertScene({ base: TILE_BY_KEY['stone']!, sapY: 229, sapKey: GEM_SAP_KEY, wallCols: [48, 52], wallRows: [203, 229] });
    expect(growGemTree(m.st, new RNG(11), 50, 229, SHEET_ID(583))).toBe(false);
    const s = fertScene({ base: grassId(), sapY: 119, sapKey: 'v_595_sakura_sapling',
      wallCols: [48, 52], wallRows: [93, 119] });
    expect(growVanityTree(s.st, new RNG(11), 50, 119, false)).toBe(false);
    const w = fertScene({ base: grassId(), sapY: 119, sapKey: 'v_615_yellow_willow_sapling',
      wallCols: [48, 52], wallRows: [93, 119] });
    expect(growVanityTree(w.st, new RNG(11), 50, 119, true)).toBe(false);
    // 六景全数未动格（false 且无副效用）
    expect(t.st.get(50, 199)).toBe(T.SAPLING);
    expect(p.st.get(50, 159)).toBe(T.SAPLING);
    expect(a.st.get(50, 179)).toBe(T.SAPLING);
    expect(m.st.get(50, 229)).toBe(TILE_BY_KEY[GEM_SAP_KEY]);
    expect(s.st.get(50, 119)).toBe(TILE_BY_KEY['v_595_sakura_sapling']);
    expect(w.st.get(50, 119)).toBe(TILE_BY_KEY['v_615_yellow_willow_sapling']);
  });

  it('B2-F4：590 地表恒拒（案例首句 if(!underground) return false, WorldGen.cs:73462-73465）', () => {
    // 地表之上建石台+宝石苗（裸空气墙=0，不掺 WallTest 变量——修复前无此门会整档放行）
    const { g, st, sap } = fertScene({ base: TILE_BY_KEY['stone']!, sapY: 99,
      sapKey: GEM_SAP_KEY });
    cloudAt(g, 50, 99, 15);                              // 富集档同拒（门在 Grow 函数之前）
    expect(st.get(50, 99)).toBe(sap);
    expect(st.get(50, 99)).toBe(TILE_BY_KEY[GEM_SAP_KEY]);
  });

  it('B2-S1：underground 边界档对齐 num59>worldSurface-1——ws 行本身算地下（默认档反语义并验）', () => {
    // ① 宝石苗恰在世界面行（==groundLevel）：算地下 → 可成树（旧式 j>gl 判会丢掉该行）
    {
      const gemTree = SHEET_ID(583);
      const { g, st } = fertScene({ base: TILE_BY_KEY['stone']!, sapY: 130,
        sapKey: GEM_SAP_KEY, wallCols: [48, 52], wallRows: [104, 130] });
      cloudAt(g, 50, 130);
      expect(st.get(50, 130)).toBe(gemTree);
      expect(countRect(st, 49, 105, 51, 129, gemTree)).toBeGreaterThanOrEqual(5);
    }
    // ② 宝石苗在世界面上方一行（gl-1）：算地上 → 拒（与①共同钉死 >= 边界语义）
    {
      const { g, st, sap } = fertScene({ base: TILE_BY_KEY['stone']!, sapY: 129,
        sapKey: GEM_SAP_KEY, wallCols: [48, 52], wallRows: [103, 129] });
      cloudAt(g, 50, 129);
      expect(st.get(50, 129)).toBe(sap);
    }
    // ③ 同一边界在默认档的反向语义：行==gl 即地下 → 无豁免旗标时拒（旧 j>gl 会误放行）
    {
      const { g, st } = fertScene({ base: grassId(), sapY: 130, fx: 0 });
      cloudAt(g, 50, 130);
      expect(st.get(50, 130)).toBe(T.SAPLING);
    }
  });

  it('B2-S2：ntb 豁免——tile20 地下棕榈档 !notTheBees 拒 / notTheBees 成树（WorldGen.cs:73417）', () => {
    // 无旗标：underground && !ntb && !remix → case 内 continue（预门拒绝,不改格）
    {
      const { g, st, sap } = fertScene({ base: TILE_BY_KEY['sand']!, sapY: 159, fx: 6 * 54 });
      cloudAt(g, 50, 159);
      expect(st.get(50, 159)).toBe(sap);
    }
    // not the bees：豁免成立 → 地下成棕榈（wall=0 场景下同时验证 ignoreWalls 直通无害）
    {
      const palmTree = SHEET_ID(323);
      const { g, world, st } = fertScene({ base: TILE_BY_KEY['sand']!, sapY: 159, fx: 6 * 54 });
      world.seedFlags = { notTheBees: true };
      cloudAt(g, 50, 159);
      expect(st.get(50, 159)).toBe(palmTree);
      expect(countRect(st, 50, 134, 50, 158, palmTree)).toBeGreaterThanOrEqual(5);
    }
  });

  it('B2-S2：remix 豁免——tile20 地下默认档 !remix 拒 / remix 成树+登记 trees（WorldGen.cs:73424）', () => {
    {
      const { g, st, sap } = fertScene({ base: grassId(), sapY: 140, fx: 0 });
      cloudAt(g, 50, 140);
      expect(st.get(50, 140)).toBe(sap);
    }
    {
      const { g, world, st } = fertScene({ base: grassId(), sapY: 140, fx: 0 });
      world.seedFlags = { remix: true };
      cloudAt(g, 50, 140);
      expect(st.get(50, 140)).toBe(TREE_ID());
      expect(countRect(st, 49, 115, 51, 139, TREE_ID())).toBeGreaterThanOrEqual(5);
      expect(world.trees.length).toBeGreaterThanOrEqual(1);   // gsShim.genTrees=this.world.trees 登记
    }
  });
});
