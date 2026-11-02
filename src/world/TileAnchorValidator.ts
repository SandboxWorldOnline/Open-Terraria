// TileObjectData 锚点验证器（vanilla Terraria.TileObject.CanPlace 全量移植，分格判定）
// 数据源：src/data/tile-anchors.json（tools/recon-tileobj.mjs 从反编译
//   Terraria.ObjectData/TileObjectData.cs 提取，1457）。
// 验收语义（TileObject.cs CanPlace 尾判）：锚点格子与占位格【全部】通过才可放
//   （num35/num36 双满分制），备选方向按序取首个满分者。
import anchorsJson from '../data/tile-anchors.json';
import { TILE_DEFS, TILE_TABLE_SHEETS, TILE_CUT_SHEETS, BREAKABLE_WHEN_PLACING_SHEETS,
  PLATFORMS_SHEETS } from '../data/tiles';
import { VAN_TILE_SOLID_EXTRA } from './gen/vanilla/GenSolid';
import { platformProperTopFrame } from './Torch';
import { LIQUID_TYPE } from './TileStore';
// ★BJ629 件2：Main.tileNoAttach 全表单源（SmartCursor.ts:76 67 项,与 Game.ts 局部
//  NO_ATTACH_SHEETS 逐值同表——Main.cs :7260-10258 逐条赋值 + 435-439 循环 :10130）。
//  world←player 引用向无环（SmartCursor 依赖面 data/*+world/{TileStore,Housing,
//  CanCutTile} 均不回指本文件）。
import { TILE_NO_ATTACH_SHEETS } from '../player/SmartCursor';
import type { World } from './World';

export interface AnchorDataRec { t: string[]; cnt: number | string; start: number | string }
/** LiquidPlacement 枚举值入库形态（Terraria.Enums/LiquidPlacement.cs 四值；
 *  1457 基样式数据实际只出现前两者，'onlyInFull' 为子样式级（227 style5）预留。
 *  原版 OnlyInLiquid 基样式零出现，不入库值域。 */
export type LiquidPlacementVal = 'allowed' | 'notAllowed' | 'onlyInFull';
export interface AnchorRec {
  w: number; h: number; ox: number; oy: number;
  anchorTop: AnchorDataRec | null; anchorBottom: AnchorDataRec | null;
  anchorLeft: AnchorDataRec | null; anchorRight: AnchorDataRec | null;
  wall: boolean;
  /** ★M-3 液体放置两维（TileObjectData.LiquidPlace :1853-1907）：
   *  water 维 = 原版 liquidType 0/2/3（水/蜜/微光）；lava 维 = 1（岩浆）。
   *  缺省 = SetupBaseObject :1767-1768（water Allowed / lava NotAllowed）。 */
  liq: { water: LiquidPlacementVal; lava: LiquidPlacementVal };
  /** ★M-3b 子样式级液体例外（TileObjectData.cs addSubTile/addSubTileRange :2016-2096
   *  提交到 SubTiles[style] 槽;GetTileData :5142-5150 对无子样式/越界 style 回落基记录
   *  ——故只存与基记录发散的样式,命中用 style 档,未命中落 liq 基档）。
   *  alternate 维不建模：CanPlace（TileObject.cs:205-208/:342）结构上逐 alternate 取
   *  GetTileData(type,style,num7) 做 LiquidPlace,但 1457 全表 newAlternate.* 液体赋值
   *  0 行,alternate 液体恒等于所属记录（_tod-substyle-audit.mjs 双向发散计数=0）。 */
  liqStyles?: Record<string, { water: LiquidPlacementVal; lava: LiquidPlacementVal }>;
  flatten: boolean; dir: string; yOff: number;
  dirs?: Array<{ dir: string }>;
  /** ★BJ602（2026-10-10）：AnchorAlternateTiles（TileObjectData.cs:434-446）——
   *  AnchorType.AlternateTile 位的成员表；锚格 active 且 sheet∈表 → 该锚成立
   *  （isValidAlternateAnchor :1969-1984；消费位 TileObject.cs:419/:509/:611/:697）。
   *  位存在而表缺省（null）=原版本相恒 false（isValidAlternateAnchor 早退）。 */
  altTiles?: number[];
  /** ★BJ602：子样式全记录（GetTileData TileObjectData.cs:5127-5162 SubTiles[style]
   *  整记录替换非合并,越界/缺style回落基记录）。recon-tileobj 从反编译提取,
   *  只存与基记录发散的 style。 */
  subTiles?: Record<string, AnchorRec>;
  /** ★C14-F3：AnchorValidTiles/AnchorInvalidTiles（TileObjectData.cs:390-429 属性,
   *  isValidTileAnchor :1910-1935——invalid 先查,valid 缺省=无门恒 true）。
   *  消费臂=SolidTile/SolidSide/SolidBottom/Platform/PlatformNonHammered/PlanterBox
   *  六臂（TileObject.cs:390/:416/:468/:479/:487/:496/:502/:563/:570/:649/:656——
   *  SolidWithTop/Table/AlternateTile/EmptyTile 四臂【无】门）。 */
  vTiles?: number[];
  ivTiles?: number[];
  /** ★C14-F2：备档全记录（Alternates,TileObjectData.cs:2098-2108 addAlternate 提交;
   *  GetTileData(type,style,alt) :5127-5162 alt>0 → Alternates[alt-1] 整记录替换;
   *  CanPlace TileObject.cs:203-225 逐备档满分制首中）。sb = addAlternate(baseStyle)
   *  的 Style 基偏移（CalculatePlacementStyle :1989-1999 帧带数学）;sty 缺省=继承
   *  基记录同段。 */
  alts?: Array<Omit<AnchorRec, 'alts' | 'sty'> & { sb: number; sty?: AnchorRec['sty'] }>;
  /** ★C14-F2：样式/坐标模块面（TileObject.Place :60-108 备档帧带数学）——
   *  sh=StyleHorizontal/swl=StyleWrapLimit/sls=StyleLineSkip/sm=StyleMultiplier/
   *  cw=CoordinateWidth/cp=CoordinatePadding/hts=CoordinateHeights。
   *  仅携带备档的记录入库;FullWidth=(cw+cp)*w+pfx、FullHeight=Σ(hts+cp)+pfy
   *  （Calculate TileObjectData.cs:1808-1820——★BJ753 TF-07：尾加 CoordinatePaddingFix
   *  两维;1457 全表仅 79 床(0,-2)/15 椅(0,2)/497 马桶(0,2) 三记录非零,提取器
   *  非零才入库故 pfx/pfy 可选）。 */
  sty?: { sh: boolean; swl: number; sls: number; sm: number; cw: number; cp: number;
    pfx?: number; pfy?: number; hts: number[] };
  /** ★BJ602：UsesCustomCanPlace（TileObjectData.cs:145-155,ctor :1679 缺省 false）——
   *  CustomPlace（:5017-5038）路由维度。★暂只入库不设路由门（消费端 19/427/165/233
   *  等在册件照旧走既有路由）=登记债（BJ602）。 */
  uccp?: boolean;
}
const RAW = (anchorsJson as unknown as { v: string; tiles: Record<string, AnchorRec | null> }).tiles;

