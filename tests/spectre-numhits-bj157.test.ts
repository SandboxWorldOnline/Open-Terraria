// ★BJ157 登记债 1-4（spectre/numHits 族）回归（2026-09-18）
//   ① MagicProj 补 ghostHeal proc（Projectile.cs:13875-84 canGhostHeal|flag9 块内
//     ghostHeal 在先(:13877-79)、ghostHurt 在后(:13881-83)——本仓此前只接 ghostHurt）
//   ② numHits off-by-one（Arrow/MissileProj 传 N,原版传 N−1——numHits++ :14263 在
//     proc 块【后】⇒ 首跳读 0 率 0.20,旧码首跳 0.15;旧注「StrikeNPC 先自增」系误记）
//   ③ 无限穿透族 hitSet 恒空 → 治疗率不衰减（原版 numHits = 每受理命中 per-proj
//     计数,跨敌/同敌冷却再命中每跳计入）
//   ④ Game.ts PVP ghostHeal numHits 硬编 1（原版 Damage_PVP 不自增 numHits,
//     :14741-44 读弹幕当前计数 → 新弹 0 档率 0.20）
// 标杆 Terarria1457/Terraria/Projectile.cs（1456 同构 :12887-91 proc 块 / :13243
// numHits++ 交叉核对同序;vampireHeal :12112-12123 固定 0.075 不读 numHits）。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Game } from '../src/core/Game';
import { Arrow } from '../src/entities/Arrow';
import { MagicProj } from '../src/entities/MagicProj';
import { MagicMissileProj } from '../src/entities/MissileProj';
import { HealProj } from '../src/entities/HealProj';
import { projPveNumHits } from '../src/entities/SpectreSoulProj';
import type { GameHooks } from '../src/entities/types';

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}

/** 敌怪 spy：hurt 落 lastStrikeDealt（StrikeNPC num41 等位）+ iframes=10
 *  （原版命中尾 immune[owner] 写帧的同构最小面——无限穿透弹重叠期防同拍连跳） */
function enemySpy(id: number, x: number, y: number, w = 16, h = 16,
  vanillaId: number | null = 15) {
  return {
    id, x, y, w, h, dead: false, vanillaId, maxHp: 100,
    lastStrikeDealt: 0, iframes: 0,
    hurt(this: { lastStrikeDealt: number; iframes: number }, dmg: number): boolean {
      this.lastStrikeDealt = dmg;
      this.iframes = 10;
      return true;
    },
  };
}

