// 画布层审计：每个 canvas 元素的位置/尺寸/内容像素——找天空亮蓝被谁吃了。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-cv.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-cv-' + (Date.now() % 100000),
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
  await new Promise((r) => setTimeout(r, 6000));
  const d = await page.evaluate(() => {
    const g = globalThis.__swGame;
    const canvases = Array.from(document.querySelectorAll('canvas')).map((c, i) => {
      let sample = null;
      try {
        const ctx = c.getContext('2d');
        if (ctx) {
          const px = ctx.getImageData(c.width >> 1, c.height >> 2, 1, 1).data;
          const px2 = ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
          sample = [[...px.slice(0, 4)], [...px2.slice(0, 4)]];
        } else {
          sample = 'webgl-or-occupied';
        }
      } catch (e) { sample = 'err:' + String(e).slice(0, 40); }
      const s = getComputedStyle(c);
      return {
        i, w: c.width, h: c.height, cls: String(c.className).slice(0, 20),
        css: { pos: s.position, z: s.zIndex, o: s.opacity, w: s.width, h: s.height, display: s.display, filt: s.filter },
        sample,
      };
    });
    return {
      canvases,
      c10eFrame: g.renderer._c10eFrame ?? null,
      skyCots: g.renderer.sky.cots,
      skyLastTop: g.renderer.sky.lastSkyTop,
      hasSkyCtx: !!g.renderer.skyCtx,
    };
  }).catch((e) => ({ err: String(e).slice(0, 300) }));
  log(JSON.stringify(d, null, 1).slice(0, 3000));
  await page.screenshot({ path: '/tmp/vanilla-cv.png' });
}
await browser.close();
