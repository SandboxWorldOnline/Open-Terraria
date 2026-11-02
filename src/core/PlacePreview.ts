// ★BJ557（2026-10-07）放置预览幽灵——状态面（TileObject.objectPreview 1:1 移植）。
//
// 定谳（本任务铁律：先定谳再动刀）：
// · 开关身份 = 原版 Main.placementPreview（Main.cs:1316 缺省 true;IngameOptions.cs:727-732
//   翻转;config 键 "PlacementPreview" Main.cs:4205/:4440）。本仓设置面早已在册：
//   Options.ts:132-135 + Settings.ts:764-769（l10n「放置预览」= Lang.menu[128/129] 同源）。
// · 效果面断点 = 【整链未移植】（Settings.ts:764 自注「对象放置幽灵预览未移植」）：
//   原版链 = Player.UpdatePlacementPreview（Player.cs:43734,ItemCheck 尾 :42998 逐帧调）
//   → FigureOutWhatToPlace + TileObjectData.CustomPlace 门（TileObjectData.cs:5017,
//   返回 _usesCustomCanPlace）→ TileObject.CanPlace(onlyCheck:true) 填
//   TileObject.objectPreview 逐格 1/2（TileObject.cs:340-372）→ TileDrawing.Draw 尾
//   （TileDrawing.cs:742-747）TileObject.DrawPreview 画幽灵（白×0.5 / 红×0.35,
//   TileObject.cs:908-914）。开关开着但消费面缺席 = 开关空转（用户实报「开了没有效果」）。
// · 本文件承担状态面：updatePlacePreviewFrame（Game.updateUse 智能光标覆写点后逐帧调,
//   与 updateUse 头 clearPlacePreviewFrame 成对——早退帧隐藏,⟺ cursorItemIconEnabled
//   复位相）;绘制面在 render/PlacePreviewDraw.ts（Renderer 世界 pass tile 层尾消费）。
//
// 原版对照（形态钉死）：幽灵 = 物件足印逐格实贴图半透明——可放格 White×0.5、
// 阻挡格 Red×0.7×0.5;锚点带格虽参与判定但绘制窗只取足印（TileObject.cs:936-938
// continue）=【永不可见】,锚失败时幽灵仍白格显示（点击落空=原版本相,照抄）。
// 幽灵门序（原版）：Main.placementPreview ∧ cursorItemIconEnabled（PlaceThing_Tiles
// :40036 持可放件+射程内置位）∧ !CaptureManager.Active ∧ itemAnimation==0。
// 门（CustomPlace :5017-5038）不受理的件（物块/平台/绳/墙——UsesCustomCanPlace=false
// 或无 TileObjectData）原版【本就无幽灵】,本移植同样不出（防止过预览发散）。
//
// 边界声明（登记债,均为原版有而本刀未做）：
// · 227 染料、20 橡实苗、3 等 exotic 锚族——anchorSpecOf 因 AlternateTile/Tree 位
//   回落 null → 无预览（原版有;专用放置支谓词未共享,另批）。★BJ624（2026-10-10）
//   复核：82/83/84 药草已随件2 白名单解禁（AnchorAlternateTiles={78} :4756）→
//   幽灵恢复（足印三谓词面;盆基锚带不可见域=原版同款白格 doctrine）;753 同批入链。
//   ★BJ629 件5：442/630/631/723/724 五锚档族幽灵接线（专用支,anchorSpecOf 仍 null
//   不入表驱动族——帧带/AllInvalid 语义见分支注）;136 幽灵本就走通用族（基记录
//   无 exotic 位）,帧带恒档0（原版显示命中档变体）=微差备案。
// · HookCheckIfCanPlace 全红面仅建模 597 晶塔（hasPylonOfType 同源门）;21/467 箱/
//   88 梳妆台 FindEmptyChest(-1=原箱占位) 与占用重叠红格等效不另建;442 压力板、
//   PlantCheck 族（错误土壤全红）未建模。
// · DrawStepDown/DrawXOffset（TileObject.cs:896-933）未建模（族少,视觉差 ≤2px）;
//   随机样式帧（RandomStyleRange/SpecificRandomStyles）取 style 直值。
// · Kite 透明度衰减（GetPlacementPreviewOpacity Player.cs:43721 只吃风筝物品）
//   对 tile 放置恒 1,不移植零行为差。
import { options } from './Options';
import { TILE_DEFS } from '../data/tiles';
import { anchorSpecOf, chooseAnchorFromClick, liquidCellOk, liquidSpecOf, previewCellValues,
  type AnchorRec } from '../world/TileAnchorValidator';
