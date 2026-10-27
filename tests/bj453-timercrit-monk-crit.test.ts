// ★BJ453（2026-10-03）弹幕面 TimerCrit 消费 + 武僧 T2/T3 强制 crit 掷（受理面域）
//  定谳锚（Terarria1457 亲读）：
//   · Projectile.cs:12912-12943 `if (ownedBySomeone)` crit 段（Damage_PVE_Inner 敌/城
//     共享段）——三类掷(:12916-12927,688-690 SetDefaults 无类别旗轮不到)→
//     TryConsumingTimerCrit(:12928;Player.cs:28564-28595:accTimerCrit ∧ (charge≥1000 ∨
//     charge<0) → charge>0 时置 −15 + crit=true 强制,【无条件消费】——前掷已 crit 照消费)
//     → 武僧强制掷(:12929-12943:`int num14=type; if ((uint)(num14-688)<=2u) { if
//     (setMonkT3) { if (Next(4)==0) crit=true; } else if (setMonkT2 && Next(6)==0)
//     crit=true; }`——688/689/690=AI_137 闪电光环塔弹（vanilla-projectiles.json
//     aiStyle 137,无类别旗）,非装备 id）→ tag ModifyHit(:12947) → 6176 背包(:12962)。
//   · 原版 crit=单布尔单翻倍——res.crit 的 ×2 已嵌 res.dmg（WhipTag.ts:848）,新源
//     （TimerCrit/武僧/6176）强制时补一次 ×2 不重倍；旧 res.crit∧golemCrit 同拍 ×4
//     并发归位 ×2（BJ452 N1a 城镇臂同判）。
//   · 本仓受理面=MinionProj 族 Damage_PVE_Inner 同链 10 处（contact 敌/城、光环敌/城、
//     爆弹敌/城、彩弹敌/城、623 拳盒、818 扑击）——TimerCrit+武僧掷全量补齐（弹幕面
//     F11 既有接位=WeaponProj.hitEnemies/proj1457.dealContacts/Arrow whipTagShot/
//     VolcanoBlast/meleeOnHitProjs/MountCombat,本批不触）。
//  判别力（旧码必红项）：
//   §1 TimerCrit 满蓄强制（旧弹幕面恒无此源→crit false）+ 消费位 −15 + charge 门
//      （500 非满非负不触发）+ 接触面/城镇臂同位；
//   §2 武僧 T3 1/4（0.2 掷中）vs T2 1/6（0.2 不中/0.15 中）vs 无套（0 掷也不中=
//      装备门先于掷）、(uint) 撇距（687/691/-1 恒假）、688-690 唯一可达；
//   §3 并链：golem∧TimerCrit 同拍双真互不覆写（charge=−15 承载 TimerCrit 已消费）；
//      tag crit∧TimerCrit 单 ×2（旧无新源 100 同值,变异去掉 !res.crit 门=200 必红）；
//      tag crit∧golem 单 ×2（旧 ×4=200 必红）；无 buff/装备恒 crit=false 恒 30。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { MinionProj, monkAuraForcedCrit } from '../src/entities/MinionProj';
import type { GameHooks } from '../src/entities/types';

