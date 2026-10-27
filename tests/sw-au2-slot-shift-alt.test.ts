// SW-AU2 2026-09-06 —— Alt/Shift/Ctrl+左键 槽位交互全链 1:1 回归（用户实报
// "alt/shift+左键好像功能有问题"）。原版权威 Terarria1457/Terraria.UI/ItemSlot.cs
// （1458 本域 diff 为空）：
//   · GetAlternateClickAction :601-700  路由（收藏互斥 :604 / Ctrl Quick Trash :609 /
//     Shift 快移 :616 / 各语境去向 :626-698）
//   · OverrideLeftClick :702-843        执行（cursorOverride 6/7/8/9/10）
//   · 静态语境表 :316-429               canFavoriteAt/canLoadoutShareAt/retain...At
//   · Options :28-30                    缺省 = "Quick Trash: Left Control"（menu[224]）
//   · OverrideHover :571-599            Alt(FavoriteKey=LeftAlt Main.cs:67607) 优先级
//   · Main.cs:41746/:42474/:42492/:42161/:42202/:42230/:44374 各槽 context 分配
// 分层钉法：SlotActions.ts 纯路由矩阵 + UI.ts 方法体（Object.create(UI.prototype)
// 绕 DOM 构造，同 tests/chest-lootall-vault-spill.test.ts 车道）+ 源文本接线面。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UI } from '../src/ui/UI';
import { Inventory, canFillEmptyAmmoSlot } from '../src/items/Inventory';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_DEFS } from '../src/data/items';
import { options } from '../src/core/Options';
import {
  slotContext, planAlternateClick, chestCanTakeJustCheck, canTakeToPersonalInventory,
  CAN_FAVORITE_AT, CAN_LOADOUT_SHARE_AT, CAN_SHARE_AT, RETAIN_FAVORITE_ON_MOVE_AT,
} from '../src/ui/SlotActions';

const iidOf = (vid: number): number => {
  const id = ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]];
  if (!ITEM_DEFS[id]) throw new Error(`测试钉死前提失效：vid ${vid} 未注册`);
  return id;
};
const WOOD = iidOf(9);            // 木（可并堆）
const COPPER_COIN = iidOf(71);    // 铜币（GetSellOrTrash 店开豁免 :192-195）
const WOOD_MAX = ITEM_DEFS[WOOD].maxStack ?? 999;

type Slot = { id: number; stack: number; prefix?: number; favorited?: boolean; placeStyle?: number } | null;

