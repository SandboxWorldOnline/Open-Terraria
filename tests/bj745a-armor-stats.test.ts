// ★BJ745-A（2026-11-01,issue#35 盔甲审计——套装/聚合域子集）行为锁。
//   A01：巫师帽 238 魔伤单加 +5%（accfx json 与 IIIII224 显式臂双计 → +10% 病灶）。
//   A02：海龟套 endurance 0.15 入槽键 sb 面（ArmorSetBonuses.cs:160——防后 100 伤应 85）。
//   A07：turtleSet/cactusSet getter 读 GetEffectiveArmor（loadout 收藏共享反伤触发）。
//   A09：卸神圣套当拍清 buff59（Player.cs:25902-25904）。
//   A10：流血/遮挡只清 lifeRegenTime,帕拉钯 +4 flat 与消费环照跑（:19296-99/:19385-87）。
//   A11：ApplyDamageToNPC 路径（adtnOnHit 尾参）OnHit 族豁免 hp>5 门（:20599 无门）。
//   A15：近战弹命中加账 ×3/×2/×1（Projectile.cs:13918-13933）。
//   A19：星旋潜行中上坐骑当拍关开关（:26045-26047）。
//   A21：日曜爆闪 608 AoE——160×160 盒内全敌（无 attacker 也爆）+ (int) 截断基伤。
//   A27：爆炸机关冷却 90/60/30（GetExplosiveTrapCooldown :70453-63）。
//   A28：禁戒沙暴基伤走完整乘区池（:57546 magicDamage+minionDamage−1）。
//   A40：IsRangedSpecialistWeapon 八员并道 'rocket' 桶（:54042 第三支）。
//   A41：空桶收雨 205→206（WorldItem.cs:553-576 门链+掷式）。
//   变异恰红 M 组在同文件尾（withMutation 统一守卫）。A05/A06/A17/A18 归 BJ747-A、
//   A16 换壳 3/0/1 相锁在 aura-beetle-buff（本文件只锁 Hurt 掉球步）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { withMutation } from './mutation-guard';
import { Player } from '../src/entities/Player';
import { Enemy } from '../src/entities/Enemy';
import { Inventory } from '../src/items/Inventory';
import { ItemDrop } from '../src/entities/ItemDrop';
import { World } from '../src/world/World';
import { BuffType } from '../src/stats/Buffs';
import { BeetleMeter } from '../src/player/BeetleMeter';
import { explosiveTrapCooldownOf } from '../src/entities/MinionProj';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { rangedDamageKindOf, IS_RANGED_SPECIALIST_WEAPON } from '../src/data/vanillaItemCombat';
import { registerGlobalHurtBuckets } from '../src/player/HurtCooldownBuckets';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!] ?? -1;
const DT = 1 / 60;

const mkPlayer = () => {
  const p = new Player(60 * 16, 90 * 16, new Inventory());
  p.hp = p.maxHp;
  return p;
};
function equipSet(p: Player, h: number | null, b: number | null, l: number | null): void {
  p.inv.armor[0] = h === null ? null : { id: iid(h), stack: 1 };
  p.inv.armor[1] = b === null ? null : { id: iid(b), stack: 1 };
  p.inv.armor[2] = l === null ? null : { id: iid(l), stack: 1 };
}

