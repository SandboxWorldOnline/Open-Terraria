// ★liqgl 微光液体批化+染色 GL 化——结构锁+行为锁（2026-09-27;rain-gl-batch 判例同构）。
// node 可跑面：drawVanillaLiquids 批支端到端（fake Renderer 中介捕获批数据）+
// shimmerCornerColors 顶点色独立参照锁（SetShimmerVertexColors 双线性张量）+
// emitVanillaLiquidGate gate 发射行为（y 镜像/FBO 绑定卫生/足迹四边形）——
// 像素对拍=scripts/_liqgl-ab.mjs（node 无 GL/canvas,该面探针锁）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { TileStore } from '../src/world/TileStore';
import type { SpriteAtlas } from '../src/assets/SpriteAtlas';
import type { GLSpriteLayer } from '../src/render/GLSpriteLayer';
import {
  drawVanillaLiquids, emitVanillaLiquidGate, resetLiquidBatchForFrame,
  shimmerCornerColorsForTest, liqgl, liqglSetForTest,
  liqC13cSetForTest, tintSurfForTest, liqtintSetForTest,
  type LiqBatchEmit,
} from '../src/render/VanillaLiquidRenderer';
import { liqpolishSetForTest } from '../src/render/perfFlags';
import { texId } from '../src/render/texId';
import { TILE_DEFS } from '../src/data/tiles';

const VL = readFileSync(join(__dirname, '../src/render/VanillaLiquidRenderer.ts'), 'utf8');
const RD = readFileSync(join(__dirname, '../src/render/Renderer.ts'), 'utf8');
const GS = readFileSync(join(__dirname, '../src/render/GLSpriteLayer.ts'), 'utf8');
const GE = readFileSync(join(__dirname, '../src/render/glshim/GLShimExecutor.ts'), 'utf8');
const GW = readFileSync(join(__dirname, '../src/render/GLWorldCompose.ts'), 'utf8');

// ---------- 参照实现（与 src 内实现零共享,防同源盲区;vanilla 公式 1:1） ----------
function refWave(x: number, y: number, t: number): number {
  return Math.sin(((x + y / 6) / 10 - t / 360) * Math.PI * 2);
}
function refBase(x: number, y: number, t: number): [number, number, number] {
  const k = 0.1 + refWave(x, y, t) * 0.4;
  const lerp = (a: number, b: number) => 255 * (a + (b - a) * k);
  return [lerp(0.64705884, 41 / 51), lerp(26 / 51, 41 / 51), lerp(14 / 15, 1)];
}
/** 裁剪角 (u,v) 双线性张量（SetShimmerVertexColors :745-759 顶点插值场） */
function refCorner(x: number, y: number, t: number, u: number, v: number): [number, number, number] {
  const c00 = refBase(x, y, t), c10 = refBase(x + 1, y, t);
  const c01 = refBase(x, y + 1, t), c11 = refBase(x + 1, y + 1, t);
  return [
    c00[0] * (1 - u) * (1 - v) + c10[0] * u * (1 - v) + c01[0] * (1 - u) * v + c11[0] * u * v,
    c00[1] * (1 - u) * (1 - v) + c10[1] * u * (1 - v) + c01[1] * (1 - u) * v + c11[1] * u * v,
    c00[2] * (1 - u) * (1 - v) + c10[2] * u * (1 - v) + c01[2] * (1 - u) * v + c11[2] * u * v,
  ];
}

// ---------- 测试用 store:微光池 + 半砖（足迹） ----------
function makeStore(): TileStore {
  const st = new TileStore(120, 80);
  const dirt = TILE_DEFS.findIndex((d) => d?.key === 'dirt');
  const set = (x: number, y: number, t: number, liquid = 0, lt = 1, half = 0) => {
    const i = st.idx(x, y);
    st.type[i] = t; st.flags[i] = t ? 1 : 0;
    st.liquid[i] = liquid; st.liquidType[i] = lt;
    st.half[i] = half;
  };
  for (let x = 0; x < 120; x++) set(x, 40, dirt);                    // 地面
  for (let x = 20; x <= 60; x++) for (let y = 30; y <= 39; y++) set(x, y, 0, 255, 4);   // 微光池
  set(80, 39, dirt, 0, 1, 1);                                        // 半砖（ dirt+half=浸润带足迹面）
  set(80, 38, 0, 255, 4);                                            // 半砖上微光
  return st;
}

const fakeAtlas = {
  ensureVImage: () => ({ width: 144, height: 1360 }),
} as unknown as SpriteAtlas;

