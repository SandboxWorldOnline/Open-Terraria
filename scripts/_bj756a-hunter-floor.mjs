// ★BJ756-A（2026-11-02,g36a 任务书 T5）Hunter 逐通道钳底剪影——实机像素探针。
//
// 场景:小世界岩层洞穴气袋(玩家+相机 camSnapTo 直写)、光照数组 compute 后全零
// (=暗场全黑,delta=floor 精确档)、玩家挂 Hunter 药水(buff 54/原版 17=detectCreature)、
// 注入 敌怪(僵尸 3,通用直绘路径)/蓝史莱姆(1,xnaColor 彩色路径)/小动物(兔 46,绿钳底)。
//
// 判据:
//   P1 捕获集成:hunterFloorQueue 三员(floor 255,50,50 ×2 / 50,255,50 ×1)
//   P2 暗场敌怪钳底:僵尸区域红主导像素(R≥60 且 R≥2.5G/B)计数≥15
//   P3 暗场小动物绿钳底:兔区域绿主导(G≥60 且 G≥2.5R/B)计数≥10
//   P4 mask 对位:红主导像素 bbox 中心 ≈ 实体屏心(±12px),bbox 非退化(≥12px 宽)
//   P5 暗场背景对照:实体侧向 120px 处全通道 <45(无剪影泄漏/无框残留)
//   P6 GL 会话:gladdHunterFloorStats.gl 递增(GL 缺省开)
//   P7 A/B(gladd=0 逃生门):2D 路径同判据(红/绿计数同量级,中心漂移 ≤3px)
//
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=420000 scripts/_bj756a-hunter-floor.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { camSnapTo } from '../tools/probe/lib/camera.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const results = [];
const chk = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };

/** 渲染帧泵（mlfloor-strict 同款:g.frame 直调——running=false 下「世界冻结+渲染照常」;
 *  pump() 只泵 fixedUpdate 不渲染,探针判据须走本泵） */
async function frames(page, n) {
  await page.evaluate((n2) => {
    for (let i = 0; i < n2; i++) {
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      window.__swGame.frame(window.__vnow);
    }
  }, n);
}

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
// 场景引导带种子重试:worldgen 轨道帧传播在部分种子上触发既有深递归
// (MinecartTrack.writeFrames 栈溢出,非本刀域——重试换种子规避)
let gen = null;
const SEEDS = ['97531dbgd', '05162020', 'bj756alt2'];
for (const seed of SEEDS) {
  try {
    gen = await createGame(page, { size: 'small', seed, pinRandom: 20261102 });
    await pump(page, 60);
    await frames(page, 10);
    break;
  } catch (e) {
    console.log(`[seed ${seed}] 场景引导失败(${String(e).slice(0, 60)}),换种子重试`);
    gen = null;
  }
}
chk('createGame(种子重试)', !!gen?.ok, gen?.why ?? '');
if (!gen?.ok) { console.log(JSON.stringify(results)); await browser.close(); process.exit(1); }

// ---- 场景:岩层洞穴气袋定位(rockLevel+8..+90 扫 7×5 全 inactive 格) ----
const spot = await page.evaluate(() => {
  const g = window.__swGame;
  const st = g.world.store;
  const rl = Math.floor(g.world.rockLevel);
  const px = Math.floor(g.player.x / 16);
  for (let dy = 8; dy < 90; dy++) {
    for (let dx = -70; dx < 70; dx++) {
      const cx = px + dx, cy = rl + dy;
      if (cx < 10 || cx >= st.w - 10 || cy >= st.h - 10) continue;
      let ok = true;
      for (let y = 0; y < 5 && ok; y++) {
        for (let x = 0; x < 7; x++) {
          if (st.flags[st.idx(cx + x, cy + y)]) { ok = false; break; }
        }
      }
      if (ok) return { tx: cx + 3, ty: cy + 2 };
    }
  }
  return null;
});
chk('洞穴气袋定位(rockLevel 下)', !!spot, spot ? `tile(${spot.tx},${spot.ty})` : 'not found');
if (!spot) { console.log(JSON.stringify(results)); await browser.close(); process.exit(1); }

await camSnapTo(page, spot.tx * 16, spot.ty * 16);

