// 原版 GameShaders.Misc 拖尾族 shader 的 Canvas 复刻（全量 shader 审计战役·旗舰件）。
// 原版管线：VertexStrip(oldPos,oldRot)+GameShaders.Misc[技术名].Apply()。
//
// ★2026-08-30 反汇编终案（tools/disasm-fx.mjs ../terraria-assets/PixelShader.cso）：
// 先前版本把孤立 pass 'FinalFractal'（obj56，atan 极坐标版，属于另一未配对克隆）
// 当作用户像素公式；实际 C# 技术名（DyeInitializer.cs:475）="FinalFractalVertex"，
// 该技术包含【自己的 PS=obj58】（反汇编 :2808-2885），与 obj56 完全不同。obj58 仅
// 12 条指令、逐通道忠实转录如下（dsw=1/SSD.w 预着色器写入 c2.x；p=progressOnStrip；
// t0=(p, dist·across, dist)；v0=顶点色；SSD=(4,0,0,4) FinalFractalHelper.Draw :180）：
//   wEnv   = p×1.5 − 0.5                          （mad r0.w, t0, c3, c3.y）
//   ph     = p×SSD.x + SSD.y                      （mad r0.x, t0, c1, c1.y）
//   sfrac  = signPreserving(frc(|ph|))             （abs+frc+cmp → 只作 UV.x 输入）
//   dim    = ph×(−dswInv) + 1                     （mad r0.x, −c2——★锯齿链活的！
//                                                   旧 R33"死代码"结论基于错 pass）
//   across = t0.y / t0.z                          （rcp+mul：B 侧 0、A 侧 1）
//   gate   = tex(s1, (sfrac, across)).x           （s1=UseImage1=Extra_193 出手侧）
//   blade  = tex(s0, (sfrac, across))             （s0=UseImage0=Extra_201）
//   col    = blade × vColor × uOpacity            （mul v0；mul c0=uOpacity 广播）
//   edge   = saturate((gate.x − wEnv) × 2)        （add+add_sat）
//   out.r  = col.r × dim        ← 尾乘按通道独立
//   out.g  = col.g × edge       ← （编译器生成的 4 lane 各不同乘子：r0=(dim,edge,1,wEnv)）
//   out.b  = col.b × 1
//   out.a  = col.a × wEnv                        （线性包络收尾）
// 图片绑定表（DyeInitializer.cs:461-480；FinalFractal 出手侧被 FinalFractalHelper.cs
// :185-186 覆写）：MagicMissile=192/194/193  FlameLash=191/189/190  RainbowRod=
// 195/197/196  LightDisc=195/195/252  FinalFractal=201/193  EmpressBlade=209/210。
// 消费弹型（Main.cs:28616-28668）：34/16/宝石弹族/106/933+1100/946。
// ★性能批（同日）：主循环原为 O(bbox像素×段数)，天顶挥击十余剑 bbox 600² 而描边覆盖
// ~5% —— 自适应半分辨率光栅 + 段扫掠矩形粗格预筛（无假阴性；被覆盖像素数学不变）。
import type { Renderer } from '../render/Renderer';
import { defaultUniforms, getPass, type SM2Pass, type SM2SamplerOut } from './SM2Effect';

export interface TrailPt {
  x: number; y: number;          // 世界坐标（ctx 已在相机系）
  hw: number;                    // 半宽 px
  /** 顶点旋转（刃轴向，AddVertexPair 截面 = (rot−π/2) 向；缺省按相邻点走向推导） */
  rot?: number;
  r: number; g: number; b: number; a: number;   // 顶点色 0-1（沿程已含淡出）
}

type ExtraSet = {
  imgs: readonly [string, string, string | null];
  /** true = FinalFractalVertex 技术 obj58 字节码像素语义（Zenith/女皇剑族） */
  tech: boolean;
  ssd: readonly [number, number, number, number];
  /** ★2026-09-03 SM2 字节码档：走 obj55 "MagicMissile" pass（SM2Effect 解释器/
   *  codegen 逐像素执行）。值 = Drawer.UseSaturation 钉值（FlameLashDrawer.cs:16
   *  =-2f；MagicMissileDrawer.cs:15/RainbowRodDrawer.cs:15/LightDiscDrawer.cs:15
   *  =-2.8f）——uSaturation 经 D3DX preshader 与 uTime 合成 s2 噪声层滚动相位
   *  （preshader syms=[uSaturation,uTime] 写回 c1.x,主 shader `add r0,T0.x,C[4]`
   *  消费）,不是颜色饱和度。undefined = 沿旧兜底近似公式。 */
  sm2?: number;
};
export const EXTRA_SETS: Record<string, ExtraSet> = {
  MagicMissile: { imgs: ['vanilla/Extra_192.png', 'vanilla/Extra_194.png', 'vanilla/Extra_193.png'], tech: false, ssd: [4, 0, 0, 4], sm2: -2.8 },
  FlameLash: { imgs: ['vanilla/Extra_191.png', 'vanilla/Extra_189.png', 'vanilla/Extra_190.png'], tech: false, ssd: [4, 0, 0, 4], sm2: -2 },
  RainbowRod: { imgs: ['vanilla/Extra_195.png', 'vanilla/Extra_197.png', 'vanilla/Extra_196.png'], tech: false, ssd: [4, 0, 0, 4], sm2: -2.8 },
  LightDisc: { imgs: ['vanilla/Extra_195.png', 'vanilla/Extra_195.png', 'vanilla/Extra_252.png'], tech: false, ssd: [4, 0, 0, 4], sm2: -2.8 },
  FinalFractal: { imgs: ['vanilla/Extra_201.png', 'vanilla/Extra_193.png', null], tech: true, ssd: [4, 0, 0, 4] },
  // ★SW-BJ56 2026-09-10：SSD 按 EmpressBladeDrawer.cs:18-26 逐值校=(1,0,0,0.6)——
  //  旧 [4,0,0,4] 系从 FinalFractal 复制（FinalFractalHelper.cs:175-186 =4,0,0,4）,
  //  该 set 此前无消费方故未爆;锯齿链 dim=1−ph/SSD.w 与 obj58 尾乘 c2.x=1/SSD.w 语义。
  EmpressBlade: { imgs: ['vanilla/Extra_209.png', 'vanilla/Extra_210.png', null], tech: true, ssd: [1, 0, 0, 0.6] },
};

