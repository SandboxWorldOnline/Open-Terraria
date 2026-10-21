// BJ705-A 辅诊:dist vs 工作区——南瓜王可见度 + 光照读数 + 冻结/不冻结对照
import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, saveCanvasShot, Ledger,
} from '../tools/probe/lib/index.mjs';

const L = new Ledger();
const OUT = process.env.SW_PROBE_OUT ?? '/tmp/probe-out/_bj705a-dist';
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
  // 不冻结时钟——只钉到正午附近让光收敛
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
  const st = await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    const light = g.lighting?.lightAt?.(Math.floor(ex / 16), Math.floor(ey / 16));
    const pl = g.lighting?.lightAt?.(Math.floor(g.player.cx / 16), Math.floor(g.player.cy / 16));
    return { alive: !!e, hp: e?.hp, tod: g.world.clock.timeOfDay, isDay: g.world.clock.isDay,
      lightAtEnemy: light, lightAtPlayer: pl,
      screen: g.camera.worldToScreen(ex, ey) };
  }, { ex: EX, ey: EY });
  L.say(`state: ${JSON.stringify(st)}`);
  await saveCanvasShot(page, `${OUT}/nofreeze-with-enemy.png`);
  await page.evaluate(() => {
    const g = window.__swGame;
    g.entities.enemies.length = 0;
  });
  await page.evaluate(PIN, { ticks: 6 });
  await sleep(1200);
  await saveCanvasShot(page, `${OUT}/nofreeze-no-enemy.png`);
  L.say('saved');
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