const srcMatch = (re: RegExp, file = '../src/ui/UI.ts'): boolean =>
  re.test(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'));

/** 绕 DOM constructor 铺 UI 方法引用面（slotContent/equipArray 走原型，其余手铺） */
function fakeUI(opts: { shopOpen?: boolean; chestItems?: Slot[] } = {}) {
  const inv = new Inventory();
  const plays: string[] = [];
  const files: string[] = [];
  const picks: number[] = [];
  const sold: number[] = [];
  let refreshes = 0;
  const fake = Object.create(UI.prototype) as unknown as {
    openChest: { x: number; y: number; items: Slot[] } | null;
    game: Record<string, unknown>;
    refreshAll(): void;
    altSlotClick(i: number, where: string, panelOpen: boolean): boolean;
    altMoveClick(i: number, where: string, shift: boolean, ctrl: boolean, panelOpen: boolean): boolean;
    pickUp(i: number, where: string): void;
    placeHeld(i: number, where: string): void;
    placeTrash(): void;
    heldStack: Slot;
    heldFrom: string | null;
  };
  fake.openChest = opts.chestItems ? { x: 0, y: 0, items: opts.chestItems } : null;
  fake.game = {
    player: { inv },
    npcShopOpen: !!opts.shopOpen,
    npcShopSell: (i: number) => { sold.push(i); return true; },
    sfx: { play: (n: string) => { plays.push(n); }, playFiles: (arr: string[]) => { files.push(...arr); } },
    achievements: { notifyItemPickup: (v: number) => { picks.push(v); } },
    chatInput: null,   // isOpen 面无输入态 → Alt 恒走收藏/共享支
  };
  fake.refreshAll = () => { refreshes++; };
  fake.heldStack = null;
  fake.heldFrom = null;
  return { fake, inv, plays, files, picks, sold, refreshed: () => refreshes };
}

let hintWas: boolean;
beforeEach(() => { hintWas = options.data.showLoadoutShareHint; options.data.showLoadoutShareHint = false; });
afterEach(() => { options.data.showLoadoutShareHint = hintWas; });

// ---------------------------------------------------------------------------
// ① 语境映射（Main.cs 各绘制点 context 分配）
// ---------------------------------------------------------------------------
describe('① SW 槽位面 → 原版 ItemSlot context（Main.cs 绘制点）', () => {
  it('背包 0-49=0（:41746）/ 钱币 50-53=1（:42474）/ 弹药 54-57=2（:42492）', () => {
    expect(slotContext('inv', 0, true)).toBe(0);
    expect(slotContext('inv', 49, true)).toBe(0);
    expect(slotContext('inv', 50, true)).toBe(1);
    expect(slotContext('inv', 53, true)).toBe(1);
    expect(slotContext('inv', 54, true)).toBe(2);
    expect(slotContext('inv', 57, true)).toBe(2);
  });
  it('关包快捷栏 = context 13（Main.cs:44374 只 Draw 不 Handle → 无 Alt/Shift 语义）', () => {
    expect(slotContext('inv', 0, false)).toBe(13);
    expect(slotContext('inv', 9, false)).toBe(13);
    expect(slotContext('inv', 10, false)).toBe(0);   // 面板关也只影响快捷栏行
  });
  it('装备/染料/杂项（:42161 context2 8|10、:42202 context3 9|11、:42230 dye 12）', () => {
    expect(slotContext('armor', 0, true)).toBe(8);   // 功能盔甲
    expect(slotContext('armor', 2, true)).toBe(8);
    expect(slotContext('armor', 3, true)).toBe(10);  // 功能配饰
    expect(slotContext('armor', 9, true)).toBe(10);
    expect(slotContext('armor', 10, true)).toBe(9);  // 时装盔甲
    expect(slotContext('armor', 13, true)).toBe(11); // 时装配饰
    expect(slotContext('armor', 19, true)).toBe(11);
    expect(slotContext('dye', 0, true)).toBe(12);
    expect(slotContext('chest', 3, true)).toBe(3);
  });
  it('静态表逐值（ItemSlot.cs:358-371 canFavorite/canLoadoutShare/retainFavorite）', () => {
    expect([...CAN_FAVORITE_AT].sort((a, b) => a - b)).toEqual([0, 1, 2, 32]);
    expect([...CAN_LOADOUT_SHARE_AT].sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12]);
    expect([...RETAIN_FAVORITE_ON_MOVE_AT].sort((a, b) => a - b)).toEqual([0, 1, 2, 5, 32]);
    expect(CAN_SHARE_AT).not.toContain(13);          // 关包快捷栏不可聊天分享
    expect(CAN_SHARE_AT).not.toContain(21);          // 光标物不在分享域（:372-408 无 21）
  });
});

