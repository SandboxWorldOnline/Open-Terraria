// 武器域备案遗留 3 项修复回归（2026-08-23，标杆 Terarria1457）：
//   ① 箭袋 additive stack 公式（Player.rangedDamageMult 'arrow' 分道）——
//      1457 Player.cs:3966 bowEffectiveDamage = (rangedDamage/rangedMultDamage
//      + arrowDamageAdditiveStack) × rangedMultDamage × arrowDamage。
//      旧码 (base + stack×arrowMult)×arrowMult 把 stack 段双乘 arrowMult
//      （= ×arrowMult²），gear>1 时 stack 项偏离登记债。
//   ② channel 魔力花 QuickMana 支（Player.checkMana manaFlower 分支）——
//      1457 Player.cs:53226-53239：蓝不足 && manaFlower && !blockQuickMana →
//      QuickMana()（:5590）自动喝蓝后重估。channel 续发每拍
//      ItemCheck_TryStartUse :52660-52690 → ItemCheck_ActuallyPayMana :53277 →
//      CheckMana 直通本端口。
//   ③ items.ts 键名卫生——vi_ 键后缀张冠李戴改正（vid 不动），稳定 id/存档链
//      只认 vi_<id>_ 前缀（items.ts 尾 ITEM_STABLE_OF_INTERNAL 段），零存档风险。
import { describe, it, expect } from 'vitest';
import { Player } from '../src/entities/Player';
import { BuffType } from '../src/stats/Buffs';
import { Inventory } from '../src/items/Inventory';
import {
  ITEM_BY_KEY, ITEM_DEFS, ITEM_STABLE_OF_INTERNAL,
} from '../src/data/items';
import { LEGACY_KEY_OF_INTERNAL_V3 } from '../src/data/itemMigration';

/** vid → 内部 id：按 vi_<vid>_ 键前缀反查（vi_ def 的 vid 字段多为缺省,键前缀即权威） */
const _iid = (vid: number): number => {
  const k = Object.keys(ITEM_BY_KEY).find((key) => key.startsWith(`vi_${vid}_`));
  return k !== undefined ? ITEM_BY_KEY[k] : -1;
};
/** 键 → vid（vi_<vid>_ 前缀解析,与稳定 id 表/Lang 显示名同一权威） */
const vidOfKey = (key: string): number => {
  const m = /^vi_(\d+)_/.exec(key);
  return m ? Number(m[1]) : -1;
};
const mkPlayer = () => new Player(0, 0, new Inventory());

// ---------------------------------------------------------------------------
// ① 箭袋 additive stack 公式（bowEffectiveDamage :3966）
// ---------------------------------------------------------------------------
describe('① 箭袋 stack 公式（:3966 (R/M + stack)×M×arrowDamage）', () => {
  // 装备：射手纹章 491（dmgRanged +0.15）+ 魔法箭袋 1321（arrowDmg +0.1，
  // :15448-15451 arrowDamageAdditiveStack += 0.1f）→ base=1.15 / stack=0.1
  const mkArcher = (): Player => {
    const p = mkPlayer();
    p.inv.armor[3] = { id: _iid(491), stack: 1 };
    p.inv.armor[4] = { id: _iid(1321), stack: 1 };
    return p;
  };

  it('gear(1.15) + 箭袋 stack(0.1) + Archery(1.1)：stack 只乘 arrowDamage 一次 = 1.375', () => {
    const p = mkArcher();
    p.buffs.apply(BuffType.Archery, 60);
    expect(p.damageMult('ranged')).toBeCloseTo(1.15, 6);
    expect(p.equipStats.arrowStack).toBeCloseTo(0.1, 6);
    // :3966 (1.15/1 + 0.1) × 1 × 1.1 = 1.375（旧双乘码 = (1.15+0.11)×1.1 = 1.386）
    expect(p.rangedDamageMult('arrow')).toBeCloseTo(1.375, 6);
    expect(p.rangedDamageMult('arrow')).not.toBeCloseTo(1.386, 3);   // 旧码值不复现
  });

  it('蘑菇矿箭头 1546：arrowDamage = 1.1×1.12（:10107/:13799），stack 段同规', () => {
    const p = mkArcher();
    p.inv.armor[0] = { id: _iid(1546), stack: 1 };
    p.buffs.apply(BuffType.Archery, 60);
    // (1.15 + 0.1) × 1.232 = 1.54（无套装三件 → stealthBonus=1）
    expect(p.rangedDamageMult('arrow')).toBeCloseTo(1.54, 6);
  });

  it('枯萎武器 196：rangedMultDamage=0.5（:26233）——stack 段随 M 减半,R/M 还原加算链', () => {
    const p = mkArcher();
    p.buffs.apply(BuffType.Archery, 60);
    p.buffs.apply(BuffType.WitheredWeapon, 60);
    // 原式：rangedDamage=1.15×0.5=0.575、M=0.5 → (0.575/0.5 + 0.1)×0.5×1.1 = 0.6875
    expect(p.rangedDamageMult('arrow')).toBeCloseTo(0.6875, 6);
  });

  it('弹/火箭分道不吃 stack（gunEffective :3968 / specialistEffective :3970 裸 rangedDamage）', () => {
    const p = mkArcher();
    p.buffs.apply(BuffType.Archery, 60);
    expect(p.rangedDamageMult('bullet')).toBeCloseTo(1.15, 6);
    expect(p.rangedDamageMult('rocket')).toBeCloseTo(1.15, 6);
    expect(p.rangedDamageMult('other')).toBeCloseTo(1.15, 6);
  });
});

