// 原版 Dust 引擎（Dust.cs NewDustPerfect :52-63 / NewDust :75-285 / CloneDust
// :260-288 / UpdateDust :423-2450 / Main.DrawDust :38266-38436 / GetAlpha
// :2469-2772 / GetColor :2773-2817）——翅膀视觉批引入，拴绳小动物批扩表。
//
// 范围说明：本引擎双通道扩表——① **精植**：按"消费方已用到的 type"逐型移植
// （翅膀尘埃 13 型：6/31/43/55/58/76/86/182/217/229/240/261/264；拴绳批 5 型：
// 43/15/267/278/6；钻头坐骑 230——见各 case 行号），逐型带源码行号；
//   2026-09-03 双轴/1135 批追加：水尘族 NewDust :232-237 + UpdateDust :1904-1946
//   独立段（33 缺省水型=1135 KrakenWave 尾尘;52/266/98-105/123/288 随单段源支
//   同移植;308 兄弟支 :227-230 无 alpha=170,★F5 2026-09-08 补 spawn 侧）+
//   PrettySparkle 双轴通道（scaleX/scaleY,接口注）;
// ② **家族补全**（2026-09-01 起）：整段家族一次到位，含当前 0 发射方的型，
// 防将来启用时静默缺光/缺 alpha——首批 EoC/肉山尘族 110-114/311-313（Dust.cs
// 链 A 独占链接 :1564-1635 + GetAlpha :2583-2586，均无 noLight/noLightEmittance 门）；
// NewDust 初始化链与通用老化链
// （fadeIn=生长目标语义 :2148-2171：0<fadeIn<100 时 scale += 0.03/t 至超 fadeIn
// 转衰落；否则 scale -= 0.01/t）全量 1:1。后续其它系统接入新 type 时按同法扩表。
//
// 结构澄清（1456 Dust.cs 两处易混的 else-if 链，扩表时勿再合并）：
//  ① 883 起的独占链（…235/烟雾族 890/…31 组 1336/…55 组 1759/76@1810/…重力 1884）：
//     命中任一链接即跳过其余链接与 :1884 重力——本引擎 chainLink=true 对应；
//  ② 2080 起的另一条独占链（41@2080/44@2108/兜底 2136 vx×0.99）：与 ① 平行，
//     **全体尘都会评估**（含 ① 已命中者）。本引擎沿用既有近似——链 A 命中者不乘
//     0.99（效应每 tick ×0.99，翅膀尘场景不可辨），独立段型（230/217/240）按源码
//     显式乘。230/644、240/592、263/625 等独立 if 段不属于任何链，逐段全执行。
//
// UpdateDust 结构（照源码三分段，勿合并）：
//  ① 链 A 独占 else-if 链（:423-2139）：一尘至多命中一链接，命中者跳过 :1884
//     通用重力与 :2136 兜底 vx×0.99（267/278 例外见 case 注）；
//  ② 公共段：:2144 旋转 + :2148 fadeIn 老化（全体）；
//  ③ 链 B 独占链（1457 行号 :2202-2413）：130-134（:2202）/278（:2245）/219-223
//     （:2275）/226（:2317）/331（:2352）/272（:2375）+ :2407 兜底
//     （type!=304 && noGravity → velocity×0.92、fadeIn==0 时 scale−0.04）。
//     ★R4-30：226/272/331 三档已实装（226 固定蓝光/272 固定紫光/331=1457 新自色光
//     受 noLightEmittance 门）——头注曾虚标覆盖、实际 switch 缺 case（226 被闪电弹
//     真实消费落 default）。★F2（2026-09-08）：130-134/219-223 两支补齐（此前头注
//     虚标成员、switch 实缺 → 落 default 吃兜底=原文明文拒绝）。331 绘制端拖影/四向
//     贴片（M57:39639-39695）已实装（Renderer 拖影 331 专属色 +本体五贴片+全亮桶,2026-09-01 清偿）。
//  本引擎 switch(链A)+老化后 switch(链B) 两段对应；261/264/182 维持翅膀批
//  既有链 A 单段近似（其后通用重力照旧——扩表时勿动）。
//
// 光照：261/264/182/43/15 族/267/278/6 与 EoC·肉山族（110-114/311-313，家族补全
// 2026-09-01）逐尘 AddLight（update 期收集 → Game 推 LightingEngine）；43 型需读光（Lighting.GetColor :1475 照度门）——update 由
// Game 注入 lightAt 采样器；278 型入实心格收缩（:2264 Collision.SolidCollision
// 10×10 盒）需 solidBoxAt 探针（Game 注入 solidCollisionBox 1:1,半砖下 8/斜坡整格）；
// 两者缺省 = 全亮/不实心（无注入时门不误杀）。
// 绘制：亮色族 {6,15,59-64}（DrawDust 强制 White :38406）画在光照合成之后
// （= 原版 GetColor(White) 等价），其余画在合成前（逐像素乘光 ≈ 原版逐尘取光）。
// 双 pass：本体（GetAlpha）+ 自定义色 pass（GetColor 加性钳位 :2773）。

export interface DustColor { r: number; g: number; b: number; a: number }

import { modDustFullbright, modDustMotionOf, modDustNoLight } from '../mods/dusts';   // ★D12:mod 尘全亮桶(dusts 运行时零引擎依赖,无环)

export interface VDust {
  active: boolean;
  x: number; y: number;
  vx: number; vy: number;
  type: number;
  /** ★D12 余债(2026-10-13):mod 尘原 type 载体——motionType 声明时 spawn 期
   *  d.type 重写为运动档原版 type(update 运动链/alphaOf/速度特例全行为复用),
   *  本字段保原 mod type(渲染分支/全亮桶读它;undefined=原版尘) */
  modType?: number;
  scale: number;
  /** ★双轴通道（2026-09-03 VDust 双轴基建）：原版 PrettySparkleParticle 的
   *  Vector2 Scale 逐轴档（PrettySparkleParticle.cs:72-73 两臂都乘【整个】
   *  Vector2 Scale——长度轴吃 Scale.Y×2/×1、宽度轴吃 Scale.X×0.3）。任一在位
   *  = 双臂星芒绘制面（Renderer.drawVanillaDustPass 消费位,Extra_98 几何逐值;
   *  rotation 字段即原版 Rotation,本接口既有字段缺省 0）。缺省（双双 undefined）
   *  = 既有单标量 scale 渲染,路径逐字节等价。update 老化链对两轴同步作用
   *  （update 内 ★双轴同步——本拍 scale 合成比逐轴同乘）。池复用安全：
   *  spawn() 归位 undefined；CloneDust 随源尘复制（clone()）。 */
  scaleX?: number;
  scaleY?: number;
  alpha: number;
  /** 生长目标（0<值<100 时逐 tick +0.03 至超越转 0；0 = 直接衰落） */
  fadeIn: number;
  noGravity: boolean;
  noLight: boolean;
  noLightEmittance: boolean;
  color: DustColor | null;
  rotation: number;
  /** Dust.png 格坐标（10px 格、8×8 取样框） */
  fx: number; fy: number;
  /** customData = 主角（旧位跟随；263/264/182 一次性后清除，261 持续） */
  followPlayer: boolean;
  followOnce: boolean;
  /** customData = NPC（:896-917 229/228/279 档 dust.position += npc.position -
   *  npc.oldPos[1]）。闭包返回被跟实体【上一拍位移】；终清烟批（月总水蛭
   *  aiStyle82 d229 环 :37102-37116）为首个消费方。池复用安全：spawn() 归零。 */
  followEnt: (() => { dx: number; dy: number }) | null;
  /** ★interp（2026-10-15 ③收刀）:本步跟随平移量（update 跟随支记录;undefined=
   *  无跟随/出生首步前）。渲染期按 interpA 退回 (1−α)×本量——跟随=60Hz 整步平移
   *  vs 插值相机=贴附尘跳步（SwingArc TrailingMode 4 补偿同构;用户普查令落刀）。
   *  克隆不复制（cloneDust 出生跟随态归零语义 ✓ undefined 退回 0）。 */
  lastFollowX?: number;
  lastFollowY?: number;
  /** customData = Vector2（:906-912 吸向档）——velocity=(v×4 + 单位向·|v|)/5。
   *  终清波批接入：幻影之门 aiStyle108 聚尘/开门两段（P.cs:34435/:34640 族,
   *  门心快照）。followPlayer/followEnt 同档不共存（原版 customData 单值）。 */
  attractTo: { x: number; y: number } | null;
  /** 染料 vid（-1 无；GetSecondaryShader(cShoe/cWings) 等价——渲染端跑
   *  SM2 染料字节码（63 pass 全技术，含彩虹/反射/凝胶等动态族）） */
  dyeVid: number;
  /** ★APF 通道（2026-09-03 最后基建缺口清偿）：原版 PrettySparkleParticle/
   *  ABasicParticle 的 AccelerationPerFrame（速度逐 tick 线性加速）——orchestraFx
   *  princess/stardust 等 PrettySparkle 站迁移消费（-vector/TTL 减速弧）。
   *  池复用归零（spawn 归零段同步）。 */
  ax?: number;
  ay?: number;
  /** ★PrettySparkle 专用档（2026-09-03）：update 早退仅 APF+TTL（原版
   *  PrettySparkleParticle.Update = AccelerationPerFrame + TimeToLive 定值消亡,
   *  无 Dust 链 A/B/老化/重力）——orchestraFx PrettySparkle 站 1:1 迁移载体。 */
  prettySparkle?: boolean;
  ttl?: number;
  /** ★PrettySparkle 逐粒包络扩展（2026-09-03 拍击石 kind1 焰爆石环带接入）：
   *  PrettySparkleParticle 的 FadeInEnd/FadeOutStart/FadeOutEnd（Draw :68-69 臂长
   *  包络,帧×60/TTL 归一格）、FadeInNormalizedTime/FadeOutNormalizedTime（:22-23
   *  Opacity 包络,归一比）与 DrawVerticalAxis（:26 双臂开关）。undefined =
   *  FetchFromPool 缺省（20/30/45、0.05/0.9、true）——既有 princess/stardust 站
   *  零改动（原版不写即缺省）。拍击石站 = 15/15/30、5E-06/0.95、false。 */
  psFadeInEnd?: number;
  psFadeOutStart?: number;
  psFadeOutEnd?: number;
  psFadeInNorm?: number;
  psFadeOutNorm?: number;
  psDrawVert?: boolean;
  /** _timeSinceSpawn（PrettySparkleParticle.Update :54 逐拍 +1——包络 t 源；
   *  TimeToLive 初值 = 当前 ttl + psAge） */
  psAge?: number;
  /** ★AdditiveAmount 通道（2026-09-03 R3 ③清偿）：原版 PrettySparkleParticle.
   *  AdditiveAmount（PrettySparkleParticle.cs:20 池缺省 1f;FetchFromPool :43 复位 1f）
   *  ——Draw :67 `color2.A = color2.A×(1−AdditiveAmount)` 的 dst 衰减项驱动
   *  （Renderer.drawSparkleArms erase 消费位）。站点值：拍击石 kind1 红=0.35
   *  （ParticleOrchestrator.cs:681）；金（:698-721 无写入）/公主/星尘 = 池缺省 1f
   *  （→ color2.A=0,tint 臂无 dst 衰减,纯加色）。undefined = 缺省 1f。 */
  psAdditive?: number;
  /** ★ABasicParticle Scale 二次链（:47-49 ScaleVelocity += ScaleAcceleration;
   *  Scale += ScaleVelocity）——拍击石 kind1 ScaleAcceleration = (−4,0)/num
   *  （ParticleOrchestrator.cs:679/:708）。undefined = 无动力学（既有站缺省）。 */
  scvx?: number; scvy?: number;
  scax?: number; scay?: number;
}

/** 尘池容量 = 原版 Main.dust[6000]（Main.cs :734 dust = new Dust[6000]）。
 *  ★2026-09-02 定谳：曾 512=把「Main.maxDustToDraw 绘制分档」误当池容量——
 *  两概念在原版分离（池 6000 / 绘制遍历另有 maxDustToDraw 分档）。512 实测：
 *  连发火箭 8 发尘池 504/512、spawnDust nullDrops=170（火箭烟尾 d6/火 d31 被
 *  池满丢弃=用户实报"连发只看到弹体没有尾焰"根因）。6000 遍历成本：空槽
 *  active 早退，draw 侧另有视口剔除（±1000/±1050）双重过滤。 */
const POOL = 6000;

/** Main.maxDustToDraw 缺省（Main.cs:1102 = 6000；:17244 gfxQuality 折减本仓不建模）
 *  ——dCount 阶梯分母（Dust.cs:2471-2487）。与池容量 POOL 同值但概念分离
 *  （★2026-09-02 定谳,见 POOL 注）,勿合并。 */
const MAX_DUST_TO_DRAW = 6000;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** 烟雾族光链 20 档专表（★R3 F1:Dust.cs:919-1097 逐支对拍;[r,g,b] 乘 num60,
 *  火把色源 TorchID.cs:137-150 恒量段——75=诅咒8(1,1.6,0.5)/135=冰9(0.75,0.85,1.4)/
 *  169=伊克萨尔11(1.4,1.4,0.7)/158=橙10(1,0.5,0)/242=15(1,0,1)/293=16x0.95/
 *  294-298=17-21/307=22/127=(1,0.45,0.2)x1.3/187=(0.2,0.45,1)x1.3/29=(0.1,0.4,1)/
 *  228=(0.7,0.65,0.3)/229=(0.3,0.65,0.7);59-65=火把(1+type-59) 钳 0.8。
 *  65→火把 7 恶魔、310→火把 23 微光、14 Disco 均为【动态光结构】不建模→落 6 型
 *  尾档近似(备案) */
