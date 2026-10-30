// 光照引擎(Terarria1456 Terraria.Graphics.Light/LightingEngine.cs 一比一)。
// 4 状态轮转(MinimapUpdate→ExportMetrics→Scan→Blur),每 tick 推进一态;
// dirty(tile 改动/区域移动/手持光)→ 同 tick 快进整个周期(原版传送双 LightTiles 技巧);
// liquidDirty → 同快进但 3 tick 节流(20Hz)。
// 替换原 BFS 引擎(备份见 docs/backup/LightingEngine.legacy.bak.ts)。
// ★C9d(2026-09-27)快照面/公共采样对分离:ensureRegion 只写快照面,公共 (区域,数组)
// 由三原子写点整体替换(worker 结果到达/applyPending/本地发布)——移动抖动定谳修复,
// 详见公共面字段头注与 tests/c9d-light-pair-atomicity。
import { TILE } from '../core/constants';
import { TileStore } from '../world/TileStore';
import { AREA_PADDING, globalBrightness, NON_VISIBLE_PADDING } from './lightTables';
import { FlickerClock } from './SkyColor';
import { LightMap } from './LightMap';
import { PerFrameLight, ScannerWorld, TileLightScanner } from './TileLightScanner';
import { LightWorkerLink, lightWorkerFlag, lightWorkerStats, lightSteadyFlag, noteLightResultSkipped, noteLightSteadySkip, noteLightWorkerRespawn } from './LightWorkerLink';
import { ladderDelayMs, workerRetryEnabled } from '../workers/WorkerGovernance';   // ★看门狗治理(2026-09-28)
import { SNAPSHOT_PAD, buildEngineSnapshot, buildSteadyFingerprint, type DecayArgs, type EngineCaptureView, type LightResultMsg, type LightSnapshotMsg } from './LightWorkerProtocol';

/** 引擎依赖的最小世界结构(World 结构兼容;单测可注入 fake) */
export interface LightingWorld {
  store: TileStore;
  groundLevel: number;  // 原版 worldSurface
  lavaLine: number;     // 原版 UnderworldLayer
  clock: { timeOfDay: number; dayCount: number };
}

const enum State { MinimapUpdate = 0, ExportMetrics = 1, Scan = 2, Blur = 3 }

// ---- ★C9c-v4 进场简化（2026-09-28 处方——弱机永久 warmup 根治;v1→v4 教训链 retained）----
// v1 固定 12ms 绝对阈的缺陷:lagMs=send→apply 端到端（含主线程消息调度延迟）,忙机
// （帧耗 ~8-20ms）恒超标（用户机 F5 实测恒 ~20>12）→ live 永不可达=warmup 本地
// 双跑【永久化】（trace:光照主线程残部 1911ms——exportTo 250+blurLine 172+
// processBlurPresent 171,worker 同跑;且双跑自身维持忙=正反馈锁死。「骤降难回升」
// 闩族合集的第三枚）。v2=滑动 p50 相对判据:进=1.5×TICK（容忍忙机 ≤1 tick 级调度
// 延迟）,出=2.5×TICK——★v2 出场缺陷（用户实报弱机光照延迟更新闪烁）:lag 20-60ms
// 震荡跨出阈→live/warmup 交替两源上屏闪烁,每次回退强制本地全周期=更卡→更深横跳
// 正反馈。v3=粘性 live:lag 只作【进场资格】（连续 8 拍 ≤进阈即入）,入后出场唯一
// 条件=看门狗级硬故障（2s 无回传/异常回执/onerror——LightWorkerLink 既有 fallback
// 面）;live 恒 1 tick 陈旧但稳定 > 新鲜/陈旧交替闪烁。
// ★v4 定谳（2026-09-28 双 trace 实证:Windows 霜月+本机黄昏——worker 线程空闲而
// 主线程跑本地光照双跑,light 残部 9.5-12% 墙钟）:v3 修了出场（粘性）但【进场条件】
// （连续 8 拍 lag≤25ms）在持续高压下永不满足——lag=send→apply 含主线程消息调度,
// 主线程忙 99% 时 lag 恒 50-200ms→8 连拍永不成→warmup 永久=双跑正反馈（v1 同病
// 换阈复发）。进场门槛是协调者的过度设计:C9c 的原始担忧（worker 病态陈旧倒灌）
// 已被 liveAuth 门（warmup 禁到达即应用,结果 1 tick 内经 applyPending 成对回填）
// 与看门狗（2s 硬故障永久回落）双兜底,lag 判据唯一实际效果=弱机永拒。
// v4=三级收敛终态（v1 永拒忙机→v2 出场横跳→v3 粘性出场→v4 进场简化）:
// 【进场】adaptive 模式 hasResult（首个健康结果）即 live;【lag 环】保留为纯诊断
// （good/bad/p50 记账不驱动门态,lightGateDiag 字段全兼容）;【出场】唯一条件=看门狗
// （v3 已是,exitReason='watchdog'）;?lightlag=ms 手动模式语义保留=绝对阈全语义
// （8 连拍 ≤阈进场+坏拍满 2 强制出场=v1 面,探针/强扭矩面）。
// worker 上下文禁 URL 探测（fork bomb 判例家族,恒自适应缺省）。
export const LIGHT_TICK_MS = 1000 / 60;
const LIGHT_LAG_MANUAL = (() => {
  try {
    if (typeof document === 'undefined') return 0;
    const v = Number(new URLSearchParams(location.search).get('lightlag'));
    return v > 0 ? v : 0;   // 0=未设→自适应模式
  } catch { return 0; }
})();
export const LIGHT_GATE_MODE: 'adaptive' | 'manual' = LIGHT_LAG_MANUAL > 0 ? 'manual' : 'adaptive';
/** 进/出阈（ms）:手动模式 enter=exit=lightlag 值（v1 语义）;自适应=p50 相对判据 */
export const LIGHT_LIVE_ENTER_MS = LIGHT_LAG_MANUAL > 0 ? LIGHT_LAG_MANUAL : LIGHT_TICK_MS * 1.5;
export const LIGHT_LIVE_EXIT_MS = LIGHT_LAG_MANUAL > 0 ? LIGHT_LAG_MANUAL : LIGHT_TICK_MS * 2.5;
const LIGHT_LIVE_ENTER = 8;
/** ★C9c-v4 门诊断面（F5 消费;模块级单例——引擎实例归 Game 内部,报告面免接线）。
 *  exitReason=出场原因（'watchdog'=看门狗级硬故障唯一出场;null=未出场）——v3 新增
 *  字段,F5 既有字段（live/good/bad/p50Ms/lastLagMs/enterMs/exitMs/mode/ring）全兼容。
 *  ★v4 语义:good/bad/p50/ring 全为纯诊断记账（不驱动门态）;live=门态本相。 */
