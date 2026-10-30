// ★gladd 面④ 天空噪声定位 v3:闸同款完整冻结核(gladd on/tod 0.26/tick+GTW 钉/
//  星冻/NPC 冻)+N 帧页内滚动差分(只留上一帧——全幅回传 OOM 判例)。找慢事件
// 节律+bbox(skydiag 90 帧窗口错过 >1.1s 周期事件的盲区)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=300000 scripts/_gladd-flare-skydiag.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const NFRAMES = Number(process.env.SW_NF || 400);
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
await pump(page, 60);

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
  sky.updateStars = () => {};
  // ★天幕流星杀(sky.meteor:pump 期穿越夜窗生成,life 1200 帧全程移动+4 帧动画,
  //  任何冻结不覆盖其 t 推进——门 hash 逐帧漂移的真凶;钟冻结后无新触发)
  sky.meteor = null;
  // ★云冻结(updateClouds 由调用方传真实 dt——风驱动 c.x 逐帧推进=每帧千级像素
  //  左移;maintainClouds 只管生成/回收不管位移。实例遮蔽:位冻结画照常)
  sky.updateClouds = () => {};
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
  for (const n of g.entities.npcs) n.update = () => {};
  try { g.vanillaSpawner && (g.vanillaSpawner.update = noop); } catch { /* 域差异 */ }
  try { g.evolution && (g.evolution.update = noop); } catch { /* 域差异 */ }
  window.__swGame.running = false;
  // ★全局暂停(Game.paused→frameCtx.paused 传播):原版「世界冻结+渲染照常」语义
  //  ——updateClouds(1951)/星更新/shimmer 全族 paused 门;光斑/加算面/渲染路径
  //  无 paused 门照常;直接置字段不触发菜单 UI(menuMode 独立)
  g.paused = true;
  r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
  r['flushItemGlow'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); };
  r.constructor.gladd = true;
  window.__pipeOk = !!r.acquireCloudPipe();
});
await page.evaluate(async () => {
  const ta = await import('/src/render/TileAnim.ts');
  window.__setTick = (v) => { ta.tileAnim.tick = v; };
  const gt = await import('/src/core/GameTime.ts');
  window.__pinGT = (t) => gt.pinGameTimeTicks(t);
});
await freezeClock(page, { tod: 0.26 });

const frames = [];
for (let f = 0; f < NFRAMES; f++) {
  const st = await page.evaluate(() => {
    const g = window.__swGame;
    window.__setTick(100000);
    window.__pinGT(0);
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
    const c = g.renderer.canvas;
    const id = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < id.data.length; i += 4) id.data[i] = 0;
    const cur = id.data;
    if (!window.__prev) { window.__prev = new Uint8Array(cur); return { n: -1 }; }
    const pv = window.__prev;
    let n = 0, maxd = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < cur.length; i += 4) {
      const d = Math.max(Math.abs(cur[i] - pv[i]), Math.abs(cur[i + 1] - pv[i + 1]), Math.abs(cur[i + 2] - pv[i + 2]));
      if (d > 0) {
        n++;
        const p2 = i / 4, x = p2 % 1280, y = (p2 / 1280) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (d > maxd) maxd = d;
      }
    }
    // 差异像素空间样本(先采样后 set——set 会覆写 prev)
    const pts = []; const hb = new Array(8).fill(0); const vb = new Array(8).fill(0);
    for (let i = 0; i < cur.length && pts.length < 8; i += 4) {
      const d = Math.max(Math.abs(cur[i] - pv[i]), Math.abs(cur[i + 1] - pv[i + 1]), Math.abs(cur[i + 2] - pv[i + 2]));
      if (d > 0) pts.push([(i / 4) % 1280, ((i / 4) / 1280) | 0, [cur[i], cur[i + 1], cur[i + 2]], [pv[i], pv[i + 1], pv[i + 2]]]);
    }
    pv.set(cur);
    return { n, maxd, bb: n ? [x0, y0, x1, y1] : null, pts };
  });
  frames.push(st);
}
let sameRun = 0;
for (let f = 0; f < frames.length; f++) {
  const st = frames[f];
  if (st.n === -1) { console.log('F0: (基帧)'); continue; }
  if (st.n > 0) {
    const pts = (st.pts || []).map((p) => `(${p[0]},${p[1]}) ${p[2].join(',')}→${p[3].join(',')}`).join(' | ');
    console.log(`F${f}: n=${st.n} maxΔ=${st.maxd} bb=[${st.bb[0]},${st.bb[1]}-${st.bb[2]},${st.bb[3]}] ${pts}`);
    sameRun = 0;
  } else sameRun++;
}
console.log(`末尾 SAME 连跑=${sameRun}/${NFRAMES}`);
await browser.close();
