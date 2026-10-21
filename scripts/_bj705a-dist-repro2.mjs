// BJ705-A:0.1.63 dist 正式对拍(修正钉位伪影:interval 持续钉敌+相机)
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump,
  godMode, clearEnemies, spawnEnemy, giveItems, saveCanvasShot, Ledger } from '../tools/probe/lib/index.mjs';
const L = new Ledger();
const OUT = '/tmp/probe-out/_bj705a-dist';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const START_PIN = `({ ex, ey }) => {
  const g = window.__swGame;
  const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
  window.__bj705aPin = { e, ex: ex - 50, ey: ey - 50, cx: ex, cy: ey };
  window.__bj705aIv = setInterval(() => {
    const st = window.__bj705aPin;
    if (st.e && !st.e.dead) { st.e.x = st.ex; st.e.y = st.ey; st.e.vx = 0; st.e.vy = 0; if (st.e.hp < 1000) st.e.hp = 1000; }
    g.camera.x = st.cx; g.camera.y = st.cy;
  }, 33);
  return !!e;
}`;
const STOP_PIN = `() => { if (window.__bj705aIv) { clearInterval(window.__bj705aIv); window.__bj705aIv = null; } }`;

const SAMPLE = async ({ wx, wy, r }) => {
  const g = window.__swGame;
  const cam = g.camera;
  const cv = g.renderer.canvas;
  const z = cam.zoom ?? 1;
  const [px, py] = cam.worldToScreen(wx, wy);
  const R = Math.ceil(r * z);
  const sx = Math.round(px) - R, sy = Math.round(py) - R, W = R * 2, H = R * 2;
  const c2 = document.createElement('canvas');
  c2.width = W; c2.height = H;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  g2.drawImage(cv, sx, sy, W, H, 0, 0, W, H);
  const d = g2.getImageData(0, 0, W, H).data;
  let orange = 0, lumaSum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const R8 = d[i], G8 = d[i + 1], B8 = d[i + 2];
    lumaSum += 0.299 * R8 + 0.587 * G8 + 0.114 * B8; n++;
    if (R8 > 120 && G8 > 40 && G8 < 170 && B8 < 90) orange++;
  }
  return { W, H, orange, meanLuma: +(lumaSum / n).toFixed(1), raw: Array.from(d) };
};
function diffBg(S, BG) {
  if (!S || !BG || !S.raw || !BG.raw || S.raw.length !== BG.raw.length) return null;
  let head = 0;
  for (let i = 0; i < S.raw.length; i += 4) {
    const d = Math.abs(S.raw[i] - BG.raw[i]) + Math.abs(S.raw[i + 1] - BG.raw[i + 1])
      + Math.abs(S.raw[i + 2] - BG.raw[i + 2]);
    if (d > 36) head++;
  }
  return head;
}

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
  const gi = await giveItems(page, [{ vid: 4680, slot: 0 }], { select: 0 });
  L.chk('give', gi.ok, JSON.stringify(gi).slice(0, 80));
  const anchor = await page.evaluate(() => {
    const g = window.__swGame;
    return { px: Math.round(g.player.cx), py: Math.round(g.player.cy) };
  });
  const EX = anchor.px + 150, EY = anchor.py - 120;
  const sp = await spawnEnemy(page, 327, EX, EY);
  L.chk('spawn', sp.ok, '');
  const pinned = await page.evaluate(START_PIN, { ex: EX, ey: EY });
  L.chk('pin-started', pinned, '');
  await pump(page, 60);
  await sleep(900);
  const cam = await page.evaluate(() => ({ x: window.__swGame.camera.x, y: window.__swGame.camera.y }));
  L.say(`cam after interval pin: ${JSON.stringify(cam)} (expect ${EX},${EY})`);

  const A_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const A_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  await saveCanvasShot(page, `${OUT}/r2-a-baseline.png`);
  L.say(`baseline head: orange=${A_head.orange} luma=${A_head.meanLuma} cloak=${A_cloak.orange}`);

  const swing = await page.evaluate(({ ex, ey }) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    if (!e) return { ok: false };
    const [sx, sy] = g.camera.worldToScreen(ex, ey);
    g.input.mouseX = Math.round(sx); g.input.mouseY = Math.round(sy);
    g.player.minionTargetId = -1;
    g.input.mouseDown = true;
    return { ok: true, eid: e.id };
  }, { ex: EX, ey: EY });
  await pump(page, 16);
  await page.evaluate(() => { window.__swGame.input.mouseDown = false; });
  await pump(page, 34);
  await sleep(700);
  const hit = await page.evaluate((eid) => {
    const g = window.__swGame;
    const e = (g.entities.enemies ?? []).find((en) => en.vanillaId === 327);
    return { hp: e?.hp, tagged: (() => { try { return g.player.tagEffectStack.isNPCTagged(4680, eid); } catch (err) { return 'err'; } })(),
      tid: g.player.minionTargetId, spawnAlpha: e?.spawnAlpha, alive: !!e };
  }, swing.eid ?? -1);
  L.say(`after-hit: ${JSON.stringify(hit)}`);
  L.chk('tag-landed', hit.tagged === true && hit.tid === swing.eid, JSON.stringify(hit));

  const B_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const B_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  await saveCanvasShot(page, `${OUT}/r2-b-after-hit.png`);
  L.say(`after-hit head: orange=${B_head.orange} luma=${B_head.meanLuma} cloak=${B_cloak.orange}`);

  await pump(page, 240);
  await sleep(700);
  const D_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  L.say(`+290t head: orange=${D_head.orange} luma=${D_head.meanLuma}`);
  await saveCanvasShot(page, `${OUT}/r2-d-plus290.png`);

  await page.evaluate(STOP_PIN);
  await page.evaluate(() => {
    const g = window.__swGame;
    g.entities.enemies.length = 0;
    g.entities.projectiles.length = 0;
    g.player.minionTargetId = -1;
  });
  await pump(page, 6);
  await sleep(700);
  const BG_head = await page.evaluate(SAMPLE, { wx: EX, wy: EY, r: 60 });
  const BG_cloak = await page.evaluate(SAMPLE, { wx: EX, wy: EY + 80, r: 40 });
  L.say(`bg: luma=${BG_head.meanLuma} orange=${BG_head.orange}`);

  const cov = { A: diffBg(A_head, BG_head), B: diffBg(B_head, BG_head), D: diffBg(D_head, BG_head),
    cloakA: diffBg(A_cloak, BG_cloak), cloakB: diffBg(B_cloak, BG_cloak) };
  L.say(`headPix: A=${cov.A} B=${cov.B} D=${cov.D} cloak A=${cov.cloakA} B=${cov.cloakB}`);
  L.chk('dist-repro-head-transparent', cov.B !== null && cov.A !== null && cov.B < cov.A * 0.5,
    `B/A=${cov.B}/${cov.A} orange ${A_head.orange}→${B_head.orange}`);
  writeFileSync(`${OUT}/r2-result.json`, JSON.stringify({ hit, cov, orange: { A: A_head.orange, B: B_head.orange, D: D_head.orange } }, null, 2));
} finally {
  await browser.close().catch(() => {});
}
process.exit(L.exitCode());