/** 桩 ctx：记录方法调用+属性 set（drawImage/fillRect 参数序列可查） */
function makeCtx() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const sets = new Map<string, unknown>();
  const setLog: Array<{ k: string; v: unknown }> = [];   // 全史（Map 只留末值,gco 序列判据要历史）
  const stub: Record<PropertyKey, unknown> = {};
  const handler: ProxyHandler<Record<PropertyKey, unknown>> = {
    get(t, prop) {
      if (prop === '__calls') return calls;
      if (prop === '__sets') return sets;
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push({ op: String(prop), args });
        if (prop === 'getTransform') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        return undefined;
      };
    },
    set(t, prop, v) { sets.set(String(prop), v); setLog.push({ k: String(prop), v }); t[prop] = v; return true; },
  };
  return { ctx: new Proxy(stub, handler) as unknown as CanvasRenderingContext2D, calls, sets, setLog };
}

interface BatCap { img: unknown; key: string; data: Float32Array; quads: number; replay: unknown; }
function drawWithBatch(st: TileStore, isBackground: boolean, gateCapture: boolean,
  frameToken = 7): { caps: BatCap[]; calls: Array<{ op: string; args: unknown[] }>; sets: Map<string, unknown>; setLog: Array<{ k: string; v: unknown }> } {
  const { ctx, calls, sets, setLog } = makeCtx();
  const caps: BatCap[] = [];
  const bat: LiqBatchEmit = {
    emit(img, key, data, quads, replay) {
      caps.push({ img, key, data: data.slice(), quads, replay });
      return true;
    },
  };
  drawVanillaLiquids(ctx, fakeAtlas, st, 40, 5, 5, 110, 55, 1000, isBackground, 0, 0,
    undefined, false, undefined, frameToken, null, bat, gateCapture);
  return { caps, calls, sets, setLog };
}

beforeAll(() => {
  if (!(globalThis as unknown as { Image?: unknown }).Image) {
    (globalThis as unknown as { Image: unknown }).Image = class {
      src = ''; width = 0; height = 0; complete = false;
      addEventListener() { /* noop */ }
      removeEventListener() { /* noop */ }
    };
  }
});

