// TileShine — Main.tileShine2 / Main.shine tile 顶点色提亮通道移植（蓝队 2026-09-07）
//
// 【用户实报】"生命水晶（水晶之心）暗处看不见"——tiles.ts:156 crystal_heart 挂账
//   "暗处可见性归 Main.tileShine[12]=300 闪光（未实装，登记债）"的本体即本通道：
//   原版 tile 12（Heart）无静态光（无 tileLighted、ApplyTileLight 主 switch 无
//   case 12），但 sprite 绘制顶点色带 ×1.6 提亮（Main.tileShine2[12]=true，
//   Main.cs:7298），暗处本体呈暗红可读——这正是原版截图"暗处本体可见"的机制，
//   本仓此前缺此通道。
//
// 【原版权威面（1457 反编译逐句核对）】
//   · TileDrawing.cs:4429-4441 GetFinalLight(Vector3 主批路径)：
//       tileLight *= tint; if (inActive) actColor;
//       else if (ShouldTileShine(type, frameX)) Main.shine(ref tileLight, type);
//     （Color 重载 :4394-4417 多一道 fullbrightBlock→White 前置门，其余同序）
//   · TileDrawing.cs:4443-4471 ShouldTileShine：
//       (shimmerAlpha>0 && tileSolid[type]) || type==165 || 693 || 694 → true；
//       !tileShine2[type] → false；467/468 frameX∈[144,178)；21/441 frameX∈[36,178)；
//       default → true
//     ★F6a（2026-09-08）：tileShine2[185]/[186] 是【按帧动态赋值】的成员
//       （TileDrawing.cs:5223-5231/:5239-5247 GetTileDrawData 内逐格写表；
//       DrawSingleTile :884 GetTileDrawData 先于 :1028 GetFinalLight → 每格自洽，
//       无跨格泄漏）：185 = frameY==18 ∧ frameX∈[576,882]（双端闭）、
//       186 = frameX∈[864,1170]（双端闭）——上界闭与 467/468 的 <178 开区间不同源。
//       机制 = 入 SHINE2_SHEETS + shouldTileShine 帧门（frameY 形参为 185 新增）。
//   · Main.cs:21868-21951 Main.shine(ref Vector3, type)：num=0.6 缺省；逐 case 乘区
//       （全表见 shineMultiplier）；case 262-268 = XYZ += 0.39【加法支】；
//       default = tileShine2[type] → 全通道 ×1.6；尾段 shimmerAlpha>0 时向
//       (1.2,1.0,1.6) 逐通道 lerp 并钳 1（shimmerShine 全库仅此一处赋值）。
//   · Main.tileShine2 全表（Main.cs:7276-7331 区块 + :7656/:9792/:10141-10155/
//       :10212/:10315/:10420-10431 散点 + :10478-10481 循环 262..268）= 59 静态型
//       + 2 动态型（185/186,TileDrawing.cs 逐格按帧赋值,见 ShouldTileShine 注）
//       = 61 条目，见 SHINE2_SHEETS。
//
// 【架构落点（为什么是"合成前 lighter 加进世界层"）】本仓 tile = 世界层画未调色
//   sprite → compositeLight 全层乘光照图；逐格顶点色通道不存在（荧光涂层叠层
//   drawCoatGlowGrid 先例 = 合成后叠，但那要求逐格采样 lightAt 且低清档与拉伸后
//   底图错位）。乘法支 delta = sprite×L×(k−1)：在【合成前】以 'lighter' 加进世界层，
//   合成乘光后 = (底图 + delta)×L = sprite×L×k —— 与底图同乘同一光照图，数学恒等，
//   且与世界层内后画的实体/前景水保持原版 tile 批次覆盖序（实体盖掉所站格的
//   shine，原版顶点色同理）。+0.39 加法支（262-268 Gemspark）原版加在
//   【顶点色(光)】上、与 L 无关 → 必须合成后平加（drawTileShineAdditive，
//   设备矩形仿 drawCoatGlowGrid 先例）。
//
// 【缓存】每 chunk 一张 256² 乘法 delta 画布（已烘焙 delta 色）+ 一张 +0.39 平加
//   画布（懒分配），WeakMap<ChunkPair> 键控——ChunkCache 重烘焙恒新建 pair 对象
//   （ChunkCache.ts:532 `pair = { wall, tile, ... }`），pair 身份变更 = 底图重烘
//   信号，与底图重烘节奏天然同源（油漆/涂层/宝箱姿态失效链零侵入复用）。
//   cache 键含 shimmerAlpha 量化档（重烘节流）。逐帧动态支：动画格（12 生命水晶/
//   639 魔力水晶——TILE_ANIM_RATE 表，TileAnim.ts:37/:99）与脉动矿（204 Crimtane/
//   211 Chlorophyte，tint 随 mouseTextColor 呼吸）不进 chunk 烘焙（烘焙会冻结
//   呼吸/引发重烘风暴，机制同 ChunkCache"动画格不进烘焙"判例），逐帧小scratch
//   直绘——屏内数量级：水晶个位数、脉动矿数十，成本有界。
//
// 【登记近似】① case 25 黑曜石 delta = (−0.05,−0.15,+0.1)——'lighter' 加法无法
//   表达负 delta，负通道钳 0（仅此一型，量级 ≤0.15×L）。② 原版钳 1 发生在【光】上
//   （min(1, L×k)）；本仓钳位发生在画布合成（min(255, sprite×L×k)）——仅 L×k>1 且
//   texel<255 的亮区有差（暗区恒精确，即本通道的目标域）。③ 动画/脉动逐帧支用
//   逐格设备矩形（与 drawAnimatedTileLayer dev 数学同式）；?dynsnap0 逃生门下底图
//   走世界坐标线性映射，与设备矩形差 ≤0.5px（乘法 delta 的半像素错位不可感）。
//   ④ Main.tileSolid 取值：vanilla-journeycat.json tileSolid 字面量表优先，表外
//   回落 TILE_DEFS.solid（平台族 repo=false 与原版 tileSolid=true 有差，仅影响
//   shimmer 支归类）。⑤ 动态支 scratch 经 tileTop/dyOff 后整幅锚定「世界格左上」
//   设备位，与 drawAnimatedTileLayer 的盒顶锚定在 dyOff≠0 时差 ≤1px（shine2 动态
//   族 12/639 dyOff=0，实际恒精确）。
import { CHUNK, TILE } from '../core/constants';
import { TILE_DEFS } from '../data/tiles';
import catRaw from '../data/vanilla-journeycat.json';
import type { SpriteAtlas } from '../assets/SpriteAtlas';
import type { World } from '../world/World';
import { ChunkCache, type ChunkPair } from './ChunkCache';
import { TileStore } from '../world/TileStore';
import { drawVanillaCell, chestLidPoseAt, chestPoseSheet } from './VanillaTiler';
import { frameMergesWith } from './TileMergeFamily';
import { isDynamicAnimSheet, tileAnim, TILE_ANIM_RATE } from './TileAnim';
import { bumpTexEpoch } from './texId';   // ★债1 池化身份税:池画布原地重烘=覆写,shim er: 键换代
import { getTilePaintSettings, type LeafPaintSettings } from '../world/Paint';
import { tintRegion } from './TileTint';
import type { Camera } from './Camera';
import { swPerf } from './perfFlags';   // ★BJ94 D2 每帧去重集复用快路径

// ---- ★BJ94 D2（2026-09-16 渲染性能域分配普查）：planShineWork/scheduleShineBakes
// 每帧各重建 1 个 seen 去重集（scripts/_bj94-set-census.mjs 构造器计数子类法实锤：
// 各 1 次/帧）。两集均【局部不逃逸】（不返回不外存，函数返回后即弃）且【无重入】
// （planShineWork 纯函数不自调；scheduleShineBakes 先调完 planShineWork 再用本槽，
// 两个槽严格先后不重叠）→ 模块级复用槽，clear 后就地重填与每帧新建逐位同值。
// swPerf 快路径消费；flag 关 = 原地 new（旧行为逐位不变）。
const BJ94_SEEN_PLAN = new Set<ChunkPair>();
const BJ94_SEEN_SCHED = new Set<ChunkPair>();

// ---- Main.tileShine2 全表（Main.cs 赋值点见文件头；名字取 Terraria.ID.TileID.cs）----
export const SHINE2_SHEETS: ReadonlySet<number> = new Set([
  6, 7, 8, 9,            // Iron/Copper/Gold/Silver 矿（TileID.cs:449-455）
  12,                    // Heart 生命水晶（:461）
  21,                    // Containers 宝箱（:479）
  22,                    // Demonite（:481）
  25,                    // Ebonstone（:487）
  45, 46, 47,            // Gold/Silver/Copper Brick（:527-531）
  63, 64, 65, 66, 67, 68,// Sapphire/Ruby/Emerald/Topaz/Amethyst/Diamond 宝石矿（:563-573）
  107, 108, 111,         // Cobalt/Mythril/Adamantite（:651-659）
  117,                   // Pearlstone（:671）
  121, 122,              // Cobalt/Mythril Brick（:679-681）
  147,                   // SnowBlock（:731）
  161, 163, 164,         // IceBlock/CorruptIce/HallowedIce（:759-765）
  166, 167, 168, 169,    // Tin/Lead/Tungsten/Platinum（:769-775）
  178,                   // ExposedGems（:793）
  185, 186,              // ★F6a SmallPiles/LargePiles（Main.cs 无静态赋值——TileDrawing.cs:5223-5231/:5239-5247 按帧动态赋值,帧门在 shouldTileShine;本仓 v_185_small_decos/v_186_decos_3x2 在册=活成员）
  204,                   // Crimtane（:845）
  211,                   // Chlorophyte（:859）
  221, 222, 223,         // Palladium/Orichalcum/Titanium（:879-883）
  262, 263, 264, 265, 266, 267, 268, // Amethyst..Amber Gemspark（:961-973;Main.cs:10478 循环）
  346, 347, 348,         // ChlorophyteBrick/CrimtaneBrick/ShroomitePlating（:1129-1133）
  370,                   // MeteoriteBrick（:1177）
  407,                   // FossilOre（:1251）
  441, 467, 468,         // FakeContainers/Containers2/FakeContainers2（:1319-1373）
  566,                   // AmberStoneBlock（:1569）
  639,                   // ManaCrystal 魔力水晶（:1715）
  680, 681, 682, 685, 686, // Ancient 金/银/铜/钴/秘银砖（:1797-1809）
]);

/** Main.shine case 204(Crimtane)/211(Chlorophyte) 脉动支：num = 0.3 +
 *  mouseTextColor/300（Main.cs:21886/:21892；mouseTextColor 190↔255 步进 1/帧 =
 *  呼吸）。tint 逐帧变 → 不进 chunk 烘焙，走 drawTileShineGrid 逐帧动态支。 */
export function isPulseShineSheet(sheet: number): boolean {
  return sheet === 204 || sheet === 211;
}

/** Main.shine 加法支：case 262-268 Gemspark 顶点色 += 0.39（switch case 直落 break，
 *  不吃 ×1.6 缺省支）。两个重载形态：Vector3 重载（Main.cs:21920-21930,GetFinalLight
 *  Vector3 路 :4438 消费）XYZ += 0.39；Color 重载（Main.cs:21828-21830,:4424 消费）
 *  逐通道 +100/255 后尾段钳 255（:21850-21856）——亮处（L≈1 的 Gemspark 自光域）
 *  +0.39 被钳没。交付层 = 合成后平加（drawTileShineAdditive,精度边界见其注）。 */
export const SHINE_ADDITIVE = 0.39;
export function isAdditiveShineSheet(sheet: number): boolean {
  return sheet >= 262 && sheet <= 268;
}

/** Main.shine 逐 case 乘区（Main.cs:21874-21927 全 case 提取；Vector3 重载，
 *  未列通道 = ×1）。default 支 = tileShine2[type] → 全通道 ×(1+0.6)。 */
export function shineMultiplier(sheet: number, mouseTextColor: number): [number, number, number] {
  switch (sheet) {
    case 25:    return [0.95, 0.85, 1.1];            // :21875-21879
    case 117:   return [1.1, 1, 1.2];                // :21880-21884（Y 不动）
    case 204: {                                      // :21885-21890（X×1.3×num）
      const num = 0.3 + mouseTextColor / 300;
      return [1.3 * num, 1, 1];
    }
    case 211: {                                      // :21891-21896（Y×1.5×num Z×1.1×num）
      const num = 0.3 + mouseTextColor / 300;
      return [1, 1.5 * num, 1.1 * num];
    }
    case 147:                                        // :21897-21901（147/161 同支）
    case 161:   return [1.1, 1.12, 1.15];
    case 163:   return [1.05, 1.1, 1.15];            // :21902-21906
    case 164:   return [1.1, 1.1, 1.2];              // :21907-21911
    case 178:   return [1.5, 1.5, 1.5];              // :21912-21917（num4=0.5）
    // case 185/186（SmallPiles/LargePiles ×1.3,Main.cs:21913-21919）——★F6a 销账：
    //  旧注"tileShine2[185/186] 无赋值（全库 grep 零命中）→ dead for tiles"系
    //  截断假象：TileDrawing.cs:5223-5231/:5239-5247 GetTileDrawData 按堆叠帧
    //  【动态赋值】（185: frameY==18 ∧ frameX∈[576,882]；186: frameX∈[864,1170]），
    //  这些帧原版吃 ×1.3（帧门见 shouldTileShine）。
    case 185:
    case 186:   return [1.3, 1.3, 1.3];
    case 262:                                        // :21924-21931 加法支（不走乘法）
    case 263:
    case 264:
    case 265:
    case 266:
    case 267:
    case 268:   return [1, 1, 1];
    default:
      // :21932-21939 default：tileShine2[type] → ×(1+num)，num=0.6
      return SHINE2_SHEETS.has(sheet) ? [1.6, 1.6, 1.6] : [1, 1, 1];
  }
}

/** Main.shine 尾段 shimmer lerp（Main.cs:21940-21953）：shimmerAlpha>0 时向
 *  shimmerShine(1.2,1.0,1.6) 逐通道 lerp → 乘子 (1+0.2a, 1, 1+0.6a)。
 *  原版 lerp 后逐通道钳 1（钳在光上）；本仓钳位在合成（登记近似②）。 */
export function shimmerTailMultiplier(shimmerAlpha: number): [number, number, number] {
  if (shimmerAlpha <= 0) return [1, 1, 1];
  return [1 + 0.2 * shimmerAlpha, 1, 1 + 0.6 * shimmerAlpha];
}

/** ShouldTileShine 1:1（TileDrawing.cs:4443-4471）。vanillaSolid = Main.tileSolid[type]。
 *  ★F6a：frameY 形参（缺省 0,既有调用面零改动）——仅 185 的动态赋值帧门需要
 *  （TileDrawing.cs:5223-5231 `tileFrameY == 18 && tileFrameX >= 576 && <= 882`）；
 *  186 只看 frameX（:5239-5247）。两门上界【闭】区间,与 467/468 的 <178 开区间
 *  不同源,勿归一。 */
