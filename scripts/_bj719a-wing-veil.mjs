// ★BJ719-A 真机探针:星尘之翼入水「蓝色矩形影」定谳三面。
// 用户实报(附截图):星尘之翼入水后翅膀贴图坐在一块不透明蓝色矩形上,水面上无此现象。
// 假说(源码锚):drawWingOverlay addScratch 摊平 alpha=255(Renderer.ts:20453-20472)
//   ——glowAdd(32)/selfAdd(29)/nebula(31) 三站共用。主画布 'lighter' 加 (0,0,0) 色无
//   害,但 BJ679 水罩 mask 镜像重放同一 scratch → mask 整片 86×62×1.06 矩形 α=
//   255×f → escapeVeilEnd 把「前景水×mask」over 主画布 = 翼 AABB 双层水=蓝矩形。
// 判别面:
//   ① PhaseA 微测(决定性):真 drawWingOverlay mirrorPass 重放到透明 tgt,量 α 分布
//     ——摊平态 α==255 计数 ≈ 全矩形;保形态 ≈ Glow_183 形状(81.8% 透明)。
//   ② PhaseB R1/R2/R3:水下钉位【翼盒左缘带】(Glow_183 全透明列)vs【左邻对照带】
//     色差——R1 无翼基线(背景差) / R2 有翼(摊平态=双层水显著差,保形态≈基线) /
//     R3 水上(无罩=恒≈0,与实报「水面上无此现象」互证)。
//   ③ mask 快照:escapeVeilEnd 合成前 α>0 计数(摊平态=矩形量级;保形=形状量级;
//     无翼帧=无快照=无会话)。
// 运行:SW_ORIGIN=http://localhost:5265 node tools/run-diag.mjs scripts/_bj719a-wing-veil.mjs
import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump, clockSet, freezeClock, godMode } from '../tools/probe/lib/index.mjs';

const OUT = process.env.SW_PROBE_OUT ?? '/tmp/probe-out/_bj719a';
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const errors = [];
const page = await openPage(browser, { errors });
await bootstrap(page, process.env.SW_ORIGIN ?? 'http://localhost:5265', {});
await createGame(page, { size: 'small', settleMs: 1500 });
await godMode(page, true);
await clockSet(page, 0.5);          // 正午（清水色观察档）
await freezeClock(page, { tod: 0.5 });
await pump(page, 30);

// 帧计数器 + 逃逸面罩仪具（escapeVeilEnd 合成前 mask 快照;escapeVeilStroke 盒记录）
await page.evaluate(async () => {
  window.__bjFrames = 0;
  const R = await import('/src/render/Renderer.ts');
  const proto = R.Renderer.prototype;
  if (!proto.__bj719inst) {
    proto.__bj719inst = true;
    const orR = proto.render;
    proto.render = function (...a) { window.__bjFrames++; return orR.apply(this, a); };
    window.__bj719dbg = { maskSnaps: [], boxes: [], bigBoxes: [], wingQ: [] };
    const oe = proto.escapeVeilEnd;
    proto.escapeVeilEnd = function () {
      try {
        const m = this._veilMask, mc = this._veilMaskCtx;
        if (m && mc && this._veilBox) {   // 仅本帧会话确有笔(防跨帧陈旧 mask 假快照)
          const id = mc.getImageData(0, 0, m.width, m.height).data;
          let nPos = 0, n255 = 0, nSemi = 0;
          for (let i = 3; i < id.length; i += 4) {
            const a = id[i];
            if (a > 0) { nPos++; if (a === 255) n255++; else nSemi++; }
          }
          window.__bj719dbg.maskSnaps.push({ nPos, n255, nSemi, w: m.width, h: m.height });
          if (window.__bj719dbg.maskSnaps.length > 8) window.__bj719dbg.maskSnaps.shift();
        }
      } catch (e) { /* mask 未建帧忽略 */ }
      return oe.call(this);
    };
    const os = proto.escapeVeilStroke;
    proto.escapeVeilStroke = function (box, paint) {
      window.__bj719dbg.boxes.push({ ...box });
      if (window.__bj719dbg.boxes.length > 96) window.__bj719dbg.boxes.shift();
      // 翼 overlay 盒量级(≥90 宽)单列——小盒(16×16 粒子族)高频会冲刷共享槽
      if (box.w >= 90 || box.h >= 70) {
        window.__bj719dbg.bigBoxes.push({ ...box });
        if (window.__bj719dbg.bigBoxes.length > 16) window.__bj719dbg.bigBoxes.shift();
      }
      return os.call(this, box, paint);
    };
    const ofw = proto.flushWingGlow;
    proto.flushWingGlow = function (...a) {
      window.__bj719dbg.wingQ.push(this.wingGlowQueue.length);
      if (window.__bj719dbg.wingQ.length > 16) window.__bj719dbg.wingQ.shift();
      return ofw.apply(this, a);
    };
  }
});
await pump(page, 20);
const waitFrames = async (n) => {
  const f0 = await page.evaluate(() => window.__bjFrames);
  await page.waitForFunction((f0, n) => window.__bjFrames >= f0 + n, { timeout: 60000 }, f0, n);
};

