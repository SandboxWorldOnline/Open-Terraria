// ★gladd 面③ R2 残差身份探针:主簇(2070-2080,872-881)+副簇(2114,845)的
// tile 普查(找 crimtane 204/液体)+A 臂 __SW_SHINE_OFF 开关对照(红是否=脉动支)
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=600000 scripts/_gladd-shine-whatisthis.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { freezeClock } from '../tools/probe/lib/clock.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
if (!gen?.ok) { console.log('createGame FAIL', gen?.why); process.exit(1); }
await pump(page, 60);
await page.evaluate(() => {
  const g = window.__swGame;
  g.lighting.compute = () => {};
  const noop = () => {};
  try { g.world.liquid && (g.world.liquid.update = noop); } catch { /* 域差异 */ }
  g.vanillaDust && (g.vanillaDust.update = noop);
  g.evolution && (g.evolution.update = noop);
  g.vanillaSpawner && (g.vanillaSpawner.update = noop);
  g.entities.critters.length = 0; g.entities.enemies.length = 0; g.entities.drops.length = 0;
  window.__swGame.running = false;
});
await freezeClock(page, { tod: 0.5 });

// 传送(同 strict:玩家 (2102-3, 864+3) 站位,相机同位)——不注入,纯地形普查
const census = await page.evaluate(() => {
  const g = window.__swGame;
  g.player.x = (2102 - 3) * 16;
  g.player.y = (864 + 3) * 16 - g.player.h - 1;
  g.camera.x = g.player.x + g.player.w / 2;
  g.camera.y = g.player.y + g.player.h / 2;
  const st = g.world.store;
  const scan = (x0, x1, y0, y1, tag) => {
    const counts = new Map();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!st.inBounds(x, y)) continue;
        const i = st.idx(x, y);
        const key = st.liquid[i] > 0 ? `${st.type[i]}+liq${st.liquid[i]}` : `${st.type[i]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, n]) => {
        const t = parseInt(k);
        const d = window.__swTileDefById(t);
        return `${k}(sheet=${d?.sheet ?? '?'} ${d?.key ?? '?'}):${n}`;
      });
    console.log(`${tag}: ${rows.join(' | ')}`);
    return rows;
  };
  // 扩一圈:主簇 tiles ±2
  const main = scan(2068, 2082, 870, 883, '主簇(2068-2082, 870-883)');
  const sub = scan(2110, 2118, 841, 849, '副簇(2110-2118, 841-849)');
  // crimtane(204)/氯绿素(211) 全屏视野普查
  let n204 = 0, n211 = 0; const p204 = [];
  for (let y = 840; y <= 890; y++)
    for (let x = 2060; x <= 2130; x++) {
      if (!st.inBounds(x, y)) continue;
      const t = st.type[st.idx(x, y)];
      if (t === 204) { n204++; if (p204.length < 12) p204.push(`${x},${y}`); }
      if (t === 211) n211++;
    }
  return { main, sub, n204, n211, p204 };
});
console.log('crimtane(204) 视野计数:', census.n204, 'positions:', census.p204.join(' '));
console.log('chlorophyte(211) 计数:', census.n211);

// ---- A 臂红源对照:__SW_SHINE_OFF 前后主簇/副簇像素 ----
const warm = await page.evaluate(() => {
  const g = window.__swGame;
  const r = g.renderer;
  r['flushItemGlowGL'] = function () { this.itemGlowQueue = []; this.itemGlowHeldCollected = new WeakSet(); return true; };
  return !!r.acquireCloudPipe();
});
for (let i = 0; i < 25; i++) {
  await page.evaluate(() => {
    const g = window.__swGame;
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
  });
}
async function regionDump() {
  return page.evaluate(() => {
    const c = window.__swGame.renderer.canvas;
    const lx = c.getContext('2d');
    const grab = (x0, y0, x1, y1) => {
      const d = lx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
      let n = 0, s = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 30 && d[i + 1] < d[i] * 0.6 && d[i + 2] < d[i] * 0.6) { n++; s += d[i]; }
      }
      return { redPx: n, sumR: s };
    };
    return { main: grab(166, 501, 333, 660), sub: grab(870, 69, 877, 84) };
  });
}
const before = await regionDump();
await page.evaluate(() => { globalThis.__SW_SHINE_OFF = true; });
await page.evaluate(() => {
  const g = window.__swGame;
  window.__vnow += 16.6667;
  g.frame(window.__vnow);
});
const after = await regionDump();
await page.evaluate(() => { globalThis.__SW_SHINE_OFF = false; });
console.log('SHINE_OFF 前:', JSON.stringify(before));
console.log('SHINE_OFF 后:', JSON.stringify(after));
console.log('→ 红源=shine 通道?', after.main.redPx < before.main.redPx * 0.1 && after.sub.redPx < before.sub.redPx * 0.1 ? '是(脉动支/烘焙层任一)' : '否(另有来源)');
await browser.close();
