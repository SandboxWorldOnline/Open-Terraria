// ★BJ704-R5 红蓝探针（2026-10-21,只读诊断,禁改源码）:
//  疑点=清偿A-F6「原地拾取后隐藏气泡」只盖了 mouseup pickUp 支——同簇
//  mousedown 槽上 Ctrl 快速回收（altMoveClick QUICK_TRASH 路径）同样原地清空
//  槽位且不产生边界事件,若气泡残留+跟随臂漂移=F6 同族未覆盖面。
//  对照组 A=F6 已修路径（原生左键原地拾取→隐藏,期望 display none）。
//  运行:SW_ORIGIN=http://localhost:5217 node tools/run-diag.mjs scripts/_bj704r5-f6-quickmove-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame } from '../tools/probe/lib/index.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, process.env.SW_ORIGIN);
await createGame(page, { mode: 'direct', seed: 'bj704r5', size: 'small' });
await page.evaluate(async () => {
  const { options } = await import('/src/core/Options.ts');
  options.data.backgroundRun = true; options.data.playWhenUnfocused = true;
  const ui = window.__swUI;
  ui.openInventory(true);
  const g = window.__swGame;
  if (!g.player.inv.slots[10]) g.player.inv.slots[10] = { id: 96, stack: 1 };   // 铜盔(非收藏)
  ui.refreshAll();
});
await wait(600);

const slotRect = await page.evaluate(() => {
  const el = document.querySelector('[data-idx="10"][data-where="inv"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, visible: r.width > 0 };
});
if (!slotRect || !slotRect.visible) {
  console.log(JSON.stringify({ err: 'slot10 not found/hidden', slotRect }, null, 2));
  process.exit(0);
}

const snapTip = async (label) => page.evaluate((l) => {
  const ui = window.__swUI;
  const tip = document.querySelector('.sw-tooltip');
  const g = window.__swGame;
  return {
    label: l,
    display: tip.style.display,
    text: (tip.textContent || '').replace(/\s+/g, ' ').slice(0, 24),
    left: tip.style.left, top: tip.style.top,
    follows: ui.tooltipFollowsCursor,
    held: !!ui.heldStack,
    slot10: g.player.inv.slots[10] ? g.player.inv.slots[10].id : null,
    trash: g.player.inv.trash ? g.player.inv.trash.id : null,
  };
}, label);

// ---------- 对照组 A:F6 已修路径(原地左键拾取 → 期望隐藏) ----------
await page.mouse.move(slotRect.x, slotRect.y); await wait(350);
R.hoverA = await snapTip('A1 hover');
await page.mouse.down(); await page.mouse.up(); await wait(120);
R.afterPickup = await snapTip('A2 after plain click pickup');
await page.evaluate(() => {
  const ui = window.__swUI;
  if (ui.heldStack) { window.__swGame.player.inv.slots[10] = ui.heldStack; ui.heldStack = null; }   // 还原
  window.__swGame.player.inv.trash = null;
  ui.refreshAll();
});
await page.mouse.move(10, 10); await wait(150);   // 离开场域清 tooltip 态

// ---------- 疑点组 B:Ctrl+click 快速回收(mousedown 支,非 mouseup pickUp) ----------
await page.mouse.move(slotRect.x, slotRect.y); await wait(350);
R.hoverB = await snapTip('B1 hover');
await page.keyboard.down('Control');
await page.mouse.down(); await page.mouse.up();
await page.keyboard.up('Control');
await wait(150);
R.afterQuickTrash = await snapTip('B2 after ctrl+click quick trash');
// 原地小移(不出槽)+ 远移(出槽)各看跟随臂
await page.mouse.move(slotRect.x + 6, slotRect.y + 6); await wait(150);
R.afterMove1 = await snapTip('B3 move+6px');
await page.mouse.move(slotRect.x + 90, slotRect.y + 40); await wait(150);
R.afterMove2 = await snapTip('B4 move+90px(follow arm)');

console.log(JSON.stringify(R, null, 2));
await browser.close();
