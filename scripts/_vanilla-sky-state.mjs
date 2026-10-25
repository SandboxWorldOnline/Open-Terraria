// 天空色运行时问诊：直接读 cots/fx/atmo/lastSky* 实值。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-sky.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-sk-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/?vanilla=127.0.0.1:7781', { waitUntil: 'domcontentloaded' });

let ok = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  ok = await page.evaluate(() => {
    const g = globalThis.__swGame;
    return !!(g && g.net?.active && g.world?.store && g.player && g.renderer?.sky);
  }).catch(() => false);
  if (ok) break;
}
log('entered=' + ok);
if (ok) {
  await new Promise((r) => setTimeout(r, 5000));
  const d = await page.evaluate(() => {
    const g = globalThis.__swGame;
    const sky = g.renderer.sky;
    const cam = g.camera ?? g.cam;
    return {
      clock: { t: +g.world.clock.timeOfDay.toFixed(3), isDay: g.world.clock.isDay, dayF: +g.world.clock.dayFactor.toFixed(2) },
      cam: cam ? { x: Math.round(cam.x), y: Math.round(cam.y), units: 'px?' } : null,
      fx: sky.fx,
      cots: sky.cots,
      rendererCots: g.renderer.colorOfTheSkies ?? null,
      lastSkyTop: sky.lastSkyTop ?? null,
      lastSkyBottom: sky.lastSkyBottom ?? null,
      atmo: typeof sky.atmoValue === 'function' ? +sky.atmoValue(cam?.y ?? 0).toFixed(3) : null,
      groundLevel: g.world.groundLevel,
      viewW: g.renderer.viewW ?? null, viewH: g.renderer.viewH ?? null,
      z: g.renderer.z ?? g.renderer._z ?? null,
    };
  }).catch((e) => ({ err: String(e).slice(0, 300) }));
  log(JSON.stringify(d, null, 1));
}
await browser.close();
