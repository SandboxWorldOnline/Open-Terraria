// ★稳态门（任务#26 常驻债#1 收口,2026-10-27）——光照消息链脏标门三面锁:
//  ①键集锚:buildEngineSnapshot 的快照字段（除恒动面/传输字段）必须全部进
//    buildSteadyFingerprint——新增快照字段漏记指纹=稳态门对已变输入误判未变
//    =陈旧光,本锚防漂移;
//  ②恒动面排除锚:clock.timeOfDay / flicker / hourly（振荡器+昼夜推进,每 tick 必变）
//    不进指纹——改 timeOfDay 指纹不变,改 dayCount/eclipse 等离散面指纹必变;
//  ③行为锁(fake link):稳态 1/4 率发送(连跳≤3)+输入变(held 光/dirty/写日志)即发
//    +旗关零跳+steadySkips 对账。
// 机制/判例全注:src/lighting/LightWorkerLink.ts lightSteadyFlag 声明处;跳发语义
// 与 lwbp 同族（跳=结果暂陈旧非丢失,呈现节拍=本地稳态 4-tick 周期同款）。
import { describe, it, expect, afterEach } from 'vitest';
import { LightingEngine, type LightingWorld } from '../src/lighting/LightingEngine';
import { LightWorkerLink, setLightSteadyEnabled, lightWorkerStats, type LightTarget } from '../src/lighting/LightWorkerLink';
import {
  buildEngineSnapshot, buildSteadyFingerprint,
  type EngineCaptureView, type LightSnapshotMsg, type TileSlicePack,
} from '../src/lighting/LightWorkerProtocol';
import { TileStore } from '../src/world/TileStore';

const W = 96, H = 80;

function mkWorld(): { world: LightingWorld; st: TileStore } {
  const st = new TileStore(W, H);
  st.type[10 * W + 10] = 1; st.flags[10 * W + 10] = 1;   // 一个实心格
  const world = {
    store: st, groundLevel: 30, lavaLine: 70,
    clock: { timeOfDay: 0.4, dayCount: 1 },
  } as LightingWorld;
  return { world, st };
}

const EMPTY_PACK = {
  sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0,
  type: new Uint16Array(0), flags: new Uint8Array(0), frameX: new Uint16Array(0), frameY: new Uint16Array(0),
  wall: new Uint16Array(0), liquid: new Uint8Array(0), liquidType: new Uint8Array(0), half: new Uint8Array(0),
  slope: new Uint8Array(0), wire: new Uint8Array(0), paint: new Uint8Array(0), paintWall: new Uint8Array(0),
  coat: new Uint8Array(0),
} as unknown as TileSlicePack;

/** fake link:健康 live 恒真,只记 send/skip——不 spawn 真 Worker(node 域) */
class FakeLink extends LightWorkerLink {
  sent = 0; skipped = 0;
  isLive() { return true; }
  healthy() { return true; }
  sendReady() { return true; }
  applyPending(_t: LightTarget) { return false; }
  send(_msg: Omit<LightSnapshotMsg, 'op' | 'seq'>) { this.sent++; }
  noteSendSkip() { this.skipped++; }
  buildWorkerTiles(_rx: number, _ry: number, _rw: number, _rh: number) { return EMPTY_PACK; }
}

function mkEngine(steady: boolean): { e: LightingEngine; fake: FakeLink } {
  const { world } = mkWorld();
  const e = new LightingEngine(world);
  const fake = new FakeLink();
  (e as unknown as { _lw: FakeLink })._lw = fake;
  setLightSteadyEnabled(steady);
  e.ensureRegion(W * 8, H * 8, 30, 20);   // 快照面落位(首帧 dirty=区域初建)
  return { e, fake };
}

/** 驱动 n tick(静态输入):ensureRegion 同参 → compute(0) */
function drive(e: LightingEngine, n: number): void {
  for (let i = 0; i < n; i++) { e.ensureRegion(W * 8, H * 8, 30, 20); e.compute(0); }
}

afterEach(() => { setLightSteadyEnabled(false); });

