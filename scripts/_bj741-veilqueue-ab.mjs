// ★BJ741 玩家绑定逃逸队列位置域判别探针:旱地+星尘甲 → A(BJ741 玩家域液检)/
// B(?veilbox=0 旧行为) 双臂:前景液体批化态逐帧读数+帧时+队列实证(前提:甲队列
// 恒非空=旧行为恒 veil 帧)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=480000 scripts/_bj741-veilqueue-ab.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});

async function arm(flags, water) {
  const page = await openPage(browser, { width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?cloudcache=0${flags ? '&' + flags : ''}`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await bootstrap(page, ORIGIN);
  const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261030 });
  if (!gen?.ok) { console.log('createGame fail', gen?.why); await page.close(); return null; }
  await pump(page, 60);
  await page.evaluate(async (spotArg) => { window.__SPOT__ = spotArg; }, process.env.SW_SPOT || '');
  await page.evaluate((heldArg) => { window.__HELD__ = heldArg; }, process.env.SW_HELD === '1');
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
    if (window.__HELD__) {
      // 火把(手持光源=itemGlow 队列,BJ742 主验证面)
      let torch = -1;
      for (const [k, idx] of Object.entries(Items.ITEM_BY_KEY)) {
        if (/^torch$|^torch$/.test(k)) { torch = idx; break; }
      }
      if (torch < 0) torch = Items.ITEM_BY_KEY['torch'] ?? 8;
      const sl = p.inv.slots;
      if (sl && sl.length) sl[p.selected] = { id: torch, stack: 1, prefix: 0 };
    }
    p.equipStats;
    // 站位:SW_SPOT=lake(湖畔旱地,水可见)/缺省地表
    const st = g.world.store;
    let cx = Math.floor(g.world.spawnX) + 12;
    let sy = -1;
    if (window.__SPOT__ === 'lake') {
      // 自然微光湖:扫 liquidType=4 找簇,站湖右侧+22 格的干地上(湖在视野内)
      let best = null;
      for (let y = 0; y < st.h && !best; y += 4) {
        for (let x = 0; x < st.w; x += 2) {
          const i = st.idx(x, y);
          if (st.liquid[i] > 0 && st.liquidType[i] === 4) { best = { x, y }; break; }
        }
      }
      if (best) {
        cx = best.x + 22;
        for (let y = Math.max(2, best.y - 40); y < st.h - 10; y++) {
          if (st.type[st.idx(cx, y)] !== 0) { sy = y; break; }
        }
      }
    }
    if (sy < 0) {
      for (let y = 8; y < st.h - 10; y++) { if (st.type[st.idx(cx, y)] !== 0) { sy = y; break; } }
    }
    window.__px = cx * 16; window.__py = (sy - 3) * 16;
    // 域内液体自证(±10 格)
    let liqNear = 0;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const i = st.idx(cx + dx, sy + dy);
      if (st.liquid[i] > 0) liqNear++;
    }
    window.__liqNear = liqNear;
    g.running = false;
  });
  const res = await page.evaluate(async () => {
    const g = window.__swGame;
    const p = g.player;
    const r = g.renderer;
    const times = [];
    let batched = 0, frames = 0, qN = 0;
    for (let i = 0; i < 120; i++) {
      p.x = window.__px; p.y = window.__py; p.vx = 0; p.vy = 0;
      const t0 = performance.now();
      window.__t = (window.__t || performance.now()) + 16.6667;
      g.frame(window.__t);
      const dt = performance.now() - t0;
      if (r['_liqGateHandle']) batched++;
      if (r.armorGlowQueue.length > 0 || r.lunarArmorQueue.length > 0) qN++;
      frames++;
      if (i >= 20) times.push(dt);
      await new Promise((r2) => setTimeout(r2, 0));
    }
    times.sort((a, b) => a - b);
    return { batched, frames, qN,
      med: +times[Math.floor(times.length / 2)].toFixed(2),
      p90: +times[Math.floor(times.length * 0.9)].toFixed(2),
      liqNear: window.__liqNear };
  });
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
const A = await arm('', false);
if (A) console.log(`A(BJ741): 液体批帧=${A.batched}/${A.frames} 甲队列帧=${A.qN}/${A.frames} 帧时med=${A.med} p90=${A.p90} 附近液体格=${A.liqNear}`);
const B = await arm('veilbox=0', false);
if (B) console.log(`B(旧行为): 液体批帧=${B.batched}/${B.frames} 甲队列帧=${B.qN}/${B.frames} 帧时med=${B.med} p90=${B.p90} 附近液体格=${B.liqNear}`);
if (A && B) console.log(`帧时差(旧-新)=${(B.med - A.med).toFixed(2)}ms med / ${(B.p90 - A.p90).toFixed(2)}ms p90`);
await browser.close();
