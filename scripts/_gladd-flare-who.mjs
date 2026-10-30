// ★gladd 面④ 移动实体定位:g.entities 全集合普查+屏幕(960,55)附近的实体反查
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
await pump(page, 60);
await page.evaluate(() => {
  const g = window.__swGame;
  g.lighting.compute = () => {};
  const noop = () => {};
  try { g.world.liquid && (g.world.liquid.update = noop); } catch { }
  g.vanillaDust && (g.vanillaDust.update = noop);
  g.entities.critters.length = 0; g.entities.enemies.length = 0; g.entities.drops.length = 0;
  for (const n of g.entities.npcs) n.update = () => {};
  try { g.vanillaSpawner && (g.vanillaSpawner.update = noop); } catch { }
  try { g.evolution && (g.evolution.update = noop); } catch { }
  window.__swGame.running = false;
});
await freezeClock(page, { tod: 0.26 });
const census = await page.evaluate(() => {
  const g = window.__swGame;
  const cam = g.camera;
  const st = g.world.store;
  const probe = (sx, sy) => {
    const wx = cam.x + (sx - 640), wy = cam.y + (sy - 400);
    const tx = Math.floor(wx / 16), ty = Math.floor(wy / 16);
    const rows = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (!st.inBounds(x, y)) continue;
      const i = st.idx(x, y);
      const d = window.__swTileDefById(st.type[i]);
      rows.push(`(${x},${y}) t=${st.type[i]} s=${d?.sheet ?? '?'} ${d?.key ?? '?'} liq=${st.liquid[i]}`);
    }
    return rows;
  };
  return {
    cam: { x: Math.round(cam.x), y: Math.round(cam.y) },
    m1: probe(1118, 208), m2: probe(515, 210), m3: probe(1272, 200),
  };
});
console.log('cam:', JSON.stringify(census.cam));
console.log('mover1 (1118,208):', census.m1.join(' | '));
console.log('mover2 (515,210):', census.m2.join(' | '));
console.log('mover3 (1272,200):', census.m3.join(' | '));
// 逐帧看还有谁在动:两帧间隔后重扫位置
const moved = await page.evaluate(() => {
  const g = window.__swGame;
  const snap = () => {
    const m = [];
    for (const k of Object.keys(g.entities)) {
      const v = g.entities[k];
      if (!Array.isArray(v)) continue;
      for (const e of v) if (e && typeof e.x === 'number') m.push({ k, n: e.constructor?.name ?? '?', x: Math.round(e.x), y: Math.round(e.y) });
    }
    return m;
  };
  const a = snap();
  window.__vnow = (window.__vnow || performance.now()) + 16.6667;
  g.frame(window.__vnow);
  const b = snap();
  const out = [];
  for (const e2 of b) {
    const e1 = a.find((e0) => e0.k === e2.k && e0.n === e2.n && Math.abs(e0.x - e2.x) < 800 && Math.abs(e0.y - e2.y) < 800 && e0.x === e2.x - (e2.x - e0.x));
    // 简化:按索引配对
  }
  // 直接按索引配对(集合顺序稳定)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) out.push(`${b[i].k}/${b[i].n}: (${a[i].x},${a[i].y})→(${b[i].x},${b[i].y})`);
  }
  return out;
});
console.log('一帧间移动的实体:');
for (const m of moved) console.log(' ', m);
await browser.close();
