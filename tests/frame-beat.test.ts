// ★v9.12 锁帧档回归锁(2026-10-08 用户产品裁决「宁愿渲染减速也不应帧数反复抖动」定谳后;
//  FrameBeat.ts 头注 v9.12):渲染决策=累计器锁帧档(cap>0:shouldRender=now ≥ _nextDue−
//  0.75,渲染帧距均值=档周期精确值→fps 读数钉死;cap=0=跟满档恒渲,v9.11 语义保留为「关」
//  档)+帧距方差自适应降档(非重叠 60 渲染帧窗 std>0.22×档周期 连续 2 窗→沿阶梯降,
//  std<0.11×档周期 连续 6 窗→最高优先升档回探)。
//  - 标定改判(诚实登记,BJ250 处方证伪判例同款):①处方「绝对 2ms 阈」证伪——更新过程
//    续新过量物理决定宽间隔流上帧距绝对 std 由流自身间隔分布决定、与档周期无关
//    (tests 摘监控逐档锁定实测:双峰流 absStd p50 120 档 1.94/90 档 3.80/60 档 2.78/
//    30 档 3.21),绝对阈会把宽流级联穿透所有档;判据改判相对量纲 std/周期(感知占比:
//    3ms 抖动占 120 档预算 36% 刺眼、占 30 档预算 10% 无感)。②「60 档 std<2ms 收敛」
//    处方证伪——绝对 std 不随降档收敛;真实收益=读数钉死(平均帧距=档周期精确)+
//    相对占比收窄(双峰流 rel 0.233@120→0.167@60→0.096@30)。③【锁 120 可比跟满更抖】
//    (双峰流锁定 rel 0.233/相邻帧距跳变 656 vs 跟满 0.204/422——ε-walk 锯齿 {4,12}ms
//    追赶对):正是监控在 120 档判不稳下降档的机理本体;双峰流 cap120 的产品落点=锁 60
//    (rel 0.167 反超跟满 0.204=真收益+读数钉 60.0)。④est 可达性过滤处方证伪——非网格
//    流上 est 误判把唯一稳定档逐出路径、卡死在不稳档(60 档@7.5ms 流 dev=0.22 被逐,
//    实测恰为驻留稳定档);改判=无过滤+升档最高优先(失败由降档自然落回)。
//  - 判别面数字(tests 标定):双峰流(25% [4,6]+75% [8,9],~131/s)cap120 → 降档轨迹
//    [120,90,60] 落 60 驻留;T114436 真实语料 rel 0.374@120→0.310@60→0.166@30 →
//    [120,90,60,30] 落底驻留;窄峰流/LIVE@120 驻留不降。
//  - 变异证红:摘方差监控(120 档抖动持续)=红;摘累计器(v9.11 跟满形态)=读数随流
//    漂移+帧距本距不钉档=红。
//  - 保留面:估计器诊断面(v9.5 清退态截尾均值)/成本窗/失拍账/migrationEnabled=false
//    闸(v5-v8 判据组=史档+红判别器复刻点)/v9.7 hold(暂停期档位迁移冻结)。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { FrameBeat, GRID_MS, TIER_LADDER, DUE_GUARD_MS, VAR_WIN, VAR_STD_RATIO, VAR_UP_RATIO, VAR_DOWN_WINDOWS, VAR_UP_WINDOWS, UPGRADE_WIN_SAMPLES, UPGRADE_HOLD_WINDOWS, UPGRADE_HEADROOM, DOWNGRADE_MARGIN, MISS_SLACK, MISS_GRID_TOL_REL, MISS_GRID_TOL_MS, MISS_STREAK_DOWNGRADE, MISS_STALL_BUDGET_MS, FLOOR_HOLD_WINDOWS, trimmedMeanVsync, varAdaptSetForTest } from '../src/core/FrameBeat';

const GAME = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const BEAT = readFileSync(new URL('../src/core/FrameBeat.ts', import.meta.url), 'utf8');
const SETTINGS = readFileSync(new URL('../src/ui/Settings.ts', import.meta.url), 'utf8');
const OPTIONS = readFileSync(new URL('../src/core/Options.ts', import.meta.url), 'utf8');

/** 确定性 LCG(单测须可复现,禁 Math.random) */
function lcgOf(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

const HZ120 = 1000 / 120;
const HZ60 = 1000 / 60;

/** 显示网格 interval 流(按绝对网格步索引) */
function makeIntervals(vsync: number, jitter: number, n: number, seed: number) {
  const lcg = lcgOf(seed);
  return Array.from({ length: n }, () => vsync * (1 + jitter * (2 * lcg() - 1)));
}

/** ★v9.12 合成双峰流(案情模型:4-6ms 主峰 + 8-9ms 次峰;25/75 混合均值≈7.6ms→~131/s,
 *  落在用户实测 110-128 瞬时率带) */
function makeBimodal(n: number, seed: number) {
  const lcg = lcgOf(seed);
  return Array.from({ length: n }, () => (lcg() < 0.25 ? 4 + 2 * lcg() : 8 + lcg()));
}

/**
 * 引擎驱动器:回调时间流喂 FrameBeat,返回渲染帧起点序列+回调序列。
 * 回调时点模型(真实 Chrome):rAF 只在「上一回调之后的下一网格点」触发;渲染超支
 * 越过网格点时,迟帧的回调在解堵点(busy)即跑——时间戳单调。
 */
function runBeat(opts: {
  vsync: number;
  cap: number;
  cost: number | ((i: number, t: number) => number);
  callbacks: number;
  seed?: number;
  jitter?: number;
  make?: () => FrameBeat;
}) {
  const { vsync, cap, cost, callbacks, seed = 7, jitter = 0, make = () => new FrameBeat() } = opts;
  const intervals = makeIntervals(vsync, jitter, callbacks * 8, seed);
  const beat = make();
  let step = 0;
  let grid = 0;
  let busy = 0;
  let prevT = -1;
  const rendered: number[] = [];
  const cbs: number[] = [];
  const tiers: { i: number; tier: number; reason: string }[] = [];   // ★v9.14:档位史(容量判据面断言用)
  for (let i = 0; i < callbacks; i++) {
    while (grid <= prevT) grid += intervals[step++ % intervals.length];
    const t = Math.max(grid, busy);
    prevT = t;
    cbs.push(t);
    beat.observeVsync(t, cap);
    if (beat.shouldRender(t)) {
      beat.beginRender(t);
      rendered.push(t);
      const c = typeof cost === 'function' ? cost(i, t) : cost;
      busy = t + c;
      beat.endRender(t + c);
      tiers.push({ i, tier: beat.snapshot().tier, reason: beat.lastReason });
    }
  }
  return { beat, rendered, cbs, tiers };
}

/** 帧距序列指标:p50/均值/标准差/跳变次数(相邻帧距差>jumpMs);mean 供 realized fps 判读 */
function gapStats(rendered: number[], jumpMs = 4) {
  const gaps: number[] = [];
  for (let i = 1; i < rendered.length; i++) gaps.push(rendered[i] - rendered[i - 1]);
  const s = [...gaps].sort((a, b) => a - b);
  const p50 = s[Math.floor(s.length / 2)] ?? 0;
  const mean = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
  const std = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / (gaps.length || 1));
  let jumps = 0;
  for (let i = 1; i < gaps.length; i++) if (Math.abs(gaps[i] - gaps[i - 1]) > jumpMs) jumps++;
  return { p50, std, jumps, gaps, mean };
}

/** 60 渲染帧滚动 fps 序列(Game.frameDts 读数口径) */
function fpsSeries(rendered: number[], win = 60) {
  const gaps: number[] = [];
  for (let i = 1; i < rendered.length; i++) gaps.push(rendered[i] - rendered[i - 1]);
  const fps: number[] = [];
  for (let j = win; j < gaps.length; j++) {
    let sum = 0;
    for (let k = j - win; k < j; k++) sum += gaps[k];
    fps.push(1000 / (sum / win));
  }
  return fps;
}
const q = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
/** 浮点帧距集(1e-6 取整;用于帧距集合逐位比对) */
const gapSet = (gaps: number[]) => new Set(gaps.map((g) => Math.round(g * 1e6) / 1e6));
/** 非重叠 VAR_WIN 窗 std 序列(与引擎方差窗同参) */
function winStds(gaps: number[], win = VAR_WIN) {
  const out: number[] = [];
  for (let j = 0; j + win <= gaps.length; j += win) {
    const w = gaps.slice(j, j + win);
    const m = w.reduce((a, b) => a + b, 0) / win;
    out.push(Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / win));
  }
  return out;
}
/** 简易 delta 流驱动器(无 busy 反馈;语料回放/方差面用) */
function driveDeltas(deltas: number[], cap: number, opts?: { cost?: number; make?: () => FrameBeat; holdAt?: (i: number) => boolean }) {
  const beat = opts?.make ? opts.make() : new FrameBeat();
  const cost = opts?.cost ?? 3;
  const gaps: number[] = [];
  const tiers: { i: number; tier: number; reason: string }[] = [];
  const rendered: number[] = [];
  const cbs: number[] = [];
  let t = 0;
  let last = -1;
  for (let i = 0; i < deltas.length; i++) {
    if (opts?.holdAt) beat.hold(opts.holdAt(i));
    t += deltas[i];
    beat.observeVsync(t, cap);
    cbs.push(t);
    if (beat.shouldRender(t)) {
      beat.beginRender(t);
      rendered.push(t);
      if (last >= 0) gaps.push(t - last);
      last = t;
      beat.endRender(t + cost);
      tiers.push({ i, tier: beat.snapshot().tier, reason: beat.lastReason });
    }
  }
  return { beat, gaps, tiers, rendered, cbs };
}
/** 档位迁移轨迹(去重相邻同态) */
const tierChanges = (tiers: { i: number; tier: number; reason: string }[]) =>
  tiers.filter((x, i, a) => i === 0 || x.tier !== a[i - 1].tier || x.reason !== a[i - 1].reason);

// ── ★真实 trace 回放流(Trace-20260929T164816 @localhost:4173,主线程 rAF 序列实拍;
//    饱和回声流)——估计器诊断面语料(红判别器 A/B 共享同一物理流)──
const DELTAS_X10 = [124,122,104,123,160,135,114,95,119,96,155,124,126,116,95,115,97,128,129,133,95,147,120,125,93,165,122,131,96,121,122,106,120,118,117,93,117,97,143,129,131,134,97,132,125,100,145,131,134,94,130,122,135,96,143,117,100,128,122,125,90,130,139,124,96,115,143,95,122,152,129,120,115,120,95,123,122,124,116,123,140,123,98,121,116,93,120,115,158,114,116,94,128,126,121,108,121,114,93,119,126,94,117,116,91,142,116,116,93,159,116,91,118,116,94,113,145,97,128,117,95,125,111,129,125,119,92,120,119,121,95,136,109,121,94,119,126,91,128,127,120,122,127,125,90,119,121,95,114,113,91,117,89,133,127,95,127,148,139,122,94,124,120,90,122,114,87,140,112,92,125,122,104,116,134,138,94,144,153,122,106,131,117,93,134,153,152,155,157,147,149,149,201,218,119,123,96,118,121,96,118,91,114,93,134,139,115,122,97,120,115,92,129,137,98,122,117,120,97,124,128,98,138,124,92,117,117,98,123,118,106,119,112,96,113,137,126,94,115,123,118,113,117,91,124,121,90,116,100,127,132,125,98,129,118,126,99,162,118,126,88,146,115,97,126,120,89,124,117,128,90,120,118,97,143,115,101,118,145,123,96,122,124,97,161,127,142,118,96,126,118,113,124,122,98,128,123,123,94,141,118,111,126,124,115,118,131,139,139,99,126,128,120,94,121,129,97,124,125,99,138,116,97,114,124,114,121,113,116,101,117,123,96,132,134,123,96,121,128,94,132,140,143,92,126,129,95,123,121,104,132,128,121,99,134,129,124,94,143,123,99,121,158,119,109,116,175,122,103,124,121,101,123,125,122,131,122,117,102,128,128,122,137,118,94,97,119,141,137,124,90,149,122,96,117,127,125,123,90,91,117,118,135,136,92,120,95,119,125,143,137,122,120,122,121,94,128,142,90,119,96,123,122,122,96,169,124,123,120,94,117,120,93,120,120,94,127,127,90,124,127,89,133,139,119,94,166,133,125,96,115,116,91,113,96,119,115,113,93,129,135,85,119,124,95,111,125,88,138,112,85,134,117,90,109,87,132,113,144,87,115,114,86,115,86,135,121,84,111,115,89,130,127,91,104,81,125,87,111,115,84,129,121,108,78,112,130,83,129,115,198,115,114,127,101,126,103,110,80,108,85,110,112,81,103,81,116,113,86,117,81,107,111,111,112,107,81,133,93,112,106,83,105,93,114,106,84,107,93,115,105,80,104,105,102,100,80,108,118,106,109,77,120,102,77,104,81,102,79,105,106,73,107,96,102,103,102,121,75,102,74,98,74,102,98,76,109,75,118,72,99,72,105,75,105,103,100,106,81,132,80,109,78,106,114,77,116,79,104,95,107,103,77,108,84,140,110,109,76,102,88,101,102,81,105,75,104,97,106,108];
const COSTS_X10 = [107,88,107,143,118,98,80,105,83,132,107,110,102,81,101,77,108,110,117,81,133,103,108,79,150,105,116,81,106,107,80,105,104,102,77,103,80,127,108,109,120,82,115,111,84,129,115,121,80,114,108,119,80,130,101,83,112,106,108,76,113,123,108,82,99,127,79,107,132,110,104,101,105,81,108,105,110,102,109,125,109,84,105,100,77,105,77,144,99,102,79,114,110,104,77,105,100,78,103,109,78,100,99,76,129,102,101,79,142,101,78,101,100,80,98,127,81,112,101,76,106,96,93,106,101,77,103,104,107,81,121,96,105,78,99,112,77,112,106,104,107,101,110,77,101,105,80,100,99,74,103,74,117,110,79,99,132,123,107,80,107,101,75,104,100,73,117,96,78,107,107,81,98,119,123,78,126,136,105,90,113,100,78,119,139,136,136,138,129,132,134,125,198,101,109,81,104,103,76,103,77,97,76,117,124,97,107,82,102,98,76,103,119,80,103,98,104,81,108,111,84,124,109,77,99,104,77,104,103,78,104,98,80,99,121,111,81,101,109,99,98,104,77,108,106,77,101,85,108,113,107,81,112,101,110,84,146,101,111,74,131,101,83,109,103,76,111,101,113,78,101,101,83,129,101,79,102,127,106,78,104,108,80,140,108,124,101,81,110,104,97,107,104,80,111,105,106,80,125,104,94,109,110,82,102,115,119,125,81,110,105,105,80,105,113,79,108,109,83,121,102,83,98,107,97,107,99,101,87,103,106,81,118,114,106,81,104,111,80,112,123,128,76,107,113,81,105,106,82,117,109,106,83,118,109,107,78,125,107,82,105,141,104,91,100,107,107,81,106,107,83,105,109,108,99,108,102,81,111,114,108,122,103,79,81,99,122,121,109,75,135,107,79,102,111,110,107,77,77,101,100,105,122,75,103,79,102,109,128,76,108,104,105,104,79,104,127,76,105,77,106,103,107,79,144,109,104,103,78,100,102,78,101,103,77,103,113,74,107,112,73,113,123,101,76,149,111,108,81,100,100,75,99,78,103,100,94,76,110,120,71,100,109,76,96,109,73,122,97,72,102,101,75,94,74,115,97,126,73,99,98,71,100,71,120,106,70,96,99,73,114,113,73,91,68,111,72,95,99,69,114,103,93,65,97,111,69,113,101,183,95,99,111,86,112,84,95,65,93,69,90,93,64,88,66,93,98,68,100,65,91,93,95,97,91,62,118,66,96,91,68,90,68,95,91,70,92,67,99,88,62,88,87,86,86,63,93,62,86,94,61,104,86,61,87,66,87,64,86,90,58,92,82,86,64,84,105,59,86,59,84,60,82,83,61,88,60,103,58,83,55,87,60,90,84,84,84,56,112,60,91,63,88,96,61,99,62,87,57,89,85,62,93,68,124,91,93,61,87,57,82,85,64,88,59,89,58,90,91,61];

// ── ★真实实报流(Trace-20261006T033001,用户机 subtle+cap120)──
//  主循环链 rAF FunctionCall 实拍,s10-s13 在册稳态切片(无 stall,max delta 13.5ms)。
//  v9.12 锁档语料:cap120 累计器锁定(读数钉 ~119.9、零降档);
const LIVE_DELTAS_X10 = [65,72,81,88,87,86,75,81,88,78,84,90,77,81,67,81,68,83,48,91,127,83,103,105,95,74,77,81,84,79,87,86,79,81,83,85,91,82,58,68,80,87,53,70,74,79,81,86,79,87,84,68,78,90,57,61,83,76,80,74,83,83,85,76,66,81,59,85,69,78,79,83,78,79,78,84,91,63,80,76,65,73,87,82,66,76,78,89,75,89,63,79,68,91,65,76,79,75,69,89,76,82,89,77,84,92,94,70,79,91,82,77,83,86,87,76,92,90,68,85,90,83,63,88,71,54,80,79,68,91,80,115,48,82,73,82,86,90,76,82,70,88,54,84,76,87,56,85,79,75,83,84,80,71,73,65,99,130,78,55,97,95,135,61,58,83,90,79,84,82,82,65,83,60,84,87,54,68,73,86,89,79,87,83,75,88,84,80,85,92,82,75,91,86,81,84,60,85,129,82,65,80,85,89,78,84,79,86,86,88,79,81,83,81,69,63,75,93,49,79,77,77,75,82,86,90,75,84,100,77,77,84,80,70,81,64,77,94,51,66,90,81,86,73,84,89,80,79,94,79,86,85,64,86,65,84,63,67,73,85,72,85,79,88,86,86,86,82,75,83,83,91,85,75,87,80,84,77,71,71,92,62,82,82,110,92,97,79,94,76,83,89,87,74,84,77,73,66,81,91,39,85,74,80,87,79,84,83,91,83,74,94,82,79,66,90,56,94,75,65,63,77,80,92,73,87,80,75,86,51,90,61,81,87,67,82,72,82,84,87,65,89,60,84,70,77,81,67,75,89,79,85,75,76,62,75,89,63,73];
const LIVE_COSTS_X10 = [0,48,43,52,45,63,40,52,41,50,40,52,44,59,38,66,38,60,40,0,50,59,40,83,43,51,47,48,42,53,44,55,42,49,38,47,41,51,43,0,51,53,37,45,61,43,50,40,63,45,56,45,54,40,49,37,42,53,42,49,38,54,41,56,40,50,40,0,49,43,53,39,51,39,63,39,60,51,0,64,0,53,44,53,44,65,41,60,40,51,39,0,51,55,41,64,42,44,57,46,66,45,65,44,52,46,69,44,64,45,54,43,53,45,55,42,61,44,51,40,49,42,46,0,62,0,41,61,43,49,41,50,39,49,38,45,41,61,40,59,38,48,39,0,52,43,48,0,60,41,56,40,54,37,49,36,46,40,59,42,0,50,48,51,0,43,48,41,59,43,56,39,45,37,0,57,0,47,42,49,38,55,39,48,37,49,42,50,43,50,41,47,39,53,40,47,43,0,51,59,56,0,42,46,40,47,37,48,43,47,40,48,38,48,38,55,0,49,39,42,50,40,49,38,60,39,50,40,46,38,59,41,60,38,50,40,0,51,0,51,42,50,47,53,42,63,45,53,42,61,40,48,42,0,54,0,54,43,53,42,50,39,48,41,55,39,49,43,47,40,61,42,48,41,60,40,53,41,50,38,71,40,57,39,53,39,49,40,50,46,50,44,53,43,61,41,49,39,49,51,0,52,43,46,42,48,41,51,41,50,44,50,44,50,39,52,42,0,64,52,37,40,47,39,57,42,60,40,77,41,0,51,41,50,44,47,39,55,39,65,40,53,38,0,47,58,39,46,53,40,67,42,51,41,54,0,52,44,40,55];

