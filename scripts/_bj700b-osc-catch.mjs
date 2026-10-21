// ★BJ700b 振荡触捕:泵到 facing 10t 内≥5 翻转(振荡签名)时,快照几何+双朝向分支输入。
import { launchBrowser, openPage, bootstrap, createGame, ledger, freezeClock } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const L = ledger();

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 80));
await freezeClock(page, { tod: 0.345 });

const out = await page.evaluate(async () => {
  const g = window.__swGame;
  const w = g.world;
  const st = w.store;
  const p = g.player;
  p.debugGod = true;
  const jx = w.jungleX || 1154;
  const TILE = 16;
  const spots = [];
  // 在丛林区扫 8 个候选放置点(逐列真地表)
  for (let k = 0; k < 5; k++) {
    const tx = jx - 12 + k * 7;
    let ground = -1;
    for (let y = 180; y < 340; y++) {
      if (st.isSolid(tx, y) && !st.isSolid(tx, y - 1) && !st.isSolid(tx, y - 2)
        && st.liquid[st.idx(tx, y - 1)] === 0) { ground = y; break; }
    }
    if (ground > 0) spots.push({ tx, ground });
  }
  const results = [];
  for (const spot of spots) {
    const meta = await window.__swFlow.spawnVanillaEnemy(617, spot.tx * TILE + 8, spot.ground * TILE - 10);
    const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
    if (!e) continue;
    // 振荡检测:记录 facing 翻转 tick 序列
    const flipTicks = [];
    let lf = e.facing;
    let caught = null;
    for (let t = 1; t <= 3600 && !caught; t++) {
      g.fixedUpdate(1 / 60);
      if (e.facing !== lf) { flipTicks.push(t); lf = e.facing; }
      if (flipTicks.length >= 5 && t - flipTicks[flipTicks.length - 5] <= 10) {
        // 振荡!快照
        const tileChar = (x, y) => {
          if (!st.inBounds(x, y)) return '?';
          const i = st.idx(x, y);
          const act = st.isActive(x, y);
          const sol = st.isSolid(x, y);
          const plat = st.isPlatform(x, y);
          const sl = st.slope[i];
          const half = st.half[i];
          const actuated = !!(st.wire[i] & 32);
          const liq = st.liquid[i];
          const typ = st.type[i];
          let c = act ? (sol ? (plat ? 'P' : sl ? `${sl}` : half ? 'h' : 'S') : plat ? 'p' : '.') : '-';
          if (actuated) c = c.toLowerCase();
          return { c, typ, liq };
        };
        const num27 = Math.floor((e.y + e.h - 16) / TILE);
        const ecol = Math.floor(e.cx / TILE);
        const colL = ecol - 5, colR = ecol + 5;
        const geo = [];
        for (let y = num27 + 3; y >= num27 - 7; y--) {
          geo.push(`r${y}: ` + Array.from({ length: colR - colL + 1 }, (_, i) => {
            const q = tileChar(colL + i, y);
            return (colL + i === ecol ? '[' + q.c + ']' : q.c) + (q.liq ? '~' : '');
          }).join(' '));
        }
        const probe = (facing) => {
          const num26 = Math.floor((e.x + e.w / 2 + 15 * facing) / TILE);
          const solidAt = (x, y) => {
            if (!st.inBounds(x, y)) return true;
            return st.isActive(x, y) && st.isSolid(x, y) && !st.isPlatform(x, y);
          };
          const solidTiles = (x1, x2, y1, y2) => {
            if (Math.min(x1, x2) < 0 || Math.max(x1, x2) >= st.w || Math.min(y1, y2) < 0 || Math.max(y1, y2) >= st.h - 40) return true;
            for (let i = Math.min(x1, x2); i <= Math.max(x1, x2); i++) for (let j = Math.min(y1, y2); j <= Math.max(y1, y2); j++) if (solidAt(i, j)) return true;
            return false;
          };
          const cells = (x1, x2, y1, y2) => {
            const cells = [];
            for (let i = Math.min(x1, x2); i <= Math.max(x1, x2); i++) for (let j = Math.min(y1, y2); j <= Math.max(y1, y2); j++) if (solidAt(i, j)) cells.push(`(${i},${j})t${st.type[st.idx(i, j)]}`);
            return cells;
          };
          return {
            facing, num26,
            t3: tileChar(num26, num27).c, t4: tileChar(num26, num27 - 1).c, t5: tileChar(num26, num27 - 2).c,
            t3Solid: solidAt(num26, num27), t4Solid: solidAt(num26, num27 - 1), t5Solid: solidAt(num26, num27 - 2),
            clr1: solidTiles(num26 - facing * 2, num26 - facing, num27 - 5, num27 - 1),
            clr2: solidTiles(num26, num26, num27 - 5, num27 - 3),
            clr1Cells: cells(num26 - facing * 2, num26 - facing, num27 - 5, num27 - 1),
            clr2Cells: cells(num26, num26, num27 - 5, num27 - 3),
          };
        };
        caught = {
          t, x: +e.x.toFixed(1), y: +e.y.toFixed(1), bottom: +(e.y + e.h).toFixed(1),
          cx: +e.cx.toFixed(1), num27, sunk: +(e.y + e.h - num27 * TILE).toFixed(1),
          gr: e.onGround ? 1 : 0, wet: e.wet ? 1 : 0, a0: e.ai0, f: e.facing, vx: +e.vx.toFixed(2), vy: +e.vy.toFixed(2),
          flipTicks: flipTicks.slice(-8), geo, ecol,
          probePlus: probe(1), probeMinus: probe(-1),
        };
      }
    }
    results.push({ spot, flips: flipTicks.length, caught });
  }
  return results;
});

for (const r of out) {
  console.log(`\n== spot col=${r.spot.tx} ground=${r.spot.ground} 翻转数=${r.flips} ${r.caught ? '★振荡捕获' : ''}`);
  if (r.caught) {
    const c = r.caught;
    console.log(`  t=${c.t} x=${c.x} y=${c.y} bottom=${c.bottom} 龟列=${c.ecol} num27=${c.num27} sunk=${c.sunk} gr=${c.gr} wet=${c.wet} a0=${c.a0} f=${c.f} vx=${c.vx} vy=${c.vy}`);
    for (const line of c.geo) console.log('   ' + line);
    console.log('  probe+1:', JSON.stringify(c.probePlus));
    console.log('  probe-1:', JSON.stringify(c.probeMinus));
  }
}

await browser.close();
console.log('DONE');
