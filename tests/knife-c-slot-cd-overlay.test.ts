// ★清偿刀 C（2026-09-29）槽位 CD 覆盖基建判别测试（清偿刀 U 债②收口）。
// 定谳锚（1457 反编译亲读）：
//   覆盖族四分支 ItemSlot.cs:2693-2725——
//   ①context 13 + item.potion（:2702-2707）：CoolDown 贴图（AssetInitializer.cs:780
//     TextureAssets.Cd="Images\CoolDown",32×32）槽心居中,α=GetAlpha(lightColor)×
//     potionDelay/potionDelayTime。potionDelay=buff21 剩余（Player.cs:11807-11809
//     每 tick 同步,非 Debug 门）;potionDelayTime 每 tick 重算 3600×pStone0.75
//     （:25674-25683,Item.potionDelay=3600 Item.cs:89）。GetAlpha 对 alpha=0 物=
//     lightColor 原样（Item.cs:49329-49343）→ 关包快捷栏 lightColor=(255,255,255,
//     75+150×scale)（Main.cs:44351-44352）:选中 A=225/未选 187（稳态 scale1/0.75）。
//   ②context 13 + healMana>0（:2708-2713）：α=GetAlpha×Remap(manaPotionDelay,
//     300,0,1,0)（Utils.cs:345-348）。★死支定谳：manaPotionDelay 非零写支全在
//     DebugOptions.ManaPotionDelay 门内（Player.cs:10408-10411/:52577-52581;
//     DebugOptions.cs:28 缺省 false）→ 常规局 α≡0。谓词数据=vanilla-itemfunc.json
//     healMana {110,189,500,2209}（Item.cs case 110/189/500/2209 亲读）。
//   ③context 34 CreativeInfiniteLocked（:2714-2718）：α=GetAlpha×0.5 定值。
//   ④(context 10|18)+expertOnly∧!expertMode（:2720-2725）：α=White×itemFade。
//     10=EquipAccessory/18=EquipMinecart（ItemSlot.Context :57/:73）——misc 族其余
//     16/17/19/20【无】此分支。1457 全树零 expertOnly=true（Item.cs:129/:48960 外无
//     =U/X 刀同判）→ 行为分支由测试数据点亮（finally 还原）。
//   绘序：CD 在物品图标+堆叠数【之后】（:2681/:2499→:2702）=槽内顶层;
//   开包时快捷栏整体早退（Main.cs:44324）+面板 50 格全 context 0（:41748）→
//   开包无任何 context 13 面=覆盖消失（原版本相,非缺）。
// 测试法：纯函数 slotCooldownAlpha 全分支 + tickSlotCooldownOverlays 接线（假 DOM
//   槽元+真 Player/Inventory/BuffState+测试内点亮 expertOnly）。
import { describe, it, expect } from 'vitest';
import { UI, slotCooldownAlpha } from '../src/ui/UI';
import { Inventory } from '../src/items/Inventory';
import { Player } from '../src/entities/Player';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_DEFS } from '../src/data/items';
import { itemFuncOfVid } from '../src/data/vanillaItemFunc';
import { BuffType } from '../src/stats/Buffs';

type AnyUI = Record<string, any>;

const idOfVid = (vid: number): number => {
  const key = VANILLA_ITEM_KEY_BY_ID[vid];
  expect(key, `vid ${vid} ↔ 本仓 def 键`).toBeTruthy();
  return ITEM_BY_KEY[key!];
};

const HEALING_POTION = idOfVid(188);   // potion:true healLife 100（Item.cs:3690-3701）
const RESTORATION = idOfVid(227);      // potion:true healLife 90（:4199-4207）
const GREATER_MANA = idOfVid(110);     // healMana 50 非 potion（:2681-2683）
const MUSHROOM = idOfVid(5);           // potion:true healLife 15（:1451-1453）
const CART = idOfVid(4745);            // Mechanical Cart（misc[2] 矿车面填充件）
const IRONSKIN_POTION = idOfVid(232);  // 非治疗药水（potion 旗假——对照位）

