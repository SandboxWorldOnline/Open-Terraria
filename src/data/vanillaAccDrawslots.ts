// 配饰身上贴图绘制槽运行时（tools/extract-acc-drawslots.mjs → vanilla-acc-drawslots.json；
// ★基准 1457：提取器 --ver/SW_VER 选标杆,2026-08-23 起缺省 1457 再生）。
// 原版链路：Item.backSlot/frontSlot/... 11 槽位字段（Item.cs SetDefaults1-5）→
// Player.UpdateVisibleAccessories/UpdateVisibleAccessory（★1457 Player.cs:37036/:37153，
// 功能槽 3-9 !hide 门 + 社交槽 13-19 无条件,逐槽【后写覆盖前写】）→
// PlayerDrawLayers 十一族绘制层（LegacyPlayerRenderer.cs:170-236 层序）。
// 贴图族：TextureAssets.AccBack/AccFront/AccShield/AccShoes/AccWaist/AccNeck/
// AccFace/AccBalloon/AccHandsOn/AccHandsOff/AccBeard（public/sprites/vanilla/Acc_*.png，
// 身架族 40×1120 = 40×56×20 行,bodyFrame 对齐;气球非躯干架 52×224 = 52×56×4 帧竖条）。
import slotsJson from './vanilla-acc-drawslots.json';

/** 11 绘制槽（值 = ArmorIDs.* 槽序号,>0 有效;缺省 = 该族无贴图） */
export interface AccDrawSlots {
  back?: number; front?: number; shield?: number; shoe?: number; waist?: number;
  neck?: number; face?: number; balloon?: number; handOn?: number; handOff?: number; beard?: number;
}

const SLOTS = slotsJson as Record<string, AccDrawSlots>;

/** vid → 绘制槽（无任何贴图槽的 vid 返回 null） */
export function accDrawSlotsOf(vid: number): AccDrawSlots | null {
  return vid > 0 ? (SLOTS[String(vid)] ?? null) : null;
}

// ---- ArmorIDs.Sets 路由表（★树基准 1457：Terraria.ID/ArmorIDs.cs 1457 字面集合；
//      文中 1456 行号/集合均为历史增量锚——两版集合差异已核：PreventFaceMaskDraw −102、
//      DrawFaceMaskUnderHeadLayer +203、Back/Front IsACape +41/+17、Waist
//      UsesTorsoFraming+IsABelt +17、HidesCompositeShoulders +17、Head/Body/HandOn
//      Count +8/+3/+2、UsesNewFramingCode 扩段；DrawInBackpackLayer/DrawInTailLayer 同值）----

/** Balloon.Sets.UsesTorsoFraming / DrawInFrontOfBackArmLayer（ArmorIDs.cs:2213-2215）
 *  ——两者同集 {18 Royal Scepter}：躯干架贴图 + 画在持物臂前层 */
export const BALLOON_TORSO_FRAMING = new Set([18]);

/** Waist.Sets.UsesTorsoFraming（★1457 ArmorIDs.cs:1945：{5 工具腰带,10 黑腰带/大师忍者
 *  gear,12 武僧腰带,17 MysticArtsSash 秘术腰封}；1456 :1917 无 17）——命中用 bodyFrame,
 * 否则 legFrame（DrawPlayer_19_WaistAcc :2070-2072）。★V1 复核勘误：17=MysticArtsSash
 * （Waist 命名空间 :1984），DruidicSerpentCloak 是 Front 17/Back 41 非本族 */
export const WAIST_TORSO_FRAMING = new Set([5, 10, 12, 17]);

/** Face 四层路由（UpdateVisibleAccessory :37216-37230 分流 + UpdateItemDye
 *  :9774-9788 染料随路由;DrawPlayer_22_FaceAcc :2807 / DrawPlayer_21_Head_TheFace
 *  :2574-2650 消费）：underHair（5 眼罩,画在发层之下的头层）/ mask（22 焊工面罩）/
 *  flower（1 大自然的恩赐,6 黑曜石玫瑰,8 丛林玫瑰,9 奥术花）/ head（12/10/13/11
 *  骷髅族）——face 槽按集合分流到 face/faceMask/faceFlower/faceHead 四字段
 *  （face=base∪underHair 同字段,各字段后写覆盖,同帧至多四件并存） */
