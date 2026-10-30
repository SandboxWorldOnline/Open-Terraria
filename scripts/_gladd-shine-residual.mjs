// ★gladd 面③ 残差定位探针 v2(2026-10-28 第三层):收敛门 4 帧误关(第二波有
// 静默期)——R2 残差(4320px@[166,69-877,660] 红系,P/B 有 A 无,两跑同域同量
// =确定性)仍在臂间出现。本版全量打点:
//   renderChunk(pair 唯一创建点)/markDirty wrap + workerAwaiting/budgetAwaiting
//   账面 + R1/R2 盒裁剪逐帧快照(免 26×5.5MB 回传 OOM)+ 世界 tile 反查。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-shine-residual.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const NFRAMES = 26;

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
if (!gen?.ok) { console.log('createGame FAIL', gen?.why); process.exit(1); }
await pump(page, 60);

// ---- 冻结套件(与 strict 逐字同源) ----
await page.evaluate(() => {
  const g = window.__swGame;
  const r = g.renderer;
  const sky = r.sky;
  Object.getPrototypeOf(sky).constructor.cloudRegionBlit = false;
  const proto = Object.getPrototypeOf(sky);
  const origDraw = proto.draw;
  sky.draw = function (ctx, clock, w2, h2, camX, dtMs, camY) {
    return origDraw.call(this, ctx, clock, w2, h2, camX, 0, camY);
  };
  try { const sl = g.player.inv.slots; sl[g.player.selected] = null; } catch { /* 域差异 */ }
  sky.maintainClouds = () => {};
  sky.drawAmbience = () => {};
  r.biomeBg.update = () => {};
  const w = g.world.weather;
  if (w) { w.raining = false; w.cloudAlpha = 0; w.maxRaining = 0; w.numClouds = 60; w.lightning = 0; w.update = () => {}; }
  g.lighting.compute = () => {};
  const noop = () => {};
  try { g.world.liquid && (g.world.liquid.update = noop); } catch { /* 域差异 */ }
  g.vanillaDust && (g.vanillaDust.update = noop);
  let rs = 20261028;
  Math.random = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  try {
    const ww = g.renderer.waterWaves;
    if (ww) { ww.frame = noop; ww.draw = noop; }
  } catch { /* 域差异 */ }
  try { g.renderer.updateWaterWaves = noop; } catch { /* 域差异 */ }
  try { g.renderer.drawWindSwayTiles = noop; } catch { /* 域差异 */ }
  g.entities.critters.length = 0;
  g.entities.enemies.length = 0;
  g.entities.drops.length = 0;
  try { g.vanillaSpawner && (g.vanillaSpawner.update = noop); } catch { /* 域差异 */ }
  try { g.evolution && (g.evolution.update = noop); } catch { /* 域差异 */ }
});
await page.evaluate(() => { window.__swGame.running = false; });
await freezeClock(page, { tod: 0.5 });

