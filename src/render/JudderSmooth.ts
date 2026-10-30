// ★juddersmooth（2026-10-10,★已转正缺省开,?smooth=0 逃生门）——迟到帧半步混合
//  （judder smoothing,「视觉欺骗」刀;用户本日实报定谳:「系统负载高时 110-120+ 浮动,
//  高帧率也觉得卡;降到 60 仍 58-60 波动」;转正证据=实机体感「挺好的,效果还不错」）。
//
// 机理（定谳）:系统负载把回调交付推迟过 vsync 快照点（快照在网格点拍,迟到 1ms 即
//  错过本槽）→ 该槽重复上屏旧帧,内容一步跳两格（运动步长序列 0,2）=高帧率下依然
//  可感的卡顿本体;系统延迟尖刺（10-20ms 级）大于任何档位的槽位余量 → 降帧率无效
//  （60 锁的 8.3ms 余量照样被击穿=58-60 波动机理）。修=视觉欺骗:检测「本帧将跳槽」
//  （距上次上屏 > 档周期×JUDDER_MISS_RATIO）时,把上一真帧以 α=JUDDER_BLEND_ALPHA 叠
//  上当前帧——运动步长 0,2 → ≈0.5,1.5,眼睛读到近匀速;仅跳槽帧混合（瞬态）,常态
//  逐位直出。与 ghostblur 的区别:ghostblur=每帧恒定累积拖影（用户实测无体感收益）;
//  本刀=仅跳槽瞬间单帧半影,瞬态平滑非累积模糊。
//
// 成本模型（★v2 lazy-arming,2026-10-10 Trace-20261010T112144 定谳后刀A）:静默期
// 【零拷贝】（未武装=除 gap 判定外全旁路——首版每帧 1 次全屏捕获在 98% 饱和主线程
// 上占 6.9%=本刀清除）;跳槽即武装（捕获常备,后续跳槽享混合）,末次跳槽后
// JUDDER_ARM_HOLD_MS 静默自动退役。首次跳槽本身无 prev 不混合（吃一次原始跳,换
// 稳态零成本——跳槽成簇出现,首跳原价、后续全平滑）。退役时 prevCanvas 清位
// （陈旧真帧不得跨静默期混合=整屏旧画面鬼影）。
// v1 整帧混合（挂 Game tick 的 ghostFrameEnd 同族收口点=render() 完整返回后,全路径
// 唯一必经——GL/2D 回退/早退支全覆盖）:HUD 静态像素混合同值不重影,动画 HUD 位
// 瞬态半影（登记;若体感有碍,v2 收窄混合域）。双画布乒乓（prevRaw=上一真帧/capture=
// 本帧捕获槽）,混合发生在捕获【之后】→ prevRaw 恒为真帧,连续跳槽无拖影累积
// （0.25^k 污染面消除）。
// ★刀C 合并案证伪登记（2026-10-10）:「judder 捕获并入 c10e 合成省一次拷贝」不成立
// ——judder 需含 HUD 的终帧,c10e 产物只有 sky+gl;省拷贝的真解=GL 直出呈现架构
// （glCanvas 直接作显示层）,登记为架构级观察项不落本刀。
// 断流卫生:gap>JUDDER_BREAK_MS（tab 切换/暂停恢复）或 > 周期×8（长停顿）=不连续,
// 不混合只重捕获（长停顿后首帧混合=整屏鬼影,禁）。periodMs<=0（跟满档/未锚定）=
// 完全旁路。canvas 尺寸 0=terra-blink 截断家族判例,禁操作。
import { mkCanvas, type AnyCanvas, type Ctx2D } from './canvasEnv';