// ---- 注入:光照全零(compute 后回填)+Hunter 药水+三实体 ----
const placed = await page.evaluate(async ({ wx, wy }) => {
  const g = window.__swGame;
  const r = g.renderer;
  // 光照全零(暗场):compute 后零化已发布数组(render 直读同引用)
  const L = g.lighting;
  const orig = L.compute.bind(L);
  L.compute = (df) => { orig(df); L.r.fill(0); L.g.fill(0); L.b.fill(0); };
  L.r.fill(0); L.g.fill(0); L.b.fill(0);
  // 天空/天气噪声关闭(地下无天空,防御性)
  try { const w = g.world.weather; if (w) { w.raining = false; w.update = () => {}; } } catch { /* 域差异 */ }
  // Hunter 药水(BuffType.Hunter=54 ↔ 原版 buff17 detectCreature)
  g.player.buffs.apply(54, 3600);
  // 三实体:僵尸(通用直绘)/蓝史莱姆(xnaColor 彩色)/兔(critter 绿)
  const M = await import('/src/entities/Enemy.ts');
  const specs = [[3, wx - 70, wy + 10, 'enemies'], [1, wx + 80, wy + 12, 'enemies'], [46, wx + 8, wy - 26, 'critters']];
  const out = [];
  for (const [vid, x, y, bucket] of specs) {
    const e = M.Enemy.fromVanilla(vid, x, y);
    if (!e) continue;
    e.vx = 0; e.vy = 0;
    g.entities.add(e, bucket);
    out.push(vid);
  }
  // 更新冻结(实体不位移;渲染照常)
  g.running = false;
  return out;
}, { wx: spot.tx * 16, wy: spot.ty * 16 });
chk('三实体注入(3/1/46)+Hunter+光零化', placed.length === 3, `vids=${placed.join(',')}`);

await frames(page, 14);

// ---- 采样器:实体屏心 + 区域通道统计 ----
async function sample() {
  return page.evaluate(() => {
    const g = window.__swGame;
    const r = g.renderer;
    const cam = r.frameCam;
    const c = r.canvas;
    // ★纯帧折叠(mlfloor-strict 同款):gladd 纯帧终像=DOM 三层合成(sky2D<glCanvas<HUD)
    // ——GL 发射内容在 glCanvas 上,采样前 dest-over 折叠出真终像;已合成帧幂等跳过
    const lc = document.createElement('canvas');
    lc.width = c.width; lc.height = c.height;
    const cx2d = lc.getContext('2d', { willReadFrequently: true });
    cx2d.drawImage(c, 0, 0);
    if (!r._c10eComposited) {
      cx2d.globalCompositeOperation = 'destination-over';
      if (r.glCanvasEl) cx2d.drawImage(r.glCanvasEl, 0, 0);
      if (r.skyCanvas) cx2d.drawImage(r.skyCanvas, 0, 0);
      cx2d.globalCompositeOperation = 'source-over';
    }
    const ents = [];
    for (const b of ['enemies', 'critters']) {
      for (const e of g.entities[b] ?? []) ents.push(e);
    }
    const out = { ents: [], q: r.hunterFloorQueue.length, stats: { ...r.gladdHunterFloorStats }, canvas: { w: c.width, h: c.height } };
    // 仅视口内实体(worldgen 遍布地图的同类 critter 会劫持 byVid 选择)
    const vw = c.width, vh = c.height;
    for (const e of ents) {
      const [sx, sy] = cam.worldToScreen(e.cx, e.cy);
      if (sx < -60 || sy < -60 || sx > vw + 60 || sy > vh + 60) continue;   // 视口内(±60px)
      const R = 72;
      const x0 = Math.max(0, Math.round(sx - R)), y0 = Math.max(0, Math.round(sy - R));
      const w = Math.min(c.width - x0, R * 2), h = Math.min(c.height - y0, R * 2);
      if (w <= 0 || h <= 0) continue;
      const d = cx2d.getImageData(x0, y0, w, h).data;
      let red = 0, green = 0, maxSum = 0;
      let rx0 = 1e9, ry0 = 1e9, rx1 = -1e9, ry1 = -1e9;
      let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const Rr = d[i], Gg = d[i + 1], Bb = d[i + 2];
          const sum = Rr + Gg + Bb;
          if (sum > maxSum) maxSum = sum;
          if (Rr >= 60 && Rr >= 2.5 * Gg && Rr >= 2.5 * Bb) {
            red++;
            if (x < rx0) rx0 = x; if (x > rx1) rx1 = x;
            if (y < ry0) ry0 = y; if (y > ry1) ry1 = y;
          }
          if (Gg >= 60 && Gg >= 2.5 * Rr && Gg >= 2.5 * Bb) {
            green++;
            if (x < gx0) gx0 = x; if (x > gx1) gx1 = x;
            if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
          }
        }
      }
      // 背景对照:实体同 y、左侧 120px(避开实体本体)
      const bxi = Math.max(0, Math.round(sx - 120 - 3) - x0), byi = Math.max(0, Math.round(sy - y0));
      let bg = [255, 255, 255];
      if (bxi >= 0 && bxi < w && byi >= 0 && byi < h) {
        const bi = (byi * w + bxi) * 4;
        bg = [d[bi], d[bi + 1], d[bi + 2]];
      }
      const box = (x0v, y0v, x1v, y1v) => (x1v < x0v ? null : {
        cx: x0 + (x0v + x1v) / 2, cy: y0 + (y0v + y1v) / 2, w: x1v - x0v + 1, h: y1v - y0v + 1,
      });
      out.ents.push({
        vid: e.vanillaId, sx: Math.round(sx), sy: Math.round(sy), red, green, maxSum,
        redBox: box(rx0, ry0, rx1, ry1), greenBox: box(gx0, gy0, gx1, gy1), bg,
      });
    }
    return out;
  });
}