// ---- 注入(与 strict 同款) ----
const painted = await page.evaluate(() => {
  const g = window.__swGame;
  const st = g.world.store;
  const px = Math.floor(g.world.spawnX), py = Math.floor(g.world.h * 0.72);
  for (let dy = -6; dy <= 2; dy++) {
    for (let dx = -13; dx <= 14; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 1 || y < 1 || x >= st.w - 1 || y >= st.h - 1) continue;
      const i = st.idx(x, y);
      st.type[i] = 0; st.flags[i] = 0; st.liquid[i] = 0; st.wall[i] = 0;
    }
  }
  for (let dx = -13; dx <= 14; dx++) { const i = st.idx(px + dx, py + 3); st.type[i] = 1; st.flags[i] = 1; }
  for (let dy = -6; dy <= 3; dy++) { const i = st.idx(px + 15, py + dy); st.type[i] = 1; st.flags[i] = 1; }
  let gem = -1;
  for (let i = 0; i < 5000; i++) {
    const d = window.__swTileDefById(i);
    if (d && d.sheet === 262) { gem = i; break; }
  }
  if (gem < 0) return { n: 0, px, py };
  let cnt = 0;
  for (let dy = -4; dy <= 0; dy++) {
    for (let dx = 8; dx <= 12; dx++) {
      const i = st.idx(px + dx, py + dy);
      st.type[i] = gem; st.flags[i] = 1; st.frameX[i] = 0; st.frameY[i] = 0;
      cnt++;
    }
  }
  g.player.x = (px - 3) * 16;
  g.player.y = (py + 3) * 16 - g.player.h - 1;
  g.player.vx = 0; g.player.vy = 0;
  g.camera.x = g.player.x + g.player.w / 2;
  g.camera.y = g.player.y + g.player.h / 2;
  const ch = g.chunks;
  for (let cy = Math.floor((py - 6) / 16); cy <= Math.floor((py + 3) / 16); cy++)
    for (let cx = Math.floor((px - 13) / 16); cx <= Math.floor((px + 15) / 16); cx++)
      ch.markDirty(cx, cy);
  return { n: cnt, px, py, gem };
});
console.log(`注入: n=${painted.n} gem=${painted.gem} @(${painted.px},${painted.py})`);

// ---- 打点装药:renderChunk/markDirty wrap + 账面探针 + 管线预热/面②中和 ----
await page.evaluate(async () => {
  const g = window.__swGame;
  const r = g.renderer;
  const CP = Object.getPrototypeOf(g.chunks);
  const CC = CP.constructor;
  window.__rc = [];   // renderChunk(pair 创建点)日志
  window.__md = [];   // markDirty 日志
  window.__frameN = 0;
  const origRC = CP.renderChunk;
  CP.renderChunk = function (cx, cy) {
    window.__rc.push(`F${window.__frameN}:${cx},${cy}`);
    return origRC.call(this, cx, cy);
  };
  const origMD = CC.prototype.markDirty;
  CC.prototype.markDirty = function (cx, cy) {
    window.__md.push(`F${window.__frameN}:${cx},${cy}`);
    return origMD.call(this, cx, cy);
  };
  const ts = await import('/src/render/TileShine.ts');
  window.__ts = () => ({ ...ts.shineStats });
  const ta = await import('/src/render/TileAnim.ts');
  window.__tick = () => ta.tileAnim.tick;
  r['flushItemGlowGL'] = function () {
    this.itemGlowQueue = [];
    this.itemGlowHeldCollected = new WeakSet();
    return true;
  };
  window.__pipeOk = !!r.acquireCloudPipe();
  window.__hasBakeClient = !!g.chunks.bakeClient;
});
console.log('管线预热:', await page.evaluate(() => window.__pipeOk),
  'bakeClient:', await page.evaluate(() => window.__hasBakeClient));

// ---- R1/R2 盒裁剪快照逐帧驱动 ----
const BOXES = { R1: [1077, 179, 1137, 239], R2: [166, 69, 877, 660] };
const frames = [];
for (let f = 0; f < NFRAMES; f++) {
  const st = await page.evaluate(({ BOXES }) => {
    const g = window.__swGame;
    const r = g.renderer;
    window.__frameN++;
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
    // 盒裁剪快照(小,免 OOM)
    const c = r.canvas;
    const lx = c.getContext('2d');
    const crop = (B) => {
      const [x0, y0, x1, y1] = B;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const d = lx.getImageData(x0, y0, w, h).data;
      let bin = ''; const CH = 0x8000;
      for (let i = 0; i < d.length; i += CH) bin += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + CH, d.length)));
      return btoa(bin);
    };
    const ch = g.chunks;
    return {
      boxes: { R1: crop(BOXES.R1), R2: crop(BOXES.R2) },
      tick: window.__tick(), ss: window.__ts(),
      cam: { x: Math.round(g.camera.x), y: Math.round(g.camera.y) },
      chunksMapSize: ch.chunks ? ch.chunks.size : -1,
      workerAwaiting: ch.workerAwaiting ? ch.workerAwaiting.size : -1,
      budgetAwaiting: ch.budgetAwaiting ? ch.budgetAwaiting.size : -1,
      dirtyQ: ch.dirtyQueue ? ch.dirtyQueue.length : -1,
      rc: window.__rc.splice(0), md: window.__md.splice(0),
    };
  }, { BOXES });
  frames.push(st);
  const rcS = st.rc.length ? ` RC[${st.rc.length}]:${st.rc.slice(0, 5).join(';')}` : '';
  const mdS = st.md.length ? ` MD[${st.md.length}]:${st.md.slice(0, 5).join(';')}` : '';
  console.log(`F${String(f).padStart(2)} tick=${st.tick} cam=(${st.cam.x},${st.cam.y}) map=${st.chunksMapSize} wA=${st.workerAwaiting} bA=${st.budgetAwaiting} dQ=${st.dirtyQ} shine(b=${st.ss.bakes},s=${st.ss.skips},p=${st.ss.pending},r=${st.ss.resumes})${rcS}${mdS}`);
}

