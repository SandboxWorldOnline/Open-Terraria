// ★gladd 面③ 逐字节闸（task#22,2026-10-28 补验;面① _gladd-coat-ab 同款 harness）:
// canvas 读回(主画布全幅)+tick 配对(tileAnim.tick 钉死)+rAF 停转同步驱动+全冻结
// ——A(gladd=0 2D) vs B(gladd=1 GL) 逐字节;暗场景门(夜 tod 冻 0.5 之外加 cave
// 变体——加法面假阴性判例:亮场景差值归零≠等价,须暗场)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-shine-strict.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';
import { createHash } from 'node:crypto';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
// ★SW_NOSLICE=1:shineslice GL 接管中和(运行时翻面——URL 旗会被 gotoApp 尾拼
//  污染判例)——定谳实验:B 臂脉动矿红缺失(R2 残差)是否=shineslice×gladd 交互
const NOSLICE = process.env.SW_NOSLICE === '1';
const md5 = (b64) => createHash('md5').update(Buffer.from(b64, 'base64')).digest('hex');
const results = [];
const chk = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
chk('createGame', !!gen?.ok, gen?.why ?? '');
await pump(page, 60);

// ---- 冻结套件(面①逐项抄)+gladd 运行时翻面(URL 污染判例)+gemspark 注入 ----
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
  window.__gladdSet = (v) => { r.constructor.gladd = v; };
  // ★空转隔离(SW_NOQUAD=1):quadBatchRgba monkeypatch 为不画只真——黑屏若仍在=
  // begin/end 会话壳问题(时序/屏栈);若消失=发射体(混合/纹理)问题
  if (typeof window.__noquadPatched === 'undefined') {
    window.__noquadPatched = true;
    const proto = Object.getPrototypeOf(r.sky.cloudGlLayer || r);
  }
  // ★光照引擎冻结(面③闸新增):lightsteady 转正后光照结果异步到达(1/4 率+worker
  //  往返)——两臂同 tick 也可能差一拍光照态(GB 翻回红的根因)。compute no-op=
  // 公共 r/g/b 数组冻结,两臂读同一冻结态(闸目标=shine 加法面,光照为环境)。
  g.lighting.compute = () => {};
  // ★世界动力学冻结(判例④:注入扰动液体=自造非确定源):液体模拟+尘自然生成停
  const noop = () => {};
  try { g.world.liquid && (g.world.liquid.update = noop); } catch { /* 域差异 */ }
  g.vanillaDust && (g.vanillaDust.update = noop);
  // ★随机源钉死(判例⑥:风阵/尘掷点/环境粒子吃 Math.random——跨臂随机漂移)。
  //  确定性 LCG;序列随调用推进(调用数两臂一致=等帧序列下同步;GL 路径自身
  //  不掷随机——quad 发射无 Math.random 面,序列不会因旗分叉)。
  let rs = 20261028;
  Math.random = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  // ★水波场冻结(异步 worker 结果到达=又一跨臂漂移源;水波=地表带主视觉)
  try {
    const ww = g.renderer.waterWaves;
    if (ww) { ww.frame = noop; ww.draw = noop; }
  } catch { /* 域差异 */ }
  try { g.renderer.updateWaterWaves = noop; } catch { /* 域差异 */ }
  // ★风摆带冻结(0.12% 残差=屏右缘草带绿像素:风摆相位/世界演化)——drawWindSwayTiles
  //  no-op(带内草/藤蔓整体停摆;闸目标=shine 加法面,植被为环境)
  try { g.renderer.drawWindSwayTiles = noop; } catch { /* 域差异 */ }
  // ★ambient 生物清场(判例⑧:0.1x% 残差=~6×4px 蝴蝶类 critter 跨臂状态漂移——
  //  GB 同旗也差=实体状态累积非路径面;清 critters/enemies + 冻自然刷怪=环境静场)
  g.entities.critters.length = 0;
  g.entities.enemies.length = 0;
  g.entities.drops.length = 0;
  try { g.vanillaSpawner && (g.vanillaSpawner.update = noop); } catch { /* 域差异 */ }
  // ★世界演化冻结(草蔓延/藤蔓生长——0.1x% 残差的绿像素 Frontier 根因)
  try { g.evolution && (g.evolution.update = noop); } catch { /* 域差异 */ }
  // 每臂重播种(armRun 内调):跨臂随机消费数差(2D/GL 路径面)不再传染后续臂
  window.__reseed = () => { let rs2 = 20261028; Math.random = () => { rs2 = (rs2 * 1103515245 + 12345) & 0x7fffffff; return rs2 / 0x7fffffff; }; };
  // ★判例⑬装药(2026-10-28 第三层):收敛门状态探针(shineStats)+tick 钉死器
  //  (tileAnim.tick 臂内恒值——动画相位跨臂免疫;收敛期不钉,臂序列开跑前启用)
  (async () => {
    const ts = await import('/src/render/TileShine.ts');
    window.__ts = () => ({ ...ts.shineStats });
    const ta = await import('/src/render/TileAnim.ts');
    window.__setTick = (v) => { ta.tileAnim.tick = v; };
    window.__getTick = () => ta.tileAnim.tick;
    window.__tickPinOn = false;
  })();
});
// ★等帧序列配对(判例⑤:setTick 钉 tileAnim 不充分——风摆/GTW/闪烁等 tick 派生
//  态随帧数漂移;B 臂 5 帧预热=比 A 多 5 拍。两臂【逐帧数完全一致】+同帧号快照=
// 全部 tick 派生态同拍,无需逐个冻结)。
// 停 rAF——渲染由 waitFrame 同步驱动
await page.evaluate(() => { window.__swGame.running = false; });
await freezeClock(page, { tod: 0.5 });
if (NOSLICE) {
  await page.evaluate(async () => {
    const m = await import('/src/render/TileShine.ts');
    m.shineSliceGlSetForTest(false);
  });
  console.log('[NOSLICE] shineslice GL 接管已中和(两臂恒 2D 乘法烘焙原链)');
}
// gemspark 网格注入(sheet 262 加法支;两臂共享同一世界=同输入)
const NOGEM = process.env.SW_NOGEM === '1';
const PLOG = process.env.SW_PLOG === '1';
const painted = await page.evaluate((nogem) => {
  const g = window.__swGame;
  const st = g.world.store;
  // ★地下场景(面①闸「洞穴暗光」同答案——地表噪声源族一次消灭:蝴蝶/草蔓延/
  //  风摆/天空/水面全不在地下)。挖房+注入+传送三合一。
  const px = Math.floor(g.world.spawnX), py = Math.floor(g.world.h * 0.72);   // 深层岩区
  // 挖 28×9 房(dy -6..2:头顶净空+站立地板行)
  for (let dy = -6; dy <= 2; dy++) {
    for (let dx = -13; dx <= 14; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 1 || y < 1 || x >= st.w - 1 || y >= st.h - 1) continue;
      const i = st.idx(x, y);
      st.type[i] = 0; st.flags[i] = 0; st.liquid[i] = 0; st.wall[i] = 0;
    }
  }
  // 地板(dy=3 行)+右壁(dx=15 列)实心化(防坠/防越)
  for (let dx = -13; dx <= 14; dx++) { const i = st.idx(px + dx, py + 3); st.type[i] = 1; st.flags[i] = 1; }
  for (let dy = -6; dy <= 3; dy++) { const i = st.idx(px + 15, py + dy); st.type[i] = 1; st.flags[i] = 1; }
  // gemspark 注入:右壁内侧一列(dx=+8..+12 × 5 行)+后壁点缀(屏内可见,玩家零扰动)
  let gem = -1;
  if (!nogem) {
    for (let i = 0; i < 5000; i++) {
      const d = window.__swTileDefById(i);
      if (d && d.sheet === 262) { gem = i; break; }
    }
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
  // 传送玩家进房(中央站立)
  g.player.x = (px - 3) * 16;
  g.player.y = (py + 3) * 16 - g.player.h - 1;
  g.player.vx = 0; g.player.vy = 0;
  g.camera.x = g.player.x + g.player.w / 2;
  g.camera.y = g.player.y + g.player.h / 2;
  const ch = g.chunks;
  for (let cy = Math.floor((py - 6) / 16); cy <= Math.floor((py + 3) / 16); cy++)
    for (let cx = Math.floor((px - 13) / 16); cx <= Math.floor((px + 15) / 16); cx++)
      ch.markDirty(cx, cy);
  return { n: cnt, px, py };
}, NOGEM);
if (!NOGEM) chk('gemspark 注入(地下房)', painted.n > 0, `n=${painted.n} @(${painted.px},${painted.py})`);

