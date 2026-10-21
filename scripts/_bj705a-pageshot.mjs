import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, Ledger } from '../tools/probe/lib/index.mjs';
const L = new Ledger();
const OUT = '/tmp/probe-out/_bj705a-dist';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PIN = async ({ ticks }) => {
  const st = window.__bj705aPin;
  const g = window.__swGame;
  for (let i = 0; i < ticks; i++) {
    g.fixedUpdate(1 / 60);
    if (st.e && !st.e.dead) { st.e.x = st.ex; st.e.y = st.ey; st.e.vx = 0; st.e.vy = 0; }
    if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
  }
};
const browser = await launchBrowser({});
try {
  const page = await openPage(browser, { errors: L.fails });
  page.__probeOrigin = process.env.SW_ORIGIN;
  const boot = await bootstrap(page, process.env.SW_ORIGIN);
  L.chk('bootstrap', boot.ok, boot.why ?? '');
  const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
  L.chk('createGame', gen.ok, gen.why ?? '');
  await godMode(page, true);
  await clearEnemies(page);
  await pump(page, 30);
  await page.evaluate(() => { window.__swGame.world.clock.timeOfDay = 0.5; });
  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn', sp.ok, '');
  await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50 };
  }, { ex: EX, ey: EY });
  await page.evaluate(PIN, { ticks: 120 });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/page-with-enemy.png` });
  await page.evaluate(() => { window.__swGame.entities.enemies.length = 0; });
  await page.evaluate(PIN, { ticks: 6 });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/page-no-enemy.png` });
  L.say('page shots saved');
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