import { torchAnchorFrame, isWaterTorchStyle } from '../world/Torch';
import type { World } from '../world/World';

/** _usesCustomCanPlace 有效真值集（1457 权威=TileObjectData.cs Initialize 全序列模拟）：
 *  直接置位 42 处 + addBaseTile(out StyleX)/CopyFrom(StyleX) 继承（工作台 18=Style2x1、
 *  桌 34、晶塔 597=Style3x4 等）;SubTiles 零发散（newSubTile.UsesCustomCanPlace 全表
 *  0 处写位→CustomPlace(:5030-5037) 恒回落基记录）。提取法=逐行状态机
 *  （UsesCustomCanPlace 赋值/CopyFrom/addBaseTile/addTile 四算子;newTile=new 重置 false）,
 *  382 族。排除面抽查：1/2/5 物块、19 平台、213 绳、314 轨道、380 种植箱=legacy 置放
 *  原版无幽灵（tile-anchor-placement.test A 段「19/427 UsesCustomCanPlace=false」同源）。 */
const USES_CUSTOM_CAN_PLACE = '3,4,10,11,12,13,14,15,16,17,18,20,21,24,26,27,28,29,31,33,34,35,36,42,49,50,55,61,71,73,74,77,78,79,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,110,113,114,125,126,128,132,133,134,135,136,138,139,141,142,143,144,149,165,171,172,173,174,178,184,185,186,187,201,207,209,210,212,215,216,217,218,219,220,227,228,231,233,235,236,237,238,239,240,241,242,243,244,245,246,247,254,269,270,271,275,276,277,278,279,280,281,282,283,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,307,308,309,310,316,317,318,319,320,324,334,335,337,338,339,349,354,355,356,358,359,360,361,362,363,364,372,373,374,375,376,377,378,386,387,388,389,390,391,392,393,394,395,405,406,410,411,412,413,414,419,420,423,424,425,428,429,440,441,442,443,444,445,452,453,454,455,456,457,461,462,463,464,465,466,467,468,469,470,471,475,476,480,484,485,486,487,488,489,490,491,493,494,497,499,505,506,509,510,511,520,521,522,523,524,525,526,527,530,531,532,533,538,542,543,544,545,547,548,550,551,552,553,554,555,556,558,559,560,564,565,567,568,569,570,572,573,579,580,581,582,590,591,592,593,594,595,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,617,619,620,621,622,623,624,629,630,631,632,637,639,640,642,643,644,645,646,647,648,649,650,651,652,653,654,656,657,658,660,663,664,665,693,694,695,696,698,699,700,701,702,703,704,705,706,707,709,710,711,712,713,714,715,716,720,721,723,724,725,733,751,752,753';
export const USES_CUSTOM_CAN_PLACE_SHEETS: ReadonlySet<number>
  = new Set(USES_CUSTOM_CAN_PLACE.split(',').map(Number));

/** 幽灵帧态（smartInteractTileFrame 同款 Game 写 / Renderer 读状态面）。 */
export interface PlacePreviewData {
  sheet: number;          // vanilla sheet（绘制/帧域）
  fw: number;             // 物件宽（帧步长用;= rec.w）
  style: number;          // placeStyle 终值（实例覆盖+91/215/火把群系转换后）
  ax: number; ay: number; // 足印左上（tile 域）
  w: number; h: number;   // 足印尺寸
  cells: Uint8Array;      // w*h 逐格 1=可放(White×0.5)/2=阻挡(Red×0.35)——TileObject.cs:365/:371 同域
  /** 1×1 特例直供帧源（火把 22px 步长在 18px 网格 vframeAt 域外）——fx=锚档帧
   *  （torchAnchorFrame 0/22/44,失锚取 0=底档帧）、fy=style×22（tryPlace :27614 同式） */
  fx?: number; fy?: number;
  /** ★BJ629 件5（2026-10-10）：五锚档族直供帧源（TileObject.DrawPreview :864-896 语义
   *  ——op.Alternate → GetTileData(type,style,alternate) → CalculatePlacementStyle
   *  帧带,幽灵显示【命中档】的方向变体 sprites）。fx/fy/sw/sh=原图切片矩形
   *  （442 CoordinateWidth 20+heights 20 → 20×20;630/631/723/724 Style1x1 → 16×16）,
   *  dx=帧宽居中偏移（DrawPreview :944 `num13=(CoordinateWidth-16)/2`——442=−2px）。
   *  band 取自 ctx.anchorStyleAt（与实放同一门源）;门失（-1）回退档 0=原版
   *  placementCache 首备档缓存相（:756-763 num4 初值 -1f 首档必入缓存）。 */
  pvFrame?: { fx: number; fy: number; sw: number; sh: number; dx?: number };
}

