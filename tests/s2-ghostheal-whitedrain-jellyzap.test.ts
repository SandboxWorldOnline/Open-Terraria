// ★清偿刀 S2-债1+债2（2026-10-01）判别测试——ghostHeal 白耗预算面家族级 +
// Arrow 主环 502/局部免疫支水母外环门+接触反噬电击块。
//  定谳锚（Terarria1457/Terraria 亲读,R1-B 存档 meleeOnHitProjs.ts:552-570 台账兑现）：
//   债1 Projectile.cs:12090 `lifeSteal -= num2` 在 :12091-93 `if (!magic) return`
//      【之前】,调用点 :13877-79 无类别门 ⇒ 非 magic PVE 命中+幽灵兜帽在身 →
//      【白扣治疗预算不出治疗球】=原版本相。旧档 magic 预门（SpectreSoulProj:137
//      BJ382 习语）把白耗整面挡死=本仓建模差（非同相）,本刀摘门+isMagic 忠实直传。
//   债2 Damage_PVE_Inner :12676-12689 水母块：充能水母（dontTakeDamage,Zapping
//      Jellyfish={63,64,103,242}）重叠拍 → 接触族弹（aiStyle 19/161/75/140/IsAWhip/
//      Allows={972,982,984,997,1043}）电玩家（TakeDamageFromJellyfish=1.3×）→
//      `if (dontTakeDamage) return` 拦伤害且【写梯 :14031-14183 不达=免疫账不落】。
//      Arrow else 支/WhipProj tryHit/dealContacts 已接（「最终清零补」,R1-C 登记过时）,
//      本刀补 Arrow 502 支/局部免疫支（接触族成员 611/697/707 曾漏电+白写 cd）。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Arrow } from '../src/entities/Arrow';
import type { GameHooks } from '../src/entities/types';
import { ghostHealProc } from '../src/entities/SpectreSoulProj';
import { projectileData as projData } from '../src/data/vanillaProjectiles';
import projJson from '../src/data/vanilla-projectiles.json';

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}

const DEFENSE = 22;

/** 敌怪 spy：镜像 Enemy.hurt 三早退（dead/iframes/dontTakeDamage :13971-13978）——
 *  充能水母 hurt 返假不入 attempts（旧档局部支白写 cd 仍调 hurt,判别面在此）。 */
function enemySpy(id: number, x: number, y: number, w = 16, h = 16,
  vanillaId: number | null = 15) {
  return {
    id, x, y, w, h, dead: false, vanillaId, maxHp: 100,
    lastStrikeDealt: 0, iframes: 0, dontTakeDamage: false, attempts: 0,
    hurt(this: { lastStrikeDealt: number; iframes: number; dontTakeDamage: boolean;
      attempts: number }, dmg: number): boolean {
      if (this.iframes > 0 || this.dontTakeDamage) return false;
      this.attempts++;
      this.lastStrikeDealt = Math.max(0, dmg - DEFENSE);
      this.iframes = 10;
      return true;
    },
  };
}