// ---- fixedUpdate 桩环境（bj747a 同款：真 World + 地面板） ----
const W = 200, H = 200;
function makeHooks(player: Player): GameHooks {
  const w = new World(W, H, 7, 'bj745a-fixture');
  for (let x = 0; x < W; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  w.lavaLine = 90;
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => [],
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  return hooks;
}

// ===========================================================================
// A01：巫师帽单加
// ===========================================================================
describe('BJ745-A A01 巫师帽魔伤单加', () => {
  it('仅巫师帽 238 → dmgMagic 0.05（双计病灶=0.10;Player.cs:13352-13359 单加）', () => {
    const p = mkPlayer();
    equipSet(p, 238, null, null);
    expect(p.equipStats.dmgMagic).toBeCloseTo(0.05);
    // 面板伤害面：damageMult('magic') = 1.05（变异摘除=回 1.10）
    expect(p.damageMult('magic')).toBeCloseTo(1.05);
  });
  it('巫师帽+紫晶袍 1282 → 套装 critMagic+10 照亮且魔伤仍 0.05（件面/套面分道）', () => {
    const p = mkPlayer();
    equipSet(p, 238, 1282, null);
    expect(p.equipStats.dmgMagic).toBeCloseTo(0.05);
    expect(p.equipStats.critMagic).toBe(10);
    expect(p.equipStats.setBonus?.name).toBe('Wizard');
  });
});

// ===========================================================================
// A02/A07：海龟 endurance + 共享配装 getter
// ===========================================================================
describe('BJ745-A A02 海龟套 15% 减伤', () => {
  it('三件套 → enduranceEq 0.15 + setBonus Turtle（ArmorSetBonuses.cs:159-164）', () => {
    const p = mkPlayer();
    equipSet(p, 1316, 1317, 1318);
    expect(p.equipStats.enduranceEq).toBeCloseTo(0.15);
    expect(p.equipStats.setBonus?.name).toBe('Turtle');
  });
  it('防后输入 100 → 实扣 85（issue#35 A02 验收锚;防御吸收自证法）', () => {
    const p = mkPlayer();
    equipSet(p, 1316, 1317, 1318);
    const defAbs = p.defense * 0.5;              // 经典难度防系数（CLASSIC_SCALE_WORLD）
    expect(p.damagePreview(100 + defAbs)).toBe(85);
    // 控制组：拆一件（套装破）→ 同输入 ×1.0（防后 100——本套防御变化由 defAbs 自证）
    const q = mkPlayer();
    equipSet(q, 1316, 1317, 118);                // 任意非海龟腿破套
    expect(q.equipStats.enduranceEq ?? 0).toBe(0);
    expect(q.damagePreview(100 + q.defense * 0.5)).toBe(100);
  });
});

describe('BJ745-A A07 共享配装 getter 读 GetEffectiveArmor', () => {
  it('空甲槽+loadout0 收藏海龟三件 → turtleSet true + enduranceEq 0.15（QueryContext :20-24）', () => {
    const p = mkPlayer();
    p.inv.loadouts[0].armor[0] = { id: iid(1316), stack: 1, favorited: true };
    p.inv.loadouts[0].armor[1] = { id: iid(1317), stack: 1, favorited: true };
    p.inv.loadouts[0].armor[2] = { id: iid(1318), stack: 1, favorited: true };
    expect(p.inv.getEffectiveArmor(1)?.id).toBe(iid(1317));
    expect(p.turtleSet).toBe(true);
    expect(p.equipStats.enduranceEq).toBeCloseTo(0.15);
  });
  it('仙人掌共享 → cactusSet true;未收藏/当前槽占用双控制 false', () => {
    const p = mkPlayer();
    p.inv.loadouts[0].armor[0] = { id: iid(894), stack: 1, favorited: true };
    p.inv.loadouts[0].armor[1] = { id: iid(895), stack: 1, favorited: true };
    p.inv.loadouts[0].armor[2] = { id: iid(896), stack: 1, favorited: true };
    expect(p.cactusSet).toBe(true);
    // 控制组①：未收藏 → 不共享
    const q = mkPlayer();
    q.inv.loadouts[0].armor[0] = { id: iid(894), stack: 1 };
    q.inv.loadouts[0].armor[1] = { id: iid(895), stack: 1 };
    q.inv.loadouts[0].armor[2] = { id: iid(896), stack: 1 };
    expect(q.cactusSet).toBe(false);
    // 控制组②：当前槽占用 → 裸槽优先
    const r = mkPlayer();
    r.inv.loadouts[0].armor[0] = { id: iid(1316), stack: 1, favorited: true };
    r.inv.loadouts[0].armor[1] = { id: iid(1317), stack: 1, favorited: true };
    r.inv.loadouts[0].armor[2] = { id: iid(1318), stack: 1, favorited: true };
    equipSet(r, 238, null, null);                 // 头槽被巫师帽占
    expect(r.turtleSet).toBe(false);
  });
});

// ===========================================================================
// A09：卸神圣套清 buff59
// ===========================================================================
describe('BJ745-A A09 卸套清幻影闪避', () => {
  it('buff59 在栏+卸套 → fixedUpdate 当拍剥离（:25902-25904）', () => {
    const p = mkPlayer();
    equipSet(p, 553, 551, 552);                   // 神圣近战头+胸+腿
    p.buffs.apply(BuffType.ShadowDodge, 30);
    const hooks = makeHooks(p);
    p.fixedUpdate(DT, hooks);                     // 套在身：不剥
    expect(p.buffs.has(BuffType.ShadowDodge)).toBe(true);
    equipSet(p, null, null, null);                // 卸套
    p.fixedUpdate(DT, hooks);
    expect(p.buffs.has(BuffType.ShadowDodge)).toBe(false);   // 旧=残留可白吃一次闪避
  });
});

// ===========================================================================
// A10：帕拉钯快速再生不受流血/遮挡阻断
// ===========================================================================
describe('BJ745-A A10 帕拉钯快速再生穿流血/遮挡', () => {
  const runTicks = (p: Player, n: number): number => {
    const hooks = makeHooks(p);
    const hp0 = p.hp;
    for (let t = 0; t < n; t++) p.fixedUpdate(DT, hooks);
    return p.hp - hp0;
  };
  it('200/400HP+buff58+流血 61 拍 → 回 2HP（+4 flat/120 单位;旧整块门=0）', () => {
    const p = mkPlayer();
    p.hp = 200; p.baseMaxHp = 400;
    p.buffs.apply(BuffType.RapidHealing, 5);
    p.buffs.apply(BuffType.Bleeding, 60);
    expect(runTicks(p, 61)).toBe(2);
  });
  it('遮挡 163 同相（headcovered→bleed 旗）→ 仍回 2HP', () => {
    const p = mkPlayer();
    p.hp = 200; p.baseMaxHp = 400;
    p.buffs.apply(BuffType.RapidHealing, 5);
    p.buffs.apply(BuffType.Obstructed, 60);
    expect(runTicks(p, 61)).toBe(2);
  });
  it('控制组：无 buff58 流血 61 拍 → 0（自然阶梯被 lifeRegenTime=0 阻断）', () => {
    const p = mkPlayer();
    p.hp = 200; p.baseMaxHp = 400;
    p.buffs.apply(BuffType.Bleeding, 60);
    expect(runTicks(p, 61)).toBe(0);
  });
});

// ===========================================================================
// A11：ApplyDamageToNPC 路径 OnHit 族豁免 hp>5 门
// ===========================================================================
describe('BJ745-A A11 反伤路径低血靶仍触发套装 OnHit', () => {
  afterEach(() => registerGlobalHurtBuckets(null));
  function enemyAndHooks(headVid: number, bodyVid: number, legsVid: number) {
    const e = Enemy.fromVanilla(21, 0, 0)!;       // 绿史莱姆
    e.maxHp = 100000; e.hp = 100000;
    (e.def as { defense?: number }).defense = 0;
    const p = mkPlayer();
    equipSet(p, headVid, bodyVid, legsVid);
    const origApply = p.buffs.apply.bind(p.buffs) as (t: BuffType, s: number) => void;
    const applySpy = vi.spyOn(p.buffs, 'apply').mockImplementation(origApply);
    const w = new World(96, 96, 7, 'bj745a-a11');
    const hooks = {
      world: w, player: p,
      enemies: () => [], critters: () => [], projectiles: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
      cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
      spawnOnHitPetals: (): void => {}, spawnTitaniumShard: (): void => {},
    } as unknown as GameHooks;
    return { e, p, hooks, applySpy };
  }
  it('帕拉钯套+5HP 靶：adtnOnHit=true（ApplyDamageToNPC 面）→ 授 buff58（:20599 无 hp 门）', () => {
    const { e, hooks, applySpy } = enemyAndHooks(1205, 1208, 1209);
    e.hp = 5;
    e.hurt(2, 1, -2, hooks, 0, false, 0, true, 0, 0, 1, true);   // 尾参 adtnOnHit
    expect(applySpy.mock.calls.map((c) => c[0])).toContain(BuffType.RapidHealing);
  });
  it('控制组①：同 5HP 靶、弹幕路径（adtnOnHit=false）→ hp>5 门拒收', () => {
    const { e, hooks, applySpy } = enemyAndHooks(1205, 1208, 1209);
    e.hp = 5;
    e.hurt(2, 1, -2, hooks, 0, false, 0, true, 0, 0, 1, false);
    expect(applySpy.mock.calls.map((c) => c[0])).not.toContain(BuffType.RapidHealing);
  });
  it('控制组②：6HP 靶弹幕路径照触发（life>5 门本体保留）', () => {
    const { e, hooks, applySpy } = enemyAndHooks(1205, 1208, 1209);
    e.hp = 6;
    e.hurt(2, 1, -2, hooks, 0, false, 0, true, 0, 0, 1, false);
    expect(applySpy.mock.calls.map((c) => c[0])).toContain(BuffType.RapidHealing);
  });
});

// ===========================================================================
// A15：近战弹命中加账 ×3/×2/×1
// ===========================================================================
describe('BJ745-A A15 甲虫攻套近战弹加账折算', () => {
  it('registerProjHit：orbs 0/1/2/3 → counter += dmg×3/×2/×1/×1（:13922-30）', () => {
    for (const [orbs, mul] of [[0, 3], [1, 2], [2, 1], [3, 1]] as const) {
      const m = new BeetleMeter();
      m.registerProjHit(180, true, orbs);
      expect(m.stateForTest().counter).toBe(180 * mul);
      expect(m.stateForTest().countdown).toBe(0);
    }
    // 非攻套门
    const m2 = new BeetleMeter();
    m2.registerProjHit(180, false, 0);
    expect(m2.stateForTest().counter).toBe(0);
  });
  it('挥击面 ×1 不折算（:44840-44——registerHit 原语义保留）', () => {
    const m = new BeetleMeter();
    m.registerHit(180, true);
    expect(m.stateForTest().counter).toBe(180);
  });
});

// ===========================================================================
// A16 连带：Hurt 掉球步 buff 栏维护（换壳 3/0/1 主相锁在 aura-beetle-buff）
// ===========================================================================
describe('BJ745-A A16 Hurt 掉球步', () => {
  it('beetleDef+orbs3 受击 → orbs 2 + 壳族档同步 96（:38608-23 全链）', () => {
    const p = mkPlayer();
    equipSet(p, 2199, 2201, 2202);                // Beetle Helmet/Shell/Leggings
    expect(p.equipStats.beetleDef).toBe(true);
    p.beetleOrbs = 3;
    p.hp = p.maxHp;
    p.buffs.apply(BuffType.BeetleEndurance3, 5 / 60);
    const dealt = p.damage(50, p.cx, p.y - 10, false, false, -1);
    expect(dealt).toBeLessThan(50);               // ×(1−0.45) 甲虫减伤
    expect(p.beetleOrbs).toBe(2);
    expect(p.buffs.has(BuffType.BeetleEndurance2)).toBe(true);   // AddBuff(95+orbs-1)
    expect(p.buffs.has(BuffType.BeetleEndurance3)).toBe(false);  // DelBuff 95-97 族
  });
});

// ===========================================================================
// A19：星旋潜行中上坐骑当拍关
// ===========================================================================
describe('BJ745-A A19 骑乘关星旋潜行', () => {
  it('vortexStealthActive=true+mount.active → fixedUpdate 当拍 false（:26045-47）', () => {
    const p = mkPlayer();
    equipSet(p, 2757, 2758, 2759);
    p.vortexStealthActive = true;
    p.stealth = 1;
    p.mount.active = true;
    const hooks = makeHooks(p);
    p.fixedUpdate(DT, hooks);
    expect(p.vortexStealthActive).toBe(false);    // 旧=远程增益+移速惩罚继续生效
    expect(p.stealth).toBeCloseTo(0.96, 10);      // 当拍照旧衰减（:26038-44 在置位前）;次拍回升支 +0.04
    p.fixedUpdate(DT, hooks);
    expect(p.stealth).toBeCloseTo(1, 10);         // 关开关后走 else 回升（:26052-60）
  });
  it('控制组：未骑乘 → 开关保持 true（衰减支照跑）', () => {
    const p = mkPlayer();
    equipSet(p, 2757, 2758, 2759);
    p.vortexStealthActive = true;
    p.stealth = 1;
    const hooks = makeHooks(p);
    p.fixedUpdate(DT, hooks);
    expect(p.vortexStealthActive).toBe(true);
    expect(p.stealth).toBeCloseTo(0.96, 10);      // −0.04/t 衰减
  });
});

// ===========================================================================
// A21：日曜爆闪 AoE（Game.damagePlayer 漏斗壳）
// ===========================================================================
describe('BJ745-A A21 日曜爆闪 608 AoE', () => {
  it('耗盾命中：盒内近靶挨打、160 盒外远靶不挨、无 attacker 也爆、(int) 截断基伤', async () => {
    // ★G40-A D-①：DV 逐靶掷入后,恒等档（rnd=0.5 → tier 0 → ×1.0）钉住截断判据
    //   ——193/208 期望值不变（DV 语义面另在 tests/g40a-solar-flare-dv.test.ts）。
    const rndSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
    const { Game } = await import('../src/core/Game');
    const g = Object.create(Game.prototype) as Record<string, any>;
    const w = new World(96, 96, 7, 'bj745a-a21');
    const p = mkPlayer();
    equipSet(p, 2763, 2764, 2765);                // Solar Flare 三件
    p.solarShields = 3;
    const nearHurt = vi.fn((_d: number, ..._rest: unknown[]): number => 0);
    const farHurt = vi.fn((_d: number, ..._rest: unknown[]): number => 0);
    const near = {
      cx: p.cx + 40, cy: p.cy, x: p.cx + 28, y: p.cy - 21, w: 24, h: 42,
      vanillaId: 3, dead: false, dontTakeDamage: false, iframes: 0,
      def: { damage: 40, name: 'Zombie' }, hurt: nearHurt,
    };
    const far = {                                 // 1000px 远（issue 场景）
      cx: p.cx + 1000, cy: p.cy, x: p.cx + 988, y: p.cy - 21, w: 24, h: 42,
      vanillaId: 3, dead: false, dontTakeDamage: false, iframes: 0,
      def: { damage: 40, name: 'Zombie' }, hurt: farHurt,
    };
    g.player = p; g.world = w;
    g.golfState = { tryGetCameraTrackingPosition: () => null };
    g._bannerNpcs = new Set<number>();
    g.sfx = { play: vi.fn(), playWavFile: vi.fn(), playFiles: vi.fn(() => true) };
    g.remotePlayerProxies = [];
    g.enemies = (): unknown[] => [near, far];
    g.critters = (): unknown[] => [];
    g.addDamageNumber = vi.fn();
    g.spawnParticles = vi.fn();
    g.entities = { add: vi.fn() };
    g.recorder = undefined;
    registerGlobalHurtBuckets(null);
    // 无 attacker 命中（弹族/环境面——旧实现整支不爆）
    const dealt = (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 30, p.cx, p.cy - 10, undefined, true);
    expect(dealt).toBeGreaterThan(0);
    expect(p.solarShields).toBe(2);               // 耗盾一层
    expect(nearHurt.mock.calls.length).toBe(1);   // 盒内近靶（|Δx|=40 < 80+12）
    expect(farHurt.mock.calls.length).toBe(0);    // 远靶不打（旧单点=反被打）
    // 日曜套胸 2764 自带 dmgMelee+0.29 → 150×1.29=193.5 截 193（round=194 判别）
    expect(nearHurt.mock.calls[0][0]).toBe(193);
    // (int) 截断判别二档：全套日曜（套 intact 保盾）+怒气 buff +10% →
    // 150×(1.29+0.10)=208.5 截 208（round=209 判别）
    const p2 = mkPlayer();
    equipSet(p2, 2763, 2764, 2765);
    p2.solarShields = 3;
    p2.buffs.apply(BuffType.Rage, 100);
    g.player = p2;
    nearHurt.mockClear();
    (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 30, p2.cx, p2.cy - 10, undefined, true);
    expect(nearHurt.mock.calls[0][0]).toBe(208);
    } finally {
      rndSpy.mockRestore();
    }
  });
});

