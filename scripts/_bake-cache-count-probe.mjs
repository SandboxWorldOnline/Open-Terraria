// ★任务#27 烘焙缓存活体计数探针:翼装场景下数 getImageData(烘焙读回的硬指标)
// A/B:缓存开(缺省) vs 运行时关(Renderer.bakeCacheOn=false,URL 传参会被 gotoApp
// 尾拼 /?t= 污染——静态旗运行时可写,gladd/lightsteady 同判例)。
// 判据:星尘翼(32 glowAdd,常数 [1,1,1] tint)恒等快路径 → 缓存开应≈0 读回/帧;
//  逃生门关=旧路径恒烘 ≈1-2 读回/帧(主绘+水罩镜像,不入水≈1)。
// 运行:SW_ORIGIN=http://localhost:5207 node tools/run-diag.mjs scripts/_bake-cache-count-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5207';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?cloudcache=0');
await createGame(page, { size: 'small', settleMs: 1500 });
await pump(page, 30);

// 装星尘翼(32 glowAdd——addScratch 常数 [1,1,1] 档)+裹读回计数器
await page.evaluate(async () => {
  const g = window.__swGame;
  const m = await import('/src/render/Renderer.ts');
  g.player.inv.armor[3] = { id: g.itemId('vi_3471_stardust_wings'), stack: 1 };
  window.__setBakeCache = (v) => { m.Renderer['bakeCacheOn'] = v; };
  const raw = CanvasRenderingContext2D.prototype.getImageData;
  window.__gidCount = 0;
  CanvasRenderingContext2D.prototype.getImageData = function (...a) {
    window.__gidCount++;
    return raw.apply(this, a);
  };
});
await pump(page, 120);   // equipStats 缓存周期(~161ms)过了翼才上屏
// 预热 Glow_183(ensureVImage 懒异步:首调 null,~400ms 后到位——冷页面无预热=翼
// overlay 不绘,计数恒 0 的假阴性;bj719 长会话天然热)
await page.evaluate(async () => {
  const atlas = window.__swGame.renderer.atlas;
  for (let i = 0; i < 10; i++) {
    if (atlas?.ensureVImage?.('vanilla/Glow_183.png')) break;
    await new Promise((r) => setTimeout(r, 300));
  }
});

async function window(name, ms) {
  await page.evaluate(() => {
    window.__gidCount = 0;
    // 滞空钉位:翼 overlay 仅飞行态绘制(bj719 PhaseB 水上/水下同差=静止不画)——
    // 每 rAF 把玩家钉在出生点上空 200px(vy=0),维持飞行姿态渲染
    const g = window.__swGame, p = g.player;
    const gy = p.y;
    window.__flyPin = true;
    const fp = () => {
      if (window.__flyPin) { p.y = gy - 200; p.vy = 0; p.wingTime = (p.wingTime ?? 0) + 1; }
      requestAnimationFrame(fp);
    };
    requestAnimationFrame(fp);
  });
  await new Promise((r) => setTimeout(r, ms));
  await page.evaluate(() => { window.__flyPin = false; });
  const r = await page.evaluate((ms2) => ({
    n: window.__gidCount,
    frames: window.__swGame['_paintedFrames'],
    wing: !!window.__swGame.player.equipStats.wing,
  }), ms);
  console.log(`[${name}] getImageData=${r.n}(${(r.n / (ms / 1000)).toFixed(1)}/s,${(r.n / Math.max(1, r.frames)).toFixed(2)}/渲染帧) 翼=${r.wing} 渲染帧=${r.frames}`);
}

await page.evaluate(() => window.__setBakeCache(true));
await window('缓存开(缺省,期望 ≈0/帧:恒等快路径免读回)', 4000);
await page.evaluate(() => window.__setBakeCache(false));
await new Promise((r) => setTimeout(r, 800));
await window('缓存关=逃生门(旧路径:恒烘,期望 ~1/帧)', 4000);
await page.evaluate(() => window.__setBakeCache(true));
await browser.close();