export const lightGateDiag = {
  live: false, good: 0, bad: 0, p50Ms: 0, lastLagMs: 0,
  enterMs: LIGHT_LIVE_ENTER_MS, exitMs: LIGHT_LIVE_EXIT_MS, mode: LIGHT_GATE_MODE, ring: 0,
  exitReason: null as 'watchdog' | null,
};

/** ★C9c-v4 live 门步进（纯函数供单测）：lag 计拍保留=【纯诊断】（好拍/坏拍账本,
 *  lightGateDiag 消费面不变;不驱动门态——v3 起出场已删,v4 起进场亦不再看 lag）。
 *  【进场】adaptive 模式=hasResult（首个健康结果）即 live——v3「连续 8 拍 ≤进阈」
 *  在忙机（主线程忙 99%→lag 恒 50-200ms）永不满足=warmup 永久化（v1 同病换阈复发,
 *  见文件头注 v4 定谳;C9c 原始担忧=陈旧倒灌,由 liveAuth 门+看门狗双兜底）。
 *  【出场】adaptive 无 lag 出场——唯一条件=看门狗级硬故障（引擎 compute()
 *  !lw.healthy() 面,非本函数）。手动模式（enterMs===exitMs,?lightlag 面）语义
 *  保留=v1 绝对阈全形态:8 连拍 ≤阈+已有结果进场,坏拍满 2 强制出场（探针强扭矩
 *  面:小阈可稳定钉 warmup,大阈可稳定钉 live）。
 *  enterMs/exitMs 缺省取模块常量（生产路径 lwGate 无阈参调用,缺省值自带模式身份:
 *  自适应恒进<出;手动 enter=exit=lightlag）;fell 字段保留兼容（恒 false——v2
 *  复刻件对照面字段,lag 出场已删）。 */
export function liveGateStep(
  live: boolean, good: number, bad: number, lag: number, hasResult: boolean,
  enterMs: number = LIGHT_LIVE_ENTER_MS, exitMs: number = LIGHT_LIVE_EXIT_MS,
): { live: boolean; good: number; bad: number; fell: boolean } {
  // 计拍阈分态:warmup 对进阈、live 对出阈（手动模式两者相等=v1 绝对阈）;v4 起纯记账
  const threshold = live ? exitMs : enterMs;
  if (lag > threshold) { bad++; good = 0; }
  else if (lag > 0) { good++; bad = 0; }
  if (enterMs === exitMs) {
    // ★手动模式（?lightlag=ms）:v1 绝对阈全语义保留（探针/强扭矩面）
    if (!live) {
      if (hasResult && good >= LIGHT_LIVE_ENTER) live = true;
    } else if (bad >= 2) { live = false; good = 0; bad = 0; }
  } else {
    // ★v4 adaptive:首个健康结果即 live（忙机 8 连拍永不成=warmup 永拒定谳删除）
    if (hasResult) live = true;
  }
  return { live, good, bad, fell: false };
}

export class LightingEngine {
  world: LightingWorld;
  // ---- 公共面(与 Game.ts/Renderer.ts 契约,勿改) ----
  // ★C9d(2026-09-27)公共采样对=「最近一次成对结果」:区域 (rx,ry,rw,rh) 与数组
  // (r,g,b) 恒同锚,只允许三原子写点整体替换——①applyWorkerResult(onResult 到达)
  // ②LightWorkerLink.applyPending(兜底回填) ③processBlurAndPresent 尾部本地原子
  // 发布。ensureRegion 只写快照面,不再直改公共面。
  // 【抖动定谳】worker 化前本地路径同 tick 重算,区域先行平移不可见;worker 化后
  // 数组=1 tick 前 worker 结果,ensureRegion 每 tick 先行推原点 → 渲染采样窗口=
  // (区域 fresh_N+数组 fresh_{N-1}) 拆对 → lightAt 索引偏移每 tick 移动量(峰值
  // 1-2 格) → 光照格一抖一抖;onResult 到达才恢复成对,下 tick 又拆开=每 tick 循环
  // (主线程忙→结果晚到→拆对窗口更宽=渲染压力大区域更明显;C9b/C9c 均在拆对之后,
  // 未触碰此窗口)。tests/c9d-light-pair-atomicity 锁定。
  rx = 0; ry = 0; rw = 0; rh = 0;
  r: Uint8Array = new Uint8Array(0);
  g: Uint8Array = new Uint8Array(0);
  b: Uint8Array = new Uint8Array(0);
  // ---- ★C9d 快照面(引擎内部扫描锚) ----
  // ensureRegion 每 tick 收敛于此,可领先公共采样对(领先量≤每 tick 移动量,被
  // AREA_PADDING=28 完整覆盖:玩家合法移速峰值——步行 3px/tick≈0.19 格、疾跑靴
  // ~6px/tick≈0.38、冲刺/盾冲峰值 ~16px/tick=1.0、矿车 41mph≈8px/tick=0.5、加速
  // 轨道 ~20px/tick=1.25、终末坠落 10px/tick=0.625——峰值 ≤2 格/tick,padding 28
  // ⇒ 容忍 ≥14 tick 的结果滞后;本修复把公共面滞后钉在 ≤1 tick,余量 ≥28×)。
  // ★W4 口径（2026-10-01）:锚相机后上列峰值按【相机移速】计——常态=玩家移速同族
  // （follow 缓动 0.15×剩余）;跟拍链（高尔夫/无人机）首拍可达 ~30 格/拍、传送
  // lerp 首拍 ~5.3 格/拍——超 24 格/拍的拍经 snapCoveredByPublic 大跳门落本地
  // 同帧全周期（=vanilla 传送双 LightTiles 同款,无黑窗,一次性成本）。
  private snapRx = 0;
  private snapRy = 0;
  private snapRw = 0;
  private snapRh = 0;
  /** ★C9d2 本 tick 区域是否因移动而重算（ensureRegion 置位,Game 每 tick 先于
   *  compute 调用一次）——差量内容脏门用:dirty 由移动置位时不视为未记账写面 */
  private regionMovedDirty = false;
  /** 本地路径发布暂存(写满后才整体换装进公共面;仅尺寸变化时重分配。worker 镜像
   *  侧数组每帧 transfer 走 → detached 后 length=0 → 每帧自动重分配,与旧
   *  runSnapshotOnEngine ⑤「每帧 new Uint8Array」分配面等价。
   *  ★债3 池化（2026-10-04）:worker 壳可注入 pubPool——发布面尺寸失配时先池取
   *  （主线程退役回送的结果数组）,池空/尺寸失配才新分配;主线程恒 null=本地路径
   *  分配面零变化（位级金标 tests/light-worker-parity 兜底） */
  private pubR: Uint8Array = new Uint8Array(0);
  private pubG: Uint8Array = new Uint8Array(0);
  private pubB: Uint8Array = new Uint8Array(0);
  /** ★债3 池化:发布面池取钩子（仅 worker 镜像侧注入;need=区域格数,取到=三数组
   *  长度均 === need）。主线程恒 null——本地路径 pub 暂存复用语义不变。 */
  pubPool: ((need: number) => [Uint8Array, Uint8Array, Uint8Array] | null) | null = null;
  /** ★债3 池化:公共面当前数组是否 worker 结果（退役回送判据——仅 worker 产的数组
   *  可回送 worker 池;本地 pubR 暂存复用必须留在引擎侧,回送=每帧重分配+所有权混乱）。
   *  置位点=三原子写点①②（worker 结果应用）；清零点=③本地原子发布。 */
  private publicFromWorker = false;
  dirty = true;
  liquidDirty = false;
  heldLight: { tx: number; ty: number; r: number; g: number; b: number } | null = null;
  /** 玩家 buff 点光（光芒 11 / 狱火 116，Player.cs:9687-9690/:9896-9898 中心格
   *  【无条件】独立发射——与手持光源并存，引擎侧逐通道 max 合并
   *  （ApplyPerFrameLights :744 同原版 Vector3.Max，不叠加不优先） */
  buffLights: Array<{ tx: number; ty: number; r: number; g: number; b: number }> = [];
  /** 动态点光 API(原版 Lighting.AddLight;0-1 RGB)——每周期消费后清空 */
  addLight(x: number, y: number, r: number, g: number, b: number): void {
    this.perFrame.push({ x, y, r, g, b });
    this.dirty = true;
  }