/** ★BJ602：AlternateTile 位已建模（altTiles 成员表）——白名单渐进解禁：
 *  698（altTiles 8 成员 TileObjectData.cs:2481）、693/694（坐地变体 subTiles 39-77
 *  全提取,位本身无成员表=原版恒 false 惰性位）。
 *  ★BJ624（2026-10-10 件2 逐族翻案,亲读反编译逐块）追加四族：
 *  · 82/83/84 药草（AnchorAlternateTiles={78} 陶盆,:4756/:4759-4782 全 subTile 同值）
 *    ——放置链走 placeAlchRuntime 专用支（Player.cs:40085 `tileToCreate != 82` 路由
 *    排除,Player.cs:40085 区）,解禁后 anchorRec 仅作数据面/预览/实体门域,放置路由
 *    不变（needSupport isAlchPlace 豁免+清格相 BJ567 专用支全在位）。
 *  · 753 巨型提基（AnchorAlternateTiles={753} 自身,:4129）——3×3 多格,解禁后入
 *    chooseAnchorFromClick/validateAnchors 表驱动链（底行 SolidWithTop 平台档归位+
 *    贴墙松臂撤除:wall=false 无墙锚=原版无墙挂档）。
 *  仍维持保守回落（BJ624 复核维持,★BJ629 更新）：419（BJ622 判语=placeLogicLampGate
 *    专用门维持;★BJ629 件4 叠挂 alternate1 Origin(0,1) 已入 Game.ts 419 门——本链仍
 *    回落,placeStyle 档/基档液体面独立有效）;442/630/631/723/724（走 Game.ts
 *    anchorTilePlacementStyle 五锚档路由=CanPlace alternates 全序,不入本链）;
 *    136 拉杆（★BJ629 件1 定谳翻正：原版 StyleSwitch 块 :4551-4577 亲读——
 *    addBaseTile(out StyleSwitch) :4560 先于 AnchorBottom 赋值 :4562,故
 *    newAlternate.CopyFrom(StyleSwitch) 三备档【不含】底锚:alt1=AnchorLeft+梁成员表
 *    {124,561,574-578}/alt2=AnchorRight+同表/alt3=AnchorWall,exclusive 制与 630/631
 *    同构——旧注「alternates 叠加底锚」系误读,保守回落已撤,改走 Game.ts 五锚档路由
 *    （ANCHOR_GATE_SPECS[136],bottomSolidTop=false 对应基记录底锚 SolidTile|SolidSide
 *    双位无 SolidWithTop）;本链 anchorSpecOf(136) 基记录仍非空（无 exotic 位）=预览面
 *    足印域消费,放置路由不经过）;
 *    165（ BJ602 销案锚维持：AlternateTile 位无成员表=原版恒 false 惰性位,入链无增益,
 *    且 subTiles 惰性位+级联面已 'stalactite' 单源）。 */
const ALTERNATE_MODELED = new Set([698, 693, 694, 82, 83, 84, 753]);

const _resolved = new Map<string, AnchorRec | null>();
/** 取 tile 的锚点规格；无数据 / 复杂构造回落(null)/含未建模豁免位者归 null 走旧路径。
 *  ★BJ602：style 给定且命中 subTiles[style] → 返回子样式记录（GetTileData 整记录
 *  替换语义,TileObjectData.cs:5127-5162）；未命中/越界回落基记录（同 :5142-5150）。 */
export function anchorSpecOf(sheet: number, style?: number): AnchorRec | null {
  const key = `${sheet}|${style ?? ''}`;
  if (_resolved.has(key)) return _resolved.get(key)!;
  const raw = RAW[String(sheet)];
  let out: AnchorRec | null = null;
  if (raw) {
    const face = (style !== undefined ? raw.subTiles?.[String(style)] : undefined) ?? raw;
    // Tree 位依赖逐族白名单（未提取）→ 整体回落旧近似（保守）;AlternateTile 已建模
    // （ALTERNATE_MODELED 三族外仍保守回落）。★基记录毒性连带子样式：基记录含未建模
    // 位 → 该 tile 整体回落（子样式路由翻转不得早于其级联/帧带建模,如 165 坐地子样式
    // 入表驱动链会以吊顶帧带落地→级联杀=掉落循环）。
    const exoticOf = (f: AnchorRec) => [f.anchorTop, f.anchorBottom, f.anchorLeft, f.anchorRight]
      .some((a) => a?.t.some((s) => s === 'Tree'
        || (s === 'AlternateTile' && !ALTERNATE_MODELED.has(sheet))));
    out = (exoticOf(raw) || exoticOf(face)) ? null : face;
  }
  _resolved.set(key, out);
  return out;
}

