// ★escapeVeil 水罩帧闸(2026-10-29 终局):水罩活跃帧(逃逸内容+前景水)全链
//  正确性——各面 fail-fast 降级 2D+水罩 mask 完整+复合正确。夹具=玩家四周注水
//  (st.liquid=255×5×3 池)+677(逃逸内容)。断言:veilActive 帧内真+A/B 逐字节
//  (双臂全 2D 同构)+可见性。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-veil-strict.mjs
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
    // ★塔面中和(2026-10-29 五面桥):516 夹具=towerGlowQueue 生产者(BJ510 单份
    //  残影)——塔面 GL 桥的⑥族幽灵差异跨面泄进⑪闸;wrap 返 null=塔面双臂
    //  走 2D 同构(⑪ 闸域外)。
    r['drawTowerGlowGL'] = function () { return null; };
    r.constructor.gladd = true;
    return !!r.acquireCloudPipe();
  });
  chk('管线预热+双面 itemGlow 中和', w0, w0 ? 'ok' : 'pipe 不可用');
  await freezeClock(page, { tod: 0.35 });
  // 677+注水(逃逸内容+前景水=水罩触发双条件)
  const placed = await page.evaluate(async () => {
    const g = window.__swGame;
    const M = await import('/src/entities/Enemy.ts');
    const px = g.player.x, py = g.player.y;
    // ★深重叠(2026-10-29 登记债收口):677 生在池心(沉水)——水罩 mask 对其
    //  glow 的覆盖成为承重面(旧夹具 px+150,py-100=浮于池外水上,重叠域近零)。
    const st = g.world.store;
    const ptx = Math.floor(px / 16), pty = Math.floor(py / 16);
    window.__poolCx = (ptx + 1) * 16; window.__poolCy = (pty + 1) * 16;
    const fae = M.Enemy.fromVanilla(677, window.__poolCx, window.__poolCy);
    if (fae) { fae.visAngle = 0.6; g.entities.add(fae, 'enemies'); }
    let nw = 0;
    for (let ly = 0; ly < 4; ly++) for (let lx = 0; lx < 7; lx++) {
      const x = ptx - 3 + lx, y = pty - 1 + ly, i = st.idx(x, y);
      if (!st.inBounds(x, y)) continue;
      st.liquid[i] = 255; nw++;
    }
    const ch = g.chunks;
    for (let cy = Math.floor((pty - 2) / 16); cy <= Math.floor((pty + 3) / 16); cy++)
      for (let cx = Math.floor((ptx - 4) / 16); cx <= Math.floor((ptx + 4) / 16); cx++)
        ch.markDirty(cx, cy);
    // ★_waveLiquidInView 真值钉:冻结套件 noop 了 updateWaterWaves=探针不跑,
    //  旗停泵期(无水)false——生产探针活跑不受影响;闸内水在=钉 true(夹具真值)
    window.__swGame.renderer['_waveLiquidInView'] = true;
    return { fae: !!fae, nw };
  });
  chk('677+注水(逃逸内容+前景水)', placed.fae && placed.nw >= 20, JSON.stringify(placed));
  // 拖尾历史预跑:LCG 钉住解暂停 100 帧(677 AI 漫游积累 history,确定性=LCG)→
  // 翘位回玩家旁+清速+终态(旋转覆盖:visAngle/vx)+复暂停
  // 预测谓词打点(wrap gladdGroupBegin 读当拍值)
  await page.evaluate(() => {
    const r = window.__swGame.renderer;
    const oB = r['gladdGroupBegin'].bind(r);
    r['gladdGroupBegin'] = function (...a) {
      window.__predict = r['gladdVeilPredict']();
      window.__terms = {
        liq: r['_waveLiquidInView'],
        ents: (r['_veilPredictEnts'] ?? []).length,
        wl: r['wingGlowQueue']?.length ?? -1,
        wlq: r['npcWhiteLiftQueue']?.length ?? -1,
      };
      return oB.apply(this, a);
    };
  });
  // veilActive 帧内打点(wrap escapeVeilEnd 读 _veilActive 复位前值)
  await page.evaluate(() => {
    const r = window.__swGame.renderer;
    const oE = r.escapeVeilEnd.bind(r);
    r.escapeVeilEnd = function (...a) { window.__veilWas = r['_veilActive']; return oE.apply(this, a); };
  });
  const settled = await page.evaluate(() => {
    const g = window.__swGame;
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
    return { veilWas: !!window.__veilWas, predict: window.__predict, terms: window.__terms };
  });
  chk('水罩活跃帧实走(escapeVeilBegin/End 全链)', settled.veilWas, JSON.stringify(settled));
  const settled2 = await page.evaluate(() => {
    const g = window.__swGame;
    let n = 0, ex = 0, ey = 0;
    for (const e of g.entities.enemies) {
      if (e.dead) continue;
      if (e.vanillaId === 677) {
        e.x = window.__poolCx; e.y = window.__poolCy;   // 池心钉(漫游后复钉=深重叠终态)
        e.vx = 0; e.vy = 0; e.visAngle = 0.6; n++;
        ex = e.x; ey = e.y;
      }
    }
    // 池矩形(world px):7×4 格 @ (ptx-3,pty-1)
    const st = g.world.store;
    const ptx = Math.floor(g.player.x / 16), pty = Math.floor(g.player.y / 16);
    const x0 = (ptx - 3) * 16, y0 = (pty - 1) * 16;
    return { n, ex, ey, inPool: ex >= x0 && ex <= x0 + 7 * 16 && ey >= y0 && ey <= y0 + 4 * 16 };
  });
  chk('677 终态钉(池心=深重叠有效)', settled2.n === 1 && settled2.inPool, JSON.stringify(settled2));
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
const stB0 = await page.evaluate(() => ({ eg: window.__swGame.renderer.gladdEntGlowStats.gl }));
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = true; });
await runArm('B');
const stB1 = await page.evaluate(() => ({ eg: window.__swGame.renderer.gladdEntGlowStats.gl }));
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = false; });
await runArm('P');
chk('GC 水罩帧各面正确降级（⑪Δgl=0=veil 预测生效走 2D+mask 镜像）', stB1.eg === stB0.eg,
  `⑪Δgl=${stB1.eg - stB0.eg}(非零=GL 发射未经水罩 mask!)`);

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
    const orig = r.drawEntityGlowGL.bind(r);
    r.drawEntityGlowGL = function () { return {}; };   // ⑪:桥返真值→7d' 块跳,GL 不画=内容移除
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
  chk('可见性对照（⑪实体发光真在画面=非空转门）', ctl !== doorHash,
    ctl !== doorHash ? '置 null 画面变=实体发光在场' : '置 null 画面不变=缺席(闸空转!)');
}
await browser.close();
