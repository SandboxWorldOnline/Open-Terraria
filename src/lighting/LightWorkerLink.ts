// ★C9 光照引擎 Worker 化·主线程门面（2026-09-23;?lightworker=1 缺省关）。
// 承 C8 WaveWorker 模式：URL 参数旗（本旗缺省关,=1 显式启用）、new Worker(module)
// 导入模块本体、失联看门狗 2s terminate+回落、onerror 日志。
// 职责：
//   · buildSlice——扫描区域 ± SNAPSHOT_PAD 的 13 通道 tile 切片（行主序逐行 memcpy,
//     世界边界钳制;钳后余量 (px,py) 随包带走=worker 侧 InWorld 折叠精确性依赖,见协议头注）
//   · send——快照 postMessage（结构克隆;每帧全量,v1 不做脏标优化）
//   · applyPending——worker 结果回填引擎公共面（r/g/b 数组引用替换 + 区域回填;
//     引擎在 compute 内调用=渲染读 (区域,数组) 恒成对一致,1 帧滞后）
//   · healthy——outstanding-aware 看门狗（2026-09-28 治理重构:warmup 15s/稳态 2s
//     预算+双拍确认闩+onerror 硬证据直杀;引擎 dispose+阶梯重生,不再永久回落）
// 三态：warmup（结果未达:快照+本地双跑=首帧不黑屏）→ live（worker only）→
// fallback（_lw 置 null,本地照常,dirty 强制全周期;阶梯到期重生重建链路）。
import {
  SNAPSHOT_PAD, TILE_CHAN_KEYS, TILE_CHAN_BYTES_PER_CELL, LIGHT_DELTA_VERSION,
  LightDeltaEncoder, sliceGeometry, allocSliceChannels,
  type LightPoolMsg, type LightResyncMsg, type LightResultMsg, type LightSnapshotMsg, type ResultTriple, type TileSlicePack,
} from './LightWorkerProtocol';
import { WorkerWatchdog, newFallsBy, type WorkerFallReason } from '../workers/WorkerGovernance';
import { lightWasmEnabled } from '../wasm/lightWasm';
import type { TileStore } from '../world/TileStore';

/** ★C9 转正（2026-09-24）：缺省开——逐字节对拍三场景全等+浏览器探针 1:1 零丢包
 *  +133 守卫绿后转正。?lightworker=0 = 逃生门（回主线程光照引擎）。
 *  ★C8 fork bomb 范畴禁令：document 存在性判定——worker 上下文恒 false（worker 里
 *  旗若为 true 会让镜像引擎的 compute 再 spawn 同脚本子 worker=每帧消息沿链 spawn） */
export const lightWorkerFlag = (() => {
  try {
    return typeof document !== 'undefined' && new URLSearchParams(location.search).get('lightworker') !== '0';
  } catch { return true; }
})();

/** ★C9d2 二期快照差量化（2026-09-28）：★转正（2026-09-29 用户拍板）缺省开——
 *  位等价证据（11 帧演化场景 worker 重建切片≡fresh buildSlice 13 通道逐位+光照输出
 *  逐位）+快照 24.4MB/s→0.6MB/s（41×）+主线程残部 200µs→~0.01ms。?lightdelta=0=
 *  逃生门（回全量切片 transferable 链,Layer 1 仍生效）。仅 lightworker 开时有消费方;
 *  旗关时引擎无链路,本旗无效果。关:全量切片 transferable+回池（Layer 1）;
 *  开:差量帧免 416KB 切片（写日志+暴露带编码）;★全量锚帧亦 transferable+回池
 *  （2026-10-04,结构克隆退役——内容影子降级几何记账,见 LightDeltaEncoder 类注）。
 *  设计/判据链见 LightWorkerProtocol「C9 二期」段与探针 _c9d2-light-residual-probe。
 *  node/worker 上下文恒关（document 判死,fork bomb 判例家族）。 */
export const lightDeltaFlag = (() => {
  try {
    if (typeof document === 'undefined') return false;
    return new URLSearchParams(location.search).get('lightdelta') !== '0';
  } catch { return false; }
})();

