// ★X2 清偿刀 B（2026-09-29）：红蓝对抗复核（X2 路）BJ380-389 幽灵吸血/critter 域
// 四项漏修判别面。定谳锚（Terarria1457/Terraria/Projectile.cs,行号均指该树）：
//   D1 受理面判据：hurt 布尔返真=「本拍击杀/假人」（Enemy.ts:15033/:14184）非受理位;
//     返假三族=门拒（dead :13971/iframes :13972/dontTakeDamage :13978）+血尽级联
//     （:14369 族）+普通未致命尾档（:15037）——原版 proc（:13875-13879 canGhostHeal
//     门 → ghostHeal）/numHits++（:14263）在受理面【无死亡复查】→ 门拒不 proc 不
//     计数,非门拒（血尽/普通未致命）照 proc 照计数（BJ393 判据推广至残段）。
//   D2 251 proc：flag10（:13712 num41>0 ∧ lifeMax>5 ∧ friendly ∧ !hostile ∧ aiStyle≠59）
//     + :13877-79 —— 251 magic/friendly/aiStyle46（SetDefaults :3337-3351）。
//   D3 critter 面：Damage() 单趟 victim 循环（:12618 Main.npc 全体）critter 恒在内
//     ——本仓 critters 独立桶不被扫到 = 盒/线/AoE 面对小动物零受击。MedusaHead 豁免
//     （CanBeChasedBy lifeMax>5 :91141 排除 critter,volley 索敌无盒面）。critter
//     lifeMax≤5 经 flag10 lifeMax>5 段恒不吸血 → critter 支只入账不 proc。
//   D4 1115 pveNumHits 写口：projPveNumHits 读 pveNumHits（PVP 读口单源）,原计数域
//     在 hits → 读口恒 0 档;写位与 hits 同面同步自增。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { NebulaBlazeBolt, LunarFlareStar } from '../src/entities/LunarNebula';
import { PrismProj, PrismProng, BlasterBeam, ChargedBlaster } from '../src/entities/PrismProj';
import { RainbowSegment } from '../src/entities/RainbowProj';
import { BeamBoltProj } from '../src/entities/MagnetSphereProj';
import { ForbiddenSignProj } from '../src/entities/ForbiddenSignProj';
import { GlacierFangShot, type GlacierFangCtl } from '../src/entities/proj1457';
import { MedusaHeadProj } from '../src/entities/MedusaHeadProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}
interface CritterCall { dmg: number; fromPlayer: boolean }

const DEFENSE = 22;   // 实扣 = 入伤 − 22（num41 防后口径）

function enemySpy(id: number, tx: number, ty: number, w = 24, h = 24,
  vanillaId: number | null = 15) {
  return {
    id, x: tx * TILE, y: ty * TILE, w, h, dead: false, vanillaId, maxHp: 100, hp: 100,
    lastStrikeDealt: 0, attempts: 0, iframes: 0,
    hurt(this: { lastStrikeDealt: number; attempts: number }, dmg: number): boolean {
      this.attempts++;
      this.lastStrikeDealt = Math.max(0, dmg - DEFENSE);
      return true;
    },
  };
}

/** 小动物桩（life=5 一击即死,与真 Enemy 5 伤结算同相） */
function mkCritter(id: number, px: number, py: number, w = 18, h = 20) {
  const c = {
    id, x: px, y: py, w, h, dead: false, maxHp: 5, vanillaId: 201 as number | null,
    calls: [] as CritterCall[],
    hurt(dmg: number, _kx: number, _ky: number, _g: unknown, _armorPen: number,
      _crit: boolean, _pierce: number, fromPlayer: boolean): boolean {
      c.calls.push({ dmg, fromPlayer });
      c.dead = true;
      return true;
    },
  };
  return c;
}