  /** 本帧已注册的动态点光数（F5 调试报告只读 perFrame 长度） */
  get perFrameCount(): number { return this.perFrame.length; }

  // ---- 内部 ----
  private state: State = State.MinimapUpdate;
  private work = new LightMap();
  private active = new LightMap();
  private flicker = new FlickerClock();

  /** 全局闪烁时钟(mouseTextColor/cursorScale 等),资源条 HUD 等渲染层读取 */
  get clock(): FlickerClock { return this.flicker; }
  private scanner: TileLightScanner;
  private perFrame: PerFrameLight[] = [];
  private liqTick = 0;
  /** ★C9 光照 Worker 门面（?lightworker=1,缺省关=null）：快照发 worker、结果回填
   *  公共面;失联/异常 → 置 null 永久回落本地。镜像引擎在 worker 线程（LightWorker.ts）
   *  ★看门狗治理（2026-09-28）：「永久回落」退役——阶梯重生见 _lwRespawnAt。 */
  private _lw: LightWorkerLink | null = null;
  /** ★看门狗治理（2026-09-28）：阶梯重生排程（0=未排程;?wwretry=0 恒 0=旧终态语义）。
   *  重生=全新 LightWorkerLink（warmup 双跑,无黑窗）+ live 门重新进场。 */
  private _lwRespawnAt = 0;
  private _lwFallCount = 0;
  /** ★C9：Game 每帧 updateLightDecay 实参捕获（noteDecayArgs）——lightTables 模块级
   *  衰减/shimmer 状态无外部 setter,worker 侧按同参重放 updateLightDecay 同步演化 */
  private _lwDecay: DecayArgs | null = null;

  constructor(world: LightingWorld) {
    this.world = world;
    this.scanner = new TileLightScanner(this.flicker);
    world.store.onTileChanged(() => { this.dirty = true; });
    world.store.onLiquidChanged(() => { this.liquidDirty = true; });
    // ★C9：惰性建链（Worker 首帧 compute 才真正 spawn）;旗关恒 null=本地路径零分叉
    this._lwSpawn(world);
  }

  /** ★C9 链路装配（构造期 + 看门狗阶梯重生共用;2026-09-28 治理批提取）。
   *  全新 LightWorkerLink=warmup 双跑语义（结果未达期本地照算,无黑窗）。
   *  旗关恒 null=本地路径零分叉。 */
  private _lwSpawn(world: LightingWorld): void {
    if (!lightWorkerFlag) return;
    this._lw = new LightWorkerLink();
    // ★C9d2 二期:store 绑定（灰度写日志挂载+delta 帧世界直读）+ 内容脏门
    // （未记账直写面兜底:crater/隐形翻转/联机 liquid 等显式标脏且日志空 →
    //  全量锚帧;移动脏由 regionMoved 扣除,见 ensureRegion）
    this._lw.bindStore(world.store);
    // ★C9d2 内容脏门（精化）:dirty 且非移动且无点光活动且日志空 → 未记账直写面
    //  （crater/隐形翻转等显式标脏）→ 全量锚帧。liquidDirty 不入闸:静置液体世界
    //  Game 每帧标 liquidDirty 而零真实写（原语写走日志=精确）→ 入闸=恒全量退化
    //  （探针实测 idle 42/100 full）;联机 netApplyLiquid 直写面漏闸 → 锚帧自愈
    //  （登记债）。perFrame>0 说明 dirty 来自 addLight——点光与 tile 差量无关,
    //  随快照 per 通道每帧全量走。
    this._lw.contentDirtyGate = () => this.dirty && !this.regionMovedDirty && this.perFrame.length === 0;
    // ★C9b 到达即应用（2026-09-24）：结果回填点提前到消息到达——120fps 渲染下
    //  原起「下个 compute 才应用」会因主线程繁忙滑到下下 tick（间歇 33ms 割裂,
    //  用户实报）。region+数组成对原子回填（与 applyPending 同逻辑,compute 内
    //  的 applyPending 保留为兜底 no-op）。★C9d：回填收口到 applyWorkerResult
    //  (公共面三原子写点之一);快照区域由 ensureRegion 收敛于快照面,公共面对
    //  不再被 ensureRegion 拆开（移动抖动定谳修复,见公共面头注）。
    this._lw.onResult = (m) => { this.applyWorkerResult(m); };
    // ★R1b-1≡R2b-F7:applyPending 兜底支同款世代校验（过滤器注入,引擎持有
    //  快照面是唯一校验权威——link 不知 snap 区域）
    this._lw.pendingFilter = (m) => this.resultCoversViewport(m);
  }

