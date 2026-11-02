// ★BJ750-A ⑧ 实机探针:晶塔上架全链（issue#38 ⑧「正常流程无法获得晶塔」定谳）。
// 链路:__swFlow.newWorld → 玩家身旁两个【已安家】NPC（169×124 窗 + 贴家 <100 格）
// → 等 scene 扫描（每 20tick）→ 真实链开店（openNpcDialog → openShopFromButton）
// → 断言 shopStockFor 含 4876 纯净森林塔（价 10 金）+ UI 货架渲染出塔 + 排除集
// （酒保 550 店无塔）+ 腐化排斥（直改 scene.zoneCorrupt 后 4876 消失）。
import puppeteer from 'puppeteer-core';

const ORIGIN = process.env.SW_ORIGIN ?? 'http://localhost:5199';
const CHROME = process.env.HOME + '/.cache/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
await p.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await p.waitForFunction(() => !!window.__swFlow, { timeout: 60000 });
await p.evaluate(() => window.__swFlow.newWorld('', 4200, 1200));
await p.waitForFunction(() => !!window.__swGame?.player && !!window.__swGame?.world, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 2000));

const res = await p.evaluate(async () => {
  const g = window.__swGame;
  const out = {};
  document.getElementById('sw-welcome-announce')?.remove();
  const { TownNPC } = await import('/src/entities/TownNPC.ts');
  // 玩家钉地表出生点附近（森林/非腐化）
  const st = g.world.store;
  const ptx = Math.floor(g.player.cx / 16);
  let groundY = 0;
  for (let ty = 0; ty < st.h; ty++) { if (st.isSolid(ptx, ty)) { groundY = ty; break; } }
  g.player.x = ptx * 16; g.player.y = (groundY - 3) * 16;
  for (let i = 0; i < 30; i++) g.fixedUpdate(1 / 60);   // scene 扫描窗（20tick）
  // 两个已安家 NPC:家=自身所站格（窗内 + 距家 ~0）
  const mk = (key, dx) => {
    const n = new TownNPC(key, (ptx + dx) * 16, (groundY - 3) * 16);
    n.home = { x: ptx + dx, y: groundY - 3 };
    g.entities.add(n, 'npcs');
    return n;
  };
  const merchant = mk('merchant', 2);
  const dryad = mk('dryad', -2);
  for (let i = 0; i < 30; i++) g.fixedUpdate(1 / 60);
  out.scene = {
    belowSurface: g.scene.belowSurface, zoneCorrupt: g.scene.zoneCorrupt,
    zoneCrimson: g.scene.zoneCrimson, zoneSnow: g.scene.zoneSnow,
    zoneJungle: g.scene.zoneJungle,
  };
  out.playerTile = [Math.floor(g.player.cx / 16), Math.floor(g.player.cy / 16)];
  // 商人店 stock（私有方法运行期可达）
  const stockOf = (n) => g.shopStockFor(n).map((e) => e[0]);
  out.merchantStock = stockOf(merchant);
  out.merchantHasPylon4876 = out.merchantStock.includes(4876);
  out.pylonEntry = g.shopStockFor(merchant).find((e) => e[0] === 4876);
  // 真实链开店 → UI 货架
  g.player.x = merchant.cx - 30; g.player.y = merchant.cy - 8;
  g.openNpcDialog(merchant);
  await new Promise((r) => setTimeout(r, 300));
  g.openShopFromButton(false);
  await new Promise((r) => setTimeout(r, 600));
  out.shopOpen = g.npcShopOpen;
  const ui = window.__swUI;
  out.uiShopItems = (ui._builtLayout?.items ?? ui.shopItems ?? []).length ?? -1;
  // UI 货架条目按 vid 反查（layout items 元素带 title/data-vid 两种通道之一）
  const uiVids = (ui.vinvShopPayload?.entries ?? []).map((e) => e.vanillaId);
  out.uiVids = uiVids;
  out.uiHasPylon = uiVids.includes(4876);
  // 排除集:酒保（550）店
  const keep = mk('tavernkeep', 4);
  out.tavernkeepStock = stockOf(keep);
  out.tavernkeepHasPylon = [4876, 4875, 4916, 4917, 4918, 4919, 4920, 4921, 5652]
    .some((v) => out.tavernkeepStock.includes(v));
  // 腐化排斥（直改 scene 旗——scene 每 20tick 重扫会覆写,单次 shopStockFor 调用内即读）
  g.scene.zoneCorrupt = true;
  out.corruptBlocks = !stockOf(merchant).includes(4876);
  g.scene.zoneCorrupt = false;
  // 购买闭环:塞 20 金 → npcShopBuy(4876) → 背包出现晶塔物品（issue 主诉求「无法获得」）
  try {
    const { ITEM_DEFS } = await import('/src/data/items.ts');
    const goldIdx = ITEM_DEFS.findIndex((d) => d?.vid === 73);
    g.player.inv.slots[49] = { id: goldIdx, stack: 20 };
    out.bought = g.npcShopBuy(4876);
    out.invPylonCount = g.player.inv.slots
      .filter((sl) => sl && sl.stack > 0 && ITEM_DEFS[sl.id]?.vid === 4876)
      .reduce((a, sl) => a + sl.stack, 0);
    out.goldLeft = g.player.inv.slots.filter((sl) => sl && ITEM_DEFS[sl.id]?.vid === 73)
      .reduce((a, sl) => a + sl.stack, 0);
  } catch (e) { out.buyError = String(e).slice(0, 160); }
  // 窗口门:拆 dryad 与酒保的家 → 只剩 merchant 1 个入住者
  dryad.home = null;
  keep.home = null;
  out.singleNpcBlocks = !stockOf(merchant).includes(4876);
  dryad.home = { x: ptx - 2, y: groundY - 3 };
  keep.home = { x: ptx + 4, y: groundY - 3 };
  return out;
});