function makeGame(log: StealCall[], enemies: unknown[], zaps: unknown[],
  world?: World): GameHooks {
  return {
    world: world ?? new World(64, 32, 42, 's2-wd'),
    player: new Player(30 * 16, 10 * 16, new Inventory()),
    enemies: () => enemies, critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, spawnParticles: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    playSfxFiles: () => {}, onEnemyKilled: () => {},
    entities: { add: () => {}, nextId: 1 },
    takeDamageFromJellyfish: (e: unknown) => { zaps.push(e); },
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
}

// ═══════════ §A 债1：ghostHealProc 白耗面单源（桩级） ═══════════

describe('S2-债1-§A：ghostHealProc 摘 magic 预门（白耗=原版本相）', () => {
  function victim(lastStrikeDealt = 50, vanillaId: number | null = 15,
    maxHp = 100): Parameters<typeof ghostHealProc>[3] {
    return { x: 0, y: 0, w: 24, h: 24, vanillaId, lastStrikeDealt, maxHp };
  }
  function hooksWith(log: StealCall[]): GameHooks {
    return makeGame(log, [], []) as GameHooks;
  }

  it('非 magic 弹（524 melee）→ applyLifeSteal isMagic=false 直传（白耗面活）', () => {
    const log: StealCall[] = [];
    ghostHealProc(hooksWith(log), 524, 0, victim());
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);       // 真扣不回复由 applyLifeSteal 承载
    expect(log[0].dmg).toBe(50);              // num41 等位
    expect(log[0].numHits).toBe(0);
    expect(log[0].x).toBe(12); expect(log[0].y).toBe(12);   // 受害者 Center
  });

  it('magic 弹（255 磁球激光）→ isMagic=true（治疗面不回归）', () => {
    const log: StealCall[] = [];
    ghostHealProc(hooksWith(log), 255, 0, victim());
    expect(log.length).toBe(1);
    expect(log[0].isMagic).toBe(true);
  });

  it('flag10 !hostile 段：1091 雷暴闪电（hostile=true,站唯一非 magic 成员）零行为', () => {
    const log: StealCall[] = [];
    ghostHealProc(hooksWith(log), 1091, 0, victim());
    expect(log.length).toBe(0);               // bj383 1091 锁同面（门位改,行为保形）
  });

  it('flag10 aiStyle≠59 段：356 浮魂弹自身零行为（防自噬,防御位）', () => {
    const log: StealCall[] = [];
    expect(projData(356)?.aiStyle).toBe(59);  // 数据面前置自证
    ghostHealProc(hooksWith(log), 356, 0, victim());
    expect(log.length).toBe(0);
  });

  it('既有门不回归：victim canGhostHeal=false 族（384）/ critter lifeMax≤5 零行为', () => {
    const log: StealCall[] = [];
    const h = hooksWith(log);
    ghostHealProc(h, 255, 0, victim(50, 384));    // spectreVictimEligible
    ghostHealProc(h, 255, 0, victim(50, 15, 5));  // vanillaFlag10LifeMaxOk
    expect(log.length).toBe(0);
  });

  it('数据面前置自证：本测涉弹 magic/hostile 位与 vanilla-projectiles.json 同相', () => {
    expect(projData(524)?.magic).toBeFalsy();
    expect(projData(255)?.magic).toBe(true);
    expect(projData(1091)?.hostile).toBe(true);
    expect(projData(1117)?.hostile).toBeFalsy();
  });
});

// ═══════════ §B 债1：Arrow 主环白耗面（实弹 harness） ═══════════

describe('S2-债1-§B：Arrow 通用环非 magic 白耗臂（旧档 magic 门挡死）', () => {
  it('木箭（pid 1,数据面非 magic）命中 → ghost proc isMagic=false/numHits=0/dmg=防后实扣', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（主环首掷 ×1.0）
    const log: StealCall[] = [];
    const e = enemySpy(1, 480, 256);
    const game = makeGame(log, [e], []);
    const a = new Arrow(450, 264, 6, 0, 60, 0, 1, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 40 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);       // ← 旧档本臂不存在=零 proc（变异红）
    expect(log[0].dmg).toBe(60 - DEFENSE);    // num41 防后实扣
    expect(log[0].numHits).toBe(0);           // 自增前受理数（:14263 位 ++ 在后）
    expect(log[0].x).toBe(488);               // 受害者 Center（:13879）
  });
});

// ═══════════ §C 债2：Arrow 502/局部免疫支水母块（实弹 harness） ═══════════

