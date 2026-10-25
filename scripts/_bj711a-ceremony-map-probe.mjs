// BJ711-A 仪式区地形几何 dump:四教徒+石碑 vs 地牢入口结构(可见性判读)
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.env.SW_ORIGIN ?? 'http://localhost:5254';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${ORIGIN}/?play=small&beh=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
let inGame = false;
for (let i = 0; i < 90 && !inGame; i++) {
  inGame = await page.evaluate(() => !!(window.__swGame && window.__swGame.renderer)).catch(() => false);
  if (!inGame) await new Promise((r) => setTimeout(r, 2000));
}
if (!inGame) { console.error('未进游戏'); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if ((b.textContent || '').includes('我已知晓')) { b.click(); break; }
  }
});

const setup = await page.evaluate(() => {
  const g = window.__swGame;
  const w = g.world;
  w.flags.hardMode = true; w.flags['downed_245'] = true; w.flags.downedSkeletron = true;
  w.cultistDelay = 0;
  g.entities.enemies.length = 0;
  return { dX: w.dungeonX, dY: w.dungeonY, surf: w.groundLevel };
});
console.log('setup:', JSON.stringify(setup));

let tab = null;
for (let i = 0; i < 40 && !tab; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  tab = await page.evaluate(() => {
    const g = window.__swGame;
    const t = g.entities.enemies.find((e) => e.vanillaId === 437 && !e.dead);
    return t ? { id: t.id, tx: Math.floor(t.cx / 16), ty: Math.floor(t.cy / 16), cx: t.cx, cy: t.cy } : null;
  });
}
if (!tab) { console.log('石碑未出生'); await browser.close(); process.exit(2); }
await new Promise((r) => setTimeout(r, 2500));

const dump = await page.evaluate((ttx, tty) => {
  const g = window.__swGame;
  const st = g.world.store;
  const kids = g.entities.enemies.filter((e) => !e.dead && (e.vanillaId === 438 || e.vanillaId === 379));
  const marks = new Map();
  marks.set(`${ttx},${tty}`, 'T');
  for (const k of kids) marks.set(`${Math.floor(k.cx / 16)},${Math.floor((k.y + k.h) / 16)}`, k.vanillaId === 438 ? 'D' : 'A');
  // 判读面:每教徒头顶到地表(向上扫至首个全空行/天空)是否被结构顶遮挡
  const occl = kids.map((k) => {
    const col = Math.floor(k.cx / 16);
    const top = Math.floor(k.y / 16);
    let cover = -1;
    for (let y = top - 1; y > top - 30; y--) { if (st.isSolid(col, y)) { cover = y; break; } }
    return { vid: k.vanillaId, col, coverAbove: cover };
  });
  // ASCII 图:列 ttx-22..ttx+22,行 tty-14..tty+16
  const lines = [];
  for (let y = tty - 14; y <= tty + 16; y++) {
    let row = '';
    for (let x = ttx - 22; x <= ttx + 22; x++) {
      const m = marks.get(`${x},${y}`);
      if (m) { row += m; continue; }
      if (st.isSolid(x, y)) row += '#';
      else if (st.isPlatform(x, y)) row += '=';
      else if (y >= st.h) row += ' ';
      else {
        const wl = st.wallAt?.(x, y);
        row = row + (wl && wl > 0 ? 'w' : (st.liquidAt?.(x, y) ? '~' : '.'));
      }
    }
    lines.push(`${String(y).padStart(4)} ${row}`);
  }
  return { lines, occl, dX: g.world.dungeonX, dY: g.world.dungeonY };
}, tab.tx, tab.ty);
console.log(`dungeon anchor: (${dump.dX}, ${dump.dY})`);
console.log(dump.lines.join('\n'));
console.log('occl:', JSON.stringify(dump.occl));
console.log('errors:', JSON.stringify(errors.slice(0, 5)));
await browser.close();