const SMOKE_LIGHT: Record<number, [number, number, number]> = {
  29: [0.1, 0.4, 1],
  75: [1, 1.6, 0.5], 135: [0.75, 0.85, 1.4], 169: [1.4, 1.4, 0.7], 158: [1, 0.5, 0],
  228: [0.7, 0.65, 0.3], 229: [0.3, 0.65, 0.7],
  242: [1, 0, 1],
  293: [1.33, 0.8075, 0.5225],   // 火把 16 (1.4,0.85,0.55)×0.95
  294: [0.25, 1.3, 0.8], 295: [0.95, 0.4, 1.4], 296: [1.4, 0.7, 0.5],
  297: [1.25, 0.6, 1.2], 298: [0.75, 1.45, 0.9],
  307: [0.3, 0.78, 1.2],
  127: [1.3, 0.585, 0.26], 187: [0.26, 0.585, 1.3],
  59: [1.12, 1.12, 1.12], 60: [0.8, 0.08, 0.08], 61: [0, 0.8, 0.08],
  62: [0.72, 0, 0.72], 63: [1.12, 1.12, 1.12], 64: [0.72, 0.72, 0],
};

/** C# default(Color)（NewDust :170 dust.color = newColor 的缺省实参）= (0,0,0,0)。
 *  逐型分支读 color.R/G/B 时按此兜底——无色尘的发光贡献恒 0（与原版一致）。 */
const BLACK: DustColor = { r: 0, g: 0, b: 0, a: 0 };

/** NewDust 帧映射（:176-191）：X = 10·type，type≥100 每 100 减 1000 加 Y+30。
 *  导出供回归测试锚定（dust 268 帧曾因心算少一轮循环裁成 (680,20)=dust 168 格,
 *  蓝十字×沙色=暗绿"树叶",2026-08-31 定谳——本公式是唯一权威,禁手算内联） */
export function dustFrameOf(type: number): { fx: number; fy: number } {
  let fx = 10 * type, fy = 10 * (Math.random() * 3 | 0);
  let t = type;
  while (t >= 100) { t -= 100; fx -= 1000; fy += 30; }
  return { fx, fy };
}

/** ★BJ466 spawn 屏外裁剪 margin（Dust.NewDust :97 `int num = (int)(400f * (1f - dCount))`）。
 *  导出供回归测试钉值（同 dustFrameOf 体裁）。★f32 钉值（BJ466 复核定谳）：C# float
 *  算术逐运算 f32——六档实值 {400,200,159,120,79,40},非理想实数域 {…160…80…}：
 *  400f×(1f−0.6f)=159.99998→(int)159、400f×(1f−0.8f)=79.99999→(int)79（乘积落在整数
 *  下方 0.625 ULP,f32 舍入后仍 <160/<80）;0.9 档 f64 直算反为 39（1−0.9f64=0.0999…×400
 *  =39.999…）而 f32 40.00001→40——vanilla 恒 f32（BJ342 157 型同族判例）。 */
export function dustCullMarginOf(dCount: number): number {
  return Math.trunc(Math.fround(400 * Math.fround(1 - dCount)));
}

export class VanillaDust {
  /** 上帧湿碰探针（update 注入;spawn 侧 :246-253 气泡族生成时湿判复用） */
  wetProbe: ((px: number, py: number, w: number, h: number) => boolean) | null = null;
  private pool: VDust[] = [];
  private cursor = 0;
  /** 活跃尘计数（update 每帧全池遍历顺带重数——密度门 frac 的真负载源,见 spawn 门注）。
   *  首帧前=0（门低分位恒不触发=首帧批 spawn 零拒绝,与原版低负载行为同）。 */
  private activeCount = 0;
  /** ★BJ466 spawn 屏外裁剪视口暂存（update 形参 screenX/Y/W/H,世界像素口径——
   *  Game :10053 传 camera 视域,即 NewDust :98 的 Main.screenPosition/screenWidth
   *  等价域）。★首帧 update 前不裁（viewValid=false）——与「update 前无视口」的
   *  既有契约同相（dust-pool-gate 套件在 update 前 spawn 灌池）。
   *  一帧滞后备案：spawn 发生在两帧 update 之间时用上帧视口——margin 400 域内
   *  单帧相机位移无感。 */
  private viewX = 0;
  private viewY = 0;
  private viewW = 0;
  private viewH = 0;
  private viewValid = false;
  /** ★BJ466 dCount（Dust.cs:12 `public static float dCount`）——update 尾阶梯定值
   *  （Dust.cs:2470-2494,activeN 驱动）,spawn 裁剪 margin 消费（:97）。恒为
   *  {0,0.5,0.6,0.7,0.8,0.9} 的 f32 实值（fround）。 */
  private dCount = 0;
  /** update 期收集的光照（Game 每帧推 LightingEngine 后清空） */
  lights: Array<{ x: number; y: number; r: number; g: number; b: number }> = [];

  constructor() {
    for (let i = 0; i < POOL; i++) {
      this.pool.push({
        active: false, x: 0, y: 0, vx: 0, vy: 0, type: 0, scale: 1, alpha: 0,
        fadeIn: 0, noGravity: false, noLight: false, noLightEmittance: false,
        color: null, rotation: 0, fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1,
        followEnt: null,
        attractTo: null,
      });
    }
  }

  /** NewDust（:75-285）：位置/速度抖动、scale 抖动、type-6 烟雾初速特例、
   *  屏外裁剪（★BJ466 实装：margin=(int)(400×(1−dCount)) 外圈不生成,dCount 阶梯
   *  =update 尾 :2470-2494;首帧 update 前与 prettySparkle 载体豁免（★BJ480 复裁:
   *  perfect 不豁免——原版 NewDustPerfect 经 :56 委托照吃裁剪,见实现注）。
   *
   *  opts.perfect = NewDustPerfect 变体通道（Dust.cs:52-63）：内部仍走完整 NewDust
   *  初始化链（含屏外裁剪 :97-103——★BJ480 复裁:不豁免;含 0 宽盒抖动窗/rand ±2
   *  初速/烟雾族特例），随后仅两个字段被完整
   *  覆写——`dust.position = Position`（盒抖动消解）、Velocity.HasValue 时
   *  `dust.velocity = Velocity.Value`（本仓调用侧恒传具体向量）。由此：
   *  · 烟雾族特例（216-222 型表 242/75/169 等）的 vy 重掷与 vx×0.3 被覆写消解，
   *    定向速度向量原样入池（调用侧全责定义速率域）；
   *  · 其余字段（scale 含 ×0.7 烟雾衰减、alpha/color/frame/fadeIn 等）保持
   *    NewDust 结果——原版 Perfect 不覆写它们，调用侧可像原文那样后置赋值。
   *
   *  opts.prettySparkle = PrettySparkle 编排粒子载体通道（R3 ④清偿 2026-09-03）：
   *  原版 PrettySparkle【不入 Dust 池】——_poolPrettySparkle.RequestParticle() 零掷
   *  零门（ParticlePool.cs:32-51 只扫空位/扩 List,无 dCount 门无 rand 掷）。由此本
   *  分支直取槽位绕密度门 + 绕 NewDust 全部内部随机掷（位抖/速抖/帧 fy 掷/比例抖
   *  四掷全免,掷流口径备案:本分支 0 掷）——位置/速度 = NewDustPerfect 覆写面同值
   *  （LocalPosition/Velocity 精确,ParticleOrchestrator.cs:3374/:3377/:3425/:3430）、
   *  scale = Scale 形参精确（无 ±0.2 抖）。烟雾/水尘族特例同属 NewDust 链,一并跳过
   *  （prettySparkle 载体 type=0 恒不触,守卫为语义显式化）。 */
  spawn(x: number, y: number, w: number, h: number, type: number,
    speedX = 0, speedY = 0, alpha = 0, color: DustColor | null = null, scale = 1,
    opts?: { perfect?: boolean; prettySparkle?: boolean }): VDust | null {
    // ★BJ466（2026-10-03）spawn 头屏外裁剪（Dust.NewDust :97-101）：margin=
    // (int)(400×(1−dCount))（dustCullMarginOf,dCount 阶梯=update 尾 :2470-2494）;
    // 视口=screenPosition 四向外扩 margin;spawn 盒=(Position,10,10) 恒定（w/h 形参
    // 只决定盒内偏移分布 :155-173,不进裁剪式）;不相交→拒且零 RNG 消费——本早退位于
    // 槽搜索与密度门（:106-151）之前,被裁 spawn 不动任何 Math.random 掷=反伪影关键
    // （原版裁剪先于密度梯同序）。XNA Rectangle.Intersects=四向严格不等（贴边不相交）;
    // C# (int) 截断=trunc,且 (int)(screenPosition.X−num) 是对【差式】单次截断,
    // 勿拆成 trunc(x)−margin（x<margin 时跨零语义不同）。
    // ★BJ480 复裁（2026-10-03）：豁免面只留 prettySparkle 载体（ParticlePool.cs:29-46
    //  RequestParticle 零门零掷,与 Dust 池全异）;perfect 【不】豁免——BJ460③ 钉案被
    //  BJ466 勘误推翻,定谳锚=Dust.cs:56 `Main.dust[NewDust(Position,0,0,…)]` 完整委托:
    //  裁剪面 :97-103 先于 :57-61 位/速覆写执行,裁剪盒 :99=(Position,10,10) 恒定
    //  （Width/Height 形参不进裁剪式,0,0 宽高不构成豁免）;被裁 NewDust 返 6000 →
    //  Main.dust[6000]=inactive 哨兵槽（Main.cs:1692 容量 6001/:6824-6828 j<6001
    //  初始化;UpdateDust :436 与绘制循环只走 <6000/<maxDustToDraw,哨兵永不更新/绘制）,
    //  覆写落哨兵即蒸发=等价拒,调用侧链式后置写随写随没=原版同相（调用方普查:原版
    //  NewDustPerfect 158 调用点全同吃裁剪;本仓 spawnDust 池满 null 契约同面,
    //  守卫/直调两态安全）。视口未暂存（首帧前）不裁。
    if (this.viewValid && opts?.prettySparkle !== true) {
      const margin = dustCullMarginOf(this.dCount);
      const vl = Math.trunc(this.viewX - margin);
      const vt = Math.trunc(this.viewY - margin);
      const vr = vl + this.viewW + margin * 2;   // Main.screenWidth + num*2（int 域）
      const vb = vt + this.viewH + margin * 2;
      const bx = Math.trunc(x);
      const by = Math.trunc(y);
      // rectangle.Intersects(value)（rectangle=视口,value=spawn 盒,FNA Rectangle.Intersects
      //  四向严格不等）：bx<vr && vl<bx+10 && by<vb && vt<by+10
      if (!(bx < vr && vl < bx + 10 && by < vb && vt < by + 10)) return null;
    }
    let d: VDust | null = null;
    let slot = -1;
    for (let i = 0; i < POOL; i++) {
      const c = this.pool[(this.cursor + i) % POOL];
      if (!c.active) { slot = (this.cursor + i) % POOL; d = c; this.cursor = (slot + 1) % POOL; break; }
    }
    if (!d) return null;
    const ps = opts?.prettySparkle === true;
    // ★R2 #4:原版 dCount 概率密度门（Dust.cs:122-151,无环形覆盖——CloneDust 池满
    // 返回 null 契约保持）:池压五档渐进拒绝（>90% 3/4 / >80% 2/3 / >70% 1/2 /
    // >60% 1/4 / >50% 1/5;≤50% 不拒）——292 爆区 25/t 的自节流通道,不饿死他人
    // ★2026-09-03 复发定谳（用户实报"7-9 发无尾焰复发+时有时无"）：曾 frac=slot/POOL
    //  （空槽【下标】分位）——512 池时等价真负载（游标快绕）;6000 池后游标漂进高分位
    //  后要 3000 次 spawn 才回绕 → 密度门把低负载误判高压力 → 概率拒新尘。原版的门
    //  之所以等价真负载,靠的是槽搜索【从 0 头扫】（Dust.cs:106 for i=0…;第一个空槽
    //  i≈活跃前缀数）——本仓环形游标优化破坏了该等价。修=frac 改用 update 每帧全池
    //  遍历顺带重数的 activeCount（真负载,一帧滞后无感）,游标只服务空槽定位。
    //  ★R3 ④（2026-09-03）：prettySparkle 载体绕门（原版不入 Dust 池,零掷零门
    //  ParticlePool.cs:32-51）——Math.random 也不消费（直取槽位）
    if (!ps) {
      const frac = this.activeCount / POOL;
      const r = Math.random();
      if ((frac > 0.9 && r >= 0.25) || (frac > 0.8 && r >= 1 / 3) ||
          (frac > 0.7 && r < 0.5) || (frac > 0.6 && r < 0.25) ||
          (frac > 0.5 && r < 0.2)) return null;
    }
    const w2 = Math.max(5, w), h2 = Math.max(5, h);
    d.active = true;
    d.modType = undefined;   // ★D12 余债:池复用归位(mod 载体残值=原版尘误走 mod 渲染支)
    d.type = type;
    // ★D12 余债:motionType 复用(mod 尘 400+;重写后 update/alphaOf 全行为=运动档;
    //  原版帧面 fx/fy 随档算——渲染分支按 modType 取独立贴图,fx/fy 无消费面)
    if (type >= 400) {
      d.modType = type;
      const mMotion = modDustMotionOf(type);
      if (mMotion > 0) d.type = mMotion;
      // ★R-C-D12-F1:noLight 声明=运动档光贡献 opt-out(spawn 期写位;update 链
      //  AddLight 门 !noLight&&!noLightEmittance 读本双旗)
      if (modDustNoLight(type)) { d.noLight = true; d.noLightEmittance = true; }
    }
    d.noGravity = false;
    d.color = color;
    d.alpha = alpha;
    if (ps) {
      // ★PrettySparkle 载体零掷直写（R3 ①/④,2026-09-03）：NewDust 四掷全免——
      //  位/速 = Perfect 覆写面同值（原版 LocalPosition/Velocity 精确直装,
      //  ParticleOrchestrator.cs:3374-3377 princess/:3425-3430 stardust/:672-684 kind1）、
      //  scale = Scale 形参精确、Dust.png 帧零掷钉值（双轴尘渲染走 drawSparkleArms
      //  Extra_98,fx/fy 无消费面——drawVanillaDustPass axis.dual 早退）
      d.x = x; d.y = y;
      d.vx = speedX; d.vy = speedY;
      d.fx = 10 * type; d.fy = 0;
      d.scale = scale;
    } else {
      d.x = x + (Math.random() * (w2 - 4) | 0) + 4;
      d.y = y + (Math.random() * (h2 - 4) | 0) + 4;
      d.vx = ((Math.random() * 41 | 0) - 20) * 0.1 + speedX;
      d.vy = ((Math.random() * 41 | 0) - 20) * 0.1 + speedY;
      const f = dustFrameOf(type);
      d.fx = f.fx; d.fy = f.fy;
      d.scale = (1 + ((Math.random() * 41 | 0) - 20) * 0.01) * scale;
    }
    d.rotation = 0;
    d.noLight = false;
    d.fadeIn = 0;
    d.noLightEmittance = false;
    d.followPlayer = false;
    d.followOnce = false;
    d.followEnt = null;
    d.attractTo = null;
    d.dyeVid = -1;
    // ★双轴通道池复用归位（缺省 = 单标量 scale 渲染,见接口注）
    d.scaleX = undefined;
    d.scaleY = undefined;
    d.ax = undefined;
    d.ay = undefined;
    d.prettySparkle = undefined;
    d.ttl = undefined;
    // ★PrettySparkle 逐粒包络扩展池复用归位（缺省 = FetchFromPool 默认包络）
    d.psFadeInEnd = undefined;
    d.psFadeOutStart = undefined;
    d.psFadeOutEnd = undefined;
    d.psFadeInNorm = undefined;
    d.psFadeOutNorm = undefined;
    d.psDrawVert = undefined;
    d.psAge = undefined;
    d.psAdditive = undefined;
    d.scvx = undefined; d.scvy = undefined;
    d.scax = undefined; d.scay = undefined;
    // :221-226 烟雾族初速特例（本批 type 6 命中；59-65 等后续接入同享）——
    //  prettySparkle 载体不进 NewDust 链,特例随链跳过（见 spawn 头注 ps 分支）
    if (!ps && (type === 228 || type === 279 || type === 269 || type === 135 || type === 6
      || type === 242 || type === 75 || type === 169 || type === 29 || (type >= 59 && type <= 65)
      || type === 158 || (type >= 293 && type <= 298) || type === 302 || type === 307 || type === 310)) {
      d.vy = ((Math.random() * 16 | 0) - 10) * 0.1;
      d.vx *= 0.3;
      d.scale *= 0.7;
    }
    // ★BJ338 件2（2026-09-24）:227-230 127/187 烟雾分立 if 转正——原版两支互斥
    //  独立（烟雾族句不含 127/187）：velocity 矢量×0.3（vx/vy 同乘,vy=基础掷
    //  rand(-20,21)×0.1+SpeedY 后 ×0.3=±0.63 对称,SpeedY 随行）+ scale×0.7。
    //  曾并入烟雾族句=127/187 的 vy 走族内重掷 rand(-10,6)×0.1（[-1.0,0.5] 不对称
    //  下坠偏置,且 SpeedY 丢弃）→ 飘散轨迹可见面（火焰箭尾迹 Arrow.ts FLARE_DUST
    //  163→127/310→187、DD2 敌怪施法烟 Enemy.ts:13593 517→127）。
    if (!ps && (type === 127 || type === 187)) {
      d.vx *= 0.3;
      d.vy *= 0.3;
      d.scale *= 0.7;
    }
    // ★F5（2026-09-08 红队清偿）:227-230 308 兄弟支——velocity×0.5 + Y++，【无】
    //  alpha=170（170 是 :232-237 水尘族句内赋值,308 不在其成员表;update 侧水尘族
    //  独立段 :1904 源支本就含 308,仅 spawn 侧缺）。prettySparkle 载体随链跳过
    //  （同水尘族注）。
    if (!ps && type === 308) {
      d.vx *= 0.5;
      d.vy = d.vy * 0.5 + 1;
    }
    // :232-237 水尘族（33=缺省水型 dustWater :419/52/266/98-105——1135 KrakenWave
    //  尾尘 33 批接入,单段源支全成员随支移植）：alpha=170 + velocity×0.5/Y++。
    //  NewDustPerfect 的 velocity 覆写消解速度面,alpha=170 在覆写面之外=入池即
    //  (255−170)/255 亮度（Projectile.cs:37554 KrakenWave 调用不传 Alpha）。
    if (!ps && (type === 33 || type === 52 || type === 266 || (type >= 98 && type <= 105))) {
      d.alpha = 170;
      d.vx *= 0.5;
      d.vy = d.vy * 0.5 + 1;   // 原文 velocity *= 0.5f 矢量(含 Y)后 Y++——红队R2-P1-1:曾漏 vy×0.5,净初速分布偏散至多 1px/t
    }
    // ★气泡族补（2026-09-13 用户实报"呼吸泡下坠"）：:246-253 34=Bubbles/35/152——
    //  velocity×0.1 + vy=−0.5 上浮钉值;34 生成点离水（WetCollision(pos.y−8,4,4) 失败）
    //  即 active=false（原版同句）。旧版整支缺 → 池内落 default 吃 +0.1 重力 = 泡下坠
    if (!ps && (type === 34 || type === 35 || type === 152)) {
      d.vx *= 0.1;
      d.vy = -0.5;
      if (type === 34 && this.wetProbe && !this.wetProbe(d.x, d.y - 8, 4, 4)) d.active = false;
    }
    // :52-63 NewDustPerfect：dust.position = Position；Velocity.HasValue →
    // dust.velocity = Velocity.Value（仅这两项覆写——scale 等照走 NewDust 结果）。
    //  ps 分支已零掷直写同值,此处对 ps 为恒真冗余（无掷,仅语义对齐）
    if (opts?.perfect) {
      d.x = x;
      d.y = y;
      d.vx = speedX;
      d.vy = speedY;
    }
    // ★PrettySparkle 专用档（orchestraFx 编排星芒迁移,update 早退=APF+TTL）：
    //  scaleX/scaleY=双轴 Scale、ttl=TimeToLive 定值、rotation 由调用侧赋
    if (opts?.prettySparkle) {
      d.prettySparkle = true;
      d.ttl = 60;
      d.scaleX = d.scale;
      d.scaleY = d.scale;
    }
    return d;
  }

