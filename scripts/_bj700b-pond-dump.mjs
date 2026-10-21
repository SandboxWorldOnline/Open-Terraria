import { launchBrowser, openPage, bootstrap, createGame, ledger, freezeClock } from '../tools/probe/lib/index.mjs';
import { tileIdBySheet } from '../tools/probe/lib/entities.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
await freezeClock(page, { tod: 0.345 });
const dirt = await tileIdBySheet(page, 0);
await page.evaluate(({ dirtId }) => {
  const g = window.__swGame;
  const st = g.world.store;
  const p = g.player;
  p.debugGod = true;
  for (let x = 40; x <= 132; x++) for (let y = 150; y <= 272; y++) {
    const i = st.idx(x, y);
    st.setTileSilent(x, y, 0, 0, 0); st.half[i] = 0; st.slope[i] = 0; st.liquid[i] = 0; st.liquidType[i] = 0;
  }
  const put = (x, y) => { if (!st.inBounds(x, y)) return; st.setTileSilent(x, y, dirtId, 0, 0); const i = st.idx(x, y); st.half[i] = 0; st.slope[i] = 0; st.liquid[i] = 0; st.liquidType[i] = 0; };
  const water = (x, y) => { if (!st.inBounds(x, y)) return; const i = st.idx(x, y); st.liquid[i] = 255; st.liquidType[i] = 1; };
  const c0 = 44, c1 = 70, R = 170;
  for (let c = c0; c <= c1; c++) put(c, R);
  const a = c0 + 9, b = c0 + 16;
  for (let c = a; c <= b; c++) for (let d = 0; d <= 3; d++) { const i = st.idx(c, R + d); st.setTileSilent(c, R + d, 0, 0, 0); st.liquid[i] = 0; }
  for (let d = 1; d <= 5; d++) { put(a - 1, R + d); put(b + 1, R + d); }
  for (let c = a; c <= b; c++) put(c, R + 4);
  for (let c = a; c <= b; c++) for (let d = 1; d <= 3; d++) water(c, R + d);
  p.x = (c0 - 8) * 16; p.y = (R - 6) * 16; p.vx = 0; p.vy = 0;
}, { dirtId: dirt.id });
const spawn = await page.evaluate(async () => {
  const g = window.__swGame;
  const meta = await window.__swFlow.spawnVanillaEnemy(617, 45 * 16 + 8, 170 * 16 - 10);
  const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
  if (e) { e.ai0 = 1; e.ai1 = 1200; e.lai3 = -1; e.facing = 1; e.vx = 0.5; e.vy = 0; e.critterHomeX = 58; }
  return e ? e.id : -1;
});
const out = await page.evaluate(async ({ id }) => {
  const g = window.__swGame;
  const find = () => { for (const e of g.entities.enemies) if (e.id === id) return e; return null; };
  const log = [];
  let hitDone = false;
  for (let t = 1; t <= 900; t++) {
    g.fixedUpdate(1 / 60);
    if (!hitDone && t >= 200) { hitDone = true; const e = find(); if (e) { e.vx = 4; e.vy = -4; } }
    const e = find();
    if (e) log.push(`${t} x${e.x.toFixed(1)} y${e.y.toFixed(1)} vx${e.vx.toFixed(2)} vy${e.vy.toFixed(2)} ${e.onGround ? 'G' : 'A'}${e.wet ? 'W' : ''} a0=${e.ai0} f${e.facing}`);
  }
  return log;
}, { id: spawn });
for (const l of out) console.log(l);
await browser.close();