// ---- 找深水团+传送玩家（BJ676 同式:三连续深水列中心+真湖底）----
const spot = await page.evaluate(() => {
  const g = window.__swGame, st = g.world.store, w = st.w, h = st.h;
  const seg = new Map();
  for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x++) {
    let y0 = -1, bestD = 0, bestY0 = -1;
    for (let y = 2; y < h - 40; y++) {
      const i = st.idx(x, y);
      if (st.liquid[i] > 0 && st.liquidType[i] === 1) { if (y0 < 0) y0 = y; }
      else if (y0 >= 0) { if (y - y0 > bestD) { bestD = y - y0; bestY0 = y0; } y0 = -1; }
    }
    if (bestD >= 10) seg.set(x, { y0: bestY0, d: bestD });
  }
  const bottomOf = (x, y0, d) => {
    for (let y = y0 + 3; y < y0 + d + 12; y++) {
      const i = st.idx(x, y);
      if (st.w[i] !== 0 && st.liquid[i] === 0) return y;
    }
    return -1;
  };
  const xs = [...seg.keys()];
  for (const x of xs.sort((a, b) => seg.get(b).d - seg.get(a).d)) {
    const c = seg.get(x);
    if (!(seg.get(x - 1)?.d >= 10 && seg.get(x + 1)?.d >= 10)) continue;
    const bottom = bottomOf(x, c.y0, c.d);
    if (bottom > c.y0 + Math.floor(c.d * 0.6)) {
      return { tx: x, tySurface: c.y0, depth: c.d, tyBottom: bottom };
    }
  }
  return null;
});
if (!spot) { console.error('NO_WATER_BODY'); await browser.close(); process.exit(2); }
console.log(`water column: x=${spot.tx} surfaceY=${spot.tySurface} depth=${spot.depth} bottomY=${spot.tyBottom}`);

// ---- 装备星尘之翼(3471) ----
const equipWings = (on) => page.evaluate((on) => {
  const g = window.__swGame, p = g.player;
  if (on) p.inv.armor[3] = { id: g.itemId('vi_3471_stardust_wings'), stack: 1 };
  else p.inv.armor[3] = null;
  return { wing: p.equipStats.wing ? { logic: p.equipStats.wing.logic, slot: p.equipStats.wing.slot } : null };
}, on);

// 钉位:湖底(全身浸水)/水面上 8 格(空中,逐帧回落≈亚像素级);恒 facing=1
// (镜像空间左缘带=贴图透明边;facing=−1 会翻转使翼形贴左缘)
const pin = (dy) => page.evaluate(({ s, dy }) => {
  const g = window.__swGame, p = g.player;
  p.x = (s.tx + 0.5) * 16 - p.w / 2;
  p.y = dy === null ? s.tyBottom * 16 - p.h - 1 : (s.tySurface + dy) * 16;
  p.vx = 0; p.vy = 0; p.facing = 1;
  return { px: p.x, py: p.y, wet: !!p.inWater };
}, { s: spot, dy });
const pinBottom = () => pin(null);

