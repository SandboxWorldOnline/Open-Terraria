// ★BJ712-B（2026-10-25）：DD2/事件域六件外部核报转报·逐件定谳守卫。
//   标杆 1457。转报快照早于 BJ710-C/G35 旗链刀（件 5/6 销案面）。
//   件1 GetAttackDamage_ForProjectiles 大师档钳位（NPC.cs:7079-7082 + Utils.cs:345
//      Remap 默认 clamped=true → Master=专家值/Journey=经典值;旧本地 projDmgOf 按
//      不钳界外推自算=多副本漂移,单源 ScaleStats.getAttackDamageForProjectiles 才是真身）
//      ——十站（哥布林投弹手×3/标枪手×3/德拉肯×2/食人魔跺地+吐息）终值闭环锁
//      90/150/210 · 60/120/180 · 150/270 · 240 · 180（=projDmg×HostileProjMult(3)×2）。
//   件2 小妖魔自爆（地面 572/573 NPC.cs:63903 + 滑翔 574/575 :66491）
//      damage = GetAttackDamage_ScaledByDifficulty(80) = 80/160/240（曾钉死 80）。
//   件3 枯萎兽削甲圈（NPC.cs:64110 `(Center-Center).Length() < 400f` 圆形严格 <;
//      旧方形 |Δx|≤400∧|Δy|≤400 对角多吃 41% 半径——(400,293)≈495px 仍削甲）。
//   件4 哥布林炸弹 681（Kill 尾 Damage() 整链）与食人魔跺地波 683 同走
//      Projectile.Damage → 链首 Main.DamageVar(damage, -player.luck)（P.cs:14904）
//      ±15% 离散 31 档掷骰——曾直结固定值（外部核报件 4）。
//   件5 南瓜月/霜月三弹幕站旗链核验（转报疑漏→销案:均已在列）:
//      315 无头骑士 1001（Enemy.ts shoot 站,banner 120）/347 精灵直升机 180
//      （moon_events shootE 站,banner 110）/350 精灵弓手 82 燃烧箭（RANGED_TABLE
//      通用支→spawnHostileProj 内冻结,banner 109）。
//   件6 转报已修面锁在位复核:接触旗减伤 DD2 档 0.917/0.833（G35 D3,100→91/83/83）
//      + 弹幕旗链（BJ710-C hitPlayer:845 DamageVar→banner→缩放→×2）。
//   变异恰红（M1-M4）：外推回退/80 钉死/方形回退/DamageVar 摘除 各炸对应腿。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import {
  DD2GoblinBomb, DD2OgreSmash, projDmgOf, dd2LocalAI,
} from '../src/entities/bossAI_dd2';
import { evpDirectDmg } from '../src/entities/projTargets';
import { GDL } from '../src/stats/ScaleStats';
import { bannerOfNpc, bannerItemId, bannerReceivedMult } from '../src/world/Banners';
import { readFileSync } from 'node:fs';

const W = 200, H = 140, FLOOR = 110;
const SRC_DD2 = readFileSync(new URL('../src/entities/bossAI_dd2.ts', import.meta.url), 'utf8');
const SRC_ENEMY = readFileSync(new URL('../src/entities/Enemy.ts', import.meta.url), 'utf8');
const SRC_MOON = readFileSync(new URL('../src/entities/bossAI_moon_events.ts', import.meta.url), 'utf8');
const SRC_PROJT = readFileSync(new URL('../src/entities/projTargets.ts', import.meta.url), 'utf8');

function makeWorld(difficulty = 0): World {
  const w = new World(W, H, 7, 'bj712b');
  w.difficulty = difficulty;
  const st = w.store;
  w.groundLevel = 40;
  for (let x = 0; x < W; x++) {
    st.setTile(x, FLOOR, 1);
    st.setTile(x, FLOOR + 1, 1);
  }
  return w;
}

type ProjCap = { damage: number; projId?: number; bannerNpcId?: number | null; dead?: boolean; w: number; h: number; x: number; y: number; fixedUpdate?: (dt: number, g: GameHooks) => void };
type BuffApply = { type: number; secs: number };