// ---- mock 环境（bj452 同款：真 World+真 Enemy/TownNPC+ projectiles 桶） ----
function makeGame(list: Enemy[], towns: TownNPC[]): { hooks: GameHooks; player: Player; added: unknown[] } {
  const w = new World(200, 120, 7, 'bj453-timercrit-monk-crit');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const projectiles: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => list,
    npcs: () => towns,
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
    spawnFriendlyProj: (e: unknown) => { added.push(e); return undefined; },
    entities: { add: (e: unknown) => { added.push(e); projectiles.push(e); }, nextId: 1, projectiles } as never,
    applyLifeSteal: () => 0,
  } as unknown as GameHooks;
  return { hooks, player, added };
}
const timerOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, accTimerCrit: true }), configurable: true,
  });
};
const golemBackpackOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, accGolemSentryBackpack: true }), configurable: true,
  });
};
const voodooOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, killGuide: true }), configurable: true,
  });
};
const setMonk = (p: Player, t3: boolean, t2: boolean): void => {
  (p as unknown as { setMonkT3?: boolean; setMonkT2?: boolean }).setMonkT3 = t3;
  (p as unknown as { setMonkT2?: boolean; setMonkT3?: boolean }).setMonkT2 = t2;
};
function guide(_hooks: GameHooks, towns: TownNPC[], px: number, py: number): TownNPC {
  const g = new TownNPC('guide', px, py);
  g.id = 100 + towns.length;
  g.maxHp = 500000;
  g.hp = 500000;
  towns.push(g);
  return g;
}
/** guide 盒心重定位（TownNPC ctor=左/底锚;光环场伤按盒心几何判定） */
const centerGuide = (g: TownNPC, cx: number, cy: number): void => {
  g.x = cx - g.w / 2;
  g.y = cy - g.h / 2;
};
const ravenAt = (player: Player, cx: number, cy: number): MinionProj =>
  new MinionProj(cx - 14, cy - 14, 317, 30, 1.5, false, 0, false, () => player);
const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30, cd: number | { kind: 'idStatic'; cd: number } | undefined = 5): boolean =>
  (m as unknown as { contact: (g: GameHooks, d: number, cd?: number | { kind: 'idStatic'; cd: number }) => boolean })
    .contact(hooks, dmg, cd);
const tickUntil = (m: { fixedUpdate: (dt: number, g: GameHooks) => void; dead: boolean },
  hooks: GameHooks, until: () => boolean, max = 120): number => {
  for (let i = 0; i < max && !until(); i++) m.fixedUpdate(1, hooks);
  return max;
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ================ §1 TimerCrit 弹幕受理面（:12928） ================
describe('BJ453-①：TimerCrit 满蓄强制 crit（光环塔 688 场伤面）', () => {
  /** 光环场盒驱动：688 塔落位 (392,1584) → 场盒 320² 心 (400,1600);敌=(400,1560) */
  const auraEnemyScenario = (player: Player, list: Enemy[]): { m: MinionProj; e: Enemy } => {
    const e = Enemy.fromVanilla(15, 400, 1560)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    return { m, e };
  };

  it('1a 满蓄在场：crit 强制 true + dmg ×2 + charge 消费置 −15（旧恒 30/false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // ★BJ716-A:DV 中性档(floor(0.5×31)−15=0→×1.0);0.5>全掷阈值→crit 只能来自 TimerCrit
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const { m, e } = auraEnemyScenario(player, list);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(30);            // ★S02(BJ723-B)改判:×2=Enemy.hurt 防后——未翻倍基伤(旧 60=预倍形;旧 30=零翻倍)
    expect(spy.mock.calls[0]![5]).toBe(true);          // ★主判别②:crit 参（旧恒 false 必红）
    expect(player.accTimerCritCharge).toBe(-15);       // ★主判别③:消费位（:28568-28571）
  });

  it('1b 无饰品零行为变：charge 满蓄不消费不强制（d=30/crit=false/charge 不变）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档(×1.0)
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    player.accTimerCritCharge = 1000;                  // 蓄满但未装备 6170
    const { m, e } = auraEnemyScenario(player, list);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(30);
    expect(spy.mock.calls[0]![5]).toBe(false);
    expect(player.accTimerCritCharge).toBe(1000);      // 零行为变：charge 不动
  });

  it('1c charge 门（:28566 满蓄∨负窗）：500 非满非负 → 不强制不消费', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档(×1.0)
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    timerOn(player);
    player.accTimerCritCharge = 500;
    const { m, e } = auraEnemyScenario(player, list);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(30);
    expect(spy.mock.calls[0]![5]).toBe(false);
    expect(player.accTimerCritCharge).toBe(500);       // 未消费
  });

  it('1d 接触面同位（317 乌鸦 contact 敌环）：满蓄强制 ×2（旧 30/false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档(×1.0)
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = Enemy.fromVanilla(15, 400, 600)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = ravenAt(player, 400, 600);
    const spy = vi.spyOn(e, 'hurt');
    contactDirect(m, hooks, 30, 10);
    expect(spy.mock.calls[0]![0]).toBe(30);            // ★S02 改判:未翻倍基伤(旧 60=预倍形)
    expect(spy.mock.calls[0]![5]).toBe(true);
    expect(player.accTimerCritCharge).toBe(-15);
  });

  it('1e 城镇臂同位（光环 688 城镇 settle）：crit 参 true + dmg 不预倍（防后 ×2 交 hurt）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档(×1.0)
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 400, 1560);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    const spy = vi.spyOn(g, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(30);            // settle.dmg 不预倍（TownNPC.hurt 防后×2）
    expect(spy.mock.calls[0]![6]).toBe(true);          // ★主判别:crit 参（旧恒 false 必红）
  });
});

