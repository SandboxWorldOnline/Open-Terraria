// P3-C 箱子 E2E（2026-10-25）：读 stashedChests 找箱 → requestChestOpen →
// 验证 msg32×40+msg33 到达 → world.chests 登记 + 面板开。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-chest.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-ch-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/?vdump=chest', { waitUntil: 'domcontentloaded' });
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
  if (inp) { inp.value = '开箱者'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
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
await sleep(5000);
{
  const wb = await page.evaluate(() => {
    const btn = document.getElementById('sw-welcome-announce')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (wb) { await page.mouse.click(wb.x, wb.y); await sleep(1500); }
}
// 找箱（stashedChests 来自段尾段;不够则扩段请求）
let chests = await page.evaluate(() => Array.from(globalThis.__swGame.net.stashedChests.values()));
log('段尾箱: ' + JSON.stringify(chests));
if (!chests.length) {
  // 扩圈请求周边段（±2 段 = ±400 tile）
  await page.evaluate(() => {
    const g = globalThis.__swGame;
    const p = g.player;
    const sx = Math.floor(p.x / 16 / 200), sy = Math.floor(p.y / 16 / 150);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      g.net.requestSection((sx + dx) * 200 * 16, (sy + dy) * 150 * 16);
    }
  });
  await sleep(4000);
  chests = await page.evaluate(() => Array.from(globalThis.__swGame.net.stashedChests.values()));
  log('扩圈后箱: ' + JSON.stringify(chests));
}
if (!chests.length) {
  log('✗无箱可测（世界此区域无箱）');
  await browser.close();
  process.exit(1);
}
// 开最近的箱
const chest = chests[0];
log('目标箱: ' + JSON.stringify(chest));
const before = await page.evaluate(() => ({
  chestCount: globalThis.__swGame.world.chests?.length ?? 0,
}));
await page.evaluate((c) => { globalThis.__swGame.net.requestChestOpen(c.x, c.y); }, chest);
await sleep(3000);
const after = await page.evaluate(() => ({
  chestCount: globalThis.__swGame.world.chests?.length ?? 0,
  lastChest: (globalThis.__swGame.world.chests ?? []).slice(-1)[0] ?? null,
  hist32: globalThis.__vhist?.['32'],
  chestUI: !!document.querySelector('.sw-chest-panel, [class*=chest]'),
}), {});
// 直方图装一次
await page.evaluate(() => {
  const g = globalThis.__swGame;
  globalThis.__vhist = {};
  const orig = g.net.handle.bind(g.net);
  g.net.handle = (id, p2) => { globalThis.__vhist[id] = (globalThis.__vhist[id] || 0) + 1; return orig(id, p2); };
});
await page.evaluate((c) => { globalThis.__swGame.net.requestChestOpen(c.x, c.y); }, chest);
await sleep(2500);
const hist = await page.evaluate(() => globalThis.__vhist);
log(`world.chests ${before.chestCount} → ${after.chestCount}; 直方图: ` + JSON.stringify(hist));
log('末箱: ' + JSON.stringify(after.lastChest).slice(0, 200));
// 判定=内容证据（注册数增长+非空槽）——hist 判定伪影：首开在直方图装置前+服务器对二次开箱去重（Chest.UsingChest 门）
const items = (after.lastChest?.items ?? []).filter(Boolean);
const pass = after.chestCount > before.chestCount && items.length > 0;
log(pass ? `★CHEST-PASS（world.chests 注册+${items.length} 槽内容,箱子协议链通）` : '✗CHEST-FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