// ── ★v9.10 时代定谳语料(Trace-20261008T114436,用户机 dist-analyze)──
//  主循环链 rAF FunctionCall('loop')实拍,去双重记账后 2538 回调/21.6s;×10 定点还原
//  ms。会话本相=回调流 117.7/s 宽抖动(p5 4.9/p50 8.2/p95 14.2,max 31.7——超/欠速混合)。
//  v9.12 判别面语料:宽抖动流 rel std 0.374@120→0.310@60→0.166@30 → 降档轨迹 120→60→30。
const T114436_DELTAS_X10 = [
114,116,105,128,84,69,87,79,90,90,74,75,68,82,69,81,97,126,88,46,69,71,52,80,48,143,161,71,63,82,77,56,56,25,109,93,49,48,134,87,100,97,77,65,61,76,58,55,95,107,88,61,83,104,134,85,81,102,128,114,71,59,84,86,82,58,10,79,108,84,55,24,163,86,56,110,87,89,49,50,79,8,116,161,116,90,92,80,68,69,92,108,74,84,57,88,105,128,94,79,61,67,127,82,57,125,84,58,99,112,86,90,106,62,114,77,136,92,61,68,84,56,14,68,65,160,80,59,109,108,82,74,93,88,95,103,81,79,63,78,110,102,126,87,64,70,53,54,76,148,80,85,137,70,63,87,124,74,56,68,59,16,75,56,47,71,116,130,122,143,110,100,67,68,85,107,87,129,96,86,73,73,100,78,79,61,80,56,52,69,84,76,55,53,71,66,69,129,80,109,79,60,163,66,68,68,51,67,66,41,52,68,74,50,87,56,159,90,78,62,63,61,15,74,9,55,78,160,79,85,58,49,68,75,59,65,71,83,56,92,86,78,88,93,71,74,86,147,84,158,87,75,87,110,133,85,83,82,54,83,82,59,81,70,20,154,138,92,84,85,112,102,107,53,67,138,99,86,52,130,81,170,53,63,121,86,139,84,98,53,66,58,49,76,79,49,78,45,90,91,85,104,71,68,83,62,63,78,114,86,84,78,90,96,102,57,75,60,67,136,104,144,113,129,105,137,90,73,47,62,69,72,85,104,85,118,86,56,67,32,82,109,87,132,74,56,12,79,54,50,54,86,81,76,82,59,58,69,96,106,126,73,93,89,70,72,101,130,86,79,50,137,67,48,87,74,75,23,51,70,143,93,121,92,79,52,64,73,56,54,84,64,50,51,75,85,53,66,53,85,223,93,74,75,94,70,84,72,138,93,56,86,99,133,90,142,91,54,75,81,81,59,61,160,152,82,71,81,97,107,129,75,139,86,137,92,126,90,108,74,82,84,108,95,63,57,110,135,125,80,66,74,62,65,67,81,82,147,75,66,60,52,57,89,76,57,82,130,98,125,85,60,120,81,117,72,75,91,101,80,61,96,87,142,69,80,75,139,84,111,103,83,67,77,83,122,100,85,54,89,59,49,14,61,146,147,124,107,70,72,102,85,97,83,64,114,99,70,57,71,57,75,65,58,73,91,83,74,84,55,55,80,60,144,77,55,76,83,91,69,63,73,62,54,77,72,139,170,95,57,52,76,51,73,68,59,88,61,69,89,78,141,96,88,65,120,82,71,72,88,75,52,82,55,46,76,73,76,26,83,78,64,90,66,31,68,65,83,77,86,84,85,85,96,64,81,89,69,67,91,73,63,67,84,67,39,76,80,99,110,84,103,218,85,114,73,59,62,79,88,148,85,124,78,67,72,59,70,74,66,152,79,120,51,97,81,151,73,131,90,61,113,79,85,53,64,13,68,65,36,93,73,89,82,105,83,91,73,63,78,170,89,68,52,81,49,97,86,134,84,113,101,108,64,50,53,69,24,87,65,82,70,51,81,78,55,88,56,91,69,158,82,116,96,58,52,73,55,63,56,91,73,81,78,95,82,56,91,135,83,59,67,95,25,61,69,163,93,120,91,74,88,79,84,81,75,75,106,91,100,78,70,80,126,87,149,84,141,91,140,129,127,113,84,55,70,83,80,80,98,99,72,50,56,63,99,92,105,79,115,65,73,82,79,53,89,76,79,85,110,89,131,56,78,80,84,92,139,65,59,89,80,88,126,83,162,88,82,50,53,27,86,134,85,148,90,64,67,56,55,157,90,128,81,153,90,65,59,87,54,51,90,56,66,91,56,51,69,150,86,70,118,74,69,78,136,84,143,139,97,95,69,48,24,78,65,50,22,72,93,26,81,82,69,106,80,94,79,108,82,104,211,86,125,85,60,78,82,178,82,80,51,61,50,75,88,135,84,145,80,93,69,63,92,53,100,111,88,58,79,93,101,130,90,92,62,114,85,155,79,139,73,106,94,57,114,67,48,50,28,82,55,51,69,57,65,56,54,103,89,73,115,80,151,89,151,83,97,91,118,71,49,81,50,65,62,145,79,73,84,137,93,93,67,46,144,133,74,53,64,69,80,94,37,85,93,89,59,95,75,149,82,108,85,119,80,69,88,108,83,70,52,55,67,60,54,68,97,93,93,82,82,85,85,90,76,83,77,93,59,67,84,104,76,69,14,71,67,45,62,73,59,61,68,85,127,93,96,136,91,73,64,128,84,116,67,138,79,54,78,108,90,127,105,147,100,55,69,54,60,80,71,70,85,75,77,77,86,23,142,70,45,57,62,45,72,74,58,65,75,52,63,93,63,65,52,163,83,117,67,50,48,80,70,61,68,71,68,77,76,72,61,86,51,66,77,105,103,147,86,73,87,119,79,63,86,151,82,66,93,73,78,64,48,129,85,111,66,54,145,73,65,68,63,79,72,46,134,89,94,123,91,87,61,79,133,154,78,55,80,59,106,131,112,116,64,83,61,97,98,70,62,49,64,75,90,77,53,9,64,59,69,53,121,140,64,74,84,122,106,133,105,49,61,63,68,64,90,82,106,101,81,85,93,86,51,85,74,80,136,83,102,97,127,88,131,84,139,85,139,77,122,90,127,84,60,59,75,56,71,96,65,51,49,90,88,67,76,89,95,82,90,82,79,91,61,88,92,58,55,80,105,117,113,72,66,72,53,83,92,128,49,99,84,135,81,115,94,86,104,104,128,83,101,133,83,98,67,80,91,107,92,70,87,75,64,79,83,84,72,92,140,87,100,115,67,68,63,63,22,151,137,82,88,98,87,74,53,93,83,124,88,49,83,70,55,26,92,53,94,77,76,88,69,65,85,81,75,96,53,60,79,100,67,74,64,72,87,60,79,62,67,92,78,63,143,82,77,53,82,76,19,142,149,89,66,47,71,93,88,96,79,104,90,85,107,92,99,95,97,80,100,94,108,137,75,157,63,43,82,57,97,75,111,57,76,71,69,76,73,70,94,66,83,77,57,73,100,106,108,90,99,126,85,54,96,87,63,89,77,139,91,50,81,82,81,50,92,90,125,49,97,90,133,84,151,82,67,74,126,88,145,83,121,65,114,62,51,48,46,74,121,117,79,57,90,86,90,48,18,120,49,114,46,103,79,152,67,57,72,68,19,145,87,77,52,81,118,169,65,82,70,72,168,86,100,65,78,91,130,77,108,86,53,162,87,95,83,138,68,49,72,81,61,81,62,50,50,56,67,93,68,70,78,34,62,80,156,80,84,128,87,50,77,74,112,121,110,122,106,71,57,123,78,51,48,74,44,99,82,74,66,92,146,85,114,69,123,67,129,85,72,79,119,88,127,97,132,111,121,71,61,23,90,128,86,140,70,71,78,49,61,75,45,76,59,79,71,149,93,133,81,120,69,72,84,109,94,127,77,77,92,70,48,55,68,88,51,104,146,71,67,90,78,151,91,91,136,81,124,52,168,74,165,88,148,94,99,81,70,75,90,111,51,114,50,60,85,52,28,134,168,135,113,116,88,90,68,54,68,15,83,128,71,141,73,48,46,14,62,26,72,64,80,51,61,291,89,83,63,102,71,44,60,63,113,88,121,93,95,92,75,66,75,101,81,53,59,70,87,84,63,38,65,87,50,99,85,133,87,140,79,86,128,52,90,90,135,86,89,55,80,84,165,87,56,75,116,69,69,80,157,85,106,82,90,55,50,11,106,69,105,88,93,73,49,53,74,62,82,139,91,171,97,114,124,69,44,49,71,77,46,69,81,91,72,84,91,74,92,144,82,61,99,96,69,47,68,64,88,91,66,82,82,69,58,98,91,84,68,65,85,92,113,128,87,75,71,123,82,63,72,93,111,76,99,88,51,58,73,58,75,62,79,56,77,90,41,116,97,75,62,64,91,97,84,142,87,86,56,44,60,115,89,70,46,51,58,19,78,61,90,106,119,89,66,82,97,73,75,77,72,71,92,71,165,82,117,94,92,140,78,119,114,90,77,135,103,81,102,111,82,88,73,115,65,60,124,91,101,138,82,151,88,112,96,78,51,61,53,61,80,154,83,50,48,64,83,52,62,51,51,72,72,76,64,93,73,91,70,86,85,72,146,79,95,88,111,96,128,48,58,128,88,132,82,112,59,89,90,103,52,108,101,66,70,86,57,86,91,65,47,141,124,158,70,76,63,74,83,138,82,105,88,90,114,93,130,67,51,84,55,71,53,86,87,65,77,90,63,125,129,66,50,45,80,44,84,149,84,106,65,61,69,49,48,73,164,78,120,64,63,83,65,28,54,102,84,103,56,99,89,152,73,109,95,88,65,55,129,129,84,117,119,84,59,88,51,73,45,50,63,55,138,151,68,52,87,86,62,45,64,74,59,69,65,65,69,68,68,162,86,150,91,99,109,97,117,77,53,46,53,94,126,85,152,79,105,84,48,88,90,65,50,73,64,68,65,165,78,70,93,113,66,79,74,91,69,52,26,88,56,65,91,131,79,123,73,113,67,67,86,128,80,91,90,133,88,155,90,103,67,54,152,107,114,116,99,88,50,132,80,103,83,128,66,79,84,131,85,65,74,78,104,63,67,48,95,87,63,83,116,94,62,75,133,71,94,56,72,87,183,63,54,53,51,120,82,51,105,85,103,146,101,72,68,89,114,89,94,86,71,100,90,68,74,68,104,93,142,92,142,87,68,67,20,74,65,52,83,54,62,71,78,153,82,86,90,94,99,59,59,71,23,58,174,88,144,74,67,75,84,86,49,85,87,82,52,73,50,49,65,84,67,30,55,65,79,71,63,85,72,73,228,79,91,86,120,83,122,85,73,156,69,76,124,101,65,72,77,90,317,166,91,127,99,65,55,121,101,70,51,124,104,94,134,123,103,87,71,74,56,79,55,109,88,87,72,67,73,86,22,70,149,88,149,92,138,84,154,83,82,48,86,51,126,88,50,43,65,90,125,90,80,80,64,42,51,75,92,62,46,56,58,180,64,105,60,72,47,73,134,143,49,65,85,69,65,83,79,80,141,87,148,86,65,60,84,67,98,69,49,81,93,74,60,47,60,60,28,139,158,72,82,55,82,85,76,14,48,66,170,120,130,79,91,51,60,54,90,98,129,78,82,81,102,84,142,82,123,83,69,85,140,78,60,79,79,45,54,55,91,45,70,148,143,113,99,96,67,72,136,83,150,91,132,86,129,88,107,67,55,69,76,22,111,176,113,104,113,120,96,119,120,104,93,58,95,81,98,85,131,82,76,49,94,83,136,55,80,86,67,50,52,62,151,132,128,91,111,77,99,109,107,86,95,99,103,118,101,65,85,70,92,117,85,64,45,149,59,80,84,73,95,114,90,105,100,121,66,58,79,86,75,93,65,55,75,106,78,87,83,80,84,83,93,84,66,77,82,67,80,81,60,84,57,77,131,83,146,80,136,82,156,83,102,94,139,62,67,64,44,82,83,87,113,124,87,64,78,125,95,137,66,45,64,30,48,59,64,93,210,91,92,48,50,63,75,70,57,54,61,70,114,52,45,44,90,52,71,55,72,145,94,135,81,99,137,80,162,85,110,92,48,81,78,58,88,81,105,110,46,49,140,75,107,64,75,88,43,124,92,116,91,116,86,60,46,73,7,93,91,109,125,88,130,116,64,66,99,136,85,69,92,83,72,75,91,120,78,74,77,160,83,140,85,118,83
];

// ── ★v9.12 变异体(红判别器)──
/** 摘累计器(v9.11 跟满形态机械复刻):shouldRender 恒真——红面=帧距=流本距(不钉档,
 *  读数随流漂移+双峰流帧距跳变)。 */
class FollowFullBeat extends FrameBeat {
  override shouldRender(_now: number): boolean { return true; }
}
/** 摘方差监控:varianceMonitorEnabled 钩覆写=false——红面=宽抖动流上 120 档抖动持续
 *  不降档(头注 v9.12 变异证红面①)。 */
class NoVarMonitorBeat extends FrameBeat {
  protected override varianceMonitorEnabled(): boolean { return false; }
}

/** 语料回放驱动器(渲染成本=轻载 3ms 会话本相;cap=120) */
const replayCorpus = (make: () => FrameBeat, deltas: number[], costs?: number[]) => {
  const beat = make();
  const cbs: number[] = [];
  const rendered: number[] = [];
  let t = 0;
  for (let i = 0; i < deltas.length; i++) {
    t += deltas[i];
    beat.observeVsync(t, 120);
    cbs.push(t);
    if (beat.shouldRender(t)) {
      beat.beginRender(t);
      rendered.push(t);
      beat.endRender(t + (costs ? costs[i] : 3));
    }
  }
  return { beat, cbs, rendered };
};

/** 暂停+云尖峰流驱动器(CLOUD 4.5/9.0 宽分布;恢复段 7.9;可选 hold) */
const drivePauseCloud = (make: () => FrameBeat, withHold: boolean) => {
  const beat = make();
  const ks: number[] = [];
  const tiers: number[] = [];
  const reasons: string[] = [];
  const pauseGaps: number[] = [];
  const gaps: number[] = [];
  let t = 0;
  let last = -1;
  for (let i = 0; i < 1100; i++) {
    const paused = i >= 200 && i < 800;
    if (withHold) beat.hold(paused);
    t += paused ? (i % 2 === 0 ? 4.5 : 9.0) : 7.9;
    beat.observeVsync(t, 120);
    if (beat.shouldRender(t)) {
      beat.beginRender(t);
      if (last >= 0) {
        gaps.push(t - last);
        if (paused) pauseGaps.push(t - last);
      }
      last = t;
      beat.endRender(t + 3.5);
      ks.push(beat.k);
      tiers.push(beat.snapshot().tier);
      reasons.push(beat.lastReason);
    }
  }
  return { beat, ks, tiers, reasons, gaps, pauseGaps };
};