  /** ★R1b-1≡R2b-F7 结果世代校验（2026-09-27）：worker 结果携带其快照区域——仅当
   *  该区域完整覆盖【当前快照视口】（内缩带,与 snapCoveredByPublic 同款数学）才
   *  接受回填。定谳机制链：传送大跳后本地全周期已发布新区域 B,在途旧快照 A 结果
   *  1 worker 往返后到达（忙机 33-66ms+）——无校验时 applyWorkerResult 把公共对
   *  回拨到 A,而 ensureRegion 区域未变 dirty=false、live 态早退门
   *  snapCoveredByPublic() 判 B 不被 A 覆盖仅落 step() 慢速纠正（≤4 tick）,期间
   *  lightAt 全域越界 [0,0,0]=世界黑窗（红）。校验后旧世代丢弃+计 cookieSkipped
   *  指纹,公共对保持 B（绿）。正常移动 ≤2 格/tick 在 AREA_PADDING=28 余量下恒
   *  覆盖=零误杀（C9d 快照面头注的移速算术）。 */
  private resultCoversViewport(m: LightResultMsg): boolean {
    const vx0 = this.snapRx + AREA_PADDING + 2, vy0 = this.snapRy + AREA_PADDING + 2;
    const vx1 = this.snapRx + this.snapRw - AREA_PADDING - 2;
    const vy1 = this.snapRy + this.snapRh - AREA_PADDING - 2;
    return m.rx <= vx0 && m.ry <= vy0 && vx1 < m.rx + m.rw && vy1 < m.ry + m.rh;
  }

  /** ★C9d 公共采样对三原子写点①：worker 结果到达（区域+数组同锚整体替换——渲染与
   *  lightAt/lightAtTo 全消费面只会读到成对一致值;单值 1 tick 陈旧但恒稳定）。
   *  ★R1b-1:世代校验不过=丢弃+skipped 指纹（不触碰公共对——三原子写点语义保持;
   *  被丢数组仍由 link.pending 持有——link 在覆写/兜底拒绝点回池,引擎不重复退役）。
   *  ★债3 池化:被替换的 worker 产旧公共数组 → retireResult 回送 worker 结果池
   *  （引用替换点=数组停止被公共面持有的唯一时刻;re-apply 同引用由 !== 守卫跳过） */
  private applyWorkerResult(m: LightResultMsg): void {
    if (!this.resultCoversViewport(m)) { noteLightResultSkipped(); return; }
    const oldR = this.r, oldG = this.g, oldB = this.b;
    this.rx = m.rx; this.ry = m.ry; this.rw = m.rw; this.rh = m.rh;
    this.r = m.R; this.g = m.G; this.b = m.B;
    if (this.publicFromWorker && this.r !== oldR) this.retireWorkerArrays(oldR, oldG, oldB);
    this.publicFromWorker = true;
    this._lw?.noteResultApplied(m);
  }

  /** ★债3 池化:worker 产公共数组退役（回送 link 队列→下帧快照随 transfer 回 worker;
   *  _lw 缺席（回落/销毁窗）=弃（GC），正确性无涉） */
  private retireWorkerArrays(R: Uint8Array, G: Uint8Array, B: Uint8Array): void {
    this._lw?.retireResult(R, G, B);
  }

  /** ★C9d 快照面直设（worker 镜像引擎 runSnapshotOnEngine / 对拍测试装配专用;
   *  生产主线程唯一入口=ensureRegion）。不动公共采样对——发布由本地周期或
   *  结果到达负责。 */
  setSnapshotRegion(rx: number, ry: number, rw: number, rh: number): void {
    this.snapRx = rx; this.snapRy = ry; this.snapRw = rw; this.snapRh = rh;
  }

  /** ★C9：Game 在每帧 updateLightDecay(...) 后调用（同参捕获,worker 重放同步） */
  noteDecayArgs(waterStyle: number, nightVision: boolean, blackout: boolean, blind: boolean,
    opts: { headcovered?: boolean; inShimmer?: boolean; ftwDecay?: 'queen' | 'temple' | 'dungeon' }): void {
    this._lwDecay = { waterStyle, nightVision, blackout, blind, opts };
  }

  /** ★C9：实例弃用前拆除 Worker 链（Game.destroy 调用）——不拆则跨世界旧 worker
   *  持续自跑（泄漏 + 双份 CPU） */
  dispose(): void {
    if (this._lw !== null) { this._lw.dispose(); this._lw = null; }
  }

  /**
   * 区域 = 相机视口 ± AREA_PADDING(原版 GetAreaToLight 边界 1..2 + ProcessScan 膨胀 28 合并)。
   * camCX/camCY 为像素;viewW/viewH 为 tile 数(Game 现有调用约定)。
   * ★W4（2026-10-01）锚定谳：参数名即语义——生产调用点（Game.tickLighting 三路）
   * 传【相机中心】(camera.x/y,原版 GetAreaToLight Main.cs:64888-64899 相机域 1:1);
   * 引擎本身锚无关（传什么锚什么,跳变由 regionMovedDirty/resultCoversViewport/
   * snapCoveredByPublic 三门承载）。
   * ★C9d：本方法只写【快照面】(snapRx/snapRy/snapRw/snapRh)+dirty 判定——公共采样
   * 对 (rx,ry,rw,rh,r,g,b) 不在此触碰(三原子写点,见公共面头注)。rw/rh 变更的数组
   * 重分配随之迁到发布面(公共数组尺寸随结果走)。
   */
  ensureRegion(camCX: number, camCY: number, viewW: number, viewH: number): void {
    const st = this.world.store;
    this.regionMovedDirty = false;   // ★C9d2 每 tick 重评（Game 调用序:ensureRegion→compute）
    const x0 = Math.max(0, Math.floor(camCX / TILE) - Math.ceil(viewW / 2) - 1 - AREA_PADDING);
    const y0 = Math.max(0, Math.floor(camCY / TILE) - Math.ceil(viewH / 2) - 1 - AREA_PADDING);
    const x1 = Math.min(st.w - 1, Math.floor(camCX / TILE) + Math.ceil(viewW / 2) + 2 + AREA_PADDING);
    const y1 = Math.min(st.h - 1, Math.floor(camCY / TILE) + Math.ceil(viewH / 2) + 2 + AREA_PADDING);
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    if (rw !== this.snapRw || rh !== this.snapRh || x0 !== this.snapRx || y0 !== this.snapRy) {
      this.regionMovedDirty = true;   // ★C9d2 移动脏（差量门扣除项）
      // 原点只在重算时原子移动(防光影相对世界平移)
      this.snapRx = x0; this.snapRy = y0;
      if (rw !== this.snapRw || rh !== this.snapRh) {
        this.snapRw = rw; this.snapRh = rh;
      }
      this.dirty = true;
    }
  }