describe('★liqgl 批支端到端（drawVanillaLiquids + bat 钩）', () => {
  it('批捕获:同纹理段单次 emit;键=liq:<texId>;quad 几何/uv/α 域合法', () => {
    resetLiquidBatchForFrame(-1);
    const { caps, calls } = drawWithBatch(makeStore(), false, false);
    expect(caps.length).toBeGreaterThanOrEqual(1);
    expect(caps[0].key.startsWith('liq:')).toBe(true);
    let total = 0;
    for (const c of caps) {
      expect(c.quads).toBeGreaterThan(0);
      total += c.quads;
      expect(c.data.length).toBeGreaterThanOrEqual(c.quads * 48);
      for (let q = 0; q < c.quads; q++) {
        const o = q * 48;
        const a = c.data[o + 7];
        expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
        for (let v = 0; v < 6; v++) {
          const uu = c.data[o + v * 8 + 2], vv = c.data[o + v * 8 + 3];
          expect(Number.isFinite(uu)).toBe(true); expect(Number.isFinite(vv)).toBe(true);
          expect(uu).toBeGreaterThan(-0.01); expect(uu).toBeLessThan(1.01);
          expect(vv).toBeGreaterThan(-0.01); expect(vv).toBeLessThan(1.01);
        }
      }
    }
    expect(total).toBeGreaterThan(10);   // 微光池 ≥20 tile×1 quad
    // 基底层不再逐 tile ctx.drawImage（批化;sparkle 直绘仍走 ctx=少量）
    const draws = calls.filter((c) => c.op === 'drawImage').length;
    expect(draws).toBeLessThan(total);
  });

  it('★BJ738 liqtint:CPU 原链基色双线性梯度(角场面+分数源矩形=裁剪窗场锚定;逃生门)', () => {
    const tintData = new Uint8ClampedArray(16);
    let puts = 0;
    const FAKE_CV = { width: 2, height: 2 } as HTMLCanvasElement;
    tintSurfForTest(FAKE_CV, { putImageData: () => { puts++; } }, { data: tintData });
    resetLiquidBatchForFrame(-1);
    const { ctx, calls, setLog } = makeCtx();
    drawVanillaLiquids(ctx, fakeAtlas, makeStore(), 40, 5, 5, 110, 55, 1000, false, 0, 0,
      undefined, false, undefined, 7, null, null, false);
    const tintDraws = calls.filter((c) => c.op === 'drawImage' && c.args[0] === FAKE_CV);
    expect(tintDraws.length).toBeGreaterThan(10);          // 微光池逐 tile 一笔梯度
    expect(puts).toBe(tintDraws.length);                   // 每笔先写 2×2 角面
    for (const d of tintDraws) {                           // 源矩形=裁剪窗归一×2∈[0,2]
      expect(d.args[1]).toBeGreaterThanOrEqual(0); expect(d.args[1]).toBeLessThanOrEqual(2);
      expect(d.args[2]).toBeGreaterThanOrEqual(0); expect(d.args[2]).toBeLessThanOrEqual(2);
      expect(d.args[3]).toBeGreaterThan(0); expect(d.args[3]).toBeLessThanOrEqual(2);
      expect(d.args[4]).toBeGreaterThan(0); expect(d.args[4]).toBeLessThanOrEqual(2);
    }
    // 满格主体=整窗 (0,0,2,2)（壁值/半格裁剪格=分数窗）
    expect(tintDraws.filter((d) => d.args[1] === 0 && d.args[2] === 0
      && d.args[3] === 2 && d.args[4] === 2).length).toBeGreaterThan(10);
    const mults = setLog.filter((e) => e.k === 'globalCompositeOperation' && e.v === 'multiply');
    expect(mults.length).toBeGreaterThan(0);               // multiply modulate 语义保持
    const smooths = setLog.filter((e) => e.k === 'imageSmoothingEnabled' && e.v === true);
    expect(smooths.length).toBe(tintDraws.length);         // 梯度笔逐一开双线性
    // 逃生门:?liqtint=0 → 面零消费,回退子块 fillRect
    liqtintSetForTest(false);
    const r2 = makeCtx();
    const before = puts;
    drawVanillaLiquids(r2.ctx, fakeAtlas, makeStore(), 40, 5, 5, 110, 55, 1000, false, 0, 0,
      undefined, false, undefined, 7, null, null, false);
    expect(puts).toBe(before);                             // 旗关不写面
    expect(r2.calls.filter((c) => c.op === 'drawImage' && c.args[0] === FAKE_CV).length).toBe(0);
    expect(r2.calls.filter((c) => c.op === 'fillRect').length).toBeGreaterThan(10);   // 子块回退
    liqtintSetForTest(true);
    tintSurfForTest(null, null, null);
  });

  it('微光染色 GL 化:批路径零 multiply(applyShimmerBaseTint 退役);CPU 路径保留', () => {
    resetLiquidBatchForFrame(-1);
    const bat = drawWithBatch(makeStore(), false, false);
    const batMult = bat.setLog.filter((e) => e.k === 'globalCompositeOperation' && e.v === 'multiply');
    expect(batMult.length).toBe(0);          // 刀2 退役面
    resetLiquidBatchForFrame(-1);
    const { ctx, calls, setLog } = makeCtx();
    drawVanillaLiquids(ctx, fakeAtlas, makeStore(), 40, 5, 5, 110, 55, 1000, false, 0, 0,
      undefined, false, undefined, 7, null, null, false);
    const cpuMult = setLog.filter((e) => e.k === 'globalCompositeOperation' && e.v === 'multiply');
    expect(cpuMult.length).toBeGreaterThan(0);   // CPU 原链 canvas multiply 保留
    expect(calls.filter((c) => c.op === 'drawImage').length).toBeGreaterThan(10);
  });

  it('重放面:批段 2D 逐 quad 回放（drawImage/save/restore 平衡;降级判据面）', () => {
    resetLiquidBatchForFrame(-1);
    const { caps } = drawWithBatch(makeStore(), false, false);
    const { ctx, calls } = makeCtx();
    (caps[0].replay as (c: CanvasRenderingContext2D) => void)(ctx);
    expect(calls[0].op).toBe('save');
    expect(calls[calls.length - 1].op).toBe('restore');
    expect(calls.filter((c) => c.op === 'drawImage').length).toBe(caps[0].quads);
  });

  it('旗面:liqgl 缺省 true（2026-09-27 转正,lrecon compose 调用点病灶修复后;?liqgl=0 逃生门）', () => {
    expect(liqglDefault).toBe(true);
    liqglSetForTest(false);
    liqglSetForTest(true);
  });
});

describe('★liqgl 微光顶点色（SetShimmerVertexColors 双线性张量锁）', () => {
  it('整格四角 = 基色原值（u/v∈{0,1} 张量退化）;裁剪角 = 双线性受限重_param', () => {
    for (const [x, y, t] of [[100, 200, 600], [3333, 471, 12345], [7, 9, 0]] as const) {
      const full = shimmerCornerColorsForTest(x, y, t, 0, 1, 0, 1);
      const e00 = refBase(x, y, t), e10 = refBase(x + 1, y, t);
      const e11 = refBase(x + 1, y + 1, t), e01 = refBase(x, y + 1, t);
      const exp = [e00, e10, e11, e01].map((c) => c.map((v) => v / 255));
      for (let i = 0; i < 4; i++) {
        for (let k = 0; k < 3; k++) expect(full[i][k]).toBeCloseTo(exp[i][k], 7);   // f32 存储面（顶点属性）
      }
      // 裁剪角（半格窗）= 参照双线性在 (u,v) 处的值
      const crop = shimmerCornerColorsForTest(x, y, t, 0.25, 0.75, 0.125, 0.875);
      const corners: readonly (readonly [number, number])[] = [[0.25, 0.125], [0.75, 0.125], [0.75, 0.875], [0.25, 0.875]];
      for (let i = 0; i < 4; i++) {
        const e = refCorner(x, y, t, corners[i][0], corners[i][1]);
        for (let k = 0; k < 3; k++) expect(crop[i][k]).toBeCloseTo(e[k] / 255, 7);
      }
    }
  });
});

