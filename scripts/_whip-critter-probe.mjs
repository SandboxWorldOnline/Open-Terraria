// ★手动复算:鞭控制点 vs 猫头鹰 AABB + 门链逐判（代码绕开,纯数据验证）
import { launchBrowser, openPage, bootstrap, createGame, pump, spawnEnemy } from '../tools/probe/lib/index.mjs';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5204';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261021 });
await pump(page, 40);
await page.evaluate(async () => {
  const m = await import('/src/entities/WhipProj.ts');
  window.__WhipProj = m.WhipProj;
  const g = window.__swGame;
  g.running = false; g.paused = true;
  window.__frame = () => { window.__vnow = (window.__vnow || performance.now()) + 16.7; g.frame(window.__vnow); };
  window.__mkWhip = () => {
    const w = new window.__WhipProj(g.player.cx, g.player.cy, 0, 915, 4914, 170, 4, 30, 4,
      () => g.player, () => 0, 1);
    g.entities.add(w, 'projectiles');
    return w;
  };
});
const pos = await page.evaluate(() => ({ x: window.__swGame.player.cx, y: window.__swGame.player.y }));
for (let i = 0; i < 10; i++) {
  await spawnEnemy(page, 611, pos.x + 60 + (i % 5) * 40, pos.y - 30 - Math.floor(i / 5) * 40);
}
await page.evaluate(() => {
  const g = window.__swGame;
  const moved = [];
  g.entities.enemies = g.entities.enemies.filter((e) => {
    if (!e.dead && e.vanillaId === 611) { e.catchFriendly = false; moved.push(e); return false; }
    return true;
  });
  for (const e of moved) g.entities.critters.push(e);
});
// 造鞭+手动复算:全程控制点 vs 第一只猫头鹰
const calc = await page.evaluate(() => {
  const g = window.__swGame;
  const w = window.__mkWhip();
  const c = g.entities.critters.find((e) => e.vanillaId === 611);
  const e0 = { x: c.x, y: c.y, w: c.w, h: c.h, id: c.id, catchFriendly: c.catchFriendly,
    defFriendly: c.def?.friendly, iframes: c.iframes, dead: c.dead };
  // 全程控制点扫（ai0 1..60 每步 40 段）
  let minDist = 1e9, hitStep = -1;
  for (let a = 1; a <= 60; a++) {
    const pts = w.pointsAt(a, true);
    for (const p of pts) {
      const d = Math.max(Math.abs(p.x - (e0.x + e0.w / 2)), Math.abs(p.y - (e0.y + e0.h / 2)));
      if (d < minDist) minDist = d;
      // AABB 交（18×18 盒）
      if (!(p.x - 9 >= e0.x + e0.w || p.x + 9 <= e0.x || p.y - 9 >= e0.y + e0.h || p.y + 9 <= e0.y)) {
        if (hitStep < 0) hitStep = a;
      }
    }
  }
  return { e0, minDist: +minDist.toFixed(1), hitStep, nCritters: g.entities.critters.length };
});
console.log('复算:', JSON.stringify(calc));
// 真驱动一鞭——★paused 必须 false（frame 的 accumulator 段被 paused 挡=fixedUpdate
// 不跑=鞭零 update（三轮假阴性根因:探针坑非生产码 bug）
await page.evaluate(() => {
  const g = window.__swGame;
  g.paused = false;
  // ★进世界渲染冻结窗（entryFreeze/tpVeil 分支绕过 fixedUpdate——清标志强制正常分支）
  g._tpVeil = false;
  if (g._entryFreeze) g._entryFreeze = null;
  console.log('★窗清:', 'tpVeil=', g._tpVeil, 'entryFreeze=', !!g._entryFreeze, 'paused=', g.paused);
});
// 插桩驱动:hook tryHit+fixedUpdate 计数（终于看到链上发生了什么）
await page.evaluate(() => {
  const g = window.__swGame;
  const proto = window.__WhipProj.prototype;
  window.__wp = { fu: 0, tryHit: 0, ents: -1, enemies: -1, critters: -1 };
  const ofu = proto.fixedUpdate;
  proto.fixedUpdate = function (...a) { window.__wp.fu++; return ofu.apply(this, a); };
  const oth = proto.tryHit;
  proto.tryHit = function (gg, owner, pts, a4) {
    window.__wp.tryHit++;
    window.__wp.ents = pts.length;
    window.__wp.enemies = (gg.enemies?.() ?? []).length;
    window.__wp.critters = (gg.critters?.() ?? []).length;
    return oth.apply(this, arguments);
  };
});
// 运行时 patch tryHit（toString 注入循环内计数——零生产码污染）
await page.evaluate(() => {
  const proto = window.__WhipProj.prototype;
  let src = proto.tryHit.toString();
  window.__scan = { loopN: 0, passGate: 0, aabbHit: 0, hurtCall: 0, firstReject: null };
  // 在敌怪循环体头注入:逐实体计数+首个被拒者的门名
  src = src.replace('for (const ent of', 'for (const ent of') // 占位（下行真注入
  const marker = 'const jellyVid =';
  src = src.replace(marker, `window.__scan.loopN++;
    { const _t = ent; if (_t) { const _pass = window.__playerCanHit ? window.__playerCanHit(_t) : true; } }
    ${marker}`);
  // hurt 调用计数:找 e.hurt( 或 hurt( 调用行
  src = src.replace('this.hitSet.add(e.id);', 'window.__scan.passGate++; this.hitSet.add(e.id);');
  const fn = eval('(' + src + ')');
  proto.tryHit = fn;
});
await page.evaluate(() => window.__mkWhip());
// ★钉住 611（鸟 AI aiStyle24 会飞离=几何假阴性;每帧归位+清速）
const pins = await page.evaluate(() => window.__swGame.entities.critters
  .filter((e) => e.vanillaId === 611).map((e) => ({ x: e.x, y: e.y })));
for (let i = 0; i < 35; i++) {
  await page.evaluate((pins2) => {
    const g = window.__swGame;
    let k = 0;
    for (const e of g.entities.critters) {
      if (e.vanillaId !== 611) continue;
      const p2 = pins2[k++] ?? pins2[0];
      e.x = p2.x; e.y = p2.y; e.vx = 0; e.vy = 0;
    }
    window.__frame();
  }, pins);
}
const wp = await page.evaluate(() => {
  const g = window.__swGame;
  const whips = g.entities.projectiles.filter((e) => e instanceof window.__WhipProj);
  return { ...window.__wp, hurtCalls: window.__hurtN, hitSetSize: whips[0]?.hitSet?.size ?? -1,
    whipAlive: whips.length, whipAi0: whips[0]?.ai0 };
});
console.log('插桩:', JSON.stringify(wp));
const pd = await page.evaluate(() => window.__ptsDump);
console.log('pts dump（ai0≈26 附近）:', JSON.stringify(pd));
const e0pos = await page.evaluate(() => {
  const c = window.__swGame.entities.critters.find((e) => e.vanillaId === 611);
  return c ? [Math.round(c.x), Math.round(c.y), c.w, c.h] : null;
});
console.log('猫头鹰位（驱动后）:', JSON.stringify(e0pos));
await page.evaluate(() => { window.__swGame.paused = true; });
const after = await page.evaluate(() => window.__swGame.entities.critters
  .filter((e) => e.vanillaId === 611)
  .map((e) => ({ hp: Math.round(e.hp), dead: e.dead })));
console.log('真链鞭后:', JSON.stringify(after.slice(0, 5)));
await browser.close();