  /** CloneDust（:260-288）：NewDust 复入池后逐字段覆写复原（spawn 的抖动/烟雾
   *  特例全部被覆盖）。dustIndex==maxDustToDraw 自身返回（:267-270）在池模型下
   *  等价于"源尘失活/池满返回 null"。注意 noLightEmittance 不复制（原版字段表
   *  :273-286 无此项——NewDust 重置为 false） */
  clone(rf: VDust): VDust | null {
    if (!rf.active) return rf;
    const c = this.spawn(rf.x, rf.y, 5, 5, rf.type, rf.vx, rf.vy, rf.alpha, rf.color, 1);
    if (!c) return null;
    c.x = rf.x; c.y = rf.y;                    // :273 position
    c.vx = rf.vx; c.vy = rf.vy;                // :274 velocity
    c.fadeIn = rf.fadeIn;                      // :275
    c.noGravity = rf.noGravity;                // :276
    c.scale = rf.scale;                        // :277
    c.rotation = rf.rotation;                  // :278
    c.noLight = rf.noLight;                    // :279
    c.active = rf.active;                      // :280
    c.type = rf.type;                          // :281
    c.color = rf.color;                        // :282
    c.alpha = rf.alpha;                        // :283
    c.fx = rf.fx; c.fy = rf.fy;                // :284 frame（原样复制，非重掷）
    c.followPlayer = rf.followPlayer;          // :286 customData=Player
    c.followOnce = rf.followOnce;
    c.followEnt = rf.followEnt;
    c.attractTo = rf.attractTo;
    // ★双轴通道随源尘复制（原版 CloneDust 只复制 Dust.cs 字段表 :273-286——
    //  scale 为单标量;本仓扩展字段缺省 undefined 不入面,双轴源尘克隆保各向异性）
    c.scaleX = rf.scaleX;
    c.scaleY = rf.scaleY;
    c.modType = rf.modType;   // ★D12 余债:mod 载体随源尘克隆(重写型克隆保持渲染键)
    return c;
  }

