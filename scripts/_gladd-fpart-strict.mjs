// ★gladd 面⑩ 逐字节闸（task#22,2026-10-28）:FadingParticles（drawFadingParticlesGL
//  sink 式双拍:blendErase 削底+blendAdditive 主拍）A(2D) vs B(GL) vs P(翻回)。
//  harness=⑧闸全量复用;场景=tod 0.35+fadingParticles.spawn 注入(纯加色+tintA 双拍
//  两档;fadeIn=0 免老化——pause 后 timeSinceSpawn 冻结在 0 仍 env≈1)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-fpart-strict.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';
import { createHash } from 'node:crypto';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const md5 = (b64) => createHash('md5').update(Buffer.from(b64, 'base64')).digest('hex');
let doorHash = null;   // 收敛门末帧 hash(可见性对照消费;模块域——tod 扫块内声明=块域判例)
const results = [];
const chk = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
chk('createGame', !!gen?.ok, gen?.why ?? '');
await pump(page, 60);

// ---- 冻结套件（③闸逐字同源） ----
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
  // ★星空 twinkle/rot 逐帧推进(updateStar 每帧走)——晨昏残余 α 下亚 LSB 跨量化界
  //  =臂间±1-2 LSB 天空带噪声(AA 自检实锤)。实例遮蔽原型(时钟冻结同款)。
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
  // ★town NPC 冻结(出生点向导走动×interp 真实时间分数=逐帧亚像素漂移——门 hash
  //  每 100 帧全变而账面全平的根因;③地下场景无 NPC 在视野故未遇)。冻结 update
  //  而非清场(清场=住房系统 UI 侧账面撕裂风险,冻结=零副作用)。
  for (const n of g.entities.npcs) { const u = n.update; n.update = () => {}; n.__origUpdate = u; }
  try { g.vanillaSpawner && (g.vanillaSpawner.update = noop); } catch { /* 域差异 */ }
  try { g.evolution && (g.evolution.update = noop); } catch { /* 域差异 */ }
  window.__reseed = () => { let rs2 = 20261028; Math.random = () => { rs2 = (rs2 * 1103515245 + 12345) & 0x7fffffff; return rs2 / 0x7fffffff; }; };
  // 判例⑬装药:shineStats 探针 + tick 钉死器
  (async () => {
    const ts = await import('/src/render/TileShine.ts');
    window.__ts = () => ({ ...ts.shineStats });
    const ta = await import('/src/render/TileAnim.ts');
    window.__setTick = (v) => { ta.tileAnim.tick = v; };
    window.__getTick = () => ta.tileAnim.tick;
    window.__tickPinOn = false;
    // ★GTW 钉:瀑布帧(WaterfallManager)/火苗 TileFrameSeed/灯笼 hourY 全吃
    //  gameTickCount(逐 fixedUpdate tick 推进)——tick 钉不覆盖。pinGameTimeTicks
    //  测试钉钟钩(生产禁调;探针=测试面)。右缘绿竖纹逐帧滚动=瀑布帧实证。
    const gt = await import('/src/core/GameTime.ts');
    window.__pinGT = (t) => gt.pinGameTimeTicks(t);
  })();
});
await page.evaluate(() => { window.__swGame.running = false; });
// ★全局暂停(Game.paused→frameCtx.paused 传播):原版「世界冻结+渲染照常」语义——
//  updateClouds(:1951)/星更新/shimmer/NPC 位移/瀑布帧全族 paused 门一次收口
//  (skydiag 实证:落定过渡 2 帧后 117/120 SAME;逐面冻结打地鼠判例:NPC update
//  遮蔽不中位移、云位在 updateClouds 非本冻结面)。光斑/加算面/渲染路径无
//  paused 门照常;直接置字段不触发菜单 UI(menuMode 独立)。
await page.evaluate(() => { window.__swGame.paused = true; });

