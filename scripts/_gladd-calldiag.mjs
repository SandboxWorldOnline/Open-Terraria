import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, 'http://localhost:5207/?cloudcache=0');
await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
await pump(page, 60);
await page.evaluate(() => {
  const g = window.__swGame;
  const r = g.renderer;
  g.lighting.compute = () => {};
  const noop = () => {};
  g.vanillaDust && (g.vanillaDust.update = noop);
  g.entities.critters.length = 0; g.entities.enemies.length = 0; g.entities.drops.length = 0;
  for (const n of g.entities.npcs) n.update = () => {};
  window.__swGame.running = false; window.__swGame.paused = true;
  r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
  r['flushItemGlow'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); };
  r.constructor.gladd = true;
  r.acquireCloudPipe();
  window.__calls = { quad: 0, quadQuads: 0 };
  const layer = r.acquireCloudPipe();
  const proto = Object.getPrototypeOf(layer);
  const oQ = proto.quadBatchRgba;
  proto.quadBatchRgba = function (e, data, quads, smooth) {
    window.__calls.quad++; window.__calls.quadQuads += quads;
    return oQ.call(this, e, data, quads, smooth);
  };
});
await freezeClock(page, { tod: 0.35 });
await page.evaluate(async () => {
  const g = window.__swGame;
  const r = g.renderer;
  const px = g.player.x, py = g.player.y;
  const M = await import('/src/fx/FadingParticles.ts');
  for (const cfg of [
    { x: px + 150, y: py - 80, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.1, texKey: 'vanilla/Projectile_1121.png', tint: [30, 180, 255, 0], rot: 0.6, scaleX: 1.5, scaleY: 1.2, fullbright: true },
    { x: px - 200, y: py - 140, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.3, texKey: 'vanilla/Projectile_1121.png', tint: [120, 220, 255, 0], rot: -1.1, scaleX: 0.8, scaleY: 2, fullbright: true },
    { x: px + 40, y: py - 220, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.5, texKey: 'vanilla/Extra_34.png', tint: [255, 200, 100, 0], rot: 0.2, scaleX: 1.1, scaleY: 0.9, fullbright: true },
    { x: px - 90, y: py - 40, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.1, texKey: 'vanilla/Extra_34.png', tint: [200, 255, 150, 0], rot: 2.2, scaleX: 1.3, scaleY: 1.3, fullbright: true },
  ]) { const p = M.fadingParticles.spawn(cfg); if (p) p.timeSinceSpawn = 50000; }
  const E = await import('/src/entities/Enemy.ts');
  const mk = (vid, x, y) => { const e = E.Enemy.fromVanilla(vid, x, y); if (e) { e.vx = 0; e.vy = 0; g.entities.add(e, 'enemies'); } return e; };
  const fae = mk(677, px + 150, py - 100); if (fae) fae.visAngle = 0.6;
  const fai = mk(583, px - 200, py - 140); if (fai) { fai.vx = 30; fai.visAngle = -0.4; }
  const dee = mk(668, px - 340, py - 40); if (dee) { dee.lai3 = 36; dee.spawnAlpha = 0; }
  const cry = mk(516, px + 60, py - 240); if (cry) cry.spawnAlpha = 220;
  const vd = g.vanillaDust;
  let i = 0;
  for (const t of [6, 15, 59, 60, 61, 62, 63, 64]) for (let k = 0; k < 3; k++) {
    const d = vd.spawn(px - 420 + (i % 12) * 70, py - 240 + Math.floor(i / 12) * 90, 0, 0, t, 0, 0, 0, null, [1, 1.5, 2][k]);
    if (d) d.rotation = [0, 0.6, 1.2][k];
    i++;
  }
  g.player.buffs.set(50, 100000);
  g.player.flameRingRot = 0.5;
  const W = await import('/src/entities/WhipProj.ts');
  for (const ang of [-0.4, 0.6]) { const w = new W.WhipProj(px, py, ang, 1034, 0, 10, 2, 30, 8, () => g.player, () => ang, 1); g.entities.add(w, 'projectiles'); }
  window.__pushTrail = () => {
    const pts = [];
    for (let i2 = 0; i2 < 12; i2++) pts.push({ x: px + 40 + i2 * 12, y: py - 60 + Math.sin(i2 * 0.7) * 30, hw: 5 + i2 * 0.3, rot: i2 * 0.2, r: 0.9, g: 0.5, b: 1.0, a: 0.5 * (1 - i2 / 12) });
    r.queueTrailShade({ set: 'FinalFractal', pts, opacity: 1, expectedPairs: 60, time: 1.25, zigzag: 0.5 });
    r.projFullbrightQueue.push((ctx2) => {
      const img = r.atlas.ensureVImage('vanilla/Extra_34.png');
      if (!img) return;
      ctx2.save(); ctx2.globalCompositeOperation = 'lighter'; ctx2.globalAlpha = 0.8;
      ctx2.translate(px + 100, py - 160); ctx2.rotate(0.4);
      ctx2.drawImage(img, 0, 0, img.width, img.height, -40, -20, 80, 40);
      ctx2.restore();
    });
  };
});
for (let i = 0; i < 150; i++) {
  await page.evaluate(() => {
    const g = window.__swGame;
    if (window.__pushTrail) window.__pushTrail();
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
  });
}
const out = await page.evaluate(() => ({ ...window.__calls, grp: { ...window.__swGame.renderer.gladdGroupStats } }));
console.log('150 帧累计:', JSON.stringify(out), '→ call/帧=', (out.quad / 150).toFixed(1), 'quads/帧=', (out.quadQuads / 150).toFixed(1));
await browser.close();
