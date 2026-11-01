// S 级玩家小件包（9 项）回归（2026-08-20）：
//  1 附近箱子快速堆叠（QuickStacking.cs 1:1 + smart 档分类层）
//  2 造型师理发（OpenHairWindow 报价链 Main.cs:43198-43211）
//  3 骸骨头盔幻影（SpawnHallucination + Projectile 964 AI_187）
//  4 虫洞药水（HasUnityPotion/TakeUnityPotion + 观战传送门）
//  5 The Constant 饥饿链（UpdateHungerBuffs/UpdateStarvingState 332→333→334）
//  6 开发者套装掉落（TryGettingDevArmor——既有 boss-bags 链，本文件复验全局表口径）
//  7 抚摸宠物（PetAnimal/UpdatePettingAnimal + solidCollisionBox）
//  8 相机修饰器栈（CameraModifierStack/PunchCameraModifier）
//  9 翅膀/饥荒小件粒子（眼球伞云盖标记 + 水晶鞋尘——Player.fixedUpdate 链）
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BuffState, BuffType, BUFF_DEFS } from '../src/stats/Buffs';
import { ITEM_BY_KEY, ITEM_DEFS } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { quickStackToChests, chestsInRangeOf, moveCoinsIntoBank } from '../src/stats/QuickStacking';

// ★SW-FX40：MakeFloorDust（Player.cs:23981-24234）尘型全集（num3 表）——水晶鞋
// 尘 204 全称断言的重锚豁免集
const FLOOR_DUST_TYPES = new Set([0, 4, 5, 14, 16, 32, 36, 37, 51, 53, 76, 108, 122, 153, 243, 322, 326, 327, 328]);
import { sortingLayerIndex } from '../src/data/vanillaItemSorting';
import { InsanityShadowFriendly, randomizeFriendlyInsanityShadow } from '../src/entities/InsanityShadowFriendly';
import { PunchCameraModifier, CameraModifierStack, remap } from '../src/render/CameraModifierStack';
import { DEV_ARMOR_SETS, BOSS_BAG_IDS } from '../src/data/vanillaBossBags';
import { solidCollisionBox } from '../src/entities/Player';
import { hairRestylePriceRaw } from '../src/core/Game';
import type { GameHooks } from '../src/entities/types';
import type { ChestData } from '../src/world/World';

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const fakeHooks = (w: World, p?: Player, over: Partial<GameHooks> = {}): GameHooks => ({
  world: w,
  player: p,
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
  playerEmote: () => {},
  spawnRainForced: () => {},
  ...over,
} as never);

const mkWorld = (): World => {
  const w = new World(60, 60, 72, 'smallpack');
  for (let x = 10; x <= 44; x++) w.store.setTileSilent(x, 40, 1 /* dirt */);
  return w;
};

