import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, Ledger } from '../tools/probe/lib/index.mjs';
const L = new Ledger();
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
  const bad = [];
  page.on('requestfailed', (req) => bad.push(`FAIL ${req.url()} ${req.failure()?.errorText}`));
  page.on('response', (res) => { if (res.status() >= 400) bad.push(`${res.status()} ${res.url()}`); });
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
  const sp = await spawnEnemy(page, 327, anchor.px + 150, anchor.py - 120);
  L.chk('spawn', sp.ok, '');
  await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50 };
  }, { ex: anchor.px + 150, ey: anchor.py - 120 });
  await page.evaluate(PIN, { ticks: 120 });
  await sleep(1500);
  const meta = await page.evaluate(() => {
    const g = window.__swGame;
    const at = g.renderer.atlas;
    const r0 = at.vnpc(327, 0);
    const r1 = at.vnpc(327, 0);  // 二连调:lazy 加载后再取
    return { first: r0 ? [r0.sx, r0.sy, r0.sw, r0.sh, r0.img.width, r0.img.height] : null,
      second: r1 ? [r1.sx, r1.sy, r1.sw, r1.sh, r1.img.width, r1.img.height] : null,
      hasV: at.hasVImage ? at.hasVImage('vanilla/NPC_327.png') : 'n/a' };
  });
  L.say(`vnpc after warm: ${JSON.stringify(meta)}`);
  L.say(`bad requests (${bad.length}):`);
  for (const b of bad.slice(0, 15)) L.say(`  ${b}`);
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