function makeGame(log: StealCall[], enemies: unknown[],
  order?: string[], playerLike?: unknown, world?: World): GameHooks {
  return {
    world: world ?? new World(64, 32, 42, 'bj157'),
    player: playerLike ?? new Player(30 * 16, 10 * 16, new Inventory()),
    enemies: () => enemies, critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, spawnParticles: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    playSfxFiles: () => {}, onEnemyKilled: () => {},
    entities: { add: () => { if (order) order.push('ghostHurt'); }, nextId: 1 },
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      if (order) order.push('ghostHeal');
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
}

// ---------------------------------------------------------------------------
// ① MagicProj ghostHeal proc（Projectile.cs:13877-79 —— 块内先于 ghostHurt :13881）
// ---------------------------------------------------------------------------
describe('BJ157-① MagicProj ghostHeal proc 补缺（Projectile.cs:13877-79）', () => {
  it('魔法弹命中 → 单源 applyLifeSteal(ghost, num41, 0, 受害者Center, magic)；先于 ghostHurt', () => {
    const log: StealCall[] = [];
    const order: string[] = [];
    // 裸形玩家带 ghostHurt 旗（ghostHurt 支激活以验块内先后序;ghostHeal 门在
    // applyLifeSteal 内自证——spy 面只验接线与实参）
    const player = { dead: false, cx: 480, cy: 160, x: 470, y: 150, w: 20, h: 42,
      hp: 100, maxHp: 100, luck: 0, addDPS: (_d: number) => {},
      equipStats: { setBonus: { ghostHurt: true } } };
    const e = enemySpy(1, 480, 256);
    const game = makeGame(log, [e], order, player);
    const proj = new MagicProj(484, 264, 0, 0, 50, 60, '#8080FF', 15);
    proj.critChance = 0;
    proj.fixedUpdate(1 / 60, game);
    expect(e.lastStrikeDealt).toBe(50);       // num41 结算面
    expect(log.length).toBe(1);
    expect(log[0]).toEqual({ kind: 'ghost', dmg: 50, numHits: 0,
      x: 480 + 8, y: 256 + 8, isMagic: true });   // 受害者 Center（vanilla Vector2 实参）
    expect(order).toEqual(['ghostHeal', 'ghostHurt']);   // :13877 在 :13881 之前
    expect(e.iframes).toBe(10);               // 敌帧写面未被 proc 支破坏
  });

  it('判别力：canGhostHeal=false 族 384 不 proc；非魔法弹（1 木箭）不 proc', () => {
    const log1: StealCall[] = [];
    const e1 = enemySpy(1, 480, 256, 16, 16, 384);
    const g1 = makeGame(log1, [e1]);
    const p1 = new MagicProj(484, 264, 0, 0, 50, 60, '#8080FF', 15);
    p1.critChance = 0;
    p1.fixedUpdate(1 / 60, g1);
    expect(e1.lastStrikeDealt).toBe(50);      // 命中照常结算
    expect(log1.length).toBe(0);              // :13875 victim 门

    const log2: StealCall[] = [];
    const e2 = enemySpy(2, 480, 256);
    const g2 = makeGame(log2, [e2]);
    const p2 = new MagicProj(484, 264, 0, 0, 50, 60, '#8080FF', 1);   // 木箭非 magic
    p2.critChance = 0;
    p2.fixedUpdate(1 / 60, g2);
    expect(e2.lastStrikeDealt).toBe(50);
    expect(log2.length).toBe(0);              // magic 归属面门
  });

  it('298 生成+归因：兜帽头 + numHits=0 → HealProj(298) heal=floor(dmg×0.20) 目标=玩家；次跳 0.15 档', () => {
    const g = Object.create(Game.prototype) as unknown as
      Record<string, unknown> & { applyLifeSteal: (...a: unknown[]) => number };
    const target = { x: 0, y: 0, w: 20, h: 42, hp: 50, maxHp: 400,
      dead: false, cx: 10, cy: 21, luck: 0,
      buffs: { moonLeech: false },
      equipStats: { setBonus: { ghostHeal: true } },
      lifeSteal: 100 };
    g.player = target;
    // ★BJ748（A23 尾迹收口）：BJ746 A23 起 applyLifeSteal ghost 支走 candidatePlayers()
    //  选最缺血者（:12097-12108）——proto 桩必须补 remotePlayerProxies 字段（构造器
    //  字段初始化被 Object.create 跳过,缺面=spread 炸「not iterable」;④ PVP shell 同式）。
    g.remotePlayerProxies = [];
    const added: unknown[] = [];
    g.entities = { add: (e: unknown) => { added.push(e); } };
    const n0 = g.applyLifeSteal('ghost', 50, 0, 500, 600, true);
    expect(n0).toBe(10);                      // floor(50×0.20)——首跳档（:12080 numHits=0）
    expect(added.length).toBe(1);
    const orb = added[0] as HealProj;
    expect(orb).toBeInstanceOf(HealProj);
    expect(orb.projType).toBe(298);           // ghostHeal → 298（:11436 1456 等位/:12099 1457）
    expect(orb.heal).toBe(10);
    expect((orb as unknown as { target: unknown }).target).toBe(target);   // 归因=本地玩家
    const n1 = g.applyLifeSteal('ghost', 50, 1, 500, 600, true);
    expect(n1).toBe(7);                       // floor(50×0.15)——次跳档（off-by-one 判别子）
    expect(added.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ②③ Arrow numHits（N−1 对齐 + 无限穿透 per-proj 衰减）
// ---------------------------------------------------------------------------
describe('BJ157-②③ Arrow numHits（:14263 在 proc 块后 ⇒ 传此前命中数）', () => {
  it('有限穿透两敌：首跳 numHits=0（率 0.20）、次跳 1（率 0.15）；命中尾 ++ 同相', () => {
    const log: StealCall[] = [];
    const e1 = enemySpy(1, 480, 256);
    const e2 = enemySpy(2, 560, 256);
    const game = makeGame(log, [e1, e2]);
    const a = new Arrow(450, 264, 6, 0, 60, 0, 15, { grav: 0, life: 300, pierce: 2 });
    for (let i = 0; i < 40 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(2);
    expect(log[0].numHits).toBe(0);           // ← 旧码 hitSet.size=1（首跳 0.15 off-by-one）
    expect(log[1].numHits).toBe(1);
    expect(a.pveNumHits).toBe(2);             // numHits++（:14263 同相位）
  });

  it('无限穿透（pierce −1）：跨敌每跳衰减（旧码 hitSet 恒空 = 治疗率恒 0.20 冻结）', () => {
    const log: StealCall[] = [];
    const e1 = enemySpy(1, 480, 256);
    const e2 = enemySpy(2, 620, 256);
    const game = makeGame(log, [e1, e2]);
    const a = new Arrow(450, 264, 6, 0, 60, 0, 15, { grav: 0, life: 300, pierce: -1 });
    for (let i = 0; i < 60 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(2);
    expect(log[0].numHits).toBe(0);
    expect(log[1].numHits).toBe(1);           // ← 旧码恒 0（hitSet 不收无限穿透弹）
  });
});

// ---------------------------------------------------------------------------
// ② MagicMissileProj numHits（pierceInit−pierce = 此前命中数）
// ---------------------------------------------------------------------------
describe('BJ157-② MagicMissileProj numHits（Projectile.cs:13877/:14263 序）', () => {
  it('双敌同拍两跳（34 penetrate=2）：首跳 numHits=0、次跳 1', () => {
    const log: StealCall[] = [];
    // 64×64 世界（弹心格 (33,33) 界内——makeGame 缺省 64×32 会界外杀,与命中面无关）
    const world = new World(64, 64, 7, 'bj157-m');
    const e1 = enemySpy(55, world.w * 8 - 120, world.h * 8 - 120, 240, 240);
    const e2 = enemySpy(56, world.w * 8 - 120, world.h * 8 - 120, 240, 240);
    const game = makeGame(log, [e1, e2], undefined, undefined, world);
    const proj = new MagicMissileProj(e1.x + 120, e1.y + 120, 0, 0, {
      projId: 34, damage: 80, knockback: 2, useTime: 20,
      channelCb: () => false, aimCb: () => ({ x: e1.x + 120, y: e1.y + 120 }),
      payMana: () => true,
    });
    proj.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(2);
    expect(log[0].numHits).toBe(0);           // ← 旧码 +1 = 首跳 0.15
    expect(log[1].numHits).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ④ PVP ghostHeal numHits（Damage_PVP 不自增 → 读弹幕当前计数）
// ---------------------------------------------------------------------------
describe('BJ157-④ PVP ghostHeal numHits（Projectile.cs:14741-44 读当前计数,不自增）', () => {
  function shell(proj: unknown, steals: StealCall[]) {
    const g = Object.create(Game.prototype) as unknown as {
      world: unknown; player: unknown; tickCount: number;
      pvpProjHitSet: Set<string>; remotePlayerProxies: unknown[];
      net: unknown; entities: unknown;
      applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
        x: number, y: number, isMagic?: boolean) => number;
      netPvpProjFeedback: () => void;
    };
    const player = new Player(800, 1440, new Inventory());
    player.hostile = true;
    g.world = new World(160, 160, 42, 'bj157-pvp') as never;
    g.player = player as never;
    g.tickCount = 7 as never;
    g.pvpProjHitSet = new Set<string>() as never;
    const rp = new Player(802, 1440, new Inventory());
    rp.hostile = true;
    (rp as unknown as { __netSlot?: number }).__netSlot = 1;
    g.remotePlayerProxies = [rp] as never;
    g.applyLifeSteal = (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      steals.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    };
    g.net = { active: true, policy: { pvpAllowed: true }, players: new Map(),
      getProxyPvpImmuneRemaining: () => 0 } as never;
    g.entities = { projectiles: [proj] } as never;
    return g;
  }

  function pvpArrow(): Arrow {
    const a = new Arrow(800, 1432, 0, 0, 40, 0, 15, { grav: 0, life: 300 });
    a.x = 800; a.y = 1436; a.w = 32; a.h = 32;    // 与 rp(802,1440) 盒相交
    return a;
  }

  it('新弹（无 PVE 命中）打敌对玩家 → numHits=0（率 0.20;旧硬编 1 = 0.15）', () => {
    const steals: StealCall[] = [];
    const g = shell(pvpArrow(), steals);
    g.netPvpProjFeedback();
    expect(steals.length).toBe(1);
    expect(steals[0].kind).toBe('ghost');
    expect(steals[0].numHits).toBe(0);
    expect(steals[0].isMagic).toBe(true);     // projId 15 magic 类（FR6-F 通道不回归）
  });

  it('PVE 已打 3 跳的弹幕 → numHits=3（弹幕当前计数跨域读）', () => {
    const steals: StealCall[] = [];
    const a = pvpArrow();
    a.pveNumHits = 3;
    const g = shell(a, steals);
    g.netPvpProjFeedback();
    expect(steals.length).toBe(1);
    expect(steals[0].numHits).toBe(3);
  });

  it('projPveNumHits 单源：未跟踪/脏值 → 0 档（原版 SetDefaults :706 numHits=0）', () => {
    expect(projPveNumHits(null)).toBe(0);
    expect(projPveNumHits({})).toBe(0);
    expect(projPveNumHits({ pveNumHits: Number.NaN })).toBe(0);
    expect(projPveNumHits({ pveNumHits: -2 })).toBe(0);
    expect(projPveNumHits({ pveNumHits: 2.9 })).toBe(2);
    expect(projPveNumHits({ pveNumHits: 5 })).toBe(5);
  });
});
