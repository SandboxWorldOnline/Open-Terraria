// ★C9 光照引擎 Worker 化·快照协议（2026-09-23;?lightworker=1 缺省关）。
// ★债登记（2026-09-25 trace:主线程残部 2-4% 恒在=TileLightScanner.exportTo/
//  blurLine 内联段）——C9 二期差量面:exportTo/blurLine 全量迁 worker（沿本文件
//  快照协议;scanner.reseed 掷流史与 FlickerClock 类随机源已登记的残余分歧面照抄）。
// 主线程每帧把「扫描窗 ± SNAPSHOT_PAD 的 tile 切片 + 相机/天空/时钟/点光参数」
// postMessage 给 LightWorker;worker 侧用同一份内核模块（TileLightScanner/LightMap/
// LightingEngine 零转录导入）在一个「快照 store」上跑 scan→blur→export,回传
// lightR/G/B（transferable）。
//
// ---- 快照 store 的坐标方案（内核零改动的前提） ----
// 内核对 tile store 的读法有两种：① st.idx(x,y) / st.inBounds / st.inWorld1
//（surfaceSky/hellSky/specialTileLight ctx）;② exportTo 热循环内联
// `rowBase = ty * st.w; i = rowBase + tx`（2026-09-19 热路径重排的产物,不改）。
// 因此切片不能做「索引重映射」（②会把世界坐标乘上切片宽度）,而采用**窗口 rebase**：
// worker 的 store 就是切片本身（w=sw, h=sh, idx(x',y')=y'*sw+x'）,扫描区域原点
// 平移进切片内 (px,py)=钳后 padding,世界标量按行/列平移（groundLevel/lavaLine −sy、
// 点光坐标 −sx/−sy）。可证与本地路径逐位同值的部分：
//   · InWorld(x,y,1) 外圈折叠：exportTo 的 lxLo/lxHi 由 rx 与 st.w 推出——worker 侧
//     rx'=px（钳后 padding）恰好编码了「区域到世界边缘的距离」：区域贴边 ⟺ px=0
//     ⟺ 折叠跳过首列/末列,与本地绝对坐标折叠逐格同集合（世界最外圈不扫描）。
//   · 天空/地狱行判定：surface = ty' <= groundLevel−sy,与绝对判定同值。
//   · shimmerBaseColor / localRandom 的坐标哈希：非平移不变——worker 侧给引擎的
//     FlickerClock/scanner 打 **坐标平移 shim**（见 applySnapshotToEngine）,把 rebase
//     坐标还原成绝对坐标再喂内核公式,同种子下位级可对拍（tests/light-worker-parity）。
// 残余混沌类分歧（与 C8 波场 Worker 同判例,生产态不可消除,逐项登记）：
//   a) FastRandom 种子链随实例调用史演化（scanner.reseed 每 exportTo 推进一步,
//      主/worker 调用节奏不同）;b) LightMap 水 flicker 种子 = Math.random（构造期）;
//   c) FlickerClock 水母笼 3×25 态机 = Math.random（不随快照恢复）;
//   d) specialTileLight case 719/316-318 直接消费 ctx.x/y（必须保持 rebase 值供
//      store 索引）→ 彩虹云色相/水母笼槽位随相机平移漂移（纯装饰、低幅）。
//
// ---- 切片窗口 = 扫描区域 ± SNAPSHOT_PAD ----
// 内核对「区域外」数据的三类触达：① surfaceSky/hellSky 的 ±1 邻格液体读（条件支路）;
// ② 718 星云的上邻格;③ 171 圣诞灯 origin 回溯（frameX<10 → 9 列 + frameY 行距
// ≤15）。SNAPSHOT_PAD=16 覆盖全部三类;切片再被世界边界钳制,钳后余量 (px,py) 就是
// worker 的区域原点（见上——折叠精确性依赖这一点）。
import type { LightingEngine } from './LightingEngine';
import type { AuroraFrameState, BiomeInfluence, FlickerClock } from './SkyColor';
import type { PerFrameLight } from './TileLightScanner';
import { updateLightDecay } from './lightTables';
import {
  getSkyFrameState, setFrameAtmo, setFrameAurora, setFrameBiome, setFrameCloudDim,
  setFrameDontStarve, setFrameHorizon, setFrameLightning, setFrameRemix,
} from './SkyColor';

/** 切片外扩（tile）。≥1 覆盖 surfaceSky/hellSky 邻格;≥16 覆盖 171 圣诞灯 origin 回溯
 *  （frameX<10 → 9 列;frameY 行距 ≤15）。>16 行高的巨树灯 origin 落切片外 = 有界
 *  边缘案例（灯在区域外圈 padding 带、贡献经 ≥28 格 blur 衰减 ≈7%,亚感知）,登记。 */
export const SNAPSHOT_PAD = 16;

/** 2s 失联看门狗（承 C8 WaveWorker 语义） */
export const LIGHT_WATCHDOG_MS = 2000;

// ---- 消息形状（type-only;运行时按此对齐,同 src/workers/protocol.ts 惯例） ----

/** worker 侧 SkyColor 模块级帧状态（getSkyFrameState 捕获 → applySkyFrameState 重放） */
export interface SkyFrameState {
  cloudDim: number;
  biome: BiomeInfluence | null;
  horizon: { sunrise: number; sunset: number; phase: number } | null;
  remixWorld: boolean;
  remixBlackSky: boolean;
  dontStarve: boolean;
  lightning: number;
  atmo: number;
  aurora: AuroraFrameState | null;
}

/** Game 每帧 updateLightDecay 实参（worker 按同参重放 → DECAY_AIR/SOLID/WATER 与
 *  globalBrightness、shimmerAlpha/shimmerDarken/shimmerWaterAlpha、sceneAir·SolidDecay
 *  状态机 1:1 演化——lightTables 模块级状态无外部 setter,重放是唯一同步口） */
export interface DecayArgs {
  waterStyle: number;
  nightVision: boolean;
  blackout: boolean;
  blind: boolean;
  opts: { headcovered?: boolean; inShimmer?: boolean; ftwDecay?: 'queen' | 'temple' | 'dungeon' };
}

/** FlickerClock pre-tick 状态快照（私有 dir 字段经 Record 通道捕获/恢复;
 *  水母笼态机不恢复=混沌类 c） */