// ===========================================================================
// A27：爆炸机关冷却三档
// ===========================================================================
describe('BJ745-A A27 GetExplosiveTrapCooldown 三档', () => {
  it('无套 90 / T2 60 / T3 30（:70453-63;T3 条目同置双旗）', () => {
    const bare = { equipStats: { summonSet: {} } };
    expect(explosiveTrapCooldownOf(bare)).toBe(90);
    const t2 = { equipStats: { summonSet: { huntressT2: true } } };
    expect(explosiveTrapCooldownOf(t2)).toBe(60);
    const t3 = { equipStats: { summonSet: { huntressT3: true, huntressT2: true } } };
    expect(explosiveTrapCooldownOf(t3)).toBe(30);
    // 真实装备路径：T3 女猎手三件 → summonSet.huntressT3 投影
    const p = mkPlayer();
    equipSet(p, 3877, 3878, 3879);
    expect(explosiveTrapCooldownOf(p)).toBe(30);
  });
});

// ===========================================================================
// A28：禁戒沙暴基伤完整乘区池
// ===========================================================================
describe('BJ745-A A28 禁戒沙暴基伤完整池', () => {
  it('裸装+MagicPower(+20%) → 24（旧装备面读数=20;:57546 全乘区）', async () => {
    const { Game } = await import('../src/core/Game');
    // forbidden-storm-engine 同款空旷世界：y=40 一行地板（x∈[10,50]）
    const w = new World(80, 80, 42, 'bj745a-a28');
    for (let x = 10; x <= 50; x++) w.store.setTileSilent(x, 40, 1);
    const p = new Player(30 * 16, 36 * 16, new Inventory());
    p.hp = p.maxHp;
    p.setForbidden = true;
    p.buffs.apply(BuffType.MagicPower, 100);
    p.mana = 100;
    const added: unknown[] = [];
    const hooks = {
      world: w, player: p,
      enemies: () => [], critters: () => [], projectiles: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
      cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
      spawnDust: () => {}, showPickupLabel: () => {}, recLog: () => {},
      scene: {},
      entities: { add: (e: unknown) => { added.push(e); return e; }, projectiles: [] },
    } as unknown as GameHooks;
    p.inputAimWorldX = 30 * 16 + 8;
    p.inputAimWorldY = 38 * 16;
    p.minionRestTargetAim(hooks);
    expect(p.hasMinionRestTarget).toBe(true);
    void Game;
    p.commandForbiddenStorm(hooks);
    expect(added.length).toBe(1);
    expect((added[0] as { damage: number }).damage).toBe(24);   // 20×(1.2+1−1)
  });
});

