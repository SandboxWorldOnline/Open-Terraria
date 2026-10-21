// BJ704-G8 F2 行为探针:sw.js fetch 域分级收口(导航类=超时+重试;资产类=超时兜底单发)
// 受控复现(BJ703E CDP Fetch 域范式)。四场景:
//   ①doc 瞬断重试:iframe 导航第一发 ConnectionReset、第二发放行 → fetchShell 重试
//     → 回源应答(iframe onload,非网络错误)。旧码(裸 fetch):单发即败 → onerror。
//   ②doc 挂死有界:两发全 hold → 8s×2 → respondWith reject → iframe onerror@~16s。
//     旧码:fetch 永挂 = iframe 无限 loading(30s 看门狗判 FAIL)。
//   ③资产挂死兜底:单发 hold → 8s 超时 → Response.error → 页面 fetch reject@~8s。
//     旧码:永挂。资产类恰 1 发(超时后不重试)。
//   ④资产瞬断不重试(域分级判别面):单发 ConnectionReset → 立即 reject,恰 1 发
//     ——若误用 shell 重试档=2 发(判别资产/导航分档的正向锚)。
// 环境:dev + 手动 register SW(dev 默认 ?sw 缺省关,零 app 侧 warm 噪声);
//       init 消息带伪版本(资产走主路 :403;doc 支与版本无关恒走 :309)。
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const origin = process.env.SW_ORIGIN ?? 'http://localhost:5222';
const FAKE_VER = 'bj704g8-probe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/bj704g8-sw-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
let fails = 0;
const counts = { transientDoc: 0, hangDoc: 0, hangAsset: 0, resetAsset: 0 };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 120)));
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
  await swCdp.send('Fetch.enable', { patterns: [{ urlPattern: '*g8*' }] });
  swCdp.on('Fetch.requestPaused', async (ev) => {
    const u = ev.request.url;
    if (u.includes('g8-hang=doc')) { counts.hangDoc++; return; }   // hold:永不应答=黑洞(②)
    if (u.includes('g8-hang-asset')) { counts.hangAsset++; return; }   // hold(③)
    if (u.includes('g8-transient-doc')) {
      counts.transientDoc++;
      if (counts.transientDoc === 1) {
        await swCdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
      } else {
        await swCdp.send('Fetch.continueRequest', { requestId: ev.requestId }).catch(() => {});
      }
    } else if (u.includes('g8-reset-asset')) {
      counts.resetAsset++;
      await swCdp.send('Fetch.failRequest', { requestId: ev.requestId, errorReason: 'ConnectionReset' }).catch(() => {});
    }
  });

  await page.evaluate((v) => navigator.serviceWorker.controller.postMessage({ type: 'init', version: v }), FAKE_VER);
  await sleep(300);

  // ---- ① doc 瞬断重试:第一发 ConnectionReset → 第二发放行 → 回源应答 ----
  const r1 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    const res = await new Promise((resolve) => {
      const f = document.createElement('iframe');
      const done = (ok) => { f.remove(); resolve({ ok, ms: Math.round(performance.now() - t0) }); };
      f.onload = () => done(true);
      f.onerror = () => done(false);
      f.src = u;
      document.body.appendChild(f);
      setTimeout(() => done(false), 30_000);   // 看门狗:旧码裸 fetch 单发即败,也应快速 onerror;永挂形态由此兜
    });
    return res;
  }, `${origin}/?g8-transient-doc=1`);
  console.log(`② doc 瞬断(第一发 ConnectionReset→第二发放行): onload=${r1.ok} ${r1.ms}ms (SW 出流=${counts.transientDoc} 发)`);
  if (!r1.ok || counts.transientDoc !== 2) { console.log('FAIL: 期望重试后回源 onload+恰 2 发;旧码=单发即败 onerror'); fails++; }
  else console.log('   PASS: 导航类瞬断重试恢复(fetchShell 档)');

  // ---- ② doc 挂死有界:两发全 hold → 8s×2 → respondWith reject → 错误页@~16s ----
  // 判别:Chrome iframe 网络错误渲染 chrome-error 页触发的是 onload(非 onerror,iframe
  // error 事件支持度差)——用 contentDocument 可访问性判别(同源成功=可访问;错误页=不可访问)。
  const r2 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    const res = await new Promise((resolve) => {
      const f = document.createElement('iframe');
      const finish = (loaded) => {
        let accessible = false;
        try { accessible = !!f.contentDocument; } catch { accessible = false; }
        f.remove();
        resolve({ loaded, accessible, ms: Math.round(performance.now() - t0) });
      };
      f.onload = () => finish(true);
      f.src = u;
      document.body.appendChild(f);
      setTimeout(() => finish(false), 40_000);   // 看门狗:永挂形态(旧码)按"仍 loading"判 FAIL
    });
    return res;
  }, `${origin}/?g8-hang=doc`);
  console.log(`③ doc 挂死(两发全 hold): settle=${r2.loaded ? 'onload' : 'watchdog'} accessible=${r2.accessible} ${r2.ms}ms (SW 出流=${counts.hangDoc} 发)`);
  if (!r2.loaded || r2.accessible || r2.ms < 14_000 || r2.ms > 26_000 || counts.hangDoc !== 2) {
    console.log('FAIL: 期望 ~16s(8s×2) 后落 chrome-error 错误页(accessible=false)+恰 2 发;旧码=40s 看门狗仍 loading');
    fails++;
  } else console.log('   PASS: 导航类挂死 16s 有界终止(两发超时→缓存回退 miss→网络错误页)');

  // ---- ③ 资产挂死兜底:单发 hold → 8s 超时 → Response.error → 页面 reject@~8s ----
  const r3 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    try {
      const res = await fetch(u);
      return { ok: true, status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) { return { ok: false, err: String(e).slice(0, 60), ms: Math.round(performance.now() - t0) }; }
  }, `${origin}/sprites/g8-hang-asset.png?p=${Date.now()}`);
  console.log(`④ 资产挂死(单发 hold): ${JSON.stringify(r3)} (SW 出流=${counts.hangAsset} 发)`);
  if (r3.ok || r3.ms < 7_000 || r3.ms > 12_000 || counts.hangAsset !== 1) { console.log('FAIL: 期望 ~8s 超时兜底 reject+恰 1 发;旧码=永挂'); fails++; }
  else console.log('   PASS: 资产类挂死 8s 有界(超时兜底单发)');

  // ---- ④ 资产瞬断不重试(域分级正向判别):单发 ConnectionReset → 即时 reject,恰 1 发 ----
  const r4 = await page.evaluate(async (u) => {
    const t0 = performance.now();
    try {
      const res = await fetch(u);
      return { ok: true, status: res.status, ms: Math.round(performance.now() - t0) };
    } catch (e) { return { ok: false, err: String(e).slice(0, 60), ms: Math.round(performance.now() - t0) }; }
  }, `${origin}/sprites/g8-reset-asset.png?p=${Date.now()}`);
  console.log(`⑤ 资产瞬断(单发 ConnectionReset): ${JSON.stringify(r4)} (SW 出流=${counts.resetAsset} 发)`);
  if (r4.ok || counts.resetAsset !== 1) { console.log('FAIL: 期望即时 reject+恰 1 发(资产类不重试;若误用 shell 重试档=2 发)'); fails++; }
  else console.log('   PASS: 资产类单发不重试(与导航类重试档的分档判别面)');

  // ---- 清理:伪版本缓存 + SW 注销 ----
  await page.evaluate(async (v) => {
    await caches.delete('sw-assets-v' + v);
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
  }, FAKE_VER).catch(() => {});
} finally {
  await browser.close().catch(() => {});
}
console.log(fails === 0 ? 'ALL PASS: BJ704-G8 F2 fetch 域分级(导航重试+资产超时兜底)✓' : `${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
