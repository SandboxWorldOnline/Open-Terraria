// ★常驻渲染债审计探针(2026-10-27 用户令:「找到当前最大的常驻渲染瓶颈——任何
//  环境都要付的渲染债,里面有哪些优化点」)
// 场景(perf 纪律:全程真实 rAF,禁泵):
//  · idle-stand:站定不动 10s——纯常驻面(天空/云 GL 管线/静态 chunk/光照/HUD/
//    常驻合成税),「任何环境都要付」的本体
//  · walk:强制 vx=4 行走 10s——加实体更新+相机卷动+chunk 边缘翻页(用户 118-124
//    浮动语境)
//  · idle-gladd:?gladd=1 页重跑 idle-stand——A/B 量化「c10e 加算垫底折叠」
//    (每帧 2 次全屏 drawImage,Trace-230353 定谳的第一架构税;gladd Phase1 ①②
//    已落地灰度)的可回收量
// 通道:profile(函数自耗主通道)+trace(含 GPU 类目)+metrics;有头 Chrome
// (真 GPU/合成器——Mac=用户实机环境,读数可代用户实机)。
// 运行:SW_ORIGIN=http://localhost:52xx node tools/run-diag.mjs scripts/_resident-render-debt-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump, installFrameProbe, armPerfInstrumentation, createPerfRecorder, sleep } from '../tools/probe/lib/index.mjs';
import { writeFileSync } from 'node:fs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5204';
const OUT = (process.env.CLAUDE_JOB_DIR || '/tmp') + '/tmp/perf-resident';
const browser = await launchBrowser({ headed: true, viewport: { width: 1600, height: 1000 } });

async function conditions(page) {
  return page.evaluate(() => {
    const g = window.__swGame;
    return {
      entities: g.entities.npcs.length + g.entities.enemies.length + g.entities.projectiles.length
        + g.entities.drops.length + g.entities.critters.length,
      t01: +g.world.clock.timeOfDay.toFixed(3),
      rain: !!g.world.weather?.rainNow ?? false,
      c10e: g.renderer.constructor.c10e, gladd: g.renderer.constructor.gladd,
      interp: g.constructor.interp, interpGate: g['_interpGate'],
      frameCap: g.beat.cap, painted: g['_paintedFrames'],
    };
  });
}

async function runIdle(page, rec, name, ms) {
  await page.evaluate(() => {
    const g = window.__swGame;
    g.entities.enemies.length = 0; g.entities.projectiles.length = 0;   // 清场(常驻面纯度)
    window.__walkOn = false;
  });
  await rec.settled();   // ★上段 trace 排空收口后才开新段(竞态=Tracing.start 撞在途会话丢整段 trace)
  await sleep(1500);   // 清场后稳定窗
  await rec.startSegment(name, { kind: 'dwell' });
  await sleep(ms);
  const seg = await rec.endSegment();
  return { seg, cond: await conditions(page) };
}

async function runWalk(page, rec, name, ms) {
  // 页内 rAF 行走驱动:注册序在游戏 loop 之后=每帧渲染后写 vx,下一帧生效
  await page.evaluate(() => {
    const g = window.__swGame;
    g.entities.enemies.length = 0; g.entities.projectiles.length = 0;
    window.__walkOn = true;
    const w = () => { if (window.__walkOn) { g.player.vx = 4; } requestAnimationFrame(w); };
    requestAnimationFrame(w);
  });
  await rec.settled();   // ★同上:段前收口上段 trace
  await rec.startSegment(name, { kind: 'transit' });
  await sleep(ms);
  const seg = await rec.endSegment();
  await page.evaluate(() => { window.__walkOn = false; });
  return { seg, cond: await conditions(page) };
}

const report = { origin: ORIGIN, ts: new Date().toISOString(), segments: [] };

// ---- 页 1:缺省档(idle + walk) ----
{
  const page = await openPage(browser, {});
  await armPerfInstrumentation(page, {});
  await bootstrap(page, ORIGIN + '/?cloudcache=0');
  await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261027 });
  await installFrameProbe(page);
  await pump(page, 30);          // 落地+首帧烘焙出计量窗(首烘/首夜尖峰不进常驻账)
  await sleep(8000);             // 常驻稳态:chunk 静止/天空首烘/星预热完成
  const rec = createPerfRecorder(page, { outDir: OUT, scenario: 'resident', traceGpu: true });
  report.segments.push({ ...await runIdle(page, rec, 'idle-stand', 10_000), cond0: await conditions(page) });
  report.segments.push({ ...await runWalk(page, rec, 'walk', 10_000) });
  await rec.settled();
  report.channelErrors = rec.channelErrors;
  await page.close();
}

// ---- 页 2:gladd 运行时翻旗(idle+walk A/B;URL 传参会被 gotoApp 尾拼 /?t= 污染,
//      静态旗每帧消费=运行时翻面即生效——旧 _gladd-coat-ab 判例) ----
{
  const page = await openPage(browser, {});
  await armPerfInstrumentation(page, {});
  await bootstrap(page, ORIGIN + '/?cloudcache=0');
  await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261027 });
  await installFrameProbe(page);
  await page.evaluate(() => { window.__swGame.renderer.constructor.gladd = true; });
  await pump(page, 30);
  await sleep(8000);
  const rec = createPerfRecorder(page, { outDir: OUT, scenario: 'resident-gladd', traceGpu: true });
  report.segments.push({ ...await runIdle(page, rec, 'idle-stand-gladd', 10_000) });
  report.segments.push({ ...await runWalk(page, rec, 'walk-gladd', 10_000) });
  await rec.settled();
  report.channelErrors = [...(report.channelErrors ?? []), ...rec.channelErrors];
  await page.close();
}

writeFileSync(OUT + '/report.json', JSON.stringify(report, null, 1));
// ---- 人读摘要 ----
for (const s of report.segments) {
  const f = s.seg.fps ?? {};
  console.log(`\n== ${s.seg.name} == wall=${s.seg.wallMs}ms fps=${f.mean}(low1=${f.low1}) rafMean=${f.rafMean} sim=${s.seg.sim.msPerFrame}ms/帧(${s.seg.sim.sharePct}%)`);
  console.log(`   cond: ${JSON.stringify(s.cond)}`);
  console.log(`   gc: ${JSON.stringify(s.seg.gc)} gpu: ${JSON.stringify(s.seg.gpu)}`);
  if (s.seg.profile?.funcs?.length) {
    console.log('   -- 函数自耗 top20(selfMs;⚠samples≤2且avgMs>10=Profiler.start 停顿/帧尾 idle 吸收伪影,标*) --');
    for (const fn of s.seg.profile.funcs.slice(0, 20)) {
      const art = fn.samples <= 2 && fn.avgMs > 10 ? '*' : ' ';
      console.log(`  ${art}${String(Math.round(fn.selfMs)).padStart(7)}ms ${String(fn.selfPct).padStart(5)}% n=${String(fn.samples).padStart(4)} ${fn.fn}  @${(fn.url || '').split('/').slice(-1)[0]}:${fn.line}`);
    }
  }
  if (s.seg.trace?.breakdown) console.log(`   trace.breakdown: ${JSON.stringify(s.seg.trace.breakdown)}`);
}
console.log('\n[artifacts]', OUT);
await browser.close();
