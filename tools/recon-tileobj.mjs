// TileObjectData 锚点表提取器（1457 反编译 Terraria.ObjectData/TileObjectData.cs 单一真值源）
// 产物：
//   src/data/tile-anchors.json          运行时清单（Game.tryPlace 表驱动放置）
//   tests/golden/tile-anchor-authority.json 金标（tests/bj602-tile-anchor-gaps.test.ts
//   :44 同拍闸门——golden 与 runtime 由本脚本单次运行成对重写,禁止只改其一）
// 解析策略：TileObjectData.cs 是线性 builder 脚本（assign → CopyFrom → addBaseTile → addTile）。
// 顺序模拟赋值面；未知语句置 poisoned —— ★F5 勘正（C14,2026-10-11）：poisoned 只是
//   warn 台账（stats.warned）,该 addTile 记录仍按已解析面提交入库（manifest[id]=rec）,
//   并非旧注所写的「记为 unparsed=null 回落旧近似路径」；unparsed=null 仅当 W/H 缺失
//   无法表驱动时（addTile 处理器 work.w<=0 分支）。
// ★M-3b（2026-09-02 子样式级液体例外建模）：newSubTile.* 液体写入解析成 per-style 记录
//   `liqStyles: { [style]: {water,lava} }`【只存与基记录发散的样式】——GetTileData
//   （TileObjectData.cs:5127-5162）对 SubTiles[style]==null/越界回落基记录,发散过滤
//   恰好等价;addSubTile/addSubTileRange（:2016-2096）的 style 序号=SubTiles 列表下标
//   （params 展开逐个提交,addSubTileRange 按 startStyle+i 递增）;newSubTile.CopyFrom
//   (newTile/StyleX/自身) 继承源液体态,覆写经 setter COW 只落子样式模块（:1698-1715
//   CopyFrom 不拷 _hasOwn* 旗,首写必 COW）。alternate 维不建模：CanPlace（TileObject.cs
//   :205-208）结构上逐 alternate 取 GetTileData(type,style,num7) 做 LiquidPlace（:342）,
//   但 1457 全表 newAlternate.* 液体赋值 0 行（382 行 newAlternate 零命中）,addAlternate/
//   内联 Alternates.Add 的 alternate 液体与所属记录恒等（tools/_tod-substyle-audit.mjs
//   双向发散计数=0）→ 无 alternate 记录可建。LiquidDeath 的 Calculate() 耦合
//   （:1821-1831）在 addSubTile 提交前对子样式同样适用。
// ★M-3（2026-09-02 液体放置面两维建模）：liqAllow 单维布尔（缺省 false=液体中全拒，
//   与原版 382/382 反向）升级为 `liq: { water, lava }` 两维、值 ∈ 'allowed'|'notAllowed'|
//   'onlyInFull'。真值结构（TileObjectData.cs）：SetupBaseObject 缺省 water=Allowed/
//   lava=NotAllowed（:1767-1768）；newTile 级显式赋值 25 行（WaterPlacement 16 全
//   NotAllowed / LavaPlacement 9 含 3 条 Allowed）；newSubTile 级液体赋值 86 行
//   （WaterPlacement 18 / LavaPlacement 27 / Death 41）为子样式覆写【不进入基记录】
//   ——消费端单记录模型=基样式语义，子样式例外台账见批次报告；LiquidDeath 经
//   Calculate()（:1820-1833）提交耦合强制 NotAllowed。消费端 TileAnchorValidator 按
//   liquidType 分流（water 维=WATER/HONEY/SHIMMER，lava 维=LAVA；LIQUID_TYPE 枚举换算，
//   原版 liquidType 0/2/3↔水维、1↔岩浆维）。
// ★BJ602（2026-10-10 tile-anchors 提取缺口收尾）新增三维度：
//   ① `wall` 继承修复：Width 处的家族头净化改为【仅本块无 CopyFrom 时】生效——
//      CopyFrom(Style3x3Wall)（:4794 AnchorWall=true）后接 Width 的 241/242/245/246
//      旧提取 wall 恒 false（继承面被无条件清零）=提取缺口（BJ600 登记）。
//   ② `altTiles`：AnchorAlternateTiles（:434-446/:1969-1984 isValidAlternateAnchor）——
//      AnchorType.AlternateTile 位的成员表，newTile 级入库（8 族：82/83/84/419/630/
//      631/698/753）；newAlternate/newSubTile 级随脸未建模（计数审计）。
//   ③ `subTiles`：子样式全记录（GetTileData :5127-5162 SubTiles[style] 整记录替换）——
//      newSubTile 几何/锚/路由字段建模进 subWork 脸，addSubTile 提交，与基记录
//      发散过滤入库（14 style25 3×1 炉 / 165 / 693 / 694 style39-77 坐地变体等）。
//      未建模子样式字段（AnchorValidTiles/DrawFrameOffsets 非中性项等）→ subPoisoned
//      该 style 不提交回落基记录（fail-safe，与基记录 poison 仅 warn 不同）。
//   ④ `uccp`：UsesCustomCanPlace（:145-155,ctor :1679 缺省 false,CopyFrom :1702 继承,
//      ApplyNaturalObjectRules :1847-1851 置 false）——CustomPlace（:5017-5038）路由
//      维度；只记 true。★消费端暂不设 CustomPlace 门（19/427/165/233 等在册件照旧
//      走本仓既有路由）=登记债（BJ602）。
// ★C14-F2/F3（2026-10-11 备档全记录 + 成员表门维度）新增四维度：
//   ⑤ `alts`：Alternates 全记录（newAlternate 工作面建模——CopyFrom(newTile/newSubTile/
//      Style*) 快照 → 属性写入 → addAlternate(baseStyle) 提交,TileObjectData.cs:2098-2108
//      `newAlternate.Style = baseStyle` 后入 Alternates 列表并复位）。每备档整记录
//      `sb`=Style 基偏移（CalculatePlacementStyle :1989-1999 帧带数学）;未建模属性
//      → altPoisoned 该备档不提交（fail-safe,GetTileData 回落基记录不成立——alternate
//      无回落,CanPlace :207 GetTileData(type,style,num7) num7<=AlternatesCount 上界,
//      毒备档直接缺失=与旧版「无备档」同相）。消费端=TileAnchorValidator 评估链
//      （chooseAnchorFromClickChain/validateAnchorChainAt,逐备档满分制首中,CanPlace
//      TileObject.cs:203-225/:836-839）。
//   ⑥ `sty`：样式/坐标模块面（Place :60-108 备档帧带数学）——sh=StyleHorizontal/
//      swl=StyleWrapLimit/sls=StyleLineSkip/sm=StyleMultiplier/cw=CoordinateWidth/
//      cp=CoordinatePadding/hts=CoordinateHeights。仅携带 alts 的记录入库（含基记录
//      与发散备档两处;FullWidth=(cw+cp)*w、FullHeight=Σ(hts+cp),Calculate
//      :1808-1820）。
//   ⑦ `vTiles`/`ivTiles`：AnchorValidTiles/AnchorInvalidTiles（:390-429 属性,
//      isValidTileAnchor :1910-1935——invalid 先查、valid 缺省无门）,newTile/
//      newSubTile/newAlternate 三脸同式;消费臂=SolidTile/SolidSide/SolidBottom/
//      Platform/PlatformNonHammered/PlanterBox 六臂（C14-F3）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = process.env.TOD_SRC ?? `${process.env.SW_PROJECT_ROOT ?? new URL('../../', import.meta.url).pathname.replace(/\/+$/, '')}/Terarria1457/Terraria.ObjectData/TileObjectData.cs`;   // ★C档可移植
const OUT_RUNTIME = process.env.TOA_OUT ?? 'src/data/tile-anchors.json';
const OUT_GOLDEN = process.env.TOA_GOLDEN ?? 'tests/golden/tile-anchor-authority.json';

const cs = readFileSync(SRC, 'utf8');
const lines = cs.split(/\r?\n/);

