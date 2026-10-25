// BJ709-A:星尘之龙「一直在抽搐」定谳探针(一次性)。
// 三嫌疑分离:
//   S0 身份链:物品通道(3531 Stardust Dragon Staff)召唤 → 625+626+627+628 四弹 +
//      buff 188 在位(物品→弹幕→AI_121 龙族身份全链凭证)
//   S1 静息抖动:无目标 90t 逐拍 dump——段位序列方差(位置抖)vs 帧序列(625-628
//      vanilla projFrames=1 无帧机 → 帧抖嫌疑在此证伪面)
//   S2 追击抖动:250px 外靶 + 150t——头速拉满(≤30px/t)下的段跟随形态
//   S3 判读:逐段「轴承翻转率」(每拍绕父段镜像=抽搐 signatures)/逐拍位移幅
//      (= interp 渲染摆幅上界,插值嫌疑的定量面)/旋转跳变幅
// interp A/B:SW_QUERY='?interp=0' 复跑——tick 域 dump 须逐位恒等(interp 纯渲染域)
// 用法:SW_ORIGIN=http://localhost:5249 node tools/run-diag.mjs scripts/_bj709a-dragon-twitch-probe.mjs
//       SW_QUERY='?interp=0' SW_ORIGIN=... 同上(A/B 臂)
import { launchBrowser, openPage, bootstrap, createGame, giveItems, godMode, front, waitForBridge } from '../tools/probe/lib/index.mjs';
import { spawnEnemy } from '../tools/probe/lib/entities.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5249';
const QUERY = process.env.SW_QUERY || '';
const TAG = QUERY.includes('interp=0') ? 'noInterp' : 'interpOn';

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN);
if (QUERY) {
  // A/B 臂:干净桥就绪后带 query 单次重启(★探针平台坑:pre-goto 再 bootstrap=
  // 双启竞态挂死,cleanStorage/IDB blocked 族——plain pre-goto 同挂,与 query 无关)
  await page.goto(`${ORIGIN}/${QUERY}&t=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ok = await waitForBridge(page, { timeout: 120000 });
  if (!ok) { console.error(`[boot ${TAG}] bridge-timeout`); await browser.close(); process.exit(1); }
}
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261024 });
await giveItems(page, [{ vid: 3531, stack: 1, slot: 0 }], { wipe: true, select: 0 });
await godMode(page, true);
await front(page);

// ---- S0:物品通道召唤(3531 按住 50t,useAnimation=36) ----
const s0 = await page.evaluate(async () => {
  const g = window.__swGame;
  g.entities.enemies.length = 0;                 // 净场(夜间刷怪相位污染防御)
  g.entities.projectiles.length = 0;
  g.input.mouseX = 900; g.input.mouseY = 400;    // 瞄玩家右侧空地(可达区内)
  g.input.rightDown = false;
  g.input.mouseDown = true;
  for (let t = 0; t < 50; t++) g.fixedUpdate(1 / 60);
  g.input.mouseDown = false;
  const drag = g.entities.projectiles.filter((e) => e.projId >= 625 && e.projId <= 628 && !e.dead);
  const { buffTypeByVanilla } = await import('/src/stats/Buffs.ts');
  const bt188 = buffTypeByVanilla(188);
  return {
    n: drag.length, ids: drag.map((e) => e.projId),
    slots: drag.map((e) => e.noSlot),
    interp: g.constructor.interp,
    buff188: bt188 !== undefined ? g.player.buffs.has(bt188) : 'no-def',
  };
});
console.log(`[S0 ${TAG}]`, JSON.stringify(s0));

// ---- 逐拍 dump 核(页内跑,防协议超时) ----
const dumpFn = () => {
  const g = window.__swGame;
  const rows = [];
  for (let t = 0; t < 90; t++) {
    g.fixedUpdate(1 / 60);
    const ents = g.entities.projectiles.filter((e) => e.projId >= 625 && e.projId <= 628 && !e.dead);
    const rec = { t };
    for (const e of ents) {
      const par = e.parentRef ? e.parentRef() : null;
      rec['p' + e.projId] = [+e.cx.toFixed(2), +e.cy.toFixed(2), +e.rot.toFixed(3),
        par ? par.projId : -1];
      if (e.projId !== 625) rec['d' + e.projId] = par ? +Math.hypot(e.cx - par.cx, e.cy - par.cy).toFixed(2) : -1;
    }
    rows.push(rec);
  }
  return rows;
};

// ---- S1:静息(无目标) ----
const s1 = await page.evaluate(dumpFn);
console.log(`[S1 ${TAG}] rows=${s1.length} first=${JSON.stringify(s1[0])} last=${JSON.stringify(s1[s1.length - 1])}`);

// ---- S2:追击(250px 外 King Slime 静靶) ----
const px = await page.evaluate(() => ({ x: window.__swGame.player.cx, y: window.__swGame.player.cy }));
const boss = await spawnEnemy(page, 50, px.x + 250, px.y, (e) => { e.knockBackResist = 0; });
console.log(`[S2 ${TAG}] boss=${JSON.stringify(boss)}`);
const s2 = await page.evaluate(dumpFn);
console.log(`[S2 ${TAG}] rows=${s2.length} first=${JSON.stringify(s2[0])} mid=${JSON.stringify(s2[45])} last=${JSON.stringify(s2[s2.length - 1])}`);

// ---- S2.5:延伸龙(再召唤 → 尾前插 626+627,tier 3→5,间距 16×1.05) ----
// 基础 maxMinions=1:头 1 槽+插段 0.5×2=2 槽超限 → 缩水段摘链(原版 :16812-16845
// 同相)→ 先抬 maxMinions=3 让插段存活,量延伸链形态
const s25 = await page.evaluate(() => {
  const g = window.__swGame;
  g.player.modMinionAddDyn = 2;   // maxMinions 是 getter(1+buff+装备),直写无效——走可写字段 +2
  g.input.mouseX = 900; g.input.mouseY = 400;
  g.input.mouseDown = true;
  for (let t = 0; t < 50; t++) g.fixedUpdate(1 / 60);
  g.input.mouseDown = false;
  const drag = g.entities.projectiles.filter((e) => e.projId >= 625 && e.projId <= 628 && !e.dead);
  return { n: drag.length, ids: drag.map((e) => e.projId) };
});
console.log(`[S2.5 ${TAG}] extend=${JSON.stringify(s25)}`);

// ---- S3:判读(node 侧算指标) ----
const wrapPi = (a) => { let x = a; while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
const analyze = (rows, label) => {
  const segIds = [626, 627, 628];
  const out = { label, head: {}, segs: {} };
  // 头基线
  {
    const jumps = [], rjumps = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1].p625, b = rows[i].p625;
      if (!a || !b) continue;
      jumps.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
      rjumps.push(Math.abs(wrapPi(b[2] - a[2])));
    }
    const mean = (xs) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
    out.head = { jumpMean: +mean(jumps).toFixed(2), jumpMax: +Math.max(0, ...jumps).toFixed(2),
      rotJumpMean: +mean(rjumps).toFixed(3) };
  }
  for (const sid of segIds) {
    let flips = 0, pairs = 0, distSum = 0, distN = 0;
    const jumps = [], rjumps = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1]['p' + sid], b = rows[i]['p' + sid];
      const pa = rows[i - 1]['p' + a?.[3]], pb = rows[i]['p' + b?.[3]];
      if (!a || !b || !pa || !pb) continue;
      // rel = 段 − 父(轴承向量)
      const rax = a[0] - pa[0], ray = a[1] - pa[1], rbx = b[0] - pb[0], rby = b[1] - pb[1];
      if (rax * rbx + ray * rby < 0) flips++;
      pairs++;
      jumps.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
      rjumps.push(Math.abs(wrapPi(b[2] - a[2])));
      const dd = rows[i]['d' + sid];
      if (dd >= 0) { distSum += dd; distN++; }
    }
    const mean = (xs) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
    out.segs[sid] = {
      flipRate: +(flips / Math.max(1, pairs)).toFixed(3),
      jumpMean: +mean(jumps).toFixed(2), jumpMax: +Math.max(0, ...jumps).toFixed(2),
      rotJumpMean: +mean(rjumps).toFixed(3), rotJumpMax: +Math.max(0, ...rjumps).toFixed(3),
      distMean: +(distSum / Math.max(1, distN)).toFixed(2),
    };
  }
  return out;
};
const m1 = analyze(s1, 'idle');
const m2 = analyze(s2, 'chase');
console.log(`[S3 ${TAG}] idle=${JSON.stringify(m1)}`);
console.log(`[S3 ${TAG}] chase=${JSON.stringify(m2)}`);

// ---- S3.5:延伸链判读(S2.5 后 6 段龙) ----
const s25rows = await page.evaluate(dumpFn);
const m25 = analyze(s25rows, 'extended');
console.log(`[S3 ${TAG}] extended=${JSON.stringify(m25)}`);

// ---- 判语(阈值:镜像振荡=flipRate>0.9 且 jumpMax>25 且 rotJumpMax>2.5) ----
const segsBad = (m) => [626, 627, 628].some((id) => m.segs[id]
  && m.segs[id].flipRate > 0.9 && m.segs[id].jumpMax > 25 && m.segs[id].rotJumpMax > 2.5);
console.log(`[VERDICT ${TAG}] idleTwitch=${segsBad(m1)} chaseTwitch=${segsBad(m2)} (true=镜像振荡实报,false=平滑)`);

await browser.close();
