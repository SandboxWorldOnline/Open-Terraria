// ★BJ737-A issue#31 实机复核探针（两案判别）：
//  A:W 键面——真键盘 KeyW 按住 30 拍不起跳（vy 恒 0/inputJump 恒 false）;W 持住中
//    按空格 → 起跳（vy<0）——issue 主诉 a/b 的浏览器层复现与修复验证。
//  B:装备/时装点击高亮——真鼠标点击背包格拾取时装头(237 Sunglasses,headSlot=12
//    +vanity)/普通头(238,headSlot=14 非 vanity) → 对应列槽 .sw-slot-hl 边框层
//    在场性（ItemSlot.cs:2360-2382 Back22 面）。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs scripts/_bj737a-verify.mjs
import { launchBrowser, openPage, pump, savePageShot, resolveShotPath } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const browser = await launchBrowser({});
const page = await openPage(browser, { errors: [] });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

await page.goto(`${ORIGIN}/?play=small&cloudcache=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
let hotbar = false;
for (let i = 0; i < 600; i++) {
  await new Promise((r) => setTimeout(r, 500));
  hotbar = await page.evaluate(() => !!document.querySelector('.sw-hotbar')).catch(() => false);
  if (hotbar) break;
}
await new Promise((r) => setTimeout(r, 1500));
if (!hotbar) { console.log(JSON.stringify({ fail: 'hotbar 未出现' })); await browser.close(); process.exit(1); }

const read = () => page.evaluate(() => {
  const p = window.__swGame.player;
  return { y: p.y, vy: p.vy, jump: p.inputJump, up: p.inputUp, hold: p.jumpHold, onGround: p.onGround };
});

// ================= A:W 键面（真键盘） =================
await pump(page, 180);   // 落地稳态
const settled = await read();
if (Math.abs(settled.vy) > 0.001) {
  console.log(JSON.stringify({ fail: 'A 前置:玩家未落地稳态', settled }));
  await browser.close(); process.exit(1);
}
await page.keyboard.down('KeyW');
await pump(page, 30);
const wOnly = await read();
await page.keyboard.down('Space');   // ★W 持住中按空格（issue 主诉 b 场景）
await pump(page, 4);
const wPlusSpace = await read();
const yBefore = wOnly.y;
await pump(page, 10);
const rising = await read();
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
const verdictA = {
  wNoJump: wOnly.vy === 0 && wOnly.jump === false && wOnly.up === true,   // 主诉a:W 不跳
  wPlusSpaceJumps: wPlusSpace.vy < 0 && wPlusSpace.jump === true && wPlusSpace.hold > 0,  // 主诉b:起跳
  rose: rising.y < yBefore - 16,                                          // 净上移 ≥1 格
  samples: { settled, wOnly, wPlusSpace, rising, yBefore },
};
console.log('A:', JSON.stringify(verdictA));

// 落回地面（B 段前置）
await pump(page, 240);
const back = await read();

// ================= B:点击高亮（真鼠标拾取） =================
const arm = async (vid) => page.evaluate(async (vid) => {
  document.querySelector('#sw-welcome-announce')?.remove();   // 欢迎公告遮罩(z=60 全页拦截)摘除（bj157 同法）
  const g = window.__swGame;
  const { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID } = await import('/src/data/items.ts');
  const key = VANILLA_ITEM_KEY_BY_ID[vid];
  const id = ITEM_BY_KEY[key];
  g.player.inv.slots[10] = { id, stack: 1 };
  window.__swUI.openInventory(true);
  window.__swUI.refreshAll();
  return { vid, key, id };
}, vid);

const clickSlot = async (where, idx) => {
  const el = await page.$(`.sw-slot[data-where="${where}"][data-idx="${idx}"]`);
  if (!el) return { fail: `槽 ${where}:${idx} DOM 缺失` };
  const bb = await el.boundingBox();
  if (!bb) return { fail: `槽 ${where}:${idx} 无布局` };
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await new Promise((r) => setTimeout(r, 120));
  await page.mouse.down({ button: 'left' });
  await new Promise((r) => setTimeout(r, 120));
  await page.mouse.up({ button: 'left' });
  await new Promise((r) => setTimeout(r, 250));   // refreshAll rAF
  return page.evaluate(() => ({ held: window.__swUI.heldStack?.id ?? null }));
};

const hlProbe = () => page.evaluate(() => {
  const at = (where, idx) => {
    const s = document.querySelector(`.sw-slot[data-where="${where}"][data-idx="${idx}"]`);
    if (!s) return null;
    const hl = s.querySelector('.sw-slot-hl');
    const st = hl ? getComputedStyle(hl) : null;
    return {
      on: !!hl,
      tint: st ? st.getPropertyValue('--hl-tint') : null,
      bg: st ? st.backgroundImage.slice(0, 90) : null,
      // 绘序:叠层须为槽元首子（槽底 ::after z-1 之上、幽灵图/图标之下,:2360 序）
      firstChild: hl ? s.firstElementChild === hl : null,
    };
  };
  return {
    armor0: at('armor', 0), armor1: at('armor', 1),
    armor10: at('armor', 10), armor11: at('armor', 11), armor13: at('armor', 13),
    dye0: at('dye', 0), misc0: at('misc', 0),
    nHl: document.querySelectorAll('.sw-slot-hl').length,
  };
});

// ---- B1:普通头（238,headSlot=14 非 vanity）→ 装备头槽 0 高亮,时装头槽 10 不亮 ----
const armed1 = await arm(238);
const picked1 = await clickSlot('inv', 10);
const hl1 = await hlProbe();
// 放回（点背包空格 11）清光标,再换时装头
await clickSlot('inv', 11);
const cleared = await page.evaluate(() => ({ held: window.__swUI.heldStack?.id ?? null }));

// ---- B2:时装头（237 Sunglasses,headSlot=12+vanity）→ 时装头槽 10 高亮,装备头槽 0 不亮 ----
const armed2 = await arm(237);
const picked2 = await clickSlot('inv', 10);
const hl2 = await hlProbe();
const shot = resolveShotPath('bj737a-vanity-highlight');
await savePageShot(page, shot);
await page.evaluate(() => window.__swUI.openInventory(false));

const verdictB = {
  b1VanillaHead: {
    armor0: hl1.armor0?.on === true,        // 装备头槽亮
    armor10: hl1.armor10?.on === false,     // 时装头槽不亮（页路由）
    dye0: hl1.dye0?.on === false,
    misc0: hl1.misc0?.on === false,
    nHl: hl1.nHl,
  },
  b2VanityHead: {
    armor10: hl2.armor10?.on === true,      // ★时装头槽亮（issue 主诉）
    armor0: hl2.armor0?.on === false,
    tint: hl2.armor10?.tint ?? null,
    bg: hl2.armor10?.bg ?? null,
    belowIcon: hl2.armor10?.firstChild === true,
    nHl: hl2.nHl,
  },
  armed1, picked1, cleared, armed2, picked2,
  hl1, hl2, shot,
};
console.log('B:', JSON.stringify(verdictB, null, 1));

const pass = verdictA.wNoJump && verdictA.wPlusSpaceJumps && verdictA.rose
  && verdictB.b1VanillaHead.armor0 && verdictB.b1VanillaHead.armor10   // armor10 字段=「不亮」语义（on===false）
  && verdictB.b2VanityHead.armor10 && verdictB.b2VanityHead.armor0     // armor0 字段=「不亮」语义
  && verdictB.b2VanityHead.belowIcon;
console.log('VERDICT:', pass ? 'PASS' : 'FAIL', '| pageErrors:', errs.length, errs.slice(0, 3));
await browser.close();
process.exit(pass ? 0 : 1);
