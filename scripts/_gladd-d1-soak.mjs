// ★D1 动画浸泡(BJ737-A 判例:tick 钉死闸掩 staleness——非暂停行走让甲 glow 行进
// 动画跑起来,验证恒甲重绘/甲 glow 的 GL 纹理内容跟随动画(texRefresh 每拍)+
// 组每帧 commit+无运行时错误。星尘套真装备。
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});
const page = await openPage(browser, { width: 1280, height: 800 });
await bootstrap(page, `${ORIGIN}/?cloudcache=0`);
const gen = await createGame(page, { size: 'small', seed: '05162020', pinRandom: 20261030 });
console.log('createGame', gen?.ok ? 'ok' : gen?.why);
await pump(page, 60);

const SOAKMODE = process.env.SW_SOAKMODE || 'walk';
await page.evaluate(async (modeArg) => {
  window.__SOAKMODE_ARG__ = modeArg;
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
  if (window.__CLEARHELD__) {
    try { const sl = p.inv.slots; sl[p.selected] = null; } catch { /* 域差异 */ }
  }
  if (window.__ADDWING__) {
    let wingIid = -1;
    for (let i = 0; i < Items.ITEM_DEFS.length; i++) if (S.statOfInternal(i)?.wing === 29) { wingIid = i; break; }
    if (wingIid >= 0) p.inv.armor[5] = { id: wingIid, stack: 1, prefix: 0 };
  }
  p.equipStats;   // ★夹具判例:直写槽位不自动失效记忆化——读 getter 触发重算(perf 探针同注)
  // 地表站位
  const st = g.world.store;
  const cx = Math.floor(g.world.spawnX) + 12;
  let sy = -1;
  for (let y = 8; y < st.h - 10; y++) { if (st.type[st.idx(cx, y)] !== 0) { sy = y; break; } }
  window.__px = cx * 16; window.__py = (sy - 3) * 16;
  p.x = window.__px; p.y = window.__py;
  g.camera.x = p.x; g.camera.y = p.y;   // ★闸同款:相机钉玩家
  g.running = false;
  // 二分:SW_SOAKMODE=gate(paused+悬空=闸形态)/hover(非暂停+vy 钉悬空)/walk(行走)
  window.__soakMode = window.__SOAKMODE_ARG__ || 'walk';
  window.__CLEARHELD__ = modeArg === 'gate';
  window.__ADDWING__ = modeArg === 'wing';
  g.paused = window.__soakMode === 'gate';
  g.renderer.constructor.gladd = true;
}, SOAKMODE);
// texRefresh 分键计数(D1 面:armor:*=repaint/甲glow/盾/被盖/眼球伞共用前缀)
await page.evaluate(async () => {
  const m = await import('/src/render/GLSpriteLayer.ts');
  window.__ref = { armor: 0, wing: 0, other: 0 };
  window.__refKeys = {};
  const orig = m.GLSpriteLayer.prototype.texRefresh;
  m.GLSpriteLayer.prototype.texRefresh = function (key, img) {
    if (typeof key === 'string') {
      if (key.startsWith('armor:tex:')) window.__ref.armor++;
      else if (key.startsWith('wing:tex:')) window.__ref.wing++;
      else window.__ref.other++;
      window.__refKeys[key.replace(/\d+$/, '#')] = (window.__refKeys[key.replace(/\d+$/, '#')] ?? 0) + 1;
    }
    return orig.call(this, key, img);
  };
});
// 收集侧直插:armorGlowOps/lunarConstPieces 参数与返回
await page.evaluate(async () => {
  window.__opsLog = [];
  // 直接在 Renderer 实例上打点:wrap drawPlayer 收尾读队列
  const r = window.__swGame.renderer;
  const oDP = r.drawPlayer.bind(r);
  r['drawPlayer'] = function (...a) {
    const res = oDP.apply(this, a);
    window.__opsLog.push({
      la: this.lunarArmorQueue.length, ag: this.armorGlowQueue.length,
      collected: this.armorGlowCollected.size,
    });
    return res;
  };
});
// 块头队列快照(组开位=drawPlayer 后/driver 前——生产账真相)
await page.evaluate(() => {
  const r = window.__swGame.renderer;
  const oB = r['gladdGroupBegin'].bind(r);
  window.__qAtBlock = [];
  r['gladdGroupBegin'] = function (...a) {
    window.__qAtBlock.push({
      la: this.lunarArmorQueue.length, ag: this.armorGlowQueue.length,
      cov: this.lunarCoverQueue.length, sh: this.solarShieldQueue.length,
      eb: this.eyebrellaQueue.length, hp: this.heldProjCarrierQueue.length,
      ig: this.itemGlowQueue.length,
    });
    return oB.apply(this, a);
  };
});
// 行走浸泡 150 帧(左右交替=行进动画 rows 循环;星尘甲 glow 行进跟随)
const stats = await page.evaluate(async () => {
  const g = window.__swGame;
  const p = g.player;
  const hashes = [];
  let err = null;
  try {
    const mode = window.__soakMode;
    for (let i = 0; i < 150; i++) {
      if (mode === 'walk') {
        p.x = window.__px + Math.sin(i / 12) * 40;
        p.vx = Math.cos(i / 12) * 3; p.vy = 0;
      } else if (mode === 'hover') {
        p.x = window.__px; p.vx = 0; p.vy = -3;   // 非暂停但 vy 钉(悬空)
      }
      p.y = window.__py;
      window.__vnow = (window.__vnow || performance.now()) + 16.6667;
      g.frame(window.__vnow);
      // ★⑩闸暖机判例:紧同步循环堵事件循环=ensureVImage 异步加载永不落地→doll
      //  合成恒 null→甲 glow/重绘零收集(本浸泡首版全红的真凶)。逐帧让出事件循环。
      await new Promise((r2) => setTimeout(r2, 0));
      if (i % 30 === 0) {
        // 玩家邻域画面 hash(动画活=hash 逐拍变)
        const r = g.renderer;
        const c = document.createElement('canvas');
        c.width = 200; c.height = 160;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(r.canvas, innerWidth / 2 - 100, innerHeight / 2 - 80, 200, 160, 0, 0, 200, 160);
        if (!r._c10eComposited) {
          x.globalCompositeOperation = 'destination-over';
          if (r.glCanvasEl) x.drawImage(r.glCanvasEl, innerWidth / 2 - 100, innerHeight / 2 - 80, 200, 160, 0, 0, 200, 160);
          if (r.skyCanvas) x.drawImage(r.skyCanvas, innerWidth / 2 - 100, innerHeight / 2 - 80, 200, 160, 0, 0, 200, 160);
        }
        const d = x.getImageData(0, 0, 200, 160).data;
        let h = 0;
        for (let k = 0; k < d.length; k += 40) h = (Math.imul(h ^ d[k], 0x01000193) >>> 0);
        hashes.push(h);
      }
    }
  } catch (e) { err = String(e); }
  const r = g.renderer;
  return {
    err, hashes,
    dead: g.player.dead, hp: g.player.hp,
    armorQ: r.armorGlowQueue.length, laQ: r.lunarArmorQueue.length,
    ref: window.__ref, keys: window.__refKeys, qAtBlock: window.__qAtBlock,
    opsLog: (window.__opsLog ?? []).slice(0, 6), opsN: (window.__opsLog ?? []).length,
    gs: { ...r.gladdGroupStats },
    la: { ...r.gladdLunarArmorStats }, armor: { ...r.gladdArmorStats },
    gqV: r['_gqV'].length / 48,
    poison: r.gladdGroupStats.poison,
  };
});
console.log('浸泡账:', JSON.stringify({ err: stats.err, dead: stats.dead, hp: stats.hp, armorQ: stats.armorQ, laQ: stats.laQ, gs: stats.gs, la: stats.la, armor: stats.armor, gqV: stats.gqV }));
console.log('texRefresh 计: armor族=', stats.ref.armor, 'wing族=', stats.ref.wing, '其他=', stats.ref.other);
console.log('texRefresh 键分布:', JSON.stringify(stats.keys ?? window.__refKeys));
console.log('drawPlayer 后队列(前6):', JSON.stringify(stats.opsLog), '总 drawPlayer 调用:', stats.opsN);
console.log('块头队列(前5+后2):', JSON.stringify((stats.qAtBlock ?? []).slice(0, 5)), '...', JSON.stringify((stats.qAtBlock ?? []).slice(-2)));
console.log('玩家邻域 hash 序列(动画活=应互异):', stats.hashes.join(' '));
const uniq = new Set(stats.hashes).size;
const ok = !stats.err && stats.la.gl > 100 && stats.armor.gl > 200 && stats.gqV === 0
  && stats.ref.armor > 200 && uniq === stats.hashes.length;
console.log(ok ? '=== D1 动画浸泡全绿(内容跟随动画+组每帧 commit+零残留) ===' : '*** 浸泡异常 ***');
await browser.close();
process.exit(ok ? 0 : 1);
