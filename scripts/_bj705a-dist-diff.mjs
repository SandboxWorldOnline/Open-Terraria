// BJ705-A 辅诊:0.1.63 dist 构建里南瓜王到底画没画(有无敌差分)
import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, giveItems, saveCanvasShot, Ledger,
} from '../tools/probe/lib/index.mjs';

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
    g.camera.x = st.cx; g.camera.y = st.cy;
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
  await page.evaluate(() => {
    const c = window.__swGame.world.clock;
    c.timeOfDay = 0.5;
    c.tick = () => {};
  });
  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn', sp.ok, JSON.stringify(sp).slice(0, 70));
  await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50, cx: ex, cy: ey };
  }, { ex: EX, ey: EY });
  await page.evaluate(PIN, { ticks: 40 });
  await sleep(900);
  const pos = await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const z = g.camera.zoom ?? 1;
    return { screen: g.camera.worldToScreen(ex, ey), cam: { x: g.camera.x, y: g.camera.y }, z,
      canvas: { w: g.renderer.canvas.width, h: g.renderer.height },
      canList: Array.from(document.querySelectorAll('canvas')).map((c) => [c.width, c.height, c.style.display ?? '', c.className ?? '']) };
  }, { ex: EX, ey: EY });
  L.say(`pos: ${JSON.stringify(pos)}`);
  await saveCanvasShot(page, `${OUT}/diff-with-enemy.png`);
  await page.evaluate(() => {
    const g = window.__swGame;
    g.entities.enemies.length = 0;
    g.entities.projectiles.length = 0;
  });
  await page.evaluate(PIN, { ticks: 6 });
  await sleep(900);
  await saveCanvasShot(page, `${OUT}/diff-no-enemy.png`);
  L.say('screens saved');
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
