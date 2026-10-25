// ★BJ708-A 实机探针：Xeno 法杖（2749）UFO 随从（423）攻击特效链——出弹 433 +
// 本体恒隐 + Kill 铺束 d160 双色行进尘（用户实报「召唤物没有攻击特效」）。
//
// 判据：
//   ①2749 使用 → 423 UFO 随从出生（SpawnMinionOnCursor）
//   ②423 射击支出 Arrow 433（whipTagShot=true——MinionShot 面,alpha=255 本体恒隐）
//   ③433 消亡（寿命尽/命中/撞块）→ d160 束尘落地：数量 ≥40、双色
//     （LimeGreen(50,205,50)/CornflowerBlue(100,149,237) 混布）、带内 scale
//   ④敌怪 hurt 落地（「能打」面保持）
//   ⑤截图：攻击帧束尘可视（docs/evidence/bj708a/）
// 用法(game/ 下): SW_ORIGIN=http://localhost:5248 node tools/run-diag.mjs scripts/_bj708a-xeno-fx-probe.mjs
import { mkdirSync } from 'node:fs';
import {
  launchBrowser, openPage, bootstrap, createGame, ledger, savePageShot, resolveShotPath,
} from '../tools/probe/lib/index.mjs';

const OUT = 'docs/evidence/bj708a';
const L = ledger();
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, process.env.SW_ORIGIN);
const gen = await createGame(page, { mode: 'direct', seed: 'bj708a', size: 'small' });
L.chk('世界已建', gen.ok);

// ---- 布景：Xeno 法杖 2749 槽 0 + 木桩靶（玩家东侧 220px,<400 射击门）----
const setup = await page.evaluate(async () => {
  const g = window.__swGame;
  g.paused = true;                                   // 手动逐拍驱动
  window.__swGame.enemySpawnEnabled = false;
  if (g.world.clock) g.world.clock.timeOfDay = 0.95; // 夜景（束尘对暗空可视,像素判据用）
  const staff = window.__swFlow.itemByVid(2749);
  if (!staff) return { err: 'item 2749 missing' };
  g.player.inv.slots[0] = { id: staff, stack: 1 };
  g.player.inv.selected = 0;
  g.player.useTime = 0;
  const { Enemy } = await import('/src/entities/Enemy.ts');
  const px = Math.trunc(g.player.cx), py = Math.trunc(g.player.cy);
  const st = g.world.store;
  let gy = Math.trunc(py / 16);
  while (gy < st.h - 2 && !st.isSolid(Math.trunc(px / 16), gy)) gy++;
  const groundY = gy;
  // 靶钉半空（夜空背景,离地 12 格——束尘双色对暗底判据的净噪面）
  const e = Enemy.fromVanilla(3, px + 220, (gy - 12) * 16 - 20);
  e.maxHp = 100000; e.hp = 100000; e.vx = 0; e.vy = 0;
  e.__swTag = 'target';
  g.entities.add(e, 'enemies');
  return { ok: true, px, py, groundY, ty: (gy - 12) * 16 - 20 };
});
L.chk('279 法杖+靶已布', !!setup.ok, JSON.stringify(setup));

