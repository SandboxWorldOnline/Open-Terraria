// BJ711-A 多世界普查:自然仪式四教徒落位几何(数量/高差/围蔽)变异率
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.env.SW_ORIGIN ?? 'http://localhost:5254';
const N = Number(process.env.SW_SURVEY_N ?? 4);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
for (let run = 0; run < N; run++) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/?play=small&beh=${Date.now()}${run}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let inGame = false;
  for (let i = 0; i < 90 && !inGame; i++) {
    inGame = await page.evaluate(() => !!(window.__swGame && window.__swGame.renderer)).catch(() => false);
    if (!inGame) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!inGame) { console.log(`run${run}: 未进游戏`); await page.close(); continue; }
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if ((b.textContent || '').includes('我已知晓')) { b.click(); break; }
    }
  });
  const r = await page.evaluate(async () => {
    const g = window.__swGame;
    const w = g.world;
    w.flags.hardMode = true; w.flags['downed_245'] = true; w.flags.downedSkeletron = true;
    w.cultistDelay = 0;
    g.entities.enemies.length = 0;
    // 轮询 90s 等 437
    for (let i = 0; i < 90; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      if (g.entities.enemies.some((e) => e.vanillaId === 437 && !e.dead)) break;
    }
    await new Promise((res) => setTimeout(res, 2500));
    const st = w.store;
    const tab = g.entities.enemies.find((e) => e.vanillaId === 437 && !e.dead);
    if (!tab) return { ok: false, why: 'no-tablet' };
    const kids = g.entities.enemies.filter((e) => !e.dead && (e.vanillaId === 438 || e.vanillaId === 379));
    const geom = kids.map((k) => {
      const col = Math.floor(k.cx / 16);
      const feetY = Math.floor((k.y + k.h) / 16);
      // 围蔽判读:左右 1 格同高邻列是否有墙(侧包),头顶 12 格内首个实心(顶盖距)
      const sideWalls = st.isSolid(col - 1, feetY - 1) || st.isSolid(col + 1, feetY - 1);
      let cover = -1;
      for (let y = feetY - 2; y > feetY - 30; y--) { if (st.isSolid(col, y)) { cover = feetY - y; break; } }
      return { vid: k.vanillaId, col, feetY, sideWalls, coverGap: cover };
    });
    return {
      ok: true, dX: w.dungeonX, dY: w.dungeonY,
      tabTx: Math.floor(tab.cx / 16), tabTy: Math.floor(tab.cy / 16),
      n438: kids.filter((e) => e.vanillaId === 438).length,
      n379: kids.filter((e) => e.vanillaId === 379).length,
      tabletDead: tab.dead, geom,
    };
  });
  console.log(`run${run}:`, JSON.stringify(r));
  await page.close();
}
await browser.close();