// ===========================================================================
// A40：specialist 武器并道 rocket 桶
// ===========================================================================
describe('BJ745-A A40 IsRangedSpecialistWeapon 分道', () => {
  it('八员表逐字（ItemID.cs:1311）+ 分道：无弹药 specialist → rocket;箭/弹弹药先行', () => {
    expect([...IS_RANGED_SPECIALIST_WEAPON].sort((a, b) => a - b))
      .toEqual([160, 266, 1156, 3210, 3350, 3821, 5460, 5629]);
    expect(rangedDamageKindOf(1156, 0)).toBe('rocket');
    expect(rangedDamageKindOf(266, 169)).toBe('rocket');       // 砂枪（sand 弹药非三表）
    expect(rangedDamageKindOf(3821, 353)).toBe('rocket');      // 麦酒投掷器
    expect(rangedDamageKindOf(5460, 0)).toBe('rocket');
    expect(rangedDamageKindOf(999, 40)).toBe('arrow');          // 箭优先（IsArrow 先查）
    expect(rangedDamageKindOf(999, 97)).toBe('bullet');
    expect(rangedDamageKindOf(999, 771)).toBe('rocket');        // specialist 弹药
    expect(rangedDamageKindOf(999, 0)).toBe('other');
  });
  it('蘑菇矿火箭头 1548 → 食人鱼枪基伤 40×1.12 截 44（issue#35 A40 验收锚）', () => {
    const p = mkPlayer();
    equipSet(p, 1548, null, null);
    expect(p.equipStats.shroomiteType).toBe('rocket');
    expect(Math.trunc(40 * p.rangedDamageMult('rocket'))).toBe(44);
    // 控制组：箭头 1546 不给 specialist ×1.12（arrowDamage 独立乘区）
    const q = mkPlayer();
    equipSet(q, 1546, null, null);
    expect(Math.trunc(40 * q.rangedDamageMult('rocket'))).toBe(40);
  });
});