// ===================== 1 附近箱子快速堆叠 =====================
describe('QuickStacking（QuickStacking.cs 1:1）', () => {
  const dirt = _iid(2);       // Dirt Block（LastTilesCommon 层 49）
  const torch = _iid(8);      // Torch（LastTilesImportant 层 48）
  const dirtMax = ITEM_DEFS[dirt].maxStack;

  const mkInv = (): Inventory => {
    const inv = new Inventory();
    // 槽 10（首格）：dirt 30；槽 11：dirt 40；槽 0（快捷栏）dirt 50——不应参与
    inv.slots[10] = { id: dirt, stack: 30 };
    inv.slots[11] = { id: dirt, stack: 40 };
    inv.slots[0] = { id: dirt, stack: 50 };
    // 槽 12：收藏 dirt——不转移
    inv.slots[12] = { id: dirt, stack: 10, favorited: true } as never;
    return inv;
  };
  const chest = (fill: Array<[number, number]> | null, locked = false): ChestData =>
    ({ x: 20, y: 38, items: fill ? fill.map(([id, n]) => (id > 0 && n > 0 ? { id, stack: n } : null)) : Array(20).fill(null), locked });

  it('同型补叠（FillStack）：箱内既有叠吃满全部同型源件；快捷栏/收藏不动', () => {
    const inv = mkInv();
    // 箱内：格 0 dirt 10（同型补叠口，dirt maxStack 999 >> 源量 70）
    const c = chest([[dirt, 10], [0, 0]]);
    c.items[1] = null;
    quickStackToChests(inv, [c], false);
    expect(c.items[0]!.stack).toBe(10 + 30 + 40);   // 补叠吃尽槽 10/11
    expect(c.items[1]).toBeNull();                  // 无需空格（未满即并尽）
    expect(inv.slots[0]!.stack).toBe(50);           // 快捷栏不动（源 = 10-49）
    expect(inv.slots[12]!.stack).toBe(10);          // 收藏不动
    void dirtMax;
  });

  it('同型箱满叠 → Consolidate 归并后整件入空格（InsertIntoFreeSlot）', () => {
    const inv = new Inventory();
    inv.slots[10] = { id: dirt, stack: dirtMax - 5 };
    inv.slots[11] = { id: dirt, stack: 30 };
    const c = chest(null);
    quickStackToChests(inv, [c], false);
    // 箱内无同型 → quick 轮无账；空箱无任何同型登记（destinationsForItemTypes 空）
    // → 无转移（quick 档只送箱内已有类型；smart 档才按分类层送——见下）
    expect(inv.slots[10]!.stack).toBe(dirtMax - 5);
    expect(c.items.every((s) => !s)).toBe(true);
  });

  it('空箱不参与（!chest.IsEmpty 门）；全空箱为目的地时无转移', () => {
    const inv = mkInv();
    const empty = chest(null);
    quickStackToChests(inv, [empty], false);
    expect(empty.items.every((s) => !s)).toBe(true);
    expect(inv.slots[10]!.stack).toBe(30);
  });

  it('锁箱：同型补叠与整送均 blocked，箱与背包原样（transferBlocked 链）', () => {
    const inv = mkInv();
    const c = chest([[dirt, 10], [0, 0]], true);
    c.items[1] = null;
    const r = quickStackToChests(inv, [c], false);
    expect(r.blocked).toContain(c);
    expect(c.items[0]!.stack).toBe(10);
    expect(inv.slots[10]!.stack).toBe(30);
    expect(inv.slots[11]!.stack).toBe(40);
  });

  it('smart 档：分类层最适箱整件送（torch 层 48 → 书箱计 2 > 土箱计 0）', () => {
    const inv = new Inventory();
    inv.slots[10] = { id: torch, stack: 5 };
    const book = _iid(149);
    // 表驱断言：torch(8)/book(149) 同层 48（LastTilesImportant）
    expect(sortingLayerIndex(8)).toBe(48);
    expect(sortingLayerIndex(149)).toBe(48);
    expect(sortingLayerIndex(2)).toBe(49);
    // A：书 ×2（层 48 计 2）+ 空位；B：土 ×1（层 49 计 1）+ 空位
    const a = chest(null); a.items[0] = { id: book, stack: 1 }; a.items[1] = { id: book, stack: 1 };
    const b = chest(null); b.items[0] = { id: dirt, stack: 1 };
    quickStackToChests(inv, [a, b], true);
    // 两箱均无 torch 同型 → quick 轮不送；smart 轮 torch 层 48 计分 A=2 命中
    const torchInA = a.items.some((s) => s && s.id === torch);
    const torchInB = b.items.some((s) => s && s.id === torch);
    expect(torchInA).toBe(true);
    expect(torchInB).toBe(false);
    expect(inv.slots[10]).toBeNull();
  });

  it('chestsInRangeOf：锚 (x·16+16, y·16+16) 与玩家 600px 欧氏门（NearbyChests.cs:10-31）', () => {
    const near = chest([[1, 1]]); near.x = 20; near.y = 39;
    const far = chest([[1, 1]]); far.x = 20; far.y = 39 - 70;   // 70 格 = 1120px > 600
    const hit = chestsInRangeOf([near, far], 20 * 16, 39 * 16);
    expect(hit).toContain(near);
    expect(hit).not.toContain(far);
  });

  it('moveCoinsIntoBank：合池 + 100:1 进位 + 原币位回填（ChestUI.MoveCoins :987-1198）', () => {
    const inv = new Inventory();
    const copper = _iid(71), silver = _iid(72), gold = _iid(73);
    inv.slots[10] = { id: copper, stack: 150 };   // 150 铜 → 1 银 50 铜
    inv.slots[11] = { id: copper, stack: 60 };
    const bank = Array(10).fill(null);
    bank[0] = { id: silver, stack: 20 };
    const moved = moveCoinsIntoBank(inv, bank);
    // 210 铜 + 20 银 → 22 银 10 铜：原银位（bank[0]）回填 22，bank 某空位 10 铜
    expect(bank[0]!.id).toBe(silver);
    expect(bank[0]!.stack).toBe(22);
    const coppers = bank.filter((s) => s && s.id === copper);
    expect(coppers.reduce((n, s) => n + s!.stack, 0)).toBe(10);
    expect(inv.slots[10]).toBeNull();
    expect(inv.slots[11]).toBeNull();
    expect(moved).toBe(210);
  });

  it('分类层数据表（vanilla-itemsorting.json）：铁镐 8 层/铁阔剑 0 层/土块 49 层/凝胶 17 层', () => {
    expect(sortingLayerIndex(1)).toBe(8);        // Iron Pickaxe → ToolsPickaxes
    expect(sortingLayerIndex(4)).toBe(0);        // Iron Broadsword → WeaponsMelee
    expect(sortingLayerIndex(2)).toBe(49);       // Dirt Block → LastTilesCommon
    expect(sortingLayerIndex(23)).toBe(17);      // Gel → WeaponsAmmoLeftovers
    expect(sortingLayerIndex(27)).toBe(42);      // Acorn → MiscAcorns
  });
});

