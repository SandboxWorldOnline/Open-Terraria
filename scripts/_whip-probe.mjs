// ★v3:绕 Game.frame 直接单步 WhipProj.fixedUpdate（病灶直击+console 实时流）
import { launchBrowser, openPage, bootstrap, createGame, pump, spawnEnemy } from '../tools/probe/lib/index.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5204';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
page.on('console', (m) => console.log('[页]', m.text().slice(0, 120)));
await bootstrap(page, ORIGIN + '/?cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261021 });
await pump(page, 40);
console.log('game ready');
await page.evaluate(async () => {
  const m = await import('/src/entities/WhipProj.ts');
  window.__WhipProj = m.WhipProj;
  const g = window.__swGame;
  g.running = false;
  g.paused = true;
  window.__mkWhip = (projId, itemId, dmg) => {
    const w = new window.__WhipProj(
      g.player.cx, g.player.cy, 0, projId, itemId,
      dmg ?? 170, 4, 30, 4,
      () => g.player,
      () => 0, 1,
    );
    g.entities.add(w, 'projectiles');
    return w;
  };
});
console.log('ctor ready');
await spawnEnemy(page, 3, (await page.evaluate(() => window.__swGame.player.cx)) + 100,
  (await page.evaluate(() => window.__swGame.player.y)) - 40);
console.log('enemy ready');
await page.evaluate(() => {
  const g = window.__swGame;
  window.__w915 = window.__mkWhip(915, 4914, 170);
  console.log('whip built, ai0=', window.__w915.ai0, 'timeToFlyOut=', window.__w915.timeToFlyOut, 'maxUpdates=', window.__w915.maxUpdates);
});
// 命中面:鞭建前/后敌 hp 对照（v4 补——单步 AI 驱动含 tryHit）
const hp0 = await page.evaluate(() => window.__swGame.entities.enemies.map((e) => ({ hp: Math.round(e.hp), dead: e.dead })));
console.log('敌 hp（鞭前）:', JSON.stringify(hp0));
// 单步:每次 evaluate 只调一次 fixedUpdate（CDP 调用本身有 8s 护栏）
for (let i = 0; i < 60; i++) {
  const r = await Promise.race([
    page.evaluate(() => {
      const w = window.__w915;
      const t0 = performance.now();
      w.fixedUpdate(1 / 60, window.__swGame);
      return { ms: +(performance.now() - t0).toFixed(1), ai0: w.ai0, dead: w.dead };
    }),
    new Promise((res) => setTimeout(() => res({ ms: 'TIMEOUT' }), 6000)),
  ]);
  if (i % 10 === 0 || r.ms === 'TIMEOUT' || (typeof r.ms === 'number' && r.ms > 30)) {
    console.log(`步${i}:`, JSON.stringify(r));
  }
  if (r.ms === 'TIMEOUT') { console.log('★卡死步=', i); break; }
  if (r.dead) { console.log(`鞭亡于步${i}`); break; }
}
const hp1 = await page.evaluate(() => window.__swGame.entities.enemies.map((e) => ({ hp: Math.round(e.hp), dead: e.dead })));
console.log('敌 hp（鞭后）:', JSON.stringify(hp1));
// 渲染帧（完整 Game.frame 含 whip draw）:再造一鞭+驱动 35 帧计时
await page.evaluate(() => { window.__mkWhip(915, 4914, 170); });
const renderMs = await Promise.race([
  page.evaluate(() => {
    const g = window.__swGame;
    const per = [];
    for (let i = 0; i < 35; i++) {
      const f0 = performance.now();
      window.__vnow = (window.__vnow || performance.now()) + 16.7;
      g.frame(window.__vnow);
      per.push(+(performance.now() - f0).toFixed(1));
    }
    return { mean: per.reduce((a, b) => a + b, 0) / per.length, peak: Math.max(...per), per: per.slice(0, 10) };
  }),
  new Promise((res) => setTimeout(() => res({ mean: 'TIMEOUT' }), 20000)),
]);
console.log('渲染帧（含 whip draw）:', JSON.stringify(renderMs));
// whip draw 计时分解:hook WhipProj.draw（含线体/tip）+WhipTag 视觉
await page.evaluate(() => {
  const proto = Object.getPrototypeOf(window.__w915) || window.__WhipProj.prototype;
  window.__wd = { draw: 0, n: 0 };
  const orig = proto.draw;
  proto.draw = function (...a) {
    const t0 = performance.now();
    const r = orig.apply(this, a);
    window.__wd.draw += performance.now() - t0;
    window.__wd.n++;
    return r;
  };
});
await page.evaluate(() => { window.__mkWhip(915, 4914, 170); });
const drawMs = await Promise.race([
  page.evaluate(() => {
    const g = window.__swGame;
    for (let i = 0; i < 30; i++) {
      window.__vnow = (window.__vnow || performance.now()) + 16.7;
      g.frame(window.__vnow);
    }
    return { drawTotal: +window.__wd.draw.toFixed(1), calls: window.__wd.n,
      drawPerFrame: +(window.__wd.draw / Math.max(1, window.__wd.n)).toFixed(2) };
  }),
  new Promise((res) => setTimeout(() => res({ drawTotal: 'TIMEOUT' }), 20000)),
]);
console.log('WhipProj.draw 计时:', JSON.stringify(drawMs));
console.log('PROBE DONE');
await browser.close();