function makeHooks(world: World, playerAt?: { x: number; y: number; buffs?: { apply: (t: number, s: number) => void } }) {
  const enemies: Enemy[] = [];
  const projectiles: ProjCap[] = [];
  const damageCalls: number[] = [];
  const buffApplies: BuffApply[] = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: 'enemies' | 'projectiles') => {
      const ent = e as { id: number };
      ent.id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
      else projectiles.push(e as ProjCap);
    },
  };
  const px = (playerAt?.x ?? -9999) * TILE, py = (playerAt?.y ?? -9999) * TILE;
  const player = {
    x: px, y: py, w: 20, h: 42, cx: px + 10, cy: py + 21,
    vx: 0, vy: 0, hp: 400, maxHp: 400, dead: false, useTime: 1, luck: 0,
    aabbOverlaps: () => false,
    buffs: playerAt?.buffs ?? { apply: (t: number, s: number) => { buffApplies.push({ type: t, secs: s }); } },
  };
  const hooks = {
    world, player,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (dmg: number): number => { damageCalls.push(dmg); return 1; },
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, projectiles, damageCalls, buffApplies, player };
}

function spawn(h: ReturnType<typeof makeHooks>, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  e.id = h.enemies.length + 1;
  h.enemies.push(e);
  return e;
}

function tick(h: ReturnType<typeof makeHooks>, n: number, only?: Enemy[]) {
  for (let i = 0; i < n; i++) {
    for (const e of only ?? h.enemies) {
      if (!e.dead) e.fixedUpdate(1 / 60, h.hooks);
    }
    for (const p of h.projectiles as unknown as Array<{ dead?: boolean; fixedUpdate?: (dt: number, g: GameHooks) => void }>) {
      if (!p.dead) p.fixedUpdate?.(1 / 60, h.hooks);
    }
  }
}

const at = (difficulty: number): Enemy => ({ difficulty }) as unknown as Enemy;

