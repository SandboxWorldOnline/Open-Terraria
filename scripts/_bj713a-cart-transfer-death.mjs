/**
 * ★BJ713-A 登记债清偿·断路域收官探针（G34 登记债①②——骑矿车召回拖回/死亡不卸车）。
 *
 * 复现口径（修前行为,G34 过程观察）:
 *  ① 骑矿车魔镜召回 → fireRecallTeleport 落位后 Minecart.fixedUpdate 每拍把玩家
 *    锁回车位（玩家坐骑位回写段,entities.update 在 player 后同拍）= 传送失效;
 *  ② p.dead 后矿车仍 mounted → 尸体随车/重生被拖回。
 * 判门（修后应全绿）:
 *  A. 魔镜召回:玩家离开远轨区且【保持骑乘】（vanilla Teleport/Spawn 零 Dismount,
 *     矿车=mount 态整体随迁）+ 车同落出生点 + lavaImmuneTicks=聚合(0+420);
 *  B. 死亡:cart 引用即清+尸位静止（车给 vx=10 也不漂移）+ 重生步行初值。
 * 运行:SW_ORIGIN=http://localhost:5257 node tools/run-diag.mjs scripts/_bj713a-cart-transfer-death.mjs
 */
import { mkdirSync } from 'node:fs';
import { launchBrowser, openPage, bootstrap, createGame, pump, godMode, clearEnemies, callGame, Ledger } from '../tools/probe/lib/index.mjs';

const L = new Ledger();
mkdirSync(process.env.SW_PROBE_OUT ?? '/tmp/probe-out/_bj713a', { recursive: true });

const browser = await launchBrowser();
const page = await openPage(browser, { errors: L.fails });
page.__probeOrigin = process.env.SW_ORIGIN;
const boot = await bootstrap(page, process.env.SW_ORIGIN);
L.chk('bootstrap', boot.ok, boot.why ?? '');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('createGame', gen.ok, gen.why ?? '');
await godMode(page, true);
await clearEnemies(page);
await pump(page, 30, { clearEnemies: true });

// ---- 场景:出生点东侧 300 格地表铺轨（远轨区=判别距离） ----
// ★铺轨走仓内 id 域:MT.placeTrack+frameTrackArea（bj30 判例 idiom）——裸
//  setTile(x,y,314) 写的是本地 id 314≠轨道=异型格,mountMinecartAt 走无轨 fallback。
const prep = await page.evaluate(async () => {
  const g = window.__swGame;
  const st = g.world.store;
  const MT = await import('/src/world/MinecartTrack.ts');
  const spawnX = Math.floor(g.world.spawnX);
  const surf = Math.ceil(g.world.groundLevel);
  const px = Math.min(spawnX + 300, st.w - 60);
  for (let x = px - 40; x <= px + 40; x++) {
    for (let y = surf - 8; y <= surf + 2; y++) st.setTile(x, y, 0);
    for (let y = surf; y <= surf + 1; y++) st.setTile(x, y, 1);
    st.setLiquid(x, surf - 1, 0, 0);
  }
  for (let x = px - 20; x <= px + 20; x++) { MT.placeTrack(st, x, surf - 1, 0); MT.frameTrackArea(st, x, surf - 1); }
  g.player.x = px * 16; g.player.y = (surf - 4) * 16;
  g.player.vx = 0; g.player.vy = 0;
  return { px, surf, spawnX, spawnY: Math.floor(g.world.spawnY) };
});
await pump(page, 20, { clearEnemies: true });
L.say(`prep: 远轨区@(${prep.px}, 轨y=${prep.surf - 1}) vs spawn@(${prep.spawnX}, ${prep.spawnY}) Δ=${prep.px - prep.spawnX} tiles`);

// ---- 骑 Hell 车(22) ----
const mount = await callGame(page, 'mountMinecartAt', prep.px - 5, prep.surf - 1, 22);
L.chk('mountMinecartAt(Hell 22)', mount.ok === true && mount.value === true, JSON.stringify(mount));
await pump(page, 30, { clearEnemies: true });
const ride = await page.evaluate(() => {
  const g = window.__swGame, p = g.player;
  return { ridingCart: p.ridingCart, mounted: g.minecart?.mounted, mountId: g.minecart?.mountId,
    onTrack: g.minecart?.onTrackNow, lavaBonus: p.cartLavaMaxBonus,
    tx: Math.floor(p.x / 16), dead: p.dead };
});
L.chk('骑乘态(Hell 车 22 贴轨)', ride.ridingCart === true && ride.mountId === 22 && ride.onTrack === true, JSON.stringify(ride));
L.chk('G34-D2 链头(cartLavaMaxBonus=420)', ride.lavaBonus === 420, `lavaBonus=${ride.lavaBonus}`);
const trackTx = ride.tx;