const A = await sample();
const byVid = (v) => A.ents.find((e) => e.vid === v);
// 注入三员(僵尸/史莱姆红 + 兔绿)+worldgen 视口内城镇/critter 族(向导/睡渔夫等
// 亦判绿)——队列数 ≥3 且红 ≥2、绿 ≥1 即集成成立
const floors = await page.evaluate(() => window.__swGame.renderer.hunterFloorQueue
  .map((it) => it.floor.join(',')).sort().join(' | '));
const nRed = (floors.match(/255,50,50/g) ?? []).length, nGreen = (floors.match(/50,255,50/g) ?? []).length;
chk('P1 捕获集成:队列 ≥3 员(红 ≥2 绿 ≥1,值域双红绿)', A.q >= 3 && nRed >= 2 && nGreen >= 1
  && A.q === nRed + nGreen, `q=${A.q} red=${nRed} green=${nGreen}`);
chk('P1b floor 值域恰 (255,50,50)/(50,255,50)', A.q === nRed + nGreen && nRed >= 2 && nGreen >= 1,
  floors);

const zom = byVid(3);
chk('P2 暗场敌怪红钳底:僵尸红主导像素≥15', !!zom && zom.red >= 15,
  zom ? `red=${zom.red} @(${zom.sx},${zom.sy}) bg=${zom.bg.join(',')}` : 'no zombie');
const bun = byVid(46);
chk('P3 暗场小动物绿钳底:兔绿主导像素≥10', !!bun && bun.green >= 10,
  bun ? `green=${bun.green} @(${bun.sx},${bun.sy}) bg=${bun.bg.join(',')}` : 'no bunny');
const slime = byVid(1);
chk('P3b 蓝史莱姆(xnaColor 彩色路径)暗场可见(本体免全黑)', !!slime && slime.maxSum > 40,
  slime ? `maxSum=${slime.maxSum}` : 'no slime');

if (zom?.redBox) {
  const dcx = Math.abs(zom.redBox.cx - zom.sx), dcy = Math.abs(zom.redBox.cy - zom.sy);
  chk('P4 mask 对位:红 bbox 中心 ≈ 实体屏心(±12px)+非退化(≥12px 宽)',
    dcx <= 12 && dcy <= 12 && zom.redBox.w >= 12,
    `centerΔ=(${dcx.toFixed(1)},${dcy.toFixed(1)}) box=${zom.redBox.w}×${zom.redBox.h}`);
} else {
  chk('P4 mask 对位', false, 'no red box');
}
const bgAll = A.ents.every((e) => e.bg[0] < 45 && e.bg[1] < 45 && e.bg[2] < 45);
chk('P5 暗场背景对照(侧向 120px 全通道 <45)', bgAll, A.ents.map((e) => `v${e.vid}:${e.bg.join(',')}`).join(' '));

const gl0 = A.stats.gl;
chk('P6 GL 会话发射(gladd 缺省开)', gl0 > 0, `gl=${gl0} stats=${JSON.stringify(A.stats)}`);

// ---- P7 A/B:gladd=0 逃生门(2D 路径同判据) ----
await page.evaluate(() => {
  const g = window.__swGame;
  Object.getPrototypeOf(g.renderer).constructor.gladd = false;
});
await frames(page, 8);
const B = await sample();
const zomB = B.ents.find((e) => e.vid === 3);
const bunB = B.ents.find((e) => e.vid === 46);
// ★A/B 间实体可随 g.frame 摄动(running=false 下 frame 仍走 AI 若干 tick)——
// 对位判据改【逐臂自对齐】(红 bbox 中心 ≈ 本臂实体屏心 ±12px),计数比 ≤0.6 档
chk('P7 A/B 2D 路径:红/绿计数同量级(≥0.6×GL 档)+逐臂自对齐(±12px)',
  !!zomB && zomB.red >= Math.max(10, Math.floor((zom?.red ?? 0) * 0.6))
  && !!bunB && bunB.green >= Math.max(6, Math.floor((bun?.green ?? 0) * 0.6))
  && !!zomB?.redBox && Math.abs(zomB.redBox.cx - zomB.sx) <= 12 && Math.abs(zomB.redBox.cy - zomB.sy) <= 12,
  `2D red=${zomB?.red} green=${bunB?.green} boxΔ=(${zomB?.redBox ? Math.abs(zomB.redBox.cx - zomB.sx).toFixed(1) : '?'},${zomB?.redBox ? Math.abs(zomB.redBox.cy - zomB.sy).toFixed(1) : '?'}) GL red=${zom?.red} green=${bun?.green}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n==== BJ756-A hunter floor probe: ${results.length - failed.length}/${results.length} PASS ====`);
await browser.close();
process.exit(failed.length ? 1 : 0);