// ===================== 2 造型师理发报价 =====================
describe('OpenHairWindow 报价（Main.cs:43198-43211）', () => {
  it('发型 10 金 + 发色 2 金 → 折扣 ×0.8 截断 → 快乐度乘子 → 取整到金', () => {
    expect(hairRestylePriceRaw(false, false, false, 1)).toBe(0);          // 无改动免费
    expect(hairRestylePriceRaw(true, false, false, 1)).toBe(100000);      // 发型 10 金
    expect(hairRestylePriceRaw(false, true, false, 1)).toBe(20000);       // 发色 2 金
    expect(hairRestylePriceRaw(true, true, false, 1)).toBe(120000);       // 双改 12 金
    // 折扣卡（:43208 trunc(120000×0.8) = 96000 → Round 到金 = 100000？96000/10000=9.6 → 10）
    expect(hairRestylePriceRaw(true, true, true, 1)).toBe(100000);
    expect(hairRestylePriceRaw(true, false, true, 1)).toBe(80000);        // 100000×0.8
    // 快乐度 1.25（:43210 trunc(100000×1.25)=125000 → 120000）
    expect(hairRestylePriceRaw(true, false, false, 1.25)).toBe(120000);
  });
});

// ===================== 3 骸骨头盔幻影 =====================
describe('SpawnHallucination + Projectile 964（Player.cs:13627 + AI_187）', () => {
  it('randomizeFriendlyInsanityShadow 四变体段（ai0 = 0/180/300/390，Projectile.cs:39703）', () => {
    // num2 = Next(4)：rand<0.25 → 0；[0.25,0.5) → 1；[0.5,0.75) → 2；≥0.75 → 3
    const mk = (r: number) => randomizeFriendlyInsanityShadow(1000, 1000, () => r);
    expect(mk(0.0).ai0).toBe(0);
    expect(mk(0.3).ai0).toBe(180);
    expect(mk(0.6).ai0).toBe(300);
    expect(mk(0.9).ai0).toBe(390);
    // 变体 0：出生位 = Center + (−num×100,0) 旋 ±π/8（非 hostile num3=100）
    const p0 = mk(0.0);
    const d0 = Math.hypot(p0.x + 20 - 1000, p0.y + 20 - 1000);
    expect(d0).toBeGreaterThan(80);    // 旋转后半径 ≈ 92-100
    expect(d0).toBeLessThan(110);
  });

  it('AI_187 段尾自灭 + 淡入淡出（fc >= len-1 Kill，alpha 淡入至 50）', () => {
    const p = randomizeFriendlyInsanityShadow(0, 0, () => 0.9);
    const e = new InsanityShadowFriendly(p, 18);
    const w = mkWorld();
    const hooks = fakeHooks(w, undefined, { onProjectileDeath: () => {} });
    for (let t = 0; t < 120 && !e.dead; t++) e.fixedUpdate(1 / 60, hooks);   // 240t 寿命上限
    expect(e.dead).toBe(true);
    // 复位再验 alpha：首步即淡入（255 → 230）
    const e2 = new InsanityShadowFriendly(randomizeFriendlyInsanityShadow(0, 0, () => 0.9), 18);
    const before = (e2 as unknown as { alpha: number }).alpha;
    e2.fixedUpdate(1 / 60, hooks);
    expect((e2 as unknown as { alpha: number }).alpha).toBeLessThan(before);
  });

  it('Player：Bone Helm（5100）在 armor[3-9] → 冷却节流 20-100（:13638 重掷）', () => {
    const w = mkWorld();
    const p = new Player(20 * 16, 37 * 16, new Inventory());
    const boneHelm = _iid(5100);
    p.inv.armor[3] = { id: boneHelm, stack: 1 };
    const spawned: number[] = [];
    const hooks = fakeHooks(w, p, {
      spawnInsanityShadow: () => { spawned.push(1); },
    });
    // 无敌怪在场 → 候选空 → 不生成（:13650 Count != 0 门）
    for (let t = 0; t < 120; t++) p.fixedUpdate(1 / 60, hooks);
    expect(spawned.length).toBe(0);
    expect(p.insanityShadowCooldown).toBeGreaterThan(0);
    expect(p.insanityShadowCooldown).toBeLessThanOrEqual(100);
  });
});