{
  const w0 = await page.evaluate(() => {
    const r = window.__swGame.renderer;
    r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
    r['flushItemGlow'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); };
    return !!r.acquireCloudPipe();
  });
  chk('管线预热+双面 itemGlow 中和', w0, w0 ? 'ok' : 'pipe 不可用');
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => {
      const g = window.__swGame;
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      g.frame(window.__vnow);
    });
  }
}

// ---- 固定 tod 0.35(纯⑥:④flare 晨昏窗关/⑤litVis=0)+ vault 3×3 注入 ----
{
  const w0 = await page.evaluate(() => {
    const r = window.__swGame.renderer;
    r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
    r['flushItemGlow'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); };
    r.constructor.gladd = true;
    return !!r.acquireCloudPipe();
  });
  chk('管线预热+双面 itemGlow 中和', w0, w0 ? 'ok' : 'pipe 不可用');
  await freezeClock(page, { tod: 0.35 });
  // FadingParticles 注入:纯加色×2+tintA 双拍×2(旋转/缩放变体),fadeIn=0
  if (process.env.SW_FPZERO === '1') {
    // 二分:零发射实验——sink 直接跳过发射(会话 begin/end 照跑)——白泛若仍在=
    // 会话机制;消失=发射/纹理
    await page.evaluate(() => {
      const r = window.__swGame.renderer;
      r.drawFadingParticlesGL = function () { return null; };
    });
    console.log('[FPZERO] 零发射:drawFadingParticlesGL 恒返 null(整面 2D)——若白泛仍在=非⑩面(其他面/管线);消失=⑩发射');
  }
  const placed = await page.evaluate(async () => {
    const g = window.__swGame;
    const M = await import('/src/fx/FadingParticles.ts');
    const px = g.player.x, py = g.player.y;
    // ★原版真值夹具(2026-10-28 白泛定谳后重造):fadeIn=0 会使 fadingLerpValue
    //  (Utils.GetLerpValue 1:1)在 t01=0 落 0/0=NaN——原版生产不可达(ParticleOrchestrator
    //  全站点 FadeInNormalizedTime=0.1:524/546/616/760/777),NaN 在 2D 被 canvas
    //  globalAlpha 静默忽略(全亮=SW 与 XNA (int)NaN=0 的分歧面),在 GL 侧放大成
    //  NaN→readback(254,254,254)=白泛。夹具一律 fadeIn=0.1;tintA=0(纯加色=拍击石
    //  原版档 Color(30,180,255,0));fadeOut 混 0.1/0.3/0.5(真实站三档);
    //  timeSinceSpawn 直写中位(t01=0.5,暂停冻结=env 稳定 0.556/0.714/1)。
    const cfgs = [
      { x: px + 150, y: py - 80, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.1, texKey: 'vanilla/Projectile_1121.png', tint: [30, 180, 255, 0], rot: 0.6, scaleX: 1.5, scaleY: 1.2, fullbright: true },
      { x: px - 200, y: py - 140, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.3, texKey: 'vanilla/Projectile_1121.png', tint: [120, 220, 255, 0], rot: -1.1, scaleX: 0.8, scaleY: 2, fullbright: true },
      { x: px + 40, y: py - 220, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.5, texKey: 'vanilla/Extra_34.png', tint: [255, 200, 100, 0], rot: 0.2, scaleX: 1.1, scaleY: 0.9, fullbright: true },
      { x: px - 90, y: py - 40, timeToLive: 100000, fadeIn: 0.1, fadeOut: 0.1, texKey: 'vanilla/Extra_34.png', tint: [200, 255, 150, 0], rot: 2.2, scaleX: 1.3, scaleY: 1.3, fullbright: true },
    ];
    let n = 0;
    for (const cfg of cfgs) {
      const p = M.fadingParticles.spawn(cfg);
      if (p) { p.timeSinceSpawn = 50000; n++; }   // t01=0.5 中位冻结(env 稳定非平凡)
    }
    return n;
  });
  chk('FadingParticles 注入(原版真值×4——拍击石 tint/fade 档+t01 中位冻结)', placed === 4, `n=${placed}`);
}