  /** UpdateDust（:423-2450，消费型精植）。playerDelta = 主角本 tick 位移
   *  （oldPosition 差——customData=Player 跟随用）。
   *  lightAt = Lighting.GetColor(tx,ty) 采样器（43 型照度门 :1475-1484；缺省全亮）；
   *  solidBoxAt = Collision.SolidCollision 盒探针（76/278=10×10、329=4×4；缺省恒假）；
   *  player = 主角探针（230 型钻头尘吸向玩家中心 :655-663 / 76 型雪尘随玩家下坠
   *  :1814-1822 读 Main.player[myPlayer] 速度；缺省 = 两效应关闭） */
  update(screenX: number, screenY: number, screenW: number, screenH: number,
    playerDx = 0, playerDy = 0,
    lightAt: ((tx: number, ty: number) => [number, number, number]) | null = null,
    solidBoxAt: ((px: number, py: number, w: number, h: number) => boolean) | null = null,
    player: { cx: number; cy: number; vy: number } | null = null,
    wetBoxAt: ((px: number, py: number, w: number, h: number) => boolean) | null = null): void {
    // ★气泡族(2026-09-13)：探针存字段——spawn() 侧 :246-253 生成时湿判复用
    //  （上帧探针,液体面 1 帧滞后无感;探针未注入=null=跳过生成时杀）
    this.wetProbe = wetBoxAt;
    // ★BJ466 视口暂存（spawn 头裁剪 :97-101 消费——本帧视口对后续 spawn 可见,
    //  一帧滞后备案见字段注）
    this.viewX = screenX;
    this.viewY = screenY;
    this.viewW = screenW;
    this.viewH = screenH;
    this.viewValid = true;
    this.lights.length = 0;
    let activeN = 0;
    for (const d of this.pool) {
      if (!d.active) continue;
      activeN++;
      // ★双轴通道拍首快照（本拍 scale 合成效应向两轴同步的基准——见 ★双轴同步）
      const scale0 = d.scale;
      // ★PrettySparkle 专用档（:53-59 Update=APF+Scale 二次链+TTL，2026-09-03 迁移批）：
      //  跳过 Dust 全部链 A/B/老化/重力——orchestraFx PrettySparkle 站迁移载体
      //  （ princess/stardust/拍击石 kind1 双轴星芒,drawSparkleArms 承载）。
      //  ★2026-09-03 修：补 AccelerationPerFrame 积分（ABasicParticle.Update :40-41
      //  Velocity += APF → LocalPosition += Velocity—— princess/stardust 的 ax/ay
      //  减速弧此前未生效 = 缺陷,原版加速链在位）+ Scale 二次链（:47-49）+ psAge。
      if (d.prettySparkle) {
        if (d.ax !== undefined) d.vx += d.ax;
        if (d.ay !== undefined) d.vy += d.ay;
        d.x += d.vx; d.y += d.vy;
        if (d.scvx !== undefined || d.scvy !== undefined || d.scax !== undefined || d.scay !== undefined) {
          d.scvx = (d.scvx ?? 0) + (d.scax ?? 0);
          d.scvy = (d.scvy ?? 0) + (d.scay ?? 0);
          d.scaleX = (d.scaleX ?? d.scale) + d.scvx;
          d.scaleY = (d.scaleY ?? d.scale) + d.scvy;
        }
        d.psAge = (d.psAge ?? 0) + 1;
        if (d.ttl !== undefined && --d.ttl <= 0) d.active = false;
        continue;
      }
      // :445 scale>10 兜底
      if (d.scale > 10) { d.active = false; continue; }
      // :469 position += velocity
      // ★APF 通道（原版 ABasicParticle.Update :57-67 先加速后位移同序）：
      if (d.ax !== undefined) d.vx += d.ax;
      if (d.ay !== undefined) d.vy += d.ay;
      d.x += d.vx; d.y += d.vy;
      // :598-602 鸟粪尘（329,独立 if 段,在 883 链之前）：Collision.SolidCollision
      // (position,4,4) 命中实心 → scale ×0.8（4×4 盒跨至多 2×2 格,四角判定）
      if (d.type === 329 && solidBoxAt
        && solidBoxAt(d.x, d.y, 4, 4)) {              // :598-602 SolidCollision(position,4,4)
        d.scale *= 0.8;
      }
      // :571-581 宝石火花族（86-92/286）customData=Player/Projectile 跟随——
      // _Player 档 followPlayer、_Projectile 档 followEnt 闭包承载（★2026-09-28
      // 星云奥秘补式接入：618 弹尾 customData=父球（:35524-35527）+ 617 环尘
      // customData=本体（:35310/:35322/:35368-35377））。active 门 = 闭包内
      // dead 判（父弹死 → 零位移,同 `if (projectile.active)`）。
      if ((d.type >= 86 && d.type <= 92) || d.type === 286) {
        // ★interp 跟随量记录（渲染期相位退回消费,见字段注）
        if (d.followPlayer) { d.x += playerDx; d.y += playerDy; d.lastFollowX = playerDx; d.lastFollowY = playerDy; }
        else if (d.followEnt) { const q = d.followEnt(); d.x += q.dx; d.y += q.dy; d.lastFollowX = q.dx; d.lastFollowY = q.dy; }
        else { d.lastFollowX = 0; d.lastFollowY = 0; }
      } else {
        d.lastFollowX = 0; d.lastFollowY = 0;   // 非跟随档:归零（退回恒等）
      }
      // ---- 链 A 独占段（:883-1894 独占链：命中者跳过其余链接与 :1884 重力）----
      //  230/217/240 是独立段/无档型（非 883 链链接）：chainLink 不置位，重力门
      //  照常评估，:2136 vx×0.99 显式乘（链 A 命中型的 0.99 沿用既有近似不乘，
      //  见文件头结构澄清 ②）。
      let chainLink = false;
      switch (d.type) {
        case 230: { // :644-663 钻头坐骑尘（独立 if 段，非链 A 链接）
          const k = d.scale * 0.6;                        // :646（自增前取值）
          // :654 无 noLight 门恒发光——光源 = (scale·0.6)²×(0.5,0.9,1)
          this.lights.push({ x: d.x, y: d.y, r: k * k * 0.5, g: k * k * 0.9, b: k * k });
          d.scale += 0.02;                                // :653
          if (d.followPlayer && player) {                 // :655-663 customData=Player 吸引
            const rx = d.x - player.cx, ry = d.y - player.cy;
            const len = Math.hypot(rx, ry);
            if (len > 0) {                                // len==0 原版 0/0=NaN，防御跳过
              d.scale = Math.min(d.scale, len / 24 - 1);  // :661
              const pull = 100 / Math.max(50, len);       // :662
              d.vx -= (rx / len) * pull;
              d.vy -= (ry / len) * pull;
            }
          }
          d.vx *= 0.99;                                   // :2136-2139 兜底（230≠304 恒命中）
          break;
        }
        case 206: { // :808-818 脉冲矢尘（独立 if 段,非链 A 链接,不置 chainLink）：先自减再取 k——
          d.scale -= 0.1;                                // :809（+通用老化 −0.01 ≈ −0.11/拍,~9 拍灭）
          const k = d.scale * 0.4;                       // :811 num40（自减后取值）
          this.lights.push({ x: d.x, y: d.y, r: k * k * 0.1, g: k * k * 0.6, b: k * k });   // :813-817 无门恒发光
          break;
        }
        case 172: { // ★BJ310（2026-09-23）：:670-684 独立 if 段（非链 A 链接）——蓝光
          // (0, .25k, k),k=min(scale·0.5,1)。★【无 noLight 门】（对照 263/264/182 的
          // !noLight 门,原文直呼 Lighting.AddLight——猪鲨尾流尘自带 noLight 仍发光）。
          // 发射方=dukeDashDust 冲撞尾流 7/拍。chainLink 不置位 → 重力门照常
          // （尾流尘 noGravity 不加重力）;:2136 vx×0.99 按独立段惯例显式乘。
          const k18 = Math.min(d.scale * 0.5, 1);
          this.lights.push({ x: d.x, y: d.y, r: 0, g: k18 * 0.25, b: k18 });
          d.vx *= 0.99;
          break;
        }
        case 174: { // :873-882（独立 if 段,非链 A 链接）：专属 scale−0.01（+通用 −0.01=−0.02/t）
          d.scale -= 0.01;
          if (!d.noLight && !d.noLightEmittance) {        // :880-881 光 min(scale,0.6)×(1,0.4,0)
            const k = Math.min(d.scale, 0.6);
            this.lights.push({ x: d.x, y: d.y, r: k, g: k * 0.4, b: 0 });
          }
          break;
        }
        case 264:   // :625-641：光 + 一次性主角跟随
          if (!d.noLight) {
            this.lights.push({ x: d.x, y: d.y, r: (d.color?.r ?? 0) / 255 * d.scale * 0.4,
              g: (d.color?.g ?? 0) / 255 * d.scale * 0.4, b: (d.color?.b ?? 0) / 255 * d.scale * 0.4 });
          }
          if (d.followPlayer) {
            d.x += playerDx; d.y += playerDy;
            if (d.followOnce) d.followPlayer = false;
          }
          break;
        case 182:   // :685-705：rotation+1 + 光(1,0.2,0.1)×min(scale·0.25,1) + 一次性跟随
          d.rotation += 1;
          if (!d.noLight) {
            const k = Math.min(d.scale * 0.25, 1);
            this.lights.push({ x: d.x, y: d.y, r: k, g: k * 0.2, b: k * 0.1 });
          }
          if (d.followPlayer) {
            d.x += playerDx; d.y += playerDy;
            if (d.followOnce) d.followPlayer = false;
          }
          break;
        case 261:   // :705-727：光(0.4,0.6,0.7)×min(scale·0.3,1) + 阻尼×2 档 + 持续跟随
          if (!d.noLight && !d.noLightEmittance) {
            const k = Math.min(d.scale * 0.3, 1);
            this.lights.push({ x: d.x, y: d.y, r: k * 0.4, g: k * 0.6, b: k * 0.7 });
          }
          if (d.noGravity) {
            d.vx *= 0.93; d.vy *= 0.93;
            if (d.fadeIn === 0) d.scale += 0.0025;
          }
          d.vx *= 0.97; d.vy *= 0.99;
          d.scale -= 0.0025;
          if (d.followPlayer) { d.x += playerDx; d.y += playerDy; }
          break;
        case 6: case 229: case 228: case 279:
        case 75: case 135: case 169: case 127: case 187: case 242: case 29:
        case 158: case 302: case 307: case 310:
        case 293: case 294: case 295: case 296: case 297: case 298:
        case 59: case 60: case 61: case 62: case 63: case 64: case 65: { // :885 烟雾族链接（★R2 扩成员）
          if (!d.noGravity) d.vy += 0.05;                 // :892-895（非通用 0.1）
          // :896-917（229/228/279 三型 customData 档）——_Player 已由 followPlayer
          // 承载；_NPC 档由 followEnt 闭包承载（终清波批接入月总水蛭 d229 环）。
          // _Vector2 吸向档仍无消费方，维持登记不建。
          if ((d.type === 229 || d.type === 228 || d.type === 279)) {
            if (d.followPlayer) { d.x += playerDx; d.y += playerDy; }
            else if (d.followEnt) {
              const q = d.followEnt();
              d.x += q.dx; d.y += q.dy;
            } else if (d.attractTo) {
              // :906-912 customData=Vector2 吸向——速度方向折向锚点、模长保持
              const axv = d.attractTo.x - d.x, ayv = d.attractTo.y - d.y;
              const len = Math.hypot(axv, ayv);
              const ux2 = len !== 0 ? axv / len : 0, uy2 = len !== 0 ? ayv / len : 0;
              const mag = Math.hypot(d.vx, d.vy);
              d.vx = (d.vx * 4 + ux2 * mag) / 5;
              d.vy = (d.vy * 4 + uy2 * mag) / 5;
            }
          }
          if (!d.noLight && !d.noLightEmittance) {        // :918-1097 光链 20 档(★R3 F1 表驱动全量,火把色源 TorchID.cs:137-150)
            const k = Math.min(d.scale * 1.4, 1);          // :919 num60
            const L = SMOKE_LIGHT[d.type];
            if (L) {
              this.lights.push({ x: d.x, y: d.y, r: k * L[0], g: k * L[1], b: k * L[2] });
            } else {                                       // 6/302 尾档（:1083-1090 灰橙,仅这两型正确）
              const k2 = Math.min(d.scale * 1.4, 0.6);
              this.lights.push({ x: d.x, y: d.y, r: k2, g: k2 * 0.65, b: k2 * 0.4 });
            }
          }
          chainLink = true;
          break;
        }
        case 31: case 46: case 188: {  // :1336-1394（链 A 326-328/14/16/31/46/124/186/188/303
          d.vy *= 0.98; d.vx *= 0.98;                     //  组链接;★BJ437 补成员 46/188——
          if (d.type === 31 && d.noGravity) {            //  中毒泡/苍蝇尘发射方接入（成组同享
            d.vx *= 1.02; d.vy *= 1.02;                   //  ×0.98 阻尼+跳通用重力）;31 专属 noGravity
            d.scale += 0.02;                              //  臂(:1367-1377,1.02/+0.02/+4)按型守卫——
            d.alpha += 4;                                 //  46 号 noGravity 尘不得误吃 31 号生长臂
            if (d.alpha > 255) { d.scale = 0.0001; d.alpha = 255; }
          }
          chainLink = true;
          break;
        }
        case 55: {  // :1759-1799（链 A 55/56/73/74 组链接）
          d.vx *= 0.98; d.vy *= 0.98;                     // :1761
          if (!d.noLightEmittance) {                      // :1762
            const k = Math.min(d.scale * 0.8, 1);         // :1764-1771 白 黄 光
            this.lights.push({ x: d.x, y: d.y, r: k, g: k, b: k * 0.6 });
          }
          chainLink = true;
          break;
        }
        case 76: {  // :1810-1828 雪尘专档（链 A 单型链接）
          d.scale += 0.009;                               // :1813
          const pvy = player?.vy ?? 0;                    // :1814 Main.player[myPlayer].velocity.Y
          if (pvy > 0 && d.fadeIn === 0 && d.vy < pvy) {  // :1815-1818
            d.vy += (pvy - d.vy) * 0.04;                  // Lerp(vy, y, 0.04)
          }
          if (!d.noLight && pvy > 0) d.y += pvy * 0.2;    // :1819-1822
          if (d.fadeIn === 0 && solidBoxAt                // :1823-1827 Collision.SolidCollision
            && solidBoxAt(d.x - 5, d.y - 5, 10, 10)) {    //  (position−(5,5),10,10) 1:1
            d.scale *= 0.9;
            d.vx *= 0.25; d.vy *= 0.25;
          }
          // :1812 Main.snowDust++ 是全屏雪密度计数（无本仓等价物）——备案不建
          chainLink = true;
          break;
        }
        case 217:  // 1456 Dust.cs 全文无 217 分支——无链 A 专档，仅兜底
          d.vx *= 0.99;                                   // :2136-2139
          break;   // chainLink 不置位 → 重力门照常（翅膀 26 尘 noGravity 不加重力）
        case 240:  // :592-599 独立段仅 customData=Projectile 跟随（本仓消费方
          d.vx *= 0.99;   // 均不设——备案）；其余同 217 走兜底
          break;
        case 43: {  // :1472-1518 金尘：旋转 + 照度门 + 两段缩放 + 持续玩家跟随
          d.rotation += 0.1 * d.scale;                    // :1474
          const lc = lightAt
            ? lightAt(Math.floor(d.x / 16), Math.floor(d.y / 16)) : [255, 255, 255];
          const c = d.color ?? BLACK;                     // :1479-1481（default(Color)=黑）
          const lr = (lc[0] / 270) * d.scale * 1.07 * (c.r / 255);
          const lg = (lc[1] / 270) * d.scale * 1.07 * (c.g / 255);
          const lb = (lc[2] / 270) * d.scale * 1.07 * (c.b / 255);
          if (d.alpha < 255) {                            // :1485-1493 生长档
            d.scale += 0.09;
            if (d.scale >= 1) { d.scale = 1; d.alpha = 255; }
          } else {                                        // :1494-1504 双段收缩
            if (d.scale < 0.8) d.scale -= 0.01;
            if (d.scale < 0.5) d.scale -= 0.01;
          }
          if (lr < 0.05 && lg < 0.05 && lb < 0.05) {      // :1505-1508 照度门
            d.active = false;
          } else if (!d.noLightEmittance) {               // :1509-1512
            this.lights.push({ x: d.x, y: d.y, r: lr, g: lg, b: lb });
          }
          if (d.followPlayer) { d.x += playerDx; d.y += playerDy; }   // :1513-1517
          chainLink = true;
          break;
        }
        case 15: case 57: case 58: case 274: case 292: {  // :1519-1551 Recall/魔光族
          d.vy *= 0.98; d.vx *= 0.98;                     // :1521-1522
          if (!d.noLightEmittance) {                      // :1523-1550
            let k = d.type === 15 ? d.scale : d.scale * 0.8;   // :1525-1529
            if (d.noLight) { d.vx *= 0.95; d.vy *= 0.95; }     // :1530-1533
            if (k > 1) k = 1;                             // :1534-1537
            if (d.type === 15) {                          // :1538-1541
              this.lights.push({ x: d.x, y: d.y, r: k * 0.45, g: k * 0.55, b: k });
            } else if (d.type === 57) {                   // :1542-1545
              this.lights.push({ x: d.x, y: d.y, r: k * 0.95, g: k * 0.95, b: k * 0.45 });
            } else if (d.type === 58) {                   // :1546-1549
              this.lights.push({ x: d.x, y: d.y, r: k, g: k * 0.55, b: k * 0.75 });
            }
            // 274/292：仅阻尼无光（原版同链无 AddLight 分支）
          }
          chainLink = true;
          break;
        }
        // EoC/肉山尘族（链 A 独占链接 :1564-1635，家族补全 2026-09-01）：每支仅
        // AddLight、无速度/缩放改动；命中即 chainLink=true——链尾重力链接 :1889
        // else-if 对它们不评估。★原版这些分支【无】noLight/noLightEmittance 门
        // （不同于同链 43 :1509 / 15 族 :1523），零门移植；★链 ② 兜底 vx×0.99
        // (:2141-2144) 原版对全体尘评估，但本引擎沿用既有近似"链 A 命中者不乘"
        // （文件头结构澄清 ②）。本仓现 0 发射方——预防性补全防将来启用静默缺光。
        //   111 ×0.125 / 313 ×0.25 / 其余 ×0.1，钳 1；
        //   311/312 走 torch 重载 AddLight(i,j,TorchID,amount)=TorchColor(id)×amount
        //   （TorchID.cs Initialize：16=Desert (1.4,0.85,0.55)、9=Ice (0.75,0.85,1.4)，恒色）
        case 110: case 111: case 112: case 113: case 114:
        case 311: case 312: case 313: {
          const k = Math.min(d.scale * (d.type === 111 ? 0.125 : d.type === 313 ? 0.25 : 0.1), 1);
          let lr = k, lg = k, lb = k;
          if (d.type === 110) { lr = k * 0.2; lg = k; lb = k * 0.5; }               // :1571
          else if (d.type === 111) { lr = k * 0.2; lg = k * 0.7; lb = k; }         // :1580
          else if (d.type === 112) { lr = k * 0.8; lg = k * 0.2; lb = k * 0.8; }   // :1589
          else if (d.type === 113) { lr = k * 0.2; lg = k * 0.3; lb = k * 1.3; }   // :1598
          else if (d.type === 114) { lr = k * 1.2; lg = k * 0.5; lb = k * 0.4; }   // :1607
          else if (d.type === 311) { lr = k * 1.4; lg = k * 0.85; lb = k * 0.55; } // :1616 torch16 Desert
          else if (d.type === 312) { lr = k * 0.75; lg = k * 0.85; lb = k * 1.4; } // :1625 torch9 Ice
          else { lr = k; lg = k * 0.8; lb = k * 0.6; }                             // 313 :1634
          this.lights.push({ x: d.x, y: d.y, r: lr, g: lg, b: lb });
          chainLink = true;
          break;
        }
        case 267: {  // :1660-1686 帝皇蝶尘：方向旋转 + 阻尼 + 生长 + 自色光
          d.rotation += d.vx < 0 ? -1 : 1;                // :1662-1669
          d.vy *= 0.98; d.vx *= 0.98;                     // :1670-1671
          d.scale += 0.02;                                // :1672
          const k = Math.min(d.scale * 0.8, 1);           // :1673-1677
          if (d.noLight) d.noLight = false;               // :1678-1681 自愈
          if (!d.noLight && !d.noLightEmittance) {        // :1682-1685
            const c = d.color ?? BLACK;
            this.lights.push({ x: d.x, y: d.y, r: k * c.r / 255, g: k * c.g / 255, b: k * c.b / 255 });
          }
          chainLink = true;
          break;
        }
        case 278:   // :2240-2269 妖精尘：链 A 无专档，仅命中 :2136-2139 兜底
          d.vx *= 0.99;
          chainLink = true;
          break;
        case 34: case 35: case 152: {
          // ★气泡族补（2026-09-13，Dust.cs:2023-2040 1:1）：离水（WetCollision
          //  (pos.y−8,4,4) 失败）→ scale=0 灭;湿内 alpha+rand(2)/>255 灭、
          //  vy=−0.5 恒上浮、34 scale+0.005 渐大。chainLink 置位跳过通用重力
          //  ——原版 +0.1 先行即被 :2029 vy=−0.5 逐拍覆写,净 −0.5 与跳过等价。
          //  （用户实报"入水呼吸泡往下掉"根因=本档整缺,泡吃 +0.1 重力下坠）
          if (wetBoxAt && !wetBoxAt(d.x, d.y - 8, 4, 4)) {
            d.scale = 0;
          } else {
            d.alpha += (Math.random() * 2) | 0;   // Main.rand.Next(2)
            if (d.alpha > 255) d.scale = 0;
            d.vy = -0.5;
            if (d.type === 34) d.scale += 0.005;
          }
          chainLink = true;
          break;
        }
        case 27: case 45: {  // :1717-1775（链 A 27/45 组链接;★BJ437 补——咒火/恶魔镰刀
          if (d.type === 27 && d.fadeIn >= 100) {         //  屑/暗影焰镖发射方,旧落链 B 兜底
            if (d.scale >= 1.5) d.scale -= 0.01;          //  ×0.92+scale−0.04=双偏差）。fadeIn≥100
            else d.scale -= 0.05;                         //  档(:1719-1734)本仓产尘恒不入,门随源码保留
            if (d.scale <= 0.5) d.scale -= 0.05;
            if (d.scale <= 0.25) d.scale -= 0.05;
          }
          d.vx *= 0.94; d.vy *= 0.94;                     // :1735
          d.scale += 0.002;                               // :1736
          let num97 = d.scale;
          if (d.noLight) {                                // :1737-1755 noLight 档（跟随主角;
            num97 *= 0.1;                                 //  湿档 ×0.5 无主角湿输入通道——备案）
            d.scale -= 0.06;
            if (d.scale < 1) d.scale -= 0.06;
            d.x += playerDx; d.y += playerDy;
          }
          if (num97 > 1) num97 = 1;                       // :1756-1758
          this.lights.push({ x: d.x, y: d.y,              // :1759 紫光 (0.6,0.2,1)×min(scale,1)
            r: num97 * 0.6, g: num97 * 0.2, b: num97 });
          chainLink = true;
          break;
        }
        case 306: {  // :1093-1105 帕鲁尘（Chillet 族坐骑尘）——★BJ707-A 补（BJ704-G18
          //  doSpawnDust 落 306 发射方时整支缺 → 落 default 吃链 B 兜底,净 −0.05/t
          //  vs 原版 −0.09/t（本支 −0.04 + 公共老化 −0.01 + 链 B 兜底 −0.04）≈2× 寿命
          if (!d.noGravity) d.vy += 0.05;                // :1095-1098 自管重力 0.05（替通用 +0.1）
          d.scale -= 0.04;                               // :1099
          if (solidBoxAt && d.fadeIn === 0               // :1100-1104 实心格内收缩（SolidCollision(pos−(5,5),10,10)）
            && solidBoxAt(d.x - 5, d.y - 5, 10, 10)) {
            d.scale *= 0.9;
            d.vx *= 0.25; d.vy *= 0.25;
          }
          chainLink = true;
          break;
        }
        default:
          break;
      }
      // :1884-1894 重力（链 A 命中者由其链接自管速度，跳过；链头特型不在消费集）
      if (!chainLink && !d.noGravity && d.type !== 41 && d.type !== 44 && d.type !== 309) {
        d.vy += 0.1;
      }
      // :1895-1897 血尘 5/273 悬浮档（noGravity 时额外收缩——本引擎产 5 号恒重力档
      // （NewDust noGravity 恒 false），门随源码保留防未来悬浮产尘漏缩）
      if ((d.type === 5 || d.type === 273) && d.noGravity) d.scale -= 0.04;
      // :1904-1946 水尘族独立段（308/33/52/266/98-105/123/288——重力链接之后、
      // 通用旋转之前;1135 KrakenWave 尾尘 33 批接入,其余成员随单段源支同移植）：
      // 静止档（vx==0:SolidCollision(position,2,2) 入实心 scale=0 + rotation+0.5 +
      // scale−0.01）+ 湿碰档（WetCollision(position,4,4):alpha+20/scale−0.1;
      // wetBoxAt 探针缺省 null=不湿——Game 注入位待批,登记）+ 通用 alpha+2/
      // scale−0.005/alpha>255 归零 + vy>4 钳 + noGravity 档（rotation±0.2/scale
      // +0.03/vx×1.05/vy+0.15）
      if (d.type === 33 || d.type === 52 || d.type === 266 || (d.type >= 98 && d.type <= 105)
        || d.type === 123 || d.type === 288 || d.type === 308) {
        if (d.vx === 0) {                                     // :1906-1913
          if (solidBoxAt && solidBoxAt(d.x, d.y, 2, 2)) d.scale = 0;
          d.rotation += 0.5;
          d.scale -= 0.01;
        }
        if (wetBoxAt && wetBoxAt(d.x, d.y, 4, 4)) {           // :1914-1917
          d.alpha += 20;
          d.scale -= 0.1;
        }
        d.alpha += 2;                                         // :1918
        d.scale -= 0.005;                                     // :1919
        if (d.alpha > 255) d.scale = 0;                       // :1920-1922
        if (d.vy > 4) d.vy = 4;                               // :1923-1924
        if (d.noGravity) {                                    // :1925-1946
          if (d.vx < 0) d.rotation -= 0.2; else d.rotation += 0.2;
          d.scale += 0.03;
          d.vx *= 1.05;
          d.vy += 0.15;
        }
      }
      // :2144-2146 通用旋转
      if (d.type !== 79 && d.type !== 268 && d.type !== 304) {
        d.rotation += d.vx * 0.5;
      }
      // :2148-2171 fadeIn 生长目标语义
      if (d.fadeIn > 0 && d.fadeIn < 100) {
        if (d.type === 46 || d.type === 213 || d.type === 260) d.scale += 0.1;
        else if (d.type === 235) d.scale += 0.007;
        else d.scale += 0.03;
        if (d.scale > d.fadeIn) d.fadeIn = 0;
      } else if (d.type !== 304) {
        if (d.type === 213 || d.type === 260) d.scale -= 0.2;
        else d.scale -= 0.01;
      }
      // ---- 链 B 独占段（1457 :2202-2413，公共老化之后）----
      switch (d.type) {
        // R4-30：226/272/331 三档补（Dust.cs:2317-2400;1456 无 331,226/272 曾落
        // default 无光无阻尼——226 被 LightningBoltProj 真实消费）。customData
        // 两档：Player 跟随 BJ372 已建（226 由充能爆破炮蓄力尘真实消费——
        // P.cs:67492 customData=player,:2337-2341 position += 主角本拍位移,
        // followPlayer 通道承载）;Color 自色光仍无消费方=不建模（备案）
        case 226: {  // :2317-2350：固定光 (0.2,0.7,1.0)×min(scale,1) + 0.93 阻尼
          const k = Math.min(d.scale, 1);
          if (!d.noLight) {
            this.lights.push({ x: d.x, y: d.y, r: 0.2 * k, g: 0.7 * k, b: 1.0 * k });
          }
          if (d.noGravity) {
            d.vx *= 0.93; d.vy *= 0.93;
            if (d.fadeIn === 0) d.scale += 0.0025;
          }
          d.vx *= 0.97; d.vy *= 0.99;                    // :2339 velocity *= (0.97,0.99)
          if (d.followPlayer) { d.x += playerDx; d.y += playerDy; }   // :2337-2341 customData=Player（持续跟随,原版不清）
          d.scale -= 0.01;
          break;
        }
        case 331: {  // :2352-2371（1457 新）：自色光 color RGB×min(scale,1) 受 noLightEmittance 门
          const k = Math.min(d.scale, 1);
          if (d.noGravity) {                             // 1457 语义:noGravity 才 0.93 阻尼（无 else 档）
            d.vx *= 0.93; d.vy *= 0.93;
            if (d.fadeIn === 0) d.scale += 0.0025;
          }
          d.vx *= 0.97; d.vy *= 0.99;
          if (!d.noLightEmittance) {
            const c = d.color ?? BLACK;
            this.lights.push({ x: d.x, y: d.y, r: c.r / 255 * k, g: c.g / 255 * k, b: c.b / 255 * k });
          }
          d.scale -= 0.01;
          break;
        }
        case 272: {  // :2373-2400：固定光 (0.5,0.2,0.8)×min(scale,1) + 0.93 阻尼
          const k = Math.min(d.scale, 1);
          if (!d.noLight) {
            this.lights.push({ x: d.x, y: d.y, r: 0.5 * k, g: 0.2 * k, b: 0.8 * k });
          }
          if (d.noGravity) {
            d.vx *= 0.93; d.vy *= 0.93;
            if (d.fadeIn === 0) d.scale += 0.0025;
          }
          d.vx *= 0.97; d.vy *= 0.99;
          d.scale -= 0.01;
          break;
        }
        case 278: {  // :2240-2269：自色光 + 双档阻尼 + 入实心格收缩
          const k = Math.min(d.scale, 1);                 // :2242-2246
          if (!d.noLight && !d.noLightEmittance) {        // :2247-2250
            const c = d.color ?? BLACK;
            this.lights.push({ x: d.x, y: d.y, r: c.r / 255 * k, g: c.g / 255 * k, b: c.b / 255 * k });
          }
          if (d.noGravity) {                              // :2251-2258
            d.vx *= 0.93; d.vy *= 0.93;
            if (d.fadeIn === 0) d.scale += 0.0025;
          } else {                                        // :2259-2263
            d.vx *= 0.95; d.vy *= 0.95;
            d.scale -= 0.0025;
          }
          if (solidBoxAt && d.fadeIn === 0 && !d.noGravity    // :2264-2268 SolidCollision
            && solidBoxAt(d.x - 5, d.y - 5, 10, 10)) {        //  (position−(5,5),10,10) 1:1
            d.scale *= 0.9;
            d.vx *= 0.25; d.vy *= 0.25;
          }
          break;
        }
        // :2407-2413 链 B 兜底（★2026-09-07 水花尺寸定谳,用户实报"水花非常大"——
        //  原文此兜底=【全 type 缺省档】(链 B 各 case 未命中的尘都评估:type!=304 &&
        //  noGravity → velocity×0.92 + fadeIn==0 → scale−0.04)。旧实现做成 15 型
        //  白名单 case,水花尘 33/52/98-105/123/288/308 不在册=漏 −0.04/×0.92——
        //  水滴原版净变化 +0.025−0.01−0.04=−0.025/t 约 52t 缩没,白名单版反向
        //  +0.005/t 生长 78t=用户观感"水花非常大"）
        // ★F2（2026-09-08 红队清偿）：130-134 支（:2202-2243，1457 行号；旧版仅
        //  alphaOf 有同型档、update 侧整支缺 → 落 default 吃 ×0.92/−0.04=原文明文
        //  拒绝的兜底）。光 = min(scale,1)×逐型恒量，【无 noLight 门】（与 278/219-223
        //  的 !noLight 门不同，原文直呼 Lighting.AddLight）；134 无光档。
        //  阻尼三臂互斥：noGravity→×0.93(+fadeIn==0 scale+0.0025)/else if 131→
        //  ×0.98+Y−0.1+scale+0.0025/else→×0.95+scale−0.0025。当前仓内 0 发射方
        //  （潜伏债防静默缺光,家族补全同批纪律）。
        case 130: case 131: case 132: case 133: case 134: {
          const k = Math.min(d.scale, 1);
          if (d.type === 130) this.lights.push({ x: d.x, y: d.y, r: k, g: 0.5 * k, b: 0.4 * k });
          else if (d.type === 131) this.lights.push({ x: d.x, y: d.y, r: 0.4 * k, g: k, b: 0.6 * k });
          else if (d.type === 132) this.lights.push({ x: d.x, y: d.y, r: 0.3 * k, g: 0.5 * k, b: k });
          else if (d.type === 133) this.lights.push({ x: d.x, y: d.y, r: 0.9 * k, g: 0.9 * k, b: 0.3 * k });
          if (d.noGravity) {
            d.vx *= 0.93; d.vy *= 0.93;
            if (d.fadeIn === 0) d.scale += 0.0025;
          } else if (d.type === 131) {
            d.vx *= 0.98; d.vy = d.vy * 0.98 - 0.1;
            d.scale += 0.0025;
          } else {
            d.vx *= 0.95; d.vy *= 0.95;
            d.scale -= 0.0025;
          }
          break;
        }
        // ★F2：219-223 支（:2275-2315）。光 = !noLight 门 × min(scale,1)×逐型恒量
        //  （223 无光档）；阻尼 = noGravity→×0.93(+fadeIn==0 scale+0.0025)【后】
        //  无条件 ×(0.97,0.99) + scale−0.0025（两段叠乘,与 226/272 同构但 scale 档
        //  是 −0.0025 非 −0.01）。customData=Player 跟随档（:2308-2313）本仓无该
        //  字段=不建模（备案,同 226/272）。当前仓内 0 发射方。
        case 219: case 220: case 221: case 222: case 223: {
          const k = Math.min(d.scale, 1);
          if (!d.noLight) {
            if (d.type === 219) this.lights.push({ x: d.x, y: d.y, r: k, g: 0.5 * k, b: 0.4 * k });
            else if (d.type === 220) this.lights.push({ x: d.x, y: d.y, r: 0.4 * k, g: k, b: 0.6 * k });
            else if (d.type === 221) this.lights.push({ x: d.x, y: d.y, r: 0.3 * k, g: 0.5 * k, b: k });
            else if (d.type === 222) this.lights.push({ x: d.x, y: d.y, r: 0.9 * k, g: 0.9 * k, b: 0.3 * k });
          }
          if (d.noGravity) {
            d.vx *= 0.93; d.vy *= 0.93;
            if (d.fadeIn === 0) d.scale += 0.0025;
          }
          d.vx *= 0.97; d.vy *= 0.99;                    // :2306 无门叠乘
          d.scale -= 0.0025;
          break;
        }
        default:
          if (d.type !== 304 && d.noGravity) {
            d.vx *= 0.92; d.vy *= 0.92;
            if (d.fadeIn === 0) d.scale -= 0.04;
          }
          break;
      }
      // ★双轴同步（2026-09-03 VDust 双轴基建）：带 scaleX/scaleY 的尘（PrettySparkle
      //  Vector2 Scale 通道,接口注）——本拍全部老化效应对 scale 的合成比
      //  r = scale/scale0 逐轴同乘：链 A 专档/fadeIn 生长/链 B/实心收缩的加减乘各档
      //  以同一相对量作用两轴,X:Y 各向异性比全链守恒（加性档在原版单标量语义下本就
      //  双轴等量,比值式是其在双轴域的守恒推广）。scale0<=0 的退化拍比值无定义→跳过
      //  （登记：通道产尘方禁 scale=0 起步,缺省 spawn 抖动 ±0.2 恒 >0 不触）。
      if ((d.scaleX !== undefined || d.scaleY !== undefined) && scale0 > 0 && d.scale !== scale0) {
        const r = d.scale / scale0;
        if (d.scaleX !== undefined) d.scaleX *= r;
        if (d.scaleY !== undefined) d.scaleY *= r;
      }
      // :2387 屏底清除
      if (d.y > screenY + screenH) { d.active = false; continue; }
      // :2432-2436 缩没清除（dCount 五档密度缩放不建模——池小永不触发）
      if (d.scale < 0.1) d.active = false;
    }
    this.activeCount = activeN;   // 密度门真负载（update 全池遍历顺带重数,见 spawn 门注）
    // ★BJ466 UpdateDust 尾 dCount 阶梯（Dust.cs:2470-2494）：num119 对 maxDustToDraw
    //  分位定 dCount——阈值比较原版为 (double) 强升（0.9 等 double 字面量,f64 乘积
    //  5400.000000000001 等）,JS 同构 f64 直接写 `n > MAX_DUST_TO_DRAW * 0.9`;
    //  赋值为 0.9f..0.5f float 字面量（fround）。
    //  ★vanilla 运行时备案（BJ466 复核定谳,源码锚 Dust.cs:429/:2470 全词检索）：原版
    //  尾段读 num119=num 而 num（:429 初始化 0）全程无写点 → 恒走 else dCount=0f
    //  ——原版【运行时】margin 恒 400,本阶梯与 :2420-2459 缩没梯同为死支（循环内
    //  dCount 为整数值恒≠0.5..0.9;dCount 全树无外部写点）。本仓按 BJ460③ 钉案将
    //  阶梯按设计意图激活（activeN 驱动）：activeN≤3000 域 margin 恒 400=与原版
    //  运行时无差;>3000 高压域为登记分歧（该域密度门本就以 activeCount 近似管辖,
    //  见 spawn 门注）。
    if (activeN > MAX_DUST_TO_DRAW * 0.9) this.dCount = Math.fround(0.9);
    else if (activeN > MAX_DUST_TO_DRAW * 0.8) this.dCount = Math.fround(0.8);
    else if (activeN > MAX_DUST_TO_DRAW * 0.7) this.dCount = Math.fround(0.7);
    else if (activeN > MAX_DUST_TO_DRAW * 0.6) this.dCount = Math.fround(0.6);
    else if (activeN > MAX_DUST_TO_DRAW * 0.5) this.dCount = Math.fround(0.5);
    else this.dCount = 0;
  }