// ★M-3c 家族头缺省继承锚点：Initialize 头部 `newTile = new TileObjectData(_baseObject);`
// （TileObjectData.cs:2125，首个 addTile 调用之前）把工作面重装为 _baseObject 终态
// ——SetupBaseObject :1779-1781 Width=1/Height=1/Origin=Point16.Zero + 锚全空
// （default(AnchorData) tileCount=0）+ 液体缺省（:1767-1768）。tile 19/427 平台族
// 家族头不声明 W/H/Origin/锚（:2126-2149）⇒「1×1 无锚」即原版数据形态（非解析
// 缺陷）——此前未建模该语句 → work.w=0 落 unparsed。只认首个 addTile【调用】之前的
// 该语句：:2006/:2013 两处在 addBaseTile/addTile 方法体内，语义已由 addTile 处理器
// 的 resetLiquid（几何沿"家族头净化"约定跨定义继承）承载，不在此重复建模。
const firstAddTileCallAt = lines.findIndex((l) => /^addTile\(-?\d+\)\s*;/.test(l.trim()));

// ---- 状态机 ----
// work: 当前 newTile 工作面；bases: addBaseTile 命名样式；pendingAlts: 尚未随 addTile 提交的备选方向
// ---- M-3 液体放置两维建模（vanilla Terraria.Enums/LiquidPlacement.cs 四值枚举）----
//  值域（基样式级实际出现前三者；OnlyInLiquid 为原版枚举值但 1457 全表基样式零出现，
//  入库值域按任务规格收窄为三值——子样式级 OnlyInFullLiquid 仅 227 style5 一例，不入基记录）：
//    allowed / notAllowed / onlyInFull
//  维度 = LiquidPlacementModule.water/.lava（Terraria.Modules/LiquidPlacementModule.cs:5-8）：
//    water 维管原版 liquidType 0/2/3（水/蜜/微光），lava 维管 1（TileObjectData.LiquidPlace
//    :1853-1907 switch 分支）。本仓 TileStore.LIQUID_TYPE 是原版 +1 编码，消费端换算。
//  缺省 = SetupBaseObject（TileObjectData.cs:1767-1768）：WaterPlacement=Allowed /
//    LavaPlacement=NotAllowed。⚠️ LiquidPlacementModule 自身 ctor 缺省是两维全 Allowed
//    （Module cs:11-14），但 _baseObject 构造后立即被 SetupBaseObject 覆盖为岩浆禁。
const LIQ_DEFAULTS = Object.freeze({ water: 'allowed', lava: 'notAllowed' });
// ★BJ602：子样式脸建模域（几何/锚/路由=实义;中性=不建模合法;其余=毒→回落基记录）
// ★C14-F3：anchorvalidtiles/anchorinvalidtiles 入实义域（子样式 valid 表,186/82 等）。
const SUB_GEOM_PROPS = new Set(['width', 'height', 'origin', 'anchorbottom', 'anchortop',
  'anchorleft', 'anchorright', 'anchorwall', 'flattenanchors', 'direction', 'drawyoffset',
  'usescustomcanplace', 'anchoralternatetiles', 'anchorvalidtiles', 'anchorinvalidtiles']);
const SUB_NEUTRAL_PROPS = new Set(['coordinatewidth', 'coordinatepadding', 'coordinateheights',
  'coordinatepaddingfix',
  'style', 'stylehorizontal', 'stylewraplimit', 'stylemultiplier', 'randomstylerange',
  'drawstepdown', 'drawxoffset', 'drawfliphorizontal', 'allowalwaysonscreen', 'wraps',
  'hookpostplacemyplayer', 'drawframeoffsets', 'linkedalternates',
  'stylewraplimitvisualoverride', 'stylelineskipvisualoverride']);
const LIQ_VAL_MAP = { Allowed: 'allowed', NotAllowed: 'notAllowed', OnlyInFullLiquid: 'onlyInFull', OnlyInLiquid: 'onlyInLiquid' };
function parseLiqVal(rhs) {
  const m = rhs.match(/LiquidPlacement\.(\w+)/);
  return m ? (LIQ_VAL_MAP[m[1]] ?? null) : null;
}
/** Calculate() 提交耦合（TileObjectData.cs:1820-1833）：WaterDeath/LavaDeath=true ⇒
 *  对应维 placement 强制 NotAllowed（setter 走 COW，只影响提交对象）。 */
function applyLiquidDeathCoupling(rec) {
  if (rec.waterDeath) rec.liq.water = 'notAllowed';
  if (rec.lavaDeath) rec.liq.lava = 'notAllowed';
}

function mkWork() {
  return {
    w: 0, h: 0, ox: 0, oy: 0,
    anchorTop: null, anchorBottom: null, anchorLeft: null, anchorRight: null,
    wall: false, uccp: false,
    liq: { ...LIQ_DEFAULTS }, waterDeath: false, lavaDeath: false,
    flatten: false, dir: '', yOff: 0,
    // ★C14-F3：AnchorValidTiles/AnchorInvalidTiles（isValidTileAnchor 成员表）
    vTiles: undefined, ivTiles: undefined,
    // ★C14-F2：样式/坐标模块面（Place :60-108 备档帧带数学;ctor 缺省
    //   TileObjectData.cs:1662-1679 区 StyleHorizontal=false/WrapLimit=0/Multiplier=1
    //   LineSkip=1,CoordinateWidth=0/Padding=0/Heights={16}）
    sh: false, swl: 0, sls: 1, sm: 1, cw: 0, cp: 0, hts: [16],
    // ★BJ753 TF-07：CoordinatePaddingFix（:1571-1600 Point16,SetupBaseObject :1790
    //   缺省 Zero）——Calculate :1808-1820 styleWidth=(cw+cp)*W+fix.X/
    //   styleHeight=Σ(h+cp)+fix.Y。1457 全表仅 3 处：79 床(0,-2) :2609/
    //   15 椅(0,2) :4147/497 马桶(0,2) :4180（备档脸按各自快照承值）。
    pfx: 0, pfy: 0,
    // 转义：AnchorData 第二参为 newTile.Width 表达式时需在快照期以最终 W 具象化
  };
}
/** addTile/addBaseTile 提交后的 newTile 复位（TileObjectData.cs:2005/:2013
 *  `newTile = new TileObjectData(_baseObject)`）——几何字段沿用本提取器"家族头净化"
 *  约定不在此复位（靠 CopyFrom(Style*)/Width 头重建），液体两维按原版语义复位。 */
function resetLiquid(w) {
  w.liq = { ...LIQ_DEFAULTS };
  w.waterDeath = false; w.lavaDeath = false;
}
let work = mkWork();
// ---- M-3b 子样式工作面：newSubTile 液体态（缺省 = new TileObjectData(_baseObject)
//      继承 SetupBaseObject :1767-1768 两维缺省）+ 已提交 per-style 记录 + int 局部变量
//      （addSubTileRange(num,num) / addSubTile(1+newTile.StyleWrapLimit) 求值所需）。 ----
// ★BJ602：子样式全脸建模（原版 newSubTile = new TileObjectData(_baseObject) 独立
//  记录面,GetTileData :5127-5162 SubTiles[style] 整记录替换非合并）。缺省=基对象终态
//  （1×1 无锚+uccp false+液体缺省）。subPoisoned=子样式脸未建模字段命中 → 该 style
//  记录不提交（GetTileData 回落基记录=fail-safe,与基记录 poison 只 warn 不同）。
function mkSubFace() {
  return {
    w: 1, h: 1, ox: 0, oy: 0,
    anchorTop: null, anchorBottom: null, anchorLeft: null, anchorRight: null,
    wall: false, uccp: false, altTiles: undefined,
    vTiles: undefined, ivTiles: undefined,
    sh: false, swl: 0, sls: 1, sm: 1, cw: 0, cp: 0, hts: [16],
    pfx: 0, pfy: 0,                       // ★BJ753 TF-07（同 mkWork 注）
    liq: { ...LIQ_DEFAULTS }, waterDeath: false, lavaDeath: false,
    flatten: false, dir: '', yOff: 0,
  };
}
function fullSubFace(src) {
  const c = structuredClone(src);
  return Object.assign(mkSubFace(), c);
}
let subWork = mkSubFace();
let subPoisoned = false;
let pendingSubTiles = new Map();    // style → 子样式全脸（subPoisoned 未命中才提交）
let pendingSubLiq = new Map();      // style → liq（addSubTile 提交,death 耦合已应用）
const intLocals = new Map();        // `int num = 39;` 局部变量（:4230/:4417）
const arrLocals = new Map();        // ★C14-F3：`int[] x = new int[N]{...};` 数组局部