// ---------------------------------------------------------------------------
// ② Shift/Ctrl 路由矩阵（GetAlternateClickAction :601-700，缺省 Options :28-30）
// ---------------------------------------------------------------------------
describe('② planAlternateClick：Shift 快移路由矩阵（桌面缺省=Quick Trash: Left Control）', () => {
  const env = (over: Partial<Parameters<typeof planAlternateClick>[0]>) => ({
    context: 0, itemAir: false, favorited: false, isCoin: false,
    shopOpen: false, chestOpen: false, chestCanTake: false, canTakeToInventory: true,
    controlDown: false, shiftDown: true, ...over,
  });

  it('收藏互斥总闸 :604：收藏物/空格恒 null（点击回落普通拾取面）', () => {
    expect(planAlternateClick(env({ favorited: true, chestOpen: true, chestCanTake: true }))).toBeNull();
    expect(planAlternateClick(env({ itemAir: true, shopOpen: true }))).toBeNull();
    expect(planAlternateClick(env({ favorited: true, controlDown: true, shopOpen: true }))).toBeNull();
  });

  it('context 0/1/2：开箱可入 → toChest(9)；塞不下 → null；无箱无店 → null（不丢垃圾桶！）', () => {
    expect(planAlternateClick(env({ chestOpen: true, chestCanTake: true })))
      .toEqual({ kind: 'toChest', cursorOverride: 9 });
    expect(planAlternateClick(env({ chestOpen: true, chestCanTake: false }))).toBeNull();
    expect(planAlternateClick(env({}))).toBeNull();                       // 缺省档无去处=无动作
    expect(planAlternateClick(env({ context: 1 }))).toBeNull();
    expect(planAlternateClick(env({ context: 2 }))).toBeNull();
  });

  it('context 0/1/2 关店面：用户改"Quick Trash: Left Shift"档才走 GetSellOrTrash（:659）', () => {
    expect(planAlternateClick(env({ opts: { disableLeftShiftTrashCan: false, disableQuickTrash: false } })))
      .toEqual({ kind: 'trash', cursorOverride: 6 });
    // 店开 + Left Shift 档：卖出（钱币豁免 :192-195）
    expect(planAlternateClick(env({ shopOpen: true, opts: { disableLeftShiftTrashCan: false, disableQuickTrash: false } })))
      .toEqual({ kind: 'sell', cursorOverride: 10 });
    expect(planAlternateClick(env({ shopOpen: true, isCoin: true, opts: { disableLeftShiftTrashCan: false, disableQuickTrash: false } }))).toBeNull();
  });

  it('context 3/4/32（箱/银行/虚空袋）→ fromChest(8)，背包收不下 → null（:664-671）', () => {
    expect(planAlternateClick(env({ context: 3 }))).toEqual({ kind: 'fromChest', cursorOverride: 8 });
    expect(planAlternateClick(env({ context: 4 }))).toEqual({ kind: 'fromChest', cursorOverride: 8 });
    expect(planAlternateClick(env({ context: 32 }))).toEqual({ kind: 'fromChest', cursorOverride: 8 });
    expect(planAlternateClick(env({ context: 3, canTakeToInventory: false }))).toBeNull();
  });

  it('装备/时装/配饰/染料/杂项（8-12/16-20/33）→ unequip(7)（:672-687）', () => {
    for (const context of [8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 33]) {
      expect(planAlternateClick(env({ context }))).toEqual({ kind: 'unequip', cursorOverride: 7 });
      expect(planAlternateClick(env({ context, canTakeToInventory: false }))).toBeNull();
    }
  });

  it('垃圾桶/重铸/向导/旅程复制（5/6/7/29）→ toBackpack(7)（:688-696）', () => {
    for (const context of [5, 6, 7]) {
      expect(planAlternateClick(env({ context }))).toEqual({ kind: 'toBackpack', cursorOverride: 7 });
    }
    expect(planAlternateClick(env({ context: 29 }))).toEqual({ kind: 'creativeDupe', cursorOverride: 7 });
  });

  it('关包快捷栏 context 13：Shift/Ctrl 全域外 → null（Main.cs:44374 无 Handle）', () => {
    expect(planAlternateClick(env({ context: 13 }))).toBeNull();
    expect(planAlternateClick(env({ context: 13, controlDown: true, shiftDown: false }))).toBeNull();
  });
});

describe('②' + " planAlternateClick：Ctrl Quick Trash 分支（:609-615）", () => {
  const env = (over: Partial<Parameters<typeof planAlternateClick>[0]>) => ({
    context: 0, itemAir: false, favorited: false, isCoin: false,
    shopOpen: false, chestOpen: false, chestCanTake: false, canTakeToInventory: true,
    controlDown: true, shiftDown: false, ...over,
  });
  it('店关 → trash(6)；店开 → sell(10)；钱币店开 → null（GetSellOrTrash :186-197）', () => {
    expect(planAlternateClick(env({}))).toEqual({ kind: 'trash', cursorOverride: 6 });
    expect(planAlternateClick(env({ shopOpen: true }))).toEqual({ kind: 'sell', cursorOverride: 10 });
    expect(planAlternateClick(env({ shopOpen: true, isCoin: true }))).toBeNull();
  });
  it('域 = 0-4/7/32（:611 无符号技巧）；装备/垃圾桶格 Ctrl 不在域 → null', () => {
    expect(planAlternateClick(env({ context: 4 }))).toEqual({ kind: 'trash', cursorOverride: 6 });
    expect(planAlternateClick(env({ context: 7 }))).toEqual({ kind: 'trash', cursorOverride: 6 });
    expect(planAlternateClick(env({ context: 32 }))).toEqual({ kind: 'trash', cursorOverride: 6 });
    expect(planAlternateClick(env({ context: 8 }))).toBeNull();
    expect(planAlternateClick(env({ context: 6 }))).toBeNull();
    expect(planAlternateClick(env({ context: 13 }))).toBeNull();
  });
  it('Ctrl 优先于 Shift（:609 if 先于 :616 else-if）；双修饰同按走 Ctrl 面', () => {
    expect(planAlternateClick(env({ shiftDown: true, context: 8 }))).toBeNull();
    expect(planAlternateClick(env({ shiftDown: true }))).toEqual({ kind: 'trash', cursorOverride: 6 });
  });
});

