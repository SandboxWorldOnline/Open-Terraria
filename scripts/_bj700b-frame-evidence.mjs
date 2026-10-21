// ★BJ700b 帧序证据:617 跳跃→落地窗内 vanillaFrameIdx 逐拍(对照原版:落地后帧8应保持9t再回0)
import { launchBrowser, openPage, bootstrap, createGame, ledger, freezeClock } from '../tools/probe/lib/index.mjs';
import { tileIdBySheet } from '../tools/probe/lib/entities.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const L = ledger();
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
await freezeClock(page, { tod: 0.345 });
const dirt = await tileIdBySheet(page, 0);
const out = await page.evaluate(async ({ dirtId }) => {
  const g = window.__swGame;
  const st = g.world.store;
  const p = g.player;
  p.debugGod = true;
  for (let x = 40; x <= 132; x++) for (let y = 150; y <= 272; y++) {
    const i = st.idx(x, y);
    st.setTileSilent(x, y, 0, 0, 0); st.half[i] = 0; st.slope[i] = 0; st.liquid[i] = 0; st.liquidType[i] = 0;
  }
  const put = (x, y) => { if (!st.inBounds(x, y)) return; st.setTileSilent(x, y, dirtId, 0, 0); const i = st.idx(x, y); st.half[i] = 0; st.slope[i] = 0; st.liquid[i] = 0; st.liquidType[i] = 0; };
  const C0 = 44, R = 192;
  for (let c = C0; c <= 70; c++) put(c, R);
  put(C0 + 10, R - 1); put(C0 + 10, R - 2);   // 2 格墙
  p.x = (C0 - 8) * 16; p.y = (R - 6) * 16; p.vx = 0; p.vy = 0;
  const meta = await window.__swFlow.spawnVanillaEnemy(617, (C0 + 1) * 16 + 8, R * 16 - 10);
  const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
  if (!e) return { ok: false };
  e.ai0 = 1; e.ai1 = 900; e.lai3 = -1; e.facing = 1; e.vx = 0.5; e.vy = 0; e.critterHomeX = C0 + 13;
  const { vanillaFrameIdx } = await import('/src/render/Renderer.ts');
  const log = [];
  let jumpT = -1, landT = -1;
  for (let t = 1; t <= 400; t++) {
    g.fixedUpdate(1 / 60);
    const fr = vanillaFrameIdx(e, 14);
    if (jumpT < 0 && e.vy < -0.01) jumpT = t;
    if (jumpT >= 0 && landT < 0 && e.onGround) landT = t;
    if (jumpT < 0 || (landT >= 0 && t > landT + 20)) continue;
    log.push({ t, fr, vy: +e.vy.toFixed(1), gr: e.onGround ? 1 : 0, vx: +e.vx.toFixed(2), animT: e.animT });
  }
  return { ok: true, jumpT, landT, log };
}, { dirtId: dirt.id });
L.chk('帧序取证', out.ok, `jump@${out.jumpT} land@${out.landT}`);
console.log(`jump@${out.jumpT} land@${out.landT}`);
for (const k of out.log) console.log(` t${k.t} frame=${k.fr} vy=${k.vy} gr=${k.gr} vx=${k.vx} animT=${k.animT}`);
await browser.close();
console.log('DONE');
