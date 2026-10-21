// ★BJ331（2026-09-24）判别面四件：
// ① 错误环 stack 取帧行（stackFrameSummary）——主案（打包态 drawNotificationIcon
//    自由引用 amount=中间态部署伪影）的事故栈曾只剩 "X is not defined" 一行无从
//    定位,被迫线下拉线上 bundle 逐字节比对。锁帧提取语义防复发。
// ② WorldGenClient 静默看门狗:每段静默只报一次(re-arm)+超时路径清 stallTimer
//    （曾泄漏 ⇒ 超时回退同步生成+进世界游玩后仍每 10s 报「已 Xs 无进展」到 199s+
//    ——用户 debug report err[7..10] 与主案崩溃同窗的实锤形态）。
// ③ 生成硬超时按世界面积缩放（4200×1200 基准 180s,大世界 8400×2400=720s 封顶）
//    ——健康慢机生成不再被 180s 硬超时杀死后落主线程同步从头重做一遍。
// ④ Speleothems(cs:22231-22237)/Pots(cs:18215) 补 vanilla progress.Set 接线:
//    大世界重 pass 不再整段静默被误报「疑似卡死」;进度旁路面零 RNG 扰动
//    （同种子 gp 有/无对拍 store 全等——反伪影:插桩中立性自证）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RNG } from '../src/core/rng';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GenState } from '../src/world/gen/vanilla/GenState';
import type { GenProgress } from '../src/world/gen/GenProgress';
import type { GenConfigDTO } from '../src/workers/protocol';
import { TileStore } from '../src/world/TileStore';
import { runGemTreesPass } from '../src/world/gen/vanilla/GemPasses';
import { runPotsPass } from '../src/world/gen/vanilla/PotsPass';
import { WorldGenClient, WorldGenUnavailable, worldGenTimeoutMs } from '../src/workers/WorldGenClient';
import { stackFrameSummary } from '../src/debug/DebugReport';

// ============ ① stackFrameSummary（错误环取帧行） ============
describe('BJ331 stackFrameSummary', () => {
  it('多行栈:丢消息行(与 msg 字段重复),保前 4 帧行', () => {
    const stack = [
      'ReferenceError: amount is not defined',
      '    at eT (index-BUfXvSoC.js:1:7945123)',
      '    at Se (index-BUfXvSoC.js:1:7930000)',
      '    at draw (index-BUfXvSoC.js:1:7900000)',
      '    at frame (index-BUfXvSoC.js:1:800)',
      '    at rAF (index-BUfXvSoC.js:1:100)',
    ].join('\n');
    const out = stackFrameSummary(stack)!;
    expect(out).not.toContain('amount is not defined');   // 消息行不再占位
    expect(out).toContain('7945123');                     // 首帧在（定位 bundle 字节位的关键）
    expect(out.split('\n').length).toBe(4);               // 恰 4 帧
    expect(out.length).toBeLessThanOrEqual(300);          // 预算不变(300B/条)
  });

  it('超长帧在 300B 截断;单行栈(无帧,极端环境)原样保留', () => {
    const long = 'Error: x\n' + Array.from({ length: 40 }, (_, i) => `    at f${i} (${'a'.repeat(100)}:${i})`).join('\n');
    expect(stackFrameSummary(long)!.length).toBe(300);
    expect(stackFrameSummary('ReferenceError: amount is not defined')).toBe('ReferenceError: amount is not defined');
  });

  it('null/undefined/空串/纯空白 → null', () => {
    expect(stackFrameSummary(null)).toBeNull();
    expect(stackFrameSummary(undefined)).toBeNull();
    expect(stackFrameSummary('')).toBeNull();
    expect(stackFrameSummary('\n  \n')).toBeNull();
  });
});

