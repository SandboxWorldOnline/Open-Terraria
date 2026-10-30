// ★BJ738 微光湖网格感探针 v5:【自然微光湖】复现(生成世界扫 liquidType=4 找湖,
// 玩家悬湖心上方+Shine 光源,相机随玩家;表面/深部条带梯度线检测)。
// 运行:node tools/run-diag.mjs --timeout=480000 scripts/_shimmer-grid-repro.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { writeFileSync } from 'node:fs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:4173';
const OUT = '/Users/vinlic/.claude/jobs/d3098226/tmp';
const browser = await launchBrowser({});

async function arm(flags) {
  const page = await openPage(browser, { width: 1280, height: 800 });
  // ★旗须经预导航透传(bootstrap 只收 origin;query 拼进 origin 会畸变=旗失明判例)
  await page.goto(`${ORIGIN}/?cloudcache=0${flags ? '&' + flags : ''}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await bootstrap(page, ORIGIN);
  const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261030 });
  if (!gen?.ok) { console.log('createGame fail', gen?.why); await page.close(); return null; }
  await pump(page, 60);
  // ---- 扫描自然微光湖 ----
  const lake = await page.evaluate(() => {
    const g = window.__swGame;
    const st = g.world.store;
    // 全图扫 liquidType=4,按 32 格列带聚合找最大簇
    const cols = new Map();
    let total = 0;
    for (let y = 0; y < st.h; y += 1) {
      const row = y * st.w;
      for (let x = 0; x < st.w; x += 1) {
        const i = row + x;
        if (st.liquid[i] > 0 && st.liquidType[i] === 4) {
          const band = Math.floor(x / 32);
          const e = cols.get(band) ?? { n: 0, minY: 1e9, maxY: -1, minX: 1e9, maxX: -1 };
          e.n++; e.minY = Math.min(e.minY, y); e.maxY = Math.max(e.maxY, y);
          e.minX = Math.min(e.minX, x); e.maxX = Math.max(e.maxX, x);
          cols.set(band, e); total++;
        }
      }
    }
    let best = null;
    for (const [band, e] of cols) if (!best || e.n > best.n) best = { band, ...e };
    if (!best) return null;
    // 湖心列:簇内中心列;表面=该列簇内最顶行
    const cx = Math.floor((best.minX + best.maxX) / 2);
    let sy = -1;
    for (let y = best.minY; y <= best.maxY; y++) {
      const i = st.idx(cx, y);
      if (st.liquid[i] > 0 && st.liquidType[i] === 4) { sy = y; break; }
    }
    window.__lake = { cx, sy, minY: best.minY, maxY: best.maxY, minX: best.minX, maxX: best.maxX, n: best.n };
    return window.__lake;
  });
  if (!lake) { console.log('未找到自然微光湖'); await page.close(); return null; }
  console.log('湖:', JSON.stringify(lake));
  await page.evaluate((zoomArg) => {
    const g = window.__swGame;
    const p = g.player;
    const L = window.__lake;
    // 玩家悬湖心表面上方 2.5 格(相机随玩家=湖心;Shine 光)
    window.__poolX = L.cx * 16 + 8;
    window.__surfY = L.sy * 16;
    window.__plY = window.__surfY - 40;
    p.buffs.set(51, 600);
    g.running = false;
    if (zoomArg && zoomArg !== 1) {
      g.camera.setZoomTarget(zoomArg);
      g.camera.zoom = zoomArg;
    }
  }, Number(process.env.SW_ZOOM || 1));
  await page.evaluate((killArg) => { window.__KILLENT__ = killArg; }, process.env.SW_KILLENT === '1');
  await page.evaluate(async () => {
    const g = window.__swGame;
    const p = g.player;
    const KILL = window.__KILLENT__;
    let saw = 0;
    window.__veilFrames = 0;
    const st = g.world.store;
    const R = g.renderer.constructor;
    for (let i = 0; i < 130; i++) {
      p.x = window.__poolX; p.y = window.__plY; p.vx = 0; p.vy = 0;
      // ★veil 帧占比计数(逐帧谓词真值:实体面+队列面)
      {
        let ve = false;
        for (const n of g.entities.all()) {
          if (!n || n.vanillaId === undefined || n.dead) continue;
          if (n.vanillaId === 677 || n.vanillaId === 668 || n.vanillaId === 583
            || n.vanillaId === 584 || n.vanillaId === 585
            || ((n.vanillaId === 259 || n.vanillaId === 260) && n.ai0 >= 0 && n.ai1 >= 0)) {
            if (R.entVeilHitsLiquid(n, st)) { ve = true; break; }
          }
        }
        const r2 = g.renderer;
        const qq = r2.lunarArmorQueue.length || r2.armorGlowQueue.length || r2.wingGlowQueue.length
          || r2.itemGlowQueue.length || r2.towerGlowQueue.length || r2.npcWhiteLiftQueue.length;
        if (ve || qq) window.__veilFrames++;
      }
      if (KILL) {
        for (const e of g.entities.all()) {
          if (e && e.vanillaId !== undefined && (e.vanillaId === 677 || e.vanillaId === 668
            || e.vanillaId === 583 || e.vanillaId === 584 || e.vanillaId === 585)) {
            if (!e.dead) saw++;
            e.dead = true;
          }
        }
      }
      window.__t = (window.__t || performance.now()) + 16.6667;
      g.frame(window.__t);
      await new Promise((r) => setTimeout(r, 0));
    }
    window.__killedSaw = saw;
  });
  const diag = await page.evaluate(() => {
    const g = window.__swGame;
    const r = g.renderer;
    const st = g.world.store;
    // 逐逃逸族实体:盒+盒内液体
    const ents = [];
    for (const n of g.entities.all()) {
      if (!n || n.vanillaId === undefined || n.dead) continue;
      if (!(n.vanillaId === 677 || n.vanillaId === 668 || n.vanillaId === 583
        || n.vanillaId === 584 || n.vanillaId === 585
        || ((n.vanillaId === 259 || n.vanillaId === 260) && n.ai0 >= 0 && n.ai1 >= 0))) continue;
      const R = r.constructor;
      const hit = R.entVeilHitsLiquid ? R.entVeilHitsLiquid(n, st) : null;
      ents.push({ vid: n.vanillaId, hit, cy: +n.cy.toFixed(0) });
    }
    return { ents, veilbox: r.constructor.veilbox,
      q: [r.lunarArmorQueue.length, r.armorGlowQueue.length, r.lunarCoverQueue.length, r.solarShieldQueue.length,
        r.itemGlowQueue.length, r.wingGlowQueue.length, r.eyebrellaQueue.length, r.whipFullbrightQueue.length,
        r.trailShadeQueue.length, r.towerGlowQueue.length, r.npcWhiteLiftQueue.length] };
  });
  console.log('诊断:', JSON.stringify(diag));
  const res = await page.evaluate(() => {
    const g = window.__swGame;
    const r = g.renderer;
    const c = r.canvas;
    const cam = g.camera;
    const z = cam.zoom || 1;
    const st = g.world.store;
    const sx = c.width / 2 + (window.__poolX - cam.x) * z;
    const mk = (worldY, h) => {
      const sy = c.height / 2 + (worldY - cam.y) * z;
      const strip = document.createElement('canvas');
      strip.width = 320; strip.height = h;
      const x = strip.getContext('2d', { willReadFrequently: true });
      x.drawImage(c, sx - 160, sy - (h / 2) | 0, 320, h, 0, 0, 320, h);
      if (!r._c10eComposited) {
        x.globalCompositeOperation = 'destination-over';
        if (r.glCanvasEl) x.drawImage(r.glCanvasEl, sx - 160, sy - (h / 2) | 0, 320, h, 0, 0, 320, h);
        if (r.skyCanvas) x.drawImage(r.skyCanvas, sx - 160, sy - (h / 2) | 0, 320, h, 0, 0, 320, h);
      }
      return { strip, x };
    };
    const analyze = ({ x }, h, y0f, y1f) => {
      const d = x.getImageData(0, 0, 320, h).data;
      const lum = (i) => (d[i] + d[i + 1] + d[i + 2]) / 3;
      const y0 = Math.floor(h * y0f), y1 = Math.floor(h * y1f);
      const colGrad = [];
      for (let cx = 1; cx < 319; cx++) {
        let s = 0, n2 = 0;
        for (let cy = y0; cy < y1; cy++) {
          s += Math.abs(lum((cy * 320 + cx) * 4) - lum((cy * 320 + cx - 1) * 4)); n2++;
        }
        colGrad.push({ x: cx, g: s / n2 });
      }
      const rowGrad = [];
      for (let cy = y0 + 1; cy < y1 - 1; cy++) {
        let s = 0, n2 = 0;
        for (let cx = 8; cx < 312; cx++) {
          s += Math.abs(lum((cy * 320 + cx) * 4) - lum(((cy - 1) * 320 + cx) * 4)); n2++;
        }
        rowGrad.push({ y: cy, g: s / n2 });
      }
      const pick = (arr) => {
        const out = [];
        for (let k = 2; k < arr.length - 2; k++) {
          const lm = (arr[k - 2].g + arr[k - 1].g + arr[k + 1].g + arr[k + 2].g) / 4;
          if (arr[k].g > lm * 1.6 + 1.5 && arr[k].g > 2) out.push({ p: arr[k].x ?? arr[k].y, v: +arr[k].g.toFixed(1) });
        }
        return out;
      };
      const v = pick(colGrad), hh = pick(rowGrad);
      let m2 = 0;
      for (let k = 0; k < d.length; k += 4) m2 += lum(k);
      m2 /= d.length / 4;
      const spec = (arr) => {
        const gaps2 = {};
        for (let k = 1; k < arr.length; k++) {
          const gp = arr[k].p - arr[k - 1].p;
          gaps2[gp] = (gaps2[gp] ?? 0) + 1;
        }
        return gaps2;
      };
      return { v, h: hh, meanLum: +m2.toFixed(1), vspec: spec(v), hspec: spec(hh) };
    };
    const surface = mk(window.__surfY + 12, 90);
    const deep = mk(window.__surfY + 5 * 16, 64);
    const aS = analyze(surface, 90, 0.55, 1.0);
    const aD = analyze(deep, 64, 0.05, 0.98);
    const wL = cam.x + (sx - 160 - c.width / 2) / z, wR = cam.x + (sx + 160 - c.width / 2) / z;
    let liqN = 0;
    for (let ty = Math.floor((window.__surfY + 48) / 16); ty <= Math.floor((window.__surfY + 112) / 16); ty++)
      for (let tx = Math.floor(wL / 16); tx <= Math.floor(wR / 16); tx++) {
        const i = st.idx(tx, ty);
        if (st.liquid[i] > 0 && st.liquidType[i] === 4) liqN++;
      }
    return { z, liqN, camDrift: [Math.round(cam.x - window.__poolX), Math.round(cam.y - window.__plY)],
      acc: r['_accMode'] ?? '?', bgl: r['bglPathUsed'] ?? '?', killed: window.__killedSaw ?? 0,
      ents: g.entities.all().length,
      veilRatio: (window.__veilFrames ?? 0) / 130,
      liqGate: !!r['_liqGateHandle'],   // ★批化路径执行读数(非空=前景液体走 GL 批)
      aS, aD, pngS: surface.strip.toDataURL('image/png'), pngD: deep.strip.toDataURL('image/png') };
  });
  const tag = (flags || 'base').replace(/[^a-z0-9]/gi, '');
  writeFileSync(`${OUT}/sg5-${tag}-surf.png`, Buffer.from(res.pngS.split(',')[1], 'base64'));
  writeFileSync(`${OUT}/sg5-${tag}-deep.png`, Buffer.from(res.pngD.split(',')[1], 'base64'));
  await page.close();
  return res;
}

const fmt = (tag, r) => {
  const f = (v) => `n=${v.length} [${v.slice(0, 12).map((l) => `${l.p}:${l.v}`).join(' ')}]`;
  return `${tag}: zoom=${r.z} acc=${r.acc} 路径=${r.bgl} 实体=${r.ents} 杀逃逸族=${r.killed} 液体批=${r.liqGate} veil帧占比=${(r.veilRatio * 100).toFixed(0)}% 深部液体格=${r.liqN}
  表面(亮度${r.aS.meanLum}): 竖 ${f(r.aS.v)} 距=${JSON.stringify(r.aS.vspec)}
        横 ${f(r.aS.h)} 距=${JSON.stringify(r.aS.hspec)}
  深部(亮度${r.aD.meanLum}): 竖 ${f(r.aD.v)} 距=${JSON.stringify(r.aD.vspec)}
        横 ${f(r.aD.h)} 距=${JSON.stringify(r.aD.hspec)}`;
};
const ARMS = [''];
// ★冷启动预热:首臂 bridge 竞态(SW 装载/vite 冷编译)——先空烧一页再跑臂
{
  const pw = await openPage(browser, { width: 640, height: 400 });
  await pw.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  await pw.close();
}
for (const fl of ARMS) {
  let r = await arm(fl);
  if (!r) { console.log('  (bridge 抖动,重试)'); r = await arm(fl); }
  if (r) console.log(fmt(fl || 'base', r));
}
await browser.close();
console.log('PNG →', `${OUT}/sg5-*.png`);
