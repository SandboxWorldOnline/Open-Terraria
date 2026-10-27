// ★worker 消息普查探针(2026-10-27 任务#26 定谳前置):常驻债审计量到 postMessage
// idle 4.2/帧→walk 12.3/帧(14624/10s)——本探针按【worker 脚本×消息 op】分解这笔账,
// 找出脏标门该挂在哪条链上。
// 方法:包 Worker.prototype.postMessage(创建后的实例都吃),按 worker 脚本短名+op
// 字段分类计数;idle 3s + walk 3s 两窗,输出 条/秒 + 条/渲染帧。
// 运行:SW_ORIGIN=http://localhost:5175 node tools/run-diag.mjs scripts/_worker-msg-census-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5175';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261027 });
await pump(page, 40);
await new Promise((r) => setTimeout(r, 6000));   // 稳态(首烘/预热出窗)

// ---- 装普查器(游戏 loop 之前注册的 worker 已建实例也要吃:原型包裹覆盖全体) ----
await page.evaluate(() => {
  const raw = Worker.prototype.postMessage;
  window.__msgCensus = new Map();   // key: "workerShort|op" -> count
  window.__msgWin = null;           // {t0, frames} 当前窗
  Worker.prototype.postMessage = function (msg, transfer) {
    try {
      let op = '?';
      if (msg && typeof msg === 'object') {
        op = String(msg.op ?? msg.type ?? msg.cmd ?? (typeof msg[0] === 'string' ? msg[0] : 'obj'));
      } else if (typeof msg === 'string') op = 'str:' + msg.slice(0, 12);
      // worker 脚本短名:this 无 scriptURL——用构造时的记录(new Worker 包裹)
      const key = `${(this && this.__swScript) || 'preexisting'}|${op}`;
      const win = window.__msgWin;
      if (win) win.map.set(key, (win.map.get(key) ?? 0) + 1);
    } catch { /* 计数失败不影响消息 */ }
    return raw.call(this, msg, transfer);
  };
  const RawWorker = Worker;
  window.Worker = class extends RawWorker {
    constructor(url, opts) {
      super(url, opts);
      try { this.__swScript = String(url).split('?')[0].split('/').slice(-1)[0].slice(0, 24); } catch { /* */ }
    }
  };
  // 已建 worker 实例的脚本名(事后侦察:从各链路诊断面拿不到就标 preexisting——
  // 主要链路(light/wave/bake/save)都在游戏启动后惰性建,createGame 后大概率可裹全)
});
await new Promise((r) => setTimeout(r, 300));

async function census(name, ms, walk) {
  const frames0 = await page.evaluate(() => window.__swGame['_paintedFrames']);
  await page.evaluate((w) => {
    const g = window.__swGame;
    g.entities.enemies.length = 0; g.entities.projectiles.length = 0;
    window.__walkOn = w;
  }, walk);
  await page.evaluate(() => {
    window.__msgWin = { t0: performance.now(), map: new Map() };
    if (!window.__walkDriver) {
      window.__walkDriver = true;
      const w = () => { if (window.__walkOn) window.__swGame.player.vx = 4; requestAnimationFrame(w); };
      requestAnimationFrame(w);
    }
  });
  await new Promise((r) => setTimeout(r, ms));
  const res = await page.evaluate(() => {
    const win = window.__msgWin;
    window.__msgWin = null;
    window.__walkOn = false;
    return {
      wallMs: performance.now() - win.t0,
      frames: window.__swGame['_paintedFrames'],
      counts: [...win.map.entries()].sort((a, b) => b[1] - a[1]),
    };
  });
  const sec = res.wallMs / 1000;
  const dframes = res.frames - frames0;
  const total = res.counts.reduce((s, [, n]) => s + n, 0);
  console.log(`\n== ${name} == wall=${(res.wallMs / 1000).toFixed(1)}s 渲染帧=${dframes}(${(dframes / sec).toFixed(0)}fps) 消息总数=${total}(${(total / sec).toFixed(0)}/s,${(total / Math.max(1, dframes)).toFixed(2)}/帧)`);
  for (const [k, n] of res.counts.slice(0, 20)) console.log(`   ${(n / sec).toFixed(1).padStart(7)}/s ${(n / Math.max(1, dframes)).toFixed(2).padStart(6)}/帧  n=${String(n).padStart(6)}  ${k}`);
}

await census('idle-3s', 3000, false);
await census('walk-3s', 3000, true);
await browser.close();
