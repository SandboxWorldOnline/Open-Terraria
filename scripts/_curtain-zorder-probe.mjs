// ★加载幕布 z 序定谳探针(2026-10-22 用户实报「渲染世界阶段动态背景早退」)
// 假设:c10e 转正(2026-10-01 缺省开)后 Game 三画布(sky2D/glCanvas/主画布)全部
//  position:absolute(z-auto)且 attach() appendChild 到 root 末端;MenuBackground 画布
//  z-index:0 insertBefore firstChild——同层(z-auto/0)按 DOM 树序绘制=游戏画布画在
//  幕布之上(转正前主画布 static in-flow 绘制于全部 positioned 之下,幕布 z0 才盖得住)。
// 采样窗口=「menuBg 在场 ∧ __swGame 已挂」(onWorldReady→stopMenu 之间的幕布窗)。
// 判据(修复前):窗内 document.elementFromPoint(屏心) ≠ menuBg 画布(=游戏主画布)
//  ∧ menuBg 在 DOM 树序上先于主画布 ∧ 两者同为 positioned 同层——机制坐实。
// 判据(修复后):窗内 elementFromPoint = menuBg 画布(幕布重新盖住三画布)。
// 驱动流:__swFlow.blankWorld(8400,2400)——走真实 mainFlow onWorldReady→enterGame→
//  entryGate race→stopMenu 全链(与读档同链;大尺寸=烘焙窗更长便于采样)。
// 运行:SW_ORIGIN=http://localhost:5204 node tools/run-diag.mjs scripts/_curtain-zorder-probe.mjs
import { launchBrowser, openPage, bootstrap } from '../tools/probe/lib/index.mjs';
import fs from 'node:fs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5204';
const OUT = (process.env.CLAUDE_JOB_DIR || '/tmp') + '/tmp';
fs.mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?cloudcache=0');
// 探针环境摘启动幕族(#sw-boot-prime z10000 黑幕/#sw-splash 过渡页)——headless 下
// 过渡图/音频门不推进,启动幕交接链永不完成=黑幕永挂,污染 elementFromPoint 判读。
// 真机用户实报可见游戏画面=其环境启动幕已正常撤除;此两幕与幕布 z 序机制正交。
await page.evaluate(() => {
  document.getElementById('sw-boot-prime')?.remove();
  document.getElementById('sw-splash')?.remove();
});

// ---- 基线:标题屏(无 Game 画布,幕布应为最高可命中层之一) ----
const titleSample = await page.evaluate(() => {
  const bg = window.__swMenuBg?.canvas;
  if (!bg) return { err: 'no menuBg' };
  const el = document.elementFromPoint(innerWidth / 2, innerHeight * 0.8);
  return {
    menuBgZ: getComputedStyle(bg).zIndex, menuBgPos: getComputedStyle(bg).position,
    elFromPoint: el ? (el.tagName + (el.id ? '#' + el.id : '') + (el === bg ? ' ==menuBg' : '')) : 'null',
  };
});
console.log('[title 基线]', JSON.stringify(titleSample));

