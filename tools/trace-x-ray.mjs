#!/usr/bin/env node
// trace-x-ray.mjs — Chrome DevTools 性能 trace 一次性拆解工具（永久性,终结"每次取证重写扫描器"循环）
//
// 把 DevTools 导出的 trace JSON（单文件 {metadata, traceEvents:[...]}，可达 500MB+）拆成
// 一份**稳定 schema 的 digest.json**。后续取证刃只读 digest 做分析,不再碰原始 trace。
//
// ═══════════════ 使用 ═══════════════
//   node --max-old-space-size=8192 tools/trace-x-ray.mjs <trace.json> [trace2.json ...] [选项]
//
// 选项：
//   --out <path>        digest 输出路径（多输入时视为目录,缺省 = <trace名>.digest.json 同目录）
//   --md                向 stdout 打印人读摘要
//   --top <N>           每线程 top-self 函数条数（缺省 20,主线程 40）
//   --main-tid <pid:tid> 钉死主线程（缺省自动探测 CrRendererMain）
//   --min-anchor-dur <us> 渲染帧锚最小 rAF dur（缺省 3000,战役 v2 口径）
//   --probe fn1,fn2,...  嫌疑探针：给定函数名单,各输出 self/inclusive/调用者归因
//   --api fn1,fn2,...    覆盖 API 计数面函数名单（缺省见 API_WATCH_DEFAULT）
//   --incl fn1,fn2,...   覆盖 inclusive 观察名单（缺省见 INCL_WATCH_DEFAULT）
//   --tune id=value      覆盖签名阈值（id 见 SIGNATURE_DEFAULTS,如 --tune shmSlowLprFrame=20）
//   --force-stream       强制流式状态机路径（<16MB 文件缺省整读,用于交叉验证）
//   --include-recorder   不剔除录制器伪影帧（缺省:与 StartProfiling 窗/预热窗重叠的渲染帧
//                        标 recorderArtifact 并排除出帧距/fps/慢帧统计——094306 判例 280ms
//                        "巨帧"=CpuProfiler::StartProfiling 启动成本,非游戏卡顿;此旗只关剔除,
//                        recorder 段与逐帧标记仍在）
//   --schema             打印 digest schema 消费契约后退出
//   --quiet              只写文件不打 stdout
//   diff <a.digest.json> <b.digest.json> [--out diff.json]   两份 digest 并排差分
//
// ★内存：流式解析本体恒定内存;但 profile 样本聚合（主线程逐样本时间戳数组）随 trace
//   规模线性。481MB 级 trace 建议 --max-old-space-size=8192;≤200MB 建议 4096。
//   实测 503MB / 257 万事件 ≈ 20s（M 系列 Mac,含全聚合）。
//
// ═══════════════ 口径（战役 v2 校准,2026-09-25 四柱/雷雨七 trace 战役沉淀）═══════════════
//   主线程 = CrRendererMain（事件数最多者;--main-tid 可钉死）
//   渲染帧锚 = 主线程 FireAnimationFrame 且 dur≥3000µs,相邻 >1500µs 去重（v2 口径）
// ★掉帧窗归因（2026-10-27 增强批）:渲染帧=rAF dur≥0.8ms(FrameBeat skip 回调剔除)→
//   掉帧窗=渲染距>12.5ms(剔录制伪影窗)→四分类 tick-hole/slow-frame/gpu-stall/mixed
//   （主忙=调度器顶层 RunTask 时序重叠和;GPU 忙=CrGpuMain 任务重叠和）。判读:
//   tick-hole 主导=浏览器/OS 不发 beginFrame(ProMotion/DisplayLink 族——页面层不可控,
//   缓解=锁低档/钉刷新率);slow-frame 主导=游戏帧本体爆长(挖函数可修)。
//   渲染帧/跳帧 = 主线程 FunctionCall{loop} dur≥1500µs / <1500µs（sw-pass 口径）
//   drawImage% = drawImage 样本自耗时 / 主线程采样墙钟（sw-pass5 口径,非 span 口径）
//   GC 三类 = V8.GC_SCAVENGER|MinorGC → minor;V8.GC_MARK_COMPACTOR|MajorGC → major;
//             V8.GC_MC_INCREMENTAL → incr;堆序列取 MinorGC/MajorGC 的
//             args.data.usedHeapSizeBefore/After（主线程）
//   LPR = 'Draw LazyPixelRef' 瞬时事件（真实绘制 op 计数;健康 GPU 路径 ≈1/渲染帧,
//         SHM 慢路径 ≈260/渲染帧——183751 定谳指纹）
//   Commit = 主线程 X 事件 'Commit'（软件栅格提交;SHM 慢路径单次 p90 ≈12ms）
//   inclusive = 逐节点子树和后按函数名**跨节点求和**（v2 口径,重复栈位会重复计入,刻意）
//
// ═══════════════ 校准锚（机制面由 tests/trace-x-ray-fixture.test.mjs 锁定）═══════════════
//   Trace-20260925T183751（SHM 慢路径病灶）: drawImage 49.2% / LPR≈260/渲染帧 /
//     texSubImage2D≈0 / Commit 785 次,单次 p90≈10.4ms,max≈13.7ms(人工"Commit ~12ms"口径)
//     → 病灶指纹全复现
//   Trace-20260925T214051（健康 GPU 路径）: LPR≈1.0/渲染帧 / 纯雨帧差 ≈+0.6ms/gameMean
//   Trace-20260925T215016（acc 栅格化雷帧）: boltOnly 雷帧 rasterizePathOp 出现,
//     雷帧 tex 上传 p90≈20.7ms/帧（人工口径 ≈2000-3500 次上传/帧）
//   基线 Trace-20260924T010330: drawImage 14.16%（工具实测;人工 13.94% 为同口径早期扫描器
//     分母微差,v2 span 口径 14.44%——三代口径都登记,差 ≤0.3pp)/ MinorGC 5.93/s 逐位命中
//   （lrecon 2616 帧 = 配套 debug-report 游戏内计数器 render.composePath.stats.lrecon,
//     trace 内不存在该信号——工具诚实不报,勿找）
//
// ═══════════════ 录制器干扰项过滤（2026-09-29 批,登记债落刀）═════════════════════════════
//   DevTools/CDP 开 CPU 采样时,trace 里每个 isolate 有一条 CpuProfiler::StartProfiling X
//   事件——它本身就是"启动成本"(堆遍历 safepoint,首启实测 250-820ms),落在游戏帧里会被
//   误读成巨帧。两案判例:
//   Trace-20260929T094306（腐化案）: t=+305ms gap=279.9ms"巨帧"宿主=音频 rAF 回调 step
//     （src/core/Audio.ts startLoop）内被 StartProfiling 279.5ms 打断;健康画像=p99 17.6ms
//     /94.3fps。修:该帧标 recorderArtifact 剔除,帧距统计恢复无巨帧;音频 step 进标签词表。
//   worker 空闲采样伪影: Windows 侧 trace（203039 等）worker 线程 idle 样本落在 (program)
//     而非 (idle)——(program) 占 86-100% 而 named JS 自耗 <5% 的线程实为空闲,曾把
//     ServiceWorker (program) 99.98% 误读成"饱和"。修:worker 行加 idleSamplingSuspect/
//     programSelfPct/namedSelfPct,busyPctOfSpan 恒以 named 自耗为准(本就排除伪根,现以
//     字段+签名值显式化)。
import fs from 'node:fs';
import path from 'node:path';

export const TOOL_NAME = 'trace-x-ray';
export const TOOL_VERSION = '1.1.0';
export const SCHEMA_NAME = 'trace-x-ray.digest';
export const SCHEMA_VERSION = 1;

// ─────────────────────────── 可配置名单（战役沉淀词表,可 CLI 覆盖） ───────────────────────────

// API 计数面：self 耗时 + 样本数 + 直接父/应用祖先归因（任务书点名 + sw-pass4/5 词表并集）
const API_WATCH_DEFAULT = [
  'drawImage', 'texImage2D', 'texSubImage2D', 'drawArrays', 'drawElements', 'fillRect', 'clearRect',
  'fill', 'stroke', 'putImageData', 'getImageData', 'createImageData', 'createElement', 'createPattern',
  'createLinearGradient', 'createRadialGradient', 'createTexture', 'bindTexture', 'bufferData',
  'useProgram', 'readPixels', 'transferFromImageBitmap', 'canvasCaptureStream', 'postMessage',
  'requestAnimationFrame', 'decode',
  // 静默降级桶嫌疑（SILENT_DEGRADE_BUCKET 消费;不计入会造成恒 0 伪绿）
  'degradeAcc', 'ensureBridged', 'finishAccFrame',
];

// inclusive 观察名单（战役 watch 词表;digest 只收 >5ms 条目控体积）
const INCL_WATCH_DEFAULT = [
  'frame', 'loop', 'render', 'fixedUpdate', 'step', 'tick', 'drawRain', 'drawPrecipDust', 'bakeMemoized',
  'drawBolt', 'generateBolt', 'stormTexBrightness', 'rasterizePathOp', 'recordPathOp', 'accScratch',
  'flushAcc', 'flush', 'presentBatch', 'present', 'finishAccFrame', 'degradeAcc', 'ensureBridged',
  'blurLine', 'exportTo', 'compositeLight', 'surfaceSky', 'mmHudBlit', 'drawVanillaLiquids',
  'drawLiquidBehindTilesOnly', 'decode', 'texRefresh',
];

// 逐样本打标（caller-tag 词表 = 战役 v2 逐字;顺序即优先级,勿重排）
const TAG_BOLT = ['drawBolt', 'stormTexBrightness', 'generateBolt'];
const TAG_RAIN = ['drawRain', 'drawPrecipDust', 'bakeMemoized'];
const TAG_RASTER = ['rasterizePathOp', 'recordPathOp', 'accScratch', 'rasterizeOp'];
const TAG_PRESENT = ['presentBatch', 'flushAcc', 'replay2D'];
const TAG_TRAIL = ['flushTrailShade', 'prettyStarSparkle'];
const TAG_HUD = ['mmHudBlit'];
const TAG_LIQ = ['drawVanillaLiquids', 'drawLiquidBehindTilesOnly'];
const TAG_ATLAS = ['atlasIcon', 'atlasIconForKey', 'sheetOf', 'sheetOf$1'];
const TAG_LIGHT = ['exportTo', 'blurLine', 'surfaceSky', 'compositeLight'];
// 音频域 rAF 回调（src/core/Audio.ts startLoop 的 step;腐化案 094306 的 280ms"巨帧"宿主
// 就是它——此前不在标签词表,slowest 分解全 0,读不出宿主只能另写一次性普查脚本）。
// ★必须配合「父节点=伪根」门控:游戏主循环子树内也有同名 step(Liquid.step 等),
//  无门控会把游戏帧样本误标 audio。词表可扩展(其它 Game/Audio 域 rAF 根回调)。
const TAG_AUDIO = ['step'];
// rAF 根回调的父节点形态（profile 树中 rAF 回调挂在伪根下）
const RAF_ROOT_PARENT = new Set(['(root)', '(program)', '(idle)', '']);
// 静默降级桶嫌疑名单（签名 SILENT_DEGRADE_BUCKET 消费）
const DEGRADE_FNS = ['degradeAcc', 'ensureBridged', 'finishAccFrame'];

// 真实绘制 op X 事件名单（绝大多数 trace 只会出现 Paint/PaintImage,列出以求完备）
const CANVAS_OP_NAMES = new Set([
  'Paint', 'PaintImage', 'PrePaint', 'DrawImage', 'DrawRect', 'DrawText', 'DrawPath', 'FillPath',
  'FillRect', 'StrokeRect', 'ClearRect', 'DrawGlyphArcList', 'DrawOval', 'DrawRRect', 'DrawImageRect',
]);

// GC 计数只用 canonical 事件名(每个 scavenger 在 trace 里有 3 个伴生名,全部计数会×3——
// 战役口径=只数 V8.GC_*;MinorGC/MajorGC 仅作 usedHeapSize 堆载体)
const GC_KIND = (n) => {
  if (n === 'V8.GC_SCAVENGER') return 'minor';
  if (n === 'V8.GC_MARK_COMPACTOR') return 'major';
  if (n === 'V8.GC_MC_INCREMENTAL') return 'incr';
  return null;
};
const HEAP_CARRIER = (n) => n === 'MinorGC' || n === 'MajorGC';

// ─────────────────────────── 签名库（阈值 + 解释文字;--tune 可覆盖） ───────────────────────────