/** ★lwbp backpressure（2026-10-11,任务#15 刀②;Windows Trace-225221 定谳:主线程
 *  postMessage self 1522ms(light send 1039+wave frame 471) vs Mac 对照面 231ms——
 *  Mac 以 4× 帧率发更多消息反便宜 10-20×/条 = Windows 每 op IPC 税
 *  （qs-mac-control-face 判例族:bakenoread 同构）。修=在飞门:worker 回包未达
 *  （1:1 回执约定）不派下一快照,send 率自动钳在 worker 实际消化率——快时零跳发
 *  （零延迟损失）,慢时指数退让。?lwbp=0 逃生门=每 tick 恒发现状逐位。
 *  let+setter（SM2 池化同款）:node/测试域 URL 缺席恒 false→测试经 setter 显式开。 */
export let lwbpFlag = (() => {
  try {
    if (typeof document === 'undefined') return false;
    return new URLSearchParams(location.search).get('lwbp') !== '0';
  } catch { return false; }
})();
export function setLwbpEnabled(v: boolean): void { lwbpFlag = v; }

/** ★稳态门旗（任务#26 常驻债#1 收口,2026-10-27）：★转正缺省开（2026-10-27 用户令
 *  「转正」;实机 trace 复核 LightWorker busy 4.1% vs 旗关口径 ~9.6% =2-4× 削减,
 *  falls=0/lag 2ms 链路健康）;?lightsteady=0 逃生门=逐位现状（每 tick 恒发）。
 *  稳态=快照输入面（除恒动面 clock.timeOfDay/flicker/hourly）与上次实发全等 →
 *  跳发,最多连跳 3 拍（1/4 率,idle 60→15 发/s;主线程 ~60µs/发 + worker 全周期
 *  光照计算 4× 削减——Windows 每 op IPC 税 10-20× 面收益更大,lwbp 注 Trace-225221
 *  判例族）。跳发语义与 lwbp 同族（跳=结果暂陈旧非丢失;本地引擎稳态本就 4-tick
 *  周期=原版 4 帧节奏,呈现节拍 15Hz 与本地/原版同款）。灰度史:2026-10-27 当日
 *  ?lightsteady=1 灰度落地→同日 live A/B(60→15.3 发/s,falls=0)+用户实机 trace
 *  复核后转正。node/测试域恒 false→测试经 setter 显式开。 */
export let lightSteadyFlag = (() => {
  try {
    if (typeof document === 'undefined') return false;
    return new URLSearchParams(location.search).get('lightsteady') !== '0';
  } catch { return false; }
})();
export function setLightSteadyEnabled(v: boolean): void { lightSteadyFlag = v; }

/** 引擎公共面回填目标（结构最小面,避免与 LightingEngine 运行时互相导入） */
export interface LightTarget {
  rx: number; ry: number; rw: number; rh: number;
  r: Uint8Array; g: Uint8Array; b: Uint8Array;
}

/** C9 诊断计数器（探针对账:posted(快照发出)/results(回达)/falls(看门狗回落)/
 *  lagMs(最近一次结果 send→apply 端到端延迟,含 worker 计算+主线程消息调度)。
 *  ★R1b-1≡R2b-F7 增 skipped=世代校验丢弃的晚到旧结果数（传送大跳在途旧世代,
 *  校验判据在引擎 resultCoversViewport——计数器收口在本模块诊断面）。纯读面。
 *  ★C9d2 二期增:tileBytes=tile 载荷累计字节（全量=17B/格×格数,delta=meta+data;
 *  探针/验收② MB/s 口径）、fmt.full/fmt.delta=两形态计数、poolHits/poolMisses=
 *  切片池命中/未命中（Layer 1 分配面收口对账）、resyncs=worker 重锚请求数。
 *  ★看门狗治理（2026-09-28）增:fallsBy=回落指纹三分类(onerror/no-result-dead/
 *  pickup-timeout)、respawns=阶梯重生执行次数（引擎重生分派时登记;F5 驾驶舱扩展）。 */