export function shouldTileShine(
  sheet: number, frameX: number, vanillaSolid: boolean, shimmerAlpha: number,
  frameY = 0,
): boolean {
  if ((shimmerAlpha > 0 && vanillaSolid) || sheet === 165 || sheet === 693 || sheet === 694) {
    return true;
  }
  if (!SHINE2_SHEETS.has(sheet)) return false;
  if (sheet === 185) return frameY === 18 && frameX >= 576 && frameX <= 882;  // :5223-5231 动态帧门
  if (sheet === 186) return frameX >= 864 && frameX <= 1170;                  // :5239-5247 动态帧门
  if (sheet === 467 || sheet === 468) return frameX >= 144 && frameX < 178;   // :4463-4468
  if (sheet === 21 || sheet === 441) return frameX >= 36 && frameX < 178;     // :4469-4474
  return true;                                                                // :4475 default
}

// Main.tileSolid：journeycat 字面量表优先（TileID.cs/Main.cs 字面量提取），表外回落
// repo def.solid（登记近似④）。memoize：动态支逐帧查询。
const SHEET_SOLID = new Map<number, boolean>();
function vanillaTileSolid(sheet: number): boolean {
  let v = SHEET_SOLID.get(sheet);
  if (v === undefined) {
    const hit = (catRaw as { tileSolid?: Record<string, number> }).tileSolid?.[String(sheet)];
    v = hit !== undefined ? hit !== 0
      : !!TILE_DEFS.find((d) => d?.vanilla?.sheet === sheet)?.solid;
    SHEET_SOLID.set(sheet, v);
  }
  return v;
}

/** 乘法 delta（(k−1)⁺ 逐通道；负通道钳 0——登记近似①）。null = 零 delta（跳过）。 */
export function shineDelta(
  sheet: number, mouseTextColor: number, shimmerAlpha: number,
): [number, number, number] | null {
  const k = shineMultiplier(sheet, mouseTextColor);
  const tail = shimmerTailMultiplier(shimmerAlpha);
  const dR = Math.max(0, k[0] * tail[0] - 1);
  const dG = Math.max(0, k[1] * tail[1] - 1);
  const dB = Math.max(0, k[2] * tail[2] - 1);
  if (dR <= 0 && dG <= 0 && dB <= 0) return null;
  return [dR, dG, dB];
}

// ---- ★IIIII249 巡航烘焙时间盒（?shinebudget=<ms>）——flag 解析与取证面 ----
//
// 【背景】IIIRS247 实测 transit 最差帧 66.4ms = 本通道巡航烘焙链（drawImage 72%）。
//   :442 既有「每帧 2 chunk」固定计数预算的分帧不充分：chunk 烘焙成本随高光格
//   密度浮动，密集砖区单 chunk 可达数十 ms，2 chunk 仍可整帧爆掉。
// 【语义】?shinebudget=<ms>（如 shinebudget=4）启用毫秒时间盒：预算窗内逐 chunk
//   ensureEntry，超线剩余 chunk 标记待烘（pendingQ）下一帧优先续烘（先到先得 +
//   chunk 中心与相机中心距离升序）；缓存命中/已烘 chunk 永不重烘。
//   缺省（不传参/解析失败）= 现行「每帧 2 chunk」计数预算【逐位不变】；
//   shinebudget=0 = 显式关（转正后的反向逃生门）。
// 【零随机备案】stampShineCell/bakeShineChunk 全链（drawVanillaCell/chestLidPoseAt/
//   tintRegion/applyPaintTint*/getTilePaintSettings/frameMergesWith/animFrameIdx）
//   无任何随机数消费（全仓 grep 定谳：Paint.ts:720 Math.random 仅涂层刮除尘钩子
//   paintCoatDustColor，不在烘焙可达路径；TileTint.ts:124 为 Map 迭代序，确定性）。
//   ⇒ 延迟烘焙/断行续烘不重排任何 RNG 流，闪光变体分配与一次烘完逐位恒等。

/** 解析 ?shinebudget=<ms>（纯函数，单测面）。null=未传/无效；0=显式关（逃生门=
 *  回落计数预算）；>0=时间盒毫秒/帧。小数向下取整；负数/非有限=容错视同未传。
 *  ★IIIRS249→转正(2026-09-14 用户验收)：缺省启用 4ms 时间盒（shineBudgetMs 兜底
 *  null→4），shinebudget=0 为反向逃生门。 */