/** 跳槽判定系数:gap > 档周期×此值=本帧将跳槽。
 *  ★1.7 定线（2026-10-12 用户 A/B 转正:饱和场景「比 1.5 稳定」实测）——
 *  1.5 线在 realized<tier 时贴近自然帧距抖动带（104fps@120tier 抖 9-12ms vs 线
 *  12.5）→ 尾部频繁误混=每帧 1 全屏 op 加剧饱和（Trace-230353 周期性降帧定谳）;
 *  1.7（14.2ms 线）只混真大跳,混合频率降、体感更稳（用户实测定谳）。
 *  ?smoothline= 可调（clamp 1.05..8,回 1.5=旧行为 A/B 口）。 */
export let JUDDER_MISS_RATIO = (() => {
  try {
    if (typeof location === 'undefined') return 1.7;
    const v = Number(new URLSearchParams(location.search).get('smoothline'));
    return Number.isFinite(v) && v >= 1.05 && v <= 8 ? v : 1.7;
  } catch { return 1.7; }
})();
/** 测试/对拍翻面（生产代码禁调）。 */
export function judderLineSetForTest(v: number): void { JUDDER_MISS_RATIO = v; }
/** 断流阈值:gap 超此值=不连续（tab 隐藏/暂停恢复）,不混合只重捕获。 */
export const JUDDER_BREAK_MS = 250;
/** 半步混合系数（上一真帧叠加 α;0.5=步长 0,2 → 0.5,1.5 对称半步）。 */
export const JUDDER_BLEND_ALPHA = 0.5;
/** 长停顿上限:gap 超过周期×此值同断流处理（防暂停恢复首帧整屏鬼影）。 */
export const JUDDER_MAX_GAP_RATIO = 8;
/** ★v2 武装保持窗:末次跳槽后静默此毫秒自动退役（停捕获,零常态成本）。
 *  2000ms:覆盖负载尖刺簇（misses 成簇,簇间隔 <2s 保持武装;2s 干净=尖刺过去）。
 *  ★旋钮（2026-10-12 同上）:?smoothhold= 可调（clamp 200..10000）。 */
export let JUDDER_ARM_HOLD_MS = (() => {
  try {
    if (typeof location === 'undefined') return 2000;
    const v = Number(new URLSearchParams(location.search).get('smoothhold'));
    return Number.isFinite(v) && v >= 200 && v <= 10000 ? Math.round(v) : 2000;
  } catch { return 2000; }
})();
/** 测试/对拍翻面（生产代码禁调）。 */
export function judderHoldSetForTest(v: number): void { JUDDER_ARM_HOLD_MS = v; }
// ★v3 半分辨率捕获证伪撤案（2026-10-12,用户二报）:①「整画面含 HUD 自抖」=锐度
//  振荡——跳槽帧显示「锐利 cur+软 prev 混合」/干净帧纯锐利,两帧交替=全局闪抖;
//  ②「没什么改善」=Windows 成本在【op 数不在像素数】（bakenoread/IPC 每 op 税同族
//  判例）——半分辨率减像素不减 op 数。capture 改走 `copy` 合成单 op（v2 是
//  clearRect+drawImage 两 op;copy 整幅替换含 α=eventTintedSprite 先例）=武装期
//  每帧省一次全屏 op（clear），语义逐位（copy 恒等 clear+draw）。

/** 捕获单 op 化:copy 合成整幅替换（含 α）——main 画布 c10e 态 α:true 含透明区,
 *  source-over 需先 clear 两 op;copy 一步到位且语义=clear+source-over 恒等。 */

/** 纯判定（node 可测）:本帧是否「跳槽混合」帧。period<=0=旁路;gap<0=首帧/异常=否;
 *  断流（>JUDDER_BREAK_MS）与长停顿（>周期×JUDDER_MAX_GAP_RATIO）=否。 */
export function judderMissFrame(gapMs: number, periodMs: number): boolean {
  if (!(periodMs > 0) || !(gapMs >= 0)) return false;
  if (gapMs > JUDDER_BREAK_MS) return false;
  return gapMs > periodMs * JUDDER_MISS_RATIO && gapMs <= periodMs * JUDDER_MAX_GAP_RATIO;
}

