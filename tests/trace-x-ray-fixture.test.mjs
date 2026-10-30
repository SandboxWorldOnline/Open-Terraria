// trace-x-ray fixture 单测（2026-09-25,工具刃交付件;2026-09-29 增录制器干扰项过滤批）：
// 用手工合成的最小 trace 锁住拆解器全部机制面——解析器 bug 一次捕获,永久免疫。
// 覆盖：流式状态机↔整读双路径一致性（含 8MB 块边界 carry 重放路径——2026-09-25 曾在此
// 炸出 Buffer.slice=视图 非 拷贝 的 carry 覆写事故,10MB pad 强制跨块,双路径 digest 必须
// 逐字段全等）、帧锚/帧距、profile 重组（跨 chunk 自耗收账）、GC canonical 计数+堆序列、
// LPR/Commit 画布面、worker/降级桶/签名、probe 嫌疑表、CLI 三模式;
// 第二 describe=录制器干扰项:StartProfiling 伪影帧标记/剔除/--include-recorder 语义/
// 预热窗 --tune/worker (program) 空闲采样伪影 idleSamplingSuspect/音频 step 标签词表。
// 运行：npx vitest run tests/trace-x-ray-fixture.test.mjs
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestTrace, diffDigests, scanTraceStream, SCHEMA_VERSION } from '../tools/trace-x-ray.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, '..', 'tools', 'trace-x-ray.mjs');

// ─────────────────────────── fixture 构建（全部数字手算可复核） ───────────────────────────