export interface FlickerState {
  mt: number; mtd: number;      // mouseTextColor / mouseDir
  ca: number; cad: number;      // cursorAlpha / cursorDir
  dt: number; dtd: number;      // demonTorch / demonDir
  dr: number; dg: number; db: number; dss: number;   // disco 三通道 / discoStyle
  es: number; esd: number;      // essScale / essDir
  mc: number; mcd: number;      // masterColor / masterColorDir
  tve: number;                  // timeForVisualEffects
}

/** 13 通道切片包（行主序、宽 sw;主线程侧从世界数组按行复制,postMessage 结构克隆） */
export interface TileSlicePack {
  sx: number; sy: number; sw: number; sh: number;   // 切片窗口（世界 tile 坐标）
  px: number; py: number;                            // 区域原点在切片内 = 钳后 padding
  type: Uint16Array; flags: Uint8Array;
  frameX: Uint16Array; frameY: Uint16Array;
  wall: Uint16Array; liquid: Uint8Array; liquidType: Uint8Array;
  half: Uint8Array; slope: Uint8Array; wire: Uint8Array;
  paint: Uint8Array; paintWall: Uint8Array; coat: Uint8Array;
  showInvisibleBlocks: boolean;
}

/** main→worker 每帧快照 */
export interface LightSnapshotMsg {
  op: 'frame';
  seq: number;
  /** 绝对扫描区域（= 引擎 ensureRegion 现值;回显于结果供主线程回填公共面） */
  rx: number; ry: number; rw: number; rh: number;
  /** 世界标量（绝对值;worker 侧 rebase） */
  groundLevel: number; lavaLine: number;
  clock: { timeOfDay: number; dayCount: number; eclipse: boolean; bloodMoon: boolean; moonPhase: number; isDay: boolean };
  sundial: number; moondial: number; raining: boolean;
  sky: SkyFrameState;
  decay: DecayArgs | null;
  flicker: FlickerState;
  /** 主线程 Main.GlobalTimeWrappedHourly 同步值（worker perf.now 时间原点不同） */
  hourly: number;
  /** 点光（绝对 tile 坐标;[tx,ty,r,g,b]） */
  held: [number, number, number, number, number] | null;
  buffs: number[][];
  per: number[][];
  tiles: TileSlicePack;
  /** ★C9d2 二期差量（?lightdelta=1 灰度）:undefined=legacy 全量（非灰度模式,
   *  tile 通道走 transferable+回池）; 'full'=灰度全量锚帧（★2026-10-04 起同款
   *  transferable+回池,主线程不留内容影子）; 'delta'=差量帧（tiles 仅几何字段,
   *  通道零长;载荷在 delta） */
  enc?: 'full' | 'delta';
  /** enc='delta' 载荷:meta=[跨度数,(y',x0',len)…]（u32,切片内局部坐标）,
   *  data=每跨度逐格 17B（type/flags/frameX/frameY/wall 各 LE 2B,其余 9 通道各 1B）。
   *  ★债2 池化（2026-10-04）:meta/data=编码器整块 scratch（transfer 过境,零 slice
   *  拷贝零分配）,实际有效长度由 metaLen/dataLen 携带;缺省=数组全长（兼容精确
   *  尺寸构造面——单测直接喂 exact 数组时行为与旧协议逐位同）。 */
  delta?: { dv: number; meta: Uint32Array; data: Uint8Array; metaLen?: number; dataLen?: number };
  /** ★债3 池化（2026-10-04）:主线程退役结果数组随帧回送 worker（transfer 零拷贝）。
   *  仅在 retire 队列非空时在场——退役点恒为「引用替换后不再被公共面/pending 持有」
   *  的数组,worker 侧入结果池供发布面取用（与 tile 'pool' 回传同范式的反向通道）。 */
  ret?: ResultTriple[];
}

/** 结果数组三元组（worker 发布面分配/主线程退役回送共用形状） */
export interface ResultTriple { R: Uint8Array; G: Uint8Array; B: Uint8Array }

/** ★C9d2 worker→main tile 缓冲回池（legacy 全量帧直回;★2026-10-04 起 'full' 锚帧
 *  解码器退役缓冲同通道回传——transfer 往返使主线程 buildSlice 零重分配。compute
 *  完毕后 worker 不再读 tile 通道（退役包恒非 store 当前内容）,回传安全） */
export interface LightPoolMsg { op: 'pool'; seq: number; tiles: TileSlicePack }

/** ★C9d2 worker 侧影子缺失/尺寸失配（防御面:正常由 planFull 保证不触发）→
 *  主线程下帧强制全量 */
export interface LightResyncMsg { op: 'resync' }

/** worker→main 结果（R/G/B transferable;rx/ry 绝对区域,主线程整体回填公共面）。
 *  ★债2/债3 池化（2026-10-04）:retDelta=delta 帧解码完毕的 meta/data 缓冲原样回送
 *  （transfer,主线程编码器 scratch 池复用）;rp=worker 结果池对账计数（累计 take/miss）。 */
export interface LightResultMsg {
  op: 'light';
  seq: number;
  rx: number; ry: number; rw: number; rh: number;
  R: Uint8Array; G: Uint8Array; B: Uint8Array;
  retDelta?: { meta: Uint32Array; data: Uint8Array };
  rp?: { t: number; m: number };
}

/** worker 致命错误通知（主线程立即回落,不等 2s 看门狗） */
export interface LightErrorMsg { op: 'error'; message: string }

// ---- 快照 store（worker 侧;内核以 TileStore 结构最小面直接消费,见头注） ----

/** 内核读表面（TileLightScanner 全链 + 引擎）逐字段对齐的窗口 store。
 *  写面不存在——快照只读,每帧整体 adopt 替换通道引用（postMessage 克隆产物直接持有,
 *  worker 侧零拷贝零重分配）。onTileChanged/onLiquidChanged 空实现供引擎构造器订阅。 */
export class SnapshotTileStore {
  w = 0; h = 0;
  showInvisibleBlocks = false;
  // 通道显式松型标注（Uint16Array 缺省 = ArrayBufferLike 视图域;adopt 每帧换引用,
  //  来源含结构克隆产物,不能钉成 <ArrayBuffer>）
  type: Uint16Array = new Uint16Array(0);
  flags: Uint8Array = new Uint8Array(0);
  frameX: Uint16Array = new Uint16Array(0);
  frameY: Uint16Array = new Uint16Array(0);
  wall: Uint16Array = new Uint16Array(0);
  liquid: Uint8Array = new Uint8Array(0);
  liquidType: Uint8Array = new Uint8Array(0);
  half: Uint8Array = new Uint8Array(0);
  slope: Uint8Array = new Uint8Array(0);
  wire: Uint8Array = new Uint8Array(0);
  paint: Uint8Array = new Uint8Array(0);
  paintWall: Uint8Array = new Uint8Array(0);
  coat: Uint8Array = new Uint8Array(0);

