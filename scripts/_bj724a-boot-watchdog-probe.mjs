// BJ724-A 浏览器受控复现探针:fetchShell 正文看门狗(刀1)+入口路径重路由(刀1b)
// +index.html 内联启动看门狗(刀2)三刀端到端。
//
// ★方法论注:BJ703E/G8 的 CDP Fetch 域范式覆盖【头级】故障(failRequest/hold)——
// Fetch.fulfillRequest 是一次性整发,无法构造【正文级】stall/断流;本探针改用本地
// HTTP 服务器受控构造正文故障(挂起 socket=正文 stall;半截正文+连接销毁=正文断流
// 即用户实报 69.7s ERR_ABORTED 形态),服务真实 public/sw.js + 真实 index.html
// (入口标签重写为故障注入端点),浏览器内全链路验证。四场景:
//   B 真首访入口:正文断流(RST)→SW 单次重试→模块执行(恰 2 发);零缓存创建
//     (裸名 sw-assets-v 毒化锁的浏览器面)。
//   A 版本已知(SW 重启窗恢复后):正文 stall 30s idle→abort→重试→完整正文回页面
//     (恰 2 发,~30s);完整重建体落版本缓存。
//   C 用户实报全景:入口正文两连 stall(60s)→respondWith reject→script error→
//     【刀2】内联看门狗注入 swbootretry 重试→SW 取回完整→模块执行(恰 3 发,
//     无失败提示层)——「幕布永转无重试」的端到端修复证。
//   D 全灭:入口+重试全部断流→4 发后【刀2】失败提示层出现(重载钮接线,模块未启)。
import http from 'node:http';
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GAME = '/Users/vinlic/Project/GLM/SandboxWorld/game';
const swSrc = readFileSync(`${GAME}/public/sw.js`, 'utf8');
const indexSrc = readFileSync(`${GAME}/index.html`, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ENTRY_BODY = 'window.__swBooted = true; window.__bj724aEntryBooted = true;';
const FETCH_BODY = 'A'.repeat(20_000);
const half = (s) => s.slice(0, Math.ceil(s.length / 2));

// ---- 受控故障服务器 ----
const counts = new Map();   // pathname → 请求数(SW 出流计数)
const bump = (p) => { const n = (counts.get(p) ?? 0) + 1; counts.set(p, n); return n; };
const cnt = (p) => counts.get(p) ?? 0;

function serveComplete(res, body, type) {
  res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function serveStall(res, body, type) {     // 头+半截正文,socket 挂起不 end=正文 stall
  res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.write(half(body));
}
function serveTruncate(res, body, type) {  // 头+半截正文+30ms 后连接销毁=正文断流(RST)
  res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.write(half(body));
  setTimeout(() => res.destroy(), 30);
}

function pageHtml(cfg) {
  return indexSrc.replace(
    '<script type="module" src="/src/main.ts"></script>',
    `<script>(async function () {
      try {
        await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        await navigator.serviceWorker.ready;
        for (var i = 0; i < 50 && !navigator.serviceWorker.controller; i++) {
          await new Promise(function (r) { setTimeout(r, 200); });
        }
      } catch (e) { window.__bj724aSwErr = String(e); }
      window.__bj724aSwReady = true;
      ${cfg.init ? 'try { navigator.serviceWorker.controller.postMessage({ type: "init", version: "bj724a-ver" }); } catch (e) {}' : ''}
      ${cfg.entry ? `var s = document.createElement('script'); s.type = 'module'; s.src = ${JSON.stringify(cfg.entry)}; document.head.appendChild(s);` : ''}
    })();</script>`);
}

const server = http.createServer((req, res) => {
  res.on('error', () => {});
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (p === '/sw.js') return serveComplete(res, swSrc, 'application/javascript');
  if (p === '/') {
    const s = u.searchParams.get('s');
    const cfg = s === 'a' ? { init: true }
      : s === 'b' ? { entry: '/assets/bj724a-entry-b.js?mode=b' }
      : s === 'c' ? { entry: '/assets/bj724a-entry-c.js?mode=c' }
      : s === 'd' ? { entry: '/assets/bj724a-entry-d.js?mode=d' }
      : {};
    return serveComplete(res, pageHtml(cfg), 'text/html');
  }
  if (p === '/assets/bj724a-fetch1.js') {
    const n = bump(p);
    return n === 1 ? serveStall(res, FETCH_BODY, 'application/javascript')
      : serveComplete(res, FETCH_BODY, 'application/javascript');
  }
  if (p === '/assets/bj724a-entry-b.js') {
    const n = bump(p);
    return n === 1 ? serveTruncate(res, ENTRY_BODY, 'application/javascript')
      : serveComplete(res, ENTRY_BODY, 'application/javascript');
  }
  if (p === '/assets/bj724a-entry-c.js') {
    bump(p);
    // SW 两连 stall 后,刀2 看门狗注入的 swbootretry 重试(带查询串)放行完整
    return u.searchParams.has('swbootretry')
      ? serveComplete(res, ENTRY_BODY, 'application/javascript')
      : serveStall(res, ENTRY_BODY, 'application/javascript');
  }
  if (p === '/assets/bj724a-entry-d.js') {
    bump(p);
    return serveTruncate(res, ENTRY_BODY, 'application/javascript');   // 永远断流(含重试)
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('no');
});
server.on('clientError', (err, socket) => { try { socket.destroy(); } catch { /* */ } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`[bj724a] 受控故障服务器 ${origin}(sw.js ${swSrc.length}B / index.html ${indexSrc.length}B)`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: `/tmp/bj724a-probe-${Date.now() % 100000}`,
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
let fails = 0;
const FAIL = (msg) => { console.log(`FAIL: ${msg}`); fails++; };
const PASS = (msg) => console.log(`   PASS: ${msg}`);

async function openScenario(s) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 100)));
  await page.goto(`${origin}/?s=${s}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__bj724aSwReady === true || window.__bj724aSwErr)) break;
    await sleep(200);
  }
  const swErr = await page.evaluate(() => window.__bj724aSwErr);
  if (swErr) { FAIL(`?s=${s} SW 注册失败: ${swErr}`); }
  return page;
}

try {
  // ---- 场景 B:真首访(无版本无缓存)入口正文断流→SW 单次重试→模块执行 ----
  {
    const page = await openScenario('b');
    let booted = false;
    for (let i = 0; i < 100 && !booted; i++) {
      booted = await page.evaluate(() => window.__bj724aEntryBooted === true);
      if (!booted) await sleep(200);
    }
    const state = await page.evaluate(() => ({
      booted: window.__bj724aEntryBooted === true,
      overlay: !!document.getElementById('sw-boot-fail'),
    }));
    const cacheKeys = await page.evaluate(async () => JSON.stringify(await caches.keys()));
    console.log(`B 真首访入口断流: booted=${state.booted} overlay=${state.overlay} SW出流=${cnt('/assets/bj724a-entry-b.js')}发 caches=${cacheKeys}`);
    if (!state.booted) FAIL('期望断流后 SW 单次重试恢复(booted)');
    else PASS('入口正文断流→fetchShell 单次重试→模块执行(刀1+刀1b)');
    if (cnt('/assets/bj724a-entry-b.js') !== 2) FAIL(`期望恰 2 发(断流+重试),实得 ${cnt('/assets/bj724a-entry-b.js')}`);
    else PASS('恰 2 发(单次重试语义)');
    if (JSON.parse(cacheKeys).length !== 0) FAIL(`真首访零缓存创建锁失败(裸名毒化): ${cacheKeys}`);
    else PASS('零缓存创建(版本未知不落缓存,裸名 sw-assets-v 未被创建)');
    await page.close();
  }

  // ---- 场景 A:版本已知,正文 stall 30s idle→abort→重试→完整正文(页面 fetch 面) ----
  {
    const page = await openScenario('a');
    const r = await page.evaluate(async (u) => {
      const t0 = performance.now();
      try {
        const res = await fetch(u);
        const text = await res.text();
        return { ok: true, len: text.length, ms: Math.round(performance.now() - t0) };
      } catch (e) { return { ok: false, err: String(e).slice(0, 60), ms: Math.round(performance.now() - t0) }; }
    }, `${origin}/assets/bj724a-fetch1.js?mode=a`);
    const cached = await page.evaluate(async (u) => {
      const c = await caches.open('sw-assets-vbj724a-ver');
      const m = await c.match(u);
      return m ? (await m.text()).length : -1;
    }, `${origin}/assets/bj724a-fetch1.js?mode=a`);
    console.log(`A 版本已知正文 stall: ${JSON.stringify(r)} SW出流=${cnt('/assets/bj724a-fetch1.js')}发 缓存正文长度=${cached}`);
    if (!r.ok || r.len !== FETCH_BODY.length) FAIL(`期望完整正文 ${FETCH_BODY.length}B,实得 ${JSON.stringify(r)}`);
    else PASS('正文 stall 30s idle→abort→单次重试→完整正文回页面');
    if (cnt('/assets/bj724a-fetch1.js') !== 2) FAIL(`期望恰 2 发,实得 ${cnt('/assets/bj724a-fetch1.js')}`);
    else PASS('恰 2 发');
    if (r.ms < 28_000 || r.ms > 45_000) FAIL(`期望 ~30s(正文 idle 看门狗),实得 ${r.ms}ms`);
    else PASS(`30s idle 看门狗时序(${r.ms}ms)`);
    if (cached !== FETCH_BODY.length) FAIL(`版本缓存应落完整重建体(${FETCH_BODY.length}B),实得 ${cached}`);
    else PASS('cache.put 恒完整(重试后的重建体,非半截流)');
    await page.close();
  }

  // ---- 场景 C:用户实报全景——入口两连 stall(60s)→刀2 看门狗重试→模块执行 ----
  {
    const page = await openScenario('c');
    let booted = false;
    const t0 = Date.now();
    for (let i = 0; i < 600 && !booted; i++) {
      booted = await page.evaluate(() => window.__bj724aEntryBooted === true);
      if (!booted) await sleep(200);
    }
    // 迟到自愈窗:首窗 60s 超时可在两连 stall 的 60s 末尾先行落提示(重臂窗语义
    // 在「重试注入」才生效,SW 内静默 stall 期看门狗无从感知),boot 后 heal 轮询
    // (2s 周期)须撤除——等 heal 落定再断言。
    let healed = false;
    for (let i = 0; i < 20 && booted; i++) {
      healed = await page.evaluate(() => !document.getElementById('sw-boot-fail'));
      if (!healed) await sleep(300);
    }
    const ms = Date.now() - t0;
    const state = await page.evaluate(() => ({
      booted: window.__bj724aEntryBooted === true,
      overlay: !!document.getElementById('sw-boot-fail'),
      bootedSignal: window.__swBooted === true,
    }));
    console.log(`C 入口两连stall→刀2重试: booted=${state.booted} signal=${state.bootedSignal} overlay=${state.overlay} healed=${healed} ${ms}ms SW出流=${cnt('/assets/bj724a-entry-c.js')}发`);
    if (!state.booted || !state.bootedSignal) FAIL(`期望刀2 重试后模块执行(booted+signal),实得 ${JSON.stringify(state)}`);
    else PASS('SW 两连败→script error→内联看门狗 swbootretry 重试→模块执行(刀1+刀2 全链)');
    if (state.overlay) FAIL('boot 后失败提示层须由迟到自愈撤除(2s 轮询)');
    else PASS('失败提示层已撤/未出(重试成功,迟到自愈落定)');
    if (cnt('/assets/bj724a-entry-c.js') !== 3) FAIL(`期望恰 3 发(SW×2+看门狗重试×1),实得 ${cnt('/assets/bj724a-entry-c.js')}`);
    else PASS('恰 3 发');
    if (ms < 55_000 || ms > 90_000) FAIL(`期望 ~60s(30s×2 两连stall),实得 ${ms}ms`);
    else PASS(`两连 stall 时序(${ms}ms,30s×2+重试)`);
    await page.close();
  }

  // ---- 场景 D:全灭(含看门狗重试)→失败提示层+重载钮 ----
  {
    const page = await openScenario('d');
    let overlay = false;
    for (let i = 0; i < 100 && !overlay; i++) {
      overlay = await page.evaluate(() => !!document.getElementById('sw-boot-fail'));
      if (!overlay) await sleep(200);
    }
    const state = await page.evaluate(() => ({
      overlay: !!document.getElementById('sw-boot-fail'),
      btn: !!document.getElementById('sw-boot-reload'),
      btnWired: typeof (document.getElementById('sw-boot-reload') || {}).onclick === 'function',
      booted: window.__bj724aEntryBooted === true,
      bootedSignal: window.__swBooted === true,
      curtain: !!document.getElementById('sw-boot-static'),
    }));
    console.log(`D 全灭: ${JSON.stringify(state)} SW出流=${cnt('/assets/bj724a-entry-d.js')}发`);
    if (!state.overlay || !state.btn || !state.btnWired) FAIL(`期望失败提示层+接线重载钮,实得 ${JSON.stringify(state)}`);
    else PASS('两连败后失败提示层出现,重载钮接 location.reload');
    if (state.booted || state.bootedSignal) FAIL('全灭场景模块不得执行');
    else PASS('模块未执行(信号缺席)');
    if (cnt('/assets/bj724a-entry-d.js') !== 4) FAIL(`期望恰 4 发(首发 SW×2+看门狗重试 SW×2),实得 ${cnt('/assets/bj724a-entry-d.js')}`);
    else PASS('恰 4 发(重试预算恰一发)');
    // 提示层与静态向日葵幕并存(层序:10010 > 9998)——真实呈现「幕布上出提示」
    if (!state.curtain) FAIL('静态向日葵幕应在位(主包未跑,摘除链不触发)');
    else PASS('提示层叠于静态向日葵幕之上(z 10010>9998)');
    await page.close();
  }

  // ---- 清理 ----
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.evaluate(async () => {
    const names = await caches.keys();
    for (const n of names) await caches.delete(n);
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
  }).catch(() => {});
  await page.close();
} finally {
  await browser.close().catch(() => {});
  server.close();
}
console.log(fails === 0 ? 'ALL PASS: BJ724-A 三刀浏览器受控复现(正文看门狗+入口重路由+内联启动看门狗)✓' : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
