// 主线程的 worldGen worker 客户端：懒 spawn、ping 握手探测可用性、Promise 化、
// 进度/预览回调、超时看门狗（terminate + 重建）、worker 不可用时抛 WorldGenUnavailable
// 由调用方（Game.newWorld/loadWorld）落回主线程路径。
import { World } from '../world/World';
import { WorldGenAbortedError } from '../world/gen/WorldGen';   // ★IIIII229 ① 中止判别（与 WorldGenUnavailable 判例同形:不触发 fallback）
import type { GenConfigDTO, WorldWorkerEvent, WorldWorkerRequest } from './protocol';
import { getModBridgePayload, getModGenSrc, getModGenSrcs, getGenGlobals } from '../mods/bridge';

export interface PreviewFrame {
  width: number; height: number;
  rgba: Uint8ClampedArray;
  passIndex: number; passName: string;
}

/** worker 不可用/握手失败——调用方降级主线程路径 */
export class WorldGenUnavailable extends Error {
  constructor(msg = 'worldGen worker 不可用') { super(msg); }
}

interface Pending {
  resolve: (w: World) => void;
  reject: (e: unknown) => void;
  /** 第 4 参 local=当前原版 pass 段内 Value（generate 相位；其余相位 undefined） */
  onProgress?: (phase: string, label: string, p: number, local?: number) => void;
  lastPhase?: string;
  onPreview?: (f: PreviewFrame) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 静默看门狗(2026-08-12):生成中无事件 >STALL_WARN_MS → console.error 点名卡点 pass */
  lastEventAt?: number;
  lastLabel?: string;
  stallWarned?: boolean;
  stallTimer?: ReturnType<typeof setInterval>;
  /** loadSave 专用结果处理器（world + player） */
  onLoadResult?: (ev: Extract<WorldWorkerEvent, { type: 'result' }>) => void;
  /** genIcons 专用结果处理器(#perf-gpulog 图标包 worker 化) */
  onIcons?: (ev: Extract<WorldWorkerEvent, { type: 'icons' }>) => void;
}

/** 握手超时：覆盖老 Safari 无 module worker / CSP 禁 worker / file:// 全挂 */
const HANDSHAKE_MS = 3000;
/** ★BJ703-E 件1：probe 瞬态失败后的重试退避窗——窗内 probe 直接 false（零成本），
 *  过窗后下次需要时重新 spawn（回升通道）。用户驱动频度（加载手势链），30s 足以
 *  防持续离线下的逐次重付，又不至于把「几秒级瞬断」错关在窗外。 */
const PROBE_RETRY_BACKOFF_MS = 30_000;
/** 任务超时看门狗基准：小世界 4200×1200 生成余量（超时 terminate 杀掉挂死任务）。
 *  实际超时按世界面积缩放（worldGenTimeoutMs），generate 默认取缩放值。 */
const DEFAULT_TIMEOUT_MS = 180000;
/** ★BJ331（2026-09-24）：按世界面积缩放的生成硬超时——原 180s 固定值注释口径是
 *  「大世界余量」，但慢机（用户 Windows Edge 实报 seed 152394290 大世界）光
 *  Speleothems 单 pass 就静默 199s+，健康生成在 180s 被硬超时杀死后落回主线程
 *  同步【从头重做一遍】（总时长翻倍+主线程全程卡顿=「自动回退成了同步生成」实报）。
 *  以 4200×1200 为基准 180s，面积线性放大封顶 4×（大世界 8400×2400=720s）。
 *  真死循环的兜底不再只靠硬超时：静默看门狗 30s 告警 + Esc 中止链（IIIII229）。 */
export function worldGenTimeoutMs(width: number, height: number): number {
  const area = Math.max(1, width) * Math.max(1, height);
  const factor = Math.min(4, Math.max(1, area / (4200 * 1200)));
  return Math.round(DEFAULT_TIMEOUT_MS * factor);
}