  adopt(t: TileSlicePack): void {
    this.w = t.sw; this.h = t.sh;
    this.showInvisibleBlocks = t.showInvisibleBlocks;
    this.type = t.type; this.flags = t.flags;
    this.frameX = t.frameX; this.frameY = t.frameY;
    this.wall = t.wall; this.liquid = t.liquid; this.liquidType = t.liquidType;
    this.half = t.half; this.slope = t.slope; this.wire = t.wire;
    this.paint = t.paint; this.paintWall = t.paintWall; this.coat = t.coat;
  }

  idx(x: number, y: number): number { return y * this.w + x; }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  /** 原版 InWorld(x,y,1)——与 TileStore.inWorld1 同式（对切片尺寸取语义） */
  inWorld1(x: number, y: number): boolean { return x >= 1 && y >= 1 && x < this.w - 1 && y < this.h - 1; }
  onTileChanged(_fn: (x: number, y: number) => void): void { /* 快照 store 无写入面 */ }
  onLiquidChanged(_fn: (x: number, y: number) => void): void { /* 同上 */ }
}

// ---- 快照装配（主线程侧;引擎 buildWorkerSnapshot 与对拍测试共用同一条代码路径） ----

/** 引擎捕获视图（LightingEngine 的结构最小面;测试可直接喂真实引擎实例） */
export interface EngineCaptureView {
  rx: number; ry: number; rw: number; rh: number;
  world: { groundLevel: number; lavaLine: number; clock: { timeOfDay: number; dayCount: number } };
  flicker: FlickerClock;
  heldLight: { tx: number; ty: number; r: number; g: number; b: number } | null;
  buffLights: Array<{ tx: number; ty: number; r: number; g: number; b: number }>;
  perFrame: PerFrameLight[];
  decay: DecayArgs | null;
}

/** 组装每帧快照消息。tiles 由调用方（LightWorkerLink.buildSlice）先行切好;
 *  时钟取 pre-tick 状态（worker 侧 compute 的 tick 恰好推进到主线程 scan 时的状态）。 */
export function buildEngineSnapshot(cap: EngineCaptureView, tiles: TileSlicePack, seq: number): LightSnapshotMsg {
  const wc = cap.world.clock as { timeOfDay: number; dayCount: number; eclipse?: boolean; bloodMoon?: boolean; moonPhase?: number; isDay?: boolean };
  const w = cap.world as { sundialCooldown?: number; moondialCooldown?: number; weather?: { raining?: boolean } };
  const f = cap.flicker as unknown as Record<string, number>;
  const hourly = cap.flicker.globalTimeWrappedHourly;   // 经 getter 读（测试可钉）
  return {
    op: 'frame',
    seq,
    rx: cap.rx, ry: cap.ry, rw: cap.rw, rh: cap.rh,
    groundLevel: cap.world.groundLevel, lavaLine: cap.world.lavaLine,
    clock: {
      timeOfDay: wc.timeOfDay, dayCount: wc.dayCount,
      eclipse: wc.eclipse === true, bloodMoon: wc.bloodMoon === true,
      moonPhase: wc.moonPhase ?? 0, isDay: wc.isDay !== false,
    },
    sundial: w.sundialCooldown ?? 0,
    moondial: w.moondialCooldown ?? 0,
    raining: w.weather?.raining === true,
    sky: getSkyFrameState(),
    decay: cap.decay,
    flicker: {
      mt: f.mouseTextColor, mtd: f.mouseDir,
      ca: f.cursorAlpha, cad: f.cursorDir,
      dt: f.demonTorch, dtd: f.demonDir,
      dr: f.discoR, dg: f.discoG, db: f.discoB, dss: f.discoStyle,
      es: f.essScale, esd: f.essDir,
      mc: f.masterColor, mcd: f.masterColorDir,
      tve: f.timeForVisualEffects,
    },
    hourly,
    held: cap.heldLight ? [cap.heldLight.tx, cap.heldLight.ty, cap.heldLight.r, cap.heldLight.g, cap.heldLight.b] : null,
    buffs: cap.buffLights.map((l) => [l.tx, l.ty, l.r, l.g, l.b]),
    per: cap.perFrame.map((l) => [l.x, l.y, l.r, l.g, l.b]),
    tiles,
  };
}

/** ★稳态指纹（任务#26 常驻债#1 收口,2026-10-27）：与 buildEngineSnapshot 同源的
 *  【除恒动面】输入摘要——恒动面 = clock.timeOfDay / flicker 全族 / hourly（振荡器
 *  与昼夜推进,每 tick 必变,不进门、随实发拍到达;稳态呈现节拍 60→15Hz = 本地引擎
 *  稳态 4-tick 周期（原版 4 帧节奏）同款口径）。返回确定性 JSON 串（键序=字面量
 *  构造序恒定）,调用方与上次实发指纹逐位比较。tile/liquid 原语写不整面进指纹,
 *  只进【快照切片窗内】的写日志格数（窗=sliceGeometry 同款 ±SNAPSHOT_PAD 数学,
 *  与 worker 可见面精确同界）——窗外写（世界演化/远处液体沉降,实测 idle 主源=
 *  植被生长 type309 窗外写每 ~2.8 tick 一发）不影响结果,不破稳态。未记账直写面
 *  （TileStore 头注登记债:crater/hardmode 渐进/联机 strip）不进指纹——靠「下次
 *  实发(≤3 拍后)内容脏门全量锚」自愈=有界陈旧,lwbp 同族语义（跳=延迟非丢失）。
 *  ★新增快照字段【必须】同步入此指纹——漏记=稳态门对已变输入误判未变=陈旧光;
 *  tests/light-steady-gate 键集锚定防漂移。 */
export function buildSteadyFingerprint(cap: EngineCaptureView, inWinLog: number): string {
  const wc = cap.world.clock as { timeOfDay: number; dayCount: number; eclipse?: boolean; bloodMoon?: boolean; moonPhase?: number; isDay?: boolean };
  const w = cap.world as { sundialCooldown?: number; moondialCooldown?: number; weather?: { raining?: boolean } };
  return JSON.stringify({
    rx: cap.rx, ry: cap.ry, rw: cap.rw, rh: cap.rh,
    groundLevel: cap.world.groundLevel, lavaLine: cap.world.lavaLine,
    dayCount: wc.dayCount, eclipse: wc.eclipse === true, bloodMoon: wc.bloodMoon === true,
    moonPhase: wc.moonPhase ?? 0, isDay: wc.isDay !== false,
    sundial: w.sundialCooldown ?? 0, moondial: w.moondialCooldown ?? 0,
    raining: w.weather?.raining === true,
    sky: getSkyFrameState(),
    decay: cap.decay,
    held: cap.heldLight, buffs: cap.buffLights, per: cap.perFrame,
    inWinLog,
  });
}