/** ★BJ754 TF-10（2026-11-02,issue#39）：子样式【变几何】足迹解析——放置 anchorRec
 *  选择、幸存面 w/h（checkFurnitureSupport）、破坏整件盒（breakTile object 支）三面
 *  共用单源。style 命中 subTiles[style] 且记录与基记录【不是同一对象】（GetTileData
 *  整记录替换语义,TileObjectData.cs:5127-5162——越界/缺 style 回落基记录）→ 返回
 *  子样式 w/h（王朝桌 14 style25 = 3×1,Origin(1,0),TileObjectData.cs:3187-3191;
 *  基 3×2）。未命中/基记录/exotic 回落（165/185/233 同为变几何候选但 165 基记录
 *  exotic=恒 null、185/233 无 styleFromFrame 反推表=幸存/破坏面不可达,放置面
 *  亦无对应物品入口——issue#39 仅独立验证 14/25,余者不扩刀）。 */
export function substyleFootprint(sheet: number, style: number, dw: number, dh: number): { w: number; h: number } {
  const base = anchorSpecOf(sheet);
  if (!base) return { w: dw, h: dh };
  const rec = anchorSpecOf(sheet, style);
  if (!rec || rec === base) return { w: dw, h: dh };
  return { w: rec.w, h: rec.h };
}

/** ★C14-F2（2026-10-11）备档评估链。原版 CanPlace（TileObject.cs:203-225）在单点
 *  上逐备档取 GetTileData(type,style,num7)（:207,alternate 0=基,N=Alternates[N-1]
 *  整记录替换）做满分制评分,:836-839 首个满分备档即中（break）——本仓评估链按同序
 *  逐备档首中。subTiles 命中 style 的子样式记录沿用基记录备档（LinkedAlternates
 *  语义,TileObjectData.cs:603-617;子样式独立 Alternates 1457 无实例=登记债）。 */
export interface ChainEntry { rec: AnchorRec; sb: number; sty: AnchorRec['sty'] }
/** baseOverride：调用方已按足迹门解析的基记录（Game.ts anchorRec——style 子样式
 *  足迹不符时回落基记录,链首必须与门面同记录,防子样式几何换挡）。 */
export function anchorChainOf(sheet: number, style?: number, baseOverride?: AnchorRec | null): ChainEntry[] {
  const base = baseOverride !== undefined ? baseOverride : anchorSpecOf(sheet, style);
  const raw = base ? RAW[String(sheet)] : null;
  if (!base || !raw) return [];
  const out: ChainEntry[] = [{ rec: base, sb: 0, sty: raw.sty }];
  for (const a of raw.alts ?? []) {
    // 备档 rec 物化继承 sty（入库时发散过滤省略,帧数学消费 rec.sty）
    const rec = (a.sty ? a : { ...a, sty: raw.sty }) as AnchorRec;
    out.push({ rec, sb: a.sb, sty: rec.sty });
  }
  return out;
}
/** 原版 Direction 过滤（CanPlace TileObject.cs:209-212）：备档 Direction=PlaceLeft
 *  且玩家朝右（dir==1）→ 跳过;PlaceRight 且朝左（dir==-1）→ 跳过。dir=0（未知/
 *  非玩家链）不过滤。 */
function dirSkipped(rec: AnchorRec, dir: number): boolean {
  if (dir === 0) return false;
  return (rec.dir === 'PlaceLeft' && dir === 1) || (rec.dir === 'PlaceRight' && dir === -1);
}
/** ★C14-F2 多格链：点击格 → 逐备档评估首中（基→alts 同序）。返回命中位置与备档序
 *  （alt=0 基记录,行为与旧 chooseAnchorFromClick 全等——无备档记录链长 1）。 */
export function chooseAnchorFromClickChain(st: World['store'], cx: number, cy: number,
  sheet: number, style = 0, dir = 0,
  baseOverride?: AnchorRec | null): { x: number; y: number; alt: number } | null {
  const chain = anchorChainOf(sheet, style, baseOverride);
  for (let k = 0; k < chain.length; k++) {
    if (dirSkipped(chain[k].rec, dir)) continue;
    const hit = chooseAnchorFromClick(st, cx, cy, chain[k].rec, style);
    if (hit) return { x: hit.x, y: hit.y, alt: k };
  }
  return null;
}
/** ★C14-F2 uccp 1×1 链：点击格直判（无吸附）,逐备档按各自 Origin 换算占位左上
 *  （CanPlace :208-209 `num8 = x - tileData2.Origin.X`）,首中制。返回命中备档。 */
export function validateAnchorChainAt(st: World['store'], tx: number, ty: number,
  sheet: number, style = 0, dir = 0,
  baseOverride?: AnchorRec | null): { alt: number; rec: AnchorRec; sb: number } | null {
  const chain = anchorChainOf(sheet, style, baseOverride);
  for (let k = 0; k < chain.length; k++) {
    const { rec, sb } = chain[k];
    if (dirSkipped(rec, dir)) continue;
    if (validateAnchors(st, tx - rec.ox, ty - rec.oy, rec, style)) return { alt: k, rec, sb };
  }
  return null;
}
/** ★C14-F2 备档帧带基偏移（TileObject.Place :60-108 全式）：
 *  CalculatePlacementStyle（TileObjectData.cs:1989-1999）num = placeStyle*StyleMultiplier
 *  + Style(备档 sb) + random;按记录样式模块折行（:63-68 wrap/lineSkip）;
 *  横排 frameX=FullWidth*col/frameY=FullHeight*row,竖排互换（:70-75）。
 *  FullWidth=(cw+cp)*w+pfx、FullHeight=Σ(hts+cp)+pfy（Calculate :1808-1820——
 *  ★BJ753 TF-07：PaddingFix 尾加项补齐,椅 15/马桶 497 备档行带 38→40
 *  （(16+2)+(18+2)+2,issue#39 实测右向蒸汽朋克椅 fy=874=23×38 应 920）。 */
