// ★BJ737-A issue#31 件2（2026-10-31）：装备/时装点击后对应槽位高亮 —— 判别锁。
//
// 原版锚（亲读 1457 ItemSlot.cs）：
//   · ShouldHighlightSlotForMouseItem :1274-1334 —— 光标持物（Main.mouseItem,IsAir
//     早退）拖过装备页时,可放进的对应槽返回 true：
//     case 8/9/10/11（装备/时装列）：`flag = slot >= 10; result = checkItem.vanity == flag
//       && Main.LocalPlayer.armor[slot].type != checkItem.type
//       && IsItemSlotUnlockedAndUsable(slot) && CanEquipInArmorSlot(...)`（:1286-1287）;
//     case 12（染料）：`IsItemSlotUnlockedAndUsable(slot) && checkItem.dye > 0`（:1297）;
//     case 16-20/33：逐类正面谓词（钩爪/坐骑/矿车/宠物/光源/杂项染料）。
//   · 消费 :2360-2382：叠画 InventoryBack22（52×52 纯白边框帧,中心透明——像素实测
//     336/2704 opaque 全在边带,mean gray 255）于槽底之上/幽灵图·图标之下,
//     色=槽底贴图对应 tint ×2 钳 255（Back13→loadout 行色/Back3→(50,106,46)/
//     Back12→(45,85,105);α=color2.A×2→脉冲下界 180×2=255 恒不透明）。
//   · 与 GetDimSlotForMouseItem（:1336-1397 不可入槽 ×0.5 变暗,H② 清偿刀已落）
//     同谓词正反面=互斥。
//
// 本仓病灶（修前）：H② 只落了变暗面,高亮面整缺 → 用户实报「点了幽灵头/幽灵衣时装
//   并没有对应高亮」。修 = shouldHighlightSlotForMouseItem 纯函数（UI.ts,与
//   getDimSlotForMouseItem 同层）+ slotMouseItemHighlightFor 装配 + paintSlotChrome
//   接线 .sw-slot-hl 边框层（Back22 multiply tint ×2）。
//
// 变异证红映射：
//   M1 纯函数摘 vanity==flag 臂（return true）   → ②纯函数/装配矩阵红（时装件亮装备页）
//   M2 纯函数摘 slotItemTypeId≠heldTypeId 臂     → ②装配红（原位同款假高亮）
//   M3 paintSlotChrome 摘 paintMouseItemHighlight 调用 → ③结构锁红（接线断）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  UI, shouldHighlightSlotForMouseItem, getDimSlotForMouseItem,
} from '../src/ui/UI';
import { Inventory } from '../src/items/Inventory';
import { Player } from '../src/entities/Player';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_DEFS } from '../src/data/items';
import { armorSlotIndexOfInternal, statOfInternal } from '../src/data/vanillaItemStats';
import { equipKindOfVid } from '../src/data/vanillaEquip';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

type AnyUI = Record<string, any>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (p: string): string => readFileSync(join(ROOT, 'src', p), 'utf8');
const UT = join(ROOT, 'src', 'ui', 'UI.ts');

const idOfVid = (vid: number): number => {
  const key = VANILLA_ITEM_KEY_BY_ID[vid];
  expect(key, `vid ${vid} ↔ 本仓 def 键`).toBeTruthy();
  return ITEM_BY_KEY[key!];
};

const mkUi = (): { ui: AnyUI; p: Player } => {
  const ui = Object.create(UI.prototype) as unknown as AnyUI;
  const p = new Player(60 * 16, 90 * 16, new Inventory());
  ui.game = { player: p, sfx: { play: () => {} } };
  return { ui, p };
};

// 动态取样（不硬编码档位）：
//   237=vanity 头（van:1,s:'h'） 240=vanity 身 208=双旗社交配饰（acc:0）
//   非vanity 头盔/功能配饰/染料/宠物
const VAN_HEAD = idOfVid(237);
const VAN_BODY = idOfVid(240);
const VAN_ACC = idOfVid(208);
const helmetId = ITEM_DEFS.findIndex((d, i) => !!d && armorSlotIndexOfInternal(i) === 0
  && statOfInternal(i)?.van !== 1);
const accId = ITEM_DEFS.findIndex((d, i) => !!d && statOfInternal(i)?.acc === 1
  && statOfInternal(i)?.wing == null && statOfInternal(i)?.van !== 1);