// ---- worker 侧驱动（LightWorker.ts 薄壳调用;对拍测试直接调本函数=同一条代码路径） ----

/** worker 侧持久驱动状态（shim 偏移/时钟同步值——每帧消息更新） */
export interface WorkerDriveState {
  off: { sx: number; sy: number };
  hourly: number;
  shimmed: boolean;
  /** ★C9d2 差量解码器（工厂即建——resync 门在 runSnapshotOnEngine 之前消费;
   *  legacy 帧解码器 adopt-through 不维护影子,零行为影响） */
  deltaDec: LightDeltaDecoder;
}

export function createWorkerDriveState(): WorkerDriveState {
  return { off: { sx: 0, sy: 0 }, hourly: 0, shimmed: false, deltaDec: new LightDeltaDecoder() };
}

/** SkyColor 模块级帧状态重放（worker 模块实例与主线程分立,setter 为唯一写口） */
function applySkyFrameState(s: SkyFrameState): void {
  setFrameCloudDim(s.cloudDim);
  setFrameBiome(s.biome);
  setFrameRemix(s.remixWorld, s.remixBlackSky);
  setFrameDontStarve(s.dontStarve);
  setFrameLightning(s.lightning);
  setFrameAtmo(s.atmo);
  setFrameHorizon(s.horizon);
  setFrameAurora(s.aurora);
}

/** FlickerClock pre-tick 状态恢复（私有 dir 字段经 Record 通道;水母笼态机不恢复） */
function restoreFlicker(fk: FlickerClock, s: FlickerState): void {
  const f = fk as unknown as Record<string, number>;
  f.mouseTextColor = s.mt; f.mouseDir = s.mtd;
  f.cursorAlpha = s.ca; f.cursorDir = s.cad;
  f.demonTorch = s.dt; f.demonDir = s.dtd;
  f.discoR = s.dr; f.discoG = s.dg; f.discoB = s.db; f.discoStyle = s.dss;
  f.essScale = s.es; f.essDir = s.esd;
  f.masterColor = s.mc; f.masterColorDir = s.mcd;
  f.timeForVisualEffects = s.tve;
}

/** 一次性 shim 安装：rebase 坐标 → 绝对坐标的平移补偿（内核公式零改动,见头注）。
 *  · shimmerBaseColor：波相位 = (x+y/6)/10,世界锚定——不补偿会随相机平移游移。
 *  · scanner.localRandom：RNG 哈希 (y*2654435761+x)|0 非平移不变——不补偿则每个
 *    闪烁随机元随 rebase 重掷（生产态同种子序列下与本地路径位级可比的保证,
 *    tests/light-worker-parity 锁定;种子链节奏差=混沌类 a,不受本 shim 影响）。
 *  · globalTimeWrappedHourly：worker performance.now 时间原点 ≠ 主线程——每帧同步值
 *    以实例自有属性遮蔽原型 getter（金标测试同款手法）。 */
function installClockShims(e: LightingEngine, fk: FlickerClock, ds: WorkerDriveState): void {
  const baseShimmer = fk.shimmerBaseColor;
  fk.shimmerBaseColor = (x: number, y: number) => baseShimmer.call(fk, x + ds.off.sx, y + ds.off.sy);
  const sc = (e as unknown as { scanner: { localRandom: (x: number, y: number) => unknown; random: { getSeed(): number } } }).scanner;
  const origLocalRandom = sc.localRandom.bind(sc);
  sc.localRandom = (x: number, y: number) => origLocalRandom(x + ds.off.sx, y + ds.off.sy);
  Object.defineProperty(fk, 'globalTimeWrappedHourly', { get: () => ds.hourly, configurable: true });
}

/** 应用一帧快照到 worker 侧镜像引擎并跑完整 Scan→Blur→Present 周期。
 *  返回结果负载（R/G/B 为引擎新分配数组,调用方 postMessage transfer）。
 *  ★C9d2:enc='delta' 帧先经 LightDeltaDecoder 从影子差量重建完整切片再 adopt
 *  （legacy/'full' 帧解码器 adopt-through,影子仅在灰度模式维护）。 */