// ---- 幕布窗采样:rAF 轮询,窗内逐帧记录层序物证 ----
await page.evaluate(() => {
  window.__curt = [];
  window.__curtainHit = false;
  const ident = (el) => {
    if (!el) return 'null';
    const g = window.__swGame;
    if (el === window.__swMenuBg?.canvas) return 'menuBg';
    if (g) {
      if (el === g.renderer.canvas) return 'game-main';
      if (el === g.renderer.skyCanvas) return 'game-sky';
      if (el === g.renderer.glCanvasEl) return 'game-gl';
    }
    return el.tagName + (el.id ? '#' + el.id : '') + '.' + (el.className || '');
  };
  const sample = (phase) => {
    const bg = window.__swMenuBg?.canvas;
    const g = window.__swGame;
    if (!bg) return;
    const main = g?.renderer?.canvas;
    const rec = {
      t: Math.round(performance.now()), phase,
      menuBgConnected: bg.isConnected, gameExists: !!g,
      elCenter: ident(document.elementFromPoint(innerWidth / 2, innerHeight / 2)),
      elLow: ident(document.elementFromPoint(innerWidth / 2, innerHeight * 0.8)),
    };
    if (main) {
      const cs = getComputedStyle(main), csb = getComputedStyle(bg);
      rec.mainPos = cs.position; rec.mainZ = cs.zIndex;
      rec.menuBgZ = csb.zIndex;
      // DOCUMENT_POSITION_FOLLOWING(4)=menuBg 在 main 之前(树序更早)
      rec.menuBgBeforeMain = !!(bg.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING);
      rec.glShown = g.renderer.glCanvasEl ? g.renderer.glCanvasEl.style.display : 'no-el';
      rec.painted = g['_paintedFrames'] ?? -1;
    }
    window.__curt.push(rec);
    if (rec.menuBgConnected && rec.gameExists && rec.painted > 0 && !window.__curtainHit) {
      window.__curtainHit = true;
      // 首命中帧:root 全子代层序物证(DOM 序=z 同层绘制序)
      const g = window.__swGame;
      window.__layerDump = [...document.getElementById('game-root').children].map((el, i) => {
        const cs = getComputedStyle(el);
        return {
          i, tag: el.tagName, id: el.id || undefined, cls: (el.className || '').slice(0, 24) || undefined,
          pos: cs.position, z: cs.zIndex, pe: cs.pointerEvents,
          is: el === window.__swMenuBg?.canvas ? 'MENUBG' : g ? (el === g.renderer.canvas ? 'GAME-MAIN'
            : el === g.renderer.skyCanvas ? 'GAME-SKY' : el === g.renderer.glCanvasEl ? 'GAME-GL' : undefined) : undefined,
        };
      });
    }
  };
  sample('pre');
  const tick = () => {
    const inWindow = window.__swMenuBg?.canvas?.isConnected && window.__swGame;
    if (inWindow) sample('window');
    else if (window.__curt.length) sample('post');
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__driveBlank = async () => { await window.__swFlow.blankWorld(8400, 2400); };
});

// ---- 驱动真实进世界链,Node 侧捕窗截图 ----
const drive = page.evaluate(() => window.__driveBlank());
// 轮询窗首帧,命中即截屏(窗=menuBg 活 ∧ 已渲染)
let shotAt = null;
for (let i = 0; i < 600; i++) {
  const hit = await page.evaluate(() => window.__curtainHit);
  if (hit) {
    shotAt = i;
    await page.screenshot({ path: OUT + '/curtain-window.png' });
    break;
  }
  await new Promise((r) => setTimeout(r, 15));
}
await drive;   // blankWorld resolve(loadWorld 完成;stopMenu 随 entryGate race 异步落)
// 等 stopMenu 落定(窗关)
await new Promise((r) => setTimeout(r, 4000));
const after = await page.evaluate(() => ({
  menuBgGone: !window.__swMenuBg?.canvas?.isConnected,
  elCenter: (() => { const g = window.__swGame; const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return el ? (el === g?.renderer.canvas ? 'game-main' : el.tagName) : 'null'; })(),
}));
console.log('[stopMenu 后]', JSON.stringify(after), shotAt != null ? `(窗截图于第 ${shotAt} 轮)` : '(未捕到窗——窗过短?)');

// ---- 汇总窗内物证 ----
const summary = await page.evaluate(() => {
  const win = window.__curt.filter((r) => r.phase === 'window' && r.painted > 0);
  if (!win.length) return { err: '窗内零样本', total: window.__curt.length };
  const first = win[0], last = win[win.length - 1];
  const els = [...new Set(win.map((r) => r.elCenter))];
  return {
    n: win.length, spanMs: last.t - first.t,
    elCenterVariants: els,
    first,
    last,
    verd: els.every((e) => e === 'menuBg')
      ? 'FIXED:幕布盖住三画布(elementFromPoint=menuBg)'
      : (els.some((e) => e.startsWith('game-'))
        ? 'BUG:游戏画布浮于幕布之上(elementFromPoint=游戏画布——幕布被埋)'
        : 'OTHER:' + els.join(',')),
  };
});
console.log('[幕布窗汇总]', JSON.stringify(summary, null, 1));
const layers = await page.evaluate(() => window.__layerDump ?? null);
console.log('[窗内 root 层序]', JSON.stringify(layers, null, 1));
console.log('[截图]', OUT + '/curtain-window.png');
await browser.close();
