// ★BJ700-C 定谳探针：焰镰 329（Pumpking 弹）「纯白背景」像素取证。
//   Phase A（机制面,确定性）：页内微测 tintedTex(329 图, (200,200,200), flatten=true)
//     产物透明域像素值——BJ371 判例预测 = 不透明 (200,200,200)（canvas multiply
//     αb=0 域 Co=Cs,αo=1）,即 add 面 'lighter' 全幅加 200 = 白底根源。
//   Phase B（运行链,真实渲染）：夜空直造 Arrow(329,{scythe}) → g.frame 渲染 →
//     画布裁剪弹体区（BJ686 判例:page.screenshot 走合成层不可靠,裁 renderer.canvas）
//     → 近白像素普查（min(r,g,b)≥180）+ 弹体橙焰普查 + 背景参考（杀弹同位再裁）。
//     修前预测:近白 ≈ 6600+（75% 透明域 × 106×84）;修后预测:近白 ≤ ~500（弹体
//     内 468 白芯 texel）且背景参考差 ≈ 0。
// 用法: SW_ORIGIN=http://localhost:5209 node tools/run-diag.mjs scripts/_bj700c-scythe-alpha.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump, ledger, freezeClock } from '../tools/probe/lib/index.mjs';
import fs from 'node:fs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5209';
const L = ledger();
const OUT = '/tmp/bj700c-out';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 100));
const night = await freezeClock(page, { tod: 0.85 });          // 20:24 夜（昼窗 4:30-19:30 外）
L.chk('夜间钟面', night.ok && night.isDay === false, JSON.stringify(night));
await pump(page, 30);

// ---------- Phase A：tintedTex flatten=true 微测（机制面） ----------
const micro = await page.evaluate(async () => {
  const g = window.__swGame;
  const { projSprite } = await import('/src/entities/Arrow.ts');
  const { tintedTex } = await import('/src/render/StringLine.ts');
  // 等贴图加载
  const t0 = performance.now();
  while (!(projSprite(329)?.width > 0) && performance.now() - t0 < 5000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const img = projSprite(329);
  if (!img || !(img.width > 0)) return { ok: false, why: 'sprite-not-loaded' };
  const flat = tintedTex(img, [200, 200, 200], true);
  const keep = tintedTex(img, [200, 200, 200], false);
  if (!flat || !keep) return { ok: false, why: 'no-canvas' };
  const stat = (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let opaque = 0, trans = 0, transGrey = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) trans++;
      else {
        opaque++;
        // 透明域 texel(源 a=0)摊平后:rgb≈(200,200,200) a=255
        if (d[i] >= 190 && d[i] <= 210 && d[i + 1] >= 190 && d[i + 1] <= 210 && d[i + 2] >= 190 && d[i + 2] <= 210) transGrey++;
      }
    }
    return { total: d.length / 4, opaque, trans, greyOpaque: transGrey };
  };
  return { ok: true, src: `${img.width}x${img.height}`, flat: stat(flat), keep: stat(keep) };
}, {});
console.log('PhaseA tintedTex 微测:', JSON.stringify(micro));
L.chk('flatten=true 透明域成不透明染色底(BJ371 同机制)',
  micro.ok && micro.flat.opaque === micro.flat.total && micro.flat.greyOpaque > 5000,
  `flat=${JSON.stringify(micro.flat)}`);
L.chk('flatten=false 保 alpha 形状',
  micro.ok && micro.keep.trans > 5000 && micro.keep.opaque <= 3000,
  `keep=${JSON.stringify(micro.keep)}`);