function makeGame(log: StealCall[], list: unknown[], critters: unknown[] = [],
  player?: unknown): GameHooks {
  return {
    world: new World(160, 200, 30, 'x2b'),
    player: player ?? {
      buffs: { has: () => false },
      equipStats: {},
      critChance: () => 4,
    },
    enemies: () => list,
    critters: () => critters,
    entities: { nextId: 1, add: () => {} },
    playSfxFiles: () => {}, playSfx: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    spawnDust: () => null,
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
}

// ================= X2-D3：634/635 星云烈焰 critter 面 =================

describe('X2-D3 634 NebulaBlaze critter 面（飞行盒耗档→burst / Kill 50×50 AoE 全结算）', () => {
  it('飞行盒 critter 受击 → penetrate 1 档耗尽 → burst（:14189-14196+:17312）,入账不 proc', () => {
    const log: StealCall[] = [];
    const c = mkCritter(1, 80 * TILE + 10, 100 * TILE + 10);   // 40×40 飞行盒内
    const game = makeGame(log, [], [c]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 6, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(c.dead).toBe(true);                            // 5 伤一击即死
    expect(bolt.dead).toBe(true);                         // 耗档归零 → Kill=burst 同相
    expect(log.length).toBe(0);                           // critter lifeMax≤5 → flag10 恒不吸血
    expect(bolt.pveNumHits).toBe(1);                      // :14263 critter 受理命中入账
  });

  it('Kill AoE critter 与敌怪同一 victim 循环：飞行盒敌怪先行（0 档）,爆盒 critter 补结入账', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 100);                       // 飞行盒 1280..1320 内 → 子步 2 飞行面先结
    const c = mkCritter(2, 80 * TILE + 42, 100 * TILE + 10); // 爆盒 1275..1325 内,飞行盒外
    const game = makeGame(log, [e], [c]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);
    expect(c.dead).toBe(true);                            // 爆盒 critter 受击（skipId 只护敌桶）
    expect(log.length).toBe(1);                           // 仅敌怪 proc（critter 支不 proc）
    expect(log[0].numHits).toBe(0);                       // 飞行盒敌怪首结=0 档（critter 尚未入账）
    expect(bolt.pveNumHits).toBe(2);                      // 飞行敌怪 1 + 爆盒 critter 1
  });
});

// ================= X2-D3：645 月耀 critter 面 =================

describe('X2-D3 645 LunarFlare critter 面（飞行盒转爆相 / 140×140 爆炸相全结算）', () => {
  it('爆炸相 critter 受击入账（penetrate=-1 不亡不截断,hitCrittersAll 全结算）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 100);                       // 距星心 23 < 60 触发爆炸
    const c = mkCritter(2, 82 * TILE, 100 * TILE);        // 爆盒 1215..1355 内
    const game = makeGame(log, [e], [c]);
    const star = new LunarFlareStar(80 * TILE, 100 * TILE, 0, 0, 100, 4.5, 200 * TILE);
    star.critChance = 0;
    star.fixedUpdate(1, game);
    expect(c.dead).toBe(true);
    expect(log.length).toBe(1);
    expect(log[0].numHits).toBe(1);                       // critter 先入账 → 敌怪 proc 读 1 档
    expect(star.pveNumHits).toBe(2);
  });

  it('飞行盒 critter 接触 → 转爆炸相（:14255-14259 转爆支对 critter 同达）;飞行相零伤承载同构', () => {
    const log: StealCall[] = [];
    const c = mkCritter(1, 80 * TILE, 100 * TILE + 25);   // 飞行路径上（vy=20/substep）
    const game = makeGame(log, [], [c]);
    const star = new LunarFlareStar(80 * TILE, 100 * TILE, 0, 20, 100, 4.5, 100 * TILE + 30);
    star.critChance = 0;
    star.fixedUpdate(1, game);
    expect(c.dead).toBe(true);                            // 飞行盒 critter 受击
    expect((star as unknown as { w: number }).w).toBe(140);  // 已转爆炸相（140×140 锚定盒）
    expect(log.length).toBe(0);                           // 与敌怪飞行面同构=零伤转爆承载
  });
});

// ================= X2-D3：632/461 束线 critter 面 =================