// ================ §2 武僧 T2/T3 强制暴击掷（:12929-12943） ================
describe('BJ453-②：武僧 T3 1/4 vs T2 1/6 强制 crit（688-690 光环塔）', () => {
  it('2a T3 在场：0 掷中（1/4 覆盖）→ crit=true ×2（旧恒 30/false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    setMonk(player, true, true);                       // MonkTier3 同置 T3+T2（ArmorSetBonuses:115-116）
    const e = Enemy.fromVanilla(15, 400, 1560)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(26);            // ★S02 改判:DV(30,−15 档)=26 未翻倍直传(旧 52=预倍形;旧 30=零翻倍)
    expect(spy.mock.calls[0]![5]).toBe(true);
  });

  it('2b 仅 T2：0 掷中（1/6 覆盖）→ crit=true ×2（旧恒 false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    setMonk(player, false, true);
    const e = Enemy.fromVanilla(15, 400, 1560)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(26);            // ★S02 改判:DV(30,−15 档)=26 未翻倍(旧 52=预倍形)
    expect(spy.mock.calls[0]![5]).toBe(true);
  });

  it('2c 无套零行为变：0 掷也不中（装备门先于掷——0 在任何概率下都命中）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 400, 1560)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(26);            // DV(30,−15 档)=25.5→ToEven 26（BJ716-A;无套=无 monk 掷,crit 恒 false）
    expect(spy.mock.calls[0]![5]).toBe(false);
  });

  it('2d 档位判别：T3 1/4（0.2 中/0.25 上界外不中）vs T2 1/6（0.2 不中/0.15 中）', () => {
    const owner = { setMonkT3: true, setMonkT2: true } as never;
    const ownerT2 = { setMonkT2: true } as never;
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    expect(monkAuraForcedCrit(owner, 688)).toBe(true);   // floor(0.2×4)=0 → 1/4 覆盖 0.2
    expect(monkAuraForcedCrit(ownerT2, 688)).toBe(false); // floor(0.2×6)=1 → 1/6 不覆盖 0.2
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    expect(monkAuraForcedCrit(ownerT2, 688)).toBe(true);  // floor(0.15×6)=0 → 1/6 覆盖 0.15
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(monkAuraForcedCrit(owner, 688)).toBe(false);   // floor(0.25×4)=1 → Next(4) 排他上界
    expect(monkAuraForcedCrit({ setMonkT2: true } as never, 688)).toBe(false); // floor(1.5)=1
  });

  it('2e (uint) 撇距+范围：688/689/690 达,687/691/317/0/-1 恒假（负数回卷大正数）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const owner = { setMonkT3: true } as never;
    expect(monkAuraForcedCrit(owner, 688)).toBe(true);
    expect(monkAuraForcedCrit(owner, 689)).toBe(true);
    expect(monkAuraForcedCrit(owner, 690)).toBe(true);
    expect(monkAuraForcedCrit(owner, 687)).toBe(false);
    expect(monkAuraForcedCrit(owner, 691)).toBe(false);
    expect(monkAuraForcedCrit(owner, 317)).toBe(false);
    expect(monkAuraForcedCrit(owner, 0)).toBe(false);
    expect(monkAuraForcedCrit(owner, -1)).toBe(false);   // (-1-688)>>>0 = 4294966607 > 2
  });

  it('2f 非 688 弹面形位保留（317 contact）：T3 在场仍不强制（旧码同值回归锚）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    setMonk(player, true, true);
    const e = Enemy.fromVanilla(15, 400, 600)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = ravenAt(player, 400, 600);
    const spy = vi.spyOn(e, 'hurt');
    contactDirect(m, hooks, 30, 10);
    expect(spy.mock.calls[0]![0]).toBe(26);            // DV(30,−15 档)=26（BJ716-A;317 无 monk 面=掷门零消费判别保持）
    expect(spy.mock.calls[0]![5]).toBe(false);
  });
});