function buildFixtureTrace(dir) {
  // 10MB pad：把文件顶过 8MB 流式块,强制 carry 重放路径生效（跨块事件两路径必须全等）
  const PAD = 'A'.repeat(10 * 1024 * 1024);
  const T0 = 1_000_000; // 起始 µs
  // 8 个渲染帧锚:gaps = 16,16,50,16,16,16,16(ms)
  const anchorOff = [0, 16000, 32000, 82000, 98000, 114000, 130000, 146000];
  const ev = [];
  const M = (o) => ev.push({ cat: '__metadata', ph: 'M', ts: 0, ...o });

  M({ name: 'process_name', pid: 7, tid: 0, args: { name: 'Renderer' } });
  M({ name: 'thread_name', pid: 7, tid: 100, args: { name: 'CrRendererMain' } });
  M({ name: 'thread_name', pid: 7, tid: 101, args: { name: 'Compositor' } });
  M({ name: 'thread_name', pid: 7, tid: 102, args: { name: 'DedicatedWorker thread' } });

  // 渲染帧锚（FireAnimationFrame dur≥3000µs）
  for (const off of anchorOff) ev.push({ cat: 'devtools.timeline', name: 'FireAnimationFrame', ph: 'X', pid: 7, tid: 100, ts: T0 + off, dur: 3500 });
  // 渲染帧（FunctionCall loop dur≥1500µs）
  for (const off of anchorOff) ev.push({ cat: 'devtools.timeline', name: 'FunctionCall', ph: 'X', pid: 7, tid: 100, ts: T0 + off, dur: 12000, args: { data: { functionName: 'loop' } } });
  // Commit（软件栅格提交,主线程）
  ev.push({ cat: 'disabled-by-default-devtools.timeline', name: 'Commit', ph: 'X', pid: 7, tid: 100, ts: T0 + 5000, dur: 12000 });
  // LPR 瞬时 ×6（全落帧 0）
  for (let i = 0; i < 6; i++) ev.push({ cat: 'disabled-by-default-devtools.timeline', name: 'Draw LazyPixelRef', ph: 'I', pid: 7, tid: 100, ts: T0 + 1000 + i * 1000 });
  // GC canonical 计数（V8.GC_* 命名;MinorGC/MajorGC 堆载体另发,args 直挂字段=战役形态）
  ev.push({ cat: 'v8', name: 'V8.GC_SCAVENGER', ph: 'X', pid: 7, tid: 100, ts: T0 + 10000, dur: 3000 });
  ev.push({ cat: 'v8', name: 'V8.GC_MARK_COMPACTOR', ph: 'X', pid: 7, tid: 100, ts: T0 + 85000, dur: 20000 });
  // 三连堆载体:10→8MB, 12→7MB, 9→8.8MB（锯齿+正斜率）
  ev.push({ cat: 'devtools.timeline,v8', name: 'MinorGC', ph: 'X', pid: 7, tid: 100, ts: T0 + 10000, dur: 3000, args: { type: 'scavenger', usedHeapSizeBefore: 10000000, usedHeapSizeAfter: 8000000 } });
  ev.push({ cat: 'devtools.timeline,v8', name: 'MajorGC', ph: 'X', pid: 7, tid: 100, ts: T0 + 85000, dur: 20000, args: { type: 'mark-compact', usedHeapSizeBefore: 12000000, usedHeapSizeAfter: 7000000 } });
  ev.push({ cat: 'devtools.timeline,v8', name: 'MinorGC', ph: 'X', pid: 7, tid: 100, ts: T0 + 145000, dur: 2500, args: { type: 'scavenger', usedHeapSizeBefore: 9000000, usedHeapSizeAfter: 8800000 } });
  // contextlost ×4（>3 warn 线,<20 风暴线）
  for (let i = 0; i < 4; i++) ev.push({ cat: 'devtools.timeline', name: 'webglcontextlost', ph: 'I', pid: 7, tid: 100, ts: T0 + 20000 + i });
  // DrawFrame（合成器,3 个,gap 16/16ms）
  for (const off of [5000, 21000, 37000]) ev.push({ cat: 'devtools.timeline.frame', name: 'DrawFrame', ph: 'X', pid: 7, tid: 101, ts: T0 + off, dur: 500 });
  // DroppedFrame（合成器瞬时）
  ev.push({ cat: 'devtools.timeline.frame', name: 'DroppedFrame', ph: 'I', pid: 7, tid: 101, ts: T0 + 60000, args: { count: 3 } });
  // worker 侧 postMessage
  ev.push({ cat: 'devtools.timeline', name: 'postMessage', ph: 'X', pid: 7, tid: 102, ts: T0 + 40000, dur: 100 });

  // 主线程 CPU profile session '0x1':根→loop→{drawImage,drawRain,fixedUpdate,degradeAcc,texImage2D}
  ev.push({ cat: 'v8.cpu_profiler', name: 'Profile', id: '0x1', ph: 'P', pid: 7, tid: 100, ts: T0, args: { data: { startTime: T0 } } });
  // ★拓扑必须是真实形态:loop→frame→{fixedUpdate,render→{drawRain,drawImage,texImage2D}}
  //   （caller-tag 口径:loop 直接子节点=game 优先于函数集;扁平挂载会让 drawRain 误标 game）
  const NODES1 = [
    { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } },
    { id: 2, parent: 1, callFrame: { functionName: 'loop', url: 'http://localhost:5199/src/Game.ts', lineNumber: 10 } },
    { id: 8, parent: 2, callFrame: { functionName: 'frame', url: 'http://localhost:5199/src/Game.ts', lineNumber: 12 } },
    { id: 5, parent: 8, callFrame: { functionName: 'fixedUpdate', url: 'http://localhost:5199/src/Game.ts', lineNumber: 20 } },
    { id: 6, parent: 8, callFrame: { functionName: 'degradeAcc', url: 'http://localhost:5199/src/Game.ts', lineNumber: 30 } },
    { id: 9, parent: 8, callFrame: { functionName: 'render', url: 'http://localhost:5199/src/render/Renderer.ts', lineNumber: 15 } },
    { id: 3, parent: 9, callFrame: { functionName: 'drawRain', url: 'http://localhost:5199/src/render/WeatherRenderer.ts', lineNumber: 5 } },
    { id: 4, parent: 9, callFrame: { functionName: 'drawImage', url: '', lineNumber: -1 } },
    { id: 7, parent: 9, callFrame: { functionName: 'texImage2D', url: '', lineNumber: -1 } },
  ];
  // chunk1:样本 [7,3,4,4,5,6] td [2000,1000,1000,1000,1000,2000]
  //   → 自耗:texImage2D=1000, drawRain=1000, drawImage=1000+1000=2000, fixedUpdate=1000, degradeAcc=pending
  ev.push({ cat: 'v8.cpu_profiler', name: 'ProfileChunk', id: '0x1', ph: 'P', pid: 7, tid: 100, ts: T0 + 8000, args: { data: { cpuProfile: { nodes: NODES1, samples: [7, 3, 4, 4, 5, 6] }, timeDeltas: [2000, 1000, 1000, 1000, 1000, 2000] } } });
  // chunk2:跨 chunk 收账——degradeAcc 由本 chunk 首 delta 结 1500µs;尾样本 2 悬置
  ev.push({ cat: 'v8.cpu_profiler', name: 'ProfileChunk', id: '0x1', ph: 'P', pid: 7, tid: 100, ts: T0 + 9500, args: { data: { cpuProfile: { samples: [2] }, timeDeltas: [1500] } } });

  // worker profile session '0x2'（LightWorker 形态:mostly idle + blurLine 3000µs）
  ev.push({ cat: 'v8.cpu_profiler', name: 'Profile', id: '0x2', ph: 'P', pid: 7, tid: 102, ts: T0, args: { data: { startTime: T0 } } });
  ev.push({ cat: 'v8.cpu_profiler', name: 'ProfileChunk', id: '0x2', ph: 'P', pid: 7, tid: 102, ts: T0 + 10000, args: { data: { cpuProfile: { nodes: [
    { id: 11, callFrame: { functionName: '(idle)', url: '', lineNumber: -1 } },
    { id: 12, parent: 11, callFrame: { functionName: 'blurLine', url: 'http://localhost:5199/src/render/LightWorker.ts', lineNumber: 8 } },
  ], samples: [11, 12, 11] }, timeDeltas: [2000, 3000, 5000] } } });

  // pad 事件（把文件顶过 8MB,事件级跨块）
  ev.push({ cat: '_pad', name: '_pad', ph: 'X', pid: 0, tid: 0, ts: 1, dur: 1, args: { pad: PAD } });

  const file = path.join(dir, 'fixture-trace.json');
  fs.writeFileSync(file, JSON.stringify({ metadata: {}, traceEvents: ev }));
  return file;
}

