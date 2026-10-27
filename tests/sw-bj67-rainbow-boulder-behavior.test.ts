// ★SW-BJ67（2026-09-14）彩虹巨石 1047 行为面五债守卫（D1-D5,全部 1457 行号锚
// 1:1 移植;1458 同域 diff 零差对拍 2026-09-14,1458 全域行号 +1）。
//
// 五债与金标锚：
//   D1 贴墙弹跳不碎   P.cs:19192-19194 CheckBounce 调用位 / :20165-20222
//                     CheckBounce 本体 / :20139 PreventSpam / :20227 PerformSmartBounce
//                     / :20319-20420 JumpTo*（含 JumpToPlayer 以 player.position 充
//                     targetVelocity 的字面怪癖 :20319）
//   D2 Kill 彩虹爆    P.cs:72354-72427（dust267 沿尾+CloneDust 白影+RainbowRodHit
//                     ×2+dust66×14+SoundID.RainbowBoulder）
//   D3 宠 1090 滚动切绘 Main.cs:33212-33217 + 帧环 P.cs:52081-52094 +
//                     num351=localAI[2]（Main.cs:33341-33403）+ 自旋 P.cs:50835-50838
//   D4 CutTiles 豁免  P.cs:15391-15393（1047×幼虫 231 → flag=false 不召蜂王）
//   D5 tileCollide 动态门 P.cs:26437（ai[1]==0 && !SolidCollision 嵌墙穿透态）
//                     + ai[1] 弹跳宽限（:26438-26441）+ flag9 静止自启抑制（:26595）
//
// 变异证红（每债至少一线）：弹跳摘除（旧②支 Kill）→ D1-1 红 / 爆粒摘除 → D2-1 红 /
// 豁免摘除 → D4-1 红 / 动态门摘除（静态 true/false）→ D5-1/2 红 / 壳表切绘摘除 →
// D3-4 红 / 帧环摘除 → D3-1 红 / 混合摘除 → D3-2 红 / 自旋摘除 → D3-3 红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RollingBoulder } from '../src/entities/RollingBoulder';
import { PetFollower } from '../src/entities/PetFollower';
import { EntityManager, Entity } from '../src/entities/Entity';
import { cutTilesBox } from '../src/entities/ProjCutTiles';
import { cutTilesTypeExempt } from '../src/core/Game';
import { TILE_DEFS, TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';
import type { Renderer } from '../src/render/Renderer';
import type { Camera } from '../src/render/Camera';

// ================= 夹具（BJ64b fakeStore 同构 + 可打点 dust/particle/sfx 账） =================

const SOLID_ID = TILE_DEFS.findIndex((d) => d && d.solid && !d.platform);

interface DustRec { x: number; y: number; w: number; h: number; type: number; alpha: number; scale: number; color: unknown; dust: Record<string, unknown> }

function fakeStore(w = 64, h = 64, placed?: Map<number, number>) {
  const cells = placed ?? new Map<number, number>();
  return {
    w, h,
    type: new Uint8Array(w * h),
    flags: new Uint8Array(w * h),
    slope: new Uint8Array(w * h),
    half: new Uint8Array(w * h),
    liquid: new Float32Array(w * h),
    liquidType: new Float32Array(w * h),
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
  };
}
type Store = ReturnType<typeof fakeStore>;

function fakeGame(store: Store, opts?: {
  player?: Record<string, unknown>;
  enemies?: unknown[];
  projectiles?: unknown[];
}) {
  const dusts: DustRec[] = [];
  const particles: Array<{ x: number; y: number; color: string; count: number }> = [];
  const sfx: Array<{ name: string; x?: number; y?: number }> = [];
  const cutCalls: Array<{ x: number; y: number; vid?: number }> = [];
  const broadcasts: Array<{ type: number; x: number; y: number; moveX?: number; moveY?: number }> = [];
  const clones: number[] = [];
  const player = opts?.player ?? { dead: true, x: 99999, y: 99999, w: 20, h: 42, cx: 100009, cy: 100020, vx: 0, vy: 0, facing: 1 };
  const g = {
    world: { store, w: store.w, h: store.h },
    player,
    candidatePlayers: () => [player],
    enemies: () => opts?.enemies ?? [],
    critters: () => [],
    npcs: () => [],
    projectiles: () => opts?.projectiles ?? [],
    spawnParticles: (x: number, y: number, color: string, count: number) => {
      particles.push({ x, y, color, count });
    },
    spawnDust: (x: number, y: number, w: number, h: number, type: number,
      _sx = 0, _sy = 0, alpha = 0, color: unknown = null, scale = 1, noGravity = false) => {
      const dust: Record<string, unknown> = { x: x + 2, y: y + 3, vx: 0.7, vy: -0.2, scale, fadeIn: 0, noGravity, color: null };
      dusts.push({ x, y, w, h, type, alpha, scale, color, dust });
      return dust;
    },
    vanillaDust: {
      clone: (d: Record<string, unknown>) => {
        clones.push(d.type as number);
        return { ...d, x: (d.x as number), y: (d.y as number) };
      },
    },
    playSfx: () => {},
    playSfxWav: (name: string, _vol?: number, x?: number, y?: number) => { sfx.push({ name, x, y }); },
    damagePlayer: () => 0,
    addLightAt: () => {},
    cutTile: (x: number, y: number, vid?: number) => { cutCalls.push({ x, y, vid }); },
    broadcastParticleOrchestra: (type: number, x: number, y: number, moveX?: number, moveY?: number) => {
      broadcasts.push({ type, x, y, moveX, moveY });
    },
    dusts, particles, sfx, cutCalls, broadcasts, clones,
  };
  return g as unknown as GameHooks & typeof g;
}

const mkBoulder = (sheet = 711): RollingBoulder => new RollingBoulder(104, 104, sheet);   // 711 → 1047

const internalOfSheet = (sheet: number): number =>
  TILE_DEFS.findIndex((d) => d && d.vanilla && d.vanilla.sheet === sheet);

// ================= D1：贴墙弹跳不碎（CheckBounce 链） =================
describe('SW-BJ67 D1 RainbowBoulder_CheckBounce（P.cs:20165-20222）', () => {
  it('D1-1 高速撞墙弹回 0.95 且不碎（变异体=旧②支 Kill → dead=true 红）', () => {
    const game = fakeGame(fakeStore());
    const b = mkBoulder();
    (b as unknown as { rbCheckBounce: (lx: number, ly: number, g: GameHooks) => void })
      .rbCheckBounce(7, 0, game);                 // 碰撞把 vx 改写为 0 → lastVX=7
    expect(b.dead).toBe(false);                   // 旧②支此处 dead=true（本债病灶）
    expect(b.vx).toBeCloseTo(-6.65, 6);           // -7 × 0.95（|v|≥1 档）
    expect(b.localAI1).toBe(1);                   // |7|>5 → :20192 ++（1047 域只写）
    expect(game.sfx.some((s) => s.name === 'rainbow_boulder')).toBe(true);   // :20194
    expect(game.particles.length).toBeGreaterThan(0);   // HitTiles 仓内近似（同族①支）
  });

  it('D1-2 弹回系数分段（:20168-20179）：<0.5→0.1 / <0.75→0.25 / <1→0.5 / ≥1→0.95', () => {
    const cases: Array<[number, number, number]> = [
      [0.3, -0.03, 0.1], [0.6, -0.15, 0.25], [0.8, -0.4, 0.5], [2, -1.9, 0.95],
    ];
    for (const [lastVX, want, factor] of cases) {
      const game = fakeGame(fakeStore());
      const b = mkBoulder();
      (b as unknown as { rbCheckBounce: (lx: number, ly: number, g: GameHooks) => void })
        .rbCheckBounce(lastVX, 0, game);
      expect(b.vx).toBeCloseTo(want, 6);
      expect(b.vx).toBeCloseTo(-lastVX * factor, 6);
    }
  });

  it('D1-3 落地弹回 0.95 非 0.2（巨石族 0.2 档对 1047 不适用,:20184-20189）', () => {
    const game = fakeGame(fakeStore());
    const b = mkBoulder();
    b.vy = 0;
    (b as unknown as { rbCheckBounce: (lx: number, ly: number, g: GameHooks) => void })
      .rbCheckBounce(0, 10, game);
    expect(b.vy).toBeCloseTo(-9.5, 6);            // -10 × 0.95（非 -2）
  });

  it('D1-4 弹后 smart bounce 重寻的：近玩家 → JumpToPlayer 跃迁（ai[1]>0,速度朝玩家）', () => {
    const game = fakeGame(fakeStore(), {
      player: { dead: false, x: 300, y: 60, w: 20, h: 42, cx: 310, cy: 81, vx: 0, vy: 0, facing: 1 },
    });
    const b = mkBoulder();                        // cx≈119.5 — 玩家在右侧
    (b as unknown as { rbCheckBounce: (lx: number, ly: number, g: GameHooks) => void })
      .rbCheckBounce(7, 0, game);
    expect(b.ai1).toBeGreaterThan(0);             // JumpToPosition :20369 ai[1]=num3
    expect(b.vx).toBeGreaterThan(0);              // 速度朝玩家（弹回 -6.65 被跃迁覆写）
    expect(Number.isFinite(b.vx) && Number.isFinite(b.vy)).toBe(true);
  });

  it('D1-5 PreventSpam（:20139-20162）：6000 盒内同型活跃弹 ≥7 → Kill+彩虹爆（阈值变异体红）', () => {
    const b = mkBoulder();
    const others = Array.from({ length: 7 }, () =>
      ({ dead: false, projId: 1047, x: 104, y: 104, w: 31, h: 31 }));
    const game = fakeGame(fakeStore(), { projectiles: [b, ...others] });
    (b as unknown as { rbPerformSmartBounce: (g: GameHooks) => void })
      .rbPerformSmartBounce(game);
    expect(b.dead).toBe(true);                    // :20160-20162 Kill
    expect(game.dusts.filter((d) => d.type === 66).length).toBe(14);   // Kill→D2 爆
    // 阈值变异（≥8）反例：6 个同型不杀
    const b2 = mkBoulder();
    const few = Array.from({ length: 6 }, () =>
      ({ dead: false, projId: 1047, x: 104, y: 104, w: 31, h: 31 }));
    const game2 = fakeGame(fakeStore(), { projectiles: [b2, ...few] });
    (b2 as unknown as { rbPerformSmartBounce: (g: GameHooks) => void })
      .rbPerformSmartBounce(game2);
    expect(b2.dead).toBe(false);
  });

  it('D1-6 敌怪索敌（CanBeChasedBy∧playArea 盒交）→ JumpToEnemy 优先于寻宝/玩家', () => {
    const game = fakeGame(fakeStore(), {
      player: { dead: false, x: 300, y: 60, w: 20, h: 42, cx: 310, cy: 81, vx: 0, vy: 0, facing: 1 },
      enemies: [{ dead: false, maxHp: 100, x: 1690, y: 640, w: 40, h: 40, cx: 1710, cy: 660, vx: 0, vy: 0 }],
    });
    const b = mkBoulder();
    (b as unknown as { rbPerformSmartBounce: (g: GameHooks) => void })
      .rbPerformSmartBounce(game);
    expect(b.ai1).toBeGreaterThan(0);
    expect(b.vx).toBeGreaterThan(0);              // 朝敌怪（右侧）跃迁
    expect(game.broadcasts.some((x) => x.type === 50)).toBe(true);   // RB4 clientOnly:false 上行
  });

  it('D1-7 寻宝（GetTreasureCoords :20374-20420）：playArea 内宝箱格 → JumpToTreasure', () => {
    const chestId = internalOfSheet(21);          // 宝箱 21（FriendlyFairyCanLureTo∧优先级 500）
    expect(chestId).toBeGreaterThan(0);
    const cells = new Map<number, number>([[95 * 200 + 110, chestId]]);
    const game = fakeGame(fakeStore(200, 200, cells), {
      player: { dead: false, x: 1600, y: 1600, w: 20, h: 42, cx: 1610, cy: 1610, vx: 0, vy: 0, facing: 1 },
    });
    const b = new RollingBoulder(1600, 1600, 711);   // cx≈1615.5 — 宝石格 (110,95)→(1760,1520) 在右上
    (b as unknown as { rbPerformSmartBounce: (g: GameHooks) => void })
      .rbPerformSmartBounce(game);
    expect(b.ai1).toBeGreaterThan(0);
    expect(b.vx).toBeGreaterThan(0);              // 目标 (1760,1520)（ToWorldCoordinates=X×16）
    expect(b.vy).toBeLessThan(0);
  });
});

// ================= D2：Kill 彩虹爆（P.cs:72354-72427） =================
describe('SW-BJ67 D2 Kill 彩虹爆（:72354-72427）', () => {
  it('D2-1 爆段四件套齐：RainbowBoulder 声+267 彩虹尘沿尾+66×14+RodHit 编排（摘除变异体红）', () => {
    const game = fakeGame(fakeStore());
    const b = mkBoulder();
    const inner = b as unknown as { trailX: number[]; trailY: number[]; trailN: number };
    inner.trailX[0] = 200; inner.trailY[0] = 300;   // 尾点钉异值（与中心 119.5 分离）
    inner.trailX[1] = 160; inner.trailY[1] = 280;
    inner.trailN = 2;
    (b as unknown as { rbKill: (g: GameHooks) => void }).rbKill(game);
    expect(b.dead).toBe(true);
    // ① 声（:72356 SoundID.RainbowBoulder）
    expect(game.sfx.some((s) => s.name === 'rainbow_boulder')).toBe(true);
    // ② 267 尘沿尾（trail 两点各 1..3 粒 → ≥2;含 RodHit 段 12×2 彩 + 12×2 白影）
    const d267 = game.dusts.filter((d) => d.type === 267);
    expect(d267.length).toBeGreaterThanOrEqual(2);
    expect(d267.some((d) => d.x === 200 && d.y === 300)).toBe(true);   // 沿 oldPos 环位
    expect(d267.every((d) => d.dust.noGravity === true)).toBe(true);   // :72382
    expect(d267.every((d) => (d.dust.scale as number) > 0)).toBe(true);
    // ③ 66×14（:72426-72432：α100、scale1.7、noGravity、色相掷、速×3）
    const d66 = game.dusts.filter((d) => d.type === 66);
    expect(d66.length).toBe(14);
    expect(d66.every((d) => d.alpha === 100 && d.scale === 1.7 && d.color)).toBe(true);
    expect(d66.every((d) => d.dust.noGravity === true)).toBe(true);
    expect(d66.every((d) => Math.abs((d.dust.vx as number) - 2.1) < 1e-9)).toBe(true);   // 0.7（NewDust 基速）×3
    // ④ RainbowRodHit 编排 ×2（:72418-72425,clientOnly:true）
    // ★BJ730 改判史：旧载体 spawnParticles 直生（≥12 粒方块近似）——BJ704-G24
    //  （件4,G2 族一致性清偿）编排迁 spawnDust prettySparkle 专用档（princess/
    //  stardust R3 同族:精确直装位/速+TTL 60+双轴星芒承载,spawnParticles 单标量
    //  方块近似退役）。新载体=每调用 6k×双层 mkPS=12 prettySparkle 尘,×2 调用=24。
    const ps = game.dusts.filter((d) => (d.dust as { prettySparkle?: boolean }).prettySparkle === true);
    expect(ps.length).toBeGreaterThanOrEqual(24);
    expect(ps.every((d) => (d.dust as { ttl?: number }).ttl === 60)).toBe(true);      // :3475 衰减窗=寿命
    expect(ps.every((d) => (d.dust as { rotation?: number }).rotation === Math.PI / 2)).toBe(true);   // :3472
    // ⑥ CloneDust 白影消费（:72390-72396——尾尘逐粒克隆）
    expect(game.clones.length).toBeGreaterThanOrEqual(2);   // 尾尘逐粒克隆（mock 尘不带 type,计总数）
    // ⑤ 白克隆（:72390-72396 CloneDust 白影——vanillaDust.clone 消费）
    expect(game.broadcasts.length).toBe(0);        // clientOnly:true 全段不广播
  });

  it('D2-2 唯一死亡门：life 耗尽 → Kill → 爆段（直置 dead 变异体红）', () => {
    const game = fakeGame(fakeStore());
    const b = mkBoulder();
    b.life = 1;
    b.fixedUpdate(1 / 60, game);
    expect(b.dead).toBe(true);
    expect(game.dusts.filter((d) => d.type === 66).length).toBe(14);
  });

  it('D2-3 家族余员（99 巨石）死亡不带彩虹爆（防满布接线）', () => {
    const game = fakeGame(fakeStore());
    const b = mkBoulder(138);                      // sheet 138 → 99
    b.life = 1;
    b.fixedUpdate(1 / 60, game);
    expect(b.dead).toBe(true);
    expect(game.dusts.filter((d) => d.type === 66).length).toBe(0);
    expect(game.sfx.some((s) => s.name === 'rainbow_boulder')).toBe(false);
  });
});

// ================= D5：tileCollide 动态门（P.cs:26437-26456） =================
describe('SW-BJ67 D5 tileCollide 动态门（:26437 嵌墙穿透 + :26438 宽限）', () => {
  it('D5-1 嵌墙穿透态：嵌入实心体 → tileCollide=false（静态 true 变异体红）', () => {
    const cells = new Map<number, number>([[7 * 64 + 7, SOLID_ID]]);   // 弹盒 104..135 → tile 6..8
    const game = fakeGame(fakeStore(64, 64, cells));
    const b = mkBoulder();
    b.fixedUpdate(1 / 60, game);
    expect((b as unknown as { tileCollide?: boolean }).tileCollide).toBe(false);
  });

  it('D5-2 空场自由态 → tileCollide=true；宽限期 ai[1]>0 → false 且逐拍 −1（双变异体红）', () => {
    const game = fakeGame(fakeStore());
    const b = mkBoulder();
    b.fixedUpdate(1 / 60, game);
    expect((b as unknown as { tileCollide?: boolean }).tileCollide).toBe(true);   // 静态 false 变异体红
    const b2 = mkBoulder();
    (b2 as unknown as { ai1: number }).ai1 = 5;
    b2.fixedUpdate(1 / 60, game);
    expect((b2 as unknown as { tileCollide?: boolean }).tileCollide).toBe(false); // 宽限穿墙
    expect((b2 as unknown as { ai1: number }).ai1).toBe(4);                        // :26441 递减
  });

  it('D5-3 结构锁：静止自启门带 !flag9（:26595 弹跳宽限期不起踢）+ D5 门表达式', () => {
    const src = readFileSync(join(__dirname, '../src/entities/RollingBoulder.ts'), 'utf8');
    expect(src).toMatch(/if \(this\.ai0 && this\.vy <= 0 && this\.vx === 0 && !flag9\)/);
    expect(src).toMatch(/this\.tileCollide = this\.ai1 === 0 && !solidCollision1457/);
  });
});

// ================= D4：CutTiles 1047→幼虫 231 豁免（P.cs:15391-15393） =================
describe('SW-BJ67 D4 CutTiles 1047×幼虫豁免（:15391-15393）', () => {
  it('D4-1 豁免谓词：1047×幼虫 true；异型/异格/无 vid 均 false（摘除变异体红）', () => {
    const larva = TILE_BY_KEY['v_231_larva'];
    expect(larva).toBeGreaterThan(0);
    expect(TILE_DEFS[larva]?.vanilla?.sheet).toBe(231);   // 键面自检（tileCut[231] Main.cs:7536）
    expect(cutTilesTypeExempt(1047, larva)).toBe(true);
    expect(cutTilesTypeExempt(99, larva)).toBe(false);    // 异弹型
    expect(cutTilesTypeExempt(1047, TILE_BY_KEY['pot'] ?? -1)).toBe(false);   // 异格
    expect(cutTilesTypeExempt(undefined, larva)).toBe(false);   // 无型旧语义
  });

  it('D4-2 vid 穿线：cutTilesBox → game.cutTile(x,y,vid) 逐格带型', () => {
    const game = fakeGame(fakeStore());
    cutTilesBox(game, 32, 32, 31, 31, 1047);
    expect(game.cutCalls.length).toBeGreaterThan(0);
    expect(game.cutCalls.every((c) => c.vid === 1047)).toBe(true);
    cutTilesBox(game, 32, 32, 31, 31);
    expect(game.cutCalls[game.cutCalls.length - 1]?.vid).toBeUndefined();   // 旧无型调用方语义不变
  });

  it('D4-3 中央收口穿线（EntityManager.update）：projId/vanillaId → cutTile vid', () => {
    class FakeProj extends Entity {
      projId = 1047;
      fixedUpdate() { /* 无 AI */ }
      draw() { /* 无绘 */ }
    }
    const game = fakeGame(fakeStore());
    const mgr = new EntityManager();
    const e = new FakeProj();
    e.x = 48; e.y = 48;
    mgr.add(e, 'projectiles');
    mgr.update(1 / 60, game as unknown as GameHooks);
    expect(game.cutCalls.length).toBeGreaterThan(0);
    expect(game.cutCalls.every((c) => c.vid === 1047)).toBe(true);
    // vanillaId 优先（m.vanillaId ?? m.projId 口径）
    const game2 = fakeGame(fakeStore());
    const mgr2 = new EntityManager();
    const e2 = new FakeProj();
    (e2 as unknown as { vanillaId?: number }).vanillaId = 99;
    mgr2.add(e2, 'projectiles');
    mgr2.update(1 / 60, game2 as unknown as GameHooks);
    expect(game2.cutCalls.every((c) => c.vid === 99)).toBe(true);
  });

  it('D4-4 结构锁：Game.cutTile 消费豁免单点', () => {
    const src = readFileSync(join(__dirname, '../src/core/Game.ts'), 'utf8');
    expect(src).toMatch(/if \(cutTilesTypeExempt\(vid, t\)\) return;/);
  });
});

// ================= D3：宠 1090 滚动模式（P.cs:52081-52105 + Main.cs:33212-33217） =================
const mkOwner = (over?: Record<string, unknown>) => ({
  x: 390, y: 79, w: 20, h: 42, cx: 400, cy: 100, facing: 1, dead: false, vx: 0, vy: 0, ...over,
});
const mkPet = (owner: Record<string, unknown>) =>
  new PetFollower(100, 100, 1090, () => owner as never);

describe('SW-BJ67 D3 宠 1090 帧环/localAI[2]/自旋（P.cs:52081-52105/:50835-50838）', () => {
  it('D3-1 帧环：每 2t 一帧环 0..99（帧环摘除变异体红;1458 同域）', () => {
    const game = fakeGame(fakeStore());
    const pet = mkPet(mkOwner());                 // dist≈284 > 200 → 滚动态（flying）
    const seen: number[] = [];
    for (let t = 0; t < 6; t++) { pet.fixedUpdate(1 / 60, game); seen.push(pet.rbFrame); }
    expect(seen).toEqual([0, 1, 1, 2, 2, 3]);   // frame(t) = floor(t/2)
    (pet as unknown as { rbFrame: number }).rbFrame = 99;
    pet.fixedUpdate(1 / 60, game);                // 计数拍（99）
    pet.fixedUpdate(1 / 60, game);                // 推进拍 100 → 环回 0（:52083-52085）
    expect(pet.rbFrame).toBe(0);
  });

  it('D3-2 localAI[2] 混合：滚动 +0.025/t、退出 −0.025/t 底 0（混合摘除变异体红）', () => {
    const game = fakeGame(fakeStore());
    const owner = mkOwner();
    const pet = mkPet(owner);
    for (let t = 0; t < 4; t++) pet.fixedUpdate(1 / 60, game);
    expect((pet as unknown as { flying: boolean }).flying).toBe(true);   // 追赶滚动态保持
    expect(pet.rbBlend).toBeCloseTo(0.1, 6);      // 4×0.025（:52089-52094 递增支）
    // 属主贴身 → 落回门（:50671-50676/:50686-50692 逐值:dist<200∧玩家落地∧未嵌块）
    owner.x = 92; owner.y = 100; owner.cx = 116; owner.cy = 121; owner.vx = 0; owner.vy = 0;
    pet.fixedUpdate(1 / 60, game);                // 本拍退出 flying（ai[0]→0）
    expect((pet as unknown as { flying: boolean }).flying).toBe(false);
    for (let t = 0; t < 8; t++) pet.fixedUpdate(1 / 60, game);
    expect(pet.rbBlend).toBeCloseTo(0, 6);        // −0.025/t 到底（:52095-52105 递减支）
  });

  it('D3-3 滚动态自旋 rotation += 0.5×spriteDirection（:50835-50838,自旋摘除变异体红）', () => {
    const game = fakeGame(fakeStore());
    // 属主置远（dist≈484,8 拍闭距 <10px 不触退出门）→ 8 拍全滚动态=确定性
    const pet = mkPet(mkOwner({ x: 590, y: 79, cx: 600, cy: 100 }));
    for (let t = 0; t < 8; t++) pet.fixedUpdate(1 / 60, game);
    expect((pet as unknown as { flying: boolean }).flying).toBe(true);   // 全程滚动态
    const rot = (pet as unknown as { rollRot: number }).rollRot;
    // 首 t1 只置位 flying 即 return（入态拍无位移）→ t2..t8 恰 7 拍自旋
    // （dir=+1 恒定:vx>0 定向）→ 确定性 7×0.5=3.5
    expect(rot).toBe(3.5);
  });

  it('D3-4 滚动模式切绘 1047 壳表（Main.cs:33212-33217 替换式,非叠加;摘除变异体红）', () => {
    const imgs: Record<string, { width: number; height: number; tag: string }> = {
      'vanilla/Projectile_1047.png': { width: 95, height: 380, tag: '1047' },
      'vanilla/Projectile_1090.png': { width: 34, height: 36, tag: '1090' },
      'vanilla/Projectile_250.png': { width: 14, height: 32, tag: '250' },
      'vanilla/Extra_55.png': { width: 68, height: 384, tag: 'e55' },
      'vanilla/Extra_283.png': { width: 34, height: 36, tag: 'e283' },
    };
    const calls: Array<{ img: { tag: string }; args: unknown[] }> = [];
    const ctx = new Proxy({}, {
      get: (_t, k) => (k === 'drawImage'
        ? (...a: unknown[]) => calls.push({ img: a[0] as { tag: string }, args: a })
        : () => {}),
      set: () => true,
    });
    const r = { ctx, atlas: { ensureVImage: (p: string) => imgs[p] } } as unknown as Renderer;
    // 滚动态：本体位 = 1047 壳格（Frame(5,20) 19×19,scale 0.5×2=1），1090 贴图不画
    const game = fakeGame(fakeStore());
    const pet = mkPet(mkOwner());
    for (let t = 0; t < 4; t++) pet.fixedUpdate(1 / 60, game);
    calls.length = 0;
    pet.draw(r, {} as Camera);
    const shell = calls.filter((c) => c.img.tag === '1047');
    expect(shell.length).toBeGreaterThan(0);
    expect(shell[0]!.args[3]).toBe(19);           // Frame(5,20,...) 源格宽
    expect(shell[0]!.args[4]).toBe(19);
    expect(calls.some((c) => c.img.tag === '1090')).toBe(false);   // 替换式（本体位被换装）
    // 非滚动态：自身贴图 + Extra_283 虹晕,无 1047 壳
    const pet2 = mkPet(mkOwner({ x: 92, y: 36, cx: 116, cy: 57 }));
    (pet2 as unknown as { flying: boolean }).flying = false;
    calls.length = 0;
    pet2.draw(r, {} as Camera);
    expect(calls.some((c) => c.img.tag === '1090')).toBe(true);
    expect(calls.some((c) => c.img.tag === '1047')).toBe(false);
    expect(calls.some((c) => c.img.tag === 'e283')).toBe(true);    // 虹晕三重
  });
});