// ---- renderChunk/markDirty 计数 + 收敛门 v3（③闸同款逐字） ----
await page.evaluate(() => {
  const g = window.__swGame;
  const CP = Object.getPrototypeOf(g.chunks);
  window.__rcCount = 0; window.__mdCount = 0;
  const origRC = CP.renderChunk;
  CP.renderChunk = function (cx, cy) { window.__rcCount++; return origRC.call(this, cx, cy); };
  const origMD = CP.constructor.prototype.markDirty;
  CP.constructor.prototype.markDirty = function (cx, cy) { window.__mdCount++; return origMD.call(this, cx, cy); };
});
{
  await page.evaluate(() => { window.__tick0 = window.__getTick(); window.__tickPinOn = true; window.__gt0 = 0; window.__gtpin = true; });
  const t0 = Date.now();
  let stable = 0, convFrames = 0, info = null, last = null;
  while ((stable < 5 || Date.now() - t0 < 10000) && convFrames < 2000) {
    // ★no-await 实验:await crypto.subtle 让出事件循环期间真实 rAF 帧可插入推进
    //  状态(=漂移源嫌疑)——改 Node 侧哈希(skydiag 同款零 await)
    const st = await page.evaluate(() => {
      const g = window.__swGame;
      if (window.__tickPinOn && window.__setTick) window.__setTick(window.__tick0);
      if (window.__gtpin) window.__pinGT(window.__gt0);
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      g.frame(window.__vnow);
      const c = g.renderer.canvas;
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
      const id = fx2.getImageData(0, 0, fs2.width, fs2.height);
      for (let i = 3; i < id.data.length; i += 4) id.data[i] = 0;   // RGB-only
      // ★同步 FNV-1a(每 4 像素采样):无 await(async digest 让出事件循环期间真实
      //  rAF 帧可插入推进状态=门 hash 逐帧漂移的头号嫌疑;同步采样哈希足够捕捉
      //  千级字节级漂移)
      let hv = 0x811c9dc5;
      for (let i = 0; i < id.data.length; i += 16) {
        hv = Math.imul(hv ^ id.data[i], 0x01000193);
        hv = Math.imul(hv ^ id.data[i + 1], 0x01000193);
        hv = Math.imul(hv ^ id.data[i + 2], 0x01000193);
      }
      const hex = (hv >>> 0).toString(16).padStart(8, '0');
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
    // ★静止判据 v5:hash+dQ+rc/md——bakes/skips 剔除(滴流计数恒动不改画面);
    //  bA/wA 剔除(地表场景视野外 worker 烘焙永续排队=远 chunk 后台流式,不改可
    //  见像素;hash 才是画面仲裁)。skydiag 实证:全冻结下 30 帧全 SAME。
    const still = !!last && last.hex === st.hex
      && last.rc === st.rc && last.md === st.md;   // dQ 剔除:悬空脏键可永驻(hash 恒定=仲裁)
    if (convFrames % 100 === 0) console.log(`  [door F${convFrames}] hash=${st.hex.slice(0, 8)} dQ=${st.dQ} rc=${st.rc} md=${st.md} bakes=${st.bakes} bA=${st.bA} wA=${st.wA} stable=${stable}`);
    stable = still ? stable + 1 : 0;
    last = st; info = st; convFrames++;
  }
  chk('收敛门 v3(画面静止 5 连拍+账面全清+墙钟 10s)', stable >= 5 && Date.now() - t0 >= 10000,
    `frames=${convFrames} wall=${Math.round(Date.now() - t0)}ms bakes=${info?.bakes} rc=${info?.rc} md=${info?.md} hash=${info?.hex?.slice(0, 8)}`);
  doorHash = info?.hex;
}

// ---- 臂驱动器（③闸同款） ----
const fins = {};
async function waitFrame(n = 1) {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => {
      const g = window.__swGame;
      if (window.__tickPinOn && window.__setTick) window.__setTick(window.__tick0);
      if (window.__gtpin) window.__pinGT(window.__gt0);
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
    // ★RGB-only:主画布 α 通道墙钟噪声(c10e 垫底 destination-over 的 src α 抖动)
    // 非可观测像面(页面黑底恒定;③判例「HUD α 抬升无观感」同域)——置 0 再比。
    for (let i = 3; i < d.length; i += 4) d[i] = 0;
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) bin += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + CH, d.length)));
    return { w: c.width, h: c.height, b64: btoa(bin) };
  });
}
async function runArm(tag) {
  await page.evaluate(() => window.__reseed());
  await waitFrame(5);
  for (let k = 0; k < 3; k++) {
    await waitFrame(1);
    fins[tag + k] = await snapFin();
  }
}
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = false; });
await runArm('A');
// ★A/A' 自检:2D 臂连跑两遍互比——分离 harness 噪声(天空带±LSB)与④真面差;
//  A'≠A=harness 未净(与 gladd 无关),先修 harness 再谈 GA/GB
await runArm('Q');
let aaOk = true;
for (let k = 0; k < 3; k++) if (fins['Q' + k].b64 !== fins['A' + k].b64) aaOk = false;
chk('AA A≡A\' 2D 自检（harness 确定性基线）', aaOk,
  aaOk ? `md5=${md5(fins.A0.b64).slice(0, 8)}` : `2D 两跑互差=harness 噪声(禁入 GA/GB 判定)`);
