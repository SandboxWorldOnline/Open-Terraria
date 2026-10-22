// 原版世界背景图系统 1:1（Main.cs DrawBG/DrawSurfaceBG :58718-60900 + DrawBackground :52217-53517）。
// 地表：bgStyle（GetPreferredBGStyleForPlayer :63658 优先级）→ bgAlpha 前后两层 ±0.05/帧
// （UpdateBGVisibility :63534）→ 群系 3 层视差贴图（WorldGen.setBG :7181 贴图集，
// DrawSurfaceBG_* 各方法的 bgScale/bgParallax/bgTopY 常量），昼夜色调 = ColorOfTheSkies × bgAlpha。
// 地下：PickUndergroundBackgroundStyle :53454 → style→7 槽贴图表（UpdateBackgroundStyles :53221）
// → 表面过渡/泥土/岩石/岩浆分层（ugBackTransition 0.25/帧 新旧双绘）。
// 贴图懒加载（vanilla/Background_N.png，不进 SpriteAtlas 常驻表）。
// 主菜单：原版菜单与游戏内走同一 DrawSurfaceBG，只靠 gameMenu 分支切差异（DrawBG
// cs:64976-64989 夜=Corruption/昼=Forest1 直设 + 过渡坡速 0.02/帧）——本类以 menuMode
// 旗承载该分支（构造参数），menuTick/drawMenu 为菜单唯一入口，层几何见 drawMenu 注。
import { upgradeToBitmap, loadBitmapOnly, SpriteAtlas } from '../assets/SpriteAtlas';
import type { World } from '../world/World';
import type { SceneFlags } from '../world/SceneMetrics';
import { atmoOf } from './SkyRenderer';
import { texReady } from './texId';
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ330 GTW 单源
import { lateImageRetryDefer } from '../assets/lateImageRetry';

// ---- SurfaceBackgroundID（Terraria.ID/SurfaceBackgroundID.cs） ----
const Forest1 = 0, Corruption = 1, Desert = 2, Jungle = 3, Ocean = 4, CorruptDesert = 5,
  Hallow = 6, Snow = 7, Crimson = 8, Mushroom = 9, Forest2 = 10, Forest3 = 11, Forest4 = 12,
  HallowDesert = 13, CrimsonDesert = 14;

/** 样式 → BackgroundChangeFlashInfo areaId（TreeTopsInfo.AreaId 槽位：
 *  0-3=Forest1-4、4=Corrupt、5=Jungle、6=Snow、7=Hallow、8=Crimson、9=Desert、
 *  10=Ocean、11=Mushroom、12=Underworld——BackgroundChangeFlashInfo.cs:9-22） */
const STYLE_TO_AREA: Record<number, number> = {
  0: 0, 10: 1, 11: 2, 12: 3,
  1: 4, 3: 5, 7: 6, 6: 7, 8: 8,
  2: 9, 5: 9, 13: 9, 14: 9,
  4: 10, 9: 11,
};


// ---- 贴图集表（WorldGen.setBG :7165-7716；style 由世界种子确定性挑选） ----
// ★终清波扩表（2026-09：对照 Terarria1458 反编译全集补齐渲染行）：此前本仓各
// 群系表是 vanilla 值域子集（B3-5 审计备案），世界球重掷只落在旧档位上。现全部
// 扩到与原版 setBG 可行值域一一对应（每行注释标原版样式号，行序 = 样式号升序,
// 子族紧随基样）。旧行语义仍保留在行号 0 起（见各表首注记）。
//
// 森林（SetForestBGSet :7589-7716 全表 19 视觉 = {0..13}∪{31,51,71,72,73}，
// RollRandomForestBGStyle cs:7983 的全域；default 分支 = 样式 0 → [9,10,11]）。
export const FOREST_STYLES: Array<{ m: [number, number]; t: [number, number, number] }> = [
  { m: [7, 8], t: [9, 10, 11] },         // 样式 0（switch default 树组）
  { m: [7, 8], t: [50, 51, 52] },        // 样式 1
  { m: [7, 8], t: [53, 54, 55] },        // 样式 2
  { m: [7, 90], t: [91, -1, 92] },       // 样式 3
  { m: [7, 90], t: [91, -1, 11] },       // 样式 31
  { m: [93, 94], t: [-1, -1, -1] },      // 样式 4
  { m: [93, 94], t: [-1, -1, 55] },      // 样式 5
  { m: [93, 94], t: [-1, -1, 11] },      // 样式 51
  { m: [171, 172], t: [173, -1, -1] },   // 样式 6
  { m: [176, 177], t: [178, -1, -1] },   // 样式 7
  { m: [176, 177], t: [178, -1, 11] },   // 样式 71
  { m: [176, 177], t: [178, -1, 52] },   // 样式 72
  { m: [176, 177], t: [178, -1, 55] },   // 样式 73
  { m: [179, 180], t: [184, -1, -1] },   // 样式 8
  { m: [277, 278], t: [279, -1, -1] },   // 样式 9
  { m: [280, 281], t: [282, -1, -1] },   // 样式 10
  { m: [7, 331], t: [330, 329, 328] },   // 样式 11
  { m: [7, 336], t: [335, 334, 333] },   // 样式 12
  { m: [7, -1], t: [343, 342, 341] },    // 样式 13（无 Step2 山层）
];
/** 行号 ↔ 原版森林样式号映射（上表唯一事实源,sameVisual forest 族门的翻译底稿;
 *  导出仅供对账/测试——渲染与重掷消费方仍应走行空间口）。 */
export const VANILLA_FOREST_STYLE_ORDER = [0, 1, 2, 3, 31, 4, 5, 51, 6, 7, 71, 72, 73, 8, 9, 10, 11, 12, 13];

export const CORRUPT_STYLES: Array<[number, number, number]> = [
  [12, 13, 14], [56, 57, 58], [211, 212, 213], [225, 226, 227], [240, 241, 242],
  [324, 323, 322],   // 样式 51（Graveyard 族——RandomizeBackgrounds_Corruption :7962 折变体）
  [324, 226, 322],   // 样式 52（case 52 :7253-[1]槽借 226,SURF_FLIP 整层翻转自动生效）
];
export const CRIMSON_STYLES: Array<[number, number, number]> = [
  [43, 44, 45], [105, 106, 107], [174, -1, 175], [214, 215, 216], [-1, 229, 230], [255, 256, 257], [339, 338, 337],
];
export const JUNGLE_STYLES: Array<[number, number, number]> = [
  [15, 16, 17], [59, 60, 61], [222, 223, 224], [237, 238, 239], [284, 285, 286], [271, 272, 273], [302, 301, 300],
];
/** 雪（setBG case 3 :7305-7440 全域 = Next(9)+折变体 21/22/31/32/41/42 共 15 视觉）。
 *  ★原版 case 3 连 Main.snowMntBG 一起换（:7306 预置 35/36 后按样式覆写 98/99/
 *  98/100/98/101 或清空 -1/-1）——结构化行携带山体对（m 槽,-1=该步不画）,
 *  drawSurface 雪支按行取 m 槽替换旧硬编码 35/36。 */
export interface SnowRow { m: [number, number]; t: [number, number, number] }
export const SNOW_STYLES: SnowRow[] = [
  { m: [35, 36], t: [37, 38, 39] },      // 样式 0
  { m: [35, 36], t: [97, 96, 95] },      // 样式 1
  { m: [98, 99], t: [-1, -1, -1] },      // 样式 2（纯山体组）
  { m: [98, 99], t: [95, 96, 97] },      // 样式 21
  { m: [98, 99], t: [37, 38, 39] },      // 样式 22
  { m: [98, 100], t: [-1, -1, -1] },     // 样式 3
  { m: [98, 100], t: [95, 96, 97] },     // 样式 31
  { m: [98, 100], t: [37, 38, 39] },     // 样式 32
  { m: [98, 101], t: [-1, -1, -1] },     // 样式 4
  { m: [98, 101], t: [95, 96, 97] },     // 样式 41
  { m: [98, 101], t: [37, 38, 39] },     // 样式 42
  { m: [-1, -1], t: [258, 259, 260] },   // 样式 5（巨型山脉树组,无独立山层）
  { m: [-1, -1], t: [263, 264, 265] },   // 样式 6
  { m: [269, 270], t: [267, 266, 268] }, // 样式 7
  { m: [35, 36], t: [299, 298, -1] },    // 样式 8（case 8 不覆写山体,:7306 预置态）
];
export const HALLOW_STYLES: Array<[number, number, number]> = [
  [29, 30, 31], [102, 103, 104], [219, 220, 221], [243, 244, 245], [-1, 261, 262], [327, 326, 325],
];
/** 行号↔样式号映射（雪/沙漠/腐化——行序即此表序;供重掷链与渲染行的对账测试）。
 *  雪序含折变体（RandomizeBackgrounds :7922-7949 折叠语义）;沙漠/腐化序把
 *  侵染族 51..53 / 51..52 排在纯档之后。 */
export const VANILLA_SNOW_STYLE_ORDER = [0, 1, 2, 21, 22, 3, 31, 32, 4, 41, 42, 5, 6, 7, 8];
export const VANILLA_CORRUPT_STYLE_ORDER = [0, 1, 2, 3, 4, 51, 52];
export const VANILLA_DESERT_STYLE_ORDER = [0, 1, 2, 3, 4, 51, 52, 53];
/** 蘑菇（setBG case 8 :7528-7559 五档全表）。★终清波修正:旧行 [26,27,28]/
 *  [111,110,109] 是早期转录错误——26/27 实为原版 GoodEvilDesert 兜底沙丘画
 *  （Main.cs:61857/:61874 LoadBackground(26)/(27)）、109..111 与蘑菇无关,与
 *  1456/1457/1458 三版 mushroomBG 全不对应。存档兼容:mushroom 持久值本就是
 *  原版样式号 0..4,行序即样式序,旧存档 0/1 值直接落正确新行。 */
export const MUSHROOM_STYLES: Array<[number, number, number]> = [
  [46, 47, 48], [231, 232, 233], [234, 235, 236], [287, 288, 289], [321, 320, 319],
];
/** 沙漠（setBG case 6 :7441-7508 全域 = {0..4}∪{51,52,53}）。结构化行:p=Pure 组
 *  （bgStyle=2 直用）;c/h/r=腐化/神圣/猩红沙漠槽列（bgStyle=5/13/14 时若当前
 *  desertStyle 为沙侵染族 51/52/53 则取对应列,否则走 GoodEvilDesert 兜底 26/27）。
 *  样式 4 无侵染列——纯样式只在 Pure 列驻留(:7462 后 Clear 只填 Pure)。 */
export interface DesertRow {
  p: [number, number, number];
  c?: [number, number, number];
  h?: [number, number, number];
  r?: [number, number, number];
}
export const DESERT_STYLES: DesertRow[] = [
  { p: [21, 20, -1] },                  // 样式 0
  { p: [108, 109, -1] },                // 样式 1
  { p: [207, 208, -1] },                // 样式 2
  { p: [217, 218, -1] },                // 样式 3
  { p: [248, 249, 250] },               // 样式 4（三槽齐用;山体门 desertBG!=4 关闭,:60809/:60847）
  { p: [306, 303, -1], c: [310, 307, -1], h: [314, 311, -1], r: [318, 315, -1] },  // 样式 51
  { p: [306, 304, -1], c: [310, 308, -1], h: [314, 312, -1], r: [318, 316, -1] },  // 样式 52
  { p: [306, 305, -1], c: [310, 309, -1], h: [314, 313, -1], r: [318, 317, -1] },  // 样式 53
];
/** 沙漠样式 4 所在行（BackMountainsStep1/Step2 的 desertBG!=4 门锚点,
 *  :60806-60808/:60844-60846——沙暴巨型丘自带三层,不再叠通用 23/22 山）。 */
const DESERT_STYLE4_ROW = 4;
/** 好恶沙漠兜底画（DrawSurfaceBG_GoodEvilDesert :61852-61892:set 的对应侵染列
 *  为空时 Corrupt/Hallow/CrimsonDesert 槽落通用沙丘双条 26/27） */
const GOODEVIL_DESERT_FALLBACK: [number, number] = [26, 27];
/** 海洋单层贴图变体（WorldGen.setBG case 7 :7513-7541：style 0-7 → Main.oceanBG，
 *  worldgen 期 setBG(7, random.Next(8)) :7973 掷骰；海洋层 = 单张贴图无树层组） */
export const OCEAN_STYLES = [28, 110, 111, 209, 210, 283, 332, 340];
/** 地下带状背景横向视差（Main.cs:1172 caveParallax 默认 0.88;设置项 "Parallax" 可调） */
const CAVE_PARALLAX = 0.88;

// ---- 表面层每贴图覆盖总表（Main.cs SetBackgroundOffsets :61335-61716 全表转写）----
// [scale?, parallax?, topA?, topB?]——缺省项沿用各群系 DrawSurfaceBG_* 函数头默认档;
// topA/topB 任一非 0 才重算 bgTopY（原版 num/num2 语义）。bgScale 另乘 num4=2。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SET_BG: Record<number, [number | undefined, number | undefined, number | undefined, number | undefined]> = {
  258: [1.25, 0.23, 1800, 850], 259: [1.31, 0.33, 1950, 1500], 260: [1.34, 0.4, 2100, 1650],
  263: [1.25, 0.23, 1800, 1450], 264: [1.31, 0.33, 1950, 1700], 265: [1.34, 0.4, 2100, 2000],
  267: [1.25, 0.23, 1700, 1300], 266: [1.31, 0.33, 1950, 1600], 268: [1.34, 0.41, 2100, 1850],
  248: [1.3, 0.37, 1800, 1100], 249: [1.4, 0.43, 1950, 1200], 250: [1.7, 0.49, 2000, 1000],
  255: [1.15, 0.25, 1800, 1450], 256: [1.21, 0.32, 1950, 1550], 257: [1.34, 0.4, 2100, 1550],
  240: [1.15, 0.3, 1800, 1500], 241: [1.21, 0.43, 1950, 1300], 242: [1.34, 0.49, 2100, 1400],
  243: [1.15, 0.25, 1800, 1400], 244: [1.21, 0.35, 1950, 1550], 245: [1.24, 0.45, 2100, 1650],
  273: [undefined, 0.49, 2100, 1560],
  234: [undefined, 0.23, 1700, 1150], 235: [undefined, 0.33, 1950, 1550], 236: [undefined, 0.41, 2100, 2000],
  279: [2.5, 0.35, 1850, 1750], 282: [2.6, 0.25, 1800, 1340],
  261: [undefined, 0.27, undefined, undefined], 262: [undefined, 0.4, undefined, undefined],
  219: [undefined, 0.25, undefined, undefined], 220: [undefined, 0.34, undefined, undefined], 221: [undefined, 0.43, undefined, undefined],
  222: [undefined, undefined, 1800, 1400], 223: [undefined, undefined, 2150, 1850], 224: [undefined, undefined, 2500, 2400],
  237: [undefined, undefined, 1800, 1500], 238: [undefined, undefined, 1950, 1500], 239: [undefined, undefined, 2100, 1900],
  284: [undefined, 0.23, 1600, 900], 285: [undefined, 0.36, 1900, 960], 286: [undefined, 0.42, 2100, 1200],
  287: [undefined, 0.21, 1700, 1560], 288: [undefined, 0.33, 1950, 1730], 289: [undefined, 0.41, 2100, 1400],
  207: [undefined, 0.32, undefined, undefined],
  298: [1.25, 0.35, 2000, 1700], 299: [undefined, 0.28, 1600, 1400],
  300: [2.41, 0.53, 3000, 2050], 301: [2.36, 0.415, 2200, 1700], 302: [2.25, 0.24, 1400, 950],
  303: [undefined, 0.35, 2400, 1900], 304: [undefined, 0.35, 2400, 1900], 305: [undefined, 0.35, 2400, 1900],
  307: [undefined, 0.35, 2400, 1900], 308: [undefined, 0.35, 2400, 1900], 309: [undefined, 0.35, 2400, 1900],
  311: [undefined, 0.35, 2400, 1900], 312: [undefined, 0.35, 2400, 1900], 313: [undefined, 0.35, 2400, 1900],
  315: [undefined, 0.35, 2400, 1900], 316: [undefined, 0.35, 2400, 1900], 317: [undefined, 0.35, 2400, 1900],
  306: [undefined, 0.26, 1800, 1700], 310: [undefined, 0.26, 1800, 1700],
  314: [undefined, 0.26, 1800, 1700], 318: [undefined, 0.26, 1800, 1700],
  319: [undefined, 0.6, 4600, 3250], 320: [undefined, 0.3, 2250, 1950], 321: [undefined, 0.25, undefined, undefined],
  322: [undefined, 0.45, 2400, 1950], 323: [undefined, 0.35, 1900, 1500], 324: [undefined, 0.25, 1600, 1300],
  325: [undefined, 0.49, 2800, 2400], 326: [undefined, 0.33, 2000, 1740], 327: [undefined, 0.22, 1450, 1165],
  328: [2.01, 0.34, undefined, undefined], 329: [2.29, 0.26, undefined, undefined], 330: [undefined, 0.25, 1750, 1450],
  333: [2.01, 0.37, undefined, undefined], 334: [undefined, 0.26, undefined, undefined], 335: [undefined, 0.22, 1650, 1470],
  337: [1.01, 0.35, 2500, 2200], 338: [0.98, 0.24, 1900, 1650], 339: [0.94, 0.2, 1600, 1350],
  341: [undefined, 0.3, undefined, undefined], 342: [undefined, 0.25, undefined, undefined], 343: [undefined, 0.2, 1650, 1550],
  // ★森林树层[0]槽内联覆写（DrawSurfaceBG_Forest :62231-62259——这四枚不在
  //   SetBackgroundOffsets switch 内,是函数体内的 if 分支专属值;终清波扩表批补齐,
  //   曾漏 = 样式 6(row t0=173)/7(178)/8(184) 的缩放与视差恒走函数头默认档）。
  //   282 同类内联分支只有 bgScale=1.4(:62253),但其 SetBackgroundOffsets 项
  //   ([2.6,0.25,1800,1340] :61519)随后必覆写,净行为已由上表 282 行承担。
  91: [1.2, 0.27, undefined, undefined],
  173: [1.3, 0.25, undefined, undefined],
  178: [1.2, 0.30000001192092896, undefined, undefined],
  184: [1.2, 0.25, undefined, undefined],
};