const lwStat = { posted: 0, results: 0, falls: 0, lagMs: 0, skipped: 0,
  tileBytes: 0, fmt: { full: 0, delta: 0 }, poolHits: 0, poolMisses: 0, resyncs: 0,
  lastFullReason: 'off' as string,
  // ★债2/债3 池化（2026-10-04）对账面:retSent/retDropped=结果数组退役回送/容量弃;
  //  resPoolTakes/resPoolMisses=worker 结果池取/未中（随 rp 回传的 worker 累计值）;
  //  deltaPoolHits/deltaPoolMisses=编码器 delta scratch 池命中/未中（主线程本地）。
  retSent: 0, retDropped: 0, resPoolTakes: 0, resPoolMisses: 0, deltaPoolHits: 0, deltaPoolMisses: 0,
  fallsBy: newFallsBy(), respawns: 0,
  // ★lwbp（2026-10-11 刀②）:bpSkips=在飞门跳发 tick 数（F5/探针对账面——跳发率=
  //  worker 消化压力直读;恒 0=worker 不慢,门无感）。
  // ★稳态门（任务#26,2026-10-27,已转正缺省开）:steadySkips=稳态跳发 tick 数
  //  （?lightsteady=0 逃生门关时恒 0;idle 稳态应≈45/s(60→15);开着却恒 0=输入面
  //  恒变——探针/验收对账面）。
  bpSkips: 0, steadySkips: 0 };
/** ★R1b-1:引擎侧世代校验丢弃一个晚到结果时登记（探针/F5 对账面） */
export function noteLightResultSkipped(): void { lwStat.skipped++; }
/** ★稳态门（任务#26）:引擎稳态跳发登记（对账面,见 lwStat.steadySkips） */
export function noteLightSteadySkip(): void { lwStat.steadySkips++; }
/** ★看门狗治理:引擎阶梯重生分派时登记（F5 respawns 消费面） */
export function noteLightWorkerRespawn(): void { lwStat.respawns++; }
export function lightWorkerStats(): { on: boolean; posted: number; results: number; falls: number; lagMs: number; skipped: number;
  tileBytes: number; fmt: { full: number; delta: number }; poolHits: number; poolMisses: number; resyncs: number;
  lastFullReason: string;
  retSent: number; retDropped: number; resPoolTakes: number; resPoolMisses: number; deltaPoolHits: number; deltaPoolMisses: number;
  fallsBy: Record<WorkerFallReason, number>; respawns: number; bpSkips: number; steadySkips: number } {
  return { on: lightWorkerFlag, ...lwStat, fmt: { ...lwStat.fmt }, fallsBy: { ...lwStat.fallsBy } };
}

export class LightWorkerLink {
  private worker: Worker | null = null;
  private startedAt = 0;
  private lastResultAt = 0;
  private results = 0;
  private errored = false;
  private dead = false;
  private pending: LightResultMsg | null = null;
  /** ★债3 池化:pending 载荷已被应用（到达即应用/liveAuth 支,引擎 applyWorkerResult
   *  成功经 noteResultApplied 登记）——此时 pending 数组=公共面活体,覆写/兜底拒绝
   *  点【禁止】退役（否则回送在渲染读的活数组=detach 公共面）;false=数组仅 pending
   *  持有,失去 pending 引用即孤儿 → 退役回池。 */
  private pendingApplied = false;
  /** ★债3 池化:退役结果数组队列（引用替换点收集,随下帧快照 transfer 回 worker
   *  结果池;深度 8 封顶——传送风暴期在途 skipped 结果突发,溢出弃（GC,仅失回收） */
  private _retired: ResultTriple[] = [];
  private seq = 0;
  private lastSentAt = 0;
  /** ★lwbp（2026-10-11 刀②）:已完成回执计数（1:1 回执约定——frame 结果经
   *  arriveResult、致命 error 通知各冲账一次）。outstanding = seq − _doneCount;
   *  sendReady()=outstanding<1。error 冲账理由:error 即链路将回落（lwGate/watchdog
   *  接管）,账面必须解锁防 live 链饿死等一个永不回来的回执。 */
  private _doneCount = 0;
  /** ★看门狗治理（2026-09-28）:outstanding-aware 心跳（旧「2s 无回传即杀」的墙钟
   *  判据退役——主线程忙/暂停/隐藏期与开局冷模块图取曾被整段误杀;trace 定谳见
   *  WorkerGovernance 头注）。每实例一个,回落即弃（重生换全新 link=全新 watchdog）。 */
  private readonly wd = new WorkerWatchdog();
  private fallen = false;
  // ---- ★C9d2 二期（Layer 1 池化+transferable / Layer 2 灰度差量） ----
  /** 绑定世界 store（引擎构造期注入）:写日志挂载+delta 帧世界真值直读 */
  private _st: TileStore | null = null;
  /** 写日志（挂到 store.tileWriteLog;send 时消费并清空） */
  private readonly _log: number[] = [];
  /** 差量编码器（仅灰度模式创建;构造器注入面=单测驱动 link 差量路径） */
  private readonly _enc: LightDeltaEncoder | null;
  constructor(enc: LightDeltaEncoder | null = lightDeltaFlag ? new LightDeltaEncoder() : null) {
    this._enc = enc;
  }
  /** 切片通道池（全量帧 transfer 走后由 worker 回池复用——Layer 1 legacy 帧每帧直回,
   *  Layer 2 'full' 锚帧经解码器退役队列回;深度 4 封顶） */
  private _pool: TileSlicePack[] = [];
  /** 最近一次 buildWorkerTiles 的区域（escalate 防御面回退全量时复用） */
  private _lastReg = { rx: 0, ry: 0, rw: 0, rh: 0 };
  /** 引擎内容脏门（引擎注入:dirty∨liquidDirty 且非移动脏——未记账直写面兜底全量） */
  contentDirtyGate: (() => boolean) | null = null;