describe('S2-债2-§C：Arrow 502/局部免疫支水母外环门+接触反噬', () => {
  it('502 喵刀弹（aiStyle 8 非接触族）×充能水母：不电不伤且【白写 cd 消失】'
    + '——解冻后立即命中（旧档 meowHitCd 白写=10t 漏命中,变异红）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const j = enemySpy(7, 480, 144, 240, 240, 63);   // BlueJellyfish 240 盒
    j.dontTakeDamage = true;                          // AI_018 充能态
    const game = makeGame(log, [j], zaps);
    const a = new Arrow(j.x - 10, 264, 6, 0, 60, 0, 502, { grav: 0, life: 300 });
    for (let i = 0; i < 2 && !a.dead; i++) a.fixedUpdate(1 / 60, game);   // 充能拍重叠
    expect(zaps.length).toBe(0);                      // 非接触族不电
    expect(j.attempts).toBe(0);                       // 充能态零伤
    j.dontTakeDamage = false;                         // 解冻
    for (let i = 0; i < 2 && !a.dead; i++) a.fixedUpdate(1 / 60, game);   // 解冻后 2 拍
    expect(j.attempts).toBe(1);                       // ← 旧档 cd 白写=恒 0（判别位）
    expect(zaps.length).toBe(0);
  });

  it('611（aiStyle 75 接触族,localNPCHitCooldown=6）×充能水母：照电玩家'
    + ' + 零伤害 + 解冻后立即命中（旧档漏电+localImmuneCd 白写,双变异红）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const j = enemySpy(8, 480, 144, 240, 240, 63);
    j.dontTakeDamage = true;
    const game = makeGame(log, [j], zaps);
    const a = new Arrow(j.x - 10, 264, 6, 0, 60, 0, 611, { grav: 0, life: 300 });
    for (let i = 0; i < 2 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(zaps.length).toBeGreaterThanOrEqual(1);    // ← 旧档恒 0（漏电,判别位）
    expect(j.attempts).toBe(0);                       // 反噬≠普通命中
    expect(log.length).toBe(0);                       // 充能拍不白耗（vanillaGated 同面）
    j.dontTakeDamage = false;
    for (let i = 0; i < 2 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(j.attempts).toBe(1);                       // ← 旧档 cd 白写(6t)=恒 0（判别位）
  });

  it('611 ×非充能水母：不电、普通命中（:12682 dontTakeDamage 臂=充能态专属）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const j = enemySpy(9, 480, 144, 240, 240, 63);    // 潜伏期 dontTakeDamage=false
    const game = makeGame(log, [j], zaps);
    const a = new Arrow(j.x - 10, 264, 6, 0, 60, 0, 611, { grav: 0, life: 300 });
    for (let i = 0; i < 6 && !a.dead && j.attempts === 0; i++) a.fixedUpdate(1 / 60, game);
    expect(j.attempts).toBe(1);
    expect(zaps.length).toBe(0);
    expect(log.length).toBe(1);                       // 白耗臂照达（611 数据面非 magic）
    expect(log[0].isMagic).toBe(false);
  });

  it('非接触非 magic 弹（pid 1）×充能水母：不电不伤、白耗臂不达（else 支既有水母块）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const j = enemySpy(10, 480, 144, 240, 240, 63);
    j.dontTakeDamage = true;
    const game = makeGame(log, [j], zaps);
    const a = new Arrow(j.x - 10, 264, 6, 0, 60, 0, 1, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 4 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(zaps.length).toBe(0);
    expect(j.attempts).toBe(0);
    expect(log.length).toBe(0);                       // :12686 return 前位=零 proc
  });
});

// ═══════════ §D 数据回归哨 ═══════════

describe('S2-§D：接触族×局部免疫成员盘点（vanilla-projectiles.json 回归哨）', () => {
  it('接触族（aiStyle 19/161/75/140+Allows 表）∩ localNPCHitCooldown>0 = {611,697,707}'
    + '——本刀局部支漏电面的现实成员集,数据面漂移即红', () => {
    const zapAI = new Set([19, 161, 75, 140]);
    const zapID = new Set([972, 982, 984, 997, 1043]);
    const members: number[] = [];
    const all = projJson as unknown as
      Record<string, { aiStyle: number; localNPCHitCooldown?: number }>;
    for (const [id, p] of Object.entries(all)) {
      if ((zapAI.has(p.aiStyle) || zapID.has(Number(id)))
        && (p.localNPCHitCooldown ?? 0) > 0) members.push(Number(id));
    }
    expect(members.sort((a, b) => a - b)).toEqual([611, 697, 707]);
  });
});