export function parseShineBudget(search: string): number | null {
  if (!search) return null;
  const raw = new URLSearchParams(search).get('shinebudget');
  if (raw === null) return null;
  const v = Math.floor(Number(raw));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

// ---- ★shineslice（2026-09-28 登记债清算）:动态 shine 切片上 GPU ----
//
// 【病灶】动态支逐格 stampShineCell=共享 scratch 全幅上传（40×40=6.4KB/格/帧,
//   uploadScratchNow texRefresh）+同量 getImageData 读回（重放快照）——叶绿素
//   农场数百脉动格在视 = MB 级/帧上传+读回。
// 【正解】逐 (格,动画相位) 稳定键切片上 GPU：纹理=sprite-only 面（delta
//   不烘进纹理）首见上传、稳态零上传零读回;delta=乘法 tint 走消费 rec 顶点色
//   （BakeSnap.tint → quadSprite uTint——呼吸扫频逐帧变的是 4B 顶点色不是纹理）。
//   键=格位+内容指纹（shineSliceCellKey:3×3 邻域 type/flags/half/slope/帧/漆 +
//   帧相位;★位键零碰撞——211 等 2×2 组 auto 框架按绝对奇偶取组位,纯内容指纹
//   曾在同指纹异帧格间碰撞=错帧,census 实锤后改位键+指纹双段;指纹段管内容
//   变化失效）。与 shineCell 帽 1024 既有锁兼容=键空间共用 shineKeySeen 帽账
//   （GLShimExecutor.uploadShineSlice 统一清扫）。
// 【旗】★转正（2026-09-29 用户拍板）缺省开:动态 shine 逐格上传 1875KB/帧（300 格
//   农场）→稳态 0（首见一次后键缓存+顶点色 delta）;像素 md5 逐位全等。
//   ?shineslice=0=逃生门（回逐格上传旧链逐位）。node 恒关（location 判活——
//   ★刀I 定谳 2026-09-29:document 判死会被测试桩的裸 document 全局（pixel-art 等
//   捕 fillStyle 用）误判活 → node 下 location.search ReferenceError（7 处红:
//   pixel-art/bj314-arc-tint-cache）。守卫改判 location,与 AudioGate/AssetCache
//   同判据;浏览器面语义零变。）
export let shineSliceGl = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('shineslice') !== '0' : false;
export function shineSliceGlSetForTest(v: boolean): void { shineSliceGl = v; }

/** 切片接管钩（Renderer 启动期注册;返回 true=GL 侧已接管本格——调用方跳过
 *  delta 乘法支,2D 面保 sprite-only、乘法由 GL quad tint 承担）。非 shim 会话
 *  内部自判返回 false（2D 烘焙原链）。 */
let shineScratchSliceHook:
  ((c: HTMLCanvasElement, key: string, tint: readonly [number, number, number]) => boolean) | null = null;
export function setShineScratchSliceHook(
  fn: ((c: HTMLCanvasElement, key: string, tint: readonly [number, number, number]) => boolean) | null,
): void {
  shineScratchSliceHook = fn;
}

/** 模块装载期解析（?glband 先例：渲染模块直读 location；Node/vitest 无 location=0=缺省路径）。
 *  ★滚屏降级旗面（2026-10-03 主刀,第 0 刀 A/B 定谳后）：`shineBudgetExplicit` =
 *  URL 是否【显式】传 shinebudget——显式（含 0 逃生门 / N 任意档）=逐字尊重、
 *  永不自适应（确定性仪器面,探针/独立复核可复现）；仅【缺省】（未传参,隐式
 *  4ms）吃相机滚屏降级（adaptiveShineBudgetMs）。不立新旗的最小面：
 *  `?shinebudget=4` 即「本刀前行为逐字」逃生门,`0`=计数预算路径,
 *  `__SW_SHINE_OFF`=整通道秒关,全部原样保留。Node/vitest 无 location →
 *  explicit=null 且 shineBudgetMs=0（计数路径,既有单测断言不变）。 */
export const shineBudgetExplicit: number | null =
  typeof location !== 'undefined' && typeof location.search === 'string'
    ? parseShineBudget(location.search)
    : null;
export const shineBudgetMs: number =
  typeof location !== 'undefined' && typeof location.search === 'string'
    ? shineBudgetExplicit ?? 4
    : 0;

// ---- ★滚屏降级（2026-10-03 主刀;第 0 刀 A/B 定谳=scripts/_shine-ab-fall.mjs 三臂）----
//
// 【A/B 定谳】同种子同竖井（用户真实导出档 loadJson,seed 118606602,井筒 x∈[1614,1632]）
//   自然下坠（vy 600px/s 与 x-ray 基线一致）,1280×800 dpr2,120Hz,慢帧阈 12.5ms,
//   分段=player.y 带归属,腐化带（620-1150t,黑曜石墙=shine2 密集）vs 石带（无 shine2）：
//   · 缺省(4ms 盒)     腐化带 33.0/s 均帧距 14.7ms(忙机 3 跑 12.8-33.0;闲机 10.1/s 9.26ms)
//   · shinebudget=0    腐化带 11.5/s 均帧距 12.2ms p95 34.3ms——计数路径整 chunk 无盒
//                      烘焙=10-30ms hitch,【不是干净逃生门】(石带 0.8/s 佐证)
//   · __SW_SHINE_OFF   腐化带 2.3/s 均帧距 8.54ms ≈ 石带 1.9/s——群系差消失=主因闭环
//   与 x-ray 报告（下坠慢帧主因=本通道 4ms 盒;stampShineCell→drawImage 占慢帧窗
//   26.7%;石带骤降反证）机制一致。修正=【有盒降级】而非回计数路径。
// 【方案 a（选定;弃 b/c 的证据面】b(与底图 bakeBudgetMs 共享):shineoff 臂显示滚屏态
//   底图管线本身干净（8.54ms≈vsync 8.33）,无竞争证据——不立;c(滚动方向预烘提前量):
//   1.5ms 盒吞吐已≈滚入需求,且 pendingQ 上限 128+静止 4ms 恢复排干——复杂度不值。
// 【视觉容忍度】shine 层=提亮 delta;滚屏中视口每帧位移 5-10px,新 chunk 的 delta 晚到
//   数帧不可感（ensureEntry 预算外语义=旧档顶替/跳过,既有 stale 面复用,零新机制）;
//   静止即回 4ms,pendingQ 就地排干;烘焙产物与一次烘完逐位恒等（零随机备案
//   TileShine.ts:240 + 行断点续烘恒等;_shine-ab-fall 探针 shineDebugChunkDigests
//   逐位对拍实证,见 tests/shine-transit-degrade.test.ts 锁）。
/** 滚屏速度阈（px/ms）。0.35≈350px/s：步行 ~264px/s 不触发（留 30% 裕度）,
 *  下坠 ~600px/s 触发（40% 裕度）;坐骑/药水加速态照抄降级（transit 语义同域）。 */
export const SHINE_TRANSIT_SPEED = 0.35;
/** 滚屏态时间盒下限（ms）。任务域 1-2ms 取中：4ms×120fps=480ms/s(帧预算 48%) →
 *  1.5ms×~118fps≈177ms/s(15%),为 bakeMs 记账与腐化带 <8/s 目标的定参。 */
export const SHINE_TRANSIT_BUDGET_MS = 1.5;

/** 滚屏降级预算（纯函数,单测面）。explicit!==null=逐字返回（含显式 0——上层以
 *  `shineBudgetMs>0` 门住计数路径,本函数不管路径选择只管毫秒值）;否则速度超阈
 *  → 盒压到 SHINE_TRANSIT_BUDGET_MS（baseMs 更小时取 baseMs,只降不升）。 */
export function adaptiveShineBudgetMs(
  explicit: number | null, speedPxPerMs: number, baseMs = 4,
): number {
  if (explicit !== null) return explicit;
  return speedPxPerMs > SHINE_TRANSIT_SPEED ? Math.min(baseMs, SHINE_TRANSIT_BUDGET_MS) : baseMs;
}

/** 帧间相机速度状态（drawTileShineGrid 每帧恰一次;探针/单测经 reset() 复位）。 */
export const shineCamSpeed = {
  lastX: NaN, lastY: NaN, lastT: 0,
  reset(): void { this.lastX = NaN; this.lastY = NaN; this.lastT = 0; },
};

/** 帧间相机位移速度（px/ms）。首帧（lastX=NaN）/dt≤0/长缝 dt≥250ms（暂停恢复/
 *  长卡顿——慢速长缝≠滚屏）不计速=视静止 0;瞬移（大位移短 dt）=高速→触发降级,
 *  语义正确（黑幕传送/回卷同为滚屏态）。写后即更新状态（纯推进,无重入）。 */
export function cameraSpeedPxPerMs(camX: number, camY: number, now: number): number {
  const dt = now - shineCamSpeed.lastT;
  const first = !Number.isFinite(shineCamSpeed.lastX);
  const prevX = shineCamSpeed.lastX, prevY = shineCamSpeed.lastY;
  shineCamSpeed.lastT = now;
  shineCamSpeed.lastX = camX;
  shineCamSpeed.lastY = camY;
  if (first || dt <= 0 || dt >= 250) return 0;
  return Math.hypot(camX - prevX, camY - prevY) / dt;
}

// ---- ★挖掘相首曝重烘单帧钳制（2026-10-04 主刀;WASM 双旗 trace x-ray 定谳）----
//
// 【定谳（机制级,逐支核对 ensureEntry 六条烘焙支）】首曝冷烘焙在缺省浏览器路径
//   走 scheduleShineBakes 的 deadline 盒（bakeShineChunk 收死线,行首断行）——
//   【严格意义上盒是接上的,并非无盒裸烘】;观测爆发由三个盒上/盒外成分构成:
//   ①盒值：挖掘相相机基本静止 → 速度门（SHINE_TRANSIT_SPEED）不触发 → 缺省盒
//     恒 4ms/帧,持续挖掘每帧烧满（36s 单秒爆发 176ms/s=32 慢帧直接成因;滚屏
//     降级刀只覆盖相机移动域,挖掘相在其门外）。
//   ②行粒度过冲：bakeShineChunk 死线只在行首检查（:735）,一行 16 格 stamp 链
//     （每格 ~7 次画布操作）在 shine2 密集地形（黑曜石/雪/宝石矿）单行可达
//     ~2ms+ —— x-ray「drawImage 单帧可达 ~2ms+」的构成是一行而非单格;超线后
//     剩余 chunk 入 pendingQ 顺延=既有机制在。
//   ③指纹 mix2 盒外：shineChunkFingerprint 在 budgetExhausted 判定【之前】执行
//     （schedule memo 门 :945 先于 :959;首曝 memo 门 :1001 先于 :1014）,且每个
//     pending-needy chunk 每帧至多 2 次（schedule 循环一次 + 扫描循环
//     SHINE_NO_BAKE 跳过路径同样先过指纹门）,冷烘焙另有烘后重算（:1029 存 memo）
//     → mix2 435ms/36s。
// 【修】①爆发闩（本节）：上一帧发生过首曝冷烘焙（bakes）或冷跳过（skips）⇒
//   本帧缺省盒压到 SHINE_TRANSIT_BUDGET_MS（与滚屏态盒一致;显式 shinebudget
//   逐字语义不吃闩=确定性仪器面;计数路径 Node/vitest/explicit=0 无 schedule
//   不触闩）。挖掘停止 → 无冷工作 → 闩自清 → 静止恢复排干回 base 盒（滚屏 A/B
//   方案 a 的「静止 4ms 恢复」语义零变——resume 不计 bakes/skips）。超线 chunk
//   入 pendingQ 顺延=既有机制（partial→needy→pendingQ;skipped→null→pendingQ）。
//   延迟烘焙不改产物（零随机备案 :240 + 行断点续烘逐位恒等锁 shine-transit-degrade）。
//   ②指纹脏标缓存（shineFpCache,见 shineChunkFingerprintCached 注）。
export const shineBurstLatch = { active: false, reset(): void { this.active = false; } };

/** 爆发闩钳制（纯函数,单测面）。闩 active 且缺省（explicit=null）⇒ 压到
 *  SHINE_TRANSIT_BUDGET_MS（只降不升,tbNow 更小时取 tbNow）;显式传参逐字
 *  （确定性仪器面永不自适应,与 adaptiveShineBudgetMs 同纪律）。 */
export function shineBurstClamp(
  tbNow: number, explicit: number | null = shineBudgetExplicit,
): number {
  if (explicit !== null || !shineBurstLatch.active) return tbNow;
  return Math.min(tbNow, SHINE_TRANSIT_BUDGET_MS);
}

/** 时间盒模式逐帧计数（仅 shineBudgetMs>0 的调度路径推进；缺省路径零成本零触碰）。
 *  探针消费面：bakes 停涨+hits 单调 = 缓存无重烘抖动；catchup* = chunk 出现→完成帧数。 */
export const shineStats = {
  frames: 0,        // 预算模式 drawTileShineGrid 帧数
  ensures: 0,       // 调度相 ensureEntry 调用数
  hits: 0,          // 档位全等且已完成（零烘焙命中）
  resumes: 0,       // 断行续烘
  resumesStalled: 0, // 续烘零进展次数(断行行号未动)——诊断面
  bakeMs: 0,         // 烘焙链毫秒累计(时间盒模式;帧时归因面)
  bakes: 0,         // 全新烘焙（含超线部分烘焙）
  memoHits: 0,      // ★IIIII252 跨 pair memo 指纹命中（零重烘复用）
  memoMisses: 0,    // ★IIIII252 指纹未命中（真改动/冷条目，落回常规路径）
  stale: 0,         // 超线最近档旧帧顶替
  skips: 0,         // 超线首烘跳过（null）
  pending: 0,       // 帧初待烘队列长度（上一帧遗留）
  immediate: 0,     // 出现当帧即烘完的 chunk 数（追赶 0 帧）
  catchupMax: 0,    // 单 chunk 出现→完成最长帧数
  catchupN: 0,      // 追赶样本数
  catchupSum: 0,    // 追赶帧数累计（均值 = catchupSum/catchupN）
  // ---- ★债1 画布池化（2026-10-06）----
  canvasesAcquired: 0, // bake 侧画布获取总数（池取+新建）
  canvasesCreated: 0,  // 其中真 createElement 数（=孤儿 GC churn 上游；池化后≈池填充量）
  poolHits: 0,         // 池取出现次数
  poolReturns: 0,      // 死点归还入池张数
  poolOverflow: 0,     // 死点但池满回落 GC 张数（=旧行为残面）
  // ---- ★债2 跨 pair 行级 carry（2026-10-06）----
  carries: 0,          // 换代时前缀凭证校验通过、partial 条目被新 pair 收养次数
  carriedRows: 0,      // 收养保全的已烘行数（Σ resumeRow；≈免重 stamp 的行数）
  carriesMiss: 0,      // 凭证不匹配（真编辑落在已烘依赖域）→ 落回从 0 重烘次数
  reset(): void {
    for (const k of Object.keys(this) as (keyof typeof this)[]) {
      if (typeof this[k] === 'number') (this as unknown as Record<string, number>)[k] = 0;
    }
  },
};

// ---- 绘制层 ----

export interface ShineChunkEntry {
  /** 乘法 delta 层（合成前 'lighter' 叠进世界层；undefined = 本 chunk 无乘法支格） */
  mul?: HTMLCanvasElement;
  /** +0.39 平加层（合成后叠；undefined = 本 chunk 无 Gemspark 格） */
  add?: HTMLCanvasElement;
  _mulCtx?: CanvasRenderingContext2D;
  _addCtx?: CanvasRenderingContext2D;
  shimmerQ: number;
  /** ★IIIII249 时间盒部分烘焙断行标记：>0 = 已烘 [0.._resumeRow) 行,下帧续烘；
   *  undefined = 烘完（现行路径恒 undefined = 零行为差）。★债3（2026-10-06）：
   *  断行粒度下沉到格级——_resumeRow = 断点行号（首个未 stamp 的行）。 */
  _resumeRow?: number;
  /** ★债3 格级断行：断点行内列号 = 该行首个未 stamp 的格（0 = 行首,与旧行级
   *  语义一致;与 _resumeRow 成对写入,烘完同清）。续烘从 (row,col) 精确续起,
   *  不重踏任何已 stamp 格（不变量与行级断点同源,见 bakeShineChunk 注）。 */
  _resumeCol?: number;
  /** ★债2 carry 凭证：暂停时刻已烘前缀【依赖域】指纹（shineFpPrefix）。pair 换代
   *  时新 pair 以当前内容重算同域比对——全等 ⇒ 已烘行画布产物逐位仍有效 ⇒ 收养
   *  续烘;不等 ⇒ 真编辑落在已烘域 ⇒ 落回从 0 重烘。memo 族关（__SW_SHINE_MEMO_OFF）
   *  不写（carry 同关,零开销）。 */
  _resumeFp?: number;
}

const S = CHUNK * TILE;          // 256
const PAD = 12;                  // 逐格 scratch 留白（18px 格盒 ±1 + tileTop 溢出带）
const SCR = TILE + PAD * 2;      // 40

// ---- ★债1 画布池化（2026-10-06;「重烘 churn 孤儿 256² 画布喂 GC」定谳收口） ----
//
// 【定谳（条目身份/帧内变异风险,持有面穷举）】entry.mul/add 画布的持有面：
//   ① shineCache（WeakMap<pair> slots）——【唯一绘制来源】（扫描 blit/drawTileShineAdditive/
//     stale 顶替全部经「当前 pair」的 slots;旧世代 pair 恒不再 current——ChunkCache
//     每烘恒 new pair、替换后该对象永不回 Map）⇒ 旧 pair slots 里的条目永不绘出;
//   ② shineMemo（Map,每 key 至多 1 条）——memo 命中被收养进【当前】pair slots 后
//     才可绘;③ shim 静态区域纹理（GLShimExecutor.resolveTex 静态支,er:texId:epoch:rect
//     键,按画布身份缓存）——内容原地覆写必须 bumpTexEpoch 换键强重传（texId.ts
//     TintAtlas 页矩形回收判例;缺 bump = 首帧内容永久冻结,生命水晶 tileShine 案
//     同族根病）;纹理上传后画布本体仍被 2D 路径逐帧 drawImage 消费,不可弃置。
//   ⇒ 条目死亡判据 = 不在当前 pair slots ∧ 不在 memo。池归还只挂在 ensureEntry
//   各「可证死点」（换代 shift/换代 memo 逐出,逐一注记）;归还即【抽壳】
//   （e.mul/add=undefined）——即便死点误判,最坏后果=该条目画不出 shine 层
//   （缺层可见）,绝不画出陈旧/错误内容（fail-safe 方向）。帧内变异：烘焙全部在
//   schedule 相同步完成（单线程,编辑不可穿插）,绘制相不写画布;被池画布重烘前
//   已验死 ⇒ 同帧「先绘后烘」零交叉。
// 【池纪律】获取点=原 createElement 点（惰性,hasMul/hasAdd 语义逐位不变）;取出即
//   clearRect+状态复位（与新建画布零态逐位同——digest sum/sumX 不变）+bumpTexEpoch
//   （身份税）。池深 8（2MB 上界）;溢出回落 GC=旧行为。
const shineCanvasPool: HTMLCanvasElement[] = [];
const SHINE_POOL_MAX = 8;

function acquireShineCanvas(): HTMLCanvasElement {
  shineStats.canvasesAcquired++;
  const c = shineCanvasPool.pop();
  if (!c) {
    shineStats.canvasesCreated++;
    // ★池化回归修复（2026-10-07 用户实报「跑满 120 场景行走突发掉 80fps」）：池 miss
    //  新建漏设 S² 尺寸（旧 createElement 点的 .width=S/.height=S 赋值随池化收编丢失）
    //  → 画布=缺省 300×150 → chunk blit 源矩形 (0,0,S,S) 部分越界（sy+sh=256>150）
    //  → shim srcoob 门逐次 flushForFallback+presentBatch 全幅回贴（每帧 15-18 次）+
    //  shine 下 106px 源裁剪缺失。活机抓捕 scripts/_fps-srcoob-hunt.mjs 定谳。
    const nc = document.createElement('canvas');
    nc.width = S; nc.height = S;
    return nc;
  }
  // ★池污染归一（同案防御）：早期污染画布（300×150）可能已在池内——重设尺寸即清空
  //  全域（含 256² 外的残留域），语义 ⊇ 下方 clearRect(0,0,S,S)。
  if (c.width !== S || c.height !== S) { c.width = S; c.height = S; }
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = false;   // 与新建路径同值（bake 侧随即再设,防御性对齐）
  g.clearRect(0, 0, S, S);           // 零态 = 新建画布逐位同
  bumpTexEpoch(c);                   // ★身份税：池画布将被原地重烘,shim er: 键换代（上注③）
  shineStats.poolHits++;
  return c;
}

/** 死点归还：抽壳+入池（池满回落 GC=旧行为）。只可在「条目已验死」的调用点调用;
 *  抽壳幂等（重复归还空壳零操作）。 */
function releaseShineEntryCanvases(e: ShineChunkEntry): void {
  const { mul, add } = e;
  e.mul = undefined; e.add = undefined; e._mulCtx = undefined; e._addCtx = undefined;
  for (const c of [mul, add]) {
    if (!c) continue;
    if (shineCanvasPool.length >= SHINE_POOL_MAX) { shineStats.poolOverflow++; continue; }
    shineCanvasPool.push(c);
    shineStats.poolReturns++;
  }
}

/** shine 乘法 delta 缓存(2026-09-09 三轮迭代终案):shimmerAlpha 是连续量,烘焙
 *  进缓存(任何单条目方案)都会在 alpha 扫频时反复失效=重烘风暴。方案=**3 档槽位
 *  记忆**(边界两档震荡=零重烘)+**重烘预算分帧**(扫频途经 8 档的成本摊到多帧,
 *  预算外用最近档旧帧顶替=shine 渐进更新无爆发)。平加 Gemspark 消费面用
 *  slots.find(e=>e.add)。 */
const shineCache = new WeakMap<ChunkPair, { q: number; e: ShineChunkEntry }[]>();

/** ★gladd 面③（task#22,2026-10-28）:chunk 的 +0.39 平加层画布访问器（GL 直出桥
 *  消费;drawTileShineAdditive 2D 路径同源——唯一绘制来源纪律不变,桥只是第二读者）。
 *  undefined = 本 chunk 无 Gemspark 平加格（GL 桥 drop 面语义与 2D continue 同源）。 */
export function shineAddLayerOf(pair: ChunkPair): HTMLCanvasElement | undefined {
  return shineCache.get(pair)?.find((s0) => s0.e.add)?.e.add;
}

/** ★IIIII252 跨 pair 世代 memo（冰雪掉帧 trace 归因修复）。
 *  【病灶】shineCache 以 ChunkPair 身份为键（WeakMap），而底图【任意】重烘（LRU
 *  驱逐重进视野/任意 markDirty 级联）都恒新建 pair 对象（ChunkCache.ts:532）⇒
 *  键换代 = shine 缓存整条失忆。雪域每 chunk 有数百 shine 格（147/161/163/164 全
 *  在 Main.tileShine2，Main.cs:10420-10423）⇒ 每 chunk 重烘 = 数百次 stampShineCell
 *  ×7 次画布操作；默认计数预算 {left:2}/帧 被持续打满 = 用户 trace 实测 TileShine
 *  烘焙链 5.8s/49s（全程 25.8fps、218 个 ≥50ms 长任务的主 hot 环节，/tmp/iii252-out）。
 *  【方案】按 chunk key 存 {fp, slots}；fp = 烘焙输入指纹（FNV-1a over 全部 256 格的
 *  type/frameX/frameY/paint/wire/coat/flags + showInvisibleBlocks + 箱盖态 + shimmerQ）。
 *  指纹全等 ⇒ 烘焙产物【必然】逐位全等（bakeShineChunk 是这些输入的纯函数，画布
 *  本体与 pair 无关）⇒ 直接复用 entry，零重烘。指纹不等（真改了格）才重烘并覆写。
 *  【边界】上限 256 条（≈MAX_CHUNKS 同阶；256² 画布 ≤2 张/条 ⇒ ≤64MB 上界，逐出即
 *  GC）；LRU 触碰序（delete+set）。__SW_SHINE_MEMO_OFF 逃生门（A/B 探针，同
 *  __SW_SHINE_OFF 惯例）。 */
const shineMemo = new Map<number, { q: number; fp: number; e: ShineChunkEntry }[]>();
const SHINE_MEMO_MAX = 256;

/** bake 输入指纹。语义注记：① wire/coat 混【全字节】= bake 门（已致动/隐形/荧光）
 *  的超集——电路/涂装编辑引发的多余重烘可接受，反向漏烘不可接受；② 箱盖态仅在
 *  chunk 内真有容器格（21/467 型）时混入（chestLidPoseAt 输入 x/y/frame；宝箱 21
 *  是 shine2 成员；无容器格的 chunk 箱表变化不可能影响烘焙产物）——箱表摘要按
 *  帧+按 chests 数组身份缓存（updateChestFrames 在 fixedUpdate 内变异，帧内恒定；
 *  长龄世界数千箱不构成逐 fp 调用的 O(chests) 热点）；③ showInvisibleBlocks 是
 *  bake 门的全局输入（Game.ts 隐形块翻转 → invalidateAll），不混入 = 翻转后 memo
 *  误复用。 */
let chestTypeIds: Set<number> | null = null;
const chestDigestCache = new WeakMap<object, { tick: number; v: number }>();
function chestDigestOf(world: World): number {
  const chests = world.chests as unknown as object | undefined;
  if (!chests) return 0;
  const hit = chestDigestCache.get(chests);
  if (hit && hit.tick === tileAnim.tick) return hit.v;
  let h = 0x811c9dc5 | 0;
  const arr = world.chests;
  for (let k = 0; k < arr.length; k++) {
    const c = arr[k];
    h = ((h ^ (c.x & 255)) * 0x01000193) | 0;
    h = ((h ^ ((c.x >>> 8) & 255)) * 0x01000193) | 0;
    h = ((h ^ (c.y & 255)) * 0x01000193) | 0;
    h = ((h ^ ((c.y >>> 8) & 255)) * 0x01000193) | 0;
    h = ((h ^ (c.frame ?? 0)) * 0x01000193) | 0;
  }
  const v = h >>> 0;
  chestDigestCache.set(chests, { tick: tileAnim.tick, v });
  return v;
}
function shineChunkFingerprint(
  world: World, atlas: SpriteAtlas | null, cx: number, cy: number, shimmerQ: number,
): number {
  const st = world.store;
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  let h = 0x811c9dc5 | 0;
  const mix2 = (v: number) => {
    h = ((h ^ (v & 255)) * 0x01000193) | 0;
    h = ((h ^ ((v >>> 8) & 255)) * 0x01000193) | 0;
  };
  const cTypes = chestTypeIds ?? (chestTypeIds = (() => {
    const s = new Set<number>();
    for (let i = 0; i < TILE_DEFS.length; i++) {
      const sh = TILE_DEFS[i]?.vanilla?.sheet;
      if (sh === 21 || sh === 467) s.add(i);
    }
    return s;
  })());
  let hasChest = false;
  // ★±1 环带：blend/auto 取帧读邻格（drawVanillaCell same 谓词邻接）,chunk 边缘
  //   shine 格的取帧依赖相邻 chunk 的格——与 ChunkCache.markDirtyArea ±1 协商边距
  //   同域。环带外（世界界外）混哨兵 0=无邻格,与取帧侧界外语义一致。
  for (let ly = -1; ly <= CHUNK; ly++) {
    for (let lx = -1; lx <= CHUNK; lx++) {
      const x = x0 + lx, y = y0 + ly;
      if (!st.inBounds(x, y)) { mix2(0); mix2(0); continue; }
      const i = st.idx(x, y);
      const t = st.type[i];
      mix2(t); mix2(st.flags[i]);
      mix2(st.frameX[i] & 255); mix2(st.frameX[i] >>> 8);
      mix2(st.frameY[i] & 255); mix2(st.frameY[i] >>> 8);
      mix2(st.paint[i]); mix2(st.wire[i]); mix2(st.coat[i]);
      // ★半砖/坡面位入指纹（2026-10-06 债2 配套勘误）：setHalfBrick/setSlope 发监听
      //   换代（TileStore.ts:330/:339）而 drawVanillaCell 产物依赖形状（坡切/半砖,
      //   stampShineCell 蒙版注）——指纹缺位 = 锤改后 memo 按旧 fp 误复用首烘形状
      //   （陈旧 shine 影;形状编辑不写 frame 数组,换代后 fp 原本可全等）。
      mix2(st.half[i] ? 1 : 0); mix2(st.slope[i]);
      if (cTypes.has(t)) hasChest = true;
    }
  }
  mix2(st.showInvisibleBlocks ? 1 : 0);
  mix2(shimmerQ * 255);
  if (hasChest) mix2(chestDigestOf(world));
  // ★atlas 装载代际入指纹（2026-10-06 三债定谳副产,IIIII252 memo 陈旧服正确性洞）:
  //   bake 链 stampShineCell→drawVanillaCell 消费 atlas.vimages（懒取,未就位返回
  //   null=画空/fallback）——memo fp 原不含 atlas 态 ⇒ 表晚到前烘的条目（缺表像素）
  //   在晚到重烘（markDirty→pair 换代）后按内容 fp 【全等】被 memo 误复用=缺表
  //   shine 钉死。零挖掘稳定性探针实证（scripts/_shine-stability-probe.mjs:同内容
  //   fps 两跑 digest 不同）。vimages.size=单调装载进度代理:晚到 ⇒ size 变 ⇒ fp 变
  //   ⇒ miss ⇒ 重烘取新表;settled 后恒定 ⇒ memo 稳态零开销。旧 memo 前时代该洞由
  //   「pair 换代必 q-miss 重烘」天然掩盖,memo 化后暴露。
  mix2(atlas ? atlas.vimages.size : 0);
  return h >>> 0;
}

// ---- ★债2 carry 凭证：已烘前缀【依赖域】指纹（2026-10-06） ----
//
// 【依赖域演算】已烘格 = 行 [0, resumeRow) 全列 ∪ 行 resumeRow 列 [0, resumeCol)
//   （债3 格级断点语义;行首断点 = resumeCol=0 = 旧行级断点特例）。stampShineCell
//   逐格读 ±1 行列（blend/auto 取帧邻接）⇒ 依赖域并集 = 行 [-1, resumeRow] ×
//   列 [-1, CHUNK] ∪ 行 resumeRow+1 × 列 [-1, resumeCol]（后者仅 resumeCol>0——
//   行首断点无行 resumeRow 的 stamp,不读 resumeRow+1）。域外内容不影响已烘产物。
// 【值域】独立种子（与全量 fp 值域隔离,两值不可跨用）;配方面与 shineChunkFingerprint
//   逐字段同源（含 half/slope——本函数与全量 fp 是仅有的两处配方面,改动须同步）。
//   指纹全等 ⇒ bakeShineChunk 是这些输入的纯函数 ⇒ 前缀行画布产物逐位全等
//   ⇒ 跨 pair 收养安全（tryCarryShineProgress 消费）。
export function shineFpPrefix(
  world: World, atlas: SpriteAtlas | null, cx: number, cy: number,
  resumeRow: number, resumeCol: number, shimmerQ: number,
): number {
  const st = world.store;
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  let h = (0x811c9dc5 ^ 0x9e3779b9) | 0;
  const mix2 = (v: number) => {
    h = ((h ^ (v & 255)) * 0x01000193) | 0;
    h = ((h ^ ((v >>> 8) & 255)) * 0x01000193) | 0;
  };
  const cTypes = chestTypeIds ?? (chestTypeIds = (() => {
    const s = new Set<number>();
    for (let i = 0; i < TILE_DEFS.length; i++) {
      const sh = TILE_DEFS[i]?.vanilla?.sheet;
      if (sh === 21 || sh === 467) s.add(i);
    }
    return s;
  })());
  let hasChest = false;
  const mixCell = (lx: number, ly: number): void => {
    const x = x0 + lx, y = y0 + ly;
    if (!st.inBounds(x, y)) { mix2(0); mix2(0); return; }   // 界外=哨兵 0（全量 fp 同语义）
    const i = st.idx(x, y);
    const t = st.type[i];
    mix2(t); mix2(st.flags[i]);
    mix2(st.frameX[i] & 255); mix2(st.frameX[i] >>> 8);
    mix2(st.frameY[i] & 255); mix2(st.frameY[i] >>> 8);
    mix2(st.paint[i]); mix2(st.wire[i]); mix2(st.coat[i]);
    mix2(st.half[i] ? 1 : 0); mix2(st.slope[i]);
    if (cTypes.has(t)) hasChest = true;
  };
  for (let ly = -1; ly <= resumeRow; ly++) {
    for (let lx = -1; lx <= CHUNK; lx++) mixCell(lx, ly);
  }
  if (resumeCol > 0) {
    for (let lx = -1; lx <= resumeCol; lx++) mixCell(lx, resumeRow + 1);
  }
  mix2(st.showInvisibleBlocks ? 1 : 0);
  mix2(shimmerQ * 255);
  if (hasChest) mix2(chestDigestOf(world));
  mix2(atlas ? atlas.vimages.size : 0);   // ★atlas 装载代际（全量 fp 同项,见其注）
  return h >>> 0;
}

// ---- ★挖掘相指纹脏标缓存（2026-10-04 主刀;x-ray mix2 435ms/36s 定谳）----
//
// 【键 = (pair 身份, q)】pair 身份 = 底图重烘信号（文件头注 :44-47「ChunkCache
//   重烘焙恒新建 pair 对象,pair 身份变更 = 底图重烘信号」——ChunkCache 每烘恒
//   new pair）⇒ fp 输入面（±1 环带 type/flags/frameX/frameY/paint/wire/coat +
//   showInvisibleBlocks + 箱盖摘要）的任何游戏内变更都伴随底图重烘 = pair 换代：
//   · 格编辑 setTile/setPaint/setCoat/setActuated 全发 listeners → markDirtyAround
//     → 底图重烘（TileStore.ts 各 setter 已核）；±1 环带的邻格编辑按
//     markDirtyAround 边界规则同样标脏本 chunk（环带格恒邻 chunk 边界）。
//   · 箱盖态：Game.updateChestFrames frame 变化 → markDirtyArea → 换代（已核）。
//   · showInvisibleBlocks 翻转 → invalidateAll → 全换代。
//   · 普通 setWire 不发监听,但 wire 仅以致动位（WIRE_ACTUATED）进烘焙门（:755）,
//     致动位变化走 setActuated → 发监听 → 换代——非致动位 wire 变更不换代时
//     缓存复用旧 fp = 烘焙产物本就不变（多余重烘被省,正向收益）。
//   · LRU 淘汰重进视野（内容不变换新 pair）→ 缓存 miss 重算一次 = 旧行为。
// 【收益】待烘积压 K 帧 = 1 次计算（旧 = schedule+扫描各一次 = 2K 次）;冷烘焙的
//   烘后重算（:1029 存 memo 前的第二次全表混入）同被缓存吃掉。
const shineFpCache = new WeakMap<ChunkPair, Map<number, number>>();

/** 导出面 = 单测/取证（生产调用点恒 ensureEntry 三处）。 */
export function shineChunkFingerprintCached(
  world: World, atlas: SpriteAtlas | null, pair: ChunkPair, cx: number, cy: number, shimmerQ: number,
): number {
  let m = shineFpCache.get(pair);
  if (!m) { m = new Map<number, number>(); shineFpCache.set(pair, m); }
  const hit = m.get(shimmerQ);
  if (hit !== undefined) return hit;
  const fp = shineChunkFingerprint(world, atlas, cx, cy, shimmerQ);
  m.set(shimmerQ, fp);
  return fp;
}

/** 取证导出（单测/探针）：pair 的 fp 缓存槽位数（undefined = 无缓存条目）。 */
export function shineFpCacheSlotsForTest(pair: ChunkPair): number | undefined {
  return shineFpCache.get(pair)?.size;
}

// ---- ★三债清偿（2026-10-06）取证/单测导出面 ----

/** 单测：直设 shineCache 槽位（fabricate partial 条目用;生产不可达）。 */
export function shineDebugSeedSlotsForTest(
  pair: ChunkPair, slots: { q: number; e: ShineChunkEntry }[],
): void { shineCache.set(pair, slots); }

/** 单测：读 shineCache 槽位（undefined = 无）。 */
export function shineDebugSlotsForTest(
  pair: ChunkPair,
): { q: number; e: ShineChunkEntry }[] | undefined { return shineCache.get(pair); }

/** 单测：读 shineMemo 槽位（undefined = 无）。 */
export function shineDebugMemoPeekForTest(
  key: number,
): { q: number; fp: number; e: ShineChunkEntry }[] | undefined { return shineMemo.get(key); }

/** 单测：直设 shineMemo 槽位（carry 一致性测试用;生产 memo 只经 ensureEntry 写）。 */
export function shineDebugMemoSeedForTest(
  key: number, v: { q: number; fp: number; e: ShineChunkEntry }[],
): void { shineMemo.set(key, v); }

/** 单测：tryCarryShineProgress 包装（schedule ① 同源）。 */
export function shineDebugTryCarryForTest(
  world: World, atlas: SpriteAtlas | null, oldPair: ChunkPair, cur: ChunkPair,
  cx: number, cy: number, shimmerQ: number,
): boolean { return tryCarryShineProgress(world, atlas, oldPair, cur, cx, cy, shimmerQ); }

/** 探针：池深（债1 周转取证）。 */
export function shinePoolDepthForTest(): number { return shineCanvasPool.length; }

/** 单测：死点归还直调（Node 无 DOM,用假画布对象验抽壳/入池/幂等面）。 */
export function shinePoolReleaseForTest(e: ShineChunkEntry): void {
  releaseShineEntryCanvases(e);
}

let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
let mask: HTMLCanvasElement | null = null;
let maskCtx: CanvasRenderingContext2D | null = null;

function devTools(): { s: CanvasRenderingContext2D; m: CanvasRenderingContext2D;
  sc: HTMLCanvasElement; mk: HTMLCanvasElement } | null {
  if (typeof document === 'undefined') return null;
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = SCR; scratch.height = SCR;
    scratchCtx = scratch.getContext('2d');
    mask = document.createElement('canvas');
    mask.width = SCR; mask.height = SCR;
    maskCtx = mask.getContext('2d');
  }
  return scratchCtx && maskCtx && scratch && mask
    ? { s: scratchCtx, m: maskCtx, sc: scratch, mk: mask }
    : null;
}

