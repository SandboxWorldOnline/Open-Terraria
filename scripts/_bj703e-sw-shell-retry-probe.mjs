// BJ703-E 件2a 行为探针:sw.js shell 支 fetchShell(8s 超时+单次重试)受控复现。
// 场景(BJ702 根因②fetch 面,用户诉求「瞬断不会重试吗」):
//   ①瞬断重试:CDP Fetch 域拦 SW 网络出流——第一发 failRequest(ConnectionReset)、
//     第二发放行 → 页面 fetch 应回源成功应答(vite 404/200,非 SW 兜底 504)。
//     旧码(裸 fetch)第一发即败 → catch → 504 offline(判别面:504 vs 回源应答)。
//   ②挂死超时:两发全部 hold(永不 continue)→ 8s AbortController 超时×2 → ~16s 落
//     504。旧码:fetch 永挂(respondWith 不 settle,调用方干等自身超时)——探针
//     页侧 40s 看门狗即判 FAIL(挂死形态)。
// 环境:dev + 手动 register SW(dev 默认 ?sw 缺省关,零 app 侧 warm 噪声);
//       init 消息带伪版本确保走 shell 支(currentVersion 非空)。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origin = process.env.SW_ORIGIN ?? 'http://localhost:5211';
const FAKE_VER = 'bj703e-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/bj703e-sw-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
let fails = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 120)));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  // 手动注册 SW(dev 默认关);等 controller(activate → clients.claim)
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

  // SW target CDP 会话:Fetch 域拦截 SW 自己的网络出流
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().endsWith('/sw.js'), { timeout: 15_000 });
  const swCdp = await swTarget.createCDPSession();
  await swCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*bj703e*' }] });
  swCdp.on('Fetch.requestPaused', async (ev) => {
    const u = ev.request.url;
    if (u.includes('bj703e-hang')) return;                     // ② hold:永不应答=黑洞
    if (u.includes('bj703e-transient')) {
      transientSeen++;
      if (transientSeen === 1) {                              // ① 第一发:模拟瞬断
        await swCdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
      } else {                                                // ① 第二发:放行(网络恢复)
        await swCdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => {});
      }
    }
  });
  let transientSeen = 0;

  // init 消息带伪版本 → currentVersion 非空 → shell 支(cache=sw-assets-vbj703e-probe,空)
  await page.evaluate((v) => navigator.serviceWorker.controller.postMessage({ type: 'init', version: v }), FAKE_VER);
  await sleep(300);

  // ---- ① 瞬断重试:第一发 ConnectionReset → 重试放行 → 回源应答(非 504) ----
  const r1 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    try {
      const res = await fetch(u);
      return { ok: true, status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) { return { ok: false, err: String(e).slice(0, 80), ms: Math.round(performance.now() - t0) }; }
  }, `${origin}/assets/bj703e-transient.js?probe=${Date.now()}`);
  console.log(`② 瞬断(第一发 ConnectionReset→第二发放行): ${JSON.stringify(r1)} (网络出流=${transientSeen} 发)`);
  if (!r1.ok || r1.status === 504 || transientSeen !== 2) {
    console.log(`FAIL: 期望回源应答(200/404)+恰好2发网络请求;旧码此处=504+1发`);
    fails++;
  } else console.log('   PASS: 单次重试成功——瞬断不再放大为 504/挂死');

  // ---- ② 挂死超时:两发全 hold → 8s×2 abort → ~16s 落 504(旧码=永挂) ----
  const r2 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    const watchdog = new Promise((r) => setTimeout(() => r({ ok: false, hang: true, ms: 40_000 }), 40_000));
    const run = fetch(u).then((res) => ({ ok: true, status: res.status, ms: Math.round(performance.now() - t0) }))
      .catch((e) => ({ ok: false, err: String(e).slice(0, 60), ms: Math.round(performance.now() - t0) }));
    return Promise.race([run, watchdog]);
  }, `${origin}/assets/bj703e-hang.js?probe=${Date.now()}`);
  console.log(`③ 挂死(两发全 hold): ${JSON.stringify(r2)}`);
  if (!r2.ok || r2.status !== 504 || r2.ms < 14_000 || r2.ms > 26_000) {
    console.log(`FAIL: 期望 ~16s(8s×2) 落 504;旧码=40s 看门狗挂死形态`);
    fails++;
  } else console.log('   PASS: 挂死 fetch 有界终止(8s 超时+单次重试→504,不再永挂)');

  // ---- 清理:伪版本缓存 + SW 注销 ----
  await page.evaluate(async (v) => {
    await caches.delete('sw-assets-v' + v);
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
  }, FAKE_VER).catch(() => {});
} finally {
  await browser.close().catch(() => {});
}
console.log(fails === 0 ? 'ALL PASS: BJ703-E 件2a fetchShell 行为面(瞬断重试+挂死有界)✓' : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
