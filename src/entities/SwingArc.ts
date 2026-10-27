// 真刃系旋斩弧家族 1:1（AI_190_NightsEdge Projectile.cs:42734-42999 [1457] + 各 Draw 方法）：
//   972 永夜刃（273 锚弧 + 飞斩变体）/982 圣剑（368）/983 真断钢（674）/
//   997 无头骑士剑（1826）/984 泰拉刃（757，原 TerraArc 并入本表）。
//   AI：t++；num=t/ai1；rotation=π×ai0×num + vel角(0|π) + ai0×π；
//   Center=MountedCenter−vel（vel=(dir,0)）；scale=(num6+num×num5)×ai2；
//   t≥ai1 Kill。984 首帧 Item60×0.65；按型号尘块（278/107 火花近似粒子）。
//   绘制（DrawProj_NightsEdge Main.cs:27901 / Excalibur :27958 / TheHorsemansBlade
//   :27997 / TrueExcalibur :28095 / TerraBlade2 :28192 [1457]；1458 同域零漂移
//   2026-09-19 亲读对拍）：贴图 Projectile_972/973 系【全白】170×680 四帧弧——
//   全部颜色/光照/渐隐都在绘制期染色：XNA 预乘 AlphaBlend 下 Color×float 四通道
//   同乘 ⇒ 等价式 = tint RGB 乘贴图（scratch multiply+destination-in）+ color.A
//   链乘为 globalAlpha。五层骨架：深色底×张开角 −π/4×ai0×(1−num) → 白衍生层
//   ×0.15（A×(1−fromValue)：亮处隐没）→ 内芯 → 主亮色 → 帧3 白芯（972 单层
//   0.3×n3×(1−fv×0.7)，其余三层组 0.6/0.5/0.4）。光照因子 fromValue = 光照色
//   RMS/√3 → Remap(0.2,1,0,1)（984 变体 0.5+fv×0.5）。渐隐包络 n3 =
//   Remap(num,0,.6,0,1)×Remap(num,.6,1,1,0)。★2026-09-19 用户实报「白月牙直出、
//   未染色无光效」定谳 = 旧 layer()/tneLayer() rgb 形参死参从未消费——本批按
//   反编译逐式重建层表引擎（arcLayerList/tneGhostLayers + drawArcLayers）。
//   刀尖星尘闪光 = DrawPrettyStarSparkle 原语（:27925/:27951-27954/:28033-28036/
//   :28130/:28224-28227，经 Renderer.prettyStarSparkle——参数表见下方 SWING_SPARKLE）。
//   997 命中召南瓜弹 321 已实装（Projectile.cs:13728-13732 → Player.HorsemansBlade_
//   SpawnPumpkin :42444-42462）——SwingArc 命中处生成，弹体见文件尾 HorsemansPumpkin。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { projSprite } from './Arrow';
import { playerCanHitEnemy, canBeChasedBy, applyBannerDamageDealt, hitTownNpcs } from './projTargets';   // ★BJ729-A（D1 B20）：弧族七站城镇 voodoo 靶
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { damageVarRoll } from '../stats/DamageVar';   // ★SW-T1 2026-09-04 DV 单源接线
import { prettyStarSparkle } from '../render/Renderer';
import { texId, texReady } from '../render/texId';
import { canHitLine } from '../physics/LineOfSight';
import { drawStripTrail } from '../fx/TrailShader';
import { cutTilesBox } from './ProjCutTiles';
import { hitCritters } from './projTargets';
import { rollVanillaHitCrit } from './proj1457';
// L5 长尾批：真刃系挥弧命中编排（Projectile.Damage case972-985 收编池）
import { nightsEdgeFx, trueNightsEdgeFx, excaliburFx, trueExcaliburFx, terraBladeFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';

interface ArcOwner { cx: number; cy: number; x: number; y: number; w: number; h: number; facing: number; dead: boolean }

/** 型号参数（AI_190 :42747-42762 switch）：num5=scale 增速 / num6=基数 */
interface SwingStyle {
  num5: number;
  num6: number;
  /** AI_190 世界点光 Lighting.AddLight（原版唯 984：(15,84,125) :42974；
   *  972/982/983/997 原文无——曾自造 c2×0.4 紫光,2026-09-19 清偿） */
  addLight?: [number, number, number];
  /** AI_190 首帧音（唯 984） */
  snd?: string;
}

const SWING_STYLE: Record<number, SwingStyle> = {
  972: { num5: 0.2, num6: 1 },
  982: { num5: 0.6, num6: 1 },
  983: { num5: 1.0, num6: 1.2 },
  997: { num5: 0.6, num6: 1 },
  984: { num5: 0.6, num6: 1, addLight: [15, 84, 125], snd: 'Item_60' },
};

// ====================================================================
// 剑影绘制引擎（DrawProj_NightsEdge 族 [1457] 逐式，1458 同域零漂移）。
// 贴图全白 ⇒ 颜色全在染色层；XNA 预乘 AlphaBlend（Color×float 四通道同乘）
// 的 canvas2D 等价式 = tint RGB 乘贴图 + color.A/255 全链作 globalAlpha。
// ====================================================================
type RGB = [number, number, number];

/** Utils.Remap(fromValue,fromMin,fromMax,toMin,toMax)（Utils.cs:345,clamped 缺省 true） */
export function remapArc(v: number, a: number, b: number, c: number, d: number): number {
  if (v <= a) return c;
  if (v >= b) return d;
  return c + ((d - c) * (v - a)) / (b - a);
}

const cLerp = (a: RGB, b: RGB, t: number): RGB =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 单层绘制指令（arcLayerList/tneGhostLayers 产出,drawArcLayers 消费） */
export interface ArcLayerDraw {
  frame: number;
  /** ×ai0 旋转偏移（原版 proj.rotation + proj.ai[0]×off） */
  rotAi: number;
  /** 绝对旋转偏移（973 扇面 num10 等不乘 ai0 的项） */
  rotAbs: number;
  /** 缩放（×(proj.scale×1.1)） */
  scale: number;
  /** 染色 RGB（0-255 连续域,烘焙前 byte 截断同 XNA (byte) cast） */
  rgb: RGB;
  /** 预乘透明度 = 原版 color.A 链（含全部 ×系数）/255 */
  alpha: number;
}

/** 逐式染色规格（DrawProj_NightsEdge :27901 / Excalibur :27958 / TheHorsemansBlade
 *  :27997 / TrueExcalibur :28095 / TerraBlade2 :28192；lerpN3=983 专有 amount=n3） */
interface ArcDrawSpec {
  base: [RGB, RGB];
  baseScale: number;
  l3: [RGB, RGB];
  l3Scale: number;
  l4: [RGB, RGB];
  l4Mul: number;
  /** 白衍生层调制通道：true=R（972/973 原文 color4.R=×(0.25+fv·0.75)）/
   *  false=B（982 族原文 color5.B=(int)color5.R×…——R 作被乘源的原版怪癖照录） */
  l2ModR: boolean;
  frame3: 'single' | 'trio';
  /** 984 专有：K=Remap(0.5+fv×0.5,0.2,1,0,1)（:28200-28201） */
  lightHalfMix?: boolean;
  /** 983 专有：三色按 n3 Lerp */
  lerpN3?: boolean;
}

// ★BJ206 2026-09-20 数据形状备忘：p[1]（各 [RGB,RGB] 对的第二元）仅 lerpN3 规格
//  （983）被消费（base[0]→base[1] 按 n3 Lerp）；其余四式（972/982/997/984）的
//  p[1] 与 p[0] 全等 = 写全形死的冗余位——非 lerpN3 消费支只读 p[0]。改色时
//  四式改 p[0] 即可；勿删 p[1]（保持 lerpN3 同构形状,编译器不报的死数据）。
const ARC_DRAW_SPEC: Record<number, ArcDrawSpec> = {
  972: { base: [[40, 20, 60], [40, 20, 60]], baseScale: 0.975,
    l3: [[80, 30, 160], [80, 30, 160]], l3Scale: 0.8,
    l4: [[80, 40, 180], [80, 40, 180]], l4Mul: 0.7, l2ModR: true, frame3: 'single' },
  982: { base: [[180, 160, 60], [180, 160, 60]], baseScale: 1,
    l3: [[255, 255, 80], [255, 255, 80]], l3Scale: 1,
    l4: [[255, 240, 150], [255, 240, 150]], l4Mul: 0.5, l2ModR: false, frame3: 'trio' },
  983: { base: [[180, 50, 90], [180, 30, 60]], baseScale: 1,
    l3: [[255, 255, 80], [255, 60, 190]], l3Scale: 1,
    l4: [[255, 240, 150], [255, 60, 170]], l4Mul: 0.5, l2ModR: false, frame3: 'trio', lerpN3: true },
  997: { base: [[193, 43, 43], [193, 43, 43]], baseScale: 1,
    l3: [[255, 202, 130], [255, 202, 130]], l3Scale: 1,
    l4: [[247, 115, 0], [247, 115, 0]], l4Mul: 0.5, l2ModR: false, frame3: 'trio' },
  984: { base: [[45, 124, 205], [45, 124, 205]], baseScale: 0.95,
    l3: [[34, 177, 76], [34, 177, 76]], l3Scale: 1,
    l4: [[181, 230, 29], [181, 230, 29]], l4Mul: 0.5, l2ModR: false, frame3: 'trio', lightHalfMix: true },
};

/** DrawProj_NightsEdge 族五层骨架（:27902-27923 同构；num2=localAI0/ai1、
 *  fv=光照因子、n3=渐隐包络）。层序 = 原版 Draw 调用序（画家序）。 */
export function arcLayerList(projId: number, num2: number, fv: number, n3: number): ArcLayerDraw[] {
  const spec = ARC_DRAW_SPEC[projId] ?? ARC_DRAW_SPEC[972];
  const K = spec.lightHalfMix ? remapArc(0.5 + fv * 0.5, 0.2, 1, 0, 1) : fv;
  const pick = (p: [RGB, RGB]): RGB => (spec.lerpN3 ? cLerp(p[0], p[1], n3) : p[0]);
  const out: ArcLayerDraw[] = [];
  // 层1 深色底×张开角（:27906 深色 ×fv×n3）
  out.push({ frame: 0, rotAi: -Math.PI / 4 * (1 - num2), rotAbs: 0,
    scale: spec.baseScale, rgb: pick(spec.base), alpha: K * n3 });
  // 层2 白衍生层（:27909-27914 链：White×n3×0.5 → A×=(1−K) → ×K×0.5 →
  //   G×=K → R|B 调制 → ×0.15）——亮处 A→0 隐没（暗处淡粉白泛光）
  {
    const w = 255 * n3 * 0.5;
    out.push({ frame: 0, rotAi: 0.01, rotAbs: 0, scale: 1,
      rgb: spec.l2ModR
        ? [w * K * 0.5 * (0.25 + K * 0.75), w * K * K * 0.5, w * K * 0.5]
        : [w * K * 0.5, w * K * K * 0.5, w * K * 0.5 * (0.25 + K * 0.75)],
      alpha: (w * (1 - K) * K * 0.5 * 0.15) / 255 });
  }
  // 层3 内芯（972 ×0.8 缩,其余 ×1） / 层4 主亮色（×0.975）
  out.push({ frame: 0, rotAi: 0, rotAbs: 0, scale: spec.l3Scale, rgb: pick(spec.l3), alpha: K * n3 * 0.3 });
  out.push({ frame: 0, rotAi: 0, rotAbs: 0, scale: 0.975, rgb: pick(spec.l4), alpha: K * n3 * spec.l4Mul });
  // 帧3 白芯：972 单层（:27922 (1−fv×0.7) 暗处愈亮）/ 其余三层组（无 fv 项）
  if (spec.frame3 === 'single') {
    out.push({ frame: 3, rotAi: 0.01, rotAbs: 0, scale: 1, rgb: [255, 255, 255], alpha: 0.3 * n3 * (1 - fv * 0.7) });
  } else {
    out.push({ frame: 3, rotAi: 0.01, rotAbs: 0, scale: 1, rgb: [255, 255, 255], alpha: 0.6 * n3 });
    out.push({ frame: 3, rotAi: -0.05, rotAbs: 0, scale: 0.8, rgb: [255, 255, 255], alpha: 0.5 * n3 });
    out.push({ frame: 3, rotAi: -0.1, rotAbs: 0, scale: 0.6, rgb: [255, 255, 255], alpha: 0.4 * n3 });
  }
  return out;
}

/** DrawProj_TrueNightsEdge（:28136-28224）单残影位 13 层链：
 *  基层 Lerp((40,20,60,120),(80,160,50,120),amount)×n3×num8（A=120 底）
 *  + 双扇面（num10=−4π/3|−2π/3,num11=Remap(num10,−2π,0,0,0.5)=1/6|1/3）各 4 层
 *  + 平位 4 层。白衍生链与 972 同构但调制源 = n3（:28167-28171 R 调制支）。 */
export function tneGhostLayers(amount: number, num8: number, fv: number, n3: number): ArcLayerDraw[] {
  const out: ArcLayerDraw[] = [];
  out.push({ frame: 0, rotAi: -Math.PI / 4, rotAbs: 0, scale: 0.975,
    rgb: cLerp([40, 20, 60], [80, 160, 50], amount), alpha: (120 / 255) * n3 * num8 });
  const color2 = cLerp([80, 40, 180], [155, 255, 100], amount);
  const color3b = cLerp([80, 30, 160], [200, 255, 0], amount);
  const w = 255 * num8 * 0.5;
  const chainRgb: RGB = [w * n3 * 0.5 * (0.25 + n3 * 0.75), w * n3 * n3 * 0.5, w * n3 * 0.5];
  const chainA = (w * (1 - n3) * n3 * 0.5 * 0.15) / 255;
  for (const num10 of [-Math.PI * 4 / 3, -Math.PI * 2 / 3]) {
    const num11 = remapArc(num10, -Math.PI * 2, 0, 0, 0.5);
    out.push({ frame: 0, rotAi: 0.01, rotAbs: num10, scale: 1, rgb: chainRgb, alpha: chainA * num11 });
    out.push({ frame: 0, rotAi: 0, rotAbs: num10, scale: 0.8, rgb: color3b, alpha: fv * num8 * num11 });
    out.push({ frame: 0, rotAi: 0, rotAbs: num10, scale: 0.975, rgb: color2, alpha: fv * num8 * (0.05 + 0.35 * fv) * num11 });
    out.push({ frame: 3, rotAi: 0, rotAbs: num10, scale: 1, rgb: [255, 255, 255], alpha: (0.05 + 0.45 * fv) * num8 * num11 });
  }
  out.push({ frame: 0, rotAi: 0.01, rotAbs: 0, scale: 1, rgb: chainRgb, alpha: chainA });
  out.push({ frame: 0, rotAi: 0, rotAbs: 0, scale: 0.8, rgb: color3b, alpha: n3 * num8 });
  out.push({ frame: 0, rotAi: 0, rotAbs: 0, scale: 0.975, rgb: color2, alpha: fv * num8 * (0.05 + 0.35 * n3) });
  out.push({ frame: 3, rotAi: 0, rotAbs: 0, scale: 1, rgb: [255, 255, 255], alpha: (0.05 + 0.45 * n3) * num8 });
  return out;
}

/** DrawProj_* 光照因子（:27908-27910：GetColor().ToVector3().Length()/√3 →
 *  Remap(0.2,1,0,1)；lightAt 0-255 域 → /255 归一。lighting 缺席=全亮）。
 *  导出面仅 tests/sword-trail-tint.test.ts 变异判别消费。 */
export function lightingFromValue(r: unknown, wx: number, wy: number): number {
  const lighting = (r as { lighting?: { lightAt(tx: number, ty: number): [number, number, number] } | null }).lighting;
  if (!lighting) return 1;
  const [lr, lg, lb] = lighting.lightAt(Math.floor(wx / 16), Math.floor(wy / 16));
  return remapArc(Math.sqrt(lr * lr + lg * lg + lb * lb) / (255 * Math.sqrt(3)), 0.2, 1, 0, 1);
}

/** 帧染色烘焙（tintIconRect 三步式 draw→multiply→destination-in——Renderer.ts tintedSprite
 *  同配方）。★BJ314 2026-09-23 染色烘焙记忆化（用户实报"永夜刃挥起来很卡,像 CPU
 *  软像素实现"）：旧实现 = 单共享 GPU-backed scratch 每层每帧重烘——972 挥砍稳态
 *  10 烘焙/帧（锚弧 5+飞斩 5）、TNE 973 39 烘焙/帧（3 残影位×13 层）,烘焙结果随即
 *  drawImage 进 willReadFrequently 软件世界层 ⇒ 每次都是「刚写完的 GPU 纹理→CPU
 *  面」跨界回读同步（scratch 逐帧重写=回读缓存永不可复用）。定谳链（探针
 *  _bj314-perf/_bj314-perf2/_bj314-perf3 + scripts/_bj314-hash.mjs）：
 *  · 恒等性：烘焙输出只依赖 (img, frame, rgb 整型)——fillStyle 本就按 `rgb(${r|0})`
 *    截断,键=同一输入 ⇒ 缓存命中输出与现烘逐字节恒等（落刀前后 FNV-1a 全等实拍,
 *    _bj314-hash.mjs 四面 694bec29/9bc96cb8/ce78015f 全等）。
 *  · 缓存面=GPU（无 attrs,与旧 scratch 同面）：★CPU 面（willReadFrequently）烘焙
 *    禁用——Skia 软件光栅 multiply 与 GPU 在同指令下系统性漂移（_bj314-delta 实测
 *    maxDelta 255/万级像素差）,非 ±1 舍入级,保 BJ313 物证基线必须同面。
 *  · 回读摊销：条目只写一次=快照恒定,Blink 跨帧复用其 CPU 拷贝（旧 scratch 逐帧
 *    重写=快照永失效→每 blit 强制回读同步;现飞斩 5 blit 实测 0.011ms/调用）。
 *  · 972 五层中 4 层 rgb 恒定（base/l3/l4/帧3 白芯,alpha 全在 globalAlpha 链不进
 *    烘焙）=每帧全冗余;层2 白衍生链键随 K/n3 漂移但整数域有界（每挥 ~25 档）。
 *  · texReady 入口守卫：半加载窗烘焙平色矩形按键永久入缓存 = 镜头光斑"淡色方片"
 *    同族毒化（texId.ts 头注判例）,禁入（projSprite 只在 onload 后出图,本守卫为
 *    素材包/升级链半窗兜底）。返回 null = 无 DOM‖未就绪（调用方降级直出）。 */
const arcTintCache = new WeakMap<object, Map<string, HTMLCanvasElement>>();

function tintedFrame(
  img: ImageBitmap | HTMLImageElement, fw: number, fh: number, frame: number, rgb: RGB,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;    // node 域（无 DOM）降级直出
  if (!texReady(img)) return null;                     // 半加载窗禁入缓存（毒化守卫）
  let cache = arcTintCache.get(img);
  if (!cache) { cache = new Map(); arcTintCache.set(img, cache); }
  const key = `${texId(img)}|${frame}|${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = fw;
  cv.height = fh;
  const c = cv.getContext('2d');
  if (!c) return null;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, fw, fh);
  c.imageSmoothingEnabled = false;
  c.drawImage(img, 0, frame * fh, fw, fh, 0, 0, fw, fh);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})`;
  c.fillRect(0, 0, fw, fh);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(img, 0, frame * fh, fw, fh, 0, 0, fw, fh);
  c.globalCompositeOperation = 'source-over';
  // 有界缓存（sparkleTintCache 同款逐条淘汰——禁整表 clear=重分配雪崩,2026-09-07
  // canvas 哨兵案）：65 项×170²×4 ≈ 7.5MB 上界;漂移键挤掉最旧项,恒定层键热驻。
  if (cache.size > 64) { const k0 = cache.keys().next().value; if (k0 !== undefined) cache.delete(k0); }
  cache.set(key, cv);
  return cv;
}

/** 层表消费端（XNA 预乘 AlphaBlend 等价合成）：染色帧 source-over ×A 链。
 *  ai0<0 → FlipVertically（rotate 后 scale(1,-1),沿袭本仓既有镜像式）。
 *  导出面仅 tests/sword-trail-tint.test.ts blend 记账断言消费。 */
export function drawArcLayers(
  ctx: CanvasRenderingContext2D, img: ImageBitmap | HTMLImageElement,
  cx: number, cy: number, rot: number, ai0: number,
  scale11: number, layers: ArcLayerDraw[],
): void {
  const fw = img.width, fh = img.height / 4;
  ctx.imageSmoothingEnabled = false;
  for (const l of layers) {
    if (l.alpha < 0.004) continue;                       // XNA byte α≤1 不可见域
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, l.alpha));
    ctx.translate(cx, cy);
    ctx.rotate(rot + l.rotAi * ai0 + l.rotAbs);
    if (ai0 < 0) ctx.scale(1, -1);
    const dw = fw * l.scale * scale11, dh = fh * l.scale * scale11;
    const tinted = tintedFrame(img, fw, fh, l.frame, l.rgb);
    if (tinted) ctx.drawImage(tinted, 0, 0, fw, fh, -dw / 2, -dh / 2, dw, dh);
    else ctx.drawImage(img, 0, l.frame * fh, fw, fh, -dw / 2, -dh / 2, dw, dh);   // 无 DOM 降级（登记:渲染只在浏览器发生）
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

/** Utils.DoesFitInCone（Utils.cs:1722-1729 [1457]）逐式：v=point−center、
 *  a=RotatedBy(−rot).ToRotation()（=wrapPi(atan2)−rot）、|a|≤maxAng 且 |v|<len。 */
export function conePointFits(px: number, py: number, cx: number, cy: number,
  len: number, rot: number, maxAng: number): boolean {
  const vx = px - cx, vy = py - cy;
  let a = Math.atan2(vy, vx) - rot;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  if (a < -maxAng || a > maxAng) return false;
  return vx * vx + vy * vy < len * len;
}

/** Utils.IntersectsConeSlowMoreAccurate（Utils.cs:1692-1717 [1457]）逐式：
 *  五点采样 = ClosestPointInRect(锥尖延长点) + 目标盒四角，任一入锥即真。 */
export function coneHitsRect(rx: number, ry: number, rw: number, rh: number,
  cx: number, cy: number, len: number, rot: number, maxAng: number): boolean {
  const tipX = cx + Math.cos(rot) * len, tipY = cy + Math.sin(rot) * len;
  const clampX = Math.max(rx, Math.min(rx + rw, tipX));
  const clampY = Math.max(ry, Math.min(ry + rh, tipY));
  if (conePointFits(clampX, clampY, cx, cy, len, rot, maxAng)) return true;
  if (conePointFits(rx, ry, cx, cy, len, rot, maxAng)) return true;
  if (conePointFits(rx + rw, ry, cx, cy, len, rot, maxAng)) return true;
  if (conePointFits(rx, ry + rh, cx, cy, len, rot, maxAng)) return true;
  if (conePointFits(rx + rw, ry + rh, cx, cy, len, rot, maxAng)) return true;
  return false;
}

/** 通用旋斩弧（原 TerraArc 泛化） */
export class SwingArc extends Entity {
  w = 16; h = 16;
  damage: number;
  /** 弹体击退（NewProjectile KnockBack 实参；997 命中召南瓜弹 321 透传用） */
  kb = 6.5;
  projId: number;
  ai0: number;
  ai1: number;
  ai2: number;
  private style: SwingStyle;
  private t = 0;
  private rot = 0;
  private scaleCur = 1;
  op = 0;
  private owner: ArcOwner;
  private hitSet = new Set<number>();
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  lightRGB: [number, number, number] | null = null;

  constructor(owner: ArcOwner, projId: number, animMax: number, damage: number, facing: number, scale: number) {
    super();
    this.owner = owner;
    this.projId = projId;
    this.style = SWING_STYLE[projId] ?? SWING_STYLE[972];
    this.ai0 = facing;
    this.ai1 = Math.max(1, animMax);
    this.ai2 = scale;
    this.damage = damage;
  }

  get num(): number { return this.t / this.ai1; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.t === 1 && this.style.snd) game.playSfxFiles([this.style.snd], 0.65, this.cx, this.cy);
    if (this.owner.dead) { this.dead = true; return; }
    const num = this.num;
    this.rot = Math.PI * this.ai0 * num + (this.ai0 > 0 ? 0 : Math.PI) + this.ai0 * Math.PI;
    this.x = this.owner.cx - this.w / 2 - Math.sign(this.ai0);
    this.y = this.owner.cy - this.h / 2;
    this.scaleCur = (this.style.num6 + num * this.style.num5) * this.ai2;
    this.op = Math.min(1, Math.max(0, num / 0.6)) * (num <= 0.6 ? 1 : Math.max(0, (1 - num) / 0.4));
    // AI_190 世界点光 1:1（唯 984 AddLight((15,84,125)) :42974；972/982/983/997 原文无
    // ——曾自造 c2×0.4 紫光 = 全家发光偏离,2026-09-19 清偿）
    const al = this.style.addLight;
    this.lightRGB = al ? [al[0] / 255, al[1] / 255, al[2] / 255] : null;
    // CutTiles（Projectile.cs:11824 全弹幕旁路——972/982/983/997/984 均不在
    // CanCutTiles 排除表）→ 旋斩扫过的瓦罐/杂草同步砍断（cutTilesBox 弹盒+1 外沿）
    cutTilesBox(game, this.cx - 85 * this.scaleCur, this.cy - 60 * this.scaleCur,
      170 * this.scaleCur, 120 * this.scaleCur);
    // 尘 1:1（AI_190 type 972 支 Projectile.cs:42783-42797 [1457]；982/983/997/984
    // 各有专属尘支,本支覆盖 972 面其余型号沿用原近似——锚弧/飞斩同走此处）：
    // 1/2/拍 选弧带角点（rot + NextFloatDirection×(π/2×0.7) → 半径 84×scale——scale
    // 取 ×ai2 前值 :42787 序）→ 1/5 尘14 黑烟雾（α150 scale1.4 noLight+noLightEmittance）
    // + 1/2 尘27 暗影炎紫焰（vel = player.vel×0.2+(dir×3, player.vel.y×0.2)、α100
    // scale1.4 noGravity）。曾用降采样紫方块 spawnParticles 近似 = 自由挥击近乎无粒
    // （用户实报"光效和粒子呢"案 2026-09-19）。命中时紫尘编排另发（Damage_PVE_Inner
    // case 972 → NightsEdge,仅命中触发——swordTrailOrchestra :344）。
    if (this.projId === 972 && Math.random() < 0.5) {
      const f = this.rot + (Math.random() * 2 - 1) * Math.PI * (Math.PI / 2) * 0.7;
      const sc0 = this.ai2 ? this.scaleCur / this.ai2 : this.scaleCur;
      const dx0 = this.cx + Math.cos(f) * 84 * sc0;
      const dy0 = this.cy + Math.sin(f) * 84 * sc0;
      const pv = this.owner as { vx?: number; vy?: number };
      const dir = Math.sign(this.ai0) || 1;
      if (Math.random() < 0.2) {
        const d = game.spawnDust?.(dx0, dy0, 0, 0, 14, 0, 0, 150, null, 1.4, false, true);
        if (d) { d.noLight = true; d.noLightEmittance = true; }
      }
      if (Math.random() < 0.5) {
        game.spawnDust?.(dx0, dy0, 0, 0, 27,
          (pv.vx ?? 0) * 0.2 + dir * 3, (pv.vy ?? 0) * 0.2, 100, null, 1.4, true, true);
      }
    }
    // 命中：穿透（型号表）+ 同敌单跳（usesLocalNPCImmunity 族）
    for (const ent of game.enemies()) {
      // ★dontTakeDamage 目标排除（近战 Player.cs:44618 目标选择门——挥砍对机关球零交互,
      // 评审 C 定谳 2026-09-02 补）
      if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; cx: number; cy: number; id: number; dead: boolean; dontTakeDamage?: boolean; spawnedFromStatue?: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || this.hitSet.has(e.id)) continue;
      // Colliding aiStyle 190 逐式（Projectile.cs:15630-15650 [1457]）：主锥 94×scale
      // @ rotation+2π/25×ai0 半角 π/4 + 拖尾锥（num15 = Remap(t,0.3ai1,0.5ai1,1,0)
      // 内收 π/4×ai0×num15,t≤0.3 满幅/≥0.5 消失）——Utils.IntersectsConeSlowMoreAccurate
      // 五点采样（Utils.cs:1692-1717）。曾用旋转方向盒近似(85×60@reach/2) = 扇缘漏判定
      // （用户实报"剑影接触到就该命中"案 2026-09-19）
      const reach = 94 * this.scaleCur;
      const num14 = this.rot + Math.PI * 2 / 25 * this.ai0;
      const num15 = remapArc(this.t, this.ai1 * 0.3, this.ai1 * 0.5, 1, 0);
      if (!coneHitsRect(e.x, e.y, e.w, e.h, this.cx, this.cy, reach, num14, Math.PI / 4)
        && !(num15 > 0 && coneHitsRect(e.x, e.y, e.w, e.h, this.cx, this.cy, reach,
          num14 - Math.PI / 4 * this.ai0 * num15, Math.PI / 4))) continue;
      // ★BJ486③（2026-10-03）掷率=owner 装配口径（rollVanillaHitCrit:12915-12927——
      //  972/982/983/997/984 melee 旗,基 4+meleeCrit 聚合;旧 arcCrit 载体含武器
      //  item.crit/词条 crt 的静态冻结载体退役;:25712 持械折入由 rollVanillaHitCrit
      //  动态承载=命中拍现值,写位已摘）。
      //  critChance≤0 关断钉保留（dealContacts :482 同族习语,测试置 0 禁暴击）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;   // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // ★F3 接线（蓝队四轮）①：锚弧（this.projId=972/982/983/997/984，数据面 melee）
      // → 焰爆石/拍击石双支（Projectile.cs:13439-13446）；加伤在 banner 外随暴击并入
      const snapBonusArc = projectileSnapStrikeBonus(game,
        { projId: this.projId }, (e as { cx?: number }).cx ?? e.x + e.w / 2,
        (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.cx, cy: e.cy },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusArc ? snapBonusArc : 0),
        this.ai0 * 6.5, 0, game, this.armorPen, crit, 0, true);   // ★F1 旗乘区;★S02 ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      this.hitSet.add(e.id);
      // ★L5 长尾批：挥弧命中编排（case972/982/983/984 面）;★δB1 MovementVector=弹速
      // =锚弧出生速度 (direction,0)（Player.cs:49441;AI_190 恒定不写 velocity）
      swordTrailOrchestra(game, this.projId, e, Math.sign(this.ai0) || 1, 0);
      // ★1457 无头骑士剑 997 命中召南瓜弹 321（Projectile.cs:13728-13732：门 =
      // (!immortal|flag9) && !SpawnedFromStatue && !CountsAsCritter——flag9 仅调试
      // 假人 488；dmg=damage×1f、kb=弹体击退）→ Player.HorsemansBlade_SpawnPumpkin
      // （Player.cs:42444-42462）屏外 ±半视口召 321 追击，见文件尾 HorsemansPumpkin
      if (this.projId === 997) {
        if (!e.dontTakeDamage && !e.spawnedFromStatue) {
          spawnHorsemansPumpkin(game, e.id, e.cx, e.cy, this.damage, this.kb);
        }
      }
    }
    // ★BJ729-A（D1 B20a,2026-10-27）：城镇 voodoo 靶——friendly 锚弧 flag 巫毒窄门
    //  （:12618-12631）;collide 通道镜像敌怪臂锥形几何（主锥 94×scale@rot+2π/25·ai0
    //  半角 π/4 + 拖尾锥 remap(t,0.3ai1,0.5ai1,1,0) 内收）;settle 镜像（crit 掷
    //  melee/DV=面级既有形态不单侧补齐[D6 族登记]/kb=ai0×6.5）;hitSet 单跳由
    //  TownNPC.hurt iframes 承载。
    hitTownNpcs(this, game, this.damage, this.ai0 * 6.5, 'playerProj', this.projId,
      (tn) => {
        const reachT = 94 * this.scaleCur;
        const num14T = this.rot + Math.PI * 2 / 25 * this.ai0;
        const num15T = remapArc(this.t, this.ai1 * 0.3, this.ai1 * 0.5, 1, 0);
        return coneHitsRect(tn.x, tn.y, tn.w, tn.h, this.cx, this.cy, reachT, num14T, Math.PI / 4)
          || (num15T > 0 && coneHitsRect(tn.x, tn.y, tn.w, tn.h, this.cx, this.cy, reachT,
            num14T - Math.PI / 4 * this.ai0 * num15T, Math.PI / 4));
      }, undefined, undefined, undefined,
      () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }));
    if (this.t >= this.ai1) this.dead = true;
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(this.projId);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const fv = lightingFromValue(r, this.cx, this.cy);   // 光照因子（Main.cs:27908）
    const layers = arcLayerList(this.projId, this.num, fv, this.op);
    drawArcLayers(ctx, img, this.cx, this.cy, this.rot, this.ai0, this.scaleCur * 1.1, layers);
    this.drawSparkle(ctx, img.width);
  }

  /** 刀尖星尘闪光（各 DrawProj_* 尾段的 DrawPrettyStarSparkle 组，1:1 参数）：
   *  - 972 永夜刃（:27424）：单笔 @刀尖（相位 Remap(num,0,1,0,π/2)·ai0）
   *  - 982 圣剑（:27527-27530）/ 997 无头骑士剑（同结构 :27527-27530 段）：8 笔
   *    循环（沿旋向 −2π·0.025·k 散布、径 (W/2−6)·sc）+ 刀尖大笔
   *  - 983 真断钢（:27568-27571）：12 笔（相位 Remap(num,0,0.6,0,0.95504415)、
   *    尺寸 ×0.75；shine=Lerp((255,255,80),(255,60,190),num3)——16 档量化防 tintCache 爆）
   *  - 984 泰拉刃（:27664-27667）：12 笔（相位 (k−2)）+ 大笔（fatness×1.5）
   *  flare/包络四参：num / fade(0,0.5,0.5,1)；draw=White(A0)×num3×0.5 → drawDim=op·0.5 */
  private drawSparkle(ctx: CanvasRenderingContext2D, fw: number): void {
    const num = this.num, op = this.op;
    if (op <= 0 || num >= 1) return;
    const sc = this.scaleCur * 1.1;
    const remap = (x: number, a: number, b: number, c: number, d: number): number =>
      x <= a ? c : x >= b ? d : c + ((d - c) * (x - a)) / (b - a);
    const WHITE: [number, number, number] = [255, 255, 255];
    const pos = (ang: number, r: number): [number, number] =>
      [this.cx + Math.cos(ang) * r, this.cy + Math.sin(ang) * r];
    const FADE: [number, number, number, number] = [0, 0.5, 0.5, 1];
    const spark = (x: number, y: number, shine: [number, number, number], rot: number,
      scale: [number, number], fat: [number, number], drawDim: number, shineDim = 1) => {
      prettyStarSparkle(ctx, 1, x, y, WHITE, shine, num,
        FADE[0], FADE[1], FADE[2], FADE[3], rot, scale, fat, drawDim, shineDim);
    };
    const tip = (phase: number): [number, number] => pos(this.rot + phase * this.ai0, (fw * 0.5 - 4) * sc);
    switch (this.projId) {
      case 972:   // :27424（drawColor=White×num3×0.5、shine=color2、rot=π/4、(2,2)/(1,1)）
        spark(...tip(remap(num, 0, 1, 0, Math.PI / 2)), [80, 40, 180],
          Math.PI / 4, [2, 2], [1, 1], op * 0.5);
        break;
      case 982:
      case 997: {
        // 8 笔循环（ang=rot+ai0·k·(−2π)·0.025+相位 π/4 段）+ 刀尖大笔
        const phase = remap(num, 0, 1, 0, Math.PI / 4);
        const shine: [number, number, number] = this.projId === 982 ? [255, 255, 80] : [255, 202, 130];
        const wide = remap(num, 0, 1, 3, 0), tall = remap(num, 0, 1, 4, 1);
        for (let k = 0; k < 8; k++) {
          const ang = this.rot + this.ai0 * k * (Math.PI * -2) * 0.025 + phase * this.ai0;
          const [x, y] = pos(ang, (fw * 0.5 - 6) * sc);
          spark(x, y, shine, ang, [0, wide * sc], [1 * sc, 1 * sc], op * (k / 9));
        }
        if (this.projId === 982) {
          spark(...tip(phase), shine, 0, [2 * sc, tall * sc], [1 * sc, 1 * sc], op * 0.5);
        } else {
          // 997 大笔：Vector2(Remap(num,0,1,4,1))（单分量构造 = 两轴同值）、rot=π/4
          spark(...tip(phase), shine, Math.PI / 4, [tall * sc, tall * sc], [1 * sc, 1 * sc], op * 0.5);
        }
        break;
      }
      case 983: {
        // 12 笔（相位 0.95504415 = 0.6·(π/2+π/4 折角)；尺寸 ×0.75）
        const phase = remap(num, 0, 0.6, 0, 0.95504415);
        const n5 = sc * 0.75;
        const tq = Math.round(op * 16) / 16;
        const shine: [number, number, number] = [255, 255 - 195 * tq, 80 + 110 * tq];
        const wide = remap(num, 0, 1, 3, 0), tall = remap(num, 0, 1, 4, 1);
        for (let k = 0; k < 12; k++) {
          const ang = this.rot + this.ai0 * k * (Math.PI * -2) * 0.025 + phase * this.ai0;
          const [x, y] = pos(ang, (fw * 0.5 - 6) * sc);
          spark(x, y, shine, ang, [0, wide * n5], [1 * n5, 1 * n5], op * (k / 12));
        }
        spark(...tip(phase), shine, 0, [2 * n5, tall * n5], [1 * n5, 1 * n5], op * 0.5);
        break;
      }
      case 984: {
        // 12 笔（相位 (k−2)）+ 大笔（fatness×num×1.5）
        const phase = remap(num, 0, 1, 0, Math.PI / 4);
        const shine: [number, number, number] = [34, 177, 76];
        const wide = remap(num, 0, 1, 3, 0), tall = remap(num, 0, 1, 4, 1);
        for (let k = 0; k < 12; k++) {
          const ang = this.rot + this.ai0 * (k - 2) * (Math.PI * -2) * 0.025 + phase * this.ai0;
          const [x, y] = pos(ang, (fw * 0.5 - 6) * sc);
          spark(x, y, shine, ang, [0, wide * sc], [1 * sc, 1 * sc], op * (k / 12));
        }
        spark(...tip(phase), shine, 0, [2 * sc, tall * sc], [1 * sc * 1.5, 1 * sc * 1.5], op * 0.5);
        break;
      }
      default:
        break;
    }
  }
}