// ===================== 4 虫洞药水 =====================
describe('虫洞药水（HasUnityPotion/TakeUnityPotion Player.cs:41652-41697）', () => {
  it('背包 2997 检出与消耗；钱币/虚空袋域', () => {
    const p = new Player(0, 0, new Inventory());
    expect(p.hasUnityPotion()).toBe(false);
    p.inv.slots[30] = { id: _iid(2997), stack: 2 };
    expect(p.hasUnityPotion()).toBe(true);
    p.takeUnityPotion();
    expect(p.inv.slots[30]!.stack).toBe(1);
    p.takeUnityPotion();
    expect(p.inv.slots[30]).toBeNull();
    expect(p.hasUnityPotion()).toBe(false);
  });

  it('虚空袋（4131 持有）bank4 域检出 + 消耗（useVoidBag 门 :22904）', () => {
    const p = new Player(0, 0, new Inventory());
    expect(p.hasUnityPotion()).toBe(false);
    p.banks[3][5] = { id: _iid(2997), stack: 3 };
    expect(p.hasUnityPotion()).toBe(false);          // 无虚空袋不算
    p.inv.slots[0] = { id: _iid(4131), stack: 1 };
    expect(p.hasUnityPotion()).toBe(true);
    p.takeUnityPotion();
    expect(p.banks[3][5]!.stack).toBe(2);
  });
});