export const FACE_UNDER_HAIR = new Set([5]);
export const FACE_MASK_LAYER = new Set([22]);
export const FACE_FLOWER_LAYER = new Set([1, 6, 8, 9]);
export const FACE_HEAD_LAYER = new Set([12, 10, 13, 11]);

/** Face.Sets.OverrideHelmet（★1457 ArmorIDs.cs:2182={2,3,4,19};1456 :2142 同值）——
 *  PlayerFrame :36256-36259 命中 → head=-1（头盔整件不画）+ faceHead=-1,face 本体
 *  保留画（潜水装置/骨盔族"露脸装备压掉头盔"语义）;同集成员 ∈ PreventHairDraw
 *  （:2180）→ 发型亦全隐（DrawPlayer_21_Head :2422 hair 支门） */
export const FACE_OVERRIDE_HELMET = new Set([2, 3, 4, 19]);

/** Head.Sets.DrawFaceMaskUnderHeadLayer（★1457 ArmorIDs.cs:20,22 头;1456 :20 同值）
 *  ——faceMask 对这些头盔改画在头甲之下的头层（DrawPlayer_21_Head :2124-2137
 *  flag5 支,GetFaceDrawOffset+helmetOffset 锚同前层）,且 22_FaceAcc 前层支隐没
 *  （:2819-2821 同门） */
export const FACE_MASK_UNDER_HEAD_LAYER = new Set([26, 51, 289, 81, 92, 106, 291, 10, 12, 178, 198, 267, 279, 160, 52, 53, 71, 55, 166, 167, 278, 203]);

/** Head.Sets.PreventFaceMaskDraw（★1457 ArmorIDs.cs:24,48 头;1456 :24 同值）——
 *  faceMask 全隐（头层/前层两支都不画） */
export const PREVENT_FACE_MASK_DRAW = new Set([27, 20, 107, 108, 127, 162, 168, 118, 123, 164, 155, 150, 137, 186, 125, 136, 153, 154, 169, 148, 165, 151, 173, 146, 147, 175, 193, 271, 268, 260, 221, 236, 208, 209, 207, 187, 192, 188, 276, 270, 58, 77, 142, 152, 241, 210, 22, 196]);

/** Head.Sets.UseAltFaceHeadDraw（★1457 ArmorIDs.cs:28 字面集合）——命中头盔戴帽时
 *  PlayerFrame :36266-36271 把 faceHead 换 AltFaceHead 表档（头盔适配版骷髅贴图,
 *  换档后盲眼罩 +2·dir 附加偏移门 :2603-2609 随之失效） */
export const USE_ALT_FACE_HEAD_DRAW = new Set([3, 4, 6, 7, 9, 17, 22, 27, 28, 31, 32, 37, 38, 39, 40, 42, 43, 45, 46, 47, 48, 49, 50, 57, 58, 61, 66, 69, 70, 72, 74, 75, 76, 77, 78, 82, 83, 86, 89, 93, 98, 101, 103, 104, 105, 107, 108, 109, 110, 111, 115, 118, 120, 122, 123, 124, 127, 128, 129, 131, 132, 134, 135, 136, 137, 142, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 162, 164, 165, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 185, 186, 187, 188, 189, 192, 193, 194, 200, 201, 202, 204, 207, 208, 209, 210, 211, 213, 214, 230, 236, 237, 239, 240, 241, 251, 254, 255, 258, 260, 266, 268, 269, 270, 271, 261, 8, 12, 30, 35, 36, 73, 79, 80, 84, 85, 87, 88, 90, 91, 102, 112, 141, 160, 180, 196, 205, 257, 256, 291, 292, 283, 287]);

/** Face.Sets.AltFaceHead（★1457 ArmorIDs.cs:2192;>0 才换）——head 层骷髅族在
 *  UseAltFaceHeadDraw 头盔下的换档表 */
export const ALT_FACE_HEAD: Record<number, number> = { 12: 17, 10: 15, 13: 18, 11: 16 };

/** GetFaceHeadOffsetFromHelmet（Player.cs:4874-4889）：faceHead ∈ 骷髅族
 *  （10-13 原档 ∪ 15-18 Alt 档）且 head ∈ 下表 → (dx,dy)·Directions
 *  （本仓镜像空间直取表值,同 FACE_HELMET_OFFSET 口径） */