  /** 活动尘迭代（绘制用；fullbright=true 只取亮色族 {6,15,59-64}，false 取其余） */
  *each(fullbright: boolean): Generator<VDust> {
    for (const d of this.pool) {
      if (!d.active) continue;
      if (fullbrightnessWanted(fullbright, d)) yield d;
    }
  }

  /** GetAlpha（Dust.cs:2497-2798 [1457] 消费型精植,1458 同文）：返回乘数 [rgb, alpha]（0-1）。
   *  ★2026-09-03 逐通道乘数 rgbv（183/258 红主档实装）：GetAlpha 返回非白 RGB 的
   *  A=0 加性尘,标量 rgb 表达不了三通道比——rgbv?: [r,g,b]（0-1,XNA Color 字面
   *  /255）优先于 rgb 消费（Renderer A=0 加性位逐通道乘,id.data 本就逐通道）;
   *  未设 rgbv 的既有标量档消费面零改动。曾评 union {rgb:number|[r,g,b]} 整型
   *  方案弃:wing-visuals.test `.rgb` toBeCloseTo 断言类型泄漏 → tsc 红(域外文件)。
   *  ★BJ342 ND5：flicker = FlickerClock（mouseTextColor 190↔255 脉冲钟）——唯 157
   *  消费（Dust.cs:2699-2721 Main.cs:18399-18406）;tests/无钟走 ?? 255 兜底 */
  static alphaOf(d: VDust, flicker?: { mouseTextColor: number }): { rgb: number; a: number; rgbv?: [number, number, number] } {
    const num = (255 - d.alpha) / 255;
    switch (d.type) {
      case 261: return { rgb: 230 / 255, a: 115 / 255 };                       // :2521
      case 6: return { rgb: 1, a: 25 / 255 };                                   // :2583
      // ---- ★R2 补档(:2656 与 6 同句 A=25 族;光色随环境——rgb=1 为既有 6 号近似口径):
      // 174/75/135/169/242/20/21/231/130-134/158/293-298/307/310 + 127/187(:2684 同句)
      //  （★BJ342 ND7 勘误:旧注括号「292 火柱/291 尾迹/103·172·278 尾尘曾落 default
      //  压暗档」半误——292/172/278 系真缺档(292=BJ342 ND5 补、172=BJ310、278=在案);
      //  291 尾迹/103 原版 Dust.GetAlpha【本就无分支】=default 尾即原版相,非缺档勿补）
      //  ★2026-09-02 评估定谳（红队 finding）：A=25 族「光色随环境」已由管线交付，
      //  rgb=1 是精确项非缺光——lit 尘画在 worldLayer 内、compositeLight 之前
      //  （Renderer.render :3530 → 合成 :3590），合成 out.rgb=世界.rgb×光.rgb（GL/2D
      //  双路径均线性乘）对本尘加性项逐像素施加 texP×light(pixel) ≡ 原版
      //  texP×GetAlpha(Lighting.GetColor(tile))（Main.DrawDust :39660 取光→GetAlpha
      //  :2656 同一光照域，本仓 lightmap 与 lightAt 同源 LightingEngine.r/g/b 数组；
      //  擦除项线性透传同式）——且逐像素比原版逐 tile 更细。此处再乘 lightAt 会与
      //  合成双重乘光（暗处尘两次变黑），禁改。type 6 虽在 :2656 句内，DrawDust
      //  :39662 对 6/15/59-64 强制 White 覆写（全亮桶），不经此路径。
      case 174: case 242: case 20: case 21: case 231: case 75: case 135: case 169:
      case 158: case 307: case 310: case 127: case 187:
      case 130: case 131: case 132: case 133: case 134:
      case 293: case 294: case 295: case 296: case 297: case 298:
        return { rgb: 1, a: 25 / 255 };
      case 170: return { rgb: 200 / 255, a: 100 / 255 };                        // :2606-2608
      // ★BJ310（2026-09-23）猪鲨尾流 d172：GetAlpha 恒 (250,250,250,150)（:2623-2626,
      //  常量不读光照——旧落 default 压暗档 rgb(255−α)/255≈0.61;头注 R2 补档清单曾
      //  虚标 172 入 A=25 族,实际 switch 缺 case）。发射方=dukeDashDust 冲撞尾流
      //  （bossAI_duke_moonlord,7/拍 α100）+ 出生环(暂 spawnParticles 近似,登记债)。
      //  lit pass 逐像素乘光的近似与 170/175/180 常量族同口径备案。
      case 172: return { rgb: 250 / 255, a: 150 / 255 };                        // :2623-2626
      case 185: return { rgb: 200 / 255, a: 125 / 255 };                        // :2635-2637(蓝通道 255 标量近似备案)
      case 182: case 206: return { rgb: 1, a: 0 };   // :2517/:2595 同句 (255,255,255,0)——A=0 预乘加法白光,恒亮不读尘 α
      case 267: return { rgb: 1, a: 0 };                                        // :2743-2746 Color(color.RGB,0)——色走 color pass
      // ★RB-彩虹魔杖（2026-09-20，用户实报"白大圆内红衣人物像"定谳）：66 RainbowTorch
      //  = GetAlpha :2767-2769 `return new Color(newColor.R, newColor.G, newColor.B, 0)`
      //  ——A=0 纯加算习语（XNA α=0：dst 因子=1−texA×0=1 零擦除、tex.rgb×光色 纯加）。
      //  光色 RGB 由管线交付（lit 尘画在合成前→lightmap 逐像素乘,同 R2 光色随环境口径）。
      //  旧缺档落 default {rgb:num,a:num}（α=100→≈0.61）：擦 61% 背景后暗加=亮头团/
      //  光盘上的"暗十字星簇"（Dust.png 66 号帧=白十字星,scale2.5）——用户把十字星簇
      //  读成"人物像"。消费面=弹 79 彩虹魔杖弹每拍 1×d66（1458 Projectile.cs:44390-44406
      //  NewDust α100/Disco 色/2.5f）+ orchestraFx RainbowRodHit 两掷。
      case 66: return { rgb: 1, a: 0 };                                         // :2767-2769 Color(newColor.RGB,0)——本体光色加算,disco 色走 color pass
      case 278: return { rgb: 1, a: 25 / 255 };                                 // :2632-2637 newColor×color, A=25
      case 58: return { rgb: 1, a: 0 };                                         // :2721-2724 Color(255,255,255,0)
      case 230: return { rgb: 1, a: 0 };   // :2616-2619 Color(255,255,255,0)——钻头尘本体透明，纯光源
      case 229: case 269: return { rgb: 1, a: 25 / 255 };   // :2687-2689（269=BJ342 ND5 补,与 229 同句;Lerp(lighting,White,0.6) 近似为全亮基底，备案）
      // ★F1（2026-09-08 红队清偿,用户可见伪影）：原文 (num+9)/10 【只乘 RGB】
      //  （Dust.cs:2757-2758；num=(255−alpha)/255 :2503）；alpha 通道走 GetAlpha 尾段
      //  `newColor.A − alpha`（:2786-2792），而 DrawDust :39664 传 Lighting 色其 A 恒
      //  255 → 逐字节 = 255−alpha ≡ 本仓 num。旧 `a:(num+9)/10` 把 erase 面顶到
      //  texA×0.9：tileShine 闪尘（spawn α=254,TileDrawing.cs:7657）每颗把世界层
      //  90% alpha 擦掉 = 矿石/宝箱贴图被亮斑掏底（同 2026-09-04 水花黑十字族）。
      //  修复后 α≈num=1/255 ≈ 纯加性 glint、rgb≈0.9×光。消费面：43 型恒走 Renderer
      //  A=0 直绘双 pass（drawVanillaDustPass ★F1 判据，不经烘焙对）。
      case 43: return { rgb: (num + 9) / 10, a: num };   // :2755-2758 + :2786-2792
      // ★BJ342 ND5：(num+3)/4 亮度比值档全族补齐（:2753-2755——58 早退支 :2747 在先、
      //  20/21 被 A=25 族先截,group 内两型为原版死位不录;15∈全亮桶仍经 alphaOf 取
      //  rgb 面,57 活发射方 WeaponProj:2336 等;27=永夜刃/DD2/咒火主力,rgb 暗约 33%
      //  正落 BJ313 观感域）。旧「15/57/274 走默认档」注作废——(num+3)/4 是对光色
      //  的 rgb 乘数,强制 White 只换光源不消去折减
      case 15: case 27: case 29: case 35: case 41: case 44: case 45:
      case 55: case 56: case 57: case 73: case 74: case 274:
        return { rgb: (num + 3) / 4, a: num };
      case 263: case 264: {                                                     // :2558-2562（263 同句 ND5 补）
        const c = d.color ?? { r: 0, g: 0, b: 0, a: 0 };
        return { rgb: 0.5, a: (clamp255(c.a / 8) / 255) * 0.5 };
      }
      case 86: case 87: case 88: case 89: case 90: case 91:
        if (!d.noLight) return { rgb: 1, a: 0 };                                // :2511
        return { rgb: num, a: num };
      // EoC/肉山尘族（GetAlpha :2583-2586，同族无 noLight 门）：本体色恒
      // (200,200,200,0)——A=0 本体不可见，纯光照尘（不在强制 White 全亮桶）。
      // 家族补全 2026-09-01，本仓现 0 发射方
      case 110: case 111: case 112: case 113: case 114:
      case 311: case 312: case 313:
        return { rgb: 200 / 255, a: 0 };
      // ---- ★2026-09-02 A=0 加性族完备批（GetAlpha :2497-2755 全量 A=0 档对账，
      //  消费走 Renderer A=0 'lighter' 加性通道；rgb=返回色 RGB/255）----
      case 204: return { rgb: 1, a: 0 };                                        // :2593-2595 (255,255,255,0)
      case 181: return { rgb: 200 / 255, a: 0 };                                // :2596-2598 (200,200,200,0)
      case 163: case 205: return { rgb: 250 / 255, a: 0 };                      // :2605-2607 (250,250,250,0)
      case 180: case 175: return { rgb: 200 / 255, a: 0 };                      // :2612-2618 (200,200,200,0)
      case 183: return { rgb: 0, a: 0, rgbv: [50 / 255, 0, 0] };                // :2619-2621 (50,0,0,0) 纯红加性——rgbv 逐通道实装(HealProj 305 尾迹×3/子步活发射方)
      case 160: case 162: case 164: case 173:                                   // :2627-2630 (250×scale,…,0)
        return { rgb: Math.min(1, (250 * d.scale) / 255), a: 0 };
      case 92: case 106: case 107: return { rgb: 1, a: 0 };                     // :2631-2633 (255,255,255,0)
      case 156: case 234: return { rgb: 1, a: 0 };                              // :2664-2666 与 230 同句 (255,255,255,0)
      case 68: case 70: return d.noGravity ? { rgb: 1, a: 0 } : { rgb: num, a: num };   // :2692-2695 noGravity 门
      case 254: case 255: return { rgb: 1, a: 0 };                              // :2516-2518 (255,255,255,0)
      case 235: return { rgb: 1, a: 0 };                                        // :2562-2564 (255,255,255,0)
      case 258: return { rgb: 0, a: 0, rgbv: [150 / 255, 50 / 255, 50 / 255] }; // :2519-2521 (150,50,50,0) 红主加性——rgbv 实装。★发射方已定谳（2026-09-03）：原版无字面 258，经【变量】生成，唯二发射面=熔岩苔藓族的破坏尘——①方块面 WorldGen.KillTile_MakeTileDust(:67217) 苔藓分支 :67609-67612（Main.tileMoss[type] 且 type==381 LavaMoss→258，TileID.cs:1199）尾段标准盒 NewDust(i*16,j*16,16,16,num)（:69699 缺省支，速 0/α0/scale1），尘量=KillTile_GetTileDustAmount(:67127) 缺省档 破坏 10/锤击 fail 3，调用环 KillTile :64223 / ReplaceTile :63084；②墙面 WorldGen.KillWall_MakeWallDust(:61844) wall==341 LavaMossBlockWall→258（:62314-62317，WallID.cs:751）尾段 NewDust(i*16,j*16,16,16,num)（:62654），量=KillWall :60886-60892 档 10/3。运行时特性行 Dust.cs:481-485（noGravity=true+scale+=0.015 渐大）。本仓两面均未按原版尘型接线（破块/破墙尘面=mapColor 粒子制，Game.breakTile :18180 族+KillWall 近似 :19365；苔族尘型 93-97/258/299/300/301/305/267 整族 dormant；发射体 v_381_lava_moss tiles.ts:201 / w341 tiles.ts:1356 已实装）——保持 dormant 保留通道，接线须整族一起（含 hitTiles 面同口径）
      case 262: case 286: case 138: case 325:                                   // :2565-2568 与 86-91 同句 !noLight 门
        if (!d.noLight) return { rgb: 1, a: 0 };
        return { rgb: num, a: num };
      case 64:                                                                  // :2576-2578 α==255&&noLight 门
        if (d.alpha === 255 && d.noLight) return { rgb: 1, a: 0 };
        return { rgb: num, a: num };
      // ---- ★BJ342 ND5（2026-09-25）GetAlpha 全表补缺（Dust.cs:2497-2798 [1457] 逐档
      //  录入,1458 同文;缺档尘落 default {num,num}=亮度/擦除双偏离）----
      case 323: return { rgb: 1, a: 1 };                                        // :2506 Color.White
      case 308: case 309:                                                       // :2508-2510 (225,200,250,190)
        return { rgb: 0, a: 190 / 255, rgbv: [225 / 255, 200 / 255, 250 / 255] };
      case 324:                                                                 // :2511-2512 同色×num（四通道）
        return { rgb: 0, a: (190 / 255) * num, rgbv: [(225 / 255) * num, (200 / 255) * num, (250 / 255) * num] };
      case 299: return { rgb: 0, a: 200 / 255, rgbv: [50 / 255, 1, 50 / 255] };       // :2513-2528 四色符文尘
      case 300: return { rgb: 0, a: 1, rgbv: [50 / 255, 200 / 255, 1] };
      case 301: return { rgb: 0, a: 200 / 255, rgbv: [1, 50 / 255, 125 / 255] };
      case 305: return { rgb: 0, a: 200 / 255, rgbv: [200 / 255, 50 / 255, 200 / 255] };
      case 304: return { rgb: 1, a: num };                                      // :2530 White×num
      case 306: {   // :2534-2536 this.color×num（四通道）
        // ★BJ707-A（2026-10-22 用户实报「疾旋鼬坐骑召唤/取消黑粒子」域修：rgbv/a 须
        //  归一 0-1（曾裸 0-255——dustPremulPair clamp(1) 后 a 顶满 255、rgbv 无人消费
        //  （Renderer 本体 pass 只吃标量 rgb=0）→ 黑色剪影尘。首活跃发射方=Mount
        //  doSpawnDust 62-65 支（BJ704-G18）+ dash6 滑行尾尘（本刀接入））
        const c = d.color ?? { r: 0, g: 0, b: 0, a: 0 };
        return { rgb: 0, a: (c.a / 255) * num, rgbv: [(c.r / 255) * num, (c.g / 255) * num, (c.b / 255) * num] };
      }
      case 292: return { rgb: 1, a: 1 };                                        // :2538-2539 Color.White
      case 259: return { rgb: 230 / 255, a: 230 / 255 };                        // :2542-2543 (230,230,230,230)（lunar 活发射方）
      case 213: case 260: {                                                     // :2570-2572 亮度=(int)(scale/2.5×255)
        const v = Math.trunc((d.scale / 2.5) * 255) & 255;   // (byte) 截断（原版无上钳,scale>2.5 回绕同相）
        return { rgb: v / 255, a: v / 255 };
      }
      case 197: return { rgb: 250 / 255, a: 150 / 255 };                        // :2579-2580 与 172 同档（Arrow.ts:3573 活发射方）
      case 159: return { rgb: 250 / 255, a: 50 / 255 };                         // :2599-2600 (250,250,250,50)
      case 157: {                                                               // :2699-2721 mouseTextColor 脉冲（活发射方=叶绿晶簇）
        // 原版 f32 算术：num7 = mtc/100f − 1.6f;rgb=(int)(255f×num7)+50 钳 255;
        // a=(int)(100f×num7)。★f32 阈值判例（BJ116-139 家族）——f64 直算在
        // mtc=190 拍 a=30 ≠ 原版 f32 (int)29.999995=29
        const n7 = Math.fround(Math.fround((flicker?.mouseTextColor ?? 255) / 100) - Math.fround(1.6));   // Main.cs:18399-18406 190↔255 步进 1
        const c157 = Math.min(255, Math.trunc(Math.fround(255 * n7)) + 50);
        return { rgb: c157 / 255, a: Math.trunc(Math.fround(100 * n7)) / 255 };
      }
      case 284: {   // :2724-2728 newColor×color 四通道,A=color.A（★BJ707-A 同族域修:归一 0-1;dormant 零发射方）
        const c = d.color ?? { r: 0, g: 0, b: 0, a: 0 };
        return { rgb: 0, a: c.a / 255, rgbv: [c.r / 255, c.g / 255, c.b / 255] };
      }
      // 270/271/219-223/226/272/228 = Lerp(light,White,x) 仿射光面 → rgb=1 全亮基底
      // 备案（同 229 口径,光色由管线逐像素交付;A 常量精确）。219/220 活发射方
      // （MinionProj:5304 弹 966/Dart:2345 弹 436）;226/272/228 活发射方。
      case 270: return { rgb: 1, a: 25 / 255 };                                 // :2648-2651 Lerp .5
      case 271: return { rgb: 1, a: 127 / 255 };                                // :2652-2655 Lerp .5 A=127
      case 219: case 220: case 221: case 222: case 223:
        return { rgb: 1, a: 25 / 255 };                                         // :2666-2670 Lerp .5
      case 226: case 272: case 228:
        return { rgb: 1, a: 25 / 255 };                                         // :2671-2680 Lerp .8
      case 279: {                                                               // :2681-2686 ×min(scale,1) 四通道
        const s = Math.min(d.scale, 1);   // Lerp .8 仿射光面失真备案（全光下精确）
        return { rgb: s, a: s };
      }
      // 327 星尘：夜相 = 光色+disco/rand 抬升后原样返回（:2730-2746,rgb=1 近似、
      // A=newColor.A=255）——disco 抬升面与 isDay 二相判别（昼相=default 尾）须
      // 发射方接线时一并建模（同 66 烘焙口径;dormant 仓内零发射方）
      case 327: return { rgb: 1, a: 1 };
      case 244: case 245: case 246: case 247: return { rgb: 1, a: 0 };          // :2763-2765 (255,255,255,0)
      case 71: return { rgb: 200 / 255, a: 0 };                                 // :2775-2777 (200,200,200,0)
      case 72: return { rgb: 200 / 255, a: 200 / 255 };                         // :2779-2781 (200,200,200,200)
      default:
        return { rgb: num, a: num };
    }
  }