/** ★BJ336（2026-09-24）件1：读档超时扩面的尺寸窥取。
 *  ★BJ341（2026-09-25）键名锚修正（红蓝-W2 F3）：真实序列化头的键名是
 *  **width/height**（serialize.ts:505 header 投影 `width: meta.w, height: meta.h`
 *  ——SaveFile.ts meta 的 w/h 键在落盘前被改名投影），旧正则 `"w":(\d),"h":(\d)`
 *  对真实存档恒不命中 ⇒ json 读档路超时扩面全死（loadFromJson 恒回退 180s 缺省）。
 *  落盘序固定 format,version,header{name,seed,width,height,…}（serializeSave
 *  装配序）⇒ 首个 `"width":<n>,"height":<n>` 落在头部数十字节内；JSON 字符串内部
 *  的引号必转义（\"width\":）⇒ 正则误匹配不可能，首个命中即真头。有界窗口（4KB）
 *  防超长 name 场景全串扫描。非存档 JSON/损坏头 → null（调用方回退 worker 客户端
 *  固定 180s 缺省，同现行）。 */
export function peekSaveDims(json: string): { w: number; h: number } | null {
  if (!json) return null;
  const head = json.length > 4096 ? json.slice(0, 4096) : json;
  const m = /"width":(\d{1,5}),"height":(\d{1,5})/.exec(head);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** 静默看门狗 interval 装配（★BJ336 件1：generate 之外 loadSave 也武装——worker 读档
 *  parse/RLE/沉降三段均有 progress 事件流动，30s 无事件=段内冻结的最早信号，与生成
 *  面同款点名。getPend 延迟解析：装配点 pend 字面量尚未赋值、回调运行期才读取
 *  （与 generate 内联写法同 TDZ 形态）。generate 的内联块保持 BJ331 原样不动。 */
function armStallWatchdog(noun: string, getPend: () => Pending | undefined): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const pend = getPend();
    if (!pend?.lastEventAt) return;
    const silent = Date.now() - pend.lastEventAt;
    if (silent > STALL_WARN_MS) {
      if (pend.stallWarned) return;
      console.error(
        `[worldGen] ⚠️ ${noun}疑似卡死：已 ${Math.round(silent / 1000)}s 无进展` +
        `（最后进度：${pend.lastLabel}${pend.lastPhase ? ` [${pend.lastPhase}]` : ''}）。` +
        `${noun === '生成' ? 'pass 为同步代码,内部死循环会停摆事件循环——排查该 pass 内的 while/拒绝采样' : '读档 parse/RLE 解码/沉降三段均为同步段,段内冻结会停摆事件循环——排查该段内循环'}` +
        `（参考 liquidType +1 编码血案,硬超时后将自动终止）`,
      );
      pend.stallWarned = true;
    } else {
      pend.stallWarned = false;
    }
  }, STALL_CHECK_MS);
}
/** 静默看门狗阈值：生成中超过此时长无任何 worker 事件 → 控制台点名(pass 内死循环
 *  的最早信号——2026-08-12 水中箱 liquidType 死循环卡了整场才被发现,本看门狗 30s 即报) */
const STALL_WARN_MS = 30_000;
const STALL_CHECK_MS = 10_000;

export class WorldGenClient {
  private worker: Worker | null = null;
  /** ★BJ702 件2（2026-10-21）：在途握手 Promise——worker「已 spawn 未过 ping 验证」
   *  期间短路放行必须链到它（见 ensureWorker 注）；握手应答后置 null。 */
  private handshake: Promise<Worker> | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** null=未探测；true=已验证可用（恒粘滞）；false=瞬态握手失败（可重试，见 probe 注） */
  private probed: boolean | null = null;
  private workerBroken = false; // onerror/构造抛后置位，后续请求直接 fallback（硬故障粘滞）
  /** ★BJ703-E 件1：probe 瞬态失败时间戳（退避窗锚） */
  private probeFailedAt = 0;