describe('X2-D3 632 PrismProng / 461 BlasterBeam critter 束线面', () => {
  it('632 束线扫过 critter → 受击入账不 proc（penetrate=-1 不亡）', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const parent = new PrismProj(0, 1, 100, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent.x = 80 * TILE; parent.y = 98 * TILE;
    parent.charge = 60;
    const prong = new PrismProng(0, 100, 2);
    prong.parent = parent;
    prong.critChance = 0;
    parent.prongs.push(prong);
    prong.fixedUpdate(1 / 60, game);                      // 首拍定锚/束向
    const bx = prong.cx + prong.vx * 60, by = prong.cy + prong.vy * 60;
    const c = mkCritter(1, bx - 9, by - 9);               // 束线 d=60 处（厚 22 内）
    const g2 = { ...game, critters: () => [c] } as unknown as GameHooks;
    prong.fixedUpdate(1 / 60, g2);
    expect(c.dead).toBe(true);
    expect(prong.pveNumHits).toBe(1);
    expect(log.length).toBe(0);                           // critter 不吸血
  });

  it('632 critter 面与敌怪面共存：同拍各入各账（critter 1 + 敌怪 proc 1 档）', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const parent = new PrismProj(0, 1, 100, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent.x = 80 * TILE; parent.y = 98 * TILE;
    parent.charge = 60;
    const prong = new PrismProng(0, 100, 2);
    prong.parent = parent;
    prong.critChance = 0;
    parent.prongs.push(prong);
    prong.fixedUpdate(1 / 60, game);
    const e = enemySpy(1, 0, 0, 48, 48);
    const c = mkCritter(2, 0, 0);
    e.x = prong.cx + prong.vx * 60 - 24; e.y = prong.cy + prong.vy * 60 - 24;
    c.x = prong.cx + prong.vx * 180 - 9; c.y = prong.cy + prong.vy * 180 - 9;
    const g2 = { ...game, enemies: () => [e], critters: () => [c] } as unknown as GameHooks;
    prong.fixedUpdate(1 / 60, g2);
    expect(c.dead).toBe(true);
    expect(log.length).toBe(1);
    expect(log[0].numHits).toBe(1);
    expect(prong.pveNumHits).toBe(2);
  });

  it('461 束线扫过 critter → 受击入账不 proc', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const cb = new ChargedBlaster(1, 0, 130, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    cb.x = 80 * TILE; cb.y = 99 * TILE;
    const beam = new BlasterBeam(130, 2);
    beam.parent = cb;
    beam.critChance = 0;
    const bcx = cb.cx + cb.dirX * 16, bcy = cb.cy;
    const c = mkCritter(1, bcx + 48 - 9, bcy - 9);
    const g2 = { ...game, critters: () => [c] } as unknown as GameHooks;
    beam.fixedUpdate(1 / 60, g2);
    expect(c.dead).toBe(true);
    expect(beam.pveNumHits).toBe(1);
    expect(log.length).toBe(0);
  });
});

// ================= X2-D3：255 磁球激光 critter 面 =================

describe('X2-D3 255 BeamBolt critter 面（penetrate 1 耗档 → killBeam）', () => {
  it('critter 受击 → 弹亡铺束（:17312 同相）,入账不 proc', () => {
    const log: StealCall[] = [];
    const c = mkCritter(1, 80 * TILE + 8, 100 * TILE + 2, 12, 12);
    const game = makeGame(log, [], [c]);
    const bolt = new BeamBoltProj(80 * TILE, 100 * TILE, 6, 0, 130, 2, 255);
    bolt.critChance = 0;
    bolt.fixedUpdate(1 / 60, game);
    expect(c.dead).toBe(true);
    expect(bolt.dead).toBe(true);                         // 耗档归零 → Kill=铺束同相
    expect(log.length).toBe(0);
    expect((bolt as unknown as { pveNumHits: number }).pveNumHits).toBe(1);
  });
});

// ================= X2-D3：656 禁戒沙暴柱 critter 面 =================

describe('X2-D3 656 ForbiddenSign critter 面（:14245 hitCount/:14263 numHits 同达）', () => {
  it('critter 受击 → hitCount/pveNumHits 同步入账,不 proc 不占 8t 局部窗', () => {
    const log: StealCall[] = [];
    const c = mkCritter(1, 79 * TILE + 2, 98 * TILE);
    const game = makeGame(log, [], [c], {
      cx: 40 * TILE, cy: 50 * TILE, y: 50 * TILE, equipStats: { critMagic: 0 },
    });
    const storm = new ForbiddenSignProj(80 * TILE, 97 * TILE, 130);
    storm.fixedUpdate(1 / 60, game);
    expect(c.dead).toBe(true);
    expect(log.length).toBe(0);
    expect(storm.pveNumHits).toBe(1);
    expect(storm.hitCount).toBe(1);                       // :14245 localAI[0]++ 对 critter 同达
  });
});

// ================= X2-D2：251 彩虹段 proc 接线 + critter 面 =================

describe('X2-D2 251 RainbowSegment ghostHeal proc（:13712 flag10+:13877-79）', () => {
  it('命中敌 → proc（dmg=防后,numHits=0,Center 出生,isMagic）;critter 同拍先入账 → 敌怪读 1 档', () => {
    // ★BJ723-C M02：251 DV 首掷后防后值非确定——mock 0.5（tier 0,DV 恒等）恢复定值
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log: StealCall[] = [];
    const e = enemySpy(901, 79, 99);                      // id 避让模块级 segImmuneUntil 跨案残留
    const c = mkCritter(902, 79 * TILE + 4, 99 * TILE + 4, 12, 12);
    const game = makeGame(log, [e], [c]);
    const seg = new RainbowSegment(80 * TILE, 100 * TILE, 1, 0, 100, 2);
    seg.critChance = 0;
    seg.fixedUpdate(1 / 60, game);
    expect(c.dead).toBe(true);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);                           // ← X2-D2 病灶：旧码 0
    expect(log[0].kind).toBe('ghost');
    expect(log[0].dmg).toBe(100 - DEFENSE);
    expect(log[0].numHits).toBe(1);                       // critter 先入账 → 敌怪 proc 读 1 档
    expect(log[0].isMagic).toBe(true);                    // 251 magic（SetDefaults :3343）
    expect(seg.pveNumHits).toBe(2);
  });

  it('门拒（iframes>0）不 proc 不计数——★X2-D1 判据（251 IDStatic → flag3 假,免疫门照适用）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(911, 79, 99);
    e.iframes = 10;
    e.hurt = () => false;
    const game = makeGame(log, [e]);
    const seg = new RainbowSegment(80 * TILE, 100 * TILE, 1, 0, 100, 2);
    seg.critChance = 0;
    seg.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(0);
    expect(seg.pveNumHits).toBe(0);
  });
});