export const SIGNATURE_DEFAULTS = {
  shmSlowLprFrame: { v: 50, explain: 'LPR/渲染帧超过此值 = 2D 画布走软件栅格+SHM 慢路径（健康 GPU 路径 ≈1,183751 病灶 ≈260）' },
  shmSlowOpMeanUs: { v: 15, explain: '主线程单绘制 op 均耗超过此 µs 数 = 慢路径单 op 成本超标（战役定谳阈值 15µs）' },
  uploadFrameWarnMs: { v: 2, explain: '单帧 tex 上传自耗时告警线(ms);雷帧/上传风暴帧远超此值' },
  uploadStormFrames: { v: 500, explain: '单帧上传自耗 >1ms 的帧数超过此值 = 上传风暴（战役人工口径 >500 帧）' },
  contextLostWarn: { v: 3, explain: 'contextlost 类事件超过此值告警' },
  contextLostStorm: { v: 20, explain: 'contextlost 风暴线（GL 资源反复重建）' },
  workerCountMax: { v: 32, explain: 'DedicatedWorker 数超过此值报异常（本游戏正常池 ≈3-17 个:LightWorker/WaveWorker/SaveWorker 等,数量仅兜底,忙碌 worker 检测才是主信号）' },
  workerBusyPct: { v: 25, explain: 'worker 采样墙钟占 trace 跨度超过此 % 报忙碌 worker' },
  degradeSelfSharePct: { v: 0.3, explain: '降级桶函数(degradeAcc/ensureBridged/finishAccFrame)自耗占比超过此 % = 静默降级在发生' },
  gcMinorPerSecWarn: { v: 10, explain: '主线程 minor GC 每秒次数告警线（基线 010330 = 5.93/s）' },
  gcMinorPerSecAlarm: { v: 30, explain: 'minor GC 风暴线' },
  stallP99WarnMs: { v: 33, explain: '帧距 p99 告警线(ms)' },
  stallP99AlarmMs: { v: 50, explain: '帧距 p99 风暴线' },
  mainBusyPct: { v: 98, explain: '主线程 RunTask busy 占比超过此 % = 极端饱和（游戏 rAF 满载属常态）' },
  recorderWarmupMs: { v: 500, explain: '录制启动采样收敛预热窗(ms);首次 CpuProfiler::StartProfiling 事件结束后此窗内的渲染帧一并标 recorderArtifact（094306 判例:280ms"巨帧"=StartProfiling 启动成本,预热窗同理剔除）' },
};

// ─────────────────────────── 流式状态机（战役 tracelib.mjs 逐字演化,恒定内存） ───────────────────────────
// 单大对象 {metadata, traceEvents:[...]};depth2 捕获事件原文,块边界靠 capture-open 快照回退重扫。

export function scanTraceStream(filePath, onEvent) {
  const CH = 1 << 23; // 8MB
  const fd = fs.openSync(filePath, 'r');
  const size = fs.fstatSync(fd).size;
  let carry = Buffer.alloc(0);
  let abs = 0; // carry[0] 的绝对偏移
  let depth = 0, inStr = false, esc = false;
  let inTrace = false, strIsKey = false, strStart = -1, keyBuf = '';
  let capStart = -1;
  let lastSig = 0;
  let total = 0, bad = 0;
  let done = false;

  let snap = null;
  function takeSnap(absCapStart) {
    snap = { depth, inStr, esc, inTrace, strIsKey, strStart, keyBuf, lastSig, capStart: absCapStart };
  }
  function restoreSnap() {
    depth = snap.depth; inStr = snap.inStr; esc = snap.esc; inTrace = snap.inTrace;
    strIsKey = snap.strIsKey; strStart = snap.strStart; keyBuf = snap.keyBuf; lastSig = snap.lastSig;
    capStart = snap.capStart;
  }

  function feed(chunk) {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const base = abs;
    const n = data.length;
    for (let i = 0; i < n; i++) {
      const c = data[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === 0x5c) { esc = true; continue; }
        if (c === 0x22) {
          inStr = false;
          lastSig = 0x22;
          if (depth === 1 && strIsKey) keyBuf = data.slice(strStart, i).toString('utf8');
          continue;
        }
        continue;
      }
      switch (c) {
        case 0x22:
          inStr = true; esc = false;
          strIsKey = (lastSig === 0x7b || lastSig === 0x2c || lastSig === 0x5b || lastSig === 0);
          strStart = i + 1;
          break;
        case 0x7b:
          if (inTrace && depth === 2) { capStart = base + i; takeSnap(capStart); }
          depth++; lastSig = 0x7b;
          break;
        case 0x7d:
          depth--;
          if (capStart >= 0 && depth === 2) {
            const raw = data.slice(capStart - base, i + 1);
            capStart = -1; snap = null; total++;
            let ev = null;
            try { ev = JSON.parse(raw.toString('utf8')); } catch { bad++; }
            if (ev) { try { onEvent(ev); } catch { bad++; } }
          }
          lastSig = 0x7d;
          break;
        case 0x5b:
          if (depth === 1 && keyBuf === 'traceEvents') inTrace = true;
          depth++; lastSig = 0x5b;
          break;
        case 0x5d:
          depth--;
          if (depth === 1 && inTrace) inTrace = false;
          lastSig = 0x5d;
          break;
        default:
          if (c > 0x20) lastSig = c;
      }
    }
    if (capStart >= 0) {
      const keep = capStart - base;
      // ★必须真拷贝:data 在 carry 空时是共享外部复用读缓冲的视图(Buffer.slice=subarray 视图),
      //   下轮 readSync 会覆写这些字节——战役 tracelib 原版靠循环内重 alloc 避坑,此处显式拷贝。
      carry = Buffer.from(data.subarray(keep));
      abs = base + keep;
      restoreSnap();
    } else {
      carry = Buffer.alloc(0);
      abs = base + n;
    }
  }

  const buf = Buffer.alloc(CH);
  while (!done) {
    const got = fs.readSync(fd, buf, 0, CH, null);
    if (got <= 0) { done = true; break; }
    feed(buf.subarray(0, got)); // 短读≠EOF,仅 got===0 是
  }
  fs.closeSync(fd);
  return { total, bad, size };
}

// ─────────────────────────── 小工具 ───────────────────────────

const round = (x, d = 2) => (x === undefined || x === null || !isFinite(x)) ? 0 : +x.toFixed(d);
function pctOf(sortedArr, q) { // 最近邻位（战役 pct 口径;入参须已升序）
  if (!sortedArr.length) return 0;
  return sortedArr[Math.min(sortedArr.length - 1, Math.ceil(q * sortedArr.length) - 1)];
}
const r2 = (a) => a.slice().sort((x, y) => x - y);

function durStats(arrUs) { // arr: µs 数组 → {n,mean,p50,p90,max}
  if (!arrUs.length) return { n: 0, meanUs: 0, p50Us: 0, p90Us: 0, maxUs: 0 };
  const s = r2(arrUs);
  return {
    n: s.length,
    meanUs: round(s.reduce((a, b) => a + b, 0) / s.length, 1),
    p50Us: round(pctOf(s, 0.5), 1),
    p90Us: round(pctOf(s, 0.9), 1),
    maxUs: round(s[s.length - 1], 1),
  };
}

// 可增长 f64 数组（主线程逐样本 ts/nodeId 成对存;worker 走 digest 期聚合,不存 ts）
class F64Vec {
  constructor() { this.cap = 1 << 16; this.a = new Float64Array(this.cap); this.n = 0; }
  push(v) {
    if (this.n === this.cap) {
      this.cap *= 2;
      const b = new Float64Array(this.cap); b.set(this.a); this.a = b;
    }
    this.a[this.n++] = v;
  }
}

// ─────────────────────────── 单遍扫描聚合器 ───────────────────────────

function makeAccumulator(opts) {
  const pinnedTid = opts.mainTid || null; // 'pid:tid' | null
  const acc = {
    threads: new Map(),        // 'pid:tid' -> {pid,tid,name,events,busyUs}
    procNames: new Map(),
    tmin: Infinity, tmax: -Infinity,
    events: 0, bad: 0,
    fires: [],                 // [ts,dur,tid]×n（rAF 全线程收集,锚构建时筛主线程）
    // ★掉帧窗归因数据源(2026-10-27):主线程调度器顶层 RunTask 时序(主忙口径,
    // 无嵌套重复计数)+ GPU 主线程(CrGpuMain)任务时序(洞段 GPU 背压判据)
    runTaskMainTs: [],         // [ts,dur]×n（主线程顶层 RunTask）
    gpuMainTs: [],             // [ts,dur]×n（CrGpuMain X>200µs）
    gpuMainKey: null,          // 'pid:tid'（thread_name CrGpuMain 时钉）
    loopFrames: [],            // 主线程 FunctionCall{loop} {ts,dur}
    drawFrameTs: new Map(),    // tid -> [ts]（DrawFrame,合成器;辅助帧距）
    gcEvents: [],              // [ts,dur,kind(0/1/2),tid]×n
    heap: [],                  // {ts,before,after}（MinorGC/MajorGC,主线程）
    lprTs: [],                 // 主线程 LPR 瞬时
    commitDur: [],             // 主线程 Commit X dur
    paintOps: new Map(),       // op 名 → dur 数组（主线程 X）
    runTaskMain: { n: 0, dur: 0 }, // 主线程调度器顶层 RunTask（busy 口径,无嵌套重复计数）
    dropped: 0,
    ctxLost: 0,
    postMsgByThread: new Map(),
    profiles: new Map(),       // sessionKey -> session
    mainSessionKeys: [],
    startProfiling: [],        // [ts,dur,tidKey]×n — CpuProfiler::StartProfiling X（每 isolate 一条;录制器干扰项过滤的数据源）
    pinnedResolved: pinnedTid,
    seenRendererMain: new Map(),// 'pid:tid' -> events（钉定复核用）
    chunkShapes: new Map(),
    dataOffsetChunks: 0,
  };

  let sessionSeq = 0;
  const idToSession = new Map(); // trace ev.id -> sessionKey（同 id 重开 profile 时新 session 接管）

  function isMain(s) { return acc.pinnedResolved && s.tidKey === acc.pinnedResolved; }

  acc.feed = function (ev) {
    acc.events++;
    const name = ev.name || '';
    const cat = ev.cat || '';
    const ts = ev.ts;
    if (typeof ts === 'number' && ts > 1000) {
      if (ts < acc.tmin) acc.tmin = ts;
      if (ts > acc.tmax) acc.tmax = ts;
    }
    if (cat === '__metadata') {
      if (name === 'thread_name') {
        const k = ev.pid + ':' + ev.tid;
        const t = acc.threads.get(k);
        const nm = ev.args?.name || '?';
        if (t) t.name = nm; else acc.threads.set(k, { pid: ev.pid, tid: ev.tid, name: nm, events: 0, busyUs: 0 });
        if (nm === 'CrGpuMain') acc.gpuMainKey = k;
        if (nm === 'CrRendererMain') {
          acc.seenRendererMain.set(k, 0);
          if (!acc.pinnedResolved && !opts.mainTid) acc.pinnedResolved = k; // 首个钉定,事后复核
        }
      } else if (name === 'process_name') {
        acc.procNames.set(ev.pid, ev.args?.name || '?');
      }
      return;
    }
    const tidKey = ev.pid + ':' + ev.tid;
    const th = acc.threads.get(tidKey);
    if (th) { th.events++; if (ev.ph === 'X') th.busyUs += (ev.dur || 0); }
    else acc.threads.set(tidKey, { pid: ev.pid, tid: ev.tid, name: '?', events: 1, busyUs: ev.ph === 'X' ? (ev.dur || 0) : 0 });
    if (acc.seenRendererMain.has(tidKey)) acc.seenRendererMain.set(tidKey, acc.seenRendererMain.get(tidKey) + 1);

    // ── CPU profile 重组（Profile/ProfileChunk,跨事件;样本自耗=下一 delta,战役口径） ──
    if (cat.includes('cpu_profiler')) {
      if (name === 'Profile') {
        const sk = (ev.id || '0x0') + '#' + (++sessionSeq);
        const s = {
          key: sk, pid: ev.pid, tid: ev.tid, tidKey,
          startTs: ev.args?.data?.startTime ?? ev.ts ?? 0, lastTs: 0, lastTsInit: false,
          nodes: new Map(), selfUs: new Map(), pendingNode: null,
          samples: 0, wallUs: 0,
          tsVec: null, idVec: null,
        };
        acc.profiles.set(sk, s);
        idToSession.set(ev.id, sk);
        if (isMain(s)) { acc.mainSessionKeys.push(sk); s.tsVec = new F64Vec(); s.idVec = new F64Vec(); }
        return;
      }
      if (name === 'ProfileChunk') {
        const sk = idToSession.get(ev.id);
        if (!sk) return;
        const s = acc.profiles.get(sk);
        const d = ev.args?.data || {};
        const shapeKey = Object.keys(d).sort().join('|');
        acc.chunkShapes.set(shapeKey, (acc.chunkShapes.get(shapeKey) || 0) + 1);
        if (d.dataOffset !== undefined) acc.dataOffsetChunks++;
        const cp = d.cpuProfile || {};
        if (cp.nodes) {
          for (const nd of cp.nodes) {
            const cf = nd.callFrame || {};
            s.nodes.set(nd.id, { p: nd.parent, fn: cf.functionName || '(anonymous)', url: cf.url || '', line: cf.lineNumber ?? -1 });
          }
        }
        const samples = cp.samples || [], td = d.timeDeltas || [];
        const m = Math.min(samples.length, td.length);
        if (!s.lastTsInit) { s.lastTs = s.startTs || 0; s.lastTsInit = true; }
        const main = isMain(s);
        for (let j = 0; j < m; j++) {
          const dt = td[j] >= 0 ? td[j] : 0;
          s.lastTs += dt; s.wallUs += dt;
          const node = samples[j];
          // 上一 chunk 尾样本的自耗,由本 chunk 首 delta 收账
          if (s.pendingNode !== null) {
            s.selfUs.set(s.pendingNode, (s.selfUs.get(s.pendingNode) || 0) + dt);
            s.pendingNode = null;
          }
          if (j + 1 < m) {
            const nx = td[j + 1] >= 0 ? td[j + 1] : 0;
            s.selfUs.set(node, (s.selfUs.get(node) || 0) + nx);
          } else {
            s.pendingNode = node;
          }
          if (main) { s.tsVec.push(s.lastTs); s.idVec.push(node); }
          s.samples++;
        }
        return;
      }
      return;
    }

    // ── 线程无关散点信号 ──
    const kind = GC_KIND(name);
    if (kind) {
      acc.gcEvents.push(ts || 0, ev.dur || 0, kind === 'minor' ? 0 : kind === 'major' ? 1 : 2, ev.tid);
      return;
    }
    if (HEAP_CARRIER(name)) {
      // MinorGC/MajorGC(devtools.timeline,v8):堆载体(不重复计数;仅主线程取堆)。
      // ★堆字段有两种 Chrome 形态:args.usedHeapSizeAfter(本战役 trace)或
      //   args.data.usedHeapSizeAfter(旧版)——两读,勿再赌单形态。
      const heapArg = ev.args?.usedHeapSizeAfter !== undefined ? ev.args : ev.args?.data;
      if (acc.pinnedResolved && tidKey === acc.pinnedResolved && heapArg?.usedHeapSizeAfter !== undefined) {
        acc.heap.push({ ts: ts || 0, before: heapArg.usedHeapSizeBefore || 0, after: heapArg.usedHeapSizeAfter || 0 });
      }
      return;
    }
    if (/context.?lost/i.test(name)) { acc.ctxLost++; return; }
    if (/postmessage/i.test(name)) { acc.postMsgByThread.set(tidKey, (acc.postMsgByThread.get(tidKey) || 0) + 1); return; }
    if (name === 'DroppedFrame') { acc.dropped++; return; }
    if (name === 'DrawFrame') {
      let a = acc.drawFrameTs.get(tidKey);
      if (!a) { a = []; acc.drawFrameTs.set(tidKey, a); }
      a.push(ts || 0);
      return;
    }
    if (name === 'FireAnimationFrame') { acc.fires.push(ts || 0, ev.dur || 0, ev.tid); return; }
    // 录制器会话检测:Profiler.start 在每个 isolate 上落一条 X 事件,dur=启动成本本身
    // （首启 250-820ms 堆遍历 safepoint;任意线程,主线程那条就是"巨帧"真身——094306 判例）
    if (name === 'CpuProfiler::StartProfiling' && ev.ph === 'X') {
      acc.startProfiling.push(ts || 0, ev.dur || 0, tidKey);
      return;
    }
    // ★掉帧窗归因:GPU 主线程任务时序(与主线程门禁并行收集)
    if (acc.gpuMainKey && tidKey === acc.gpuMainKey && ev.ph === 'X' && (ev.dur || 0) > 200) {
      acc.gpuMainTs.push(ts || 0, ev.dur || 0);
    }

    if (!acc.pinnedResolved || tidKey !== acc.pinnedResolved) return;

    // ── 主线程专属 ──
    if (ev.ph === 'X') {
      if (name === 'FunctionCall') {
        if (ev.args?.data?.functionName === 'loop') acc.loopFrames.push({ ts: ts || 0, dur: ev.dur || 0 });
      } else if (name === 'Commit') {
        acc.commitDur.push(ev.dur || 0);
      } else if (name === 'RunTask') {
        acc.runTaskMain.n++; acc.runTaskMain.dur += ev.dur || 0;
        acc.runTaskMainTs.push(ts || 0, ev.dur || 0);
      } else if (CANVAS_OP_NAMES.has(name)) {
        let a = acc.paintOps.get(name);
        if (!a) { a = []; acc.paintOps.set(name, a); }
        a.push(ev.dur || 0);
      }
    } else if (ev.ph === 'I' || ev.ph === 'i') {
      if (name === 'Draw LazyPixelRef') acc.lprTs.push(ts || 0);
    }
  };

  return acc;
}