let pass = 0, fail = 0;
const ck = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? '  | ' + extra : ''}`);
  ok ? pass++ : fail++;
};
ck('商人在场前提（merchant/dryad 已安家）', res.merchantStock.length > 0, `stock=${res.merchantStock.length} 件`);
ck('★商人店上架 4876 纯净森林晶塔（issue#38 ⑧ 主诉求）', res.merchantHasPylon4876,
  JSON.stringify(res.pylonEntry));
ck('晶塔价 = 10 金（buyPrice(0,10)=100000 铜）', res.pylonEntry && res.pylonEntry[1] === 100000);
ck('真实开店链 open（openNpcDialog→openShopFromButton）', res.shopOpen === true);
ck('UI 货架渲染含晶塔', res.uiHasPylon, `uiVids=${JSON.stringify(res.uiVids)}`);
ck('★购买闭环:npcShopBuy(4876) 成功 + 晶塔入包', res.bought === true && res.invPylonCount === 1,
  `bought=${res.bought} invPylon=${res.invPylonCount} goldLeft=${res.goldLeft} err=${res.buyError ?? '无'}`);
ck('购买扣款 ~10 金（快乐度折后 ≤100000 铜）', typeof res.goldLeft === 'number' && res.goldLeft >= 10 && res.goldLeft <= 20,
  `goldLeft=${res.goldLeft}`);
ck('排除集:酒保 550 店无任何晶塔', res.tavernkeepHasPylon === false, `tavernkeep=${res.tavernkeepStock.length} 件`);
ck('腐化排斥:zoneCorrupt → 4876 不上', res.corruptBlocks === true);
ck('窗口门:仅 1 入住 NPC → 4876 不上', res.singleNpcBlocks === true);
ck('页面零 JS 错', errors.length === 0, errors.join('; '));
console.log(`\nscene=${JSON.stringify(res.scene)} playerTile=${JSON.stringify(res.playerTile)}`);
console.log(`\n== bj750a pylon probe: ${pass} pass / ${fail} fail ==`);
await b.close();
process.exit(fail ? 1 : 0);