// ---- gate 发射行为锁（fake GLSpriteLayer） ----
function drawFgForGate(st: TileStore): { bgCaps: BatCap[]; fgCaps: BatCap[] } {
  const bgCaps: BatCap[] = [];
  const fgCaps: BatCap[] = [];
  const mk = (sink: BatCap[]): LiqBatchEmit => ({
    emit(img, key, data, quads, replay) {
      sink.push({ img, key, data: data.slice(), quads, replay });
      return true;
    },
  });
  const { ctx } = makeCtx();
  resetLiquidBatchForFrame(9);
  drawVanillaLiquids(ctx, fakeAtlas, st, 40, 5, 5, 110, 55, 1000, true, 0, 0,
    undefined, false, undefined, 9, null, mk(bgCaps), true);    // bg:足迹收集
  drawVanillaLiquids(ctx, fakeAtlas, st, 40, 5, 5, 110, 55, 1000, false, 0, 0,
    undefined, true, undefined, 9, null, mk(fgCaps), true);     // fg:warpMode=批段登记
  return { bgCaps, fgCaps };
}

describe('★liqgl gate 发射（emitVanillaLiquidGate 行为锁）', () => {
  it('FBO 绑定卫生:begin(liqgate,clear)→绘制→begin(world,续交);y 镜像逐顶点;句柄 flipY=0', () => {
    const st = makeStore();
    const { fgCaps } = drawFgForGate(st);
    expect(fgCaps.length).toBeGreaterThanOrEqual(1);
    const W = 1280, H = 800;
    const sprites: Array<{ dx: number; dy: number; dw: number; dh: number; opts: { alpha?: number } }> = [];
    const batches: Array<{ data: Float32Array; quads: number }> = [];
    const beginCalls: string[] = [];
    let paramsCalls = 0;
    const fboTex = {} as WebGLTexture;
    const glw = {
      unavailable: false,
      begin(name: string, clear: boolean) { beginCalls.push(`${name}:${clear}`); },
      isAccumOpen(name: string) { return name === 'world'; },
      quadSprite(_e: unknown, _sx: number, _sy: number, _sw: number, _sh: number,
        dx: number, dy: number, dw: number, dh: number, opts?: { alpha?: number }) {
        sprites.push({ dx, dy, dw, dh, opts: opts ?? {} });
      },
      quadBatchRgba(_e: unknown, data: Float32Array, quads: number) {
        batches.push({ data: data.slice(), quads });
        return true;
      },
      texFromImage(key: string) {
        return { tex: {}, key, w: 144, h: 1360, stamp: 1, bytes: 1, mipped: false };
      },
      texFromRegion(key: string) {
        return { tex: {}, key, w: 16, h: 16, stamp: 1, bytes: 1, mipped: false };
      },
      texAlive() { return true; },
      pipeFboTex() { return fboTex; },
      liqGateParams() { paramsCalls++; },
    } as unknown as GLSpriteLayer;
    const handle = emitVanillaLiquidGate(glw, W, H);
    expect(handle).not.toBeNull();
    expect(handle!.tex).toBe(fboTex);
    expect(handle!.flipY).toBe(0);
    expect(paramsCalls).toBe(1);
    expect(beginCalls).toEqual(['liqgate:true', 'world:false']);
    // 水批段 y 镜像:gate 数据逐顶点 y' = H − y（其余分量逐位同）;段集=前景批段
    expect(batches.length).toBe(fgCaps.length);
    for (let r = 0; r < fgCaps.length; r++) {
      expect(batches[r].quads).toBe(fgCaps[r].quads);
      for (let q = 0; q < fgCaps[r].quads; q++) {
        for (let v = 0; v < 6; v++) {
          const src = q * 48 + v * 8;   // 段局部下标（caps/batches 均=单段切片）
          expect(batches[r].data[src]).toBe(fgCaps[r].data[src]);
          expect(batches[r].data[src + 1]).toBeCloseTo(H - fgCaps[r].data[src + 1], 6);
          for (let k = 2; k < 8; k++) expect(batches[r].data[src + k]).toBe(fgCaps[r].data[src + k]);
        }
      }
    }
    void sprites;
  });

  it('半砖足迹四边形:solid 面 α=0.02 进 gate（世界→设备+y 镜像）', () => {
    const st = makeStore();
    const { ctx } = makeCtx();
    const bat: LiqBatchEmit = { emit: () => true };
    resetLiquidBatchForFrame(11);
    drawVanillaLiquids(ctx, fakeAtlas, st, 40, 5, 5, 110, 55, 1000, true, 0, 0,
      undefined, false, undefined, 11, null, bat, true);
    const sprites: Array<{ dx: number; dy: number; dw: number; dh: number; opts: { alpha?: number; tint?: readonly number[] } }> = [];
    const fboTex = {} as WebGLTexture;
    const glw = {
      unavailable: false,
      begin() { /* 记录面在前例覆盖 */ },
      isAccumOpen(name: string) { return name === 'world'; },
      quadSprite(_e: unknown, _sx: number, _sy: number, _sw: number, _sh: number,
        dx: number, dy: number, dw: number, dh: number, opts?: { alpha?: number; tint?: readonly number[] }) {
        sprites.push({ dx, dy, dw, dh, opts: opts ?? {} });
      },
      quadBatchRgba() { return true; },
      texFromImage(key: string) { return { tex: {}, key, w: 1, h: 1, stamp: 1, bytes: 4, mipped: false }; },
      texFromRegion(key: string) { return { tex: {}, key, w: 16, h: 16, stamp: 1, bytes: 1, mipped: false }; },
      texAlive() { return true; },
      pipeFboTex() { return fboTex; },
      liqGateParams() { /* 参数面 */ },
    } as unknown as GLSpriteLayer;
    const H = 800;
    emitVanillaLiquidGate(glw, 1280, H);
    // 半砖 (80,39) 足迹 = fillRect(px=1280, y*16=624, 16, 8) → y 镜像 gy=H−624−8
    const foot = sprites.find((s) => s.opts.alpha === 0.02 && s.opts.tint && s.opts.tint[0] === 0.5);
    expect(foot).toBeDefined();
    expect(foot!.dw).toBe(16);
    expect(foot!.dh).toBe(8);
    expect(foot!.dy).toBeCloseTo(H - 39 * 16 - 8, 5);
  });

  it('world FBO 未开 → null（防 stale FBO 续交守卫）', () => {
    const glw = {
      unavailable: false,
      isAccumOpen() { return false; },
      begin() { /* 未开面不可达 */ },
    } as unknown as GLSpriteLayer;
    expect(emitVanillaLiquidGate(glw, 1280, 800)).toBeNull();
  });
});

