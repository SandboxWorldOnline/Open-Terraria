// ★BJ737-A 翼/甲层序闸(2026-10-29 用户实报「翼淡半透+滑翔姿态滞留/星尘套暗淡」
// 定谳+四刀修复的回归锁):星尘套+翼槽29(selfAdd+mainGlow=倒置案例)真装备,
// 冻结世界+pinned vy,gladd=0/1 双臂 fold 复刻读回(=DOM 等价终像)diff。
// 断言:GA n≤0.05%(⑥/⑧ AA 边缘族收容;修复前=864px/mean+27 倒置签名)+组尾批
// 零残留+翼纹理每拍重传(姿态滞留锁)+wing GL 实走+armor/whip/inferno 月族帧
// 回 2D(刀4 契约)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-wingarmor-strict.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const OUT = '/Users/vinlic/.claude/jobs/d3098226/tmp';
const md5 = (b64) => createHash('md5').update(Buffer.from(b64, 'base64')).digest('hex');
const browser = await launchBrowser({});
const page = await openPage(browser, { width: 1280, height: 800 });
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261029 });
console.log('createGame', gen?.ok ? 'ok' : gen?.why);
await pump(page, 60);

// ---- 装备:星尘三件+翼槽29(真装备路径) ----
const placed = await page.evaluate(async () => {
  const g = window.__swGame;
  const p = g.player;
  const S = await import('/src/data/vanillaItemStats.ts');
  const Items = await import('/src/data/items.ts');
  let wingIid = -1;
  for (let i = 0; i < Items.ITEM_DEFS.length; i++) {
    if (S.statOfInternal(i)?.wing === 29) { wingIid = i; break; }
  }
  const cands = { head: -1, body: -1, legs: -1 };
  for (const [key, idx] of Object.entries(Items.ITEM_BY_KEY)) {
    if (!/stardust/i.test(key)) continue;
    const st = S.statOfInternal(idx);
    if (/helmet/i.test(key) && st?.hs != null) cands.head = idx;
    else if (/breastplate/i.test(key) && st?.bs != null) cands.body = idx;
    else if (/leggings/i.test(key) && st?.ls != null) cands.legs = idx;
  }
  if (wingIid < 0 || cands.head < 0 || cands.body < 0 || cands.legs < 0) return { ok: false, wingIid, cands };
  p.inv.armor[0] = { id: cands.head, stack: 1, prefix: 0 };
  p.inv.armor[1] = { id: cands.body, stack: 1, prefix: 0 };
  p.inv.armor[2] = { id: cands.legs, stack: 1, prefix: 0 };
  p.inv.armor[5] = { id: wingIid, stack: 1, prefix: 0 };
  return { ok: true, wingLogic: p.equipStats?.wing?.logic ?? -1 };
});
console.log('装备(星尘套+wing29)', JSON.stringify(placed));
if (!placed.ok) { await browser.close(); process.exit(1); }