const dyeId = ITEM_DEFS.findIndex((d) => !!d && equipKindOfVid(d.vid ?? -1) === 'dye');
const petId = ITEM_DEFS.findIndex((d) => !!d && equipKindOfVid(d.vid ?? -1) === 'pet');

// ===================== ① 纯函数全支矩阵（ItemSlot.cs:1274-1334） =====================
describe('BJ737A-H① shouldHighlightSlotForMouseItem 全支矩阵', () => {
  const inp = (o: Partial<Parameters<typeof shouldHighlightSlotForMouseItem>[0]>): boolean =>
    shouldHighlightSlotForMouseItem({
      context: 8, slot: 0, heldVanity: false, heldTypeId: 100, slotItemTypeId: 0,
      slotUnlocked: true, canEquip: true, heldIsDye: false, miscFits: false, ...o,
    });

  it('case 8-11 四连谓词（:1286-1287）——M1/M2 变异位', () => {
    for (const ctx of [8, 9, 10, 11]) {
      // 装备页（slot<10）：非vanity 持物 + 四项全真 → 亮
      expect(inp({ context: ctx, slot: 3, heldVanity: false })).toBe(true);
      // vanity 持物 → 装备页不亮（页不匹配）
      expect(inp({ context: ctx, slot: 3, heldVanity: true })).toBe(false);
      // 时装页（slot>=10）：vanity 持物亮
      expect(inp({ context: ctx, slot: 13, heldVanity: true })).toBe(true);
      expect(inp({ context: ctx, slot: 13, heldVanity: false })).toBe(false);
      // 槽内同 type → 不亮（:1287 第三项）
      expect(inp({ context: ctx, slot: 3, slotItemTypeId: 100 })).toBe(false);
      // 锁槽 → 不亮
      expect(inp({ context: ctx, slot: 3, slotUnlocked: false })).toBe(false);
      // 不可装（CanEquipInArmorSlot 假）→ 不亮
      expect(inp({ context: ctx, slot: 3, canEquip: false })).toBe(false);
    }
  });

  it('case 12 染料：解锁 ∧ dye>0（:1297,无逐槽 type 比/无 canEquip 面）', () => {
    expect(inp({ context: 12, slot: 0, heldIsDye: true })).toBe(true);
    expect(inp({ context: 12, slot: 0, heldIsDye: false })).toBe(false);
    expect(inp({ context: 12, slot: 0, heldIsDye: true, slotUnlocked: false })).toBe(false);
    // 槽内同款染料照亮（原版无 type 比臂——与 8-11 的差异面）
    expect(inp({ context: 12, slot: 0, heldIsDye: true, slotItemTypeId: 100 })).toBe(true);
    expect(inp({ context: 12, slot: 0, heldIsDye: true, canEquip: false })).toBe(true);
  });

  it('case 16-20/33：misc 族逐槽分类面（:1304-1320）', () => {
    for (const ctx of [16, 17, 18, 19, 20, 33]) {
      expect(inp({ context: ctx, slot: 0, miscFits: true })).toBe(true);
      expect(inp({ context: ctx, slot: 0, miscFits: false })).toBe(false);
      // 杂项槽恒解锁——解锁臂不消费
      expect(inp({ context: ctx, slot: 0, miscFits: true, slotUnlocked: false })).toBe(true);
    }
  });

  it('∉ switch 语境恒 false：背包 0/钱币 1/弹药 2/箱 3/4/32/垃圾桶 6/向导 7/快捷栏 13/商店 15/展示娃娃 23-25/38/帽架 26/27/矿车 39', () => {
    for (const ctx of [0, 1, 2, 3, 4, 32, 6, 7, 13, 15, 23, 24, 25, 26, 27, 38, 39]) {
      expect(inp({ context: ctx, slot: 0, miscFits: true, heldIsDye: true, heldVanity: false })).toBe(false);
    }
  });

  it('与 getDimSlotForMouseItem 正反面互斥（同谓词取反域;H② 对拍）', () => {
    // case 8-11：高亮四项全真 ⟺ 变暗双项全假
    const hlOn = inp({ context: 10, slot: 3, heldVanity: false });
    const dim = getDimSlotForMouseItem({ context: 10, slotUnlocked: true, mouseFitsSlot: true });
    expect(hlOn).toBe(true);
    expect(dim).toBe(1);
    expect(getDimSlotForMouseItem({ context: 10, slotUnlocked: true, mouseFitsSlot: false })).toBe(0.5);
    expect(inp({ context: 10, slot: 3, canEquip: false })).toBe(false);
  });
});