// =========== 债② 死亡不卸车（先测:杀于远轨区,判尸位静止） ===========
// 车预置 vx=10:修前矿车死后照跑 → 尸体沿轨漂移;修后 settlePlayerDeath 即卸=尸位静止。
const kill = await page.evaluate(() => {
  const g = window.__swGame, p = g.player;
  p.debugGod = false;          // 探针 godMode 每 tick 回满会拦 hp<=0 面,先关
  if (g.minecart) g.minecart.vx = 10;
  p.hp = 0;
  return { hp: p.hp };
});
await pump(page, 6, { clearEnemies: false });
const corpseA = await page.evaluate(() => {
  const g = window.__swGame, p = g.player;
  return { dead: p.dead, ridingCart: p.ridingCart, cart: !!g.minecart,
    tx: Math.floor(p.x / 16), lavaBonus: p.cartLavaMaxBonus };
});
L.chk('债② 死亡即卸车(cart 引用清+骑乘态解除+提帽解除)',
  corpseA.dead === true && corpseA.cart === false && corpseA.ridingCart === false && corpseA.lavaBonus === 0,
  JSON.stringify(corpseA));
await pump(page, 25, { clearEnemies: false });   // 尸位漂移窗（修前车 vx=10 沿轨滚动拖尸）
const corpseB = await page.evaluate(() => {
  const p = window.__swGame.player;
  return { tx: Math.floor(p.x / 16), dead: p.dead };
});
L.chk('债② 尸位静止（不随车漂移）',
  corpseB.dead === true && corpseB.tx === corpseA.tx, `deathTx=${corpseA.tx} → ${corpseB.tx}`);

// ---- 重生:步行初值（不被旧车位拖回） ----
await page.evaluate(() => { window.__swGame.player.respawnTimer = 2; });
await pump(page, 10, { clearEnemies: true });
const respawn = await page.evaluate(() => {
  const g = window.__swGame, p = g.player;
  return { dead: p.dead, ridingCart: p.ridingCart, cart: !!g.minecart,
    tx: Math.floor(p.x / 16) };
});
L.chk('债② 重生步行初值（alive+不骑+无车）',
  respawn.dead === false && respawn.ridingCart === false && respawn.cart === false,
  JSON.stringify(respawn));

// =========== 债① 骑矿车魔镜召回（返远轨区再上车） ===========
await page.evaluate((px, surf) => {
  const g = window.__swGame, p = g.player;
  p.x = px * 16; p.y = (surf - 4) * 16;
  p.vx = 0; p.vy = 0;
}, prep.px, prep.surf);
await pump(page, 6, { clearEnemies: true });
const mount2 = await callGame(page, 'mountMinecartAt', prep.px - 5, prep.surf - 1, 22);
L.chk('二次上车', mount2.ok === true && mount2.value === true, JSON.stringify(mount2));
await pump(page, 30, { clearEnemies: true });
const ride2 = await page.evaluate(() => {
  const g = window.__swGame, p = g.player;
  return { ridingCart: p.ridingCart, tx: Math.floor(p.x / 16), lavaBonus: p.cartLavaMaxBonus };
});
L.chk('二次骑乘态', ride2.ridingCart === true && ride2.lavaBonus === 420, JSON.stringify(ride2));

// 魔镜召回（直驱传送执行点 fireRecallTeleport=通道触发拍同函数;引导期通道尘不在判门内）
const recall = await callGame(page, 'fireRecallTeleport', { vid: 50, kind: 'spawn', triggerAt: 1, consume: false });
L.chk('fireRecallTeleport(魔镜 spawn 支)', recall.ok, recall.why ?? '');
await pump(page, 45, { clearEnemies: true });   // 拖回窗:修前同拍 entities.update 即锁回
const after = await page.evaluate(() => {
  const g = window.__swGame, p = g.player;
  const c = g.minecart;
  return { ridingCart: p.ridingCart, dead: p.dead,
    tx: Math.floor(p.x / 16), ty: Math.floor(p.y / 16),
    cartMounted: c?.mounted ?? null, cartTx: c ? Math.floor(c.x / 16) : null,
    lavaBonus: p.cartLavaMaxBonus, lavaImmune: p.lavaImmuneTicks };
});
L.chk('债① 传送成立（玩家离开远轨区,不再被车拖回）',
  Math.abs(after.tx - trackTx) > 200 && Math.abs(after.tx - prep.spawnX) < 60,
  `trackTx=${trackTx} → playerTx=${after.tx}（spawnX=${prep.spawnX}）`);
L.chk('债① 落点仍在车上（vanilla 不卸 mount,车同落）',
  after.ridingCart === true && after.cartMounted === true && after.cartTx === after.tx,
  JSON.stringify(after));
L.chk('G34① lava 聚合面（lavaImmuneTicks=0+420）',
  after.lavaImmune === 420 && after.lavaBonus === 420,
  `lavaImmune=${after.lavaImmune} bonus=${after.lavaBonus}`);

console.log('\n==== BJ713-A 探针判门完毕 ====');
await browser.close();