// ===================== 纯函数：四分支逐字 =====================
describe('slotCooldownAlpha 四分支（ItemSlot.cs:2693-2725 逐字）', () => {
  const base = {
    context: 13, vid: 188, potion: true, healMana: 0, expertOnly: false,
    potionDelayTicks: 3600, potionDelayTimeTicks: 3600, manaPotionDelayTicks: 0,
    expertMode: false, itemFade: 1,
  };

  it('①potion 分支 α=potionDelay/potionDelayTime（:2705）', () => {
    expect(slotCooldownAlpha(base)).toBe(1);                                 // 满窗
    expect(slotCooldownAlpha({ ...base, potionDelayTicks: 1800 })).toBe(0.5); // 过半
    expect(slotCooldownAlpha({ ...base, potionDelayTicks: 0 })).toBe(0);      // 期满
  });

  it('①贤者石分母 2700（:25678-25680）——剩余 2700/2700=1', () => {
    expect(slotCooldownAlpha({ ...base, potionDelayTicks: 2700, potionDelayTimeTicks: 2700 })).toBe(1);
    expect(slotCooldownAlpha({ ...base, potionDelayTicks: 1350, potionDelayTimeTicks: 2700 })).toBe(0.5);
  });

  it('①门序：非 potion 件/非 context13 零覆盖（:2702 双合取）', () => {
    expect(slotCooldownAlpha({ ...base, potion: false })).toBe(0);            // 非治疗药水
    expect(slotCooldownAlpha({ ...base, context: 0 })).toBe(0);               // 开包面板行
    expect(slotCooldownAlpha({ ...base, context: 10 })).toBe(0);              // 药水在配饰槽无覆盖
  });

  it('②healMana 分支 Remap(300,0,1,0)（:2711/Utils.cs:345 clamp）+死支缺省恒 0', () => {
    const mana = { ...base, potion: false, healMana: 50 };
    expect(slotCooldownAlpha({ ...mana, manaPotionDelayTicks: 300 })).toBe(1);   // 5s 满窗
    expect(slotCooldownAlpha({ ...mana, manaPotionDelayTicks: 150 })).toBe(0.5); // 中点
    expect(slotCooldownAlpha({ ...mana, manaPotionDelayTicks: 0 })).toBe(0);     // 期满
    // clamp 方向：v>fromMin(300) → t=0 → toMin=1（GetLerpValue 越上界钳 0;
    // 实域 manaPotionDelay∈[0,300] 只减不增,该侧不可达,钳向按原公式钉死）
    expect(slotCooldownAlpha({ ...mana, manaPotionDelayTicks: 450 })).toBe(1);
    // 缺省计时源（本仓无 DebugOptions.ManaPotionDelay 通道）→ 恒 0 不显
    expect(slotCooldownAlpha(mana)).toBe(0);
  });

  it('③context 34 定值 0.5（:2717）', () => {
    expect(slotCooldownAlpha({ ...base, context: 34, potion: false })).toBe(0.5);
    expect(slotCooldownAlpha({ ...base, context: 34, potion: false, itemFade: 0.3 })).toBe(0.5);
  });

  it('④expertOnly 门（:2720 三合取）：经典世界点亮/专家世界熄灭/其余配饰语境零', () => {
    const acc = { ...base, context: 10, potion: false, expertOnly: true };
    expect(slotCooldownAlpha(acc)).toBe(1);                                    // context10 经典
    expect(slotCooldownAlpha({ ...acc, context: 18 })).toBe(1);                // context18 矿车
    expect(slotCooldownAlpha({ ...acc, expertMode: true })).toBe(0);           // 专家世界无覆盖
    expect(slotCooldownAlpha({ ...acc, expertOnly: false })).toBe(0);          // 非 expertOnly 件
    expect(slotCooldownAlpha({ ...acc, context: 16 })).toBe(0);                // 抓钩槽（misc16）无
    expect(slotCooldownAlpha({ ...acc, context: 17 })).toBe(0);                // 坐骑槽无
    expect(slotCooldownAlpha({ ...acc, context: 19 })).toBe(0);                // 宠物槽无
    expect(slotCooldownAlpha({ ...acc, context: 20 })).toBe(0);                // 光源槽无
    expect(slotCooldownAlpha({ ...acc, context: 8 })).toBe(0);                 // 盔甲槽无
    expect(slotCooldownAlpha({ ...acc, itemFade: 0.5 })).toBe(0.5);            // itemFade 乘区
  });
});