// ─────────────────────────── 单 trace → digest ───────────────────────────

export async function digestTrace(tracePath, opts = {}) {
  const t0 = Date.now();
  const size = fs.statSync(tracePath).size;
  const small = size < 16 * 1024 * 1024 && !opts.forceStream;

  let acc = runScan(tracePath, opts, small);

  // 主线程钉定复核：多 renderer 时换事件数最多者重扫（罕见;多进程同 trace 才触发）
  if (!opts.mainTid) {
    let best = null, bestN = -1;
    for (const [k, n] of acc.seenRendererMain) if (n > bestN) { bestN = n; best = k; }
    const pinnedN = acc.pinnedResolved ? (acc.seenRendererMain.get(acc.pinnedResolved) || 0) : -1;
    if (best && acc.pinnedResolved && best !== acc.pinnedResolved && bestN > pinnedN) {
      acc = runScan(tracePath, { ...opts, mainTid: best }, small);
    }
  }

  return buildDigest(tracePath, acc, opts, { size, scanMs: Date.now() - t0 });
}

function runScan(tracePath, opts, small) {
  const acc = makeAccumulator(opts);
  if (small) {
    // 整读快路径（<16MB）：同一 handler,不同解析路径（fixture/交叉验证面）
    const whole = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
    const evs = Array.isArray(whole) ? whole : (whole.traceEvents || []);
    for (const ev of evs) acc.feed(ev);
    acc.events = evs.length;
    acc.bad = 0;
    acc.size = fs.statSync(tracePath).size; // 用文件真值;重序列化 byteLength 会漂,破坏双路径全等
  } else {
    const r = scanTraceStream(tracePath, (ev) => acc.feed(ev));
    acc.events = r.total;
    acc.bad = r.bad;
    acc.size = r.size;
  }
  return acc;
}

// ─────────────────────────── digest 构建（扫描后的纯计算） ───────────────────────────