async function waitFrame(n = 1) {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => {
      const g = window.__swGame;
      // ★tick 钉死(判例⑬):臂序列期每帧回拨到 T0——帧内 advanceAnim +1 后
      // 渲染恒见 T0+1,动画相位跨臂逐帧同拍
      if (window.__tickPinOn && window.__setTick) window.__setTick(window.__tick0);
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      g.frame(window.__vnow);
    });
  }
}
async function snapFin() {
  return page.evaluate(() => {
    const c = window.__swGame.renderer.canvas;
    const lc = document.createElement('canvas');
    lc.width = c.width; lc.height = c.height;
    const lx = lc.getContext('2d', { willReadFrequently: true });
    lx.drawImage(c, 0, 0);
    // ★刀A 折叠复刻(与 c10eCompositeIntoHud 逐 op 同序:dest-over gl→sky)——
    //  A 臂 HUD 已垫(不透明)=空转幂等;B 臂 gladd 纯帧未垫=补折=真终像
    const rF = window.__swGame.renderer;
    // ★闩判据:已垫(A 臂/回退帧)HUD α 带⑱墙钟抖动——dest-over 会从半 α 处泄漏
    //  GL 内容进 RGB(旧读回零 α 不可见,复刻使其可见)=假差源;未垫(B 纯帧)才补折
    if (!rF._c10eComposited) {
      lx.globalCompositeOperation = 'destination-over';
      if (rF.glCanvasEl) lx.drawImage(rF.glCanvasEl, 0, 0);
      if (rF.skyCanvas) lx.drawImage(rF.skyCanvas, 0, 0);
    }
    const d = lx.getImageData(0, 0, lc.width, lc.height).data;
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) bin += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + CH, d.length)));
    return { w: c.width, h: c.height, b64: btoa(bin) };
  });
}
async function census(aFin, bFin) {
  return page.evaluate(({ a, b }) => {
    const dec = (s) => { const bin = atob(s); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const da = dec(a.b64), db = dec(b.b64);
    let n = 0, maxd = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 0) {
        n++;
        const p = i / 4, x = p % a.w, y = (p / a.w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (d > maxd) maxd = d;
      }
    }
    return { n, maxd, bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] };
  }, { a: aFin, b: bFin });
}