export function runSnapshotOnEngine(e: LightingEngine, m: LightSnapshotMsg, ds: WorkerDriveState): { rx: number; ry: number; rw: number; rh: number; R: Uint8Array; G: Uint8Array; B: Uint8Array } {
  // ① tile 窗口（通道引用整体替换,零拷贝;delta 帧重建产物同面）
  const st = e.world.store as unknown as SnapshotTileStore;
  st.adopt(ds.deltaDec.decode(m));
  // ② 世界标量 rebase（行/列平移,见头注）
  e.world.groundLevel = m.groundLevel - m.tiles.sy;
  e.world.lavaLine = m.lavaLine - m.tiles.sy;
  // ★scan 核 RNG 哈希锚(2026-10-04 WASM 第四刀):切片 store(0,0) 的绝对世界坐标
  // ——localRandom 哈希 (y*2654435761+x)|0 非平移不变,AS 主循环(hashX0/Y0 形参)
  // 与 JS 尾段(localRandom shim)必须同锚,否则每个闪烁随机元随 rebase 重掷
  // （与既有 localRandom shim 同源同值;主线程世界 store 不设=0,0）。
  (e.world as { hashOrigin?: { x: number; y: number } }).hashOrigin = { x: m.tiles.sx, y: m.tiles.sy };
  const clk: { timeOfDay: number; dayCount: number; eclipse?: boolean; bloodMoon?: boolean; moonPhase?: number; isDay?: boolean } = {
    timeOfDay: m.clock.timeOfDay, dayCount: m.clock.dayCount,
    eclipse: m.clock.eclipse, bloodMoon: m.clock.bloodMoon,
    moonPhase: m.clock.moonPhase, isDay: m.clock.isDay,
  };
  e.world.clock = clk;
  const wx = e.world as { sundialCooldown?: number; moondialCooldown?: number; weather?: { raining?: boolean } };
  wx.sundialCooldown = m.sundial;
  wx.moondialCooldown = m.moondial;
  wx.weather = { raining: m.raining };
  // ③ 天空帧状态 + 衰减表（worker 模块实例状态同步;顺序=主线程 decay→compute 同构）
  applySkyFrameState(m.sky);
  if (m.decay) updateLightDecay(m.decay.waterStyle, m.decay.nightVision, m.decay.blackout, m.decay.blind, m.decay.opts);
  // ④ 闪烁时钟：pre-tick 状态恢复 + shim（compute 内 tick 推进到主线程 scan 同态）
  const fk = (e as unknown as { flicker: FlickerClock }).flicker;
  restoreFlicker(fk, m.flicker);
  ds.off.sx = m.tiles.sx; ds.off.sy = m.tiles.sy;
  ds.hourly = m.hourly;
  if (!ds.shimmed) { installClockShims(e, fk, ds); ds.shimmed = true; }
  // ⑤ 区域（切片内坐标）——★C9d(2026-09-27)：写【快照面】（镜像引擎不走
  //    ensureRegion,公共面直写已删——发布面按快照尺寸分配输出数组;上一帧 R/G/B
  //    已 transfer 走 → detached 后 length=0 → 发布面每帧自动重分配,与旧
  //    「每帧 new Uint8Array」分配面等价）
  e.setSnapshotRegion(m.tiles.px, m.tiles.py, m.rw, m.rh);
  // ⑥ 点光（坐标 rebase）+ 脏标（快照模式每帧全量重扫,v1 不做脏标优化）
  e.heldLight = m.held ? { tx: m.held[0] - m.tiles.sx, ty: m.held[1] - m.tiles.sy, r: m.held[2], g: m.held[3], b: m.held[4] } : null;
  e.buffLights = m.buffs.map((a) => ({ tx: a[0] - m.tiles.sx, ty: a[1] - m.tiles.sy, r: a[2], g: a[3], b: a[4] }));
  e.dirty = true;
  e.liquidDirty = false;
  for (const p of m.per) e.addLight(p[0] - m.tiles.sx, p[1] - m.tiles.sy, p[2], p[3], p[4]);
  // ⑦ 完整周期（compute → tick → runFullCycle → scan/blur/present）
  e.compute(0);
  return { rx: m.rx, ry: m.ry, rw: m.rw, rh: m.rh, R: e.r, G: e.g, B: e.b };
}

// ---- ★C9 二期·快照差量化（2026-09-28;?lightdelta=1 缺省关,用户明令灰度） ----
// 判据链（scripts/_c9d2-light-residual-probe.mjs 实测定谳,本机 M-series,seed 05162020）:
//   · 全量切片 174×144=25056 格=416KB/帧=24.4MB/s@60fps（登记债 29MB/s 同口径）;
//     buildSlice p50 0.10ms、postMessage 结构克隆 p50 0.10ms、transferable 0µs;
//   · 【全窗 13 通道精确差扫描 p50 0.60-0.70ms——比全量路径(buildSlice+克隆 0.2ms)
//     负收益 3×,C8-D 波场同款逐格 diff 在本域不可收】→ 差量不走扫描,走
//     【写日志+暴露带】:世界写面全量记账（TileStore 原语内置推送）,差量格集 =
//     新暴露带（影子窗外,无条件携带）∪ 写日志格（当前值直读世界）。
// 正确性论证:影子=上一发送帧的世界态;两帧间世界变更 ⊆ 写日志（记账完备前提）
// ⇒ 未记录格两帧同值 ⇒ 重叠区免比对。静置帧=空 delta;纯移动帧=暴露带
// (~2×(sw+sh) 格 ≈ 11KB);写帧=日志格（KB 级）。全量锚帧保底:首帧/尺寸变/区域
// 跳变>48 格/120 tick 周期/日志溢出/内容脏门（engine.dirty∨liquidDirty 且日志空=
// 未记账直写面:crater/隐形翻转/联机 liquid 等显式标脏路径）/worker resync。
// 记账漏记面（原版语义直写且未标脏,如 hardmode 渐进转化）→ 延迟至锚帧自愈
// （≤120 tick）,登记债。span 载荷恒 < 全量字节（日志格数 plan 期封顶,免 C8-D
// 式超限逃生路径）。位等价硬判据:tests/light-worker-parity（差量场景）。
export const LIGHT_DELTA_VERSION = 1;
export const LIGHT_DELTA_ANCHOR_EVERY = 120;
export const LIGHT_DELTA_JUMP_TILES = 48;
/** 写日志格数封顶（plan 期超出即判全量）——保证 span 载荷 < 全量字节 */
export const LIGHT_DELTA_LOG_CAP = 2048;

/** 13 通道键序（= span data 字节序,与 TileSlicePack 字段一一对应） */
export const TILE_CHAN_KEYS = ['type', 'flags', 'frameX', 'frameY', 'wall', 'liquid', 'liquidType',
  'half', 'slope', 'wire', 'paint', 'paintWall', 'coat'] as const;
/** 每格字节数:type/frameX/frameY/wall 各 2B(LE) + 其余 9 通道各 1B */
export const TILE_CHAN_BYTES_PER_CELL = 4 * 2 + 9;

/** 切片几何（世界钳制数学与 buildSlice 同源:px/py=钳后 padding,worker 侧 InWorld
 *  折叠精确性依赖,见文件头注——差量帧几何字段必须逐字段同式计算） */
export function sliceGeometry(st: { w: number; h: number; showInvisibleBlocks: boolean },
  rx: number, ry: number, rw: number, rh: number): TileSlicePack {
  const sx = Math.max(0, rx - SNAPSHOT_PAD);
  const sy = Math.max(0, ry - SNAPSHOT_PAD);
  const sw = Math.min(st.w, rx + rw + SNAPSHOT_PAD) - sx;
  const sh = Math.min(st.h, ry + rh + SNAPSHOT_PAD) - sy;
  return { sx, sy, sw, sh, px: rx - sx, py: ry - sy,
    type: new Uint16Array(0), flags: new Uint8Array(0),
    frameX: new Uint16Array(0), frameY: new Uint16Array(0),
    wall: new Uint16Array(0), liquid: new Uint8Array(0), liquidType: new Uint8Array(0),
    half: new Uint8Array(0), slope: new Uint8Array(0), wire: new Uint8Array(0),
    paint: new Uint8Array(0), paintWall: new Uint8Array(0), coat: new Uint8Array(0),
    showInvisibleBlocks: st.showInvisibleBlocks };
}