// ---- 相位①：召唤 + 逐拍驱动到出弹/铺束（插桩 entities.add 捕获 433 全量）----
const phase1 = await page.evaluate(() => {
  const g = window.__swGame;
  const z = g.entities.enemies.find((e) => e.__swTag === 'target');
  if (!z) return { err: 'target missing' };
  // 相机+鼠标指向靶（SpawnMinionOnCursor 落点）
  g.camera.x = g.player.cx; g.camera.y = g.player.cy;
  const zoom = g.camera.zoom || 1;
  g.input.mouseX = 640 + 220 * zoom; g.input.mouseY = 400;
  g.input.mouseDown = true; g.input.mouseHeld = true;
  g.fixedUpdate(1 / 60);
  g.input.mouseDown = false; g.input.mouseHeld = false;
  const ufos0 = g.entities.projectiles.filter((p) => p.projId === 423 && !p.dead).length;
  // 插桩：捕获一切 433 出弹（含瞬死）
  const bolts = [];
  const rawAdd = g.entities.add.bind(g.entities);
  g.entities.add = (e, bucket) => {
    if (e && e.projId === 433) bolts.push({ alpha: e.alpha, whip: !!e.whipTagShot, x: e.x, y: e.y });
    return rawAdd(e, bucket);
  };
  const hurtLog = [];
  const rawHurt = z.hurt.bind(z);
  z.hurt = (dmg, ...rest) => { hurtLog.push(dmg); return rawHurt(dmg, ...rest); };
  let beamTick = -1, firstBoltTick = -1;
  const pin = () => { z.vx = 0; z.vy = 0; };          // 靶钉半空（夜空净噪面）
  for (let t = 0; t < 400; t++) {
    pin();
    g.fixedUpdate(1 / 60);
    if (firstBoltTick < 0 && bolts.length) firstBoltTick = t;
    if (beamTick < 0 && firstBoltTick >= 0) {
      const d160 = g.vanillaDust ? [...g.vanillaDust.each(false), ...g.vanillaDust.each(true)]
        .filter((d) => d.type === 160) : [];
      if (d160.length >= 10) { beamTick = t; break; }
    }
  }
  z.hurt = rawHurt;
  g.entities.add = rawAdd;
  const dusts = g.vanillaDust ? [...g.vanillaDust.each(false), ...g.vanillaDust.each(true)]
    .filter((d) => d.type === 160) : [];
  const cols = dusts.map((d) => d.color ? `${d.color.r},${d.color.g},${d.color.b},${d.color.a}` : 'none');
  const limeN = cols.filter((c) => c === '50,205,50,255').length;
  const cornN = cols.filter((c) => c === '100,149,237,255').length;
  const xs = dusts.map((d) => d.x), ys = dusts.map((d) => d.y);
  const span = xs.length
    ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0;
  const scaleOk = dusts.every((d) => d.scale >= 0.9 && d.scale <= 1.45);
  const ufoAlive = g.entities.projectiles.filter((p) => p.projId === 423 && !p.dead).length;
  return {
    ufos0, ufoAlive, bolts, firstBoltTick, beamTick, hurtN: hurtLog.length,
    hurtSum: hurtLog.reduce((a, b) => a + b, 0),
    d160: dusts.length, limeN, cornN, otherCol: cols.length - limeN - cornN,
    span, scaleOk,
  };
});
L.chk('①423 UFO 随从出生（2749 使用面）', phase1.ufos0 >= 1, JSON.stringify(phase1));
L.chk('②423 射出 433（瞬死也捕获;alpha=255 恒隐+whipTagShot）',
  phase1.bolts.length >= 1 && phase1.bolts.every((b) => b.alpha === 255 && b.whip),
  JSON.stringify(phase1.bolts));
L.chk('③Kill 铺束 d160 落地（≥40 双色,scale 带,束向展开——UFO 悬停顶上方下射,对角距为准）',
  phase1.d160 >= 40 && phase1.limeN >= 5 && phase1.cornN >= 5 && phase1.otherCol === 0
  && phase1.scaleOk && phase1.span > 60,
  JSON.stringify({ d160: phase1.d160, limeN: phase1.limeN, cornN: phase1.cornN,
    otherCol: phase1.otherCol, span: phase1.span, scaleOk: phase1.scaleOk }));
L.chk('④伤害面保持（hurt 落地）', phase1.hurtN >= 1 && phase1.hurtSum > 0,
  JSON.stringify({ hurtN: phase1.hurtN, hurtSum: phase1.hurtSum }));
await savePageShot(page, resolveShotPath(`${OUT}/bj708a-beam-frame.png`));

// ---- 相位②：束尘存活窗内再截一帧（~5 拍后,衰减中仍可视）----
const phase2 = await page.evaluate(() => {
  const g = window.__swGame;
  for (let t = 0; t < 5; t++) g.fixedUpdate(1 / 60);
  const dusts = [...g.vanillaDust.each(false), ...g.vanillaDust.each(true)]
    .filter((d) => d.type === 160);
  return { d160: dusts.length, scaleMid: dusts.length ? dusts[0].scale : 0 };
});
await savePageShot(page, resolveShotPath(`${OUT}/bj708a-beam-fading.png`));
L.chk('⑤束尘 5 拍后仍在衰减窗内（−0.11/t 存活 ~9 拍）', phase2.d160 > 0,
  JSON.stringify(phase2));

// ---- 相位③：束心特写（相机对准束段中点 + 2× 缩放,再触发一次攻击拍近景）----
const zoomShot = await page.evaluate(async () => {
  const g = window.__swGame;
  const dusts = () => [...g.vanillaDust.each(false), ...g.vanillaDust.each(true)]
    .filter((d) => d.type === 160);
  const ds = dusts();
  const cx = ds.length ? ds.reduce((a, d) => a + d.x, 0) / ds.length : g.player.cx;
  const cy = ds.length ? ds.reduce((a, d) => a + d.y, 0) / ds.length : g.player.cy;
  g.camera.x = cx; g.camera.y = cy; g.camera.zoom = 2; g.camera.zoomTarget = 2;
  // 再驱一拍渲染出近景帧（paused 下 fixedUpdate+render 由 savePageShot 的截帧兜底）
  return { cx, cy, d160: ds.length };
});
await savePageShot(page, resolveShotPath(`${OUT}/bj708a-beam-closeup.png`));
L.chk('⑥近景帧已截（束心对准）', zoomShot.d160 > 0, JSON.stringify(zoomShot));

L.print();
await browser.close();
process.exit(L.exitCode());