// ---------- obj55 "MagicMissile" pass（SM2 字节码）帧级执行上下文 ----------
// 四个 Misc 拖尾技术（MagicMissile/FlameLash/RainbowRod/LightDisc）在 DyeInitializer
// （Terarria1458/Terraria.Initializers/DyeInitializer.cs:461-484）全部指向同一
// pixelShaderRef 技术 "MagicMissile"（obj55,23 tokens/17 实指令/3 texld）——只换
// 三张噪声贴图。codegen 产物 px_MagicMissile.gen.ts 已在位（SM2_CODEGEN 缺省开）。
let mmPassCache: SM2Pass | null | undefined;   // undefined=尚未取
function magicMissilePass(): SM2Pass | null {
  if (mmPassCache === undefined) mmPassCache = getPass('MagicMissile');
  return mmPassCache;
}

/** LinearWrap 采样器（MiscShaderData.cs:110 SamplerState.LinearWrap——Misc 族
 *  uImage0/1/2 全走 wrap;染料 s0 的 LinearClamp 与此不同源）。
 *  ★BJ255 P2（CPU 兜底提速,位等价）：内联 sampleImageInto 的 wrap 四角双线性——
 *  运算树逐字同形（半像素 −0.5、floor/fx/fy、wrap 双模取整式、p01/p23/out 嵌套
 *  求值序全保留）,仅两处等价改形：①`data[i]/255` 换查 f255 预除表（0-255 整数
 *  除 255 的 f64 商与表值逐位相同）;②四角 arrow 调用就地内联（消 sx 热点 1871ms
 *  的闭包调用开销——Trace-20260921T164132 定谳热点）。 */
function wrapSampler(im: ImgData | null): SM2SamplerOut {
  return (u: number, v: number, out: Float64Array): void => {
    if (!im) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; return; }
    const w = im.w, h = im.h, t = f255Table(im);
    const x = u * w - 0.5, y = v * h - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const ax = (((x0 % w) + w) % w) | 0, ay = (((y0 % h) + h) % h) | 0;
    const bx = (((x0 + 1) % w + w) % w) | 0, by2 = (((y0 + 1) % h + h) % h) | 0;
    let i = (ay * w + ax) * 4;
    const a0 = t[i], a1 = t[i + 1], a2 = t[i + 2], a3 = t[i + 3];
    i = (ay * w + bx) * 4;
    const b0 = t[i], b1 = t[i + 1], b2v = t[i + 2], b3 = t[i + 3];
    i = (by2 * w + ax) * 4;
    const c0 = t[i], c1 = t[i + 1], c2 = t[i + 2], c3 = t[i + 3];
    i = (by2 * w + bx) * 4;
    const d0 = t[i], d1 = t[i + 1], d2 = t[i + 2], d3 = t[i + 3];
    const p01r = a0 + (b0 - a0) * fx, p23r = c0 + (d0 - c0) * fx;
    const p01g = a1 + (b1 - a1) * fx, p23g = c1 + (d1 - c1) * fx;
    const p01b = a2 + (b2v - a2) * fx, p23b = c2 + (d2 - c2) * fx;
    const p01a = a3 + (b3 - a3) * fx, p23a = c3 + (d3 - c3) * fx;
    out[0] = p01r + (p23r - p01r) * fy;
    out[1] = p01g + (p23g - p01g) * fy;
    out[2] = p01b + (p23b - p01b) * fy;
    out[3] = p01a + (p23a - p01a) * fy;
  };
}

/** ★BJ255：obj55 GL 顶点带构造（9 floats/顶点、6 索引/quad——MM 族原版
 *  PrepareStripWithProceduralPadding 缺省 includeBacksides=false,见 GLSpriteLayer
 *  TRAIL_MM_FS 注）。rot 缺省按相邻点走向推导（同 obj58 tech 路径）；progress 分母
 *  =expectedPairs−1（VertexStrip.cs:116 count−1 语义,MM 族调用侧不传=实际点数）；
 *  ★顶点色=原始色（obj55 uOpacity 独立通道走 uniform,不折入顶点——与 obj58 tech
 *  路径的 op 折叠不同,与 CPU sm2f 分支同构）。导出=测试面（verts/idx 纯几何）。 */
export function buildStripVertsMM(pts: TrailPt[], expectedPairs?: number): { verts: Float32Array; idx: Uint16Array } {
  const m = pts.length;
  const verts = new Float32Array(m * 2 * 9);
  const idx = new Uint16Array((m - 1) * 6);
  const pairs = expectedPairs ?? m;
  for (let i = 0; i < m; i++) {
    const q = pts[i];
    const rot = q.rot
      ?? (i + 1 < m ? Math.atan2(pts[i + 1].y - q.y, pts[i + 1].x - q.x)
        : i > 0 ? Math.atan2(q.y - pts[i - 1].y, q.x - pts[i - 1].x) : 0);
    const dxC = Math.cos(rot - Math.PI / 2) * q.hw;
    const dyC = Math.sin(rot - Math.PI / 2) * q.hw;
    const prog = pairs > 1 ? i / (pairs - 1) : 0;
    const d = q.hw * 2;
    const b = i * 18;
    // A 侧(+widthDir)：progress=p；B 侧：progress=0（VertexStrip 语义）
    verts[b] = q.x + dxC; verts[b + 1] = q.y + dyC;
    verts[b + 2] = q.r; verts[b + 3] = q.g; verts[b + 4] = q.b; verts[b + 5] = q.a;
    verts[b + 6] = prog; verts[b + 7] = d; verts[b + 8] = d;
    const b2 = b + 9;
    verts[b2] = q.x - dxC; verts[b2 + 1] = q.y - dyC;
    verts[b2 + 2] = q.r; verts[b2 + 3] = q.g; verts[b2 + 4] = q.b; verts[b2 + 5] = q.a;
    verts[b2 + 6] = 0; verts[b2 + 7] = 0; verts[b2 + 8] = d;
  }
  for (let k = 0; k < m - 1; k++) {
    const v = k * 2, j = k * 6;
    // PrepareIndices 正面（VertexStrip.cs:131-140 includeBacksides=false）
    idx[j] = v; idx[j + 1] = v + 1; idx[j + 2] = v + 2;
    idx[j + 3] = v + 2; idx[j + 4] = v + 1; idx[j + 5] = v + 3;
  }
  return { verts, idx };
}