// ---- 结构锁（源码锚;防并行会话漂移） ----
describe('★liqgl 结构锁', () => {
  it('VanillaLiquidRenderer:旗/批环/顶点色调制/gate 发射/足迹 sink 锚', () => {
    expect(VL).toContain("get('liqgl') !== '0'");
    expect(VL).toContain('export function liqglSetForTest(');
    expect(VL).toContain('const LIQ_RING_CAP = 16384');
    expect(VL).toContain('function batQuad(');
    expect(VL).toContain('function shimmerCornerColors(');
    expect(VL).toContain('export function emitVanillaLiquidGate(');
    expect(VL).toContain('function replayLiqRun2D(');
    expect(VL).toContain("runKey = `liq:${texId(tex)}`");
    // ★liqpolish（2026-09-29 微抛光刀）:sparkle/glint 批化支延后收口（ADD 环累积,
    //  pass 尾 flushAddRuns2DAndEmit——全基底段先于 ADD 段=重叠序）;旧/CPU 支
    //  立即收口保留（flag-off 逐位原链）。
    expect(VL).toContain('if (doSpark && !polish) flushRun();');
    expect(VL).toContain('if (doGlint && !polish) flushRun();');
    expect(VL).toContain('if (polish) flushAddRuns2DAndEmit(ctx, bat ?? null, isBackground);');
    expect(VL).toContain('function flushAddRuns2DAndEmit(');
    expect(VL).toContain('function batQuadAdd(');
    expect(VL).toContain('function replayLiqAddRun2D(');
    expect(VL).toContain('function shimmerCornersFromWaves(');
    expect(VL).toContain('function glitter4FromWaves(');
    expect(VL).toContain('function shimmerWaves4(');
    // ★liqpolish 带批化/fg 复用/ADD 环锁（2026-09-29 微抛光刀）
    expect(VL).toContain('const flushBandRun = (');
    expect(VL).toContain('const fgReuse = polish && !needsPrep && batOn && bat !== null');
    expect(VL).toContain('const _fgReuseRing = new Float32Array(');
    expect(VL).toContain('batQuadAdd(sSrcX - 48, sSrcY, sw, sh, band.width, band.height,');
    expect(VL).toContain('五旗早退');
    expect(VL).toContain('footSink: FootQuad[] | null = null');
    expect(VL).toContain('flushRun();                 // ★liqgl:主循环批段收尾');
  });

  it('Renderer:liqgl 中介/预检/gate 收口/批钩/compose 句柄优先', () => {
    expect(RD).toContain('emitLiquidQuadBatch(img: CanvasImageSource, key: string, data: Float32Array, quads: number,');
    expect(RD).toContain('return shim.pushQuadBatchRgba(img, key, data, quads, replay);');
    expect(RD).toContain('liqBatchAvail(): boolean');
    expect(RD).toContain('private emitLiquidGate(w: number, h: number): void');
    expect(RD).toContain('this._liqGateHandle ?? this.waterWarp.gateCanvas()');
    expect(RD).toContain('const liqMode = liqgl && this._accMode === \'acc\' && !this.isCpuRender();');
    expect(RD).toContain('this.emitLiquidGate(this._worldLowW, this._worldLowH)');
  });

  it('GLSpriteLayer:pipeFboTex/liqGateParams（NEAREST CLAMP 门控档）', () => {
    expect(GS).toContain('pipeFboTex(): WebGLTexture | null');
    expect(GS).toContain('liqGateParams(): void');
    expect(GS).toContain('gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);');
  });

  it('GLShimExecutor:batchAvail 预检（pushQuadBatchRgba 同门族）', () => {
    expect(GE).toContain('batchAvail(): boolean');
    expect(GE).toContain('&& !this.clipped && this.filterV === \'none\';');
  });

  it('GLWorldCompose:water 双型签名+句柄直绑支', () => {
    expect(GW).toContain('water: HTMLCanvasElement | WorldTexSrc | null = null');
    expect(GW).toContain('const wHandle = (water as WorldTexSrc | null)?.tex ?? null;');
  });
});

