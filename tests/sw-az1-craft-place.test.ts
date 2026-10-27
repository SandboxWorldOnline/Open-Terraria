// SW-AZ1 2026-09-06 制作/放置域备案项清偿守卫
//
// 原版权威（Terarria1457；1458 diff 本域零变更——Recipe/Chest/NearbyChests/CraftingRequests
// 四文件行数全同 + CraftFromNearbyChests 三消费点同位）：
//   CraftingRequests.CraftItem              CraftingRequests.cs:88-110 —— qty 循环、i>0 每轮
//                                           重查 CollectedEnoughItemsToCraft；i==0 无门（:93）
//   Recipe.SubtractOwnedItem                Recipe.cs:259-265 —— 账面按 req.stack【未折扣面】
//                                           递减（Max(...,0)）；仅入列材料递减（折扣归零
//                                           不入列 GetIngredientsForOneCraft :206-208）
//   Player.Settings.CraftFromNearbyChests   Player.cs:355 默认 true；作用域只包住
//                                           Recipe.cs:386-397（③bank 盒/弹体 + ④世界箱），
//                                           ①开箱容器 :378-381 / ②虚空袋 :382-385 在外
//   NearbyChests.GetBanksInRangeOf 弹体段   NearbyChests.cs:44-58 —— 弹体先于 tile 段；
//                                           射程盒 = tile 段同款 num=39 的 79×79
//   Projectile.TryGetContainerIndex         Projectile.cs:80559-80568 —— 525/960→-2=bank、
//                                           734→-5=bank4；ContainerIndexToPlayerBank
//                                           NearbyChests.cs:119-130 case -5 背包持 5325 → 不计
//   PickItemSelectionOverride               Player.cs:17526-17548 —— mouseItem 非空 → 伪选中 58
//   dropItemCheck                           Player.cs:5122 inventory[58]=mouseItem.Clone()；
//                                           :5139-5154 右键释放臂=丢出 DropSelectedItem(58)
//   CanChangeSelectedItemImmediately        Player.cs:415-421 —— !UsingOrReusingItem && ItemTimeIsZero
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  craftSourcesFor, consumeMaterials, collectOwnedItems, craftableCount,
  VANILLA_RECIPES, RECIPE_GROUPS, invIndexOfVanilla, CRAFT_CHEST_RANGE_PX,
  type CraftItemSource,
} from '../src/data/vanillaRecipes';
import type { ChestData } from '../src/world/World';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { TILE_BY_KEY } from '../src/data/tiles';
import { ITEM_DEFS, VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { rollablePrefixes } from '../src/data/vanillaPrefixes';   // ★SW-BM1 逐件 roll 行为面
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// ★C档可移植:l10n 源目录(仓库外 tools/l10n-custom,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['tools/l10n-custom'].every((d) => fs.existsSync(new URL(`../../${d}`, import.meta.url)));


const woodIid = invIndexOfVanilla(9);
const gelIid = invIndexOfVanilla(23);
const torch = VANILLA_RECIPES.find((r) => r.create === 8)!;                 // 1木+1凝胶
const workbench = VANILLA_RECIPES.find((r) => r.create === 36 && r.tile === -1)!; // 木×10
const WOOD_GID = 1000000 + RECIPE_GROUPS['Wood'];

const chest = (x: number, y: number, items: ChestData['items'] = [], extra: Partial<ChestData> = {}): ChestData =>
  ({ x, y, items, ...extra });

const src = (p: string): string =>
  fs.readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

afterEach(() => { vi.restoreAllMocks(); });

// ==================== R3：Shift 批量合成部分量（CraftItem :88-110） ====================
describe.skipIf(EXT_MISSING)('SW-AZ1 R3 批量合成部分量语义', () => {
  it('料够 3 造 3：times=10 → 返 3、材料扣净（旧两阶段全量校验=不够 10 造 0）', () => {
    const inv = new Inventory();
    inv.slots[10] = { id: woodIid, stack: 30 };
    inv.slots[11] = { id: gelIid, stack: 3 };   // 凝胶 3 = 瓶颈 → 恰 3 轮
    const crafted = consumeMaterials(inv, torch, 10, false);
    expect(crafted).toBe(3);
    expect(inv.countOf(woodIid)).toBe(27);      // 木只扣 3（跟凝胶同尽）
    expect(inv.countOf(gelIid)).toBe(0);
  });

  it('零蒸发不变量保持（R14-B2）：料够 5 times=3 → 3 轮精确扣减,无过扣', () => {
    const inv = new Inventory();
    inv.slots[10] = { id: woodIid, stack: 5 };
    inv.slots[11] = { id: gelIid, stack: 5 };
    expect(consumeMaterials(inv, torch, 3, false)).toBe(3);
    expect(inv.countOf(woodIid)).toBe(2);
    expect(inv.countOf(gelIid)).toBe(2);
  });

  it('全源不足且首轮即缺 → 返 0、零扣减（i==0 也过实际校验,R14-B2 守卫不回退）', () => {
    const inv = new Inventory();
    inv.slots[10] = { id: woodIid, stack: 4 };  // 工作台需 10
    expect(consumeMaterials(inv, workbench, 10, false)).toBe(0);
    expect(inv.countOf(woodIid)).toBe(4);
  });

  it('★SW-RB5a 纠注:账面=折扣后实扣面（SubtractOwnedItem 消费 GetIngredientsForOneCraft 折扣副本,RequiredItemEntry=struct）——全折扣轮不入列账面不动', () => {
    const alch = VANILLA_RECIPES.find((r) => r.alchemy && r.items.length === 1
      && !r.groups.length)!;
    const req = alch.items[0];
    const iid = invIndexOfVanilla(req.id);
    const inv = new Inventory();
    inv.slots[10] = { id: iid, stack: req.stack * 3 };   // 恰够 3 轮全价
    // random<1/3 恒真 → 每材料全额折扣 → need=0（不入列 :206-208）→ 账面不递减
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const crafted = consumeMaterials(inv, alch, 10, true);
    expect(crafted).toBe(10);          // 无材料消耗 → i>0 账面门不拦（账面未动）
    expect(inv.countOf(iid)).toBe(req.stack * 3);   // 零消耗
  });

  // ★SW-RB5a 2026-09-07 部分折扣回归：药瓶 28（瓶5×1+凝胶23×2+蘑菇31×2）。
  // 每轮凝胶/蘑菇各折 1（掷序 [0.9,0.2,0.9,0.2,0.9] → 瓶0/凝胶1/蘑菇1）→
  // 每轮实扣 1/1/1。vanilla 账面按实扣面递减 → 凝胶账面 8−k,门≥2 续到 k=7 造 7;
  // 旧实现按未折扣面递减 → 8−2k,造 3（折扣省料被账面吞=少造）
  it('★SW-RB5a 部分折扣省料留账面续命迭代（炼金台,CraftingRequests.GetIngredientsForOneCraft struct 拷贝链）', () => {
    const alch = VANILLA_RECIPES.find((r) => r.create === 28)!;
    expect(alch.alchemy).toBe(true);
    const bottleIid = invIndexOfVanilla(5);
    const gelIid2 = invIndexOfVanilla(23);
    const mushIid = invIndexOfVanilla(31);
    const inv = new Inventory();
    inv.slots[10] = { id: bottleIid, stack: 10 };
    inv.slots[11] = { id: gelIid2, stack: 8 };
    inv.slots[12] = { id: mushIid, stack: 8 };
    const orig = Math.random;
    const queue = [0.9, 0.2, 0.9, 0.2, 0.9];   // 每轮 5 掷:瓶 0 折/凝胶 1 折/蘑菇 1 折
    let qi = 0;
    Math.random = () => queue[qi++ % queue.length]!;
    try {
      const crafted = consumeMaterials(inv, alch, 10, true);
      expect(crafted).toBe(7);
      expect(inv.countOf(bottleIid)).toBe(3);   // 每轮实扣 1 × 7 轮
      expect(inv.countOf(gelIid2)).toBe(1);
      expect(inv.countOf(mushIid)).toBe(1);
    } finally {
      Math.random = orig;
      qi = 0;
    }
  });

  it('炼金账面两本账：无折扣时料够 3 造 3（实扣=全价,账面同速递减）', () => {
    const alch = VANILLA_RECIPES.find((r) => r.alchemy && r.items.length === 1
      && !r.groups.length)!;
    const req = alch.items[0];
    const iid = invIndexOfVanilla(req.id);
    const inv = new Inventory();
    inv.slots[10] = { id: iid, stack: req.stack * 3 };
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // ≥1/3 → 永不折扣
    expect(consumeMaterials(inv, alch, 10, true)).toBe(3);   // 账面 3 轮即尽
    expect(inv.countOf(iid)).toBe(0);
  });

  it('掷流序（B9 备案更新）：掷次数 = 实际合成轮数 × 材料数 × stack（部分量停产不烧未发生迭代的掷）', () => {
    const alch = VANILLA_RECIPES.find((r) => r.alchemy && r.items.length === 1
      && !r.groups.length)!;
    const req = alch.items[0];
    const iid = invIndexOfVanilla(req.id);
    const inv = new Inventory();
    inv.slots[10] = { id: iid, stack: req.stack * 3 };   // 恰 3 轮
    // ★赋值式拦截（不用 vi.spyOn——并行套件对 Math.random 的全局赋值/还原会让
    // spy 脱钩,组合运行时计数失真;赋值+手动还原与本仓 ghost-place-swap 同法）
    const orig = Math.random;
    let rolls = 0;
    Math.random = () => { rolls++; return 0.99; };   // ≥1/3 → 永不折扣
    try {
      const crafted = consumeMaterials(inv, alch, 10, true);
      expect(crafted).toBe(3);
      // 按实际轮数掷：3 轮 × 1 材料 × stack 次（旧实现预掷满 times=10 轮）
      expect(rolls).toBe(3 * req.stack);
    } finally {
      Math.random = orig;
    }
  });
});

// ==================== item4：CraftFromNearbyChests 开关作用域 ====================
describe.skipIf(EXT_MISSING)('SW-AZ1 item4 CraftFromNearbyChests 作用域（Recipe.cs:375-407）', () => {
  it('false = ③④旁路：附近世界箱与 bank tile 不计;①开箱容器照常入列', () => {
    const st = new TileStore(300, 300);
    st.setTile(100, 100, TILE_BY_KEY['v_29_piggy_bank']);
    const near = chest(10, 0, [{ id: woodIid, stack: 7 }]);
    const openPanel = { x: -1, y: 0, items: [{ id: woodIid, stack: 5 }] };
    const banks = [{ items: [{ id: woodIid, stack: 40 } as never] }] as unknown as
      ReadonlyArray<CraftItemSource | null | undefined>;
    const srcOff = craftSourcesFor([near], 0, 0, {
      openChest: openPanel, store: st, centerTileX: 100, centerTileY: 100, banks,
      nearbyChestsEnabled: false,
    });
    expect(srcOff.map((s) => s.items)).toEqual([openPanel.items]);   // 只有①
    const srcOn = craftSourcesFor([near], 0, 0, {
      openChest: openPanel, store: st, centerTileX: 100, centerTileY: 100, banks,
    });
    expect(srcOn.length).toBeGreaterThan(1);          // 开+bank+箱
    expect(srcOn.some((s) => s.items === near.items)).toBe(true);
  });

  it('false 时②虚空袋 bank4 不受开关管（Recipe.cs:382 在 if 体外）', () => {
    const near = chest(10, 0, [{ id: woodIid, stack: 7 }]);
    const bag = [{ id: woodIid, stack: 2 } as never];
    const banks = [null, null, null, { items: bag }] as unknown as
      ReadonlyArray<CraftItemSource | null | undefined>;
    const srcOff = craftSourcesFor([near], 0, 0, {
      voidBagHeld: true, banks, nearbyChestsEnabled: false,
    });
    expect(srcOff.map((s) => s.items)).toEqual([bag]);   // ②在,④（near）不在
  });

  it('缺省（未传键）= 原版默认开（Player.cs:355 true）', () => {
    const near = chest(10, 0, [{ id: woodIid, stack: 7 }]);
    expect(craftSourcesFor([near], 0, 0).some((s) => s.items === near.items)).toBe(true);
  });
});

// ==================== item5：弹体容器支（GetBanksInRangeOf 弹体段） ====================
describe.skipIf(EXT_MISSING)('SW-AZ1 item5 弹体容器 bank 支', () => {
  const banksOf = (items: unknown) => [{ items }] as unknown as
    ReadonlyArray<CraftItemSource | null | undefined>;

  it('projectileBanks 入列且与 tile/虚空袋支按 items 身份去重（Contains :388 同义）', () => {
    const st = new TileStore(300, 300);
    st.setTile(100, 100, TILE_BY_KEY['v_29_piggy_bank']);   // 放置存钱罐（同 bank 数组）
    const bankArr = [{ id: woodIid, stack: 40 } as never];
    const banks = banksOf(bankArr);
    const petBank = (banks[0] as CraftItemSource);           // Game 侧传同一包装
    const s = craftSourcesFor([], 0, 0, {
      store: st, centerTileX: 100, centerTileY: 100, banks,
      projectileBanks: [petBank],
    });
    expect(s.filter((x) => x.items === bankArr).length).toBe(1);   // 弹体+tile 同 bank 只计一次
    const owned = collectOwnedItems(new Inventory(), s);
    expect(owned.get(9)).toBe(40);                   // 双计则 80（白嫖窗口指纹）
  });

  it('受 nearbyChestsEnabled 管辖（③族,Recipe.cs:386 if 体内）', () => {
    const bankArr = [{ id: woodIid, stack: 40 } as never];
    const banks = banksOf(bankArr);
    const s = craftSourcesFor([], 0, 0, {
      banks, projectileBanks: [banks[0] as CraftItemSource], nearbyChestsEnabled: false,
    });
    expect(s.length).toBe(0);
  });
});

// ==================== item1：光标持物镜像槽 58 ====================
describe.skipIf(EXT_MISSING)('SW-AZ1 item1 光标持物镜像槽（Inventory 层）', () => {
  it('heldItem() 伪选中：镜像非空即 HeldItem（PickItemSelectionOverride :17528-17532）', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: woodIid, stack: 9 };
    expect(inv.heldItem()).toBe(inv.slots[0]);
    const cur = { id: gelIid, stack: 5 };
    inv.cursorMirror = cur;
    expect(inv.heldItem()).toBe(cur);              // 光标物压过热栏选中（HeldItem=inventory[58]）
    inv.cursorMirror = null;
    expect(inv.heldItem()).toBe(inv.slots[0]);     // 耗尽/失选 → 回热栏（:524 空镜像回热栏支）
  });

  it('removeHeld 镜像臂：扣光标物不扣真槽（消费点 :43659 mouseItem 同步支同语义）', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: woodIid, stack: 9 };
    const cur = { id: gelIid, stack: 5 };
    inv.cursorMirror = cur;
    expect(inv.removeHeld(2)).toBe(true);
    expect(cur.stack).toBe(3);                     // 直写共享对象 = 回写 UI 光标物
    expect(inv.slots[0]).toEqual({ id: woodIid, stack: 9 });   // 真槽分毫不动
    expect(inv.removeHeld(3)).toBe(true);
    expect(cur.stack).toBe(0);                     // 归零由 Game.syncCursorMirror 清 UI 光标
    expect(inv.removeHeld(1)).toBe(false);         // 镜像不足 → 拒扣（不过扣）
  });

  it('镜像未激活：removeHeld 退化 removeAt(selected)（56 处旧消费点零行为漂移）', () => {
    const inv = new Inventory();
    inv.slots[3] = { id: woodIid, stack: 2 };
    inv.selected = 3;
    expect(inv.removeHeld(1)).toBe(true);
    expect(inv.slots[3]).toEqual({ id: woodIid, stack: 1 });
    inv.cursorMirror = { id: gelIid, stack: 1 };
    expect(inv.removeHeld(1)).toBe(true);
    expect(inv.slots[3]).toEqual({ id: woodIid, stack: 1 });   // 镜像激活时不误扣真槽
  });

  it('镜像不入材料聚合（CollectItems Recipe.cs:418-433 槽帽 58=0-57）', () => {
    const inv = new Inventory();
    inv.cursorMirror = { id: woodIid, stack: 99 };
    expect(collectOwnedItems(inv).get(9)).toBeUndefined();
  });
});