/** ★juddersmooth 旗（★2026-10-27 用户令「先禁用」——缺省关,?smooth=1 显式开。
 *  禁用依据=实机 trace（同日,lightsteady 开+水域+翼装场景）--probe 归因:武装期
 *  全屏乒乓拷贝 549.6ms/20s=27.3ms/s(0.23ms/帧,drawImage 第一大调用方)——钟抖机
 *  （tick 早到 27%,错拍率 5.94%,见 memory/mac-tick-clock-jitter-118-124）「跳槽即
 *  武装+2s 保持」≈常驻武装,每帧两笔全屏拷贝;且其掩盖的钟抖用户仍可感知
 *  =花费与效果双失。灰度史:2026-10-10 ?smooth=1 灰度→同日转正缺省开→
 *  2026-10-27 禁用回缺省关（机制代码全保留,?smooth=1 可复开）。 */
export let judderSmooth = (() => {
  try {
    if (typeof location === 'undefined') return false;
    return new URLSearchParams(location.search).get('smooth') === '1';
  } catch { return false; }
})();
/** 测试/对拍翻面（生产代码禁调——生产只读 URLSearchParams 一次） */
export function judderSmoothSetForTest(v: boolean): void { judderSmooth = v; }

/** 帧尾时钟（测试注入;生产=performance.now）。 */
let nowFn: () => number = () => performance.now();
/** 测试时钟注入（生产禁调）。 */
export function judderClockForTest(fn: () => number): void { nowFn = fn; }

/** 画布工厂（测试注入桩;生产=canvasEnv.mkCanvas）。 */
let canvasFactory: (w: number, h: number) => AnyCanvas | null = mkCanvas;
/** 测试画布工厂注入（生产禁调）。 */
export function judderCanvasFactoryForTest(fn: (w: number, h: number) => AnyCanvas | null): void {
  canvasFactory = fn;
}

/** 模块级单例（可见画布单例;尺寸变化整组重建+prev 复位）。 */
let prevCanvas: AnyCanvas | null = null;
let captureCanvas: AnyCanvas | null = null;
let lastMs = -1;
/** ★v2 武装态:false=静默期（除 gap 判定外全旁路,零拷贝）;true=捕获常备+跳槽混合。 */
let armed = false;
/** 末次跳槽时刻（武装保持窗计时基;断流不重置——静默 2s 退役与断流正交）。 */
let lastMissMs = -Infinity;

/** 测试/对拍状态复位（生产禁调）。 */
export function judderResetForTest(): void {
  prevCanvas = null; captureCanvas = null; lastMs = -1; armed = false; lastMissMs = -Infinity;
  stats.frames = 0; stats.armedFrames = 0; stats.missFrames = 0; stats.blends = 0; stats.armCount = 0;
}

// ---- ★旋钮计数器（2026-10-12,Trace-230353 定谳后的数据面;探针页内 import 读）
const stats = { frames: 0, armedFrames: 0, missFrames: 0, blends: 0, armCount: 0 };
/** 累计账（载入起;探针取差分=窗口率）。armedFrames/frames=武装率;missFrames/armedFrames=混合密度。 */
export function judderStats(): { frames: number; armedFrames: number; missFrames: number; blends: number; armCount: number; armed: boolean } {
  return { ...stats, armed };
}

/** 帧尾收口（Renderer.judderFrameEnd 转发;Game tick 在 render() 完整返回后调用——
 *  与 ghostFrameEnd 同族挂接点论证）。periodMs=现役档周期（FrameBeat.tierPeriodNow;
 *  0=跟满/未锚定=旁路）。nowMs 参数仅供测试注入时钟。
 *  ★旋钮③暂停门（2026-10-12）:paused=画面静止（暂停浮层逐帧重绘,世界不变）——
 *  跳槽混合混合的是相同内容=纯浪费 → 全旁路。lastMs 不动:恢复帧 gap>断流阈走
 *  既有断流卫生（恢复首帧不混合）,零额外状态。 */