// ─────────────────────────── 期望值（手算） ───────────────────────────
// 8 锚,gaps[16,16,50,16,16,16,16] → p50=16 count33=1;span=150000µs(0.15s) fps=53.3
// profile session0x1:wall=2000+1000*5+1500=9500µs;self:texImage2D=1000 drawRain=1000
//   drawImage=2000 fixedUpdate=1000 degradeAcc=1500（chunk2 首 delta 收账）
//   drawImage share=2000/9500=21.05%;tag: game=1000+2000+1000+1500=5500? (drawImage2000+fixedUpdate1000+degradeAcc1500=4500) rain=1000
//   loop incl=4500+1000=5500;drawImage incl=2000,callers=[loop]
// worker:wall=10000µs,self (idle)=7000 blurLine=3000 → busy=3000 → busyPctOfSpan=2%
// gc main: minor=1 major=1;heap 3 点,斜率>0;majorDrop 中位=2MB(drops[2M,5M,0.2M]→2M)
// canvas: lpr total=6 perFrame=0.75 maxPerFrame=6;commit n=1 mean=12000µs

// ─────────────────────────── fixture B：录制器干扰项（全部数字手算可复核） ───────────────────────────

function buildRecorderFixtureTrace(dir) {
  const T0 = 2_000_000; // 起始 µs
  // 6 个渲染帧锚:gaps = 16,74,16,16,16(ms)——idx1 的 74ms gap 就是"巨帧"展位
  const anchorOff = [0, 16000, 90000, 106000, 122000, 138000];
  const ev = [];
  const M = (o) => ev.push({ cat: '__metadata', ph: 'M', ts: 0, ...o });

  M({ name: 'process_name', pid: 9, tid: 0, args: { name: 'Renderer' } });
  M({ name: 'thread_name', pid: 9, tid: 100, args: { name: 'CrRendererMain' } });
  M({ name: 'thread_name', pid: 9, tid: 102, args: { name: 'DedicatedWorker thread' } });
  M({ name: 'thread_name', pid: 9, tid: 103, args: { name: 'DedicatedWorker thread' } });

  // 渲染帧锚 + 渲染帧（FunctionCall loop dur≥1500µs）
  for (const off of anchorOff) {
    ev.push({ cat: 'devtools.timeline', name: 'FireAnimationFrame', ph: 'X', pid: 9, tid: 100, ts: T0 + off, dur: 3500 });
    ev.push({ cat: 'devtools.timeline', name: 'FunctionCall', ph: 'X', pid: 9, tid: 100, ts: T0 + off, dur: 12000, args: { data: { functionName: 'loop' } } });
  }
  // 音频 rAF 回调宿主（094306 判例形态）+ 打断它的录制器启动事件（主线程,279.54ms 的缩比形态）
  ev.push({ cat: 'devtools.timeline', name: 'FunctionCall', ph: 'X', pid: 9, tid: 100, ts: T0 + 18000, dur: 12000, args: { data: { functionName: 'step' } } });
  ev.push({ cat: 'disabled-by-default-devtools.timeline', name: 'CpuProfiler::StartProfiling', ph: 'X', pid: 9, tid: 100, ts: T0 + 18000, dur: 12000 });
  // 第二 isolate 的 StartProfiling（span 外,0 重叠——锁会话清单完整性）
  ev.push({ cat: 'disabled-by-default-devtools.timeline', name: 'CpuProfiler::StartProfiling', ph: 'X', pid: 9, tid: 102, ts: T0 + 150000, dur: 2000 });

  // 主线程 profile session '0x1'：step(音频根回调,父=(root))→drawImage;样本落 idx1 帧窗
  //   samples [step,drawImage,step] td [18000,1000,1000,1000] → 采样墙钟 21ms;
  //   样本 ts 18/19/20ms 全在 idx1 窗 [16,116) → tag audio=2ms(drawImage 样本经 step 祖先标 audio);
  //   self:drawImage=1000µs
  ev.push({ cat: 'v8.cpu_profiler', name: 'Profile', id: '0x1', ph: 'P', pid: 9, tid: 100, ts: T0, args: { data: { startTime: T0 } } });
  ev.push({ cat: 'v8.cpu_profiler', name: 'ProfileChunk', id: '0x1', ph: 'P', pid: 9, tid: 100, ts: T0 + 1000, args: { data: { cpuProfile: { nodes: [
    { id: 41, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } },
    { id: 42, parent: 41, callFrame: { functionName: 'step', url: 'http://localhost:5199/src/core/Audio.ts', lineNumber: 325 } },
    { id: 43, parent: 42, callFrame: { functionName: 'drawImage', url: '', lineNumber: -1 } },
  ], samples: [42, 43, 42] }, timeDeltas: [18000, 1000, 1000, 1000] } } });

  // worker profile session '0x2'（tid102,空闲采样伪影形态:21 样本全落 (program)/1 个 named）
  //   wall=21×2000=42000µs;self:(program)=38000 blurLine=2000 → named 4.76%<5%,prog 90.48%>50% → suspect
  ev.push({ cat: 'v8.cpu_profiler', name: 'Profile', id: '0x2', ph: 'P', pid: 9, tid: 102, ts: T0, args: { data: { startTime: T0 } } });
  ev.push({ cat: 'v8.cpu_profiler', name: 'ProfileChunk', id: '0x2', ph: 'P', pid: 9, tid: 102, ts: T0 + 1000, args: { data: { cpuProfile: { nodes: [
    { id: 21, callFrame: { functionName: '(program)', url: '', lineNumber: -1 } },
    { id: 22, parent: 21, callFrame: { functionName: 'blurLine', url: 'http://localhost:5199/src/render/LightWorker.ts', lineNumber: 8 } },
  ], samples: [21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 22, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21] }, timeDeltas: Array(21).fill(2000) } } });

  // worker profile session '0x3'（tid103,真实忙碌对照:exportTo 60ms,named 66.67% → 非 suspect）
  ev.push({ cat: 'v8.cpu_profiler', name: 'Profile', id: '0x3', ph: 'P', pid: 9, tid: 103, ts: T0, args: { data: { startTime: T0 } } });
  ev.push({ cat: 'v8.cpu_profiler', name: 'ProfileChunk', id: '0x3', ph: 'P', pid: 9, tid: 103, ts: T0 + 1000, args: { data: { cpuProfile: { nodes: [
    { id: 31, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } },
    { id: 32, parent: 31, callFrame: { functionName: 'exportTo', url: 'http://localhost:5199/src/render/LightWorker.ts', lineNumber: 20 } },
  ], samples: [32, 32, 32] }, timeDeltas: [30000, 30000, 30000] } } });

  const file = path.join(dir, 'fixture-trace-recorder.json');
  fs.writeFileSync(file, JSON.stringify({ metadata: {}, traceEvents: ev }));
  return file;
}

