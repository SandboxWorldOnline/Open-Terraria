// ★30fps 插值幻影感定谳探针(2026-10-24 用户实报「30fps 行走时画面幻影感/体验更差」)
// 假设:interp(FYT 渲染插值)只在「渲染率>逻辑率 60Hz」时有中间帧收益。30fps
//  (锁帧档/自动降档)下每渲染帧吃 2 逻辑步,alpha=acc/FIXED_DT 随 vsync/锁档误差
//  在 [0,1) 游走 → 渲染位=prev+alpha·(curr−prev) 在一步跨度内来回摆 → 帧间位移
//  不规则(0..2×步长交替)=时序抖动 judder,眼读作幻影/重影;且恒定滞后 ≤1 tick
//  零收益。60Hz 档同族(1 步/帧 alpha≈0 恒滞后 1 tick,偶发 0 步帧 alpha≈1 跳变)。
// 驱动:手动 g.frame(合成时间戳)精确控 dt——30fps 连续抖动(±2.5ms)与 vsync 量化
//  (120Hz 屏 30 档=4×8.33 槽,偶发 3/5 槽=25/41.67ms)两形态;120fps 均匀对照。
// 判据(修前):30fps+interp ON → renderedX 帧间 delta 不规则(std 高/min≈0/max≈2×均值)
//  ∧ alpha 游走 [0,1);30fps+interp OFF → delta 均匀;120fps+ON → delta 均匀(平滑对照)。
// 判据(修后=interp 收益门):30fps → renderer.interpA=-1(渲染 curr,delta 均匀);
//  120fps → 门开,interpA 0/0.5 扫描照旧(delta 均匀)。
// 运行:SW_ORIGIN=http://localhost:5204 node tools/run-diag.mjs scripts/_interp-30fps-judder-probe.mjs
import { launchBrowser, openPage, bootstrap, createGame, pump } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5204';
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/?cloudcache=0');
await createGame(page, { mode: 'direct', seed: '05162020', size: 'small', pinRandom: 20261021 });
await pump(page, 40);   // 落地稳定

// 场景 dt 序列(确定性,Node 侧预产;ON/OFF 共用同序列=配对对照)
// ★基值取 tick 整倍数(1000/60×2 等)——33.333 这类舍入值对 2×16.6667 有 −0.3µs/帧
//  漂移,数百帧累计成 1/3 步拍频伪影污染「acc 累计器整步补偿」判读(首版实测教训)
const lcg = (s) => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const rnd = lcg(20261024);
const T = 1000 / 60;
const dts30jitter = Array.from({ length: 90 }, () => 2 * T + (rnd() - 0.5) * 5);
const dts30load = Array.from({ length: 90 }, () => Math.max(16.7, 2 * T + (rnd() - 0.5) * 16));   // 机器跟不满 60 的真实形态:帧成本方差大(±8ms,偶发 1 步帧)
const dts30quant = Array.from({ length: 90 }, (_, i) => ((i % 6) === 4 ? 2.5 * T : (i % 6) === 5 ? 1.5 * T : 2 * T));   // 锁 30 档 vsync 槽跳(120Hz 屏 5/3 槽补偿对)
const dts120 = Array.from({ length: 120 }, () => 0.5 * T + (rnd() - 0.5) * 0.8);