let styleWrapLimit = 0;             // newTile.StyleWrapLimit（addSubTile 表达式求值所需,不入库）
const bases = new Map();
const manifest = {};
let pendingAlts = [];
let lastAltDir = '';
// ★C14-F2：newAlternate 工作面（TileObjectData.cs:2098-2108 addAlternate 语义——
//  CopyFrom 快照 → 属性写入 → addAlternate(baseStyle) 提交并复位为 _baseObject 终态）
let altWork = null;
let altPoisoned = false;
let altCopied = false;          // 本备档是否已显式 CopyFrom（防无源提交）
let pendingAltFaces = [];       // 已提交备档 [{face, sb}]
// ★BJ753 TF-05：当前 newTile 的备档是否来自 CopyFrom/FullCopyFrom 继承（未 COW 另立）
// ——vanilla addAlternate :2100-2102 对 !_hasOwnAlternates 面先置新空表再追加=弃继承。
let altInherited = false;
const pendingAudit = [];
function mkAltWork() {
  // `new TileObjectData(_baseObject)`：1×1 无锚 + 模块缺省（同 mkSubFace 基础面）
  return mkSubFace();
}
function curIdGuess(rec){ return rec._lastId ?? -1; }
let poisoned = null;         // {tile,into} 复杂构造污染标记（当前对象不可信）
let copiedThisBlock = false;  // ★BJ602：本 addTile 块内是否已 CopyFrom/FullCopyFrom 显式重立状态

const deep = (w) => structuredClone(w);

// ---- M-3b 子样式液体辅助 ----
/** addSubTile 提交耦合（newSubTile.Calculate() :2018/:2046/:2075 → :1821-1831）：
 *  子样式 WaterDeath/LavaDeath=true ⇒ 对应维 placement 强制 NotAllowed。 */
function subCoupled() {
  const out = { ...subWork.liq };
  if (subWork.waterDeath) out.water = 'notAllowed';
  if (subWork.lavaDeath) out.lava = 'notAllowed';
  return out;
}
/** addSubTile 样式表达式求值：整数字面 / `int num` 局部变量 / newTile.StyleWrapLimit
 *  （:3344 `1 + newTile.StyleWrapLimit`、:4239 `addSubTileRange(num, num)`）。
 *  styleWrapLimit 用独立变量（不入 work/记录；:3323 同块先赋值后用,无 CopyFrom 传递需求）。 */
function evalTodExpr(raw) {
  let s = raw.trim().replace(/newTile\.StyleWrapLimit/g, `(${styleWrapLimit})`);
  // ★整词替换（num2 含 num 前缀,裸 split/join 会把 num2 吃成 (39)2 → 求值 NaN）
  for (const [k, v] of [...intLocals].sort((a, b) => b[0].length - a[0].length)) {
    s = s.replace(new RegExp(`\\b${k}\\b`, 'g'), `(${v})`);
  }
  if (!/^[\d\s()+\-*/]+$/.test(s)) return NaN;
  try { return Function(`"use strict";return (${s})`)(); } catch { return NaN; }
}
function resetSubWork() {
  // addSubTile/addSubTileRange 尾 `newSubTile = new TileObjectData(_baseObject)`（:2041/:2070/:2095）
  subWork = mkSubFace();
  subPoisoned = false;
}
/** 子样式脸表达式解析（W/H/Hminus1 标记按子脸自身 W/H 具象化,TileObject.Commit 语义） */
function resolveSubExprs(f) {
  for (const a of [f.anchorTop, f.anchorBottom, f.anchorLeft, f.anchorRight]) {
    if (!a) continue;
    if (a.cnt === 'W') a.cnt = f.w;
    else if (a.cnt === 'H') a.cnt = f.h;
    if (a.start === 'Hminus1') a.start = Math.max(0, f.h - 1);
  }
}
/** 子样式记录 vs 基记录发散判定（建模域任一发散即整记录入库=GetTileData 整记录替换） */
const SUB_CMP_FIELDS = ['w', 'h', 'ox', 'oy', 'anchorTop', 'anchorBottom', 'anchorLeft', 'anchorRight',
  'wall', 'flatten', 'dir', 'yOff', 'altTiles', 'uccp', 'vTiles', 'ivTiles'];
function subDiverges(f, base) {
  return SUB_CMP_FIELDS.some((k) => JSON.stringify(f[k] ?? null) !== JSON.stringify(base[k] ?? null));
}

function parseAnchor(rhs) {
  // new AnchorData(AnchorType.A | AnchorType.B, <expr>, <expr>)
  // 注意：rhs 由属性分支切出时【不含】结尾分号
  const m = rhs.match(/new\s+AnchorData\s*\(([^]*?)\)\s*;?\s*$/);
  if (!m) return null;
  const parts = m[1].split(',');
  if (parts.length < 1) return null;
  const types = parts[0].split('|').map((s) => s.trim().replace(/^AnchorType\./, '')).filter(Boolean);
  const cntRaw = (parts[1] ?? '').trim();
  const startRaw = (parts[2] ?? '').trim();
  const cnt = /^\d+$/.test(cntRaw) ? parseInt(cntRaw)
    : /^newTile\.Width$/i.test(cntRaw) ? 'W'
    : /^newTile\.Height$/i.test(cntRaw) ? 'H' : NaN;
  const start = /^\d+$/.test(startRaw) ? parseInt(startRaw)
    : /^newTile\.Height/i.test(startRaw) ? 'Hminus1' : 0;   // 第三参字面即 checkStart;Height 表达式少见按0处理,poison标记交上层
  if (Number.isNaN(cnt)) return null;
  return { t: types.filter((s) => s !== 'None'), cnt, start };
}

let stats = { total: 0, parsed: 0, unparsed: [], warned: [] };