describe('trace-x-ray fixture（机制面免疫锁）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txr-fixture-'));
  const traceFile = buildFixtureTrace(dir);

  it('流式状态机 vs 整读：同 trace 双解析路径 digest 逐字段全等（carry 跨块免疫）', async () => {
    const whole = await digestTrace(traceFile, {});
    const stream = await digestTrace(traceFile, { forceStream: true });
    // strip 掉三处合法路径差:scanMs(计时)/path(同值)/parseMode(两套解析的标识本身)
    const strip = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.source.scanMs; c.source.path = ''; c.source.parseMode = ''; return c; };
    expect(stream.source.parseMode).toBe('stream');
    expect(whole.source.parseMode).toBe('whole-read');
    expect(strip(stream)).toEqual(strip(whole));
    expect(whole.source.parseBad).toBe(0);
    // 10MB pad 文件确认真走了两套解析（整读上限 16MB,流式块 8MB 都被踩到）
    expect(whole.source.bytes).toBeGreaterThan(8 * 1024 * 1024);
  });

  it('digest 元面：schema/主线程/线程清单', async () => {
    const d = await digestTrace(traceFile, {});
    expect(d.schema).toBe('trace-x-ray.digest');
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.main.pid).toBe(7);
    expect(d.main.tid).toBe(100);
    const roles = Object.fromEntries(d.threads.map((t) => [t.name, t.role]));
    expect(roles['CrRendererMain']).toBe('main');
    expect(roles['Compositor']).toBe('compositor');
    expect(roles['DedicatedWorker thread']).toBe('worker');
  });

  it('帧锚面：anchors/gap 分位/loop 渲染帧/DrawFrame/DroppedFrame', async () => {
    const d = await digestTrace(traceFile, {});
    expect(d.frames.anchors).toBe(8);
    expect(d.frames.gap.p50).toBe(16);
    expect(d.frames.gap.max).toBe(50);
    expect(d.frames.count33ms).toBe(1);
    expect(d.frames.count50ms).toBe(0); // 50 不严格大于 50
    expect(d.frames.loop).toEqual({ n: 8, render: 8, skip: 0 });
    expect(d.frames.droppedFrames).toBe(1);
    expect(d.frames.drawFrame).toMatchObject({ tid: 101, n: 3, gapP50Ms: 16, gapMaxMs: 16 });
    expect(typeof d.frames.drawFrame.tid).toBe('number');
    // fps = 8 锚 / 0.15s
    expect(d.frames.fps).toBeCloseTo(54.8, 0); // 8锚/0.146s(末锚 ts=T0+146000)
  });

  it('profile 重组：跨 chunk 自耗收账/份额/标签/树 incl/probe', async () => {
    const d = await digestTrace(traceFile, { probe: ['drawImage', 'rasterizePathOp'] });
    expect(d.profile.mainSamples).toBe(7);
    expect(d.profile.mainSampledWallMs).toBe(9.5);
    const main = d.profile.perThread.find((t) => t.tid === 100);
    const selfOf = (fn) => main.top.find((r) => r.fn === fn)?.selfMs ?? 0;
    expect(selfOf('drawImage')).toBe(2);       // 2000µs
    expect(selfOf('degradeAcc')).toBe(1.5);    // 1500µs（跨 chunk 收账）
    expect(selfOf('drawRain')).toBe(1);
    expect(selfOf('texImage2D')).toBe(1);
    expect(main.gameRootInclMs).toBe(7.5);     // loop 子树=1000+1000+2000+2000+1500
    const api = Object.fromEntries(d.profile.api.map((r) => [r.fn, r]));
    expect(api.drawImage.selfMs).toBe(2);
    expect(api.drawImage.shareOfSampledPct).toBeCloseTo(21.05, 1);
    expect(api.drawImage.appCallers[0].fn).toContain('Renderer.ts'); // 应用祖先=最近 url 祖先(render)
    expect(api.degradeAcc.selfMs).toBe(1.5);   // 降级桶进 API 面（签名 5 的数据源）
    expect(d.profile.tagSelfMs.game).toBe(6.5); // drawImage2000+fixedUpdate2000+degradeAcc1500+texImage2D1000(都在 render/frame→loop 子树)
    expect(d.profile.tagSelfMs.rain).toBe(1);
    // probe 嫌疑表：每个点名 fn 必出 row（含零行 rasterizePathOp=本 fixture 无此函数）
    const probe = Object.fromEntries(d.profile.probe.map((r) => [r.fn, r]));
    expect(probe.drawImage.inclMs).toBe(2);
    expect(probe.drawImage.callers[0].fn).toBe('render'); // 直接父=render(嵌套拓扑)
    expect(probe.rasterizePathOp).toMatchObject({ selfMs: 0, inclMs: 0, nodes: 0 });
  });

  it('GC 面：canonical 计数不×3/堆序列斜率/锯齿', async () => {
    const d = await digestTrace(traceFile, {});
    const main = d.gc.byThread.find((r) => r.isMain);
    expect(main.minor.n).toBe(1);  // V8.GC_SCAVENGER 只此一条（MinorGC 载体不重复计数）
    expect(main.major.n).toBe(1);
    expect(d.gc.heap.points).toBe(3);
    expect(d.gc.heap.slopeBytesPerS).toBeGreaterThan(0); // 8→8.8MB 收尾,正斜率
    expect(d.gc.heap.majorDropMedianBytes).toBe(2000000);
    expect(d.gc.heap.series.length).toBe(3);
  });

  it('画布面：LPR/Commit', async () => {
    const d = await digestTrace(traceFile, {});
    expect(d.canvas.lazyPixelRef).toEqual({ total: 6, perRenderFrame: 0.8, maxPerFrame: 6 }); // 6/8=0.75→round 0.8
    expect(d.canvas.commit).toMatchObject({ n: 1, meanUs: 12000, p90Us: 12000, maxUs: 12000 });
  });

  it('worker/postMessage/contextlost', async () => {
    const d = await digestTrace(traceFile, {});
    expect(d.workers).toHaveLength(1);
    expect(d.workers[0]).toMatchObject({ tid: 102, samples: 3 });
    expect(d.workers[0].top[0]).toMatchObject({ fn: 'blurLine', selfMs: 5 }); // s1 自耗=td[2]=5000
    expect(d.workers[0].top[1]).toMatchObject({ fn: '(idle)', selfMs: 3 });
    expect(d.workers[0].busyPctOfSpan).toBe(3.4); // 非闲置 5000µs / 146000µs
    expect(d.postMessage.events).toBe(1);
    expect(d.contextLostEvents).toBe(4);
  });

  it('签名库：静默降级/帧卡顿/contextlost 命中;SHM/上传/GC/worker/饱和 不误报', async () => {
    const d = await digestTrace(traceFile, {});
    const byId = Object.fromEntries(d.signatures.map((s) => [s.id, s]));
    expect(byId.SILENT_DEGRADE_BUCKET.hit).toBe(true); // degradeAcc 15.8% ≫ 0.3%
    expect(byId.FRAME_STALL.hit).toBe(true);           // p99=50>33（非 alarm,50 不>50）
    expect(byId.FRAME_STALL.severity).toBe('warn');
    expect(byId.CONTEXTLOST_STORM.hit).toBe(true);     // 4>3
    expect(byId.CONTEXTLOST_STORM.severity).toBe('warn');
    expect(byId.SHM_SLOW_PATH.hit).toBe(false);        // LPR 0.75/帧=健康
    expect(byId.UPLOAD_STORM.hit).toBe(false);         // 单帧 1ms,不足 warn 线
    expect(byId.GC_PRESSURE.hit).toBe(false);          // 1 次/0.15s=6.7/s<10
    expect(byId.WORKER_ANOMALY.hit).toBe(false);       // 1 worker,2% busy
    expect(byId.MAIN_SATURATED.hit).toBe(false);       // 无 RunTask
  });

  it('--tune 阈值覆盖生效', async () => {
    const d = await digestTrace(traceFile, { tune: { degradeSelfSharePct: 99 } });
    const sig = d.signatures.find((s) => s.id === 'SILENT_DEGRADE_BUCKET');
    expect(sig.hit).toBe(false);
    expect(sig.threshold.sharePct).toBe(99);
  });

  it('diff：两份 digest 并排差分 + 签名翻转', async () => {
    const a = await digestTrace(traceFile, {});
    // 改造版 B：LPR ×10 → SHM 命中翻转
    const ev2 = JSON.parse(JSON.stringify(a)); // 仅作占位;真 diff 用两份真 digest
    const b = await digestTrace(traceFile, {});
    b.canvas.lazyPixelRef.perRenderFrame = 260.8;
    b.frames.gap.p99 = 64.56;
    const diff = diffDigests(a, b, 'A', 'B');
    const row = diff.rows.find((r) => r.group === 'canvas' && r.field === 'lpr.perRenderFrame');
    expect(row.b).toBe(260.8);
    expect(row.a).toBe(0.8);
    expect(typeof diff.signatureFlips.onlyInB).toBe('object');
    expect(ev2.schema).toBe(a.schema);
  });

  it('CLI：单文件 --md / --schema / diff 子命令 全部 exit 0', () => {
    const outDigest = path.join(dir, 'cli.digest.json');
    const r1 = spawnSync(process.execPath, [TOOL, traceFile, '--out', outDigest, '--md'], { encoding: 'utf8' });
    expect(r1.status).toBe(0);
    expect(r1.stdout).toContain('trace-x-ray');
    const d = JSON.parse(fs.readFileSync(outDigest, 'utf8'));
    expect(d.frames.anchors).toBe(8);
    const r2 = spawnSync(process.execPath, [TOOL, '--schema'], { encoding: 'utf8' });
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain('消费契约');
    const r3 = spawnSync(process.execPath, [TOOL, 'diff', outDigest, outDigest], { encoding: 'utf8' });
    expect(r3.status).toBe(0);
    expect(r3.stdout).toContain('trace-x-ray diff');
  });

  it('流式状态机事件计数与整读一致（carry 面直测）', async () => {
    const raw = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
    let n = 0;
    const r = await scanTraceStream(traceFile, () => n++);
    expect(r.total).toBe(raw.traceEvents.length);
    expect(r.bad).toBe(0);
  });

  it('scanTraceStream 同步直调：裸数组文件 0 事件不炸（契约=DevTools 单对象）', () => {
    // 契约声明:只支持 {metadata,traceEvents} 单对象;裸数组文件直接 0 事件不炸
    const p = path.join(dir, 'bare-array.json');
    fs.writeFileSync(p, '[{"name":"x"}]');
    const r = scanTraceStream(p, () => {});
    expect(r.total).toBe(0);
  });
});