/** 真永夜刃飞斩 973（AI_191 :39241-39332 + DrawProj_TrueNightsEdge :27574）：
 *  锚定伸长：Center=MountedCenter − vel + vel×num6²×77（最多前伸 76px）；
 *  rotation += ai0×2π×(4+4×Opacity)/90 旋进；scale=Remap(t,ai1+2,ai1+65,1.12,1)×ai2；
 *  Opacity=Remap(t,0,ai1,0,1)×Remap(t,ai1+50,ai1+65,1,0)；寿命 ai1+65（出生 32→97t）；
 *  t≥ai1(=num5)+3=80 清伤；近墙 80px 锥探测失败 → 速度阻尼 ×0.8/×0.88（>8 时）。
 *  绘制：oldPos[2..0] 各走同一 13 层染色链（位锚当前 Center−vel×0.5×num5、
 *  旋 = oldRot−ai0×2π×0.1×num5、num7=1−num5/2；层表见 tneGhostLayers）。 */
export class TrueNightsEdgeSlash extends Entity {
  w = 30; h = 30;
  damage: number;
  ai0: number;
  ai1: number;
  ai2: number;
  /** ai1 出生日注入 32 */
  private t = 0;
  /** localAI[1] 伸长计数器 */
  private lai1 = 0;
  private rot = 0;
  private opacity = 0;
  private scaleCur = 1;
  /** 近墙阻尼标记 */
  private wallBlocked = false;
  private owner: ArcOwner;
  private hitCd = new Map<number, number>();
  /** ★BJ486③ vanilla 弹 id（Projectile.cs SetDefaults 973 :9317 melee=true）——
   *  命中面掷率改 rollVanillaHitCrit 类旗查询锚（原版 Damage 面=基 4+owner 装配,
   *  静态冻结载体 arcCrit 退役;:25712 持械折入动态承载,BJ482②/BJ486③） */
  readonly projId = 973;
  critChance = 0.04;
  armorPen = 0;
  /** oldPos 残影环（3 档 + 当前） */
  private hist: Array<{ x: number; y: number; rot: number }> = [];