export function alternateFrameBase(rec: AnchorRec, sb: number, placeStyle: number,
  random = 0): [number, number] {
  const sty = rec.sty;
  if (!sty) return [0, 0];
  let num = placeStyle * (sty.sm || 1) + sb + random;
  let row = 0;
  if (sty.swl > 0) { row = Math.floor(num / sty.swl) * (sty.sls || 1); num %= sty.swl; }
  const fw = (sty.cw + sty.cp) * rec.w + (sty.pfx ?? 0);
  const fh = (sty.hts ?? []).reduce((a, h) => a + h + sty.cp, 0) + (sty.pfy ?? 0);
  return sty.sh ? [fw * num, fh * row] : [fw * row, fh * num];
}
/** ★C14-F2 备档格内偏移（Place :93-108：frameX=base+k*(CoordinateWidth+CoordinatePadding),
 *  frameY=base+Σ_{l<dy}(heights[l]+pad)）。sty 缺省=旧 default（dx/dy*18）。 */
export function alternateCellFrame(rec: AnchorRec, sb: number, placeStyle: number,
  dx: number, dy: number, random = 0): [number, number] {
  const sty = rec.sty;
  if (!sty) return [dx * 18, dy * 18];
  const [bx, by] = alternateFrameBase(rec, sb, placeStyle, random);
  const fy = (sty.hts ?? []).slice(0, dy).reduce((a, h) => a + h + sty.cp, 0);
  return [bx + dx * (sty.cw + sty.cp), by + fy];
}

/** ★M-3c 液体档直读（绕开 anchorSpecOf 的 AlternateTile/Tree 豁免回落）。
 *  消费位 = Game.ts 门双锚分支（liqGateDoor——门 10/11 被显式豁免走专用路径）与
 *  药草 legacy 置放路径（liqGateHerb——药草 82-84 anchorBottom 含 AlternateTile
 *  TileObjectData.cs:4749 → anchorSpecOf 恒 null，但【液体档】与该豁免无关，
 *  liq/liqStyles 是独立两维数据）。
 *  无记录返回 null：调用方不得臆造缺省、不开门（原版 GetTileData(type,style)==null
 *  时 CheckLiquidPlacement TileObjectData.cs:5042 回落 Main.tileLavaDeath/WaterDeath
 *  全局面——本仓无该表，无记录即无门，与既有行为一致）。 */
export function liquidSpecOf(sheet: number):
  { liq: AnchorRec['liq']; liqStyles?: AnchorRec['liqStyles'] } | null {
  const raw = RAW[String(sheet)];
  return raw ? { liq: raw.liq, liqStyles: raw.liqStyles } : null;
}

/** 原版 blockType()：0 平整 / 1 半砖 / 2..5 = slope1..4 */
function btOf(st: World['store'], x: number, y: number): number {
  const i = st.idx(x, y);
  if (st.half[i]) return 1;
  const s = st.slope[i];
  return s > 0 ? s + 1 : 0;
}
function defAt(st: World['store'], x: number, y: number) {
  return TILE_DEFS[st.get(x, y)];
}
function solidPureFlat(st: World['store'], x: number, y: number, flatten: boolean): boolean {
  // SolidTile 位：tileSolid 且非 tileSolidTop；默认还要求 blockType==0
  // （FlattenAnchors 时坡/半砖亦可）；noAttach 表近似忽略（常见家具锚面皆可附）
  // ★G1谓词批(2026-09-04)：现无调用点（死代码备案）。复活前置——须补原版 active
  // 双门（WorldGen.cs:70652-70658 SolidTile = active() && tileSolid && !tileSolidTop
  // && !halfBrick && slope==0 && !inActive()）：首门 active 位本体读 st.hasTile、
  // 尾门致动位 st.isActuated——本函数只读 type/half/slope,幽灵残型与已致动格都会
  // 被误判锚面
  const d = defAt(st, x, y);
  if (!d) return false;
  if (!(d.solid && !d.platform)) return false;
  return flatten || btOf(st, x, y) === 0;
}
/** 原版 blockType 侧缘对位表（SolidSide）：bottom{4,5} top{2,3} left{3,5} right{2,4} */
const SIDE_BT_PAIRS: Record<string, number[]> = {
  bottom: [4, 5], top: [2, 3], left: [3, 5], right: [2, 4],
};

interface SideSpec { t: string[]; cnt: number; start: number }

/** ★C14-F3：isValidTileAnchor（TileObjectData.cs:1910-1935 全支）——AnchorValidTiles/
 *  AnchorInvalidTiles 成员表门：先查 invalid（命中即 false）,再查 valid（表缺省=null
 *  =无门恒 true;有表须命中）。消费臂=SolidTile/SolidSide/SolidBottom/Platform/
 *  PlatformNonHammered/PlanterBox（TileObject.cs:390/:416/:468/:479/:487/:496/:502/
 *  :563/:570/:649/:656——SolidWithTop/Table/AlternateTile/EmptyTile 四臂【无】门）。
 *  表数据源=recon-tileobj 提取 vTiles/ivTiles（C14-F3 维度）;mem=style 解析后的
 *  成员表面（validateAnchors 子样式档,见该函数 C14-F3 注）。 */
function validTileAnchor(mem: Pick<AnchorRec, 'vTiles' | 'ivTiles'>, sheet: number): boolean {
  if (mem.ivTiles?.includes(sheet)) return false;
  if (!mem.vTiles) return true;
  return mem.vTiles.includes(sheet);
}

/** 顶坡判定（blockType 2/3 = slope1/2 上坡面;TileObject.cs:481 `topSlope()`）。 */
function isTopSlope(st: World['store'], x: number, y: number): boolean {
  const b = btOf(st, x, y);
  return b === 2 || b === 3;
}

/** evalCell 返回值 = 原版 num30（成功:0/8;失败:null）——AllFlatHeight 顶侧全行一致
 *  门（TileObject.cs:493-530 num28 跨格一致制）的消费面。 */
