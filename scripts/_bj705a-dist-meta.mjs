import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, Ledger } from '../tools/probe/lib/index.mjs';
const L = new Ledger();
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
  const meta = await page.evaluate(() => {
    const g = window.__swGame;
    const at = g.renderer.atlas;
    const out = {};
    for (const f of [0, 4, 8, 11]) {
      const r = at.vnpc(327, f);
      out[f] = r ? { sx: r.sx, sy: r.sy, sw: r.sw, sh: r.sh, imgW: r.img.width, imgH: r.img.height } : null;
    }
    out.npcJson327 = at.vanilla?.npcs?.['327'] ?? null;
    out.hasExtra199 = (() => { try { return !!at.ensureVImage('vanilla/Extra_199.png'); } catch (e) { return 'err'; } })();
    return out;
  });
  L.say(`meta: ${JSON.stringify(meta)}`);
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
