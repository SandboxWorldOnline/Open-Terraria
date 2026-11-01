// 时装（vanity）装备链回归——"时装穿不上"修复（2026-08-14）
// 根因:swapEquipItem 无 ArmorSwap :3289 vanity 路由,纯社交配饰(acc=0)右键
// 撞 armorAccepts 功能槽 acc!==1 门直接被拒;vanity 盔甲则错误进功能段。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Inventory } from '../src/items/Inventory';
import { ITEM_DEFS, ITEM_BY_KEY } from '../src/data/items';
import { vanillaStatOfVid } from '../src/data/vanillaItemStats';

const internalOf = (key: string) => ITEM_DEFS.findIndex((d) => d?.key === key);

describe('vanity 数据（van 标记）', () => {
  it('269 FamiliarShirt = vanity 盔甲(bs=0+van)；268 潜水头盔 = 功能盔甲(无 van)', () => {
    expect(vanillaStatOfVid(269)).toMatchObject({ s: 'b', van: 1 });
    const st268 = vanillaStatOfVid(268)!;
    expect(st268.van).toBeUndefined();
  });
  it('1987 AngelHalo = 社交配饰(acc=0+van)；54 HermesBoots = 功能配饰(acc=1 无 van)', () => {
    expect(vanillaStatOfVid(1987)).toMatchObject({ acc: 0, van: 1 });
    const st54 = vanillaStatOfVid(54)!;
    expect(st54.acc).toBe(1);
    expect(st54.van).toBeUndefined();
  });
  it('提取覆盖面：stats 表 van=1 共 552 条（含 Boss 面具范围块;1 缺=非装备）', () => {
    const t = JSON.parse(readFileSync('src/data/vanilla-itemstats.json', 'utf8')) as Record<string, { van?: number }>;
    const vanCount = Object.values(t).filter((e) => e.van === 1).length;
    // ★BJ744 改判史：BJ740 ACC16 补 helper 内置 vanity 位 120 键（音乐盒101/变声15/
    //  巨柱4——DefaultToMusicBox 等 Item.cs:48625-48655 内置,case 块扫描天然漏）→
    //  432→552。
    expect(vanCount).toBe(552);   // 420 case（token 级:落空标签组全体+嵌套 switch 命中分支,
    //  2026-08-19 patch-vanity-stats 修;旧逐行扫描漏 DD2 面具 3863/3864、嵌套 5-tab 26 处
    //  与 3730/5104/5105 落空组）+ 10 Boss 面具范围块 + 3372/3373 算式 headSlot（2026-08-19
    //  表达式槽位提取入表）;1 缺 = 856 无槽位
  });
});

describe('armorAccepts 槽位门（社交/功能）', () => {
  it('双旗配饰（acc=0,原版 accessory+vanity）两段都收（★清偿刀 R4 翻案：旧断言"功能槽拒 acc=0"=Q3 登记偏差本体）', () => {
    const inv = new Inventory();
    const halo = internalOf('vi_1987_AngelHalo');
    const boots = internalOf('vi_54_hermes_boots');
    // ★R4 定谳（2026-09-30）：原版类门唯 `checkItem.accessory`（ItemSlot.cs:1444,
    //   功能/社交两支共用,无 vanity 排除臂）;1987 天使光环 Item.cs case 1987 =
    //   accessory=true+vanity=true+hasVanityEffects=true 双旗 → 功能槽照收。
    //   旧断言 armorAccepts(3, halo)=false 编码的正是 Q3 登记的装备面 parity 偏差。
    expect(inv.armorAccepts(3, halo)).toBe(true);       // 功能槽收双旗（:1444）
    expect(inv.armorAccepts(13, halo)).toBe(true);      // 社交槽收 acc=0
    expect(inv.armorAccepts(3, boots)).toBe(true);      // 功能槽收 acc=1
    expect(inv.armorAccepts(13, boots)).toBe(true);     // 社交槽也收功能配饰
  });
  it('vanity 盔甲可进功能槽（原版允许,仅无属性）与社交槽', () => {
    const inv = new Inventory();
    const shirt = internalOf('vi_269_FamiliarShirt');
    expect(inv.armorAccepts(1, shirt)).toBe(true);      // 功能胸甲位
    expect(inv.armorAccepts(11, shirt)).toBe(true);     // 社交胸甲位
    expect(inv.armorAccepts(0, shirt)).toBe(false);     // 头位不收
  });
  it('同款互斥:功能与社交不可同穿（HasSameItemInSlot 对段）', () => {
    const inv = new Inventory();
    const boots = internalOf('vi_54_hermes_boots');
    inv.armor[3] = { id: boots, stack: 1 };
    expect(inv.armorAccepts(13, boots)).toBe(false);    // 对段同 type 拒
  });
});

describe('Boss 面具范围块（2104-2113,2026-08-14 补提）', () => {
  it('2112 EyeMask = vanity 头盔 hs=154;整族 s=h+van 入表', () => {
    expect(vanillaStatOfVid(2112)).toMatchObject({ s: 'h', hs: 154, van: 1 });
    expect(vanillaStatOfVid(2104)).toMatchObject({ s: 'h', hs: 146, van: 1 });
    expect(vanillaStatOfVid(2113)).toMatchObject({ s: 'h', hs: 155, van: 1 });
  });
});