function evalCell(side: string, spec: SideSpec, at: [number, number],
  st: World['store'], rec: AnchorRec,
  mem: Pick<AnchorRec, 'vTiles' | 'ivTiles'> = rec): number | null {
  const [cx, cy] = at;
  if (!st.inBounds(cx, cy)) return null;
  const active = st.isActive(cx, cy);
  const bit = (name: string) => spec.t.includes(name);
  let ok = false;
  let h30 = 0;
  if (active) {
    const d = defAt(st, cx, cy)!;
    const sheet = d?.vanilla?.sheet ?? -1;
    const iCell = st.idx(cx, cy);
    // ★BJ629 件2（2026-10-10）：SolidTile 臂补 !tileNoAttach 排除（原版四锚同款:
    //  底 TileObject.cs:388 / 顶 :457 / 右 :561 / 左 :647——`Main.tileSolid &&
    //  !Main.tileSolidTop && !Main.tileNoAttach && (FlattenAnchors || blockType()==0)`）。
    //  ★C14-F3：isValidTileAnchor 门（:388-390/:457-459/:561-563/:647-649 同式）。
    //  旧缺=松于原版:关态门 10（tileSolid[10]=true Main.cs:8027 而 noAttach[10]=true
    //  Main.cs:7812 区）等 noAttach 实心件曾被当承重锚（可浮贴门顶等）。其余臂不受影
    //  响:SolidSide（:411/:497/:565/:651）/SolidBottom（:465）/SolidWithTop（:392-406）
    //  原文本就无 noAttach 位——勿扩大。多格链共面（validateAnchors 逐格）一并受益。
    if (bit('SolidTile') && d?.solid && !d.platform && st.wall[iCell] >= 0
      && !TILE_NO_ATTACH_SHEETS.has(sheet)
      && (rec.flatten || btOf(st, cx, cy) === 0)
      && validTileAnchor(mem, sheet)) ok = true;
    // ★C14-F1（2026-10-11 判谳级翻正,R14-F1 定谳亲读复核）：共享臂两开——原版
    //  TileObject.cs:392-406 共享臂条件 = `(AnchorType.SolidWithTop || AnchorType.Table)`
    //  （两 bit 任一即进入平台/实心∧solidTop 分支）,:407-410 Table 臂
    //  （tileTable∧!Platform∧bt0）= 追加支。旧 BJ624「两臂拆分」把共享臂只挂
    //  SolidWithTop = 严于原版：Table 单位记录（书 50/烛 33/水烛 49/存钱罐/瓶/石像族
    //  等 86 条）的平台承重被拒。亲读判语（1457 原文 TileObject.cs:392-410）：
    //  `if (!flag6 && ((anchorBottom.type & AnchorType.SolidWithTop) == AnchorType.SolidWithTop
    //    || (anchorBottom.type & AnchorType.Table) == AnchorType.Table)) {`
    //  生存面同构双证：WorldGen.AnchorValid :52310-52326 同式两开。
    //  登记债（本刀未动）：平台支的 `rec.flatten ||` 原版无此项（FlattenAnchors 只在
    //  SolidTile/SolidSide 臂,TileObject.cs:388/:416/:457/:561/:647）——flatten=true 三件
    //  （4/136/442）半砖平台在本支松于原版;活路由不达（4 专用支/136·442 五锚档专支）
    //  =惰性偏差,C14 备案未落刀。
    if (!ok && (bit('SolidWithTop') || bit('Table'))) {
      if (PLATFORMS_SHEETS.has(sheet)) {
        // 平台支（:394-401）：Platforms ∧ !halfBrick ∧ PlatformProperTopFrame
        if (rec.flatten || (!st.half[iCell] && platformProperTopFrame(st.frameX[iCell] ?? 0))) ok = true;
      } else if (VAN_TILE_SOLID_EXTRA.has(sheet)) {
        // 非平台支（:402-405）：tileSolid ∧ tileSolidTop（九件套差集 239/380 等,
        //  无 blockType 门——坡/半砖锭顶亦承,原版本相）
        ok = true;
      }
    }
    if (!ok && bit('Table') && TILE_TABLE_SHEETS.has(sheet) && !PLATFORMS_SHEETS.has(sheet)
      && btOf(st, cx, cy) === 0) ok = true;
    if (!ok && bit('SolidSide') && d?.solid && !d.platform
      && SIDE_BT_PAIRS[side]?.includes(btOf(st, cx, cy))
      && validTileAnchor(mem, sheet)) ok = true;
    if (!ok && bit('PlanterBox') && sheet === 380 && validTileAnchor(mem, sheet)) ok = true;
    // ★BJ602：AlternateTile 位（TileObject.cs:419/:509/:611/:697）——锚格 active 且
    // sheet ∈ rec.altTiles（AnchorAlternateTiles,isValidAlternateAnchor
    // TileObjectData.cs:1969-1984）→ 锚成立。表缺省 = 原版本相恒 false（惰性位）。
    if (!ok && bit('AlternateTile') && (rec.altTiles ?? []).includes(sheet)) ok = true;
    // ★C14-F2c/d（2026-10-11）：顶锚 Platform / PlatformNonHammered 两臂（原版顶锚
    //  专有,TileObject.cs:477-490——底/侧锚无此二位）：
    //  · Platform（:477-483）：Platforms → isValidTileAnchor 门;num30=(!halfBrick∧
    //    !topSlope)?8:0（平顶平台挂装下探 8px 语义,AllFlatHeight 一致门消费）。
    //  · PlatformNonHammered（:485-490）：Platforms ∧ slope()==0 ∧ !halfBrick →
    //    isValidTileAnchor 门;num30=8。（591 灯柱平台顶放备档=
    //    PlatformNonHammered|AllFlatHeight,TileObjectData.cs:3094。）
    if (!ok && bit('Platform') && PLATFORMS_SHEETS.has(sheet)
      && validTileAnchor(mem, sheet)) {
      ok = true;
      h30 = (!st.half[iCell] && !isTopSlope(st, cx, cy)) ? 8 : 0;
    }
    if (!ok && bit('PlatformNonHammered') && PLATFORMS_SHEETS.has(sheet)
      && btOf(st, cx, cy) === 0 && !st.half[iCell]
      && validTileAnchor(mem, sheet)) {
      ok = true;
      h30 = 8;
    }
    if (!ok && bit('SolidBottom')) {
      // Composite（TileObject :541-556）：整实心 / 半砖 / 顶坡 / 平台的半砖·顶坡形态；
      // NotReallySolid/bottomSlope 近似忽略（花箱族已由 PlanterBox 覆盖）
      // ★C14-F3：SolidBottom 臂亦过 isValidTileAnchor 门（:463-475）
      const b = btOf(st, cx, cy);
      if ((d?.solid || b === 1 || b >= 2) && validTileAnchor(mem, sheet)) ok = true;
    }
  } else if (bit('EmptyTile')) ok = true;
  return ok ? h30 : null;
}