// ---------------------------------------------------------------------------
describe('件1：GetAttackDamage_ForProjectiles 大师档钳位（Utils.Remap clamped 默认）', () => {
  it('纯函数四档：经典=normal / 专家=expert / 大师=【专家值,钳位】/ 旅程=【经典值,钳位】', () => {
    expect(projDmgOf(at(GDL.CLASSIC), 30, 25)).toBe(30);
    expect(projDmgOf(at(GDL.EXPERT), 30, 25)).toBe(25);
    expect(projDmgOf(at(GDL.MASTER), 30, 25)).toBe(25);    // ★M1：外推回退（2×25−30=20）→红
    expect(projDmgOf(at(GDL.LEGENDARY), 30, 25)).toBe(25); // 原版 Remap 钳界对 4 档同样成立
    expect(projDmgOf(at(GDL.JOURNEY), 30, 25)).toBe(30);   // 旅程也钳在经典值（旧外推 32.5→33 →红）
  });

  it('十站字面锁（walker107Params 各 case 的 projDmgOf 实参,防静默漂移）', () => {
    const literals = [
      'projDmgOf(e, 20, 15)', 'projDmgOf(e, 30, 25)', 'projDmgOf(e, 40, 35)',   // 555/556/557 炸弹
      'projDmgOf(e, 15, 10)', 'projDmgOf(e, 30, 20)', 'projDmgOf(e, 45, 30)',   // 561/562/563 标枪
      'projDmgOf(e, 35, 25)', 'projDmgOf(e, 60, 45)',                           // 570/571 德拉肯
      'projDmgOf(e, 60, 40)', 'projDmgOf(e, 40, 30)',                           // 683 跺地 / 676 吐息
    ];
    for (const lit of literals) expect(SRC_DD2).toContain(lit);
    // 单源委托在位（摘除=回退本地自算 →红）
    expect(SRC_DD2).toContain('getAttackDamageForProjectiles(normal, expert, e.difficulty)');
  });

  it('★转报终值闭环锁（大师档 projDmg→HostileProjectileDamageMultiplier(3)→×2）', () => {
    const w = makeWorld(2);   // 大师世界（Main.Difficulty 轴）
    const h = makeHooks(w, { x: 5, y: 5 });
    const final = (n: number, x: number) => evpDirectDmg(h.hooks, projDmgOf(at(GDL.MASTER), n, x), null);
    // 哥布林投弹手炸弹（T1/T2/T3）——转报「60/120/180→应 90/150/210」
    expect(final(20, 15)).toBe(90);
    expect(final(30, 25)).toBe(150);
    expect(final(40, 35)).toBe(210);
    // 标枪手标枪——转报「30/60/90→应 60/120/180」
    expect(final(15, 10)).toBe(60);
    expect(final(30, 20)).toBe(120);
    expect(final(45, 30)).toBe(180);
    // 德拉肯吐（570/571）——转报「90/180→应 150/270」
    expect(final(35, 25)).toBe(150);
    expect(final(60, 45)).toBe(270);
    // 食人魔踩地/吐液（转报另条同域顺查）——「120/160/120→应 120/160/240」「80/120/120→应 80/120/180」
    expect(final(60, 40)).toBe(240);
    expect(final(40, 30)).toBe(180);
    // 经典/专家档对照（前两档旧值即原版,不因本刀漂移）
    const hC = makeHooks(makeWorld(0), { x: 5, y: 5 });
    expect(evpDirectDmg(hC.hooks, projDmgOf(at(GDL.CLASSIC), 30, 25), null)).toBe(60);
    const hE = makeHooks(makeWorld(1), { x: 5, y: 5 });
    expect(evpDirectDmg(hE.hooks, projDmgOf(at(GDL.EXPERT), 30, 25), null)).toBe(100);
  });

  it('端到端：556 投弹手大师档实弹（走真实 walker107Params/fireWalkerProj 链）', () => {
    const w = makeWorld(2);
    const h = makeHooks(w, { x: 102, y: FLOOR - 3 });
    const e = spawn(h, 556, 100, FLOOR - 3);
    e.difficulty = GDL.MASTER;                 // npc.difficulty 轴（ScaleStats 投影）
    dd2LocalAI(e)[3] = 60;                     // 跳过出生爬坡（startRange=1 期不起手）
    tick(h, 40, [e]);                          // 落地+起手 timer42→fireAt18 出弹
    const bombs = h.projectiles.filter((p) => p instanceof DD2GoblinBomb);
    expect(bombs.length).toBeGreaterThan(0);
    expect(bombs[0].damage).toBe(25);          // ★大师钳位=专家值（旧外推 20 →红）
    expect(evpDirectDmg(h.hooks, bombs[0].damage, null)).toBe(150);   // 闭环:大师终值 150
    expect(bombs[0].bannerNpcId).toBe(556);    // BJ710-C 旗冻结在位（DD2 档弹减伤面）
  });

  it('端到端：562 标枪手大师档实弹（shootD2→Arrow 载体）', () => {
    const w = makeWorld(2);
    const h = makeHooks(w, { x: 103, y: FLOOR - 3 });
    const e = spawn(h, 562, 100, FLOOR - 3);
    e.difficulty = GDL.MASTER;
    dd2LocalAI(e)[3] = 60;
    tick(h, 40, [e]);                          // timer90→fireAt82:起手后 8 拍出弹
    const j = h.projectiles.find((p) => !(p instanceof DD2GoblinBomb) && !(p instanceof DD2OgreSmash) && p.damage > 0);
    expect(j).toBeTruthy();
    expect(j!.damage).toBe(20);                // (30,20) 大师钳位（旧外推 10 →红）
    expect(evpDirectDmg(h.hooks, j!.damage, null)).toBe(120);
  });
});

