// ★BJ700b 真实丛林长跑:生成世界丛林区(x≈jungleX)地表原位放 3 只 617 自然游荡 3000t。
// 全事件捕获:跳/落/掉头/卡磨/湿段/旋帧当量(!onGround&&!wet)/状态占比 + 300t 摘要时间线。
import { launchBrowser, openPage, bootstrap, createGame, ledger, freezeClock } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const L = ledger();

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 80));
await freezeClock(page, { tod: 0.345 });

const setup = await page.evaluate(() => {
  const g = window.__swGame;
  const w = g.world;
  const st = w.store;
  const p = g.player;
  p.debugGod = true;
  // 丛林 X 定位:world.jungleX(生成期写入);兜底扫描丛林草(sheet 60 族)
  let jx = w.jungleX;
  if (!jx) {
    outer: for (let x = 20; x < st.w - 20; x += 10) {
      for (let y = Math.floor(st.h * 0.25); y < Math.floor(st.h * 0.5); y++) {
        const t = st.type[st.idx(x, y)];
        if (t === 60 || t === 661 || t === 662) { jx = x; break outer; }
      }
    }
  }
  // 地表行:自 h*0.2 向下扫首个实心行(丛林表面)
  const surfaceY = (() => { for (let y = Math.floor(st.h * 0.2); y < st.h; y++) { let solid = 0; for (let d = -3; d <= 3; d++) { if (st.isSolid(jx + d, y)) solid++; } if (solid >= 5) return y; } return -1; })();
  p.x = jx * 16; p.y = (surfaceY - 8) * 16; p.vx = 0; p.vy = 0;
  return { jx, surfaceY, h: st.h, w: st.w };
});
L.chk('丛林定位', setup.surfaceY > 0, JSON.stringify(setup));

const spawns = await page.evaluate(async ({ jx, surfaceY }) => {
  const g = window.__swGame;
  const st = g.world.store;
  const out = [];
  for (let k = 0; k < 5; k++) {
    const tx = jx - 12 + k * 7;
    // 逐列真地表:自 surfaceY-60 向下扫首行 solid 且上两行空气
    let ground = -1;
    for (let y = Math.max(2, surfaceY - 60); y < surfaceY + 60; y++) {
      if (st.isSolid(tx, y) && !st.isSolid(tx, y - 1) && !st.isSolid(tx, y - 2)
        && st.liquid[st.idx(tx, y - 1)] === 0) { ground = y; break; }
    }
    if (ground < 0) continue;
    const meta = await window.__swFlow.spawnVanillaEnemy(617, tx * 16 + 8, ground * 16 - 10);
    const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
    if (e) out.push({ key: `J${k}`, id: e.id, x0: e.x, y0: e.y, ground });
  }
  return out;
}, setup);
L.chk('617×5 生成', spawns.length >= 3, JSON.stringify(spawns).slice(0, 200));

const telem = await page.evaluate(async ({ ids }) => {
  const g = window.__swGame;
  const N = 3600, STEP = 60;
  const logs = {};
  for (const s of ids) logs[s.key] = [];
  let t = 0;
  const find = (id) => { for (const e of g.entities.enemies) if (e.id === id) return e; return null; };
  while (t < N) {
    const n = Math.min(STEP, N - t);
    for (let i = 0; i < n; i++) {
      g.fixedUpdate(1 / 60);
      t++;
      for (const s of ids) {
        const e = find(s.id);
        if (!e) continue;
        logs[s.key].push({
          t, x: +e.x.toFixed(1), y: +e.y.toFixed(1), vx: +e.vx.toFixed(2), vy: +e.vy.toFixed(2),
          gr: e.onGround ? 1 : 0, wet: e.wet ? 1 : 0, a0: e.ai0, f: e.facing,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const summarize = (log) => {
    const ev = [];
    let airFrom = -1, lastF = null, lastX = null, stillT = 0, stillMarked = false;
    for (const k of log) {
      if (k.vy < -0.01 && airFrom < 0) { airFrom = k.t; ev.push({ t: k.t, e: 'jump', vy: k.vy, x: k.x }); }
      else if (k.gr === 0 && k.vy > 0.05 && airFrom < 0) { airFrom = k.t; ev.push({ t: k.t, e: 'fall', x: k.x, wet: k.wet }); }
      if (airFrom >= 0 && k.gr) { ev.push({ t: k.t, e: 'land', x: k.x, airT: k.t - airFrom, wet: k.wet }); airFrom = -1; }
      if (lastF !== null && k.f !== lastF) ev.push({ t: k.t, e: 'turn', f: k.f, x: k.x });
      lastF = k.f;
      if (k.a0 === 1) {
        if (lastX !== null && Math.abs(k.x - lastX) < 0.01) { stillT++; if (stillT === 60 && !stillMarked) { ev.push({ t: k.t, e: 'STUCK60', x: k.x, f: k.f, y: k.y }); stillMarked = true; } }
        else { stillT = 0; stillMarked = false; }
        lastX = k.x;
      } else { lastX = null; stillT = 0; stillMarked = false; }
    }
    const wetT = log.filter((k) => k.wet).length;
    const spinT = log.filter((k) => !k.gr && !k.wet).length;
    const jumpN = ev.filter((e) => e.e === 'jump').length;
    const fallN = ev.filter((e) => e.e === 'fall' && !e.wet).length;
    const turnN = ev.filter((e) => e.e === 'turn').length;
    const stuckN = ev.filter((e) => e.e === 'STUCK60').length;
    return { wetT, spinT, jumpN, fallN, turnN, stuckN, evN: ev.length,
      xRange: [Math.min(...log.map((k) => k.x)), Math.max(...log.map((k) => k.x))],
      events: ev.slice(0, 40) };
  };
  // 长腾空段取证:gr=0 连续 >120t 的段落逐拍导出(每 4t 采样)
  const longAir = {};
  for (const s of ids) {
    const log = logs[s.key];
    const segs = [];
    let st0 = -1;
    for (let i = 0; i < log.length; i++) {
      const k = log[i];
      if (k.gr === 0 && st0 < 0) st0 = i;
      else if (k.gr === 1 && st0 >= 0) { if (i - st0 > 120) segs.push([st0, i]); st0 = -1; }
    }
    if (st0 >= 0 && log.length - st0 > 120) segs.push([st0, log.length]);
    longAir[s.key] = segs.map(([a, b]) => log.slice(a, b).filter((_, i) => i % 4 === 0 || i === b - a - 1));
  }
  return { sums: Object.fromEntries(ids.map((s) => [s.key, summarize(logs[s.key])])), longAir };
}, { ids: spawns });

for (const [key, s] of Object.entries(telem.sums)) {
  console.log(`\n=== ${key} === wet=${s.wetT} spin=${s.spinT} jump=${s.jumpN} fall=${s.fallN} turn=${s.turnN} stuck60=${s.stuckN} x∈[${s.xRange[0]},${s.xRange[1]}]`);
  for (const e of s.events.slice(0, 12)) console.log(' ', JSON.stringify(e));
  if (s.evN > 12) console.log(`  …共 ${s.evN} 事件`);
}
console.log('\n=== 长腾空段(>120t)逐拍 ===');
for (const [key, segs] of Object.entries(telem.longAir)) {
  for (let si = 0; si < segs.length; si++) {
    console.log(`-- ${key} seg${si} --`);
    for (const k of segs[si]) console.log(' ', JSON.stringify(k));
  }
}

await browser.close();
console.log('DONE');