// ============ PhaseA 微测(决定性):真 drawWingOverlay mirrorPass 重放 ============
// (放 R2 后:Glow_183/Wings_29/Wings_31 经真实绘制/预暖已解码——ensureVImage 懒加载
//  未就绪帧 width=0 会让 slice() 返 null 空转,R2 前跑=三站全零假象)
const runPhaseA = async () => page.evaluate(async () => {
  const g = window.__swGame, r = g.renderer, p = g.player;
  const WV = await import('/src/data/vanillaWingVisuals.ts');
  const out = {};
  for (const slot of [32, 29, 31]) {   // glowAdd/selfAdd/nebula 三站共用 addScratch
    const file = slot === 32 ? 'Glow_183.png' : `Wings_${slot}.png`;
    const W = 220, H = 160;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const mc = cv.getContext('2d', { willReadFrequently: true });
    mc.imageSmoothingEnabled = false;
    mc.translate(60, 50);   // 把 -sw·k/2 负偏移的精灵挪进画布
    r.drawWingOverlay(p, slot, WV.wingDrawOf(slot), 0, null, 1, 1, null, null, mc, true);
    const id = mc.getImageData(0, 0, W, H).data;
    let nPos = 0, n255 = 0, nSemi = 0, rgbSum = 0;
    for (let i = 0; i < id.length; i += 4) {
      const a = id[i + 3];
      if (a > 0) { nPos++; if (a === 255) n255++; else nSemi++; }
      rgbSum += id[i] + id[i + 1] + id[i + 2];
    }
    out[slot] = { nPos, n255, nSemi, rgbSum, texW: r.atlas.ensureVImage('vanilla/' + file)?.width ?? 0 };
  }
  return out;
});

// ============ PhaseB:翼 overlay 盒左缘带 vs 左邻对照带 ============
const readBoxes = () => page.evaluate(() => window.__bj719dbg.bigBoxes.slice());
const clearBoxes = () => page.evaluate(() => {
  window.__bj719dbg.boxes.length = 0; window.__bj719dbg.bigBoxes.length = 0;
  window.__bj719dbg.wingQ.length = 0;
});
const gamePos = () => page.evaluate(() => {
  const g = window.__swGame;
  const cam = g.camera, cv = g.renderer.canvas;
  return { px: g.player.x, py: g.player.y, zoom: cam.zoom,
    camX: cam.x, camY: cam.y, cw: cv.width, ch: cv.height };
});
/** 主画布带均色(剔除 α≤60;excl=非翼逃逸笔盒逐像素跳过=世界粒子等合法罩面防污染) */
const bandMean = (b, excl) => page.evaluate((e) => {
  const g = window.__swGame, ctx = g.renderer.ctx;
  const x0 = Math.max(0, Math.round(e.x0)), y0 = Math.max(0, Math.round(e.y0));
  const bw = Math.max(1, Math.round(e.bw)), bh = Math.max(1, Math.round(e.bh));
  const img = ctx.getImageData(x0, y0, bw, bh).data;
  const inExcl = (px, py) => e.excl.some((r) =>
    px >= r.x - 1 && px < r.x + r.w + 1 && py >= r.y - 1 && py < r.y + r.h + 1);
  let r = 0, gg = 0, b = 0, n = 0, skip = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (inExcl(x0 + x, y0 + y)) { skip++; continue; }
    const i = (y * bw + x) * 4;
    if (img[i + 3] > 60) { r += img[i]; gg += img[i + 1]; b += img[i + 2]; n++; }
  }
  if (!n || n < (bw * bh - skip) * 0.4) return null;   // 带被吞 >60%=无效(勿测)
  return { r: +(r / n).toFixed(1), g: +(gg / n).toFixed(1), b: +(b / n).toFixed(1), n, skip };
}, { ...b, excl: excl ?? [] });
/** 盒→带对:左缘带(盒内 +11px 起 18px 宽,跳过 veilAabb 边距=纯 mask 矩形域、
 *  翼形在贴图右半=facing=1 时左缘恒透明)与同行左邻对照带(盒左 62..22px) */
const bandPairOfBox = (box) => {
  const margin = { x0: box.x + 11, y0: box.y + 10, bw: 18, bh: Math.max(4, box.h - 20) };
  const ctrl = { x0: box.x - 62, y0: margin.y0, bw: 40, bh: margin.bh };
  return { margin, ctrl };
};
const diffBands = async (box, allBoxes) => {
  const { margin, ctrl } = bandPairOfBox(box);
  const excl = (allBoxes ?? []).filter((b) => b !== box
    && !(Math.abs(b.w - box.w) <= 4 && Math.abs(b.h - box.h) <= 4));   // 翼盒自身不排除
  const m = await bandMean(margin, excl), c = await bandMean(ctrl, excl);
  if (!m || !c) return null;
  return { margin: m, ctrl: c,
    maxD: Math.max(Math.abs(m.r - c.r), Math.abs(m.g - c.g), Math.abs(m.b - c.b)),
    dR: +(m.r - c.r).toFixed(1), dG: +(m.g - c.g).toFixed(1), dB: +(m.b - c.b).toFixed(1) };
};