  /** 每帧调用。dayFactor 参数弃用(天空色改由 clock 内部推导;旧调用方签名兼容)。 */
  compute(_dayFactor: number): void {
    if (this.snapRw === 0) return;   // ★C9d:门挪到快照面(公共面可能尚无首个结果)
    // ---- ★看门狗治理（2026-09-28）：阶梯重生分派 ----
    // 回落态（_lw=null）下阶梯（5s/10s/20s）到期即重建链路——全新 LightWorkerLink=
    // warmup 双跑语义（本地照常,无黑窗）,live 门重新进场。?wwretry=0 时恒不排程。
    if (this._lw === null && this._lwRespawnAt !== 0) {
      const nowR = performance.now();
      if (nowR >= this._lwRespawnAt) {
        this._lwRespawnAt = 0;
        this._lwSpawn(this.world);
        noteLightWorkerRespawn();
      }
    }
    // ---- ★C9 光照 Worker 分支（?lightworker=1）----
    // 快照（区域 ± padding tile 切片 + 时钟/天空/衰减/点光参数）发 worker,结果回填
    // 公共面。三态：warmup(结果未达)=快照+本地双跑兜底(首帧不黑屏) → live=worker
    // only(本地 scan/blur 整段跳过,主线程拿回 7-12%) → 失联看门狗（outstanding-
    // aware,2026-09-28 治理重构）/异常回执=dispose+回落本地+阶梯重生(dirty 强制
    // 首帧全周期)。时钟仍在主线程 tick
    // (HUD/渲染层 cursorScale/mouseTextColor 消费面照常);快照捕获 pre-tick 状态,
    // worker 侧恢复后由其 compute 的 tick 推进到同态(位级同相)。
    // ★C9b(2026-09-24)：结果应用点=消息到达瞬间(onResult),compute 内 applyPending
    // 仅作兜底——渲染帧可即时读到最新回传,120fps 下不再滑档。
    const lw = this._lw;
    if (lw !== null) {
      if (!lw.healthy()) {
        console.warn('[LightWorker] 看门狗回落 (' + lw.fallReason() + ',falls=' + lightWorkerStats().falls + ')');
        lw.dispose();
        this._lw = null;
        this.dirty = true;   // 回落后首帧强制全周期
        // ★C9c-v3/v4：live 的唯一出场=看门狗级硬故障（outstanding 超预算/异常回执/
        //  onerror;v4 进场简化后 lag 判据全面退役为诊断）
        // ——诊断面出场原因标记（F5 兼容新增字段;lag 驱动出场已删不产 'lag' 值）
        this.lwLive = false; this.lwGood = 0; this.lwBad = 0;
        lightGateDiag.live = false;
        lightGateDiag.exitReason = 'watchdog';
        // ★去永久化（2026-09-28 看门狗治理）：阶梯重生排程（5s/10s/20s;
        //  ?wwretry=0 逃生门=旧「回落即终态」语义）
        if (workerRetryEnabled()) {
          this._lwRespawnAt = performance.now() + ladderDelayMs(this._lwFallCount++);
        }
      } else {
        // ★C9c-v4：live 由门步进判定（hasResult 首个健康结果即 live;warmup 短窗期
        //  本地新鲜光优先,onResult 被 liveAuth 抑制;转 live 后到达即应用接管,
        //  compute 内 applyPending 降兜底）
        const live = this.lwGate(lw);
        // ★C9d：快照区域取本帧 ensureRegion 现值（快照面恒最新）。公共采样对=上一
        // 帧成对结果（结果未达时不回拨/不直改,渲染读 (区域,数组) 恒成对一致,值恒
        // =1 tick 前计算——AREA_PADDING=28 完整覆盖尾随量,见快照面头注）。
        const reg = { rx: this.snapRx, ry: this.snapRy, rw: this.snapRw, rh: this.snapRh };
        // ★债3 池化:applyPending 兜底支被替换的 worker 产旧公共数组退役（读侧快照
        //  —applyPending 内部先过世代校验,拒绝=公共面不动;成功且引用变化才退役）
        const pR = this.r, pG = this.g, pB = this.b;
        const pWasWorker = this.publicFromWorker;
        if (lw.applyPending(this)) {
          if (pWasWorker && this.r !== pR) this.retireWorkerArrays(pR, pG, pB);
          this.publicFromWorker = true;
        }
        // ★lwbp backpressure（2026-10-11,任务#15 刀②;Windows Trace-225221 postMessage
        //  self send 1039ms=每 op IPC 税,qs-mac-control-face 判例族）:在飞未回跳发
        //  本 tick 快照（send 率钳在 worker 实际消化率,快时零跳发）。warmup(非 live)
        //  恒发=建链前提;跳发帧语义:①快照面/写日志累积到下次实发（encodeDelta 容量
        //  溢出走既有 escalate 全量锚,正确性由 planFull 承担）②点光=逐 tick 重注册
        //  的无状态面,跳发帧照清（防重注册叠加双亮）③dirty/liquidDirty 只在实发时
        //  消费（清早了=差量门把历史写面当本帧=恒全量,注释同下）。?lwbp=0=恒发现状。
        const sent = !live || lw.sendReady();
        // ★稳态门（任务#26 常驻债#1 收口,2026-10-27）:lwbp 放行沿之上,稳态输入面
        //  （除恒动面 clock.timeOfDay/flicker/hourly——振荡器/昼夜推进,随实发拍到达）
        //  与上次实发全等 ∧ !dirty ∧ !liquidDirty ∧ 写日志空 → 跳发,连跳 ≤3 拍
        //  （idle 60→15 发/s;跳=lwbp 同族语义「结果暂陈旧非丢失」,呈现节拍与本地
        //  引擎稳态 4-tick 周期(原版 4 帧节奏)同款）。?lightsteady=1 灰度,缺省关。
        let steadySent = sent;
        if (sent && live && lightSteadyFlag && this._steadyRun < 3
          && this.steadyInputsUnchanged(reg)) {
          steadySent = false;
          this._steadyRun++;
          noteLightSteadySkip();
        }
        if (steadySent) {
          lw.send(this.buildWorkerSnapshot(reg));
          this._steadyRun = 0;
          this._steadySig = buildSteadyFingerprint(this.snapshotCap(reg), this.inWindowLogCount(reg));
        } else if (!sent) {
          lw.noteSendSkip();   // lwbp 在飞跳发(稳态跳发只计 steadySkips,不双计;run 保持=持续陈旧保守计)
        }
        if (live && this.snapCoveredByPublic()) {
          this.flicker.tick();        // HUD/渲染层闪烁消费面照常推进
          this.perFrame.length = 0;   // 点光已随快照带走(本地 processScan 不再跑;跳发帧=重注册面照清)
          // ★C9d2:live 态 dirty/liquidDirty 消费（外部只写不读,本引擎本地路径是唯一
          //  读面;不清则差量内容脏门把历史写面当本帧写面=恒全量）。回退路径
          //  dispose 处显式置 dirty=true,语义保持。★lwbp:跳发帧保留(下次实发消费)。
          if (sent) {
            this.dirty = false;
            this.liquidDirty = false;
          }
          return;
        }
        // live 态大跳（传送/召回/重生/读档/离屏截图分块——快照区域跳出公共采样域
        // 覆盖）→ 落本地全周期同帧兜底:vanilla 双 LightTiles 同帧出光对齐,消除
        // 「结果下一 tick 才到=公共域外黑窗」。罕见路径一次性 ~7-12% 帧成本,非
        // C9c-v3 的 lag 驱动逐 tick 双跑（粘性门语义不受影响）。
        // warmup：快照已发,本地照算兜底——tick 交给下方本地路径(勿双推进)
      }
    }
    this.flicker.tick();

    if (this.dirty) {
      this.runFullCycle();
      return;
    }
    if (this.liquidDirty) {
      this.liqTick++;
      if (this.liqTick % 3 !== 0) return; // 20Hz 节流
      this.runFullCycle();
      return;
    }
    // 空闲:每 tick 一态(完整周期 4 tick,原版 4 帧节奏)
    this.step();
  }

