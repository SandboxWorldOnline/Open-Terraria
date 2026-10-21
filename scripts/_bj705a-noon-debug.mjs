// BJ705-A 辅诊:正午钉位南瓜王为何消失
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, giveItems, Ledger,
} from '../tools/probe/lib/index.mjs';

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
  const clock = await page.evaluate(() => {
    const c = window.__swGame.world.clock;
    c.timeOfDay = 0.5;
    c.tick = () => {};
    return { isDay: c.isDay, tod: c.timeOfDay };
  });
  L.say(`clock: ${JSON.stringify(clock)}`);
  const gi = await giveItems(page, [{ vid: 4680, slot: 0 }], { select: 0 });
  L.chk('give', gi.ok, '');
  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  L.say(`player: ${JSON.stringify(anchor)}`);
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn', sp.ok, JSON.stringify(sp).slice(0, 80));
  for (let round = 0; round < 6; round++) {
    const st = await page.evaluate(({ ex, ey }) => {
      const g = window.__swGame;
      const all = (g.entities.enemies ?? []).map((e) => ({
        vid: e.vanillaId, id: e.id, dead: e.dead, hp: Math.round(e.hp),
        x: Math.round(e.cx), y: Math.round(e.cy), ai1: e.ai1,
        despT: e.despawnTimer, enc: e.despawnEncouraged,
      }));
      const pk = all.find((e) => e.vid === 327);
      if (pk) { /* noop */ }
      const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
      if (e) { e.x = ex - 50; e.y = ey - 50; e.vx = 0; e.vy = 0; }
      g.camera.x = ex; g.camera.y = ey;
      return { all, pinned: !!e };
    }, { ex: EX, ey: EY });
    L.say(`round${round}: pinned=${st.pinned} pk=${JSON.stringify(st.all.find((e) => e.vid === 327))} n=${st.all.length}`);
    await pump(page, 10);
  }
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