  /** 探测可用性。
   *  ★BJ703-E 件1+件2b（2026-10-21 BJ702 登记债 1/2 收口）：失败不再粘滞——旧实现
   *  一次瞬态网络握手失败即把 false 缓存到底，本页面会话恒走主线程读档/生成
   *  （mainFlow.loadFromKey/loadFromJson + Game.newWorld 三门全经 probe；fail-safe
   *  但降级不回升，刷新才能恢复）。新语义三档：
   *  · 硬故障（workerBroken：构造抛/运行期 onerror（握手已过）/messageerror/
   *    无 Worker API）= 粘滞 false（重试无意义;加载期快败=瞬态,见 onFatal）；
   *  · 成功 = 粘滞 true（原语义不变）；
   *  · 瞬态握手超时 = 一次快重试（件2b：第二发独立 spawn+3s 窗，区分「瞬断」与
   *    「持续离线」——worker 脚本模块图冷取 >2s 平凡，3s 单发窗对慢网首访偏紧）；
   *    两连败才落 false 并记 probeFailedAt——退避窗内 probe 恒 false 零成本（持续
   *    离线不逐次重付 3s×2，防重试风暴），过窗后下次需要时重新 spawn（回升通道：
   *    BJ702「刷新即好」的恢复面不再依赖刷新）。probe 由用户加载动作驱动（三门
   *    均在手势链内），无后台自旋面；最坏每次加载尝试多付 6s（两发 3s 握手窗,
   *    仅持续离线态;★BJ704-G8 F3 勘正:旧注释「3s」与两发实况不符——第一发超时+
   *    快重试第二发各 3s,两连败才落 false）。 */
  async probe(): Promise<boolean> {
    if (this.workerBroken || typeof Worker === 'undefined') {
      this.probed = false;
      return false;
    }
    if (this.probed === true) return true;
    if (this.probed === false && Date.now() - this.probeFailedAt < PROBE_RETRY_BACKOFF_MS) return false;
    try {
      await this.ensureWorker(HANDSHAKE_MS);
      this.probed = true;
      return true;
    } catch { /* 硬故障/瞬态失败 → 下方判定 */ }
    if (this.workerBroken) { this.probed = false; return false; }   // 构造抛/运行期崩溃=重试无意义（加载期快败不置位,落下方瞬态支）
    try {
      await this.ensureWorker(HANDSHAKE_MS);   // 件2b：单次快重试（killWorker 已 terminate 旧实例）
      this.probed = true;
      return true;
    } catch {
      this.probed = false;
      this.probeFailedAt = Date.now();   // 退避窗锚：窗内零成本 false，过窗重付
      return false;
    }
  }

  private ensureWorker(handshakeMs?: number): Promise<Worker> {
    // ★BJ704-G8 F4:硬故障粘滞后不再 spawn——workerBroken（构造抛/运行期崩溃）的
    //  语义=「本页面会话恒走主线程」,但旧码 generate/loadSave/genIcons/abortGen
    //  直调仍会再 spawn 一发（abortGen 只为发一条 abort 消息也白 spawn——killWorker
    //  已清空 pending,本就无作业可中止）。三门 probe 前置下竞态窗 ms 级 fail-safe
    //  有界,本门把语义收齐:broken 后 ensureWorker 恒拒 → 调用方即时 fallback。
    if (this.workerBroken) return Promise.reject(new WorldGenUnavailable());
    if (this.worker) {
      // ★BJ702 件2（2026-10-21 线上实报「小世界读档 40s 看门狗点名后卡死到刷新」）：
      //  短路只放行【已过 ping 验证】的 worker。旧 `Promise.resolve(this.worker)` 把
      //  「已 spawn、脚本仍在冷取」的 worker 直接交出——probe() 据此误报可用(true)，
      //  loadSave 随即向未启动的 worker 投递 saveParse（消息排队永不执行）。worker
      //  脚本经 SW cache-first miss 冷取（新 hash 冷缓存/慢网；模块图大，>2s 极平凡
      //  ——WorkerGovernance 2026-09-28 同族定谳）超 3s 握手窗即触发。在途=链同一
      //  握手 Promise：ping 应答两路同过；超时两路同拒（killWorker 经 pending 表），
      //  调用方即时走回退，不再孤儿化。
      return this.handshake ?? Promise.resolve(this.worker);
    }
    let w: Worker;
    try {
      w = new Worker(new URL('./worldGen.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      this.workerBroken = true;
      return Promise.reject(new WorldGenUnavailable());
    }
    this.worker = w;
    w.onmessage = (e: MessageEvent<WorldWorkerEvent>) => this.onEvent(e.data);
    // ★BJ704-R6 P1：error 事件须携带源实例——worker1 被 killWorker terminate 后
    //  迟到的 onerror（fetch 快败先于 terminate 到达的排队任务）不得连带杀掉
    //  probe 快重试已 spawn 的 worker2（迟到事件≠在役实例,onFatal 内守卫）。
    w.onerror = () => this.onFatal(w, true);
    w.onmessageerror = () => this.onFatal(w, false);
    // ★mod 桥(2026-10-04):worker 建即推 mod id 增量(fire-and-forget;读档 saveParse
    //  的 stable→internal 翻译在本线程表上,不推=mod 内容解档归 0)
    try {
      const payload = getModBridgePayload();
      if (payload) w.postMessage({ id: this.nextId++, type: 'applyModIds', payload });
      // ★622:mod gen pass 源码推(worker 两步 eval=gen 注册闭环;★622c 验证 13 pass ✓)
      //  ★多 mod gen 修复(2026-10-14):优先多源清单(全 mod 各自 eval,单 mod 失败
      //  不拖累其余);旧单源兜底兼容
      try {
        const srcs = getModGenSrcs();
        const globals = getGenGlobals();
        if (srcs && srcs.length > 0) {
          w.postMessage({ id: this.nextId++, type: 'applyGenSrc', payload: { srcs, globals } });
        } else {
          const genSrc = getModGenSrc();
          if (genSrc) {
            w.postMessage({ id: this.nextId++, type: 'applyGenSrc', payload: { src: genSrc, globals } });
          }
        }
      } catch { /* gen src 不可用忽略(terrain 缺=可容忍) */ }
    } catch { /* 握手前失败忽略,后续 ensure 重推 */ }
    // 握手 ping（超时则视为不可用）
    // ★BJ702 件1：超时路径的 teardown 会 terminate 共享 worker——若不一并收账，
    //  在途作业（loadSave 等经旧短路拿到未验证 worker 时已投递的 saveParse）成
    //  孤儿：terminate 不触发 onerror/onmessageerror，只能等各自 180s 硬超时才
    //  reject 转回退（实报形态：prewarm 握手超时 → teardown 杀共享 worker →
    //  saveParse 孤儿 → 40s 静默看门狗点名「读档疑似卡死(最后进度:开始)」→
    //  用户在 180s 自愈前刷新）。killWorker 全量 reject（本握手 Promise 经
    //  pending 表同拍拒绝）。
    this.handshake = new Promise<Worker>((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.killWorker(new WorldGenUnavailable('握手超时'), id);   // F5:握手 pending 保原消息
      }, handshakeMs ?? HANDSHAKE_MS);
      this.pending.set(id, {
        resolve: () => { this.handshake = null; resolve(w); },
        reject,
        timer,
      });
      w.postMessage({ id, type: 'ping' } satisfies WorldWorkerRequest);
    });
    return this.handshake;
  }