// ---- 冻结套件(⑩闸同款)+夜幕 ----
await page.evaluate(() => {
  const g = window.__swGame;
  const r = g.renderer;
  const sky = r.sky;
  Object.getPrototypeOf(sky).constructor.cloudRegionBlit = false;
  const proto = Object.getPrototypeOf(sky);
  const origDraw = proto.draw;
  sky.draw = function (ctx, clock, w2, h2, camX, dtMs, camY) { return origDraw.call(this, ctx, clock, w2, h2, camX, 0, camY); };
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
  let rs = 20261029;
  Math.random = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
  try { const ww = r.waterWaves; if (ww) { ww.frame = noop; ww.draw = noop; } } catch { /* 域差异 */ }
  try { r.updateWaterWaves = noop; } catch { /* 域差异 */ }
  try { r.drawWindSwayTiles = noop; } catch { /* 域差异 */ }
  g.entities.critters.length = 0;
  g.entities.enemies.length = 0;
  g.entities.drops.length = 0;
  for (const n of g.entities.npcs) { const u = n.update; n.update = () => {}; n.__origUpdate = u; }
  try { g.vanillaSpawner && (g.vanillaSpawner.update = noop); } catch { /* 域差异 */ }
  try { g.evolution && (g.evolution.update = noop); } catch { /* 域差异 */ }
  window.__reseed = () => { let rs2 = 20261029; Math.random = () => { rs2 = (rs2 * 1103515245 + 12345) & 0x7fffffff; return rs2 / 0x7fffffff; }; };
  (async () => {
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
await freezeClock(page, { tod: 0.92 });   // 夜幕=发光面对比最大

// 位置:地表上空悬停
await page.evaluate(() => {
  const g = window.__swGame;
  const p = g.player;
  const st = g.world.store;
  const cx = Math.floor(g.world.spawnX) + 12;
  let sy = -1;
  for (let y = 8; y < st.h - 10; y++) { if (st.type[st.idx(cx, y)] !== 0) { sy = y; break; } }
  window.__px = cx * 16; window.__py = (sy - 12) * 16;
  p.x = window.__px; p.y = window.__py;
  p.vx = 0; p.vy = -3;
  g.camera.x = p.x; g.camera.y = p.y;
});
// 暖机(纹理/块收敛;paused 下渲染照常)
const drive = async (n) => {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => {
      const g = window.__swGame;
      const p = g.player;
      p.x = window.__px; p.y = window.__py; p.vx = 0; p.vy = -3;   // 钉:位置+vy(翼显形门)
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      g.frame(window.__vnow);
    });
  }
};
await drive(200);

// 帧账核验(GL 会话活)
const acct0 = await page.evaluate(() => {
  const r = window.__swGame.renderer;
  r.constructor.gladd = true;
  window.__vnow += 16.6667; window.__swGame.frame(window.__vnow);
  return {
    wing: { ...r.gladdWingStats }, armor: { ...r.gladdArmorStats },
    c10eComposited: !!r._c10eComposited,
    wingFrame: window.__swGame.player.wingFrame,
  };
});
console.log('B 预热帧账', JSON.stringify(acct0));

// ★闸装药(BJ737-A 回归锁):texRefresh(wing:*) 计数(姿态滞留锁——修复前=0 次
//  身份缓存冻结,修复后=每拍重传)+组 commit 计数+gqV 残留账
await page.evaluate(async () => {
  const m = await import('/src/render/GLSpriteLayer.ts');
  window.__wingRefresh = 0;
  const orig = m.GLSpriteLayer.prototype.texRefresh;
  m.GLSpriteLayer.prototype.texRefresh = function (key, img) {
    if (typeof key === 'string' && key.startsWith('wing:tex:')) window.__wingRefresh++;
    return orig.call(this, key, img);
  };
});

// ---- fold 复刻读回(=DOM 等价终像) ----
async function snapFin() {
  return page.evaluate(() => {
    const c = window.__swGame.renderer.canvas;
    const lc = document.createElement('canvas');
    lc.width = c.width; lc.height = c.height;
    const lx = lc.getContext('2d', { willReadFrequently: true });
    lx.drawImage(c, 0, 0);
    const rF = window.__swGame.renderer;
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
const fins = {};
async function runArm(tag) {
  await page.evaluate(() => window.__reseed());
  await drive(6);
  fins[tag] = await snapFin();
}
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = false; });
await runArm('A');
await runArm('Q');   // A/A 自检
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = true; });
const bRef0 = await page.evaluate(() => ({
  wr: window.__wingRefresh, gs: { ...window.__swGame.renderer.gladdGroupStats },
  wing: { ...window.__swGame.renderer.gladdWingStats },
  armor: { ...window.__swGame.renderer.gladdArmorStats },
  whip: { ...window.__swGame.renderer.gladdWhipStats },
  inferno: { ...window.__swGame.renderer.gladdInfernoStats },
}));
await runArm('B');
const bRef1 = await page.evaluate(() => ({
  wr: window.__wingRefresh, gs: { ...window.__swGame.renderer.gladdGroupStats },
  gqV: window.__swGame.renderer['_gqV'].length,
  wing: { ...window.__swGame.renderer.gladdWingStats },
  armor: { ...window.__swGame.renderer.gladdArmorStats },
  whip: { ...window.__swGame.renderer.gladdWhipStats },
  inferno: { ...window.__swGame.renderer.gladdInfernoStats },
}));
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = false; });
await runArm('P');

