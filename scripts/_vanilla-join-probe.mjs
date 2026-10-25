// vanilla interop 浏览器 E2E 探针（P0-B，2026-10-24）。
// 弹道：?vanilla=127.0.0.1:7781 → 桥(5290) → rig → 全握手 → 进世界渲染。
// 采样：世界名/尺寸、玩家位、tile 统计（出生窗 solid/类型多样性）、vanilla net 内态、
//       键盘移动 2s 位移差（msg13 链路活动性旁证）、截图取证、服务器日志联动。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE_URL = 'http://localhost:5204/?vanilla=127.0.0.1:7781';
const SHOT = '/tmp/vanilla-join.png';
const LOG = fs.openSync('/tmp/vanilla-join-probe.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-join-' + (Date.now() % 100000),
  args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 160)}`));
const T0 = Date.now();
page.on('console', (m) => {
  const t = m.text();
  log(`+${String(Date.now() - T0).padStart(6)}ms CONSOLE[${m.type()}] ${t.slice(0, 200)}`);
});
page.on('requestfailed', (r) => log(`REQ-FAIL ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });

// 进世界等待（世界流 24 段 + loadWorld + 资产）
let inGame = false;
for (let i = 0; i < 45; i++) {
  await sleep(2000);
  inGame = await page.evaluate(() => !!(globalThis.__swGame && globalThis.__swGame.world && globalThis.__swGame.player)).catch(() => false);
  if (inGame) break;
  if (i % 10 === 9) log(`…等待进世界 ${i * 2}s`);
}
if (!inGame) {
  log('FAIL: 90s 未进世界');
  const dump = await page.evaluate(() => ({
    hasGame: !!globalThis.__swGame,
    hasWorld: !!globalThis.__swGame?.world,
    hasPlayer: !!globalThis.__swGame?.player,
    netActive: globalThis.__swGame?.net?.active ?? null,
    bodyToast: document.querySelector('[class*=toast],[class*=Toast]')?.textContent ?? null,
    progressText: document.querySelector('[class*=progress],[class*=Progress]')?.textContent ?? null,
    url: location.href,
  })).catch((e) => ({ err: String(e) }));
  log('DUMP ' + JSON.stringify(dump));
  await page.screenshot({ path: SHOT }).catch(() => {});
  log('截图 ' + SHOT);
  await browser.close();
  process.exit(1);
}
log('IN-GAME ✓');

const sample = await page.evaluate(() => {
  const g = globalThis.__swGame;
  const st = g.world.store;
  // 玩家周边 80×50 窗统计
  const px = Math.floor(g.player.x / 16), py = Math.floor(g.player.y / 16);
  let solid = 0, active = 0; const types = new Set();
  for (let y = Math.max(0, py - 25); y < Math.min(st.h, py + 25); y++) {
    for (let x = Math.max(0, px - 40); x < Math.min(st.w, px + 40); x++) {
      const i = y * st.w + x;
      if (st.flags[i] & 1) { active++; types.add(st.type[i]); }
    }
  }
  const net = g.net;
  return {
    world: { name: g.world.name, w: g.world.w, h: g.world.h, spawn: [g.world.spawnX, g.world.spawnY], surface: g.world.groundLevel },
    player: { x: Math.round(g.player.x), y: Math.round(g.player.y), tile: [px, py] },
    net: net ? { active: net.active, mySlot: net.mySlot, sections: net.sectionsReceived ?? -1, chestsStashed: net.stashedChests ? net.stashedChests.size : -1 } : null,
    window: { active, types: types.size, w: 80, h: 50 },
  };
});
log('SAMPLE ' + JSON.stringify(sample));

// 键盘右移 2s：本地位移差（msg13 上报活动性旁证——服务器踢人则连接会断）
await page.keyboard.down('ArrowRight');
await sleep(2000);
await page.keyboard.up('ArrowRight');
await sleep(800);
const after = await page.evaluate(() => {
  const g = globalThis.__swGame;
  return { x: Math.round(g.player.x), y: Math.round(g.player.y), netActive: g.net?.active };
});
const dx = after.x - sample.player.x;
log(`MOVE after=${JSON.stringify(after)} dx=${dx}px(${Math.round(dx / 16)} tiles)`);
log(dx > 0 ? 'MOVE ✓ 玩家可移动' : 'MOVE ✗ 位移为零');

await page.screenshot({ path: SHOT }).catch(() => {});
log('截图 ' + SHOT);
await sleep(500);
const stillIn = await page.evaluate(() => !!globalThis.__swGame?.net?.active).catch(() => false);
log(stillIn ? '连接保持 ✓（未被踢）' : '连接断开 ✗');
await browser.close();
process.exit(inGame && dx > 0 && stillIn ? 0 : 1);