// ═══════════════ 录制器干扰项过滤 fixture（2026-09-29 批,登记债落刀）═════════════════════════
// 注入 CpuProfiler::StartProfiling（主线程宿主形态=094306 判例:音频 rAF 回调 step 被启动成本
// 打断成"巨帧"）+ (program) 主导的空闲 worker 线程（Windows 判例:idle 样本落 (program) 而非
// (idle),ServiceWorker busy 实 0% 但 (program) 99.98%）。锁:recorder 段/伪影标记与剔除/
// 预热窗/--include-recorder 语义/worker idleSamplingSuspect/音频标签。
describe('trace-x-ray recorder 过滤 fixture（StartProfiling 伪影 + 空闲 worker 采样伪影）', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'txr-recorder-'));
  const recFile = buildRecorderFixtureTrace(dir2);

  // 期望值（手算）:
  //   锚 6 个 offsets[0,16,90,106,122,138]ms → gaps[16,74,16,16,16];span=150ms(worker sp 顶到 150)
  //   StartProfiling 主线程 t=+18ms dur=12ms → 伪影窗 [18,30+预热];首次带 500ms 预热 → [18,530]
  //   worker sp t=+150ms dur=2ms → 窗 [150,152](span 外,0 重叠)
  //   默认口径:伪影帧=idx1..5(5 个,宿主帧 idx1 靠锚窗相交,其余靠 gap 区间) → counted=1,
  //     effSpan=150-132=18ms,fps=50;gap 全空;RECORDING_ARTIFACT hit
  //   tune warmup=10ms:窗 [18,40] → 伪影=idx1,idx2(2 个) → gaps 剩[16,16,16] p50=16 max=16,
  //     effSpan=150-24=126→0.13,fps=4/0.13=30.8
  //   include-recorder:全帧口径 gaps[16,74,16,16,16] p50=16 max=74,fps=6/0.15=40;
  //     slowest[0]=idx2(gap74,recorderArtifact=true);idx1 行 audioMs=2
  //   worker tid102:21 样本 wall=42ms,(program)=38ms(90.48%) named blurLine=2ms(4.76%) → suspect
  //   worker tid103:3 样本 wall=90ms,exportTo=60ms(66.67%) → 非 suspect,busy=40%>25 → ANOMALY hit
  it('recorder fixture：流式 vs 整读双路径全等', async () => {
    const whole = await digestTrace(recFile, {});
    const stream = await digestTrace(recFile, { forceStream: true });
    const strip = (d) => { const c = JSON.parse(JSON.stringify(d)); delete c.source.scanMs; c.source.path = ''; c.source.parseMode = ''; return c; };
    expect(strip(stream)).toEqual(strip(whole));
    expect(whole.source.parseBad).toBe(0);
  });

  it('recorder 段：会话窗/时长/重叠帧清单/预热窗标注', async () => {
    const d = await digestTrace(recFile, {});
    expect(d.recorder.detected).toBe(true);
    expect(d.recorder.warmupMs).toBe(500);
    expect(d.recorder.sessions).toHaveLength(2);
    const main = d.recorder.sessions[0];
    expect(main).toMatchObject({
      tidKey: '9:100', name: 'CrRendererMain', startRelMs: 18, durMs: 12,
      isFirst: true, windowRelMs: [18, 530], overlapFrames: 5,
    });
    const wk = d.recorder.sessions[1];
    expect(wk).toMatchObject({ tidKey: '9:102', isFirst: false, startRelMs: 150, durMs: 2, windowRelMs: [150, 152], overlapFrames: 0 });
    expect(d.recorder.artifactFrames).toBe(5);
    expect(d.recorder.artifactUnionMs).toBe(132);
    // 首会话重叠帧清单:宿主帧 idx1(gap16)+被延迟帧 idx2..5(gap 74/16/16/16)
    expect(main.overlapFrameList.map((f) => f.gapMs)).toEqual([16, 74, 16, 16, 16]);
  });

  it('伪影帧缺省剔除：counted/effSpan/fps/gap 全空/慢帧表清空', async () => {
    const d = await digestTrace(recFile, {});
    expect(d.frames.anchors).toBe(6);
    expect(d.frames.recorderArtifactFrames).toBe(5);
    expect(d.frames.countedFrames).toBe(1);
    expect(d.frames.effSpanS).toBe(0.02);          // 150ms-132ms 伪影窗并集
    expect(d.frames.fps).toBe(50);                 // 1/0.02
    expect(d.frames.gap).toMatchObject({ p50: 0, max: 0 });
    expect(d.frames.count33ms).toBe(0);
    expect(d.frames.slowest).toHaveLength(1);      // 只剩 idx0(gap=0)
    expect(d.frames.slowest[0].recorderArtifact).toBeUndefined();
    const sig = d.signatures.find((s) => s.id === 'RECORDING_ARTIFACT');
    expect(sig.hit).toBe(true);
    expect(sig.value).toEqual({ recorderSessions: 2, artifactFrames: 5, excludedFromStats: true, artifactUnionMs: 132 });
  });

  it('--tune recorderWarmupMs 收窄预热窗：宿主帧+gap 帧仍标,后续帧恢复统计', async () => {
    const d = await digestTrace(recFile, { tune: { recorderWarmupMs: 10 } });
    expect(d.recorder.warmupMs).toBe(10);
    expect(d.recorder.artifactFrames).toBe(2);     // idx1(锚窗相交)+idx2(gap 区间相交)
    expect(d.frames.countedFrames).toBe(4);
    expect(d.frames.gap.p50).toBe(16);             // gaps 剩 [16,16,16]
    expect(d.frames.gap.max).toBe(16);             // 74ms gap 已随 idx2 剔除
    expect(d.frames.effSpanS).toBe(0.13);          // 150-22-2
    expect(d.frames.fps).toBe(30.8);               // 4/0.13
  });

  it('--include-recorder 语义：全帧口径仅标记不剔除,慢帧表带 recorderArtifact 旗', async () => {
    const d = await digestTrace(recFile, { includeRecorder: true });
    expect(d.recorder.excludedFromStats).toBe(false);
    expect(d.frames.countedFrames).toBe(6);
    expect(d.frames.recorderArtifactFrames).toBe(5);
    expect(d.frames.gap.p50).toBe(16);
    expect(d.frames.gap.max).toBe(74);             // 巨帧 gap 回到统计面
    expect(d.frames.fps).toBe(40);                 // 6/0.15
    expect(d.frames.effSpanS).toBe(0.15);
    const sig = d.signatures.find((s) => s.id === 'RECORDING_ARTIFACT');
    expect(sig.value.excludedFromStats).toBe(false);
    const giant = d.frames.slowest.find((s) => s.gapMs === 74);
    expect(giant.recorderArtifact).toBe(true);
    // 音频宿主帧(idx1)标签:step 根回调子树样本 2ms(audio 词表+伪根父门控)
    const host = d.frames.slowest.find((s) => s.tMs === 16);
    expect(host.audioMs).toBe(2);
    expect(host.recorderArtifact).toBe(true);
  });

  it('worker 空闲采样伪影：(program) 主导+named<5% → suspect,busy 恒 named 口径', async () => {
    const d = await digestTrace(recFile, {});
    expect(d.workers).toHaveLength(2);
    const suspect = d.workers.find((w) => w.tid === 102);
    expect(suspect.idleSamplingSuspect).toBe(true);
    expect(suspect.programSelfPct).toBe(90.48);    // 38/42
    expect(suspect.namedSelfPct).toBe(4.76);       // 2/42 <5%
    expect(suspect.idleSelfPct).toBe(0);
    expect(suspect.busyPctOfSpan).toBe(1.3);       // 2/150——以 named 为准,非 (program) 的 90%
    expect(suspect.top[0]).toMatchObject({ fn: '(program)', selfMs: 38 });
    const busy = d.workers.find((w) => w.tid === 103);
    expect(busy.idleSamplingSuspect).toBe(false);  // named 66.67% ≥5%,真实忙碌
    expect(busy.busyPctOfSpan).toBe(40);           // 60/150 >25 → ANOMALY 数据源
    expect(busy.programSelfPct).toBe(0);
  });

  it('WORKER_ANOMALY：busy 命中,idleSuspect 只展示不定罪', async () => {
    const d = await digestTrace(recFile, {});
    const sig = d.signatures.find((s) => s.id === 'WORKER_ANOMALY');
    expect(sig.hit).toBe(true);
    expect(sig.value.busyWorkers).toEqual(['DedicatedWorker thread(40%)']);
    expect(sig.value.idleSuspectWorkers).toEqual(['DedicatedWorker thread(1.3% named,(program)90.48% 采样伪影)']);
  });

  it('音频标签词表：step 根回调进 audio,样本聚合面不受伪影剔除影响', async () => {
    const d = await digestTrace(recFile, {});
    expect(d.profile.tagSelfMs.audio).toBe(2);     // 2 个 step-子树样本 ×1ms
    expect(d.profile.tagSelfMs.game).toBeUndefined(); // 无 loop 子树,无误标
    // profile 采样聚合面(api/GC)与伪影剔除正交——回归保证的 fixture 级缩比
    const api = Object.fromEntries(d.profile.api.map((r) => [r.fn, r]));
    expect(api.drawImage.selfMs).toBe(1);
    expect(d.profile.mainSamples).toBe(3);
  });
});