// ===================== 接线：tickSlotCooldownOverlays =====================
/** 假 DOM 槽元（.sw-slot-cd 子元素 stub;真 Player/Inventory/BuffState 驱动） */
function mkTickUi(): { ui: AnyUI; cds: Map<string, { style: Record<string, string>; dataset: Record<string, string>; isConnected: boolean }> } {
  const ui = Object.create(UI.prototype) as unknown as AnyUI;
  const p = new Player(60 * 16, 90 * 16, new Inventory());
  ui.game = { player: p, sfx: { play: () => {} } };
  ui.invPanel = { style: { display: 'none' } };   // 关包（context 13 面）
  ui.slotCdEls = new Map();   // Object.create 桩不走构造器:类字段手工补（knife-u 同法）
  const cds = new Map<string, { style: Record<string, string>; dataset: Record<string, string>; isConnected: boolean }>();
  const hosts = new Map<string, { querySelector: (s: string) => unknown }>();
  const hostFor = (where: string, i: number): { querySelector: (s: string) => unknown } => {
    const key = `${where}:${i}`;
    let h = hosts.get(key);
    if (!h) {
      const cd = { style: {} as Record<string, string>, dataset: {} as Record<string, string>, isConnected: true };
      cds.set(key, cd);
      h = { querySelector: (s: string) => (s === '.sw-slot-cd' ? cd : null) };
      hosts.set(key, h);
    }
    return h;
  };
  for (let i = 0; i < 10; i++) hostFor('inv', i);
  for (let i = 0; i < 10; i++) hostFor('armor', i);
  for (let i = 0; i < 5; i++) hostFor('misc', i);
  ui.slotEl = (i: number, where: string) => hosts.get(`${where}:${i}`) ?? null;
  ui.slotContent = (where: string, i: number): { id: number; stack: number } | null =>
    where === 'inv' ? (p.inv.slots[i] ?? null)
      : where === 'armor' ? (p.inv.armor[i] ?? null)
        : where === 'misc' ? (p.inv.miscEquips[i] ?? null)
          : null;
  return { ui, cds };
}