/** 分配全尺寸通道组（编码器影子/解码器乒乓共用;几何字段由调用方回填） */
export function allocSliceChannels(sw: number, sh: number): TileSlicePack {
  const n = sw * sh;
  return { sx: 0, sy: 0, sw, sh, px: 0, py: 0,
    type: new Uint16Array(n), flags: new Uint8Array(n),
    frameX: new Uint16Array(n), frameY: new Uint16Array(n),
    wall: new Uint16Array(n), liquid: new Uint8Array(n), liquidType: new Uint8Array(n),
    half: new Uint8Array(n), slope: new Uint8Array(n), wire: new Uint8Array(n),
    paint: new Uint8Array(n), paintWall: new Uint8Array(n), coat: new Uint8Array(n),
    showInvisibleBlocks: false };
}

/** ★C9d2 主线程差量编码器（LightWorkerLink 持有;灰度模式专用）。
 *  ★transferable 化（2026-10-04）:全量锚帧 13 通道 transfer 给 worker（结构克隆退役,
 *  见 LightWorkerLink.send）——主线程不再留存帧内容,影子降级为【纯几何记账】
 *  （sx/sy/sw/sh）。位等价论证:跨度格集=暴露带∪写日志格（几何+日志决定）,跨度值
 *  恒读世界真值——影子【内容】在全链路只有写（旧 rebase copyWithin=同数组内搬运、
 *  跨度回写=写世界值）而无任何读点（planFull/encodeDelta/hasShadow 全部只读几何）,
 *  删除内容面 = 线上字节零变化（tests/light-worker-parity 差量场景逐位锁）。 */
export class LightDeltaEncoder {
  private shadow: { sx: number; sy: number; sw: number; sh: number } | null = null;
  private frame = 0;                              // 距上次全量锚帧的 delta 帧数
  private forceFull = true;                       // 首帧/resync 请求
  private mark: Uint8Array = new Uint8Array(0);   // 跨度标记 scratch（窗尺寸）
  private metaBuf: Uint32Array<ArrayBufferLike> = new Uint32Array(1 + 3 * 1024);
  private dataBuf: Uint8Array<ArrayBufferLike> = new Uint8Array(1 << 15);
  // ★债2 池化（2026-10-04）:meta/data 不再 slice 精确拷贝（每帧 2 分配+KB 拷贝,
  //  worker 解码后成垃圾）——整块 scratch 所有权移交 transfer,worker 解码完毕经
  //  LightResultMsg.retDelta 回送入池,下帧取回当 scratch（稳态零分配零拷贝闭环,
  //  与 tile 切片池/结果池同范式）。metaLen/dataLen 随消息携带有效长度。
  private static readonly EMPTY_U32 = new Uint32Array(0);
  private static readonly EMPTY_U8 = new Uint8Array(0);
  private scratchPool: Array<{ meta: Uint32Array; data: Uint8Array }> = [];
  /** 池对账（link 每帧镜像进 lightWorkerStats.deltaPoolHits/Misses） */
  poolHits = 0;
  poolMisses = 0;

  /** delta 缓冲回池（worker 解码完毕回送;容量对进入 scratch 轮转,深度 4 封顶） */
  retireDelta(meta: Uint32Array, data: Uint8Array): void {
    if (this.scratchPool.length < 4) this.scratchPool.push({ meta, data });
  }

  /** 池取:容量同时满足两 buffer 的最小对（无可行对=null,调用方走 grow/新分配） */
  private takeScratch(capMeta: number, capData: number): { meta: Uint32Array; data: Uint8Array } | null {
    let best = -1;
    for (let i = 0; i < this.scratchPool.length; i++) {
      const s = this.scratchPool[i];
      if (s.meta.length >= capMeta && s.data.length >= capData) {
        if (best < 0 || (s.meta.length + s.data.length) < (this.scratchPool[best].meta.length + this.scratchPool[best].data.length)) best = i;
      }
    }
    return best >= 0 ? this.scratchPool.splice(best, 1)[0] : null;
  }

  /** plan 期全量判定（引擎切片前调用——full=buildSlice 全量克隆,delta=免 416KB 切片）。
   *  contentDirty=引擎侧「非移动内容脏」（regionMoved 已扣除;日志空时才可信——
   *  日志非空说明 dirty 来自已记账原语写,走 delta 格集）。
   *  lastFullReason=诊断面（F5/探针:full 触发原因,稳定可断言）。 */
  lastFullReason = 'first';
  planFull(reg: { sx: number; sy: number; sw: number; sh: number }, logLen: number, contentDirty: boolean): boolean {
    const s = this.shadow;
    const reason =
      this.forceFull ? 'force' :
      s === null ? 'first' :
      logLen > LIGHT_DELTA_LOG_CAP ? 'log-overflow' :
      (contentDirty && logLen === 0) ? 'content-dirty' :
      s.sw !== reg.sw || s.sh !== reg.sh ? 'resize' :
      Math.abs(reg.sx - s.sx) > LIGHT_DELTA_JUMP_TILES || Math.abs(reg.sy - s.sy) > LIGHT_DELTA_JUMP_TILES ? 'jump' :
      this.frame >= LIGHT_DELTA_ANCHOR_EVERY ? 'anchor' : null;
    if (reason !== null) this.lastFullReason = reason;
    return reason !== null;
  }

  /** 全量锚帧:记录窗口几何（★transferable 化后内容随 transfer 移交 worker,主线程
   *  不再持有——旧语义「数组所有权移交影子」退役,发送改走 transferable+回池） */
  adoptFull(t: TileSlicePack): void {
    this.shadow = { sx: t.sx, sy: t.sy, sw: t.sw, sh: t.sh };
    this.frame = 0;
    this.forceFull = false;
    if (this.mark.length < t.sw * t.sh) this.mark = new Uint8Array(t.sw * t.sh);
  }

  /** resync 请求（worker 影子缺失/失配防御面）→ 下帧全量 */
  noteResync(): void { this.forceFull = true; }

  /** 影子存在且几何匹配当前窗（诊断/断言面） */
  hasShadow(sw: number, sh: number): boolean { return this.shadow !== null && this.shadow.sw === sw && this.shadow.sh === sh; }