// ─────────────────────────── 掉帧窗归因（2026-10-27 增强批）───────────────────────────
// 合成三型窗锁四分类:tick-hole(主闲+GPU闲)/slow-frame(前帧体长)/其余 mixed。
// fixture 无 StartProfiling(非伪影窗)——全部窗入账。
describe('掉帧窗归因（dropWindows 四分类）', () => {
  function dropFixture(dir) {
    const T0 = 1_000_000;
    const ev = [];
    const M = (o) => ev.push({ cat: '__metadata', ph: 'M', ts: 0, ...o });
    M({ name: 'process_name', pid: 7, tid: 0, args: { name: 'Renderer' } });
    M({ name: 'thread_name', pid: 7, tid: 100, args: { name: 'CrRendererMain' } });
    M({ name: 'thread_name', pid: 8, tid: 200, args: { name: 'CrGpuMain' } });
    const X = (name, pid, tid, ts, dur) => ev.push({ name, cat: 'devtools.timeline', ph: 'X', ts, dur, pid, tid, args: {} });
    // 渲染帧(rAF dur≥800µs):8.3ms 稳拍 ×3 → tick-hole 窗(22ms 洞,主/GPU 全闲) →
    // 8.3 ×1 → slow-frame 窗(18ms,前帧体 15ms 主忙) → 8.3 ×1 → mixed 窗(15ms,主忙 8ms 非前帧主导)
    const t = (us) => T0 + us;   // µs 直传
    // 前段稳拍 4 帧(0,8.3,16.6,24.9)
    for (const [ts, dur] of [[0, 4000], [8300, 4000], [16600, 4000], [24900, 4000]]) {
      X('FireAnimationFrame', 7, 100, t(ts), dur);
    }
    // tick-hole 窗:下一渲染 46.9(距 22ms);窗内零主忙零 GPU 忙
    X('FireAnimationFrame', 7, 100, t(46900), 4000);
    // slow-frame 窗:前帧 55.2 体 15ms(主忙 RunTask 覆盖)→ 下一渲染 73.2(距 18ms)
    X('FireAnimationFrame', 7, 100, t(55200), 15000);
    X('RunTask', 7, 100, t(55200), 15000);
    X('FireAnimationFrame', 7, 100, t(73200), 4000);
    // mixed 窗:15ms 距,窗内主忙 8ms(rAF 之后的任务,前帧体仅 4ms)
    X('FireAnimationFrame', 7, 100, t(81500), 4000);
    X('RunTask', 7, 100, t(83000), 8000);
    X('FireAnimationFrame', 7, 100, t(96500), 4000);
    // GPU 任务远离窗(不参与)
    X('GPUTask', 8, 200, t(90000), 1000);
    const f = path.join(dir, 'drop-fixture.json');
    fs.writeFileSync(f, JSON.stringify({ traceEvents: ev }));
    return f;
  }
  it('四分类:tick-hole(主闲GPU闲)/slow-frame(前帧体≥60%)/mixed;渲染帧距直方图+rAF 洞', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-drop-'));
    try {
      const d = await digestTrace(dropFixture(dir), {});
      const dw = d.dropWindows;
      expect(dw.renders).toBe(9);   // 9 发渲染帧(4 稳拍+5 场景)
      expect(dw.windows.length).toBe(3);
      const v = Object.fromEntries(dw.windows.map((w) => [w.verdict, w]));
      expect(v['tick-hole']).toBeTruthy();   // 22ms 窗,主忙 0 GPU 忙 0
      expect(v['tick-hole'].gapMs).toBe(22);
      expect(v['tick-hole'].mainBusyMs).toBe(0);
      expect(v['slow-frame']).toBeTruthy();  // 18ms 窗,前帧体 15ms
      expect(v['slow-frame'].prevFrameMs).toBe(15);
      expect(v.mixed).toBeTruthy();          // 15ms 窗,主忙 8ms(前帧体 4ms<60%)
      expect(v.mixed.mainBusyMs).toBe(8);
      // 渲染帧距直方图:8.3ms×5 正常拍
      expect(dw.gapHist['8.3']).toBe(5);
      // rAF 洞>12ms:22ms 与 18ms 两洞(tick-hole/slow-frame 的回调洞)
      expect(dw.rafHoles12).toBeGreaterThanOrEqual(2);
      expect(dw.maxRafHoleMs).toBe(22);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
});