// ===================== ② 装配（真 Inventory 谓词域,slotMouseItemHighlightFor） =====================
describe('BJ737A-H② 装配（heldStack→逐槽高亮,放置域同源谓词）', () => {
  it('时装头（van:1,如幽灵头类）持于光标：时装列 10 亮,装备列 0 不亮;时装身 11 亮——issue 主诉', () => {
    expect(statOfInternal(VAN_HEAD)?.van).toBe(1);
    expect(armorSlotIndexOfInternal(VAN_HEAD)).toBe(0);
    const { ui } = mkUi();
    ui.heldStack = { id: VAN_HEAD, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('armor', 10)).toBe(true);   // ★时装头槽高亮
    expect(ui.slotMouseItemHighlightFor('armor', 0)).toBe(false);   // 装备头槽不亮（页不匹配）
    ui.heldStack = { id: VAN_BODY, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('armor', 11)).toBe(true);   // 时装身槽
    expect(ui.slotMouseItemHighlightFor('armor', 1)).toBe(false);
  });

  it('普通头盔（非vanity）：装备列 0 亮,时装列 10 不亮（vanity==flag 页路由）', () => {
    expect(helmetId).toBeGreaterThan(0);
    expect(statOfInternal(helmetId)?.van).not.toBe(1);
    const { ui } = mkUi();
    ui.heldStack = { id: helmetId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('armor', 0)).toBe(true);
    expect(ui.slotMouseItemHighlightFor('armor', 10)).toBe(false);
  });

  it('功能配饰（acc:1）：装备配饰段 3-7 亮、社交段 13-19 不亮;双旗社交配饰（acc:0）镜像', () => {
    expect(accId).toBeGreaterThan(0);
    const { ui } = mkUi();
    ui.heldStack = { id: accId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('armor', 3)).toBe(true);
    expect(ui.slotMouseItemHighlightFor('armor', 7)).toBe(true);
    expect(ui.slotMouseItemHighlightFor('armor', 13)).toBe(false);
    expect(ui.slotMouseItemHighlightFor('armor', 19)).toBe(false);
    ui.heldStack = { id: VAN_ACC, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('armor', 13)).toBe(true);   // 双旗=vanity 页
    expect(ui.slotMouseItemHighlightFor('armor', 3)).toBe(false);
  });

  it('槽内同 type 不亮（:1287 armor[slot].type != checkItem.type——M2 变异位）', () => {
    const { ui, p } = mkUi();
    p.inv.armor[0] = { id: helmetId, stack: 1 };          // 装备头槽已放同款
    ui.heldStack = { id: helmetId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('armor', 0)).toBe(false);   // 原位同款=不亮
    expect(ui.slotMouseItemHighlightFor('armor', 1)).toBe(false);   // 部位不匹配
    p.inv.armor[0] = null;
    expect(ui.slotMouseItemHighlightFor('armor', 0)).toBe(true);    // 清空即亮
  });

  it('锁槽臂（:1287 IsItemSlotUnlockedAndUsable）：armor:8 无恶魔心不亮', () => {
    const { ui, p } = mkUi();
    expect(p.inv.isItemSlotUnlockedAndUsable(8)).toBe(false);
    ui.heldStack = { id: accId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('armor', 8)).toBe(false);
  });

  it('染料：dye 列 0-7 全亮（无逐槽 type 比;槽 8 锁=不亮）', () => {
    expect(dyeId).toBeGreaterThan(0);
    const { ui, p } = mkUi();
    ui.heldStack = { id: dyeId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('dye', 0)).toBe(true);
    expect(ui.slotMouseItemHighlightFor('dye', 7)).toBe(true);
    p.inv.dye[3] = { id: dyeId, stack: 1 };                // 同款染料在槽照样亮（:1297 无 type 臂）
    expect(ui.slotMouseItemHighlightFor('dye', 3)).toBe(true);
    expect(ui.slotMouseItemHighlightFor('dye', 8)).toBe(false);   // 锁槽
    ui.heldStack = { id: helmetId, stack: 1 };             // 非染料持物 → 染料列不亮
    expect(ui.slotMouseItemHighlightFor('dye', 0)).toBe(false);
  });

  it('misc 族：宠物持物亮 misc:0（context 19）,头盔持物不亮;miscDye 染料亮', () => {
    expect(petId).toBeGreaterThan(0);
    const { ui } = mkUi();
    ui.heldStack = { id: petId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('misc', 0)).toBe(true);    // 宠物槽
    expect(ui.slotMouseItemHighlightFor('misc', 4)).toBe(false);   // 抓爪槽
    ui.heldStack = { id: helmetId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('misc', 0)).toBe(false);
    ui.heldStack = { id: dyeId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('miscDye', 0)).toBe(true);
  });

  it('光标空（heldStack=null ≙ checkItem.IsAir 早退 :1277）→ 全族不亮;inv/chest 语境不装配', () => {
    const { ui } = mkUi();
    ui.heldStack = null;
    expect(ui.slotMouseItemHighlightFor('armor', 0)).toBe(false);
    expect(ui.slotMouseItemHighlightFor('dye', 0)).toBe(false);
    ui.heldStack = { id: helmetId, stack: 1 };
    expect(ui.slotMouseItemHighlightFor('inv', 0)).toBe(false);    // 背包格 ∉ 原版 switch
    expect(ui.slotMouseItemHighlightFor('chest', 0)).toBe(false);
  });
});