  constructor(owner: ArcOwner, vx: number, vy: number, damage: number, facing: number, animMax: number, scale: number) {
    super();
    this.owner = owner;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.ai0 = facing;
    this.ai1 = animMax;
    this.ai2 = scale;
  }

  get num(): number { return this.t / this.ai1; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    this.lai1++;
    const num3 = this.ai1 + 50, num4 = this.ai1 + 65, num5 = 77;
    this.opacity = Math.min(1, Math.max(0, this.t / this.ai1))
      * (this.t <= num3 ? 1 : Math.max(0, (num4 - this.t) / 15));
    if (this.t >= num4) { this.dead = true; return; }
    // t≥num5+3(80) 清伤（纯视觉尾段）
    if (this.t >= num5 + 3) this.damage = 0;
    const owner = this.owner;
    if (owner.dead) { this.dead = true; return; }
    // 近墙锥探测（:39286-39304：±22.5° 三射线 80px CanHit，全遮 → 阻尼）
    if (!this.wallBlocked && this.damage > 0) {
      const va = Math.atan2(this.vy, this.vx);
      let clear = false;
      for (let k = -1; k <= 1 && !clear; k += 0.5) {
        const a = va + k * (Math.PI / 4) * 0.25;
        const ok = (game.world.store.inBounds(Math.floor((this.cx + Math.cos(a) * 80) / 16), Math.floor((this.cy + Math.sin(a) * 80) / 16))
          && !game.world.store.isSolid(Math.floor((this.cx + Math.cos(a) * 80) / 16), Math.floor((this.cy + Math.sin(a) * 80) / 16)));
        if (ok) clear = true;
      }
      if (!clear) this.wallBlocked = true;
    }
    if (Math.hypot(this.vx, this.vy) > 8) {
      this.vx *= 0.94; this.vy *= 0.94;
      if (this.wallBlocked && Math.hypot(this.vx, this.vy) > 8) { this.vx *= 0.8; this.vy *= 0.8; }
      if (this.wallBlocked) { this.vx *= 0.88; this.vy *= 0.88; }
    }
    // 锚定伸长（:39309-39312）
    const num6 = Math.min(1, Math.max(0, (this.lai1 - this.ai1 * 0.4) / (num4 - this.ai1 * 0.4)));
    const vd = Math.hypot(this.vx, this.vy) || 1;
    this.x = owner.cx - this.w / 2 + (this.vx / vd) * (-1 + num6 * num6 * num5);
    this.y = owner.cy - this.h / 2 + (this.vy / vd) * (-1 + num6 * num6 * num5);
    this.rot += this.ai0 * Math.PI * 2 * (4 + this.opacity * 4) / 90;
    this.scaleCur = (1.12 - 0.12 * Math.min(1, Math.max(0, (this.t - this.ai1 - 2) / (num4 - this.ai1 - 2)))) * this.ai2;
    this.hist.push({ x: this.cx, y: this.cy, rot: this.rot });
    if (this.hist.length > 4) this.hist.shift();
    // 尘（:39317-39330：尘 14 1/5 + 75/27 ×3Opacity——降采样近似）
    if (Math.random() < this.opacity * 0.6) {
      const f = this.rot + (Math.random() - 0.5) * 1.1;
      game.spawnParticles(this.cx + Math.cos(f) * 84 * this.scaleCur, this.cy + Math.sin(f) * 84 * this.scaleCur,
        Math.random() < this.opacity ? '#9BE864' : '#5028B4', 1, 1.4, { life: 18 });
    }
    // 命中（穿透 3；免疫 5t）
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    if (this.damage > 0) {
      for (const ent of game.enemies()) {
        // ★dontTakeDamage 目标排除（:12600 同款,终审补——同首环）
        if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
        if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892）
        const e = ent as unknown as { x: number; y: number; w: number; h: number; cx: number; cy: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
        if (e.dead || (this.hitCd.get(e.id) ?? 0) > 0) continue;
        // Colliding type 973 逐式（Projectile.cs:15553-15566 [1457]）：ClosestPointInRect
        // 距离圆 100×scale（v.Length() 判定,盒内点 SafeNormalize 回退长 1 仍真）+
        // CanHit(Center→targetRect.Center) 视线门——曾用旋转方向盒近似(85×60)漏判定
        const cpx = Math.max(e.x, Math.min(e.x + e.w, this.cx));
        const cpy = Math.max(e.y, Math.min(e.y + e.h, this.cy));
        if (!(Math.hypot(cpx - this.cx, cpy - this.cy) < 100 * this.scaleCur)) continue;
        if (!canHitLine(game.world.store, this.cx, this.cy, 0, 0, e.cx, e.cy, 0, 0)) continue;
        // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,973 melee 旗）。
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const dmg = this.damage;   // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
        // ★F3 接线（蓝队四轮）②：真永夜刃伸长斩 973（数据面 melee）——双支同序；
        // 排除面 = 本弹 local 免疫窗投影
        const snapBonusTrueEdge = projectileSnapStrikeBonus(game,
          { projId: 973 }, (e as { cx?: number }).cx ?? e.x + e.w / 2,
          (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
          { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
            cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 },
            targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
        e.hurt(applyBannerDamageDealt(game, e, dmg)
          + (snapBonusTrueEdge ? snapBonusTrueEdge : 0),
          this.ai0 * 6.5, 0, game, this.armorPen, crit, 0, true);   // ★F1 旗乘区;★S02 ×2=Enemy.hurt 防后;fromPlayer=DPS 计
        this.hitCd.set(e.id, 5);
        // ★L5 长尾批：TrueNightsEdgeSlash=弹 973 → TrueNightsEdge(12);★δB1 载弹速
        swordTrailOrchestra(game, 973, e, this.vx, this.vy);
      }
    }
    // ★BJ729-A（D1 B20b,2026-10-27）：城镇 voodoo 靶——973 friendly 弹巫毒窄门;
    //  collide 镜像敌怪臂几何（ClosestPointInRect 距离圆 100×scale + CanHit 视线
    //  P.cs:15553-15566）;settle 镜像（crit 掷 melee/kb=ai0×6.5）;5t 窗由
    //  TownNPC.hurt iframes 承载。
    hitTownNpcs(this, game, this.damage, this.ai0 * 6.5, 'playerProj', 973,
      (tn) => {
        const cpxT = Math.max(tn.x, Math.min(tn.x + tn.w, this.cx));
        const cpyT = Math.max(tn.y, Math.min(tn.y + tn.h, this.cy));
        return Math.hypot(cpxT - this.cx, cpyT - this.cy) < 100 * this.scaleCur
          && canHitLine(game.world.store, this.cx, this.cy, 0, 0,
            tn.x + tn.w / 2, tn.y + tn.h / 2, 0, 0);
      }, undefined, undefined, undefined,
      () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }));
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(973);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const fv = lightingFromValue(r, this.cx, this.cy);   // 光照因子（Main.cs:28141）
    // n3（:28146）：min(0.15+fv×0.85, Remap(localAI0,30,96,1,0))——TNE 不走 num 包络
    const n3 = Math.min(0.15 + fv * 0.85, remapArc(this.t, 30, 96, 1, 0));
    const amount = this.opacity * this.opacity;
    const sc = this.scaleCur * 1.1;
    // oldPos[2..0] 残影环（:28147-28184 num5=2..0 各走同一 13 层链；位 =
    // Center−vel×0.5×num5【锚当前中心】、旋 = oldRot[num5]−ai0×2π×0.1×num5、
    // num7 = 1−num5/2（age1=0.25² 包络、age2=0 → 远影隐没）——曾用历史位锚定
    // + ÷3 除数 = 三影齐亮、远影不灭,2026-09-19 逐式对拍修）
    for (let age = 2; age >= 0; age--) {
      const hi = this.hist.length - 2 - age;             // oldRot[age] = hist[len−2−age]
      if (hi < 0) continue;
      const num7 = 1 - age / 2;
      const num8 = Math.max(0, this.opacity * num7 * num7 * 0.85);
      const px = this.cx - this.vx * 0.5 * age;
      const py = this.cy - this.vy * 0.5 * age;
      const rot = this.hist[hi].rot - this.ai0 * Math.PI * 2 * 0.1 * age;
      drawArcLayers(ctx, img, px, py, rot, this.ai0, sc, tneGhostLayers(amount, num8, fv, n3));
    }
    // 刀尖星芒（:28219-28222）：num12=clamp(1−t/80,0.5,1)（伸长回缩半径）、
    // num13=min(n3, Lerp(1,fv,Remap(t,0,80,0,1)))；半径 (W/2−4)×(scale×1.1)×num12
    // （无 0.975——曾误乘）；shine=(150,255,100)×num13、draw=White(A0)×Opacity×0.5×num13
    const num12 = Math.max(0.5, 1 - this.t / 80);
    const num13 = Math.min(n3, 1 + (fv - 1) * remapArc(this.t, 0, 80, 0, 1));
    const spAng = this.rot + 0.47123894 * this.ai0;
    const spR = (img.width * 0.5 - 4) * sc * num12;
    prettyStarSparkle(ctx, this.opacity,
      this.cx + Math.cos(spAng) * spR, this.cy + Math.sin(spAng) * spR,
      [255, 255, 255], [150, 255, 100], this.opacity,
      0, 1, 1, 2, Math.PI / 4, [2, 2], [1, 1],
      this.opacity * num13, num13);
  }
}

/** 永夜刃飞斩变体（273 第二发：ai0=dir×gravDir×0.1 → |ai0|<0.2 飞斩支
 *  Projectile.cs:42783-42791 [1457]——旧注 :39457-39466 系 1456 行号已废）：
 *  自由飞行、rotation 每 tick【绝对重赋】= num4 + π×4×ai0×10×num
 *  （rot(t)=aim+0.1sπ+4.1sπ·t/ai1,s=dir×gravDir——★BJ342 ND1 定谳,见 fixedUpdate）、
 *  10t 起前漂 45px、scale=(1+0.2num+0.4num7)×ai2（★ND3 复合序）、寿命 ai1=30t。 */
export class NightsEdgeFly extends Entity {
  w = 16; h = 16;
  damage: number;
  private ai0: number;
  private ai1: number;
  private ai2: number;
  private t = 0;
  private rot = 0;
  private scaleCur = 1;
  private dx: number; private dy: number;
  private hitCd = new Map<number, number>();
  /** ★BJ486③ vanilla 弹 id（SetDefaults 972 :9300 melee=true）——rollVanillaHitCrit 锚 */
  readonly projId = 972;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  private hist: Array<{ x: number; y: number; rot: number }> = [];

