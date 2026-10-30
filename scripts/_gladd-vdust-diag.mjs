import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0&dustbatch=0`);
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
  window.__swGame.running = false; window.__swGame.paused = true;
  const r = g.renderer;
  r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
  r['flushItemGlow'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); };
  r.constructor.gladd = true;
  const layer = r.acquireCloudPipe();
  window.__glLog = [];
  const proto = Object.getPrototypeOf(layer);
  const oT = proto.texFromImage;
  proto.texFromImage = function (key, img, a, b, c) {
    const isVd = key.startsWith('vdust');
    const r2 = oT.call(this, key, img, a, b, c);
    if (isVd) window.__glLog.push(['texFromImage', key, !!r2, (img && img.width) + 'x' + (img && img.height)]);
    return r2;
  };
  const oQ = proto.quadBatchRgba;
  proto.quadBatchRgba = function (e, data, quads, smooth) {
    const r2 = oQ.call(this, e, data, quads, smooth);
    if (this.pipeFbo && this.pipeFbo.name === 'vdust') window.__glLog.push(['quad', quads, !!r2, this.unavailable]);
    return r2;
  };
});
await freezeClock(page, { tod: 0.35 });
await page.evaluate(() => {
  const g = window.__swGame;
  const vd = g.vanillaDust;
  for (const d of (vd['pool'] ?? [])) d.active = false;
  const px = g.player.x, py = g.player.y;
  for (let k = 0; k < 3; k++) vd.spawn(px - 300 + k * 100, py - 100, 0, 0, 6, 0, 0, 0, null, 1);
});
const out = await page.evaluate(() => {
  const g = window.__swGame;
  for (let i = 0; i < 3; i++) {
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
  }
  return { stats: { ...g.renderer.gladdVDustStats }, log: window.__glLog.slice(0, 12) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