// ===================== ③ 渲染接线结构锁（ItemSlot.cs:2360-2382） =====================
describe('BJ737A-H③ 渲染接线（Back22 边框帧叠层——M3 变异位）', () => {
  it('paintSlotChrome 装备族分支接 paintMouseItemHighlight（与 H② 变暗同拍同通道）', () => {
    expect(SRC('ui/UI.ts')).toContain('this.paintMouseItemHighlight(slotEl, where, i);');
  });

  it('叠层=Inventory_Back22 边框帧 × tint×2（★mask alpha 门控呈色——multiply 会填满透明心,实机像素定谳;槽底上/图标下）', () => {
    expect(SRC('ui/UI.ts')).toContain('url(sprites/vanilla/Inventory_Back22.png)');
    expect(SRC('ui/UI.ts')).toContain('mask-image:url(sprites/vanilla/Inventory_Back22.png); mask-size:100% 100%;');
    expect(SRC('ui/UI.ts')).toContain('background-color:var(--hl-tint);');
    expect(SRC('ui/UI.ts')).toContain('insertBefore(node, slotEl.firstChild)');
    // ×2 钳 255（:2380）
    expect(SRC('ui/UI.ts')).toContain('Math.min(255, rgb[0] * 2)');
  });

  it('misc=Back3 支(50,106,46)/miscDye=Back12 支(45,85,105)（:2365/:2373 逐贴图支）', () => {
    expect(SRC('ui/UI.ts')).toContain('if (where === \'misc\') rgb = [50, 106, 46];');
    expect(SRC('ui/UI.ts')).toContain('else if (where === \'miscDye\') rgb = [45, 85, 105];');
  });
});

// ===================== ④ 变异恰红（withMutation 三层守卫+sha256 对拍） =====================
describe.skipIf(process.env.SW_BJ737A_H_MUT)('BJ737A-H④ 变异自证（三发恰红+逐字节还原 sha256）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj737a-equip-slot-highlight.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ737A_H_MUT: '1' },
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ737A-H ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    lockTargetFile(file, `BJ737A-H 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };

  it('M1 纯函数摘 vanity==flag 臂（时装件亮装备页） → ①矩阵+②装配红', () => {
    mutate(UT,
      `return inp.heldVanity === vanityPage               // :1287 四连谓词
        && inp.slotItemTypeId !== inp.heldTypeId
        && inp.slotUnlocked
        && inp.canEquip;`,
      'return true;                                       // BJ737A-H-M1（四连谓词整臂摘除）',
      'BJ737A-H② 装配');
  });

  it('M2 纯函数摘 slotItemTypeId≠heldTypeId 臂（原位同款假高亮） → ②装配红', () => {
    mutate(UT,
      'return inp.heldVanity === vanityPage               // :1287 四连谓词\n        && inp.slotItemTypeId !== inp.heldTypeId',
      'return inp.heldVanity === vanityPage               // BJ737A-H-M2',
      '槽内同 type 不亮');
  });

  it('M3 paintSlotChrome 摘高亮接线 → ③结构锁红', () => {
    mutate(UT,
      'this.paintMouseItemHighlight(slotEl, where, i);',
      'void slotEl; void where; void i;   // BJ737A-H-M3',
      'BJ737A-H③ 渲染接线');
  });
});
