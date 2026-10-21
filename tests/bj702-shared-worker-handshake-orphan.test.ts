// ★BJ702（2026-10-21 线上实报「载入一个小世界卡死,刷新后重进又好」）定谳与判别锁。
//
// 根因链（源码锚,日志逐字对勘）：
//   ①外部触发=瞬态网络黑洞:用户 console 三连发 "Uncaught (in promise) NetworkError:
//     Failed to execute 'Cache.put'"（sw.js 裸 put 未 .catch 的三处旧位点:
//     serveAsset / l10n 支 / 资产支——body 流中断时 put 抛 NetworkError）。
//   ②worker 脚本 /assets/worldGen.worker-*.js 经 SW cache-first miss → fetch 挂死
//     （respondWith 永不 settle → 无 onerror）→ 3s 握手 ping 超时。
//   ③旧 ensureWorker 短路 `if (this.worker) return Promise.resolve(this.worker)`:
//     loadFromKey 的 prewarm(genIcons,fire-and-forget) 先 spawn,probe()/loadSave
//     随即拿到【未过 ping 验证】的 worker 投递 saveParse（mainFlow.ts:1078 与
//     :1081/:1095 共享 flowGenClient;probe 误报 true）。
//   ④握手超时路径只 teardown()(terminate)不收账:terminate 不触发 onerror/
//     onmessageerror → saveParse pending 孤儿化 → 40s 静默看门狗点名「读档疑似
//     卡死(最后进度:开始)」→ 用户在 180s 硬超时自愈前刷新（刷新后 worker 脚本
//     已落 SW 缓存/网络恢复 → 秒握手,故「又好了」）。
// 修法四件:件1 killWorker 统一收账(握手/任务超时/onerror 全量 reject);
// 件2 短路只放行已验证 worker(在途=链同一握手 Promise);件3 sw.js 裸 put 补
// .catch;件4 LT109load 打点并入 MK109 门。本文件锁新行为 + 旧码恰红面:
//   · M1(整体回退):主案测试 loadSave 仍 pending/看门狗 40s 误报=红
//   · M2(仅撤件2):saveParse 已投递未验证 worker=红(「从未投递」断言)
//   · M3(仅撤件1):任务超时测试 saveParse 孤儿化+看门狗误报=红
//   · M4(撤件3/件4):结构锁=红
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorldGenClient, WorldGenUnavailable } from '../src/workers/WorldGenClient';
import type { WorldWorkerRequest } from '../src/workers/protocol';

/** 黑洞伪 Worker:线上实报形态——constructor 成功(脚本请求已发出),消息入队但
 *  脚本 fetch 挂死永不执行(无 ready、无 error,terminate 前零回执)。 */
class BlackHoleWorker {
  static instances: BlackHoleWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: WorldWorkerRequest[] = [];
  terminated = false;
  constructor() { BlackHoleWorker.instances.push(this); }
  postMessage(m: WorldWorkerRequest) { this.posted.push(m); }
  terminate() { this.terminated = true; }
}

/** 应答 ping、吞任务的伪 Worker:握手健康、任务挂死（件1 判别面——任务超时孤儿）。
 *  回执走 queueMicrotask(对齐真 worker 消息异步语义)。 */
class PingOnlyWorker extends BlackHoleWorker {
  postMessage(m: WorldWorkerRequest) {
    this.posted.push(m);
    if ((m as { type?: string }).type === 'ping') {
      const id = (m as { id: number }).id;
      queueMicrotask(() => this.onmessage?.({ data: { id, type: 'ready' } }));
    }
  }
}

/** 脚本化伪 Worker（守恒链）:ping→ready、genIcons→icons、saveParse→progress
 *  （error 由 finishSaveParse 手动注入——中途态可断言 hasPendingWork）。 */
let scripted: ScriptedWorker | null = null;
class ScriptedWorker extends BlackHoleWorker {
  constructor() { super(); scripted = this; }
  postMessage(m: WorldWorkerRequest) {
    this.posted.push(m);
    const msg = m as { id: number; type: string };
    if (msg.type === 'ping') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, type: 'ready' } }));
    } else if (msg.type === 'genIcons') {
      queueMicrotask(() => this.onmessage?.({
        data: { id: msg.id, type: 'icons', icons: { rgba: new ArrayBuffer(8), width: 2, height: 2, cols: 2, ids: [1, 2] } },
      }));
    } else if (msg.type === 'saveParse') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, type: 'progress', phase: 'parse', p: 0.3, label: '解析存档' } }));
    }
  }
  finishSaveParse(): void {
    const req = this.posted.find((m) => (m as { type: string }).type === 'saveParse') as { id: number } | undefined;
    if (req) this.onmessage?.({ data: { id: req.id, type: 'error', message: 'bj702-注入错误' } });
  }
}

