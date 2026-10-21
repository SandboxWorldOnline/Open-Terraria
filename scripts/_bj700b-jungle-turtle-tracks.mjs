// ★BJ700b 取证探针 v2:丛林龟 617「跳起旋转后行动状态」——受控轨道逐 tick 态机采样。
// v2:①天空盒清液体(v1 飘浮岛暗池伪影:T5/T6 vx=2 湿速污染);②新增 T5b 连续阶梯 /
//    T7 真水塘(湿侧链)/ T8 低顶一步台(StepUp 净空堵+三分支全哑=卡磨面);③facing
//    写入栈陷阱(v1 T6 每拍掉头振荡,须定谳写入者)。
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
  // ---- 清出天空试验场(含液体):rows [150..272], cols [40..132] ----
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
    st.liquid[i] = 255; st.liquidType[i] = 1;   // LIQUID_TYPE.WATER=1(本仓 +1 编码)
  };
  // ---- 轨道族 ----
  const TRACKS = {
    'T1-flat': { row: 162, build(c0, c1, R) { for (let c = c0; c <= c1; c++) put(c, R); } },
    'T2-dip1': { row: 172, build(c0, c1, R) { for (let c = c0; c <= c1; c++) put(c, c >= c0 + 10 ? R + 1 : R); } },
    'T3-step1': { row: 182, build(c0, c1, R) { for (let c = c0; c <= c1; c++) put(c, R); put(c0 + 10, R - 1); } },
    'T4-wall2': { row: 192, build(c0, c1, R) { for (let c = c0; c <= c1; c++) put(c, R); put(c0 + 10, R - 1); put(c0 + 10, R - 2); } },
    'T5-stair': { row: 202, build(c0, c1, R) { for (let c = c0; c <= c1; c++) put(c, R); for (let k = 0; k < 4; k++) { for (let d = 0; d <= k; d++) put(c0 + 8 + k * 3, R - 1 - d); } } },
    'T6-wall3': { row: 212, build(c0, c1, R) { for (let c = c0; c <= c1; c++) put(c, R); for (let d = 1; d <= 3; d++) put(c0 + 10, R - d); } },
    // T5b:连续阶梯(每 2 列 +1 高,升 4 后降 4;无间隙——原版全程 StepUp/StepDown 平滑)
    'T5b-smooth': { row: 226, build(c0, c1, R) { for (let c = c0; c <= c1; c++) { let hgt = 0; const k = Math.floor((c - (c0 + 4)) / 2); if (k >= 0 && k <= 3) hgt = k + 1; if (k >= 4 && k <= 7) hgt = 8 - k; if (hgt < 0) hgt = 0; for (let d = 0; d < hgt; d++) put(c, R - 1 - d); put(c, R); } } },
    // T7:水塘(左岸 8 列平地 → 8 列宽 4 深池注水 → 右岸平地)
    'T7-pool': { row: 240, build(c0, c1, R) { for (let c = c0; c <= c1; c++) { if (c >= c0 + 8 && c <= c0 + 15) { for (let d = 0; d <= 3; d++) { st.setTileSilent(c, R + d, 0, 0, 0); st.liquid[st.idx(c, R + d)] = 255; st.liquidType[st.idx(c, R + d)] = 1; } } else put(c, R); } } },
    // T8:低顶一步台(顶在 R-3,台在 R-1:StepUp j=2 净空堵 + 三分支全哑)
    'T8-grind': { row: 254, build(c0, c1, R) { for (let c = c0; c <= c1; c++) put(c, R); put(c0 + 10, R - 1); for (let c = c0 + 10; c <= c1; c++) put(c, R - 3); } },
  };
  const C0 = 44, C1 = 70;
  for (const tr of Object.values(TRACKS)) tr.build(C0, C1, tr.row);
  p.x = (C0 - 8) * 16; p.y = (TRACKS['T1-flat'].row - 6) * 16; p.vx = 0; p.vy = 0;
  return { ok: true, tracks: Object.keys(TRACKS), C0, C1, rows: Object.fromEntries(Object.entries(TRACKS).map(([k, t]) => [k, t.row])) };
}, { dirtId: dirt.id });
L.chk('轨道铺设', setup.ok, JSON.stringify(setup));

const spawns = await page.evaluate(async ({ C0, rows }) => {
  const g = window.__swGame;
  const out = [];
  for (const [key, R] of Object.entries(rows)) {
    const cx = (C0 + 1) * 16 + 8;
    const cy = R * 16 - 10;
    const meta = await window.__swFlow.spawnVanillaEnemy(617, cx, cy);
    const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
    if (e) {
      e.ai0 = 1; e.ai1 = 900; e.ai2 = 0; e.ai3 = 0;
      e.lai3 = -1; e.facing = 1; e.vx = 0.5; e.vy = 0;
      e.critterHomeX = C0 + 13;
      out.push({ key, id: e.id });
    }
  }
  return out;
}, { C0: setup.C0, rows: setup.rows });
L.chk('617×9 生成', spawns.length === 9, JSON.stringify(spawns));

