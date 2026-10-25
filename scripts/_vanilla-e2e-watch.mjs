// E2E 长观察探针：60s 每 10s 截图+帧计数,看渲染从黑到世界的演化。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-watch.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-wt-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
page.on('console', (m) => { const t = m.text(); if (/vanilla|rload|渲染|render|light|chunk/i.test(t)) log(`C ${t.slice(0, 120)}`); });
await page.goto('http://localhost:5204/?vanilla=127.0.0.1:7781', { waitUntil: 'domcontentloaded' });

for (let i = 0; i <= 6; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const st = await page.evaluate(() => {
    const g = globalThis.__swGame;
    if (!g) return { phase: 'no-game' };
    return {
      net: g.net?.active, frames: g.frameCount ?? g.frames ?? null,
      processed: g.net?.processedCount,
      vimages: globalThis.__vimages ?? null,
    };
  }).catch((e) => ({ err: String(e).slice(0, 100) }));
  log(`t+${(i + 1) * 10}s ${JSON.stringify(st)}`);
  await page.screenshot({ path: `/tmp/vanilla-watch-${(i + 1) * 10}.png` });
}
log('done');
await browser.close();
process.exit(0);
