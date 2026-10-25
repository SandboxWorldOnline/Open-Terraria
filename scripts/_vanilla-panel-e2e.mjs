// 面板入口全用户流 E2E（2026-10-25）：标题 → 多人联机 → 连接原版服 → 建角 → 进世界 → 掀欢迎浮层 → 截图。
// 全程原生点击（判例 bj669e:合成 dispatchEvent 不触框架监听器）。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-panel.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-pn-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
page.on('console', (m) => { const t = m.text(); if (/vanilla-flow|vanilla-net/.test(t)) log(`C ${t.slice(0, 100)}`); });

/** 原生点击匹配文本的按钮 */
async function clickBtn(text) {
  const box = await page.evaluate((t) => {
    const els = Array.from(document.querySelectorAll('button, [role=button], .sw-vbtn'));
    const el = els.find((b) => (b.textContent || '').trim().includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

// 1. 标题 → 多人游戏（TitleMenu=DOM,[data-act=mp] 直取）
await page.goto('http://localhost:5204/', { waitUntil: 'domcontentloaded' });
let mpBtn = false;
let prevBox = null;
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  if (i < 8) continue; // 硬性下限:入场 8s 内可能有启动层未退场挡点击（坐标稳定≠可点）
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-act=mp]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), txt: el.textContent?.trim() };
  });
  // 坐标两次读数稳定（动画沉降判据）才点——动画期点击=坐标漂移伪影（两发已踩）
  if (box && prevBox && box.x === prevBox.x && box.y === prevBox.y) {
    await page.mouse.click(box.x, box.y);
    mpBtn = true;
    log('   mp 按钮: ' + JSON.stringify(box));
    break;
  }
  prevBox = box;
}
log('1. 点开多人菜单: ' + mpBtn);
await sleep(1500);

// 2. 面板出现 → 验证原版服区 → 点连接（重试面板挂载）
let hasVanillaInput = false;
for (let i = 0; i < 10; i++) {
  hasVanillaInput = await page.evaluate(() => !!Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781'));
  if (hasVanillaInput) break;
  await sleep(800);
}
log('2. 面板态: hasVanillaInput=' + hasVanillaInput);
const joined1 = await clickBtn('连接原版服');
log('2b. 点连接原版服: ' + joined1);
await sleep(2000);

// 3. 角色选择 → 新建（fresh profile 无角色;CharSelectPanel z22 内 [data-act=new]）
let hasNewBtn = false;
for (let i = 0; i < 10; i++) {
  hasNewBtn = await page.evaluate(() => !!document.querySelector('[data-act=new]'));
  if (hasNewBtn) break;
  await sleep(800);
}
log('3. 选角页出现: ' + hasNewBtn);
if (hasNewBtn) {
  const nb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=new]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(nb.x, nb.y);
  await sleep(2500);
}
// 名字：有默认随机名就用,没有就填
await page.evaluate(() => {
  const inp = document.querySelector('.sw-cc-nameval input[type=text], .sw-char-panel input[type=text]');
  if (inp && !inp.value) {
    inp.value = '面板验证者';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await sleep(500);
// 4. 点创建（CharCreation [data-act=create];等名字输入出现）
let created = false;
for (let i = 0; i < 15; i++) {
  const has = await page.evaluate(() => !!document.querySelector('[data-act=create]'));
  if (has) break;
  await sleep(800);
}
const cb2 = await page.evaluate(() => {
  const el = document.querySelector('[data-act=create]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (cb2) { await page.mouse.click(cb2.x, cb2.y); created = true; }
log('4. 点创建角色: ' + created);

// 5. 等进世界
let entered = false;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const st = await page.evaluate(() => {
    const g = globalThis.__swGame;
    return g ? { net: g.net?.active, world: !!g.world?.store, p: !!g.player, name: g.player?.appearance?.name } : null;
  }).catch(() => null);
  if (i % 5 === 0) log(`5. t+${i}s ${JSON.stringify(st)}`);
  if (st?.net && st?.world && st?.p) { entered = true; log(`5. ★进世界! 角色名=${st.name}`); break; }
}

// 6. 掀欢迎浮层 + 截图
if (entered) {
  await sleep(6000);
  const dismissed = await page.evaluate(() => {
    const el = document.getElementById('sw-welcome-announce');
    if (!el) return 'absent';
    const btn = el.querySelector('button');
    if (!btn) return 'no-btn';
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (dismissed && typeof dismissed === 'object') {
    await page.mouse.click(dismissed.x, dismissed.y);
    await sleep(2500);
    log('6. 欢迎浮层已掀');
  } else {
    log('6. 浮层态: ' + JSON.stringify(dismissed));
  }
  await page.screenshot({ path: '/tmp/vanilla-panel-final.png' });
  const fin = await page.evaluate(() => {
    const g = globalThis.__swGame;
    return { processed: g.net.processedCount, sections: g.net.sectionsReceived, active: g.net.active };
  });
  log('终态: ' + JSON.stringify(fin));
  log(entered && fin.active ? '★PANEL-E2E-PASS' : '✗PANEL-E2E-半红');
} else {
  await page.screenshot({ path: '/tmp/vanilla-panel-fail.png' });
  log('✗PANEL-E2E-FAIL');
}
await browser.close();
process.exit(entered ? 0 : 1);
