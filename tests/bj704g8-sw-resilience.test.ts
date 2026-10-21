// ★BJ704-G8（2026-10-21）BJ704-R6 红蓝审查 P2 精选债·SW/worker 韧性域四件清算。
//
// 逐件判语（先定谳再动刀,债源=memory/bj704r6-render-sw-redblue.md P2 全锚）：
//   F2（修,sw.js）：SW 内裸 fetch 全量分级收口——R6 点名 7 处 + 本刀全量普查补齐
//     同族 3 处（真首访直通/主资产 miss 路/warm 单文件——自带重试×3 但无超时,黑洞=
//     单 lane 永挂+warm running 恒真堵死重入）+ 防御死支一并收口。域分级:
//     导航类（doc 一处;★BJ704-G17 已删 2026-09-29 doc 提前后的不可达死支与 ??
//     双保险死支）=fetchShell（8s 超时+
//     单次重试,挂死整页风险最高）;资产类（其余全部）=fetchAsset（8s 超时兜底单发
//     不重试——消费方自有 onerror 退避链/warm 轮询,SW 级重试在黑洞窗放大请求数）。
//     字节面最小:只换调用点+新增包装,缓存策略结构零变化。
//   F3（修,纯注释）:probe() 注释「最坏多付 3s」与两发（3s+3s）实况不符——勘正 6s。
//   F4（修,WorldGenClient）:terminate() 收编 killWorker 同源（旧公开方法旁路收账=
//     在途作业孤儿到 180s 的 BJ702 件1 暗门;现三调用面无在途窗=行为不变,结构收口）
//     + ensureWorker 头补 workerBroken 早退（broken 后 generate/loadSave/abortGen
//     不再白 spawn——abortGen 只为发一条 abort 消息也 spawn 一发）。
//   F5（修,WorldGenClient）:killWorker 级联消息归属——触发者作业（triggerId）保原
//     err 原样;共飞作业按自身标签（lastLabel）生成消息（旧码全表共用触发者消息:
//     genIcons 超时杀共享 worker 时在途 saveParse 报「图标生成超时」——类型正确
//     诊断面误导）。类型恒 WorldGenUnavailable（消费面 instanceof→fallback 不变）,
//     新消息内嵌触发原因（既有 toContain 断言/日志兼容）。
//
// 判别锁矩阵（变异恰红面）：
//   MuG1 撤 fetchAsset（回裸 fetch） → F2 结构计数红 + 资产挂死用例永挂红
//   MuG2 doc 撤 fetchShell（回裸 fetch） → doc 挂死 16s 有界断言红（永挂）
//   MuG3 fetchAsset 误加重试 → 资产瞬断用例「恰 1 发」断言红
//   MuG4 terminate 回裸 teardown → F4a 在途作业 PENDING 红
//   MuG5 ensureWorker 撤 broken 早退 → F4b 白 spawn 计数红
//   MuG6 killWorker 回全表共用 err → F5a「e2 ≠ 触发者消息」断言红
//   MuG7 撤 triggerId（全共飞） → F5a「e1 原样全等」断言红
//   MuG8 注释回「多付 3s」 → F3 结构锁红
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { WorldGenClient, WorldGenUnavailable } from '../src/workers/WorldGenClient';
import type { WorldWorkerRequest } from '../src/workers/protocol';

const SW_PATH = resolve(__dirname, '../public/sw.js');
const WGC_PATH = resolve(__dirname, '../src/workers/WorldGenClient.ts');

// ============================================================================
// F2 行为面:sw.js 于 vm 中求值,受控网络 stub（挂死/瞬断/404/计数）逐分支驱动
// ============================================================================
type FetchAction = 'hang' | 'reject' | { status: number; body?: string; headers?: Record<string, string> };

/** 可编程 fetch stub:url+第 N 发 → 动作;signal 监听 abort（超时路径的 reject 源） */
function makeFetch(script: (url: string, attempt: number) => FetchAction) {
  const calls: string[] = [];
  const perUrl = new Map<string, number>();
  const fn = (req: Request | string, opts?: { signal?: AbortSignal }) => {
    const url = typeof req === 'string' ? req : req.url;
    const n = (perUrl.get(url) ?? 0) + 1;
    perUrl.set(url, n);
    calls.push(url);
    const action = script(url, n);
    if (action === 'hang') {
      return new Promise<Response>((_, rej) => {
        if (opts?.signal) opts.signal.addEventListener('abort', () => rej(new TypeError('Failed to fetch')));
      });
    }
    if (action === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(action.body ?? '', { status: action.status, headers: action.headers }));
  };
  return { fn, calls, count: (frag: string) => calls.filter((u) => u.includes(frag)).length };
}