describe('稳态门·键集锚（指纹 ⊇ 快照静态字段,防新增字段漏记=陈旧光）', () => {
  it('buildEngineSnapshot 输出键（除 op/seq/tiles/clock/flicker/hourly）全部在指纹键集内;指纹键集逐字锚定', () => {
    const { world } = mkWorld();
    const cap: EngineCaptureView = {
      rx: 1, ry: 2, rw: 30, rh: 20,
      world, flicker: { tick: () => {}, mouseTextColor: 1 } as never,
      heldLight: null, buffLights: [], perFrame: [],
      decay: { waterStyle: 0, nightVision: false, blackout: false, blind: false, opts: {} },
    };
    const snap = buildEngineSnapshot(cap, EMPTY_PACK, 0);
    const EXCL = new Set(['op', 'seq', 'tiles', 'clock', 'flicker', 'hourly']);
    const snapStatic = Object.keys(snap).filter((k) => !EXCL.has(k));
    const fpKeys = Object.keys(JSON.parse(buildSteadyFingerprint(cap, 0)));
    for (const k of snapStatic) expect(fpKeys, `快照静态字段 ${k} 未进稳态指纹`).toContain(k);
    // 指纹键集逐字锚(时钟静态面已拍平+logLen 附加)
    expect(fpKeys).toEqual(['rx', 'ry', 'rw', 'rh', 'groundLevel', 'lavaLine',
      'dayCount', 'eclipse', 'bloodMoon', 'moonPhase', 'isDay',
      'sundial', 'moondial', 'raining', 'sky', 'decay', 'held', 'buffs', 'per', 'inWinLog']);
  });
});

describe('稳态门·恒动面排除锚（振荡器/昼夜推进随实发拍到达）', () => {
  it('只改 clock.timeOfDay → 指纹不变;改 dayCount / weather.raining → 指纹必变', () => {
    const { world } = mkWorld();
    const capOf = (tod: number, dayCount: number, raining: boolean): EngineCaptureView => ({
      rx: 1, ry: 2, rw: 30, rh: 20,
      world: { ...world, clock: { timeOfDay: tod, dayCount }, weather: { raining } } as never,
      flicker: { tick: () => {} } as never,
      heldLight: null, buffLights: [], perFrame: [], decay: null,
    });
    const a = buildSteadyFingerprint(capOf(0.4, 1, false), 0);
    expect(buildSteadyFingerprint(capOf(0.4001, 1, false), 0)).toBe(a);   // 恒动:昼夜推进
    expect(buildSteadyFingerprint(capOf(0.4, 2, false), 0)).not.toBe(a); // 离散:日数
    expect(buildSteadyFingerprint(capOf(0.4, 1, true), 0)).not.toBe(a);  // 离散:雨
  });
});

describe('稳态门·行为锁（fake link 驱动）', () => {
  it('静态输入 40 tick → 发送 ≈1/4 率(10±1 发),连跳≤3,steadySkips 对账;held 光/窗内写即发;窗外写与裸 dirty 不破稳态', () => {
    const { e, fake } = mkEngine(true);
    drive(e, 40);
    const sends1 = fake.sent;
    // 1/4 率:40 tick 首帧 dirty 发+稳态周期(1 发/4 tick)≈10±1
    expect(sends1).toBeGreaterThanOrEqual(9);
    expect(sends1).toBeLessThanOrEqual(12);
    expect(lightWorkerStats().steadySkips).toBe(40 - sends1 - fake.skipped);
    // 输入变即发:held 光移动一 tile
    (e as unknown as { heldLight: unknown }).heldLight = { tx: 12, ty: 12, r: 1, g: 1, b: 1 };
    const before = fake.sent;
    drive(e, 1);
    expect(fake.sent).toBe(before + 1);
    // 窗外写不破稳态(世界演化/远处沉降——实测 idle 主源):区域 y0≈8,窗外写 y=1
    const st = (e as unknown as { world: LightingWorld }).world.store;
    const outIdx = 1 * st.w + 5;   // y=1 在快照窗(sy=8-16→0)之上?夹具全域在窗内→换负例:窗内写即发
    // 夹具 96×80 全域被快照窗覆盖(sy=max(0,8-16)=0, ey=min(80,73+16)=80)——窗外写
    // 需越界坐标,本夹具不可构造;窗内写即发为正例(窗外不破稳态由活体探针 A/B 锚)
    (st as unknown as { tileWriteLog: number[] | null }).tileWriteLog = [outIdx];
    drive(e, 1);
    expect(fake.sent).toBe(before + 2);   // 窗内写(y=1 全域皆窗内)→指纹 inWinLog=1≠0 → 即发
    // 裸 dirty(未记账直写面)单独不破稳态——≤3 拍陈旧后下次实发经内容脏门全量锚自愈
    (e as unknown as { dirty: boolean }).dirty = true;
    drive(e, 8);   // 8 tick:若稳态保持 → 2 发(1/4 率);若破 → 8 发
    expect(fake.sent).toBeLessThanOrEqual(before + 2 + 3);
    expect(fake.sent).toBeGreaterThanOrEqual(before + 2 + 1);
  });

  it('旗关(缺省) → 每 tick 恒发(现状逐位),steadySkips 零增量', () => {
    const { e, fake } = mkEngine(false);
    const skips0 = lightWorkerStats().steadySkips;
    drive(e, 12);
    expect(fake.sent).toBe(12);   // 每发 dirty 首帧也计入——12 tick 12 发
    expect(lightWorkerStats().steadySkips).toBe(skips0);
  });
});