/** chunk 条目是否已烘完（★IIIII249：时间盒部分烘焙条目带断行标记）。现行路径
 *  烘焙恒一次烘完（_resumeRow 恒 undefined）= 恒 true，零行为差。 */
export function shineEntryComplete(e: ShineChunkEntry): boolean {
  return e._resumeRow === undefined;
}

/** 取证导出（惰性，零渲染触碰；等价性对拍仪/A/B 探针专用）：[bx0..bx1]×[by0..by1]
 *  界内 shine 缓存逐 chunk 摘要——档位 q/完成态/层有无/像素校验和（sum=Σ字节,
 *  sumX=Σ字节×偏移,位置敏感）。同世界同暖机序列下摘要全等 = 烘焙产物逐位等价
 *  （对粒子/天空/HUD 等全帧噪声免疫——本机今日树上全帧 sha 不自洽,故对拍下沉到
 *  本通道自身产物层）。注意 chunks.get 会按需烘底图（ChunkCache.get）——界外勿调。 */
export function shineDebugChunkDigests(
  chunks: { get(cx: number, cy: number): ChunkPair },
  bx0: number, bx1: number, by0: number, by1: number,
): Array<{
  cx: number; cy: number; q: number; done: boolean; hasMul: boolean; hasAdd: boolean;
  resumeRow: number; resumeCol: number; sum: number; sumX: number;
}> {
  const out: Array<{
    cx: number; cy: number; q: number; done: boolean; hasMul: boolean; hasAdd: boolean;
    resumeRow: number; resumeCol: number; sum: number; sumX: number;
  }> = [];
  for (let cy = by0; cy <= by1; cy++) {
    for (let cx = bx0; cx <= bx1; cx++) {
      const slots = shineCache.get(chunks.get(cx, cy));
      if (!slots) {
        out.push({ cx, cy, q: -1, done: false, hasMul: false, hasAdd: false, resumeRow: -1, resumeCol: -1, sum: 0, sumX: 0 });
        continue;
      }
      for (const s of slots) {
        const e = s.e;
        let sum = 0, sumX = 0, hasMul = false, hasAdd = false;
        for (const c of [e.mul, e.add]) {
          if (!c) continue;
          if (c === e.mul) hasMul = true; else hasAdd = true;
          const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, S, S).data;
          for (let i = 0; i < d.length; i++) {
            const b = d[i];
            if (!b) continue;
            sum += b; sumX += b * i;
          }
        }
        out.push({ cx, cy, q: s.q, done: shineEntryComplete(e), hasMul, hasAdd, resumeRow: e._resumeRow ?? -1, resumeCol: e._resumeCol ?? -1, sum, sumX });
      }
    }
  }
  return out;
}