// ============ ① 主案复现:黑洞握手 3s ============
describe('BJ702 件1+件2 主案复现（黑洞握手:旧码 loadSave 孤儿 180s+40s 看门狗误报）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    BlackHoleWorker.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('握手超时同拍全量收账:genIcons/loadSave 均 WorldGenUnavailable(握手超时),pending 清空,saveParse 从未投递,看门狗零误报', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('Worker', BlackHoleWorker);
    const client = new WorldGenClient();
    // mainFlow.loadFromKey:1078/1095 同款交错——prewarm(genIcons)先发 spawn,loadSave 复用
    const iconsGuard = client.genIcons({ timeoutMs: 30_000 }).catch((e) => e);
    const progressCb = vi.fn();
    const loadGuard = client.loadSave({ json: '{"format":1}' }, { onProgress: progressCb }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3_000);       // 握手窗到点(旧码:仅 ping 收账,saveParse 孤儿)
    const e1 = await iconsGuard;
    const e2 = await loadGuard;
    expect(e1).toBeInstanceOf(WorldGenUnavailable);
    expect((e1 as Error).message).toContain('握手超时');   // = 实报 [assetPrewarm] 预热失败日志
    expect(e2).toBeInstanceOf(WorldGenUnavailable);        // 旧码(M1/M3):此刻仍 pending=红
    expect((e2 as Error).message).toContain('握手超时');
    expect(client.hasPendingWork()).toBe(false);           // 全量收账(旧码:saveParse 在册=红)
    expect(BlackHoleWorker.instances).toHaveLength(1);
    expect(BlackHoleWorker.instances[0].terminated).toBe(true);   // 机制保留:超时仍 terminate
    // 件2:saveParse 从未投递给未验证 worker(旧短路 M2:已投递=红)
    expect(BlackHoleWorker.instances[0].posted.filter((m) => (m as { type: string }).type === 'saveParse')).toHaveLength(0);
    // 旧码:40s 静默看门狗点名「读档疑似卡死(最后进度:开始)」=用户看到的卡死
    await vi.advanceTimersByTimeAsync(197_000);
    expect(errSpy).toHaveBeenCalledTimes(0);
    expect(progressCb).not.toHaveBeenCalled();
  });

  it('件2:黑洞握手期 probe() 不再短路误报——两连发后 false(旧码:立即 true;★BJ703-E 件2b 后 probe 单发变两发,3s+3s)', async () => {
    vi.stubGlobal('Worker', BlackHoleWorker);
    const client = new WorldGenClient();
    const iconsGuard = client.genIcons({ timeoutMs: 30_000 }).catch((e) => e);   // spawn 发起者(模拟 prewarm 先发)
    const probeGuard = client.probe();
    // 第一发:probe 经件2 链到 genIcons 的同一在途握手(不误报 true),3s 超时同拍双拒
    await vi.advanceTimersByTimeAsync(3_000);
    // 第二发(BJ703-E 件2b 快重试):独立 spawn,再 3s——持续黑洞两连败才落 false
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(probeGuard).resolves.toBe(false);        // 旧码:resolve(true)=红
    const e1 = await iconsGuard;
    expect(e1).toBeInstanceOf(WorldGenUnavailable);
    expect((e1 as Error).message).toContain('握手超时');
    expect(BlackHoleWorker.instances).toHaveLength(2);    // genIcons spawn + probe 快重试 spawn
  });
});