  constructor(x: number, y: number, vx: number, vy: number, damage: number, facing: number, animMax: number, scale: number) {
    super();
    this.x = x; this.y = y;
    const n = Math.hypot(vx, vy) || 1;
    this.vx = vx; this.vy = vy;
    this.dx = vx / n; this.dy = vy / n;
    this.damage = damage;
    this.ai0 = facing * 0.1;
    this.ai1 = animMax;
    this.ai2 = scale;
  }

  get num(): number { return this.t / this.ai1; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.t >= this.ai1) { this.dead = true; return; }
    const num = this.num;
    // ★BJ342 ND1（W3 定谳翻案,先定谳再动刀）:AI_190 每 tick【绝对重赋】
    //  rotation = num4（Projectile.cs:42751 = π×num2×num + num3 + num2×π +
    //  player.fullRotation;num3 = velocity.ToRotation() = aim 角、num2 = ai0 =
    //  dir×gravDir×0.1（Player.cs:49382 飞斩实参）、num = localAI[0]/ai1）,
    //  飞斩支（|num2|<0.2,:42783-42791）再 += π×4×num2×10×num
    //  ⇒ rot(t) = aim + 0.1sπ + 4.1sπ·(t/ai1)（s=dir×gravDir;匀角速 ~2.05 圈、
    //  aim 锚定）。fullRotation 项本族不建模（同 SwingArc 锚弧约定,倒挂镜像面由
    //  ai0+draw scale(1,-1) 承载,Game.ts:14038-14041 判例）。旧实现 rot += … 自 0
    //  累积 = 二次型 ~31 圈/零 aim 锚/末段 720°/tick,连带尘弧带角与命中锥 num14
    //  时序错位（尘/锥消费 this.rot,绝对式落地即同步对齐）。
    const aim = Math.atan2(this.vy, this.vx);   // num3 = velocity.ToRotation()（972 vel 恒=aim 向）
    this.rot = Math.PI * this.ai0 * num + aim + this.ai0 * Math.PI
      + Math.PI * 4 * this.ai0 * 10 * num;
    const num7 = Math.min(1, Math.max(0, (this.t - 10) / (this.ai1 - 5 - 10)));
    this.x += this.dx * 45 * num7;
    this.y += this.dy * 45 * num7;
    // ★BJ342 ND3：复合序 scale = (num6+num·num5 :42765) → += num7×0.4（:42789）
    //  → ×= ai[2]（函数尾 :42997）——旧 (1+0.2num)×ai2+0.4·num7 乘加序错（仅 size
    //  stat≠1 可见,仍修）;尘弧半径 84×sc0（=×ai2 前值 :42787 序）由此式恢复精确。
    this.scaleCur = (1 + num * 0.2 + num7 * 0.4) * this.ai2;
    this.x += this.vx; this.y += this.vy;
    this.hist.push({ x: this.cx, y: this.cy, rot: this.rot });
    if (this.hist.length > 4) this.hist.shift();
    // 尘 1:1（同弹 972 = 同 AI_190 尘支 Projectile.cs:42783-42797——飞斩与锚弧共用;
    // 曾用散布紫方块近似 = 飞斩无粒子,2026-09-19 用户实报案）
    if (Math.random() < 0.5) {
      const f = this.rot + (Math.random() * 2 - 1) * Math.PI * (Math.PI / 2) * 0.7;
      const sc0 = this.ai2 ? this.scaleCur / this.ai2 : this.scaleCur;
      const dx0 = this.cx + Math.cos(f) * 84 * sc0;
      const dy0 = this.cy + Math.sin(f) * 84 * sc0;
      if (Math.random() < 0.2) {
        const d = game.spawnDust?.(dx0, dy0, 0, 0, 14, 0, 0, 150, null, 1.4, false, true);
        if (d) { d.noLight = true; d.noLightEmittance = true; }
      }
      if (Math.random() < 0.5) {
        // ★BJ342 ND2：尘 27 速度源 = player.velocity（:42797 = player.velocity.X×0.2 +
        //  player.direction×3 / player.velocity.Y×0.2——AI_190 尘支共用玩家速度,锚弧站
        //  SwingArc:378-386 已同源;曾用弹速 this.vx×0.2+sign(dx)×3 = 速度源与方向项
        //  双偏离。player.direction=玩家朝向,倒挂不翻转;tests 无 player 走 ?? 兜底,
        //  spawnDust 缺省桩不观感）
        const pl = game.player as { vx?: number; vy?: number; facing?: number } | null | undefined;
        game.spawnDust?.(dx0, dy0, 0, 0, 27,
          (pl?.vx ?? 0) * 0.2 + (pl?.facing ?? 1) * 3, (pl?.vy ?? 0) * 0.2,
          100, null, 1.4, true, true);
      }
    }
    // 命中（穿透 2；同敌单跳）——Colliding aiStyle 190 锥判定逐式（同 972 弹;
    // 飞斩 num15 拖尾锥同式,ai1=30）——曾用 16×16 盒 = 刃影擦过不判定（用户实报案）
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || this.hitCd.has(e.id)) continue;
      const reachF = 94 * this.scaleCur;
      const num14F = this.rot + Math.PI * 2 / 25 * this.ai0;
      const num15F = remapArc(this.t, this.ai1 * 0.3, this.ai1 * 0.5, 1, 0);
      if (!coneHitsRect(e.x, e.y, e.w, e.h, this.cx, this.cy, reachF, num14F, Math.PI / 4)
        && !(num15F > 0 && coneHitsRect(e.x, e.y, e.w, e.h, this.cx, this.cy, reachF,
          num14F - Math.PI / 4 * this.ai0 * num15F, Math.PI / 4))) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,972 melee 旗）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;   // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // ★F3 接线（蓝队四轮）③：永夜刃飞斩变体 972（数据面 melee）——双支同序
      const snapBonusFly = projectileSnapStrikeBonus(game,
        { projId: 972 }, (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusFly ? snapBonusFly : 0),
        Math.sign(this.vx) * 6.5, 0, game, this.armorPen, crit, 0, true);   // ★F1 旗乘区;★S02 ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      this.hitCd.set(e.id, 9999);
      // ★L5 长尾批：永夜刃飞斩变体=弹 972 → NightsEdge(10);★δB1 载弹速
      swordTrailOrchestra(game, 972, e, this.vx, this.vy);
    }
    // ★BJ729-A（D1 B20c,2026-10-27）：城镇 voodoo 靶——972 friendly 弹巫毒窄门;
    //  collide 镜像敌怪臂锥形几何（主锥 94×scale@num14F 半角 π/4 + 拖尾锥 num15F
    //  内收）;settle 镜像（crit 掷 melee/kb=sign(vx)×6.5）;9999 单跳由 TownNPC.hurt
    //  iframes 承载。
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 6.5, 'playerProj', 972,
      (tn) => {
        const reachF2 = 94 * this.scaleCur;
        const num14F2 = this.rot + Math.PI * 2 / 25 * this.ai0;
        const num15F2 = remapArc(this.t, this.ai1 * 0.3, this.ai1 * 0.5, 1, 0);
        return coneHitsRect(tn.x, tn.y, tn.w, tn.h, this.cx, this.cy, reachF2, num14F2, Math.PI / 4)
          || (num15F2 > 0 && coneHitsRect(tn.x, tn.y, tn.w, tn.h, this.cx, this.cy, reachF2,
            num14F2 - Math.PI / 4 * this.ai0 * num15F2, Math.PI / 4));
      }, undefined, undefined, undefined,
      () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }));
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(972);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const op = Math.min(1, Math.max(0, this.num / 0.6)) * (this.num <= 0.6 ? 1 : Math.max(0, (1 - this.num) / 0.4));
    const fv = lightingFromValue(r, this.cx, this.cy);
    // 同弹 972 = 同一 DrawProj_NightsEdge（:27901）——基角偏移 = ai0×(π/4)×(−1)×(1−num2)
    // 无 ×10（×10 只在 AI_190 旋进式 :42787,曾误抄进绘制 = 基角漂移 10 倍,2026-09-19 修）
    drawArcLayers(ctx, img, this.cx, this.cy, this.rot, this.ai0, this.scaleCur * 1.1,
      arcLayerList(972, this.num, fv, op));
  }
}

