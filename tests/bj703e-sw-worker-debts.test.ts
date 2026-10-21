// ★BJ703-E（2026-10-21）BJ702 登记债全面清算·SW/worker 网络韧性域。
//
// 五件判语（先定谳再动刀,源码锚见 memory/bj703e-sw-worker-debts.md）：
//   件1（D1 修）：probe() 瞬态失败粘滞缓存——旧 `if (this.probed !== null) return
//     this.probed` 把一次瞬态握手超时的 false 缓存到页面会话结束，三门
//     （mainFlow.loadFromKey:1081 / loadFromJson:1214 / Game.newWorld genClient）
//     恒走主线程降级不回升。修=瞬态失败不粘滞 + 30s 退避窗（防持续离线重试风暴）
//     + 过窗重付 spawn（回升通道）。
//   件2a（D2 修,sw.js）：shell 支 fetch 无超时无重试——黑洞窗挂死只能干等调用方
//     自身超时（BJ702 根因②fetch 面;用户正面诉求「瞬断不会重试吗」）。修=
//     fetchShell 包装（8s AbortController 超时+单次重试,仅网络层失败才重试），
//     字节面最小：只动 shell 支网络路径,缓存策略结构零变化。
//   件2b（D2 修,WorldGenClient）：握手窗 3s 对慢网首访偏紧（模块图冷取 >2s 平凡）
//     ——probe 单发变两发（3s+3s 单次快重试,硬故障不重试）,区分瞬断 vs 持续离线。
//   件3（D3 销案）：慢机图标 >30s 超时仍杀共享 worker——无实报面,细粒度调度
//     无法区分「慢而活 vs 挂死」,现行为 fail-safe 有界（BJ702 件1 已保证即时
//     回退）,判语销案留待实报（无代码面,本文件不设行为锁）。
//   件4（D4 修）：src/console.log 误提交杂物（commit 05761037,4MB 运行期 console
//     抓取）删除 + .gitignore 防复发锁。
//   （件5/D5：sw.js 修复随下次发版生效=部署面事实,销案无代码。）
//
// 判别锁矩阵（变异恰红面,逐刀独立）：
//   Mu1 恢复粘滞缓存（`if (this.probed !== null) return this.probed`）→ 件1回升测试红
//   Mu2 撤退避窗 → 件1「窗内零新 spawn」断言红
//   Mu3 撤 probe 快重试（单发）→ 件2b 瞬断恢复测试红（+BJ702 件2 测试红）
//   Mu4 撤 sw.js fetchShell（回退裸 fetch）→ 件2a 结构锁红
//   Mu5 恢复 src/console.log / 撤 .gitignore 条目 → 件4 结构锁红
//   件6（BJ704-R6 P1,2026-10-21 红蓝审查改判）：onerror 双形态分流——HTML 规范下
//     脚本加载快败（离线/部署窗 SW miss 冷取 reject/404,握手在途形态）与专用
//     worker 运行期未捕获异常【同发 error 事件】,旧码一律 workerBroken 粘滞=把
//     BJ702 事故窗的快败孪生形态判死刑,BJ703-E 回升通道被整体旁路。修=握手窗
//     判别（在途=瞬态走快重试+退避;已过=硬故障粘滞,BJ702 语义保留）+迟到事件
//     源守卫（已 terminate 旧实例的 onerror 不连带杀在役 worker）。
//   Mu6 onFatal 回无条件粘滞 → 件6 瞬态恢复/回升测试红
//   Mu7 撤源守卫（回无参 onFatal） → 件6 迟到事件测试红
//   Mu8 onerror 恒判瞬态（撤握手判别） → 件6 运行期粘滞测试红
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorldGenClient } from '../src/workers/WorldGenClient';
import type { WorldWorkerRequest } from '../src/workers/protocol';

/** 可控瞬断伪 Worker：前 failFirst 次 ping 吞掉（=脚本冷取黑洞,无 ready 无 error），
 *  之后应答 ping（=网络恢复,秒握手）;saveParse 以 error 回执收尾（测试可干净落场）。 */