/** 与 chunk 烘焙同款 merge 谓词（ChunkCache.ts:716 `(t) => t === type || frameMergesWith(type, t)`） */
function sameFn(type: number): (t: number) => boolean {
  return (t: number) => t === type || frameMergesWith(type, t);
}

/** 逐格烘 delta：drawVanillaCell 画进 scratch（与底图同一渲染权威——blend 邻接取帧/
 *  坡面/半砖/衔接帧/宝箱姿态/动画帧行/油漆全同源），multiply 烘 delta 色，
 *  destination-in 裁回 alpha，再整幅盖到 dest。dest 盒 = (dx,dy,dw,dh)，
 *  chunk 烘焙路径 1:1（dx=lx*16−PAD）；逐帧动态路径按格设备缩放。
 *  ★生命水晶 shim ghost 修复（2026-09-27 用户实报「四格位置半透明淡红影子」）：
 *  共享 scratch 内容【逐格逐帧变】——acc shim 链下把该 drawImage 当静态源收编时,
 *  区域纹理按 (texId,0,0,40,40) 首帧内容【永久冻结】,四格 quad 全采样同一冻结片
 *  = 心形切片影子错位钉在各格盒（bglshim=0 直画 2D 恒正确）。dynamicDest=true 的
 *  调用点（仅 drawTileShineGrid 逐帧动态支）在最终 dest.drawImage 前触发
 *  shineScratchBakeHook → Renderer.markWorldDynamicScratch(sc, 'shineCell:x,y') 走
 *  I类 uploadScratchNow 立即上传（内容定格于本格 stamp 完成时）,本格 quad 经
 *  bakedTexPending/preTex 直取,不再吃冻结区域纹理。★key 必须按【格】独立
 *  （'shineCell:x,y'）：texRefresh 复用同一纹理对象——若全格共用单 key,后续格的
 *  重传会【原地改写】先行 quad 引用的纹理,flush 时四格又全采样末格内容（首版
 *  单 key 修复的回归教训）。chunk 烘焙支（dest=entry 画布）不触发——entry.mul/add
 *  画布内容按 (pair,q) 稳定,静态区域纹理语义正确。 */
let shineScratchBakeHook: ((c: HTMLCanvasElement, key: string) => void) | null = null;
/** Renderer 启动期注册（markWorldDynamicScratch→uploadScratchNow；非 shim 会话内部自判 no-op） */
export function setShineScratchBakeHook(fn: ((c: HTMLCanvasElement, key: string) => void) | null): void {
  shineScratchBakeHook = fn;
}

// ---- ★shineslice 内容指纹键（同上域注）----
//
// 【键 = 逐 (格,动画相位) + 内容指纹】动态支格（12/639 动画水晶、204/211 脉动矿）
// 经 drawVanillaCell 取帧——auto/blend 框架链按【邻格现场+格位相位】算帧（非存储
// 帧;211 等 2×2 组框架按绝对奇偶取组位——纯内容指纹会漏格位相位,首版纯内容键
// 曾在同指纹异帧格间碰撞=错帧,census 实锤后改【格位+指纹】双段键）。位键天然
// 零碰撞;指纹段负责【内容变化失效】（邻格改框/重漆 → 新键一次重传,旧键闲置清扫）
// 与跨帧稳定（格与内容不变 → 键不变 → 零重传=本刀上传面正解）。动画相位
// （tileAnim.tick 按 sheet rate 量化）参与键 = 「逐 (格,动画帧) 稳定」的字面兑现。
const SLICE_FP_SEED = 0x811c9dc5 | 0;

/** 动态 shine 格切片键（'shineSlice:<sheet>:<x>:<y>:<fp>'）。fp 混入:3×3 邻域
 *  (type,flags,half,slope,frameX 低/高字节,frameY 低/高字节,paint) + 中心格动画
 *  相位（rate>0 时 floor(tick/rate);静态支恒 0）。wire/coat 不混:动态支在 stamp
 *  前已把 actuated/invisible/fullbright 格排除（bakeShineChunk/drawTileShineGrid
 *  同门）,到得了 stamp 的格 wire/coat 不改 sprite。 */
export function shineSliceCellKey(
  world: World, x: number, y: number, sheet: number, type: number,
): string {
  const st = world.store;
  let h = SLICE_FP_SEED;
  const mix = (v: number): void => {
    h = ((h ^ (v & 255)) * 0x01000193) | 0;
    h = ((h ^ ((v >>> 8) & 255)) * 0x01000193) | 0;
  };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!st.inBounds(nx, ny)) { mix(0); continue; }   // 界外=哨兵 0（取帧侧界外语义同）
      const i = st.idx(nx, ny);
      mix(st.type[i]);
      mix(st.flags[i]);
      mix(st.half[i] ? 1 : 0);
      mix(st.slope[i]);
      mix(st.frameX[i] & 255); mix(st.frameX[i] >>> 8);
      mix(st.frameY[i] & 255); mix(st.frameY[i] >>> 8);
      mix(st.paint[i]);
    }
  }
  const rate = TILE_ANIM_RATE[sheet] ?? 0;
  mix(rate > 0 ? Math.floor(tileAnim.tick / rate) : 0);   // 动画相位（逐帧键的字面项）
  return `shineSlice:${sheet}:${x}:${y}:${h >>> 0}`;
}
function stampShineCell(
  atlas: SpriteAtlas, world: World, x: number, y: number,
  sheet: number, frame: 'auto' | 'style' | 'blend', fw: number, fh: number,
  type: number, fx: number, fy: number,
  delta: [number, number, number],
  dest: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number,
  additiveFlat = false, dynamicDest = false,
): void {
  const t = devTools();
  if (!t) return;
  const { s, m, sc, mk } = t;
  const van = TILE_DEFS[type]?.vanilla;
  if (!van) return;
  const st = world.store;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(0, 0, SCR, SCR);
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, SCR, SCR);
  s.imageSmoothingEnabled = false;
  // 与底图同源调用面（ChunkCache.ts:712-724）：px/py=PAD 是自由目标参数，
  // x/y 是取帧/邻接逻辑坐标——内容落在 scratch [PAD−1, PAD+17) 18px 格盒，
  // 格芯 16×16 = [PAD, PAD+16)。
  drawVanillaCell(
    s, atlas, sheet, frame, fw, fh,
    st, x, y, type,
    sameFn(type),
    PAD, PAD, fx, fy,
    undefined,
    // ★IIIII252：姿态消费面仅 21/467（VanillaTiler.chestPoseSheet 单源）——
    //   chestLidPoseAt 是 O(chests) 全表线性查,雪域数百 shine 格逐格急切求值 =
    //   重烘成本放大器（真实长龄世界数千箱 × 256 格）,非容器格零成本短路。
    chestPoseSheet(sheet) ? chestLidPoseAt(world.chests, x, y, fx, fy) : 0,
  );
  // alpha 蒙版 = delta 烘焙前的格形状（multiply 会把透明像素染成实色——裁回，
  // 手法同 TileFlames.tintedFlameCell :498-500；蒙版须拷贝而非重画源矩形：
  // drawVanillaCell 输出含坡切/半砖/衔接帧等非源矩形成分）
  m.drawImage(sc, 0, 0);
  // 油漆（原版 tileShader 按格取 paint；本仓 = 烘焙侧 tintRegion 16×16 格芯语义，
  // ChunkCache.ts:805-814 同式——溢出带不上漆与底图一致）
  const paint = st.paint[st.idx(x, y)];
  if (paint > 0) {
    const special: LeafPaintSettings | undefined = paint >= 1 && paint <= 12
      ? getTilePaintSettings(sheet, 0) ?? undefined : undefined;
    s.globalCompositeOperation = 'source-over';
    tintRegion(s, sc, PAD, PAD, paint, PAD, PAD, false, special);
  }
  // delta 色 = (k−1)⁺（乘法支）/ 0.39 恒值（Gemspark 加法支——合成后平加,不经乘光）
  const dR = additiveFlat ? SHINE_ADDITIVE : delta[0];
  const dG = additiveFlat ? SHINE_ADDITIVE : delta[1];
  const dB = additiveFlat ? SHINE_ADDITIVE : delta[2];
  if (dR <= 0 && dG <= 0 && dB <= 0) return;
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  // ★shineslice:先钩后乘——接管=true 时 scratch 保 sprite-only（delta 不烘进
  //  面）,乘法由消费 rec 顶点色承担（uploadShineSlice→BakeSnap.tint→quadSprite
  //  uTint,键=内容指纹）;false（旗关/2D 会话/GL 死）=下方旧链逐位不变。
  if (dynamicDest && shineSliceGl) {
    if (shineScratchSliceHook?.(sc,
      shineSliceCellKey(world, x, y, sheet, type),
      [q(dR) / 255, q(dG) / 255, q(dB) / 255])) {
      dest.drawImage(sc, dx, dy, dw, dh);
      return;
    }
  }
  s.globalCompositeOperation = 'multiply';
  s.fillStyle = `rgb(${q(dR)},${q(dG)},${q(dB)})`;
  s.fillRect(0, 0, SCR, SCR);
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(mk, 0, 0);
  s.globalCompositeOperation = 'source-over';
  // ★shim ghost 修复:动态支在【draw 之前】定格本次 scratch 内容（I类即传,
  //  消费面=GLShimExecutor.bakedTexPending/preTex——b2-bolt 判例同款）;
  //  key 按格独立（见函数头注——单 key 会原地改写先行 quad 引用的纹理）
  if (dynamicDest) shineScratchBakeHook?.(sc, `shineCell:${x},${y}`);
  dest.drawImage(sc, dx, dy, dw, dh);
}

function bakeShineChunk(
  atlas: SpriteAtlas, world: World, cx: number, cy: number, shimmerQ: number,
  deadline?: number, resume?: ShineChunkEntry,
  /** ★仅测试面消费(shineDebugResumeIdentity):行数限制断行;生产恒 undefined。 */
  stopAfterRows?: number,
  /** ★仅测试面消费:格序数限制断行(债3 格级断行的逐位恒等证明面);生产恒 undefined。 */
  stopAfterCells?: number,
): ShineChunkEntry {
  const entry: ShineChunkEntry = resume ?? { shimmerQ };
  const st = world.store;
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const ly0 = resume?._resumeRow ?? 0;
  const lc0 = resume?._resumeCol ?? 0;
  const rowLimit = stopAfterRows !== undefined ? Math.min(CHUNK, ly0 + Math.max(0, stopAfterRows)) : CHUNK;
  const cellCap = stopAfterCells !== undefined
    ? ly0 * CHUNK + lc0 + Math.max(0, stopAfterCells) : Infinity;
  // ★IIIII249 时间盒断行(原行级)→ ★债3(2026-10-06)格级断行收口：死线检查下沉到
  // 【格级 stamp 点】,断点=(首个未 stamp 的格)(row,col)。非幂等不变量的本体是
  // 「不重踏任何已 stamp 格 + stamp 全序不变」——(row,col) 精确续点两者皆保
  // (断点只是把同一条 stamp 全序【切分】到多帧,不是重入;旧注「行内断点会重踏」
  // 指的是「行内断、行首续」的错位续烘——按 (row,col) 续起无此问题)。行级断点
  // = resumeCol=0 特例,旧行为全覆盖。过冲上界从「死线+单密集行(~2ms+)」收紧为
  // 「死线+单密集格(~0.15-0.3ms)」。
  let lxStart = lc0;
  // ★债1 定谳副产（2026-10-06）:条目画布「绘后续写」必须换代纹理键——acc 缺省链
  //  (bgl+bglShim+b2b)下条目画布经 GLShimExecutor.drawImage→resolveTex 静态支
  //  (er:texId:epoch:rect 键)缓存,而 GLSpriteLayer.texFromRegion 同键命中【不重传
  //  内容】(texs.get 命中即返)⇒ partial 条目首绘后 resume 原地续写,epoch 恒 0 =
  //  缓存命中首绘(部分)内容=后续行 GL 恒缺(texId.ts「生命水晶 tileShine 案同族
  //  根病」在本文件的未处理面;TintAtlas.ts:68 回收页 bump 先例)。digest 通道只测
  //  画布内容,不覆盖 GL 呈现层——本 bump 补齐该面。机制:凡本调用 stamp 过的层,
  //  返回前 bump(内容可能已变);同帧 schedule 烘→扫描绘,绘制期 resolveTex 读新
  //  epoch≠缓存 ⇒ 重传当前内容。新鲜画布首烘 bump=0→1 无害(首绘本就要上传);
  //  池画布获取点已 bump 过,此处再 bump=键再换代,同样正确。
  let stampedMul = false, stampedAdd = false;
  for (let ly = ly0; ly < rowLimit; ly++) {
    for (let lx = lxStart; lx < CHUNK; lx++) {
      if ((deadline !== undefined && performance.now() > deadline)
        || ly * CHUNK + lx >= cellCap) {
        entry._resumeRow = ly;   // 断点行号:本格未烘,下帧从此格续
        entry._resumeCol = lx;   // 断点列号(行首=0;续行从列 0)
        if (!(globalThis as { __SW_SHINE_MEMO_OFF?: boolean }).__SW_SHINE_MEMO_OFF) {
          entry._resumeFp = shineFpPrefix(world, atlas, cx, cy, ly, lx, shimmerQ);   // ★债2 carry 凭证
        }
        if (stampedMul && entry.mul) bumpTexEpoch(entry.mul);
        if (stampedAdd && entry.add) bumpTexEpoch(entry.add);
        return entry;
      }
      const x = x0 + lx, y = y0 + ly;
      if (!st.inBounds(x, y)) continue;
      const i = st.idx(x, y);
      // 原版语义:非活性格不渲染（TileRunner 会给空气格写幽灵 type）;bit0 = active
      // 位（TileStore flags 编码注）——幽灵格清扫 doctrine = active() 消费者读 bit0
      if (!st.hasTile(x, y)) continue;
      const type = st.type[i];
      const van = TILE_DEFS[type]?.vanilla;
      if (!van) continue;
      const sheet = van.sheet;
      // 动画格不进静态烘焙（ChunkCache 同款分工,isDynamicAnimSheet）
      if (isDynamicAnimSheet(sheet)) continue;
      // 脉动支（204 Crimtane/211 Chlorophyte）逐帧动态,烘焙会冻结呼吸
      if (isPulseShineSheet(sheet)) continue;
      // 已致动（inActive）→ 原版走 actColor 分支,不吃 shine（TileDrawing.cs:4438）
      if ((st.wire[i] & TileStore.WIRE_ACTUATED) !== 0) continue;
      // 回声隐形块不绘制（TileDrawing.IsVisible :1434-1452;ChunkCache 同门）
      if ((st.coat[i] & TileStore.COAT_INVISIBLE_BLOCK) !== 0 && !st.showInvisibleBlocks) continue;
      // 荧光涂层块：GetFinalLight(Color) :4408 fullbrightBlock→White 先于 shine,
      // White×1.6 钳回白 = shine 被吸收;glow 叠层已全亮,再叠 delta 必过亮 → 跳过
      if ((st.coat[i] & TileStore.COAT_FULLBRIGHT_BLOCK) !== 0) continue;
      const additive = isAdditiveShineSheet(sheet);
      const delta = additive ? null : shineDelta(sheet, 0, shimmerQ);
      if (!additive && !delta) continue;
      if (!shouldTileShine(sheet, st.frameX[i], vanillaTileSolid(sheet), shimmerQ, st.frameY[i])) continue;
      if (additive) {
        if (!entry.add) {
          entry.add = acquireShineCanvas();   // ★债1 池化获取点=原 createElement 点（hasMul/hasAdd 语义逐位）
          const ac = entry.add.getContext('2d')!;
          ac.imageSmoothingEnabled = false;
          entry._addCtx = ac;
        }
        stampShineCell(atlas, world, x, y, sheet, van.frame, van.fw ?? 1, van.fh ?? 1,
          type, st.frameX[i], st.frameY[i], [0, 0, 0],
          entry._addCtx!, lx * TILE - PAD, ly * TILE - PAD, SCR, SCR, true);
        stampedAdd = true;
      } else if (delta) {
        if (!entry.mul) {
          entry.mul = acquireShineCanvas();   // ★债1 池化获取点=原 createElement 点
          const mc = entry.mul.getContext('2d')!;
          mc.imageSmoothingEnabled = false;
          entry._mulCtx = mc;
        }
        stampShineCell(atlas, world, x, y, sheet, van.frame, van.fw ?? 1, van.fh ?? 1,
          type, st.frameX[i], st.frameY[i], delta,
          entry._mulCtx!, lx * TILE - PAD, ly * TILE - PAD, SCR, SCR);
        stampedMul = true;
      }
    }
    lxStart = 0;   // ★债3:断点列号只属断点行,续行恒从列 0
  }
  if (rowLimit < CHUNK) {
    entry._resumeRow = rowLimit;   // 行数限制断行(测试面):同时间盒语义的部分标记
    entry._resumeCol = 0;
    if (!(globalThis as { __SW_SHINE_MEMO_OFF?: boolean }).__SW_SHINE_MEMO_OFF) {
      entry._resumeFp = shineFpPrefix(world, atlas, cx, cy, rowLimit, 0, shimmerQ);
    }
    if (stampedMul && entry.mul) bumpTexEpoch(entry.mul);
    if (stampedAdd && entry.add) bumpTexEpoch(entry.add);
    return entry;
  }
  if (stampedMul && entry.mul) bumpTexEpoch(entry.mul);     // 烘完亦可能相对首绘有新内容
  if (stampedAdd && entry.add) bumpTexEpoch(entry.add);
  entry._resumeRow = undefined;   // ★IIIII249 烘完必须清断行标记——否则条目永远"部分",
  entry._resumeCol = undefined;   // 每帧被重续烘尾部行(steady 实测曾因此 100% stalled)
  entry._resumeFp = undefined;
  return entry;
}