/** Zenith 933（AI_182_FinalFractal :40434-40515 + 绘制 :28040/:30174-30185/:30841）：
 *  出生（Player.cs:48078-48121）：vel=(目标−MountedCenter)/2（非归一！轨道半径=|vel|）；
 *  ai[0]=rand(−100,101) 轨道椭圆高；ai[1]=剑档案（首击 4956，后续档案表随机，
 *  GetRandomProfileIndex 重掷 4956）。
 *  AI：首帧 Item169；counter += Lerp(0.7,2, GetLerpValue(900,0,|vel|×2))（慢则快计）；
 *  ≥120 消亡；锚点 = MountedCenter + vel（随玩家移动）；椭圆轨道
 *  num8=|vel|+Late(0.5..1)×40（下限 60）绕锚点旋转 num7=π+sign(vx)×phase×2π
 *  （phase=GetLerpValue(0,1,counter/60)）；rotation=num7+vel角+π/2（ai0<0 反旋）；
 *  Opacity 淡入 0-5/淡出 115-120。
 *  绘制链（DrawProjDirect 内顺序）：① 彩带拖尾（FinalFractalHelper.Draw :176-192
 *  [1457]（派发 Main.cs:28669-28672 type 933/1100→VertexStrip：截面沿刃轴向
 *  ±trailWidth（=fullBladeLength/2,FinalFractalHelper.cs:29/:62-65 [1457]）、
 *  StripColors 逐剑固定色渐隐）→
 *  ② 白残影 ×3（:30381 循环 + :30174 933 档 num156=60/num155=−15 → num159=
 *  45/30/15，60 越界跳过）→ ③ 本体 =【ai[1] 物品贴图】（:29945-29953 LoadItem、
 *  origin=中心、基角 −π/4×spriteDir；GetAlpha :76047 = White×Opacity ×num182
 *  淡入 0-20/淡出 68-60）→ ④ 1.25× 白叠绘（:30841 色 (255,255,255,127)×Opacity
 *  ×num186）→ ⑤ 刃尖星芒（1457 Main.cs:31620 DrawPrettyStarSparkle，15-45 counter 窗）。
 *  档案表（FinalFractalHelper.cs:74-160 [1457]：剑物品 id → 全刃长/拖尾色）。 */
// ★SW-FX24 2026-09-10：len 列=fullBladeLength（构造参,FinalFractalHelper.cs:27-29
//  [1457] trailWidth=fullBladeLength/2）。旧表 9 项系 1456 值漏更（65:48→60、
//  1123:48→75、46:48→65、121:76→110、190:70→105、368:70→75、674:70→75、
//  795:70→72、3018:80→75），已按 1457 终值对齐（=1458 同域零漂移）；其余 12 项
//  与 default 50 两版全等。色列 21 项 1456↔1457 零漂移（1123=Main.OurFavoriteColor,
//  Main.cs:886 [1457]）。
const FRACTAL_PROFILES: Record<number, { len: number; color: [number, number, number] }> = {
  65: { len: 60, color: [236, 62, 192] }, 1123: { len: 75, color: [255, 231, 69] },  // 1123=Main.OurFavoriteColor（Main.cs:886）
  46: { len: 65, color: [122, 66, 191] }, 121: { len: 110, color: [254, 158, 35] },
  190: { len: 105, color: [107, 203, 0] }, 368: { len: 75, color: [236, 200, 19] },
  674: { len: 75, color: [236, 200, 19] }, 273: { len: 70, color: [179, 54, 201] },
  675: { len: 70, color: [179, 54, 201] }, 2880: { len: 70, color: [84, 234, 245] },
  989: { len: 48, color: [91, 158, 232] }, 1826: { len: 76, color: [252, 95, 4] },
  3063: { len: 76, color: [254, 194, 250] }, 3065: { len: 70, color: [237, 63, 133] },
  757: { len: 70, color: [80, 222, 122] }, 155: { len: 70, color: [56, 78, 210] },
  795: { len: 72, color: [237, 28, 36] }, 3018: { len: 75, color: [143, 215, 29] },
  4144: { len: 45, color: [178, 255, 180] }, 3507: { len: 45, color: [235, 166, 135] },
  4956: { len: 86, color: [178, 255, 180] },
};

/** 档案键集（测试用） */
export const FRACTAL_KEYS = Object.keys(FRACTAL_PROFILES).map(Number);

/** GetRandomProfileIndex（:170-180）：档案表随机，命中 4956 移除后重掷一次
 *  （重掷池不含 4956——曾从全表重掷仍有 1/21 概率回到 Zenith） */
export function randomFractalProfile(excludeZenith = true): number {
  const keys = Object.keys(FRACTAL_PROFILES).map(Number);
  let id = keys[Math.floor(Math.random() * keys.length)];
  if (excludeZenith && id === 4956) {
    const rest = keys.filter((k) => k !== 4956);
    id = rest[Math.floor(Math.random() * rest.length)];
  }
  return id;
}

/** GetFinalFractalProfile（:194-201 [1457]=:192-199 [1456]）：缺项回退 50f/Color.White
 *  （_defaultProfile :162 [1457] = new FinalFractalProfile(50f, Color.White)） */
export function fractalProfile(id: number): { len: number; color: [number, number, number] } {
  return FRACTAL_PROFILES[id] ?? { len: 50, color: [255, 255, 255] };
}

/** 拖尾衰减因子（FinalFractalProfile.StripColors :54-59 逐字）：
 *  result = trailColor × (1 − GetLerpValue(0, 0.98, progressOnStrip))；result.A /= 2。
 *  XNA Color×float 四通道同乘 → rgb 与 A 同乘本因子、A 额外减半（预乘混合下
 *  rgb:alpha = 2:1——draw 的两 pass 精确等价来源）。progress = i/(oldPos.Length−1)
 *  = i/59（VertexStrip.PrepareStrip :63，恒除 60−1——幼年拖尾不缩分母）。 */
export function fractalStripFade(progress: number): number {
  return 1 - Math.max(0, Math.min(1, progress / 0.98));
}

/** 白残影 alpha（Main.cs:30606-30611）：Color.White × GetLerpValue(0, 60, 60−num159)
 *  × Opacity × GetLerpValue(0,20,counter−num159) × GetLerpValue(68,60,counter−num159)
 *  （rgb:alpha = 1:1 → 单 pass source-over；t = 历史时刻的 localAI[0] −− 原版按
 *  索引差近似，非真实计数差——逐字沿用） */
export function fractalGhostAlpha(counter: number, num159: number, opacity: number): number {
  const t = counter - num159;
  return ZenithSword.lerpV(0, 60, 60 - num159) * opacity
    * ZenithSword.lerpV(0, 20, t) * ZenithSword.lerpV(68, 60, t);
}

export class ZenithSword extends Entity {
  w = 32; h = 32;
  damage: number;
  knockback = 6.5;
  /** ai[0] 轨道椭圆高（−100..100） */
  ai0: number;
  /** ai[1] 剑档案（物品 id） */
  ai1: number;
  private counter = 0;
  private opacity = 0;
  private rot = 0;
  private spriteDir = 1;
  private owner: ArcOwner;
  private hitCd = new Map<number, number>();
  /** oldPos/oldRot 拖尾环（TrailCacheLength[933]=60、TrailingMode[933]=4，
   *  ProjectileID.cs:385/:387）：每条目 [cx, cy, rot] 每 update 压一条
   *  （extraUpdates=1 → 每 tick 2 条,环时长 30 游戏秒帧）。★BJ686 勘误（旧注称
   *  「:15728 拖尾段先于 AI_182 压上一 update 末态」系误读）：1457 真序=Update
   *  while 循环（:16780-16783,体内 numUpdates∈{0,-1}=子步 A/B）内 AI() :16880
   *  在【前】、TrailingMode 块 :17197-17302 在【后】——压的是本子步 AI 末态 */
  private trail: number[] = [];
  /** oldSpriteDirection 环（残影镜像 XOR 用，:30572-30577）——与 trail 同步压/裁 */
  private trailDirs: number[] = [];
  /** TrailingMode 4 玩家位移补偿（:17274-17290 numUpdates==0 子步 A 时 oldPos += 玩家帧位移） */
  private lastOwnerX = 0;
  /** ★interp:最新一步的 TrailingMode 4 补偿向量（渲染期相位退回消费,见
   *  fixedUpdate 注;NaN=未步进（出生首步前）——渲染退回跳过）。 */
  private lastCompX = NaN;
  private lastCompY = NaN;
  private lastOwnerY = 0;
  /** ★BJ486③ vanilla 弹 id（SetDefaults 933 :8859 melee=true）——rollVanillaHitCrit 锚 */
  readonly projId = 933;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  lightRGB: [number, number, number] | null = null;

  constructor(owner: ArcOwner, tx: number, ty: number, damage: number, profile: number, kb = 6.5) {
    super();
    this.owner = owner;
    this.vx = (tx - owner.cx) / 2;   // :48116 vector44 = vector45/2（非归一——轨道半径）
    this.vy = (ty - owner.cy) / 2;
    this.damage = damage;
    this.ai0 = Math.floor(Math.random() * 201) - 100;
    this.ai1 = profile;
    this.knockback = kb;
    this.lastOwnerX = owner.x;
    this.lastOwnerY = owner.y;
    // 出生点（NewProjectile position=发射点，Player.cs:48118）——拖尾首条锚
    // （原版 AI_182 首帧即把 Center 挪上轨道，oldPos[0] 留在出生点：拖尾从玩家
    // 处甩出一段再入轨的视觉来源）。近似取 MountedCenter（枪口在其 ~50px 内）
    this.x = owner.cx - this.w / 2;
    this.y = owner.cy - this.h / 2;
  }

  /** GetLerpValue(from,to,t,clamped) 语义——线性后钳 [0,1]（递减区间 from>to 同式，
   *  曾按 min/max 早退写反：900→0 区间 t≥900 应得 0 非 1）。公开供模块级
   *  档案/残影纯函数复用 */
  static lerpV(a: number, b: number, t: number): number {
    if (a === b) return t >= a ? 1 : 0;
    const v = (t - a) / (b - a);
    return Math.max(0, Math.min(1, v));
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // vanilla-projectiles 933 extraUpdates=1——AI 每 tick 跑两遍（整程 120 计数
    // 60 游戏秒帧耗尽；曾单跑=轨道慢一倍且滞空过久，2026-08-19 审查）
    // ★BJ686（2026-10-16 用户实报「飞行态圆弧变波浪,静止正常,FX24 首日即有」
    //   定谳重排）：1457 Projectile.Update :16780 `numUpdates = extraUpdates` →
    //   while 体以 numUpdates∈{0,-1} 各跑一遍=子步 A/B;TrailingMode 4 块
    //   :17274-17290 在 AI() :16880 【之后】同循环体内：vector3=玩家本 tick 帧位移
    //   （Player 先于 Projectile 更新）,下移循环逐条 `numUpdates==0 &&
    //   oldPos[i]!=Zero → += vector3`（仅子步 A 补偿,玩家一 tick 内不动 ⇒ 两子步
    //   新压条目天然同帧）,随后 oldPos[0]=本子步 AI 末态。旧序「fixedUpdate 头
    //   补偿 → step 顶压上一子步末态」=子步 A 条目出生即落后一个玩家帧位移且
    //   永不补偿（探针 _bj686-zenith-trail-probe:飞行态 odd 条目 frameErr 全表
    //   −Δ/even 0、d 序列纯 ±Δ 交替、A2≈2Δ;静止 Δ=0 无症状）→ 条带直线连段
    //   （FinalFractalHelper.Draw 用 PrepareStrip,无平滑插值）渲染成波浪。
    const odx = this.owner.x - this.lastOwnerX, ody = this.owner.y - this.lastOwnerY;
    this.lastOwnerX = this.owner.x;
    this.lastOwnerY = this.owner.y;
    // ★interp 补偿相位快照（2026-10-15 用户实报「飞行挥天顶剑特效残影感;静止挥
    //  无」定谳）:整步平移（60Hz 大步）vs 插值相机（平滑）=拖尾带每步跳一个玩家
    //  位移——渲染期按 interpA 退回 (1−alpha)×最新步补偿（draw 内消费,见注）。
    //  每步覆盖（含 0——静止步补偿=0 退回 0=恒等）。★BJ686 重排后语义不变:
    //  仍=本 tick 施加于拖尾的玩家帧位移（子步 A 补偿量）,每 tick 一拍快照。
    this.lastCompX = odx;
    this.lastCompY = ody;
    this.step(game, odx, ody);   // 子步 A（numUpdates==0：TrailingMode 4 带补偿）
    this.step(game, 0, 0);       // 子步 B（numUpdates==-1：无补偿）
  }