// ================= X2-D1：美杜莎 536 受理族 + critter 豁免（:91141） =================

describe('X2-D1 MedusaHead 536 受理族（hurt 返假无门位照 proc）+ D3 豁免（CanBeChasedBy lifeMax>5）', () => {
  it('目标 hurt 返假（血尽/普通未致命形态）→ proc 照达（门拒两族外均受理）', () => {
    const log: StealCall[] = [];
    const p = new Player(80 * TILE, 100 * TILE, new Inventory());
    p.useTime = 10;
    p.mana = 200;
    const e = enemySpy(1, 81, 100);
    e.hurt = () => false;                                 // 无门位返假=受理形态
    const game = makeGame(log, [e], [], p);
    const m = new MedusaHeadProj(p, 130, 2, 0, 0);
    m.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(1);                           // 非门拒=受理 → proc 照达
    expect(log[0].kind).toBe('ghost');
    expect(log[0].numHits).toBe(0);                       // 每目标独立 536,numHits 前值恒 0
    (m as unknown as { retire(): void }).retire();
  });

  it('小动物不入索敌（lifeMax>5 门 :91141）→ 零受击零 proc（D3 豁免成立不接判别）', () => {
    const log: StealCall[] = [];
    const p = new Player(80 * TILE, 100 * TILE, new Inventory());
    p.useTime = 10;
    p.mana = 200;
    const c = mkCritter(1, 81 * TILE, 100 * TILE);        // 距手 17px < 320,maxHp=5
    const game = makeGame(log, [], [c], p);
    const m = new MedusaHeadProj(p, 130, 2, 0, 0);
    m.fixedUpdate(1 / 60, game);
    expect(c.calls.length).toBe(0);                       // volley 索敌排除 critter
    expect(log.length).toBe(0);
    (m as unknown as { retire(): void }).retire();
  });
});

// ================= X2-D4：1115 GlacierFangShot pveNumHits 写口 =================

describe('X2-D4 1115 pveNumHits 写位（projPveNumHits PVP 读口与 hits 同面）', () => {
  const ctl: GlacierFangCtl = {
    channel: () => false, aim: () => ({ x: 0, y: 0 }), payMana: () => {},
    chargeRate: () => 1,
  };

  it('敌怪受理命中 → pveNumHits=hits=1（原读口恒 0 档=病灶）', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const shot = new GlacierFangShot(80 * TILE, 90 * TILE, 0, 0, 60, 2, ctl);
    shot.critChance = 0;
    shot.fixedUpdate(1 / 60, game);                       // 释放拍（charge=0 → penTier=1）
    const e = enemySpy(1, (shot.x + 4) / TILE, (shot.y + 4) / TILE);
    const g2 = { ...game, enemies: () => [e] } as unknown as GameHooks;
    shot.fixedUpdate(1 / 60, g2);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].numHits).toBe(0);                       // proc 读自增前值
    expect((shot as unknown as { pveNumHits: number }).pveNumHits).toBe(1);
    expect(shot.dead).toBe(true);                         // hits=1 ≥ penTier=1
  });

  it('critter 受理命中 → pveNumHits 同步入账（:14263 critter 亦入账）', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const shot = new GlacierFangShot(80 * TILE, 90 * TILE, 0, 0, 60, 2, ctl);
    shot.critChance = 0;
    shot.fixedUpdate(1 / 60, game);
    const c = mkCritter(1, shot.x - 2, shot.y - 2);
    const g2 = { ...game, critters: () => [c] } as unknown as GameHooks;
    shot.fixedUpdate(1 / 60, g2);
    expect(c.dead).toBe(true);
    expect(log.length).toBe(0);
    expect((shot as unknown as { pveNumHits: number }).pveNumHits).toBe(1);
    expect(shot.dead).toBe(true);
  });
});