export const placePreviewFrame: { data: PlacePreviewData | null } = { data: null };

export function clearPlacePreviewFrame(): void {
  placePreviewFrame.data = null;
}

/** Game 侧上下文（把 Game 私有谓词以回调注入,保持本模块可独立单测）。 */
export interface PlacePreviewCtx {
  st: World['store'];
  tx: number; ty: number;      // tileTarget（世界缘钳+智能光标覆写后的建立位点）
  sheet: number;               // def.vanilla.sheet
  defFramed: boolean; defW: number; defH: number;
  style: number;               // placeStyle 终值（与 tryPlace :27134-27160 三转换同源,Game 侧算好）
  pylonDuplicate: boolean;     // 597 HookCheckIfCanPlace badReturn=1 面（:3421→AllInvalid）
  hasSupport(x: number, y: number, w: number, h: number, framed: boolean, onTable: boolean): boolean;
  obstructionClearable(typeId: number, sheet: number): boolean;
  /** ★BJ629 件5：五锚档门直读（Game 侧闭包=anchorTilePlacementStyle 同一 gate 源,
   *  预览不说谎）。返回 -1=全档失（442 → HookCheckIfCanPlace badReturn=-1 →
   *  AllInvalid 全红 :728-731;630/631/723/724 无 hook → 白格 doctrine 不变） */
  anchorStyleAt?: (x: number, y: number) => number;
}

/** CanPlace :186-189 世界缘带（[5, maxTiles-5]）——足印出带=原版整帧不刷新（本仓=隐藏）。 */
function footprintInBounds(st: World['store'], ax: number, ay: number, w: number, h: number): boolean {
  return ax >= 5 && ay >= 5 && ax + w <= st.w - 5 && ay + h <= st.h - 5;
}

/** 占者 sheet 直读（回调 obstructionClearable 需要 (typeId, sheet) 二元）。 */
function occupantSheet(st: World['store'], x: number, y: number): number {
  return TILE_DEFS[st.get(x, y)]?.vanilla?.sheet ?? -1;
}

/** 每帧重建幽灵帧态（先清后写;任何早退=本帧隐藏）。门序 = 原版
 *  UpdatePlacementPreview(:43734) + PlaceThing_Tiles(:40032-40036) 复合：
 *  开关 → UCCP(CustomPlace) → 足印缘带 → 逐族路由（火把/门专用支镜像 tryPlace,
 *  表驱动族走 anchorSpecOf+chooseAnchorFromClick——与实放同一锚定源=预览不说谎）。 */
