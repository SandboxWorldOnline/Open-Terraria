// BJ711-A 实机探针 v3:玩家就位 → 激活 → 杀光四教徒 → 逐步轮询 439 生死
// (v2 伪影:玩家留出生点 >5600px,439 出生即撞 lunaticCultistAI:841 距离门自灭)
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.env.SW_ORIGIN ?? 'http://localhost:5254';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${ORIGIN}/?play=small&beh=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
let inGame = false;
for (let i = 0; i < 90 && !inGame; i++) {
  inGame = await page.evaluate(() => !!(window.__swGame && window.__swGame.renderer)).catch(() => false);
  if (!inGame) await new Promise((r) => setTimeout(r, 2000));
}
if (!inGame) { console.error('未进游戏'); await browser.close(); process.exit(1); }
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if ((b.textContent || '').includes('我已知晓')) { b.click(); break; }
  }
});

const setup = await page.evaluate(() => {
  const g = window.__swGame;
  const w = g.world;
  w.flags.hardMode = true;
  w.flags['downed_245'] = true;
  w.flags.downedSkeletron = true;
  w.cultistDelay = 0;
  g.entities.enemies.length = 0;
  return { dungeonX: w.dungeonX, dungeonY: w.dungeonY };
});
console.log('setup:', JSON.stringify(setup));

let tab = null;
for (let i = 0; i < 40 && !tab; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  tab = await page.evaluate(() => {
    const g = window.__swGame;
    const t = g.entities.enemies.find((e) => e.vanillaId === 437 && !e.dead);
    return t ? { id: t.id, cx: t.cx, cy: t.cy, tx: Math.floor(t.cx / 16), ty: Math.floor(t.cy / 16) } : null;
  });
}
if (!tab) { console.log('石碑未出生 errors:', JSON.stringify(errors.slice(0, 5))); await browser.close(); process.exit(2); }
console.log('tablet:', JSON.stringify(tab));
await new Promise((r) => setTimeout(r, 2500));

// 玩家就位:石碑正下方地面上方 4 格(下落站定),离仪式 <300px
await page.evaluate((cx) => {
  const g = window.__swGame;
  g.player.x = cx - 10; g.player.y = 0;   // 先放同列,再精确放
}, tab.cx);
await page.evaluate((cx, cy) => {
  const g = window.__swGame;
  g.player.x = cx - 10;
  g.player.y = cy + 60;      // 石碑下方 ~2 格(仪式平台上空)
  g.player.vx = 0; g.player.vy = 0;
  g.player.hp = 400; g.player.dead = false;
}, tab.cx, tab.cy);
await new Promise((r) => setTimeout(r, 1200));   // 落地站稳

const pre = await page.evaluate(() => {
  const g = window.__swGame;
  const kids = g.entities.enemies.filter((e) => !e.dead && (e.vanillaId === 438 || e.vanillaId === 379));
  return {
    playerDead: g.player.dead, playerHp: g.player.hp,
    playerTile: [Math.floor(g.player.cx / 16), Math.floor(g.player.cy / 16)],
    kids: kids.map((e) => ({ vid: e.vanillaId, id: e.id, col: Math.floor(e.cx / 16 - 0.5), ty: Math.floor(e.cy / 16), ai3: e.ai3 })),
    dist: kids.length ? Math.round(Math.hypot(g.player.cx - kids[0].cx, g.player.cy - kids[0].cy)) : -1,
  };
});
console.log('pre-kill:', JSON.stringify(pre, null, 1));

// 杀光四教徒(真实 hurt)
const kill = await page.evaluate(() => {
  const g = window.__swGame;
  const kids = g.entities.enemies.filter((e) => !e.dead && (e.vanillaId === 438 || e.vanillaId === 379));
  for (const k of kids) { k.hurt(999999, 0, 0, g, 0, false, 0, true); k.dead = true; }
  return kids.length;
});
console.log('killed:', kill);

// 逐步轮询 5s:439 生死 + 玩家态
for (let i = 0; i < 16; i++) {
  await new Promise((r) => setTimeout(r, 320));
  const s = await page.evaluate(() => {
    const g = window.__swGame;
    const b = g.entities.enemies.find((e) => e.vanillaId === 439);
    const tab2 = g.entities.enemies.find((e) => e.vanillaId === 437);
    return {
      t: Math.round(performance.now()),
      boss: b ? { id: b.id, dead: b.dead, fled: !!b.bossFled, hp: b.hp, ai0: b.ai0 } : null,
      bossSlot: g.boss ? g.boss.vanillaId : null,
      tabAi: tab2 ? { ai0: tab2.ai0, ai2: tab2.ai2, ai3: tab2.ai3 } : null,
      playerDead: g.player.dead, hp: g.player.hp,
    };
  });
  console.log(`poll[${i}]`, JSON.stringify(s));
  if (s.boss && !s.boss.dead && i > 8) break;
}

const fin = await page.evaluate(() => {
  const g = window.__swGame;
  const b = g.entities.enemies.find((e) => e.vanillaId === 439 && !e.dead);
  return { bossAlive: !!b, bossSlot: g.boss ? g.boss.vanillaId : null, delay: g.world.cultistDelay };
});
console.log('final:', JSON.stringify(fin));
console.log('errors:', JSON.stringify(errors.slice(0, 8)));
await browser.close();
