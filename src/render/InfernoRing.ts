/**
 * ★BJ579 狱火药水火圈视觉面（用户实报「狱火药水喝了后没有火圈」）。
 *
 * 定谳（原版 1457 亲读）：
 * - 药水 ItemID.InfernoPotion = 2348（Item.cs:23616-23626：buffType=116、
 *   buffTime=14400、useStyle=9、useTurn=true、consumable、14×24、value 1000、
 *   rare 1、SoundID.Item3）。
 * - buff BuffID.Inferno = 116（官方中文「狱火」）。效果面（Player.cs:10302-10374
 *   UpdateBuffs buffType[j]==116 支）：inferno=true + AddLight(0.65,0.4,0.1) +
 *   200px 光环烧敌（OnFire3=323 120t + 每 60t 直伤 20,killCredit=2348）——本仓
 *   效果面已 1:1 在 Game.ts 狱火块（★F1 门禁串对齐注）,本文件只补视觉面。
 * - 视觉面 = Main.DrawInfernoRings（Main.cs:65248-65297）：对每个
 *   `active && !outOfRange && player.inferno && !dead` 玩家绘制三层
 *   TextureAssets.FlameRing（Images/FlameRing,400×1200=400×400 三帧竖排）旋转火环,
 *   在 DrawDust/前景水/DrawCachedProjs(OverWiresUI) 之后、DrawPaladinsShield 之前
 *   （Main.cs:63264）,AlphaBlend 主批次=不吃 tile 光照 → 本仓全亮域
 *   （compositeLight 后,flushTrailShade 与 BJ553 接口层之间=世界批次尾部等价位）。
 *
 * 推进时机（Main.cs:65262-65285 内联在 DrawInfernoRings,门
 * FocusHelper.AllowPlayerToEmitEffects = !WorldUpdateStepper.DrawnThisUpdate）：
 * XNA draw:Update 1:1 同拍 @60fps → 语义 = 每 60t tick 推进一次 → 本仓挂
 * fixedUpdate（v9.12 逻辑恒 60Hz 与渲染解耦,渲染侧纯消费零漂移）。
 * 屏外（outOfRange）不推进是 XNA 绘制剔除副产品,非设计语义（update 侧效果照跑）；
 * 本仓恒推进,登记偏差=屏外玩家火圈相位不停摆（相位无观察面）。
 * flameRingScale/flameRingRot 原版无重置（ResetEffects 零消费）→ buff 消失后
 * 相位残留,重新喝药续相（照抄）。Player.flameRingFrame/flameRingAlpha
 * （Player.cs:935/:937）原版零消费死字段,不抄。
 *
 * 混合语义（BJ556 判例推广）：XNA SpriteBatch AlphaBlend = (One, InvSrcAlpha)
 * 预乘语义 → tint Color(num5,num5,num5,num5/2) 的 final =
 * tex.rgb×num5 + dst×(1−tex.a×num5/2)（RGB 不被 α 双乘）。FlameRing.png 像素
 * 定谳：α 严格二值 {0,255}、a=0 处 rgb 恒零（无纯加色像素）→ 主体域 a=1。
 * canvas source-over 单笔 globalAlpha=num5/2 会把 RGB 贡献砍成 tex.rgb×num5²/2
 * （BJ556 同病）→ 两遍拆解精确等价：
 *   pass1 source-over ga=num5/2        （削底 dst×(1−num5/2) + 半 RGB）
 *   pass2 'lighter'  ga=1−num5/2       （RGB 补足 tex.rgb×num5×(1−num5/2)）
 * 合计 = tex.rgb×num5 + dst×(1−num5/2) 逐像素精确（RGB 灰度乘走离屏染色帧：
 * multiply 灰度 + destination-in 保形）。ga clamp [0,1]：num5<0 越界域
 * （|num4−0.9|×10>1 的层,XNA Color(float) 负分量截断 0=无贡献无削底）自洽。
 * 采样：原版 spriteBatch 默认 Linear（BJ65:1.4.5.7=FNA LinearClamp）→
 * imageSmoothingEnabled=true（区别于像素精灵域）。
 */

