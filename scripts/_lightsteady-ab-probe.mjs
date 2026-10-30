// ★稳态门活体 A/B 探针(任务#26):?lightsteady 等价运行时翻面(bootstrap 会洗 URL
// 参数——模块 setter 直翻,let 导出活绑定)。量:light 发送率(idle 期望 60→15/s)、
// steadySkips 对账、回包健康(results 按发率到达/falls=0/lagMs 合理)。
// 运行:SW_ORIGIN=http://localhost:5208 node tools/run-diag.mjs scripts/_lightsteady-ab-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5208';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261027 });
await pump(page, 40);
await new Promise((r) => setTimeout(r, 6000));

await page.evaluate(async () => {
  const m = await import('/src/lighting/LightWorkerLink.ts');
  window.__setSteady = m.setLightSteadyEnabled;
  window.__lwStats = m.lightWorkerStats;
  window.__setSteady(false);
});

async function window(name, ms) {
  const s0 = await page.evaluate(() => {
    const s = window.__lwStats();
    return { posted: s.posted, results: s.results, steadySkips: s.steadySkips, falls: s.falls, lagMs: s.lagMs };
  });
  await new Promise((r) => setTimeout(r, ms));
  const s1 = await page.evaluate(() => {
    const s = window.__lwStats();
    return { posted: s.posted, results: s.results, steadySkips: s.steadySkips, falls: s.falls, lagMs: s.lagMs, live: null };
  });
  const sec = ms / 1000;
  console.log(`[${name}] 发送=${((s1.posted - s0.posted) / sec).toFixed(1)}/s 回包=${((s1.results - s0.results) / sec).toFixed(1)}/s 稳态跳=${((s1.steadySkips - s0.steadySkips) / sec).toFixed(1)}/s falls=${s1.falls - s0.falls} lag=${s1.lagMs}ms`);
}

await page.evaluate(() => window.__setSteady(false));
await window('idle 旗关(现状对照)', 4000);
await page.evaluate(() => window.__setSteady(true));
await new Promise((r) => setTimeout(r, 1000));   // 旗生效过渡拍
await window('idle 旗开(期望发送 60→≈15/s,跳≈45/s)', 4000);
await page.evaluate(() => window.__setSteady(false));
await browser.close();