// ---- 逐 tick 采样 600t + facing 写入栈陷阱 ----
const telem = await page.evaluate(async ({ ids }) => {
  const g = window.__swGame;
  const N = 600, STEP = 50;
  const logs = {};
  for (const s of ids) logs[s.key] = [];
  // ★facing 写入陷阱:捕获写入栈(限 200 条环带)
  const flipLog = {};
  for (const s of ids) {
    flipLog[s.key] = [];
    let fv = null;
    const e0 = (g.entities.enemies ?? []).find((en) => en.id === s.id);
    if (e0) {
      fv = e0.facing;
      const rec = flipLog[s.key];
      Object.defineProperty(e0, 'facing', {
        configurable: true,
        get() { return fv; },
        set(v) {
          if (v !== fv && rec.length < 400) {
            rec.push({ t: logs[s.key].length + 1, from: fv, to: v,
              stack: (new Error().stack ?? '').split('\n').slice(1, 4).map((l) => l.trim()).join(' <= ') });
          }
          fv = v;
        },
      });
    }
  }
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
          gr: e.onGround ? 1 : 0, wet: e.wet ? 1 : 0, a0: e.ai0, a1: e.ai1, f: e.facing,
        });
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  // ---- 事件提炼 ----
  const events = {};
  for (const s of ids) {
    const log = logs[s.key];
    const ev = [];
    let airFrom = -1, lastF = null, lastX = null, stillT = 0, stillMarked = false;
    for (const k of log) {
      if (k.vy < -0.01 && airFrom < 0) { airFrom = k.t; ev.push({ t: k.t, e: 'jump', vy: k.vy, vx: k.vx, x: k.x }); }
      else if (k.vy > 0.05 && k.gr === 0 && airFrom < 0) { airFrom = k.t; ev.push({ t: k.t, e: 'fall', vy: k.vy, x: k.x, y: k.y, wet: k.wet }); }
      if (airFrom >= 0 && k.gr) { ev.push({ t: k.t, e: 'land', x: k.x, y: k.y, vx: k.vx, wet: k.wet, airT: k.t - airFrom }); airFrom = -1; }
      if (lastF !== null && k.f !== lastF) ev.push({ t: k.t, e: 'turn', f: k.f, x: k.x, wet: k.wet, gr: k.gr });
      lastF = k.f;
      if (k.a0 === 1) {
        if (lastX !== null && Math.abs(k.x - lastX) < 0.01) { stillT++; if (stillT === 30 && !stillMarked) { ev.push({ t: k.t, e: 'stuck30', x: k.x, vx: k.vx, f: k.f, y: k.y }); stillMarked = true; } }
        else { stillT = 0; stillMarked = false; }
        lastX = k.x;
      } else { lastX = null; stillT = 0; stillMarked = false; }
    }
    events[s.key] = ev;
  }
  return { events, flips: flipLog, tail: Object.fromEntries(Object.entries(logs).map(([k, v]) => [k, v.slice(-4)])) };
}, { ids: spawns });

for (const [key, ev] of Object.entries(telem.events)) {
  console.log(`\n=== ${key} === (${ev.length} 事件)`);
  for (const e of ev.slice(0, 18)) console.log(' ', JSON.stringify(e));
  if (ev.length > 18) console.log(`  …共 ${ev.length} 事件(尾 3:${JSON.stringify(ev.slice(-3))})`);
}
console.log('\n=== facing 写入栈(振荡签名=10t 内≥3 次;每轨道首 6 条+振荡代表) ===');
for (const [key, rec] of Object.entries(telem.flips)) {
  // 振荡检测:任意滑窗 10 条内 5 次翻转
  let osc = null;
  for (let i = 4; i < rec.length; i++) if (rec[i].t - rec[i - 4].t <= 10) { osc = rec.slice(i - 2, i + 3); break; }
  const head = rec.slice(0, 6);
  console.log(`${key}: n=${rec.length} ${osc ? 'OSC!!' : ''}`);
  for (const h of head) console.log('  ', JSON.stringify(h));
  if (osc) for (const o of osc) console.log('  OSC', JSON.stringify(o));
}
console.log('\n=== 尾段(末 4 拍) ===');
for (const [key, v] of Object.entries(telem.tail)) console.log(key, JSON.stringify(v));

await browser.close();
console.log('DONE');