/** GetLayerYOffset（Main.cs :60687-60730）：山体/雪原/丛林层贴图专属 Y 微调 */
const LAYER_YOFF: Record<number, number> = {
  59: -550, 93: -50, 168: -50, 169: -50, 170: -50, 171: -100, 172: 130,
  176: -760, 177: -200, 179: -100, 180: -350, 181: -350, 182: -350, 183: -350,
  246: -150, 247: -150, 263: -700, 269: -600, 270: -50, 271: -300, 272: -380,
  277: -260, 278: -120, 280: -170, 281: -300, 283: -800, 332: -25, 340: -25,
};

/** GetBackgroundRect 2×2 帧动画表（Main.cs :62164-62199）：值=帧周期（GameUpdateCount
 *  tick,60/s）；Frame(2,2,col,row)+Inflate(0,-2)——帧=整表半宽半高,帧距=整表宽×scale */
const BG_SHEET: Record<number, number> = { 235: 20, 281: 5 };
for (const t of [219, 220, 221, 271, 272, 273, 302, 303, 305, 307, 309, 311, 313, 315, 317, 326, 337, 338, 341]) {
  BG_SHEET[t] = 15;
}

/** 各群系函数 topY 微调集合（Forest :62302-62322/:62378-62390/:62444-62452 +
 *  Crimson :61150-61156/:61231 + Jungle :61888/:61920/:61948） */
const SURF_NUDGE: Record<number, number> = {
  50: -50, 53: -100, 91: 200, 173: 200, 178: 75, 330: -150, 335: -150, 343: -300,   // Forest[0]
  51: -50, 54: -100, 329: -150, 334: -150, 342: -300,                              // Forest[1]
  52: -50, 55: -100, 92: 150, 328: -150, 333: -150, 341: -50,                      // Forest[2]
  105: 50, 174: -350, 175: -400,                                                   // Crimson[0]/[2]
  59: -200, 60: -175, 61: -150,                                                    // Jungle
};

/** Forest[1] 层 topY 绝对重置（:62355-62362 91/173/184 与 [1] 329/334、[2] 328/333） */
const SURF_TOP_RESET: Record<number, [number, number]> = {
  91: [1600, 1400], 173: [1600, 1400], 184: [1600, 1400],
  329: [1900, 1600], 334: [1900, 1650],
  328: [2600, 2300], 333: [2800, 2550],
};

/** 水平翻转（Forest[1] 51/54 SpriteEffects.FlipHorizontally :62397 + Corrupt[1] 整层
 *  FlipHorizontally :62133——13/57/212/226/241/323 为腐化各风格 [1] 槽贴图） */
const SURF_FLIP = new Set([51, 54, 13, 57, 212, 226, 241, 323]);

// ---- 菜单样式表（menuMode 专用，与上方游戏内数组分池）----
// 游戏内 FOREST_STYLES/CORRUPT_STYLES 数组的键空间 = seedPick 档位(0..6/0..5)；
// 菜单滚掷的是 WorldGen 样式【号】（RollRandomForestBGStyle cs:7983 加权重掷出
// 31/51/71-73、RandomizeBackgrounds_Corruption cs:7962 掷出 51/52），故按号建全表。
// ★不合表：合并会改 seedPick 的取模长度 → 全世界背景档位重排（游戏内行为零改动
// 红线）。MenuBackground.ts 的同名副本已删，唯一副本在此。
interface MenuForestStyle { mnt: [number, number]; trees: [number, number, number] }
/** SetForestBGSet 全表（WorldGen.cs:7589-7710，1458 行号下同）：mnt=treeMntBGSet、trees=treeBGSet */
const MENU_FOREST_STYLES: Record<number, MenuForestStyle> = {
  1: { mnt: [7, 8], trees: [50, 51, 52] },
  2: { mnt: [7, 8], trees: [53, 54, 55] },
  3: { mnt: [7, 90], trees: [91, -1, 92] },
  31: { mnt: [7, 90], trees: [91, -1, 11] },
  4: { mnt: [93, 94], trees: [-1, -1, -1] },
  5: { mnt: [93, 94], trees: [-1, -1, 55] },
  51: { mnt: [93, 94], trees: [-1, -1, 11] },
  6: { mnt: [171, 172], trees: [173, -1, -1] },
  7: { mnt: [176, 177], trees: [178, -1, -1] },
  71: { mnt: [176, 177], trees: [178, -1, 11] },
  72: { mnt: [176, 177], trees: [178, -1, 52] },
  73: { mnt: [176, 177], trees: [178, -1, 55] },
  8: { mnt: [179, 180], trees: [184, -1, -1] },
  9: { mnt: [277, 278], trees: [279, -1, -1] },
  10: { mnt: [280, 281], trees: [282, -1, -1] },
  11: { mnt: [7, 331], trees: [330, 329, 328] },
  12: { mnt: [7, 336], trees: [335, 334, 333] },
  13: { mnt: [7, -1], trees: [343, 342, 341] },
};
/** 夜槽贴图集（WorldGen.setBG case 1，cs:7165 起；RandomizeBackgrounds_Corruption
 *  cs:7962 = Next(6)，5→51/52）——夜晚菜单槽 bgStyle=1 = Corruption（DrawBG cs:64981） */
const MENU_CORRUPT_STYLES: Record<number, [number, number, number]> = {
  0: [12, 13, 14], 1: [56, 57, 58], 2: [211, 212, 213], 3: [225, 226, 227],
  4: [240, 241, 242], 51: [324, 323, 322], 52: [324, 226, 322],
};
/** 各层贴图内容首行（PNG 实测：首个 >4% 不透明行）——菜单分数定位的补偿项：
 *  y = 目标分数×H − topRow×scale，使任何贴图的【内容】落在目标高度（176 内容在
 *  row466/942、94 在 row89/630……无补偿则样式间观感漂移——2026-08-24 第六轮定稿，
 *  用户 1.4.5.8 截图对拍：山脊 40/45%H、树线 72/79/86%H、重复周期 ≈ 窗宽）。
 *  ★原版等价物 = GetLayerYOffset 偏移表（Main.cs cs:60687 起，93→−50/176→−760/
 *  177→−200…≈ −contentRow×2+常数的手工调平）+ 树逐槽像素偏移（:60764-60960）——
 *  本表为同目的的实测替代，两者不可叠加使用。实测法：zlib 手解 PNG 行滤波逐行
 *  数不透明像素；4% 阈值会抓到稀疏尖端（93 致密行实际 9/660） */
const TEX_TOPROW: Record<number, number> = {
  7: 12, 8: 9, 50: 37, 51: 37, 52: 37, 53: 7, 54: 7, 55: 7, 90: 9, 91: 68,
  92: 36, 11: 9, 93: 4, 94: 89, 171: 42, 172: 5, 173: 21, 176: 466, 177: 156,
  178: 18, 179: 65, 180: 126, 184: 14, 24: 8, 25: 8,   // 24/25=夜槽远山(菜单 Corruption)
  277: 153, 278: 26, 279: 16, 280: 140,
  281: 75, 282: 92, 331: 18, 328: 36, 329: 160, 330: 172, 335: 123, 334: 151,
  333: 8, 336: 5, 343: 28, 342: 38, 341: 63,
};


// ---- 地下 style→7 槽贴图表（DrawBackground_UpdateBackgroundStyles :53221 全表） ----
// 槽位: [0]表面过渡 [1]泥土 [2]岩石上 [3]岩石下/群系 [4]岩浆过渡 [5]地狱柱 [6]岩浆体
function ugSlots(style: number, iceBack: number, jungleBack: number, hellBack: number, worldID: number): number[] {
  const t = [0, 0, 0, 0, 0, 125 + hellBack, 185 + hellBack];
  switch (style) {
    case 0: return [1, 2, 4, 3, 6, t[5], t[6]];   // ★原版 switch 后统一覆写 [5]=125+hell/[6]=185+hell(:53418-26),
                                                  //   曾漏覆写(style0 槽位错位→magma/strip 取错贴图)
    case 1: {
      const v = iceBack === 0 ? [40, 33, 34, 32] : iceBack === 1 ? [160, 118, 161, 117]
        : iceBack === 2 ? [164, 165, 166, 167] : [162, 120, 163, 119];
      return [v[0], v[1], v[2], v[3], 128 + hellBack, t[5], t[6]];
    }
    case 2: return [62, 63, 64, 65, 143 + hellBack, t[5], t[6]];
    case 3: return [66, 67, 68, 69, 128 + hellBack, t[5], t[6]];
    case 4: return [70, 71, 68, 72, 128 + hellBack, t[5], t[6]];
    case 5: return [73, 74, 75, 76, 131 + hellBack, t[5], t[6]];
    case 6: return [77, 78, 79, 80, 134 + hellBack, t[5], t[6]];
    case 7: return [77, 81, 79, 82, 134 + hellBack, t[5], t[6]];
    case 8: return [83, 84, 85, 86, 137 + hellBack, t[5], t[6]];
    case 9: return [83, 87, 88, 89, 137 + hellBack, t[5], t[6]];
    case 10: return [121, 122, 123, 124, 140 + hellBack, t[5], t[6]];
    case 11: return jungleBack === 0
      ? [153, 147, 148, 149, 150 + hellBack, t[5], t[6]]
      : [146, 154, 155, 156, 157 + hellBack, t[5], t[6]];
    case 12: return [66, 67, 68, 193 + worldID % 4, 128 + hellBack, t[5], t[6]];
    case 13: return [66, 67, 68, 188 + worldID % 5, 128 + hellBack, t[5], t[6]];
    case 14: return [66, 67, 68, 197 + worldID % 3, 128 + hellBack, t[5], t[6]];
    case 15: return [40, 33, 34, 200, 128 + hellBack, t[5], t[6]];
    case 16: return [40, 33, 34, 201 + worldID % 2, 128 + hellBack, t[5], t[6]];
    case 17: return [40, 33, 34, 203 + worldID % 4, 128 + hellBack, t[5], t[6]];
    // ★原版 case 18-21 只赋 [0]/[1]（[2]岩石过渡 [3]岩石带 Clear=0）——沙滩风格
    //   在 oceanLevel(425) 深度门下沿、岩石带入镜的窗口（高地形丛林贴海洋处）
    //   会出现"泥土带以下纯黑"穿帮（2026-08-24 用户实报）。补 4(岩石过渡条)/
    //   3(通用岩石带) = 修复性偏离：黑块 → 通用岩石背景。
    case 18: return [290, 291, 4, 3, 0, t[5], t[6]];
    case 19: return [292, 293, 4, 3, 0, t[5], t[6]];
    case 20: return [294, 295, 4, 3, 0, t[5], t[6]];
    case 21: return [296, 297, 4, 3, 0, t[5], t[6]];
    default: return [1, 2, 4, 3, 6, t[5], t[6]];  // 同上统一覆写
  }
}