// ===================== 5 The Constant 饥饿链 =====================
describe('饥饿链（UpdateHungerBuffs :11686 + UpdateStarvingState :11743）', () => {
  it('constant 世界：无 fed-state → 播种 332（300s）；非 constant 剥离三态', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;
    b.updateStarvingState(false);
    expect(b.active.get(BuffType.NeutralHunger)).toBeCloseTo(300, 0);
    b.dontStarveWorld = false;
    b.tick(1 / 60);                           // UpdateHungerBuffs：非 constant 三态即刻剥离
    expect(b.active.has(BuffType.NeutralHunger)).toBe(false);
  });

  it('链尾转移：332 剩 ≤2t → 333（emote 147）；333 → 334（5t + emote 148 + 音）；334 持续到食物重置（★BJ739 B02 改判）', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;
    const events: string[] = [];
    b.onHungerEvent = (k) => events.push(k);
    b.apply(BuffType.NeutralHunger, 2 / 60);    // 直落 2t（set 语义可缩短）
    b.tick(1 / 60);                             // 递减 → ≤2t 界 → 转移 333
    expect(b.has(BuffType.Hunger)).toBe(true);
    expect(events).toContain('hungry');
    // 333 落界 → 334（5t）+ starving 事件
    b.set(BuffType.Hunger, 2 / 60);
    events.length = 0;
    b.tick(1 / 60);
    expect(b.has(BuffType.Starving)).toBe(true);
    expect(events).toContain('starving');
    // ★BJ739 B02（2026-10-31,issue #29）：334 在 TimeLeftDoesNotDecrease 表
    //  （BuffID.cs:22 + Player.cs:9958）——5t 不自减,极饿持续到食物/蘑菇重置,
    //  旧「334 尽 → 重播 332」循环重启系缺递减门时期的近似,随刀改判
    b.tick(5 / 60);
    expect(b.has(BuffType.Starving)).toBe(true);            // 持续（时长钉 5t 不动）
    expect(b.active.get(BuffType.Starving)).toBeCloseTo(5 / 60, 9);
    b.tick(10);
    expect(b.has(BuffType.Starving)).toBe(true);            // 长期持续
    expect(b.has(BuffType.NeutralHunger)).toBe(false);      // 不重播 332
    // 食物重置才清（TryToResetHungerToNeutral → 下拍 332）
    b.apply(BuffType.WellFed, 60);
    expect(b.has(BuffType.Starving)).toBe(false);
  });

  it('吃食物清饥饿链（IsFedState 换档删旧 :5080-5089）：apply(26) 删 332/333/334', () => {
    const b = new BuffState();
    b.apply(BuffType.Hunger, 100);
    b.apply(BuffType.WellFed, 60);
    expect(b.has(BuffType.Hunger)).toBe(false);
    expect(b.has(BuffType.WellFed)).toBe(true);
  });

  it('饥饿/极饿数值（:11561-11571/:11584-11595）：防 -2/-4、全系伤 -5/-10%、镐速 +5/+15%', () => {
    const b = new BuffState();
    expect(b.hungerTier).toBe(0);
    b.apply(BuffType.Hunger, 10);
    expect(b.hungerTier).toBe(1);
    expect(b.defenseBonus).toBe(-2);
    expect(b.hungerDamage).toBe(-0.05);
    expect(b.hungerPickSpeed).toBe(0.05);
    b.apply(BuffType.Starving, 10);
    expect(b.hungerTier).toBe(2);
    expect(b.defenseBonus).toBe(-4);
    expect(b.hungerDamage).toBe(-0.1);
    expect(b.hungerPickSpeed).toBe(0.15);
  });

  it('极饿流干单通道：lifeRegen=-max(4,120·maxHp/3000)（半HP/s）,每 120·max(2,maxHp/50) 一跳 maxHp/50（×2 沙/雪）', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;          // 非 constant 世界三态被 UpdateHungerBuffs 即刻剥离
    b.apply(BuffType.Starving, 10);
    b.starvingMaxHp = 500;              // num2 = 20 → 10 HP/s;num12 = 10 → 60t 一跳
    b.starvingZoneBoost = false;
    // ★1457 裁决（R5-F7）：极饿是【单通道流干】——:19255-19276 lifeRegen=-num2
    //   喂 :19384 lifeRegenCount,:19458-19477 每 -120×num12 一跳 HurtLifeRegen(num12)。
    //   500HP：num2=20（半HP/s）=10HP/s,num12=10,num13=1200 → 每 60t 一跳 10。
    //   2 秒 = 2 跳 = 20。旧断言 30（流失 20 + 周期直伤 10 双通道并行）系 R5-F7
    //   前旧模型,按原版改。
    let dmg = 0;
    for (let t = 0; t < 120; t++) dmg += -b.tick(1 / 60);
    expect(dmg).toBeGreaterThanOrEqual(20);
    expect(dmg).toBeLessThan(21);
    // 沙/雪 ×2（:19462-19463 dmg = num12×2,流速不变）→ 2s = 2 跳 × 20 = 40
    const b2 = new BuffState();
    b2.dontStarveWorld = true;
    b2.apply(BuffType.Starving, 10);
    b2.starvingMaxHp = 500;
    b2.starvingZoneBoost = true;
    let dmg2 = 0;
    for (let t = 0; t < 120; t++) dmg2 += -b2.tick(1 / 60);
    expect(Math.round(dmg2)).toBeGreaterThanOrEqual(40);
  });

  it('BUFF_DEFS 三态映射（332/333/334 原版 id）+ 存档不落 buffNoSave 例外', () => {
    expect(BUFF_DEFS[BuffType.NeutralHunger].vanillaBuff).toBe(332);
    expect(BUFF_DEFS[BuffType.Hunger].vanillaBuff).toBe(333);
    expect(BUFF_DEFS[BuffType.Starving].vanillaBuff).toBe(334);
  });
});