// ===========================================================================
// A41：空桶收雨
// ===========================================================================
describe('BJ745-A A41 空桶收雨', () => {
  it('雨天地表露天 → 掷中整堆 205→206（WorldItem.cs:553-576）', async () => {
    const w = new World(160, 160, 33, 'bj745a-a41');
    for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 60, 1, 0, 0);
    w.groundLevel = 50;
    (w as unknown as { weather: { raining: boolean; maxRaining: number } }).weather
      = { raining: true, maxRaining: 0.8 };
    const p = mkPlayer();
    p.x = -10000 * 16;                            // 远离掉落物（不被拉取）
    const hooks = {
      world: w, player: p,
      enemies: () => [], critters: () => [], projectiles: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
      cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
      spawnDust: () => {}, showPickupLabel: () => {}, recLog: () => {},
      scene: {},
    } as unknown as GameHooks;
    const d = new ItemDrop(30 * 16, 45 * 16, iid(205), 3);   // ty=45 ≤ groundLevel 50（地表）
    const rs = vi.spyOn(Math, 'random').mockReturnValue(0);   // Next(600)==0 ∧ NextFloat()<0.8
    try {
      d.fixedUpdate(DT, hooks);
    } finally { rs.mockRestore(); }
    expect(d.itemId).toBe(iid(206));              // 整堆变水桶
    expect(d.stack).toBe(3);                      // SetDefaults 保堆
  });
  it('控制组：晴天/地下（y>worldSurface）不触发', async () => {
    const w = new World(160, 160, 33, 'bj745a-a41b');
    for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 60, 1, 0, 0);
    w.groundLevel = 50;
    (w as unknown as { weather: { raining: boolean; maxRaining: number } }).weather
      = { raining: false, maxRaining: 0 };
    const p = mkPlayer();
    p.x = -10000 * 16;
    const hooks = {
      world: w, player: p,
      enemies: () => [], critters: () => [], projectiles: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
      cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
      spawnDust: () => {}, showPickupLabel: () => {}, recLog: () => {},
      scene: {},
    } as unknown as GameHooks;
    const rs = vi.spyOn(Math, 'random').mockReturnValue(0);
    const d1 = new ItemDrop(30 * 16, 45 * 16, iid(205), 1);   // 晴天
    const d2 = new ItemDrop(30 * 16, 90 * 16, iid(205), 1);   // 地下（y=90 > groundLevel 50）
    try {
      d1.fixedUpdate(DT, hooks);
      d2.fixedUpdate(DT, hooks);
    } finally { rs.mockRestore(); }
    expect(d1.itemId).toBe(iid(205));
    expect(d2.itemId).toBe(iid(205));
  });
});

