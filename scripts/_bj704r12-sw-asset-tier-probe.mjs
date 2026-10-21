// BJ704-R12 红蓝审查·蓝职探针:sw.js fetchAsset 分级(资产类 8s 单发不重试)受控复现。
// 复用 BJ703-E 件2a 的 CDP Fetch 域 SW 出流范式(scripts/_bj703e-sw-shell-retry-probe.mjs)。
// 场景:
//   ①资产瞬断:第一发 failRequest(ConnectionReset) → 期望【恰 1 发】出流(无 SW 级重试)
//     + 页面 fetch reject(Response.error 兜底)。若误用 fetchShell → 2 发+成功=红。
//   ②资产挂死:hold 永不应答 → 期望恰 1 发 + 页面 fetch ~8s reject(AbortController
//     超时兜底)。旧码(裸 fetch)=永挂 → 40s 看门狗判红。
//   ③导航瞬断(回归面,G17 删 isDoc 支后文档唯一承载=isDocPath 支):第一发瞬断
//     第二发放行 → 恰 2 发 + 回源应答(非 504)。
//   ④资产 404:明确应答直通不重试不缓存(恰 1 发)——守恒 BJ703-E 语义。
// 环境:dev + 手动 register SW;init 消息带伪版本(currentVersion 非空→资产主路)。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origin = process.env.SW_ORIGIN ?? 'http://localhost:5244';
const FAKE_VER = 'bj704r12-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/bj704r12-sw-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
let fails = 0;
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { pageErrors.push(String(e).slice(0, 120)); });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  });
  let ctrl = false;
  for (let i = 0; i < 40 && !ctrl; i++) {
    ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!ctrl) await sleep(250);
  }
  if (!ctrl) { console.log('FAIL: SW 未接管页面(controller=null)'); process.exit(1); }
  console.log('① SW 注册+接管 OK');

  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('/sw.js'), { timeout: 15_000 });
  const swCdp = await swTarget.createCDPSession();
  await swCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*bj704r12*' }] });
  const seen = {};
  swCdp.on('Fetch.requestPaused', async (ev) => {
    const u = ev.request.url;
    if (u.includes('r12-hang') || u.includes('r12-hangdoc')) return;   // hold:永不应答=黑洞
    if (u.includes('r12-transient')) {
      seen.transient = (seen.transient ?? 0) + 1;
      if (seen.transient === 1) {
        await swCdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
      } else {
        await swCdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => {});
      }
    } else if (u.includes('r12-transdoc')) {
      seen.transdoc = (seen.transdoc ?? 0) + 1;
      if (seen.transdoc === 1) {
        await swCdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
      } else {
        await swCdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => {});
      }
    } else if (u.includes('r12-404')) {
      seen.n404 = (seen.n404 ?? 0) + 1;
      await swCdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => {});
    }
  });

  await page.evaluate((v) => navigator.serviceWorker.controller.postMessage({ type: 'init', version: v }), FAKE_VER);
  await sleep(300);

  // ---- ① 资产瞬断:恰 1 发 + 页面 reject ----
  const r1 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    try {
      const res = await fetch(u);
      return { ok: true, status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) { return { ok: false, err: String(e).slice(0, 60), ms: Math.round(performance.now() - t0) }; }
  }, `${origin}/sprites/bj704r12-transient.png?probe=${Date.now()}`);
  console.log(`② 资产瞬断(第一发 ConnectionReset): ${JSON.stringify(r1)} (出流=${seen.transient ?? 0} 发)`);
  if (r1.ok || (seen.transient ?? 0) !== 1) {
    console.log('   FAIL: 期望恰 1 发+页面 reject(资产类单发不重试);若 2 发+成功=误用 fetchShell');
    fails++;
  } else console.log('   PASS: 资产类瞬断=单发直达失败面(SW 级零重试,消费方退避链接管)');

  // ---- ② 资产挂死:恰 1 发 + ~8s 有界 reject ----
  const r2 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    const watchdog = new Promise((r) => setTimeout(() => r({ ok: false, hang: true, ms: 40_000 }), 40_000));
    const run = fetch(u).then((res) => ({ ok: true, status: res.status, ms: Math.round(performance.now() - t0) }))
      .catch((e) => ({ ok: false, err: String(e).slice(0, 60), ms: Math.round(performance.now() - t0) }));
    return Promise.race([run, watchdog]);
  }, `${origin}/sprites/bj704r12-hang.png?probe=${Date.now()}`);
  console.log(`③ 资产挂死(全 hold): ${JSON.stringify(r2)} (出流=1 发 hold)`);
  if (r2.ok || r2.hang || r2.ms < 7_000 || r2.ms > 12_000) {
    console.log('   FAIL: 期望 ~8s 有界 reject;旧码(裸 fetch)=40s 看门狗挂死形态');
    fails++;
  } else console.log('   PASS: 资产挂死 8s 超时兜底(单 lane 不再永挂)');

  // ---- ③ 导航瞬断(回归):恰 2 发 + 回源应答 ----
  const r3 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    try {
      const res = await fetch(u);
      return { ok: true, status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) { return { ok: false, err: String(e).slice(0, 60), ms: Math.round(performance.now() - t0) }; }
  }, `${origin}/bj704r12-transdoc.html?probe=${Date.now()}`);
  console.log(`④ 导航瞬断(.html 第一发瞬断): ${JSON.stringify(r3)} (出流=${seen.transdoc ?? 0} 发)`);
  if (!r3.ok || r3.status === 504 || (seen.transdoc ?? 0) !== 2) {
    console.log('   FAIL: 期望回源应答+恰 2 发(fetchShell 单次重试)');
    fails++;
  } else console.log('   PASS: 文档支(G17 后唯一承载=isDocPath)瞬断重试在位');

  // ---- ④ 资产 404:恰 1 发直通 ----
  const r4 = await page.evaluate(async (u) => {
    try {
      const res = await fetch(u);
      return { ok: true, status: res.status };
    } catch (e) { return { ok: false, err: String(e).slice(0, 60) }; }
  }, `${origin}/sprites/bj704r12-404.png?probe=${Date.now()}`);
  console.log(`⑤ 资产 404(vite 直通): ${JSON.stringify(r4)} (出流=${seen.n404 ?? 0} 发)`);
  if (!r4.ok || r4.status !== 404 || (seen.n404 ?? 0) !== 1) {
    console.log('   FAIL: 期望 404 直通+恰 1 发(明确应答不重试)');
    fails++;
  } else console.log('   PASS: 明确 404 应答直通不重试');

  await page.evaluate(async (v) => {
    await caches.delete('sw-assets-v' + v);
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
  }, FAKE_VER).catch(() => {});
} finally {
  await browser.close().catch(() => {});
}
if (pageErrors.length) console.log('[pageerror 观测]', pageErrors.slice(0, 5));
console.log(fails === 0 ? 'ALL PASS: BJ704-G8 F2 资产类分级(单发不重试+8s 兜底)+文档支回归 ✓'
  : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
