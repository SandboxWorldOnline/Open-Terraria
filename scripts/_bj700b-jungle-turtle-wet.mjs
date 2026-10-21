// ★BJ700b 终局取证:丛林龟 617 wet 全链(真水塘:入水/浮面/游动/出岸)+ 自然游荡 + 受击击退。
// 池设计修正:盆侧壁+盆底完整(侧漏防护),水面低于岸顶 16px。
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
  const put = (x, y) => {
    if (!st.inBounds(x, y)) return;
    st.setTileSilent(x, y, dirtId, 0, 0);
    const i = st.idx(x, y);
    st.half[i] = 0; st.slope[i] = 0; st.liquid[i] = 0; st.liquidType[i] = 0;
  };
  const water = (x, y) => {
    if (!st.inBounds(x, y)) return;
    const i = st.idx(x, y);
    st.liquid[i] = 255; st.liquidType[i] = 1;
  };
  const TRACKS = {
    // P1 真水塘:岸 row R 全铺;盆 cols [a..a+7] 挖 R..R+3;壁 a-1/a+8 于 R+1..R+5;
    //    盆底 R+4 全铺 a..a+7;水注 R+1..R+3(水面=(R+1)*16,低于岸顶 16px)
    'P1-pond': { row: 170, build(c0, c1, R) {
      const a = c0 + 9, b = c0 + 16;
      for (let c = c0; c <= c1; c++) put(c, R);
      for (let c = a; c <= b; c++) { for (let d = 0; d <= 3; d++) { const i = st.idx(c, R + d); st.setTileSilent(c, R + d, 0, 0, 0); st.liquid[i] = 0; } }
      for (let d = 1; d <= 5; d++) { put(a - 1, R + d); put(b + 1, R + d); }
      for (let c = a; c <= b; c++) put(c, R + 4);
      for (let c = a; c <= b; c++) for (let d = 1; d <= 3; d++) water(c, R + d);
    } },
    // P2 起伏自然地形:平地/1格沉/1格台/2格墙/坡链混合 + 中段小水池(2 宽 2 深)
    'P2-natural': { row: 196, build(c0, c1, R) {
      for (let c = c0; c <= c1; c++) put(c, R);
      put(c0 + 6, R - 1);                                     // 1 格台
      for (let c = c0 + 10; c <= c0 + 12; c++) { const i = st.idx(c, R); st.setTileSilent(c, R, 0, 0, 0); st.liquid[i] = 0; put(c, R + 1); }   // 1 格沉
      put(c0 + 16, R - 1); put(c0 + 16, R - 2);               // 2 格墙
      for (let k = 0; k < 4; k++) { put(c0 + 20 + k, R - 1 - k, ); for (let d = 0; d <= k; d++) put(c0 + 20 + k, R - 1 - d); }   // 阶梯上
      for (let k = 0; k < 3; k++) { put(c0 + 24 + k, R - 4 + 1 + k); for (let d = 0; d < 5 - k; d++) put(c0 + 24 + k, R - 4 + k + d); }       // 阶梯下
      const a = c0 + 30, b = c0 + 33;                          // 小水池
      for (let c = a; c <= b; c++) { const i = st.idx(c, R); st.setTileSilent(c, R, 0, 0, 0); st.liquid[i] = 0; water(c, R); put(c, R + 1); }
    } },
  };
  const C0 = 44, C1 = 70;
  for (const tr of Object.values(TRACKS)) tr.build(C0, C1, tr.row);
  p.x = (C0 - 8) * 16; p.y = (TRACKS['P1-pond'].row - 6) * 16; p.vx = 0; p.vy = 0;
  return { ok: true, C0, C1, rows: Object.fromEntries(Object.entries(TRACKS).map(([k, t]) => [k, t.row])) };
}, { dirtId: dirt.id });
L.chk('场景铺设', setup.ok, JSON.stringify(setup));

