// ★BJ740 微光独石夹层 GL 化判别探针:强制 shimmerAlpha → A(BJ740 GL 桥)/
// B(?shimstargl=0 旧路由) 双臂:路由态读数+渲染帧时+PNG 亮度/星点对拍。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=480000 scripts/_bj740-shimstar-ab.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';
import { writeFileSync } from 'node:fs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const OUT = '/Users/vinlic/.claude/jobs/d3098226/tmp';
const browser = await launchBrowser({});

async function arm(flags) {
  const page = await openPage(browser, { width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?cloudcache=0${flags ? '&' + flags : ''}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await bootstrap(page, ORIGIN);
  const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261030 });
  if (!gen?.ok) { console.log('createGame fail', gen?.why); await page.close(); return null; }
  await pump(page, 60);
  // 地表站位+相机随玩家;每帧强制 shimmerAlpha=1(pre-update 置位,帧内 decay 后仍>0)
  await page.evaluate(() => {
    const g = window.__swGame;
    const st = g.world.store;
    const cx = Math.floor(g.world.spawnX) + 12;
    let sy = -1;
    for (let y = 8; y < st.h - 10; y++) { if (st.type[st.idx(cx, y)] !== 0) { sy = y; break; } }
    window.__px = cx * 16; window.__py = (sy - 3) * 16;
    g.player.x = window.__px; g.player.y = window.__py;
    g.running = false;
    g.renderer.constructor.c10e = true;   // c10e 恒开(GL 桥域)
  });
  const res = await page.evaluate(async () => {
    const g = window.__swGame;
    const p = g.player;
    const r = g.renderer;
    const times = [];
    let routed = 0, glArmed = 0, frames = 0;
    let png = null;
    for (let i = 0; i < 150; i++) {
      p.x = window.__px; p.y = window.__py; p.vx = 0; p.vy = 0;
      r.monoFilters.shimmerAlpha = 1;   // 强制独石态(update 内 moveTowards 衰减,帧内仍>0)
      const t0 = performance.now();
      window.__t = (window.__t || performance.now()) + 16.6667;
      g.frame(window.__t);
      const dt = performance.now() - t0;
      if (r['_c10eWorldToHud']) routed++;
      if (r['_shimStarGl']) glArmed++;
      frames++;
      if (i >= 20) times.push(dt);
      await new Promise((r2) => setTimeout(r2, 0));
      if (i === 120) {
        // PNG@同帧序(确定性 tVis/星域)
        const c = r.canvas;
        const strip = document.createElement('canvas');
        strip.width = 320; strip.height = 200;
        const x = strip.getContext('2d');
        x.drawImage(c, 480, 300, 320, 200, 0, 0, 320, 200);
        if (!r._c10eComposited) {
          x.globalCompositeOperation = 'destination-over';
          if (r.glCanvasEl) x.drawImage(r.glCanvasEl, 480, 300, 320, 200, 0, 0, 320, 200);
          if (r.skyCanvas) x.drawImage(r.skyCanvas, 480, 300, 320, 200, 0, 0, 320, 200);
        }
        png = strip.toDataURL('image/png');
      }
    }
    times.sort((a, b) => a - b);
    const med = times[Math.floor(times.length / 2)];
    const p90 = times[Math.floor(times.length * 0.9)];
    // 亮度统计(黑幕+星)
    const c = r.canvas;
    const x2 = document.createElement('canvas');
    x2.width = 320; x2.height = 200;
    const xc = x2.getContext('2d', { willReadFrequently: true });
    xc.drawImage(c, 480, 300, 320, 200, 0, 0, 320, 200);
    if (!r._c10eComposited) {
      xc.globalCompositeOperation = 'destination-over';
      if (r.glCanvasEl) xc.drawImage(r.glCanvasEl, 480, 300, 320, 200, 0, 0, 320, 200);
      if (r.skyCanvas) xc.drawImage(r.skyCanvas, 480, 300, 320, 200, 0, 0, 320, 200);
    }
    const d = xc.getImageData(0, 0, 320, 200).data;
    let lum = 0, bright = 0;
    for (let k = 0; k < d.length; k += 4) {
      const l = (d[k] + d[k + 1] + d[k + 2]) / 3;
      lum += l;
      if (l > 40) bright++;
    }
    return { routed, glArmed, frames, med: +med.toFixed(2), p90: +p90.toFixed(2),
      meanLum: +(lum / (d.length / 4)).toFixed(2), brightPx: bright, png };
  });
  writeFileSync(`${OUT}/bj740-${(flags || 'base').replace(/[^a-z0-9]/gi, '')}.png`,
    Buffer.from(res.png.split(',')[1], 'base64'));
  await page.close();
  return res;
}

// 预热(SW 冷启动竞态)
{
  const pw = await openPage(browser, { width: 640, height: 400 });
  await pw.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  await pw.close();
}
const A = await arm('');
if (!A) { console.log('臂A失败'); } else {
  console.log(`A(BJ740 GL桥): 路由帧=${A.routed}/${A.frames} GL臂=${A.glArmed} 帧时med=${A.med}ms p90=${A.p90}ms 亮度=${A.meanLum} 亮px=${A.brightPx}`);
}
const B = await arm('shimstargl=0');
if (!B) { console.log('臂B失败'); } else {
  console.log(`B(旧路由):    路由帧=${B.routed}/${B.frames} GL臂=${B.glArmed} 帧时med=${B.med}ms p90=${B.p90}ms 亮度=${B.meanLum} 亮px=${B.brightPx}`);
}
if (A && B) {
  const dMed = B.med - A.med;
  console.log(`帧时差(旧-新)=${dMed.toFixed(2)}ms  亮度差=${Math.abs(A.meanLum - B.meanLum).toFixed(2)} 亮px差=${Math.abs(A.brightPx - B.brightPx)}`);
}
await browser.close();