for (let ln = 0; ln < lines.length; ln++) {
  let L = lines[ln].trim();
  if (!L || L.startsWith('//')) continue;

  // ★C14-F3：多行数组初值器并线（`xxx.AnchorValidTiles = new int[N]` 后换行
  //  `{ a, b, ... };`——590 宝石苗 15 石表 TileObjectData.cs:4919-4923 首例;
  //  旧逐行解析对无分号首行不匹配属性分支=静默丢弃整表）
  if (/^(newTile|newSubTile|newAlternate)\.\w+\s*=.*\bnew int\s*\[[^\]]*\]\s*$/.test(L)
    || /^int\[\] \w+ = new int\[[^\]]*\]\s*$/.test(L)) {
    let j = ln;
    while (j + 1 < lines.length && !/\}/.test(lines[j + 1])) j++;
    j++;   // 收至含 '}' 的收尾行
    L = (L + ' ' + lines.slice(ln + 1, j + 1).map((s) => s.trim()).join(' ')).trim();
    ln = j;   // 已消费至 j;for-update 推进到 j+1
  }

  // ---- 控制动词 ----
  let m;
  // ---- ★M-3c：Initialize 头部 newTile 重装为 _baseObject 终态（1×1 无锚,见上方注）----
  if (ln < firstAddTileCallAt && /^newTile = new TileObjectData\(_baseObject\);\s*$/.test(L)) {
    work = mkWork();
    work.w = 1; work.h = 1;           // Width=1/Height=1（SetupBaseObject :1779-1780）
    work.ox = 0; work.oy = 0;         // Origin = Point16.Zero（:1781）
    continue;
  }
  if ((m = L.match(/^newTile\.CopyFrom\((\w+)\)\s*;/))) {
    const nm = m[1];
    const ent = bases.has(nm) ? bases.get(nm) : null;
    if (!ent) { console.error(`[warn] CopyFrom 未知名 ${nm} @${ln + 1}`); }
    work = deep(ent ? ent.face : mkWork());
    copiedThisBlock = true;   // ★BJ602：显式重立 → 后续 Width 不得净化继承锚
    // ★BJ753 TF-05：CopyFrom 继承模板备档（TileObjectData.cs:1697-1715
    //   `_alternates = copy._alternates` 模块引用共享——浴缸 90/床 79 经
    //   CopyFrom(Style4x2)（:2569/:2607）承其 PlaceRight 备档 sb=1（:2566-2567）。
    //   后续 addAlternate 的 COW 弃置（:2100-2102 `!_hasOwnAlternates → 新空表`）
    //   由 altInherited 旗建模——继承后首笔 addAlternate 先清表再追加,源模板不受扰。
    pendingAltFaces = ent ? ent.alts.map((a) => deep(a)) : [];
    altInherited = pendingAltFaces.length > 0;
    continue;
  }
  if ((m = L.match(/^addBaseTile\(out (\w+)\)\s*;/))) {
    // addBaseTile（TileObjectData.cs:2001-2008）：newTile.Calculate() 先跑（death 耦合
    //   落进快照，StyleAlch 等 LavaDeath=true 的基样式快照 lava=notAllowed），再存快照、
    //   newTile 复位缺省。Style* 快照含 liq/death，后续 CopyFrom(Style*) 继承。
    // ★BJ753 TF-05（2026-11-02）：`baseTile = newTile` 是【引用】携 Alternates（:2006
    //   快照即模板工作面对象本体——addAlternate 已把备档挂在其 Alternates 列表上）;
    //   复位后的新 newTile 备档为空。旧提取器快照只存几何/锚面,pendingAltFaces 未随
    //   快照入册 → CopyFrom(Style4x2) 的床 79（:2607）丢失 PlaceRight 备档 = issue#39
    //   TF-05「所有床朝右放置失败」根因（浴缸 90 此前靠泄漏碰巧正确——pendingAltFaces
    //   未清,恰好漏给紧随其后的 addTile(90)）。修=备档随快照入册 + 显式清空（防漏给
    //   无关后续 addTile）。
    const snap = deep(work);
    applyLiquidDeathCoupling(snap);
    delete snap.waterDeath; delete snap.lavaDeath;
    bases.set(m[1], { face: snap, alts: pendingAltFaces.map((a) => deep(a)) });
    pendingAltFaces = [];                // 备档已入快照（=vanilla 复位 newTile 空 Alternates）
    altInherited = false;
    copiedThisBlock = false;
    pendingSubTiles = new Map();
    resetLiquid(work);
    work.yOff = 0;                       // ★SW-FX26：基样式快照后同复位（:2008/:1793）——
                                         //   块内显式 DrawYOffset 已随 snap 落库,残留=上游块污染
    continue;
  }
  if ((m = L.match(/^(?:newTile|Style\w+)\.(?:CopyFrom\(.*?\)|ResetToTile\(\))\s*;/)) && !/^newTile\.CopyFrom/.test(L)) {
    // 非标准 CopyFrom 变体：污染处理同未知
  }
  if ((m = L.match(/^addTile\((-?\d+)\)\s*;/))) {
    const id = parseInt(m[1]);
    stats.total++;
    if (id <= 0) {                       // addTile(-1) 清工作面语义等价 newTile 复位
      copiedThisBlock = false;
      pendingSubTiles = new Map();
      pendingAltFaces = [];              // ★C14-F2：备档归属 newTile,一并复位
      altInherited = false;              // ★BJ753
      altWork = mkAltWork(); altPoisoned = false; altCopied = false;
      resetLiquid(work);
      work.yOff = 0;                     // ★SW-FX26：复位同含 DrawYOffset（:1793 SetupBaseObject）
      continue;
    }
    if (work.w > 0 && work.h > 0) {
      const rec = deep(work);
      resolveExprs(rec);
      applyLiquidDeathCoupling(rec);     // Calculate() :1820-1833 提交耦合
      delete rec.waterDeath; delete rec.lavaDeath;   // death 旗不入库（瞬时量）
      if (pendingAlts.length) rec.dirs = pendingAlts.slice();
      // ★C14-F2：备档全记录（Alternates）+ 样式/坐标模块面 sty——仅携带备档的记录
      // 入库（sty=Place :60-108 帧带数学面;备档面发散时自带 sty,否则继承基记录）。
      // ★BJ753 TF-07：sty 增 pfx/pfy（CoordinatePaddingFix,Calculate :1808-1820 的
      //   FullWidth/FullHeight 尾加项）——非零才入库（1457 全表仅 79/15/497 三记录,
      //   其余 sty 逐字节稳定,防金标无谓漂移）。
      const styleDiverges = (a, b) => a.sh !== b.sh || a.swl !== b.swl || a.sls !== b.sls
        || a.sm !== b.sm || a.cw !== b.cw || a.cp !== b.cp
        || (a.pfx ?? 0) !== (b.pfx ?? 0) || (a.pfy ?? 0) !== (b.pfy ?? 0)
        || JSON.stringify(a.hts ?? null) !== JSON.stringify(b.hts ?? null);
      const styOf = (o) => {
        const s = { sh: o.sh, swl: o.swl, sls: o.sls, sm: o.sm, cw: o.cw, cp: o.cp, hts: o.hts };
        if (o.pfx) s.pfx = o.pfx;
        if (o.pfy) s.pfy = o.pfy;
        return s;
      };
      const stripStyle = (o) => { for (const k of ['sh', 'swl', 'sls', 'sm', 'cw', 'cp', 'pfx', 'pfy', 'hts']) delete o[k]; };
      if (pendingAltFaces.length) {
        rec.alts = pendingAltFaces.map(({ face, sb }) => {
          const a = deep(face);
          if (styleDiverges(a, rec)) a.sty = styOf(a);
          stripStyle(a);
          return Object.assign(a, { sb });
        });
        rec.sty = styOf(rec);
      }
      // M-3b：per-style 液体记录——只存与基记录【发散】的样式（GetTileData :5142-5150
      // 对 SubTiles[style]==null/越界回落基记录,发散过滤恰好等价;同值条目省略）
      const liqStyles = {};
      for (const [st, lq] of pendingSubLiq) {
        if (lq.water !== rec.liq.water || lq.lava !== rec.liq.lava) liqStyles[String(st)] = lq;
      }
      if (Object.keys(liqStyles).length) rec.liqStyles = liqStyles;
      // ★BJ602：子样式全记录——发散过滤（vs 提交后的基记录;GetTileData 回落语义等价）
      const subs = {};
      for (const [st, face] of pendingSubTiles) {
        const f = deep(face);
        resolveSubExprs(f);
        if (subDiverges(f, rec)) {
          if (styleDiverges(f, rec)) f.sty = styOf(f);
          stripStyle(f);
          subs[String(st)] = f;
        }
      }
      if (Object.keys(subs).length) rec.subTiles = subs;
      stripStyle(rec);                   // ★C14-F2：样式/坐标工作面只经 sty 出库
      manifest[id] = rec;
      stats.parsed++;
      if (poisoned) { stats.warned.push(id); }
    } else {
      // 缺维度声明 = 无法表驱动 → 显式回落
      manifest[id] = null;
      stats.unparsed.push(id);
    }
    pendingAlts = [];
    pendingAltFaces = [];                // ★C14-F2：备档归属 newTile,addTile 一并复位
    altInherited = false;                // ★BJ753
    altWork = mkAltWork(); altPoisoned = false; altCopied = false;
    // ★C14-F3：成员表随 addTile 全量复位（原版 addTile 尾 `newTile = new
    //  TileObjectData(_baseObject)` → AnchorValidTiles/InvalidTiles=null :1757-1758;
    //  家族头几何继承约定不覆盖成员表——无复位则 470 的 ivTiles 跨块泄漏至 3/24/61）
    work.vTiles = undefined; work.ivTiles = undefined;
    poisoned = null;
    pendingSubLiq = new Map();           // 子样式归属 newTile,addTile 一并复位
    pendingSubTiles = new Map();
    copiedThisBlock = false;
    resetSubWork();
    styleWrapLimit = 0;                  // 原版 newTile=new(_baseObject) 复位 StyleWrapLimit
    resetLiquid(work);                   // 原版 addTile 尾 newTile = new(_baseObject)（:2013）
    work.yOff = 0;                       // ★SW-FX26（2026-09-10）：复位同含 DrawYOffset=0——
                                         //   原版 addTile 尾 newTile=new(_baseObject)（:2005/:2013）
                                         //   且 SetupBaseObject 缺省 `DrawYOffset = 0`（:1793）。
                                         //   此前只复位液体两维，yOff 跨 addTile 残留（家族头
                                         //   净化约定只豁免几何字段）→ 454 块 `DrawYOffset=-2`
                                         //   （cs:3166）携带污染 Style3x2 基样式快照（cs:3168-3185
                                         //   未写 yOff）→ 14/17/77 等 CopyFrom(Style3x2) 族全错 -2。
    continue;
  }
  if ((m = L.match(/^addAlternate\((-?\d+)\)\s*;/))) {
    // ★BJ753：COW 弃置（TileObjectData.cs:2100-2102 `if (!newTile._hasOwnAlternates)
    //   newTile.Alternates = new List<>()`——CopyFrom 继承的模板备档整体让位于新空表,
    //   源模板列表不受扰;首笔后 _hasOwnAlternates=true,后续 addAlternate 追加同表）。
    if (altInherited) { pendingAltFaces = []; altInherited = false; }
    pendingAlts.push({ dir: lastAltDir });
    lastAltDir = '';
    // ★C14-F2：备档整记录提交（TileObjectData.cs:2098-2108）——Calculate() 耦合 +
    //  Style=baseStyle（帧带基偏移 sb）+ 入 Alternates + 复位 new(_baseObject)。
    //  无 CopyFrom 源 / 毒化 → 不提交（=旧版「无备档」同相,fail-safe）。
    if (altWork && altCopied && !altPoisoned) {
      const face = deep(altWork);
      applyLiquidDeathCoupling(face);
      delete face.waterDeath; delete face.lavaDeath;
      resolveExprs(face);
      pendingAltFaces.push({ face, sb: parseInt(m[1], 10) });
    } else {
      stats.altSkips = (stats.altSkips ?? 0) + 1;
      if (altCopied && altPoisoned) stats.altPoisonSkips = (stats.altPoisonSkips ?? 0) + 1;
    }
    altWork = mkAltWork(); altPoisoned = false; altCopied = false;
    continue;
  }

  // ---- FullCopyFrom（TileObjectData.cs:1717-1741）：整表拷贝已提交 tile（模块引用共享）。
  //      1457 三处调用：388→389（门右开）、82→83→84（药草）。液体两维 + per-style 液体
  //      记录（:1738 `_subTiles = new TileObjectSubTilesModule(copy._subTiles)` 整表拷贝）
  //      需要显式搬运（几何字段本就沿 work 继承等价）。 ----
  if ((m = L.match(/^newTile\.FullCopyFrom\((\d+)\)\s*;/))) {
    const srcRec = manifest[m[1]];
    copiedThisBlock = true;   // ★BJ602：FullCopyFrom 整表拷贝=显式重立
    if (srcRec?.liq) {
      work.liq = structuredClone(srcRec.liq);
      work.altTiles = srcRec.altTiles ? structuredClone(srcRec.altTiles) : undefined;
      work.uccp = !!srcRec.uccp;
      // ★C14-F3：FullCopyFrom 整表拷贝含成员表（TileObjectData.cs:1717-1741 全模块
      //  拷贝——83/84 承 82 的 AnchorValidTiles {2,477,109,492}）
      work.vTiles = srcRec.vTiles ? structuredClone(srcRec.vTiles) : undefined;
      work.ivTiles = srcRec.ivTiles ? structuredClone(srcRec.ivTiles) : undefined;
      pendingSubLiq = new Map();
      for (const [st, lq] of Object.entries(srcRec.liqStyles ?? {})) pendingSubLiq.set(Number(st), structuredClone(lq));
      pendingSubTiles = new Map();
      for (const [st, f] of Object.entries(srcRec.subTiles ?? {})) pendingSubTiles.set(Number(st), structuredClone(f));
      // ★BJ753 TF-05 登记债（不落刀）：FullCopyFrom 亦承备档（:1723 `_alternates =
      //  copy._alternates`）,但 1457 现网三站 388→389/82→83→84 中唯 388 有备档——
      //  其备档面来自【未建模 for 循环】（:2317-2334 `for k/l 1..4` 共 8 档 Origin
      //  (0,k) 循环备档,行式提取只单跑一轮且局部量 k/l 未解析→oy 残字符串）,
      //  389（开态高门）无物品放置面=零消费。继承只会传播该半垃圾面——待循环
      //  备档提取建模后随刀补承（BJ753 债 D-1）。
    } else { poisoned = true; }
    continue;
  }
  // ---- 子样式区：newSubTile.CopyFrom(newTile/newSubTile/StyleX) —— 子样式经模块引用
  //      共享继承源液体态（TileObjectData.cs:1698-1715 CopyFrom 语义；_hasOwn* 旗不随
  //      CopyFrom 拷贝,后续覆写必 COW 只落子样式模块）；基样式记录不受子样式覆写影响
  //      → 基样式值仍按 newTile 自身赋值面提取。 ----
  if ((m = L.match(/^newSubTile\.CopyFrom\((newTile|newSubTile|newAlternate|Style\w+)\)\s*;/))) {
    stats.subCopyFrom = (stats.subCopyFrom ?? 0) + 1;
    const src = m[1] === 'newTile' ? work
      : m[1] === 'newSubTile' ? subWork
      : m[1] === 'newAlternate' ? null      // newAlternate 脸未建模（dirs 锚覆盖缺失）→ 子脸不可信
      : bases.get(m[1])?.face;               // ★BJ753：bases 条目改 {face, alts} 复合
    if (src) { subWork = fullSubFace(src); subPoisoned = false; }
    else subPoisoned = true;
    continue;
  }
  // ---- M-3b：addSubTile/addSubTileRange（TileObjectData.cs:2016-2096）——当前 newSubTile
  //      经 Calculate()（death 耦合）提交到指定 style 槽（=SubTiles 列表下标）后复位。
  //      params 展开逐 style 提交同一快照;addSubTileRange 按 startStyle+i 递增。 ----
  if ((m = L.match(/^addSubTileRange\(([^,]+),\s*([^)]+)\)\s*;/))) {
    const start = evalTodExpr(m[1]), cnt = evalTodExpr(m[2]);
    if (Number.isFinite(start) && Number.isFinite(cnt)) {
      const snap = subCoupled();
      for (let i = 0; i < cnt; i++) pendingSubLiq.set(start + i, { ...snap });
      if (!subPoisoned) {
        const face = deep(subWork);
        applyLiquidDeathCoupling(face);
        delete face.waterDeath; delete face.lavaDeath;
        for (let i = 0; i < cnt; i++) pendingSubTiles.set(start + i, face);
      } else { stats.subPoisonSkips = (stats.subPoisonSkips ?? 0) + cnt; }
    } else { console.error(`[warn] addSubTileRange 样式表达式不可求值 @${ln + 1}`); }
    resetSubWork();
    continue;
  }
  if ((m = L.match(/^addSubTile\(([^)]*)\)\s*;/))) {
    const snap = subCoupled();
    let face = null;
    if (!subPoisoned) {
      face = deep(subWork);
      applyLiquidDeathCoupling(face);
      delete face.waterDeath; delete face.lavaDeath;
    }
    for (const rawSt of m[1].split(',')) {
      const st = evalTodExpr(rawSt);
      if (!Number.isFinite(st)) { console.error(`[warn] addSubTile 样式表达式不可求值 @${ln + 1}: ${m[1]}`); continue; }
      pendingSubLiq.set(st, { ...snap });
      if (face) pendingSubTiles.set(st, face);
      else stats.subPoisonSkips = (stats.subPoisonSkips ?? 0) + 1;
    }
    resetSubWork();
    continue;
  }
  // ---- M-3b：`int num = 39;` 局部变量（:4230/:4417，addSubTileRange 参数求值所需）----
  if ((m = L.match(/^int (\w+) = (.+?);\s*$/))) { intLocals.set(m[1], evalTodExpr(m[2])); continue; }
  // ★C14-F3：int[] 数组局部（Initialize 头 anchorInvalidTiles :2113-2116 = 11 表——
  //  470/88/475/21/467/441/468 的 AnchorInvalidTiles 成员表源）
  if ((m = L.match(/^int\[\] (\w+) = new int\[[^\]]*\]\{([^}]*)\};\s*$/))
    || (m = L.match(/^int\[\] (\w+) = new int\[[^\]]*\]\s*\{([^}]*)\};\s*$/))) {
    arrLocals.set(m[1], m[2].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite));
    continue;
  }


  // ---- ★BJ602：子样式几何字段应用（与 newTile 同式解析,写 subWork 脸）----
  function applySubProp(lp, rhs) {
    switch (lp) {
      case 'width': subWork.w = parseInt(rhs) || 0; break;
      case 'height': subWork.h = parseInt(rhs) || 0; break;
      case 'origin': {
        const p2 = rhs.match(/new\s+Point16\((-?\w+),\s*(-?\w+)\)/);
        if (p2) { subWork.ox = valOrExpr(p2[1]); subWork.oy = valOrExpr(p2[2]); }
        else subPoisoned = true;
        break;
      }
      case 'anchorbottom': case 'anchortop': case 'anchorleft': case 'anchorright': {
        const key2 = { anchorbottom: 'anchorBottom', anchortop: 'anchorTop', anchorleft: 'anchorLeft', anchorright: 'anchorRight' }[lp];
        if (/^null/.test(rhs) || /^AnchorData\.Empty\s*$/.test(rhs) || /^default\s*\(\s*AnchorData\s*\)\s*$/.test(rhs)) { subWork[key2] = null; break; }
        const a2 = parseAnchor(rhs + ';');
        if (!a2) subPoisoned = true; else subWork[key2] = a2;
        break;
      }
      case 'anchorwall': subWork.wall = /true/i.test(rhs); break;
      case 'flattenanchors': subWork.flatten = /true/i.test(rhs); break;
      case 'direction': subWork.dir = rhs.replace(/^TileObjectDirection\./, '').trim(); break;
      case 'drawyoffset': subWork.yOff = parseInt(rhs) || 0; break;
      case 'usescustomcanplace': subWork.uccp = /true/i.test(rhs); break;
      // ★C14-F3：子样式成员表门维度
      case 'anchorvalidtiles': case 'anchorinvalidtiles': {
        const mk = rhs.match(/new int\s*\[[^\]]*\]\s*\{([^}]*)\}/);
        if (mk) {
          const arr = mk[1].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
          if (lp === 'anchorvalidtiles') subWork.vTiles = arr; else subWork.ivTiles = arr;
        } else if (/^null/.test(rhs)) {
          if (lp === 'anchorvalidtiles') subWork.vTiles = undefined; else subWork.ivTiles = undefined;
        } else subPoisoned = true;
        break;
      }
      case 'anchoralternatetiles': {
        const mt2 = rhs.match(/new int\s*\[[^\]]*\]\s*\{([^}]*)\}/);
        if (mt2) subWork.altTiles = mt2[1].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
        else if (/^null/.test(rhs)) subWork.altTiles = undefined;
        else subPoisoned = true;
        break;
      }
      default: subPoisoned = true;
    }
  }
  // ---- 属性赋值（newTile. / newSubTile. 双前缀；newAlternate.* 无液体赋值（grep 全文件
  //      证实），仍走后置毒分支）----
  if ((m = L.match(/^(newTile|newSubTile)\.(\w+)\s*=\s*(.+);\s*$/))) {
    const [, prefix, prop, raw] = m;
    if (prefix === 'newSubTile') {
      // 子样式写入永不落基样式记录（原版子样式对象独立于 newTile；CopyFrom 共享引用
      // 后的覆写经 setter COW 只落在子样式模块上——见 TileObjectData.cs:574-640 setter）。
      // 液体四属性 = M-3b 解析目标：写入 subWork 工作面（addSubTile 提交时成 per-style
      // 记录）；其余属性维持旧行为置毒（审计信号：该族含未建模子样式几何，
      // AnchorValidWalls/Height 等只在子样式生效）。
      const lp = prop.toLowerCase();
      if (lp === 'waterplacement' || lp === 'lavaplacement') {
        stats.subLiqWrites = (stats.subLiqWrites ?? 0) + 1;
        const v = parseLiqVal(raw.trim());
        if (!v) { subPoisoned = true; break; }
        if (lp === 'waterplacement') subWork.liq.water = v;
        else subWork.liq.lava = v;
      } else if (lp === 'waterdeath' || lp === 'lavadeath') {
        stats.subLiqWrites = (stats.subLiqWrites ?? 0) + 1;
        if (lp === 'waterdeath') subWork.waterDeath = /true/i.test(raw);
        else subWork.lavaDeath = /true/i.test(raw);
      } else if (SUB_GEOM_PROPS.has(lp)) {
        // ★BJ602：子样式几何/锚/路由字段建模（写 subWork 脸,addSubTile 提交）
        applySubProp(lp, raw.trim());
      } else if (SUB_NEUTRAL_PROPS.has(lp)) {
        // 白名单中性项（不建模不污染）
      } else {
        subPoisoned = true;   // 未建模字段 → 子脸不可信,该 style 回落基记录（fail-safe）
      }
      continue;
    }
    const rhs = raw.trim();
    switch (prop.toLowerCase()) {
      case 'width': {
        // ★家族头净化：C# 共享静态工作面存在跨定义泄漏（AnchorTop 等未被后族
        //   重声明即沿用），顺序模拟无法可靠复现其原始初始化序——对【锚点语义】
        //   取保守零值起点，靠各家族自身的显式赋值重建。几何/绘制字段保持继承
        //   （CoordinateWidth/padding/YOffset 延用安全）。prevHadAnchors 未被本头
        //   后续显式补写的对象记入审计表人工核对。
        const prev = deep(work);
        const hadAnchors = !!(prev.anchorTop ?? prev.anchorBottom ?? prev.anchorLeft ?? prev.anchorRight) || prev.wall;
        // ★BJ602（2026-10-10）：净化门=本块【无 CopyFrom】才生效——家族头继承泄漏
        //  （前族锚残留）须在首个 Width 处清零；但 CopyFrom(Style*) 后的 Width 调整
        //  （如 241=CopyFrom(Style3x3Wall)+Width4）继承的是【显式重立】的合法锚/
        //  AnchorWall（TileObjectData.cs:4794 Style3x3Wall AnchorWall=true → 241/242/
        //  245/246 同承），旧无条件净化=继承面丢失（wall 恒 false 提取缺口）。
        if (!copiedThisBlock) {
          work.anchorTop = null; work.anchorBottom = null;
          work.anchorLeft = null; work.anchorRight = null;
          work.wall = false; work.flatten = false;
          work.dir = ''; lastAltDir = ''; pendingAlts = [];
          work.altTiles = undefined;
          work.vTiles = undefined; work.ivTiles = undefined;   // ★C14-F3：成员表随锚净化
          // ★C14-F2：样式/坐标模块随净化门复位（ctor 缺省,TileObjectStyleModule.cs
          //  :23-29 / TileObjectCoordinatesModule——C# addTile 全量复位
          //  `newTile = new TileObjectData(_baseObject)`,本提取器几何沿家族头净化
          //  约定,样式面若不随门复位会跨块泄漏:Style2x2 快照曾染上前块
          //  swl=2/sm=2 → 备档帧带全错）
          work.sh = false; work.swl = 0; work.sls = 1; work.sm = 1;
          work.cw = 0; work.cp = 0; work.hts = [16];
          work.pfx = 0; work.pfy = 0;         // ★BJ753 TF-07：PaddingFix 同随净化门复位
          if (hadAnchors && !Object.isFrozen(prev)) {
            // 记录待审计：后续若至下一 addTile 无任何 anchor 写回则可能继承语义丢失
            pendingAudit.push({ idHint: +curIdGuess(prev), types: 'head-reset', kept: false });
          }
        }
        work.w = parseInt(rhs) || 0;
        break;
      }
      case 'height': work.h = parseInt(rhs) || 0; break;
      case 'origin': {
        const p = rhs.match(/new\s+Point16\((-?\w+),\s*(-?\w+)\)/);
        if (p) { work.ox = valOrExpr(p[1]); work.oy = valOrExpr(p[2]); }
        else { poisoned = true; }
        break;
      }
      case 'anchorbottom':
      case 'anchortop':
      case 'anchorleft':
      case 'anchorright': {
        const key = { anchorbottom: 'anchorBottom', anchortop: 'anchorTop', anchorleft: 'anchorLeft', anchorright: 'anchorRight' }[prop.toLowerCase()];
        if (/^null/.test(rhs)) { work[key] = null; break; }
        // ★修复（2026-09-02 七件 decor 放置审计）：AnchorData 是 struct
        //   （Terraria.DataStructures/AnchorData.cs:4 `public struct AnchorData`），
        //   `AnchorData.Empty`（AnchorData.cs:9）与 `default(AnchorData)` 均 =
        //   tileCount=0 =「该侧无锚」——CanPlace 对每侧 `if (tileCount != 0)`
        //   整侧跳过（TileObject.cs:377/:445/:550/:636）。此前未识别 → parseAnchor
        //   失败置 poisoned 但 work[key] 保留模板/前值 → 34/95/126/386/531/31/165/
        //   696 等「显式清空底锚的吊挂件」被多加一条底行锚（原版偏差：吊灯/灯笼/
        //   迪斯科球/巨石像在仅有天花板时被本仓拒放）。
        if (/^AnchorData\.Empty\s*$/.test(rhs) || /^default\s*\(\s*AnchorData\s*\)\s*$/.test(rhs)) { work[key] = null; break; }
        const a = parseAnchor(rhs);
        if (!a) poisoned = true; else work[key] = a;
        break;
      }
      case 'anchorwall': work.wall = /true/i.test(rhs); break;
      // ★C14-F3：AnchorValidTiles/AnchorInvalidTiles（:390-429 属性;null 复位同款）
      case 'anchorvalidtiles':
      case 'anchorinvalidtiles': {
        const bare = rhs.match(/^(\w+);?$/);
        const mv = bare && arrLocals.has(bare[1])
          ? [null, arrLocals.get(bare[1]).join(',')]
          : rhs.match(/new int\s*\[[^\]]*\]\s*\{([^}]*)\}/);
        if (mv) {
          const arr = mv[1].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
          if (prop.toLowerCase() === 'anchorvalidtiles') work.vTiles = arr;
          else work.ivTiles = arr;
        } else if (/^null/.test(rhs)) {
          if (prop.toLowerCase() === 'anchorvalidtiles') work.vTiles = undefined;
          else work.ivTiles = undefined;
        } else { poisoned = true; }
        break;
      }
      // ★C14-F2：样式/坐标模块字段（帧带数学;ctor 缺省见 mkWork 注）
      case 'stylehorizontal': work.sh = /true/i.test(rhs); break;
      case 'stylewraplimit': work.swl = parseInt(rhs) || 0; styleWrapLimit = work.swl; break;
      case 'stylelineskip': work.sls = parseInt(rhs) || 1; break;
      case 'stylemultiplier': work.sm = parseInt(rhs) || 1; break;
      case 'coordinatewidth': work.cw = parseInt(rhs) || 0; break;
      case 'coordinatepadding': {
        const pNum = rhs.match(/new\s+Point16\((-?\w+),\s*(-?\w+)\)/);
        work.cp = pNum ? (parseInt(pNum[2], 10) || 0) : (parseInt(rhs) || 0);
        break;
      }
      // ★BJ753 TF-07：CoordinatePaddingFix（:1571-1600 Point16 属性,LinkedAlternates
      //   广写臂 :1599 不在 Initialize 面）——Calculate :1808-1820 全宽/全高尾加项。
      //   1457 三站：79 床 (0,-2) :2609 / 15 椅 (0,2) :4147 / 497 马桶 (0,2) :4180。
      case 'coordinatepaddingfix': {
        const pFix = rhs.match(/new\s+Point16\((-?\d+),\s*(-?\d+)\)/);
        if (pFix) { work.pfx = parseInt(pFix[1], 10) || 0; work.pfy = parseInt(pFix[2], 10) || 0; }
        else if (/^Point16\.Zero\s*$/.test(rhs)) { work.pfx = 0; work.pfy = 0; }
        else poisoned = true;
        break;
      }
      case 'coordinateheights': {
        const mh = rhs.match(/new int\s*\[[^\]]*\]\s*\{([^}]*)\}/);
        work.hts = mh ? mh[1].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite) : [16];
        break;
      }
      case 'anchoralternatetiles': {
        // ★BJ602（2026-10-10）：AnchorAlternateTiles（TileObjectData.cs:434-446 属性/
        // :1969-1984 isValidAlternateAnchor）——AnchorType.AlternateTile 位的成员表,
        // 锚格 active 且 sheet∈表 → 该锚成立（TileObject.cs:419/:509/:611/:697）。
        const mt = rhs.match(/new int\s*\[[^\]]*\]\s*\{([^}]*)\}/);
        if (mt) {
          const arr = mt[1].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
          work.altTiles = arr;
        } else if (/^null/.test(rhs)) { work.altTiles = undefined; }
        else { poisoned = true; }
        break;
      }
      case 'waterplacement':
      case 'lavaplacement': {
        // ★M-3：newTile.WaterPlacement/LavaPlacement 显式赋值（TileObjectData.cs:574-640
        //   属性 setter，COW 写入 _liquidPlacement.water/.lava）。值 = LiquidPlacement
        //   四值枚举（本表仅出现 Allowed/NotAllowed；子样式级 OnlyInFullLiquid 仅 227
        //   style5 一例，newSubTile 前缀已在上方短路为审计计数、不入基记录）。
        const v = parseLiqVal(rhs);
        if (!v) { poisoned = true; break; }
        if (prop.toLowerCase() === 'waterplacement') work.liq.water = v;
        else work.liq.lava = v;
        break;
      }
      case 'waterdeath':
      case 'lavadeath': {
        // LiquidDeathModule.water/lava（TileObjectData.cs:508-547 属性）——提交时经
        // Calculate() 耦合强制对应维 NotAllowed（applyLiquidDeathCoupling）。
        const dv = /true/i.test(rhs);
        if (prop.toLowerCase() === 'waterdeath') work.waterDeath = dv;
        else work.lavaDeath = dv;
        break;
      }
      case 'flattenanchors': work.flatten = /true/i.test(rhs); break;
      case 'direction': work.dir = rhs.replace(/^TileObjectDirection\./, '').trim(); lastAltDir = work.dir; break;
      case 'drawyoffset': work.yOff = parseInt(rhs) || 0; break;
      // 白名单中性项（不建模但合法）：跳过，不污染（waterdeath/lavadeath 已升级为实义解析）
      case 'coordinatewidth': case 'coordinatepadding':
      case 'coordinateheights': case 'stylehorizontal': case 'style':
        break;
      case 'usescustomcanplace':
        // ★BJ602：UsesCustomCanPlace（TileObjectData.cs:145-155 属性,ctor :1679 缺省
        //  false,CopyFrom :1702 继承）——CustomPlace（:5017-5038）的路由维度：
        //  false → 原版 PlaceThing_Tiles_TryPlacing（Player.cs:40085）走 AssortedThings
        //  legacy 而非 TileObject.CanPlace。入库只记 true（缺省=unset 即 false）。
        work.uccp = /true/i.test(rhs);
        break;
      case 'randomstylerange': case 'allowalwaysonscreen': case 'wraps':
        break;
      case 'stylewraplimit':
        // M-3b：样式表达式求值所需（:3344 `1 + newTile.StyleWrapLimit` 等）。
        // 中性样式字段不入库；仅记入独立变量,addTile 尾复位（原版 newTile=new(_baseObject)）。
        styleWrapLimit = parseInt(rhs) || 0;
        break;
      default:
        // HookCheckIfCanPlace / Options / 新 API 全部视为复杂构造 → 该对象回落
        poisoned = true;
        break;
    }
    continue;
  }
  // ---- ★C14-F2 备档描述区：newAlternate.CopyFrom(源) → 属性写入 → addAlternate 提交 ----
  if ((m = L.match(/^newAlternate\.CopyFrom\((newTile|newSubTile|newAlternate|Style\w+)\)\s*;/))) {
    const src = m[1] === 'newTile' ? work
      : m[1] === 'newSubTile' ? subWork
      : m[1] === 'newAlternate' ? null      // 备档拷备档（无此用法,防御性毒化）
      : bases.get(m[1])?.face;               // ★BJ753：bases 条目改 {face, alts} 复合
    if (src) { altWork = deep(src); altPoisoned = false; altCopied = true; }
    else { altWork = null; altPoisoned = true; altCopied = true; }
    continue;
  }
  if (/^newAlternate\.Calculate\(\)\s*;/.test(L)) continue;   // addAlternate 内重跑,中性
  // 其它 newAlternate.* 属性写入（TileObjectData.cs 全表面 :4664-4930 等）——
  // 写入备档工作面;未建模属性 → altPoisoned 该备档不提交（不再毒化基记录——
  // 旧实现把 newAlternate 行当未知毒基记录,基记录数据面本就不受其影响）。
  if ((m = L.match(/^newAlternate\.(\w+)\s*=\s*(.+);\s*$/))) {
    const prop = m[1].toLowerCase();
    const rhs = m[2].trim();
    if (!altWork || !altCopied) { altPoisoned = true; continue; }
    switch (prop) {
      case 'width': altWork.w = parseInt(rhs) || 0; break;
      case 'height': altWork.h = parseInt(rhs) || 0; break;
      case 'origin': {
        if (/^Point16\.Zero\s*$/.test(rhs)) { altWork.ox = 0; altWork.oy = 0; break; }
        const p = rhs.match(/new\s+Point16\((-?\w+),\s*(-?\w+)\)/);
        if (p) { altWork.ox = valOrExpr(p[1]); altWork.oy = valOrExpr(p[2]); }
        else altPoisoned = true;
        break;
      }
      case 'anchorbottom': case 'anchortop': case 'anchorleft': case 'anchorright': {
        const key = { anchorbottom: 'anchorBottom', anchortop: 'anchorTop',
          anchorleft: 'anchorLeft', anchorright: 'anchorRight' }[prop];
        if (/^null/.test(rhs) || /^AnchorData\.Empty\s*$/.test(rhs)
          || /^default\s*\(\s*AnchorData\s*\)\s*$/.test(rhs)) { altWork[key] = null; break; }
        const a = parseAnchor(rhs);
        if (!a) altPoisoned = true; else altWork[key] = a;
        break;
      }
      case 'anchorwall': altWork.wall = /true/i.test(rhs); break;
      case 'flattenanchors': altWork.flatten = /true/i.test(rhs); break;
      case 'direction': altWork.dir = rhs.replace(/^TileObjectDirection\./, '').trim(); break;
      case 'drawyoffset': altWork.yOff = parseInt(rhs) || 0; break;
      case 'anchoralternatetiles': {
        const mt = rhs.match(/new int\s*\[[^\]]*\]\s*\{([^}]*)\}/);
        if (mt) altWork.altTiles = mt[1].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
        else if (/^null/.test(rhs)) altWork.altTiles = undefined;
        else altPoisoned = true;
        break;
      }
      case 'anchorvalidtiles': case 'anchorinvalidtiles': {
        const mv = rhs.match(/new int\s*\[[^\]]*\]\s*\{([^}]*)\}/);
        if (mv) {
          const arr = mv[1].split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite);
          if (prop === 'anchorvalidtiles') altWork.vTiles = arr; else altWork.ivTiles = arr;
        } else if (/^null/.test(rhs)) {
          if (prop === 'anchorvalidtiles') altWork.vTiles = undefined; else altWork.ivTiles = undefined;
        } else altPoisoned = true;
        break;
      }
      // 中性面：Style 会被 addAlternate(baseStyle) 覆写（:2104）;DrawX/StepDown=绘制层
      case 'style': case 'drawxoffset': case 'drawstepdown': case 'stylehorizontal':
        break;
      // ★BJ753 TF-07：备档脸 PaddingFix（:1571-1600 属性本体;1457 Initialize 面
      //   无 newAlternate.CoordinatePaddingFix 直写=防御性建模）
      case 'coordinatepaddingfix': {
        const pFix = rhs.match(/new\s+Point16\((-?\d+),\s*(-?\d+)\)/);
        if (pFix) { altWork.pfx = parseInt(pFix[1], 10) || 0; altWork.pfy = parseInt(pFix[2], 10) || 0; }
        else if (/^Point16\.Zero\s*$/.test(rhs)) { altWork.pfx = 0; altWork.pfy = 0; }
        else altPoisoned = true;
        break;
      }
      default:
        altPoisoned = true;
    }
    continue;
  }
  // 其它 newAlternate 调用形态（罕见）→ 备档毒化（不毒基记录）
  if (/^newAlternate\./.test(L)) { altPoisoned = true; continue; }
  // 其它明显复杂构造：方法调用/条件结构行不匹配以上任何 → 仅在涉及 newTile/newSubTile 时置毒
  // ★BJ602：ApplyNaturalObjectRules（TileObjectData.cs:1847-1851）=UsesCustomCanPlace
  //  =false + UsesGlobalLiquidChecks=true（后者不建模——uccp=false 已整体走 legacy,
  //  CanPlace 不达）。两脸同式：newTile→work.uccp=false;newSubTile→subWork.uccp=false。
  if (/^newTile\.ApplyNaturalObjectRules\(\)\s*;/.test(L)) { work.uccp = false; continue; }
  if (/^newSubTile\.ApplyNaturalObjectRules\(\)\s*;/.test(L)) { subWork.uccp = false; continue; }
  // 其余 newSubTile 方法调用=子脸未建模字段 → subPoisoned（该 style 回落基记录,fail-safe）;
  // 不毒基记录（子脸独立于 newTile 基面）
  if (/^newSubTile\./.test(L)) { subPoisoned = true; continue; }
  if (/^for \([^)]*\)$|^switch|^if\s*\(/.test(L)) { poisoned = poisoned ?? true; continue; }
}