  /** ★C9c-v4 live 门状态（进场=首个健康结果;出场唯一=看门狗;见 liveGateStep） */
  private lwLive = false;
  private lwGood = 0;
  private lwBad = 0;

  /** ★C9c-v2 lag 滑动窗（最近 24 拍样本;尚无结果(≤0)不入窗）——★v4 起纯诊断面
   *  （p50 只进 lightGateDiag 不驱动门态;v1 逐拍绝对阈被调度延迟钉死的历史翻案面
   *  retained:F5/探针据此观察 send→apply 端到端分布） */
  private lwLagRing: number[] = [];
  /** ★C9c-v4 live 门（进场=hasResult 首个健康结果即 live——v3「连续 8 拍 ≤进阈」
   *  进场资格在忙机永不满足=warmup 永久化,定谳删除,见文件头注/liveGateStep 注;
   *  lag 环/p50 保留为纯诊断记账。唯一出场=compute() 看门狗级硬故障
   *  （diag.exitReason='watchdog'）。不限帧率饱和/进场 dirty 风暴期首结果前的
   *  warmup 短窗行为不变（本地 0 延迟新鲜光优先,代价 ≤首结果到达窗）;
   *  手动模式 ?lightlag=ms 保留 v1 绝对阈全形态（探针强扭矩面）。 */
  private lwGate(lw: LightWorkerLink): boolean {
    if (lw.lastLagMs > 0) {
      this.lwLagRing.push(lw.lastLagMs);
      if (this.lwLagRing.length > 24) this.lwLagRing.shift();
    }
    let p50 = 0;
    if (this.lwLagRing.length) {
      const sorted = [...this.lwLagRing].sort((a, b) => a - b);
      p50 = sorted[sorted.length >> 1];
    }
    const r = liveGateStep(this.lwLive, this.lwGood, this.lwBad, p50, lw.isLive());
    this.lwLive = r.live; this.lwGood = r.good; this.lwBad = r.bad;
    lw.liveAuth = this.lwLive;       // 到达即应用仅 live 态放行（C9c 倒灌修复）
    lightGateDiag.live = this.lwLive; lightGateDiag.good = r.good; lightGateDiag.bad = r.bad;
    lightGateDiag.p50Ms = p50; lightGateDiag.lastLagMs = lw.lastLagMs;
    lightGateDiag.ring = this.lwLagRing.length;
    return this.lwLive;
  }

  /** ★C9：组装每帧快照（区域捕获值 + 点光/时钟/天空/衰减;tile 切片由门面暂存切出）。
   *  读表面清单见 LightWorkerProtocol 头注——快照协议的契约边界。
   *  ★C9d2：切片经 buildWorkerTiles（灰度 delta 帧免 416KB 切片,全量帧池化）。 */
  private buildWorkerSnapshot(reg: { rx: number; ry: number; rw: number; rh: number }): Omit<LightSnapshotMsg, 'op' | 'seq'> {
    const lw = this._lw!;
    const tiles = lw.buildWorkerTiles(reg.rx, reg.ry, reg.rw, reg.rh);
    return buildEngineSnapshot(this.snapshotCap(reg), tiles, 0);
  }

  /** 快照捕获视图（buildWorkerSnapshot 与稳态指纹共用单源——字段清单漂移=指纹漏
   *  记输入面,tests/light-steady-gate 键集锚定守卫） */
  private snapshotCap(reg: { rx: number; ry: number; rw: number; rh: number }): EngineCaptureView {
    return {
      rx: reg.rx, ry: reg.ry, rw: reg.rw, rh: reg.rh,
      world: this.world,
      flicker: this.flicker,
      heldLight: this.heldLight,
      buffLights: this.buffLights,
      perFrame: this.perFrame,
      decay: this._lwDecay,
    };
  }

