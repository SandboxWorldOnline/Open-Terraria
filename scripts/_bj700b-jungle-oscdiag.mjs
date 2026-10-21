// ★BJ700b 振荡定谳探针:真实丛林 617 落地后每拍掉头——几何快照+facing 写入栈陷阱。
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
  let jx = w.jungleX;
  if (!jx) {
    outer: for (let x = 20; x < st.w - 20; x += 10) {
      for (let y = Math.floor(st.h * 0.25); y < Math.floor(st.h * 0.5); y++) {
        const t = st.type[st.idx(x, y)];
        if (t === 60 || t === 661 || t === 662) { jx = x; break outer; }
      }
    }
  }
  const surfaceY = (() => { for (let y = Math.floor(st.h * 0.2); y < st.h; y++) { let solid = 0; for (let d = -3; d <= 3; d++) { if (st.isSolid(jx + d, y)) solid++; } if (solid >= 5) return y; } return -1; })();
  p.x = jx * 16; p.y = (surfaceY - 8) * 16; p.vx = 0; p.vy = 0;
  return { jx, surfaceY };
});
L.chk('丛林定位', setup.surfaceY > 0, JSON.stringify(setup));

const diag = await page.evaluate(async ({ jx, surfaceY }) => {
  const g = window.__swGame;
  const st = g.world.store;
  const meta = await window.__swFlow.spawnVanillaEnemy(617, (jx - 4) * 16 + 8, (surfaceY - 2) * 16);
  const e = meta ? (g.entities.enemies ?? []).find((en) => en.id === meta.id) : null;
  if (!e) return { ok: false };
  // facing 写入陷阱
  const flips = [];
  let fv = e.facing;
  Object.defineProperty(e, 'facing', {
    configurable: true,
    get() { return fv; },
    set(v) {
      if (v !== fv && flips.length < 12) {
        flips.push({ t: flips._t ?? 0, from: fv, to: v, stack: (new Error().stack ?? '').split('\n').slice(1, 4).map((l) => l.trim()).join(' <= ') });
      }
      fv = v;
    },
  });
  const snap = [];
  const tileInfo = (x, y) => {
    if (!st.inBounds(x, y)) return 'OoB';
    const i = st.idx(x, y);
    const act = st.isActive(x, y);
    const sol = st.isSolid(x, y);
    const plat = st.isPlatform(x, y);
    const sl = st.slope[i];
    const half = st.half[i];
    const liq = st.liquid[i];
    return `${act ? (sol ? (plat ? 'SP' : sl ? `S${sl}` : half ? 'SH' : 'S') : plat ? 'P' : 'A') : '-'}${liq ? `L${liq}` : ''}`;
  };
  for (let t = 1; t <= 60; t++) {
    g.fixedUpdate(1 / 60);
    flips._t = t;
    if (t >= 8 && t <= 14) {
      const cx = Math.floor((e.x + e.w / 2 + 15 * e.facing) / 16);
      const num27 = Math.floor((e.y + e.h - 16) / 16);
      // 几何快照:龟所在列±3,行 num27-3..num27+2
      const geo = [];
      const ecol = Math.floor(e.cx / 16);
      for (let y = num27 + 2; y >= num27 - 3; y--) {
        const row = [];
        for (let x = ecol - 3; x <= ecol + 3; x++) row.push(tileInfo(x, y));
        geo.push(`r${y}: ${row.join(' ')}`);
      }
      snap.push({
        t, x: +e.x.toFixed(1), y: +e.y.toFixed(1), vx: +e.vx.toFixed(2), vy: +e.vy.toFixed(2),
        gr: e.onGround ? 1 : 0, wet: e.wet ? 1 : 0, a0: e.ai0, f: e.facing,
        num27, sunk: +(e.y + e.h - num27 * 16).toFixed(1),
        aheadCol: cx, geo,
      });
    }
  }
  return { ok: true, snaps: snap, flips, x: +e.x.toFixed(1), y: +e.y.toFixed(1), f: e.facing };
}, setup);

console.log('终态:', JSON.stringify({ x: diag.x, y: diag.y, f: diag.f }));
for (const s of diag.snaps.slice(0, 4)) {
  console.log(`\nt=${s.t} x=${s.x} y=${s.y} vx=${s.vx} vy=${s.vy} gr=${s.gr} wet=${s.wet} a0=${s.a0} f=${s.f} num27=${s.num27} sunk=${s.sunk} ahead=${s.aheadCol}`);
  for (const r of s.geo) console.log('   ', r);
}
console.log('\nfacing 写入栈:');
for (const f of diag.flips.slice(0, 6)) console.log(' ', JSON.stringify(f));

await browser.close();
console.log('DONE');