function valOrExpr(t) {
  t = t.trim();
  return /^[+-]?\d+$/.test(t) ? parseInt(t) : t;   // 'W','H','Hminus1' 或变量名,快照期解析
}
function resolveExprs(rec) {
  const refs = [rec.anchorTop, rec.anchorBottom, rec.anchorLeft, rec.anchorRight].filter(Boolean);
  for (const a of refs) {
    if (a.cnt === 'W') a.cnt = rec.w;
    else if (a.cnt === 'H') a.cnt = rec.h;
    if (a.start === 'Hminus1') a.start = Math.max(0, rec.h - 1);
  }
}
// Origin 可能引用宽度表达式（罕见）：保守数字化失败则 poison 对应 obj 在此处二次清洗
for (const [id, r] of Object.entries(manifest)) {
  if (!r) continue;
  if (!Number.isInteger(r.ox)) { r.ox = Math.floor(r.w / 2); stats.warned.push(+id); }
  if (!Number.isInteger(r.oy)) { r.oy = r.h - 1; }
}

mkdirSync('src/data', { recursive: true });
mkdirSync('tests/golden', { recursive: true });
writeFileSync(OUT_RUNTIME, JSON.stringify({ v: '1457', tiles: manifest }, null, 1));
writeFileSync(OUT_GOLDEN, JSON.stringify({ v: '1457', tiles: manifest }, null, 1));
console.log(`total=${stats.total} parsed=${stats.parsed} unparsed=${stats.unparsed.length} warned=${stats.warned.length} subCopyFrom=${stats.subCopyFrom ?? 0} subLiqWrites=${stats.subLiqWrites ?? 0} altTiles=${Object.values(manifest).filter((r) => r?.altTiles).length} uccp=${Object.values(manifest).filter((r) => r?.uccp === true).length} subTiles=${Object.values(manifest).filter((r) => r?.subTiles).length} subPoisonSkips=${stats.subPoisonSkips ?? 0} alts=${Object.values(manifest).filter((r) => r?.alts?.length).length} altFaces=${Object.values(manifest).reduce((a, r) => a + (r?.alts?.length ?? 0), 0)} altSkips=${stats.altSkips ?? 0} altPoisonSkips=${stats.altPoisonSkips ?? 0} vTiles=${Object.values(manifest).filter((r) => r?.vTiles || r?.ivTiles || Object.values(r?.subTiles ?? {}).some((s) => s.vTiles || s.ivTiles)).length}`);
console.log('unparsed ids:', stats.unparsed.join(','));
// 液体两维分布抽查（M-3）
{
  const waterNA = [], lavaAllow = [], onlyInFull = [];
  for (const [id, r] of Object.entries(manifest)) {
    if (!r) continue;
    if (r.liq.water === 'notAllowed') waterNA.push(id);
    else if (r.liq.water === 'onlyInFull') onlyInFull.push(id);
    if (r.liq.lava === 'allowed') lavaAllow.push(id);
  }
  console.log(`liq: water=notAllowed(${waterNA.length}): ${waterNA.join(',')} | lava=allowed: ${lavaAllow.join(',')} | water=onlyInFull: ${onlyInFull.join(',') || '无'}`);
}
// 子样式液体记录分布（M-3b）：per-style 发散条目数与逐 tile 清单
{
  const tiles = [], total = { styles: 0, entries: 0 };
  for (const [id, r] of Object.entries(manifest)) {
    if (!r?.liqStyles) continue;
    const n = Object.keys(r.liqStyles).length;
    total.styles++; total.entries += n;
    tiles.push(`${id}(${Object.entries(r.liqStyles).map(([st, lq]) => `${st}:${lq.water[0]}${lq.lava[0] === 'a' ? 'L' : ''}`).join('/')})`);
  }
  console.log(`liqStyles: tiles=${total.styles} entries=${total.entries} | ${tiles.join(' ')}`);
}
// 抽查
for (const k of ['220', '10', '11', '212', '91', '13', '4']) {
  const r = manifest[k];
  console.log(k, r ? JSON.stringify(r) : '(unparsed)');
}