  /** 差量编码:读世界真值（st）+ 写日志（log=世界索引 y*w+x,调用后由调用方清空）,
   *  影子几何推进到本帧窗。返回载荷（postMessage transfer）+有效长度 metaLen/dataLen。
   *  前置:planFull=false（几何匹配/日志未溢出/contentDirty 门已过）。
   *  ★transferable 化:旧「影子 rebase（copyWithin 行平移）+跨度回写影子」两段删除
   *  ——影子内容全链路无读点（见类注位等价论证）,只留几何推进。
   *  ★债2 池化（2026-10-04）:返回整块 scratch（所有权移交——transfer 后 detached,
   *  本侧引用立即置空）;scratch 自回池轮转取用,稳态零分配。meta[0]=跨度数语义不变。 */
  encodeDelta(st: { w: number; type: Uint16Array; flags: Uint8Array; frameX: Uint16Array; frameY: Uint16Array;
    wall: Uint16Array; liquid: Uint8Array; liquidType: Uint8Array; half: Uint8Array; slope: Uint8Array;
    wire: Uint8Array; paint: Uint8Array; paintWall: Uint8Array; coat: Uint8Array },
    g: TileSlicePack, log: readonly number[]): { meta: Uint32Array; data: Uint8Array; metaLen: number; dataLen: number } {
    const s = this.shadow!;
    const sw = g.sw, shH = g.sh, n = sw * shH;
    const worldW = st.w;
    // ① 重叠矩形（旧影子窗 ∩ 本帧窗;只供暴露带标记,内容 rebase 已随内容影子退役）
    const cx0 = Math.max(s.sx, g.sx), cx1 = Math.min(s.sx + s.sw, g.sx + sw);
    const cy0 = Math.max(s.sy, g.sy), cy1 = Math.min(s.sy + s.sh, g.sy + shH);
    // ② 标记:暴露带=重叠矩形外全部格;日志格=窗内记账格
    const mark = this.mark.length >= n ? this.mark : (this.mark = new Uint8Array(n));
    mark.fill(0, 0, n);
    for (let y = 0; y < shH; y++) {
      const wy = g.sy + y;
      const row = y * sw;
      if (wy < cy0 || wy >= cy1) { mark.fill(1, row, row + sw); continue; }
      if (cx0 > g.sx) mark.fill(1, row, row + (cx0 - g.sx));
      if (cx1 < g.sx + sw) mark.fill(1, row + (cx1 - g.sx), row + sw);
    }
    for (let k = 0; k < log.length; k++) {
      const idx = log[k];
      const lx = idx % worldW - g.sx, ly = (idx / worldW | 0) - g.sy;
      if (lx >= 0 && ly >= 0 && lx < sw && ly < shH) mark[ly * sw + lx] = 1;
    }
    // ③ 行扫跨度 + 逐格 17B 发射（读世界真值;★transferable 化后不再回写影子内容）
    let mOff = 1, dOff = 0, spans = 0;
    const capMeta = 1 + 3 * spansMax(sw, shH);   // 数学硬上界（1 格跨度与空格交替）
    const capData = n * TILE_CHAN_BYTES_PER_CELL;
    if (this.metaBuf.length < capMeta || this.dataBuf.length < capData) {
      const s2 = this.takeScratch(capMeta, capData);
      if (s2 !== null) { this.metaBuf = s2.meta; this.dataBuf = s2.data; this.poolHits++; }
      else this.poolMisses++;
    }
    if (this.metaBuf.length < capMeta) this.metaBuf = new Uint32Array(capMeta);
    if (this.dataBuf.length < capData) this.dataBuf = new Uint8Array(capData);
    const meta = this.metaBuf, data = this.dataBuf;
    const stT = st.type, stF = st.flags, stFX = st.frameX, stFY = st.frameY, stW2 = st.wall;
    const stL = st.liquid, stLT = st.liquidType, stH = st.half, stSl = st.slope, stWr = st.wire;
    const stP = st.paint, stPW = st.paintWall, stC = st.coat;
    for (let y = 0; y < shH; y++) {
      const row = y * sw;
      for (let x = 0; x < sw;) {
        while (x < sw && mark[row + x] === 0) x++;
        if (x >= sw) break;
        const x0 = x;
        while (x < sw && mark[row + x] === 1) x++;
        const len = x - x0;
        if (mOff + 3 > meta.length || dOff + len * TILE_CHAN_BYTES_PER_CELL > data.length) return this.escalateFull();
        meta[mOff] = y; meta[mOff + 1] = x0; meta[mOff + 2] = len; mOff += 3;
        for (let t2 = 0; t2 < len; t2++) {
          const wi = (g.sy + y) * worldW + (g.sx + x0 + t2);
          const vT = stT[wi]; data[dOff++] = vT & 255; data[dOff++] = vT >>> 8;
          const vF = stF[wi]; data[dOff++] = vF;
          const vFX = stFX[wi]; data[dOff++] = vFX & 255; data[dOff++] = vFX >>> 8;
          const vFY = stFY[wi]; data[dOff++] = vFY & 255; data[dOff++] = vFY >>> 8;
          const vW = stW2[wi]; data[dOff++] = vW & 255; data[dOff++] = vW >>> 8;
          const vL = stL[wi]; data[dOff++] = vL;
          const vLT = stLT[wi]; data[dOff++] = vLT;
          const vH = stH[wi]; data[dOff++] = vH;
          const vSl = stSl[wi]; data[dOff++] = vSl;
          const vWr = stWr[wi]; data[dOff++] = vWr;
          const vP = stP[wi]; data[dOff++] = vP;
          const vPW = stPW[wi]; data[dOff++] = vPW;
          const vC = stC[wi]; data[dOff++] = vC;
        }
        spans++;
      }
    }
    meta[0] = spans;
    // ④ 影子几何推进（跨度值恒读世界真值,几何=plan/暴露带唯一消费面）
    s.sx = g.sx; s.sy = g.sy; s.sw = sw; s.sh = shH;
    this.frame++;
    // ⑤ 所有权移交（★债2 池化）:scratch 随 transfer 过境,本侧引用立即置空——
    //  下帧自回池/新分配取用;worker 解码完毕经 retDelta 回送 retireDelta 入池。
    const out = { meta, data, metaLen: mOff, dataLen: dOff };
    this.metaBuf = LightDeltaEncoder.EMPTY_U32;
    this.dataBuf = LightDeltaEncoder.EMPTY_U8;
    return out;
  }

  /** 跨度发射中途异常 → 全量重锚（影子需完整数据,返回特殊标记由调用方走全量。
   *  常规路径不可达:plan 期几何/日志封顶已保证容量;防御面保留。
   *  scratch 不移交（中止点重入安全:下帧 delta 全量重写已消费位面,metaLen/dataLen
   *  界外陈旧值无消费点） */
  private escalateFull(): { meta: Uint32Array; data: Uint8Array; metaLen: number; dataLen: number } {
    this.forceFull = true;
    return { meta: LightDeltaEncoder.EMPTY_U32, data: LightDeltaEncoder.EMPTY_U8, metaLen: 0, dataLen: 0 };
  }
}

