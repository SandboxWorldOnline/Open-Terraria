// ★BJ743 罩源 GL 化判别探针:水+星尘甲(真 veil 帧)→ A(BJ743 批化+GL 层罩源)/
// B(?veilliq=0 旧 canvas-gate 路) 双臂:液体批化态+GL 层在场+帧时+玩家区 PNG 对拍。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=480000 scripts/_bj743-veilsrc-ab.mjs
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
  await page.evaluate(async () => {
    const g = window.__swGame;
    const p = g.player;
    const S = await import('/src/data/vanillaItemStats.ts');
    const Items = await import('/src/data/items.ts');
    const cands = { head: -1, body: -1, legs: -1 };
    for (const [key, idx] of Object.entries(Items.ITEM_BY_KEY)) {
      if (!/stardust/i.test(key)) continue;
      const st = S.statOfInternal(idx);
      if (/helmet/i.test(key) && st?.hs != null) cands.head = idx;
      else if (/breastplate/i.test(key) && st?.bs != null) cands.body = idx;
      else if (/leggings/i.test(key) && st?.ls != null) cands.legs = idx;
    }
    p.inv.armor[0] = { id: cands.head, stack: 1, prefix: 0 };
    p.inv.armor[1] = { id: cands.body, stack: 1, prefix: 0 };
    p.inv.armor[2] = { id: cands.legs, stack: 1, prefix: 0 };
    p.equipStats;
    // 合成水池(液体 type 1,防微光传送):挖 20×8,满水,玩家腰深
    const st = g.world.store;
    const px = Math.floor(g.world.spawnX) + 20, py = Math.floor(g.world.h * 0.30);
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 20; dx++) {
      const i = st.idx(px + dx, py + dy);
      st.type[i] = 0; st.flags[i] = 0; st.wall[i] = 1; st.liquid[i] = 0;
    }
    for (let dx = -1; dx <= 20; dx++) { const i = st.idx(px + dx, py + 8); st.type[i] = 1; st.flags[i] = 1; }
    for (let dy = 0; dy <= 8; dy++) {
      const i1 = st.idx(px - 1, py + dy), i2 = st.idx(px + 20, py + dy);
      st.type[i1] = 1; st.flags[i1] = 1; st.type[i2] = 1; st.flags[i2] = 1;
    }
    for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 20; dx++) {
      const i = st.idx(px + dx, py + dy);
      st.liquid[i] = 255; st.liquidType[i] = 1;
    }
    const ch = g.chunks;
    for (let cy = Math.floor((py - 4) / 16); cy <= Math.floor((py + 9) / 16); cy++)
      for (let cx = Math.floor((px - 2) / 16); cx <= Math.floor((px + 21) / 16); cx++)
        ch.markDirty(cx, cy);
    window.__px = (px + 10) * 16; window.__py = (py + 1) * 16;   // 腰深
    window.__poolX = (px + 10) * 16; window.__surfY = py * 16;
    g.running = false;
  });
  const res = await page.evaluate(async () => {
    const g = window.__swGame;
    const p = g.player;
    const r = g.renderer;
    const times = [];
    let batched = 0, frames = 0, layerAlive = 0;
    let png = null;
    for (let i = 0; i < 120; i++) {
      p.x = window.__px; p.y = window.__py; p.vx = 0; p.vy = 0;
      const t0 = performance.now();
      window.__t = (window.__t || performance.now()) + 16.6667;
      g.frame(window.__t);
      const dt = performance.now() - t0;
      if (r['_liqGateHandle']) batched++;
      const vl = r['_veilLiqLayer'];
      if (vl && !vl.unavailable && vl.canvas.width > 0) layerAlive++;
      frames++;
      if (i >= 20) times.push(dt);
      await new Promise((r2) => setTimeout(r2, 0));
      if (i === 110) {
        const c = r.canvas;
        const strip = document.createElement('canvas');
        strip.width = 240; strip.height = 200;
        const x = strip.getContext('2d');
        const cam = g.camera;
        const z = cam.zoom || 1;
        const sx = Math.round(c.width / 2 + (window.__px - cam.x) * z);
        const sy = Math.round(c.height / 2 + (window.__py - cam.y) * z);
        x.drawImage(c, sx - 120, sy - 100, 240, 200, 0, 0, 240, 200);
        if (!r._c10eComposited) {
          x.globalCompositeOperation = 'destination-over';
          if (r.glCanvasEl) x.drawImage(r.glCanvasEl, sx - 120, sy - 100, 240, 200, 0, 0, 240, 200);
          if (r.skyCanvas) x.drawImage(r.skyCanvas, sx - 120, sy - 100, 240, 200, 0, 0, 240, 200);
        }
        png = strip.toDataURL('image/png');
      }
    }
    times.sort((a, b) => a - b);
    // ★罩源画布本体采样:纯水区(池左端,离玩家 10 格)水线下的 RGBA
    let srcDump = null;
    let ringDump = null;
    try {
      const V = await import('/src/render/VanillaLiquidRenderer.ts');
      ringDump = V.debugFgRunSample ? V.debugFgRunSample() : 'noexp';
    } catch (e) { ringDump = 'err:' + String(e).slice(0, 60); }
    {
      const r2 = g.renderer;
      const vl = r2['_veilLiqLayer'];
      const gc = r2.waterWarp ? r2.waterWarp.gateCanvas() : null;
      const cvA = vl && !vl.unavailable ? vl.canvas : null;
      const pick = (cv) => {
        if (!cv || cv.width === 0) return null;
        const c2 = document.createElement('canvas');
        c2.width = 40; c2.height = 20;
        const x2 = c2.getContext('2d', { willReadFrequently: true });
        const cam = g.camera, z = cam.zoom || 1;
        const wx = window.__px - 160, wy = window.__surfY + 24;   // 池左端水面下 24px
        const sx = Math.round(cv.width / 2 + (wx - cam.x) * (cv.width / r2.canvas.width) * (r2.canvas.width / c2.width ? 1 : 1));
        return null;   // 简化:整画布读窗
      };
      void pick;
      const dump = (cv, dy) => {
        if (!cv || cv.width === 0) return 'absent';
        const tmp = document.createElement('canvas');
        tmp.width = cv.width; tmp.height = cv.height;
        const x2 = tmp.getContext('2d', { willReadFrequently: true }) ?? null;
        if (!x2) return 'noctx';
        try {
          x2.drawImage(cv, 0, 0);
          const cam = g.camera, z = cam.zoom || 1;
          const k = cv.width / r2.canvas.width;
          const wx = window.__px - 160, wy = window.__surfY + (dy ?? 24);
          const sx = Math.round(cv.width / 2 + (wx - cam.x) * k);
          const sy = Math.round(cv.height / 2 + (wy - cam.y) * k);
          const d2 = x2.getImageData(sx, sy, 4, 2).data;
          const out = [];
          for (let i = 0; i < 32; i += 16) out.push([d2[i], d2[i + 1], d2[i + 2], d2[i + 3]]);
          return out;
        } catch (e) { return 'err:' + String(e).slice(0, 40); }
      };
      srcDump = { glWater: dump(cvA, 24), glAbove: dump(cvA, -40), fgWater: dump(gc, 24), fgAbove: dump(gc, -40) };
    }
    window.__ringDump = ringDump;
    return { batched, layerAlive, frames, srcDump, ringDump: window.__ringDump,
      med: +times[Math.floor(times.length / 2)].toFixed(2),
      p90: +times[Math.floor(times.length * 0.9)].toFixed(2), png };
  });
  writeFileSync(`${OUT}/bj743-${(flags || 'base').replace(/[^a-z0-9]/gi, '')}.png`,
    Buffer.from(res.png.split(',')[1], 'base64'));
  await page.close();
  return res;
}

// 预热
{
  const pw = await openPage(browser, { width: 640, height: 400 });
  await pw.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));
  await pw.close();
}
const A = await arm('');
if (A) console.log(`A(BJ743): 液体批帧=${A.batched}/${A.frames} 罩源GL层帧=${A.layerAlive}/${A.frames} 帧时med=${A.med} p90=${A.p90}
  A采样 水=${JSON.stringify(A.srcDump.glWater)} 水上=${JSON.stringify(A.srcDump.glAbove)}
  ring首quad16float=${JSON.stringify(A.ringDump)}`);
const B = await arm('veilliq=0');
if (B) console.log(`B(旧路径): 液体批帧=${B.batched}/${B.frames} 帧时med=${B.med} p90=${B.p90}
  B采样 fgCanvas水=${JSON.stringify(B.srcDump.fgWater)} fgCanvas水上=${JSON.stringify(B.srcDump.fgAbove)}`);
if (A && B) console.log(`帧时差(旧-新)=${(B.med - A.med).toFixed(2)}ms med / ${(B.p90 - A.p90).toFixed(2)}ms p90`);
await browser.close();
