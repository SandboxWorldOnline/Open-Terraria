// ★BJ700b 坡面取证探针:丛林龟 617 下坡/上坡行走——WalkDownSlope 缺失症取证。
// T9 下坡链(slope1 逐列降行)/T10 上坡链(slope2)/T11 下坡+坡底台阶。
// 判据:腾空 tick 数(onGround=0)、vy>0 微坠计数、旋帧当量(!onGround 即帧8)、轨迹平滑度。
import { launchBrowser, openPage, bootstrap, createGame, ledger, freezeClock } from '../tools/probe/lib/index.mjs';
import { tileIdBySheet } from '../tools/probe/lib/entities.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const L = ledger();

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 80));
await freezeClock(page, { tod: 0.345 });

const dirt = await tileIdBySheet(page, 0);
L.chk('dirt id', dirt.ok, JSON.stringify(dirt));

const setup = await page.evaluate(({ dirtId }) => {
  const g = window.__swGame;
  const st = g.world.store;
  const p = g.player;
  p.debugGod = true;
  const X0 = 40, X1 = 132, Y0 = 150, Y1 = 272;
  for (let x = X0; x <= X1; x++) {
    for (let y = Y0; y <= Y1; y++) {
      const i = st.idx(x, y);
      st.setTileSilent(x, y, 0, 0, 0);
      st.half[i] = 0; st.slope[i] = 0;
      st.liquid[i] = 0; st.liquidType[i] = 0;
    }
  }
  const put = (x, y, sl = 0) => {
    if (!st.inBounds(x, y)) return;
    st.setTileSilent(x, y, dirtId, 0, 0);
    const i = st.idx(x, y);
    st.half[i] = 0; st.slope[i] = sl; st.liquid[i] = 0; st.liquidType[i] = 0;
  };
  const TRACKS = {
    // T9: 8 列平地 → 8 列 slope1 下坡链(逐列降 1 行) → 平地(slope1=左高右低,右行下降)
    'T9-downslope': { row: 170, build(c0, c1, R) { for (let c = c0; c <= c1; c++) { if (c < c0 + 8) put(c, R); else if (c < c0 + 16) { put(c, R + (c - (c0 + 8)), 1); for (let d = 1; d <= 8; d++) put(c + 0, R + (c - (c0 + 8)) + d); } else put(c, R + 8); } } },
    // T10: 8 列平地 → 8 列 slope2 上坡链(逐列升 1 行) → 平地(slope2=右高左低,右行爬升)
    'T10-upslope': { row: 194, build(c0, c1, R) { for (let c = c0; c <= c1; c++) { if (c < c0 + 8) put(c, R); else if (c < c0 + 16) { const up = c - (c0 + 8); put(c, R - up, 2); for (let d = 1; d <= 8; d++) put(c, R - up + d); } else put(c, R - 8); } } },
    // T11: 平地 → slope1 下坡 → 坡底接 1 格台阶(复合地形)
    'T11-mixed': { row: 222, build(c0, c1, R) { for (let c = c0; c <= c1; c++) { if (c < c0 + 8) put(c, R); else if (c < c0 + 14) { put(c, R + (c - (c0 + 8)), 1); for (let d = 1; d <= 8; d++) put(c, R + (c - (c0 + 8)) + d); } else put(c, R + 6); } put(c0 + 16, R + 5); } },
  };
  const C0 = 44, C1 = 70;
  for (const tr of Object.values(TRACKS)) tr.build(C0, C1, tr.row);
  p.x = (C0 - 8) * 16; p.y = (TRACKS['T9-downslope'].row - 6) * 16; p.vx = 0; p.vy = 0;
  return { ok: true, C0, C1, rows: Object.fromEntries(Object.entries(TRACKS).map(([k, t]) => [k, t.row])) };
}, { dirtId: dirt.id });
L.chk('坡面轨道铺设', setup.ok, JSON.stringify(setup));

const spawns = await page.evaluate(async ({ C0, rows }) => {
  const g = window.__swGame;
  const out = [];
  for (const [key, R] of Object.entries(rows)) {
    const meta = await window.__swFlow.spawnVanillaEnemy(617, (C0 + 1) * 16 + 8, R * 16 - 10);
    const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
    if (e) {
      e.ai0 = 1; e.ai1 = 900; e.lai3 = -1; e.facing = 1; e.vx = 0.5; e.vy = 0;
      e.critterHomeX = C0 + 13;
      out.push({ key, id: e.id });
    }
  }
  return out;
}, { C0: setup.C0, rows: setup.rows });
L.chk('617×3 生成', spawns.length === 3, JSON.stringify(spawns));

const telem = await page.evaluate(async ({ ids }) => {
  const g = window.__swGame;
  const N = 600, STEP = 50;
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
          t, x: +e.x.toFixed(2), y: +e.y.toFixed(2), vx: +e.vx.toFixed(2), vy: +e.vy.toFixed(2),
          gr: e.onGround ? 1 : 0, wet: e.wet ? 1 : 0, a0: e.ai0, f: e.facing,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const stats = {};
  for (const s of ids) {
    const log = logs[s.key];
    const air = log.filter((k) => k.gr === 0 && k.vy >= 0);
    const microFall = log.filter((k) => k.vy > 0 && k.vy < 1.2);
    const jumps = log.filter((k) => k.vy < -0.01);
    // 坡段窗口: x 在 [c0+7, c0+17]*16
    const slopeWin = log.filter((k) => k.x >= 50 * 16 && k.x <= 62 * 16);
    const slopeAir = slopeWin.filter((k) => k.gr === 0);
    stats[s.key] = {
      ticks: log.length,
      airTicks: air.length, airSample: air.slice(0, 8),
      microFallTicks: microFall.length, jumpTicks: jumps.length,
      slopeWinTicks: slopeWin.length, slopeAirTicks: slopeAir.length,
      slopeAirRatio: slopeWin.length ? +(slopeAir.length / slopeWin.length).toFixed(3) : null,
      yRange: [Math.min(...log.map((k) => k.y)), Math.max(...log.map((k) => k.y))],
      endX: log[log.length - 1].x, endY: log[log.length - 1].y, endF: log[log.length - 1].f,
    };
  }
  return stats;
}, { ids: spawns });

for (const [key, s] of Object.entries(telem)) {
  console.log(`\n=== ${key} ===`);
  console.log(JSON.stringify({ ...s, airSample: s.airSample.map((k) => `t${k.t}(vy${k.vy},y${k.y})`) }));
}

await browser.close();
console.log('DONE');