function buildDigest(tracePath, acc, opts, meta) {
  const spanUs = acc.tmax > acc.tmin ? acc.tmax - acc.tmin : 0;
  const mainKey = acc.pinnedResolved;
  const mainTh = mainKey ? acc.threads.get(mainKey) : null;

  // ── 线程清单 ──
  const threads = [...acc.threads.values()]
    .map((t) => ({
      pid: t.pid, tid: t.tid, name: t.name,
      process: acc.procNames.get(t.pid) || '?',
      role: t.name === 'CrRendererMain' ? 'main' : /Worker/i.test(t.name) ? 'worker' : t.name === 'Compositor' ? 'compositor' : 'other',
      events: t.events, busyMs: round(t.busyUs / 1000, 1),
      // ★busyPct 只对主线程有意义:X 事件含嵌套(子事件重复计入),裸和会 >100%;
      //   主线程用调度器顶层 RunTask 合计口径,其他线程 null(worker 用 workers[].busyPctOfSpan)
      busyPct: (mainKey === t.pid + ':' + t.tid && spanUs) ? round((acc.runTaskMain.dur / spanUs) * 100, 1) : null,
    }))
    .sort((a, b) => b.events - a.events);

  // ── 渲染帧锚（主线程 rAF dur≥阈值 + 相邻去重） ──
  const minAnchor = opts.minAnchorDur ?? 3000;
  const anchors = [];
  const anchorDur = [];
  {
    const mainTid = mainTh ? mainTh.tid : -1;
    const list = [];
    for (let i = 0; i < acc.fires.length; i += 3) {
      if (acc.fires[i + 2] === mainTid && acc.fires[i + 1] >= minAnchor) list.push([acc.fires[i], acc.fires[i + 1]]);
    }
    list.sort((a, b) => a[0] - b[0]);
    let last = -1e18;
    for (const [ts, dur] of list) if (ts - last > 1500) { anchors.push(ts); anchorDur.push(dur); last = ts; }
  }
  const nA = anchors.length;

  // ── 录制器会话与伪影窗（每 isolate 一条 StartProfiling;首次带采样收敛预热窗） ──
  const includeRecorder = !!opts.includeRecorder;
  const warmupUs = (opts.tune && opts.tune.recorderWarmupMs !== undefined ? +opts.tune.recorderWarmupMs : SIGNATURE_DEFAULTS.recorderWarmupMs.v) * 1000;
  const recSessions = [];
  for (let i = 0; i < acc.startProfiling.length; i += 3) recSessions.push({ ts: acc.startProfiling[i], dur: acc.startProfiling[i + 1], tidKey: acc.startProfiling[i + 2] });
  recSessions.sort((a, b) => a.ts - b.ts);
  const recWindows = recSessions.map((s, idx) => ({
    ts: s.ts, end: s.ts + s.dur + (idx === 0 ? warmupUs : 0), warmup: idx === 0 ? warmupUs : 0, isFirst: idx === 0,
  }));
  // 帧伪影判定:gap 区间 (prev,cur) 或锚执行窗 [cur,cur+dur) 与任一伪影窗相交
  // （094306 判例:280ms 巨帧=宿主帧被打断,下一锚的 gap 区间吞下整个 StartProfiling 窗）
  const frameArtifactHit = (i, w) => {
    const a = anchors[i];
    const prev = i ? anchors[i - 1] : a;
    return (Math.max(prev, w.ts) < Math.min(a, w.end)) || (Math.max(a, w.ts) < Math.min(a + anchorDur[i], w.end));
  };
  const artifact = new Uint8Array(nA);
  for (let i = 0; i < nA; i++) for (const w of recWindows) if (frameArtifactHit(i, w)) { artifact[i] = 1; break; }
  let nArt = 0;
  for (let i = 0; i < nA; i++) nArt += artifact[i];
  // 伪影窗并集 ∩ trace span（fps 有效分母扣减项;无会话时=0,统计口径与旧版逐位一致）
  let artifactUnionUs = 0;
  {
    const cl = recWindows.map((w) => [Math.max(w.ts, acc.tmin), Math.min(w.end, acc.tmax)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let cs = 0, ce = 0, first = true;
    for (const [s, e] of cl) {
      if (first || s > ce) { if (!first) artifactUnionUs += ce - cs; cs = s; ce = e; first = false; }
      else if (e > ce) ce = e;
    }
    if (!first) artifactUnionUs += ce - cs;
  }

  const gaps = [];
  for (let i = 1; i < nA; i++) {
    if (includeRecorder || !artifact[i]) gaps.push((anchors[i] - anchors[i - 1]) / 1000);
  }
  const gsorted = r2(gaps);
  const loopFrames = acc.loopFrames.slice().sort((a, b) => a.ts - b.ts);
  const renderLoop = loopFrames.filter((f) => f.dur >= 1500).length;

  // ── 逐帧桶（标签/上传/LPR/GC 归帧;窗口 100ms,战役口径） ──
  const TAGS = ['game', 'bolt', 'rain', 'raster', 'present', 'trail', 'hud', 'liquid', 'light', 'atlas', 'audio', 'other', '(root)', '(program)', '(idle)', '(garbage collector)'];
  const TAG_IDX = new Map(TAGS.map((t, i) => [t, i]));
  const BOLT_SET = new Set(TAG_BOLT), RAIN_SET = new Set(TAG_RAIN), RASTER_SET = new Set(TAG_RASTER), TRAIL_SET = new Set(TAG_TRAIL);
  const PRESENT_SET = new Set(TAG_PRESENT), HUD_SET = new Set(TAG_HUD), LIQ_SET = new Set(TAG_LIQ), ATLAS_SET = new Set(TAG_ATLAS), LIGHT_SET = new Set(TAG_LIGHT);
  const AUDIO_SET = new Set(TAG_AUDIO);
  const texUploadFns = new Set(['texImage2D', 'texSubImage2D', 'createTexture']);
  const fw = [];
  for (let i = 0; i < nA; i++) {
    fw.push({ gap: i ? (anchors[i] - anchors[i - 1]) / 1000 : 0, tags: new Float64Array(TAGS.length), lpr: 0, gcMs: 0, gcN: 0, texUploadUs: 0, drawImageUs: 0 });
  }
  {
    const mainTid = mainTh ? mainTh.tid : -1;
    const gcs = [];
    for (let i = 0; i < acc.gcEvents.length; i += 4) gcs.push({ ts: acc.gcEvents[i], dur: acc.gcEvents[i + 1], kind: acc.gcEvents[i + 2], tid: acc.gcEvents[i + 3] });
    gcs.sort((a, b) => a.ts - b.ts);
    let p = 0;
    for (const g of gcs) {
      if (g.tid !== mainTid) continue;
      while (p + 1 < nA && anchors[p + 1] <= g.ts) p++;
      const f = fw[p];
      if (f && g.ts >= anchors[p] && g.ts - anchors[p] < 100000) { f.gcMs += g.dur; if (g.kind === 0) f.gcN++; }
    }
    let q = 0;
    for (const ts of acc.lprTs) {
      while (q + 1 < nA && anchors[q + 1] <= ts) q++;
      const f = fw[q];
      if (f && ts >= anchors[q] && ts - anchors[q] < 100000) f.lpr++;
    }
  }

  // ── profile 汇总 ──
  const apiWatch = new Set(opts.apiWatch || API_WATCH_DEFAULT);
  const inclWatch = new Set(opts.inclWatch || INCL_WATCH_DEFAULT);
  const probeWatch = new Set(opts.probe || []);
  const mainSessions = acc.mainSessionKeys.map((k) => acc.profiles.get(k)).filter(Boolean);
  const profOut = {
    sessions: acc.profiles.size,
    chunks: [...acc.chunkShapes.values()].reduce((a, b) => a + b, 0),
    dataOffsetChunks: acc.dataOffsetChunks,
    chunkShapes: Object.fromEntries(acc.chunkShapes),
    samples: 0, sampledWallMs: 0,
  };
  const apiSelf = new Map(), apiSamples = new Map();
  const apiCallers = new Map();    // fn -> Map(直接父fn -> us)
  const apiAppCallers = new Map(); // fn -> Map('fn@file:line' -> us)
  const tagAgg = new Float64Array(TAGS.length);
  const winSelf = new Map();
  const topSelfByThread = [];
  const probeRows = [];
  const inclRowsOut = [];
  let samplesMain = 0, wallMain = 0;

  // worker session 行（digest 期按 node→fn 聚合;不存逐样本 ts,恒定内存压力低）
  const workerRowsOut = [];
  for (const s of acc.profiles.values()) {
    if (mainSessions.includes(s)) continue;
    const th = acc.threads.get(s.tidKey);
    const byFn = new Map();
    let workerBusyUs = 0;    // 非闲置自耗(排除 (idle)/(program)/(garbage collector)/(root);★busyPctOfSpan 恒以此 named 自耗为分子——空闲采样伪影修正口径)
    let workerNamedUs = 0, workerProgUs = 0, workerIdleUs = 0;
    for (const [id, us] of s.selfUs) {
      const nd = s.nodes.get(id);
      if (!nd) continue;
      const k = nd.fn + '|' + (nd.url || '').split('/').pop();
      byFn.set(k, (byFn.get(k) || 0) + us);
      if (nd.fn === '(idle)') workerIdleUs += us;
      else if (nd.fn === '(program)') workerProgUs += us;
      else if (nd.fn !== '(garbage collector)' && nd.fn !== '(root)') { workerNamedUs += us; workerBusyUs += us; }
    }
    // 空闲采样伪影(Windows 侧判例:worker idle 样本落 (program) 而非 (idle)——
    // ServiceWorker busy 实 0% 但 (program) 99.98%;203039 判例 DedicatedWorker (program) 86-96%)。
    // 判据:有 named JS 但 (program) 占主导(>50% 采样墙钟)且 named 自耗 <5% → 线程实为空闲,
    // (program) 份额是采样伪影;busyPctOfSpan 以 named 为准(本就如此,现以字段显式化防再误读)。
    const wWall = s.wallUs || 1;
    const idleSamplingSuspect = s.samples >= 10 && workerNamedUs > 0
      && workerProgUs / wWall > 0.5 && workerNamedUs / wWall < 0.05;
    workerRowsOut.push({
      pid: s.pid, tid: s.tid, name: th ? th.name : '?',
      samples: s.samples, sampledWallMs: round(s.wallUs / 1000, 1),
      busyPctOfSpan: spanUs ? round((workerBusyUs / spanUs) * 100, 1) : 0,
      namedSelfPct: round((workerNamedUs / wWall) * 100, 2),
      programSelfPct: round((workerProgUs / wWall) * 100, 2),
      idleSelfPct: round((workerIdleUs / wWall) * 100, 2),
      idleSamplingSuspect,
      top: [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, us]) => ({ fn: k.split('|')[0], url: k.split('|')[1] || '', selfMs: round(us / 1000, 1), shareOfSampledPct: s.wallUs ? round((us / s.wallUs) * 100, 2) : 0 })),
    });
    profOut.samples += s.samples;
    profOut.sampledWallMs += s.wallUs;
  }

  // 主线程 session：树构建 + tag 扫描 + api 归因 + probe
  for (const s of mainSessions) {
    profOut.samples += s.samples;
    profOut.sampledWallMs += s.wallUs;
    samplesMain += s.samples;
    wallMain += s.wallUs;
    // kids + 子树和
    const kids = new Map();
    for (const [id, nd] of s.nodes) {
      const pk = nd.p ?? 0;
      if (!kids.has(pk)) kids.set(pk, []);
      kids.get(pk).push(id);
    }
    const totalMemo = new Map();
    const totalOf = (id) => {
      let m = totalMemo.get(id);
      if (m !== undefined) return m;
      m = s.selfUs.get(id) || 0;
      const ch = kids.get(id) || [];
      if (ch.length <= 20000) for (const c of ch) m += totalOf(c); // 防御:超大扇出只算自耗
      totalMemo.set(id, m);
      return m;
    };
    // gameRoot：'(root)' 下 fn==='loop' 总耗最大者（战役口径）
    let rootId = null;
    for (const [id, nd] of s.nodes) if (nd.fn === '(root)') { rootId = id; break; }
    let gameRoot = -1, bestT = -1;
    if (rootId !== null) {
      for (const c of kids.get(rootId) || []) {
        const nd = s.nodes.get(c);
        if (nd && nd.fn === 'loop') { const t = totalOf(c); if (t > bestT) { bestT = t; gameRoot = c; } }
      }
    }
    // tagOf（起点 memo;战役 v2 优先级序,勿重排）
    const tagCache = new Map();
    const tagOf = (id) => {
      let t = tagCache.get(id);
      if (t !== undefined) return t;
      let cur = id, guard = 0, found = 'other';
      while (cur !== undefined && guard++ < 80) {
        const nd = s.nodes.get(cur);
        if (!nd) { found = 'other'; break; }
        if (nd.p === gameRoot || cur === gameRoot) { found = 'game'; break; }
        if (BOLT_SET.has(nd.fn)) { found = 'bolt'; break; }
        if (RAIN_SET.has(nd.fn)) { found = 'rain'; break; }
        if (RASTER_SET.has(nd.fn)) { found = 'raster'; break; }
        if (PRESENT_SET.has(nd.fn)) { found = 'present'; break; }
        if (TRAIL_SET.has(nd.fn)) { found = 'trail'; break; }
        if (HUD_SET.has(nd.fn)) { found = 'hud'; break; }
        if (LIQ_SET.has(nd.fn)) { found = 'liquid'; break; }
        if (LIGHT_SET.has(nd.fn)) { found = 'light'; break; }
        if (ATLAS_SET.has(nd.fn)) { found = 'atlas'; break; }
        // 音频域 rAF 根回调（step 等):须父节点=伪根——游戏主循环子树内同名 step(Liquid.step)
        // 的父链是游戏帧,不打此门会把游戏样本误标 audio（094306 判例:280ms 巨帧宿主漏标）
        if (AUDIO_SET.has(nd.fn) && RAF_ROOT_PARENT.has(s.nodes.get(nd.p)?.fn ?? undefined)) { found = 'audio'; break; }
        if (nd.fn === '(program)' || nd.fn === '(root)' || nd.fn === '(idle)' || nd.fn === '(garbage collector)') { found = nd.fn; break; }
        cur = nd.p;
      }
      tagCache.set(id, found);
      return found;
    };
    // inclusive（战役口径：跨节点求和）
    const inclByFn = new Map();
    for (const [id, nd] of s.nodes) {
      if (nd.fn && !nd.fn.startsWith('(')) {
        const t = totalOf(id);
        if (t > 0) inclByFn.set(nd.fn, (inclByFn.get(nd.fn) || 0) + t);
      }
    }
    // 逐样本扫描（ts 升序）：tag/api/逐帧/winSelf
    const N = s.tsVec.n;
    const tv = s.tsVec.a, iv = s.idVec.a;
    let ptr = 0;
    for (let j = 0; j < N; j++) {
      const t = tv[j];
      const dt = j + 1 < N ? Math.max(0, tv[j + 1] - tv[j]) : 0;
      const id = iv[j];
      const nd = s.nodes.get(id);
      if (!nd) continue;
      const tag = tagOf(id);
      const ti = TAG_IDX.get(tag);
      if (ti !== undefined) tagAgg[ti] += dt;
      while (ptr + 1 < nA && anchors[ptr + 1] <= t) ptr++;
      const f = fw[ptr];
      const inFrame = f && t >= anchors[ptr] && t - anchors[ptr] < 100000;
      if (inFrame) {
        f.tags[ti] += dt;
        if (nd.fn === 'drawImage') f.drawImageUs += dt;
        else if (texUploadFns.has(nd.fn)) f.texUploadUs += dt;
      }
      if (BOLT_SET.has(nd.fn) || RAIN_SET.has(nd.fn) || RASTER_SET.has(nd.fn) || TRAIL_SET.has(nd.fn) || nd.fn === 'texRefresh') {
        winSelf.set(nd.fn, (winSelf.get(nd.fn) || 0) + dt);
      }
      if (apiWatch.has(nd.fn)) {
        apiSelf.set(nd.fn, (apiSelf.get(nd.fn) || 0) + dt);
        apiSamples.set(nd.fn, (apiSamples.get(nd.fn) || 0) + 1);
        const pnd = nd.p !== undefined ? s.nodes.get(nd.p) : null;
        if (pnd && pnd.fn && pnd.fn !== nd.fn) {
          let m = apiCallers.get(nd.fn);
          if (!m) { m = new Map(); apiCallers.set(nd.fn, m); }
          m.set(pnd.fn, (m.get(pnd.fn) || 0) + dt);
        }
        let cur = nd.p, guard = 0, appKey = null;
        while (cur !== undefined && guard++ < 300) {
          const anc = s.nodes.get(cur);
          if (!anc) break;
          if (anc.url && anc.fn !== nd.fn) { appKey = `${anc.fn}@${anc.url.split('/').pop()}:${anc.line}`; break; }
          cur = anc.p;
        }
        if (appKey) {
          let m = apiAppCallers.get(nd.fn);
          if (!m) { m = new Map(); apiAppCallers.set(nd.fn, m); }
          m.set(appKey, (m.get(appKey) || 0) + dt);
        }
      }
    }
    // 逐线程 top-self
    const byFn = new Map(), fnMeta = new Map();
    for (const [id, us] of s.selfUs) {
      const nd = s.nodes.get(id);
      if (!nd) continue;
      const k = nd.fn + '|' + (nd.url || '').split('/').pop();
      byFn.set(k, (byFn.get(k) || 0) + us);
      if (!fnMeta.has(k)) fnMeta.set(k, { fn: nd.fn, url: (nd.url || '').split('/').pop(), line: nd.line });
    }
    const topN = opts.top ?? 20;
    const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, s === mainSessions[0] ? Math.max(topN, 40) : topN)
      .map(([k, us]) => {
        const m = fnMeta.get(k);
        return { fn: m.fn, url: m.url, line: m.line, selfMs: round(us / 1000, 1), shareOfSampledPct: wallMain ? round((us / wallMain) * 100, 2) : 0 };
      });
    topSelfByThread.push({
      pid: s.pid, tid: s.tid, name: (acc.threads.get(s.tidKey)?.name) || '?',
      samples: s.samples, sampledWallMs: round(s.wallUs / 1000, 1),
      gameRootInclMs: gameRoot >= 0 ? round(totalOf(gameRoot) / 1000, 1) : 0,
      top,
    });
    // incl 观察名单（首个 main session 汇出）
    if (s === mainSessions[0]) {
      for (const fn of inclWatch) {
        const us = inclByFn.get(fn) || 0;
        if (us > 5000) inclRowsOut.push({ fn, inclMs: round(us / 1000, 1), shareOfSampledPct: wallMain ? round((us / wallMain) * 100, 2) : 0 });
      }
    }
    // probe 嫌疑核查表（每个点名的 fn 都出 row,含零行）
    for (const fn of probeWatch) {
      let selfUs = 0, nodesN = 0;
      for (const [id, nd] of s.nodes) {
        if (nd.fn === fn) { selfUs += s.selfUs.get(id) || 0; nodesN++; }
      }
      const inclUs = inclByFn.get(fn) || 0;
      probeRows.push({
        fn, selfMs: round(selfUs / 1000, 1), inclMs: round(inclUs / 1000, 1),
        shareOfSampledPct: wallMain ? round((selfUs / wallMain) * 100, 2) : 0,
        inclShareOfSampledPct: wallMain ? round((inclUs / wallMain) * 100, 2) : 0,
        nodes: nodesN,
        callers: [...(apiCallers.get(fn) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([k, us]) => ({ fn: k, selfMs: round(us / 1000, 1) })),
      });
    }
  }
  profOut.sampledWallMs = round(profOut.sampledWallMs / 1000, 1);
  profOut.perThread = [...topSelfByThread, ...workerRowsOut].sort((a, b) => b.samples - a.samples);

  // API 计数面行
  const apiRows = [...apiSelf.entries()].map(([fn, us]) => ({
    fn, selfMs: round(us / 1000, 1), shareOfSampledPct: wallMain ? round((us / wallMain) * 100, 2) : 0,
    samples: apiSamples.get(fn) || 0,
    callers: [...(apiCallers.get(fn) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => ({ fn: k, selfMs: round(v / 1000, 1) })),
    appCallers: [...(apiAppCallers.get(fn) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => ({ fn: k, selfMs: round(v / 1000, 1) })),
  })).sort((a, b) => b.selfMs - a.selfMs);

  // ── 时间线（2s 桶 fps + 标签和;伪影帧缺省不入桶,录制窗内出现空洞=诚实信号） ──
  const tlMap = new Map();
  for (let i = 0; i < nA; i++) {
    if (!includeRecorder && artifact[i]) continue;
    const f = fw[i];
    const b = Math.floor((anchors[i] - acc.tmin) / 2e6);
    let e = tlMap.get(b);
    if (!e) { e = { fps: 0, maxGapMs: 0, gameMs: 0, lightMs: 0, rainMs: 0, boltMs: 0, rasterMs: 0, presentMs: 0, audioMs: 0, texUploadMs: 0, drawImageMs: 0, lpr: 0, gcN: 0 }; tlMap.set(b, e); }
    e.fps++;
    e.maxGapMs = Math.max(e.maxGapMs, f.gap);
    e.gameMs += f.tags[TAG_IDX.get('game')]; e.lightMs += f.tags[TAG_IDX.get('light')];
    e.rainMs += f.tags[TAG_IDX.get('rain')]; e.boltMs += f.tags[TAG_IDX.get('bolt')];
    e.rasterMs += f.tags[TAG_IDX.get('raster')]; e.presentMs += f.tags[TAG_IDX.get('present')];
    e.audioMs += f.tags[TAG_IDX.get('audio')];
    e.texUploadMs += f.texUploadUs; e.drawImageMs += f.drawImageUs;
    e.lpr += f.lpr; e.gcN += f.gcN;
  }
  const timeline = [...tlMap.entries()].sort((a, b) => a[0] - b[0]).map(([b, e]) => ({
    t: +(b * 2).toFixed(1), fps: e.fps, maxGapMs: round(e.maxGapMs, 1),
    gameMs: round(e.gameMs / 1000, 1), lightMs: round(e.lightMs / 1000, 1), rainMs: round(e.rainMs / 1000, 1),
    boltMs: round(e.boltMs / 1000, 1), rasterMs: round(e.rasterMs / 1000, 1), presentMs: round(e.presentMs / 1000, 1),
    audioMs: round(e.audioMs / 1000, 1),
    texUploadMs: round(e.texUploadMs / 1000, 1), drawImageMs: round(e.drawImageMs / 1000, 1),
    lpr: e.lpr, gcN: e.gcN,
  }));

  // 最慢 10 帧（带标签分解;伪影帧缺省剔除,--include-recorder 时保留并带 recorderArtifact 标记）
  const slowest = fw.map((f, i) => ({ i, f }))
    .filter(({ i }) => includeRecorder || !artifact[i])
    .sort((a, b) => b.f.gap - a.f.gap).slice(0, 10)
    .map(({ i, f }) => ({
      tMs: round((anchors[i] - acc.tmin) / 1000, 1), gapMs: round(f.gap, 1),
      gameMs: round(f.tags[TAG_IDX.get('game')] / 1000, 1), lightMs: round(f.tags[TAG_IDX.get('light')] / 1000, 1),
      rainMs: round(f.tags[TAG_IDX.get('rain')] / 1000, 1), boltMs: round(f.tags[TAG_IDX.get('bolt')] / 1000, 1),
      rasterMs: round(f.tags[TAG_IDX.get('raster')] / 1000, 1), presentMs: round(f.tags[TAG_IDX.get('present')] / 1000, 1),
      audioMs: round(f.tags[TAG_IDX.get('audio')] / 1000, 1),
      texUploadMs: round(f.texUploadUs / 1000, 1), drawImageMs: round(f.drawImageUs / 1000, 1),
      lpr: f.lpr, gcMs: round(f.gcMs / 1000, 1), gcN: f.gcN,
      recorderArtifact: !!artifact[i] || undefined,
    }));

  // ── GC 汇总 ──
  const gcByThread = new Map();
  for (let i = 0; i < acc.gcEvents.length; i += 4) {
    const tid = acc.gcEvents[i + 3];
    let row = gcByThread.get(tid);
    if (!row) {
      let nm = '?';
      for (const t of acc.threads.values()) if (t.tid === tid) { nm = t.name; break; }
      row = { tid, name: nm, minor: { n: 0, ms: 0 }, major: { n: 0, ms: 0 }, incr: { n: 0, ms: 0 } };
      gcByThread.set(tid, row);
    }
    const kind = acc.gcEvents[i + 2], dur = acc.gcEvents[i + 1];
    if (kind === 0) { row.minor.n++; row.minor.ms += dur; }
    else if (kind === 1) { row.major.n++; row.major.ms += dur; }
    else { row.incr.n++; row.incr.ms += dur; }
  }
  const spanS = spanUs / 1e6;
  const gcRows = [...gcByThread.values()].map((r) => ({
    tid: r.tid, name: r.name,
    minor: { n: r.minor.n, ms: round(r.minor.ms / 1000, 0), perSec: spanS ? round(r.minor.n / spanS, 2) : 0 },
    major: { n: r.major.n, ms: round(r.major.ms / 1000, 0), perSec: spanS ? round(r.major.n / spanS, 2) : 0 },
    incr: { n: r.incr.n, ms: round(r.incr.ms / 1000, 0) },
    isMain: mainTh ? r.tid === mainTh.tid : false,
  })).sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0) || b.minor.n - a.minor.n);

  // 堆序列：斜率（对 after 线性回归）+ 锯齿（MajorGC before-after 中位）+ 下采样序列
  const heap = { points: acc.heap.length };
  {
    const hp = acc.heap;
    if (hp.length >= 2) {
      const t0h = hp[0].ts;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const p of hp) {
        const x = (p.ts - t0h) / 1e6, y = p.after;
        sx += x; sy += y; sxx += x * x; sxy += x * y;
      }
      const n = hp.length;
      const denom = n * sxx - sx * sx;
      heap.slopeBytesPerS = denom ? Math.round((n * sxy - sx * sy) / denom) : 0;
      heap.startBytes = hp[0].after; heap.endBytes = hp[hp.length - 1].after;
      const drops = hp.filter((p) => p.before > p.after).map((p) => p.before - p.after).sort((a, b) => a - b);
      heap.majorDropMedianBytes = drops.length ? drops[Math.floor(drops.length / 2)] : 0;
      heap.minAfterBytes = Math.min(...hp.map((p) => p.after));
      heap.maxAfterBytes = Math.max(...hp.map((p) => p.after));
      const step = Math.max(1, Math.ceil(hp.length / 240));
      heap.series = [];
      for (let i = 0; i < hp.length; i += step) heap.series.push({ tS: round((hp[i].ts - acc.tmin) / 1e6, 2), afterMB: round(hp[i].after / 1048576, 1) });
    }
  }

  // ── canvas 面板 ──
  const canvas = {
    lazyPixelRef: {
      total: acc.lprTs.length,
      perRenderFrame: nA ? round(acc.lprTs.length / nA, 1) : 0,
      maxPerFrame: fw.reduce((m, f) => Math.max(m, f.lpr), 0),
    },
    commit: durStats(acc.commitDur),
    paintOps: [...acc.paintOps.entries()].map(([name, arr]) => ({ name, ...durStats(arr) })).sort((a, b) => b.n - a.n),
  };

  // ── DrawFrame 节拍（合成器辅助帧距） ──
  let drawFrame = null;
  {
    let bestTid = null, bestArr = null;
    for (const [k, arr] of acc.drawFrameTs) if (!bestArr || arr.length > bestArr.length) { bestArr = arr; bestTid = k; }
    if (bestArr && bestArr.length > 2) {
      const ds = [];
      for (let i = 1; i < bestArr.length; i++) ds.push((bestArr[i] - bestArr[i - 1]) / 1000);
      const s = r2(ds);
      drawFrame = {
        tid: Number(bestTid.split(':')[1]), tidKey: bestTid,
        name: acc.threads.get(bestTid)?.name || '?', n: bestArr.length,
        gapP50Ms: round(pctOf(s, 0.5), 2), gapP90Ms: round(pctOf(s, 0.9), 2), gapMaxMs: round(s[s.length - 1], 2),
      };
    }
  }

  // ── frames 面板 ──
  // fps/帧距统计口径:缺省剔除 recorderArtifact 帧;分母同步扣伪影窗并集(有效 span),
  // 剔除不掉有效帧时与旧版逐位一致。--include-recorder = 全帧口径(仅标记不剔除)。
  const countedAnchors = includeRecorder ? nA : nA - nArt;
  const effSpanS = includeRecorder || !nArt ? spanS : round(Math.max(spanS - artifactUnionUs / 1e6, 0), 2);
  const fpsDenom = includeRecorder || !nArt ? spanS : effSpanS;
  // ── ★掉帧窗归因（2026-10-27,用户令「找到掉帧真凶」固化）──
  // 渲染帧=主线程 rAF dur≥800µs(FrameBeat skip 回调<0.8ms 剔除),去重>1ms(双发对)。
  // 掉帧窗=渲染距>12.5ms(错过 1+ 槽)且非录制伪影窗。四分类:
  //  · tick-hole:主忙<35%∧GPU忙<35%——主线程 idle 等不到 beginFrame=浏览器/OS 帧
  //    调度洞(ProMotion 自适应/DisplayLink 抖动族;页面层不可控,缓解=锁低档/钉刷新率)
  //  · slow-frame:前帧 rAF 体≥窗 60%——游戏帧本体爆长(可修,挖函数)
  //  · gpu-stall:GPU忙≥50%∧主闲——GPU 背压压 beginFrame
  //  · mixed:其余(主忙但非单帧主导——任务/提交/GC 混合)
  const dropWindows = (() => {
    const mainTid2 = mainTh ? mainTh.tid : -1;
    const rl = [];
    for (let i = 0; i < acc.fires.length; i += 3) {
      if (acc.fires[i + 2] === mainTid2 && acc.fires[i + 1] >= 800) rl.push([acc.fires[i], acc.fires[i + 1]]);
    }
    rl.sort((a, b) => a[0] - b[0]);
    const rd = [];
    for (const [ts, dur] of rl) if (!rd.length || ts - rd[rd.length - 1][0] > 1000) rd.push([ts, dur]);
    // 渲染帧距直方图 + 错拍率
    const gapHist = { '4.2': 0, '8.3': 0, '12.5': 0, '16.7': 0, '20.8-25': 0, '>25': 0 };
    let missN = 0;
    const gaps = [];
    for (let i = 1; i < rd.length; i++) {
      const g = rd[i][0] - rd[i - 1][0];
      gaps.push(g);
      if (g > 10500) missN++;
      const k = g <= 5500 ? '4.2' : g <= 10500 ? '8.3' : g <= 14800 ? '12.5' : g <= 19000 ? '16.7' : g <= 27000 ? '20.8-25' : '>25';
      gapHist[k]++;
    }
    // 重叠求和助手:[ts,dur]×n 与窗 [t0,t1) 的覆盖
    const overlap = (arr, t0, t1) => {
      let sum = 0;
      for (let i = 0; i < arr.length; i += 2) {
        const a = arr[i], b = arr[i] + arr[i + 1];
        if (b <= t0 || a >= t1) continue;
        sum += Math.min(b, t1) - Math.max(a, t0);
      }
      return sum;
    };
    const windows = [];
    const verdictAgg = {};
    for (let i = 1; i < rd.length; i++) {
      const gap = rd[i][0] - rd[i - 1][0];
      if (gap <= 12500) continue;
      const t0 = rd[i - 1][0], t1 = rd[i][0];
      // 录制伪影窗跳过(StartProfiling 期)
      if (recWindows.some((w) => Math.max(t0, w.ts) < Math.min(t1, w.end))) continue;
      const prevDur = rd[i - 1][1];
      const mainBusy = overlap(acc.runTaskMainTs, t0, t1);
      const gpuBusy = overlap(acc.gpuMainTs, t0, t1);
      let verdict;
      if (prevDur >= gap * 0.6) verdict = 'slow-frame';
      else if (mainBusy < gap * 0.35 && gpuBusy < gap * 0.35) verdict = 'tick-hole';
      else if (gpuBusy >= gap * 0.5 && mainBusy < gap * 0.35) verdict = 'gpu-stall';
      else verdict = 'mixed';
      windows.push({ gapMs: round(gap / 1000, 1), atS: round((t0 - (anchors[0] ?? t0)) / 1e6, 1),
        verdict, mainBusyMs: round(mainBusy / 1000, 1), gpuBusyMs: round(gpuBusy / 1000, 1), prevFrameMs: round(prevDur / 1000, 1) });
      verdictAgg[verdict] = verdictAgg[verdict] ?? { n: 0, totalMs: 0 };
      verdictAgg[verdict].n++;
      verdictAgg[verdict].totalMs = round(verdictAgg[verdict].totalMs + gap / 1000, 1);
    }
    // rAF 洞(相邻回调任意距>12ms,双发对合并)=浏览器不发 beginFrame 的直接读数
    let maxRafHoleMs = 0, rafHoles12 = 0;
    const mainFires = [];
    for (let i = 0; i < acc.fires.length; i += 3) {
      if (acc.fires[i + 2] === mainTid2) mainFires.push(acc.fires[i]);
    }
    mainFires.sort((a, b) => a - b);
    let last = -1e18;
    for (const ts of mainFires) {
      if (ts - last > 1000) {
        if (last > -1e17) {
          const h = (ts - last) / 1000;
          if (h > maxRafHoleMs) maxRafHoleMs = h;
          if (h > 12) rafHoles12++;
        }
        last = ts;
      }
    }
    return {
      renders: rd.length,
      missPct: gaps.length ? round((missN / gaps.length) * 100, 2) : null,
      gapHist,
      windows,
      byVerdict: verdictAgg,
      maxRafHoleMs: round(maxRafHoleMs, 1),
      rafHoles12,
    };
  })();

  const frames = {
    method: `FireAnimationFrame@CrRendererMain dur>=${minAnchor}us dedup>1500us`,
    anchors: nA,
    countedFrames: countedAnchors,
    recorderArtifactFrames: nArt,
    effSpanS,
    fps: fpsDenom ? round(countedAnchors / fpsDenom, 1) : 0,
    gap: {
      p50: round(pctOf(gsorted, 0.5), 2), p75: round(pctOf(gsorted, 0.75), 2), p90: round(pctOf(gsorted, 0.9), 2),
      p95: round(pctOf(gsorted, 0.95), 2), p99: round(pctOf(gsorted, 0.99), 2), p999: round(pctOf(gsorted, 0.999), 2),
      max: round(gsorted.length ? gsorted[gsorted.length - 1] : 0, 2),
    },
    count16ms: gaps.filter((g) => g > 16).length,
    count33ms: gaps.filter((g) => g > 33).length,
    count50ms: gaps.filter((g) => g > 50).length,
    count100ms: gaps.filter((g) => g > 100).length,
    droppedFrames: acc.dropped,
    loop: { n: loopFrames.length, render: renderLoop, skip: loopFrames.length - renderLoop },
    drawFrame,
    timeline,
    slowest,
  };

  // ── postMessage ──
  const postMessage = {
    events: [...acc.postMsgByThread.values()].reduce((a, b) => a + b, 0),
    byThread: Object.fromEntries([...acc.postMsgByThread.entries()].map(([k, v]) => [k, v])),
    note: acc.postMsgByThread.size === 0 ? '本 trace 未记录 postMessage 事件（trace 类别未含,非工具缺陷）' : null,
  };

  // ── 签名检测 ──
  const T = {};
  for (const [k, v] of Object.entries(SIGNATURE_DEFAULTS)) T[k] = { ...v };
  if (opts.tune) for (const [k, v] of Object.entries(opts.tune)) if (T[k]) T[k] = { ...T[k], v: +v };

  const paintMean = canvas.paintOps.length ? Math.max(...canvas.paintOps.map((p) => p.meanUs)) : 0;
  const framesWithUpload = fw.filter((f) => f.texUploadUs > 1000).length;
  const texUploadPerFrameMs = nA ? round(fw.reduce((a, f) => a + f.texUploadUs, 0) / nA / 1000, 2) : 0;
  const texUploadP99Us = (() => { const a = r2(fw.map((f) => f.texUploadUs)); return a.length ? Math.round(pctOf(a, 0.99)) : 0; })();
  const framesWithUploadOver2ms = fw.filter((f) => f.texUploadUs > 2000).length;
  const degradeShare = (() => {
    let us = 0;
    for (const row of apiRows) if (DEGRADE_FNS.includes(row.fn)) us += row.selfMs * 1000;
    return wallMain ? round((us / wallMain) * 100, 2) : 0;
  })();
  const signatures = [];
  const push = (id, hit, severity, value, threshold, explain) => signatures.push({ id, hit, severity, value, threshold, explain });

  // 1. SHM 慢路径（★判别信号只有 LPR/渲染帧;paintOp 均耗仅随行展示——Chrome 自己的
  //    Paint/PaintImage X 事件均耗 20-35µs 属正常管线成本,混入会把健康 trace 误报）
  {
    const v = canvas.lazyPixelRef.perRenderFrame;
    const hit = v > T.shmSlowLprFrame.v;
    push('SHM_SLOW_PATH', hit, v > 100 ? 'alarm' : 'warn',
      { lprPerFrame: v, paintOpMeanUs: round(paintMean, 1) },
      { lprPerFrame: T.shmSlowLprFrame.v, opMeanUs: T.shmSlowOpMeanUs.v },
      `SHM 慢路径：2D 画布经软件栅格+共享内存上传,每 draw op 主线程成本 >${T.shmSlowOpMeanUs.v}µs。` +
      `健康 GPU 路径 LPR≈1/渲染帧(214051 定谳);病灶 trace LPR≈260/渲染帧(183751 定谳)。` + T.shmSlowLprFrame.explain);
  }
  // 2. 上传风暴（雷帧占比小时 p90 会被稀释,用 p99 + 超阈帧数双信号）
  {
    const hit = framesWithUpload > T.uploadStormFrames.v;
    const warn = texUploadP99Us > T.uploadFrameWarnMs.v * 1000 || framesWithUploadOver2ms > 100;
    push('UPLOAD_STORM', hit || warn, hit ? 'alarm' : warn ? 'warn' : 'off',
      { framesWithUploadOver1ms: framesWithUpload, framesWithUploadOver2ms, texUploadPerFrameMs, p99Us: texUploadP99Us },
      { stormFrames: T.uploadStormFrames.v, warnMs: T.uploadFrameWarnMs.v },
      `tex 上传风暴：单帧 texImage2D/texSubImage2D/createTexture 自耗 >1ms 的帧数 >${T.uploadStormFrames.v},或帧距 p99 >${T.uploadFrameWarnMs.v}ms,或 >2ms 帧 >100。` +
      `人工口径"雷帧 2000-3500 次上传" ≈ 帧上传自耗 ~20ms(215016 定谳)。` + T.uploadStormFrames.explain);
  }
  // 3. contextlost 风暴
  push('CONTEXTLOST_STORM', acc.ctxLost > T.contextLostWarn.v,
    acc.ctxLost > T.contextLostStorm.v ? 'alarm' : acc.ctxLost > T.contextLostWarn.v ? 'warn' : 'off',
    acc.ctxLost, { warn: T.contextLostWarn.v, storm: T.contextLostStorm.v },
    `contextlost 类事件 ${acc.ctxLost} 次;>${T.contextLostStorm.v} = 上下文丢失风暴（GL 资源反复重建）。` + T.contextLostWarn.explain);
  // 4. worker 数异常（idleSuspect 只展示不定罪:空闲采样伪影是仪器口径问题,非游戏异常）
  {
    const dworkers = threads.filter((t) => /DedicatedWorker/i.test(t.name));
    const busy = workerRowsOut.filter((w) => w.busyPctOfSpan > T.workerBusyPct.v);
    const idleSuspect = workerRowsOut.filter((w) => w.idleSamplingSuspect);
    const hit = dworkers.length > T.workerCountMax.v || busy.length > 0;
    push('WORKER_ANOMALY', hit, dworkers.length > T.workerCountMax.v * 2 ? 'alarm' : 'warn',
      {
        dedicatedWorkers: dworkers.length,
        busyWorkers: busy.map((w) => `${w.name}(${w.busyPctOfSpan}%)`),
        idleSuspectWorkers: idleSuspect.map((w) => `${w.name}(${w.busyPctOfSpan}% named,(program)${w.programSelfPct}% 采样伪影)`),
      },
      { max: T.workerCountMax.v, busyPct: T.workerBusyPct.v },
      `DedicatedWorker ${dworkers.length} 个（阈值 ${T.workerCountMax.v}）。busyPctOfSpan 恒以 named 自耗为准——(program) 主导且 named<5% 的 worker 已标 idleSamplingSuspect（空闲采样伪影,勿读成饱和）。` + T.workerBusyPct.explain);
  }
  // 5. 静默降级桶
  push('SILENT_DEGRADE_BUCKET', degradeShare > T.degradeSelfSharePct.v, 'warn',
    { sharePct: degradeShare }, { sharePct: T.degradeSelfSharePct.v },
    `降级桶函数(${DEGRADE_FNS.join('/')})自耗占比 ${degradeShare}% > ${T.degradeSelfSharePct.v}% = acc/桥接静默降级在发生（用户侧无错误但帧内已换降级路径）。` + T.degradeSelfSharePct.explain);
  // 6. GC 压力
  {
    const mainGc = gcRows.find((r) => r.isMain);
    const perSec = mainGc ? mainGc.minor.perSec : 0;
    push('GC_PRESSURE', perSec > T.gcMinorPerSecWarn.v, perSec > T.gcMinorPerSecAlarm.v ? 'alarm' : 'warn',
      perSec, { warn: T.gcMinorPerSecWarn.v, alarm: T.gcMinorPerSecAlarm.v },
      `主线程 minor GC ${perSec}/s（基线 010330 = 5.93/s）。` + T.gcMinorPerSecWarn.explain);
  }
  // 7. 帧卡顿
  {
    const p99 = frames.gap.p99;
    push('FRAME_STALL', p99 > T.stallP99WarnMs.v, p99 > T.stallP99AlarmMs.v ? 'alarm' : 'warn',
      { p99Ms: p99, count50ms: frames.count50ms }, { p99WarnMs: T.stallP99WarnMs.v, p99AlarmMs: T.stallP99AlarmMs.v },
      `帧距 p99 ${p99}ms（>33ms 帧数 ${frames.count33ms},>50ms 帧数 ${frames.count50ms}）。` + T.stallP99WarnMs.explain);
  }
  // 8. 主线程饱和（RunTask 顶层口径;X 裸和嵌套重复,不可用）
  {
    const busy = spanUs ? round((acc.runTaskMain.dur / spanUs) * 100, 1) : 0;
    push('MAIN_SATURATED', busy > T.mainBusyPct.v, 'warn', busy, T.mainBusyPct.v,
      `主线程 RunTask busy 占比 ${busy}% > ${T.mainBusyPct.v}%（饱和;鲜有 idle;游戏 rAF 满载属常态,阈值 97 只报极端）。` + T.mainBusyPct.explain);
  }
  // 9. 录制器伪影（帧与 StartProfiling 窗/预热窗重叠——仪器启动成本,非游戏卡顿;
  //    命中帧已自动从帧距/fps/慢帧统计剔除,--include-recorder 可关闭剔除仅留标记）
  push('RECORDING_ARTIFACT', nArt > 0, 'warn',
    { recorderSessions: recSessions.length, artifactFrames: nArt, excludedFromStats: !includeRecorder, artifactUnionMs: round(artifactUnionUs / 1000, 1) },
    { warmupMs: T.recorderWarmupMs.v },
    `录制器干扰：CPU 采样启动（CpuProfiler::StartProfiling,${recSessions.length} 个 isolate 会话）及其 ${T.recorderWarmupMs.v}ms 采样收敛预热窗与 ${nArt} 个渲染帧重叠——这些帧承载的是仪器启动成本（堆遍历 safepoint,首启实测 250-820ms）,不是游戏卡顿` +
    (includeRecorder ? '。--include-recorder 生效:未剔除,仅带 recorderArtifact 标记。' : '，已自动从帧距/fps/慢帧统计剔除。') + T.recorderWarmupMs.explain);

  // ── recorder 段（录制器会话窗/时长/重叠帧清单——登记债落刀:腐化案 280ms 巨帧=StartProfiling 启动成本） ──
  const recorder = {
    detected: recSessions.length > 0,
    warmupMs: round(warmupUs / 1000, 0),
    excludedFromStats: !includeRecorder,
    artifactFrames: nArt,
    artifactUnionMs: round(artifactUnionUs / 1000, 1),
    sessions: recSessions.map((s, idx) => {
      const th = acc.threads.get(s.tidKey);
      const w = recWindows[idx];
      const list = [];
      for (let i = 0; i < nA; i++) if (frameArtifactHit(i, w)) {
        list.push({ tMs: round((anchors[i] - acc.tmin) / 1000, 1), gapMs: round(i ? (anchors[i] - anchors[i - 1]) / 1000 : 0, 1) });
      }
      return {
        pid: th ? th.pid : null, tid: th ? th.tid : null, tidKey: s.tidKey, name: th ? th.name : '?',
        startRelMs: round((s.ts - acc.tmin) / 1000, 1),
        durMs: round(s.dur / 1000, 2),
        isFirst: w.isFirst,
        windowRelMs: [round((w.ts - acc.tmin) / 1000, 1), round((w.end - acc.tmin) / 1000, 1)],
        overlapFrames: list.length,
        overlapFrameList: list,
      };
    }),
  };

  // ── digest 组装 ──
  return {
    schema: SCHEMA_NAME,
    schemaVersion: SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    source: {
      path: path.resolve(tracePath),
      bytes: meta.size,
      events: acc.events,
      parseBad: acc.bad,
      parseMode: meta.size < 16 * 1024 * 1024 && !opts.forceStream ? 'whole-read' : 'stream',
      scanMs: meta.scanMs,
    },
    time: { spanS: round(spanS, 2), t0Us: isFinite(acc.tmin) ? acc.tmin : 0 },
    main: mainKey
      ? { pid: mainTh.pid, tid: mainTh.tid, name: mainTh.name, note: null }
      : { pid: null, tid: null, name: null, note: '未探测到 CrRendererMain（非 renderer trace 或格式漂移）' },
    recorder,
    threads,
    frames,
    profile: {
      ...profOut,
      mainSampledWallMs: round(wallMain / 1000, 1),
      mainSamples: samplesMain,
      tagSelfMs: Object.fromEntries(TAGS.map((t) => [t, round(tagAgg[TAG_IDX.get(t)] / 1000, 1)]).filter(([, v]) => v > 0)),
      inclusive: inclRowsOut,
      api: apiRows,
      probe: probeRows.length ? probeRows : undefined,
      winSelfMs: Object.fromEntries([...winSelf.entries()].map(([k, v]) => [k, round(v / 1000, 1)]).sort((a, b) => b[1] - a[1])),
    },
    gc: {
      byThread: gcRows,
      heap: heap.points ? heap : { points: 0, note: '本 trace 无 usedHeapSize 采样点' },
    },
    canvas,
    dropWindows,
    workers: workerRowsOut,
    postMessage,
    contextLostEvents: acc.ctxLost,
    signatures,
  };
}

