// ★债裁决探针:texRefresh 空闲态计数——站立(无动画)vs 行走(动画)双臂,
// 判定 207ms/7s 账是「活动内容合法成本」还是「空闲浪费」。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs --timeout=300000 scripts/_debt-texrefresh-idle.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});

async function arm(mode) {
  const page = await openPage(browser, { width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/?cloudcache=0`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
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
    g.renderer.constructor.gladd = true;   // ★用户场景核心旗(texRefresh=gladd 发射面)
  });
  await page.evaluate(async () => {
    const m = await import('/src/render/GLSpriteLayer.ts');
    window.__ref = { armor: 0, wing: 0, other: 0 };
    const orig = m.GLSpriteLayer.prototype.texRefresh;
    m.GLSpriteLayer.prototype.texRefresh = function (key, img) {
      if (typeof key === 'string') {
        if (key.startsWith('armor:tex:')) window.__ref.armor++;
        else if (key.startsWith('wing:tex:')) window.__ref.wing++;
        else window.__ref.other++;
      }
      return orig.call(this, key, img);
    };
  });
  const res = await page.evaluate(async (modeArg) => {
    const g = window.__swGame;
    const p = g.player;
    for (let i = 0; i < 100; i++) {
      p.x = window.__px; p.y = window.__py;
      if (modeArg === 'walk') { p.vx = Math.cos(i / 12) * 3; }
      else { p.vx = 0; p.vy = 0; }
      window.__t = (window.__t || performance.now()) + 16.6667;
      g.frame(window.__t);
      await new Promise((r2) => setTimeout(r2, 0));
    }
    return { ...window.__ref };
  }, mode);
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
const idle = await arm('idle');
if (idle) console.log(`idle(站立): armor=${idle.armor} wing=${idle.wing} other=${idle.other}  (100帧)`);
const walk = await arm('walk');
if (walk) console.log(`walk(行走): armor=${walk.armor} wing=${walk.wing} other=${walk.other}  (100帧)`);
await browser.close();