interface SM2FrameCtx {
  pass: SM2Pass;
  c: Float64Array; regs: Float64Array; tex: Float64Array;
  v0: Float64Array; o: Float64Array;
  smp: Array<SM2SamplerOut | undefined>;
}
/** 帧级准备：setupConstants 一次（uOpacity/uSaturation/uTime 常量化+preshader 求值）。
 *  三张噪声贴图任一未就位 → null（调用侧回退兜底近似,首帧懒加载自愈）。
 *  ★同帧单槽缓存（红队 F4）：key=(set|opacity|time)——同帧多条带（连发 8 弹）
 *  参数全同 → 命中共享一份 regs/tex/v0/o/smp（省 ~9KB/弹·帧 分配+n normCache
 *  重建）；跨帧 time 变 → miss 自然换血，无需显式清。单槽够用：不同 set 同帧
 *  并存时逐个挤兑重建（多 set 混发场景少，重建成本一次性）。 */
let sm2CtxCache: { key: string; ctx: SM2FrameCtx } | null = null;
/** ★BJ255：常量装配单槽缓存（与 sm2CtxCache 同键同语义，但不依赖三张 ImageData）——
 *  GL 路径（trailFrameBeginMM 的 uOpacity/uScroll uniform）只需 c[]，不再被迫先等
 *  atlas 图就位；preshader 每帧每键至多求值一次。 */
let sm2ConstCache: { key: string; c: Float64Array } | null = null;
function sm2Constants(set: ExtraSet, opacity: number, timeSec: number): Float64Array | null {
  const pass = magicMissilePass();
  if (!pass) return null;
  const key = `${pass.name}|${set.imgs[0]}|${opacity}|${timeSec}`;
  if (sm2ConstCache && sm2ConstCache.key === key) return sm2ConstCache.c;
  const u = defaultUniforms();
  u.uOpacity = opacity;
  u.uSaturation = set.sm2 ?? 1;
  u.uTime = timeSec;                       // Main.GlobalTimeWrappedHourly（秒,%3600）
  const c = pass.setupConstants(u);
  sm2ConstCache = { key, c };
  return c;
}
function sm2FrameCtx(set: ExtraSet, opacity: number, timeSec: number,
  s0im: ImgData | null, s1im: ImgData | null, s2im: ImgData | null): SM2FrameCtx | null {
  const pass = magicMissilePass();
  if (!pass || !s0im || !s1im || !s2im) return null;
  const key = `${pass.name}|${set.imgs[0]}|${opacity}|${timeSec}`;
  if (sm2CtxCache && sm2CtxCache.key === key) return sm2CtxCache.ctx;
  const c = sm2Constants(set, opacity, timeSec);
  if (!c) return null;
  const ctx: SM2FrameCtx = {
    pass,
    c,
    regs: new Float64Array(128),           // r0..r31
    tex: new Float64Array(32),             // t0..（T[0]=p,T[1]=across×d,T[2]=d 由像素级写）
    v0: new Float64Array(8),
    o: new Float64Array(4),
    smp: [wrapSampler(s0im), wrapSampler(s1im), wrapSampler(s2im), undefined],
  };
  sm2CtxCache = { key, ctx };
  return ctx;
}

interface ImgData { data: Uint8ClampedArray; w: number; h: number; f255?: Float64Array }
const imgCache = new Map<string, ImgData>();
/** data[i]/255 预除表（懒建；0-255 整数÷255 的 f64 商逐位可表，查表=同值零除法） */
function f255Table(im: ImgData): Float64Array {
  let t = im.f255;
  if (!t) {
    t = new Float64Array(im.data.length);
    for (let i = 0; i < t.length; i++) t[i] = im.data[i] / 255;
    im.f255 = t;
  }
  return t;
}

/** 测试钩：清模块态（imgCache 正像缓存/rawImgs 直连链/sm2 帧上下文——冷启动重放） */
export function __resetTrailShaderForTest(): void {
  imgCache.clear();
  rawImgs.clear();
  sm2CtxCache = null;
  sm2ConstCache = null;
}

/** 测试钩：wrapSampler（P2 内联双线性）直测面——与 SM2Effect.sampleImageInto
 *  的位等价差分（tests/bj255-rainbowrod-perf-dust.test.ts） */
export function __wrapSampleForTest(im: { data: Uint8ClampedArray; w: number; h: number },
  u: number, v: number, out: Float64Array): void {
  wrapSampler(im)(u, v, out);
}

/** atlas 图 → 像素域缓存（懒加载，只缓存正像）。
 *  ★BJ112-c 死窗修复（2026-09-17，ForceFieldBubble BJ112-① 同族方案 a）：良性 miss
 *  不吃时间负缓存——ensureVImage 的 null 是【三义】（加载在途 _iconPending‖失败冷却
 *  _vImageFailed‖本拍刚发起，SpriteAtlas.ts:621-644），旧 15s setTimeout 负缓存把
 *  "懒载未就绪"钉成"失败"→贴图落地后仍被压在兜底近似公式下最多 15s（重负载
 *  createImageBitmap 升级排队数秒时=整段 SM2 真值面丢失窗口，P2 家族）。摘除后
 *  逐帧重查 = SpriteAtlas.ts:360 "未就绪返回 null,消费方下帧自愈"既定契约；节流权
 *  归图集——真失败（404/坏字节）由图集侧 _vImageFailed 10s TTL 早退+瞬态重试背书
 *  （同案 ForceFieldBubble perlinData/Dart.ts:314），本面重查成本仅 Map 探测。
 *  正像（解码 ImgData）仍永久缓存。 */
function extraData(atlas: NonNullable<Renderer['atlas']>, path: string): ImgData | null {
  const hit = imgCache.get(path);
  if (hit !== undefined) return hit;
  const img = atlas.ensureVImage(path);
  if (!img || !(img.width > 0)) return null;   // 三义 null：pending‖failed‖刚发起——下帧重查
  try {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    cx.drawImage(img as CanvasImageSource, 0, 0);
    const d = cx.getImageData(0, 0, img.width, img.height);
    const out: ImgData = { data: d.data, w: img.width, h: img.height };
    imgCache.set(path, out);
    return out;
  } catch {
    return null;
  }
}