export const FACE_HEAD_OFFSET_IDS = new Set([10, 11, 12, 13, 15, 16, 17, 18]);
export const FACE_HEAD_HELMET_OFFSET: Record<number, [number, number]> = { 20: [0, -2], 221: [0, -2], 196: [2, 0] };

/** face 四层路由解算结果（PlayerFrame :36252-36271 门应用后的逐帧终值） */
export interface FaceLayerRoute {
  face: number; faceMask: number; faceFlower: number; faceHead: number;
  /** 互斥门应用后的 head（OverrideHelmet 命中 → 0 = 头盔+发型整隐） */
  head: number;
}

/** PlayerFrame 头盔互斥/换档门一比一（Player.cs:36252-36271,渲染侧逐帧应用——
 *  聚合侧存原始路由值,head 随狼/人鱼强改（:36175-36200 flag3 在原版同步清空四字段,
 *  transformed 形参承载）：
 *  ① head>0 ∧ face>0 ∧ ¬(head=287∧face=23)：OverrideHelmet → head=-1+faceHead=-1；
 *     否则非 underHair → face=-1（mask/flower/head 三字段不清）
 *  ② head>0 ∧ faceHead>0 ∧ UseAltFaceHeadDraw[head] → faceHead=AltFaceHead（>0 才换） */
export function resolveFaceLayers(
  ad: { face: number; faceMask: number; faceFlower: number; faceHead: number },
  headIn: number, transformed = false,
): FaceLayerRoute {
  let head = headIn;
  let face = transformed ? 0 : ad.face;
  let faceHead = transformed ? 0 : ad.faceHead;
  const faceMask = transformed ? 0 : ad.faceMask;
  const faceFlower = transformed ? 0 : ad.faceFlower;
  if (head > 0 && face > 0 && !(head === 287 && face === 23)) {
    if (FACE_OVERRIDE_HELMET.has(face)) { head = 0; faceHead = 0; }
    else if (!FACE_UNDER_HAIR.has(face)) face = 0;
  }
  if (head > 0 && faceHead > 0 && USE_ALT_FACE_HEAD_DRAW.has(head)) {
    faceHead = ALT_FACE_HEAD[faceHead] || faceHead;
  }
  return { face, faceMask, faceFlower, faceHead, head };
}

/** 头层拆画计划（渲染侧消费）：faceHead/underHair(face)/头层面罩任一在身且非
 *  HidesHead 头盔 → 纸娃娃拆出发层（skipHair 语义）,在 皮肤脸 → [脸饰] → 发 → 头甲
 *  的原版序（DrawPlayer_21_Head_TheFace :2574 → hair :2422 → helmet :2143+）中插层。
 *  skipFace = faceHead 在身 → TheFace 分支二（:2592）整支替代皮肤脸+眼（:2577 flag 门
 *  已由 split 前置排除）;hairHidden = OverrideHelmet 命中 → PreventHairDraw 同集全隐 */
export interface FaceLayerSplitPlan extends FaceLayerRoute {
  split: boolean; skipFace: boolean; hairHidden: boolean;
  /** 面罩 22 走头层支（head ∈ DrawFaceMaskUnderHeadLayer） */
  maskUnderHead: boolean;
}

export function faceLayerSplitPlan(
  ad: { face: number; faceMask: number; faceFlower: number; faceHead: number },
  headIn: number, transformed = false,
): FaceLayerSplitPlan {
  const r = resolveFaceLayers(ad, headIn, transformed);
  const maskUnderHead = r.faceMask > 0 && r.head > 0 && FACE_MASK_UNDER_HEAD_LAYER.has(r.head);
  const split = r.head >= 0 && !HEAD_HIDES_HEAD.has(r.head)
    && (r.faceHead > 0 || FACE_UNDER_HAIR.has(r.face) || maskUnderHead);
  return {
    ...r, split,
    skipFace: r.faceHead > 0 && !HEAD_HIDES_HEAD.has(r.head),
    hairHidden: r.head === 0 && headIn > 0,
    maskUnderHead,
  };
}

/** Shoe.Sets.MaleToFemaleID（ArmorIDs.cs:1841：25 玻璃拖鞋男 → 26 女）——
 *  UpdateVisibleAccessory :36496 `!Male` 换档;本仓无性别字段恒男档,登记 */
export const SHOE_MALE_TO_FEMALE: Record<number, number> = { 25: 26 };