// ★空转隔离(SW_NOQUAD=1):B 臂前 monkeypatch quadBatchRgba 不画只真
if (process.env.SW_NOQUAD === '1') {
  await page.evaluate(async () => {
    const m = await import('/src/render/GLSpriteLayer.ts');
    const proto = m.GLSpriteLayer.prototype;
    window.__origQBR = proto.quadBatchRgba;
    proto.quadBatchRgba = function () { return true; };
  });
}
// ★end 二分(SW_NOEND=1):end no-op(不 present;pipeFbo 残留下次 begin 覆盖=
// 探针态可接受)——黑屏消失=present(fbo,over) 黑屏;仍在=begin/纹理上传
if (process.env.SW_NOEND === '1') {
  await page.evaluate(async () => {
    const m = await import('/src/render/GLSpriteLayer.ts');
    m.GLSpriteLayer.prototype.end = function () { this.pipeFbo = null; };
  });
}
// ★present 日志(SW_PLOG=1):wrap GLPipeline.present 记录 (name,over) 序列——
// A/B 帧的屏栈推入对比=丢层直读
if (PLOG) {
  await page.evaluate(async () => {
    const m = await import('/src/render/GLPipeline.ts');
    window.__plog = [];
    const orig = m.GLPipeline.prototype.present;
    m.GLPipeline.prototype.present = function (src, over) {
      window.__plog.push(`${src?.name ?? '?'}${over ? '+over' : ''}`);
      return orig.call(this, src, over);
    };
  });
}
// ★begin 二分(SW_NOBEGIN=1):begin no-op(假 FBO;配 NOQUAD+NOEND=会话只剩
// 纹理上传)——黑屏仍在=texFromImage/texRefresh 是凶手;消失=begin 绑定
if (process.env.SW_NOBEGIN === '1') {
  await page.evaluate(async () => {
    const m = await import('/src/render/GLSpriteLayer.ts');
    const orig = m.GLSpriteLayer.prototype.begin;
    m.GLSpriteLayer.prototype.begin = function (name) { this.pipeFbo = { name, tex: null, fbo: null, w: 0, h: 0 }; };
  });
}
// ★管线预热(判例⑨:swPipe 惰性创建——gladd 臂首次 acquireCloudPipe 才建管线,
//  未预热=A 臂全程 2D 兜底后端 vs B 臂 c10e 管线后端=两臂不同后端对比(present
//  日志直读:A=0 发/B=30 发)。两臂统一 acquireCloudPipe+几帧=同后端,余差=纯 shine 面)
// ★2D shine 计数器(诊断:被调次数/有 add 层的 chunk 数)
await page.evaluate(async () => {
  const m = await import('/src/render/TileShine.ts');
  window.__shine2d = { calls: 0, chunks: 0 };
  const orig = m.drawTileShineAdditive;
  const nw = function (ctx, world, chunks, cam, viewW, viewH, z, lowK) {
    window.__shine2d.calls++;
    try {
      const bx0 = Math.floor((cam.x - viewW / 2 / z) / 256) - 1;
      const bx1 = Math.floor((cam.x + viewW / 2 / z) / 256) + 1;
      const by0 = Math.floor((cam.y - viewH / 2 / z) / 256) - 1;
      const by1 = Math.floor((cam.y + viewH / 2 / z) / 256) + 1;
      for (let cy = by0; cy <= by1; cy++)
        for (let cx = bx0; cx <= bx1; cx++)
          if (m.shineAddLayerOf(chunks.get(cx, cy))) window.__shine2d.chunks++;
    } catch { /* 诊断 */ }
    return orig.call(this, ctx, world, chunks, cam, viewW, viewH, z, lowK);
  };
  // 模块导出是 let/const 直引用——Renderer import 的绑定不可换;改 renderer 侧
  // 调用计数:wrap renderer 实例无关。退而求其次:在 runArm A 臂后直接页内复算。
});
const warmed = await page.evaluate(() => {
  const r = window.__swGame.renderer;
  // ★面②中和(gemspark=发光方块→itemGlow 队列非空→面② 会话在 B 臂活跃=混合
  //  面②登记微差。面②已独立验收;本闸纯化=两臂清空 itemGlow 队列+GL flush 置
  //  空转,余差=纯面③)
  r['flushItemGlowGL'] = function () {
    this.itemGlowQueue = [];
    this.itemGlowHeldCollected = new WeakSet();
    return true;
  };
  // ★对称中和(2026-10-28 第三层 R2 定谳续):只中和 GL 侧=臂间不对称——岩浆
  //  (tileGlow 发光 tile,场景副簇 0+liq255×41+熔岩苔 44 块)的 glow 在 A/P 臂
  //  被 2D flushItemGlow(7357 位)画出、B 臂被清=4320px 假差(R2 真身,非 gladd
  //  路径差)。2D 消费面同款清队=两臂对称零 itemGlow,闸纯度不变。
  r['flushItemGlow'] = function () {
    this.itemGlowQueue = [];
    this.itemGlowHeldCollected = new WeakSet();
  };
  return !!r.acquireCloudPipe();
});
chk('管线预热(两臂同后端)', warmed, warmed ? 'c10e pipe 就绪' : 'pipe 不可用(闸无效)');
// ★判例⑬装药:renderChunk/markDirty 单调计数(pair 换代/素材晚到重烘的账面)。
//  renderChunk=pair 唯一创建点;markDirty=注入/晚到表的重建源。
await page.evaluate(() => {
  const g = window.__swGame;
  const CP = Object.getPrototypeOf(g.chunks);
  window.__rcCount = 0; window.__mdCount = 0;
  const origRC = CP.renderChunk;
  CP.renderChunk = function (cx, cy) { window.__rcCount++; return origRC.call(this, cx, cy); };
  const origMD = CP.constructor.prototype.markDirty;
  CP.constructor.prototype.markDirty = function (cx, cy) { window.__mdCount++; return origMD.call(this, cx, cy); };
});
// ★收敛门 v3(判例⑬,2026-10-28 第三层定谳后重设计;v2 再修):注入+传送后有多波
//  渐进收敛——①预算占位对排干(budgetAwaiting)②pair 换代 shine 重烘波③素材晚到
//  重烘波(陶罐表28/熔岩苔表381/gemspark表262 等视野新暴露 tile 的表图片异步
//  到位→chunk 重建+shine 重烘,~0.8-1.5s 墙钟;上轮 R1=陶罐即此波臂间完成伪影)
//  ④worker 回包换代波(墙钟 1-3s,逐跑漂移——v2 实测 25 帧门 bakes=96 vs 另跑
//  144=波尾扫进臂 A:帧数门不可靠,【波间隙>静止窗】会假收敛)。v3 判据=
//  画面静止(全幅 SHA-256 连续 5 帧全等)∧ 账面全清(bA/wA/dQ/pending=0 ∧
//  bakes/skips 不动 ∧ renderChunk/markDirty 零调用)∧【墙钟下限 3.5s】
//  (异步波全落地的硬垫)。tick 从门起钉死(动画帧冻结=画面静止必要条件)。
{
  await page.evaluate(() => { window.__tick0 = window.__getTick(); window.__tickPinOn = true; });
  const t0 = Date.now();
  let stable = 0, convFrames = 0, info = null, last = null;
  while ((stable < 5 || Date.now() - t0 < 3500) && convFrames < 500) {
    const st = await page.evaluate(async () => {
      const g = window.__swGame;
      if (window.__tickPinOn && window.__setTick) window.__setTick(window.__tick0);
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      g.frame(window.__vnow);
      const c = g.renderer.canvas;
      // ★刀A 折叠复刻(dest-over gl→sky 同序;A 幂等/B 补折)
      const rF = g.renderer;
      if (!window.__foldSnap) window.__foldSnap = document.createElement('canvas');
      const fs2 = window.__foldSnap;
      if (fs2.width !== c.width || fs2.height !== c.height) { fs2.width = c.width; fs2.height = c.height; }
      const fx2 = fs2.getContext('2d', { willReadFrequently: true });
      fx2.globalCompositeOperation = 'source-over';
      fx2.clearRect(0, 0, fs2.width, fs2.height);
      fx2.drawImage(c, 0, 0);
      if (!rF._c10eComposited) {
        fx2.globalCompositeOperation = 'destination-over';
        if (rF.glCanvasEl) fx2.drawImage(rF.glCanvasEl, 0, 0);
        if (rF.skyCanvas) fx2.drawImage(rF.skyCanvas, 0, 0);
      }
      const buf = fx2.getImageData(0, 0, fs2.width, fs2.height).data.buffer;
      const h = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
      const ch = g.chunks;
      const ts = window.__ts();
      return {
        hex, pending: ts.pending, bakes: ts.bakes, skips: ts.skips,
        bA: ch.budgetAwaiting ? ch.budgetAwaiting.size : -1,
        wA: ch.workerAwaiting ? ch.workerAwaiting.size : -1,
        dQ: ch.dirtyQueue ? ch.dirtyQueue.length : -1,
        rc: window.__rcCount, md: window.__mdCount,
      };
    });
    const still = !!last && last.hex === st.hex && st.pending === 0
      && last.bakes === st.bakes && last.skips === st.skips
      && st.bA === 0 && st.wA === 0 && st.dQ === 0
      && last.rc === st.rc && last.md === st.md;
    stable = still ? stable + 1 : 0;
    last = st; info = st; convFrames++;
  }
  chk('收敛门 v3(画面静止 5 连拍+账面全清+墙钟 3.5s)', stable >= 5 && Date.now() - t0 >= 3500,
    `frames=${convFrames} wall=${Math.round(Date.now() - t0)}ms bakes=${info?.bakes} skips=${info?.skips} rc=${info?.rc} md=${info?.md} hash=${info?.hex?.slice(0, 8)}`);
}
// ---- 臂驱动器:5 预热帧+3 快照帧,两臂帧序列逐帧一致(判例⑤) ----
const fins = {};
async function runArm(tag) {
  await page.evaluate(() => window.__reseed());
  if (PLOG) await page.evaluate(() => { window.__plog = []; });
  await waitFrame(5);
  for (let k = 0; k < 3; k++) {
    await waitFrame(1);
    fins[tag + k] = await snapFin();
  }
  if (PLOG) {
    const log = await page.evaluate(() => window.__plog.splice(0));
    console.log(`  [${tag}] present 序列(${log.length}): ${log.slice(0, 40).join(' ')}`);
  }
  // 2D 复算:当前帧 add 层可见 chunk 数+GL 侧 plans 对照
  const probe = await page.evaluate(async () => {
    const m = await import('/src/render/TileShine.ts');
    const g = window.__swGame;
    const cam = g.camera, viewW = innerWidth, viewH = innerHeight, z = cam.zoom || 1;
    let n = 0;
    const bx0 = Math.floor((cam.x - viewW / 2 / z) / 256) - 1;
    const bx1 = Math.floor((cam.x + viewW / 2 / z) / 256) + 1;
    const by0 = Math.floor((cam.y - viewH / 2 / z) / 256) - 1;
    const by1 = Math.floor((cam.y + viewH / 2 / z) / 256) + 1;
    for (let cy = by0; cy <= by1; cy++)
      for (let cx = bx0; cx <= bx1; cx++)
        if (m.shineAddLayerOf(g.chunks.get(cx, cy))) n++;
    return { addChunks: n, shineGl: g.renderer.gladdShineStats.gl, tex: g.renderer['_shineAddTex']?.size ?? 0 };
  });
  console.log(`  [${tag}] add 层 chunk 数=${probe.addChunks} glStats.gl=${probe.shineGl} texCache=${probe.tex}`);
}
await page.evaluate(() => window.__gladdSet(false));
await runArm('A');
await page.evaluate(() => window.__gladdSet(process.env.SW_AA === '1' ? false : true));
const stB0 = await page.evaluate(() => ({ ...window.__swGame.renderer.gladdShineStats }));
await runArm('B');
const stB1 = await page.evaluate(() => ({ ...window.__swGame.renderer.gladdShineStats }));
// A' 臂:翻回 2D 同帧序列——A'≡A 双证(harness 确定性∧GL 无残留)
await page.evaluate(() => window.__gladdSet(false));
await runArm('P');
chk('GC B 态 GL 会话实走', stB1.gl > stB0.gl && (stB1.fb - stB0.fb) === 0,
  `Δgl=${stB1.gl - stB0.gl} Δfb=${stB1.fb - stB0.fb}`);
