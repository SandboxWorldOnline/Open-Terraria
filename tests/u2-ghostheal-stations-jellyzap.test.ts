// ★清偿刀 U2（2026-10-01）判别测试——ghostHeal 白耗面缺站残差（T2 登记债家族级兑现）
//   + WeaponProj.hitEnemies 水母块（长矛×充能水母漏电）。
//  定谳锚（Terarria1457/Terraria/Projectile.cs 亲读）：
//   债A（缺站白耗面）:13712 flag10 = num41>0 ∧ lifeMax>5 ∧ friendly ∧ !hostile ∧
//      aiStyle≠59——【无伤害类别门】;:13877-79 ghostHeal 调用点在 Damage() 通用
//      on-hit 段（本仓三站缺挂）：①meleeOnHitProjs 524/977 + VolcanoBlastProj 978
//      （S2/R1-B 台账「白耗面=家族级债」兑现）;②WeaponProj.hitEnemies 共享环（旧档
//      仅 239/245 onAccepted 内嵌=回旋镖/长矛/悠悠球/连枷/破晓/水晶蛇全缺,本刀上收
//      受理位单源）;③Arrow nail93 支 514（刺入首击走命中专管,主环白耗臂不可达）。
//      非 magic 弹 → isMagic=false 直传：:12090 `lifeSteal -= num2` 先于 :12091-93
//      `if (!magic) return` ⇒ 白扣治疗预算不出治疗球=原版本相;ghostHurt 不接=非
//      magic 死码（:12022 早退,S2/R1-B 定谳保形）。
//   债B（水母漏电）:12600 外环门 `!nPC.dontTakeDamage || ZappingJellyfish[nPC.type]`
//      （充能水母不整跳）+ :12680-12689 水母块：接触族（aiStyle 19/161/75/140 ||
//      AllowsContactDamageFromJellyfish{972,982,984,997,1043}）×充能态（dontTakeDamage）
//      → TakeDamageFromJellyfish 电玩家（Player.cs:44607,1.3×）→ :12686 return 拦伤害
//      （写梯 :14031-14183 不达=免疫账零落账）。旧档 hitEnemies 头 dontTakeDamage 整跳
//      =长矛（105/46/153 aiStyle 19）×充能水母不伤面恰同态、仅电击缺。
import { describe, it, expect, vi } from 'vitest';   // ★BJ731:vi=DV 恒等档 mock
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { hitEnemies, HitCooldown } from '../src/entities/WeaponProj';
import { BladetongueGlobProj, MuramasaSlashProj } from '../src/entities/meleeOnHitProjs';
import { VolcanoBlastProj } from '../src/entities/VolcanoBlastProj';
import { Arrow } from '../src/entities/Arrow';
import type { GameHooks } from '../src/entities/types';
import { projectileData as projData } from '../src/data/vanillaProjectiles';

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}

const TILE = 16;
const DEFENSE = 22;

/** 敌怪 spy：镜像 Enemy.hurt 三早退的受理形态（有伤实扣+iframes 10t） */
function enemySpy(id: number, x: number, y: number, w = 24, h = 24,
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

function makeGame(log: StealCall[], enemies: unknown[], zaps: unknown[] = [],
  world?: World, px = 30 * 16, py = 10 * 16): GameHooks {
  return {
    world: world ?? new World(64, 32, 42, 'u2-stations'),
    player: new Player(px, py, new Inventory()),
    enemies: () => enemies, critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, spawnParticles: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    playSfx: () => {}, playSfxFiles: () => {}, onEnemyKilled: () => {},
    entities: { add: () => {}, nextId: 1 },
    tickCount: 0,
    takeDamageFromJellyfish: (e: unknown) => { zaps.push(e); },
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
}

// ═══════════ §A 债A-②：hitEnemies 共享环白耗臂上收（直呼判别面） ═══════════

describe('U2-§A：hitEnemies 受理位 ghostHeal 单源（长矛 105 数据面 melee）', () => {
  function spearSelf(x: number, y: number): Parameters<typeof hitEnemies>[0] {
    return { x, y, w: 16, h: 16, vx: 6, damage: 60, knockback: 2, projId: 105 };
  }

  it('首跳 proc：isMagic=false（白耗面）/numHits=0/dmg=防后实扣/出生点=受害者 Center', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 400, 250);
    const game = makeGame(log, [e]);
    // ★BJ731 改判史（2026-10-27）：hitEnemies 结算掷 :12970 DV（BJ723-B W01
    //   落地面）——ghostHeal num41=防后实扣随 DV 漂。0.5 恒等档钉 60−def。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      hitEnemies(spearSelf(390, 254), game, new HitCooldown(), 10, 1);
    } finally { rvi731.mockRestore(); }
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);       // ← 旧档共享环整缺=零 proc（变异红）
    expect(log[0].dmg).toBe(60 - DEFENSE);    // num41 等位（Enemy.lastStrikeDealt）
    expect(log[0].numHits).toBe(0);           // :14263 自增在 proc 后
    expect(log[0].x).toBe(400 + 12);          // 受害者 Center（:13879）
    expect(log[0].y).toBe(250 + 12);
  });

  it('numHits 递增：二跳读自增前值 1（率衰减 0.20→0.15 计数源）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(2, 400, 250);
    const game = makeGame(log, [e]);
    const hc = new HitCooldown();
    const self = spearSelf(390, 254);
    hitEnemies(self, game, hc, 10, 1);
    for (let i = 0; i < 10; i++) hc.tick();   // 冷却行耗尽
    (e as { iframes: number }).iframes = 0;
    hitEnemies(self, game, hc, 10, 1);
    expect(e.attempts).toBe(2);
    expect(log.length).toBe(2);
    expect(log[1].numHits).toBe(1);           // ← 旧档无计数源=恒 0（变异红）
    expect((self as { pveNumHits?: number }).pveNumHits).toBe(2);   // :14263 受理后自增
  });

  it('门拒（iframes 残窗）零 proc 零计数（:12634-12637 整跳,BJ388/393 判据保形）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(3, 400, 250);
    (e as { iframes: number }).iframes = 10;
    const game = makeGame(log, [e]);
    const self = spearSelf(390, 254);
    hitEnemies(self, game, new HitCooldown(), 10, 1);
    expect(e.attempts).toBe(0);
    expect(log.length).toBe(0);
    expect((self as { pveNumHits?: number }).pveNumHits).toBeUndefined();
  });
});