// ---------------------------------------------------------------------------
// ② channel 魔力花 QuickMana 支（CheckMana :53216-53253 manaFlower 分支 :53226-53239）
// ---------------------------------------------------------------------------
describe('② checkMana 魔力花 QuickMana 支（:53226-53239）', () => {
  const mkFlower = (): Player => {
    const p = mkPlayer();
    p.inv.armor[3] = { id: _iid(555), stack: 1 };   // Mana Flower 555（:14512 侧 manaFlower=true）
    expect(p.equipStats.manaFlower).toBe(true);
    return p;
  };

  it('蓝不足 + 魔力花 → QuickMana 自动喝蓝后扣魔成功（:53228 → :53231-53236）', () => {
    const p = mkFlower();
    p.mana = 5;
    let drank = 0;
    p.quickManaHook = () => { drank++; p.mana = 100; };   // QuickMana() 桩：喝蓝回 100
    expect(p.checkMana(20)).toBe(true);
    expect(drank).toBe(1);
    expect(p.mana).toBe(80);                              // 100 − 20（:53233-53235 if (pay) 扣魔）
    expect(p.slowMagicUse).toBe(false);                   // 成功支不置蓝空标记
  });

  it('无魔力花 → 不触钩,空蓝照放 + slowMagicUse（ManaV2 :53252-53256,2026-08-22 语义不回归）', () => {
    const p = mkPlayer();
    p.mana = 5;
    let drank = 0;
    p.quickManaHook = () => { drank++; };
    expect(p.checkMana(20)).toBe(true);
    expect(drank).toBe(0);
    // ★R24 翻案（2026-10-31 红蓝定谳,三轮连环错判终结）：不足支 statMana=0
    //  （:53254）——五百五十五刀（f2f38e02）错锚 :5878（QuickBuff 有卫门扣减）
    //  改扣量直落可负=G38-A 前判沿 BJ738 D6 误改 toBe(-15),R24 定谳真回归,
    //  src 已回原版语义（Player.ts R24 节）。断言回 toBe(0)。
    expect(p.mana).toBe(0);                               // :53254 statMana = 0
    expect(p.slowMagicUse).toBe(true);                    // DoRunOutOfManaEffect :53258-53261
  });

  it('魔力花 + blockQuickMana=true → 跳过 QuickMana 支（:53226 !blockQuickMana 门）', () => {
    const p = mkFlower();
    p.mana = 5;
    let drank = 0;
    p.quickManaHook = () => { drank++; };
    expect(p.checkMana(20, true)).toBe(true);
    expect(drank).toBe(0);
    expect(p.mana).toBe(0);                               // :53243 魔力花支同归 0（R24）
    expect(p.slowMagicUse).toBe(true);
  });

  it('魔力花 + 喝蓝仍不足 → 继续走空蓝支（:53237-53239 仍不足不再二次喝）', () => {
    const p = mkFlower();
    p.mana = 5;
    let drank = 0;
    p.quickManaHook = () => { drank++; };                 // 背包无蓝药：喝不动
    expect(p.checkMana(20)).toBe(true);
    expect(drank).toBe(1);
    expect(p.mana).toBe(0);                               // :53243 魔力花支 0（R24）
    expect(p.slowMagicUse).toBe(true);
  });

  it('蓝足直扣：不触钩（:53219-53223 首分支先行）', () => {
    const p = mkFlower();
    p.mana = 50;
    let drank = 0;
    p.quickManaHook = () => { drank++; };
    expect(p.checkMana(20)).toBe(true);
    expect(drank).toBe(0);
    expect(p.mana).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// ③ items.ts 键名卫生（vid 不动;稳定 id/存档链只认 vi_<id>_ 前缀）
// ---------------------------------------------------------------------------
describe('③ vi_ 键名卫生（1457 ItemID.cs 对账 + 官方 zh-Hans 译名）', () => {
  const vidOf = vidOfKey;

  it('11 键改名后 vid 不变（:1624/:1634/:1640/:1736/:1738/:1740/:1742/:1744/:1786/:2014/:2102）', () => {
    const want: Array<[string, number, number]> = [
      // [新键, vid, 1457 ItemID.cs 行号锚]
      ['vi_39_木弓', 39, 1624],        // WoodenBow（曾误名"泥灰墙"）
      ['vi_44_恶魔弓', 44, 1634],      // DemonBow（曾误名"彩虹砖墙"）
      ['vi_47_邪箭', 47, 1640],        // UnholyArrow（曾误名"铂金砖墙"）
      ['vi_95_燧发枪', 95, 1736],      // FlintlockPistol（曾误名"地牢砖墙"）
      ['vi_96_火枪', 96, 1738],        // Musket（曾误名"地牢砖墙"）
      ['vi_97_火枪子弹', 97, 1740],    // MusketBall（曾误名"地牢砖墙"）
      ['vi_98_迷你鲨', 98, 1742],      // Minishark（曾误名"地牢砖墙"）
      ['vi_99_铁弓', 99, 1744],        // IronBow（曾误名"地牢砖墙"）
      ['vi_120_熔火之怒', 120, 1786],  // MoltenFury（曾误名"1952"垃圾段）
      ['vi_234_流星弹', 234, 2014],    // MeteorShot（曾误名"4052"垃圾段）
      ['vi_278_银子弹', 278, 2102],    // SilverBullet（曾误名"4515"垃圾段）
    ];
    for (const [key, vid] of want) expect(vidOf(key), key).toBe(vid);
  });

  it('旧误名键全部退场（无残留双注册）', () => {
    for (const old of [
      'vi_39_泥灰墙', 'vi_44_彩虹砖墙', 'vi_47_铂金砖墙', 'vi_95_地牢砖墙',
      'vi_96_地牢砖墙', 'vi_97_地牢砖墙', 'vi_98_地牢砖墙', 'vi_99_地牢砖墙',
      'vi_120_1952', 'vi_234_4052', 'vi_278_4515',
    ]) {
      expect(ITEM_BY_KEY[old], old).toBeUndefined();
    }
  });

  it('存档链零风险：稳定 id = vid（vi_<id>_ 前缀派生,items.ts 尾表）', () => {
    for (const key of ['vi_39_木弓', 'vi_97_火枪子弹', 'vi_120_熔火之怒', 'vi_278_银子弹']) {
      const internal = ITEM_BY_KEY[key];
      expect(ITEM_STABLE_OF_INTERNAL[internal], key).toBe(vidOfKey(key));
    }
  });

  it('v3 裸下标冻结快照（legacyItemIndex.generated.json）从不含旧键——改后缀不破坏旧档解码', () => {
    for (const old of ['vi_97_地牢砖墙', 'vi_120_1952', 'vi_39_泥灰墙']) {
      expect(LEGACY_KEY_OF_INTERNAL_V3).not.toContain(old);
    }
  });
});