/** 内存 CacheStorage stub:match/put/keys/delete;可预置缓存名（recoverVersion 判据） */
function makeCaches(names: string[] = []) {
  const cachesMap = new Map<string, {
    match: (req: Request | string) => Promise<Response | null>;
    put: (req: Request | string, res: Response) => Promise<void>;
    keys: () => Promise<{ url: string }[]>;
    delete: (req: Request | string) => Promise<boolean>;
  }>();
  for (const name of names) cachesMap.set(name, makeCache());
  function makeCache() {
    const m = new Map<string, Response>();
    const key = (req: Request | string) => (typeof req === 'string' ? req : new URL(req.url).pathname);
    return {
      match: async (req: Request | string) => m.get(key(req)) ?? null,
      put: async (req: Request | string, res: Response) => { m.set(key(req), res); },
      keys: async () => [...m.keys()].map((k) => ({ url: 'http://localhost' + (k.startsWith('/') ? k : '/' + k) })),
      delete: async (req: Request | string) => m.delete(key(req)),
    };
  }
  return {
    open: async (name: string) => cachesMap.get(name) ?? (cachesMap.set(name, makeCache()), cachesMap.get(name)!),
    keys: async () => [...cachesMap.keys()],
    delete: async (name: string) => cachesMap.delete(name),
    _map: cachesMap,
  };
}