/** 行内最大跨度数（1 格跨度与空格交替） */
function spansMax(sw: number, sh: number): number { return sh * ((sw >> 1) + 1); }

/** ★C9d2 worker 侧差量解码器（WorkerDriveState 持有,影子/spare 乒乓零稳态分配）。
 *  full/legacy 帧 adopt-through（legacy 不维护影子——tile 缓冲将回池 detached）;
 *  delta 帧:重叠区自影子 .set 复制 + 跨度覆写（暴露带由跨度覆盖,编码器保证）。
 *  ★transferable 化（2026-10-04）:'full' 锚帧数组经 transfer 进场即新影子——被换下
 *  的旧 spare/尺寸失配旧影子进【退役队列】,worker 壳 drainRetired 后逐包 'pool'
 *  transfer 回主线程入池（与 Layer 1 legacy 回池同通道,稳态零分配闭环）。退役包
 *  恒非当前 store 内容（store.adopt 只取 decode 返回值=新影子）。 */
export class LightDeltaDecoder {
  private shadow: TileSlicePack | null = null;
  private spare: TileSlicePack | null = null;
  private retired: TileSlicePack[] = [];

  /** 退役缓冲出队（worker 壳每帧 compute 后调用;主线程 recycleSlice 入池） */
  drainRetired(): TileSlicePack[] { const r = this.retired; this.retired = []; return r; }

  /** delta 帧可解码判据（worker 壳 resync 门:影子缺失/尺寸失配 → 请求全量） */
  readyFor(m: LightSnapshotMsg): boolean {
    if (m.enc !== 'delta') return true;
    return this.shadow !== null && this.shadow.sw === m.tiles.sw && this.shadow.sh === m.tiles.sh;
  }

  decode(m: LightSnapshotMsg): TileSlicePack {
    if (m.enc !== 'delta') {
      if (m.enc !== 'full') return m.tiles;   // legacy:纯 adopt-through（缓冲回池,不维护影子）
      const t = m.tiles;
      if (this.spare !== null) this.retired.push(this.spare);   // ★transferable:旧 spare 退役回池
      const old = this.shadow;
      this.spare = old !== null && old.sw === t.sw && old.sh === t.sh ? old : null;
      if (old !== null && this.spare === null) this.retired.push(old);   // 尺寸失配旧影子退役
      this.shadow = t;                        // 全量锚（transfer 进场,活缓冲）即新影子
      return t;
    }
    const g = m.tiles;
    if (m.delta!.dv !== LIGHT_DELTA_VERSION) throw new Error(`light delta version mismatch: ${m.delta!.dv}`);
    const s = this.shadow!;
    const sw = g.sw, shH = g.sh;
    let t = this.spare;
    if (t === null || t.sw !== sw || t.sh !== shH) {
      if (t !== null) this.retired.push(t);   // 失配 spare 退役回池（防御面,常规不可达）
      t = allocSliceChannels(sw, shH); this.spare = t;
    }
    // ① 重叠区自影子复制（跨数组按行 .set;暴露带陈旧值必被跨度覆写）
    const cx0 = Math.max(s.sx, g.sx), cx1 = Math.min(s.sx + s.sw, g.sx + sw);
    const cy0 = Math.max(s.sy, g.sy), cy1 = Math.min(s.sy + s.sh, g.sy + shH);
    if (cx1 > cx0 && cy1 > cy0) {
      const len = cx1 - cx0;
      for (let wy = cy0; wy < cy1; wy++) {
        const dOff = (wy - g.sy) * sw + (cx0 - g.sx);
        const sOff = (wy - s.sy) * s.sw + (cx0 - s.sx);
        for (const k of TILE_CHAN_KEYS) (t[k] as Uint16Array | Uint8Array).set((s[k] as Uint16Array | Uint8Array).subarray(sOff, sOff + len), dOff);
      }
    }
    // ② 跨度覆写（meta=[spanCount,(y,x0,len)…],data 17B/格 LE）
    //  ★债2 池化:有效长度由 metaLen/dataLen 携带（缺省=全长,兼容精确尺寸构造面）
    const meta = m.delta!.meta, data = m.delta!.data;
    const metaLen = m.delta!.metaLen ?? meta.length;
    const dataLen = m.delta!.dataLen ?? data.length;
    const spans = meta[0];
    if (spans > 0 && 1 + spans * 3 > metaLen) throw new Error(`light delta meta underrun: spans=${spans} metaLen=${metaLen}`);
    let mOff = 1, dOff = 0;
    const tT = t.type, tF = t.flags, tFX = t.frameX, tFY = t.frameY, tW2 = t.wall;
    const tL = t.liquid, tLT = t.liquidType, tH = t.half, tSl = t.slope, tWr = t.wire;
    const tP = t.paint, tPW = t.paintWall, tC = t.coat;
    for (let sp = 0; sp < spans; sp++) {
      const y = meta[mOff], x0 = meta[mOff + 1], len = meta[mOff + 2]; mOff += 3;
      const rowBase = y * sw + x0;
      for (let k = 0; k < len; k++) {
        const si = rowBase + k;
        tT[si] = data[dOff] | (data[dOff + 1] << 8); dOff += 2;
        tF[si] = data[dOff++];
        tFX[si] = data[dOff] | (data[dOff + 1] << 8); dOff += 2;
        tFY[si] = data[dOff] | (data[dOff + 1] << 8); dOff += 2;
        tW2[si] = data[dOff] | (data[dOff + 1] << 8); dOff += 2;
        tL[si] = data[dOff++]; tLT[si] = data[dOff++];
        tH[si] = data[dOff++]; tSl[si] = data[dOff++]; tWr[si] = data[dOff++];
        tP[si] = data[dOff++]; tPW[si] = data[dOff++]; tC[si] = data[dOff++];
      }
    }
    if (dOff !== dataLen) throw new Error(`light delta payload underrun: ${dOff}/${dataLen}`);
    // ③ 几何/旗回填 + 乒乓轮转（旧影子 → spare=下帧解码目标）
    t.sx = g.sx; t.sy = g.sy; t.px = g.px; t.py = g.py;
    t.showInvisibleBlocks = g.showInvisibleBlocks;
    const old = this.shadow;
    this.shadow = t;
    this.spare = old !== null && old.sw === sw && old.sh === shH ? old : null;
    if (old !== null && this.spare === null) this.retired.push(old);   // 失配旧影子退役
    return t;
  }
}