// ═══════════ §B 债B：hitEnemies 水母块（外环豁免+接触反噬+零落账） ═══════════

describe('U2-§B：hitEnemies 充能水母面（:12600 外环豁免+:12680-12689 水母块）', () => {
  const HC = 10;

  it('1127（aiStyle 161 接触族）×充能水母：电玩家+零伤害+白写 cd 消失'
    + '——解冻后立即命中（旧档整跳=漏电,变异红）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const j = enemySpy(11, 400, 100, 240, 240, 63);   // BlueJellyfish 240 盒
    j.dontTakeDamage = true;                           // AI_018 充能态
    const game = makeGame(log, [j], zaps);
    const hc = new HitCooldown();
    const self = { x: 400, y: 200, w: 16, h: 16, vx: 0, damage: 60, knockback: 2, projId: 1127 };
    hitEnemies(self, game, hc, HC, 1);
    expect(zaps.length).toBeGreaterThanOrEqual(1);     // ← 旧档恒 0（漏电,判别位）
    expect(j.attempts).toBe(0);                        // 反噬≠普通命中
    expect(log.length).toBe(0);                        // :12686 return 前=零 proc 零计数
    j.dontTakeDamage = false;                          // 解冻
    hitEnemies(self, game, hc, HC, 1);
    expect(j.attempts).toBe(1);                        // ← 旧档 ready 融合白写=漏 10t（判别位）
    expect(log.length).toBe(1);                        // 解冻拍普通受理+白耗臂照达
    expect(log[0].isMagic).toBe(false);
  });

  it('非接触族（287 aiStyle 1）×充能水母：不电不伤零 proc（:12682 接触族专属）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const j = enemySpy(12, 400, 100, 240, 240, 63);
    j.dontTakeDamage = true;
    const game = makeGame(log, [j], zaps);
    const self = { x: 400, y: 200, w: 16, h: 16, vx: 0, damage: 60, knockback: 2, projId: 287 };
    hitEnemies(self, game, new HitCooldown(), HC, 1);
    expect(zaps.length).toBe(0);
    expect(j.attempts).toBe(0);
    expect(log.length).toBe(0);
  });

  it('非充能水母：不电、普通命中、白耗臂照达（:12683 二次拦截=充能态专属）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const j = enemySpy(13, 400, 100, 240, 240, 63);    // 潜伏期 dontTakeDamage=false
    const game = makeGame(log, [j], zaps);
    const self = { x: 400, y: 200, w: 16, h: 16, vx: 0, damage: 60, knockback: 2, projId: 1127 };
    hitEnemies(self, game, new HitCooldown(), HC, 1);
    expect(zaps.length).toBe(0);
    expect(j.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].isMagic).toBe(false);
  });

  it('非水母 dontTakeDamage 靶照旧整跳（外环 :12600 无豁免面保形）', () => {
    const log: StealCall[] = [];
    const zaps: unknown[] = [];
    const e = enemySpy(14, 400, 250);                  // vanillaId 15 非水母
    e.dontTakeDamage = true;
    const game = makeGame(log, [e], zaps);
    const self = { x: 390, y: 254, w: 16, h: 16, vx: 0, damage: 60, knockback: 2, projId: 1127 };
    hitEnemies(self, game, new HitCooldown(), HC, 1);
    expect(zaps.length).toBe(0);
    expect(e.attempts).toBe(0);
    expect(log.length).toBe(0);
  });
});

