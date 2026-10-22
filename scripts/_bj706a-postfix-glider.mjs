// BJ706-A 附8:修复后滑翔怪/枯萎兽/德拉肯活体验证(vite 5243,无头轨迹)
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
  const st = g.world.store;
  const bx = Math.floor(g.player.cx / TILE), by = Math.floor(g.player.cy / TILE) + 4;
  for (let dx = -40; dx <= 40; dx++) for (let dy = -18; dy <= 4; dy++) st.setTile(bx + dx, by + dy, 0);
  for (let dx = -40; dx <= 40; dx++) for (let dy = 1; dy <= 3; dy++) st.setTile(bx + dx, by + dy, 1);
  await new Promise(r => setTimeout(r, 400));
  const groundY = by * TILE;
  g.player.x = (bx - 30) * TILE; g.player.y = groundY - 60; g.player.vx = 0; g.player.vy = 0;
  await new Promise(r => setTimeout(r, 400));
  const crystal = Enemy.fromVanilla(548, (bx + 26) * TILE, groundY - 44);
  g.entities.add(crystal, 'enemies');
  await new Promise(r => setTimeout(r, 200));

  const out = {};
  // 滑翔怪:与水晶同高,采 90 拍轨迹
  {
    const e = Enemy.fromVanilla(574, (bx - 14) * TILE, crystal.cy - 19);
    g.entities.add(e, 'enemies');
    const x0 = e.x;
    const traj = [];
    for (let i = 0; i <= 90; i += 15) {
      await new Promise(r => setTimeout(r, 15 * 16));
      traj.push({ f: i, x: Math.round(e.x - x0), vx: +e.vx.toFixed(2), vy: +e.vy.toFixed(2), ai0: e.ai0, visA: +(e.visAngle ?? 0).toFixed(2) });
    }
    out.glider = { traj, dxTotal: Math.round(e.x - x0), dyTotal: Math.round(e.y - (crystal.cy - 19)) };
    e.dead = true;
    await new Promise(r => setTimeout(r, 100));
  }
  // 枯萎兽/德拉肯:向远处水晶行进,采帧序
  for (const [name, id] of [['witherBeast', 568], ['drakin', 570]]) {
    const e = Enemy.fromVanilla(id, (bx - 14) * TILE, groundY - 60);
    g.entities.add(e, 'enemies');
    await new Promise(r => setTimeout(r, 2400));
    const frames = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 32));
      frames.push(e.customFrameIdx ?? null);
    }
    out[name] = { frames: [...new Set(frames)], vx: +e.vx.toFixed(2), moving: Math.abs(e.vx) > 0.1 };
    e.dead = true;
    await new Promise(r => setTimeout(r, 100));
  }
  crystal.dead = true;
  return out;
});
await browser.close();
console.log(JSON.stringify(res, null, 1));
console.log('errs:', errs);