/** Shoe.Sets.IsARollerSkate（ArmorIDs.cs:1842）→ GetShoeDrawOffset (0,2)（Player.cs:4713-4721） */
export const SHOE_ROLLER_SKATE = new Set([27, 28, 29, 30]);

/** Face 19 骨盔 GetFaceDrawOffset (0,-6)·Directions（Player.cs:4370-4372）;
 *  1/6/8/9 花族与 22 面罩的头盔条件偏移（268/270/283+长头盔表 :4352-4390）未建模登记 */
export const FACE_DRAW_OFFSET: Record<number, [number, number]> = { 19: [0, -6] };

// ---- Back 子层路由（1456 未建模细项批 2026-08-23：DrawPlayer_08_Backpacks/
//      08_1_Tails/10_BackAcc 三层拆画）----

/** Back.Sets.DrawInBackpackLayer（ArmorIDs.cs:1695）——UpdateVisibleAccessory
 *  :36456-36460 把命中者写 Player.backpack（独立字段,不占 back 不清 front）,
 *  DrawPlayer_08_Backpacks（PlayerDrawLayers.cs:479-488）画在翼层之前 */
export const BACK_DRAW_IN_BACKPACK = new Set([7, 8, 9, 10, 15, 16, 32, 33]);

/** Back.Sets.DrawInTailLayer（ArmorIDs.cs:1697）——写 Player.tail,
 *  DrawPlayer_08_1_Tails（:568-587）背包后/翼前;坐姿 (0,-2) 偏移（:575-577）+
 *  !Male (2·dir,0) 偏移（:578,本仓无性别字段恒男档,登记） */
export const BACK_DRAW_IN_TAIL = new Set([18, 19, 21, 25, 26, 27, 28]);

/** Back.Sets.IsACape（★1457 ArmorIDs.cs:1721：1456 :1699 基础上 +41
 *  DruidicSerpentCloak）——front 13（DontDrawIfWearingAScarfOrCape）
 *  的披风互斥门用（PlayerDrawLayers.cs:3893/:3936） */
export const BACK_IS_ACAPE = new Set([1, 2, 3, 4, 5, 6, 14, 24, 34, 36, 39, 41]);

/** MountID.Sets.DoesNotOverrideBackpackDraw（MountID.cs:17）——背包层坐骑豁免
 *  （DrawPlayer_08_Backpacks :479：!mount.Active || 命中此集仍画） */
export const MOUNT_BACKPACK_OK = new Set([57, 58, 59, 60]);

/** Neck.Sets.IsAScarf（ArmorIDs.cs:2104：{8,9}）——front 13 围巾互斥门左支 */
export const NECK_IS_SCARF = new Set([8, 9]);

/** Front.Sets.DontDrawIfWearingAScarfOrCape（ArmorIDs.cs:1793：{13}）——
 *  围巾/披风任一在身即整层不画（:3893/:3936 双层同门） */
export const FRONT_SCARF_CAPE_HIDE = new Set([13]);

/** Front.Sets.DrawsInNeckLayerRegardlessOfPlayerFrame（ArmorIDs.cs:1791：{13}）——
 *  front 13 前半走颈层档（FaceAcc 后 LegacyPlayerRenderer.cs:220-224）;
 *  DrawsInNeckLayer={6}（:1789）仅坐姿帧行 5 生效（PlayerDrawSet.cs:1766-1770,
 *  本仓 front 6 无表项,登记） */
export const FRONT_NECK_LAYER_ALWAYS = new Set([13]);

/** DrawSittingLegs 切片表（★V2b 复核勘误：原表 [[2,54],[0,2]] 是 217 族【特例支】
 *  非默认支！PlayerDrawLayers.cs:1594-1596 默认支 num=2/num2=42/num3=2 → 循环
 *  num10=2..0 三片 [46,10]+[44,2]+[42,2]（:1719-1732：首片 Y+46 高 10、余两片
 *  Height=2 顶带）；特例支（:1608-1716 num3=1/num2=0）=legs 217/169(非 skin)/
 *  177/178/181/182/206 → 两片 [[2,54],[0,2]]。DrawPlayer_14_Shoes :1768 传
 *  legIndex=player.legs 同分支）[sy, h] 对 */