/** ★IIIII249 烘焙预算两形态:计数(现行 `{left}`,每帧 N chunk)/时间盒(`{deadline}`,
 *  ?shinebudget=<ms>)。计数形态语义逐位保持原实现。 */
type ShineBakeBudget = { left: number } | { deadline: number };

/** 预算超线判定(计数形态 = 原 `budget.left <= 0` 原语义;时间盒 = 死线已过)。
 *  导出面 = 单测(纯函数,时钟仅 deadline 支消费)。 */
export function budgetExhausted(budget: ShineBakeBudget | undefined): boolean {
  if (!budget) return false;
  return 'deadline' in budget ? performance.now() >= budget.deadline : budget.left <= 0;
}

/** 预算扣减(仅计数形态;时间盒由死线自然耗尽)。导出面 = 单测。 */
export function budgetConsume(budget: ShineBakeBudget | undefined): void {
  if (budget && 'left' in budget) budget.left--;
}

// ---- ★幕布期 shine 盒提升（2026-10-06 案 b;「进世界后长时间无法稳定帧率」保守子集）----
// Game.beginEntryFreeze 置、endEntryFreeze 清（冻结窗=幕布未撤,巨帧不可见窗）：
// 缺省 4ms→15ms 快排视口 pending。纪律：
// · 显式 ?shinebudget URL 档【逐字】语义不受影响（explicit!=null 时提升不生效,
//   含 0=计数路径;与滚屏降级同纪律）;
// · 提升窗【旁路】爆发闩与相机速度门（入场首曝=合法爆发面,不钳 1.5ms;闩状态机
//   照常记账,提升清后自恢复原语义——闩.active 每帧重算,无陈旧残留）;
// · 零光照/worker 耦合：只改本帧盒毫秒值,烘焙链路/调度序零触碰。
let entryBoostMs: number | null = null;
/** 幕布期 shine 盒提升开关（Game 冻结窗开/关沿调用;null=常态）。测试直通面。 */
export function setShineEntryBoost(ms: number | null): void { entryBoostMs = ms; }
/** 幕布期提升是否在效（测试/诊断面） */
export function shineEntryBoostActive(): boolean { return entryBoostMs != null; }
/** 帧盒基值解析（纯函数,单测面）：显式 URL 档逐字优先（base 即其档值,boost 不生效）;
 *  无显式时幕布期提升生效（boost!=null 取 boost,否则常态 base）。 */
export function resolveShineBudgetMs(explicit: number | null, base: number, boost: number | null): number {
  if (explicit !== null) return base;
  return boost ?? base;
}

/** 工作清单项(调度/纯函数共用形)。 */
export interface ShineWorkItem { cx: number; cy: number; pair: ChunkPair }

/** 纯函数(单测面):工作清单合并排序——待烘队列(先到先得)在前 + 视界缺额在后,
 *  两组各自按 chunk 中心与相机中心【距离升序】,并列=行序(确定性);按 pair 去重
 *  (同 chunk 同帧只处理一次)。返回新数组,不改入参。 */
export function planShineWork<T extends ShineWorkItem>(
  pending: readonly T[], fresh: readonly T[], camX: number, camY: number,
  chunkPx = CHUNK * TILE,
): T[] {
  const d2 = (cx: number, cy: number) => {
    const dx = (cx + 0.5) * chunkPx - camX, dy = (cy + 0.5) * chunkPx - camY;
    return dx * dx + dy * dy;
  };
  const byDist = (a: T, b: T) =>
    d2(a.cx, a.cy) - d2(b.cx, b.cy) || a.cy - b.cy || a.cx - b.cx;
  const out: T[] = [];
  // ★BJ94 D2（swPerf 快路径）：复用槽 clear 后重填（槽注）；flag 关 = 原地 new
  let seen: Set<ChunkPair>;
  if (swPerf) { BJ94_SEEN_PLAN.clear(); seen = BJ94_SEEN_PLAN; }
  else seen = new Set<ChunkPair>();
  for (const it of [[...pending].sort(byDist), [...fresh].sort(byDist)].flat()) {
    if (seen.has(it.pair)) continue;
    seen.add(it.pair);
    out.push(it);
  }
  return out;
}

function ensureEntry(
  atlas: SpriteAtlas, world: World, pair: ChunkPair, cx: number, cy: number,
  shimmerQ: number, budget?: ShineBakeBudget,
): ShineChunkEntry | null {
  const slots = shineCache.get(pair);
  if (slots) {
    for (const s of slots) if (s.q === shimmerQ) {
      // 档位命中(含边界回摆)。已完成 = 零烘焙返回(缓存命中永不重烘);时间盒下
      // 部分烘焙条目 = 断行续烘(行序不变 ⇒ 与一次烘完逐位恒等,见 bakeShineChunk 注)
      const e = s.e;
      if (shineEntryComplete(e) || !budget || !('deadline' in budget)) {
        if (budget && 'deadline' in budget) shineStats.hits++;   // 时间盒命中记账(计数路径零触碰)
        return e;
      }
      if (performance.now() < budget.deadline) {
        shineStats.resumes++;
        const beforeRow = e._resumeRow, beforeCol = e._resumeCol;
        const __t0 = performance.now();
        bakeShineChunk(atlas, world, cx, cy, shimmerQ, budget.deadline, e);
        shineStats.bakeMs += performance.now() - __t0;
        // ★债3:格级断行后同行可推进列数——停滞判据=row∧col 双未动
        if (!shineEntryComplete(e) && e._resumeRow === beforeRow && e._resumeCol === beforeCol) {
          shineStats.resumesStalled++;
        }
      }
      return e;
    }
    // ★IIIII252 跨 pair memo 指纹门：档位未命中（典型=底图重烘换代 pair）先查
    //   跨世代 memo——指纹全等 ⇒ 复用 entry 零重烘（预算外也放行：复用无烘焙成本，
    //   且语义 = 缓存未换代时本应命中的那份）。指纹不等 = 真改了格 → 落回重烘。
    if (!(globalThis as { __SW_SHINE_MEMO_OFF?: boolean }).__SW_SHINE_MEMO_OFF) {
      const key = ChunkCache.key(cx, cy);
      const fp = shineChunkFingerprintCached(world, atlas, pair, cx, cy, shimmerQ);
      const mSlot = shineMemo.get(key)?.find((s2) => s2.q === shimmerQ && s2.fp === fp);
      if (mSlot) {
        shineStats.memoHits++;
        // LRU 触碰序
        const m = shineMemo.get(key)!;
        shineMemo.delete(key);
        shineMemo.set(key, m);
        if (slots.length >= 3) {
          const dropped = slots.shift()!;
          // ★债1 死点归还（SITE-1）：dropped ∉ memo（memo=[mSlot.e],而 mSlot.e 若在
          //   slots 则上方 q 命中已提前返回;dropped≠mSlot.e）∧ ∉ 本 slots（刚 shift）
          //   ⇒ 可证死（旧 pair slots 永不绘出,见池化注①）。
          releaseShineEntryCanvases(dropped.e);
        }
        slots.push({ q: shimmerQ, e: mSlot.e });
        return mSlot.e;
      }
      shineStats.memoMisses++;
      // 档位未命中:预算内重烘,预算外用最近档旧帧顶替(shine 渐进更新,无爆发)
      if (budgetExhausted(budget)) {
        if (budget && 'deadline' in budget) shineStats.stale++;
        return slots[slots.length - 1].e;
      }
      const __tBake = performance.now();
      const ne = bakeShineChunk(atlas, world, cx, cy, shimmerQ,
        budget && 'deadline' in budget ? budget.deadline : undefined);
      if (budget && 'deadline' in budget) {
        shineStats.bakes++;
        shineStats.bakeMs += performance.now() - __tBake;
      }
      budgetConsume(budget);
      const oldMemo = shineMemo.get(key);
      if (slots.length >= 3) {
        const dropped = slots.shift()!;
        // ★债1 死点归还（SITE-2 shift）：dropped ∉ 本 slots（刚 shift）∧ 换代后
        //   ∉ memo（下方 set 覆写为 [ne]）⇒ 可证死。
        releaseShineEntryCanvases(dropped.e);
      }
      slots.push({ q: shimmerQ, e: ne });
      shineMemo.delete(key);
      shineMemo.set(key, [{ q: shimmerQ, fp, e: ne }]);
      if (shineMemo.size > SHINE_MEMO_MAX) {
        const oldest = shineMemo.keys().next().value as number | undefined;
        if (oldest !== undefined) shineMemo.delete(oldest);   // 逐出点死点不可证（slots 面不可枚举）→ 不池化,GC 兜底
      }
      // ★债1 死点归还（SITE-2 memo 换代）：被覆写 memo 条目 ∉ 新 memo ∧ 不在本
      //   slots（stale 顶替路径 slots[last] 仍可达它时 = 活,不池化）⇒ 可证死。
      //   与 SITE-2 shift 同条目时抽壳幂等（第二次为零操作）。
      if (oldMemo) {
        for (const om of oldMemo) {
          if (!slots.some((s) => s.e === om.e)) releaseShineEntryCanvases(om.e);
        }
      }
      return ne;
    }
    // 档位未命中:预算内重烘,预算外用最近档旧帧顶替(shine 渐进更新,无爆发)
    if (budgetExhausted(budget)) {
      if (budget && 'deadline' in budget) shineStats.stale++;
      return slots[slots.length - 1].e;
    }
    const __tBake = performance.now();
    const ne = bakeShineChunk(atlas, world, cx, cy, shimmerQ,
      budget && 'deadline' in budget ? budget.deadline : undefined);
    if (budget && 'deadline' in budget) {
      shineStats.bakes++;
      shineStats.bakeMs += performance.now() - __tBake;
    }
    budgetConsume(budget);
    if (slots.length >= 3) {
      const dropped = slots.shift()!;
      // ★债1 死点归还（SITE-3,memo 族关支）：__SW_SHINE_MEMO_OFF 下条目从不跨
      //   slots/memo 共享 ⇒ dropped 可证死。
      releaseShineEntryCanvases(dropped.e);
    }
    slots.push({ q: shimmerQ, e: ne });
    return ne;
  }
  // ★IIIII252 首次(无 slots)同样先过 memo 指纹门(LRU 驱逐重进视野 = 全量重烘主源)
  if (!(globalThis as { __SW_SHINE_MEMO_OFF?: boolean }).__SW_SHINE_MEMO_OFF) {
    const key = ChunkCache.key(cx, cy);
    const fp = shineChunkFingerprintCached(world, atlas, pair, cx, cy, shimmerQ);
    const mSlot = shineMemo.get(key)?.find((s2) => s2.q === shimmerQ && s2.fp === fp);
    if (mSlot) {
      shineStats.memoHits++;
      const m = shineMemo.get(key)!;
      shineMemo.delete(key);
      shineMemo.set(key, m);
      shineCache.set(pair, [{ q: shimmerQ, e: mSlot.e }]);
      return mSlot.e;
    }
    shineStats.memoMisses++;
  }
  // 首次:预算内烘(预算外本帧跳过该 chunk,下帧再烘)
  if (budgetExhausted(budget)) {
    if (budget && 'deadline' in budget) shineStats.skips++;
    return null;
  }
  const __tBake = performance.now();
  const ne = bakeShineChunk(atlas, world, cx, cy, shimmerQ,
    budget && 'deadline' in budget ? budget.deadline : undefined);
  if (budget && 'deadline' in budget) {
    shineStats.bakes++;
    shineStats.bakeMs += performance.now() - __tBake;
  }
  budgetConsume(budget);
  shineCache.set(pair, [{ q: shimmerQ, e: ne }]);
  if (!(globalThis as { __SW_SHINE_MEMO_OFF?: boolean }).__SW_SHINE_MEMO_OFF) {
    const key = ChunkCache.key(cx, cy);
    const fp = shineChunkFingerprintCached(world, atlas, pair, cx, cy, shimmerQ);
    const oldMemo = shineMemo.get(key);
    shineMemo.delete(key);
    shineMemo.set(key, [{ q: shimmerQ, fp, e: ne }]);
    if (shineMemo.size > SHINE_MEMO_MAX) {
      const oldest = shineMemo.keys().next().value as number | undefined;
      if (oldest !== undefined) shineMemo.delete(oldest);   // 逐出点死点不可证 → 不池化,GC 兜底
    }
    // ★债1 死点归还（SITE-4 memo 换代）：本支前提 = 本 pair 此前无 slots（函数头
    //   get 为 undefined）⇒ 被覆写 memo 条目必不在当前 slots（其余 slots 全属旧
    //   世代 pair,永不绘出）⇒ 可证死。挖掘相重烘主 churn 点（每 dig 每邻 chunk
    //   一次）。
    if (oldMemo) {
      for (const om of oldMemo) releaseShineEntryCanvases(om.e);
    }
  }
  return ne;
}