// AA 自检
const aaOk = fins.A.b64 === fins.Q.b64;
console.log('AA A≡A\'(harness 确定性):', aaOk ? `PASS md5=${md5(fins.A.b64).slice(0, 8)}` : 'FAIL(禁入 GA 判定)');

// GA diff:A(2D) vs B(gladd) —— DOM 等价终像的用户可见差
const diff = await page.evaluate(({ a, b }) => {
  const dec = (s) => { const bin = atob(s); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const da = dec(a.b64), db = dec(b.b64);
  let n = 0, maxd = 0, sum = 0, sumAbs = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const rows = [];
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 0) {
      n++;
      const sd = (da[i] + da[i + 1] + da[i + 2]) / 3 - (db[i] + db[i + 1] + db[i + 2]) / 3;
      sum += sd; sumAbs += Math.abs(sd);
      if (d > maxd) maxd = d;
      const p = i / 4, x = p % a.w, y = (p / a.w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (rows.length < 14) rows.push({ x, y, A: [da[i], da[i + 1], da[i + 2]], B: [db[i], db[i + 1], db[i + 2]] });
    }
  }
  // 16×12 粗网格浓度图(玩家邻域 ±400px)
  const cx = a.w / 2, cy = a.h / 2;
  const G = new Array(16 * 12).fill(0);
  const gx0 = cx - 400, gy0 = cy - 300;
  for (let i = 0; i < da.length; i += 4) {
    const p = i / 4, x = p % a.w, y = (p / a.w) | 0;
    const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 0 && x >= gx0 && x < gx0 + 800 && y >= gy0 && y < gy0 + 600) {
      const gi = Math.min(11, Math.floor((y - gy0) / 50)) * 16 + Math.min(15, Math.floor((x - gx0) / 50));
      G[gi]++;
    }
  }
  const map = [];
  for (let gy = 0; gy < 12; gy++) map.push(G.slice(gy * 16, gy * 16 + 16).map((v) => v > 999 ? '#' : v > 99 ? '+' : v > 9 ? '.' : v > 0 ? ',' : ' ').join(''));
  return { n, maxd, mean: n ? sum / n : 0, meanAbs: n ? sumAbs / n : 0, bbox: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], rows, map };
}, { a: fins.A, b: fins.B });
console.log(`\nGA(A=2D vs B=gladd,DOM 等价终像): n=${diff.n}(${(diff.n * 100 / (fins.A.w * fins.A.h)).toFixed(3)}%) maxΔ=${diff.maxd} mean=${diff.mean.toFixed(2)} meanAbs=${diff.meanAbs.toFixed(2)} bbox=${JSON.stringify(diff.bbox)}`);
console.log('mean>0 = A 亮/B 暗(倒置签名预期:正值,集中于玩家甲/翼区)');
console.log('差异样本(A=2D,B=gladd):');
for (const r of diff.rows) console.log(`  (${r.x},${r.y}) A=(${r.A.join(',')}) B=(${r.B.join(',')})`);
console.log('浓度图(玩家邻域 800×600,50px/格;#=1000+ +=100+ .=10+ ,=1+):');
for (const line of diff.map) console.log('  |' + line + '|');

// GB 翻回
const gbOk = fins.P.b64 === fins.A.b64;
console.log('\nGB A\'≡A(翻回恢复):', gbOk ? `PASS md5=${md5(fins.P.b64).slice(0, 8)}` : 'FAIL');