  /** 引擎构造期绑定 store:灰度模式挂写日志（tileWriteLog=本日志数组引用;
   *  原语写面零分配推送）。dispose 时摘除。 */
  bindStore(st: TileStore): void {
    this._st = st;
    if (this._enc) st.tileWriteLog = this._log;
  }

  /** ★C9d2 引擎切片入口（buildWorkerSnapshot 专用）:灰度 delta 帧免 416KB 切片
   *  （返回仅几何字段包,通道零长）;全量帧走 buildSlice（池化）。 */
  buildWorkerTiles(rx: number, ry: number, rw: number, rh: number): TileSlicePack {
    this._lastReg = { rx, ry, rw, rh };
    const st = this._st;
    if (st === null) {
      // 防御面（bindStore 前无消费方;不可能路径）——零尺寸几何帧,worker 侧空扫
      return sliceGeometry({ w: 0, h: 0, showInvisibleBlocks: false }, rx, ry, rw, rh);
    }
    const reg = sliceGeometry(st, rx, ry, rw, rh);
    if (this._enc !== null) {
      const contentDirty = this.contentDirtyGate !== null && this.contentDirtyGate();
      if (this._enc.planFull(reg, this._log.length, contentDirty)) {
        return this.buildSlice(st, rx, ry, rw, rh);   // 全量锚帧（克隆发送,数组留影子）
      }
      return reg;   // delta 帧:仅几何,免切片
    }
    return this.buildSlice(st, rx, ry, rw, rh);
  }

  /** ★C9b 到达即应用（2026-09-24,用户实报 120fps 光照慢几帧定谳）:结果回填点从
   *  「下一个 compute」提前到「消息到达瞬间」。原 applyPending 只在 tick 的
   *  compute 里执行——120fps 渲染下主线程任务翻倍,回传消息常滑到下下个 tick
   *  才被消费（间歇 2 tick=33ms≈4 渲染帧=用户所见割裂）。onmessage 直接回填
   *  后:数据逐字节不变,只是更早可见;region+数组仍成对原子（主线程单线程,
   *  消息是独立 task,不可能撕裂同步段内的一致对）。引擎侧注册本回调。
   *  ★C9c（2026-09-24 用户复报不限帧率/进世界仍有延迟）:liveAuth 门——到达即
   *  应用仅在引擎 live 态生效;warmup 期本地每 tick 可能全周期出【新鲜】光,
   *  若被 1-tick 陈旧的 worker 结果倒灌覆写反而退步（进世界 dirty 风暴实锤）。
   *  引擎在 live 分支置 true,warmup 分支置 false。 */
  liveAuth = false;
  onResult: ((m: LightResultMsg) => void) | null = null;
  /** ★R1b-1≡R2b-F7 结果世代过滤器（引擎注入）：applyPending 兜底回填前过同款
   *  校验（主路径校验在引擎 applyWorkerResult 内）——传送大跳后在途旧世代结果
   *  经 pending 支抵达时同样拒回填,公共采样对保持本地发布的新区域。 */
  pendingFilter: ((m: LightResultMsg) => boolean) | null = null;
  private lastLag = 0;
  /** 最近一次结果 send→apply 实测延迟（C9c live 滞回门的传感器,毫秒;0=尚无结果） */
  get lastLagMs(): number { return this.lastLag; }

  /** worker 已产出过结果（warmup → live 的分界） */
  isLive(): boolean { return this.results > 0; }