// ---- ★IIIII249 时间盒调度(仅 shineBudgetMs>0 路径;缺省路径零触碰) ----

/** 待烘队列条目:底图重烘会换代 ChunkPair(WeakMap 键),留 pair 引用做身份校验。 */
interface PendingShine { pair: ChunkPair; cx: number; cy: number; seq: number }
const shinePendingQ: PendingShine[] = [];
/** pair → 首次待烘帧号(追赶期计量:chunk 从出现到高光完成的帧数;纯遥测)。 */
const shinePendingSince = new Map<ChunkPair, number>();
let shineSeq = 0;
let shineFrame = 0;
/** 扫描循环只读缓存语义(计数预算 left=0:q 未命中→最近档顶替/无档→null 跳过)。 */
const SHINE_NO_BAKE: { left: number } = { left: 0 };

/** 档位是否缺额(无 slots/q 未命中/条目仍部分烘焙 ⇒ 缺)。 */
function shineChunkNeedy(pair: ChunkPair, shimmerQ: number): boolean {
  const slots = shineCache.get(pair);
  if (!slots) return true;
  for (const s of slots) if (s.q === shimmerQ) return !shineEntryComplete(s.e);
  return true;
}

// ---- ★债2 跨 pair 行级进度 carry（2026-10-06;「pair 换代重启浪费」定谳收口） ----
//
// 【病灶】持续挖掘中每格编辑 → markDirtyAround → 底图重烘 → pair 换代,schedule ①
//   对 cur!==it.pair 的待烘项直接丢弃：partial 条目(_resumeRow=r,已烘 r 行)整条
//   作废,新 pair 从行 0 重烘——base 实测 catchupMax=450 帧/均值 57 帧(208 样本),
//   重烘浪费 = Σ 被丢弃的已烘行 × 行 stamp 成本。
// 【正解】前缀凭证（shineFpPrefix）：partial 条目带 _resumeFp=暂停时刻已烘依赖域
//   指纹。换代时新 pair 以【当前内容】重算同域比对——全等 ⇒ 已烘 r 行的画布产物
//   逐位仍有效（bakeShineChunk 是这些输入的纯函数,画布本体与 pair 无关）⇒ 条目
//   收养进新 pair slots 续烘尾段;不等 ⇒ 真编辑落在已烘域 ⇒ 落回从 0 重烘（旧行为,
//   正确性兜底）。逐次 resume 的暂停都重存凭证 ⇒ 链式 carry 归纳成立（见
//   shineFpPrefix 注）。
// 【memo 一致性】收养条目内容 = 前缀@暂停态 + 尾段@当前态,旧 memo 全量 fp（烘始态）
//   已不描述它 ⇒ 收养时把 memo 槽【改签】为 (收养时点全量 fp, e)（健全性演算见
//   函数体内注;一版曾用 memo.delete,实测令收养条目失-tracking=换代孤儿化绕过池化）。
// 【逃生门】__SW_SHINE_MEMO_OFF 同关（世代复用族总闸 = 旧行为逐字）。
function tryCarryShineProgress(
  world: World, atlas: SpriteAtlas | null, oldPair: ChunkPair, cur: ChunkPair,
  cx: number, cy: number, shimmerQ: number,
): boolean {
  if ((globalThis as { __SW_SHINE_MEMO_OFF?: boolean }).__SW_SHINE_MEMO_OFF) return false;
  const e = shineCache.get(oldPair)?.find((s) => s.q === shimmerQ)?.e;
  const r = e?._resumeRow;
  if (!e || r === undefined || r <= 0 || e._resumeFp === undefined) return false;
  // 新 pair 已有本档进度/完成（memo 命中先行/既有重烘接管）⇒ 不动
  if (shineCache.get(cur)?.some((s) => s.q === shimmerQ)) return false;
  const fpNow = shineFpPrefix(world, atlas, cx, cy, r, e._resumeCol ?? 0, shimmerQ);
  if (fpNow !== e._resumeFp) { shineStats.carriesMiss++; return false; }
  const curSlots = shineCache.get(cur);
  if (curSlots) {
    if (curSlots.length >= 3) curSlots.shift();   // 溢出档回落 GC（memo 共享面在,死点不可证,不池化）
    curSlots.push({ q: shimmerQ, e });
  } else {
    shineCache.set(cur, [{ q: shimmerQ, e }]);
  }
  // ★memo 一致性（上注）：收养条目内容 = 前缀@暂停态 + 尾段@【当前态】,旧 memo 全量
  //   fp（烘始态）已不描述它。修法（2026-10-06 二版）：不删 memo 而【改签】——把槽位
  //   换成 (收养时点全量 fp, e)。健全性：memo 命中要求内容 ≡ fp@收养;此时前缀行
  //   = product(暂停态前缀域) 且 carry 校验已证 暂停态 ≡ 当前态（前缀域）⇒ 前缀行
  //   = product(当前前缀域) ✓;尾段未 stamp,将 stamp 于当前内容 ✓。此后内容若变 ⇒
  //   换代 ⇒ fp 门 miss ⇒ 不误服;内容不变至烘完 ⇒ 条目 ≡ product(fp@收养 内容) ✓。
  //   （一版的 memo.delete 会让收养条目失-tracking——下次换代孤儿化绕过池化,实测
  //   frozen-on 池周转 7 次 vs 无 carry 场景 126 次,即此债。）被换下旧槽条目按
  //   SITE-2 同款判死（不在当前 slots 才池化）。
  const mkey = ChunkCache.key(cx, cy);
  const oldMemo = shineMemo.get(mkey);
  shineMemo.set(mkey, [{ q: shimmerQ, fp: shineChunkFingerprintCached(world, atlas, cur, cx, cy, shimmerQ), e }]);
  if (oldMemo) {
    const slotsNow = shineCache.get(cur)!;
    for (const om of oldMemo) {
      if (!slotsNow.some((s) => s.e === om.e)) releaseShineEntryCanvases(om.e);
    }
  }
  // 追赶账本随条目迁移（catchup 遥测保持「出现→完成」真实时长）
  const since = shinePendingSince.get(oldPair);
  if (since !== undefined) { shinePendingSince.delete(oldPair); shinePendingSince.set(cur, since); }
  shineStats.carries++;
  shineStats.carriedRows += r;
  return true;
}

/** 追赶计量收账(pair 完成时刻 − 首次待烘帧号;遥测面)。 */
function shineCatchupSettle(pair: ChunkPair): void {
  const f0 = shinePendingSince.get(pair);
  if (f0 === undefined) return;
  const dt = shineFrame - f0;
  shineStats.catchupN++;
  shineStats.catchupSum += dt;
  if (dt > shineStats.catchupMax) shineStats.catchupMax = dt;
  shinePendingSince.delete(pair);
}

/** 取证导出(单测/诊断面):断行续烘逐位恒等证明——同一 chunk 一次烘完 vs
 *  按 splits 逐段断开+续烘到完成,产物像素校验和逐字节对拍。写全新条目,
 *  不触碰 shineCache。equal=true ⇔ 续烘链与一次烘完逐位恒等。
 *  ★债3(2026-10-06):cellSplits 传格序数上限链(多段断-续)——格级断点与一次烘完
 *  的逐位恒等证明面(行级 splits 语义原样保留)。 */
export function shineDebugResumeIdentity(
  atlas: SpriteAtlas, world: World, cx: number, cy: number, shimmerQ: number,
  splits: number[], cellSplits?: number[][],
): Array<{ split: number | string; sumA: number; sumB: number; sumXA: number; sumXB: number; equal: boolean }> {
  const digest = (e: ShineChunkEntry) => {
    let sum = 0, sumX = 0;
    for (const c of [e.mul, e.add]) {
      if (!c) continue;
      const d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, S, S).data;
      for (let i = 0; i < d.length; i++) {
        const b = d[i];
        if (!b) continue;
        sum += b; sumX += b * i;
      }
    }
    return { sum, sumX };
  };
  const a = digest(bakeShineChunk(atlas, world, cx, cy, shimmerQ));
  const out: Array<{ split: number | string; sumA: number; sumB: number; sumXA: number; sumXB: number; equal: boolean }> = [];
  for (const split of splits) {
    const b0 = bakeShineChunk(atlas, world, cx, cy, shimmerQ, undefined, undefined, split);
    const b = digest(bakeShineChunk(atlas, world, cx, cy, shimmerQ, undefined, b0));
    out.push({ split, sumA: a.sum, sumB: b.sum, sumXA: a.sumX, sumXB: b.sumX, equal: a.sum === b.sum && a.sumX === b.sumX });
  }
  // ★债3:格级断点链——cellSplits 逐段断-续(每段切一格序数上限,续烘完),与一次
  //   烘完逐位对拍(切分不改 stamp 全序 ⇒ 产物恒等)。
  if (cellSplits) {
    for (const split of cellSplits) {
      let e: ShineChunkEntry | undefined;
      for (let k = 0; k < split.length; k++) {
        e = bakeShineChunk(atlas, world, cx, cy, shimmerQ, undefined, e, undefined, split[k]);
        if (shineEntryComplete(e)) break;
      }
      if (e && !shineEntryComplete(e)) {   // 段链提前烘完 ⇒ 不再续(resume 完成条目=重踏)
        e = bakeShineChunk(atlas, world, cx, cy, shimmerQ, undefined, e);
      }
      const b = digest(e!);
      out.push({ split: split.join('/'), sumA: a.sum, sumB: b.sum, sumXA: a.sumX, sumXB: b.sumX, equal: a.sum === b.sum && a.sumX === b.sumX });
    }
  }
  return out;
}

/** 取证导出(诊断面):待烘队列逐项状态 + 视界 chunk 槽位摘要(卡死定位用)。 */
export function shineDebugPendingState(
  chunks: { get(cx: number, cy: number): ChunkPair },
  bx0: number, bx1: number, by0: number, by1: number, shimmerQ: number,
): {
  pendingQ: Array<{ cx: number; cy: number; near: boolean; validPair: boolean; needy: boolean;
    q: number; resumeRow: number; slotsLen: number }>;
  sinceSize: number; frame: number;
} {
  const rows: Array<{ cx: number; cy: number; near: boolean; validPair: boolean; needy: boolean;
    q: number; resumeRow: number; slotsLen: number }> = [];
  for (const it of shinePendingQ) {
    const near = it.cx >= bx0 - 1 && it.cx <= bx1 + 1 && it.cy >= by0 - 1 && it.cy <= by1 + 1;
    const cur = chunks.get(it.cx, it.cy);
    const slots = shineCache.get(cur);
    const hit = slots?.find((s) => s.q === shimmerQ);
    rows.push({
      cx: it.cx, cy: it.cy, near, validPair: cur === it.pair,
      needy: shineChunkNeedy(cur, shimmerQ),
      q: hit?.q ?? -1, resumeRow: hit ? (hit.e._resumeRow ?? -1) : -1, slotsLen: slots?.length ?? 0,
    });
  }
  return { pendingQ: rows, sinceSize: shinePendingSince.size, frame: shineFrame };
}

/** 时间盒调度:待烘队列(上一帧超线遗留)∪ 视界缺额。先到先得(队列优先)+
 *  组内按 chunk 中心与相机中心距离升序;尽预算即停,剩余标记待烘下帧优先续烘。
 *  ★只对近视野项调 chunks.get——ChunkCache.get 会按需烘底图,视野外调用=屏外烘焙。 */
