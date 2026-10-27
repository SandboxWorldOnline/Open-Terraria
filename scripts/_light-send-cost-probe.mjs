// ★光照/wave 消息链真成本探针(2026-10-27 任务#26 定谳第二面):in-page 计时包裹
// Worker.prototype.postMessage——按消息形态(light: op=frame+enc/wave: op=frame 无 enc/
// 其他)累计主线程耗时,quantify 每发真成本与总账(Mac);对照 lwbp 注的 Windows
// 每 op IPC 税 10-20×,推 Windows 侧可回收量。
// 运行:SW_ORIGIN=http://localhost:5208 node tools/run-diag.mjs scripts/_light-send-cost-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5208';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261027 });
await pump(page, 40);
await new Promise((r) => setTimeout(r, 6000));

await page.evaluate(() => {
  const raw = Worker.prototype.postMessage;
  const acc = { light: { n: 0, ms: 0 }, wave: { n: 0, ms: 0 }, other: { n: 0, ms: 0 } };
  window.__msgAcc = acc;
  Worker.prototype.postMessage = function (msg, transfer) {
    let kind = 'other';
    if (msg && typeof msg === 'object' && msg.op === 'frame') {
      kind = 'enc' in msg ? 'light' : 'wave';   // light 带 enc 字段(Layer2);wave 裸 frame
    }
    const t0 = performance.now();
    const r = raw.call(this, msg, transfer);
    acc[kind].n++;
    acc[kind].ms += performance.now() - t0;
    return r;
  };
});

async function window(name, ms, walk) {
  await page.evaluate((w) => {
    const g = window.__swGame;
    g.entities.enemies.length = 0; g.entities.projectiles.length = 0;
    for (const k of Object.keys(window.__msgAcc)) { window.__msgAcc[k].n = 0; window.__msgAcc[k].ms = 0; }
    window.__walkOn = w;
  }, walk);
  const t0 = await page.evaluate(() => performance.now());
  await new Promise((r) => setTimeout(r, ms));
  const res = await page.evaluate((t) => {
    window.__walkOn = false;
    const a = window.__msgAcc;
    const wall = performance.now() - t;
    return { wall, ...JSON.parse(JSON.stringify(a)), lw: (window.__swGame.world ? null : null), stats: null };
  }, t0);
  const lws = await page.evaluate(() => {
    // 诊断面经模块导出函数拿——探针域无 import,读 F5 面等价零;直接算主线程侧已够
    return null;
  });
  const sec = res.wall / 1000;
  console.log(`\n== ${name} == wall=${sec.toFixed(1)}s`);
  for (const k of ['light', 'wave', 'other']) {
    const d = res[k];
    if (d.n === 0) { console.log(`   ${k}: 0 发`); continue; }
    console.log(`   ${k}: ${d.n} 发(${(d.n / sec).toFixed(1)}/s) 总耗时${d.ms.toFixed(1)}ms(${(d.ms / sec).toFixed(2)}ms/s,${(d.ms / d.n * 1000).toFixed(0)}µs/发)`);
  }
}

await window('idle-4s', 4000, false);
await window('walk-4s', 4000, true);
await browser.close();