/** ★M-3c 单格液体放置门（TileObjectData.LiquidPlace TileObjectData.cs:1853-1907 全支）。
 *  validateAnchors 的逐格液体门与【非锚点表消费位】（Game.ts 门双锚分支 liqGateDoor /
 *  药草 legacy 路径 liqGateHerb）共用同一实现——液体语义单源，禁止在消费侧复刻。
 *  维度：岩浆（LIQUID_TYPE.LAVA=原版 liquidType 1）走 lava 档，其余（WATER/HONEY/
 *  SHIMMER=原版 0/2/3）走 water 档。液体量 >0：NotAllowed 拒 / onlyInFull 非满液(255) 拒；
 *  量 ==0（dry）：onlyIn* 恒拒（:1886-1904 else 支——基样式数据无 onlyIn 值,分支为
 *  语义完备性保留）。调用方保证 (x,y) 在界内（validateAnchors 已界内检查）。 */
export function liquidCellOk(st: World['store'], x: number, y: number,
  liq: { water: LiquidPlacementVal; lava: LiquidPlacementVal }): boolean {
  const i = st.idx(x, y);
  const amt = st.liquid[i];
  // 本仓 liquidType 为原版 +1 编码（TileStore.LIQUID_TYPE）；0(NONE) 视同水（同
  //  Game.ts:21951 惯例——原版 liquidType()==0 即水）
  const spec = st.liquidType[i] === LIQUID_TYPE.LAVA ? liq.lava : liq.water;
  if (amt > 0) {
    if (spec === 'notAllowed') return false;
    if (spec === 'onlyInFull' && amt !== 255) return false;
  } else if (spec === 'onlyInFull') {
    return false;
  }
  return true;
}

/** 检验“某物放在 ax,ay 是否满足全部锚点”。CanPlace 的 all-or-nothing 判定。
 *  液体门 = 两维建模（rec.liq.water/lava，见下方逐格注释）；wall 族沿用
 *  isValidWallAnchor 默认分支（任意非零墙均有效）。occupiedIgnore：调用方为
 *  “原地重放”场景给的豁免面。style = itemDef.placeStyle（原版 Item.placeStyle →
 *  TileObjectData style,TileObject.CanPlace :176 GetTileData(type,style)）：
 *  ★M-3b 命中 rec.liqStyles[style] 子样式档,未命中回落 rec.liq 基档（vanilla
 *  GetTileData :5142-5150 SubTiles[style]==null/越界回落基记录的同构语义）。 */
export function validateAnchors(st: World['store'], ax: number, ay: number, rec: AnchorRec,
  style = 0, occupiedIgnore?: (x: number, y: number) => boolean): boolean {
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
  // ★C14-F6（2026-10-11）：边距 5 格硬门对齐（TileObject.CanPlace :215——
  //  `num8 < 5 || num8 + Width > maxTilesX - 5 || num9 < 5 || num9 + Height > maxTilesY - 5
  //  → return false`）。原版 quirk：该门在备档循环【内】逐备档判定且为硬 return——
  //  任一备档自身 Origin/W/H 越出 5 格边距即整体拒（F2 备档链逐档复验同款）。
  //  旧 1 格边距=松于原版（贴世界边 5 格内可放）。
  if (ax < 5 || ay < 5 || ax + rec.w > st.w - 5 || ay + rec.h > st.h - 5) return false;
  for (let j = 0; j < rec.h; j++) {
    for (let i = 0; i < rec.w; i++) {
      const x = ax + i, y = ay + j;
      if (!st.inBounds(x, y)) return false;
      const i2 = st.idx(x, y);
      if (occupiedIgnore?.(x, y)) continue;
      // 占位格阻挡判定（CanPlace TileObject.cs:357）：tileCut ∪ BreakableWhenPlacing
      // 均不阻挡（写入前 TileObject.Place :84-86 KillTile 清除）；特例 484/654 虽属
      // tileCut 仍阻挡。★石堆族 185 曾漏入例外面——小石子挡家具须镐挖(用户实报)。
      // ★终审 B①（2026-09-04）：门读裸 active()（=hasTile,含已致动格）——原版
      //  CanPlace :357 占用面为 tile.active() 非 nactive(),已致动格=占用拒绝放置
      //  （曾用 isActive=nactive() → 致动格被当空位;豁免件清格侧 KillTile 尾
      //  WorldGen.cs:64431 复位 inActive,setTile(0) 已同步清 WIRE_ACTUATED）。
      {
        const shOc = defAt(st, x, y)?.vanilla?.sheet ?? -1;
        const clearable = (shOc !== -1 && shOc !== 484 && shOc !== 654
          && TILE_CUT_SHEETS.has(shOc)) || BREAKABLE_WHEN_PLACING_SHEETS.has(shOc);
        if (st.hasTile(x, y) && !clearable) return false;
      }
      // ★M-3 液体放置两维门（vanilla TileObjectData.LiquidPlace 全支，TileObjectData.cs
      //  :1853-1907；CanPlace 逐格消费 TileObject.cs:342 → :361 flag3 并入拒放）：
      //  · 液体量 >0：lava 型（LIQUID_TYPE.LAVA=原版 liquidType 1）走 lava 维，其余
      //    （WATER/HONEY/SHIMMER=原版 0/2/3）走 water 维；NotAllowed 拒；
      //    onlyInFull 非满液（255）拒。
      //  · 液体量 ==0（dry）：onlyIn* 语义拒（:1886-1904 else 支——onlyInFull/onlyInLiquid
      //    在无液格恒拒）。基样式数据暂无 onlyIn 值，分支为语义完备性保留。
      //  旧实现 liqAllow 单维布尔（缺省 false=液体中一律拒）与原版 382/382 反向，已翻正。
      //  ★M-3b：style 档解析——命中 liqStyles[style] 用子样式记录（如火把 4 styles
      //  8/11/17 水岩浆均放 TileObjectData.cs:4612-4613、染料 227 style5 onlyInFull
      //  :2196），未命中落基档（= GetTileData 回落语义,TileObjectData.cs:5142-5150）。
      //  ★M-3c：门体实现上移 liquidCellOk（门双锚分支/药草 legacy 路径共源）。
      {
        const liq = rec.liqStyles?.[String(style)] ?? rec.liq;
        if (!liquidCellOk(st, x, y, liq)) return false;
      }
      if (rec.wall && st.wall[i2] === 0) return false;
    }
  }
  return evalAnchorSides(st, ax, ay, rec, style);
}