// ===================== 6 开发者套装掉落（既有链复验）=====================
describe('TryGettingDevArmor（Player.cs:7524-7665，boss-bags 链）', () => {
  it('全局 21 组套装表 + 1/16（十周年 1/8）门袋集（10 袋 devArmor=true）', () => {
    expect(DEV_ARMOR_SETS.length).toBe(21);
    expect([...BOSS_BAG_IDS].sort((a, b) => a - b)).toContain(3332);   // Moon Lord 袋
    // 首组 = Red 套（666/667/668/665/3287）
    expect(DEV_ARMOR_SETS[0].map(([id]) => id)).toEqual([666, 667, 668, 665, 3287]);
  });
});

// ===================== 7 抚摸宠物 =====================
describe('PetAnimal/UpdatePettingAnimal（Player.cs:32901-33033）', () => {
  it('solidCollisionBox（Collision.SolidCollision）：实心格相交/平台豁免/半砖下沉', () => {
    const w = mkWorld();   // y=40 行 dirt 地板（640-656px）
    expect(solidCollisionBox(w.store, 20 * 16, 39 * 16 + 8, 20, 16)).toBe(true);   // 底缘没入地板 8px
    expect(solidCollisionBox(w.store, 20 * 16, 36 * 16, 20, 16)).toBe(false);      // 空中
  });

  it('petAnimal：吸附宠物旁 + 面向宠物 + 停止条件（移动键/目标失效）', () => {
    const w = mkWorld();
    const p = new Player(20 * 16, 38 * 16, new Inventory());
    const hooks = fakeHooks(w, p);
    p.fixedUpdate(1 / 60, hooks);   // 落地沉降
    // 宠物在玩家右侧：站位 = 宠 Bottom + (−1×36, 0)，玩家面向右（num=1 → 面向宠物）
    const ok = p.petAnimal(hooks, {
      cx: p.cx + 50, bottomY: 40 * 16, isSmall: false, reach: 36,
      valid: () => true,
    });
    expect(ok).toBe(true);
    expect(p.petting.isPetting).toBe(true);
    expect(p.facing).toBe(1);                       // 面向宠物（宠物在右）
    expect(p.vx).toBe(0);
    // 移动键 → 停（:33030 controlLeft/Right/Up/Down/Jump）
    p.inputX = 1;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.petting.isPetting).toBe(false);
    // 目标失效 → 停
    const q = new Player(20 * 16, 38 * 16, new Inventory());
    q.fixedUpdate(1 / 60, hooks);
    let alive = true;
    q.petAnimal(hooks, { cx: q.cx + 50, bottomY: 40 * 16, isSmall: false, reach: 36, valid: () => alive });
    alive = false;
    q.fixedUpdate(1 / 60, hooks);
    expect(q.petting.isPetting).toBe(false);
  });

  it('pettingArmPhase 两档（miscCounter%14/7，:49481-49508）', () => {
    const p = new Player(0, 0, new Inventory());
    (p as unknown as { miscCounter: number }).miscCounter = 0;
    expect(p.pettingArmPhase).toBe(0);
    (p as unknown as { miscCounter: number }).miscCounter = 7;
    expect(p.pettingArmPhase).toBe(1);
    (p as unknown as { miscCounter: number }).miscCounter = 14;
    expect(p.pettingArmPhase).toBe(0);
  });
});

