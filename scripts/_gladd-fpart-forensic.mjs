// ★gladd 面⑩ 白泛法医探针(2026-10-28):三级读回定位非法预乘注入点。
//  假设链:tintedOf 烘焙布(multiply 填充+dest-in)若残留「α=0 而 rgb=填充色」的
//  非法预乘值 → texFromImage(UNPACK_PREMULTIPLY=true)直拷预乘字节 → PRECIP_FS
//  additive vCol.a=0 路径 c.rgb 原值入屏 = 白泛。getImageData(反预乘钳0)不可见
//  =「xfer 修复无效」与「tinted 逐槽不变」的统一解释。唯一可见仪器=readPixels
//  直读纹理存储字节(FBO attach+readPixels=无反预乘)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=300000 scripts/_gladd-fpart-forensic.mjs
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

// 注入与闸同款 4 粒子,跑 2 帧(第 1 帧烘焙+上传,第 2 帧发射)
await page.evaluate(async () => {
  const g = window.__swGame;
  const M = await import('/src/fx/FadingParticles.ts');
  const px = g.player.x, py = g.player.y;
  const cfgs = [
    { x: px + 150, y: py - 80, timeToLive: 100000, fadeIn: 0, fadeOut: 0.001, texKey: 'vanilla/Extra_34.png', tint: [255, 200, 100, 0], rot: 0.6, scaleX: 1.5, scaleY: 1.2, fullbright: true },
    { x: px - 200, y: py - 140, timeToLive: 100000, fadeIn: 0, fadeOut: 0.001, texKey: 'vanilla/Extra_34.png', tint: [120, 220, 255, 0], rot: -1.1, scaleX: 0.8, scaleY: 2, fullbright: true },
    { x: px + 40, y: py - 220, timeToLive: 100000, fadeIn: 0, fadeOut: 0.001, texKey: 'vanilla/Projectile_1121.png', tint: [255, 120, 120, 0], rot: 0.2, scaleX: 1.1, scaleY: 0.9, fullbright: true },
    { x: px - 90, y: py - 40, timeToLive: 100000, fadeIn: 0, fadeOut: 0.001, texKey: 'vanilla/Projectile_1121.png', tint: [200, 255, 150, 0], rot: 2.2, scaleX: 1.3, scaleY: 1.3, fullbright: true },
  ];
  for (const cfg of cfgs) M.fadingParticles.spawn(cfg);
});
// ★暖机:ensureVImage 异步加载+失败负缓存 10s TTL(闸的 10s 收敛门天然解锁重试;
//  探针必须轮询到图落地)。逐帧 evaluate 轮询——同步循环堵事件循环=onload 永不落地
let warm = null;
for (let i = 0; i < 1200; i++) {
  warm = await page.evaluate(() => {
    const g = window.__swGame;
    window.__setTick(100000); window.__pinGT(0);
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
    const a = g.renderer.atlas;
    return {
      e34: !!a.ensureVImage('vanilla/Extra_34.png'),
      p1121: !!a.ensureVImage('vanilla/Projectile_1121.png'),
      tinted: g.renderer['fadingTintCache']?.size ?? -1,
    };
  });
  if (warm.e34 && warm.p1121 && warm.tinted >= 2) break;
}
console.log('[warmup]', JSON.stringify(warm));
// ★终极取证:wrap quadBatchRgba 一帧——提交数据/绘制前FBO/绘制后FBO/纹理字节 同拍
const wrapLog = await page.evaluate(() => {
  const g = window.__swGame;
  const r = g.renderer;
  const layer = r.acquireCloudPipe();
  const proto = Object.getPrototypeOf(layer);
  const orig = proto.quadBatchRgba;
  const log = [];
  proto.quadBatchRgba = function (e, data, quads, smooth) {
    const glc = this['gl'];
    const isFpart = this.pipeFbo && this.pipeFbo.name === 'fpart';
    if (!isFpart || log.length >= 2 || !glc) return orig.call(this, e, data, quads, smooth);
    // 顶点样本:quad0 中心与四角(设备px+uv+vCol)
    const vs = [];
    for (const i of [0, 1, 2, 3, 4, 5]) {
      vs.push({ pos: [data[i * 8], data[i * 8 + 1]], uv: [data[i * 8 + 2], data[i * 8 + 3]], col: [data[i * 8 + 4], data[i * 8 + 5], data[i * 8 + 6], data[i * 8 + 7]] });
    }
    // 绘制前 FBO 中心读点(用 quad 覆盖中心的整数点)
    const cx = Math.round((vs[0].pos[0] + vs[2].pos[0]) / 2), cy = Math.round((vs[0].pos[1] + vs[2].pos[1]) / 2);
    const readFbo = (x, y) => {
      const px = new Uint8Array(4);
      const vh = glc.getParameter(glc.VIEWPORT)[3];
      glc.readPixels(x, vh - 1 - y, 1, 1, glc.RGBA, glc.UNSIGNED_BYTE, px);   // GL y 上翻
      return [px[0], px[1], px[2], px[3]];
    };
    const before = readFbo(cx, cy);
    // 纹理字节@uv(quad 中心 uv)
    const uvc = [(vs[0].uv[0] + vs[2].uv[0]) / 2, (vs[0].uv[1] + vs[2].uv[1]) / 2];
    const fb2 = glc.createFramebuffer();
    glc.bindFramebuffer(glc.FRAMEBUFFER, fb2);
    glc.framebufferTexture2D(glc.FRAMEBUFFER, glc.COLOR_ATTACHMENT0, glc.TEXTURE_2D, e.tex, 0);
    const tp = new Uint8Array(4);
    glc.readPixels(Math.min(e.w - 1, Math.floor(uvc[0] * e.w)), Math.min(e.h - 1, Math.floor(uvc[1] * e.h)), 1, 1, glc.RGBA, glc.UNSIGNED_BYTE, tp);
    glc.bindFramebuffer(glc.FRAMEBUFFER, fb2 === null ? null : null);
    // 还原 FBO 绑定(pipeFbo)
    this['pipe'].bindTarget(this.pipeFbo);
    const texAt = [tp[0], tp[1], tp[2], tp[3]];
    const ok = orig.call(this, e, data, quads, smooth);
    const after = readFbo(cx, cy);
    log.push({ e: { w: e.w, h: e.h, key: e.key ?? '?' }, center: [cx, cy], uvc, vcol: vs[0].col, texAt, before, after, ok, quads });
    return ok;
  };
  window.__setTick(100000); window.__pinGT(0);
  window.__vnow = (window.__vnow || performance.now()) + 16.6667;
  g.frame(window.__vnow);
  proto.quadBatchRgba = orig;
  return log;
});
console.log('[quadWrap]', JSON.stringify(wrapLog, null, 1));

