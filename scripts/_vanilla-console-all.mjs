// 全量 console 探针：不过滤,找天空/贴图/幕布报错;同时 dump sky/幕布运行时态。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-con.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-co-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 300)}`));
page.on('console', (m) => log(`C[${m.type()}] ${m.text().slice(0, 250)}`));
await page.goto('http://localhost:5204/?vanilla=127.0.0.1:7781', { waitUntil: 'domcontentloaded' });

let ok = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const st = await page.evaluate(() => {
    const g = globalThis.__swGame;
    return g && g.net?.active && g.world?.store && g.player ? true : false;
  }).catch(() => false);
  if (st) { ok = true; break; }
}
log('# entered=' + ok);
if (ok) {
  await new Promise((r) => setTimeout(r, 8000));
  const d = await page.evaluate(() => {
    const g = globalThis.__swGame;
    const sky = g.renderer?.sky;
    // 幕布/进度层 DOM 态
    const layers = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const s = getComputedStyle(el);
      return (s.position === 'fixed' || s.position === 'absolute') && s.display !== 'none' && s.opacity !== '0'
        && el.offsetWidth > 500 && el.offsetHeight > 400;
    }).map((el) => ({ cls: String(el.className).slice(0, 50), z: getComputedStyle(el).zIndex, o: getComputedStyle(el).opacity, bg: getComputedStyle(el).backgroundColor }));
    return {
      skyState: sky ? {
        moonType: sky.moonType,
        texKeys: sky.tex ? Object.keys(sky.tex).length : null,
        ready: typeof sky.ready === 'boolean' ? sky.ready : null,
      } : null,
      bigLayers: layers,
      clockNow: { t: +g.world.clock.timeOfDay.toFixed(3), isDay: g.world.clock.isDay, dayF: +g.world.clock.dayFactor.toFixed(2) },
    };
  }).catch((e) => ({ err: String(e).slice(0, 300) }));
  log('# STATE ' + JSON.stringify(d, null, 1));
}
await browser.close();