// ---- R1/R2 出现帧(vs 末帧)+出现帧逐帧间比对 ----
const dec = (s) => { const bin = Buffer.from(s, 'base64'); return new Uint8Array(bin); };
const boxDiffCount = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
};
const W2 = BOXES.R2[2] - BOXES.R2[0] + 1;
console.log('\n帧 | R1Δ(vs末) | R2Δ(vs末) | R2Δ(vs前一帧)');
for (let f = 0; f < NFRAMES; f++) {
  const last = NFRAMES - 1;
  const d1 = boxDiffCount(dec(frames[f].boxes.R1), dec(frames[last].boxes.R1));
  const d2 = boxDiffCount(dec(frames[f].boxes.R2), dec(frames[last].boxes.R2));
  const d2prev = f > 0 ? boxDiffCount(dec(frames[f].boxes.R2), dec(frames[f - 1].boxes.R2)) : -1;
  console.log(`${String(f).padStart(2)} | ${d1} | ${d2} | ${d2prev}`);
}

// ---- R1/R2 世界位置的 tile 反查 ----
const tileProbe = await page.evaluate(({ BOXES }) => {
  const g = window.__swGame;
  const r = g.renderer;
  const c = r.canvas;
  const z = g.camera.zoom || 1;
  const ox = c.width / 2, oy = c.height / 2;
  const probe = (B) => {
    const [x0, y0, x1, y1] = B;
    const out = [];
    for (const [sx, sy] of [[(x0 + x1) / 2, (y0 + y1) / 2], [x0 + 2, y0 + 2], [x1 - 2, y0 + 2], [x1 - 2, y1 - 2], [x0 + 2, y1 - 2]]) {
      const wx = g.camera.x + (sx - ox) / z, wy = g.camera.y + (sy - oy) / z;
      const tx = Math.floor(wx / 16), ty = Math.floor(wy / 16);
      const st = g.world.store;
      if (!st.inBounds(tx, ty)) { out.push({ sx, sy, oob: true }); continue; }
      const i = st.idx(tx, ty);
      const d = window.__swTileDefById(st.type[i]);
      out.push({ sx, sy, tx, ty, type: st.type[i], sheet: d?.sheet, name: d?.key ?? d?.id });
    }
    return out;
  };
  return { R1: probe(BOXES.R1), R2: probe(BOXES.R2), mmRect: { ...r.minimapRect }, mapStyle: r.mapStyle, zoom: z };
}, { BOXES });
console.log('\nR1 tiles:', JSON.stringify(tileProbe.R1));
console.log('R2 tiles:', JSON.stringify(tileProbe.R2));
console.log('minimapRect:', JSON.stringify(tileProbe.mmRect), 'mapStyle:', tileProbe.mapStyle, 'zoom:', tileProbe.zoom);
await browser.close();
