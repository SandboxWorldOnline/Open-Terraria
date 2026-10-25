// 出生点微解剖：列类型网格 + 玩家物理态 + 时钟/地表线 + 光照态。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-col.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-cl-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/?vanilla=127.0.0.1:7781', { waitUntil: 'domcontentloaded' });

let ok = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const st = await page.evaluate(() => {
    const g = globalThis.__swGame;
    return g && g.net?.active && g.world?.store ? true : false;
  }).catch(() => false);
  if (st) { ok = true; break; }
}
log('entered=' + ok);
if (ok) {
  await new Promise((r) => setTimeout(r, 4000));
  const d = await page.evaluate(() => {
    const g = globalThis.__swGame;
    const w = g.world, p = g.player;
    // 出生点 12×32 类型网格（x 2100-2111, y 215-246）
    const grid = [];
    for (let y = 215; y < 247; y++) {
      let row = '';
      for (let x = 2100; x < 2112; x++) {
        const t = w.store.get(x, y);
        row += t === 0 ? '·' : (t < 10 ? String(t) : (t < 36 ? String.fromCharCode(87 + t) : '#')); // 0-9数字,A-Z 字母,其他#
      }
      grid.push(y + ' ' + row);
    }
    const firstSolid = {};
    for (const dx of [-8, -4, 0, 4, 8]) {
      const x = w.spawnX + dx;
      let fy = -1;
      for (let y = 160; y < 300; y++) { if (w.store.get(x, y)) { fy = y; break; } }
      firstSolid['x' + (w.spawnX + dx)] = fy;
    }
    return {
      grid: grid.join('\n'),
      firstSolid,
      spawn: [w.spawnX, w.spawnY],
      ground: [w.groundLevel, w.rockLevel, w.lavaLine],
      clock: { t: +w.clock.timeOfDay.toFixed(3), day: w.clock.dayCount, blood: w.clock.bloodMoon, moon: w.clock.moonPhase },
      player: {
        px: Math.round(p.x / 16), py: Math.round(p.y / 16), vy: +p.vy.toFixed(1),
        onGround: p.onGround ?? null, dead: p.dead,
      },
      lighting: { dirty: g.lighting?.dirty, mode: g.lighting?.constructor?.name },
      cam: g.camera ? [Math.round(g.camera.x / 16), Math.round(g.camera.y / 16)] : null,
    };
  }).catch((e) => ({ err: String(e).slice(0, 300) }));
  log(JSON.stringify({ ...d, grid: undefined }, null, 1));
  log('--- 出生网格 (x2100-2111, 0-9=tile id, A-Z=10-35, #=其他, ·=空) ---');
  log(d.grid ?? d.err ?? 'N/A');
}
await browser.close();
process.exit(0);