// ================ §3 与 6176/golemCrit 并链无覆写 ================
describe('BJ453-③：crit 源并链（res.crit‖TimerCrit‖武僧‖6176）', () => {
  const auraEnemyScenario = (player: Player, list: Enemy[]): { m: MinionProj; e: Enemy } => {
    const e = Enemy.fromVanilla(15, 400, 1560)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    return { m, e };
  };

  it('3a golem 保留：仅背包掷中 → crit=true ×2（既有行为回归锚）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);       // golem Next(10)==0 掷中
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    golemBackpackOn(player);
    const { m, e } = auraEnemyScenario(player, list);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(26);            // ★S02 改判:DV(30,−15 档)=26 未翻倍直传(旧 52=预倍形)
    expect(spy.mock.calls[0]![5]).toBe(true);
  });

  it('3b TimerCrit∧golem 同拍：crit 双真互不覆写（charge=−15 承载 TimerCrit 已消费）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);       // golem 掷中;TimerCrit 非掷源
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    golemBackpackOn(player);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const { m, e } = auraEnemyScenario(player, list);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![5]).toBe(true);          // 并链真（任一源即真）
    expect(spy.mock.calls[0]![0]).toBe(26);            // ★S02 改判:单一 crit 参防后 ×2(非 ×4);DV=26 未翻倍(旧 52=预倍形)
    expect(player.accTimerCritCharge).toBe(-15);       // TimerCrit 源照消费（:12928 无条件）
  });

  it('3c tag crit∧TimerCrit 同拍：单 ×2（=(30+20)×2=100;重倍 200 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);       // 万花筒 tag crit 掷中（critChance 10）
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const { m, e } = auraEnemyScenario(player, list);
    player.tagEffectStack.tryApplyTagToNPC(4914, e.id, 0, 0);   // tagDamage 20/critChance 10
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(42);            // ★S02 改判:res.dmg=50(WhipTag 尾预倍已摘);DV(50,−15 档)=42.5→ToEven 42(旧 85=预倍+DV 双重形)
    expect(spy.mock.calls[0]![5]).toBe(true);
    expect(player.accTimerCritCharge).toBe(-15);
  });

  it('3d tag crit∧golem 同拍：单 ×2（旧 golem 防前预倍 ×4=200 必红,BJ452 N1a 城镇臂同判）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    golemBackpackOn(player);
    const { m, e } = auraEnemyScenario(player, list);
    player.tagEffectStack.tryApplyTagToNPC(4914, e.id, 0, 0);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(42);            // ★S02 改判:单 crit 参防后 ×2（×4 归位保持);DV(50)=42(旧 85=预倍形)
    expect(spy.mock.calls[0]![5]).toBe(true);
  });

  it('3e tag crit 单源回归锚（零行为变）：d=100/crit=true（BJ452 N2a 同值）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const { m, e } = auraEnemyScenario(player, list);
    player.tagEffectStack.tryApplyTagToNPC(4914, e.id, 0, 0);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(42);             // ★S02 改判:DV(50,−15 档)=42 未翻倍(旧 85=预倍形;tag crit 单源保持)
    expect(spy.mock.calls[0]![5]).toBe(true);
  });
});