/** 贴图 = Images/FlameRing（AssetInitializer.cs:542 Images/FlameRing,400×1200）。 */
export const FLAME_RING_TEX = 'sprites/vanilla/FlameRing.png';
/** 帧边长/帧数（Main.cs:65294 source Rectangle(0, 400*j, 400, 400)）。 */
export const FLAME_RING_FRAME = 400;
export const FLAME_RING_FRAMES = 3;
/** scale 推进率（Main.cs:65263 flameRingScale += 0.004f）。 */
export const FLAME_RING_SCALE_RATE = 0.004;
/** scale 重置下限（:65271 <1f 消费,≥1f 重置 0.8f——呼吸周期 50t）。 */
export const FLAME_RING_SCALE_LO = 0.8;
/** rot 推进率（:65276 flameRingRot += 0.05f,wrap ±2π :65278-65285）。 */
export const FLAME_RING_ROT_RATE = 0.05;
/** 层间距/亮带中心（:65288-65292 num2=0.1f num3=0.9f,原版局部号）。 */
export const FLAME_RING_LAYER_STEP = 0.1;
export const FLAME_RING_BRIGHT_BAND = 0.9;

/** 玩家火圈状态面（原版 Player.cs:931/:933 字段;本仓挂 entities/Player.ts）。 */
export interface FlameRingState {
  flameRingRot: number;
  flameRingScale: number;
}

/**
 * 火圈推进（Main.cs:65262-65285 逐式;fixedUpdate 每 60t 调一次）。
 * scale 重置（原版在 draw 消费点 ≥1f→0.8f）随推进落位：本仓渲染帧率可变
 * （v9.12 锁帧档/跟满档）,重置若留渲染侧=呼吸周期随帧率漂移——原版 draw:Update
 * 1:1@60 无此自由度,重置属状态面（判例=状态面单次推进/渲染纯读）。重置后
 * flameRingDrawScale(0.8)=0.8 与原版 num=0.8 全等（含首帧初值 1→1.004→0.8）。
 */
export function advanceFlameRing(p: FlameRingState): void {
  p.flameRingScale += FLAME_RING_SCALE_RATE;
  if (p.flameRingScale >= 1) p.flameRingScale = FLAME_RING_SCALE_LO;
  p.flameRingRot += FLAME_RING_ROT_RATE;
  if (p.flameRingRot > Math.PI * 2) p.flameRingRot -= Math.PI * 2;
  if (p.flameRingRot < Math.PI * -2) p.flameRingRot += Math.PI * 2;
}

/** 绘制消费的 scale（Main.cs:65266-65273：<1f 用之,否则重置 0.8f 并取 0.8f;
 *  推进侧已保 <1,此处照抄原版 if/else 字面形态=双保险防外部态直写）。 */
export function flameRingDrawScale(scale: number): number {
  if (scale < 1) return scale;
  return FLAME_RING_SCALE_LO;
}

/** 第 j 层缩放（:65288-65292 num4 = num + 0.1f*j;num4 > 1f 严格大于才 −0.2f——
 *  num4==1.0 不回卷,num=0.8 相位 j=2 层 num4=1.0 → 亮度 0 隐没）。 */
export function flameRingLayerScale(num: number, j: number): number {
  let num4 = num + FLAME_RING_LAYER_STEP * j;
  if (num4 > 1) num4 -= FLAME_RING_LAYER_STEP * 2;
  return num4;
}

/** 层亮度（:65293 num5 = Lerp(0.8f, 0f, |num4−0.9f|*10f) —— 环带扫过 0.9 时最亮,
 *  越界域可为负=XNA Color(float) 截断 0（消费面 ga clamp 兜底）。 */
export function flameRingLayerBright(num4: number): number {
  return 0.8 + (0 - 0.8) * (Math.abs(num4 - FLAME_RING_BRIGHT_BAND) * 10);
}