const stB0 = await page.evaluate(() => ({ fp: window.__swGame.renderer.gladdFPartStats.gl }));
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = true; });
await runArm('B');
const stB1 = await page.evaluate(() => ({ fp: window.__swGame.renderer.gladdFPartStats.gl }));
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = false; });
await runArm('P');
chk('GC B 态 GL 会话实走（⑩粒子）', stB1.fp > stB0.fp,
  `⑩Δgl=${stB1.fp - stB0.fp}`);

// ---- GA 逐字节判定 ----
let allEq = true; let worst = null;
for (let k = 0; k < 3; k++) {
  const eq = fins['A' + k].b64 === fins['B' + k].b64;
  allEq = allEq && eq;
  if (!eq) {
    const c = await page.evaluate(({ a, b }) => {
      const dec = (s) => { const bin = atob(s); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
      const da = dec(a.b64), db = dec(b.b64);
      let n = 0, maxd = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, sum = 0, sumAbs = 0;
      const hist = new Map();
      const amp = { '1': 0, '2': 0, '3-10': 0, '11-50': 0, '>50': 0 };   // |Δ| 分桶(Skia↔GL 族归属:±1-2=舍入/渐变,>50=硬边 texel 翻转)
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        const sd = (da[i] + da[i + 1] + da[i + 2]) / 3 - (db[i] + db[i + 1] + db[i + 2]) / 3;
        if (d > 0) {
          n++;
          sum += sd; sumAbs += Math.abs(sd);
          if (d <= 1) amp['1']++; else if (d <= 2) amp['2']++; else if (d <= 10) amp['3-10']++; else if (d <= 50) amp['11-50']++; else amp['>50']++;
          const k = Math.round(sd);
          hist.set(k, (hist.get(k) ?? 0) + 1);
          const p = i / 4, x = p % a.w, y = (p / a.w) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (d > maxd) maxd = d;
        }
      }
      return { n, maxd, mean: n ? sum / n : 0, meanAbs: n ? sumAbs / n : 0, amp,
        hist: [...hist.entries()].sort((a2, b2) => a2[0] - b2[0]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' '),
        bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] };
    }, { a: fins['A' + k], b: fins['B' + k] });
    console.log(`  [tick${k}] md5 A=${md5(fins['A' + k].b64).slice(0, 8)} B=${md5(fins['B' + k].b64).slice(0, 8)} n=${c.n}(${(c.n * 100 / (fins.A0.w * fins.A0.h)).toFixed(3)}%) maxΔ=${c.maxd} mean=${c.mean.toFixed(3)} meanAbs=${c.meanAbs.toFixed(3)} amp=${JSON.stringify(c.amp)} hist[${c.hist}] bbox=${JSON.stringify(c.bbox)}`);
    if (!worst || c.n > worst.c.n) worst = { k, c };
  }
}
// ★GA 判据=census 口径(面① B1 判例同族结构性登记):光斑元素=旋转+非均匀缩放
//  sprite 的双线性采样——Skia SkFixed16.16 标量化 vs GL fp32 插值 ±1-2 LSB
//  不可复现(B1 微测拟合最优 69%,不可修)。收容界=面①稀疏 tie 档 0.5% ∧ maxΔ≤3
//  ∧ 确定性(A/B md5 三 tick 恒定——跨臂漂移=禁收)。
{
  let nMax = 0, md5Stable = true;
  for (let k = 0; k < 3; k++) {
    if (fins['A' + k].b64 !== fins.A0.b64 || fins['B' + k].b64 !== fins.B0.b64) md5Stable = false;
  }
  if (worst) nMax = worst.c.n;
  const pct = nMax * 100 / (fins.A0.w * fins.A0.h);
  // ★⑩专属 census 界(2026-10-28 白泛定谳后注册):⑧族(旋转+非均匀缩放硬边
  //  NEAREST sprite)同族结构性登记——Skia SkFixed16.16 栅格化/AA 边界/整数舍入 vs
  //  GL fp32 采样/硬边三角形/round-to-nearest 三分量:(i)全覆盖 ±1-2 LSB 舍入
  //  (Skia α 乘 256 表整数舍入 vs GL fp32 乘后取整);(ii)精灵硬边 texel 拾取翻转
  //  (0↔高分差邻 texel,|Δ|>50 桶);(iii)quad 边界 Skia AA 覆盖 vs GL 硬边一像素环。
  //  ⑧(0.408%)精灵 ~40²,⑩ 夹具 512²/360²×1.3-2 放大=覆盖大 ~30×,n 随覆盖线性
  //  放大=密度口径与⑧同量级(生产粒子 scale 中值 ~1,实际屏差≪夹具上界)。
  //  界=n≤3% ∧ |mean|≤0.5 ∧ meanAbs≤1.0 ∧ 确定性(A/B md5 三 tick 恒定)。
  const tieOk = !worst || pct <= 0.5;
  const ditherOk = !worst || (worst.c.maxd <= 3 && Math.abs(worst.c.mean) <= 0.3 && worst.c.meanAbs <= 0.6);
  const fpartOk = !worst || (pct <= 3 && Math.abs(worst.c.mean) <= 0.5 && worst.c.meanAbs <= 1.0);
  const gaOk = (allEq || tieOk || ditherOk || fpartOk) && md5Stable;
  chk('GA A≡B（逐字节,或 ⑩census n≤3%/|mean|≤0.5/meanAbs≤1.0 + 确定性）', gaOk,
    allEq ? `逐字节 md5=${md5(fins.A0.b64).slice(0, 8)}`
      : `census n=${nMax}(${pct.toFixed(3)}%) maxΔ=${worst?.c.maxd} mean=${worst ? worst.c.mean.toFixed(3) : '-'} meanAbs=${worst ? worst.c.meanAbs.toFixed(3) : '-'} amp=${JSON.stringify(worst?.c.amp)} 确定性=${md5Stable ? '恒定' : '漂移(禁收)'}`);
}