// ---------------------------------------------------------------------------
describe('件2：小妖魔自爆难度倍率（GetAttackDamage_ScaledByDifficulty(80)）', () => {
  it('地面型 572 三档（NPC.cs:63903）：经典 80/专家 160/大师 240', () => {
    for (const [diff, want] of [[GDL.CLASSIC, 80], [GDL.EXPERT, 160], [GDL.MASTER, 240]] as const) {
      const h = makeHooks(makeWorld(0), { x: 5, y: 5 });
      const e = spawn(h, 572, 100, FLOOR - 3);
      e.difficulty = diff;
      tick(h, 1, [e]);                         // 先过 bInit（首拍重置 ai 槽）
      e.ai1 = 2;                               // 直接进起爆态（192² 盒改写段）
      tick(h, 1, [e]);
      expect(e.w).toBe(192);
      expect(e.def.damage).toBe(want);         // ★M2：钉死 80 →专家/大师腿红
    }
  });

  it('滑翔型 574 同式（NPC.cs:66491）：大师 240', () => {
    const h = makeHooks(makeWorld(0), { x: 5, y: 5 });
    const e = spawn(h, 574, 100, FLOOR - 6);
    e.difficulty = GDL.MASTER;
    tick(h, 1, [e]);                           // 先过 bInit（divingFlyerAI 首拍重置 ai0）
    e.ai0 = 3;                                 // 自爆态
    tick(h, 1, [e]);
    expect(e.w).toBe(192);
    expect(e.def.damage).toBe(240);
  });

  it('字面锁：两站均走单源（摘除 →红）', () => {
    expect(SRC_DD2).toContain('getAttackDamageScaledByDifficulty(80, e.difficulty)');
    expect(SRC_DD2.match(/getAttackDamageScaledByDifficulty\(80, e\.difficulty\)/g)?.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe('件3：枯萎兽削甲圈（NPC.cs:64110 欧氏圆形 < 400）', () => {
  const probe = (dx: number, dy: number): number => {
    const h = makeHooks(makeWorld(0), { x: 5, y: 5 });
    const e = spawn(h, 568, 100, FLOOR - 3);
    tick(h, 1, [e]);                           // 先过 bInit（首拍重置 ai 槽）
    dd2LocalAI(e)[3] = 60;
    e.ai0 = 1;                                 // 灵气态（1↔2 振荡驻留）
    // 玩家中心 = 怪中心 + (dx,dy)
    h.player.x = e.cx + dx - 10; h.player.y = e.cy + dy - 21;
    h.player.cx = e.cx + dx; h.player.cy = e.cy + dy;
    tick(h, 1, [e]);
    return h.buffApplies.filter((b) => b.type === 101).length;   // BuffType.WitheredArmor
  };
  it('圈内/圈界/对角（旧方形对角多吃 41% 半径 →红）', () => {
    expect(probe(0, 399)).toBe(1);             // 圆内（距 399 < 400）
    expect(probe(399, 0)).toBe(1);             // 圆内
    expect(probe(280, 280)).toBe(1);           // 圆内（距≈395.98;旧方形也命中=对照件）
    expect(probe(400, 0)).toBe(0);             // 原版严格 <（恰 400 不吃）
    expect(probe(0, 400)).toBe(0);
    expect(probe(400, 293)).toBe(0);           // ★M3：距≈495.7——旧方形（|Δx|≤400∧|Δy|≤400）误削甲 →红
    expect(probe(283, 283)).toBe(0);           // 距≈400.0（280√2=395.98 内,283√2≈400.2 外）
  });
  it('字面锁：圆形谓词在位（摘除回方形 →红）', () => {
    expect(SRC_DD2).toContain('Math.hypot(pl.cx - e.cx, pl.cy - e.cy) < 400');
  });
});

// ---------------------------------------------------------------------------
describe('件4：681 炸弹 / 683 跺地波 DamageVar ±15%（Projectile.cs:14904 链首）', () => {
  const boomDamage = (rand: () => number, cls: 'bomb' | 'smash'): number => {
    const w = makeWorld(2);                    // 大师世界（乘区轴）
    const h = makeHooks(w, { x: 5, y: 5 });
    const spy = vi.spyOn(Math, 'random').mockImplementation(rand);
    try {
      let ent: DD2GoblinBomb | DD2OgreSmash;
      if (cls === 'bomb') {
        ent = new DD2GoblinBomb(1600, 1700, 0, 0, 40);
        (ent as unknown as { fuse: number }).fuse = 3;   // 下拍爆（--fuse=2 → explode）
        h.player.x = ent.cx - 10; h.player.y = ent.cy - 21;   // 中心重叠 80² 爆盒
      } else {
        ent = new DD2OgreSmash(1600, 1700, 40);
        h.player.x = ent.cx - 10; h.player.y = ent.cy - 21;
      }
      ent.fixedUpdate(1 / 60, h.hooks);
      return h.damageCalls[0] ?? -1;
    } finally {
      spy.mockRestore();
    }
  };
  it('681：damageVar 掷档进 evpDirectDmg（大师 ×3×2）——rand=0 档 −15% / rand≈1 档 +15%', () => {
    // tier = floor(r*31)−15：r=0 → −15（×0.85）;r=0.99 → +15（×1.15）
    expect(boomDamage(() => 0, 'bomb')).toBe(Math.trunc(40 * 0.85) * 3 * 2);        // 34→204
    expect(boomDamage(() => 0.99, 'bomb')).toBe(Math.trunc(40 * 1.15) * 3 * 2);     // 46→276
    // ★M4：摘 DamageVar →恒 40×6=240,两腿全红
  });
  it('683：跺地波同链（Damage() 同函数,DamageVar 先于 banner/缩放/×2）', () => {
    expect(boomDamage(() => 0, 'smash')).toBe(Math.trunc(40 * 0.85) * 3 * 2);       // 204
    expect(boomDamage(() => 0.99, 'smash')).toBe(Math.trunc(40 * 1.15) * 3 * 2);    // 276
  });
  it('字面锁：两站掷点在位（摘除 →红）', () => {
    expect(SRC_DD2).toContain('damageVar(this.damage, -pl.luck)');
    expect(SRC_DD2).toContain('damageVar(this.dmg, -pl.luck)');
  });
});

// ---------------------------------------------------------------------------
describe('件5：南瓜月/霜月三弹幕站旗链核验（转报疑漏 → 销案:均已在列）', () => {
  it('三站源 NPC 均带旗（npcToBanner:315→120 / 347→110 / 350→109）', () => {
    expect(bannerOfNpc(315)).toBe(120);
    expect(bannerOfNpc(347)).toBe(110);
    expect(bannerOfNpc(350)).toBe(109);
  });

  it('315 无头骑士 1001 南瓜弹：Enemy.ts shoot 站旗冻结在位（G35 D1 shoot 3 站之一）', () => {
    expect(SRC_ENEMY).toContain('315 无头骑士（banner 120）发射者旗冻结');
    const idx = SRC_ENEMY.indexOf('getAttackDamageForProjectiles(40, 30, this.difficulty), 1001, 360');
    expect(idx).toBeGreaterThan(-1);
    const tail = SRC_ENEMY.slice(idx, idx + 400);
    expect(tail).toContain('bannerNpcId: bannerNpcKeyOf(this)');
  });

  it('347 精灵直升机 180 子弹：moon_events shootE 旗冻结在位', () => {
    expect(SRC_MOON).toContain('347 ElfCopter（banner 110）发射者旗冻结');
    const idx = SRC_MOON.indexOf('shootE(game, ox, oy, sx, sy, 32, 180');
    expect(idx).toBeGreaterThan(-1);
    expect(SRC_MOON.slice(idx, idx + 220)).toContain('bannerNpcId: bannerNpcKeyOf(e)');
  });

  it('350 精灵弓手 82 燃烧箭：RANGED_TABLE 通用支经 spawnHostileProj 自动冻结', () => {
    // 弹型=82 FlamingArrow（原版 AI_003 射表）+ 通用支出口
    expect(SRC_ENEMY).toContain('350: { cooldown: 110, speed: 11, dmg: 45, range: 700, drop: 0.1, proj: 82 }');
    expect(SRC_ENEMY).toContain('this.spawnHostileProj(game, ox2, oy2, vx, vy, dmgF, proj);');
    // spawnHostileProj 内冻结（Enemy.ts:4011——摘除 →此腿红）
    const idx = SRC_ENEMY.indexOf('dart.bannerNpcId = bannerNpcKeyOf(this)');
    expect(idx).toBeGreaterThan(-1);
    // 行为面：350 实例经 spawnHostileProj 出膛冻结 350（banner 消费键域）
    const h = makeHooks(makeWorld(0), { x: 5, y: 5 });
    const e = spawn(h, 350, 100, FLOOR - 3);
    e.spawnHostileProj(h.hooks, 0, 0, 1, 0, 45, 82);
    const dart = h.projectiles[0] as { bannerNpcId?: number };
    expect(dart?.bannerNpcId).toBe(350);
  });
});

// ---------------------------------------------------------------------------
describe('件6：转报已修面锁在位复核（G35 D3 / BJ710-C 数值吻合闭环）', () => {
  it('接触旗减伤 DD2 档（G35 D3）:100→91/83/83（转报应有值逐值吻合）', () => {
    const dd2Item = bannerItemId(bannerOfNpc(556));        // DD2 哥布林旗（3837-3846 域）
    expect(dd2Item).toBeGreaterThanOrEqual(3837);
    expect(dd2Item).toBeLessThanOrEqual(3846);
    // ★BJ716-A（R15-P2-4）改判史:签名 expert:boolean → difficulty:GDL 浮点轴
    //（旅程滑杆曲线式）;1=Classic/2=Expert 整数端点值与旧布尔档逐位相同
    expect(bannerReceivedMult(1, dd2Item)).toBe(0.917);
    expect(bannerReceivedMult(2, dd2Item)).toBe(0.833);
    // 转报「75/50/50→应 91/83/83」（普通档旧误用面 →DD2 档修正后）
    expect(Math.trunc(100 * bannerReceivedMult(1, dd2Item))).toBe(91);
    expect(Math.trunc(100 * bannerReceivedMult(2, dd2Item))).toBe(83);
    // 普通旗对照（旧转报值 75/50 = 普通档,本就正确）
    expect(Math.trunc(100 * bannerReceivedMult(1, 0))).toBe(75);
    expect(Math.trunc(100 * bannerReceivedMult(2, 0))).toBe(50);
    // ★BJ716-A 曲线式:旅程滑杆分数难度 (1,2) 连续插值 + 双端钳界（大师 3 同专家档）
    expect(bannerReceivedMult(1.5, 0)).toBeCloseTo(0.625, 10);
    expect(bannerReceivedMult(1.5, dd2Item)).toBeCloseTo(0.875, 10);
    expect(bannerReceivedMult(0.5, 0)).toBe(0.75);        // 旅程 0.5 ≤ 首键 → 钳首键
    expect(bannerReceivedMult(3, 0)).toBe(0.5);           // 大师 3 ≥ 尾键 → 钳尾键
    expect(bannerReceivedMult(3, dd2Item)).toBe(0.833);
  });

  it('弹幕旗链（BJ710-C）:hitPlayer 门序 DamageVar→banner→缩放→×2 在位', () => {
    expect(SRC_PROJT).toContain('if (!pvp) dmg = damageVar(dmg, -p.luck);');
    expect(SRC_PROJT).toContain('dmg = applyBannerDamageReceivedOnProj(game, dmg, (self as { bannerNpcId?: number | null }).bannerNpcId);');
    expect(SRC_PROJT).toContain(': hostileProjectileDamage(dmg, mainDifficulty(game.world))) * 2;');
    // 单源 evpDirectDmg（banner→缩放→×2）在位
    expect(SRC_PROJT).toContain('export function evpDirectDmg(');
  });
});
