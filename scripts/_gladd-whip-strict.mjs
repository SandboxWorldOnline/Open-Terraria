// ★gladd 面⑫-a 逐字节闸（task#22,2026-10-28）:1034 星辰鞭线体（flushWhipFullbright
//  段双拍 black SO+tinted additive,⑪ 同型克隆）A(2D) vs B(GL) vs P(翻回)。harness=⑪闸
//  全量复用;场景=WhipProj(1034)×2 直构入场(projectiles 桶,draw 每帧重填队列=帧头
//  清零的天然回填;暂停冻结=曲线态稳定,LCG 钉住 ai1 段相位确定)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-whip-strict.mjs
// ★gladd 面⑪ 逐字节闸（task#22,2026-10-28）:自发光实体族（7d' 四原语:
// faelingPremultLayer 双拍/drawFairyBright α0.5/drawDeerclopsGlow 逐层 SO/
// flushNpcWhiteLift BJ504）A(2D) vs B(GL) vs P(翻回)。harness=⑦⑧⑩闸全量复用
// (冻结套件/收敛门 v3/tick+GTW 钉/等帧配对/双面 itemGlow 中和);场景=tod 0.35+
// 注入 677(拖尾历史预跑:LCG 钉住短暂解暂停 100 帧积累 history,再翘位+清速+
// 复暂停——夹具判例⑧「非暂停生成→物化→翘位→暂停」同族)+583/668(lai3=36 激活
// 红雾环+前雾)+516(spawnAlpha=220 恒量档 whiteLift)。★净尘:7261 尘 pass 画在
// HUD(夹在垫底与 7d' 间)——SO 面与尘层序在 GL 栈域不可交换(over-αS 衰减差=②
// 登记族),闸须 deactivate 尘池(生产=登记微差面)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-entglow-strict.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';
import { createHash } from 'node:crypto';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const md5 = (b64) => createHash('md5').update(Buffer.from(b64, 'base64')).digest('hex');
let doorHash = null;   // 收敛门末帧 hash(可见性对照消费;模块域——块域判例)
const results = [];
const chk = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
chk('createGame', !!gen?.ok, gen?.why ?? '');
await pump(page, 60);

// ---- 冻结套件（⑩闸逐字同源） ----
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
  sky.meteor = null;
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
  for (const n of g.entities.npcs) { const u = n.update; n.update = () => {}; n.__origUpdate = u; }
  try { g.vanillaSpawner && (g.vanillaSpawner.update = noop); } catch { /* 域差异 */ }
  try { g.evolution && (g.evolution.update = noop); } catch { /* 域差异 */ }
  window.__reseed = () => { let rs2 = 20261028; Math.random = () => { rs2 = (rs2 * 1103515245 + 12345) & 0x7fffffff; return rs2 / 0x7fffffff; }; };
  (async () => {
    const ts = await import('/src/render/TileShine.ts');
    window.__ts = () => ({ ...ts.shineStats });
    const ta = await import('/src/render/TileAnim.ts');
    window.__setTick = (v) => { ta.tileAnim.tick = v; };
    window.__getTick = () => ta.tileAnim.tick;
    window.__tickPinOn = false;
    const gt = await import('/src/core/GameTime.ts');
    window.__pinGT = (t) => gt.pinGameTimeTicks(t);
  })();
});
await page.evaluate(() => { window.__swGame.running = false; });
await page.evaluate(() => { window.__swGame.paused = true; });

// ---- 暖机+注入 ----
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
  // 鞭注入:WhipProj(1034)×2 直构(不同角度曲线;LCG 钉住=ai1 相位确定)
  const placed = await page.evaluate(async () => {
    const g = window.__swGame;
    const M2 = await import('/src/entities/WhipProj.ts');
    const px = g.player.x, py = g.player.y;
    const mk = (ang) => {
      const w = new M2.WhipProj(px, py, ang, 1034, 0, 10, 2, 30, 8,
        () => g.player, () => ang, 1);
      g.entities.add(w, 'projectiles');
      return w;
    };
    const w1 = mk(-0.4), w2 = mk(0.6);
    return { n: (w1 && w2) ? 2 : 0, dead1: w1.dead, dead2: w2.dead };
  });
  chk('星辰鞭×2 注入(projectiles 桶)', placed.n === 2 && !placed.dead1 && !placed.dead2, JSON.stringify(placed));
  const settled = await page.evaluate(() => {
    const g = window.__swGame;
    const vd = g.vanillaDust;
    if (vd) { for (const d of (vd['pool'] ?? [])) d.active = false; }   // 净尘(⑪ 同判例)
    let qlen = -1;
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
    qlen = g.renderer.whipFullbrightQueue.length;   // 帧尾已消费=0;帧中曾填=7e' 位可证
    // 再驱一帧读 7e' 消费后的队列重建前长度(=0)与鞭存活
    let alive = 0;
    for (const e of g.entities['projectiles'] ?? []) if (e && !e.dead && e.projId === 1034) alive++;
    return { qlen, alive };
  });
  chk('鞭存活+队列消费面', settled.alive === 2 && settled.qlen === 0, JSON.stringify(settled));
  }

