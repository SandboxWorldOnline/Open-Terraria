// ★gladd 转正终验:裸载（无 URL 旗）缺省激活 + ?gladd=0 逃生门生效。
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
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
    let wingIid = -1;
    for (let i = 0; i < Items.ITEM_DEFS.length; i++) if (S.statOfInternal(i)?.wing === 29) { wingIid = i; break; }
    if (wingIid >= 0) p.inv.armor[5] = { id: wingIid, stack: 1, prefix: 0 };
    p.equipStats;
    const st = g.world.store;
    const cx = Math.floor(g.world.spawnX) + 12;
    let sy = -1;
    for (let y = 8; y < st.h - 10; y++) { if (st.type[st.idx(cx, y)] !== 0) { sy = y; break; } }
    window.__px = cx * 16; window.__py = (sy - 3) * 16;
    p.x = window.__px; p.y = window.__py;
    g.running = false;
  });
  const res = await page.evaluate(async () => {
    const g = window.__swGame;
    const p = g.player;
    const r = g.renderer;
    const flag = r.constructor.gladd;
    const w0 = { ...r.gladdWingStats }, a0 = { ...r.gladdArmorStats };
    for (let i = 0; i < 30; i++) {
      p.x = window.__px; p.y = window.__py; p.vx = Math.cos(i / 10) * 3; p.vy = 0;
      window.__t = (window.__t || performance.now()) + 16.6667;
      g.frame(window.__t);
      await new Promise((r2) => setTimeout(r2, 0));
    }
    return { flag,
      wingGL: r.gladdWingStats.gl - w0.gl, armorGL: r.gladdArmorStats.gl - a0.gl,
      wingFB: r.gladdWingStats.fb - w0.fb, gqV: r['_gqV'].length / 48,
      gs: { ...r.gladdGroupStats } };
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
const A = await arm('');
if (A) console.log(`裸载(无旗): gladd=${A.flag} wingGL=${A.wingGL}/30帧 armorGL=${A.armorGL} wingFB=${A.wingFB} gqV=${A.gqV} 组=${JSON.stringify(A.gs)}`);
const B = await arm('gladd=0');
if (B) console.log(`逃生门(?gladd=0): gladd=${B.flag} wingGL=${B.wingGL} armorGL=${B.armorGL} gqV=${B.gqV}`);
await browser.close();