// ─────────────────────────── diff 模式 ───────────────────────────

export function diffDigests(a, b, labelA = 'A', labelB = 'B') {
  const rows = [];
  const add = (group, field, va, vb, unit = '', lowerIsBetter = true) => {
    const d = (vb ?? 0) - (va ?? 0);
    rows.push({ group, field, a: va, b: vb, delta: round(d, 2), pct: va ? round((d / Math.abs(va)) * 100, 1) : null, unit, lowerIsBetter });
  };
  add('meta', 'spanS', a.time.spanS, b.time.spanS, 's');
  add('frames', 'fps', a.frames.fps, b.frames.fps, 'fps', false);
  add('frames', 'gap.p50', a.frames.gap.p50, b.frames.gap.p50, 'ms');
  add('frames', 'gap.p90', a.frames.gap.p90, b.frames.gap.p90, 'ms');
  add('frames', 'gap.p99', a.frames.gap.p99, b.frames.gap.p99, 'ms');
  add('frames', 'gap.max', a.frames.gap.max, b.frames.gap.max, 'ms');
  add('frames', 'count33ms', a.frames.count33ms, b.frames.count33ms, '帧');
  add('frames', 'droppedFrames', a.frames.droppedFrames, b.frames.droppedFrames, '');
  if (a.dropWindows && b.dropWindows) {
    add('drop', 'renderMissPct', a.dropWindows.missPct, b.dropWindows.missPct, '%');
    add('drop', 'rafHoles12', a.dropWindows.rafHoles12, b.dropWindows.rafHoles12, '个');
    for (const k of ['tick-hole', 'slow-frame', 'gpu-stall', 'mixed']) {
      add('drop', `win.${k}.n`, a.dropWindows.byVerdict[k]?.n ?? 0, b.dropWindows.byVerdict[k]?.n ?? 0, '窗');
    }
  }
  const gcm = (d) => d.gc.byThread.find((r) => r.isMain) || {};
  add('gc', 'mainMinor.perSec', gcm(a).minor?.perSec ?? 0, gcm(b).minor?.perSec ?? 0, '/s');
  add('gc', 'mainMajor.n', gcm(a).major?.n ?? 0, gcm(b).major?.n ?? 0, '次');
  add('canvas', 'lpr.perRenderFrame', a.canvas.lazyPixelRef.perRenderFrame, b.canvas.lazyPixelRef.perRenderFrame, 'op/帧');
  add('canvas', 'commit.meanUs', a.canvas.commit.meanUs, b.canvas.commit.meanUs, 'µs');
  const af = (d, fn) => d.profile.api.find((r) => r.fn === fn)?.selfMs ?? 0;
  for (const fn of ['drawImage', 'texImage2D', 'texSubImage2D']) add('api', fn + '.selfMs', af(a, fn), af(b, fn), 'ms');
  const topUnion = [...new Map([...(a.profile.perThread[0]?.top || []), ...(b.profile.perThread[0]?.top || [])].map((t) => [t.fn, t])).keys()].slice(0, 15);
  for (const fn of topUnion) {
    const va = (a.profile.perThread[0]?.top || []).find((t) => t.fn === fn)?.selfMs ?? 0;
    const vb = (b.profile.perThread[0]?.top || []).find((t) => t.fn === fn)?.selfMs ?? 0;
    rows.push({ group: 'topSelf', field: fn, a: va, b: vb, delta: round(vb - va, 1), pct: va ? round(((vb - va) / Math.abs(va)) * 100, 1) : null, unit: 'ms', lowerIsBetter: true });
  }
  const sigA = new Set(a.signatures.filter((s) => s.hit).map((s) => s.id));
  const sigB = new Set(b.signatures.filter((s) => s.hit).map((s) => s.id));
  const signatureFlips = {
    onlyInA: [...sigA].filter((s) => !sigB.has(s)),
    onlyInB: [...sigB].filter((s) => !sigA.has(s)),
  };
  return { schema: 'trace-x-ray.diff', schemaVersion: SCHEMA_VERSION, labels: [labelA, labelB], rows, signatureFlips };
}