// ---- R2 先行:水下+翼(取盒+病理值) ----
console.log('equip:', JSON.stringify(await equipWings(true)));
await pinBottom(); await waitFrames(3);
await clearBoxes(); await waitFrames(2);
const boxes = await readBoxes();
// 翼 overlay 盒 = 宽 ≈ (86+16)·z+2 / 高 ≈ (62+16)·z+2 中最接近者
const gp2 = await gamePos();
let wingBox = null, bestD = 1e9;
for (const b of boxes) {
  const d = Math.abs(b.w - (102 * gp2.zoom + 2)) + Math.abs(b.h - (78 * gp2.zoom + 2));
  if (d < bestD) { bestD = d; wingBox = b; }
}
if (!wingBox || bestD > 90) {
  console.error('NO_WING_BOX', JSON.stringify({ boxes, wingQ: await page.evaluate(() => window.__bj719dbg.wingQ.slice()), gp2 }));
  await browser.close(); process.exit(3);
}
// 3 次采样取 min(蓝矩形病=逐帧恒在,任一采样即现;世界粒子/波光瞬态=偶发——
//   min 滤瞬态防假红;活画布与 rAF 并行,boxes 读与像素读之间可跨帧=竞态面)
const sampleMin3 = async (box) => {
  let best = null;
  for (let k = 0; k < 3; k++) {
    await clearBoxes(); await waitFrames(1);
    const r = await diffBands(box, await readBoxes());
    if (!r) continue;
    if (!best || r.maxD < best.maxD) best = r;
  }
  return best;
};
const r2 = await sampleMin3(wingBox);
const r2mask = await page.evaluate(() => window.__bj719dbg.maskSnaps.slice(-2));
await page.screenshot({ path: `${OUT}/R2-underwater-wings.png` });
// 预暖 29/31 贴图(R2 真实绘制已暖 Glow_183;29/31 未装备=须手动暖)后跑 PhaseA
await page.evaluate(() => {
  const r = window.__swGame.renderer;
  r.atlas.ensureVImage('vanilla/Wings_29.png');
  r.atlas.ensureVImage('vanilla/Wings_31.png');
});
await new Promise((res) => setTimeout(res, 900));
const phaseA = await runPhaseA();

// ---- R1:水下无翼(基线:同位同背景,veil 无会话) ----
await equipWings(false);
await pinBottom(); await waitFrames(14);   // >equipStats cache 周期(~161ms),确保翼面已撤
const r1 = await sampleMin3(wingBox);
const r1mask = await page.evaluate(() => window.__bj719dbg.maskSnaps.slice(-1));
await equipWings(true);
await page.screenshot({ path: `${OUT}/R1-underwater-nowings.png` });

// ---- R3:水上 8 格空中+翼(无罩对照;盒按玩家位移+相机换算平移) ----
await pin(-8); await waitFrames(3); await pin(-8);   // 双钉:消 3 帧下落位移
const gp3 = await gamePos();
// 页域盒→世界域(经 R2 相机),再经 R3 相机+玩家位移回页域
const z = gp2.zoom;
// 盒锚定玩家:按玩家世界位移平移(精确,免相机缓动误差)
const dx = (gp3.px - gp2.px) * z, dy = (gp3.py - gp2.py) * z;
const box3 = { x: wingBox.x + dx, y: wingBox.y + dy, w: wingBox.w, h: wingBox.h };
await clearBoxes(); await waitFrames(2);
const r3 = await diffBands(box3, await readBoxes());
const r3mask = await page.evaluate(() => window.__bj719dbg.maskSnaps.slice(-1));
await page.screenshot({ path: `${OUT}/R3-abovewater-wings.png` });
// ---- R4:水上同位无翼(消背景非对称:R3 的 margin-vs-ctrl 差=洞穴气/壁背景差,
//      非罩面——判据改「同位翼开/关 margin 带差」,直接判翼光是否留下任何可见笔) ----
await equipWings(false);
await pin(-8); await waitFrames(14);
await clearBoxes(); await waitFrames(2);
const r4 = await diffBands(box3, await readBoxes());
await equipWings(true);