function scheduleShineBakes(
  atlas: SpriteAtlas, world: World, chunks: { get(cx: number, cy: number): ChunkPair },
  cam: Camera, bx0: number, bx1: number, by0: number, by1: number,
  shimmerQ: number, budget: { deadline: number },
): void {
  shineStats.frames++;
  shineFrame++;
  const camX = cam.x, camY = cam.y;
  const d2 = (cx: number, cy: number) => {
    const dx = (cx + 0.5) * S - camX, dy = (cy + 0.5) * S - camY;
    return dx * dx + dy * dy;
  };
  // ① 待烘队列:近视野者本帧续烘;远离视野者保留待烘资格不占本帧预算;
  //    pair 换代(底图重烘)先走 ★债2 carry(前缀凭证校验,通过=收养续烘,
  //    miss=落回旧行为即弃,缺额由②按当前 pair 重收)
  shineStats.pending = shinePendingQ.length;
  const carry: { cx: number; cy: number; pair: ChunkPair; d: number }[] = [];
  const keep: PendingShine[] = [];
  for (const it of shinePendingQ) {
    const near = it.cx >= bx0 - 1 && it.cx <= bx1 + 1 && it.cy >= by0 - 1 && it.cy <= by1 + 1;
    if (!near) { keep.push(it); continue; }
    const cur = chunks.get(it.cx, it.cy);
    if (cur !== it.pair) {
      // ★债2:换代不即弃——前缀凭证校验通过则收养 partial 条目续烘（miss=落回旧行为）
      if (tryCarryShineProgress(world, atlas, it.pair, cur, it.cx, it.cy, shimmerQ)) {
        carry.push({ cx: it.cx, cy: it.cy, pair: cur, d: d2(it.cx, it.cy) });
      }
      continue;
    }
    if (!shineChunkNeedy(cur, shimmerQ)) { shineCatchupSettle(cur); continue; }
    carry.push({ cx: it.cx, cy: it.cy, pair: cur, d: d2(it.cx, it.cy) });
  }
  // ② 视界缺额(含刚完成的收账)
  const fresh: { cx: number; cy: number; pair: ChunkPair; d: number }[] = [];
  for (let cy = by0; cy <= by1; cy++) {
    for (let cx = bx0; cx <= bx1; cx++) {
      if (cx < 0 || cy < 0 || cx * CHUNK >= world.w || cy * CHUNK >= world.h) continue;
      const pair = chunks.get(cx, cy);
      if (!shineChunkNeedy(pair, shimmerQ)) { shineCatchupSettle(pair); continue; }
      fresh.push({ cx, cy, pair, d: d2(cx, cy) });
    }
  }
  // ③ 先到先得:待烘队列先于本帧新缺额;组内中心升序+pair 去重(planShineWork
  //   纯函数,单测同源);逐项尽预算;未完成者(再)标记待烘。
  //   完成判据用缺额谓词(非条目完成态):超线 stale 顶替返回的是旧档条目,
  //   当前 q 仍缺 → 必须继续留队,不得误记完成。
  const order = planShineWork(carry, fresh, camX, camY);
  // ★BJ94 D2（swPerf 快路径）：复用槽 clear 后重填（槽注；本槽与 planShineWork 槽
  //   严格先后使用不重叠）;flag 关 = 原地 new
  let seen: Set<ChunkPair>;
  if (swPerf) { BJ94_SEEN_SCHED.clear(); seen = BJ94_SEEN_SCHED; }
  else seen = new Set<ChunkPair>();
  const newPending: PendingShine[] = [...keep];
  for (const it of order) {
    seen.add(it.pair);
    shineStats.ensures++;
    const e = ensureEntry(atlas, world, it.pair, it.cx, it.cy, shimmerQ, budget);
    void e;
    if (!shineChunkNeedy(it.pair, shimmerQ)) {
      if (shinePendingSince.has(it.pair)) shineCatchupSettle(it.pair);
      else shineStats.immediate++;
    } else {
      if (!shinePendingSince.has(it.pair)) shinePendingSince.set(it.pair, shineFrame);
      if (!newPending.some((p) => p.pair === it.pair)) {
        newPending.push({ pair: it.pair, cx: it.cx, cy: it.cy, seq: shineSeq++ });
      }
    }
  }
  // ④ 上限保险:待烘队列 FIFO 丢最老(防异常场景无界);追赶账本防泄漏
  if (newPending.length > 128) newPending.splice(0, newPending.length - 128);
  shinePendingQ.length = 0;
  for (const p of newPending) shinePendingQ.push(p);
  if (shinePendingSince.size > 256) {
    for (const k of [...shinePendingSince.keys()]) if (!seen.has(k)) shinePendingSince.delete(k);
  }
}

export interface ShineDev { zz: number; ox: number; oy: number; camRX: number; camRY: number }

/** 乘法 delta 层（render() 世界段、drawAnimatedTileLayer 之后调用）。ctx 处于世界
 *  变换;本函数按 drawChunkGrid 同款 save→恒等 setTransform→设备矩形→restore
 *  （与底图 chunk 共享边同 round 表达式,像素级配准;设备数学处于恒等武装态内 =
 *  dynnap-space-wrapper doctrine）。逐帧动态支（动画 shine 格 + 脉动矿）同函数
 *  尾段交付。 */
export function drawTileShineGrid(
  ctx: CanvasRenderingContext2D, atlas: SpriteAtlas, world: World,
  chunks: { get(cx: number, cy: number): ChunkPair },
  cam: Camera, viewW: number, viewH: number, z: number,
  dev: ShineDev, shimmerAlpha: number, mouseTextColor: number,
): void {
  const st = world.store;
  // 调试逃生门（同 __SW_DYNSNAP_OFF 惯例）：A/B 探针/取证时秒关本通道
  if ((globalThis as { __SW_SHINE_OFF?: boolean }).__SW_SHINE_OFF) return;
  // shimmer 量化进 cache 键(8 档;★重烘有预算分帧,见 ensureEntry——扫频不再爆发)
  const shimmerQ = shimmerAlpha > 0 ? Math.min(1, Math.ceil(shimmerAlpha * 8) / 8) : 0;
  // chunk 界（drawCoatGlowGrid 同式）
  const bx0 = Math.floor((cam.x - viewW / 2 / z) / (CHUNK * TILE)) - 1;
  const bx1 = Math.floor((cam.x + viewW / 2 / z) / (CHUNK * TILE)) + 1;
  const by0 = Math.floor((cam.y - viewH / 2 / z) / (CHUNK * TILE)) - 1;
  const by1 = Math.floor((cam.y + viewH / 2 / z) / (CHUNK * TILE)) + 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);   // 恒等武装（dynsnap doctrine;设备数学在此内）
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';   // A=0 预乘加色语义（同 TileFlames 文件头注）
  // ★IIIII249 预算双形态:timeBudget(?shinebudget=<ms> 时间盒)‖ countBudget
  //   (缺省「每帧 2 chunk」计数预算,逐位不变)。时间盒:调度相先按「先到先得+
  //   中心优先」尽预算烘/续,扫描循环只读缓存(SHINE_NO_BAKE:q 未命中→最近档
  //   旧帧顶替/无档→null 跳过,与计数预算 left=0 同语义)。
  // ★滚屏降级：仅缺省(隐式 4ms)吃相机速度门;显式 shinebudget=N 逐字(0=计数路径)。
  //   speed 相位在盒构造前推进（cameraSpeedPxPerMs 写后即新——下一帧以此为基）。
  //   ★爆发闩（2026-10-04 挖掘相首曝重烘钳制,见 shineBurstLatch 注）内嵌在
  //   adaptive 外层——同点只降不升,显式逐字语义零触碰。
  // ★案 b（幕布期提升,见 setShineEntryBoost 注）：提升窗内 15ms 直通（旁路爆发闩+
  //   速度门——入场首曝=合法爆发面;explicit!=null 时 boostMs=null=原式逐位）。
  //   既有源锚演进登记（2026-10-06）:firstexpose-clamp B 锚 `? shineBurstClamp` 随
  //   本臂形改为 `: shineBurstClamp`（闩仍内嵌 tbNow 构造/adaptive 外层/只降不升,
  //   意图不变;A 门锚与 C 消费锚 byte 逐字未动）。
  const boostMs = shineBudgetExplicit === null ? entryBoostMs : null;
  const tbNow = shineBudgetMs > 0
    ? (boostMs != null ? boostMs
      : shineBurstClamp(adaptiveShineBudgetMs(shineBudgetExplicit,
        cameraSpeedPxPerMs(cam.x, cam.y, performance.now()), shineBudgetMs)))
    : shineBudgetMs;
  const timeBudget = tbNow > 0 ? { deadline: performance.now() + tbNow } : null;
  const countBudget: ShineBakeBudget | undefined = timeBudget ? undefined : { left: 2 };   // ★重烘预算:每帧最多 2 个 chunk 重烘(风暴分帧)
  try {
    if (timeBudget) {
      const bakes0 = shineStats.bakes, skips0 = shineStats.skips;
      scheduleShineBakes(atlas, world, chunks, cam, bx0, bx1, by0, by1, shimmerQ, timeBudget);
      // ★爆发闩收账:本帧发生过首曝冷烘焙(bakes)或冷跳过(skips) ⇒ 下帧缺省盒钳
      //   1.5ms（resume 不计入——挖掘停止后的静止恢复排干保持 base 盒,A/B 方案 a
      //   语义零变;显式/计数路径无条件 false = 零触碰）。
      shineBurstLatch.active = shineBudgetExplicit === null &&
        (shineStats.bakes > bakes0 || shineStats.skips > skips0);
    }
    const scanBudget: ShineBakeBudget | undefined = timeBudget ? SHINE_NO_BAKE : countBudget;
    for (let cy = by0; cy <= by1; cy++) {
      for (let cx = bx0; cx <= bx1; cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= world.w || cy * CHUNK >= world.h) continue;
        const e = ensureEntry(atlas, world, chunks.get(cx, cy), cx, cy, shimmerQ, scanBudget);
        if (timeBudget && e) shineStats.hits++;   // 时间盒命中记账(零烘焙命中渲染;计数路径零触碰)
        if (!e?.mul) continue;
        // 设备矩形 = drawChunkGrid 同一表达式（共享边同 round → 与底图像素配准）
        const xd0 = dev.ox + Math.round((cx * CHUNK * TILE - dev.camRX) * dev.zz);
        const yd0 = dev.oy + Math.round((cy * CHUNK * TILE - dev.camRY) * dev.zz);
        const xd1 = dev.ox + Math.round(((cx + 1) * CHUNK * TILE - dev.camRX) * dev.zz);
        const yd1 = dev.oy + Math.round(((cy + 1) * CHUNK * TILE - dev.camRY) * dev.zz);
        ctx.drawImage(e.mul, 0, 0, S, S, xd0, yd0, xd1 - xd0, yd1 - yd0);
      }
    }
    // ---- 逐帧动态支：动画 shine 格（12 生命水晶/639 魔力水晶…）+ 脉动矿（204/211）----
    //   界 = drawAnimatedTileLayer 同式;格盒设备缩放 s 与其 dev 数学同源（配准底图）
    //   ★globalAlpha 回 1:动态支(t2 生命水晶/脉动矿)走 tileShine2 语义,不吃
    //   shimmerAlpha(那是微光域实心格提亮的门,见 shouldTileShine)——上面 chunk
    //   blit 的 globalAlpha 只属于微光乘法层
    ctx.globalAlpha = 1;
    const tx0 = Math.max(0, Math.floor((cam.x - viewW / 2 / z) / TILE) - 1);
    const tx1 = Math.min(world.w - 1, Math.ceil((cam.x + viewW / 2 / z) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor((cam.y - viewH / 2 / z) / TILE) - 1);
    const ty1 = Math.min(world.h - 1, Math.ceil((cam.y + viewH / 2 / z) / TILE) + 1);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!st.hasTile(tx, ty)) continue;
        const i = st.idx(tx, ty);
        const type = st.type[i];
        const van = TILE_DEFS[type]?.vanilla;
        if (!van) continue;
        const sheet = van.sheet;
        if (!isDynamicAnimSheet(sheet) && !isPulseShineSheet(sheet)) continue;
        if ((st.wire[i] & TileStore.WIRE_ACTUATED) !== 0) continue;
        if ((st.coat[i] & TileStore.COAT_INVISIBLE_BLOCK) !== 0 && !st.showInvisibleBlocks) continue;
        if ((st.coat[i] & TileStore.COAT_FULLBRIGHT_BLOCK) !== 0) continue;
        if (!shouldTileShine(sheet, st.frameX[i], vanillaTileSolid(sheet), shimmerAlpha, st.frameY[i])) continue;
        const additive = isAdditiveShineSheet(sheet);
        const delta = additive ? null : shineDelta(sheet, mouseTextColor, shimmerAlpha);
        if (!additive && !delta) continue;
        const dxa = dev.ox + Math.round((tx * TILE - dev.camRX) * dev.zz);
        const dxb = dev.ox + Math.round(((tx + 1) * TILE - dev.camRX) * dev.zz);
        const dya = dev.oy + Math.round((ty * TILE - dev.camRY) * dev.zz);
        const s = (dxb - dxa) / TILE;
        if (s <= 0) continue;
        if (additive) {
          stampShineCell(atlas, world, tx, ty, sheet, van.frame, van.fw ?? 1, van.fh ?? 1,
            type, st.frameX[i], st.frameY[i], [0, 0, 0],
            ctx, dxa - PAD * s, dya - PAD * s, SCR * s, SCR * s, true, true);
        } else if (delta) {
          stampShineCell(atlas, world, tx, ty, sheet, van.frame, van.fw ?? 1, van.fh ?? 1,
            type, st.frameX[i], st.frameY[i], delta,
            ctx, dxa - PAD * s, dya - PAD * s, SCR * s, SCR * s, false, true);
        }
      }
    }
  } finally {
    ctx.restore();
  }
}

/** +0.39 平加层（render() 光照合成后、drawCoatGlowGrid 之后调用）。设备矩形与
 *  drawCoatGlowGrid 同式（含低清 wKg 约定——同先例同空间）。'lighter' 平加 =
 *  原版 case 262-268 顶点色 +=0.39 的 sprite×0.39 项。★F6b（2026-09-08 注释销账,
 *  行为不动=登记近似②既有备案）精度边界如实声明：原版把 +0.39 加在【光】上再
 *  逐通道钳 1（Color 重载 +100/255 后钳 255,Main.cs:21828-21830/:21850-21856）——
 *  亮 texel（L≈1 的 Gemspark 自光域）+0.39 被钳没=原版零增量;本仓合成后平加,
 *  亮 texel 最多 +39% 过亮（近似上界）。暗区恒精确：L 小时钳不触发,平加 =
 *  sprite×(L+0.39) ≡ 原版 sprite×clamp(L+0.392)（本通道目标域）。 */
export function drawTileShineAdditive(
  ctx: CanvasRenderingContext2D, world: World,
  chunks: { get(cx: number, cy: number): ChunkPair },
  cam: Camera, viewW: number, viewH: number, z: number, lowK: number,
): void {
  if ((globalThis as { __SW_SHINE_OFF?: boolean }).__SW_SHINE_OFF) return;
  const wKg = lowK || 1;
  const lwg = Math.round(viewW * wKg), lhg = Math.round(viewH * wKg);
  const ox = Math.round(lwg / 2), oy = Math.round(lhg / 2);
  const zz = z * wKg;
  const camRX = Math.round(cam.x * z) / z;
  const camRY = Math.round(cam.y * z) / z;
  const bx0 = Math.floor((cam.x - viewW / 2 / z) / (CHUNK * TILE)) - 1;
  const bx1 = Math.floor((cam.x + viewW / 2 / z) / (CHUNK * TILE)) + 1;
  const by0 = Math.floor((cam.y - viewH / 2 / z) / (CHUNK * TILE)) - 1;
  const by1 = Math.floor((cam.y + viewH / 2 / z) / (CHUNK * TILE)) + 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  try {
    for (let cy = by0; cy <= by1; cy++) {
      for (let cx = bx0; cx <= bx1; cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= world.w || cy * CHUNK >= world.h) continue;
        const slots = shineCache.get(chunks.get(cx, cy));
        const e = slots?.find((s0) => s0.e.add)?.e;   // 任一档含平加层即用(+0.39 与档无关)
        if (!e?.add) continue;
        const xd0 = ox + Math.round((cx * CHUNK * TILE - camRX) * zz);
        const yd0 = oy + Math.round((cy * CHUNK * TILE - camRY) * zz);
        const xd1 = ox + Math.round(((cx + 1) * CHUNK * TILE - camRX) * zz);
        const yd1 = oy + Math.round(((cy + 1) * CHUNK * TILE - camRY) * zz);
        ctx.globalAlpha = 1;   // 平加 +0.39 与 shimmerAlpha 无关(原版加在顶点色光上)
        ctx.drawImage(e.add, 0, 0, S, S, xd0, yd0, xd1 - xd0, yd1 - yd0);
      }
    }
  } finally {
    ctx.restore();
  }
}