// ==================== 结构锁（源文本锚,防静默回退） ====================
describe.skipIf(EXT_MISSING)('SW-AZ1 结构锁', () => {
  const game = src('../src/core/Game.ts');
  const ui = src('../src/ui/UI.ts');
  const inv = src('../src/items/Inventory.ts');
  const recipes = src('../src/data/vanillaRecipes.ts');
  const optionsTs = src('../src/core/Options.ts');

  it('Game.updateUse 门：镜像激活∧非右键才放行（其余光标持物态维持拦截）', () => {
    expect(game).toMatch(/cursorHeld && \(!this\.player\.inv\.cursorMirror \|\| inp\.rightDown\)/);
    // 同步/结算挂点：智能选取之前同步（PickItemSelectionOverride 先于 SmartSelectLookup），
    // updateUse 之后结算
    expect(game).toMatch(/this\.syncCursorMirror\(\);[\s\S]{0,200}this\.updateSmartSelect\(\);/);
    // ★X2 窗口重锚（2026-10-01）:{0,200}→{0,400}——HEAD 9c545615 落 _afkKiteForceUse
    //  旗尾清（★Q4 刀）插行+注于 updateUse 与 commitCursorMirror 之间( gap 200→343),
    //  结算序不变量完好;窗口放宽保序锁判别力（commitCursorMirror 前移仍必红）
    expect(game).toMatch(/this\.updateUse\(dt\);[\s\S]{0,400}this\.commitCursorMirror\(\);/);
    // CanChangeSelectedItemImmediately 门（:415-421）三臂——★BJ536（2026-10-06）收单
    //  canChangeSelectionNow() 单源（换入 set 臂 + 耗尽还原 sticky 臂共用门;表达式
    //  三臂逐字保留在 helper 内,判别力不减）
    expect(game).toMatch(/private canChangeSelectionNow\(\): boolean \{\s*\n\s*return !this\.usingOrReusingItem\(\) && !this\._dirtRodChannel && this\.player\.useTime === 0;/);
    expect(game).toMatch(/this\.canChangeSelectionNow\(\)\) return;/);
  });

  it('Game 手持消耗统一入口：56 处消费点全走 removeHeld,无 removeAt(selected) 残留', () => {
    // ★2026-09-08:56→57——SW-BN5 换墙批新增 ReplaceWall 消费位(Game.ts:21297,
    //  换墙消耗手持墙件=合法入账;行为面仍由"全走 removeHeld+无 removeAt 残留"两钉锁死)
    // ★RB17a-R7（2026-09-14）重锚:57→56——第 57 处（宝藏袋持用左键开包链 removeHeld）
    //  已随 commit 31604771「§五裁决:开包唯 ItemSlot 右键首支」整支摘除（自创消费面
    //  合法退役,非丢失扣减;HEAD~2=57→HEAD~=56 亲证）,锁数随实际消费位回落。
    // ★X2 重锚（2026-10-01）:56→57——commit bf69b208 风筝锚放置补扣位
    //  （TELeashedEntityAnchorWithItem.PlaceFromPlayerPlacementHook :46-48——
    //  consumable=false 风筝跳过通用消耗门,原版钩子补扣 1;旧注「与通用 removeAt
    //  等量,无需另扣」系误读=放置零消耗回收复制,用户实报根因修复）,合法入账。
    // ★BJ536 拍照重锚（2026-10-06）:57→58——并行会话在途批累计的第 58 处
    //  consumable 位（Game.ts 4544x 段,:11446/:38997 族）,BJ536 本刀零新增消费位
    //  （刀面=heldItem/syncCursorMirror/commitCursorMirror,逐字无 removeHeld 调用）,
    //  此处只把锁数对齐盘上实况拍照（防套件常红;归属批落定后可再精确归因）。
    // ★BJ600 重锚（2026-10-10）:58→59——tryPlace wand 分支 raw 路（1×1 族）补
    //  held 本体消耗位（原版 ItemCheck consumable 消耗拍 Player.cs:43612-43645;
    //  旧分支零消耗=书/珊瑚/贝壳/礼物/炸药/宝石白放复制链,与侏儒放置即掉落同支
    //  同根,合法入账）。
    // ★BJ644 拍照重锚（2026-10-12）:59→58——耍蛇笛 4262 旧实现误按消耗品删笛
    //  （4262 分支出手链 removeHeld(1) 消耗位）,BJ644 定谳非消耗品（SetDefaults
    //  Item.cs:36653-36664 无 consumable 行,ItemCheck_Shoot :48278-48334 消耗臂
    //  不适用）合法退役该消耗位（Game.ts 15602 段现无 removeHeld 调用）,锁数随
    //  实际消费位回落（az1 拍照重锚协议=BJ536 判例同式,非丢失扣减）。
    // ★BJ690 重锚（2026-10-16,commit 360836f8）:58→57——矿车升级包 5289 右键臂
    //  整撤（原版右键零使用面;使用域=左键 ItemCheck 1:1,消耗位在 case 5289 的
    //  consume() 助手 Game.ts:17340 存续,非丢失扣减）,判别锁=
    //  tests/bj690-minecart-upgrade-kit.test.ts ③。
    // ★BJ694 重锚（2026-10-19,commit 0a86175f）:57→56——可疑的眼球 43 右键臂
    //  整撤（原版使用域=左键 ItemCheck 左臂 :16776,消耗位 removeHeld(1) :16783
    //  在案;右键臂=重复使用面+格交互劫持+错域风筝成就钩三害,整支退役非丢失扣减）,
    //  判别锁=tests/bj694-registered-debts-batch2.test.ts §1。
    // ★计数口径（2026-10-19 清偿刀亲核备案）:本锁数=正则 inv\.removeHeld\(1\)
    //  字面调用次数;Game.ts 全文 removeHeld 字串 61 处=56 真调用+5 注释/文档提及
    //  （:6347/:14997/:15291/:28181/:35054,皆非调用面）。统一入口纪律判据=
    //  下两行 not 断言+加宽残留检测（removeAt(selected) 任意书写形态恒零）,锁数
    //  仅拍照对齐盘上实况。
    // ★BJ730 重锚（2026-10-27）:56→57——BJ704-G11（件2②）1338 爆炸兔手持直放特支
    //  （Player.cs:44400-44405 玩家位 Center.X/Bottom.Y 直放,Game.ts:16986 段
    //  p614.inv.removeHeld(1) 消耗位,标记+vanilla 锚在案;早支 return 无双消耗）。
    //  对拍证：dist-release 10-26 12:13 构建快照（无 git 仓唯一历史证人判例）包内
    //  removeHeld(1)=57 与盘上一致 → 57 站于 10-26 前落地（BJ694 锚 56=10-19,
    //  BJ704 波 10-20/21 落地窗口吻合）。拍照重锚协议=BJ536/BJ600/BJ644/BJ690/
    //  BJ694 判例同式。
    expect(game.match(/inv\.removeHeld\(1\)/g)?.length).toBe(57);
    expect(game).not.toContain('removeAt(this.player.inv.selected, 1)');
    expect(game).not.toContain('p.inv.removeAt(p.inv.selected, 1)');
    // ★SW-RB4a 2026-09-06 残留检测面加宽：任意书写形态的 removeAt(selected)/
    // slots[selected] 【写入】直读均视为镜像分裂面（合法消费=removeHeld;
    // 扫描位弹药/导线/油漆用显式槽号,不落此模式）。UI 的右键换型三函数
    //（swapVoidBagVisual/swapParkourBookVisual/swapFlaironForm）读 slots[selected]
    //  为已证不可达面（updateUse 光标持物右键全拦）——锁 src/player 与 src/net 面:
    expect(game).not.toMatch(/removeAt\(\s*(?:this\.)?(?:player\.)?inv\.selected\b/);
    expect(game).not.toMatch(/inv\.removeAt\(\s*inv\.selected\b/);
    // 光标物活对象注入 + 耗尽清端
    expect(game).toContain('uiHeldItemObj: ');
    expect(game).toContain('uiHeldItemClear: ');
  });

  it('UI：左键世界点击不再丢出（右键丢出臂保留）', () => {
    expect(ui).toMatch(/if \(e\.button === 0\) return;\s*\n\s*this\.throwHeldToWorld\(\);/);
    expect(ui).toContain('game.uiHeldItemObj = () => this.heldStack;');
    // ★SW-BJ92（2026-09-15 用户实报）勘误重钉：resolveDrop 面板外松手 = 物品留在光标,
    // 不再丢出——vanilla 左键无任何丢出臂（丢出唯一触发 = dropItemCheck Player.cs:5139
    // mouseRightRelease,即 mousedown 的 button2 臂）。旧锁「resolveDrop →
    // throwHeldToWorld」把右键臂误接到左键松手,与拾取拖放面互斥（拖到世界全程零放置
    // 且松手即丢=主诉「取物点世界不能放置」）。throwHeldToWorld 剩余调用面 =
    // 右键 mousedown 臂 + 触摸长按脉冲 uiTouchRightPulse + closeInventory 满包余量链外无。
    expect(ui).not.toMatch(/if \(!inPanel\) \{[^}]*throwHeldToWorld/);
    // 拖拽拾取沿补武世界左键电平（原版 ItemSlot 下帧拾取后 mouseLeft 电平驱动放置链;
    // 门 = 拾取成沿 heldStack 已置,防空拾取沿让热键物误发）
    expect(ui).toMatch(/this\.pickUp\(this\.dragFrom\.i, this\.dragFrom\.where\);[\s\S]{0,1400}inp\.mouseDown = true; inp\.mouseHeld = true;/);
  });

  it('vanillaCraft 数值契约（★SW-BM1 逐轮重构重钉）：每轮扣一轮料/每轮词缀 roll/双门逐轮', () => {
    // 逐轮循环：每轮 consumeMaterials(times=1)（校验不过返 0 = 零扣,R14-B2 单点保持）
    expect(game).toMatch(/consumeMaterials\(this\.player\.inv, r, 1, this\._alchemyTable, this\._craftSourcesCache\(\)\) <= 0\) break;/);
    expect(game).not.toMatch(/r\.createStack \* times/);
    // 每轮 CreateResult 词缀 roll（CreateResult CRQ57:122-131 `stack<=1 → Prefix(-1)`）
    // ★BJ394（2026-09-28）：迁移后钉 rollNaturalPrefixForVid（Item.cs:523-556 自然掷
    // 全链+TryGet 四门）;旧 rollPrefix(pool,false) 无四门已退役（重铸 -2 面除外）
    expect(game).toMatch(/r\.createStack <= 1 && pool && pool\.length\s*\n\s*\? \(rollNaturalPrefixForVid\(outVid0, isPrefixableAccessory\(outId\), Math\.random\) \|\| undefined\)/);
    // 双门逐轮：CollectedEnough（CraftingRequests.cs:102 前腿）+ CursorHasSpace（Main.cs:43032）
    expect(game).toMatch(/i > 0 && !collectedEnoughForCraft\(r, this\.player\.inv, this\._craftSourcesCache\(\)\)\) break;/);
    expect(game).toMatch(/toCursor && i > 0 && !this\.cursorCanTakeCraftResult\(r\)\) break;/);
  });

  it('craftSourcesFor：开关门与弹体支（③族序：弹体先于 tile 盒,受开关管辖）', () => {
    expect(recipes).toMatch(/if \(opts\.nearbyChestsEnabled !== false\) \{/);
    expect(recipes).toMatch(/if \(opts\.projectileBanks\) \{\s*\n\s*for \(const pb of opts\.projectileBanks\) push\(pb\);\s*\n\s*\}\s*\n\s*if \(opts\.store/);
    // consumeMaterials 数值契约 + 账面按折扣后实扣面递减、仅在入列材料上
    // （★SW-RB5a 2026-09-07 重钉：SubtractOwnedItem 消费 GetIngredientsForOneCraft
    //  的 struct 折扣副本——旧钉"- req.stack"未折扣面系误读,已纠）
    expect(recipes).toMatch(/ownedAcc\.set\(accKey, Math\.max\(\(ownedAcc\.get\(accKey\) \?\? 0\) - needOf\.get\(req\)!, 0\)\)/);
    expect(recipes).toMatch(/if \(needOf\.get\(req\)! > 0\) \{\s*\n\s*const accKey/);
  });

  it('Game.craftSources：弹体容器三型锚（525/960→bank、734→bank4+5325 门）与开关消费', () => {
    expect(game).toMatch(/e instanceof FlyingPiggyBank/);
    expect(game).toMatch(/this\.petFollower\.projId === 960/);
    expect(game).toMatch(/e instanceof VoidLensProj/);
    expect(game).toMatch(/!heldVids\.has\(5325\)/);
    expect(game).toMatch(/nearbyChestsEnabled: options\.data\.craftFromNearbyChests !== false/);
    expect(optionsTs).toMatch(/craftFromNearbyChests: true,\s*\/\/ ★SW-AZ1/);
  });

  it('Inventory：伪选中 heldItem 单点 + removeHeld 镜像臂（结构锚）', () => {
    // ★BJ536（2026-10-06）重锚：镜像 stack<=0 → null（inventory[58] 归零 air,
    //  Item.cs:386-395;耗尽粘滞窗不回落热栏镐——Player.cs:483-517 selected 粘 58）
    expect(inv).toMatch(/if \(m\) return m\.stack > 0 \? m : null;\s*\n\s*return this\.slots\[this\.selected\];/);
    expect(inv).toMatch(/removeHeld\(count = 1\): boolean \{/);
    expect(inv).toContain('cursorMirror: InvItem | null = null;');
  });

  it('Settings：开关行挂 game 组（文案键双语入包由 build-l10n 门保障）', () => {
    const settings = src('../src/ui/Settings.ts');
    expect(settings).toMatch(/Lang\.text\('Mods\.SandboxWorld\.Settings\.CraftFromNearbyChests'\)/);
    expect(settings).toMatch(/GameUI\.CraftFromNearbyChestsOn/);
    const zh = JSON.parse(src('../../tools/l10n-custom/zh-Hans.json')) as Record<string, Record<string, string>>;
    const en = JSON.parse(src('../../tools/l10n-custom/en-US.json')) as Record<string, Record<string, string>>;
    expect(zh.Mods['SandboxWorld.Settings.CraftFromNearbyChests']).toBe('从附近的箱子制作');
    expect(en.Mods['SandboxWorld.Settings.CraftFromNearbyChests']).toBe('Craft from nearby chests');
  });
});

// ==================== item1 行为面：光标持物 → tryPlace 消耗光标物（端到端） ====================
describe.skipIf(EXT_MISSING)('SW-AZ1 item1 行为面（Game 壳端到端）', () => {
  it('光标捏木材点世界 → 铺放且扣的是光标物 stack,热栏原物分毫不动（removeHeld 镜像臂）', () => {
    const iidOf = (vid: number): number => {
      const key = VANILLA_ITEM_KEY_BY_ID[vid];
      for (let i = 0; i < ITEM_DEFS.length; i++) if (ITEM_DEFS[i]?.key === key) return i;
      return -1;
    };
    // 场景 = ghost-place-swap『豁免面』同款（已致动草丛清格铺放——空格铺设链依赖
    // 未桩化的 Game 侧子系统,与本测面无关;此场景在既有套件中已证可铺）
    const w = new World(40, 40, 13, 'az1');
    const st = w.store;
    for (let x = 2; x < 38; x++) st.setTileSilent(x, 21, TILE_BY_KEY['stone']);
    st.setTileSilent(12, 20, TILE_BY_KEY['tallgrass']);
    st.setActuated(12, 20, true);
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
      tryPlace(tx: number, ty: number, def: (typeof ITEM_DEFS)[number]): void;
    };
    const inv = new Inventory();
    inv.slots[0] = { id: iidOf(3509), stack: 1 };        // 热栏原物（铜镐）
    const cursor = { id: iidOf(9), stack: 5 };           // 光标捏 5 木材
    inv.cursorMirror = cursor as never;                  // syncCursorMirror 激活态
    g.world = w;
    g.chunks = { markDirtyArea: () => {} };
    g.sfx = { play: () => {} };
    g.cb = { onInventoryChanged: () => {} };
    g.input = { rightDown: false };
    g.entities = { critters: [], enemies: [], npcs: [], projectiles: [] };
    g.critterVid = () => -1;
    g.spawnNpcByVanilla = () => null;
    g.spawnParticles = () => {};
    g.recLog = () => {};
    g.spawnDrop = () => {};
    g.hitTiles = { addDamage: () => 100, clear: () => {} };
    g.swingTileCutSet = new Set();
    g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
    // ★SW-BJ12 2026-09-07 重钉：BJ10 SmartCursorHelper.TileTargetDesired 门缺 stub
    g.smartCursor = { lockedContinuity: null, showing: false, x: 0, y: 0 };
    g.player = {
      cx: 10 * 16 + 8, cy: 19 * 16 + 8, x: 10 * 16 + 2, y: 19 * 16 - 6, w: 12, h: 28,
      facing: 1, useTime: 0, attackSpeedMult: 1,
      // ★BJ394 补桩：overlapsEntity→emptyTileEntitiesRect 玩家占位门读 isGhostPhase
      // （Game.ts 玩家门族,他套件同款桩）——本桩锁基态 false
      isGhostPhase: () => false,
      buffs: { has: () => false, wellFedTier: 0, hungerPickSpeed: 0 }, equipStats: {},
      // ★SW-FX44：SW-BJ59 后 Game.tryPlace 尾 useTime 走 paintTileSpeed→placeSpeedTileRaw
      // 委托面（Game:22294→Player:3213）——桩锁基态 1（Player.cs:2453 基 1f,无增益）
      placeSpeedTileRaw: () => 1,
      inv,
    };
    const woodDef = ITEM_DEFS[iidOf(9)];
    g.tryPlace(12, 20, woodDef);
    expect(st.type[st.idx(12, 20)]).toBe(TILE_BY_KEY[woodDef.tile ?? '']);   // 铺放成功
    expect(cursor.stack).toBe(4);                        // 扣的是光标物（removeHeld 镜像臂）
    expect(inv.slots[0]).toEqual({ id: iidOf(3509), stack: 1 }); // 热栏原物分毫不动
  });
});

// ==================== SW-RB4a 2026-09-06 红蓝对抗修复钉 ====================
describe.skipIf(EXT_MISSING)('SW-RB4a 修复钉', () => {
  const torchIid = invIndexOfVanilla(8);   // 火把（maxStack 999、无词缀域）
  const TORCH_MAX = ITEM_DEFS[torchIid]?.maxStack ?? 999;

  /** vanillaCraft 壳（Object.create 绕构造;_craftSourcesCache/uiHeldItemObj/cb 桩） */
  // ★SW-RB5a：cursorIn 带 prefix 位（grantToCursor 桩内 cursor.prefix 判等的类型面）
  function craftShell(cursorIn: { id: number; stack: number; prefix?: number } | null) {
    const inv = new Inventory();
    let cursor = cursorIn ? { ...cursorIn } : null;
    const granted: Array<[number, number]> = [];
    const drops: Array<[string, number]> = [];
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
      vanillaCraft(r: typeof torch, times?: number, toCursor?: boolean): void;
    };
    g.player = { inv };
    g._alchemyTable = false;
    g._craftSourcesCache = () => [];
    g.uiHeldItemObj = () => cursor;
    g.cb = {
      grantToCursor: (id: number, stack: number, prefix?: number): number => {
        granted.push([stack, id]);
        if (!cursor) {
          const put = Math.min(stack, TORCH_MAX);
          cursor = { id, stack: put, ...(prefix !== undefined ? { prefix } : {}) };
          return stack - put;
        }
        if (cursor.id === id && (cursor.prefix ?? 0) === (prefix ?? 0)) {
          const put = Math.min(TORCH_MAX - cursor.stack, stack);
          cursor.stack += put;
          return stack - put;
        }
        return stack;                       // 异型不可并 → 全余量
      },
      onInventoryChanged: () => {},
      onCraftCursorGlow: () => {},
    };
    g.sfx = { play: () => {} };
    g.spawnDrop = (_x: number, _y: number, key: string, n: number) => { drops.push([key, n]); return null; };
    g.prefetchPlaceableSheets = () => {};
    g.achievements = { notifyItemPickup: () => {}, notifyItemCraft: () => {} };
    return { g, inv, getCursor: () => cursor, granted, drops };
  }

  it('item5 点击门（Main.cs:43017 TryAllowingToCraftRecipe 桌面臂）：光标捏异型物点配方 = 整次点击无效,零扣减零成品', () => {
    const s = craftShell({ id: gelIid, stack: 1 });      // 光标捏凝胶（异型,不可并堆成品）
    s.inv.slots[10] = { id: woodIid, stack: 10 };
    s.inv.slots[11] = { id: gelIid, stack: 10 };
    (s.g as unknown as { vanillaCraft(r: unknown, t?: number, c?: boolean): void })
      .vanillaCraft(torch, 10, true);
    expect(s.inv.countOf(woodIid)).toBe(10);             // 材料分毫未扣
    expect(s.inv.countOf(gelIid)).toBe(10);
    expect(s.granted).toEqual([]);                       // 无成品授予（不落地不掉物）
    expect(s.drops).toEqual([]);                         // 无地面掉落（旧缺陷:成品 spawnDrop）
  });

  it('item5 同型无词缀有余位 → 放行；★SW-BM1 光标门逐轮生效（CursorHasSpaceToCraftRecipe）：光标收不下下一轮即停轮', () => {
    const s = craftShell({ id: torchIid, stack: TORCH_MAX - 4 });   // 光标捏 995 火把（同型无词缀）
    s.inv.slots[10] = { id: woodIid, stack: 30 };
    s.inv.slots[11] = { id: gelIid, stack: 30 };
    (s.g as unknown as { vanillaCraft(r: unknown, t?: number, c?: boolean): void })
      .vanillaCraft(torch, 10, true);                    // 请求 10 轮 × 3 火把（每轮耗 1木+1胶）
    // 原版逐轮门（CraftingRequests.cs:102 + Main.cs:43052 `stack+createStack<=maxStack`）：
    // 第 0 轮 995+3=998≤上限 放行 → 光标 998；第 1 轮门 998+3=1001>上限 拦停。
    // 旧行为（整批一次授予+溢出入包）= 满包边缘转化方向差（RB4a 债①）,已废
    expect(s.getCursor()!.stack).toBe(TORCH_MAX - 1);    // 光标 998（createStack=3）
    expect(s.inv.countOf(torchIid)).toBe(0);             // 不再溢出入包
    expect(s.drops).toEqual([]);
    expect(s.inv.countOf(woodIid)).toBe(29);             // 恰扣 1 轮材料（1木+1胶）
    expect(s.inv.countOf(gelIid)).toBe(29);
  });

  it('★SW-BM1 逐轮授予：光标空手 shift×N → 每轮授予一轮量直至光标满（Main.cs:43052 逐轮复核）', () => {
    const s = craftShell(null);                          // 光标空手
    s.inv.slots[10] = { id: woodIid, stack: 4000 };
    s.inv.slots[11] = { id: gelIid, stack: 4000 };
    const rounds = Math.floor(TORCH_MAX / 3);            // 光标可整纳的轮数（3k ≤ maxStack）
    (s.g as unknown as { vanillaCraft(r: unknown, t?: number, c?: boolean): void })
      .vanillaCraft(torch, rounds + 10, true);           // 请求超额轮数 → 门拦停
    // 光标空手进第 0 轮 → 逐轮并堆至 3×rounds → 下一轮门 3×rounds+3 > 上限 拦停
    expect(s.getCursor()!.stack).toBe(rounds * 3);
    expect(s.inv.countOf(woodIid)).toBe(4000 - rounds);  // 每轮恰扣 1木+1胶
    expect(s.inv.countOf(gelIid)).toBe(4000 - rounds);
    expect(s.drops).toEqual([]);
  });

  it('item1 SmartSelect 短路（PickItemSelectionOverride Player.cs:17528-17532 先于 SmartSelectLookup）：mouseItemHeld=true 时 selected 不被改写', async () => {
    const { SmartSelect } = await import('../src/player/SmartSelect');
    const ss = new SmartSelect();
    let changed = 0;
    const host = {
      canChangeImmediately: true,
      selected: 3,
      hotbar: 0,
      isSlotEmpty: () => false,
      onSelectionChanged: () => { changed++; },
    };
    const env = {
      controlTorch: true, usingGamepad: false,
      st: new TileStore(4, 4), mouseX: 0, mouseY: 0, screenTopY: 0, screenHeight: 100,
      player: { x: 0, y: 0, w: 12, h: 28, gravDir: 1, wet: false },
      slots: [], selectedItem: 3,
      mouseItemHeld: true,                              // 光标持物伪选中在显
      inRange: () => false,
    };
    ss.update(env as never, host as never);
    expect(host.selected).toBe(3);                       // 原版 lookup 不被咨询,选中保持
    expect(changed).toBe(0);
  });

  it('item1 鞭回声扫描窗（Player.cs:43055 selectedItem+1..49）——镜像鞭同鞭回声（源文本锁）', () => {
    const whipSrc = src('../src/entities/WhipProj.ts');
    expect(whipSrc).toMatch(/owner\.inv\.cursorMirror \? 50 : owner\.inv\.selected \+ 1/);
  });

  it('★SW-BM1 逐件词缀 roll（CreateResult CRQ57:126-133 每轮 Prefix(-1)）：词缀域单件产出 crafted=3 → roll 3 次（旧实现 crafted===1 整批一次=0 次）', () => {
    // 词缀域单件产出配方（createStack===1 且词缀池非空）——直接扫配方表取首个满足者
    // （vanillaCraft 不复核环境站点,材料按表给足即可）
    const craftable = VANILLA_RECIPES.find((r) => r.createStack === 1
      && r.items.length === 1 && r.groups.length === 0
      && (() => {
        const vid = r.create;
        const pool = rollablePrefixes(vid, false);
        return !!pool && pool.length > 0;
      })());
    expect(craftable).toBeTruthy();
    const matIid = invIndexOfVanilla(craftable!.items[0]!.id);
    const s = craftShell(null);
    s.inv.slots[10] = { id: matIid, stack: craftable!.items[0]!.stack * 3 };
    const rngSpy = vi.spyOn(Math, 'random');
    (s.g as unknown as { vanillaCraft(r: unknown, t?: number, c?: boolean): void })
      .vanillaCraft(craftable!, 3, false);               // 3 轮 × 1 件直入背包（maxStack1 件的
    expect(rngSpy.mock.calls.length).toBeGreaterThanOrEqual(3);   // toCursor 面被光标门拦停=原版同构;
    rngSpy.mockRestore();                                // 背包面逐件 roll,旧 crafted===1 门=整批 0 次）
  });

  it('★SW-BM1 CollectedEnough 前置门空轮不烧掷（CraftingRequests.cs:102 门先于 GetIngredientsForOneCraft）', () => {
    const s = craftShell(null);
    s.inv.slots[10] = { id: woodIid, stack: 4 };         // 火把 1木+1胶 → 凝胶 0 = 第 1 轮后即尽
    s.inv.slots[11] = { id: gelIid, stack: 1 };
    const rngSpy = vi.spyOn(Math, 'random');
    (s.g as unknown as { vanillaCraft(r: unknown, t?: number, c?: boolean): void })
      .vanillaCraft(torch, 10, false);                   // 实合 1 轮,停轮
    const burns = rngSpy.mock.calls.length;             // _alchemyTable=false → 折扣掷 0 次
    expect(burns).toBe(0);                               // 非炼金配方停轮零掷(门在掷前)
    rngSpy.mockRestore();
  });
});