function renderDiffMd(diff) {
  const [la, lb] = diff.labels;
  const L = [];
  L.push(`# trace-x-ray diff: ${la} → ${lb}`);
  L.push('');
  L.push(`| 域 | 指标 | ${la} | ${lb} | Δ | Δ% |`);
  L.push('|---|---|---:|---:|---:|---:|');
  for (const r of diff.rows) {
    L.push(`| ${r.group} | ${r.field} | ${r.a} | ${r.b} | ${r.delta > 0 && r.lowerIsBetter ? '+' : ''}${r.delta}${r.unit} | ${r.pct === null ? '-' : r.pct + '%'} |`);
  }
  L.push('');
  if (diff.signatureFlips.onlyInA.length) L.push(`签名仅在 ${la} 命中: ${diff.signatureFlips.onlyInA.join(', ')}`);
  if (diff.signatureFlips.onlyInB.length) L.push(`签名仅在 ${lb} 命中: ${diff.signatureFlips.onlyInB.join(', ')}`);
  return L.join('\n');
}

// ─────────────────────────── MD 摘要 ───────────────────────────

export function renderMd(d) {
  const L = [];
  const sig = d.signatures.filter((s) => s.hit);
  L.push(`# ${path.basename(d.source.path)} — trace-x-ray v${d.tool.version}`);
  L.push('');
  L.push(`span=${d.time.spanS}s events=${d.source.events.toLocaleString()}(${d.source.parseMode}, ${d.source.scanMs}ms) 主线程=${d.main.pid}:${d.main.tid}${d.main.note ? `（${d.main.note}）` : ''}`);
  L.push('');
  L.push(`## 帧锚（${d.frames.method}）`);
  L.push(`anchors=${d.frames.anchors}${d.frames.recorderArtifactFrames ? `（伪影剔除后计帧=${d.frames.countedFrames},有效span=${d.frames.effSpanS}s）` : ''} fps=${d.frames.fps} | gap p50/p90/p99/max = ${d.frames.gap.p50}/${d.frames.gap.p90}/${d.frames.gap.p99}/${d.frames.gap.max}ms | >16ms=${d.frames.count16ms} >33ms=${d.frames.count33ms} >50ms=${d.frames.count50ms} >100ms=${d.frames.count100ms} dropped=${d.frames.droppedFrames}`);
  if (d.frames.recorderArtifactFrames) L.push(`★录制伪影帧 ${d.frames.recorderArtifactFrames} 个已${d.recorder?.excludedFromStats === false ? '标记（--include-recorder,未剔除）' : '剔除出统计'}（StartProfiling 启动成本,非游戏卡顿）`);
  L.push(`loop 帧: render=${d.frames.loop.render} skip=${d.frames.loop.skip}`);
  if (d.frames.drawFrame) L.push(`DrawFrame@${d.frames.drawFrame.name}: n=${d.frames.drawFrame.n} gapP50=${d.frames.drawFrame.gapP50Ms}ms P90=${d.frames.drawFrame.gapP90Ms}ms`);
  if (d.dropWindows && d.dropWindows.renders) {
    const dw = d.dropWindows;
    L.push('');
    L.push(`## 掉帧窗归因（渲染帧=rAF dur≥0.8ms n=${dw.renders}${dw.missPct != null ? `,错拍率=${dw.missPct}%` : ''};渲染帧距 ${Object.entries(dw.gapHist).filter(([, v]) => v).map(([k, v]) => `${k}ms×${v}`).join(' ')}）`);
    L.push(`rAF 洞(>12ms)=${dw.rafHoles12} 个,最大=${dw.maxRafHoleMs}ms —— 四分类: ${Object.entries(dw.byVerdict).map(([k, v]) => `${k}=${v.n}窗/${v.totalMs}ms`).join(' ') || '零掉帧窗'}`);
    L.push(`  · tick-hole=主闲+GPU闲(浏览器/OS 不发 beginFrame——ProMotion/DisplayLink 族,页面层不可控,缓解=锁低档或钉刷新率)`);
    if (dw.windows.length) {
      L.push('  最差 6 窗:');
      for (const w of [...dw.windows].sort((a, b) => b.gapMs - a.gapMs).slice(0, 6)) {
        L.push(`    gap=${w.gapMs}ms @+${w.atS}s [${w.verdict}] 主忙=${w.mainBusyMs}ms GPU忙=${w.gpuBusyMs}ms 前帧体=${w.prevFrameMs}ms`);
      }
    }
  }
  if (d.frames.slowest.length) {
    L.push('');
    L.push('最慢帧 top10（t=相对毫秒）:');
    for (const s of d.frames.slowest) L.push(`  t=${s.tMs}s gap=${s.gapMs}ms game=${s.gameMs} light=${s.lightMs} rain=${s.rainMs} bolt=${s.boltMs} raster=${s.rasterMs} audio=${s.audioMs} tex上传=${s.texUploadMs} drawImage=${s.drawImageMs} lpr=${s.lpr} gc=${s.gcMs}ms/${s.gcN}${s.recorderArtifact ? ' [录制伪影]' : ''}`);
  }
  if (d.recorder && d.recorder.detected) {
    L.push('');
    L.push(`## 录制器（${d.recorder.sessions.length} 个 StartProfiling 会话,伪影帧=${d.recorder.artifactFrames},伪影窗并集=${d.recorder.artifactUnionMs}ms）`);
    for (const s of d.recorder.sessions) {
      L.push(`  ${s.name}(${s.tidKey}) t=+${s.startRelMs}ms dur=${s.durMs}ms 伪影窗=+${s.windowRelMs[0]}..${s.windowRelMs[1]}ms 重叠帧=${s.overlapFrames}${s.isFirst ? '（含预热窗）' : ''}`);
    }
  }
  L.push('');
  L.push('## 标签自耗（ms）: ' + JSON.stringify(d.profile.tagSelfMs));
  L.push('');
  L.push(`## CPU profile（sessions=${d.profile.sessions} chunks=${d.profile.chunks} samples=${d.profile.samples.toLocaleString()} 主线程采样墙钟=${d.profile.mainSampledWallMs}ms）`);
  for (const t of d.profile.perThread.slice(0, 4)) {
    L.push('');
    L.push(`### ${t.name}(${t.pid}:${t.tid}) samples=${t.samples}${t.gameRootInclMs !== undefined ? ` gameRootIncl=${t.gameRootInclMs}ms` : ''}`);
    for (const f of (t.top || []).slice(0, 12)) L.push(`  ${String(f.selfMs).padStart(9)}ms ${(f.shareOfSampledPct ?? 0).toFixed(2).padStart(6)}%  ${f.fn}${f.url ? ` @${f.url}${f.line >= 0 ? ':' + f.line : ''}` : ''}`);
  }
  if (d.profile.inclusive.length) {
    L.push('');
    L.push('inclusive 观察名单（跨节点求和口径）: ' + d.profile.inclusive.map((r) => `${r.fn}=${r.inclMs}ms(${r.shareOfSampledPct}%)`).join('  '));
  }
  L.push('');
  L.push('## API 计数面（self / 采样墙钟 %）');
  for (const r of d.profile.api.slice(0, 15)) {
    L.push(`  ${r.fn}: ${r.selfMs}ms ${r.shareOfSampledPct}% n=${r.samples}` + (r.appCallers.length ? ` ← ${r.appCallers.slice(0, 2).map((c) => `${c.fn}(${c.selfMs}ms)`).join(', ')}` : ''));
  }
  L.push('');
  L.push('## GC');
  for (const r of d.gc.byThread.slice(0, 5)) L.push(`  ${r.isMain ? '[主]' : '   '}${r.name}(${r.tid}): minor=${r.minor.n}(${r.minor.ms}ms,${r.minor.perSec}/s) major=${r.major.n}(${r.major.ms}ms) incr=${r.incr.n}(${r.incr.ms}ms)`);
  if (d.gc.heap.slopeBytesPerS !== undefined) L.push(`  堆: 斜率=${(d.gc.heap.slopeBytesPerS / 1048576).toFixed(2)}MB/s 区间=${(d.gc.heap.minAfterBytes / 1048576).toFixed(1)}-${(d.gc.heap.maxAfterBytes / 1048576).toFixed(1)}MB MajorGC中位释放=${(d.gc.heap.majorDropMedianBytes / 1048576).toFixed(1)}MB`);
  L.push('');
  L.push('## 画布');
  L.push(`  LPR: total=${d.canvas.lazyPixelRef.total} perRenderFrame=${d.canvas.lazyPixelRef.perRenderFrame} maxPerFrame=${d.canvas.lazyPixelRef.maxPerFrame}`);
  L.push(`  Commit(主线程): n=${d.canvas.commit.n} mean=${d.canvas.commit.meanUs}µs p90=${d.canvas.commit.p90Us}µs max=${d.canvas.commit.maxUs}µs`);
  for (const p of d.canvas.paintOps.slice(0, 5)) L.push(`  ${p.name}: n=${p.n} mean=${p.meanUs}µs p90=${p.p90Us}µs max=${p.maxUs}µs`);
  if (d.workers.length) {
    L.push('');
    L.push('## Worker');
    for (const w of d.workers.slice(0, 6)) {
      L.push(`  ${w.name}(${w.pid}:${w.tid}) samples=${w.samples} wall=${w.sampledWallMs}ms busy=${w.busyPctOfSpan}% named=${w.namedSelfPct}% (program)=${w.programSelfPct}%${w.idleSamplingSuspect ? ' [IDLE-SUSPECT:空闲采样伪影,勿读成饱和]' : ''} top=${w.top.slice(0, 3).map((t) => `${t.fn}:${t.selfMs}ms`).join(', ')}`);
    }
  }
  L.push('');
  L.push(`postMessage 事件: ${d.postMessage.events}${d.postMessage.note ? `（${d.postMessage.note}）` : ''} | contextlost: ${d.contextLostEvents}`);
  L.push('');
  L.push(`## 签名（${sig.length}/${d.signatures.length} 命中）`);
  for (const s of d.signatures) {
    L.push(`  [${s.hit ? (s.severity === 'alarm' ? '!!' : ' !') : '  '}] ${s.id}: ${JSON.stringify(s.value)}`);
    if (s.hit) L.push(`        ${s.explain}`);
  }
  if (d.profile.probe) {
    L.push('');
    L.push('## 嫌疑探针（--probe）');
    for (const p of d.profile.probe) L.push(`  ${p.fn}: self=${p.selfMs}ms(${p.shareOfSampledPct}%) incl=${p.inclMs}ms(${p.inclShareOfSampledPct}%) 节点=${p.nodes}` + (p.callers.length ? ` ← ${p.callers.slice(0, 3).map((c) => `${c.fn}(${c.selfMs})`).join(', ')}` : ''));
  }
  return L.join('\n');
}