describe('接线 tickSlotCooldownOverlays（60Hz onBuffsFrame 通道消费面）', () => {
  it('药水喝下→快捷栏槽覆盖出现（selected 因子 225/255）→期满消失', () => {
    const { ui, cds } = mkTickUi();
    const p = ui.game.player as Player;
    p.inv.slots[0] = { id: HEALING_POTION, stack: 3 };
    p.buffs.apply(BuffType.Resistance, 60);            // 药水病 60s（potionDelay=3600t）
    ui.tickSlotCooldownOverlays();
    const cd0 = cds.get('inv:0')!;
    expect(cd0.dataset.cd).toBe('0.882');              // 3600/3600 × 225/255（selected=0）
    expect(cd0.style.display).toBe('block');
    // 未选中槽 187/255（Main.cs:44351 稳态）
    p.inv.slots[3] = { id: HEALING_POTION, stack: 1 };
    ui.tickSlotCooldownOverlays();
    expect(cds.get('inv:3')!.dataset.cd).toBe('0.733');
    // 过半：剩余 1800t → 0.5×0.882=0.441
    p.buffs.set(BuffType.Resistance, 30);
    ui.tickSlotCooldownOverlays();
    expect(cd0.dataset.cd).toBe('0.441');
    // 期满（buff 出栏=potionDelay 0）→ 覆盖消失
    p.buffs.active.delete(BuffType.Resistance);
    ui.tickSlotCooldownOverlays();
    expect(cds.get('inv:0')!.style.display).toBe('none');
    expect(cds.get('inv:3')!.style.display).toBe('none');
  });

  it('开包（playerInventory）= context 0 面,快捷栏覆盖消失（Main.cs:44324/:41748 同判）', () => {
    const { ui, cds } = mkTickUi();
    const p = ui.game.player as Player;
    p.inv.slots[0] = { id: HEALING_POTION, stack: 1 };
    p.buffs.apply(BuffType.Resistance, 60);
    ui.tickSlotCooldownOverlays();
    expect(cds.get('inv:0')!.style.display).toBe('block');
    (ui.invPanel.style as Record<string, string>).display = 'block';
    ui.tickSlotCooldownOverlays();
    expect(cds.get('inv:0')!.style.display).toBe('none');
  });

  it('贤者石分母 2700（:25674-25683）——催化指环 6185 在栏', () => {
    const { ui, cds } = mkTickUi();
    const p = ui.game.player as Player;
    p.inv.slots[0] = { id: HEALING_POTION, stack: 1 };
    p.buffs.apply(BuffType.Resistance, 45);            // 贤者石档 2700t 满窗
    expect(p.equipStats.pStone).toBe(false);
    p.inv.armor[3] = { id: idOfVid(6185), stack: 1 };  // 催化指环（Player.ts:2282 pStone 面）
    expect(p.equipStats.pStone).toBe(true);
    ui.tickSlotCooldownOverlays();
    // ★BJ738 P04 随刀更新：穿石翻转拍当场调整现役药水病（AdjustRemainingPotionSickness
    //  Player.cs:29167-29181——2700t×0.75=2025t,非旧「分母换、分子不动」的 2700t 满窗）
    expect(cds.get('inv:0')!.dataset.cd).toBe('0.662'); // 2025/2700=0.75（0.75×0.882 上限曲线）
  });

  it('非治疗件/非治疗药水无覆盖（谓词=ItemFunc.potion 单源）', () => {
    const { ui, cds } = mkTickUi();
    const p = ui.game.player as Player;
    p.buffs.apply(BuffType.Resistance, 60);
    p.inv.slots[0] = { id: IRONSKIN_POTION, stack: 1 };  // 铁皮药（potion 旗假）
    p.inv.slots[1] = { id: idOfVid(54), stack: 1 };      // 非药水件
    ui.tickSlotCooldownOverlays();
    expect(cds.get('inv:0')!.style.display).toBe('none');
    expect(cds.get('inv:1')!.style.display).toBe('none');
  });

  it('蘑菇药（vid5 蘑菇档 1800t）也走同款覆盖（Item.potion 族全表）', () => {
    const { ui, cds } = mkTickUi();
    const p = ui.game.player as Player;
    p.inv.slots[2] = { id: MUSHROOM, stack: 1 };
    p.buffs.apply(BuffType.Resistance, 30);            // 蘑菇档 1800t
    ui.tickSlotCooldownOverlays();
    // α=1800/3600（potionDelayTime 恒 3600 档,原版恢复/蘑菇分档不进分母 :25675）
    // × 未选中 lightColor 187/255（slot2 非选中）= 0.367
    expect(cds.get('inv:2')!.dataset.cd).toBe('0.367');
  });

  it('expertOnly 槽覆盖门：配饰槽（10）点亮→专家世界熄灭;盔甲/抓钩/坐骑槽零', () => {
    const { ui, cds } = mkTickUi();
    const p = ui.game.player as Player;
    const def = ITEM_DEFS[CART] as unknown as Record<string, unknown>;
    def.expertOnly = true;
    try {
      p.inv.armor[3] = { id: CART, stack: 1 };
      ui.tickSlotCooldownOverlays();
      expect(cds.get('armor:3')!.style.display).toBe('block');
      expect(cds.get('armor:3')!.dataset.cd).toBe('1.000');   // White×itemFade(1)
      p.inv.gateExpert = true;                                 // Main.expertMode ≙ 专家/大师档
      ui.tickSlotCooldownOverlays();
      expect(cds.get('armor:3')!.style.display).toBe('none');
      p.inv.gateExpert = false;
      // 语境族界：armor[0]（ctx8）/misc[4]（抓钩 ctx16）无此分支;misc[2] 矿车（ctx18）有
      p.inv.armor[0] = { id: CART, stack: 1 };
      p.inv.miscEquips[2] = { id: CART, stack: 1 };
      p.inv.miscEquips[4] = { id: CART, stack: 1 };
      ui.tickSlotCooldownOverlays();
      // 盔甲(8)/抓钩(16)槽无 CD 分支=tick 不驱（产出元素缺省 display:none,假 DOM 未写）
      expect(cds.get('armor:0')!.style.display ?? 'none').not.toBe('block');
      expect(cds.get('misc:2')!.style.display).toBe('block');
      expect(cds.get('misc:4')!.style.display ?? 'none').not.toBe('block');
    } finally {
      delete def.expertOnly;
    }
  });

  it('healMana 蓝药热栏：死支缺省源恒 0 不显（DebugOptions.ManaPotionDelay=false 定谳）', () => {
    const { ui, cds } = mkTickUi();
    const p = ui.game.player as Player;
    p.inv.slots[0] = { id: GREATER_MANA, stack: 5 };
    p.buffs.apply(BuffType.ManaSickness, 5);
    ui.tickSlotCooldownOverlays();
    expect(cds.get('inv:0')!.style.display).toBe('none');   // 原版常规局 manaPotionDelay≡0
  });

  it('空槽无覆盖（item.IsAir 早退同构）', () => {
    const { ui, cds } = mkTickUi();
    ui.tickSlotCooldownOverlays();
    for (const [k, cd] of cds) {
      // tick 只驱有原版分支的面（热栏 0-9/armor 3-9/misc 2）;未驱面缺省 none
      if (cd.style.display) expect(cd.style.display, k).toBe('none');
      expect(cd.dataset.cd ?? '', k).toBe('');
    }
  });

  it('谓词数据抽验：vanilla-itemfunc.json potion/healMana 与 Item.cs SetDefaults 对账', () => {
    const potionVids = [5, 28, 126, 188, 227, 499, 1134, 1912, 2314, 3001, 3544, 5496];
    for (const v of potionVids) {
      expect(itemFuncOfVid(v)?.potion, `vid ${v} Item.potion`).toBeTruthy();
    }
    // 反例：healMana 族非 potion、铁皮药非 potion
    expect(itemFuncOfVid(110)?.potion).toBeFalsy();
    expect(itemFuncOfVid(232)?.potion).toBeFalsy();
    expect(itemFuncOfVid(110)?.healMana).toBe(50);
    expect(itemFuncOfVid(189)?.healMana).toBe(100);
    expect(itemFuncOfVid(500)?.healMana).toBe(200);
    expect(itemFuncOfVid(2209)?.healMana).toBe(400);
  });
});
