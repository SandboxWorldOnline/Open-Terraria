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
  window.__swGame.running = false; window.__swGame.paused = true;
  const r = g.renderer;
  r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
  r['flushItemGlow'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); };
  r.constructor.gladd = true;
  r.acquireCloudPipe();
});
await page.evaluate(async () => {
  const ta = await import('/src/render/TileAnim.ts');
  window.__setTick = (v) => { ta.tileAnim.tick = v; };
  const gt = await import('/src/core/GameTime.ts');
  window.__pinGT = (t) => gt.pinGameTimeTicks(t);
});
await freezeClock(page, { tod: 0.35 });
const diag = await page.evaluate(async () => {
  const g = window.__swGame;
  const M = await import('/src/fx/FadingParticles.ts');
  const px = g.player.x, py = g.player.y;
  M.fadingParticles.spawn({ x: px + 150, y: py - 80, timeToLive: 100000, fadeIn: 0, fadeOut: 0.001, texKey: 'vanilla/Extra_34.png', tint: [255, 200, 100, 0], rot: 0.6, scaleX: 1.5, scaleY: 1.2, fullbright: true });
  // 驱动 5 帧让粒子渲染一次
  for (let i = 0; i < 5; i++) {
    window.__setTick(100000); window.__pinGT(0);
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
  }
  // 粒子态 + tinted 尺寸
  const parts = [];
  for (const f of M.fadingParticles.each()) {
    const [sx, sy] = g.camera.worldToScreen(f.x, f.y);
    parts.push({ x: Math.round(f.x), y: Math.round(f.y), screen: [Math.round(sx), Math.round(sy)], scaleX: f.scaleX, scaleY: f.scaleY, rot: f.rot?.toFixed(2), texKey: f.texKey, tintA: f.tintA, timeSinceSpawn: f.timeSinceSpawn });
  }
  const atlas = g.renderer.atlas;
  const img = atlas.ensureVImage('vanilla/Extra_34.png');
  return { parts, imgW: img?.width, imgH: img?.height, cam: [Math.round(g.camera.x), Math.round(g.camera.y)] };
});
console.log('粒子态:', JSON.stringify(diag.parts, null, 1));
console.log('Extra_34 尺寸:', diag.imgW, 'x', diag.imgH, ' cam:', diag.cam);
await browser.close();