  // ---- ★稳态门（任务#26 常驻债#1 收口,2026-10-27;机制全注见 LightWorkerLink
  //      lightSteadyFlag 声明处）:稳态=输入面（除恒动面 clock.timeOfDay/flicker/
  //      hourly——振荡器/昼夜推进,随实发拍到达）与上次实发全等 → 跳发,连跳 ≤3 拍
  //      （1/4 率,idle 60→15 发/s）。tile/liquid 原语写按【窗内】判（窗外世界演化
  //      不影响结果——实测 idle 主源=植被生长窗外写每 ~2.8 tick 一发,全局 dirty
  //      判会把稳态打回 38/s）;未记账直写面不进门——≤3 拍陈旧后下次实发经内容
  //      脏门（dirty∧日志空→全量锚）自愈=有界陈旧,lwbp 同族（跳=延迟非丢失,
  //      写日志累积到下次实发,锚帧界随发率弹性）。 ----
  /** 上次实发的稳态指纹（null=未实发过,恒判「已变」） */
  private _steadySig: string | null = null;
  /** 连续稳态跳发拍数（实发即清零） */
  private _steadyRun = 0;
  /** 快照切片窗内有写日志条目的格数（窗=sliceGeometry 同款 ±SNAPSHOT_PAD 数学,
   *  与 worker 可见面精确同界——窗外写不进指纹） */
  private inWindowLogCount(reg: { rx: number; ry: number; rw: number; rh: number }): number {
    const st = this.world.store;
    const log = (st as { tileWriteLog?: number[] | null }).tileWriteLog;
    if (!log || log.length === 0) return 0;
    const sx = Math.max(0, reg.rx - SNAPSHOT_PAD), sy = Math.max(0, reg.ry - SNAPSHOT_PAD);
    const ex = Math.min(st.w, reg.rx + reg.rw + SNAPSHOT_PAD), ey = Math.min(st.h, reg.ry + reg.rh + SNAPSHOT_PAD);
    let n = 0;
    for (let i = 0; i < log.length; i++) {
      const idx = log[i];
      const x = idx % st.w, y = (idx - x) / st.w;
      if (x >= sx && x < ex && y >= sy && y < ey) n++;
    }
    return n;
  }
  /** 稳态输入面是否与上次实发全等（指纹含窗内写账;dirty/liquidDirty 不进门——
   *  未记账面走「下次实发内容脏门全量锚」有界自愈,见块头注） */
  private steadyInputsUnchanged(reg: { rx: number; ry: number; rw: number; rh: number }): boolean {
    if (this._steadySig === null) return false;
    return buildSteadyFingerprint(this.snapshotCap(reg), this.inWindowLogCount(reg)) === this._steadySig;
  }

  /** ★C9d：快照【视口】是否被公共采样对完整覆盖（live 态早退门——覆盖=尾随 ≤1 tick
   *  的光照照常可用;不覆盖=传送级跳变,视口落在公共域外/边缘带,走本地同帧兜底）。
   *  判据对象是视口（区域去 padding 带:ensureRegion 数学 x0=P+1/x1=P+2 内缩,此处各
   *  再收 1 格保守）而非整块区域——正常移动时区域原点每 tick 平移,padding 带必然
   *  露出,但视口被上帧区域覆盖余量=28−每 tick 移速 ≥26 格,永不触发;结果滞后 N
   *  tick 时余量=28−N×移速,≥14 tick 滞后内仍覆盖（峰值移速算术见快照面头注）。 */
  private snapCoveredByPublic(): boolean {
    const vx0 = this.snapRx + AREA_PADDING + 2, vy0 = this.snapRy + AREA_PADDING + 2;
    const vx1 = this.snapRx + this.snapRw - AREA_PADDING - 2;
    const vy1 = this.snapRy + this.snapRh - AREA_PADDING - 2;
    return vx0 >= this.rx && vy0 >= this.ry
      && vx1 < this.rx + this.rw && vy1 < this.ry + this.rh;
  }

  /** 快进:同 tick 完成 Scan→Blur→Present(状态回 0) */
  private runFullCycle(): void {
    this.dirty = false;
    this.liquidDirty = false;
    this.liqTick = 0;
    this.processScan();
    this.processBlurAndPresent();
    this.state = State.MinimapUpdate;
  }

  private step(): void {
    switch (this.state) {
      case State.MinimapUpdate: // 空槽(小地图导出未移植;保留维持 4 tick 周期)
      case State.ExportMetrics: // 空槽(SceneMetrics 在 VanillaSpawner 独立实现)
        break;
      case State.Scan:
        this.processScan();
        break;
      case State.Blur:
        this.processBlurAndPresent();
        break;
    }
    this.state = (this.state + 1) % 4;
  }

  private processScan(): void {
    const w = this.world as ScannerWorld;
    // ★C9d:扫描锚=快照面（旧 this.rx/ry/this.rw/rh——live 态下公共面不再被
    //  ensureRegion 先行平移,warmup 期 applyPending 也不再回拨扫描原点）
    this.work.setSize(this.snapRw, this.snapRh);
    this.work.nonVisiblePadding = Math.min(NON_VISIBLE_PADDING, (Math.min(this.snapRw, this.snapRh) - 1) >> 1);
    // 手持光源:RGB 来自 TorchID.TorchColor(原版 ItemCheck_EmitHeldItemLight 按火把种类取色)
    const perFrame = this.perFrame;
    if (this.heldLight) perFrame.push({ x: this.heldLight.tx, y: this.heldLight.ty, r: this.heldLight.r, g: this.heldLight.g, b: this.heldLight.b });
    for (const L of this.buffLights) perFrame.push({ x: L.tx, y: L.ty, r: L.r, g: L.g, b: L.b });
    this.scanner.exportTo(w, this.work, this.snapRx, this.snapRy, perFrame);
    perFrame.length = 0;
  }

