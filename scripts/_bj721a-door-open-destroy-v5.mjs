// BJ721-A 探针 v5：复刻 v3 全序列 + breakTile 全量栈捕获 → 定谳真凶调用链。
import puppeteer from 'puppeteer-core';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5259';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1360, height: 860 } });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__swFlow?.newWorld, { timeout: 120000 });
await page.evaluate(() => window.__swFlow.newWorld('721723', 1200, 800));
await page.waitForFunction(() => window.__swGame?.player, { timeout: 300000 });
await new Promise(r => setTimeout(r, 2500));
const res = await page.evaluate(async () => {
  const g = window.__swGame;
  const st = g.world.store;
  const { T, TILE_DEFS } = await import('/src/data/tiles.ts');
  const T10 = T.DOOR_CLOSED, T11 = T.DOOR_OPEN;
  const out = { kills: [] };

  const btLog = [];
  const origBT = g.breakTile.bind(g);
  g.breakTile = (x, y, ...a) => {
    btLog.push({ x, y, stack: (new Error().stack || '').split('\n').slice(1, 8).join('\n  ') });
    return origBT(x, y, ...a);
  };
  const dropLog = [];
  const origSD = g.spawnDrop.bind(g);
  g.spawnDrop = (x, y, key, ...a) => { dropLog.push({ x: Math.round(x / 16), y: Math.round(y / 16), key }); return origSD(x, y, key, ...a); };

  const doors = [];
  for (let x = 6; x < st.w - 6 && doors.length < 400; x++) {
    for (let y = 6; y < st.h - 6; y++) {
      const i = st.idx(x, y);
      if (st.type[i] !== T10) continue;
      if (st.frameY[i] % 54 !== 0) continue;
      if (st.type[st.idx(x, y + 1)] !== T10 || st.type[st.idx(x, y + 2)] !== T10) continue;
      doors.push({ x, y, fy: st.frameY[i], fx: st.frameX[i] });
      y += 3;
    }
  }
  out.total = doors.length;

  for (let k = 0; k < doors.length; k++) {
    const d = doors[k];
    btLog.length = 0; dropLog.length = 0;
    g.player.x = (d.x - 2) * 16 + 4; g.player.y = d.y * 16;
    g.player.vx = 0; g.player.vy = 0; g.player.facing = 1;
    g.interactAt(d.x, d.y + 1);
    await new Promise(r => setTimeout(r, 1200));
    const i0 = st.idx(d.x, d.y);
    const after = [st.type[i0], st.type[st.idx(d.x, d.y + 1)], st.type[st.idx(d.x, d.y + 2)]];
    const opened = after.includes(T11);
    const stillClosed = after[0] === T10 && after[1] === T10 && after[2] === T10;
    if ((!opened && !stillClosed) || btLog.length || dropLog.length) {
      // 门域 7×8 全量画像（tile sheet + 液体）
      const pic = [];
      for (let dy = -2; dy <= 5; dy++) {
        const cells = [];
        for (let dx = -2; dx <= 3; dx++) {
          const i = st.idx(d.x + dx, d.y + dy);
          const sh = TILE_DEFS[st.type[i]]?.vanilla?.sheet ?? -1;
          const liq = st.liquid[i] > 0 ? `/L${st.liquidType[i]}:${st.liquid[i]}` : '';
          cells.push(`${sh}${liq}`);
        }
        pic.push(`y${d.y + dy}: ${cells.join(' ')}`);
      }
      out.kills.push({
        k, x: d.x, y: d.y, fy: d.fy, fx: d.fx, opened, stillClosed, after,
        bt: btLog.map(b => ({ x: b.x, y: b.y })),
        drops: dropLog.map(z => `${z.key}@${z.x},${z.y}`),
        stacks: btLog.map(b => `(${b.x},${b.y})\n  ${b.stack}`),
        pic,
      });
    }
    if (opened) { g.interactAt(d.x, d.y + 1); await new Promise(r => setTimeout(r, 150)); }
    g.player.x = (d.x - 20) * 16; g.player.y = (d.y - 10) * 16;
  }
  g.breakTile = origBT; g.spawnDrop = origSD;
  return out;
});
console.log(`total=${res.total} kills=${res.kills.length}`);
for (const k of res.kills) {
  console.log(`\n===== door#${k.k} @(${k.x},${k.y}) fy=${k.fy} fx=${k.fx} opened=${k.opened} stillClosed=${k.stillClosed} after=[${k.after}]`);
  console.log(`bt=${JSON.stringify(k.bt)} drops=${JSON.stringify(k.drops)}`);
  console.log(k.pic.join('\n'));
  console.log('stacks:\n' + k.stacks.join('\n---\n'));
}
await browser.close();
