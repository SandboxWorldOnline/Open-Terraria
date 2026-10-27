// ★?framecap=N URL 覆写口冒烟探针(2026-10-27)
// 验证:?framecap=0 页面 Game 拿到 cap=0(跟满档「关」:恒渲不锁不监测),逐 rAF 回调
//  全渲染(painted 增速=回调流率,不受累计器门跳帧);对照页(无参)cap=用户档(缺省 120)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs scripts/_framecap-url-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});

async function check(q, label) {
  const page = await openPage(browser, {});
  await bootstrap(page, ORIGIN + '/' + q);
  await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261027 });
  await pump(page, 10);
  const r = await page.evaluate(() => {
    const g = window.__swGame;
    return {
      cap: g.beat.cap,                 // observeVsync 收到的档值(URL 覆写后)
      userOption: (window.__swOptions ?? null),   // 设置面读数不动的旁证(缺省 120)
      painted0: g['_paintedFrames'],
    };
  });
  // 跑 1s 真实 rAF 流,数 painted 增量(跟满=每回调皆渲)
  await new Promise((r2) => setTimeout(r2, 1000));
  const r2 = await page.evaluate(() => {
    const g = window.__swGame;
    return { painted1: g['_paintedFrames'], effTier: g.beat.effTier, fps: Math.round(1000 / (g.frameDts.at(-1) || 16.7)) };
  });
  const dts = await page.evaluate(() => window.__swGame.frameDts.slice(-30));
  const meanDt = dts.reduce((a, b) => a + b, 0) / dts.length;
  console.log(`[${label}] cap=${r.cap} effTier=${r2.effTier} 1s内渲染帧=${r2.painted1 - r.painted0}(≈${r2.painted1 - r.painted0}fps) 尾窗均帧距=${meanDt.toFixed(1)}ms`);
  await page.close();
  return { cap: r.cap, framesPerSec: r2.painted1 - r.painted0 };
}

const off = await check('?framecap=0&cloudcache=0', '?framecap=0 (跟满=禁用调度)');
const def = await check('?cloudcache=0', '无参对照(用户档缺省 120)');
console.log(`[判定] 覆写页 cap=${off.cap}(${off.cap === 0 ? '✓0=跟满' : '✗'}) vs 对照页 cap=${def.cap}(${def.cap === 120 ? '✓120=用户档' : '用户档非120,注意'})`);
console.log(`[判定] 跟满页 1s 渲染 ${off.framesPerSec} 帧 vs 锁120页 ${def.framesPerSec} 帧(跟满应≈回调流率,headless 无vsync≈60)`);
await browser.close();