function sampleAt(im: ImgData | null, u: number, v: number): number {
  if (!im) return 1;
  const uu = u - Math.floor(u), vv = v - Math.floor(v);
  const x = Math.min(im.w - 1, (uu * im.w) | 0);
  const y = Math.min(im.h - 1, (vv * im.h) | 0);
  return im.data[(y * im.w + x) * 4] / 255;
}

let scratch: HTMLCanvasElement | null = null;

/** GL 纹理源直连加载器：绕开 atlas.ensureVImage 的 createImageBitmap 异步升级链
 *  （重负载下升级排队数秒，GL 分支整段退化 CPU 光栅 = 卡顿；2026-08-30 实测定罪：
 *  probe 中 ensureVImage 6 秒窗口全程 pending 而直连 Image 数毫秒落地）。
 *  独立缓存：status pending→ok；失败 10s 重试。 */
const rawImgs = new Map<string, { img: HTMLImageElement | null; failedAt: number }>();
function ensureRawImg(path: string): HTMLImageElement | null {
  const hit = rawImgs.get(path);
  if (hit) {
    if (hit.img) return hit.img;
    if (performance.now() - hit.failedAt > 10_000) rawImgs.delete(path);
    else return null;
  }
  const rec = { img: null as HTMLImageElement | null, failedAt: 0 };
  rawImgs.set(path, rec);
  const im = new Image();
  im.onload = () => {
    // ★2026-09-02 月牙形态翻案：Extra_201/209 的 16×16 裁剪+黑底键控【整体撤销】。
    //   当年"内容仅底左角 16×16"系误诊——磁盘文件（=terraria-assets 原件逐字节
    //   一致，PIL/浏览器双读）实为 512² 全幅、alpha 恒 255：内容=底左角亮扇形
    //   （rows 204-510 × cols 0-359，per-row/col max lum 单调渐变），XNA 侧正是
    //   全范围采样该扇形得【截面亮外缘 + 4 次 sfrac 波纹】的宽月牙；裁剪把扇形
    //   压进 16×16 = 只剩一条细亮纹（"细螺旋线"根因）。黑十字之病根在本层曾用
    //   预乘 over 混合——rgb=0∧a>0 的暗 texel 压暗背景；现 trailStrip 改真加算
    //   (ONE,ONE)+主链 'lighter' 合成（=XNA BlendState.Additive 语义），暗 texel
    //   贡献恒 0，无需键控。贴图一概原样直传（与 XNA Texture2D 同口径）。
    rec.img = im;
  };
  im.onerror = () => { rec.failedAt = performance.now(); };
  im.src = `sprites/${encodeURI(path)}`;
  return null;
}

/** 进世界预热：把六组 Extra 贴图在【 load 早期】钉进 atlas（+ raw 直连链）。
 *  痛点：draw 时才懒加载会撞上 atlas.createImageBitmap 升级排队（重负载数秒），
 *  期间 GL 分支拿不到图 → 整段退化 CPU 光栅 = 挥剑即卡。afterWorldLoad 调用。 */
export function prewarmTrailTextures(atlas: NonNullable<Renderer['atlas']>): void {
  const seen = new Set<string>();
  for (const set of Object.values(EXTRA_SETS)) {
    for (const path of set.imgs) {
      if (!path || seen.has(path)) continue;
      seen.add(path);
      try { atlas.ensureVImage(path); } catch { /* 预热失败不影响绘制链 */ }
      ensureRawImg(path);
    }
  }
}

export interface TrailSpec {
  /** 'RainbowRod'(宝石弹)/'MagicMissile'(魔导弹)/'FlameLash'/'LightDisc'
   *  /'FinalFractal'(天顶剑)/'EmpressBlade'(女皇剑) */
  set: keyof typeof EXTRA_SETS;
  pts: TrailPt[];
  opacity: number;               // uOpacity（obj58 路径由调用方折进顶点色上游一致生效）
  time: number;                  // 秒（滚动相位；obj58 未消费 uTime，保留接口）
  /** 兼容位：锯齿强度。真字节码下由 SSD 决定（不再是自由参数） */
  zigzag?: number;
  /** 原版 VertexStrip.PrepareStrip 第 6 参 expectedVertexPairsAmount（:55-63）：
   *  progressOnStrip = i/(该值−1)——【与实际点数无关】（天顶剑恒传 oldPos.Length=60，
   *  幼剑/裁剪点数后 progress 仍按 /59 摊，短条带只到 p=(n−1)/59 不到 1）。缺省回退
   *  实际点数（旧口径）。 */
  expectedPairs?: number;
}

/**
 * 条带拖尾合成入口：
 * ① FinalFractal/EmpressBlade 走 obj58 字节码忠实路径（tech=true）；
 * ② 其余族沿旧近似公式（门×包络），待逐族迁移。
 * 输出以 'lighter' 叠画到 ctx（原版 AlphaBlend 加算分量等价）。返回是否实际绘制。
 */
