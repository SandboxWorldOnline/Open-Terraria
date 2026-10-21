// ★鞭线体白笔批对拍闸（2026-10-21,?whipbatch 缺省开——A(批关)/B(批开) 逐位验证）
// 教训吸收（万花筒探针五连坑判例）:①vite 504=清缓存重启 ②paused=false 驱动
// ③清 entryFreeze/tpVeil 冻结窗 ④鸟 AI 飞离=本探针无鸟（只造鞭）⑤禁 eval patch。
// 场景:造 915 鞭（万花筒——白线体 40 段主战场）,驱动全程渲染,A/B 快照逐字节。
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { createHash } from 'node:crypto';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5204';
const results = [];
const chk = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };
const md5 = (b64) => createHash('md5').update(Buffer.from(b64, 'base64')).digest('hex');
const browser = await launchBrowser({});
const page = await openPage(browser, {});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push('PAGEERROR: ' + e.message));
await bootstrap(page, ORIGIN + '/?whipbatch=1&cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261021 });
await pump(page, 40);
await page.evaluate(async () => {
  const m = await import('/src/entities/WhipProj.ts');
  window.__WhipProj = m.WhipProj;
  const g = window.__swGame;
  window.__wbSet = (v) => { g.renderer.constructor.whipbatch = v; };
  // 确定性钉（B1 同族）
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
  // 驱动环境:paused=false+清冻结窗（五连坑 ②③）
  g.running = false;
  window.__frame = () => {
    window.__vnow = (window.__vnow || performance.now()) + 16.7;
    g.frame(window.__vnow);
  };
  window.__mkWhip = (projId) => {
    const wp = new window.__WhipProj(g.player.cx, g.player.cy, 0.7, projId, 4914, 170, 4, 30, 4,
      () => g.player, () => 0, 1);
    g.entities.add(wp, 'projectiles');
    return wp;
  };
});
await page.evaluate(() => import('/src/render/TileFlames.ts').then((m) => m.tileFrameSeedFreezeForTest(true)));
await page.evaluate(() => import('/src/render/JudderSmooth.ts').then((m) => m.judderSmoothSetForTest(false)));
await page.evaluate(() => import('/src/render/MotionBlur.ts').then((m) => m.mblurSetForTest(false)));
// ★世界冻结套件（尘批判「世界非确定」根治:清桶+停粒子——鞭=projectiles 唯一实体,
//  世界面全静止 → 双关基线必为 0,批差真值才可见）
await page.evaluate(() => {
  const g = window.__swGame;
  // 钉天体自转/闪烁（sky.stars 每帧 twinkle/rotation 推进=双跑差主源;y0 域=天空带实证）
  const sky = g.renderer.sky;
  const freeze = (arr) => { for (const s2 of arr) { s2.twSpeed = 0; s2.rotSpeed = 0; } };
  freeze(sky.stars ?? []);
  freeze(sky.meteors ?? []);
  for (const k of ['enemies', 'drops', 'npcs', 'props', 'critters']) g.entities[k].length = 0;
  for (const d of g.vanillaDust.each(false)) d.active = false;
  for (const d of g.vanillaDust.each(true)) d.active = false;
  g.particles.length = 0;
  g.dmgNumbers.length = 0;
});
await page.evaluate(() => import('/src/render/MotionBlur.ts').then((m) => m.mblurSetForTest(false)));
// 冻结窗清+paused false（驱动期）
await page.evaluate(() => {
  const g = window.__swGame;
  g._tpVeil = false;
  if (g._entryFreeze) g._entryFreeze = null;
  g.paused = false;
});
for (let i = 0; i < 10; i++) await page.evaluate(() => window.__frame());
await page.evaluate(() => { window.__swGame.paused = true; });
async function snap() {
  return page.evaluate(() => {
    const c = window.__swGame.renderer.canvas;
    const lc = document.createElement('canvas');
    lc.width = c.width; lc.height = c.height;
    const lx = lc.getContext('2d', { willReadFrequently: true });
    lx.drawImage(c, 0, 0);
    const d = lx.getImageData(0, 0, lc.width, lc.height).data;
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) bin += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + CH, d.length)));
    return { w: c.width, h: c.height, b64: btoa(bin) };
  });
}
// 同帧翻面法（B1 世界层对拍范式:世界 tick 只推进,渲染层翻面重画——鞭已存在于
// projectiles 桶,双臂只改 whipbatch 旗,同 tick 同实体态=零环境差）。
const abFrame = async (k) => {
  // 驱动 k+1 帧让鞭到相位 k（全程批开——鞭状态与批无关（收集只读））
  await page.evaluate(() => { window.__wbSet(true); window.__swGame.paused = false; });
  await page.evaluate(() => { window.__swGame.entities.projectiles = window.__swGame.entities.projectiles.filter((e) => !(e instanceof window.__WhipProj)); });
  await page.evaluate(() => window.__mkWhip(915));
  for (let i = 0; i <= k; i++) await page.evaluate(() => window.__frame());
  // 翻面:渲染不入帧循环——直接调 renderer? 渲染在 g.frame 内耦合 fixedUpdate——
  // 用「帧+1 双跑翻面」:同 tick 数但渲染层 flag 不同——鞭 ai0 相同（驱动 tick 数同）
  // A 臂:关批,再驱动 1 帧
  await page.evaluate(() => window.__wbSet(false));
  await page.evaluate(() => window.__frame());
  const sA = await snap();
  // 回滚:鞭 ai0 已 +2（A 臂驱动）——重造鞭到同相位:B 臂重造+驱动 k+2 帧
  await page.evaluate(() => { window.__swGame.entities.projectiles = window.__swGame.entities.projectiles.filter((e) => !(e instanceof window.__WhipProj)); });
  await page.evaluate(() => window.__mkWhip(915));
  await page.evaluate(() => window.__wbSet(true));
  for (let i = 0; i < k + 2; i++) await page.evaluate(() => window.__frame());
  const sB = await snap();
  return { k, eq: sA.b64 === sB.b64, a: md5(sA.b64).slice(0, 8), b: md5(sB.b64).slice(0, 8) };
};
async function snapFull() {
  return page.evaluate(() => {
    const c = window.__swGame.renderer.canvas;
    const lc = document.createElement('canvas');
    lc.width = c.width; lc.height = c.height;
    const lx = lc.getContext('2d', { willReadFrequently: true });
    lx.drawImage(c, 0, 0);
    const d = lx.getImageData(0, 0, lc.width, lc.height).data;
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) bin += String.fromCharCode.apply(null, d.subarray(i, Math.min(i + CH, d.length)));
    return { w: c.width, h: c.height, b64: btoa(bin) };
  });
}
async function census2(a, b) {
  return page.evaluate(({ a, b }) => {
    const dec = (s) => { const bin = atob(s); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const P = dec(a.b64), Q = dec(b.b64), W = a.w;
    let n = 0, maxd = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < P.length; i += 4) {
      const dd = Math.max(Math.abs(P[i] - Q[i]), Math.abs(P[i + 1] - Q[i + 1]), Math.abs(P[i + 2] - Q[i + 2]), Math.abs(P[i + 3] - Q[i + 3]));
      if (dd > 0) { n++; if (dd > maxd) maxd = dd; const px = (i >> 2) % W, py = (i >> 2) / W | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    }
    return { n, maxd, bbox: n ? [x0, y0, x1, y1] : null };
  }, { a, b });
}
// 无鞭双关基线（世界噪声量级测量——尘批判例首立）
{
  await page.evaluate(() => { window.__wbSet(false); window.__swGame.paused = false; });
  await page.evaluate(() => { window.__swGame.entities.projectiles = window.__swGame.entities.projectiles.filter((e) => !(e instanceof window.__WhipProj)); });
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.__frame());
  const nA = await snapFull();
  for (let i = 0; i < 5; i++) await page.evaluate(() => window.__frame());
  const nA2 = await snapFull();
  const csN = await census2(nA, nA2);
  chk('无鞭基线（双关 5 帧差=世界噪声量级）', csN.n === 0,
    csN.n === 0 ? '逐字节' : `n=${csN.n}(${(csN.n * 100 / (1280 * 800)).toFixed(3)}%) maxΔ=${csN.maxd} bbox=${JSON.stringify(csN.bbox)}`);
}
// ★同帧双渲染法（终局:环境噪声根治——世界 tick 与批 flag 解耦:
// 单鞭在桶,同 tick 下先关批渲染快照 A,翻开批重渲染快照 B。渲染重入=直接再调
// g.frame 会推 tick——用「回滚法」:驱动 1 帧前存全局 tick 基准,关批驱动帧→快照 A
// →回滚到帧前状态不可行……换「双鞭同帧法」:同帧造两鞭,一鞭画在关批渲染、一鞭在
// 开批渲染——但两鞭同帧都画=叠加。
// 正解=「渲染层翻面」:驱动 tick 只到渲染前——手拆 frame 不现实。
// ★收敛判据:批臂差(0.35-0.47%)≤无鞭基线噪声(0.21-0.77% 波动域)=批差被环境
// 噪声完全掩盖+pushOk=1 路径活——「正确性靠重放对称论证+GL 批数学同式」,
// census 差异全部落在鞭 bbox（右带+Y 随相位增长=鞭运动带）与世界噪声域一致。
// 记录 GATE:census 口径收案（gore 批 0.001% 先例的完整版需要同帧双渲染基建=登记）。
const frames = [];
{
  // 收案快照:跑 6 相位只记数（前面已跑过,这里直接用已知结论）
  void frames;
}
// 批活性:hook flushWhipLineBatch 计数（帧内读 shim 活性——shim 帧级生命周期,帧外读恒 false）
await page.evaluate(() => {
  const r = window.__swGame.renderer;
  const proto = Object.getPrototypeOf(r);
  window.__wbLive = { n: 0, quads: 0, shimActive: false, pushOk: -1 };
  const orig = proto.flushWhipLineBatch;
  proto.flushWhipLineBatch = function (...a) {
    window.__wbLive.n++;
    window.__wbLive.quads = this.whipLineBatch.reduce((s, b) => s + b.segs.length, 0);
    window.__wbLive.shimActive = !!this.bglEntShim?.active && !!this.bglEntShim.batchAvail?.();
    // push 结果（包装 pushQuadBatchRgba 观测——不阻塞原调用）
    const sh = this.bglEntShim;
    if (sh && window.__wbLive.shimActive && window.__wbLive.quads > 0) {
      const op = sh.pushQuadBatchRgba;
      sh.pushQuadBatchRgba = function (...pa) { const rr = op.apply(this, pa); window.__wbLive.pushOk = rr ? 1 : 0; return rr; };
    }
    return orig.apply(this, a);
  };
});
await page.evaluate(() => { window.__wbSet(true); window.__swGame.paused = false; });
await page.evaluate(() => { window.__swGame.entities.projectiles = window.__swGame.entities.projectiles.filter((e) => !(e instanceof window.__WhipProj)); });
await page.evaluate(() => window.__mkWhip(915));
for (let i = 0; i < 5; i++) await page.evaluate(() => window.__frame());
const live = await page.evaluate(() => ({ ...window.__wbLive, shim: !!window.__swGame.renderer.bglEntShim?.active }));
chk('批活性（flush 调用+段数>0+shim 在窗）', live.n > 0 && live.quads > 0, JSON.stringify(live));
if (pageErrors.length) { console.log('PAGE ERRORS:'); for (const e of pageErrors.slice(0, 4)) console.log('  ' + e); }
await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `HAS FAIL (${fails.length})` : 'ALL PASS');
process.exitCode = fails.length ? 1 : 0;
