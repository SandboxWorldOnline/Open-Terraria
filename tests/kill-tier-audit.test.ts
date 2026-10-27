// Kill 消亡面清偿批金标（2026-09-02，Projectile.cs:76329-78993 分档链缺口补齐）：
//   ① 283 VenomBullet Kill（:77513-77580）：Item10 + 30×d171 三组各 10（scale=
//      Next(1,10)×0.1 直赋/noGravity/fadeIn1.5;组1 v×0.75;组2 +oldV×0.5×rand;
//      组3 v×1.5+oldV×1.5×rand）+ owner 门三连 Damage 等价——80×80 盒沿 oldV 归一向
//      步进 60px 三段独立结算（283 无 local/ID-static 免疫表 → 同敌可三跳;pierce=1
//      → Enemy.hurt 豁免免疫帧）
//   ② 639 月总箭 Kill（:74813-74842）：d220×Next(5,9)（α100/noGravity/scale0.5）+
//      owner 侧衍生 640（出生位=localAI[0]/[1]、初速=ai[0]/[1] 快照 P.cs:56381-56386）
//   ③ 9 星怒天降星（:77259-77318 else 支）：Item10 + 10×d58（v×0.1、α150、scale1.2）
//      + 3×gore Next(16,18)（右开={16,17}、v×0.05）
//   ④ 80 冰雪魔杖冰弹（:77106-77124）：Item27 + 10×d67 + 弹心格 tile 127 → KillTile
//   ⑤ 712 彩虹水晶碎片（:77714-77746）：Item10 + rand(6,12)×d15（scale1 直赋/
//      fadeIn1.5/noGravity/色 (255,255,255,0)×0.3=XNA (76,76,76,0) 纯加算）+ 3×gore 1008
//   ⑥ 119/359/118（:76868-76886）：Item27 + d92×20（119/359）/×10（118）
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { TILE_DEFS, TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import { VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { Arrow, BULLET_KILL_SFX } from '../src/entities/Arrow';
import { Dart } from '../src/entities/Dart';
import { GorePiece } from '../src/entities/GorePiece';
import { Game } from '../src/core/Game';
import { VanillaDust } from '../src/fx/VanillaDust';
import type { GameHooks } from '../src/entities/types';

interface DustRec {
  type: number; alpha: number; scale: number; noGravity: boolean;
  sx: number; sy: number; fadeIn: number; color: unknown;
  vx: number; vy: number; x: number; y: number;
}

interface HurtRec { dmg: number; pierce: number; fromPlayer: boolean; }

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

/** Arrow 仿真桩（同 arrow-flight-trail-dust harness + 敌集/实体桶扩展） */
function makeGame(w: World, dusts: DustRec[], bucket: unknown[] = [],
  enemies: unknown[] = [], critters: unknown[] = []) {
  return {
    world: w, player: null as unknown, enemies: () => enemies, critters: () => critters,
    projectiles: () => [],
    entities: { nextId: 1, add: (e: unknown) => { bucket.push(e); } },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    addLightAt: () => {},
    onProjectileDeath: () => {},
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
      sx = 0, sy = 0, alpha = 0, c: unknown = null, scale = 1, ng = false) => {
      const d: DustRec = { type, alpha, scale, noGravity: !!ng, sx, sy, fadeIn: 0,
        color: c, vx: 0, vy: 0, x: 0, y: 0 };
      dusts.push(d);
      return d;
    },
    broadcastParticleOrchestra: () => {},
  } as unknown as GameHooks;
}

/** onProjectileDeath 零场桩（Object.create(Game.prototype) 模式,同 ammo-remainder-fixes） */
function mkDeathGame(opts?: {
  world?: World; enemies?: Array<Record<string, unknown>>;
}) {
  const dusts: DustRec[] = [];
  const sfx: string[] = [];
  const brokenTiles: Array<[number, number]> = [];
  const hurt: HurtRec[] = [];
  const enemies = (opts?.enemies ?? []).map((e) => ({
    dead: false, x: 0, y: 0, w: 20, h: 20, ...e,
    hurt: (dmg: number, _kbx: number, _kby: number, _g: unknown,
      _ap: number, _c: boolean, pierce = 0, fromPlayer = false) => {
      hurt.push({ dmg, pierce, fromPlayer });
      return true;
    },
  }));
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  g.player = { dead: false, cx: 0, cy: 0, x: -10, y: -21, w: 20, h: 42, equipStats: {} };
  g.entities = { enemies, critters: [], projectiles: [], add: () => {} };
  g.world = opts?.world ?? emptyWorld();
  g.vanillaDust = new VanillaDust();   // ★BJ444：hitTilesFx 尘面=原版尘池（spawnTileDustAt 消费）
  g.sfx = { play: (name: string) => { sfx.push(name); } };
  g.playSfxFiles = (names: string[]) => { sfx.push(...names); };
  g.spawnDust = (_x: number, _y: number, _w: number, _h: number, type: number,
    sx = 0, sy = 0, alpha = 0, c: unknown = null, scale = 1, ng = false) => {
    const d: DustRec = { type, alpha, scale, noGravity: !!ng, sx, sy, fadeIn: 0,
      color: c, vx: 1, vy: 1, x: 0, y: 0 };
    dusts.push(d);
    return d;
  };
  g.breakTile = (x: number, y: number) => { brokenTiles.push([x, y]); };
  g.damagePlayer = (): number => 0;
  return { g: g as unknown as { onProjectileDeath: (...a: unknown[]) => void },
    dusts, sfx, brokenTiles, hurt };
}

function kill(a: Arrow, game: GameHooks): void {
  (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
}

/** ★BJ444：vanillaDust 池活粒读取（hitTilesFx 尘面 spy——旧 spawnParticles 色点近似退役） */
function poolDusts(g: unknown): Array<{ type: number }> {
  const pool = (g as { vanillaDust: { pool: Array<{ active: boolean; type: number }> } }).vanillaDust.pool;
  return pool.filter((d) => d.active).map((d) => ({ type: d.type }));
}

describe('Kill 消亡面清偿批金标（2026-09-02）', () => {
  it('① 283：Item_10 + 30×d171 三组结构（scale∈[0.1,0.9]/fadeIn1.5/noGravity;组1 零附加、组2/3 oldV 附加）', () => {
    const dusts: DustRec[] = [];
    const game = makeGame(emptyWorld(), dusts);
    const a = new Arrow(400, 300, 6, 0, 30, 1, 283, { grav: 0 });
    kill(a, game);
    const d171 = dusts.filter((d) => d.type === 171);
    expect(d171.length).toBe(30);
    expect(d171.every((d) => d.noGravity && d.fadeIn === 1.5
      && d.scale >= 0.1 - 1e-9 && d.scale <= 0.9 + 1e-9)).toBe(true);
    const g1 = dusts.slice(0, 10).filter((d) => d.type === 171);
    const g2 = dusts.slice(10, 20).filter((d) => d.type === 171);
    const g3 = dusts.slice(20, 30).filter((d) => d.type === 171);
    // 组1 仅 ×0.75（本仓桩初速 0 → 恒 0）；组2/3 += oldV×k×rand（v=6 → 组2 ≤3、组3 ≤9）
    expect(g1.every((d) => Math.abs(d.vx) < 1e-9 && Math.abs(d.vy) < 1e-9)).toBe(true);
    expect(g2.every((d) => d.vx >= -1e-9 && d.vx <= 3 + 1e-9)).toBe(true);
    expect(g3.every((d) => d.vx >= -1e-9 && d.vx <= 9 + 1e-9)).toBe(true);
    expect(g2.some((d) => d.vx > 0)).toBe(true);
    expect(g3.some((d) => d.vx > 3)).toBe(true);
  });

  it('① 283 三连 Damage 等价：段心 405/465/525（步进 60px、盒 ±40+敌半宽 10）——中段敌两跳、段0 敌一跳、远敌不结算;pierce=1/fromPlayer', () => {
    const dusts: DustRec[] = [];
    const mkEnemy = (cx: number) => {
      const rec: { hits: HurtRec[] } = { hits: [] };
      const e = {
        x: cx - 10, y: 300, w: 20, h: 20, dead: false, vanillaId: 0, rec,
        hurt: (dmg: number, _kbx: number, _kby: number, _g: unknown, _ap: number,
          _c: boolean, pierce = 0, fromPlayer = false) => {
          rec.hits.push({ dmg, pierce, fromPlayer });
          return true;
        },
      };
      return e;
    };
    const seg0 = mkEnemy(405);   // 仅段0（|405−465|=60 > 50）
    const mid = mkEnemy(495);    // 段1+段2（|495−465|=30 / |495−525|=30）
    const beyond = mkEnemy(700); // 三段全不覆盖
    const game = makeGame(emptyWorld(), dusts, [], [seg0, mid, beyond]);
    const a = new Arrow(400, 300, 6, 0, 30, 1, 283, { grav: 0 });
    // ★BJ731 改判史（2026-10-27）：三段 Damage 重结算各掷 :12970 DV（BJ723-B
    //   落地面）——等价断言须恒等档 0.5 钉（未 mock 三段各漂,等价必红）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      kill(a, game);
    } finally { rvi731.mockRestore(); }
    expect(seg0.rec.hits).toHaveLength(1);
    expect(mid.rec.hits).toHaveLength(2);
    expect(beyond.rec.hits).toHaveLength(0);
    for (const e of [seg0, mid]) {
      expect(e.rec.hits.every((h) => h.pierce === 1 && h.fromPlayer && h.dmg === 30)).toBe(true);
    }
  });

  it('① 283 面单口性：Game.onProjectileDeath 无 283 分档（双触发防护）', () => {
    const mk = (cx: number) => ({ x: cx - 10, y: 290, w: 20, h: 20, dead: false, vanillaId: 0 });
    const d = mkDeathGame({ enemies: [mk(400)] });
    d.g.onProjectileDeath(283, 395, 295, 10, 10, 6, 0, 30, {});
    expect(d.hurt).toHaveLength(0);
    expect(d.sfx).toHaveLength(0);
  });

  it('② 639：Kill 撒 d220×5..9（α100/noGravity/scale0.5）+ owner 侧衍生 640（出生位/初速=快照）', () => {
    const dusts: DustRec[] = [];
    const bucket: Array<{ projId?: number; x?: number; vx?: number; vy?: number;
      damage?: number; alpha?: number }> = [];
    const game = makeGame(emptyWorld(), dusts, bucket);
    const a = new Arrow(400, 300, 6, 0, 30, 1, 639, { grav: 0, life: 600 });
    for (let i = 0; i < 2 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    const snap = a as unknown as { moonArrowL0: number; moonArrowL1: number;
      moonArrowA0: number; moonArrowA1: number };
    expect(snap.moonArrowL0).toBeCloseTo(405, 6);            // 出生心快照（x=400+5）
    expect(snap.moonArrowA0).toBeCloseTo(6, 6);
    kill(a, game);
    const d220 = dusts.filter((d) => d.type === 220);
    expect(d220.length).toBeGreaterThanOrEqual(5);
    expect(d220.length).toBeLessThanOrEqual(9);
    expect(d220.every((d) => d.alpha === 100 && d.noGravity && Math.abs(d.scale - 0.5) < 1e-9)).toBe(true);
    const derived = bucket.filter((e) => e.projId === 640);
    expect(derived).toHaveLength(1);
    expect(derived[0].x).toBeCloseTo(405, 6);                // localAI[0]（top-left=Center 怪癖按原文）
    expect(derived[0].vx).toBeCloseTo(6, 6);
    expect(derived[0].damage).toBe(30);
    expect(derived[0].alpha).toBe(255);                      // PROJ_ALPHA0[640]（SetDefaults :6902）
  });

  it('③ 9：Item_10 + 10×d58（v×0.1、α150、scale1.2）+ 3×gore Next(16,18)（v×0.05）', () => {
    const dusts: DustRec[] = [];
    const d = mkDeathGame({});
    const goreSpy = vi.spyOn(GorePiece, 'newGore');
    d.g.onProjectileDeath(9, 1000 - 12, 1000 - 12, 24, 24, 5, -2, 20, {});
    const goreCalls = goreSpy.mock.calls;
    goreSpy.mockRestore();
    expect(d.sfx.filter((s) => s === 'Item_10')).toHaveLength(1);
    const d58 = d.dusts.filter((x) => x.type === 58);
    expect(d58).toHaveLength(10);
    expect(d58.every((x) => x.alpha === 150 && Math.abs(x.scale - 1.2) < 1e-9
      && Math.abs(x.sx - 0.5) < 1e-9 && Math.abs(x.sy + 0.2) < 1e-9)).toBe(true);
    expect(goreCalls).toHaveLength(3);
    expect(goreCalls.every(([id]) => id === 16 || id === 17)).toBe(true);
    expect(goreCalls.every(([, , , vx, vy]) => Math.abs((vx ?? 0) - 0.25) < 1e-9
      && Math.abs((vy ?? 0) + 0.1) < 1e-9)).toBe(true);
  });

  it('④ 80：Item_27 + 10×d67 + 弹心格 tile 127 → KillTile（非 127 不拆）', () => {
    const w = emptyWorld();
    const ice = TILE_INTERNAL_BY_SHEET.get(127);
    expect(ice).toBeDefined();
    w.store.setTileSilent(25, 18, ice!, 0, 0);
    w.store.setTileSilent(40, 18, 1, 0, 0);                  // 普通石（sheet 1）
    const withIce = mkDeathGame({ world: w });
    withIce.g.onProjectileDeath(80, 25 * TILE, 18 * TILE, 16, 16, 0, 0, 10, {});
    expect(withIce.sfx).toContain('Item_27');
    expect(withIce.dusts.filter((x) => x.type === 67)).toHaveLength(10);
    expect(withIce.brokenTiles).toEqual([[25, 18]]);
    const plain = mkDeathGame({ world: w });
    plain.g.onProjectileDeath(80, 40 * TILE, 18 * TILE, 16, 16, 0, 0, 10, {});
    expect(plain.brokenTiles).toHaveLength(0);               // 非 127 → 不 KillTile
  });

  it('⑤ 712：Item_10 + 6..11×d15（scale1 直赋/fadeIn1.5/noGravity/色(76,76,76,0)）+ 3×gore 1008', () => {
    const d = mkDeathGame({});
    const goreSpy = vi.spyOn(GorePiece, 'newGore');
    d.g.onProjectileDeath(712, 500, 500, 10, 10, 3, 1, 40, {});
    const gore712 = goreSpy.mock.calls.filter(([id]) => id === 1008);
    goreSpy.mockRestore();
    expect(d.sfx.filter((s) => s === 'Item_10')).toHaveLength(1);
    const d15 = d.dusts.filter((x) => x.type === 15);
    expect(d15.length).toBeGreaterThanOrEqual(6);
    expect(d15.length).toBeLessThanOrEqual(11);
    expect(d15.every((x) => x.noGravity && x.fadeIn === 1.5 && Math.abs(x.scale - 1) < 1e-9)).toBe(true);
    expect(d15.every((x) => (x.color as { r: number; g: number; b: number; a: number })?.r === 76
      && (x.color as { r: number; g: number; b: number; a: number })?.a === 0)).toBe(true);
    expect(gore712).toHaveLength(3);
  });

  it('⑥ 119/359：Item_27 + d92×20；118：×10', () => {
    const a = mkDeathGame({});
    a.g.onProjectileDeath(119, 600, 600, 14, 14, 0, 0, 10, {});
    expect(a.sfx).toContain('Item_27');
    expect(a.dusts.filter((x) => x.type === 92)).toHaveLength(20);
    const b = mkDeathGame({});
    b.g.onProjectileDeath(359, 600, 600, 14, 14, 0, 0, 10, {});
    expect(b.dusts.filter((x) => x.type === 92)).toHaveLength(20);
    const c = mkDeathGame({});
    c.g.onProjectileDeath(118, 600, 600, 14, 14, 0, 0, 10, {});
    expect(c.sfx).toContain('Item_27');
    expect(c.dusts.filter((x) => x.type === 92)).toHaveLength(10);
  });
});

// ---- ★Kill 消亡面清偿批 2（2026-09-02）金标：1097 音尘+拆弹 / 640 延迟计数 /
//      aiStyle10 放块表全表 / Collision.HitTiles 砖屑面 ----
describe('Kill 消亡面清偿批 2 金标（2026-09-02）', () => {
  it('⑦ 1097：Item_20 + 6×d6；ai[1]==1 → 拆 8 枚同型 1097（伤/2、kb/2、ai1=2、foxL0 预置、scale 0.7）；缺省 ai1=0 恒不拆', () => {
    const dusts: DustRec[] = [];
    const bucket: Array<Record<string, unknown>> = [];
    const game = makeGame(emptyWorld(), dusts, bucket);
    const sfx1: string[] = [];
    (game as unknown as { playSfxFile: (n: string) => void }).playSfxFile =
      (n: string) => { sfx1.push(n); };
    const a = new Arrow(400, 300, 6, 0, 30, 1, 1097, { grav: 0 });
    kill(a, game);
    expect(sfx1).toEqual(['Item_20']);
    expect(dusts.filter((d) => d.type === 6)).toHaveLength(6);
    expect(bucket).toHaveLength(0);                          // 缺省 ai[1]=0 → 拆弹支 dormant
    // 拆弹档（1113 生成端注入 ai[1]=1 后即活;本测直接置镜像字段）
    const dusts2: DustRec[] = [];
    const bucket2: Array<Record<string, unknown>> = [];
    const game2 = makeGame(emptyWorld(), dusts2, bucket2);
    const b = new Arrow(400, 300, 6, 0, 30, 1, 1097, { grav: 0 });
    (b as unknown as { foxAi1: number }).foxAi1 = 1;
    kill(b, game2);
    expect(bucket2).toHaveLength(8);
    for (const c of bucket2) {
      expect(c.projId).toBe(1097);                           // 同型 1097（:75787）
      expect(c.damage).toBe(15);                             // damage/2（int 除）
      expect(c.knockback).toBe(0.5);                         // knockBack/2
      expect(c.foxAi1).toBe(2);                              // ai[1]=2（:75788）
      expect(c.foxL0).toBe(1);                               // 免首拍音尘（:57515 ai[1]!=2 门）
      expect(c.drawScale).toBe(0.7);                         // scale 钳（:57566-57568）
      const sp = Math.hypot(c.vx as number, c.vy as number);
      expect(sp).toBeGreaterThanOrEqual(6 - 3 - 1e-9);       // 旋转保速 + 线性盘 ±3
      expect(sp).toBeLessThanOrEqual(6 + 3 + 1e-9);
    }
    const xs = new Set(bucket2.map((c) => (c.vx as number).toFixed(3)));
    expect(xs.size).toBeGreaterThan(1);                      // ±34° 内随机旋转（:75787）
  });

  it('⑧ 640 延迟计数：639 Kill num391=life+2（+1 与同轮补偿）；消费面=整子步冻结（life/x/alpha 不动）→ 解冻后一拍追平', () => {
    const dusts: DustRec[] = [];
    const bucket: Array<Record<string, unknown>> = [];
    const game = makeGame(emptyWorld(), dusts, bucket);
    const a = new Arrow(400, 300, 6, 0, 30, 1, 639, { grav: 0, life: 600 });
    for (let i = 0; i < 2 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    const lifeAtKill = (a as unknown as { life: number }).life;
    kill(a, game);
    const c640 = bucket.find((e) => e.projId === 640) as unknown as { ai1Delay: number } | undefined;
    expect(c640).toBeDefined();
    expect(c640!.ai1Delay).toBe(lifeAtKill + 2);             // num391（:74826+:74828-74830）
    // 消费面（Update 环 :16784-16787 同构）：EU=3（opts 显式,json 缺列已补）→ 4 子步/拍
    const dusts2: DustRec[] = [];
    const game2 = makeGame(emptyWorld(), dusts2);
    const f = new Arrow(400, 300, 6, 0, 30, 1, 640, { grav: 0, extraUpdates: 3 });
    (f as unknown as { ai1Delay: number }).ai1Delay = 4;
    const life0 = (f as unknown as { life: number }).life;
    f.fixedUpdate(1 / 60, game2);                            // 冻结拍：4 子步全 continue
    expect((f as unknown as { life: number }).life).toBe(life0);
    expect(f.x).toBe(400);
    expect(f.alpha).toBe(255);                               // 渐显也冻结（α −25/子步被跳）
    f.fixedUpdate(1 / 60, game2);                            // 解冻拍：4 子步全跑
    expect((f as unknown as { life: number }).life).toBe(life0 - 4);
    expect(f.x).toBeCloseTo(424, 6);                         // vx=6 × 4 子步
    expect(f.alpha).toBe(155);                               // 255 − 25×4
  });

  it('⑨ 放块表新行：412 → tile 331 银币堆（空格）/ 格被占 → 兜底件 vi_72 ×1；40 → tile 57 黏土', () => {
    const w = emptyWorld();
    const silverPile = TILE_INTERNAL_BY_SHEET.get(331)!;
    const clay = TILE_INTERNAL_BY_SHEET.get(57)!;
    const drops: Array<[number, number, string, number]> = [];
    const a = mkDeathGame({ world: w });
    (a.g as unknown as Record<string, unknown>).chunks = { markDirtyArea: () => {} };
    (a.g as unknown as Record<string, unknown>).spawnDrop =
      (x: number, y: number, key: string, n = 1) => { drops.push([x, y, key, n]); };
    a.g.onProjectileDeath(412, 30 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(30, 189)).toBe(silverPile);           // 银币堆落格（:79191-79194）
    expect(drops).toHaveLength(0);
    const b = mkDeathGame({ world: w });
    (b.g as unknown as Record<string, unknown>).chunks = { markDirtyArea: () => {} };
    (b.g as unknown as Record<string, unknown>).spawnDrop =
      (x: number, y: number, key: string, n = 1) => { drops.push([x, y, key, n]); };
    w.store.setTileSilent(32, 189, silverPile, 0, 0);        // 格已占
    b.g.onProjectileDeath(412, 32 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(32, 189)).toBe(silverPile);           // 被占不变
    expect(drops).toHaveLength(1);
    expect(drops[0][2]).toBe('vi_72_SilverCoin');            // num18=72（ItemID.SilverCoin）
    expect(drops[0][3]).toBe(1);                             // RequestNewItem 缺省 ×1
    const c = mkDeathGame({ world: w });
    (c.g as unknown as Record<string, unknown>).chunks = { markDirtyArea: () => {} };
    c.g.onProjectileDeath(40, 34 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(34, 189)).toBe(clay);                 // 黏土球 → 黏土（:79183-79186）
  });

  it('⑨ 109 雪球：近距（≤1440）→ tile 147 雪；过远（>MaxWorldViewSize.X×0.75）→ 不放+掉 593', () => {
    const w = emptyWorld();
    const snow = TILE_INTERNAL_BY_SHEET.get(147)!;
    const drops: Array<[number, number, string, number]> = [];
    const near = mkDeathGame({ world: w });
    (near.g as unknown as Record<string, unknown>).chunks = { markDirtyArea: () => {} };
    (near.g as unknown as Record<string, unknown>).player =
      { dead: false, cx: 404, cy: 3012, x: 394, y: 2991, w: 20, h: 42 };
    near.g.onProjectileDeath(109, 25 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(25, 189)).toBe(snow);                 // 近距 ≤1440 → 放雪块（:79209-79211）
    const far = mkDeathGame({ world: w });
    (far.g as unknown as Record<string, unknown>).chunks = { markDirtyArea: () => {} };
    (far.g as unknown as Record<string, unknown>).spawnDrop =
      (x: number, y: number, key: string, n = 1) => { drops.push([x, y, key, n]); };
    far.g.onProjectileDeath(109, 40 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(40, 189)).toBe(0);                    // 过远不放（num17=-1）
    expect(drops).toHaveLength(1);
    expect(drops[0][2]).toBe('vi_593_SnowBlock');           // num18=593（:79217-79218）
  });

  it('★31 专支（2026-09-03）：传送带在下 → 免放且重挂 num18=169 掉沙块件 ×1（:79260-79266）；rail/被占免掉落、常规落地放沙', () => {
    const w = emptyWorld();
    const conv = TILE_INTERNAL_BY_SHEET.get(421)!;
    const sand = TILE_INTERNAL_BY_SHEET.get(53)!;
    const rail = TILE_INTERNAL_BY_SHEET.get(314)!;
    const drops: Array<[number, number, string, number]> = [];
    const c = mkDeathGame({ world: w });
    (c.g as unknown as Record<string, unknown>).chunks = { markDirtyArea: () => {} };
    (c.g as unknown as Record<string, unknown>).spawnDrop =
      (x: number, y: number, key: string, n = 1) => { drops.push([x, y, key, n]); };
    // ① 传送带 421 在下：flag2 免放 + num18 重挂 169（覆盖 ai[0]==2 免掉落缺省 :79133-79135）
    w.store.setTileSilent(30, 190, conv, 0, 0);
    c.g.onProjectileDeath(31, 30 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(30, 189)).toBe(0);                    // 免放（flag2 :79265）
    expect(drops).toHaveLength(1);
    expect(drops[0][2]).toBe('vi_169_SandBlock');            // 重挂 169（createTile=53 沙块件）
    expect(drops[0][3]).toBe(1);                             // RequestNewItem 缺省 ×1
    // ② rail 314 在下：免放且不掉（:79256-79259 无重挂,num18 恒 0 = 纯消失）
    w.store.setTileSilent(32, 190, rail, 0, 0);
    c.g.onProjectileDeath(31, 32 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(32, 189)).toBe(0);
    expect(drops).toHaveLength(1);                           // 仍 1 = 零掉落
    // ③ 格被占：outer else（num18=0）→ 不掉（:79301-79303）
    w.store.setTileSilent(34, 189, sand, 0, 0);
    c.g.onProjectileDeath(31, 34 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(34, 189)).toBe(sand);
    expect(drops).toHaveLength(1);
    // ④ 常规落地（实心在下）：放沙 53（:79129-79132 num17=53）
    c.g.onProjectileDeath(31, 36 * TILE, 189 * TILE, 10, 10, 0, 4, 20, {});
    expect(w.store.get(36, 189)).toBe(sand);
    expect(drops).toHaveLength(1);
  });

  it('⑩ HitTiles 面（660 冒烟）：命中格撒原版尘池 3 粒（石→尘 1,MakeTileDust 全表）；悬空消亡不撒', () => {
    const w = emptyWorld();
    const stone = TILE_INTERNAL_BY_SHEET.get(1);
    expect(stone).toBeDefined();
    w.store.setTileSilent(25, 100, stone!, 0, 0);
    const hit = mkDeathGame({ world: w });
    hit.g.onProjectileDeath(660, 25 * TILE, 100 * TILE - 10, 10, 10, 0, 4, 20, {});
    // ★BJ444：尘面=vanillaDust 池（KillTile(fail:true,effectOnly) 1:1）——
    //  1 命中格 × GetTileDustAmount(fail)=3（石缺省档）× 尘型 1（:67289 石族支）
    const ds = poolDusts(hit.g);
    expect(ds).toHaveLength(3);
    expect(ds.every((d) => d.type === 1)).toBe(true);
    const miss = mkDeathGame({ world: w });
    miss.g.onProjectileDeath(660, 60 * TILE, 60 * TILE, 10, 10, 0, 4, 20, {});   // 空域
    expect(poolDusts(miss.g)).toHaveLength(0);
  });
});

// ---- ★Kill 消亡面批 3（2026-09-03）：24 型通用 HitTiles 砖屑档全量化 + 消亡原因矩阵 ----
// 矩阵定谳（原版核）：Projectile.Kill :77649-77653 = Collision.HitTiles(position,velocity,
// width,height) + SoundEngine.Item10，位于 Kill() 体内（:71752-78993 单口，24 型在 Kill
// 内无更早分支吞并、仅 :71764 !active/:72087 两处早退均不涉 24 型）。Kill 到达路径：
//   · 撞块——各 aiStyle AI（AI_001 速度反转即 Kill 等）
//   · 寿命尽——Update :17307-17311 timeLeft-- → <=0 → Kill()
//   · 命中敌 penetrate 耗尽——Damage_*（Update :17184 调）置 pen=0 → Update
//     :17312-17314 pen==0 → Kill()
// 三因同达 Kill 单口 ⇒ 砖屑面【与消亡原因无关】，尘量只受几何门支配（position+velocity
// 扫盒 vs 实心/平台顶格，悬空到期自然零尘）。357 脉冲矢的 d206 是 AI 飞行段拖尾
// （P.cs:57733-57748），与本砖屑面两回事；207 信号弹/357 均在 24 型档内。
const VANILLA_HIT_TILES_24 = [14, 20, 88, 36, 83, 84, 389, 104, 279, 100, 110, 180,
  207, 357, 242, 302, 257, 259, 285, 287, 576, 577, 876, 968];

describe('Kill 消亡面批 3：24 型通用 HitTiles 砖屑档（消亡原因矩阵金标 2026-09-03）', () => {
  it('⑪ 14 步枪弹贴石格：尘池 3 粒×命中格（石→尘 1）+ Item_10 ×1（音面不重复）', () => {
    const w = emptyWorld();
    const stone = TILE_INTERNAL_BY_SHEET.get(1);
    expect(stone).toBeDefined();
    w.store.setTileSilent(25, 100, stone!, 0, 0);
    const hit = mkDeathGame({ world: w });
    hit.g.onProjectileDeath(14, 25 * TILE, 100 * TILE - 10, 8, 8, 0, 4, 10, {});
    const ds = poolDusts(hit.g);
    expect(ds).toHaveLength(3);                              // 1 命中格 × GetTileDustAmount(fail)=3
    expect(ds.every((d) => d.type === 1)).toBe(true);        // 砖屑=石族尘 1（:67289）
    expect(hit.sfx.filter((s) => s === 'Item_10')).toHaveLength(1);
  });

  it('⑫ 24 型全表单口：每一型 OPD 贴格均撒 3 粒砖屑+Item_10（无分型缺漏）;283（非档）零面', () => {
    const missing: number[] = [];
    const badSfx: number[] = [];
    for (const id of VANILLA_HIT_TILES_24) {
      const w = emptyWorld();
      w.store.setTileSilent(25, 100, TILE_INTERNAL_BY_SHEET.get(1)!, 0, 0);
      const d = mkDeathGame({ world: w });
      d.g.onProjectileDeath(id, 25 * TILE, 100 * TILE - 10, 8, 8, 0, 4, 10, {});
      const ds = poolDusts(d.g);
      if (ds.length !== 3) missing.push(id);
      if (d.sfx.filter((s) => s === 'Item_10').length !== 1) badSfx.push(id);
    }
    expect(missing).toEqual([]);                             // 24 型无一缺面
    expect(badSfx).toEqual([]);                              // 音面不重复
    // 非档对照：283 的 Kill 面在 Arrow.killNow（Game.onProjectileDeath 无分档,批①已钉）
    const ctl = mkDeathGame({ world: emptyWorld() });
    ctl.g.onProjectileDeath(283, 25 * TILE, 100 * TILE - 10, 8, 8, 0, 4, 10, {});
    expect(ctl.sfx.filter((s) => s === 'Item_10')).toHaveLength(0);
  });

  it('⑬ 寿命尽也撒（行为级）：14 弹 life=1 空中到期 → killNow→OPD 单口 Item_10 ×1;空域扫盒零砖屑（尘量几何门）', () => {
    const dusts: DustRec[] = [];
    const sfx13: string[] = [];
    const parts: Array<unknown[]> = [];
    const game = makeGame(emptyWorld(), dusts);
    (game as unknown as { playSfxFiles: (n: string[]) => void }).playSfxFiles =
      (names: string[]) => { sfx13.push(...names); };
    (game as unknown as Record<string, unknown>).spawnParticles =
      (...a: unknown[]) => { parts.push(a); };
    // makeGame 桩的 onProjectileDeath 本体是 no-op——绑真方法（Arrow.killNow 尾单口→真 OPD；
    // hitTilesFx 同为 Game.prototype 方法须一并绑,尘面世界/粒子源均取桩上的真 World 与 spy）
    (game as unknown as Record<string, unknown>).onProjectileDeath =
      (Game.prototype.onProjectileDeath as (...a: unknown[]) => void).bind(game);
    (game as unknown as Record<string, unknown>).hitTilesFx =
      (Game.prototype.hitTilesFx as (...a: unknown[]) => void).bind(game);
    const a = new Arrow(400, 300, 0, 0, 10, 1, 14, { grav: 0, life: 1 });
    for (let k = 0; k < 4 && !a.dead; k++) a.fixedUpdate(1 / 60, game);
    expect(a.dead).toBe(true);
    expect(sfx13.filter((s) => s === 'Item_10')).toHaveLength(1);   // 到期口达 Kill 单口
    expect(parts).toHaveLength(0);                                  // 空域无实心格 → 几何门零尘
  });

  it('⑭ 源锚（矩阵钉）：face 与音同支无死因门 + killNow 尾无条件 OPD（三因同口）+ 表=24 型原版全表', () => {
    const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    const blk = gameSrc.match(/if \(BULLET_KILL_SFX\.has\(projId\)\) \{([\s\S]*?)\n    \}/);
    expect(blk).not.toBeNull();
    expect(blk![1]).toContain('this.hitTilesFx(x, y, w, h, oldVx, oldVy)');
    expect(blk![1]).toContain("this.playSfxFiles(['Item_10']");
    const arrowSrc = readFileSync(new URL('../src/entities/Arrow.ts', import.meta.url), 'utf8');
    expect(arrowSrc).toContain('game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h, this.vx, this.vy,');
    expect([...BULLET_KILL_SFX].sort((x, y) => x - y))
      .toEqual([...VANILLA_HIT_TILES_24].sort((x, y) => x - y));
  });

  it('⑮ 357 脉冲矢 Kill 面=HitTiles 砖屑（原版尘池）非 d206 尾尘（d206 属 AI 飞行拖尾 :57733-57748）', () => {
    const w = emptyWorld();
    w.store.setTileSilent(25, 100, TILE_INTERNAL_BY_SHEET.get(1)!, 0, 0);
    const d = mkDeathGame({ world: w });
    d.g.onProjectileDeath(357, 25 * TILE, 100 * TILE - 10, 8, 8, 0, 4, 20, {});
    const ds = poolDusts(d.g);
    expect(ds).toHaveLength(3);
    expect(ds.every((x) => x.type === 1)).toBe(true);
    expect(d.dusts.filter((x) => x.type === 206)).toHaveLength(0);   // Kill 口不撒拖尾尘
    expect(d.sfx.filter((s) => s === 'Item_10')).toHaveLength(1);
  });
});

// ---- ★31 Dart 端活口金标（2026-09-03 R8 活口）：蚁狮沙球 31 的落档/掉件面在
//      Dart.sandBall 撞块支【直驱】（Game AISTYLE10_PLACE[31] 专支不路由
//      onProjectileDeath=死代码,⑨ 测的是那一面;本批钉活口三档）：
//   ① 传送带 421 在下 → 免放（flag2 :79265-79266）+ num18 重挂 169 → 掉
//      vi_169_SandBlock ×1（覆盖 ai[0]==2 免掉落缺省 :79133-79135）
//   ② 悬空 below==0 → 零掉落零放沙 = 纯消失（ai[0]==2 → num18=0,PlaceTile 亦免）
//   ③ 营规实心在下 → 放沙 53 无掉落（num17=53 :79131 + PlaceTile :79276）
// 桩仿 mkDeathGame/makeGame（真 World + spawnDrop 捕集）,弹走 Dart.fixedUpdate 实车。
interface DropRec { x: number; y: number; key: string; n: number; }

function dartSandGame(w: World) {
  const drops: DropRec[] = [];
  const g = {
    world: w,
    player: { dead: false, x: -1000, y: -1000, w: 20, h: 42, cx: -990, cy: -979 },
    enemies: () => [], critters: () => [], npcs: () => [],
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, spawnBurst: () => {},
    addDamageNumber: () => {}, damagePlayer: (): number => 0,
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, cutTile: () => {}, addLightAt: () => {},
    breakTile: () => {},
    spawnDrop: (x: number, y: number, key: string, n = 1) => {
      drops.push({ x, y, key, n });
      return null;
    },
    entities: { nextId: 1, add: () => {} },
  } as unknown as GameHooks;
  return { g, drops };
}

describe('★31 Dart 端活口金标（2026-09-03 R8:蚁狮沙球落档/掉件三档,sandBall 支直驱）', () => {
  const run = (d: Dart, g: GameHooks, cap = 60) => {
    for (let i = 0; i < cap && !d.dead; i++) d.fixedUpdate(1 / 60, g);
    expect(d.dead).toBe(true);
  };

  it('① 传送带 421 在下 → 掉 vi_169_SandBlock ×1 且不放沙（:79260-79266 flag2+重挂 num18=169）', () => {
    const w = emptyWorld();
    const st = w.store;
    const conv = TILE_INTERNAL_BY_SHEET.get(421)!;
    st.setTileSilent(30, 100, conv, 0, 0);                    // 传送带悬空摆（本仓 id 域）
    const { g, drops } = dartSandGame(w);
    const d = new Dart(30 * TILE + 3, 100 * TILE - 20, 0, 2, 10, 31);
    d.hostile = true;                                        // 蚁狮敌版（ai[0]=2 档）
    run(d, g);
    expect(drops).toHaveLength(1);
    expect(drops[0].key).toBe('vi_169_SandBlock');            // 重挂 num18=169（createTile=53 沙块件）
    expect(drops[0].n).toBe(1);                              // RequestNewItem 缺省 ×1
    expect(st.get(30, 99)).toBe(0);                          // 免放（flag2 :79265-79266）
    expect(st.get(30, 100)).toBe(conv);                      // 传送带原样
  });

  it('② 悬空（below==0,水平撞入浮空块）→ 零掉落零放沙=纯消失（:79133-79135 num18=0）', () => {
    const w = emptyWorld();
    const st = w.store;
    const stone = TILE_INTERNAL_BY_SHEET.get(1)!;
    st.setTileSilent(40, 100, stone, 0, 0);                  // 浮空单块（下方全空）
    const { g, drops } = dartSandGame(w);
    const d = new Dart(40 * TILE - 26, 100 * TILE + 3, 6, 0, 10, 31);
    d.hostile = true;
    run(d, g);
    expect(drops).toHaveLength(0);                           // num18=0 → 连物品都不掉
    expect(st.get(40, 100)).toBe(stone);                     // 浮块原样
    expect(st.get(39, 100)).toBe(0);                         // 不放沙
    expect(st.get(39, 101)).toBe(0);                         // below==0 维持（未改下格）
  });

  it('③ 营规沙地（实心在下）→ 放沙 53 无掉落（num17=53 :79131 + PlaceTile :79276）', () => {
    const w = emptyWorld();
    const st = w.store;
    const { g, drops } = dartSandGame(w);
    const d = new Dart(50 * TILE + 3, 190 * TILE - 20, 0, 2, 10, 31);
    d.hostile = true;
    run(d, g);
    expect(drops).toHaveLength(0);                           // 常规落地不掉件
    expect(st.get(50, 189)).toBe(TILE_INTERNAL_BY_SHEET.get(53));   // 放置格=上一帧中心格,沙=原版 53 域
  });

  // ★终审 B④（2026-09-04）：flag2 掉件面 = Projectile.cs:79290-99。itemType 照原文
  //  num18 表（:79131-79140）：31→169,ai[0]==2f（蚁狮敌吐=本仓唯一生成位）→ 0。
  //  ⇒ 轨道 314/沙塌支 num18=0 不掉件（=原版蚁狮版纯消失,非掉件面缺——判定面已按
  //  原式接 spawnDrop 通道）；传送带支 :79263-79265 无条件重挂 169 → 掉 ×1,锚
  //  Center+(0,-2)（:79297）。
  it('④a 轨道 314 在下（横撞墙,弹心在轨上方）→ flag2 免放+num18=0 零掉落（:79256-59/:79296-98）', () => {
    const w = emptyWorld();
    const st = w.store;
    const wall = TILE_INTERNAL_BY_SHEET.get(1)!;
    const rail = TILE_INTERNAL_BY_SHEET.get(314)!;
    st.setTileSilent(40, 100, wall, 0, 0);                   // 障碍墙（弹心撞入格）
    st.setTileSilent(39, 101, rail, 0, 0);                   // 轨道在弹心格正下
    const { g, drops } = dartSandGame(w);
    const d = new Dart(40 * TILE - 26, 100 * TILE + 3, 6, 0, 10, 31);
    d.hostile = true;
    run(d, g);
    expect(drops).toHaveLength(0);                           // ai[0]=2 → num18=0 不掉（原文）
    expect(st.get(39, 100)).toBe(0);                         // flag2 免放
    expect(st.get(39, 101)).toBe(rail);                      // 轨道原样
    expect(st.get(40, 100)).toBe(wall);                      // 墙原样
  });

  it('④b 传送带重挂掉件锚 = Center+(0,-2)（:79297,曾用 Center 少 -2px）', () => {
    const w = emptyWorld();
    const st = w.store;
    const conv = TILE_INTERNAL_BY_SHEET.get(421)!;
    st.setTileSilent(30, 100, conv, 0, 0);
    const { g, drops } = dartSandGame(w);
    const d = new Dart(30 * TILE + 3, 100 * TILE - 20, 0, 2, 10, 31);
    d.hostile = true;
    run(d, g);
    expect(drops).toHaveLength(1);
    expect(drops[0].key).toBe('vi_169_SandBlock');
    expect(drops[0].x).toBe(d.cx);                           // Center.X
    expect(drops[0].y).toBe(d.cy - 2);                       // Center.Y-2（:79297）
  });
});

// ★终审 B②/B③（2026-09-04）致动域占用门（裸 active() 非 nactive()）：
//   ② AISTYLE10_PLACE 落点占用门（Projectile.cs:79246 `!tile.active()` 不成立即
//     outer else-if :79300-79304 num18>0 → 掉件）——已致动落点=占用,原版掉件；
//     曾用 isActive=nactive() → 致动落点被当空位直铺。
//   ③ 80 冰弹 KillTile 门（:26022 `tile.active() && type==127`）——已致动冰照常拆。
describe('★终审 B②/B③ 致动域占用门（沙球落点 / 80 冰弹）', () => {
  it('② 已致动落点 + 56 淤泥弹（num18=370）→ 掉件于 Center、格不被直铺', () => {
    const w = emptyWorld();
    const st = w.store;
    const stone = TILE_INTERNAL_BY_SHEET.get(1)!;
    st.setTileSilent(30, 100, stone, 0, 0);
    st.setActuated(30, 100, true);                           // 已致动（active=1,inActive=1）
    const dg = mkDeathGame({ world: w });
    const drops: Array<{ x: number; y: number; key: string; n: number }> = [];
    (dg.g as unknown as Record<string, unknown>).spawnDrop =
      (x: number, y: number, key: string, n = 1) => { drops.push({ x, y, key, n }); return null; };
    dg.g.onProjectileDeath(56, 30 * TILE, 100 * TILE, 8, 8, 0, 0, 10, {});
    expect(drops).toHaveLength(1);                           // 占用 → outer else-if 掉件
    expect(drops[0].key).toBe(VANILLA_ITEM_KEY_BY_ID[370]);  // num18=370（:79154-79156 表）
    expect(drops[0].x).toBe(30 * TILE + 4);                  // Center
    expect(drops[0].y).toBe(100 * TILE + 4);
    expect(st.get(30, 100)).toBe(stone);                     // 格不被直铺（占用=拒）
    expect(st.isActuated(30, 100)).toBe(true);               // 隐形态原样（未覆写）
    expect(dg.sfx).toEqual([]);                              // 该支无音效（原版掉件静默）
  });

  it('② 对照：空落点 + 56 → 正常铺放淤泥 112、零掉落（place 支未受门影响）', () => {
    const w = emptyWorld();
    const st = w.store;
    const dg = mkDeathGame({ world: w });
    (dg.g as unknown as Record<string, unknown>).chunks = { markDirtyArea: () => {} };
    const drops: unknown[] = [];
    (dg.g as unknown as Record<string, unknown>).spawnDrop =
      (x: number, y: number, key: string) => { drops.push({ x, y, key }); return null; };
    dg.g.onProjectileDeath(56, 30 * TILE, 100 * TILE, 8, 8, 0, 0, 10, {});
    expect(drops).toHaveLength(0);
    expect(st.get(30, 100)).toBe(TILE_INTERNAL_BY_SHEET.get(112));   // 淤泥铺放
  });

  it('③ 已致动冰 127 弹心格 → 照常 KillTile（:26022 裸 active()）', () => {
    const w = emptyWorld();
    const ice = TILE_INTERNAL_BY_SHEET.get(127)!;
    w.store.setTileSilent(25, 18, ice, 0, 0);
    w.store.setActuated(25, 18, true);
    const dg = mkDeathGame({ world: w });
    dg.g.onProjectileDeath(80, 25 * TILE, 18 * TILE, 16, 16, 0, 0, 10, {});
    expect(dg.brokenTiles).toEqual([[25, 18]]);              // 致动冰照拆（曾 isActive 门漏）
    expect(w.store.hasTile(25, 18)).toBe(true);              // breakTile 为录制桩未清格（面锁即足）
  });
});