  private step(game: GameHooks, compX = 0, compY = 0): void {
    if (this.counter === 0) game.playSfxFiles(['Item_169'], 1, this.cx, this.cy);   // :40439
    const spd = Math.hypot(this.vx, this.vy);
    const lv = ZenithSword.lerpV(900, 0, spd * 2);      // GetLerpValue(900,0,|vel|×2)
    this.counter += 0.7 + (2 - 0.7) * lv;               // Lerp(0.7,2,lv)
    if (this.counter >= 120) {
      // :43923-43926 Kill() 早退（本子步位置未更新）——但 Update 循环体拖尾段
      // :17197 在 AI/Damage 之后照跑:仍压未动末态（子步 B 死亡时同拍再压一次）
      this.commitTrail(compX, compY);
      this.dead = true;
      return;
    }
    const phase = ZenithSword.lerpV(0, 1, this.counter / 60);
    const va = Math.atan2(this.vy, this.vx);
    const num6 = this.vx > 0 ? 1 : -1;
    const num7 = Math.PI + num6 * phase * Math.PI * 2;
    let num8 = spd + ZenithSword.lerpV(0.5, 1, phase) * 40;
    if (num8 < 60) num8 = 60;
    // 锚点 = MountedCenter + vel（随玩家移动——:40466）
    const ax = this.owner.cx + this.vx, ay = this.owner.cy + this.vy;
    // 椭圆轨道（:40474-40478）+ 起始回拉（vector3 :40479-40480）
    const spinX = Math.cos(num7) * num8;
    const spinY = Math.sin(num7) * this.ai0 * (2 + (1 - 2) * lv);
    const ca = Math.cos(va), sa = Math.sin(va);
    const pull = (1 - ZenithSword.lerpV(0, 0.5, phase));
    const pullX = pull * num6 * -num8 * 0.1;
    const pullY = pull * -this.ai0 * 0.3;
    this.x = ax + (ca * spinX - sa * spinY) + pullX - this.w / 2;
    this.y = ay + (sa * spinX + ca * spinY) + pullY - this.h / 2;
    this.rot = num7 + va + Math.PI / 2;
    this.spriteDir = this.vx > 0 ? 1 : -1;
    if (this.ai0 < 0) {
      this.rot = Math.PI + num6 * phase * (-Math.PI * 2) + va + Math.PI / 2;   // 反旋（:40488-40494）
      this.spriteDir = this.vx > 0 ? -1 : 1;
    }
    this.opacity = ZenithSword.lerpV(0, 5, this.counter) * ZenithSword.lerpV(120, 115, this.counter);
    // 剑刃线 CutTiles（Projectile.CutTiles :11824/:14115——瓦罐/杂草等 tileCut 物
    // 随剑刃扫过砍断）：沿刃轴向（rot−π/2）中心±40 逐格 game.cutTile，与 bladeHits
    // 判定线同源。曾漏接 = 天顶剑穿过瓦罐不碎（用户实报 2026-09-01）。
    {
      const dxc = Math.cos(this.rot - Math.PI / 2), dyc = Math.sin(this.rot - Math.PI / 2);
      for (const off of [-40, -13, 13, 40]) {
        const tx = Math.floor((this.cx + dxc * off) / 16);
        const ty = Math.floor((this.cy + dyc * off) / 16);
        if (Number.isFinite(tx) && Number.isFinite(ty)) game.cutTile?.(tx, ty);
      }
    }
    const prof = fractalProfile(this.ai1);
    // 光照（:40493-40496，num2<1 门 :40478）：Center 点 trailColor×0.5×Opacity +
    // MountedCenter 点 Lerp(Vector3.One, trailColor, 0.7)×Opacity×0.15（后者每剑
    // 叠加——齐射时玩家侧聚成暖白光晕）
    if (phase < 1) {
      this.lightRGB = [prof.color[0] / 255 * 0.5 * this.opacity, prof.color[1] / 255 * 0.5 * this.opacity, prof.color[2] / 255 * 0.5 * this.opacity];
      game.addLightAt?.(this.owner.cx, this.owner.cy,
        (1 + (prof.color[0] / 255 - 1) * 0.7) * this.opacity * 0.15,
        (1 + (prof.color[1] / 255 - 1) * 0.7) * this.opacity * 0.15,
        (1 + (prof.color[2] / 255 - 1) * 0.7) * this.opacity * 0.15);
    } else {
      this.lightRGB = null;
    }
    // 拖尾尘（:40480-40492 调用点 → StripDust :38-52）：每 update num11 次独立掷
    // Next(9)==0，命中出 Next(1,4)=1-3 粒尘 278（Dust.NewDustPerfect：alpha 100、
    // color=Lerp(trailColor,White,rand×0.3)、scale 0.4、fadeIn 0.4+rand×0.3、
    // noGravity、velocity += (rot−π/2+π/2·spriteDir)向×(3+rand×4)）；
    // 位置 = Center + 刃向×trailWidth×Lerp(0.5,1,rand)（刃中段→刃尖）
    if (phase < 1) {
      let num11 = 1 + Math.floor(spd / 100);
      num11 = Math.floor(num11 * ZenithSword.lerpV(0, 0.5, phase) * ZenithSword.lerpV(1, 0.5, phase));
      if (num11 < 1) num11 = 1;
      const bdx = Math.cos(this.rot - Math.PI / 2), bdy = Math.sin(this.rot - Math.PI / 2);
      const dist = (prof.len / 2) * (0.5 + Math.random() * 0.5);
      const px = this.cx + bdx * dist, py = this.cy + bdy * dist;
      for (let i = 0; i < num11; i++) {
        if (Math.floor(Math.random() * 9) !== 0) continue;      // Next(9)==0（1/9）
        const dAng = this.rot - Math.PI / 2 + Math.PI / 2 * this.spriteDir;
        for (let k = 0, cnt = 1 + Math.floor(Math.random() * 3); k < cnt; k++) {
          const wf = Math.random() * 0.3;   // Color.Lerp(trailColor, White, rand×0.3)
          // spawn() 对 w=0 的盒内散布退化为确定 +4（(rand×1|0)+4）→ 传 −4 抵消
          const d = game.spawnDust?.(px - 4, py - 4, 0, 0, 278, 0, 0, 100,
            {
              r: Math.round(prof.color[0] + (255 - prof.color[0]) * wf),
              g: Math.round(prof.color[1] + (255 - prof.color[1]) * wf),
              b: Math.round(prof.color[2] + (255 - prof.color[2]) * wf),
              a: 255,
            }, 0.4, true);
          if (!d) break;
          d.scale = 0.4;
          d.fadeIn = 0.4 + Math.random() * 0.3;
          const dsp = 3 + Math.random() * 4;   // velocity += dir×(3+rand×4)（覆写池抖动）
          d.vx = Math.cos(dAng) * dsp;
          d.vy = Math.sin(dAng) * dsp;
        }
      }
    }
    // 命中：lance 线形判定（Projectile.cs:14333-14363）——当前刃线 ±40 厚 20 +
    // 拖尾采样点（每 15 update：i=14/29/44/59，counter−i∈[0,60] 才激活）；
    // usesLocalNPCImmunity + localNPCHitCooldown=15/MaxUpdates=7（:8587）
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    for (const ent of game.enemies()) {
      // Critter 同伤（原版 critters 即 NPC：弹幕可伤小动物——ZenithSword 曾漏桶）。
      // 走 canonical hitCritters（projTargets）：饰品 dontHurtCritters/MinionShot/
      // 敌对弹面门全齐；self 盒按刃线放大（中心±40 沿刃向,厚 20——与 bladeHits 同域）
      {
        const dxc = Math.cos(this.rot - Math.PI / 2), dyc = Math.sin(this.rot - Math.PI / 2);
        hitCritters(
          { x: this.cx - 40 * Math.abs(dxc) - 10, y: this.cy - 40 * Math.abs(dyc) - 10,
            w: 80 * Math.abs(dxc) + 20, h: 80 * Math.abs(dyc) + 20 },
          game);
      }
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || (this.hitCd.get(e.id) ?? 0) > 0) continue;
      if (!this.bladeHits(e.x, e.y, e.w, e.h)) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,933 melee 旗）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // Main.DamageVar ±15% 浮动——★SW-T1 2026-09-04：单源 damageVarRoll（31 档离散
      //  +float32 域+ToEven+luck 重掷;原连续因子内联式退役）。消费面=933 终弹命中 →
      //  Damage_PVE_Inner :12970 `Main.DamageVar(num15, owner.luck)` luck 正向。
      //  crit ×2 维持仓内调用侧预倍（Enemy.hurt :13264 备案的既有位次,并行会话领走）
      // ★S02(BJ723-B):DV 掷基数复位未翻倍值（原版 :12970 掷 num15=crit 无关）+
      //  crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)——旧「DV(×2 基)」中点档 ±1 偏差销账
      const dmg = Math.max(1, damageVarRoll(this.damage, game.player?.luck ?? 0));
      // ★F3 接线（蓝队四轮）④：天顶剑终弹 933（数据面 melee）——双支同序；加伤随暴击并入
      const snapBonusZenith = projectileSnapStrikeBonus(game,
        { projId: 933 }, (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg), this.spriteDir * this.knockback, 0, game, this.armorPen, crit, 0, true);   // fromPlayer=DPS 计
      this.hitCd.set(e.id, 7);
    }
    // ★BJ729-A（D1 B20d,2026-10-27）：城镇 voodoo 靶——933 friendly 终弹巫毒窄门;
    //  collide 镜像敌怪臂刃线几何（bladeHits ±40 厚 20）;settle 镜像（DV+crit 掷
    //  melee/kb=spriteDir×knockback）;7t 窗由 TownNPC.hurt iframes 承载。
    hitTownNpcs(this, game, this.damage, this.spriteDir * this.knockback, 'playerProj', 933,
      (tn) => this.bladeHits(tn.x, tn.y, tn.w, tn.h),
      undefined, undefined, undefined,
      () => ({ dmg: damageVarRoll(this.damage, game.player?.luck ?? 0),
        crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }));
    // TrailingMode 4 提交（:17197 块=AI :16880 与 Damage :17184 之【后】——
    // 命中采样读压栈前旧环,与原版 Damage 内 oldPos 读序一致）
    this.commitTrail(compX, compY);
  }

  /** TrailingMode 4 拖尾环提交（:17274-17290 逐字结构）：先整条 += 玩家帧位移
   *  （compX/compY 仅子步 A 非 0=numUpdates==0 语义;`oldPos[i]!=Vector2.Zero`
   *  跳过条件在本环=只含已写条目,天然满足）,再压本子步 AI 末态 oldPos[0]=
   *  position/oldRot[0]/oldSpriteDirection[0]。★BJ686:补偿与压栈同块 interleaved
   *  是均匀性关键——子步 A 补偿覆盖「上一子步及更老」条目,两新条目同帧出生。 */
  private commitTrail(compX: number, compY: number): void {
    if (compX !== 0 || compY !== 0) {
      for (let i = 0; i < this.trail.length; i += 3) { this.trail[i] += compX; this.trail[i + 1] += compY; }
    }
    this.trail.push(this.cx, this.cy, this.rot);
    if (this.trail.length > 60 * 3) this.trail.splice(0, this.trail.length - 60 * 3);
    this.trailDirs.push(this.spriteDir);
    if (this.trailDirs.length > 60) this.trailDirs.splice(0, this.trailDirs.length - 60);
  }

  /** Collision.CheckAABBvLineCollision 六参全式 1:1（1458 Collision.cs:275-371）——
   *  台账批 B：刃线命中由“膨胀 AABB+Liang-Barsky 胶囊裁剪”近似换原式：
   *   · 先取线段 AABB（沿长两端各外扩 lineWidth/2）与目标盒粗测（:300 AABB 门）；
   *   · 目标盒四角旋转到线空间（−atan2(lineDir) :308-317），四角入带判定
   *     |Y|<halfWidth 且 X∈[0,len]（:320-327）；
   *   · 四边与上下轨 (0,±hw)-(len,±hw) 的段交穷举（:332-369，任一相交即真）。
   *  与胶囊近似的差异在端部几何（矩形直角端 vs 圆帽），±10px 尖锋擦碰判定对齐。 */
  private static segHitsRectVanilla(x1: number, y1: number, x2: number, y2: number,
    rx: number, ry: number, rw: number, rh: number, lineWidth: number): boolean {
    const hw = lineWidth * 0.5;
    // 线段外包盒（按轴向正负分别外扩半宽,:280-299）
    let bx = x1, bw = x2 - x1;
    if (bw > 0) { bx -= hw; bw += lineWidth; }
    else { bx += bw - hw; bw = -bw + lineWidth; }
    let by = y1, bh = y2 - y1;
    if (bh > 0) { by -= hw; bh += lineWidth; }
    else { by += bh - hw; bh = -bh + lineWidth; }
    // CheckAABBvAABBCollision（Collision.cs:2368-2377）
    if (!(bx < rx + rw && by < ry + rh && bx + bw > rx && by + bh > ry)) return false;
    // 目标盒四角旋转到线空间
    const dxl = x2 - x1, dyl = y2 - y1;
    const len = Math.hypot(dxl, dyl);
    const ang = Math.atan2(dyl, dxl);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    const rot = (qx: number, qy: number): [number, number] => {
      const ax = qx - x1, ay = qy - y1;
      return [ax * c - ay * s, ax * s + ay * c];
    };
    const corners: Array<[number, number]> = [
      rot(rx, ry), rot(rx, ry + rh), rot(rx + rw, ry + rh), rot(rx + rw, ry),
    ];
    // :320-327 角点入带
    let result = false;
    for (const [px, py] of corners) {
      if (Math.abs(py) < hw && px < len && px >= 0) { result = true; break; }
    }
    if (result) return true;
    // :332-369 四边 vs 上下轨段交（XNA Vector2 叉积同构）
    const railTest = (
      eA: [number, number], eB: [number, number],
      rA: [number, number], rB: [number, number],
    ): boolean => {
      const rvx = rB[0] - rA[0], rvy = rB[1] - rA[1];
      const evx = eB[0] - eA[0], evy = eB[1] - eA[1];
      const den = rvx * evy - rvy * evx;
      if (den === 0) return false;
      const s1 = ((eA[0] - rA[0]) * evy - (eA[1] - rA[1]) * evx) / den;
      if (s1 < 0 || s1 > 1) return false;
      const s2 = ((eA[0] - rA[0]) * rvy - (eA[1] - rA[1]) * rvx) / den;
      return !(s2 < 0 || s2 > 1);
    };
    const rails: Array<[[number, number], [number, number]]> = [
      [[0, hw], [len, hw]],          // vector3→vector4(:328-329)
      [[0, -hw], [len, -hw]],        // vector5→vector6(:330-331)
    ];
    for (let j = 0; j < 4; j++) {
      const eA = corners[j], eB = corners[(j + 1) % 4];
      if (railTest(eA, eB, rails[0][0], rails[0][1])) return true;
      if (railTest(eA, eB, rails[1][0], rails[1][1])) return true;
    }
    return result;
  }

  /** 刃线判定 1:1（Projectile.Colliding type 933/1100 分支 :15626-15660）：
   *  每采样位先 _lanceHitboxBounds（Projectile.cs:498 静态 300×300）过靶门再进
   *  CheckAABBvLineCollision(tgtRect.TopLeft, tgtRect.Size, lineStart, lineEnd,
   *  lineWidth=20)。旧版本无 300×300 前置闸。 */
  private bladeHits(ex: number, ey: number, ew: number, eh: number): boolean {
    const lineAt = (cx: number, cy: number, rot: number): boolean => {
      // _lanceHitboxBounds 300×300 过靶门（:15641-15643/:15654-15656 同式）
      const gateHalf = 150;
      if (ex >= cx + gateHalf || ex + ew <= cx - gateHalf
        || ey >= cy + gateHalf || ey + eh <= cy - gateHalf) return false;
      const dx = Math.cos(rot + Math.PI / 2), dy = Math.sin(rot + Math.PI / 2);
      return ZenithSword.segHitsRectVanilla(cx - dx * 40, cy - dy * 40, cx + dx * 40, cy + dy * 40,
        ex, ey, ew, eh, 20);
    };
    if (lineAt(this.cx, this.cy, this.rot)) return true;
    // oldPos[i]（i update 前）= trail 尾起倒数第 i 条（条目 0=最新）
    for (let i = 14; i < 60; i += 15) {
      const age = this.counter - i;
      if (age < 0 || age > 60) continue;
      const idx = this.trail.length - 3 * (i + 1);
      if (idx < 0) continue;
      if (lineAt(this.trail[idx], this.trail[idx + 1], this.trail[idx + 2])) return true;
    }
    return false;
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; atlas?: unknown }): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const prof = fractalProfile(this.ai1);
    // ★SW-FX24 定谳（BJ56 移交疑点）：hw 公式无罪、欠宽在表值。
    //  反编译半宽链（1457）：FinalFractalHelper.cs:29 trailWidth=fullBladeLength/2
    //  → :62-65 StripWidth 恒返 trailWidth → VertexStrip.cs:156-158 把 widthFunction
    //  返回值【直接】当两侧偏移（v=pos±(rot−π/2)·num，无二次除 2）⇒ 半宽=len/2。
    //  家族对照：Terraprisma 946 EmpressBladeDrawer.cs:40-43 StripWidth 裸返 36f，
    //  本仓 MinionProj.ts hw:36 同构 1:1。BJ56「应为半宽 50」系把构造参 fullBladeLength
    //  (50) 误当 widthFunction 返回值——实际返回 trailWidth=25，default 档全宽 50=参数原值。
    //  恒宽（沿程无宽度变化）：:62-65 [1457]（旧注 :61-64 系 1456 行号）。
    const tw = prof.len / 2;
    // ★interp 补偿相位退回（2026-10-15）:trail 数组=最新一步末的整步补偿态
    //  （fixedUpdate 里全体 += 本步玩家位移）——插值相机下渲染位应=上步末态+
    //  整步Δ×alpha ⇔ 当前态−Δ×(1−alpha)。r=Renderer 实例（实体绘制分发
    //  ee.draw(this,cam)）;interpA=−1（旗关/暂停帧）或补偿未步进（NaN）=零退回
    //  =逐位旧行为。本体 cx/cy 已在实体插值域（无需退回）;hitbox 的 lineAt 消费
    //  在 fixedUpdate 域=物理位不退回 ✓。
    const iA = (r as { interpA?: number }).interpA ?? -1;
    const compOK = iA >= 0 && Number.isFinite(this.lastCompX);
    const cbx = compOK ? this.lastCompX * (1 - iA) : 0;
    const cby = compOK ? this.lastCompY * (1 - iA) : 0;
    const icon = (r.atlas as unknown as { vicon?: (id: number) => { img: ImageBitmap | HTMLImageElement; sx: number; sy: number; sw: number; sh: number } | null } | undefined)?.vicon?.(this.ai1) ?? null;
    // 本体淡入淡出包络（:30799-30801 num182 与 :30840 num186 同式同参 t=localAI[0]）
    const num182 = ZenithSword.lerpV(0, 20, this.counter) * ZenithSword.lerpV(68, 60, this.counter);
    const n = this.trail.length / 3;

    // ---- ① 彩带拖尾（FinalFractalHelper.Draw :176-192 [1457]）----
    // ★2026-08-30 GL 化改约：原"平色四边形双 pass + CPU 像素叠层"两段合成整体移除
    // ——原版只有【一次】PS 条带绘制，平色底条系近似期产物（与真值叠成大团色块，
    // 用户实报截图）；CPU 像素循环又是卡顿本体。现在 drawStripTrail 内部自动走
    // GLSpriteLayer 拖尾 pass（GLSpriteLayer.ts 尾部 TRAIL_VS/FS——obj58 逐指令
    // 1:1），主 ctx 每帧单次合成；GL 不可用时其内部退化 CPU 版仍可用。
    if (n >= 2) {
      if (r.atlas) {
        // ★顶点色=原版 StripColors（FinalFractalHelper.cs:54-59）逐字：
        //   rgb = trailColor×fade、a = trailColor.A/2×fade（Color×float 四通道同乘
        //   后 A/=2）——曾 rgb 不乘 fade、a 不减半 = 条带沿程不衰减且 alpha 翻倍。
        //   ★点集不裁剪（原版 positions 循环只在 Vector2.Zero 处停，:59）；progress
        //   分母钉 59（PrepareStrip 第 6 参 expectedVertexPairsAmount=oldPos.Length=60，
        //   VertexStrip.cs:55-63——与实际点数无关，幼剑条带只到 p=(n−1)/59）。
        const ptsFS: Array<{ x: number; y: number; hw: number; rot: number; r: number; g: number; b: number; a: number }> = [];
        for (let i = n - 1; i >= 1; i--) {
          const f = fractalStripFade((n - 0.5 - i) / (60 - 1));
          ptsFS.push({ x: this.trail[i * 3] - cbx, y: this.trail[i * 3 + 1] - cby, hw: tw,
            rot: this.trail[i * 3 + 2],
            r: prof.color[0] / 255 * f, g: prof.color[1] / 255 * f, b: prof.color[2] / 255 * f, a: f * 0.5 });
        }
        if (ptsFS.length >= 2) {
          try {
            const spec = { set: 'FinalFractal' as never, pts: ptsFS, opacity: 1, expectedPairs: 60,
              time: performance.now() / 1000, zigzag: 0.5 };
            // ★2026-09-03 黑椭圆止血：入全亮队列（flushTrailShade 合成后直绘主画布/
            // GL 上屏同 flush 时序——GL 层渲入仍发生在 drawStripTrail 内,队列化只改
            // 执行时机）;mock 无队列方法回退直绘
            const rr = r as unknown as Parameters<typeof drawStripTrail>[1] & { queueTrailShade?: (sp: typeof spec) => void };
            if (typeof rr.queueTrailShade === 'function') rr.queueTrailShade(spec);
            else drawStripTrail(ctx, rr, spec);
          } catch { /* atlas 未就绪静默 */ }
        }
      }
    }

    // ---- 贴图绘制原语（:29945-29953：LoadItem(ai[1])、Frame() 全幅、origin=中心、
    // 基角 −π/4×【当前】spriteDir 加进旋转；镜像=局部系 scale(−1,1)（XNA Flip源
    // 矩形后旋转 = canvas 先 rotate 后镜像），刀尖恒指 (rot−π/2) 向）----
    // ★BJ-C1 F3：目标 ctx 参数化（本体面 ②③④⑤ 按常量色族改道全亮队列重放）
    const drawIcon = (c: CanvasRenderingContext2D, x: number, y: number, rot: number, mirror: boolean, scale: number, alpha: number, additive = false) => {
      if (alpha <= 0.01) return;
      c.save();
      c.imageSmoothingEnabled = false;
      if (additive) c.globalCompositeOperation = 'lighter';
      c.globalAlpha = Math.max(0, Math.min(1, alpha));
      c.translate(x, y);
      c.rotate(rot);
      if (mirror) c.scale(-1, 1);
      if (icon) {
        const dw = icon.sw * scale, dh = icon.sh * scale;
        c.drawImage(icon.img, icon.sx, icon.sy, icon.sw, icon.sh, -dw / 2, -dh / 2, dw, dh);
      } else {
        c.fillStyle = `rgb(${prof.color[0]},${prof.color[1]},${prof.color[2]})`;
        c.fillRect(-16 * scale, -16 * scale, 32 * scale, 32 * scale);
      }
      c.restore();
    };

    // ★BJ-C1 F3（2026-10-06,代表判别站）：933 天顶剑弹面=fade2 常量族
    //  （GetAlpha :80718-80721 `933||1001||1100 → newColor=Color.White*Opacity` 落
    //  缺省尾,newColor 已被替换=不读格光色;①彩带已走 queueTrailShade 全亮域）——
    //  ②③④⑤ 本体/残影/叠绘/星芒旧画实体层被 compositeLight 全屏乘光压暗（暗处
    //  剑身消失,BJ529 探针 k=0.325 同病域）→ 封包 paint 改道 projFullbrightQueue
    //  （7f 光照合成后主画布 source-over/'lighter' 逐式重放=原版逐字）。层序=
    //  玩家之上（270/45/BJ504 同槽惯例,登记）。无队列环境（测试）直画原路径。
    const paint = (c: CanvasRenderingContext2D): void => {
    // ---- ② 白残影 ×3（:30381 循环 + :30174-30181 933 档：num156=60、num154=0、
    // num155=−15 → num159∈{60,45,30,15}；60 ≥ oldPos.Length=60 越界跳过 :30383）。
    // 色（:30606-30611，替换通用乘子）：White × GetLerpValue(0,60,60−num159) ×
    // Opacity × num170(counter−num159)（rgb:alpha=1:1 单 pass）；旋转 = oldRot +
    // (−π/4×当前 spriteDir)（:30614 num152 取现值）；镜像 = 历史与当前
    // spriteDirection 异号（:30572-30577 XOR）；scale = Lerp(1,1,·)=1 ----
    for (let num159 = 60; num159 > 0; num159 -= 15) {
      if (num159 >= 60) continue;
      const j = n - 1 - num159;
      if (j < 0) continue;
      drawIcon(c, this.trail[j * 3] - cbx, this.trail[j * 3 + 1] - cby,   // ★interp 补偿退回（见 draw 头注）
        this.trail[j * 3 + 2] - Math.PI / 4 * this.spriteDir,
        (this.trailDirs[j] === -1) !== (this.spriteDir === -1), 1,
        fractalGhostAlpha(this.counter, num159, this.opacity));
    }
    // ---- ③ 本体（:30761-30803）：GetAlpha(:76047-76050)=White×Opacity ×num182
    // （rgb:alpha=1:1 → 单 pass source-over，不受场景光照染色的全亮白）----
    drawIcon(c, this.cx, this.cy, this.rot - Math.PI / 4 * this.spriteDir, this.spriteDir === -1,
      1, this.opacity * num182);
    // ---- ④ 1.25× 白叠绘（:30839-30841）：色 (255,255,255,127)×Opacity×num186——
    // 预乘 rgb:alpha = 255:127 → 两 pass：source-over α=(127/255)·ov（覆盖）
    // + lighter α=(128/255)·ov（加色）＝ rgb×ov 全量、背景衰减仅 (127/255)·ov ----
    const ov = this.opacity * num182;
    drawIcon(c, this.cx, this.cy, this.rot - Math.PI / 4 * this.spriteDir, this.spriteDir === -1,
      1.25, 127 / 255 * ov);
    drawIcon(c, this.cx, this.cy, this.rot - Math.PI / 4 * this.spriteDir, this.spriteDir === -1,
      1.25, 128 / 255 * ov, true);
    // ---- ⑤ 刃尖星芒（1457 Main.cs:31620）：DrawPrettyStarSparkle(Opacity, dir, Center+
    // (rot−π/2)向×trailWidth, White×num197, trailColor(A/2)×num197, localAI[0],
    // 15,30,30,45, 0, (5,2), (1,1))——15-45 counter 窗内十字星芒
    // （num197 = GetLerpValue(0,20,t)×GetLerpValue(68,60,t) = 本档 num182，draw=White/
    //   shine=trailColor 与原版实参序一致——2026-09-02 黑十字案复核勘误,原注 num186 系笔误）----
    if (this.opacity > 0.01 && num182 > 0.01) {
      prettyStarSparkle(c, this.opacity,
        this.cx + Math.cos(this.rot - Math.PI / 2) * tw,
        this.cy + Math.sin(this.rot - Math.PI / 2) * tw,
        [255, 255, 255], prof.color, this.counter,
        15, 30, 30, 45, 0, [5, 2], [1, 1], num182, num182);
    }
    };
    const fbSink = (r as unknown as {
      queueProjFullbright?: (fn: (fn2: CanvasRenderingContext2D) => void) => void;
    }).queueProjFullbright;
    // ★天顶剑崩溃修（2026-10-07 用户实报）：方法引用裸调丢 this（严格模式 undefined）
    //  → this.projFullbrightQueue 抛错=帧循环停机。必须经宿主对象调用（this=r）。
    if (typeof fbSink === 'function') { (r as unknown as { queueProjFullbright: (fn: (fn2: CanvasRenderingContext2D) => void) => void }).queueProjFullbright(paint); return; }
    paint(ctx);
  }
}