// ===========================================================================
// 变异恰红（M 组）——每刀口摘除/回退必须爆红
// ===========================================================================
const spawnVitest = (filter: string) => spawnSync(
  'npx', ['vitest', 'run', 'tests/bj745a-armor-stats.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, SW_BJ745A_MUT: '1' },
  },
);
const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
  withMutation(file, trigger, replacement, () => {
    const r = spawnVitest(filter);
    expect(r.status, `变异须证红: ${replacement.slice(0, 70)}`).not.toBe(0);
    expect(r.stdout).toContain(filter);
  }, { label: `BJ745-A ${filter}` });
};

describe('BJ745-A 变异恰红', () => {
  it('M1 A01：armorStat 环回退双计（摘 238 跳过）→ dmgMagic 0.10 红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'if (v === 1546 || v === 1547 || v === 1548 || v === 238) continue;',
      'if (v === 1546 || v === 1547 || v === 1548) continue;',
      'A01 巫师帽魔伤单加');
  });
  it('M2 A02：摘海龟槽键 endurance → 85 验收锚红', () => {
    mutate(join(process.cwd(), 'src', 'data', 'vanillaArmorSets.ts'),
      "'99|65|54': { endurance: 0.15, name: 'Turtle' },",
      "'99|65|54': { name: 'Turtle' },",
      'A02 海龟套 15% 减伤');
  });
  it('M3 A07：getter 回退裸 armor[] → 共享配装反伤红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      '  get turtleSet(): boolean {\n    const g = (i: number) => this.inv.getEffectiveArmor(i);\n    return matchArmorSetBonusVid(vidOfItemId(g(0)?.id ?? -1), vidOfItemId(g(1)?.id ?? -1), vidOfItemId(g(2)?.id ?? -1))?.turtleThorns === true;\n  }',
      '  get turtleSet(): boolean {\n    const a = this.inv.armor;\n    return matchArmorSetBonusVid(vidOfItemId(a[0]?.id ?? -1), vidOfItemId(a[1]?.id ?? -1), vidOfItemId(a[2]?.id ?? -1))?.turtleThorns === true;\n  }',
      'A07 共享配装 getter 读');
  });
  it('M4 A09：摘卸套清位 → buff 残留红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'if (this.buffs.has(BuffType.ShadowDodge) && !eqM.onHitDodge) {\n      this.buffs.remove(BuffType.ShadowDodge);\n    }',
      'if (false && this.buffs.has(BuffType.ShadowDodge) && !eqM.onHitDodge) {\n      this.buffs.remove(BuffType.ShadowDodge);\n    }',
      'A09 卸套清幻影闪避');
  });
  it('M5 A10：门回退（重新挂 !Bleeding）→ 流血 2HP 红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'const bleedNow = this.buffs.has(BuffType.Bleeding) || this.buffs.obstructed;\n    if (this.hp > 0 && this.hp < this.maxHp) {',
      'const bleedNow = this.buffs.has(BuffType.Bleeding) || this.buffs.obstructed;\n    if (this.hp > 0 && this.hp < this.maxHp\n      && !bleedNow) {',
      'A10 帕拉钯快速再生穿流血');
  });
  it('M6 A11：adtnOnHit 豁免摘除 → 5HP 靶授 buff58 红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Enemy.ts'),
      'if (fromPlayer && dmg > 0 && (adtnOnHit || this.hp > 5) && plP && !plP.dead',
      'if (fromPlayer && dmg > 0 && this.hp > 5 && plP && !plP.dead',
      'A11 反伤路径低血靶');
  });
  it('M7 A15：折算摘除（恒 ×1）→ 0 球 ×3 红', () => {
    mutate(join(process.cwd(), 'src', 'player', 'BeetleMeter.ts'),
      'this.counter += dmgDone * (orbs === 0 ? 3 : orbs === 1 ? 2 : 1);',
      'this.counter += dmgDone;',
      'A15 甲虫攻套近战弹加账折算');
  });
  it('M8 A19：骑乘关位摘除 → 开关残留红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'if (this.vortexStealthActive && this.mount.active) this.vortexStealthActive = false;',
      'if (false && this.vortexStealthActive && this.mount.active) this.vortexStealthActive = false;',
      'A19 骑乘关星旋潜行');
  });
  it('M9 A21：AoE 回退单点 attacker → 无 attacker 面/远靶面红', () => {
    mutate(join(process.cwd(), 'src', 'core', 'Game.ts'),
      'const retaliation = Math.trunc(150 * p.damageMult(\'melee\'));',
      'const retaliation = Math.round(150 * p.damageMult(\'melee\'));',
      'A21 日曜爆闪 608 AoE');
  });
  it('M10 A27：冷却回退恒 90 → T2/T3 档红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'MinionProj.ts'),
      '  let result = 90;\n  if (t2) result = 60;\n  if (t3) result = 30;\n  return result;',
      '  let result = 90;\n  return result;',
      'A27 GetExplosiveTrapCooldown 三档');
  });
  it('M11 A28：基伤回退装备面 → MagicPower 24 红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      "const damage = Math.trunc(20 * (this.damageMult('magic') + this.summonDamageMult - 1));",
      "const damage = Math.trunc(20 * (1 + (this.equipStats.dmgMagic ?? 0) + (this.equipStats.minionDmg ?? 0)));",
      'A28 禁戒沙暴基伤完整池');
  });
  it('M12 A40：specialist 表清空 → 分道红', () => {
    mutate(join(process.cwd(), 'src', 'data', 'vanillaItemCombat.ts'),
      '= new Set([1156, 3350, 3210, 160, 266, 5629, 3821, 5460]);',
      '= new Set<number>();',
      'A40 IsRangedSpecialistWeapon 分道');
  });
  it('M13 A41：收雨门摘除 → 205→206 红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'ItemDrop.ts'),
      'if (vid === 205) this.tryFillBucket(game);',
      'if (false && vid === 205) this.tryFillBucket(game);',
      'A41 空桶收雨');
  });
});