export const SITTING_LEG_SLICES: Array<[number, number]> = [[46, 10], [44, 2], [42, 2]];
export const SITTING_LEG_SLICES_SPECIAL: Array<[number, number]> = [[2, 54], [0, 2]];
/** 特例支 legs 集合（:1608 门 legIndex==169||!skin + case 217/:1703-1707 族） */
export const SITTING_LEG_SPECIAL_LEGS = new Set([169, 177, 178, 181, 182, 200, 201, 206, 217]);   // ★RV2 补 200/201 GhostarShirtExtension（:1703-1710 同 case 组;今日 extension 未建模,集合自洽防日后咬人）

// ---- 脸饰/胡须头盔条件层（1456 未建模细项批 2026-08-23）----

/** GetFaceDrawOffset 头盔条件偏移表（Player.cs:4352-4432）：
 *  face→head→(dx,dy)（原版 ×Directions;本仓镜像空间内 X=朝向系/Y=重力系,直取表值）。
 *  1/6/8/9 花族 head268→(0,6)/270→(8,0);22 面罩 283→(2,0)/长盔表→(0,-2)/
 *  {37,98,149}→(0,-4)/269→(0,-6)/{119,129,132,135,172,214}→(2,-2)/275→(0,2);
 *  19 骨盔无条件 (0,-6)（沿用 FACE_DRAW_OFFSET） */
export const FACE_HELMET_OFFSET: Record<number, Record<number, [number, number]>> = {
  1: { 268: [0, 6], 270: [8, 0] },
  6: { 268: [0, 6], 270: [8, 0] },
  8: { 268: [0, 6], 270: [8, 0] },
  9: { 268: [0, 6], 270: [8, 0] },
  22: {
    283: [2, 0],
    3: [0, -2], 7: [0, -2], 8: [0, -2], 9: [0, -2], 17: [0, -2], 32: [0, -2],
    49: [0, -2], 61: [0, -2], 66: [0, -2], 70: [0, -2], 78: [0, -2], 83: [0, -2],
    86: [0, -2], 89: [0, -2], 101: [0, -2], 103: [0, -2], 104: [0, -2], 105: [0, -2],
    109: [0, -2], 110: [0, -2], 111: [0, -2], 117: [0, -2], 120: [0, -2], 122: [0, -2],
    134: [0, -2], 152: [0, -2], 160: [0, -2], 171: [0, -2], 176: [0, -2], 177: [0, -2],
    189: [0, -2], 204: [0, -2], 237: [0, -2], 256: [0, -2], 282: [0, -2],
    37: [0, -4], 98: [0, -4], 149: [0, -4],
    269: [0, -6],
    119: [2, -2], 129: [2, -2], 132: [2, -2], 135: [2, -2], 172: [2, -2], 214: [2, -2],
    275: [0, 2],
  },
};

/** GetHelmetDrawOffset（Player.cs:4439-4462）非发型依赖档——faceMask/faceFlower
 *  层锚另加 helmetOffset（PlayerDrawLayers.cs:2829/:2851）;222/272 依 hair 15/76/108
 *  （本仓无发型字段,登记）、faceHead 加成族（:4471+）与坐骑加成未建模 */
export const HELMET_DRAW_OFFSET: Record<number, [number, number]> = {
  268: [0, -6], 270: [-10, 0], 275: [0, -4],
};

/** Head.Sets.PreventFaceMaskDraw ∪ DrawFaceMaskUnderHeadLayer（★1457 ArmorIDs.cs:24/:20；
 *  1456 :24/:20 增量 = PreventFaceMaskDraw −102、DrawFaceMaskUnderHeadLayer +203，
 *  并集 70 元不变但成员换血）——faceMask 层头盔隐没门（PlayerDrawLayers.cs:2819-2821）。
 *  2026-09-03 四层路由批起由上方两分集派生（单一真源;前层门对 UNDER_HEAD_LAYER 头
 *  改走头层拆画,见 resolveFaceLayers/faceLayerSplitPlan） */
export const FACE_MASK_HELMET_HIDE = new Set([...PREVENT_FACE_MASK_DRAW, ...FACE_MASK_UNDER_HEAD_LAYER]);

/** Head.Sets.PreventFaceFlowerDraw（ArmorIDs.cs:24）——faceFlower 层头盔隐没门
 *  （PlayerDrawLayers.cs:2836-2838） */
export const FACE_FLOWER_HELMET_HIDE = new Set([92, 275]);