  /** GetColor（:2773-2817 加性钳位）：second pass 色（尘自定义色与基色的叠加）。
   *  ★BJ707-A：baseRgbv（alphaOf 逐通道档,306 帕鲁尘首消费）——GetColor 的入参
   *  newColor=GetAlpha 产物,逐通道档须逐通道减（vanilla :2807-2810 逐通道
   *  color.ch−(255−newColor.ch)）;标量档缺省 undefined → 三通道同取 baseRgb 零回归。 */
  static colorPass(d: VDust, baseRgb: number, baseA: number,
    baseRgbv?: readonly [number, number, number]): DustColor | null {
    if (!d.color) return null;
    const br = baseRgbv ? baseRgbv[0] : baseRgb;
    const bg = baseRgbv ? baseRgbv[1] : baseRgb;
    const bb = baseRgbv ? baseRgbv[2] : baseRgb;
    return {
      r: clamp255(d.color.r - (255 - br * 255)) / 255,
      g: clamp255(d.color.g - (255 - bg * 255)) / 255,
      b: clamp255(d.color.b - (255 - bb * 255)) / 255,
      a: clamp255(d.color.a - (255 - baseA * 255)) / 255,
    };
  }
}

/** ★双轴通道读数（Renderer.drawVanillaDustPass 双臂消费位）：带 scaleX/scaleY
 *  的尘按 PrettySparkle 的 Vector2 Scale 逐轴取值（PrettySparkleParticle.cs:72-73），
 *  缺省逐轴回落单标量 scale（既有单标量尘渲染零改动）。dual = 是否入双臂绘制面。 */
