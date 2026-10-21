// ★鞭批可视化对拍（2026-10-21 用户报「鞭子本体不见了」——批路径渲染回归定位）
// 教训吸收:paused=false 驱动+清冻结窗+清实体桶（鞭=唯一动体）
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5204';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?whipbatch=1&cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261021 });
await pump(page, 40);
await page.evaluate(async () => {
  const m = await import('/src/entities/WhipProj.ts');
  window.__WhipProj = m.WhipProj;
  const g = window.__swGame;
  window.__wbSet = (v) => { g.renderer.constructor.whipbatch = v; };
  const r = g.renderer;
  const sky = r.sky;
  Object.getPrototypeOf(sky).constructor.cloudRegionBlit = false;
  try { const sl = g.player.inv.slots; sl[g.player.selected] = null; } catch { /* */ }
  sky.maintainClouds = () => {};
  sky.drawAmbience = () => {};
  r.biomeBg.update = () => {};
  const w = g.world.weather;
  if (w) { w.raining = false; w.cloudAlpha = 0; w.maxRaining = 0; w.numClouds = 60; w.lightning = 0; w.update = () => {}; }
  Object.defineProperty(r, '_liquidNow', { get: () => 60_000, set: () => {}, configurable: true });
  g.lighting.clock.tick = () => {};
  g.running = false;
  window.__frame = () => { window.__vnow = (window.__vnow || performance.now()) + 16.7; g.frame(window.__vnow); };
  window.__mkWhip = () => {
    const wp = new window.__WhipProj(g.player.cx, g.player.cy, 0.7, 915, 4914, 170, 4, 30, 4,
      () => g.player, () => 0, 1);
    g.entities.add(wp, 'projectiles');
    return wp;
  };
  // 清世界非确定源
  for (const k of ['enemies', 'drops', 'npcs', 'props', 'critters']) g.entities[k].length = 0;
  for (const d of g.vanillaDust.each(false)) d.active = false;
  for (const d of g.vanillaDust.each(true)) d.active = false;
  g.particles.length = 0;
  g._tpVeil = false;
  if (g._entryFreeze) g._entryFreeze = null;
});
await page.evaluate(() => import('/src/render/JudderSmooth.ts').then((m) => m.judderSmoothSetForTest(false)));
await page.evaluate(() => import('/src/render/MotionBlur.ts').then((m) => m.mblurSetForTest(false)));
await page.evaluate(() => import('/src/render/TileFlames.ts').then((m) => m.tileFrameSeedFreezeForTest(true)));
// 驱动到鞭中段相位（ai0≈20/60）
async function armToPhase(flag, target) {
  await page.evaluate((f) => { window.__wbSet(f); window.__swGame.paused = false; }, flag);
  await page.evaluate(() => { window.__swGame.entities.projectiles = window.__swGame.entities.projectiles.filter((e) => !(e instanceof window.__WhipProj)); });
  await page.evaluate(() => window.__mkWhip());
  for (let i = 0; i < target; i++) await page.evaluate(() => window.__frame());
  await page.evaluate(() => { window.__swGame.paused = true; });
}
async function snap() {
  return page.evaluate(() => {
    const c = window.__swGame.renderer.canvas;
    const lc = document.createElement('canvas');
    lc.width = c.width; lc.height = c.height;
    const lx = lc.getContext('2d', { willReadFrequently: true });
    lx.drawImage(c, 0, 0);
    const d = lx.getImageData(0, 0, lc.width, lc.height).data;
    // 鞭域统计:右半屏非背景亮像素（鞭在右——ang 0.7 甩右）
    let bright = 0, sum = 0;
    for (let y = 100; y < 500; y++) for (let x = 640; x < 1280; x++) {
      const i = (y * c.width + x) * 4;
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += lum;
      if (lum > 120) bright++;
    }
    return { bright, avgLum: +(sum / (380 * 640)).toFixed(1) };
  });
}
// 批顶点几何 dump（收集期拦截:顶点 bbox+uv 域+col 样本——几何错误直接现形）
await armToPhase(true, 10);
const dump = await page.evaluate(() => {
  const g = window.__swGame;
  const r = g.renderer;
  // hook pushQuadBatchRgba/pushLiquidAddBatch 拦截批材料
  const sh = r.bglEntShim;
  window.__cap = [];
  if (sh) {
    const oq = sh.pushQuadBatchRgba.bind(sh);
    sh.pushQuadBatchRgba = (img, key, data, quads, replay) => {
      window.__cap.push({ ch: 'SO', key, quads, imgW: img.width, imgH: img.height });
      // 顶点 bbox
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (let i = 0; i < data.length; i += 8) {
        if (data[i] < minX) minX = data[i];
        if (data[i] > maxX) maxX = data[i];
        if (data[i + 1] < minY) minY = data[i + 1];
        if (data[i + 1] > maxY) maxY = data[i + 1];
      }
      window.__cap[window.__cap.length - 1].bbox = [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)];
      // 首顶点完整样本
      window.__cap[window.__cap.length - 1].v0 = [data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]].map((x) => +x.toFixed(3));
      return oq(img, key, data, quads, replay);
    };
    const ol = sh.pushLiquidAddBatch.bind(sh);
    sh.pushLiquidAddBatch = (img, key, data, quads, replay) => {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (let i = 0; i < data.length; i += 8) {
        if (data[i] < minX) minX = data[i];
        if (data[i] > maxX) maxX = data[i];
        if (data[i + 1] < minY) minY = data[i + 1];
        if (data[i + 1] > maxY) maxY = data[i + 1];
      }
      window.__cap.push({ ch: 'ADD', key, quads, imgW: img.width, imgH: img.height,
        bbox: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)],
        v0: [data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]].map((x) => +x.toFixed(3)) });
      return ol(img, key, data, quads, replay);
    };
  }
  // 再驱动 1 帧（让 flush 发生）
  g.paused = false;
  window.__frame();
  g.paused = true;
  return window.__cap;
});
console.log('批发射 dump:');
for (const c of dump) console.log(' ', JSON.stringify(c));
// 玩家屏幕位（顶点应以它为锚的右带）
const ppos = await page.evaluate(() => {
  const g = window.__swGame;
  const cam = g.camera;
  const scr = g.renderer.canvas.width;
  return { px: Math.round((g.player.cx - cam.x) * 1.25 + scr / 2), py: Math.round((g.player.cy - cam.y) * 1.25 + g.renderer.canvas.height / 2), viewW: scr };
});
console.log('玩家屏幕位:', JSON.stringify(ppos));
await browser.close();