// ---- GA 逐字节判定 ----
let allEq = true; let worst = null;
for (let k = 0; k < 3; k++) {
  const eq = fins['A' + k].b64 === fins['B' + k].b64;
  allEq = allEq && eq;
  if (!eq) {
    const c = await census(fins['A' + k], fins['B' + k]);
    console.log(`  [tick${k}] md5 A=${md5(fins['A' + k].b64).slice(0, 8)} B=${md5(fins['B' + k].b64).slice(0, 8)} n=${c.n}(${(c.n * 100 / (fins.A0.w * fins.A0.h)).toFixed(3)}%) maxΔ=${c.maxd} bbox=${JSON.stringify(c.bbox)}`);
    if (!worst || c.n > worst.c.n) worst = { k, c };
  }
}
chk('GA A≡B 逐字节（3 tick 配对,gemspark 加法支暗场门）', allEq,
  allEq ? `md5=${md5(fins.A0.b64).slice(0, 8)}` : (worst ? `n=${worst.c.n} maxΔ=${worst.c.maxd} bbox=${JSON.stringify(worst.c.bbox)}` : ''));
// 定点诊断:前 12 个差异像素的坐标+值(颜色指纹反推视觉元素)
if (!allEq) {
  const diag = await page.evaluate(({ a, b }) => {
    const dec = (s) => { const bin = atob(s); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const da = dec(a.b64), db = dec(b.b64);
    const rows = [];
    for (let p = 0; p < da.length / 4 && rows.length < 12; p++) {
      const i = p * 4;
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 0) rows.push({ x: p % a.w, y: (p / a.w) | 0, A: [da[i], da[i + 1], da[i + 2]], B: [db[i], db[i + 1], db[i + 2]] });
    }
    return rows;
  }, { a: fins.A0, b: fins.B0 });
  for (const d of diag) console.log(`  (${d.x},${d.y}) A=(${d.A.join(',')}) B=(${d.B.join(',')})`);
  // GB 同样定位(A' vs A——同旗差=非 GL 因素)
  const diag2 = await page.evaluate(({ a, b }) => {
    const dec = (s) => { const bin = atob(s); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const da = dec(a.b64), db = dec(b.b64);
    const rows = [];
    for (let p = 0; p < da.length / 4 && rows.length < 6; p++) {
      const i = p * 4;
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 0) rows.push({ x: p % a.w, y: (p / a.w) | 0, A: [da[i], da[i + 1], da[i + 2]], B: [db[i], db[i + 1], db[i + 2]] });
    }
    return rows;
  }, { a: fins.A0, b: fins.P0 });
  console.log('  -- GB(A-prime vs A)差异样本:');
  for (const d of diag2) console.log(`  (${d.x},${d.y}) A=(${d.A.join(',')}) A'=(${d.B.join(',')})`);
}
// ★导 PNG(诊断:62% 差需目视)
try {
  const { writeFileSync } = await import('node:fs');
  for (const tag of ['A0', 'B0', 'P0']) {
    if (fins[tag]) {
      const bin = Buffer.from(fins[tag].b64, 'base64');
      const { PNG } = await import('node:zlib');
      // raw RGBA → PNG 经最小编码器太重;直接存 .raw + 用 python 转
      writeFileSync(`/Users/vinlic/.claude/jobs/d3098226/tmp/shine-${tag}.rgba`, bin);
    }
  }
  console.log('PNG 导出: /Users/vinlic/.claude/jobs/d3098226/tmp/shine-{A0,B0,P0}.rgba');
} catch (e) { console.log('导出失败', e.message); }

// ---- GB A'≡A(无残留+harness 确定性双证;A' 第 k 帧对比 A 第 k 帧) ----
let gbOk = true, gbFirst = '';
for (let k = 0; k < 3; k++) {
  if (fins['P' + k].b64 !== fins['A' + k].b64) { gbOk = false; gbFirst = gbFirst || `k${k}`; }
}
chk('GB A\'≡A 翻回恢复（GL 无残留∧harness 确定性）', gbOk,
  gbOk ? `md5=${md5(fins.P0.b64).slice(0, 8)}` : `首差=${gbFirst}(若 GA 亦红=世界动力学未净;GA 绿 GB 红=残留)`);
await browser.close();