// ============ ② 件1 判别面:健康握手 + 任务超时的共飞孤儿 ============
describe('BJ702 件1 任务超时收账（健康握手后 genIcons 30s 超时:旧码排队 saveParse 孤儿化）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    BlackHoleWorker.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('genIcons 30s 任务超时 → killWorker 连带 reject 在途 saveParse(旧码:孤儿等 180s+看门狗 40s 误报)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('Worker', PingOnlyWorker);
    const client = new WorldGenClient();
    const iconsGuard = client.genIcons({ timeoutMs: 30_000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);          // ping→ready(握手健康)
    const loadGuard = client.loadSave({ json: '{"format":1}' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);           // saveParse 投递+看门狗装配
    expect(client.hasPendingWork()).toBe(true);     // 两作业在途(genIcons+saveParse)
    await vi.advanceTimersByTimeAsync(30_000);      // genIcons 任务硬超时
    const e1 = await iconsGuard;
    const e2 = await loadGuard;
    expect((e1 as Error).message).toContain('图标生成超时');
    expect(e2).toBeInstanceOf(WorldGenUnavailable); // 旧码(M1/M3):孤儿仍 pending=红
    expect(client.hasPendingWork()).toBe(false);
    await vi.advanceTimersByTimeAsync(200_000);     // 旧码:40s 看门狗点名「读档疑似卡死」
    expect(errSpy).toHaveBeenCalledTimes(0);
  });
});

// ============ ③ 守恒链:健康路径零回归 ============
describe('BJ702 守恒（健康握手/genIcons/saveParse 路由与 probe=true 语义不变）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    BlackHoleWorker.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('握手→probe true→genIcons 图标回传→saveParse progress 路由+error reject+pending 清空', async () => {
    vi.stubGlobal('Worker', ScriptedWorker);
    const client = new WorldGenClient();
    const probeP = client.probe();
    await vi.advanceTimersByTimeAsync(10);
    await expect(probeP).resolves.toBe(true);
    const icons = await client.genIcons({ timeoutMs: 30_000 });
    expect(icons.width).toBe(2);
    expect(icons.ids).toEqual([1, 2]);
    const progressCb = vi.fn();
    const loadGuard = client.loadSave({ json: '{"format":1}' }, { onProgress: progressCb }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);          // progress 事件回达
    expect(client.hasPendingWork()).toBe(true);     // saveParse 在途
    // ★件5 契约锁:onEvent 以 (phase,label,p,local) 4 参回调——消费方(mainFlow/
    //  Game)必须按位解构;旧 mainFlow 双参 lambda (phase,p) 把 label 绑给 p=
    //  Number.isFinite(字符串) false → 读档进度条全程钉 0%。
    expect(progressCb).toHaveBeenCalledWith('parse', '解析存档', 0.3, undefined);
    scripted!.finishSaveParse();                    // error 事件注入
    const e = await loadGuard;
    expect((e as Error).message).toContain('bj702-注入错误');   // onEvent error 路由不变
    expect(client.hasPendingWork()).toBe(false);
  });
});

// ============ ④ 件3/件4 结构锁 ============
describe('BJ702 件3/件4 结构锁', () => {
  it('件3:sw.js fire-and-forget cache.put 全 .catch 吸收（三发 NetworkError unhandled rejection 噪声源封堵）', () => {
    const src = readFileSync(resolve(__dirname, '../public/sw.js'), 'utf8');
    expect((src.match(/cache\.put\(req, res\.clone\(\)\);/g) ?? []).length).toBe(0);              // 裸 put 恒 0(M4:回退任一处=红)
    expect((src.match(/cache\.put\(req, res\.clone\(\)\)\.catch/g) ?? []).length).toBeGreaterThanOrEqual(5);   // shell/doc+serveAsset/l10n/资产(资产两分支已并一,裸 put 恒 0 不变量为本锁主判据)
  });

  it('件4:LivingTreePass LT109load 打点并入 MK109 门（生产页 process 伪存在不再必然打印）', () => {
    const src = readFileSync(resolve(__dirname, '../src/world/gen/vanilla/LivingTreePass.ts'), 'utf8');
    expect(src).toContain('if (MK109 && typeof process !== \'undefined\') console.log(`[LT109load]');
    expect(src).not.toMatch(/if \(typeof process !== 'undefined'\) console\.log/);               // 旧裸门恒 0(M4=红)
  });

  it('件5:mainFlow 两处读档 onProgress 按 4 参契约解构（旧双参把 label 绑给 p=进度条钉 0%）', () => {
    const src = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8');
    expect((src.match(/onProgress: \(phase, _label, p\) => loadState\.setProgress\(loadProgressLabel\(phase, p\), p\)/g) ?? []).length).toBe(2);   // loadFromKey+loadFromJson 双位点
    expect(src).not.toMatch(/onProgress: \(phase, p\) => loadState\.setProgress/);               // 旧双参形态恒 0(M5=红)
  });
});