/** Head.Sets.HidesHead（ArmorIDs.cs:18：{38,135,269,282,288}）——faceHead（骷髅族
 *  10-13）层头盔门（PlayerDrawLayers.cs:2590 !flag 才画）+ underHair 5 同门
 *  （:2596 头层路径;本仓 face 单层合并,两门并此一处） */
export const HEAD_HIDES_HEAD = new Set([38, 135, 269, 282, 288]);

/** ★BJ709-G32② Head.Sets.CanDrawOnVelociraptorMount（ArmorIDs.cs:30,
 *  Factory.CreateBoolSet(false, …) 136 头白名单——逐值对勘 1457 原行,脚本核
 *  count=136/无重复）——DrawPlayer_21_Head 头层总门（PlayerDrawLayers.cs:2106
 *  -2111：骑 54 ∧ head≥0 ∧ !表[head] → flag4=false 整头层跳过=头盔+发全隐;
 *  head=0（无盔/Familiar Wig）∉表 → 骑迅猛龙无盔时头层同隐）。消费=Renderer
 *  veloHead 块;★Face.Sets.CanDrawOnVelociraptorMount（ArmorIDs.cs:2194 {1,6,
 *  9,8,19,7,20,21,23}）系脸饰门（:2585/:2131）,本仓无 face 槽=不建。 */
export const HEAD_CAN_DRAW_ON_RAPTOR = new Set([
  212, 241, 274, 277, 5, 278, 34, 205, 41, 42, 30, 8, 84, 79, 33, 91, 90, 99,
  35, 4, 256, 257, 36, 85, 80, 1, 112, 2, 215, 201, 202, 199, 194, 206, 262,
  259, 234, 226, 238, 250, 280, 232, 225, 223, 224, 219, 220, 216, 263, 273,
  264, 267, 18, 19, 24, 21, 26, 25, 16, 14, 12, 275, 65, 51, 56, 40, 29, 81,
  94, 95, 62, 67, 44, 68, 121, 114, 116, 113, 92, 106, 100, 96, 97, 141, 143,
  145, 139, 140, 144, 126, 130, 133, 159, 158, 161, 166, 183, 181, 178, 184,
  182, 13, 64, 60, 59, 73, 63, 117, 138, 160, 10, 235, 197, 195, 203, 191, 228,
  233, 227, 217, 218, 245, 243, 244, 242, 231, 229, 222, 265, 272, 279, 15,
  163, 288, 289, 290,
]);

/** Head.Sets.PreventBeardDraw（ArmorIDs.cs:26,48 头）——胡须层头盔门
 *  （PlayerDrawLayers.cs:2429-2433 flag7） */
export const PREVENT_BEARD_DRAW = new Set([
  118, 119, 107, 129, 127, 125, 136, 162, 168, 210, 213, 28, 135, 31, 17, 261,
  169, 186, 47, 22, 105, 102, 120, 137, 199, 207, 260, 132, 155, 179, 108, 153,
  164, 172, 208, 241, 271, 48, 154, 188, 187, 209, 46, 123, 269, 185, 276,
]);

/** Beard.Sets.UseHairColor（ArmorIDs.cs:2281：{2,3,4} 威尔逊族）——原版画
 *  colorHair（玩家发色）非 colorArmorHead（PlayerDrawLayers.cs:2436-2439）。
 *  ★定谳登记不改码：本仓无发色系统（捏人 hairColor 未建模,Player 侧无宿主字段）,
 *  胡须画原生色=默认发色外观,接发色系统时一并接 */
export const BEARD_USE_HAIR_COLOR = new Set([2, 3, 4]);

// ---- 举盾光环/格挡视觉纯函数（DrawPlayer_25_Shield PlayerDrawLayers.cs:3073-3125）----

/** 举盾光环档（:3073-3090）：num=sin(GlobalTimeWrappedHourly·2π)、x=2.5+1.5·num、
 *  色档=0.45-0.15·num（原版 colorArmorBody.A=0 → 预乘 α 下=全额加算,渲染侧用
 *  'lighter'+alpha=色档近似）;4 份绕 (x,0) 旋 k/4·2π */
export function shieldHaloFactor(time: number): { x: number; a: number } {
  const num = Math.sin(time * Math.PI * 2);
  return { x: 2.5 + 1.5 * num, a: 0.45 - 0.15 * num };
}