console.log('=== PhaseA 微测:真 drawWingOverlay mirrorPass 重放到透明 tgt ===');
console.log('  参照:Glow_183 帧0 切片 86×62 a0=81.8%/a255=6.2%/semi=11.9%;');
console.log('  摊平态预期 nPos≈n255≈91×66≈6000(semi=0);保形态预期 nPos≈形状≈1100(semi≈500)');
console.log(JSON.stringify(phaseA, null, 1));
console.log('=== PhaseB 盒带(左缘带 vs 左邻对照带;maxD=色差) ===');
console.log('R2 水下+翼:', JSON.stringify(r2));
console.log('R1 水下无翼(基线):', JSON.stringify(r1));
console.log('R3 水上+翼(无罩对照):', JSON.stringify(r3));
console.log('R4 水上同位无翼(背景对照):', JSON.stringify(r4));
console.log('wingBox:', JSON.stringify(wingBox), 'bestD:', bestD, 'zoom:', z);
console.log('mask snaps R2(翼):', JSON.stringify(r2mask));
console.log('mask snaps R1(无翼,应无新快照):', JSON.stringify(r1mask));
console.log('mask snaps R3(水上,应无新快照):', JSON.stringify(r3mask));
console.log('pageerrors:', errors.length, errors.slice(0, 5));

// 判读(探针自结案:修前=摊平病灶在位;修后=保形。R1/R3 两对照恒净)
const a32 = phaseA['32'];
const flatOnMask = a32 && a32.n255 > 4000 && a32.nSemi === 0;
const base = r1 ? r1.maxD : 0;
const artifact = r2 ? r2.maxD : 0;
// 水上判据=同位翼开/关 margin 带差(R3-R4;ctrl 带含洞穴背景非对称,不作判据)
const aboveD = r3 && r4 ? Math.max(Math.abs(r3.margin.r - r4.margin.r),
  Math.abs(r3.margin.g - r4.margin.g), Math.abs(r3.margin.b - r4.margin.b)) : null;
// ★E2E mask 机制判据=semi 签名:翼形(Glow_183 semi 11.9%)必带 nSemi≈590-606;
//   摊平矩形 nSemi=0 恒;世界粒子笔=二值 α(n255)不染 nSemi=抗污染判别。
//   (margin-vs-ctrl 带差受湖底光照横向梯度污染(亮湖基线 36),降级为证据不作门)
const maskSnap = r2mask.length ? r2mask[r2mask.length - 1] : null;
const maskWingShaped = !!maskSnap && maskSnap.nSemi > 300 && !flatOnMask;
// 同像素翼开/关差(R2.margin vs R1.margin:消除背景梯度;预冻结时钟下水纹稳定)
const underDelta = r2 && r1 ? Math.max(Math.abs(r2.margin.r - r1.margin.r),
  Math.abs(r2.margin.g - r1.margin.g), Math.abs(r2.margin.b - r1.margin.b)) : null;
const verdict = {
  flattenRectOnMask: !!flatOnMask,                 // 修前 true / 修后 false(PhaseA 决定性)
  maskWingShaped,                                  // 修前 false(nSemi=0)/修后 true(≈590+)
  underwaterMarginDelta: underDelta,               // 证据:修前黑湖 115 / 修后 0-4(软门 ≤40)
  baselineClean: base <= 45,                        // 无翼基线(亮湖梯度本底可至 ~36)
  aboveWaterClean: aboveD === null || aboveD <= 12, // 水上翼开关零差(两态)
  maskRectScale: maskSnap ? maskSnap.nPos : null,   // 修前≈矩形 6000+ / 修后≈形状 740(粒子可叠)
};
console.log('aboveWater R3-R4 margin 差:', aboveD);
console.log('VERDICT:', JSON.stringify(verdict));
await browser.close();
process.exit(verdict.flattenRectOnMask === false && verdict.maskWingShaped === true
  && verdict.baselineClean && verdict.aboveWaterClean
  && (verdict.underwaterMarginDelta === null || verdict.underwaterMarginDelta <= 40) ? 0 : 1);
