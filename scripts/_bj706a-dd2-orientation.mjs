// BJ706-A DD2 三案定向探针:568 枯萎兽/570 德拉肯/574 小妖魔滑翔怪
// ①运行态 dump ②A/B 截图差分=敌怪像素掩码 → 与贴图帧四向(原样/水平翻/竖翻/180°,
//   滑翔怪另加 ±90°)掩码互相关 → 机器判定「画出来的到底是哪个方向」。
import puppeteer from 'puppeteer-core';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5243';
const browser = await puppeteer.launch({
  protocolTimeout: 600000,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__swFlow?.newWorld, { timeout: 120000 });
await page.evaluate(() => window.__swFlow.newWorld('70607060', 4200, 1200));
await page.waitForFunction(() => window.__swGame?.player, { timeout: 300000 });
await new Promise(r => setTimeout(r, 2000));

const res = await page.evaluate(async () => {
  const g = window.__swGame;
  const { Enemy } = await import('/src/entities/Enemy.ts');
  const { TILE } = await import('/src/core/constants.ts');
  const { vanillaFrameIdx } = await import('/src/render/Renderer.ts');
  const st = g.world.store;
  const out = {};

  // ---- 平整场地:清 ±40×±18,铺 3 格厚土 ----
  const bx = Math.floor(g.player.cx / TILE), by = Math.floor(g.player.cy / TILE) + 4;
  for (let dx = -40; dx <= 40; dx++) for (let dy = -18; dy <= 4; dy++) st.setTile(bx + dx, by + dy, 0);
  for (let dx = -40; dx <= 40; dx++) for (let dy = 1; dy <= 3; dy++) st.setTile(bx + dx, by + dy, 1);
  await new Promise(r => setTimeout(r, 400));
  const groundY = by * TILE;
  // 玩家钉在左侧远处（不参与索敌 200px 内门）
  g.player.x = (bx - 30) * TILE; g.player.y = groundY - 60; g.player.vx = 0; g.player.vy = 0;
  await new Promise(r => setTimeout(r, 400));

  // ---- 水晶靶标（DD2 索敌恒咬水晶）----
  const crystal = Enemy.fromVanilla(548, (bx + 26) * TILE, groundY - 44);
  g.entities.add(crystal, 'enemies');
  await new Promise(r => setTimeout(r, 300));

  const cases = [
    { id: 568, name: 'witherBeast' },
    { id: 570, name: 'drakin' },
    { id: 574, name: 'koboldGlider' },
  ];
  for (const c of cases) {
    // 出生在水晶左侧地面（向右走向水晶 → 面朝右）
    const e = Enemy.fromVanilla(c.id, (bx - 14) * TILE, groundY - 60);
    g.entities.add(e, 'enemies');
    const frames = e.vanilla?.frames ?? 1;
    // 驱动 180 拍(约 3s),逐 30 拍采样
    const trace = [];
    for (let i = 0; i <= 180; i++) {
      await new Promise(r => setTimeout(r, 16));
      if (i % 30 === 0) trace.push({
        f: i, x: Math.round(e.x), y: Math.round(e.y), vx: +e.vx.toFixed(3), vy: +e.vy.toFixed(3),
        facing: e.facing, ffSdir: e.ffSdir ?? null, visAngle: +(e.visAngle ?? 0).toFixed(3),
        ai0: e.ai0, ai1: e.ai1, frameIdx: (() => { try { return vanillaFrameIdx(e, frames); } catch { return null; } })(),
        dead: !!e.dead,
      });
    }
    // 采样拍:再等一拍让渲染跟上,取屏幕坐标
    await new Promise(r => setTimeout(r, 60));
    const [scx, scy] = g.camera.worldToScreen(e.cx, e.cy);
    const [scx2] = g.camera.worldToScreen(e.cx + 100, e.cy);
    const pxScale = (scx2 - scx) / 100;
    out[c.name] = {
      id: c.id, trace, frames,
      state: {
        x: e.x, y: e.y, vx: e.vx, vy: e.vy, facing: e.facing, ffSdir: e.ffSdir ?? null,
        visAngle: e.visAngle ?? null, ai0: e.ai0, ai1: e.ai1, w: e.w, h: e.h,
        scx, scy, pxScale, dpr: window.devicePixelRatio,
      },
    };
    e.dead = true;
    await new Promise(r => setTimeout(r, 150));
  }
  crystal.dead = true;
  return out;
});

// ---- 截图采样:A(带怪)−B(清怪) 差分掩码 ----
async function shot(name, state) {
  const pad = 90 * state.pxScale;
  const clip = {
    x: Math.max(0, state.scx - pad), y: Math.max(0, state.scy - pad),
    width: pad * 2, height: pad * 2,
  };
  await new Promise(r => setTimeout(r, 80));
  return await page.screenshot({ clip, type: 'png' });
}
// 重跑三案但这次截图（每案 A/B 两张）
const shots = {};
await page.evaluate(async () => {
  const g = window.__swGame;
  const { Enemy } = await import('/src/entities/Enemy.ts');
  const { TILE } = await import('/src/core/constants.ts');
  const st = g.world.store;
  const bx = Math.floor(g.player.cx / TILE), by = Math.floor(g.player.cy / TILE) + 4;
  const groundY = by * TILE;
  g.player.x = (bx - 30) * TILE; g.player.y = groundY - 60; g.player.vx = 0; g.player.vy = 0;
  const crystal = Enemy.fromVanilla(548, (bx + 26) * TILE, groundY - 44);
  g.entities.add(crystal, 'enemies');
  window.__bj706a = { crystal, bx, groundY };
});
for (const [name, id] of [['witherBeast', 568], ['drakin', 570], ['koboldGlider', 574]]) {
  const info = await page.evaluate(async (id, name) => {
    const g = window.__swGame;
    const { Enemy } = await import('/src/entities/Enemy.ts');
    const { bx, groundY } = window.__bj706a;
    const { TILE } = await import('/src/core/constants.ts');
    const e = Enemy.fromVanilla(id, (bx - 14) * TILE, groundY - 60);
    g.entities.add(e, 'enemies');
    await new Promise(r => setTimeout(r, 1600));   // 走稳几拍
    const [scx, scy] = g.camera.worldToScreen(e.cx, e.cy);
    const [scx2] = g.camera.worldToScreen(e.cx + 100, e.cy);
    window.__bj706a.enemy = e;
    return { scx, scy, pxScale: (scx2 - scx) / 100, vx: e.vx, vy: e.vy, facing: e.facing, visAngle: e.visAngle ?? null, x: e.x, y: e.y };
  }, id, name);
  shots[name] = { info, A: await shot(name, info) };
  await page.evaluate(() => { window.__bj706a.enemy.dead = true; });
  shots[name].B = await shot(name, info);
}
await browser.close();

import { writeFileSync } from 'node:fs';
for (const name of Object.keys(shots)) {
  writeFileSync(`/tmp/bj706a-${name}-A.png`, shots[name].A);
  writeFileSync(`/tmp/bj706a-${name}-B.png`, shots[name].B);
}
console.log('=== runtime state ===');
console.log(JSON.stringify(res, null, 1));
console.log('=== shot meta ===');
console.log(JSON.stringify(Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, v.info])), null, 1));
