// DOM overlay UI：主菜单 / HUD 快捷栏 / 背包+配饰栏 / 合成 / 宝箱 / Buff栏 / 暂停 / Tooltip / Toast
import type { Game } from '../core/Game';
import { getPass, runPassOnImageData, defaultUniforms } from '../fx/SM2Effect';
import { options } from '../core/Options';
import { bindsOf, keybindActionLabel, keybindCodeLabel, type KeybindAction } from '../core/Keybinds';
import { ITEM_DEFS, ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, WIRE_ICON_COUNTER_VIDS } from '../data/items';
import { itemFuncOfVid } from '../data/vanillaItemFunc';   // ★清偿刀 C：槽位 CD 谓词单源（potion/healMana）
import {
  ITEM_GLOWMASK, dropGlowColors, xnaColorToOp, monkT3GlowRect, MONK_T3_GLOW,
} from '../data/vanillaItemGlow';   // ★BJ603 件1 UI 槽位光罩（ItemSlot.cs:2890-2931）
/** UI 槽位光罩排除面（ItemSlot.cs:2890 外门 type!=3779 && type!=46 && type!=5462）。 */
const UI_GLOW_EXCLUDED: ReadonlySet<number> = new Set([3779, 46, 5462]);
// ★BJ154:isFunctionalTileItem/vanillaItemCreateTile 消费随池构建摘入 itemSearch.ts
import { OPENABLE_BAG_VIDS, openBagItem } from '../data/vanillaOpenBags';
import { TILE_DEFS } from '../data/tiles';
import { autoFrameAt, cactusFrameAt, cactusTextureFor } from '../render/VanillaTiler';
import { vanillaItemKey, ingredientKey, VANILLA_RECIPES, RECIPE_GROUP_ITEMS, invIndexOfVanilla, availableItemCountFor, collectOwnedItems, expandStationTiles, type VanillaRecipeLike } from '../data/vanillaRecipes';
import {
  craftGridGeometry, craftGridCellXY, craftGridPageBtnXY,
  clampCraftGridRecStart, craftGridRecStartAfterUp, craftGridRecStartAfterDown,
  craftToggleFrame, cycleCraftingGridControl, craftingWindowTextTipKey,
  craftSelectedBarRows, CRAFT_BAR_COLOR, CRAFT_BAR_SOLID, CRAFT_BAR_TOP_OFF,
  CRAFT_GRID_SLOT_SCALE, CRAFT_GRID_LEFT, CRAFT_GRID_TOP, craftingFilterForTile, recipeFilterAccepts, filterRemainOpen,
  vanillaWheelNotches, wheelEventPx, craftSnapEase, craftSnapCrossedRow,
  type CraftingGridControl, type CraftingTileFilter,
} from './craftingGrid';   // ★SW-FX30 刀②+⑦:经典网格视图/切换钮/站点过滤纯逻辑单源(CraftingUI.cs 域);★SW-FX38 滚轮档数/吸附步进
import { petInfoOfVid } from '../data/vanillaPets';
import { modItemGlowMaskIdOf } from '../mods/drawspecs';   // ★刀2-C1/R-B-F5:mod 物品光罩(背包格图标链)
import { modPetInfoOf, modPetEntries } from '../mods/pets';   // ★刀3-2:mod 宠物
import { MOD_RARITY_ID_BASE } from '../mods/types';   // ★刀3-1/R3-M3:词缀 cap 边界段常量
import { showJourneyQuickGate } from './QuickGate';
import { prefGet, prefSet } from '../save/PrefsStore';   // ★BJ627 偏好域 IDB 单写
import vanillaRareJson from '../data/vanilla-itemrare.json';
import vanillaExpertJson from '../data/vanilla-expert.json';
import { mouseTextInnerColor } from '../render/Renderer';
import { VANILLA_ITEM_COLOR, VANILLA_ITEM_ALPHA, blendItemColorTint } from '../data/vanillaItemColor';
const ITEM_RARE = vanillaRareJson as Record<string, number>;
/** 专家旗表（vanilla-expert.json：Item.cs SetDefaults `expert = true` 25 处→43 id→1；
 *  tools/extract-expert.mjs 提取，recon-item 闸门对账——Game.ts:287 同源表） */
const ITEM_EXPERT = vanillaExpertJson as Record<string, number>;

// ★清偿刀 U（2026-09-29）：DyeSwap 持久计数器（ItemSlot.dyeSwapCounter :292
// private static——UI 层会话态）。轮转语义（DyeSwap :3556-3577,1457 亲读）：
// while 跳锁（:3558-3561,mod 10 环扫）→ 全表 0..9 扫首个「解锁∧空」槽优先
// （:3563-3568）→ 与计数槽 SwapClearFavorite（:3571,全满时【不】早退=与计数槽
// 交换,被换下染料回源格）→ targetSlot=计数槽 → 计数器 +1 mod 10（:3573）。
// 持久域定谳：ItemSlot 静态字段 = 会话态【不入档】（Player.cs 存档段无此字段,
// SavePlayer 序列化面零触及）;重置点 = ResetInventoryStateCounters（:3262-3265）
// 由 Main.DrawInterface_26_InterfaceLogic3 的 !playerInventory 支每帧调
// （Main.cs:46445）——即【背包一关就归零】,重开背包后轮转从头开始。
let dyeSwapCounter = 0;
/** ResetInventoryStateCounters（ItemSlot.cs:3262-3265）。本仓触发点 = closeInventory
 *  （!playerInventory 单漏斗：Esc 关包/死亡强收包/设置浮层收包均过此）+ 测试直调 */
export function resetInventoryStateCounters(): void {
  dyeSwapCounter = 0;
}

/** ★清偿刀 X（2026-09-29）：U 刀「放置面仍盲」债②已收口——右键面（accPairConflicts/
 *  accGroupClash）/时装互换面（accFitsInSegment 改全臂单源）/拖放面（armorAcceptsDrag）
 *  三面同组。★清偿刀 Z（2026-09-29）第四面收口：armorAccepts 本体组臂已落
 *  （Inventory.ts,其内部消费面 CanShareArmor 快捷装备 :311/Loadout :337 自动承接）。
 *  谓词单源已提至数据层 vanillaEquip.ts（ACC_INCOMPAT_GROUP/accGroupClash/
 *  accPairConflicts 三导出——UI.ts 已 import Inventory.ts,反向 import 成环,故不在
 *  UI 层;ItemID.cs:58 组表/ItemSlot.cs:3460-3538 锚随定义迁移）。本文件 :1816/:1924
 *  （accPairConflicts）与 armorAcceptsDrag（accGroupClash）消费签名零改动。 */

/** 原版像素面板底(IngameOptions.Draw + Utils.DrawInvBG 1:1):
 *  Inventory_Back13(52×52)九宫——角 10×10、边/心拉伸(Utils.DrawInvBG :2681-2691 同式),
 *  逐像素乘 IngameOptions 面板色 (33,15,91)×0.685(颜色乘法:XNA Color*float 同时乘 RGB 与 A)。
 *  返回 dataURL;素材未载(首次打开竞态)返回 null,调用方保留兜底底色 */
let invBgTinted: HTMLCanvasElement | null = null;
/** 模块级预载(首次打开面板时大概率已就绪;未就绪由 invBgEnsure 的 onload 回补) */
let invBgImg: ImageBitmap | HTMLImageElement | null = null;
function invBgEnsure(): ImageBitmap | HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (!invBgImg) {
    invBgImg = new Image();
    invBgImg.onload = () => upgradeToBitmap(invBgImg as unknown as HTMLImageElement, (b) => { invBgImg = b as unknown as HTMLImageElement; });
    invBgImg.src = 'sprites/vanilla/Inventory_Back13.png';
  }
  return invBgImg;
}
/** tooltip 底（Inventory_Back13 × (23,25,81)×0.925，Utils.DrawInvBG :20252-20255）：
 *  与面板 invBgDataUrl 同贴图不同染色；按 (w,h) 取整缓存 */
let tooltipBgTinted: HTMLCanvasElement | null = null;
const tooltipBgCache = new Map<string, string>();
function tooltipBgDataUrl(w: number, h: number): string | null {
  const img = invBgEnsure();
  if (!img || !(img.width > 0) || img.width === 0) return null;
  const key = `${Math.max(20, Math.round(w))}x${Math.max(20, Math.round(h))}`;
  const hit = tooltipBgCache.get(key);
  if (hit) return hit;
  if (!tooltipBgTinted) {
    const t = document.createElement('canvas');
    t.width = img.width; t.height = img.height;
    const tc = t.getContext('2d', { willReadFrequently: true })!;  // getImageData/toDataURL 烘焙,SHM 后备
    tc.imageSmoothingEnabled = false;
    tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, t.width, t.height);
    const tmul = [23 / 255, 25 / 255, 81 / 255, 0.925];   // 原版真值（:20252-20255）
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = Math.round(d.data[i] * tmul[0]);
      d.data[i + 1] = Math.round(d.data[i + 1] * tmul[1]);
      d.data[i + 2] = Math.round(d.data[i + 2] * tmul[2]);
      d.data[i + 3] = Math.round(d.data[i + 3] * tmul[3]);   // ★曾误乘红通道 d.data[i]——深蓝底红≈23→alpha≈22（两轮透明报障真根因）
    }
    tc.putImageData(d, 0, 0);
    tooltipBgTinted = t;
  }
  const t = tooltipBgTinted, W = t.width, H = t.height;
  const c = document.createElement('canvas');
  c.width = Number(key.split('x')[0]); c.height = Number(key.split('x')[1]);
  const x = c.getContext('2d', { willReadFrequently: true })!;  // toDataURL 烘焙,SHM 后备
  x.imageSmoothingEnabled = false;
  x.drawImage(t, 0, 0, 10, 10, 0, 0, 10, 10);
  x.drawImage(t, W - 10, 0, 10, 10, c.width - 10, 0, 10, 10);
  x.drawImage(t, 0, H - 10, 10, 10, 0, c.height - 10, 10, 10);
  x.drawImage(t, W - 10, H - 10, 10, 10, c.width - 10, c.height - 10, 10, 10);
  x.drawImage(t, 10, 0, 10, 10, 10, 0, c.width - 20, 10);
  x.drawImage(t, 10, H - 10, 10, 10, 10, c.height - 10, c.width - 20, 10);
  x.drawImage(t, 0, 10, 10, 10, 0, 10, 10, c.height - 20);
  x.drawImage(t, W - 10, 10, 10, 10, c.width - 10, 10, 10, c.height - 20);
  x.drawImage(t, 10, 10, 10, 10, 10, 10, c.width - 20, c.height - 20);
  const url = c.toDataURL();
  tooltipBgCache.set(key, url);
  return url;
}

function invBgDataUrl(w: number, h: number): string | null {
  const img = invBgEnsure();
  if (!img || !(img.width > 0) || img.width === 0) return null;
  if (!invBgTinted) {
    const t = document.createElement('canvas');
    t.width = img.width; t.height = img.height;
    const tc = t.getContext('2d', { willReadFrequently: true })!;  // getImageData/toDataURL 烘焙,SHM 后备
    tc.imageSmoothingEnabled = false;
    tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, t.width, t.height);
    const tmul = [33 / 255, 15 / 255, 91 / 255, 0.685];
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = Math.round(d.data[i] * tmul[0]);
      d.data[i + 1] = Math.round(d.data[i + 1] * tmul[1]);
      d.data[i + 2] = Math.round(d.data[i + 2] * tmul[2]);
      d.data[i + 3] = Math.round(d.data[i + 3] * tmul[3]);
    }
    tc.putImageData(d, 0, 0);
    invBgTinted = t;
  }
  const t = invBgTinted, W = t.width, H = t.height;
  const c = document.createElement('canvas');
  c.width = Math.max(20, Math.round(w)); c.height = Math.max(20, Math.round(h));
  const x = c.getContext('2d', { willReadFrequently: true })!;  // toDataURL 烘焙,SHM 后备不占 IOSurface
  x.imageSmoothingEnabled = false;
  // 四角(源 (0,0)/(W-10,0)/(0,H-10)/(W-10,H-10))
  x.drawImage(t, 0, 0, 10, 10, 0, 0, 10, 10);
  x.drawImage(t, W - 10, 0, 10, 10, c.width - 10, 0, 10, 10);
  x.drawImage(t, 0, H - 10, 10, 10, 0, c.height - 10, 10, 10);
  x.drawImage(t, W - 10, H - 10, 10, 10, c.width - 10, c.height - 10, 10, 10);
  // 四边(源 (10,0)/(10,H-10)/(0,10)/(W-10,10) 各 10×10 拉伸)
  x.drawImage(t, 10, 0, 10, 10, 10, 0, c.width - 20, 10);
  x.drawImage(t, 10, H - 10, 10, 10, 10, c.height - 10, c.width - 20, 10);
  x.drawImage(t, 0, 10, 10, 10, 0, 10, 10, c.height - 20);
  x.drawImage(t, W - 10, 10, 10, 10, c.width - 10, 10, 10, c.height - 20);
  // 中心 (10,10,10,10) 拉伸铺满
  x.drawImage(t, 10, 10, 10, 10, 10, 10, c.width - 20, c.height - 20);
  return c.toDataURL();
}
import { atlasIconForKey, sliceItemAnimFrame, upgradeToBitmap } from '../assets/SpriteAtlas';
import { resolveTouchMode } from '../core/input/touchMode';   // ★BJ669e2：触屏长按 tooltip 元素锚回落判据
import { VI } from '../data/itemKeys';
import { prefixStat, prefixValueMul, PREFIX_NAMES, formatPrefixedName, rollNaturalPrefixForVid } from '../data/vanillaPrefixes';   // ★BJ407：prefixLines 消费面收编入 buildTooltipHtml（itemTooltip.ts 自带 import）
import { bannerNpcOfItem } from '../world/Banners';
import { equipKindOfInternal, MISC_KINDS, accGroupClash, accPairConflicts } from '../data/vanillaEquip';   // ★清偿刀 Z：互斥组谓词单源提至数据层（本文件原模块内私有）
import { armorSlotIndexOfInternal, statOfInternal } from '../data/vanillaItemStats';
import { activeVariantOfVid, variantRareOfVid, VARIANT_L10N_KEY } from '../data/vanillaItemVariants';
import { assembleTooltipLines, buildTooltipBody, materialVids, planteraCursedTip } from './itemTooltip';   // ★SW-BJ24 2026-09-07：materialIids→materialVids（vid 域门消费面,双域分池见 itemTooltip 注）;★S4 planteraCursedTip（诅咒首行特例,tooltip+检索域双消费）
import { hudTier, safeInsets } from './HudScale';
import { bindHint } from './bindHint';
import { tryItemSwapVid } from '../render/CursorItemIcon';
import { BuffType, BUFF_DEFS, BUFF_NO_TIME_DISPLAY, BUFF_TEXT_PROJECTILE_COUNTER, buffName, buffDesc, bannerBuffNames, buffRightClickRemovable, buffTypeByVanilla } from '../stats/Buffs';
import { BUFF_TO_MOUNT } from '../entities/Mounts';   // ★BJ405-D1：坐骑 buff 通道哨兵源（BuffID.Sets.MountType 等价表）
import { mainDifficulty, GDL, mainMasterMode, roundCSf32Mul } from '../stats/ScaleStats'; // ★SW-FX21 +mainMasterMode（BossBag 右键上下文）
import { Lang } from '../i18n/Lang';
import { ITEM_NAME_BY_ID } from '../i18n/idNames.generated';
import { ACH_ICON_INDEX, achIconFrame } from '../data/vanillaAchievements';
import { ChatMonitor } from './ChatMonitor';
import { NpcDialog, NpcShop, NpcHappinessPanel, formatCopper, happinessPct, type NpcButtonId, type ShopEntry, type ShopCellHover, type HappinessInfo } from './NpcDialog';   // ★SW-FX32:happinessPct/ShopCellHover 内嵌货架共用
import type { DialoguePortraitPayload } from '../data/npcPortraits';
import { UISfx } from '../vui/UISfx';
import { COIN_START, AMMO_START, INV_SIZE, coinIndexOf, ammoSlotAccepts, canFillEmptyAmmoSlot, ACC_ARMOR_START, VANITY_ARMOR_START, ARMOR_SLOTS, isPrefixableAccessory } from '../items/Inventory';
import { chestSettingsAllowsVault, lootAllFromContainer, quickStackIntoContainer } from '../stats/QuickStacking';   // ★SW-BJ46 quickStackIntoContainer=ChestUI.QuickStack 纯函数（bank MoveCoins 前置/两遍语义/匹配域在内）
import {
  slotContext, planAlternateClick, chestCanTakeJustCheck, canTakeToPersonalInventory,
  chestContainerContext, canMergeStack, quickTrashOptionsOf, onlyNeedOneInInventory,
  CAN_FAVORITE_AT, CAN_LOADOUT_SHARE_AT, CAN_SHARE_AT, RETAIN_FAVORITE_ON_MOVE_AT,
  blockedFromTransferIntoChest,
  selectEquipPageOf, equipPageCapOf,
  type SlotWhereLike,
} from './SlotActions';   // SW-AU2 2026-09-06 Alt/Shift/Ctrl 槽位动作 1:1 路由
import {
  INV_SCALE, gridSlotXY, coinSlotXY, ammoSlotXY, trashXY,
  quickStackXY, sortXY, bestiaryXY, emoteXY,
  mHOf, equipAreaTop, equipRowY, accessoryCheckY,
  EQUIP_COL_X, VANITY_COL_X, DYE_COL_X, ACCESSORY_CHECK_X,
  loadoutBtnXY, defenseCenterXY,
  TAB_Y, TAB_MISC_X, TAB_HOUSING_X, TAB_CAMERA_X,
  TAB_MISC_SIZE, TAB_HOUSING_SIZE, TAB_CAMERA_SIZE,
  miscRowY, miscCheckXY, housingSlotPositions,
  MISC_COL_EQUIP_X, MISC_COL_DYE_X,
  hotbarLockXY, MISC_BUFF_X, MISC_BUFF_Y_OFF, MISC_BUFF_STEP, miscBuffRowsPerCol, miscBuffCellXY,
  pvpSwordXY, pvpTeamXY,
  vanillaScaleFor, ADVISOR_XY, TITLE_XY,
  COIN_LABEL_XY, AMMO_LABEL_XY, COIN_AMMO_SCALE,
  CHEST_SCALE, CHEST_NAME_XY, chestSlotXY, chestButtonXY,   // ★SW-FX28 刀①:箱条几何单源(ChestUI.cs 域)
  SHOP_TITLE_XY, shopSlotXY,                                // ★SW-FX32 刀①:货架/店名同格单源(Main.cs:42500-42532)
  shopHappinessIconXY, shopHappinessTextXY, happinessFrameX, // ★SW-FX32:快乐度图标/倍率位(Main.cs:42504-42512)
  shopSavingsLabelXY, shopSavingsCoinXY, shopSavingsCoinTextXY, SHOP_SAVINGS_BANK_ICONS, SHOP_SAVINGS_ICON_SCALE, // ★SW-FX32:储蓄行(ItemSlot.cs:3712-3757);★BJ421 计数锚
  CRAFT_PANEL_X, CRAFT_PANEL_INNER_TOP, craftPanelRect, craftDetailLayout, CRAFT_PANEL_Y,
  itemSearchPanelRect,   // ★SW-BJ81 规格③:道具搜索浮窗几何(物品栏占位面之外,单源)
  settingsAnchorOf, defenseRowOf,   // ★BJ416:设置钮锚/装备列尾行族单源(Main.cs:46254-46285/42091-42102);★BJ501:advisorRowOf/advisorInlineXY/hasSpaceForInlineAdvisor 内联接线退役(用户明令恒大卡位,函数留 vanillaInvLayout.ts 备查)
} from './vanillaInvLayout';   // ★2026-09-07 刀1:原版背包布局纯几何(数值单源)
import { cursorTooltipAnchor } from './tooltipAnchor';   // ★BJ704-G7 件4:光标锚公式纯函数单源(toolTipDistance 补齐)
import { ITEMSEARCH_GRAB_INTERVAL_MS, searchGrabPlan, buildItemSearchPool, buildItemSearchView } from './itemSearch';   // ★SW-BJ81 规格②⑤⑥:取件规则单源;★BJ154 池构建单源;★BJ207 view 构建单源
import {
  // ★SW-FX41(2026-09-12)UI 移债 modern 窗族 P2-1..P2-4:NewCraftingUI 纯逻辑单源
  MCRAFT_ALL_BUTTONS, MCRAFT_PANEL_BG, MCRAFT_SEARCH_BG,
  MCRAFT_SEPARATOR_COLOR, MCRAFT_TAB_TEX, MCRAFT_ICON_TEX, MCRAFT_CELL_SCALE,
  mcraftPanelRect, mcraftTitleXY, mcraftGridGeometry, mcraftCellXY,
  mcraftTabFrame, mcraftIconBgX, mcraftDetailOrigin, mcraftMaterialPos,
  mcraftOwnedCountPos, mcraftOwnedCountColor, mcraftWindowToggleXY,
  mcraftFilterBarRect, clampViewPosition, MCRAFT_MISSING_COLOR, MCRAFT_MISSING_KEY,
  MCRAFT_DISABLED_GRAY, MCRAFT_SEARCH_H, MCRAFT_STATE_H_OFF,
  // ★RB28(2026-09-15)用户实报呈现面对齐:九宫/搜索条/分隔线染色数值 + 搜索条几何
  MCRAFT_PANEL_TINT, MCRAFT_BORDER_TINT, MCRAFT_SEARCH_TINT, MCRAFT_SEPARATOR_TINT,
  MCRAFT_PANEL_CORNER, MCRAFT_SEARCH_CANCEL_INSET, mcraftSearchBarRect,
  // ★FX41b(2026-09-15)滚动条视觉单源(UIScrollbar Cyan 主题/DrawBar 三分)
  MCRAFT_SCROLLBAR_TEX, MCRAFT_SCROLLBAR_HANDLE_ALPHA,
  // ★FX43(2026-09-16)槽视觉面(ItemSlot ctx41/42/43 InventoryBack18 链 + 选中金框)
  MCRAFT_SLOT_TEX, MCRAFT_SLOT_TINT_CSS, MCRAFT_SLOT_ALPHA, MCRAFT_SLOT_HL_ALPHA,
  MCRAFT_SEL_TEX, MCRAFT_GUIDE_TEX,
  filterItemOfVid, filtererFits, toggleFilterRadio, normalizeSearch,
  openCloseFilterTransition, type FilterKind, type FilterItem,
} from './modernCrafting';
import { tintedSliceDataUrl } from './vanillaKit';   // ★RB28:UIPanel 白模预染色通道(vanillaKit 同 kit)
import {
  BACC, BUILDER_ACC_ICON_ORDER, builderAccDefaults, builderAccGateSet,
  builderAccTotalIcons, builderAccColumnTopY, cycleWireVisibility, toggleBuilderAccBit,
  playerVidCarried,
} from '../stats/builderAcc';   // ★SW-FX19:建筑配件开关位(图标列纯逻辑单源;★FX36:判定域=背包∪装备)
import { housingHeadRows } from './HousingPanel';   // ★刀3:住房页头像行(与 HousingPanel 同源)
import { sortContainerItems } from '../stats/ItemSorting';   // ★SW-RB13c:chestSortChest 换 FX29 精确引擎（sortingLayerIndex 旧近似随旧实现退役）
import { computeSellValue } from '../stats/SellChain';   // SW-BJ22 商店悬停卖出价全链
import { openAchievementsPanel, closeAchievementsPanel, createAchievementAdvisor, ADVISOR_SCALE_LARGE } from './AchievementsUI';   // ★BJ501:advisorHasCard/ADVISOR_SCALE_INLINE 接线退役(用户明令恒大卡,回滚口见 buildVanillaInventoryPanel)
import { openResearchPanel, closeResearchPanel, isResearchPanelOpen } from './ResearchUI';
import { openJourneyPowersPanel, closeJourneyPowersPanel } from './JourneyPowersUI';
import { openPlayerListPanel } from './PlayerListPanel';
import { openEmoteMenu } from './EmoteMenu';
import { CharCreation } from './CharCreation';
import type { Appearance } from '../player/Appearance';
import type { ChestData } from '../world/World';

type SlotWhere = 'inv' | 'chest' | 'armor' | 'dye' | 'misc' | 'miscDye';

const iconCache = new Map<number, string>();
/** AfterItemSwap 换型音表（R4-39/R4-17,IS57:1975-1985）：右键/放置换型落槽后
 *  newType ∈ 此表 → SoundID 22(Unlock),否则 7(Grab)。含 1457 新 6168/6169/6193/6194 */
const AFTER_ITEM_SWAP = new Set([5325, 4131, 5060, 5059, 5324, 5329, 5330, 4346, 5391, 5323,
  5455, 4767, 5453, 5309, 5454, 6190, 6195, 5358, 5359, 5360, 5361, 5437, 6168, 6169, 6193, 6194, 2611, 5526]);
/** canItemSwapAt（ItemSlot.cs:266 声明/:328 init/:423-428 置位,1458 同值）：
 *  HasItemSwap 右键换型受理语境 = 背包 0/宝箱 3/银行 4/虚空 32 + 装备位 8（盔甲）
 *  10（配饰）——时装 9/11、染料 12、杂项 16-20/33 不受理（时装位右键走
 *  SwapVanityEquip case 9/11）。语境值经 slotContext('armor',i) 映射同数域 */
const CAN_ITEM_SWAP_AT = new Set([0, 3, 4, 8, 10, 32]);
// 防御盾 img dataURL 烘焙(2026-08-19 压 IOSurface 基数:盾图从独立 canvas 改 img;
// 模块级 scratch 只此一张 52×48,产物按 (难度列,辉光) 缓存 ≤6 条)
const DEF_SHIELD_SCRATCH = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const DEF_SHIELD_URLS = new Map<string, string>();
/** 热补丁 buff 图标覆盖(vanillaBuffId → objectURL;RemasterRuntime 注册)。
 *  buff 栏是直链 <img src>,不经 atlas——重制 Buff_N.png 后需此钩子换图。 */
let remasterBuffIcon: ((vanillaBuffId: number) => string | null) | null = null;
export function setRemasterBuffIcon(fn: ((vanillaBuffId: number) => string | null) | null): void {
  remasterBuffIcon = fn;
}
/** 清物品图标 dataURL 缓存(热补丁替换 Item_Atlas 后旧图标钉死,须清后重合成)。 */
export function clearIconCache(): void { iconCache.clear(); }

/** 组假 id → 组号 */
function reqIdShift(reqId: number): number { return reqId - 1000000; }

/** 词缀显示名（Lang.prefix → l10n "Prefix.{ConstName}"，缺失回落常量名） */
function prefixDisplayName(prefix: number): string {
  const key = PREFIX_NAMES[String(prefix)];
  if (!key) return '';
  const t = Lang.text(`Prefix.${key}`);
  return t && t !== `Prefix.${key}` ? t : key;
}

/** 词缀+物品名拼装（Lang.GetPrefixedItemName Lang.cs:225-239 → CombineFormat.Prefix）。
 *  ★BJ390（2026-09-28）用户实报 <> 面定谳：旧实相裸拼接缺 per-language 格式——
 *  zh-Hans 官方 "‹{PrefixName}›{ItemName}"（U+2039/203A 尖单引号无空格,用户观察的
 *  "<>" 即此对引号）/ en-US "{PrefixName} {ItemName}"（空格）/ zh-Hant 无分隔。
 *  tooltip 头行（Main.cs:20819 GetHoverName 首行）与世界 label（popupAffixName）
 *  同一格式串（原版单 _prefixFormatText 全面共用） */
function affixedItemName(prefix: number | undefined, baseName: string): string {
  if (!prefix) return baseName;
  const pn = prefixDisplayName(prefix);
  if (!pn) return baseName;
  return formatPrefixedName(pn, baseName, Lang.has('CombineFormat.Prefix') ? Lang.text('CombineFormat.Prefix') : null);
}

/** 词缀后伤害值（Item.Prefix :551：damage = round(damage × dmg)） */
function prefixedDamage(def: (typeof ITEM_DEFS)[number], prefix?: number): number {
  if (!def.tool?.damage || !prefix) return def.tool?.damage ?? 0;
  // ★BJ343 件 2：原式 Item.cs:577 `(int)Math.Round((float)damage * dmg)`——f32 操作数
  //  + 银行家舍入（旧 Math.round=f64+half-up,半值/f32 精密处发散）
  return Math.max(1, roundCSf32Mul(def.tool.damage, prefixStat(prefix).dmg));
}
/** 内部 item id → 原版 item id（UI 层 vid 直读同 Shimmer 反解旧函数：vid 直取 +
 *  vi_ 前缀反解——避免 UI 模块图再挂 Shimmer 全链） */
function vidOf(itemId: number): number {
  const def = ITEM_DEFS[itemId];
  return def ? (def.vid ?? -1) : -1;
}

/** ★BJ613（2026-10-10）热栏图标电线计数（ItemSlot.cs:2665-2674）：热栏槽
 *  （invSlot 0-9=context 13 HotbarItem;undefined/≥10=非热栏 context 无计数）
 *  持扳手族/蓝图 3611 → 返回背包 530 电线总数（含 0;null=不绘走 stack 支）。 */
export function wireIconCounterOf(
  content: { id: number } | null, invSlot: number | undefined,
  inv: { countOf(id: number): number },
): number | null {
  if (!content || invSlot === undefined || invSlot >= 10) return null;
  if (!WIRE_ICON_COUNTER_VIDS.has(vidOf(content.id))) return null;
  const wireId = internalIdOfVid(530);
  return wireId >= 0 ? inv.countOf(wireId) : null;
}

/** 原版 item id → 内部 item id（vid→key→ITEM_BY_KEY；未注册 -1）。
 *  vidOf 的逆映射：iconUrl 收的是内部 id（ITEM_DEFS 下标），商店行等 vid 域
 *  数据必须先转——曾把 vid 直喂 iconUrl = ITEM_DEFS[vid] 错位取 def，图标
 *  全部张冠李戴（2026-08-28 用户报派对女孩商店） */
function internalIdOfVid(vid: number): number {
  const k = VANILLA_ITEM_KEY_BY_ID[vid];
  return k !== undefined ? (ITEM_BY_KEY[k] ?? -1) : -1;
}

/** ★S4 静态说明单源（原版 item.ToolTip ← l10n ItemTooltip.*,Main.cs:21149 循环体
 *  GetLine 域）。★从 buildTooltipHtml 内联域提取（原内联逐句迁入,行为零变化）——
 *  BySearch 检索域语料同吃本域（ItemFilters.BySearch.FitsFilter :28-48 直调全量
 *  GetLinesInfo,ToolTip 段在语料内）,双消费面单源防漂移。旗帜族
 *  {$NPCName.None} → 该旗 NPC 显示名注入（L171 语义;BJ334 负 netID 面随迁） */
function resolveStaticTip(vid: number): string | null {
  const nameKey = ITEM_NAME_BY_ID[vid];
  if (!nameKey) return null;
  const path = `ItemTooltip.${nameKey}`;
  // ★Q4-D A3 链源锁形制保持（`if (Lang.has(path))` 正形+先 has() 再取=缺失键静默空）
  if (Lang.has(path)) {
    let tip = Lang.text(path);
    if (tip && tip.includes('NPCName.None')) {
      const bn = bannerNpcOfItem(vid);
      if (bn > 0 || bn <= -2) tip = tip.split('NPCName.None').join(Lang.npcName(bn) ?? '');
    }
    return tip || null;
  }
  return null;
}

/** ★SW-FX41 BySearch 检索域填充(ItemFilters.BySearch :28-48 = tooltip 全行检索——
 *  Main.MouseText_DrawItemTooltip_GetLinesInfo 每查一次全量重算,本仓按 vid 缓存;
 *  行 0 = 物品名(GetLinesInfo 首行=AffixName)。player=null/无词缀槽 = 检索域近似
 *  (伤害等玩家增幅行不参与,登记偏差:原版同名增幅行文本随玩家变动,搜索面不敏感;
 *  金币枪 71-74 门面同属玩家态域)。
 *  ★S4（Q4 登记）：静态说明行入语料（原版 BySearch 吃全量 GetLinesInfo——
 *  ToolTip 段 Main.cs:21149-21162 在语料内=搜说明文案命中）+行序后段
 *  buffTime 持续（:21213-21220）→ expert（:21228-21231,item.expert 旗）→
 *  master（:21232-21235,item.rare==-13 字段值）→ 套装奖励（:21473-21517;
 *  BySearch 直调 GetLinesInfo 不走 ItemSlot.MouseHover=wornArmor/social 全缺省
 *  →非佩戴面=缺省 ctx 同相）→ 任务鱼行（:20663-20666,game.anglerQuestItemId 注入）。
 *  Plantera 诅咒首行替换特例（:21153-21156,见 planteraCursedTip）入语料。
 *  登记残留（语料仍缺,均需调用侧无的上下文/数据）：旅程研究行（:21163-21178,
 *  献祭进度数据域）、BestiaryNotes（:21519 后段）、特种子行（tenthAnniversary/
 *  getGood/Mechdusa,:21166-21212）、悠悠球商标空行（:21220-21227,空格行不可检索
 *  =零行为差）、词缀差分行（本域 stack1 无词缀=原版同缺）。 */
export function vinvFillTooltipLines(it: FilterItem, planteraDowned = false, anglerQuestItemId = 0): void {
  const iid = internalIdOfVid(it.vid);
  const def = iid >= 0 ? ITEM_DEFS[iid] : undefined;
  const lines: string[] = [];
  const nameKey = VANILLA_ITEM_KEY_BY_ID[it.vid];
  lines.push(nameKey ? (Lang.itemNameByKey(nameKey) ?? String(it.vid)) : String(it.vid));
  if (def && iid >= 0) {
    try {
      const body = buildTooltipBody(def, { id: iid, stack: 1 }, null, { anglerQuestItemId });
      for (const ln of body.lines) lines.push(ln.text);
      const staticTip = planteraCursedTip(it.vid, resolveStaticTip(it.vid), planteraDowned);
      if (staticTip) for (const t of staticTip.split('\n')) lines.push(t);
      if (body.durationLine) lines.push(body.durationLine.text);
      if (ITEM_EXPERT[String(it.vid)] === 1) lines.push(Lang.text('GameUI.Expert'));
      if (ITEM_RARE[String(it.vid)] === -13) lines.push(Lang.text('GameUI.Master'));
      for (const ln of body.setBonusLines) lines.push(ln.text);
    } catch { /* 检索域尽力填充(数据缺失件=仅名字行) */ }
  }
  it.tooltipLines = lines;
}

/** 物品图标 dataURL(32×32;模块内多处槽位/钮面共用)。2026-08-29 起导出供
 *  MobileControls 官方手游形态的"使用"钮实时上当前物品(icons 在 ui 域内闭环) */
export function iconUrl(game: Game, id: number): string {
  let url = iconCache.get(id);
  if (!url) {
    // 优先原版素材图标（合成 32×32 dataURL）
    const def = ITEM_DEFS[id];
    if (game.atlas && def) {
      let ar = atlasIconForKey(game.atlas, def.key);
      // ★2026-10-14:mod 物品图标通道(atlasIconForKey 无 mod 分支→此前落 assets
      //  兜底=原版图集无 mod id=空串裂图;道具搜索 UI 用户实报)。mod 贴图注入
      //  别名=vanilla/Item_<stableId>.png(mods/assets.ts),vicon(vid) 直取——
      //  背包/世界绘制同款通道(此处补齐 dataURL 面的同一解析)。
      if (!ar && def.key.startsWith('mod_')) {
        ar = game.atlas.vicon(def.vid ?? -1);
      }
      if (ar && def.key.startsWith('vi_')) {
        // 物品贴图动画(坠星 75 等竖条):图标取帧 0 单帧(背包内原版也在转,
        // 此处静态帧 0——此前整条入画被压成 32×32 细条)
        const vm = /^vi_(\d+)_/.exec(def.key);
        if (vm) ar = sliceItemAnimFrame(Number(vm[1]), ar, 0);
      }
      if (ar) {
        const imgOk = !(ar.img instanceof HTMLImageElement)
          || ((ar.img.width > 0) && ar.img.width > 0);
        if (!imgOk) ar = null;   // 破图（素材热切换瞬态）走兜底路径
      }
      if (ar) {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const cx = c.getContext('2d', { willReadFrequently: true })!;  // 图标烘焙,SHM 后备
        cx.imageSmoothingEnabled = false;
        // 原版背包图标 = 贴图原始尺寸渲染（ItemSlot.Draw scale=1,只缩不放）：
        // 钱币 12px 圆点就该小,大翅膀才被压回 32。曾 min(32/sw,32/sh) 一律拉满
        // → 钱币/弹药/小物件视觉虚胖（2026-08-13 用户抓到"钱币没这么大"）
        const s = Math.min(1, 32 / ar.sw, 32 / ar.sh);
        const w = ar.sw * s, h = ar.sh * s;
        cx.drawImage(ar.img, ar.sx, ar.sy, ar.sw, ar.sh, (32 - w) / 2, (32 - h) / 2, w, h);
        // 原版 Item.color 静态表着色（Main.cs:39211 第二遍 alpha 混合的等价单遍
        // 合成）：凝胶 23 灰图染蓝 (0,80,255,100) 等 10 件——此前背包图标无着色，
        // 凝胶显示灰块（2026-08-19 用户报告）
        const tvid = vidOf(id);
        const tint = tvid > 0 ? VANILLA_ITEM_COLOR[tvid] : undefined;
        // ★SW-FX49 Item.alpha 维度（VANILLA_ITEM_ALPHA 表,Item.cs SetDefaults
        // 全赋值位）：GetAlpha 默认支（Item.cs:49328）pass1 底图 alpha×
        // (255−alpha)/255（ItemSlot.cs:2879）——凝胶 175/星怒 100/幽灵翼 255
        // （全透明,tooltip"I am right here."）等 18 件。与 color 无耦合：
        // 仅 alpha>0（恶魔弓 44 等）同样进本支;c=null 走纯 pass1
        const itemAlpha = tvid > 0 ? VANILLA_ITEM_ALPHA[tvid] : undefined;
        if ((tint && tint[3] > 0) || (itemAlpha && itemAlpha > 0)) {
          const id32 = cx.getImageData(0, 0, 32, 32);
          blendItemColorTint(id32.data, tint ?? null, itemAlpha ?? 0);
          cx.putImageData(id32, 0, 0);
        }
        // ★BJ603 件1 UI 槽位光罩（ItemSlot.cs:2890-2931 同构叠画,第四消费站——
        //   BJ601 登记④收编）：门 = glowMask!=-1 && type!=3779 && type!=46 &&
        //   type!=5462（:2890 外门——UI 面排除集 = {3779,46,5462}）;色式 = 掉落
        //   面同构 switch（:2893-2915,dropGlowColors 单源复用;UI 专有 3858 动画
        //   帧 = Glow_233 三帧条 Frame(1,3,0,帧)高−2 :2918-2921——本烘焙为静态
        //   图标=帧 0 定格,与坠星 75"静态帧 0"既有图标惯例同槽登记）;几何 =
        //   光罩中心≡物品图标中心（origin=rect.Size()/2 :2927/:2931）、scale 同
        //   物品（只缩不放）;合成 = xnaColorToOp(A=0 'lighter' 加算/A>0 over)。
        //   槽位量级大 → iconCache 单次烘焙全槽共用（BJ601 bake 习语）。
        if (tvid > 0 && (ITEM_GLOWMASK[tvid] !== undefined || modItemGlowMaskIdOf(tvid) !== undefined) && !UI_GLOW_EXCLUDED.has(tvid)) {
          const gmImg = game.atlas?.ensureVImage(`vanilla/Glow_${ITEM_GLOWMASK[tvid] ?? modItemGlowMaskIdOf(tvid)}.png`);
          if (gmImg && gmImg.width > 0) {
            const gRect = tvid === 3858
              ? monkT3GlowRect(0)
              : { sy: 0, sh: gmImg.height };
            const gsw = ar.sw, gsh = tvid === 3858 ? MONK_T3_GLOW.frameHm2 : ar.sh;
            const colors = dropGlowColors(tvid, {
              miscCounter: 0, globalTimeWrappedHourly: 0, discoRGB: null,
            });
            for (const col of colors) {
              const op = xnaColorToOp(col);
              cx.save();
              cx.globalCompositeOperation = op.blend === 'add' ? 'lighter' : 'source-over';
              cx.globalAlpha = Math.max(0, Math.min(1, op.alpha));
              const gw = gsw * s, gh = gsh * s;
              cx.drawImage(gmImg, 0, gRect.sy, gsw, gsh,
                16 - gw / 2, 16 - gh / 2, gw, gh);
              cx.restore();
            }
          }
        }
        url = c.toDataURL();
        iconCache.set(id, url);
        return url;
      }
      // 懒加载未就绪:返回程序化兜底但【不缓存】(此前把空串/兜底缓存死,
      // 图标加载完成后道具栏永远不升级为原版图标)。预载流程完成后此路径不再触发
      const c = game.assets.itemIcon(id);
      return c ? c.toDataURL() : '';
    }
    const c = game.assets.itemIcon(id);
    url = c ? c.toDataURL() : '';
    if (url) iconCache.set(id, url);  // 无 atlas(永久)才缓存兜底;空串不缓存
  }
  return url;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 空槽类型幽灵帧表（ItemSlot.cs:2240-2310 context/slot → Extra[54] 帧号）：
 *  帧格 3 列 × 7 行（列=帧%3 行=帧/3,格 34px 取 32px）。
 *  context 对应：armor 0-2=8(头盔0/胸甲6/护腿12) 3-9=10(配饰11) 10-12=9(时装头盔3/
 *  胸甲9/护腿15) 13-19=11(时装配饰2——★case 11 无槽位上限,恶魔心 18/大师 19 同帧,
 *  曾误帽 i≤17 ⇒ 9 行面板末行中格无底图 2026-09-17 用户实报);dye/miscDye=12/33(染料1);
 *  misc 0-4 = context 19/20/18/17/16(宠物10/光源17/矿车7/坐骑13/抓钩4)。
 *  背包(0)/钱币(1)/弹药(2)/垃圾桶 无映射 → -1 */
export function slotGhostFrame(where: SlotWhere, i: number): number {
  if (where === 'armor') {
    if (i <= 2) return [0, 6, 12][i];
    if (i <= 9) return 11;
    if (i <= 12) return [3, 9, 15][i - 10];
    if (i <= 19) return 2;   // 社交配饰段 13-19 同帧（ItemSlot.cs:2451 case 11 无 slot 条件）
    return -1;
  }
  if (where === 'dye' || where === 'miscDye') return 1;
  if (where === 'misc') return [10, 17, 7, 13, 4][i] ?? -1;
  return -1;
}

/** 空槽幽灵帧元素（ItemSlot.Draw :2451-2482：TextureAssets.Extra[54] 3×7 图集，
 *  帧号由 context/slot 映射（slotGhostFrame 同源表）；帧格 34px 取 32px（:2479-2480
 *  rectangle.Width/Height -= 2 右下内缩）,α=0.35（:2478 num19）,槽心居中）。
 *  ★清偿刀 H②：α=0.35×itemFade（:2481 `White × (num19 × itemFade)`）——经槽元
 *  --sw-ifade 乘区（paintSlotChrome 写值,缺省 1=本刀前同观感） */
function makeSlotGhostEl(frame: number): HTMLElement {
  const g = el('div', 'sw-slot-ghost');
  const col = frame % 3, row = Math.floor(frame / 3);
  g.style.cssText = `position:absolute; inset:0; margin:auto; width:32px; height:32px;`
    + `background:url(sprites/vanilla/Extra_54.png) ${-col * 34}px ${-row * 34}px;`
    + `opacity:calc(0.35 * var(--sw-ifade, 1)); image-rendering:pixelated; pointer-events:none;`;
  return g;
}

/** misc 逐槽语境（slotGhostFrame 头注同源:0-4=宠物/光源/矿车/坐骑/抓钩 →
 *  context 19/20/18/17/16——slotContext('misc') 代表值 16 的逐槽展开,★清偿刀 H②
 *  GetDimSlotForMouseItem 装配用） */
const MISC_SLOT_CONTEXTS = [19, 20, 18, 17, 16] as const;

/** ★清偿刀 C（2026-09-29）槽位 CD 覆盖基建——原版 ItemSlot.cs:2693-2725「冷却覆盖
 *  贴图」族 1:1（本仓整套缺,连药水冷却的槽位覆盖也没有,U 刀债②）。四个分支逐字锚：
 *  ①context 13 + item.potion（:2702-2707）——CoolDown 贴图槽心居中,
 *    α = item.GetAlpha(color) × potionDelay/potionDelayTime。potionDelay = buff 21
 *    剩余（Player.cs:11807-11809 逐 tick 同步,非 Debug 门）;potionDelayTime 每 tick
 *    重算 = Item.potionDelay(3600,Item.cs:89) ×贤者石 0.75（Player.cs:25674-25683,
 *    PhilosopherStoneDurationMultiplier）。GetAlpha 对 potion 族（item.alpha=0）=
 *    lightColor 原样（Item.cs:49329-49343 default 支）——关包快捷栏 lightColor =
 *    (255,255,255,75+150×scale)（Main.cs:44351-44352）:选中 scale1→A=225,未选
 *    0.75→A=187（:44340-44348 稳态,±0.05/帧缓动本仓无建模）。
 *  ②context 13 + item.healMana>0（:2708-2713）——α = GetAlpha × Remap(
 *    manaPotionDelay,300,0,1,0)（Utils.Remap :345-348,GetLerpValue clamp）。★定谳：
 *    manaPotionDelay 非零写支全在 DebugOptions.ManaPotionDelay 门内（Player.cs:10408-
 *    10411 同步/:52577-52581 饮用;DebugOptions.cs:28 缺省 false）→ 原版常规局恒 0 =
 *    本支【死支】（α≡0 不显）。本仓无 DebugOptions 通道 → 计时源恒 0,分支照建,
 *    谓词/公式全 1:1（测试可注入点亮）。
 *  ③context 34 CreativeInfiniteLocked（:2714-2718）——α = GetAlpha × 0.5 定值
 *    （旅程创造锁格）。本仓无该槽面 → 分支在纯函数在位,消费面缺=边界声明。
 *  ④(context 10|18) + item.expertOnly ∧ !Main.expertMode（:2720-2725）——α =
 *    Color.White × itemFade。10=EquipAccessory/18=EquipMinecart（ItemSlot.Context
 *    :57/:73）;itemFade = GetDimSlotForMouseItem（:1336-1397,持物不可装备时 0.5）
 *    ——★清偿刀 H② 起接入真值（getDimSlotForMouseItem,本文件同层）。expertMode ≙
 *    gateExpert∨gateMaster（清偿刀 U 口径）。1457 全树零 expertOnly=true 赋值
 *    （Item.cs:129/:48960 外无）
 *    → 原版内容零触发=模组物品建模门（U/X 刀同判）。
 *  贴图 = Images\CoolDown（AssetInitializer.cs:780 TextureAssets.Cd;32×32,
 *  public/sprites/vanilla/CoolDown.png 在库）。几何 = position+52s/2−32s/2 =
 *  盒内 (10,10) 32px（:2704 同式,FX43 图标盒 61.5% 同源锚 :2747-2751）;绘序在
 *  物品图标+堆叠数【之后】（:2681/:2702）= 槽内最顶层。 */
/** Utils.Remap（Utils.cs:345-348 Lerp(toMin,toMax,GetLerpValue(fromMin,fromMax,v,clamped))） */
function remapF(v: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  const t = Math.min(1, Math.max(0, (v - fromMin) / (fromMax - fromMin)));
  return toMin + (toMax - toMin) * t;
}

export interface SlotCooldownInput {
  context: number;
  vid: number;
  /** Item.potion（ItemFunc.potion;vanilla-itemfunc.json 提取面） */
  potion: boolean;
  /** Item.healMana（ItemFunc.healMana） */
  healMana: number;
  /** Item.expertOnly（ITEM_DEFS[].expertOnly,U 刀数据面:1457 零真值,模组建模门） */
  expertOnly: boolean;
  /** Player.potionDelay（buff 21 剩余 tick） */
  potionDelayTicks: number;
  /** Player.potionDelayTime（:25675 每 tick 重算 3600×pStone0.75） */
  potionDelayTimeTicks: number;
  /** Player.manaPotionDelay（DebugOptions.ManaPotionDelay=false → 恒 0,死支） */
  manaPotionDelayTicks: number;
  /** Main.expertMode ≙ gateExpert∨gateMaster */
  expertMode: boolean;
  /** GetDimSlotForMouseItem itemFade（★清偿刀 H② 起真值——getDimSlotForMouseItem;
   *  持物不可装备 0.5/其余 1） */
  itemFade: number;
}

/** 槽位 CD 覆盖 α（分支序=原版 Draw 内 if 序:2702→2708→2714→2720。①②可同拍
 *  双真（恢复药水 potion∧healMana>0）——原版两次 Draw 叠画;②死支 α≡0,故先到先
 *  返回=可观测同相（注:①以 potionDelay/potionDelayTime 为准与 227 分档无关） */
export function slotCooldownAlpha(inp: SlotCooldownInput): number {
  if (inp.context === 13 && inp.potion) {
    return inp.potionDelayTimeTicks > 0 ? inp.potionDelayTicks / inp.potionDelayTimeTicks : 0;
  }
  if (inp.context === 13 && inp.healMana > 0) {
    return remapF(inp.manaPotionDelayTicks, 300, 0, 1, 0);
  }
  if (inp.context === 34) {
    return 0.5;
  }
  if ((inp.context === 10 || inp.context === 18) && inp.expertOnly && !inp.expertMode) {
    return inp.itemFade;
  }
  return 0;
}

// ---- ★清偿刀 H②（2026-09-29）GetDimSlotForMouseItem 持物变暗面 1:1 ----
// 原版 ItemSlot.cs:1336-1397：ItemSlot.Draw 头逐帧调（:2334-2336）——
//   `float itemFade = 1f; GetDimSlotForMouseItem(context, slot, Main.mouseItem,
//   out itemFade); color2 *= itemFade;`——鼠标拖拽物（Main.mouseItem）进不了
//   目标槽时该槽整面变暗（α×0.5）。消费点全谱（本刀接线,括号=仓内承载）：
//   · 槽底 color2（:2336→:2339 绘）——eqdock/vinv ::after opacity × fade;
//   · 空槽类型幽灵图（:2481 `White × (0.35 × itemFade)`）——.sw-slot-ghost calc;
//   · 物品图标（:2499 DrawItemIcon(…, itemFade) → :2880 `color * itemFade`）——
//     .sw-slot img opacity × fade;
//   · 共享配装角标（:2465/:2733 `White × (0.7 × num17)`——num17=itemFade 在
//     `itemFade *= 0.6`【前】的快照）+共享件幽灵（:2467 图标 α=itemFade×0.6）——
//     .sw-share-frame/.sw-share-ghost calc;
//   · CD 覆盖 context 10/18 expertOnly（:2724 `white * itemFade`）——
//     slotCooldownAlpha 的 itemFade 入参（tickSlotCooldownOverlays 接线）。
//   堆叠数字/槽号【不】变暗（:2680/:2698 用基色,无 itemFade 乘）——仓内 .cnt/
//   .sw-slot-num 不挂乘区同相。眼钮/勾选框（Main.cs:42118-42155,非 ItemSlot.Draw
//   域）不变暗。
export interface DimSlotInput {
  /** ItemSlot.Context（slotContext 装配;misc 逐槽 19/20/18/17/16 见 MISC_SLOT_CONTEXTS） */
  context: number;
  /** Player.IsItemSlotUnlockedAndUsable(slot)（context 8-12 解锁臂;仓内同源
   *  Inventory.isItemSlotUnlockedAndUsable——清偿刀 P 已证 :1348/:1357 同判） */
  slotUnlocked: boolean;
  /** 光标持物能否入该槽（原版逐 context 谓词的正面值;仓内=放置域同源判定
   *  armorAcceptsDrag/dyeAccepts/miscAccepts——Z/P/X 刀 1:1 面,否定即变暗） */
  mouseFitsSlot: boolean;
}

/** GetDimSlotForMouseItem 1:1（ItemSlot.cs:1336-1397 switch 逐支）。checkItem.IsAir
 *  早退支（:1337-1339 itemFade=1）由装配侧 heldStack 判空承载。缺省支=背包 0/钱币 1/
 *  弹药 2/箱 3/4/32/垃圾桶 6/向导 7/快捷栏 13/商店 15∉原版 switch（持物拖过永不暗）;
 *  展示娃娃 23/24/25/38 与帽架 26/27/矿车 39 本仓无槽面（边界声明,语义在库可后续接）。 */
export function getDimSlotForMouseItem(inp: DimSlotInput): number {
  switch (inp.context) {
    case 8:    // EquipArmor（:1348）
    case 9:    // EquipArmorVanity（:1348）
    case 10:   // EquipAccessory（:1348）
    case 11:   // EquipAccessoryVanity（:1348）
      return (!inp.slotUnlocked || !inp.mouseFitsSlot) ? 0.5 : 1;
    case 12:   // EquipDye（:1357——同带解锁臂）
      return (!inp.slotUnlocked || !inp.mouseFitsSlot) ? 0.5 : 1;
    case 16:   // EquipGrapple（:1361）
    case 17:   // EquipMount（:1363）
    case 18:   // EquipMinecart（:1365）
    case 19:   // EquipPet（:1367）
    case 20:   // EquipLight（:1369）
    case 33:   // EquipMiscDye（:1359——无解锁臂,同 25/27）
      return inp.mouseFitsSlot ? 1 : 0.5;
    default:
      return 1;
  }
}

/** 槽位 CD 覆盖层元素（CoolDown.png 32×32,槽内 (10,10) 32px = inset 19.2%/61.538%,
 *  同 FX43 图标盒几何;z-index 3 压过 img/.cnt（原版绘序 CD 最后）,眼钮 z5 不让） */
function makeSlotCdEl(): HTMLElement {
  const c = el('div', 'sw-slot-cd');
  c.style.cssText = 'position:absolute; inset:19.2%; width:61.538%; height:61.538%; margin:auto;'
    + 'background:url(sprites/vanilla/CoolDown.png) 0 0 / 100% 100%;'
    + 'image-rendering:pixelated; pointer-events:none; display:none; z-index:3;';
  return c;
}

/** 向导材料槽（context 7）幽灵帧号（ItemSlot.cs:2451 case 7 → num15=18 → col=0,row=6
 *  = 背景位 0px -204px）。向导反查浮层槽/vinv 经典位槽/modern 窗槽三处共用（②刀） */
const GUIDE_SLOT_GHOST_FRAME = 18;

const CSS = `
.sw-root { position:fixed; inset:0; pointer-events:none; font-family:inherit; z-index:10; }
/* ★D19-F4(2026-10-13):mod 面板叠 DOM 双消费吞门——vui 面板画布 z=300 PE:none,
   面板叠 DOM 槽时点击=面板 onClick+底层 DOM 槽双触发。指针落 mod 面板子树期间
   (mods/ui.ts modUiSyncDomGate 挂 html 类)DOM 命中测试全关,离板还原 */
html.sw-modpanel-swallow #game-root > *, html.sw-modpanel-swallow #game-root > * * { pointer-events: none !important; }
/* ★R-C-F4-a:作用域=#game-root 全子树(旧仅 .sw-root——设置 z25/图鉴 z30/旅程/研究/
   NPC 对话等 DOM 模态与 .sw-root 平级裸奔=叠面板双消费仍在;vui 面板画布 z300 视觉
   在顶,DOM 层全吞=「mod 面板持有输入」语义;vui window 层输入不受 PE 影响 ✓) */
/* ---- 原版风格：深蓝面板 + 浅蓝描边 ---- */
.sw-panel { pointer-events:auto;
  /* 原版 UIPanel：PanelBackground × Color(63,82,151)*0.785 —— 半透底 */
  background:linear-gradient(rgba(38,50,90,0.78), rgba(22,30,58,0.8));
  border:2px solid #7d92d6; border-radius:6px; color:#e8ecf8; padding:12px;
  box-shadow:0 0 0 2px rgba(10,14,30,0.8), 0 6px 28px rgba(0,0,0,0.65),
    inset 0 0 18px rgba(90,120,220,0.12); }
.sw-btn { pointer-events:auto; display:block; width:100%; margin:6px 0; padding:10px 16px;
  background:linear-gradient(#4a3a6a,#3a2a5a); color:#fff; border:1px solid #6a5a8a;
  border-radius:6px; cursor:pointer; font-size:15px; text-align:center; }
.sw-btn:hover { background:linear-gradient(#5a4a7e,#4a3a6e); }
.sw-btn:disabled { opacity:0.45; cursor:default; }
.sw-root { --slot: 39px; }   /* 槽基准 = 热键栏未选中格视觉尺寸（52×0.75,2026-08-27 用户要求统一） */
.sw-slot { pointer-events:auto; width:var(--slot); height:var(--slot); background:url(sprites/vanilla/Inventory_Back.png) 0 0 / 100% 100%;
  position:relative; cursor:pointer; image-rendering:pixelated; }
/* 原版槽底乘色通道（ItemSlot.Draw :1945+：背景贴图 × inventoryBack 灰色 180-220，
 *  默认 220/255≈0.86 亮度；Loadout 染色/锁定灰 80 均经此 overlay 实现 MultiplyRGBA） */
.sw-slot::before { content:''; position:absolute; inset:0; pointer-events:none;
  background:var(--slot-tint, rgb(220,220,220)); mix-blend-mode:multiply; }
.sw-hotbar .sw-slot::before { display:none; } /* 快捷栏 Back14/20 贴图自带 alpha 语义 */
.sw-slot:hover { filter:brightness(1.15); }
/* 图标 inset/尺寸按槽盒百分比（15.4%=8/52、69.2%=36/52）——随 --slot 缩放不变形。
 * ★清偿刀 H②：图标 α=itemFade（ItemSlot.cs:2499 DrawItemIcon→:2880 color*itemFade;
 *  装备族拖拽不可入槽件时槽元 --sw-ifade=0.5,inv/chest 语境不装配恒 1=原同观感） */
.sw-slot img { position:absolute; inset:15.4%; width:69.2%; height:69.2%; image-rendering:pixelated; opacity:var(--sw-ifade, 1); }
/* 垃圾桶槽（44/52=0.846 比例）：图标居中（inset 4 会贴右下角偏 4px,2026-08-21 用户报） */
.sw-slot.sw-trash { width:calc(var(--slot) * 0.846); height:calc(var(--slot) * 0.846); }
.sw-slot.sw-trash img:not(.sw-trash-icon) { inset:9.1%; width:81.8%; height:81.8%; }
.sw-slot .cnt { position:absolute; left:4px; bottom:0; font-size:11px; font-weight:bold; color:#fff;
  text-shadow:1px 1px 0 #000; transform-origin:left bottom; }   /* 11px = 热键栏数字号（.sw-slot-num 同款） */
/* ★清偿刀 C 槽位 CD 覆盖层（CoolDown.png;几何/绘序见 makeSlotCdEl 注）——
 *  opacity 由 tickSlotCooldownOverlays 逐帧写（dataset.cd 同值守卫） */
.sw-slot-cd { will-change: opacity; }
/* Loadout 三色（ItemSlot.LoadoutSlotColors :322-340，×inventoryBack 灰 = multiply）：
 * 切换瞬间白闪（GetColorByLoadout :2546：Remap(dt,0,30,0.5,0)³ lerp→白） */
@keyframes sw-loadout-flash { 0% { background:rgb(255 255 255 / 0.5); }
  100% { background:rgb(255 255 255 / 0); } }
.sw-loadout-flash .sw-slot::before { animation:sw-loadout-flash 0.5s ease-out; }
/* ★Q-F9 槽级阻塞回执（ItemSlot.IndicateBlockedSlot :527 → AddPulseEffect(250,40,40)；
 *  Draw :2343-2352 InventoryBack21 叠层 alpha 包络 40t 收束）。::before 默认 multiply
 *  会把红压暗——动画期内切 normal 以直绘红衰层呈现（IndicateBlockedSlot 语义=红脉冲
 *  非乘色）。形差=单脉冲 ease-out 替代双 cos 波（见 indicateBlockedSlots 注） */
@keyframes sw-blocked-pulse { 0% { background:rgb(250 40 40 / 0.7); } 100% { background:rgb(250 40 40 / 0); } }
.sw-slot.sw-blocked-pulse::before { animation:sw-blocked-pulse 0.67s ease-out; mix-blend-mode:normal; }
/* 物品转移 hue 脉冲（ItemSlot.cs :2144-2152：贴图换 Back13 +
 *  Lerp(基色(63,65,151)×invAlpha, hslToRgb(hue,1,0.5), (time/300)²/2)——
 *  CSS 近似：色层 alpha 沿二次曲线 0.5→0 衰减，5s（300 tick） */
@keyframes sw-slot-glow { 0% { opacity:0.5; } 100% { opacity:0; } }
.sw-slot .sw-glow-overlay { position:absolute; inset:0; pointer-events:none;
  background:var(--glow); animation:sw-slot-glow 5s cubic-bezier(0.5,0,1,1) forwards; }
/* 金币/弹药槽 0.6 缩放（Main.cs:41193/41211 inventoryScale=0.6 → 0.596×基准、列距同比） */
.sw-slot.sm { width:calc(var(--slot) * 0.596); height:calc(var(--slot) * 0.596); }
.sw-slot.sm img { inset:12.9%; width:74.2%; height:74.2%; }
.sw-slot.sm .cnt { font-size:10px; left:2px; }
.sw-slot.sm::before { border-radius:2px; }
/* Modern 合成网格材料格（0.731×基准）——图标 inset 7.9%/84.2% 居中（原 38 盒 inset3/32px），
 *  计数同 .sm 缩一号 */
.sw-slot.chip { width:calc(var(--slot) * 0.731); height:calc(var(--slot) * 0.731); }
.sw-slot.chip img { inset:7.9%; width:84.2%; height:84.2%; }
.sw-slot.chip .cnt { font-size:10px; left:3px; }
/* ---- 快捷栏（原版 GUIHotbarDrawInner Main.cs:42996-43060 1:1）----
 * 贴图 52px：未选中 scale0.75（视觉 39px、y+6、alpha 147/255≈0.575）+ Back20；
 * 选中 scale1.0（52px、y=20、alpha1）+ Back14；x 步进 ⌊52×scale⌋+4（43/56）；
 * 格号 1-9,0（ItemSlot :2487 顶左 (8,4)×scale）；选中名居中 x=236 脉动 */
.sw-hotbar { position:fixed; top:0; left:0; pointer-events:auto; }
.sw-hotbar .sw-slot { position:absolute; transition:transform 80ms linear, opacity 80ms linear, left 80ms linear, top 80ms linear; }
.sw-hotbar .sw-slot:hover { filter:none; }
.sw-hotbar .sw-slot .sw-slot-num { position:absolute; left:5px; top:2px; font-size:11px; font-weight:bold;
  color:#fff; text-shadow:1px 1px 0 #000; pointer-events:none; }
/* 手机紧凑档(mobile-adaptation-plan P0):视觉≈41px 格 → 伪元素扩边补触控热区
 * 到 ≥44pt(只扩命中不扩视觉);D0 无 compact class=无此伪元素,桌面零新增 */
.sw-hotbar.compact .sw-slot::after { content:''; position:absolute; inset:-6px; }
/* 槽位防触摸手势干扰:压掉浏览器滚动/双击缩放保留 tap 合成链(拖放依赖)。
 * ★只设 touch-action 不 preventDefault —— 浏览器合成 mousedown/mousemove/mouseup
 * 序列完整保留,触屏拖放与桌面同语义(2026-08-29 探针实证前提) */
.sw-slot { touch-action:none; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }
.sw-hotbar-name { position:fixed; left:236px; top:0; transform:translateX(-50%); white-space:nowrap;
  font-size:15px; color:#fff; text-shadow:2px 2px 0 #000; pointer-events:none;
  animation:sw-name-pulse 2s ease-in-out infinite alternate; }
@keyframes sw-name-pulse { from { opacity:0.35; } to { opacity:1; } }
/* ---- 说明书按钮（快捷栏右侧;与未选中槽完全同构:52 贴图 scale0.75 不裁剪,
 * alpha0.575——44px 盒装 52 背景会裁掉槽边框=首版"效果不对"根因）----
 * 未读红点感叹号气泡 = CSS 步进闪烁(显著提醒,读过后熄灭);徽标挂 wrap 不随缩放 */
.sw-manual-wrap { position:fixed; left:467px; top:25px; width:40px; height:40px;
  pointer-events:none; z-index:11; }
.sw-manual-btn { position:absolute; left:0; top:0; width:52px; height:52px;
  transform:scale(0.75); transform-origin:top left;
  pointer-events:auto; cursor:pointer; border:none; padding:0; background-color:transparent;
  background:url(sprites/vanilla/Inventory_Back20.png) 0 0/52px 52px no-repeat;
  image-rendering:pixelated; user-select:none; opacity:0.575;
  font-family:"Fusion Pixel 12px","Microsoft YaHei",sans-serif;
  font-size:26px; font-weight:bold; color:#e8ecf8;
  text-shadow:2px 2px 0 #000; line-height:52px; text-align:center;
  transition:opacity 80ms linear; }
.sw-manual-btn:hover { opacity:1; filter:brightness(1.15); }
.sw-manual-badge { position:absolute; right:-9px; top:-9px; width:20px; height:20px;
  border-radius:50%; background:#d21f2c; border:2px solid #fff;
  color:#fff; font-size:14px; font-weight:bold; line-height:17px; text-align:center;
  text-shadow:none; pointer-events:none;
  animation:sw-badge-blink 0.9s steps(2, jump-none) infinite; }
@keyframes sw-badge-blink { 0% { opacity:1; transform:scale(1.15); } 100% { opacity:0.25; transform:scale(0.85); } }
/* 说明书面板（暂停面板同款:Inventory_Back13 九宫 ×(33,15,91)×0.685 半透;
 * 素材未就绪时 fallback 底色,首次打开后回补） */
.sw-manual-panel { pointer-events:auto; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
  width:520px; max-width:92vw; z-index:32; box-sizing:border-box;
  background-repeat:no-repeat; background-size:100% 100%; image-rendering:pixelated;
  font-family:"Fusion Pixel 12px","Microsoft YaHei",sans-serif; user-select:none; color:#e8ecf8; }
.sw-manual-panel.fallback-bg { background:#2a1a63; }
.sw-manual-title { text-align:center; font-size:20px; letter-spacing:3px; color:#fff; padding:14px 0 6px;
  text-shadow:2px 0 0 #000,-2px 0 0 #000,0 2px 0 #000,0 -2px 0 #000; }
.sw-manual-body { max-height:56vh; overflow-y:auto; padding:4px 18px 8px; scrollbar-width:thin; }
.sw-manual-sec { font-size:15px; color:#ffd76e; margin:10px 0 4px; letter-spacing:2px;
  text-shadow:1px 1px 0 #000; border-bottom:1px solid rgba(125,146,214,0.35); padding-bottom:2px; }
.sw-manual-row { display:flex; justify-content:space-between; align-items:center; gap:12px;
  padding:3px 0; font-size:14px; }
.sw-manual-row .desc { color:#cfd6ee; }
.sw-manual-key { white-space:nowrap; font-size:12px; color:#fff; background:rgba(10,14,30,0.75);
  border:1px solid #7d92d6; border-radius:4px; padding:2px 8px; text-shadow:1px 1px 0 #000; }
.sw-manual-key.none { color:#8890b8; border-style:dashed; }
.sw-manual-foot { display:flex; align-items:center; justify-content:space-between;
  padding:10px 18px 14px; gap:10px; }
.sw-manual-hide { display:flex; align-items:center; gap:6px; font-size:13px; color:#cfd6ee; cursor:pointer; }
.sw-manual-hide input { width:16px; height:16px; accent-color:#7d92d6; cursor:pointer; }
.sw-manual-ok { background:#3d2f8f; border:2px solid #7d92d6; border-radius:5px; cursor:pointer;
  color:#fff; font-family:inherit; font-size:16px; letter-spacing:2px; padding:6px 26px;
  text-shadow:1px 1px 0 #000; transition:background .1s; }
.sw-manual-ok:hover { background:#5443b8; }
/* 垃圾桶：原版槽底 = Inventory_Back7（ItemSlot.cs:2063 context 6）。
 * 空槽时画 Trash.png（ItemSlot.cs:2514-2520：32×32 居中，scale 0.85，
 *  颜色 Color(100,100,100,100) = 亮度×0.39 + alpha×0.39） */
.sw-trash .sw-trash-icon { position:absolute; left:8.5px; top:8.5px; width:27px; height:27px;
  image-rendering:pixelated; pointer-events:none; filter:brightness(0.39); opacity:0.39; }
.sw-lbl { font-size:12px; color:#9fb0dd; margin:6px 0 2px 0; }
/* 右下角无框坞（2026-09-02）：列标签直接叠在世界画面上,加黑投影保可读 */
.sw-eqdock .sw-lbl { text-shadow:1px 1px 0 #000; }
/* 背包面板透明底（2026-09-02 用户要求去底去框）：同补偿,标题/标签/合成站文字投影 */
.sw-inv .sw-lbl, .sw-inv .sw-title, .sw-inv [data-role="stations"] { text-shadow:1px 1px 0 #000; }
/* 槽底统一走 ::after 纹理层（z -1 压在图标/数字/收藏角标之下）+ --slot-alpha
   半透：半透明只作用于格子底,道具物品本体全亮（2026-09-02 用户要求;原版
   Back20 alpha147 同语义）。元素自身 background-image 关掉防双重贴图;
   isolation 防负 z 伪元素逃出槽的堆叠上下文 */
.sw-hotbar .sw-slot, .sw-invgrid .sw-slot, .sw-inv .sw-slot.sm, .sw-inv .sw-trash {
  background-image:none; isolation:isolate; }
.sw-hotbar .sw-slot::after, .sw-invgrid .sw-slot::after, .sw-inv .sw-slot.sm::after, .sw-inv .sw-trash::after {
  content:''; position:absolute; inset:0; z-index:-1;
  background:var(--slot-bgimg, url(sprites/vanilla/Inventory_Back20.png)) 0 0 / 100% 100%;
  opacity:var(--slot-alpha, 0.575); }
/* 背包网格=热键栏同款渲染（2026-09-02）：52px 盒 ×0.75 缩放（视觉 39=--slot
   轨道）;节距由 syncInvGridGeometry 按热键栏实测值运行时写入。半透 0.575=热键栏
   未选中同款（用户确认半透要保留） */
.sw-invgrid .sw-slot { width:52px; height:52px; transform:scale(0.75); transform-origin:top left;
  --slot-alpha:0.575; }
/* ★发白根因（2026-09-02 用户报"半透效果与热键栏不一致/发白"）：半透格底之上
   再叠不透明的 ::before 乘色层（220 灰 multiply）——背板半透时 blend 公式的
   Cs×(1-αb) 项把浅灰直接加进画面=加性发白。热键栏 ::before 是 display:none
   所以不发白。半透槽族（网格/钱币/弹药/垃圾桶）一律禁用乘色层;blocked 红脉冲
   仍走 ::before（基色透明,动画期 mix-blend normal 不受影响） */
.sw-invgrid .sw-slot::before, .sw-inv .sw-slot.sm::before, .sw-inv .sw-trash::before {
  background:transparent; mix-blend-mode:normal; }
.sw-invgrid .sw-slot:hover::after, .sw-inv .sw-slot.sm:hover::after, .sw-inv .sw-trash:hover::after {
  opacity:1; }
/* 右下角坞槽位同款半透（2026-09-02 用户要求：装备/染料/时装/杂项格此前无半透）。
   loadout 乘色（armor/dye 配装色、默认 220 灰）以 gradient+background-blend:multiply
   在纹理层【内部】合成——不透明白灰叠半透底=加性发白（第七批同根因）,故禁用
   ::before 乘色、纹理层内自乘 */
.sw-eqdock .sw-slot { background-image:none; isolation:isolate; }
/* ★清偿刀 H②：槽底 α ×itemFade（ItemSlot.cs:2336 color2×fade）——fade 缺省 1
   与原值逐槽同域;装备族拖拽不可入槽件时 paintSlotChrome 写 0.5 */
.sw-eqdock .sw-slot::after { content:''; position:absolute; inset:0; z-index:-1;
  background-image: linear-gradient(var(--slot-tint, rgb(220,220,220)), var(--slot-tint, rgb(220,220,220))), var(--slot-bgimg, url(sprites/vanilla/Inventory_Back20.png));
  background-size: 100% 100%, 100% 100%;
  background-blend-mode: multiply, normal;
  opacity: calc(var(--slot-alpha, 0.575) * var(--sw-ifade, 1)); }
.sw-eqdock .sw-slot::before { background:transparent; mix-blend-mode:normal; }
.sw-eqdock .sw-slot:hover::after { opacity: calc(1 * var(--sw-ifade, 1)); }
.sw-title { font-size:17px; font-weight:bold; margin-bottom:8px; color:#ffe8a0; }
/* will-change+transform 移动(2026-08-18):left/top 每帧触发布局+所在层整体
   重记录——压力窗口期层内 Inventory_Back 背景等被逐出解码位图就反复
   LazyPixelRef(trace 残余流);独立合成层后移动只走合成器,零重记录 */
.sw-drag-ghost { position:fixed; left:0; top:0; z-index:200; pointer-events:none;
  width:40px; height:40px; will-change:transform; }
.sw-drag-ghost img { width:40px; height:40px; image-rendering:pixelated;
  filter:drop-shadow(2px 3px 2px rgba(0,0,0,0.6)); }
.sw-drag-ghost .cnt { position:absolute; right:-2px; bottom:-4px; font-size:12px; font-weight:bold;
  color:#fff; text-shadow:1px 1px 0 #000; }
.sw-drop-ok { border-color:#7de08a !important; }
.sw-toast { position:fixed; left:50%; top:64px; transform:translateX(-50%);
  background:rgba(20,16,28,0.9); color:#ffe8a0; padding:8px 18px; border-radius:6px;
  border:1px solid #6a5a8a; font-size:14px; transition:opacity 0.4s; pointer-events:none; }
/** 成就解锁弹窗(原版 InGamePopups.AchievementUnlockedPopup :13-148 + Tracker :38-52):
 *  底部居中、距底 40px;条高 ≈(标题高+10)×1.1(约 31px 细条);
 *  库存蓝底 (64,109,164)×0.5(hover ×0.75);图标【在右】,
 *  64px 栅格帧按 num3=num×0.3≈0.33 缩 → 屏显 ≈21px,距条右缘 ≈33px(:107);
 *  Achievement_Borders 72px 同 0.33 缩 ≈24px 覆盖(origin (4,h/2) :112);
 *  标题右对齐于图标左 10px(:110,anchorx=1);300t=5s 寿命(前 30t 淡入/末 15t 淡出)。
 *  多条堆叠:PushAnchor 每条上移 50×opacity(:89)≈ 50px 音高(31px 条 + 19px 空) */
.sw-ach-wrap { position:fixed; left:0; right:0; bottom:40px; display:flex;
  flex-direction:column; align-items:center; gap:19px; pointer-events:none; z-index:60; }
.sw-ach { pointer-events:auto; display:inline-flex; align-items:center;
  background:rgba(64,109,164,0.5); border:1px solid #1a1a2e; border-radius:4px;
  padding:5px 33px 5px 10px; cursor:pointer; transition:opacity 0.25s, transform 0.25s;
  animation:sw-ach-in 0.5s ease-out; }
.sw-ach:hover { background:rgba(64,109,164,0.75); }
.sw-ach.out { opacity:0 !important; transform:translateY(10px); }
.sw-ach .ttl { color:#ffe8a0; font-size:14px; line-height:21px; text-shadow:1px 1px 0 #000;
  white-space:nowrap; text-align:right; margin-right:10px; }
.sw-ach .icn { width:21px; height:21px; position:relative; flex:0 0 auto; overflow:hidden; }
.sw-ach .icn .sheet { position:absolute; image-rendering:pixelated; }
.sw-ach .icn .bdr { position:absolute; width:24px; height:24px; image-rendering:pixelated;
  left:-1.5px; top:-1.5px; }
@keyframes sw-ach-in { from { opacity:0; transform:translateY(12px) scale(0.9); } }
.sw-tooltip { position:fixed; background:rgba(21,23,75,0.93);
  padding:9px 13px; color:#e8e4f0; font-size:13px; pointer-events:none; z-index:1300; max-width:280px;
  font-family: "Fusion Pixel 12px", "Microsoft YaHei", sans-serif;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.85); line-height:1.5; }   /* 原版 MouseText 字体+字影（:20256 DrawColorCodedStringWithShadow） */
.sw-tooltip-nobox { background:transparent; }   /* 悬停文本框:关（SettingsEnabled_OpaqueBoxBehindTooltips=false，无底板纯文字原版支） */
.sw-tooltip-lines { display:inline; }   /* 文字层容器：脉冲 brightness 只作用于此（面板恒定） */
.sw-yoyo-logo { width:16px; height:16px; image-rendering:pixelated; vertical-align:-3px;
  filter:drop-shadow(1px 0 #000) drop-shadow(-1px 0 #000) drop-shadow(0 1px #000) drop-shadow(0 -1px #000); } /* OneDropLogo 五层影（:20263-20289） */
.sw-buff { pointer-events:auto; position:relative; width:30px; height:30px; background:rgba(40,32,60,0.9);
  border:1px solid #6a5a8a; border-radius:4px; align-items:center; justify-content:center; }
.sw-recipe { pointer-events:auto; display:flex; align-items:center; gap:6px; padding:5px 8px; margin:3px 0;
  background:rgba(50,40,70,0.8); border-radius:4px; cursor:pointer; font-size:13px; }
/* 悬停高亮 :hover 伪类（合成列表 2026-09-01 回归原生滚动后行静态驻留,伪类
   稳定;.hov 类仅作重建后伪类未重算的即时补位,enter/leave 维护） */
.sw-recipe:hover, .sw-recipe.hov { background:rgba(70,55,100,0.9); }
/* 置灰只作用内容（img/span opacity+去饱和）——★行本身保持透明：行 opacity<1
   会连"透出的游戏画面"一起半透 = 一块灰色遮罩观感（2026-08-27 用户报） */
.sw-recipe.no { cursor:default; }
.sw-recipe.no img, .sw-recipe.no span { opacity:0.45; filter:grayscale(0.7); }
.sw-recipe img { width:22px; height:22px; image-rendering:pixelated; }
/* 合成列表=原生溢出容器滚动（2026-09-02 用户定案:滚动能力交还 DOM,不自算）。
   滚动条常显（内容超高时）:纯 ::-webkit-scrollbar 换肤（Chromium/Safari 对
   自定义滚动条走经典常显渲染,绕开 macOS 覆盖式"滚动时才现"）。★不可叠加
   标准属性 scrollbar-width/scrollbar-color——Chromium 121+ 二者非 auto 即
   停用 ::-webkit-scrollbar 整套样式,退回覆盖式瞬现（2026-09-02 用户实报） */
.sw-craft-list::-webkit-scrollbar { width:5px; }
.sw-craft-list::-webkit-scrollbar-track { background:rgba(58,52,108,0.75); border-radius:3px; }
.sw-craft-list::-webkit-scrollbar-thumb { background:rgb(150,170,236); border-radius:3px; }
.sw-progress { position:fixed; inset:0; background:rgba(5,5,12,0.85); display:flex;
  flex-direction:column; align-items:center; justify-content:center; color:#e8e4f0; }
.sw-progress .bar { width:320px; height:14px; background:#2a2440; border:1px solid #6a5a8a; border-radius:7px; margin-top:14px; overflow:hidden; }
.sw-progress .fill { height:100%; width:0%; background:linear-gradient(90deg,#6a8ae0,#8ad0e0); transition:width 0.2s; }
/* ★幕布期 HUD 抑制（2026-09-29 用户报「加载幕布期热键栏/Shift 提示穿透」）：
   enterGame 建 HUD 到掀幕 stopMenu 之间,幕布（menuBg 画布 z0 + 透明 VUI 加载页
   z300）盖不住 .sw-root(z10) 的 DOM HUD 树=热键栏/键位提示浮在幕布上。
   visibility（非 display）保布局零重排,掀幕摘类=同帧无缝重现（禁闪烁）。
   .sw-progress 豁免：wld 导入/联机流的 DOM 加载页即幕布本体,抑制期须保持可见。 */
.sw-root.sw-hud-suppressed > *:not(.sw-progress) { visibility:hidden; }
`;

export interface CompatEntry { id: number; name: string | null; count: number; action: string }
export interface CompatReport {
  worldName: string; wldVersion: number; size: [number, number];
  tilesDegraded: CompatEntry[]; tilesCleared: CompatEntry[]; itemsSkipped: CompatEntry[];
}

// ---- PvP 背包快切钮（DrawPVPIcons Main.cs:43378-43512 1:1;★BJ417 帧制勘误——
// 旧注引 :42074-42195 系 1456 行号,1457 该域已重写） ----
// 布局：PvP 剑图标（UI_PVP_0=76×266,Frame(2,7)→38×38 帧 2 列×7 行 :43419;
// 【1456=Frame(4,6)+Width-2/Height-1 裁 36×37,1457 已弃】列=hostile?1:0、行=team 0-5,
// 行 6=悬停高亮整帧【第二遍覆盖绘制】(:43428-43434 rectangle.Y=Height*PlayerTeamID.Count,
// X 保持 hostile 列;满白不参与冷却 num4 调光,冷却调光只作用基帧 :43426 White*num4)。
// 队伍格 2 列×3 行 20px（:43440 x=num2+i%2*20 / y=num3+i/2*20,图标 UI_PVP_1 六帧
// 18×18 裁 16 宽 :43502-43505,悬停高亮 UI_PVP_2 20×20 @-2 :43500-43502）。
// 点击：teamCooldown=300t（:43426/:43481 teamCooldownLen Main.cs:1026）+ 音效 12（MenuTick）
// + hostile 翻转/team=i；原版发 msg30/157，本仓走 msg13 快速通道（ClientNet.sendPvpState）。
// 文案键：UI.PvpIcon_{Active,Inactive}（:43402）+ UI.TeamIcon{Name}_{Active,Inactive}（:43462，
// Name ∈ None/Red/Green/Blue/Yellow/Pink——第 5 队 ID=Purple 但文案键历史遗留为 Pink，
// PlayerTeamID.cs:20）。TeamChangeAllowed 恒 true（Player.cs:4303-4306，misc[84] 拒绝支死码）。

/** 队伍钮序（:42127 for i<6）+ 文案键名（:42141-42159 switch） */
export const PVP_TEAM_BUTTONS: readonly { team: number; name: string }[] = [
  { team: 0, name: 'None' }, { team: 1, name: 'Red' }, { team: 2, name: 'Green' },
  { team: 3, name: 'Blue' }, { team: 4, name: 'Yellow' }, { team: 5, name: 'Pink' },
];

/** 原版 Lang.LocalizedDuration(Lang.cs:1163-1229,1456/1457/1458 逐字一致;buff 时长
 *  以 abbreviated:true + showAllAvailableUnits:false 调用,Main.cs:44053-44054):
 *  只取首个非零单位返回,且"总时长 > 1 单位常量即 +1"向上进位——阈值写死为 1 天/时/
 *  分常量而非本档位值,故整分余量也多 +1(300s 整 → "6 分",原版如此);
 *  <60 秒走秒分支精确到整秒。单位词 = Misc.Short{Seconds..Days} 官方键,
 *  数字与词间恒一个空格(zh-Hans "45 秒" / en "45 s") */
function localizedDuration(totalSec: number): string {
  const sec = Math.floor(totalSec);
  const d = Math.floor(sec / 86400);
  if (d > 0) return `${d + (sec > 86400 ? 1 : 0)} ${Lang.text('Misc.ShortDays')}`;
  const h = Math.floor((sec % 86400) / 3600);
  if (h > 0) return `${h + (sec > 3600 ? 1 : 0)} ${Lang.text('Misc.ShortHours')}`;
  const m = Math.floor((sec % 3600) / 60);
  if (m > 0) return `${m + (sec > 60 ? 1 : 0)} ${Lang.text('Misc.ShortMinutes')}`;
  return `${sec} ${Lang.text('Misc.ShortSeconds')}`;
}

/** PvP 剑帧（★BJ417 1457 制：UI_PVP_0 76×266=Frame(2,7) 38×38 帧,Main.cs:43419-43420）
 *  col=hostile?1:0、row=team(0-5);悬停高亮【非列号】=行 6 整帧第二遍覆盖
 *  （:43432-43434 rectangle.Y=Height*PlayerTeamID.Count,X 保持 hostile 列）→
 *  见 pvpHoverFrame。1456 旧制 (4,6)+hover 计入列+Width-2/Height-1 裁 36×37 已废。 */
export function pvpIconFrame(hostile: boolean, team: number): readonly [number, number] {
  return [hostile ? 1 : 0, Math.max(0, Math.min(5, team))];
}

/** PvP 剑悬停覆盖帧（:43432-43434：X 不变=hostile 列,Y=Height*6=行 6） */
export function pvpHoverFrame(hostile: boolean): readonly [number, number] {
  return [hostile ? 1 : 0, 6];
}

/** 队伍切换冷却（teamCooldownLen=300t × 1000/60ms，:1026；冷却期无悬停提示/不可点） */
export const PVP_COOLDOWN_MS = 5000;

export class UI {
  devMode = false; // 开发者模式：进世界时全道具入包 + 出生点展示区
  root: HTMLElement;
  game!: Game;  // 生命周期由 enterGame 置入;quitToMenu 经 detachGame() 摘引用(2026-08-13 泄露 review)
  hotbarEl!: HTMLElement;
  /** 说明书按钮（快捷栏右侧;manualHidden=true 时不建） */
  private manualBtn: HTMLElement | null = null;
  hotbarNameEl!: HTMLElement;
  invPanel!: HTMLElement;
  chestPanel!: HTMLElement;
  craftListEl!: HTMLElement;
  /** ★SW-BJ1 2026-09-06 合成区 CraftFromNearbyChests 开关贴图（CraftingUI.cs:342
   *  ChestCraft 四帧;设置页/本钮双入口同步） */
  craftNearbyToggleImg: HTMLImageElement | null = null;
  tooltip!: HTMLElement;
  toastEl: HTMLElement | null = null;
  achWrapEl: HTMLElement | null = null;
  heldStack: { id: number; stack: number; prefix?: number; placeStyle?: number; favorited?: boolean } | null = null; // prefix/placeStyle/favorited 随实例流转（★批III②收藏态透传——ghost 金边框消费）
  /** 光标持有物来源区（露西存取台词的 CountsAsStorage 判定，ItemSlot 上下文；
   *  两会话撞字段合并：null=未持取（CountsAsStorage 判定的"非箱取"缺省档） */
  heldFrom: SlotWhere | null = null;
  openChest: ChestData | null = null;
  // ---- ★SW-BJ157（2026-09-18）stackSplit 计时面（Main.cs 全量移植,取件臂按住连取）----
  //  Main.stackSplit（:1770）=右键取件复用闸+加速梯节拍；stackDelay（:1778 缺省 7）/
  //  superFastStack（:1780）/stackCounter/timesTriedToFastStack 为 Main 同名私有伴量。
  private stackSplit = 0;
  private stackDelay = 7;
  private stackCounter = 0;
  private superFastStack = 0;
  private timesTriedToFastStack = 0;
  /** 右键取件臂按住目标（:1677-1692 臂=电平驱动：悬停该格+右键按住期间逐拍重跑；
   *  槽元素引用供逐拍 hover 复核——指针离格即停=原版 Draw :566 仅悬停格调用） */
  private rcHold: { where: SlotWhere; i: number; el: HTMLElement } | null = null;
  /** 右/左键物理电平（Main.cs:63422 `!MouseRight && !MouseLeft → stackSplit=0`
   *  松键归零门的按钮态;Input.rightDown 会被世界交互消费不可用,自持窗口监听） */
  private uiBtnRight = false;
  private uiBtnLeft = false;
  /** ★SW-BJ391（2026-09-28）快捷制作长按臂按住目标（HoverOverCraftingItemButton
   *  Main.cs:42971-43036 电平面：左键按住∧仍悬停焦点行∧stackSplit≤1 → 逐拍
   *  CraftItem((superFastStack+1)×(ShiftInUse?10:1))+:42999 门同源）。r=按住配方;
   *  kind=压面站别（行重建换锚只认同站,防跨面偷锚——modern 网格格与详情槽同配方
   *  双元素,详情每刷重建会 flip 锚致 :hover 误断）;el=配方行元素（:hover 逐拍复核
   *  ——离行暂停、回行续做=原版 Draw 逐帧调用面,不清锚;maxStack-1 成品不上膛=
   *  :42996-42998 flag5 阻断面）。 */
  private craftHold: { el: HTMLElement; r: VanillaRecipeLike; kind: 'list' | 'fisheye' | 'mcell' | 'mdetail' } | null = null;
  /** Shift 物理电平（ItemSlot.ShiftInUse ItemSlot.cs:300-306 PressingShift 面——
   *  原版每拍读键态,长按中 Shift 电平逐拍生效;左/右 Shift 同 key 'Shift'） */
  private uiBtnShift = false;
  /** 装备页追加槽引用（恶魔心 8 / 大师 9 及时装 18/19——refreshEquipExtras 显隐） */
  private equipExtraSlots: { equip: HTMLElement[]; vanity: HTMLElement[]; dye: HTMLElement[] } | null = null;
  private toastTimer: number | null = null;
  /** 图鉴面板入口（背包按钮/暂停菜单注入；见 BestiaryPanel） */
  onBestiary?: () => void;
  /** 表情窗口入口（M4：背包表情角按钮 → Game.openEmoteMenu——原版 DrawEmoteIcon） */
  onEmoteMenu?: () => void;
  /** ★BJ335（2026-09-24）：options.onChange 订阅退订句柄册。本单例长存,但三个
   *  订阅点(:1224 applyTooltipBox/:4975 sync/:8252 syncNear)位于【每轮重建】的
   *  buildHud/vinv 构建器内——不退订时旧闭包携整轮 context 岛滞留,长存 store 的
   *  listeners 数组按轮累积钉死游离面板（快照定谳主锚）。closeAll 统一摘,
   *  下局构建器重订阅。:765 布局切换订阅在构造器(真一次性)不入册。 */
  private optionsUnsubs: Array<() => void> = [];
  /** 住房面板入口（背包内房屋按钮 → HousingPanel；分配/查询走 game.housingMode） */
  onHousing?: () => void;
  /** 暂停/设置浮层入口（背包面板设置钮 → main.openInGamePause;原版
   *  playerInventory 态的设置入口 DrawInterface_29_SettingsButton Main.cs:46287
   * -46301,SW-BN3 2026-09-07 补位——clickAction 开/收 toggle 在 main.ts 接线侧） */
  onPauseMenu?: () => void;

  constructor(parent: HTMLElement) {
    const style = el('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = el('div', 'sw-root');
    parent.appendChild(this.root);
    this.installDragListeners();
    (window as unknown as { __swUI?: UI }).__swUI = this; // 调试句柄
    // ★SW-BJ157：按钮电平自持（stackSplit 松键归零门 Main.cs:63422-63426 的按钮态面;
    //  capture=槽位 stopPropagation 不影响电平记录;blur 清零=失焦 PlayerInput 触发器
    //  全复位同相,按住中失焦不悬挂连取）
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.uiBtnLeft = true;
      else if (e.button === 2) this.uiBtnRight = true;
    }, true);
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.uiBtnLeft = false;
      else if (e.button === 2) this.uiBtnRight = false;
    }, true);
    // ★SW-BJ391：Shift 物理电平（ItemSlot.ShiftInUse 每拍读面;capture=站内
    //   stopPropagation 不影响电平记录）
    window.addEventListener('keydown', (e) => { if (e.key === 'Shift') this.uiBtnShift = true; }, true);
    window.addEventListener('keyup', (e) => { if (e.key === 'Shift') this.uiBtnShift = false; }, true);
    window.addEventListener('blur', () => {
      this.uiBtnLeft = false;
      this.uiBtnRight = false;
      this.uiBtnShift = false;
      this.rcHold = null;
      this.craftHold = null;
    });
    // ★2026-09-07 刀 2:背包布局 flag 运行期切换 → 面板重建(teardown+rebuild;
    // initInGame 前未建则 no-op,由下次进世界自然分派)。classic 旁路零改动
    options.onChange((d) => {
      if (this._builtLayout && d.inventoryLayout !== this._builtLayout) this.rebuildInventoryPanel();
    });
  }

  private slotContent(where: SlotWhere, i: number): { id: number; stack: number; favorited?: boolean; prefix?: number; placeStyle?: number } | null {
    if (where === 'inv') return this.game!.player.inv.slots[i];
    if (where === 'armor') return this.game!.player.inv.armor[i];
    if (where === 'dye') return this.game!.player.inv.dye[i];
    if (where === 'misc') return this.game!.player.inv.miscEquips[i];
    if (where === 'miscDye') return this.game!.player.inv.miscDyes[i];
    return this.openChest?.items[i] ?? null;
  }

  // ============ 主菜单 ============
  showMainMenu(handlers: {
    onNew: (seed: string, w: number, h: number) => void;
    onLoadFile: (file: File) => void;
    onImportWld: (file: File) => void;
    onQuickLoad: (() => void) | null;
  }) {
    this.closeAll();
    const panel = el('div', 'sw-panel');
    panel.style.cssText = 'pointer-events:auto; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:340px;';
    panel.appendChild(el('div', 'sw-title', '🌍 SandboxWorld'));
    const sub = el('div', '', '2D 沙盒动作冒险 · 泰拉瑞亚风格复刻');
    sub.style.cssText = 'font-size:12px; color:#9a8ab8; margin-bottom:10px;';
    panel.appendChild(sub);

    const seedInput = el('input') as HTMLInputElement;
    seedInput.placeholder = '世界种子（留空随机）';
    seedInput.style.cssText = 'width:100%; padding:8px; margin:4px 0; background:#241e38; color:#fff; border:1px solid #6a5a8a; border-radius:4px; box-sizing:border-box;';
    panel.appendChild(seedInput);

    const sizeSel = el('select') as HTMLSelectElement;
    sizeSel.style.cssText = 'width:100%; padding:8px; margin:4px 0; background:#241e38; color:#fff; border:1px solid #6a5a8a; border-radius:4px;';
    for (const [label, w, h] of [['小世界 4200×1200', 4200, 1200], ['中世界 6400×1800', 6400, 1800], ['大世界 8400×2400', 8400, 2400]] as const) {
      const o = el('option', '', label);
      o.value = `${w}x${h}`;
      sizeSel.appendChild(o);
    }
    sizeSel.selectedIndex = 1;
    panel.appendChild(sizeSel);

    const bNew = el('button', 'sw-btn', '创建新世界');
    bNew.onclick = () => {
      const [w, h] = sizeSel.value.split('x').map(Number);
      panel.remove();
      handlers.onNew(seedInput.value.trim(), w, h);
    };
    panel.appendChild(bNew);

    const bQuick = el('button', 'sw-btn', '继续上次存档');
    bQuick.onclick = () => { panel.remove(); handlers.onQuickLoad?.(); };
    bQuick.disabled = !handlers.onQuickLoad;
    panel.appendChild(bQuick);

    const fileWrap = el('div');
    const bLoad = el('button', 'sw-btn', '读取存档文件…');
    const fileInput = el('input') as HTMLInputElement;
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.onchange = () => {
      if (fileInput.files?.[0]) { panel.remove(); handlers.onLoadFile(fileInput.files[0]); }
    };
    bLoad.onclick = () => fileInput.click();
    fileWrap.appendChild(bLoad);
    fileWrap.appendChild(fileInput);
    panel.appendChild(fileWrap);

    const wldWrap = el('div');
    const bWld = el('button', 'sw-btn', '导入泰拉瑞亚地图 (.wld)…');
    const wldInput = el('input') as HTMLInputElement;
    wldInput.type = 'file';
    wldInput.accept = '.wld';
    wldInput.style.display = 'none';
    wldInput.onchange = () => {
      if (wldInput.files?.[0]) { panel.remove(); handlers.onImportWld(wldInput.files[0]); }
    };
    bWld.onclick = () => wldInput.click();
    wldWrap.appendChild(bWld);
    wldWrap.appendChild(wldInput);
    panel.appendChild(wldWrap);

    // 开发者模式开关：进世界时全道具入包 + 出生点摆放全部可放置图块
    const devRow = el('div');
    devRow.style.cssText = 'display:flex; align-items:center; gap:6px; margin-top:8px; font-size:12px; color:#9a8ab8;';
    const devCb = el('input') as HTMLInputElement;
    devCb.type = 'checkbox';
    devCb.checked = this.devMode;
    devCb.onchange = () => { this.devMode = devCb.checked; };
    devRow.appendChild(devCb);
    devRow.appendChild(el('span', '', '开发者模式（全道具入包 + 出生点展示区）'));
    panel.appendChild(devRow);

    this.root.appendChild(panel);
  }

  /** 墓碑/告示牌阅读弹窗（原版 Sign 阅读界面简化）：碑文 + 关闭 */
  showSign(text: string) {
    const panel = el('div', 'sw-panel');
    panel.style.cssText = 'pointer-events:auto; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:360px; max-height:70vh; overflow:auto;';
    panel.appendChild(el('div', 'sw-title', `🪦 ${Lang.tileName(85) ?? '墓碑'}`));
    const body = el('div');
    body.style.cssText = 'font-size:13px; line-height:1.8; white-space:pre-wrap; color:#d8d4e4; margin:8px 0;';
    body.textContent = text;
    panel.appendChild(body);
    const close = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.UI.Close'));
    close.addEventListener('click', () => panel.remove());
    panel.appendChild(close);
    this.root.appendChild(panel);
  }

  // ---- 路牌双态对话框（2026-08-30 形态改造，对齐原版复用对话面板语义：
  //   OpenSign Main.cs:40699-40694→tileSign 分支 Player.cs:32231-32250：第一次右键 =
  //   ReadSign 台词区展示 + [编辑(inter48)][关闭]；点编辑 → 编辑态（DOM 近似
  //   OpenVirtualKeyboard(1)），按钮变 [保存(inter47)]（SubmitSignText Sound12
  //   Main.cs:41397-41403）；**同一块牌再右键一次 = 关牌**（Player.cs:32952-32977
  //   ReadSign toggle 语义项）----
  private signDialogEl: HTMLElement | null = null;
  private signDialogAnchor: { x: number; y: number } | null = null;

  /** 路牌对话框是否开着（Inventory/Esc 链优先级用：关牌先于关背包） */
  get signDialogActive(): boolean { return this.signDialogEl !== null; }

  showSignDialog(x: number, y: number, text: string): void {
    // toggle：同锚点已开着 → 关闭返回（原版二次交互语义）
    if (this.signDialogEl && this.signDialogAnchor?.x === x && this.signDialogAnchor.y === y) {
      this.closeSignDialog();
      return;
    }
    this.closeSignDialog();
    this.signDialogAnchor = { x, y };
    const panel = el('div', 'sw-panel');
    panel.style.cssText = 'pointer-events:auto; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:420px; max-height:70vh; overflow:auto;';
    panel.appendChild(el('div', 'sw-title', Lang.text('Mods.SandboxWorld.Sign.Title')));
    const body = el('div');
    body.style.cssText = 'font-size:13px; line-height:1.8; white-space:pre-wrap; color:#d8d4e4; margin:8px 0; min-height:30px;';
    body.textContent = text || '…';
    panel.appendChild(body);
    const hint = el('div');
    hint.style.cssText = 'font-size:11px; color:#9a8ab8; margin-top:2px;';
    hint.textContent = text ? '' : Lang.text('Mods.SandboxWorld.Sign.Hint');
    panel.appendChild(hint);
    const input = el('textarea') as HTMLTextAreaElement;
    input.value = text;
    input.style.cssText = 'width:100%; box-sizing:border-box; height:110px; resize:vertical; font-size:13px; color:#d8d4e4; background:#14121c; border:1px solid #3a3350; border-radius:4px; padding:6px; display:none;';
    input.placeholder = Lang.text('Mods.SandboxWorld.Sign.Placeholder');
    panel.appendChild(input);
    const row = el('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:10px; justify-content:flex-end;';
    const closeBtn = el('button', 'sw-btn', Lang.inter(52));        // 关闭 inter[52]
    closeBtn.addEventListener('click', () => this.closeSignDialog());
    const saveBtn = el('button', 'sw-btn', Lang.inter(47));         // 保存 inter[47]（编辑态标签）
    saveBtn.style.display = 'none';
    saveBtn.addEventListener('click', () => {
      this.game?.setSignText(x, y, input.value);                    // Sign.TextSign :63-77
      UISfx.click();                                                // SubmitSignText PlaySound(12)
      this.closeSignDialog();
    });
    const editBtn = el('button', 'sw-btn', Lang.inter(48));         // 编辑 inter[48]
    editBtn.addEventListener('click', () => {
      body.style.display = 'none';
      hint.style.display = 'none';
      input.style.display = 'block';
      editBtn.style.display = 'none';
      saveBtn.style.display = '';
      input.focus();
    });
    row.appendChild(closeBtn);
    row.appendChild(editBtn);
    row.appendChild(saveBtn);
    panel.appendChild(row);
    this.root.appendChild(panel);
    this.signDialogEl = panel;
  }

  closeSignDialog(): void {
    this.signDialogEl?.remove();
    this.signDialogEl = null;
    this.signDialogAnchor = null;
  }

  /** 兼容报告弹窗：降级/清空/跳过内容列表 + 导出详情 JSON */
  showCompatReport(rpt: CompatReport) {
    // 不 closeAll：会把已初始化的 HUD（快捷栏等）一起拆掉，报告只叠加一层
    const panel = el('div', 'sw-panel');
    panel.style.cssText = 'pointer-events:auto; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:480px; max-height:80vh; overflow:auto;';
    panel.appendChild(el('div', 'sw-title', Lang.text('Mods.SandboxWorld.Compat.Title')));
    const info = el('div', '', `「${rpt.worldName}」 v${rpt.wldVersion} · ${rpt.size[0]}×${rpt.size[1]}<br>以下内容在本版本中被降级或跳过：`);
    info.style.cssText = 'font-size:12px; color:#9a8ab8; margin-bottom:8px;';
    panel.appendChild(info);
    const section = (title: string, entries: CompatEntry[], desc: string, nameOf?: (id: number) => string | null) => {
      if (!entries.length) return;
      panel.appendChild(el('div', '', title));
      const ul = el('div');
      ul.style.cssText = 'font-size:12px; margin:4px 0 8px 0; line-height:1.7;';
      for (const e of entries.slice(0, 40)) {
        const name = nameOf?.(e.id) ?? e.name;
        ul.appendChild(el('div', '', `· id ${e.id} ${name ? `「${name}」` : ''} ×${e.count} <span style="color:#7a6a9a">(${desc})</span>`));
      }
      if (entries.length > 40) ul.appendChild(el('div', '', `… 共 ${entries.length} 种（导出查看全部）`));
      panel.appendChild(ul);
    };
    section(Lang.text('Mods.SandboxWorld.Compat.TilesDegraded'), rpt.tilesDegraded, 'degraded-to-stone', (id) => Lang.tileName(id));
    section(Lang.text('Mods.SandboxWorld.Compat.TilesCleared'), rpt.tilesCleared, 'cleared', (id) => Lang.tileName(id));
    section(Lang.text('Mods.SandboxWorld.Compat.ItemsSkipped'), rpt.itemsSkipped, 'skipped', (id) => Lang.itemName(id));
    const row = el('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:8px;';
    const bExport = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.Compat.Export'));
    bExport.style.flex = '1';
    bExport.onclick = () => {
      const blob = new Blob([JSON.stringify({ ...rpt, exportedAt: new Date().toISOString(), note: Lang.text('Mods.SandboxWorld.Compat.Note') }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `compat-report-${rpt.worldName.replace(/\s+/g, '_')}-${rpt.wldVersion}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    const bClose = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.UI.Close'));
    bClose.style.flex = '1';
    bClose.onclick = () => panel.remove();
    row.appendChild(bExport);
    row.appendChild(bClose);
    panel.appendChild(row);
    this.root.appendChild(panel);
  }

  /** 方块标注面板（F5 标注模式）：下载标注 / 下载地图 / 贴图纠错 / 清空 */
  annotatePanel: HTMLElement | null = null;
  texFixes: Array<{ x: number; y: number; typeKey: string; sheet: number; frameX: number; frameY: number }> = [];
  private fixModeBtn: HTMLButtonElement | null = null;
  private fixesCountEl: HTMLElement | null = null;
  showAnnotatePanel(handlers: {
    onExportMarks: () => void;
    onExportMap: () => void;
    onClear: () => void;
    onClose: () => void;
    onToggleFix: () => void;
    onExportFixes: () => void;
  }) {
    this.closeAnnotatePanel();
    const panel = el('div', 'sw-panel');
    panel.style.cssText = 'pointer-events:auto; position:fixed; left:14px; top:90px; width:200px; padding:10px;';
    panel.appendChild(el('div', 'sw-title', '📍 方块标注模式'));
    const hint = el('div', '', '点击方块标记/取消，导出后发给开发者');
    hint.style.cssText = 'font-size:11px; color:#9fb0dd; margin-bottom:6px;';
    panel.appendChild(hint);
    this.annotateCountEl = el('div', '', '已标记：0 处');
    this.annotateCountEl.style.cssText = 'font-size:12px; color:#ffe8a0; margin-bottom:6px;';
    panel.appendChild(this.annotateCountEl);
    this.fixesCountEl = el('div', '', '贴图纠错：0 处');
    this.fixesCountEl.style.cssText = 'font-size:12px; color:#8ad0a0; margin-bottom:6px;';
    panel.appendChild(this.fixesCountEl);
    const mk = (label: string, fn: () => void) => {
      const b = el('button', 'sw-btn', label);
      b.style.margin = '4px 0';
      b.onclick = fn;
      panel.appendChild(b);
      return b;
    };
    mk('⬇ 下载标注 JSON', handlers.onExportMarks);
    mk('⬇ 下载地图存档', handlers.onExportMap);
    this.fixModeBtn = mk('🔧 贴图纠错模式：关', handlers.onToggleFix) as HTMLButtonElement;
    mk('⬇ 下载贴图纠错', handlers.onExportFixes);
    mk('🗑 清空标注', handlers.onClear);
    mk('✕ 关闭（再按 F5）', handlers.onClose);
    this.annotatePanel = panel;
    this.root.appendChild(panel);
  }

  setFixModeLabel(on: boolean) {
    if (this.fixModeBtn) this.fixModeBtn.textContent = `🔧 贴图纠错模式：${on ? '开' : '关'}`;
  }

  updateFixesCount(n: number) {
    if (this.fixesCountEl) this.fixesCountEl.textContent = `贴图纠错：${n} 处`;
  }

  /** 贴图纠错：点击方块后弹出该图块的完整原版贴图表，选正确帧 */
  openTexPicker(tx: number, ty: number) {
    this.closeTexPicker();
    const g = this.game;
    const st = g.world.store;
    if (!st.inBounds(tx, ty)) return;
    const i = st.idx(tx, ty);
    const t = st.type[i];
    const def = TILE_DEFS[t];
    const sheetId = def?.vanilla?.sheet;
    if (sheetId === undefined) { this.toast('该图块没有原版贴图表'); return; }
    const atlas = g.renderer.atlas;
    const meta = atlas ? atlas.vmeta(sheetId) : null;
    if (!atlas || !meta) { this.toast('贴图表加载失败'); return; }
    // 实际渲染用的贴图：仙人掌按生物群系换变体（腐化/猩红/神圣）
    let img: ImageBitmap | HTMLImageElement | null = atlas.vimages.get(meta.sheet) ?? null;
    if (sheetId === 80) img = cactusTextureFor(atlas, st, tx, ty) ?? img;
    if (!img) { this.toast('贴图表加载失败'); return; }
    // 当前实际渲染帧：
    // - auto 类不存储帧 → 渲染端同一查找表现算
    // - 仙人掌不存储帧 → 列角色判定现算
    // - 其余 style 类 → 存储帧
    let curCol: number, curRow: number;
    let autoNote = '';
    if (sheetId === 80) {
      const f = cactusFrameAt(st, tx, ty, t);
      curCol = f.col; curRow = f.row;
      autoNote = '（仙人掌：列角色现算）';
    } else if (def.vanilla!.frame === 'auto') {
      const f = autoFrameAt(st, tx, ty, t);
      curCol = f.col; curRow = f.row;
      autoNote = '（auto 分帧：按邻居现算）';
    } else {
      curCol = Math.floor(st.frameX[i] / meta.stride[0]);
      curRow = Math.floor(st.frameY[i] / meta.stride[1]);
    }
    const panel = el('div', 'sw-panel sw-texpicker');
    panel.style.cssText = 'pointer-events:auto; position:fixed; right:14px; top:60px; width:420px; max-height:86vh; overflow:auto; padding:10px;';
    panel.appendChild(el('div', 'sw-title', `🔧 纠错 (${tx}, ${ty})`));
    const info = el('div', '', `${def.key} · sheet ${sheetId} · 当前帧 第${curCol}列 第${curRow}行${autoNote} · 网格 ${meta.grid}×${meta.stride}`);
    info.style.cssText = 'font-size:11px; color:#9fb0dd; margin-bottom:6px;';
    panel.appendChild(info);

    const scale = Math.max(2, Math.min(4, Math.floor(400 / Math.max(1, meta.stride[0]))));
    const cv = document.createElement('canvas');
    cv.width = img.width * scale; cv.height = img.height * scale;
    cv.style.cssText = `image-rendering:pixelated; border:1px solid #4d5f9e; cursor:crosshair;`;
    // 可双向滚动的视口（大表不压缩，保持可读比例）
    const viewport = el('div');
    viewport.style.cssText = 'overflow:auto; max-height:56vh; border-radius:4px;';
    viewport.appendChild(cv);
    const cx = cv.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    let sel: { col: number; row: number } | null = { col: curCol, row: curRow };
    const redraw = () => {
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      // 网格
      cx.strokeStyle = 'rgba(160,180,255,0.25)';
      cx.lineWidth = 1;
      for (let x = 0; x <= img.width; x += meta.stride[0]) {
        cx.beginPath(); cx.moveTo(x * scale + 0.5, 0); cx.lineTo(x * scale + 0.5, cv.height); cx.stroke();
      }
      for (let y = 0; y <= img.height; y += meta.stride[1]) {
        cx.beginPath(); cx.moveTo(0, y * scale + 0.5); cx.lineTo(cv.width, y * scale + 0.5); cx.stroke();
      }
      // 选中帧高亮（绿）
      if (sel) {
        cx.strokeStyle = '#40FF80'; cx.lineWidth = 2;
        cx.strokeRect(sel.col * meta.stride[0] * scale, sel.row * meta.stride[1] * scale, meta.grid[0] * scale, meta.grid[1] * scale);
      }
    };
    redraw();
    cv.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const r = cv.getBoundingClientRect();
      const px = (e.clientX - r.left) * (cv.width / r.width);
      const py = (e.clientY - r.top) * (cv.height / r.height);
      sel = { col: Math.floor(px / scale / meta.stride[0]), row: Math.floor(py / scale / meta.stride[1]) };
      redraw();
      selInfo.textContent = `选中：第 ${sel.col} 列 第 ${sel.row} 行 → 像素偏移 (${sel.col * meta.stride[0]}, ${sel.row * meta.stride[1]})`;
    });
    panel.appendChild(viewport);
    const selInfo = el('div', '', '');
    selInfo.style.cssText = 'font-size:11px; color:#40FF80; margin:6px 0; min-height:14px;';
    if (sel) selInfo.textContent = `当前（已预选）：第 ${sel.col} 列 第 ${sel.row} 行 → 像素偏移 (${sel.col * meta.stride[0]}, ${sel.row * meta.stride[1]})`;
    panel.appendChild(selInfo);
    // 滚动定位到预选帧（视口中部）
    requestAnimationFrame(() => {
      if (sel) {
        viewport.scrollTop = Math.max(0, sel.row * meta.stride[1] * scale - viewport.clientHeight / 3);
        viewport.scrollLeft = Math.max(0, sel.col * meta.stride[0] * scale - viewport.clientWidth / 3);
      }
    });
    const mk2 = (label: string, fn: () => void) => {
      const b = el('button', 'sw-btn', label);
      b.style.margin = '4px 0';
      b.onclick = fn;
      panel.appendChild(b);
    };
    mk2('✓ 记录此纠错', () => {
      if (!sel) { this.toast('先在表上点选一帧'); return; }
      // 单选：只保留一条纠错记录，新的覆盖旧的
      this.texFixes = [{
        x: tx, y: ty, typeKey: def.key, sheet: sheetId,
        frameX: sel!.col * meta.stride[0], frameY: sel!.row * meta.stride[1],
      }];
      this.updateFixesCount(this.texFixes.length);
      this.toast(`已记录纠错：(${tx},${ty}) → (${sel!.col},${sel!.row})`);
      this.closeTexPicker();
    });
    mk2('✕ 取消', () => this.closeTexPicker());
    this.texPickerPanel = panel;
    this.root.appendChild(panel);
  }

  private texPickerPanel: HTMLElement | null = null;
  closeTexPicker() {
    this.texPickerPanel?.remove();
    this.texPickerPanel = null;
  }

  private annotateCountEl: HTMLElement | null = null;
  updateAnnotateCount(n: number) {
    if (this.annotateCountEl) this.annotateCountEl.textContent = `已标记：${n} 处`;
  }

  closeAnnotatePanel() {
    this.annotatePanel?.remove();
    this.annotatePanel = null;
    this.annotateCountEl = null;
    this.fixModeBtn = null;
    this.fixesCountEl = null;
    this.closeTexPicker();
  }

  showProgress(label: string, rawP: number) {
    const p = Number.isFinite(rawP) ? rawP : 0;   // NaN 防御(width "NaN%" 根治
    let prog = this.root.querySelector('.sw-progress') as HTMLElement | null;
    if (!prog) {
      prog = el('div', 'sw-progress');
      prog.appendChild(el('div', '', label));
      const bar = el('div', 'bar');
      bar.appendChild(el('div', 'fill'));
      prog.appendChild(bar);
      this.root.appendChild(prog);
    }
    prog.children[0].textContent = label;
    (prog.querySelector('.fill') as HTMLElement).style.width = `${Math.round(p * 100)}%`;
  }

  hideProgress() {
    this.root.querySelector('.sw-progress')?.remove();
  }

  /** ★幕布期 HUD 抑制（2026-09-29）：加载幕布期（enterGame 建 HUD → stopMenu 掀幕）
   *  隐藏 .sw-root 全部 HUD（热键栏/键位提示/背包/buff 树等）——幕布层序盖不住
   *  DOM HUD（详见 CSS sw-hud-suppressed 注）。on=true 挂类/on=false 摘类（幂等,
   *  旗关路径从未挂=摘除零变化）;visibility 语义=布局不变、掀幕同帧放行无闪烁。
   *  仅 .sw-progress 豁免（导入/联机流 DOM 加载页即幕布本体）。 */
  setHudSuppressed(on: boolean) {
    this.root.classList.toggle('sw-hud-suppressed', on);
  }

  // ============ HUD ============

  buildHud(game: Game) {
    this.game = game;
    // 快捷栏（原版 GUIHotbarDrawInner Main.cs:42996-43060：左上角锚点 (20,20)；
    // 选中格 scale 1/其余 0.75、y=20+22(1-scale)、x 步进 ⌊52×scale⌋+4；
    // 选中物品名居中 x=236 脉动显示）
    this.hotbarEl = el('div', 'sw-hotbar');
    for (let i = 0; i < 10; i++) {
      this.hotbarEl.appendChild(this.makeSlotEl(i, 'inv'));
    }
    this.root.appendChild(this.hotbarEl);
    this.hotbarNameEl = el('div', 'sw-hotbar-name');
    this.root.appendChild(this.hotbarNameEl);
    this.refreshHotbar();

    // Tooltip
    this.tooltip = el('div', 'sw-tooltip');
    this.tooltip.style.display = 'none';
    this.root.appendChild(this.tooltip);
    // 悬停文本框开关（Main.SettingsEnabled_OpaqueBoxBehindTooltips，Main.cs:249
    // 默认 true；IngameOptions.cs:846-855）：关 = 无底板纯文字（原版 :20256 支）。
    // 经 applyTooltipBg 统一落底（内联 style 会盖 class 规则——九宫底也在那里）
    const applyTooltipBox = () => this.applyTooltipBg();
    applyTooltipBox();
    this.optionsUnsubs.push(options.onChange(applyTooltipBox));   // ★BJ335:每轮订阅入册,closeAll 摘(旧注"单例长存无退订点"=每轮累积泄漏根)

    game.openChest = (c) => this.openChestPanel(c);
    // 死亡收 UI 链用（Main.cs:46435-46440 dead ⇒ playerInventory=false ⇒ chest=-1 的
    // 引擎等价——Game.tickChestAutoClose 死亡门消费）
    game.closeInventory = () => this.closeInventory();
    // 当前打开箱子引用（Game 提取机通电 Wiring.cs:2571 Chest.UsingChest 判定用）
    game.openChestRef = () => this.openChest;
    // Game 侧收起面板（Main.cs:38455-38458 chest=-1 + Player.cs:31264/:31277 追踪失联
    // ——容器宠物（Chester 960/飞猪 525）再右键/走远/宠物消失路径）。★须全关
    // closeInventory：原版 chest=-1 后 playerInventory 保持但世界输入不拦——
    // 全关即本仓等价（2026-09-02 起背包本身不置 uiBlocking,无残留问题）
    game.closeChestPanel = () => this.closeInventory();
    // 光标持物查询（Game.updateUse 门,2026-09-02）：光标捏着物品时禁世界使用——
    // 原版该态点击世界=抛掷 mouseItem（Player.cs:5139 mouseItem 臂）,本仓无抛掷
    // 路径,保持「持物时世界点击不触发使用」的现状语义
    game.uiHeldItemRef = () => !!this.heldStack;
    // ★SW-BJ1 2026-09-06 触摸长按丢出等价：光标持物时 Input 长按 400ms 右键脉冲
    // 先经此预钩（Game.touchRightPulse → Input.onLongPressRightPulse）——
    // throwHeldToWorld 与桌面右键丢出臂 :1814 同一落地（DropSelectedItem(58) :5154
    // 语义）；返回 true=吞沿,rightDown 不置位 → 同一次长按不再触世界右键分派。
    // 桌面路径不经此钩（mousedown b2 直走 :1788 丢出臂）
    game.uiTouchRightPulse = () => {
      if (!this.heldStack) return false;
      this.throwHeldToWorld();
      this.refreshAll();
      return true;
    };
    // ★SW-AZ1 2026-09-06 光标持物镜像槽 58（使用/放置支）：heldStack 活对象直挂
    // Inventory.cursorMirror（Game.syncCursorMirror 每 tick 同步）——使用/放置消耗经
    // removeHeld() 直改本对象 stack 即回写光标显示;耗尽由 Game 调 uiHeldItemClear
    // 清光标（vanilla TurnToAir → mouseItem.IsAir → PickItemSelectionOverride 次拍失选）
    game.uiHeldItemObj = () => this.heldStack;
    game.uiHeldItemClear = () => {
      this.heldStack = null;
      this.heldFrom = null;
      this.moveGhost();
      this.refreshAll();
    };
    // M4 表情窗口入口（背包表情角按钮 onEmoteMenu——原版 DrawEmoteIcon Main.cs:41854
    // → IngameFancyUI.OpenUIState(UIEmotesMenu)）。打开期间暂停世界+阻断输入
    // （IngameFancyUI 语义,同 BestiaryPanel 惯例;关闭恢复先前态）
    this.buildManualBtn(game);
    this.onEmoteMenu = () => {
      const g = this.game;
      if (!g || document.querySelector('.sw-emote-menu')) return;
      const wasPaused = g.paused;
      const wasBlocking = g.input.uiBlocking;
      g.paused = true;
      g.input.uiBlocking = true;
      openEmoteMenu(this.root, {
        gateFlags: () => g.world.flags as Record<string, boolean | undefined>,
        makeLocalPlayerEmote: (id) => {
          g.makeLocalPlayerEmote(id);
          // ★选完表情连背包一起收（2026-08-27 用户要求——原版 IngameFancyUI.Close
          //   回到背包页,本仓用户定策选完即全收）
          this.closeInventory();
        },
        playTick: () => UISfx.sfx.play('menuTick', 1),
        onBack: () => {
          if (!wasPaused) g.paused = false;
          if (!wasBlocking) g.input.uiBlocking = false;
        },
      });
    };
  }

  // ============ 游戏说明书（快捷栏右侧;Web 便利档,原版无对应物）============
  // 未读红点气泡步进闪烁 → 点按钮开面板(暂停世界+阻断输入,同表情窗惯例) →
  // "我知道了"关面板+熄泡;勾"不再显示"= manualHidden 落盘,按钮不再创建
  // (设置页"显示说明书按钮"可重开)。

  /** 快捷键行:action 官译名 + 当前绑定(重映射实时反映;空绑定=灰虚线"未设置") */
  private manualKeyRow(action: KeybindAction): HTMLElement {
    const row = el('div', 'sw-manual-row');
    row.appendChild(el('span', 'desc', keybindActionLabel(action)));
    const codes = bindsOf(action);
    row.appendChild(el('span', codes.length ? 'sw-manual-key' : 'sw-manual-key none',
      codes.length ? codes.map(keybindCodeLabel).join(' / ') : Lang.text('Mods.SandboxWorld.UI.ManualUnbound')));
    return row;
  }

  /** 设置页"显示说明书按钮"开关的实时刷新（buildHud 之外的重开/撤除路径;
   *  经 window.__swUI 调——UI 单例句柄,构造器已挂） */
  refreshManualBtn(): void {
    const g = this.game;
    if (!g) return;
    if (options.data.manualHidden) {
      this.manualBtn?.remove();
      this.manualBtn = null;
    } else if (!this.manualBtn?.isConnected) {
      this.manualBtn?.remove();
      this.buildManualBtn(g);
    }
  }

  private buildManualBtn(game: Game) {
    if (options.data.manualHidden) return;
    const wrap = el('div', 'sw-manual-wrap');
    const btn = el('button', 'sw-manual-btn', '?');
    btn.title = Lang.text('Mods.SandboxWorld.UI.Manual');
    btn.addEventListener('mousedown', (e) => e.stopPropagation());   // 防触发拖拽/世界点击
    // ★BJ318：动态解析——曾捕获每局 game 形参,manualBtn 随 UI 单例跨局存活=死 Game 钉
    btn.addEventListener('click', () => { if (this.game) this.openManualPanel(this.game); });
    wrap.appendChild(btn);
    if (!options.data.manualSeen) wrap.appendChild(el('div', 'sw-manual-badge', '!'));
    this.root.appendChild(wrap);
    this.manualBtn = wrap;
  }

  private openManualPanel(game: Game) {
    if (document.querySelector('.sw-manual-panel')) return;
    // 打开期间暂停世界+阻断输入(IngameFancyUI 语义,同表情窗惯例;关闭恢复先前态)
    const wasPaused = game.paused;
    const wasBlocking = game.input.uiBlocking;
    game.paused = true;
    game.input.uiBlocking = true;

    const panel = el('div', 'sw-manual-panel fallback-bg');
    panel.appendChild(el('div', 'sw-manual-title', Lang.text('Mods.SandboxWorld.UI.ManualTitle')));
    const body = el('div', 'sw-manual-body');
    const sec = (t: string) => body.appendChild(el('div', 'sw-manual-sec', t));
    const mouseRow = (keyText: string, desc: string) => {
      const row = el('div', 'sw-manual-row');
      row.appendChild(el('span', 'sw-manual-key', keyText));
      row.appendChild(el('span', 'desc', desc));
      body.appendChild(row);
    };
    const kbSec = (title: string, actions: KeybindAction[]) => {
      sec(title);
      for (const a of actions) body.appendChild(this.manualKeyRow(a));
    };
    // 鼠标操作
    sec(Lang.text('Mods.SandboxWorld.UI.ManualSecMouse'));
    mouseRow(Lang.text('Mods.SandboxWorld.UI.ManualKeyLmb'), Lang.text('Mods.SandboxWorld.UI.ManualOpMine'));
    mouseRow(Lang.text('Mods.SandboxWorld.UI.ManualKeyRmb'), Lang.text('Mods.SandboxWorld.UI.ManualOpInteract'));
    mouseRow(Lang.text('Mods.SandboxWorld.UI.ManualKeyShift'), Lang.text('Mods.SandboxWorld.UI.ManualOpShift'));
    mouseRow(Lang.text('Mods.SandboxWorld.UI.ManualKeyAlt'), Lang.text('Mods.SandboxWorld.UI.ManualOpAlt'));
    // 键位分组（序=设置页"控制"页分组序）
    kbSec(Lang.text('Mods.SandboxWorld.UI.ManualSecMove'), ['Up', 'Down', 'Left', 'Right', 'Jump']);
    kbSec(Lang.text('Mods.SandboxWorld.UI.ManualSecFunc'), ['Inventory', 'SmartCursor', 'SmartSelect', 'QuickHeal', 'QuickMana', 'QuickBuff', 'QuickMount', 'Grapple']);
    kbSec(Lang.text('Mods.SandboxWorld.UI.ManualSecHotbar'), ['Hotbar1', 'Hotbar2', 'Hotbar3', 'Hotbar4', 'Hotbar5', 'Hotbar6', 'Hotbar7', 'Hotbar8', 'Hotbar9', 'Hotbar10', 'HotbarMinus', 'HotbarPlus']);
    kbSec(Lang.text('Mods.SandboxWorld.UI.ManualSecMap'), ['MapFull', 'MapStyle', 'MapZoomIn', 'MapZoomOut', 'MapAlphaUp', 'MapAlphaDown']);
    kbSec(Lang.text('Mods.SandboxWorld.UI.ManualSecView'), ['ViewZoomIn', 'ViewZoomOut']);
    kbSec(Lang.text('Mods.SandboxWorld.UI.ManualSecLoadout'), ['Loadout1', 'Loadout2', 'Loadout3']);
    kbSec(Lang.text('Mods.SandboxWorld.UI.ManualSecMisc'), ['ToggleCreativeMenu', 'ToggleCameraMode']);

    const foot = el('div', 'sw-manual-foot');
    const hideLabel = el('label', 'sw-manual-hide');
    const hideChk = document.createElement('input');
    hideChk.type = 'checkbox';
    hideLabel.appendChild(hideChk);
    hideLabel.appendChild(document.createTextNode(Lang.text('Mods.SandboxWorld.UI.ManualHide')));
    const ok = el('button', 'sw-manual-ok', Lang.text('Mods.SandboxWorld.UI.ManualGotIt'));
    foot.append(hideLabel, ok);
    panel.append(body, foot);
    this.root.appendChild(panel);
    // 暂停面板同款半透九宫底(Inventory_Back13 ×(33,15,91)×0.685;素材懒加载
    // 竞态时保留 fallback 底色,下次打开生效)
    const applyBg = () => {
      if (!panel.isConnected) return;
      const url = invBgDataUrl(panel.offsetWidth, panel.offsetHeight);
      if (url) {
        panel.style.backgroundImage = `url(${url})`;
        panel.classList.remove('fallback-bg');
      }
    };
    requestAnimationFrame(applyBg);
    const bgImg = invBgEnsure();
    if (bgImg && bgImg instanceof HTMLImageElement && !bgImg.complete) {
      bgImg.addEventListener('load', applyBg, { once: true });
    }
    // SW-BN2 2026-09-07：Esc 关闭（uiBlocking 模态自带 Esc 是 Inventory/Esc 链
    // "模态让位"支的前提——原版 inFancyUI 支 Player.cs:4987-4989 语义：fancy UI
    // 打开时 Inventory 沿只关 fancy UI。此前手册无 Esc 口=该支唯一死端,补齐）。
    // 关闭不视为"已读"：不置 manualSeen、不撤红点（"我知道了"钮才熄泡）。
    const escClose = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.removeEventListener('keydown', escClose, true);
      panel.remove();
      if (!wasPaused) game.paused = false;
      if (!wasBlocking) game.input.uiBlocking = false;
    };
    window.addEventListener('keydown', escClose, true);
    ok.addEventListener('click', () => {
      void options.set('manualSeen', true);   // 读过=熄泡
      if (hideChk.checked) {
        void options.set('manualHidden', true);   // 永久隐藏=按钮撤除(设置页可重开)
        this.manualBtn?.remove();
        this.manualBtn = null;
      } else {
        this.manualBtn?.querySelector('.sw-manual-badge')?.remove();
      }
      window.removeEventListener('keydown', escClose, true);
      panel.remove();
      if (!wasPaused) game.paused = false;
      if (!wasBlocking) game.input.uiBlocking = false;
    });
  }

  slotEl(i: number, where: SlotWhere): HTMLElement {
    // 背包格（idx>=10）在背包面板里，快捷栏格在 HUD 上——全文档查
    const found = document.querySelector(`[data-idx="${i}"][data-where="${where}"]`);
    return found as HTMLElement;
  }

  private makeSlotEl(i: number, where: SlotWhere): HTMLElement {
    const s = el('div', 'sw-slot');
    s.dataset.idx = String(i);
    s.dataset.where = where;
    // 空槽类型幽灵图（ItemSlot.cs:2240-2317）：TextureAssets.Extra[54] 3×7 图集,
    // 槽空且 context 有映射时以 0.35 α 画对应帧（-2px 内缩）——头盔/胸甲/护腿/
    // 配饰/时装三件/染料/宠物/光源/矿车/坐骑/抓钩各帧;背包/钱币/弹药槽原版无映射
    const ghostFrame = slotGhostFrame(where, i);
    if (ghostFrame >= 0) s.appendChild(makeSlotGhostEl(ghostFrame));
    // ★清偿刀 C：槽位 CD 覆盖层（ItemSlot.cs:2702-2725;tickSlotCooldownOverlays 驱动）
    s.appendChild(makeSlotCdEl());
    s.addEventListener('mousedown', (e) => {
      // ★BJ328（2026-09-24）：本闭包族【禁止词法自引宿主元素】——曾捕 `s`（dataset
      //  探针 + rcHold el 槽），监听器注册 ↔ 闭包上下文 ↔ 宿主元素构成跨组件环，
      //  退世界 detach 后 Oilpan 不收（堆快照定谳：游离 sw-slot 仅剩 listener 环
      //  持有，每重进世界整批滞留=+~900 JSEventListeners）。统一改经
      //  e.currentTarget 取宿主（分发期等价同一元素），闭包槽表不再含元素引用。
      const host = e.currentTarget as HTMLElement;
      // ★SW-FX10 债⑪热键锁穿透（Main.cs:44353-44359）：锁定+关包时快捷栏格不是
      //  mouseInterface——不 stopPropagation/preventDefault，事件透传 window（domTargets
      //  按 data-sw-world-passthrough 豁免 → 世界使用/挖掘链照常吃这一按）
      //  ★BJ335:host 经 e.currentTarget 取（BJ328 刀）——真分发恒有值;测试 shim
      //  直调 handler 无 currentTarget,须容 undefined（守卫仅护 dataset 读）。
      if (host && host.dataset.swWorldPassthrough === '1') return;
      e.stopPropagation();
      e.preventDefault();
      if (e.button === 2) {
        // ★SW-RB12b（2026-09-10）关包快捷栏右键整面摘除（探针 C2 取证定谳）：
        //  关包态快捷栏走 GUIHotbarDrawInner 专路（Main.cs:44322-44377,playerInventory
        //  门 :44324 早退 = 开包态不进）——context 13 只 ItemSlot.Draw 不 Handle,
        //  唯一交互 = mouseLeft 选中槽（:44357-44360 changeItem）,右键无任何槽动作
        //  （开包/换型/装备/拆半四支全部不可达;悬停置 mouseInterface=true :44355
        //  吞世界交互）。旧码关包态右键仍落四支=可达偏差。修 = 关包吞按
        //  （stopPropagation/preventDefault 已执行,同 mouseInterface 吞效）;
        //  开包态（含宝箱面板,openChest 强制 openInventory）照走原链。左键选中链
        //  （mouseup 臂 :1928 区）不受影响。
        if (!this.invPanel || this.invPanel.style.display !== 'block') return;
        // 右键（ItemSlot.RightClick :1496-1571）：开包物优先开包，装备物一键装备，否则拆半到光标
        const cur = this.slotContent(where, i);
        // 开包门（:1514-1527）：context==0（背包格，含快捷栏）&& OpenableBag &&
        // mouseItem 空或不可叠（!Item.CanStack）→ mouseRightRelease 边沿开包。
        // ★SW-FX13（2026-09-10）门谓词补全 Item.CanStack（Item.cs:49870-49877）=
        // type 同且 prefix 同：光标堆与匣同 id 异词缀时原版 !CanStack → 放行开包
        // （旧码只比 id = 同型异词缀被误判可叠,开包门被吞。匣本身无词缀,现实
        // 触达面趋零,但谓词按原文收口）。1457 锚 = ItemSlot.cs:1636-1645。
        // DOM mousedown 即边沿；hit 须先于装备/拆半分支（原版同序 return）
        if (cur && where === 'inv'
          && (!this.heldStack || this.heldStack.id !== cur.id
            || (this.heldStack.prefix ?? 0) !== (cur.prefix ?? 0))
          && OPENABLE_BAG_VIDS.has(ITEM_DEFS[cur.id]?.vid ?? -1)) {
          this.tryOpenContainer(cur, i);
          return;
        }
        // 槽语境（:1605-1622 slotContext；1458 同段对拍零差）——先于 HasItemSwap 门算出,
        // 与下方逐 context 路由共用（原版 RightClick 门序：OpenableBag(ctx 0) →
        // HasItemSwap(canItemSwapAt) → switch(9/11,0/3/4/32) → 取件臂）
        const ctx = slotContext(where, i, true, where === 'chest' ? this.openChest?.x : undefined);
        // HasItemSwap 右键换型（:1646-1653 独立门,先于装备/拆半）：canItemSwapAt 语境
        // {0 inv/3 chest/4 bank/32 虚空 + 8 盔甲/10 配饰（★红蓝-E 债升级 2026-09-18：
        //   装备位接线——原版 :423-428 canItemSwapAt 含 8/10,门先于 switch 触达装备格;
        //   5059/5060 摩羯座 ls 态时装腿可拖入功能腿槽（CanEquipInArmorSlot :1399 只查
        //   legSlot≥0+同款唯一,不查 vanity 旗）+ 5358-5361 Shellphone acc=1 配饰——
        //   双态物（ls/acc/createTile）均可达）}+stack==1+光标空 →
        // TryItemSwap(:1879 对表,CursorItemIcon.tryItemSwapVid)原地 ChangeItemType +音
        //（AfterItemSwap :1992-2008 换入 2611/5526 族=22 'unlock'/其余 7 'pickup'）;
        // 原地换型不回查 armorAccepts/成就（原版 ChangeItemType :47841 直改 type,
        // 变体族槽型自洽;HandleOnEquip 只在 SwapEquip/ArmorSwap 链）。
        // ★BJ208（2026-09-20）外门收口=原版 :1636 `mouseItem.IsAir || !Item.CanStack`
        //  全谓词（CanStack=Item.cs:49870-49877 type+prefix 同,不查 stack/maxStack;
        //  canMergeStack 多 placeStyle 位不用,与开包门 :1468 同款 id+prefix 谓词）——
        //  光标持【异款/异词缀】物仍受理换型（TryItemSwap/SwapEquip 本体不触
        //  mouseItem,:1879 原地 ChangeItemType/:3287-3368 只动 inv[slot] 与装备页,
        //  光标持物原样保留=原版行为）。旧 `!heldStack` 空门=自创收敛,登记随本刀
        //  清偿（tests has-item-swap ⑧⑨）。
        // DOM mousedown 即边沿=mouseRightRelease 语义。悬停提示面 = ItemTooltip.{Name}
        // 的 {InputTrigger_ToggleOrOpen}(Lang.cs:160)走 staticTip 支;测试 tests/has-item-swap.test.ts
        if (cur && cur.stack === 1 && CAN_ITEM_SWAP_AT.has(ctx)
          && (!this.heldStack || this.heldStack.id !== cur.id
            || (this.heldStack.prefix ?? 0) !== (cur.prefix ?? 0))) {
          const sw = tryItemSwapVid(ITEM_DEFS[cur.id]?.vid ?? -1);
          if (sw && invIndexOfVanilla(sw.target) > 0) {
            cur.id = invIndexOfVanilla(sw.target);
            this.game.sfx.play(sw.sound, 1);
            this.refreshAll();
            return;
          }
        }
        // ★SW-BJ116-a（2026-09-18）逐 context 路由（ItemSlot.RightClick :1614-1693；
        //  1458 同段对拍零差）。首块门（:1636）= 光标空或【不可叠】同款——光标持可叠
        //  同款时原版跳过 switch 直落取件臂（:1685 CanStack+stack<maxStack）。
        //  §switch（:1654-1676）：
        //  · case 9/11（时装列 armor[10-19]）= SwapVanityEquip(:1845)同序互换+Sound 7
        //    ——旧 canSwapEquip→swapEquipItem 走"时装重排本段"=对已装备位 no-op/自段
        //    挪位,与本仓自创 no-op 面（任务①判例）整摘;
        //  · case 0/3/4/32（背包/宝箱/银行/虚空）= stack==1&&(CanBeEquipped||dye>0)
        //    →SwapEquip(:3287)——即下 canSwapEquip 支（src 曾误读 inv.dye[i]=容器向
        //    右键装备空转/错装,本刀一并修正）;门未过 fall-through 取件臂
        //    （★SW-BJ157 2026-09-18 清偿：旧 fallback=自创 splitHalf 拆半已摘,
        //    四 context+钱币/弹药 1/2 全走 runPickupArm 取 1 到光标+stackSplit 连取）;
        //  · case 8（盔甲）/10（配饰）/12（染料）/16-20（杂项）/33（杂项染料）= switch
        //    【无 case】→ 落 PickupItemIntoMouse(:1695) 取 1 到光标+Sound 12(:1688)
        //    ——即"脱下到光标"（★HasItemSwap 集内件已在上方 :1467 门被 TryItemSwap
        //    拦截 return,永不落此臂;非集内件脱下面不变）。旧换槽路由（配饰已装备
        //    位=找空位挪/段首交换）与拆半均非原版语义,整摘。
        //    （ctx 已先于 HasItemSwap 门算出,见 :1448 区——★红蓝-E 债升级两处共用）
        const heldStacks = !!this.heldStack && !!cur && canMergeStack(this.heldStack, cur);
        // ★SW-BJ157（2026-09-18）：原版取件臂=全 context 共用电平面（RightClick :1677
        //  逐拍跑,switch 落空即触达）——装备列取件 1:1 同挂按住连取（BJ116 债"连发间隔
        //  本仓未建模"随本刀清偿）;SwapVanityEquip(:1657 mouseRightRelease)仍是边沿面
        //  不挂 rcHold。
        if (ctx === 9 || ctx === 11) {
          if (!heldStacks) { this.swapVanityEquip(i); return; }
          this.rcHold = { where, i, el: host };
          if (this.pickupEquipIntoMouse(where, i)) this.refreshStackSplitCooldown();
          return;
        }
        if (ctx === 8 || ctx === 10 || ctx === 12 || (ctx >= 16 && ctx <= 20) || ctx === 33) {
          this.rcHold = { where, i, el: host };
          if (this.pickupEquipIntoMouse(where, i)) this.refreshStackSplitCooldown();
          return;
        }
        // ★BJ208（2026-09-20）：case 0/3/4/32 装备臂外门同收口 :1636 全谓词（光标持
        //  异款物右键装备格=原版受理,SwapEquip 不触 mouseItem）——旧空门同批清偿。
        if (cur && cur.stack === 1
          && (!this.heldStack || this.heldStack.id !== cur.id
            || (this.heldStack.prefix ?? 0) !== (cur.prefix ?? 0))
          && this.canSwapEquip(cur.id)) {
          this.swapEquipItem(cur, where, i);
          this.refreshAll();
          return;
        }
        // 取件臂（★SW-BJ157 用户实报"右键取一半"：旧 fallback=自创 splitHalf 拆半,
        //  原版 RightClick case 0/3/4/32 装备门 fall-through（含钱币 1/弹药 2 无 switch
        //  case 直落）→ PickupItemIntoMouse 取【1】到光标 :1685-1690）。rcHold 挂接=
        //  按住连取电平面（tickStackSplitMain 逐拍重跑本臂）。
        this.rcHold = { where, i, el: host };
        this.runPickupArm(where, i, cur);
        return;
      }
      // ★SW-AU2 2026-09-06 Alt/Shift/Ctrl+左键槽位动作 1:1。优先级链 =
      //  ItemSlot.OverrideHover :571-599（Alt=FavoriteKey（Main.cs:67607 缺省
      //  LeftAlt）：聊天分享→收藏；语境不收藏再落 GetAlternateClickAction）→
      //  GetAlternateClickAction :601-700（Ctrl Quick Trash :609 先于 Shift 快移
      //  :616；收藏物/空格恒 null :604）→ OverrideLeftClick :702-843 分派。
      //  路由表/执行器在 SlotActions.ts；false=语境无动作 → 回落普通点击
      //  （dragFrom：原版无替代目标时 Shift+点=普通拾取 LeftClick case-0 :906）。
      //  ★关包快捷栏（Main.cs:44374 只 Draw 不 Handle）＝无 Alt/Shift/Ctrl 语义
      const panelOpen = !!this.invPanel && this.invPanel.style.display === 'block';
      // ★SW-RB1 2026-09-06 e.button===0 门：替代点击语义仅左键（原版 OverrideHover/
      //  OverrideLeftClick 只由左键驱动 :552/:895）——曾让中键/侧键+Shift/Ctrl 触发
      //  快移/丢桶（改动前中键=惰性 dragFrom,mouseup button!==0 早退）
      if (e.button === 0 && e.altKey && this.altSlotClick(i, where, panelOpen)) return;
      // ★BJ704-R5 P1（红蓝审查 F6 同族缺口,探针 B2/B3/B4 实证）：Shift/Ctrl 替代点击
      //  可原地清空/换掉悬停槽（Ctrl 快速回收·Shift 快移/guide 对换）——mousedown 支
      //  无任何边界事件（鼠标未离格）,旧气泡残留且跟随臂携之漂移;F6 只盖了 mouseup
      //  pickUp 支。原版=ItemSlot.MouseHover 逐帧重评（ItemSlot.cs:3174/:3179
      //  item.IsAir 不置 hoverItemName）→ 空槽零 tooltip、内容变更当帧重渲染。近似=
      //  槽空→hideCursorTooltip;内容变（id/词缀/堆数）→重走 showSlotHintTouch 同
      //  enter 路径重渲染。门 tooltipFollowsCursor=只管光标支槽位泡（元素锚气泡:
      //  重铸/buff/触屏长按不属本槽悬停链,不动;与 F6 同门）。
      if (e.button === 0 && (e.shiftKey || e.ctrlKey)) {
        const before = this.slotContent(where, i);
        if (this.altMoveClick(i, where, e.shiftKey, e.ctrlKey, panelOpen)) {
          if (this.tooltipFollowsCursor && this.tooltip.style.display === 'block') {
            const after = this.slotContent(where, i);
            if (!after) this.hideCursorTooltip();
            else if (after.id !== before?.id || (after.prefix ?? 0) !== (before?.prefix ?? 0)
              || after.stack !== before?.stack) this.showSlotHintTouch(i, where, host);
          }
          return;
        }
      }
      this.dragFrom = { i, where, sx: e.clientX, sy: e.clientY };
    });
    // hover 型信息通道统一走 bindHint:fine 指针=原 mouseenter(行为不变);
    // coarse 指针=touchLongPressMs 长按显示(mobile-adaptation-plan 模块④)
    // ★反馈轮7:布局显式传自身为 anchor——tooltip 定位回退的 slotEl(i,where)
    //  全局首匹配在开包态命中【隐藏热键栏】(0-9 DOM 序在前,rect=(0,0))→ 气泡钉
    //  左上角(用户报 ESC 开包热栏格气泡错位)。
    //  ★清偿A-F4（2026-10-14 定谳落刀）：classic 不再例外、恒传 host——旧「classic
    //  不传=行为零变化白名单」系 BJ669e 前「槽矩形锚定」时代产物;BJ669e 后桌面定位
    //  恒=光标锚（cursorTooltipPos,host 只作分支门不进定位式）,传 host 对 classic
    //  桌面零行为差（override.anchor 只替换 slotEl 全局查组分这支）。而 classic+touch
    //  长按不传 host → tooltipTouchAnchor=null → 落光标锚支,触屏无 mousemove 流 →
    //  mouseX/mouseY 恒 0/陈旧（:2746 缺省）→ 气泡钉左上角,与反馈轮7 同病灶
    //  （探针 v5 F4 部分实证:pre-fix left/top=14px/14px,post-fix=触屏元素矩形锚）
    bindHint(s, (host) => this.showSlotHintTouch(i, where, host));   // ★BJ328:宿主经形参注入,闭包不自引 s
    s.addEventListener('mouseleave', () => { this.tooltip.style.display = 'none'; cancelAnimationFrame(this.tooltipPulseRaf); });
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    return s;
  }

  /** 配饰格可见性眼睛开关（per-slot 隐藏,Main.cs:40846-40896）：InventoryTickOn/Off
   *  图标叠格右上,光标为空时点击翻转 player.hideVisibleAccessory[slot]（PlaySound(12)
   *  =menuTick :40878;悬停文案 Lang.inter[58+num45] = LegacyInterface.59 可见/60 隐藏）。
   *  ★原版只挂功能配饰段 3-9（num40>2 门 :40855）——盔甲 0-2 与社交 13-19 无图标
   *  （社交槽原版无 hide 门,UpdateVisibleAccessories :36368-36375 第二轮无条件） */
  private attachVisibilityEye(slotEl: HTMLElement, slotIdx: number): void {
    const eye = el('button', 'sw-btn sw-acceye');
    eye.style.cssText = 'position:absolute; right:-12px; top:-10px; width:24px; height:20px;'
      + 'margin:0; padding:0; z-index:5; background:center/contain no-repeat; image-rendering:pixelated;';
    eye.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (this.heldStack) return;   // 原版 mouseItem.IsAir 门（:40859）
      const p = this.game?.player;
      if (!p) return;
      p.hideVisibleAccessory[slotIdx] = !p.hideVisibleAccessory[slotIdx];
      this.game!.sfx.play('menuTick');   // SoundEngine.PlaySound(12)（:40878）
      this.paintAccEyes();
    });
    slotEl.style.position = 'relative';
    slotEl.appendChild(eye);
    this.accEyeEls.set(slotIdx, eye);
    this.paintAccEye(eye, slotIdx);
  }

  /** ★2026-09-13 反馈轮6:眼/勾选框 hover 名路由——vinv 元素走自有气泡(懒绑定
   *  一次,paint 每拍刷 dataset 文案=悬停中再点即时反映),classic 元素保持原生
   *  title(共享 paint,classic 行为零变化白名单)。★判据=元素类名(vinv-btn)而非
   *  _builtLayout——构建期 _builtLayout 尚未登记(先构建后登记约定),按布局路由
   *  会让 vinv 宠物/光源眼(仅构建期 paint)误走 classic 分支残留 title */
  private vinvEyeTip(eye: HTMLElement, textFn: () => string): void {
    if (!eye.classList.contains('vinv-btn')) {
      eye.title = textFn();
      return;
    }
    if (!eye.dataset.swTipBound) {
      eye.dataset.swTipBound = '1';
      eye.addEventListener('mouseenter', () => this.showBuffTooltip(eye, eye.dataset.swTipText ?? '', ''));
      eye.addEventListener('mouseleave', () => this.hideBuffTooltip());
      eye.title = '';   // 清可能的构建期残留,防原生气泡与自有气泡并存
    }
    eye.dataset.swTipText = textFn();
  }

  /** 眼睛图标态（InventoryTickOn/Off :40862-40865）+ 悬停文案（:40889 inter[59/60]） */
  private paintAccEye(eye: HTMLElement, slotIdx: number): void {
    const hidden = this.game?.player.hideVisibleAccessory[slotIdx] ?? false;
    eye.style.backgroundImage = `url(sprites/vanilla/Inventory_Tick_${hidden ? 'Off' : 'On'}.png)`;
    this.vinvEyeTip(eye, () => Lang.text(hidden ? 'LegacyInterface.60' : 'LegacyInterface.59'));
  }

  /** 杂项眼（宠物/光源,miscRail）——同配饰眼图标/文案族（原版 40666-40691：
   *  TogglePet/ToggleLight 翻 petFlag/lightFlag 后画 InventoryTickOn/Off） */
  private paintPetEye(eye: HTMLElement, slot: 0 | 1): void {
    const hidden = slot === 0 ? this.game.petHidden : this.game.lightPetHidden;
    eye.style.backgroundImage = `url(sprites/vanilla/Inventory_Tick_${hidden ? 'Off' : 'On'}.png)`;
    this.vinvEyeTip(eye, () => Lang.text(hidden ? 'LegacyInterface.60' : 'LegacyInterface.59'));
  }

  /** 全部眼睛图标重刷（读档回填/翻槽后） */
  private paintAccEyes(): void {
    for (const [idx, eye] of this.accEyeEls) this.paintAccEye(eye, idx);
  }

  /** 一键装备判定（ItemSlot.CanSwapEquip :3009-3020 + RightClick :1541：
   *  盔甲/配饰/染料/宠物/光源/矿车/坐骑/钩爪均可一键装备；
   *  vi_ 物品的盔甲/配饰归属查 vanilla-itemstats.json） */
  private canSwapEquip(id: number): boolean {
    const d = ITEM_DEFS[id];
    if (!d) return false;
    // ★d.armor 死前腿已移除（2026-09-02:字段全仓零写入）——legacy 效果标签独占此腿
    if (d.accessory) return true;
    if (armorSlotIndexOfInternal(id) >= 0 || statOfInternal(id)?.acc !== undefined) return true;
    const k = equipKindOfInternal(id);
    return k === 'dye' || k === 'pet' || k === 'light' || k === 'cart' || k === 'mount' || k === 'hook';
  }

  /** 一键装备（ItemSlot.SwapEquip :3287-3368 → ArmorSwap :3578-3648/DyeSwap
   *  :3550-3577/EquipSwap :3649-3660,★清偿刀 U 2026-09-29 起 1:1 非"近似"）：
   *  部位→armor[0-2]（时装→[10-12],同款在功能/时装盔甲段任一槽→早退 :3592-3596）;
   *  配饰→对段同款/互斥组早退（:3597-3600）→ 自段冲突【换入冲突槽】（:3608-3623,
   *  锁槽才早退）→ 无冲突首个解锁空槽/全满段首（:3627-3635）;染料→计数器轮转
   *  （:3556-3577,全满与计数槽交换）;杂项→对应 miscEquips 槽;成功统一
   *  PlaySound(7)+SwapClearFavorite（:1237 双端清）。
   *  ★SW-BJ116-a（2026-09-18）右键 case 0/3/4/32 专属（装备列 case 8/10/12/16-20/33
   *  已改道 PickupItemIntoMouse/ SwapVanityEquip,见 RightClick 路由注）——src 改经
   *  slotContent 单源（容器向 chest 曾误读 inv.dye[i]:右键箱中装备=空转或错装染料格
   *  +miscDyes 错位回写;ItemSlot.RightClick :1654 case 0/3/4/32 的 inv[slot] 即容器格,
   *  SwapEquip 直接交换该格 ↔ 装备位）。1457 行号锚（旧注 :3022-3346/:1537 为 1456 系） */
  private swapEquipItem(cur: { id: number; stack: number }, where: SlotWhere, i: number): void {
    const inv = this.game.player.inv;
    const d = ITEM_DEFS[cur.id];
    const src = this.slotContent(where, i);
    if (!src) return;
    // ★原版右键装备门（ItemSlot.RightClick :1537）：`inv[slot].stack == 1` 才触发
    // SwapEquip——堆叠>1（1.4.4+ 装备可堆 9999）一律不装（落入下方取半逻辑）。
    // 曾整堆塞进装备槽：99 个翅膀一键全上身=偏差（2026-08-13 用户抓到）
    if (src.stack !== 1) return;
    let target = -1;
    let targetWhere: SlotWhere = 'armor';
    // ★vanity 路由（ArmorSwap :3596 `int num = item.vanity ? 10 : 0`）：时装类右键进
    // 社交段（盔甲 10-12 / 配饰 13+）——曾恒进功能段:纯社交配饰(acc=0)被功能槽
    // armorAccepts 门拒 = "时装穿不上"根因（2026-08-14 用户实抓）
    const van = statOfInternal(cur.id)?.van === 1;
    // ★d.armor 死分支已移除（2026-09-02:字段全仓零写入,恒走 itemstats 部位表）
    if (armorSlotIndexOfInternal(cur.id) >= 0) {
      const part = armorSlotIndexOfInternal(cur.id);
      // ★清偿刀 U：ArmorSwap :3592-3596 HasSameItemInSlot(ArmorSlots)∨
      // HasSameItemInSlot(VanityArmorSlots)——同款已在功能/时装盔甲段【含目标槽
      // 自身】（HasSameItemInSlot :3517 全段扫,手上有同款第二件=无动作早退无声）。
      // ★刻意不 share armorAccepts 的 DualEquipArmor{205,5004,4955} 白名单：右键
      //   面 :3593 无此例外臂（放置/右键两语境原版本就异门）。
      if (inv.armor[part]?.id === cur.id || inv.armor[part + 10]?.id === cur.id) return;
      target = part + (van ? 10 : 0); // vi_ 盔甲（vanilla-itemstats 部位）
    } else if (d?.accessory || statOfInternal(cur.id)?.acc !== undefined) {   // ★方案 A：`?.` 洞守卫（BJ265）
      // vi_ 配饰走 itemstats acc 判定(legacy accessory 字段已随退役消失——曾只认
      // legacy 字段导致 vi_ 配饰右键一键装备静默失效)
      const accBase = van ? 13 : 3;   // 社交配饰段 13+（ArmorSwap :3596 3+num）
      const oppBase = van ? 3 : 13;   // 对段（:3598 item.vanity ? AccSlots : VanityAccSlots）
      // ★清偿刀 U：对段 HasSameItemInSlot（:3597-3600——同 type ∨ 同互斥组在
      // 对段=无动作早退;方向：功能件扫社交段/社交件扫功能段）
      for (let k = oppBase; k < oppBase + 7; k++) {
        const t = inv.armor[k];
        if (t && accGroupClash(t.id, cur.id)) return;
      }
      // ★清偿刀 U（面②定谳,2026-09-29）：自段冲突 → 【换入冲突槽】（:3608-3623
      // HasIncompatibleAccessory 出 collisionSlot=首个 !CanEquipBothAccessories 槽 →
      // targetSlot=collisionSlot;仅 :3620-3623 锁槽才早退）。旧面 armorAccepts 拒→
      // 早退 = 自创语义（原版冲突=顶掉冲突件,非拒装;同 type 已在段=与己互换无害,
      // 原版照样 Sound7+成功）。
      let collision = -1;
      for (let k = accBase; k < accBase + 7; k++) {
        const t = inv.armor[k];
        if (t && accPairConflicts(t.id, cur.id, van)) { collision = k; break; }
      }
      if (collision >= 0) {
        if (!inv.isItemSlotUnlockedAndUsable(collision)) return;   // :3620-3623
        target = collision;
      } else {
        // 无冲突：首个解锁∧空槽（:3628-3635 解锁门 :12669-12690——大师无恶魔心
        // 态跳 8 落 9/19;全满 → 段首槽 :3627 targetSlot=accessories.Offset,
        // 3/13 恒解锁）
        target = accBase;
        for (let k = accBase; k < accBase + 7; k++) {
          if (inv.isItemSlotUnlockedAndUsable(k) && !inv.armor[k]) { target = k; break; }
        }
      }
    } else {
      const kind = equipKindOfInternal(cur.id);
      if (kind === 'dye') {
        // ★清偿刀 U（面③定谳,2026-09-29）：DyeSwap :3556-3577 持久计数器轮转——
        // while 跳锁（:3558-3561 mod 10 环扫）→ 全表 0..9 扫首个解锁∧空槽优先
        // （:3563-3568）→ 与计数槽 SwapClearFavorite（:3571）→ 计数器 +1 mod 10
        // （:3573）。旧面「全满早退」= 自创：原版全满【与计数槽交换】（被换下
        // 染料回源格）。计数器=UI 会话态（:292 static 不入档）,关背包归零
        // （closeInventory → resetInventoryStateCounters,Main.cs:46445 !playerInventory）。
        let c = dyeSwapCounter;
        while (!inv.isItemSlotUnlockedAndUsable(c)) c = (c + 1) % 10;
        for (let k = 0; k < 10; k++) {
          if (inv.isItemSlotUnlockedAndUsable(k) && !inv.dye[k]) { c = k; break; }
        }
        target = c;
        dyeSwapCounter = (c + 1) % 10;
        targetWhere = 'dye';
      } else if (kind && MISC_KINDS.includes(kind)) {
        target = MISC_KINDS.indexOf(kind);
        targetWhere = 'misc';
      } else return;
    }
    // ★清偿刀 U：armorAccepts 放置门在此退役——右键面门序已由上方逐臂原版语义
    //   承接（ArmorSwap :3592-3637/DyeSwap :3556-3577）。armorAccepts 的段内同款/
    //   双翅/对段门会误拒「换入冲突槽」臂（:3617 targetSlot=collisionSlot 本就顶
    //   冲突件）与全满段首交换臂;盔甲部位/段归属校验已由构造保证（target 由
    //   armorSlotIndexOf/段基址直算,非法物不入此臂=canSwapEquip 前置）。
    src.favorited = false; // 装上取消收藏（原版 ArmorSwap :3341）
    const arr = targetWhere === 'armor' ? inv.armor : targetWhere === 'dye' ? inv.dye : inv.miscEquips;
    const tmp = arr[target];
    if (tmp) tmp.favorited = false;   // ★SW-RB1 2026-09-06 SwapClearFavorite（ItemSlot.cs:1237-1242）双端清——被换下装备件回背包不得保留共享/收藏标记（ArmorSwap :3341 同调）
    arr[target] = src;
    // 回写与 slotContent 取数逐臂镜像（★BJ116-a：chest 向曾误落 miscDyes 分支）
    if (where === 'inv') inv.slots[i] = tmp ?? null;
    else if (where === 'armor') inv.armor[i] = tmp ?? null;
    else if (where === 'dye') inv.dye[i] = tmp ?? null;
    else if (where === 'misc') inv.miscEquips[i] = tmp ?? null;
    else if (where === 'miscDye') inv.miscDyes[i] = tmp ?? null;
    else if (this.openChest) this.openChest.items[i] = tmp ?? null;
    // ★清偿刀 U：SoundEngine.PlaySound(7)（ArmorSwap :3643/DyeSwap :3570/EquipSwap
    //   :3657 三 Swap 原语成功支内统一——swapVanityEquip :1857 同声=本仓 'pickup'）。
    //   旧 'menuTick'(Sound 12)=取件臂声,误挂。
    this.game.sfx.play('pickup', 1);
    // 成就：装备态检查（AchievementsHelper.HandleOnEquip——SwapEquip :3301/:3358）
    this.game.achNotifyEquipChanged();
  }

  /** ★SW-BJ116-a（2026-09-18）时装列右键=SwapVanityEquip（ItemSlot.cs:1845-1877）1:1：
   *  时装槽 armor[i] ↔ 功能同序槽 armor[i-10]（10-12↔0-2 盔甲 / 13-19↔3-9 配饰）
   *  整格互换——非"本段重排"。门序（:1847-1855）：商店开着早退（Main.npcShop>0）→
   *  双空早退 → context 11（配饰段 i>=13）加 CanEquipAccessoryInSlot 双向唯一性门
   *  （:1852——换入功能段/时装段各查目标段,冲突槽=目标槽放行 :3544）→
   *  SwapClearFavorite(:1237-1242) 双端清收藏 → Sound 7（:1857='pickup'）→
   *  HandleOnEquip（:1873,本仓 achNotifyEquipChanged 同义路径;原版门=换入时装槽件
   *  stack>0,本仓重查式成就钩不挑事件源,恒查=状态收敛同相）。1458 对拍零差 */
  private swapVanityEquip(i: number): void {
    if (this.game.npcShopOpen) return;                       // Main.npcShop > 0（:1847）
    const arr = this.game.player.inv.armor;
    const cur = arr[i] ?? null;
    const other = arr[i - 10] ?? null;
    if (!cur && !other) return;                              // 双空早退（:1852 首支）
    if (i >= 13) {                                           // context 11 双向门
      if (cur && !this.accFitsInSegment(i - 10, cur.id, false)) return;
      if (other && !this.accFitsInSegment(i, other.id, true)) return;
    }
    if (cur) cur.favorited = false;                          // SwapClearFavorite（:1237-1242）
    if (other) other.favorited = false;
    arr[i] = other;
    arr[i - 10] = cur;
    this.game.sfx.play('pickup', 1);                         // SoundEngine.PlaySound(7)（:1857）
    this.game.achNotifyEquipChanged();
    this.refreshAll();
  }

  /** CanEquipAccessoryInSlot（ItemSlot.cs:3540-3547,SwapVanityEquip context 11 门）：
   *  只扫目标段（AccSlots=armor[3..9] / VanityAccSlots=armor[13..19],ArraySegment
   *  段宽恒 7 :3502-3515——【不】设逐槽解锁门（解锁门在放置/效果面=清偿刀 P））段内
   *  CanEquipBothAccessories 全臂（HasIncompatibleAccessory :3472-3482 逐槽调）：同 type
   *  （:3462）/双翅（:3466-3473,社交段 3580 例外）/互斥组（:3475-3480）;空槽恒不冲突
   *  （air 收尾 true :3474-3480）;冲突槽=目标槽自身放行（collisionSlot==slot :3544——
   *  被换出件占目标槽天然放行）。对段【不】扫（此门无 :1313 跨段臂——armorAccepts
   *  的跨段同款臂属放置语境,SwapVanityEquip 无）。
   *  ★清偿刀 X（2026-09-29）债②收口：同 type/双翅/互斥组三臂整链改 accPairConflicts
   *  单源（与右键面同源勿复制）——旧内联缺互斥组臂（6168/6169/6193/6194 两两可共段
   *  =自创放行）且缺 3580 社交段双翼例外臂（开发者翼 3580×翼在社交段原版可共戴,
   *  Item.cs:32290 wingSlot=33;旧面误拒）。 */
  private accFitsInSegment(target: number, id: number, vanitySide: boolean): boolean {
    const arr = this.game.player.inv.armor;
    const lo = vanitySide ? VANITY_ARMOR_START + ACC_ARMOR_START : ACC_ARMOR_START;
    const hi = lo + (ARMOR_SLOTS - ACC_ARMOR_START);
    for (let k = lo; k < hi; k++) {
      if (k === target) continue;                            // 冲突槽=目标槽放行（:3544）
      const t = arr[k];
      if (!t) continue;                                      // 空槽不冲突
      if (accPairConflicts(id, t.id, vanitySide)) return false;   // 全臂单源（:3462/:3466/:3475）
    }
    return true;
  }

  /** ★SW-BJ116-a（2026-09-18）装备/染料/杂项列右键=取 1 到光标（ItemSlot.RightClick
   *  :1677-1691 switch 落空 → PickupItemIntoMouse :1695-1750）：光标空→clone 单件
   *  （源 favorited 且【整格】stack==1 时收藏随件 :1706-1709）;光标同款可叠→+1
   *  （:1685 CanStack && mouseItem.stack<maxStack 门）;光标异款/满叠→无动作。
   *  SoundEngine.PlaySound(12)（:1688）='menuTick'。★SW-BJ157：返回 true=本次确取
   *  一件（循环臂/装备臂据此 RefreshStackSplitCooldown :1753——原版音+冷却在
   *  CanStack 门【内】同支,:1686-1689）;原 stackSplit 连取面"未建模"登记随本刀清偿。
   *  源格 stack-- 归零清槽（:1719-1724,★清槽写回经 clearSlot——旧 equipArray(where)
   *  对 inv/chest 向误落 miscDyes 尾支,扩展到四 context 时的写回面勘误）。
   *  装备位取下恒合法,无 armorAccepts 回查（原版无门）。 */
  private pickupEquipIntoMouse(where: SlotWhere, i: number): boolean {
    const cur = this.slotContent(where, i);
    if (!cur) return false;                                  // inv[slot].IsAir return（:1678）
    if (this.heldStack) {
      if (!canMergeStack(this.heldStack, cur)) return false; // !Item.CanStack → 无动作
      const max = ITEM_DEFS[this.heldStack.id]?.maxStack ?? 9999;
      if (this.heldStack.stack >= max) return false;         // mouseItem.stack < maxStack（:1685）
      this.heldStack.stack++;
    } else {
      this.heldStack = {
        id: cur.id, stack: 1, prefix: cur.prefix,
        favorited: !!(cur.favorited && cur.stack === 1),     // :1706-1709
        ...(cur.placeStyle !== undefined ? { placeStyle: cur.placeStyle } : {}),
      };
      this.heldFrom = where;
    }
    cur.stack--;                                             // :1719
    if (cur.stack <= 0) this.clearSlot(where, i);            // :1721-1724
    this.game.sfx.play('menuTick', 1);                       // SoundEngine.PlaySound(12)（:1688）
    this.refreshAll();
    return true;
  }

  /** ★SW-BJ157：右键取件臂（ItemSlot.RightClick :1677-1692 逐拍面,inv/chest/coin/ammo
   *  四 context（0/3/4/32/1/2）装备门 fall-through 共用）：门 :1678
   *  `stackSplit > 1 || inv[slot].IsAir` → 循环 superFastStack+1 次（:1681
   *  Main.superFastStack 加速后一拍多件）,每次 (CanStack(mouse,slot) &&
   *  mouse.stack<maxStack) || mouse 空 → PickupItemIntoMouse+Sound12+Refresh
   *  （:1684-1690,门内同支=取件才播声/进冷却）。逐迭代闸在 pickupEquipIntoMouse
   *  内部（源格耗尽=IsAir → false 跳过,与原版 CanStack(mouse,空格)=false 同相）。
   *  cur=mousedown 现值仅作 :1678 IsAir 门,循环体内不缓存。 */
  private runPickupArm(where: SlotWhere, i: number, cur: { stack: number } | null): void {
    if (this.stackSplit > 1 || !cur) return;                 // :1678
    const num = this.superFastStack + 1;                     // :1681
    for (let k = 0; k < num; k++) {
      if (this.pickupEquipIntoMouse(where, i)) this.refreshStackSplitCooldown();
    }
  }

  /** ★SW-BJ157：RefreshStackSplitCooldown（ItemSlot.cs:1753-1761 逐字）：首取
   *  （stackSplit==0）→ 30 拍冷却;续取 → Main.stackDelay（加速梯当前档 7→2）——
   *  梯面在 tickStackSplitMain（Main.cs:62728-62755 移植） */
  private refreshStackSplitCooldown(): void {
    this.stackSplit = this.stackSplit === 0 ? 30 : this.stackDelay;
  }

  /** ★SW-BJ391（2026-09-28）压面合成 tick+长按臂上膛——四制作站（classic 列表行/
   *  classic 鱼眼格/modern 网格格/modern 详情槽）共用，= HoverOverCraftingItemButton
   *  (Main.cs:42971-43036) 压拍面 1:1：
   *  ① 压拍合成（:43014 CraftItem(recipe, num2)）——压拍 superFastStack 恒 0（松键
   *     归零面 :62728/:63422 已把梯全量复位）⇒ num2=(0+1)×(ShiftInUse?10:1)=1|10
   *     两档，即本仓旧单击语义 shift×10 的正身；
   *  ② :43013 RefreshStackSplitCooldown——压拍进 30 拍冷却（长按首段 0.5s 停顿,
   *     之后 stackDelay 梯 7→2 逐档加速,面在 tickStackSplitMain ①）；
   *  ③ 上膛（flag4 反面）——:42996-42998 `flag5=num|flag4`（_currentRecipeBeingCrafted
   *     .createItem.maxStack==1 阻连做）⇒ 成品 maxStack-1（武器类）一按一做不上膛,
   *     松键重按才再做（压拍照常合成+冷却,与原版 _currentRecipeBeingCrafted 置位
   *     后按住期恒阻同相）。行重建换锚由各站重建体认 kind+配方身份自理。 */
  private craftPressTick(r: VanillaRecipeLike, shift: boolean, rowEl: HTMLElement,
    kind: 'list' | 'fisheye' | 'mcell' | 'mdetail'): void {
    if (!this.game) return;
    this.game.vanillaCraft(r, shift ? 10 : 1, true);        // :43014（压拍 num2 恒 1|10）
    this.refreshStackSplitCooldown();                       // :43013
    const iid = this.game.itemId(vanillaItemKey(r.create) ?? '');
    // 每次压拍重根按住语境（原版压拍 _currentRecipeBeingCrafted 必置位、松键才清）：
    // maxStack>1 上膛;maxStack-1 显式落臂（旧锚不清则压武器后回悬停旧配方行会
    // 续做旧配方,原版 flag5 阻断面=松键才可再做）
    this.craftHold = iid > 0 && (ITEM_DEFS[iid]?.maxStack ?? 0) > 1   // flag4 反面（:42997-42998）
      ? { el: rowEl, r, kind }
      : null;
  }

  /** ★SW-BJ535（2026-10-06）：tick 驱动悬停 hit-test——原版每拍形态。
   *  HoverOverCraftingItemButton 的悬停复核在原版=Draw 逐帧基于 Main.mouseX/mouseY
   *  坐标 hit-test（Main.cs:42971 由 Update/Draw 面逐拍调用,不依赖输入事件流）。
   *  本仓曾用 el.matches(':hover')（CSS 伪类=浏览器 hit-test 缓存,其刷新由
   *  mousemove 事件流驱动）——长按合成→refreshAll 整表重建→臂锚换新行,Windows
   *  静止鼠标零 mousemove ⇒ 新行 hover 位永不建立 ⇒ 推进冻结,晃动鼠标补流才
   *  恢复（用户实报;mac 触摸板微动持续供流掩盖）。修=elementFromPoint(mouseX,
   *  mouseY) 每拍几何重算（坐标=最后已知光标位,静止期即精确位,与事件流解耦,
   *  resolveDrop :3069 同习语）;t===el‖contains=子元素悬停传播,与 :hover 同义。
   *  实证锚:Chrome 154 探针 scripts/_bj535-hover-maintenance.mjs——mousemove
   *  正常派发 mouseenter（事件流注入健康）而 matches(':hover') 不随建立/
   *  elementFromPoint 恒正确。 */
  private hoverHitTest(el: HTMLElement): boolean {
    if (!el.isConnected) return false;
    const t = (typeof document !== 'undefined'
      ? document.elementFromPoint?.(this.mouseX, this.mouseY) : null) as HTMLElement | null;
    return !!t && (t === el || el.contains(t));
  }

  /** ★SW-BJ391：快捷制作长按臂电平面（tickStackSplitMain ⑤,逐拍驱动）。
   *  门序 = HoverOverCraftingItemButton :42986-43018：
   *  ① flag2 电平（:42980 mouseLeft || mouseRight——本臂锚左键压面站,右键不制作）
   *     松键/元素销毁（面板关/池重建未及物化）→ 落臂;:63422 双键全松归零面照跑;
   *  ② :42988 guideItem.IsAir 门（guidePlaced 反查态不合成）;
   *  ③ 悬停复核（原版=Draw 逐帧仅悬停焦点行调用本函数）——不悬停【暂停不清锚】,
   *     回行续做=原版按住中移出再移回续做同相（focusRecipe 不随悬停迁移,flag 臂
   *     需 fresh click 而按住中恒 false）;★BJ535:判定走 hoverHitTest 每拍坐标
   *     hit-test（含子元素传播）,曾用 matches(':hover') 依赖 mousemove 事件流
   *     =Windows 静止长按推进冻结根因（见 hoverHitTest 注）;
   *  ④ :42999 `stackSplit <= 1` 门（冷却窗内不连做——梯/递减已先行,本臂见后相）;
   *  ⑤ 逐拍 num2=(superFastStack+1)×(ShiftInUse?10:1)（:42994-42996——Shift 电平
   *     逐拍读,长按中途按/松 Shift 即刻变档）→ vanillaCraft(times=num2)（逐轮双门
   *     循环体内建,料尽/光标满即停轮）+ :43013 冷却 + refreshAll（计数/材料行随拍）。 */
  private runCraftArm(): void {
    const ch = this.craftHold;
    if (!ch) return;
    if (!this.uiBtnLeft || !ch.el.isConnected) {            // flag2 电平/元素销毁
      this.craftHold = null;
      return;
    }
    if (this.guidePlaced) return;                           // :42988 guideItem.IsAir 门
    if (!this.hoverHitTest(ch.el)) return;                  // 离行暂停,回行续做（★BJ535 坐标 hit-test,原 matches(':hover')=事件流依赖冻结根因）
    if (this.stackSplit > 1) return;                        // :42999 冷却门
    if (!this.game) return;
    const num2 = (this.superFastStack + 1) * (this.uiBtnShift ? 10 : 1);   // :42994-42996
    this.game.vanillaCraft(ch.r, num2, true);               // :43014
    this.refreshStackSplitCooldown();                       // :43013
    this.refreshAll();
  }

  /** ★SW-BJ430（2026-10-02 用户拍板翻案 X4-债5）：制作列表站压拍两臂分派——
   *  HoverOverCraftingItemButton (Main.cs:42971-43036) 的 if/else-if 结构 1:1：
   *  ① :42988 合成支 `focusRecipe == recipeIndex && guideItem.IsAir`——焦点行∧无向导
   *     件才进压拍合成（craftPressTick BJ391 面:压拍 1|10+30 拍冷却+上膛）；
   *  ② :43020-43024 else-if(flag) 臂=【首击聚焦不合成】——focusRecipe=recipeIndex +
   *     stackSplit=15（:43021,15 拍内 :42999 stackSplit≤1 门恒阻=重按前零合成）+
   *     SoundEngine.PlaySound(12)（:43023）。_preventCraftingBecauseClickWasUsedTo
   *     ChangeFocusedRecipe 旗面=本仓 mousedown 每压一发模型下【不上膛】承载：按住
   *     期无合成拍（runCraftArm 无锚）≡原版旗恒阻支,松键重按走①=原版二击合成同相
   *     （松键 :63422 归零面照跑,重按压拍=原版 stackSplit≤1 支同拍）。
   *  count≤0 早退=防御门（vanilla availableRecipe 只含可合成行,本表不入列）。
   *  hoverFocus=-1/returnCraftGrid=SW 材料格域语义（预览退场/格料归还,两臂同旧）。 */
  private craftListPress(idx: number, rec: { r: VanillaRecipeLike; count: number },
    shift: boolean, rowEl: HTMLElement): void {
    if (rec.count <= 0) return;                              // 防御门（原版列表不含不可合成行）
    this.hoverFocus = -1;                                    // 点击行即焦点,预览态退场（同旧）
    this.returnCraftGrid();                                  // 格料先归还再统一扣料（同旧）
    if (this.craftFocus === idx && !this.guidePlaced) {      // ① :42988 合成支
      this.craftPressTick(rec.r, shift, rowEl, 'list');
      this.refreshAll();
      return;
    }
    // ② :43020-43024 聚焦支（首击聚焦不合成;guidePlaced 态点击同落本支=原版合成支死）
    this.craftFocus = idx;
    this.stackSplit = 15;                                    // :43021
    this.game?.sfx.play('menuTick', 1);                      // :43023 Sound 12
    this.refreshAll();
  }

  /** ★SW-BJ157：stackSplit 计时面逐拍驱动（cb.onStackSplitTick,Game.frame 60Hz
   *  累加注入——暂停期照走=原版 Main.Update 面,autoPause 开包连取不冻结）。
   *  ① 加速梯（Main.cs:62728-62755 逐字）：stackSplit==0 全量复位;否则 stackCounter++
   *  窗口={7:30,6:25,5:20,4:15,3:10,余:5},满窗 stackDelay--（钳 2 且 superFastStack++,
   *  timesTriedToFastStack<10 期 superFastStack 归零=长按 10 窗后才一拍多件）。
   *  ② 松键归零+递减（Main.cs:63422-63430）：双键全松 → stackSplit=0;>0 逐拍--。
   *  ③ 取件臂电平重跑（RightClick :1614 由 Draw :566 悬停格逐帧调用——右键按住+
   *  仍悬停原格才续取;面板关/元素离树即清）。
   *  ④ quickCraftStackSplit 豁免支（Main.cs:63420 `(!quickCraftStackSplit||!Grapple)`
   *  不建模=★BJ208 定谳死码：全反编译树 `quickCraftStackSplit = true` 零写点——仅
   *  声明 :1772/读 :63420/复位 :63430 三站,"钩爪快造持握保 stackSplit"场景在原版
   *  不可达,建模反成自创行为（登记备查）。 */
  tickStackSplitMain(): void {
    // ★R15-F15（C15 清偿）：占卜球 5644 强制退出臂（下一拍归还,原版位次
    //   Main.cs:42282-42288——CloseAll 关窗后下一帧 talkNPC==-1 → InReforgeMenu=false
    //   + dropItemCheck reforgeItem 支回包）。onStackSplitTick=60Hz 常走帧路径
    //   （暂停期照走,Game.ts 注）=关包后仍会跑的逐拍 UI 通道。F17 同臂搭车：
    //   classic modal 重铸面板走远自动关（原版 :42277 四退出条件对 classic 面同相;
    //   vinv 面已由 vinvGuideMenuExitCheck 承载,classic overlay 无逐拍退出臂=旧缺）。
    if (this.vinvReforgeForcedReturn) {
      this.vinvReforgeForcedReturn = false;
      if (this.vinvReforgeOpen) this.vinvReforgeOpen = false;
      this.returnReforgeItem();   // 内含 onInventoryChanged → refreshAll
    }
    if (this.reforgeEl && this.game
      && (!!this.openChest || !!this.game.npcShopOpen
        || !(this.game as unknown as { dialogNpc?: unknown }).dialogNpc)) {
      this.closeReforge();      // 走远/开箱/开店 → classic 面强制退出（同 :42277 条件集）
    }
    if (this.stackSplit === 0) {                             // :62728-62733
      this.timesTriedToFastStack = 0;
      this.stackCounter = 0;
      this.stackDelay = 7;
      this.superFastStack = 0;
    } else {                                                 // :62735-62755
      this.stackCounter++;
      const win = this.stackDelay === 7 ? 30 : this.stackDelay === 6 ? 25
        : this.stackDelay === 5 ? 20 : this.stackDelay === 4 ? 15
        : this.stackDelay !== 3 ? 5 : 10;                    // :62739 逐档窗口
      if (this.stackCounter >= win) {
        this.stackDelay--;
        if (this.stackDelay < 2) {
          this.stackDelay = 2;
          this.superFastStack++;
        }
        if (this.timesTriedToFastStack < 10) this.superFastStack = 0;
        this.timesTriedToFastStack++;
        this.stackCounter = 0;
      }
    }
    if (!this.uiBtnRight && !this.uiBtnLeft) this.stackSplit = 0;   // :63422-63424
    if (this.stackSplit > 0) this.stackSplit--;                     // :63425-63427
    // ③ 取件臂电平面
    const hold = this.rcHold;
    if (hold) {
      if (!this.uiBtnRight || !this.invPanel || this.invPanel.style.display !== 'block'
        || !hold.el.isConnected || !hold.el.matches(':hover')) {
        this.rcHold = null;
      } else {
        this.runPickupArm(hold.where, hold.i, this.slotContent(hold.where, hold.i));
      }
    }
    // ⑤ 快捷制作臂电平面（★SW-BJ391：HoverOverCraftingItemButton Main.cs:42971-43036
    //    逐拍面——shift+左键按住配方行连做,见 runCraftArm 门序注）
    this.runCraftArm();
  }

  /** ★SW-BJ157：槽位清空写回（slotContent 读面逐臂镜像——swapEquipItem :1668-1673
   *  同梯;chest 向=panel openChest.items） */
  private clearSlot(where: SlotWhere, i: number): void {
    const inv = this.game.player.inv;
    if (where === 'inv') inv.slots[i] = null;
    else if (where === 'armor') inv.armor[i] = null;
    else if (where === 'dye') inv.dye[i] = null;
    else if (where === 'misc') inv.miscEquips[i] = null;
    else if (where === 'miscDye') inv.miscDyes[i] = null;
    else if (this.openChest) this.openChest.items[i] = null;
  }

  /** ★SW-AU2 2026-09-06 Alt+左键（FavoriteKey，Main.cs:67607 缺省 LeftAlt）语义：
   *  OverrideHover :571-599 优先级（聊天分享 :583-587 → 收藏/共享 :588-592）+
   *  OverrideLeftClick cursorOverride 2/3 分派 :709-730。返回 true=点击已消费；
   *  false=语境无 Alt 动作（:577 空格早退 / 语境域外）→ 调用方回落普通点击。
   *  ★misc/miscDye 族无任何 Alt 语义（canFavoriteAt 仅 0/1/2/32 :358-361、
   *  canLoadoutShareAt 仅 8-12 :367-371，R4-15③）→ 落空走常规点击。★关包快捷栏
   *  context 13（Main.cs:44374 无 Handle）同落空——Alt+点选中栏位不收藏 */
  private altSlotClick(i: number, where: SlotWhere, panelOpen: boolean): boolean {
    const cur = this.slotContent(where, i);
    if (!cur) return false;                                  // :577 IsAir return
    // ★SW-AY1 R7：容器来源入语境（世界箱 3/银行 4/虚空保险库 32——canFavoriteAt[32]）
    const ctx = slotContext(where, i, panelOpen, where === 'chest' ? this.openChest?.x : undefined);
    // 聊天分享（:583-587 drawingPlayerChat && canShareAt → cursorOverride 2 →
    // :709-716 ChatManager.AddChatText 插物品 tag + SoundID 12）
    if (this.game.chatInput?.isOpen && CAN_SHARE_AT.includes(ctx)) {
      this.game.insertChatItemTag(vidOf(cur.id));
      this.game.sfx.play('menuTick', 1);
      return true;
    }
    if (CAN_FAVORITE_AT.includes(ctx)) {                     // :717-723 ToggleFavorited
      cur.favorited = !cur.favorited;
      this.game.sfx.play('menuTick', 1);                     // SoundID 12（:848）
      this.refreshAll();
      return true;
    }
    if (CAN_LOADOUT_SHARE_AT.includes(ctx)) {                // :724-727 ToggleLoadoutShare
      cur.favorited = !cur.favorited;
      this.game.sfx.play('menuTick', 1);                     // SoundID 12（:855）
      if (cur.favorited) {
        // DisableLoadoutShareHint :857-860（R4-14 持久化清偿）——原版 :391 有
        // if(ShowLoadoutShareHint) 卫门,已熄则不触发 emit/防抖写盘
        if (options.data.showLoadoutShareHint) {
          void options.set('showLoadoutShareHint', false);
        }
        // ClearSlotShareInOtherLoadouts :863-884：同槽仅一套可共享
        const inv = this.game.player.inv;
        const backups = inv.loadouts.map((l) => (where === 'armor' ? l.armor : l.dye));
        for (const arr of backups) {
          const b = arr[i];
          if (b) b.favorited = false;
        }
      }
      this.refreshAll();
      return true;
    }
    return false;
  }

  /** ★SW-AY1 R5 研究献祭面板在显探针（CreativeMenu.IsShowingResearchMenu :631 的
   *  仓库等价=isResearchPanelOpen 间接层——方法化便于测试面覆写） */
  private researchMenuShowing(): boolean {
    return isResearchPanelOpen();
  }

  /** ★SW-AU2 2026-09-06 Shift/Ctrl+左键快移动作：GetAlternateClickAction :601-700
   *  路由 + OverrideLeftClick cursorOverride 6/7/8/9/10 分派 :702-843。返回 true=
   *  已消费（sell 支原版恒 return true :840-841——卖不掉也不回落）；false=语境无
   *  动作 → 普通点击（拾取/选中）。缺省设置面（Options :28-30 = "Quick Trash:
   *  Left Control" 档）：Shift 只做快移（无去处=无动作），Ctrl 做垃圾桶/卖出 */
  private altMoveClick(i: number, where: SlotWhere, shift: boolean, ctrl: boolean, panelOpen: boolean): boolean {
    const cur = this.slotContent(where, i);
    const inv = this.game.player.inv;
    const chest = this.openChest;
    const maxStack = cur ? (ITEM_DEFS[cur.id]?.maxStack ?? 1) : 1;
    // ★SW-AY1 #10：Quick Trash 三态设置进路由（缺省 Left Control = QUICK_TRASH_DEFAULTS）
    const curVid = cur ? (ITEM_DEFS[cur.id]?.vid ?? -1) : -1;
    const plan = planAlternateClick({
      context: slotContext(where, i, panelOpen, where === 'chest' ? chest?.x : undefined),
      itemAir: !cur,
      favorited: !!cur?.favorited,
      isCoin: cur ? coinIndexOf(cur.id) >= 0 : false,
      shopOpen: this.game.npcShopOpen,
      chestOpen: !!chest,
      chestCanTake: !!cur && !!chest && chestCanTakeJustCheck(chest.items, cur.id, maxStack, cur.prefix, (cur as { placeStyle?: number }).placeStyle),   // ★SW-BP1 placeStyle 随行（与 shiftDepositToChest 同源同判）
      canTakeToInventory: !!cur && canTakeToPersonalInventory(inv.slots, cur.id, maxStack,
        coinIndexOf(cur.id) >= 0, ammoSlotAccepts(cur.id), cur.prefix,
        canFillEmptyAmmoSlot(cur.id)),
      shiftDown: shift,
      controlDown: ctrl,
      opts: quickTrashOptionsOf(options.data.quickTrashMode),
      // ★SW-AY1 R5 菜单特化支入路由（ItemSlot.cs:631-651 else-if 序）：
      // 研究献祭面板在显（CreativeMenu.IsShowingResearchMenu）/ 向导反查在显
      // （InGuideCraftMenu）——重铸支不可达（showReforge 全屏 overlay,结案不传）
      // ★SW-RB29c F2:InGuideCraftMenu 是 Main 全局态（Main.cs:1917）——vanilla
      //   内嵌向导态（guideEl=null,vinvGuideMenuOpen=true）同样要进 cursorOverride 9
      //   向导支（原版 Utils.Swap(inv[slot], Main.guideItem) 是全局语义,非 classic
      //   浮层专属;曾只接 guideEl 臂 = vanilla 态 Shift+点材料丢对换落空）
      researchMenuOpen: this.researchMenuShowing(),
      guideMenuOpen: !!this.guideEl || this.vinvGuideMenuOpen,
      itemMaterial: cur ? curVid > 0 && materialVids().has(curVid) : false,   // ★SW-BJ24 2026-09-07 vid 域池（旧并集池 iid 跨域碰撞：钉鞋 975→iid 24 污染）
      // ★R15-F16：vinv 重铸菜单在显 + 可词缀判据（canReforge=CanHavePrefixes 等价面
      //  单源;classic overlay 不可达=只置 vinv 面）
      // ★债①惰性化（2026-10-11 C15-F16 收尾）：canReforge 只在重铸菜单在显时求值——
      //  消费面 SlotActions.ts:217-219 的 itemCanHavePrefixes 读取点在 reforgeMenuOpen
      //  支内（:217 门先于 :218 读;env 同帧同步构造+消费,无交叉窗）→ 菜单关态该值
      //  不可观测。&& 短路序以 vinvReforgeOpen 为首门：开态表达式逐位不变=行为同;
      //  关态免一次纯读求值（alt/shift/ctrl 点击热面）,旧槽域测试桩无 canReforge
      //  API 面亦不再炸（16 红复绿=副作用面,非目的）。
      reforgeMenuOpen: this.vinvReforgeOpen,
      itemCanHavePrefixes: this.vinvReforgeOpen && !!cur && this.game.canReforge(cur),
    });
    if (!plan) return false;
    switch (plan.kind) {
      case 'sell': {
        // cursorOverride 10（:823-841）：SellItem 入店，恒消费（:840 return true）
        this.game.npcShopSell(i);
        this.refreshAll();
        return true;
      }
      case 'trash': {
        // cursorOverride 6（:731-748）：trashItem = item.Clone() 覆盖旧桶 +
        // item.TurnToAir()，TrashItem+Grab 双音（同垃圾桶直丢路径）；context 6
        // 不保留收藏（retainFavoriteOnMoveAt :362-366 → MouseItemSwap 清标记）
        const item = { ...cur!, favorited: false };
        if (where === 'chest') chest!.items[i] = null;
        else inv.slots[i] = null;
        const oldTrash = inv.trash;                    // ★SW-AY1 R4b：旧桶件先取（:734 ref 面）
        inv.trash = item;
        // ★SW-AY1 R4b journey 研究随垃圾桶（:733-738）：新件克隆按
        // onlySacrificeIfItWouldFinishResearch 献祭 + 旧桶件整段献祭——两支皆空
        // 才播 TrashItem（:735-737 `!(A | B)` 非短路序）。TryResearchingItem 内
        // 播 Research_0/1-3（:1265/:1268）
        let researchedNew = false;
        let researchedOld = false;
        if (this.game.world?.isJourney && cur) {
          researchedNew = this.tryResearchIntoTrash(cur, true);
          researchedOld = oldTrash ? this.tryResearchIntoTrash(oldTrash, false) : false;
        }
        if (!(researchedNew || researchedOld)) this.game.sfx.playFiles(['trash_item_0', 'trash_item_1'], 1);
        this.game.sfx.play('pickup', 1);
        this.refreshAll();
        return true;
      }
      case 'toChest': {
        // cursorOverride 9 分派（:785-821）：研究献祭 → 重铸（不可达,结案）→
        // 向导对换 → 入箱（ChestUI.TryPlacingInChest justCheck:false :818）
        if (!cur) return true;
        if (this.researchMenuShowing()) {              // :787-792 SwapItem+SacrificeItemInSacrificeSlot
          this.shiftResearchSacrifice(i, cur);
          return true;
        }
        if (this.guideEl || this.vinvGuideMenuOpen) {  // ★RB29c F2:vanilla 内嵌向导态同支（:810-815 Utils.Swap(inv[slot], guideItem)）
          this.shiftGuideSwap(i, cur);
          return true;
        }
        // ★R15-F16（C15 清偿）：重铸对置支（ItemSlot.cs:793-806 cursorOverride 9
        //  InReforgeMenu——:797 stack≤1=Utils.Swap(ref inv[slot], ref Main.reforgeItem)
        //  双向保全（槽内旧重铸物回原格）;:798-806 stack>1 ∧ 槽空=Clone stack=1 +
        //  源 stack--。两臂皆播 SoundEngine.PlaySound(7)=pickup。stack>1 且槽占=
        //  原版无支静默消费（no-op,return true 同相））
        if (this.vinvReforgeOpen && !this.researchMenuShowing()) {
          if (cur.stack <= 1) {
            const tmp = this.reforgeItem;
            this.reforgeItem = { ...cur };
            inv.slots[i] = tmp ?? null;                // Utils.Swap 双向（旧重铸物回格）
          } else if (!this.reforgeItem) {
            this.reforgeItem = { ...cur, stack: 1 };   // 取 1 件（F13 同式）
            cur.stack -= 1;
          }
          this.game.sfx.play('pickup', 1);             // SoundEngine.PlaySound(7)
          this.refreshAll();
          return true;
        }
        if (chest) this.shiftDepositToChest(i, cur);
        return true;
      }
      case 'fromChest': {
        // cursorOverride 8（:772-784）：GetItem(QuickTransferFromSlot) 箱→背包，
        // 落袋才发 NotifyItemPickup + GetItem 内 SoundID 7（Player.cs:39755）
        if (!chest || !cur) return true;
        const left = inv.add(cur.id, cur.stack, cur.prefix, (cur as { placeStyle?: number }).placeStyle);
        const picked = cur.stack - Math.max(0, left);
        if (left === 0) chest.items[i] = null;
        else cur.stack = left;
        if (picked > 0) {
          const cv = vidOf(cur.id);
          if (cv > 0) this.game.achievements.notifyItemPickup(cv);
          // ★SW-AY1 #9 GetItem 币种专音（:39755 `IsACoin ? 38 : 7`，SoundID 38=CoinPickup）
          this.game.sfx.play(coinIndexOf(cur.id) >= 0 ? 'coin' : 'pickup', 1);
        }
        this.refreshAll();
        return true;
      }
      case 'unequip': {
        // cursorOverride 7（:749-771）：GetItem(QuickTransferFromSlot) 卸回背包。
        // 落袋音 GetItem 7（:39755）+ 支尾 SoundID 12（:769）
        if (!cur) return true;
        const arr = this.equipArray(where);
        const left = inv.add(cur.id, cur.stack, cur.prefix, (cur as { placeStyle?: number }).placeStyle);
        const picked = cur.stack - Math.max(0, left);
        if (left === 0) arr[i] = null;
        else if (arr[i]) arr[i]!.stack = left;   // ★残量写回（旧实现漏写=整叠复制进槽）
        if (picked > 0) {
          const uv = vidOf(cur.id);
          if (uv > 0) this.game.achievements.notifyItemPickup(uv);
          // ★SW-AY1 #9 GetItem 币种专音（:39755 IsACoin ? 38 : 7）
          this.game.sfx.play(coinIndexOf(cur.id) >= 0 ? 'coin' : 'pickup', 1);
        }
        // ★SW-RB4a 2026-09-06：支尾 SoundID 12（ItemSlot.cs:769）【无条件】播放——
        // 曾挂 picked>0 门=满背包卸下时静默（vanilla cursorOverride 7 尾奏不看落袋成败）
        this.game.sfx.play('menuTick', 1);
        this.refreshAll();
        return true;
      }
      case 'toBackpack':
      case 'creativeDupe':
        // 语境 5/6/7/29（重铸格/垃圾桶/向导格/旅程无限复制格）——本仓垃圾桶支在
        // 垃圾桶槽监听器直连（SlotWhere 无垃圾桶域），其余槽未建模 → 不可达
        return false;
    }
  }

  /** ★SW-AY1 R4b journey 研究随垃圾桶（ItemSlot.cs:733-736 → TryResearchingItem
   *  :1249-1272 + CreativeUI.SacrificeItem :288-329 spawnExcessItem:false 等价）：
   *  被丢件照原样入桶（原版是对 DeepClone 献祭、本体照扔），研究登记在献祭面。
   *  @param onlyIfFinish onlySacrificeIfItWouldFinishResearch（:304-307——只在本件
   *  覆盖剩余研究缺口整段时才献）。返回是否献祭成立（:735 `!(A|B)` 音面判据） */
  private tryResearchIntoTrash(it: { id: number; stack: number }, onlyIfFinish: boolean): boolean {
    const vid = (ITEM_DEFS[it.id]?.vid ?? -1);
    if (!(vid > 0)) return false;
    const n = this.game.research.tryGetSacrificeNumbers(vid);
    if (!n) return false;                                  // :293-295 无条目 CannotSacrifice
    const remaining = n.need - n.have;
    if (remaining <= 0) return false;                      // :297-301 num==0
    const num2 = Math.min(remaining, it.stack);            // :302
    if (onlyIfFinish && num2 !== remaining) return false;  // :304-307
    const done = this.game.research.sacrifice(vid, num2);  // :312 RegisterItemSacrifice
    // TryResearchingItem :1262-1270 音：跨线完成 64=Research_0 / 推进未满 63=Research_1..3
    if (done) this.game.sfx.playWavFile('Research_0');
    else this.game.sfx.playFiles(['Research_1', 'Research_2', 'Research_3'], 1);
    this.game.net?.sendJourneyUnlock(vid, num2);           // M9（SacrificeItem :308 序列化上报）
    this.game.cb?.onInventoryChanged?.();
    return true;
  }

  /** ★SW-AY1 R5 cursorOverride 9 研究支（ItemSlot.cs:787-792 SwapItem +
   *  SacrificeItemInSacrificeSlot → UICreativeInfiniteItemsDisplay.SacrificeWhatYouCan
   *  :446-462 = SacrificeItem 缺省参 spawnExcessItem:true）：Shift+点背包格整段
   *  献祭 min(need-have, stack)。近似登记：本仓研究面板无实体献祭格（列表化
   *  ResearchUI），SwapItem 的回吐面=净无操作；献后溢出留原格（原版经
   *  GetItem(ReturnItemFromSlot) 回包/落地，净语义同为「留在身上」） */
  private shiftResearchSacrifice(i: number, cur: { id: number; stack: number }): void {
    const vid = (ITEM_DEFS[cur.id]?.vid ?? -1);
    const n = vid > 0 ? this.game.research.tryGetSacrificeNumbers(vid) : null;
    const remaining = n ? n.need - n.have : 0;
    if (!n || remaining <= 0) return;                      // 不可研究=原版 Swap 后原样回桌
    const num2 = Math.min(remaining, cur.stack);
    const done = this.game.research.sacrifice(vid, num2);
    cur.stack -= num2;                                     // :314 item.stack -= num2
    if (cur.stack <= 0) this.game.player.inv.slots[i] = null;   // :315-318 TurnToAir
    if (done) this.game.sfx.playWavFile('Research_0');     // 献祭动画拍音（:354/:372）
    else this.game.sfx.playFiles(['Research_1', 'Research_2', 'Research_3'], 1);
    this.game.net?.sendJourneyUnlock(vid, num2);
    this.game.cb?.onInventoryChanged?.();
    this.refreshAll();
  }

  /** ★SW-AY1 R5 cursorOverride 9 向导支（ItemSlot.cs:810-815 Utils.Swap
   *  (ref inv[slot], ref Main.guideItem) + SoundID 7）：Shift+点背包材料格与反查
   *  材料槽对换。★SW-BM1 2026-09-06：guidePlaced 增 prefix 位——对换回格件保词缀
   *  （Utils.Swap 换的是整个 Item 对象,prefix 随行;旧 {id,stack} 近似丢词缀=
   *  槽位驱动流同款已登记,本刀清偿）。★SW-RB5a 2026-09-07：此处是裸 Utils.Swap
   *  （非 MouseItemSwap,context 7 不在 retainFavoriteOnMoveAt）——favorited 随整个
   *  Item 对象双向骑行,收藏件对换往返不丢星（左键各支走 MouseItemSwap 双端清,
   *  依旧不携带） */
  private shiftGuideSwap(i: number, cur: { id: number; stack: number; prefix?: number; favorited?: boolean; placeStyle?: number }): void {
    const pl = this.guidePlaced;
    this.guidePlaced = { id: cur.id, stack: cur.stack, ...(cur.prefix !== undefined ? { prefix: cur.prefix } : {}), ...(cur.favorited ? { favorited: true } : {}), ...(cur.placeStyle !== undefined ? { placeStyle: cur.placeStyle } : {}) };
    this.game.player.inv.slots[i] = pl ? { ...pl } : null;
    this.game.sfx.play('pickup', 1);                       // SoundEngine.PlaySound(7)（:814）
    this.guideRefresh?.();                                 // 反查面板材料行/槽面即刻重刷
    this.refreshAll();
  }

  /** ★SW-AU2 2026-09-06 快移入箱（ChestUI.TryPlacingInChest :1205-1285
   *  justCheck:false 段 1:1）：先并箱内同型余堆（:1219-1256 逐堆、SoundID 7），
   *  余量克隆进首空格（:1258-1283、SoundID 7）——入箱即清收藏（context 3/4 不在
   *  retainFavoriteOnMoveAt :362-366，MouseItemSwap :1230-1234 双端清；32 虚空袋
   *  面不走本方法——Shift 入柜面收藏件被 :604 总闸拦截）。★SW-AY1 R1 合并判据
   *  改 canMergeStack（CanStack 词缀面 :1221）；★SW-BP1 2026-09-07 placeStyle 位
   *  随 canMergeStack 生效（cur 携实例样式→敌旗跨样式不并;JustCheck 门同判同源） */
  private shiftDepositToChest(i: number, cur: { id: number; stack: number; prefix?: number; placeStyle?: number; favorited?: boolean }): void {
    const chest = this.openChest;
    if (!chest || cur.stack <= 0) return;
    const inv = this.game.player.inv;
    const max = ITEM_DEFS[cur.id]?.maxStack ?? 1;
    let moved = 0;
    if (max > 1) {
      for (const cs of chest.items) {
        if (!cs || cs.stack >= max || !canMergeStack(cs, cur)) continue;
        const put = Math.min(max - cs.stack, cur.stack);
        cs.stack += put; cur.stack -= put; moved += put;
        if (cur.stack <= 0) break;
      }
    }
    if (cur.stack > 0) {
      for (let k = 0; k < chest.items.length; k++) {
        if (!chest.items[k]) {
          chest.items[k] = { ...cur, favorited: false } as ChestData['items'][number];   // item.Clone()（:1273）——SW-AV2 2026-09-06 仅补类型断言（箱槽元素型无 favorited;运行时语义原样,pre-existing 修复）
          inv.slots[i] = null;                             // item.SetDefaults(0)（:1274）
          moved += cur.stack;
          break;
        }
      }
    }
    if (cur.stack <= 0) inv.slots[i] = null;
    if (moved > 0) this.game.sfx.play('pickup', 1);        // SoundID 7（:1237/:1272）
    this.refreshAll();
  }

  // ---- 拖拽系统：按下起点 + 光标持有物（ghost 跟随） ----
  private dragFrom: { i: number; where: SlotWhere; sx: number; sy: number } | null = null;
  private ghostEl: HTMLElement | null = null;
  private mouseX = 0; private mouseY = 0;
  /** ★批III② MouseItem 光标辉光（CraftingEffects.GetGlow :41-48 / _mouseItemGlow
   *  衰减 0.035/UI tick :35-38 ≈500ms；ItemSlot :2500-2526 绘制段）：刚合成物品的
   *  OurFavoriteColor(255,23169) SM2 辉光脉冲。Game 合成完成侧经 cb.onCraftCursorGlow 注入 */
  private cursorGlowId = -1;
  private cursorGlowUntil = 0;
  /** 辉光时长（1/0.035≈28.6 tick×16.7ms 取整） */
  private static readonly CURSOR_GLOW_MS = 480;
  /** SM2 MouseItem 光晕烘焙缓存（键=id|glow 量化档;防 mousemove 逐帧跑解释器） */
  private readonly mouseHaloCache = new Map<string, HTMLCanvasElement | 'pending'>();
  /** 合成完成注入（mainFlow cb 接线）——vanilla 语义=成品上光标(CraftItem_GrantItem),
   *  本仓成品入包,拾取同型时辉光仍亮即近似复现脉冲观感（模型差登记） */
  markCursorGlow(id: number): void {
    this.cursorGlowId = id;
    this.cursorGlowUntil = performance.now() + UI.CURSOR_GLOW_MS;
    this.moveGhost();
  }

  /** 合成成品上光标（CraftItem_GrantItem Main.cs:43329 `mouseItem = result`）：
   *  光标空=整叠挂上；同 id 且同词缀=并入（上限钳制）；异 id/异词缀/装不下 =
   *  余量返回给调用方走背包。返回【未能上光标的余量】 */
  grantCraftToCursor(id: number, stack: number, prefix?: number): number {
    const def = ITEM_DEFS[id];
    const max = def?.maxStack ?? 999;
    let remaining = stack;
    if (!this.heldStack) {
      const put = Math.min(remaining, max);
      this.heldStack = { id, stack: put, ...(prefix !== undefined ? { prefix } : {}) };
      remaining -= put;
    } else if (canMergeStack(this.heldStack, { id, prefix })) {   // ★SW-AY1 R1 谓词单源（语义同旧式）
      const space = max - this.heldStack.stack;
      const put = Math.min(space, remaining);
      if (put > 0) this.heldStack.stack += put;
      remaining -= put;
    }
    return remaining;
  }
  /** SM2 MouseItem 光晕帧烘焙（getPass('MouseItem') 直连,uColor=OurFavoriteColor/
   *  uSaturation=glow²——ItemSlot :2518-2521 uniform 对齐;量化 5 档省解释器开销） */
  private mouseHaloFrame(img: HTMLImageElement, glow: number): HTMLCanvasElement | null {
    const pass = getPass('MouseItem');
    if (!pass || !img.complete || !img.naturalWidth) return null;
    const q = Math.max(1, Math.round(glow * 5));               // 量化 [1..5]
    const key = `${img.getAttribute('src')?.slice(-40)}|${q}`;
    const hit = this.mouseHaloCache.get(key);
    if (hit === 'pending') return null;
    if (hit) return hit;
    this.mouseHaloCache.set(key, 'pending');
    const w = img.naturalWidth, h = img.naturalHeight;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    if (!octx) return null;
    octx.drawImage(img, 0, 0, w, h);
    const im = octx.getImageData(0, 0, w, h);
    runPassOnImageData(pass, im.data, w, h, {
      ...defaultUniforms(),
      uColor: [255 / 255, 231 / 255, 69 / 255],              // Main.OurFavoriteColor :886
      uSaturation: glow * glow,                              // UseSaturation(num20),num20=glow²(:2504/:2519)
    });
    octx.putImageData(im, 0, 0);
    this.mouseHaloCache.set(key, off);
    return off;
  }

  private installDragListeners() {
    // 右键点击面板外的世界区域：光标持有物丢出（原版 dropItemCheck :5139 右键释放臂;
    // ★SW-BJ92 左键松手不再丢出——resolveDrop 面板外支已改物品留光标）
    document.addEventListener('mousedown', (e) => {
      if (!this.heldStack) return;
      const t = e.target as HTMLElement | null;
      // ★.sw-eqdock 同算面板（2026-09-02 右下角坞无 .sw-panel 底框）
      // ★.sw-itemsearch 同算面板（★SW-BJ81 2026-09-14 道具搜索改非模态浮窗——
      //   旧全屏 overlay 天然挡住本监听,浮窗后漏登记会在面板上误触世界使用/丢出）
      if (t?.closest?.('.sw-slot, .sw-panel, .sw-btn, .sw-eqdock, .sw-vinv, .sw-itemsearch')) return;
      // NPC 商店面板（ItemSlot.Handle context 15 Main.cs:42522-42532 商品格网格）：
      //  ★SW-BJ22 2026-09-07 原版卖出触发面收窄——原版 40 格网格里【空商店格】
      //  才是卖出放置区（PickItemMovementAction case 15 ItemSlot.cs:1435-1438
      //  `inv[slot].type == 0 && checkItem.type > 0 && 非钱币` → result 4 →
      //  LeftClick case 4 :1195-1212 SellItem(mouseItem) 整叠卖出）；格间空白
      //  只置 mouseInterface 不 Handle 任何 slot（Main.cs:42518-42524 精确格
      //  矩形命中）= 无动作。旧实现「点面板任意空白=卖」自创，用户实报存疑。
      //  · 有货格（.sw-shop-item）/按钮 → 各自 click 链（买入/关闭；光标持有时
      //    Game.npcShopBuy 内 CanStack/满叠门裁决，异型整链无动作 :1427-1434）
      //  · 空商店格（.sw-shop-empty）+ 左键 + 持非币物 → npcShopSellHeld 整叠卖
      //    （右键不卖：RightClick → HandleShopSlot rightClickIsValid 支 CanStack
      //    早退 ItemSlot.cs:1878-1881，光标持物点空格右键无动作）
      //  · 其余面板空白（标题/币行/格间距）→ 无动作，光标持有物原样
      //  · NPC 对话/心情浮层也是 UI（mouseInterface），点它不丢世界
      if (t?.closest?.('.sw-npc-shop')) {
        if (t.closest('.sw-shop-item') || t.closest('button')) return;
        if (!t.closest('.sw-shop-empty') || e.button !== 0) return;   // 非空格/非左键=无动作
        if (this.game?.npcShopSellHeld(this.heldStack)) this.heldStack = null;  // :1116 SetDefaults(0)
        this.refreshAll();
        return;
      }
      if (t?.closest?.('.sw-npc-dialog') || t?.closest?.('.sw-happy-panel')) return;
      // ★SW-AZ1 2026-09-06 光标持物镜像槽 58（使用/放置支）：左键点世界不再是丢出——
      // 原版光标持物左键 = 直接使用/放置（PickItemSelectionOverride Player.cs:17526-17548
      // 伪选中 58 + dropItemCheck :5122 inventory[58]=mouseItem.Clone;旧注「点击世界=
      // 抛掷」系误读 mouseItem 臂 :5139——那是【右键】释放臂）。左键事件放行给世界
      // 使用链（Game.updateUse 光标镜像支,照常消耗光标物 stack）;右键保持丢出（原版
      // 丢出臂,DropSelectedItem(58) :5154）
      if (e.button === 0) return;
      this.throwHeldToWorld();
      // ★SW-RB4a 2026-09-06：丢出臂吞掉本次按压（vanilla dropItemCheck :5141-5144
      //  `releaseUseTile = false; Main.mouseRightRelease = false`——丢出后同一次右按
      //  不再触世界交互）。曾不吞=右键丢出瞬间 heldStack 清空 → cursorHeld 门失位,
      //  同一按压漏进世界右键交互链（开箱/开门/NPC 对话误触发）
      if (this.game?.input) this.game.input.rightDown = false;
      this.refreshAll();
    });
    document.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      this.moveGhost();
      // ★BJ669e2：光标锚 tooltip 跟随臂——原版 MouseText 即时模式每帧以当帧光标
      //  重定位（Main.cs:20378）。enter 拍的滞后坐标（边界事件先于同批 mousemove
      //  派发）由紧随其后的本臂同批纠正,快速跨槽不再钉旧位换内容。元素锚路径
      //  （重铸/buff/触屏长按）tooltipFollowsCursor=false 不跟随
      if (this.tooltipFollowsCursor && this.tooltip.style.display === 'block' && this.tooltipCursorSize) {
        // ★清偿A-F5（2026-10-14 定谳落刀）：悬停宿主被 DOM 移除（refreshAll 重建
        //  合成行/搜索行族等）后 Chrome 不派发 mouseleave（节点移除≠边界事件）→
        //  跟随臂携陈旧气泡永久漂移。宿主游离即隐藏+清跟随态（探针 v5 F5 部分:
        //  remove 宿主后一拍 move → display none）。WeakRef 经 globalThis 查找
        //  （lib ES2020 无 WeakRef 类型;bindHint.ts 同款纪律——不挽留宿主元素）
        const host = this.tooltipCursorHostRef?.deref();
        if (host && !host.isConnected) {
          this.hideCursorTooltip();
        } else {
          const { left, top } = this.cursorTooltipPos(this.tooltipCursorSize.tw, this.tooltipCursorSize.th);
          this.tooltip.style.left = `${left}px`;
          this.tooltip.style.top = `${top}px`;
        }
      }
      // 未持有物品时按下并移动 >4px → 整叠拾取开始拖拽
      if (this.dragFrom && !this.heldStack) {
        const d = Math.hypot(e.clientX - this.dragFrom.sx, e.clientY - this.dragFrom.sy);
        if (d > 4) {
          this.pickUp(this.dragFrom.i, this.dragFrom.where);
          // ★SW-BJ92（2026-09-15 用户实报「开包态光标持物点世界不能放置」）补武世界
          //  左键电平：原版拾取发生在 ItemSlot.Handle 的 mouseLeft【下帧】（ItemSlot.cs
          //  :906 LeftClick case-0），此后 Main.mouseLeft 电平在光标离开 UI（mouseInterface
          //  复位）即驱动 controlUseItem → 使用/放置链——「按住槽位拖到世界」= 连续
          //  铺放（拖到哪放到哪,松手物品留在光标）。本仓槽位 mousedown 有
          //  stopPropagation（Input.mouseDown 从未置位）→ updateUse 重入总闸
          //  `!inp.mouseDown && !holdOk`（Game.ts :12956 区）整拖拽期早退 = 拖拽全程
          //  零放置,松手又被 resolveDrop 面板外臂丢出（同日拆除）=「取物拖到世界:
          //  不放还丢」。修 = 拾取沿补武 mouseDown/mouseHeld（MobileControls 触摸合成
          //  :599 同款先例）；面板悬停期由 inpOverDomUi 门（mouseInterface 等价面）
          //  压制不误触,松键由 Input.mouseup 复位——与原版电平生命周期同相。
          //  ★仅拾取成沿才武（pickUp 空槽/异型拒收时 heldStack 未置,补武会让选中
          //  热键物在松手沿误发一击）。
          if (this.heldStack) {
            const inp = this.game?.input;
            if (inp) { inp.mouseDown = true; inp.mouseHeld = true; }
          }
        }
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (!this.dragFrom) return;
      const from = this.dragFrom;
      this.dragFrom = null;
      if (e.button !== 0) return;
      if (this.heldStack) {
        this.resolveDrop(from);
      } else {
        // 无拖动的普通点击：快捷栏（面板关）选中；否则拾取到光标（点击移动仍可用）
        const panelOpen = this.invPanel && this.invPanel.style.display === 'block';
        // ★SW-FX10 债⑪：热键锁门（Main.cs:44357 `mouseLeft && !player.hbLocked` →
        //  changeItem 臂）——锁定+关包时快捷栏格左键不换选中也不拾取（整格无动作，
        //  点击本体已透传世界输入;1-0 数字键照常）
        if (from.where === 'inv' && from.i < 10 && !panelOpen) {
          if (this.game.player.hbLocked) return;
          this.game.player.inv.selected = from.i;
          this.refreshHotbar();
        } else {
          this.pickUp(from.i, from.where);
          // ★清偿A-F6（2026-10-14 定谳落刀）：原地左键拾取（无位移,本 mouseup 支
          //  pickUp 路径）成功后槽已空,而原地点击不产生任何边界事件——旧内容气泡
          //  残留且跟随臂携之漂移。原版=悬停空槽零 tooltip（ItemSlot.MouseHover
          //  Terraria.UI/ItemSlot.cs:3174/:3179 item.IsAir 不置 hoverItemName →
          //  MouseTextInner :20397 纯文本支零绘制）→ 隐藏=空槽悬停同相。门
          //  tooltipFollowsCursor=只管光标支（元素锚气泡:重铸/buff/触屏长按不属
          //  本槽悬停链,不动）。（探针 v5 F6 部分:原地 down/up → display none）
          if (this.heldStack && this.tooltipFollowsCursor
            && this.tooltip.style.display === 'block') {
            this.hideCursorTooltip();
          }
        }
      }
      this.refreshAll();
    });
  }

  /** 整叠拾取到光标 */
  private pickUp(i: number, where: SlotWhere) {
    const cur = this.slotContent(where, i);
    if (!cur) return;
    if (this.heldStack && this.heldStack.id !== cur.id) return;
    if (where === 'inv') this.game.player.inv.slots[i] = null;
    else if (where === 'armor') this.game.player.inv.armor[i] = null;
    else if (where === 'dye') this.game.player.inv.dye[i] = null;
    else if (where === 'misc') this.game.player.inv.miscEquips[i] = null;
    else if (where === 'miscDye') this.game.player.inv.miscDyes[i] = null;
    else if (this.openChest) this.openChest.items[i] = null;
    // ★SW-AU2 2026-09-06 收藏标记保留域 = retainFavoriteOnMoveAt（ItemSlot.cs:362-366，
    // 背包族 0/1/2 + 虚空袋 32 + 重铸 5）：MouseItemSwap :1227-1235 语境不在表内则
    // 双端清 favorited——箱/装备/染料/杂项面取出即清（装备面清标记=共享状态终结，
    // GetEffectiveArmor 只认收藏件 :240-251）。
    // ★SW-AY1 R7：语境按容器来源取全（世界箱 3/银行 4=清、虚空保险库 32=保）——
    // 旧实现 chest 面一律按 3 清（登记债已销）；关包快捷栏语境 13 原版不在表内
    // （面板关拖拽取件同清）
    const panelOpenNow = !!this.invPanel && this.invPanel.style.display === 'block';
    const ctxNow = where === 'chest'
      ? chestContainerContext(this.openChest?.x)
      : slotContext(where, i, panelOpenNow);
    const retainFav = RETAIN_FAVORITE_ON_MOVE_AT.includes(ctxNow);
    if (this.heldStack) {
      // ★SW-RB1 2026-09-06 并入光标面同走 MouseItemSwap 双端清（ItemSlot.cs:1227-1235）：
      // 语境不在 retainFavoriteOnMoveAt（箱 3/装备 8-12/杂项 16-20/33）时,光标端收藏
      // 一并清——曾只清槽端,箱料并进收藏光标堆后收藏标记越箱存活（提示行/防丢域泄漏）
      if (!retainFav) this.heldStack.favorited = false;
      this.heldStack.stack += cur.stack;
    }
    else { this.heldStack = { id: cur.id, stack: cur.stack, prefix: cur.prefix, favorited: retainFav ? cur.favorited : false, ...(cur.placeStyle !== undefined ? { placeStyle: cur.placeStyle } : {}) }; this.heldFrom = where; } // 保留词缀+实例样式+收藏态（★批III②；收藏域见上 SW-AU2/R7 注）
    // 拿取/合并音（ItemSlot.cs:987-989：转移后光标或格子有物 → SoundID 7 Grab）
    this.game.sfx.play('pickup', 1);
    this.refreshAll();
  }

  /** 右键开包（ItemSlot.TryOpenContainer,1457 终值 :1764-1782 + TryOpenContainer_GrantItems
   *  :1784-1843 + Player.Open* 1:1;1456 旧注 :1642-1660）：
   *  掷骰 → 产出入包（装不下落地 = GetOrDropItem :6813-6826 noGrabDelay 语义）→
   *  stack-- → SoundEngine.PlaySound(7)（Sfx 'pickup' = Grab.wav）。★SW-FX21
   *  （2026-09-10）BossBag 族经 openBagItem 首支路由 openBossBag（ItemSlot.cs:1786-1789
   *  原版唯一调用面）——★§五裁决(09-13)Game 持用左键链已摘,右键为唯一入口。
   *  锁盒钥匙门（:1794-1829 1457 行号）：金锁盒 3085 消耗金钥匙 327（Player.ConsumeItem
   *  :8846 槽序 0→57，含虚空袋兜底）；黑曜石锁盒 4879 只验暗影钥匙 329 不消耗
   *  （HasItemInInventoryOrOpenVoidBag :56575——持虚空透镜 4131 才查 bank4）。
   *  BossBag 上下文：masterMode=Main.masterMode（:7208）/crimson/extraAccessory/
   *  tenthAnniversary;hasItemInventory=Player.HasItem（:56551 仅背包,moonlord 袋
   *  3384 条件 :7748）,与锁盒的虚空袋版 hasItem 分流。
   *  原版互斥门 itemAnimation>0 拒右键（RightClick :1621-1624）由 UI/世界两域
   *  分离吸收（UI 开启时世界使用链不消费同一击）——架构性近似,登记注释。 */
  private tryOpenContainer(cur: { id: number; stack: number }, i: number): void {
    const game = this.game;
    const inv = game.player.inv;
    const vid = (ITEM_DEFS[cur.id]?.vid ?? -1);
    const px = game.player.cx, py = game.player.cy;
    // 虚空袋可达门（Player.useVoidBag :22892-22901 = 背包含 4131）
    const voidLensIid = invIndexOfVanilla(4131);
    const useVoidBag = voidLensIid >= 0 && inv.countOf(voidLensIid) > 0;
    const bank4Has = (vidX: number): boolean => {
      const iid = invIndexOfVanilla(vidX);
      return iid >= 0 && game.player.banks[3].some((s) => s && s.id === iid && s.stack > 0);
    };
    const opened = openBagItem(vid, (id, n) => {
      const key = VANILLA_ITEM_KEY_BY_ID[id];
      if (!key) return;                       // vanilla.json 缺条目防御（bagItemIdRegistered 可查）
      const iid = ITEM_BY_KEY[key];
      if (iid === undefined) return;
      // ★BJ394（2026-09-28）QuickSpawnItem 族词缀掷（Player.cs:7174-7184 int 重载恒
      //  `Prefix(-1)` :7180——SetDefaults 后、stack 前掷,自然掷全链含 TryGet 四门;
      //  不可词缀物 pool null → 0 同相）。OpenPresent :7035/OpenLegacyPresent :7156/
      //  OpenBossBag :7206(151 掷)/OpenFishingCrate :8052/OpenShadowLockbox :9396/
      //  OpenLockBox :9416/OpenHerbBag :9453/OpenCanofWorms :9529/OpenOyster :9543/
      //  OpenChilletEgg :9577/OpenGoodieBag+CostumeSet :9588/:9564 全族 int 重载=本
      //  give 单口覆盖;掷位随 give 调用序=原版 QuickSpawnItem 在支内逐件的掷序同相。
      //  渔夫奖励 GetAnglerReward* 走 Item 重载（:57112 GiftRecieved,不掷）→
      //  grantAnglerRewards 无词缀=原版同相;钓鱼捕获 Projectile.cs:54904 同 Item
      //  重载不掷（PullBobber GiveItemToPlayer :73234 同）=两域照旧零刀
      const prefix = rollNaturalPrefixForVid(id, isPrefixableAccessory(iid), Math.random) || undefined;
      const left = inv.add(iid, n ?? 1, prefix);
      if (left > 0) game.spawnDrop(px, py, key, left, undefined, undefined, undefined, prefix); // 溢出落地（GetOrDropItem 尾 RequestNewItem(base.Center) :7202 velocity=null→随机,BJ326）
    }, {
      hardMode: !!game.world.flags.hardMode,   // OpenPresent :6654 硬模式门读档
      remixWorld: !!game.world.seedFlags?.remix,
      getGoodWorld: !!game.world.seedFlags?.getGoodWorld,
      skyblockLowTiles: !!game.world.seedFlags?.skyblock,   // WorldGen.Skyblock.lowTiles（空岛匣 2197 支）
      // ★SW-FX21 BossBag 上下文（Player.OpenBossBag :7206-7901 唯一入口;§五裁决 09-13 持用链已摘）
      masterMode: mainMasterMode(game.world),             // Main.masterMode（:7208）
      crimson: !!game.world.crimson,                      // WorldGen.crimson（:7255/:7260 矿种臂）
      extraAccessory: !!game.player.inv.extraAccessory,   // 饰品第六格（noExtra 条件臂）
      tenthAnniversary: !!game.world.seedFlags?.tenthAnniversary,  // TryGettingDevArmor 1/8（:7526）
      // 金钥匙消耗：先背包槽序 0→57（Inventory.remove 同序），后虚空袋 bank4
      consumeItem: (vidX) => {
        const iid = invIndexOfVanilla(vidX);
        if (iid >= 0 && inv.remove(iid, 1)) return true;
        if (useVoidBag && iid >= 0) {
          const s = game.player.banks[3].find((b) => b && b.id === iid && b.stack > 0);
          if (s) { s.stack--; if (s.stack <= 0) game.player.banks[3][game.player.banks[3].indexOf(s)] = null; return true; }
        }
        return false;
      },
      hasItem: (vidX) => {
        const iid = invIndexOfVanilla(vidX);
        return iid >= 0 && (inv.countOf(iid) > 0 || (useVoidBag && bank4Has(vidX)));
      },
      // Player.HasItem :56551 仅查背包 0-57（moonlord 袋 3384 传送门枪条件 :7748）
      hasItemInventory: (vidX) => {
        const iid = invIndexOfVanilla(vidX);
        return iid >= 0 && inv.countOf(iid) > 0;
      },
    });
    if (opened) {
      inv.removeAt(i, 1);                      // item.stack--（:1651-1655，归零由 Inventory 处理）
      game.sfx.play('pickup', 1);              // PlaySound(7) = Grab（:1656）
      game.cb.onInventoryChanged?.();          // 掉落物拾取链同款 UI 刷新
      this.refreshAll();
    }
  }

  /** 装备类数组快捷取用（armor/dye/misc/miscDye 四类） */
  private equipArray(where: SlotWhere): Array<{ id: number; stack: number; favorited?: boolean; prefix?: number } | null> {
    const inv = this.game.player.inv;
    if (where === 'armor') return inv.armor;
    if (where === 'dye') return inv.dye;
    if (where === 'misc') return inv.miscEquips;
    return inv.miscDyes;
  }

  /** ★清偿刀 X（2026-09-29）拖放面互斥组门（债②收口——armorAccepts 组臂盲区在调用
   *  侧合成;armorAccepts 本体在 Inventory.ts〔清偿刀 P 终态禁碰〕）。原版拖放门链
   *  PickItemMovementAction case 8-11（ItemSlot.cs:1496-1503）→ CanEquipInArmorSlot
   *  （:1399-1458）配饰支双段扫均含互斥组臂：同段 CanEquipAccessoryInSlot→
   *  HasIncompatibleAccessory（:3472-3482,冲突槽=目标槽放行 :3544——拖放=顶掉被换件
   *  语义）+ 对段 HasSameItemInSlot（:3505-3520,组员跨段同拘——6168 功能段时 6169
   *  拖不进社交段,反之亦然）。armorAccepts 已接部位/同款/双翅/对段同款臂,组臂盲区
   *  此处补——accGroupClash 单源复用（同款/双翅臂与 armorAccepts 重叠=同判,组臂为
   *  真增量）。盔甲部位槽（0-2/10-12）组值恒 −1 直通 armorAccepts。
   *  ★清偿刀 Z（2026-09-29）：armorAccepts 本体组臂已落（Inventory.ts）——本门双段
   *  组扫转为与本体【同判重叠】（幂等冗余,保留=门序原文形态不动;组臂真值面收归
   *  vanillaEquip.accGroupClash 单源）。
   *  ★反向校验（placeHeld 交换臂 :2715 取出件回查）【不】换组门：原版无取出回查
   *  （本仓防御性保留=只收不严）,组臂若入回查会把前门时代落盘的既有组员状态钉死
   *  无法换出——取出恒合法语义不变。 */
  private armorAcceptsDrag(i: number, id: number): boolean {
    const inv = this.game.player.inv;
    if (!inv.armorAccepts(i, id)) return false;
    if (i % VANITY_ARMOR_START < ACC_ARMOR_START) return true;   // 部位槽无组面（:3505 组值 −1）
    const segLen = ARMOR_SLOTS - ACC_ARMOR_START;
    const segBase = i < VANITY_ARMOR_START ? ACC_ARMOR_START : VANITY_ARMOR_START + ACC_ARMOR_START;
    for (let k = segBase; k < segBase + segLen; k++) {
      if (k === i) continue;                                     // 冲突槽=目标槽放行（:3544）
      const t = inv.armor[k];
      if (t && accGroupClash(t.id, id)) return false;
    }
    const oppBase = i < VANITY_ARMOR_START ? VANITY_ARMOR_START + ACC_ARMOR_START : ACC_ARMOR_START;
    for (let k = oppBase; k < oppBase + segLen; k++) {           // 对段全扫（HasSameItemInSlot 无自槽例外）
      const t = inv.armor[k];
      if (t && accGroupClash(t.id, id)) return false;
    }
    return true;
  }

  /** 放下到背包/宝箱格（合并→交换，装备位校验） */
  private placeHeld(i: number, where: SlotWhere): void {
    if (!this.heldStack) return;
    // 露西斧存取台词（ItemSlot_OnItemTransferred :75-99：CountsAsStorage(箱柜)
    // 状态翻转才说话——存入 Storage / 取回 PickedUp，420t 冷却）
    if ((ITEM_DEFS[this.heldStack.id]?.vid ?? -1) === 5095
      && (this.heldFrom === 'chest') !== (where === 'chest')) {
      if (where === 'chest') this.game.lucyTransferToStorage();
      else this.game.lucyTransferFromStorage();
    }
    if (where === 'armor' || where === 'dye' || where === 'misc' || where === 'miscDye') {
      const inv = this.game.player.inv;
      const arr = this.equipArray(where);
      // ★清偿刀 P：锁槽放置/交换拒（Main.cs:42114/42185/42218 Handle condition=
      // 解锁∨光标空;GetDimSlotForMouseItem :1348/:1357 同判——持物对锁槽一律无
      // 动作,取出走拾取路径不受限。大师无恶魔心态 armor[8]/dye[8] 锁）
      if ((where === 'armor' || where === 'dye') && !inv.isItemSlotUnlockedAndUsable(i)) return;
      // 部位/配饰/染料/杂项分类校验（ItemSlot.PickItemMovementAction 同源判定）
      // ★清偿刀 X：armor 面 +互斥组臂（armorAcceptsDrag=armorAccepts∧组扫,:1496-1503 链）
      if (where === 'armor' && !this.armorAcceptsDrag(i, this.heldStack.id)) return;
      if (where === 'dye' && !inv.dyeAccepts(this.heldStack.id)) return;
      if (where === 'misc' && !inv.miscAccepts(i, this.heldStack.id)) return;
      if (where === 'miscDye' && !inv.dyeAccepts(this.heldStack.id)) return;
      const cur = arr[i];
      // 装备族槽单件语义（ItemSlot.LeftClick case1/2 :1004-1058）：装备/时装/染料/
      // 杂项槽恒容 1 件——空槽多叠只放 1 件余量留光标（Clone+stack--）；占用槽仅
      // 光标单件且异型可交换（IsNotTheSameAs 门）；同型叠入/多叠交换均无动作。
      // 此前整叠入槽+同型合并 = 99 翅膀全上身（2026-08-24 用户截图实报）
      if (!cur) {
        if (this.heldStack.stack === 1) {
          arr[i] = { ...this.heldStack, favorited: false };   // ★SW-AU2：装备/染料/杂项语境（8-12/16-20/33）不保留收藏（:362-366）
          this.heldStack = null;
        } else {
          arr[i] = { ...this.heldStack, stack: 1, favorited: false };
          this.heldStack.stack--;
        }
        // 空装备槽放置音（原版 case1/2 MouseItemSwap 后 SoundID 7 :1018）
        this.game.sfx.play('pickup', 1);
      } else if (this.heldStack.stack === 1 && cur.id !== this.heldStack.id) {
        // 交换前反向校验（取出的物品总是合法的，防御性保留）
        if (where === 'armor' && !inv.armorAccepts(i, cur.id)) return;
        arr[i] = { ...this.heldStack, favorited: false };
        this.heldStack = { ...cur, favorited: false };   // ★SW-AU2：MouseItemSwap 双端清（:1230-1234）——装备面取出到光标同清
        // R4-39（AfterItemSwap,IS57:1975-1985）：装备/杂项槽交换后播音——新入槽件
        // ∈换型表（含 1457 新 6168/6169/6193/6194）→ SoundID 22(Unlock),否则 7(Grab)
        const nv = (ITEM_DEFS[this.heldStack.id]?.vid ?? -1);
        this.game.sfx.play(nv > 0 && AFTER_ITEM_SWAP.has(nv) ? 'unlock' : 'pickup', 1);
      } else {
        return; // 同型叠入 / 光标多叠对占用槽：原版无动作
      }
      this.refreshAll();
      // 成就：装备态检查（拖拽落装备位 = HandleOnEquip 同义路径）
      this.game.achNotifyEquipChanged();
      return;
    }
    if (where === 'inv') {
      const inv = this.game.player.inv;
      if (!inv.canAccept(i, this.heldStack.id)) return; // 装备位校验失败：弹回原处
      const cur = inv.slots[i];
      // 成就：光标物落主背包格（ItemSlot case 0 :932 NotifyItemPickup：MouseItemSwap/
      // 并入后 `inv[slot].stack > 0 && context == 0` 才发——落背包才发,case-0 语义）
      let landedVid = -1;
      if (!cur) {
        inv.slots[i] = this.heldStack;
        landedVid = vidOf(this.heldStack.id);
        this.heldStack = null;
      } else if (canMergeStack(cur, this.heldStack)) {   // ★SW-AY1 R1：合并门=CanStack 词缀面
        const max = ITEM_DEFS[cur.id].maxStack;
        const put = Math.min(max - cur.stack, this.heldStack.stack);
        cur.stack += put;
        this.heldStack.stack -= put;
        if (put > 0) landedVid = vidOf(cur.id);
        if (this.heldStack.stack <= 0) this.heldStack = null;
      } else if (inv.canAccept(i, cur.id) === false) {
        return; // 占位物品放不回普通格（理论不发生，防御）
      } else {
        inv.slots[i] = this.heldStack;
        landedVid = vidOf(this.heldStack.id);   // 交换=被放入格者即"拾取"件
        this.heldStack = cur;
      }
      if (landedVid > 0) this.game.achievements.notifyItemPickup(landedVid);
      // 放置/合并/交换音（ItemSlot.cs:987-989 → SoundID 7 Grab）
      this.game.sfx.play('pickup', 1);
    } else {
      const chest = this.openChest;
      if (!chest) return;
      // ★SW-AY1 R7：容器语境按来源取（世界箱 3/银行 4 不保留收藏；虚空保险库
      //  32 ∈ retainFavoriteOnMoveAt（ItemSlot.cs:365）→ 放入/交换双向保留收藏）
      const chestCtx = chestContainerContext(chest.x);
      const keepFav = chestCtx === 32;
      // ★SW-AY1 R8 IsBlockedFromTransferIntoChest（ChestUI.cs:1287-1298）拖放面：
      //  PickItemMovementAction case 4/32（:1483-1492）对收藏钱袋(3213)→存钱罐、
      //  收藏虚空袋(4131/5325)→虚空保险库 拒发移动动作（result=-1 无操作）。
      //  世界箱（context 3）无此门（case 3 直通 :1480-1482）——按容器身份判
      if (this.heldStack.favorited) {
        const hv = (ITEM_DEFS[this.heldStack.id]?.vid ?? -1);
        // ★SW-BJ1：判别式抽 blockedFromTransferIntoChest 单源（拖放臂/tooltip 行共用）
        if (blockedFromTransferIntoChest(chest.x, hv)) return;
      }
      // ★SW-AU2 2026-09-06 箱语境（3/4）不保留收藏（retainFavoriteOnMoveAt
      //  ItemSlot.cs:362-366 → MouseItemSwap :1230-1234 双端清）——放入箱与箱中
      //  取出到光标的双向面同清
      const cur = chest.items[i];
      if (!cur) {
        chest.items[i] = { ...this.heldStack, favorited: keepFav ? !!this.heldStack.favorited : false };
        this.heldStack = null;
      } else if (canMergeStack(cur, this.heldStack)) {   // ★SW-AY1 R1：合并门=CanStack 词缀面
        const max = ITEM_DEFS[cur.id].maxStack;
        const put = Math.min(max - cur.stack, this.heldStack.stack);
        cur.stack += put;
        this.heldStack.stack -= put;
        if (this.heldStack.stack <= 0) this.heldStack = null;
      } else {
        chest.items[i] = { ...this.heldStack, favorited: keepFav ? !!this.heldStack.favorited : false };
        this.heldStack = { ...cur, favorited: keepFav ? !!cur.favorited : false };
      }
      // 箱格放置/合并/交换音（同 :987-989 → SoundID 7）
      this.game.sfx.play('pickup', 1);
    }
  }

  /** 拖拽松手：判定落点（格子/垃圾桶/面板外丢弃/面板空白放回） */
  private resolveDrop(from: { i: number; where: SlotWhere }) {
    const target = document.elementFromPoint(this.mouseX, this.mouseY) as HTMLElement | null;
    const slotEl = target?.closest?.('.sw-slot') as HTMLElement | null;
    if (slotEl?.dataset.idx !== undefined && slotEl?.dataset.where) {
      const ti = Number(slotEl.dataset.idx);
      const tw = slotEl.dataset.where as SlotWhere;
      if (tw === 'chest' && !this.openChest) return;
      this.placeHeld(ti, tw);
      return;
    }
    if (target?.closest?.('.sw-trash')) {
      this.placeTrash();
      return;
    }
    // 面板外：★SW-BJ92 物品留在光标（原版同相）；面板内空白：放回原格。★右下角坞
    // 同算面板内（2026-09-02 无框坞在 .sw-panel 之外——漏登记会把拖到坞标签/缝隙
    // 的物品当世界抛掷）
    // ★.sw-itemsearch 同算面板内（★SW-BJ81 2026-09-14：拖经道具搜索浮窗松手
    //   =放回原格,不当世界抛掷——浮窗为背包子面板,与合成窗同域）
    // ★SW-BJ92（2026-09-15 用户实报「开包态光标持物点世界不能放置」）：旧「面板外
    //   松手=丢进世界」系把原版【右键】丢出臂误接到左键松手——vanilla 丢出唯一触发
    //   = dropItemCheck Player.cs:5139 `mouseRight&&!mouseInterface&&mouseRightRelease`
    //   （:5141-5144 消费 mouseRightRelease）,左键松手无任何丢出臂（DropSelectedItem
    //   :5154 只在右键臂内）。且本丢出臂与拾取拖放互斥：按住槽位拖到世界的全程
    //   （本仓拾取沿 = dragFrom 移动 >4px,见 installDragListeners 电平补武注）在
    //   resolveDrop 前根本没有放置面,松手即把整叠丢出 = 用户观感「取物拖到世界:
    //   不放还丢」。修 = 面板外松手 no-op（物品保持持物态,继续点击世界=放置）；
    //   丢出意图走右键臂/垃圾桶（均原版面）。
    const inPanel = target?.closest?.('.sw-panel, .sw-eqdock, .sw-vinv, .sw-itemsearch');
    if (inPanel) {
      this.placeHeld(from.i, from.where);
    }
    // 面板外 = no-op：物品留在光标（★SW-BJ92,见上注）
  }

  /** 垃圾桶：丢弃暂存（关闭背包时结算删除） */
  private trashHeld() {
    this.placeTrash();
  }

  /** 拖出面板：以掉落物形式丢在角色面前。速度 = 原版 DropSelectedItem
   *  （Player.cs:4993-4997）：vy=-2、vx=4×朝向+玩家自身水平速度（跑步/坠落
   *  叠加——此前 facing×1.5 不叠速度,抛出距离约为原版 1/3）；noGrabDelay=100
   *  （:4990/:4996 抛出者 100t 内拾不回） */
  private throwHeldToWorld() {
    if (!this.heldStack || !this.game) return;
    const p = this.game.player;
    const heldDef = ITEM_DEFS[this.heldStack.id];
    const key = heldDef.key;
    // 丢弃露西 → ThrownAway 台词（Player.cs:4984-4986）——vid 直读
    //（★方案 A 阶段 5/BJ266:vanillaIdOfItemKey 键前缀反解退役,internal≡vid 恒等域）
    if ((heldDef.vid ?? -1) === 5095) this.game.lucyThrownAway();
    const drop = this.game.spawnDrop(p.cx + p.facing * 18, p.y + 6, key, this.heldStack.stack,
      p.facing * 4 + p.vx, -2, undefined, this.heldStack.prefix);   // ★BJ390：词缀随件（DropSelectedItem Player.cs:5191 theItemWeDrop.prefix 同域）
    if (drop) drop.noGrabDelay = 100;
    this.heldStack = null;
    this.heldFrom = null;
  }

  /** 光标持有物的 ghost 跟随 */
  private moveGhost() {
    if (!this.heldStack) {
      if (this.ghostEl) { this.ghostEl.remove(); this.ghostEl = null; }
      return;
    }
    if (!this.ghostEl) {
      this.ghostEl = el('div', 'sw-drag-ghost');
      const img = el('img') as HTMLImageElement;
      img.src = iconUrl(this.game, this.heldStack.id);
      img.draggable = false;
      this.ghostEl.appendChild(img);
      document.body.appendChild(this.ghostEl);
    }
    // ★批III② 收藏态金边（Inventory_Back10 同 slot paintSlot 档——ItemSlot :1966-1985）
    const favFrame = 'url(sprites/vanilla/Inventory_Back10.png)';
    if (this.heldStack.favorited) {
      if (!this.ghostEl.dataset.fav) {
        this.ghostEl.dataset.fav = '1';
        this.ghostEl.style.backgroundImage = favFrame;
        this.ghostEl.style.backgroundSize = '100% 100%';
      }
    } else if (this.ghostEl.dataset.fav) {
      delete this.ghostEl.dataset.fav;
      this.ghostEl.style.backgroundImage = '';
    }
    const img = this.ghostEl.querySelector('img') as HTMLImageElement;
    const url = iconUrl(this.game, this.heldStack.id);
    // ★getAttribute 比较(2026-08-17 trace 定位):img.src 属性返回绝对化 URL,
    // dataURL 场景恒不等 → 每次 mousemove 重设 src = 同图反复重新光栅化
    // (trace 实锤:同一 pixelRef id 被画 1573 次,270/s 持续流)
    if (img.getAttribute('src') !== url) img.src = url;
    let cnt = this.ghostEl.querySelector('.cnt') as HTMLElement | null;
    if (this.heldStack.stack > 1) {
      if (!cnt) { cnt = el('span', 'cnt'); this.ghostEl.appendChild(cnt); }
      cnt.textContent = String(this.heldStack.stack);
    } else cnt?.remove();
    // ★批III② MouseItem SM2 辉光（ItemSlot :2500-2526）：num20=glow²、放大倍率
    //   num21=Remap(num20,1→0,1→2)=1+num20、uColor=OurFavoriteColor——光晕帧垫在
    //   本体图下 lighter 叠加（原版 Immediate pass 第二次 Draw 在本体之上,
    //   加算观感等价,层级登记）
    const nowMs = performance.now();
    const glowLeft = this.cursorGlowUntil - nowMs;
    let halo = this.ghostEl.querySelector<HTMLCanvasElement>('.halo');
    if (glowLeft > 0 && this.heldStack.id === this.cursorGlowId) {
      const glow = Math.max(0, Math.min(1, glowLeft / UI.CURSOR_GLOW_MS));
      const baked = img.complete && img.naturalWidth ? this.mouseHaloFrame(img, glow) : null;
      if (baked) {
        if (!halo) {
          halo = document.createElement('canvas');
          halo.className = 'halo';
          halo.style.cssText = 'position:absolute;left:0;top:0;width:40px;height:40px;'
            + 'image-rendering:pixelated;mix-blend-mode:lighter;pointer-events:none;';
          this.ghostEl.insertBefore(halo, this.ghostEl.firstChild);
        }
        const num20 = glow * glow;
        const scaleMul = 1 + num20;                            // Remap(num20,1,0,1,2) :2513
        const px = Math.round(40 * scaleMul);
        halo.width = baked.width; halo.height = baked.height;
        const hctx = halo.getContext('2d');
        hctx?.drawImage(baked, 0, 0);
        halo.style.width = `${px}px`;
        halo.style.height = `${px}px`;
        halo.style.left = `${(40 - px) / 2}px`;
        halo.style.top = `${(40 - px) / 2}px`;
        halo.style.display = '';
      } else halo && (halo.style.display = 'none');
    } else if (halo) halo.remove();
    this.ghostEl.style.transform = `translate(${this.mouseX - 20}px, ${this.mouseY - 20}px)`;
  }

  /** 稀有度着色（Main.cs MouseText_DrawItemTooltip_GetItemNameColor :20742-20814）。
   *  ★SW-清债④ 2026-09-17 −13/−12 两档接活色 → ★SW-BJ116-b（2026-09-18,债刀-2）
   *  整表单源委托 Renderer.mouseTextInnerColor（能单源委托则委托判例）——mt 传 255
   *  → num3=1 = GetItemNameColor 无 mouseTextColor 乘区的原生语义；钟=Game.lighting
   *  .clock（与 Renderer.drawMouseTextLayer :15431 同源注入；同源钟
   *  FlickerClock.masterColor 0..1 步进 0.05 ping-pong :18408-18418 / disco 6 相循环）。
   *  四漂移档定谳（GetItemNameColor 亲读逐档核;1458 同位同文对拍零差）：
   *  · −11（:20753-20755）= (255,175,0)——旧 '#828282' 误并 −1 灰档（−1=:20757-20759
   *    (130,130,130),委托后两档各归各档）;
   *  · 9（:20793-20795）= (5,200,255)——旧 '#0AFFFF' 自创;
   *  · 10（:20797-20799）= (255,40,100)——旧 '#FFAA66' 自创;
   *  · ≥11（:20801-20803）= (180,40,255)——旧 '#B42CFF' 漂移。
   *  −10 档=GetItemNameColor 无分支（缺省 White）,mouseTextInnerColor 有
   *  (:20439-20441 (65,255,110))——1457 全源 `rare = -10` 计 0 处=死档,两读不可达,
   *  委托无偏差。diff 档（:20805-20812 mc/hcColor）=MouseTextHackZoom 显式传参域
   *  （地图钉/物品框等非 tooltip 面）,本仓未建模=缺省 diff 0 同相。 */
  private rarityColor(rare: number): string {
    return mouseTextInnerColor(rare, 0, 255, this.game?.lighting?.clock ?? null);
  }

  /** ★SW-BJ116-b（2026-09-18,债刀-3）Tooltip 名色稀有度判定链单源。消费面 =
   *  MouseText_DrawItemTooltip :20509-20515 `rare = hoverItem.rare`（直读字段——
   *  字段值已含 SetDefaults 基表/变体与 Prefix() 档位移两域合成;1458 同位同文）。
   *  链序（=showTooltipFor 旧内联序,showReforgeTooltip 曾缺③词缀档位移=本刀主债）：
   *  ① 基表值：vi_ 物品查 vanilla-itemrare.json（tools/extract-itemrare.mjs 从
   *    Item.cs case 块提取 1643 条）;缺条目 value 分档近似
   *  ② 变体覆写（Item.cs SetDefaults Variant 分支：remix 世界 112→6/157→8/725→1
   *    等 10 件;普通世界无覆写）
   *  ③ 词缀档位移（Item.Prefix :588-614：num2≥1.2 →+2 / ≥1.05 →+1 / ≤0.8 →−2 /
   *    ≤0.95 →−1,reforge 时已烘入 Item.rare;:604-614 rare>-11 段 clamp [−1,11]——
   *    −11 quest 鱼不可词缀=钳段不可达,本仓 −1 下限/11 上限同相）
   *  ④ expert 旗末位覆写 → −12（Main.cs:20512-20515;Item.cs SetDefaults 全表零处
   *    `rare = -12`,专家件表值 1..10 如 3090 rare=2 :28598-28600;旗与稀有度正交
   *    3332 主袋 rare=8 仍覆写;旗源=vanilla-expert.json,vanilla-itemrare 全表无 −12;
   *    ★SW-N4:opts.forPopup=PopupText 飘字链跳过本步——覆写是 MouseText 绘制期
   *    行为,飘字链 PrepareEffects PopupText.cs:388-404 读 Item.rare 字段值,expert
   *    走 somePopup.expert 旗不改色,见方法尾注） */
  private tooltipRareOf(def: { key: string; value?: number; rare?: number }, prefix?: number, opts?: { forPopup?: boolean }): number {
    let rare = 0;
    const isVi = def.key.startsWith('vi_');
    const vid = isVi ? parseInt(def.key.slice(3), 10) : -1;
    if (isVi) {
      rare = ITEM_RARE[String(vid)] ?? 0;
      if (rare === 0) {
        const v = def.value ?? 0;
        rare = v >= 100000 ? 4 : v >= 10000 ? 3 : v >= 1000 ? 2 : v >= 100 ? 1 : 0;
      }
      rare = variantRareOfVid(vid) ?? rare;
    } else if (def.rare !== undefined) {
      // ★刀3-1(2026-10-13):mod 物品 def.rare 直读(旧实现漏读=mod 物品 tooltip 恒白;
      //  rare `{$rarity}` 已在注册期解析成 11+ 档 id,色面走 mouseTextInnerColor mod 查表)
      rare = def.rare;
    }
    if (prefix) {
      const pv = prefixValueMul(prefix);
      // ★刀3-1:词缀档位移分域。★红队 R2-M1 修正:tML ModRarity.GetPrefixedRarity
      //  缺省=Type(档位不变,ModRarity.cs:31;Item.cs.patch:995-1017 baseRarity≥
      //  ItemRarityID.Count(12) 走 ModRarity 面)——mod 档(≥12)整体跳过位移
      //  (旧实现 12+2=14 泛紫/12−2=10 落原版红=reforge 丢档色);原版域(≤11)
      //  clamp 11 逐位保持(tML cap Purple 同相)
      if (rare >= MOD_RARITY_ID_BASE) {
        // mod 档:档位恒等(零位移)
      } else if (pv >= 1.2) rare = Math.min(11, rare + 2);
      else if (pv >= 1.05) rare = Math.min(11, rare + 1);
      else if (pv <= 0.8) rare = Math.max(-1, rare - 2);
      else if (pv <= 0.95) rare = Math.max(-1, rare - 1);
    }
    // ④ expert 旗末位覆写 → −12——仅 MouseText tooltip 链（Main.cs:20512-20515
    //    绘制期覆写）;PopupText 飘字链（PrepareEffects PopupText.cs:388-404）读
    //    Item.rare 字段值,expert 走 somePopup.expert 旗不改色——专家配饰 3090/3097
    //    等可重铸,飘字链须跳过④（否则 −12→白。★S5 勘误 BJ263 2026-09-22:原版 expert
    //    飘字色=Disco 动色（PopupText.cs:670-674 Main.DiscoR/G/B）,非「位移后表色」
    //    ——本仓静态稀有度画线=登记偏差,维持）。★SW-N4
    if (!opts?.forPopup && isVi && ITEM_EXPERT[String(vid)] === 1) rare = -12;
    return rare;
  }

  /** ★BJ407（2026-09-29）tooltip 内容装配单源：名行（稀有度色/×N/★/变体后缀）+
   *  收藏/共享行族 + GetLinesInfo 全载荷行（组装器 ui/itemTooltip.ts）。消费面 =
   *  showTooltipFor（背包/箱/装备/商店/搜索行）∪ showReforgeTooltip（重铸槽）——
   *  原版语义：重铸槽悬停与物品栏悬停同一 MouseText 管线（Main.cs:42389-42391
   *  ItemSlot.Handle/Draw(ref reforgeItem, 5) → ItemSlot.MouseHover :3168-3190
   *  Main.HoverItem = item.Clone()+tooltipContext,context 5 不在置位 switch 内
   *  =无 wornArmor/social/buy 特化 → MouseText_DrawItemTooltip 全载荷）,前缀差分
   *  链门 = item.prefix > 0（Main.cs:21224）,62-80 配饰硬编码档同块（:21355-21460）
   *  ——原版无「重铸槽降级 tooltip」概念。本仓旧 showReforgeTooltip 自装「名行+
   *  prefixLines」贫面两层缺：①GetLinesInfo 全载荷行（静态 ItemTooltip.* 如鲨牙
   *  项链「盔甲穿透力增加5」/可装备/材料/研究/套装…）②PREFIX_FIXED_ROWS 62-80
   *  硬编码差分行（仅 GetLinesInfo 组装内产出）——Violent(80) 等 tier-only 词缀
   *  stat 表全乘子 1 档,prefixLines 零行 → 饰品重铸槽悬停只剩名行（BJ407 用户
   *  实报）;武器（Legendary 等乘子词缀）恰有差分行故「看似正常」（基伤害行族
   *  同样整缺）。 */
  private buildTooltipHtml(
    s: { id: number; stack: number; favorited?: boolean; prefix?: number },
    where: SlotWhere, i: number,
    /** override 透传（本装配面消费 shopCell + bestiaryNotes;slot/anchor 由调用方定位面持有） */
    override?: { shopCell?: { price: number; medal?: number }; bestiaryNotes?: string[] },
  ): string {
    const def = ITEM_DEFS[s.id];
    // ★SW-BJ116-b（2026-09-18,债刀-3）：稀有度判定链单源委托 tooltipRareOf
    //  （基表→变体→词缀档位移→expert 覆写,逐域锚见方法头）——本面行为零变化
    //  （旧内联链原序迁入）;isExpert 另取（Expert 行门 :21214 旗本体判,非 rare 档判）
    const rare = this.tooltipRareOf(def, s.prefix);
    const isExpert = !!def && def.key.startsWith('vi_')   // ★方案 A：洞守卫（BJ265）
      && ITEM_EXPERT[String(parseInt(def.key.slice(3), 10))] === 1;
    const nameColor = this.rarityColor(rare);
    // 词缀名前缀（Lang.GetPrefixedItemName：CombineFormat.Prefix 格式拼装,★BJ390 <> 面）
    const prefixName = s.prefix ? prefixDisplayName(s.prefix) : '';
    // 名称行（GetHoverName :420-427：不加粗、堆叠>1 追加 " (N)"；稀有度色）
    const stackSuffix = s.stack > 1 ? ` (${s.stack})` : '';
    // 变体名后缀（ItemVariants：remix/getGood/mechdusa 世界激活件显示官方变体名
    //  ——ItemVariant.Stronger「更强」等，l10n 官方键随产物内置。★1456 客户端
    //  ItemVariant.Description 仅为 NetworkText 数据面，无 tooltip 渲染消费——
    //  此后缀为本仓可读性标注（任务 M2 项 4），颜色取对话框蓝灰弱化）
    const variantSuffix = def.key.startsWith('vi_')
      ? (() => {
        const kind = activeVariantOfVid(parseInt(def.key.slice(3), 10));
        if (!kind) return '';
        const label = Lang.text(VARIANT_L10N_KEY[kind]);
        return label ? ` <span style="color:#7899ec">(${label})</span>` : '';
      })()
      : '';
    // ★SW-清债④：−12/−13 活色档名称 span 钉档（data-rare）——startTooltipPulse
    //  rAF 循环逐帧重染（原版 MouseText 每帧重绘 → disco/masterColor 连续推进;
    //  静态渲染只落在采样帧,色相会冻结）
    const rareSpanAttrs = (rare === -12 || rare <= -13)
      ? ` class="sw-tooltip-rare" data-rare="${rare}"`
      : '';
    let html = `<span${rareSpanAttrs} style="color:${nameColor}">${affixedItemName(s.prefix, Lang.itemNameByKey(def.key))}${stackSuffix}</span>${variantSuffix}`;
    if (s.favorited) html += ` <span style="color:#ffb347">★</span>`;
    // ---- 统计行（MouseText_DrawItemTooltip_GetLinesInfo，Main.cs:20488-20920 1:1，
    //      构建器在 ui/itemTooltip.ts）：vi_ 全量——伤害[+类型后缀]/暴击/速度档/击退档/
    //      渔力鱼饵/可装备/时装/防御/镐斧锤力/恢复/耗魔/可放置·弹药·消耗品/材料/
    //      容器/Buff 持续/词缀差分；legacy 物品维持原近似 ----
    const g = this.game as unknown as {
      player?: {
        damageMult(k: 'melee' | 'ranged' | 'magic' | 'summon'): number;
        critChance(k: 'melee' | 'ranged' | 'magic'): number;
        equipStats?: { manaCostMul?: number; kbGlove?: boolean };
        buffs?: { has?: (b: number) => boolean };
      };
      anglerQuestItemId?: () => number;
    };
    const gp = g.player;
    const tps = gp ? {
      // ★BJ407：?. 桩域中性快照（真 player 恒有方法,实行为零变化;重铸槽同管依赖此面）
      dmgMult: { melee: gp.damageMult?.('melee') ?? 1, ranged: gp.damageMult?.('ranged') ?? 1, magic: gp.damageMult?.('magic') ?? 1, summon: gp.damageMult?.('summon') ?? 1 },
      crit: { melee: gp.critChance?.('melee') ?? 0, ranged: gp.critChance?.('ranged') ?? 0, magic: gp.critChance?.('magic') ?? 0 },
      manaCostMul: gp.equipStats?.manaCostMul ?? 1,
      kbGlove: !!gp.equipStats?.kbGlove,
      kbBuff: !!gp.buffs?.has?.(BuffType.Titan),      // 泰坦 108 → kbBuff（:20812 近战击退×1.5）
    } : null;

    // 物品自带说明（原版 item.ToolTip 渲染段 Main.cs:20783-20798 ← l10n ItemTooltip.*）。
    // ★先 has() 再取（缺失键静默空，铜剑/药水/钱币等老物品本无静态 tooltip）
    // ★S4：内联域提取单源 resolveStaticTip（BySearch 语料同吃,注释随迁）+
    //  Plantera 诅咒首行特例（Main.cs:21149-21162:UsesCursedByPlanteraTooltip
    //  {1533-1537,4714} && !downedPlantBoss → 首行替换 tip[59];作用于 item.ToolTip
    //  段本体——def.desc 为本仓扩展拼接面,故替换先于 desc 追加）
    let staticTip: string | null = null;
    if (def.key.startsWith('vi_')) {
      const vid = parseInt(def.key.slice(3), 10);
      staticTip = resolveStaticTip(vid);
      staticTip = planteraCursedTip(vid, staticTip, !!this.game?.world?.flags?.['downed_262']);
    }
    if (def.desc) staticTip = staticTip ? `${staticTip}\n${def.desc}` : def.desc;
    // ---- 悬停上下文（低频行族门数据，Main.cs:20178-20220）----
    const vid = def.key.startsWith('vi_') ? parseInt(def.key.slice(3), 10) : -1;
    // 研究（:21163-21178 旅程角色 difficulty==3）
    const research = (g as unknown as {
      research?: { tryGetSacrificeNumbers(id: number): { have: number; need: number } | null };
      world?: { isJourney?: boolean };
    });
    // ★BJ249 F2：LoadoutShare 共享来源判定提前（行族与 ctx.loadoutShareHint 两消费点
    //  单源;门=flag2,Main.cs:20823-20838——canLoadoutShareAt 域内无共享来源且未收藏）
    const loadoutSharedFrom = (where === 'armor' || where === 'dye')
      ? this.game.player.inv.effectiveSharedFrom(i, where === 'dye') : null;
    const ctx: import('./itemTooltip').TooltipContext = {
      research: research.research && (g as unknown as { world: { difficulty: number } }).world?.difficulty === 3
        ? research.research.tryGetSacrificeNumbers(vid) : undefined,
      // 商店（:20310-20402 npcShop>0——NpcShop 面板开着时以买入价显示）：
      // 价格 = item.value×5 买入 / ÷5 卖出（GetItemExpectedPrice 近似走 def.value）
      // ★SW-BJ22 词缀随行（Item.cs:596-597 value 缩放进卖价）；shopCell =
      //  商品格位买入价（context 15）；无 shopCell = 玩家物品卖出价语义
      shop: this.shopTooltipContext(def, vid, s.stack, { prefix: s.prefix, shopCell: override?.shopCell }),
      // ★SW-清债④：Expert 行门 = item.expert 旗本体（:21214-21218,旗表——旧
      //  rare===−12 判在全表零 −12 基值下永假=行整缺）;Master 行门 = item.rare
      //  【字段值】−13（:21219-21223 原文——非难度档;此 rare 已含变体/词缀域位移）
      expert: isExpert,
      master: rare === -13,
      anglerQuestItemId: g.anglerQuestItemId?.() ?? 0,
      // ★BJ230 社交槽语义（ItemSlot.cs:3187-3197 case 9/11 → HoverItem.social=true：
      //  时装甲 10-12=context 9（Main.cs:42193）、时装配饰 13-19=context 11（:42196）；
      //  染料槽 context 12（:42233）不在置位 switch 内。旧 dye/miscDye 臂=BJ224 登记
      //  债的伪锚定（tip0/tip1 三版反编译零消费=死键）,定谳后摘除）
      socialSlot: where === 'armor' && i >= 10,
      // ★BJ507 B2：图鉴掉落行 hover 的 BestiaryNotes 行族（原版 = HoverItem 载体上的
      //  Item.BestiaryNotes,Main.cs:21539-21547 渲染期逐行追加;override 只在图鉴
      //  悬停桥传入,其余消费面 undefined=零变化）
      bestiaryNotes: override?.bestiaryNotes,
      // ★BJ224 套装奖励行门数据（Main.cs:21473-21517）：worn = 悬停位 ∈ 功能甲槽
      //  armor[0-2]（ItemSlot.MouseHover context 8 → HoverItem.wornArmor=true,
      //  ItemSlot.cs:3190-3193;时装甲 10-12 = context 9 social、背包/箱/时装槽=无旗）
      //  wornH/B/L = GetEffectiveArmor(0/1/2) 的 vid（ArmorSetBonus.QueryContext
      //  :18-41——含 LoadoutShare 收藏共享件,与 Player.computeEquipStats 同源）。
      //  player 未挂（测试桩/无世界态）→ worn vids 全 0（=零穿戴,与原版空 armor 同相）
      setBonusHover: (() => {
        const wornVid = (it: { id: number } | null | undefined): number => {
          const d = it ? ITEM_DEFS[it.id] : undefined;
          if (!d) return 0;
          return d.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
        };
        const inv = this.game?.player?.inv;
        return {
          worn: where === 'armor' && i < 3,
          wornH: inv ? wornVid(inv.getEffectiveArmor(0)) : 0,
          wornB: inv ? wornVid(inv.getEffectiveArmor(1)) : 0,
          wornL: inv ? wornVid(inv.getEffectiveArmor(2)) : 0,
        };
      })(),
      // ★BJ249 F2 首用提示行门（=flag2 ∧ ShowLoadoutShareHint,行序归位在
      //  assembleTooltipLines——套装行后/研究行前,原版 Main.cs:21519-21522）
      loadoutShareHint: (where === 'armor' || where === 'dye') && loadoutSharedFrom === null
        && !s.favorited && !!options.data.showLoadoutShareHint,
      // ★BJ249 F1 金币枪门数据：Player.HasItem(905)（Player.cs:56551-56561）=背包
      //  58 格逐槽（hotbar 0-9+背包 10-49+钱币 50-53+弹药 54-57）,stack>0
      hasCoinGun: (() => {
        const inv = this.game?.player?.inv;
        if (!inv) return false;
        for (let k = 0; k < 58; k++) {
          const it = inv.slots[k];
          if (it && it.stack > 0 && (ITEM_DEFS[it.id]?.vid ?? -1) === 905) return true;
        }
        return false;
      })(),
    };
    let linesHtml = '';
    // ---- LoadoutShare 行族（R4-15,M57:20824-20833 共享两行;★BJ249 F2 首用提示行
    // 已挪出——原版 :21519-21522 行序在套装行后/研究行前,经 ctx.loadoutShareHint →
    // assembleTooltipLines 插入,不再置行族头部）：装备/染料格（canLoadoutShareAt
    // [8-12],IS57:367-371）悬停时,紧随名称行（GetLinesInfo 里在全部统计行之前）：
    // 共享来源行 > 共享标记行。共享两行走默认文字色（GetLinesInfo 未赋 lineColors）。
    // ★misc 族无此行族（canLoadoutShareAt 不含,R4-15③ 清偿——此前 favorited misc
    // 误显"已共享"）。ShowLoadoutShareHint 走 options 持久化（R4-14 清偿）
    if (where === 'armor' || where === 'dye') {
      if (loadoutSharedFrom !== null) {
        linesHtml += `<br>${Lang.text('UI.ItemLoadoutSharedFrom', loadoutSharedFrom + 1)}`;
      } else if (s.favorited) {
        linesHtml += `<br>${Lang.text('UI.ItemLoadoutShared')}`;
      }
    }
    // ★SW-AU2 2026-09-06 收藏两行（Main.cs:20841-20845 `else if (item.favorited)`：
    // tip[56] "Marked as favorite" + tip[57] "Quick trash, stacking, and selling
    // will be blocked" = LegacyTooltip.56/57）——与 LoadoutShare 行族同一 if/else
    // 链（:20824/:20841），收藏件走装备/染料行时不重复出这两行
    else if (s.favorited) {
      linesHtml += `<br>${Lang.text('LegacyTooltip.56')}`;
      linesHtml += `<br>${Lang.text('LegacyTooltip.57')}`;
      // ★SW-BJ1 2026-09-06 收藏自锁行（Main.cs:20846-20852）：容器开着时
      // IsBlockedFromTransferIntoChest（ChestUI.cs:1287-1298：收藏钱槽 3213 →
      // 存钱罐 bank、收藏虚空袋 4131/5325 → 虚空袋 bank4）→ UI.ItemCannotBePlaced-
      // InsideItself（"此物品无法被放入其自身"）。可达性：CAN_FAVORITE_AT 含背包
      // 0/1/2/32 槽（SlotActions.ts:61），收藏钱袋/虚空袋存在（拖放臂同判别式
      // 已挡移动）——旧注「容器族不产生收藏标记」系误判,本行为差为真
      if (this.openChest
        && blockedFromTransferIntoChest(this.openChest.x,
          (ITEM_DEFS[s.id]?.vid ?? -1))) {
        linesHtml += `<br>${Lang.text('UI.ItemCannotBePlacedInsideItself')}`;
      }
    }
    for (const ln of assembleTooltipLines(def, s, tps, staticTip, ctx)) {
      const color = ln.journeyColor ? '#B46BD8' : ln.color;   // Colors.JourneyMode 紫
      if (ln.yoyoLogo) { linesHtml += `<br><img class="sw-yoyo-logo" src="sprites/vanilla/OneDropLogo.png" alt="">`; continue; }
      linesHtml += `<br>${color ? `<span style="color:${color}">${ln.text}</span>` : ln.text}`;
    }
    // 脉冲只作用于文字层（.sw-tooltip-lines）——面板底色恒定（原版 :20256 逐行
    // lineColors[k] *= mouseTextColor/255 只乘文字色，DrawInvBG 面板色不变）
    // ★首行 br 必须保留（2026-08-21 用户报"参数拼在名称后"）：曾 replace(/^<br>/,'')
    //   把首个换行剥掉 → "铜短剑5 伤害"拼行；原版名称行后即换行（:20488 行链）
    return `<div class="sw-tooltip-lines">${html}<span style="display:none"></span>${linesHtml}</div>`;
  }

  /** 槽位悬停详情气泡。override：非槽位锚点（道具搜索结果行/商店格位）——slot 传
   *  合成槽内容（stack 1 无词缀/收藏），anchor 传气泡定位锚元素；shopCell = 商店
   *  格位悬停（SW-BJ22：context 15 HoverItem.buy 语义 → tooltip 价格行走买入价）；
   *  bestiaryNotes = 图鉴掉落行悬停的条件描述行族（★BJ507 B2） */
  private showTooltipFor(i: number, where: SlotWhere, override?: { slot?: { id: number; stack: number; prefix?: number }; anchor?: HTMLElement; shopCell?: { price: number; medal?: number }; bestiaryNotes?: string[] }) {
    let s = (override?.slot ?? this.slotContent(where, i)) as { id: number; stack: number; favorited?: boolean; prefix?: number } | null;
    // LoadoutShare 空槽悬停（ItemSlot.MouseHover IS57:3174-3178）：装备/染料格空槽
    // 悬停时共享件代打（GetSharedLoadoutItem → GetEffectiveArmor/Dye）——tooltip
    // 全文 + "共享自配装N"行随下方 R4-15 行族自然接上。曾缺 = 空槽早退无任何提示
    //（★override 判据按【内容覆写】位算——仅锚定位的 override 不抑制共享代打）
    if (!s && !override?.slot && (where === 'armor' || where === 'dye')) {
      const inv = this.game!.player.inv;
      const from = inv.effectiveSharedFrom(i, where === 'dye');
      if (from !== null) s = (where === 'dye' ? inv.loadouts[from].dye[i] : inv.loadouts[from].armor[i]) ?? null;
    }
    // ★BJ669e2：触屏锚标记在早退支也要消费（单读即清,残留会跨次污染下一 show）
    const touchAnchor = this.tooltipTouchAnchor;
    this.tooltipTouchAnchor = undefined;
    if (!s) { this.tooltip.style.display = 'none'; return; }
    this.tooltip.innerHTML = this.buildTooltipHtml(s, where, i, override);
    this.tooltip.style.display = 'block';
    this.startTooltipPulse();
    // 定位：锚槽右侧（原版跟鼠标+toolTipDistance；槽锚定确定性更好），屏幕钳制
    // （:20241-20250 num4=18 边距）
    // ★SW-TT1（2026-09-19 实报定谳「气泡右侧多出一截」）：量测必须先清旧锚再定位，
    //   烘底必须挪到定位之后——position:fixed shrink-to-fit 宽度受元素【当前
    //   style.left】约束，上一次悬停残留的 left 会把本次 offsetWidth 挤窄（屏幕
    //   钳制支最多差 18px、非钳制支可差到整个自然宽），随后写 left/top 触发回流
    //   回弹变宽，而 applyTooltipBg 已按旧宽烘好固有尺寸底图（background-size:
    //   auto）→ 盖不满的右缘条带被默认 repeat 从左上平铺补空 = 气泡右侧多出的
    //   重复贴图凸块（原版即时模式每帧按当帧串宽画底 Utils.DrawInvBG :2718-2742，
    //   无跨帧位置反馈 = 无此伪影，本仓 DOM 遗留态特有）。
    const slotEl = override?.anchor ?? this.slotEl(i, where);
    // ★BJ669e2：触屏长按通道回落元素锚（标记已在上方早退支前单读即清）——触屏
    //  会话无 mousemove 流,光标锚的 mouseX/mouseY 无更新源 → 气泡钉左上角;
    //  桌面 mouseenter 支恒 undefined=光标锚不受影响
    this.tooltipFollowsCursor = false;   // 默认不跟随;仅下方光标锚支置 true
    if (touchAnchor) {
      this.tooltip.style.left = '0px';   // 清旧 left 约束（同帧多次写样式,无中间绘制）
      this.tooltip.style.top = '0px';
      const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
      const r = touchAnchor.getBoundingClientRect();
      let left = r.right + 8, top = r.top;   // BJ669e 前元素锚语义（触屏无光标流）
      const pad = 18;
      if (left + tw > window.innerWidth - pad) left = Math.max(0, window.innerWidth - tw - pad);
      if (top + th > window.innerHeight - pad) top = Math.max(0, window.innerHeight - th - pad);
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${top}px`;
    } else if (slotEl) {
      this.tooltip.style.left = '0px';   // 清旧 left 约束（同帧多次写样式,无中间绘制）
      this.tooltip.style.top = '0px';
      const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
      // ★BJ669e（2026-10-13 用户实报「装备栏悬停气泡遮挡」定谳）：原版 MouseText
      //  锚=【光标】（Main.cs:20378 X=mouseX+14/Y=mouseY+14;ThickMouse +6;持物
      //  !mouseItem.IsAir → X+=34 避让手持贴图 :20386;右/底缘钳 num2 边距
      //  :20403-20412）——「跟手」语义=气泡不出现在光标所指格上。旧「槽右+8、
      //  槽顶对齐」系自创锚（SW-TT1 注「槽锚定确定性更好」）——右缘槽（装备栏）
      //  右缘钳后左缘退回槽区=盖住所指格+相邻列（图 123 实报）。改光标锚+原版钳式,
      //  SW-TT1 的「先清旧锚再量测、烘底定位后」教训保留。
      //  ★BJ669e2（2026-10-13 用户实报「快速跨装备槽 tooltip 原地换内容不重算位」）：
      //  光标锚公式迁 cursorTooltipPos 单源（本方法与 mousemove 跟随臂共用）,显示期
      //  每拍对齐当帧光标=原版即时模式同相（跟随臂见 bindDocumentHandlers mousemove）。
      this.tooltipCursorSize = { tw, th };
      const { left, top } = this.cursorTooltipPos(tw, th);
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${top}px`;
      this.tooltipFollowsCursor = true;
      // ★清偿A-F5：记悬停宿主（WeakRef 弱持不挽留,BJ328 泄漏纪律）——mousemove
      //  跟随臂逐拍 isConnected 检查,宿主被 DOM 移除（refreshAll 重建行族）即隐藏
      const WR = (globalThis as unknown as { WeakRef?: new (t: object) => { deref(): HTMLElement | undefined } }).WeakRef;
      this.tooltipCursorHostRef = WR ? new WR(slotEl) : null;
    }
    this.applyTooltipBg();   // ★终布局后量测烘底（原在定位前 = 旧约束宽）
  }

  /** ★BJ507 B2 图鉴掉落行悬停桥（Main.HoverItem 面 1:1）：原版
   *  UIBestiaryInfoItemLine.DrawMouseOver（UIBestiaryInfoItemLine.cs:130-134）=
   *  `Main.HoverItem = _infoDisplayItem; Main.instance.MouseText("", 0, 0);
   *  Main.mouseText = true;` → MouseText 走 item tooltip 全载荷管线
   *  （MouseTextDrawItemTooltip）。_infoDisplayItem = SetDefaults(itemId) 的
   *  fresh item（无词缀/stack 1/未收藏）→ 本仓与道具搜索行悬停同形（非槽位
   *  锚点 slot 合成 + anchor 定位,showTooltipFor :4016 先例）；notes = 掉落
   *  条件描述行族（SetBestiaryNotesOnItemCache → Item.BestiaryNotes）。
   *  消费方 = BestiaryPanel（flow 桥,mainFlow openBestiary 接线） */
  showFloatingItemTooltip(itemId: number, anchor: HTMLElement, notes?: string[]): void {
    // ★BJ653 图鉴悬停层序（用户实报 111.png：气泡左缘被图鉴面板裁切「莱姆法杖」+暗化）——
    //  .sw-tooltip 挂 .sw-root(z10) 语境,图鉴 .sw-bst(z30+全屏黑幕) 同层压过 → 恒被盖。
    //  原版 = MouseText 系接口层恒最上：Main.DrawInterface :45678-45690 先绘全部
    //  _gameInterfaceLayers（图鉴 UIState 在内）再 DrawPendingMouseText(:45776) ——
    //  tooltip 绘制位次在一切 UIState 之后。随 MouseTextTip 族惯例（.sw-mt-tip
    //  document.body+z1300）暂离 .sw-root 挂 body；归宿记录/还原 = 搜索浮窗
    //  tooltipHome 先例(:4059/:4237)——图鉴 close() 恒走 hideItemTooltip 归还。
    const tipEl = this.tooltip as HTMLElement | undefined;   // teardown 期可 null（closeAll :7911）
    if (tipEl && !this.tooltipHome) {
      this.tooltipHome = tipEl.parentElement;
      document.body.appendChild(tipEl);
    }
    this.showTooltipFor(itemId, 'inv', { slot: { id: itemId, stack: 1 }, anchor, bestiaryNotes: notes });
  }

  /** ★BJ507 B2 悬停离开（原版 mouseText 管线每帧重算,离开=HoverItem 空气自然消失;
   *  DOM 遗留态须显式撤泡）+★BJ653 暂离归还（body→原宿,背包悬停气泡不留顶层语境） */
  hideFloatingItemTooltip(): void {
    this.tooltip.style.display = 'none';
    if (this.tooltipHome) {
      this.tooltipHome.appendChild(this.tooltip);
      this.tooltipHome = null;
    }
  }

  /** 商店悬停上下文（MouseText_DrawItemTooltip_AddShopLines Main.cs:20632-20402，
   *  SW-BJ22 2026-09-07 逐句重锚）。原版语义：门 = npcShop>0 && value≥0 && 非钱币
   *  （:20634）；价格行买入/卖出由 HoverItem.buy 分流——buy 只在商店格悬停置位
   *  （MouseHover context 15 ItemSlot.cs:3197-3201），背包/热栏格悬停恒 false =
   *  卖出价行（旧实现把货架物品的背包悬停也判成买入价，系对 :3200 的误读，本刀
   *  纠正）。卖出价 = computeSellValue 全链（calcForSelling÷5 min1 ×stack + 回购
   *  差额 :20652-20660，与 Player.SellItem :34732-34743 同式——快乐度 ÷PriceAdjustment
   *  /词缀 value 缩放/回购记全参与）；calcForSelling≤0 → tip[51] 无价值行
   *  （:20731-20738 type!=3817 门——散护卫勋章 3817 不显「无价值」） */
  private shopTooltipContext(def: (typeof ITEM_DEFS)[number], vid: number, stack: number,
    opts?: { prefix?: number; shopCell?: { price: number; medal?: number } }): { buy: boolean; priceCopper: number; medalPrice?: number } | null {
    if (!this.game.npcShopOpen) return null;   // Main.npcShop<=0 早退（:20634）
    if (vid >= 71 && vid <= 74) return null;   // 钱币无价格行（:20634 type 71-74 早退）
    // 商品格位悬停（context 15 → HoverItem.buy=true）→ 买入价行 tip[50]
    // （:20638 num=calcForBuying；勋章条目走 GetPriceText 勋章文案 :20644-20648，
    //  CustomCurrencySingleCoin.GetPriceText :103-107）
    if (opts?.shopCell) {
      if (opts.shopCell.medal !== undefined) return { buy: true, priceCopper: opts.shopCell.medal, medalPrice: opts.shopCell.medal };
      return { buy: true, priceCopper: Math.max(1, opts.shopCell.price) };
    }
    // 玩家物品（背包/热栏/箱格等悬停，buy=false）→ 卖出价行 tip[49]：
    // computeSellValue = SellItem :34732-34743 同式（词缀缩放+快乐度÷+回购差额）
    const quote = computeSellValue(vid, Math.max(1, stack), {
      prefix: opts?.prefix ?? 0,
      priceAdjustment: (this.game as unknown as { shopHappinessMul?: number }).shopHappinessMul,
      discountAvailable: this.game.player.equipStats.discount,
      sellbackAmount: (this.game as unknown as { shopSellbackMemo?: Map<string, number> })
        .shopSellbackMemo?.get(`${vid}:${opts?.prefix ?? 0}`) ?? 0,
    });
    if (quote.sellable) return { buy: false, priceCopper: quote.copper };   // :20640 num>0 支
    return vid === 3817 ? null : { buy: false, priceCopper: 0 };            // :20731-20738 tip51 门
  }

  /** mouseTextColor 亮度脉冲（DoUpdate_AnimateCursorColors :18064-18075：+1/tick
   *  往返 190↔255；tooltip 显示期间持续驱动 filter 亮度） */
  private tooltipPulseRaf = 0;
  private tooltipPulseVal = 255;
  private tooltipPulseDir = -1;
  /** ★BJ669e2（2026-10-13 用户实报「快速跨装备槽 tooltip 原地换内容不重算位」定谳）：
   *  浏览器边界事件先于同批 mousemove 派发——mouseenter 拍 this.mouseX 还是
   *  【上一次】move 的坐标（快速跨槽=旧槽位）,而 DOM 气泡只在 enter 拍定位一次 →
   *  钉旧位换新内容（=实报形态）。原版 MouseText=即时模式每帧以【当帧】mouseX
   *  重绘（Main.cs:20378）,显示期恒跟手。修=光标锚路径置位本门,mousemove 跟随臂
   *  （bindDocumentHandlers）在显示期间逐拍重定位（同批 mousemove 立即纠正 enter
   *  拍的滞后坐标,零可见帧）。元素锚路径（重铸/buff/触屏长按）不置位=不受跟随臂
   *  拖动;tooltipCursorSize=定位拍缓存的自然宽高（跟随臂免逐拍 offsetWidth 布局读,
   *  内容只在 show 拍变化=缓存精确） */
  private tooltipFollowsCursor = false;
  private tooltipCursorSize: { tw: number; th: number } | null = null;
  /** ★清偿A-F5：光标支悬停宿主（WeakRef 弱持,不挽留元素——BJ328 泄漏纪律同款）。
   *  mousemove 跟随臂逐拍 isConnected 检查,宿主游离即隐藏气泡+清跟随态 */
  private tooltipCursorHostRef: { deref(): HTMLElement | undefined } | null = null;
  /** 触屏长按元素锚标记（showSlotHintTouch 触屏支单写,showTooltipFor 单读即清） */
  private tooltipTouchAnchor: HTMLElement | null | undefined = undefined;

  /** ★BJ669e2 光标锚定位公式单源（Main.cs:20378-20392 + :20561-20579,原 BJ669e
   *  内联式迁移）→ ★BJ704-G7 件4（R5 登记债③清偿,2026-10-21）：公式体迁
   *  tooltipAnchor.cursorTooltipAnchor 纯函数（achTipAnchorXY/mouseTextAnchor
   *  同族）,补齐 toolTipDistance(+6,+6,Main.cs:411 静态私有仅 :20561-20562 读)
   *  ——旧式只建 +14+ThickMouse+持物+opaque 换算,toolTipDistance 被 opaque 档
   *  padding 13≈(6+8) 巧合吸收(1px 差),nobox 档文字原点恒偏右 ~7px/偏下 ~3px。
   *  逐项锚/换算推导见 tooltipAnchor.ts 头注（opaque 盒几何 X−14/Y−9 保留 1px
   *  差族声明;nobox=文字缘−padding 钳 num4）。
   *  showTooltipFor 定位拍与 mousemove 跟随臂共用 */
  private cursorTooltipPos(tw: number, th: number): { left: number; top: number } {
    return cursorTooltipAnchor(this.mouseX, this.mouseY, !!this.heldStack,
      options.data.opaqueBoxBehindTooltips, tw, th, window.innerWidth, window.innerHeight);
  }

  /** ★清偿A-F5/F6（2026-10-14）：光标支气泡隐藏+跟随态清零单点（display none/
   *  脉冲停/跟随门/尺寸缓存/宿主 WeakRef 一并清）。F5=宿主游离臂,F6=原地拾取 */
  private hideCursorTooltip(): void {
    this.tooltip.style.display = 'none';
    this.tooltipFollowsCursor = false;
    this.tooltipCursorSize = null;
    this.tooltipCursorHostRef = null;
    cancelAnimationFrame(this.tooltipPulseRaf);
  }
  private startTooltipPulse(): void {
    cancelAnimationFrame(this.tooltipPulseRaf);
    this.tooltip.style.filter = '';   // 清历史整元素滤镜（面板恒定，勿再暗化）
    const lines = this.tooltip.querySelector('.sw-tooltip-lines') as HTMLElement | null;
    if (!lines) return;
    let last = performance.now();
    const step = (now: number) => {
      if (this.tooltip.style.display !== 'block') return;
      for (let t = 0; t < Math.round((now - last) / 16.7); t++) {
        this.tooltipPulseVal += this.tooltipPulseDir;
        if (this.tooltipPulseVal >= 255) { this.tooltipPulseVal = 255; this.tooltipPulseDir = -1; }
        if (this.tooltipPulseVal <= 190) { this.tooltipPulseVal = 190; this.tooltipPulseDir = 1; }
      }
      last = now;
      // 文字层亮度 = mouseTextColor/255（:20256 语义——面板不参与）
      lines.style.filter = `brightness(${(this.tooltipPulseVal / 255).toFixed(3)})`;
      // ★SW-清债④ 2026-09-17：−12 disco/−13 masterColor 活色档逐帧重染（原版
      //  MouseText 每帧重绘 :20587-20629 → DiscoR/G/B 6 相/masterColor ping-pong
      //  连续推进）。换算单源=mouseTextInnerColor（与 Renderer.drawMouseTextLayer
      //  :15431 同函数同钟源 Game.lighting.clock；mt=255 → num3=1 = GetItemNameColor
      //  原生无乘区语义）
      const rareEl = lines.querySelector<HTMLElement>('.sw-tooltip-rare');
      if (rareEl) {
        const r = Number(rareEl.dataset.rare);
        rareEl.style.color = mouseTextInnerColor(r <= -13 ? -13 : -12, 0, 255,
          this.game?.lighting?.clock ?? null);
      }
      this.tooltipPulseRaf = requestAnimationFrame(step);
    };
    this.tooltipPulseRaf = requestAnimationFrame(step);
  }

  /** tooltip 九宫底应用（Inventory_Back13 × (23,25,81)×0.925，:20252-20255）：
   *  素材未就绪时挂一次性 onload 补刷（首次悬停竞态走兜底色）。
   *  悬停文本框开关（SettingsEnabled_OpaqueBoxBehindTooltips，默认 true）：关 =
   *  无底板纯文字（原版 :20256 支）——内联清底，display:none 阶段也先清 */
  private applyTooltipBg(): void {
    if (!options.data.opaqueBoxBehindTooltips) {
      this.tooltip.style.background = 'transparent';
      this.tooltip.style.border = 'none';
      this.tooltip.classList.add('sw-tooltip-nobox');
      return;
    }
    this.tooltip.classList.remove('sw-tooltip-nobox');
    if (this.tooltip.style.display !== 'block') return;
    const w = Math.ceil(this.tooltip.offsetWidth), h = Math.ceil(this.tooltip.offsetHeight);
    const bgUrl = tooltipBgDataUrl(w, h);
    if (bgUrl) {
      // ★no-repeat 硬闸（SW-TT1）：底图恒按终布局尺寸现烘（调用量点全在定位后），
      //   万一未来出现量测漂移，宁可露 1px 缝也不许默认 repeat 把九宫贴图整面平铺
      //   成多块气泡（2026-09-19 重铸格实报形态）
      this.tooltip.style.background = `url(${bgUrl}) no-repeat`;
      this.tooltip.style.border = 'none';
      this.tooltip.style.borderRadius = '0';
    } else {
      this.tooltip.style.background = 'rgba(21,23,75,0.93)';   // 兜底色（≈原版 0.925）
      const img = invBgEnsure();
      // ★SW-TT1：node 测试域无 DOM 构造器（mock tooltip 走到兜底支）——typeof 先行
      if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && !(img.width > 0)) {
        img.addEventListener('load', () => this.applyTooltipBg(), { once: true });
      }
    }
  }

  // ============ 背包 + 合成 ============

  /** 背包面板是否打开（原版 Main.playerInventory 语义——呼吸计锚点分支用，
   *  Game.render 经 window.__swUI 读取；与 UI.ts:802 同款活取） */
  get inventoryOpen(): boolean {
    return !!this.invPanel && this.invPanel.style.display === 'block';
  }

  /** ★BJ259：住房 UI 开态（原版 EquipPage==1 桌面支,Main.cs:46986
   *  DrawInterface_7_TownNPCHouseBanners 门——驻家旗与右键踢出仅住房页开时激活）。
   *  本仓两形态：经典 HousingPanel（housingOpen）∪ vanilla 布局背包住房页
   *  （vinvPageCurrent===1 且背包开）。Game.updateUse 踢出臂经 __swUI 活取。 */
  get housingUiActive(): boolean {
    return this.housingOpen || (this.inventoryOpen && this.vinvPageCurrent === 1);
  }

  /** 住房面板开合回写（mainFlow.openHousing / HousingPanel.onClosed）——
   *  图标切 DisplaySlots_4(常态)/5(住房开) */
  setHousingOpen(v: boolean): void {
    this.housingOpen = v;
    this.refreshHousingBtn();
  }

  private refreshHousingBtn(): void {
    if (this.housingBtn) {
      this.housingBtn.style.backgroundImage
        = `url(sprites/vanilla-ui/UI_DisplaySlots_${this.housingOpen ? 5 : 4}.png)`;
    }
  }

  /** 收住房右缘条（关面板兜底:E/Esc/关背包/退菜单都带走它）——destroy→onClosed
   *  会重入 openInventory,彼时背包尚未显示,重入支直接开背包后外层幂等续行 */
  private closeHousingPanel(): void {
    this.housingOpen = false;
    this.refreshHousingBtn();
    if (document.querySelector('.sw-housing-panel')) {
      (window as unknown as { __swHousingPanel?: { destroy(): void } }).__swHousingPanel?.destroy();
      // destroy 已 canvas.remove;裸移除兜底（面板若被外部摘过节点）
      document.querySelector('.sw-housing-panel')?.remove();
    }
  }

  /** 背包面板贴位：左=热键栏【可视最左】格左缘,顶=其底+8px（2026-08-27 用户要求）；
   *  构建与每次打开时重算。★取槽的 inline left/top 布局目标值（slot 有 80ms 过渡,
   *  rect 会采到中途值）;★扫描全部槽取 min——hotbarEl.firstElementChild 是 (20,20)
   *  锚位元素非首格（用户实测左缘歪 20px 即此因）。透明只调面板底色 alpha、边框/
   *  投影弱化（opacity 曾连内容一起半透,用户纠正） */
  private positionInvPanel(): void {
    if (!this.invPanel) return;
    // ★2026-09-07 刀 2 守卫:vanilla 布局自定位(.sw-vinv fixed inset:0+容器 scale,
    // 见 buildVanillaInventoryPanel/layoutVanilla)——热键栏贴位/透明化全跳过,
    // openInventory 链由此零改动复用
    if (this._builtLayout === 'vanilla') return;
    let best: HTMLElement | null = null;
    let bestL = Infinity;
    for (const s of Array.from(this.hotbarEl?.querySelectorAll<HTMLElement>('.sw-slot') ?? [])) {
      const l = parseFloat(s.style.left);
      if (Number.isFinite(l) && l < bestL) { bestL = l; best = s; }
    }
    const left = best ? Math.max(4, Math.round(bestL)) : 8;
    // ★2026-09-02 用户复报 padding-top 太高：热键栏槽盒 52px 但视觉 ×0.75=39——
    //   按 inline top+height(盒底)贴位会多出 13px 幽灵空隙。改用实测【视觉底】
    //   （getBoundingClientRect 含缩放）+2px 贴合
    const top = best ? Math.round(best.getBoundingClientRect().bottom + 2) : 84;
    // ★2026-09-02 透明化后无框（用户要求）：padding 会把内容往右/下推——面板锚点
    //   内收 padding,使【内容左缘】对齐热键栏最左格左缘、内容顶距热键栏底 8px
    //   （=整体上移;此前内容左/顶各偏 +12）
    const pad = parseFloat(getComputedStyle(this.invPanel).paddingLeft) || 0;
    const panelLeft = Math.max(0, left - pad);
    const panelTop = Math.max(0, top - pad);
    // ★position:fixed/overflow 必须在此维持（.sw-panel 类无定位——曾重写贴位时
    //   丢掉 fixed → 面板回落文档流 = 满宽平铺、left/top 全失效）
    this.invPanel.style.position = 'fixed';
    this.invPanel.style.overflow = 'auto';
    this.invPanel.style.left = `${panelLeft}px`;
    this.invPanel.style.top = `${panelTop}px`;
    this.invPanel.style.maxHeight = `calc(100vh - ${panelTop + 12}px)`;
    // ★2026-09-02 用户要求：背包面板去底去框透明化（试试）——.sw-panel 类的渐变
    //   底/2px 描边/投影全部内联覆盖为透明（此处每次打开重算=权威落点;若要回底色
    //   只需还原本段）。可读性补偿：.sw-inv 作用域给标签/标题加文字投影;
    //   配方行/搜索框/槽位贴图自带底,不受影响
    this.invPanel.style.background = 'transparent';
    this.invPanel.style.border = 'none';
    this.invPanel.style.boxShadow = 'none';
  }

  /** force=跳过开/关翻转（开箱路径 openChestPanel 用：解锁世界输入后「背包开着
   *  右键开箱」可达,翻转语义会把背包连箱子一起关掉） */
  openInventory(force = false) {
    if (!force && this.invPanel.style.display === 'block') {
      this.closeInventory();
      return;
    }
    // 住房条开着(E 切回背包):先收——不收则背包被住房 Canvas 压住
    this.closeHousingPanel();
    this.positionInvPanel();
    this.invPanel.style.display = 'block';
    if (this.eqDockEl) this.eqDockEl.style.display = 'flex';   // 右下角坞随开显
    if (this._builtLayout === 'vanilla') this.vinvPulseStart();   // ★槽底呼吸脉冲(Main.cs:46460-46474)
    // 开背包会引发热键栏重排（slot 80ms left 过渡）——过渡结束后二次贴位校正；
    // 配方列表高度同批二次刷新（首次采样布局未稳,LIST_H 偏大,hover 前不收敛）
    setTimeout(() => {
      this.positionInvPanel();
      this.refreshVanillaCrafting();
    }, 120);
    this.refreshAll();
    // ★2026-09-02 用户要求：背包展开解锁世界操作——原版 playerInventory 开启不拦
    // 输入（移动/跳跃/攻击/挖掘/交互照常,Main.mouseInterface 只在光标压 UI 时拦）。
    // 本仓等价 = 不再置 uiBlocking;「光标压 DOM UI」由 Game.updateUse 的
    // inpOverDomUi 门承担,光标持物由 uiHeldItemRef 门承担。
  }

  /** 装备页追加槽显隐（Player.cs:4279 Shown=解锁∨功能格∨社交孪生∨染料格;效果门=逐槽 :12669-12690） */
  private refreshEquipExtras(): void {
    const inv = this.game?.player.inv;
    const els = this.equipExtraSlots;
    if (!inv || !els) return;
    // ★清偿刀 P 单源（Inventory.extraSlotShown :4259-4281——解锁∨功能格∨社交
    // 孪生 18/19∨染料格;旧 inline 版漏社交孪生臂）
    const shown = inv.extraSlotShown();
    const heartShown = shown.heart;
    const masterShown = shown.master;
    if (els.equip[0]) els.equip[0].style.display = heartShown ? '' : 'none';
    if (els.equip[1]) els.equip[1].style.display = masterShown ? '' : 'none';
    if (els.dye[0]) els.dye[0].style.display = heartShown ? '' : 'none';
    if (els.dye[1]) els.dye[1].style.display = masterShown ? '' : 'none';
    if (els.vanity[0]) els.vanity[0].style.display = heartShown ? '' : 'none';
    if (els.vanity[1]) els.vanity[1].style.display = masterShown ? '' : 'none';
  }

  closeInventory() {
    // ★清偿刀 U：ResetInventoryStateCounters（ItemSlot.cs:3262-3265,Main.cs:46445
    //   !playerInventory 支每帧调）——DyeSwap 计数器关包归零（重开轮转从头开始）
    resetInventoryStateCounters();
    this.closeHousingPanel();
    // ★住房光标随关包解除（Main.cs:46429 !playerInventory → SetMouseNPC(-1,-1);
    //   死亡强收包 :46435-46440 同面）——HousingPanel 条已由 closeHousingPanel
    //   自毁清态;vanilla 布局住房页(EquipPage=1)游标滞留则重开背包后仍吞世界点击
    this.game.housingMode = null;
    this.invPanel.style.display = 'none';
    if (this.eqDockEl) this.eqDockEl.style.display = 'none';   // 右下角坞随关收
    this.closeItemSearch();
    this.closeGuideSearch();
    this.closeChest();
    // ★SW-FX30 刀②:PipsUseGrid 生命周期(Main.cs:43916 !playerInventory 门 →
    // :43934 DrawInterface_Resources_Buffs 首行 PipsUseGrid=false——原版只在关包态
    // 走 buffs 绘制,即关包当帧清网格态;recStart 归零 = :43926-43930 !PipsUseGrid 支)
    this.vinvPipsUseGrid = false;
    this.vinvCraftRecStart = 0;
    this.vinvSyncGridToggle();
    // ★SW-FX41:NewCraftingUI.Close(quiet:true)(Main.cs:46438-46444 !playerInventory
    //   支——关包当帧静默收窗+OnDeactivate :917-924 清滤器/选中)
    this.vinvCloseModernCraft(true);
    // ★SW-RB14b:!playerInventory ⇒ npcShop=0(Main.cs:42496-42499 DrawInventory 每帧门
    //   `npcShop > 0 && (!playerInventory || talkNPC == -1) → SetNPCShopIndex(0)` +
    //   Main.cs:46434-46441 dead→playerInventory=false 链;1458 :42502/:46440 同式)。
    //   原版关闭商店面 = !playerInventory ∨ 对话关闭 双臂,本仓此前只接对话臂
    //   (closeNpcDialog→npcShopClose):设置浮层开(openInGamePause 收包)/死亡强收包
    //   (tickChestAutoClose→closeInventory)后 npcShopOpen 残留 → 重开背包货架复活
    //   (原版需重按商店钮)。对话臂先走的路径(Esc 链)此处幂等 no-op。
    // ★SW-RB29c F1:上臂只清 Game 态——classic 浮动货架 DOM 面(NpcShop 浮层)由
    //   closeNpcDialog 对称臂才收,商店→右键另一 NPC 换谈走收包链不经 closeNpcDialog
    //   时浮面滞留(滞留格可点/换谈询价错位)。此处与 closeNpcDialog 同式收面;
    //   vanilla 内嵌货架无独立面(refreshAll 收面),close() 触发 onClose 幂等回灌
    //   npcShopClose,vanilla 态 no-op。
    this.npcShop?.close();
    this.npcShop = null;
    this.game.npcShopClose();
    // 放回手上物品。★SW-RB4a 2026-09-06 关包光标物归位 1:1（dropItemCheck :5136-5140
    // `!Main.playerInventory` 臂 → GetOrDropItem（ReturnItemFromSlot）→ GetItem + 余量
    // RequestNewItem 落地 Player.cs:5132-5136）：①词缀/实例样式随行入包（曾裸
    // (id,stack)=词缀件关包即洗白——重铸词缀在 getEffectiveArmor/重铸格回流面丢词缀）；
    // ②满包余量落地（曾静默丢弃=物损方向）。
    // ★SW-BP1 2026-09-07（RB4a 债④ / RB5a 债②）：③收藏标记随行入包——原版 GetItem
    // 空格落位 `inventory[i] = returnItem`（Player.cs:39873）=整个 Item 对象回包,
    // favorited 金边随行；并入已有堆时堆位收藏保持（现有堆面不动）。本仓 add 通道
    // 此前不收 favorited=落新堆丢收藏（登记偏差清偿）。④余量落点 p.y→p.cy
    // （GetOrDropItem 尾 RequestNewItem(base.Center) Player.cs:7200-7202=玩家
    // 【中心】,曾用顶 y）。favorited 件空格序升序（GetItem :39681-39698 favorited
    // 臂同向）由 Inventory.add 内接。
    if (this.heldStack) {
      const h = this.heldStack;
      const hDef = ITEM_DEFS[h.id];
      const left = this.game.player.inv.add(h.id, h.stack, h.prefix, h.placeStyle, false, false, !!h.favorited);
      if (left > 0) {
        const p = this.game.player;
        // ★BJ390：余量词缀随行（Player.cs:7202 InventoryOverflow RequestNewItem item2.prefix 同域）
        this.game.spawnDrop(p.cx, p.cy, hDef?.key ?? '', left, undefined, undefined, h.placeStyle, h.prefix);
      }
      this.heldStack = null;
    }
    // 材料格内容归还背包（CraftingGrid 关闭语义）
    this.returnCraftGrid();
    this.craftGridRecipe = null;
    // 垃圾桶为持久槽（Player.trashItem 语义）：关闭背包保留，仅死亡时由 Game 清空
    this.moveGhost();
    // ★2026-09-07 刀 2 守卫(共享区第 5 处):vanilla 布局关包须解除热键栏隐藏
    // (refreshHotbar 开包早退的还原面;classic 关包链无刷新点,main.ts:427 直调)
    if (this._builtLayout === 'vanilla') {
      this.vinvReforgeOpen = false;   // 原版重铸菜单随背包关闭退出(DrawInventory 域内)
      // ★BJ633：关包=playerInventory=false(Main.cs:46443 InReforgeMenu=false)→原版
      //   下拍 dropItemCheck reforgeItem 支消费(Player.cs:5115-5118)——本仓离散链
      //   此处即时归还,重铸槽物品不随关包滞留(吞装备根因之一)
      this.returnReforgeItem();
      this.vinvGuideMenuOpen = false;   // ★刀19:向导态随背包关闭退出(关包=playerInventory 面同步)
      this.reflowBuffs();             // ★SW-FX10 债④:页2 列内 buff 块回流 HUD 栏(关包当帧)
      this.refreshAll();
    }
    // ★2026-09-02：不再清 uiBlocking——背包自 2026-09-02 起不置位（世界输入解锁）,
    // 无条件清会打翻其他模态面板（手册/表情/图鉴）的 wasBlocking 恢复语义
  }

  // ============ 调试用：道具搜索器（背包面板"🔍 道具搜索"按钮） ============
  private itemSearchEl: HTMLDivElement | null = null;
  /** 搜索面板开启期间 tooltip 的暂离归宿（浮窗 z60 > .sw-root z10——tooltip 已搬
   *  body 顶层保持最高,2026-08-27 用户报的遮挡随模态浮层一并消解） */
  private tooltipHome: HTMLElement | null = null;
  // ★SW-BJ81 2026-09-14 规格⑥:长按连取计时器（面板关/松开/滑出条目三面兜底停摆）
  private itemSearchGrabTimer: ReturnType<typeof setInterval> | null = null;
  // ★SW-BJ154 2026-09-19:搜索列表虚拟滚动列宽自适应（ResizeObserver 观察列表容器,
  //   关面板必须 disconnect——面板 DOM 随开随建,observer 残留=泄漏+对死节点布局）
  private itemSearchResizeOb: ResizeObserver | null = null;

  /** 搜出项取件执行器（★SW-BJ81 规格②⑤:数量恒 1,上光标走合成抓取通道
   *  grantCraftToCursor → heldStack;光标满叠余量落地入包,光标被异型占据时整份
   *  兜底入包——覆盖光标=静默丢玩家持物,禁）。取件只动光标不动槽位,故刷新面
   *  = moveGhost(辉光) 而非 refreshAll(长按 8/s 不得整帧刷槽)。 */
  private itemSearchGrab(id: number): void {
    if (!this.game) return;
    const plan = searchGrabPlan(this.heldStack, id);
    if (plan.to === 'cursor') {
      const left = this.grantCraftToCursor(id, plan.stack);
      if (left > 0) this.game.player.inv.add(id, left);   // 满叠余量（创造性语义,溢出即散）
      this.markCursorGlow(id);
      this.moveGhost();
    } else {
      this.game.player.inv.add(id, plan.stack);
      this.refreshAll();
    }
    this.game.cb.onInventoryChanged?.();
  }

  private startItemSearchGrabRepeat(id: number): void {
    this.stopItemSearchGrabRepeat();
    this.itemSearchGrabTimer = setInterval(() => this.itemSearchGrab(id), ITEMSEARCH_GRAB_INTERVAL_MS);
  }

  private stopItemSearchGrabRepeat(): void {
    if (this.itemSearchGrabTimer !== null) {
      clearInterval(this.itemSearchGrabTimer);
      this.itemSearchGrabTimer = null;
    }
  }

  /** 打开搜索面板（首用门：道具搜索为超游调试件,明示风险确认一次后
   *  localStorage 持久放行,后续不再拦截——2026-08-27 用户要求） */
  openItemSearch() {
    if (!this.game) return;
    let confirmed = false;
    try { confirmed = prefGet('sbw.itemSearchConfirmed') === '1'; } catch { /* 隐私模式静默 */ }
    if (!confirmed) { this.showItemSearchGate(); return; }
    this.openItemSearchPanel();
  }

  /** 首用确认弹窗（取消即关；确认写入持久旗并放行） */
  private showItemSearchGate(): void {
    if (document.getElementById('sw-itemsearch-gate')) return;
    const overlay = el('div');
    overlay.id = 'sw-itemsearch-gate';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:1250; display:flex; align-items:center; justify-content:center;';
    const panel = el('div');
    panel.style.cssText = 'width:400px; max-width:90vw; box-sizing:border-box; background:#2a2a35; border:2px solid #6b6b8a; border-radius:6px; padding:14px; display:flex; flex-direction:column; gap:12px; color:#ddd; font-size:13px;';
    panel.appendChild(el('div', 'sw-lbl', '道具搜索'));
    panel.appendChild(el('div', '', '为了游戏体验，如非卡关或调试不建议使用此功能，可能破坏游戏乐趣。确认启用后不再拦截。'));
    const btnRow = el('div');
    btnRow.style.cssText = 'display:flex; gap:8px; justify-content:flex-end;';
    const cancel = el('button', 'sw-btn', '取消');
    cancel.style.cssText = 'margin:0; width:auto; padding:5px 14px; font-size:12px;';
    cancel.addEventListener('click', () => overlay.remove());
    const ok = el('button', 'sw-btn', '确认启用');
    ok.style.cssText = 'margin:0; width:auto; padding:5px 14px; font-size:12px;';
    ok.addEventListener('mousedown', (e) => e.stopPropagation());
    ok.addEventListener('click', () => {
      try { prefSet('sbw.itemSearchConfirmed', '1'); } catch { /* 隐私模式静默 */ }
      overlay.remove();
      this.openItemSearch();
    });
    btnRow.append(cancel, ok);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  /** 搜索面板本体：按 名称/key/原版id 过滤 ITEM_DEFS。
   *  ★SW-BJ81 2026-09-14（用户规格③④）:①几何改右置浮窗（vanillaInvLayout
   *  itemSearchPanelRect 单源——物品栏占位面[网格/钱币弹药列/装备列]之外,旧居中
   *  560px modal 缩窄右移）;②全屏压暗底废止——旧 overlay inset:0 z1200 把背包
   *  槽点击整面吞掉,与规格④「搜索开着物品栏必须在场可点」互斥;非模态后点世界
   *  =光标持物既有语义（左键使用/放置、右键丢出）=规格⑤落点面。生命周期挂靠
   *  背包（closeInventory→closeItemSearch 反向随行）,合成窗同款子面板语义。 */
  private openItemSearchPanel() {
    if (!this.game) return;
    this.closeItemSearch();
    // ★规格④:开搜索必带出物品栏（搜出项落点=物品栏槽,栏不在场=无处可放;
    //   force=已开态幂等刷新,不翻转。停车坪入口 main.ts onItemSearch 从暂停层
    //   进入时背包本关——旧实现不带出=搜出项无处安放,用户实报）
    this.openInventory(true);
    // tooltip 提到 body 顶层（关闭时归还 root）——否则结果行气泡被面板遮挡
    if (this.tooltip.parentElement !== document.body) {
      this.tooltipHome = this.tooltip.parentElement;
      document.body.appendChild(this.tooltip);
    }
    const rect = itemSearchPanelRect(window.innerWidth, window.innerHeight, options.data.uiScale);
    const panel = el('div', 'sw-itemsearch') as HTMLDivElement;
    panel.style.cssText = `position:fixed; left:${Math.round(rect.x)}px; top:${Math.round(rect.y)}px;`
      + `width:${Math.round(rect.w)}px; max-height:${Math.round(rect.h)}px; z-index:60;`
      + 'box-sizing:border-box; background:#2a2a35; border:2px solid #6b6b8a; border-radius:6px; padding:10px; display:flex; flex-direction:column; gap:8px;';
    const titleRow = el('div');
    titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start;';
    titleRow.appendChild(el('div', 'sw-lbl', Lang.text('Mods.SandboxWorld.UI.ItemSearch.Title')));
    const closeBtn = el('button');
    closeBtn.textContent = '✕';
    closeBtn.title = Lang.text('Mods.SandboxWorld.UI.Close');
    closeBtn.style.cssText = 'margin:0; width:20px; height:20px; padding:0; flex:none; cursor:pointer;'
      + 'font-size:11px; line-height:1; background:#3a3a4a; color:#ddd; border:1px solid #6b6b8a; border-radius:3px;';
    closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', () => this.closeItemSearch());
    titleRow.appendChild(closeBtn);
    panel.appendChild(titleRow);
    const input = el('input') as HTMLInputElement;
    input.placeholder = '名称 / key / 原版 id…';
    input.style.cssText = 'width:100%; box-sizing:border-box; padding:6px 8px; background:#1a1a22; color:#eee; border:1px solid #555; border-radius:4px; font-size:14px;';
    panel.appendChild(input);
    const list = el('div');
    // ★SW-BJ154:浮窗内滚改虚拟滚动(JourneyBrowser 同款 spacer+绝对定位可视窗)——
    //   旧 flex-wrap 全量 DOM 渲染撑不住 6856 条(旧 80 条封顶=用户实报"道具不全"
    //   真凶①:2430 池序 464 永远不在前 80),虚拟化后全量可滚可搜。
    //   容器=滚动域;spacer 撑总高;cellsLayer 绝对定位挂可视行(±1 缓冲)。
    list.style.cssText = 'overflow-y:auto; position:relative; flex:1 1 auto; min-height:0;';
    const spacer = el('div');
    spacer.style.cssText = 'position:relative; width:100%;';
    const cellsLayer = el('div');
    cellsLayer.style.cssText = 'position:absolute; top:0; left:0; width:100%;';
    spacer.appendChild(cellsLayer);
    list.appendChild(spacer);
    // 计数行(全量可见的用户感知锚:空查询=池总数,过滤=命中/总数)
    const countEl = el('div', 'sw-lbl');
    countEl.style.cssText = 'font-size:11px; opacity:0.75;';
    panel.appendChild(countEl);
    panel.appendChild(list);
    document.body.appendChild(panel);
    this.itemSearchEl = panel;
    // 长按中在浮窗外松开(行 mouseup 不达)的兜底停摆;{once}=自然消亡不堆积
    document.addEventListener('mouseup', () => this.stopItemSearchGrabRepeat(), { once: true });

    // 全量池单源（buildItemSearchPool:itemSearch.ts 纯函数,判别力测试直锚）
    // 匹配串含【英文原名】+【官方 tooltip 桥】(★BJ154 真凶②:官方 zh 名"粘鞍"
    // 不含族词"史莱姆",tooltip"召唤可骑乘的史莱姆坐骑"是唯一官方语汇桥)
    const pool = buildItemSearchPool({
      nameOf: (k) => Lang.itemNameByKey(k),
      tipOf: (vid) => {
        const nameKey = ITEM_NAME_BY_ID[vid];
        if (!nameKey) return '';
        const path = `ItemTooltip.${nameKey}`;
        return Lang.has(path) ? Lang.text(path) : '';
      },
    });
    // 族词别名（zh 族词分裂：翅膀↔翼——搜"翅膀"也能命中"天使之翼"族；本地
    // 表软链不动 i18n；2026-08-13 报障）。匹配串已含英文原名（搜 wing 全族可见）
    const ALIAS: Record<string, string[]> = { 翅膀: ['翼'], 翼: ['翅膀'] };

    // ---- 虚拟滚动（JourneyBrowser M8 浏览器同款:行高/列数算定,只渲染可视±1 行） ----
    const ROW_H = 32;      // 24 图标 + padding 3×2 + border 1×2
    const GAP = 4;
    const MIN_W = 150;     // BJ81 规格③ 列宽下限(340 宽浮窗两列,窄窗单列)
    let view: typeof pool = [];
    let cols = 2;
    let rafPending = false;
    const layout = () => {
      const w = list.clientWidth;
      cols = Math.max(1, Math.floor((w + GAP) / (MIN_W + GAP)));
      const cw = (w - (cols - 1) * GAP) / cols;
      const rows = Math.ceil(view.length / cols);
      spacer.style.height = `${rows * (ROW_H + GAP)}px`;
      // 等比内距:CSS 变量挂 spacer,cell 布局读同算式(JS 内联,无 CSS 变量依赖)
      (spacer as HTMLDivElement & { __cw?: number }).__cw = cw;
      renderVisible();
    };
    const renderVisible = () => {
      rafPending = false;
      cellsLayer.textContent = '';
      const cw = (spacer as HTMLDivElement & { __cw?: number }).__cw ?? MIN_W;
      const step = ROW_H + GAP;
      const st = list.scrollTop;
      const first = Math.max(0, Math.floor(st / step) - 1);
      const last = Math.min(Math.ceil(view.length / cols), Math.ceil((st + list.clientHeight) / step) + 1);
      for (let row = first; row < last; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          if (idx >= view.length) break;
          const e = view[idx];
          const item = el('div');
          item.style.cssText = `position:absolute; display:flex; align-items:center; gap:4px; box-sizing:border-box;`
            + `left:${col * (cw + GAP)}px; top:${row * step}px; width:${cw}px; height:${ROW_H}px;`
            + 'padding:3px 5px; background:#1f1f28; border:1px solid #444; border-radius:3px; cursor:pointer; font-size:12px; color:#ddd; user-select:none;';
          item.title = `${e.name}  [${e.key}]`;
          // 悬停 = 背包同款详情气泡（2026-08-27 用户要求）——合成槽语义（stack1 无
          // 词缀/收藏）,锚=行元素;离开即收
          item.addEventListener('mouseenter', (ev) =>
            this.showTooltipFor(e.id, 'inv', { slot: { id: e.id, stack: 1 }, anchor: ev.currentTarget as HTMLElement }));
          item.addEventListener('mouseleave', () => {
            this.tooltip.style.display = 'none';
            cancelAnimationFrame(this.tooltipPulseRaf);
          });
          const img = el('img') as HTMLImageElement;
          img.src = iconUrl(this.game!, e.id);
          img.style.cssText = 'width:24px; height:24px; image-rendering:pixelated; flex:none;';
          item.appendChild(img);
          const lbl = el('span');
          lbl.textContent = e.name;
          // ★SW-BJ81 规格③:省略号须 min-width:0(否则名字撑开行宽,双列布局塌单列)
          lbl.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;';
          item.appendChild(lbl);
          // ★SW-BJ81 规格②⑤⑥:按下即取 1 件上光标（合成抓取同款,数量恒 1——
          //   旧「可堆叠给一组≤99」废止）,按住持续 +1（ITEMSEARCH_GRAB_INTERVAL_MS
          //   节奏,并入上限=maxStack,grantCraftToCursor 既有钳制）;落点由玩家放置
          //   （点物品栏槽=放入/点世界=左键使用右键丢出）。stopPropagation=不落
          //   document 光标持物监听（installDragListeners 已豁免 .sw-itemsearch 双保险）
          item.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return;
            ev.stopPropagation();
            ev.preventDefault();
            this.itemSearchGrab(e.id);
            this.startItemSearchGrabRepeat(e.id);
          });
          item.addEventListener('mouseup', () => this.stopItemSearchGrabRepeat());
          item.addEventListener('mouseleave', () => this.stopItemSearchGrabRepeat());
          cellsLayer.appendChild(item);
        }
      }
    };
    const schedule = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(renderVisible);
    };
    list.addEventListener('scroll', schedule, { passive: true });
    // 浮窗宽随视口(uiScale/窗口拖拽)——ResizeObserver 观察列表容器,关面板即断
    this.itemSearchResizeOb?.disconnect();
    this.itemSearchResizeOb = new ResizeObserver(() => layout());
    this.itemSearchResizeOb.observe(list);
    const render = () => {
      // ★BJ207:view 构建单源化（itemSearch.buildItemSearchView）——全量无封顶语义由
      //  行为锁看护（tests/sw-bj154-itemsearch-pool ④段）,UI 侧零本地过滤拼法
      const { view: vv, searched } = buildItemSearchView(pool, input.value, ALIAS);
      view = vv;
      countEl.textContent = searched
        ? `命中 ${view.length} / ${pool.length} 件`
        : `共 ${pool.length} 件（滚动浏览全部）`;
      if (!view.length) {
        spacer.style.height = '0px';
        cellsLayer.textContent = '';
        cellsLayer.appendChild(el('div', 'sw-lbl', '无匹配'));
        return;
      }
      layout();
    };
    input.addEventListener('input', render);
    render();
    input.focus();
  }

  closeItemSearch() {
    // ★SW-BJ81 规格⑥兜底:面板关=连取计时器必停(否则闭包内 itemSearchGrab
    //   持续向已卸载面板的取件规则投喂,光标物无声连涨)
    this.stopItemSearchGrabRepeat();
    // ★SW-BJ154:虚拟滚动列宽 observer 必随面板关断开(面板 DOM 随开随建)
    this.itemSearchResizeOb?.disconnect();
    this.itemSearchResizeOb = null;
    if (this.itemSearchEl) {
      this.itemSearchEl.remove();
      this.itemSearchEl = null;
    }
    // ★SW-BJ81 规格⑤残留处置定谳:关面板【不动光标持物】——合成面板关闭惯例
    //   同款（关合成窗/modern 窗不清光标,关【背包】才由 closeInventory 的
    //   RB4a/BP1 链归还+余量落地）。搜索浮窗=背包子面板,持物落点仍由玩家放置。
    // tooltip 归位 root + 收起（面板关,气泡无锚）
    if (this.tooltipHome) {
      this.tooltipHome.appendChild(this.tooltip);
      this.tooltipHome = null;
    }
    this.tooltip.style.display = 'none';
  }

  // ============ 重铸（哥布林工匠，Main.InReforgeMenu + ReforgeItemInReforgeSlot） ============

  /** 重铸槽物品（Main.reforgeItem；关闭时归还背包=dropItemCheck reforgeItem 支
   *  Player.cs:5115-5118 GetOrDropItem——旧注 :4912 系 1456 陈锚,1457 实位 :5115）。
   *  ★BJ633：placeStyle/favorited 随行——vinv 放入=heldStack 整件展开克隆,字段域
   *  同 heldStack(:1012),回包走 returnReforgeItem 七参 add 全随行（RB4a/BP1 同族） */
  reforgeItem: { id: number; stack: number; prefix?: number; placeStyle?: number; favorited?: boolean } | null = null;
  private reforgeEl: HTMLDivElement | null = null;
  private reforgeCostEl: HTMLElement | null = null;
  private reforgeSlotEl: HTMLElement | null = null;

  /** 打开重铸面板：物品槽（放 1 件）+ 费用 + 重铸按钮。
   *  ★2026-09-09 刀 12(vanilla 原位化):vanilla 布局=直接在背包界面画重铸
   *  (Main.cs:42268-42393:槽 (50,270) ctx5/文字 (100,270)/锤 (120,310) cooldown60/
   *  储蓄 (180,258));modal 保留给 classic */
  showReforge(): void {
    if (this._builtLayout === 'vanilla') {
      this.vinvReforgeOpen = true;
      this.openInventory(true);   // 原版 NPCChatText_TinkererReforge → OpenInventory
      this.refreshAll();
      return;
    }
    this.closeReforge();
    const overlay = el('div') as HTMLDivElement;
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:1150; display:flex; align-items:center; justify-content:center;';
    const panel = el('div', 'sw-panel');
    panel.style.cssText = 'width:360px;';
    panel.appendChild(el('div', 'sw-title', '⚒ ' + Lang.inter(19)));
    const hint = el('div', 'sw-lbl', Lang.inter(20)); // 将物品放到此处重铸
    panel.appendChild(hint);
    // 槽位行：物品槽 + 费用
    const row = el('div');
    row.style.cssText = 'display:flex; align-items:center; gap:12px; margin:8px 0;';
    const slot = el('div', 'sw-slot');
    slot.style.cssText += 'width:52px; height:52px;';
    slot.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (this.heldStack) {
        // 放入 1 件（ItemSlot :757-764：reforgeItem = item.Clone() stack=1）
        // ★R15-F17（2026-10-11 C15 清偿,自造面最小化收口①）：favorited/placeStyle
        //   随行——原版 Item.Clone() 全字段复制（Item.cs Clone 深拷贝）,旧字面量
        //   {id,stack,prefix} 丢 placeStyle（块/墙类放置样式随行断链,回包走
        //   returnReforgeItem 七参 add 全随行=回包端已备,放置端断喂）与 favorited
        //   （Swap 臂 Utils.Swap 双向骑行收藏旗）。占槽 swap 面维持登记（自造面,
        //   vanilla case 1 :1008-1046 占槽+持物=互换;此处 return 不动=偏差留档）。
        if (this.reforgeItem) return;
        if (!this.game.canReforge(this.heldStack)) { this.toast(Lang.text('Mods.SandboxWorld.Reforge.CannotReforge')); return; }
        this.reforgeItem = {
          id: this.heldStack.id, stack: 1, prefix: this.heldStack.prefix,
          placeStyle: (this.heldStack as { placeStyle?: number }).placeStyle,
          favorited: (this.heldStack as { favorited?: boolean }).favorited,
        };
        this.heldStack.stack -= 1;
        if (this.heldStack.stack <= 0) this.heldStack = null;
      } else if (this.reforgeItem) {
        // 取回
        this.heldStack = this.reforgeItem;
        this.reforgeItem = null;
      }
      this.refreshReforge();
    });
    slot.addEventListener('mouseenter', () => {
      if (this.reforgeItem) this.showReforgeTooltip();
    });
    slot.addEventListener('mouseleave', () => (this.tooltip.style.display = 'none'));
    this.reforgeSlotEl = slot;
    row.appendChild(slot);
    const costWrap = el('div');
    this.reforgeCostEl = el('div', '', '');
    this.reforgeCostEl.style.cssText = 'font-size:13px; color:#ffe8a0;';
    costWrap.appendChild(this.reforgeCostEl);
    row.appendChild(costWrap);
    panel.appendChild(row);
    const doBtn = el('button', 'sw-btn', Lang.inter(19));
    doBtn.addEventListener('mouseleave', () => { this.vinvReforgeCooldownUntil = 0; });   // 离钮清冷(:42279)
    doBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (!this.reforgeItem) return;
      if (performance.now() < this.vinvReforgeCooldownUntil) return;   // 最优档掷中后 60t 锁(:42370)
      const cost = this.game.reforgeCost(this.reforgeItem);
      // ★BJ165③ 登记维持（2026-09-20 复锚）：钱不足=原版【静默】（Main.cs:42346
      //  BuyItem 假→无文案/无音效;vinv 锤击面同相静默）——本 toast=classic modal
      //  自创 fallback UI（modal 本身=登记自创面）,偏差维持不修
      if (this.game.coinsOwned() < cost) {
        this.toast(Lang.text('Mods.SandboxWorld.Reforge.TooExpensive', Lang.inter(46)));
        return;
      }
      const out = { topTier: false };
      const np = this.game.doReforge(this.reforgeItem, out);
      if (np < 0) { this.toast(Lang.text('Mods.SandboxWorld.Reforge.Fail')); return; }
      if (out.topTier) this.vinvReforgeCooldownUntil = performance.now() + 1000;   // 仅最优档(:42626)
      // 重铸反馈 = PopupText.NewText(ItemReforge/_Best,…,noStack:true)（Main.cs:42622,
      // AffixName 飘字单源 showPickupLabel）;旧「花费: N · 前缀」toast=自创面退役
      // （费用原版恒走常驻币制分解行 :42288-42322,无重铸后费用提示）
      const rdef = ITEM_DEFS[this.reforgeItem.id];
      // ★SW-N4（2026-09-20）：飘字色=词缀档位移后 rare（Main.cs:42622 → PrepareEffects
      //  PopupText.cs:388-404 Rarity=newItem.rare 字段值,Item.Prefix :588-614 已烘入
      //  位移）——BJ125 单源链 tooltipRareOf 产物（forPopup=跳过④ MouseText −12 覆写）;
      //  基表读法=神级迷你鲨 2 档绿伪影（BJ165 登记债,本刀清偿;变异哨
      //  tests/sw-n4-reforge-popup-rare.test.ts 传基表→红）
      if (rdef) this.game.showPickupLabel(rdef.key, this.reforgeItem.stack, np,
        this.tooltipRareOf(rdef, np, { forPopup: true }));
      this.refreshReforge();
    });
    panel.appendChild(doBtn);
    const closeBtn = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.UI.Close'));
    closeBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.closeReforge();
    });
    panel.appendChild(closeBtn);
    overlay.appendChild(panel);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === e.currentTarget) this.closeReforge();
    });
    document.body.appendChild(overlay);
    this.reforgeEl = overlay;
    this.refreshReforge();
  }

  private refreshReforge(): void {
    if (!this.reforgeSlotEl) return;
    // 画槽内容
    const old = this.reforgeSlotEl.querySelector('img');
    old?.remove();
    this.reforgeSlotEl.querySelector('.cnt')?.remove();
    if (this.reforgeItem) {
      const img = el('img') as HTMLImageElement;
      img.src = iconUrl(this.game, this.reforgeItem.id);
      img.draggable = false;
      this.reforgeSlotEl.appendChild(img);
    }
    // 费用行（Main.cs:41026：value×stack÷3）
    if (this.reforgeCostEl) {
      if (this.reforgeItem) {
        const cost = this.game.reforgeCost(this.reforgeItem);
        const owned = this.game.coinsOwned();
        this.reforgeCostEl.textContent = `${Lang.inter(46)}: ${formatCopper(cost)}` + (owned < cost ? Lang.text('Mods.SandboxWorld.Reforge.CostShortParen') : '');
        this.reforgeCostEl.style.color = owned < cost ? '#e08a8a' : '#ffe8a0';
      } else {
        this.reforgeCostEl.textContent = '';
      }
    }
    this.refreshAll();
  }

  /** 重铸槽 tooltip（ctx5,classic modal 槽 ∪ vinv 槽两入口）。★BJ407（2026-09-29）：
   *  内容装配单源委托 buildTooltipHtml——原版重铸槽悬停=与物品栏同一 MouseText
   *  管线（Main.cs:42389-42391 ItemSlot.Handle/Draw(ref reforgeItem, 5) →
   *  ItemSlot.MouseHover :3168-3190 → MouseText_DrawItemTooltip;context 5 无特化）,
   *  行集与物品栏同物全等（饰品含静态 ItemTooltip 行/可装备/材料/62-80 前缀差分行;
   *  旧自装「名行+prefixLines」贫面两层缺=BJ407 病灶,锚见 buildTooltipHtml 头注）。
   *  词缀档位移名色经 tooltipRareOf 同链保持（SW-BJ116-b 面零变化,where='inv' 无
   *  wornArmor/social/buy 特化=ctx5 同相）。定位/烘底序=SW-TT1 同族②（清位→量宽→
   *  钳制→终布局后烘底,BJ176 三面哨兵锁定本方法体）。★BJ407 债（2026-09-30）：
   *  脉冲面与物品栏同相挂线——重铸槽悬停=同一 MouseText 管线（Main.cs:42389-42391
   *  →MouseText_DrawItemTooltip 每帧重绘 + DoUpdate_AnimateCursorColors :18064-18075
   *  mouseTextColor 190↔255 亮度脉冲）,startTooltipPulse 承载该逐帧面（含 −12 disco/
   *  −13 master 活色档 .sw-tooltip-rare 逐帧重染）;曾缺=重铸槽 tooltip 静止死色 */
  private showReforgeTooltip(): void {
    const s = this.reforgeItem;
    if (!s) return;
    this.tooltip.innerHTML = this.buildTooltipHtml({ id: s.id, stack: s.stack, prefix: s.prefix }, 'inv', -1);
    this.tooltip.style.display = 'block';
    this.tooltipFollowsCursor = false;   // ★BJ669e2：元素锚路径=不进 mousemove 跟随臂
    this.startTooltipPulse();   // ★BJ407：与 showTooltipFor 同序（innerHTML 后挂帧驱动）
    // ★SW-TT1 同族②（2026-09-19 实报「重铸格 tooltip 背景平铺成多块气泡」）：本路径
    //   此前从不烘底——元素一直带着上一次物品气泡的固有尺寸底图，重铸文本更宽时
    //   默认 repeat 整面平铺 = 多块气泡贴图；旧 left 约束挤窄量测同族。统一走
    //   清位 → 量自然宽 → 定位钳制 → 终布局后烘底（与 showTooltipFor 同序）
    this.tooltip.style.left = '0px';
    this.tooltip.style.top = '0px';
    // 锚 = classic 槽 ?? vinv 槽（vinv 布局重铸槽此前无锚=气泡落在残留坐标）
    const anchorEl = this.reforgeSlotEl ?? this.vinvReforgeSlotEl;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
      let left = r.right + 8, top = r.top;
      if (left + tw > window.innerWidth - 18) left = Math.max(0, window.innerWidth - tw - 18);
      if (top + th > window.innerHeight - 18) top = Math.max(0, window.innerHeight - th - 18);
      this.tooltip.style.left = `${left}px`;
      this.tooltip.style.top = `${top}px`;
    }
    this.applyTooltipBg();
  }

  closeReforge(): void {
    // 归还重铸槽物品（dropItemCheck reforgeItem 支 Player.cs:5115-5118 GetOrDropItem
    // ——旧注 :4912 陈锚）。★BJ633：单源 returnReforgeItem——顺带补满包余量落地
    // （GetOrDropItem=GetItem 回包+余量 RequestNewItem(base.Center) :7197-7204;
    //   旧裸 inv.add 三参满包余量静默吞=物损方向）+favorited/placeStyle 随行
    this.returnReforgeItem();
    if (this.reforgeEl) {
      this.reforgeEl.remove();
      this.reforgeEl = null;
    }
    this.reforgeSlotEl = null;
    this.refreshAll();
  }

  /** 重铸槽物品归还单源（★BJ633 2026-10-10 用户实报「重铸槽吞装备,不取下来直接退出
   *  重铸页面的话装备会留在哥布林那里」）。原版锚=Player.dropItemCheck reforgeItem 支
   *  （Player.cs:5115-5118:!Main.InReforgeMenu ∧ Main.reforgeItem.type>0 →
   *  GetOrDropItem(Main.reforgeItem, GetItemSettings.ReturnItemFromSlot)+reforgeItem
   *  =new Item()）——GetItem 回包,余量 RequestNewItem(base.Center) 玩家中心落地
   *  （Player.cs:7197-7204,InventoryOverflow 源,词缀随行）。触发面三族:
   *  ①每拍兜底 Player.Update :25411 / 界面帧 Main.cs:17550(playerInventory);
   *  ②强制退出臂同帧直调 Main.cs:42275-42288(开箱/开店/走远 talkNPC==-1/向导态 →
   *    InReforgeMenu=false 后紧跟 dropItemCheck);
   *  ③关包链 Main.cs:46438-46447 !playerInventory → InReforgeMenu=false → 下拍①。
   *  本仓断点=vinv 面三退出点只清 vinvReforgeOpen 不归还(:10900 旧注「reforgeItem
   *  不清=原版静态量同相」系误读:静态的是字段槽位,内容被 dropItemCheck 即时消费
   *  ——退出当拍即回包)+closeReforge 满包余量静默吞。消费面=closeInventory(vanilla
   *  关包臂)/vinvGuideMenuExitCheck(退出臂)/openChestPanel(vanilla 臂)/closeReforge。
   *  closeAll 不归还=原版 ClearPlayerTempInfo TurnToAir 同相(Player.cs:55706-55711
   *  ——原版正常流到此槽已空:全部在-game 退出面先行回包;存档持久面
   *  SaveTemporaryItemSlotContents bitsByte[3] :55595-55617 本仓不建模=登记债,
   *  与 guideItem bitsByte[2] 同族)。vinvReturnGuidePlaced ★SW-RB29c F3 同式 */
  private returnReforgeItem(): void {
    const r = this.reforgeItem;
    if (r && this.game?.player) {
      const left = this.game.player.inv.add(r.id, r.stack, r.prefix, r.placeStyle, false, false, !!r.favorited);
      if (left > 0) {
        const key = ITEM_DEFS[r.id]?.key ?? '';
        // ★BJ390：余量词缀随行（Player.cs:7200-7202 RequestNewItem(item2.prefix) 同域）
        this.game.spawnDrop(this.game.player.cx, this.game.player.cy, key, left, undefined, undefined, r.placeStyle, r.prefix);
      }
      this.game.cb?.onInventoryChanged?.();
    }
    this.reforgeItem = null;
  }

  // ============ 向导配方反查（guideItem → CollectGuideRecipes，组匹配生效） ============

  private guideEl: HTMLDivElement | null = null;
  /** ★SW-AY1 R5 反查面板刷新钩子（openGuideSearch 内注入 changed 闭包,关闭即清）
   *  ——Shift 对换支改 guidePlaced 后由 shiftGuideSwap 触发面板即刻重刷 */
  private guideRefresh: (() => void) | null = null;
  /** Esc 关闭监听（openGuideSearch 挂载/closeGuideSearch 对称摘除） */
  private guideEscHandler: ((e: KeyboardEvent) => void) | null = null;
  /** 手持材料「光标幽灵」（canvas 手持绘制层级低于 DOM 面板——进入反查浮层会看不见
   *  拿着什么、误以为放不进去。DOM 影子只在浮层开启期间存在，z1300>面板1200） */
  private guideGhostEl: HTMLDivElement | null = null;
  private guideGhostMove: ((e: MouseEvent) => void) | null = null;
  /** 图标补图轮询句柄（面板关闭即停） */
  private guideIconTicker: ReturnType<typeof setInterval> | null = null;
  /** 向导反查物理材料槽（Main.guideItem 等价）：放置期间真实持有整组物品，
   *  空手点槽取回、关闭浮层自动归还（NewCraftingUI dropItemCheck 语义）。 */
  /** ★SW-BM1 2026-09-06：增 prefix 位——向导材料槽对换/取回全程保词缀。
   *  ★SW-RB5a 2026-09-07：增 favorited 位——仅 Shift 对换支（裸 Utils.Swap）双向骑行;
   *  左键支（MouseItemSwap 语义,context 7 不在 retainFavoriteOnMoveAt）不置位=双端清 */
  private guidePlaced: { id: number; stack: number; prefix?: number; favorited?: boolean; placeStyle?: number } | null = null;
  /** 反查面板：搜物品 → 列出以它为材料的全部配方（含 RecipeGroup 成员） */
  openGuideSearch(): void {
    this.closeGuideSearch();
    const overlay = el('div') as HTMLDivElement;
    overlay.className = 'sw-guide-overlay';   // 稳定标识（探针/脚本定点清理用）
    // ★容器纯定位层 + 鼠标穿透；面板停靠右上（原版合成窗方位，让开左侧背包）——
    //   playerInventory=true 的本意就是背包与反查同屏交互（用户二轮实报后定案形态）
    overlay.style.cssText = 'position:fixed; inset:0; z-index:1200; pointer-events:none;';
    const panel = el('div');
    panel.style.cssText = 'position:absolute; right:16px; top:88px;'
      + 'width:520px; max-width:min(520px, calc(100vw - 32px));'
      + 'max-height:calc(100vh - 128px); background:#2a2a35; border:2px solid #6b6b8a; border-radius:6px;'
      + 'padding:10px; display:flex; flex-direction:column; gap:8px;'
      + 'box-shadow:0 8px 40px rgba(0,0,0,.55); pointer-events:auto;';
    // ---- 头行：材料槽(实体格) + caption + 关闭（Main.cs:441-447 同位）----
    const slotRow = el('div');
    slotRow.style.cssText = 'display:flex; align-items:center; gap:10px;';
    const vidOfItem = (iid: number): number => {
      const def = ITEM_DEFS[iid];
      const m = def && /^vi_(\d+)_/.exec(def.key);
      return m ? Number(m[1]) : -1;
    };
    const itemNameOfVid = (vid: number): string => {
      const k = VANILLA_ITEM_KEY_BY_ID[vid];
      return (k && Lang.itemNameByKey(k)) || String(vid);
    };
    const slotBox = el('div', 'sw-guide-slot');
    const slotCaption = el('div');
    slotCaption.style.cssText = 'flex:1; color:#e8e8f4; font-size:13px; line-height:1.5;';
    slotBox.title = Lang.inter(24);
    // ★②槽 chrome 1:1（2026-09-14 用户报「虚线框自创」）：Inventory_Back 底图 + 空态
    //   ctx7 幽灵帧（ItemSlot.Draw :2451-2482 case7→num15=18,0.35α,32px 槽心居中）。
    //   原版 ctx7 槽底贴图 = InventoryBack4（:2204）,按用户拍板用 Inventory_Back 与
    //   vinv 两槽同 chrome（登记差异）。旧 2px dashed 自创描边/纯色底退役
    slotBox.style.cssText = 'width:56px; height:56px; flex:none; position:relative; display:flex;'
      + 'align-items:center; justify-content:center;'
      + 'background:url(sprites/vanilla/Inventory_Back.png) 0 0 / 100% 100%;'
      + 'cursor:pointer; image-rendering:pixelated;';
    const closeBtn = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.UI.Close'));
    closeBtn.style.cssText = 'cursor:pointer; width:auto; margin:0;';
    closeBtn.addEventListener('click', () => this.closeGuideSearch());
    slotRow.appendChild(slotBox);
    slotRow.appendChild(slotCaption);
    slotRow.appendChild(closeBtn);
    panel.appendChild(slotRow);
    // ---- 配方名筛选（对齐 Modern 合成窗自带按名筛列——非“选材料”网格）----
    const filterInput = el('input') as HTMLInputElement;
    filterInput.placeholder = '筛选配方名…';
    filterInput.style.cssText = 'width:100%; box-sizing:border-box; padding:5px 8px; background:#1a1a22; color:#eee; border:1px solid #555; border-radius:4px; font-size:12px;';
    panel.appendChild(filterInput);
    let filterQ = '';
    const recipeList = el('div');
    recipeList.style.cssText = 'overflow-y:auto; flex:1; min-height:140px;';
    panel.appendChild(recipeList);
    overlay.appendChild(panel);
    // 行卡/幽灵样式（幂等注入一次）
    if (!document.getElementById('sw-guide-style')) {
      const st = document.createElement('style');
      st.id = 'sw-guide-style';
      st.textContent = [
        '.sw-guide-overlay .sw-recipe{display:flex;align-items:center;gap:8px;padding:4px 8px;'
          + 'border-radius:4px;background:#232030;border:1px solid #3a3350;margin-bottom:4px;}',
        '.sw-guide-overlay .sw-recipe:hover{background:#34406e;border-color:#5566a0;}',
        '.sw-guide-overlay .sw-recipe.no{opacity:.45;}',
        '.sw-guide-overlay .sw-recipe.no:hover{background:#232030;border-color:#3a3350;}',
        '.sw-guide-overlay .sw-recipe>img.prod{width:28px;height:28px;image-rendering:pixelated;flex:none;}',
        '.sw-guide-overlay .sw-recipe .g-nm{font-size:13px;color:#e8ecf8;white-space:nowrap;}',
        '.sw-guide-overlay .sw-recipe .g-qty{color:#ffd76e;margin-left:4px;}',
        '.sw-guide-overlay .sw-recipe .g-req{margin-left:auto;color:#9a8ab8;font-size:11px;text-align:right;max-width:46%;line-height:1.5;}',
        '.sw-guide-overlay .sw-recipe>img.g-noicon{position:relative;background:#3b3550;border:1px solid #55506a;color:#cfc7ee;font-size:14px;font-weight:bold;display:flex;align-items:center;justify-content:center;}',
        '#sw-held-ghost{position:fixed;z-index:1300;width:32px;height:32px;pointer-events:none;'
          + 'image-rendering:pixelated;filter:drop-shadow(0 0 4px rgba(0,0,0,.8));}'
        + '#sw-held-ghost .n{position:absolute;right:-2px;bottom:-4px;font-size:12px;color:#fff;'
        + 'text-shadow:1px 1px 0 #000;}',
      ].join('\n');
      document.head.appendChild(st);
    }
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.guideEl = overlay;
    this.guideEscHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') this.closeGuideSearch();
    };
    window.addEventListener('keydown', this.guideEscHandler);
    // ---- 槽位驱动（guideItem 变化 → ResetRecipes 即刻刷新，NewCraftingUI 同义）----
    const refreshHeader = () => {
      slotBox.textContent = '';
      if (this.guidePlaced) {
        const img = el('img') as HTMLImageElement;
        img.src = iconUrl(this.game!, this.guidePlaced.id) || '';
        img.style.cssText = 'max-width:46px; max-height:46px; image-rendering:pixelated;';
        img.draggable = false;
        slotBox.appendChild(img);
        slotCaption.textContent = `${Lang.inter(21)} ${itemNameOfVid(this.vidOfItemOf(this.guidePlaced.id))} ×${this.guidePlaced.stack}`;
      } else {
        slotBox.appendChild(makeSlotGhostEl(GUIDE_SLOT_GHOST_FRAME));   // 空态 ctx7 幽灵帧（:2451 case7→num15=18）
        slotCaption.textContent = Lang.inter(24);   // 「在此放置材料」
      }
    };
    /** 取回放置组回背包（溢出→脚下掉落；CloseNPCChatOrSign 出口等价）。
     *  ★SW-BP1 2026-09-07（RB4a 债④ / RB5a 债②）：①favorited 随行（GetOrDropItem
     *  (Main.guideItem) Player.cs:5112-5114 → GetItem 整 Item 对象回包 :39873,
     *  RB5a 对换先行批已让 guidePlaced 携带 favorited,本刀接 add 通道）；
     *  ②余量落点 p.y→p.cy（GetOrDropItem 尾 RequestNewItem(base.Center)
     *  :7200-7202=玩家中心） */
    const takeBackPlaced = (): void => {
      const pl = this.guidePlaced;
      if (!pl || !this.game) return;
      const left = this.game.player.inv.add(pl.id, pl.stack, pl.prefix, pl.placeStyle, false, false, !!pl.favorited);   // ★SW-BM1 随行词缀 + ★SW-RB5a 实例样式随行 + ★SW-BP1 收藏随行
      if (left > 0) {
        const key = ITEM_DEFS[pl.id]?.key ?? '';
        // ★BJ390：余量词缀随行（:7200-7202 同域）
        this.game.spawnDrop(this.game.player.cx, this.game.player.cy, key, left, undefined, undefined, undefined, pl.prefix);
      }
      this.game.cb.onInventoryChanged?.();
      this.guidePlaced = null;
    };
    // ---- 点击语义 = ItemSlot.cs 对 context7 的通用处理 1:1 ----
    //   放置门(:1502 checkItem.material——本仓以配方原料反查集近似,itemTooltip 注)
    //   左键(PickAction=0 整组迁移)：空手取整组 / 手持→空槽整组 / 同型合并至槽
    //   maxStack / 异型双方皆材料则 SwapItem 对换；右键(RightClick 尾段单枚机)：
    //   每击移动 1 枚（空手取 1 / 手持同型放 1；满格或异型不动）。取→Grab(7)、
    //   右键动一枚→MenuTick(12)、左键放置原版无音效（:920-960 区间零 PlaySound）
    // ★SW-BJ24 2026-09-07：旧式 `vidOfItem(vid) >= 0` 把 vid 误当 ITEM_DEFS 下标二次
    //  解析（ITEM_DEFS 前 610 手写件后接 678 place_ 件——vid∈[610,1288) 整带解析到
    //  place_ 键恒 -1,带内 200 个原料 vid 全误拒：真·圣剑 674/真·永夜之刃 675/
    //  Terra Blade 757/钛金锭 1198/钯金矿 1104/暗影木·红木·珍珠木 619-621/
    //  锡铅钨铂矿锭 699-706——用户实报「武器有时放不了」根因）。原版门 =
    //  checkItem.material（ItemSlot.cs:1502-1507,1458 同式 :1502-1504）,手持件 vid
    //  域直查 materialVids() 即可;mod 件（vidOfItem=-1）维持拒（原版无此域）。
    //  ★同批：材料池双域分池（itemTooltip 注）——旧并集池被 iid 碰撞污染
    //  （钉鞋 975 是原料且内部 iid=24 ⇒ has(24) 假真 ⇒ 木剑 24 误过门）。
    const isMaterialVid = (vid: number): boolean => vid >= 0 && materialVids().has(vid);
    const maxStackOf = (iid: number): number => ITEM_DEFS[iid]?.maxStack ?? 999;
    // ★S4：悬停 tooltip（ItemSlot.Handle(ref guideItem,7) → MouseHover → HoverItem
    //  → MouseText 全载荷,Main.cs:42409-42413;重铸槽同族绑定式,见 refreshGuideSlotTooltip）
    slotBox.addEventListener('mouseenter', () => this.refreshGuideSlotTooltip(slotBox));
    slotBox.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
    });
    slotBox.addEventListener('mousedown', (e) => {
      this.guideSlotMouseDown(e as MouseEvent, () => {
        refreshHeader(); renderRecipes(); applyFilter();
        this.refreshGuideSlotTooltip(slotBox);   // ★S4：换件随拍（原版逐帧 tooltip 语义）
      });
    });
    slotBox.addEventListener('contextmenu', (e) => e.preventDefault());
    filterInput.addEventListener('input', (e) => {
      filterQ = (e.currentTarget as HTMLInputElement).value.trim().toLowerCase();
      applyFilter();
    });
    const applyFilter = (): void => {
      for (const row of Array.from(recipeList.querySelectorAll('.sw-recipe'))) {
        (row as HTMLElement).style.display =
          !filterQ || (row.textContent || '').toLowerCase().includes(filterQ) ? '' : 'none';
      }
    };
    const renderRecipes = (): void => {
      recipeList.textContent = '';
      filterInput.value = ''; filterQ = '';
      const vid = this.guidePlaced ? this.vidOfItemOf(this.guidePlaced.id) : null;
      if (vid != null && vid >= 0) this.renderGuideRecipes(recipeList, vid);
    };
    // ---- 图标补图升级器（面板级有界轮询；结构渲染仍由 renderRecipes 承担）----
    const upgradeIcons = (): void => {
      for (const im of Array.from(recipeList.querySelectorAll<HTMLImageElement>('img.prod'))) {
        if (im.dataset.done === '1') continue;
        const key = im.dataset.key ?? '';
        const iid = ITEM_BY_KEY[key];
        const url = this.game && iid !== undefined ? iconUrl(this.game, iid) : '';
        if (url) {
          im.src = url;
          im.classList.remove('g-noicon');
          im.dataset.done = '1';
        } else if (!im.classList.contains('g-noicon')) {
          im.classList.add('g-noicon');       // 首字占位方块，绝不空白破框
          im.dataset.letter = (Lang.itemNameByKey(key) ?? '?')[0] ?? '?';
          im.alt = im.dataset.letter;
        }
      }
    };
    refreshHeader();                                       // ★曾随 v3 重写丢失：初态 caption 恒空
    if (this.guideIconTicker) clearInterval(this.guideIconTicker);
    upgradeIcons();
    let iconTries = 0;
    this.guideIconTicker = setInterval(() => {
      if (!this.guideEl || ++iconTries > 12) { clearInterval(this.guideIconTicker!); this.guideIconTicker = null; return; }
      upgradeIcons();
    }, 500);
    renderRecipes();
    upgradeIcons();
    // ---- 光标幽灵：mousemove 全局尾随；仅在指针位于浮层面板矩形内且手持非空时显形 ----
    if (!this.guideGhostEl) {
      const ghost = el('div') as HTMLDivElement;
      ghost.id = 'sw-held-ghost';
      ghost.style.display = 'none';
      document.body.appendChild(ghost);
      this.guideGhostEl = ghost;
    }
    this.guideGhostMove = (e: MouseEvent) => {
      const ghost = this.guideGhostEl;
      const hs = this.heldStack;
      if (!ghost) return;
      // ★原版手感对齐：canvas 手持绘制恒在最上层跟随——DOM 影子不做任何区域门，
      //   手持期间全屏尾随（否则指向面板的路程中物品“消失”，误以为放不进去）
      if (!hs || hs.stack <= 0) { ghost.style.display = 'none'; return; }
      const iid = hs.id;
      if (ghost.dataset.iid !== String(iid)) {
        ghost.dataset.iid = String(iid);
        ghost.textContent = '';
        const img = document.createElement('img');
        img.src = iconUrl(this.game!, iid) || '';
        img.style.cssText = 'width:32px;height:32px;image-rendering:pixelated;display:block;';
        img.draggable = false;
        ghost.appendChild(img);
        if (hs.stack > 1) {
          const n = document.createElement('span');
          n.className = 'n';
          n.textContent = String(hs.stack);
          ghost.appendChild(n);
        }
      }
      // ★SW-BI1 2026-09-06：非空断言改空守卫（同 refreshCrafting 防御计数器注，
      //  本通道同在 refreshAll 逐帧刷——ghost 内 .n 缺失即空指针刷屏）
      const ghostN = ghost.querySelector('.n');
      if (ghostN) ghostN.textContent = String(hs.stack);
      ghost.style.display = 'block';
      ghost.style.left = `${e.clientX + 10}px`;
      ghost.style.top = `${e.clientY + 8}px`;
    };
    window.addEventListener('mousemove', this.guideGhostMove);
  }

  /** ★刀19:ctx7 槽点击语义共享体(向导反查浮层与 vanilla 布局向导槽共用;ItemSlot.cs
   *  case-0/RightClick 1:1,注释锚见原 openGuideSearch 体内迁前行)。repaint=槽态
   *  变化后的面板重刷(浮层=header/列表/筛选;vanilla=槽绘制+vinvRefreshCraft) */
  /** ★S4 向导槽悬停 tooltip（原版面：Main.cs:42409-42413 槽域悬停 →
   *  ItemSlot.Handle(ref guideItem, 7) → ItemSlot.MouseHover :3164-3190
   *  Main.HoverItem=Clone+tooltipContext 7（context 7 不在 wornArmor/social/buy
   *  置位 switch=无特化旗）→ MouseText 全载荷 GetLinesInfo——与背包/重铸槽同一
   *  tooltip 管线;空槽悬停零提示（context 7 不在空槽文案分支,MouseHover :3176
   *  空槽早退臂）。本仓三面槽实例（classic 覆层/vinv 经典位/vinv modern 窗位）
   *  此前零悬停 tooltip=本刀主债。绑定式 = 重铸槽同族先例（mouseenter 有件即显/
   *  mousedown 换件随拍/leave 收,reforge 槽 :4093-4095）——原版逐帧刷新语义在
   *  DOM 域的既有等价 */
  private refreshGuideSlotTooltip(slotEl: HTMLElement | null): void {
    if (!slotEl || !slotEl.matches(':hover')) return;   // 非悬停拍不管（leave 通道管收）
    const pl = this.guidePlaced;
    if (!pl) {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
      return;
    }
    this.showTooltipFor(pl.id, 'inv', {
      slot: {
        id: pl.id, stack: pl.stack,
        ...(pl.prefix !== undefined ? { prefix: pl.prefix } : {}),
        ...(pl.favorited ? { favorited: true } : {}),
      },
      anchor: slotEl,
    });
  }

  private guideSlotMouseDown(e: MouseEvent, repaint: () => void): void {
    e.preventDefault();
    e.stopPropagation();
    const cur = this.heldStack;
    const pl = this.guidePlaced;
    let action: 'none' | 'take' | 'move' = 'none';
    const isMaterialVid = (vid: number): boolean => vid >= 0 && materialVids().has(vid);
    const maxStackOf = (iid: number): number => ITEM_DEFS[iid]?.maxStack ?? 999;
    this.guideRefresh = repaint;   // ★SW-AY1 R5：Shift 对换支（shiftGuideSwap）同刷面板
    if (cur && !isMaterialVid(this.vidOfItemOf(cur.id))) return;   // 放置门不过=原样拒
    if (e.button === 0) {
      if (!cur && pl) {                                            // 空手 → 取整组
        const hadPrefix = (pl as { prefix?: number }).prefix;
        this.heldStack = { id: pl.id, stack: pl.stack,
          ...(hadPrefix !== undefined ? { prefix: hadPrefix } : {}),
          ...(pl.placeStyle !== undefined ? { placeStyle: pl.placeStyle } : {}) };   // ★SW-RB5a 实例样式随行
        this.guidePlaced = null;
        this.game?.sfx.play('pickup');                             // SoundID.Grab(7)
        action = 'take';
      } else if (cur && !pl && isMaterialVid(this.vidOfItemOf(cur.id))) { // 手持 → 空槽整组
        this.guidePlaced = { id: cur.id, stack: cur.stack,
          ...(cur.prefix !== undefined ? { prefix: cur.prefix } : {}),   // ★SW-BM1 保词缀
          ...(cur.placeStyle !== undefined ? { placeStyle: cur.placeStyle } : {}) };   // ★SW-RB5a 实例样式随行
        this.heldStack = null;
        this.game?.sfx.play('pickup');                             // ★SW-RB5a：case 0 尾奏 SoundID 7（ItemSlot.cs:986-988）
        action = 'move';
      } else if (cur && pl) {
        // ★SW-RB5a 2026-09-07 case 0 1:1（ItemSlot.cs:912 MouseItemSwap 先行 +
        //  :968-985 CanStack 并回）：槽↔手整体对换后,同型同词缀（CanStack,
        //  Item.cs:49870-49877 prefix 相等臂）且双方未满才并回——旧实现「同 vid
        //  即并」漏词缀臂（异词缀同型物并堆=词缀丢失数据面）且槽满时 no-op
        //  （原版=纯对换）;对换不再要求槽内件是材料（vanilla 只门手持侧
        //  checkItem.material,PickItemMovementAction context 7 :1478-1481）。
        //  MouseItemSwap 双端清收藏（context 7 不在 retainFavoriteOnMoveAt
        //  :362-366）——对换产物不带 favorited
        const oldPl = { id: pl.id, stack: pl.stack,
          ...(pl.prefix !== undefined ? { prefix: pl.prefix } : {}),
          ...(pl.placeStyle !== undefined ? { placeStyle: pl.placeStyle } : {}) };
        this.guidePlaced = { id: cur.id, stack: cur.stack,
          ...(cur.prefix !== undefined ? { prefix: cur.prefix } : {}),
          ...(cur.placeStyle !== undefined ? { placeStyle: cur.placeStyle } : {}) };
        this.heldStack = oldPl;
        const cap = maxStackOf(pl.id);
        if (canMergeStack(cur, pl) && cur.stack !== cap && pl.stack !== cap) {
          if (pl.stack + cur.stack <= cap) {
            this.guidePlaced!.stack = pl.stack + cur.stack;        // 槽吸收手持原堆,手清空
            this.heldStack = null;
          } else {
            const mv = cap - cur.stack;                            // num2 = maxStack − 对换后槽内堆
            this.guidePlaced!.stack = cur.stack + mv;
            this.heldStack!.stack = pl.stack - mv;                 // 余量留手
          }
        }
        this.game?.sfx.play('pickup');                             // case 0 尾奏 SoundID 7（:988）
        action = 'move';
      }
    } else if (e.button === 2) {
      if (!cur && pl && pl.stack > 0) {                            // 空手右键 = 取 1
        const one: { id: number; stack: number; prefix?: number } = { id: pl.id, stack: 1 };
        const pref = (pl as { prefix?: number }).prefix;
        if (pref !== undefined) one.prefix = pref;
        this.heldStack = one;
        pl.stack -= 1;
        if (pl.stack <= 0) this.guidePlaced = null;
        UISfx.click();                                             // RightClick 内 PlaySound(12)
        action = 'take';
      } else if (cur && pl && canMergeStack(cur, pl)               // ★SW-RB5a：CanStack 词缀面（:1639）
        && cur.stack < maxStackOf(cur.id) && pl.stack > 0) {       // 手持同型不满 → 放 1
        pl.stack += 1; cur.stack -= 1;
        if (cur.stack <= 0) this.heldStack = null;
        UISfx.click();
        action = 'move';
      }
    }
    if (action !== 'none') {
      repaint();
      if (this.guideGhostMove) this.guideGhostMove(e as unknown as MouseEvent);   // 立即重算影子显隐(浮层面)
    }
  }

  /** 材料的配方列表（CollectGuideRecipes：items 直接命中或 RecipeGroup 成员命中） */
  private renderGuideRecipes(listEl: HTMLElement, vid: number): void {
    listEl.dataset.vid = String(vid);
    listEl.textContent = '';
    const game = this.game;
    let hits = 0;
    for (const r of VANILLA_RECIPES) {
      const used = r.items.some((req) => req.id === vid
        || (req.id >= 1000000 && (RECIPE_GROUP_ITEMS[String(req.id - 1000000)] ?? []).includes(vid)));
      if (!used) continue;
      if (++hits > 60) { listEl.appendChild(el('div', 'sw-lbl', '…更多结果请细化')); break; }
      const outKey = vanillaItemKey(r.create);
      if (!outKey) continue;
      // ★原版反查列表全亮：CollectGuideRecipes（Recipe.cs:441）不做环境/材料
      //   过滤就入列——常规列表的“缺料变灰”逻辑不适用于本面板（用户截图实锤：
      //   满包木材站徒手前仍全灰=把两套语义混了）。点击仍经 vanillaCraft 材料门，
      //   不可合成时静默无效=原版同款表现
      const row = el('div', 'sw-recipe');
      const outIid = game.itemId(outKey);
      const img = el('img') as HTMLImageElement;
      img.className = 'prod';
      img.dataset.key = outKey;
      const u0 = outIid !== undefined && outIid >= 0 ? iconUrl(game, outIid) : '';
      if (u0) { img.src = u0; img.dataset.done = '1'; }   // 热态即出图；冷态走面板级补图轮询
      img.draggable = false;
      row.appendChild(img);
      const label = el('span', 'g-nm', Lang.itemNameByKey(outKey) || outKey);
      row.appendChild(label);
      if (r.createStack > 1) {
        const qty = el('span', 'g-qty', `×${r.createStack}`);
        row.appendChild(qty);
      }
      const info = el('span', 'g-req', `${r.tile >= 0 ? (Lang.tileName(r.tile) ?? `站点 ${r.tile}`) : Lang.text('Mods.SandboxWorld.UI.StationHand')} · ${
        r.items.map((req) => `${req.id >= 1000000 ? '任何组物' : (Lang.itemNameByKey(ingredientKey(req.id) ?? '') ?? req.id)} ${req.stack}`).join(' +')}`);
      row.appendChild(info);
      row.onclick = () => {
        // 全行可点：不可合成时 consumeMaterials 静默无效=原版 guide 模式同款表现
        // 成品跟随光标（CraftItem_GrantItem 同款）
        game.vanillaCraft(r, 1, true);
        this.refreshAll();
      };
      listEl.appendChild(row);
    }
    if (!hits) listEl.appendChild(el('div', 'sw-lbl', '该物品不用于任何配方'));
    // 图标补图由面板级 ticker 统一驱动（upgradeGuideTicker），此函数只负责结构
  }

  closeGuideSearch(): void {
    // 光标幽灵摘除（元素+mousemove 对称回收）
    this.guideRefresh = null;   // ★SW-AY1 R5 对称摘除（面板闭后 Shift 支不再触刷新）
    if (this.guideGhostMove) {
      window.removeEventListener('mousemove', this.guideGhostMove);
      this.guideGhostMove = null;
    }
    this.guideGhostEl?.remove();
    this.guideGhostEl = null;
    // 放置中的材料自动归还（Main.CloseNPCChatOrSign → dropItemCheck 出口等价；
    // MP 下走背包 add 与 msg5 差分同链）。★SW-BP1 2026-09-07（RB4a 债④/债②）：
    // ①词缀/实例样式/收藏全随行——原版 GetOrDropItem(Main.guideItem)（Player.cs
    // :5112-5114）整 Item 对象回包（:39873 `inventory[i] = returnItem`）,曾裸
    // (id,stack)=词缀/样式件关搜索面板即洗白;②余量落点 p.y→p.cy（:7200-7202 Center）
    {
      const pl = this.guidePlaced;
      if (pl && this.game) {
        const left = this.game.player.inv.add(pl.id, pl.stack, pl.prefix, pl.placeStyle, false, false, !!pl.favorited);
        if (left > 0) {
          const key = ITEM_DEFS[pl.id]?.key ?? '';
          // ★BJ390：余量词缀随行（:7200-7202 同域）
          this.game.spawnDrop(this.game.player.cx, this.game.player.cy, key, left, undefined, undefined, undefined, pl.prefix);
        }
        this.game.cb.onInventoryChanged?.();
      }
      this.guidePlaced = null;
    }
    if (this.guideEscHandler) {
      window.removeEventListener('keydown', this.guideEscHandler);
      this.guideEscHandler = null;
    }
    if (this.guideEl) {
      this.guideEl.remove();
      this.guideEl = null;
    }
  }

  /** 垃圾桶暂存（关闭背包才删除；可取回） */
  /** @deprecated 改走 inv.trash 持久槽（Player.trashItem 语义）——保留字段仅作 UI 缓存兼容 */

  private placeTrash(): void {
    if (!this.heldStack) return;
    // 原版 Trash 槽=覆盖销毁（ItemSlot.cs:692-701：trashItem=item.Clone() 旧物直接
    // 丢弃 + TrashItem/Grab 双音）——曾做同型合并/异型交换，旧物回手上="遗弃"
    // 语义失效（2026-08-21 用户报"无法遗弃任何东西"）
    // ★SW-AU2 2026-09-06 context 6 不在 retainFavoriteOnMoveAt（:362-366）→
    //  MouseItemSwap :1230-1234 清 favorited（入桶即失收藏标记，原版同）
    // ★SW-AY1 R4b journey 研究随垃圾桶（LeftClick case 0 context 6 :909-916）：
    //  持物入桶 = 新件克隆 onlyIfFinish 献祭 + 桶内旧件整段献祭（:912 `A|B` 非短路），
    //  旧件随即 SetDefaults(0)（:916）；两支皆空才播 TrashItem（:978-981 `!flag2`）
    const oldTrash = this.game.player.inv.trash;
    let researchedNew = false;
    let researchedOld = false;
    if (this.game.world?.isJourney) {
      researchedNew = this.tryResearchIntoTrash(this.heldStack, true);
      researchedOld = oldTrash ? this.tryResearchIntoTrash(oldTrash, false) : false;
    }
    this.game.player.inv.trash = { ...this.heldStack, favorited: false };
    this.heldStack = null;
    if (!(researchedNew || researchedOld)) this.game.sfx.playFiles(['trash_item_0', 'trash_item_1'], 1);   // SoundID.TrashItem（:980）
    this.game.sfx.play('pickup', 1);                                 // SoundID 7 Grab（:982）
    this.paintTrash();
  }

  private paintTrash() {
    if (!this.trashEl) return;
    const img = this.trashEl.querySelector('img');
    const cnt = this.trashEl.querySelector('.cnt');
    img?.remove();
    cnt?.remove();
    if (this.game.player.inv.trash) {
      const im = el('img') as HTMLImageElement;
      im.src = iconUrl(this.game, this.game.player.inv.trash!.id);
      im.draggable = false;
      this.trashEl.appendChild(im);
      if (this.game.player.inv.trash!.stack > 1) {
        this.trashEl.appendChild(el('span', 'cnt', String(this.game.player.inv.trash!.stack)));
      }
    } else {
      // 空槽画垃圾桶图标（ItemSlot.cs:2514-2520：Trash.png 居中，灰半透）
      const im = el('img', 'sw-trash-icon') as HTMLImageElement;
      im.src = 'sprites/vanilla/Trash.png';
      im.draggable = false;
      this.trashEl.appendChild(im);
    }
  }

  trashEl: HTMLElement | null = null;
  /** 成就提示牌（背包内 Advisor 卡） */
  achAdvisorEl: (HTMLElement & { update(): void }) | null = null;
  /** 右下角无框坞（2026-09-02 用户要求）：装备列（配装/染料/时装/装备四列+防御计数,
   *  2026-09-07 起顶部对齐杂项列首行）
   *  与杂项/PvP 列的浮置容器——无面板底框,随背包开合显隐（open/closeInventory） */
  private eqDockEl: HTMLElement | null = null;
  /** 配饰格可见性眼睛钮（槽序 → 元素,attachVisibilityEye 登记/refreshAllNow 重刷） */
  private accEyeEls = new Map<number, HTMLElement>();
  private loadoutBtns: HTMLButtonElement[] = [];
  /** 背包侧"堆叠至附近宝箱"双钮（2026-09-02 用户要求：原单钮右键切模式拆成
   *  quick/smart 两枚并排,左键各按固定模式执行;ChestStack 帧 0/1=quick 常态/悬停、
   *  2/3=smart;开箱时隐藏） */
  private quickStackBtn!: HTMLButtonElement;
  private qsSmartBtn!: HTMLButtonElement;
  /** 道具搜索钮（🔍,簇格 2×3 末位——row 里构建,取挂,2026-09-02 移位） */
  private itemSearchBtn!: HTMLButtonElement;
  /** 图鉴钮（簇格 2×3 取挂引用） */
  private bestiaryBtn!: HTMLButtonElement;
  /** 背包网格容器（syncInvGridGeometry 写轨道用,2026-09-02） */
  private invGridEl: HTMLElement | null = null;
  /** 多人玩家列表入口（联机态显示；面板本体在 PlayerListPanel.ts） */
  private playerListBtn: HTMLButtonElement | null = null;
  /** 住房面板开合（mainFlow.openHousing/面板 onClosed 回写）——住房图标钮
   *  DisplaySlots_4(常态)/5(开) 切换用 */
  private housingOpen = false;
  private housingBtn: HTMLButtonElement | null = null;
  /** PvP 剑钮 + 6 队伍钮（DrawPVPIcons Main.cs:42074；refreshPvpButtons 刷帧/提示） */
  private pvpSwordBtn!: HTMLButtonElement;
  private pvpTeamBtns: HTMLButtonElement[] = [];
  /** 队伍/PvP 切换冷却截止（teamCooldown 300t 的墙钟等价；:42106/:42171） */
  private pvpCooldownUntil = 0;

  /** ★页签机制已拆（2026-08-27 用户要求）：装备/杂项合并为常驻左列+右缘杂项列，
   *  页签只剩 住房（覆盖层入口）/图鉴；setEquipPage/EquipPage 概念随之退役 */

  // ---- PvP/队伍快切钮行为（DrawPVPIcons Main.cs:43378-43512） ----

  /** 刷新剑帧/队伍格悬停高亮/提示文案（★BJ417 1457 帧式 :43419-43434,冷却期无提示 :43401/:43437） */
  refreshPvpButtons(): void {
    if (!this.pvpSwordBtn || !this.game?.player) return;
    const p = this.game.player;
    const cool = performance.now() < this.pvpCooldownUntil;
    const swordHover = !cool && this.pvpSwordBtn.matches(':hover');
    const [col, row] = pvpIconFrame(p.hostile, p.team);
    // background-position 百分比 = col/(2-1)、row/(7-1)（Frame(2,7) 38×38 整帧）
    this.pvpSwordBtn.style.backgroundPosition = `${col * 100}% ${(row / 6) * 100}%`;
    // 冷却调光 = 基帧 White*num4（:43426 num4=cooldown?0.25:1;悬停覆盖层满白,
    // 但 flag 门本就要求 !cool → 覆盖层显示期恒不透明,opacity 挂按钮无冲突）
    this.pvpSwordBtn.style.opacity = cool ? '0.25' : '1';
    // 悬停覆盖层 = 行 6 整帧再画一遍（:43432-43434）
    const hov = this.pvpSwordBtn.querySelector<HTMLElement>('[data-pvp-hover]');
    if (hov) {
      const [hc, hr] = pvpHoverFrame(p.hostile);
      hov.style.backgroundPosition = `${hc * 100}% ${(hr / 6) * 100}%`;
      hov.style.display = swordHover ? 'block' : 'none';
    }
    // ★2026-09-13 反馈轮6:vanilla 布局 hover 名走自有气泡(classic 保持原生 title=
    //  零变化白名单);气泡只在悬停态显示/刷新(mouseenter/点击经本函数),隐藏由
    //  构建区 mouseleave 管——本函数在共享刷新链(:5591)每拍跑,不可无条件 hide
    const vanillaTip = this._builtLayout === 'vanilla';
    if (!vanillaTip) {
      this.pvpSwordBtn.title = cool ? '' : Lang.text(p.hostile ? 'UI.PvpIcon_Active' : 'UI.PvpIcon_Inactive');
    } else if (swordHover) {
      this.showBuffTooltip(this.pvpSwordBtn, Lang.text(p.hostile ? 'UI.PvpIcon_Active' : 'UI.PvpIcon_Inactive'), '');
    }
    PVP_TEAM_BUTTONS.forEach((tb, k) => {
      const cell = this.pvpTeamBtns[k];
      const hover = !cool && cell.matches(':hover');
      // 悬停高亮 = UI_PVP_2 垫底（:43500-43502）；提示 = TeamIcon{Name}_{Active|Inactive}（:43462）
      cell.style.backgroundImage = hover ? 'url(sprites/vanilla-ui/UI_PVP_2.png)' : 'none';
      // ★S4 基帧冷却调光（:43506 White*num4——num4=teamCooldown==0?1:0.25 :43399;
      //  BJ417 只落了剑钮基帧 :43425 同式。悬停高亮满白不调光——其 flag2 门本就
      //  要求 teamCooldown==0（鼠标路径 :43491-43493）,与 hover=!cool 同相）
      const icon = cell.querySelector<HTMLElement>('[data-pvp-team-icon]');
      if (icon) icon.style.opacity = cool ? '0.25' : '1';
      if (!vanillaTip) {
        cell.title = cool ? '' : Lang.text(`UI.TeamIcon${tb.name}_${p.team === tb.team ? 'Active' : 'Inactive'}`);
      } else if (hover) {
        this.showBuffTooltip(cell, Lang.text(`UI.TeamIcon${tb.name}_${p.team === tb.team ? 'Active' : 'Inactive'}`), '');
      }
    });
  }

  /** PvP 剑点击：hostile 翻转 + 冷却 300t + 音效 12（:42104-42110）。
   *  原版 SendData(30)；本仓 msg13 快速通道（ClientNet.sendPvpState）+ options 持久化
   *  （Settings 页 PvP 行同款链）。 */
  private pvpToggleHostile(): void {
    const p = this.game.player;
    if (performance.now() < this.pvpCooldownUntil) return;   // teamCooldown 门
    this.pvpCooldownUntil = performance.now() + PVP_COOLDOWN_MS;
    this.game.sfx.play('menuTick', 1);                       // SoundID 12（:42107）
    p.hostile = !p.hostile;
    void options.set('pvpEnabled', p.hostile);
    this.game.net?.sendPvpState();
    this.refreshPvpButtons();
  }

  /** 队伍格点击：team=i + 冷却 + 音效 12（:42163-42182）。TeamChangeAllowed 恒 true
   *  （Player.cs:4303-4306）——misc[84] 拒绝文案支为死码不入。原版 SendData(157)。 */
  private pvpSetTeam(team: number): void {
    const p = this.game.player;
    if (p.team === team || performance.now() < this.pvpCooldownUntil) return;
    this.pvpCooldownUntil = performance.now() + PVP_COOLDOWN_MS;
    this.game.sfx.play('menuTick', 1);                       // SoundID 12（:42172）
    p.team = team;
    void options.set('pvpTeam', team);
    this.game.net?.sendPvpState();
    this.refreshPvpButtons();
  }

  private buildInventoryPanel() {
    // sw-inv 作用域类（2026-09-02）：透明底下面板文字直接叠世界画面,该作用域统一
    // 加文字投影（CSS 见 .sw-inv 规则）;其余 .sw-panel（箱子/设置等）不受影响
    this.invPanel = el('div', 'sw-panel sw-inv');
    // 位置（2026-08-27 用户要求）：对齐左上工具栏最左格（面板跑工具栏正下方一点）,
    // 不再水平居中——左=热键栏首格左缘,顶=热键栏底+8px;透明度再拉高（opacity .75,
    // 叠 .sw-panel 半透底）+ 边框/投影弱化。★每次 openInventory 重算（贴位取热键栏
    // 槽 inline 布局值）;★构建后必须显式 display:none（E 开/E 关语义,曾漏=默认开着）
    this.positionInvPanel();
    this.invPanel.style.display = 'none';
    // 原版背包无标题栏（DrawInventory 直接铺槽位）——标题行已摘（2026-08-13）

    // ---- Loadout 切换列（DrawLoadoutButtons Main.cs:41386+：当前套高亮）——
    //  ★2026-08-27 用户要求：随装备列整体迁至右缘（成就/杂项列左侧）,不再占顶排
    //  ★2026-09-07 用户要求：横排改竖排列（label 在顶 + 3 钮纵叠,结构对齐 vcol2）,
    //  移到时装列左侧作 eqPage 首列（挂载点见下方 eqPage.appendChild）
    const loadoutCol = el('div');
    loadoutCol.style.cssText = 'display:flex; flex-direction:column;';
    loadoutCol.appendChild(el('div', 'sw-lbl', Lang.text('Mods.SandboxWorld.Tabs.Loadout')));
    const loadoutWrap = el('div');
    loadoutWrap.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    this.loadoutBtns = [];
      for (let k = 0; k < 3; k++) {
        // 原版 DrawLoadoutButtons（Main.cs:41395-41431）：Extra[259] 3×3 图集——
        // 行 = loadout 配色，列 = 常态 0 / 选中 1 / 悬停 2（OurFavoriteColor 染色帧）
        const b = el('button', 'sw-btn sw-loadout-btn');
        b.dataset.lo = String(k);
        b.style.cssText = 'margin:0; width:32px; height:32px; padding:0; border:none; flex:none;'
          + 'background:url(sprites/vanilla/Extra_259.png); background-size:300% 300%;'
          + 'image-rendering:pixelated; cursor:pointer;';
        const frame = (col: number) => { b.style.backgroundPosition = `${col * 50}% ${k * 50}%`; };
        frame(0);
        b.addEventListener('mouseenter', () => { if (this.game.player.inv.currentLoadout !== k) frame(2); });
        b.addEventListener('mouseleave', () => { if (this.game.player.inv.currentLoadout !== k) frame(0); });
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (this.game.player.inv.currentLoadout === k) return;
          this.game.player.inv.trySwitchingLoadout(k, this.game.player.hideVisibleAccessory);   // R4-12
          this.game.sfx.play('menuTick', 1); // SoundID 12（TrySwitchingLoadout）
          this.flashLoadoutSwitch();
          this.refreshAll();
        });
        loadoutWrap.appendChild(b);
        this.loadoutBtns.push(b);
      }
      loadoutCol.appendChild(loadoutWrap);
      // 顶排：页签/入口图标行——★2026-08-27 用户要求：不再占整行留空,挂到右缘列
      // 顶部（成就卡上方,居中可换行）,背包/弹药/配装三列直接顶到面板上沿
      const row = el('div');
      row.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; justify-content:center; margin-bottom:2px;';
      // 页签：住房/图鉴图标钮（原版 DrawPageIcons :43528 EquipPage[4]灰房/hover=[7]红房
      // /页开=[5]；图鉴 = BestiaryMenuButton（Images/UI/Bestiary 2 帧书:常态/金高亮）。
      // 2026-08-27 用户要求：移植原版图标 + 两图标居右。住房点击：藏背包+开住房
      // 右缘条（查询器/指定 NPC 头像列）；条上 ✕ / 右键落光标 / E = 收条）
      // （spacer 已随顶行退役——图标行现挂右缘列顶部,居中换行）
      // 多人玩家列表（联机态显示）与旅程入口排图标左侧
      this.playerListBtn = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.PlayerList.Title'));
      this.playerListBtn.style.cssText = 'margin:0; padding:4px 10px; font-size:12px; display:none;';
      this.playerListBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.closeInventory();
        openPlayerListPanel(this.game);
      });
      row.appendChild(this.playerListBtn);
      if (this.game.player.appearance?.difficulty === 3) {
        const bPow = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.JourneyPowers.Title'));
        bPow.style.cssText = 'margin:0; padding:4px 10px; font-size:12px;';
        bPow.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.closeInventory();
          openJourneyPowersPanel(this.game);
        });
        row.appendChild(bPow);
        // ★SW-RB14b:研究钮标签订正——LegacyInterface.112 原版 zh-Hans=「你必须先设置边框」
        //   (Terarria1457 zh-Hans.Legacy.json :112,非研究面),误用致钮/标题错文案;改自有键
        const bRes = el('button', 'sw-btn', Lang.text('Mods.SandboxWorld.Research.Title'));
        bRes.style.cssText = 'margin:0; padding:4px 10px; font-size:12px;';
        bRes.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.closeInventory();
          openResearchPanel(this.game);
        });
        row.appendChild(bRes);
      }
      // 设置钮（SW-BN3 2026-09-07）：暂停/设置浮层入口——原版 playerInventory 态
      // 的设置入口 DrawInterface_29_SettingsButton（Main.cs:46287-46301,可见态
      // playerInventory ∥ ingameOptionsWindow ∥ dead,文字 = Lang.inter[62]
      // "Settings/设置"）。随 row 以 display:contents 入簇格（跨双列,右缘列底行
      // ≈原版背包右下钮位）；开/收 toggle 在 main.ts 接线侧（onPauseMenu）
      {
        const bSet = el('button', 'sw-btn', Lang.text('LegacyInterface.62'));
        bSet.title = Lang.text('LegacyInterface.62');
        bSet.style.cssText = 'margin:0; padding:4px 6px; font-size:12px; grid-column: 1 / -1;';
        bSet.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.onPauseMenu?.();
        });
        row.appendChild(bSet);
      }
      // 道具搜索（调试检索器）：图标化入顶排图标组（2026-08-27 用户要求,原背包
      // 标签行文字钮退役）——★Bestiary 搜索贴图自带蓝底面板非裸 icon,用户定策
      // 改用 emoji 🔍 + hover 金色衬底。2026-09-02 用户要求：搜索钮移到竖列最底
      // （不随 row,挂载点见下方 sideCol 段尾）
      {
        const bS = el('button');
        this.itemSearchBtn = bS;
        bS.title = '道具搜索';
        bS.textContent = '🔍';
        bS.style.cssText = 'margin:0; width:24px; height:24px; padding:0; flex:none; border:none;'
          + 'background:transparent; font-size:14px; line-height:1; cursor:pointer;'
          + 'display:flex; align-items:center; justify-content:center;'
          + 'border-radius:4px; transition:background .12s;';
        bS.addEventListener('mouseenter', () => { bS.style.background = 'rgba(255,231,69,0.28)'; });
        bS.addEventListener('mouseleave', () => { bS.style.background = 'transparent'; });
        bS.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.openItemSearch();
        });
      }
      {
        const b = el('button');
        b.title = Lang.text('Mods.SandboxWorld.Housing.Button');
        b.style.cssText = 'margin:0; width:24px; height:24px; padding:0; flex:none; border:none;'
          + 'background:url(sprites/vanilla-ui/UI_DisplaySlots_4.png) 0 0/100% 100%;'
          + 'image-rendering:pixelated; cursor:pointer;';
        this.housingBtn = b;
        this.refreshHousingBtn();
        // hover 态 = 原版 EquipPage[7]（DrawPageIcons :43538 悬停叠 [7] 金染）——
        // DOM 等价 = 悬停切 _7 贴图；开态(_5)保持
        b.addEventListener('mouseenter', (e) => {
          if (!this.housingOpen) (e.currentTarget as HTMLElement).style.backgroundImage = 'url(sprites/vanilla-ui/UI_DisplaySlots_7.png)';
        });
        b.addEventListener('mouseleave', () => this.refreshHousingBtn());
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          // 背包先收（住房条挂屏幕右缘,背包不藏会被压住/挡点击/挡移动）
          this.closeInventory();
          this.onHousing?.();
        });
        row.appendChild(b);
      }
      {
        const bBst = el('button');
        this.bestiaryBtn = bBst;
        bBst.title = Lang.text('Mods.SandboxWorld.Tabs.Bestiary');
        bBst.style.cssText = 'margin:0; width:24px; height:24px; padding:0; flex:none; border:none;'
          + 'background:url(sprites/vanilla-ui/UI_Bestiary.png) 0 0/200% 100%;'
          + 'image-rendering:pixelated; cursor:pointer;';
        bBst.addEventListener('mouseenter', () => { bBst.style.backgroundPosition = '100% 0'; });
        bBst.addEventListener('mouseleave', () => { bBst.style.backgroundPosition = '0 0'; });
        bBst.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.onBestiary?.();
        });
        row.appendChild(bBst);
      }
      // 成就入口 = 背包内 AchievementAdvisor 卡（AchievementsUI.createAchievementAdvisor，
      // 原版同款：背包左侧未完成成就小卡点击开成就页）。背包顶栏成就按钮已摘
      // （2026-08-13 用户要求：双入口只留原版位；原版设置菜单 Lang.menu[131] 入口
      // 如需再补应落在 Settings 而非背包顶栏）
    // 图标行挂面板下横条（2026-09-02 用户要求,原 invPanel 顶行 2026-08-27 曾挂右缘列）

    // ---- 右下角无框坞（2026-09-02 用户要求：配装列 + 杂项/PvP 列整体迁出背包
    //  面板，浮置屏幕右下角、无面板底框——降低对世界画面的遮挡。随背包开合显隐,
    //  见 openInventory/closeInventory；点击命中登记进 domTargets 名单 .sw-eqdock）----
    const eqDock = el('div', 'sw-eqdock');
    // ★2026-09-07 用户要求：flex-end（底对齐）→ flex-start（顶对齐）——装备四列
    //  顶部与杂项列首行（宠物栏）对齐
    eqDock.style.cssText = 'position:fixed; right:10px; bottom:10px; display:none; pointer-events:auto;'
      + 'align-items:flex-start; gap:26px; z-index:11;';
    this.eqDockEl = eqDock;
    // 主体：原版布局——左装备竖列（盔甲 0-2 + 配饰 3-7 | 染料 0-2+3-7 | 时装 10-12 + 时装配饰 13-17）
    // / 杂项页（miscEquips[5] + miscDyes[5]，Main.cs:40616-40672 EquipPage==2）+
    // 垃圾桶 + 钱币 + 弹药；右背包 10×4（10-49）。原版三列 x=sw-92/-139/-186。
    const body = el('div');
    body.style.cssText = 'display:flex; gap:14px; margin-bottom:8px;';
    const left = el('div');
    // 装备组（2026-08-27 用户要求：染料/时装/装备列整体迁至成就/杂项列左侧,
    // 背包贴热键栏；2026-09-02 再迁右下角无框坞——挂载点见 eqDock.appendChild(left)）
    left.style.cssText = 'display:flex; flex-direction:column; gap:6px; flex:none;';
    // 装备页：四列 L→R = 配装 | 时装 | 装备 | 染料（2026-09-02 用户要求染料挪到装备
    //  列右侧——染料↔装备按行索引配对,相邻更直观,原版序=染料|时装|装备为用户定策
    //  偏离;2026-09-07 用户要求配装竖列并入本行首列——原横排行退役）。
    //  两段式竖列（盔甲段 + 4px 组距 + 配饰段,原版列距 47px、配饰段下移 num35=4px）
    const vcol2 = (label: string, a: number, na: number, b: number, nb: number, where: SlotWhere, eyes = false) => {
      const col = el('div');
      col.appendChild(el('div', 'sw-lbl', label));
      const wrap = el('div');
      wrap.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
      for (let k = 0; k < na; k++) wrap.appendChild(this.makeSlotEl(a + k, where));
      for (let k = 0; k < nb; k++) {
        const sl = this.makeSlotEl(b + k, where);
        if (k === 0) sl.style.marginTop = '4px'; // 段组距（原版 num35=4）
        if (eyes) this.attachVisibilityEye(sl, b + k);
        wrap.appendChild(sl);
      }
      col.appendChild(wrap);
      col.style.cssText = 'display:flex; flex-direction:column;';
      return col;
    };
    this.accEyeEls.clear();   // 面板重建（重进世界）时旧眼钮引用作废
    const eqPage = el('div');
    eqPage.style.cssText = 'display:flex; gap:16px;'; // 列距拉开：自制列标签与邻列槽贴叠会被读成"词左边的杂字"（原版无文字标签不显此问题）
    eqPage.appendChild(loadoutCol);   // 配装（2026-09-07 用户要求：竖排列居时装左侧）
    const vanityCol = vcol2(Lang.text('Mods.SandboxWorld.UI.Vanity'), 10, 3, 13, 5, 'armor'); // 时装 armor[10-12]+[13-17]
    eqPage.appendChild(vanityCol);
    const equipCol = vcol2(Lang.text('Mods.SandboxWorld.UI.Equipment'), 0, 3, 3, 5, 'armor', true);   // 装备 armor[0-2]+[3-7]（防御计数器挂此列底;配饰段挂眼睛开关）
    eqPage.appendChild(equipCol);
    const dyeCol = vcol2(Lang.text('LegacyInterface.57'), 0, 3, 3, 5, 'dye');                // 染料 dye[0-2]+[3-7]（追加格 dye[8]/[9] 按解锁显隐,见 extras 段——与装备/时装列逐行对应）
    eqPage.appendChild(dyeCol);
    // 恶魔之心(armor[8]/dye[8])+大师(dye[9] 无独立时装...armor[9]) 追加槽——
    // 建面板即建、refreshEquipExtras 按解锁/占格显隐（Player.cs:4279 Shown 判定：
    // 解锁【或】格内有物【或】社交孪生占【或】染料格占；经典世界专家旗存物也
    // 显示但不生效=效果门逐槽 :12669-12690，清偿刀 P）。时装列 18/19 同步追加
    // （无眼钮——眼只挂功能段 3-9）
    const equipExtras: HTMLElement[] = [];
    const vanityExtras: HTMLElement[] = [];
    const dyeExtras: HTMLElement[] = [];
    {
      // ★追加槽必须接在【槽位容器】尾部(vcol2 的 col.children[1])——
      //  firstElementChild 是列标签 div,曾 append 进标签 ⇒ 恶魔之心/大师槽
      //  插到列最前面(2026-08-28 用户报),应在尾部配饰之后追加
      const equipWrap = equipCol.children[1] as HTMLElement | null;
      // 列序 2026-09-07 调整后 eqPage children：[0]=配装 [1]=时装 [2]=装备 [3]=染料
      // （改用上方 vcol2 直接引用,不再按 children 序数取列——曾因插列翻车）
      const vanityWrap = vanityCol.children[1] as HTMLElement | null;
      const dyeWrap = dyeCol.children[1] as HTMLElement | null;
      for (let k = 0; k < 2; k++) {
        const es = this.makeSlotEl(8 + k, 'armor');
        this.attachVisibilityEye(es, 8 + k);
        if (k === 0) es.style.marginTop = '4px';
        es.style.display = 'none';
        equipWrap?.appendChild(es);
        equipExtras.push(es);
        // 染料列追加格 dye[8]/dye[9]（恶魔染料/大师染料）——与装备追加格同行同门
        // 显隐（2026-09-02 用户问"染料列为何 10 格"定谳：此前染料列固定渲染 10 格、
        // 装备/时装列追加格按解锁显隐 → 未解锁时行数不齐=对应关系错位）
        const ds = this.makeSlotEl(8 + k, 'dye');
        if (k === 0) ds.style.marginTop = '4px';
        ds.style.display = 'none';
        dyeWrap?.appendChild(ds);
        dyeExtras.push(ds);
        const vs = this.makeSlotEl(18 + k, 'armor');
        if (k === 0) vs.style.marginTop = '4px';
        vs.style.display = 'none';
        vanityWrap?.appendChild(vs);
        vanityExtras.push(vs);
      }
      this.equipExtraSlots = { equip: equipExtras, vanity: vanityExtras, dye: dyeExtras };
    }
    left.appendChild(eqPage);
    // 杂项（常驻右缘列，原杂项页 2026-08-27 并入）：miscEquips[5]（宠物/光源/矿车/
    // 坐骑/抓钩，context 19/20/18/17/16）+ miscDyes[5]（context 33）——挂 advRail
    // 玩家对决原位，PvP/队伍钮被顶到其下（节点在下方 advRail 段挂载）
    const MISC_LABELS = [
      Lang.text('Mods.SandboxWorld.Tabs.Pet'), Lang.text('Mods.SandboxWorld.Tabs.Light'),
      Lang.text('Mods.SandboxWorld.Tabs.Minecart'), Lang.text('Mods.SandboxWorld.Tabs.Mount'),
      Lang.text('Mods.SandboxWorld.Tabs.Grapple'),
    ];
    const miscRail = el('div');
    // ★2026-09-02 用户要求：杂项染料槽与对应杂项槽同行并排（此前染料独立成列,
    // 行高与 misc 行高不一致 → 第 2 行起对应关系错位）
    miscRail.style.cssText = 'display:flex; flex-direction:column; gap:8px; align-items:flex-start;';
    MISC_LABELS.forEach((lbl, k) => {
      const row = el('div');
      row.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
      row.appendChild(el('div', 'sw-lbl', lbl));
      const pair = el('div');
      pair.style.cssText = 'display:flex; gap:6px; align-items:center;';
      const slotEl = this.makeSlotEl(k, 'misc');
      // 宠物/光源槽眼睛开关（原版 InventoryTick 图标 Main.cs:40666-40691：光标为空
      // 时点击小眼睛 → TogglePet/ToggleLight 显隐翻转——槽 0/1 专属）。
      // ★图标同配饰眼 Inventory_Tick_On/Off（2026-08-27 用户报：曾用 emoji 👁
      // 与装备列眼睛不一致）
      if (k === 0 || k === 1) {
        const eye = el('button', 'sw-btn sw-peteye');
        eye.style.cssText = 'position:absolute; right:-12px; top:-10px; width:24px; height:20px;'
          + 'margin:0; padding:0; z-index:5; background:center/contain no-repeat; image-rendering:pixelated;';
        eye.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (this.heldStack) return;   // 原版 mouseItem.IsAir 门（:40670）
          this.game.togglePetSlot(k as 0 | 1);
          this.paintPetEye((e.currentTarget as HTMLElement), k as 0 | 1);
        });
        slotEl.style.position = 'relative';
        slotEl.appendChild(eye);
        this.paintPetEye(eye, k as 0 | 1);
      }
      pair.appendChild(slotEl);
      pair.appendChild(this.makeSlotEl(k, 'miscDye'));   // 对应染料同排（原版同构）
      row.appendChild(pair);
      miscRail.appendChild(row);
    });
    // 垃圾桶（持久槽；可交换取回）——原版 (448,258) scale0.85=44px、槽底 Back7（context 6）
    const trashWrap = el('div');
    trashWrap.appendChild(el('div', 'sw-lbl', Lang.text('LegacyInterface.3')));
    const trash = el('div', 'sw-slot trash sw-trash');
    trash.style.cssText = 'width:44px; height:44px; flex:none;'
      + 'background-image:url(sprites/vanilla/Inventory_Back7.png);';
    trash.addEventListener('contextmenu', (e) => e.preventDefault());   // SW-AU2：Ctrl+点(Mac=长按右键菜单面)在槽域同被吞
    trash.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      // ★SW-AY1 R4a Alt(FavoriteKey)+聊天输入开着 = 插物品 tag——本槽不走
      //  makeSlotEl（自建监听器,不在 makeSlotEl 优先级链内）,此处补 OverrideHover
      //  :581-587 最高优先支：context 6 ∈ canShareAt（:380）→ cursorOverride 2 →
      //  OverrideLeftClick :709-716 ChatManager.AddChatText + SoundID 12 消费
      if (!e.button && e.altKey && this.game.chatInput?.isOpen && this.game.player.inv.trash) {
        this.game.insertChatItemTag(vidOf(this.game.player.inv.trash.id));
        this.game.sfx.play('menuTick', 1);
        return;
      }
      // ★SW-AU2 2026-09-06 Shift+左键垃圾桶 = 桶→背包（GetAlternateClickAction
      //  :688-696 case 6 → cursorOverride 7 → OverrideLeftClick :764-770
      //  GetItem(QuickTransferFromSlot)：落袋 GetItem SoundID 7 + 支尾 SoundID 12；
      //  残量留桶 = inv[slot] 即 GetItem 返回值）。右键面原版无（RightClick :1632
      //  `context == 6` 早退）；Ctrl 原版不在 Quick Trash 域（:611 仅 0-4/7/32）→ 取回
      if (!e.button && e.shiftKey && !e.altKey && !e.ctrlKey && this.game.player.inv.trash) {
        const t = this.game.player.inv.trash;
        const left = this.game.player.inv.add(t.id, t.stack, t.prefix, (t as { placeStyle?: number }).placeStyle);
        if (left < t.stack) {
          this.game.player.inv.trash = left > 0 ? { ...t, stack: left } : null;
          // ★SW-AY1 #9 GetItem 币种专音（:764-770 → Player.cs:39755 IsACoin ? 38 : 7）
          this.game.sfx.play(coinIndexOf(t.id) >= 0 ? 'coin' : 'pickup', 1);
          this.game.sfx.play('menuTick', 1);
          this.paintTrash();
          this.refreshAll();
          return;
        }
        // ★SW-RB1 2026-09-06 全拒回落普通面：GetAlternateClickAction(:688-696) 因
        //  ItemSpace 拒而 null → LeftClick case-0（PickItemMovementAction context 6
        //  :1465 result=0）——满包时 Shift+点=旧桶销毁+光标物入桶 / 无持物=桶件上光标。
        //  旧实现恒消费 return ⇒ 满包 Shift+点垃圾桶成死键（原版可回落拾取/覆盖面）
      }
      if (this.heldStack) {
        this.placeTrash();
      } else if (this.game.player.inv.trash) {
        this.heldStack = this.game.player.inv.trash; // 取回
        this.game.player.inv.trash = null;
        this.game.sfx.play('pickup', 1);   // 取回 = Grab（:701-706 mouseItem 有物 → 7）
        this.paintTrash();
      }
      this.refreshAll();
    });
    this.trashEl = trash;
    trashWrap.appendChild(trash);
    // 钱币 4 格（50-53）+ 弹药 4 格（54-57）——原版 Main.cs:41189-41224：
    //  inventoryScale 0.6 → 31px 竖列、间距 33.6px（gap 2.6），Coins x=497 / Ammo x=534
    const coinAmmo = el('div');
    coinAmmo.style.cssText = 'display:flex; gap:5px;';
    const mkCol = (label: string, from: number) => {
      const col = el('div');
      col.appendChild(el('div', 'sw-lbl', label));
      const colSlots = el('div');
      colSlots.style.cssText = 'display:flex; flex-direction:column; gap:2.6px;';
      for (let k = 0; k < 4; k++) {
        const sl = this.makeSlotEl(from + k, 'inv');
        sl.classList.add('sm');
        colSlots.appendChild(sl);
      }
      col.appendChild(colSlots);
      col.style.cssText = 'display:flex; flex-direction:column;';
      return col;
    };
    // ★2026-08-27 用户要求：左右调转——左→右 = 弹药 | 钱币
    coinAmmo.appendChild(mkCol(Lang.text('LegacyInterface.27'), AMMO_START));
    coinAmmo.appendChild(mkCol(Lang.text('LegacyInterface.26'), COIN_START));
    const rightRail = el('div');
    // ★2026-08-27 用户要求：垃圾桶放到弹药/钱币列下方（列改纵向：上=弹药|钱币,下=垃圾桶）
    rightRail.style.cssText = 'display:flex; flex-direction:column; gap:8px; align-items:flex-start;';
    rightRail.appendChild(coinAmmo);
    rightRail.appendChild(trashWrap);
    // 挂载点移到背包右侧（夹在背包与成就/杂项列之间,2026-08-27 用户要求）——
    // 见下方 body.appendChild(right) 后。装备组（left=配装+染料/时装/装备列）挂载点
    // 同样移至 rightRail 之后、成就/杂项列之前（用户要求整体右迁）
    // 成就提示牌（AchievementAdvisor：未完成成就小卡，点击开成就菜单）
    // ——挂载点在物品格之后（见 body.appendChild(right) 处），此处仅创建
    this.achAdvisorEl = createAchievementAdvisor(() => this.game, () => ADVISOR_SCALE_LARGE);   // ★BJ318 动态解析;★BJ500 classic 侧列=大卡角色→原版 0.75 档

    // 背包 10×4（10-39）。★「背包」标签行已摘（2026-09-02 用户要求：去掉二字
    // 直接贴紧热键栏;道具搜索文字钮此前已图标化,向导反查钮 2026-08-14 摘）
    const right = el('div');
    const grid = el('div', 'sw-invgrid');
    // 轨道/间距初值 = --slot(39)+4（D0 桌面恒等值）;此后每帧由
    // syncInvGridGeometry 按热键栏实测节距改写（任何缩放环境下与热键栏逐像素一致）
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(10, var(--slot));'
      + 'grid-auto-rows:var(--slot); gap:4px;';
    this.invGridEl = grid;
    // 背包网格 = 槽 10-49（10×4）。★曾写到 INV_SIZE=58——50-57 是钱币/弹药槽
    // （COIN_START/AMMO_START,已在左列渲染），混进网格成第 5 行幻影格：query 首匹配
    // 让左列元素吃掉绘制、悬停却读出钱币/弹药 tooltip（2026-08-26 用户实报红框行）。
    // 原版背包网格到 49 为止（Main.cs 背包 10×4）。
    for (let i = 10; i < COIN_START; i++) {
      grid.appendChild(this.makeSlotEl(i, 'inv'));
    }
    right.appendChild(grid);
    // ---- 右上钮簇（原版背包开时 2×2 30×30 裸图标：QuickStack(498,244)/Sort(534,244)/
    //      Bestiary(498,278)/Emote(534,278)，Main.cs:41276-41355/:41815-41930——
    //      2026-09-02 用户要求：改为 2 列 × 3 行钮格——第 1 行 = 堆叠双钮（原单钮
    //      右键切模式拆开,左键各按固定模式执行）,第 2 行 = 住房/图鉴,第 3 行 =
    //      表情/道具搜索（均取挂自原竖列/图标组）----
    const clusterRow = el('div');
    clusterRow.style.cssText = 'display:grid; grid-template-columns:repeat(2,30px); gap:6px;'
      + 'justify-content:center; align-items:center; justify-items:center; margin:2px 0 4px;';
    // 堆叠至附近宝箱（ChestStack 贴图 4 帧 = 悬停位+模式位：0 常态-quick/1 悬停-quick/
    //  2 常态-smart/3 悬停-smart，Main.cs:41311 num80 += mode*2 + hover）——左键
    // QuickStackAllChests + 音 12；开箱/商店隐藏
    const mkStackBtn = (mode: 'quick' | 'smart'): HTMLButtonElement => {
      const b = el('button', 'sw-btn');
      const base = mode === 'smart' ? 2 : 0;
      b.style.cssText = 'margin:0; width:30px; height:30px; padding:0; flex:none;'
        + `border:none; background:url(sprites/vanilla-ui/UI_ChestStack_${base}.png) 0 0 / 100% 100%;`
        + 'image-rendering:pixelated; cursor:pointer;';
      b.addEventListener('mouseenter', (e) => {
        (e.currentTarget as HTMLElement).style.backgroundImage = `url(sprites/vanilla-ui/UI_ChestStack_${base + 1}.png)`;
      });
      b.addEventListener('mouseleave', (e) => {
        (e.currentTarget as HTMLElement).style.backgroundImage = `url(sprites/vanilla-ui/UI_ChestStack_${base}.png)`;
      });
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        this.game.quickStackAllChests(mode);
        this.game.sfx.play('menuTick', 1);          // SoundID 12（:41292）
        this.refreshAll();
      });
      // title 不用 GameUI.* 官译——官译带「右键点击切换堆叠方式」提示,双钮拆分后无此交互
      b.title = mode === 'smart' ? '智能堆叠至附近宝箱' : '快速堆叠至附近宝箱';
      return b;
    };
    this.quickStackBtn = mkStackBtn('quick');
    this.qsSmartBtn = mkStackBtn('smart');
    clusterRow.append(this.quickStackBtn, this.qsSmartBtn);
    // 2×2 图标行（住房/图鉴/表情/搜索）在 bEmote 创建后装配（TDZ;见下方 append）
    // 表情入口（原版簇位 (534,278)：EmoteMenuButton 双帧裸图标，左键开 UIEmotesMenu
    // :41850；打开逻辑经 Game 注入 onEmoteMenu）。2026-09-02 用户要求：30×30 →
    // 24×24,与住房/图鉴图标统一（原尺寸偏大）
    const bEmote = el('button', 'sw-btn');
    bEmote.title = Lang.has('GameUI.Emote') ? Lang.text('GameUI.Emote') : 'GameUI.Emote';
    bEmote.style.cssText = 'margin:0; width:24px; height:24px; padding:0; flex:none;'
      + 'background:url(sprites/vanilla-ui/UI_Emotes.png) 0 0 / 200% 100%;'
      + 'image-rendering:pixelated; border:none; cursor:pointer;';
    bEmote.addEventListener('mouseenter', () => { bEmote.style.backgroundPosition = '100% 0'; });
    bEmote.addEventListener('mouseleave', () => { bEmote.style.backgroundPosition = '0 0'; });
    bEmote.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.onEmoteMenu?.();
    });
    // 表情钮 → 簇格 2×3（2026-09-02 用户要求,装配见下方 clusterRow.append）
    // ★2026-08-27 用户要求：堆叠钮挂垃圾桶下方（原在背包网格下沿）——
    //  右列构成：弹药|钱币 → 垃圾桶 → 2×3 钮格 → 成就卡竖列
    clusterRow.append(this.housingBtn, this.bestiaryBtn, bEmote, this.itemSearchBtn);   // 2×2 图标行
    // 第 4 行：天气/时间控制（2026-09-02 用户要求,画布右上按钮迁入钮格变 2×4——
    //  开背包时画布按钮隐藏（Renderer playerInventory 门）防重复;面板本体仍在
    //  小地图下绘制。首用确认门同画布路径）
    const mkHudPanelBtn = (label: string, title: string, kind: 'weather' | 'time'): HTMLButtonElement => {
      const b = el('button', 'sw-btn');
      b.title = title;
      b.textContent = label;
      b.style.cssText = 'margin:0; width:30px; height:30px; padding:0; flex:none;'
        + 'border:none; background:rgba(20,26,60,0.85); color:#e8e8f4;'
        + 'font:bold 13px monospace; cursor:pointer;'
        + 'display:flex; align-items:center; justify-content:center;';
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const r = this.game?.renderer;
        if (!r) return;
        const key = kind === 'time' ? 'timePanelOpen' : 'weatherPanelOpen';
        showJourneyQuickGate(kind, () => { r[key] = !r[key]; });
      });
      return b;
    };
    clusterRow.append(mkHudPanelBtn('⛅', '天气控制', 'weather'), mkHudPanelBtn('±', '时间控制', 'time'));
    clusterRow.appendChild(row);   // 联机/旅程钮行（display:contents,子项成第 5 行格;见 sideCol 段）
    rightRail.appendChild(clusterRow);
    body.appendChild(right);
    // 垃圾桶/弹药/钱币列 → 背包右侧（夹在背包与成就/杂项列中间,2026-08-27 用户
    // 要求——背包+合成整体贴向装备列,顺手中转距离更短）
    body.appendChild(rightRail);
    // 装备组（配装/染料/时装/装备列）→ 右下角无框坞（2026-09-02 用户要求：
    // 迁出背包面板,浮置屏幕右下角降低遮挡——不再占面板内列位）
    eqDock.appendChild(left);
    // ---- 成就卡（2026-09-02 第六批简化：图标/表情/搜索已入簇格 2×3,竖列只剩
    //  成就卡;margin -6px 抵消 rightRail gap(8)+簇 margin-bottom(4)（用户复报
    //  "依然离太远,继续缩小"→净距 ≈6px）。联机/旅程钮行以 display:contents 入
    //  簇格（其子成为第 4 行格,单机不可见不占位）----
    const sideCol = el('div');
    sideCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; align-items:center;'
      + 'margin-top:-6px;';
    row.style.cssText = 'display:contents;';   // 联机/旅程钮 → 簇格第 4 行（子项直入网格）
    sideCol.appendChild(this.achAdvisorEl);   // 成就提示牌（Advisor 卡,竖式）
    rightRail.appendChild(sideCol);
    // 杂项（宠物/光源/矿车/坐骑/钩爪+染料，原杂项页）+ PvP/队伍钮 → 右下角坞右列
    //（2026-09-02 用户要求；此前挂 advRail 玩家对决原位）
    const miscStack = el('div');
    miscStack.style.cssText = 'display:flex; flex-direction:column; gap:10px; align-items:center;';
    miscStack.appendChild(miscRail);
    eqDock.appendChild(miscStack);
    this.invPanel.appendChild(body);

    // ---- PvP/队伍快切钮（DrawPVPIcons Main.cs:42074-42195：原版背包右下角；
    //      本仓挂右缘列杂项块下方（2026-08-27 杂项迁入此列,对决/队伍钮顶下去）；
    //      原版 ShouldPVPDraw=netMode==1 仅联机画，本仓常开=设置页 PvP/队伍同款
    //      语义（单机调试便利 + 联机 msg13 同步）） ----
    const pvpWrap = el('div');
    // margin-top 拉开与钩爪行（杂项列末行）的间距（2026-08-27 用户要求；2026-09-02
    // 随杂项列迁右下角坞,miscStack gap 10px 已含基础间距,此 margin 减半）
    pvpWrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; margin-top:12px;';
    // PvP 剑（★BJ417 1457 制 :43419-43434：Frame(2,7) 38×38 整帧,scale 1 无裁;
    // 悬停=行 6 整帧覆盖层;1456 旧制 36×37 @400%×600% 已废——76×266 表上按 4×6
    // 取窗=跨行采样出「剑+邻帧」拼贴(用户实报贴图变形+跨帧)）
    this.pvpSwordBtn = el('button', 'sw-btn');
    this.pvpSwordBtn.style.cssText = 'margin:0; width:38px; height:38px; padding:0; flex:none; position:relative;'
      + 'border:none; background:url(sprites/vanilla-ui/UI_PVP_0.png); background-size:200% 700%;'
      + 'background-position:0% 0%; background-repeat:no-repeat; image-rendering:pixelated; cursor:pointer;';
    {
      const hov = el('div');
      hov.dataset.pvpHover = '1';
      hov.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; display:none;'
        + 'background:url(sprites/vanilla-ui/UI_PVP_0.png); background-size:200% 700%;'
        + 'background-repeat:no-repeat; image-rendering:pixelated; pointer-events:none;';
      this.pvpSwordBtn.appendChild(hov);
    }
    this.pvpSwordBtn.addEventListener('mouseenter', () => this.refreshPvpButtons());
    this.pvpSwordBtn.addEventListener('mouseleave', () => this.refreshPvpButtons());
    this.pvpSwordBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.pvpToggleHostile();
    });
    pvpWrap.appendChild(this.pvpSwordBtn);
    // 队伍 2×3 格（:42127-42133：20px 步进；图标 18×18 裁 16 宽 :42185/:42191；
    // 悬停高亮 UI_PVP_2 20×20 垫底 @(:42188)）——60-38=22px 间距（:42119 num3+=60）
    const teamGrid = el('div');
    teamGrid.style.cssText = 'display:grid; grid-template-columns:repeat(2,20px);'
      + 'grid-auto-rows:20px; margin-top:22px;';
    this.pvpTeamBtns = [];
    for (const tb of PVP_TEAM_BUTTONS) {
      const cell = el('button', 'sw-btn');
      cell.style.cssText = 'margin:0; width:20px; height:20px; padding:0; flex:none;'
        + 'border:none; background:none; background-color:transparent;'
        + 'image-rendering:pixelated; cursor:pointer;';
      const icon = el('div');
      // data-pvp-team-icon = refreshPvpButtons 基帧调光消费柄（★S4 :43506 White*num4）
      icon.dataset.pvpTeamIcon = '1';
      icon.style.cssText = 'position:absolute; left:2px; top:1px; width:16px; height:18px;'
        + `background:url(sprites/vanilla-ui/UI_PVP_1.png); background-size:600% 100%;`
        + `background-position:${tb.team * 20}% 0%; image-rendering:pixelated; pointer-events:none;`;
      cell.style.position = 'relative';
      cell.appendChild(icon);
      cell.addEventListener('mouseenter', () => this.refreshPvpButtons());
      cell.addEventListener('mouseleave', () => this.refreshPvpButtons());
      cell.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.pvpSetTeam(tb.team);
      });
      teamGrid.appendChild(cell);
      this.pvpTeamBtns.push(cell);
    }
    pvpWrap.appendChild(teamGrid);
    miscStack.appendChild(pvpWrap);   // 右下角坞杂项列下方（2026-09-02 迁出 advRail）
    this.refreshPvpButtons();

    // 防御计数器（原版 DrawDefenseCounter Main.cs:41555-41623：Extra_58 盾 3×2 帧
    // [普通/专家/大师 × 底/辉光] + 数值【居中叠在盾上】(:41598 vector-测量宽*0.5+2y);
    // 悬停 = 「N 防御 + 伤害减免%(难度换算 0.5/0.75/1)」。位置=装备列下方（用户指定）
    const defRow = el('div');
    defRow.style.cssText = 'display:flex; justify-content:center; margin:6px 0 2px; cursor:help;';
    defRow.dataset.role = 'defense';
    const defWrap = el('div');
    defWrap.style.cssText = 'position:relative; width:40px; height:36px;';
    // 防御盾图用 <img>+dataURL 而非独立 canvas(2026-08-19 双开 IOSurface 压基数:
    // 每张 DOM canvas = 一张专属后备 surface;img 进共享合成层零专属面。
    // 帧内容按难度列静态,经模块级 52×48 scratch 烘一次 toDataURL 缓存,见下方刷新处)
    const defShield = el('img');
    defShield.alt = '';
    defShield.style.cssText = 'position:absolute; inset:0; margin:auto; width:39px; height:36px; image-rendering:pixelated;';
    defWrap.appendChild(defShield);
    const defNum = el('span', '', '0');
    defNum.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;'
      + 'padding-top:2px; font-size:13px; font-weight:bold; color:#fff; text-shadow:1px 1px 0 #000;';
    defWrap.appendChild(defNum);
    defRow.appendChild(defWrap);
    defRow.addEventListener('mouseenter', () => {
      if (!this.game) return;
      const p = this.game.player;
      const st = p.defense;
      const w = this.game.world;
      // 伤害减免换算（Main.cs:42831-42840）：大师 ×1.0 / 专家 ×0.75 / 普通 ×0.5,ceil
      const mul = w.isMaster ? 1.0 : w.isExpert ? 0.75 : 0.5;
      const reduce = Math.ceil(st * mul);
      // 悬停文本三行结构（Main.cs:42878-42890）："N 防御"（inter[10]）/
      // "受到的伤害降低N"（UI.DefenseDamageReduction）/难度行 传奇>大师>专家
      //（经典无行）。★曾硬编码中文+难度并括号（双语档偏离）且【漏定位】——
      // 共享 tooltip 元素停在旧位置=用户报"气泡不太对"（2026-09-02）
      const dl = mainDifficulty(w);
      const tipLines = [`${st} ${Lang.text('LegacyInterface.10')}`,
        Lang.text('UI.DefenseDamageReduction', reduce)];
      if (dl >= GDL.LEGENDARY) tipLines.push(Lang.text('UI.Legendary'));
      else if (dl >= GDL.MASTER) tipLines.push(Lang.text('UI.Master'));
      else if (dl >= GDL.EXPERT) tipLines.push(Lang.text('UI.Expert'));
      this.showBuffTooltip(defWrap, tipLines[0], tipLines.slice(1).join('\n'));
    });
    defRow.addEventListener('mouseleave', () => this.hideBuffTooltip());
    equipCol.appendChild(defRow);   // 装备列（第三列）正下方（原版画在装备区左侧垂直居中,用户指定装备列底）

    // 合成区 —— 挂 right（物品格容器）内部底部=物品格正下方（用户指定，
    // 此前挂 invPanel 横跨整个面板宽度）。标题+可用合成站同行（减少高度占用）
    const craftTitleRow = el('div');
    // margin-top 撑开背包网格/钮簇与合成区的间距（2026-08-27 用户要求,红框处）
    craftTitleRow.style.cssText = 'display:flex; align-items:baseline; gap:8px; margin:14px 0 6px;';
    {
      const t = el('div', 'sw-title', Lang.text('Mods.SandboxWorld.UI.Crafting'));
      t.style.fontSize = '14px';   // 随 39px 格缩放降级（.sw-title 17px 偏大,2026-08-27 用户要求）
      t.style.marginBottom = '0px';
      craftTitleRow.appendChild(t);
    }
    const stations = el('div', '', '');
    stations.style.cssText = 'font-size:11px; color:#8ad0a0; flex:1; min-width:0; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    stations.dataset.role = 'stations';
    craftTitleRow.appendChild(stations);
    right.appendChild(craftTitleRow);
    // ---- Modern 合成网格控件（1.4.5 CraftingGrid：搜索栏 + 焦点配方材料格） ----
    const modernRow = el('div');
    modernRow.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:6px;';
    // ★SW-BJ1 2026-09-06 附近箱参与制作开关（CraftingUI.DrawCraftFromNearbyChestsToggle
    // CraftingUI.cs:336-356，Main.cs:42442 挂点 = 网格开关下方 40px、配方列表旁）：
    // ChestCraft 四帧贴图（index = 2−val×2+hover：0/1 开态常驻/悬停、2/3 关态），
    // 悬停 tooltip = GameUI.CraftFromNearbyChestsOn/Off（MouseTextNoOverride :345），
    // 点击翻转 + SoundID 12 + NewCraftingUI.RefreshGrid（:349-352 → 本仓 refresh-
    // VanillaCrafting）。设置页入口保留（Settings.ts game 组,双入口同 original 一面）
    {
      const btn = el('div');
      btn.style.cssText = 'flex:0 0 auto; width:32px; height:34px; cursor:pointer; line-height:0;';
      btn.title = '';
      const img = document.createElement('img');
      img.draggable = false;
      img.style.cssText = 'width:32px; height:34px; image-rendering:pixelated;';
      this.craftNearbyToggleImg = img;
      const sync = (): void => {
        img.src = `sprites/vanilla-ui/UI_ChestCraft_${
          options.data.craftFromNearbyChests ? 0 : 2}.png`;
      };
      sync();
      this.optionsUnsubs.push(options.onChange(sync));   // ★BJ335:每轮订阅入册,closeAll 摘(sync 捕本轮 img)
      const tip = (): void => this.showBuffTooltip(btn,
        Lang.text(options.data.craftFromNearbyChests
          ? 'GameUI.CraftFromNearbyChestsOn' : 'GameUI.CraftFromNearbyChestsOff'), '');
      btn.addEventListener('mouseenter', () => {
        img.src = `sprites/vanilla-ui/UI_ChestCraft_${
          options.data.craftFromNearbyChests ? 1 : 3}.png`;
        // ★SW-RB5a：悬停进入音（DoStatefulTickSound Main.cs:3333-3344——hover 沿
        //  false→true 播 SoundID 12,离开不播）
        this.game?.sfx.play('menuTick', 1);
        tip();
      });
      btn.addEventListener('mouseleave', () => {
        img.src = `sprites/vanilla-ui/UI_ChestCraft_${
          options.data.craftFromNearbyChests ? 0 : 2}.png`;
        this.hideBuffTooltip();
      });
      btn.addEventListener('click', () => {
        void options.set('craftFromNearbyChests', !options.data.craftFromNearbyChests);
        this.game?.sfx.play('menuTick', 1);            // SoundID 12（CraftingUI.cs:351）
        this.craftFocus = -1;
        this.hoverFocus = -1;
        this.refreshVanillaCrafting();                 // NewCraftingUI.RefreshGrid 同语义
        tip();                                         // 悬停中翻转 → 文案随态换行
      });
      btn.appendChild(img);
      modernRow.appendChild(btn);
    }
    this.craftSearchEl = el('input') as HTMLInputElement;
    this.craftSearchEl.placeholder = Lang.text('Mods.SandboxWorld.Craft.SearchHint');
    // ★input 高度对齐右侧配方细项盒(38px)并恒定——未 hover 时细项盒塌掉曾把
    //  本行行高拖落=搜索框上下抖动（2026-08-26 用户图文定案）
    this.craftSearchEl.style.cssText = 'flex:1; height:38px; box-sizing:border-box; padding:4px 8px; background:#241e38; color:#fff; border:1px solid #6a5a8a; border-radius:4px; font-size:12px;';
    this.craftSearchEl.addEventListener('input', () => { this.craftFocus = -1; this.hoverFocus = -1; this.refreshVanillaCrafting(); if (this.craftListEl) this.craftListEl.scrollTop = 0; });
    modernRow.appendChild(this.craftSearchEl);
    this.craftGridEl = el('div');
    this.craftGridEl.style.cssText = 'display:flex; gap:4px; align-items:center; flex-wrap:wrap; max-width:426px; height:38px; box-sizing:border-box;';
    modernRow.appendChild(this.craftGridEl);
    right.appendChild(modernRow);
    const craftWrap = el('div');
    craftWrap.style.cssText = 'position:relative;';
    right.appendChild(craftWrap);
    this.craftListEl = el('div', 'sw-craft-list');
    // 2026-09-01 用户定案：滚动回归浏览器原生溢出容器（overflow-y:auto），行=
    // 静态流式子元素，滚轮/滚动条/触控全部交还 DOM——自算滚动（行池+rAF 缓动+
    // 自绘滚动条）整体退役。早年"原生滚动=位置每帧归零"的根因是重建行后不回填
    // scrollTop，非原生滚动本身（重建回填见 refreshVanillaCrafting）。
    this.craftListEl.style.cssText = 'max-height:240px; overflow-y:auto; width:426px;';
    // 仅挂时间戳（hover 预览门消费），不拦滚轮——preventDefault 会掐死原生滚动
    this.craftListEl.addEventListener('wheel', () => { this.craftWheelLast = performance.now(); }, { passive: true });
    this.craftListEl.addEventListener('mousemove', () => { this.craftMouseMoveLast = performance.now(); });
    // 移出列表清预览+高亮（材料格回落到点击选中行）
    this.craftListEl.addEventListener('mouseleave', () => {
      this.craftHoverEl?.classList.remove('hov');
      this.craftHoverEl = null;
      if (this.hoverFocus !== -1) { this.hoverFocus = -1; this.refreshCraftGrid(this.craftAvailRef); }
    });
    craftWrap.appendChild(this.craftListEl);
    this.root.appendChild(this.invPanel);
    this.root.appendChild(eqDock);   // 右下角无框坞与面板平级（root 直挂,2026-09-02）
  }

  /** 滚轮时间戳——hover 预览 350ms 门（原生滚动经停行的 mouseenter 不预选） */
  private craftWheelLast = 0;
  /** 列表容器最近一次真实 mousemove——区分「鼠标主动移到行上」与「内容滚动
   *  让行从静止鼠标下经过」(后者浏览器同样派发 mouseenter,但无 mousemove
   *  伴随)——hover 预选只认前者(2026-08-25 用户报滚动过程连环误预选) */
  private craftMouseMoveLast = 0;
  /** .hov 高亮行——高亮与预选(hoverFocus)分离:预选只进材料格,不碰列表本身 */
  private craftHoverEl: HTMLElement | null = null;

  /** Buff 状态栏（对齐原版 DrawInterface_Resources_Buffs，Main.cs:42618-42640 +
   *  DrawBuffIcon :42725）：
   *  起点 (32,76)、**每行 11 个横排**（步距 38px = 32 图标 + 6 缝；行宽 418）、
   *  行距 50px、裸 32×32 **原版 Buff_{vanillaBuff} 贴图**（TextureAssets.Buff 1:1
   *  尺寸原大绘制，不用药水物品图标替代）、剩余时长文字在图标正下方（ItemStack
   *  0.8 倍字号）、悬停提亮（原版 buffAlpha 0.4↔1.0 的 CSS 近似）、右键取消
   *  （TryRemovingBuff：非 debuff 播 SoundID 12=menuTick）、背包打开时隐藏 */
  private buildBuffBar() {
    this.buffBar = el('div');
    // 11×38=418 行宽 = 原版 num2=11 行卷绕，行距 50-32=18（纵排 bug 修复：此前
    // 缺 flex-direction 显式声明且行宽 412 装不下第 11 个）
    // ★BJ414（2026-09-30 用户实报）容器空白不拦世界输入：原版 mouseInterface 只在
    //  【逐图标矩形】悬停时置位（DrawBuffIcon Main.cs:44065 `mouseX<x+32 && mouseY<y+32
    //  && mouseX>x && mouseY>y`），容器空白（行内右侧空档/行间隙/图标后空带）不置位=
    //  点击照常攻击。此前容器 pointer-events:auto → 418px 整带实机普查 54% 面为
    //  空白拦截（docs/evidence/bj414/）。修 = 容器吃 .sw-root 的 pointer-events:none
    //  （空白→elementFromPoint 落 canvas=世界输入），命中面收窄到 .sw-buff 块
    //  （类上 pointer-events:auto 保有）+32×32 图标矩形 ≙ 原版逐图标面。
    this.buffBar.style.cssText = 'position:fixed; top:76px; left:32px; display:flex; flex-direction:row; flex-wrap:wrap; width:418px; column-gap:6px; row-gap:18px; align-content:flex-start;';
    this.root.appendChild(this.buffBar);
    this.buffBlocks.clear();
    this.petBuffBlocks.clear();
    this.mountBuffBlocks.clear();
    this.nebulaBuffBlocks.clear();
    // 块按激活顺序动态创建（原版按 buff 槽序全量显示，无白名单——此前硬编码
    // 19 种，战斗/镇静/挖矿/糖分冲刺等 20+ 种永不显示）
  }

  /** buff 悬停即时气泡——原版悬停走 MouseTextHackZoom(buffName,buffTooltip)
   *  （Main.cs:43964-43974）与物品 tooltip 同字体同底板;本仓曾用浏览器原生
   *  title（出泡延迟秒级、样式不可控），改复用 sw-tooltip 面板（九宫底+brightness
   *  脉冲+18px 边距屏幕钳制，定位式与物品槽路径 ：2036-2043 同款）。文本由三个
   *  buff 通道（普通/宠物/星云）在 refreshBuffs 里写 data-sw-tip-* 再入此口 */
  private showBuffTooltip(anchor: HTMLElement, name: string, desc: string): void {
    let html = `<span style="color:#ffffff">${name}</span>`;
    for (const ln of desc.split('\n')) if (ln) html += `<br>${ln}`;
    this.tooltip.innerHTML = `<div class="sw-tooltip-lines">${html}</div>`;
    this.tooltip.style.display = 'block';
    this.tooltipFollowsCursor = false;   // ★BJ669e2：元素锚路径=不进 mousemove 跟随臂
    this.startTooltipPulse();
    // ★SW-TT1 同族③：与 showTooltipFor 同序——清旧 left/top 约束量自然宽 → 定位
    //   钳制 → 终布局后烘底（旧序定位前烘底，定位回弹后 repeat 平铺出右缘凸块）
    this.tooltip.style.left = '0px';
    this.tooltip.style.top = '0px';
    const r = anchor.getBoundingClientRect();
    const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
    let left = r.right + 8, top = r.top;
    if (left + tw > window.innerWidth - 18) left = Math.max(0, window.innerWidth - tw - 18);
    if (top + th > window.innerHeight - 18) top = Math.max(0, window.innerHeight - th - 18);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
    this.applyTooltipBg();
  }

  private hideBuffTooltip(): void {
    this.tooltip.style.display = 'none';
    cancelAnimationFrame(this.tooltipPulseRaf);
  }

  /** ★2026-09-13 反馈轮6:vinv 域钮 hover 名统一走自有气泡(showBuffTooltip),弃原生
   *  title(浏览器原生气泡延迟 ~1s 且样式不符)。textFn 惰性求值——hover 瞬间读当前态。 */
  private vinvBindHoverTip(btn: HTMLElement, textFn: () => string): void {
    btn.addEventListener('mouseenter', () => this.showBuffTooltip(btn, textFn(), ''));
    btn.addEventListener('mouseleave', () => this.hideBuffTooltip());
  }

  /** 单个 buff 块（原版 DrawBuffIcon Main.cs:42725 的 DOM 化）。
   *  t=null 时为宠物 buff 通道块（BuffType 无宠物成员，不进 BuffState.active）：
   *  无倒计时（buffNoTimeDisplay）+ 右键 = 收宠（原版 TryRemovingBuff
   *  Main.cs:42788 → CheckBuffHideMisc :42808：右键宠物 buff 图标即 hideMisc 翻转）。
   *  mountChannel=true 时为坐骑 buff 通道块（★BJ405-D1）：右键 = 下马
   *  （TryRemovingBuff 坐骑支 Main.cs:44100-44103 CheckBuff→TryDismount 顶替 DelBuff） */
  private makeBuffBlock(t: BuffType | null, petSlot: 0 | 1 = 0, mountChannel = false): { block: HTMLElement; icon: ImageBitmap | HTMLImageElement; time: HTMLElement } {
    const block = el('div', 'sw-buff');
    block.style.display = 'none';
    block.style.cssText += 'position:relative; width:32px; height:32px; background:none; border:none; border-radius:0; cursor:pointer; flex:0 0 auto;';
    const icon = el('img') as HTMLImageElement;
    icon.draggable = false;
    // 原版 buffAlpha（Main.cs:42732/42750-42777）：基准 0.4、悬停渐亮至 1.0、
    // 离开回落 0.4——alpha 通道本身（Color×alpha），非 brightness
    icon.style.cssText = 'width:32px; height:32px; image-rendering:pixelated; display:block; opacity:0.4; transition:opacity 0.2s linear;';
    block.appendChild(icon);
    const time = el('span', '', '');
    // ★BJ414：时长文字非命中面——原版 DrawBuffIcon 悬停矩形=图标贴图本身（:44065
    //  只测 x..x+Width/y..y+Height）,图标下的时长文字（:44049-44064 DrawString）不可
    //  悬停=该域世界输入照常。span left/right:-4px 外溢块外,不置 none 会拦图标下方
    //  一条 40×16 的世界输入面
    time.style.cssText = 'pointer-events:none; position:absolute; left:-4px; right:-4px; top:34px; text-align:center; font-size:11px; font-weight:bold; color:#fff; text-shadow:1px 1px 0 #000; white-space:nowrap;';
    block.appendChild(time);
    // 悬停提亮（原版 buffAlpha 悬停 +0.1/t 至 1、离开 -0.05/t 至 0.4 的 CSS 近似）
    block.addEventListener('mouseenter', (e) => {
      icon.style.opacity = '1';
      const nm = (e.currentTarget as HTMLElement).dataset.swTipName ?? '';
      if (nm) this.showBuffTooltip((e.currentTarget as HTMLElement), nm, (e.currentTarget as HTMLElement).dataset.swTipDesc ?? '');
    });
    block.addEventListener('mouseleave', () => {
      icon.style.opacity = '0.4';
      this.hideBuffTooltip();
    });
    // 右键取消（TryRemovingBuff Main.cs:44093-44117 → buffRightClickRemovable 门）：
    //  `!debuff[b] && b != 60 && b != 151` 才 DelBuff + SoundID 12——debuff 表成员
    //  （147 旗帜/332-334 饥饿链/87 篝火/157 和平蜡烛/158 星瓶/21 药水病/28 狼人等）
    //  与 60 水晶叶/151 吸魂静默拒绝（不删不响,1:1）。★BJ405：随从伴生 buff 全族
    //  过门照删——消散由 Game.maintainMinionBuffs 槽位门接管（buff 槽=召唤活体凭证,
    //  删除即取消召唤,次 tick 在役随从 m.dead）。宠物 buff 走 CheckBuffHideMisc
    //  收宠（togglePetSlot 内自带 Sound 12）,不走 buffs.remove。
    //  坐骑支（mount.CheckBuff→TryDismount :44100-44103）= mountChannel 通道块承接
    //  （★BJ405-D1 落刀：坐骑 buff 出栏,右键下马——dismountFromBuffBar）
    block.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.hideBuffTooltip();   // 右键后块可能消失/上移，先收气泡
      if (!this.game) return;
      if (mountChannel) this.dismountFromBuffBar();
      else if (t === null) this.game.togglePetSlot(petSlot);
      else if (buffRightClickRemovable(t)) {
        this.game.player.buffs.remove(t);
        this.game.sfx.play('menuTick');
      }
      this.refreshBuffs();
    });
    return { block, icon, time };
  }

  buffBar: HTMLElement | null = null;
  buffBlocks = new Map<BuffType, { block: HTMLElement; icon: ImageBitmap | HTMLImageElement; time: HTMLElement }>();
  /** buff 键集合签名（tickBuffLive 每帧比对，变更才整刷——见该函数注） */
  private _buffSig = ' ';   // 初值必不等于任何真实签名 → 首帧 tickBuffLive 即整刷一次
  /** 宠物 buff 显示通道（key = 装备槽 0=宠物 / 1=光宠）。不进 buffBlocks：
   *  BuffType 未扩 62 个宠物成员，宠物 buff 也不在 BuffState.active 里——
   *  原版 UpdatePet/UpdatePetLight（Player.cs:17147-17187）装备槽 buffType 经
   *  AddBuff(buff,3600) 恒刷新入 buff 槽即"宠物存在标志"，UI 直接由装备槽派生。
   *  ★SW-FX2（2026-09-09）：宠物 buff 已入 BuffState（UpdatePet 补挂面 →
   *  Game.updatePetSlot），通道注中「不在 BuffState.active 里」已失效——普通循环
   *  对宠物 buff 一律跳过（petVanillaBuffs 哨兵集），图标仍由本通道独家承载，
   *  防同一 Buff_42 出现双图标；右键收宠（CheckBuffHideMisc）语义在通道块 */
  petBuffBlocks = new Map<0 | 1, { block: HTMLElement; icon: ImageBitmap | HTMLImageElement; time: HTMLElement }>();
  /** vanilla-pets.json 全表伴生 buff 集（普通循环跳过哨兵；懒建一次，同
   *  Game.petBuffKinds 口径） */
  private static _petVanillaBuffs: Set<number> | null = null;
  /** ★红队 R2-N3:测试清账面(懒建哨兵集并入 mod 宠物后) */
  static _resetPetSentinelForTests(): void { UI._petVanillaBuffs = null; }
  private static petVanillaBuffs(): Set<number> {
    if (!UI._petVanillaBuffs) {
      const s = new Set<number>();
      for (let vid = 1; vid <= 5700; vid++) {
        const pi = petInfoOfVid(vid);
        if (pi) s.add(pi.buff);
      }
      for (const mp of modPetEntries()) s.add(mp.buff);   // ★刀3-2:mod 宠物伴生 buff 入哨兵集
      UI._petVanillaBuffs = s;
    }
    return UI._petVanillaBuffs;
  }

  /** 坐骑 buff 显示通道（★BJ405-D1；key 恒 0 = 单坐骑）。原版坐骑 buff = 真 buff 槽
   *  成员（SetMount AddBuff(buff,3600) Mount.cs:6291 + 每 tick buffTime=10 重钉
   *  Player.cs:9968-9971），本仓以 mount.active 单一真源表达（Mounts.ts setMount 注
   *  承运），图标由此派生通道独家承载、普通循环跳过（mountVanillaBuffs 哨兵）防
   *  374/377/384/391/392 双图标；右键 = 下马（TryRemovingBuff 坐骑支 :44100-44103，
   *  dismountFromBuffBar）。矿车族 buff（184/118 等）不在本通道——矿车=cart.mounted
   *  独立模型（Minecart.ts 承运,不进 MountInstance）,登记残债 */
  mountBuffBlocks = new Map<0, { block: HTMLElement; icon: ImageBitmap | HTMLImageElement; time: HTMLElement }>();
  /** vanilla-mounts.json BUFF_TO_MOUNT 全表伴生 buff 集（66 坐骑 =
   *  BuffID.Sets.MountType 表 BuffID.cs:152 等价;普通循环跳过哨兵,懒建一次） */
  private static _mountVanillaBuffs: Set<number> | null = null;
  private static mountVanillaBuffs(): Set<number> {
    if (!UI._mountVanillaBuffs) {
      UI._mountVanillaBuffs = new Set(Object.keys(BUFF_TO_MOUNT).map(Number));
    }
    return UI._mountVanillaBuffs;
  }

  /** 坐骑通道签名位（mount.active → buff id,未骑恒 0）：进出骑乘态当帧触发整刷
   *  （原版 buff 槽生灭同帧可见;纯 1Hz 刷新会拖 ≤1s 图标残影） */
  private mountBarSig(): number {
    const m = this.game?.player?.mount;
    return m && m.active ? Math.max(0, m.buff) : 0;
  }

  /** 右键坐骑 buff 下马（★BJ405-D1；Main.TryRemovingBuff 坐骑支 :44100-44103 1:1）：
   *  `mount.Active && mount.CheckBuff(b)` → TryDismount（canDismount 空间门内联,
   *  FailedNoSpace 单次拒绝——无 QuickMount 三连败链,坐骑与图标保持）;Sound 12 在
   *  flag 判定之前恒响（:44107）;DelBuff 被 flag=true 顶替（buff 消失=Dismount 内
   *  ClearBuff :6214 的派生面,即下坐本身）。抚摸随下坐终止（Dismount :6229-6231,
   *  本仓同 Game.tryDismountMount 外置惯例） */
  private dismountFromBuffBar(): void {
    const p = this.game.player;
    if (!p.mount.active) return;   // CheckBuff 门（通道块只在骑乘态显示,双保险）
    if (p.petting.mount) p.stopPettingAnimal();
    p.mount.tryDismount(p, this.game);
    this.game.sfx.play('menuTick');   // SoundID 12（:44107,失败支亦响）
  }

  /** 槽位当前应显示的宠物 buff：装备在槽 + 跟随体存活（hideMisc/玩家死亡时
   *  Game.updatePetSlot 即灭跟随体，等价原版 TogglePet 的 ClearBuff） */
  private activePetBuff(slot: 0 | 1): { buff: number; proj: number; mod: boolean } | null {
    const g = this.game;
    const item = g.player.inv.miscEquips[slot];
    if (!item) return null;
    // ★刀3-2(2026-10-13):mod 宠物反查并入(原版表 miss → MOD_PETS;buff=BuffType 域)。
    //  ★红队 R2-C1:mod 旗随行——原版件 buff=原版 buff id(数值域与仓内 BuffType
    //  枚举不同!48/83 数值碰撞),mod 件=BuffType;图标链据此分域,禁混查
    const vid = vidOf(item.id);
    const vi = petInfoOfVid(vid);
    const mi = vi ? null : modPetInfoOf(vid);
    const info = vi ? { buff: vi.buff, proj: vi.proj, mod: false }
      : mi ? { buff: mi.buff, proj: mi.proj, mod: true }
      : null;
    if (!info) return null;
    const f = slot === 0 ? g.petFollower : g.lightPetFollower;
    if (!f || f.dead || f.projId !== info.proj) return null;
    return info;
  }

  /** 每帧轻通道（红队 A1 定罪 2026-08-31：原版 DrawBuffIcon :44042-44060 每帧跑，
   *  ownedProjectileCounts 每帧重算（:12271）——随从生灭/xN 计数若只随 1Hz 全刷，
   *  击杀随从后旧计数与图标滞留 ≤1s。此轻通道只维持两帧动态面，不碰图标/tooltip：
   *  ① buff 键集合变更 → 即时整刷（随从召唤/死亡/药水到期的图标生灭当帧跟手）；
   *  ② 计数族（BuffTextHandlers）逐帧更新 "xN" 文本，值不变时零 DOM 写。 */
  /** 槽位 CD 覆盖元素缓存（key=`${where}:${i}`;槽面重建后 isConnected 失效自愈） */
  private slotCdEls = new Map<string, HTMLElement | null>();

  private slotCdEl(where: SlotWhere, i: number): HTMLElement | null {
    const key = `${where}:${i}`;
    const cached = this.slotCdEls.get(key);
    if (cached && cached.isConnected) return cached;
    const host = this.slotEl(i, where);
    if (!host) { this.slotCdEls.set(key, null); return null; }
    const cd = host.querySelector<HTMLElement>('.sw-slot-cd');
    this.slotCdEls.set(key, cd);
    return cd;
  }

  /** 同值守卫写（★BJ328/开包 hitch 同族纪律:同值不写;sig 兼 display+opacity） */
  private setSlotCd(cd: HTMLElement | null, on: boolean, alpha: number): void {
    if (!cd) return;
    const sig = on ? alpha.toFixed(3) : '';
    if (cd.dataset.cd === sig) return;
    cd.dataset.cd = sig;
    if (on) {
      cd.style.display = 'block';
      cd.style.opacity = alpha.toFixed(3);
    } else {
      cd.style.display = 'none';
    }
  }

  /** ★清偿刀 C（2026-09-29）槽位 CD 覆盖逐帧驱动（tickBuffLive 头调用=Game.ts:11513
   *  onBuffsFrame 60Hz 通道,在 tickBuffLive 自身早退门【之前】——开包态也要维持
   *  装备页覆盖面）。消费面全表（ItemSlot.cs:2693-2725）：
   *  · 关包快捷栏 0-9（context 13,Main.cs:44374）= 药水 CD 消费面①;开包时快捷栏
   *    整体早退（:44324）+面板行 context 0（:41748）→ 无覆盖——slotContext('inv',i,
   *    panelOpen) 单源同判。关包 lightColor.A 因子（:44351）:选中 225/255,未选 187/255
   *    （稳态 scale 0.75/1;±0.05/帧缓动本仓未建模）。vinv 网格 0-9 行与隐藏快捷栏同
   *    data 键（:7514 注）——开包时本循环只达隐藏面（display:none 无害同值守卫）,
   *    可见网格格 context 0 恒无覆盖=原版同相。
   *  · 装备页配饰 3-9（context 10）/矿车 misc[2]（context 18）= expertOnly 消费面②
   *    （misc 逐槽语境 19/20/18/17/16——slotGhostFrame 同源表,槽位刀映射 16 代表值
   *    不含 18,故此处逐槽枚举）;α=White×itemFade（★H②起 itemFade=getDimSlotForMouseItem
   *    真值——持物不可装备 0.5,context 10/18 才消费）。
   *  · context 34 旅程锁格：本仓无槽面,分支在纯函数（边界声明）。
   *  计时源：potionDelay = BuffType.Resistance 剩余秒×60（buff 21 逐 tick 同步
   *  Player.cs:11807-11809 同构;Buffs.active 存秒）;potionDelayTime = 3600×
   *  pStone?0.75（:25674-25683,每 tick 重算语义在读取侧同值复算）;manaPotionDelay
   *  恒 0（DebugOptions.ManaPotionDelay=false,死支——见 slotCooldownAlpha 注②）。
   *  开销：≤22 格纯读+同值守卫写（BJ270/开包 hitch 纪律）;无覆盖时 sig='' 幂等。 */
  /** ★清偿刀 H② GetDimSlotForMouseItem 装配（ItemSlot.cs:2334-2336 Draw 头逐帧取
   *  Main.mouseItem 算 itemFade;本仓重绘模型下 heldStack 变更必经 refreshAll →
   *  paintSlotChrome 同拍重算,tick 通道消费 context 10/18 CD 面）。checkItem.IsAir
   *  早退（:1337-1339）=heldStack 判空。context 0/1/2/13（inv 族）/3/4/32（chest）
   *  ∉原版 switch → 恒 1（不装配不写 CSS 变量）。misc 逐槽语境 = MISC_SLOT_CONTEXTS。 */
  private slotItemFadeFor(where: SlotWhere, i: number): number {
    if (where === 'inv' || where === 'chest') return 1;
    const held = this.heldStack;
    if (!held) return 1;
    const inv = this.game.player.inv;
    const context = where === 'misc'
      ? (MISC_SLOT_CONTEXTS[i] ?? 16)
      : slotContext(where, i, true);   // chest 已早退;panelOpen 只影响 inv 族=无关
    const unlocked = inv.isItemSlotUnlockedAndUsable(i);   // :1348/:1357 解锁臂（P 刀同源）
    let fits: boolean;
    if (where === 'armor') fits = this.armorAcceptsDrag(i, held.id);       // CanEquipInArmorSlot 面
    else if (where === 'dye' || where === 'miscDye') fits = inv.dyeAccepts(held.id);   // dye>0 面
    else fits = inv.miscAccepts(i, held.id);                               // 16-20 分类面
    return getDimSlotForMouseItem({ context, slotUnlocked: unlocked, mouseFitsSlot: fits });
  }

  private tickSlotCooldownOverlays(): void {
    const g = this.game;
    if (!g || !g.player) return;
    const p = g.player;
    const inv = p.inv;
    const panelOpen = !!this.invPanel && this.invPanel.style.display === 'block';
    const expertMode = !!(inv.gateExpert || inv.gateMaster);
    const potionDelayTicks = (p.buffs.active.get(BuffType.Resistance) ?? 0) * 60;
    const timing = {
      potionDelayTicks,
      potionDelayTimeTicks: p.equipStats.pStone ? 2700 : 3600,
      manaPotionDelayTicks: 0,
      expertMode,
      itemFade: 1,
    };
    for (let i = 0; i < 10; i++) {
      const cd = this.slotCdEl('inv', i);
      if (!cd) continue;
      const content = inv.slots[i];
      let alpha = 0;
      if (content) {
        const f = itemFuncOfVid(ITEM_DEFS[content.id]?.vid ?? -1);
        alpha = slotCooldownAlpha({
          ...timing,
          context: slotContext('inv', i, panelOpen),
          vid: ITEM_DEFS[content.id]?.vid ?? -1,
          potion: !!f?.potion,
          healMana: f?.healMana ?? 0,
          expertOnly: ITEM_DEFS[content.id]?.expertOnly === true,
        });
        if (alpha > 0 && !panelOpen) {
          alpha *= (i === inv.selected ? 225 : 187) / 255;   // Main.cs:44351 lightColor.A 稳态
        }
      }
      this.setSlotCd(cd, content != null && alpha > 0, alpha);
    }
    // 装备页（context 10/18 仅这两族有 CD 分支;8/9/11/12/16/17/19/20/33 原版无）
    const equipFaces: Array<[SlotWhere, number, number]> = [
      ['armor', 3, 10], ['armor', 4, 10], ['armor', 5, 10], ['armor', 6, 10],
      ['armor', 7, 10], ['armor', 8, 10], ['armor', 9, 10],
      ['misc', 2, 18],
    ];
    for (const [where, i, ctx] of equipFaces) {
      const cd = this.slotCdEl(where, i);
      if (!cd) continue;
      const content = this.slotContent(where, i);
      let alpha = 0;
      if (content) {
        alpha = slotCooldownAlpha({
          ...timing,
          // ★清偿刀 H②：α=White×itemFade（:2724）——itemFade 真值接入
          // （inv 族循环 context 13/0/1/2 ∉ GetDimSlotForMouseItem switch,恒 1）
          itemFade: this.slotItemFadeFor(where, i),
          context: ctx,
          vid: ITEM_DEFS[content.id]?.vid ?? -1,
          potion: false,
          healMana: 0,
          expertOnly: ITEM_DEFS[content.id]?.expertOnly === true,
        });
      }
      this.setSlotCd(cd, content != null && alpha > 0, alpha);
    }
  }

  tickBuffLive(): void {
    // ★清偿刀 C：槽位 CD 覆盖逐帧面（须在本函数早退门之前——开包态装备页覆盖仍要维持）
    this.tickSlotCooldownOverlays();
    // ★SW-FX10 债④：开包但页2(buff 列在显)不再整帧早退——列内块同样需要随从
    //  计数/生灭即时面；其余开包态(块整体不可见)照旧零开销
    const invOpen = this.invPanel?.style.display === 'block';
    const colVisible = invOpen && this._builtLayout === 'vanilla' && this.vinvPageCurrent === 2 && !!this.miscBuffCol;
    if (!this.game || (invOpen && !colVisible)) return;
    const buffs = this.game.player.buffs;
    let sig = '';
    for (const t of buffs.active.keys()) sig += t + ',';
    sig += 'm' + this.mountBarSig() + ',';   // ★BJ405-D1：骑乘态进出当帧整刷
    if (sig !== this._buffSig) { this.refreshBuffs(); return; }   // refreshBuffs 会回写 _buffSig
    for (const [t, ui] of this.buffBlocks) {
      if (ui.block.style.display === 'none') continue;
      const projs = BUFF_TEXT_PROJECTILE_COUNTER[BUFF_DEFS[t].vanillaBuff];
      if (!projs) continue;
      let n = 0;
      for (const q of this.game.entities.projectiles) {
        const pid = (q as { projId?: number }).projId;
        if (!q.dead && pid !== undefined && projs.includes(pid)) n++;
      }
      const want = n > 0 ? `x${n}` : '';
      if (ui.time.textContent !== want) ui.time.textContent = want;
    }
  }

  /** 每秒左右调用一次（由 Game 经 callbacks 驱动）。
   *  原版行为（1457 Main.cs:43933-44107）：遍历 buff 槽按序显示全部激活 buff；
   *  背包/华美 UI 打开时整栏不画；剩余时长由 DrawBuffIcon（:44049-44064）常驻
   *  画在图标正下方，经 TryGetBuffTime（:43985）门控 + LocalizedDuration 缩写
   *  格式（单最大单位，<60 秒逐秒）——见 localizedDuration */
  /** buff 块宿主（SW-FX10 债④）：开包∧vanilla 布局∧页2 → 杂项页 buff 列
   *  （原版 EquipPage==2 支 :42008-42046），否则 HUD 栏（:42618-42640+DrawBuffIcon）。
   *  refreshBuffs 的新建/整序 appendChild 一律经此——两态同一批块对象,零复制 */
  private get buffHost(): HTMLElement {
    const invOpen = this.invPanel?.style.display === 'block';
    return (invOpen && this.miscBuffCol && this._builtLayout === 'vanilla' && this.vinvPageCurrent === 2)
      ? this.miscBuffCol
      : this.buffBar!;
  }

  /** buff 块容器 reflow（SW-FX10 债④）：页切换/布局变化后把三通道块按序搬入当前
   *  宿主。块在 buffBar 内走 flex 流（position:relative 已由类/内联给足）,入列后
   *  改绝对定位（miscBuffCellXY 列向左/行向下）;回流 buffBar 时还原。由
   *  vinvApplyPage 与 refreshBuffs 头部调用 */
  private reflowBuffs(): void {
    if (!this.buffBar) return;
    const host = this.buffHost;
    const c = this.vinvLayoutCtx;
    const rows = c ? miscBuffRowsPerCol(c.sh, c.minimapOn) : 3;
    const inCol = host === this.miscBuffCol && !!this.miscBuffCol;
    const pools = [this.buffBlocks, this.petBuffBlocks, this.mountBuffBlocks, this.nebulaBuffBlocks];
    for (const pool of pools) {
      let n = 0;
      for (const ui of pool.values()) {
        const b = ui.block;
        if (inCol && this.miscBuffCol) {
          const cell = miscBuffCellXY(n, rows);
          b.style.position = 'absolute';
          b.style.left = `${cell.x}px`;
          b.style.top = `${cell.y}px`;
          if (b.parentElement !== this.miscBuffCol) this.miscBuffCol.appendChild(b);
        } else {
          b.style.position = 'relative';
          b.style.left = '';
          b.style.top = '';
          if (b.parentElement !== this.buffBar) this.buffBar.appendChild(b);
        }
        n++;
      }
    }
  }

  refreshBuffs() {
    if (!this.game || !this.buffBar) return;
    this.reflowBuffs();
    const buffs = this.game.player.buffs;
    const invOpen = this.invPanel.style.display === 'block';
    // ★收气泡只走“栏隐藏”边沿（2026-08-28 用户报"hover 道具气泡过一会自己消失"）：
    //  .sw-tooltip 元素为 Buff 气泡与【物品详情气泡】共用——曾每秒无条件收,
    //  背包开着时把物品气泡也一并秒杀。边沿 = 栏从可见转隐藏的那一帧收一次
    const barWas = this.buffBar.style.display !== 'none';
    this.buffBar.style.display = invOpen ? 'none' : 'flex';
    if (invOpen && barWas) this.hideBuffTooltip();   // 可见→隐藏边沿,一次收气泡
    const seen = new Set<BuffType>();
    for (const [t, left] of buffs.active) {
      seen.add(t);
      // ★SW-FX2：宠物 buff（UpdatePet 补挂面入 BuffState）图标由上方宠物通道独家
      //  承载（无倒计时+右键收宠,原版 TryRemovingBuff→CheckBuffHideMisc :42788/:42808
      //  同面）——普通循环跳过,防同 buff 双图标
      if (UI.petVanillaBuffs().has(BUFF_DEFS[t].vanillaBuff)) continue;
      // ★BJ405-D1：坐骑伴生 buff（66 坐骑全表,含 374/377/384/391/392 五个在册
      //  BuffType 成员）图标由坐骑通道独家承载（无倒计时+右键下马=TryRemovingBuff
      //  坐骑支）——普通循环跳过,防同 Buff_*.png 双图标
      if (UI.mountVanillaBuffs().has(BUFF_DEFS[t].vanillaBuff)) continue;
      let ui = this.buffBlocks.get(t);
      if (!ui) {
        // 动态建块：无白名单，任何激活 buff 都显示（原版按 buff 槽序）
        ui = this.makeBuffBlock(t);
        this.buffHost.appendChild(ui.block);   // SW-FX10 债④:宿主随开包页2 reflow
        this.buffBlocks.set(t, ui);
      }
      ui.block.style.display = 'flex';
      ui.block.dataset.swTipName = buffName(t);
      // 旗帜(147)：描述后追加名单行（Main.cs:21558-21612 bannerMouseOver 第二循环
      // 1:1——按 BannerSystem 旗种枚举,BannerToNPC(i) 每旗种一行代表名;此前用
      // 全覆盖集逐变体罗列=多 NPC 旗名单重复（2026-09-01 用户实报））
      let tipDesc = buffDesc(t);
      if (BUFF_DEFS[t].vanillaBuff === 147 && this.game) {
        const bn = bannerBuffNames(this.game.bannerRepIds(), (id) => Lang.npcName(id));
        if (bn) tipDesc += '\n' + bn;
      }
      ui.block.dataset.swTipDesc = tipDesc;
      // 原版 DrawBuffIcon（Main.cs:42736）：TextureAssets.Buff[type] 原大绘制——
      // 用原版 Buff_{vanillaBuff} 贴图（2026-08-13 前：误用对应药水物品图标）
      const want = remasterBuffIcon?.(BUFF_DEFS[t].vanillaBuff)
        ?? `/sprites/vanilla/Buff_${BUFF_DEFS[t].vanillaBuff}.png`;
      if (!(ui.icon as HTMLImageElement).src.endsWith(want)) {
        (ui.icon as HTMLImageElement).onerror = () => {
          // 素材缺失兜底：退回药水物品图标（缺表时仍可见）
          const iconId = this.buffIconItem.get(t);
          if (iconId && this.game) (ui.icon as HTMLImageElement).src = iconUrl(this.game, iconId);
          (ui.icon as HTMLImageElement).onerror = null;
        };
        (ui.icon as HTMLImageElement).src = want;
      }
      // 时长门（1457 Main.cs:43985-44054）= TryGetBuffTime(:44029-44040) 拒答面 +
      // DrawBuffIcon(:44058) 的 buffTime>2【tick】出字门。拒答四支：
      // ① buffNoTimeDisplay 表（BUFF_NO_TIME_DISPLAY——工位五件套/狼人/宠物族等 124 项，
      //    磨刀石 159 即属此：右键 30 分钟全程无倒计时字样）；
      // ② 蜜中 honeyWet 不显示 Honey(48)（`(!honeyWet || num != 48)`，:44031）；
      // ③ 湿身+专家不显示 Chilled(46)（`(!wet || !expertMode || num != 46)`，wet≙三液并集）；
      // ④ vampireSeed 下火系三连(24/23/32) <10 tick 不出字——日光炽灼三连每帧 3t 续期
      //    恒 <10t,图标上永不显示时长
      const ticksLeft = left * 60;
      const vb = BUFF_DEFS[t].vanillaBuff;
      const vampHideTime = !!this.game.world.seedFlags?.vampireSeed
        && [24, 23, 32].includes(vb) && ticksLeft < 10;
      const p = this.game.player;
      const tryGetTime = !BUFF_NO_TIME_DISPLAY.has(vb)
        && !(vb === 48 && p.inHoney)
        && !(vb === 46 && (p.inWater || p.inLava || p.inHoney) && this.game.world.isExpert);
      // 图标文字（Main.cs:44051-44059 DrawBuffIcon）：BuffTextHandlers 在册族（随从 28 项，
      // BuffID.cs:36-145）先于时长——ownedProjectileCounts 按弹型求和 >0 → "x"+n，
      // =0 → null 回落时长路径（noTimeDisplay 拒答 → 无字）；其余走时长门
      const counterProjs = BUFF_TEXT_PROJECTILE_COUNTER[vb];
      let timeText: string;
      if (counterProjs) {
        let n = 0;
        for (const q of this.game.entities.projectiles) {
          const pid = (q as { projId?: number }).projId;
          if (!q.dead && pid !== undefined && counterProjs.includes(pid)) n++;
        }
        timeText = n > 0 ? `x${n}` : '';
      } else {
        // buffTime/60 先整除到秒再格式化（Main.cs:44053 new TimeSpan(0,0,buffTime/60)）
        timeText = !tryGetTime || vampHideTime || ticksLeft <= 2 ? '' : localizedDuration(left);
      }
      ui.time.textContent = timeText;
    }
    for (const [t, ui] of this.buffBlocks) {
      if (!seen.has(t)) ui.block.style.display = 'none';
    }
    {  // 回写键集合签名（tickBuffLive 的变更检测基准）
      let sig = '';
      for (const t of buffs.active.keys()) sig += t + ',';
      sig += 'm' + this.mountBarSig() + ',';   // ★BJ405-D1：坐骑通道签名位同源
      this._buffSig = sig;
    }
    // ---- 宠物/光宠 buff（独立通道；原版同栏追加在普通 buff 之后，无倒计时） ----
    const petStates = ([0, 1] as const).map((slot) => {
      const pb = this.activePetBuff(slot);
      let ui = this.petBuffBlocks.get(slot);
      if (pb && !ui) {
        ui = this.makeBuffBlock(null, slot);
        this.petBuffBlocks.set(slot, ui);
      }
      return { pb, ui };
    });
    for (const { pb, ui } of petStates) {
      if (!ui) continue;
      const u = ui; // const 别名（闭包内保留窄化）
      if (!pb) {
        u.block.style.display = 'none';
        continue;
      }
      u.block.style.display = 'flex';
      // 名/描述 = Lang.buffName/buffDesc（BuffName/BuffDescription.<Internal>，
      //  62 款宠物 buff 全有内名；缺名回退投射物名）
      const nm = Lang.buffName(pb.buff) ?? Lang.projectileName(pb.proj);
      u.block.dataset.swTipName = nm ?? '';
      u.block.dataset.swTipDesc = nm ? (Lang.buffDesc(pb.buff) ?? '') : '';
      // buffNoTimeDisplay：宠物 buff 不显示剩余时长（原版 TryGetBuffTime 不出文字）
      u.time.textContent = '';
      // ★刀3-2:mod 宠物 buff=BuffType 域 → 经 BUFF_DEFS 反解 pseudoVanilla 走 mod 图标
      //  通道(modBuffIconUrl objectURL)。★红队 R2-C1 域门修正:仅 mod 件反解——
      //  原版件 buff=原版 id 直用(数值域与 BuffType 枚举不同,混查=47/83 图标错挂)
      const petBuffVanilla = pb.mod ? (BUFF_DEFS[pb.buff as BuffType]?.vanillaBuff ?? pb.buff) : pb.buff;
      const want = remasterBuffIcon?.(petBuffVanilla) ?? `/sprites/vanilla/Buff_${petBuffVanilla}.png`;
      if (!(u.icon as HTMLImageElement).src.endsWith(want)) {
        (u.icon as HTMLImageElement).onerror = () => {
          // 素材缺失兜底：退回宠物投射物贴图 Projectile_<proj>.png
          (u.icon as HTMLImageElement).onerror = null;
          (u.icon as HTMLImageElement).src = `/sprites/vanilla/Projectile_${pb.proj}.png`;
        };
        (u.icon as HTMLImageElement).src = want;
      }
    }
    // 恒置普通 buff 之后（原版 AddBuff 找空槽追加）：末位不符才整序（免每秒 DOM 抖动）
    // ★SW-FX10 债④：宿主面随 buffHost（开包页2 = 杂项列,否则 HUD 栏）
    const liveBlocks = petStates.filter((s) => s.pb && s.ui).map((s) => s.ui!.block);
    if (liveBlocks.length && this.buffHost.lastElementChild !== liveBlocks[liveBlocks.length - 1]) {
      for (const b of liveBlocks) this.buffHost.appendChild(b);
    }
    // ---- 坐骑 buff（★BJ405-D1 派生通道；原版同 buff 槽成员：SetMount AddBuff(buff,3600)
    //      Mount.cs:6291 + 每 tick buffTime=10 重钉 Player.cs:9968-9971——本仓 mount.active
    //      单一真源（Mounts.ts setMount 注承运）,图标/悬停名描述由本通道独家承载。
    //      无时长字 = Main.cs:9345-9352 循环段对全 MountType buff 置 buffNoTimeDisplay
    //      （+buffNoSave 双置位;★P4 锚勘误 2026-09-30:旧引 :9342-9349 漂移）。
    //      右键 = 下马（TryRemovingBuff 坐骑支 :44100-44103 → dismountFromBuffBar）。
    //      追加序在宠物后（原版 AddBuff 找空槽追加同idiom）,矿车族不在本通道（登记）----
    const mountBuff = this.game.player.mount.active ? this.game.player.mount.buff : -1;
    if (mountBuff >= 0 && !this.mountBuffBlocks.get(0)) {
      this.mountBuffBlocks.set(0, this.makeBuffBlock(null, 0, true));
    }
    const mui = this.mountBuffBlocks.get(0);
    if (mui) {
      if (mountBuff < 0) {
        mui.block.style.display = 'none';
      } else {
        mui.block.style.display = 'flex';
        // 名/描述：在册五伴生（374/377/384/391/392）走 BUFF_DEFS 自有键,其余 61 走
        // 原版语料 BuffName.<Internal>（LANG.BuffName 已收 64 款原版坐骑 buff）
        const mbtv = buffTypeByVanilla(mountBuff);
        const mnm = mbtv !== undefined ? buffName(mbtv) : Lang.buffName(mountBuff);
        mui.block.dataset.swTipName = mnm ?? '';
        mui.block.dataset.swTipDesc = mbtv !== undefined ? buffDesc(mbtv) : (Lang.buffDesc(mountBuff) ?? '');
        mui.time.textContent = '';   // buffNoTimeDisplay 全 66（Main.cs:9345-9352）
        const mwant = remasterBuffIcon?.(mountBuff) ?? `/sprites/vanilla/Buff_${mountBuff}.png`;
        if (!(mui.icon as HTMLImageElement).src.endsWith(mwant)) {
          (mui.icon as HTMLImageElement).src = mwant;
        }
        if (this.buffHost.lastElementChild !== mui.block) this.buffHost.appendChild(mui.block);
      }
    }
    // ---- 星云增益派生通道（补 C ⚠️图标批：原版拾取星云 booster 即 AddBuff
    //      173-181（NebulaLevelup Player.cs:56091-56121），buff 栏随档位显示
    //      Buff_173-181.png；本仓等级/效果在 Player.nebula 主状态（效果消费
    //      :1606/:1633/:3740-3746 已接），此处补图标派生层——等级>0 的族出块，
    //      图标随档位换 Buff_{base+lvl-1}.png，倒计时=nebulaT）----
    const nebStates = ([0, 1, 2] as const).map((fam) => {
      const nb = this.game!.player.nebulaBuffIcons().find((n) => n.fam === fam) ?? null;
      let ui = this.nebulaBuffBlocks.get(fam);
      if (nb && !ui) {
        ui = this.makeNebulaBlock(fam);
        this.nebulaBuffBlocks.set(fam, ui);
      }
      return { nb, ui };
    });
    for (const { nb, ui } of nebStates) {
      if (!ui) continue;
      const u = ui;
      if (!nb) {
        u.block.style.display = 'none';
        continue;
      }
      u.block.style.display = 'flex';
      u.block.dataset.swTipName = Lang.buffName(nb.vanillaBuff) ?? '星云';
      u.block.dataset.swTipDesc = Lang.buffDesc(nb.vanillaBuff) ?? '';
      u.time.textContent = Lang.text('Mods.SandboxWorld.Time.Seconds', nb.secs);
      const want = remasterBuffIcon?.(nb.vanillaBuff) ?? `/sprites/vanilla/Buff_${nb.vanillaBuff}.png`;
      if (!(u.icon as HTMLImageElement).src.endsWith(want)) {
        (u.icon as HTMLImageElement).src = want;
      }
    }
    const liveNeb = nebStates.filter((s) => s.nb && s.ui).map((s) => s.ui!.block);
    if (liveNeb.length) {
      const last = liveNeb[liveNeb.length - 1];
      if (this.buffHost.lastElementChild !== last) for (const b of liveNeb) this.buffHost.appendChild(b);
    }
  }

  /** 星云增益派生块（key = 族 0 伤/1 命/2 魔）。不进 BuffState——等级真值在
   *  Player.nebula（NebulaLevelup :56091 逐级升/降），右键取消 = nebulaCancel
   *  （原版右键 DelBuff → UpdateBuffs_NebulaBuffs :11660 派生链断,效果即停） */
  nebulaBuffBlocks = new Map<0 | 1 | 2, { block: HTMLElement; icon: ImageBitmap | HTMLImageElement; time: HTMLElement }>();

  private makeNebulaBlock(fam: 0 | 1 | 2): { block: HTMLElement; icon: ImageBitmap | HTMLImageElement; time: HTMLElement } {
    const block = el('div', 'sw-buff');
    block.style.display = 'none';
    block.style.cssText += 'position:relative; width:32px; height:32px; background:none; border:none; border-radius:0; cursor:pointer; flex:0 0 auto;';
    const icon = el('img') as HTMLImageElement;
    icon.draggable = false;
    icon.style.cssText = 'width:32px; height:32px; image-rendering:pixelated; display:block; opacity:0.4; transition:opacity 0.2s linear;';
    block.appendChild(icon);
    const time = el('span', '', '');
    // ★BJ414：时长文字非命中面——原版 DrawBuffIcon 悬停矩形=图标贴图本身（:44065
    //  只测 x..x+Width/y..y+Height）,图标下的时长文字（:44049-44064 DrawString）不可
    //  悬停=该域世界输入照常。span left/right:-4px 外溢块外,不置 none 会拦图标下方
    //  一条 40×16 的世界输入面
    time.style.cssText = 'pointer-events:none; position:absolute; left:-4px; right:-4px; top:34px; text-align:center; font-size:11px; font-weight:bold; color:#fff; text-shadow:1px 1px 0 #000; white-space:nowrap;';
    block.appendChild(time);
    block.addEventListener('mouseenter', () => { icon.style.opacity = '1'; });
    block.addEventListener('mouseleave', () => { icon.style.opacity = '0.4'; });
    block.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.game) return;
      this.game.player.nebulaCancel(fam);
      this.game.sfx.play('menuTick');          // SoundID 12（Main.cs:42793 非 debuff 取消）
      this.refreshBuffs();
    });
    this.buffBar?.appendChild(block);
    return { block, icon, time };
  }

  // Buff → 物品图标（仅作原版 Buff 贴图缺失时的兜底——正道是 Buff_{vanillaBuff}.png）
  buffIconItem = new Map<BuffType, number>();

  private buildChestPanel() {
    this.chestPanel = el('div', 'sw-panel');
    this.chestPanel.style.cssText = 'position:fixed; left:50%; top:16%; transform:translateX(-50%); display:none;';
    this.chestTitle = el('div', 'sw-title', Lang.text('Mods.SandboxWorld.UI.Chest'));
    this.chestPanel.appendChild(this.chestTitle);
    const grid = el('div');
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(10, var(--slot)); gap:5px;';
    // 按 40 槽上限构建（玩家储物 bank×4）；打开时按容器实际长度显隐（宝箱 10 / 储物 40）
    for (let i = 0; i < 40; i++) {
      grid.appendChild(this.makeSlotEl(i, 'chest'));
    }
    this.chestGrid = grid;
    this.chestPanel.appendChild(grid);
    // ---- 箱子三按钮（ChestUI.DrawButtons :182-260：LootAll/DepositAll/QuickStack） ----
    const btns = el('div');
    btns.style.cssText = 'display:flex; gap:6px; margin-top:8px;';
    const mkBtn = (label: string, act: () => void) => {
      const b = el('button', 'sw-btn', label);
      b.style.cssText = 'margin:0; padding:6px 10px; font-size:12px; flex:1;';
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        act();
      });
      btns.appendChild(b);
    };
    mkBtn(Lang.text('LegacyInterface.29'), () => this.chestLootAll());       // 全部取出
    mkBtn(Lang.text('LegacyInterface.30'), () => this.chestDepositAll());    // 存入全部（MoveCoins 钱币归并 + 10-49 全物品,1:1）
    mkBtn(Lang.text('LegacyInterface.31'), () => this.chestQuickStack());    // 快速堆叠（只堆箱内已有类型）
    this.chestPanel.appendChild(btns);
    this.root.appendChild(this.chestPanel);
  }

  /** Loot All（ChestUI.LootAll ChestUI.cs:389-412,DrawButtons 左键 :282）：箱内全部入包，
   *  装不下的留在箱里。★vault 允许面（2026-08-31 台账"多通道"清偿）：settings 按
   *  `player.chest > -1` 二选一（:391-392）——真箱=LootAllFromChest
   *  (CanGoIntoVoidVault=true),bank 面板（本仓 openChest.x<0 的 -2..-5 约定,
   *  :414-465 分支)=LootAllFromBank(default=false)。允许时余量经
   *  Player.depositIntoVoidVault（GetItem_VoidVault Player.cs:39710——questItem/3822
   *  拒收门 + DoCoins 主背包尾随都在内闭环）溢流灌虚空袋。
   *  -5 虚空袋面板另有收藏锁（ChestUI.cs:443-452 `!bank4.item[l].favorited` :447——
   *  唯一带此判定的容器分支,其他面板无）。Grab 音=有实际搬移才播（原版逐 GetItem
   *  事件播,本仓单次,同 DepositAll 登记式）。 */
  private chestLootAll(): void {
    const chest = this.openChest;
    if (!chest) return;
    const inv = this.game.player.inv;
    const spill = chestSettingsAllowsVault(chest.x)
      ? (itemId: number, stack: number): number => this.game.player.depositIntoVoidVault(itemId, stack)
      : undefined;
    const moved = lootAllFromContainer(inv,
      chest.items as Array<{ id: number; stack: number; prefix?: number; favorited?: boolean } | null>,
      spill,
      { skipFavorited: chest.x === -5,
        // 成就：Loot All 入包拾取通知（Player.GetItem 主背包/VoidVault 各填充支
        // NotifyItemPickup,Player.cs:39765-39882——按实际落袋数回传）
        onPickup: (internalId, _picked) => {
          const v = vidOf(internalId);
          if (v > 0) this.game.achievements.notifyItemPickup(v);
        } });
    if (moved) this.game.sfx.play('pickup');
    this.refreshAll();
  }

  /** Deposit All（ChestUI.DepositAll :536-…+MoveCoins :998-1203）1:1：
   *  ① MoveCoins：容器内钱币全清按面额记账（原面额档随槽记 array2,槽入 list2 找零池,
   *     空格同入 list2）→ 玩家全格钱币并入（j!=58,跳收藏,list=被清的原币格升序）→
   *     进位（100 小币=1 大币 ×3 档）→ 容器槽按【原面额档】回填（钱币 maxStack=100
   *     钳制;:35886-35910）→ 溢出面额沿原币格序回填（每槽一档取最大余档;:35911-35943）
   *     → 普通空格收剩余（:35944-35970）→ 玩家剩余零钱回被清的原币格（:35972-35992,
   *     有回填即 flag=false=不播 Grab,Main.cs:35993-35996）。
   *  ② 通用搬移：背包 10-49 降序（不含热键栏 0-9,:35559）跳收藏——可堆叠先并已有堆
   *     （CanStack=同型同词缀 Item.cs:49870-49877）余量入首个空格（:35779-35793）。
   *  原版无“跳过已有类型”/“钱币排除”过滤（2026-08-28 用户问“非钱币放入正常吗”——
   *  正常:猪猪存钱罐/保险箱=40 格通用容器,原版本就全物品放入）。 */
  private chestDepositAll(): void {
    const chest = this.openChest;
    if (!chest) return;
    const inv = this.game.player.inv;
    const items = chest.items;
    const denom = (id: number) => coinIndexOf(id);            // 0 铜..3 铂（=原版 71+num-1 档）
    const coinId = (d: number) => ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[71 + d]];
    const coinMax = (d: number) => ITEM_DEFS[coinId(d)]?.maxStack ?? 100;   // ★方案 A：`?.` 洞守卫（BJ265）
    let anythingMoved = false;                                // 有实际搬移 → 收尾播 Grab
    // ---- ① MoveCoins（:998-1203）----
    const tally = [0, 0, 0, 0];                               // array[0铜..3铂]
    const tier = new Array<number>(items.length).fill(-1);    // array2：槽原面额档/-1
    const fillable: number[] = [];                            // list2：可收找零槽
    const playerCoinSlots: number[] = [];                     // list：玩家被清的原币格（升序）
    let coinNetOut = false;                                   // flag
    for (let i = 0; i < items.length; i++) {
      const cs = items[i];
      if (!cs || cs.stack < 1) { fillable.push(i); items[i] = null; continue; }   // 空格入池（:35910-35914）
      const d = denom(cs.id);
      if (d >= 0) {                                           // 容器币清账（:35915-35942）
        tally[d] += cs.stack;
        tier[i] = d;
        fillable.push(i);
        items[i] = null;
      }
    }
    for (let j = 0; j < inv.slots.length; j++) {              // j != 58（:35748,本仓垃圾格独立字段）
      const s = inv.slots[j];
      if (!s || s.stack <= 0 || s.favorited) continue;
      const d = denom(s.id);
      if (d >= 0) {                                           // 玩家币并入（:35948-35977）
        coinNetOut = true;                                    // flag=true（:35771）
        tally[d] += s.stack;
        playerCoinSlots.push(j);                              // list.Add(j) + 清格
        inv.slots[j] = null;
        anythingMoved = true;
      }
    }
    for (let k = 0; k < 3; k++) {                             // 进位（:35978-35985）
      while (tally[k] >= 100) { tally[k] -= 100; tally[k + 1]++; }
    }
    // 回填一：槽原面额档（:35886-35910,list2.Remove 无条件）
    for (let l = 0; l < items.length; l++) {
      if (tier[l] < 0 || items[l]) continue;
      const d = tier[l];
      if (tally[d] > 0) {
        const stack = Math.min(tally[d], coinMax(d));
        items[l] = { id: coinId(d), stack };
        tally[d] -= stack;
        tier[l] = -1;
      }
      const fi = fillable.indexOf(l);
      if (fi >= 0) fillable.splice(fi, 1);
    }
    // 回填二：原币格收溢出面额（:35911-35943,每槽一档取最大余档）
    for (let m = 0; m < items.length; m++) {
      if (tier[m] < 0 || items[m]) continue;
      for (let d = 3; d >= 0; d--) {
        if (tally[d] > 0) {
          const stack = Math.min(tally[d], coinMax(d));
          items[m] = { id: coinId(d), stack };
          tally[d] -= stack;
          break;
        }
      }
      const fi = fillable.indexOf(m);
      if (fi >= 0) fillable.splice(fi, 1);
    }
    // 回填三：普通空格收剩余（:35944-35970）
    for (const l of fillable) {
      if (items[l]) continue;
      for (let d = 3; d >= 0; d--) {
        if (tally[d] > 0) {
          const stack = Math.min(tally[d], coinMax(d));
          items[l] = { id: coinId(d), stack };
          tally[d] -= stack;
          break;
        }
      }
    }
    // 玩家剩余零钱回被清的原币格（:35972-35992,回填即 flag=false）
    let num10 = 3;
    while (num10 >= 0 && playerCoinSlots.length > 0) {
      const slot = playerCoinSlots[0];
      if (tally[num10] > 0) {
        const stack = Math.min(tally[num10], coinMax(num10));
        inv.slots[slot] = { id: coinId(num10), stack };
        tally[num10] -= stack;
        coinNetOut = false;                                   // :35985 flag=false
        playerCoinSlots.shift();
      }
      if (tally[num10] === 0) num10--;
    }
    if (coinNetOut) this.game.sfx.play('pickup');             // :35993-35996（有净搬出才播 Grab）
    // ---- ② 通用搬移（:35983-35600 区段 for num=49..10 + IntoLocal/WorldChest）----
    let generalMoved = false;
    for (let num = 49; num >= 10; num--) {                    // 背包主体降序,不含热键栏（:35559）
      const cur = inv.slots[num];
      if (!cur || cur.favorited) continue;
      for (let i = 0; i < items.length; i++) {                // 合并遍（IntoLocal/WorldChest 共义）
        const cs = items[i];
        if (!cs || cs.stack >= (ITEM_DEFS[cs.id]?.maxStack ?? 1)) continue;   // ★方案 A：`?.` 洞守卫（BJ265）
        if (cs.id !== cur.id || (cs.prefix ?? 0) !== (cur.prefix ?? 0)) continue;   // CanStack :49870
        const put = Math.min((ITEM_DEFS[cs.id]?.maxStack ?? 1) - cs.stack, cur.stack);
        cs.stack += put;
        cur.stack -= put;
        anythingMoved = true;
        generalMoved = true;
        if (cur.stack <= 0) { inv.slots[num] = null; break; }
      }
      if (inv.slots[num]) {                                   // 余量 → 首个空格（:35779-35793）
        const empty = items.findIndex((cs) => !cs);
        if (empty >= 0) { items[empty] = inv.slots[num]; inv.slots[num] = null; anythingMoved = true; generalMoved = true; }
      }
    }
    void generalMoved;
    if (anythingMoved) this.game.sfx.play('pickup');          // SoundID 7（Grab;原版逐事件播,本仓单次,登记）
    this.refreshAll();
  }

  /** Quick Stack（ChestUI.QuickStack :651-812，★SW-BJ46 1:1 重写抽纯函数）：只堆
   *  「箱内已存在类型」;收藏禁转移。算法体=QuickStacking.quickStackIntoContainer
   *  （段序/源窗/两遍语义/匹配域=itemMatchKey 注释全在彼处）;bank 面（chest.x≤-2）
   *  的 MoveCoins 前置与尾 flag 支音效也在彼处。音效单次收尾播=与 LootAll/
   *  DepositAll 同形登记形差（原版逐事件 PlaySound(7)）。 */
  private chestQuickStack(): void {
    const chest = this.openChest;
    if (!chest) return;
    const cue: { playSound7?: boolean } = {};
    const { movedChest } = quickStackIntoContainer(this.game.player.inv, chest.items, chest.x <= -2, cue);
    if (cue.playSound7) this.game.sfx.play('pickup');   // MoveCoins 尾 flag 支（ChestUI.cs:1196-1198）
    // 转移脉冲（ItemSorting :1513-1529：按类型分层 hue=(层+0.5)/层数 渐进彩虹）
    if (movedChest.size) {
      const order = new Map<number, number>();
      for (const id of movedChest.values()) {
        if (!order.has(id)) order.set(id, order.size);
      }
      const n = order.size;
      for (const [k, id] of movedChest) {
        this.setSlotGlow('chest', k, ((order.get(id) ?? 0) + 0.5) / n);
      }
    }
    this.game.sfx.play('pickup');
    this.refreshAll();
  }


  /** Restock 补货（ChestUI.Restock ChestUI.cs:867-992 1:1）：容器内无词缀件向
   *  背包同类未满堆补满；容器件清空后入空格（ammo 门）。背包扫描 57..0 降序、
   *  跳钱币(50-53)、stackable 门（!favorited ∥ !OnlyNeedOneInInventory）。
   *  flag=实际搬移 → SoundID 7(Grab)。 */
  chestRestock(): void {
    const chest = this.openChest;
    if (!chest) return;
    const inv = this.game.player.inv.slots;
    const hashSet = new Set<number>();
    const list: number[] = [];      // 未满堆格
    const list2: number[] = [];     // 空格
    for (let num = 57; num >= 0; num--) {
      const it = inv[num];
      if ((num < 50 || num >= 54) && (!it || it.id < 71 || it.id > 74)) {
        if (!it || it.stack <= 0) {
          list2.push(num);
        } else if ((ITEM_DEFS[it.id]?.maxStack ?? 999) > 1 && (!it.favorited || !onlyNeedOneInInventory(it.id))) {
          hashSet.add(it.id);
          if (it.stack < (ITEM_DEFS[it.id]?.maxStack ?? 999)) list.push(num);
        }
      }
    }
    let flag = false;
    const items = chest.items as Array<{ id: number; stack: number; prefix?: number; favorited?: boolean } | null>;
    for (let i = 0; i < items.length; i++) {
      const ci = items[i];
      if (!ci || ci.stack < 1 || (ci.prefix ?? 0) !== 0 || !hashSet.has(ci.id)) continue;
      let emptied = false;
      for (let j = 0; j < list.length; j++) {
        const num2 = list[j];
        const target = inv[num2];
        if (!target || !canMergeStack(target, ci)) continue;
        if (num2 >= 54 && !ammoSlotAccepts(ci.id)) continue;
        let move = ci.stack;
        if ((ITEM_DEFS[target.id]?.maxStack ?? 999) - target.stack < move) {
          move = (ITEM_DEFS[target.id]?.maxStack ?? 999) - target.stack;
        }
        target.stack += move;
        ci.stack -= move;
        flag = true;
        if (target.stack === (ITEM_DEFS[target.id]?.maxStack ?? 999)) {
          list.splice(j, 1); j--;
        }
        if (ci.stack <= 0) {
          items[i] = null;
          emptied = true;
          break;
        }
      }
      // 原版 :966 flag2||list2 空||item.ammo==0 → continue(空格换入仅弹药件)
      if (emptied || list2.length <= 0 || !ammoSlotAccepts(ci.id)) continue;
      for (let k = 0; k < list2.length; k++) {
        const slotIdx = list2[k];
        if (slotIdx >= 54 && !canFillEmptyAmmoSlot(ci.id)) continue;
        const tmp = inv[slotIdx];
        inv[slotIdx] = ci;
        items[i] = tmp;
        list.push(slotIdx);
        list2.splice(k, 1);
        flag = true;
        break;
      }
    }
    if (flag) this.game.sfx.play('pickup');   // SoundID 7(Grab :988)
    this.refreshAll();
  }

  /** 排列物品（ChestUI.ButtonID 4 → ItemSorting.SortChest :ItemSorting.cs:1573-1597——
   *  ★SW-RB13c：弃「层内稳定序近似」旧实现,改接 FX29 精确引擎 sortContainerItems
   *  （52 层谓词+Validate 白名单+各层 SortingMethod 比较器+SetGlow 色带 chest=true）;
   *  SortChest 门=chest != -1（:1576）,无 HasLockedInventory 面;MemoryStamp net 同步
   *  （32）单人仓无对应,引擎面同形略。旧近似已由测试锁定的层间序漂移就此清偿。 */
  chestSortChest(): void {
    const chest = this.openChest;
    if (!chest) return;
    const items = chest.items as Array<{ id: number; stack: number; prefix?: number; favorited?: boolean } | null>;
    sortContainerItems(items, {
      onGlow: (slot, hue) => this.setSlotGlow('chest', slot, hue),   // SetGlow(…, chest != -1)（:1530）
    });
    this.refreshAll();
  }
  private chestTitle!: HTMLElement;
  private chestGrid!: HTMLElement;

  private openChestPanel(c: ChestData) {
    this.openChest = c;
    // ★BJ91（2026-09-15 RB17b note⑤）：换箱开箱臂同收改名对话——原版 tile-interact
    //   序里 editChest 清理在开新箱前（Player.cs:33135-33141/:33349-33355：旧箱编辑
    //   态 → Sound 12+清 npcChatText,editedChestName 随 msg33 落）。closeChest 单点
    //   不覆盖异箱直开路（Game.tryOpenChest 异箱=OpenChest 重赋 chest,旧箱隐式关）,
    //   对话若滞留会锚在旧箱上。
    this.closeChestRenameDialog();
    // ★SW-FX30 刀②:PipsUseGrid 清(Player.cs:33787 OpenChest → Main.PipsUseGrid=false
    // ——开箱关网格态,两布局同面;字段仅 vinv 布局消费)
    this.vinvPipsUseGrid = false;
    this.vinvSyncGridToggle();
    // 容器来源标识（原版 player.chest 约定）：-2 存钱罐 / -3 保险箱 / -4 守护者熔炉 / -5 虚空保险库。
    // 名称 = 原版物品官译（PiggyBank 87 / Safe 346 / DefendersForge 3813 / VoidVault 4076）
    const bankNames: Record<number, string> = {
      [-2]: Lang.itemName(87) ?? '存钱罐',
      [-3]: Lang.itemName(346) ?? '保险箱',
      [-4]: Lang.itemName(3813) ?? '守护者熔炉',
      [-5]: Lang.itemName(4076) ?? '虚空保险库',
    };
    // ★2026-09-08 vanilla 布局:宝箱条直接叠背包下方(vinvBuildChest),无独立 modal
    if (this._builtLayout === 'vanilla') {
      this.vinvReforgeOpen = false;   // 原版 :42277 chest≠-1 → InReforgeMenu=false
      // ★BJ633：:42277 强制退出臂同帧 dropItemCheck(Main.cs:42288)——开箱退出重铸
      //   态时槽内物品即时回包（不走开=滞留卡槽）
      this.returnReforgeItem();
      this.openInventory(true);
      this.refreshAll();
      return;
    }
    this.chestTitle.textContent = bankNames[c.x] ?? Lang.text('Mods.SandboxWorld.UI.Chest');
    // 按容器实际槽位数显隐（宝箱 10 / 玩家储物 40）
    const n = Math.min(40, c.items.length);
    for (let i = 0; i < 40; i++) {
      const s = this.chestGrid.children[i] as HTMLElement | undefined;
      if (s) s.style.display = i < n ? '' : 'none';
    }
    this.chestPanel.style.display = 'block';
    this.openInventory(true);   // force：背包已开着时右键开箱不解背包（2026-09-02 解锁后此路可达）
    this.refreshAll();
  }

  closeChest() {
    this.openChest = null;
    // ★BJ91（2026-09-15 RB17b note⑤）：改名对话随箱收起——原版 editChest 生命周期：
    //   关箱拍 Player.cs:33349-33355/:33135-33141（editChest→Sound 12+清 npcChatText）
    //   与每 tick InputTextChest 的 chest==-1 支（Player.cs:27742-27747,无声）都收
    //   编辑态。本仓编辑态=模态对话面板域,closeChest=chest==-1 单点收口（走远
    //   tickChestAutoClose/死亡/关背包/换箱全汇此）——对话滞留=原版不可能态。
    //   无声对齐 27745 支（Sound 12 只在 tile-interact 序,本支不播）。
    this.closeChestRenameDialog();
    if (this.chestPanel) this.chestPanel.style.display = 'none';
    this.refreshAll();   // 堆叠钮等随开箱门（chest == -1）复显
  }

  // ============ 槽底贴图 / Loadout 染色 / 转移脉冲 / 金币跳字 ============

  /** LoadoutSlotColors（ItemSlot.cs:322-340）——行=loadout，列=context 组
   *  （TryGetSlotColor :2567：8,10 装备→0 / 9,11 时装→1 / 12 染料→2） */
  private static readonly LOADOUT_COLORS: ReadonlyArray<readonly [string, string, string]> = [
    ['rgb(50,106,64)', 'rgb(46,106,98)', 'rgb(45,85,105)'],
    ['rgb(35,106,126)', 'rgb(50,89,140)', 'rgb(57,70,128)'],
    ['rgb(122,63,83)', 'rgb(104,46,85)', 'rgb(84,37,87)'],
  ];

  /** 槽底贴图按 context（ItemSlot.Draw :1983-2142 逐 case：
   *  装备/时装/染料=13 / 杂项装备=3 / 杂项染料=12 / 箱=5 / 其余=默认 Back；
   *  收藏=10 覆盖（:1987，除 13/21/22/14/35 等——快捷栏不在本路径） */
  private paintSlotChrome(slotEl: HTMLElement, where: SlotWhere, i: number): void {
    // inv 族（背包网格/钱币/弹药）用 Back20 = 热键栏未选中同款贴图（2026-09-02
    // 用户要求背包格渲染对齐热键栏;网格槽另有 ×0.75 缩放+0.575 透明度,见
    // .sw-invgrid CSS）
    let tex = where === 'inv' ? 'Inventory_Back20' : 'Inventory_Back';
    let tint: string | null = null;
    if (where === 'armor' || where === 'dye') {
      tex = 'Inventory_Back13';
      const lo = UI.LOADOUT_COLORS[this.game.player.inv.currentLoadout] ?? UI.LOADOUT_COLORS[0];
      tint = where === 'dye' ? lo[2] : i <= 9 ? lo[0] : lo[1];
    } else if (where === 'misc') tex = 'Inventory_Back3';
    else if (where === 'miscDye') tex = 'Inventory_Back12';
    else if (where === 'chest') tex = 'Inventory_Back5';
    const content = this.slotContent(where, i);
    if (content?.favorited) tex = 'Inventory_Back10';
    // 权威重绘：清掉残留的 glow 色层（面板 display:none 期间动画被 cancel 而非
    // end——overlay 会以基础样式（不透明）卡死在槽上，重开面板即一排色块）
    slotEl.querySelector('.sw-glow-overlay')?.remove();
    // ★清偿刀 H② GetDimSlotForMouseItem 持物变暗（ItemSlot.cs:2334-2336 槽底
    //  color2×fade/:2481 幽灵 0.35×fade/:2499 图标×fade/:2733 角标 0.7×fade）——
    //  槽元写 --sw-ifade,四元素 CSS calc 消费（.sw-slot img/.sw-slot-ghost/
    //  .sw-share-ghost/.sw-share-frame/eqdock·vinv ::after）;仅装备族装配
    //  （inv/chest 语境 ∉ 原版 switch）。同值守卫（BJ270 hitch 纪律）;
    //  heldStack 变更必经 refreshAll → 本函数重算,无滞留面。
    if (where !== 'inv' && where !== 'chest') {
      const fadeWant = String(this.slotItemFadeFor(where, i));
      if (slotEl.style.getPropertyValue('--sw-ifade') !== fadeWant) {
        slotEl.style.setProperty('--sw-ifade', fadeWant);
      }
    }
    // 槽底贴图走 --slot-bgimg（::after 纹理层消费,2026-09-02）——物品/数字不随
    // 格子半透明（半透只在 ::after 的 opacity 上）
    // ★开包 hitch 刀(2026-09-29):同值守卫(setProperty 同值仍脏化元素=整面板 recalc)
    const bgWant = `url(sprites/vanilla/${tex}.png)`;
    if (slotEl.style.getPropertyValue('--slot-bgimg') !== bgWant) {
      slotEl.style.setProperty('--slot-bgimg', bgWant);
    }
    if (tint) {
      if (slotEl.style.getPropertyValue('--slot-tint') !== tint) slotEl.style.setProperty('--slot-tint', tint);
    } else if (slotEl.style.getPropertyValue('--slot-tint') !== '') {
      slotEl.style.removeProperty('--slot-tint');
    }
    // ★SW-FX29：glow 活态未到期 → 重绘后复铺（原版时间态逐帧驱动;仓内重绘
    // 模型下由状态承载——见 applySlotGlow 注）
    if (this.slotGlowState.has(`${where}:${i}`)) this.applySlotGlow(where, i);
  }

  /** LoadoutShare 槽面（ItemSlot.Draw :2454-2473 + :2726-2746；R4-15 补绘——曾缺
   *  =用户报"切配装后对应格子还是空的"：共享件其实仍在生效（GetEffectiveArmor 填
   *  空槽），只是槽面无任何指示，导致往空槽再叠一套装备）。仅 armor/dye 五类格
   *  （canLoadoutShareAt[8-12]；misc 族原版无此语义）：
   *  1) 槽空但共享件在场（GetSharedLoadoutItem :2837 → GetEffectiveArmor/Dye）——
   *     物品图标 60% 淡显（itemFade*=0.6）+ 来源配装色角标 Extra[313+from] α0.7，
   *     类型占位图抑制（num15=-1）；
   *  2) 槽内件被收藏（本套=共享源）→ 当前配装色角标 Extra[310+cur] α0.7。
   *  角标贴图 = 52×52 左上角小色标（310/313 绿 311/314 蓝 312/315 紫，字节级
   *  两两同图）。悬停 tooltip 代打见 showTooltipFor（MouseHover :3174-3178） */
  private paintLoadoutShare(slotEl: HTMLElement, where: 'armor' | 'dye', i: number): void {
    const inv = this.game.player.inv;
    const content = this.slotContent(where, i);
    const from = content ? null : inv.effectiveSharedFrom(i, where === 'dye');
    const shared = from !== null
      ? (where === 'dye' ? inv.loadouts[from].dye[i] : inv.loadouts[from].armor[i])
      : null;
    const ownShared = !!content?.favorited;
    const g = slotEl.querySelector('.sw-share-ghost') as HTMLElement | null;
    const f = slotEl.querySelector('.sw-share-frame') as HTMLElement | null;
    if (!shared && !ownShared) {
      g?.remove();
      f?.remove();
      return;
    }
    let ghost = g;
    if (!ghost) {
      ghost = el('div', 'sw-share-ghost');
      // ★清偿刀 H②：图标 α=itemFade×0.6（ItemSlot.cs:2465-2467 `itemFade *= 0.6`
      //  后 :2499 DrawItemIcon 淡显;槽元 --sw-ifade 承载 fade 乘区）
      ghost.style.cssText = 'position:absolute; inset:15.4%; width:69.2%; height:69.2%;'
        + 'background:center/contain no-repeat; image-rendering:pixelated; pointer-events:none;'
        + ' opacity:calc(0.6 * var(--sw-ifade, 1));';
      slotEl.appendChild(ghost);
    }
    ghost.style.display = shared ? 'block' : 'none';
    if (shared) {
      const url = iconUrl(this.game, shared.id);
      if (ghost.dataset.src !== url) { ghost.style.backgroundImage = `url(${url})`; ghost.dataset.src = url; }
      const ph = slotEl.querySelector('.sw-slot-ghost') as HTMLElement | null;
      if (ph) ph.style.display = 'none';   // num15=-1：共享幽灵顶掉类型占位图
    }
    let frame = f;
    if (!frame) {
      frame = el('div', 'sw-share-frame');
      // ★清偿刀 H②：角标 α=0.7×num17（:2733,num17=itemFade 在 ×0.6【前】快照
      //  =槽元 --sw-ifade 原值）
      frame.style.cssText = 'position:absolute; inset:0; background-position:0 0; background-size:100% 100%;'
        + 'image-rendering:pixelated; pointer-events:none; opacity:calc(0.7 * var(--sw-ifade, 1));';
      slotEl.appendChild(frame);
    }
    frame.style.display = 'block';
    const frameUrl = `url(sprites/vanilla/Extra_${shared ? 313 + from! : 310 + inv.currentLoadout}.png)`;
    if (frame.dataset.src !== frameUrl) { frame.style.backgroundImage = frameUrl; frame.dataset.src = frameUrl; }
  }

  /** 槽位 glow 活动态（★SW-FX29：ItemSlot.inventoryGlowTime/Hue :270-276 的仓内
   *  时间态——SetGlow 写态 300t(5s) 渐隐;呈现面 paintSlotChrome 重绘时按活态重铺。
   *  旧一次性 DOM overlay 会被 refreshAll 的权威重绘当场清掉（chestQuickStack
   *  :5001 紧跟 refreshAll 同病）——改状态承载,重绘后 applySlotGlow 复铺） */
  private slotGlowState = new Map<string, { hue: number; until: number }>();

  /** 物品转移 hue 脉冲（ItemSlot.SetGlow :428 + :2144-2152：贴图换 Back13 +
   *  hslToRgb(hue,1,0.5) 色层 (time/300)²/2 衰减 5s；CSS 动画近似二次曲线） */
  setSlotGlow(where: SlotWhere, i: number, hue: number): void {
    this.slotGlowState.set(`${where}:${i}`, { hue, until: performance.now() + 5000 });
    this.applySlotGlow(where, i);
  }

  /** glow 活态复铺（ItemSlot.Draw :2289-2296：context 0/2/3/4/32 且 !favorited
   *  && 非空——Back13 贴图 + 色层;animationDuration=余量,到期 animationend
   *  清态并归位 chrome 重绘） */
  private applySlotGlow(where: SlotWhere, i: number): void {
    const key = `${where}:${i}`;
    const st = this.slotGlowState.get(key);
    if (!st) return;
    const slotEl = this.slotEl(i, where);
    if (!slotEl || !slotEl.isConnected) return;
    const remain = st.until - performance.now();
    if (remain <= 0) {
      this.slotGlowState.delete(key);
      return;
    }
    slotEl.querySelector('.sw-glow-overlay')?.remove();
    slotEl.style.backgroundImage = 'url(sprites/vanilla/Inventory_Back13.png)';
    const ov = el('div', 'sw-glow-overlay');
    ov.style.setProperty('--glow', `hsl(${(st.hue * 360).toFixed(1)} 100% 50%)`);
    ov.style.animationDuration = `${Math.ceil(remain)}ms`;
    ov.addEventListener('animationend', () => {
      this.slotGlowState.delete(key);
      if (this.game) this.paintSlotChrome(slotEl, where, i);
    });
    slotEl.appendChild(ov);
  }

  /** CoinSlot 动画表（CoinSlot.cs :228-249：Jump 25 帧×JumpScale10 / Text 17 帧 / 自旋 8 帧） */
  private static readonly COIN_JUMP = [0, .23748, .43408, .59366, .72007, .81717, .88881, .93885, .97115, .98955,
    .99793, 1, 1, 1, .99793, .98955, .97115, .93885, .88881, .81717, .72007, .59366, .43408, .23748, 0];
  private static readonly COIN_TEXT = [1, 1.0107, 1.0391, 1.0791, 1.125, 1.1709, 1.2109, 1.2393, 1.25, 1.2393,
    1.2109, 1.1709, 1.125, 1.0791, 1.0391, 1.0107, 1];
  private prevCoinStack = [-1, -1, -1, -1];
  private coinBusy = [false, false, false, false];

  /** 金币跳字（CoinSlot.UpdateState：堆叠变化 → 跳 25 帧 + 计数弹跳缩放 + 自旋帧） */
  private coinJump(k: number): void {
    if (this.coinBusy[k]) return;
    const slotEl = this.slotEl(COIN_START + k, 'inv');
    if (!slotEl) return;
    this.coinBusy[k] = true;
    const img = slotEl.querySelector<HTMLImageElement>('img');
    const cnt = slotEl.querySelector<HTMLElement>('.cnt');
    // 自旋层（CoinSlot.DrawItemCoin：Coin_k 8 帧竖条，跳帧窗 9-13 推进）
    let spin: HTMLElement | null = null;
    let t = 0;
    let last = 0;
    const step = (now: number) => {
      if (!last) last = now;
      while (now - last >= 16.7 && t < 25) {
        last += 16.7;
        t++;
        const jump = UI.COIN_JUMP[t] ?? 0;
        if (img) img.style.transform = `translateY(${(-jump * 10).toFixed(1)}px)`;
        if (cnt) cnt.style.transform = `scale(${UI.COIN_TEXT[Math.min(t, 16)]})`;
        if (t >= 9 && t <= 13) {
          if (!spin) {
            spin = el('div');
            spin.style.cssText = 'position:absolute; inset:4px; pointer-events:none; image-rendering:pixelated;'
              + `background:url(sprites/vanilla/Coin_${k}.png); background-size:100% 800%;`;
            slotEl.appendChild(spin);
            img && (img.style.visibility = 'hidden');
          }
          spin.style.backgroundPositionY = `${(Math.floor((t - 9) * 1.4) % 7) * 12.5}%`;
        } else if (spin) {
          spin.remove(); spin = null;
          if (img) img.style.visibility = '';
        }
      }
      if (t < 25) { requestAnimationFrame(step); return; }
      if (img) { img.style.transform = ''; img.style.visibility = ''; }
      if (cnt) cnt.style.transform = '';
      spin?.remove();
      this.coinBusy[k] = false;
    };
    requestAnimationFrame(step);
  }

  // ============ 刷新 ============

  /** 手机紧凑快捷栏布局帧(mobile-adaptation-plan 模块③;D0/T1=null=原版几何):
   *  cols=每格行数排列(T3 两行五列 / T2 单行十格);q=统一格 scale——紧凑档取消
   *  选中尺寸跳变(C 方案定案,选中态由 Back14/20 贴图+亮度区分),步进均匀。 */
  private hotbarCompact(): { cols: number; q: number } | null {
    // 2026-08-29 官方截图对齐:横屏(含手机)hotbar 保持原版 52px 一行不缩
    // (844 宽放得下 ~490px 行,官方平板/手机横屏同样原样);仅竖屏紧凑化
    if (hudTier() === 't3') return { cols: 5, q: 0.78 };   // 竖屏两行五列,视觉≈41px 格
    return null;
  }

  /** 热键锁穿透态（SW-FX10 债⑪;Main.cs:44353-44359）：关包且 hbLocked 时给 10 个
   *  快捷栏格挂 data-sw-world-passthrough——点击透传为世界输入（挖/放/使用照常）,
   *  锁未开或开包态摘除。选中门在 mouseup 臂（:1913 区）。随 refreshHotbar 全路径跑 */
  private paintHotbarLockState(): void {
    const closed = !!this.invPanel && this.invPanel.style.display !== 'block';
    const on = closed && !!this.game?.player.hbLocked;
    for (let i = 0; i < 10; i++) {
      const s = this.slotEl(i, 'inv');
      if (!s) continue;
      if (on) s.dataset.swWorldPassthrough = '1';
      else if (s.dataset.swWorldPassthrough) delete s.dataset.swWorldPassthrough;
    }
  }

  refreshHotbar() {
    if (!this.game) return;
    this.paintHotbarLockState();
    // ★2026-09-07 刀 2 守卫:vanilla 布局开包 = 原版 GUIHotbarDrawInner 整体早退
    // (Main.cs:44324 `if (playerInventory || ...) return;`)——热键栏 DOM 隐藏,
    // 第 0 行由 .sw-vinv 网格承担(paintVanillaInvSlots);关包态落下方 D0 画法
    // (已 1:1 原版关包几何),此处只负责 display 还原
    if (this._builtLayout === 'vanilla') {
      const vinvOpen = this.invPanel?.style.display === 'block';
      if (this.hotbarEl) this.hotbarEl.style.display = vinvOpen ? 'none' : '';
      if (this.hotbarNameEl) this.hotbarNameEl.style.display = vinvOpen ? 'none' : '';
      if (this.manualBtn) this.manualBtn.style.display = vinvOpen ? 'none' : '';
      if (vinvOpen) return;
    }
    const inv = this.game.player.inv;
    // 原版布局（Main.cs:43017-43060）：x 从 20 起步进 ⌊52×scale⌋+4；
    // y = 20 + 22×(1-scale)（选中 20，未选中 25→CSS 视觉再随 scale 收缩）；
    // 未选中 alpha = 200×187/255 ≈ 147（Back20 半透明），选中 255（Back14）
    //
    // 手机紧凑档(mobile-adaptation-plan P0):几何单一来源=本函数的 hotbarCompact()
    // 帧,safe-area 由 HudScale.safeInsets 并入格子 inline 坐标(positionInvPanel 扫
    // inline left/top=屏幕坐标的既有语义零适配)。D0 分支逐值还原原版公式。
    const compact = this.hotbarCompact();
    // 紧凑档挂 class(触控热区扩边 CSS 钩子;D0 移除=无伪元素,桌面 DOM 零新增)
    this.hotbarEl?.classList.toggle('compact', !!compact);
    if (compact) {
      const step = Math.floor(52 * compact.q) + 4;   // 屏幕像素步进(选中差取消→恒定)
      const rowH = Math.floor(52 * compact.q) + 12;
      const ox = safeInsets.left + 6;
      const oy = safeInsets.top + 8;
      for (let i = 0; i < 10; i++) {
        const slotEl = this.slotEl(i, 'inv');
        if (!slotEl) continue;
        const col = i % compact.cols, row = (i / compact.cols) | 0;
        this.paintSlot(slotEl, inv.slots[i], i);   // ★BJ613:热栏 context13 传槽位(电线计数)
        slotEl.style.left = `${ox + col * step}px`;
        slotEl.style.top = `${oy + row * rowH}px`;
        slotEl.style.width = slotEl.style.height = '52px';
        slotEl.style.transform = `scale(${compact.q})`;
        slotEl.style.transformOrigin = 'top left';
        slotEl.style.setProperty('--slot-alpha', i === inv.selected ? '1' : '0.62');
        slotEl.style.setProperty('--slot-bgimg', `url(sprites/vanilla/Inventory_Back${i === inv.selected ? 14 : 20}.png)`);
        slotEl.style.boxShadow = '';
        if (!slotEl.querySelector('.sw-slot-num')) {
          const num = el('span', 'sw-slot-num', i === 9 ? '0' : String(i + 1));
          slotEl.appendChild(num);
        }
      }
      const rows = Math.ceil(10 / compact.cols);
      // 选中名:行尾下方居中(T3 两行/T2 单行各自锚点)
      this.hotbarNameEl.style.left = `${Math.round(ox + (compact.cols * step - step + 44) / 2)}px`;
      this.hotbarNameEl.style.top = `${oy + rows * rowH + 2}px`;
      this.hotbarNameEl.style.fontSize = '11px';
    } else {
      let x = 20;
      // ★背包打开时热键栏整行均匀（2026-09-02 用户要求：不高亮/不放大当前项——
      //   原版 playerInventory 开启时热键行不画选中放大与 Back14 高亮）
      const invOpen = this.invPanel?.style.display === 'block';
      for (let i = 0; i < 10; i++) {
        const slotEl = this.slotEl(i, 'inv');
        if (!slotEl) continue;
        const sel = i === inv.selected && !invOpen;
        const scale = sel ? 1 : 0.75;
        this.paintSlot(slotEl, inv.slots[i], i);   // ★BJ613:热栏 context13 传槽位(电线计数)
        slotEl.style.left = `${x}px`;
        slotEl.style.top = `${Math.trunc(20 + 22 * (1 - scale))}px`;
        slotEl.style.width = slotEl.style.height = '52px';
        slotEl.style.transform = `scale(${scale})`;
        slotEl.style.transformOrigin = 'top left';
        slotEl.style.setProperty('--slot-alpha', sel ? '1' : '0.575');
        slotEl.style.setProperty('--slot-bgimg', `url(sprites/vanilla/Inventory_Back${sel ? 14 : 20}.png)`);
        slotEl.style.boxShadow = ''; // 原版快捷栏不画收藏高亮（ItemSlot :1987 context!=13）
        if (!slotEl.querySelector('.sw-slot-num')) {
          const num = el('span', 'sw-slot-num', i === 9 ? '0' : String(i + 1));
          slotEl.appendChild(num);
        }
        x += Math.floor(52 * scale) + 4;
      }
      // D0 显式回写防手机会话残留(hotbarName CSS 锚 left236/top0 同值)
      this.hotbarNameEl.style.left = '236px';
      this.hotbarNameEl.style.top = '0px';
      this.hotbarNameEl.style.fontSize = '';
    }
    // 说明按钮:紧凑档让位(467px 定位压 T2 行尾/T3 名区;桌面原位)
    if (this.manualBtn) this.manualBtn.style.display = compact ? 'none' : '';
    // 选中物品名（:43003-43009：居中 x=236、mouseTextColor 脉动；空手回退 inter[37]）。
    // 走 itemNameByKey 全链（vi_ key 前缀→官方 l10n→id-maps 兜底→place_v_ 方块名→
    // Mods 自有键→def.name）：vi_ def 的 vid 字段不落、name 恒 ''（items.ts 自动注册
    // 循环不写 vid），裸取 def.vid 会级联落空 → 恒显 inter(37)"物品"（退役批回归）
    // ★SW-AZ1 2026-09-06：经 heldItem() 取手持（光标持物伪选中时=镜像槽 58——
    // vanilla 该行读 HeldItem Player.cs:3835-3837,光标捏物时显示光标物名）
    // ★BJ419（2026-09-30）用户实报「顶部单行名不带词缀」定谳刀：原版此名 =
    // selectedItem.AffixName()（Main.cs:44331,1458 :44337 同位同文）——词缀组合名
    // Lang.GetPrefixedItemName（Lang.cs:225-239 → CombineFormat.Prefix）,非裸
    // .Name。旧 itemNameByKey 直显裸名=病灶（如「‹传奇›坠落星」只显「坠落星」）。
    // 拼装单源复用 affixedItemName（BJ390,tooltip 头行/飘字同管,≡popupAffixName
    // Game.ts:319）;inter(37) 空手回退原版同序（Name=="" 门 :44330 先于 AffixName）。
    // 热键栏悬停单行名（:44361 hoverItemName=AffixName）在仓内=showTooltipFor 全载荷
    // 气泡头行 buildTooltipHtml:3236 同源已带词缀,本行是最后一个裸名位。
    const held = inv.heldItem();
    const name = held ? Lang.itemNameByKey(ITEM_DEFS[held.id]?.key ?? '') : null;
    this.hotbarNameEl.textContent = (held && name ? affixedItemName(held.prefix, name) : '') || Lang.inter(37);
  }

  /** 背包网格几何=热键栏实测值（2026-09-02 用户复报格距不一致）：读热键栏【未选中】
   *  相邻两槽的实测节距/视觉宽（getBoundingClientRect 已含缩放/档位/浏览器缩放；
   *  选中槽 scale 1.0 步进 56 会污染节距,故取一对连续未选中槽），写回网格轨道与
   *  间距——任何环境下两者逐像素一致 */
  private syncInvGridGeometry(): void {
    const grid = this.invGridEl;
    if (!grid) return;
    const sel = this.game?.player.inv.selected ?? -1;
    let a: HTMLElement | null = null, b: HTMLElement | null = null;
    for (let i = 0; i < 9; i++) {
      if (i === sel || i + 1 === sel) continue;
      a = this.slotEl(i, 'inv'); b = this.slotEl(i + 1, 'inv');
      if (a && b) break;
      a = b = null;
    }
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const pitch = rb.left - ra.left;
    const cell = ra.width;
    if (!(pitch > cell) || !(cell > 8)) return;   // 过渡期/异常布局不写
    const gap = Math.max(0, pitch - cell);
    grid.style.gridTemplateColumns = `repeat(10, ${cell}px)`;
    grid.style.gridAutoRows = `${cell}px`;
    grid.style.columnGap = grid.style.rowGap = `${gap}px`;
  }

  /** 触屏长按槽位 tooltip(mobile-adaptation-plan 模块④):显示后挂一次性
   *  document 触摸关闭(桌面 mouseleave 已有;触屏无 leave 语义) */
  private showSlotHintTouch(i: number, where: string, anchor?: HTMLElement): void {
    // ★BJ669e2：触屏支标记元素锚（showTooltipFor 读后即清）——触屏会话无 mousemove
    //  流,光标锚的 mouseX/mouseY 无更新源 → 气泡钉左上角;桌面 mouseenter 支不受影响
    this.tooltipTouchAnchor = resolveTouchMode() === 'touch' ? (anchor ?? null) : undefined;
    this.showTooltipFor(i, where as never, anchor ? { anchor } : undefined);
    document.addEventListener('touchstart', () => {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
    }, { once: true, capture: true, passive: true });   // 无 preventDefault(仅隐藏 tooltip)→ passive 化(scroll-blocking 事件)
  }

  /** ★开包 hitch diff 门（2026-09-29 用户实报「开背包瞬间 120→114fps 再回 120,
   *  内容不变也掉」定谳刀,BJ316 姐妹面:BJ316 修每帧 --invpulse 派生重算,本刀=
   *  开包拍全量槽重刷——notifyInventoryChanged→refreshAllNow inv 循环+
   *  paintVanillaInvSlots.paintInvSlot 同批两轮 paintSlot+paintSlotChrome,每槽
   *  3 次 querySelector+同值 style 写=整面板 style recalc/paint 尖峰）。
   *  指纹=内容(id/stack/prefix/favorited)+iconUrl（晚到图集/资源包热切换经
   *  iconUiDirty/clearIconCache 换 dataURL→指纹自变=自愈,零额外失效机制;
   *  iconUrl 本身 Map 缓存,指纹读它=零额外开销）+glow 在场位。★glow 活态恒
   *  全绘（绕过门）:保 paintSlotChrome 头注释「display:none 期动画 cancel→
   *  overlay 残留重开成色块」的权威重绘语义。不变=整对跳过=零 DOM 写。
   *  仅挂 inv 族两调用点;armor/dye tint 面/热栏/宝箱循环节奏不变（同病另批）。 */
  private _slotPaintSigs = new WeakMap<HTMLElement, string>();
  private paintInvSlotPair(slotEl: HTMLElement, i: number, content: { id: number; stack: number; favorited?: boolean; prefix?: number } | null): void {
    const glowOn = this.slotGlowState.has(`inv:${i}`);
    if (!glowOn) {
      // ★BJ613：热栏扳手族/蓝图 sig 并入电线计数值（只耗线不动物品时计数照刷）
      const wireCnt = wireIconCounterOf(content, i, this.game.player.inv);
      const sig = content
        ? `${content.id}|${content.stack}|${content.prefix ?? 0}|${content.favorited ? 1 : 0}|${iconUrl(this.game, content.id)}|${wireCnt ?? ''}`
        : '';
      if (this._slotPaintSigs.get(slotEl) === sig) return;
      this._slotPaintSigs.set(slotEl, sig);
    }
    this.paintSlot(slotEl, content, i);
    this.paintSlotChrome(slotEl, 'inv', i);
  }

  private paintSlot(slotEl: HTMLElement, content: { id: number; stack: number; favorited?: boolean; prefix?: number } | null, invSlot?: number) {
    // ★元素复用(2026-08-14 trace④:80 万次 LazyPixelRef 恒定流根因):此前每次
    // 刷新删旧 <img> 建新——新元素即使 src 相同也要重新解码,50-80 槽 × iconUiDirty
    // 风暴期的每 30t 刷新 = 每帧 50+ 次解码任务。复用元素且 src 不变不动 = 零解码
    let img = slotEl.querySelector('img') as HTMLImageElement | null;
    const oldCnt = slotEl.querySelector('.cnt');
    if (!content) { if (img) img.remove(); if (oldCnt) oldCnt.remove(); }
    // 类型幽灵图只在空槽显示（:2312 `item.type <= 0 || stack <= 0` 门）
    // ★开包 hitch 刀(2026-09-29):同值守卫——写前比对,恒等值零 DOM 写
    const ghost = slotEl.querySelector('.sw-slot-ghost');
    const ghostWant = content ? 'none' : 'block';
    if (ghost && (ghost as HTMLElement).style.display !== ghostWant) (ghost as HTMLElement).style.display = ghostWant;
    if (content) {
      const url = iconUrl(this.game, content.id);
      if (!img) {
        img = el('img') as HTMLImageElement;
        img.draggable = false;
        slotEl.appendChild(img);
      }
      if (img.getAttribute('src') !== url) img.src = url;  // 不变不动:免重解码/重光栅
      // ★BJ613（2026-10-10）热栏图标电线计数（ItemSlot.cs:2665-2674 1:1）：
      //  热栏槽（context 13=HotbarItem;invSlot 0-9）持扳手族/蓝图 3611 时右下
      //  恒绘背包 530 总数——num22!=-1 压 stack 计数支（stack==1 也绘,0 也绘;
      //  非热栏槽 context 0 无计数=原版同相）
      const wireCnt = wireIconCounterOf(content, invSlot, this.game.player.inv);
      if (wireCnt !== null) {
        const stackStr = String(wireCnt);
        if (oldCnt) {
          if (oldCnt.textContent !== stackStr) oldCnt.textContent = stackStr;
        }
        else slotEl.appendChild(el('span', 'cnt', stackStr));
      } else if (content.stack > 1) {
        const stackStr = String(content.stack);
        if (oldCnt) {
          if (oldCnt.textContent !== stackStr) oldCnt.textContent = stackStr;
        }
        else slotEl.appendChild(el('span', 'cnt', String(content.stack)));
      } else if (oldCnt) oldCnt.remove();
    }
    // 收藏星标（原版 Inventory_Back10 金边贴图——ItemSlot :1966-1985 favorited 分支）：
    // 贴图由 paintSlotChrome 的 --slot-bgimg 统一绘制（favorited → Back10），此处
    // 不再直写 backgroundImage——2026-09-02 槽底迁 ::after 后直写会绕过半透层
    const favTitle = content?.favorited ? Lang.text('Mods.SandboxWorld.Toast.Favorited') : '';
    if (slotEl.title !== favTitle) slotEl.title = favTitle;
  }

  /** rAF 合并版 refreshAll(2026-08-13 泄露 review):滚轮/拾取/背包变化等
   *  事件风暴下每帧至多全量重建一次(此前合成列表滚轮每事件直调=与
   *  BestiaryPanel 滚轮崩溃同根因)。31 处调用点零改动透传 */
  private _refreshAllQueued = false;
  refreshAll() {
    if (this._refreshAllQueued) return;
    this._refreshAllQueued = true;
    requestAnimationFrame(() => {
      this._refreshAllQueued = false;
      this.refreshAllNow();
    });
  }

  /** 刷新的 Promise 版(探针/测试同步等待用,生产路径零消费;绕过 rAF 合并去重,
   *  连调两次会全量刷两遍——仅测试语义) */
  refreshAllAsync(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => { this.refreshAllNow(); resolve(); });
    });
  }

  private refreshAllNow() {
    if (!this.game) return;
    this.refreshEquipExtras();
    // 快捷栏最先刷（数字键/选槽视觉的最小闭环）——后续任一段抛错也不再吞掉
    // 快捷栏刷新（2026-08-18 用户报"数字键失效"：advisor 段异常曾把 rAF 回调
    // 整体炸掉，selected 已变而画面不动）
    this.refreshHotbar();
    this.syncInvGridGeometry();   // 网格节距/格宽=热键栏实测（2026-09-02）
    this.moveGhost();
    this.paintTrash();
    this.paintAccEyes();
    this.refreshPvpButtons();
    try {
      this.achAdvisorEl?.update();
    } catch (e) {
      this.achAdvisorEl?.remove();
      this.achAdvisorEl = null;   // 坏 advisor 自摘（成就顾问是 QoL 件，不拖垮背包刷新）
      console.warn('[UI] achAdvisor update failed, detached:', e);
    }
    // 堆叠至附近宝箱双钮（chest == -1 && npcShop == 0 门,Main.cs:42548/1458:42554——
    // 开箱/商店不显示；2026-09-02 拆双钮后帧固定：quick=0/1、smart=2/3（悬停态由钮自身
    // mouseenter/leave 切,此处只管显隐+title）
    // ★BJ685b 用户明令分歧（2026-10-15）：制作菜单开着（modern 窗 ∨ classic 网格）恒显
    //   ——与 vanilla 布局 quickStackXY(chestOpen, craftMenuOpen) 同门同语义（本簇在
    //   classic 构建器下两态恒 false=行为无差,改门只为两布局单一规则;判例锚=
    //   smart-cursor-dark-visibility-user-divergence）。原版平价面（制作菜单关+箱开=藏,
    //   箱内三钮承接）不变。
    // ★BJ704-G7 件2（R5 登记债⑥清偿,2026-10-21）：商店半边补齐——旧门只建 openChest
    //   半边（注释宣称「开箱/商店不显示」但代码从未落 npcShop 项,商店期钮恒显=旧注释
    //   假陈述面）。vinv 面 pos 闭包经 layoutVanilla ctx.chestOpen（=openChest∨
    //   npcShopOpen,见 layoutVanilla）早已双半边=正确无需动;R5「pos 门 none 输给
    //   refreshAll 竞写→恒显旧位」定谳=伪影（vinvQuickBtn 唯一写位=pos 循环,classic
    //   quickStackBtn/qsSmartBtn 在 vanilla 构建下被 teardown 置 null 本循环即跳过
    //   ——两元素互不竞写）。classic 门与 vinv 同规则:quickStackXY(chestOrShopOpen,
    //   craftMenuOpen) 单源语义。
    for (const [b, mode] of [[this.quickStackBtn, 'quick'], [this.qsSmartBtn, 'smart']] as const) {
      if (!b) continue;
      b.style.display = (this.openChest || this.game.npcShopOpen) && !(this.vinvModernCraftOpen || this.vinvPipsUseGrid) ? 'none' : '';
      // title 不走 GameUI.* 官译（带「右键点击切换堆叠方式」提示,双钮拆分后无此交互）
      b.title = mode === 'smart' ? '智能堆叠至附近宝箱' : '快速堆叠至附近宝箱';
    }
    // 多人玩家列表钮：仅联机态显示（单机无名单可列）
    if (this.playerListBtn) this.playerListBtn.style.display = this.game.net?.active ? '' : 'none';
    const inv = this.game.player.inv;
    for (let i = 10; i < INV_SIZE; i++) {
      const slotEl = this.slotEl(i, 'inv');
      if (slotEl) {
        this.paintInvSlotPair(slotEl, i, inv.slots[i]);   // ★开包 hitch diff 门(2026-09-29):不变零写
      }
    }
    // ★2026-09-07 刀 2 守卫:vanilla 布局补绘——网格第 0 行(0-9,全局 slotEl 会
    // 首匹配到隐藏热键栏)+ inv 族槽底覆写(原版开包=Inventory_Back 非经典 Back20)
    if (this._builtLayout === 'vanilla') this.paintVanillaInvSlots();
    // 金币跳字（CoinSlot：堆叠变化触发且槽内有币——原版仅钱币族动画，空槽不跳）
    for (let k = 0; k < 4; k++) {
      const cur = inv.slots[COIN_START + k];
      const st = cur?.stack ?? 0;
      if (st !== this.prevCoinStack[k]) {
        this.prevCoinStack[k] = st;
        if (cur) this.coinJump(k);
      }
    }
    // 装备列全量重绘（armor[20] / dye[10] / miscEquips[5] / miscDyes[5]）
    for (const where of ['armor', 'dye', 'misc', 'miscDye'] as const) {
      const arr = this.equipArray(where);
      for (let i = 0; i < arr.length; i++) {
        const slotEl = this.slotEl(i, where);
        if (slotEl) {
          this.paintSlot(slotEl, arr[i]);
          this.paintSlotChrome(slotEl, where, i);
          if (where === 'armor' || where === 'dye') this.paintLoadoutShare(slotEl, where, i);
        }
      }
    }
    // Loadout 按钮（Extra[259] 图集：选中=列1；悬停态由 mouseenter/leave 管）
    this.loadoutBtns.forEach((b, k) => {
      const cur = k === inv.currentLoadout;
      b.style.backgroundPosition = `${(cur ? 1 : 0) * 50}% ${k * 50}%`;
    });
    this.refreshBuffs();
    if (this.openChest) {
      const n = Math.min(40, this.openChest.items.length);
      for (let i = 0; i < n; i++) {
        const slotEl = this.slotEl(i, 'chest');
        if (slotEl) {
          this.paintSlot(slotEl, this.openChest.items[i]);
          this.paintSlotChrome(slotEl, 'chest', i);
        }
      }
    }
    // ★2026-09-09 刀 13 守卫(共享区第 8 处):宝箱槽贴图按容器
    // (ItemSlot.cs :2200 区:ctx3 世界箱=Back5;ctx4 银行/ctx32 虚空=Back2 黄;
    //  收藏=Back10 paintSlotChrome 已设;经典 chestPanel 无此分=既存偏差)
    if (this._builtLayout === 'vanilla' && this.openChest) {
      const isVoid = this.openChest.x === -5;
      const backTex = this.openChest.x < 0 ? 'Inventory_Back2' : 'Inventory_Back5';
      for (let i = 0; i < 40; i++) {
        const s = this.vinvSlots.get(`chest:${i}`);
        if (!s) continue;
        const fav = !!this.openChest.items[i]?.favorited;
        // 收藏:ctx32 虚空=Back19(ItemSlot.cs :2131-2134)/其余=Back10(:2129-2131)
        const want = fav ? (isVoid ? 'Inventory_Back19' : 'Inventory_Back10') : backTex;
        const cur = s.style.getPropertyValue('--slot-bgimg');
        if (!cur.includes(want)) {
          s.style.setProperty('--slot-bgimg', `url(sprites/vanilla/${want}.png)`);
        }
      }
    }
    this.refreshCrafting();
  }

  private refreshCrafting() {
    const game = this.game;
    if (!game || !this.craftListEl) return;
    const stations = game.stationsNearby();
    // 防御计数器随装备列迁右下角坞（2026-09-02）——root 级查（面板/坞都覆盖）
    const defEl = this.root.querySelector('[data-role="defense"]') as HTMLElement | null;
    if (defEl) {
      // 防御计数器刷新（DrawDefenseCounter :41557）：盾帧 = 难度列(0/1/2),
      // 专家/大师叠辉光行(静态 α0.45 近似原版脉动;大师红绿脉冲未做,偏差记录)。
      // 盾图 = img dataURL 按 (难度列,是否带辉光) 缓存——不再持独立 canvas 后备
      const p = this.game.player;
      const w = this.game.world;
      const col = w.isMaster ? 2 : w.isExpert ? 1 : 0;
      const imgEl = defEl.querySelector('img');
      const shield = this.game.atlas?.vmisc('vanilla/Extra_58.png');
      if (imgEl && shield) {
        const glow = col > 0 && p.defense > 0;
        const key = `${col}|${glow ? 1 : 0}`;
        let url = DEF_SHIELD_URLS.get(key);
        const sc = DEF_SHIELD_SCRATCH;
        if (!url && sc) {
          const sx2 = sc.getContext('2d', { willReadFrequently: true })!;  // toDataURL 烘焙,SHM 后备
          sc.width = 52; sc.height = 48;
          sx2.clearRect(0, 0, 52, 48);
          sx2.drawImage(shield.img, shield.sx + col * 52, shield.sy, 52, 48, 0, 0, 52, 48);
          if (glow) {
            sx2.globalAlpha = 0.45;
            sx2.drawImage(shield.img, shield.sx + col * 52, shield.sy + 48, 52, 48, 0, 0, 52, 48);
            sx2.globalAlpha = 1;
          }
          url = sc.toDataURL('image/png');
          DEF_SHIELD_URLS.set(key, url);
        }
        if (url && imgEl.getAttribute('src') !== url) imgEl.src = url;
      }
      // ★SW-BI1 2026-09-06：去非空断言改空守卫——本函数经 refreshAll 的 rAF 合并
      //  通道在背包事件风暴期逐帧跑，defEl 内缺 <span>（旧档/坞迁移期标记不齐）
      //  曾以 `Cannot set properties of null (setting 'textContent')` 每帧刷屏
      //  （SW-BI1 报告 49 连发同形），守卫后静默跳过等下轮重建补齐。
      const defNumEl = defEl.querySelector('span');
      if (defNumEl) defNumEl.textContent = String(p.defense);
    }
    const stationsEl = this.invPanel.querySelector('[data-role="stations"]') as HTMLElement;
    if (stationsEl) {
      const stName: Record<string, string> = { hand: Lang.text('Mods.SandboxWorld.UI.StationHand'), workbench: '🛠 ' + Lang.text('ItemName.WorkBench'), furnace: '🔥 ' + Lang.text('ItemName.Furnace'), anvil: '⚒ ' + Lang.text('ItemName.IronAnvil') };
      stationsEl.textContent = Lang.text('Mods.SandboxWorld.UI.CraftStations', [...stations].map((s) => stName[s] ?? s).join('、'));
    }
    // 自制 RECIPES 表已随本地物品退役整体移除——合成列表只留原版配方段
    // （3309 条，Recipe.UpdateRecipeList 主干：环境+材料双门）
    this.refreshVanillaCrafting();
  }

  /** 合成列表选中配方（材料格数据源；★仅点击行设置——2026-08-25 用户定案：
   *  滚动只滚列表不换选中，材料格/详情不随滚动切换。-1=未选中（初始/搜索
   *  重置）→ 材料格空,不默认显示第一个配方(2026-08-25 用户定案) */
  private craftFocus = -1;
  /** 当前可用配方（行内容与材料格的共用数据源;met=「仅用背包材料即可合成」的
   *  排序层标记——SW-AV2 起与置灰/可点解耦,置灰只看 count<=0;签名比对跳过无关
   *  重建——r 引用静态 VANILLA_RECIPES 恒稳） */
  private craftAvailRef: Array<{ r: import('../data/vanillaRecipes').VanillaRecipeLike; count: number; met: boolean }> = [];
  private static readonly CRAFT_ROW_H = 30;   // border-box: 22 贴图+3×2 padding+2 边框=30;容器高度按 30 整除取整(末行半裁观感即消失)
  /** 悬停预览行（材料格显示源；-1=无）。★只动材料格不动列表——列表滚动
   *  已交还浏览器原生溢出容器（2026-09-01 定案），hover 不参与任何滚动计算 */
  private hoverFocus = -1;
  /** Modern 合成网格：搜索栏 + 焦点配方材料格（1.4.5 CraftingGrid 语义） */
  private craftSearchEl: HTMLInputElement | null = null;
  private craftGridEl: HTMLElement | null = null;
  /** 材料格已存（原版 vid → 数量；焦点配方切换/关面板时归还背包） */
  private craftGrid = new Map<number, number>();
  private craftGridRecipe: VanillaRecipeLike | null = null;
  /** 原版配方列表（数据驱动 1457 全量）。
   *  ★2026-09-01 滚动架构定案（用户：自算滚动是负优化,回归浏览器原生滚动）：
   *  容器=overflow-y:auto 溢出容器,行=静态流式子元素整表铺陈,滚轮/滚动条/触控
   *  全部交还 DOM。整体退役：行池+浮点锚 rAF 缓动+自绘滚动条（原 craftWheelStep/
   *  craftAnimFrame/craftPaintWindow/craftScrollJump）。保留的行为语义：可合成
   *  排前+未满足置灰垫底、hover 预览两门、选中仅点击、shift×10、重建回填
   *  scrollTop。重建按内容签名跳过——refreshAll 高频（hover/拾取），3300 行
   *  整表重建只许发生在真实数据变化上 */
  private refreshVanillaCrafting(): void {
    const game = this.game;
    const cl = this.craftListEl;
    if (!game || !cl) return;
    let avail = game.vanillaAvailableRecipes();
    // 材料源聚合持有量表（Recipe._ownedItems——GetAvailableItemCount 数据面）：
    // SW-AV2 2026-09-06 修复「宝箱里的物品不参与制作」：合成扣料链（vanillaCraft →
    // consumeMaterials）早已计入附近箱/bank（craftSourcesFor,Recipe.cs:375-407）,
    // 唯本列表的满足度/材料统计只读背包——箱内材料行被误判「未满足」置灰禁点。
    // 材料统计自本表取数,与可用性判定同源（同 tick _craftSourcesCache）。
    const owned = game.vanillaCraftOwned();
    // ★SW-RB1 2026-09-06 met 判据修复：met =「仅用背包材料即可合成」排序层标记
    // （见下注/2026-08-27 用户要求：背包齐料行排最前、需动用附近箱/bank 料行垫底）。
    // SW-AV2 曾误用聚合表（含箱/bank）算 met ⇒ met ≡ (count>0) 恒真（本列表只入列
    // count>0 行）⇒ 排序退化空转。判据改回背包-only 表（collectOwnedItems 无源态）；
    // 置灰(.no)/点击门维持 SW-AV2 聚合面不变（箱料行仍可点可合成）
    const ownedInvOnly = collectOwnedItems(game.player.inv);
    const q = this.craftSearchEl?.value.trim().toLowerCase() ?? '';
    if (q) {
      const filtered = avail.filter(({ r }) => {
        const k = vanillaItemKey(r.create);
        const name = k ? Lang.itemNameByKey(k) : '';
        return name.toLowerCase().includes(q);
      });
      if (filtered.length) avail = filtered;
    }
    // ★2026-08-27 用户要求：可合成（背包材料齐）排最前，「需动用附近箱/bank 材料」
    // 的行垫底（仍可点击合成——vanilla 语义：CollectedEnoughItemsToCraft>0 即入列
    // 可合成,UpdateRecipeList Recipe.cs:252;原版不区分材料来自背包还是箱）。
    // SW-AV2：置灰(.no)只留给 count<=0（材料源聚合后仍不可合成——本表不会入列,
    // 防御性保留）,箱材料行不再置灰禁点。稳定排序保持组内原版注册序。
    const metFlags = avail.map(({ r }) => {
      let met = r.items.length > 0;
      for (const req of r.items) {
        const have = availableItemCountFor(r, req.id, ownedInvOnly);   // ★SW-RB1 2026-09-06 背包-only 判据（was: owned 聚合表 ⇒ 恒真）
        if (have < req.stack) { met = false; break; }
      }
      return met;
    });
    const rows: Array<{ r: VanillaRecipeLike; count: number; met: boolean }> = avail
      .map((e, i) => ({ ...e, met: metFlags[i] }))
      .sort((x, y) => Number(y.met) - Number(x.met));
    // ★2026-08-27 用户要求：列表高度钳视口（曾恒 240px 底部死区→改视口限）。
    // 2026-09-02：右侧竖列（图标/成就卡/表情）已入 rightRail 流内——上限只剩
    // 视口钳制（-32 底缘余量）；钳下限 240,按行高整除取整（末行半裁观感即消失）。
    // max-height 令短列表自然收合（不再手算 min(len*H)）。首帧布局未就绪（rect 0）
    // 时落 240 下限,后续刷新自校正
    const rectTop = cl.getBoundingClientRect().top;
    const byViewport = window.innerHeight - 32 - rectTop;
    const LIST_H = Math.max(240, Math.floor(byViewport));
    cl.style.maxHeight = `${Math.floor(LIST_H / UI.CRAFT_ROW_H) * UI.CRAFT_ROW_H}px`;
    // 内容签名比对：配方集/计数/满足态全等 → 跳过整表重建（列表 DOM 原样驻留，
    // 原生滚动位置天然不动）——hover/无关 refreshAll 不再付出 3300 行重建
    const prev = this.craftAvailRef;
    const unchanged = prev.length === rows.length
      && prev.every((p, i) => p.r === rows[i].r && p.count === rows[i].count && p.met === rows[i].met);
    this.craftAvailRef = rows;
    if (unchanged) {
      this.refreshCraftGrid(rows);
      return;
    }
    // 整表重建。滞留 hover 高亮随旧行销亡（新行伪类等真实 mousemove/enter 补挂）
    this.craftHoverEl = null;
    const keepScroll = cl.scrollTop;   // 重建回填：拾取/合成触发的刷新不归零滚动位置
    cl.replaceChildren();
    for (let idx = 0; idx < rows.length; idx++) {
      const rec = rows[idx];
      const { r, count } = rec;
      const row = el('div', 'sw-recipe');
      row.style.cssText = `height:${UI.CRAFT_ROW_H}px; box-sizing:border-box; padding:3px 8px; margin:0;`;
      const outKey = vanillaItemKey(r.create);
      const img = el('img') as HTMLImageElement;
      img.src = iconUrl(game, game.itemId(outKey ?? ''));
      row.appendChild(img);
      const label = el('span', '', `${outKey ? Lang.itemNameByKey(outKey) : '?'}${r.createStack > 1 ? ` ×${r.createStack}` : ''} ×${count}`);
      row.appendChild(label);
      const mats = el('span', '', r.items.map((req) => {
        const k2 = ingredientKey(req.id);
        if (!k2) return ` ? ${req.stack}`;
        // SW-AV2 2026-09-06：材料持有数取材料源聚合表（含附近箱/bank,GetAvailableItemCount
        // 同义）——曾只数背包,箱内料显示为缺口
        const have = availableItemCountFor(r, req.id, owned);
        return ` ${Lang.itemNameByKey(k2)} ${Math.min(have, req.stack)}/${req.stack}`;
      }).join(' ·'));
      mats.style.cssText = 'margin-left:auto; color:#9a8ab8; font-size:11px; text-align:right;';
      row.appendChild(mats);
      // 材料源聚合后仍不可合成 = 置灰（.sw-recipe.no img/span opacity .45）——
      // SW-AV2 起与「需动用箱料」的排序垫底层解耦：垫底层行样式正常、可点击
      row.classList.toggle('no', rec.count <= 0);
      // ★SW-BJ391 长按臂行重建换锚（craftPressTick 后每拍 refreshAll——签名变即整表
      //   重建,臂锚随旧行销亡;同配方新行换锚,:hover 逐拍复核承位）
      if (this.craftHold?.kind === 'list' && this.craftHold.r === rec.r) this.craftHold.el = row;
      row.addEventListener('mouseenter', (e) => {
        // 悬停预选两门（2026-08-21/24/25 定标,只动材料格不动列表）：
        // mousemove 门 150ms——滚动经停行无伴随 mousemove,不预选;
        // 滚轮门 350ms——滚动手势期间不预选
        if (performance.now() - this.craftMouseMoveLast > 150) return;
        if (performance.now() - this.craftWheelLast < 350) return;
        this.craftHoverEl?.classList.remove('hov');
        (e.currentTarget as HTMLElement).classList.add('hov');
        this.craftHoverEl = (e.currentTarget as HTMLElement);
        if (this.hoverFocus !== idx) { this.hoverFocus = idx; this.refreshCraftGrid(this.craftAvailRef); }
      });
      row.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        // SW-AV2 2026-09-06：可合成门 = 材料源聚合（背包+附近箱/bank）后 count>0
        // （vanilla CollectedEnoughItemsToCraft,Recipe.cs:280-283）——曾按背包-only
        // 满足度禁点,箱料齐的配方点不动（用户实报根因）。count<=0 行本表不会入列,
        // 门保留作防御。原注释「背包材料未齐,可经仓库合成」的禁点语义废弃。
        if (rec.count <= 0) return;
        // ★SW-BJ430：压拍两臂分派（HoverOverCraftingItemButton :42988 合成支/
        //  :43020 聚焦支 1:1——首击聚焦不合成+二击起合成+长按加速梯连做,见 craftListPress;
        //  旧单击即合成语义=X4-债5,2026-10-02 用户拍板按原版翻案）
        this.craftListPress(idx, rec, (ev as MouseEvent).shiftKey, row);
      });
      cl.appendChild(row);
    }
    cl.scrollTop = keepScroll;   // 浏览器自动钳到新 scrollHeight,列表缩短不悬空
    // Modern 合成网格材料格（焦点配方）
    this.refreshCraftGrid(rows);
  }

  /** 材料格覆盖计数：req（含组假 id）当前格内存量 */
  private gridCovered(reqId: number): number {
    if (reqId < 1000000) return this.craftGrid.get(reqId) ?? 0;
    const items = RECIPE_GROUP_ITEMS[String(reqId - 1000000)] ?? [];
    let n = 0;
    for (const m of items) n += this.craftGrid.get(m) ?? 0;
    return n;
  }

  /** 现代合成网格材料行（1.4.5 CraftingGrid：左键=放入/右键=取回/合成=格子优先） */
  private refreshCraftGrid(avail: Array<{ r: VanillaRecipeLike; count: number }>): void {
    if (!this.craftGridEl) return;
    // 材料格显示源：hover 预选行 > 点击选中的行 > 无（★不默认第一个配方,
    // 2026-08-25 用户定案）。srcIdx 越界(搜索后 avail 缩短)同样视为无
    const srcIdx = this.hoverFocus >= 0 ? this.hoverFocus : this.craftFocus;
    const focusR = (srcIdx >= 0 && srcIdx < avail.length) ? avail[srcIdx]?.r ?? null : null;
    // 焦点配方变更：归还旧格内容
    if (focusR !== this.craftGridRecipe) {
      this.returnCraftGrid();
      this.craftGridRecipe = focusR;
    }
    this.craftGridEl.textContent = '';
    if (!focusR) return;
    for (const req of focusR.items) {
      const chip = el('div', 'sw-slot chip');   // chip=38px 材料格（.sw-slot img 默认 52px 槽几何会溢出）
      // context 22 槽底 = Inventory_Back4（ItemSlot.cs:2101-2123）
      chip.style.cssText += 'width:38px; height:38px;'
        + 'background-image:url(sprites/vanilla-ui/Inventory_Back4.png);';
      const k = ingredientKey(req.id < 1000000 ? req.id : (RECIPE_GROUP_ITEMS[String(reqIdShift(req.id))]?.[0] ?? req.id));
      if (k) {
        const img = el('img') as HTMLImageElement;
        img.src = iconUrl(this.game, this.game.itemId(k));
        chip.appendChild(img);
      }
      const have = this.gridCovered(req.id);
      const cnt = el('span', 'cnt', `${have}/${req.stack}`);
      if (have >= req.stack) cnt.style.color = '#7de08a';
      chip.appendChild(cnt);
      chip.title = `${k ? Lang.itemNameByKey(k) : req.id}${Lang.text('Mods.SandboxWorld.Craft.PutTakeHint')}`;
      chip.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button === 2) { this.craftGridReturnReq(focusR, req.id); this.refreshAll(); return; }
        this.craftGridDeposit(focusR, req.id);
        this.refreshAll();
      });
      chip.addEventListener('contextmenu', (e) => e.preventDefault());
      this.craftGridEl.appendChild(chip);
    }
    // 合成按钮已去除（2026-08-21 用户要求）：点击配方行即合成——材料格只作
    // 存/取料暂存，行点击时格内存料先归还背包再走 vanillaCraft 统一扣料
    // （hover 预选换焦点时 returnCraftGrid 已归还，此处兜"点击已聚焦行"路径）
  }

  /** 材料格放入：从背包按缺口拉取（组材料依序拉组内成员） */
  private craftGridDeposit(r: VanillaRecipeLike, reqId: number): void {
    void r;
    const req = (r.items.find((x) => x.id === reqId));
    if (!req) return;
    const need = req.stack - this.gridCovered(reqId);
    if (need <= 0) return;
    const members = reqId >= 1000000 ? RECIPE_GROUP_ITEMS[String(reqIdShift(reqId))] ?? [] : [reqId];
    let left = need;
    for (const m of members) {
      if (left <= 0) break;
      const iid = invIndexOfVanilla(m);
      if (iid < 0) continue;
      const take = Math.min(this.game.player.inv.countOf(iid), left);
      if (take > 0) {
        this.game.player.inv.remove(iid, take);
        this.craftGrid.set(m, (this.craftGrid.get(m) ?? 0) + take);
        left -= take;
      }
    }
  }

  /** 材料格单材料取回（格内该 req 的全部存量回背包） */
  private craftGridReturnReq(r: VanillaRecipeLike, reqId: number): void {
    void r;
    const members = reqId >= 1000000 ? RECIPE_GROUP_ITEMS[String(reqIdShift(reqId))] ?? [] : [reqId];
    for (const m of members) {
      const n = this.craftGrid.get(m) ?? 0;
      if (n > 0) { this.game.player.inv.add(invIndexOfVanilla(m), n); this.craftGrid.delete(m); }
    }
  }

  /** 材料格全部归还背包（关背包/换焦点时） */
  returnCraftGrid(): void {
    for (const [vid, n] of this.craftGrid) {
      if (n > 0) {
        const iid = invIndexOfVanilla(vid);
        if (iid >= 0) this.game?.player.inv.add(iid, n);
      }
    }
    this.craftGrid.clear();
  }

  // ============ Toast ============

  toast(msg: string) {
    if (this.toastEl) this.toastEl.remove();
    const t = el('div', 'sw-toast', msg);
    this.toastEl = t;
    this.root.appendChild(t);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 500);
    }, 2500);
  }

  /** 成就解锁弹窗(原版 InGamePopups.AchievementUnlockedPopup:细条蓝底/图标在右
   *  ≈21px/标题右对齐其左;5s 淡入淡出)。name → ACH_ICON_INDEX 栅格取帧;
   *  点击关闭(原版跳成就页,成就页 UI 未接 GAP) */
  achievementPopup(name: string, title: string) {
    if (!this.achWrapEl) {
      this.achWrapEl = el('div', 'sw-ach-wrap');
      this.root.appendChild(this.achWrapEl);
    }
    const card = el('div', 'sw-ach');
    card.title = title;
    const ttl = el('span', 'ttl', title);
    const icn = el('div', 'icn');
    // 栅格帧 64px → 屏显 21px:整表 ×0.33 缩放后按帧偏移定位(等价原版 0.3×num 缩放)
    const K = 21 / 64;
    const idx = ACH_ICON_INDEX[name] ?? 0;
    const f = achIconFrame(idx);
    const sheet = el('img', 'sheet') as HTMLImageElement;
    sheet.src = 'sprites/vanilla/Achievements.png';
    sheet.style.width = `${1054 * K}px`;
    sheet.style.height = `${1186 * K}px`;
    sheet.style.left = `${-f.x * K}px`;
    sheet.style.top = `${-f.y * K}px`;
    const bdr = el('img', 'bdr') as HTMLImageElement;
    bdr.src = 'sprites/vanilla/Achievement_Borders.png';
    icn.appendChild(sheet); icn.appendChild(bdr);
    card.appendChild(ttl); card.appendChild(icn);
    const kill = () => {
      card.classList.add('out');
      setTimeout(() => card.remove(), 300);
    };
    // ★2026-09-07 用户需求:点击成就弹窗→打开成就面板+滚动定位到该成就+高亮
    // (原版点击跳成就页;本仓成就页=openAchievementsPanel,GAP 已补)
    card.onclick = () => {
      kill();
      if (this.game) {
        import('./AchievementsUI').then((m) => m.openAchievementsPanel(this.game, name));
      }
    };
    this.achWrapEl.appendChild(card);
    setTimeout(kill, 5000); // 300t = 5s(InGamePopups.cs:54)
  }

  // ============ 暂停菜单（原版像素风：IngameOptions.Draw + Utils.DrawInvBG） ============

  showPause(handlers: { onResume: () => void; onSave: () => void; onExport?: () => void; onQuit: () => void; onSettings?: () => void;
    /** ★2026-10-13:模组设置入口(有已启用 mod 才传=才渲染;双栏面板见 modSettingsPanel) */
    onMods?: () => void;
    /** ★2026-09-07 刀 5 停车坪(vanilla 布局):自创功能入口自背包簇格迁暂停菜单 */
    onItemSearch?: () => void; onWeather?: () => void; onTime?: () => void; onPlayerList?: () => void; onJourney?: () => void; onResearch?: () => void }) {
    // 已开守卫：移除旧面板再建新——防 ESC 快速连按/HMR 监听器堆积导致多层叠框
    document.querySelectorAll('.sw-pause-panel').forEach((el) => el.remove());
    if (!document.getElementById('sw-pause-style')) {
      const style = document.createElement('style');
      style.id = 'sw-pause-style';
      style.textContent = `
.sw-pause-panel {
  pointer-events:auto; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);
  width:360px; padding:30px 26px 18px; z-index:31; box-sizing:border-box;
  background-repeat:no-repeat; background-size:100% 100%; image-rendering:pixelated;
  font-family:"Fusion Pixel 12px","Microsoft YaHei",sans-serif; user-select:none;
}
.sw-pause-panel.fallback-bg { background:#2a1a63; } /* 素材未载时的兜底(IngameOptions 面板色系) */
.sw-pause-title {
  position:absolute; top:-15px; left:0; right:0; text-align:center;
  font-size:20px; letter-spacing:3px; color:#fff; pointer-events:none;
  text-shadow:2px 0 0 #000,-2px 0 0 #000,0 2px 0 #000,0 -2px 0 #000,2px 2px 0 #000;
}
.sw-pause-btn {
  display:block; width:100%; background:none; border:none; cursor:pointer;
  font-family:inherit; font-size:18px; letter-spacing:3px; color:#fff; padding:8px 0;
  text-shadow:2px 0 0 #000,-2px 0 0 #000,0 2px 0 #000,0 -2px 0 #000;
  transition:color .1s;
}
.sw-pause-btn:hover { color:#ffd76e; }
`;
      document.head.appendChild(style);
    }
    const panel = el('div', 'sw-pause-panel fallback-bg');
    panel.appendChild(el('div', 'sw-pause-title', Lang.text('Mods.SandboxWorld.UI.Paused')));
    const mkBtn = (label: string, fn: () => void) => {
      const b = el('button', 'sw-pause-btn', label);
      b.onclick = fn;
      return b;
    };
    const bRes = mkBtn(Lang.text('Mods.SandboxWorld.UI.Resume'), () => { panel.remove(); handlers.onResume(); });
    const bSave = mkBtn(Lang.text('Mods.SandboxWorld.UI.SaveGame'), () => handlers.onSave());
    const bExp = handlers.onExport
      ? mkBtn(Lang.text('Mods.SandboxWorld.UI.ExportSave'), () => handlers.onExport?.())
      : null;
    const bSet = mkBtn(Lang.text('LegacyMenu.14'), () => handlers.onSettings?.());
    const bQuit = mkBtn(Lang.text('Mods.SandboxWorld.UI.BackToMenu'), () => { panel.remove(); handlers.onQuit(); });
    // ★2026-09-14 反馈轮8:住房/图鉴入口摘除(住房=原版 EquipPage=1 页签面已在背包;
    //  图鉴=背包 2×2 钮已有),天气/时间/道具搜索收入"开发者选项"子视图
    const clearRows = (): void => {
      panel.querySelectorAll('.sw-pause-btn').forEach((n) => n.remove());
    };
    const buildDev = (): void => {
      clearRows();
      if (handlers.onWeather) panel.appendChild(mkBtn('天气控制', () => { panel.remove(); handlers.onWeather?.(); }));
      if (handlers.onTime) panel.appendChild(mkBtn('时间控制', () => { panel.remove(); handlers.onTime?.(); }));
      if (handlers.onItemSearch) panel.appendChild(mkBtn('道具搜索', () => { panel.remove(); handlers.onItemSearch?.(); }));
      panel.appendChild(mkBtn(Lang.text('Mods.SandboxWorld.MP.Back'), () => buildMain()));   // 返回
      applyBg();
    };
    const buildMain = (): void => {
      clearRows();
      panel.append(bRes, bSave);
      if (bExp) panel.appendChild(bExp);
      panel.append(bSet);
      // 停车坪钮组(★刀 5:vanilla 布局时自创功能入口;classic 不传=不渲染)
      if (handlers.onPlayerList) panel.appendChild(mkBtn(Lang.text('Mods.SandboxWorld.PlayerList.Title'), () => { panel.remove(); handlers.onPlayerList?.(); }));
      if (handlers.onJourney) panel.appendChild(mkBtn(Lang.text('Mods.SandboxWorld.JourneyPowers.Title'), () => { panel.remove(); handlers.onJourney?.(); }));
      // ★SW-RB14b:研究钮标签订正(LegacyInterface.112 原版=你必须先设置边框,非研究面)
      if (handlers.onResearch) panel.appendChild(mkBtn(Lang.text('Mods.SandboxWorld.Research.Title'), () => { panel.remove(); handlers.onResearch?.(); }));
      // ★模组设置入口(2026-10-13 用户令):有已启用 mod 才渲染(main.ts 门控);
      //   面板不摘本面板=关闭设置回暂停菜单(与设置钮叠层语义同)
      if (handlers.onMods) panel.appendChild(mkBtn(Lang.text('Mods.SandboxWorld.ModSettings.Title'), () => handlers.onMods?.()));
      if (handlers.onWeather || handlers.onTime || handlers.onItemSearch) {
        panel.appendChild(mkBtn(Lang.text('Mods.SandboxWorld.UI.DevOptions'), () => buildDev()));
      }
      panel.append(bQuit);
      applyBg();
    };
    this.root.appendChild(panel);
    // 原版像素面板底:Inventory_Back13 九宫(Utils.DrawInvBG :2672+:2681,
    // IngameOptions.Draw 面板色 (33,15,91)×0.685)逐像素乘色后按角 10px 合成;
    // 素材懒加载竞态(首次打开未就绪)时保留兜底底色,下次打开生效
    const applyBg = () => {
      if (!panel.isConnected) return; // 面板已关(素材加载慢于关闭)
      const url = invBgDataUrl(panel.offsetWidth, panel.offsetHeight);
      if (url) {
        panel.style.backgroundImage = `url(${url})`;
        panel.classList.remove('fallback-bg');
      }
    };
    buildMain();   // 初始主视图(住房/图鉴已摘,自创项入开发者选项子视图)
    requestAnimationFrame(applyBg);
    const img = invBgEnsure();
    // ★bitmap 就绪语义(2026-08-14 修复):invBgImg 升级为 ImageBitmap 后无
    // .complete/.addEventListener——守卫只对 HTMLImageElement 阶段生效;
    // bitmap 存在即已解码,invBgDataUrl 内部自会走 width 判定
    if (img && img instanceof HTMLImageElement && !img.complete) img.addEventListener('load', applyBg, { once: true });
    return panel;
  }

  closeAll() {
    this.chatMonitor?.clear(); // 消息列根节点随 root 清空,定时器必须同步清防泄漏
    this.chatMonitor = null;
    this.root.innerHTML = '';
    this.heldStack = null;
    this.openChest = null;
    // ★R15-F15（2026-10-11 C15 清偿,占卜球 5644 丢件定谳）：在-game 路径
    //   （onCloseAllUI=IngameUIWindows.CloseAll Main.cs:43017）原版【不触】reforgeItem
    //   ——CloseAll 只关窗,重铸物由下一拍强制退出臂归还（:42282-42288
    //   talkNPC==-1 → InReforgeMenu=false + dropItemCheck reforgeItem 支
    //   Player.cs:5115-5118）=原版位次。本仓等价：置 vinvReforgeForcedReturn 旗,
    //   下一拍 tickStackSplitMain 头臂 returnReforgeItem() 归还。菜单路径
    //   （showTitle/quitToMenu/showMainMenu/showMultiplayerSelect）维持直清
    //   =原版 ClearPlayerTempInfo TurnToAir 同相（BJ633 登记债维持）。
    if (this.game) this.vinvReforgeForcedReturn = true;
    else this.reforgeItem = null;
    this.detachGame();
    this.reforgeEl?.remove();
    this.reforgeEl = null;
    this.guideEl?.remove();
    this.guideEl = null;
    this.itemSearchEl?.remove();
    this.itemSearchEl = null;
    // ---- 生命周期外挂清理(2026-08-13 泄露 review,审计三高危之一)----
    // 此前只清 DOM 不关逻辑面板:clothesPanel 孤儿(rAF/keydown/Lang 永转)、
    // npc 对话/商店/心情浮层留 stale window keydown、成就/研究模块单例滞留
    // uiBlocking=true、achWrapEl 陈旧引用(退菜单后成就弹窗永久不可见)
    this.clothesPanel?.close();
    this.clothesPanel = null;
    this.closeNpcDialog();
    closeAchievementsPanel();
    closeResearchPanel();
    // ★BJ704-G7 件5：Journey 面板同律收口（closeAll=IngameUIWindows.CloseAll
    //  Main.cs:43017 语义=fancy UI 全关——Research 在收而 Journey 缺席=不对称遗漏,
    //  面板变量/Esc 监听/uiBlocking claim（栈律 token）滞留到下局）
    closeJourneyPowersPanel();
    this.achWrapEl = null;
    // 住房右缘条（body 级 Canvas,不随 root 清空）——先摘旗再 destroy：onClosed
    // 里 `if (game) openInventory` 在退菜单路径 game 已 null,不会误开背包
    this.housingOpen = false;
    this.refreshHousingBtn();
    (window as unknown as { __swHousingPanel?: { destroy(): void } }).__swHousingPanel?.destroy();
    document.querySelector('.sw-housing-panel')?.remove();
    // ★BJ318/BJ319（2026-09-24）：游离 HUD 树滞留扫除——root.innerHTML 清了 DOM,
    //  但数十个 this.*El/*Els 字段继续引用已脱离节点树,其上的监听器闭包把上一局
    //  Game 钉在 UI 单例上（BJ319 探针实测:每重进 +~900 listeners,基线 1106→3025）。
    //  反射扫场:凡 *El/*Els 命名且值为 Node / Node[] 的实例字段一律清空
    //  （root 本体保留;下局 initInGame/build* 重建时全部重填）。
    const hasNode = (o: unknown): boolean =>
      !!o && typeof o === 'object' && Object.values(o as Record<string, unknown>).some((p) => p instanceof Node);
    for (const k of Object.getOwnPropertyNames(this)) {
      if (k === 'root' || !/(El|Els)$/.test(k)) continue;
      const v = (this as unknown as Record<string, unknown>)[k];
      if (v instanceof Node) (this as unknown as Record<string, unknown>)[k] = null;
      else if (Array.isArray(v) && (v.length === 0 || v.every((x) => x === null || x instanceof Node))) (this as unknown as Record<string, unknown>)[k] = [];
      // 槽位视图数组（元素为 {el,...} 复合对象——el 指向游离树节点）
      else if (Array.isArray(v) && (v.length === 0 || v.every((x) => x === null || hasNode(x)))) (this as unknown as Record<string, unknown>)[k] = [];
    }
    // ★BJ328（2026-09-24）：命名不合 *El/*Els 的元素持有字段补扫——上刀反射扫场只认
    //  (El|Els)$ 后缀，漏掉背包面板树根两字段（invPanel/vinvRoot，7313 处同指一棵树）。
    //  退世界后仍钉整棵游离树（~700 元素/~950 监听器）；teardownInventoryPanel 只在
    //  【重建时】跑，菜单期与「重建后旧树」两形态都靠这里摘。下局 initInGame→
    //  buildInventoryFor 全部重填，无消费窗（回标题路径无背包面板读写）。
    this.invPanel = null as unknown as HTMLElement;
    this.vinvRoot = null;
    this.vinvSlots.clear();
    this.vinvLayoutItems = [];
    this.vinvShopCells = [];
    this.vinvCraftCellEls = [];
    this.loadoutBtns = [];
    this.pvpTeamBtns = [];
    this.vinvQuickBtn = this.vinvSortBtn = this.vinvBestiaryBtn = this.vinvEmoteBtn = null;
    this.vinvTabMisc = this.vinvTabHousing = this.vinvTabCamera = null;
    this.vinvHousingPage = null;
    // ★BJ335（2026-09-24）：退世界主锚收刀——closeAll 直接跑 teardownInventoryPanel。
    //  快照定谳（中立探针 /tmp/bj335-neutral.heapsnapshot,零插桩;活对象桥 queryObjects
    //  测得 +376/轮 为自捕伪影——DevTools console 全局句柄钉住查询结果数组,弃用）：
    //  每轮游离 vinv 面板整树（~400 节点/~900 监听器）经 UI 单例【漏网字段】滞留——
    //  vinvModernGridInner(14 钮)/vinvModernFilterBtns(11 钮)/vinvPageEls(equip/misc/
    //  housing 页)/accEyeEls(Map×7)/pvpSwordBtn/vinvShopHappyIcon/Text/vinvShopCoinIcons/
    //  tooltip 等既不合 *El/*Els 命名门也不在 BJ328 补扫清单;window 级
    //  vinvGridWheelHandler(wheel)/vinvResizeHandler(resize)/modern 滚轮
    //  mousemove/mouseup 更是只有【重建时】才跑的 teardownInventoryPanel 才解绑。
    //  这些外部钉拉住环内 closure 岛(statusOf/gatesOf/paintSlot/panelBg…),
    //  GC 对环本身无能为力。teardown 全量摘字段+对称解绑 window 监听,下局
    //  initInGame→buildInventoryFor 全部重填,退世界窗口期无消费路径。
    this.teardownInventoryPanel();
    // tooltip/onEmoteMenu 在 teardown 辖域外:tooltip 由 buildHud 每轮重建覆盖,
    // onEmoteMenu 由表情钮构建每轮重写——退世界窗口期两者钉游离节点/轮次 context
    // （快照:UI#310353 property:'onEmoteMenu'/'tooltip' 直指游离树成员）。
    this.tooltip = null as unknown as HTMLElement;
    this.tooltipHome = null;
    this.onEmoteMenu = undefined;
    // ★BJ335 主锚:options 长存 store 的每轮订阅统一退订（快照定谳——OptionsStore.
    // listeners 10 项=1 构造器订阅+3 轮×3 每轮订阅,闭包 context 连整轮构建岛,
    // 不退订=游离 vinv 面板 ~400 节点/轮被钉死）。下局构建器重订阅,无行为变化。
    for (const u of this.optionsUnsubs) u();
    this.optionsUnsubs.length = 0;
    // buff 四 Map(buildBuffBar 逐轮覆写键值,退世界窗口期持旧轮 buff 节点)
    // ——只在 closeAll 清（rebuildInventoryPanel→teardown 路径不清:紧接重建依赖旧值显示）
    this.buffBlocks.clear();
    this.petBuffBlocks.clear();
    this.mountBuffBlocks.clear();
    this.nebulaBuffBlocks.clear();
  }

  /** 摘除 Game 引用(quitToMenu→closeAll 调用):防旧 Game 整图(世界 store
   *  数十 MB typed array)被 UI 挂到下次进世界才释放(2026-08-13 泄露 review)。
   *  字段保持非空类型(definite assignment)避免 87 处消费点连锁改判空 */
  detachGame(): void {
    this.game = null as unknown as Game;
  }

  /** 初始化 HUD 相关面板（进入游戏后调用一次） */
  initInGame() {
    // 原版左下角消息列(Main.NewText → LegacyChatMonitor;NewText 播 SoundID 12)
    this.chatMonitor?.clear();
    this.chatMonitor = new ChatMonitor(this.root, () => UISfx.sfx.play('menuTick', 1));
    // 回放进世界前缓冲的消息(如新世界出生时的 NPC 入驻公告)
    for (const [t, r, g, b, width] of this.chatPending) this.chatMonitor.message(t, r, g, b, width);
    this.chatPending = [];

    // ★2026-09-07 刀 2:布局分派(必须走 buildInventoryFor 登记 _builtLayout——
    // 共享守卫以它为门;vanilla 分支必须在 buildHud【之后】跑——.sw-vinv 的 DOM 序
    // 在 hotbarEl 之后,关包态全局 slotEl(0-9) 首匹配=热键栏格)
    const vinvLayout = options.data.inventoryLayout === 'vanilla';
    if (!vinvLayout) this.buildInventoryFor('classic');   // classic 原路径(构建器零改动)
    if (!vinvLayout) this.buildChestPanel();   // vanilla 布局宝箱条=vinvBuildChest(防 chest 槽双份)
    this.buildBuffBar();
    this.buildHud(this.game);
    if (vinvLayout) this.buildInventoryFor('vanilla');
    // Buff → 图标物品映射
    const map: Array<[BuffType, string]> = [
      [BuffType.Agility, VI(290)], [BuffType.Ironskin, VI(292)],
      [BuffType.Resistance, VI(188)], [BuffType.Thorns, VI(301)],
      [BuffType.Regen, VI(289)], [BuffType.Honey, VI(1128)],
      // 环境 debuff(原版用专属 buff 贴图,此处以近义物品图标近似)
      [BuffType.OnFire, VI(8)], [BuffType.Burning, VI(117)],
      [BuffType.Bleeding, VI(28)], [BuffType.Suffocation, VI(169)],
      [BuffType.ObsidianSkin, VI(288)], [BuffType.Gills, VI(291)],
      [BuffType.ManaRegen, VI(293)], [BuffType.MagicPower, VI(294)],
      [BuffType.Featherfall, VI(295)], [BuffType.WaterWalking, VI(302)],
      [BuffType.Archery, VI(303)], [BuffType.NightOwl, VI(299)],
      // R1 数值批（vi_ 药水物品图标）
      [BuffType.Battle, 'vi_300_BattlePotion'], [BuffType.Calming, 'vi_2324_CalmingPotion'],
      [BuffType.Mining, 'vi_2322_MiningPotion'], [BuffType.Builder, 'vi_2325_BuilderPotion'],
      [BuffType.Heartreach, 'vi_2323_HeartreachPotion'], [BuffType.FlipperPotion, 'vi_2327_FlipperPotion'],
      [BuffType.Titan, 'vi_2326_TitanPotion'], [BuffType.AmmoReservation, 'vi_2344_AmmoReservationPotion'],
      [BuffType.Lifeforce, 'vi_2345_LifeforcePotion'], [BuffType.Endurance, 'vi_2346_EndurancePotion'],
      [BuffType.Wrath, 'vi_2349_WrathPotion'], [BuffType.Rage, 'vi_2347_RagePotion'],
      [BuffType.Tipsy, 'vi_2266_Sake'],
      // 1457 魔力过热 396：Buff_396.png 已随 1457 素材批入仓（buff 栏走
      // /sprites/vanilla/Buff_396.png 直链,UI.ts:2775）——本条降级为 onerror 兜底保留
      [BuffType.ManaHeat, 'vi_189_ManaPotion'],
      // 后期批（近似图标：月噬→吸血鬼 knives / 遮挡→暗影钥匙）
      [BuffType.MoonLeech, 'vi_1569_vampire_knives'], [BuffType.Obstructed, 'vi_329_shadow_key'],
      // 食物三档（以已注册食物贴图为图标近似）
      [BuffType.WellFed, 'vi_5275_joja_cola'], [BuffType.WellFed2, 'vi_4023_grapes'],
      [BuffType.WellFed3, 'vi_1919_sugar_cookie'],
      // 微光化 353：银河珍珠 5340 近似（原版 Buff 353 无独立物品图标，debuff 显示
      // 微光池主素材；两处 init 路径的 map 必须同步——曾只加一处导致另一路径无图标）
      [BuffType.Shimmered, 'vi_5340_galaxy_pearl'],
    ];
    for (const [t, key] of map) this.buffIconItem.set(t, ITEM_BY_KEY[key]);  }

  /** 原版消息列(Main.NewText 入口) */
  private chatMonitor: ChatMonitor | null = null;
  /** 消息缓冲:ChatMonitor 未建(initInGame 之前,如新世界 afterWorldLoad
   *  发出的 NPC 入驻公告)时暂存,initInGame 创建后回放——曾直接丢弃 */
  private chatPending: Array<[string, number, number, number, number]> = [];
  chatMessage(text: string, r = 255, g = 255, b = 255, width = -1): void {
    if (this.chatMonitor) this.chatMonitor.message(text, r, g, b, width);
    else this.chatPending.push([text, r, g, b, width]);
  }

  // ---- NPC 对话系统(SetTalkNPC + GetChat;内容在 Game 生成,此处纯渲染) ----
  private npcDialog: NpcDialog | null = null;
  private npcShop: NpcShop | null = null;

  /** 配装切换白闪（GetColorByLoadout :2554-2559：Remap(dt,0,30,0.5,0)³→白）。
   *  背包按钮与 Loadout1/2/3 热键（onLoadoutSwitched 回调）共用。
   *  ★ class 必须播完即摘：display:none→block 会使 CSS 动画重播，
   *    残留 class 会导致此后每次打开背包全体槽位白闪 */
  flashLoadoutSwitch(): void {
    // 面板+右下角坞一起闪（装备槽 2026-09-02 迁坞,只闪面板会漏装备/染料列）
    for (const root of [this.invPanel, this.eqDockEl]) {
      if (!root) continue;
      root.classList.remove('sw-loadout-flash');
      void root.offsetWidth;
      root.classList.add('sw-loadout-flash');
      setTimeout(() => root.classList.remove('sw-loadout-flash'), 600);
    }
  }

  /** ★Q-F9 槽级 blocked 回执（QuickStacking.cs:360-363 RestoreToPlayer flag 支 →
   *  ItemSlot.IndicateBlockedSlot :527 = AddPulseEffect(250,40,40)；Draw
   *  ItemSlot.cs:2343-2352 用 InventoryBack21 叠层 × 包络 0.5+0.2·(−cos(πt+π)) ×(1−t⁴)，
   *  PulseEffect.EffectDuration=40t ≈667ms）。仓内最贴近通道 = .sw-slot 色层动画族
   *  （sw-loadout-flash 同型，::before 叠层）；cos 双脉冲包络以 ease-out 单脉冲近似
   *  （★形差登记：指数尾 vs (1−t⁴)+cos 波形差,视觉语义=同格红闪一次）。slots =
   *  quickStackToChests().blockedSlots（主段背包槽号 10-49；includeVoidBag 臂的 bank4
   *  槽号无 data-idx 槽元素 → 查不到静默跳过,与原版 Bank4 面板独立回执面的形差在案） */
  indicateBlockedSlots(slots: number[]): void {
    for (const s of slots) {
      const slotEl = this.slotEl(s, 'inv');
      if (!slotEl || !slotEl.isConnected) continue;
      slotEl.classList.remove('sw-blocked-pulse');
      void slotEl.offsetWidth;
      slotEl.classList.add('sw-blocked-pulse');
      setTimeout(() => slotEl.classList.remove('sw-blocked-pulse'), 700);
    }
  }

  showNpcDialog(name: string, chat: string, buttons: Array<{ id: NpcButtonId; label: string; coins?: number }>, portrait?: DialoguePortraitPayload | null, vanillaId?: number, cornerItem?: number): void {
    if (!this.npcDialog) {
      this.npcDialog = new NpcDialog(this.root, (id) => {
        this.npcShop?.close();
        this.npcShop = null;
        this.game?.npcDialogButton(id);
      }, (vid) => {
        if (vid === -1) {
          // EquipPage[5] 快捷图标（Main.cs:40534-40539）：CloseNPCChatOrSign(quiet)+
          // OpenInventory()+EquipPageSelected=1——本仓装备列常驻，开背包即达
          // ★FX23:force 开(原版 Player.OpenInventory Player.cs:5071-5075 =
          //   playerInventory=true force-open,非翻转——同 onGuideCraftOpen 定谳)
          this.game?.closeNpcDialog();
          this.openInventory(true);
          return;
        }
        // 渔夫任务鱼角标点击 → 开聊天框插 [i:vid]（Main.cs:40505-40512）
        this.game?.insertChatItemTag(vid);   // 懒建兜底（首次点击时 chatInput 尚为 null）
      });
    }
    // 角标：>0=任务鱼(iconUrl 懒加载即时解析一次,title 名);-1=装备页快捷图标
    // （由 NpcDialog 渲染 DisplaySlots_5）
    const corner = cornerItem !== undefined && cornerItem > 0
      && this.game && iconUrl(this.game, internalIdOfVid(cornerItem))
      ? { vid: cornerItem,
          url: iconUrl(this.game, internalIdOfVid(cornerItem)) || '',
          name: Lang.itemName(cornerItem) ?? '' }
      : cornerItem === -1
        ? { vid: -1, url: '', name: '' }   // -1 态 NpcDialog 渲染 DisplaySlots_5
        : undefined;   // 任务鱼 icon miss 时整角标不画（防 <img src=""> 破图占位）
    this.npcDialog.open(name, chat, buttons, portrait, vanillaId, corner);
  }

  closeNpcDialog(): void {
    this.npcDialog?.close();
    this.npcShop?.close();
    this.npcShop = null;
    this.npcHappiness?.close();   // 心情浮层随对话框一并关闭
    // ★SW-FX32:内嵌货架随关店收面（pos 门读 game.npcShopOpen——refreshAll 触发
    //  layoutVanilla 重排,sig 含 chestOpen=npcShopOpen 必翻 → 货架/头部 display:none）
    if (this._builtLayout === 'vanilla') this.refreshAll();
  }

  showNpcShop(title: string, items: Array<{ key: string; vanillaId: number; name: string; price: number; medal?: number; buyback?: number; stack?: number; prefix?: number }>, copper: number, happinessPct?: number, medals?: number, medalsTotal?: number): void {
    // ★SW-BJ8 2026-09-07 开店强制开背包（Main.OpenShop Main.cs:41162-41170 首行
    //  :41164 `playerInventory = true`，1458 本域无增量）：缺此行=商店开着时背包
    //  面板不自动展开——可见物品只剩快捷栏，而关包快捷栏 = context 13
    //  （Main.cs:44374 只 Draw 不 Handle）无 Alt/Shift/Ctrl 任何 ItemSlot 语义，
    //  背包格 10-49 又不在屏 → 缺省档（Quick Trash=Left Control）的 Ctrl+左键
    //  卖出（GetSellOrTrash ItemSlot.cs:185-196）无任何可达目标；且 Esc/E 在
    //  npcDialogActive 态均走关对话链（Player.cs:4960-5025 ToggleInv 优先序），
    //  背包在店开期间无法手动补开 ⇒「无法向 NPC 出售」整条死路（SW-BJ8 实报）。
    //  force=true：卖出/购买后 openNpcShop 重刷货架会再次进入本方法，
    //  openInventory 缺省是开/关翻转——非 force 会把背包连带关掉。
    this.openInventory(true);
    // 图标由 UI 侧按原版 id 补(atlas 管线)——iconUrl 收内部 id,vid 先转
    // (2026-08-28 修复:此前 vid 直喂=ITEM_DEFS[vid] 错位 def,商店图标张冠李戴)
    const entries: ShopEntry[] = items.map((it) => ({
      ...it,
      iconUrl: this.game ? iconUrl(this.game, internalIdOfVid(it.vanillaId)) || '' : '',
    }));
    // ★SW-FX32 刀①(2026-09-11) vanilla 内嵌位：原版店开态无独立面板——货架 40 格
    //  (Main.cs:42518-42532 context 15)/店名+储蓄(Main.cs:42502-42503 @(504,invBottom))/
    //  快乐度图标+倍率(Main.cs:42504-42512)全部住 .sw-vinv 原版几何(同 FX28 箱条面);
    //  NpcShop 浮面板 =classic 专属面(FX28 箱侧 chestPanel 同例)。Set-Back 钮退役
    //  (原版 Main.cs:42500-42532 全段无关闭钮——关店 = Esc/对话关闭/走远 closeNpcDialog 链)
    if (this._builtLayout === 'vanilla') {
      this.vinvShopPayload = { title, entries, copper, happinessMul: happinessPct ?? 1, medals, medalsTotal };
      this.refreshAll();   // → paintVanillaInvSlots → vinvRefreshShop(货架内容+头部)
      this.vinvShopIconPoll();
      return;
    }
    if (!this.npcShop) {
      this.npcShop = new NpcShop(this.root,
        // 行点击 = 有货商店格（PickItemMovementAction case 15 ItemSlot.cs:1426-1439）：
        // 光标持有物时 Game.npcShopBuy 内裁决——同型 CanStack（:1431）→ 买入叠光标
        // （HandleShopSlot :1910-1923，held.stack++）；异型 → result -1 整链无动作
        (vid, bb, bulk) => {
          const held = this.heldStack;
          if (held) {
            this.game?.npcShopBuy(vid, bb, held, bulk);   // 成交时 Game 侧 held.stack++
            this.refreshAll();                       // ghost 计数随叠购刷新
            return;
          }
          this.game?.npcShopBuy(vid, bb, undefined, bulk);
        },
        () => {
          this.npcShop?.close();
          this.npcShop = null;
          // Main.npcShop=-1 + 回购记清（Main.UpdateOldNPCShop 1457:18387-18393/
          //  1458 同位/1456:18054——★SW-RB14b 行号订正,旧注 18056-18064 系 1456 锚）：
          // 卖出/回购价依赖开店会话状态，关店必须通知 Game 侧失效
          this.game?.npcShopClose();
        },
        // ★SW-BJ22 2026-09-07 格位悬停 tooltip 代打（MouseHover context 15 →
        //  Main.HoverItem.buy=true ItemSlot.cs:3197-3201 → MouseText 物品全文 +
        //  AddShopLines 买入价行 Main.cs:20632-20402）。价格取数现查 Game——
        //  卖出/购买后 openNpcShop 重刷货架,闭包 entries 会陈旧；shopCell 传价
        //  走 shopTooltipContext 的 context15 买入价支（HoverItem.buy 语义）
        //  ★SW-FX32:主体迁 showShopCellTooltip 单源(内嵌货架共用)
        (hover, anchor) => this.showShopCellTooltip(hover, anchor));
    }
    this.npcShop.open(title, entries, copper, happinessPct, medals, medalsTotal);
    // 懒加载晚到升级(2026-08-13 枚举 review):开店瞬间 iconUrl miss(空串/程序化
    // 兜底)此前会冻结到关店——refreshAll 不触 npcShop。有界轮询就绪后原地补图,
    // 关店/超时即停(iconCache 只缓存命中,iconUrl 天然可升级)
    const g = this.game;
    if (g) {
      const initial = new Map(entries.map((e) => [e.vanillaId, e.iconUrl]));
      let tries = 0;
      const timer = setInterval(() => {
        const shop = this.npcShop;
        if (!shop || !shop.isOpen || ++tries > 15) { clearInterval(timer); return; }
        for (const e of entries) {
          const url = iconUrl(g, internalIdOfVid(e.vanillaId));
          if (url && url !== initial.get(e.vanillaId)) {
            initial.set(e.vanillaId, url);
            shop.setRowIcon(e.vanillaId, url);
          }
        }
      }, 600);
    }
  }

  /** 内嵌货架图标懒加载轮询(SW-FX32):vinvRefreshShop 重画时 paintSlot 现查
   *  iconUrl——懒加载就绪后下一拍原地升级;关店/超时(15 拍)即停。「src 不变不动」
   *  纪律(paintSlot)保证零解码浪费 */
  private vinvShopIconPoll(): void {
    let tries = 0;
    const timer = setInterval(() => {
      if (!this.game?.npcShopOpen || this._builtLayout !== 'vanilla' || ++tries > 15) {
        clearInterval(timer);
        return;
      }
      this.vinvRefreshShop();
    }, 600);
  }

  /** 商品格位悬停 tooltip 单源(SW-BJ22 语义面,SW-FX32 起浮面板/内嵌货架共用):
   *  MouseHover context 15 → Main.HoverItem.buy=true（ItemSlot.cs:3197-3201）→
   *  MouseText 物品全文 + AddShopLines 买入价行（Main.cs:20632-20402）。价格取数
   *  现查 Game——卖出/购买后 openNpcShop 重刷货架,闭包 entries 会陈旧;shopCell
   *  传价走 shopTooltipContext 的 context15 买入价支（HoverItem.buy 语义） */
  private showShopCellTooltip(hover: ShopCellHover, anchor: HTMLElement | null): void {
    if (!hover) {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
      return;
    }
    if (!this.game) return;
    const iid = internalIdOfVid(hover.vid);
    if (!iid) return;
    let shopCell: { price: number; medal?: number } | undefined;
    if (hover.buyback !== undefined) {
      const p = this.game.shopBuybackPriceOf(hover.vid, hover.buyback);
      if (p != null) shopCell = { price: p };
    } else {
      const medal = this.game.shopEntryMedalPriceOf(hover.vid);
      if (medal != null) shopCell = { price: medal, medal };
      else {
        const p = this.game.shopEntryPriceOf(hover.vid);
        if (p != null) shopCell = { price: p };
      }
    }
    this.showTooltipFor(iid, 'inv', {
      slot: { id: iid, stack: hover.stack, prefix: hover.prefix },
      anchor: anchor!,
      shopCell,
    });
  }

  /** NPC 快乐度详情浮层（ReportHappiness.Interact） */
  private npcHappiness: NpcHappinessPanel | null = null;

  showNpcHappiness(info: HappinessInfo): void {
    this.npcHappiness?.close();
    this.npcHappiness = new NpcHappinessPanel(this.root, () => { this.npcHappiness = null; });
    this.npcHappiness.open(info);
  }

  closeNpcHappiness(): void {
    this.npcHappiness?.close();
  }

  /** 梳妆台更衣窗（Main.OpenClothesWindow Main.cs:43568）：复用角色创建面板的
   *  外观/颜色页签，确认后回写角色档 */
  private clothesPanel: CharCreation | null = null;

  showClothesWindow(appearance: Appearance, onApply: (a: Appearance) => void): void {
    // 已开守卫(2026-08-13 泄露 review):此前直接覆盖引用——前一个 CharCreation
    // 的 rAF+window keydown+Lang 订阅永久无人清理(孤儿 rAF 永转)
    this.clothesPanel?.close();
    this.clothesPanel = new CharCreation(this.root, {
      // 更衣窗只改衣服样式+六色（确认=GameUI.Change，取消/Esc=回退不动外观）
      onCreate: (a) => { this.clothesPanel = null; onApply(a); },
      onCancel: () => { this.clothesPanel = null; },
    }, { initial: appearance, dresser: true });
  }

  /** 造型师理发窗（Main.OpenHairWindow Main.cs:43073——OpenHairWindow 快照
   *  oldHairStyle/oldHairColor，CancelHairWindow 回退）：只改发型+发色；
   *  确认 = BuyHairWindow（付款失败 toast 拒付，面板保留可改） */
  private hairPanel: CharCreation | null = null;
  showHairWindow(appearance: Appearance,
    quotes: { priceOf: (a: Appearance) => number; buy: (a: Appearance) => boolean },
    onApply: (a: Appearance) => void, onCancel?: () => void): void {
    this.hairPanel?.close();
    this.hairPanel = new CharCreation(this.root, {
      // 理发窗确认=购买（GameUI.BuyWithValue 动态报价）；取消/Esc=CancelHairWindow 回退
      onCreate: (a) => {
        if (!quotes.buy(a)) {
          this.toast(Lang.text('Mods.SandboxWorld.NPC.NotEnoughCoins'));
          this.showHairWindow(appearance, quotes, onApply, onCancel);   // 重建面板（购买被拒仍可改）
          return;
        }
        this.hairPanel = null;
        onApply(a);
      },
      onCancel: () => { this.hairPanel = null; onCancel?.(); },   // CancelHairWindow :43096 SetTalkNPC(-1)
    }, { initial: appearance, hairSalon: true, priceOf: quotes.priceOf });
  }

  /** M5：背包/快捷栏已 Canvas 化，DOM 仅保留 Buff 栏 + Toast */
  initInGameLite() {
    this.buildBuffBar();
    const map: Array<[BuffType, string]> = [
      [BuffType.Agility, VI(290)], [BuffType.Ironskin, VI(292)],
      [BuffType.Resistance, VI(188)], [BuffType.Thorns, VI(301)],
      [BuffType.Regen, VI(289)], [BuffType.Honey, VI(1128)],
      [BuffType.OnFire, VI(8)], [BuffType.Burning, VI(117)],
      [BuffType.Bleeding, VI(28)], [BuffType.Suffocation, VI(169)],
      [BuffType.ObsidianSkin, VI(288)], [BuffType.Gills, VI(291)],
      [BuffType.ManaRegen, VI(293)], [BuffType.MagicPower, VI(294)],
      [BuffType.Featherfall, VI(295)], [BuffType.WaterWalking, VI(302)],
      [BuffType.Archery, VI(303)], [BuffType.NightOwl, VI(299)],
      // R1 数值批（vi_ 药水物品图标）
      [BuffType.Battle, 'vi_300_BattlePotion'], [BuffType.Calming, 'vi_2324_CalmingPotion'],
      [BuffType.Mining, 'vi_2322_MiningPotion'], [BuffType.Builder, 'vi_2325_BuilderPotion'],
      [BuffType.Heartreach, 'vi_2323_HeartreachPotion'], [BuffType.FlipperPotion, 'vi_2327_FlipperPotion'],
      [BuffType.Titan, 'vi_2326_TitanPotion'], [BuffType.AmmoReservation, 'vi_2344_AmmoReservationPotion'],
      [BuffType.Lifeforce, 'vi_2345_LifeforcePotion'], [BuffType.Endurance, 'vi_2346_EndurancePotion'],
      [BuffType.Wrath, 'vi_2349_WrathPotion'], [BuffType.Rage, 'vi_2347_RagePotion'],
      [BuffType.Tipsy, 'vi_2266_Sake'],
      // 1457 魔力过热 396：Buff_396.png 已随 1457 素材批入仓（buff 栏走
      // /sprites/vanilla/Buff_396.png 直链,UI.ts:2775）——本条降级为 onerror 兜底保留
      [BuffType.ManaHeat, 'vi_189_ManaPotion'],
      // 后期批（近似图标：月噬→吸血鬼 knives / 遮挡→暗影钥匙）
      [BuffType.MoonLeech, 'vi_1569_vampire_knives'], [BuffType.Obstructed, 'vi_329_shadow_key'],
      // 食物三档（以已注册食物贴图为图标近似）
      [BuffType.WellFed, 'vi_5275_joja_cola'], [BuffType.WellFed2, 'vi_4023_grapes'],
      [BuffType.WellFed3, 'vi_1919_sugar_cookie'],
      // 微光化 353：银河珍珠 5340 近似（与上方 init 全量路径的 map 保持同步）
      [BuffType.Shimmered, 'vi_5340_galaxy_pearl'],
    ];
    for (const [t, key] of map) this.buffIconItem.set(t, ITEM_BY_KEY[key]);
  }

  // ================= 原版布局构建器(2026-09-07 刀 2;★SW-FX39 2026-09-11 缺省转正:
  //  inventoryLayout 缺省=vanilla,classic 旧自创布局退居 ?invlayout=legacy 回退旗) =================
  // 权威 = Terarria1457/Terraria/Main.cs DrawInventory 族(几何逐行锚,数值单源
  // vanillaInvLayout.ts;与 docs/inventory-crafting-research-1456.md §四 交叉验证一致)。
  // 纪律:classic(buildInventoryPanel)冻结维护(仅回退旗面);本族全为新代码,共享区仅 4 处
  // flag 守卫(initInGame 分派/positionInvPanel 首行/refreshHotbar 开包早退/refreshAllNow 补绘)。
  // 坑①:网格含槽 0-9,与关包热键栏 [data-idx] 全局 querySelector 首匹配冲突——
  //   本族内一律走 vinvSlots 作用域引用,禁用 slotEl(0-9);DOM 序保证关包态全局查询
  //   首命中热键栏(.sw-vinv 在 buildHud 之后挂载)。
  // 坑②:独立类 .sw-vinv,不得复用 sw-panel/sw-inv/sw-invgrid/sw-eqdock(--slot:39px
  //   等 CSS 渗漏),作用域样式见 vinvStyleEnsure。
  // 登记债清偿状态(SW-FX39 时点):住房页槽位=刀3 ✓/Sort 钮=FX29 ✓/相机页签=FX10 债⑥ ✓/
  //   杂项页超级矿车开关=FX10 债⑩ ✓/热键锁=FX10 债⑪ ✓/buff 列=FX10 债④ ✓;
  //   自创面入口(道具搜索/天气/时间/玩家列表/旅程/研究/住房面板)停于暂停菜单停车坪
  //   (main.ts openInGamePause,inventoryLayout==='vanilla' 门控——缺省转正后即常态路径)。
  //   遗留债:配方搜索框/合成站文字行(SW 自创 QoL,原版 1457 CraftingUI.cs:161-318
  //   无此面;配方搜索待 FX30 modern 窗分期)——见 SW-FX39 差集审计报告。

  private vinvRoot: HTMLElement | null = null;
  /** 作用域槽引用 `${where}:${i}`(坑①:替代全局 slotEl) */
  private vinvSlots = new Map<string, HTMLElement>();
  private vinvPageEls: { equip: HTMLElement; misc: HTMLElement; housing: HTMLElement } | null = null;
  private vinvTabMisc: HTMLElement | null = null;
  private vinvTabHousing: HTMLElement | null = null;
  private vinvTabCamera: HTMLElement | null = null;
  /** 热键锁图标(SW-FX10 债⑪;Main.cs:43203 DrawHotbarLockIcon 的 DOM 化) */
  private vinvLockEl: HTMLElement | null = null;
  /** 杂项页 buff 列容器(SW-FX10 债④;Main.cs:42008-42046 EquipPage==2 尾段的 DOM 化。
   *  开包∧页2 时 buff 块 reflow 至此,否则回流 buffBar——原版双态同源 DrawBuffIcon) */
  private miscBuffCol: HTMLElement | null = null;
  /** EquipPage 状态(原版 Main.EquipPageSelected/-1 记忆语义;每帧重算见 vinvApplyPage) */
  private vinvPageSelected: 0 | 1 | 2 = 0;
  private vinvPageCurrent = -1;
  private vinvQuickBtn: HTMLButtonElement | null = null;
  private vinvSortBtn: HTMLButtonElement | null = null;
  private vinvBestiaryBtn: HTMLButtonElement | null = null;
  private vinvEmoteBtn: HTMLButtonElement | null = null;
  private vinvDefenseEl: HTMLElement | null = null;
  /** 布局期元素表:{el, pos()}——pos 返回 null=隐藏(追加槽未解锁/开箱态堆叠钮) */
  private vinvLayoutItems: Array<{ el: HTMLElement; pos: () => { x: number; y: number } | null }> = [];
  private vinvRowMap = new Map<string, number>();   // `equip:8`→可见行号(追加槽重编号;查不到=隐藏)
  private vinvLayoutCtx: { sw: number; sh: number; mH: number; num20: number; chestOpen: boolean; cosUiVisible: boolean; visibleRows: number; minimapOn: boolean; cartUnlocked: boolean } | null = null;   // cosUiVisible=★SW-RB13b ChestOrShopUIVisible(Main.cs:3035-3046)
  private vinvLayoutSig = '';
  private vinvSettingsPushed = false;   // ★BJ416:_settingsButtonIsPushedToSide 等价(RefreshSettingsButtonStatus :46282;顾问/防御盾行随它 -1,行号判据单源 settingsAnchorOf)
  private vinvResizeHandler: (() => void) | null = null;
  /** 当前已建布局(分派/重建判据;null=未建) */
  private _builtLayout: 'classic' | 'vanilla' | null = null;

  private buildInventoryFor(layout: 'classic' | 'vanilla'): void {
    // _builtLayout 统一在分派层登记(classic 构建器零改动红线,不在其内写)。
    // ★构建【后】再登记——vanilla 构建器首行的 teardown 会清它(红队 F2 重入卫生)
    if (layout === 'vanilla') this.buildVanillaInventoryPanel();
    else this.buildInventoryPanel();
    this._builtLayout = layout;
  }

  /** 作用域样式(坑②):.sw-vinv 前缀全隔离;槽底 = eqdock 同款 gradient+multiply
   *  纹理层(loadout 配装乘色在层内合成,免 ::before 加性发白),--slot-alpha 缺省 1
   *  (原版开包格不透明底) */
  private vinvStyleEnsure(): void {
    if (document.getElementById('sw-vinv-style')) return;
    const st = document.createElement('style');
    st.id = 'sw-vinv-style';
    st.textContent = `
.sw-vinv { font-family:"Fusion Pixel 12px","Microsoft YaHei",sans-serif; }
/* ★2026-09-09 用户实测(Windows):继承 body 栈(Segoe UI→YaHei 逐字回退) =
   指示器文字多字体度量混排/叠加感——显式声明与 .sw-panel 同款像素字体栈 */
.sw-vinv .sw-slot { position:absolute; width:52px; height:52px; background-image:none;
  isolation:isolate; transform-origin:top left; touch-action:none; }
.sw-vinv .sw-slot::after { content:''; position:absolute; inset:0; z-index:-1;
  background-image:linear-gradient(var(--slot-tint, rgb(220,220,220)), var(--slot-tint, rgb(220,220,220))),
    var(--slot-bgimg, url(sprites/vanilla/Inventory_Back.png));
  background-size:100% 100%, 100% 100%; background-blend-mode:multiply, normal;
  /* ★原版 ground truth(Main.cs:46460-46474):inventoryBack=Color(invAlpha) 且
     invAlpha 每拍 ±0.2 在 180↔240 循环脉冲(10s 周期)——槽底亮度+不透明度同脉。
     --invpulse=(invAlpha-180)/60 由 rAF 单点驱动(root 单写,全槽 calc 派生);
     --slot-alpha 显式置 1 的槽(经典列表格)退出脉冲 */
  opacity:var(--slot-alpha, calc(0.706 + var(--invpulse, 0) * 0.235)); }
/* ★BJ316 2026-09-23:脉冲改合成器驱动 CSS 动画（真机 trace 定谳
   Trace-20260923T222003.json:rAF 逐帧写 --invpulse → 全槽 ::after opacity calc
   派生 → 开包每帧 style recalc 0.97ms + 94 个 Paint 事件/帧 1.06ms + 142
   PaintImage/帧 0.25ms（关包态全部为 0）→ GPU 光栅争用又把 uploadRaw getError
   同步等待推到 4.0ms/帧 = 开包掉帧主链）。动画包络 = 原逐帧写同域:
   invAlpha 180↔240 @±0.2/tick·60Hz(12/s) → 半程 5s 线性三角波,opacity
   0.706↔0.941（原式 calc(0.706+var(--invpulse)×0.235) 值域）。will-change=
   合成层常驻;vinvRoot 关包 display:none → 零层零成本。相位面偏差备案:
   动画钟=墙钟域,开合周期/隐藏页间不续相（原=rAF 续相）——包络/速率/值域
   零差,呼吸相位无绝对语义。 */
@keyframes sw-vinv-pulse { from { opacity:0.706; } to { opacity:0.941; } }
.sw-vinv .sw-slot::after { animation:sw-vinv-pulse 5s linear 0s infinite alternate;
  will-change:opacity; }
/* 显式 --slot-alpha 的槽（经典列表格/mcraft/向导格等）退出脉冲——属性子串选择器
   与原「--slot-alpha 显式置值走定值支不进 calc 缺省」语义逐槽同域 */
.sw-vinv .sw-slot[style*="--slot-alpha"]::after { animation:none; will-change:auto; }
/* hover 全亮须 !important——CSS 级联序 author important > 运行中动画值,普通规则
   会被动画盖掉;!important 不摘动画（移开即恢复动画当帧值 = 原 unhover 回脉冲同观感）。
   ★BJ316-D1/BJ340（2026-09-25）收窄 :not([style*="--slot-alpha"])——裸 :hover 毯过捕
   豁免族,把 FX43 刻意压制的 mcraft 定 α 槽 hover 全亮复活（夹具
   scripts/_bj316-hover-cascade.mjs 实测 0.635→1 击穿 :7329-7330 压制;author
   important 级联序压过普通规则,更低层 mcraft hover 规则永远赢不回）。收窄后豁免槽
   hover 保持定 α,普通槽（动画域）hover 全亮不变 */
.sw-vinv .sw-slot:not([style*="--slot-alpha"]):hover::after { opacity:1 !important; }
/* ★清偿刀 H② GetDimSlotForMouseItem 持物变暗（ItemSlot.cs:2336 槽底 color2×fade）。
   vinv 槽底 α 由 BJ316 呼吸动画驱动——变暗经【专用关键帧】乘入两端值
   （0.706/0.941 × fade）,动画照常呼吸不冻结;选择器键=槽元 --sw-ifade
   （paintSlotChrome 仅装备族装配,inv/chest/mcraft 等语境无属性不命中=零影响）。
   hover 支同乘 fade（important 级联序同上,fade=1 时与上支逐值同域）。 */
@keyframes sw-vinv-pulse-dim { from { opacity:calc(0.706 * var(--sw-ifade, 1)); } to { opacity:calc(0.941 * var(--sw-ifade, 1)); } }
.sw-vinv .sw-slot[style*="--sw-ifade"]::after { animation-name:sw-vinv-pulse-dim; }
.sw-vinv .sw-slot[style*="--sw-ifade"]:hover::after { opacity:calc(1 * var(--sw-ifade, 1)) !important; }
.sw-vinv .sw-slot::before { background:transparent; mix-blend-mode:normal; }
/* ★FX43(2026-09-16)modern 合成窗(.sw-mcraft)槽视觉面 1:1——
   ①格/成品/材料槽层 α 定值(ItemSlot.cs ctx41/42/43 InventoryBack18 × (10,58,74)@162;
     :2341-2351 开包脉冲只挂 ctx0/1/2/32=现代格域外,--slot-alpha 内联已供定值,此处
     兜底缺省;hover 不改槽底 α(vanilla 仅 tooltip),压掉基础 hover 全亮跳变)
   ②图标盒 1:1(ItemSlot.cs:2747-2751 position6 = position+52s/2−32s/2 = 盒内 (10,10)
     32px → inset 19.2%/61.5%;旧 15.4%/69.2%=36px 盒偏大 12.5%,双图营火实测 40 vs 34px)
   ③选中金框 .sw-mcsel(InventoryBack24 × White×0.7490196 :2355-2357;补偿后原色压 α)
   ④搜索占位色 = Color.Gray(UISearchBar.cs:74 !takingInput 臂) */
.sw-vinv .sw-mcraft .sw-slot::after { opacity: var(--slot-alpha, ${MCRAFT_SLOT_ALPHA}); }
.sw-vinv .sw-mcraft .sw-slot:hover::after { opacity: var(--slot-alpha, ${MCRAFT_SLOT_ALPHA}); }
.sw-vinv .sw-mcraft .sw-slot img { inset:19.2%; width:61.5%; height:61.5%; }
.sw-vinv .sw-mcraft .sw-mcsel { position:absolute; inset:0; pointer-events:none;
  background:url(${MCRAFT_SEL_TEX}) 0 0 / 100% 100%; opacity:${MCRAFT_SLOT_HL_ALPHA}; }
.sw-vinv .sw-mcraft input::placeholder { color:rgb(128,128,128); opacity:1; }
.sw-vinv .vinv-btn { position:absolute; pointer-events:auto; margin:0; padding:0;
  border:none; background-color:transparent; background-repeat:no-repeat;
  image-rendering:pixelated; cursor:pointer; }
.sw-vinv .vinv-txt { position:absolute; pointer-events:none; color:#e8e8f0;
  text-shadow:1px 1px 0 #000; white-space:nowrap; }
.sw-vinv .sw-slot-num { position:absolute; left:5px; top:2px; font-size:11px; font-weight:bold;
  color:#fff; text-shadow:1px 1px 0 #000; pointer-events:none; }
/* ★SW-FX32 商店货架格:InventoryBack 底框(含空格=售卖放置区)同箱条 chrome;
   买不起调暗=经典面同款呈现(原版无调暗,呈现偏差备案) */
.sw-vinv .sw-vshop-cell { transform:scale(0.755); }
.sw-vinv .sw-vshop-cell.is-poor { opacity:0.45; }
/* ★2026-09-14 用户实报:vinv 垃圾桶图标不居中——52px 盒吃 classic 44px 盒的
   图标几何(left/top 8.5/27px=已烘 0.85 的经典盒)→ 盒心偏 4px 偏左上+图标小 15%。
   原版盒坐标恒定(ItemSlot.cs:2747-2751 position6 = position + 52s/2 − 32s/2
   = 盒内 (10,10) 32px;s=0.85/0.755 经盒 transform 缩放,盒坐标不变):
   开箱/商店 0.755 变体同一规则自动覆盖 */
.sw-vinv .sw-trash .sw-trash-icon { left:10px; top:10px; width:32px; height:32px; }
`;
    document.head.appendChild(st);
  }

  private vinvMakeSlot(where: SlotWhere, i: number, scale: number): HTMLElement {
    const s = this.makeSlotEl(i, where);
    s.style.width = '52px';
    s.style.height = '52px';
    s.style.transform = `scale(${scale})`;
    this.vinvSlots.set(`${where}:${i}`, s);
    return s;
  }

  /** 原版布局构建器(几何逐函数锚 vanillaInvLayout.ts;行号注回 Main.cs)。
   *  ★2026-09-08 红队 F2 清偿:开头强制 teardown——closeAll 只清 DOM 不清实例态,
   *  重进世界路径(initInGame→本函数)不走 rebuild,布局/住房签名与 pvpTeamBtns/
   *  vinvLayoutItems 若不重置 = 全新 DOM 吃旧缓存(布局冻结+住房页空白+监听泄漏) */
  private buildVanillaInventoryPanel(): void {
    this.teardownInventoryPanel();
    this.vinvStyleEnsure();
    this.accEyeEls.clear();
    const root = el('div', 'sw-vinv');
    root.style.cssText = 'position:fixed; inset:0; pointer-events:none; display:none; z-index:11;';
    this.vinvRoot = root;
    this.invPanel = root;   // 开合链/panelOpen/resolveDrop 语义共用 invPanel 字段
    const F = (px: number): string => `${px}px`;
    const txt = (text: string): HTMLElement => { const d = el('div', 'vinv-txt', text); root.appendChild(d); return d; };
    const btn = (w: number, h: number): HTMLButtonElement => {
      const b = el('button', 'vinv-btn') as HTMLButtonElement;
      b.style.width = F(w); b.style.height = F(h);
      root.appendChild(b);
      return b;
    };
    const pos = (b: HTMLElement, p: () => { x: number; y: number } | null): void => {
      this.vinvLayoutItems.push({ el: b, pos: p });
    };

    // ---- 10×5 网格(槽 0-49,热键栏=第 0 行;Main.cs:41731-41750) ----
    for (let i = 0; i < 50; i++) {
      const s = this.vinvMakeSlot('inv', i, INV_SCALE);
      if (i < 10) s.appendChild(el('span', 'sw-slot-num', i === 9 ? '0' : String(i + 1)));
      root.appendChild(s);
      pos(s, () => gridSlotXY(i));
    }
    // 标题(Main.cs:41725 Lang.inter[4] "Inventory" @(40,0))
    const title = txt(Lang.inter(4));
    title.style.fontSize = '16px';
    pos(title, () => ({ x: TITLE_XY.x, y: TITLE_XY.y }));
    // 成就 Advisor(Main.cs:41758-41763 @(501,25))
    const advWrap = el('div');
    advWrap.style.cssText = 'position:absolute; pointer-events:auto;';
    // ★BJ501 用户明令分歧(2026-10-04):恒大卡档 0.75,不再随 sw<1000 切内联 0.35
    //   （原版=窄屏内联 Main.cs:42129 large:false+CanDrawAboveCoins 门 :41758;
    //   回滚口=恢复 BJ500② 的 scaleOf sw<1000 三元断点闭包——ADVISOR_SCALE_INLINE:
    //   ADVISOR_SCALE_LARGE 逐 update 重估,写法见 BJ500② 判语/git 历史）
    advWrap.appendChild(createAchievementAdvisor(() => this.game, () => ADVISOR_SCALE_LARGE));   // ★BJ318 动态解析
    this.achAdvisorEl = advWrap.firstChild as HTMLElement & { update(): void };
    root.appendChild(advWrap);
    // ★BJ501 用户明令分歧(2026-10-04):sw<1000 不再移装备列内联位——恒大卡位恒画
    //   （原版=窄屏内联 Main.cs:42096-42129 num38 行+HasSpace 门 :3019-3033;回滚口=
    //   恢复 BJ416 内联支:sw-ach-inline 类开关+页 0 门+hasSpaceForInlineAdvisor 门+
    //   advisorInlineXY 落位——几何单源仍留 vanillaInvLayout.ts 备查）
    //   ★2026-09-13 用户要求:成就卡顶对齐背包格顶(y=20;vanilla 25 = 5px 差,偏差备案)
    pos(advWrap, () => ({ x: ADVISOR_XY.x, y: 20 }));
    // ---- 钱币/弹药列(Main.cs:42460-42495:标签 (496,84)/(532,84),槽 x=497/534) ----
    const coinLbl = txt(Lang.text('LegacyInterface.26'));
    coinLbl.style.fontSize = '13px';
    pos(coinLbl, () => ({ x: COIN_LABEL_XY.x, y: COIN_LABEL_XY.y }));
    const ammoLbl = txt(Lang.text('LegacyInterface.27'));
    ammoLbl.style.fontSize = '13px';
    pos(ammoLbl, () => ({ x: AMMO_LABEL_XY.x, y: AMMO_LABEL_XY.y }));
    for (let k = 0; k < 4; k++) {
      const cs = this.vinvMakeSlot('inv', COIN_START + k, COIN_AMMO_SCALE);
      root.appendChild(cs);
      pos(cs, () => coinSlotXY(k));
      const as = this.vinvMakeSlot('inv', AMMO_START + k, COIN_AMMO_SCALE);
      root.appendChild(as);
      pos(as, () => ammoSlotXY(k));
    }
    // ---- 垃圾桶(Main.cs:43073-43090 (448,258) scale0.85;开箱/商店 (453,426)) ----
    root.appendChild(this.vinvBuildTrash());

    // ---- 2×2 快捷钮(Main.cs:42548-42613/43093-43193) ----
    // QuickStack:左键=按 quickStackMode 执行(原版右键循环 StackToChestsPreferredMode
    // 的本仓映射=右键循环 quick↔smart);开箱/商店不画(42548)
    {
      const b = btn(32, 30);
      this.vinvQuickBtn = b;
      // ★BJ328:paintQuick 走形参注入(闭包不捕 b;原 mouseleave 直挂 paintQuick=注册↔闭包↔b 环)
      const paintQuick = (host: HTMLElement): void => {
        const base = options.data.quickStackMode === 'smart' ? 2 : 0;
        host.style.backgroundImage = `url(sprites/vanilla-ui/UI_ChestStack_${base}.png)`;
        host.style.backgroundSize = '100% 100%';
      };
      paintQuick(b);
      b.addEventListener('mouseenter', (e) => {
        const base = options.data.quickStackMode === 'smart' ? 3 : 1;
        (e.currentTarget as HTMLElement).style.backgroundImage = `url(sprites/vanilla-ui/UI_ChestStack_${base}.png)`;
      });
      b.addEventListener('mouseleave', (e) => paintQuick(e.currentTarget as HTMLElement));
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        this.game.quickStackAllChests(options.data.quickStackMode);
        this.game.sfx.play('menuTick', 1);            // SoundID 12(:41292)
        this.refreshAll();
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void options.set('quickStackMode', options.data.quickStackMode === 'quick' ? 'smart' : 'quick');
        paintQuick(e.currentTarget as HTMLElement);   // ★BJ328:形参注入(原 paintQuick() 闭包捕 b)
        this.game.sfx.play('menuTick', 1);
      });
      // ★BJ685b 用户明令分歧（2026-10-15）：craftMenuOpen=modern 窗可见 ∨ classic 网格
      //   → 堆叠钮恒显（即使 chestOpen——原版 ChestUI.cs:81 让位藏箱条时 Main.cs:42548
      //   chest==-1 门使堆叠 UI 整体不可达,用户实报 UX 断层,明令恒显;制作菜单关+
      //   箱开仍藏=原版平价,箱内三钮承接）。两态位均已在 layoutVanilla 签名内
      //   （modernOpen/PipsUseGrid/chestOpen 三位）→ 任一翻转必触发重排=pos 闭包重评。
      //   判例锚=smart-cursor-dark-visibility-user-divergence（用户分歧协议）。
      pos(b, () => quickStackXY(!!this.vinvLayoutCtx?.chestOpen, this.vinvModernCraftOpen || this.vinvPipsUseGrid));
    }
    // Sort(534,244):★SW-FX29 清偿(FX10 债③)——vanilla 点击=ItemSorting.SortInventory
    // (Main.cs:42602 左键释放→SortInventory()+PlaySound(12);悬停帧 :42588-42616 1:1;
    // 悬停文案 MouseTextNoOverride("GameUI.SortInventory") :42618-42620→title 代承载)
    // 排序主干=src/stats/ItemSorting.ts(52 层谓词+21 张 SortingPriority 集比较器+
    // 运行时层序推导+金标 tests/sw-fx29);vanilla Sort 钮仅 chest==-1 && npcShop==0
    // 绘制(:42586)——本仓 sortXY(chestOrShopOpen) 同门 1:1(开箱/商店均藏;★BJ704-G7
    // 件2 勘误:旧注「本仓开箱态也画=登记形差」为假陈述,sortXY 一直按门隐藏,点击功能同链)
    {
      const b = btn(30, 30);
      this.vinvSortBtn = b;
      this.vinvBindHoverTip(b, () =>
        Lang.has('GameUI.SortInventory') ? Lang.text('GameUI.SortInventory') : 'GameUI.SortInventory');
      b.style.backgroundImage = 'url(sprites/vanilla-ui/UI_Sort_0.png)';
      b.style.backgroundSize = '100% 100%';
      b.addEventListener('mouseenter', () => { b.style.backgroundImage = 'url(sprites/vanilla-ui/UI_Sort_1.png)'; });
      b.addEventListener('mouseleave', () => { b.style.backgroundImage = 'url(sprites/vanilla-ui/UI_Sort_0.png)'; });
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        this.game.sortInventory();                 // ★SW-FX29:ItemSorting.SortInventory
        this.game.sfx.play('menuTick', 1);         // SoundID 12(Main.cs:42603)
        this.refreshAll();
      });
      pos(b, () => sortXY(!!this.vinvLayoutCtx?.chestOpen));
    }
    // 图鉴(498,278)/表情(534,278):开箱态移 (503,446)/(539,446)(43103-43108)
    {
      const b = btn(30, 30);
      this.vinvBestiaryBtn = b;
      this.vinvBindHoverTip(b, () => Lang.text('Mods.SandboxWorld.Tabs.Bestiary'));
      b.style.backgroundImage = 'url(sprites/vanilla-ui/UI_Bestiary.png)';
      b.style.backgroundSize = '200% 100%';
      b.addEventListener('mouseenter', () => { b.style.backgroundPosition = '100% 0'; });
      b.addEventListener('mouseleave', () => { b.style.backgroundPosition = '0 0'; });
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); this.onBestiary?.(); });
      pos(b, () => bestiaryXY(!!this.vinvLayoutCtx?.cosUiVisible));   // ★SW-RB13b:ChestOrShopUIVisible(Main.cs:3035-3046)=chest/shop ∧ !PipsUseGrid——网格态回位(43103)
    }
    {
      const b = btn(30, 30);
      this.vinvEmoteBtn = b;
      this.vinvBindHoverTip(b, () => Lang.has('GameUI.Emote') ? Lang.text('GameUI.Emote') : 'GameUI.Emote');
      b.style.backgroundImage = 'url(sprites/vanilla-ui/UI_Emotes.png)';
      b.style.backgroundSize = '200% 100%';
      b.addEventListener('mouseenter', () => { b.style.backgroundPosition = '100% 0'; });
      b.addEventListener('mouseleave', () => { b.style.backgroundPosition = '0 0'; });
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); this.onEmoteMenu?.(); });
      pos(b, () => emoteXY(!!this.vinvLayoutCtx?.cosUiVisible));   // ★SW-RB13b:同上(43158 门=ChestOrShopUIVisible)
    }

    // ---- 三页容器(EquipPage 0/1/2;页签见下;页切换=display,坐标全绝对) ----
    const pageOf = (): HTMLElement => {
      const p = el('div');
      p.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
      root.appendChild(p);
      return p;
    };
    const pageEquip = pageOf();
    const pageHousing = pageOf();   // 槽位刀 3(DrawNPCHousesInUI)
    const pageMisc = pageOf();
    this.vinvPageEls = { equip: pageEquip, misc: pageMisc, housing: pageHousing };
    const pagePos = (b: HTMLElement, p: () => { x: number; y: number } | null): void => {
      this.vinvLayoutItems.push({ el: b, pos: p });
    };

    // ---- 装备页(EquipPage==0 Main.cs:42085-42236):染料|时装|装备 三列+勾选框列 ----
    const buildEquipCol = (col: 'equip' | 'vanity' | 'dye', slots: number[], xOf: (sw: number) => number, scale: number): void => {
      for (const slot of slots) {
        const where: SlotWhere = col === 'dye' ? 'dye' : 'armor';
        const s = this.vinvMakeSlot(where, slot, scale);
        pageEquip.appendChild(s);
        pagePos(s, () => {
          const row = this.vinvRowMap.get(`${col}:${slot}`);
          if (row === undefined) return null;   // 追加槽未显示=不占行号(:42092-42113)
          return { x: xOf(this.vinvLayoutCtx!.sw), y: equipRowY(this.vinvLayoutCtx!.num20, row) };
        });
      }
    };
    buildEquipCol('equip', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], EQUIP_COL_X, INV_SCALE);
    buildEquipCol('vanity', [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], VANITY_COL_X, INV_SCALE);
    buildEquipCol('dye', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], DYE_COL_X, INV_SCALE);
    // 可见性勾选框(Main.cs:42118-42155:x=sw-58,仅功能段行>2;独格非槽角——原版同)
    for (let slot = 3; slot <= 9; slot++) {
      const eye = el('button', 'vinv-btn') as HTMLButtonElement;
      eye.style.width = '16px'; eye.style.height = '12px';
      eye.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (this.heldStack) return;   // mouseItem.IsAir 门(:40859)
        const p = this.game?.player;
        if (!p) return;
        p.hideVisibleAccessory[slot] = !p.hideVisibleAccessory[slot];
        this.game!.sfx.play('menuTick');
        this.paintAccEyes();
        this.showBuffTooltip((e.currentTarget as HTMLElement), (e.currentTarget as HTMLElement).dataset.swTipText ?? '', '');   // ★反馈轮6:点击即刷新(mousedown 必在悬停态)
      });
      this.accEyeEls.set(slot, eye);   // 复用 paintAccEyes 共享重刷(:1405)
      this.paintAccEye(eye, slot);
      pageEquip.appendChild(eye);
      pagePos(eye, () => {
        const row = this.vinvRowMap.get(`equip:${slot}`);
        if (row === undefined) return null;
        return { x: ACCESSORY_CHECK_X(this.vinvLayoutCtx!.sw), y: accessoryCheckY(this.vinvLayoutCtx!.num20, row) };
      });
    }
    // 配装钮(DrawLoadoutButtons Main.cs:42651-42707)——★FX29 定谳:原版只画 3 颗钮,
    // 42667 的 4px rectangle(sw-44)仅作钮定位锚【不渲染】:全方法无 Draw(rectangle),
    // 42668 GetLoadoutColor(CurrentLoadoutIndex) 返回值被弃(ItemSlot.cs:2832 纯函数),
    // Extra_259=114×102=9 帧 38×34 无轨美术。2026-09-15 用户实报右缘竖线=本仓虚元素,摘除。
    {
      this.loadoutBtns = [];
      for (let k = 0; k < 3; k++) {
        const b = el('button', 'vinv-btn sw-loadout-btn') as HTMLButtonElement;
        b.style.width = '32px'; b.style.height = '32px';
        b.style.backgroundImage = 'url(sprites/vanilla/Extra_259.png)';
        b.style.backgroundSize = '300% 300%';
        b.style.backgroundPosition = `0% ${k * 50}%`;
        b.addEventListener('mouseenter', (e) => {
          if (this.game.player.inv.currentLoadout !== k) (e.currentTarget as HTMLElement).style.backgroundPosition = `100% ${k * 50}%`;
        });
        b.addEventListener('mouseleave', (e) => {
          if (this.game.player.inv.currentLoadout !== k) (e.currentTarget as HTMLElement).style.backgroundPosition = `0% ${k * 50}%`;
        });
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (this.game.player.inv.currentLoadout === k) return;
          this.game.player.inv.trySwitchingLoadout(k, this.game.player.hideVisibleAccessory);
          this.game.sfx.play('menuTick', 1);
          this.flashLoadoutSwitch();
          this.refreshAll();
        });
        pageEquip.appendChild(b);
        this.loadoutBtns.push(b);
        pagePos(b, () => loadoutBtnXY(this.vinvLayoutCtx!.sw, this.vinvLayoutCtx!.num20, k));
      }
    }
    // 防御计数(DrawDefenseCounter Main.cs:42824-42899:中心 (sw-210, 末行 y+26))
    {
      const defRow = el('div');
      defRow.dataset.role = 'defense';
      defRow.style.cssText = 'position:absolute; width:40px; height:36px; pointer-events:auto; cursor:help;';
      const defWrap = el('div');
      defWrap.style.cssText = 'position:relative; width:40px; height:36px;';
      const defShield = el('img');
      defShield.alt = '';
      defShield.style.cssText = 'position:absolute; inset:0; margin:auto; width:39px; height:36px; image-rendering:pixelated;';
      defWrap.appendChild(defShield);
      const defNum = el('span', '', '0');
      defNum.style.cssText = 'position:absolute; inset:0; display:flex; align-items:center; justify-content:center;'
        + 'padding-top:2px; font-size:13px; font-weight:bold; color:#fff; text-shadow:1px 1px 0 #000;';
      defWrap.appendChild(defNum);
      defRow.appendChild(defWrap);
      defRow.addEventListener('mouseenter', (e) => {
        if (!this.game) return;
        const p = this.game.player;
        const st = p.defense;
        const w = this.game.world;
        const mul = w.isMaster ? 1.0 : w.isExpert ? 0.75 : 0.5;   // :42831-42840 难度换算
        const reduce = Math.ceil(st * mul);
        const dl = mainDifficulty(w);
        const tipLines = [`${st} ${Lang.text('LegacyInterface.10')}`, Lang.text('UI.DefenseDamageReduction', reduce)];
        if (dl >= GDL.LEGENDARY) tipLines.push(Lang.text('UI.Legendary'));
        else if (dl >= GDL.MASTER) tipLines.push(Lang.text('UI.Master'));
        else if (dl >= GDL.EXPERT) tipLines.push(Lang.text('UI.Expert'));
        this.showBuffTooltip((e.currentTarget as HTMLElement), tipLines[0], tipLines.slice(1).join('\n'));
      });
      defRow.addEventListener('mouseleave', () => this.hideBuffTooltip());
      pageEquip.appendChild(defRow);
      this.vinvDefenseEl = defRow;
      pagePos(defRow, () => {
        const c = this.vinvLayoutCtx!;
        // ★BJ416:行=Main.cs:42132-42135 num37(末行;设置钮挤碰侧移再 -1:42094-42097)
        //   ——旧刀恒钉 last(挤碰态低 1 行,与设置钮同带挤簇)
        const ctr = defenseCenterXY(c.sw, c.num20, defenseRowOf(c.visibleRows, this.vinvSettingsPushed));
        return { x: ctr.x - 20, y: ctr.y - 18 };   // 40×36 盒左上=中心-(20,18)
      });
    }
    // 页签(DrawPageIcons Main.cs:43511-43593:y=num20-32;杂项/住房=页切换,相机=债)
    const mkTab = (w: number, h: number, imgNormal: string, title: string): HTMLButtonElement => {
      const b = btn(Math.round(w * 0.9), Math.round(h * 0.9));   // ★红队 n2:原版 0.9f 绘制(:43523/:43534/:43545)
      this.vinvBindHoverTip(b, () => title);
      b.style.backgroundImage = `url(sprites/vanilla-ui/${imgNormal})`;
      b.style.backgroundSize = '100% 100%';
      return b;
    };
    this.vinvTabMisc = mkTab(TAB_MISC_SIZE.w, TAB_MISC_SIZE.h, 'UI_DisplaySlots_2.png',
      Lang.text('Mods.SandboxWorld.Tabs.Misc'));
    this.vinvTabMisc.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.vinvPageSelected = this.vinvPageSelected === 2 ? 0 : 2;   // 同页再点回 0(:43584)
      this.game.sfx.play('menuTick', 1);
      this.vinvPageCurrent = -1;
      this.vinvApplyPage();
    });
    this.vinvTabHousing = mkTab(TAB_HOUSING_SIZE.w, TAB_HOUSING_SIZE.h, 'UI_DisplaySlots_4.png',
      Lang.text('Mods.SandboxWorld.Housing.Button'));
    this.vinvTabHousing.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.vinvPageSelected = this.vinvPageSelected === 1 ? 0 : 1;
      this.game.sfx.play('menuTick', 1);
      this.vinvPageCurrent = -1;
      this.vinvApplyPage();
    });
    // 相机页签(Main.cs:43549-43595)——SW-FX10 债⑥清偿：点击开 M6 拍照模式
    //  （原版 CaptureManager.Instance.Active=true + blockMouse :43565-43568;游戏pad 臂
    //  =QuickScreenshot :43562-43564 本仓触屏同走开界面备案）。成功播放 PlaySound(10)
    //  =menuOpen（:43583 flag 门——CaptureModeDisabled 红图态本仓无,死亡/幽灵拒开
    //  由 toggleRequest 内置,拒开不响=同相）
    this.vinvTabCamera = mkTab(TAB_CAMERA_SIZE.w, TAB_CAMERA_SIZE.h, 'UI_DisplaySlots_8.png',
      Lang.inter(81));
    this.vinvTabCamera.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const cm = this.game?.renderer.captureMode;
      if (!cm || !this.game) return;
      const was = cm.active;
      cm.toggleRequest(this.game.player, this.game.world);
      if (!was && cm.active) this.game.sfx.play('menuOpen', 1);
    });
    pos(this.vinvTabMisc, () => ({ x: TAB_MISC_X(this.vinvLayoutCtx!.sw), y: TAB_Y(this.vinvLayoutCtx!.num20) }));
    pos(this.vinvTabHousing, () => ({ x: TAB_HOUSING_X(this.vinvLayoutCtx!.sw), y: TAB_Y(this.vinvLayoutCtx!.num20) }));
    pos(this.vinvTabCamera, () => ({ x: TAB_CAMERA_X(this.vinvLayoutCtx!.sw), y: TAB_Y(this.vinvLayoutCtx!.num20) }));

    // ---- 热键锁(Main.cs:43203-43237 DrawHotbarLockIcon;仅开包态画)——SW-FX10 债⑪清偿:
    //  位置 (0,21),pushSideToolsUp(builderAcc 可见图标≥10=恶魔心+大师槽齐显)→(0,0)
    //  (:43205-43208);贴图 Lock_{锁0/未锁1} 50×22 双帧横排取单帧 25×22,缩放 0.9(:43212/
    //  :43234);点击 PlaySound(22)=unlock + hbLocked 翻转(:43230-43231);悬停名 inter[5]
    //  未锁/inter[6] 已锁(:43220-43223);悬停描 OurFavoriteColor 第二帧(:43232-43234,
    //  本仓近似=帧1 叠加 screen 混合)。锁定消费面=关包快捷栏点击门(:44353/:44357,
    //  paintHotbarLockState/mouseup 臂) + 1-0 数字键照常 ----
    {
      const lock = el('button', 'vinv-btn') as HTMLButtonElement;
      const paintLock = (): void => {
        const locked = !!this.game?.player.hbLocked;
        lock.style.backgroundImage = `url(sprites/vanilla/Lock_${locked ? 0 : 1}.png)`;
        // 悬停金描帧=当前态贴图帧1(原版 value.Frame(2,1,1)+OurFavoriteColor :43232-43234)
        glow.style.backgroundImage = `url(sprites/vanilla/Lock_${locked ? 0 : 1}.png)`;
      };
      // ★2026-09-13 反馈轮6:hover 名走自有气泡(原版 MouseText Main.cs:43232 域)
      this.vinvBindHoverTip(lock, () => Lang.inter(this.game?.player.hbLocked ? 6 : 5));
      lock.style.cssText = 'position:absolute; width:25px; height:22px; background-size:200% 100%;'
        + 'background-position:0 0; image-rendering:pixelated; cursor:pointer; padding:0; border:none;';
      const glow = el('div', '', '');
      glow.style.cssText = 'position:absolute; inset:0; background-size:200% 100%;'
        + 'background-position:100% 0; image-rendering:pixelated; mix-blend-mode:screen;'
        + 'opacity:0.85; pointer-events:none; display:none;';
      glow.style.backgroundImage = 'url(sprites/vanilla/Lock_1.png)';
      lock.appendChild(glow);
      lock.addEventListener('mouseenter', () => { glow.style.display = 'block'; });
      lock.addEventListener('mouseleave', () => { glow.style.display = 'none'; });
      lock.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (e.button !== 0 || !this.game) return;
        this.game.player.hbLocked = !this.game.player.hbLocked;   // :43231
        this.game.sfx.play('unlock', 1);                          // PlaySound(22) :43230
        paintLock();
        this.paintHotbarLockState();
      });
      this.vinvLockEl = lock;
      paintLock();
      root.appendChild(lock);
      this.vinvLayoutItems.push({
        el: lock,
        // ★SW-RB11e 2026-09-10 勘误：pushSideToolsUp 与 FX19 图标列同源 = GetBuilderAccsCountToShow
        //  的 totalDrawnIcons（Main.cs:41752-41753 同一变量喂 :41755/:43247/:43289/:48166）——
        //  InfoAccMechShowWires×6+rulerLine+rulerGrid+autoActuator+autoPaint+1+unlockedBiomeTorches
        //  （:48381-48386,门=配饰装备态 plr.rulerLine 等 Player.cs:12899-12915）。原刀误写
        //  visibleRows>=10（装备列行数,另一量纲）：恶魔心+大师档 false-push 锁钮上移,
        //  而原版 push 场景（info 件+拨杆≥10）锁钮不上移 → 与方块替换图标 @(0,23) 重叠。
        pos: () => {
          // ★SW-FX36：判定域改背包∪装备扫描（同 vinvBuildBuilderAccToggles gatesOf）
          const g = this.game
            ? builderAccGateSet((vid) => playerVidCarried(
              this.game!.player.inv.slots, this.game!.player.inv.armor,
              (k) => this.game!.player.inv.isItemSlotUnlockedAndUsable(k), vid))
            : null;
          return hotbarLockXY(!!g && builderAccTotalIcons(
            g, !!this.game?.world.flags.unlockedBiomeTorches) >= 10);
        },
      });
    }

    // ---- 杂项页(EquipPage==2 Main.cs:41886-41932:两列 5 行,行距整型 47) ----
    // miscEquips 序 = 宠物/光源/矿车/坐骑/钩爪(context 19/20/18/17/16;:41905-41931)。
    // ★红队 n1 清偿:原版杂项页无任何 DrawString(:41886-41932 零 DrawString)——
    // 文字标签已摘(2026-09-08)
    for (let m = 0; m < 5; m++) {
      const s = this.vinvMakeSlot('misc', m, INV_SCALE);
      pageMisc.appendChild(s);
      pagePos(s, () => ({ x: MISC_COL_EQUIP_X(this.vinvLayoutCtx!.sw), y: miscRowY(this.vinvLayoutCtx!.num20, m) }));
      const d = this.vinvMakeSlot('miscDye', m, INV_SCALE);
      pageMisc.appendChild(d);
      pagePos(d, () => ({ x: MISC_COL_DYE_X(this.vinvLayoutCtx!.sw), y: miscRowY(this.vinvLayoutCtx!.num20, m) }));
      // 宠物/光源开关勾选框(Main.cs:41934-41935 @(槽左+34,顶-2);TogglePet/Light :40666-40691)
      if (m === 0 || m === 1) {
        const eye = el('button', 'vinv-btn') as HTMLButtonElement;
        eye.style.width = '16px'; eye.style.height = '12px';
        eye.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (this.heldStack) return;
          this.game.togglePetSlot(m as 0 | 1);
          this.paintPetEye((e.currentTarget as HTMLElement), m as 0 | 1);
          this.showBuffTooltip((e.currentTarget as HTMLElement), (e.currentTarget as HTMLElement).dataset.swTipText ?? '', '');   // ★反馈轮6:点击即刷新
        });
        this.paintPetEye(eye, m as 0 | 1);
        pageMisc.appendChild(eye);
        pagePos(eye, () => miscCheckXY({ x: MISC_COL_EQUIP_X(this.vinvLayoutCtx!.sw), y: miscRowY(this.vinvLayoutCtx!.num20, m) }));
      }
      // 矿车升级开关(Main.cs:41963-41995:m==2 矿车槽;unlockedSuperCart 才画=flag2 门
      // :41959/:41963)——SW-FX10 债⑩UI 面：Extra_255 开/Extra_256 关 18×18 全白
      // (宠物勾选框是 White*0.7,矿车框是全白 :41998),点击翻转 enabledSuperCart +
      // PlaySound(12) + 单人即改玩家面(原版 NetMessage 4 同步位=联机面备案),悬停名
      // GameUI.SuperCart{Enabled,Disabled}(:41987-41992 num26 语义)
      if (m === 2) {
        const cart = el('button', 'vinv-btn') as HTMLButtonElement;
        cart.style.width = '18px'; cart.style.height = '18px';
        cart.style.backgroundSize = '100% 100%';
        cart.style.imageRendering = 'pixelated';
        const paintCart = (): void => {
          const on = !!this.game?.player.enabledSuperCart;
          cart.style.backgroundImage = `url(sprites/vanilla/Extra_${on ? 255 : 256}.png)`;
        };
        // ★2026-09-13 反馈轮6:hover 名走自有气泡(:41987-41992 MouseText 域)
        this.vinvBindHoverTip(cart, () =>
          Lang.text(this.game?.player.enabledSuperCart ? 'GameUI.SuperCartEnabled' : 'GameUI.SuperCartDisabled'));
        cart.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (this.heldStack || !this.game) return;          // mouseItem.IsAir 门(:41968)
          this.game.player.enabledSuperCart = !this.game.player.enabledSuperCart;
          this.game.sfx.play('menuTick', 1);
          paintCart();
        });
        paintCart();
        pageMisc.appendChild(cart);
        pagePos(cart, () => {
          if (!this.vinvLayoutCtx?.cartUnlocked) return null;   // 未解锁不画(:41963)
          return miscCheckXY({ x: MISC_COL_EQUIP_X(this.vinvLayoutCtx.sw), y: miscRowY(this.vinvLayoutCtx.num20, m) });
        });
      }
    }

    // ---- 杂项页 buff 列(Main.cs:42008-42046 EquipPage==2 尾段)——SW-FX10 债④清偿：
    //  开包∧页2 时 buff 块 reflow 入此容器(reflowBuffs),块本体/悬停气泡/右键取消
    //  复用 makeBuffBlock 面（原版两态同源 DrawBuffIcon :44043）。首列 x=sw-84
    //  (num23=sw-92+8)、y=num20+247(num24+=247);块绝对定位:列向左/行向下步距 46,
    //  每列行数随屏高(:42014-42024 miscBuffRowsPerCol)。maxBuffs=22 上限由 BuffState 面
    //  对齐(本仓同 22,超出槽不显示=原版同) ----
    {
      const col = el('div');
      col.style.cssText = 'position:absolute; pointer-events:auto; width:0; height:0;';
      pageMisc.appendChild(col);
      pagePos(col, () => {
        const c = this.vinvLayoutCtx;
        if (!c) return null;
        return { x: MISC_BUFF_X(c.sw), y: c.num20 + MISC_BUFF_Y_OFF };
      });
      this.miscBuffCol = col;
    }

    // ---- 现代合成面板 → 经典竖列表(用户实测二轮退役 Modern 面板) ----
    this.vinvBuildCraft();
    // ---- 设置文字钮(DrawInterface_29_SettingsButton Main.cs:46286-46301:
    //  (sw-110, sh-20) 文本 Lang.inter[62] 悬停放大;与装备列底碰撞 → 左推 140 并
    //  贴列底上方(:46266-46282);点击=开/关设置浮层) ----
    const settingsBtn = el('button', 'vinv-txt') as HTMLButtonElement;
    settingsBtn.textContent = Lang.inter(62);
    settingsBtn.style.cssText = 'font-size:18px; pointer-events:auto; cursor:pointer;'
      + 'background:none; border:none; padding:0; color:#fff; text-shadow:1px 1px 0 #000;'
      + 'transition:transform 80ms linear;'
      // ★反馈轮8:中心锚由 translate(-50%,-50%) 承载——(sw-110,sh-20)=文本中心
      //  (Main.cs:46344 origin=Size/2)。不用 pos 内 offsetWidth:build 期 root 尚
      //  display:none(关包构建)→ 度量为 0,中心退化回左上
      + 'transform:translate(-50%,-50%);';
    settingsBtn.addEventListener('mouseenter', () => { settingsBtn.style.transform = 'translate(-50%,-50%) scale(1.15)'; });
    settingsBtn.addEventListener('mouseleave', () => { settingsBtn.style.transform = 'translate(-50%,-50%)'; });
    settingsBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.onPauseMenu?.();   // 开/关设置浮层(★SW-RB8c 勘误:Open 收背包 :70/Close 回背包 :108,两态互斥)
    });
    this.vinvRoot?.appendChild(settingsBtn);
    this.vinvLayoutItems.push({ el: settingsBtn, pos: () => {
      const c = this.vinvLayoutCtx;
      if (!c) return null;
      // ★反馈轮8:(sw-110, sh-20) 是文本【中心】(Main.cs:46344 origin=Size/2)——
      //   居中由元素 translate(-50%,-50%) 承载,pos 只写中心点
      // ★BJ416:挤碰判据/锚值改 settingsAnchorOf 单源(RefreshSettingsButtonStatus
      //   :46254-46285)。旧 colBottom=equipRowY(num20,last)+44.2 系近似且吃了 num20
      //   矮屏压缩(:41858)——vanilla num3=:46269 自算 174+mH 不压缩,含恶魔心/大师
      //   槽的矮屏两域差 47.6/格
      const a = settingsAnchorOf(c.sw, c.sh, c.mH, c.visibleRows);
      return { x: a.x, y: a.y };
    } });

    // ---- 建筑配件图标列（★SW-FX19 债：DrawBuilderAccToggles Main.cs:48142-48377）----
    this.vinvBuildBuilderAccToggles();

    // ---- 宝箱条(直接叠背包下方;显示随 openChest) ----
    this.vinvBuildChest();
    // ---- 商店货架(SW-FX32 刀①店侧分期二;Main.cs:42500-42532;显示随 npcShopOpen) ----
    this.vinvBuildShop();
    // ---- 重铸原位(Main.cs:42268-42393;显示随 vinvReforgeOpen+自动退出条件) ----
    this.vinvBuildReforge();

    // ---- 住房页(EquipPage==1 DrawNPCHousesInUI Main.cs:42709-42822) ----
    // 查询器 0 号位(NPC_Head_0)+ 在场 NPC 头像槽列;x=sw-92,超 sh-80 换列 -48;
    // 槽底 Back11(选中 Back14),头像 ≤36px 居中;点击接 game.housingMode 游标
    // (Game.ts:11392 世界点击分配链零改动复用)。行集=刀3 共享 housingHeadRows
    pageHousing.dataset.role = 'vinv-housing';
    this.vinvHousingPage = pageHousing;

    // ---- PvP/队伍(DrawPVPIcons Main.cs:43389-43443;本仓常开语义沿用 classic) ----
    {
      const sword = el('button', 'vinv-btn sw-btn') as HTMLButtonElement;
      // ★BJ417 1457 帧制(38×38 @200%×700%;Frame(2,7) 整帧无裁,悬停覆盖层同 classic
      // 构建区;refreshPvpButtons 帧算依赖)
      sword.style.width = '38px'; sword.style.height = '38px';
      sword.style.backgroundImage = 'url(sprites/vanilla-ui/UI_PVP_0.png)';
      sword.style.backgroundSize = '200% 700%';
      sword.style.backgroundRepeat = 'no-repeat';
      sword.style.position = 'relative';
      {
        const hov = el('div');
        hov.dataset.pvpHover = '1';
        hov.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; display:none;'
          + 'background:url(sprites/vanilla-ui/UI_PVP_0.png); background-size:200% 700%;'
          + 'background-repeat:no-repeat; image-rendering:pixelated; pointer-events:none;';
        sword.appendChild(hov);
      }
      sword.addEventListener('mouseenter', () => this.refreshPvpButtons());
      sword.addEventListener('mouseleave', () => this.refreshPvpButtons());
      sword.addEventListener('mousedown', (e) => { e.stopPropagation(); this.pvpToggleHostile(); });
      root.appendChild(sword);
      this.pvpSwordBtn = sword;
      // ★红队 n4:住房页 NPC 列达第 4 列(num3≤-144)时原版隐藏 PvP/队伍(:42761-42763)
      const housingPvpHidden = (): boolean => {
        if (this.vinvPageCurrent !== 1 || !this.vinvLayoutCtx) return false;
        const c = this.vinvLayoutCtx;
        const posA = housingSlotPositions(this.vinvHousingSlotEls.length, c.sw, c.num20, c.sh);
        return new Set(posA.map((p) => p.x)).size >= 4;
      };
      pos(sword, () => {
        const c = this.vinvLayoutCtx!;
        if (housingPvpHidden()) return null;
        const p = pvpSwordXY(c.sw, c.mH, this.vinvPageCurrent === 2);
        return { x: p.x, y: p.y };
      });
      sword.addEventListener('mouseleave', () => this.hideBuffTooltip());   // ★反馈轮6:气泡隐藏面
      for (let i = 0; i < 6; i++) {
        const cell = el('button', 'vinv-btn sw-btn') as HTMLButtonElement;
        cell.style.width = '20px'; cell.style.height = '20px';
        const icon = el('div');
        // data-pvp-team-icon = refreshPvpButtons 基帧调光消费柄（★S4 :43506 White*num4）
        icon.dataset.pvpTeamIcon = '1';
        icon.style.cssText = 'position:absolute; left:2px; top:1px; width:16px; height:18px;'
          + `background:url(sprites/vanilla-ui/UI_PVP_1.png); background-size:600% 100%;`
          + `background-position:${PVP_TEAM_BUTTONS[i].team * 20}% 0%; image-rendering:pixelated; pointer-events:none;`;
        cell.style.position = 'absolute';
        cell.appendChild(icon);
        cell.addEventListener('mouseenter', () => this.refreshPvpButtons());
        cell.addEventListener('mouseleave', () => { this.refreshPvpButtons(); this.hideBuffTooltip(); });   // ★反馈轮6
        cell.addEventListener('mousedown', (e) => { e.stopPropagation(); this.pvpSetTeam(PVP_TEAM_BUTTONS[i].team); });
        root.appendChild(cell);
        this.pvpTeamBtns.push(cell);
        pos(cell, () => {
          const c = this.vinvLayoutCtx!;
          if (housingPvpHidden()) return null;
          return pvpTeamXY(c.sw, c.mH, i, this.vinvPageCurrent === 2);
        });
      }
    }

    // ★挂载序:在 hotbarEl 之后(buildHud 已跑)——关包态全局 slotEl(0-9) 首匹配=热键栏
    this.root.appendChild(root);
    this.vinvResizeHandler = () => { this.vinvLayoutSig = ''; this.layoutVanilla(); };
    window.addEventListener('resize', this.vinvResizeHandler);
    this.layoutVanilla();
  }

  /** 垃圾桶槽(Main.cs:43073-43090)。行为=classic 同面(Alt+聊天 tag/Shift 回包/
   *  放置/取回),复制自 buildInventoryPanel 段(classic 区零改动红线)。
   *  ★红队 m3 清偿:盒 52px × scale(0.85)=视觉 44.2(旧 44 盒×0.85=37.4 双重缩放) */
  private vinvBuildTrash(): HTMLElement {
    const trash = el('div', 'sw-slot trash sw-trash');
    trash.style.cssText = 'width:52px; height:52px; pointer-events:auto;'
      + 'background-image:url(sprites/vanilla/Inventory_Back7.png);';
    trash.addEventListener('contextmenu', (e) => e.preventDefault());
    trash.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (!e.button && e.altKey && this.game.chatInput?.isOpen && this.game.player.inv.trash) {
        this.game.insertChatItemTag(vidOf(this.game.player.inv.trash.id));
        this.game.sfx.play('menuTick', 1);
        return;
      }
      if (!e.button && e.shiftKey && !e.altKey && !e.ctrlKey && this.game.player.inv.trash) {
        const t = this.game.player.inv.trash;
        const left = this.game.player.inv.add(t.id, t.stack, t.prefix, (t as { placeStyle?: number }).placeStyle);
        if (left < t.stack) {
          this.game.player.inv.trash = left > 0 ? { ...t, stack: left } : null;
          this.game.sfx.play(coinIndexOf(t.id) >= 0 ? 'coin' : 'pickup', 1);
          this.game.sfx.play('menuTick', 1);
          this.paintTrash();
          this.refreshAll();
          return;
        }
      }
      if (this.heldStack) {
        this.placeTrash();
      } else if (this.game.player.inv.trash) {
        this.heldStack = this.game.player.inv.trash;
        this.game.player.inv.trash = null;
        this.game.sfx.play('pickup', 1);
        this.paintTrash();
      }
      this.refreshAll();
    });
    this.trashEl = trash;
    this.vinvLayoutItems.push({
      el: trash,
      pos: () => {
        const t = trashXY(!!this.vinvLayoutCtx?.cosUiVisible);   // ★SW-RB13b:43078 门=ChestOrShopUIVisible(网格态回位 448,258/0.85)
        return { x: t.x, y: t.y };
      },
    });
    // scale 换档(0.85/0.755)在 layoutVanilla 尾统一处理
    this.vinvTrashEl = trash;
    return trash;
  }

  private vinvTrashEl: HTMLElement | null = null;

  /** 布局重排(签名变化才写 style;每帧调用无害)。签名=视口|追加槽显隐|开箱态 */
  private layoutVanilla(): void {
    const root = this.vinvRoot;
    if (!root || !this.game) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const K = vanillaScaleFor(vw, vh, options.data.uiScale);
    const sw = vw / K, sh = vh / K;
    const inv = this.game.player.inv;
    // ★清偿刀 P 单源（Inventory.extraSlotShown :4259-4281——解锁∨功能格∨社交
    // 孪生 18/19∨染料格;旧 inline 版漏社交孪生臂）
    const shownX = inv.extraSlotShown();
    const heartShown = shownX.heart;
    const masterShown = shownX.master;
    const chestOpen = !!this.openChest || this.game.npcShopOpen;
    // ★SW-RB13b(2026-09-11):ChestOrShopUIVisible(Main.cs:3035-3046)=chest/shop 态
    //   ∧ !NewCraftingUI.Visible ∧ !PipsUseGrid——网格态回位垃圾桶/图鉴/表情
    //   (43078/43103/43158 门读该谓词,非 chestOpen 裸读);QuickStack/Sort 仍走
    //   chest==-1 && npcShop==0 裸门(:42548/42586)不折 PipsUseGrid。
    //   ★SW-FX41:首支再加 !NewCraftingUI.Visible(Main.cs:3037 窗可见恒 false)
    const cosUiVisible = chestOpen && !this.vinvPipsUseGrid && !this.vinvModernCraftOpen;
    const visibleRows = 8 + (heartShown ? 1 : 0) + (masterShown ? 1 : 0);
    // ★SW-FX10 债⑨清偿：mH 联动真实小地图态（Main.cs:46537-46561 DrawInterface_16_MapOr
    // Minimap：mapEnabled 关→mH=0 早退；全屏地图开/mapStyle≠1→mH=0；仅 mapStyle==1 且
    // 非全屏 → mH=256 再钳 sh-PushUp）。本仓 mapEnabled 无独立设置面（默认开）。
    // PushUp=610 当恶魔心/大师槽可显示(Main.cs:3063-3071;PushEquipmentAreaUp 设置
    // 本仓无,取 0=偏差备案);mH 可为负=原版同款
    const minimapOn = this.game.renderer.mapStyle === 1 && !this.game.mapFullscreen();
    const mH = mHOf(minimapOn, sh, heartShown || masterShown ? 610 : 600);
    const num20 = equipAreaTop(sh, mH, visibleRows);
    root.style.transformOrigin = 'top left';
    root.style.transform = `scale(${K})`;
    this.vinvLayoutCtx = { sw, sh, mH, num20, chestOpen, cosUiVisible, visibleRows, minimapOn, cartUnlocked: this.game.superCartUnlocked() };
    this.vinvSettingsPushed = settingsAnchorOf(sw, sh, mH, visibleRows).pushed;   // ★BJ416:pos 回调先于 settings 钮注册消费,须在 pos 循环前置算(原版 Main 字段=同帧全局,无序问题)
    this.vinvComputeRows(heartShown, masterShown);
    // 签名含 uiScale(★红队 MINOR-4:K 依赖 uiScale,漏签 = 改缩放右锚列不重排);
    // ★SW-FX10:再含 minimapOn(mH 变 → num20/页签/右锚列全体位移)与矿车解锁(开关框显隐)
    // ★SW-RB13b:再含 PipsUseGrid(网格态翻转 → 箱条吞门/变体回位 pos 闭包须重跑——
    //   签名不变则早退跳过整段 pos 循环,FX28 ChestUI.cs:81 门=死码,故必须入签)
    // ★SW-FX32:再含储蓄行可见旗(总储蓄>0 + 逐仓有币——储蓄行/四银行图标 pos 门
    //   的输入;银行间搬钱不翻 chestOpen 旗,不入签 = 图标滞留)
    const savBanks = this.game.coinSavingsByBank();
    // ★SW-FX36：建筑配件旗位门入签——原版 DrawBuilderAccToggles（Main.cs:48142-48377）
    //   每帧条件绘制,拾取/丢弃即时显隐;本仓布局签名缓存不含门输入 ⇒ 背包拾入 2799
    //   等后网格/喷漆/线材档滞留不显（FX36 探针实测）。门=背包∪装备旗位（UpdateEquips
    //   :12997-13004 面）;门变化=低频事件,入签触发一次整排代价可忽略。
    //   rulerLine 恒真（ResetEffects :18809）不入签。
    // ★SW-FX41:再含 modern 窗开态(窗开 → 切换钮/就近箱钮换锚 + 经典合成面隐藏 +
    //   ChestOrShopUIVisible 折叠,Main.cs:42418-42456/:3037)
    const bg = builderAccGateSet((vid) => playerVidCarried(inv.slots, inv.armor, (k) => inv.isItemSlotUnlockedAndUsable(k), vid));
    // ★反馈轮7:unlockedBiomeTorches 入签(:48166 start.Y+=24*torchGodIcons 列体位移
    //   + :48370 炬图标显隐)——旗翻(炬神事件结算)不入签则图标列滞留旧位与炬图标重叠
    const bgSig = `${bg.rulerGrid ? 1 : 0}${bg.autoActuator ? 1 : 0}${bg.autoPaint ? 1 : 0}${bg.infoAccMechShowWires ? 1 : 0}${this.game.world.flags.unlockedBiomeTorches ? 1 : 0}`;
    const sig = `${Math.round(vw)}x${Math.round(vh)}|${options.data.uiScale}|${heartShown ? 1 : 0}${masterShown ? 1 : 0}|${chestOpen ? 1 : 0}|${minimapOn ? 1 : 0}${this.game.superCartUnlocked() ? 1 : 0}|${this.vinvPipsUseGrid ? 1 : 0}|${savBanks[0] > 0 ? 1 : 0}${savBanks[1] > 0 ? 1 : 0}${savBanks[2] > 0 ? 1 : 0}${savBanks[3] > 0 ? 1 : 0}|${bgSig}|${this.vinvModernCraftOpen ? 1 : 0}|${this.vinvGuideMenuOpen ? 1 : 0}|${this.vinvReforgeOpen ? 1 : 0}`;   // ★刀19:重铸态入签(vinvReforgeVisible pos 门随拍重估)
    if (sig === this.vinvLayoutSig) return;
    this.vinvLayoutSig = sig;
    for (const it of this.vinvLayoutItems) {
      const p = it.pos();
      if (p) {
        it.el.style.display = '';
        it.el.style.left = `${p.x}px`;
        it.el.style.top = `${p.y}px`;
      } else {
        it.el.style.display = 'none';
      }
    }
    // 垃圾桶 scale 换档(Main.cs:43078-43083 开箱 0.755;★SW-RB13b 门=ChestOrShopUIVisible 含 !PipsUseGrid)
    if (this.vinvTrashEl) this.vinvTrashEl.style.transform = `scale(${trashXY(cosUiVisible).scale})`;
  }

  /** 装备列追加槽可见行号表(重编号;未显示不入表=隐藏不占行,:42092-42113) */
  private vinvComputeRows(heartShown: boolean, masterShown: boolean): void {
    this.vinvRowMap.clear();
    for (let s = 0; s < 8; s++) this.vinvRowMap.set(`equip:${s}`, s);
    for (let s = 10; s < 18; s++) this.vinvRowMap.set(`vanity:${s}`, s - 10);
    for (let s = 0; s < 8; s++) this.vinvRowMap.set(`dye:${s}`, s);
    if (heartShown) {
      this.vinvRowMap.set('equip:8', 8);
      this.vinvRowMap.set('vanity:18', 8);
      this.vinvRowMap.set('dye:8', 8);
    }
    if (masterShown) {
      const r = heartShown ? 9 : 8;
      this.vinvRowMap.set('equip:9', r);
      this.vinvRowMap.set('vanity:19', r);
      this.vinvRowMap.set('dye:9', r);
    }
  }

  /** vanilla 布局补绘(refreshAllNow 守卫调用):网格第 0 行+inv 族槽底覆写+页码 */
  private paintVanillaInvSlots(): void {
    if (!this.vinvRoot || !this.game) return;
    this.layoutVanilla();
    const inv = this.game.player.inv;
    const backOverride = 'url(sprites/vanilla/Inventory_Back.png)';
    // 原版开包格底 = Inventory_Back(paintSlotChrome 经典态写 Back20;收藏件 Back10 让行)
    const paintInvSlot = (idx: number): void => {
      const s = this.vinvSlots.get(`inv:${idx}`);
      if (!s) return;
      this.paintInvSlotPair(s, idx, inv.slots[idx]);   // ★开包 hitch diff 门(2026-09-29):不变零写
      const cur = s.style.getPropertyValue('--slot-bgimg');
      if (!cur.includes('Inventory_Back10') && cur !== backOverride) {
        s.style.setProperty('--slot-bgimg', backOverride);
      }
    };
    for (let i = 0; i < 50; i++) paintInvSlot(i);
    for (let k = 0; k < 4; k++) { paintInvSlot(COIN_START + k); paintInvSlot(AMMO_START + k); }
    this.vinvApplyPage();
    this.vinvRefreshHousing();
    this.vinvRefreshCraft();
    this.vinvUpdateChestName();
    this.vinvRefreshShop();   // ★SW-FX32:商店货架内容+头部回写(Main.cs:42500-42532)
    this.vinvUpdateReforge();
    this.paintVanillaDefense();
  }

  /** 住房页槽列同步(EquipPage==1;Diff 重建——行集仅在 NPC 进出变化时重建,
   *  选中态每刷改背景)。行为面 = HousingPanel.setCursor 同款(menuTick+游标) */
  private vinvHousingPage: HTMLElement | null = null;
  private vinvHousingSlotEls: Array<{ el: HTMLElement; img: HTMLImageElement; key: string }> = [];
  private vinvHousingSig = '-init';   // 哨兵:空世界(sig='')也要首建查询器槽
  private vinvRefreshHousing(): void {
    const page = this.vinvHousingPage;
    if (!page || !this.game) return;
    const rows = housingHeadRows(this.game);
    // ★红队 MINOR-6 清偿:携带 NPC 离场 → 降级查询器(HousingPanel.refresh 同语义,
    // :44649-44651)——否则 assign 游标持续吞世界点击
    const hm = this.game.housingMode;
    if (hm && hm.kind === 'assign' && !rows.some((r) => r.npcKey === hm.npcKey)) {
      // ★红队 MINOR-6 清偿:携带 NPC 离场 → 降级【查询器】(Main.cs:45965-45968
      // !active||type≠ → SetMouseNPC_ToHousingQuery;HousingPanel.refresh 同语义)
      // ——曾清成 null=比原版多退一档(查询态保留才是原版,:45918-45927 不清携带)
      this.game.housingMode = { kind: 'query' };
    }
    const sig = rows.map((r) => r.npcKey).join(',');
    if (sig !== this.vinvHousingSig) {
      this.vinvHousingSig = sig;
      // ★红队 MAJOR-3 清偿:重建前按元素身份滤除旧布局项(旧实现只 remove DOM——
      // vinvLayoutItems 无界增长+死节点每拍求 pos)
      const dead = new Set(this.vinvHousingSlotEls.map((s) => s.el));
      this.vinvLayoutItems = this.vinvLayoutItems.filter((it) => !dead.has(it.el));
      for (const s of this.vinvHousingSlotEls) s.el.remove();
      this.vinvHousingSlotEls = [];
      const mk = (key: string, headPath: string, name: string, onPick: () => void): void => {
        const b = el('button', 'vinv-btn') as HTMLButtonElement;
        b.style.width = '52px'; b.style.height = '52px';
        b.style.transform = 'scale(0.85)';   // ★红队 m4:原版槽 52×0.85=44.2(Main.cs:42787-42790)
        b.style.transformOrigin = 'top left';
        b.style.backgroundImage = 'url(sprites/vanilla/Inventory_Back11.png)';
        b.style.backgroundSize = '100% 100%';
        this.vinvBindHoverTip(b, () => name);   // ★2026-09-13 反馈轮6:自有气泡替代 title
        const im = el('img') as HTMLImageElement;
        im.draggable = false;
        im.style.cssText = 'position:absolute; inset:0; margin:auto; max-width:36px; max-height:36px; image-rendering:pixelated;';
        im.src = headPath;
        b.appendChild(im);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          this.game.sfx.play('menuTick', 1);
          onPick();
          this.vinvPaintHousingSelection();
        });
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (this.game.housingMode) { this.game.housingMode = null; this.game.sfx.play('menuTick', 1); }
          this.vinvPaintHousingSelection();
        });
        const idx = this.vinvHousingSlotEls.length;
        page.appendChild(b);
        this.vinvLayoutItems.push({
          el: b,
          pos: () => {
            const c = this.vinvLayoutCtx;
            if (!c) return null;
            return housingSlotPositions(this.vinvHousingSlotEls.length, c.sw, c.num20, c.sh)[idx] ?? null;
          },
        });
        this.vinvHousingSlotEls.push({ el: b, img: im, key });
      };
      mk('__query__', 'sprites/vanilla/NPC_Head_0.png', Lang.inter(8),
        () => { this.game.housingMode = { kind: 'query' }; });   // 0 号=查询器(:41506)
      for (const r of rows) {
        mk(r.npcKey, `sprites/vanilla/NPC_Head_${r.headIndex}.png`, r.name,
          () => { this.game.housingMode = { kind: 'assign', npcKey: r.npcKey }; });
      }
      this.vinvLayoutSig = '';   // 行数变化 → 重排
      this.layoutVanilla();
    }
    this.vinvPaintHousingSelection();
  }

  /** 选中态:游标匹配槽 = Back14(Main.cs:42796 焦点帧) */
  private vinvPaintHousingSelection(): void {
    const cur = this.game?.housingMode ?? null;
    for (const s of this.vinvHousingSlotEls) {
      const active = cur && (s.key === '__query__'
        ? cur.kind === 'query'
        : cur.kind === 'assign' && cur.npcKey === s.key);
      s.el.style.backgroundImage = `url(sprites/vanilla/Inventory_Back${active ? 14 : 11}.png)`;
      s.img.style.opacity = active ? '0.4' : '1';   // 携带态灰显(HousingPanel.draw 同语义)
    }
  }

  /** Game 侧住房光标清理 → vanilla 布局住房页选中态重绘（分配成功/右键取消后
   *  housingMode 已清,本页无每帧重绘点——mainFlow onHousingCursor 回调驱动;
   *  HousingPanel 条走 cursorChanged(keepPanel) 自绘） */
  refreshHousingSelection(): void {
    this.vinvPaintHousingSelection();
  }

  private vinvCraftFocusV = 0;
  private vinvCraftAvailV: Array<{ r: VanillaRecipeLike; count: number }> = [];
  // ★SW-FX38 吸附动画状态(CraftingUI.cs:376-404 DrawRecipes_AdjustRecipeOffsetSnappy):
  //   glideY ≡ availableRecipeY[focusRecipe](焦点行当前吸附偏移,全列表重锚不变式
  //   availableRecipeY[i]=glideY+(i−focus)·65 :394-399);fastScroll ≡ PipsFastScroll/
  //   recFastScroll(Main.cs:1794/CraftingUI.cs:523,关背包每拍置位 Main.cs:46428);
  //   glideAcc = 60fps 步进配额(原版 Frame Skip 缺省拍频,高刷屏防 2× 快进)。
  private vinvCraftGlideY = 0;
  private vinvCraftFastScroll = false;
  private vinvCraftGlideAcc = 0;
  /** ★SW-RB14d（FX38-F2）：滚轮累计器（px,含余数留置——ScrollWheelValue 跨事件
   *  累计语义;teardown 清零） */
  private vinvCraftWheelPendPx = 0;

  // ---- ★SW-FX41 modern 合成窗状态域(NewCraftingUI.cs 字段面 1:1) ----
  /** Visible ≡ _ui.CurrentState != null(:240) */
  private vinvModernCraftOpen = false;
  /** _filter(站点滤器,craftingGrid CraftingTileFilter 同形) */
  private vinvModernCraftFilter: CraftingTileFilter | null = null;
  /** _openedWithoutFilter(OnActivate :907-909 置位) */
  private vinvModernOpenedWithoutFilter = false;
  /** _filterer.ActiveFilters(11 类筛选条激活集,UICreativeItemsInfiniteFilteringOptions 单选面) */
  private vinvModernActive: FilterKind[] = [];
  /** _searchBar 内容(OnActivate :912 SetContents("") 清) */
  private vinvModernSearch = '';
  /** _recipes 条目池(ResetRecipes :575-587 清;UpdateContents :589-634 增量建) */
  private vinvModernEntries: Array<{ r: VanillaRecipeLike; count: number; seen: boolean }> = [];
  /** _selectedRecipeIndex(=配方条目 r 引用;OnActivate :910 预选 availableRecipe[focusRecipe]) */
  private vinvModernSelected: VanillaRecipeLike | null = null;
  /** 滚动位(UIScrollbar._viewPosition) */
  private vinvModernViewPos = 0;

  // ---- 合成区(★2026-09-08 用户实测二轮:原版无面板底/无搜索框,合成=左下角
  //  竖向列表;Modern 网格面板整体退役)。权威:CraftingUI.DrawRecipesList
  //  (CraftingUI.cs:161-318)+ Main.cs:42239-42250(adjY/middleY 分档)+
  //  HoverOverCraftingItemButton(Main.cs:42971-43036,点非焦点=居中+音12,
  //  点焦点=合成,Shift×10)+ DrawRecipes_AdjustRecipeOffsetSnappy(:371-396)。
  //  ★SW-FX38(2026-09-11)清偿旧登记偏差:吸附动画已按 :376-404 落地(glideY/fastScroll
  //  + 60fps 步进配额,见上方字段注)——旧"瞬时重排替代"退役;鱼眼 scale/alpha/
  //  x 位移逐式还原。inventoryBack.A 取 150(原版 LoadSettings 初值)。
  private vinvBuildCraft(): void {
    // ★2026-09-13 用户实测:listHit 巨带(100×700)罩住背包左列=滚轮/点击死区 →
    //  整体移除;滚轮只绑配方格(vanilla=悬停配方列才滚)
    // 制作标题(Lang.inter[25] @(76,414+adjY);:169-173)
    const title = el('div', 'vinv-txt', Lang.inter(25));
    title.style.fontSize = '14px';
    this.vinvRoot?.appendChild(title);
    this.vinvCraftTitleEl = title;
    // 材料行容器(底部一行,槽位绝对定位)
    const mats = el('div');
    mats.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    this.vinvRoot?.appendChild(mats);
    this.vinvCraftMatEl = mats;
    // 就近箱参与制作开关((94,490+adjY);Main.cs:42440-42443,ChestCraft 32×34;
    // 网格切换钮 (94,450+adjY) = SW-FX30 刀②已建(vinvBuildGridToggle),经典网格视图同刀落地)
    const nearImg = document.createElement('img');
    nearImg.draggable = false;
    nearImg.style.cssText = 'width:100%; height:100%; image-rendering:pixelated; pointer-events:none;';
    const syncNear = (): void => { nearImg.src = `sprites/vanilla-ui/UI_ChestCraft_${options.data.craftFromNearbyChests ? 0 : 2}.png`; };
    syncNear();
    const nearBtn = el('button', 'vinv-btn') as HTMLButtonElement;
    nearBtn.style.cssText = 'width:32px; height:34px; padding:0;';
    nearBtn.appendChild(nearImg);
    // ★2026-09-13 用户要求:hover 态(帧 1/3)+ 自有气泡(title 原生气泡慢)
    nearBtn.addEventListener('mouseenter', (e) => {
      nearImg.src = `sprites/vanilla-ui/UI_ChestCraft_${options.data.craftFromNearbyChests ? 1 : 3}.png`;
      this.showBuffTooltip((e.currentTarget as HTMLElement), Lang.text(options.data.craftFromNearbyChests
        ? 'GameUI.CraftFromNearbyChestsOn' : 'GameUI.CraftFromNearbyChestsOff'), '');
    });
    nearBtn.addEventListener('mouseleave', () => {
      syncNear();
      this.hideBuffTooltip();
    });
    nearBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      void options.set('craftFromNearbyChests', !options.data.craftFromNearbyChests);
      this.game.sfx.play('menuTick', 1);
      // ★SW-FX41:窗开态 = NewCraftingUI.RefreshGrid(CraftingUI.cs:350-352 →
      //   NewCraftingUI.cs:988-994 ResetRecipes)——就近箱集变化即重排窗格
      if (this.vinvModernCraftOpen) { this.vinvModernResetRecipes(); this.vinvUpdateModernCraft(); }
    });
    this.optionsUnsubs.push(options.onChange(() => syncNear()));   // ★BJ335:每轮订阅入册,closeAll 摘
    this.vinvRoot?.appendChild(nearBtn);
    this.vinvLayoutItems.push({ el: nearBtn, pos: () => {
      const c = this.vinvLayoutCtx;
      if (!c) return null;
      // ★刀19:向导态整隐(Main.cs:42440 !InGuideCraftMenu 门/NewCraftingUI.cs:496 同门)
      if (this.vinvGuideMenuOpen) return null;
      // ★SW-FX41:窗开态 = 窗内就近箱钮锚(DrawChildren :495-499 num2+40,钮心 (82|122,285)
      //   → top-left (66|106,268) FX43b;经典锚 (94,490+adjY) 在 else 分支,窗开不画——同一对象换锚,两态互斥)
      if (this.vinvModernCraftOpen) {
        return mcraftWindowToggleXY(!!this.game?.world?.isJourney).nearby;
      }
      // ★重铸态整隐(Main.cs:42418 else-if !InReforgeMenu——经典锚 (94,490+adjY) 在该支)
      if (this.vinvReforgeVisible()) return null;
      return { x: 94, y: 490 + this.vinvCraftAdjY(c.sh) };
    } });
    this.vinvLayoutItems.push({ el: title, pos: () => {
      const c = this.vinvLayoutCtx;
      if (!c || !this.vinvClassicCraftVisible()) return null;   // ★SW-FX41:窗开不画(:42418 else 支)
      return { x: 76, y: 414 + this.vinvCraftAdjY(c.sh) };
    } });
    this.vinvLayoutItems.push({ el: mats, pos: () => this.vinvClassicCraftVisible() ? { x: 0, y: 0 } : null });   // ★SW-FX41:窗开隐藏(材料行 = 窗详情浮层替代)
    // ---- 网格切换钮 + 经典网格视图(★SW-FX30 刀②:DrawGridToggle CraftingUI.cs:267-330 +
    //      DrawRecipesGrid CraftingUI.cs:446-571;债#2 清偿) ----
    this.vinvBuildGridToggle();
    this.vinvBuildCraftGrid();
    this.vinvBindGridWheel();
    // ---- ★SW-FX41 modern 窗族(NewCraftingUI.cs:302-501;债#2-modern P2-1/P2-4 清偿) ----
    this.vinvBuildModernCraft();

    // ---- ★刀19:向导槽(经典位 Main.cs:42401-42415 @(73,331+num52) ctx7 0.85)+
    //      DrawGuideCraftText(:42901-42924)——仅向导态∧窗关可见(:42401 else-if 门) ----
    {
      const root = this.vinvRoot;
      if (!root) return;
      const cgSlot = el('div', 'sw-slot');
      cgSlot.style.cssText = 'position:absolute; width:52px; height:52px; background-image:none;'
        + '--slot-bgimg:url(sprites/vanilla/Inventory_Back.png); transform:scale(0.85);'
        + 'transform-origin:top left; pointer-events:auto;';
      cgSlot.addEventListener('contextmenu', (e) => e.preventDefault());
      // ★S4：悬停 tooltip（同 classic 覆层面——三面槽实例同一原版 ctx7 面）
      cgSlot.addEventListener('mouseenter', () => this.refreshGuideSlotTooltip(cgSlot));
      cgSlot.addEventListener('mouseleave', () => {
        this.tooltip.style.display = 'none';
        cancelAnimationFrame(this.tooltipPulseRaf);
      });
      cgSlot.addEventListener('mousedown', (e) => {
        this.guideSlotMouseDown(e as MouseEvent, () => {
          this.vinvPaintGuideCraft(); this.vinvRefreshCraft();
          this.refreshGuideSlotTooltip(cgSlot);
        });
      });
      root.appendChild(cgSlot);
      this.vinvGuideSlotClassicEl = cgSlot;
      this.vinvLayoutItems.push({ el: cgSlot, pos: () => {
        const c = this.vinvLayoutCtx;
        if (!c || !this.vinvGuideMenuOpen || this.vinvModernCraftOpen) return null;
        return { x: 73, y: 331 + this.vinvCraftAdjY(c.sh) };
      } });
      const cgTxt = el('div', 'vinv-txt');
      cgTxt.style.cssText += 'position:absolute; font-size:14px; white-space:normal; line-height:26px; width:300px;';
      root.appendChild(cgTxt);
      this.vinvGuideClassicTextEl = cgTxt;
      this.vinvLayoutItems.push({ el: cgTxt, pos: () => {
        const c = this.vinvLayoutCtx;
        if (!c || !this.vinvGuideMenuOpen || this.vinvModernCraftOpen) return null;
        // 空=inter[24] @(槽+50,+12);有件=两行 @(+50,−2) 起(原文 +12−14=−2,+26 步距)
        return { x: 123, y: 329 + this.vinvCraftAdjY(c.sh) };
      } });
    }
  }

  /** 合成视图切换钮(DrawGridToggle CraftingUI.cs:267-330,Main.cs:42437-42439
   *  @(94,450+adjY) 居中锚 32×34 CraftToggle 六帧)。★本仓 top-left 约定 = 与同列
   * 就近箱钮(7328)一致的原版钮心坐标 +16/+17 偏差备案(两钮成列对齐;原版 origin=size/2)。
   *  帧算式 = craftToggleFrame(modernVisible≡false, grid, hover):list 态 2/3、grid 态
   *  0/1、modern 窗态 4/5(NewCraftingUI 未建,分支缺席=分期债)。左键 classic 支 =
   *  PipsUseGrid 翻转(:294-306)+PlaySound(12);modern 支(:308-316 NewCraftingUI.
   *  ToggleInInventory)=分期,本刀仅保留声效面。右键 = CraftingGridControl 循环
   *  (:322-331)+PlaySound(12)+options 持久化(Main.cs:4295 CraftingControlMode;
   *  原版右键不即时 SaveSettings,本仓 options.set 即时落盘=既有约定面)。悬停 =
   *  ±15 盒(:275)+CraftingWindowTextTipKey(:91-97)+DoStatefulTickSound 沿音
   *  (Main.cs:3333-3344)。Recipes 页金标指示条(Utils.cs:2901-2910,OurFavoriteColor
   *  Main.cs:886)=本仓恒 Recipes 页(无 Banners pip)→ 恒画,画于钮下层(:275-278 先条后钮)。 */
  private vinvBuildGridToggle(): void {
    const root = this.vinvRoot;
    if (!root) return;
    // 金标指示条(32×20 canvas;16 行 2px 渐变 α=(1-k/16)·0.6 + 实心 32×4;条顶=钮心)
    const bar = document.createElement('canvas');
    bar.width = 32; bar.height = 20;
    const g = bar.getContext('2d');
    if (g) {
      for (const row of craftSelectedBarRows()) {
        g.fillStyle = `rgba(${CRAFT_BAR_COLOR},${row.a})`;
        g.fillRect(0, row.y, 32, row.h);
      }
      g.fillStyle = `rgb(${CRAFT_BAR_COLOR})`;
      g.fillRect(0, CRAFT_BAR_SOLID.y, 32, CRAFT_BAR_SOLID.h);
    }
    bar.style.cssText = 'position:absolute; width:32px; height:20px; image-rendering:auto;'
      + 'pointer-events:none; z-index:0;';
    root.appendChild(bar);
    this.vinvLayoutItems.push({ el: bar, pos: () => {
      const c = this.vinvLayoutCtx;
      if (!c) return null;
      // ★SW-FX41:窗开态锚随窗内切换钮(DrawChildren :486-499 钮心 (42|82,285) → top-left
      //   (26|66,268),FX43b;条顶=钮心(CraftingUI.cs:275-278 Utils.DrawSelectedCraftingBar
      //   Indicator 行域 craftY..craftY+19)= 钮 top+17 = CRAFT_BAR_TOP_OFF;指示条在钮下层恒画)
      if (this.vinvModernCraftOpen) {
        const t = mcraftWindowToggleXY(!!this.game?.world?.isJourney).toggle;
        return { x: t.x, y: t.y + CRAFT_BAR_TOP_OFF };
      }
      // ★重铸态整隐(Main.cs:42418 else-if !InReforgeMenu——DrawGridToggle :275-277 指示条
      //   在该支内;就近箱钮 :8038/切换钮 :8211 同门已有,旧码条缺门=重铸态配方面整隐后
      //   32×20 金渐变指示条孤悬左下=用户报「黄渐变小方块」)
      if (this.vinvReforgeVisible()) return null;
      // ★RB29(2026-09-15)回归2连带:向导态条随切换钮上移(Main.cs:42438
      //   num67=InGuideCraftMenu ? 300 : 450;条画在钮位 CraftingUI.cs:275-278
      //   Utils.DrawSelectedCraftingBarIndicator(spriteBatch,craftX,craftY)——旧码缺
      //   向导支=条滞留 450 位与钮脱钩,向导态旧钮位悬空金条=用户截图可见异常)
      if (this.vinvGuideMenuOpen) return { x: 94, y: 300 + this.vinvCraftAdjY(c.sh) + CRAFT_BAR_TOP_OFF };
      return { x: 94, y: 450 + this.vinvCraftAdjY(c.sh) + CRAFT_BAR_TOP_OFF };
    } });
    // 钮本体(Craft_Toggle 六帧贴图;悬停 ±15 盒≈整钮)
    const btn = el('button', 'vinv-btn') as HTMLButtonElement;
    btn.style.cssText = 'width:32px; height:34px; padding:0; z-index:1;';
    const img = document.createElement('img');
    img.draggable = false;
    img.style.cssText = 'width:100%; height:100%; image-rendering:pixelated; pointer-events:none;';
    btn.appendChild(img);
    this.vinvGridToggleImg = img;
    this.vinvSyncGridToggle();
    // ★2026-09-13 用户要求:hover 名走自有气泡(showBuffTooltip),弃原生 title(慢)
    btn.addEventListener('mouseenter', (e) => {
      this.vinvGridToggleHover = true;
      this.vinvSyncGridToggle();                        // num += flag.ToInt()(:291)
      this.game.sfx.play('menuTick', 1);                // DoStatefulTickSound(Main.cs:3333-3344)沿
      this.showBuffTooltip((e.currentTarget as HTMLElement), Lang.text(craftingWindowTextTipKey(options.data.craftingGridControl)), '');
    });
    btn.addEventListener('mouseleave', () => {
      this.vinvGridToggleHover = false;
      this.vinvSyncGridToggle();
      this.hideBuffTooltip();
    });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (e.button === 2) {
        // 右键支(:322-331):Classic↔Modern 循环 + PlaySound(12)
        void options.set('craftingGridControl',
          cycleCraftingGridControl(options.data.craftingGridControl));
        this.showBuffTooltip((e.currentTarget as HTMLElement), Lang.text(craftingWindowTextTipKey(options.data.craftingGridControl)), '');
        this.game.sfx.play('menuTick', 1);
        return;
      }
      if (e.button !== 0) return;
      // 左键支(:294-321):!TryChangePipsPage(Recipes) 恒 false(无 Banners pip=恒已该页)
      //   → 走切换;flag2(classic 支) = PipsUseGrid 翻转;NewCraftingUI.Close(quiet)=窗未建恒 no-op
      if (options.data.craftingGridControl === 'classic') {
        // ★SW-FX41:classic 左键支(:299-306)先 NewCraftingUI.Close(quiet:true,
        //   returnToInventory:true) 再翻网格——窗开态右键切回 classic 后左键可达此臂
        this.vinvCloseModernCraft(true);
        this.vinvPipsUseGrid = !this.vinvPipsUseGrid;   // :306
        if (!this.vinvPipsUseGrid) this.vinvCraftRecStart = 0;   // !PipsUseGrid → recStart=0(Main.cs:43926-43929)
        this.vinvSyncGridToggle();
        this.vinvUpdateCraftGrid();
        // ★SW-RB13b:网格态翻转必须重排——ChestUI.cs:81 吞箱条三门(名/槽/钮 pos 闭包)
        //   与变体回位闭包只在 layoutVanilla pos 循环里求值;不重排=开箱+开网格态
        //   箱条滞留屏上与网格叠画(vinvUpdateReforge 同族教训:显隐依赖可变状态必须触发 relayout)
        this.vinvLayoutSig = '';
        this.layoutVanilla();
      } else {
        // ★SW-RB13b:modern 左键副效应面(:310-315 Main.PipsUseGrid=false 先于
        //   ToggleInInventory)——PipsUseGrid=false 使已开网格可经切换钮关闭
        this.vinvPipsUseGrid = false;
        this.vinvCraftRecStart = 0;                     // !PipsUseGrid → recStart=0(Main.cs:43926-43929)
        this.vinvSyncGridToggle();
        this.vinvUpdateCraftGrid();
        this.vinvLayoutSig = '';
        this.layoutVanilla();
        // ★SW-FX41 P2-2:modern 左键支(:308-316)ToggleInInventory——开/关 NewCraftingUI
        //   窗(:926-936 Visible?Close(returnToInventory:true):Open)
        this.vinvToggleModernCraft(false);
      }
      // 声效面(:321 PlaySound(12) 在两支后照走;窗开合音 10/11 由 Open/Close 各自放)
      this.game.sfx.play('menuTick', 1);                // PlaySound(12)(:321)
    });
    root.appendChild(btn);
    this.vinvLayoutItems.push({ el: btn, pos: () => {
      const c = this.vinvLayoutCtx;
      if (!c) return null;
      // ★SW-FX41:窗开态 = 窗内切换钮锚(NewCraftingUI.DrawChildren :486-499 num2=42/
      //   旅程 82,num3=285——Main.cs:42424-42443 经典锚 (94,450+adjY) 在 else 分支不画)
      if (this.vinvModernCraftOpen) {
        return mcraftWindowToggleXY(!!this.game?.world?.isJourney).toggle;
      }
      // ★刀19:向导态切换钮上移(Main.cs:42438 num67=InGuideCraftMenu ? 300 : 450)+num52)
      if (this.vinvGuideMenuOpen && !this.vinvModernCraftOpen) return { x: 94, y: 300 + this.vinvCraftAdjY(c.sh) };
      // ★重铸态整隐(Main.cs:42418 else-if !InReforgeMenu——经典锚 (94,450+adjY) 在该支)
      if (this.vinvReforgeVisible()) return null;
      return { x: 94, y: 450 + this.vinvCraftAdjY(c.sh) };
    } });
  }

  /** 帧同步(craftToggleFrame:grid 态 0/1,list 态 2/3,modern 窗态 4/5——★SW-FX41
   *  NewCraftingUI.Visible 支接线,:281-285 modernVisible=窗开态) */
  private vinvSyncGridToggle(): void {
    const img = this.vinvGridToggleImg;
    if (!img) return;
    const f = craftToggleFrame(this.vinvModernCraftOpen, this.vinvPipsUseGrid, this.vinvGridToggleHover);
    img.src = `sprites/vanilla-ui/UI_Craft_Toggle_${f}.png`;
  }

  // =====================================================================
  // ★SW-FX41(2026-09-12)modern 合成窗(P2-1 窗体本体/P2-4 11 类筛选条)——
  // NewCraftingUI.cs:302-501 逐式;几何/筛选判据/状态机单源 = ui/modernCrafting.ts。
  // Main.cs:42418-42421 窗可见 → DrawUI,else 分支(经典列表+标题+材料行)整支不画
  // = vinvClassicCraftVisible 门;窗内切换钮/就近箱钮 = 同一 DOM 对象换锚(:486-499)。
  // =====================================================================
  private vinvModernCraftEl: HTMLDivElement | null = null;
  private vinvModernPanelEl: HTMLElement | null = null;
  private vinvModernTitleEl: HTMLElement | null = null;
  private vinvModernSearchInput: HTMLInputElement | null = null;
  private vinvModernSearchClear: HTMLButtonElement | null = null;
  private vinvModernSearchRowEl: HTMLElement | null = null;   // ★RB28:条几何每拍回填(update)
  private vinvModernGridList: HTMLElement | null = null;
  private vinvModernGridInner: HTMLElement | null = null;
  private vinvModernSeparatorEl: HTMLElement | null = null;
  private vinvModernScrollbarEl: HTMLElement | null = null;
  private vinvModernScrollHandle: HTMLElement | null = null;
  private vinvModernSbarWinMove: ((e: MouseEvent) => void) | null = null;   // ★RB29b F5:window mousemove 监听引用(teardown 摘除)
  private vinvModernSbarWinUp: (() => void) | null = null;                  // ★RB29b F5:window mouseup 监听引用(teardown 摘除)
  private vinvModernDetailEl: HTMLElement | null = null;
  private vinvModernFilterBtns: HTMLButtonElement[] = [];
  private vinvModernFilterHovers: boolean[] = [];
  /** ★SUI-P2 惰性池:null=未物化;物化格驻留复用(窗外仅 display:none) */
  private vinvModernCellEls: Array<{ el: HTMLElement; r: VanillaRecipeLike } | null> = [];
  /** 最近一拍可用集(vinvEnsureModernCells 物化时置灰判定源;UpdateContents 每拍刷新) */
  private vinvModernAvailNow: ReadonlySet<VanillaRecipeLike> | null = null;

  /** 经典合成面可见门(Main.cs:42418-42421 NewCraftingUI.Visible → else 分支跳过;
   *  ★2026-09-16 用户实报「重铸槽压配方列」:同 else-if 头还有 !InReforgeMenu
   *  (:42418)——重铸开启 = DrawRecipesList/标题/材料行/经典锚切换钮【整支不画】
   *  (带互斥,原版无重铸态右移/列表移位)⇒ 门加 vinvReforgeVisible 同支) */
  private vinvClassicCraftVisible(): boolean {
    return !this.vinvModernCraftOpen && !this.vinvReforgeVisible();
  }

  private vinvBuildModernCraft(): void {
    const root = this.vinvRoot;
    if (!root) return;
    const win = el('div', 'sw-mcraft');
    win.style.cssText = 'position:absolute; width:490px; pointer-events:auto; display:none; z-index:5;';
    root.appendChild(win);
    this.vinvModernCraftEl = win;
    this.vinvLayoutItems.push({ el: win, pos: () => this.vinvModernCraftOpen ? { x: 20, y: 312 } : null });
    // ---- 11 类筛选条(:389-393 HAlign .5/Top 4 + UICreativeItemsInfiniteFilteringOptions
    //      钮 40px 步距/帧 42×48 offset−2−2/icon 帧 30×30 offset−2−0 Left6 VAlign.5) ----
    const bar = mcraftFilterBarRect();
    MCRAFT_ALL_BUTTONS.forEach((fb, i) => {
      const b = el('button', 'vinv-btn') as HTMLButtonElement;
      b.style.cssText = `position:absolute; left:${bar.x - 20 + 40 * i}px; top:${bar.y - 312}px;`
        + `width:${MCRAFT_TAB_TEX.dw}px; height:${MCRAFT_TAB_TEX.dh}px; padding:0; overflow:hidden;`;
      const tab = document.createElement('div');
      tab.style.cssText = 'position:absolute; left:0; top:0; width:100%; height:100%; image-rendering:pixelated; pointer-events:none;';
      const icon = document.createElement('img');
      icon.draggable = false;
      icon.style.cssText = `position:absolute; left:${MCRAFT_ICON_TEX.ox}px; top:${MCRAFT_ICON_TEX.oy}px;`
        + `width:${MCRAFT_ICON_TEX.dw}px; height:${MCRAFT_ICON_TEX.dh}px; image-rendering:pixelated; pointer-events:none;`
        + `background-image:url(sprites/vanilla-ui/UI_Creative_Infinite_Icons.png); background-size:${MCRAFT_ICON_TEX.w}px ${MCRAFT_ICON_TEX.h}px;`
        + `background-position:${mcraftIconBgX(fb.icon)}px 0px;`;
      b.appendChild(tab);
      b.appendChild(icon);
      b.addEventListener('mouseenter', (e) => {
        this.vinvModernFilterHovers[i] = true;
        this.game.sfx.play('menuTick', 1);            // button_OnMouseOver :76-79 Sound 12
        // ShowButtonName :128-135 → ★2026-09-13 反馈轮6:自有气泡替代 title
        this.showBuffTooltip((e.currentTarget as HTMLElement), Lang.text(fb.l10n), '');
        this.vinvSyncModernFilterBtn(i);
      });
      b.addEventListener('mouseleave', () => {
        this.vinvModernFilterHovers[i] = false;
        this.vinvSyncModernFilterBtn(i);
        this.hideBuffTooltip();
      });
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.vinvModernActive = toggleFilterRadio(this.vinvModernActive, fb.kind);   // :81-101
        this.vinvModernResetRecipes();                // OnClickingOption :393 → ResetRecipes
        for (let k = 0; k < this.vinvModernFilterBtns.length; k++) this.vinvSyncModernFilterBtn(k);
        this.vinvUpdateModernCraft();
      });
      win.appendChild(b);
      this.vinvModernFilterBtns.push(b);
      this.vinvModernFilterHovers.push(false);
      this.vinvSyncModernFilterBtn(i);
    });
    // ---- 主内衬 UIPanel(:321-332)——★RB28 用户实报:原版 = PanelBackground/
    //      PanelBorder 28² 白模 9-slice 乘色(UIPanel.cs:50-78 DrawPanel:角 12 条 4),
    //      无 12px 黑框(SetPadding(12) = 内容内衬非描边,内容几何走 mcraftPanelInner
    //      单源)——本体保持无边框(绝对定位子层含块 = padding 盒,带边框会把面板内
    //      容整体挤偏 12px),九宫面挂 inset:0 双层;白模未就绪前退化为纯色圆角底
    //      (vanillaKit .sw-vpanel 同兜底法),染色数值 = MCRAFT_*_TINT 反编译常量 ----
    const panel = el('div');
    panel.style.cssText = 'position:absolute; left:0; top:38px; width:490px; bottom:0;';
    const panelBg = el('div');
    panelBg.style.cssText = `position:absolute; inset:0; pointer-events:none;`
      + `border-radius:10px; background:${MCRAFT_PANEL_BG};`;
    const panelBorder = el('div');
    panelBorder.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    panel.appendChild(panelBg);
    panel.appendChild(panelBorder);
    win.appendChild(panel);
    this.vinvModernPanelEl = panel;
    // ★RB29b F2(2026-09-15):筛选钮移到 panel 后 append(原版 :394 totalContainer.Append
    //   (uICreativeItemsInfiniteFilteringOptions) = 尾位 → 筛选条盖主内衬)——旧序 panel
    //   顶缘 12px 吃 tab 底带命中/绘制(DOM 序倒置伪影)。appendChild = 既有节点移动,
    //   定位 cssText 零改(纯抬层,几何零改)。
    this.vinvModernFilterBtns.forEach((b) => win.appendChild(b));
    void Promise.all([
      tintedSliceDataUrl('sprites/vanilla-ui/UI_PanelBackground.png',
        MCRAFT_PANEL_TINT.r, MCRAFT_PANEL_TINT.g, MCRAFT_PANEL_TINT.b, MCRAFT_PANEL_TINT.a),
      tintedSliceDataUrl('sprites/vanilla-ui/UI_PanelBorder.png',
        MCRAFT_BORDER_TINT.r, MCRAFT_BORDER_TINT.g, MCRAFT_BORDER_TINT.b, MCRAFT_BORDER_TINT.a),
    ]).then(([bg, border]) => {
      if (!bg) return;
      // ★FX43:九宫就绪即撤纯色兜底层——α<1 时兜底(background)与九宫(fill)双绘 =
      //  有效 α 1−(1−α)²(0.557→0.804),54 图实测 intercept 21.5/αeff≈0.80 双绘实证
      panelBg.style.background = 'transparent';
      panelBg.style.border = `${MCRAFT_PANEL_CORNER}px solid transparent`;   // 角 12 条 4(UIPanel.cs:10-12)
      panelBg.style.borderImage = `url(${bg}) ${MCRAFT_PANEL_CORNER} fill stretch`;
      if (border) {
        panelBorder.style.border = `${MCRAFT_PANEL_CORNER}px solid transparent`;
        panelBorder.style.borderImage = `url(${border}) ${MCRAFT_PANEL_CORNER} fill stretch`;
      }
    });
    // 标题(UIPanel 内 UIText Left−1/Top−2 :333-337;UpdateText :419-429)
    // ★FX43:14→18px——双图实测标题墨高 53=31px/54=24px 同尺(84px 节距归一),×31/24≈18
    const title = el('div', 'vinv-txt');
    title.style.cssText += 'position:absolute; font-size:18px; pointer-events:none; white-space:nowrap;';
    panel.appendChild(title);
    this.vinvModernTitleEl = title;
    // 搜索条(UIWrappedSearchBar Red 主题 :340-353)——★RB28:整条贯通(右缘=内衬右
    // :482、左缘随标题外宽 +22 让位,UpdateText :419-429 Width=100%−标题外宽−10,
    // 几何单源 mcraftSearchBarRect + vinvUpdateModernCraft 每拍实测标题宽回填;
    // 旧 shrink-to-fit 窄条 = 绝对定位未给宽的自由收缩伪影) */
    const searchRow = el('div');
    searchRow.style.cssText = `position:absolute; left:22px; right:8px; top:${12 - 4}px;`
      + `height:${MCRAFT_SEARCH_H}px; display:flex; align-items:center; gap:3px;`;
    const searchBtn = el('button', 'vinv-btn') as HTMLButtonElement;
    searchBtn.style.cssText = 'position:relative; width:22px; height:22px; padding:0; flex:none;';
    const sbImg = document.createElement('img');
    sbImg.src = 'sprites/vanilla-ui/UI_Bestiary_Button_Search_2.png';
    sbImg.style.cssText = 'width:100%; height:100%; image-rendering:pixelated; pointer-events:none;';
    searchBtn.appendChild(sbImg);
    searchBtn.addEventListener('mouseenter', () => { sbImg.src = 'sprites/vanilla-ui/UI_Bestiary_Button_Search_Border.png'; });
    searchBtn.addEventListener('mouseleave', () => { sbImg.src = 'sprites/vanilla-ui/UI_Bestiary_Button_Search_2.png'; });
    searchBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      // ★FX41b 遗留(2026-09-16 用户实报「输入框打不了字」根因):mousedown 缺
      //   preventDefault —— 处理器内 focus(input) 后浏览器缺省动作仍把焦点交给
      //   button(target),input 立即失焦,后续键入全落按钮上(探针 I5:ae=BUTTON)。
      //   Click_SearchArea 域 = 原版整条搜索区吃输入(UISearchBar takingInput)
      e.preventDefault();
      this.vinvModernSearchInput?.focus();            // Click_SearchArea
    });
    searchRow.appendChild(searchBtn);
    const searchBox = el('div');
    searchBox.style.cssText = `flex:1; height:${MCRAFT_SEARCH_H}px; position:relative;`
      + 'display:flex; align-items:center; min-width:0;';
    // 盒体点击 = 同一 Click_SearchArea 域(:113 盒随条贯通):点中输入框本体的
    // mousedown 由 input 分支 stopPropagation 独走;点盒体衬域(右衬 24px/边)时
    // 缺省 = div 不可聚焦 → activeElement 塌回 body 吞焦点,此处收拢到 input
    searchBox.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.vinvModernSearchInput?.focus();            // Click_SearchArea
    });
    // 盒面 = UIPanel 白模 9-slice 乘色(bg/border 同 tint → 实心圆角蓝条;
    // UIWrappedSearchBar.cs:111-126 角 12 → 24 高条 = 半圆角药丸。旧 radius 5px/直角
    // 分段面 = 白模缺位伪影);未就绪前纯色圆角兜底 */
    const boxBg = el('div');
    boxBg.style.cssText = `position:absolute; inset:0; pointer-events:none;`
      + `border-radius:${MCRAFT_PANEL_CORNER}px; background:${MCRAFT_SEARCH_BG};`;
    const boxBorder = el('div');
    boxBorder.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    searchBox.appendChild(boxBg);
    searchBox.appendChild(boxBorder);
    void Promise.all([
      tintedSliceDataUrl('sprites/vanilla-ui/UI_PanelBackground.png',
        MCRAFT_SEARCH_TINT.r, MCRAFT_SEARCH_TINT.g, MCRAFT_SEARCH_TINT.b, MCRAFT_SEARCH_TINT.a),
      tintedSliceDataUrl('sprites/vanilla-ui/UI_PanelBorder.png',
        MCRAFT_SEARCH_TINT.r, MCRAFT_SEARCH_TINT.g, MCRAFT_SEARCH_TINT.b, MCRAFT_SEARCH_TINT.a),
    ]).then(([bg, border]) => {
      if (!bg) return;
      boxBg.style.background = 'transparent';   // ★FX43 同 panelBg:撤兜底防双绘
      boxBg.style.border = `${MCRAFT_PANEL_CORNER}px solid transparent`;
      boxBg.style.borderImage = `url(${bg}) ${MCRAFT_PANEL_CORNER} fill stretch`;
      if (border) {
        boxBorder.style.border = `${MCRAFT_PANEL_CORNER}px solid transparent`;
        boxBorder.style.borderImage = `url(${border}) ${MCRAFT_PANEL_CORNER} fill stretch`;
      }
    });
    const input = el('input') as HTMLInputElement;
    input.placeholder = Lang.text('UI.PlayerNameSlot');   // 空文案 = UI.PlayerNameSlot(:81 缺省,原版本相)
    // ★FX43:字号 13→16(UISearchBar 0.8f×MouseText 20px em=16 :127);左衬 4→12
    //  (53 图实测占位墨左距盒缘 ≈11.5 UI≈UIPanel 圆角衬);占位色 = Color.Gray
    //  (UISearchBar.cs:74 ! takingInput 臂)——scoped 规则在 vinvStyleEnsure
    input.style.cssText = 'flex:1; min-width:0; background:transparent; border:none; outline:none; color:#fff;'
      + 'font-size:16px; padding:0 24px 0 12px; font-family:inherit;';
    input.addEventListener('input', (e) => {
      this.vinvModernSearch = (e.currentTarget as HTMLInputElement).value;
      // SetSearchFilter+ResetRecipes(OnSearchContentsChanged :649-653);空白归零走
      // normalizeSearch(EntryFilterer.SetSearchFilter :85-94 IsNullOrWhiteSpace→null)
      this.vinvModernResetRecipes();
      this.vinvUpdateModernCraft();
    });
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    searchBox.appendChild(input);
    const cancel = el('button', 'vinv-btn') as HTMLButtonElement;
    // ✕ = HAlign1+VAlign.5+Left −2(:144-148)→ 右缘内缩 2、24 高占满盒内右端
    cancel.style.cssText = `position:absolute; right:${MCRAFT_SEARCH_CANCEL_INSET}px; top:50%;`
      + 'transform:translateY(-50%); width:24px; height:24px; padding:0; flex:none;';
    const cxImg = document.createElement('img');
    cxImg.src = 'sprites/vanilla-ui/UI_SearchCancel.png';
    cxImg.style.cssText = 'width:100%; height:100%; image-rendering:pixelated; pointer-events:none;';
    cancel.appendChild(cxImg);
    cancel.addEventListener('mouseenter', () => this.game.sfx.play('menuTick', 1));   // :196-199
    cancel.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      // ★同 🔍 钮:压 button 缺省抢焦,否则处理器内 focus(input) 被缺省动作覆盖
      e.preventDefault();
      if (this.vinvModernSearch !== '') {             // searchCancelButton_OnClick :189-195
        this.vinvModernSearch = '';
        input.value = '';
        this.vinvModernResetRecipes();
        this.vinvUpdateModernCraft();
        this.game.sfx.play('menuClose', 1);
      } else {
        this.game.sfx.play('menuTick', 1);
      }
      // ★FX41b 遗留修同批:✕ 挂在盒面板内,原版 UI 事件冒泡 → ✕ 点击同时触发
      //   uIPanel.OnLeftClick=Click_SearchArea(UIWrappedSearchBar.cs:136/:151)取输入;
      //   本仓 stopPropagation 拦死冒泡 → ✕ 后键入落按钮(同「打不了字」族),补冒泡等价面
      this.vinvModernSearchInput?.focus();
    });
    searchBox.appendChild(cancel);
    searchRow.appendChild(searchBox);
    panel.appendChild(searchRow);
    this.vinvModernSearchInput = input;
    this.vinvModernSearchClear = cancel;
    this.vinvModernSearchRowEl = searchRow;
    // ---- 网格容器/分隔线/列表/滚动条(:354-388) ----
    // 分隔线 = UIHorizontalSeparator(Separator1 6×4 白模,EdgeWidth 2,Utils.DrawPanel
    // 三分:左右 2px 1:1+中段横拉;色 =(89,116,213)*0.9 平移 :364-366)——★RB28:旧面
    // 白模未乘色直叠(白线伪影),现走 canvas 预染色 border-image 2 fill(CharCreation
    // .sw-char-sep 同式;盒 4px 高 border 2+2 全覆盖,纯色底仅就绪前兜底)
    const sepEl = el('div');
    sepEl.style.cssText = `position:absolute; left:4px; height:4px; box-sizing:border-box;`
      + `image-rendering:pixelated; background:${MCRAFT_SEPARATOR_COLOR};`;
    panel.appendChild(sepEl);
    this.vinvModernSeparatorEl = sepEl;
    void tintedSliceDataUrl('sprites/vanilla-ui/UI_CharCreation_Separator1.png',
      MCRAFT_SEPARATOR_TINT.r, MCRAFT_SEPARATOR_TINT.g, MCRAFT_SEPARATOR_TINT.b, MCRAFT_SEPARATOR_TINT.a,
    ).then((url) => {
      if (!url) return;
      sepEl.style.background = 'transparent';   // ★FX43 同 panelBg:撤兜底防双绘
      sepEl.style.border = '2px solid transparent';
      sepEl.style.borderImage = `url(${url}) 2 fill stretch`;
    });
    const gridList = el('div');
    gridList.style.cssText = 'position:absolute; overflow:hidden;';
    panel.appendChild(gridList);
    this.vinvModernGridList = gridList;
    const gridInner = el('div');
    gridInner.style.cssText = 'position:absolute; left:0; top:0;';
    gridList.appendChild(gridInner);
    this.vinvModernGridInner = gridInner;
    // 滚动条(UIScrollbar Cyan 主题 :56-70 → Scrollbar2 轨 + ScrollbarInner 柄;DrawBar
    //   :96-101 三分:盖 6px 1:1、中段 4px 源行纵拉;★FX41b:旧面整胶囊逐 16px 平铺+Blue
    //   主题贴图 =「一列粗蓝药丸」伪影,现 border-image 竖向三分(slice 6 0 fill)1:1。
    //   ★RB29b F4(2026-09-15):轨/柄 DOM 盒 = 元素矩形/柄矩形本体(命中域 = LeftMouseDown
    //   :127-145 Contains 域 1:1),盖 ±6 仅绘制越界 → 内层 face(top:−cap/height:+2cap,
    //   pointer-events:none)承担绘制——旧盒纵向 ±6 扩张 = 点轨/拖拽/悬停域各多 12px)
    const sbar = el('div');
    sbar.style.cssText = 'position:absolute; width:20px;';   // 元素矩形 = 命中域
    const sbarFace = el('div');
    sbarFace.style.cssText = `position:absolute; left:0; top:${-MCRAFT_SCROLLBAR_TEX.cap}px; width:20px;`
      + `height:calc(100% + ${MCRAFT_SCROLLBAR_TEX.cap * 2}px); box-sizing:border-box;`
      + `image-rendering:pixelated; pointer-events:none;`   // 越界面不命中(命中=轨盒本体)
      + `border-style:solid; border-color:transparent; border-width:${MCRAFT_SCROLLBAR_TEX.cap}px 0;`
      + `border-image-source:url(${MCRAFT_SCROLLBAR_TEX.track});`
      + `border-image-slice:${MCRAFT_SCROLLBAR_TEX.cap} 0 fill; border-image-repeat:stretch;`
      + `border-image-width:${MCRAFT_SCROLLBAR_TEX.cap}px 0; background:rgb(55,109,120);`;
    const handle = el('div');
    handle.style.cssText = `position:absolute; left:0; width:20px; pointer-events:auto;`
      + `opacity:${MCRAFT_SCROLLBAR_HANDLE_ALPHA};`;   // 柄矩形 = 命中/悬停域(:117/:133 Contains)
    const handleFace = el('div');
    handleFace.style.cssText = `position:absolute; left:0; top:${-MCRAFT_SCROLLBAR_TEX.cap}px; width:20px;`
      + `height:calc(100% + ${MCRAFT_SCROLLBAR_TEX.cap * 2}px); box-sizing:border-box;`
      + `image-rendering:pixelated; pointer-events:none;`
      + `border-style:solid; border-color:transparent; border-width:${MCRAFT_SCROLLBAR_TEX.cap}px 0;`
      + `border-image-source:url(${MCRAFT_SCROLLBAR_TEX.handle});`
      + `border-image-slice:${MCRAFT_SCROLLBAR_TEX.cap} 0 fill; border-image-repeat:stretch;`
      + `border-image-width:${MCRAFT_SCROLLBAR_TEX.cap}px 0; background:#fff;`;
    // 柄悬停/拖拽 α(:117-123 isDragging||isHoveringOverHandle)——监听在 vinvBindModernScrollbar
    handle.appendChild(handleFace);
    sbar.appendChild(sbarFace);
    sbar.appendChild(handle);
    panel.appendChild(sbar);
    this.vinvModernScrollbarEl = sbar;
    this.vinvModernScrollHandle = handle;
    this.vinvBindModernScrollbar(sbar, handle);
    // ---- ★刀19:向导槽+文案(DrawChildren NewCraftingUI.cs:441-458;win 相对:
    //      槽=detailOrigin+(0,58)=(24,131) ctx7 scale1/文案=+(52,73)=(76,146)/
    //      环境需求=+(52,36)=(76,109);仅向导态+窗开可见) ----
    const gSlot = el('div', 'sw-slot');
    // ★FX43:ctx7 = 缺省臂 Inventory_Back × Main.inventoryBack = White×0.7490196
    //  (NewCraftingUI.cs:566 覆写;ItemSlot.cs :2127 缺省 color2)——半透 0.749 + 原色
    //  (预乘补偿后 rgb 恒等);旧面无 α 全实底
    gSlot.style.cssText = 'position:absolute; left:24px; top:131px; width:52px; height:52px;'
      + 'background-image:none; pointer-events:auto;'
      + `--slot-bgimg:url(${MCRAFT_GUIDE_TEX}); --slot-tint:rgb(255,255,255);`
      + `--slot-alpha:${MCRAFT_SLOT_HL_ALPHA};`;
    gSlot.addEventListener('contextmenu', (e) => e.preventDefault());
    // ★S4：悬停 tooltip（同 classic 覆层面——三面槽实例同一原版 ctx7 面）
    gSlot.addEventListener('mouseenter', () => this.refreshGuideSlotTooltip(gSlot));
    gSlot.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
    });
    gSlot.addEventListener('mousedown', (e) => {
      this.guideSlotMouseDown(e as MouseEvent, () => {
        this.vinvPaintGuideCraft(); this.vinvRefreshCraft();
        this.refreshGuideSlotTooltip(gSlot);
      });
    });
    win.appendChild(gSlot);
    this.vinvGuideSlotModernEl = gSlot;
    const gTxt = el('div', 'vinv-txt');
    gTxt.style.cssText += 'position:absolute; left:76px; top:146px; font-size:14px;';
    win.appendChild(gTxt);
    this.vinvGuideModernCaptionEl = gTxt;
    const gReq = el('div', 'vinv-txt');
    gReq.style.cssText += 'position:absolute; left:76px; top:109px; font-size:14px; color:#c8c8c8;';
    win.appendChild(gReq);
    this.vinvGuideModernReqEl = gReq;
    // ---- 详情浮层(DrawChildren :440-487;origin = 面板+(24,73) = craftDetailLayout) ----
    const detail = el('div');
    detail.style.cssText = 'position:absolute; pointer-events:none; display:none;';
    win.appendChild(detail);
    this.vinvModernDetailEl = detail;
    this.vinvLayoutItems.push({ el: detail, pos: () => {
      if (!this.vinvModernCraftOpen) return null;
      const o = mcraftDetailOrigin();
      return { x: o.origin.x - 20, y: o.origin.y - 312 };
    } });
    // ★刀19:窗内向导件显隐(InGuideCraftMenu ∧ NewCraftingUI.Visible;:441 在
    //   DrawChildren=窗子级,窗关随窗隐藏,此处双门=显式)
    this.vinvLayoutItems.push({ el: gSlot, pos: () => this.vinvGuideMenuOpen && this.vinvModernCraftOpen ? { x: 24, y: 131 } : null });
    this.vinvLayoutItems.push({ el: gTxt, pos: () => this.vinvGuideMenuOpen && this.vinvModernCraftOpen ? { x: 76, y: 146 } : null });
    this.vinvLayoutItems.push({ el: gReq, pos: () => this.vinvGuideMenuOpen && this.vinvModernCraftOpen ? { x: 76, y: 109 } : null });
  }

  /** 筛选钮帧同步(UpdateVisuals :103-114:frameX=激活、frameY=激活×2+悬停、图标半透)。
   *  ★tab 面 = 首个 div(帧 sprite);icon = img(半透)——两者取子元素分治 */
  private vinvSyncModernFilterBtn(i: number): void {
    const b = this.vinvModernFilterBtns[i];
    if (!b) return;
    const tab = b.querySelector('div');
    if (!tab) return;
    const fb = MCRAFT_ALL_BUTTONS[i]!;
    const { fx, fy } = mcraftTabFrame(this.vinvModernActive.includes(fb.kind), this.vinvModernFilterHovers[i] ?? false);
    tab.style.backgroundImage = `url(sprites/vanilla-ui/UI_Creative_Infinite_Tabs_B_2.png)`;
    tab.style.backgroundSize = `${MCRAFT_TAB_TEX.w}px ${MCRAFT_TAB_TEX.h}px`;
    tab.style.backgroundPosition = `-${fx * MCRAFT_TAB_TEX.fw}px -${fy * MCRAFT_TAB_TEX.fh}px`;
    const icon = b.querySelector('img');
    if (icon) icon.style.opacity = this.vinvModernActive.includes(fb.kind) ? '1' : '0.5';   // White vs White*0.5
  }

  /** ResetRecipes(:575-587):条目池/lookup/滚动清;搜索域不清(仅 OnActivate/SetContents 清)。
   *  ★FX41b:选中不在此清(:575-587 无 _selectedRecipeIndex 写;清走 :619-623 lookup 空/
   *  _filter 拒两臂)——lookup 值域 = vinvModernLookup(自上次 Reset 的可用集,:604-609)。
   *  :578 _resetForGuideItem = InGuideCraftMenu ? Main.guideItem : null(每次重钉);
   *  向导槽物品变化检测消费位 = UpdateContents :596-598 */
  private vinvModernResetRecipes(): void {
    this.vinvModernEntries = [];
    this.vinvModernLookup.clear();
    this.vinvModernEntrySet.clear();   // ★SUI-P3:条目序 O(1) 查集随池清(原 some() O(N²) 面退役)
    this.vinvModernViewPos = 0;
    this.vinvModernResetForGuide = this.vinvGuideMenuOpen ? (this.guidePlaced ? this.guidePlaced.id : -1) : null;
  }
  private vinvModernResetForGuide: number | null = null;
  /** _recipeListLookup 值域镜像(自上次 ResetRecipes 的可用集;SelectedEntry 解析域) */
  private vinvModernLookup = new Set<VanillaRecipeLike>();
  /** ★SUI-P3(2026-09-18):条目池成员 O(1) 查集——UpdateContents 逐 avail 行查重
   *  旧 `entries.some(e=>e.r===row.r)` 在大池(多箱满料 2000+ 条目)每拍 O(N²);
   *  与 vinvModernEntries 严格同步(Reset/teardown/push 三写点) */
  private vinvModernEntrySet = new Set<VanillaRecipeLike>();

  /** Open(quiet, filter)(:883-905)+ OnActivate(:907-915):可见即 no-op;置滤器+
   *  openedWithoutFilter+条目池清+搜索/激活集清+预选 availableRecipe[focusRecipe]。
   *  ★BJ83(2026-09-14):CloseAll 门(:886-890)已建面子集(见体内)——旧备案
   *  「本仓无同域模态群=不建模」随刀撤;playerInventory/PipsCurrentPage=Recipes
   *  由开包链承担(本窗只在背包开态可达) */
  private vinvOpenModernCraft(filter: CraftingTileFilter | null, quiet: boolean): void {
    if (this.vinvModernCraftOpen) return;                       // :885 if (!Visible)
    // ★BJ83:Open 开臂 IngameUIWindows.CloseAll(quiet:true) 门(NewCraftingUI.cs:886-890
    //   → IngameUIWindows.cs:17-66)——!playerInventory ∨ (chest==-1 ∧ !InGuideCraftMenu)
    //   时静默收对话(talkNPC=-1 :36-43)+箱(chest=-1 :50-57);NewCraftingUI.Close(quiet)
    //   =自身开启中 no-op 不进 vinvCloseAllQuiet。本仓站点链先 openInventory 后到本门
    //   (playerInventory 恒真)→ 门收敛为第二支:对话开着右击站点=原版先收话再开窗
    //   (用户实报"对话与制作窗叠放"面)。guideMenu 支(openVanillaGuideCraft 先置位)
    //   门翻假=会话保持不收(原版同相);箱开着门翻假=箱不收(原版 :887 同相)。
    if (this.invPanel.style.display !== 'block' || (!this.openChest && !this.vinvGuideMenuOpen)) {
      this.game?.closeNpcDialog(true);
      this.closeChest();
    }
    this.vinvModernCraftOpen = true;
    this.vinvModernCraftFilter = filter;
    this.vinvModernOpenedWithoutFilter = filter === null;       // :907-909(OnActivate)
    this.vinvModernResetRecipes();                              // :911 ResetRecipes
    // :910 预选 availableRecipe[focusRecipe](OnActivate 序 = 预选后 ResetRecipes;
    //   ResetRecipes 不清选中,存活靠首拍 UpdateContents 回填 lookup)——向导态首入
    //   GetNumRecipes=0(空槽)→ lookup 空 → :619 SelectedEntry==null → 清 = 不预选,
    //   详情浮层不画(★FX41b:旧式无差别预选+陈旧选中 = 向导态多画详情浮层)
    this.vinvModernSelected = this.vinvGuideMenuOpen
      ? null
      : (this.vinvCraftAvailV[this.vinvCraftFocusV]?.r ?? null);
    this.vinvModernSearch = '';
    this.vinvModernActive = [];                                 // :912-913 ActiveFilters.Clear
    if (this.vinvModernSearchInput) {
      this.vinvModernSearchInput.value = '';
      // ★FX43:占位随开重钉(构建期 l10n 若未就绪 placeholder 落空 = 54 图空搜索条根因)
      this.vinvModernSearchInput.placeholder = Lang.text('UI.PlayerNameSlot');
    }
    this.vinvSyncGridToggle();
    this.vinvLayoutSig = '';
    this.layoutVanilla();
    this.vinvRefreshCraft();
    if (!quiet) this.game.sfx.play('menuOpen', 1);              // :900-903 Sound 10
  }

  /** Close(quiet, returnToInventory)(:866-881):PipsFastScroll 置位+OnDeactivate
   *  (:917-924 滤器/选中清)+音 11。returnToInventory=false → playerInventory=false
   *  面(本仓唯一调用域 = 关包链,由 closeInventory 承担=Quiet 支) */
  private vinvCloseModernCraft(quiet: boolean): void {
    if (!this.vinvModernCraftOpen) return;
    this.vinvModernCraftOpen = false;
    this.vinvCraftFastScroll = true;                            // :871 Main.PipsFastScroll=true
    this.vinvModernCraftFilter = null;                          // :919 OnDeactivate _filter=null
    this.vinvModernSelected = null;                             // :920 _selectedRecipeIndex=null
    this.vinvModernOpenedWithoutFilter = false;
    this.vinvSyncGridToggle();
    this.vinvLayoutSig = '';
    this.layoutVanilla();
    this.vinvRefreshCraft();
    if (!quiet) this.game.sfx.play('menuClose', 1);             // :876-879 Sound 11
  }

  /** ★BJ83(2026-09-14):IngameUIWindows.CloseAll(quiet:true) 站点开臂子面
   *  (CraftingUI.cs:153 + NewCraftingUI.cs:888-890 → IngameUIWindows.cs:17-66)——
   *  收 NewCraftingUI(quiet :63)+对话(SetTalkNPC(-1) :36-43,连带 npcChatCornerItem/
   *  npcChatText 清+shop index=0 :64)+箱(chest=-1 :50-57)。静默=CloseAll quiet 同相
   *  (closeNpcDialog(true) 不放音)。未建模域(全屏地图/ingameOptions/FancyUI/sign/
   *  hair/clothes window/TE 锚/创意菜单)与背包面(playerInventory=false,由
   *  openInventory(true) 紧随重开)不在此收=登记债(本仓无同域单点 CloseAll)。
   *  ★SW-BJ85(2026-09-15) 债①:尾接 ClearHacks 面(IngameUIWindows.cs:69 →
   *  CraftingUI.cs:141-144 _lastFilter=null)=原版 CloseAll 尾语句,紧跟 :154
   *  vinvCraftFilter=f 的开臂序——滤器置入同拍即净(净死,见 openCraftingStationFilter)。 */
  private vinvCloseAllQuiet(): void {
    this.game?.closeNpcDialog(true);
    this.closeChest();
    this.vinvCloseModernCraft(true);
    this.vinvCraftFilter = null;   // ClearHacks(:69 → CraftingUI.cs:143)
  }

  /** ★SW-BJ85(2026-09-15) 债②:IngameUIWindows.CloseAll() LOUD 支(CraftingUI.cs:151
   *  网格已开臂 :148-153 调用)——原版网格开态再右击站点=收全部建模域且对话(:33-42)/
   *  箱(:50-57)/背包(:58-65)各 PlaySound(11)=menuClose;modern 窗恒静默收
   *  (NewCraftingUI.Close(quiet:true) :63-68,走 closeInventory 内 vinvCloseModernCraft(true));
   *  ClearHacks(:69) 面不在本支——滤器清置已在臂头(:150)完成(本支不经 vinvCloseAllQuiet)。
   *  背包面=closeInventory():原版 CloseAll 只置
   *  playerInventory=false,次帧 !playerInventory 门走 DrawInterface_Resources_Buffs
   *  首行 PipsUseGrid=false(Main.cs:43940)+ClearBuffs !PipsUseGrid 支 recStart=0
   *  (Main.cs:43933-43937)——closeInventory 即时净态同相(关包链同源),heldStack
   *  归包=dropItemCheck !playerInventory 臂(Player.cs:5136)同相。对话守卫
   *  npcDialogActive ≡ talkNPC>=0(Game.ts:36253);箱守卫 openChest ≡ chest!=-1。
   *  未建模域=vinvCloseAllQuiet 登记债延续(本仓无同域单点)。 */
  private vinvCloseAllLoud(): void {
    const game = this.game;
    if (game?.npcDialogActive) game.closeNpcDialog();   // :33-42 音 11
    if (this.openChest) {                               // :50-57 音 11
      this.closeChest();
      game?.sfx.play('menuClose', 1);
    }
    game?.sfx.play('menuClose', 1);                     // :58-65 playerInventory 音 11(网格臂 invOpen 恒真)
    this.closeInventory();                              // playerInventory=false+次帧净态(Main.cs:43912-43941)
    this.vinvRefreshCraft();
  }

  /** ToggleInInventory(:926-936) */
  private vinvToggleModernCraft(quiet: boolean): void {
    if (this.vinvModernCraftOpen) this.vinvCloseModernCraft(quiet);
    else this.vinvOpenModernCraft(null, quiet);
  }

  /** OpenCloseFilter 执行器(:938-964 四支)。modern 支消费点
   *  = InteractWithCraftingStation(Player.cs:33555-33557) → openCraftingStationFilter。
   *  ★RB29b F1(2026-09-15):向导支 :946-951 补齐(旧「本仓无域」定谳被红队推翻——
   *  向导态 modern 窗开着右键合成站同样落本臂 setFilter 支) */
  vinvOpenCloseModernCraftFilter(f: CraftingTileFilter): void {
    const t = openCloseFilterTransition(
      { visible: this.vinvModernCraftOpen, filter: this.vinvModernCraftFilter, openedWithoutFilter: this.vinvModernOpenedWithoutFilter },
      f,
    );
    switch (t) {
      case 'open':
        this.vinvOpenModernCraft(f, false);                     // Open(quiet:false, filter) :942
        break;
      case 'setFilter':                                         // :952-953 Sound 12 + SetFilter
        // 向导支(:946-951):SetTalkNPC(-1)→InGuideCraftMenu=false→dropItemCheck——
        // 同拍同步完成,不落 vinvGuideMenuExitCheck 逐拍退出臂(原版同相:窗保持开+滤新
        // 滤器,Next 拍退出检查见旗已摘 no-op)。窗口不关(原版 :953 SetFilter 续走)。
        if (this.vinvGuideMenuOpen) {                           // :946 if (Main.InGuideCraftMenu)
          this.game.closeNpcDialog(true);                       // SetTalkNPC(-1) :948(静默;IngameUIWindows 同相映射)
          this.vinvGuideMenuOpen = false;                       // InGuideCraftMenu=false :949
          this.vinvReturnGuidePlaced();                         // dropItemCheck :950 → guideItem 支 GetOrDrop(:5110-5114)
          this.vinvLayoutSig = '';                              // 向导槽/文案/需求行隐+钮锚回位 → 强制重排
          this.layoutVanilla();
        }
        this.game.sfx.play('menuTick', 1);                      // :952 Sound 12
        this.vinvModernCraftFilter = f;                         // :953 SetFilter → ResetRecipes
        this.vinvModernOpenedWithoutFilter = false;
        this.vinvModernResetRecipes();
        this.vinvUpdateModernCraft();
        break;
      case 'clearFilter':                                       // :957-958 Sound 12 + SetFilter(null)
        this.game.sfx.play('menuTick', 1);
        this.vinvModernCraftFilter = null;
        this.vinvModernResetRecipes();
        this.vinvUpdateModernCraft();
        break;
      case 'close':                                             // :962 Close(returnToInventory:true)
        this.vinvCloseModernCraft(false);
        break;
    }
  }

  /** 窗内滚动条绑定(UIScrollbar.cs:103-151 拖拽/点轨/进柄音 1:1)。★RB29b F4:轨/柄
   *  DOM 盒 = 元素矩形/柄矩形本体,mousedown 域天然 = 原版 Contains 域(无 JS 收口)。
   *  ★RB29b F5:window mousemove/mouseup 监听存实例字段,teardown 对称摘除
   *  (vinvGridWheelHandler 同式)——旧匿名闭包随重建逐次滞留 window */
  private vinvBindModernScrollbar(sbar: HTMLElement, handle: HTMLElement): void {
    this.vinvUnbindModernScrollbar();                            // 防御:重挂前先摘旧
    let dragging = false;
    let dragYOffset = 0;
    let hovering = false;
    let hoverSounded = false;   // :116-121 isHoveringOverHandle 沿触发;拖拽中不重播(RB29b F3 判)
    const myOf = (e: MouseEvent): number => e.clientY / this.vinvModernScaleK();
    // 柄色 = White*(拖拽|悬停 ? 1 : 0.85)(:123)——enter/leave 即 isHoveringOverHandle 域
    handle.addEventListener('mouseenter', (e) => {
      hovering = true;
      (e.currentTarget as HTMLElement).style.opacity = '1';
      if (!hoverSounded) {
        hoverSounded = true;
        if (!dragging) this.game.sfx.play('menuTick', 1);        // ★RB29b F3:进柄 Sound 12(:118-121)
      }
    });
    handle.addEventListener('mouseleave', (e) => {
      hovering = false;
      hoverSounded = false;
      if (!dragging) (e.currentTarget as HTMLElement).style.opacity = `${MCRAFT_SCROLLBAR_HANDLE_ALPHA}`;
    });
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const g = this.vinvModernGridGeometry();
      if (!g) return;
      dragging = true;
      (e.currentTarget as HTMLElement).style.opacity = '1';                                // :123 拖拽 α 1
      // _dragYOffset = mouseY − handleRect.Y(:146-148;handleRect.Y = sbarY + 5 +
      //   innerH·(pos/max) − 3,即 GetHandleRectangle :78-84 屏位)
      const handleRectY = g.scrollbar.y + 5 + Math.trunc(g.scrollbar.innerH * (this.vinvModernViewPos / Math.max(1, g.contentH))) - 3;
      dragYOffset = myOf(e) - handleRectY;
      // ★RB29b F3 含鼠标拍:柄随滚动走到静鼠下无 enter 事件(原版逐帧 Contains 会响),
      //   压下即视为进柄补一响(已在柄上悬停过则不重播)
      if (!hoverSounded) { hoverSounded = true; this.game.sfx.play('menuTick', 1); }
    });
    this.vinvModernSbarWinMove = (e) => {
      if (!dragging) return;
      const g = this.vinvModernGridGeometry();
      if (!g) return;
      const num = myOf(e) - g.scrollbar.innerY - dragYOffset;    // :111-115
      this.vinvModernViewPos = clampViewPosition(num / g.scrollbar.innerH * g.contentH, g.list.h, g.contentH);
      this.vinvSyncModernScroll();
    };
    this.vinvModernSbarWinUp = () => {
      if (dragging) handle.style.opacity = hovering ? '1' : `${MCRAFT_SCROLLBAR_HANDLE_ALPHA}`;   // :123 松手仍在柄上=悬停 1
      dragging = false;
    };
    window.addEventListener('mousemove', this.vinvModernSbarWinMove);
    window.addEventListener('mouseup', this.vinvModernSbarWinUp);
    sbar.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (dragging) return;
      // 点轨支(:151-159):num = mouseY − innerY − handleH/2——handleH = GetHandleRectangle
      //   高(柄矩形本体;★RB29b F4:柄盒 = 柄矩形本体,盖带点击落轨盒不再入柄支)
      const g = this.vinvModernGridGeometry();
      if (!g) return;
      const handleH = Math.trunc(g.scrollbar.innerH * (g.list.h / Math.max(1, g.contentH))) + 7;
      const num = myOf(e) - g.scrollbar.innerY - handleH / 2;
      this.vinvModernViewPos = clampViewPosition(num / g.scrollbar.innerH * g.contentH, g.list.h, g.contentH);
      this.vinvSyncModernScroll();
    });
    sbar.addEventListener('wheel', (e) => {
      e.stopPropagation();
      this.vinvModernScrollBy(e);
    }, { passive: true });
  }

  /** ★RB29b F5:window 级滚动条拖拽监听对称摘除(构建重挂/teardown 共用单点) */
  private vinvUnbindModernScrollbar(): void {
    if (this.vinvModernSbarWinMove) {
      window.removeEventListener('mousemove', this.vinvModernSbarWinMove);
      this.vinvModernSbarWinMove = null;
    }
    if (this.vinvModernSbarWinUp) {
      window.removeEventListener('mouseup', this.vinvModernSbarWinUp);
      this.vinvModernSbarWinUp = null;
    }
  }

  private vinvModernScaleK(): number {
    return vanillaScaleFor(window.innerWidth, window.innerHeight, options.data.uiScale);
  }

  /** UIList.ScrollWheel(UIList.cs:109-115):ViewPosition −= ScrollWheelDeltaForUI
   *  (±120/notch,PlayerInput.cs:902;XNA 上滚为正 = 浏览器 deltaY 取负)
   *  ★FX43b(2026-09-16 用户实报「modern 窗滚很远才动」):余数累计器(RB14d/FX51 同款
   *  vinvCraftWheelPendPx/_wheelPxCarry 三面同构)——Chrome ±100px/notch 重映射下逐事件
   *  trunc(−100/120)=0 整类吞零;原版 ScrollWheelValue 跨事件累计(PlayerInput.cs:1407)
   *  帧差分量化(:901-902)= 先累计再 /120、整档消费余数留置。 */
  private vinvModernScrollBy(e: WheelEvent): void {
    // ★BJ103 失焦旁支同律（元素级宿主 :8513/:8769——modern 窗随背包,失焦暂停期
    //   原版 :17316 return 同截断 :17549 宿主,滚轮死;autoPause 暂停期保持活面）
    if (this.game?.focusPaused) return;
    e.stopPropagation();   // 窗口级 vinvGridWheelTick 不得二次入账(窗开其 flag 支本跳过,防御+防未来宿主双计)
    const g = this.vinvModernGridGeometry();
    if (!g || g.contentH <= g.list.h) return;
    this.vinvModernWheelPendPx += wheelEventPx(e.deltaY, e.deltaMode);   // deltaMode 归一(RB14d 单源)
    const notches = vanillaWheelNotches(this.vinvModernWheelPendPx);     // Main.cs:17593(取负=浏览器同手势)
    if (notches === 0) return;                           // 子档拍:ScrollWheelDeltaForUI=0 零位移(余数留置)
    this.vinvModernWheelPendPx += notches * 120;         // 消费整档,余数留累计器
    this.vinvModernViewPos = clampViewPosition(
      this.vinvModernViewPos - notches * 120, g.list.h, g.contentH,
    );
    this.vinvSyncModernScroll();
  }
  /** modern 窗滚轮 px 余数累计器(RB14d/FX51 同款;跨事件留置,面板重建清零) */
  private vinvModernWheelPendPx = 0;

  private vinvModernGridGeometry(): ReturnType<typeof mcraftGridGeometry> | null {
    const c = this.vinvLayoutCtx;
    if (!c || !this.vinvModernGridList) return null;
    return mcraftGridGeometry(c.sh, Math.max(1, this.vinvModernEntries.length), this.vinvGuideMenuOpen);
  }

  /** 滚动条/内容位移同步(UIScrollbar.GetHandleRectangle :78-84) */
  private vinvSyncModernScroll(): void {
    const g = this.vinvModernGridGeometry();
    if (!g || !this.vinvModernGridInner || !this.vinvModernScrollHandle) return;
    this.vinvModernGridInner.style.transform = `translateY(${-this.vinvModernViewPos}px)`;
    this.vinvEnsureModernCells();   // ★SUI-P2:滚动窗随移,新暴露格按需物化(重建/滚轮/拖柄同面)
    const canScroll = g.contentH > g.list.h;                    // CanScroll :49(AutoHide :105)
    this.vinvModernScrollbarEl!.style.display = canScroll ? '' : 'none';
    if (!canScroll) return;
    // GetHandleRectangle(:78-84):Y = innerY + innerH·(pos/max) − 3;H = innerH·(view/max) + 7
    //   ——★FX41b:柄矩形照录(不设最小高钳:原版 +7 下限自带)。★RB29b F4:DOM 盒 =
    //   柄矩形本体(命中/悬停域 1:1),DrawBar 盖 ±6 越界由内层 face 绘制(构建面 cssText);
    //   子盒含块 = sbar padding 盒(=元素矩形,盒无边框) → top = 柄矩形Y−sbar.y
    //   = (innerY−3+sbar.y)−sbar.y = 5−3+off = off+2。
    const maxV = Math.max(1, g.contentH);
    const handleH = Math.trunc(g.scrollbar.innerH * (g.list.h / maxV)) + 7;
    const handleY = Math.trunc(g.scrollbar.innerH * (this.vinvModernViewPos / maxV)) + 2;
    this.vinvModernScrollHandle.style.height = `${handleH}px`;
    this.vinvModernScrollHandle.style.top = `${handleY}px`;
  }

  /** 窗内网格条目构建(UpdateContents :589-634 + ItemGrid.DrawSlot :56-76)。
   *  条目 = availableRecipe(可用集)过滤 FitsFilter(搜索+激活类)∧站点滤器 Accepts;
   *  累计条目池保留曾可用件(ResetRecipes 前不散)——重置拍重建。 */
  private vinvUpdateModernCraft(): void {
    const game = this.game;
    const win = this.vinvModernCraftEl;
    const c = this.vinvLayoutCtx;
    if (!game || !win || !c) return;
    win.style.height = `${c.sh + MCRAFT_STATE_H_OFF}px`;        // Height = −350×100%(:307)
    const panel = mcraftPanelRect(c.sh);
    if (this.vinvModernPanelEl) {
      this.vinvModernPanelEl.style.top = '38px';
      this.vinvModernPanelEl.style.height = `${panel.h}px`;
    }
    // 标题(UpdateText :419-429:_filter ? GetWindowDescription : inter[25];站名空 =
    //   TileBasedRecipeFilter.GetWindowDescription 域外,回 inter[25] 与经典路径同守卫)
    if (this.vinvModernTitleEl) {
      const f = this.vinvModernCraftFilter;
      const name = f ? Lang.tileName(f.tile) : null;
      const text = f && name ? Lang.text('CombineFormat.Crafting', name) : Lang.inter(25);
      if (this.vinvModernTitleEl.textContent !== text) {
        this.vinvModernTitleEl.textContent = text;
        // ★RB28:搜索条让位随标题外宽同拍重算(:426-428 _searchBar.Width=100%−
        //   标题外宽−10 + Recalculate;DOM 实测 offsetWidth——字体度量与原版异,
        //   条随动不遮题=登记偏差);文本不变免测(零逐帧 reflow)
        if (this.vinvModernSearchRowEl) {
          const sb = mcraftSearchBarRect(panel, this.vinvModernTitleEl.offsetWidth);
          this.vinvModernSearchRowEl.style.left = `${sb.x - panel.x}px`;
          this.vinvModernSearchRowEl.style.width = `${sb.w}px`;
        }
      }
      const t = mcraftTitleXY(panel);
      this.vinvModernTitleEl.style.left = `${t.x - panel.x}px`;
      this.vinvModernTitleEl.style.top = `${t.y - panel.y}px`;
    }
    // 搜索域(EntryFilterer.SetSearchFilter :85-94 IsNullOrWhiteSpace→null)
    const search = normalizeSearch(this.vinvModernSearch);
    // ★FX41b(:596-598):向导态槽内物品变化 → ResetRecipes——条目池/选中/滚动全清,
    //   选中随池清 = 详情浮层不画直到点选(旧缺:跨向导物残留条目+陈旧选中多画)
    {
      const guideKey = this.guidePlaced ? this.guidePlaced.id : -1;
      if (this.vinvGuideMenuOpen && guideKey !== this.vinvModernResetForGuide) this.vinvModernResetRecipes();
    }
    // ---- 条目池增量(:596-617:availableRecipe 逐条入池,FitsFilter 过滤入 _filteredRecipes) ----
    // ★刀19:向导反查(NewCraftingUI.GetNumRecipes :256-262)——空槽=0 配方;有件=
    //   CollectGuideRecipes 集(与经典支同源,vinvRefreshCraft 的 vinvCraftAvailV 已带,
    //   但本窗每拍自取 avail=独立接入)
    let avail: Array<{ r: VanillaRecipeLike; count: number }>;
    if (this.vinvGuideMenuOpen) {
      avail = this.guidePlaced
        ? (() => {
          const vid = this.vidOfItemOf(this.guidePlaced!.id);
          return VANILLA_RECIPES.filter((r) => r.items.some((req) => req.id === vid
            || (req.id >= 1000000 && (RECIPE_GROUP_ITEMS[String(req.id - 1000000)] ?? []).includes(vid))))
            .map((r) => ({ r, count: 0 }));
        })()
        : [];                                       // GetNumRecipes=0(:257-261)
    } else {
      avail = game.vanillaAvailableRecipes();
    }
    for (const row of avail) {
      // :604-609 lookup 回填 = 可用集全量(FitsFilter 判定前;SelectedEntry 解析域)
      if (!this.vinvModernLookup.has(row.r)) this.vinvModernLookup.add(row.r);
      // ★SUI-P3:查重走 O(1) 集(旧 entries.some() 大池每拍 O(N²)=窗开 hitch 面之一)
      if (this.vinvModernEntrySet.has(row.r)) continue;
      if (!this.vinvModernRecipeFits(row.r, search, this.vinvModernActive)) continue;
      this.vinvModernEntries.push({ r: row.r, count: row.count, seen: true });
      this.vinvModernEntrySet.add(row.r);
    }
    // 选中同步(:618-629)——★FX41b:SelectedEntry = _recipeListLookup[idx](可用集键控,
    //   ResetRecipes Array.Clear → 本拍回填):lookup 无此条目(向导态空槽首入/Reset 后
    //   不再可用)→ _selectedRecipeIndex=null;_filter 拒 → 清;可用 → focusRecipe 回写
    if (this.vinvModernSelected !== null) {
      if (!this.vinvModernLookup.has(this.vinvModernSelected)) this.vinvModernSelected = null;   // :619-620
      else if (this.vinvModernCraftFilter !== null && !recipeFilterAccepts(this.vinvModernSelected, this.vinvModernCraftFilter)) this.vinvModernSelected = null;   // :621-623
      else {
        const idx = avail.findIndex((row) => row.r === this.vinvModernSelected);
        if (idx >= 0 && this.vinvCraftFocusV !== idx) {
          this.vinvCraftFocusGoto(idx);                        // :626-629 focusRecipe 双向回写
          this.vinvUpdateCraftList();
        }
      }
    }
    // ---- 几何/格池 ----
    const g = mcraftGridGeometry(c.sh, Math.max(1, this.vinvModernEntries.length), this.vinvGuideMenuOpen);
    const list = this.vinvModernGridList!;
    list.style.left = `${g.list.x - panel.x}px`;
    list.style.top = `${g.list.y - panel.y}px`;
    list.style.width = `${g.list.w}px`;
    list.style.height = `${g.list.h}px`;
    if (this.vinvModernSeparatorEl) {
      this.vinvModernSeparatorEl.style.left = `${g.separator.x - panel.x}px`;
      this.vinvModernSeparatorEl.style.top = `${g.separator.y - panel.y}px`;
      this.vinvModernSeparatorEl.style.width = `${g.separator.w}px`;
    }
    if (this.vinvModernScrollbarEl) {
      // ★RB29b F4(2026-09-15):轨 DOM 盒 = 元素矩形本体(命中域 1:1)——DrawBar(:96-101)
      //   盖 6px 越界 ±6 绘制由内层 face(top:−cap/height:+2cap)承担,盒定位/高度不再扩张
      this.vinvModernScrollbarEl.style.left = `${g.scrollbar.x - panel.x}px`;
      this.vinvModernScrollbarEl.style.top = `${g.scrollbar.y - panel.y}px`;
      this.vinvModernScrollbarEl.style.height = `${g.scrollbar.h}px`;
    }
    this.vinvModernViewPos = clampViewPosition(this.vinvModernViewPos, g.list.h, Math.max(g.contentH, g.list.h));
    // 格池重建(签名:条目集+选中+可用集+几何)——★SUI-P2:重建=拆池;DOM 格由
    // vinvEnsureModernCells 按【滚动视窗】物化(原版 ItemGrid.DrawSlot 只绘列表交叠格)
    const availKeys = avail.map((row) => row.r.create).join(',');
    const sig = this.vinvModernEntries.map((e) => e.r.create).join(',')
      + `|${this.vinvModernSelected ? this.vinvModernSelected.create : ''}|${g.cols}x${g.rows}|${availKeys}`;
    this.vinvModernAvailNow = new Set(avail.map((row) => row.r));
    if (sig !== this.vinvModernCellsSig) {
      this.vinvModernCellsSig = sig;
      this.vinvRebuildModernCells(g);
    }
    this.vinvSyncModernScroll();
    this.vinvUpdateModernDetail(avail);
    // ★FX41b:向导槽文案/需求行随拍(原版 :447/:452-456 逐帧绘制域)——点选/条目变化同拍
    //   刷新(旧缺:只挂 vinvRefreshCraft,点选后需求行滞留空串至下一刷新拍)
    if (this.vinvGuideMenuOpen) this.vinvPaintGuideCraft();
  }
  private vinvModernCellsSig = '';

  /** 单条目 Fit(UpdateContents :610 FitsFilter → EntryFilterer.FitsFilter(产物)+
   *  _filter.Accepts(配方) :636-647)。★SUI-P5(2026-09-18):tooltip 行【按需】填充
   *  ——EntryFilterer.FitsFilter(:30-55)在 search=null∧激活集空时两门短路全过,
   *  不读 tooltip 行(vanilla 侧 BySearch/ItemFilters 同样只在对应滤器激活时才
   *  构建/读取行文本);旧式无差别 vinvFillTooltipLines = 首开窗 767 件逐件
   *  buildTooltipBody ~13ms(探针 _uipanel-hitch-census seg4 定谳:搜索/激活类
   *  未启用时的纯开销面)。结果集零差:两门未激活时判定恒真,行文本惰性后内容同。 */
  private vinvModernRecipeFits(
    r: VanillaRecipeLike, search: string | null, active: readonly FilterKind[],
  ): boolean {
    const vid = r.create;
    const it = filterItemOfVid(vid);
    if (search !== null || active.length > 0) {
      if (search !== null && it.tooltipLines.length === 0) {
        // ★S4：世界态/任务鱼随语料注入（Plantera 诅咒首行特例 + 任务鱼行,见
        //  vinvFillTooltipLines 头注——BySearch 语料 = GetLinesInfo 全量,两态都是
        //  原版语料的组成行）
        vinvFillTooltipLines(it, !!this.game?.world?.flags?.['downed_262'], this.game?.anglerQuestItemId?.() ?? 0);
      }
      if (!filtererFits(search, active, it)) return false;
    }
    if (this.vinvModernCraftFilter !== null && !recipeFilterAccepts(r, this.vinvModernCraftFilter)) return false;
    return true;
  }

  /** 格池重建(签名:条目集+选中+可用集+几何)→ ★SUI-P2 惰性池(2026-09-18):本函数
   *  只拆池+定内容高;DOM 格由 vinvEnsureModernCells 按【滚动视窗】按需物化——
   *  原版 ItemGrid 只绘列表交叠槽(UpdateContents DrawSlot :56-76),窗外格不绘
   *  =不物化像素零差;曾物化窗外格 display:none 驻留复用。多箱满料 767+ 条目
   *  旧全量物化=开窗帧 8ms JS+数千节点 style/layout 风暴(探针 seg4/5 定谳)。 */
  private vinvRebuildModernCells(g: ReturnType<typeof mcraftGridGeometry>): void {
    const inner = this.vinvModernGridInner;
    if (!inner) return;
    inner.replaceChildren();
    this.vinvModernCellEls = new Array(this.vinvModernEntries.length).fill(null);
    inner.style.height = `${Math.max(g.contentH, g.list.h)}px`;
  }

  /** 单格物化(SUI-P2:原 vinvRebuildModernCells 循环体原样迁入——DOM 结构/选中金框/
   *  置灰/监听逐式同,仅物化时点=首次进入滚动视窗;池柄=vinvModernCellEls[idx]) */
  private vinvEnsureModernCell(
    idx: number, g: ReturnType<typeof mcraftGridGeometry>, availNow: ReadonlySet<VanillaRecipeLike>,
  ): void {
    const inner = this.vinvModernGridInner;
    if (!inner || !this.game) return;
    const e = this.vinvModernEntries[idx]!;
    const pos = mcraftCellXY(g, idx);
    const slotEl = el('div', 'sw-slot');   // ★变量名 slotEl:classic「cell 不绑 wheel」反向锚不扰
    // ★FX43:槽底 = ItemSlot ctx41 链(InventoryBack18 × (10,58,74)@162;:2250-2253)——
    //  旧面经典 Inventory_Back×220 = 白框方角实底伪影;--slot-tint 已含预乘补偿
    slotEl.style.cssText = `position:absolute; left:${pos.x - g.list.x}px; top:${pos.y - g.list.y}px;`
      + 'width:52px; height:52px; background-image:none; transform-origin:top left;'
      + `--slot-bgimg:url(${MCRAFT_SLOT_TEX}); --slot-tint:${MCRAFT_SLOT_TINT_CSS};`
      + `--slot-alpha:${MCRAFT_SLOT_ALPHA};`
      + `transform:scale(${MCRAFT_CELL_SCALE}); pointer-events:auto;`;
    const iid = this.game.itemId(vanillaItemKey(e.r.create) ?? '');
    // 选中金框(ItemSlot.cs :2355-2357:ctx41∧DrawSelectionHighlightForGridSlot →
    //  InventoryBack24 × Main.inventoryBack(White×0.7490196);绘序在物品图标之前)
    if (this.vinvModernSelected === e.r) {
      const ring = el('div', 'sw-mcsel');
      slotEl.appendChild(ring);
    }
    const img = el('img') as HTMLImageElement;
    img.draggable = false;
    img.src = iconUrl(this.game, iid);
    slotEl.appendChild(img);
    if (e.r.createStack > 1) slotEl.appendChild(el('span', 'cnt', String(e.r.createStack)));
    if (!availNow.has(e.r)) {
      // 不可用槽(ItemGrid.DrawSlot :75 DisabledSlotColor (160,160,160))
      img.style.filter = `grayscale(1) brightness(${MCRAFT_DISABLED_GRAY})`;
      slotEl.dataset.unavail = '1';
    }
    this.vinvBindModernCell(slotEl, e.r, availNow.has(e.r));
    inner.appendChild(slotEl);
    this.vinvModernCellEls[idx] = { el: slotEl, r: e.r };
  }

  /** 视窗物化(SUI-P2 消费面;vinvUpdateModernCraft 尾+vinvSyncModernScroll 每拍):
   *  窗口 = [viewPos−格步, viewPos+list.h+格步](上下各一格余量覆盖半裁格);
   *  窗内缺格物化/驻留格复位显隐,窗外驻留格 display:none。 */
  private vinvEnsureModernCells(): void {
    const inner = this.vinvModernGridInner;
    const g = this.vinvModernGridGeometry();
    const availNow = this.vinvModernAvailNow;
    if (!inner || !g || !availNow) return;
    const viewTop = this.vinvModernViewPos - 44;   // 格步距 44(mcraftCellXY)
    const viewBot = this.vinvModernViewPos + g.list.h + 44;
    for (let i = 0; i < this.vinvModernCellEls.length; i++) {
      const pos = mcraftCellXY(g, i);
      const offTop = pos.y - g.list.y;   // inner 内容系 y(=translateY 前域)
      const visible = offTop + 44 > viewTop && offTop < viewBot;
      const handle = this.vinvModernCellEls[i];
      if (!visible) {
        if (handle && handle.el.style.display !== 'none') handle.el.style.display = 'none';
        continue;
      }
      if (!handle) this.vinvEnsureModernCell(i, g, availNow);
      const elNow = this.vinvModernCellEls[i]!.el;
      if (elNow.style.display !== '') elNow.style.display = '';
    }
  }

  /** 格交互(HandleCraftSlot :503-532):未选/不可用=点选(音12);已选且可用=
   *  HoverOverCraftingItemButton(focusRecipe) 合成链(:526);不可用=材料不足行 tooltip
   *  (AddTooltipLines :545-553)。stackSplit/重复合成拍面 = vanillaCraft 内接。
   *  ★变量名 slotEl:classic 网格域「cell 不绑 wheel」反向锚(FX30/RB13b)不受扰——
   *  本域格面绑 wheel 是窗列表滚动(UIList.cs:109-115),非 classic 分页面 */
  private vinvBindModernCell(slotEl: HTMLElement, r: VanillaRecipeLike, availNow: boolean): void {
    slotEl.addEventListener('mouseenter', (e) => {
      const iid = this.game.itemId(vanillaItemKey(r.create) ?? '');
      if (iid > 0) {
        this.showTooltipFor(iid, 'inv', { slot: { id: iid, stack: r.createStack }, anchor: (e.currentTarget as HTMLElement) });
        if (!availNow) {
          const line = document.createElement('div');
          line.style.color = MCRAFT_MISSING_COLOR;
          line.textContent = Lang.text(MCRAFT_MISSING_KEY);
          this.tooltip.appendChild(line);
        }
      }
    });
    slotEl.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
    });
    slotEl.addEventListener('wheel', (e) => this.vinvModernScrollBy(e), { passive: true });   // 同 vinvCraftWheel passive 化判(vinvModernScrollBy 无 preventDefault,滚动=translateY 自管)
    slotEl.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      const selected = this.vinvModernSelected === r;
      if (!availNow || !selected) {                       // :506-522 选中队
        this.vinvModernSelected = r;
        this.game.sfx.play('menuTick', 1);                // :520 Sound 12
        this.vinvUpdateModernCraft();
        return;
      }
      // :524-527 else 支 = Main.HoverOverCraftingItemButton(Main.focusRecipe) 合成
      //   (Main.cs:42971-43036:焦点即配方→CraftItem;Shift×10 = num2·10 :43011-43013)
      //   ★FX41b::42988 `focusRecipe == recipeIndex && guideItem.IsAir` 门——向导态
      //   (反查)已选格点按不合成,落 :43020 else-if(flag) 臂 = 仅音 12(与详情槽
      //   guidePlaced 门同源;旧缺 = 反查态点格直接开炉)
      if (this.guidePlaced) { this.game.sfx.play('menuTick', 1); return; }
      // ★SW-BJ391：压拍合成+长按臂上膛（HandleCraftSlot :526 → HoverOverCraftingItemButton）
      this.craftPressTick(r, (ev as MouseEvent).shiftKey, slotEl, 'mcell');
      this.refreshAll();
    });
    // ★SW-BJ391 长按臂格池重建换锚（池格驻留不重建,唯池拆建走本行;认 kind 防
    //   同配方详情槽 flip 锚）
    if (this.craftHold?.kind === 'mcell' && this.craftHold.r === r) this.craftHold.el = slotEl;
  }

  /** 详情浮层(DrawChildren :450-487):hover ?? Selected;成品槽 ctx42(scale1,
   *  底 White*0.749 :566)/锤图标 +(47,13) scale0.8/材料行 34·num 步距+拥有数
   *  (DrawOwnedItemCount :555-561)/向导槽 ctx7 = 本仓无 InGuideCraftMenu 域(备案)。
   *  ★FX41b(2026-09-15 用户实报向导态叠压):子件坐标 = detail 容器【相对】系——
   *  容器由 vinvLayoutItems 定位在 origin−state=(24,73),旧式子件再写 win 绝对值
   *  (origin.x−20 等)= 双重 +24/+73 偏移,整块压到向导槽行/网格首行上 */
  private vinvUpdateModernDetail(avail: Array<{ r: VanillaRecipeLike; count: number }>): void {
    const detail = this.vinvModernDetailEl;
    if (!detail || !this.game) return;
    // hover 优先(:451 _hoveredEntry ?? SelectedEntry)——DOM hover 由 CSS :hover 承担,
    //   此处重建 = 选中态拍面(hover tooltip 逐帧面不合事件驱动;登记偏差)
    const r = this.vinvModernSelected;
    if (!r) { detail.style.display = 'none'; detail.replaceChildren(); return; }
    detail.style.display = '';
    detail.replaceChildren();
    const availNow = avail.some((row) => row.r === r);
    // 成品槽(ctx 42 = InventoryBack18 × (10,58,74)@162,同网格格;:2253-2260;
    //  ★FX43 旧面 --slot-alpha:0.749 误挂 DrawRecipeSlot 的 Main.inventoryBack 覆写——
    //  该覆写只喂 ctx7/缺省臂与金框,ctx42/43 在 ItemSlot switch 内整体改写 color2)
    const slot = el('div', 'sw-slot');
    slot.style.cssText = 'position:absolute; left:0; top:0;'
      + 'width:52px; height:52px; background-image:none; pointer-events:auto;'
      + `--slot-bgimg:url(${MCRAFT_SLOT_TEX}); --slot-tint:${MCRAFT_SLOT_TINT_CSS};`
      + `--slot-alpha:${MCRAFT_SLOT_ALPHA};`;
    const iid = this.game.itemId(vanillaItemKey(r.create) ?? '');
    const img = el('img') as HTMLImageElement;
    img.draggable = false;
    img.src = iconUrl(this.game, iid);
    if (!availNow && !this.vinvGuideMenuOpen) img.style.filter = `grayscale(1) brightness(${MCRAFT_DISABLED_GRAY})`;
    slot.appendChild(img);
    if (r.createStack > 1) slot.appendChild(el('span', 'cnt', String(r.createStack)));
    slot.addEventListener('mouseenter', (e) => {
      if (iid > 0) this.showTooltipFor(iid, 'inv', { slot: { id: iid, stack: r.createStack }, anchor: (e.currentTarget as HTMLElement) });
    });
    slot.addEventListener('mouseleave', () => {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
    });
    slot.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      if (!availNow) return;                              // 不可用=仅 tooltip(:460 enabled:false)
      if (this.guidePlaced) return;                       // ★刀19:反查态不合成(:42988 门,HandleCraftSlot → HoverOverCraftingItemButton 同路)
      // ★SW-BJ391：压拍合成+长按臂上膛（成品槽压拍=SW 增益面,与网格格同链）
      this.craftPressTick(r, (ev as MouseEvent).shiftKey, slot, 'mdetail');
      this.refreshAll();
    });
    // ★SW-BJ391 长按臂详情每刷重建换锚（detail 每刷 replaceChildren,锚随行销亡;
    //   认 kind 防同配方网格格 flip 锚）
    if (this.craftHold?.kind === 'mdetail' && this.craftHold.r === r) this.craftHold.el = slot;
    detail.appendChild(slot);
    // 锤图标(:464 Images/UI/Craft ×0.8 @origin+(47,13))
    const hammer = el('img') as HTMLImageElement;
    hammer.draggable = false;
    hammer.src = 'sprites/vanilla-ui/UI_Craft.png';
    hammer.style.cssText = 'position:absolute; left:47px; top:13px;'
      + 'width:20.8px; height:19.2px; image-rendering:pixelated; pointer-events:none;';
    detail.appendChild(hammer);
    // 材料行(:465-486)——mcraftMaterialPos 以零 origin 调 = 容器相对系
    // ★SUI-P4(2026-09-18):聚合持有量表每拍一取(旧 vinvModernOwnedOf 每材料一取
    //  =逐材料全量 collectOwnedItems 箱扫;多箱面每次 detail 重建 4-8 次全箱迭代)
    const ownedAll = this.game.vanillaCraftOwned();
    r.items.forEach((req, j) => {
      const mp = mcraftMaterialPos({ x: 0, y: 0 }, j, r.items.length);
      const owned = availableItemCountFor(r, req.id, ownedAll);
      // ★刀19:向导态材料全亮(:474 InGuideCraftMenu ∨ 满足)+拥有数整支不画(:482 !InGuideCraftMenu 门)
      const enough = this.vinvGuideMenuOpen || owned >= req.stack;
      const showOwned = !this.vinvGuideMenuOpen;
      const k2 = ingredientKey(req.id);
      const box = el('div', 'sw-slot');
      const px = mp.x, py = mp.y;
      box.style.cssText = `position:absolute; left:${px}px; top:${py}px; width:52px; height:52px;`
        + 'background-image:none;'
        + `--slot-bgimg:url(${MCRAFT_SLOT_TEX}); --slot-tint:${MCRAFT_SLOT_TINT_CSS};`
        + `--slot-alpha:${MCRAFT_SLOT_ALPHA};`
        + `transform:scale(${mp.scale}); transform-origin:top left; pointer-events:auto;`;
      const mimg = el('img') as HTMLImageElement;
      mimg.draggable = false;
      mimg.src = k2 ? iconUrl(this.game, this.game.itemId(k2)) : '';
      box.appendChild(mimg);
      if (req.stack > 1) {
        const reqCnt = el('span', 'cnt', String(req.stack));
        // ★ItemSlot.cs:2683-2691 ctx43 支:vector4=(10,26+LS)+(−5,+7) = 左 5u/墨底
        //   45/52u(字顶对齐 ItemStack 字体 bearing 0 实测)——共享 .cnt = 缺省臂
        //   (bottom 0 ≈ 50u),材料槽不抬此 5u 则与拥有数带(45.7u 起)叠字
        //   (FX41b 合并后用户实报「绿白两数同位」缺的那半刀)
        reqCnt.style.left = '5px';
        reqCnt.style.bottom = '7px';
        box.appendChild(reqCnt);
      }
      // 拥有数(DrawOwnedItemCount :555-561:槽 +(3,32)·mscale,:485 mscale = num 非
      //   draw scale——★FX41b 合并遗留:旧传 mp.scale = 偏移×0.7 塌回格内 22.4px 处,
      //   正确位 32·num = 槽底缘下带,与抬格后的需求数墨底 45u 隔 0.5px 原版堆叠)
      const cnt = el('div');
      cnt.textContent = owned > 999 ? '999+' : String(owned);
      const cp = mcraftOwnedCountPos({ x: px, y: py, scale: mp.num });
      cnt.style.cssText = `position:absolute; left:${cp.x}px; top:${cp.y}px; color:${mcraftOwnedCountColor(enough)};`
        + `font-size:${Math.max(8, Math.trunc(11 * mp.scale))}px; text-shadow:1px 1px 0 #000; pointer-events:none;`
        + (showOwned ? '' : 'display:none;');
      box.addEventListener('mouseenter', (e) => {
        const miid = k2 ? this.game.itemId(k2) : -1;
        if (miid > 0) this.showTooltipFor(miid, 'inv', { slot: { id: miid, stack: req.stack }, anchor: (e.currentTarget as HTMLElement) });
      });
      box.addEventListener('mouseleave', () => {
        this.tooltip.style.display = 'none';
        cancelAnimationFrame(this.tooltipPulseRaf);
      });
      detail.appendChild(box);
      detail.appendChild(cnt);
    });
  }

  /** 经典网格视图容器(DrawRecipesGrid CraftingUI.cs:446-571,Main.cs:42449-42454
   *  PipsUseGrid ∧ InPipCrafting 门)。★列表不吃 PipsUseGrid 门(:42425-42428)=网格
   *  与列表同屏,网格是拾取器:点格 → focusRecipe + PipsUseGrid=false(:520-527)。
   *  几何/分页/钳制全走 craftingGrid.ts 纯函数单源。 */
  private vinvBuildCraftGrid(): void {
    const root = this.vinvRoot;
    if (!root) return;
    const grid = el('div');
    grid.style.cssText = 'position:absolute; pointer-events:none; z-index:3; display:none;';
    root.appendChild(grid);
    this.vinvCraftGridEl = grid;
    // ★SW-RB13b:容器 pos=网格原点(310,340)——与 vinvUpdateCraftGrid 的 left/top 双写者
    //   一致化。曾 (0,0):layoutVanilla pos 循环会把 vinvUpdateCraftGrid 写的 (310,340)
    //   冲回 (0,0)(格全体左上漂 310/340;PipsUseGrid 入签后每次切换必触发,探针实捕)
    this.vinvLayoutItems.push({ el: grid, pos: () => this.vinvPipsUseGrid ? { x: CRAFT_GRID_LEFT, y: CRAFT_GRID_TOP } : null });
    // 上/下页钮(:453-455 num10=290:num11=342/362;RecUp/RecDown 16×16,色 (200,200,200,200)
    // → opacity 0.784;可见门 = recStart>0 / recStart<avail-cols·rows :470/:501)
    const mkPage = (dir: 'up' | 'down'): HTMLButtonElement => {
      const b = el('button', 'vinv-btn') as HTMLButtonElement;
      b.style.cssText = 'width:16px; height:16px; padding:0; z-index:4; opacity:0.784; display:none;';
      const im = document.createElement('img');
      im.draggable = false;
      im.style.cssText = 'width:100%; height:100%; image-rendering:pixelated; pointer-events:none;';
      im.src = dir === 'up' ? 'sprites/vanilla/RecUp.png' : 'sprites/vanilla/RecDown.png';
      b.appendChild(im);
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const c = this.vinvLayoutCtx;
        if (!c || !this.vinvPipsUseGrid) return;
        const geo = craftGridGeometry(c.sw, c.sh);
        const avail = this.vinvCraftAvailV.length;
        if (dir === 'up') {
          if (this.vinvCraftRecStart <= 0) return;      // :470 可见门
          this.vinvCraftRecStart = craftGridRecStartAfterUp(this.vinvCraftRecStart, geo.cols);   // :476-481
        } else {
          if (this.vinvCraftRecStart >= avail - geo.cols * geo.rows) return;   // :501 可见门
          this.vinvCraftRecStart = craftGridRecStartAfterDown(this.vinvCraftRecStart, geo.cols, avail);   // :508-514
          this.game.sfx.play('menuTick', 1);            // :511 音在钳位前
        }
        this.vinvUpdateCraftGrid();
      });
      root.appendChild(b);
      this.vinvLayoutItems.push({ el: b, pos: () => {
        if (!this.vinvPipsUseGrid || !this.vinvLayoutCtx) return null;
        // ★SW-RB13b:可见门与 vinvUpdateCraftGrid 逐字同谓词(:470 recStart>0 /
        //   :501 recStart<avail-页容量)——pos 循环双写者一致化,防 relayout 把
        //   recStart 门冲掉(曾 relayout 后 recStart=0 上页钮仍现形,探针实捕)
        const avail = this.vinvCraftAvailV.length;
        const geo = craftGridGeometry(this.vinvLayoutCtx.sw, this.vinvLayoutCtx.sh);
        if (dir === 'up' ? this.vinvCraftRecStart <= 0
          : this.vinvCraftRecStart >= avail - geo.cols * geo.rows) return null;
        const p = craftGridPageBtnXY(dir);
        return { x: p.x, y: p.y };
      } });
      return b;
    };
    this.vinvCraftGridUpBtn = mkPage('up');
    this.vinvCraftGridDownBtn = mkPage('down');
  }

  /** 网格滚轮(Main.cs:17595-17633 DoScrollingInInventory):PipsUseGrid ∧ 鼠标在网格
   *  矩形 (310,340,cols·42,rows·42) 内 → 每档 ScrollCraftingGrid(CraftingUI.cs:585-602,
   *  mouseWheel<0(下滚)→recStart−=cols 无音;mouseWheel≥0(上滚)→recStart+=cols+音12
   *  ——★FX32b 勘误:旧注「下滚+=cols」写反,与原版/上滚为正档定谳相反,已正);
   *  ★★BJ189 分歧界(2026-09-20 用户拍板):同拍走的列表焦点面已反相为浏览器方向
   *  (vinvCraftWheel focusV−num)——本 Pips 网格分页面【维持原版同相】(上滚=+cols+音12,
   *  vanillaWheelNotches 号面不动)=非分歧面,分歧后同拍两面反向为刻意;若用户要 Pips
   *  同改须再批(登记 craft-wheel-direction-vanilla-carousel-second-report));
   *  ★网格支不清 flag(:17600-17608 无 flag=false)
   *  → :17629-17632 ScrollCraftingList 同拍仍走 = 网格分页与列表焦点同滚(逐字)。
   *  窗口级监听:网格容器 pointer-events:none(空档不拦世界点击,原版空档不置
   *  mouseInterface 同相),wheel 事件不经容器冒泡,故挂 window 一次(重建守卫)。 */
  /** ★BJ505 fancy 覆层面板滚轮独占域:事件 target 是否落在开启中的面板子树内。
   *  判式=closest 根类命中(与 domTargets.isDomUiTarget 同式 duck-type:
   *  typeof closest==='function' 桩语义——无 target/无 closest 的测试桩回 false
   *  =不拦,bj103 桩事件流零扰);名单=滚轮独占面(成就面板/图鉴面板根类,
   *  挂 body 顶层语境,closest 判定不依赖挂载点),后续覆层面板按需登记。
   *  ★BJ-C4-F2（2026-10-06 R4 UI 批清偿）:名单补 `.sw-itemsearch`——道具搜索浮窗
   *  强制开背包(openItemSearchPanel openInventory(true))+列表原生 overflow 滚,
   *  wheel 冒泡至 window 级本监听 → 列表轮播 bleed(与 BJ505 成就/图鉴同构缺省可达);
   *  面板登记先例 installDragListeners 两站(:2715/:3117)均已豁免 .sw-itemsearch,
   *  本门为同族第三站。 */
  private vinvWheelInFancyPanel(e: WheelEvent): boolean {
    const t = e.target as { closest?: (s: string) => unknown } | null;
    return typeof t?.closest === 'function'
      && t.closest('.sw-ach-panel, .sw-bst, .sw-itemsearch') != null;
  }

  private vinvBindGridWheel(): void {
    if (this.vinvGridWheelBound) return;
    this.vinvGridWheelBound = true;
    this.vinvGridWheelHandler = (e) => this.vinvGridWheelTick(e);
    window.addEventListener('wheel', this.vinvGridWheelHandler, { passive: true });
  }

  private vinvGridWheelTick(e: WheelEvent): void {
    // ★SW-RB13b:DoScrollingInInventory(Main.cs:17592-17640)逐字重写——调用域
    //   playerInventory(:17547)+ _builtLayout 域守卫;PipsUseGrid 支只管网格分页
    //   且【不清 flag】,flag 支(列表滚)恒走=网格外/关网格态列表照滚(:17633-17640)。
    if (!this.game || this._builtLayout !== 'vanilla') return;
    // ★BJ103（2026-09-16）失焦暂停旁支：原版 FocusHelper.UpdateFocus→Main.cs:17303-17316/
    //   1458 :17309-17322 在 CanPauseGame(:17371)【之前】return → 暂停宿主
    //   DoUpdate_WhilePaused 的 playerInventory 块(:17547-17551,autoPause 暂停期滚轮活面)
    //   失焦期整段不可达=滚轮死。本仓 applyFocusPause 置 game.focusPaused（专名;勿改用
    //   游戏全暂停态总门——rb15d H4 禁门锁:autoPause∧背包开滚轮须保持活面）。
    if (this.game.focusPaused) return;
    if (this.invPanel.style.display !== 'block') return;   // playerInventory 门(:17547)
    // ★BJ505（2026-10-04 用户实报「滚动成就/图鉴面板,左侧配方列表跟随滚动」）fancy
    //   覆层面板滚轮独占门:事件 target 落在开启中的 fancy 面板子树内 → 游戏域两支
    //   (Pips 网格分页/列表轮播)整体让路。原版锚:UserInterface.cs:219-222 滚轮只派发
    //   hover 命中链(_currentState.GetElementAt(MousePosition)→UIElement.ScrollWheel
    //   沿 Parent 冒泡,UIElement.cs:542-552),不在链上的配方列表收不到事件;
    //   IngameFancyUI.Draw 悬停面板即 mouseInterface=true(IngameFancyUI.cs
    //   IsElementUnderMouse 臂)=游戏域交互冻结 → 面板滚动区独占=用户可见语义
    //   (原版 DoScrollingInInventory :17591 虽无 hover 门,但 fancy UI 全屏覆盖、
    //   配方列表不可见=可观测面无 bleed)。本仓面板=DOM 覆层(document.body 直挂,
    //   不遮背包——RB15d-②「fancy 面板不收背包」同相登记),面板滚动 wheel 冒泡至
    //   window 级本监听=bleed 通道;面板自滚面各自已消费(成就 .sw-ach-list 原生
    //   overflow 滚/图鉴 gridWrap wheelHandler preventDefault 换页,vinvModernScrollBy
    //   stopPropagation 同判例)。指针轴门,不触暂停轴(RB15d-H4:autoPause∧背包开
    //   滚轮活面保持——本门在 focusPaused 门之后);两面板关闭=DOM remove
    //   (AchievementsUI.closeAchievementsPanel/BestiaryPanel.close),覆层外 target
    //   closest 失配=配方滚轮自动恢复(BJ505 测试④)。
    if (this.vinvWheelInFancyPanel(e)) return;
    const c = this.vinvLayoutCtx;
    if (!c) return;
    const avail = this.vinvCraftAvailV.length;
    // ★SW-FX38:每档数=vanillaWheelNotches(Main.cs:17593 int num=ScrollWheelDelta/120,
    //   C# 整除向零截断:子档拍=0 整吞无累积器,±240=±2 档;取负=XNA 上滚为正 vs
    //   浏览器 deltaY 下滚为正)——旧 `Math.round+Math.abs` 在 (60,120) 档带虚生 1 档=滚距偏快
    const notches = vanillaWheelNotches(e.deltaY, e.deltaMode);   // ★SW-RB14d：补传 deltaMode
    if (this.vinvPipsUseGrid) {                       // :17597 PipsUseGrid 支(flag 初值 true 不变,本支不清)
      const geo = craftGridGeometry(c.sw, c.sh);
      // 视口 px → vinv 逻辑域(÷K;transform-origin top left = 原点同)
      const K = vanillaScaleFor(window.innerWidth, window.innerHeight, options.data.uiScale);
      const lx = e.clientX / K, ly = e.clientY / K;
      if (lx >= geo.left && ly >= geo.top
        && lx < geo.left + geo.w && ly < geo.top + geo.h) {   // :17602-17608 Contains
        let num = notches;
        while (num !== 0) {                           // :17610-17613 while 档数(每档一调,num 只取号)
          if (num < 0) {
            this.vinvCraftRecStart = craftGridRecStartAfterUp(this.vinvCraftRecStart, geo.cols);   // ScrollCraftingGrid mouseWheel<0 支(:587-594,−=cols 无音)
          } else {
            this.vinvCraftRecStart = craftGridRecStartAfterDown(this.vinvCraftRecStart, geo.cols, avail);   // +=支(:596-601)
            this.game.sfx.play('menuTick', 1);            // :597 音只走 +=支(逐字)
          }
          num -= Math.sign(num);
        }
        this.vinvUpdateCraftGrid();
      }
      // 网格支不清 flag(:17600-17608 无 flag=false)→ 列表同拍仍走
    }
    // 箱行滚支(:17622 chest!=-1 ∧ ChestUI.LastHighestChestRow>0 → flag=false+Scroll):
    //   40 槽箱 LastHighestChestRow=ceil(40/10)-4=0 恒假=死支(本仓无 >40 槽容器,同相不建)
    // ★SW-FX41:NewCraftingUI.Visible 支(:17636-17639 flag=false)已落地——窗开=列表滚停
    //   (网格分页支在上方,不受此门=原版同相)
    if (!this.vinvModernCraftOpen) {
      this.vinvCraftWheel(e);                         // :17633-17640 flag 支 ScrollCraftingList(档数自算)
    }
  }

  /** 网格重排/重建(每刷新拍):recStart 逐拍钳制(:461-467)+页钮可见门+格池签名重建 */
  private vinvUpdateCraftGrid(): void {
    const grid = this.vinvCraftGridEl;
    const c = this.vinvLayoutCtx;
    if (!grid || !c) return;
    if (!this.vinvPipsUseGrid) {                      // 关格清空(Main.cs:42449 门)
      if (grid.style.display !== 'none') grid.style.display = 'none';
      if (grid.childElementCount) grid.replaceChildren();   // ★开包 hitch 刀:稳态空网格零 DOM 调
      this.vinvCraftGridSig = '';
      return;
    }
    const geo = craftGridGeometry(c.sw, c.sh);
    const availLen = this.vinvCraftAvailV.length;
    this.vinvCraftRecStart = clampCraftGridRecStart(this.vinvCraftRecStart, availLen, geo.cols, geo.rows);
    grid.style.display = '';
    grid.style.left = `${geo.left}px`;
    grid.style.top = `${geo.top}px`;
    grid.style.width = `${geo.w}px`;
    grid.style.height = `${geo.h}px`;
    if (this.vinvCraftGridUpBtn) this.vinvCraftGridUpBtn.style.display = this.vinvCraftRecStart > 0 ? '' : 'none';
    if (this.vinvCraftGridDownBtn) {
      this.vinvCraftGridDownBtn.style.display =
        this.vinvCraftRecStart < availLen - geo.cols * geo.rows ? '' : 'none';
    }
    const sig = `${availLen}|${geo.cols}x${geo.rows}|${this.vinvCraftRecStart}`;
    if (sig === this.vinvCraftGridSig) return;
    this.vinvCraftGridSig = sig;
    grid.replaceChildren();
    for (let k = 0; k < geo.cols * geo.rows; k++) {
      const i = this.vinvCraftRecStart + k;
      if (i >= availLen) break;                       // :522 i < numAvailableRecipes
      const rec = this.vinvCraftAvailV[i];
      const outKey = vanillaItemKey(rec.r.create);
      const cell = el('div', 'sw-slot');
      cell.style.cssText = 'position:absolute; width:52px; height:52px; background-image:none;'
        + `--slot-bgimg:url(sprites/vanilla/Inventory_Back.png); transform:scale(${CRAFT_GRID_SLOT_SCALE});`
        + 'transform-origin:top left; pointer-events:auto;';
      cell.style.setProperty('--slot-alpha', '1');
      cell.style.opacity = String(150 / 255);         // :545 num14 = A+50 → 画前 -50 = A(LoadSettings A=150,列表同源)
      const img = el('img') as HTMLImageElement;
      img.draggable = false;
      img.src = iconUrl(this.game, this.game.itemId(outKey ?? ''));
      cell.appendChild(img);
      if (rec.r.createStack > 1) cell.appendChild(el('span', 'cnt', String(rec.r.createStack)));
      const pos = craftGridCellXY(k, geo.cols);
      cell.style.left = `${pos.x}px`;
      cell.style.top = `${pos.y}px`;
      // 悬停(:528-540):mouseInterface + craftingHide + HoverItem=clone + MouseHover(22) +
      // hoverItemName(名/×stack)——本仓 tooltip 全载荷面与列表格同源(showTooltipFor)
      cell.addEventListener('mouseenter', (e) => {
        const iid = this.game.itemId(outKey ?? '');
        if (iid > 0) this.showTooltipFor(iid, 'inv', { slot: { id: iid, stack: rec.r.createStack }, anchor: (e.currentTarget as HTMLElement) });
      });
      cell.addEventListener('mouseleave', () => {
        this.tooltip.style.display = 'none';
        cancelAnimationFrame(this.tooltipPulseRaf);
      });
      // ★SW-RB13b:网格格【不绑】wheel——滚轮走窗口级 vinvGridWheelTick(DoScrollingInInventory
      //   域):格面在网格矩形内,原版=分页网格+列表同拍滚(:17602-17633);曾绑 vinvCraftWheel
      //   → stopPropagation 吞掉窗口级分页=滚轮只在 3px 空档生效(格覆盖 93% 面积,倒挂)
      // 点击(:517-527):focusRecipe=i + recFastScroll=true(:523,★SW-FX38 列表瞬吸
      // 同相)+ PipsUseGrid=false + SoundID 12(游戏pad ChangePage(9) 支=N/A)
      cell.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        this.vinvCraftFastScroll = true;              // ★SW-FX38 :523 recFastScroll=true
        this.vinvCraftFocusGoto(i);                   // :522 focusRecipe=i
        this.vinvPipsUseGrid = false;
        this.vinvCraftRecStart = 0;                   // !PipsUseGrid → recStart=0(Main.cs:43926-43929)
        this.game.sfx.play('menuTick', 1);
        this.vinvCraftSnapStep();                     // 同帧瞬吸(fast → original=0,行界音同相)
        this.vinvSyncGridToggle();
        this.vinvUpdateCraftList();
        this.refreshAll();
      });
      grid.appendChild(cell);
    }
  }

  /** ★SW-BJ85(2026-09-15):vinvTickCraftFilter(DrawGridToggle 失效拍 :269-273 移植)
   *  随滤器消费面退役——原版 :269 门=`_lastFilter != null`,而 _lastFilter 恒 null
   *  (写点 :154 后 :155 CloseAll(quiet) 尾 ClearHacks :69 同拍即净;三版同构)=
   *  失效拍在原版本就是净死臂,本仓退役不再移植死臂(惰性死码纪律)。
   *  CanRemainOpen 语义本体保留于 filterRemainOpen(modern 窗失效拍 :655-665 活机制)。 */

  /** CanRemainOpen 域内判定(adjTile 闭包语义;★SW-BJ85:f 改必传——classic 缺省消费方
   *  vinvTickCraftFilter 已退役)。★SW-FX41:modern 窗 Update 拍(NewCraftingUI.cs:655-665)传
   *  vinvModernCraftFilter——曾恒读 classic 域 = 窗开即被误判失效秒关(探针实斩) */
  private vinvFilterRemain(f: CraftingTileFilter | null): boolean {
    const game = this.game;
    if (!f || !game) return false;
    const sheets: number[] = [];
    for (const t of game.vanillaNearbyStations()) {
      const sheet = TILE_DEFS[t]?.vanilla?.sheet;
      if (typeof sheet === 'number') sheets.push(sheet);
    }
    return filterRemainOpen(f, sheets);
  }

  /** 站点 focus 钧落地(InteractWithCraftingStation Player.cs:33555-33561 → classic 支
   *  CraftingUI.OpenCloseFilter CraftingUI.cs:146-159):格交互右键合成站/水源 →
   *  开包 + 网格态(滤器 :154 置入后由 vinvCloseAllQuiet 尾 ClearHacks 面即净=
   *  ★SW-BJ85 债①原版净死对齐:经典列表恒全量邻接配方+头文字恒 inter[25]);
   *  网格已开时再点 = 清过滤+LOUD CloseAll(:148-153 支,★SW-BJ85 债②三态开关)。
   *  modern 支(NewCraftingUI.OpenCloseFilter)本刀前已落地,playerInventory
   *  副作用面(:33545 AdjTiles 本仓 vanillaNearbyStations 每刷新拍同源,无需单独调)。 */
  openCraftingStationFilter(f: CraftingTileFilter): void {
    if (options.data.craftingGridControl === 'classic' && this._builtLayout === 'vanilla') {
      const invOpen = this.invPanel.style.display === 'block';
      if (invOpen && this.vinvPipsUseGrid) {
        // ★SW-BJ85(2026-09-15) 债②:网格已开臂(CraftingUI.cs:148-153)——原版网格
        //   开态再右击站点=_lastFilter=null(:150)+IngameUIWindows.CloseAll()(:151,
        //   LOUD:对话/箱/背包各音 11+modern 窗静默收+ClearHacks)三态开关语义。
        //   旧刀「清过滤后照常全开」=FX30 期偏差(sw-fx30:283 锁死存量,RB19 揭出),
        //   本刀对齐;响铃面=vinvCloseAllLoud。
        this.vinvCraftFilter = null;                  // :150
        this.vinvCloseAllLoud();                      // :151 IngameUIWindows.CloseAll()(LOUD)
        return;
      }
      this.vinvCraftFilter = f;                       // :154(瞬时写;CloseAll 尾 ClearHacks 同拍即净=债①)
      // ★BJ83(2026-09-14):IngameUIWindows.CloseAll(quiet:true)(CraftingUI.cs:155 →
      //   IngameUIWindows.cs:17-66)——classic 开臂静默收 NewCraftingUI(:63=FX30/FX41
      //   两窗互斥,防网格+modern 窗双开叠画)/对话(talkNPC=-1 :36-43)/箱(chest=-1
      //   :50-57)。曾缺此面=modern 窗开着切 classic 后右击站点 → 双窗同屏(用户实报
      //   "强制宫格"叠放面);PipsUseGrid 不在 CloseAll 域(modern 开臂同样不清网格,
      //   Main.cs:42448 网格门独立于窗可见=原版同相,残留网格登记不判)。
      //   ★SW-BJ85:尾 ClearHacks(:69)净 :154 滤器=原版序(净死,消费面已退役)。
      this.vinvCloseAllQuiet();
      this.openInventory(true);                       // :156 Player.OpenInventory
      this.vinvPipsUseGrid = true;                    // :157
      this.vinvSyncGridToggle();
      this.vinvRefreshCraft();
      // ★SW-RB13b:PipsUseGrid=true 置位后箱条吞门/变体回位 pos 闭包须重跑
      //   (开箱态右键合成站→网格开→ChestUI.cs:81 吞箱条;不重排=箱条滞留)
      this.vinvLayoutSig = '';
      this.layoutVanilla();
    } else if (this._builtLayout === 'vanilla') {
      // ★SW-FX41 P2-3:modern 支(:33556-33557 → NewCraftingUI.OpenCloseFilter
      //   NewCraftingUI.cs:938-964)——四支状态机(开窗/换滤器/清滤器/关窗+Matches 去重);
      //   开支内含 Player.OpenInventory 副作用面(:891)
      if (this.invPanel.style.display !== 'block') this.openInventory(true);
      this.vinvOpenCloseModernCraftFilter(f);
    } else {
      // classic 模式×classic 构建器布局(无网格/窗域)——playerInventory=true
      // 副作用面照走(OpenCloseFilter 开支 :156 Player.OpenInventory 同面)
      this.openInventory(true);
    }
  }

  // ---- 重铸原位(刀 12;Main.cs:42268-42393 逐式) ----
  // 槽 (50,270) ctx5(ItemSlot.Handle 全栈放入/取回)/文字 (100,270) 费用分档染色/
  // 锤钮 (120,310) UI_Reforge[0|1] hover 换图+cooldown 60t/储蓄 (180,258) 四库合计。
  // 显示门 = vinvReforgeOpen 且 无箱/无商店/无对话(:42277 自动退出);heldStack 出入
  // 由 closeInventory 归包链承担(原版 dropItemCheck 同相)。登记偏差:reforgeScale
  // 悬停脉冲以 CSS transition 近似;tint 灰随 alpha 同脉的次要观感差。
  private vinvReforgeOpen = false;
  /** ★刀19:向导反查态(InGuideCraftMenu Main.cs:1917)——向导对话"制作"置位;
   *  退出条件 = 开箱/开店/重开对话/重铸(:42396-42400)或关包(closeInventory) */
  private vinvGuideMenuOpen = false;
  private vinvGuideSlotModernEl: HTMLElement | null = null;
  private vinvGuideSlotClassicEl: HTMLElement | null = null;
  private vinvGuideModernCaptionEl: HTMLElement | null = null;
  private vinvGuideModernReqEl: HTMLElement | null = null;
  private vinvGuideClassicTextEl: HTMLElement | null = null;

  /** ★刀19:NPCChatText_GuideReverseCrafting(Main.cs:40724-40732)——音 12+置位;
   *  modern 控制模式(缺省) → NewCraftingUI.Open(quiet:true)。
   *  调用方 = mainFlow onGuideCraftOpen(vanilla 布局门控;classic 仍走反查浮层) */
  openVanillaGuideCraft(): void {
    if (this._builtLayout !== 'vanilla' || !this.game) return;
    this.game.sfx.play('menuTick', 1);                              // PlaySound(12) :40728
    this.vinvGuideMenuOpen = true;
    if (options.data.craftingGridControl === 'modern') this.vinvOpenModernCraft(null, true);   // :40729-40731
    this.vinvLayoutSig = '';                                        // 向导态入签 → 强制重排(经典位槽/文案/切换钮换位)
    this.layoutVanilla();
    this.vinvRefreshCraft();                                        // guideItem 空 → GetNumRecipes=0(modern)
  }

  /** dropItemCheck guideItem 支等价(Player.cs:5110-5114:!InGuideCraftMenu ∧ guideItem
   *  type>0 → GetOrDropItem(ReturnItemFromSlot) 回包+余量 RequestNewItem(base.Center)
   *  落地+guideItem 清)——本仓 guidePlaced 回包(inv.add 余量 spawnDrop)+清;favorited/
   *  prefix/placeStyle 随行 = closeGuideSearch ★SW-BP1 同式。
   *  消费面 = vinvGuideMenuExitCheck 退出臂(走远/开箱/开店,★SW-RB29c F3)+
   *  vinvOpenCloseModernCraftFilter setFilter 臂(NewCraftingUI.cs:946-951,★RB29b F1)。
   *  mouseItem 支(:5133 !playerInventory 才落)本域不建模:站点臂恒背包开态 */
  private vinvReturnGuidePlaced(): void {
    const g = this.game;
    const pl = this.guidePlaced;
    if (pl && g) {
      const left = g.player.inv.add(pl.id, pl.stack, pl.prefix, pl.placeStyle, false, false, !!pl.favorited);
      if (left > 0) {
        const key = ITEM_DEFS[pl.id]?.key ?? '';
        // ★BJ390：余量词缀随行（:7200-7202 同域）
        g.spawnDrop(g.player.cx, g.player.cy, key, left, undefined, undefined, undefined, pl.prefix);
      }
      g.cb.onInventoryChanged?.();
    }
    this.guidePlaced = null;
  }

  /** ★刀19:双菜单退出面(每刷新拍消费,vinvRefreshCraft 头)。
   *  重铸态(Main.cs:42282-42285):chest/shop/talkNPC==-1/向导态 → InReforgeMenu=false;
   *  向导态(Main.cs:42396-42400):chest/shop/talkNPC==-1/重铸态 → 复位+窗收
   *  (NewCraftingUI.Close(quiet,returnToInventory))。talkNPC==-1 ≡ !npcDialogActive
   *  (会话保持入口后=走远距离保持链 closeNpcDialog 即触发) */
  private vinvGuideMenuExitCheck(): void {
    const g = this.game;
    const dlgNpc = (g as unknown as { dialogNpc?: unknown }).dialogNpc;
    if (this.vinvReforgeOpen) {
      if (!!this.openChest || !!g?.npcShopOpen || !dlgNpc || this.vinvGuideMenuOpen) {
        // ★BJ633：强制退出臂同帧直调归还——原版 Main.cs:42286-42288 InReforgeMenu=false
        //   后紧跟 player[myPlayer].dropItemCheck()(reforgeItem 支 :5115-5118)=当帧回包;
        //   旧注「reforgeItem 不清=原版静态量同相」系误读(静态的是字段槽位,内容被
        //   dropItemCheck 即时消费)——不走远无归还=物品卡槽(吞装备根因之二)
        this.vinvReforgeOpen = false;
        this.returnReforgeItem();
        this.vinvLayoutSig = '';
        this.layoutVanilla();
      }
    }
    if (this.vinvGuideMenuOpen) {
      if (!!this.openChest || !!g?.npcShopOpen || !g?.npcDialogActive || this.vinvReforgeOpen) {
        // ★SW-RB29c F3:退出向导态时归还放置材料(dropItemCheck guideItem 支,单源
        //   vinvReturnGuidePlaced;此前 guidePlaced 滞留不还包)
        this.vinvReturnGuidePlaced();
        this.vinvGuideMenuOpen = false;
        if (this.vinvModernCraftOpen) this.vinvCloseModernCraft(true);
        this.vinvLayoutSig = '';
        this.layoutVanilla();
        this.vinvRefreshCraft();
      }
    }
  }

  /** 内部 id → 原版 vid(vi_ 键前缀解析;原 openGuideSearch 局部闭包上提共享) */
  private vidOfItemOf(iid: number): number {
    const def = ITEM_DEFS[iid];
    const m = def && /^vi_(\d+)_/.exec(def.key);
    return m ? Number(m[1]) : -1;
  }

  /** 原版 vid → 本地化名 */
  private vidNameOf(vid: number): string {
    const k = VANILLA_ITEM_KEY_BY_ID[vid];
    return (k && Lang.itemNameByKey(k)) || String(vid);
  }

  /** 环境需求文本(GetRecipeRequirementsText Main.cs:42908-42958:站点/水/蜂蜜/岩浆/
   *  雪原/墓地/炬神恩赐 join(", "),前缀 inter[22];explicitNone=true 空集补 inter[23]
   *  ——物品项不在此串,材料走格面) */
  private recipeEnvReqText(r: VanillaRecipeLike, explicitNone: boolean): string {
    const parts: string[] = [];
    if (r.tile >= 0) parts.push(Lang.tileName(r.tile) ?? `站点 ${r.tile}`);
    if (r.water) parts.push(Lang.inter(53));
    if (r.honey) parts.push(Lang.inter(58));
    if (r.lava) parts.push(Lang.inter(56));
    if (r.snow) parts.push(Lang.inter(123));
    if (r.graveyard) parts.push(Lang.inter(124));
    if (r.torchGod) parts.push(Lang.inter(125));
    if (explicitNone && parts.length === 0) parts.push(Lang.inter(23));
    return `${Lang.inter(22)} ${parts.join(', ')}`;
  }

  /** ★刀19:向导槽/文案绘制面(双窗位共享;guideItem 变化/focus 变化/开态进入时消费)。
   *  文案无堆叠数(DrawGuideCraftText :42912/NewCraftingUI.cs:447 均 inter[21]+Name) */
  private vinvPaintGuideCraft(): void {
    const g = this.game;
    if (!g) return;
    const pl = this.guidePlaced;
    const capText = pl ? `${Lang.inter(21)} ${this.vidNameOf(this.vidOfItemOf(pl.id))}` : Lang.inter(24);
    const mkImg = (host: HTMLElement): void => {
      const img = el('img') as HTMLImageElement;
      img.src = iconUrl(g, pl!.id) || '';
      img.style.cssText = 'position:absolute; inset:0; margin:auto; max-width:46px; max-height:46px; image-rendering:pixelated;';
      img.draggable = false;
      host.appendChild(img);
    };
    // ★②空态 ctx7 幽灵帧（ItemSlot.Draw :2451-2482 case7→num15=18,0.35α;
    //   2026-09-14 用户报两处向导槽缺图标底图——底图 Inventory_Back 已由
    //   --slot-bgimg 恒挂,此处补空态幽灵帧,有件态仍清空画图标）
    const mkGhost = (host: HTMLElement): void => { host.appendChild(makeSlotGhostEl(GUIDE_SLOT_GHOST_FRAME)); };
    // modern 位(DrawChildren NewCraftingUI.cs:441-458)
    const ms = this.vinvGuideSlotModernEl;
    if (ms) {
      ms.replaceChildren();
      if (pl) mkImg(ms); else mkGhost(ms);
    }
    if (this.vinvGuideModernCaptionEl) this.vinvGuideModernCaptionEl.textContent = capText;
    if (this.vinvGuideModernReqEl) {
      // :452-456 需求行域 = recipeEntry(_hoveredEntry ?? SelectedEntry)——向导态首入
      //   SelectedEntry==null 整行不画;★FX41b:经典列表 fallback 摘除(旧式以经典焦点行
      //   多画需求行;经典位文案仍吃 vinvCraftAvailV[focus]=DrawGuideCraftText :42906 域)
      const r = this.vinvModernSelected;
      this.vinvGuideModernReqEl.textContent = r ? this.recipeEnvReqText(r, false) : '';
    }
    // 经典位(DrawGuideCraftText Main.cs:42901-42924:空=inter[24] 单行;有件=「需要 X」
    //   +「环境需求(explicitNone)」两行 → 单元素 \n 拆行(line-height 26=原文 +26px 步距))
    const cs = this.vinvGuideSlotClassicEl;
    if (cs) {
      cs.replaceChildren();
      if (pl) mkImg(cs); else mkGhost(cs);
    }
    if (this.vinvGuideClassicTextEl) {
      const r = this.vinvCraftAvailV[this.vinvCraftFocusV]?.r ?? null;
      this.vinvGuideClassicTextEl.textContent = pl
        ? `${capText}\n${r ? this.recipeEnvReqText(r, true) : ''}`
        : capText;
    }
  }
  private vinvReforgeSlotEl: HTMLElement | null = null;
  private vinvReforgeTextEl: HTMLElement | null = null;
  private vinvReforgeHammerEl: HTMLButtonElement | null = null;
  private vinvSavingsEl: HTMLElement | null = null;
  /** 重铸冷却截止(performance.now 域)≡ Main.reforgeCooldown(:1921,60t@60fps=1000ms):
   *  仅最优档掷中置位(:42626),普通档零冷却=连点每击立即重铸;鼠标离锤即清(:42279)。
   *  vinv 锤钮与 classic modal 两面共用(FX60 用户实报「不能快速连点」收口) */
  private vinvReforgeCooldownUntil = 0;
  private vinvReforgeHadItem = false;
  /** ★R15-F15：占卜球 5644 在-game CloseAll 后的下一拍强制退出臂待还旗
   *  （InReforgeMenu=false 等价;消费点=tickStackSplitMain 头臂 → returnReforgeItem）。
   *  菜单路径（closeAll else 支）不置旗=ClearPlayerTempInfo TurnToAir 同相直清。 */
  private vinvReforgeForcedReturn = false;

  private vinvBuildReforge(): void {
    const root = this.vinvRoot;
    if (!root) return;
    // 重铸槽(ctx5:ItemSlot.Handle —— 放入=整件克隆含词缀,取回=回光标)
    // ★反馈轮8:0.85 缩放落地(原版槽视觉=52×0.85=44.2,文本 +50 → 缝 5.8px;
    //  旧码未缩放=槽 52px 全宽,文本 +50 反压槽 2px=用户报"格子太近")
    const slot = el('div', 'sw-slot');
    slot.style.cssText = 'position:absolute; width:52px; height:52px; background-image:none;'
      + '--slot-bgimg:url(sprites/vanilla/Inventory_Back.png); transform-origin:top left;'
      + 'transform:scale(0.85);';
    slot.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.vinvReforgeSlotClick();
    });
    slot.addEventListener('mouseenter', () => { if (this.reforgeItem) this.showReforgeTooltip(); });
    slot.addEventListener('mouseleave', () => { this.tooltip.style.display = 'none'; cancelAnimationFrame(this.tooltipPulseRaf); });
    root.appendChild(slot);
    this.vinvReforgeSlotEl = slot;
    this.vinvLayoutItems.push({ el: slot, pos: () => {
      if (!this.vinvReforgeVisible()) return null;
      return { x: 50, y: 270 };
    } });
    // 文字((100,270):有件=Reforge: 分档染色费用;无件=inter[20] 提示)
    const text = el('div', 'vinv-txt');
    text.style.cssText += 'font-size:14px; pointer-events:none; white-space:nowrap;';
    root.appendChild(text);
    this.vinvReforgeTextEl = text;
    this.vinvLayoutItems.push({ el: text, pos: () => {
      if (!this.vinvReforgeVisible()) return null;
      return { x: 100, y: 270 };
    } });
    // 锤钮((120,310) 中心锚;UI_Reforge[0|1] hover 换图;cooldown 60t 仅最优档(:42626))
    const hammer = el('button', 'vinv-btn') as HTMLButtonElement;
    const hImg = document.createElement('img');
    hImg.draggable = false;
    hImg.style.cssText = 'width:100%; height:100%; image-rendering:pixelated; pointer-events:none;';
    hImg.src = 'sprites/vanilla-ui/UI_Reforge_0.png';
    hammer.appendChild(hImg);
    // 悬停面(:42371-42374:hoverItemName=inter[19] MouseText + !mouseReforge→PlaySound(12)
    // +mouseReforge=true;:42383 离开锤盒 mouseReforge=false)——旧码只换贴图无悬停名/音
    hammer.addEventListener('mouseenter', (e) => {
      hImg.src = 'sprites/vanilla-ui/UI_Reforge_1.png';
      this.game.sfx.play('menuTick', 1);
      this.showBuffTooltip((e.currentTarget as HTMLElement), Lang.inter(19), '');
    });
    hammer.addEventListener('mouseleave', () => {
      hImg.src = 'sprites/vanilla-ui/UI_Reforge_0.png';
      this.vinvReforgeCooldownUntil = 0;   // 离锤即清冷却(mouseReforge=false 支 :42279)
      this.hideBuffTooltip();
    });
    hammer.addEventListener('mousedown', (e) => { e.stopPropagation(); this.vinvReforgeHammerHit(); });
    root.appendChild(hammer);
    this.vinvReforgeHammerEl = hammer;
    this.vinvLayoutItems.push({ el: hammer, pos: () => {
      if (!this.vinvReforgeVisible() || !this.reforgeItem) return null;   // 有件才画锤(:42310)
      return { x: 120, y: 310 };
    } });
    // 储蓄((180,258) DrawSavings ItemSlot.cs:四库有钱画图标+储蓄总额)
    const sav = el('div', 'vinv-txt');
    sav.style.cssText += 'font-size:13px; pointer-events:none; display:flex; align-items:center; gap:3px;';
    root.appendChild(sav);
    this.vinvSavingsEl = sav;
    this.vinvLayoutItems.push({ el: sav, pos: () => {
      if (!this.vinvReforgeVisible() || !this.reforgeItem) return null;   // DrawSavings 在有件支(:42318)
      return { x: 180, y: 258 };
    } });
  }

  /** 重铸槽左键点击面（vinvBuildReforge 槽 mousedown 单源,ctx5=ItemSlot.Handle 面）。
   *  ★R15-F12/F13（2026-10-11 C15 清偿,红蓝 R15 实害双吞点）：
   *   · F12（HIGH）旧码 cursor 持物点【已占】槽直接覆写 reforgeItem=旧槽物静默
   *     吞件——修=MouseItemSwap 双向互换（ItemSlot.cs:1008-1046 `Utils.Swap(ref
   *     slot, ref Main.mouseItem)` 原文;槽内旧物回光标,光标物入槽）。
   *   · F13（MED）旧码整组克隆入槽——原版恒取 1 件（ItemSlot.cs:1053-1057 case 1
   *     stack>1 支 `inv[slot]=mouseItem.Clone(); inv[slot].stack=1; mouseItem.stack--;`
   *     ;shift-click 支 :798-806 同式）。reforgeCost 按 1 计（Main.cs:42297
   *     value×stack,stack 恒 1=费用不随整组膨胀）。
   *   canReforge 门维持（本仓放置侧自造近似面,原版放置无门+重铸时才验——登记）。 */
  vinvReforgeSlotClick(): void {
    if (this.heldStack) {
      if (this.reforgeItem) {
        const tmp = this.reforgeItem;
        this.reforgeItem = { ...this.heldStack };
        this.heldStack = tmp;                    // 双向保全（Swap 语义,零吞件）
      } else {
        if (!this.game.canReforge(this.heldStack)) { this.toast(Lang.text('Mods.SandboxWorld.Reforge.CannotReforge')); return; }
        this.reforgeItem = { ...this.heldStack, stack: 1 };   // 取 1 件（词缀随行）
        this.heldStack.stack -= 1;
        if (this.heldStack.stack <= 0) this.heldStack = null;
      }
    } else if (this.reforgeItem) {
      this.heldStack = { ...this.reforgeItem };
      this.reforgeItem = null;
    }
    this.refreshAll();
  }

  /** 锤钮点击(Main.cs:42370 mouseLeftRelease 边沿=每击一次,长按不连发)。
   *  门序:有件 → reforgeCooldown<=0(:42370) → BuyItem 静默失败(:42346) → 重铸。
   *  冷却只由最优档掷中置位(:42626 reforgeCooldown=60t=1000ms)——普通档零冷却,
   *  连点每击立即重铸(FX60:旧码无条件 +1000ms=用户报「两次点击间要停顿」根因) */
  private vinvReforgeHammerHit(): void {
    if (!this.reforgeItem) return;
    if (performance.now() < this.vinvReforgeCooldownUntil) return;   // reforgeCooldown<=0 门(:42370)
    const cost = this.game.reforgeCost(this.reforgeItem);
    if (this.game.coinsOwned() < cost) return;   // 原版 BuyItem 失败=静默(:42346)
    const out = { topTier: false };
    const np = this.game.doReforge(this.reforgeItem, out);
    if (np < 0) return;
    if (out.topTier) this.vinvReforgeCooldownUntil = performance.now() + 1000;   // 仅最优档(:42626)
    // 重铸反馈 = PopupText.NewText(ItemReforge/_Best,reforgeItem,player.Center,stack,
    // noStack:true)（Main.cs:42622）——AffixName 飘字（新词缀+本名,玩家头顶,稀有度色）,
    // 单源 showPickupLabel;旧「花费: N · 前缀」toast=自创面退役（费用原版恒走 (100,270)
    // 币制分解常驻行 :42288-42322,无重铸后费用提示）
    const rdef = ITEM_DEFS[this.reforgeItem.id];
    // ★SW-N4（2026-09-20）：飘字色=词缀档位移后 rare（Main.cs:42622 → PrepareEffects
    //  PopupText.cs:388-404 Rarity=newItem.rare 字段值）——BJ125 单源链 tooltipRareOf
    //  产物（forPopup=跳过④ MouseText −12 覆写）;基表读法=神级迷你鲨 2 档绿伪影
    //  （BJ165 登记债,本刀清偿;变异哨 tests/sw-n4-reforge-popup-rare.test.ts 传基表→红）
    if (rdef) this.game.showPickupLabel(rdef.key, this.reforgeItem.stack, np,
      this.tooltipRareOf(rdef, np, { forPopup: true }));
    this.refreshAll();
  }

  /** 显示门(:42277-42285:InReforgeMenu ∧ 无箱 ∧ 无店 ∧ talkNPC!=-1——★刀19:会话
   *  保持入口后 talkNPC 恒在,走远=closeNpcDialog → 门翻假;旧 !dlgNpc 极性反写
   *  =对话消失反而保持可见=用户报"远离后格子滞留") */
  private vinvReforgeVisible(): boolean {
    const dlgNpc = (this.game as unknown as { dialogNpc?: unknown }).dialogNpc;   // Game 私有域,运行期读
    return this.vinvReforgeOpen && !this.openChest && !this.game.npcShopOpen && !!dlgNpc;
  }

  /** 重铸拍回写:槽面/费用分档染色/储蓄四库(Main.cs:42286-42320) */
  private vinvUpdateReforge(): void {
    const slot = this.vinvReforgeSlotEl;
    if (!slot || !this.game) return;
    // 锤/储蓄显隐随 reforgeItem 有无(:42310 有件才画锤)——有件态变化不在布局
    // 签名里,此处强制重排(红队 MAJOR-3 同族教训:显隐依赖可变状态必须触发 relayout)
    if (this.vinvReforgeHadItem !== !!this.reforgeItem) {
      this.vinvReforgeHadItem = !!this.reforgeItem;
      this.vinvLayoutSig = '';
      this.layoutVanilla();
    }
    // 槽面
    slot.querySelector('img')?.remove();
    slot.querySelector('.cnt')?.remove();
    if (this.reforgeItem) {
      const img = el('img') as HTMLImageElement;
      img.draggable = false;
      img.src = iconUrl(this.game, this.reforgeItem.id);
      slot.appendChild(img);
      if (this.reforgeItem.stack > 1) slot.appendChild(el('span', 'cnt', String(this.reforgeItem.stack)));
    }
    // 文字(有件=费用分档;无件=inter[20];:42286-42322)
    const text = this.vinvReforgeTextEl;
    if (text) {
      if (this.reforgeItem) {
        const cost = this.game.reforgeCost(this.reforgeItem);
        text.innerHTML = `${Lang.inter(46)}: ` + this.vinvCoinSpans(cost);
      } else {
        text.textContent = Lang.inter(20);   // 将物品放到此处重铸
      }
    }
    // 储蓄(DrawSavings:四库钱币合计,只计有币的库画图标)
    const sav = this.vinvSavingsEl;
    if (sav) {
      const banks = this.game.player.banks ?? [];
      const COIN_VAL = [1, 100, 10000, 1000000];
      const ICON_VID = [87, 346, 3813, 4076];
      let total = 0;
      const hasCoin: boolean[] = [];
      for (let b = 0; b < 4; b++) {
        const items = (banks[b] ?? []) as Array<{ id: number; stack: number } | null>;   // p.banks[bi] 即槽位数组(Game.ts:24240)
        let sum = 0;
        for (const s of items) {
          if (!s) continue;
          const d = coinIndexOf(s.id);
          if (d >= 0) sum += COIN_VAL[d] * s.stack;
        }
        hasCoin[b] = sum > 0;
        total += sum;
      }
      if (total <= 0) { sav.replaceChildren(); return; }
      sav.replaceChildren();
      sav.appendChild(el('span', '', `${Lang.inter(66)} `));
      for (let b = 0; b < 4; b++) {
        if (!hasCoin[b]) continue;
        const k = VANILLA_ITEM_KEY_BY_ID[ICON_VID[b]];
        const iid = k !== undefined ? ITEM_BY_KEY[k] : undefined;
        if (iid === undefined) continue;
        const im = el('img') as HTMLImageElement;
        im.src = iconUrl(this.game, iid);
        im.draggable = false;
        im.style.cssText = 'width:20px; height:20px; image-rendering:pixelated;';
        sav.appendChild(im);
      }
      sav.appendChild(el('span', '', formatCopper(total)));
    }
  }

  /** 费用分档染色(Main.cs:42292-42321:铂/金/银/铜四档各自原版币色) */
  private vinvCoinSpans(copper: number): string {
    // 币名 = Lang.inter[15]铂/[16]金/[17]银/[18]铜(:42304-42321 同族);色 = 原版币色近似
    const COLORS = ['#dedee8', '#f0c840', '#c0c0cc', '#d08040'];
    const DIV = [1000000, 10000, 100, 1];
    let rest = Math.max(1, copper);
    let html = '';
    for (let d = 0; d < 4; d++) {
      const n = Math.floor(rest / DIV[d]);
      rest -= n * DIV[d];
      if (n <= 0) continue;
      html += `<span style="color:${COLORS[d]}">${n} ${Lang.inter(15 + d)}</span> `;
    }
    return html || `<span style="color:${COLORS[3]}">0 ${Lang.inter(18)}</span>`;
  }

  /** 列表滚轮(格/材料格/命中区/窗口级 flag 支共用;滚轮悬停格子上也有效——★用户实测二轮)。
   *  ★SW-FX38 滚距定谳:Main.cs:17633-17640 flag 支 ScrollCraftingList(num) →
   *  CraftingUI.cs:572-583 `focusRecipe += mouseWheel`【单次整批】+钳 [0,n−1];
   *  档数=vanillaWheelNotches(Delta/120 C# 向零截断——子档拍=0 无位移无音,±240=±2
   *  档一拍全走);量化号面=原版(XNA ScrollWheelValue 上滚为正,函数保持 1457 逐字)。
   *  ★★用户明令分歧(BJ189 销账,2026-09-20 拍板):用户系统滚轮反向设置下原版 focus
   *  轮播(上滚=焦点下移)体感颠倒 → 明令本面改【浏览器方向】:应用档反相 focusV【−】num
   *  (下滚=焦点下移一行/内容上滑;原版本相=上滚→focusRecipe+1)——回滚口=仅此一处
   *  (删下方 − 号即复原原版;登记 craft-wheel-direction-vanilla-carousel-second-report)。
   *  Pips 网格分页(vinvGridWheelTick)/modern 窗滚轮(vinvModernScrollBy)非分歧面,
   *  共享 quantizer 号面不动、仍锚原版同相(2026-09-20 消费面普查三面定谳)。
   *  ★音效不在本面(:572-583 全程无 PlaySound)——吸附步进
   *  每越 65px 行界一响(:388-393,vinvCraftSnapStep)。 */
  private vinvCraftWheel(e: WheelEvent): void {
    // ★BJ103 失焦旁支：元素级宿主（:10328/:10420 绑定）与窗口宿主(vinvGridWheelTick)
    //   同态——失焦暂停期原版 :17303-17316 return 先于 :17371,:17549 宿主不可达=死;
    //   autoPause 暂停期保持活面（勿用游戏全暂停态总门,rb15d H4 禁门锁）
    if (this.game?.focusPaused) return;
    e.stopPropagation();
    const rows = this.vinvCraftAvailV;
    if (!rows.length) return;
    // ★SW-RB14d（FX38-F2）：量化语义 1:1——原版 ScrollWheelDelta=ScrollWheelValue
    //  （【跨事件累计量】,PlayerInput.cs:1407 += 每事件累加）帧间差分(:901-902),
    //  即一帧内多次/亚 notch 滚动【先累计再 /120】。旧刀逐事件 trunc:macOS 触控板/
    //  惯性每次 ±(4~60)px → 每事件 0 档整段吞零(与"比原版快"同源的逆偏差)。
    //  余数累计器=同构语义:累计像素、整档消费、余数留置(量化相位在事件界而非帧界,
    //  <1 拍差,净档数逐值同)。
    this.vinvCraftWheelPendPx += wheelEventPx(e.deltaY, e.deltaMode);   // ★SW-RB14d：并补传 deltaMode
    const num = vanillaWheelNotches(this.vinvCraftWheelPendPx);         // Main.cs:17594(量化号=原版 XNA 上滚为正;浏览器向对齐在下方应用位)
    if (num === 0) return;                                // 子档拍:ScrollCraftingList(0) 零位移零音（余数留置）
    this.vinvCraftWheelPendPx += num * 120;               // 消费整档,余数留累计器
    const next = Math.min(rows.length - 1, Math.max(0, this.vinvCraftFocusV - num));   // :574-582 ★用户明令分歧(2026-09-20):focusV−num=浏览器方向,唯一回滚口(复原=改回 +num);原版同相=+num(上滚→+1)
    this.vinvCraftFocusGoto(next);
    // ★SW-RB14d 债 FX38-F4：此同步步 + rAF 配额步（dt/16.67 档）在事件落在两帧
    //  之间时首窗得 2 步（原版 Update 消费滚轮→Draw 恰 1 步）,滑行提前 ~1 步、
    //  行界音同步提前一拍;且配额在任意 pip 页推进,原版仅 Recipes 页(:42425-42427
    //  DrawRecipesList 内 AdjustRecipeOffsets)——亚秒级观感差,不动刀（改动牵动
    //  快感面,留独立批）。另:rebuild 面板撤除时 focus/glide 清零(FX38-F5)无原版
    //  对应物（focusRecipe 静态量,切页/换分辨率不重置 Main.cs:1806）——同债登记。
  }

  /** ★SW-FX38 焦点迁移+重锚播种(CraftingUI.cs:394-399 全行重锚不变式
   *  availableRecipeY[i]=glideY+(i−focus)·65 ⇒ focus 变更时 glideY 按【新焦点行迁移前
   *  旧位】重播种——:380 num2=availableRecipeY[focusRecipe] 读的正是它,吸附由此起步)。 */
  private vinvCraftFocusGoto(next: number): void {
    const prev = this.vinvCraftFocusV;
    if (next === prev) return;
    this.vinvCraftGlideY += (next - prev) * 65;
    this.vinvCraftFocusV = next;
  }

  /** ★SW-FX38 吸附步进(DrawRecipes_AdjustRecipeOffsetSnappy CraftingUI.cs:376-404,
   *  每绘制拍;原版"切换速度"本体=此拍面,非滚轮面瞬移):
   *  num2=glideY;original=fast?0:MoveTowards(num2·0.97,0,6.5)(:381-386);
   *  trunc(num2/65)≠trunc(original/65) → SoundID 12(每越行界一响 :388-393,多档滚动
   *  N 响随滑行散布);num2==0 → fast=false(:400-403)。返回是否位移。 */
  private vinvCraftSnapStep(): boolean {
    const num2 = this.vinvCraftGlideY;
    const original = this.vinvCraftFastScroll ? 0 : craftSnapEase(num2);
    if (craftSnapCrossedRow(num2, original)) this.game.sfx.play('menuTick', 1);   // :390-393
    this.vinvCraftGlideY = original;
    if (num2 === 0) this.vinvCraftFastScroll = false;     // :400-403
    if (original !== num2) this.vinvUpdateCraftList();
    return original !== num2;
  }

  /** ★原版槽底脉冲域 rAF 环（Main.cs:46460-46474 脉冲本体已迁 CSS 合成器动画,
   *  ★BJ316 2026-09-23——--invpulse 逐帧写 → 全槽 opacity 派生逐帧 style recalc
   *  +整面板重绘 + GPU 光栅争用放大 uploadRaw getError sync = 真机 trace 定谳的
   *  开包掉帧主链;动画迁 vinvStyleEnsure @keyframes sw-vinv-pulse,包络同域）。
   *  本环保留其余逐帧职责：mH 新鲜度重排（FX10 债⑨）/modern 滤器失效拍（FX41）/
   *  列表吸附步进（FX38）,全部条件比对,稳态零 DOM 写。开包启动/关包自停。 */
  private vinvPulseRaf = 0;
  private vinvPulseLast = 0;
  private vinvPulseTick = (ts: number): void => {
    if (!this.vinvRoot || this.vinvRoot.style.display === 'none') {
      this.vinvCraftFastScroll = true;   // ★SW-FX38:!playerInventory 每拍置 fast(Main.cs:46428)→ 重开首拍瞬吸
      this.vinvPulseRaf = 0; return;
    }
    // ★SW-FX10 债⑨ mH 每帧新鲜度：原版 mH 每帧重算（Main.cs:46537 DrawInterface_16）——
    //  Tab 循环地图样式/全屏图开关会即时改 mH → num20/右锚列全体位移。layoutVanilla
    //  无每帧挂点（仅 refresh/resize/页切），此处每帧比对小地图态布尔，值变才走
    //  重排（签名含 minimapOn → 必然重排；不变时零 DOM 写）
    {
      const mm = this.game ? (this.game.renderer.mapStyle === 1 && !this.game.mapFullscreen()) : true;
      if (this.vinvLayoutCtx && this.vinvLayoutCtx.minimapOn !== mm) this.layoutVanilla();
    }
    // ★SW-BJ85(2026-09-15) 债①:RB13b 站点滤器逐帧失效块随消费面退役——原版
    //   DrawGridToggle 头失效拍(CraftingUI.cs:269-272)以 _lastFilter!=null 为门,
    //   而 _lastFilter 恒 null(OpenCloseFilter :154 置入 → :155 CloseAll(quiet) 尾
    //   ClearHacks :69 同拍即净)=原版该拍净死,退役不移植死臂。modern 窗失效拍
    //   (NewCraftingUI.cs:655-665,_filter 活机制)保留于下块。
    // ★SW-FX41:NewCraftingUI.Update(NewCraftingUI.cs:655-665 UpdateUIStates
    //   Main.cs:17678-17682 每拍)——站点滤器失效 → Close(quiet:false,
    //   returnToInventory:true)(音 11+背包保持);_filter==null 时零开销
    if (this.vinvModernCraftOpen && this.vinvModernCraftFilter !== null && this._builtLayout === 'vanilla') {
      if (!this.vinvFilterRemain(this.vinvModernCraftFilter)) this.vinvCloseModernCraft(false);
    }
    const dt = this.vinvPulseLast ? Math.min(100, ts - this.vinvPulseLast) : 16.67;
    this.vinvPulseLast = ts;
    // ★SW-FX38 列表吸附步进(CraftingUI.cs:376-404 每绘制拍):原版 Frame Skip 缺省
    //   60fps ⇒ dt 累积整数步配额(高刷屏不 2× 快进,后台回前台 dt=100ms 钳 6 步防跳变)
    //   ★FX41b(2026-09-15 用户实报「modern 窗点格播滚动音序」):modern 窗开 =
    //   Main.cs:42418-42428 NewCraftingUI.Visible → else 分支(DrawRecipesList →
    //   AdjustRecipeOffsets CraftingUI.cs:174)整支不画 ⇒ 吸附步进停摆;modern 点格
    //   只移植 HandleCraftSlot 的 Sound 12+focusRecipe 播种,滑行账(glideY)在窗关后
    //   由 PipsFastScroll(:871)首拍瞬吸清账=原版同相。旧缺:rAF 无视窗态步进,
    //   点格播种 → 隐藏列表滑行 N 越行 N 响(取证=点 1 格 900ms 20 响)。
    if (!this.vinvModernCraftOpen && !this.vinvReforgeVisible()) {
      // ★重铸态步进停摆(Main.cs:42418 else-if !InReforgeMenu → AdjustRecipeOffsets
      //   CraftingUI.cs:174 随 DrawRecipesList 整支不画;modern 同相先例=FX41b C 刀)
      this.vinvCraftGlideAcc += dt / (1000 / 60);
      if (this.vinvCraftGlideAcc >= 1) {
        let steps = Math.floor(this.vinvCraftGlideAcc);
        this.vinvCraftGlideAcc -= steps;
        if (steps > 6) steps = 6;
        for (let k = 0; k < steps; k++) this.vinvCraftSnapStep();
      }
    }
    // ★BJ316 2026-09-23:脉冲账面退役（原此步进 invAlpha ±0.2/tick 并逐帧
    //   setProperty('--invpulse')——掉帧主链定谳见类字段注/vinvStyleEnsure 注;
    //   CSS @keyframes 合成器驱动接管,稳态零主线程写零重绘）。
    this.vinvPulseRaf = requestAnimationFrame(this.vinvPulseTick);
  };
  private vinvPulseStart(): void {
    if (!this.vinvPulseRaf) { this.vinvPulseLast = 0; this.vinvPulseRaf = requestAnimationFrame(this.vinvPulseTick); }
  }

  // ---- 宝箱条(★2026-09-08 用户实测三轮:原版开箱非独立 modal,而是直接在物品栏
  //  下方叠槽。权威:ChestUI.Draw(:79-100)+DrawSlots(:324-360):scale 0.755、
  //  x=trunc(73+col·56·0.755)、y=trunc(invBottom+row·56·0.755)、invBottom=258;
  //  名字 @(504,258);按钮列 @(506,invBottom+40+ID·26) 文本 0.75 缩放。
  //  ★SW-FX28 刀①:数值面已迁 vanillaInvLayout CHEST_SCALE/chestSlotXY/
  //  CHEST_NAME_XY/chestButtonXY 单源(vanilla-inv-layout 登记债#1 箱侧清偿)) ----
  private vinvChestNameEl: HTMLElement | null = null;
  private vinvChestBtnEls: HTMLButtonElement[] = [];

  // ---- 建筑配件图标列（★SW-FX19 债清偿；Main.cs:48142-48377 DrawBuilderAccToggles）----
  //  背包开即画 @(10,77) 竖列 24px 步距、10 槽序 8,9,0,1,2,3,4,5,6,7（:48166 num2 循环
  //  i=0→num3=8/i=1→num3=9/其余 num3=i-2）;每槽门=对应配饰装备(:48177 InfoAccMechShowWires
  //  =3619/3611、:48193 rulerLine=【恒可见】(旗经 ResetEffects Player.cs:18809 每拍
  //  置 true,SW-FX36 修正——旧注 486/3611 系把置位支当门)、:48207 rulerGrid=2799/3611、:48229
  //  autoPaint=2216/3061/5126、:48249 autoActuator=3624——缺配饰 continue 不画;
  //  ★FX36 判定域=背包∪装备(UpdateEquips :12997-13004 全 inventory 扫描,信息配件族
  //  不必装备),旧「仅配饰槽」域已撤)。
  //  点击:二态位 0↔1(:48201 等)+音 12 menuTick;线材可见度族 4 态 ++>=3→0(:48340-48343
  //  quirk——Hidden 3 点击不可达)。悬停 tooltip GameUI.*(:48196-48320);尾随方块替换
  //  图标 (:43242 @(0,44) 音 22 unlock) + 群系炬图标 (:43282 @(0,68) unlockedBiomeTorches
  //  才画)。totalDrawnIcons>=10 → 列整体上移 24、44→23、68→47(:48166/:43247/:43289)。
  //  悬停 InfoIcon[13] 星与 UILinkPoint(手柄)未建模=登记。
  private vinvBuildBuilderAccToggles(): void {
    const root = this.vinvRoot;
    if (!root) return;
    const statusOf = (): number[] => this.game?.player.builderAccStatus ?? builderAccDefaults();
    // ★SW-FX36：旗位判定域=背包∪装备扫描（UpdateEquips :12997-13004 逐 inventory[0..57]
    //  槽调 RefreshMechanicalAccsFromItemType——信息配件族不必装备;装备段
    //  GrantArmorBenefits :13204。旧「仅配饰槽」域=wiki 明证偏差）
    const gatesOf = () => builderAccGateSet((vid) => {
      const g = this.game;
      return !!g && playerVidCarried(g.player.inv.slots, g.player.inv.armor, (k) => g.player.inv.isItemSlotUnlockedAndUsable(k), vid);
    });
    const ICON_SRC = 'sprites/vanilla-ui/UI_BuilderIcons.png';
    const slotEls: Array<HTMLButtonElement | null> = BUILDER_ACC_ICON_ORDER.map(() => null);
    // ★BJ585（用户实报「四线只有明亮正确渲染,经典/褪色像透明」定谳落刀）：原版图标
    //  态=SpriteBatch tint【RGB 暗化】非 α 半透明——线材族四态链（Main.cs:48288-48290）：
    //  0 White / 1 Color(127,127,127)【不透明暗灰】/ 2 同色 MultiplyRGBA(Color(0.66×4))
    //  →(83,83,83,α168) / 3 MultiplyRGBA(0.33×4)→(41,41,41,α84)；二态族（:48168 等）
    //  off=Color(127,127,127) 不透明暗灰。旧码把 tint 误译为 opacity 0.497 半透明且
    //  1/2/3 三态折叠同观感=「经典/褪色像透明」病灶。CSS 译法：RGB 暗化→filter
    //  brightness(k)、α→opacity（byte 链=Color(float)→(byte)(f·255) 截断后分量乘）。
    const paintSlot = (i: number): void => {
      const b = slotEls[i];
      if (!b) return;
      const st = statusOf()[BUILDER_ACC_ICON_ORDER[i].accIndex];
      if (BUILDER_ACC_ICON_ORDER[i].wireMode) {
        // 0 Bright→原色;1 Normal→×127/255=0.498;2 Faded→(83,α168);3 Hidden→(41,α84)
        b.style.opacity = st === 2 ? `${168 / 255}` : st === 3 ? `${84 / 255}` : '1';
        b.style.filter = st === 0 ? ''
          : st === 1 ? `brightness(${127 / 255})`
          : st === 2 ? `brightness(${83 / 255})`
          : `brightness(${41 / 255})`;
      } else {
        const on = st === 0;
        b.style.opacity = '1';
        b.style.filter = on ? '' : `brightness(${127 / 255})`;   // color2(127,127,127) 不透明暗灰(:48168)
      }
    };
    // ★2026-09-13 反馈轮6:hover 文案抽函数走自有气泡(:48300-48320 MouseText 域;
    //  文案随 num3 走的映射错位 quirk 见 BUILDER_ACC_ICON_ORDER 注)
    const baccTipOf = (idx: number): string => {
      const on = statusOf()[idx] === 0;
      switch (idx) {
        case BACC.HideAllWires: return Lang.text(on ? 'GameUI.WireModeForced' : 'GameUI.WireModeNormal');
        case BACC.RulerLine: return Lang.text(on ? 'GameUI.RulerOn' : 'GameUI.RulerOff');
        case BACC.RulerGrid: return Lang.text(on ? 'GameUI.MechanicalRulerOn' : 'GameUI.MechanicalRulerOff');
        case BACC.AutoActuate: return Lang.text(on ? 'GameUI.ActuationDeviceOn' : 'GameUI.ActuationDeviceOff');
        case BACC.AutoPaint: return Lang.text(on ? 'GameUI.PaintSprayerOn' : 'GameUI.PaintSprayerOff');
        default: {
          const arg = ({ 4: 'Game.RedWires', 5: 'Game.BlueWires', 6: 'Game.GreenWires', 7: 'Game.YellowWires', 9: 'Game.Actuators' } as Record<number, string>)[idx] ?? '';
          const st = statusOf()[idx];
          const mode = Lang.text(st === 0 ? 'GameUI.Bright' : st === 1 ? 'GameUI.Normal' : st === 2 ? 'GameUI.Faded' : 'GameUI.Hidden');
          return `${Lang.text(arg)}: ${mode}`;
        }
      }
    };
    const visGateOf = (idx: number, g: ReturnType<typeof builderAccGateSet>): boolean => {
      // ★SW-FX36：Ruler 档(:48193 门 `player.rulerLine`)恒可见——旗位在 ResetEffects
      //  (Player.cs:18809) 每拍置 true、全仓无置 false 点,与配饰持有无关
      if (idx === BACC.RulerLine) return true;
      if (idx === BACC.RulerGrid) return g.rulerGrid;
      if (idx === BACC.AutoActuate) return g.autoActuator;
      if (idx === BACC.AutoPaint) return g.autoPaint;
      return g.infoAccMechShowWires;              // 8/9/4-7 同门(:48177/:48290)
    };
    BUILDER_ACC_ICON_ORDER.forEach((slot, i) => {
      const b = el('button', 'vinv-btn') as HTMLButtonElement;
      b.style.cssText = 'width:14px; height:14px; image-rendering:pixelated;'
        + `background-image:url(${ICON_SRC}); background-size:160px 32px;`;
      this.vinvBindHoverTip(b, () => baccTipOf(slot.accIndex));
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const st = statusOf();
        if (slot.wireMode) cycleWireVisibility(st, slot.accIndex);
        else toggleBuilderAccBit(st, slot.accIndex);
        this.game?.sfx.play('menuTick', 1);       // SoundEngine.PlaySound(12) :48203 等
        paintSlot(i);
        this.showBuffTooltip((e.currentTarget as HTMLElement), baccTipOf(slot.accIndex), '');   // 点击即刷新(mousedown 必在悬停态)
      });
      root.appendChild(b);
      slotEls[i] = b;
      this.vinvLayoutItems.push({
        el: b,
        pos: () => {
          const c = this.vinvLayoutCtx;
          if (!c || !this.game) return null;
          const g = gatesOf();
          if (!visGateOf(slot.accIndex, g)) return null;   // 缺配饰 continue(:48179)——num 不进
          const torch = !!this.game.world.flags.unlockedBiomeTorches;
          const pushUp = builderAccTotalIcons(g, torch) >= 10;
          // start=(10,77)（:48241）;start.Y += 24*torchGodIcons（:48166,★SW-RB11f F4
          //  旧实现漏此支——炬神恩赐开∧total<10 时图标列与方块替换/群系炬图标重叠）;
          // flag(total>=10) → vector.Y -= 24（:48167-48169）;
          // 行号 = 已画图标数（num 只对实际画出的槽 ++ :48362——隐藏槽不留空行）
          const drawn = BUILDER_ACC_ICON_ORDER.slice(0, i)
            .filter((s2) => visGateOf(s2.accIndex, g)).length;
          const y0 = builderAccColumnTopY(torch, pushUp);
          const idx = slot.accIndex;
          b.style.backgroundPosition = `${-idx * 16}px -16px`;   // rect(0,16,14,14) X=idx*16
          paintSlot(i);
          // ★反馈轮7 定谳(用户原版截图证伪旧"顶格"实现):vector=【中心锚】——
          //   spriteBatch.Draw(..., origin: rectangle.Size()/2f)(Main.cs:48354),
          //   hover 盒 CenteredRectangle(vector,14)(:48197)同心 ⇒ 精灵左上=vector-(7,7)
          //   =(3,70+24n)。旧 (10,y) 顶格画=整体右/下偏 7px=用户报的错位。
          return { x: 10 - 7, y: y0 + drawn * 24 - 7 };
        },
      });
    });

    // 方块替换图标（Main.cs:43242-43280 DrawBlockReplacementIcon @(0,44/23) 音 22）
    {
      const b = el('button', 'vinv-btn') as HTMLButtonElement;
      b.style.cssText = 'width:22px; height:20px; image-rendering:pixelated;'
        + 'background-image:url(sprites/vanilla-ui/UI_BlockReplace_0.png); background-size:72px 22px;';
      const paint = (): void => {
        const on = statusOf()[BACC.BlockSwap] === 0;
        b.style.backgroundPosition = `${on ? 0 : -24}px 0px`;  // Frame(3,1,on?0:1) :43251
      };
      // ★2026-09-13 反馈轮6:hover 名走自有气泡(:43260-43266 MouseText 域)
      this.vinvBindHoverTip(b, () =>
        Lang.text(statusOf()[BACC.BlockSwap] === 0 ? 'GameUI.BlockReplacerOn' : 'GameUI.BlockReplacerOff'));
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        toggleBuilderAccBit(statusOf(), BACC.BlockSwap);
        this.game?.sfx.play('unlock', 1);           // SoundEngine.PlaySound(22) :43268
        paint();
        this.showBuffTooltip((e.currentTarget as HTMLElement), Lang.text(statusOf()[BACC.BlockSwap] === 0 ? 'GameUI.BlockReplacerOn' : 'GameUI.BlockReplacerOff'), '');
      });
      root.appendChild(b);
      this.vinvLayoutItems.push({
        el: b,
        pos: () => {
          const c = this.vinvLayoutCtx;
          if (!c || !this.game) return null;
          const g = gatesOf();
          const pushUp = builderAccTotalIcons(g, !!this.game.world.flags.unlockedBiomeTorches) >= 10;
          paint();
          return { x: 0, y: pushUp ? 23 : 44 };     // :43246-43250
        },
      });
    }

    // 群系炬图标（Main.cs:43282-43320 DrawTorchBiomeSwapIcon @(0,68/47),Extra_211 四帧,
    // unlockedBiomeTorches 才画 :48370——本仓 flags.unlockedBiomeTorches 同源）
    {
      const b = el('button', 'vinv-btn') as HTMLButtonElement;
      b.style.cssText = 'width:24px; height:22px; image-rendering:pixelated;'
        + 'background-image:url(sprites/vanilla/Extra_211.png); background-size:104px 24px;';
      const paint = (): void => {
        const on = statusOf()[BACC.TorchBiome] === 0;
        b.style.backgroundPosition = `${(on ? 1 : 0) * -26}px 0px`;   // Frame(4,1,on?1:0) :43291
      };
      // ★2026-09-13 反馈轮6:hover 名走自有气泡(:43300-43306 MouseText 域)
      this.vinvBindHoverTip(b, () =>
        Lang.text(statusOf()[BACC.TorchBiome] === 0 ? 'GameUI.TorchTypeSwapperOn' : 'GameUI.TorchTypeSwapperOff'));
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        toggleBuilderAccBit(statusOf(), BACC.TorchBiome);
        this.game?.sfx.play('unlock', 1);           // SoundEngine.PlaySound(22) :43308
        paint();
        this.showBuffTooltip((e.currentTarget as HTMLElement), Lang.text(statusOf()[BACC.TorchBiome] === 0 ? 'GameUI.TorchTypeSwapperOn' : 'GameUI.TorchTypeSwapperOff'), '');
      });
      root.appendChild(b);
      this.vinvLayoutItems.push({
        el: b,
        pos: () => {
          const c = this.vinvLayoutCtx;
          if (!c || !this.game) return null;
          if (!this.game.world.flags.unlockedBiomeTorches) return null;   // :48370 门
          const g = gatesOf();
          const pushUp = builderAccTotalIcons(g, true) >= 10;
          paint();
          return { x: 0, y: pushUp ? 47 : 68 };     // :43289-43292
        },
      });
    }
  }
  private vinvBuildChest(): void {
    // 名字(Main.cs:504,invBottom;openChestPanel 的 bankNames 语义在 paint 侧回写)
    // ★SW-FX28 刀①:坐标迁 vanillaInvLayout.CHEST_NAME_XY 单源(ChestUI.cs:158)
    const nameEl = el('div', 'vinv-txt');
    // ★SW-RB13b:pointer-events:none(.vinv-txt 基线)——DrawName(ChestUI.cs:158)纯
    //   DrawString 无命中盒,且 (504,258) 在箱域 FloatIntersect(:84 x≤495.8)外;
    //   曾 auto=无处理器的世界点击死区(504..~580 × 258..~273)
    // ★2026-09-14 用户报:四向描边(亮背景可读,同钮列);★F3/RB28 2026-09-14:
    //   1px 对角族统一为原版 DrawBorderStringFourWay ±2px 轴向族(与 canvas
    //   MouseText/InfoAccs 行同式,text-shadow 轴向转录)
    nameEl.style.cssText += 'font-size:13px;'
      + ' text-shadow:2px 0 0 #000,-2px 0 0 #000,0 2px 0 #000,0 -2px 0 #000;';
    this.vinvRoot?.appendChild(nameEl);
    this.vinvChestNameEl = nameEl;
    this.vinvLayoutItems.push({ el: nameEl, pos: () => {
      // ★SW-FX30 刀②:网格态吞箱条面(ChestUI.cs:81 chest!=-1 && !PipsUseGrid && !modern——
      // 原版 PipsUseGrid 时不画箱名/按钮/槽)。★SW-RB14b:补第三门 !NewCraftingUI.Visible
      // (ChestUI.cs:81 三门 verbatim;1458 同行)——FX41 modern 窗落地+craftingGridControl
      // 缺省回切 modern 后窗开态可达:开箱→开窗,原版箱条整面让位,本仓曾滞留叠画
      if (!this.openChest || this.vinvPipsUseGrid || this.vinvModernCraftOpen) return null;
      return { x: CHEST_NAME_XY.x, y: CHEST_NAME_XY.y };
    } });
    // 40 槽(scale 0.755;context 3/4/32 由 slotContext('chest') 经 openChest.x 分派)
    // ★SW-FX28 刀①:几何迁 vanillaInvLayout.chestSlotXY/CHEST_SCALE 单源
    // (ChestUI.cs:358/:375-376;行主序 num4=i+j*10 :372)
    for (let i = 0; i < 40; i++) {
      const s = this.vinvMakeSlot('chest', i, CHEST_SCALE);
      this.vinvRoot?.appendChild(s);
      const { x, y } = chestSlotXY(i);
      // ★SW-RB14b:第三门 !NewCraftingUI.Visible(ChestUI.cs:81 三门 verbatim,1458 同行)
      this.vinvLayoutItems.push({ el: s, pos: () => (this.openChest && !this.vinvPipsUseGrid && !this.vinvModernCraftOpen ? { x, y } : null) });   // ChestUI.cs:81 网格态吞箱槽(SW-FX30/SW-RB14b)
    }
    // 按钮列(DrawButtons :182-188:Y=invBottom+40+ID·26,ID 跳号位保留;
    // ID0 拿走全部/1 存放全部/2 快速堆叠/3 补货(inter[82])/4 排列物品(inter[122]);
    // ★BJ69(2026-09-14):ID5 重命名落地(:193 仅真箱 chest>-1 可见——储蓄族 x<0 隐藏;
    //   点击=RenameChest :823 OpenVirtualKeyboard(2) 的 DOM 对话承载,见 showChestRenameDialog);
    //   ID6 取消(RenameChestCancel :859)原版仅 editChest 态可见(:193 !editChest 隐藏)——
    //   本仓编辑态=模态对话面板域,取消钮在面板内,列位 ID6 恒不可见=不落(结构注)
    //   文本 0.75 缩放 hover 1)
    // ★SW-RB13b:①悬停色=OurFavoriteColor(Main.cs:886=(255,231,69);DrawButton :227
    //   flag→color=OurFavoriteColor),曾 #c8f0c8 自创绿;②锚=竖直居中(origin=vector/2
    //   :234 → 文本中线在 Y,命中盒 Y-12..Y+12 :223;DOM 用 translateY(-50%)+5.5px
    //   上下 padding 复刻 24px 命中带,x 左对齐 506(:222 X-num2=506)不偏)
    const mkChestBtn = (id: number, labelKey: string, act: () => void, visible?: () => boolean, label?: string): void => {
      const b = el('button', 'vinv-txt') as HTMLButtonElement;
      // ★2026-09-14 用户报:1px 阴影在亮背景下可见性弱 → 四向描边(同信息栏行);
      //   ★F3/RB28 2026-09-14:统一 2px 轴向族(DrawBorderStringFourWay ±2px,与
      //   canvas MouseText/箱名同式)
      b.style.cssText = 'left:506px; font-size:13px; pointer-events:auto; cursor:pointer;'
        + 'background:none; border:none; padding:5.5px 0; color:#fff;'
        + 'text-shadow:2px 0 0 #000,-2px 0 0 #000,0 2px 0 #000,0 -2px 0 #000;'
        + 'transform:translateY(-50%);';
      b.textContent = label ?? Lang.text(labelKey);
      b.addEventListener('mouseenter', () => { b.style.color = 'rgb(255,231,69)'; });
      b.addEventListener('mouseleave', () => { b.style.color = '#fff'; });
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); act(); });
      this.vinvRoot?.appendChild(b);
      this.vinvLayoutItems.push({ el: b, pos: () => {
        // ★SW-RB14b:补第三门 !NewCraftingUI.Visible(ChestUI.cs:81 三门 verbatim,1458 同行)
        if (!this.openChest || this.vinvPipsUseGrid || this.vinvModernCraftOpen) return null;   // ChestUI.cs:81 网格态吞钮(SW-FX30/SW-RB14b)
        if (visible && !visible()) return null;
        return chestButtonXY(id);   // ★SW-FX28 刀①:单源(ChestUI.cs:186/:198 Y+=ID*26)
      } });
      this.vinvChestBtnEls.push(b);
    };
    // 标签 = 自有键(官中现译 拿走全部/存放全部——vanilla 分片 全部拿走/全部放入
    // 与用户原版不符,且非 en 的 custom 无法覆盖既有 vanilla 键,故走自有键)
    mkChestBtn(0, 'Mods.SandboxWorld.Chest.LootAll', () => this.chestLootAll());
    mkChestBtn(1, 'Mods.SandboxWorld.Chest.DepositAll', () => this.chestDepositAll());
    mkChestBtn(2, 'Mods.SandboxWorld.Chest.QuickStack', () => this.chestQuickStack());
    mkChestBtn(3, 'Mods.SandboxWorld.Chest.Restock', () => this.chestRestock());      // 补货
    mkChestBtn(4, 'Mods.SandboxWorld.Chest.Arrange', () => this.chestSortChest());   // 排列物品
    // ID5 重命名(DrawButton :193 chest<-1 隐藏=仅世界箱;标签=inter[61] 官译「重命名」,
    // editChest 态标签切换 inter[47] 由对话面板承载=原版桌面态 fancyUI 覆盖同相)
    mkChestBtn(5, 'LegacyInterface.61', () => this.showChestRenameDialog(),
      () => (this.openChest?.x ?? -1) >= 0, Lang.inter(61));
  }

  /** 宝箱名回写(DrawName Main.cs :102-180 1:1):bank x<0=官译物品名;世界箱=
   *  命名箱名或 LegacyChestType[frameX/36] 箱型名(:122;★SW-FX11 2026-09-10:
   *  ChestData.name 已随档携带——原版 .wld 导入箱名自此回显。★BJ69 2026-09-14:
   *  重命名 UI 已落地=showChestRenameDialog,债清) */
  private vinvUpdateChestName(): void {
    const c = this.openChest;
    const el = this.vinvChestNameEl;
    if (!el || !c) return;
    if (c.x >= 0) {
      // 原版 DrawName 命名支（Main.cs:102-180）：chest.name 非空 → 箱名优先于型名
      if (c.name) { el.textContent = c.name; return; }
      el.textContent = this.vinvChestTypeName(c) ?? Lang.text('Mods.SandboxWorld.UI.Chest');
      return;
    }
    const bankNames: Record<number, string> = {
      [-2]: Lang.itemName(87) ?? '存钱罐',
      [-3]: Lang.itemName(346) ?? '保险箱',
      [-4]: Lang.itemName(3813) ?? '守护者熔炉',
      [-5]: Lang.itemName(4076) ?? '虚空保险库',
    };
    el.textContent = bankNames[c.x] ?? ((c as { name?: string }).name || Lang.text('Mods.SandboxWorld.UI.Chest'));
  }

  /** 箱型名（ChestUI.DrawName :118-136 分支序 1:1；★BJ69：重命名对话的
   *  defaultChestName 同源——OpenVirtualKeyboard(2) IngameFancyUI.cs:102-119
   *  同一分支结构。★BJ91（2026-09-15 RB17b note④）补 467/88 两支：
   *  467(Containers2) style 4 = GetItemNameValue(3988) 死人宝箱 / 其余 =
   *  LegacyChestType2[frameX/36]；88 梳妆台 = LegacyDresserType[frameX/54]
   *  （54 档 stride=3 tile×18,≠箱 36）。键面 zh-Hans 全量在册
   *  （LegacyChestType2.0-37/LegacyDresserType.0-64,Lang.cs:48-51 数组源）；
   *  1458 同域核对 DrawName :102-180/IngameFancyUI :102-119 零漂移） */
  private vinvChestTypeName(c: ChestData): string | null {
    if (c.x < 0 || c.x === undefined) return null;
    const st = this.game.world.store;
    const idx = st.idx(c.x, c.y);
    const sheet = TILE_DEFS[st.type?.[idx] ?? -1]?.vanilla?.sheet ?? -1;
    const fx = st.frameX?.[idx] ?? 0;
    if (sheet === 21) return Lang.text(`LegacyChestType.${Math.floor(fx / 36)}`);
    if (sheet === 467) {
      if (Math.floor(fx / 36) === 4) return Lang.itemName(3988) ?? '死人宝箱';
      return Lang.text(`LegacyChestType2.${Math.floor(fx / 36)}`);
    }
    if (sheet === 88) return Lang.text(`LegacyDresserType.${Math.floor(fx / 54)}`);
    return null;
  }

  // ---- 箱改名对话（★BJ69 2026-09-14；ChestUI.RenameChest :823-864 + IngameFancyUI.
  //      OpenVirtualKeyboard(2) :86-153 1:1,DOM 对话承载=路牌双态对话同款近似）----
  //  原版流：ID5 点击 → RenameChest :823 !editChest → OpenVirtualKeyboard(2)：
  //  Sound 12(:89) + npcChatText=chest.name（空则 defaultChestName=型名 :96-113）+
  //  editChest=true(:115) + UIVirtualKeyboard(maxLength=20 :159/:429)。确认 →
  //  RenameChestSubmit(:836)；取消 → RenameChestCancel(:859)。编辑态 DrawName 预览
  //  （:106/:160）由面板输入框本相承载（桌面 fancyUI 覆盖世界=同相不可见）。
  private vinvChestRenameEl: HTMLElement | null = null;

  private showChestRenameDialog(): void {
    const c = this.openChest;
    if (!c || c.x < 0) return;                       // RenameChest :825 真箱域
    if (this.vinvChestRenameEl) this.vinvChestRenameEl.remove();
    UISfx.click();                                   // OpenVirtualKeyboard :89 Sound 12
    const defName = this.vinvChestTypeName(c);
    const panel = el('div', 'sw-panel');
    panel.style.cssText = 'pointer-events:auto; position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:360px;';
    panel.appendChild(el('div', 'sw-title', Lang.text('UI.EnterNewName')));   // :92 EnterNewName
    const input = el('input') as HTMLInputElement;
    input.value = c.name || defName || '';           // :93 npcChatText=chest.name;空→型名(:108-112)
    input.maxLength = 20;                            // UIVirtualKeyboard :159/:429 maxLength=20
    input.style.cssText = 'width:100%; box-sizing:border-box; font-size:13px; color:#d8d4e4;'
      + 'background:#14121c; border:1px solid #3a3350; border-radius:4px; padding:6px; margin-top:6px;';
    panel.appendChild(input);
    const row = el('div');
    row.style.cssText = 'display:flex; gap:8px; margin-top:10px; justify-content:flex-end;';
    const cancelBtn = el('button', 'sw-btn', Lang.inter(63));   // inter[63] 取消（:216/:863）
    cancelBtn.addEventListener('click', () => {                  // RenameChestCancel :859-864
      UISfx.click();                                             // Sound 12（:860）
      this.closeChestRenameDialog();
    });
    const saveBtn = el('button', 'sw-btn', Lang.inter(47));     // inter[47] 保存（editChest 态 ID5 标签 :216）
    saveBtn.addEventListener('click', () => {
      this.chestRenameSubmit(input.value);                     // RenameChestSubmit :836-853（Sound 12 在内）
      this.closeChestRenameDialog();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();                          // 键位面隔离（Esc 链/热栏数字不串）
      if (e.key === 'Enter') {                      // UIVirtualKeyboard Enter=submit
        this.chestRenameSubmit((e.currentTarget as HTMLInputElement).value);
        this.closeChestRenameDialog();
      } else if (e.key === 'Escape') {              // UIVirtualKeyboard Esc=cancel
        UISfx.click();
        this.closeChestRenameDialog();
      }
    });
    row.appendChild(cancelBtn);
    row.appendChild(saveBtn);
    panel.appendChild(row);
    this.root.appendChild(panel);
    this.vinvChestRenameEl = panel;
    input.focus();
    input.select();
  }

  private closeChestRenameDialog(): void {
    this.vinvChestRenameEl?.remove();
    this.vinvChestRenameEl = null;
  }

  /** 箱改名提交（ChestUI.RenameChestSubmit Player.cs 域 :836-853 1:1）：
   *  chest<0（储蓄族）整支拒（:840-843）;提交名==defaultChestName(型名) → 存空=
   *  重置默认（:846-848）;chest.name 变更才落（:849-850）+ editedChestName=true
   *  （:851-853 netMode==1）→ 本仓等价=chestRenameLatch（下条 msg33 携改名尾段）。
   *  单人（无 net）=仅本地写（ChestData.name 随档持久,FX11 环）。 */
  private chestRenameSubmit(input: string): void {
    const c = this.openChest;
    if (!c || c.x < 0) return;
    UISfx.click();                                   // :837 SoundEngine.PlaySound(12)
    const name = input === (this.vinvChestTypeName(c) ?? '') ? '' : input;
    if ((c.name ?? '') !== name) {
      c.name = name || undefined;                    // :850 空串=型名回显域（netApplyChestName 同编码）
      this.game.net?.chestRenameLatch(name);         // :851-853 editedChestName=true 等价位
    }
    this.refreshAll();                               // vinvUpdateChestName 回写（DrawName 下帧同相）
  }

  // ---- 商店货架(★SW-FX32 刀①店侧分期二;Main.cs:42500-42532 DrawInventory 商店段) ----
  //  原版店开态无独立面板:货架 40 格=箱条同格(context 15 :42529,scale 0.755 :42513),
  //  店名/储蓄同位 (504,invBottom) (:42502-42503),快乐度图标+倍率 (:42504-42512,
  //  offsets Main.cs:67677-67680),PipsUseGrid 态整段不画 (:42500 门)。原版无
  //  Set-Back 钮——关店 = Esc/对话关闭/走远(closeNpcDialog → npcShopClose)。
  //  几何单源 vanillaInvLayout(shopSlotXY/SHOP_TITLE_XY/happiness 族)。
  private vinvShopPayload: { title: string; entries: ShopEntry[]; copper: number; happinessMul: number; medals?: number; medalsTotal?: number } | null = null;
  private vinvShopCells: HTMLDivElement[] = [];
  private vinvShopTitleEl: HTMLElement | null = null;
  private vinvShopSavedEl: HTMLElement | null = null;
  private vinvShopCoinIcons: HTMLImageElement[] = [];   // ★BJ421:币图标逐 j 中心锚(曾 coinRow 单容器=计数竖排撞快乐带)
  private vinvShopCoinCnts: HTMLElement[] = [];
  private vinvShopBankImgs: HTMLImageElement[] = [];
  private vinvShopHappyIcon: HTMLElement | null = null;
  private vinvShopHappyText: HTMLElement | null = null;

  /** 显示门(Main.cs:42500 `npcShop > 0 && !PipsUseGrid`——网格态货架/店名/储蓄/
   *  快乐度整段不画;SW-FX30 箱条 ChestUI.cs:81 同面) */
  private vinvShopVisible(): boolean {
    return !!this.game?.npcShopOpen && !this.vinvPipsUseGrid;
  }

  private vinvBuildShop(): void {
    const root = this.vinvRoot;
    if (!root) return;
    const vis = (): boolean => this.vinvShopVisible();

    // 店名(Main.cs:42502 Lang.inter[28] @(504,invBottom)——payload title 即 Lang.inter(28);
    // 13px = 刀11 MouseText 同档族定标:原版店名/箱名同为 scale-1 DrawString(:42502 vs
    // ChestUI.cs:161 Vector2.One),★SW-RB14b:曾 15px 与箱名 13px 同面两档=内不一致,对齐)
    const title = el('div', 'vinv-txt');
    title.style.cssText = 'font-size:13px;';
    root.appendChild(title);
    this.vinvShopTitleEl = title;
    this.vinvLayoutItems.push({ el: title, pos: () => (vis() ? { x: SHOP_TITLE_XY.x, y: SHOP_TITLE_XY.y } : null) });

    // 储蓄行标签(Main.cs:42503 → ItemSlot.DrawSavings ItemSlot.cs:3717-3757 →
    //  DrawMoney :3671 Lang.inter[66] @(shopx,shopy+40);num5>0 才画 :3726)
    const saved = el('div', 'vinv-txt');
    saved.style.cssText = 'font-size:13px;';
    saved.textContent = Lang.text('LegacyInterface.66');
    root.appendChild(saved);
    this.vinvShopSavedEl = saved;
    this.vinvLayoutItems.push({ el: saved, pos: () => {
      if (!vis() || !(this.game && this.game.coinSavingsCopper() > 0)) return null;
      return shopSavingsLabelXY();
    } });

    // 四银行小图标(ItemSlot.cs:3727-3740:该仓有币才画,CenteredRectangle 中心
    //  (shopx+off) 贴图 ×0.65;iconUrl 32px 代理贴图=尺寸偏差备案)
    for (const def of SHOP_SAVINGS_BANK_ICONS) {
      const img = document.createElement('img');
      img.draggable = false;
      img.style.cssText = `position:absolute; width:${32 * SHOP_SAVINGS_ICON_SCALE}px;`
        + `height:${32 * SHOP_SAVINGS_ICON_SCALE}px; image-rendering:pixelated; pointer-events:none;`;
      root.appendChild(img);
      this.vinvShopBankImgs.push(img);
      const wHalf = (32 * SHOP_SAVINGS_ICON_SCALE) / 2;
      this.vinvLayoutItems.push({ el: img, pos: () => {
        const g = this.game;
        if (!vis() || !g || !(g.coinSavingsCopper() > 0)) return null;
        if (!(g.coinSavingsByBank()[def.bank] > 0)) return null;
        if (!img.getAttribute('src')) {
          const u = iconUrl(g, internalIdOfVid(def.vid));
          if (u) img.src = u;
        }
        return { x: SHOP_TITLE_XY.x + def.off.x - wHalf, y: SHOP_TITLE_XY.y + def.off.y - wHalf };
      } });
    }

    // 币图标+计数(ItemSlot.cs:3699-3710:j=0..3 币种 74-j=铂/金/银/铜。图标=【中心】
    //  锚 @(shopx+11+24j,shopy+75)——DrawItemCoin CoinSlot.cs:254-270 origin=Size()/2,
    //  DOM 20px 盒中心锚=尺寸偏差备案;计数文字=【同带交叠】字形左上 @(shopx+24j+num2,
    //  字形顶=shopy+75) :3705-3710 origin(0,LineSpacing=24)→顶=position−18,0.75 缩放
    //  DOM 以 12px 近似=字体度量偏差备案;num2=−6 仅铂>99 :3698(refresh 乘,免布局签)。
    //  计数覆图标下半=原版同款画序(DOM 后插在上)。★BJ421(2026-09-23 用户实报):曾
    //  coinRow 单容器把 (515+24j,333) 当左上+图标上/计数下竖排,计数带 ~353..368 撞
    //  快乐图标(354..378)/「100%」(356..)——原版两行天然不叠(计数带≤351<354),
    //  改逐 j 双 item 消费 shopSavingsCoinXY/TextXY;>0 才画整行 :3726)
    for (let j = 0; j < 4; j++) {
      const icon = document.createElement('img');
      icon.draggable = false;
      icon.style.cssText = 'position:absolute; width:20px; height:20px;'
        + 'image-rendering:pixelated; pointer-events:none;';
      icon.src = (this.game ? iconUrl(this.game, internalIdOfVid(74 - j)) : '') || '';
      root.appendChild(icon);
      this.vinvShopCoinIcons.push(icon);
      const wHalf = 10;
      this.vinvLayoutItems.push({ el: icon, pos: () => {
        if (!vis() || !(this.game && this.game.coinSavingsCopper() > 0)) return null;
        const c = shopSavingsCoinXY(j);
        return { x: c.x - wHalf, y: c.y - wHalf };
      } });
      const cnt = el('div');
      cnt.style.cssText = 'position:absolute; font-size:12px; line-height:12px;'
        + 'color:#fff; text-shadow:1px 1px 0 #000; white-space:nowrap;';
      root.appendChild(cnt);
      this.vinvShopCoinCnts.push(cnt);
      this.vinvLayoutItems.push({ el: cnt, pos: () => {
        if (!vis() || !(this.game && this.game.coinSavingsCopper() > 0)) return null;
        return shopSavingsCoinTextXY(j);   // num2 −6 由 vinvRefreshShop marginLeft 乘(:3698)
      } });
    }

    // 快乐度表情(Main.cs:42504-42509:NPCHappiness 4 帧 Frame(4,1,frameX),中心锚
    //  (504+12,invBottom+108) scale 1——Main.cs:67679-67680 offsets;恒画,帧随
    //  PriceAdjustment :42506 三元链)
    const happy = el('div');
    happy.style.cssText = 'position:absolute; width:24px; height:24px; image-rendering:pixelated;'
      + 'pointer-events:none;background:url(sprites/vanilla-ui/UI_NPCHappiness.png); background-size:96px 24px;';
    root.appendChild(happy);
    this.vinvShopHappyIcon = happy;
    this.vinvLayoutItems.push({ el: happy, pos: () => {
      if (!vis()) return null;
      const c = shopHappinessIconXY();
      return { x: c.x - 12, y: c.y - 12 };
    } });
    // 倍率文字(Main.cs:42510-42512 pa.ToString("P0") @(504+26,invBottom+98))
    const happyTxt = el('div', 'vinv-txt');
    happyTxt.style.cssText = 'font-size:13px; color:#fff;';
    root.appendChild(happyTxt);
    this.vinvShopHappyText = happyTxt;
    this.vinvLayoutItems.push({ el: happyTxt, pos: () => (vis() ? shopHappinessTextXY() : null) });

    // 货架 40 格(Main.cs:42518-42532:10×4 行主序 slot3=num76+num77·10,context 15;
    //  空格同样以 InventoryBack 底框绘制 :42531=售卖放置区。★非 makeSlotEl——
    //  商品格语义=买/卖放置区,非拾放;交互直连 Game.npcShopBuy/npcShopSellHeld)
    for (let i = 0; i < 40; i++) {
      const cell = document.createElement('div');
      cell.className = 'sw-slot sw-vshop-cell';
      cell.dataset.vshop = String(i);
      cell.style.cssText = 'width:52px; height:52px; cursor:pointer;';
      const entry = (): ShopEntry | undefined => this.vinvShopPayload?.entries[i];
      cell.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.button !== 0) return;   // 右键不买不卖(RightClick→HandleShopSlot CanStack 早退 ItemSlot.cs:1878-1881)
        const it = entry();
        if (!it) {
          // 空格 = 唯一卖出放置区(PickItemMovementAction case 15 ItemSlot.cs:1435-1438
          //  空格+持有非币 → result 4 → LeftClick case 4 :1195-1212 SellItem 整叠)
          if (this.heldStack && this.game?.npcShopSellHeld(this.heldStack)) {
            this.heldStack = null;   // SellItem 成交:光标 SetDefaults(0) :1116
            this.refreshAll();
          }
          return;
        }
        if ((e.currentTarget as HTMLElement).dataset.ok !== '1') return;   // 买不起 = 无动作(原版 BuyItem 静默失败)
        const bulk = e.shiftKey || undefined;  // Shift 批量买 10(GetBulkBuyAmount ItemSlot.cs:2861-2870)
        const held = this.heldStack;
        if (held) {
          this.game?.npcShopBuy(it.vanillaId, it.buyback, held, bulk);   // 同型 CanStack :1431 → 叠光标
          this.refreshAll();
          return;
        }
        this.game?.npcShopBuy(it.vanillaId, it.buyback, undefined, bulk);
      });
      // 格位悬停 = MouseHover context 15(单源 showShopCellTooltip;SW-BJ22 语义面)
      cell.addEventListener('mouseenter', (e) => {
        const it = entry();
        if (!it) return;
        this.showShopCellTooltip({ vid: it.vanillaId, stack: 1, prefix: it.prefix, buyback: it.buyback }, (e.currentTarget as HTMLElement));
      });
      cell.addEventListener('mouseleave', () => this.showShopCellTooltip(null, null));
      root.appendChild(cell);
      this.vinvShopCells.push(cell);
      const { x, y } = shopSlotXY(i);   // ★SW-FX32 单源(Main.cs:42522-42523=箱条同格)
      this.vinvLayoutItems.push({ el: cell, pos: () => (vis() ? { x, y } : null) });
    }
  }

  /** 货架内容+头部回写(paintVanillaInvSlots/showNpcShop/图标轮询共用;显示面由
   *  vinvLayoutItems pos 门管辖,本函数只写内容与格位着色) */
  private vinvRefreshShop(): void {
    const g = this.game;
    if (!g || !this.vinvRoot) return;
    const pay = this.vinvShopPayload;
    const on = this.vinvShopVisible() && !!pay;
    // 店名(Main.cs:42502:恒 inter[28],payload title 即 Game 侧 Lang.inter(28))
    if (this.vinvShopTitleEl) this.vinvShopTitleEl.textContent = pay?.title ?? '';
    // 快乐度帧/文案(:42506/:42510——mul≤0.82→0/≤1→1/≤1.1→2/其余→3)
    const mul = pay?.happinessMul ?? 1;
    if (this.vinvShopHappyIcon) this.vinvShopHappyIcon.style.backgroundPosition = `${-happinessFrameX(mul) * 24}px 0px`;
    if (this.vinvShopHappyText) this.vinvShopHappyText.textContent = happinessPct(mul);
    // 币计数(ItemSlot.cs:3705-3710 split[3-j],帽 999 :3704-3706;num2=−6 仅铂>99
    //  :3698——marginLeft 乘,随计数同拍刷新免入布局签)
    if (on && this.vinvShopCoinCnts.length) {
      const split = g.coinSavingsSplit();
      for (let j = 0; j < 4; j++) {
        const cnt = this.vinvShopCoinCnts[j];
        if (!cnt) continue;
        cnt.textContent = String(Math.min(999, split[3 - j]));
        cnt.style.marginLeft = (j === 0 && split[3] > 99) ? '-6px' : '';
      }
    }
    // 40 格内容(Main.cs:42531 逐格 ItemSlot.Draw;afford 着色=经典面同款呈现,
    //  原版无买不起调暗=呈现偏差备案)
    for (let i = 0; i < this.vinvShopCells.length; i++) {
      const cell = this.vinvShopCells[i];
      const it = on ? pay!.entries[i] : undefined;
      if (!it) {
        cell.classList.add('is-empty');
        cell.classList.remove('is-poor');
        delete cell.dataset.ok;
        if (cell.childElementCount) this.paintSlot(cell, null);
        continue;
      }
      cell.classList.remove('is-empty');
      const ok = it.medal !== undefined
        ? (pay!.medalsTotal ?? pay!.medals ?? 0) >= it.medal
        : pay!.copper >= it.price;
      cell.dataset.ok = ok ? '1' : '0';
      cell.classList.toggle('is-poor', !ok);
      const iid = internalIdOfVid(it.vanillaId);
      this.paintSlot(cell, iid >= 0 ? { id: iid, stack: it.stack ?? 1, prefix: it.prefix } : null);
    }
  }

  /** adjY(Main.cs:42239-42244:<700 → (sh-508)/2,否则 (sh-600)/2,整型) */
  private vinvCraftAdjY(sh: number): number {
    return sh < 700 ? Math.trunc((sh - 508) / 2) : Math.trunc((sh - 600) / 2);
  }
  /** middleY(Main.cs:42240-42249:<700 → sh/600·200;<850 → ·225;否则 ·250) */
  private vinvCraftMiddleY(sh: number): number {
    if (sh < 700) return Math.trunc(sh / 600 * 200);
    if (sh < 850) return Math.trunc(sh / 600 * 225);
    return Math.trunc(sh / 600 * 250);
  }
  private vinvRefreshCraft(): void {
    const game = this.game;
    if (!game) return;
    // ★SW-BJ85(2026-09-15) 债①:失效拍调用随滤器消费面退役(原版 :269-272 净死,
    //   见 vinvFilterRemain 头注);列表头文字恒 inter[25](见下块)。
    this.vinvGuideMenuExitCheck();   // ★刀19:向导态退出面(:42396-42400 每拍消费)
    let avail: Array<{ r: VanillaRecipeLike; count: number }>;
    // ★刀19:向导反查(Recipe.UpdateRecipeList :235-241)——guideItem 有件 →
    //   CollectGuideRecipes(Recipe.cs:441-460 全表 items 组匹配,不问站点/材料/可制性,
    //   filterHack 不消费=早退分支);空槽 → 常规可制列表(:42427 classic 无门)
    if (this.vinvGuideMenuOpen && this.guidePlaced) {
      const vid = this.vidOfItemOf(this.guidePlaced.id);
      avail = VANILLA_RECIPES.filter((r) => r.items.some((req) => req.id === vid
        || (req.id >= 1000000 && (RECIPE_GROUP_ITEMS[String(req.id - 1000000)] ?? []).includes(vid))))
        .map((r) => ({ r, count: 0 }));   // count 不消费:guide 模式拥有数整支不画(NewCraftingUI.cs:482)
    } else {
      avail = game.vanillaAvailableRecipes();
    }
    // ★SW-BJ85(2026-09-15) 债①:滤器消费面退役=原版净死对齐——RecipeFilterHack
    //   getter(CraftingUI.cs:112-122)恒 null:_lastFilter 全树非空写点仅 OpenCloseFilter
    //   :154,其后 :155 IngameUIWindows.CloseAll(quiet:true) 尾部 ClearHacks(:69 →
    //   CraftingUI.cs:143)同拍即净(1456/1457/1458 三版同构,IngameUIWindows.cs 三版
    //   字节全等)⇒ ①Recipe.UpdateRecipeList :252 `filterHack == null` 支恒走=经典
    //   列表恒【全量邻接配方】(PlayerMeetsEnvironmentConditions 门,不再仅被击站过滤);
    //   ②DrawRecipesList :167-171 GetWindowDescription 支不可达=头文字恒 Lang.inter[25]。
    //   本仓对齐:vinvCraftFilter=f(openCraftingStationFilter :154)由 vinvCloseAllQuiet
    //   尾 ClearHacks 面即净;旧「站台名头文字+列表过滤」消费面(RB13b 消费门/FX30 刀⑦)
    //   退役。modern 窗滤器(NewCraftingUI._filter 活机制 :421/:622/:642/:657)不误伤。
    if (this.vinvCraftTitleEl && this.vinvCraftTitleEl.textContent !== Lang.inter(25)) {
      this.vinvCraftTitleEl.textContent = Lang.inter(25);   // :167
    }
    // 签名比对(r 引用静态+count)——配方集变化才重建格池
    const prev = this.vinvCraftAvailV;
    const unchanged = prev.length === avail.length
      && prev.every((p, i) => p.r === avail[i].r && p.count === avail[i].count);
    this.vinvCraftAvailV = avail;
    // ★SW-RB14d（FX38-F3）：重建期焦点 1:1（Recipe.UpdateRecipeList :228-256 +
    //  TryRefocusingRecipe :478-494 + VisuallyRepositionRecipes :131-139）：
    //  ①身份追焦——旧焦点配方在新表中的索引成为焦点（材料耗尽/离站致整表位移时,
    //  原版仍居中同一配方;旧刀只保索引=居中被挤入的另一配方）;
    //  ②钳制——找不到才钳 [0,n−1]（原文 :488-495 两道 if）;
    //  ③glideY【不变】——VisuallyRepositionRecipes 把新焦点行平移接管旧焦点行偏移,
    //  在 availableRecipeY[i]≡glideY+(i−focus)·65 不变式下,焦点行偏移恒=glideY
    //  ⇒任何重建分支 glideY 都保持原值。旧刀走 vinvCraftFocusGoto 的移焦播种
    //  （glideY+=(next−prev)·65）=重建支被施以移焦语义,钳位差 N 行 → 焦点行从
    //  ±N·65px 起步多行幻影滑行 ~0.7s,原版即刻落位无滑行。
    {
      const oldRecipe = prev[this.vinvCraftFocusV]?.r ?? null;
      let nextFocus = this.vinvCraftFocusV;
      if (oldRecipe !== null) {
        const idx = avail.findIndex((p2) => p2.r === oldRecipe);
        if (idx >= 0) nextFocus = idx;                 // :483-486 找到=身份位
      }
      if (nextFocus >= avail.length) nextFocus = avail.length - 1;   // :488-490
      if (nextFocus < 0) nextFocus = 0;                // :491-493
      this.vinvCraftFocusV = nextFocus;                // ③：直写,glideY 不动
    }
    if (!unchanged) {
      this.vinvRebuildCraftCells();
    }
    this.vinvUpdateCraftList();
    this.vinvUpdateCraftGrid();   // ★SW-FX30 刀②:网格视图随拍重排(分页钳制/页钮门)
    // ★SW-FX41:modern 窗内容随拍(UpdateContents :589-634 每拍语义;窗关时早退零开销)
    if (this.vinvModernCraftOpen) this.vinvUpdateModernCraft();
    if (this.vinvGuideMenuOpen) this.vinvPaintGuideCraft();   // ★刀19:文案/focus 行随拍
  }

  /** 格池重建(配方集变化)→ ★SUI-P1 惰性池(2026-09-18 用户实报「开背包/多宝箱开制作
   *  菜单变卡」定谳刀,探针 scripts/_uipanel-hitch-census.mjs:767 配方池开包帧
   *  vinvRebuildCraftCells 99.9ms=hitch 主源,配方扫描本身仅 0.7ms)。本函数现在只
   *  拆池不再建格:DOM 格由 vinvUpdateCraftList 按【鱼眼视窗】(原版 DrawRecipesList
   *  :186-201 只绘 |y_i|≤middleY 的窗内行)按需物化(vinvEnsureCraftCell)——窗外行
   *  原版本就不绘,不物化=像素零差;曾物化的窗外格 display:none 驻留复用。 */
  private vinvRebuildCraftCells(): void {
    const root = this.vinvRoot;
    if (!root) return;
    const dead = new Set<HTMLElement>();
    for (const c of this.vinvCraftCellEls) if (c) dead.add(c.el);
    this.vinvLayoutItems = this.vinvLayoutItems.filter((it) => !dead.has(it.el));
    for (const c of this.vinvCraftCellEls) if (c) c.el.remove();
    this.vinvCraftCellEls = new Array(this.vinvCraftAvailV.length).fill(null);
  }

  /** 单格物化(SUI-P1:原 vinvRebuildCraftCells 循环体原样迁入——DOM 结构/监听/贴图
   *  逐字节同,仅物化时点=首次进入鱼眼视窗;池柄 = vinvCraftCellEls[idx]) */
  private vinvEnsureCraftCell(idx: number): { el: HTMLElement } | null {
    const root = this.vinvRoot;
    const rec = this.vinvCraftAvailV[idx];
    if (!root || !rec || !this.game) return null;
    const outKey = vanillaItemKey(rec.r.create);
    const s = el('div', 'sw-slot');
    s.style.cssText = 'position:absolute; width:52px; height:52px; background-image:none;'
      + '--slot-bgimg:url(sprites/vanilla/Inventory_Back.png); transform-origin:top left;';
    const img = el('img') as HTMLImageElement;
    img.draggable = false;
    img.src = iconUrl(this.game, this.game.itemId(outKey ?? ''));
    s.appendChild(img);
    if (rec.r.createStack > 1) s.appendChild(el('span', 'cnt', String(rec.r.createStack)));
    s.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      // HoverOverCraftingItemButton :43020-43033:点非焦点=居中+音12(:43032-43035,
      //   无 recFastScroll ⇒ ★SW-FX38 走吸附滑行非瞬移);点焦点=合成
      if (this.vinvCraftFocusV !== idx) {
        this.vinvCraftFocusGoto(idx);
        this.game.sfx.play('menuTick', 1);
        this.vinvCraftSnapStep();
        return;
      }
      if (this.guidePlaced) return;   // ★刀19:反查态不合成(HoverOverCraftingItemButton :42988 guideItem.IsAir 门)
      // ★SW-BJ391：压拍合成+长按臂上膛（点焦点=合成 :43020-43033 压拍面）
      this.craftPressTick(rec.r, (ev as MouseEvent).shiftKey, s, 'fisheye');
      this.refreshAll();
    });
    s.style.setProperty('--slot-alpha', '1');   // 列表格距离渐隐走元素 opacity,退出脉冲
    s.addEventListener('mouseover', (e) => {
      // HoverItem = createItem.Clone()(:42978)→ 完整物品 tooltip
      const iid = this.game.itemId(vanillaItemKey(rec.r.create) ?? '');
      if (iid > 0) this.showTooltipFor(iid, 'inv', { slot: { id: iid, stack: rec.r.createStack }, anchor: (e.currentTarget as HTMLElement) });
      // hover 态(★用户实测三轮:原版悬停配方=描金背景)
      if (this.vinvCraftFocusV !== idx) (e.currentTarget as HTMLElement).style.setProperty('--slot-bgimg', 'url(sprites/vanilla/Inventory_Back14.png)');
    });
    s.addEventListener('mouseleave', (e) => {
      this.tooltip.style.display = 'none';
      cancelAnimationFrame(this.tooltipPulseRaf);
      (e.currentTarget as HTMLElement).style.setProperty('--slot-bgimg',
        `url(sprites/vanilla/Inventory_Back${this.vinvCraftFocusV === idx ? 14 : ''}.png)`);
    });
    // ★passive 化(2026-09-28 用户实报「背包变动刷 Violation」定谳刀):vinvCraftWheel
    //   全程无 preventDefault(仅 stopPropagation,passive 合法)=滚轮纯游戏语义消费,
    //   非滚动拦截;每格物化即新增 non-passive 监听=Chrome Violation 刷屏拍(格池
    //   拆建 churn 面,非泄漏)→ passive 化后 Violation 消,行为零变。
    s.addEventListener('wheel', (e) => this.vinvCraftWheel(e), { passive: true });
    root.appendChild(s);
    this.vinvCraftCellEls[idx] = { el: s };
    this.vinvLayoutItems.push({ el: s, pos: () => this.vinvCraftCellPos(idx) });
    // ★SW-BJ391 长按臂格池拆建换锚（池拆→惰性物化走本行;认 kind 防跨站 flip 锚）
    if (this.craftHold?.kind === 'fisheye' && this.craftHold.r === rec.r) this.craftHold.el = s;
    return this.vinvCraftCellEls[idx];
  }

  /** 鱼眼格几何(DrawRecipesList :186-201):y_i=(i-focus)·65+glideY(★SW-FX38 吸附偏移
   *  :398 availableRecipeY[i]=original+(i−focus)·65——剔界 :177/缩放 :181 吃【吸附值】);
   *  scale=max(0.75,100/(|y_i|+100));fast 态全体 0.75(:186-189 recFastScroll 支;
   *  本仓并门 glideY≠0=重开首拍 glideY=0 时按鱼眼渲染,原版 settle 帧序同相,1 帧差登记);
   *  x=trunc(46-26·scale);y=trunc(410+y_i·scale-30·scale+adjY);|y_i|>middleY 剔除(:188)
   *  ★SW-FX41:modern 窗开 = Main.cs:42418 else 分支整支不画 → 恒 null(隐藏) */
  private vinvCraftCellPos(i: number): { x: number; y: number } | null {
    const c = this.vinvLayoutCtx;
    if (!c || !this.vinvClassicCraftVisible()) return null;
    const adjY = this.vinvCraftAdjY(c.sh), middleY = this.vinvCraftMiddleY(c.sh);
    const yOff = (i - this.vinvCraftFocusV) * 65 + this.vinvCraftGlideY;
    if (Math.abs(yOff) > middleY) return null;
    const scale = this.vinvCraftFastScroll && this.vinvCraftGlideY !== 0
      ? 0.75
      : Math.max(0.75, 100 / (Math.abs(yOff) + 100));
    return {
      x: Math.trunc(46 - 26 * scale),
      y: Math.trunc(410 + yOff * scale - 30 * scale + adjY),
    };
  }

  /** 列表重排+焦点描金+边缘渐隐(GetItemSlotColors :358-370:alpha=A+50,
   *  |y|>middleY-100 起线性衰减;灰乘色=原版 inventoryBack 灰,A=150)。
   *  ★SUI-P1 惰性池消费面:窗外(pos=null=原版不绘)只对【已物化】格写 display:none
   *  (未物化格本就不在布局树);窗内先物化缺格再样式——像素面与全量物化版零差
   *  (实测面=display+left/top+transform+opacity+描金,逐式同),差只在「窗外格
   *  是否驻留 DOM」=不绘面,原版同不绘。 */
  private vinvUpdateCraftList(): void {
    const c = this.vinvLayoutCtx;
    if (!c) return;
    const middleY = this.vinvCraftMiddleY(c.sh);
    const A = 150;
    for (let i = 0; i < this.vinvCraftCellEls.length; i++) {
      const pos = this.vinvCraftCellPos(i);
      const handle = this.vinvCraftCellEls[i];
      if (!pos) {
        if (handle && handle.el.style.display !== 'none') handle.el.style.display = 'none';
        continue;
      }
      const h2 = handle ?? this.vinvEnsureCraftCell(i);
      if (!h2) continue;   // 防御:物化失败(无 root/越界)则本拍不绘(同窗外语义)
      const el = h2.el;
      // ★开包 hitch 刀(2026-09-29):逐式同值守卫——开包拍几何/透明度/描金不变=
      // 零 style 写(setProperty 同值仍脏化元素);滚动/移焦拍值变照常写,像素面零差
      if (el.style.display !== '') el.style.display = '';   // 曾窗外→回窗复位(物化格复用)
      const leftWant = `${pos.x}px`;
      if (el.style.left !== leftWant) el.style.left = leftWant;
      const topWant = `${pos.y}px`;
      if (el.style.top !== topWant) el.style.top = topWant;
      const yOff = (i - this.vinvCraftFocusV) * 65 + this.vinvCraftGlideY;   // ★SW-FX38 吸附值(GetItemSlotColors :358-369 吃 availableRecipeY=glideY+(i−focus)·65)
      const scale = this.vinvCraftFastScroll && this.vinvCraftGlideY !== 0
        ? 0.75
        : Math.max(0.75, 100 / (Math.abs(yOff) + 100));
      const tfWant = `scale(${scale})`;
      if (el.style.transform !== tfWant) el.style.transform = tfWant;
      let alpha = A + 50;
      if (Math.abs(yOff) > middleY - 100) {
        alpha = 150 * (100 - (Math.abs(yOff) - (middleY - 100))) * 0.01;
      }
      const opWant = String(Math.max(0, Math.min(1, alpha / 255)));
      if (el.style.opacity !== opWant) el.style.opacity = opWant;
      // 焦点槽描金(DrawGoldBGForCraftingMaterial 语义≈Back14 高亮 :206-213)
      const bgWant = `url(sprites/vanilla/Inventory_Back${i === this.vinvCraftFocusV ? 14 : ''}.png)`;
      if (el.style.getPropertyValue('--slot-bgimg') !== bgWant) {
        el.style.setProperty('--slot-bgimg', bgWant);
      }
    }
    this.vinvUpdateCraftMaterials();
  }

  /** 材料行(DrawRecipesList :225-287:focus 配方 requiredItem;x=80+j·40,
   *  y=380+adjY,scale 0.6;alpha=A-|y_focus|·2 远焦渐隐;悬停=材料 tooltip
   *  (SetRecipeMaterialDisplayName :447-460 组名覆写近似=材料本体 tooltip)) */
  private vinvUpdateCraftMaterials(): void {
    const mats = this.vinvCraftMatEl;
    const c = this.vinvLayoutCtx;
    if (!mats || !c) return;
    const rec = this.vinvCraftAvailV[this.vinvCraftFocusV];
    const sig = rec ? `${rec.r.create}|${rec.r.items.map((i2) => `${i2.id}:${i2.stack}`).join(',')}` : '';
    if (sig === this.vinvCraftMatSig) return;
    this.vinvCraftMatSig = sig;
    mats.replaceChildren();
    if (!rec) return;
    const alpha = Math.max(0, 150 / 255);
    rec.r.items.forEach((req, j) => {
      const k2 = ingredientKey(req.id);
      const x = 80 + j * 40, y = 380 + this.vinvCraftAdjY(c.sh);
      const box = el('div', 'sw-slot');
      box.style.cssText = `position:absolute; left:${x}px; top:${y}px; width:52px; height:52px;`
        + 'background-image:none; --slot-bgimg:url(sprites/vanilla/Inventory_Back.png);'
        + 'transform:scale(0.6); transform-origin:top left;';
      const img = el('img') as HTMLImageElement;
      img.draggable = false;
      img.src = k2 ? iconUrl(this.game, this.game.itemId(k2)) : '';
      box.appendChild(img);
      if (req.stack > 1) box.appendChild(el('span', 'cnt', String(req.stack)));
      box.style.pointerEvents = 'auto';
      box.addEventListener('mouseover', (e) => {
        const iid = k2 ? this.game.itemId(k2) : -1;
        if (iid > 0) this.showTooltipFor(iid, 'inv', { slot: { id: iid, stack: req.stack }, anchor: (e.currentTarget as HTMLElement) });
      });
      box.addEventListener('mouseleave', () => { this.tooltip.style.display = 'none'; cancelAnimationFrame(this.tooltipPulseRaf); });
      box.addEventListener('wheel', (e) => this.vinvCraftWheel(e), { passive: true });   // 同鱼眼格 passive 化判(无 preventDefault)
      mats.appendChild(box);
    });
  }

  /** ★SUI-P1 惰性池:null=未物化(不在 DOM);物化格驻留复用(窗外仅 display:none) */
  private vinvCraftCellEls: Array<{ el: HTMLElement } | null> = [];
  private vinvCraftTitleEl: HTMLElement | null = null;
  private vinvCraftMatEl: HTMLElement | null = null;
  private vinvCraftMatSig = '';
  // ---- ★SW-FX30 刀②+⑦ 网格态(Main.PipsUseGrid/Main.recStart/CraftingUI._lastFilter) ----
  /** Main.PipsUseGrid(Main.cs:1794):经典网格视图态。生命周期 = 切换钮左键翻转
   *  (CraftingUI.cs:302-306)/网格格点选关闭(:524)/关包(Main.cs:43916+43934
   *  DrawInterface_Resources_Buffs 仅 !playerInventory 走=关包清)/开箱
   *  (Player.cs:33787)/站点过滤清过滤支(CraftingUI.cs:148-153) */
  private vinvPipsUseGrid = false;
  /** Main.recStart(网格分页游标;!PipsUseGrid 每拍归零 Main.cs:43926-43930 →
   *  本仓在每次关闭网格处置 0) */
  private vinvCraftRecStart = 0;
  /** CraftingUI._lastFilter(OpenCloseFilter CraftingUI.cs:146-159)。★SW-BJ85(2026-09-15)
   *  债①定谳:原版机制净死——非空写点仅 :154,其后 :155 CloseAll(quiet) 尾 ClearHacks
   *  (:69 → :143)同拍即净;本仓同构(:154 置入 → vinvCloseAllQuiet 尾即净),
   *  消费面(列表过滤/站台名头文字/失效拍)已退役 ⇒ 恒 null(观察点上)。 */
  private vinvCraftFilter: CraftingTileFilter | null = null;
  private vinvCraftGridEl: HTMLElement | null = null;
  private vinvCraftGridSig = '';
  private vinvCraftGridUpBtn: HTMLButtonElement | null = null;
  private vinvCraftGridDownBtn: HTMLButtonElement | null = null;
  private vinvGridToggleImg: HTMLImageElement | null = null;
  private vinvGridToggleHover = false;
  private vinvGridWheelBound = false;
  private vinvGridWheelHandler: ((e: WheelEvent) => void) | null = null;

  /** EquipPage 状态机(原版 DrawPageIcons 帧尾 SelectEquipPage :43587 等价:
   *  手持物每帧重算页码,变化才切 display;空手落记忆页) */
  private vinvApplyPage(): void {
    const pages = this.vinvPageEls;
    if (!pages) return;
    let page: 0 | 1 | 2 = this.vinvPageSelected;
    if (this.heldStack) {
      page = selectEquipPageOf(equipPageCapOf(this.heldStack.id), this.vinvPageSelected) ?? this.vinvPageSelected;
    }
    if (page === this.vinvPageCurrent) return;
    this.vinvPageCurrent = page;
    this.reflowBuffs();   // ★SW-FX10 债④:页2 ↔ buffBar 块容器随页搬运
    pages.equip.style.display = page === 0 ? 'block' : 'none';
    pages.housing.style.display = page === 1 ? 'block' : 'none';
    pages.misc.style.display = page === 2 ? 'block' : 'none';
    if (this.vinvTabMisc) this.vinvTabMisc.style.backgroundImage =
      `url(sprites/vanilla-ui/UI_DisplaySlots_${page === 2 ? 3 : 2}.png)`;
    if (this.vinvTabHousing) this.vinvTabHousing.style.backgroundImage =
      `url(sprites/vanilla-ui/UI_DisplaySlots_${page === 1 ? 5 : 4}.png)`;
    this.vinvLayoutSig = '';   // PvP 剑 x+46(页 2)随页重排
    this.layoutVanilla();
  }

  /** 防御计数重绘(refreshCrafting 的经典实现挂在 craftListEl 门后,vanilla 布局
   *  刀 4 前无 craftListEl——此处独立重绘,盾烘焙缓存 DEF_SHIELD_URLS 共享) */
  private paintVanillaDefense(): void {
    const el = this.vinvDefenseEl;
    if (!el || !this.game) return;
    const p = this.game.player;
    const w = this.game.world;
    const col = w.isMaster ? 2 : w.isExpert ? 1 : 0;
    const imgEl = el.querySelector('img');
    const shield = this.game.atlas?.vmisc('vanilla/Extra_58.png');
    if (imgEl && shield) {
      const glow = col > 0 && p.defense > 0;
      const key = `${col}|${glow ? 1 : 0}`;
      let url = DEF_SHIELD_URLS.get(key);
      const sc = DEF_SHIELD_SCRATCH;
      if (!url && sc) {
        const sx2 = sc.getContext('2d', { willReadFrequently: true })!;
        sc.width = 52; sc.height = 48;
        sx2.clearRect(0, 0, 52, 48);
        sx2.drawImage(shield.img, shield.sx + col * 52, shield.sy, 52, 48, 0, 0, 52, 48);
        if (glow) {
          sx2.globalAlpha = 0.45;
          sx2.drawImage(shield.img, shield.sx + col * 52, shield.sy + 48, 52, 48, 0, 0, 52, 48);
          sx2.globalAlpha = 1;
        }
        url = sc.toDataURL('image/png');
        DEF_SHIELD_URLS.set(key, url);
      }
      if (url && imgEl.getAttribute('src') !== url) imgEl.src = url;
    }
    const defNumEl = el.querySelector('span');
    if (defNumEl) defNumEl.textContent = String(p.defense);
  }

  /** flag 运行期切换 → 面板重建(initInGame 前未建则交给下次进世界) */
  private rebuildInventoryPanel(): void {
    if (!this.invPanel || !this.invPanel.isConnected) return;
    const wasOpen = this.invPanel.style.display === 'block';
    if (wasOpen) this.closeInventory();   // 归光标物/关箱/关搜索全走既有链
    this.teardownInventoryPanel();
    this.buildInventoryFor(options.data.inventoryLayout);
    this.refreshAll();
    if (wasOpen) this.openInventory();
  }

  /** 双布局 teardown(重建路径;字段清单=两构建器可能填充的全部实例引用) */
  private teardownInventoryPanel(): void {
    this.invPanel?.remove();
    this.eqDockEl?.remove();
    document.getElementById('sw-vinv-style')?.remove();
    this.invGridEl = null;
    this.trashEl = null;
    this.achAdvisorEl = null;
    this.eqDockEl = null;
    this.craftSearchEl = null;
    this.craftGridEl = null;
    this.craftListEl = null as unknown as HTMLElement;
    this.craftNearbyToggleImg = null;
    this.playerListBtn = null;
    this.housingBtn = null;
    this.itemSearchBtn = null as unknown as HTMLButtonElement;
    this.bestiaryBtn = null as unknown as HTMLButtonElement;
    this.quickStackBtn = null as unknown as HTMLButtonElement;
    this.qsSmartBtn = null as unknown as HTMLButtonElement;
    this.pvpSwordBtn = null as unknown as HTMLButtonElement;
    this.loadoutBtns = [];
    this.pvpTeamBtns = [];
    this.accEyeEls.clear();
    this.equipExtraSlots = null;
    this.craftFocus = -1;
    this.hoverFocus = -1;
    this.craftAvailRef = [];
    this.craftGridRecipe = null;
    this.vinvRoot = null;
    this.vinvSlots.clear();
    this.vinvPageEls = null;
    this.vinvTabMisc = null;
    this.vinvTabHousing = null;
    this.vinvTabCamera = null;
    this.vinvPageSelected = 0;
    this.vinvPageCurrent = -1;
    this.vinvQuickBtn = this.vinvSortBtn = this.vinvBestiaryBtn = this.vinvEmoteBtn = null;
    this.vinvDefenseEl = null;
    this.vinvLockEl = null;    // SW-FX10 债⑪
    this.miscBuffCol = null;   // SW-FX10 债④(页2 列随 vinv root 整体重建)
    this.vinvHousingPage = null;
    this.vinvHousingSlotEls = [];
    this.vinvHousingSig = '-init';
    this.vinvCraftFocusV = 0;   // 经典列表缺省聚焦首配方(-1 是 Modern 时代哨兵,已退役)
    this.vinvCraftGlideY = 0;   // ★SW-FX38 重建=吸附态整帧清零(availableRecipeY 族随面板重建)
    this.vinvCraftWheelPendPx = 0;   // ★SW-RB14d（FX38-F2）累计器随面板重建清零
    this.vinvModernWheelPendPx = 0;  // ★FX43b 同律(modern 窗滚轮余数累计器随面板重建清零)
    this.vinvCraftFastScroll = false;
    this.vinvCraftGlideAcc = 0;
    this.vinvCraftAvailV = [];
    this.vinvGuideMenuOpen = false;   // ★刀19:向导态随面板重建复位
    this.vinvGuideSlotModernEl = null;
    this.vinvGuideSlotClassicEl = null;
    this.vinvGuideModernCaptionEl = null;
    this.vinvGuideModernReqEl = null;
    this.vinvGuideClassicTextEl = null;
    this.vinvCraftCellEls = [];
    this.vinvCraftTitleEl = null;
    this.vinvCraftMatEl = null;
    this.vinvCraftMatSig = '';
    // ★SW-FX41:modern 窗族面重建前清零(窗开态随 teardown 复位——重建后
    //   vinvModernCraftOpen=false,再开走 vinvOpenModernCraft 全量重置)
    this.vinvModernCraftOpen = false;
    this.vinvModernCraftFilter = null;
    this.vinvModernOpenedWithoutFilter = false;
    this.vinvModernActive = [];
    this.vinvModernSearch = '';
    this.vinvModernEntries = [];
    this.vinvModernEntrySet.clear();   // ★SUI-P3:条目查集随 teardown 清(hygiene 同族)
    this.vinvModernSelected = null;
    this.vinvModernViewPos = 0;
    this.vinvModernCellsSig = '';
    this.vinvModernCraftEl = null;
    this.vinvModernPanelEl = null;
    this.vinvModernTitleEl = null;
    this.vinvModernSearchRowEl = null;   // ★RB28 字段随 teardown 一并清(RB28 归并补漏:曾只清 SearchInput/Clear,行元素滞留死引用)
    this.vinvModernSearchInput = null;
    this.vinvModernSearchClear = null;
    this.vinvModernGridList = null;
    this.vinvModernGridInner = null;
    this.vinvModernSeparatorEl = null;
    this.vinvModernScrollbarEl = null;
    this.vinvModernScrollHandle = null;
    this.vinvUnbindModernScrollbar();   // ★RB29b F5:window mousemove/mouseup 监听对称摘除
    this.vinvModernDetailEl = null;
    this.vinvModernFilterBtns = [];
    this.vinvModernFilterHovers = [];
    this.vinvModernCellEls = [];
    // ★SW-FX32:商店货架面(vinvBuildShop 重建前清零,防死节点入 vinvLayoutItems/
    // vinvShopCells 旧引用重paint——红队 F2 teardown 卫生同族)
    this.vinvShopCells = [];
    this.vinvShopTitleEl = null;
    this.vinvShopSavedEl = null;
    this.vinvShopCoinIcons = [];
    this.vinvShopCoinCnts = [];
    this.vinvShopBankImgs = [];
    this.vinvShopHappyIcon = null;
    this.vinvShopHappyText = null;
    // ★SW-FX30 刀②:网格态域随布局拆解清空(window 级 wheel 监听守卫位一并复位,
    // 重进 vanilla 布局时 vinvBindGridWheel 重挂一次;无独立 removeEventListener 点
    // =监听闭包引用 this 且 tick 头 _builtLayout 门,classic 态恒 no-op,同 vinvPulse 单例面)
    this.vinvPipsUseGrid = false;
    this.vinvCraftRecStart = 0;
    this.vinvCraftFilter = null;
    this.vinvCraftGridEl = null;
    this.vinvCraftGridSig = '';
    this.vinvCraftGridUpBtn = null;
    this.vinvCraftGridDownBtn = null;
    this.vinvGridToggleImg = null;
    this.vinvGridToggleHover = false;
    if (this.vinvGridWheelHandler) {
      window.removeEventListener('wheel', this.vinvGridWheelHandler);
      this.vinvGridWheelHandler = null;
    }
    this.vinvGridWheelBound = false;
    this.vinvChestNameEl = null;
    this.vinvChestBtnEls = [];
    this.vinvChestRenameEl?.remove();   // ★BJ69：改名对话随 vinv 拆除（防脱离面板悬挂）
    this.vinvChestRenameEl = null;
    this.vinvReforgeOpen = false;
    this.vinvReforgeSlotEl = null;
    this.vinvReforgeTextEl = null;
    this.vinvReforgeHammerEl = null;
    this.vinvSavingsEl = null;
    if (this.vinvPulseRaf) { cancelAnimationFrame(this.vinvPulseRaf); this.vinvPulseRaf = 0; }
    this.vinvLayoutItems = [];
    this.vinvRowMap.clear();
    this.vinvLayoutCtx = null;
    this.vinvLayoutSig = '';
    this.vinvTrashEl = null;
    this._builtLayout = null;
    if (this.vinvResizeHandler) {
      window.removeEventListener('resize', this.vinvResizeHandler);
      this.vinvResizeHandler = null;
    }
    // 热键栏/说明书钮还原(vanilla 开包隐藏态残留)
    if (this.hotbarEl) this.hotbarEl.style.display = '';
    if (this.hotbarNameEl) this.hotbarNameEl.style.display = '';
    if (this.manualBtn) this.manualBtn.style.display = '';
  }
}