// ═══════════════════════════════════════════════════════════════════════
describe('★v9.12 锁帧档累计器锁(各档周期/跟满档/render-bound)', () => {
  it('各档周期正确性:窄峰流(120Hz±10%)cap120/60/30 锁定——平均帧距=档周期(读数钉死),std<1.5,零降档', () => {
    for (const cap of [120, 60, 30]) {
      const { beat, rendered } = runBeat({ vsync: HZ120, cap, cost: 4, callbacks: 2400, jitter: 0.1 });
      const st = gapStats(rendered.slice(-1200));             // 稳态尾段(开场瞬态不计)
      const period = 1000 / cap;
      expect(beat.snapshot().tier).toBe(cap);
      expect(beat.lastReason).toBe('init');                   // 窄峰流:方差面不降档
      expect(st.mean).toBeGreaterThan(period - 0.35);         // 平均帧距=档周期(精确钉)
      expect(st.mean).toBeLessThan(period + 0.35);
      expect(st.p50).toBeGreaterThan(period - 0.7);
      expect(st.p50).toBeLessThan(period + 0.7);
      expect(st.std).toBeLessThan(3.0);                       // 标定:60 档 1.98/30 档 2.4-2.6(流 ±10% 抖动经 sums 放大)
      const fps = 1000 / st.mean;
      expect(fps).toBeGreaterThan(cap * 0.965);               // 读数钉在档值
      expect(fps).toBeLessThan(cap * 1.035);
    }
  });

  it('用户手选 90 档@120Hz 网格:11.1=1.33×8.33 物理性抖动(rel≈0.54)→ 方差监控降档自愈到 60 驻留', () => {
    const { beat, rendered } = runBeat({ vsync: HZ120, cap: 90, cost: 4, callbacks: 2400, jitter: 0.1 });
    expect(beat.snapshot().tier).toBe(60);                    // 90 判不稳 → 降一档落 60
    expect(beat.lastReason).toBe('capacity');
    const st = gapStats(rendered.slice(-1000));               // 60 档稳态(避开降档前 90 档段)
    expect(st.mean).toBeGreaterThan(16.3);
    expect(st.mean).toBeLessThan(17.1);
    expect(st.std).toBeLessThan(2.5);
  });

  it('cap=0 跟满档(v9.11 语义保留):恒渲逐位(rendered≡回调序列),帧距=流本距', () => {
    const { beat, rendered, cbs } = runBeat({ vsync: HZ120, cap: 0, cost: 4, callbacks: 2400, jitter: 0.1 });
    expect(rendered).toEqual(cbs);                            // 跟满:零 skip
    expect(beat.snapshot().tier).toBe(0);
    expect(beat.k).toBe(1);
    const st = gapStats(rendered.slice(40));
    expect(st.p50).toBeGreaterThan(HZ120 - 0.5);
    expect(st.p50).toBeLessThan(HZ120 + 0.5);
  });

  it('render-bound 帧距=帧耗:cap120 帧耗 25ms(>档周期,慢流重锚不追讨)→ 逐回调全渲,帧距恒 25 零跳变', () => {
    const rb = runBeat({ vsync: HZ120, cap: 120, cost: 25, callbacks: 1200 });
    expect(rb.rendered).toEqual(rb.cbs);                      // 慢流:累计器退化为逐回调渲
    expect(rb.beat.snapshot().tier).toBe(120);
    expect(rb.beat.lastReason).toBe('init');                  // 帧距 std=0:方差面不降档
    const st = gapStats(rb.rendered.slice(40));
    expect(st.p50).toBeGreaterThan(24);
    expect(st.p50).toBeLessThan(26);
    expect(st.jumps).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('★v9.12 双峰流/真实语料判别面(读数钉死+方差自适应降档)', () => {
  it('合成双峰流(4-6/8-9,~131/s)cap120:锁 120 比跟满更抖(rel 0.233>0.22)→ 降档轨迹 [120,90,60],落 60 驻留(读数钉 60.0,rel 反超跟满 0.204=真收益)', () => {
    const deltas = makeBimodal(4800, 11);
    const r = driveDeltas(deltas, 120);
    const ch = tierChanges(r.tiers);
    expect(ch.map((c) => c.tier)).toEqual([120, 90, 60]);     // 锁 120 判不稳(机理:ε-walk 锯齿 {4,12} 追赶对)
    expect(ch.slice(1).every((c) => c.reason === 'capacity')).toBe(true);
    expect(r.beat.snapshot().tier).toBe(60);
    const tail = r.gaps.slice(-1200);                         // 60 档驻留段
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(mean).toBeGreaterThan(16.3);                       // 平均帧距=16.67 精确(读数钉 60)
    expect(mean).toBeLessThan(17.1);
    const ws = winStds(tail);
    expect(Math.max(...ws) / (1000 / 60)).toBeLessThan(0.22); // rel max 0.198:60 档驻留带内
    const fps = fpsSeries(r.rendered.slice(-1200));
    expect(q(fps, 0.5)).toBeGreaterThan(58);                  // 读数钉 60
    expect(q(fps, 0.5)).toBeLessThan(62);
  });

  it('红对照(同流摘累计器 FollowFullBeat):读数=流原生率 131(不钉档)、帧距=流本距 [4,9]', () => {
    const deltas = makeBimodal(4800, 11);
    const red = driveDeltas(deltas, 120, { make: () => new FollowFullBeat() });
    expect(red.rendered).toEqual(red.cbs);                    // 恒渲本相
    const st = gapStats(red.rendered);
    expect(Math.min(...st.gaps)).toBeLessThan(5);             // 流双峰下尾
    expect(Math.max(...st.gaps)).toBeGreaterThan(8.9);        // 流双峰上尾
    expect(st.jumps).toBeGreaterThan(100);                    // 短长交替跳变丛生
    const fps = fpsSeries(red.rendered);
    expect(q(fps, 0.5)).toBeGreaterThan(128);                 // 读数=流原生率 ~131(非任何档值)
    expect(q(fps, 0.5)).toBeLessThan(134);
  });

  it('漂移率流分段收敛:6ms(166/s)段驻留 90(rel 0.19)→7.5ms(133/s)段降档落 60——各段读数钉各自档值(跟满=随流漂 133↔166)', () => {
    const deltas = [...Array.from({ length: 2400 }, () => 6.0), ...Array.from({ length: 2400 }, () => 7.5)];
    const green = driveDeltas(deltas, 120);
    const ch = tierChanges(green.tiers);
    expect(ch.map((c) => c.tier)).toEqual([120, 90, 60]);     // 6ms 段驻留 90;7.5ms 段判不稳降 60
    expect(green.beat.snapshot().tier).toBe(60);
    const seg1 = green.gaps.slice(300, 1100);                 // 90 档驻留段
    const m1 = seg1.reduce((a, b) => a + b, 0) / seg1.length;
    expect(m1).toBeGreaterThan(10.8);                         // 平均帧距=11.11(读数钉 90)
    expect(m1).toBeLessThan(11.5);
    const seg2 = green.gaps.slice(-500);                      // 60 档驻留段
    const m2 = seg2.reduce((a, b) => a + b, 0) / seg2.length;
    expect(m2).toBeGreaterThan(16.2);                         // 平均帧距=16.67(读数钉 60)
    expect(m2).toBeLessThan(17.2);
    const red = driveDeltas(deltas, 120, { make: () => new FollowFullBeat() });
    const redHalf = Math.floor(red.gaps.length / 2);
    const r1 = red.gaps.slice(0, redHalf).reduce((a, b) => a + b, 0) / redHalf;
    const r2 = red.gaps.slice(redHalf).reduce((a, b) => a + b, 0) / (red.gaps.length - redHalf);
    expect(r1).toBeLessThan(6.5);                             // 红:读数随流(段均值=流间隔 6.0)
    expect(r2).toBeGreaterThan(7.0);                          // 红:段 2 均值=7.5(漂移面)
  });

  it('真实语料 T114436(117.7/s 宽抖动)cap120:rel 0.374@120→0.349@90→0.310@60 → 降档轨迹 [120,90,60] 落底驻留(★v9.13 30 档已除)', () => {
    const corpus = T114436_DELTAS_X10.map((v) => v / 10);
    const r = driveDeltas([...corpus, ...corpus], 120);       // ×2:60 档驻留段足够长
    const ch = tierChanges(r.tiers);
    expect(ch.map((c) => c.tier)).toEqual([120, 90, 60]);     // 逐级降档,60 底(30 档已除)
    expect(ch.slice(1).every((c) => c.reason === 'capacity')).toBe(true);
    expect(r.beat.snapshot().tier).toBe(60);
    const tail = r.gaps.slice(-600);                          // 60 档驻留段
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(mean).toBeGreaterThan(16.0);                       // 平均帧距=16.7(读数钉 60)
    expect(mean).toBeLessThan(17.4);
    const ws = winStds(tail);
    expect(Math.max(...ws) / (1000 / 60)).toBeLessThan(0.4);  // rel(标定 0.31-0.36:粗糙但驻留)
  });

  it('升档慢速回探(最高优先):T114436 落 60 后转洁净网格 → 6 窗后一步回探 120 成功,尾段帧距恒 8.33', () => {
    const deltas = [...T114436_DELTAS_X10.map((v) => v / 10), ...Array.from({ length: 5000 }, () => HZ120)];
    const r = driveDeltas(deltas, 120);
    const ch = tierChanges(r.tiers);
    expect(ch.map((c) => c.tier)).toEqual([120, 90, 60, 120]);  // 爬档一步到顶(无 90 中间驻留;30 档已除)
    expect(ch[3].reason).toBe('upgrade');
    expect(r.beat.snapshot().tier).toBe(120);
    const st = gapStats(r.rendered.slice(-600));              // 爬满后洁净网格稳态
    expect(st.std).toBeLessThan(0.5);
    for (const g of st.gaps) expect(g).toBeGreaterThan(8.0);
    for (const g of st.gaps) expect(g).toBeLessThan(8.7);
  });

  it('LIVE 语料(≈126/s 用户机稳态切片)cap120:驻留不降档(窗序列无两连超 0.22)、读数钉 ~120、帧距 std<2.2', () => {
    const r = replayCorpus(() => new FrameBeat(), LIVE_DELTAS_X10.map((v) => v / 10), LIVE_COSTS_X10.map((v) => v / 10));
    expect(r.beat.snapshot().tier).toBe(120);
    expect(r.beat.lastReason).toBe('init');
    const st = gapStats(r.rendered.slice(20));
    expect(st.std).toBeLessThan(2.2);                         // 标定 1.76
    const fps = fpsSeries(r.rendered);
    expect(q(fps, 0.5)).toBeGreaterThan(117);
    expect(q(fps, 0.5)).toBeLessThan(123);
  });
});

describe('★v9.12 hold 冻结+瞬态豁免+cap 变更重锚', () => {
  it('暂停+云尖峰(hold 双臂):hold 期档位迁移全冻结(零降档);无 hold 同流降档爆发=hold 承重', () => {
    for (const withHold of [true, false] as const) {
      const r = drivePauseCloud(() => new FrameBeat(), withHold);
      if (withHold) {
        expect(r.tiers.every((t) => t === 120)).toBe(true);   // 暂停期云流形态不驱动降档
        expect(r.reasons.every((r0) => r0 === 'init')).toBe(true);
      } else {
        expect(r.reasons).toContain('capacity');              // 无 hold:方差面把暂停流判不稳
      }
      expect(r.ks.every((k) => k === 1)).toBe(true);          // k 史档字段恒 1
    }
  });

  it('hold 期渲染照常+方差证据清零:暂停段帧距=累计器在云流上的本相 {4.5,9,13.5},恢复段=7.9 流上的钉 120 相位 {7.9,15.8}', () => {
    const { pauseGaps, gaps } = drivePauseCloud(() => new FrameBeat(), true);
    expect(gapSet(pauseGaps)).toEqual(new Set([4.5, 9, 13.5]));
    const tail = gaps.slice(-250);
    expect(gapSet(tail)).toEqual(new Set([7.9, 15.8]));       // 恢复段:7.9<8.33 累计器限速,均值钉 8.33
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    expect(mean).toBeGreaterThan(8.0);                        // 平均帧距=档周期(读数钉 120)
    expect(mean).toBeLessThan(8.7);
  });

  it('瞬态豁免(连续 2 窗门):孤立单帧 30ms stall 各一次(相距 >1 窗)→ 窗 std 单发超阈、计程被清,零降档', () => {
    const beat = new FrameBeat();
    let grid = 0;
    let busy = 0;
    let prevT = -1;
    const rendered: number[] = [];
    for (let i = 0; i < 1200; i++) {
      while (grid <= prevT) grid += HZ120;
      let t = Math.max(grid, busy);
      if (i === 300 || i === 800) t += 30;                    // 合成器侧单帧停滞
      prevT = t;
      beat.observeVsync(t, 120);
      if (beat.shouldRender(t)) {
        beat.beginRender(t);
        rendered.push(t);
        busy = t + 5;
        beat.endRender(t + 5);
      }
    }
    expect(beat.snapshot().tier).toBe(120);                   // 瞬态 stall 不降档
    expect(beat.lastReason).toBe('init');
    expect(rendered.length).toBe(1200);                       // 停滞帧照录,恢复首回调即渲
  });

  it('cap 变更即时重锚:120→60 档位即回用户档+方差证据清零;→0 切跟满档恒渲', () => {
    const beat = new FrameBeat();
    let t = 0;
    const cbs: number[] = [];
    const rendered: number[] = [];
    for (let i = 0; i < 900; i++) {
      const cap = i < 300 ? 120 : i < 600 ? 60 : 0;
      t += HZ120;
      beat.observeVsync(t, cap);
      cbs.push(t);
      if (beat.shouldRender(t)) {
        beat.beginRender(t);
        rendered.push(t);
        beat.endRender(t + 4);
      }
      if (i === 300) expect(beat.snapshot().tier).toBe(60);   // 用户档即时生效
      if (i === 600) expect(beat.snapshot().tier).toBe(0);
    }
    expect(beat.snapshot().tier).toBe(0);
    expect(rendered.length).toBe(750);                        // 120 段 300+60 档段 ~150(隔 cb 渲)+跟满段 300
    for (const t0 of rendered) expect(cbs.includes(t0)).toBe(true);  // 渲染点⊂回调点(锁档 skip 合法)
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('★v9.12 变异证红:摘方差监控/摘累计器 → 判别面红;现役同流绿', () => {
  it('红(摘方差监控 NoVarMonitorBeat,T114436):120 档抖动持续(rel std 稳超 0.22)零降档;绿:同流降档轨迹 [120,90,60]', () => {
    const corpus = T114436_DELTAS_X10.map((v) => v / 10);
    const deltas = [...corpus, ...corpus];
    const red = driveDeltas(deltas, 120, { make: () => new NoVarMonitorBeat() });
    const green = driveDeltas(deltas, 120);
    expect(red.beat.snapshot().tier).toBe(120);               // 红:永不降档
    expect(tierChanges(red.tiers).length).toBe(1);
    const redWs = winStds(red.gaps.slice(-1200));
    expect(q(redWs, 0.5) / (1000 / 120)).toBeGreaterThan(VAR_STD_RATIO);       // 红:抖动占比稳超降档线
    expect(red.tiers.every((x) => x.tier === 120)).toBe(true);                 // 红:全程 120 不降
    expect(green.beat.snapshot().tier).toBe(60);              // 绿:降档落底(★v9.13 底档=60)
    const greenWs = winStds(green.gaps.slice(-600));
    expect(Math.max(...greenWs) / (1000 / 60)).toBeLessThan(0.4);              // 绿:落底驻留(标定 0.31-0.36)
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('★v9.12 退役态锁(k 恒 1/史档判据闸/hold 兼容/不追赶)', () => {
  it('k 恒 1 跨流族(轻载/render-bound/收紧/暂停云流 hold)且 lastReason 恒 init——拍字段冻结为退役态', () => {
    const streams: FrameBeat[] = [];
    streams.push(runBeat({ vsync: HZ120, cap: 120, cost: 4, callbacks: 600 }).beat);
    streams.push(runBeat({ vsync: HZ120, cap: 120, cost: 25, callbacks: 600 }).beat);
    streams.push(runBeat({ vsync: HZ120, cap: 60, cost: 5, callbacks: 600 }).beat);
    const { beat } = drivePauseCloud(() => new FrameBeat(), true);
    streams.push(beat);
    for (const b of streams) {
      expect(b.k).toBe(1);
      expect(b.lastReason).toBe('init');
    }
  });

  it('hold 兼容保留(v9.7 语义):暂停期渲染照常、观测面不冻(est 照常采样)、snapshot.hold 诊断面、方差面冻结', () => {
    const beat = new FrameBeat();
    const snap0 = beat.snapshot();
    expect(snap0.hold).toBe(false);
    expect(snap0.tier).toBe(0);
    let t = 0;
    let pauseRenders = 0;
    const estBefore: number[] = [];
    for (let i = 0; i < 700; i++) {
      const paused = i >= 100;
      beat.hold(paused);
      t += paused ? (i % 2 === 0 ? 4.5 : 9.0) : HZ120;
      beat.observeVsync(t, 60);
      if (paused) estBefore.push(beat.vsyncPeriod);
      if (beat.shouldRender(t)) {
        beat.beginRender(t);
        beat.endRender(t + 3);
        if (paused) pauseRenders++;
      }
    }
    expect(pauseRenders).toBeGreaterThan(200);      // 暂停期渲染照常(hold 不冻结渲染;60 档累计器限速)
    expect(beat.snapshot().hold).toBe(true);
    expect(beat.snapshot().tier).toBe(60);          // 档位冻结(迁移面停)
    expect(beat.lastReason).toBe('init');
    expect(estBefore[estBefore.length - 1]).toBeLessThan(7.5);  // 观测面不冻:est 跟随暂停期云形态
  });

  it('失拍吸附语义保留(恒渲天然不追赶中途;cap=0 跟满档):合成器停滞 30ms 后首回调即渲,无解堵连发', () => {
    const beat = new FrameBeat();
    let grid = 0;
    let busy = 0;
    let prevT = -1;
    const rendered: number[] = [];
    for (let i = 0; i < 600; i++) {
      while (grid <= prevT) grid += HZ120;
      let t = Math.max(grid, busy);
      if (i === 300) t += 30;                  // 合成器侧停滞 30ms(回调断流一次)
      prevT = t;
      beat.observeVsync(t, 0);                 // cap=0:逐回调全渲口径
      if (beat.shouldRender(t)) {
        beat.beginRender(t);
        rendered.push(t);
        busy = t + 5;
        beat.endRender(t + 5);
      }
    }
    expect(rendered.length).toBe(600);          // 停滞帧照录,恢复首回调即渲(无 skip 无连发)
    const gaps = rendered.slice(1).map((r, i) => r - rendered[i]);
    const missIdx = gaps.findIndex((g) => g > 25);
    expect(missIdx).toBeGreaterThan(0);         // 停滞帧距被如实记录
    expect(gaps[missIdx + 1]).toBeLessThan(HZ120 + 4);  // 下一帧距即回正常(不追赶补渲)
  });

  it('成本诊断面保留:costP50/costP95 照常采样(F5/snapshot 消费,不驱动决策);snapshot.tier 面', () => {
    const beat = new FrameBeat();
    beat.observeVsync(0, 0);
    for (let i = 0; i < 60; i++) {
      const t = i * HZ120;
      beat.observeVsync(t, 0);
      beat.beginRender(t);
      beat.endRender(t + (i % 10 === 9 ? 12 : 4));    // 10% 尖峰
    }
    expect(beat.costP50()).toBe(4);
    expect(beat.costP95()).toBe(12);
    const snap = beat.snapshot();
    expect(snap.p50).toBe(4);
    expect(snap.p95).toBe(12);
    expect(snap.reason).toBe('init');
    expect(snap.tier).toBe(0);
  });
});

/** 估计器红判别器旧侧(截尾均值;现役本体即此——诊断面逐位一致锁的参照) */
class LegacyEstBeat extends FrameBeat {
  protected override estimateVsync(): number {
    return this.legacyEstimate();
  }
}

// ═══════════════════════════════════════════════════════════════════════
describe('★估计器诊断面锁(v9.5 清退态原样保留;est 只喂 F5/snapshot 与可达性过滤,不进累计器相位)', () => {
  /** 估计器驱动器:delta 流喂引擎,逐回调记录 vsyncPeriod(拍状态机不动,纯估计面) */
  const replayEstimate = (make: () => FrameBeat, deltas: number[], costs?: number[]) => {
    const beat = make();
    const est: number[] = [];
    let t = 0;
    deltas.forEach((d, i) => {
      t += d;
      beat.observeVsync(t, 120);
      if (costs) {
        beat.beginRender(t);
        beat.endRender(t + costs[i]);
      }
      est.push(beat.vsyncPeriod);
    });
    return est;
  };
  const TRACE_DELTAS = DELTAS_X10.map((v) => v / 10);   // ×10 定点还原 ms

  it('★估计器与截尾均值逐位一致(回声真实流带成本/健康流/杀手流三流;任何估计器结构变更须新证据另立项)', () => {
    const traceCosts = COSTS_X10.map((v) => v / 10);
    const lcg = lcgOf(21);
    const healthy = Array.from({ length: 2000 }, () => (lcg() < 0.052 ? 7.2 + lcg() * 0.75 : 7.93 + lcg() * 0.14));
    const killer = Array.from({ length: 2000 }, (_, i) => (i % 2 === 0 ? 20 : 13.3));
    const streams: { deltas: number[]; costs?: number[] }[] = [
      { deltas: TRACE_DELTAS, costs: traceCosts }, { deltas: healthy }, { deltas: killer },
    ];
    for (const { deltas, costs } of streams) {
      const est = replayEstimate(() => new FrameBeat(), deltas, costs);
      const ref = replayEstimate(() => new LegacyEstBeat(), deltas, costs);
      expect(est).toEqual(ref);                // 逐位一致(估计器=v9.5 清退态,诊断面)
    }
  });

  it('★截尾均值处方直锁(双峰恢复真值/小窗安全)', () => {
    expect(trimmedMeanVsync([])).toBe(GRID_MS);                       // 空窗=GRID 先验
    expect(trimmedMeanVsync([8.33, 8.33, 8.33])).toBeCloseTo(8.33, 2);
    // 双峰 20/13.3 交替(真 16.67):截尾均值恢复真值,中位数制会按窗奇偶翻转
    const bimodal = Array.from({ length: 31 }, (_, i) => (i % 2 === 0 ? 20 : 13.3));
    expect(trimmedMeanVsync(bimodal)).toBeGreaterThan(15);
  });

  it('★金标健康流(机器时间戳语义 7.93±0.07 + 5.2% 余数 7.2-7.95):截尾均值保持机器语义读数(不被名义 8.33 拉高)', () => {
    const lcg = lcgOf(21);
    const healthy = Array.from({ length: 2000 }, () => (lcg() < 0.052 ? 7.2 + lcg() * 0.75 : 7.93 + lcg() * 0.14));
    const est = replayEstimate(() => new FrameBeat(), healthy);
    expect(q(est.slice(-400), 0.5)).toBeLessThan(8.1);
  });

  it('★v1 杀手流(60Hz 双峰 20/13.3 交替,真 16.67):截尾均值对双峰恢复真值——地板级联不复发', () => {
    const killer = Array.from({ length: 2000 }, (_, i) => (i % 2 === 0 ? 20 : 13.3));
    const est = replayEstimate(() => new FrameBeat(), killer);
    expect(q(est.slice(-400), 0.5)).toBeGreaterThan(15);
  });

  it('★估计式不变性(洁净流):锁定 120Hz 网格=精确 8.33;全 2×vsync 并调流=16.67', () => {
    const locked = Array.from({ length: 600 }, () => HZ120);
    const estLocked = replayEstimate(() => new FrameBeat(), locked);
    expect(estLocked[estLocked.length - 1]).toBeCloseTo(HZ120, 2);
    const merged = Array.from({ length: 600 }, () => 2 * HZ120);
    const estMerged = replayEstimate(() => new FrameBeat(), merged);
    expect(estMerged[estMerged.length - 1]).toBeCloseTo(2 * HZ120, 2);
  });

  it('★切屏恢复(120→60):截尾均值随流重建,200 回调内估计回到 60Hz 带(≥15)', () => {
    const stream = [...Array.from({ length: 600 }, () => HZ120), ...Array.from({ length: 300 }, () => HZ60)];
    const est = replayEstimate(() => new FrameBeat(), stream);
    expect(est[799]).toBeGreaterThanOrEqual(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('锁帧档语义锁(源锚)', () => {
  it('Game.start():beat 调用面接线(observeVsync/shouldRender/beginRender/endRender/hold);v9.12 分支语义(cap=锁帧档)', () => {
    expect(GAME).toContain("import { FrameBeat, frameCapUrl } from './FrameBeat';");   // ★?framecap=N URL 覆写口(2026-10-27)
    expect(GAME).toContain('this.beat.hold(this.paused || this._entryFreeze != null || this._tpVeil)');
    expect(GAME).toContain('this.beat.observeVsync(now, frameCapUrl ?? options.data.frameCap)');
    expect(GAME).toContain('if (!this.beat.shouldRender(now))');
    expect(GAME).toContain('this.beat.beginRender(now)');
    expect(GAME).toContain('this.beat.endRender(performance.now())');
    expect(GAME).not.toContain("if (mode === 'subtle') this.beat.endRender");
    // ★v9.12:三档节拍分支合并(渲染面统一走 beat 门)+旧被动门退役
    expect(GAME).not.toContain("const mode = options.data.frameCap");
    expect(GAME).not.toContain('1000 / cap - 1');
    expect(GAME).toContain('锁帧档调度引擎');
    expect(GAME).toContain('cap=锁帧档选择');
    expect(GAME).toContain('62624');   // 原版锚注释:EndDraw 忙等 present 网格
  });

  it('Game.start():shouldRender 门先于 _paintedFrames++(whenFirstPaint 只认真实渲染帧;锁档 skip 分支=现役面)', () => {
    const iSkip = GAME.indexOf('if (!this.beat.shouldRender(now))');
    const iPaint = GAME.indexOf('this._paintedFrames++');
    expect(iSkip).toBeGreaterThan(-1);
    expect(iPaint).toBeGreaterThan(-1);
    expect(iSkip).toBeLessThan(iPaint);
  });

  it('SuppressDraw 旧分支已退役(0 步进帧照画,与 improved-subtle 同相)', () => {
    expect(GAME).not.toMatch(/frameSkipMode === 'subtle' && steps === 0/);
    expect(GAME).toContain('62624');   // 注释锚:EndDraw 忙等 present 网格
  });

  it('FrameBeat.ts vanilla 锚齐备(1457 亲读行号)', () => {
    expect(BEAT).toContain('17129');   // 三态 IsFixedTimeStep
    expect(BEAT).toContain('17182');   // SuppressDraw 仅旧路径
    expect(BEAT).toContain('improvedSubtleFrameSkip');
    expect(BEAT).toContain('62624');   // EndDraw 忙等
    expect(BEAT).toContain('67615');   // 默认值
  });

  it('★网格地板已废除(targetMs 不再 max(GRID_MS,·);否决注在头注——防"忠实原版"回改)', () => {
    expect(BEAT).not.toContain('Math.max(GRID_MS');
    expect(BEAT).toContain('cap > 0 ? 1000 / cap : this.vsyncPeriod');
    expect(BEAT).toContain('网格地板否决注');
  });

  it('★v6 帧率优先政策废除锚(政策层由 v9.12 用户裁决推翻;判据组保留在迁移闸内=史档+红判别器复刻面)', () => {
    expect(BEAT).toContain('this.budget(this.k + 1) * DOWNGRADE_MARGIN');
    expect(BEAT).toContain('DOWNGRADE_MARGIN = 1.1');
    expect(BEAT).toContain('就此废除');                       // v9.12 头注:政策废除明示
    expect(BEAT).toContain('★v6 降档边界=帧率优先');
  });

  it('常数处方锁(v9.12 新族+迁移闸内史档族)', () => {
    expect(TIER_LADDER).toEqual([120, 90, 60]);               // ★v9.13:30 档已除(用户明令)
    expect(DUE_GUARD_MS).toBe(0.75);
    expect(VAR_WIN).toBe(60);
    expect(VAR_STD_RATIO).toBeCloseTo(0.22, 10);
    expect(VAR_UP_RATIO).toBe(0.5);
    expect(VAR_DOWN_WINDOWS).toBe(2);
    expect(VAR_UP_WINDOWS).toBe(6);
    // 史档族(迁移闸内,红判别器复刻面)
    expect(UPGRADE_WIN_SAMPLES).toBe(30);
    expect(UPGRADE_HOLD_WINDOWS).toBe(2);
    expect(UPGRADE_HEADROOM).toBe(0.9);
    expect(DOWNGRADE_MARGIN).toBe(1.1);
    expect(MISS_SLACK).toBe(0.7);
    expect(MISS_GRID_TOL_REL).toBe(0.2);
    expect(MISS_GRID_TOL_MS).toBe(2);
    expect(MISS_STREAK_DOWNGRADE).toBe(4);
    expect(MISS_STALL_BUDGET_MS).toBe(200);
    expect(FLOOR_HOLD_WINDOWS).toBe(2);
    expect(GRID_MS).toBeCloseTo(1000 / 60);
  });

  it('★v9.12 引擎源锚(防回改):shouldRender=累计器门+跟满档支;方差面/可达性钩在;migrationEnabled 闸=false 且判据组整段保留在闸内;resetSampling 档位回用户档;est=截尾均值诊断面', () => {
    const iShould = BEAT.indexOf('shouldRender(now: number): boolean');
    const iCapBreach = BEAT.indexOf('protected capacityBreach');
    expect(iShould).toBeGreaterThan(-1);
    expect(iCapBreach).toBeGreaterThan(iShould);
    const shouldSrc = BEAT.slice(iShould, iCapBreach);
    expect(shouldSrc).toContain('if (this.cap <= 0) return true;');       // 跟满档
    expect(shouldSrc).toContain('if (this.nextDue < 0) return true;');    // 未锚定
    expect(shouldSrc).toContain('now >= this.nextDue - DUE_GUARD_MS');    // 累计器门
    // 类体:方差面机制在位
    const cls = BEAT.slice(BEAT.indexOf('export class FrameBeat'));
    expect(cls).toContain('private nextDue = -1');
    expect(cls).toContain('private effTier = 0');
    expect(cls).toContain('private varWin: number[] = []');
    expect(cls).toContain('protected varianceMonitorEnabled(): boolean');
    expect(cls).toContain('private stepTier(): void');                      // ★v9.14 旗分世界调度
    expect(cls).toContain('private stepRealized(meanGap: number): void');   // 旗开=容量判据
    expect(cls).toContain('private stepVarianceCore(std: number): void');   // 旗关=方差判据
    expect(cls).toContain('this.nextDue = this.nextDue < 0 ? now + p : Math.max(this.nextDue + p, now);');
    expect(cls).toContain('const line = VAR_STD_RATIO * this.tierPeriod();');
    expect(cls).toContain('this.nextDue = this.lastRenderAt + this.tierPeriod();');   // 落地重锚
    expect(cls).toContain("TIER_LADDER.find((t) => t < this.effTier)");               // 降档:逐级无过滤
    expect(cls).toContain("this.effTier = cands[0];");                                 // 升档:最高优先回探
    // 退役闸本体=false;旧 k 迁移决策面整段保留在闸内(红判别器 OldMigrationBeat 复刻点)
    expect(BEAT).toContain('protected migrationEnabled(): boolean');
    expect(BEAT).toMatch(/migrationEnabled\(\): boolean \{\s*return false;/);
    const iGate = BEAT.indexOf('if (this.migrationEnabled()) {');
    expect(iGate).toBeGreaterThan(-1);
    expect(BEAT.slice(iGate)).toContain("this.lastReason = 'capacity'");
    expect(BEAT.slice(iGate)).toContain("this.lastReason = 'floor'");
    expect(BEAT.slice(iGate)).toContain("this.lastReason = 'upgrade'");
    expect(BEAT.slice(iGate)).toContain("this.lastReason = 'miss-streak'");
    expect(BEAT).toContain('this.budget(this.k + 1) * DOWNGRADE_MARGIN');
    expect(BEAT).toContain('this.costP50() < this.budget(this.k) * UPGRADE_HEADROOM');
    // resetSampling:k 恒 1+档位/方差证据复位
    expect(BEAT).toContain('this.k = 1;');
    expect(BEAT).toContain('this.effTier = this.cap;');
    expect(BEAT).toContain('this.nextDue = -1;');
    // 估计器=v9.5 清退态(截尾均值,诊断面)
    expect(BEAT).toContain('return this.legacyEstimate()');
    // hold 面冻结方差证据(暂停期云流不得污染档位证据)
    const iHold = BEAT.indexOf('if (this.holdOn) {');
    expect(iHold).toBeGreaterThan(-1);
    expect(BEAT.slice(iHold, iHold + 400)).toContain('this.varWin.length = 0;');
  });

  it('★v9.12 头注登记锚(用户裁决原话+三对照实测+v6 政策废除+标定改判;v9.8-v9.11 史档注保留)', () => {
    expect(BEAT).toContain('★v9.12 稳定锁帧档+方差自适应');
    expect(BEAT.replace(/[\s*]+/g, '')).toContain('宁愿渲染减速也不应帧数反复抖动');   // 头注换行容忍(连同 * 前缀)
    expect(BEAT).toContain('正确的调制是锁在一个稳定帧率');
    expect(BEAT).toContain('?c10e=0 同样抖');                  // 三对照实测之一
    expect(BEAT).toContain('旧版也抖');
    expect(BEAT).toContain('流不匀=抖动根源');
    expect(BEAT).toContain('v6 帧率优先政策');
    expect(BEAT).toContain('就此废除');
    expect(BEAT).toContain('【绝对 std 不随');
    expect(BEAT).toContain('锁 120 可比跟满更抖');
    expect(BEAT).toContain('v9.11 跟满回归自此整体退役');
    // 史档:头注 v9.8/v9.9/v9.10/v9.11 各注保留(退役=归档非抹史)
    expect(BEAT).toContain('★v9.8 根治刀');
    expect(BEAT).toContain('★v9.9');
    expect(BEAT).toContain('★v9.10 预测式提前量');
    expect(BEAT).toContain('★v9.11 终局刀=跟满回归');
  });

  it('★v9.7 hold 兼容源锚(保留面):hold 早退在状态机前;floorRaiseDue 钩在;Game 侧 paused 单源接线先于 observeVsync', () => {
    expect(BEAT).toContain('hold(on: boolean): void');
    expect(BEAT).toContain('protected floorRaiseDue(): boolean');
    const iHoldBlock = BEAT.indexOf('if (this.holdOn) {');
    const iMachine = BEAT.indexOf('const vsync = this.vsyncPeriod;');
    expect(iHoldBlock).toBeGreaterThan(-1);
    expect(iHoldBlock).toBeLessThan(iMachine);
    // Game 侧接线:paused 单源+入场冻结窗+传送幕帘,且先于 observeVsync
    const iWire = GAME.indexOf('this.beat.hold(');
    const iObs = GAME.indexOf('this.beat.observeVsync(now, frameCapUrl ?? options.data.frameCap)');
    expect(iWire).toBeGreaterThan(-1);
    expect(iWire).toBeLessThan(iObs);
    // 诊断面:snapshot().hold
    const snap = new FrameBeat();
    expect(snap.snapshot().hold).toBe(false);
    snap.hold(true);
    expect(snap.snapshot().hold).toBe(true);
  });

  it('★v9.12 cap UI 恢复源锚:Settings frameCap 行可用(五档循环)+hint;Options 字段保留;l10n 产物两语言含更新文案', () => {
    // Settings:行恢复可用(无 disabled)+hint 悬停文案+五档循环 {120,90,60,30,0}
    expect(SETTINGS).toContain("Lang.text('Mods.SandboxWorld.Settings.FrameCap')");
    expect(SETTINGS).toContain("{ hint: Lang.text('Mods.SandboxWorld.Settings.FrameCapFollowHint') }");
    expect(SETTINGS).not.toContain("{ disabled: true, hint: Lang.text('Mods.SandboxWorld.Settings.FrameCapFollowHint') }");
    expect(SETTINGS).toContain("d.frameCap === 120 ? 90 : d.frameCap === 90 ? 60 : d.frameCap === 60 ? 30");
    expect(SETTINGS).toContain("d.frameCap === 30 ? 0 : 120");
    expect(SETTINGS).toContain('`${d.frameCap} FPS`');
    expect(SETTINGS).toContain("Lang.text('Mods.SandboxWorld.Settings.FrameCapOff')");
    // Options:字段保留(兼容存档)
    expect(OPTIONS).toContain('frameCap: number;');
    // ★BJ695：缺省 120（60→120,用户令;60Hz 屏=cap≥屏率 minK=1 行为与 60 档逐位全等）
    expect(OPTIONS).toContain('frameCap: 120,');
    // l10n 产物:更新文案两语言在位(build-l10n 重建)
    for (const f of ['public/l10n/zh-Hans.json', 'public/l10n/en-US.json']) {
      const j = JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
      const hint = j.Mods?.['SandboxWorld.Settings.FrameCapFollowHint'] ?? j['Mods.SandboxWorld.Settings.FrameCapFollowHint'];
      expect(hint, f).toBeTruthy();
      expect(String(hint), f).toMatch(/自动降档|auto-downgrades/);
    }
    // 引擎不读 options(cap 经 observeVsync 注入)
    expect(BEAT).not.toContain('options.data');
  });
});

// ── ★v9.13 旗关世界/★v9.14 容量世界回归锁(2026-10-09;★v9.14 已转正缺省开=容量判据,
//    ?varadapt=0 逃生门=方差世界;旗语义演化史 v9.12.2 刀1-3→v9.13 去 30 档→v9.14 容量
//    判据见 FrameBeat.ts 头注;测试经 varAdaptSetForTest 显式控制两世界)──
// 语料=Windows 双 trace 链[e]+Mac 链[loop] rAF 回调 delta 实拍(×10 整数;提取口径与
// tools/trace-single-chain 一致:rAF-leaf 样本 3.5ms 聚类=回调时刻):
//  WIN_A=Trace-20261008T175748 t=0-30s(Windows 入场级联+恢复滞后)
//  WIN_B=Trace-20261008T212134 t=40-70s(Windows 粗糙段)
//  WIN_C=Trace-20261008T235432(Mac 用户机 ?varadapt=1 实报局)游戏链[loop] t=0-72s
const WIN_A_DELTAS_X10 = [
272,270,246,256,317,240,138,169,151,146,156,147,140,167,125,139,132,128,161,140,
117,147,143,140,132,108,130,141,135,136,120,143,128,173,223,274,187,142,158,131,
110,143,144,134,138,115,157,138,210,172,136,140,160,151,149,148,146,112,138,135,
154,140,113,174,150,48,127,143,153,156,151,134,138,113,142,165,236,198,263,170,
161,162,164,159,146,234,148,170,166,146,150,146,134,140,123,171,159,153,144,151,
169,182,101,612,648,317,198,165,146,186,179,150,190,148,152,130,151,158,139,143,
112,140,353,186,150,150,143,139,136,142,117,138,60,134,145,71,136,132,68,36,
156,121,138,149,152,187,151,167,38,119,40,126,42,121,47,135,154,43,121,46,
122,44,135,159,41,133,157,42,141,162,160,37,125,42,127,39,137,152,47,130,
148,57,131,37,131,156,42,142,160,155,46,124,42,142,146,42,121,46,136,150,
45,128,39,127,41,153,137,48,122,44,117,46,132,39,121,45,137,143,49,618,
622,313,207,42,153,131,132,98,140,149,113,120,83,151,97,84,141,106,83,144,
110,83,140,108,83,143,109,83,157,92,86,180,67,84,154,97,82,167,84,89,
151,95,83,136,112,88,145,100,84,205,49,84,145,102,80,163,93,84,148,100,
80,155,95,84,141,108,83,174,83,77,149,106,83,154,91,83,183,66,86,239,
95,179,73,84,166,83,79,169,82,82,169,89,84,148,97,84,140,110,83,190,
59,81,182,72,85,150,95,83,148,107,83,149,96,83,142,111,88,147,96,83,
222,118,214,125,143,98,82,150,101,82,136,114,83,164,87,85,203,50,82,147,
103,79,284,52,140,108,82,139,113,84,170,79,84,158,95,83,158,89,84,142,
107,83,158,97,84,195,56,81,158,91,83,167,84,83,168,79,84,154,97,83,
158,92,82,143,105,83,171,79,84,152,97,84,144,107,82,149,105,83,147,99,
88,127,40,82,83,143,104,87,152,96,82,135,115,83,163,90,80,154,96,84,
203,52,83,157,98,75,184,66,83,151,100,83,161,90,84,140,108,83,148,107,
83,157,90,84,169,80,84,159,93,84,140,112,83,141,104,83,138,35,83,83,
162,88,82,139,106,84,153,96,88,149,97,83,158,94,84,142,106,83,215,121,
150,96,83,185,69,83,154,93,83,142,108,83,137,115,83,151,97,83,159,95,
82,172,80,77,158,94,85,160,86,83,140,109,85,152,97,83,174,77,82,153,
97,82,162,94,83,160,85,85,133,35,83,83,145,103,81,212,40,87,160,85,
83,194,62,84,153,90,84,142,107,83,166,91,83,163,83,93,144,92,85,137,
111,85,141,107,83,138,116,82,181,69,83,166,82,83,161,94,83,297,222,64,
83,83,145,102,153,103,77,136,115,81,129,39,84,99,182,53,93,165,71,89,
83,130,37,84,127,36,83,88,136,111,88,117,42,82,88,373,244,54,264,65,
169,94,157,150,201,150,75,84,127,40,83,135,115,89,81,129,37,82,81,674,
320,142,117,79,105,62,83,87,139,107,83,178,43,64,48,123,45,84,84,139,
111,83,176,76,83,150,95,84,138,116,84,132,117,83,175,72,82,138,113,83,
152,97,85,136,111,83,128,39,83,89,150,95,87,173,72,84,122,45,83,83,
161,90,83,141,108,83,645,355,207,170,104,105,83,185,66,81,127,41,83,89,
134,108,88,131,117,88,120,44,83,92,149,90,87,136,109,83,176,211,155,45,
80,123,41,94,83,155,90,94,144,89,88,138,111,84,119,47,88,83,144,102,
88,180,66,79,160,98,122,123,84,81,135,113,84,145,105,92,144,98,92,144,
100,82,121,41,83,83,153,102,84,553,277,137,35,94,65,83,83,129,42,86,
78,144,110,87,171,70,90,130,35,78,83,146,109,80,127,40,83,83,125,43,
83,87,121,43,83,82,159,91,83,165,95,74,193,60,80,153,104,79,139,108,
90,127,116,81,121,50,83,83,125,41,81,82,125,42,83,84,643,260,135,134,
82,85,122,38,88,83,119,43,83,85,176,74,82,117,50,83,85,138,114,82,
138,119,77,130,36,86,80,130,39,83,83,139,110,83,143,108,84,102,65,83,
88,134,111,83,107,61,83,85,152,95,89,110,53,88,81,131,119,81,497,202,
107,110,83,152,100,89,114,48,84,83,111,57,89,72,98,69,83,84,83,127,
39,83,88,79,83,83,110,57,83,84,113,54,83,84,85,117,48,83,85,85,
83,82,107,58,83,85,96,71,85,82,106,64,82,84,148,101,84,105,57,83,
84,83,177,77,83,103,64,83,83,105,58,86,81,86,83,83,83,157,90,82,
111,59,83,84,118,49,81,82,102,66,83,83,114,55,84,75,88,83,84,85,
136,113,86,148,99,83,126,44,86,81,102,69,81,82,124,38,84,105,61,83,
84,84,120,45,85,84,103,61,83,89,123,43,87,86,99,56,83,83,120,47,
86,83,114,52,83,80,102,65,84,82,114,54,83,88,101,62,83,82,101,70,
83,79,101,67,83,83,104,68,85,77,103,66,83,83,111,57,80,82,114,58,
83,84,124,43,80,81,91,80,84,83,112,59,78,82,121,46,86,81,110,54,
83,83,95,72,83,84,106,61,84,86,101,63,83,88,103,60,82,84,98,72,
83,82,120,46,86,89,100,61,85,84,104,56,83,83,133,117,87,104,60,82,
83,131,36,86,84,102,61,83,88,94,72,79,83,107,65,84,79,196,54,83,
105,66,82,83,126,46,79,83,92,71,83,84,114,58,83,83,105,57,83,83,
110,61,84,82,118,44,85,88,116,45,83,83,127,44,79,83,112,54,82,85,
130,39,79,84,114,55,81,82,102,69,80,83,109,56,87,84,110,53,83,86,
102,64,82,83,111,60,82,84,105,59,83,82,149,108,77,126,40,84,85,106,
61,80,83,124,47,81,83,109,56,84,86,130,37,80,83,109,64,79,83,107,
65,83,83,114,50,81,83,114,56,81,82,102,64,83,83,103,64,85,84,108,
55,83,84,122,44,83,83,106,66,83,83,117,47,83,81,117,50,84,82,116,
57,79,82,115,52,84,84,120,47,83,83,148,105,82,112,60,81,83,96,68,
90,83,118,42,83,83,99,68,83,84,187,67,80,120,48,83,83,125,40,92,
83,110,48,83,83,105,65,83,83,114,51,87,81,110,55,83,84,109,58,85,
84,104,62,82,81,111,60,83,83,309,104,236,122,62,84,84,113,49,83,83,
120,48,82,83,110,59,83,84,112,53,86,83,134,114,83,133,117,91,109,56,
79,84,120,50,80,82,104,63,83,84,119,47,84,84,113,62,81,84,105,56,
86,83,114,56,82,83,132,119,80,115,50,84,82,125,42,90,81,120,43,84,
83,114,52,83,83,102,65,84,82,109,58,83,84,130,40,82,81,111,57,83,
84,110,58,82,88,155,91,83,185,85,154,153,122,114,72,35,83,180,67,82,
107,60,86,84,115,50,87,80,128,40,89,83,116,44,83,87,120,44,82,83,
127,40,83,84,108,59,83,83,302,37,107,39,101,80,124,44,83,84,148,105,
91,109,46,85,84,144,108,84,170,77,86,145,101,83,149,102,83,264,72,147,
106,77,115,51,88,82,153,96,84,236,95,123,43,83,83,118,54,80,83,112,
57,83,84,113,55,82,81,127,43,83,83,112,51,83,84,106,64,84,82,116,
49,86,83,127,36,83,84,108,59,82,83,110,57,83,83,108,63,83,83,103,
62,84,84,110,56,83,83,255,80,116,52,108,57,104,59,83,83,108,59,89,
83,104,58,83,85,120,45,82,83,109,58,83,88,97,66,88,79,108,62,81,
82,112,55,83,83,110,56,83,83,95,80,80,83,115,49,83,84,104,65,83,
83,108,54,87,83,109,62,82,83,103,58,88,83,115,52,83,88,334,289,332,
35,223,117,119,46,84,83,114,48,86,83,119,47,83,83,108,60,85,83,104,
59,83,85,96,70,85,83,103,62,82,89,137,111,83,95,70,83,88,106,58,
82,83,104,63,83,83,97,70,83,83,113,56,83,81,111,55,84,83,114,54,
84,83,101,64,85,83,101,65,87,83,113,51,83,83,110,57,83,87,106,61,
83,83,99,68,87,82,99,65,82,88,121,40,87,83,100,62,86,84,105,59,
83,83,99,71,84,83,107,63,84,78,134,115,84,99,68,83,84,110,53,87,
87,106,54,87,81,98,67,85,80,115,51,85,83,127,38,83,88,100,63,83,
84,119,47,83,87,109,56,80,83,116,56,82,83,101,68,83,83,94,70,88,
82,130,38,84,77,110,57,84,83,137,113,85,132,36,80,83,108,60,83,84,
97,69,85,82,146,105,81,129,39,83,84,111,58,81,81,115,60,80,83,111,
52,84,83,104,64,83,83,130,36,83,82,125,42,83,88,108,56,82,84,144,
108,84,106,56,85,81,123,47,83,85,120,43,83,83,126,45,81,82,113,54,
83,83,109,58,84,83,140,114,83,113,50,85,84,112,65,73,84,108,56,83,
83,105,62,83,85,101,66,89,83,101,60,82,84,153,41,58,81,115,56,82,
83,116,50,83,83,108,60,87,82,109,62,81,83,123,47,83,82,106,57,87,
85,99,69,81,81,113,55,84,81,109,57,87,78,95,73,80,88,101,66,82,
83,96,67,83,84,96,71,87,83,93,71,83,85,91,74,83,83,118,51,82,
83,113,52,83,87,96,71,80,89,115,48,92,76,295,44,86,76,83,84,99,
64,83,89,162,85,79,106,65,82,80,127,43,86,80,117,46,86,84,95,71,
87,79,96,69,86,83,108,56,84,81,94,73,86,84,111,53,83,89,96,70,
83,85,114,47,87,86,98,68,83,82,99,65,83,89,108,57,83,85,114,46,
83,89,172,77,83,125,42,83,83,117,60,74,83,124,38,85,86,105,62,79,
83,108,59,83,87,102,65,83,83,104,61,87,82,115,52,83,86,97,72,83,
78,168,86,83,116,49,78,84,108,62,83,84,107,56,87,80,126,56,74,120,
174,72,48,122,44,81,84,122,47,81,82,136,116,80,112,59,81,82,122,47,
82,83,127,44,81,84,129,39,83,83,132,36,79,83,120,44,84,83,119,48,
91,83,118,46,83,84,110,53,86,82,126,44,83,85,128,117,83,139,120,74,
111,55,86,83,101,63,83,86,110,58,80,86,110,56,83,85,118,44,87,83,
108,56,87,84,106,57,88,82,123,41,85,80,115,52,84,83,111,55,83,86,
117,50,82,85,101,63,83,83,107,60,85,81,107,65,82,82,137,111,83,108,
63,89,65,89,61,98,62,111,70,105,64,108,59,96,60,109,61,102,66,106,
63,99,65,103,65,112,61,108,69,90,63,97,65,107,63,115,62,96,61,101,
61,123,59,95,57,101,57,110,60,126,73,86,60,91,61,128,57,90,60,106,
64,109,62,101,64,104,60,102,66,104,62,97,65,122,62,93,59,104,70,99,
60,116,63,98,55,113,59,101,59,35,75,59,100,67,102,65,101,68,111,64,
94,58,105,65,124,63,87,58,108,62,105,63,106,59,99,65,122,63,97,67,
85,66,104,64,109,57,101,60,116,62,99,66,97,64,107,56,107,71,96,63,
117,68,93,53,106,59,38,78,53,106,62,111,57,100,61,100,68,113,60,112,
59,97,58,110,57,107,59,37,88,54,94,66,117,66,88,60,109,58,119,56,
102,56,109,68,95,62,105,62,102,61,110,61,108,62,105,59,105,59,122,58,
99,63,101,53,118,56,100,61,129,58,92,52,105,66,110,59,105,75,96,61,
96,65,105,63,95,65,123,61,89,56,35,86,63,95,63,99,60,112,57,133,
61,96,65,92,77,88,59,102,62,36,70,65,103,68,98,66,106,64,105,54,
100,58,36,78,63,106,56,113,61,95,61,117,58,101,71,97,61,112,70,108,
57,94,56,108,62,103,62,108,52,108,60,109,56,108,61,130,71,100,58,80,
58,118,56,98,65,108,62,103,58,105,58,39,77,59,108,59,101,65,102,64,
104,61,111,57,99,65,35,75,65,99,54,37,75,64,120,56,90,65,114,68,
94,63,96,60,37,74,58,114,67,95,67,102,66,106,66,101,63,101,62,105,
68,117,58,94,61,164,70,38,76,93,67,87,62,105,64,115,66,108,59,90,
68,100,68,100,63,97,66,104,66,112,63,89,73,113,65,102,61,87,62,103,
66,100,60,37,74,60,108,60,111,64,101,58,110,60,105,60,100,62,106,59,
127,77,89,56,103,55,119,64,88,58,115,70,99,58,97,71,99,63,101,62,
103,59,119,61,113,65,96,70,89,75,101,62,102,74,98,73,98,66,98,65,
96,60,111,68,88,67,100,70,101,68,102,70,98,68,98,64,97,67,107,62,
105,68,92,67,98,70,134,63,88,63,100,65,97,68,94,65,95,67,103,68,
102,63,98,65,100,72,105,61,92,66,111,64,89,65,103,64,124,59,85,74,
102,68,102,63,87,63,121,60,93,58,115,59,94,63,115,66,105,63,160,72,
99,144,92,109,100,61,60,87,56,95,59,90,57,61,79,60,81,55,86,52,
107,65,103,66,104,59,119,58,97,57,110,72,104,65,89,61,117,65,95,61,
105,67,103,64,97,72,88,63,119,60,103,59,102,66,103,63,119,60,92,61,
102,61,109,65,96,63,132,59,101,68,102,85,90,68,78,79,91,69,93,77,
89,77,94,67,107,62,101,61,95,72,106,68,95,65,103,81,122,82,95,82,
90,61,85,67,97,66,97,58,97,62,86,66,101,65,103,67,117,58,108,64,
103,72,98,71,94,55,110,72,94,59,82,87,106,65,86,62,101,68,111,62,
86,61,115,63,100,64,106,68,85,64,110,63,108,65,94,57,118,64,103,60,
98,68,108,74,83,59,102,63,107,62,109,60,108,61,107,60,104,64,102,63,
99,67,114,64,92,65,122,56,93,59,103,64,107,59,114,64,88,69,103,63,
99,69,101,66,111,62,107,62,90,65,119,65,92,61,96,67,36,87,59,103,
58,101,60,103,65,101,58,112,63,104,61,92,74,97,67,99,66,104,62,127,
69,98,92,93,59,84,60,104,58,103,70,100,75,83,71,99,69,136,75,88,
76,86,61,78,67,93,66
];
const WIN_B_DELTAS_X10 = [
154,94,83,135,116,86,318,198,65,85,179,69,83,137,111,87,139,108,83,121,
46,84,84,204,47,84,118,51,85,82,232,100,141,106,84,128,38,83,88,162,
87,83,140,106,88,155,92,84,134,115,88,155,92,82,147,105,83,127,39,83,
83,137,112,84,149,104,84,130,37,83,80,257,81,119,48,84,83,118,44,83,
86,128,37,82,83,120,47,83,88,127,36,82,87,122,41,84,87,119,45,83,
84,117,49,83,90,137,106,84,112,56,83,85,126,38,83,84,130,41,79,83,
137,115,81,125,43,83,88,123,43,83,83,138,108,87,148,99,83,123,44,84,
87,114,49,83,83,251,83,113,57,84,80,134,114,84,185,74,104,121,99,83,
151,98,83,131,38,83,84,130,36,83,84,128,41,80,82,128,39,83,83,140,
115,80,143,107,84,144,107,85,120,43,84,82,114,59,80,84,165,83,84,114,
51,85,83,128,40,82,84,131,117,88,125,39,82,84,606,247,110,51,101,51,
86,84,133,39,80,83,115,47,87,84,110,57,83,83,176,70,83,114,52,84,
84,126,40,83,88,136,109,84,122,47,82,84,116,49,84,85,177,73,86,129,
37,79,85,142,106,88,138,111,83,119,44,84,88,146,100,83,127,39,83,88,
130,37,80,83,121,46,87,86,151,94,83,149,99,88,121,45,80,84,141,107,
85,112,55,81,83,122,46,81,84,115,52,87,84,127,35,83,84,157,94,85,
138,110,82,141,112,83,159,89,93,112,44,83,86,122,44,83,82,126,41,83,
85,191,60,83,139,111,83,124,43,93,74,116,50,85,83,117,50,83,84,132,
119,83,158,92,85,128,119,83,164,84,84,186,68,83,144,104,83,122,45,98,
68,222,114,130,37,79,83,132,35,83,91,174,73,83,143,102,83,181,70,82,
159,95,83,147,99,83,202,48,83,126,41,84,83,166,84,88,135,110,83,212,
44,82,138,108,82,339,180,64,82,172,84,83,202,46,80,221,111,144,106,83,
177,76,82,181,67,83,271,65,124,43,80,83,165,92,78,162,87,84,121,43,
84,83,222,116,138,109,84,160,92,83,182,64,83,174,81,84,138,112,86,217,
108,151,104,85,145,102,86,217,113,144,103,83,175,74,86,210,38,86,178,69,
84,133,36,82,85,210,37,83,146,110,84,136,113,80,167,84,83,132,116,82,
152,99,87,211,36,83,152,103,80,146,103,83,142,108,85,184,66,84,130,38,
85,84,134,111,83,160,91,85,120,45,83,84,175,76,84,160,88,87,155,96,
83,143,108,83,126,36,86,84,123,44,83,84,156,89,85,139,109,83,133,35,
83,85,168,80,84,149,104,83,136,113,84,162,83,83,138,115,84,148,99,83,
188,62,85,146,104,84,144,104,85,131,39,78,83,121,46,84,89,145,100,84,
167,83,86,127,37,83,84,144,106,88,130,114,83,184,66,83,148,105,84,130,
37,83,83,172,78,82,131,116,83,149,101,84,146,104,83,124,44,84,84,141,
106,83,133,117,83,146,104,83,149,102,82,143,108,84,125,43,80,83,147,105,
82,128,38,83,83,152,99,85,125,42,85,83,123,43,82,88,153,95,82,164,
84,84,127,42,85,83,135,117,84,128,35,82,83,125,43,84,83,194,54,87,
187,58,84,139,111,82,160,90,84,162,94,84,155,97,78,151,99,84,148,99,
84,174,81,77,148,102,84,149,99,83,148,104,84,184,66,81,147,105,83,135,
116,84,165,81,82,165,87,83,146,107,85,154,91,83,158,97,83,146,100,83,
143,111,82,167,80,83,153,104,75,136,115,83,146,106,84,122,42,83,83,178,
73,84,133,122,80,148,98,87,147,103,83,166,83,84,137,111,81,135,116,82,
143,107,85,148,102,82,123,46,85,82,155,93,84,148,106,83,139,107,83,143,
115,80,136,110,84,123,44,83,83,133,118,85,134,117,83,154,92,83,131,36,
84,82,159,91,84,137,112,85,144,104,84,131,35,84,89,136,110,83,125,39,
83,86,165,86,84,123,40,83,83,141,112,83,140,109,84,129,36,84,83,128,
42,83,85,134,113,83,133,116,83,163,91,83,128,38,84,83,129,38,80,84,
137,116,83,130,36,84,83,127,42,84,83,150,102,75,155,99,82,132,117,87,
121,39,83,84,128,38,83,84,131,39,84,83,130,35,83,83,154,94,84,150,
99,86,158,88,85,166,87,85,146,99,82,162,88,83,152,99,84,148,101,84,
135,113,85,159,92,84,159,90,88,187,55,86,138,114,85,136,111,83,135,115,
85,130,117,83,132,122,83,191,55,83,127,41,83,87,148,96,83,144,109,83,
129,36,83,83,314,108,139,110,146,99,84,176,73,83,129,38,86,82,145,104,
89,148,96,83,152,98,83,172,82,86,130,35,79,84,155,96,81,131,36,88,
83,124,38,84,83,157,93,86,120,44,83,83,155,100,83,135,111,83,151,103,
82,133,116,82,164,87,83,135,115,83,128,38,84,83,132,35,83,83,135,38,
83,83,184,63,82,384,171,115,125,41,80,83,152,99,83,137,35,80,83,153,
98,82,140,113,84,133,35,82,85,149,99,84,288,41,132,35,93,72,128,39,
84,83,135,38,77,83,139,115,84,139,108,83,160,90,83,144,108,84,346,184,
53,86,133,113,87,177,71,83,135,116,83,223,121,124,114,83,154,96,83,162,
92,83,132,114,82,139,114,84,130,36,84,80,118,49,84,83,160,95,83,113,
49,86,83,138,111,83,144,112,81,119,44,85,83,111,56,84,82,219,115,129,
35,85,82,126,44,86,79,136,112,83,158,93,84,116,50,84,83,132,35,83,
87,175,76,83,139,143,75,155,72,108,142,87,80,131,35,80,83,312,109,169,
78,132,36,85,84,171,75,89,172,73,84,156,91,84,151,99,83,162,89,83,
445,249,186,47,78,180,57,92,220,113,170,81,87,171,78,80,132,117,89,154,
94,81,151,101,84,213,36,81,134,117,81,134,88,113,123,41,82,83,163,88,
85,161,90,79,322,175,87,84,197,50,85,177,72,83,148,103,85,138,111,84,
141,107,88,135,112,83,177,73,84,146,104,85,155,92,85,153,95,84,128,41,
81,94,130,108,103,128,110,84,145,109,79,43,92,93,112,100,77,124,58,101,
77,106,102,80,111,80,199,105,105,77,93,71,95,73,95,67,95,68,102,106,
100,99,69,116,73,102,72,95,78,98,83,94,71,103,73,100,74,119,111,81,
100,86,116,254,106,113,81,98,77,129,98,72,98,81,109,80,124,113,75,108,
92,109,104,82,108,81,114,300,143,121,108,115,85,175,124,111,108,102,116,82,
111,85,106,117,81,109,85,107,125,103,111,110,88,130,156,129,90,122,118,89,
116,137,94,349,144,121,121,96,112,126,125,126,129,131,92,127,119,91,110,125,
93,122,118,102,116,118,94,131,121,99,184,296,139,143,118,93,114,126,94,128,
63,99,121,117,116,108,98,124,131,122,89,116,99,115,115,93,134,119,123,92,
117,142,90,119,339,334,169,137,157,112,153,149,173,138,133,141,116,135,142,140,
134,101,113,118,102,115,116,118,148,124,114,93,132,113,99,125,120,124,97,121,
124,93,118,128,95,123,126,95,124,123,95,127,129,136,103,117,115,96,127,118,
101,116,115,109,118,115,94,117,127,121,93,116,98,115,117,133,52,105,62,109,
59,110,57,132,145,57,115,55,107,54,113,54,114,56,109,55,112,55,116,51,
115,54,110,55,146,147,39,104,63,118,48,108,59,109,57,103,63,115,51,110,
65,116,49,104,56,115,55,103,64,125,41,101,63,119,48,111,61,108,59,102,
59,107,60,121,44,115,56,107,60,109,56,112,53,115,56,109,58,108,54,107,
62,111,57,147,151,139,58,111,57,114,53,113,53,122,44,117,49,110,56,116,
51,121,50,116,52,108,59,100,63,111,56,118,47,119,49,103,63,107,58,126,
45,112,54,134,134,63,113,55,114,55,107,60,127,37,111,57,101,69,103,63,
129,39,119,48,109,53,102,69,114,53,113,53,111,58,94,72,90,71,107,64,
119,46,116,50,112,56,110,55,100,69,106,60,115,53,92,71,102,64,103,68,
113,53,136,126,69,91,78,102,63,116,50,106,61,94,73,101,65,98,71,102,
66,99,63,97,72,102,64,98,69,82,84,105,67,107,55,100,71,89,77,95,
67,94,73,96,72,94,73,91,78,103,60,94,77,101,66,81,80,195,95,43,
77,89,89,84,88,72,85,82,96,72,85,80,98,69,89,78,83,84,110,57,
102,68,87,78,82,83,349,148,118,106,170,114,112,49,106,66,114,48,101,71,
80,87,100,62,103,63,85,80,100,71,96,70,98,64,97,72,87,79,97,69,
90,75,128,39,86,83,112,55,97,66,112,56,98,67,103,66,92,74,98,70,
107,58,113,53,111,57,103,65,269,119,135,113,146,55,117,45,102,64,331,136,
101,134,118,99,101,100,46,93,74,89,81,100,63,99,67,95,72,127,40,102,
65,86,80,143,53,104,68,100,125,77,96,66,103,63,108,59,87,80,97,71,
99,69,93,73,88,78,106,65,114,49,84,83,100,66,102,70,92,73,105,60,
98,68,106,61,116,49,87,81,94,73,91,78,83,114,103,124,78,89,72,132,
39,100,64,163,119,52,87,78,83,98,141,95,101,127,107,102,64,85,85,89,
102,55,84,96,70,84,109,60,82,117,59,106,107,114,97,69,104,104,39,84,
99,66,87,129,38,118,45,83,92,74,99,68,93,74,92,74,94,136,132,115,
109,82,124,43,85,81,98,71,85,78,84,89,107,56,91,72,83,84,96,77,
131,113,88,90,78,116,46,111,59,87,79,94,70,88,78,92,78,99,66,90,
76,103,63,91,79,104,62,82,83,97,70,97,67,96,71,104,61,112,59,91,
71,93,76,85,81,100,68,92,72,111,57,85,82,116,53,93,69,88,79,92,
75,92,78,90,73,111,60,109,57,83,82,93,75,103,61,89,77,88,78,94,
76,92,74,87,77,106,60,112,57,85,82,86,82,86,81,123,39,102,69,82,
82,83,83,83,83,117,50,100,67,88,78,117,48,95,73,95,70,89,80,109,
56,105,61,86,82,116,50,103,64,92,75,107,61,104,61,115,53,100,67,93,
76,93,69,93,77,113,54,100,63,94,74,99,72,95,67,111,56,109,58,95,
75,92,71,88,79,92,76,90,75,110,57,100,66,105,66,97,70,109,60,99,
62,97,70,91,79,106,61,113,50,124,42,95,76,109,53,99,67,119,48,92,
75,99,66,90,78,83,83,102,63,283,178,133,150,115,83,37,45,115,112,82,
99,67,113,56,85,85,88,79,88,73,83,86,99,72,102,63,106,60,78,84,
101,69,135,109,87,119,48,86,82,88,76,96,71,88,80,78,87,96,75,102,
60,99,70,100,68,88,77,88,79,100,67,119,49,82,85,83,79,82,85,298,
237,130,114,120,82,106,47,38,75,87,92,74,191,118,106,91,77,86,82,87,
96,72,77,84,82,89,70,95,79,85,77,90,70,97,91,79,76,91,77,87,
92,77,109,60,90,75,74,93,79,88,70,97,76,89,77,87,75,94,78,88,
76,90,80,88,113,52,101,67,91,75,86,82,98,68,231,132,72,64,84,86,
95,71,75,89,87,82,125,43,89,77,137,110,87,95,68,89,75,91,77,103,
63,92,77,85,82,277,192,122,177,142,112,88,55,104,62,98,68,131,40,125,
40,196,155,134,113,64,110,57,264,148,124,93,36,105,63,131,36,109,58,133,
37,119,49,111,49,111,57,171,211,122,116,46,105,61,110,56,126,45,103,66,
106,60,106,58,102,64,104,63,157,41,107,134,63,158,136,39,131,198,127,61,
109,39,157,121,56,104,62,119,50,121,43,320,209,191,160,129,120,127,130,96,
123,62,123,44,120,45,108,62,113,52,119,50,107,59,126,41,106,60,108,57,
129,43,115,47,125,41,114,53,122,47,110,54,114,57,109,57,103,60,120,49,
110,54,105,62,113,54,107,59,118,52,142,137,55,103,59,115,52,108,58,108,
60,119,47,100,65,107,62,106,62,109,57,106,57,112,54,118,49,109,61,118,
49,105,61,105,58,129,39,107,63,108,56,107,57,112,55,112,54,109,61,119,
45,98,69,116,49,109,58,148,158,138,57,107,61,108,57,104,68,126,149,52,
137,136,63,111,55,116,49,106,61,103,64,100,70,105,58,121,46,98,68,109,
60,110,57,134,157,41,102,63,114,54,97,74,119,48,94,66,106,64,114,51,
107,58,122,44,142,142,53,107,60,114,74,127,119,64,111,55,100,67,102,66,
122,46,105,61,102,63,112,57,144,136,53,116,54,99,63,106,62,102,64,113,
54,138,134,61,97,70,99,67,127,44,122,41,96,73,113,53,95,72,92,72,
107,62,96,70,98,67,86,129,88,126,72,101,66,111,59,97,67,98,69,95,
72,100,70,82,134,91,110,77,83,132,90,120,73,87,171,128,86,114,128,91,
114,117,48,103,84,63,83,127,38,97,92,64,83,139,154,42,111,54,105,62,
100,84,67,82,131,136,64,126,41,109,58,107,64,100,68,114,48,181,118,38,
118,45,104,61,115,52,119,53,112,50,113,54,112,55,121,92,41,83,128,37,
155,117,60,109,56,264,138,136,117,121,57,108,63,115,51,114,48,114,57,130,
37,109,58,113,47,116,55,114,50,114,53,111,55,126,46,119,43,109,58,112,
55,113,55,130,40,107,61,118,49,107,53,122,45,110,57,105,67,110,57,111,
54,115,47,112,59,131,36,114,49,109,60,118,48,107,61,121,47,106,56,120,
49,114,52,130,37,117,47,112,59,126,43,131,147,49,130,42,107,55,104,61,
112,55,133,35,106,58,108,58,120,46,111,55,139,147,51,112,55,103,61,118,
53,123,46,120,46,97,63,114,57,109,54,109,59,114,52,108,57,123,45,116,
50,106,60,108,58,105
];
const WIN_C_DELTAS_X10 = [
150,202,203,36,185,36,104,35,83,35,80,82,75,85,91,90,57,81,49,81,
64,56,75,51,77,61,73,100,52,78,68,78,80,80,79,78,88,80,101,87,
46,91,73,99,76,100,85,89,72,85,64,66,93,45,75,53,85,77,53,81,
63,73,84,92,96,83,59,91,87,85,66,91,78,105,44,65,76,102,87,94,
87,89,74,101,90,86,69,66,73,59,77,70,68,76,78,72,64,69,75,76,
80,73,92,84,79,94,75,64,74,79,72,64,86,66,65,97,81,91,65,81,
81,72,77,78,77,72,66,68,147,93,87,77,36,75,47,86,77,59,74,100,
75,76,75,86,84,83,75,121,72,81,77,73,76,91,93,69,74,97,75,82,
95,36,63,93,56,86,66,135,97,87,45,81,40,53,75,91,87,83,77,59,
85,54,86,80,110,75,95,96,36,58,93,79,83,79,83,81,62,74,62,77,
79,55,83,78,71,88,84,83,96,119,76,84,76,166,91,49,50,89,49,80,
88,69,66,136,89,141,97,37,84,89,81,107,59,84,139,90,46,65,47,97,
185,78,91,65,99,127,117,80,97,93,56,67,77,99,70,87,85,93,80,87,
82,90,80,88,82,106,63,88,75,93,75,93,76,111,38,80,74,99,56,139,
77,111,66,136,98,37,57,75,73,111,51,92,85,151,61,89,142,36,87,137,
130,40,65,85,134,105,79,116,58,52,83,125,92,79,94,124,98,77,91,77,
83,85,120,45,85,157,106,62,92,77,65,98,88,88,60,74,47,68,88,68,
81,95,102,111,108,142,35,73,84,133,65,92,65,105,53,91,74,98,45,63,
90,108,51,50,77,82,105,64,143,105,109,74,153,107,96,80,85,98,69,102,
50,53,59,54,79,102,56,158,95,68,38,89,101,186,62,97,38,66,70,55,
104,62,116,105,93,65,67,72,96,80,74,82,118,52,67,82,103,58,88,90,
84,103,86,78,101,62,97,83,87,60,85,93,91,81,83,76,101,74,77,85,
118,47,86,91,101,57,126,98,100,99,133,101,56,96,106,100,56,75,104,83,
55,73,109,38,168,89,88,88,76,44,109,59,89,87,107,60,85,85,101,48,
76,82,106,95,104,115,116,89,83,101,42,41,56,85,105,47,85,87,112,58,
86,93,113,42,69,88,100,127,90,111,103,80,66,110,60,86,79,110,53,84,
82,117,70,97,102,45,91,61,82,145,107,60,159,93,93,144,61,64,83,155,
85,83,148,45,81,81,151,155,152,41,94,163,69,82,79,147,102,82,116,46,
129,105,58,56,122,98,40,78,69,87,99,61,81,84,118,49,91,74,105,45,
91,119,105,92,91,110,56,86,77,112,36,98,84,103,69,90,84,109,58,87,
130,106,55,55,138,103,114,65,113,50,88,83,97,39,116,83,102,65,76,91,
109,47,69,89,106,50,93,102,112,76,95,111,85,69,60,94,89,52,90,71,
115,49,94,83,130,111,84,110,55,86,82,131,152,183,48,101,137,60,99,83,
145,130,152,68,81,48,110,39,85,50,76,110,66,85,80,111,55,84,87,111,
52,85,111,104,68,107,128,41,123,78,105,75,94,114,56,91,90,176,68,66,
144,83,67,73,104,42,45,92,70,118,63,85,83,114,38,84,83,110,111,74,
111,109,77,80,98,67,83,89,101,81,98,123,76,68,76,101,45,69,77,79,
118,53,84,73,106,37,50,87,110,111,89,81,120,43,89,133,116,98,94,98,
74,82,101,96,92,95,105,60,87,82,103,62,126,113,93,80,128,130,35,89,
92,81,83,147,99,126,88,100,113,122,117,99,85,157,68,119,105,37,69,82,
110,42,74,75,102,111,39,82,85,101,35,80,63,111,38,35,76,73,105,48,
51,74,98,109,64,59,79,102,98,96,113,101,80,108,126,37,81,93,92,65,
88,126,100,102,96,108,62,79,109,79,109,95,108,82,76,94,93,66,67,92,
94,57,86,82,103,62,38,95,89,112,71,161,109,69,81,102,53,95,81,101,
64,84,73,107,56,89,78,94,59,90,91,142,91,82,81,105,67,77,93,91,
66,86,82,147,38,83,101,58,97,65,82,106,61,76,83,104,62,93,58,99,
41,93,83,119,71,82,96,90,134,78,121,95,68,94,98,40,168,107,36,72,
65,97,62,63,79,83,100,120,110,147,48,63,70,100,113,94,133,58,97,84,
115,48,65,96,100,54,94,138,109,77,93,100,97,72,82,104,120,117,112,104,
90,118,58,106,66,106,140,108,135,42,112,92,135,73,153,61,100,80,143,103,
109,164,80,63,110,90,61,62,100,80,50,70,89,63,70,65,62,92,52,96,
61,105,72,92,56,85,117,40,76,81,109,61,87,102,114,44,86,107,103,71,
101,111,68,93,83,103,63,83,87,111,91,99,106,88,77,89,102,61,83,87,
117,45,95,74,102,84,127,108,106,129,104,62,40,67,86,112,87,96,101,69,
78,95,94,90,78,82,111,36,101,67,105,105,57,90,110,76,83,78,89,70,
83,74,118,42,63,98,113,58,85,90,103,65,86,92,112,50,101,126,104,87,
74,98,63,87,102,116,39,87,61,93,80,90,81,114,56,102,94,91,52,78,
82,98,67,94,73,93,72,89,94,105,44,93,89,112,43,89,80,133,179,179,
46,50,92,119,129,80,92,50,106,76,134,58,100,130,145,68,120,45,58,87,
137,93,80,89,134,112,85,99,59,84,88,114,46,75,135,104,46,71,151,212,
114,102,173,189,95,152,53,75,74,115,49,90,134,121,111,114,55,92,37,82,
112,81,95,142,37,129,86,106,125,89,117,53,94,59,122,111,75,119,111,97,
113,42,46,98,82,121,51,81,104,110,70,105,117,108,81,115,43,53,83,84,
121,48,92,86,116,36,87,138,130,105,108,128,37,63,119,42,68,83,85,114,
49,80,88,119,44,61,70,114,88,88,76,149,95,84,121,55,41,74,110,151,
120,142,92,68,110,42,93,120,127,35,48,89,109,58,62,93,104,40,91,77,
80,117,66,91,103,42,60,75,92,105,80,77,86,91,76,81,88,127,40,98,
137,133,74,77,99,42,81,77,105,63,90,78,108,62,80,82,99,77,77,82,
109,57,90,106,93,74,112,107,111,78,84,89,72,82,91,99,59,87,82,93,
78,75,85,110,84,119,124,47,79,93,105,64,83,86,108,37,50,82,94,90,
116,104,96,89,85,116,106,116,96,129,73,90,117,59,62,60,92,36,87,69,
69,92,67,98,108,106,55,69,87,107,74,75,73,89,63,86,81,96,115,88,
97,45,111,74,99,58,70,78,82,109,51,84,84,132,56,101,96,44,68,58,
69,148,57,79,84,112,72,67,60,121,51,98,83,112,52,93,79,107,62,78,
93,95,36,124,37,101,51,76,132,44,95,93,104,99,52,50,63,78,97,74,
86,103,102,59,89,82,134,119,88,53,96,143,139,79,88,136,67,91,83,114,
55,76,83,127,38,71,67,87,59,73,60,79,91,35,115,81,102,50,72,89,
101,72,96,85,96,82,66,99,95,75,92,75,88,43,36,75,92,88,74,132,
94,80,72,94,93,131,86,53,100,62,76,105,121,57,83,87,92,73,61,68,
82,65,71,81,65,77,71,96,79,87,77,83,90,84,84,101,82,110,35,81,
81,81,97,79,85,95,66,92,101,84,72,59,77,83,90,90,89,89,79,83,
79,93,76,98,120,77,98,142,89,118,80,104,39,98,64,82,113,82,88,84,
87,91,82,96,76,112,87,97,91,77,86,79,53,85,68,82,70,93,80,95,
63,128,104,41,58,76,117,96,44,85,101,100,60,40,66,142,95,127,75,128,
52,69,85,46,38,150,83,35,51,83,46,78,115,61,80,86,90,37,52,104,
90,92,108,123,84,89,128,90,40,135,88,94,43,42,76,76,101,42,88,79,
97,69,97,93,104,47,86,84,89,72,90,85,88,75,81,84,92,74,83,86,
106,65,61,87,91,64,148,91,46,75,140,107,108,77,69,84,92,87,74,87,
107,94,185,85,53,133,40,90,90,96,159,106,94,64,73,123,97,141,112,114,
40,53,103,106,39,129,104,40,89,46,66,89,43,63,50,62,90,88,58,86,
81,89,85,76,84,164,92,85,103,60,73,55,121,48,87,107,125,53,84,74,
139,55,142,108,123,79,110,108,100,109,37,37,68,79,103,71,90,43,92,119,
73,131,109,38,85,84,96,100,94,113,39,60,90,141,113,43,94,111,45,85,
96,133,95,80,164,46,91,152,187,99,100,68,92,176,75,78,163,83,74,78,
148,70,57,141,86,73,76,117,45,82,87,130,96,87,165,80,62,117,77,86,
58,151,44,75,89,113,55,84,92,121,38,83,85,146,103,81,176,86,57,121,
108,61,73,143,95,85,117,49,82,92,105,37,130,83,118,66,93,125,126,93,
142,43,83,86,160,82,91,144,59,75,119,110,109,109,66,74,74,78,123,121,
82,148,95,104,113,104,136,156,47,83,131,89,50,75,111,47,87,87,114,54,
137,78,158,37,87,132,37,81,82,110,77,97,102,52,53,96,79,127,40,89,
89,118,81,137,115,51,91,60,106,57,86,84,109,64,86,75,103,65,86,89,
103,75,104,141,100,117,107,123,88,130,90,85,81,97,65,85,130,83,61,100,
119,52,80,114,113,126,80,105,74,76,92,115,152,88,102,99,77,123,43,98,
93,99,68,90,77,117,55,98,85,95,72,76,88,96,57,93,74,117,55,81,
80,97,58,105,86,132,108,80,121,43,88,89,95,71,78,82,112,57,82,89,
92,67,87,96,92,72,63,101,117,93,84,103,112,103,92,52,93,103,108,71,
94,80,91,79,95,81,97,71,80,86,89,82,80,84,130,36,85,90,164,77,
92,162,85,88,170,72,85,102,61,86,103,95,89,75,95,111,48,104,100,99,
91,84,108,61,83,90,99,62,63,105,101,58,85,84,100,65,87,81,111,61,
80,78,112,62,77,113,90,113,123,168,87,96,116,93,87,104,56,86,125,125,
35,42,139,92,67,51,73,101,61,88,89,92,72,49,76,94,36,46,73,52,
88,104,72,69,158,117,67,84,78,55,88,84,91,79,83,84,94,72,106,93,
86,57,75,87,99,71,84,76,113,60,96,98,86,40,87,60,85,92,91,129,
95,89,87,87,81,85,54,86,43,101,55,90,98,72,89,92,91,78,78,61,
100,107,68,96,91,85,92,87,122,100,77,88,48,92,77,110,55,86,84,86,
73,65,86,87,68,88,89,100,52,78,84,106,90,88,95,90,72,87,82,95,
78,70,75,95,37,59,68,76,86,98,83,89,85,81,76,88,88,130,83,105,
101,86,88,106,61,48,85,82,37,77,71,151,94,79,97,82,109,81,84,95,
65,82,60,87,39,45,67,55,166,124,74,71,113,122,82,81,76,80,93,100,
110,114,88,108,82,84,66,82,88,77,102,58,92,82,89,42,64,83,97,87,
113,82,84,81,88,73,88,86,76,87,90,73,77,84,100,114,53,78,92,81,
79,74,99,66,90,78,97,75,111,88,77,92,51,75,92,82,78,90,101,55,
161,94,86,60,88,93,77,86,85,84,83,95,77,84,88,83,78,100,73,82,
85,100,81,55,81,88,57,96,84,87,83,71,88,88,38,97,79,86,47,85,
50,65,98,100,79,103,117,38,82,57,94,48,64,75,80,79,95,79,90,80,
88,76,83,83,89,79,84,82,83,84,84,96,79,77,83,79,96,82,75,99,
68,88,86,81,74,64,76,89,55,81,76,73,86,74,87,81,98,35,88,80,
86,74,114,92,101,84,97,86,98,41,80,101,90,84,81,84,84,87,83,83,
106,53,81,81,89,77,82,84,86,81,84,86,89,79,77,83,88,79,83,83,
108,74,93,99,38,59,91,88,108,70,89,138,94,40,89,86,59,104,89,80,
116,94,85,85,47,101,84,130,55,81,85,88,84,103,94,80,71,111,84,90,
56,85,82,74,76,84,87,80,82,81,87,93,51,75,86,93,92,58,84,98,
57,91,97,87,92,90,88,89,49,74,63,85,65,59,87,84,94,112,39,83,
81,54,84,70,84,137,113,102,56,94,97,84,115,108,101,156,98,85,78,90,
80,159,86,92,87,84,73,95,137,93,78,89,84,70,83,90,95,73,72,103,
105,124,89,138,76,145,86,64,90,85,82,61,101,86,117,100,92,148,64,85,
112,102,64,94,160,88,104,119,45,94,133,94,97,72,123,108,83,96,68,91,
78,116,70,135,87,82,36,77,79,99,46,85,86,84,53,83,85,88,144,88,
98,108,103,76,98,77,99,86,200,134,105,51,54,102,99,49,87,122,99,93,
101,85,70,87,91,98,71,83,86,81,81,84,85,87,80,91,83,89,69,85,
89,86,83,84,84,92,83,93,98,48,77,84,93,83,84,86,80,83,74,85,
80,84,82,93,75,89,85,84,74,83,82,71,86,113,83,100,85,119,88,86,
94,82,82,99,77,97,63,83,94,58,86,86,88,91,77,83,93,73,104,94,
84,100,116,93,78,93,86,90,68,78,85,91,76,83,82,81,88,84,80,96,
75,114,91,43,75,91,47,85,64,87,43,81,98,76,86,89,84,78,90,74,
100,69,83,92,96,62,88,83,82,85,80,83,97,73,81,88,83,80,89,77,
74,93,83,112,100,55,89,92,93,42,85,90,87,80,78,86,88,73,84,86,
85,87,81,83,87,74,73,97,88,67,64,70,108,39,68,74,83,110,56,86,
80,89,82,65,89,89,103,85,92,90,63,81,82,100,65,85,74,100,77,77,
101,87,72,85,93,93,87,67,69,89,75,79,86,87,81,82,89,89,56,97,
88,94,65,85,92,95,70,76,90,95,66,82,83,98,74,78,85,80,104,126,
85,163,114,114,88,89,42,97,67,81,91,104,54,89,81,84,78,103,95,98,
72,98,97,98,77,102,94,69,65,89,84,88,88,92,84,80,88,88,94,90,
129,89,82,96,84,84,55,83,90,113,63,81,87,91,76,81,84,95,73,89,
80,79,92,91,83,90,62,85,87,87,81,77,82,92,72,83,87,93,72,89,
75,97,76,88,91,87,66,104,116,99,86,96,90,72,89,100,105,63,85,106,
88,108,91,81,90,88,76,107,61,89,76,78,93,87,76,96,37,87,76,158,
57,89,70,124,41,73,88,118,36,125,87,108,59,58,100,77,100,91,147,69,
53,63,105,35,161,77,77,87,88,84,75,91,81,85,96,75,83,79,84,79,
83,82,94,82,75,83,123,44,84,84,81,91,83,77,97,74,83,85,85,77,
88,95,92,75,84,108,90,69,67,65,86,110,100,89,53,80,74,95,92,43,
87,79,90,86,81,88,76,83,87,126,90,106,100,99,35,85,94,76,108,84,
83,93,84,76,84,91,73,85,83,76,90,82,88,97,72,78,82,89,85,81,
89,88,35,118,82,91,76,85,85,79,84,90,61,92,53,69,54,94,93,63,
61,88,89,91,85,92,75,80,85,86,133,125,77,120,45,87,82,103,66,78,
84,92,80,94,96,111,115,74,99,46,60,39,71,85,36,160,162,107,126,64,
69,70,79,117,82,100,85,96,89,92,90,79,75,79,85,93,63,93,59,88,
53,89,68,85,79,87,136,100,132,90,91,37,76,71,75,79,91,75,103,103,
70,62,83,96,70,89,77,85,82,82,148,96,88,95,81,86,93,77,96,70,
92,81,81,82,81,80,91,79,79,81,88,83,84,73,97,82,64,58,101,83,
65,53,94,87,71,86,88,110,90,89,86,94,79,83,95,36,78,54,72,87,
73,79,87,103,71,78,85,86,85,77,95,87,78,76,92,86,96,97,84,57,
76,84,78,85,82,82,91,90,73,85,85,81,86,82,77,97,82,75,89,85,
73,86,81,91,75,89,79,91,79,81,81,95,71,84,62,77,65,59,82,66,
77,93,86,81,106,70,75,84,78,89,83,82,87,87,78,83,89,78,86,84,
77,92,84,83,80,79,85,90,79,83,84,79,81,87,99,87,97,69,88,93,
98,38,86,81,81,89,77,87,84,84,82,84,94,66,88,82,89,84,76,88,
91,71,83,86,113,58,83,84,95,38,111,89,89,69,86,82,92,73,90,80,
85,78,85,87,100,63,84,131,92,52,116,82,45,70,76,80,104,68,76,88,
79,68,91,97,79,100,87,88,99,81,92,90,86,80,86,87,81,86,90,84,
77,94,76,91,74,90,85,78,88,83,80,85,83,79,87,105,65,79,85,84,
87,77,83,92,74,93,72,81,94,80,89,81,86,74,83,115,67,69,90,96,
64,82,94,88,70,83,84,82,83,88,80,90,76,82,84,76,91,83,86,80,
84,87,80,106,67,78,83,124,46,81,86,109,63,82,86,118,48,75,84,117,
35,79,64,107,66,96,85,147,36,60,70,144,101,92,104,124,96,150,74,46,
57,47,105,45,94,90,107,67,94,78,161,90,88,97,71,63,93,126,55,92,
102,115,51,81,102,72,72,67,85,88,47,85,98,95,72,80,85,86,84,81,
80,90,84,87,83,102,57,86,81,91,81,77,83,183,88,93,148,91,73,122,
40,76,86,117,46,86,84,111,63,76,88,108,55,81,85,96,68,86,89,142,
35,45,72,84,82,151,96,134,70,66,87,42,84,83,85,64,78,83,86,95,
64,93,81,117,41,89,78,101,46,94,127,107,69,73,90,104,93,94,100,66,
94,74,89,87,110,100,48,80,83,56,96,45,53,88,83,81,118,130,120,86,
99,81,83,84,85,88,83,85,87,124,45,91,92,89,74,101,94,90,76,66,
79,88,73,73,89,94,68,83,85,105,72,74,88,104,55,83,91,102,79,90,
104,37,79,68,62,98,38,78,64,60,98,44,69,67,85,97,39,62,61,76,
130,125,82,108,57,85,85,107,55,86,82,101,37,113,83,107,43,88,134,88,
80,46,86,120,45,82,92,93,74,74,84,98,82,74,91,96,60,84,92,100,
67,74,92,94,63,90,80,107,60,88,78,90,72,91,86,85,94,90,100,83,
58,70,80,86,82,85,79,100,74,83,85,107,59,75,94,88,75,78,82,95,
74,91,60,86,46,70,93,90,39,89,96,127,115,70,42,63,92,62,64,79,
85,61,72,83,87,99,86,89,91,77,94,83,84,81,86,84,84,83,84,82,
112,54,93,73,83,84,85,85,90,77,89,86,89,76,84,83,117,128,58,84,
97,91,82,108,59,84,84,86,81,84,90,111,36,104,80,128,44,83,75,109,
59,82,86,117,42,85,85,130,45,85,78,109,54,83,86,89,76,92,79,101,
72,109,57,108,51,84,87,100,64,91,75,104,70,58,65,88,89,81,60,79,
90,77,75,73,85,73,82,92,86,72,91,77,98,75,87,82,93,63,83,87,
84,81,83,93,90,66,88,80,86,84,80,84,84,81,90,133,87,108,95,115,
62,82,89,81,71,87,77,87,97,76,109,85,106,104,76,88,73,89,69,117,
76,93,78,109,81,95,85,79,104,99,80,97,79,94,102,77,98,80,91,79,
104,72,37,80,95,83,102,70,94,79,110,69,96,76,101,81,110,88,70,91,
80,97,78,105,90,98,86,99,97,69,112,84,90,80,105,86,92,86,91,69,
85,70,84,64,97,67,92,63,102,66,96,71,91,75,93,72,96,75,93,77,
91,76,94,75,96,77,100,73,91,83,97,79,107,78,117,95,85,92,77,90,
78,87,73,101,83,105,87,86,71,97,75,104,89,73,114,84,79,93,90,77,
81,102,110,88,102,95,89,105,80,105,99,80,81,110,103,86,118,80,97,49,
97,90,110,72,125,178,107,87,113,98,91,56,80,108,43,75,87,101,102,104,
76,96,79,97,103,72,84,82,108,78,98,83,108,88,94,83,106,77,91,92,
97,90,36,70,99,88,99,91,100,43,74,81,92,79,100,101,66,67,102,101,
82,101,72,96,104,121,74,94,74,102,103,79,100,84,108,101,77,71,106,93,
72,103,88,94,88,111,103,78,73,109,75,105,118,69,86,76,106,78,75,69,
90,81,97,91,82,103,56,91,85,103,63,55,93,94,79,53,107,110,67,84,
80,80,99,85,99,100,36,53,108,82,101,102,77,102,45,70,72,85,105,73,
89,93,87,73,79,87,96,90,73,95,69,85,71,93,82,85,75,36,56,82,
91,82,37,75,66,98,118,78,79,107,42,79,80,35,74,46,75,78,65,69,
104,72,83,104,61,95,78,58,77,57,77,110,79,104,78,47,67,104,86,83,
81,84,36,72,45,78,73,50,74,71,84,87,54,59,71,78,95,81,39,86,
84,85,75,99,95,65,58,106,101,73,75,78,105,84,54,86,85,107,71,105,
106,43,75,79,101,35,46,73,79,105,79,81,79,95,69,71,82,102,36,52,
83,77,99,76,75,89,68,92,70,98,74,100,77,82,72,108,79,73,75,100,
89,78,70,96,90,70,74,91,72,105,71,89,76,98,72,85,76,96,74,102,
72,81,72,102,73,73,92,76,114,71,82,88,73,85,79,95,74,87,71,103,
75,85,73,100,73,85,73,93,74,95,68,102,86,67,66,71,82,70,92,73,
63,83,77,68,96,73,113,76,80,72,86,75,94,71,82,56,78,47,91,35,
84,74,74,72,139,70,74,76,75,90,84,69,38,86,83,97,72,95,93,80,
95,73,86,84,82,70,109,76,64,55,106,57,93,66,73,70,71,89,78,96,
81,79,67,100,86,73,67,100,82,94,74,85,74,92,76,99,72,86,76,91,
70,103,77,104,75,74,77,93,79,92,75,88,79,91,90,74,75,92,74,85,
77,91,82,93,72,88,76,93,70,95,83,66,77,73,72,77,63,83,123,75,
65,73,81,78,85,84,73,74,102,77,90,76,88,73,93,72,88,70,99,82,
85,87,88,80,85,76,50,79,71,81,77,46,76,75,77,72,79,83,66,75,
48,74,89,36,93,84,84,70,95,69,78,107,76,79,75,93,71,88,74,134,
79,59,73,95,97,165,75,96,75,71,86,90,83,69,97,80,81,76,111,82,
89,76,78,81,78,76,98,79,80,71,102,79,85,74,36,56,87,73,92,88,
74,79,72,105,77,84,77,94,76,89,84,84,73,84,72,103,76,83,72,95,
94,81,79,88,81,80,78,86,83,85,79,94,77,91,75,85,81,86,80,110,
75,98,75,73,92,126,77,38,77,39,99,81,88,79,96,110,83,93,92,76,
74,82,74,86,79,86,78,91,82,80,76,97,88,80,77,108,79,108,71,111,
76,101,92,83,87,76,93,86,81,76,90,83,92,77,87,73,84,75,92,72,
97,76,95,73,91,77,93,69,91,70,109,71,76,82,74,89,52,99,91,107,
143,72,107,57,82,78,48,76,77,76,86,76,86,85,42,101,80,42,57,61,
70,104,74,76,99,69,116,75,90,83,97,72,56,38,82,99,73,54,109,95,
73,77,86,77,94,94,68,80,87,78,96,92,86,97,90,85,55,70,81,93,
78,76,86,77,91,79,88,80,87,71,69,88,89,47,75,93,72,67,83,79,
77,91,77,95,76,108,81,76,77,72,51,42,76,101,74,89,79,81,80,74,
93,74,77,65,79,59,80,77,76,63,59,81,73,78,42,80,162,130,131,152,
112,91,101,63,78,82,70,96,74,93,79,93,80,84,81,82,79,89,80,86,
81,85,95,72,79,90,72,96,79,83,92,83,74,87,81,87,80,94,84,76,
77,96,142,138,48,78,122,95,129,93,97,60,81,79,81,88,73,98,93,73,
87,71,79,96,86,74,83,82,97,76,79,130,82,35,101,37,62,89,158,86,
111,46,79,84,86,78,82,75,89,77,86,82,95,71,163,96,45,71,103,36,
91,53,75,91,86,88,81,88,91,69,81,85,79,87,83,90,90,72,101,75,
77,90,84,83,81,84,84,75,82,88,85,81,82,85,82,90,87,75,81,86,
95,75,93,79,80,74,84,88,95,53,60,80,72,83,78,89,55,77,91,85,
79,87,83,84,78,91,83,87,78,80,82,87,65,106,85,111,49,74,97,89,
78,91,69,75,96,77,83,78,96,88,79,84,76,74,96,69,94,73,94,79,
92,83,78,75,100,87,74,74,92,87,77,75,95,89,76,71,112,75,82,72,
95,73,87,73,77,72,73,65,76,99,75,71,73,111,68,70,77,67,115,91,
88,45,48,75,67,74,103,70,139,76,37,57,35,50,69,83,81,76,41,76,
70,87,70,67,78,37,46,79,132,75,40,44,72,67,77,50,98,43,71,71,
37,39,71,41,87,77,38,44,79,82,99,88,107,44,42,83,117,111,103,92,
110,69,83,113,116,45,46,85,78,102,62,82,76,85,93,80,101,82,94,90,
89,74,104,82,35,41,82,91,82,98,87,75,82,85,92,48,107,55,71,91,
93,84,69,112,81,106,75,82,84,84,89,76,73,103,74,84,82,95,87,70,
72,74,116,80,77,87,96,68,85,84,89,78,105,58,77,81,35,58,86,86,
76,81,86,85,85,96,87,64,85,103,100,49,53,40,77,85,93,70,82,72,
99,71,92,91,73,93,97,68,73,76,93,94,101,105,42,53,109,75,41,49,
85,103,102,45,58,111,73,77,79,91,51,69,76,87,74,58,95,85,89,89,
80,93,64,54,116,84,37,57,75,77,83,88,73,101,96,61,53,36,78,80,
100,75,79,75,93,74,94,89,76,79,89,92,84,77,94,75,131,94,47,77,
48,70,77,40,76,61,112,76,100,90,74,81,76,108,90,89,94,90,73,98,
75,107,72,92,69,107,74,81,96,84,82,88,73,80,89,91,91,67,86,83,
82,91,87,73,86,71,102,90,37,114,72,89,105,78,72,76,93,70,105,90,
72,57,113,102,58,77,74,80,78,92,73,88,126,85,109,84,114,70,101,71,
108,75,58,114,105,45,50,73,97,73,40,50,69,82,72,70,73,67,61,70,
72,76,65,76,77,79,66,40,89,86,89,75,61,82,70,67,84,82,76,71,
70,91,76,92,67,54,68,88,75,90,72,101,76,76,69,81,53,122,105,55,
56,118,101,37,97,90,53,122,86,72,50,35,82,69,101,92,70,52,115,69,
106,83,78,74,92,68,107,91,67,57,111,102,62,54,113,70,102,92,77,77,
86,78,85,58,118,92,37,36,83,76,55,124,95,36,101,99,64,98,72,100,
67,93,81,94,67,91,50,124,85,77,75,97,85,75,73,102,70,89,74,98,
70,91,78,96,75,92,71,93,75,88,72,91,55,164,101,101,78,99,43,92,
70,39,72,41,68,78,54,57,67,80,74,66,57,103,75,85,84,70,104,69,
103,78,90,79,71,111,69,104,101,51,73,91,55,112,81,90,94,77,70,89,
56,112,70,98,98,68,53,115,83,81,72,94,70,106,109,54,77,71,75,70,
67,75,100,85,45,71,95,78,145,86,71,86,39,56,88,61,74,48,78,72,
59,76,59,72,96,84,107,84,92,68,62,73,37,52,76,83,56,143,93,114,
75,55,75,130,71,78,44,99,104,110,83,115,77,75,87,78,100,83,117,77,
72,85,60,81,36,90,76,78,75,158,74,107,36,92,86,109,97,79,56,79,
90,77,77,82,85,95,76,93,81,82,55,92,84,50,85,86,76,45,80,101,
78,96,80,63,74,101,81,83,78,84,93,73,82,95,77,82,81,84,93,74,
79,108,76,90,77,81,78,79,75,90,79,63,91,83,54,90,51,87,81,78,
81,74,88,80,86,84,84,84,67,69,89,43,79,68,76,93,85,77,76,96,
90,75,82,98,78,78,74,92,76,90,81,85,75,93,80,102,80,72,74,97,
84,79,78,87,87,79,77,95,78,92,83,74,76,94,76,88,77,97,83,78,
87,84,78,84,80,93,78,83,92,73,95,71,81,89,79,85,81,92,75,89,
79,88,81,91,71,86,79,93,79,103,76,101,109,40,90,98,97,87,80,43,
89,77,78,84,75,88,80,91,77,88,77,109,82,86,82,49,60,91,51,80,
87,80,94,82,62,77,92,82,76,74,89,92,78,77,89,73,95,78,93,79,
81,88,87,83,85,83,82,70,92,80,82,81,89,80,85,78,96,79,99,73,
83,87,71,74,95,83,89,80,78,76,98,79,85,72,51,84,79,72,79,79,
68,100,77,69,75,92,78,89,78,87,90,84,102,71,79,80,81,88,75,86,
82,89,82,79,80,94,73,86,79,89,82,84,71,97,90,53,78,78,73,75,
73,77,72,89,92,77,87,82,58,57,101,85,90,100,76,77,95,76,88,86,
87,77,83,78,88,81,84,78,97,77,81,78,90,93,89,73,86,82,79,76,
99,78,87,91,67,75,104,74,81,68,101,77,90,76,90,67,99,80,92,81,
82,78,89,82,85,74,93,86,89,77,89,76,90,74,93,77,43,89,75,78,
77,67,77,90,82,75,83,61,81,75,112,102,94,63,94,76,78,87,87,75,
82,81,72,96,78,96,78,85,84,78,81,87,81,85,78,89,87,85,98,65,
85,81,84,83,84,85,80,85,94,75,86,91,83,75,75,90,92,79,85,76,
86,81,85,93,81,74,82,85,75,100,81,82,79,83,98,63,113,55,86,87,
113,51,95,80,98,60,79,80,146,127,81,37,80,76,100,92,103,100,81,112,
82,107,115,83,78,97,108,78,105,85,112,85,103,113,91,115,85,105,116,88,
107,35,63,113,112,90,112,38,93,92,129,119,84,103,82,117,39,81,80,110,
127,84,101,81,111,128,90,111,122,81,124,99,129,131,132,112,39,89,100,100,
35,87,121,114,101,106,127,110,121,126,118,96,116,100,114,122,87,130,36,114,
42,84,102,38,93,115,99,37,115,101,112,40,69,114,40,91,36,70,125,120,
100,37,86,109,98,35,87,134,127,36,82,110,127,115,86,123,43,77,92,111,
84,48,79,35,80,83,80,102,87,110,37,80,94,112,43,86,97,122,36,77,
35,64,107,48,87,88,126,39,77,91,46,83,120,92,102,46,92,90,119,94,
117,79,111,121,36,61,122,120,117,92,101,36,90,96,113,112,86,108,87,112,
39,100,91,115,99,109,100,43,77,83,109,57,89,91,114,43,95,94,54,94,
117,93,117,182,142,37,119,158,41,139,181,155,156,35,74,124,36,121,36,105,
133,95,137,35,144,132,36,73,35,232,36,123,36,123,39,113,146,153,132,134,
138,172,160,148,37,116,134,160,39,133,177,178,165,152,144,142,103,124,109,111,
132,135,134,91,125,123,99,117,137,119,107,35,107,39,111,37,102,147,126,112,
131,112,93,70,95,49,167,54,146,42,161,145,150,45,135,129,36,75,43,90,
77,98,70,117,42,93,76,94,70,98,68,84,131,103,129,54,97,68,95,111,
108,141,48,94,77,93,68,84,86,97,66,86,154,181,165,184,215,36,150,162,
35,97,135,119,110,132,50,94,72,86,97,90,67,91,73,107,49,91,77,92,
74,91,74,94,111,108,119,68,98,104,35,70,113,111,101,38,85,165,158,40,
111,127,46,68,57,98,54,93,39,56,85,51,115,36,77,87,84,84,121,53,
67,86,62,95,37,85,56,103,110,82,90,82,40,96,111,90,95,97,55,82,
159,120,118,63,153,89,81,88,44,87,79,135,99,107,37,84,82,89,91,86,
37,81,53,78,92,87,65,86,72,90,145,36,93,60,77,89,97,94,47,53,
89,59,92,45,89,85,44,80,71,83,107,96,52,82,70,95,47,86,101,64,
84,74,66,111,107,60,85,75,62,110,92,72,61,104,84,86,95,64,64,111,
112,45,63,39,76,71,74,81,101,76,97,89,70,58,114,93,78,94,64,56,
35,78,116,50,55,122,108,48,57,121,88,68,57,111,79,89,86,83,88,78,
78,88,72,86,88,87,103,84,62,91,107,83,40,145,103,35,57,40,72,68,
81,83,83,99,71,89,78,82,73,97,77,87,75,90,92,83,94,65,70,100,
81,85,78,87,91,75,75,101,77,83,81,77,93,104,83,59,79,97,92,73,
79,82,84,85,86,98,90,67,77,106,75,107,81,46,70,85,113,53,59,77,
82,76,43,152,111,111,89,66,76,105,75,81,75,147,118,113,77,40,80,92,
93,76,75,93,66,141,111,80,121,47,75,59,79,81,42,80,64,79,80,94,
80,87,91,88,104,59,84,88,90,73,83,80,76,82,55,37,69,76,35,84,
49,78,78,50,146,101,99,84,71,79,76,80,118,76,77,89,42,84,91,101,
51,82,74,89,91,86,81,90,80,93,92,70,56,36,76,93,109,129,74,79,
89,41,77,94,96,51,77,45,69,92,37,114,98,97,43,85,91,81,87,79,
83,72,66,66,84,113,110,90,59,78,84,79,89,79,89,84,83,78,86,88,
117,78,41,64,75,112,92,89,85,92,75,77,83,79,94,79,100,76,83,77,
81,74,74,87,78,110,50,88,78,46,88,68,73,92,88,77,84,90,71,99,
76,84,75,75,70,76,35,112,84,83,125,87,48,56,76,72,79,73,93,87,
87,87,81,72,86,70,108,72,113,94,83,73,72,75,78,78,93,71,95,127,
43,125,62,134,142,40,92,87,75,92,87,75,73,73,73,102,74,89,74,102,
76,86,71,90,78,82,87,109,76,104,74,83,75,78,74,87,76,83,75,101,
88,78,78,81,77,105,77,60,88,101,45,60,102,79,45,74,83,76,97,80,
85,77,95,77,81,77,157,77,79,77,55,89,57,83,87,91,71,74,101,76,
91,73,92,80,78,76,91,70,95,76,92,73,94,72,101,71,87,74,95,87,
99,95,68,71,82,70,100,74,79,50,77,79,71,85,73,77,69,101,71,91,
72,54,87,73,72,90,95,70,53,79,85,69,104,77,83,69,97,73,118,77,
99,69,77,77,41,71,77,62,73,63,85,89,64,74,48,65,62,98,81,104,
102,70,72,89,105,74,65,83,95,40,47,68,82,97,56,56,62,89,60,73,
75,71,68,110,76,113,85,73,86,84,86,85,72,74,109,88,71,70,86,68,
73,110,83,89,95,70,77,81,71,113,82,79,69,101,72,81,98,72,69,64,
73,75,72,49,62,75,77,120,40,106,116,90,82,89,59,52,79,76,69,72,
90,89,126,43,108,56,121,77,99,94,97,93,48,78,35,70,87,41,73,76,
80,86,65,96,78,96,75,83,83,91,54,54,84,72,49,92,104,81,76,69,
89,78,83,88,94,72,74,72,51,88,74,68,83,64,85,69,106,105,65,68,
96,84,75,52,41,83,79,83,114,48,76,132,76,72,82,74,54,86,103,41,
73,56,168,104,89,76,93,86,55,88,82,73,76,74,85,39,76,47,72,81,
43,60,81,44,83,63,75,66,110,92,61,76,60,55,76,95,48,96,89,107,
106,117,67,111,56,110,66,75,96,136,88,102,77,93,94,67,55,123,182,71,
69,109,58,72,104,102,56,53,123,93,76,76,132,75,85,38,44,84,48,77,
46,73,93,56,74,94,75,68,81,71,101,91,77,70,97,83,79,102,73,86,
71,104,77,36,50,77,75,76,86,95,76,75,75,98,73,81,74,65,79,59,
76,85,85,89,64,55,38,75,72,92,80,86,73,98,88,88,72,92,71,100,
72,90,95,67,70,95,54,114,74,93,85,54,54,36,92,69,105,87,90,117,
51,69,89,70,104,73,89,72,100,77,87,73,93,73,73,101,84,75,89,80,
101,71,83,88,88,89,82,69,94,100,57,69,96,53,117,85,75,91,89,82,
84,77,81,73,192,100,99,81,75,76,102,44,74,45,96,82,88,101,97,93,
99,63,75,84,94,74,89,56,71,67,57,77,83,94,56,86,82,79,95,81,
92,107,54,88,85,100,60,82,85,68,39,84,83,97,128,92,88,69,91,79,
85,92,73,90,63,66,110,88,100,109,37,71,68,90,83,103,86,95,38,41,
87,94,111,37,85,89,86,66,81,58,70,82,63,59,91,69,60,73,72,70,
93,76,75,85,91,71,92,94,78,70,129,93,91,183,54,96,100,134,85,38,
83,91,84,60,73,82,85,96,83,93,70,87,82,81,87,83,92,84,92,73,
84,89,91,67,82,91,80,82,82,68,66,76,70,81,95,107,106,74,68,71,
82,122,77,43,106,81,137,95,68,91,92,67,89,73,89,76,117,95,86,71,
63,82,89,44,83,92,80,88,91,87,87,78,84,106,92,74,92,56,99,63,
78,85,106,53,92,82,97,73,78,84,77,73,76,89,74,91,72,96,96,84,
85,82,109,60,84,84,97,73,88,82,100,60,89,92,83,92,140,83,89,131,
89,89,116,91,95,55,83,93,86,78,81,85,89,73,82,84,95,58,57,92,
86,93,36,87,131,84,70,49,83,99,53,77,86,87,77,92,94,101,65,96,
85,88,60,49,91,70,117,123,84,118,76,146,102,113,91,89,41,109,88,82,
90,140,81,43,62,85,79,118,74,95,96,86,85,76,91,35,87,80,87,112,
91,83,71,97,90,83,85,85,78,85,86,77,87,80,81,94,79,83,96,73,
85,87,85,81,80,78,94,56,90,139,105,61,91,116,108,73,85,87,42,83,
133,105,39,66,85,76,69,58,62,58,63,97,46,87,84,95,90,90,87,100,
55,85,64,90,37,80,87,71,69,99,94,59,117,58,98,70,98,89,84,85,
80,91,92,89,69,83,77,83,89,85,76,102,54,90,144,103,77,86,84,80,
93,90,81,98,86,84,94,84,75,86,85,88,99,99,98,47,105,83,107,79,
86,69,52,75,75,84,98,67,87,88,80,61,79,82,77,108,132,94,110,41,
88,114,88,57,70,75,94,55,72,95,84,73,85,89,83,80,86,76,81,84,
86,83,98,52,107,141,90,136,88,83,93,122,84,50,90,88,46,101,95,72,
68,87,87,76,86,106,68,88,83,83,86,95,68,96,89,84,91,69,88,91,
68,74,88,73,101,106,51,96,68,71,78,100,89,109,35,58,60,70,73,78,
68,86,96,64,86,89,80,119,79,71,88,77,44,93,107,145,85,102,56,114,
85,92,59,84,68,84,61,86,91,83,82,95,76,85,80,83,64,74,44,83,
69,92,95,47,89,82,92,71,86,85,107,66,86,126,84,91,84,116,42,81,
95,61,104,62,102,97,86,97,81,90,88,55,90,85,68,84,94,51,115,53,
61,77,95,48,72,104,69,77,60,52,110,110,75,95,142,87,56,102,86,83,
77,146,95,83,90,89,64,82,77,96,93,137,69,193,75,91,45,63,83,69,
83,76,81,93,85,95,100,60,87,64,80,88,97,73,83,87,95,48,76,81,
71,40,73,76,84,88,118,96,132,93,72,81,76,92,85,143,94,74,110,84,
103,93,82,99,94,94,69,55,76,88,93,101,58,87,71,90
];
/** 轨迹序列(去 init;tier@callbackIndex) */
const tierSeq = (tiers: { i: number; tier: number; reason: string }[]) =>
  tierChanges(tiers).filter((x) => !(x.tier === 120 && x.reason === 'init')).map((x) => `${x.tier}@${x.i}`);
/** 末次升档事件 index(无则 -1) */
const lastUpgradeIdx = (tiers: { i: number; tier: number; reason: string }[]) => {
  const ch = tierChanges(tiers);   // 扫去重轨迹(原始帧的 lastReason 事件后驻留,直扫会抓尾帧)
  for (let i = ch.length - 1; i >= 0; i--) if (ch[i].reason === 'upgrade') return ch[i].i;
  return -1;
};
describe('★v9.13 旗关世界锁(方差判据;底档=60)', () => {
  afterEach(() => { varAdaptSetForTest(false); });

  it('旗关:语料 A 级联止于 60(轨迹无 30;底档本相;6 窗升档线在粗糙 60 段不可达)', () => {
    varAdaptSetForTest(false);
    const r = driveDeltas(WIN_A_DELTAS_X10.map((v) => v / 10), 120);
    const seq = tierSeq(r.tiers);
    expect(seq).toEqual(['90@178', '60@304']);   // 60 档粗糙段驻留(旧轨迹 30@484 坠底不再存在)
    expect(lastUpgradeIdx(r.tiers)).toBe(-1);   // 旗关升不了=v9.12 时代靠坠 30 才升得上去
    expect(r.beat.snapshot().tier).toBe(60);
  });

  it('旗关:语料 B 粗糙段止于 60 驻留(无 upgrade=不虚升,诚实面)', () => {
    varAdaptSetForTest(false);
    const off = driveDeltas(WIN_B_DELTAS_X10.map((v) => v / 10), 120);
    expect(tierSeq(off.tiers)).toEqual(['90@178', '60@452']);
    expect(lastUpgradeIdx(off.tiers)).toBe(-1);
  });

  it('旗关:Mac 语料(WIN_C)止于 60 驻留(v9.13 前 30 粘死 93%——阶梯结构化根除)', () => {
    varAdaptSetForTest(false);
    const off = driveDeltas(WIN_C_DELTAS_X10.map((v) => v / 10), 120);
    expect(tierChanges(off.tiers).some((x) => x.tier === 30)).toBe(false);
    expect(off.beat.snapshot().tier).toBe(60);
  });
});

describe('★v9.14 容量判据(?varadapt=1;用户明令「尽量贴近帧率上限;除非帧率压根跑不到上限才降档」)', () => {
  afterEach(() => { varAdaptSetForTest(false); });

  it('空转机贴上限:Mac WIN_C 全程驻留 120 零迁移;Windows WIN_A/WIN_B 入场重载段降档后探顶回升(终态 120)', () => {
    varAdaptSetForTest(true);
    const rc = driveDeltas(WIN_C_DELTAS_X10.map((v) => v / 10), 120);
    expect(tierChanges(rc.tiers).filter((x) => x.tier !== 120).length).toBe(0);   // 空转局零迁移
    expect(rc.beat.snapshot().tier).toBe(120);
    for (const [name, c] of [['WIN_A', WIN_A_DELTAS_X10], ['WIN_B', WIN_B_DELTAS_X10]] as const) {
      const r = driveDeltas(c.map((v) => v / 10), 120);
      expect(r.beat.snapshot().tier, name).toBe(120);                              // 终态=cap(入场真重载降过也回升)
      expect(lastUpgradeIdx(r.tiers), name).toBeGreaterThan(0);                    // 回升=探顶成功
    }
  });

  it('宽流同贴上限:T114436/LIVE/双峰 全程驻留 120(realized≥0.97 线)', () => {
    varAdaptSetForTest(true);
    const corpus = T114436_DELTAS_X10.map((v) => v / 10);
    const t114 = driveDeltas([...corpus, ...corpus], 120);
    expect(t114.beat.snapshot().tier).toBe(120);
    expect(tierChanges(t114.tiers).filter((x) => x.tier !== 120).length).toBe(0);
    const live = driveDeltas(LIVE_DELTAS_X10.map((v) => v / 10), 120);
    expect(tierChanges(live.tiers).filter((x) => x.tier !== 120).length).toBe(0);
    const bim = driveDeltas(makeBimodal(4800, 11), 120);
    expect(bim.beat.snapshot().tier).toBe(120);
    expect(tierChanges(bim.tiers).filter((x) => x.tier !== 120).length).toBe(0);
  });

  it('真容量不足降阶梯:render-bound 帧耗 25ms → [120,90,60] 落底(runBeat busy 模型)', () => {
    varAdaptSetForTest(true);
    const r = runBeat({ vsync: HZ120, cap: 120, cost: 25, callbacks: 3000 });
    expect(tierChanges(r.tiers).map((x) => x.tier)).toEqual([120, 90, 60]);
    const st = gapStats(r.rendered.slice(-600));
    expect(st.mean).toBeGreaterThan(24);                    // 落底后帧距=帧耗本相(读数诚实 ~40fps)
  });

  it('帧耗 10ms 机:驻留 120 交付 ~100fps([0.80,0.97) 中带=贴近上限本意)', () => {
    varAdaptSetForTest(true);
    const r = runBeat({ vsync: HZ120, cap: 120, cost: 10, callbacks: 3000 });
    expect(r.beat.snapshot().tier).toBe(120);
    expect(tierChanges(r.tiers).filter((x) => x.tier !== 120).length).toBe(0);
  });

  it('帧耗 12ms 机:降 90 驻留(~83fps 读数诚实;0.97 线不可达=零探针循环)', () => {
    varAdaptSetForTest(true);
    const r = runBeat({ vsync: HZ120, cap: 120, cost: 12, callbacks: 3000 });
    expect(tierChanges(r.tiers).map((x) => x.tier)).toEqual([120, 90]);
    expect(r.beat.snapshot().tier).toBe(90);
  });

  it('容量恢复探顶:前段帧耗 25ms 落 60 → 后段 3ms → 探回 120', () => {
    varAdaptSetForTest(true);
    const r = runBeat({ vsync: HZ120, cap: 120, cost: (i) => (i < 900 ? 25 : 3), callbacks: 3600 });
    const seq = tierChanges(r.tiers).map((x) => x.tier);
    expect(seq[0]).toBe(120);
    expect(seq).toContain(60);
    expect(r.beat.snapshot().tier).toBe(120);
  });

  it('变异证红:摘容量降档(NoRealizedDownBeat)→ render-bound 滞留 120', () => {
    varAdaptSetForTest(true);
    class NoRealizedDownBeat extends FrameBeat {
      protected override realizedDownRatio(): number { return 0; }
    }
    const r = runBeat({ vsync: HZ120, cap: 120, cost: 25, callbacks: 3000, make: () => new NoRealizedDownBeat() });
    expect(r.beat.snapshot().tier).toBe(120);
  });

  it('变异证红:摘升档探针(NoRealizedUpBeat)→ 容量恢复后滞留 60', () => {
    varAdaptSetForTest(true);
    class NoRealizedUpBeat extends FrameBeat {
      protected override realizedUpRatio(): number { return 2; }
    }
    const r = runBeat({ vsync: HZ120, cap: 120, cost: (i) => (i < 900 ? 25 : 3), callbacks: 3600, make: () => new NoRealizedUpBeat() });
    expect(r.beat.snapshot().tier).toBe(60);
  });
});