  /** 看门狗（引擎 compute 帧驱动轮询,承 C8;★2026-09-28 治理重构=outstanding-aware）：
   *  「发了快照且最老未答请求年龄超预算（warmup 15s/稳态 2s）+双拍确认」才不健康;
   *  onerror/异常回执=硬证据直杀。主线程忙/暂停/隐藏恢复（outstanding=0）永不定谳。
   *  ★worker===null（尚未惰性生成）不算失联——首帧 compute 必须放行到 send() 建链,
   *  否则死锁于「healthy 要求 worker,worker 靠 send 生成」→ 永久回落（探针实锤）。
   *  ★首次不健康时登记指纹（falls/fallsBy）——引擎 dispose+阶梯重生消费;dispose
   *  （世界销毁）不记指纹（非回落）。 */
  healthy(): boolean {
    if (this.dead) return false;
    if (this.errored) { this.noteFall('onerror'); return false; }
    if (this.worker === null) return true;   // 未生成=首轮放行;生成失败置 errored 下帧回落
    if (this.wd.healthy(performance.now(), false)) return true;
    this.noteFall(this.wd.fallReason());
    return false;
  }

  /** 回落指纹登记（幂等——定谳只记一次;引擎侧 dispose+阶梯重生) */
  private noteFall(reason: WorkerFallReason): void {
    if (this.fallen) return;
    this.fallen = true;
    lwStat.falls++;
    lwStat.fallsBy[reason]++;
  }

  /** 回落原因（引擎侧排程重生后 F5 exitReason 扩展消费;定谳前=缺省值） */
  fallReason(): WorkerFallReason { return this.fallen ? this.wd.fallReason() : 'no-result-dead'; }

  dispose(): void {
    if (this.worker !== null) {
      try { this.worker.terminate(); } catch { /* 已死 */ }
      this.worker = null;
    }
    // ★C9d2:摘写日志（回退本地/世界销毁后原语写面零开销;防悬挂引用）
    if (this._st !== null) { this._st.tileWriteLog = null; this._st = null; }
    this._pool.length = 0;
    this._retired.length = 0;   // ★债3:worker 已终止,退役队列无回收意义
    this.dead = true;
  }

  /** 扫描区域 ± SNAPSHOT_PAD 切片（逐行 memcpy）。
   *  ★C9d2 Layer 1:通道数组自池复用（全量帧 transfer 到 worker 后由 'pool' 消息
   *  回池;池空/尺寸失配才新分配）——稳态零分配,杀 ~416KB/帧 GC churn。 */
  buildSlice(st: TileStore, rx: number, ry: number, rw: number, rh: number): TileSlicePack {
    const sx = Math.max(0, rx - SNAPSHOT_PAD);
    const sy = Math.max(0, ry - SNAPSHOT_PAD);
    const sw = Math.min(st.w, rx + rw + SNAPSHOT_PAD) - sx;
    const sh = Math.min(st.h, ry + rh + SNAPSHOT_PAD) - sy;
    const n = sw * sh;
    let pack: TileSlicePack | null = null;
    for (let i = 0; i < this._pool.length; i++) {
      if (this._pool[i].type.length === n) { pack = this._pool.splice(i, 1)[0]; lwStat.poolHits++; break; }
    }
    if (pack === null) {
      lwStat.poolMisses++;
      pack = allocSliceChannels(sw, sh);
    }
    pack.sx = sx; pack.sy = sy; pack.px = rx - sx; pack.py = ry - sy;
    pack.showInvisibleBlocks = st.showInvisibleBlocks;
    for (const k of TILE_CHAN_KEYS) {
      const src = st[k] as Uint16Array | Uint8Array;
      const dst = pack[k] as Uint16Array | Uint8Array;
      for (let row = 0; row < sh; row++) {
        const base = (sy + row) * st.w + sx;
        dst.set(src.subarray(base, base + sw), row * sw);
      }
    }
    return pack;
  }

  /** 切片回池（Layer 1 legacy 帧回传 / ★transferable 化（2026-10-04）后 'full' 锚帧
   *  解码器退役缓冲回传同通道;深度 4 封顶防滞留） */
  private recycleSlice(t: TileSlicePack): void {
    if (this._pool.length < 4 && t.type.length > 0) this._pool.push(t);
  }