/** 确定性伪随机（世界种子派生；替代原版 RandomizeBackgrounds 的 worldgen 期随机） */
function seedPick(seed: number, salt: number, n: number): number {
  let h = (seed ^ (salt * 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  // 关键：最终异或返回有符号 int32，必须 >>> 0 归正，否则负数 % n 得负索引
  // （曾致 FOREST_STYLES[-2] → undefined → drawSurface 崩溃、渲染循环整体停摆）
  return ((h ^ (h >>> 16)) >>> 0) % n;
}

interface Cam { x: number; y: number; zoom: number }

/** 绘制后端抽象(docs/webgl2-migration-plan.md #1):2D/GL 双实现共用
 *  同一份几何/视差/带序数学。img = 9 参 drawImage 等价;tint 语义 =
 *  canvas multiply+destination-in(2D 侧走既有 tintCache 烘焙,GL 侧 uniform) */
export interface BGBlit {
  img(im: ImageBitmap | HTMLImageElement, sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
    opts?: { alpha?: number; tint?: readonly [number, number, number] | null;
      /** 2×2 帧动画子区（GetBackgroundRect）；tint 烘焙路径按此取样 */
      src?: [number, number, number, number] }): void;
  fill(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a?: number): void;
}

/** 2D 后端:包装既有 ctx 行为(globalAlpha / tint 走 drawTiledTinted 烘焙缓存) */
class CanvasBgBlit implements BGBlit {
  constructor(private bg: BiomeBackground, private ctx: CanvasRenderingContext2D) {}
  img(im: ImageBitmap | HTMLImageElement, sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
    opts?: { alpha?: number; tint?: readonly [number, number, number] | null;
      src?: [number, number, number, number] }): void {
    const ctx = this.ctx;
    const alpha = opts?.alpha ?? 1;
    const tint = opts?.tint ?? null;
    const src = opts?.src;
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha = alpha;
    if (tint && !(tint[0] >= 0.999 && tint[1] >= 0.999 && tint[2] >= 0.999)) {
      // tint 烘焙（缓存键=贴图|色桶）；帧动画子区在绘制端裁
      this.bg.drawTiledTinted(ctx, im, tint[0], tint[1], tint[2], dx, dy, dw, dh, src);
    } else if (src) {
      ctx.drawImage(im, src[0], src[1], src[2], src[3], dx, dy, dw, dh);
    } else {
      ctx.drawImage(im, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    ctx.restore();
  }
  fill(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 1): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}

/** 行变体类型 = 元组行（corrupt/crimson/jungle/hallow/mushroom 三元组）或结构化行
 *  （forest/SnowRow{m,t}、DesertRow{p,c,h,r}）。槽键显式枚举——接口型无隐式索引签名,
 *  不能写 {[k:string]:...} 这类索引形态。 */
type SurfStyleRow = readonly number[] | {
  readonly m?: readonly number[]; readonly t?: readonly number[];
  readonly p?: readonly number[]; readonly c?: readonly number[];
  readonly h?: readonly number[]; readonly r?: readonly number[];
};

/** 结构化/元组行 → 贴图 id 平面集（warm/warmStyle/loadBg 预热与渐隐带判定共口；
 *  键名覆盖两类结构化行的全部槽）。负数槽位（-1=该步不画）由消费方自行过滤。 */
function rowTexIds(row: SurfStyleRow): number[] {
  if (Array.isArray(row)) return [...row];
  return ['m', 't', 'p', 'c', 'h', 'r'].flatMap((k) => {
    const v = (row as { readonly m?: readonly number[] })[k as 'm'];
    return Array.isArray(v) ? [...v] : [];
  });
}

export class BiomeBackground {
  /** Main.cloudBGAlpha（:58782-58792 漂移累积器，cloudBG 大云图双层 α 源；
   *  与 SkyRenderer 同名位同式——HorizonClouds 强度消费那份，此处消费云图层 α） */
  private cloudBGAlpha = 0;
  /** Main.cloudBGX[2]（:58796-58804/:58845-58852 风漂移累积，wrap ±w·scale） */
  private cloudBGX = new Float64Array(2);
  // ---- 主菜单分支（menuMode = 原版「菜单/游戏内同一 DrawSurfaceBG，仅 gameMenu
  // 分支切差异」架构的旗面，Main.cs:64976-64989）。构造置 true 后本实例只服务
  // MenuBackground：menuTick/drawMenu 是唯一入口（内部再设 !menuMode 守卫），
  // update()/draw() 等游戏内路径永不触达——游戏内 Renderer 实例 menuMode=false，
  // 行为零改动 ----
  readonly menuMode: boolean;
  /** 菜单当前样式（WorldGen.treeBG1/corruptBG 菜单侧等价读数；滚掷调度仍在
   *  MenuBackground 调度钟里，每 tick 经 setMenuStyles 写入——调度与渲染分职） */
  private menuForestStyle = 1;
  private menuCorruptStyle = 0;
  /** 菜单层 tint 烘焙缓冲。★防 canvas 分配雪崩约定（2026-08-26）：①键 = tex id，
   *  颜色分量不入键、以 4 单位量化桶存上次值——晨昏连续扫描期跨桶才重烘
   *  （1.6% 亮度差不可辨，杜绝逐 tick 重烘抖动）；②表容量 = 活跃贴图数
   *  （≤全表 41 张、常规 ≤8 张），画布每 tex 只建一次复用，无 clear-all 路径。
   *  α 不进本缓存（走 drawMenuLayer globalAlpha） */
  private menuTintBufs = new Map<number, { cv: HTMLCanvasElement; tr: number; tg: number; tb: number }>();

  constructor(menuMode = false) {
    this.menuMode = menuMode;
    // 开局昼槽全显（Main.cs:6744-6745 LoadContent：bgAlphaFrontLayer[0]=1f +
    // bgAlphaFarBackLayer[0]=1f——森林槽初态全可见,背景不从天空淡入）
    this.alphaFront[Forest1] = 1;
    this.alphaFar[Forest1] = 1;
  }
  /** 贴图懒加载缓存（n → img；-1 = 加载失败） */
  private imgs = new Map<number, ImageBitmap | HTMLImageElement | null>();
  /** 地表风格状态（≈Main.bgStyle/bgDelay/bgAlphaFrontLayer/bgAlphaFarBackLayer） */
  bgStyle = 0;
  /** 瞬切计数（instantBGTransitionCounter :63518；森林→森林同生成背景） */
  private instantBG = 0;
  /** BackgroundChangeFlashInfo._flashPower（13 area 槽；drawSurface 前景循环逐槽消费画黑闪） */
  readonly bgFlash = new Float64Array(13);
  /** 拍照重渲黑闪抑制（Renderer._capturePass 每帧同步；原版 DrawCapture 无切换黑闪层。
   *  常态 false；置 true 时 drawSurface 前景循环跳过 overlay 绘制,状态机照跑） */
  flashSuppressed = false;
  /** 森林风格 → 该段 WorldGen 生成背景 ID（GetCurrentBackgroundOfStyle :8062
   *  的 treeBG1..4 = treeStyle[0..3]；等值 ⇒ 视觉相同 ⇒ 过渡可瞬切） */
  private forestBgId(world: World, style: number): number {
    const seg = style === Forest1 ? 0 : style === Forest2 ? 1 : style === Forest3 ? 2 : 3;
    return world.treeStyle?.[seg] ?? -1;
  }
  private bgDelay = 0;
  private alphaFront = new Array(16).fill(0);
  private alphaFar = new Array(16).fill(0);
  /** 岩浆背景动画累计 ms（magmaBGFrameCounter 每 8 tick=133.33ms 推帧,mod 3） */
  private magmaFrameT = 0;
  /** GetBackgroundCounter（:62200-62206 游戏内 = GameUpdateCount,60/s tick）——
   *  2×2 帧动画/173 四帧轮换的时间源；draw(dtMs) 按帧长 16.667ms 累进 */
  private bgTick = 0;
  private bgTickAcc = 0;
  /** 水平翻转烘焙缓存（SpriteEffects.FlipHorizontally——Forest[1] 51/54、Corrupt[1]
   *  整层；烘焙一次复用,双后端通用——GL quad 助手无翻转参数,走贴图侧翻转） */
  private flipCache = new WeakMap<object, HTMLCanvasElement>();
  /** 地下风格（≈Main.undergroundBackground/oldUndergroundBackground/ugBackTransition） */
  ugStyle = 0;
  private ugOld = 0;
  private ugAlpha = 0; // 新风格不透明度（旧→新过渡）
  /** 兜底告警去重（每 tag 只报一次；附现场信息便于排查播种异常根因） */
  private warnedTags = new Set<string>();
  private fallbackWarn(tag: string, info: Record<string, unknown>) {
    if (this.warnedTags.has(tag)) return;
    this.warnedTags.add(tag);
    // JSON.stringify 成单行文本：控制台直接可复制（对象形式需手动展开，不便回传）
    console.warn(`[BiomeBackground] 样式兜底触发(${tag})：播种状态异常，已回退默认贴图集防崩溃。现场: ${JSON.stringify(info)}`);
  }
  /** 带告警的风格数组取值：索引缺失/越界时回退 [0] 并留现场 */
  private pickStyle<T>(tag: string, arr: T[], idx: number | undefined, world: World): T {
    const v = arr[idx ?? -1];
    if (v === undefined) {
      this.fallbackWarn(tag, {
        seed: world.seed, seededFor: this.seededFor, idx, arrLen: arr.length,
        forestStyles: this.forestStyles, corruptStyle: this.corruptStyle, caveBackStyle: this.caveBackStyle,
        bgStyle: this.bgStyle, ugStyle: this.ugStyle,
      });
      return arr[0];
    }
    return v;
  }

  /** Main.oceanBG 等价读数（WorldGen.setBG case 7 :7513-7541 style→贴图映射） */
  private oceanTexId(): number {
    return OCEAN_STYLES[this.oceanStyle] ?? OCEAN_STYLES[0];
  }

  /** 沙漠当前生效三层组（bgStyle 槽感知）：Desert(2)→Pure 列 p；Corrupt/Hallow/
   *  CrimsonDesert(5/13/14)→该侵染列 c/h/r——纯样式（0..4）不驻留侵染列
   *  （setBG case 6 每 case 先 Clear 只填 Pure,:7448 起）→ 落 GoodEvilDesert
   *  兜底沙丘双条 26/27（Main.cs DrawSurfaceBG_GoodEvilDesert :61852-61892,
   *  第三槽 -1=原版双条画）。预温/渐变带消费口（按当前 bgStyle 槽）。
   *  ★drawSurface 交叉淡化期改走 desertTripleForSlot（按【槽】解析）——
   *  过渡期旧槽 alpha>0 时 bgStyle 已翻槽,侵染列选择必须锚槽位非当前样式。 */
  private activeDesertTriple(): [number, number, number] {
    return this.desertTripleForSlot(this.bgStyle);
  }

  /** 沙漠三层组按【前景槽】解析（原版前景循环 :60497/:60507：槽 2 画
   *  desertBackgroundSet.Pure、槽 5/13/14 画 GoodEvilDesert(l) 侵染列/兜底） */
  private desertTripleForSlot(slot: number): [number, number, number] {
    const d = this.styleRow('desert', DESERT_STYLES, this.desertStyle);
    if (slot === Desert) return [...d.p] as [number, number, number];
    const col = slot === CorruptDesert ? d.c
      : slot === HallowDesert ? d.h
      : slot === CrimsonDesert ? d.r : undefined;
    if (col) return [...col] as [number, number, number];
    return [GOODEVIL_DESERT_FALLBACK[0], GOODEVIL_DESERT_FALLBACK[1], -1];
  }

  /** UpdateBGVisibility_BackLayer（Main.cs:65123-65188）bgStyle→远山槽映射 1:1。
   *  ★远山槽与 bgStyle 非同构——山体绘制侧（BackMountainsStep1/Step2）按本表槽号
   *  取贴图：slot0=Forest1/Jungle/Mushroom 共用（treeMntBGSet1）、1=Desert（23/22）、
   *  2=Corruption+侵染沙漠系+非档3神圣（24/25）、3=Ocean（Step2 专属 oceanBG）、
   *  4=Snow（snowMntBG）、5=Crimson（24/42）、6=神圣档3（246/247）、10/11/12=
   *  Forest2-4、15=jungleBG 档5（无 Step1/2 绘制=远山淡出）。同槽共管效应：
   *  森林↔丛林↔蘑菇切换远山 alpha 不动（原版同相——山体不参与交叉淡化）。 */
  private farSlotsForStyle(style: number): number[] {
    switch (style) {
      case Forest2: return [10];
      case Forest3: return [11];
      case Forest4: return [12];
      case Desert: return [1];
      case Corruption: case CorruptDesert: case HallowDesert: case CrimsonDesert: return [2];
      case Hallow: return this.hallowStyle === 3 ? [6] : [2];
      case Ocean: return [3];
      case Snow: return [4];
      case Crimson: return [5];
      case Jungle: return this.jungleStyle === 5 ? [15] : [0];
      case Mushroom: return [0, 6];
      default: return [0];   // Forest1 + 越界兜底
    }
  }

  /** IsBackgroundConsideredTheSame（WorldGen.cs:8010）的行空间翻译——重掷「必异」
   *  的同族门（rollVariantInDomain 的 sameVisual 参量来源，Game.applyWorldGlobeReroll
   *  经此取用；行号空间经 VANILLA_FOREST_STYLE_ORDER 映射回样式号判族）：
   *  原版只有森林有三/四元视觉族 3↔31、5↔51、7↔71↔72↔73，其余群系 default 分支
   *  一律严格同值（a===b 由 rollVariantInDomain 的剔除逻辑先行处理）。 */
  sameVisual(kind: 'corrupt' | 'crimson' | 'jungle' | 'snow' | 'hallow'
    | 'mushroom' | 'desert' | 'ocean' | 'underworld' | 'forest', a: number, b: number): boolean {
    if (kind !== 'forest') return a === b;
    const st = (row: number) => VANILLA_FOREST_STYLE_ORDER[row];
    return [[3, 31], [5, 51], [7, 71, 72, 73]].some(
      (g) => g.includes(st(a)) && g.includes(st(b)),
    );
  }

  /** 风格表兜底读（pickStyle 的无 world 版）：索引缺失/越界回退 [0] 并留现场。
   *  warm/warmStyle/tint 全族统一走此口——裸读表曾在风格域字段越界时
   *  "undefined.filter" 帧循环 halt（2026-08-27 用户实报 Td.warm） */
  private styleRow<T>(tag: string, arr: readonly T[], idx: number | undefined): T {
    const v = arr[idx ?? -1];
    if (v === undefined) {
      this.fallbackWarn(`styleRow-${tag}`, {
        seededFor: this.seededFor, idx, arrLen: arr.length,
        forestStyles: this.forestStyles, corruptStyle: this.corruptStyle,
        crimsonStyle: this.crimsonStyle, jungleStyle: this.jungleStyle,
        snowStyle: this.snowStyle, hallowStyle: this.hallowStyle,
        mushroomStyle: this.mushroomStyle, desertStyle: this.desertStyle,
        oceanStyle: this.oceanStyle,
      });
      return arr[0];
    }
    return v;
  }

  /** 世界派生随机档（原版 worldgen 期掷骰的运行时重建） */
  private forestStyles: number[] = [];
  private corruptStyle = 0;
  private crimsonStyle = 0;
  private jungleStyle = 0;
  private snowStyle = 0;
  private hallowStyle = 0;
  private mushroomStyle = 0;
  private desertStyle = 0;
  /** 海洋贴图变体档（≈WorldGen.oceanBG style 0-7；seedFor 重建） */
  private oceanStyle = 0;
  private iceBack = 0;
  private jungleBack = 0;
  private hellBack = 0;
  private caveBackX: number[] = [];
  private caveBackStyle: number[] = [];
  private underworldStyle = 0;
  private seededFor = -1;
  /** 地狱多层背景贴图缓存(Underworld_0-13,与 Background_N 分池) */
  private hellImgs = new Map<number, ImageBitmap | HTMLImageElement | null>();
  private hellFrameT = 0;
  private hellImg(n: number): ImageBitmap | HTMLImageElement | null {
    if (n < 0) return null;
    if (this.hellImgs.has(n)) return this.hellImgs.get(n) ?? null;
    loadBitmapOnly(`vanilla/Underworld_${n}.png`, () => this.hellImgs.has(n), (x) => this.hellImgs.set(n, x));
    return null;
  }

  private img(n: number): ImageBitmap | HTMLImageElement | null {
    if (n < 0) return null;
    if (this.imgs.has(n)) return this.imgs.get(n) ?? null;
    loadBitmapOnly(`vanilla/Background_${n}.png`, () => this.imgs.has(n), (x) => this.imgs.set(n, x));
    return null;
  }

  /** 进图前预载出生点场景背景(森林初始风格的山+树 5 张,~47MB 解码)。
   *  Game.preloadSceneAssets 在 onWorldReady 前调用——否则首帧背景图动态加载有闪空 */
  async preloadInitial(world: World): Promise<void> {
    this.seedFor(world);
    const st = FOREST_STYLES[this.forestStyles[0] % FOREST_STYLES.length];
    const ids = [...st.m, ...st.t].filter((n) => n >= 0);
    await this.loadBg(ids);
  }

  /** 群系预测性预热(Game 场景扫描 15 tick 调用):当前群系对应的视差贴图
   *  后台取齐,跨群系旅行不闪空。fire-and-forget */
  warm(scene: SceneFlags): void {
    if (this.seededFor === -1) return; // 尚未播种(preloadInitial/draw 先行),跳过防取错风格
    // ★风格档读取统一走 styleRow 兜底（seedPick 负模数曾致同类崩溃，见类内注记）；
    //   行可能是元组或结构化行——统一经 rowTexIds 拉平成贴图 id 集
    const styles: SurfStyleRow[] = [];
    if (scene.zoneCorrupt) styles.push(this.styleRow('corrupt', CORRUPT_STYLES, this.corruptStyle));
    else if (scene.zoneCrimson) styles.push(this.styleRow('crimson', CRIMSON_STYLES, this.crimsonStyle));
    else if (scene.zoneJungle) styles.push(this.styleRow('jungle', JUNGLE_STYLES, this.jungleStyle));
    else if (scene.zoneSnow) styles.push(this.styleRow('snow', SNOW_STYLES, this.snowStyle));
    else if (scene.zoneHallow) styles.push(this.styleRow('hallow', HALLOW_STYLES, this.hallowStyle));
    else if (scene.zoneGlowshroom) styles.push(this.styleRow('mushroom', MUSHROOM_STYLES, this.mushroomStyle));
    else if (scene.zoneDesert) styles.push(this.activeDesertTriple());
    // 海洋 = 单张 oceanBG 贴图（Step2 far 槽 3，Main.cs:59348-59351）
    else if (scene.zoneBeach) styles.push([this.oceanTexId()]);
    if (!styles.length) return; // 森林已在 preloadInitial 就位
    void this.loadBg(rowTexIds(styles[0]).filter((n) => n >= 0));
  }

  /** 后台加载背景贴图集(去重 + decode 预热) */
  private loadBg(ids: number[]): Promise<void> {
    return Promise.all(ids.map((n) => new Promise<void>((resolve) => {
      if (this.imgs.has(n)) return resolve();
      const im = new Image();
      im.onload = () => {
        // bitmap 就绪才 resolve(2048px 级;失败回退存 Image=永不缺图)
        upgradeToBitmap(im, (b) => { this.imgs.set(n, b); resolve(); }, () => { this.imgs.set(n, im); resolve(); });
        if (!SpriteAtlas.USE_BITMAP) { this.imgs.set(n, im); resolve(); }
      };
      // ★BJ705-G26 件4:终态 onerror 型迟到单发重试（首败不 resolve,重启命中回填）
      lateImageRetryDefer(im, `sprites/vanilla/Background_${n}.png`, () => resolve());
      im.src = `sprites/vanilla/Background_${n}.png`;
    }))).then(() => undefined);
  }

  private seedFor(world: World) {
    if (this.seededFor === world.seed) return;
    this.seededFor = world.seed;
    const s = world.seed >>> 0;
    this.forestStyles = [0, 1, 2, 3].map((i) => seedPick(s, 11 + i, FOREST_STYLES.length));
    this.corruptStyle = seedPick(s, 21, CORRUPT_STYLES.length);
    this.crimsonStyle = seedPick(s, 22, CRIMSON_STYLES.length);
    this.jungleStyle = seedPick(s, 23, JUNGLE_STYLES.length);
    this.snowStyle = seedPick(s, 24, SNOW_STYLES.length);
    this.hallowStyle = seedPick(s, 25, HALLOW_STYLES.length);
    this.mushroomStyle = seedPick(s, 26, MUSHROOM_STYLES.length);
    this.desertStyle = seedPick(s, 27, DESERT_STYLES.length);
    // 海洋（WorldGen.cs:7973 setBG(7, random.Next(8)) 的运行时重建）
    this.oceanStyle = seedPick(s, 28, OCEAN_STYLES.length);
    this.iceBack = seedPick(s, 31, 4);
    this.jungleBack = seedPick(s, 32, 2);
    this.hellBack = seedPick(s, 33, 3);
    // 地狱多层背景风格(WorldGen.cs:7975 setBG(9, Next(3));World.underworldBG 若有存档值优先)
    this.underworldStyle = world.underworldBG || seedPick(s, 34, 3);
    // caveBackX 四段边界（★SW-FX43（2026-09-12）：world.caveBackX 真值优先——
    //  自建=worldgen RandomizeCaveBackgrounds 掷值/导入=.wld 原值（WF:1266-1268）;
    //  旧档缺省按世界宽近似重建）+ 每段基础风格 0..6
    const w = world.store.w;
    this.caveBackX = world.caveBackX?.length === 3 ? [...world.caveBackX]
      : [Math.floor(w * 0.22), Math.floor(w * 0.42), Math.floor(w * 0.65)];
    this.caveBackStyle = [0, 1, 2, 3].map((i) => seedPick(s, 41 + i, 7));
    // ★R16-5（2026-08-24）：存档落盘值优先（WF57 setBG 0-12 随 .wld 头/本仓
    //  SaveData.header.bgStyles 落盘）——导入档/重开档不再按 seed 重掷回默认
    const bg = world.bgStyles;
    if (bg) {
      if (Array.isArray(bg.cave) && bg.cave.length === 4) this.caveBackStyle = [...bg.cave];
      this.iceBack = bg.ice;
      this.jungleBack = bg.jungle;
      this.hellBack = bg.hell;
      this.mushroomStyle = bg.mushroom;
      this.underworldStyle = bg.underworld;
      // ★2026-09-03：desert/ocean 同口径（WF:1330-1331 随 .wld 头落盘）——导入档
      //  不再按 seed 派生重掷（样式4=248/249/250 沙暴巨丘档随档保真）。本仓自建
      //  世界无此字段 → 走上方 seedPick 派生，行为零变化
      if (typeof bg.desert === 'number') this.desertStyle = bg.desert;
      if (typeof bg.ocean === 'number') this.oceanStyle = bg.ocean;
      // ★同批：森林四区 + 侵染四档（WF:1325-1329 treeBG1-4/corrupt/snow/hallow/
      //  crimson）——原版背景样式是"启动掷骰、创世界时随档保存"（RandomizeBackgrounds
      //  仅在 Main.LoadContent/菜单调用，世界生成不掷），种子不决定背景 → 导入档
      //  必须随档保真才与原版档观感一致
      if (Array.isArray(bg.forest) && bg.forest.length === 4) this.forestStyles = [...bg.forest];
      if (typeof bg.corrupt === 'number') this.corruptStyle = bg.corrupt;
      if (typeof bg.snow === 'number') this.snowStyle = bg.snow;
      if (typeof bg.hallow === 'number') this.hallowStyle = bg.hallow;
      if (typeof bg.crimson === 'number') this.crimsonStyle = bg.crimson;
    }
  }

  /** GetPreferredBGStyleForPlayer :63658-63705 优先级链 */
  preferredStyle(scene: SceneFlags, tileX: number): number {
    if (scene.zoneBeach) {
      return scene.zoneHallow ? Hallow : scene.zoneCorrupt ? Corruption
        : scene.zoneCrimson ? Crimson : Ocean;
    }
    if (scene.zoneGlowshroom) return Mushroom;
    if (scene.zoneDesert) {
      return scene.zoneCorrupt ? CorruptDesert : scene.zoneCrimson ? CrimsonDesert
        : scene.zoneHallow ? HallowDesert : Desert;
    }
    if (scene.zoneHallow) return Hallow;
    if (scene.zoneCorrupt) return Corruption;
    if (scene.zoneCrimson) return Crimson;
    if (scene.zoneJungle) return Jungle;
    if (scene.zoneSnow) return Snow;
    const treeX = this.caveBackTreeX ?? [0, 0, 0];
    if (tileX >= treeX[0]) return tileX < treeX[1] ? Forest2 : tileX >= treeX[2] ? Forest4 : Forest3;
    return Forest1;
  }
  private caveBackTreeX: number[] | null = null;

  /** Main.bgAlphaFrontLayer[style] 等价读数（只读引用；AmbientSky.GetColor 六族乘子等
   *  下游消费源）。槽语义 = Main.cs:58951-59030，与上方 bgStyle 常量表一致。
   *  （AmbientSky 实体与背景层共用同一渐变态，避免双状态机漂移。） */
  frontLayer(): ArrayLike<number> {
    return this.alphaFront;
  }

  /** mod 面样式探针（lights-and-shadows 消费）：Main.snowBG[0]/desertBG[0] 等价
   *  ——活动样式行三元组首元。雪原 t 首元 258/263/267=原版 mod 日光白化判定档；
   *  沙漠 p 首元 248=沙暴巨丘档（沙暴时阴影提取关断）。仅读种子样式；zone/槽
   *  门控由消费方（mod 端按 zone 旗）负责。非沙漠槽 desert0=-1。 */
  styleProbe(): { snow0: number; desert0: number } {
    const snow = this.styleRow('snow', SNOW_STYLES, this.snowStyle);
    const desertSlot = this.bgStyle === Desert || this.bgStyle === CorruptDesert
      || this.bgStyle === HallowDesert || this.bgStyle === CrimsonDesert;
    return {
      snow0: snow?.t?.[0] ?? -1,
      desert0: desertSlot ? this.desertTripleForSlot(this.bgStyle)[0] : -1,
    };
  }

  /** 样式快照（CaptureMode 手动群系档专用，2026-08-25）：样式直落 + 双 alpha 槽
   *  全开 + 冷却/渐变/瞬切计数清零——拍照分块重渲跨数帧，走正常交叉淡化
   *  （±0.05/帧）会拍到半透明中间态；原版 DrawCapture 直接改 Main.bgStyle 无
   *  过渡态，此处对齐该语义。★贴图未预热时该样式层为空 = 天空层空洞（全黑
   *  出图根因）→ 内联 warmStyle 预热（幂等,已载秒回）；调用方宜在【选择时刻】
   *  先行 warm（用户选格到按快门有数秒余裕），此处兜底。 */
  snapStyle(style: number): void {
    this.bgStyle = style;
    this.bgDelay = 0;
    this.instantBG = 0;
    // （lastFlashStyle 已随 2026-10-03 触发链摘除——快照/槽切换本就不点火,
    //   原版点火源=变体旗实变,见 update() 注与 setBiomeVariant）
    this.alphaFront.fill(0);
    this.alphaFar.fill(0);
    this.alphaFront[style] = 1;
    for (const s of this.farSlotsForStyle(style)) this.alphaFar[s] = 1;   // 远山槽随 :65123 映射
    this.warmStyle(style);
  }

  /** ★BJ103-A1b（2026-09-16）：传送黑幕面地表背景瞬切（BlackFadeCameraTeleport 内
   *  instantBGTransitionCounter=10 + bgDelay=0 + bgStyle=GetPreferredBGStyleForPlayer,
   *  Main.cs:63513/:63519-63521）。本仓等价面：计数置 10（update() 既有消费位
   *  instantBG>0 → bgStyle=want + speed=1 一帧吸合）+ bgDelay 清零;bgStyle 本体不在此
   *  直写——want 由 update() 的 preferredStyle(scene,centerTileX) 推导（scene 旗标已由
   *  Game 远距面强制重扫,UpdateBiomesIfMovedEnoughForBlackFade Player.cs:16788-16794
   *  等价）,直写会绕过 flash 登记与沙漠侵染列解析。调用方=Game.blackFadeCameraTeleport。 */
  instantBGTransition(): void {
    this.bgDelay = 0;
    this.instantBG = 10;
  }

  /** 拍照群系档贴图预热：style(0-14) → 该风格贴图 id 集 → loadBg（变体取当前
   *  世界掷定的 corruptStyle/jungleStyle 等，与 draw 解析同表同变体）。
   *  ★终清波：行可能是结构化行（雪 m/t 山+树、沙漠 p/c/h/r 四列）——统一经
   *  槽位解析口 surfRowTexIds（含当前 bgStyle 对应的沙漠侵染列选择）。 */
  warmStyle(style: number): void {
    let row: SurfStyleRow | null = null;
    if (style === Forest1 || style === Forest2 || style === Forest3 || style === Forest4) {
      const st = this.styleRow('warm-forest', FOREST_STYLES, this.forestStyles[0] % FOREST_STYLES.length);
      row = { m: st.m, t: st.t };
    } else if (style === Corruption) row = this.styleRow('corrupt', CORRUPT_STYLES, this.corruptStyle);
    else if (style === Crimson) row = this.styleRow('crimson', CRIMSON_STYLES, this.crimsonStyle);
    else if (style === Jungle) row = this.styleRow('jungle', JUNGLE_STYLES, this.jungleStyle);
    else if (style === Snow) row = this.styleRow('snow', SNOW_STYLES, this.snowStyle);
    else if (style === Hallow) row = this.styleRow('hallow', HALLOW_STYLES, this.hallowStyle);
    else if (style === Mushroom) row = this.styleRow('mushroom', MUSHROOM_STYLES, this.mushroomStyle);
    else if (style === Desert) row = this.activeDesertTriple();
    else if (style === Ocean) row = [this.oceanTexId()];
    const clean = (row ? rowTexIds(row) : []).filter((n) => n >= 0);
    if (clean.length) void this.loadBg(clean);
  }

  // ---- 世界球 4766 重掷消费口（孤儿武器 B3 波 2026-08-30）----
  // 原版 WorldGen.RandomizeBackgroundBasedOnPlayer（WorldGen.cs:7742-7895）直接
  // 写 WorldGen.corruptBG/jungleBG/…（WorldGen.setBG → Main.bgStyle 数据位），本仓
  // 变体散在私有字段且由 seedFor(seed) 只挑一次——公共 setter 承担【运行时重掷】
  // 的唯一入口。
  // ★B3-5 重掷值域 → 终清波收编（2026-09）：B3-5 时本仓各 STYLES 表是 vanilla
  // 值域子集且行号≠样式号（雪 42%6=0、森林 9%7=2 会把「必异」折回原档）,故当时
  // 把重掷池压成可行域（biomeVariantRows 行空间 + rollVariantInDomain 先过滤再掷）。
  // 本批已把全部群系表扩到与 setBG 可行值域一一对应（见各表头注记），可行域机制
  // 与【域内必异】语义原样保留，同族门换成 sameVisual() 行空间翻译
  // （IsBackgroundConsideredTheSame :8010：森林族 3↔31/5↔51/7↔71↔72↔73；
  // 其余群系原版本就严格同值门）；setBiomeVariant 的取模钳仍是防御兜底（存档脏值）。

  /** 变体表长单点（setBiomeVariant 取模钳/biomeVariantRows 同源——扩缩 STYLES 表
   *  两处自动随动,零另行登记）。kind 兼收 'forest'（四段共用 FOREST_STYLES 行域）。
   *  underworld=-1 哨兵：无 surface 行表（drawHellLayers SETS 三档直用,不取模不钳）。 */
  private variantTableLen(kind:
    | 'corrupt' | 'crimson' | 'jungle' | 'snow' | 'hallow'
    | 'mushroom' | 'desert' | 'ocean' | 'underworld' | 'forest'
    | 'forest0' | 'forest1' | 'forest2' | 'forest3'): number {
    return (kind === 'corrupt') ? CORRUPT_STYLES.length
      : (kind === 'crimson') ? CRIMSON_STYLES.length
      : (kind === 'jungle') ? JUNGLE_STYLES.length
      : (kind === 'snow') ? SNOW_STYLES.length
      : (kind === 'hallow') ? HALLOW_STYLES.length
      : (kind === 'mushroom') ? MUSHROOM_STYLES.length
      : (kind === 'desert') ? DESERT_STYLES.length
      : (kind === 'ocean') ? OCEAN_STYLES.length
      : (kind === 'underworld') ? -1   // 地狱无 surface 行表（3 档静态）
      : FOREST_STYLES.length;
  }

  /** 变体可行域 = 表长展开成 [0..len-1] 行号列表（世界球重掷池来源,B3-5:
   *  styleRerolls.rollVariantInDomain 消费；forest 槽传 'forest' 共用一池）。
   *  underworld 无行表但 drawHellLayers SETS[0..2] 三档全可行,给 [0,1,2]
   *  （同 seedPick(s,34,3)/vanilla Next(3) 域）。 */
  biomeVariantRows(kind:
    | 'corrupt' | 'crimson' | 'jungle' | 'snow' | 'hallow'
    | 'mushroom' | 'desert' | 'ocean' | 'underworld' | 'forest'
    | 'forest0' | 'forest1' | 'forest2' | 'forest3'): number[] {
    const len = this.variantTableLen(kind);
    return Array.from({ length: len < 0 ? 3 : len }, (_, i) => i);
  }

  /** 读当前变体（Game 侧重掷的 oldVal 来源，等同 vanilla corruptBG/jungleBG/…直读） */
  biomeVariant(kind:
    | 'corrupt' | 'crimson' | 'jungle' | 'snow' | 'hallow'
    | 'mushroom' | 'desert' | 'ocean' | 'underworld' | 'forest0'
    | 'forest1' | 'forest2' | 'forest3'): number {
    switch (kind) {
      case 'corrupt': return this.corruptStyle;
      case 'crimson': return this.crimsonStyle;
      case 'jungle': return this.jungleStyle;
      case 'snow': return this.snowStyle;
      case 'hallow': return this.hallowStyle;
      case 'mushroom': return this.mushroomStyle;
      case 'desert': return this.desertStyle;
      case 'ocean': return this.oceanStyle;
      case 'underworld': return this.underworldStyle;
      default: return this.forestStyles[kind === 'forest0' ? 0 : kind === 'forest1' ? 1 : kind === 'forest2' ? 2 : 3] ?? 0;
    }
  }

  /** 写变体并预热（clamp 后）新档贴图行——若当前 bgStyle 正落在此群系槽则下帧
   *  即取新行渲染；跨槽无效（update() 会在进入该群系时自动过渡,同原版语义）。
   *  返回 clamp 后实际写入值；越界传入时取模落界（不产死循环）——★B3-5 起重掷
   *  正路已在可行域内掷出,此取模仅作防御兜底(存档脏值等),不再是值域治理手段。 */
  setBiomeVariant(kind:
    | 'corrupt' | 'crimson' | 'jungle' | 'snow' | 'hallow'
    | 'mushroom' | 'desert' | 'ocean' | 'underworld' | 'forest0'
    | 'forest1' | 'forest2' | 'forest3', value: number): number {
    const tableLen = this.variantTableLen(kind);
    let v = value;
    if (tableLen >= 0 && tableLen > 0) v = ((v % tableLen) + tableLen) % tableLen;
    // ★原版点火链（2026-10-03 云山瞬闪案定谳刀）：变体旗【实变】才 flash[area]=1
    //   （BackgroundChangeFlashInfo.UpdateVariation :25-33 `if (num != newVariationValue)
    //   ValueChanged(areaId)`）。kind→area 同 UpdateCache :16-29 槽序（0-3=treeBG1-4、
    //   4=corrupt…12=underworld）；遮罩画位 = drawSurface 逐槽内联（BJ372 判例）。
    //   调用点 = 天柱死亡重掷（Game 869 链）——bgStyle 槽切换不再是点火源。
    let changed = false;
    switch (kind) {
      case 'corrupt': changed = this.corruptStyle !== v; this.corruptStyle = v; break;
      case 'crimson': changed = this.crimsonStyle !== v; this.crimsonStyle = v; break;
      case 'jungle': changed = this.jungleStyle !== v; this.jungleStyle = v; break;
      case 'snow': changed = this.snowStyle !== v; this.snowStyle = v; break;
      case 'hallow': changed = this.hallowStyle !== v; this.hallowStyle = v; break;
      case 'mushroom': changed = this.mushroomStyle !== v; this.mushroomStyle = v; break;
      case 'desert': changed = this.desertStyle !== v; this.desertStyle = v; break;
      case 'ocean': changed = this.oceanStyle !== v; this.oceanStyle = v; break;
      case 'underworld': changed = this.underworldStyle !== v; this.underworldStyle = v; break;
      default: {
        const fi = kind === 'forest0' ? 0 : kind === 'forest1' ? 1 : kind === 'forest2' ? 2 : 3;
        changed = this.forestStyles[fi] !== v; this.forestStyles[fi] = v; break;
      }
    }
    if (changed) {
      const areaOfKind: Record<typeof kind, number> = {
        forest0: 0, forest1: 1, forest2: 2, forest3: 3,
        corrupt: 4, jungle: 5, snow: 6, hallow: 7, crimson: 8,
        desert: 9, ocean: 10, mushroom: 11, underworld: 12,
      };
      this.bgFlash[areaOfKind[kind]] = 1;
    }
    // 当前可见槽对应群系才预热（warmStyle 幂等,已载秒回）：
    // underworld 不属 bgStyle 槽系（随 pickUnderground/地下带走 ug 渠道）,跳过。
    if (kind !== 'underworld') {
      const styleForKind: Partial<Record<typeof kind, number>> = {
        corrupt: Corruption, crimson: Crimson, jungle: Jungle, snow: Snow,
        hallow: Hallow, mushroom: Mushroom, desert: Desert, ocean: Ocean,
        forest0: Forest1, forest1: Forest2, forest2: Forest3, forest3: Forest4,
      };
      const slot = styleForKind[kind];
      if (slot !== undefined && this.bgStyle === slot) this.warmStyle(slot);
    }
    return v;
  }

  /** 每帧状态推进：风格切换延迟 + alpha 渐变（UpdateBGVisibility ±0.05/帧，:63534/:63594） */
  update(world: World, scene: SceneFlags, dtMs: number,
    geom?: { centerTileX: number; topTileY: number; bottomTileY: number }) {
    this.seedFor(world);
    if (!this.caveBackTreeX) {
      // 森林四段边界：原版用 treeX[0..2]（WorldGen 生成）；优先用 world.treeX
      this.caveBackTreeX = world.treeX?.length === 3 ? world.treeX : [
        Math.floor(world.store.w * 0.25), Math.floor(world.store.w * 0.5), Math.floor(world.store.w * 0.75),
      ];
    }
    const frames = dtMs / (1000 / 60);
    // 地表风格过渡全链（DrawBG :63438-63449 + HandleBackgroundTransition :63508-63527）：
    // ① bgDelay<0 = 负冷却：计数归零期间锁风格（:63440-63442），防边界来回抖动
    // ② 森林→森林且两段 WorldGen 生成背景相同（treeStyle 相等）→ 瞬切
    //    （:63510-63520 instantBGTransitionCounter=1 + transitionSpeed=1 一帧吸合；
    //    曾缺 = 跨 treeX 段界多走 20 帧交叉渐变 = 用户实报"衔接有问题"）
    // ③ 等待帧数：新风格是森林 60 帧、否则 30（:63522 num = flag2?60:30——曾恒 30）
    // ④ 切换后：进森林 bgDelay=0 无冷却；否则 -60 负冷却 60 帧（:63524-63527，曾缺）
    // ⑤ 等待期回摆：preferred 折返时 bgDelay 逐帧衰减而非清零（:63443-63444）
    const want = this.preferredStyle(scene, geom?.centerTileX ?? scene.tileX);
    let speed = 0.05;
    const isForestStyle = (st: number) => st === Forest1 || st === Forest2 || st === Forest3 || st === Forest4;
    if (this.bgDelay < 0) {
      this.bgDelay = Math.min(0, this.bgDelay + frames);
    } else if (want !== this.bgStyle) {
      if (isForestStyle(this.bgStyle) && isForestStyle(want)
        && this.forestBgId(world, this.bgStyle) === this.forestBgId(world, want)) {
        this.instantBG = 2;   // 瞬切（原 counter=1；帧率浮动保险 2 帧，speed=1 吸合）
      } else {
        this.bgDelay += frames;
        const num = isForestStyle(want) ? 60 : 30;
        if (this.bgDelay > num) {
          this.bgDelay = isForestStyle(want) ? 0 : -60;
          this.bgStyle = want;
        }
      }
    } else if (this.bgDelay > 0) {
      this.bgDelay = Math.max(0, this.bgDelay - frames);
    }
    if (this.instantBG > 0) {
      this.instantBG--;
      this.bgStyle = want;
      speed = 1;
    }
    // BackgroundChangeFlashInfo（BackgroundChangeFlashInfo.cs）：黑闪点火源 =
    // 【WorldGen 群系背景变体旗实变】（UpdateVariation :25-33 值变才 ValueChanged
    // →flashPower[area]=1）。运行时唯一玩法内触发点 = 天柱死亡重掷
    // （Projectile.cs:75125 type 869 → WorldGen.RandomizeBackgroundBasedOnPlayer
    // :7742-7895 尾 UpdateCache）+ 世界生成期（被加载屏盖住）。
    // bgStyle 槽切换（含高空飞行跨场景旗翻转）【不点火】——原版该处只有
    // bgAlphaFrontLayer/alphaFar 交叉淡化（UpdateBGVisibility :65059/:65117）。
    // 曾错接「样式落定即 flash」= 上下飞每跨一次地表↔天空场景旗界就全屏黑闪
    // 覆写塔天/远景一组层（2026-10-03 用户实报「四柱区远景云山瞬闪消失露纯背景」
    // 定谳刀：探针 _pillar-flash-repro.mjs 闪帧全量态实证 flash=1 帧(glCanvas
    // 亮度 114.8→17.3)与 merged→split/farDeferGate→0 路径连翻同帧)。
    // 衰减照旧（UpdateFlashValues :31-37）;点火点移 setBiomeVariant（变体旗写点,
    // 与原版 UpdateVariation 同语义）。
    for (let i = 0; i < this.bgFlash.length; i++) {
      this.bgFlash[i] = Math.max(0, this.bgFlash[i] - 0.05 * frames);   // UpdateFlashValues :31-37
    }
    // 前景层 alpha（UpdateBGVisibility_FrontLayer :63534-63551）：升 0.05/帧；
    // 降侧有沙漠变体互换豁免（:63566-63582 IsDesertVariantSwap {2,5,13,14}）——
    // 新沙漠变体未到 1 前旧变体 alpha 持平（防跨腐化/猩红沙漠行走时的暗闪）
    for (let l = 0; l < 16; l++) {
      const target = l === this.bgStyle ? 1 : 0;
      if (target === 1) {
        this.alphaFront[l] = Math.min(1, this.alphaFront[l] + speed * frames);
      } else if (this.alphaFront[l] !== 0) {
        const dvSwap = (this.bgStyle === 2 || this.bgStyle === 5 || this.bgStyle === 13 || this.bgStyle === 14)
          && (l === 2 || l === 5 || l === 13 || l === 14) && l !== this.bgStyle;
        if (!dvSwap || this.alphaFront[this.bgStyle] < 1) {
          this.alphaFront[l] = Math.max(0, this.alphaFront[l] - speed * frames);
        }
      }
    }
    // 远山层 alpha（UpdateBGVisibility_BackLayer :65123-65188 bgStyle→far 槽映射 1:1——
    // ★非同号：Desert→1、Corruption 系（1/5/13/14）→2、Ocean→3、Snow→4、Crimson→5、
    // Hallow→6（世界神圣档≠3 则 2）、Jungle→0（jungleBG 档 5 则 15）、Mushroom→{0,6}、
    // 森林四段→同号。同槽共管效应：森林↔丛林↔蘑菇共用槽 0 = 远山不淡出（原版同相）；
    // 丛林档 5 落槽 15（Step1/2 无该槽绘制）= 远山照常淡出）
    const farSlots = this.farSlotsForStyle(this.bgStyle);
    for (let l = 0; l < 16; l++) {
      const target = farSlots.includes(l) ? 1 : 0;
      // 坡速随 backgroundLayerTransitionSpeed（DrawBG_ModifyBGFarBackLayerAlpha
      // :65236 value=speed——instant 帧 speed=1 远山同拍吸合）
      this.alphaFar[l] += target > this.alphaFar[l] ? Math.min(speed * frames, target - this.alphaFar[l]) : Math.max(-speed * frames, target - this.alphaFar[l]);
    }
    // 地下风格（:52245-52249：变更时新旧并行，ugBackTransition -= 0.25/帧）
    const ugWant = this.pickUnderground(world, scene, geom);
    if (ugWant !== this.ugStyle) {
      this.ugOld = this.ugStyle;
      this.ugStyle = ugWant;
      this.ugAlpha = 0;
    }
    this.ugAlpha = Math.min(1, this.ugAlpha + frames * 0.25);
  }

  /** DrawBackground_PickUndergroundBackgroundStyle :53454-53540。
   *  ★采样 = 屏幕中心 tile（:53456 num，同地表森林分段）；雪深门 = 屏底+1200px
   *  （:53471）；深岩带 = 屏顶 tile（:53487 screenPosition.Y/16）——曾全用玩家 */
  private pickUnderground(world: World, scene: SceneFlags,
    geom?: { centerTileX: number; topTileY: number; bottomTileY: number }): number {
    const x = geom?.centerTileX ?? scene.tileX;
    const topTileY = geom?.topTileY ?? scene.tileY;
    const bottomTileY = geom?.bottomTileY ?? scene.tileY;
    const w = world.store.w;
    const segIdx = x <= this.caveBackX[0] ? 0 : x <= this.caveBackX[1] ? 1 : x > this.caveBackX[2] ? 3 : 2;
    if (this.caveBackStyle[segIdx] === undefined) {
      this.fallbackWarn('caveBack', { seed: world.seed, seededFor: this.seededFor, segIdx, x, caveBackStyle: this.caveBackStyle });
    }
    let style = this.caveBackStyle[segIdx] ?? 0;
    style += 3;
    // 雪原洞穴（:53470-53473：SnowTileCount>Threshold（=zoneSnow） &&
    // (屏底+1200px)/16 < maxTilesY−250——锚=屏底非玩家，且无地表下限门）
    if (scene.zoneSnow && bottomTileY + 75 < world.store.h - 250) style = 1;
    // 丛林洞穴（:53474-53483）：雪洞内须 JungleTileCount>SnowTileCount 才让位
    // （雪/丛林边界雪洞保持），非雪洞无条件——曾无条件覆盖=雪洞被丛林抢
    if (scene.zoneJungle) {
      if (style === 1) {
        if (scene.jungleTileCount > scene.snowTileCount) style = 11;
      } else {
        style = 11;
      }
    }
    // 沙滩地下
    if (scene.zoneBeach) {
      style = scene.zoneCorrupt ? 19 : scene.zoneCrimson ? 21 : scene.zoneHallow ? 20 : 18;
    } else if (topTileY > world.rockLevel + 60 && topTileY < (world.lavaLine || world.store.h - 200) - 60) {
      if (scene.zoneSnow) style = scene.zoneCorrupt ? 15 : scene.zoneCrimson ? 16 : scene.zoneHallow ? 17 : style;
      else if (scene.zoneCorrupt) style = 12;
      else if (scene.zoneCrimson) style = 13;
      else if (scene.zoneHallow) style = 14;
    }
    if (scene.zoneGlowshroom) style = 2;
    return style;
  }

  /** 主绘制：插在 sky.draw 之后、世界变换之前（屏幕空间）。
   *  target = 2D ctx(旧路径)或 BGBlit(GL 路径,docs/webgl2-migration-plan.md #1) */
  draw(
    target: CanvasRenderingContext2D | BGBlit, world: World, scene: SceneFlags,
    cam: Cam, viewW: number, viewH: number, tint: [number, number, number], dtMs: number,
    /** 渲染相位(2026-08-20 地下背景光照修复):surface=只画地表层(主画布,天空
     *  侧,cots 染);underground=只画地下层(★须画进 Renderer 世界层=被光照图乘
     *  ——原版 Main.cs:52327 起地下背景逐 16px 段 Lighting.GetColor 点亮,暗段
     *  跳过/部分亮段 9-slice 渐变,与屏空间 lightCanvas 乘法等价;曾画主画布
     *  =worldLayer 分层后不吃光,洞里恒亮且与时间无关)。缺省两者都画(旧序) */
    phase: 'all' | 'surface' | 'underground' = 'all',
  ) {
    const b: BGBlit = typeof (target as BGBlit).img === 'function'
      ? (target as BGBlit) : new CanvasBgBlit(this, target as CanvasRenderingContext2D);
    // Main.screenPosition 语义 = 屏幕【左上角】的世界坐标 = 中心 - 半屏/zoom。
    // ★曾写 `cam.y - viewH/2/1`——/1 是缩放占位符：zoom 1.25 下屏顶世界 Y 差
    // viewH/2×(1-1/zoom) ≈ 86px，num3 偏大 → bgTopY = num3×topA+topB 整体
    // 下移 ~40px = 用户实报"远景背景图 Y 轴偏下"根因（2026-08-19）
    const camTopY = cam.y - viewH / 2 / cam.zoom;
    const camLeftX = cam.x - viewW / 2 / cam.zoom;
    // ★采样几何（原版双轨）：森林四段分界/地下 caveBack 分段 =【屏幕中心】tile
    // （GetPreferredBGStyleForPlayer :63664 num2、PickUndergroundBackgroundStyle
    // :53456 num——均 (screenPosition.X+screenWidth/2)/16）；群系 zone 判定 =
    // 玩家中心（SceneMetrics 169×124 窗口）。曾全用玩家 tile=半屏 ~30 格偏差
    const geom = {
      centerTileX: Math.floor(cam.x / 16),
      topTileY: Math.floor(camTopY / 16),
      bottomTileY: Math.floor((camTopY + viewH / cam.zoom) / 16),
    };
    // ★update 每帧只吃一次真实 dt：surface 相位调用已推进（Renderer 传 16.7），
    //   underground 相位调用只为画带层+推进动画钟（magmaFrameT/hellFrameT/bgTick，
    //   见 drawUnderground/drawHellLayers）——若这里再吃全量 dt = 风格过渡/flash/
    //   alpha 坡道每帧双倍推进（0.05/帧坡道变 0.1/帧）。
    //   ★BJ204（2026-09-20，BJ175 债①清算）：remix 世界 surface 相位被 Renderer
    //   整层跳过（IIIII224，锚 Main.cs:60573 ShouldDrawSurfaceBackground——原版门
    //   只摘地表层绘制，地下风格推进 DrawBackground :53638-53650 每帧照跑无 remix
    //   门）→ update 的每帧单次推进在 remix 下唯一承接着落 underground 相位：
    //   传真实 dt（Renderer :3857 恒 16.7）；非 remix 恒 0 = 逐位不变。
    //   remix 恒跳 surface ⇒ 不存在双推进组合（两处置同源 seedFlags.remix）。
    this.update(world, scene,
      phase === 'underground' ? (world.seedFlags?.remix ? dtMs : 0) : dtMs, geom);
    // ★2026-10-03 山层闪烁定谳：此门系误植，摘除。原版 DrawSurfaceBG【无相机深度
    //  门】——Main.cs:57700(DrawBackground)/:65016(DrawBG) 无条件调用，
    //  ShouldDrawSurfaceBackground(:60568) 只判 remix/mapFullscreen；地表层靠
    //  bgTopY 视差（num3=-(screenPosition.Y-300)/(worldSurface*16)）随相机下深
    //  自然上滚出屏。`screenPosition.Y < worldSurface*16+16` 门属
    //  DrawClouds_Closest(:59073)（近云）与星星(:57693)/日月(:57697)，各归其位。
    //  误植后果：屏顶越过 worldSurface*16+16（=相机中心约 ws+26 格）瞬间整组
    //  地表层硬切消失，而视差此刻只上滚了 ~100px 级（近层仍在屏内）→ 塔位跨
    //  地表线（LunarEvent 落位=自 worldSurface 向上找 36 格空窗，塔战高度恰在
    //  门线附近抖动）→ 山层有无逐帧交替=用户实报「星璇柱区背景山闪烁」
    //  （#72/#73；高度相关；F9/光照无关——地表层不吃光照）。修=恒画（remix 门
    //  仍在 Renderer 侧 remixSkipSurfaceBg），层内整层出屏 cull 补深度帧性能。
    if (phase !== 'underground') {
      this.drawSurface(b, world, cam, camTopY, camLeftX, viewW, viewH, tint);
    }
    if (phase !== 'surface') {
      this.drawUnderground(b, world, cam, camTopY, viewW, viewH, dtMs);
    }
  }

  // ---- 地表层 ----
  private drawSurface(
    b: BGBlit, world: World, cam: Cam,
    camTopY: number, camLeftX: number, viewW: number, viewH: number, tint: [number, number, number],
  ) {
    this.seedFor(world); // 兜底：即便 update 未先行播种也不崩（HMR/首帧边界）
    // 垂直视差系数（DrawSurfaceBG :60256：num3 = -(screenPosition.Y-300)/(worldSurface*16)）
    const num3 = -(camTopY - 300) / (world.groundLevel * 16);
    // scAdj(DrawBG :64941 ComputeScAdj)：世界深度视差补偿——
    // num=worldSurface·16/(screenY+screenH),k=max((maxTilesY·0.15·16−screenY)·
    // 0.00025,0)²,按世界高度档 ×(−500/−300/−150)。screenY=屏顶世界 Y。
    const worldH = world.store?.h ?? 1200;   // 无 store(桩)按小世界档
    const screenHworld = viewH / cam.zoom;   // 世界像素屏高
    const scNum = (world.groundLevel * 16) / Math.max(1, camTopY + screenHworld);
    let scK = (worldH * 0.15 * 16 - camTopY) * 0.00025;
    if (scK < 0) scK = 0;
    const scAdj = scNum * (0.45 - scK * scK)
      * (worldH <= 1200 ? -500 : worldH <= 1800 ? -300 : -150);
    // pushBGTopHack（DrawSurfaceBG :60236-60252）：in-game 恒 30（drunkWorldGen 内
    // onlyShimmerOcean −240 / vampireSeed −100 / !notTheBees −180——秘密种子未实装）
    const sfSeed = world.seedFlags ?? {};
    const pushHack = sfSeed.drunkWorld
      ? (sfSeed.vampireSeed ? -100 : !sfSeed.notTheBees ? -180 : 30)
      : 30;
    const [tr0, tg0, tb0] = tint;
    const tintOn: readonly [number, number, number] | null
      = tr0 >= 0.999 && tg0 >= 0.999 && tb0 >= 0.999 ? null : [tr0, tg0, tb0];
    // ★num4 = 2（DrawSurfaceBG :60259 无条件 bgGlobalScaleMultiplier）——全部表面层
    // scale ×2。曾漏乘 = 图层只有原版一半,树/山层底缘悬在屏内,飞高或站高处底部
    // 露天空底色（2026-08-25 用户实报"底部远景露馅,原版不会"）。
    // 层解析序 = 原版各函数序：函数头默认档 → SET_BG 覆盖 → TOP_RESET 绝对重置
    // → nudge/YOffset → scAdj/pushHack。
    const drawLayer = (
      tex: number, dS: number, dP: number, dA: number, dB: number, alpha: number,
      opt: { yoff?: boolean; anim?: boolean; flip?: boolean; nudge?: number } = {},
    ): void => {
      if (alpha <= 0.01 || tex < 0) return;
      const ov = SET_BG[tex];
      const scale = (ov?.[0] ?? dS) * 2;          // ×num4（:60259）
      const par = ov?.[1] ?? dP;
      const rst = SURF_TOP_RESET[tex];
      const topA = rst?.[0] ?? ov?.[2] ?? dA;
      const topB = rst?.[1] ?? ov?.[3] ?? dB;
      let im = this.img(tex);
      if (!im || !texReady(im)) return;
      // Forest[0] tex 173 四帧轮换（:62289-62296：counter/10%4 → Background[251+frame]）
      if (tex === 173) {
        im = this.img(251 + (Math.floor(this.bgTick / 10) % 4)) ?? im;
      }
      // GetBackgroundRect（:62164-62199）：2×2 帧表 Frame(2,2,col,row)+Inflate(0,-2)；
      // 帧距 = 整表宽×scale（bgWidthScaled 语义），帧绘制尺寸 = 半表×scale
      let sx = 0, sy = 0, sw = im.width, sh = im.height;
      const period = opt.anim ? BG_SHEET[tex] : undefined;
      if (period !== undefined) {
        const f = Math.floor(this.bgTick / period) % 4;
        sw = im.width >> 1; sh = im.height >> 1;
        sx = (f % 2) * sw; sy = Math.floor(f / 2) * sh + 2; sh -= 4;
      }
      if (opt.flip) im = this.flippedOf(im);
      // ★平铺步进 = 绘制帧宽×scale（sw:动画层=半表帧宽,静态层=整表）——曾用
      //   im.width×scale:动画层 stride=绘制宽 2 倍 → 每两块间空 50% 露天
      //   （2026-08-25 用户报丛林远景"接续露馅";森林树层同病被树间隙观感掩盖）
      const wScaled = sw * scale;
      // 横向视差锚 = 屏幕左缘（:61151 bgStartX = -IEEERemainder(screenX×par,w)-w/2
      // -w——多退一整块配 +3 档 loops 保屏）
      const startX = -BiomeBackground.ieeeRemOf(camLeftX * par, wScaled) - wScaled / 2 - wScaled;
      const loops = Math.ceil(viewW / wScaled) + 3;
      const topY = num3 * topA + topB + (opt.nudge ?? SURF_NUDGE[tex] ?? 0)
        + (opt.yoff ? (LAYER_YOFF[tex] ?? 0) : 0) + scAdj + pushHack;
      const dw = sw * scale + 1;   // +1px 保险重叠（浮点视差接缝,既有约定）
      const dh = sh * scale;
      // ★整层出屏 cull（2026-10-03 随深度门摘除配套;纯性能无视觉差）:视差已把整层
      //  滚出视口（topY≥viewH=层顶在屏底之下 / topY+dh≤0=层底在屏顶之上）时跳过
      //  全部平铺 blit——原深度门时代深层帧零 blit 的成本面由此承接。
      if (!(dh > 0) || topY >= viewH || topY + dh <= 0) return;
      // 帧动画子区经 opts.src 走 tint 烘焙路径的子区取样（GL 路径 quad 本就按源矩形采样）
      const sub = sx !== 0 || sy !== 0 || sw !== im.width || sh !== im.height;
      const opts = { alpha, tint: tintOn,
        ...(sub ? { src: [sx, sy, sw, sh] as [number, number, number, number] } : {}) };
      for (let i = 0; i < loops; i++) {
        b.img(im, sx, sy, sw, sh, startX + i * wScaled, topY, dw, dh, opts);
      }
    };
    // ---- cloudBG 大云图双层（Main.cs :60280-60375，Background 112/113）----
    // 门 = cloudBGAlpha>0（累积器 cloudBGActive>0 时 +0.0005·dayRate/t 否则 −，钳
    // 0..1；门 = !drunkWorld && camTop ≤ worldSurface+10 tile——阴天/雨雪天渐显的
    // 大云幕，晴天恒 0 不画）。层0 = Background 112：scale1.65 / par0.09 / topY=
    // num3·900+600 / α=min(1,α累积)；层1 = Background 113：scale1.85 / par0.12 /
    // topY=num3·1100+750 / α=min(1,α累积×1.5)。风漂移 cloudBGX += wind×par×9×dayRate
    // （:60268 AllowSkyMovement 游戏内恒真），wrap ±w·scale。
    {
      const wr = world.weather;
      const dayRate = world.dayRate?.() ?? 1;
      const camTopTiles = camTopY / 16;
      if (!(world.seedFlags?.drunkWorld) && camTopTiles <= world.groundLevel + 10) {
        this.cloudBGAlpha = wr && wr.cloudBGActive > 0
          ? Math.min(1, this.cloudBGAlpha + 0.0005 * dayRate)
          : Math.max(0, this.cloudBGAlpha - 0.0005 * dayRate);
      }
      if (this.cloudBGAlpha > 0) {
        const atmo = atmoOf(cam.y, world.w, world.groundLevel);
        const wind = wr?.windSpeedCurrent ?? 0;
        const sheets = [
          { tex: 112, scale: 1.65, par: 0.09, topA: 900, topB: 600, aMul: 1 },
          { tex: 113, scale: 1.85, par: 0.12, topA: 1100, topB: 750, aMul: 1.5 },
        ] as const;
        for (let s = 0; s < 2; s++) {
          const cf = sheets[s];
          const im = this.img(cf.tex);
          if (!im || !(im.width > 0)) continue;
          const wScaled = im.width * cf.scale;
          this.cloudBGX[s] += wind * cf.par * 9 * dayRate;         // :60268/:60317
          if (this.cloudBGX[s] > wScaled) this.cloudBGX[s] -= wScaled;
          if (this.cloudBGX[s] < -wScaled) this.cloudBGX[s] += wScaled;
          const a = Math.min(1, this.cloudBGAlpha * cf.aMul) * atmo;
          if (a <= 0.01) continue;
          const topY = num3 * cf.topA + cf.topB + scAdj + pushHack;  // :60287/:60334
          const startX = -BiomeBackground.ieeeRemOf(camLeftX * cf.par, wScaled)
            - wScaled / 2 - wScaled + this.cloudBGX[s];              // :60290-60292
          const loops = Math.ceil(viewW / wScaled) + 4;              // :60294 +2+2
          for (let i = 0; i < loops; i++) {
            b.img(im, 0, 0, im.width, im.height, startX + i * wScaled, topY,
              wScaled + 1, im.height * cf.scale, { alpha: a, tint: tintOn });
          }
        }
      }
    }
    // ---- 群系层（序 = DrawSurfaceBG 原版序：Step1 远山 → Step2 近山 → 前景群系函数；
    //     ★逐槽绘制：原版 for l=0..15 按 bgAlpha[slot]>0 把【所有】活跃槽画出来
    //     （前景循环 :60460-60532、山体 Step1 :60768-60823 / Step2 :60836-60912）。
    //     2026-09-19 用户实报"群系切换远景背景瞬切"根因 = 曾只绘当前 bgStyle 单槽：
    //     flip 帧旧槽 alpha 仍在 1→0 衰减但不再被绘制 = 旧背景一帧消失（露天空）、
    //     新背景从 0 淡入；原版 = 新旧双槽同绘（旧 1→0、新 0→1 各 0.05/帧）=
    //     交叉淡化，与黑闪遮罩（DrawChangeOverlay）构成双保险）----
    // 山体双步几何：Step1（:60745）scale1 par0.15 topY=num3·1300+1090；
    // Step2（treeMntBGSet1[1] 块 :60430 = Step2 槽共用档）scale1.15 par0.2
    // topY=num3·1400+1260；两步都过 GetLayerYOffset + GetBackgroundRect（动画）。
    // ★曾只画一层远山——近山层（22/25/36/42/247/森林 m[1] 第二档）整层缺失。
    const forestRow = (seg: number) =>
      this.pickStyle('forest', FOREST_STYLES, this.forestStyles[seg], world);
    const segOf = (s: number) => s === Forest1 ? 0 : s === Forest2 ? 1 : s === Forest3 ? 2 : 3;
    const snowRow = () => this.pickStyle('snow', SNOW_STYLES, this.snowStyle, world);
    // Step1 远山（BackMountainsStep1 :60768-60823 绘制序 0,10,11,12,1,2,4,5,6；
    // 槽语义见 farSlotsForStyle——山体不随 bgStyle 同号：Desert=槽1 画 23、
    // Corruption 系=槽2 画 24、Snow=槽4 画 snowMntBG[0]、Crimson=槽5 画 24、
    // Hallow 档3=槽6 画 246。样式门：desertBG!=4 / crimsonBG!=5 / hallowBG==3）
    const step1: Array<[number, number]> = [];
    for (const s of [0, 10, 11, 12]) {
      if (this.alphaFar[s] > 0.01) step1.push([s, forestRow(segOf(s)).m[0]]);
    }
    if (this.alphaFar[1] > 0.01 && this.desertStyle !== DESERT_STYLE4_ROW) step1.push([1, 23]);
    if (this.alphaFar[2] > 0.01) step1.push([2, 24]);
    if (this.alphaFar[4] > 0.01) step1.push([4, snowRow().m[0]]);
    if (this.alphaFar[5] > 0.01 && this.crimsonStyle !== 5) step1.push([5, 24]);
    if (this.alphaFar[6] > 0.01 && this.hallowStyle === 3) step1.push([6, 246]);
    for (const [s, tex] of step1) {
      drawLayer(tex, 1, 0.15, 1300, 1090, this.alphaFar[s], { yoff: true, anim: true });
    }
    // Step2 近山（BackMountainsStep2 :60836-60912 绘制序 0,1,2,3,4,5,6,10,11,12；
    // 海洋 = Step2 专属 far 槽 3 → oceanBG；森林 m[1]>-1 门 :60840）
    const step2: Array<[number, number]> = [];
    for (const s of [0, 10, 11, 12]) {
      const m1 = forestRow(segOf(s)).m[1];
      if (this.alphaFar[s] > 0.01 && m1 > -1) step2.push([s, m1]);
    }
    if (this.alphaFar[1] > 0.01 && this.desertStyle !== DESERT_STYLE4_ROW) step2.push([1, 22]);
    if (this.alphaFar[2] > 0.01) step2.push([2, 25]);
    if (this.alphaFar[3] > 0.01) step2.push([3, this.oceanTexId()]);
    if (this.alphaFar[4] > 0.01) step2.push([4, snowRow().m[1]]);
    if (this.alphaFar[5] > 0.01 && this.crimsonStyle !== 5) step2.push([5, 42]);
    if (this.alphaFar[6] > 0.01 && this.hallowStyle === 3) step2.push([6, 247]);
    for (const [s, tex] of step2) {
      drawLayer(tex, 1.15, 0.2, 1400, 1260, this.alphaFar[s], { yoff: true, anim: true });
    }
    // 前景群系函数（DrawSurfaceBG 主循环 :60460-60532：绘制序 = 槽号升序 0..15，
    // 每槽前景组按【槽】解析——沙漠族 p/c/h/r 列、森林四段各取本段行。过渡期
    // 旧槽 alpha 衰减期间照常绘制 = 交叉淡化底色。槽 4（Ocean）原版前景无层组）
    for (let l = 0; l < 16; l++) {
      const aF = this.alphaFront[l];
      if (aF <= 0.01) continue;
      if (l === Forest1 || l === Forest2 || l === Forest3 || l === Forest4) {
        const fs = forestRow(segOf(l));
        // DrawSurfaceBG_Forest（:62217）三树层
        drawLayer(fs.t[0], 1.25, 0.4, 1800, 1500, aF, { anim: true });
        drawLayer(fs.t[1], 1.31, 0.43, 1950, 1750, aF, { anim: true, flip: true });
        // 槽[2] 几何：t[0]==91 时整槽走 1.3/0.42 特例（:62398-62407,该覆写挂在
        // [0]==91 上与槽内容无关——样式 31 的 t[2]=11 也吃此档）;SURF_NUDGE[92]=150
        // 由表按贴图号自动施加。曾误写成「再画一遍 92」= s3 行 92 双绘 +
        // 扩表后的样式 31 行凭空多出 92 层（终清波修正）。
        if (fs.t[0] === 91) {
          drawLayer(fs.t[2], 1.3, 0.42, 2100, 2000, aF, { anim: true });
        } else {
          drawLayer(fs.t[2], 1.34, 0.49, 2100, 2000, aF, { anim: true });
        }
      } else if (l === Corruption) {
        const cs = this.pickStyle('corrupt', CORRUPT_STYLES, this.corruptStyle, world);
        // [0]==56 → 三层全 -100（:62086/:62124/:62156 各块共门）；[1] 整层水平翻转
        const n56 = cs[0] === 56 ? -100 : 0;
        drawLayer(cs[0], 1.25, 0.4, 1800, 1500, aF, { nudge: n56 });
        drawLayer(cs[1], 1.31, 0.43, 1950, 1750, aF, { flip: true, nudge: n56 });
        drawLayer(cs[2], 1.34, 0.49, 2100, 2000, aF, { nudge: n56 });
      } else if (l === Crimson) {
        const cs = this.pickStyle('crimson', CRIMSON_STYLES, this.crimsonStyle, world);
        drawLayer(cs[0], 1.25, 0.4, 1800, 1500, aF, { anim: true });   // 105:+50/174:-350 走 NUDGE
        drawLayer(cs[1], 1.31, 0.43, 1950, 1750, aF, { anim: true });
        drawLayer(cs[2], 1.34, 0.49, 2100, 2000, aF, { anim: true });  // 175:-400 走 NUDGE
      } else if (l === Jungle) {
        const js = this.pickStyle('jungle', JUNGLE_STYLES, this.jungleStyle, world);
        drawLayer(js[0], 1.25, 0.4, 1800, 1660, aF, { anim: true, yoff: true });  // 59:-200+YOff-550
        drawLayer(js[1], 1.31, 0.43, 1950, 1840, aF, { anim: true, yoff: true });
        drawLayer(js[2], 1.34, 0.49, 2100, 2060, aF, { anim: true, yoff: true });
      } else if (l === Snow) {
        // ★终清波：雪原树层随样式行切换——setBG case 3（WorldGen.cs:7305-7440）。
        const ss = snowRow();
        drawLayer(ss.t[0], 1.25, 0.4, 1800, 1500, aF, { yoff: true });   // DrawSurfaceBG_Snow 三层（:61252 起）
        drawLayer(ss.t[1], 1.31, 0.43, 1950, 1750, aF, { yoff: true });
        drawLayer(ss.t[2], 1.34, 0.49, 2100, 2000, aF, { yoff: true });
      } else if (l === Hallow) {
        const hs = this.pickStyle('hallow', HALLOW_STYLES, this.hallowStyle, world);
        drawLayer(hs[0], 1.25, 0.4, 1800, 1500, aF, { anim: true });
        drawLayer(hs[1], 1.31, 0.43, 1950, 1750, aF, { anim: true });
        drawLayer(hs[2], 1.34, 0.49, 2100, 2000, aF, { anim: true });
      } else if (l === Mushroom) {
        const ms = this.pickStyle('mushroom', MUSHROOM_STYLES, this.mushroomStyle, world);
        drawLayer(ms[0], 1.25, 0.4, 1800, 1400, aF, { anim: true });
        drawLayer(ms[1], 1.32, 0.43, 1950, 1675, aF, { anim: true });
        drawLayer(ms[2], 1.36, 0.49, 2100, 1950, aF, { anim: true });
      } else if (l === Desert || l === CorruptDesert || l === CrimsonDesert || l === HallowDesert) {
        // 三层组（DrawSurfaceBG_Desert :61969：槽[0]=1.25/0.37/1800/1750、槽[1]/[2]=
        // 1.34/0.49/2100/2150 各经 SetBackgroundOffsets 特例覆写；槽 2=Pure 列、
        // 槽 5/13/14=对应侵染列,空列落 GoodEvilDesert 兜底 26/27 双条 :61852 起）
        const d = this.desertTripleForSlot(l);
        drawLayer(d[0], 1.25, 0.37, 1800, 1750, aF);
        drawLayer(d[1], 1.34, 0.49, 2100, 2150, aF);
        drawLayer(d[2], 1.34, 0.49, 2100, 2150, aF);   // 仅样式 4 的 250 非空
      }
      // l===Ocean：原版海洋无前景树层组（海洋单层 = Step2 远山槽 3；front 槽 4
      // 仍画变更换屏黑闪 overlay——:60488-60490 无层支）
      // ★BJ372 逐槽黑闪（DrawSurfaceBG_DrawChangeOverlay :62042-62051 原位内联于
      //   前景循环 :60460-60532）：每组群系层画完紧跟该槽 area 的黑闪遮罩
      //   （flash=1 落定、−0.05/帧衰减 20 帧,BackgroundChangeFlashInfo）。
      //   ★画位=层间非全局后置:低 l 槽的黑闪被循环内后绘的高 l 槽层覆盖——
      //   Snow(7)→Forest(0) 交叉淡化期雪层画在黑闪之上保持可见（原版观感）;
      //   曾 Renderer 全局后置单遍 = 黑闪盖住含新槽在内的一切 = 每次切换近
      //   全屏黑闪一现（交界处 ABAB 抖动的"跳"感知放大,2026-09-27 用户实报）;
      //   且曾画在暴风雪/沙尘暴色罩之上（原版色罩 SkyManager.DrawToDepth 在
      //   DrawSurfaceBG 之后=色罩盖黑闪,本次归位）。
      if (!this.flashSuppressed) {
        const area = STYLE_TO_AREA[l];
        const p = area !== undefined ? this.bgFlash[area] : 0;
        if (p > 0.01) b.fill(0, 0, viewW, viewH, 0, 0, 0, p);
      }
    }
  }

  /** 带色调平铺绘制（tint 缓存按 (tex,量化tint) 键，避免每帧逐像素）。
   *  ★2026-08-18 canvas 哨兵实抓(用户真机 61/s 持续,晨昏色调漂移期):旧键 =
   *  im.src(bitmap 恒 undefined,跨层串键)+ tint.toFixed(2)(昼夜色调连续漂移
   *  → 每帧新键)+ 超 64 整表 clear()(清光全重烘 = 永远 miss 的雪崩)。
   *  修:WeakMap 纹理 id(bitmap 安全)+ tint 步进 8 量化(背景层 3% 无感)
   *  + 逐条淘汰(工作集 = 层数×色桶 ~10-20 张) */
  private tintCache = new Map<string, HTMLCanvasElement>();

  /** GPU contextlost 后染色缓存内容归零且不会自动重画——失效清理
   *  (Renderer.onLost 统一扫;GL 主路径下通常为空表,零成本) */
  clearTintCache(): void {
    for (const c of this.tintCache.values()) { c.width = 0; c.height = 0; }
    this.tintCache.clear();
    // ★2026-10-17 红队 CONFIRMED 债清偿:caveBackTreeX 惰性一次写入(BiomeBackground
    // 随 Renderer 跨世界复用)——切世界后世界 treeX 变了但缓存非空永不重掷=新世界
    // 森林背景四段边界读旧世界树位(Forest1/Forest2 会话级钉死,features 探针 10 vs 0
    // 定谳)。挂点=clearTintCache(世界装配处 Renderer.ts 同调,与 tint/纸娃娃缓存同批清账)。
    this.caveBackTreeX = null;
  }
  private tintTexIds = new WeakMap<object, number>();
  private tintTexIdSeq = 0;
  /** 水平翻转烘焙（SpriteEffects.FlipHorizontally 等价；按源贴图缓存一次） */
  private flippedOf(im: ImageBitmap | HTMLImageElement): ImageBitmap | HTMLImageElement {
    let c = this.flipCache.get(im);
    if (!c) {
      c = document.createElement('canvas');
      c.width = im.width; c.height = im.height;
      const cx = c.getContext('2d')!;
      cx.translate(im.width, 0);
      cx.scale(-1, 1);
      cx.drawImage(im, 0, 0);
      this.flipCache.set(im, c);
    }
    // canvas 是合法 drawImage/texFromImage 源——按消费方联合类型口径归还
    return c as unknown as HTMLImageElement;
  }

  drawTiledTinted(
    ctx: CanvasRenderingContext2D, im: ImageBitmap | HTMLImageElement,
    tr: number, tg: number, tb: number, dx: number, dy: number, dw: number, dh: number,
    src?: [number, number, number, number],
  ) {
    // ★texReady 半加载窗守卫（2026-08-25 同洞加固，鸟群白闪竞态同款）：元数据已到
    //  但主体未完时烘焙 = 平色矩形按 (贴图|量化色桶) 键永久入缓存。未就绪本帧
    //  跳过该层（进世界加载窗内 1-2 帧，就绪后自然恢复）
    if (!texReady(im)) return;
    let tid = this.tintTexIds.get(im);
    if (tid === undefined) { tid = ++this.tintTexIdSeq; this.tintTexIds.set(im, tid); }
    const key = `${tid}|${Math.round(tr * 255) & ~7},${Math.round(tg * 255) & ~7},${Math.round(tb * 255) & ~7}`;
    let c = this.tintCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = im.width; c.height = im.height;
      const cx = c.getContext('2d')!;
      cx.drawImage(im, 0, 0);
      cx.globalCompositeOperation = 'multiply';
      cx.fillStyle = `rgb(${Math.round(tr * 255)},${Math.round(tg * 255)},${Math.round(tb * 255)})`;
      cx.fillRect(0, 0, c.width, c.height);
      cx.globalCompositeOperation = 'destination-in';
      cx.drawImage(im, 0, 0);
      this.tintCache.set(key, c);
      if (this.tintCache.size > 64) {
        // 逐条淘汰最旧(整表 clear = 下帧全量重烘雪崩)
        const first = this.tintCache.keys().next().value;
        if (first !== undefined) this.tintCache.delete(first);
      }
    }
    // 2×2 帧动画层（GetBackgroundRect 子区）带 tint 时按子区取样——烘焙仍整表
    // （缓存键 = 贴图|色桶,子区在绘制端裁）
    if (src) ctx.drawImage(c, src[0], src[1], src[2], src[3], dx, dy, dw, dh);
    else ctx.drawImage(c, dx, dy, dw, dh);
  }

  // ---- 地下层 ----
  // 几何 1:1（Main.cs DrawBackground :52217-53517 各带方法,2026-08-17 重写）：
  //  · 水平周期 = 贴图宽-32（160 宽贴图取中间 128 列,两侧 16px 是 wrap padding——
  //    像素级验证 63/65 在列 16..144 逐像素完美循环;按整宽 160 平铺会每 160px 出一条
  //    图案断缝 = "蘑菇区远景平铺错位"根因）;岩石/岩浆带原版硬编码 128。
  //  · 横向滚动 bgStartX = -IEEERemainder(P+screenX*caveParallax, P) - P/2
  //    （caveParallax=0.88 默认,Main.cs:1172）+ diff = round(-IEEERemainder(
  //    bgStartX+screenX,16))（-8→8）——采样窗对齐世界 16px 网格,src/dst 同移,
  //    防视差平移下纹理"游动"。
  //  · 垂直相位：深层（带顶远在屏上）bgStartY = IEEERemainder(bgTopY,96)-96 行相位
  //    锁到带顶（世界锁定）;浅层 = 带顶原值。步进 96（backgroundHeight[2]/[3]）。
  //  · 带序: slot0 表面条@ws-16 → slot1 泥土带 → slot2 岩石上 16px 条@rockTP-16
  //    → slot3 岩石主体（底=magmaLayer*16+600 行边界）→ slot4 岩浆过渡条@岩石带底
  //    行边界 → slot5 岩浆体（3帧×96,底=UnderworldLayer）→ slot6 波纹条@岩浆带底行边界。
  //  · 逐 16px 切片光照（暗洞挖空/贴墙裁剪）未实装——整行绘制近似,几何与原版一致。
  private drawUnderground(
    b: BGBlit, world: World, cam: Cam,
    camTopY: number, viewW: number, viewH: number, dtMs: number,
  ) {
    const worldID = world.seed >>> 0;
    const newSlots = ugSlots(this.ugStyle, this.iceBack, this.jungleBack, this.hellBack, worldID);
    const oldSlots = ugSlots(this.ugOld, this.iceBack, this.jungleBack, this.hellBack, worldID);
    const alpha = this.ugAlpha;
    const screenX = cam.x - viewW / 2;
    const screenY = camTopY;
    const surfacePx = (world.groundLevel | 0) * 16;
    // GetRockTransitionPoint :52509 —— span 按 int 截断;步进/取模恒 96(backgroundHeight[2])
    const rockSpan = ((world.rockLevel | 0) - (world.groundLevel | 0)) * 16;
    let rockSteps = Math.trunc(rockSpan / 96);
    if (rockSpan % 96 !== 0) rockSteps++;
    const rockTP = (world.groundLevel | 0) * 16 + rockSteps * 96 + 32;
    // :52237 magmaLayer 公式：ws + floor((h-330-ws)/6)*6 - 5（★曾误用 lavaLine(h-200)）
    const magmaLayerTile = Math.floor(world.groundLevel
      + Math.floor((world.store.h - 330 - world.groundLevel) / 6) * 6) - 5;
    const magmaPx = magmaLayerTile * 16;
    const uwPx = (world.store.h - 200) * 16;   // UnderworldLayer
    // 岩浆 3 帧动画（Main.cs:61657-61665：magmaBGFrameCounter 每 8 tick 推进,mod 3;
    // 8 tick = 133.33ms）。岩浆体 125+hell(160×288=3 帧×96px)与过渡/波纹条
    // (160×48,取 16px 行×3 帧)共用同一 frame
    this.magmaFrameT += dtMs;
    // GetBackgroundCounter 累进（60/s tick；帧长 16.667ms）
    this.bgTickAcc += dtMs;
    while (this.bgTickAcc >= 16.6667) {
      this.bgTickAcc -= 16.6667;
      this.bgTick++;
    }
    const magmaFrame = Math.floor(this.magmaFrameT / 133.33) % 3;
    // ★层序（:52265-52270）：SurfaceTransition → Dirt → 【黑盒打底】→ Rock → Magma。
    // 黑盒 gate = magmaLayer*16 ≤ 屏底（:52815）——带层随后重画覆盖;深处(UnderworldLayer
    // 之下)即原版纯黑地狱背景（本仓清屏非黑,靠这层兜底,曾露天空渐变）
    // ★IIIII224（Main.cs:54200 DrawBackground_DrawUnderworldBlackBox）：remix 世界
    // （宽 < 5000 = remix 必然窄图）整层黑盒不画
    if (magmaPx <= screenY + viewH && !(!!world.seedFlags?.remix && world.w < 5000)) {
      b.fill(0, 0, viewW, viewH, 0, 0, 0, 1);
    }
    // 地狱多层远景背景(DrawUnderworldBackground :52082-52228,画在带层之下):
    // gate = 屏底 ≥ (h-220)*16(:52086);深层带层退化后整屏由本层接管——
    // 层0 底部黑补 (11,3,7) 兜底(:52219-52223)
    this.drawHellLayers(b, world, cam, viewW, viewH, dtMs);
    /** C# Math.IEEERemainder（IEEE round-half-even；实现提为 ieeeRemOf 类级共用） */
    const ieeeRem = (a: number, b: number): number => BiomeBackground.ieeeRemOf(a, b);
    const drawSlots = (slots: number[], a: number) => {
      if (a <= 0.01) return;
      /** 横向滚动参数（:52277/:52836 bgStartX/num2 公式;drawOffset=0 屏幕空间） */
      const scroll = (P: number): { startX: number; diff: number; loops: number } => {
        const startX = Math.trunc(-ieeeRem(P + screenX * CAVE_PARALLAX, P) - P / 2);
        let diff = Math.round(-ieeeRem(startX + screenX, 16));
        if (diff === -8) diff = 8;
        return { startX, diff, loops: Math.trunc(viewW / P) + 2 };
      };
      /** 单带一行绘制（周期自适应:per=min(P,width-32)。带层贴图统一 16+核心+16 翼
       *  结构——160宽=周期128、128宽 BG_2/3/4=周期96,左右翼==核心环绕拷贝(PNG 逐列
       *  实证零差),窗口 [16+diff,16+diff+per) ⊂ [8,152] 永不越界=无缝。
       *  ★曾硬编码 P=128:对 128 宽贴图越界——XNA 越界源=edge-clamp(无缝),Canvas
       *  drawImage=等比裁剪→每周期交界竖黑缝(2026-08-25 用户实报);中间方案"右缘
       *  1px 列拉伸 clamp"有可见竖纹,按贴图设计周期平铺才是无缝正解 */
      const bandRow = (
        im: ImageBitmap | HTMLImageElement, P: number, destY: number, srcY: number, srcH: number,
      ) => {
        const per = Math.min(P, im.width - 32);
        if (per <= 0) return;
        const sh = Math.min(srcH, im.height - srcY);
        if (sh <= 0) return;
        const { startX, diff, loops } = scroll(per);
        const sx = 16 + diff;
        for (let i = 0; i < loops; i++) {
          b.img(im, sx, srcY, per, sh, startX + per * i + diff, destY, per, sh, { alpha: a });
        }
      };
      const im0 = slots[0] > 0 ? this.img(slots[0]) : null;
      const im1 = slots[1] > 0 ? this.img(slots[1]) : null;
      const im2 = slots[2] > 0 ? this.img(slots[2]) : null;
      const im3 = slots[3] > 0 ? this.img(slots[3]) : null;
      const im4 = slots[4] > 0 ? this.img(slots[4]) : null;
      const im5 = slots[5] > 0 ? this.img(slots[5]) : null;
      const im6 = slots[6] > 0 ? this.img(slots[6]) : null;
      const ok = (im: ImageBitmap | HTMLImageElement | null): im is ImageBitmap | HTMLImageElement =>
        !!im && im.width > 0;
      // ---- slot0 表面过渡条（:53137-53170: bgTopY = ws*16-16-screenY+16,行 0,16px）----
      if (ok(im0)) {
        const topY = surfacePx - 16 - screenY + 16;
        if (topY > -32 && topY < viewH) bandRow(im0, im0.width, topY, 0, 16);
      }
      // ---- slot1 泥土带（:52826 起: bgTopY = ws*16-screenY+16 → rockTP 截止）----
      if (ok(im1) && surfacePx <= screenY + viewH + 64) {
        const bgTopY = surfacePx - screenY + 16;
        const deep = surfacePx < screenY - 16;
        const startY = deep ? Math.trunc(ieeeRem(bgTopY, 96) - 96) : Math.trunc(bgTopY);
        let loopsY = deep
          ? Math.trunc((viewH - startY) / 96) + 1
          : Math.trunc((viewH - bgTopY) / 96) + 1;
        if (rockTP < screenY + viewH - 16) loopsY = Math.trunc((rockTP - screenY - startY) / 96);
        for (let j = 0; j < loopsY; j++) {
          bandRow(im1, im1.width, startY + im1.height * j, 0, im1.height);
        }
      }
      // ---- slot2 岩石上过渡条（DirtBackground 尾段 :53155-53189: @rockTP-16,P=128,行 0）----
      if (ok(im2)) {
        const topY = rockTP - screenY - 16;
        if (topY > -32 && topY < viewH) bandRow(im2, 128, topY, 0, 16);
      }
      // ---- slot3 岩石带主体（DrawRockLayer :52523 起;底 = magmaLayer*16+600 行边界）----
      let rockStartY = 0, rockLoopsY = 0;
      if (ok(im3) && rockTP <= screenY + viewH) {
        const bgTopY = rockTP - screenY;
        const deep = rockTP + viewH < screenY - 16;
        const startY = deep ? Math.trunc(ieeeRem(bgTopY, 96) - 96) : Math.trunc(bgTopY);
        let loopsY = deep
          ? Math.trunc((viewH - startY) / 96) + 1
          : Math.trunc((viewH - bgTopY) / 96) + 1;
        if (magmaPx < screenY + viewH) loopsY = Math.trunc((magmaPx + 600 - startY - screenY) / 96);
        rockStartY = startY; rockLoopsY = loopsY;
        for (let j = 0; j < loopsY; j++) {
          bandRow(im3, 128, startY + im3.height * j, 0, im3.height);
        }
      }
      // ---- slot4 岩浆过渡条（DrawMagmaTransition :52765: @岩石带底行边界,行 = frame*16）----
      const magmaTransition = rockTP <= screenY + viewH && magmaPx < screenY + viewH;
      if (ok(im4) && magmaTransition && rockLoopsY > 0) {
        bandRow(im4, 128, rockStartY + rockLoopsY * 96, magmaFrame * 16, 16);
      }
      // ---- slot5 岩浆体 + slot6 表面波纹条（DrawMagmaLayer :52276 起）----
      if (ok(im5) && magmaPx <= screenY + viewH) {
        const bgTopY = magmaPx - screenY + 16 + 600 - 8;
        const deep = magmaPx + viewH < screenY - 16;
        const startY = deep ? Math.trunc(ieeeRem(bgTopY, 96) - 96) : Math.trunc(bgTopY);
        let loopsY = deep
          ? Math.trunc((viewH - startY) / 96) + 1
          : Math.trunc((viewH - bgTopY) / 96) + 1;
        let ripple = false;
        if (uwPx < screenY + viewH) {
          loopsY = Math.ceil((uwPx - screenY - startY) / 96);
          ripple = true;
        }
        const frameH = im5.height / 3;   // 160×288 = 3 帧 × 96px
        for (let j = 0; j < loopsY; j++) {
          bandRow(im5, 128, startY + 96 * j, Math.min(2, magmaFrame) * frameH, frameH);
        }
        if (ripple && ok(im6)) {
          bandRow(im6, 128, startY + loopsY * 96, magmaFrame * 16, 16);
        }
      }
    };
    drawSlots(oldSlots, 1 - alpha);
    drawSlots(newSlots, alpha);
  }

  /** C# Math.IEEERemainder（IEEE round-half-even）——地表视差/地下带相位共用 */
  static ieeeRemOf(a: number, b: number): number {
    const r = a / b, f = Math.floor(r), d = r - f;
    const n = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
    return a - b * n;
  }

  /** 地狱多层远景背景 1:1(Main.cs DrawUnderworldBackground :52082-52228):
   *  wiki"地狱背景"= 岩柱/岩浆湖/熔岩瀑布岛屿/山体洞穴,五层视差(近→远 parallax
   *  1/3..1/11),风格集 0:[0-4] 1:[5-9] 2:[10,11,12,13,9](WorldGen.cs:7578-7597);
   *  2×2 四帧行动画(帧 8fps,贴图 1/6/7/8/13,:52117-52206 各自 Y 偏移) */
  private drawHellLayers(
    b: BGBlit, world: World, cam: Cam,
    viewW: number, viewH: number, dtMs: number,
  ): void {
    const h = world.store.h;
    const camTopY = cam.y - viewH / 2;
    if (camTopY + viewH < (h - 220) * 16) return;   // :52086 屏底未及 h-220
    this.seedFor(world);
    this.hellFrameT += dtMs;
    const frame = Math.floor(this.hellFrameT / 1000 * 8) % 4;   // (int)(GlobalTime*8)%4
    const SETS = [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 9]];
    const set = SETS[this.underworldStyle] ?? SETS[0];
    const uwPx = (h - 200) * 16;                     // UnderworldLayer*16 锚
    const pushUp = (1.25 - 1) * 0.5 * 200;           // zoomForPushUp=GameZoomTarget;取 1.25
    for (let idx = 4; idx >= 0; idx--) {             // :52092 远→近(4→0)
      const texId = set[idx];
      const im = this.hellImg(texId);
      if (!im || !(im.width > 0) || im.width === 0) continue;
      const num2 = idx * 2 + 3;                      // :52109 深度
      const inv = 1 / num2;                          // vector = 1/num2(纵横同)
      const scale = texId === 4 ? 0.5 : 1.3;         // num3(:52113;贴图4细柱条 0.5)
      // 2×2 四帧行动画 + 各贴图 Y/X 偏移(:52117-52206)
      let sx = 0, sy = 0, sw = im.width, sh = im.height;
      let zeroX = 0, zeroY = 0;
      const anim = texId === 1 || texId === 6 || texId === 7 || texId === 8 || texId === 13;
      if (anim) {
        sx = (texId === 1 ? (frame >> 1) : (frame % 2)) * (sw >> 1);
        sy = (texId === 1 ? (frame % 2) : (frame >> 1)) * (sh >> 1);
        sw >>= 1; sh >>= 1;
      }
      switch (texId) {
        case 1: zeroY += 175; break;
        case 2: zeroY += 100; break;
        case 3: zeroY += 75; break;
        case 6: zeroY += -60; break;
        case 7: zeroX -= 400; zeroY += 90; break;
        case 8: zeroY += 90; break;
        case 9: zeroY += -30; break;
        case 10: zeroY += 250 * num2; break;
        case 11: zeroY += 100 * num2; break;
        case 12: zeroY += 20 * num2; break;
        case 13: zeroY += 20 * num2; break;
      }
      zeroY -= pushUp;                               // :52198
      let vecX = Math.floor(sw * 0.5 * scale);       // vec = Size*0.5(动画已半) *num3 后 Floor
      let vecY = Math.floor(sh * 0.5 * scale);
      const num10 = scale * sw;                      // 单次绘制宽
      const num11 = Math.floor((cam.x * inv - vecX + zeroX - viewW / 2) / num10);   // :52201
      const num13 = Math.floor(scale * ((sw - 1) / inv));                           // :52204
      // vec2(:52205-52206):X 按 num11 锚定平铺;Y 锚 UnderworldLayer 经深度投影
      let x0 = Math.floor(((num11 - 2) * num13 + vecX - cam.x) * inv + viewW / 2 - vecX + zeroX);
      const y0 = Math.floor((uwPx + vecY - cam.y) * inv + viewH / 2 - vecY + zeroY);
      const loops = Math.ceil(viewW / num10);
      const dh = sh * scale;
      for (let i = num11 - 2; i <= num11 + 4 + loops; i++) {
        b.img(im, sx, sy, sw, sh, x0, y0, num10, dh);
        if (idx === 0) {                             // 层0 底部黑补 rgb(11,3,7)(:52219-52223)
          const bot = y0 + dh;
          if (bot < viewH) {
            b.fill(x0, bot, num10, viewH - bot, 11 / 255, 3 / 255, 7 / 255);
          }
        }
        x0 += num10;
      }
    }
  }
  // ---- 主菜单分支：调度入口 + DrawSurfaceBG gameMenu 层渲染 ----
  // （2026-08-26 自 MenuBackground.ts 整体迁入；几何 = 第六轮定稿「分数定位 +
  // TEX_TOPROW 内容行补偿」，用户 1.4.5.8 截图对拍态。原版对应物：
  // 远山 BackMountainsStep1/2 gameMenu y=100/230+startX−500（cs:60766/:60830-60832）、
  // 树层 y=320/400/480（cs:62273/:62365-62368/:62435-62437）、scale ×num4=2
  // （num4 为常量 2f cs:60265，非屏宽派生）、腐化槽 DrawSurfaceBG_Corrupt cs:62059）

  /** 菜单样式注入（UpdateMenu setBG 保可见槽语义：昼保 forestStyleNum=treeBG1
   *  cs:20097、夜保 corruptStyleNum cs:20085——重掷只动隐藏槽，可见性归坡道） */
  setMenuStyles(forestStyleNum: number, corruptStyleNum: number): void {
    this.menuForestStyle = forestStyleNum;
    this.menuCorruptStyle = corruptStyleNum;
  }

  /** menuMode 每帧状态推进（DrawBG gameMenu 分支 cs:64976-64989 + UpdateBGVisibility_
   *  FrontLayer cs:65065 + UpdateBGVisibility_BackLayer cs:65123）：bgStyle 直设昼
   *  Forest1(0)/夜 Corruption(1)，无 want 链/bgDelay/instantBG/bgFlash——原版菜单零硬切，
   *  切换全靠双槽交叉淡化；坡速 = gameMenu 专用 backgroundLayerTransitionSpeed 0.02/帧
   *  （cs:64978，非游戏内 0.05）。远山槽映射（UpdateBGVisibility_BackLayer switch）：
   *  昼 Forest1 → slot0（default 分支 cs:65183-65184）、夜 Corruption → slot2
   *  （case 1/5/13/14 cs:65150-65154），非活跃槽 − 同速衰减、钳 0..1
   *  （DrawBG_ModifyBGFarBackLayerAlpha cs:65236-65252；沙漠变体互换豁免 cs:65246
   *  不适用——菜单仅 0/2 槽活跃且非沙漠族）。!menuMode 时 no-op（严格旗控） */
  menuTick(dayTime: boolean, dtMs: number): void {
    if (!this.menuMode) return;
    // ★2026-10-16 用户实报「瀑布远景游戏内会动,主菜单横滚不动」定谳修复:
    //  冷启动主菜单无 Game 实例=fixedUpdate 不跑=GTW 恒 0（BJ330「标题菜单
    //  fixedUpdate pre-world 照跑」论断在冷启动菜单不成立）→ menuBgCounter
    //  恒 0 → 173 瀑布/341 等 counter 驱动动画全钉死第 0 帧。原版 Main.Update
    //  菜单态照跑（TotalGameTime 推进）=原版菜单瀑布会动。修=菜单自累进钟
    //  （60/s,dtMs 累进同游戏内 bgTick 式）;游戏内 menuMode=false 仍走 GTW
    //  （原语义:暂停/失焦冻结=BJ330 用户拍板）。
    this.menuClockAcc += dtMs;
    while (this.menuClockAcc >= 16.6667) {
      this.menuClockAcc -= 16.6667;
      this.menuClock++;
    }
    const frames = dtMs / (1000 / 60);
    this.bgStyle = dayTime ? Forest1 : Corruption;
    const speed = Math.min(0.02 * frames, 1);
    for (let l = 0; l < this.alphaFront.length; l++) {
      if (l === this.bgStyle) this.alphaFront[l] = Math.min(1, this.alphaFront[l] + speed);
      else if (this.alphaFront[l] !== 0) this.alphaFront[l] = Math.max(0, this.alphaFront[l] - speed);
    }
    const farSlot = dayTime ? Forest1 : 2;
    for (let l = 0; l < this.alphaFar.length; l++) {
      if (l === farSlot) this.alphaFar[l] = Math.min(1, this.alphaFar[l] + speed);
      else if (this.alphaFar[l] !== 0) this.alphaFar[l] = Math.max(0, this.alphaFar[l] - speed);
    }
  }

  /** 主菜单地表背景绘制（sky.draw 之后调；晨昏光斑由 MenuBackground 在本方法
   *  之后画 = 原版 DrawLensFlare cs:63074 在 DrawBG cs:63061 后的层序）。
   *  ctx 直绘不走 BGBlit：
   *  腐化 L2 恒水平翻转（cs:62122 FlipHorizontally 无条件）与精确 tint 烘焙
   *  均为 ctx 侧能力，菜单本就 2D 合成。tint=null = 近白免烘；camX = MenuXMovement
   *  累积器（+4/帧 wrap ±2^31，cs:49041-49050），横向视差锚。
   *  near 回调 = 原版云三通插层（DrawSurfaceBG 层序 cs:60384-60457：Step1 远山 →
   *  DrawClouds_Closer cs:60386 → Step2 远山 → DrawClouds_Closest cs:60457 → 树层），
   *  菜单侧由 MenuBackground 注入 SkyRenderer.drawCloudsNear 分 pass——缺省跳过 */
  drawMenu(ctx: CanvasRenderingContext2D, viewW: number, viewH: number,
    tint: [number, number, number] | null, camX: number,
    near?: { closer?: () => void; closest?: () => void }): void {
    if (!this.menuMode) return;
    const st = MENU_FOREST_STYLES[this.menuForestStyle] ?? MENU_FOREST_STYLES[1];
    // 贴图重复周期 ≈ 窗口宽（截图拟合）。★竖屏补偿项：层带 Y 按 H 分位
    // （山 40/45%、树 72/79/86%）而贴图高按 W 缩放,H/W>1.66 时山带底
    // (0.45H+435·sc)够不到树带顶(0.72H)→带间露出裸天空硬接缝(2026-08-25
    // 手机实报;树带更瘦时同样悬空)。H 项仅在 H/W>1.416(远超桌面横窗)时
    // 占优——桌面/横屏取 W 项,数学恒等零变化
    const sc = Math.max(viewW / 1024, viewH / 1450);
    // 远山两带：脊线 40%/45%H（内容行补偿后），双槽交叉淡化（bgAlphaFarBackLayer）：
    // 昼 slot0=treeMntBGSet1[0]/[1]、夜 slot2=tex 24/25——UpdateBGVisibility_BackLayer
    // 把 Corruption 映射到 slot2（cs:65154）、贴图在 Step1/Step2 各自 alpha>0 门下
    // 绘制（cs:60774/:60802 与 cs:60842/:60858）；昼夜交替两槽同时 >0 = 原版夜间
    // 远山淡入淡出。★Step2 视差 = treeMntBGSet1[1] 预置块 0.2（cs:60436）非 Step1
    // 的 0.15（cs:60759）；gameMenu dx：Step2 startX−500（cs:60833）为原版屏幕像素。
    // （树线/腐化槽的 −80/−120 同理，cs:62368/:62438/:62102/:62147）
    const farBand = (tex: number, yFrac: number, par: number, dx: number, a: number) => {
      if (a <= 0.01 || tex < 0) return;
      const im = this.img(tex);
      if (!im) return;
      this.drawMenuLayer(ctx, camX, viewW, this.menuTinted(tex, im, tint), par,
        viewH * yFrac - (TEX_TOPROW[tex] ?? 0) * sc, sc, dx, a);
    };
    farBand(st.mnt[0], 0.40, 0.15, 0, this.alphaFar[Forest1]);       // Step1 槽0
    farBand(24, 0.40, 0.15, 0, this.alphaFar[2]);                    // Step1 槽2（夜）
    near?.closer?.();
    farBand(st.mnt[1], 0.45, 0.20, -500, this.alphaFar[Forest1]);    // Step2 槽0
    farBand(25, 0.45, 0.20, -500, this.alphaFar[2]);                 // Step2 槽2（夜）
    near?.closest?.();
    // 槽 Forest1（alphaFront[Forest1] 坡道）：树三层（树线 72/79/86%H）
    const aF = this.alphaFront[Forest1];
    if (aF > 0.01) {
      this.drawMenuTreeSlot(ctx, camX, viewW, 0, st.trees[0], viewH * 0.72, 1.25 * sc, 0.4, 0, aF, tint);
      this.drawMenuTreeSlot(ctx, camX, viewW, 1, st.trees[1], viewH * 0.79, 1.31 * sc, 0.43, -80, aF, tint);
      this.drawMenuTreeSlot(ctx, camX, viewW, 2, st.trees[2], viewH * 0.86, 1.34 * sc, 0.49, -120, aF, tint);
    }
    // 槽 Corruption（夜菜单，DrawSurfaceBG_Corrupt gameMenu 分支 cs:62059 起）
    const aC = this.alphaFront[Corruption];
    if (aC > 0.01) this.drawMenuCorruptTrees(ctx, camX, viewW, viewH, aC, tint, sc);
  }

  /** 腐化三层（cs:62059 起：y/scale/dx 与森林槽同档、L2 恒水平翻转 cs:62122；
   *  gameMenu dx −80/−120（cs:62102/:62147，屏幕像素）；56 套三层全 −100——
   *  cs:62078/:62104/:62149 三处都查 bgTexIndexes[0]==56） */
  private drawMenuCorruptTrees(ctx: CanvasRenderingContext2D, camX: number,
    viewW: number, viewH: number,
    a: number, tint: [number, number, number] | null, sc: number): void {
    const set = MENU_CORRUPT_STYLES[this.menuCorruptStyle] ?? MENU_CORRUPT_STYLES[0];
    const y56 = set[0] === 56 ? -100 * sc : 0;
    const l0 = this.img(set[0]);
    if (l0) this.drawMenuLayer(ctx, camX, viewW, this.menuTinted(set[0], l0, tint), 0.4,
      viewH * 0.72 + y56 - (TEX_TOPROW[set[0]] ?? 0) * sc, 1.25 * sc, 0, a);
    const l1 = this.img(set[1]);
    if (l1) this.drawMenuLayer(ctx, camX, viewW, this.menuTinted(set[1], l1, tint), 0.43,
      viewH * 0.79 + y56 - (TEX_TOPROW[set[1]] ?? 0) * sc, 1.31 * sc, -80, a, undefined, true);
    const l2 = this.img(set[2]);
    if (l2) this.drawMenuLayer(ctx, camX, viewW, this.menuTinted(set[2], l2, tint), 0.49,
      viewH * 0.86 + y56 - (TEX_TOPROW[set[2]] ?? 0) * sc, 1.34 * sc, -120, a);
  }

  /** 单树层（DrawSurfaceBG_Forest cs:62223-62470 逐槽位规格/特例；逐贴图像素偏移
   *  已被 TEX_TOPROW 内容行补偿替代——见表注） */
  private drawMenuTreeSlot(ctx: CanvasRenderingContext2D, camX: number, viewW: number,
    slot: 0 | 1 | 2, tex: number, y: number, scale: number,
    par: number, dx: number, alpha: number,
    tint: [number, number, number] | null): void {
    if (tex < 0) return;
    let sc = scale, pr = par;
    let src: [number, number, number, number] | undefined;
    let flip = false;
    let n = tex;
    if (slot === 0) {
      // cs:62225-62250 逐贴图 scale/par 覆写（×num4=2 常量，cs:60265）
      if (tex === 91) { pr = 0.27; sc = 1.2 * 2; }
      else if (tex === 173) { pr = 0.25; sc = 1.3 * 2; }
      else if (tex === 178) { pr = 0.3; sc = 1.2 * 2; }
      else if (tex === 184) { pr = 0.25; sc = 1.2 * 2; }   // cs:62243-62247(62246 bgScale=1.2f)
      else if (tex === 282) { sc = 1.4 * 2; }
      if (tex === 173) {
        // cs:62322-62330 动画四帧 251-254（GetBackgroundCounter/10%4；gameMenu
        // counter = GlobalTimeWrappedHourly×40 cs:62220）
        n = 251 + (Math.floor(this.menuBgCounter() / 10) % 4);
      }
      y -= (TEX_TOPROW[tex] ?? 0) * sc;   // 内容行补偿
    } else if (slot === 1) {
      if (tex === 51 || tex === 54) flip = true;      // cs:62393 FlipHorizontally
      y -= (TEX_TOPROW[tex] ?? 0) * sc;
    } else {
      // cs:62409-62412 槽0=91 → 本层 sc1.3×2/par0.42
      if (MENU_FOREST_STYLES[this.menuForestStyle]?.trees[0] === 91) { sc = scale * 1.3 / 1.34; pr = 0.42; }
      y -= (TEX_TOPROW[tex] ?? 0) * sc;
      // ★2026-10-16 BG_SHEET 泛化（用户实报「瀑布远景主菜单不动」二因之一）:
      //  旧 menu 分支只特判 341——BG_SHEET 2×2 动画族的其余成员（281 样式10 山层
      //  周期 5 等 19 个）在主菜单画静态整表。泛化=查表驱动（游戏内 1163 位同源
      //  逻辑）:period=BG_SHEET[tex] → counter/period%4 取 2×2 帧+Inflate(0,-2)。
      {
        const period = BG_SHEET[tex];
        if (period !== undefined) {
          const im = this.img(tex);
          if (!im) return;
          const idx = Math.floor(this.menuBgCounter() / period) % 4;
          const fw = im.width / 2, fh = im.height / 2;
          src = [(idx % 2) * fw, Math.floor(idx / 2) * fh + 2, fw, fh - 4];
          const tim = this.menuTinted(tex, im, tint);
          this.drawMenuLayer(ctx, camX, viewW, tim, pr, y, sc, dx, alpha, src, flip);
          return;
        }
      }
    }
    const im = this.img(n);
    if (!im) return;
    this.drawMenuLayer(ctx, camX, viewW, this.menuTinted(n, im, tint), pr, y, sc, dx, alpha, undefined, flip);
  }

  /** 单层横滚平铺（原版 bgStartX = −IEEERemainder(screenX·par, w) − w/2 + dx；
   *  接缝修复 = 取整 + 每张 +1px 重叠，背景层无感知） */
  private drawMenuLayer(ctx: CanvasRenderingContext2D, camX: number, viewW: number,
    im: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
    par: number, y: number, scale: number, dx: number, alpha = 1,
    src?: [number, number, number, number], flip = false): void {
    const w = (src ? src[2] : im.width) * scale;
    const h = (src ? src[3] : im.height) * scale;
    if (w <= 0 || h <= 0 || alpha <= 0.01) return;
    const startX = -(((camX * par) % w) + w) % w - w / 2 + dx;
    const loops = Math.ceil(viewW / w) + 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    // 接缝修复：取整 + 每张 +1px 重叠（浮点平铺亚像素缝，背景层无感知）
    const yR = Math.round(y);
    for (let i = 0; i < loops; i++) {
      const x = Math.round(startX + i * w);
      if (flip) {
        ctx.save();
        ctx.translate(x + w, yR);
        ctx.scale(-1, 1);
        if (src) ctx.drawImage(im, src[0], src[1], src[2], src[3], 0, 0, w, h);
        else ctx.drawImage(im, 0, 0, w, h);
        ctx.restore();
      } else if (src) {
        ctx.drawImage(im, src[0], src[1], src[2], src[3], x, yR, w, h);
      } else {
        ctx.drawImage(im, x, yR, Math.ceil(w) + 1, h);
      }
    }
    ctx.restore();
  }

  /** GetBackgroundCounter gameMenu 分支（cs:62214-62220 = GlobalTimeWrappedHourly×40）。
   *  ★BJ330：GTW 钟源收编 GameTime 单源;★2026-10-16 修复:冷启动主菜单无 Game
   *  实例=GTW 恒 0（见 menuTick 头注定谳）——menuMode 用菜单自累进钟,游戏内
   *  仍走 GTW（暂停/失焦冻结=用户拍板语义保留）。 */
  private menuBgCounter(): number {
    return this.menuMode ? this.menuClock : globalTimeWrappedHourly() * 40;
  }
  /** ★菜单自累进钟（60/s,menuTick 推进;探针可读口） */
  menuClock = 0;
  private menuClockAcc = 0;

  /** 菜单层 tint 烘焙（multiply + destination-in 保 α；颜色按 4 单位量化桶，
   *  跨桶才重烘——晨昏连续扫描不逐帧重烘；近白由调用方传 null 免烘） */
  private menuTinted(n: number, im: HTMLImageElement | ImageBitmap,
    t: [number, number, number] | null): HTMLImageElement | ImageBitmap | HTMLCanvasElement {
    if (!t) return im;
    // ★半加载窗守卫（2026-08-24 光斑方片竞态同洞加固）：元数据已到但主体未完时
    //  drawImage 画不出内容,平色矩形会按量化桶缓存复用——未就绪本帧画原图
    if (!texReady(im)) return im;
    let e = this.menuTintBufs.get(n);
    if (!e || e.cv.width !== im.width || e.cv.height !== im.height) {
      const cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      e = { cv, tr: -4, tg: -4, tb: -4 };   // −4 哨兵：永不命中量化桶(≥−3..255)
      this.menuTintBufs.set(n, e);
    }
    const qr = Math.round(t[0] * 255) & ~3, qg = Math.round(t[1] * 255) & ~3, qb = Math.round(t[2] * 255) & ~3;
    if (e.tr !== qr || e.tg !== qg || e.tb !== qb) {
      const g = e.cv.getContext('2d')!;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, e.cv.width, e.cv.height);
      g.drawImage(im, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgb(${qr},${qg},${qb})`;
      g.fillRect(0, 0, e.cv.width, e.cv.height);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(im, 0, 0);
      g.globalCompositeOperation = 'source-over';
      e.tr = qr; e.tg = qg; e.tb = qb;
    }
    return e.cv;
  }

  /** menuMode 实例释放（MenuBackground.destroy 调用；游戏内 Renderer 实例永不调）。
   *  烘焙画布立刻还回后备（不等 GC，菜单双开预算紧） */
  dispose(): void {
    for (const e of this.menuTintBufs.values()) { e.cv.width = 0; e.cv.height = 0; }
    this.menuTintBufs.clear();
    this.imgs.clear();
  }

  // ---- SunGradients.BackgroundDrawers(SunGradients.cs:175-189,2026-08-20 原版化)----
  /** 13 项渐变带表:[颜色, bgAlphaFrontLayer 槽, 纹理判定集]——活动槽的选型
   *  纹理表包含判定 id 时,以 colorgradientdither 在背景树顶画渐隐带(把
   *  群系背景结构顶部融进天空)。Draw() 见 SkyRenderer.drawHorizonGradients。 */
  surfaceGradientBands(): Array<{ rgb: readonly [number, number, number]; alpha: number }> {
    const out: Array<{ rgb: readonly [number, number, number]; alpha: number }> = [];
    const has = (ids: readonly number[], check: readonly number[]) =>
      check.some((c) => ids.includes(c));
    // 森林四槽(0/10/11/12 = treeBGSet1-4):每槽双带 @176/@179
    const forestSlots = [Forest1, Forest2, Forest3, Forest4];
    for (const slot of forestSlots) {
      const seg = slot === Forest1 ? 0 : slot === Forest2 ? 1 : slot === Forest3 ? 2 : 3;
      const st = FOREST_STYLES[this.forestStyles[seg] % FOREST_STYLES.length];
      const ids = [...st.m, ...st.t];
      const a = this.alphaFront[slot];
      if (a > 0) {
        if (has(ids, [176])) out.push({ rgb: [116, 191, 255], alpha: a });
        if (has(ids, [179])) out.push({ rgb: [157, 192, 255], alpha: a });
      }
    }
    // 沙漠 @248（样式 4 的 Pure 组;槽感知——侵染列/兜底画不含 248）
    if (this.alphaFront[Desert] > 0
      && has(this.activeDesertTriple().filter((n) => n >= 0), [248])) {
      out.push({ rgb: [184, 211, 245], alpha: this.alphaFront[Desert] });
    }
    // 雪原 @263/268/269（结构化行拉平含山体对）
    if (this.alphaFront[Snow] > 0) {
      const srow = rowTexIds(this.styleRow('tint-snow', SNOW_STYLES, this.snowStyle));
      if (has(srow, [263, 268, 269])) out.push({ rgb: [169, 241, 255], alpha: this.alphaFront[Snow] });
    }
    // 丛林双带 @59/@284
    if (this.alphaFront[Jungle] > 0) {
      const jids = JUNGLE_STYLES[this.jungleStyle];
      if (has(jids, [59])) out.push({ rgb: [220, 255, 109], alpha: this.alphaFront[Jungle] });
      if (has(jids, [284])) out.push({ rgb: [141, 232, 131], alpha: this.alphaFront[Jungle] });
    }
    // 海洋 @283（SunGradients.cs:218 BackgroundDrawers 末项:new Color(157,192,255),
    // weight = bgAlphaFrontLayer[4]【前】槽,Ocean() :221-224 yield Main.oceanBG——
    // 仅当本世界海洋变体贴图 == 283 时点带;其余 7 个海洋变体(28/110/111/209/210/332/340)无带)
    if (this.alphaFront[Ocean] > 0 && this.oceanTexId() === 283) {
      out.push({ rgb: [157, 192, 255], alpha: this.alphaFront[Ocean] });
    }
    return out;
  }

}