// ============ ② WorldGenClient 静默看门狗 ============
describe('BJ331 WorldGenClient 静默看门狗', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** 伪 worker 桥（BJ223 同族）:不 spawn 真 worker,捕获 postMessage 的 id 供事件回注 */
  function clientWithFakeWorker() {
    const client = new WorldGenClient();
    let lastId = 0;
    (client as unknown as { worker: unknown }).worker = {
      postMessage: (m: { id: number }) => { lastId = m.id; },
      terminate: () => {},
    };
    const inject = (ev: Record<string, unknown>) =>
      (client as unknown as { onEvent: (e: unknown) => void }).onEvent({ id: lastId, ...ev });
    return { client, inject };
  }

  const CFG_LARGE = { width: 8400, height: 2400, seedText: 'bj331' } as GenConfigDTO;

  // ★BJ341 件4①重钉（2026-09-25）：旧钉 45s 场景先走 30s 告警窗——stallWarned 被
  //  告警锁存为 true 后,泄漏 interval 拿冻结 lastEventAt 只会命中 `if (stallWarned)
  //  return` 早退=【零增量】,摘 clear（变异 G）照样满绿=无判别力。改 20s 短超时：
  //  reject 先于告警窗（stallWarned 恒 false）→ 泄漏 interval 在静默 >30s（t=40s
  //  检查点）必报一次「生成疑似卡死」= 变异 G 证红。
  it('超时路径清 stallTimer:20s 短超时（30s 告警窗内 reject）后不再有「生成疑似卡死」告警', async () => {
    const { client } = clientWithFakeWorker();
    const genP = client.generate(CFG_LARGE, { timeoutMs: 20_000 });
    const guard = genP.catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);      // 20s 硬超时 → reject（未进告警窗）
    await guard.then((e) => expect((e as Error).message).toContain('生成超时'));
    expect(client.hasPendingWork()).toBe(false);
    expect(errSpy).toHaveBeenCalledTimes(0);        // 告警窗未触达
    await vi.advanceTimersByTimeAsync(120_000);     // 旧实现:泄漏 interval 静默>30s 起报
    expect(errSpy).toHaveBeenCalledTimes(0);        // 修后:0（变异 G 在此报 1 次=红）
  });

  // ★BJ341 件3：onFatal（worker onerror/messageerror）全量 reject 臂的 stallTimer
  //  清理——arm/clear 配对矩阵唯一缺口。generate 的内联看门狗闭包直捕 pend（非
  //  getPend() map 解析）,onFatal 原只清 p.timer ⇒ pending.clear() 后 interval 仍
  //  每 10s 拿冻结 lastEventAt 判静默,30s 起刷「生成疑似卡死」直到页面刷新。
  it('onFatal 同步清 stallTimer:worker 故障 reject 后不再有「生成疑似卡死」告警', async () => {
    const { client } = clientWithFakeWorker();
    const genP = client.generate(CFG_LARGE, { timeoutMs: 600_000 });
    const guard = genP.catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);           // pending 装配微任务
    // ★BJ704-R6 P1 签名随迁：onFatal(source, mayBeLoadPhase)——传夹具伪实例+运行期
    //  形态（作业在途=握手已过,handshake=null → 硬故障『worker 故障』消息不变）
    const fw = (client as unknown as { worker: { postMessage(m: { id: number }): void; terminate(): void } }).worker;
    (client as unknown as { onFatal(s: unknown, l: boolean): void }).onFatal(fw, false);   // worker 级故障全量 reject
    await guard.then((e) => expect((e as Error).message).toContain('worker 故障'));
    expect(client.hasPendingWork()).toBe(false);
    await vi.advanceTimersByTimeAsync(40_000);      // 故障后静默 40s>30s
    expect(errSpy).toHaveBeenCalledTimes(0);        // 修后:0（摘 clearInterval 变异:报 1 次=红）
  });

  it('每段静默只报一次;进度事件后再静默 re-arm 重报（gate 语义）', async () => {
    const { client, inject } = clientWithFakeWorker();
    const genP = client.generate(CFG_LARGE, { timeoutMs: 600_000 });
    const guard = genP.catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);           // pending 装配微任务
    await vi.advanceTimersByTimeAsync(40_000);      // 静默段 1
    expect(errSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);      // 仍在同段静默 → 不刷屏
    expect(errSpy).toHaveBeenCalledTimes(1);
    inject({ type: 'progress', phase: 'generate', label: 'WorldGeneration.Speleothems', p: 0.5, local: 0.1 });
    await vi.advanceTimersByTimeAsync(40_000);      // 新一段静默 → re-arm 后再报
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(String(errSpy.mock.calls[1][0])).toContain('WorldGeneration.Speleothems');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(errSpy).toHaveBeenCalledTimes(2);
    void guard;   // 在途作业不收尾(600s 超时未到)——guard 已挂 catch,防 unhandled rejection
  });

  it('缺省超时按世界面积缩放:大世界 720s 内不被 180s 旧默认误杀', async () => {
    const { client } = clientWithFakeWorker();
    const genP = client.generate(CFG_LARGE);        // 无 timeoutMs → worldGenTimeoutMs(8400,2400)=720s
    const guard = genP.catch((e) => e);
    await vi.advanceTimersByTimeAsync(180_000);     // 旧默认早已 reject 的时点
    expect(client.hasPendingWork()).toBe(true);     // 仍在途（健康慢机生成不被杀）
    await vi.advanceTimersByTimeAsync(540_000);     // 720s 硬超时才收
    await guard.then((e) => {
      expect(e).toBeInstanceOf(WorldGenUnavailable);
      expect((e as Error).message).toContain('生成超时');
    });
  });
});

// ============ ③ worldGenTimeoutMs（面积缩放纯函数） ============
describe('BJ331 worldGenTimeoutMs', () => {
  it('小世界=基准 180s;中/大线性放大;双侧 clamp [1,4]×', () => {
    expect(worldGenTimeoutMs(4200, 1200)).toBe(180_000);    // 基准面
    expect(worldGenTimeoutMs(6400, 1800)).toBe(411_429);    // ×2.2857
    expect(worldGenTimeoutMs(8400, 2400)).toBe(720_000);    // ×4（恰达封顶）
    expect(worldGenTimeoutMs(2100, 600)).toBe(180_000);     // 面积 ¼ → clamp 下限
    expect(worldGenTimeoutMs(16800, 4800)).toBe(720_000);   // 面积 16× → clamp 上限
  });
});

