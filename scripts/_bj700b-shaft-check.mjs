// 检查 col 1189-1193 rows 235-540 是否存在真竖井(空气柱)
import { launchBrowser, openPage, bootstrap, createGame } from '../tools/probe/lib/index.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
const out = await page.evaluate(() => {
  const st = window.__swGame.world.store;
  const cols = [1188, 1189, 1190, 1191, 1192, 1193];
  const rows = [];
  for (let y = 236; y <= 545; y++) {
    const chars = cols.map((x) => {
      if (!st.inBounds(x, y)) return '?';
      const i = st.idx(x, y);
      if (!st.isActive(x, y)) return '-';
      if (st.isSolid(x, y)) return st.isPlatform(x, y) ? 'P' : 'S';
      if (st.isPlatform(x, y)) return 'p';
      return st.liquid[i] ? '~' : '.';
    });
    rows.push(`r${y}: ${chars.join('')}`);
  }
  // 压缩连续同构行
  const comp = [];
  let last = null, n = 0;
  for (const r of rows) {
    const body = r.slice(4);
    if (body === last) n++;
    else { if (last !== null) comp.push(`${r.slice(0, 4)}×${n + 1}: ${last}`); last = body; n = 0; }
  }
  comp.push(`last ×${n + 1}: ${last}`);
  return comp;
});
for (const line of out) console.log(line);
await browser.close();