export function dustAxisScale(
  d: Pick<VDust, 'scale' | 'scaleX' | 'scaleY'>,
): { sx: number; sy: number; dual: boolean } {
  const dual = d.scaleX !== undefined || d.scaleY !== undefined;
  return { sx: d.scaleX ?? d.scale, sy: d.scaleY ?? d.scale, dual };
}

function fullbrightnessWanted(wantFb: boolean, d: VDust): boolean {
  // 331 自发光族（DrawDust :39670 色不取光:白心 Color.White+GetAlpha(color) 贴片）→
  // 与 6/15/59-64 同入全亮桶（光照合成后绘制）
  // ★双轴通道（PrettySparkle 编排粒子族）：原版画在 ParticleSystem_World_OverPlayers
  // （光照合成之后的独立加色层,不受 tile 光照）→ 恒入全亮桶
  // ★BJ707-A：306 帕鲁尘（Chillet 族坐骑/冲刺尘）入全亮桶——GetAlpha :2534-2536
  //  `return this.color*num` 不读 newColor（光照入参整弃）=自色尘;落 lit 桶会被
  //  compositeLight 逐像素乘光=暗处双重压黑。首发射方=Mount doSpawnDust 62-65 支。
  // ★D12(2026-10-13):mod 尘 fullbright 声明(400+ 段;原版域先短路,零 mod 零开销)
  // ★D12 余债:mod 尘(modType 在册)=声明 fullbright 唯一权威——运动档重写后的
  //  d.type 原版桶位(6/15/59-64/331)不传染(mod 声明 lit 即 lit)
  const fb = d.modType !== undefined ? modDustFullbright(d.modType)
    : d.type === 6 || d.type === 15 || (d.type >= 59 && d.type <= 64) || d.type === 331
      || d.type === 306
      || d.scaleX !== undefined || d.scaleY !== undefined
      || (d.type >= 400 && modDustFullbright(d.type));
  return wantFb === fb;
}