export function updatePlacePreviewFrame(ctx: PlacePreviewCtx): void {
  placePreviewFrame.data = null;
  if (!options.data.placementPreview) return;                       // ★BJ557 主角：Main.placementPreview
  const { st, tx, ty, sheet } = ctx;
  if (!USES_CUSTOM_CAN_PLACE_SHEETS.has(sheet)) return;             // CustomPlace :5017（不受理=原版本就无幽灵）
  if (sheet === 4) {                                                // 火把（tryPlace :27556 专用支只读镜像）
    if (!footprintInBounds(st, tx, ty, 1, 1)) return;
    let blocked = false;
    if (st.inBounds(tx, ty) && st.hasTile(tx, ty)
      && !ctx.obstructionClearable(st.get(tx, ty), occupantSheet(st, tx, ty))) blocked = true;
    if (st.inBounds(tx, ty) && st.liquid[st.idx(tx, ty)] > 0
      && !isWaterTorchStyle(ctx.style * 22)) blocked = true;        // :27612 液体门（普通炬拒水,水炬 8/11/17 放行）
    const cells = new Uint8Array([blocked ? 2 : 1]);
    const af = torchAnchorFrame(st, tx, ty);
    // 锚失败（af<0）不改格值——锚点带在绘制窗外（TileObject.cs:936-938）,
    // 原版中途悬空火把幽灵=白格（点击落空同相,照抄）
    placePreviewFrame.data = {
      sheet: 4, fw: 1, style: ctx.style, ax: tx, ay: ty, w: 1, h: 1, cells,
      fx: af >= 0 ? af : 0, fy: ctx.style * 22,
    };
    return;
  }
  if (sheet === 10 || sheet === 11) {                               // 门（tryPlace :27330-27438 双锚寻位只读镜像）
    const rec = anchorSpecOf(10);
    if (!rec) return;
    const bw = ctx.defW, bh = ctx.defH;
    const doorLiq = rec.liqStyles?.[String(ctx.style)] ?? rec.liq;
    const slopeAt = (sx: number, sy: number): number =>
      st.inBounds(sx, sy) ? st.slope[st.idx(sx, sy)] : 0;
    // 锚谓词 = tryPlace :27322-27342 逐字（★复刻债：改锚判据两处同步）
    const topAnchorOK = (sx: number, sy: number): boolean => {
      if (!st.inBounds(sx, sy)) return false;
      if (!st.isActive(sx, sy)) return false;
      const b = TILE_DEFS[st.get(sx, sy)];
      if (!b) return false;
      const sl = slopeAt(sx, sy);
      return (b.solid && !b.platform && sl === 0) || b.platform
        || st.half[st.idx(sx, sy)] === 1 || sl === 3 || sl === 4;   // SolidBottom:半砖/顶坡亦锚
    };
    const botAnchorOK = (sx: number, sy: number): boolean => {
      if (!st.inBounds(sx, sy)) return false;
      if (!st.isActive(sx, sy)) return false;
      const b = TILE_DEFS[st.get(sx, sy)];
      if (!b) return false;
      const sl = slopeAt(sx, sy);
      return (b.solid && !b.platform && sl === 0) || b.platform;
    };
    const cands = [ty - 1, ty, ty - 2];                             // 点击=中/顶/底格（tryPlace :27350 同序）
    for (const cy of cands) {
      let free = true;
      for (let dy2 = 0; dy2 < bh; dy2++) {
        const yy = cy + dy2;
        if (!st.inBounds(tx, yy)) { free = false; break; }
        if (st.hasTile(tx, yy)
          && !ctx.obstructionClearable(st.get(tx, yy), occupantSheet(st, tx, yy))) { free = false; break; }
      }
      if (!free) continue;
      if (!ctx.hasSupport(tx, cy, bw, bh, true, false)) continue;
      if (!topAnchorOK(tx, cy - 1) || !botAnchorOK(tx, cy + bh)) continue;   // 双锚全满足制
      if (doorLiq) {
        let liqOk = true;
        for (let di = 0; di < bh; di++) {
          if (!st.inBounds(tx, cy + di) || !liquidCellOk(st, tx, cy + di, doorLiq)) { liqOk = false; break; }
        }
        if (!liqOk) continue;
      }
      placePreviewFrame.data = {
        sheet, fw: bw, style: ctx.style, ax: tx, ay: cy, w: bw, h: bh,
        cells: new Uint8Array(bw * bh).fill(1),
      };
      return;
    }
    // 未命中 → 原版 prim（click−Origin）逐格红白（占位/液体;门锚带不可见同前）
    const ax = tx - rec.ox, ay = ty - rec.oy;
    if (!footprintInBounds(st, ax, ay, rec.w, rec.h)) return;
    placePreviewFrame.data = {
      sheet, fw: rec.w, style: ctx.style, ax, ay, w: rec.w, h: rec.h,
      cells: previewCellValues(st, ax, ay, rec, ctx.style),
    };
    return;
  }
  // ★BJ629 件5（2026-10-10）：五锚档路由族幽灵（442/630/631/723/724——anchorSpecOf
  //  因 AlternateTile/ exotic 位恒 null,BJ557 登记债销案）。原版 onlyCheck 语义亲读
  //  （TileObject.CanPlace :205-765 逐 alternate 满分制 + :831-842 best 备档回落）：
  //  · 足印（1×1）三谓词 = 唯一可见域（锚带 :936-938 窗外永不可见）——占位/液体
  //    逐格 1/2（previewCellValues 同谓词面,此处单格内联与火把支同构）;
  //  · 442 HookCheckIfCanPlace=CanPlaceProjectilePressurePad（WorldGen.cs:87583,
  //    badReturn=-1）→ 全向 viable 失 = 该备档 AllInvalid（:728-731 num24=num22=0）
  //    → 四备档全灭 → 幽灵全红;有 viable 档 → 该档满分 → 白格+其帧带。
  //    anchorStyleAt（=实放 gateTilePlacementStyle 同源）<0 ⟺ 全向 viable 失
  //    （档0-3 每档 = 锚臂 ∧ hook 单向;hook 全向假 ⟹ 每档 hook 臂假 ⟹ -1）。
  //  · 630/631/723/724 无 hook：备档全失时 best 备档缓存 = 首备档（:756-763 num4
  //    初值 -1f）→ 足印白格（点击落空=原版本相,锚带窗外 doctrine 同 BJ557）;
  //    命中档（含墙档 4）→ 白格+其帧带（wall>0 时 alt4 满分 break）。
  //  · 帧带 = 命中 alternate 序（DrawPreview :864-896 op.Alternate → 帧;
  //    630/631/723/724 步长 18（CoordinateFullWidth 16+2）/442 步长 22
  //    （CoordinateWidth 20+pad2）+ num13 居中偏移 −2px（:944 (20−16)/2）。
  if (sheet === 442 || sheet === 630 || sheet === 631 || sheet === 723 || sheet === 724) {
    if (!footprintInBounds(st, tx, ty, 1, 1)) return;
    let blocked = false;
    if (st.inBounds(tx, ty) && st.hasTile(tx, ty)
      && !ctx.obstructionClearable(st.get(tx, ty), occupantSheet(st, tx, ty))) blocked = true;
    const liq5 = liquidSpecOf(sheet)?.liq;
    if (!blocked && liq5 && st.inBounds(tx, ty) && !liquidCellOk(st, tx, ty, liq5)) blocked = true;
    const band = ctx.anchorStyleAt ? ctx.anchorStyleAt(tx, ty) : -1;
    if (sheet === 442 && band < 0) blocked = true;      // AllInvalid（:728-731 全红面）
    placePreviewFrame.data = {
      sheet, fw: 1, style: ctx.style, ax: tx, ay: ty, w: 1, h: 1,
      cells: new Uint8Array([blocked ? 2 : 1]),
      pvFrame: sheet === 442
        ? { fx: Math.max(0, band) * 22, fy: 0, sw: 20, sh: 20, dx: -2 }
        : { fx: Math.max(0, band) * 18, fy: 0, sw: 16, sh: 16 },
    };
    return;
  }
  // 表驱动族（tryPlace :27248-27257 anchorRec 门同式）
  // ★BJ754 TF-10（2026-11-02,issue#39）：记录解析带 style（GetTileData 整记录替换）
  //  ——变几何子样式（王朝桌 14 style25 3×1）幽灵足迹与实放同挡;足迹门仅对基记录
  //  生效（子样式记录 ≠ 基记录时 defW/defH 与 rec.w/h 合法发散）。
  const rec: AnchorRec | null = anchorSpecOf(sheet, ctx.style);
  const baseRec: AnchorRec | null = anchorSpecOf(sheet);
  const subHit = !!rec && !!baseRec && rec !== baseRec;
  if (!rec || !ctx.defFramed || (!subHit && (ctx.defW !== rec.w || ctx.defH !== rec.h))) return;
  let ax: number, ay: number;
  if (rec.w > 1 || rec.h > 1) {
    // 多格：与实放同源 chooseAnchorFromClick（Origin 对位/镜像/全窗吸附）——
    // 预览=实放一致（无解回落原版 prim=click−Origin,逐格红白）
    const pick = chooseAnchorFromClick(st, tx, ty, rec, ctx.style);
    ax = pick ? pick.x : tx - rec.ox;
    ay = pick ? pick.y : ty - rec.oy;
  } else {
    ax = tx; ay = ty;                                               // 1×1：tryPlace :27696 直判点击格（同域）
  }
  if (!footprintInBounds(st, ax, ay, rec.w, rec.h)) return;
  const cells = previewCellValues(st, ax, ay, rec, ctx.style);
  if (ctx.pylonDuplicate) cells.fill(2);                            // AllInvalid :726-731（597 同型晶塔限一座）
  placePreviewFrame.data = {
    sheet, fw: rec.w, style: ctx.style, ax, ay, w: rec.w, h: rec.h, cells,
  };
}