  /** 生成世界（worker 内生成+沉降一条链，transfer 零拷贝回传） */
  async generate(
    cfg: GenConfigDTO,
    cb?: {
      onProgress?: (phase: string, label: string, p: number, local?: number) => void;
      onPreview?: (f: PreviewFrame) => void;
      timeoutMs?: number;
    },
  ): Promise<World> {
    const w = await this.ensureWorker();
    const id = this.nextId++;
    return new Promise<World>((resolve, reject) => {
      const timer = setTimeout(() => {
        // ★BJ331：超时路径必须同步清掉 stallTimer（曾漏清 ⇒ pending 已删而 interval
        //  永续,拿冻结的 lastEventAt 每 10s 报一次「已 Xs 无进展」直到页面刷新——
        //  用户实报:回退同步生成+进世界游玩后告警仍连发到 199s+）
        // ★BJ702 件1：清账收编 killWorker 单源（自身 stallTimer/timer + 其余在途
        //  作业一并 reject 转回退——旧实现只删自身 pending，共飞作业孤儿化等各自
        //  硬超时）。worker 已 terminate，杀掉挂死任务，下次请求重新 spawn 语义不变。
        this.killWorker(new WorldGenUnavailable('生成超时'), id);   // F5:触发者保原消息,共飞按自身标签
      }, cb?.timeoutMs ?? worldGenTimeoutMs(cfg.width, cfg.height));
      const pend: Pending = {
        resolve, reject,
        onProgress: cb?.onProgress as Pending['onProgress'], onPreview: cb?.onPreview,
        timer,
        lastEventAt: Date.now(), lastLabel: '开始', stallWarned: false,
        stallTimer: setInterval(() => {
          if (!pend.lastEventAt) return;
          const silent = Date.now() - pend.lastEventAt;
          if (silent > STALL_WARN_MS) {
            // 每段静默只报一次（注释口径 2026-08-12 起即是,曾漏 gate 每 10s 刷屏;
            // 进度事件复位 lastEventAt 后自动再武装,下一段静默重新点名）:
            // 点名最后进度 + 静默时长,指向"pass 内部死循环"排查路径
            if (pend.stallWarned) return;
            console.error(
              `[worldGen] ⚠️ 生成疑似卡死：已 ${Math.round(silent / 1000)}s 无进展` +
              `（最后进度：${pend.lastLabel}${pend.lastPhase ? ` [${pend.lastPhase}]` : ''}）。` +
              `pass 为同步代码,内部死循环会停摆事件循环——排查该 pass 内的 while/拒绝采样` +
              `（参考 liquidType +1 编码血案,硬超时(小世界 3 分钟/大世界封顶 12 分钟)后将自动终止）`,
            );
            pend.stallWarned = true;
          } else {
            pend.stallWarned = false;
          }
        }, STALL_CHECK_MS),
      };
      this.pending.set(id, pend);
      w.postMessage({ id, type: 'generate', cfg } satisfies WorldWorkerRequest);
    });
  }

