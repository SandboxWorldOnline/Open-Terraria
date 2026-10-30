// ★BJ737-A 组冲账审计:星尘套+wing29 帧,gladd=1 下组会话 begin/present/冲批/
// 残留 _gqV 逐帧账——五面驱动(wing/armor/tower/heldProj)不调 begin/end,尾批
// 是否被 commit 冲出?(丢批=当帧内容缺失+跨帧陈旧 quad=鬼影翼嫌疑)
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});
const page = await openPage(browser, { width: 1280, height: 800 });
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261029 });
console.log('createGame', gen?.ok ? 'ok' : gen?.why);
await pump(page, 60);

await page.evaluate(async () => {
  const g = window.__swGame;
  const p = g.player;
  const S = await import('/src/data/vanillaItemStats.ts');
  const Items = await import('/src/data/items.ts');
  let wingIid = -1;
  for (let i = 0; i < Items.ITEM_DEFS.length; i++) if (S.statOfInternal(i)?.wing === 29) { wingIid = i; break; }
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
  p.inv.armor[5] = { id: wingIid, stack: 1, prefix: 0 };
  const st = g.world.store;
  const cx = Math.floor(g.world.spawnX) + 12;
  let sy = -1;
  for (let y = 8; y < st.h - 10; y++) { if (st.type[st.idx(cx, y)] !== 0) { sy = y; break; } }
  window.__px = cx * 16; window.__py = (sy - (process.env.SW_SURF ?? 12)) * 16;
  // 周边格诊断
  const diag = [];
  for (let dy = -4; dy <= 2; dy++) {
    const row = [];
    for (let dx = -2; dx <= 2; dx++) {
      const i2 = st.idx(cx + dx, sy + dy);
      row.push(st.type[i2] + (st.liquid[i2] ? 'L' : ''));
    }
    diag.push(row.join(','));
  }
  window.__tiles = diag;
  g.running = false;
  window.__inst = { beginEnd: [], presents: [], flushes: [] };
  const r = g.renderer;
  // wrap ② itemGlow begin(组开位证)
  const origFigl = r.flushItemGlowGL.bind(r);
  r['flushItemGlowGL'] = function (gl) {
    const began = window.__inst.beginEnd.length;
    const res = origFigl(gl);
    window.__inst.itemglow = `began=${window.__inst.beginEnd.length - began} q=${this.itemGlowQueue.length}`;
    return res;
  };
});
// present 日志(判例⑫)
await page.evaluate(async () => {
  const m = await import('/src/render/GLPipeline.ts');
  const orig = m.GLPipeline.prototype.present;
  m.GLPipeline.prototype.present = function (src, over) {
    window.__inst.presents.push(`${src?.name ?? '?'}${over ? '+over' : ''}`);
    return orig.call(this, src, over);
  };
  const R = await import('/src/render/Renderer.ts');
  const origFlush = R.Renderer.prototype.gladdQuadFlush;
  R.Renderer.prototype.gladdQuadFlush = function () {
    const n = this['_gqV'].length / 48;
    const ok = origFlush.call(this);
    if (n > 0) window.__inst.flushes.push(`${n}q${ok ? '' : '!FAIL'}`);
    return ok;
  };
  const origBegin = R.Renderer.prototype.gladdGroupBegin;
  // 组统计读取:直接读字段
});
await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = true; });
// 驱动 8 帧,逐帧读账
for (let f = 0; f < 8; f++) {
  await page.evaluate(() => {
    const g = window.__swGame;
    const p = g.player;
    p.x = window.__px; p.y = window.__py; p.vx = 0; p.vy = -3;
    window.__vnow = (window.__vnow || performance.now()) + 16.6667;
    g.frame(window.__vnow);
    const r = g.renderer;
    window.__inst.frame = {
      gqV: r['_gqV'].length / 48,
      groupStats: { ...r.gladdGroupStats },
      wing: { ...r.gladdWingStats }, armor: { ...r.gladdArmorStats },
      la: { ...r.gladdLunarArmorStats },
      itemGlowQ: r.itemGlowQueue.length,
      tiles: window.__tiles,
    };
  });
  const inst = await page.evaluate(() => ({
    f: window.__inst.frame,
    itemglow: window.__inst.itemglow,
    presents: window.__inst.presents.splice(0),
    flushes: window.__inst.flushes.splice(0),
  }));
  console.log(`F${f}: gqV残留=${inst.f.gqV} 组=${JSON.stringify(inst.f.groupStats)} wing=${JSON.stringify(inst.f.wing)} armor=${JSON.stringify(inst.f.armor)} la=${JSON.stringify(inst.f.la)} itemGlowQ=${inst.f.itemGlowQ} tiles=${JSON.stringify(inst.f.tiles)}`);
  console.log(`     presents=[${inst.presents.join(' ')}] flushes=[${inst.flushes.join(' ')}] itemglow=${inst.itemglow}`);
}
await browser.close();
