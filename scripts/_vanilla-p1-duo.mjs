// P1-A 双人对照 E2E（2026-10-25）：两浏览器各建角色 → 先后进 rig →
// 验证互见（players/代理）/NPC 傀儡/聊天双向。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-duo.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 单浏览器：面板流建角+加入,返回 page */
async function joinAs(tag, name) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    userDataDir: `/tmp/vanilla-duo-${tag}-${Date.now() % 100000}`,
    args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => log(`[${tag}] PAGE-EXC ${String(e).slice(0, 200)}`));
  page.on('console', (m) => { const t = m.text(); if (/\[chat\]|vanilla-flow/.test(t)) log(`[${tag}] C ${t.slice(0, 120)}`); });
  await page.goto('http://localhost:5204/', { waitUntil: 'domcontentloaded' });

  // 标题 → 多人（就绪门=elementFromPoint 命中按钮本体——入场期 c10e 画布栈压在
  // 菜单 DOM 上拦截点击,~16s 才让位;坐标稳定≠可点,判例 2026-10-25 双时点对照）
  let clicked = false;
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
    if (ready) {
      await page.mouse.click(ready.x, ready.y);
      clicked = true;
      log(`[${tag}] mp 点击 @ ${JSON.stringify(ready)}`);
      break;
    }
  }
  // 面板 → 连接原版服
  let panelOk = false;
  for (let i = 0; i < 12; i++) {
    panelOk = await page.evaluate(() => !!Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781'));
    if (panelOk) break;
    await sleep(800);
  }
  log(`[${tag}] mp点击=${clicked} 面板=${panelOk}`);
  const vb = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781');
    const row = input?.closest('div');
    const btn = row?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!vb) throw new Error(`[${tag}] 连接按钮未找到`);
  await page.mouse.click(vb.x, vb.y);
  // 选角 → 新建
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(() => !!document.querySelector('[data-act=new]'))) break;
    await sleep(800);
  }
  const nb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=new]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (nb) { await page.mouse.click(nb.x, nb.y); await sleep(2500); }
  // 名字（强制指定）
  await page.evaluate((nm) => {
    const inp = document.querySelector('.sw-cc-nameval input[type=text], .sw-char-panel input[type=text]');
    if (inp) {
      inp.value = nm;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, name);
  await sleep(500);
  // 创建
  for (let i = 0; i < 15; i++) {
    if (await page.evaluate(() => !!document.querySelector('[data-act=create]'))) break;
    await sleep(800);
  }
  const cb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=create]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (cb) { await page.mouse.click(cb.x, cb.y); }
  // 等进世界
  for (let i = 0; i < 50; i++) {
    await sleep(1000);
    const ok = await page.evaluate(() => {
      const g = globalThis.__swGame;
      return !!(g && g.net?.active && g.world?.store && g.player);
    }).catch(() => false);
    if (ok) break;
  }
  const entered = await page.evaluate(() => !!(globalThis.__swGame?.net?.active && globalThis.__swGame?.player));
  log(`[${tag}] 进世界=${entered} 名字=${name}`);
  if (!entered) throw new Error(`[${tag}] 未进世界`);
  await sleep(6000);
  // 掀欢迎浮层（如有）
  const wb = await page.evaluate(() => {
    const el = document.getElementById('sw-welcome-announce');
    const btn = el?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (wb) { await page.mouse.click(wb.x, wb.y); await sleep(1500); }
  // 聊天钩子：newText 包装打点
  await page.evaluate(() => {
    const g = globalThis.__swGame;
    const orig = g.newText.bind(g);
    g.newText = (t, r, gg, b) => { console.info('[chat]', t); orig(t, r, gg, b); };
  });
  return { browser, page, tag, name };
}

// ---- A 先进 ----
const A = await joinAs('a', '双子甲');
await sleep(8000); // A 站稳（等 B 的加入广播）
// ---- B 再进 ----
const B = await joinAs('b', '双子乙');
await sleep(10000); // 等 msg4/13 广播流动

// ---- 断言 ----
const stateOf = async (j) => j.page.evaluate(() => {
  const g = globalThis.__swGame;
  const net = g.net;
  const proxies = g['remotePlayerProxies'] ?? [];
  return {
    mySlot: net.mySlot,
    players: Array.from(net.players.entries()).map(([s, rp]) => ({ slot: s, name: rp.name, active: rp.active, px: Math.round(rp.x / 16), py: Math.round(rp.y / 16) })),
    proxyCount: proxies.length,
    proxyNames: proxies.map((p) => p.appearance?.name),
    npcPuppets: (g['netNpcPuppets'] ?? new Map()).size,
    myName: g.player?.appearance?.name,
  };
});
const sa = await stateOf(A);
const sb = await stateOf(B);
log(`A 态: ${JSON.stringify(sa)}`);
log(`B 态: ${JSON.stringify(sb)}`);

// A 发聊天
await A.page.evaluate(() => { globalThis.__swGame['sendChat']('甲向乙问好', false); });
await sleep(4000);
// B 发聊天
await B.page.evaluate(() => { globalThis.__swGame['sendChat']('乙向甲回礼', false); });
await sleep(4000);

// 聊天到账检查（chat 钩子日志已被 console 捕获到 duo.log;此处再读页面侧最近消息）
const chatA = await A.page.evaluate(() => (globalThis.__chatSeen ?? []));
const chatB = await B.page.evaluate(() => (globalThis.__chatSeen ?? []));

// 截图
await A.page.screenshot({ path: '/tmp/vanilla-duo-a.png' });
await B.page.screenshot({ path: '/tmp/vanilla-duo-b.png' });

const verdict = {
  aSeesB: sb.mySlot != null && sa.players.some((p) => p.slot === sb.mySlot && p.active),
  bSeesA: sa.mySlot != null && sb.players.some((p) => p.slot === sa.mySlot && p.active),
  aProxy: sa.proxyCount >= 1,
  bProxy: sb.proxyCount >= 1,
  aNpc: sa.npcPuppets > 0,
  bNpc: sb.npcPuppets > 0,
  namesOK: sa.myName === '双子甲' && sb.myName === '双子乙',
};
log('判定: ' + JSON.stringify(verdict));
log(verdict.aSeesB && verdict.bSeesA && verdict.aNpc && verdict.bNpc ? '★DUO-PASS（互见+NPC 同步）' : '✗DUO-部分红（见判定）');

await A.browser.close();
await B.browser.close();
process.exit(verdict.aSeesB && verdict.bSeesA && verdict.aNpc && verdict.bNpc ? 0 : 1);