/** ★BJ752-A（2026-11-02,issue#39 TF-01/02）：锚带评估核（top/bottom/left/right 四侧
 *  evalCell）——validateAnchors（放置）与 validateAnchorBand（幸存）共源。锚格
 *  带位一律取【足迹边缘】：底=行 ay+h、顶=行 ay-1、左=列 ax-1、右=列 ax+w
 *  （CanPlace :404-716 同式;备档 ox/oy 只影响放置吸附不影响带位）。 */
function evalAnchorSides(st: World['store'], ax: number, ay: number, rec: AnchorRec,
  style = 0): boolean {
  const sideSpec = (side: 'top' | 'bottom' | 'left' | 'right'): SideSpec | null => {
    const a = side === 'top' ? rec.anchorTop : side === 'bottom' ? rec.anchorBottom
      : side === 'left' ? rec.anchorLeft : rec.anchorRight;
    if (!a) return null;
    return {
      t: a.t,
      cnt: typeof a.cnt === 'number' ? a.cnt : rec.w,
      start: typeof a.start === 'number' ? a.start : Math.max(0, rec.h - 1),
    };
  };
  // ★C14-F3（2026-10-11）：成员表 style 档解析（M-3b liqStyles 同构——GetTileData
  //  整记录替换语义,子样式记录的 AnchorValidTiles/InvalidTiles 随 style 生效;
  //  未命中回落基记录表。消费例：药草 82/83/84 style1-6 六表 :4758-4781——
  //  style4 死亡草 {53,116} 沙面专锚,基表 {2,477,109,492} 草面——旧基表单档把
  //  子样式合法锚面全拒）。锚几何仍取 rec 本体（足迹门在调用方解析,同 BJ602 约定）。
  const subFace = rec.subTiles?.[String(style)];
  const mem: Pick<AnchorRec, 'vTiles' | 'ivTiles'> = subFace
    ? { vTiles: subFace.vTiles ?? rec.vTiles, ivTiles: subFace.ivTiles ?? rec.ivTiles }
    : rec;
  const bottom = sideSpec('bottom');
  if (bottom) for (let k = 0; k < bottom.cnt; k++) {
    if (evalCell('bottom', bottom, [ax + bottom.start + k, ay + rec.h], st, rec, mem) === null) return false;
  }
  // ★C14-F2d：顶侧 AllFlatHeight 一致门（TileObject.cs:493-530）——num28 = 首格 num30,
  //  后续格 num30 不一致即该格失败（整侧全行同高制,591 平台顶放备档消费）。
  const top = sideSpec('top');
  if (top) {
    let num28 = -1;
    for (let k = 0; k < top.cnt; k++) {
      const h30 = evalCell('top', top, [ax + top.start + k, ay - 1], st, rec, mem);
      if (h30 === null) return false;
      if (top.t.includes('AllFlatHeight')) {
        if (num28 === -1) num28 = h30;
        else if (num28 !== h30) return false;
      }
    }
  }
  const left = sideSpec('left');
  if (left) for (let k = 0; k < left.cnt; k++) {
    if (evalCell('left', left, [ax - 1, ay + left.start + k], st, rec, mem) === null) return false;
  }
  const right = sideSpec('right');
  if (right) for (let k = 0; k < right.cnt; k++) {
    if (evalCell('right', right, [ax + rec.w, ay + right.start + k], st, rec, mem) === null) return false;
  }
  return true;
}

/** ★BJ752-A（2026-11-02,issue#39 TF-01/02）：幸存锚带校验——放置侧 validateAnchors
 *  的【锚带子集】（墙臂 + 四侧 evalCell）,不带占位/液体/5 格边距门：
 *  · 占位门：幸存复验时足迹被本件自占（原版 Check* 无自占检查,CanPlace :357
 *    只在放置时消费）;液体门：原版 Check3x2/Check2xX/Check1x2 幸存判据
 *    （SolidTileAllowBottomSlope 族）无液体维度;边距门：TileFrame :82606-82609
 *    的 5 格界门由【派发面】（checkDecorSquareFrame）承担,谓词本身不拒——
 *    拒则边缘物件在原版「不派发=幸存」的等价语义下被误杀。
 *  墙臂 = 足迹全格 wall>0（CanPlace :347-353 / CheckSign alt4 :44030 同式）。
 *  消费面 = Game.checkFurnitureSupport 幸存分派（TF-01：wall 只认显式 AnchorWall
 *  记录;TF-02：SolidWithTop/SolidSide 臂承接平台与合法底坡）。 */