/** 魔光剑斩痕 974（AI_188_LightsBane :39558-39591 + DrawProj_LightsBane :27356）：
 *  出生（Player.cs:48242-48264）：生成在【瞄准搜索点】（MountedCenter+(70,−40)×Directions
 *  ±20px 散布，或 ZenithTarget 50px 内敌人身上）；vel=方向载波×0.001（不位移）；
 *  ai[0]=1（暴击掷中 Next(100)<meleeCrit → 2 且 Damage×2——暴击折进斩痕）；
 *  Damage×0.5。AI：首帧 Item60×0.15×ai0；scale=ai0；3t/帧 ×12 帧=36t 消亡；
 *  rotation=vel 角；尘 278 沿 ±46×scale 扫线（num2=Remap(t/36×4,0,1) 包络）。
 *  绘制：Frame(1,13)（171×702=13 帧 54px）本体帧 ×0.7×scale + 帧 12 辉光两遍
 *  （(1,6)/(2,2)×vector2、white×0.3×num、multiply blend→lighter 近似）。 */
export class LightsBaneSlash extends Entity {
  w = 20; h = 20;
  damage: number;
  ai0: number;
  private t = 0;
  private frame = 0;
  private frameCtr = 0;
  private rot = 0;
  private dirX: number; private dirY: number;
  private hitCd = new Map<number, number>();
  /** ★BJ486③ vanilla 弹 id（SetDefaults 974 :9239 melee=true）——rollVanillaHitCrit 锚 */
  readonly projId = 974;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  lightRGB: [number, number, number] | null = [0.2, 0, 0.5];

  constructor(x: number, y: number, dirX: number, dirY: number, damage: number, ai0: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.dirX = dirX; this.dirY = dirY;
    this.damage = damage;
    this.ai0 = ai0;
    this.rot = Math.atan2(dirY, dirX);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.t++;
    if (this.t === 1) game.playSfxFiles(['Item_60'], 0.15 * this.ai0, this.cx, this.cy);
    if (++this.frameCtr >= 3) {
      this.frameCtr = 0;
      if (++this.frame >= 12) { this.dead = true; return; }
    }
    // 尘 278 扫线（:39580-39590：t/36×4 包络 ×0.7）
    const num2 = this.t / 36 * 4;
    if (num2 >= 0 && num2 <= 1 && Math.random() < 0.5) {
      const k = Math.random();
      game.spawnParticles(
        (this.cx - this.dirX * 46 * this.ai0) * (1 - k) + (this.cx + this.dirX * 46 * this.ai0) * k,
        (this.cy - this.dirY * 46 * this.ai0) * (1 - k) + (this.cy + this.dirY * 46 * this.ai0) * k,
        '#8C3CE8', 1, 1.2, { life: 20 });
    }
    // 命中（穿透 2 + 10t 免疫）
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || (this.hitCd.get(e.id) ?? 0) > 0) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,974 melee 旗）。
      //  （出生拍 ai0 折叠掷在 Game.ts 974 分支——Player.cs:49369-49377 双掷面并存
      //  =原版同相,勿合并。）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;   // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // ★F3 接线（蓝队四轮）⑤：魔光剑斩痕 974（数据面 melee）——双支同序
      const snapBonusLb = projectileSnapStrikeBonus(game,
        { projId: 974 }, (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg), Math.sign(this.dirX) * 6.5, 0, game, this.armorPen, crit, 0, true);   // fromPlayer=DPS 计
      this.hitCd.set(e.id, 10);
    }
    // ★BJ729-A（D1 B20e,2026-10-27）：城镇 voodoo 靶——974 friendly 弹巫毒窄门
    //  （:12618-12631）;AABB 自盒;settle 镜像（crit 掷 melee/kb=sign(dirX)×6.5）;
    //  10t 窗由 TownNPC.hurt iframes 承载。
    hitTownNpcs(this, game, this.damage, Math.sign(this.dirX) * 6.5, 'playerProj', 974,
      undefined, undefined, undefined, undefined,
      () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }));
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(974);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const fw = img.width, fh = img.height / 13;
    const sc = 0.7 * this.ai0;
    // num = Remap(frame,0,3,0,1)×Remap(frame,4,12,1,0)（辉光包络）
    const n = Math.min(1, Math.max(0, this.frame / 3)) * (this.frame <= 4 ? 1 : Math.max(0, (12 - this.frame) / 8));
    const pass = (frame: number, sx: number, sy: number, alpha: number, additive: boolean) => {
      if (alpha <= 0.02) return;
      ctx.save();
      if (additive) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.translate(this.cx, this.cy);
      ctx.rotate(this.rot);
      ctx.drawImage(img, 0, frame * fh, fw, fh, -fw * sx * sc / 2, -fh * sy * sc / 2, fw * sx * sc, fh * sy * sc);
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };
    ctx.imageSmoothingEnabled = false;
    pass(12, 1, 6, 0.3 * n, true);   // 辉光 (1,6)×vector2（multiply→lighter 近似）
    pass(12, 2, 2, 0.3 * n, true);   // 辉光 (2,2)×vector2
    pass(this.frame, 1, 1, 1, false); // 本体帧（原版 ×4 遍合并为一遍）
  }
}

