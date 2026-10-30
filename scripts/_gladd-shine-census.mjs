// ★gladd 面③ R2 残差 tile 普查(Node 侧打印版)
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=300000 scripts/_gladd-shine-census.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261028 });
await pump(page, 30);
const census = await page.evaluate(() => {
  const g = window.__swGame;
  const st = g.world.store;
  const scan = (x0, x1, y0, y1, tag) => {
    const counts = new Map();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!st.inBounds(x, y)) continue;
        const i = st.idx(x, y);
        const lq = st.liquid[i] > 0 ? `+liq${st.liquid[i]}` : '';
        const key = `${st.type[i]}${lq}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    return [tag, [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, n]) => {
        const t = parseInt(k);
        const d = window.__swTileDefById(t);
        return `${k}(s=${d?.sheet ?? '?'} ${d?.key ?? '?'}):${n}`;
      })];
  };
  return [
    scan(2068, 2082, 870, 883, '主簇'),
    scan(2110, 2118, 841, 849, '副簇'),
  ];
});
for (const [tag, rows] of census) console.log(`${tag}: ${rows.join(' | ')}`);
await browser.close();