// 页内驱动器:清走廊(防地形挡路)+每帧强制 vx(行走)+逐帧采样渲染消费位
const setup = await page.evaluate(() => {
  const g = window.__swGame;
  if (!g) return false;
  g.running = false;          // 停 rAF(手动驱动纪律)
  g.paused = false;
  g['_tpVeil'] = false;
  g['_entryFreeze'] = null;
  // 走廊:脚下找实地 → 造平地板(dirt)+上方 6 格净空——自然地形有洞/起伏,裸清
  // 会让玩家掉坑卡墙(首版实测:第 7 场景起 delta 0/7.7 交替=卡死伪影)
  const TS = 16, p = g.player, w = g.world;
  const ptx = Math.floor(p.x / TS), pty = Math.floor(p.y / TS);
  let fy = pty, guard = 0;
  while (guard++ < 80 && !w.store.get(ptx, fy)) fy++;
  for (let tx = ptx - 12; tx <= ptx + 400; tx++) {
    for (let ty = fy - 6; ty < fy; ty++) w.store.setTile(tx, ty, 0);
    w.store.setTile(tx, fy, 1);   // 平地板:整段恒实心
  }
  window.__corridor = { x: (ptx + 2) * TS, y: fy * TS - p.h - 2 };
  window.__vnow = performance.now();
  window.__driveSeq = (dts, vx) => {
    const gg = window.__swGame, pp = gg.player;
    // 场景间复位:传送回走廊锚点(触发 _tpVeil 即清)+满血+清敌(探针纪律:冻结窗
    // 标志必须清;敌怪击退/伤害污染位移序列)
    pp.x = window.__corridor.x; pp.y = window.__corridor.y;
    pp.vx = 0; pp.vy = 0; pp.hp = 500;
    gg.entities.enemies.length = 0;
    gg['_tpVeil'] = false; gg['_entryFreeze'] = null;
    gg.lastTime = window.__vnow; gg.acc = 0;
    const out = [];
    for (const dt of dts) {
      pp.vx = vx;                      // 每帧强制行走速度(摩擦每 tick 衰减,帧间重置)
      window.__vnow += dt;
      gg.frame(window.__vnow);
      if (gg['_tpVeil']) gg['_tpVeil'] = false;   // 场景内偶发大位移(击退等)防幕帘污染后续帧
      const iA = gg.renderer.interpA;  // 本帧渲染消费的 alpha(临时写位=prev+(cur-prev)·iA)
      const prev = gg['_iPX'], cur = pp.x;
      out.push({
        dt: +dt.toFixed(2), acc: +gg.acc.toFixed(2), iA: +iA.toFixed(3),
        prev: +prev.toFixed(2), cur: +cur.toFixed(2),
        rendered: +(iA >= 0 ? prev + (cur - prev) * iA : cur).toFixed(2),
      });
    }
    return out;
  };
  return true;
});
if (!setup) throw new Error('setup failed');

const stats = (rows) => {
  const ds = [];   // rendered 帧间位移(弃前 5 帧:门自适应/EMA 热身窗)
  for (let i = 6; i < rows.length; i++) ds.push(+(rows[i].rendered - rows[i - 1].rendered).toFixed(2));
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const std = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length);
  const ias = rows.slice(6).map((r) => r.iA);
  return {
    n: ds.length, meanDelta: +mean.toFixed(2), std: +std.toFixed(2),
    minDelta: +Math.min(...ds).toFixed(2), maxDelta: +Math.max(...ds).toFixed(2),
    alphaMin: +Math.min(...ias).toFixed(3), alphaMax: +Math.max(...ias).toFixed(3),
    irregularFrac: +(ds.filter((d) => Math.abs(d - mean) > 1.5).length / ds.length).toFixed(2),
  };
};

async function run(name, dts, interpOn, vx = 4) {
  await page.evaluate((on) => {
    const G = window.__swGame.constructor;
    G.interp = on;   // 静态旗页内翻(配对对照;TS static 属性运行时可写)
  }, interpOn);
  const rows = await page.evaluate((a) => window.__driveSeq(a.dts, a.vx), { dts, vx });
  console.log(`[${name}]`, JSON.stringify(stats(rows)));
  return rows;
}

console.log('== 门后采样(interp 静态旗缺省开;S30 各形态应与 OFF 对照同分布=门关) ==');
await run('S120 对照(半 tick/帧,期望 delta 均匀,门开插值照旧)', dts120, true);
await run('S30 连续抖动 ±2.5ms(门应关→与 OFF 同)', dts30jitter, true);
await run('S30 负载抖动 ±8ms(门应关→与 OFF 同)', dts30load, true);
await run('S30 vsync 量化 槽跳补偿对(门应关→与 OFF 同)', dts30quant, true);
await run('S30 连续抖动 OFF 对照', dts30jitter, false);
await run('S30 负载抖动 OFF 对照', dts30load, false);
await run('S30 vsync 量化 OFF 对照(acc 累计器整步补偿,期望 delta 完全均匀)', dts30quant, false);

// 帧级明细:量化形态头 18 帧(interp ON——先复位旗再驱动,上一场景 OFF 残留陷阱)
await page.evaluate(() => { window.__swGame.constructor.interp = true; });
const detail = await page.evaluate((a) => window.__driveSeq(a.dts, a.vx), { dts: dts30quant.slice(0, 18), vx: 4 });
console.log('== S30 量化形态逐帧明细(interp 旗开;门应关→iA=-1 渲染 curr;dt/acc[s]/alpha/prev/cur/rendered) ==');
for (const r of detail) console.log(JSON.stringify(r));
await browser.close();
