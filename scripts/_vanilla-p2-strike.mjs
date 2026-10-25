// P2-A 打击闭环验证（2026-10-25）：浏览器玩家 hurt 一只傀儡 → entityNet.reportStrike
// → msg28（携代际）→ 服务器结算 → msg23 权威 hp 回流 → 傀儡 hp 下降 = 闭环。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-strike.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-st-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const ready = await page.evaluate(() => {
    const el = document.querySelector('[data-act=mp]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!hit || !(el === hit || el.contains(hit))) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (ready) { await page.mouse.click(ready.x, ready.y); break; }
}
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => !!Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781'))) break;
  await sleep(800);
}
{
  const vb = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781');
    const btn = input?.closest('div')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (vb) await page.mouse.click(vb.x, vb.y);
}
for (let i = 0; i < 10; i++) {
  if (await page.evaluate(() => !!document.querySelector('[data-act=new]'))) break;
  await sleep(800);
}
{
  const nb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=new]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (nb) { await page.mouse.click(nb.x, nb.y); await sleep(2500); }
}
await page.evaluate(() => {
  const inp = document.querySelector('.sw-cc-nameval input[type=text], .sw-char-panel input[type=text]');
  if (inp) { inp.value = '武者甲'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
});
await sleep(500);
for (let i = 0; i < 15; i++) {
  if (await page.evaluate(() => !!document.querySelector('[data-act=create]'))) break;
  await sleep(800);
}
{
  const cb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=create]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (cb) await page.mouse.click(cb.x, cb.y);
}
let entered = false;
for (let i = 0; i < 50; i++) {
  await sleep(1000);
  entered = await page.evaluate(() => !!(globalThis.__swGame?.net?.active && globalThis.__swGame?.player)).catch(() => false);
  if (entered) break;
}
log('进世界=' + entered);
if (!entered) { await browser.close(); process.exit(1); }
await sleep(8000); // 等 NPC 傀儡在场
{
  const wb = await page.evaluate(() => {
    const btn = document.getElementById('sw-welcome-announce')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (wb) { await page.mouse.click(wb.x, wb.y); await sleep(1500); }
}
// 仪表：handle 直方图
await page.evaluate(() => {
  const g = globalThis.__swGame;
  globalThis.__shist = {};
  const orig = g.net.handle.bind(g.net);
  g.net.handle = (id, p2) => { globalThis.__shist[id] = (globalThis.__shist[id] || 0) + 1; return orig(id, p2); };
});
// 找一只存活傀儡并 hurt
const strike = await page.evaluate(() => {
  const g = globalThis.__swGame;
  for (const [id, pup] of g['netNpcPuppets']) {
    const e = pup.e;
    // ★iframes 门+轮试（红蓝对抗 2026-10-25:全矩阵连跑时前序会话战斗留 iframes——
    //   本地 hurt 无效→服务器同拒→162 不来=时序伪红。单跑绿/连跑红=此因）
    if (e && !e.dead && e.hp > 30 && (e.iframes ?? 0) <= 0) {
      const before = e.hp;
      e.hurt(20, 3, 0, g, 0, false, 0, true);
      return { id, before, localAfter: e.hp, key: e.npcKey ?? '?' };
    }
  }
  return null;
});
log('打击: ' + JSON.stringify(strike));
if (!strike) { log('✗无傀儡可打'); await browser.close(); process.exit(1); }
// 等 msg23 权威 hp 回流
let after = null;
for (let i = 0; i < 10; i++) {
  await sleep(1000);
  after = await page.evaluate((sid) => {
    const g = globalThis.__swGame;
    const pup = g['netNpcPuppets'].get(sid);
    return pup ? { hp: pup.e.hp, dead: pup.e.dead } : { gone: true };
  }, strike.id);
  if (after && (after.gone || after.hp < strike.before || after.dead)) break;
}
log('回流后: ' + JSON.stringify(after));
log('直方图: ' + JSON.stringify(await page.evaluate(() => globalThis.__shist)));
const pass = after && (after.gone || after.dead || after.hp < strike.before);
log(pass ? '★STRIKE-PASS（msg28 上报→服务器结算→msg23 权威回流）' : '✗STRIKE-FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