// ─────────────────────────── schema 文档（--schema） ───────────────────────────

const SCHEMA_DOC = `digest schema（${SCHEMA_NAME} v${SCHEMA_VERSION}）— 后续取证刃的消费契约
================================================================
顶层键（稳定,只增不改名）:
  schema / schemaVersion   常量标识与版本;消费方必须校验 schemaVersion<=自己支持的版本
  tool                     {name,version}
  source                   {path,bytes,events,parseBad,parseMode:whole-read|stream,scanMs}
  time                     {spanS,t0Us}  — span=全部事件 ts 跨度
  main                     {pid,tid,name,note} — CrRendererMain 探测结果;note 非空=探测异常
  recorder                 录制器干扰项面(2026-09-29 批新增;无会话时 detected=false 全零):
    detected / warmupMs    是否有 StartProfiling 会话 / 采样收敛预热窗长度(ms,--tune recorderWarmupMs)
    excludedFromStats      伪影帧是否已剔除出帧统计(--include-recorder 时 false)
    artifactFrames         被标 recorderArtifact 的渲染帧数(与任一伪影窗重叠:gap 区间或锚执行窗)
    artifactUnionMs        伪影窗并集 ∩ trace span 的时长(ms;fps 有效分母扣减项)
    sessions[]             {pid,tid,tidKey,name,startRelMs,durMs,isFirst,windowRelMs:[起,止],
                            overlapFrames,overlapFrameList[]{tMs,gapMs}} — 每 isolate 一会话;
                            isFirst=首次 Profiling(带预热窗);windowRelMs 含预热窗
  threads[]                {pid,tid,name,process,role:main|worker|compositor|other,events,busyMs,busyPct}
                           ★busyPct 仅主线程有值(调度器顶层 RunTask 口径;X 裸和含嵌套会 >100%),
                             其他线程 null;worker 饱和度看 workers[].busyPctOfSpan(排除 idle 采样)
  frames                   帧锚面:
    method                 锚定义自述（可复现口径）
    anchors                锚总数(含伪影帧)
    countedFrames          计入统计的帧数(缺省=anchors-伪影帧;--include-recorder 时=anchors)
    recorderArtifactFrames 伪影帧数(StartProfiling 窗/预热窗重叠)
    effSpanS               有效 span(=spanS-伪影窗并集;无伪影时=spanS)
    fps                    平均 fps(分子=countedFrames,分母=无伪影?spanS:effSpanS)
    gap{p50,p75,p90,p95,p99,p999,max}  帧距分位(ms;缺省剔除伪影帧的 gap)
    count16ms/count33ms/count50ms/count100ms  超阈帧距计数(同上口径)
    droppedFrames          DroppedFrame 瞬时事件数
    loop{n,render,skip}    FunctionCall{loop} dur>=1500µs=render
    drawFrame              合成器 DrawFrame 辅助帧距 {tid,name,n,gapP50Ms,gapP90Ms,gapMaxMs}|null
    timeline[]             2s 桶 {t,fps,maxGapMs,gameMs,lightMs,rainMs,boltMs,rasterMs,presentMs,audioMs,texUploadMs,drawImageMs,lpr,gcN}
                           ★伪影帧缺省不入桶——录制窗内出现空洞=诚实信号
    slowest[]              最慢 10 帧逐标签分解(含 audioMs;--include-recorder 时伪影帧带
                           recorderArtifact:true 保留,缺省被剔除)
  profile                  CPU profile 重组面:
    sessions/chunks/samples/sampledWallMs;chunkShapes=ProfileChunk data 形状计数(格式漂移哨兵)
    perThread[]            {pid,tid,name,samples,sampledWallMs,gameRootInclMs,top[]{fn,url,line,selfMs,shareOfSampledPct}}
    tagSelfMs              逐 caller-tag 自耗(bolt/rain/raster/present/light/game/... 战役词表)
    inclusive[]            观察名单 {fn,inclMs,shareOfSampledPct} — ★跨节点求和口径(v2),重复栈位重复计入
    api[]                  计数面 {fn,selfMs,shareOfSampledPct,samples,callers[](直接父),appCallers[](应用祖先 fn@file:line)}
    probe[]                仅 --probe 时存在 {fn,selfMs,inclMs,share,nodes,callers}
    winSelfMs              bolt/rain/raster/trail/texRefresh 函数整 trace 自耗
  gc
    byThread[]             {tid,name,minor{n,ms,perSec},major{...},incr{...},isMain}
    heap                   {points,slopeBytesPerS,startBytes,endBytes,majorDropMedianBytes,min/maxAfterBytes,series[](<=240 点)}
  canvas
    lazyPixelRef           {total,perRenderFrame,maxPerFrame} — 真实绘制 op 计数(真实事件,非采样)
    commit                 {n,meanUs,p50Us,p90Us,maxUs} — 主线程 X 'Commit'
    paintOps[]             主线程绘制类 X 事件 {name,n,meanUs,p50Us,p90Us,maxUs}
  workers[]                DedicatedWorker/ServiceWorker {pid,tid,name,samples,sampledWallMs,busyPctOfSpan,
                           namedSelfPct,programSelfPct,idleSelfPct,idleSamplingSuspect,top[]}
                           ★busyPctOfSpan 恒以 named 自耗为分子(span 分母)——(program) 不算 busy。
                           idleSamplingSuspect=true = 空闲采样伪影(有 named JS 但 (program)>50% 采样墙钟
                           且 named<5%;Windows 侧 worker idle 样本落 (program) 而非 (idle),
                           ServiceWorker 判例 busy 实 0% 但 (program) 99.98%)——勿读成饱和
  postMessage              {events,byThread,note} — 本战役 trace 不记录该事件(=0 非缺陷)
  contextLostEvents        contextlost 类事件计数
  signatures[]             {id,hit,severity:warn|alarm,value,threshold,explain}
    id: SHM_SLOW_PATH | UPLOAD_STORM | CONTEXTLOST_STORM | WORKER_ANOMALY |
        SILENT_DEGRADE_BUCKET | GC_PRESSURE | FRAME_STALL | MAIN_SATURATED | RECORDING_ARTIFACT
口径注意:
  - shareOfSampledPct 一律以主线程采样墙钟(正 delta 和)为分母(sw-pass5 口径),不是 trace span
  - inclusive 是跨节点求和(v2 口径),比真实单调用栈 inclusive 偏大,只用于相对比较
  - 值单位: frames/gc/api 均 ms 或 ms/s;canvas.commit/paintOps 为 µs
  - 录制器伪影(--include-recorder 语义,2026-09-29 批):trace 内 CpuProfiler::StartProfiling X 事件
    =采样启动成本(首启 250-820ms),其窗+首次会话后 500ms 预热窗重叠的渲染帧标 recorderArtifact
    并缺省剔除出 frames.fps/gap 分位/超阈计数/slowest/timeline(分母同步扣伪影窗并集);
    --include-recorder 只关剔除(全帧口径,标记仍在)。profile 采样聚合(api/tagSelf/GC)不受影响。
    WORKER_ANOMALY.value.idleSuspectWorkers 只展示不定罪(仪器口径问题)。
    schemaVersion 1 内追加(2026-09-29):recorder 段/frames.countedFrames·recorderArtifactFrames·
    effSpanS/timeline.audioMs/slowest.audioMs·recorderArtifact/workers.*Pct·idleSamplingSuspect
`;