const out = await page.evaluate(() => {
  const g = window.__swGame;
  const r = g.renderer;
  const rep = { rawCensus: {}, tintCensus: {}, texCensus: {}, fboCensus: {} };
  const bucket = (r_, g_, b_) => `${r_ >> 6},${g_ >> 6},${b_ >> 6}`;
  const colorCensus = (d) => {
    let a0 = 0, op = 0, semi = 0, whiteOp = 0, blackOp = 0;
    const m = new Map();
    let sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) { a0++; continue; }
      if (a === 255) op++; else semi++;
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) whiteOp++;
      else if (d[i] < 16 && d[i + 1] < 16 && d[i + 2] < 16) blackOp++;
      sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
      const k = bucket(d[i], d[i + 1], d[i + 2]);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    const n = op + semi;
    return { a0, op, semi, whiteOp, blackOp, avg: n ? sum.map((v) => Math.round(v / n)) : null,
      top: [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(' ') };
  };
  // ---- ⓪ 原图(ensureVImage 实际加载对象)色普查:scratch 画布拷贝 ----
  for (const key of ['vanilla/Projectile_1121.png', 'vanilla/Extra_34.png']) {
    const img = r.atlas.ensureVImage(key);
    if (!img) { rep.rawCensus[key] = { err: 'null' }; continue; }
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cc = c.getContext('2d', { willReadFrequently: true });
    cc.drawImage(img, 0, 0);
    rep.rawCensus[key] = { w: img.width, h: img.height, ctor: img.constructor.name, ...colorCensus(cc.getImageData(0, 0, c.width, c.height).data) };
  }
  // ---- ① tinted 烘焙布+①' xfer 传输布 色普查 ----
  const cache = r['fadingTintCache'];
  for (const [key, c] of cache) {
    const cc = c.getContext('2d', { willReadFrequently: true });
    rep.tintCensus[key] = { w: c.width, h: c.height, ...colorCensus(cc.getImageData(0, 0, c.width, c.height).data) };
  }
  for (const [src, xfer] of (r['_fpartTintXfer'] ?? [])) {
    const xc = xfer.getContext('2d', { willReadFrequently: true });
    rep.tintCensus[`xfer ${xfer.width}x${xfer.height}`] = colorCensus(xc.getImageData(0, 0, xfer.width, xfer.height).data);
  }
  // ---- ② GL 纹理存储字节:scratch FBO attach+readPixels(无反预乘=真值) ----
  const pipeLayer = r.acquireCloudPipe();
  const glc = pipeLayer['gl'];
  if (glc) {
    rep.hasGL = true;
    const texs = r['_fpartTintTex'];
    for (const [canvas, entry] of texs) {
      const w = entry.w ?? canvas.width, h = entry.h ?? canvas.height;
      const fb = glc.createFramebuffer();
      glc.bindFramebuffer(glc.FRAMEBUFFER, fb);
      glc.framebufferTexture2D(glc.FRAMEBUFFER, glc.COLOR_ATTACHMENT0, glc.TEXTURE_2D, entry.tex, 0);
      const px = new Uint8Array(w * h * 4);
      glc.readPixels(0, 0, w, h, glc.RGBA, glc.UNSIGNED_BYTE, px);
      glc.bindFramebuffer(glc.FRAMEBUFFER, null);
      glc.deleteFramebuffer(fb);
      rep.texCensus[`tintTex ${w}x${h}`] = colorCensus(px);
    }
    // ---- ③ fpart FBO(additive 层内容):pipe.fbo('fpart') bindTarget+readPixels ----
    try {
      const pipe = pipeLayer['pipe'];
      if (pipe) {
        const W = pipeLayer.canvas.width, H = pipeLayer.canvas.height;
        const f = pipe.fbo('fpart', W, H);
        if (f) {
          pipe.bindTarget(f);
          const fp = new Uint8Array(W * H * 4);
          glc.readPixels(0, 0, W, H, glc.RGBA, glc.UNSIGNED_BYTE, fp);
          pipe.bindTarget(null);
          let a0rgb = 0, a0avg = [0, 0, 0], bright = 0, samples = [];
          for (let i = 0; i < fp.length; i += 4) {
            const L = (fp[i] + fp[i + 1] + fp[i + 2]) / 3;
            if (fp[i + 3] === 0 && (fp[i] | fp[i + 1] | fp[i + 2])) {
              a0rgb++; a0avg[0] += fp[i]; a0avg[1] += fp[i + 1]; a0avg[2] += fp[i + 2];
              if (samples.length < 8) samples.push([fp[i], fp[i + 1], fp[i + 2]]);
            }
            if (L > 200) bright++;
          }
          rep.fboCensus = { a0rgb, a0avg: a0rgb ? a0avg.map((v) => Math.round(v / a0rgb)) : null, bright, samples, W, H };
        } else rep.fboCensus = { err: 'fpart fbo 不存在' };
      }
    } catch (e) { rep.fboCensus = { err: String(e) }; }
  } else rep.hasGL = false;
  // ⑤ 粒子屏位(vCol 与 env 实值)
  const parts = [];
  for (const f of (function* () { yield* (window.__swGame ? [] : []); })()) {}
  rep.stats = { ...r.gladdFPartStats };
  return rep;
});
// ⑥ 粒子参数+env 实值(独立 evaluate:FadingParticles 模块)
const partsInfo = await page.evaluate(async () => {
  const M = await import('/src/fx/FadingParticles.ts');
  const g = window.__swGame;
  const out = [];
  for (const f of M.fadingParticles.each()) {
    const [sx, sy] = g.camera.worldToScreen(f.x, f.y);
    out.push({ texKey: f.texKey, screen: [Math.round(sx), Math.round(sy)], tint: [f.tintR, f.tintG, f.tintB, f.tintA], rot: f.rot, sx: f.scaleX, sy: f.scaleY, tss: f.timeSinceSpawn });
  }
  return out;
});
console.log(JSON.stringify({ ...out, partsInfo }, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
