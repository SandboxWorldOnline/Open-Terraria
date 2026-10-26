// BJ721-A 探针 v3：真实世界门扫描——生成世界里逐扇打开所有 gen 门（真实门道几何/
// 真实邻居/真实液体环境），长窗观察是否出现「开门即拆+掉落」。
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
  const { T } = await import('/src/data/tiles.ts');
  const T10 = T.DOOR_CLOSED, T11 = T.DOOR_OPEN;
  const out = { doors: [], killed: [] };

  const btLog = [], dropLog = [];
  const origBT = g.breakTile.bind(g);
  g.breakTile = (x, y, ...a) => { btLog.push({ x, y }); return origBT(x, y, ...a); };
  const origSD = g.spawnDrop.bind(g);
  g.spawnDrop = (x, y, key, ...a) => { dropLog.push({ x: Math.round(x / 16), y: Math.round(y / 16), key }); return origSD(x, y, key, ...a); };

  // 全图找闭门（顶格=frameY%54==0 且上格也同型）
  const doors = [];
  for (let x = 6; x < st.w - 6 && doors.length < 400; x++) {
    for (let y = 6; y < st.h - 6; y++) {
      const i = st.idx(x, y);
      if (st.type[i] !== T10) continue;
      if (st.frameY[i] % 54 !== 0) continue;
      if (st.type[st.idx(x, y + 1)] !== T10 || st.type[st.idx(x, y + 2)] !== T10) continue;
      // 上下文画像
      const liq = (cx, cy) => { const j = st.idx(cx, cy); return st.liquid[j] > 0 ? st.liquidType[j] : 0; };
      const ctx = {
        ceil: st.type[st.idx(x, y - 1)], floor: st.type[st.idx(x, y + 3)],
        wall: st.wall[i],
        liqL: [liq(x - 1, y), liq(x - 1, y + 1), liq(x - 1, y + 2)],
        liqR: [liq(x + 1, y), liq(x + 1, y + 1), liq(x + 1, y + 2)],
        liqSelf: [liq(x, y), liq(x, y + 1), liq(x, y + 2)],
        fx: st.frameX[i], fy: st.frameY[i],
      };
      doors.push({ x, y, ctx });
      y += 3;
    }
  }
  out.total = doors.length;

  // 逐扇开（传送玩家到门旁，右键中格 interactAt，长窗 1.2s）
  for (let k = 0; k < doors.length; k++) {
    const d = doors[k];
    btLog.length = 0; dropLog.length = 0;
    // 玩家放门左侧 2 格（若有堵则无所谓——开门只看 facing 与清位列）
    g.player.x = (d.x - 2) * 16 + 4; g.player.y = d.y * 16;
    g.player.vx = 0; g.player.vy = 0; g.player.facing = 1;
    g.player.position = undefined; // 防御：清可能的旧引用
    g.interactAt(d.x, d.y + 1);
    await new Promise(r => setTimeout(r, 1200));
    const i0 = st.idx(d.x, d.y);
    const after = [st.type[i0], st.type[st.idx(d.x, d.y + 1)], st.type[st.idx(d.x, d.y + 2)]];
    const opened = after[0] === T11 || after[1] === T11 || after[2] === T11;
    const stillClosed = after[0] === T10 && after[1] === T10 && after[2] === T10;
    const entry = {
      k, x: d.x, y: d.y, opened, stillClosed, after,
      broke: btLog.filter(b => Math.abs(b.x - d.x) <= 2 && Math.abs(b.y - d.y) <= 4),
      drops: dropLog.filter(dd => Math.abs(dd.x - d.x) <= 3 && Math.abs(dd.y - d.y) <= 5),
      ctx: d.ctx,
    };
    out.doors.push({ k, x: d.x, y: d.y, opened, stillClosed, nBroke: entry.broke.length, drops: entry.drops.map(z => z.key), ctx: d.ctx });
    if (!opened && !stillClosed || entry.broke.length || entry.drops.length) out.killed.push(entry);
    // 关回去（若开着），减少世界状态漂移
    if (opened) { g.interactAt(d.x, d.y + 1); await new Promise(r => setTimeout(r, 150)); }
    // 传送玩家远离，防站立干扰下一扇
    g.player.x = (d.x - 20) * 16; g.player.y = (d.y - 10) * 16;
  }
  g.breakTile = origBT; g.spawnDrop = origSD;
  return out;
});
console.log(`total doors: ${res.total}, killed/anomalous: ${res.killed.length}`);
for (const k of res.killed) {
  console.log(`!! door#${k.k} @(${k.x},${k.y}) opened=${k.opened} stillClosed=${k.stillClosed} after=[${k.after}] broke=${JSON.stringify(k.broke)} drops=${JSON.stringify(k.drops)}`);
  console.log(`   ctx: ${JSON.stringify(k.ctx)}`);
}
// 分布统计
const openedN = res.doors.filter(d => d.opened).length;
const closedN = res.doors.filter(d => d.stillClosed).length;
console.log(`opened=${openedN} stillClosed=${closedN} other=${res.total - openedN - closedN}`);
const liqDoors = res.doors.filter(d => d.ctx.liqL.some(v => v > 0) || d.ctx.liqR.some(v => v > 0) || d.ctx.liqSelf.some(v => v > 0));
console.log(`doors with adjacent liquid: ${liqDoors.length}`, liqDoors.slice(0, 8).map(d => `#${d.k}@${d.x},${d.y} L${d.ctx.liqL} R${d.ctx.liqR} self${d.ctx.liqSelf} open=${d.opened}`).join(' | '));
await browser.close();