  // ★IIIII229 ①：Esc 中止链客户端面——Game.abortWorldGen() 经此把请求转投 worker
  //   通道（'abortGen' fire-and-forget）。主线程 fallback 生成路不经此处（Game 直接
  //   调 WorldGen.requestWorldGenAbort 置位同一模块位）。
  /** 有无在途作业（generate/saveParse/genIcons 任一 pending）——中止路由判据。 */
  hasPendingWork(): boolean { return this.pending.size > 0; }
  /** 请求中止当前生成作业（无在途作业时置位无害：worker 下次 generateWorld 头部清零）。 */
  abortGen(): void {
    void this.ensureWorker().then((w) => {
      w.postMessage({ id: this.nextId++, type: 'abortGen' } satisfies WorldWorkerRequest);
    }).catch(() => { /* worker 不可用=无作业可中止 */ });
  }

  /** 程序化图标图集(#perf-gpulog 图标包 worker 化):纯像素生成+平铺进单张
   *  图集,rgba transfer 回传。排队语义 = 与后续 saveParse/generate 同 worker
   *  串行——startAssetPrewarm 先发本请求,天然排在读档/生成作业之前 */
  async genIcons(cb?: { timeoutMs?: number }): Promise<{
    rgba: ArrayBuffer; width: number; height: number; cols: number; ids: number[];
  }> {
    const w = await this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // ★BJ702 件1：图标作业超时同样 terminate 共享 worker——慢机图标 >30s 时
        //  排队在后的 saveParse（prewarm 先发、读档复用同 worker 的串行语义）旧
        //  形态孤儿化等 180s；killWorker 一并 reject 即时转回退。
        this.killWorker(new WorldGenUnavailable('图标生成超时'), id);   // F5:触发者保原消息,共飞按自身标签
      }, cb?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: () => undefined, reject, timer,
        onIcons: (ev) => resolve(ev.icons),
      });
      w.postMessage({ id, type: 'genIcons' } satisfies WorldWorkerRequest);
    });
  }

  /** 读档解析（worker 内 IDB 直读/JSON 解析/RLE 解码 + load 模式沉降，transfer 回传） */
  async loadSave(
    args: { key?: string; json?: string; save?: unknown },
    cb?: {
      /** ★BJ702 件5（旁获缺陷）：onEvent 实际以 (phase,label,p,local) 4 参回调
       *  （与 Pending.onProgress/generate 侧 Game.ts 同形）——旧 2 参声明诱导消费方
       *  双参解构,把 label（字符串）绑进 p 位 = 读档进度条全程钉 0%。 */
      onProgress?: (phase: string, label: string, p: number, local?: number) => void;
      timeoutMs?: number;
    },
  ): Promise<{ world: World; player: unknown; save?: unknown }> {
    const w = await this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // ★BJ336 件1：超时路径同步清 stallTimer（BJ331 同案：pending 已删而 interval
        //  永续=拿冻结的 lastEventAt 每 10s 报一次直到页面刷新）
        // ★BJ702 件1：清账收编 killWorker 单源（同 generate 超时——共飞作业一并
        //  reject，不再孤儿化）。
        this.killWorker(new WorldGenUnavailable('读档超时'), id);   // F5:触发者保原消息,共飞按自身标签
      }, cb?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: () => undefined, // loadSave 走 onLoadResult
        reject,
        onProgress: cb?.onProgress as Pending['onProgress'],
        timer,
        // ★BJ336 件1：读档面静默看门狗（worker parse/tiles/settle 三段 progress 流动
        //  复位 lastEventAt；onEvent result/error 臂已有配对清理）——超时值由调用方按
        //  peekSaveDims/worldGenTimeoutMs 扩面（loadFromJson/loadFromKey），此处缺省
        //  仍 180s：key 路径客户端无档内容可窥时由 meta 槽位表兜底，无 meta 回退本值。
        lastEventAt: Date.now(), lastLabel: '开始', stallWarned: false,
        stallTimer: armStallWatchdog('读档', () => this.pending.get(id)),
        onLoadResult: (ev) => {
          if (ev.wkLog?.length) (globalThis as unknown as { __swWkLog?: string[] }).__swWkLog = ev.wkLog;
          resolve({ world: World.fromPacket(ev.world), player: ev.player, save: ev.save });
        },
      });
      w.postMessage({ id, type: 'saveParse', key: args.key, json: args.json, save: args.save as never } satisfies WorldWorkerRequest);
    });
  }

  private onEvent(ev: WorldWorkerEvent) {
    const p = this.pending.get(ev.id);
    if (ev.type === 'icons') {
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(ev.id);
      p.onIcons?.(ev);
      return;
    }
    if (ev.type === 'result') {
      if (!p) return;
      clearTimeout(p.timer);
      if (p.stallTimer) clearInterval(p.stallTimer);
      this.pending.delete(ev.id);
      if (p.onLoadResult) p.onLoadResult(ev);
      else p.resolve(World.fromPacket(ev.world));
      return;
    }
    if (ev.type === 'error') {
      if (!p) return;
      clearTimeout(p.timer);
      if (p.stallTimer) clearInterval(p.stallTimer);
      this.pending.delete(ev.id);
      p.reject(new Error(`[worldGen worker] ${ev.message}`));
      return;
    }
    // ★IIIII229 ①：生成被 Esc 中止（worker 端 WorldGenAbortedError 专用通道）——
    //   以同名错误 reject,调用方（Game.newWorld/mainFlow）判别后按中止收场,
    //   不触发 WorldGenUnavailable fallback。
    if (ev.type === 'aborted') {
      if (!p) return;
      clearTimeout(p.timer);
      if (p.stallTimer) clearInterval(p.stallTimer);
      this.pending.delete(ev.id);
      p.reject(new WorldGenAbortedError());
      return;
    }
    if (ev.type === 'progress') {
      if (p) { p.lastEventAt = Date.now(); p.lastLabel = ev.label ?? ''; p.lastPhase = ev.phase; }
      p?.onProgress?.(ev.phase, ev.label ?? '', ev.p, ev.local);
      return;
    }
    if (ev.type === 'preview') {
      p?.onPreview?.({
        width: ev.width, height: ev.height,
        rgba: new Uint8ClampedArray(ev.rgba),
        passIndex: ev.passIndex, passName: ev.passName,
      });
      return;
    }
    // ready（握手响应）：pending 存的是 ensureWorker 的 resolver（resolve 忽略参数）
    if (ev.type === 'ready' && p) {
      clearTimeout(p.timer);
      this.pending.delete(ev.id);
      p.resolve(null as unknown as World);
    }
  }

  /** worker 级故障（onerror/messageerror）：全量 reject + 分级标记。
   *  ★BJ341 件3：同步清 stallTimer（arm/clear 配对矩阵唯一缺口）——generate 的
   *  内联看门狗闭包直捕 pend（非 map 解析），pending.clear() 后仍每 10s 拿冻结的
   *  lastEventAt 判静默，30s 起报「生成疑似卡死」直到页面刷新（BJ331 超时路径
   *  同案：读档面 armStallWatchdog 走 getPend() map 解析，clear 后读 undefined
   *  早退=只漏 interval 不刷屏，一并清齐）。
   *  ★BJ704-R6 P1（红蓝审查改判）：HTML 规范下脚本加载失败（离线/部署窗 SW miss
   *  冷取快败 reject/504/404）与专用 worker 内未捕获异常【同在 Worker 对象发
   *  error 事件】,onerror 本体不可分——旧码一律 workerBroken 粘滞,把 BJ702 实报
   *  事故窗（新版本部署×瞬断）的快败孪生形态判成硬故障,30s 退避+过窗回升通道被
   *  整体旁路（BJ703-E 只覆盖了挂死形态）。握手窗可分：握手在途（脚本未过 ping
   *  验证,未跑过任何本仓代码）=加载期快败=瞬态,不置 workerBroken,probe 快重试
   *  →30s 退避窗照走（BJ703-E 瞬态语义延伸至快败面）;握手已过=运行期崩溃=硬故障
   *  粘滞（BJ702 语义保留）。messageerror=消息反序列化异常=运行期,恒硬。
   *  source 守卫：迟到事件来自已 terminate/已换代实例=忽略。 */
  private onFatal(source: Worker, mayBeLoadPhase: boolean) {
    if (source !== this.worker) return;   // 迟到 onerror（旧实例）不连带杀在役 worker
    const loadPhase = mayBeLoadPhase && this.handshake !== null;
    if (!loadPhase) this.workerBroken = true;
    this.killWorker(new WorldGenUnavailable(loadPhase ? 'worker 脚本加载失败（瞬态）' : 'worker 故障'));
  }

  /** ★BJ702（2026-10-21 线上实报「小世界读档卡死」）：worker 已死（握手超时/
   *  任务硬超时/onerror）的统一收账——全量 pending reject（各自 timer/stallTimer
   *  同步清）+ teardown。旧四路径只 teardown 不清账：terminate 不触发 onerror/
   *  onmessageerror，在途作业（saveParse/generate/genIcons）成孤儿，只能等自身
   *  180s 硬超时才 reject 转回退——prewarm 握手超时 teardown 共享 worker、
   *  saveParse 孤儿、40s 看门狗点名后用户被迫刷新的实报根因。
   *  ★BJ704-G8 F5（消息归属）：触发者作业（triggerId）保原 err 原样；共飞作业按
   *  自身标签生成消息——旧码全表共用触发者消息，genIcons 30s 超时杀共享 worker 时
   *  在途 saveParse 以「图标生成超时」reject（类型正确、诊断面误导）。新消息类型恒
   *  WorldGenUnavailable（消费面 instanceof→fallback 语义不变），内嵌触发原因
   *  （既有日志/断言 toContain 兼容）+自身最后进度（pending.lastLabel）。onFatal/
   *  terminate 级来路无 triggerId=全表共飞语义。 */
  private killWorker(err: Error, triggerId?: number): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      if (p.stallTimer) clearInterval(p.stallTimer);
      p.reject(id === triggerId ? err : new WorldGenUnavailable(
        `共享 worker 终止（触发：${err.message}），本作业连带中止` +
        (p.lastLabel ? `（最后进度：${p.lastLabel}）` : ''),
      ));
    }
    this.pending.clear();
    // ★BJ703-E 件1：握手字段同步置空——killWorker 后 this.worker=null，但旧握手
    //  Promise（已拒）若残留，会让「this.handshake 非 null ⟺ 在途」的不变式失真
    //  （下一发 ensureWorker 会覆写，此处置空属不变式卫生，无行为面变化）。
    this.handshake = null;
    this.teardown();
  }

  private teardown() {
    this.worker?.terminate();
    this.worker = null;
  }

  /** ★BJ704-G8 F4：terminate 收编 killWorker 同源（BJ702 件1 语义的结构收口）——
   *  旧公开方法只 teardown 不收账不清 handshake，在途作业孤儿到各自 180s 硬超时
   *  （=复活 BJ702 件1 形态的暗门）。现三调用面（mainFlow 退出链:2076[doSave 全链
   *  落定后,无在途窗]/探针桥 releaseWorkers:2325[热重载沿]/Game.destroy:8886
   *  [生成中止链收口后]）均结构性无在途作业——无 pending 时 killWorker≡旧 teardown
   *  （worker terminate+置空+handshake 清），行为不变；未来复用（如加载中途中断）
   *  =在途作业立即 reject 转回退,不再孤儿化。 */
  terminate() { this.killWorker(new WorldGenUnavailable('客户端终止')); }
}

/** 预取(2026-08-25):音频门等待窗口借 SW 回填 worker 脚本进缓存——spawn+延迟
 *  terminate,脚本请求经 SW cache-first 落缓存;真正 ensureWorker 时秒开。
 *  ★必须走本文件的 new Worker(new URL) 模式(vite 才会构建产物);外部裸
 *  new URL 引 .ts 会被当静态资产原样拷进发布包=源码泄漏,实测踩坑 */
export function prefetchWorldGenWorker(): void {
  try {
    const w = new Worker(new URL('./worldGen.worker.ts', import.meta.url), { type: 'module' });
    setTimeout(() => w.terminate(), 3000);
  } catch { /* SW 未控/不支持 → 懒路径照旧 */ }
}