/** 草剑飞叶 976（AI_152_SuperStarSlash :20872-20995 的 976 分支 + 绘制 :30059）：
 *  出生（Player.cs:48318-48361）：弧线搜索（ZenithTarget 150px→敌人盒内随机点，否则
 *  ±20px 散布）；起=玩家中心随机半宽；ai[0]=每 tick 旋转量（num178/60）、
 *  ai[1]=弧步数；Damage×0.25。AI：vel=vel.RotatedBy(ai0) 弧线飞行；
 *  速度 = 4+12×(1−num6)（num6 = Remap(60−timeLeft,…)—**timeLeft 默认 3600 恒负 →
 *  num6=0 恒 16px/t**——原版 1.4.5.6 实际行为，忠实移植勿"修"）；2t/帧 ×7 帧循环；
 *  rotation=vel 角；tileCollide=false 穿墙；岩浆即亡；timeLeft 3600（远射程飞叶）。 */
export class GrassSlash extends Entity {
  w = 20; h = 20;
  damage: number;
  private ai0: number;
  private frame = 0;
  private frameCtr = 0;
  private life = 3600;
  private rot = 0;
  private first = true;
  private hitCd = new Map<number, number>();
  /** ★BJ486③ vanilla 弹 id（SetDefaults 976 :9272 melee=true）——rollVanillaHitCrit 锚 */
  readonly projId = 976;
  critChance = 0.04;
  armorPen = 0;
  dead = false;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, ai0: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.ai0 = ai0;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (--this.life <= 0) { this.dead = true; return; }
    // 弧线（:20927-20930：vel.RotatedBy(ai0)）
    const c = Math.cos(this.ai0), s = Math.sin(this.ai0);
    const nvx = this.vx * c - this.vy * s, nvy = this.vx * s + this.vy * c;
    this.vx = nvx; this.vy = nvy;
    // 帧循环（2t/帧 ×7）
    if (++this.frameCtr >= 2) { this.frameCtr = 0; if (++this.frame >= 7) this.frame = 0; }
    // 恒速 16（num6=0：60−timeLeft 在 timeLeft=3600 下恒负 → Remap 钳 0——原版最终态）
    const sp = Math.hypot(this.vx, this.vy) || 1;
    this.vx = this.vx / sp * 16; this.vy = this.vy / sp * 16;
    this.rot = Math.atan2(this.vy, this.vx);
    this.x += this.vx; this.y += this.vy;
    // 岩浆即亡（:20953-20956）+ 出界
    const st = game.world.store;
    const cxT = Math.floor(this.cx / 16), cyT = Math.floor(this.cy / 16);
    if (!st.inBounds(cxT, cyT)) { this.dead = true; return; }
    if (st.liquidType[st.idx(cxT, cyT)] === 2) { this.dead = true; return; }
    // 尘 40 拖尾（1/3）+ 首帧 10 粒爆发
    if (this.first) {
      this.first = false;
      for (let i = 0; i < 10; i++) game.spawnParticles(this.cx, this.cy, '#7CE84A', 1, 1.5, { life: 22 });
    } else if (Math.random() < 1 / 3) {
      game.spawnParticles(this.cx, this.cy, '#7CE84A', 1, 1, { life: 18 });
    }
    // 命中（穿透 2 + 10t 免疫）
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || (this.hitCd.get(e.id) ?? 0) > 0) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,976 melee 旗）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;   // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // ★F3 接线（蓝队四轮）⑥：草剑飞叶 976（数据面 melee）——双支同序
      const snapBonusGrass = projectileSnapStrikeBonus(game,
        { projId: 976 }, (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusGrass ? snapBonusGrass : 0),
        Math.sign(this.vx) * 6.5, 0, game, this.armorPen, crit, 0, true);   // ★F1 旗乘区;★S02 ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      this.hitCd.set(e.id, 10);
    }
    // ★BJ729-A（D1 B20f,2026-10-27）：城镇 voodoo 靶——976 friendly 弹巫毒窄门;
    //  AABB 自盒;settle 镜像（crit 掷 melee/kb=sign(vx)×6.5）;10t 窗由
    //  TownNPC.hurt iframes 承载。
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 6.5, 'playerProj', 976,
      undefined, undefined, undefined, undefined,
      () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }));
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(976);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    // 帧 = (0, frame*20, 32, 18)（:30063-30067）×1.3
    const fw = 32, fh = 18;
    const dw = fw * 1.3, dh = fh * 1.3;
    ctx.drawImage(img, 0, this.frame * 20, fw, fh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
}

/** 南瓜弹出生屏外偏移（Player.HorsemansBlade_SpawnPumpkin Player.cs:42444-42456）：
 *  Main.MaxWorldViewSize = Point(1920,1200)（Main.cs:754-758），前段 rand(100,300)（:42449-42450）在
 *  `num + (x/2 − num)` / `num − (x/2 + num)` 两分支中均被整式消去 = 死值——
 *  实际偏移恒 ±960/±600（各轴独立 50/50），即玩家位 ± 半视口。 */
const PUMPKIN_VIEW_HALF_X = 1920 / 2;
const PUMPKIN_VIEW_HALF_Y = 1200 / 2;

/** 南瓜弹出生（HorsemansBlade_SpawnPumpkin Player.cs:42444-42462 1:1）：
 *  位 = 玩家 position + (±960, ±600)（:42451-42454）、初速 = normalize(目标心−出生点)×8（:42456-42461）、
 *  ai[0] = 目标 npcIndex（仓内 = 实体 id）、dmg/kb = 调用方透传。 */
export function spawnHorsemansPumpkin(
  game: GameHooks, targetId: number, tcx: number, tcy: number, dmg: number, kb: number,
): HorsemansPumpkin {
  const p = game.player;
  const sx = p.x + (Math.random() < 0.5 ? -1 : 1) * PUMPKIN_VIEW_HALF_X;   // :42451 x 轴塌缩
  const sy = p.y + (Math.random() < 0.5 ? -1 : 1) * PUMPKIN_VIEW_HALF_Y;   // :42452 y 轴塌缩、:42453-42454 加玩家位
  const dx = tcx - sx, dy = tcy - sy;
  const dl = Math.hypot(dx, dy) || 1;
  const sp = 8 / dl;                                                       // :42458-42461 num5=8f/num5
  const pumpkin = new HorsemansPumpkin(sx, sy, dx * sp, dy * sp, dmg, kb, targetId);
  (game as unknown as { entities: { add(e: HorsemansPumpkin, bucket: string): void } })
    .entities.add(pumpkin, 'projectiles');                                 // NewProjectile :42462
  return pumpkin;
}

/** 无头骑士剑南瓜弹 321（SetDefaults Projectile.cs:4141-4150 + AI_055 :29201-29274）：
 *  30×30、friendly、melee、tileCollide=false 穿墙、ignoreWater、penetrate 1、
 *  timeLeft 3600。AI：向 ai[0] 目标收敛 v=(v×14+dir×8)/15；目标失效 → 1000px
 *  曼哈顿 + CanHit 重锁（无则保持直飞——原版 Kill 门只挡 ai[0] 越界槽，恒不触发）；
 *  每拍尘 6（8px 内缩、vel×0.5+弹速×0.5、noGravity/noLight、scale1.4）；命中即亡 +
 *  Kill 特效（:77759-77773 Sound 10 + 2×20 尘 6 反速 ×2）。 */
export class HorsemansPumpkin extends Entity {
  w = 30; h = 30;
  damage: number;
  kb: number;
  /** ai[0] = 目标实体 id（原版 npcIndex） */
  ai0: number;
  /** ★BJ486③ vanilla 弹 id（SetDefaults 321 :9468 区 melee=true）——rollVanillaHitCrit 锚 */
  readonly projId = 321;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  private frame = 0;
  private frameCtr = 0;
  private life = 3600;
  private rot = 0;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, kb: number, targetId: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.kb = kb;
    this.ai0 = targetId;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (--this.life <= 0) { this.dead = true; return; }
    // 帧循环（:29203-29212 frameCounter>0 恒真 → 每拍 +1、>2 归 0）
    if (++this.frameCtr > 0) { this.frameCtr = 0; if (++this.frame > 2) this.frame = 0; }
    // 追踪/重锁（:29223-29269）
    const enemies = game.enemies() as Array<{
      id: number; x: number; y: number; w: number; h: number; dead: boolean;
    }>;
    const tgt = enemies.find((e) => e.id === this.ai0);
    if (tgt && !tgt.dead && canBeChasedBy(tgt)) {
      // CanBeChasedBy（:29227/:91141）追踪重锁索敌门（命中校验仍走下方 Damage_PVE 门）
      const dx = tgt.x + tgt.w / 2 - this.cx, dy = tgt.y + tgt.h / 2 - this.cy;
      const dl = Math.hypot(dx, dy) || 1;
      this.vx = (this.vx * 14 + dx / dl * 8) / 15;                          // :29229 num427=8f、:29238 收敛式
      this.vy = (this.vy * 14 + dy / dl * 8) / 15;
    } else {
      // 重锁（:29241-29257）：1000 曼哈顿内 Collision.CanHit 最近者
      let bd = 1000, bi = 0;
      for (const e of enemies) {
        if (!canBeChasedBy(e)) continue;
        const d = Math.abs(this.cx - (e.x + e.w / 2)) + Math.abs(this.cy - (e.y + e.h / 2));
        if (d >= bd) continue;
        if (!canHitLine(game.world.store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
        bd = d; bi = e.id;
      }
      if (bi !== 0) this.ai0 = bi;
    }
    // 朝向（:29213-29222：vx<0 → spriteDirection −1 + 反向 atan2；绘制侧 Y 翻转近似）
    this.rot = Math.atan2(this.vy, this.vx);
    // 尘 6（:29260-29268）
    const d = game.spawnDust?.(this.x + 8, this.y + 8, this.w - 16, this.h - 16, 6,
      this.vx * 0.5, this.vy * 0.5, 0, null, 1.4, true);
    if (d) { d.vx *= 0.5; d.vy *= 0.5; }
    this.x += this.vx; this.y += this.vy;
    // 命中（penetrate 1：首敌即亡；tileCollide=false 不撞块）
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, 321)) continue;   // friendly 门（Damage_PVE_Inner :11892）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,321 melee 旗）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;   // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // ★F3 接线（蓝队四轮）⑦：无头骑士南瓜弹 321（数据面 melee）——双支同序
      const snapBonusPumpkin = projectileSnapStrikeBonus(game,
        { projId: 321 }, (e as { cx?: number }).cx ?? e.x + e.w / 2, (e as { cy?: number }).cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: (e as { cx?: number }).cx ?? e.x + e.w / 2,
          cy: (e as { cy?: number }).cy ?? e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg), Math.sign(this.vx || 1) * this.kb, 0, game, this.armorPen, crit, 0, true);   // fromPlayer=DPS 计
      // Kill 特效（Projectile.cs:77759-77773：SoundID.Item10 + 2×20 尘 6 反速 ×2）
      game.playSfxFiles(['Item_10'], 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) {
        for (const sc of [2, 1]) {
          const kd = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
            -this.vx * 0.2, -this.vy * 0.2, 100, null, sc);
          if (kd) { kd.vx *= 2; kd.vy *= 2; }
        }
      }
      this.dead = true;
      break;
    }
    // ★BJ729-A（D1 B20g,2026-10-27）：城镇 voodoo 靶——321 friendly 弹巫毒窄门;
    //  AABB 自盒;settle 镜像（crit 掷 melee/kb=sign(vx||1)×kb）;penetrate 1 受理
    //  即亡（Kill 特效同敌怪支=弹体消亡面与 victim 类型无关）。
    if (hitTownNpcs(this, game, this.damage, Math.sign(this.vx || 1) * this.kb,
      'playerProj', 321, undefined, undefined, undefined, undefined,
      () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }))) {
      game.playSfxFiles(['Item_10'], 1, this.cx, this.cy);
      for (let i = 0; i < 20; i++) {
        for (const sc of [2, 1]) {
          const kd = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
            -this.vx * 0.2, -this.vy * 0.2, 100, null, sc);
          if (kd) { kd.vx *= 2; kd.vy *= 2; }
        }
      }
      this.dead = true;
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(321);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    if (this.vx < 0) ctx.scale(1, -1);                 // spriteDirection −1（:29212-29215）
    ctx.imageSmoothingEnabled = false;
    const fh = img.height / 3;                         // Main.projFrames[321]=3（AI frame 0-2）
    ctx.drawImage(img, 0, this.frame * fh, img.width, fh, -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
  }
}


/** ★L5 长尾批：真刃系挥弧命中编排分派（Projectile.Damage :12984-13031 ownedBySomeone 支——
 *  PositionInWorld=Main.rand.NextVector2FromRectangle(targetNPC.Hitbox)、MovementVector
 *  缺省零（case984|985 :13015 载 velocity）;clientOnly:false → 本地直生 + module8 上行。弹型映射：
 *  972→NightsEdge(10)/973→TrueNightsEdge(12)/982→Excalibur(13)/983→TrueExcalibur(14)/
 *  984|985→TerraBlade(15);997 无头骑士/976 草剑无编排面（vanilla 无对应 case）。
 *  ★δB1（2026-09-01）：MovementVector=弹体速度（1457/1458 Projectile.cs 同 :13015）——曾误传
 *  命中点 Y 的 (cos(hy),sin(hy))。锚弧支 vel=(direction,0) 恒定（Player.cs:49441 NewProjectile(
 *  MountedCenter,new Vector2(direction,0f),984…);AI_190 只读不改写 velocity:42749 num3=
 *  velocity.ToRotation()）→ 按朝向传 ±1;飞斩 972/973 支传实时 vx/vy（原版 Damage 时点读弹速）。 */
function swordTrailOrchestra(
  g: import('./types').GameHooks, projId: number,
  e: { x: number; y: number; w: number; h: number },
  mvX = 0, mvY = 0,
): void {
  const hx = e.x + Math.random() * e.w;
  const hy = e.y + Math.random() * e.h;
  switch (projId) {
    case 972:
      nightsEdgeFx(g, hx, hy);
      g.broadcastParticleOrchestra?.(ParticleOrchestraType.NightsEdge, hx, hy);
      break;
    case 973:
      trueNightsEdgeFx(g, hx, hy);
      g.broadcastParticleOrchestra?.(ParticleOrchestraType.TrueNightsEdge, hx, hy);
      break;
    case 982:
      excaliburFx(g, hx, hy);
      g.broadcastParticleOrchestra?.(ParticleOrchestraType.Excalibur, hx, hy);
      break;
    case 983:
      trueExcaliburFx(g, hx, hy);
      g.broadcastParticleOrchestra?.(ParticleOrchestraType.TrueExcalibur, hx, hy);
      break;
    case 984:
    case 985:
      // MovementVector=弹体速度（Projectile.cs:13015 settings.MovementVector=velocity）
      terraBladeFx(g, hx, hy, mvX, mvY);
      g.broadcastParticleOrchestra?.(ParticleOrchestraType.TerraBlade, hx, hy, mvX, mvY);
      break;
    default:
      break;
  }
}