export function judderFrameEnd(ctx: Ctx2D | null, periodMs: number, nowMs?: number, paused = false): void {
  if (!judderSmooth || !ctx) return;
  if (!(periodMs > 0) || paused) return;                    // 跟满/未锚定/暂停:旁路（状态保留）
  const now = nowMs ?? nowFn();
  const gap = lastMs >= 0 ? now - lastMs : -1;
  lastMs = now;
  stats.frames++;
  const miss = judderMissFrame(gap, periodMs);
  // ★v2 lazy-arming:静默期（未武装）零拷贝;跳槽即武装;静默 JUDDER_ARM_HOLD_MS 退役。
  if (miss) { lastMissMs = now; stats.missFrames++; }
  if (!armed) {
    if (!miss) return;                                      // 静默期无跳槽:零拷贝旁路
    armed = true;                                           // 首次跳槽:武装（本帧无 prev 不混合,开始捕获）
    stats.armCount++;
    prevCanvas = null;                                      // 跨静默期的陈旧真帧作废（防整屏旧画面鬼影）
  } else if (now - lastMissMs > JUDDER_ARM_HOLD_MS) {
    armed = false;                                          // 静默 2s:退役
    prevCanvas = null;                                      // 退役清位（同上）
    return;
  }
  stats.armedFrames++;
  const cv = ctx.canvas;
  const w = cv.width, h = cv.height;
  if (w === 0 || h === 0) return;                           // terra-blink 截断家族:禁操作
  // 画布组管理:尺寸变化（窗口 resize）=捕獲槽重建+prev 复位（旧 prev 尺寸失配=无效）;
  // capture==null 的补充分配（乒乓初态/refill）保留 prev——★首版此处无条件 null prev
  // =乒乓自毁（swap 把 null 传回 capture→每帧重建→prev 恒 null→混合永不触发,本文件
  // 机械闸抓到）。resize 后经一帧 refill 换掉残留旧尺寸槽,第二帧起稳定。
  if (!captureCanvas || captureCanvas.width !== w || captureCanvas.height !== h) {
    const sizeChanged = captureCanvas !== null;
    captureCanvas = canvasFactory(w, h);
    if (!captureCanvas) { prevCanvas = null; return; }      // 无画布环境（node）:旁路
    if (sizeChanged) prevCanvas = null;                     // 尺寸变化:旧 prev 失效
  }
  const capCtx = captureCanvas.getContext('2d') as Ctx2D | null;
  if (!capCtx) return;
  const prev = prevCanvas;                                  // 混合源快照（乒乓交换前取）
  const blend = armed && prev !== null && miss;
  if (blend) stats.blends++;
  // ① 捕获本帧真值（混合【前】→ prevRaw 恒真帧,连续跳槽零拖影累积）。
  //  ★v3':`copy` 合成单 op 整幅替换（含 α）——v2 是 clearRect+drawImage 两 op,
  //  Windows 每 op 税域省一次全屏 op/clear（语义恒等:copy ≡ clear+source-over）。
  capCtx.globalCompositeOperation = 'copy';
  capCtx.drawImage(cv as CanvasImageSource, 0, 0);
  capCtx.globalCompositeOperation = 'source-over';
  // ② 跳槽混合:上一真帧半步叠上（globalAlpha 恢复由真 ctx save/restore 保证）
  if (blend && prev) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);                     // 页绝对坐标（c10e 合成同族习语）
    ctx.globalAlpha = JUDDER_BLEND_ALPHA;
    ctx.drawImage(prev as CanvasImageSource, 0, 0);
    ctx.restore();
  }
  // ③ 乒乓交换:本帧捕获槽晋升为 prevRaw,旧 prevRaw 槽降为下帧捕获槽
  const tmp = prevCanvas;
  prevCanvas = captureCanvas;
  captureCanvas = tmp;
}