/** 两遍拆解 α 面（BJ556 判例推广,见头注混合语义）。XNA tintA=(byte)(num5/2*255)
 *  截断 → 本仓浮点域 ga=base/topup,±1/255 量化差登记。 */
export function flameRingPassAlphas(num5: number): { base: number; topup: number } {
  const a = num5 / 2;
  return { base: clamp01(a), topup: clamp01(1 - a) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---- 贴图懒加载（loadExtraSprite 判例:负缓存 TTL 自愈,失败 10s 后允许重试——
//      冷缓存窗口一次失败=整会话缺贴图的前科不重犯）----
let flameRingImg: CanvasImageSource | null = null;
let flameRingFailAt = 0;
const FLAME_RING_FAIL_TTL_MS = 10_000;

/** FlameRing 贴图取用（未就绪/失败窗=null=整 pass 跳笔,推进在 fixedUpdate 照跑）。 */
export function ensureFlameRingImage(): CanvasImageSource | null {
  if (flameRingImg) return flameRingImg;
  if (typeof Image === 'undefined') return null;   // node 单测无 DOM
  if (flameRingFailAt && Date.now() - flameRingFailAt < FLAME_RING_FAIL_TTL_MS) return null;
  const im = new Image();
  im.onload = () => { flameRingImg = im; };
  im.onerror = () => { flameRingFailAt = Date.now(); };
  im.src = FLAME_RING_TEX;
  return null;
}

/** 火圈玩家渲染入参（Renderer 收集侧;hasInferno=buffs.has(BuffType.Inferno)）。 */
export interface FlameRingPlayer extends FlameRingState {
  cx: number;
  cy: number;
  dead: boolean;
  hasInferno: boolean;
}

/** 染色帧单例（400×400;node 单测无 DOM → null=跳笔守卫,与 tintedTex 同守卫）。 */
let tintCanvas: HTMLCanvasElement | null = null;
let tintCtx: CanvasRenderingContext2D | null = null;

/** 离屏染色帧：rgb=tex.rgb×num5（multiply 灰度）+ a=帧 α（destination-in 保形）。
 *  XNA tint byte = (byte)(v*255) 截断（Color(float) 语义,负值 clamp 0）。 */
function tintedFrame(
  img: CanvasImageSource, j: number, num5: number, w: number, h: number,
): HTMLCanvasElement | null {
  const tctx = tintCtx;
  if (!tctx) return null;
  const g = Math.max(0, Math.min(255, Math.floor(num5 * 255)));
  tctx.globalCompositeOperation = 'source-over';
  tctx.clearRect(0, 0, w, h);
  tctx.drawImage(img, 0, j * h, w, h, 0, 0, w, h);
  tctx.globalCompositeOperation = 'multiply';
  tctx.fillStyle = `rgb(${g},${g},${g})`;
  tctx.fillRect(0, 0, w, h);
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(img, 0, j * h, w, h, 0, 0, w, h);
  tctx.globalCompositeOperation = 'source-over';
  return tintCanvas;
}

/**
 * DrawInfernoRings 1:1（Main.cs:65248-65297）。调用位=全亮域世界批次尾部
 * （flushTrailShade 后、BJ553 接口层前=原版 Main.cs:63264 层序等价）。
 * img 未就绪（懒加载中/node 无 DOM）=整 pass 跳笔（推进在 fixedUpdate 照跑,
 * 相位不错拍——原版 AssetRequestMode.ImmediateLoad 同步加载无此态,登记）。
 * 屏外剔除（原版 outOfRange）未移植：400×400 屏外 drawImage 成本可忽略,
 * 少一处偏差源,登记。
 */
/** 染色帧烘焙器签名（node 单测注入 stub=tintedFrame 依赖 DOM 的解耦缝）。 */
export type FlameRingFrameBaker = (
  img: CanvasImageSource, j: number, num5: number, w: number, h: number,
) => CanvasImageSource | null;

export function drawInfernoRings(
  ctx: CanvasRenderingContext2D,
  players: readonly FlameRingPlayer[],
  img: CanvasImageSource | null,
  camX: number, camY: number, z: number, viewW: number, viewH: number,
  frameBaker: FlameRingFrameBaker = tintedFrame,
  /** ★gladd 面⑫-c-inferno（2026-10-28,task#22）:GL 发射钩（缺省 undefined=2D 原路
   *  零变化）。签名=(M=层变换快照, frame=烘焙帧, half, base, topup)→ok。双拍语义
   *  同 2D:pass1 SO α=base(削底+半RGB)+pass2 additive α=topup(RGB 补足)——
   *  ⑪ ㊵ 判例族。 */
  emit?: (M: DOMMatrix, frame: CanvasImageSource, half: number, base: number, topup: number) => boolean,
): void {
  if (!img) return;
  if (frameBaker === tintedFrame && !tintCanvas) {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;   // node 单测无 DOM
    tintCanvas = doc.createElement('canvas');
    tintCanvas.width = FLAME_RING_FRAME;
    tintCanvas.height = FLAME_RING_FRAME;
    tintCtx = tintCanvas.getContext('2d');
    if (!tintCtx) { tintCanvas = null; return; }
  }
  ctx.save();
  // 相机变换（flushNpcWhiteLift 同款 round 吸附;BJ371 判例=亚像素区域炸帧）
  ctx.translate(Math.round(viewW / 2), Math.round(viewH / 2));
  ctx.scale(z, z);
  ctx.translate(-Math.round(camX * z) / z, -Math.round(camY * z) / z);
  ctx.imageSmoothingEnabled = true;   // BJ65:1.4.5.7=FNA LinearClamp（spriteBatch 默认）
  for (const p of players) {
    // 门（Main.cs:65252-65256 active/outOfRange/inferno/dead;本仓 outOfRange 未移植）
    if (p.dead || !p.hasInferno) continue;
    const num = flameRingDrawScale(p.flameRingScale);
    for (let j = 0; j < FLAME_RING_FRAMES; j++) {
      const num4 = flameRingLayerScale(num, j);
      const num5 = flameRingLayerBright(num4);
      // XNA tint byte=(byte)(num5×255) 截断（Color(float) 语义,负值 clamp 0）——
      // byte 0 → Color(0,0,0,0)=无贡献无削底（XNA 照提交的零 tint 笔=无操作等价;
      // 原版 num4=1.0 域 num5 浮点 ±1e-16 同落此档）→ 显式跳笔,笔数/像素双稳定。
      if (Math.floor(num5 * 255) <= 0) continue;
      const frame = frameBaker(img, j, num5, FLAME_RING_FRAME, FLAME_RING_FRAME);
      if (!frame) continue;
      const { base, topup } = flameRingPassAlphas(num5);
      ctx.save();
      // :65294 逐参：pos=Center−screenPosition(=相机变换)、rot+π/3*j、
      // origin(200,200)、scale=num4、source(0,400j,400,400)、Color(n,n,n,n/2)
      ctx.translate(p.cx, p.cy);
      ctx.rotate(p.flameRingRot + Math.PI / 3 * j);
      const s = num4;
      ctx.scale(s, s);
      const half = FLAME_RING_FRAME / 2;
      // ★gladd 面⑫-c-inferno sink:M=层变换快照(同式复刻读),双拍单发射;
      //  帧画布=tintedFrame 单画布逐层重烘→texRefresh 逐层重传(⑦ 模式)
      if (emit) {
        const M = ctx.getTransform();
        if (!emit(M, frame, half, base, topup)) { ctx.restore(); return; }
        ctx.restore();
        continue;
      }
      // pass1 source-over：InverseSourceAlpha 削底 dst×(1−num5/2) + 半 RGB
      ctx.globalCompositeOperation = 'source-over';
      if (base > 0) {
        ctx.globalAlpha = base;
        ctx.drawImage(frame, -half, -half);
      }
      // pass2 'lighter'：SrcBlend=One RGB 补足（BJ556 两遍拆解推广,头注混合语义）
      if (topup > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = topup;
        ctx.drawImage(frame, -half, -half);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}