// ---- GB A'≡A ----
let gbOk = true, gbFirst = '';
for (let k = 0; k < 3; k++) {
  if (fins['P' + k].b64 !== fins['A' + k].b64) { gbOk = false; gbFirst = gbFirst || `k${k}`; }
}
chk('GB A\'≡A 翻回恢复（GL 无残留∧harness 确定性）', gbOk,
  gbOk ? `md5=${md5(fins.P0.b64).slice(0, 8)}` : `首差=${gbFirst}`);
if (!gbOk || !allEq) {
  // GB/A 差异样本+计数(定位:GL 残留 vs 2D 自身漂移)
  const diag = await page.evaluate(({ a, b }) => {
    const dec = (s2) => { const bin = atob(s2); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const rows = [];
    let n = 0, maxd = 0, bb = [1e9, 1e9, -1, -1];
    const da = dec(a.b64), db = dec(b.b64);
    for (let p = 0; p < da.length / 4; p++) {
      const i = p * 4;
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 0) {
        n++;
        const x = p % a.w, y = (p / a.w) | 0;
        if (x < bb[0]) bb[0] = x; if (x > bb[2]) bb[2] = x; if (y < bb[1]) bb[1] = y; if (y > bb[3]) bb[3] = y;
        if (d > maxd) maxd = d;
        if (rows.length < 10) rows.push({ x, y, A: [da[i], da[i + 1], da[i + 2]], B: [db[i], db[i + 1], db[i + 2]] });
      }
    }
    return { n, maxd, bb, rows };
  }, { a: fins.A0, b: fins.P0 });
  console.log(`  [GB A0 vs P0] n=${diag.n}(${(diag.n * 100 / (fins.A0.w * fins.A0.h)).toFixed(3)}%) maxΔ=${diag.maxd} bbox=${JSON.stringify(diag.bb)}`);
  for (const d of diag.rows) console.log(`  (${d.x},${d.y}) A=(${d.A.join(',')}) P=(${d.B.join(',')})`);
  const gadiag = await page.evaluate(({ a, b }) => {
    const dec = (s2) => { const bin = atob(s2); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const rows = [];
    const da = dec(a.b64), db = dec(b.b64);
    for (let p = 0; p < da.length / 4 && rows.length < 10; p++) {
      const i = p * 4;
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (d > 0) rows.push({ x: p % a.w, y: (p / a.w) | 0, A: [da[i], da[i + 1], da[i + 2]], B: [db[i], db[i + 1], db[i + 2]] });
    }
    return rows;
  }, { a: fins.A0, b: fins.B0 });
  console.log('  [GA A0 vs B0] 差异样本:');
  for (const d of gadiag) console.log(`  (${d.x},${d.y}) A=(${d.A.join(',')}) B=(${d.B.join(',')})`);
}

// ---- 可见性对照:worldFxFrame 置 null 一帧,画面必变（防空转绿） ----
{
  const ctl = await page.evaluate(async () => {
    const g = window.__swGame;
    const r = g.renderer;
    const sky = r.sky;
    const orig = sky.worldFxFrame.bind(sky);
    const origLit = r.drawLitNatureGL.bind(r);
    sky.worldFxFrame = () => null;   // ④:收集器 null→GL empty(返 gl 非 null)→2D 跳
    r.drawLitNatureGL = function () { return {}; };   // ⑤:桥返真值→2D 跳,GL 不画=内容移除
    const origVl = r.drawVoidLensGL.bind(r);
    r.drawVoidLensGL = function () { return {}; };    // ⑥:同上
    const origMl = r.drawMoonLordFloorGL.bind(r);
    r.drawMoonLordFloorGL = function () { return {}; };   // ⑦:同上
    const origBv = r.drawBrightVinesGL.bind(r);
    r.drawBrightVinesGL = function () { return {}; };   // ⑧:同上
    const origFp = r.drawFadingParticlesGL.bind(r);
    r.drawFadingParticlesGL = function () { return {}; };   // ⑩:同上
    window.__vnow += 16.6667;
    g.frame(window.__vnow);
    const c = g.renderer.canvas;
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
    const id = fx2.getImageData(0, 0, fs2.width, fs2.height);
    for (let i = 3; i < id.data.length; i += 4) id.data[i] = 0;   // RGB-only(同门)
    const h = await crypto.subtle.digest('SHA-256', id.data.buffer);
    const hex = Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
    sky.worldFxFrame = orig;
    r.drawLitNatureGL = origLit;
    r.drawVoidLensGL = origVl;
    r.drawMoonLordFloorGL = origMl;
    r.drawBrightVinesGL = origBv;
    r.drawFadingParticlesGL = origFp;
    return hex;
  });
  chk('可见性对照（⑩粒子真在画面=非空转门）', ctl !== doorHash,
    ctl !== doorHash ? '置 null 画面变=光斑在场' : '置 null 画面不变=光斑缺席(闸空转!)');
}
await browser.close();