// ---------- Phase B：运行链渲染取证 ----------
const vis = await page.evaluate(async () => {
  const g = window.__swGame;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const p = g.player;
  p.debugGod = true;
  // 夜空站位:地表上方 8 格
  const st = g.world.store;
  const surf = [];
  for (let tx = 40; tx <= 110; tx++) {
    for (let ty = 8; ty < st.h; ty++) { if (st.hasTile(tx, ty)) { surf.push(ty); break; } }
  }
  surf.sort((a, b) => a - b);
  const topRow = surf[Math.floor(surf.length / 2)];
  p.x = 60 * 16; p.y = (topRow - 10) * 16; p.vx = 0; p.vy = 0;
  g.camera.x = p.cx; g.camera.y = p.cy;
  const { Arrow } = await import('/src/entities/Arrow.ts');
  const SPX = p.cx, SPY = p.cy - 130;                       // 弹位:玩家上方 130px
  const scy = new Arrow(SPX - 40, SPY - 40, 0.01, 0.01, 60, 0, 329, {
    grav: 0, life: 420, pierce: 1, hostile: true,
    scythe: { rot0: 0, flipDir: 1 },
  });
  g.entities.add(scy, 'projectiles');
  // 泵 3 拍(AI 首步继承 rotation)+ 等贴图
  for (let i = 0; i < 3; i++) g.fixedUpdate(1 / 60);
  const t0 = performance.now();
  const { projSprite } = await import('/src/entities/Arrow.ts');
  while (!(projSprite(329)?.width > 0) && performance.now() - t0 < 5000) await wait(50);
  let vnow = performance.now();
  for (let f = 0; f < 3; f++) { vnow += 1000 / 60; g.frame(vnow); await wait(2); }
  await wait(80);
  vnow += 1000 / 60; g.frame(vnow); await wait(2);

  const cv = g.renderer.canvas;
  const crop = (label) => {
    const scr = g.camera.worldToScreen(scy.cx, scy.cy);
    const W = 240, H = 200;
    const x = Math.max(0, Math.min(cv.width - W, Math.round(scr[0]) - W / 2));
    const y = Math.max(0, Math.min(cv.height - H, Math.round(scr[1]) - H / 2));
    const cc = document.createElement('canvas');
    cc.width = W; cc.height = H;
    cc.getContext('2d').drawImage(cv, x, y, W, H, 0, 0, W, H);
    const d = cc.getContext('2d').getImageData(0, 0, W, H).data;
    let nearWhite = 0, orange = 0, visible = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 30) continue;
      visible++;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (Math.min(r, gg, b) >= 180) nearWhite++;
      if (r > 150 && gg > 40 && gg < r * 0.9 && b < r * 0.6) orange++;
    }
    return { label, nearWhite, orange, visible, png: cc.toDataURL('image/png'), at: [x, y] };
  };
  const withProj = crop('with-proj');
  scy.dead = true;                                          // 杀弹取背景参考
  vnow += 1000 / 60; g.frame(vnow); await wait(2);
  vnow += 1000 / 60; g.frame(vnow); await wait(40);
  const bgRef = crop('bg-ref');
  return {
    ok: true, projPos: [Math.round(scy.cx), Math.round(scy.cy)], canvas: [cv.width, cv.height],
    withProj: { nearWhite: withProj.nearWhite, orange: withProj.orange, visible: withProj.visible },
    bgRef: { nearWhite: bgRef.nearWhite, orange: bgRef.orange, visible: bgRef.visible },
    withProjPng: withProj.png, bgRefPng: bgRef.png,
  };
}, {});
console.log('\nPhaseB 渲染取证:', JSON.stringify({ ...vis, withProjPng: vis.withProjPng ? '<png>' : null, bgRefPng: vis.bgRefPng ? '<png>' : null }));
if (vis.withProjPng) fs.writeFileSync(`${OUT}/scythe-after.png`, Buffer.from(vis.withProjPng.split(',')[1], 'base64'));
if (vis.bgRefPng) fs.writeFileSync(`${OUT}/bg-ref.png`, Buffer.from(vis.bgRefPng.split(',')[1], 'base64'));
// 修前基线(2026-10-20 定谳跑):nearWhite=6634(bgRef=72)/orange=1178 —— 白底=8904 盒
//  透明域 6684 texel × (200,200,200) 加算;修后 nearWhite 应落回弹内白芯量级(<600)。
L.chk('白底已除:近白像素 < 600(修前=6634)',
  vis.withProj.nearWhite < 600,
  `withProj.nearWhite=${vis.withProj.nearWhite} (修前=6634, bgRef=${vis.bgRef.nearWhite})`);
L.chk('弹体可见(橙焰簇>100,修前=1178)',
  vis.withProj.orange > 100, `orange=${vis.withProj.orange}`);
L.chk('背景零污染:近白不高于背景参考+50',
  vis.withProj.nearWhite - vis.bgRef.nearWhite < 50,
  `withProj−bgRef=${vis.withProj.nearWhite - vis.bgRef.nearWhite}`);

await browser.close();
L.print();
process.exit(L.exitCode());
