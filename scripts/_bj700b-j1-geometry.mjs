// ★BJ700b J1 振荡点几何定谳:复现 J1 振荡,导出 t3/t4/t5/净空窗全部输入 + 原版判据推演。
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
  // J1 同点位:col 1148 (x=18381), ground row 276
  const tx = 1148;
  let ground = -1;
  for (let y = 180; y < 340; y++) {
    if (st.isSolid(tx, y) && !st.isSolid(tx, y - 1) && !st.isSolid(tx, y - 2)
      && st.liquid[st.idx(tx, y - 1)] === 0) { ground = y; break; }
  }
  const meta = await window.__swFlow.spawnVanillaEnemy(617, tx * 16 + 8, ground * 16 - 10);
  const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
  if (!e) return { ok: false, ground };
  // 泵 40t 到振荡稳态
  for (let t = 0; t < 40; t++) g.fixedUpdate(1 / 60);
  const TILE = 16;
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
    return c + (liq ? '~' : '') + `(${typ})`;
  };
  // 稳态几何快照
  const y0 = e.y, x0 = e.x;
  const num27 = Math.floor((e.y + e.h - 16) / TILE);
  const colL = Math.floor(e.cx / TILE) - 5, colR = Math.floor(e.cx / TILE) + 5;
  const rowTop = num27 + 3, rowBot = num27 - 7;
  const geo = [];
  for (let y = rowTop; y >= rowBot; y--) {
    geo.push(`r${y}: ` + Array.from({ length: colR - colL + 1 }, (_, i) => tileChar(colL + i, y)).join(' '));
  }
  // 两个朝向的分支输入
  const probe = (facing) => {
    const num26 = Math.floor((e.x + e.w / 2 + 15 * facing) / TILE);
    const t3 = { c: num26, r: num27 };
    const t4 = { c: num26, r: num27 - 1 };
    const t5 = { c: num26, r: num27 - 2 };
    const solidAt = (x, y) => {
      if (!st.inBounds(x, y)) return true;
      const i = st.idx(x, y);
      return st.isActive(x, y) && st.isSolid(x, y) && !st.isPlatform(x, y);
    };
    const solidTiles = (x1, x2, y1, y2) => {
      if (Math.min(x1, x2) < 0 || Math.max(x1, x2) >= st.w || Math.min(y1, y2) < 0 || Math.max(y1, y2) >= st.h - 40) return true;
      for (let i = Math.min(x1, x2); i <= Math.max(x1, x2); i++) for (let j = Math.min(y1, y2); j <= Math.max(y1, y2); j++) if (solidAt(i, j)) return true;
      return false;
    };
    const clr1 = solidTiles(num26 - facing * 2, num26 - facing, num27 - 5, num27 - 1);
    const clr2 = solidTiles(num26, num26, num27 - 5, num27 - 3);
    return {
      facing, num26, num27, sunk: +(e.y + e.h - num27 * TILE).toFixed(1),
      t3: tileChar(t3.c, t3.r), t4: tileChar(t4.c, t4.r), t5: tileChar(t5.c, t5.r),
      t3Solid: solidAt(t3.c, t3.r), t4Solid: solidAt(t4.c, t4.r), t5Solid: solidAt(t5.c, t5.r),
      clr1Blocked: clr1, clr2Blocked: clr2,
      clr1Cells: (() => { const cells = []; for (let i = Math.min(num26 - facing * 2, num26 - facing); i <= Math.max(num26 - facing * 2, num26 - facing); i++) for (let j = num27 - 5; j <= num27 - 1; j++) if (solidAt(i, j)) cells.push(`(${i},${j})${tileChar(i, j)}`); return cells; })(),
      clr2Cells: (() => { const cells = []; for (let j = num27 - 5; j <= num27 - 3; j++) if (solidAt(num26, j)) cells.push(`(${num26},${j})${tileChar(num26, j)}`); return cells; })(),
    };
  };
  return {
    ok: true, ground, x0: +x0.toFixed(1), y0: +y0.toFixed(1), w: e.w, h: e.h,
    cx: +e.cx.toFixed(1), bottom: +(e.y + e.h).toFixed(1),
    gr: e.onGround ? 1 : 0, wet: e.wet ? 1 : 0, a0: e.ai0, f: e.facing, vx: e.vx, vy: e.vy,
    geo, colL, colR, rowTop, rowBot,
    probePlus: probe(1), probeMinus: probe(-1),
  };
});

console.log(JSON.stringify({ ok: out.ok, ground: out.ground, x0: out.x0, y0: out.y0, w: out.w, h: out.h, cx: out.cx, bottom: out.bottom, gr: out.gr, wet: out.wet, a0: out.a0, f: out.f, vx: out.vx, vy: out.vy }, null, 1));
console.log(`\n几何图 (cols ${out.colL}..${out.colR}, X=龟列):`);
const ecol = Math.floor(out.cx / 16);
for (const line of out.geo) {
  const r = +line.match(/^r(\d+):/)[1];
  const cols = line.split(': ')[1].split(' ');
  const marks = cols.map((c, i) => (colLValue(out, i) === ecol ? '🐢' : c));
  console.log('  ' + line.split(': ')[0] + ' ' + marks.join(' '));
}
function colLValue(o, i) { return o.colL + i; }
console.log('\nfacing=+1 分支输入:', JSON.stringify(out.probePlus, null, 1));
console.log('\nfacing=-1 分支输入:', JSON.stringify(out.probeMinus, null, 1));

await browser.close();
console.log('DONE');