  /** ★transferable 化（2026-10-04）:13 通道 buffer transfer 发送（全量帧统一口——
   *  Layer 1 legacy 全量 / Layer 2 'full' 锚帧同款）。所有权移交 worker:主线程
   *  send 返回后【不得再触碰】通道数组;worker compute 完经 'pool' 消息回传
   *  （legacy 直回 m.tiles;'full' 走解码器退役队列 drainRetired）入池复用。
   *  池深纪律:回传包进 recycleSlice（≤4、type.length>0）,buildSlice 按
   *  type.length===n 精确配对弹出——两形态共用一个池,命中/未命中账同口径。
   *  ★债3 池化（2026-10-04）:消息可携带 ret（退役结果数组）——buffer 一并入
   *  transfer 列表,worker 侧入结果池供发布面取用。 */
  private postFrameWithTiles(m: object, t: TileSlicePack): void {
    const transfer: ArrayBuffer[] = [];
    for (const k of TILE_CHAN_KEYS) {
      const buf = (t[k] as Uint16Array | Uint8Array).buffer as ArrayBuffer;
      if (buf.byteLength > 0) transfer.push(buf);
    }
    const ret = (m as { ret?: ResultTriple[] }).ret;
    if (ret !== undefined) {
      for (const r of ret) {
        if (r.R.buffer.byteLength > 0) transfer.push(r.R.buffer as ArrayBuffer);
        if (r.G.buffer.byteLength > 0) transfer.push(r.G.buffer as ArrayBuffer);
        if (r.B.buffer.byteLength > 0) transfer.push(r.B.buffer as ArrayBuffer);
      }
    }
    this.worker!.postMessage(m, transfer);
  }