// ---------------------------------------------------------------------------
// ③ 可移入面纯函数（ChestUI.TryPlacingInChest justCheck / Player.ItemSpace）
// ---------------------------------------------------------------------------
describe('③ chestCanTakeJustCheck（ChestUI.cs:1205-1284 justCheck 面）', () => {
  it('同型余位 / 空格 / 全拒三路', () => {
    expect(chestCanTakeJustCheck([{ id: WOOD, stack: 300 }], WOOD, WOOD_MAX)).toBe(true);
    expect(chestCanTakeJustCheck([null], WOOD, WOOD_MAX)).toBe(true);
    expect(chestCanTakeJustCheck([{ id: iidOf(2), stack: 50 }], WOOD, WOOD_MAX)).toBe(false);
    // 唯一件物（maxStack=1）不吃合并面，只吃空格面（:1217 `item.maxStack > 1` 门）
    expect(chestCanTakeJustCheck([{ id: WOOD, stack: 1 }], WOOD, 1)).toBe(false);
    expect(chestCanTakeJustCheck([null], WOOD, 1)).toBe(true);
  });
});

describe('③ canTakeToPersonalInventory（Player.cs:39463-39507 ItemSpace 等价）', () => {
  const slots = (n: number): Slot[] => Array.from({ length: n }, () => null);
  it('空格/同型余位/全满三路；钱币域 0-53（num=54 :39474-39476）', () => {
    const inv = new Inventory();
    inv.slots[10] = { id: WOOD, stack: WOOD_MAX };
    expect(canTakeToPersonalInventory(inv.slots, WOOD, WOOD_MAX, false, false)).toBe(true);  // 空格
    const full = Object.assign(new Inventory(), { slots: [...Array(58)].map(() => ({ id: WOOD, stack: WOOD_MAX } as Slot)) });
    expect(canTakeToPersonalInventory(full.slots, WOOD, WOOD_MAX, false, false)).toBe(false);
    expect(canTakeToPersonalInventory(full.slots, WOOD, WOOD_MAX, true, false)).toBe(false); // 币域含钱格仍全满
    expect(slots(58).length).toBe(58);
  });
  it('弹药族追加 54-57 面（:39485-39501）；非弹药面不扫 54-57（★SW-BM1 空弹药格臂重钉：canFillEmpty 随行）', () => {
    const ammo = iidOf(97);   // 木箭
    const inv = new Inventory();
    inv.slots[0] = { id: WOOD, stack: WOOD_MAX };
    expect(canTakeToPersonalInventory(inv.slots, ammo, 999, false, true, undefined, canFillEmptyAmmoSlot(ammo))).toBe(true);        // 弹药栏空
    const DIRT = iidOf(2);
    const DIRT_MAX = ITEM_DEFS[DIRT].maxStack;
    const packed = Object.assign(new Inventory(), { slots: [...Array(58)].map(() => ({ id: DIRT, stack: DIRT_MAX } as Slot)) });
    expect(canTakeToPersonalInventory(packed.slots, ammo, 999, false, true, undefined, canFillEmptyAmmoSlot(ammo))).toBe(false);    // 54-57 亦占 → 全拒
    packed.slots[54] = null;
    expect(canTakeToPersonalInventory(packed.slots, ammo, 999, false, true, undefined, canFillEmptyAmmoSlot(ammo))).toBe(true);     // 空弹药格 + CanFillEmptyAmmoSlot → 可收
    packed.slots[54] = { id: DIRT, stack: 1 };                                               // 非同型不满堆 ≠ 可并
    expect(canTakeToPersonalInventory(packed.slots, ammo, 999, false, true, undefined, canFillEmptyAmmoSlot(ammo))).toBe(false);
    expect(canTakeToPersonalInventory(packed.slots, ammo, 999, false, false, undefined, canFillEmptyAmmoSlot(ammo))).toBe(false);   // 非弹药域不扫 54-57
  });
});