// ═══════════ §C 债A-①：meleeOnHitProjs 524/977 + VolcanoBlastProj 978 白耗面 ═══════════

describe('U2-§C：近战 on-hit 弹族受理支 proc（S2/R1-B 台账兑现）', () => {
  it('524 血舌球：首跳 isMagic=false/numHits=0;IDStatic 窗过期二跳 numHits=1', () => {
    const log: StealCall[] = [];
    const e = enemySpy(52401, 400, 100, 240, 240);     // 大盒=重力坠落不脱靶
    const game = makeGame(log, [e]);
    const g = new BladetongueGlobProj(408, 200, 0, 0, 130, 2);
    g.critChanceFn = () => 0;
    g.fixedUpdate(1 / 60, game);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);                // ← 旧档不接=零 proc（变异红）
    // DamageVar ±15% 掷（F9 单源,银行家舍入）→ 防后实扣落 [88,128]（截断式 149 上限会漏顶格掷）
    expect(log[0].dmg).toBeGreaterThanOrEqual(88);    // toEvenRound(110.5)−22
    expect(log[0].dmg).toBeLessThanOrEqual(128);      // toEvenRound(149.5)=150 偶档−22
    expect(log[0].numHits).toBe(0);
    (game as unknown as { tickCount: number }).tickCount = 11;   // IDStatic 10t 窗过期
    (e as { iframes: number }).iframes = 0;
    g.fixedUpdate(1 / 60, game);
    expect(e.attempts).toBe(2);
    expect(log[1].numHits).toBe(1);                    // :14263 计数源（penetrate=5 衰减）
  });

  it('977 村正斩月光波：单受理 isMagic=false/numHits=0（penetrate=1）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(97701, 400, 250);
    const game = makeGame(log, [e]);
    const m = new MuramasaSlashProj(400, 250, 6, 0, 130, 0, 0);
    m.critChanceFn = () => 0;
    m.fixedUpdate(1 / 60, game);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);                // ← 旧档不接=零 proc（变异红）
    expect(log[0].dmg).toBeGreaterThanOrEqual(88);    // toEvenRound(110.5)−22
    expect(log[0].dmg).toBeLessThanOrEqual(128);      // toEvenRound(149.5)=150 偶档−22
    expect(log[0].numHits).toBe(0);
  });

  it('978 火山大剑爆焰：isMagic=false/numHits=0（usesLocal 每敌一次）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(97801, 400, 250);
    // 978 SetDefaults ownerHitCheck=true（:9264）→ LOS 门须玩家贴敌（测试世界有地形）
    const game = makeGame(log, [e], [], undefined, 404, 256);
    const v = new VolcanoBlastProj(408, 258, 0, 0, 130, 2, 1);
    v.critChanceFn = () => 0;
    v.fixedUpdate(1 / 60, game);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);                // ← 旧档不接=零 proc（变异红）
    expect(log[0].dmg).toBeGreaterThanOrEqual(88);    // toEvenRound(110.5)−22
    expect(log[0].dmg).toBeLessThanOrEqual(128);      // toEvenRound(149.5)=150 偶档−22
    expect(log[0].numHits).toBe(0);
  });
});

// ═══════════ §D 债A-③：Arrow nail93 支（514 钉刺入首击）白耗面 ═══════════

describe('U2-§D：Arrow 514 命中专管 proc（主环白耗臂不可达站）', () => {
  it('钉飞行态首击 → proc isMagic=false/numHits=0/防后实扣', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 480, 256);
    const game = makeGame(log, [e]);
    const a = new Arrow(450, 264, 6, 0, 60, 0, 514, { grav: 0, life: 300 });
    for (let i = 0; i < 40 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(e.attempts).toBe(1);                        // 刺入首击（专管支,单次）
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);                // ← 旧档专管支不挂=零 proc（变异红）
    expect(log[0].dmg).toBe(60 - DEFENSE);
    expect(log[0].numHits).toBe(0);
    expect(a.pveNumHits).toBe(1);                      // :14263 受理后自增
  });
});

// ═══════════ §E 数据面哨（vanilla-projectiles.json 回归锁） ═══════════

describe('U2-§E：涉弹类别锚（magic 位分流/接触族成员）', () => {
  it('524/977/978/514/105/1127 数据面非 magic（白耗面判据前提）', () => {
    for (const id of [524, 977, 978, 514, 105, 1127]) {
      expect(projData(id)?.magic).toBeFalsy();
    }
    expect(projData(105)?.aiStyle).toBe(19);           // 长矛=接触族成员
    expect(projData(1127)?.aiStyle).toBe(161);
    expect(projData(287)?.aiStyle).toBe(1);            // 非接触族对照
  });
});