/** 旗缺省值快照（灰度期 false）——转正后随旗面一起翻 */
export const liqglDefault = liqgl;

// ---------- ★rgb 预乘/键维度/采样一致性锁（2026-09-28 半砖/斜坡水色差定谳刀） ----------
// 定谳面（scripts/_slope-water-flip-ab.mjs + _slope-water-dim-core.mjs）:
//  · 前景 α=0.5 水格 wOn=[53,92,214] vs wOff=[49,61,119] —— batQuad 直写未预乘
//    rgb,quadBatchRgba (ONE,1−SA) 下 out=S+dst×(1−α) ≠ 2D out=S×α+dst×(1−α);
//  · 键维度三角（img↔key↔texs entry）逐环核实无损:imgDim=[48,1360] / entry=[48,1360]
//    / 纹理字节=sheet（diff=0）——上传/键语义本就正确,锁防回归。
/** 普通水池 store（liquidType 1→vt 0,前景 α=0.5） */
function makeWaterStore(): TileStore {
  const st = new TileStore(120, 80);
  const dirt = TILE_DEFS.findIndex((d) => d?.key === 'dirt');
  const set = (x: number, y: number, t: number, liquid = 0, lt = 1) => {
    const i = st.idx(x, y);
    st.type[i] = t; st.flags[i] = t ? 1 : 0;
    st.liquid[i] = liquid; st.liquidType[i] = lt;
  };
  for (let x = 0; x < 120; x++) set(x, 40, dirt);
  for (let x = 20; x <= 60; x++) for (let y = 30; y <= 39; y++) set(x, y, 0, 255, 1);
  return st;
}