// ---------------------------------------------------------------------------
// ④ UI 方法体：Shift 快移执行面
// ---------------------------------------------------------------------------
describe('④ UI.altMoveClick：开箱双向快移（ItemSlot.cs:785-821 + :772-784）', () => {
  it('背包→箱：先并同型余堆（:1219-1256），余量克隆进首空格（:1258-1283），入箱清收藏', () => {
    const { fake, inv, plays } = fakeUI({ chestItems: [{ id: WOOD, stack: WOOD_MAX - 99 }, null] });
    inv.slots[10] = { id: WOOD, stack: 500, favorited: true };   // 收藏物不可快移——先证互斥
    expect(fake.altMoveClick(10, 'inv', true, false, true)).toBe(false);   // :604 恒 null
    inv.slots[10] = { id: WOOD, stack: 500 };
    expect(fake.altMoveClick(10, 'inv', true, false, true)).toBe(true);
    const chest = fake.openChest!;
    expect(chest.items[0]!.stack).toBe(WOOD_MAX);                // 并堆面：9900+99
    expect(chest.items[1]).toEqual({ id: WOOD, stack: 401, favorited: false });  // 余量 401 入空格
    expect(chest.items[1]!.favorited).toBe(false);
    expect(inv.slots[10]).toBeNull();
    expect(plays).toContain('pickup');                           // SoundID 7（:1237/:1272）
  });

  it('箱→背包：整堆入包（GetItem QuickTransferFromSlot 语义），残量留箱', () => {
    const { fake, inv, picks } = fakeUI({ chestItems: [{ id: WOOD, stack: 700 }] });
    expect(fake.altMoveClick(0, 'chest', true, false, true)).toBe(true);
    expect(fake.openChest!.items[0]).toBeNull();
    expect(inv.slots.filter((s) => s && s.id === WOOD).reduce((a, s) => a + s!.stack, 0)).toBe(700);
    expect(picks).toContain(9);                                  // NotifyItemPickup case-0 语义
  });

  it('箱→背包背包满：残量写回箱格（:772-784 inv[slot]=GetItem 返回值）', () => {
    const { fake, inv } = fakeUI({ chestItems: [{ id: WOOD, stack: 15000 }] });
    const DIRT = iidOf(2);
    const DIRT_MAX = ITEM_DEFS[DIRT].maxStack;
    for (let i = 0; i < 58; i++) inv.slots[i] = { id: DIRT, stack: DIRT_MAX };  // 全满异型
    expect(fake.altMoveClick(0, 'chest', true, false, true)).toBe(false);       // ItemSpace 拒 → null
    expect(fake.openChest!.items[0]!.stack).toBe(15000);                         // 原地保留
    for (let i = 1; i < 58; i++) inv.slots[i] = { id: DIRT, stack: DIRT_MAX };  // 仅槽 0 = 木 500
    inv.slots[0] = { id: WOOD, stack: 500 };                                     // 木 9499 余位 < 15000
    expect(fake.altMoveClick(0, 'chest', true, false, true)).toBe(true);
    expect(fake.openChest!.items[0]!.stack).toBe(15000 - (WOOD_MAX - 500));      // 残量写回箱
  });
});

describe('④ UI.altMoveClick：装备槽卸下（:749-771 cursorOverride 7）', () => {
  it('装备→背包整堆 + 残量写回槽位（旧实现漏写=复制 bug 的回归钉）', () => {
    const { fake, inv, plays } = fakeUI();
    inv.armor[3] = { id: WOOD, stack: 500 };
    expect(fake.altMoveClick(3, 'armor', true, false, true)).toBe(true);
    expect(inv.armor[3]).toBeNull();
    expect(inv.countOf(WOOD)).toBe(500);
    expect(plays).toContain('menuTick');                         // :769 SoundID 12
    // 残量支：背包预置 999-500 余位 → 卸下 500 只落 499，槽内留 1
    inv.armor[3] = { id: WOOD, stack: 500 };
    inv.slots.forEach((s, i2) => { if (s?.id === WOOD) inv.slots[i2]!.stack = WOOD_MAX; });
    // 制造满包：全背包塞满木 → 卸下应全拒并保留槽内整叠（canTakeToInventory=false → null）
    for (let i = 0; i < 58; i++) inv.slots[i] = { id: WOOD, stack: WOOD_MAX };
    const packed = inv.countOf(WOOD);   // ★SW-RB1 2026-09-06 恒真断言重钉（旧 `before >= 0 ? countOf : 0` 自比恒真）
    expect(fake.altMoveClick(3, 'armor', true, false, true)).toBe(false);
    expect(inv.armor[3]!.stack).toBe(500);
    expect(inv.countOf(WOOD)).toBe(packed);   // 无复制：满包基数不增
  });

  it('收藏装备件禁卸下（:604）——Alt 收藏的共享件不会被 Shift 扫出装备栏', () => {
    const { fake } = fakeUI();
    (fake.game.player as { inv: Inventory }).inv.armor[0] = { id: WOOD, stack: 1, favorited: true };
    expect(fake.altMoveClick(0, 'armor', true, false, true)).toBe(false);
    expect((fake.game.player as { inv: Inventory }).inv.armor[0]).not.toBeNull();
  });
});