/** 预乘 AlphaBlend 烘焙（纯函数;Renderer.drawVanillaDustPass 消费,
 *  tests/dust-premultiplied-blend.test.ts 数值验证）。
 *
 *  XNA SpriteBatch BlendState.AlphaBlend = 预乘混合（ColorSourceBlend=One、
 *  ColorDestinationBlend=InverseSourceAlpha,Main.cs:39503 spriteBatch.Begin）,
 *  贴图经 XNA 内容管线默认预乘（tex.rgb 已含 tex.a）——本仓 PNG 为直色解包,
 *  须先转预乘 texP.rgb = tex.rgb×tex.a。Draw 的 Color 入参 c（=GetAlpha/GetColor
 *  返回值）在 sprite shader 里逐通道调制:
 *    src.rgb = texP.rgb×c.rgb（不乘 c.a!——c.a 只进混合的 dst 因子）
 *    src.a   = tex.a×c.a
 *    final   = dst×(1−src.a) + src.rgb = dst×(1−texA×cA) + texP.rgb×cRGB
 *  canvas 两步精确等价（每尘 2 次 drawImage,零逐帧 getImageData）:
 *    ① 'destination-out' 画 erase 面（alpha=texA×cA,按贴图形状限域）→ dst×(1−texA×cA)
 *    ② 'lighter' 画 add 面（RGB=texP×cRGB、A=max(e,预乘rgb)≥e）→ α 项 +≥e 与
 *      rgb 项 +texP.rgb×cRGB 合成 out = dst×(1−e)+texP×cRGB（2026-09-04 起——旧
 *      A=255 档在半透 worldLayer 把天空挡死=水花黑十字,见循环内注;add 面按
 *      【直色】putImageData 回存,浏览器预乘换算在画布内完成）
 *  A=0 档（cA=0）自动退化为纯加法（erase 无操作）——与既有 A=0 'lighter' 通道同式。
 *
 *  入参 mR/mG/mB/mA 为字节化乘数（0-255,调用侧 Math.round(c×255)）:直色→预乘×Color
 *  单次量化（round(tex×texA×m/255²)）与 XNA shader 输出 8bit 同精度。
 *  返回两张 RGBA 面:add.A=max(e,预乘)（cA≈0 档二值 255/0）、erase.RGB 置 0（blend 不读）。
 *  ★add[] 字节为【直色】值（直色 rgb + α=存面α）——消费只经 putImageData/drawImage
 *  'lighter'（预乘换算在画布内完成）,勿按预乘直读。 */
export function dustPremulBake(
  tex: Uint8ClampedArray, mR: number, mG: number, mB: number, mA: number,
): { add: Uint8ClampedArray; erase: Uint8ClampedArray; gl: Uint8Array } {
  const add = new Uint8ClampedArray(tex.length);
  const erase = new Uint8ClampedArray(tex.length);
  // ★B2（2026-09-24）GL 合并面：rgb=预乘 add 面（=2D 'lighter' 实加值,putImageData
  //  直色→预乘换算 round(v×A/255) 的 JS 复刻——SkMulDiv255Round 同式,整数域无 tie）、
  //  a=erase e。执行器单 quad 输出 (rgb,e) 走 (ONE,1−SA) present:
  //  out.rgb = aR×mul + dst×(1−e×mul)（=2D erase+lighter 两步的 rgb 式）;α 项 =
  //  e×mul + dst.a×(1−e×mul),2D 为 m×mul + dst.a×(1−e×mul)——m>e 亮点位 α 偏差
  //  ≤(m−e)×mul（e<0.5 二值档 m=255 偏差全档;α 只影响天空透出,登记 census 有界）。
  const glb = new Uint8Array(tex.length);
  for (let i = 0; i < tex.length; i += 4) {
    const tA = tex[i + 3];
    const aR = (tex[i] * tA * mR) / 65025;
    const aG = (tex[i + 1] * tA * mG) / 65025;
    const aB = (tex[i + 2] * tA * mB) / 65025;
    add[i] = aR; add[i + 1] = aG; add[i + 2] = aB;
    // ★2026-09-03 黑方块定谳（用户实报"叶尘/尾焰尘变黑色实心方块"）：add.A 曾恒 255
    //  ——rgb=0 的 texel（帧透明角/叶尘黑晕圈）经 'lighter' 把 worldLayer 透明区
    //  抬成 a=255 黑 → 合成 source-over 替换天空=黑方块（十字帧角被抬=方块化）。
    // ★2026-09-04 水花黑十字定谳（用户实报"箭入水花边缘变黑+显大"）：黑方块修的
    //  "有 rgb 则 a=255" 二值残段在同管线下半透 dst 域炸出同族伪影——lit 尘画进
    //  半透明 worldLayer，'lighter' 把 src.a 全额累进 alpha；空中（dst≈透明）尘格
    //  α 被顶满 255 → compositeLight 后 source-over 挡死天空，只剩量化后微量 rgb
    //  =黑色实心十字（软边 texel rgb 最小 → 边缘最黑；同迹：探针 _splash-dust-
    //  verdict.mjs 水面十字水下蓝/水上黑）。XNA 语义 src.a = texA×cA = e（与 erase
    //  同源同值），'lighter' α 加算后 out.a = dst.a×(1−e)+e 恰合公式第二项。修=
    //  add.A 钉 e；putImageData 按【直色】解释回存，直色 rgb = 预乘×255/存面α。
    //  预乘面 rgb≤a 约束 vs XNA 允许 rgb>a（colorPass/331 亮色档）→ 存面 α 取
    //  max(e, aR,aG,aB)：rgb 恒逐字节精确可表；α 仅在 rgb>e 的亮点位过冲到
    //  rgb 本值（远小于旧 255;本体 num 档 rgb≤e 恒 α=e 精确——水花即此档）。
    //  e<0.5（含 cA=0 纯加性档）：直色面无法表达 rgb>0 且 a≈0，沿用二值 a=255/0
    //  （A=0 家族运行时走 A=0 'lighter' 直绘支不经烘焙对，此支仅数学契约保真）。
    const e = (tA * mA) / 255;
    if (e >= 0.5) {
      const m = Math.max(e, aR, aG, aB);
      add[i] = (aR * 255) / m;
      add[i + 1] = (aG * 255) / m;
      add[i + 2] = (aB * 255) / m;
      add[i + 3] = m;
    } else {
      add[i + 3] = add[i] + add[i + 1] + add[i + 2] > 0 ? 255 : 0;
    }
    erase[i + 3] = e;
    // GL 合并字节（此处 add[] 已是最终直色字节;预乘 = round(add×A/255)）
    glb[i] = Math.round((add[i] * add[i + 3]) / 255);
    glb[i + 1] = Math.round((add[i + 1] * add[i + 3]) / 255);
    glb[i + 2] = Math.round((add[i + 2] * add[i + 3]) / 255);
    glb[i + 3] = Math.round(e);   // erase 面经 putImageData 同款 round（Uint8 直存会截断）
  }
  return { add, erase, gl: glb };
}

// ===================== dustPmCache 分代 LRU（Renderer.dustPremulPair 消费）=====================
// 2026-09-02 红队 PLAUSIBLE finding 清偿：旧实现上限 2048 溢出【整体 clear】——连续
// 多色 colorPass/331 贴片键周期打穿时全缓存瞬间归零,每个幸存键都要重烘一次
// getImageData（GPU 回读）= 帧尖峰。改分代 LRU：命中重插入（Map 迭代序=插入序 →
// 重插入即访问序）+ 超限只逐出最旧 1/4 —— 工作集渐进换血,无整清突发。纯函数导出
// 供金标 tests/dust-premultiplied-blend.test.ts 直测策略本体。
export const DUST_PM_CACHE_MAX = 2048;

/** LRU touch：命中键移到插入序尾（热键不被分代淘汰窗口覆盖） */
export function dustPmCacheTouch<K, V>(map: Map<K, V>, key: K): void {
  const v = map.get(key);
  if (v !== undefined) {
    map.delete(key);
    map.set(key, v);
  }
}

/** 超 max 时淘汰最旧 1/4（当前规模的 1/4;≤max 零操作）。最旧 = Map 迭代序头部 */
export function dustPmCacheEvict<K, V>(map: Map<K, V>, max: number = DUST_PM_CACHE_MAX): void {
  if (map.size <= max) return;
  let n = map.size >> 2;
  for (const k of map.keys()) {
    map.delete(k);
    if (--n <= 0) break;
  }
}

// ===================== ★dustrb 二次机会代际 LRU（?dustrb=1 灰度） ======================
// 2026-09-28 尘 premul 链性能刀（海盗入侵 trace 立项）：旧命中重插式 touch
// （delete+set）在尘量大时是纯开销——trace 实测 dustPmCacheTouch self 1198.5ms/
// 39.9s = 主线程 2.91%（每命中 2 次 Map 重哈希 ≈29.5ns/op@2048,反推 ≈4 千万次/
// trace ≈1.7 万次/帧）,而溢出逐出在该场景几乎不触发（dustPremulBake self 0.9ms=
// miss 稀有,工作集 ≈107-150 键 « 2048 上限——LRU 记账无逐出可服务）。改时钟
// 二次机会（second-chance FIFO）：命中=单属性写 `entry.gen = 1`（实测 1.3ns,
// 22.7×）,零 Map 结构操作;溢出时从插入序头扫,gen=1 降 0 保留一轮、gen=0 逐出
// ——热键仍不被分代窗口淘汰（原金标不变式保持）。像素语义：烘焙对 (img,fx,fy,
// mR..mA) 纯确定,逐出只致同字节重烘 = 输出逐位无关。两圈上限：第一圈全降级、
// 第二圈必逐满 target（有界,逐出仅 miss 时触发）。
/** 命中代际标记（消费侧 `hit.gen = 1` 内联;此导出仅为策略文档锚,勿在热路径调用） */
export const DUST_PM_GEN_HOT = 1;

/** 二次机会逐出（dustrb 开时替代 dustPmCacheEvict;≤max 零操作）。
 *  第一圈把 gen=1 降 0（保留）并逐出沿途 gen 空/0 键至 target;若一圈扫尽仍缺
 *  （全热已全降级）,第二圈必然从最旧起逐满 target。 */
export function dustPmCacheEvictGen<K, V extends { gen?: number }>(map: Map<K, V>, max: number = DUST_PM_CACHE_MAX): void {
  if (map.size <= max) return;
  const target = map.size >> 2;
  let evicted = 0;
  for (let lap = 0; lap < 2 && evicted < target; lap++) {
    for (const [k, v] of map) {
      if (evicted >= target) return;
      if (v.gen) { v.gen = 0; continue; }   // 二次机会:本轮降级保留
      map.delete(k);
      evicted++;
    }
  }
}