const spawns = await page.evaluate(async ({ C0, rows }) => {
  const g = window.__swGame;
  const out = [];
  for (const [key, R] of Object.entries(rows)) {
    const meta = await window.__swFlow.spawnVanillaEnemy(617, (C0 + 1) * 16 + 8, R * 16 - 10);
    const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
    if (e) {
      e.ai0 = 1; e.ai1 = 1200; e.lai3 = -1; e.facing = 1; e.vx = 0.5; e.vy = 0;
      e.critterHomeX = C0 + 14;
      out.push({ key, id: e.id });
    }
  }
  // P3:受击击退轨(平地, turtle 站定受击)
  const meta3 = await window.__swFlow.spawnVanillaEnemy(617, (C0 + 2) * 16 + 8, rows['P2-natural'] === undefined ? 0 : 0);
  return out;
}, { C0: setup.C0, rows: setup.rows });
L.chk('生成', spawns.length >= 2, JSON.stringify(spawns));

const telem = await page.evaluate(async ({ ids }) => {
  const g = window.__swGame;
  const N = 900, STEP = 50;
  const logs = {};
  for (const s of ids) logs[s.key] = [];
  let t = 0;
  const find = (id) => { for (const e of g.entities.enemies) if (e.id === id) return e; return null; };
  // P3 受击:在 t=200 对 P1 龟打一发击退(vx=4, vy=-4 模拟击退)
  let hitDone = false;
  while (t < N) {
    const n = Math.min(STEP, N - t);
    for (let i = 0; i < n; i++) {
      g.fixedUpdate(1 / 60);
      t++;
      if (!hitDone && t >= 200) {
        hitDone = true;
        const e = find(ids[0].id);
        if (e) { e.vx = 4; e.vy = -4; }   // 模拟击退(右抛)
      }
      for (const s of ids) {
        const e = find(s.id);
        if (!e) continue;
        logs[s.key].push({
          t, x: +e.x.toFixed(1), y: +e.y.toFixed(1), vx: +e.vx.toFixed(2), vy: +e.vy.toFixed(2),
          gr: e.onGround ? 1 : 0, wet: e.wet ? 1 : 0, a0: e.ai0, a1: Math.round(e.ai1), f: e.facing,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  const summarize = (log) => {
    const wetTicks = log.filter((k) => k.wet).length;
    const airTicks = log.filter((k) => k.gr === 0 && !k.wet).length;
    const wetAir = log.filter((k) => k.gr === 0 && k.wet).length;
    const jumps = log.filter((k) => k.vy < -1).length;
    const turns = [];
    let lf = null;
    for (const k of log) { if (lf !== null && k.f !== lf) turns.push({ t: k.t, f: k.f, x: k.x, wet: k.wet }); lf = k.f; }
    const states = {};
    for (const k of log) { const key = `a0=${k.a0}${k.wet ? 'W' : ''}${k.gr ? 'G' : 'A'}`; states[key] = (states[key] ?? 0) + 1; }
    return { wetTicks, airTicks, wetAir, jumps, turns: turns.slice(0, 20), turnN: turns.length, states,
      wetSpan: wetTicks ? [log.find((k) => k.wet).t, [...log].reverse().find((k) => k.wet).t] : null,
      endX: log[log.length - 1].x, endY: log[log.length - 1].y };
  };
  return { P1: summarize(logs['P1-pond']), P2: summarize(logs['P2-natural']),
    P1wetSample: logs['P1-pond'].filter((k) => k.wet).slice(0, 14),
    P1hitSample: logs['P1-pond'].filter((k) => k.t >= 195 && k.t <= 260) };
}, { ids: spawns });

console.log('\n=== P1 水塘(入水→浮面→游→出岸) ===');
console.log(JSON.stringify(telem.P1, null, 1));
console.log('\nP1 wet 段采样:');
for (const k of telem.P1wetSample) console.log(' ', JSON.stringify(k));
console.log('\nP1 受击段(t195-260):');
for (const k of telem.P1hitSample) console.log(' ', JSON.stringify(k));
console.log('\n=== P2 自然地形 ===');
console.log(JSON.stringify(telem.P2, null, 1));

await browser.close();
console.log('DONE');