describe('★liqgl rgb 预乘锁（quadBatchRgba 着色器契约=顶点 rgb 已预乘 quad α）', () => {
  afterEach(() => {
    // 旗复位（c13c 臂点亮测试后回逃生门域;node 惯例 perfFlags 恒关）
    liqC13cSetForTest(false);
    liqpolishSetForTest(false);
    resetLiquidBatchForFrame(-1);
  });

  it('普通水 quad:12 个颜色分量逐位 === α（预乘恒等式;α<1 时 rgb 必须随 α 缩）', () => {
    resetLiquidBatchForFrame(-1);
    const { caps } = drawWithBatch(makeWaterStore(), false, false);
    expect(caps.length).toBeGreaterThanOrEqual(1);
    let quads = 0, alphaLt1 = 0;
    for (const c of caps) {
      for (let q = 0; q < c.quads; q++) {
        const o = q * 48;
        const a = c.data[o + 7];
        expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
        if (a < 1) alphaLt1++;
        for (let v = 0; v < 6; v++) {
          // 非调制 quad:rgb = 1×α → 12 分量与 α 同一 f32 值（逐位,非近似）
          expect(c.data[o + v * 8 + 4]).toBe(a);
          expect(c.data[o + v * 8 + 5]).toBe(a);
          expect(c.data[o + v * 8 + 6]).toBe(a);
        }
        quads++;
      }
    }
    expect(quads).toBeGreaterThan(10);
    expect(alphaLt1).toBeGreaterThan(0);   // 前景水 α=0.5——旧病（rgb=1 恒等）必爆红的判别面
  });

  it('微光 quad（?c13c=0 回退臂域,liqgl 刀2 顶点色调制）:rgb = 顶点色×gaT（预乘,R<G<B<α 域）', () => {
    // ★C13c 转正（2026-10-02）域标注:本锁=回退臂（c13c off→liqgl 刀2 顶点色 quad,
    //  stride 48）原判别面原样保留;c13c 臂（缺省）的微光段域已迁移到下例 liqshim
    //  键族 rgb===a 恒等锁（环数据 rgb===a 预乘恒等,域不同——B1 灰度期登记的收尾债）。
    liqC13cSetForTest(false);
    liqpolishSetForTest(false);
    resetLiquidBatchForFrame(-1);
    const { caps } = drawWithBatch(makeStore(), false, false);   // makeStore=微光池(lt=4→vt 3)
    let quads = 0;
    for (const c of caps) {
      for (let q = 0; q < c.quads; q++) {
        const o = q * 48;
        const a = c.data[o + 7];
        expect(a).toBeGreaterThan(0);
        for (let v = 0; v < 6; v++) {
          const r = c.data[o + v * 8 + 4], g = c.data[o + v * 8 + 5], b = c.data[o + v * 8 + 6];
          // 微光基色域 (0.647..0.804, 0.510..0.804, 0.933..1)×gaT —— 严格小于 α（基色<1）
          expect(r).toBeGreaterThan(0); expect(r).toBeLessThanOrEqual(a);
          expect(g).toBeLessThanOrEqual(a);
          expect(b).toBeLessThanOrEqual(a + 1e-6);   // B 分量基色可近 1（f32 舍入容差）
        }
        quads++;
      }
    }
    expect(quads).toBeGreaterThan(10);
  });

  it('微光 quad（c13c 臂缺省域）:liqshim 键族 stride 66,rgb===a 预乘恒等（场调制全进 FS）', () => {
    // ★C13c 转正收尾迁移锁（2026-10-02）:c13c 环数据 rgb===a（§3.3 锁域——vCol.rgb
    //  不进乘链,基色场 FS 逐像素解析）;上例 R<G<B<α 域只对回退臂成立,两域不串。
    liqC13cSetForTest(true);
    liqpolishSetForTest(true);   // c13cOn=liqC13c∧polish（臂域基座）
    resetLiquidBatchForFrame(-1);
    const { caps } = drawWithBatch(makeStore(), false, false);
    const shimRuns = caps.filter((c) => c.key.startsWith('liqshim:'));
    expect(shimRuns.length).toBeGreaterThanOrEqual(1);
    expect(caps.some((c) => c.key.startsWith('liq:'))).toBe(false);   // 微光不进主环
    let quads = 0;
    for (const c of shimRuns) {
      expect(c.data.length).toBe(c.quads * 66);   // stride 11
      for (let q = 0; q < c.quads; q++) {
        const o = q * 66;
        const a = c.data[o + 7];
        expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
        for (let v = 0; v < 6; v++) {
          const vo = o + v * 11;
          // 预乘恒等式:12 个颜色分量与 α 同一 f32 值（逐位,非近似）
          expect(c.data[vo + 4]).toBe(a);
          expect(c.data[vo + 5]).toBe(a);
          expect(c.data[vo + 6]).toBe(a);
        }
        quads++;
      }
    }
    expect(quads).toBeGreaterThan(10);
  });
});

describe('★liqgl 键维度锁（emit 键↔img↔纹理 entry 三角）', () => {
  it('emit 键 = liq:<texId(img)>;gate 重发射 texFromImage 收到【同一 img 实例】', () => {
    resetLiquidBatchForFrame(-1);
    const { caps } = drawWithBatch(makeWaterStore(), false, false);
    expect(caps.length).toBeGreaterThanOrEqual(1);
    for (const c of caps) {
      expect(c.key).toBe(`liq:${texId(c.img as object)}`);
      const img = c.img as { width: number; height: number };
      expect(img.width).toBeGreaterThan(0);
      expect(img.height).toBeGreaterThan(0);
    }
    // gate 重发射:fake glw 的 texFromImage 记录 (key,img)——执行器契约=按【发射时的
    // 同一 img】解析纹理（entry w/h=img w/h 由 texFromImage 构造保证;键维度错位
    // （曾疑 ensureVImage 共享页位图/错位一个 TexEntry——探针证伪）无重建空间）
    const st = makeWaterStore();
    const { bgCaps, fgCaps } = (() => {
      const bgCaps: BatCap[] = [];
      const fgCaps: BatCap[] = [];
      const mk = (sink: BatCap[]): LiqBatchEmit => ({
        emit(img, key, data, quads, replay) {
          sink.push({ img, key, data: data.slice(), quads, replay });
          return true;
        },
      });
      const { ctx } = makeCtx();
      resetLiquidBatchForFrame(21);
      drawVanillaLiquids(ctx, fakeAtlas, st, 40, 5, 5, 110, 55, 1000, true, 0, 0,
        undefined, false, undefined, 21, null, mk(bgCaps), true);
      drawVanillaLiquids(ctx, fakeAtlas, st, 40, 5, 5, 110, 55, 1000, false, 0, 0,
        undefined, true, undefined, 21, null, mk(fgCaps), true);
      return { bgCaps, fgCaps };
    })();
    const resolved: Array<{ key: string; img: unknown }> = [];
    const glw = {
      unavailable: false,
      begin() { /* 绑定序在前例覆盖 */ },
      isAccumOpen(name: string) { return name === 'world'; },
      quadSprite() { /* 足迹面 */ },
      quadBatchRgba() { return true; },
      texFromImage(key: string, img: { width: number; height: number }) {
        resolved.push({ key, img });
        return { tex: {}, key, w: img.width, h: img.height, stamp: 1, bytes: 1, mipped: false };
      },
      texFromRegion() { return { tex: {}, key: '', w: 16, h: 16, stamp: 1, bytes: 1, mipped: false }; },
      texAlive() { return true; },
      pipeFboTex() { return {} as WebGLTexture; },
      liqGateParams() { /* 参数面 */ },
    } as unknown as GLSpriteLayer;
    emitVanillaLiquidGate(glw, 1280, 800);
    expect(resolved.length).toBe(fgCaps.length);
    for (let i = 0; i < fgCaps.length; i++) {
      expect(resolved[i].key).toBe(fgCaps[i].key);
      expect(resolved[i].img).toBe(fgCaps[i].img);   // 同一实例（WeakMap texId 稳定）
    }
    void bgCaps;
  });
});