class FlakyWorker {
  static instances: FlakyWorker[] = [];
  static failFirst = 0;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: WorldWorkerRequest[] = [];
  terminated = false;
  constructor() { FlakyWorker.instances.push(this); }
  postMessage(m: WorldWorkerRequest) {
    this.posted.push(m);
    const msg = m as { id: number; type: string };
    if (msg.type === 'ping') {
      if (FlakyWorker.failFirst > 0) { FlakyWorker.failFirst--; return; }   // 黑洞:吞 ping
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, type: 'ready' } }));
    } else if (msg.type === 'saveParse') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, type: 'error', message: 'bj703e-注入错误' } }));
    }
  }
  terminate() { this.terminated = true; }
}

/** BJ704-R6 P1 加载期快败伪 Worker：前 failLoads 次构造后微任务即 onerror
 *  （=脚本 404/网络快败 reject——握手在途形态,瞬态面）;耗尽后正常应答 ping。 */
class LoadFailWorker extends FlakyWorker {
  static failLoads = 0;
  constructor() {
    super();
    if (LoadFailWorker.failLoads > 0) { LoadFailWorker.failLoads--; queueMicrotask(() => this.onerror?.()); }
  }
}

/** BJ704-R6 P1 运行期崩溃伪 Worker：ping 应答（过握手,handshake 置 null）后
 *  下一微任务 onerror——握手已过形态=硬故障粘滞（BJ702 语义保留面）。 */
class CrashAfterHandshakeWorker extends FlakyWorker {
  postMessage(m: WorldWorkerRequest) {
    super.postMessage(m);
    if ((m as { type: string }).type === 'ping') queueMicrotask(() => this.onerror?.());
  }
}

/** BJ704-R6 P1 迟到事件伪 Worker：吞 ping（黑洞挂死）,terminate() 后微任务发
 *  onerror（=terminate 前 fetch 已快败、error 任务已入队的迟到形态）。 */
class LateErrorWorker extends FlakyWorker {
  terminate() { this.terminated = true; queueMicrotask(() => this.onerror?.()); }
}

