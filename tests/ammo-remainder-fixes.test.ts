// 弹药余量 18 件补 B 批回归（docs/audit/item-audit-2026-08-22.md 补 B 章节 ❌ 项，
// 2026-08-22；标杆 Terarria1456/）：
//   ① Kill 爆炸三分支：246 刺炮弹（150 盒+2-5 枚 249 破片 :74609-74666）/
//      312 爆炸南瓜（尘盒 22 + 伤害盒 128×128 :73893-73953——补 B"22 盒重结算"
//      系误读，Damage 在 128 盒内跑）/ 514 钉弹（112 盒 owner 门 :73295-73340）
//   ② 沙枪 266 整链：三色砂换弹 +5 伤（PickAmmo :52680-52696;V1 复核校正锚）+ aiStyle10 物理
//      （AI_010 :55060-55160：60 update 直飞后 +0.2/update、终端 10、途经割草）+
//      Kill 落地放块（42→53/65→112/68→116/354→234 :75376-75470）
//   ③ 凝胶耗弹门（PickAmmo :52816-52816 projToShoot==85：每轮动画 30/6=5 发仅
//      首发扣 1——wiki"消耗一个凝胶发射五次"）
//   ④ 双职件投掷门：雪球 949 可掷（useStyle1+shoot166）/ 金币 71-74 不可掷
//      （Player.cs:46473 IsACoin → canShoot=false——补 B"金币可投掷"系误读）
//   ⑤ 橡实种弹 1088：ai0>10 重力弧（AI_016 :44881-44901）+ 撞块种树
//      （CanAcornPlant :44206-44246 / Kill :70507-70530）
//   ⑥ 迷你核弹伤害盒 25（Kill :74246-74263 Resize(50,50)，曾恒 11）
//   ⑦ 坠落星 75 点击消耗（useStyle4+consumable，:42602 门无豁免）
import { describe, it, expect, vi } from 'vitest';   // ★BJ731:vi=DV 恒等档 mock
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import { Arrow } from '../src/entities/Arrow';
import { GrenadeProj } from '../src/entities/WeaponProj';
import { Game, PREPARE_BOMB_HURT_BOX } from '../src/core/Game';
import { itemCombat, thrownCombat, resolveAmmoProjId, resolveSandGunSwap } from '../src/data/vanillaItemCombat';
import { projectileData } from '../src/data/vanillaProjectiles';
import type { GameHooks } from '../src/entities/types';

const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const playerSrc = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8');

type DustLike = { vx: number; vy: number; noGravity: boolean; scale: number };

/** onProjectileDeath 零场桩（Object.create(Game.prototype) 模式，同 buff-partial-fixes） */
function mkDeathGame(opts?: {
  px?: number; py?: number; hostilePlayer?: boolean;
  enemies?: Array<Record<string, unknown>>; dusts?: DustLike[];
}) {
  const hurt: Array<[number, number]> = [];       // [受击敌 y 序号, 伤害]
  const playerDamage: number[] = [];
  const sfx: string[] = [];
  const dusts = opts?.dusts ?? [];
  const spawned: Array<{ kind: string; projId?: number; vx?: number; vy?: number }> = [];
  const enemies = (opts?.enemies ?? []).map((e, i) => ({
    dead: false, cx: 0, cy: 0, w: 20, h: 20, ...e,
    hurt: (dmg: number) => { hurt.push([i, dmg]); return true; },
  }));
  const g = Object.create(Game.prototype) as unknown as {
    onProjectileDeath: (...a: unknown[]) => void;
  } & Record<string, unknown>;
  g.player = {
    dead: false,
    cx: opts?.px ?? 0, cy: opts?.py ?? 0, x: (opts?.px ?? 0) - 10, y: (opts?.py ?? 0) - 21,
    w: 20, h: 42, equipStats: {},
  };
  g.entities = { enemies, critters: [], projectiles: [], add: (_e: unknown, _b: string) => {} };
  g.playSfxFiles = (names: string[]) => { sfx.push(...names); };
  g.sfx = { play: () => {} };   // 31/42 沙块弹 Kill 音尘支（:77809 dig 音）桩补齐（Kill 消亡面批 2026-09-02）
  g.spawnDust = () => {
    const d: DustLike = { vx: 1, vy: 1, noGravity: false, scale: 1 };
    dusts.push(d);
    return d;
  };
  g.damagePlayer = (dmg: number) => { playerDamage.push(dmg); return 0; };
  return { g, hurt, playerDamage, sfx, dusts, spawned };
}

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