// ─────────────────────────── CLI ───────────────────────────

const USAGE = `用法: node --max-old-space-size=8192 tools/trace-x-ray.mjs <trace.json> [...] [--out PATH] [--md] [--probe fn1,fn2] [--top N] [--include-recorder]
      node tools/trace-x-ray.mjs diff <a.digest.json> <b.digest.json> [--out diff.json]
      node tools/trace-x-ray.mjs --schema   # digest 消费契约
详见文件头注。`;

function parseArgs(argv) {
  const opts = { files: [], md: false, out: null, quiet: false, forceStream: false, probe: null, tune: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--md') opts.md = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--force-stream') opts.forceStream = true;
    else if (a === '--include-recorder') opts.includeRecorder = true;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--top') opts.top = parseInt(argv[++i], 10);
    else if (a === '--main-tid') opts.mainTid = argv[++i];
    else if (a === '--min-anchor-dur') opts.minAnchorDur = parseInt(argv[++i], 10);
    else if (a === '--probe') opts.probe = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--api') opts.apiWatch = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--incl') opts.inclWatch = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--tune') {
      for (const kv of argv[++i].split(',')) {
        const [k, v] = kv.split('=');
        if (k && v !== undefined && SIGNATURE_DEFAULTS[k]) opts.tune[k] = +v;
      }
    } else if (a === '--schema') { console.log(SCHEMA_DOC); process.exit(0); }
    else if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    else if (!a.startsWith('--')) opts.files.push(a);
    else { console.error('未知选项: ' + a); process.exit(2); }
  }
  return opts;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'diff') {
    const rest = argv.slice(1);
    const files = rest.filter((x) => !x.startsWith('--'));
    const outFlag = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : null;
    if (files.length !== 2) { console.error(USAGE); process.exit(2); }
    const a = JSON.parse(fs.readFileSync(files[0], 'utf8'));
    const b = JSON.parse(fs.readFileSync(files[1], 'utf8'));
    const d = diffDigests(a, b, path.basename(files[0]), path.basename(files[1]));
    if (outFlag) fs.writeFileSync(outFlag, JSON.stringify(d, null, 1));
    console.log(renderDiffMd(d));
    return;
  }
  const opts = parseArgs(argv);
  if (!opts.files.length) { console.error(USAGE); process.exit(2); }

  for (const f of opts.files) {
    const d = await digestTrace(f, opts);
    let outPath = opts.out;
    if (!outPath) outPath = f.replace(/\.json$/i, '') + '.digest.json';
    else {
      const isDir = (() => { try { return fs.statSync(outPath).isDirectory(); } catch { return false; } })();
      if (isDir || (opts.files.length > 1 && !outPath.endsWith('.json'))) {
        fs.mkdirSync(outPath, { recursive: true });
        outPath = path.join(outPath, path.basename(f, '.json') + '.digest.json');
      }
    }
    fs.writeFileSync(outPath, JSON.stringify(d, null, 1));
    if (opts.md && !opts.quiet) { console.log(renderMd(d)); console.log(''); }
    else if (!opts.quiet) {
      const hits = d.signatures.filter((s) => s.hit).map((s) => s.id + (s.severity === 'alarm' ? '(!!)' : '(!)'));
      const drawImage = d.profile.api.find((r) => r.fn === 'drawImage');
      console.log(`${path.basename(f)}: span=${d.time.spanS}s fps=${d.frames.fps} gapP50=${d.frames.gap.p50}ms p99=${d.frames.gap.p99}ms | drawImage=${drawImage ? drawImage.shareOfSampledPct : 0}% | LPR/帧=${d.canvas.lazyPixelRef.perRenderFrame} | 签名: ${hits.join(', ') || '无命中'}`);
      console.log(`  digest → ${outPath}`);
    }
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) main().catch((e) => { console.error(e); process.exit(1); });
