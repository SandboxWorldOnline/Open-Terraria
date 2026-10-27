// ★BJ724-A（2026-10-26）弱网启动韧性三刀——用户实报（附两图）:
//   「Cloudflare/EdgeOne 网络不好的用户:HTML 16.5s 完成/入口 JS 69.7s ERR_ABORTED/
//    manifest 525;入口失败后 2 分钟无自动重试,游戏停在向日葵幕布」。
//
// 逐刀判语（先定谳再动刀,源码锚见 memory/bj724a-boot-resilience.md）：
//   刀1（修,public/sw.js）:fetchShell 正文下载看门狗。BJ703-E 件2a 的 8s 超时只
//     约束到响应头（fetch() 返回头即 clearTimeout,正文卡死/中途断流既不超时也不
//     触发既有单次重试）。修=头到达后整读 body（逐 chunk idle 检测,30s 无新字节
//     =stall→abort 同一 AbortController→read 拒绝→落 .catch(attempt) 既有单次
//     重试,重发完整 fetch;正文自然断流同路）+读全后重建 Response（滤
//     content-length/content-encoding——body 已解压,原头与新体不符）。
//   刀1b（修,public/sw.js fetch handler）:定谳勘正——入口 JS 实流量路径不达
//     fetchShell!script 标签先于页面 init 消息,SW 冷启/重启窗（currentVersion=''）
//     的 /assets/*.js 被 assetish 早退支折进 serveAsset/fetchAsset【单发无重试】。
//     修=shell 路径从早退支排除（!SHELL_RE.test(path)）→ isShellJs 支先
//     recoverVersion 再 cache-first+fetchShell;版本不可恢复（真首访）=纯网络
//     fetchShell 不落任何缓存（版本未知时 getCache 会打开裸名 'sw-assets-v'
//     毒化 recoverVersion 单版本判据,故 cache 恒 null）。
//   刀1c（评估,分级维持）:fetchAsset 不加正文看门狗三证——①消费方自有恢复面
//     （Image onerror/warm ×3/Lang 门,BJ704-G8 域分档依据原样成立）②serveAsset/
//     主路判 res.type==='basic',重建 Response type='default' 一致化=全部资产
//     miss 误判 404（结构性破坏）③zip 分片 20MiB 整读双份内存。锁:fetchAsset
//     函数体不含 shellBody（防「顺手一致化」）。
//   刀2（修,index.html + src/main.ts）:主包独立启动看门狗（纯静态内联,先于入口
//     script 标签注册）——①入口 script 标签 error 监听（capture,模块图任一环节
//     下载失败 fire 在入口标签;求值错误 target=window 被 SCRIPT 过滤排除）②自动
//     重试一次（动态注入带 swbootretry 查询串的新模块标签,绕开断掉的 HTTP/2 流）,
//     二次失败才出失败提示 ③60s 启动握手超时（main.ts 模块执行尾置
//     window.__swBooted=true）→失败提示+重载按钮;迟到自愈（信号后到撤提示层）
//     兜慢网假阳性。
//
// 判别锁矩阵（变异恰红面,逐刀独立）：
//   Mu1 撤正文看门狗（shellBody 直返 res）→ 刀1 stall 用例永挂红/中断用例不重试红
//   Mu2 idle 改总预算（撤 chunk 后 clearTimeout 重置）→ 刀1 trickle 慢而活用例红
//   Mu3 重建丢头过滤 → 刀1 通过语义用例（content-length/encoding 残留）红
//   Mu4 刀1b 回退（早退支恢复折入 shell）→ 刀1b 真首访/SW 重启用例红（单发不重试）
//   Mu5 撤裸名缓存守卫（无版本也 getCache）→ 刀1b 裸名毒化锁红（'sw-assets-v' 出现）
//   Mu6 fetchAsset「顺手一致化」补看门狗 → 刀1c 结构锁红
//   Mu7 撤看门狗重试注入 → 刀2 W1 红
//   Mu8 撤迟到自愈 → 刀2 W4 红
//   Mu9 握手超时改 0/撤 __swBooted 信号 → 刀2 W3/W6 + main.ts 信号锁红
//
// 双证:本文件=vm 求值（BJ703-E/G8 范式,受控 ReadableStream 半途断流=正文故障注入）
//   + 结构锁;浏览器受控复现=scripts/_bj724a-boot-watchdog-probe.mjs（本地 HTTP
//   服务器构造正文级 stall/断流——CDP Fetch.fulfillRequest 一次性整发无法构造
//   正文级故障,头级瞬断已由 _bj703e/_bj704g8 探针覆盖）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const SW_PATH = resolve(__dirname, '../public/sw.js');
const INDEX_PATH = resolve(__dirname, '../index.html');
const MAIN_PATH = resolve(__dirname, '../src/main.ts');