  /** 惰性生成 + 发送。
   *  ★C9d2 Layer 1（非灰度,常开）:tile 13 通道 transferable 零拷贝过境（杀结构克隆
   *  ~24-29MB/s）,worker compute 后 'pool' 回池复用。
   *  ★C9d2 Layer 2（?lightdelta=1 灰度,2026-10-04 transferable 化）:全量锚帧同款
   *  transferable+'pool' 回池（结构克隆退役——主线程内容影子无读点,影子降级几何
   *  记账,见 LightDeltaEncoder 类注）;delta 帧编码 写日志格∪暴露带（免切片帧,
   *  载荷 KB 级 transferable）。 */
  send(msg: Omit<LightSnapshotMsg, 'op' | 'seq'>): void {
    if (this.worker === null) {
      try {
        // ★WASM 第二刀(2026-10-03)+转正(2026-10-04):lightwasm 经 Worker options.name 注入 worker 域(转正后=禁用标记 'sw-lightwasm=0' 走 else 支,worker 读 !includes 反转)
        //  (loader lightWasm.ts 双域旗读取的 worker 半边——worker 无页面 URL,快照协议
        //  不动)。★vite:worker-import-meta-url 约束=worker options 必须静态字面量
        //  (动态三元=vite 500,实锤)——双静态分支构造,两支均可被 dev/build 变换。
        //  页面 window.name 同名串不误伤:loader 仅 document 缺席域读 name。
        if (lightWasmEnabled()) {
          this.worker = new Worker(new URL('../workers/LightWorker.ts', import.meta.url),
            { type: 'module', name: 'sw-lightwasm' });
        } else {
          this.worker = new Worker(new URL('../workers/LightWorker.ts', import.meta.url),
            { type: 'module', name: 'sw-lightwasm=0' });
        }
        this.startedAt = performance.now();
        this.worker.onerror = (e) => {
          this.errored = true;
          console.warn('[LightWorker] worker error:', String(e.message ?? '').slice(0, 140));
        };
        this.worker.onmessage = (ev: MessageEvent) => {
          const m = ev.data as LightResultMsg | { op: 'error'; message: string } | LightPoolMsg | LightResyncMsg;
          if (m.op === 'pool') { this.recycleSlice((m as LightPoolMsg).tiles); return; }
          if (m.op === 'resync') { lwStat.resyncs++; if (this._enc) this._enc.noteResync(); return; }
          if (m.op === 'error') {
            this.errored = true;
            this._doneCount++;   // ★lwbp:致命错误=该帧永不回执,冲账防 live 链饿死（链路随后回落/重生）
            console.warn('[LightWorker] worker frame failed:', String((m as { message: string }).message).slice(0, 140));
            return;
          }
          this.arriveResult(m);
        };
      } catch (err) {
        this.errored = true;
        console.warn('[LightWorker] spawn failed:', String(err).slice(0, 140));
        return;
      }
    }
    lwStat.posted++;
    this.lastSentAt = performance.now();
    this.wd.onSend(this.lastSentAt);   // ★看门狗:在途请求钉账（outstanding 0→1 时锚最老年龄）
    // ★债3 池化:退役结果数组随本帧快照回送 worker（transfer 零拷贝;空队=不带字段）
    const ret = this._retired.length > 0 ? this._retired : undefined;
    this._retired = [];
    if (ret !== undefined) lwStat.retSent += ret.length;
    if (this._enc !== null) { lwStat.deltaPoolHits = this._enc.poolHits; lwStat.deltaPoolMisses = this._enc.poolMisses; }
    const seq = ++this.seq;
    // ---- Layer 2（灰度）----
    if (this._enc !== null && this._st !== null) {
      const t = msg.tiles;
      if (t.type.length > 0) {
        // ★transferable 化（2026-10-04）:全量锚帧 13 通道 transfer 发送（结构克隆退役
        //  ——旧语义「数组留主线程作内容影子」随编码器影子降级为几何记账一并退役,
        //  见 LightDeltaEncoder 类注位等价论证）;worker 侧解码器以收包为新影子,
        //  被换下缓冲经 'pool' 回传入池（稳态零分配闭环,杀 ~416KB/锚帧 克隆+双端 GC churn）
        this._enc.adoptFull(t);
        lwStat.fmt.full++;
        lwStat.lastFullReason = this._enc.lastFullReason;
        lwStat.tileBytes += t.type.length * TILE_CHAN_BYTES_PER_CELL;
        this._log.length = 0;
        this.postFrameWithTiles({ ...msg, ...(ret !== undefined ? { ret } : {}), op: 'frame', seq, enc: 'full' as const }, t);
        return;
      }
      // delta 帧:编码 写日志格∪暴露带（读世界真值,影子几何同步推进）
      const out = this._enc.encodeDelta(this._st, t, this._log);
      this._log.length = 0;
      if (out.meta.length === 0) {
        // 防御面:编码中途异常（plan 容量保证下不可达）→ 本帧补全量
        const r = this._lastReg;
        const full = this.buildSlice(this._st, r.rx, r.ry, r.rw, r.rh);
        this._enc.adoptFull(full);
        lwStat.fmt.full++;
        lwStat.lastFullReason = 'escalate';
        lwStat.tileBytes += full.type.length * TILE_CHAN_BYTES_PER_CELL;
        this.postFrameWithTiles({ ...msg, tiles: full, ...(ret !== undefined ? { ret } : {}), op: 'frame', seq, enc: 'full' as const }, full);
        return;
      }
      lwStat.fmt.delta++;
      // ★债2 池化:载荷字节=有效长度口径（meta 整块 scratch 过境,byteLength=容量）
      lwStat.tileBytes += out.metaLen * 4 + out.dataLen;
      const retBufs: ArrayBuffer[] = [];
      if (ret !== undefined) {
        for (const r of ret) {
          if (r.R.buffer.byteLength > 0) retBufs.push(r.R.buffer as ArrayBuffer);
          if (r.G.buffer.byteLength > 0) retBufs.push(r.G.buffer as ArrayBuffer);
          if (r.B.buffer.byteLength > 0) retBufs.push(r.B.buffer as ArrayBuffer);
        }
      }
      this.worker.postMessage({ ...msg, ...(ret !== undefined ? { ret } : {}), op: 'frame', seq, enc: 'delta' as const,
        delta: { dv: LIGHT_DELTA_VERSION, meta: out.meta, data: out.data, metaLen: out.metaLen, dataLen: out.dataLen } },
        [out.meta.buffer, out.data.buffer, ...retBufs]);
      // delta 帧无全量切片,无需回池
      return;
    }
    // ---- Layer 1（非灰度,常开）:13 通道 transferable ----
    const t = msg.tiles;
    this.postFrameWithTiles({ ...msg, ...(ret !== undefined ? { ret } : {}), op: 'frame', seq }, t);
  }