  private processBlurAndPresent(): void {
    this.work.blur();
    // Present(LightingEngine.cs:131-135):交换双缓冲 + 导出 ×1.2 到公共面
    const tmp = this.active;
    this.active = this.work;
    this.work = tmp;
    // ★C9d 本地路径原子发布（三写点③）:导出进发布暂存（尺寸=快照面）,写满后
    // 区域+数组整体换装——与 worker 结果同纪律,本地/worker 两路同原子语义。
    // 暂存复用仅尺寸变化重分配;worker 镜像侧每帧 transfer detached → length=0
    // → 每帧新分配（与旧 runSnapshotOnEngine ⑤ 分配面等价）。
    // ★债3 池化（2026-10-04）:尺寸失配时先池取（worker 壳注入;主线程恒 null=
    // 本地路径分配面零变化）——worker 镜像侧稳态零分配（池=主线程退役回送的结果数组）。
    const need = this.snapRw * this.snapRh;
    if (this.pubR.length !== need) {
      const pooled = this.pubPool !== null ? this.pubPool(need) : null;
      if (pooled !== null) {
        this.pubR = pooled[0]; this.pubG = pooled[1]; this.pubB = pooled[2];
      } else {
        this.pubR = new Uint8Array(need);
        this.pubG = new Uint8Array(need);
        this.pubB = new Uint8Array(need);
      }
    }
    const outR = this.pubR, outG = this.pubG, outB = this.pubB;
    const ar = this.active.r, ag = this.active.g, ab = this.active.b;
    const scale = globalBrightness * 255;
    for (let i = 0; i < need; i++) {
      // 原版 ExportTo(LT57:231-233)是 `(int)(color*num)` 截断,非四舍五入。
      // 2026-09-19:`>=255 ? 255 : |0` 与旧 `Math.min(255, Math.trunc(v))` 全域等值
      // (v≥0 截断=|0;NaN:|0=0=ToUint8(NaN);Inf→255;-0.5:|0=0=ToUint8(-0);
      //  负值两侧同为 ToUint8(trunc(v))——光照图无负值,纯防御),省 3 对内建调用
      const vr = ar[i] * scale, vg = ag[i] * scale, vb = ab[i] * scale;
      outR[i] = vr >= 255 ? 255 : vr | 0;
      outG[i] = vg >= 255 ? 255 : vg | 0;
      outB[i] = vb >= 255 ? 255 : vb | 0;
    }
    // 发布（★C9d 三写点③）:区域与数组同锚整体换装,渲染侧永不观察中间态。
    // ★债3 池化:被本地发布替换的 worker 产旧公共数组退役回送（warmup 期/
    //  传送大跳本地兜底路径——worker 数组被本地 pubR 覆写的唯一时刻）
    const pubOldR = this.r, pubOldG = this.g, pubOldB = this.b;
    this.rx = this.snapRx; this.ry = this.snapRy;
    this.rw = this.snapRw; this.rh = this.snapRh;
    this.r = this.pubR; this.g = this.pubG; this.b = this.pubB;
    if (this.publicFromWorker && this.r !== pubOldR) this.retireWorkerArrays(pubOldR, pubOldG, pubOldB);
    this.publicFromWorker = false;
  }

  /** 取某 tile 光照(区域外返回 0;原版 GetColor 区域外语义) */
  lightAt(tx: number, ty: number, _dayFactor = 0): [number, number, number] {
    if (tx < this.rx || ty < this.ry || tx >= this.rx + this.rw || ty >= this.ry + this.rh) return [0, 0, 0];
    const i = (ty - this.ry) * this.rw + (tx - this.rx);
    return [this.r[i], this.g[i], this.b[i]];
  }

  /** ★C6 雨雪（2026-09-23）：lightAt 的零分配变体——结果写进调用方缓冲
   *  out[0..2],返回 out。逐位同值（同界外 0 语义/同索引式/同 0-255 域）；
   *  消费面=drawRain 逐滴采样（750 滴/帧 × 每次新建数组 = 雨天 ~90MB/s 级
   *  GC 流量,用户实机 trace 侧证 GC 面来自渲染热路径分配）。out.length<3
   *  时调用方契约违例（不兜底,尽早暴露）。 */
  lightAtTo(tx: number, ty: number, out: number[]): number[] {
    if (tx < this.rx || ty < this.ry || tx >= this.rx + this.rw || ty >= this.ry + this.rh) {
      out[0] = 0; out[1] = 0; out[2] = 0;
      return out;
    }
    const i = (ty - this.ry) * this.rw + (tx - this.rx);
    out[0] = this.r[i]; out[1] = this.g[i]; out[2] = this.b[i];
    return out;
  }
}

// ---- Utils.PlotLine / PlotTileLine 一比一(Utils.cs:2359-2415/:2460-2487;2026-09-03
//      荧光体 5107 手持光接线引入,玩家侧消费见 Player.emitMagiluminescenceLight) ----

/** Utils.PlotLine(Utils.cs:2359-2415):Bresenham 整数步进——陡线(x/y 斜率)先 Swap,
 *  终点格【不落】(`i != x1` 前闭后开);jump=false 时斜步双落点(中途格也 plot)。
 *  plot 返回 false 即中断并整线返回 false(调用方以此做界外/实体截断) */
export function plotLine(x0: number, y0: number, x1: number, y1: number,
  plot: (x: number, y: number) => boolean, jump = true): boolean {
  if (x0 === x1 && y0 === y1) return plot(x0, y0);
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  if (steep) { [x0, y0, x1, y1] = [y0, x0, y1, x1]; }
  const num = Math.abs(x1 - x0);
  const num2 = Math.abs(y1 - y0);
  let num3 = Math.trunc(num / 2);
  let num4 = y0;
  const num5 = x0 < x1 ? 1 : -1;
  const num6 = y0 < y1 ? 1 : -1;
  for (let i = x0; i !== x1; i += num5) {
    if (!plot(steep ? num4 : i, steep ? i : num4)) return false;
    num3 -= num2;
    if (num3 >= 0) continue;
    num4 += num6;
    if (!jump && !plot(steep ? num4 : i, steep ? i : num4)) return false;
    num3 += num;
  }
  return true;
}

/** Utils.PlotTileLine(Utils.cs:2460-2487):宽 width(世界像素)的"粗线"——沿线方向
 *  单位向量取垂直向量 ×(width/2) 得 ± 平行偏移(只在起点算一次,全段共用),对中线
 *  Bresenham 逐点再画 minOffset→maxOffset 的垂直短线(jump=false)。start/end 为
 *  世界像素坐标,格坐标换算 = Math.trunc(px/16)(Vector2.ToTileCoordinates 截断语义)。
 *  ★零长线退化保真:start==end(velocity==0 臂)时原版 normalize=0/0=NaN →
 *  (int)NaN = 0x80000000 不定值偏移 → 内层垂直短线落界外 → CastLightOpen 界外
 *  返回 false 整臂无光(荧光体站定帧只剩 Left→Right 横贯臂布光,原版即此行为) */
export function plotTileLine(sx: number, sy: number, ex: number, ey: number,
  width: number, plot: (x: number, y: number) => boolean): boolean {
  const half = width / 2;
  const dx = ex - sx, dy = ey - sy;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;       // len==0 → 0/0=NaN(与 C# float 除零同语义)
  const px = -uy * half, py = ux * half;    // ±val3(NaN 传播)
  const toTile = (v: number): number => (Number.isNaN(v) ? -2147483648 : Math.trunc(v / 16));
  const mx = toTile(sx - px), my = toTile(sy - py);   // start−val3
  const nx = toTile(sx + px), ny = toTile(sy + py);   // start+val3
  const x0 = toTile(sx), y0 = toTile(sy);
  const x1 = toTile(ex), y1 = toTile(ey);
  const offMinX = mx - x0, offMinY = my - y0;
  const offMaxX = nx - x0, offMaxY = ny - y0;
  return plotLine(x0, y0, x1, y1, (x, y) =>
    plotLine(x + offMinX, y + offMinY, x + offMaxX, y + offMaxY, plot, false));
}