// ============================================================================
// 刀1 vm 行为面:sw.js 于 vm 中求值,受控网络 stub（正文级故障:stall/miderr/trickle）
// ============================================================================
type BodyAction = {
  mode: 'ok' | 'stall' | 'miderr';
  status?: number;
  headers?: Record<string, string>;
  chunks?: string[];
  /** >0:chunks 按 trickleMs 间隔逐个出（慢而活=idle 重置语义判别面） */
  trickleMs?: number;
};
type FetchAction = BodyAction | 'reject' | 'hang';

/** 可编程 fetch stub:url+第 N 发 → 动作;stall=出完 chunks 后挂死(abort→error 流,
 *  镜像真实 fetch 的 body 流绑 signal);miderr=出完 chunks 后 error(连接中断,
 *  用户实报 69.7s ERR_ABORTED 的 SW 内形态);ok=完整应答。 */
function makeBodyFetch(script: (url: string, n: number) => FetchAction) {
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
        opts?.signal?.addEventListener('abort', () => rej(new TypeError('Failed to fetch')));
      });
    }
    if (action === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
    if (action.status === 204 || action.status === 205 || action.status === 304) {
      return Promise.resolve(new Response(null, { status: action.status, headers: action.headers }));
    }
    const enc = new TextEncoder();
    const list = action.chunks ?? ['ok'];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        let i = 0;
        const emit = () => {
          if (i < list.length) {
            c.enqueue(enc.encode(list[i++]));
            if (action.trickleMs) setTimeout(emit, action.trickleMs); else emit();
          } else if (action.mode === 'stall') {
            // 挂死:不 close 不 error;abort 到达→error 流(真实 fetch 语义)
            opts?.signal?.addEventListener('abort', () => {
              try { c.error(new DOMException('Aborted', 'AbortError')); } catch { /* 已终结 */ }
            });
          } else if (action.mode === 'miderr') {
            c.error(new TypeError('net::ERR_CONTENT_LENGTH_MISMATCH'));
          } else {
            c.close();
          }
        };
        if (action.trickleMs) setTimeout(emit, action.trickleMs); else emit();
      },
    });
    return Promise.resolve(new Response(stream, { status: action.status ?? 200, headers: action.headers }));
  };
  return { fn, calls, count: (frag: string) => calls.filter((u) => u.includes(frag)).length };
}

/** 内存 CacheStorage stub（bj704g8 同款;open 即创建=裸名毒化判别可观测） */
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

