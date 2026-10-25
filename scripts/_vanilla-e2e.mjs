// 全链 E2E 探针（2026-10-25）：?vanilla= 入口 → makeGame → joinVanillaGame →
// World 装配 → loadWorld → 进游戏渲染。验证=世界名/尺寸/tile 抽查/玩家出生/net 态 + 截图。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-e2e.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-e2e-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (/vanilla|error|Error/i.test(t)) log(`C[${m.type()}] ${t.slice(0, 200)}`); });
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 300)}`));
await page.goto('http://localhost:5204/?vanilla=127.0.0.1:7781', { waitUntil: 'domcontentloaded' });

let entered = false;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const st = await page.evaluate(() => {
    const g = globalThis.__swGame;
    if (!g) return { phase: 'no-game' };
    const w = g.world;
    return {
      phase: 'game',
      world: w ? { name: w.name, w: w.w, h: w.h, spawn: [w.spawnX, w.spawnY], crimson: w.crimson } : null,
      net: g.net ? { active: g.net.active, slot: g.net.mySlot ?? g.net.mySlot, sections: g.net.sectionsReceived, processed: g.net.processedCount } : null,
      player: g.player ? { x: Math.round(g.player.x / 16), y: Math.round(g.player.y / 16), dead: g.player.dead } : null,
      uiMode: g.menuMode ?? g.mode ?? null,
    };
  }).catch((e) => ({ err: String(e).slice(0, 120) }));
  log(`t+${i}s ${JSON.stringify(st).slice(0, 300)}`);
  if (st?.world && st?.net?.active) { entered = true; break; }
  if (st?.err) break;
}

if (entered) {
  await new Promise((r) => setTimeout(r, 3000));
  // tile 抽查：出生点附近扫描非空 tile 数（世界数据真落地的铁证）
  const probe = await page.evaluate(() => {
    const g = globalThis.__swGame;
    const w = g.world, p = g.player;
    let solid = 0, air = 0, total = 0;
    const x0 = Math.max(0, Math.floor(p.x / 16) - 40), y0 = Math.max(0, Math.floor(p.y / 16) - 30);
    for (let y = y0; y < y0 + 60 && y < w.h; y++) for (let x = x0; x < x0 + 80 && x < w.w; x++) {
      total++;
      if (w.store.get(x, y)?.type) solid++; else air++;
    }
    return {
      scan: { total, solid, air },
      clock: { t: w.clock.timeOfDay.toFixed(3), day: w.clock.dayCount, blood: w.clock.bloodMoon },
      lighting: !!g.lighting, renderer: !!g.renderer,
      tilesSeen: g.chunks ? Object.keys(g.chunks?._cache ?? g.chunks ?? {}).length : null,
    };
  }).catch((e) => ({ err: String(e).slice(0, 200) }));
  log('WORLD-PROBE ' + JSON.stringify(probe).slice(0, 400));
  await page.screenshot({ path: '/tmp/vanilla-e2e.png' });
  log('截图 → /tmp/vanilla-e2e.png');
  // 10s 稳态观察:net 流是否持续(服务器在跑 NPC 同步)
  const before = await page.evaluate(() => globalThis.__swGame.net.processedCount);
  await new Promise((r) => setTimeout(r, 10000));
  const after = await page.evaluate(() => ({ n: globalThis.__swGame.net.processedCount, act: globalThis.__swGame.net.active }));
  log(`稳态流: ${before} → ${after.n}（Δ=${after.n - before},active=${after.act}）`);
  await page.screenshot({ path: '/tmp/vanilla-e2e-10s.png' });
  log(entered && after.n > before ? '★E2E-PASS:进入世界+持续接收服务器流' : '✗E2E-半红:进入但流停滞');
} else {
  await page.screenshot({ path: '/tmp/vanilla-e2e-fail.png' });
  log('✗E2E-FAIL:30s 未进世界（截图 /tmp/vanilla-e2e-fail.png）');
}
await browser.close();
process.exit(entered ? 0 : 1);