/** 格挡弹开档（:3108-3125）：t=shieldParryTimeLeft/20、scale=1+1.5t、alpha=1-t、
 *  锚点沿 (锚-玩家中心)·1.5t 外推（本仓局部系玩家中心=(0,-h/2)、盾 origin=(0,-24)） */
export function shieldParryTransform(parryLeft: number, playerH: number): {
  t: number; scale: number; alpha: number; dx: number; dy: number;
} {
  const t = parryLeft / 20;
  const scale = 1 + 1.5 * t;
  return { t, scale, alpha: 1 - t, dx: 0, dy: (-24 + playerH / 2) * 1.5 * t };
}

/** Main.OffsetsPlayerOffhand（Main.cs:456-477,20 行 bodyFrame 行表）——
 *  气球非躯干架锚点用（DrawPlayer_11_Balloons :1152） */
export const OFFSETS_PLAYER_OFFHAND: Array<[number, number]> = [
  [14, 20], [14, 20], [14, 20], [14, 18], [14, 20],
  [16, 4], [16, 16], [18, 14], [18, 14], [18, 14],
  [16, 16], [16, 16], [16, 16], [16, 16], [14, 14],
  [14, 14], [12, 14], [14, 16], [16, 16], [16, 16],
];

// ---- ★SW-BJ58（2026-09-10）HandOn/HandOff 合成臂网格取样 ----
// 症状：装备创造之手（vid5126 handOn23/handOff15）玩家身侧横排 6-9 个小工具精灵、
// 静止朝向侧才有。根因：合成网格族贴图（Acc_HandsOn/HandsOff_*.png 360×224 = 9 列×4
// 行的 40×56 格）被整幅 9 列横排一次画出。原版按 compFrontArmFrame/compBackArmFrame
// 取【单格】。
/** CreateCompositeData switch（PlayerDrawSet.cs:1979-2007）：身架行
 *  （bodyFrame.Y/56,0=站立）→ composite 格 [列,行]。case0→(2,0) 1→(3,0) 2→(4,0)
 *  3→(5,0) 4→(6,0) 5→(2,1) 6→(3,1) 7-10→(4,1) 11-13→(3,1) 14→(5,1) 15-16→(6,1)
 *  17→(5,1) 18-19→(3,1)。 */
export const ACC_COMP_ARM_CELL: ReadonlyArray<readonly [number, number]> = [
  [2, 0], [3, 0], [4, 0], [5, 0], [6, 0],            // 行 0-4（站立/走A/走B/走C/走D）
  [2, 1], [3, 1], [4, 1], [4, 1], [4, 1], [4, 1],    // 行 5-9（跳/落/走循环 7-10）
  [3, 1], [3, 1], [3, 1], [5, 1], [6, 1], [6, 1],    // 行 11-16（★SW-RB12a 原标 10-15 系位次笔误,10=上一组末位(4,1)）
  [5, 1], [3, 1], [3, 1],                            // 行 17-19
];

/** CreateCompositeFrameRect（PlayerDrawSet.cs:2247-2250）= (pt.X*40, pt.Y*56, 40,56)。
 *  compBand：0=前臂带（AccHandsOnComposite×compFrontArmFrame,handOn,
 *  PlayerDrawLayers.cs:3851）；2=后臂带（AccHandsOffComposite×compBackArmFrame=
 *  前臂行+2,PlayerDrawSet.cs:2046-2047,handOff,PlayerDrawLayers.cs:1423-1427）。
 *  返回 null = 非合成网格（tex.width≤40 或非 40 整倍数——竖条/气球族走旧路径）。
 *  行越界与列钳制在此收敛；朝向无关（镜像由调用方 ctx 变换承担）。 */
export function accCompositeArmSrcRect(
  texW: number, texH: number, row: number, compBand: 0 | 2,
): { sx: number; sy: number; sw: number; sh: number } | null {
  if (texW <= 40 || texW % 40 !== 0) return null;
  const rows = Math.floor(texH / 56);
  if (rows < 2) return null;
  const cell = ACC_COMP_ARM_CELL[Math.max(0, Math.min(19, row))] ?? [2, 0];
  const sx = Math.min(cell[0], Math.floor(texW / 40) - 1) * 40;
  const sy = Math.min(cell[1] + compBand, rows - 1) * 56;
  return { sx, sy, sw: 40, sh: 56 };
}