describe('④ UI.altMoveClick：Ctrl Quick Trash / 卖出（:731-748 / :823-841）', () => {
  it('Ctrl+左键背包格 = 丢垃圾桶（TrashItem+Grab 双音，覆盖旧桶）', () => {
    const { fake, inv, files, plays } = fakeUI();
    inv.slots[5] = { id: WOOD, stack: 3 };
    inv.trash = { id: iidOf(2), stack: 1 };
    expect(fake.altMoveClick(5, 'inv', false, true, true)).toBe(true);
    expect(inv.slots[5]).toBeNull();
    expect(inv.trash).toEqual({ id: WOOD, stack: 3, favorited: false });   // context 6 清收藏（:362-366）
    expect(files).toContain('trash_item_0');
    expect(plays).toContain('pickup');
  });

  it('Ctrl+左键箱格 = 桶收箱内物（context 3 ∈ Quick Trash 域 :611）', () => {
    const { fake, inv } = fakeUI({ chestItems: [{ id: WOOD, stack: 9 }, null] });
    expect(fake.altMoveClick(0, 'chest', false, true, true)).toBe(true);
    expect(fake.openChest!.items[0]).toBeNull();
    expect(inv.trash).toEqual({ id: WOOD, stack: 9, favorited: false });
  });

  it('商店开着 Ctrl = 卖出且恒消费（:840-841）；钱币 Ctrl 店开 = 不卖不扔', () => {
    const { fake, sold, inv } = fakeUI({ shopOpen: true });
    inv.slots[7] = { id: WOOD, stack: 1 };
    expect(fake.altMoveClick(7, 'inv', false, true, true)).toBe(true);
    expect(sold).toEqual([7]);
    const coin = fakeUI({ shopOpen: true });
    (coin.fake.game.player as { inv: Inventory }).inv.slots[50] = { id: COPPER_COIN, stack: 5 };
    expect(coin.fake.altMoveClick(50, 'inv', false, true, true)).toBe(false);   // :192-195
    expect(coin.sold).toEqual([]);
  });

  it('缺省档 Shift 无箱无店无动作 → 回落普通点击（用户实报主根因：不再误丢垃圾桶）', () => {
    const { fake, inv, files } = fakeUI();
    inv.slots[12] = { id: WOOD, stack: 1 };
    expect(fake.altMoveClick(12, 'inv', true, false, true)).toBe(false);
    expect(inv.slots[12]).not.toBeNull();        // 留在格内（后续走拾取面）
    expect(inv.trash).toBeNull();
    expect(files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⑤ UI.altSlotClick：Alt 收藏 / 配装共享 / 聊天分享
// ---------------------------------------------------------------------------
describe('⑤ Alt+左键收藏切换（ToggleFavorited :845-849）', () => {
  it('背包/钱币/弹药格往返 + SoundID 12；装备语境走共享开关；misc 落空', () => {
    const { fake, inv, plays } = fakeUI();
    inv.slots[10] = { id: WOOD, stack: 1 };
    expect(fake.altSlotClick(10, 'inv', true)).toBe(true);
    expect(inv.slots[10]!.favorited).toBe(true);
    expect(plays).toContain('menuTick');
    expect(fake.altSlotClick(10, 'inv', true)).toBe(true);
    expect(inv.slots[10]!.favorited).toBe(false);            // 往返
    inv.slots[50] = { id: COPPER_COIN, stack: 1 };           // 钱币格 = context 1 ∈ canFavoriteAt
    expect(fake.altSlotClick(50, 'inv', true)).toBe(true);
    expect(inv.slots[50]!.favorited).toBe(true);
    inv.miscEquips[0] = { id: WOOD, stack: 1 };              // misc = context 16 域外
    const playsBefore = plays.length;
    expect(fake.altSlotClick(0, 'misc', true)).toBe(false);
    expect(inv.miscEquips[0]!.favorited ?? false).toBe(false);
    expect(plays.length).toBe(playsBefore);
  });

  it('关包快捷栏（context 13）Alt 不收藏——落空走选中面（Main.cs:44357-44359 changeItem）', () => {
    const { fake, inv } = fakeUI();
    inv.slots[3] = { id: WOOD, stack: 1 };
    expect(fake.altSlotClick(3, 'inv', false)).toBe(false);
    expect(inv.slots[3]!.favorited ?? false).toBe(false);
    expect(fake.altSlotClick(3, 'inv', true)).toBe(true);    // 面板开 = context 0 可收藏
    expect(inv.slots[3]!.favorited).toBe(true);
  });

  it('装备/染料格 = ToggleLoadoutShare（:851-861）+ ClearSlotShareInOtherLoadouts（:863-884）', () => {
    const { fake, inv } = fakeUI();
    inv.armor[3] = { id: WOOD, stack: 1 };
    inv.loadouts[1].armor[3] = { id: WOOD, stack: 1, favorited: true };
    inv.loadouts[2].armor[3] = { id: WOOD, stack: 1, favorited: true };
    expect(fake.altSlotClick(3, 'armor', true)).toBe(true);
    expect(inv.armor[3]!.favorited).toBe(true);
    expect(inv.loadouts[1].armor[3]!.favorited).toBe(false);   // 同槽仅一套可共享
    expect(inv.loadouts[2].armor[3]!.favorited).toBe(false);
    expect(fake.altSlotClick(3, 'armor', true)).toBe(true);
    expect(inv.armor[3]!.favorited).toBe(false);               // 往返
  });

  it('空格 Alt 无动作（:577 IsAir 早退）→ 回落普通点击', () => {
    const { fake } = fakeUI();
    expect(fake.altSlotClick(20, 'inv', true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 收藏标记保留域（retainFavoriteOnMoveAt :362-366 + MouseItemSwap :1227-1235）
// ---------------------------------------------------------------------------
describe('⑥ 收藏标记随移动的清/保面', () => {
  it('背包内拾取保留收藏（context 0 ∈ 表）；装备面拾取清标记（context 8 ∉ 表）', () => {
    const { fake } = fakeUI();
    fake.pickUp = (UI.prototype as unknown as { pickUp: unknown }).pickUp as typeof fake.pickUp;
    const inv = (fake.game.player as { inv: Inventory }).inv;
    inv.slots[10] = { id: WOOD, stack: 1, favorited: true };
    fake.pickUp.call(fake, 10, 'inv');
    expect(fake.heldStack!.favorited).toBe(true);
    fake.heldStack = null;                           // 归零光标，避免走同型并堆路径
    inv.armor[0] = { id: WOOD, stack: 1, favorited: true };
    fake.pickUp.call(fake, 0, 'armor');
    expect(fake.heldStack!.favorited).toBe(false);   // 共享状态终结（GetEffectiveArmor 只认收藏件）
  });

  it('拖拽入箱清收藏；箱中件（存档导入面）到光标同清', () => {
    const { fake } = fakeUI({ chestItems: [{ id: WOOD, stack: 2, favorited: true }] });
    fake.placeHeld = (UI.prototype as unknown as { placeHeld: unknown }).placeHeld as typeof fake.placeHeld;
    fake.heldStack = { id: WOOD, stack: 1, favorited: true };
    fake.placeHeld.call(fake, 1, 'chest');
    expect(fake.openChest!.items[1]).toEqual({ id: WOOD, stack: 1, favorited: false });
    fake.heldStack = { id: iidOf(2), stack: 1 };     // 异型 → 交换路径
    fake.placeHeld.call(fake, 0, 'chest');
    expect(fake.heldStack!.favorited).toBe(false);   // 箱内收藏件回光标即失标记
    expect(fake.openChest!.items[0]!.favorited).toBe(false);
  });

  it('入垃圾桶清收藏（placeTrash）', () => {
    const { fake, inv } = fakeUI();
    fake.placeTrash = (UI.prototype as unknown as { placeTrash: unknown }).placeTrash as typeof fake.placeTrash;
    fake.heldStack = { id: WOOD, stack: 1, favorited: true };
    fake.placeTrash.call(fake);
    expect(inv.trash!.favorited).toBe(false);
  });

  it('垃圾桶 Shift+左键 = 桶→背包（GetAlternateClickAction :688-696 case 6 面）——源文本接线钉', () => {
    expect(srcMatch(/shiftKey && !e\.altKey && !e\.ctrlKey && this\.game\.player\.inv\.trash/)).toBe(true);
    expect(srcMatch(/playFiles\(\['trash_item_0', 'trash_item_1'\], 1\)/)).toBe(true);
    // SW-RB1 全拒回落普通面：ItemSpace 拒（plan null）→ LeftClick case-0 Swap 面
    // （满包 Shift+点=旧桶销毁+持物入桶 / 无持物=桶件上光标）——恒消费 return 只许在落袋支内
    expect(srcMatch(/if \(left < t\.stack\) \{\s*\n\s*[\s\S]*?return;\s*\n\s*\}\s*\n\s*\/\/ ★SW-RB1/)).toBe(true);
  });

  it('SW-RB1 箱料并入光标：MouseItemSwap 双端清（:1227-1235）收藏标记不越箱存活', () => {
    const { fake } = fakeUI({ chestItems: [{ id: WOOD, stack: 2 }] });
    fake.pickUp = (UI.prototype as unknown as { pickUp: unknown }).pickUp as typeof fake.pickUp;
    fake.heldStack = { id: WOOD, stack: 1, favorited: true };   // 收藏件先从背包拾起（context 0 保留）
    fake.pickUp.call(fake, 0, 'chest');
    expect(fake.heldStack!.stack).toBe(3);
    expect(fake.heldStack!.favorited).toBe(false);              // 箱语境 ∉ retainFavoriteOnMoveAt
    const inv = (fake.game.player as { inv: Inventory }).inv;
    fake.heldStack = { id: WOOD, stack: 1, favorited: true };
    inv.slots[11] = { id: WOOD, stack: 2 };
    fake.pickUp.call(fake, 11, 'inv');
    expect(fake.heldStack!.stack).toBe(3);
    expect(fake.heldStack!.favorited).toBe(true);               // 背包语境 ∈ 表 → 保留
  });

  it('makeSlotEl 优先级链接线（左键门+Alt 先于 Shift/Ctrl；无动作回落 dragFrom 普通面）', () => {
    expect(srcMatch(/if \(e\.button === 0 && e\.altKey && this\.altSlotClick\(i, where, panelOpen\)\) return;/)).toBe(true);
    // ★BJ730 改判史：旧锁=单行门 `…(e.shiftKey||e.ctrlKey) && this.altMoveClick(…) return;`
    //  ——BJ704-R5 P1（红蓝审查 F6 同族缺口）把该门改块形:门内先 snapshot
    //  slotContent,altMoveClick 命中后按空槽/内容变维护 cursor tooltip（悬停泡
    //  不残留不漂移）。门语义不变（button 0 + shift/ctrl → altMoveClick 优先于
    //  dragFrom）,锁随块形改写（门+调用双锚）。
    expect(srcMatch(/if \(e\.button === 0 && \(e\.shiftKey \|\| e\.ctrlKey\)\) \{\s*const before = this\.slotContent\(where, i\);\s*if \(this\.altMoveClick\(i, where, e\.shiftKey, e\.ctrlKey, panelOpen\)\) \{/)).toBe(true);
    expect(srcMatch(/this\.dragFrom = \{ i, where, sx: e\.clientX, sy: e\.clientY \};/)).toBe(true);
    expect(srcMatch(/planAlternateClick\(\{/, '../src/ui/UI.ts')).toBe(true);
    expect(srcMatch(/export function planAlternateClick/, '../src/ui/SlotActions.ts')).toBe(true);
  });

  it('SW-RB1 中键/侧键无槽位语义（e.button===0 门，原版替代点击仅左键驱动）', () => {
    expect(srcMatch(/e\.button === 0 && e\.altKey/)).toBe(true);
    expect(srcMatch(/e\.button === 0 && \(e\.shiftKey \|\| e\.ctrlKey\)/)).toBe(true);
  });

  it('SW-RB1 SwapClearFavorite 双端清接线：右键装备交换被换下件清收藏（ItemSlot.cs:1237-1242）', () => {
    expect(srcMatch(/if \(tmp\) tmp\.favorited = false;/)).toBe(true);
  });
});