/** GrenadeProj/Arrow 仿真桩（同 launcher-ammo-parity harness） */
function makeSimGame(w: World): GameHooks {
  return {
    world: w, player: null as unknown, enemies: () => [], critters: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    breakTile: (x: number, y: number) => w.store.setTile(x, y, 0),
  } as unknown as GameHooks;
}

// ---------------------------------------------------------------------------
// ① Kill 爆炸三分支（246/312/514）
// ---------------------------------------------------------------------------
describe('① Kill 爆炸三分支（onProjectileDeath）', () => {
  const mkEnemy = (cx: number, cy: number) => ({ cx, cy, x: cx - 10, y: cy - 10, w: 20, h: 20 });

  it('246 刺炮弹：判定盒 150×150（半宽 75）——70px 内结算 / 90px 外不结算', () => {
    const near = mkDeathGame({ enemies: [mkEnemy(1000 + 70, 1000), mkEnemy(1000 + 90, 1000)] });
    // ★BJ731 改判史（2026-10-27）：爆箱伤走 explodeNpcDamageChain :12970 DV 掷
    //   （BJ723-B/BJ716-A 落地面）——0.5 恒等档钉 17（未 mock 必漂 14-19）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      near.g.onProjectileDeath(246, 1000 - 5, 1000 - 5, 10, 10, 5, 0, 17, { arpen: 0 });
    } finally { rvi731.mockRestore(); }
    expect(near.hurt.map(([i]) => i)).toEqual([0]);          // 仅 70px 内敌
    expect(near.hurt[0]?.[1]).toBe(17);
    expect(near.sfx).toContain('Item_14');
  });

  it('246 破片：owner 本机 → 2-5 枚 249、伤继承、速度模长 8、出生 = 中心−oldVel', () => {
    const shards: Array<{ projId?: number; vx?: number; vy?: number; damage?: number }> = [];
    const d = mkDeathGame({});
    d.g.entities = {
      enemies: [], critters: [], projectiles: [],
      add: (e: { projId?: number; vx?: number; vy?: number; damage?: number }) => {
        if (e?.projId === 249) shards.push(e);
      },
    };
    d.g.onProjectileDeath(246, 2000 - 5, 2000 - 5, 10, 10, 4, -3, 25, {});
    expect(shards.length).toBeGreaterThanOrEqual(2);
    expect(shards.length).toBeLessThanOrEqual(5);            // Next(2,6) = 2..5（:74653）
    for (const s of shards) {
      expect(s.damage).toBe(25);                             // 伤继承（NewProjectile 第 6 参）
      expect(Math.hypot(s.vx ?? 0, s.vy ?? 0)).toBeCloseTo(8, 6);   // 归一 ×8（:74659-74662）
    }
  });

  it('246 敌对弹：判定盒结算玩家（无 owner 门），不撒破片', () => {
    const d = mkDeathGame({ px: 3000, py: 3000 });
    const shards: unknown[] = [];
    d.g.entities = {
      enemies: [], critters: [], projectiles: [],
      add: (e: { projId?: number }) => { if (e?.projId === 249) shards.push(e); },
    };
    d.g.onProjectileDeath(246, 3000 - 5, 3000 - 5, 10, 10, 0, 0, 30, { hostile: true });
    expect(d.playerDamage).toEqual([30]);
    expect(shards).toHaveLength(0);
  });

  it('312 爆炸南瓜：伤害盒 128×128（半宽 64）——60px 内 / 80px 外（补 B"22 盒"系尘盒误读）', () => {
    const d = mkDeathGame({ enemies: [mkEnemy(4000 + 60, 4000), mkEnemy(4000 + 80, 4000)] });
    // ★BJ731 改判史（2026-10-27）：同 246——DV 恒等档钉 60。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      d.g.onProjectileDeath(312, 4000 - 16, 4000 - 16, 32, 32, 0, 0, 60, {});
    } finally { rvi731.mockRestore(); }
    expect(d.hurt.map(([i]) => i)).toEqual([0]);
    expect(d.hurt[0]?.[1]).toBe(60);
    expect(d.sfx).toContain('Item_14');
  });

  it('514 钉弹：伤害盒 112×112（半宽 56）owner 门——友方结算 / 敌对弹整段不结算', () => {
    const friendly = mkDeathGame({ enemies: [mkEnemy(5000 + 50, 5000), mkEnemy(5000 + 70, 5000)] });
    friendly.g.onProjectileDeath(514, 5000 - 5, 5000 - 5, 10, 10, 0, 0, 40, {});
    expect(friendly.hurt.map(([i]) => i)).toEqual([0]);
    const hostile = mkDeathGame({ enemies: [mkEnemy(6000 + 10, 6000)], px: 6000, py: 6000 });
    hostile.g.onProjectileDeath(514, 6000 - 5, 6000 - 5, 10, 10, 0, 0, 40, { hostile: true });
    expect(hostile.hurt).toHaveLength(0);                    // owner==myPlayer 整段门（:73326）
    expect(hostile.playerDamage).toHaveLength(0);
  });

  it('三分支数据锚：246 aiStyle1 / 312 aiStyle1 / 514 aiStyle93 pen3（vanilla-projectiles 表）', () => {
    expect(projectileData(246)?.aiStyle).toBe(1);
    expect(projectileData(312)?.aiStyle).toBe(1);
    expect(projectileData(514)?.aiStyle).toBe(93);
    expect(projectileData(514)?.penetrate).toBe(3);
    expect(projectileData(249)?.aiStyle).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ② 沙枪 266 整链
// ---------------------------------------------------------------------------
describe('② 沙枪三色砂换弹（PickAmmo :52666-52678）', () => {
  it('黑檀砂 370→65 / 猩红砂 408→68 / 化石 1246→354，各 +5 伤', () => {
    expect(resolveSandGunSwap(266, 42, 370)).toEqual({ projId: 65, bonus: 5 });
    expect(resolveSandGunSwap(266, 42, 408)).toEqual({ projId: 68, bonus: 5 });
    expect(resolveSandGunSwap(266, 42, 1246)).toEqual({ projId: 354, bonus: 5 });
  });

  it('普通沙 169 恒 42 不加伤；非沙枪发射器/非 42 基弹返回 null', () => {
    expect(resolveSandGunSwap(266, 42, 169)).toBeNull();
    expect(resolveSandGunSwap(98, 14, 370)).toBeNull();      // 迷你鲨+黑檀砂（无此链）
    expect(resolveSandGunSwap(266, 65, 370)).toBeNull();
  });

  it('resolveAmmoProjId：沙枪 266 + 沙 169 → 基弹 42（发射器 shoot 保留语义）', () => {
    expect(resolveAmmoProjId(266, 169, 169, 42, 0)).toBe(42);
    expect(itemCombat(266)?.useAmmo).toBe(169);
    expect(itemCombat(266)?.shoot).toBe(42);
  });
});

describe('②b 沙球 aiStyle10 物理（AI_010 :55060-55160）', () => {
  it('60 update 直飞后 +0.2/update（ai[1]≥60 门 :55071-55075），终端 10', () => {
    const game = makeSimGame(emptyWorld());
    const b = new Arrow(10 * TILE, 100 * TILE, 12, 0, 30, 5, 42, {});
    // 42 extraUpdates=1（json）→ 每 tick 2 子步 = ai[1] +2/tick → 第 30 tick 触发
    for (let t = 0; t < 29 && !b.dead; t++) b.fixedUpdate(1, game);
    expect(b.vy).toBe(0);                        // ai[1] 1..58 < 60 直飞
    b.fixedUpdate(1, game);                      // 子步 59,60 → ai[1]=60 首拍 +0.2
    expect(b.vy).toBeCloseTo(0.2, 6);
    for (let t = 0; t < 400 && b.vy < 10 && !b.dead; t++) b.fixedUpdate(1, game);
    expect(b.vy).toBe(10);                       // 终端 10（:55151-55154）
  });

  it('途经草族/装饰 KillTile（:55114-55120 表 185-187/165/12/665/639/105/178）', () => {
    const w = emptyWorld();
    const deco = TILE_INTERNAL_BY_SHEET.get(185);
    expect(deco).toBeDefined();
    w.store.setTileSilent(20, 100, deco!, 0, 0);
    const game = makeSimGame(w);
    const b = new Arrow(18 * TILE, 100 * TILE + 4, 8, 0, 30, 5, 42, {});
    for (let t = 0; t < 40 && !b.dead; t++) b.fixedUpdate(1, game);
    expect(w.store.isActive(20, 100)).toBe(false);           // 途经即破坏
  });

  it('四沙球族自动激活（ctor 按 aiStyle10 表）+ PROJ_SPIN 恒滚 0.1', () => {
    const game = makeSimGame(emptyWorld());
    for (const pid of [42, 65, 68, 354]) {
      const b = new Arrow(10 * TILE, 100 * TILE, 12, 0, 30, 5, pid, {});
      expect((b as unknown as { sandBall: boolean }).sandBall, `proj ${pid}`).toBe(true);
      expect(projectileData(pid)?.aiStyle).toBe(10);
    }
    const b = new Arrow(10 * TILE, 100 * TILE, 12, 0, 30, 5, 14, {});   // 子弹对照
    expect((b as unknown as { sandBall: boolean }).sandBall).toBe(false);
  });
});

describe('②c Kill 落地放块（:75376-75470 aiStyle 10 支）', () => {
  it('42 → 53 沙块：中心空格落地放置', () => {
    const w = emptyWorld();
    const sandTile = TILE_INTERNAL_BY_SHEET.get(53);
    expect(sandTile).toBeDefined();
    const d = mkDeathGame({});
    d.g.world = w;
    d.g.chunks = { markDirtyArea: () => {} };
    d.g.onProjectileDeath(42, 30 * TILE + 3, 189 * TILE + 8, 10, 10, 8, 2, 30, {});
    expect(w.store.get(30, 189)).toBe(sandTile);
  });

  it('65/68/354 → 112/116/234 映射；目标被占不放置（num1108=0 不掉落）', () => {
    const w = emptyWorld();
    const d = mkDeathGame({});
    d.g.world = w;
    d.g.chunks = { markDirtyArea: () => {} };
    const cases: Array<[number, number]> = [[65, 112], [68, 116], [354, 234]];
    cases.forEach(([proj, sheet], i) => {
      const tid = TILE_INTERNAL_BY_SHEET.get(sheet);
      expect(tid, `sheet ${sheet}`).toBeDefined();
      const tx = 20 + i * 4;
      d.g.onProjectileDeath(proj, tx * TILE + 3, 189 * TILE + 8, 10, 10, 0, 2, 30, {});
      expect(w.store.get(tx, 189)).toBe(tid);
    });
    // 已占用格（石块）不覆写
    w.store.setTileSilent(40, 189, 1, 0, 0);
    d.g.onProjectileDeath(42, 40 * TILE + 3, 189 * TILE + 8, 10, 10, 0, 2, 30, {});
    expect(w.store.get(40, 189)).toBe(1);
  });

  it('下方轨道 314 → flag9 不放置（沙会塌落，:75499-75516）', () => {
    const w = emptyWorld();
    const track = TILE_INTERNAL_BY_SHEET.get(314);
    expect(track).toBeDefined();
    w.store.setTileSilent(50, 190, track!, 0, 0);
    const d = mkDeathGame({});
    d.g.world = w;
    d.g.chunks = { markDirtyArea: () => {} };
    d.g.onProjectileDeath(42, 50 * TILE + 3, 189 * TILE + 8, 10, 10, 0, 2, 30, {});
    expect(w.store.isActive(50, 189)).toBe(false);
  });

  it('半砖上落点：下落主导 → 上移一格放置（:75476-75480）', () => {
    const w = emptyWorld();
    const sandTile = TILE_INTERNAL_BY_SHEET.get(53)!;
    w.store.setTileSilent(60, 190, sandTile, 0, 0);
    w.store.half[w.store.idx(60, 190)] = 1;                  // 半砖
    const d = mkDeathGame({});
    d.g.world = w;
    d.g.chunks = { markDirtyArea: () => {} };
    d.g.onProjectileDeath(42, 60 * TILE + 3, 189 * TILE + 12, 10, 10, 0, 5, 30, {});
    expect(w.store.get(60, 189)).toBe(sandTile);             // 落在半砖上方
  });
});

// ---------------------------------------------------------------------------
// ③ 凝胶耗弹门（PickAmmo :52816-52818）
// ---------------------------------------------------------------------------
describe('③ 凝胶耗弹门（projToShoot==85 每轮动画仅首发扣）', () => {
  it('506 火焰喷射器 30/6=5：消耗序列 T-F-F-F-F-T（每 5 发 1 凝胶）', () => {
    const g = Object.create(Game.prototype) as unknown as {
      flameGelConsumesThisShot: (id: number, anim: number, time: number) => boolean;
    };
    const seq: boolean[] = [];
    for (let i = 0; i < 10; i++) seq.push(g.flameGelConsumesThisShot(777, 30, 6));
    expect(seq).toEqual([true, false, false, false, false, true, false, false, false, false]);
  });

  it('换持武器重计（新一轮起手首发必扣）', () => {
    const g = Object.create(Game.prototype) as unknown as {
      flameGelConsumesThisShot: (id: number, anim: number, time: number) => boolean;
    };
    expect(g.flameGelConsumesThisShot(506, 30, 6)).toBe(true);
    expect(g.flameGelConsumesThisShot(506, 30, 6)).toBe(false);
    expect(g.flameGelConsumesThisShot(1910, 30, 6)).toBe(true);   // 精灵熔炉换枪 → 重计
    expect(g.flameGelConsumesThisShot(1910, 30, 6)).toBe(false);
  });

  it('消耗段接线：projId===85 门在 removeAt 条件链内（源码锚）', () => {
    expect(gameSrc).toContain('flameGelConsumesThisShot');
    expect(gameSrc).toContain('projId === 85 && !this.flameGelConsumesThisShot');
  });
});

// ---------------------------------------------------------------------------
// ④ 双职件投掷门（thrownCombat）
// ---------------------------------------------------------------------------
describe('④ 双职件投掷门（金币 IsACoin 门 / 雪球可掷）', () => {
  const mkDef = (vid: number) => ({ vid, key: `vi_${vid}_x` });

  it('雪球 949 可掷：shoot 166 / 伤 8（Item.cs:12337-12353 useStyle1）', () => {
    expect(thrownCombat(mkDef(949))).toEqual({ shoot: 166, damage: 8 });
    expect(itemCombat(949)?.ammo).toBe(949);                 // 同时是雪球炮 1319 弹药
  });

  it('金币 71-74 不可掷（Player.cs:46473 IsACoin → canShoot=false；补 B"可投掷"系误读）', () => {
    for (const vid of [71, 72, 73, 74]) {
      expect(thrownCombat(mkDef(vid)), `coin ${vid}`).toBeNull();
    }
  });

  it('种子 283 等无 useStyle 弹药件不误开（noMelee 缺失照旧排除）；手里剑 42 回归不破', () => {
    expect(thrownCombat(mkDef(283))).toBeNull();             // 种子（无 noMelee）
    expect(thrownCombat(mkDef(42))?.shoot).toBe(3);          // 手里剑（既有投掷链不回归）
    expect(thrownCombat(mkDef(23))).toBeNull();              // 凝胶无 shoot
  });
});

// ---------------------------------------------------------------------------
// ⑤ 橡实种弹 1088（5629 橡实弹弓）
// ---------------------------------------------------------------------------
describe('⑤ 橡实种弹 1088：重力弧 + 撞块种树', () => {
  it('ai0>10 重力弧（AI_016 :44881-44901）：前 10 拍平飞，第 11 拍起 vy+0.2', () => {
    const game = makeSimGame(emptyWorld());
    const g = new GrenadeProj(10 * TILE, 40 * TILE, 8, 0, 5, 3600, 1088, () => {});
    g.fired = true;
    for (let t = 0; t < 10 && !g.dead; t++) g.fixedUpdate(1, game);
    expect(g.vy).toBe(0);
    g.fixedUpdate(1, game);
    expect(g.vy).toBeCloseTo(0.2, 6);
  });

  it('撞块 + 可种 → Kill 走种植路径（onExplode 收到种前速度，:18342-18346）', () => {
    const w = emptyWorld();
    for (let x = 20; x < 40; x++) w.store.setTileSilent(x, 45, 1, 0, 0);   // 前方墙
    const game = makeSimGame(w);
    const deaths: Array<[number, number, number, number | undefined, number | undefined]> = [];
    const g = new GrenadeProj(18 * TILE, 44 * TILE + 8, 6, 0, 5, 3600, 1088,
      (x, y, d, ovx, ovy) => deaths.push([x, y, d, ovx, ovy]));
    g.fired = true;
    (g as unknown as { bouncePlantCheck: (cx: number, cy: number) => boolean }).bouncePlantCheck =
      () => true;
    for (let t = 0; t < 60 && !g.dead; t++) g.fixedUpdate(1, game);
    expect(g.dead).toBe(true);
    expect(deaths).toHaveLength(1);
    expect(deaths[0]?.[3]).toBe(6);                          // oldVelocity = 入撞前速度
  });

  it('canAcornPlant：草面（sheet2）上方两格空 → 种植点=草上一格；石面/上方堵死 → null', () => {
    const w = emptyWorld();
    const grass = TILE_INTERNAL_BY_SHEET.get(2)!;
    w.store.setTileSilent(70, 100, grass, 0, 0);
    const d = mkDeathGame({});
    d.g.world = w;
    // 域私有方法经原型桩调用（world 注入）
    const proto = Object.create(Game.prototype) as unknown as {
      canAcornPlant: (cx: number, cy: number) => { x: number; y: number } | null;
      world: World;
    };
    proto.world = w;
    expect(proto.canAcornPlant(70 * TILE + 8, 99 * TILE + 8)).toEqual({ x: 70, y: 99 });
    // 上方一格被实心堵死 → 不可种
    w.store.setTileSilent(70, 98, 1, 0, 0);
    expect(proto.canAcornPlant(70 * TILE + 8, 99 * TILE + 8)).toBeNull();
  });

  it('acornSeedDeath：可种 → 放苗 tile20；不可种 → 掉落橡实 27（:70507-70530）', () => {
    const w = emptyWorld();
    const grass = TILE_INTERNAL_BY_SHEET.get(2)!;
    const sapling = TILE_INTERNAL_BY_SHEET.get(20)!;
    expect(sapling).toBeDefined();
    w.store.setTileSilent(80, 100, grass, 0, 0);
    const d = mkDeathGame({});
    d.g.world = w;
    d.g.chunks = { markDirtyArea: () => {} };
    const drops: string[] = [];
    d.g.spawnDrop = (x: number, y: number, key: string) => { drops.push(key); return null; };
    d.g.sfx = { play: () => {} };
    const proto = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    Object.assign(proto, d.g);
    (proto.acornSeedDeath as (a: number, b: number, c: number, e: number) => void)
      .call(proto, 80 * TILE + 8, 99 * TILE + 8, 0, 0);
    expect(w.store.get(80, 99)).toBe(sapling);               // PlaceTile(20) 域
    expect(drops).toHaveLength(0);
    // 无锚点（石面）→ 掉橡实
    w.store.setTileSilent(82, 100, 1, 0, 0);
    (proto.acornSeedDeath as (a: number, b: number, c: number, e: number) => void)
      .call(proto, 82 * TILE + 8, 99 * TILE + 8, 0, 0);
    expect(drops).toEqual(['vi_27_Acorn']);
  });

  it('数据链：5629 橡实弹弓 shoot 1088 / useAmmo 27（EXTRACT_PATCH :65）', () => {
    expect(itemCombat(5629)?.shoot).toBe(1088);
    expect(itemCombat(5629)?.useAmmo).toBe(27);
    expect(projectileData(1088)?.aiStyle).toBe(16);
  });

  it('5629 恒耗弹（PickAmmo :52806 flag2=false 压制省弹掷）——主链与 ai16 链双接线', () => {
    expect(gameSrc.match(/bowVid2 !== 5629/g)?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 迷你核弹伤害盒 + ⑦ 坠落星消耗
// ---------------------------------------------------------------------------
describe('⑥ 迷你核弹伤害盒（SW-R3 2026-09-03 M-4 重锚:PrepareBombToBlow :47684-47688 Resize(250,250)）', () => {
  it('伤盒=PrepareBombToBlow 半宽 125（旧 25 系 Kill :79630 尘盒 50/2 混用）;809 不在分支→7', () => {
    expect(PREPARE_BOMB_HURT_BOX[793]).toBe(125);
    expect(PREPARE_BOMB_HURT_BOX[796]).toBe(125);
    expect(PREPARE_BOMB_HURT_BOX[808]).toBe(125);
    expect(PREPARE_BOMB_HURT_BOX[809]).toBeUndefined();   // 原文字面 `808 || 808` 无 809
    expect(gameSrc).toContain('PREPARE_BOMB_HURT_BOX');
  });

  it('音效分档：794/797 = Item62 炮声（:74247-74251），余型 Item14', () => {
    expect(gameSrc).toMatch(/projId === 794 \|\| projId === 797/);
  });

  it('Specific 表：4457→793/4458→796（五发射器全表既有，不回归）', () => {
    expect(resolveAmmoProjId(759, 4457, 771, 134, 0)).toBe(793);
    expect(resolveAmmoProjId(759, 4458, 771, 134, 0)).toBe(796);
  });
});

describe('⑦ 坠落星 75 点击消耗（:42602 门无豁免）', () => {
  it('use 分支接线（源码锚）+ 数据面 useStyle4 档 useTime 17', () => {
    expect(gameSrc).toMatch(/heldDef\.vid \?\? -1\) === 75/);   // ★方案 A 重锚(BJ265):vid 直读
    expect(itemCombat(75)?.useTime).toBe(17);
    expect(itemCombat(75)?.useAnimation).toBe(17);
    expect(itemCombat(75)?.consumable).toBe(true);
  });

  it('金币枪币槽优先扫描接线（PickAmmo :52593-52605 前置环）', () => {
    // 2026-08-23 弹药轮换批：扫描收拢进 Player.pickAmmoSlot（PickAmmo_PickAmmoItem
    // :54368-54390）——币族前置环 = AmmoSlots 模式币槽序分支（Player.cs:3180/:54372）
    expect(gameSrc).toMatch(/pickAmmoSlot\(ammoMatch, useAmmo/);
    expect(playerSrc).toMatch(/useAmmo === 71 \? AMMO_SLOT_ORDER_COINS_ONLY : AMMO_SLOT_ORDER_AMMO_ONLY/);
  });
});