export function drawStripTrail(
  ctx: CanvasRenderingContext2D,
  renderer: Renderer,
  spec: TrailSpec,
  onBlit?: (info: {
    /** 光栅结果画布（模块 scratch,消费方须即刻消费——下一条带光栅会覆写） */
    canvas: HTMLCanvasElement;
    /** 源矩形（半分辨率档 rw×rh）与页域 dest（世界坐标 bx,by,bw,bh——调用方相机系） */
    sw: number; sh: number; dx: number; dy: number; dw: number; dh: number;
  }) => void,
  /** ★gladd 面⑫-b（2026-10-28,task#22）:GL 发射钩（缺省 undefined=2D blit 原路
   *  零变化）。armed 时【跳过 2D blit】改调本钩——info 同 onBlit 形;返回 false=
   *  发射失败（调用方置失败旗降级）。scratch=直色 rgb(=加算贡献)/α∈{0,255}
   *  →premul 上传后贡献本体逐位;blend=additive vCol=(1,1,1,0)。 */
  glEmit?: (info: {
    canvas: HTMLCanvasElement;
    sw: number; sh: number; dx: number; dy: number; dw: number; dh: number;
  }) => boolean,
): boolean {
  const pts = spec.pts.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  if (pts.length < 2) return false;
  const atlas = renderer.atlas;
  if (!atlas) return false;
  const set = EXTRA_SETS[spec.set] ?? EXTRA_SETS.MagicMissile;

  // ---- ★BJ255（2026-09-21 用户实报"79 长按连发严重卡顿"）：obj55 SM2 族 GL 直绘 ----
  //  定谳（Trace-20260921T164132.json，11.76s 主线程采样）：drawStripTrail 全链含
  //  8.23s=70% 帧时（drawStripTrail self 4.64s=逐像素全段最近邻搜索 + execPixel/
  //  px_MagicMissile/sampleImageInto/sx 3.27s=逐像素软件 shader），rAF p99=198ms/
  //  max=414ms。原版语义=VertexStrip 三角带 1 draw call/弹（GPU obj55），canvas 逐
  //  像素架构天然贵 → SM2 族同 obj58 tech 路径整条移交 glfx GPU：单 program
  //  TRAIL_MM_FS 逐指令直译 px_MagicMissile、顶点带同 9-float 布局、(ONE,ONE) 加算、
  //  6 索引/quad（MM 族 includeBacksides=false，见 GLSpriteLayer TRAIL_MM_FS 注）。
  //  GL miss（SwiftShader/?trailgl=0/贴图未落地/node）→ 落回下方 CPU 光栅既有链。
  if (set.sm2 !== undefined && typeof Image !== 'undefined') {
    const dbgOn = (() => { try { return new URLSearchParams(location.search).has('traildbg'); } catch { return false; } })();
    const dbg = (why: string): void => { if (dbgOn) { const w = (renderer as unknown as { __trailDbg?: Record<string, number> }).__trailDbg ??= {}; w[why] = (w[why] ?? 0) + 1; } };
    dbg('mm-enter');
    const glfx = (() => {
      try {
        if (new URLSearchParams(location.search).get('trailgl') === '0') { dbg('gate-off'); return null; }
      } catch { /* 非浏览器环境 */ }
      const q = renderer as unknown as { acquireGL?: () => unknown };
      if (typeof q.acquireGL !== 'function') { dbg('no-acquireGL'); return null; }
      const g = q.acquireGL() as { resize(vW: number, vH: number): void; trailFrameBeginMM(vW: number, vH: number, cx: number, cy: number, zoom?: number, op?: number, scroll?: number): void; trailStripMM(t0: unknown, t1: unknown, t2: unknown, v: Float32Array, i: Uint16Array): void; texFromImage(k: string, s: TexImageSource, m: boolean, sm: boolean, rp: boolean): unknown } | null;
      if (!g) dbg('no-glfx');
      return g;
    })();
    const cn = glfx ? sm2Constants(set, spec.opacity, spec.time) : null;
    if (!cn) dbg('no-const');
    const img0 = glfx && cn ? ensureRawImg(set.imgs[0]) : null;
    const img1 = glfx && cn ? ensureRawImg(set.imgs[1]) : null;
    const img2 = glfx && cn && set.imgs[2] ? ensureRawImg(set.imgs[2]) : null;
    if (!img0) dbg('no-img0');
    if (!img1) dbg('no-img1');
    if (!img2) dbg('no-img2');
    if (glfx && img0 && img1 && img2 && cn && img0.width > 0 && img1.width > 0 && img2.width > 0) {
      const vW = Math.max(2, Math.round(renderer.glViewW));
      const vH = Math.max(2, Math.round(renderer.glViewH));
      glfx.resize(vW, vH);
      glfx.trailFrameBeginMM(vW, vH, renderer.glCamX, renderer.glCamY,
        (renderer as unknown as { glZoom?: number }).glZoom ?? 1, cn[0], cn[4]);
      const t0e = glfx.texFromImage(`trail:${set.imgs[0]}`, img0 as unknown as TexImageSource, false, true, true);
      const t1e = glfx.texFromImage(`trail:${set.imgs[1]}`, img1 as unknown as TexImageSource, false, true, true);
      const t2e = glfx.texFromImage(`trail:${set.imgs[2]}`, img2 as unknown as TexImageSource, false, true, true);
      if (!t0e || !t1e || !t2e) dbg('tex-upload-null');
      if (t0e && t1e && t2e) {
        const { verts, idx } = buildStripVertsMM(pts, spec.expectedPairs);
        glfx.trailStripMM(t0e, t1e, t2e, verts, idx);
        return true;
      }
    }
    // GL miss → 继续 CPU 光栅（兜底链不动）
  }

  const s0im = extraData(atlas, set.imgs[0]);
  const s1im = extraData(atlas, set.imgs[1]);
  const s2im = set.imgs[2] ? extraData(atlas, set.imgs[2]) : null;
  // obj55 SM2 字节码帧级上下文（贴图未就位=首帧懒加载窗 → null,走兜底近似回退）
  const sm2f = set.sm2 !== undefined
    ? sm2FrameCtx(set, spec.opacity, spec.time, s0im, s1im, s2im)
    : null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, maxHw = 4;
  for (const q of pts) {
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    maxHw = Math.max(maxHw, q.hw);
  }
  const pad = Math.ceil(maxHw + 3);
  const bx = Math.floor(x0 - pad), by = Math.floor(y0 - pad);
  const bw = Math.ceil(x1 - x0) + pad * 2, bh = Math.ceil(y1 - y0) + pad * 2;
  if (bw <= 0 || bh <= 0 || bw > 2048 || bh > 2048) return false;

  // ---- 性能：自适应半分辨率 + 覆盖格预筛 ----
  // 自适应半分辨率（性能档）：★2026-09-03 阈值 50000→150000——用户实报"飞行中
  // 挥天顶剑拖尾呈波纹锯齿"（站定=圆滑弧）：飞行时 trail 被玩家位移补偿拉长,
  // bbox 恒超旧阈 → 半分辨率上采样=边缘几何锯齿。SM2 codegen 直线代码 ~0.5µs/px,
  // 15 万 px 全分辨率 ≈ 7ms 可承受;超大带仍降半防帧炸。?trailres=1 强制全分辨率。
  // ★BJ686 勘误注（2026-10-19 复审,原注系误诊残留）：该"波纹锯齿"实因=TrailingMode4
  // 补偿时序（旧 fixedUpdate 头补偿+step 顶压上子步末态 → 每 tick 一错一对交替,已修
  // 见 ZenithSword commitTrail）——半分辨率论当时是错误归因;本阈值/闸保留（超大带
  // 防帧炸的真实性能面,与该病无关）。
  const rs = (() => {
    try { if (new URLSearchParams(location.search).get('trailres') === '1') return 1; } catch { /* 非浏览器 */ }
    return bw * bh > 150000 ? 0.5 : 1;
  })();
  const rw = Math.max(1, Math.round(bw * rs));
  const rh = Math.max(1, Math.round(bh * rs));

  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== rw || scratch.height !== rh) { scratch.width = rw; scratch.height = rh; }
  const scx = scratch.getContext('2d', { willReadFrequently: true });
  if (!scx) return false;
  const frame = scx.createImageData(rw, rh);
  const fd = frame.data;

  const n = pts.length;
  const scrollT = spec.time * 0.35;
  // ---- 覆盖格预筛 ----
  const csz = Math.max(6, Math.ceil(maxHw * rs));
  const gw = Math.ceil(rw / csz), gh = Math.ceil(rh / csz);
  // ---- ★BJ255 P1：逐格段表（原"覆盖格预筛+逐像素全段最近邻搜索"改造）----
  //  每段 i 注册进「胶囊 AABB（缩放系）外扩 csz」覆盖的全部格；像素只测本格候选。
  //  【与全局搜索逐像素等价】：设像素 P 的全局最近段 s*，|bestU|>hw 门即
  //  dist(P,s*)>hw(s*)。①P 会画 ⇒ dist≤hw(s*)≤maxHw≤csz/rs（csz≥maxHw·rs）⇒
  //  s* 胶囊含 P ⇒ 其 AABB+csz 覆盖 P 所在格 ⇒ s*∈本格表 ⇒ 子集最小=全局最小。
  //  ②P 被全局搜索跳过而本格某候选 s'' 过门 ⇒ dist(P,s'')≤hw(s'')≤maxHw ⇒
  //  dist(P,s*)≤dist(P,s'')≤csz/rs ⇒ s* 已注册 ⇒ 本格最小=s* ⇒ 同样过不了门。
  //  两向皆不出画差异（gs 候选超集论证,无假阴性无假阳性）。
  const segCells: Array<number[] | undefined> = new Array(gw * gh);
  const rowHas = new Uint8Array(gh);
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i], b2 = pts[i + 1];
    const rad = Math.max(a.hw, b2.hw);
    const gx0 = Math.max(0, Math.floor(((Math.min(a.x, b2.x) - rad - bx) * rs - csz) / csz));
    const gy0 = Math.max(0, Math.floor(((Math.min(a.y, b2.y) - rad - by) * rs - csz) / csz));
    const gx1 = Math.min(gw - 1, Math.floor(((Math.max(a.x, b2.x) + rad - bx) * rs + csz) / csz));
    const gy1 = Math.min(gh - 1, Math.floor(((Math.max(a.y, b2.y) + rad - by) * rs + csz) / csz));
    for (let gy = gy0; gy <= gy1; gy++) {
      rowHas[gy] = 1;
      const rowOff = gy * gw;
      for (let gx = gx0; gx <= gx1; gx++) {
        const ci = rowOff + gx;
        const list = segCells[ci] ?? (segCells[ci] = []);
        list.push(i);
      }
    }
  }

  // ---- obj58 常量 ----
  const ssdInvW = set.ssd[3] !== 0 ? 1 / set.ssd[3] : 0;

  for (let pyi = 0; pyi < rh; pyi++) {
    const wy = by + (pyi + 0.5) / rs;
    const grow = Math.floor(pyi / csz);
    if (!(grow >= 0 && grow < gh) || !rowHas[grow]) continue;
    const rowOff = grow * gw;
    for (let pxi = 0; pxi < rw; pxi++) {
      const cand = segCells[rowOff + Math.floor(pxi / csz)];
      if (!cand) continue;
      const wx = bx + (pxi + 0.5) / rs;
      let bestD2 = Infinity, bestSeg = -1, bestV = 0, bestU = 0;
      for (let li = 0; li < cand.length; li++) {
        const i = cand[li];
        const a = pts[i], b2 = pts[i + 1];
        const ex = b2.x - a.x, ey = b2.y - a.y;
        const len2 = ex * ex + ey * ey;
        const tt = len2 > 1e-6 ? Math.max(0, Math.min(1, ((wx - a.x) * ex + (wy - a.y) * ey) / len2)) : 0;
        const qx = a.x + ex * tt, qy = a.y + ey * tt;
        const ddx = wx - qx, ddy = wy - qy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) { bestD2 = d2; bestSeg = i; bestV = (i + tt) / (n - 1); bestU = d2 > 1e-6 ? Math.sign(ddx * -ey + ddy * ex) * Math.sqrt(d2) : 0; }
      }
      if (bestSeg < 0) continue;
      const a = pts[bestSeg], b2 = pts[bestSeg + 1];
      const hw = a.hw + (b2.hw - a.hw) * bestV;
      if (Math.abs(bestU) > hw) continue;
      const uN = bestU / hw * 0.5 + 0.5;                       // 跨带 0(B)..1(A)
      const cr = a.r + (b2.r - a.r) * bestV;
      const cg = a.g + (b2.g - a.g) * bestV;
      const cb = a.b + (b2.b - a.b) * bestV;
      const ca = a.a + (b2.a - a.a) * bestV;
      if (ca <= 0.004) continue;
      const o = (pyi * rw + pxi) * 4;

      if (set.tech) {
        // ===== GL 路径：obj58 语义整条交给 GPU（极光同教训——CPU 硬画预乘/混合
        // 语义对不齐且慢；此处顶点交错后一次 drawElements，主链每帧单次合成）。
        // p 沿 XNA 约定：pts[0] = 最新（[0]=newest），p=0 为刃后最近段。
        // ?trailgl=0 = 逃生门（SwiftShader/驱动白名单问题强制 CPU 路径）
        // ★dbg 声明必须先于任何 dbg() 调用——曾因 TDZ 在首像素抛
        //   ReferenceError 且被调用方静默 catch = 整条拖尾消失（2026-08-30 定罪）
        const dbgOn = (() => { try { return new URLSearchParams(location.search).has('traildbg'); } catch { return false; } })();
        const dbg = (why: string): void => { if (dbgOn) { const w = (renderer as unknown as { __trailDbg?: Record<string, number> }).__trailDbg ??= {}; w[why] = (w[why] ?? 0) + 1; } };
        dbg('tech-enter');
        const glfx = (() => {
          try {
            if (new URLSearchParams(location.search).get('trailgl') === '0') { dbg('gate-off'); return null; }
          } catch { /* 非浏览器环境 */ }
          const g = renderer.acquireGL();
          if (!g) dbg('no-glfx');
          return g;
        })();
        const img0 = ensureRawImg(set.imgs[0]);
        const img1 = ensureRawImg(set.imgs[1]);
        if (!img0) dbg('no-img0');
        if (!img1) dbg('no-img1');
        if (glfx && img0 && img1 && img0.width > 0 && img1.width > 0) {
          const vW = Math.max(2, Math.round(renderer.glViewW));
          const vH = Math.max(2, Math.round(renderer.glViewH));
          glfx.resize(vW, vH);
          // zoom 透传（Camera.zoom 默认 1.25——世界按 z 落画布，条带 clip 同乘）
          glfx.trailFrameBegin(vW, vH, renderer.glCamX, renderer.glCamY,
            (renderer as unknown as { glZoom?: number }).glZoom ?? 1);
          const t0e = glfx.texFromImage(`trail:${set.imgs[0]}`, img0 as unknown as TexImageSource, false, true, true);
          const t1e = glfx.texFromImage(`trail:${set.imgs[1]}`, img1 as unknown as TexImageSource, false, true, true);
          if (!t0e || !t1e) dbg('tex-upload-null');
          if (t0e && t1e) {
            const m = pts.length;
            const verts = new Float32Array(m * 2 * 9);
            const idx = new Uint16Array((m - 1) * 12);
            const op = spec.opacity;
            const pairs = spec.expectedPairs ?? m;   // :55-63 分母=期望对数−1（≠实际点数）
            for (let i = 0; i < m; i++) {
              const q = pts[i];
              const rot = q.rot
                ?? (i + 1 < m ? Math.atan2(pts[i + 1].y - q.y, pts[i + 1].x - q.x)
                  : i > 0 ? Math.atan2(q.y - pts[i - 1].y, q.x - pts[i - 1].x) : 0);
              const dxC = Math.cos(rot - Math.PI / 2) * q.hw;
              const dyC = Math.sin(rot - Math.PI / 2) * q.hw;
              const prog = pairs > 1 ? i / (pairs - 1) : 0;   // XNA [0]=newest ⇒ p=0 刃后最近段
              const d = q.hw * 2;
              const b = i * 18;
              // A 侧(+widthDir)：progress=p；B 侧：progress=0（VertexStrip 语义）
              verts[b] = q.x + dxC; verts[b + 1] = q.y + dyC;
              verts[b + 2] = q.r * op; verts[b + 3] = q.g * op; verts[b + 4] = q.b * op; verts[b + 5] = q.a * op;
              verts[b + 6] = prog; verts[b + 7] = d; verts[b + 8] = d;
              const b2 = b + 9;
              verts[b2] = q.x - dxC; verts[b2 + 1] = q.y - dyC;
              verts[b2 + 2] = q.r * op; verts[b2 + 3] = q.g * op; verts[b2 + 4] = q.b * op; verts[b2 + 5] = q.a * op;
              verts[b2 + 6] = 0; verts[b2 + 7] = 0; verts[b2 + 8] = d;
            }
            for (let k = 0; k < m - 1; k++) {
              const v = k * 2, j = k * 12;
              // PrepareIndices 正面 + 背面（includeBacksides=true, :93-116）
              idx[j] = v; idx[j + 1] = v + 1; idx[j + 2] = v + 2;
              idx[j + 3] = v + 2; idx[j + 4] = v + 1; idx[j + 5] = v + 3;
              idx[j + 6] = v + 2; idx[j + 7] = v + 1; idx[j + 8] = v;
              idx[j + 9] = v + 2; idx[j + 10] = v + 3; idx[j + 11] = v + 1;
            }
            glfx.trailStrip(t0e, t1e, verts, idx, set.ssd);
            return true;
          }
        }
        // GL 不可用 → CPU obj58 退化（半分辨率+覆盖格已限流）
        // ===== obj58 逐指令忠实执行 =====
        // ★p 方向：XNA oldPos[0]=最新（Projectile.cs:15841 压栈序），VertexStrip 从
        //   i=0 迭代（:59-63）⇒ p=0 在【剑侧】；ptsFS[0]=最新 ⇒ p=bestV 直取
        //   （曾反转为 1−bestV = 包络方向颠倒：剑侧渐隐、尾端全亮，2026-09-02 勘误）。
        //   分母按 expectedPairs−1（:55-63 恒定，与实际点数无关）。
        const pairs = spec.expectedPairs ?? n;
        const p = pairs > 1 ? Math.min(1, bestV * (n - 1) / (pairs - 1)) : 0;
        const wEnv = p * 1.5 - 0.5;
        const ph = p * set.ssd[0] + set.ssd[1];
        const sfrac = (ph % 1 + 1) % 1;                        // frc（cmp 分支对 Repeat 无感）
        const dim = 1 - ph * ssdInvW;                          // ★锯齿链（活）
        // across = t0.y/t0.z = uN（★2026-09-03 红队 F1 复核回退：曾热修 1−uN 判反）。
        // 极性推导钉死：CPU 光栅段向量 e=pts[i+1]−pts[i]，而 pts[0]=最新 ⇒ e 恒为
        // 【尾向】——右移弹 e=(−1,0)，上侧像素 ddy<0 → bestU=ddy·ex=(−)×(−)>0 →
        // uN→1=【上侧】；原版 VertexStrip.cs:158/193-204 v1=pos+(rot−π/2)·hw=
        // (0,−1)·hw=上侧、TexCoord=(p,d,d)=across 1 ⇒ uN 恰=原版 across，无需翻转
        // （旧注"bestU 下侧为正"系把 e 当头向的符号错）。GL verts 路径 rot 派生自
        // 同一尾向邻点 → +dxC=下侧=镜像——obj58 GL 镜像是既有存量（登记观察）。
        const across = uN;
        const gate = sampleAt(s1im, sfrac, across);            // s1（Repeat 寻址）
        const blade = sampleAt(s0im, sfrac, across);           // s0 全幅扇形贴图（截面+4 波纹本体）
        const edgeRaw = (gate - wEnv) * 2;
        const edge = edgeRaw < 0 ? 0 : edgeRaw > 1 ? 1 : edgeRaw;
        const aOut = ca * edge * Math.max(0, wEnv);            // out.a = col.a×edge×wEnv
        if (aOut <= 0.004) continue;
        // out.rgb = blade×vColor×lane(dim,edge,1)（含 obj58 第 16 指令 edge 标量广播）；
        // XNA 设备混合贡献 = out.rgb 全量直加（(One,One) 语义，见 GLSpriteLayer TRAIL_FS
        // 注）→ 'lighter' 直加不预乘。★alpha 写 255（2026-09-03 premul 陷阱定罪：
        // 旧 a=0 被真实 canvas 的 premul 内部表示吞光——putImageData 后 rgb'=rgb×a/255=0，
        // drawImage('lighter') 加 0 = CPU 退化路径整条带不可见;实机探针 probe4 实证
        // a=0→[0,0,0]/a=255→[200,0,100]）。★rgb 门（同日用户实报"天顶剑拖尾变黑
        // 不透明"）：Extra_201 贴图【大片黑 texel】（仅底左角亮扇形），blade=0 的像素
        // rgb 全 0——加算贡献恒 0 但 a=255 会在非 opaque 合成面上落不透明黑块；
        // dim<0（锯齿链负值 UNORM clamp 0）同理。rgb≤0 一律不写。
        const rO = blade * cr * edge * dim;
        const gO = blade * cg * edge * edge;
        const bO = blade * cb * edge;
        if (Math.max(rO, gO, bO) <= 0.004) continue;
        fd[o] = rO * 255;
        fd[o + 1] = gO * 255;
        fd[o + 2] = bO * 255;
        fd[o + 3] = 255;
        continue;
      }

      // ---- obj55 "MagicMissile" pass SM2 字节码逐像素执行（2026-09-03）----
      //  t0 = XNA VertexStrip 顶点 CustomData 流的像素插值：A 侧 (p, d, d)、B 侧
      //  (0, 0, d)（GL verts 路径同构,见上方 tech 分支 verts 布局）→
      //  T[0]=p、T[1]=across×d、T[2]=d。p 方向：pts[0]=最新（strip.unshift 压栈序
      //  与 XNA oldPos[0] 同），分母=expectedPairs−1（VertexStrip :55-63 语义）。
      //  execPixel 的 t0x/t0y 形参只覆写 tex[0]/[1]，T[2] 由预写 tex[2] 传入
      //  （codegen 生成体 instr#2 `1/T[2]` 与 VM bindFile case 3 同读 tex 数组）。
      //  输出 oC0 已 UNORM sat——XNA (One,One) 加算 → 'lighter' 直加。★alpha 写
      //  255（premul 陷阱同 tech 分支注,probe4 实证）。★across=uN（极性同 tech
      //  分支注：pts[0]=最新 ⇒ 段向量=尾向 ⇒ bestU 上侧为正 = 原版 A 侧,红队 F1 回退）。
      if (sm2f) {
        const pairs = spec.expectedPairs ?? n;
        const p = pairs > 1 ? Math.min(1, bestV * (n - 1) / (pairs - 1)) : 0;
        const d = hw * 2;
        sm2f.tex[2] = d;
        sm2f.tex[3] = 0;
        sm2f.v0[0] = cr; sm2f.v0[1] = cg; sm2f.v0[2] = cb; sm2f.v0[3] = ca;
        const res = sm2f.pass.execPixel(sm2f.c, sm2f.regs, sm2f.tex, sm2f.v0, sm2f.o,
          p, uN * d, sm2f.smp);
        // ★rgb 门（同 obj58 CPU 分支注）：UNORM 输出 rgb 全 0（s0 黑 texel/gate=0/
        //  edge=0）不写——加算贡献恒 0,a=255 只会在非 opaque 面落黑块
        if (res && Math.max(res[0], res[1], res[2]) > 0.004) {
          fd[o] = res[0] * 255;
          fd[o + 1] = res[1] * 255;
          fd[o + 2] = res[2] * 255;
          fd[o + 3] = 255;
        }
        continue;
      }

      // ---- 兜底近似（obj55 字节码/三贴图未就位时的回退,首帧懒加载后自愈）----
      //  ★alpha 同 premul 陷阱修（rgb 已含全部折算,旧 a=ca*k 是第二次折算:
      //  premul 内部 rgb'=rgb×a/255 → 实际加成被多乘一次 ca*k/255=偏暗）
      const uvU = uN + scrollT, uvV = bestV * 0.5 + scrollT * 0.7;
      const gate = sampleAt(s1im, uvU, uvV);
      const base = sampleAt(s0im, uvV, uvU * 0.5 + scrollT * 0.4);
      const k = gate * Math.max(0, Math.min(1, 2 * (base - (uN * 1.5 - 0.5))));
      if (k <= 0.01) continue;
      fd[o] = Math.min(255, base * 255 * cr * k * spec.opacity);
      fd[o + 1] = Math.min(255, base * 255 * cg * k * spec.opacity);
      fd[o + 2] = Math.min(255, base * 255 * cb * k * spec.opacity);
      fd[o + 3] = 255;
    }
  }
  scx.putImageData(frame, 0, 0);
  // ★gladd 面⑫-b sink:armed=GL 发射替代 2D blit(smooth=true 对位 imageSmoothing)
  if (glEmit) {
    return glEmit({ canvas: scratch, sw: rw, sh: rh, dx: bx, dy: by, dw: bw, dh: bh });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scratch, 0, 0, rw, rh, bx, by, bw, bh);
  ctx.restore();
  // ★BJ679 水罩 mask 镜像钩子（Renderer flushTrailShade 传入;GL 路径
  //  早退不触发=余债登记）。scratch α=255（带内）/0（带外,putImageData 全幅
  //  覆写）=形状精确;即刻消费（下一条带光栅覆写 scratch）。
  if (onBlit) onBlit({ canvas: scratch, sw: rw, sh: rh, dx: bx, dy: by, dw: bw, dh: bh });
  return true;
}