beforeEach(() => {
  vi.useFakeTimers();
  FlakyWorker.instances = [];
  FlakyWorker.failFirst = 0;
  LoadFailWorker.failLoads = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============ 件1（D1）：瞬态失败不粘滞——退避窗 + 回升通道 ============
describe('BJ703-E 件1：probe 瞬态握手失败不粘滞（旧码一次瞬断=全会话主线程降级）', () => {
  it('两连败落 false → 退避窗内零成本 false（零新 spawn）→ 过窗重付 → 恢复后 probe true 且 loadSave 投递新 worker', async () => {
    vi.stubGlobal('Worker', FlakyWorker);
    FlakyWorker.failFirst = 2;   // probe 尝试1 吞 + 快重试吞;网络恢复后第三发应答
    const client = new WorldGenClient();
    const p1 = client.probe();
    await vi.advanceTimersByTimeAsync(6_000);   // 两连败（3s+3s,件2b 快重试同场）
    await expect(p1).resolves.toBe(false);
    expect(FlakyWorker.instances).toHaveLength(2);   // 旧码 Mu1:probed 缓存路径无此两发差异;Mu3:单发只 1 个
    // 退避窗内：直接 false,零新 spawn（Mu2 撤退避 → 立即第三发 spawn=红）
    const p2 = client.probe();
    await vi.advanceTimersByTimeAsync(0);
    await expect(p2).resolves.toBe(false);
    expect(FlakyWorker.instances).toHaveLength(2);
    // 过窗（30s 退避 + 余量）：重付握手 → 网络已恢复（failFirst 耗尽）→ true
    await vi.advanceTimersByTimeAsync(30_100);
    const p3 = client.probe();
    await vi.advanceTimersByTimeAsync(10);      // ping→ready 微任务
    await expect(p3).resolves.toBe(true);       // Mu1 粘滞:此处恒 false=红（旧码「降级不回升」本体）
    expect(FlakyWorker.instances).toHaveLength(3);
    // 回升通道落地：读档投递给【新验证的】worker（saveParse 只发实例#3,件2 短路语义延续）
    const loadGuard = client.loadSave({ json: '{"format":1}' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(FlakyWorker.instances[2].posted.some((m) => (m as { type: string }).type === 'saveParse')).toBe(true);
    expect(FlakyWorker.instances.slice(0, 2).every((w) => !w.posted.some((m) => (m as { type: string }).type === 'saveParse'))).toBe(true);
    const e = await loadGuard;
    expect((e as Error).message).toContain('bj703e-注入错误');   // FlakyWorker saveParse error 回执收尾
  });

  it('成功粘滞 true 不变：probe true 后再 probe 零新 spawn（守恒——成功路径语义与旧码一致）', async () => {
    vi.stubGlobal('Worker', FlakyWorker);
    FlakyWorker.failFirst = 0;
    const client = new WorldGenClient();
    const p1 = client.probe();
    await vi.advanceTimersByTimeAsync(10);
    await expect(p1).resolves.toBe(true);
    const p2 = client.probe();
    await vi.advanceTimersByTimeAsync(0);
    await expect(p2).resolves.toBe(true);
    expect(FlakyWorker.instances).toHaveLength(1);   // 成功=粘滞,不重付
  });
});

// ============ 件2b（D2）：握手单次快重试——瞬断 vs 持续离线 ============
describe('BJ703-E 件2b：probe 握手超时单次快重试', () => {
  it('瞬断（仅第一发黑洞）：3s 超时 → 快重试秒级恢复 → probe true（Mu3 撤重试=false=红）', async () => {
    vi.stubGlobal('Worker', FlakyWorker);
    FlakyWorker.failFirst = 1;
    const client = new WorldGenClient();
    const p = client.probe();
    await vi.advanceTimersByTimeAsync(3_000);    // 第一发握手超时
    await vi.advanceTimersByTimeAsync(3_100);    // 第二发握手窗+微任务余量
    await expect(p).resolves.toBe(true);        // 旧码（无重试）:false=红——瞬断被误判为持续离线
    expect(FlakyWorker.instances).toHaveLength(2);   // 单次快重试恰好两发,无第三发
  });

  it('硬故障（运行期 onerror,过握手后崩溃）不重试且跨退避窗粘滞 false：probe 零新 spawn', async () => {
    vi.stubGlobal('Worker', CrashAfterHandshakeWorker);
    const client = new WorldGenClient();
    const p1 = client.probe();
    await vi.advanceTimersByTimeAsync(10);       // ready（握手过,handshake=null）→ 崩溃微任务 → onFatal → workerBroken
    await expect(p1).resolves.toBe(true);       // 崩溃前握手已成立=true（崩溃拍在其后）
    const p2 = client.probe();
    await vi.advanceTimersByTimeAsync(0);
    await expect(p2).resolves.toBe(false);      // workerBroken 粘滞（瞬态回升通道不适用）
    expect(CrashAfterHandshakeWorker.instances).toHaveLength(1);   // 零新 spawn
    await vi.advanceTimersByTimeAsync(60_000);   // 过退避窗
    const p3 = client.probe();
    await vi.advanceTimersByTimeAsync(10);
    await expect(p3).resolves.toBe(false);      // 跨窗仍粘滞（Mu8 撤握手判别=运行期崩溃也判瞬态 → 此处 true=红）
    expect(CrashAfterHandshakeWorker.instances).toHaveLength(1);
  });
});

// ============ 件6（BJ704-R6 P1）：onerror 双形态分流 + 迟到事件源守卫 ============
describe('BJ704-R6 P1：加载期快败（握手在途 onerror）=瞬态,运行期崩溃=硬故障', () => {
  it('部署窗快败孪生形态（404/离线 reject）走瞬态通道:快重试恢复 → 粘滞 true（Mu6 回粘滞=红）', async () => {
    vi.stubGlobal('Worker', LoadFailWorker);
    LoadFailWorker.failLoads = 1;   // 首发快败,快重试第二发正常
    const client = new WorldGenClient();
    const p = client.probe();
    await vi.advanceTimersByTimeAsync(10);   // 首发 onerror 微任务 → onFatal（瞬态,不置 workerBroken）→ killWorker 拒握手
    await vi.advanceTimersByTimeAsync(20);   // probe catch → 快重试 spawn#2 → ping→ready
    await expect(p).resolves.toBe(true);    // 旧码:快败=workerBroken 粘滞 → false=红（BJ703-E 回升通道被旁路的本体）
    expect(LoadFailWorker.instances).toHaveLength(2);   // 瞬态=快重试恰两发
  });

  it('持续离线（连快败）:两发落退避窗零成本 false → 过窗网络恢复 → 回升 true（旧码粘滞恒 false=红）', async () => {
    vi.stubGlobal('Worker', LoadFailWorker);
    LoadFailWorker.failLoads = 99;
    const client = new WorldGenClient();
    const p1 = client.probe();
    await vi.advanceTimersByTimeAsync(50);   // 首发+快重试两连败
    await expect(p1).resolves.toBe(false);
    expect(LoadFailWorker.instances).toHaveLength(2);   // 不风暴
    const p2 = client.probe();
    await vi.advanceTimersByTimeAsync(10);
    await expect(p2).resolves.toBe(false);   // 退避窗内零成本
    expect(LoadFailWorker.instances).toHaveLength(2);
    LoadFailWorker.failLoads = 0;            // 网络恢复
    await vi.advanceTimersByTimeAsync(30_100);   // 过窗
    const p3 = client.probe();
    await vi.advanceTimersByTimeAsync(20);
    await expect(p3).resolves.toBe(true);    // 回升通道落地（「刷新即好」不再依赖刷新）
    expect(LoadFailWorker.instances).toHaveLength(3);
  });

  it('迟到 onerror（已 terminate 旧实例）不连带杀在役 worker:worker2 存活过握手（Mu7 撤源守卫=红）', async () => {
    vi.stubGlobal('Worker', LateErrorWorker);
    FlakyWorker.failFirst = 1;   // worker1 吞 ping（黑洞）→ 握手超时被 killWorker terminate
    const client = new WorldGenClient();
    const p = client.probe();
    await vi.advanceTimersByTimeAsync(3_000);   // 握手超时 → killWorker（terminate#1=排迟到 onerror 微任务）
    await vi.advanceTimersByTimeAsync(20);      // 快重试 spawn#2+ping→ready;迟到 onerror 在其间到达（源≠在役=忽略）
    await expect(p).resolves.toBe(true);       // 无守卫=旧 onFatal 杀 worker2+拒 promise2 → false=红
    expect(LateErrorWorker.instances).toHaveLength(2);
    expect(LateErrorWorker.instances[1].terminated).toBe(false);   // worker2 未被连带杀
    expect(LateErrorWorker.instances[0].terminated).toBe(true);    // worker1 照常收场
  });
});

// ============ 件2a（D2）+ 件4（D4）结构锁 ============
describe('BJ703-E 件2a/件4 结构锁', () => {
  it('件2a:sw.js shell 支 fetch 走 fetchShell 包装（8s 超时+单次重试）;裸 put 形态仍恒 0（BJ702 件3 守恒）', () => {
    const src = readFileSync(resolve(__dirname, '../public/sw.js'), 'utf8');
    expect(src).toContain('function fetchShell(req)');
    // ★BJ704-G8 F2 升级（2026-10-21）:1→3——fetchShell 扩到 doc 两支（导航类=超时+
    // 重试;含 2026-09-29 doc 提前后的不可达死支）,语义升级非回归;Mu4 全撤=0 红。
    // ★BJ704-G17 随迁（2026-10-21）:3→2——G17 删除 doc 不可达死支（isDocPath 唯一承载）
    // 与 `?? fetchAsset` 双保险死支;资产类锁见 tests/bj704g8-sw-resilience.test.ts。
    expect((src.match(/await fetchShell\(req\)/g) ?? []).length).toBe(2);
    expect(src).toMatch(/setTimeout\(\(\) => ctl\.abort\(\), 8000\)/);       // ~8s 超时锚
    expect(src).toContain('return attempt().catch(attempt);');              // 单次重试形态（不叠风暴）
    expect(src).toContain("typeof AbortController === 'undefined'");        // 老内核退化门（无 AbortController=原行为）
    // BJ702 件3 守恒复检（本刀不碰 put 面;G17 死支删除连带 put 计数 6→5）：
    expect((src.match(/cache\.put\(req, res\.clone\(\)\);/g) ?? []).length).toBe(0);
    expect((src.match(/cache\.put\(req, res\.clone\(\)\)\.catch/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('件4:src/console.log 已删除 + .gitignore 防复发条目在位', () => {
    expect(existsSync(resolve(__dirname, '../src/console.log'))).toBe(false);   // Mu5 恢复文件=红
    const gi = readFileSync(resolve(__dirname, '../.gitignore'), 'utf8');
    expect(gi).toMatch(/^console\.log$/m);                                     // Mu5 撤条目=红
  });
});