// 分层归因:B 臂 HUD vs gl 各自内容量(证明 glow 侧迁移)
const layers = await page.evaluate(() => {
  const r = window.__swGame.renderer;
  const bbox = (cv) => {
    if (!cv) return null;
    const c = document.createElement('canvas');
    const bw = 240, bh = 200;
    c.width = bw; c.height = bh;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, innerWidth / 2 - bw / 2, innerHeight / 2 - bh / 2, bw, bh, 0, 0, bw, bh);
    const d = x.getImageData(0, 0, bw, bh).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    return (sum / n).toFixed(2);
  };
  return { hud: bbox(r.canvas), gl: bbox(r.glCanvasEl) };
});
console.log('B 臂末态玩家邻域亮度: hud=' + layers.hud + ' gl=' + layers.gl);

// PNG 导出(目视):A/B 终像+玩家区 4× 放大裁剪
const pngs = await page.evaluate(({ a, b }) => {
  const dec = (s) => { const bin = atob(s); const u = new Uint8ClampedArray(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const da = dec(a.b64), db = dec(b.b64);
  const mk = (d) => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 800;
    const x = c.getContext('2d');
    const id = x.createImageData(1280, 800);
    id.data.set(d); x.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  };
  const crop4x = (d) => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    const x = c.getContext('2d');
    const id = x.createImageData(320, 240);
    const cx = 640, cy = 400;
    for (let yy = 0; yy < 240; yy++) for (let xx = 0; xx < 320; xx++) {
      const sx = cx - 160 + Math.floor(xx / 4), sy = cy - 120 + Math.floor(yy / 4);
      const si = (sy * 1280 + sx) * 4, di = (yy * 320 + xx) * 4;
      id.data[di] = d[si]; id.data[di + 1] = d[si + 1]; id.data[di + 2] = d[si + 2]; id.data[di + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  };
  return { A: mk(da), B: mk(db), Ac: crop4x(da), Bc: crop4x(db) };
}, { a: fins.A, b: fins.B });
for (const [k, url] of Object.entries(pngs)) {
  writeFileSync(`${OUT}/repro2-${k}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
console.log('\nPNG →', OUT + '/repro2-{A,B,Ac,Bc}.png');

// ---- BJ737-A 断言组(翼/甲层序+组尾批+姿态滞留三面回归锁) ----
const results = [];
const chk = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };
chk('AA A≡A\' harness 确定性', aaOk);
chk('GA A≡B 层序终像(倒置修复;n≤0.05% census 界=⑥/⑧ AA 边缘族)', diff.n * 100 / (fins.A.w * fins.A.h) <= 0.05,
  `n=${diff.n}(${(diff.n * 100 / (fins.A.w * fins.A.h)).toFixed(4)}%) maxΔ=${diff.maxd} mean=${diff.mean.toFixed(2)}`);
chk('GB A\'≡A 翻回恢复', gbOk);
chk('组会话激活(commit>0)+尾批零残留(gqV=0)', bRef1.gs.commit > bRef0.gs.commit && bRef1.gqV === 0,
  `commit ${bRef0.gs.commit}→${bRef1.gs.commit} gqV=${bRef1.gqV}`);
chk('翼纹理每拍重传(姿态滞留锁:wing texRefresh ≥ 每帧 2 笔)', bRef1.wr - bRef0.wr >= 12,
  `Δrefresh=${bRef1.wr - bRef0.wr}(6 帧 × 主纹理+overlay)`);
chk('wing GL 会话实走(主纹理入组后仍桥)', bRef1.wing.gl > bRef0.wing.gl, `wingΔgl=${bRef1.wing.gl - bRef0.wing.gl}`);
const la = await page.evaluate(() => ({ ...window.__swGame.renderer.gladdLunarArmorStats }));
chk('D1 7e 族入组契约(恒甲重绘+armorGlow GL 实走=层序全保序)',
  la.gl > 0 && bRef1.armor.gl > bRef0.armor.gl,
  `lunarArmorΔgl=${la.gl} armorΔgl=${bRef1.armor.gl - bRef0.armor.gl}(whip/inferno 解门后随内容自由)`);
await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(fails ? `\n*** ${fails} FAIL ***` : '\n=== BJ737-A 全绿 ===');
process.exit(fails ? 1 : 0);