// ============ ④ Speleothems/Pots progress.Set 接线 + 插桩中立性 ============
const CHANNELS = ['type', 'flags', 'wall', 'liquid', 'liquidType', 'frameX', 'frameY', 'slope', 'half', 'coat'] as const;

function assertStoresEqual(a: TileStore, b: TileStore): void {
  for (const k of CHANNELS) {
    const av = (a as unknown as Record<string, ArrayLike<number>>)[k];
    const bv = (b as unknown as Record<string, ArrayLike<number>>)[k];
    expect(av.length).toBe(bv.length);
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) throw new Error(`插桩扰动 RNG/写入面:${k}[${i}] ${av[i]} ≠ ${bv[i]}`);
    }
  }
}

function makeWorld(w: number, h: number): { st: TileStore; gs: GenState } {
  const st = new TileStore(w, h);
  for (let x = 0; x < w; x++) {
    for (let y = 60; y < h; y++) st.setTileSilent(x, y, TILE_BY_KEY['stone']!);
    st.setTileSilent(x, 60, 0);
  }
  const gs = {
    worldSurface: 60, worldSurfaceLow: 40, worldSurfaceHigh: 50, rockLevel: 120,
    lavaLine: h - 100, beachDistance: 0,
    seedFlags: {},
  } as unknown as GenState;
  return { st, gs };
}

function makeGpSpy(): { gp: GenProgress; calls: number[] } {
  const calls: number[] = [];
  return { gp: { set: (v: number) => calls.push(v) } as unknown as GenProgress, calls };
}

describe('BJ331 Speleothems progress 接线（vanilla cs:22231-22237）', () => {
  it('pass 头 Set(0) + 逐列 Set(x/(w-20)),严格递增到末列', () => {
    const { st, gs } = makeWorld(400, 250);
    const { gp, calls } = makeGpSpy();
    runGemTreesPass(st, new RNG(3), gs, gp);
    expect(calls[0]).toBe(0);                                    // cs:22232 Set(0.0)
    expect(calls.length).toBe(1 + 360);                          // 每列一发:x=20..379
    expect(calls[1]).toBeCloseTo(20 / 380, 12);                  // cs:22235 Set(i/num)
    expect(calls[calls.length - 1]).toBeCloseTo(379 / 380, 12);
    for (let i = 2; i < calls.length; i++) expect(calls[i]).toBeGreaterThan(calls[i - 1]!);
  });

  it('插桩中立:同种子 gp 有/无对拍 store 十通道全等', () => {
    const a = makeWorld(400, 250), b = makeWorld(400, 250);
    const { gp } = makeGpSpy();
    runGemTreesPass(a.st, new RNG(3), a.gs);
    runGemTreesPass(b.st, new RNG(3), b.gs, gp);
    assertStoresEqual(a.st, b.st);
  });
});

describe('BJ331 Pots progress 接线（vanilla cs:18215-18218）', () => {
  it('逐尝试 Set(n/count),严格递增;末值=(count-1)/count', () => {
    const { st, gs } = makeWorld(420, 220);
    const { gp, calls } = makeGpSpy();
    runPotsPass(st, new RNG(7), gs, gp);
    const count = Math.floor(420 * 220 * 0.0008);
    expect(calls.length).toBe(count);
    expect(calls[0]).toBe(0);
    expect(calls[count - 1]).toBeCloseTo((count - 1) / count, 12);
    for (let i = 1; i < calls.length; i++) expect(calls[i]).toBeGreaterThan(calls[i - 1]!);
  });

  it('插桩中立:同种子 gp 有/无对拍 store 十通道全等', () => {
    const a = makeWorld(420, 220), b = makeWorld(420, 220);
    const { gp } = makeGpSpy();
    runPotsPass(a.st, new RNG(7), a.gs);
    runPotsPass(b.st, new RNG(7), b.gs, gp);
    assertStoresEqual(a.st, b.st);
  });
});

// ============ 结构锁:管线槽 → pass 的 prog 接线防丢失（本刀唯一的接线跳,3 行） ============
describe('BJ331 结构锁（prog 接线）', () => {
  const codeOf = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  it('speleothemSlot/potPass 把 GenCtx.prog 传入 runGemTreesPass/runPotsPass', () => {
    const s = codeOf('../src/world/gen/WorldGen.ts');
    expect(s).toContain('function speleothemSlot({ store, rng, prog }: GenCtx)');
    expect(s).toContain('runGemTreesPass(store, rng, gs, prog)');
    expect(s).toContain('function potPass({ store, rng, world, prog }: GenCtx)');
    expect(s).toContain('runPotsPass(store, rng, gs, prog)');
  });
});