/** vm 求值 sw.js（bj704g8 同款 + Headers——刀1 重建 Response 消费） */
function loadSw(fetchStub: ReturnType<typeof makeBodyFetch>, cachesStub: ReturnType<typeof makeCaches>) {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const pages: { postMessage: (m: unknown) => void }[] = [];
  const posted: unknown[] = [];
  pages.push({ postMessage: (m) => posted.push(m) });
  const ctx: Record<string, unknown> = {
    console: { log: () => {}, error: () => {}, warn: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    caches: cachesStub,
    fetch: fetchStub.fn,
    Request, Response, Headers, AbortController, URL, TextDecoder, Blob, DecompressionStream,
  };
  ctx.self = ctx;
  ctx.addEventListener = (type: string, h: (e: unknown) => void) => { (listeners[type] ??= []).push(h); };
  ctx.clients = { matchAll: async () => pages };
  ctx.skipWaiting = () => {};
  vm.createContext(ctx);
  new vm.Script(readFileSync(SW_PATH, 'utf8'), { filename: 'sw.js' }).runInContext(ctx as vm.Context);
  return {
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

describe('BJ724-A 刀1:fetchShell 正文看门狗（vm 行为面）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('正文 stall（出 1 chunk 后挂死）→ 30s idle 看门狗 abort → 既有单次重试 → 完整正文回源（恰 2 发;Mu1 撤看门狗=永挂红）', async () => {
    const fetchStub = makeBodyFetch((url, n) =>
      url.includes('/doc.html')
        ? (n === 1 ? { mode: 'stall', chunks: ['par'] } : { mode: 'ok', chunks: ['par', 'tial-ok'] })
        : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    let settled = false;
    void p.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);                          // idle 窗内不 settle（旧形态=永挂）
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(true);                           // 30s idle → abort → 重试 → 第二发完整
    const res = await p;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('partial-ok');          // 重试发的完整正文（非首发半截）
    expect(fetchStub.count('/doc.html')).toBe(2);         // 单次重试（不叠风暴,BJ703-E 语义）
  });

  it('正文中断（连接 RST,read 直接 reject=用户实报 69.7s ERR_ABORTED 形态）→ 立即重试 → 完整正文（恰 2 发,零等待）', async () => {
    const fetchStub = makeBodyFetch((url, n) =>
      url.includes('/doc.html')
        ? (n === 1 ? { mode: 'miderr', chunks: ['par'] } : { mode: 'ok', chunks: ['par', 'tial-ok'] })
        : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    const res = await p;                                  // 无 30s 等待:中断=即时 reject
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('partial-ok');
    expect(fetchStub.count('/doc.html')).toBe(2);
  });

  it('正文两连败有界:两发全 stall → 30s×2=60s 落 reject（不再永挂;Mu1=测试超时红）', async () => {
    const fetchStub = makeBodyFetch((url) =>
      url.includes('/doc.html') ? { mode: 'stall', chunks: ['par'] } : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    let settled = false;
    void p.catch(() => {}).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(settled).toBe(false);                          // 第二发 idle 窗内
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(true);                           // 60s 有界终止 → doc 支 catch → 缓存 miss → rethrow
    await expect(p).rejects.toBeInstanceOf(Error);
    expect(fetchStub.count('/doc.html')).toBe(2);
  });

  it('idle 重置语义（Mu2 改总预算=红）:trickle 慢而活 5 chunk×10s（总 50s>30s 预算）只要在出字节就永不误杀,单发完成', async () => {
    const fetchStub = makeBodyFetch((url) =>
      url.includes('/doc.html')
        ? { mode: 'ok', chunks: ['a', 'b', 'c', 'd', 'e'], trickleMs: 10_000 }
        : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(45_000);            // 45s:总时长已超 30s,但逐 chunk 间隔 10s<30s
    expect(settled).toBe(false);                          // 仍在出字节≠stall;总预算形态此处已误杀=红
    await vi.advanceTimersByTimeAsync(16_000);            // 末 chunk 50s + close 60s
    expect(settled).toBe(true);
    const res = await p;
    expect(await res.text()).toBe('abcde');
    expect(fetchStub.count('/doc.html')).toBe(1);         // 慢而活不重试
  });

  it('通过语义:正常正文重建后 status/正文/content-type 保真,content-length/content-encoding 滤除（Mu3 撤头过滤=红）,明确应答不重试', async () => {
    const fetchStub = makeBodyFetch((url) =>
      url.includes('/doc.html')
        ? {
            mode: 'ok', chunks: ['AB', 'C'],
            headers: { 'content-type': 'application/javascript', 'content-length': '9999', 'content-encoding': 'gzip' },
          }
        : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    const res = await p;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ABC');
    expect(res.headers.get('content-type')).toBe('application/javascript');
    expect(res.headers.get('content-length')).toBeNull();   // 原值=压缩长度,与新体不符→滤
    expect(res.headers.get('content-encoding')).toBeNull(); // 正文已解压→滤（防二次解压）
    expect(fetchStub.count('/doc.html')).toBe(1);           // 完整应答不重试
  });

  it('404 明确应答:正文照读照重建但不重试（恰 1 发,BJ703-E「404 不重试」语义延续到正文相）', async () => {
    const fetchStub = makeBodyFetch((url) =>
      url.includes('/doc.html') ? { mode: 'ok', status: 404, chunks: ['nope'] } : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    const res = await p;
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('nope');
    expect(fetchStub.count('/doc.html')).toBe(1);
  });

  it('204 无正文:原样返回零异常（重建 Response null-body 语义守恒）', async () => {
    const fetchStub = makeBodyFetch((url) =>
      url.includes('/doc.html') ? { mode: 'ok', status: 204 } : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/doc.html'))!;
    const res = await p;
    expect(res.status).toBe(204);
    expect(fetchStub.count('/doc.html')).toBe(1);
  });
});

describe('BJ724-A 刀1b:入口 JS 实流量路径（shell 路径不被 assetish 早退支折走）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('真首访（无版本无缓存）:入口 JS 正文中断 → fetchShell 单次重试恢复（Mu4 回退=单发不重试红）;且零缓存创建——裸名 sw-assets-v 毒化锁（Mu5=红）', async () => {
    const fetchStub = makeBodyFetch((url, n) =>
      url.includes('/assets/index-x.js')
        ? (n === 1
          ? { mode: 'miderr', chunks: ['var a=1;'], headers: { 'content-type': 'application/javascript' } }
          : { mode: 'ok', chunks: ['var a=1;var b=2;'], headers: { 'content-type': 'application/javascript' } })
        : 'reject');
    const cachesStub = makeCaches([]);   // 无任何版本缓存(真首访)
    const sw = loadSw(fetchStub, cachesStub);
    const p = sw.fire(new Request('http://localhost/assets/index-x.js'))!;
    const res = await p;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('var a=1;var b=2;');
    expect(fetchStub.count('/assets/index-x.js')).toBe(2);   // 旧形态:早退支→fetchAsset 单发即败=红
    // ★裸名毒化锁:版本未知时 getCache 会 caches.open('sw-assets-v')(open 即创建)
    //   → 毒化 recoverVersion 单版本判据;守卫=cache 恒 null,任何缓存都不得被创建
    expect([...cachesStub._map.keys()]).toEqual([]);
  });

  it('SW 重启窗（currentVersion 丢失,唯一版本缓存可恢复）:cache-first miss → fetchShell 重试 → 落【版本】缓存完整正文（cache.put 与重试交互:重建体恒完整）', async () => {
    const fetchStub = makeBodyFetch((url, n) =>
      url.includes('/assets/index-y.js')
        ? (n === 1
          ? { mode: 'stall', chunks: ['var a=1;'], headers: { 'content-type': 'application/javascript' } }
          : { mode: 'ok', chunks: ['var a=1;var b=2;'], headers: { 'content-type': 'application/javascript' } })
        : 'reject');
    const cachesStub = makeCaches(['sw-assets-vrec']);   // 唯一版本缓存名 → recoverVersion 恢复
    const sw = loadSw(fetchStub, cachesStub);
    const p = sw.fire(new Request('http://localhost/assets/index-y.js'))!;
    let settled = false;
    void p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(32_000);           // 首发正文 stall 30s → abort → 重试 → 完整
    expect(settled).toBe(true);
    const res = await p;
    expect(await res.text()).toBe('var a=1;var b=2;');
    expect(fetchStub.count('/assets/index-y.js')).toBe(2);
    // cache.put 交互:重试后的完整重建体落版本缓存(非首发的半截流——旧形态 put 可吃到
    // 中断流,NetworkError 被 .catch 吸收=丢一次缓存机会;新形态 put 恒完整)
    const stored = await cachesStub._map.get('sw-assets-vrec')!
      .match(new Request('http://localhost/assets/index-y.js'));
    expect(stored).not.toBeNull();
    expect(await stored!.text()).toBe('var a=1;var b=2;');
  });

  it('SW 重启窗 cache-first 命中:零网络(重路由不破坏既有缓存语义)', async () => {
    const fetchStub = makeBodyFetch(() => 'reject');     // 任何网络请求都失败
    const cachesStub = makeCaches(['sw-assets-vrec']);
    const cache = await cachesStub.open('sw-assets-vrec');
    await cache.put(new Request('http://localhost/assets/index-z.js'), new Response('CACHED'));
    const sw = loadSw(fetchStub, cachesStub);
    const p = sw.fire(new Request('http://localhost/assets/index-z.js'))!;
    const res = await p;
    expect(await res.text()).toBe('CACHED');
    expect(fetchStub.calls).toHaveLength(0);             // 命中即回,零出流
  });

  it('非 shell 资产路径早退支语义不变（守恒）:真首访资产网络瞬断单发不重试 → respondWith reject（恰 1 发,BJ704-G8 资产档原样）', async () => {
    const fetchStub = makeBodyFetch((url) =>
      url.includes('/sprites/vanilla/a.png') ? 'reject' : 'reject');
    const sw = loadSw(fetchStub, makeCaches([]));
    const p = sw.fire(new Request('http://localhost/sprites/vanilla/a.png'))!;
    await expect(p).rejects.toBeInstanceOf(Error);       // 早退支直通 fetchAsset(无 catch 包装)=reject 形态原样
    expect(fetchStub.count('/sprites/vanilla/a.png')).toBe(1);
  });
});

// ============================================================================
// 刀2 vm 行为面:index.html 内联看门狗（DOM stub 求值）+ 握手信号
// ============================================================================
/** 内联看门狗脚本提取（#sw-boot-watchdog 锚） */
function watchdogSrc(): string {
  const html = readFileSync(INDEX_PATH, 'utf8');
  const m = /<script>\s*(\/\/ #sw-boot-watchdog[\s\S]*?)\s*<\/script>/.exec(html);
  if (!m) throw new Error('index.html 内联看门狗脚本未找到（#sw-boot-watchdog 锚缺失）');
  return m[1];
}

/** DOM/window stub 求值看门狗:返回驱动器（error 派发/定时器推进/注入脚本观察） */
function loadWatchdog() {
  const registry = new Map<string, object>();
  const appendedScripts: Array<{ type: string; src: string }> = [];
  const appendedToBody: string[] = [];
  let reloadCount = 0;
  const handlers: Record<string, (e: unknown) => void> = {};
  class El {
    tagName: string;
    private _id = '';
    type = '';
    src = '';
    innerHTML = '';
    onerror: (() => void) | null = null;
    onclick: (() => void) | null = null;
    /** 挂载目标（head/body）逐实例接线；未接线=非挂载目标 */
    appendChild?: (child: El) => El;
    constructor(tag: string) { this.tagName = tag.toUpperCase(); }
    get id() { return this._id; }
    set id(v: string) { this._id = v; if (v) registry.set(v, this); }
    setAttribute(k: string, v: string) { if (k === 'id') this.id = v; }
    remove() { registry.delete(this._id); }
  }
  const head = new El('head');
  const body = new El('body');
  head.appendChild = (s: El) => { appendedScripts.push({ type: s.type, src: s.src }); return s; };
  body.appendChild = (d: El) => { appendedToBody.push(d.id); return d; };
  let reloadBtn: El | null = null;
  const win: Record<string, unknown> = {
    __swBooted: false,
    addEventListener: (type: string, h: (e: unknown) => void) => { handlers[type] = h; },
  };
  const doc = {
    createElement: (tag: string) => new El(tag),
    getElementById: (id: string) => {
      if (registry.has(id)) return registry.get(id);
      // innerHTML 中的按钮非真元素:失败层存在时合成同例句柄（onclick 接线可观测）
      if (id === 'sw-boot-reload' && registry.has('sw-boot-fail')) {
        reloadBtn ??= new El('button');
        return reloadBtn;
      }
      return null;
    },
    head, body, documentElement: new El('html'),
  };
  const ctx: Record<string, unknown> = {
    window: win, document: doc,
    setTimeout, clearTimeout, setInterval, clearInterval, Date,
    location: { reload: () => { reloadCount++; } },
  };
  vm.createContext(ctx);
  new vm.Script(watchdogSrc(), { filename: 'index.html#sw-boot-watchdog' }).runInContext(ctx as vm.Context);
  return {
    win, handlers, appendedScripts, appendedToBody, registry,
    reloadCount: () => reloadCount,
    fireScriptError(src: string) { handlers.error({ target: { tagName: 'SCRIPT', src } }); },
    failOverlay: () => registry.has('sw-boot-fail'),
    reloadButton: () => reloadBtn,
  };
}

describe('BJ724-A 刀2:index.html 内联启动看门狗（vm 行为面）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('W1:入口 script 下载失败 → 动态注入带 cache-busting 查询串的新模块标签重试（恰一次;Mu7 撤注入=红）', () => {
    const w = loadWatchdog();
    w.fireScriptError('https://sandboxworld.online/src/main.ts');
    expect(w.appendedScripts).toHaveLength(1);
    expect(w.appendedScripts[0].type).toBe('module');
    expect(w.appendedScripts[0].src).toMatch(/^https:\/\/sandboxworld\.online\/src\/main\.ts\?swbootretry=\d+$/);
    expect(w.failOverlay()).toBe(false);                 // 首败自动重试,不出提示
    // 重试标签自身失败（onerror）→ 二次失败才出提示;不再有第三次注入
    w.fireScriptError('https://sandboxworld.online/assets/index-CNaBcD.js?swbootretry=123');
    expect(w.appendedScripts).toHaveLength(1);           // 重试预算恰一发
    expect(w.failOverlay()).toBe(true);
  });

  it('W2:构建态入口（/assets/<hash>.js）同样受理;失败提示层静态自足+重载钮接 location.reload', () => {
    const w = loadWatchdog();
    w.fireScriptError('https://sandboxworld.online/assets/index-CN04RoAY.js');
    w.fireScriptError('https://sandboxworld.online/assets/index-CN04RoAY.js?swbootretry=1');
    expect(w.failOverlay()).toBe(true);
    expect(w.appendedToBody).toContain('sw-boot-fail');  // 提示层挂在 body（document.body 在位）
    const btn = w.reloadButton();
    expect(btn).not.toBeNull();
    expect(typeof btn!.onclick).toBe('function');        // vm 跨 realm:typeof 判别（instanceof 恒 false）
    (btn!.onclick as () => void)();
    expect(w.reloadCount()).toBe(1);                     // 重载钮=location.reload
  });

  it('W3:60s 握手超时未见 __swBooted → 失败提示;已启动 → 超时不出（Mu9 撤信号=红）', async () => {
    const w1 = loadWatchdog();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(w1.failOverlay()).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(w1.failOverlay()).toBe(true);                 // 60s 整落提示
    const w2 = loadWatchdog();
    (w2.win as { __swBooted: boolean }).__swBooted = true;   // main.ts 模块执行尾信号
    await vi.advanceTimersByTimeAsync(120_000);
    expect(w2.failOverlay()).toBe(false);                // 已启动永不误报
  });

  it('W4:迟到自愈（Mu8 撤 heal 轮询=红）:60s 假阳性窗内主包最终就绪 → 提示层撤除', async () => {
    const w = loadWatchdog();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(w.failOverlay()).toBe(true);                  // 慢网假阳性:提示先出
    (w.win as { __swBooted: boolean }).__swBooted = true;   // 主包随后就绪
    await vi.advanceTimersByTimeAsync(2_000);            // heal 轮询 2s 周期
    expect(w.failOverlay()).toBe(false);                 // 撤提示层,不挡已就绪的游戏
  });

  it('W5:非入口 script（@vite/client 等 dev 注入）与非 SCRIPT 元素错误不触发重试', () => {
    const w = loadWatchdog();
    w.fireScriptError('http://localhost:5199/@vite/client');
    w.handlers.error({ target: { tagName: 'IMG', src: 'http://x/a.png' } });
    w.handlers.error({ target: { tagName: 'SCRIPT', src: '' } });   // 内联 script 无 src
    expect(w.appendedScripts).toHaveLength(0);
    expect(w.failOverlay()).toBe(false);
  });

  it('W6:已启动后的入口形态 script error 不消耗重试预算（mod 注入 /assets/* 标签失败面）', () => {
    const w = loadWatchdog();
    (w.win as { __swBooted: boolean }).__swBooted = true;
    w.fireScriptError('https://sandboxworld.online/assets/mod-injected.js');
    expect(w.appendedScripts).toHaveLength(0);
    expect(w.failOverlay()).toBe(false);
  });

  it('W7:重试注入重臂握手窗（重试在途不出假超时提示;总上界 120s=60s×两窗）', async () => {
    const w = loadWatchdog();
    w.fireScriptError('https://sandboxworld.online/src/main.ts');   // t=0:重试注入→重臂 60s
    expect(w.appendedScripts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(w.failOverlay()).toBe(false);              // 旧窗口（页起 60s）已过,重臂窗内不误报
    await vi.advanceTimersByTimeAsync(10);            // 重臂窗（重试起 60s）到点
    expect(w.failOverlay()).toBe(true);               // 重试发也 60s 无信=真挂死,落提示（上界 120s）
  });
});

// ============================================================================
// 结构锁:sw.js / index.html / main.ts 源文本锚（防静默回退）
// ============================================================================
describe('BJ724-A 结构锁', () => {
  it('刀1:fetchShell 正文看门狗在位+fetchAsset 分级维持（Mu1/Mu6）', () => {
    const src = readFileSync(SW_PATH, 'utf8');
    expect(src).toContain('const SHELL_BODY_IDLE_MS = 30_000;');
    expect(src).toContain('async function shellBody(res, ctl)');
    // 头表/正文两段看门狗结构
    expect(src).toContain('.finally(() => clearTimeout(t))          // 头到达即清头表计时器');
    expect(src).toContain('.then((res) => shellBody(res, ctl));');
    expect(src).toContain('return attempt().catch(attempt);');       // BJ703-E 单次重试形态不变
    // 重建头过滤（Mu3）
    expect(src).toContain("headers.delete('content-length')");
    expect(src).toContain("headers.delete('content-encoding')");
    // idle 重置语义（Mu2:撤 chunk 后 clearTimeout 重置=总预算化=红）
    expect(src).toContain('clearTimeout(idle);                                 // 出字节即重置（idle 语义,非总预算）');
    // ★分级维持锁（Mu6）:fetchAsset 函数体不含 shellBody（防「顺手一致化」——重建
    //   Response type='default' 会令 serveAsset/主路的 res.type==='basic' 门全量误判）
    const fa = /function fetchAsset\(req\) \{[\s\S]*?\n\}/.exec(src);
    expect(fa).not.toBeNull();
    expect(fa![0]).not.toContain('shellBody');
    expect(fa![0]).toContain('return fetch(req, { signal: ctl.signal }).finally(() => clearTimeout(t));');
  });

  it('刀1b:shell 路径出早退支+isShellJs 支版本恢复+裸名缓存守卫（Mu4/Mu5）', () => {
    const src = readFileSync(SW_PATH, 'utf8');
    expect(src).toContain('if (assetish && !currentVersion && !SHELL_RE.test(path)) {');
    expect(src).toContain('if (!currentVersion) await recoverVersion();');
    // 裸名守卫:getCache 只在 currentVersion 已知时调（shell 支内）
    const i = src.indexOf('if (isShellJs) {');
    const branch = src.slice(i, i + 1400);
    expect(branch).toContain('if (currentVersion) {');
    expect(branch).toMatch(/if \(currentVersion\) \{\s*\n\s*try \{ cache = await getCache\(\); \} catch/);
  });

  it('刀2:index.html 看门狗结构锚+静态自足（不依赖主包 CSS/JS）', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    expect(html).toContain('// #sw-boot-watchdog');
    expect(html).toContain('TIMEOUT_MS = 60000');
    expect(html).toContain('swbootretry=');
    expect(html).toContain("d.id = 'sw-boot-fail'");
    expect(html).toContain("d.setAttribute('style', 'position:fixed;inset:0;z-index:10010;");
    expect(html).toContain("id=\"sw-boot-reload\"");     // 构建态属性引号形态(vite 不动内联字符串)
    expect(html).toContain('}, true)');                  // capture(资源 error 不冒泡)
    expect(html).toContain('window.__swBooted = false;');
    expect(html).toContain('function armBootTimer()');   // 重试注入重臂握手窗(总上界 120s)
    // 静态自足:提示层零外部引用
    const block = watchdogSrc();
    expect(block).not.toContain('<img');
    expect(block).not.toContain('url(');
    expect(block).not.toContain('fetch(');
    // 看门狗位于 head 且先于入口 script 标签（监听须在标签创建前就位——资源 error
    // 可在解析期即 fire;入口标签在 body 尾）
    expect(html.indexOf('// #sw-boot-watchdog')).toBeGreaterThan(-1);
    expect(html.indexOf('// #sw-boot-watchdog')).toBeLessThan(html.indexOf('<script type="module" src="/src/main.ts">'));
  });

  it('刀2:main.ts 模块执行尾握手信号（Mu9）', () => {
    const main = readFileSync(MAIN_PATH, 'utf8');
    expect(main).toContain('__swBooted = true;');
    // 位置锁:模块执行尾（启动链 .then 回调闭括之后,文件末段;行尾注释容忍;
    //   splash.finished 是 Promise 属性 await,非调用——锚按源文本逐字）
    expect(main).toMatch(/await splash\.finished;[^\n]*\n\s*\}\);\s*\n[\s\S]{0,700}__swBooted = true;/);
  });
});