export function validateAnchorBand(st: World['store'], ax: number, ay: number, rec: AnchorRec,
  style = 0): boolean {
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
  if (!st.inBounds(ax, ay) || !st.inBounds(ax + rec.w - 1, ay + rec.h - 1)) return false;
  if (rec.wall) {
    for (let j = 0; j < rec.h; j++) {
      for (let i = 0; i < rec.w; i++) {
        if (st.wall[st.idx(ax + i, ay + j)] === 0) return false;
      }
    }
  }
  return evalAnchorSides(st, ax, ay, rec, style);
}
/** 点击格 → 锚定位置换算 + Smart 吸附。返回最终锚点（占位左上角）。
 *  候选序（vanilla 手感：Smart Cursor 对持拿物的幽灵吸附重定向，行为子集）：
 *  ①主 Origin 对位；②方向备选水平镜像；③★全窗吸附——
 *    水平覆盖点击列落在物件横向跨度内的所有锚（贴墙缝点首/尾格即成），垂直
 *    覆盖「点击格作为底锚行正上方悬坐」（点到地表固体上时幽灵整体上移），
 *    按「Origin 所在格到点击的曼哈顿距」升序取首个满分者。
 *  style = itemDef.placeStyle（★M-3b 子样式液体档,透传 validateAnchors）。 */
export function chooseAnchorFromClick(st: World['store'], cx: number, cy: number, rec: AnchorRec,
  style = 0): { x: number; y: number } | null {
  const prim = { x: cx - rec.ox, y: cy - rec.oy };
  if (validateAnchors(st, prim.x, prim.y, rec, style)) return prim;
  if ((rec.dirs?.length ?? 0) > 0 && rec.w > 1) {
    const mx = { x: cx - ((rec.w - 1) - rec.ox), y: cy - rec.oy };
    if (mx.x !== prim.x && validateAnchors(st, mx.x, mx.y, rec, style)) return mx;
  }
  // ③ 全窗吸附：横向让点击列 ∈ [ax, ax+w-1]（ax ∈ [cx-w+1, cx]，与 Origin 解耦），
  //    纵向 ay ∈ [cy-h, cy]：「物件直接坐在点击行上方」(ay=cy-h, 点地表块本体)
  //    至「点击行即物件顶行」。排序键 = 物件 Origin 格到点击的曼哈顿距，同距低者优。
  type Cand = { ax: number; ay: number; d: number };
  const out: Cand[] = [];
  for (let dxx = -(rec.w - 1); dxx <= 0; dxx++) {
    const ax = cx + dxx;
    for (let ay = cy - rec.h; ay <= cy; ay++) {
      if (ax === prim.x && ay === prim.y) continue;
      const oxCell = ax + rec.ox, oyCell = ay + rec.oy;
      out.push({ ax, ay, d: Math.abs(oxCell - cx) + Math.abs(oyCell - cy) });
    }
  }
  out.sort((a, b) => a.d - b.d || a.ay - b.ay || a.ax - b.ax);
  for (const c of out) {
    if (validateAnchors(st, c.ax, c.ay, rec, style)) return { x: c.ax, y: c.ay };
  }
  return null;
}
/** ★BJ557（2026-10-07）：放置预览幽灵【逐格】1/2 值（TileObject.CanPlace onlyCheck
 *  占位循环 TileObject.cs:340-372 1:1——每格 num11=2（阻挡红）/1（可放白））。
 *  判定域 = 足印（w×h）三谓词,与 validateAnchors 足印段逐谓词同源（:169-199）：
 *  · 占位（:357 `tileSafely.active() && (!tileCut ∨ 484/654) && !BreakableWhenPlacing`）
 *  · 液体（:342 flag3 = !LiquidPlace——liqStyles[style] 档,同 M-3b）
 *  · 墙（:347-353 AnchorWall → isValidWallAnchor——本仓默认分支=任意非零墙）。
 *  ★与 validateAnchors 的关系：本表全 1 是 validateAnchors 通过的【必要非充分】
 *  条件（锚点带 :404-716 不在本判定;原版锚带格同样写 1/2 但 DrawPreview 绘制窗
 *  只取 ObjectStart..+W/H（:936-938 continue 跳过）=锚带格【永不可见】——故预览
 *  只需足印值;锚失败时原版幽灵仍显示白格（点击落空=原版本相,照抄）。 */
export function previewCellValues(st: World['store'], ax: number, ay: number, rec: AnchorRec,
  style = 0): Uint8Array {
  const cells = new Uint8Array(rec.w * rec.h);
  const liq = rec.liqStyles?.[String(style)] ?? rec.liq;
  for (let j = 0; j < rec.h; j++) {
    for (let i = 0; i < rec.w; i++) {
      const x = ax + i, y = ay + j;
      if (!st.inBounds(x, y)) { cells[j * rec.w + i] = 2; continue; }
      const i2 = st.idx(x, y);
      const shOc = defAt(st, x, y)?.vanilla?.sheet ?? -1;
      const clearable = (shOc !== -1 && shOc !== 484 && shOc !== 654
        && TILE_CUT_SHEETS.has(shOc)) || BREAKABLE_WHEN_PLACING_SHEETS.has(shOc);
      if (st.hasTile(x, y) && !clearable) { cells[j * rec.w + i] = 2; continue; }
      if (!liquidCellOk(st, x, y, liq)) { cells[j * rec.w + i] = 2; continue; }
      if (rec.wall && st.wall[i2] === 0) { cells[j * rec.w + i] = 2; continue; }
      cells[j * rec.w + i] = 1;
    }
  }
  return cells;
}
export const ANCHOR_JSON_V = (anchorsJson as unknown as { v: string }).v;