/** vm 求值 sw.js:捕获 fetch/message 事件 handler,返回驱动器 */
function loadSw(fetchStub: ReturnType<typeof makeFetch>, cachesStub: ReturnType<typeof makeCaches>) {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const pages: { postMessage: (m: unknown) => void }[] = [];
  const posted: unknown[] = [];
  pages.push({ postMessage: (m) => posted.push(m) });
  const ctx: Record<string, unknown> = {
    console: { log: () => {}, error: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    caches: cachesStub,
    fetch: fetchStub.fn,
    Request, Response, AbortController, URL, TextDecoder, Blob, DecompressionStream,
  };
  ctx.self = ctx;
  ctx.addEventListener = (type: string, h: (e: unknown) => void) => { (listeners[type] ??= []).push(h); };
  ctx.clients = { matchAll: async () => pages };
  ctx.skipWaiting = () => {};
  vm.createContext(ctx);
  new vm.Script(readFileSync(SW_PATH, 'utf8'), { filename: 'sw.js' }).runInContext(ctx as vm.Context);
  return {
    /** 驱动一次 SW fetch 事件,返回 respondWith 收到的 promise（未 respondWith=undefined） */
    fire(req: Request): Promise<Response> | undefined {
      let respondP: Promise<Response> | undefined;
      for (const h of listeners.fetch ?? []) {
        h({
          request: req,
          respondWith: (p: Promise<Response>) => { respondP = p; },
          waitUntil: () => {},
        });
      }
      return respondP;
    },
    /** 发一条 message 事件（init 设版本 / warm 驱动后台下载）,返回 waitUntil 收到的 promise */
    message(data: Record<string, unknown>): Promise<unknown> | undefined {
      let until: Promise<unknown> | undefined;
      for (const h of listeners.message ?? []) {
        h({ data, waitUntil: (p: Promise<unknown>) => { until = p; } });
      }
      return until;
    },
    posted,
  };
}

describe('BJ704-G8 F2:sw.js fetch 域分级收口（vm 行为面）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('导航类 doc:瞬断（第一发 reject）→ fetchShell 单次重试放行 → 200 回源应答（恰 2 发）', async () => {
    const fetchStub = makeFetch((url, n) =>
      url.includes('/doc.html') ? (n === 1 ? 'reject' : { status: 200, body: 'ok' }) : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toMatchObject({ status: 200 });   // MuG2 回裸 fetch:reject 直落离线回退 rethrow=红
    expect(fetchStub.count('/doc.html')).toBe(2);               // 重试恰一发
  });

  it('导航类 doc:挂死两发全 hold → 8s×2 有界终止（16s 前不 settle,16s 后 reject）→ 离线缓存回退', async () => {
    const fetchStub = makeFetch(() => 'hang');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    let settled = false;
    void p.catch(() => {}).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(15_999);
    expect(settled).toBe(false);                                // 旧码（裸 fetch）:此处已永挂——但 8s 内单发也挂,16s 锚锁「两发各 8s」
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);                                 // MuG2:裸 fetch 永挂 → 此处 false=红
    await expect(p).rejects.toBeInstanceOf(Error);              // 无缓存可回退 → rethrow（调用方 onerror 链接管）
    expect(fetchStub.count('/doc.html')).toBe(2);
  });

  it('资产类主路（init 版本已设）:瞬断单发不重试 → catch → 二次 match 回退 → Response.error 兜底（恰 1 发）', async () => {
    const fetchStub = makeFetch((url) => url.includes('/sprites/vanilla/a.png') ? 'reject' : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    sw.message({ type: 'init', version: 'v1' });
    await vi.advanceTimersByTimeAsync(0);
    const p = sw.fire(new Request('http://localhost/sprites/vanilla/a.png'))!;
    const res = await p;
    expect(res.type).toBe('error');                             // Response.error()=既有离线兜底语义
    expect(fetchStub.count('/sprites/vanilla/a.png')).toBe(1);  // MuG3 误加重试:2 发=红
  });

  it('资产类主路:挂死 → 8s 超时兜底单发 → Response.error（MuG1 回裸 fetch:永挂=红）', async () => {
    const fetchStub = makeFetch((url) => url.includes('/sprites/vanilla/b.png') ? 'hang' : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    sw.message({ type: 'init', version: 'v1' });
    await vi.advanceTimersByTimeAsync(0);
    const p = sw.fire(new Request('http://localhost/sprites/vanilla/b.png'))!;
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe(false);                                // 超时窗内不 settle
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);                                 // MuG1:裸 fetch 永挂 → false=红
    expect(fetchStub.count('/sprites/vanilla/b.png')).toBe(1);  // 单发（8s×1,非 shell 的 ×2）
  });

  it('资产类 404:明确应答直通不重试不缓存（恰 1 发,守恒 BJ703-E「404 不重试」语义）', async () => {
    const fetchStub = makeFetch((url) => url.includes('/sprites/vanilla/c.png') ? { status: 404 } : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    sw.message({ type: 'init', version: 'v1' });
    await vi.advanceTimersByTimeAsync(0);
    const p = sw.fire(new Request('http://localhost/sprites/vanilla/c.png'))!;
    const res = await p;
    expect(res.status).toBe(404);
    expect(fetchStub.count('/sprites/vanilla/c.png')).toBe(1);
  });

  it('恢复窗 serveAsset（SW 重启,currentVersion 丢失→caches.keys 恢复）:瞬断单发 → Response.error（恰 1 发）', async () => {
    const fetchStub = makeFetch((url) => url.includes('/sprites/vanilla/r.png') ? 'reject' : 'reject');
    const sw = loadSw(fetchStub, makeCaches(['sw-assets-vrec']));   // 唯一版本缓存名 → recoverVersion 恢复
    const p = sw.fire(new Request('http://localhost/sprites/vanilla/r.png'))!;
    const res = await p;
    expect(res.type).toBe('error');
    expect(fetchStub.count('/sprites/vanilla/r.png')).toBe(1);
  });

  it('l10n 支:瞬断单发 → catch → 离线缓存回退 miss → rethrow（恰 1 发）', async () => {
    const fetchStub = makeFetch((url) => url.includes('/l10n/') ? 'reject' : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    sw.message({ type: 'init', version: 'v1' });
    await vi.advanceTimersByTimeAsync(0);
    const p = sw.fire(new Request('http://localhost/l10n/zh-Hans.json'))!;
    await expect(p).rejects.toBeInstanceOf(Error);              // 无缓存回退 → rethrow（消费方下次 init 重试）
    expect(fetchStub.count('/l10n/')).toBe(1);
  });

  it('mods 支:瞬断单发 → 直通 reject（恰 1 发）', async () => {
    const fetchStub = makeFetch((url) => url.includes('/sprites/mods/') ? 'reject' : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/sprites/mods/m.png'))!;
    await expect(p).rejects.toBeInstanceOf(Error);
    expect(fetchStub.count('/sprites/mods/')).toBe(1);
  });

  it('zip 分片链:资产本体 404 → manifest 回源 200 → part 瞬断 throw → zip 提取失败落 404 兜底（part 恰 1 发不重试）', async () => {
    const fetchStub = makeFetch((url) => {
      if (url.includes('/sprites/vanilla/z.png')) return { status: 404 };
      if (url.includes('assets-zip/manifest.json')) {
        return { status: 200, body: JSON.stringify({ parts: [{ file: 'p0.zip', entries: ['/sprites/vanilla/z.png'] }] }), headers: { 'content-type': 'application/json' } };
      }
      if (url.includes('assets-zip/p0.zip')) return 'reject';   // part 瞬断
      return 'reject';
    });
    const sw = loadSw(fetchStub, makeCaches(['sw-assets-vzip']));
    const p = sw.fire(new Request('http://localhost/sprites/vanilla/z.png'))!;
    const res = await p;
    expect(res.status).toBe(404);                               // zip 提取失败继续走 404（既有语义）
    expect(fetchStub.count('assets-zip/manifest.json')).toBe(1);
    expect(fetchStub.count('assets-zip/p0.zip')).toBe(1);       // MuG3 误加重试:2 发=红
  });

  it('warm 单文件:挂死 → 8s 超时 → 落既有 ×3 重试/退避 → 3 发后 failed=1 落 warm-done（旧码:单 lane 永挂+warm running 恒真堵死重入）', async () => {
    const fetchStub = makeFetch((url) => url.includes('/sprites/warm.png') ? 'hang' : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const until = sw.message({ type: 'warm', version: 'vw', tag: 't', urls: ['/sprites/warm.png'] });
    await vi.advanceTimersByTimeAsync(30_000);                  // 8s×3 + 退避 300/600ms
    await until;                                                // warm 全链落定（旧码:永挂=此处 await 卡到测试超时=红）
    expect(fetchStub.count('/sprites/warm.png')).toBe(3);       // 既有 ×3 重试语义保持;每次有 8s 上界
    const done = sw.posted.find((m) => (m as { type?: string }).type === 'warm-done') as
      { done: number; total: number; failed: number } | undefined;
    expect(done).toMatchObject({ done: 1, total: 1, failed: 1 });
  });
});

// ============================================================================
// F2/F3 结构锁:源文本锚（防静默回退;计数锁强于文本锁）
// ============================================================================
describe('BJ704-G8 F2/F3 结构锁', () => {
  it('F2:fetchAsset 在位+双侧超时锚同步+全量收口（裸 fetch 仅守卫体内 4 处）', () => {
    const src = readFileSync(SW_PATH, 'utf8');
    expect(src).toContain('function fetchAsset(req)');
    expect((src.match(/\bfetch\(/g) ?? []).length).toBe(4);     // fetchShell×2+fetchAsset×2 体内;MuG1 回裸=计数涨=红
    expect((src.match(/ctl\.abort\(\), 8000\)/g) ?? []).length).toBe(2);   // 超时锚双侧同步（fetchShell+fetchAsset）
    expect((src.match(/typeof AbortController === 'undefined'/g) ?? []).length).toBe(2);   // 老内核退化门双侧
    expect((src.match(/await fetchShell\(req\)/g) ?? []).length).toBe(2);  // shell 支+doc 活支（★G17:doc 死支已删,isDocPath 唯一承载;复活=计数涨红）
    expect((src.match(/await fetchAsset\(/g) ?? []).length).toBe(6);       // manifest/part/serveAsset/l10n/主路/warm
    expect((src.match(/return fetchAsset\(req\)/g) ?? []).length).toBe(2); // mods miss 直通+真首访直通
    expect(src).not.toContain('res ?? fetchAsset(req)');        // ★G17 死支删除锁（serveAsset 恒 Response,直读核验）
    expect(src).not.toMatch(/const isDoc =/);                   // ★G17 删码锁:旧 isDoc 支(≡ isDocPath 同式)不可达已整支移除
    // BJ702 件3 守恒复检（本刀不碰 put 面;G17 死支删除连带 put 计数 6→5）:
    expect((src.match(/cache\.put\(req, res\.clone\(\)\);/g) ?? []).length).toBe(0);
    expect((src.match(/cache\.put\(req, res\.clone\(\)\)\.catch/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('F3:probe 注释与两发（3s+3s）实况一致（MuG8 回「多付 3s」=红）', () => {
    const src = readFileSync(WGC_PATH, 'utf8');
    expect(src).toMatch(/最坏每次加载尝试多付 6s（两发 3s 握手窗/);
    expect(src).not.toMatch(/多付 3s（仅持续离线态）/);
  });
});

// ============================================================================
// F4/F5 行为面:WorldGenClient 生命周期与级联消息归属
// ============================================================================
/** G8 伪 Worker:ping→ready;saveParse→progress(label=解析存档);genIcons/generate 挂（测试控制） */
class G8Worker {
  static instances: G8Worker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: WorldWorkerRequest[] = [];
  terminated = false;
  constructor() { G8Worker.instances.push(this); }
  postMessage(m: WorldWorkerRequest) {
    this.posted.push(m);
    const msg = m as { id: number; type: string };
    if (msg.type === 'ping') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, type: 'ready' } }));
    } else if (msg.type === 'saveParse') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, type: 'progress', phase: 'parse', label: '解析存档', p: 0.3 } }));
    }
  }
  terminate() { this.terminated = true; }
}
/** 握手过（ready）即崩溃的伪 Worker:probe true → onerror → workerBroken 粘滞 */
class CrashAfterReadyWorker extends G8Worker {
  postMessage(m: WorldWorkerRequest) {
    super.postMessage(m);
    if ((m as { type: string }).type === 'ping') queueMicrotask(() => this.onerror?.());
  }
}