// ===================== 8 相机修饰器栈 =====================
describe('CameraModifierStack / PunchCameraModifier（1:1）', () => {
  it('remap 线性映射（Utils.Remap）', () => {
    expect(remap(0, 0, 10, 1, 0)).toBeCloseTo(1, 6);
    expect(remap(10, 0, 10, 1, 0)).toBeCloseTo(0, 6);
    expect(remap(5, 0, 10, 1, 0)).toBeCloseTo(0.5, 6);
  });

  it('Punch：cos 振动 × 线性包络；frames 到点 Finished', () => {
    const m = new PunchCameraModifier(0, 0, 1, 0, 10, 6, 3, -1, null);   // dir=(1,0) 强度 10 3 帧
    const stack = new CameraModifierStack();
    stack.add(m);
    let off = { x: 0, y: 0 };
    for (let i = 0; i < 3; i++) off = stack.applyTo(0, 0, 800, 600);
    expect(m.finished).toBe(true);
    // 末帧 framesLasted=2：cos(2/60·6·2π)=cos(0.4π)；包络 Remap(2,0,3,1,0)=1/3
    const want = Math.cos(2 / 60 * 6 * Math.PI * 2) * 10 * (1 / 3);
    expect(off.x).toBeCloseTo(want, 6);
    expect(off.y).toBeCloseTo(0, 6);
    // 再 apply → 已 Finished 被清（ClearFinishedModifiers）
    const off2 = stack.applyTo(0, 0, 800, 600);
    expect(off2.x).toBe(0);
    expect(stack.count).toBe(0);
  });

  it('uniqueIdentity 去重（RemoveIdenticalModifiers）+ 距离衰减门', () => {
    const stack = new CameraModifierStack();
    stack.add(new PunchCameraModifier(0, 0, 1, 0, 10, 6, 5, -1, 'Deerclops'));
    stack.add(new PunchCameraModifier(0, 0, 1, 0, 10, 6, 5, -1, 'Deerclops'));
    expect(stack.count).toBe(1);
    // 距离衰减 1000：相机中心距 (0,0) 500px → 强度 ×0.5（Remap(500,0,1000,1,0)）
    const m2 = new PunchCameraModifier(0, 0, 1, 0, 8, 6, 1, 1000, null);
    const s2 = new CameraModifierStack();
    s2.add(m2);
    // 中心 = (0,0)+屏幕/2 = (400,300)；距 (0,0) = 500
    const off = s2.applyTo(0, 0, 800, 600);
    const d = 500;
    const falloff = remap(d, 0, 1000, 1, 0);
    const want = Math.cos(0 / 60 * 6 * Math.PI * 2) * 8 * remap(0, 0, 1, 1, 0) * falloff;
    expect(off.x).toBeCloseTo(want, 6);
  });
});

// ===================== 9 眼球伞 / 水晶鞋（饥荒小件粒子）=====================
describe('DoEyebrellaRainEffect / DoGlassSlipperSparkles（Player.cs:13866-13919）', () => {
  it('眼球伞（armor[0] 或 armor[10] 任一 5101）：头顶强制雨滴（1/4 掷）+ eyebrellaCloud 标记', () => {
    const w = mkWorld();
    const p = new Player(20 * 16, 36 * 16, new Inventory());
    p.inv.armor[0] = { id: _iid(5101), stack: 1 };
    const rains: Array<[number, number, number, number]> = [];
    const hooks = fakeHooks(w, p, {
      spawnRainForced: (x, y, vx, vy) => { rains.push([x, y, vx, vy]); },
    });
    for (let t = 0; t < 60; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.eyebrellaCloud).toBe(true);
    expect(rains.length).toBeGreaterThan(0);
    if (rains.length) {
      const [x, y, vx, vy] = rains[0];
      expect(vy).toBe(9);                       // Rain.NewRainForced vy=9（:13916）
      expect(y).toBeLessThan(p.cy - 20);        // 头顶 −30 段
      expect(Math.abs(x - p.cx)).toBeLessThan((p.w + 18) / 2 + 1);
      void vx;
    }
    // 摘下 → 标记熄灭
    p.inv.armor[0] = null;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.eyebrellaCloud).toBe(false);
  });

  it('水晶鞋（armor[13-19] 任一 5077）：尘 204 生成（dyeVid 鞋染料）', () => {
    const w = mkWorld();
    const p = new Player(20 * 16, 36 * 16, new Inventory());
    p.inv.armor[13] = { id: _iid(5077), stack: 1 };
    const dusts: number[] = [];
    const hooks = fakeHooks(w, p, {
      vanillaDust: {
        spawn: (x: number, y: number, ww: number, hh: number, type: number) => {
          dusts.push(type);
          return null;
        },
      } as never,
    });
    for (let t = 0; t < 1200; t++) p.fixedUpdate(1 / 60, hooks);  // 1/60 掷 → 20s 期望 ~20
    expect(dusts.length).toBeGreaterThan(3);   // P(≤3 | λ=20) ≈ 0.0002%——不 flaky
    // ★SW-FX40 重锚：MakeFloorDust（Player.cs:23981-24234）整支接入后，落地拍
    // （开场坠落触地）追加泥土尘 0（num3=0 表,:24056-24058）——204 全称断言放宽
    // 为「204 ∪ 地板尘表」，鞋染料尘 204 生成面不变
    expect(dusts.every((t) => t === 204 || FLOOR_DUST_TYPES.has(t))).toBe(true);
  });
});
