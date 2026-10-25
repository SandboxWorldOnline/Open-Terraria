// E2E 状态解剖探针：进世界后 dump 游戏态（菜单/幕布/相机/画布层/正确 API tile 扫描）。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-e2e-state.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-st-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 300)}`));
await page.goto('http://localhost:5204/?vanilla=127.0.0.1:7781', { waitUntil: 'domcontentloaded' });

let ok = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const st = await page.evaluate(() => {
    const g = globalThis.__swGame;
    return g ? { net: g.net?.active, world: !!g.world?.store, p: !!g.player } : null;
  }).catch(() => null);
  if (st?.net && st?.world && st?.p) { ok = true; break; }
}
log('entered=' + ok);
if (ok) {
  await new Promise((r) => setTimeout(r, 2500));
  const dump = await page.evaluate(() => {
    const g = globalThis.__swGame;
    const w = g.world, p = g.player;
    // 正确 API:store.get(x,y) 直接返回 tile type 数字
    let solid = 0, total = 0;
    const x0 = Math.max(0, w.spawnX - 40), y0 = Math.max(0, w.spawnY - 30);
    for (let y = y0; y < y0 + 60; y++) for (let x = x0; x < x0 + 80; x++) { total++; if (w.store.get(x, y)) solid++; }
    // 出生点垂直扫描:找地表
    let groundY = -1;
    for (let y = Math.max(0, w.spawnY - 60); y < Math.min(w.h, w.spawnY + 60); y++) {
      if (w.store.get(w.spawnX, y)) { groundY = y; break; }
    }
    const cam = g.camera ?? g.cam;
    return {
      menuMode: g.menuMode ?? null,
      mode: g.mode ?? null,
      paused: g.paused ?? null,
      inWorld: g.inWorld ?? null,
      playerPos: [Math.round(p.x / 16), Math.round(p.y / 16)],
      camPos: cam ? [Math.round(cam.x / 16), Math.round(cam.y / 16)] : null,
      scan: { solid, total },
      groundY,
      storeNonNull: (() => { let n = 0; for (let i = 0; i < 20000; i++) { const x = (i * 7919) % w.w, y = (i * 104729) % w.h; if (w.store.get(x, y)) n++; } return n; })(),
      domLayers: Array.from(document.querySelectorAll('canvas, .curtain, [class*=progress], [class*=load]')).slice(0, 12).map((el) => ({
        tag: el.tagName, cls: String(el.className).slice(0, 40),
        vis: el.offsetParent !== null || getComputedStyle(el).position === 'fixed',
        z: getComputedStyle(el).zIndex, o: getComputedStyle(el).opacity,
      })),
      bodyChildren: Array.from(document.body.children).map((el) => el.tagName + '.' + String(el.className).slice(0, 30)).slice(0, 10),
    };
  }).catch((e) => ({ err: String(e).slice(0, 300) }));
  log('STATE ' + JSON.stringify(dump, null, 1).slice(0, 2200));
  await page.screenshot({ path: '/tmp/vanilla-e2e-state.png' });
  log('截图 /tmp/vanilla-e2e-state.png');
}
await browser.close();
process.exit(0);