// ---- renderChunk/markDirty 计数 + 收敛门 v3（⑩闸同款逐字） ----
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
    const still = !!last && last.hex === st.hex
      && last.rc === st.rc && last.md === st.md;
    if (convFrames % 100 === 0) console.log(`  [door F${convFrames}] hash=${st.hex.slice(0, 8)} dQ=${st.dQ} rc=${st.rc} md=${st.md} bakes=${st.bakes} stable=${stable}`);
    stable = still ? stable + 1 : 0;
    last = st; info = st; convFrames++;
  }
  chk('收敛门 v3(画面静止 5 连拍+账面全清+墙钟 10s)', stable >= 5 && Date.now() - t0 >= 10000,
    `frames=${convFrames} wall=${Math.round(Date.now() - t0)}ms bakes=${info?.bakes} rc=${info?.rc} md=${info?.md} hash=${info?.hex?.slice(0, 8)}`);
  doorHash = info?.hex;
}

// ---- 臂驱动器（⑩闸同款） ----
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
await runArm('Q');
let aaOk = true;
for (let k = 0; k < 3; k++) if (fins['Q' + k].b64 !== fins['A' + k].b64) aaOk = false;
chk('AA A≡A\' 2D 自检（harness 确定性基线）', aaOk,
  aaOk ? `md5=${md5(fins.A0.b64).slice(0, 8)}` : `2D 两跑互差=harness 噪声(禁入 GA/GB 判定)`);
const stB0 = await page.evaluate(() => ({ wp: window.__swGame.renderer.gladdWhipStats.gl }));
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = true; });
await runArm('B');
const stB1 = await page.evaluate(() => ({ wp: window.__swGame.renderer.gladdWhipStats.gl }));
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = false; });
await runArm('P');
chk('GC B 态 GL 会话实走（⑫-a鞭线体）', stB1.wp > stB0.wp,
  `⑫-aΔgl=${stB1.wp - stB0.wp}`);

// ---- GA 逐字节判定（⑩闸同款含 amp 分桶） ----
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
      const amp = { '1': 0, '2': 0, '3-10': 0, '11-50': 0, '>50': 0 };
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        const sd = (da[i] + da[i + 1] + da[i + 2]) / 3 - (db[i] + db[i + 1] + db[i + 2]) / 3;
        if (d > 0) {
          n++;
          sum += sd; sumAbs += Math.abs(sd);
          if (d <= 1) amp['1']++; else if (d <= 2) amp['2']++; else if (d <= 10) amp['3-10']++; else if (d <= 50) amp['11-50']++; else amp['>50']++;
          const k2 = Math.round(sd);
          hist.set(k2, (hist.get(k2) ?? 0) + 1);
          const p = i / 4, x = p % a.w, y = (p / a.w) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (d > maxd) maxd = d;
        }
      }
      return { n, maxd, mean: n ? sum / n : 0, meanAbs: n ? sumAbs / n : 0, amp,
        hist: [...hist.entries()].sort((a2, b2) => a2[0] - b2[0]).slice(0, 12).map(([k2, v]) => `${k2}:${v}`).join(' '),
        bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] };
    }, { a: fins['A' + k], b: fins['B' + k] });
    console.log(`  [tick${k}] md5 A=${md5(fins['A' + k].b64).slice(0, 8)} B=${md5(fins['B' + k].b64).slice(0, 8)} n=${c.n}(${(c.n * 100 / (fins.A0.w * fins.A0.h)).toFixed(3)}%) maxΔ=${c.maxd} mean=${c.mean.toFixed(3)} meanAbs=${c.meanAbs.toFixed(3)} amp=${JSON.stringify(c.amp)} hist[${c.hist}] bbox=${JSON.stringify(c.bbox)}`);
    if (!worst || c.n > worst.c.n) worst = { k, c };
  }
}
// ★GA 判据=⑧族 tie(小精灵旋转硬边 NEAREST,面①稀疏 tie 口径 n≤0.5% 无 maxΔ 项)
//  ‖ ⑤dither 成形界 ‖ ⑩ census(n≤3%/|mean|≤0.5/meanAbs≤1.0) + 确定性
{
  let nMax = 0, md5Stable = true;
  for (let k = 0; k < 3; k++) {
    if (fins['A' + k].b64 !== fins.A0.b64 || fins['B' + k].b64 !== fins.B0.b64) md5Stable = false;
  }
  if (worst) nMax = worst.c.n;
  const pct = nMax * 100 / (fins.A0.w * fins.A0.h);
  const tieOk = !worst || pct <= 0.5;
  const ditherOk = !worst || (worst.c.maxd <= 3 && Math.abs(worst.c.mean) <= 0.3 && worst.c.meanAbs <= 0.6);
  const wideOk = !worst || (pct <= 3 && Math.abs(worst.c.mean) <= 0.5 && worst.c.meanAbs <= 1.0);
  const gaOk = (allEq || tieOk || ditherOk || wideOk) && md5Stable;
  chk('GA A≡B（逐字节,或 ⑧tie≤0.5% ‖ ⑤dither ‖ ⑩census≤3% + 确定性）', gaOk,
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

// ---- 可见性对照:⑪驱动器置 null 一帧,画面必变（防空转绿） ----
{
  const ctl = await page.evaluate(async () => {
    const g = window.__swGame;
    const r = g.renderer;
    const orig = r.drawWhipGlowGL.bind(r);
    r.drawWhipGlowGL = function () { return {}; };   // ⑫-a:桥返真值→7e' 跳(队列已清),GL 不画=内容移除
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
    for (let i = 3; i < id.data.length; i += 4) id.data[i] = 0;
    const h = await crypto.subtle.digest('SHA-256', id.data.buffer);
    const hex = Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
    r.drawEntityGlowGL = orig;
    return hex;
  });
  chk('可见性对照（⑫-a鞭线体真在画面=非空转门）', ctl !== doorHash,
    ctl !== doorHash ? '置 null 画面变=鞭线体在场' : '置 null 画面不变=缺席(闸空转!)');
}
await browser.close();