  /** ★lwbp（2026-10-11 刀②）:在飞门查询——worker 回包未达（outstanding≥1）时
   *  false=引擎跳发本 tick 快照。worker 未建链（首帧）/旗关=恒 true（现状逐位）。
   *  看门狗语义相容:跳发帧不 onSend,outstanding 年龄照走——回执 2s 内必达则门
   *  自愈;超时=看门狗既有回落链接管（宁可回落不可静默黑光,语义不变）。 */
  sendReady(): boolean {
    if (!lwbpFlag) return true;
    if (this.worker === null) return true;   // 首帧必须放行（send() 内建链）
    return this.seq - this._doneCount < 1;
  }
  /** ★lwbp:引擎跳发登记（对账面） */
  noteSendSkip(): void { lwStat.bpSkips++; }

  /** 结果消息到达（onmessage 结果支;独立成法=测试可驱动,无 Worker 环境驱动链路）。
   *  ★债3 池化收口:retDelta（delta scratch 回池）/rp（worker 结果池对账镜像）/
   *  pending 生命周期门（覆写点退役未应用孤儿;已应用=公共面活体禁碰） */
  private arriveResult(m: LightResultMsg): void {
    if (m.retDelta !== undefined && this._enc !== null) this._enc.retireDelta(m.retDelta.meta, m.retDelta.data);
    if (m.rp !== undefined) { lwStat.resPoolTakes = m.rp.t; lwStat.resPoolMisses = m.rp.m; }
    this.results++;
    this._doneCount++;   // ★lwbp:1:1 回执冲账
    lwStat.results++;
    this.lastResultAt = performance.now();
    this.wd.onResult(this.lastResultAt);   // ★看门狗:回达冲账（应用/世代丢弃不影响心跳）
    lwStat.lagMs = this.lastSentAt > 0 ? performance.now() - this.lastSentAt : 0;
    this.lastLag = lwStat.lagMs;
    // 旧 pending 失去引用点:未应用（仅 pending 持有）→ 孤儿 → 退役回池;
    // 已应用（pendingApplied）=数组是公共面活体——引擎在替换点已退役,此处禁重复
    if (this.pending !== null && !this.pendingApplied) this.retireResult(this.pending.R, this.pending.G, this.pending.B);
    this.pending = m;
    this.pendingApplied = false;
    // ★C9b 到达即应用（compute 的 applyPending 保留为兜底,已应用则 no-op）;
    //  ★C9c 仅 live 态生效——warmup 期本地新鲜光优先,禁陈旧倒灌。
    //  引擎 applyWorkerResult 成功经 noteResultApplied 同步登记 pendingApplied。
    if (this.liveAuth && this.onResult) this.onResult(m);
  }

  /** ★债3 池化:结果数组退役入队（引擎在「引用替换后不再被公共面持有」点调用;
   *  随下帧 send transfer 回 worker 结果池。深度 8 封顶,溢出弃=仅失回收,正确性无涉;
   *  detached/零长防御=双保险——绝不让死缓冲进池污染 transfer 列表） */
  retireResult(R: Uint8Array, G: Uint8Array, B: Uint8Array): void {
    if (R.length === 0 || R.buffer.byteLength === 0) return;
    if (this._retired.length >= 8) { lwStat.retDropped++; return; }
    this._retired.push({ R, G, B });
  }

  /** ★债3 池化:引擎到达即应用成功登记（pending 载荷从此=公共面活体——覆写/
   *  兜底拒绝点退役门闩,见 pendingApplied 注） */
  noteResultApplied(m: LightResultMsg): void {
    if (this.pending === m) this.pendingApplied = true;
  }

  /** 回填引擎公共面（引擎 compute 内调用——渲染与 lightAt 全消费面读成对一致值）。
   *  ★R1b-1:pendingFilter 在场时先过世代校验——不过=丢弃（不回填,计 skipped 由
   *  引擎校验面统一登记;此处静默拒）。
   *  ★债3 池化:拒绝的被丢数组退役回池——但仅限「未被到达即应用」者（pendingApplied
   *  =数组已是公共面活体,禁退役;可达性:覆盖校验通过后 1 tick 内快照移 ≤2 格,
   *  翻转需 >26 格/tick——防御面守卫,防活数组 detach） */
  applyPending(t: LightTarget): boolean {
    const m = this.pending;
    if (m === null) return false;
    this.pending = null;
    if (this.pendingFilter && !this.pendingFilter(m)) {
      noteLightResultSkipped();
      if (!this.pendingApplied) this.retireResult(m.R, m.G, m.B);
      return false;
    }
    t.rx = m.rx; t.ry = m.ry; t.rw = m.rw; t.rh = m.rh;
    t.r = m.R; t.g = m.G; t.b = m.B;
    return true;
  }
}