describe('★liqgl 两臂采样一致性锁（批化全幅 UV vs shim er: 区域纹理 NEAREST 同 texel）', () => {
  // 批化臂:采样域 [sx−ε, sx+sw−ε)（sheet 坐标）,dst 像素 i 采 texel
  //   floor(sx−ε+(i+0.5)·sw/dw)（整数设备矩形;B1 quadExact 逐式论证同源）。
  // shim 臂:texFromRegion 抠 [sx,sx+sw) 成小纹理,quadSprite 采样域 [−ε, sw−ε):
  //   texel j=clamp(floor(−ε+(i+0.5)·sw/dw),0,sw−1),sheet texel=sx+j。
  // ε=2⁻¹²:仅【精确 tie】(采样点恰落 texel 整数) 翻档,两臂同向取 c−1 → 逐 texel 等价。
  const EPS = 1 / 4096;
  /** floor(x−ε) 的有理精确版:x 恰为整数 → x−1,否则 floor(x) */
  const floorTie = (x: number): number => (Number.isInteger(x) ? x - 1 : Math.floor(x));
  const batchTexel = (i: number, sx: number, sw: number, dw: number): number =>
    floorTie(sx - EPS + (i + 0.5) * (sw / dw));
  const regionTexel = (i: number, sx: number, sw: number, dw: number): number =>
    sx + Math.min(sw - 1, Math.max(0, floorTie((i + 0.5) * (sw / dw))));
  it('全档缩放×位置×宽度网格:两臂 NEAREST texel 序列逐位一致', () => {
    const scales = [1, 2, 0.5, 1.25, 0.8, 1.5, 2 / 3, 3];   // 2:1 整档 tie 全像素+分数档
    const positions = [0, 16, 32, 640];                     // sx=0（CLAMP 边）+ 带内/跨带
    const widths = [4, 8, 16];                              // 裁剪条/半砖/整格 sw
    for (const s of scales) {
      for (const sx of positions) {
        for (const sw of widths) {
          const dw = Math.max(1, Math.round(sw / s));
          for (let i = 0; i < dw; i++) {
            expect(batchTexel(i, sx, sw, dw)).toBe(regionTexel(i, sx, sw, dw));
          }
        }
      }
    }
  });
  it('结构锚:执行器批发射恒按 (batch.key, batch.img) 解析纹理;PRECIP_FS 预乘契约不被「补乘 α」', () => {
    // 键维度:entry 尺寸=img 尺寸由 texFromImage(key, img) 构造保证——执行器两处
    // 发射点（flushAcc/presentBatch）必须传 batch.img 本体（禁改传缓存/区域源）
    expect(GE.match(/glw\.texFromImage\(p\.batch\.key, p\.batch\.img as TexImageSource, false, true\)/g)?.length).toBe(2);
    // PRECIP_FS 契约:rgb 不再乘 vCol.a（预乘在构建侧;补乘=双重预乘=暗一档）
    expect(GS).toContain('outColor = vec4(c.rgb * vCol.rgb, c.a * vCol.a);');
    // batQuad 预乘 + 重放 unpre 配对
    expect(VL).toContain('const r0 = (cols ? cols[colOff] : 1) * a');
    expect(VL).toContain('(raw) => replayLiqRun2D(raw, s0, nQ, img, cols)');
  });
});