describe('BJ704-G8 F4:terminate 收编 killWorker + ensureWorker broken 早退', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    G8Worker.instances = [];
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('F4a:在途作业期 terminate → 立即全量收账（旧码 teardown 旁路=孤儿等 180s+看门狗误报）', async () => {
    vi.stubGlobal('Worker', G8Worker);
    const client = new WorldGenClient();
    const iconsG = client.genIcons({ timeoutMs: 30_000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);        // 握手 ready（genIcons spawn 发起）
    const loadG = client.loadSave({ json: '{"format":1}' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);        // saveParse 投递+progress（lastLabel=解析存档）
    expect(client.hasPendingWork()).toBe(true);
    client.terminate();
    // 拍点判别:terminate 后微任务排空即 settle（旧码:两 promise 永挂到 180s）
    let o1: unknown = 'PENDING'; let o2: unknown = 'PENDING';
    void iconsG.then((e) => { o1 = e; });
    void loadG.then((e) => { o2 = e; });
    await vi.advanceTimersByTimeAsync(0);
    expect(o1).toBeInstanceOf(WorldGenUnavailable);   // MuG4 回裸 teardown:PENDING=红
    expect(o2).toBeInstanceOf(WorldGenUnavailable);
    expect((o2 as Error).message).toContain('解析存档');   // F5 顺带:共飞消息带自身标签
    expect(client.hasPendingWork()).toBe(false);
    expect(G8Worker.instances[0].terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(200_000);   // 旧码:孤儿 interval 40s 起刷「读档疑似卡死」
    expect(errSpy).toHaveBeenCalledTimes(0);
  });

  it('F4b:workerBroken 粘滞后 ensureWorker 恒拒——loadSave/abortGen 零新 spawn（旧码:白 spawn 一发）', async () => {
    vi.stubGlobal('Worker', CrashAfterReadyWorker);
    const client = new WorldGenClient();
    const p1 = client.probe();
    await vi.advanceTimersByTimeAsync(10);        // ready → probe true → 崩溃 onerror → onFatal → workerBroken
    await expect(p1).resolves.toBe(true);
    const before = CrashAfterReadyWorker.instances.length;
    let outcome: unknown = 'PENDING';
    void client.loadSave({ json: '{"format":1}' }).then((e) => { outcome = e; }, (e) => { outcome = e; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(outcome).toBeInstanceOf(WorldGenUnavailable);   // 即时拒 → 调用方 fallback（旧码:spawn#2 握手成功投递 saveParse 挂 180s=PENDING=红,MuG5）
    expect(CrashAfterReadyWorker.instances.length).toBe(before);   // 零新 spawn
    expect(() => client.abortGen()).not.toThrow();         // abortGen 不再为一条 abort 消息白 spawn
    await vi.advanceTimersByTimeAsync(100);
    expect(CrashAfterReadyWorker.instances.length).toBe(before);
  });

  it('F4c（守恒）:无在途 terminate ≡ 旧 teardown——worker 收刀置空,后续 ensureWorker 正常懒重建', async () => {
    vi.stubGlobal('Worker', G8Worker);
    const client = new WorldGenClient();
    const p = client.probe();
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toBe(true);
    client.terminate();                            // 现三调用面形态（mainFlow 退出链/探针桥/Game.destroy）
    expect(G8Worker.instances[0].terminated).toBe(true);
    expect(G8Worker.instances).toHaveLength(1);    // 不 spawn、不抛、不 reject
    const p2 = client.loadSave({ json: '{"format":1}' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);         // 懒重建:新 spawn+握手+投递
    expect(G8Worker.instances).toHaveLength(2);
    expect(G8Worker.instances[1].posted.some((m) => (m as { type: string }).type === 'saveParse')).toBe(true);
    client.terminate();                            // 收尾收账（防 interval 泄漏跨用例）
    await vi.advanceTimersByTimeAsync(0);
    void p2;
  });
});

describe('BJ704-G8 F5:killWorker 级联消息归属（触发者原样,共飞按自身标签）', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    G8Worker.instances = [];
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('F5a:genIcons 30s 超时杀共享 worker → 触发者原样「图标生成超时」;共飞 saveParse 消息含触发原因+自身进度标签（不再全表共用触发者消息）', async () => {
    vi.stubGlobal('Worker', G8Worker);
    const client = new WorldGenClient();
    const iconsG = client.genIcons({ timeoutMs: 30_000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);        // 握手
    const loadG = client.loadSave({ json: '{"format":1}' }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);        // saveParse 投递+progress（lastLabel=解析存档）
    await vi.advanceTimersByTimeAsync(30_000);    // genIcons 任务硬超时 → killWorker('图标生成超时', triggerId)
    const e1 = await iconsG;
    const e2 = await loadG;
    expect(e1).toBeInstanceOf(WorldGenUnavailable);
    expect((e1 as Error).message).toBe('图标生成超时');          // MuG7 撤 triggerId:消息变共飞形态=全等断言红
    expect(e2).toBeInstanceOf(WorldGenUnavailable);              // 类型恒定:消费面 instanceof→fallback 语义不变
    const m2 = (e2 as Error).message;
    expect(m2).toContain('图标生成超时');                        // 触发原因内嵌（日志/断言兼容面）
    expect(m2).toContain('解析存档');                            // 自身标签（F5 本体）
    expect(m2).not.toBe('图标生成超时');                         // MuG6 回全表共用 err:全等=红（旧误导形态本体）
    expect(client.hasPendingWork()).toBe(false);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(errSpy).toHaveBeenCalledTimes(0);                     // 收账后无孤儿看门狗误报
  });

  it('F5b:onFatal（worker 级,无 triggerId）:全部共飞语义——消息内嵌触发原因+自身标签', async () => {
    vi.stubGlobal('Worker', G8Worker);
    const client = new WorldGenClient();
    const genG = client.generate({ width: 4200, height: 1200, seedText: 'g8' } as never, { timeoutMs: 600_000 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);        // 装配（generate pending lastLabel=开始）
    const w = (client as unknown as { worker: G8Worker }).worker;
    (client as unknown as { onFatal: (s: unknown, l: boolean) => void }).onFatal(w, false);   // 运行期崩溃形态
    const e = await genG;
    expect(e).toBeInstanceOf(WorldGenUnavailable);
    expect((e as Error).message).toContain('worker 故障');      // bj331 既有断言兼容面
    expect((e as Error).message).toContain('开始');             // 自身标签（generate 初始 lastLabel）
  });
});
