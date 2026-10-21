// ★BJ704-G7 探针②(2026-10-21,只读):件2 堆叠钮商店面 + 件4 光标锚 toolTipDistance
//  真机自证(单局覆盖两件)。
//  件2:classic 布局堆叠双钮显隐门——门唯一输入=game.npcShopOpen/ui.openChest,
//   直置旗+refreshAll 量 display(免 NPC/商店全链)。相位:基线显 → npcShopOpen=true
//   藏(本刀修的面:旧门恒显) → 复位再显。
//  件4:.sw-tooltip 光标锚两档原点——.sw-root 无 transform(style.left=窗口坐标直读):
//   opaque(默认) left=mx+20/top=my+19;nobox(opaqueBoxBehindTooltips=false+1px 平移
//   触发跟随臂重算) left=mx'+13/top=my'+17;DOM 文字原点(rect+padding 13/9)=
//   原版文字锚 opaque(+34/+28,横−1px 声明差族)/nobox(+26/+26 逐像素)。
//  运行:SW_ORIGIN=http://localhost:5221 node tools/run-diag.mjs scripts/_bj704g7-shopgate-tooltip-anchor.mjs
import { launchBrowser, openPage, bootstrap, createGame } from '../tools/probe/lib/index.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, process.env.SW_ORIGIN);
await createGame(page, { mode: 'direct', seed: 'bj704g7', size: 'small' });
await page.evaluate(async () => {
  const { options } = await import('/src/core/Options.ts');
  options.data.backgroundRun = true; options.data.playWhenUnfocused = true;
  const ui = window.__swUI;
  const g = window.__swGame;
  if (!g.player.inv.slots[10]) g.player.inv.slots[10] = { id: 96, stack: 1 };   // 铜盔(非收藏)
  ui.openInventory(true);
  ui.refreshAll();
});
await wait(600);

// ---------- 件2:classic 布局堆叠双钮 npcShopOpen 门 ----------
R.shopGate = await page.evaluate(() => {
  const ui = window.__swUI;
  const disp = () => [ui.quickStackBtn, ui.qsSmartBtn].map((b) => (b && b.isConnected ? b.style.display : 'absent'));
  const out = { layout: ui._builtLayout };
  if (ui._builtLayout !== 'classic') {
    // 切 classic(设置面 onChange → rebuildInventoryPanel)
    return { skipped: 'non-classic', layout: ui._builtLayout };
  }
  out.baseline = disp();
  window.__swGame.npcShopOpen = true;   // 门唯一输入直置(免 NPC/商店全链)
  ui.refreshAllNow();
  out.shopOpen = disp();
  window.__swGame.npcShopOpen = false;
  ui.refreshAllNow();
  out.shopClosed = disp();
  return out;
});
if (R.shopGate?.skipped) {
  // 缺省非 classic → 走 options 切换重建后再量
  R.shopGate = await page.evaluate(async () => {
    const { options } = await import('/src/core/Options.ts');
    await options.set('inventoryLayout', 'classic');
    await new Promise((r) => setTimeout(r, 150));
    const ui = window.__swUI;
    ui.openInventory(true);
    const disp = () => [ui.quickStackBtn, ui.qsSmartBtn].map((b) => (b && b.isConnected ? b.style.display : 'absent'));
    const out = { layout: ui._builtLayout, baseline: disp() };
    window.__swGame.npcShopOpen = true;
    ui.refreshAllNow();
    out.shopOpen = disp();
    window.__swGame.npcShopOpen = false;
    ui.refreshAllNow();
    out.shopClosed = disp();
    // 复原布局(勿留现场)
    await options.set('inventoryLayout', 'vanilla');
    return out;
  });
}

// ---------- 件4:光标锚两档原点 ----------
// 切回 vanilla 布局后重开背包,槽 10 悬停(经典/原版两布局光标锚公式同源)
await page.evaluate(() => { window.__swUI.openInventory(true); window.__swUI.refreshAll(); });
await wait(300);
const slotRect = await page.evaluate(() => {
  const el = document.querySelector('[data-idx="10"][data-where="inv"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.width > 0 };
});
if (!slotRect || !slotRect.visible) {
  R.tooltip = { err: 'slot10 not found/hidden' };
} else {
  // 相位 A:opaque(默认开)
  await page.mouse.move(slotRect.x, slotRect.y);
  await wait(350);
  const A = await page.evaluate(() => {
    const tip = document.querySelector('.sw-tooltip');
    const r = tip.getBoundingClientRect();
    return {
      display: tip.style.display,
      left: parseFloat(tip.style.left), top: parseFloat(tip.style.top),
      rectLeft: r.left, rectTop: r.top,
      nobox: tip.classList.contains('sw-tooltip-nobox'),
    };
  });
  // 相位 B:nobox(关 opaqueBoxBehindTooltips+1px 平移触发跟随臂重算)
  await page.evaluate(async () => {
    const { options } = await import('/src/core/Options.ts');
    await options.set('opaqueBoxBehindTooltips', false);
  });
  await page.mouse.move(slotRect.x + 4, slotRect.y + 4);
  await wait(200);
  const B = await page.evaluate(() => {
    const tip = document.querySelector('.sw-tooltip');
    const r = tip.getBoundingClientRect();
    const cs = getComputedStyle(tip);
    return {
      display: tip.style.display,
      left: parseFloat(tip.style.left), top: parseFloat(tip.style.top),
      rectLeft: r.left, rectTop: r.top,
      nobox: tip.classList.contains('sw-tooltip-nobox'),
      padL: parseFloat(cs.paddingLeft), padT: parseFloat(cs.paddingTop),
    };
  });
  R.tooltip = {
    mouseA: { x: slotRect.x, y: slotRect.y }, A,
    mouseB: { x: slotRect.x + 4, y: slotRect.y + 4 }, B,
    // 期望(公式 cursorTooltipAnchor):
    expA: { left: slotRect.x + 20, top: slotRect.y + 19 },          // opaque 盒几何
    expB: { left: slotRect.x + 4 + 13, top: slotRect.y + 4 + 17 },  // nobox 文字缘−padding
    // DOM 文字原点(rect+padding) vs 原版文字锚(:20561-20567)
    expTextA: { x: slotRect.x + 34 - 1, y: slotRect.y + 28 },       // 横−1px=声明差族
    expTextB: { x: slotRect.x + 4 + 26, y: slotRect.y + 4 + 26 },   // nobox 逐像素
  };
  // 复原设置(勿留现场)
  await page.evaluate(async () => {
    const { options } = await import('/src/core/Options.ts');
    await options.set('opaqueBoxBehindTooltips', true);
  });
}

console.log(JSON.stringify(R, null, 2));
await browser.close();
