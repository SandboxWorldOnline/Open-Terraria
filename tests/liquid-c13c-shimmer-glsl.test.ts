// ★C13c 微光波场 GLSL 化——结构锁+行为锁+数学锚（2026-10-01 二期刀;
// liquid-c13b-band-batch/liquid-gl-batch 判例同构）。
// node 可跑面：stride-11 微光环端到端（liqshim: 键族/预乘恒等/aTile 角/aNoise 节点值
// 对照）、CPU sin 减半计数锁、sparkGa 位等锚（方案 H 保留面与 polish 臂逐位同）、
// fg 复用缩放重发射（rgba 同步缩/场属性原样）、gate y 镜像重发射（stride 11）、
// 逃生门（?c13c=1 灰度激活/缺省关——CPU 原链逐位不动）。
// 像素对拍=scripts/_c13c-fieldgate.mjs（离线场值 readback 闸）+ scripts/_c13c-ab.mjs
// （整帧 A/B;node 无 GL/canvas）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { TileStore } from '../src/world/TileStore';
import type { SpriteAtlas } from '../src/assets/SpriteAtlas';
import type { GLSpriteLayer } from '../src/render/GLSpriteLayer';
import {
  drawVanillaLiquids, emitVanillaLiquidGate, resetLiquidBatchForFrame,
  liqC13cSetForTest, liqC13c, shimmerSparkBandForTest, tintSurfForTest, liqtintSetForTest,
  type LiqBatchEmit,
} from '../src/render/VanillaLiquidRenderer';
import { visEffectFrames, stepVisEffectTick } from '../src/entities/Enemy';
import { liqpolishSetForTest } from '../src/render/perfFlags';
import { TILE_DEFS } from '../src/data/tiles';

const VL = readFileSync(join(__dirname, '../src/render/VanillaLiquidRenderer.ts'), 'utf8');
const GS = readFileSync(join(__dirname, '../src/render/GLSpriteLayer.ts'), 'utf8');

/** 旗 init 快照（模块加载期取值=location 缺省域;afterEach 复位后的运行期值不可作
 *  init 判据——liquid-gl-batch 的 liqglDefault 判例同构） */
const liqC13cInit = liqC13c;

// ---------- 桩面（liquid-gl-batch 同族） ----------
const fakeAtlas = {
  ensureVImage: () => ({ width: 144, height: 1360 }),
} as unknown as SpriteAtlas;

function makeCtx() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const setLog: Array<{ k: string; v: unknown }> = [];
  const stub: Record<PropertyKey, unknown> = {};
  const handler: ProxyHandler<Record<PropertyKey, unknown>> = {
    get(t, prop) {
      if (prop === '__calls') return calls;
      if (prop === '__setLog') return setLog;
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push({ op: String(prop), args });
        if (prop === 'getTransform') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        return undefined;
      };
    },
    set(t, prop, v) { setLog.push({ k: String(prop), v }); t[prop] = v; return true; },
  };
  return { ctx: new Proxy(stub, handler) as unknown as CanvasRenderingContext2D, calls, setLog };
}

interface BatCap { img: unknown; key: string; data: Float32Array; quads: number; replay: unknown }
function mkBat(so: BatCap[], ao: BatCap[] = []): LiqBatchEmit {
  return {
    emit(img, key, data, quads, replay) {
      so.push({ img, key, data: data.slice(), quads, replay });
      return true;
    },
    emitAdd(img, key, data, quads, replay) {
      ao.push({ img, key, data: data.slice(), quads, replay });
      return true;
    },
  };
}

/** 大微光池（groundLevel 上方远;内域整格 tile 供 aTile 角精确断言） */
function makeShimmerPool(): TileStore {
  const st = new TileStore(140, 100);
  const dirt = TILE_DEFS.findIndex((d) => d?.key === 'dirt');
  const set = (x: number, y: number, t: number, liquid = 0, lt = 1) => {
    const i = st.idx(x, y);
    st.type[i] = t; st.flags[i] = t ? 1 : 0;
    st.liquid[i] = liquid; st.liquidType[i] = lt;
  };
  const x0 = 20, y0 = 30, w = 60, h = 12;
  for (let x = x0 - 2; x <= x0 + w + 1; x++) set(x, y0 + h, dirt);            // 池底
  for (let y = y0 - 2; y < y0; y++) for (let x = x0 - 2; x <= x0 + w + 1; x++) set(x, y, dirt);  // 顶板
  for (let x = x0 - 2; x < x0; x++) for (let y = y0; y < y0 + h; y++) set(x, y, dirt);   // 左壁
  for (let x = x0 + w; x <= x0 + w + 1; x++) for (let y = y0; y < y0 + h; y++) set(x, y, dirt);  // 右壁
  for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) set(x, y, 0, 255, 4);  // 微光
  return st;
}

/** 开顶微光池（地表开放式:空气上表面 → 表层 flag=true 保留域在池;实测 diag 面:
 *  top/edge 亮面≈89 ADD quad + body 亮面≈256 shim quad） */
function makeOpenPool(): TileStore {
  const st = new TileStore(140, 100);
  const dirt = TILE_DEFS.findIndex((d) => d?.key === 'dirt');
  const set = (x: number, y: number, t: number, liquid = 0, lt = 1) => {
    const i = st.idx(x, y);
    st.type[i] = t; st.flags[i] = t ? 1 : 0;
    st.liquid[i] = liquid; st.liquidType[i] = lt;
  };
  for (let x = 0; x < 140; x++) set(x, 45, dirt);            // 地面
  for (let x = 20; x <= 80; x++) for (let y = 30; y <= 44; y++) set(x, y, 0, 255, 4);  // 开顶微光池
  return st;
}

/** SimpleWhiteNoise 参照实现（与 VanillaLiquidRenderer.shimmerWhiteNoise 零共享,防同源盲区;
 *  LiquidRenderer.cs:793-797 uint 乘加混淆 1:1） */
function refNoise(x: number, y: number): number {
  let ux = Math.abs(Math.floor(x)) >>> 0, uy = Math.abs(Math.floor(y)) >>> 0;
  ux = (36469 * (ux & 0xffff) + (ux >>> 16)) >>> 0;
  uy = (18012 * (uy & 0xffff) + (uy >>> 16)) >>> 0;
  return (((ux << 16) >>> 0) + uy) >>> 0;
}

/** GetShimmerWave 参照（LiquidRenderer.cs:761-763 1:1,零共享） */
function refWave(x: number, y: number, tVis: number): number {
  return Math.sin(((x + y / 6) / 10 - tVis / 360) * Math.PI * 2);
}

/** GetShimmerGlitterOpacity 体部式参照（LiquidRenderer.cs:773-790 非 top 支 1:1,零共享;
 *  ★四期修正（2026-10-07）:aNoise 槽载本值（四角终值,含钳制）,FS 消费硬件 varying
 *  插值=原版 SetShimmerVertexColors_Sparkle 顶点色插值域） */
function refGlitter(x: number, y: number, tVis: number): number {
  const num = Math.max(0, Math.min(1, (refWave(x, y, tVis) + 0.5) / 1.5)) * 0.35;
  const num2 = Math.sin(refNoise(x, y) / 10 + tVis / 180);
  return Math.max(0, Math.min(1, (num * num2) / 0.5));
}

beforeAll(() => {
  if (!(globalThis as unknown as { Image?: unknown }).Image) {
    (globalThis as unknown as { Image: unknown }).Image = class {
      src = ''; width = 0; height = 0; complete = false;
      addEventListener() { /* noop */ }
      removeEventListener() { /* noop */ }
    };
  }
  // ★钉钟:visEffectFrames 缺省 wall-clock 兜底（Game 未启动）——推一 tick 切计数器域
  //  （counter>0 恒返整数）= tVis 测试内恒定,aNoise 参照可比（跨相位时钟管线判例）
  stepVisEffectTick();
});

afterEach(() => {
  liqC13cSetForTest(false);   // 旗复位（=?c13c=0 逃生门域;init 缺省开由 liqC13cInit 快照锁）
  liqpolishSetForTest(false); // node 惯例复位（perfFlags 族测试环境恒关）
  shimmerSparkBandForTest(undefined);   // ★三期带钩清面（生产路径恢复）
  tintSurfForTest(null, null, null);    // ★BJ738 着色面清面（生产路径恢复）
  liqtintSetForTest(true);              // node init 域复位（location 缺省 true 同款）
  resetLiquidBatchForFrame(-1);
});

/** c13c 臂点亮（c13cOn=liqC13c∧polish——polish 是臂域基座;node 缺省关须显式开） */
function c13cArm(on: boolean): void {
  liqpolishSetForTest(true);
  liqC13cSetForTest(on);
}

// ---------- 行为锁 ----------
describe('★C13c 微光批环端到端（drawVanillaLiquids + bat 钩,c13c 开）', () => {
  it('批捕获:微光基体落 liqshim: 段（stride 66/quad）;预乘恒等 rgb===a;aTile 单调域', () => {
    c13cArm(true);
    const st = makeShimmerPool();
    const caps: BatCap[] = [];
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(71);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 71, null, mkBat(caps), false);
    const shimRuns = caps.filter((c) => c.key.startsWith('liqshim:'));
    expect(shimRuns.length).toBeGreaterThanOrEqual(1);
    expect(caps.some((c) => c.key.startsWith('liq:'))).toBe(false);   // 微光不进主环
    let quads = 0;
    for (const c of shimRuns) {
      expect(c.data.length).toBe(c.quads * 66);   // ★stride 11
      for (let q = 0; q < c.quads; q++) {
        const o = q * 66;
        const a = c.data[o + 7];
        expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
        for (let v = 0; v < 6; v++) {
          const vo = o + v * 11;
          // 预乘恒等式（§3.3 锁域;场调制全进 FS,vCol.rgb 不进乘链）
          expect(c.data[vo + 4]).toBe(a);
          expect(c.data[vo + 5]).toBe(a);
          expect(c.data[vo + 6]).toBe(a);
          // aTile/aNoise 域合法
          expect(Number.isFinite(c.data[vo + 8])).toBe(true);
          expect(Number.isFinite(c.data[vo + 9])).toBe(true);
          const n = c.data[vo + 10];
          expect(n).toBeGreaterThanOrEqual(-1); expect(n).toBeLessThanOrEqual(1);
        }
        // aTile 单调（tx0≤tx1,ty0≤ty1——世界矩形非反转）
        expect(c.data[o + 8]).toBeLessThanOrEqual(c.data[o + 19]);
        expect(c.data[o + 9]).toBeLessThanOrEqual(c.data[o + 64]);
        quads++;
      }
    }
    expect(quads).toBeGreaterThan(50);
  });

  it('aNoise=节点 noise-sin（f32 化）对照参照实现;内域整格 aTile 角=(x,y)..(x+1,y+1)', () => {
    c13cArm(true);
    const st = makeShimmerPool();
    const caps: BatCap[] = [];
    const { ctx } = makeCtx();
    const tVis = visEffectFrames();
    resetLiquidBatchForFrame(72);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 72, null, mkBat(caps), false);
    const shim = caps.find((c) => c.key.startsWith('liqshim:'))!;
    expect(shim).toBeDefined();
    // 内域整格 tile (40,35):dstX=x*16/dstY=y*16（邻液全满 n2=n4=0）→ aTile 角=节点精确
    const x = 40, y = 35;
    let found = -1;
    for (let q = 0; q < shim.quads; q++) {
      const o = q * 66;
      if (shim.data[o + 8] === x && shim.data[o + 9] === y
        && shim.data[o + 19] === x + 1 && shim.data[o + 64] === y + 1) { found = o; break; }
    }
    expect(found).toBeGreaterThanOrEqual(0);
    const o = found;
    // 角序 TL,TR,BR,BL=节点 (x,y),(x+1,y),(x+1,y+1),(x,y+1)（原版节点值置位于 quad 角,R2b-F5）
    const nodes: Array<[number, number, number]> = [
      [x, y, o + 10], [x + 1, y, o + 21], [x + 1, y + 1, o + 32], [x, y + 1, o + 65],
    ];
    for (const [nx, ny, off] of nodes) {
      const ref = Math.sin(refNoise(nx, ny) / 10 + tVis / 180);
      expect(shim.data[off]).toBe(Math.fround(ref));   // f64 sin→f32 环写
    }
    // aTile 角（顶点 v0/v1/v5=TL/TR/BL;v2=BR）
    expect(shim.data[o + 8]).toBe(x); expect(shim.data[o + 9]).toBe(y);
    expect(shim.data[o + 19]).toBe(x + 1); expect(shim.data[o + 20]).toBe(y);
    expect(shim.data[o + 63]).toBe(x); expect(shim.data[o + 64]).toBe(y + 1);
  });

  it('CPU sin 减半:c13c 开 < 关（同池同帧 bg pass Math.sin 调用计数）', () => {
    const st = makeShimmerPool();
    const runArm = (on: boolean, token: number): number => {
      c13cArm(on);
      const caps: BatCap[] = [];
      const { ctx } = makeCtx();
      resetLiquidBatchForFrame(token);
      const spy = vi.spyOn(Math, 'sin');
      try {
        drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
          undefined, false, undefined, token, null, mkBat(caps), false);
      } finally {
        // ★先取计数再 restore（mockRestore 清 mock.calls 历史）
      }
      const n = spy.mock.calls.length;
      spy.mockRestore();
      return n;
    };
    const off = runArm(false, 81);
    const on = runArm(true, 82);
    expect(off).toBeGreaterThan(0);
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(off);   // 方案 H:波值 4 sin 上 GPU,噪声 4 sin 留 CPU
    console.log(`[c13c sin count] off=${off} on=${on} reduction=${((1 - on / off) * 100).toFixed(1)}%`);
  });

  it('sparkGa 位等锚:sparkle α 序列 c13c 开/关逐位同（方案 H 保留面;node 无 document→CPU 亮面）', () => {
    const st = makeShimmerPool();
    const draw = (on: boolean, token: number): Array<{ k: string; v: unknown }> => {
      c13cArm(on);
      const so: BatCap[] = [];
      const ao: BatCap[] = [];
      const { ctx, setLog } = makeCtx();
      resetLiquidBatchForFrame(token);
      drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, false, 0, 0,
        undefined, false, undefined, token, null, mkBat(so, ao), false);
      // sparkle α=min(1,opacity×sparkGa)<1 的 globalAlpha 赋值序（批收口/基面恒置 1,
      // 滤出后=纯 sparkle α 序列,逐位可比）
      return setLog.filter((s) => s.k === 'globalAlpha' && typeof s.v === 'number' && (s.v as number) < 1);
    };
    const gaOff = draw(false, 91);
    const gaOn = draw(true, 92);
    expect(gaOff.length).toBeGreaterThan(0);   // 亮面 tile 在场（parity 半域+均值>0.02）
    expect(gaOn.length).toBe(gaOff.length);
    for (let i = 0; i < gaOff.length; i++) {
      expect(gaOn[i].v).toBe(gaOff[i].v);   // 逐位（glitter4FromWaves 同代码路径）
    }
  });

  it('2D 降级重放:微光段逐 quad drawImage+2×2 multiply（场色子块中心求值）', () => {
    c13cArm(true);
    const st = makeShimmerPool();
    const caps: BatCap[] = [];
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(95);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 95, null, mkBat(caps), false);
    const shim = caps.find((c) => c.key.startsWith('liqshim:'))!;
    expect(shim).toBeDefined();
    const rctx = makeCtx();
    (shim.replay as (c: CanvasRenderingContext2D) => void)(rctx.ctx);
    expect(rctx.calls[0].op).toBe('save');
    expect(rctx.calls[rctx.calls.length - 1].op).toBe('restore');
    const draws = rctx.calls.filter((c) => c.op === 'drawImage');
    const mults = rctx.calls.filter((c) => c.op === 'fillRect');
    expect(draws.length).toBe(shim.quads);
    expect(mults.length).toBe(shim.quads * 4);   // 2×2 子块/quad
  });

  it('★BJ738 liqtint:微光段重放双线性梯度(四角求值+整窗源矩形;子块 fillRect 退役)', () => {
    c13cArm(true);
    const tintData = new Uint8ClampedArray(16);
    let puts = 0;
    const FAKE_CV = { width: 2, height: 2 } as HTMLCanvasElement;
    tintSurfForTest(FAKE_CV, { putImageData: () => { puts++; } }, { data: tintData });
    const st = makeShimmerPool();
    const caps: BatCap[] = [];
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(95);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 95, null, mkBat(caps), false);
    const shim = caps.find((c) => c.key.startsWith('liqshim:'))!;
    expect(shim).toBeDefined();
    const rctx = makeCtx();
    (shim.replay as (c: CanvasRenderingContext2D) => void)(rctx.ctx);
    const draws = rctx.calls.filter((c) => c.op === 'drawImage');
    const tints = draws.filter((c) => c.args[0] === FAKE_CV);
    const texs = draws.filter((c) => c.args[0] !== FAKE_CV);
    expect(texs.length).toBe(shim.quads);          // 纹理笔不变
    expect(tints.length).toBe(shim.quads);         // 梯度笔=每 quad 一笔
    expect(rctx.calls.filter((c) => c.op === 'fillRect').length).toBe(0);   // 子块退役
    expect(puts).toBe(shim.quads);                 // 每 quad 一写 2×2 面
    for (const d of tints) {                       // 环角色已按裁剪角采样→源矩形整窗
      expect(d.args[1]).toBe(0); expect(d.args[2]).toBe(0);
      expect(d.args[3]).toBe(2); expect(d.args[4]).toBe(2);
    }
    // 末 quad 角字节 = FS 同式四角求值（refWave 参照;LIQSHIM_FS SHIM_A/SHIM_DV 常量）
    const tVis = visEffectFrames();
    const o = (shim.quads - 1) * 66;
    const tx0 = shim.data[o + 8], ty0 = shim.data[o + 9];
    const tx1 = shim.data[o + 19], tyB = shim.data[o + 64];
    const SA = [0.64705884, 0.50980393, 0.93333333];
    const SD = [0.80392158 - SA[0], 0.80392158 - SA[1], 1 - SA[2]];
    const kAt = (tx: number, ty: number): number => 0.1 + refWave(tx, ty, tVis) * 0.4;
    const cAt = (tx: number, ty: number): number[] => SA.map((a, i) => 255 * (a + SD[i] * kAt(tx, ty)));
    const exp = [cAt(tx0, ty0), cAt(tx1, ty0), cAt(tx0, tyB), cAt(tx1, tyB)];
    for (let ci = 0; ci < 4; ci++) {
      for (let ch = 0; ch < 3; ch++) {
        expect(tintData[ci * 4 + ch]).toBe(Math.round(exp[ci][ch]));
      }
      expect(tintData[ci * 4 + 3]).toBe(255);      // 不透明 α(multiply 全乘语义)
    }
    // 逃生门:?liqtint=0 → 面零消费(回退子块路径=上测试域)
    liqtintSetForTest(false);
    const rctx2 = makeCtx();
    (shim.replay as (c: CanvasRenderingContext2D) => void)(rctx2.ctx);
    const putsAfter = puts;
    (shim.replay as (c: CanvasRenderingContext2D) => void)(makeCtx().ctx);
    expect(puts).toBe(putsAfter);                  // 旗关不再写面
    liqtintSetForTest(true);
  });
});

describe('★C13c fg 复用 + gate 重发射（stride 11 同步面）', () => {
  it('fg 复用:shim 段缩放重发射（rgba 同步×k,aTile/aNoise 逐位原样）', () => {
    c13cArm(true);
    const st = makeShimmerPool();
    const bgCaps: BatCap[] = [];
    const fgCaps: BatCap[] = [];
    const mk = (sink: BatCap[]): LiqBatchEmit => ({
      emit(img, key, data, quads, replay) {
        sink.push({ img, key, data: data.slice(), quads, replay });
        return true;
      },
    });
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(101);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 101, null, mk(bgCaps), false);   // bg:录账
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, false, 0, 0,
      undefined, false, undefined, 101, null, mk(fgCaps), false);   // fg:复用重发射
    const bgShim = bgCaps.filter((c) => c.key.startsWith('liqshim:'));
    const fgShim = fgCaps.filter((c) => c.key.startsWith('liqshim:'));
    expect(bgShim.length).toBeGreaterThanOrEqual(1);
    // fg 复用账只重发射主循环段（浸润带微光段=bg 专属,flushShimBandRun 不录账——
    // 与 flushBandRun 同语义）;故 fgShim ⊆ bgShim,按键族配对。
    expect(fgShim.length).toBeGreaterThanOrEqual(1);
    for (const fr of fgShim) {
      const bg = bgShim.find((b) => b.key === fr.key);
      expect(bg).toBeDefined();
      expect(fr.quads).toBe(bg!.quads);
      for (let q = 0; q < bg!.quads; q++) {
        for (let v = 0; v < 6; v++) {
          const s = q * 66 + v * 11;
          const aB = bg!.data[s + 7], aF = fr.data[s + 7];
          expect(aF).toBeCloseTo(aB * 0.75, 6);   // DEFAULT_OPACITY[3] 缩放
          expect(fr.data[s + 4]).toBe(aF); // 预乘恒等保持（rgba 同步缩）
          expect(fr.data[s + 8]).toBe(bg!.data[s + 8]);   // aTile 原样
          expect(fr.data[s + 9]).toBe(bg!.data[s + 9]);
          expect(fr.data[s + 10]).toBe(bg!.data[s + 10]); // aNoise 原样
        }
      }
    }
  });

  it('gate 重发射:shim 段 y 镜像逐顶点（aTile/aNoise 随镜像不变,§3.3;★BJ743 数据源=run.data 发射切片=fg 缩放域）', () => {
    c13cArm(true);
    const st = makeShimmerPool();
    const bgCaps: BatCap[] = [];
    const fgCaps: BatCap[] = [];
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(111);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 111, null, mkBat(bgCaps), true);   // bg:足迹收集
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, false, 0, 0,
      undefined, true, undefined, 111, null, mkBat(fgCaps),
      true);   // fg:warpMode=批段登记
    const bgShim = bgCaps.filter((c) => c.key.startsWith('liqshim:'));
    const fgShim = fgCaps.filter((c) => c.key.startsWith('liqshim:'));
    expect(bgShim.length).toBeGreaterThanOrEqual(1);
    expect(fgShim.length).toBeGreaterThanOrEqual(1);   // 复用臂在走（重发射=录账段集）
    const H = 800;
    const batches: Array<{ data: Float32Array; quads: number }> = [];
    const fboTex = {} as WebGLTexture;
    const glw = {
      unavailable: false,
      begin() { /* 绑定卫生在前例覆盖 */ },
      isAccumOpen(name: string) { return name === 'world'; },
      quadSprite() { /* 足迹面（c13b/liqgl 前例覆盖） */ },
      quadBatchRgba(_e: unknown, data: Float32Array, quads: number) {
        batches.push({ data: data.slice(), quads });
        return true;
      },
      texFromImage(key: string) { return { tex: {}, key, w: 144, h: 1360, stamp: 1, bytes: 1, mipped: false }; },
      texFromRegion(key: string) { return { tex: {}, key, w: 16, h: 16, stamp: 1, bytes: 1, mipped: false }; },
      texAlive() { return true; },
      pipeFboTex() { return fboTex; },
      liqGateParams() { /* 参数面 */ },
    } as unknown as GLSpriteLayer;
    const handle = emitVanillaLiquidGate(glw, 1280, H);
    expect(handle).not.toBeNull();
    const shimBatches = batches.filter((b) => b.data.length === b.quads * 66);
    // ★BJ743（2026-10-30）勘正:gate 重发射读 run.data=发射数据切片（复用臂
    // =_fgReuseShimRing 缩放后数据,α=fg 值 0.75——旧读法=bg 环域 α=bg 值,obj19
    // ×100 饱和域恰无视觉差;罩源 α 语义面（BJ743）要求数据面钉正）
    expect(shimBatches.length).toBe(fgShim.length);   // shim 段走 stride-11 槽
    for (let r = 0; r < fgShim.length; r++) {
      const fg = fgShim[r];
      expect(shimBatches[r].quads).toBe(fg.quads);
      for (let q = 0; q < fg.quads; q++) {
        for (let v = 0; v < 6; v++) {
          const s = q * 66 + v * 11;
          expect(shimBatches[r].data[s]).toBe(fg.data[s]);
          expect(shimBatches[r].data[s + 1]).toBeCloseTo(H - fg.data[s + 1], 6);   // y 镜像
          for (let k = 2; k < 11; k++) expect(shimBatches[r].data[s + k]).toBe(fg.data[s + k]);
        }
      }
    }
  });
});

// ---------- ★三期 sparkle 亮纹逐像素化（2026-10-02） ----------
describe('★C13c 三期 sparkle 亮纹段（body 域 FS glitter 逐像素;top 域照旧 CPU）', () => {
  const FAKE_BAND = { width: 96, height: 1360 } as HTMLCanvasElement;

  it('body 域（flag=false 奇偶亮面）→ liqspark: 亮纹段 stride 66;顶点 α 只载 opacity,rgb=hue×α 预乘族', () => {
    c13cArm(true);
    shimmerSparkBandForTest(FAKE_BAND);
    const st = makeShimmerPool();
    const so: BatCap[] = [];
    const ao: BatCap[] = [];
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(131);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 131, null, mkBat(so, ao), false);
    const sparkShim = ao.filter((c) => c.key.startsWith('liqspark:') && c.data.length === c.quads * 66);
    expect(sparkShim.length).toBeGreaterThanOrEqual(1);   // 内域 58×10 格奇偶亮面在场
    let quads = 0;
    for (const c of sparkShim) {
      for (let q = 0; q < c.quads; q++) {
        const o = q * 66;
        const a = c.data[o + 7];
        expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
        for (let v = 0; v < 6; v++) {
          const vo = o + v * 11;
          const r = c.data[vo + 4], g = c.data[vo + 5], b = c.data[vo + 6];
          // rgb=hue×α 预乘族（≤α;hue 16 档表值可含 0 分量——hslToRgb(0,1,0.5)=(1,0,0)）
          expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(a + 1e-6);
          expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThanOrEqual(a + 1e-6);
          expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(a + 1e-6);
          expect(r + g + b).toBeGreaterThan(0);   // hue 表恒有非零通道（l=0.5）
          expect(Number.isFinite(c.data[vo + 8])).toBe(true);
          expect(Number.isFinite(c.data[vo + 9])).toBe(true);
          const n = c.data[vo + 10];
          // ★四期（2026-10-07）:aNoise 槽=四角 glitter 终值（remap 输出域 [0,1]）
          expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(1);
        }
        quads++;
      }
    }
    expect(quads).toBeGreaterThan(20);
  });

  it('top/edge 保留域照旧 ADD 段（stride 48,α=0.5 常驻）;发射 tile 集不变:开=48+66 关=48 计数恒等', () => {
    const st = makeOpenPool();
    const runArm = (on: boolean, token: number): { n48: number; n66: number } => {
      c13cArm(on);
      shimmerSparkBandForTest(FAKE_BAND);
      const so: BatCap[] = [];
      const ao: BatCap[] = [];
      const { ctx } = makeCtx();
      resetLiquidBatchForFrame(token);
      drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
        undefined, false, undefined, token, null, mkBat(so, ao), false);
      let n48 = 0, n66 = 0;
      for (const c of ao) {
        if (!c.key.startsWith('liqspark:')) continue;
        if (c.data.length === c.quads * 66) n66 += c.quads;
        else if (c.data.length === c.quads * 48) n48 += c.quads;
      }
      return { n48, n66 };
    };
    const off = runArm(false, 141);
    const on = runArm(true, 142);
    expect(off.n48).toBeGreaterThan(0);   // 全 sparkle 走 ADD 段
    expect(off.n66).toBe(0);
    expect(on.n66).toBeGreaterThan(0);    // body 域改亮纹段
    expect(on.n48).toBeGreaterThan(0);    // top/edge 保留域仍在 ADD 段
    expect(on.n48 + on.n66).toBe(off.n48);   // doSpark 门不变=发射 tile 集不变
  });

  it('aNoise=四角 GetShimmerGlitterOpacity 终值对照参照（★四期 2026-10-07 钳制后插值语义）;\
aTile 整角 quad=节点 (x,y)..(x+1,y+1) 精确', () => {
    c13cArm(true);
    shimmerSparkBandForTest(FAKE_BAND);
    const st = makeShimmerPool();
    const so: BatCap[] = [];
    const ao: BatCap[] = [];
    const { ctx } = makeCtx();
    const tVis = visEffectFrames();
    resetLiquidBatchForFrame(151);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 151, null, mkBat(so, ao), false);
    const sparkShim = ao.filter((c) => c.key.startsWith('liqspark:') && c.data.length === c.quads * 66);
    expect(sparkShim.length).toBeGreaterThanOrEqual(1);
    // 扫任一整角 quad（body 域满格无裁剪无 bob→aTile 角=整数节点;均值门逐 tVis 波动
    //  会剔除特定 tile——固定 (40,34) 判据会随相位漂,故扫全集取首个）
    let checked = 0;
    for (const c of sparkShim) {
      for (let q = 0; q < c.quads && checked < 8; q++) {
        const o = q * 66;
        const x0 = c.data[o + 8], y0 = c.data[o + 9];
        if (c.data[o + 19] !== x0 + 1 || c.data[o + 64] !== y0 + 1) continue;   // 非整角
        if (!Number.isInteger(x0) || !Number.isInteger(y0)) continue;
        // 角序 TL,TR,BR,BL=节点 (x,y),(x+1,y),(x+1,y+1),(x,y+1)（sparkleShimQuad 写序）
        // ★四期:值=GetShimmerGlitterOpacity 体部式逐角终值（remap(remap(w)×n,0,0.5,0,1),
        //  含钳制——原版 SetShimmerVertexColors_Sparkle 置位 quad 角的值;FS 消费硬件
        //  varying 插值=原版顶点色插值 1:1）
        const nodes: Array<[number, number, number]> = [
          [x0, y0, o + 10], [x0 + 1, y0, o + 21], [x0 + 1, y0 + 1, o + 32], [x0, y0 + 1, o + 65],
        ];
        for (const [nx, ny, off] of nodes) {
          const ref = refGlitter(nx, ny, tVis);
          expect(c.data[off]).toBe(Math.fround(ref));   // f64 →f32 环写
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('2D 降级重放:lighter+2×2 子块 glitter α（白闪退化域）;基体 multiply 面不串', () => {
    c13cArm(true);
    shimmerSparkBandForTest(FAKE_BAND);
    const st = makeShimmerPool();
    const so: BatCap[] = [];
    const ao: BatCap[] = [];
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(161);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 161, null, mkBat(so, ao), false);
    const sparkShim = ao.find((c) => c.key.startsWith('liqspark:') && c.data.length === c.quads * 66);
    expect(sparkShim).toBeDefined();
    const rctx = makeCtx();
    (sparkShim!.replay as (c: CanvasRenderingContext2D) => void)(rctx.ctx);
    expect(rctx.calls[0].op).toBe('save');
    expect(rctx.calls[rctx.calls.length - 1].op).toBe('restore');
    expect(rctx.setLog.some((s) => s.k === 'globalCompositeOperation' && s.v === 'lighter')).toBe(true);
    expect(rctx.setLog.some((s) => s.k === 'globalCompositeOperation' && s.v === 'multiply')).toBe(false);
    const draws = rctx.calls.filter((c) => c.op === 'drawImage');
    expect(draws.length).toBeGreaterThanOrEqual(1);
    expect(draws.length).toBeLessThanOrEqual(sparkShim!.quads * 4);   // 2×2 子块,g=0 子块跳过
    // 子块 α=ga×g ∈ (0,1]（globalAlpha 赋值域）
    for (const s of rctx.setLog) {
      if (s.k === 'globalAlpha' && typeof s.v === 'number') {
        expect(s.v).toBeGreaterThan(0);
        expect(s.v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fg 复用:亮纹段逐位重发射（α 双 pass 同值=不缩放;_bgSparkShim 账）', () => {
    c13cArm(true);
    shimmerSparkBandForTest(FAKE_BAND);
    const st = makeShimmerPool();
    const bgCaps: BatCap[] = [];
    const fgCaps: BatCap[] = [];
    const mk = (sink: BatCap[]): LiqBatchEmit => ({
      emit(img, key, data, quads, replay) {
        sink.push({ img, key, data: data.slice(), quads, replay });
        return true;
      },
      emitAdd(img, key, data, quads, replay) {
        sink.push({ img, key, data: data.slice(), quads, replay });
        return true;
      },
    });
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(171);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 171, null, mk(bgCaps), false);   // bg:录账
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, false, 0, 0,
      undefined, false, undefined, 171, null, mk(fgCaps), false);   // fg:复用重发射
    const bgSpark = bgCaps.filter((c) => c.key.startsWith('liqspark:') && c.data.length === c.quads * 66);
    const fgSpark = fgCaps.filter((c) => c.key.startsWith('liqspark:') && c.data.length === c.quads * 66);
    expect(bgSpark.length).toBeGreaterThanOrEqual(1);
    expect(fgSpark.length).toBe(bgSpark.length);
    for (let i = 0; i < fgSpark.length; i++) {
      expect(fgSpark[i].quads).toBe(bgSpark[i].quads);
      expect(fgSpark[i].data).toEqual(bgSpark[i].data);   // 逐位（Float32Array 同值）
      expect(fgSpark[i].img).toBe(bgSpark[i].img);        // 同一带纹理实例
    }
  });
});

// ---------- 逃生门/转正缺省域 ----------
describe('★C13c 逃生门与转正缺省', () => {
  it('缺省开（2026-10-02 转正;?c13c=0 逃生门）:node 无 location → init true（liqgl/liqC13b 族形态）', () => {
    expect(liqC13cInit).toBe(true);
  });

  it('?c13c=0 逃生门:无 liqshim 段;现行 liq: 微光段（顶点色调制域）原样（回退臂逐位保留锁）', () => {
    const st = makeShimmerPool();
    const caps: BatCap[] = [];
    const { ctx } = makeCtx();
    resetLiquidBatchForFrame(121);
    drawVanillaLiquids(ctx, fakeAtlas, st, 10, 5, 5, 130, 70, 1000, true, 0, 0,
      undefined, false, undefined, 121, null, mkBat(caps), false);
    expect(caps.filter((c) => c.key.startsWith('liqshim:')).length).toBe(0);
    const liqRuns = caps.filter((c) => c.key.startsWith('liq:'));
    expect(liqRuns.length).toBeGreaterThanOrEqual(1);   // liqgl 刀2 现行链
    let quads = 0;
    for (const c of liqRuns) {
      expect(c.data.length).toBe(c.quads * 48);   // 主环 stride 8
      quads += c.quads;
    }
    expect(quads).toBeGreaterThan(50);
  });
});

// ---------- 结构锁（源码锚;防并行会话漂移） ----------
describe('★C13c 结构锁', () => {
  it('VanillaLiquidRenderer:旗/stride-11 环/shimQuad/段收口/复用/gate/带臂锚', () => {
    expect(VL).toContain("get('c13c') !== '0'");   // ★转正（2026-10-02）:?c13c=0 逃生门形态
    expect(VL).toContain('export function liqC13cSetForTest(');
    expect(VL).toContain('const LIQ_SHIM_STRIDE = 11');
    expect(VL).toContain('const LIQ_SHIM_QUAD_FLOATS = 6 * LIQ_SHIM_STRIDE');
    expect(VL).toContain('let _shimRing: Float32Array | null = null');
    expect(VL).toContain('function ensureShimRings(): void');
    expect(VL).toContain('function shimQuad(');
    expect(VL).toContain('function replayLiqShimRun2D(');
    expect(VL).toContain('function emitShimRun(');
    expect(VL).toContain('const flushShimRun = (): void => {');
    expect(VL).toContain('const flushShimBandRun = (): void => {');
    expect(VL).toContain('_shimN = 0; _shimOn = false; _shimImg = null;');
    expect(VL).toContain('const c13cOn = liqC13c && polish;');
    expect(VL).toContain('if (polish && !c13cOn) {');
    expect(VL).toContain('if (batOn && c13cOn) {');
    expect(VL).toContain('if (_shimOn && _shimImg !== tex) flushShimRun();');
    expect(VL).toContain("if (!_shimOn) { _shimOn = true; _shimStart = _shimN; _shimImg = tex; _shimKey = `liqshim:${texId(tex)}`; }");
    expect(VL).toContain('setLiqShimmerTVis(tVis);');
    expect(VL).toContain('if (c13cOn) flushShimRun();   // ★C13c:微光段收尾');
    expect(VL).toContain('if (bandBatOn && liqC13c) {');
    expect(VL).toContain('_shimKey = `liqshim:${texId(drawTex)}`; }');
    expect(VL).toContain('if (bandBatOn && liqC13c) flushShimBandRun();   // ★C13c:带微光段收尾');
    expect(VL).toContain('shim?: boolean; data?: Float32Array; }');
    expect(VL).toContain('cols: boolean; shim?: boolean }');
    expect(VL).toContain('if (r.shim) {');
    expect(VL).toContain('if (run.shim) {');
    expect(VL).toContain('const G = _gateShimData!;');
    expect(VL).toContain('const S = _shimRing!, D = _fgReuseShimRing!;');
    expect(VL).toContain('if (!ok) replayLiqShimRun2D(ctx, s0, nQ, img);');
    expect(VL).toContain('shim: true });');
  });

  it('★三期 sparkle 亮纹段锚（2026-10-02）:环/quad/重放/收口/复用/uSpark 分派/带钩', () => {
    expect(VL).toContain('let _spShimRing: Float32Array | null = null;');
    expect(VL).toContain('let _spShimMeta: Float32Array | null = null;');
    expect(VL).toContain('let _spShimN = 0;');
    expect(VL).toContain('function sparkleShimQuad(');
    expect(VL).toContain('function replayLiqSparkShimRun2D(');
    expect(VL).toContain('_spShimRing = new Float32Array(LIQ_RING_CAP * LIQ_SHIM_QUAD_FLOATS);');
    expect(VL).toContain("_spShimKey = `liqspark:${texId(band)}`;");
    expect(VL).toContain('if (c13cOn && !flag && batOn && !_addOverflow) {');
    expect(VL).toContain('sparkleShimQuad(sx, sSrcY, sw, sh, band.width, band.height,');
    expect(VL).toContain('_spShimQuads++;');
    expect(VL).toContain('if (_spShimOn) {');
    expect(VL).toContain('else if (record) _bgSparkShim = { start: s0, quads: nQ, img, key: k };');
    expect(VL).toContain('if (_bgSparkShim && bat.emitAdd) {');
    expect(VL).toContain('_spShimN = 0; _spShimOn = false; _spShimQuads = 0; _spShimImg = null; _spShimKey = \'\';');
    expect(VL).toContain('_bgSparkShim = null;');
    expect(VL).toContain('export function shimmerSparkBandForTest(');
    // 保留域照旧 CPU（top/edge 常驻 ADD 段+均值 α 载体支不删）
    expect(VL).toContain('} else if (polish && batOn && !_addOverflow) {');
    expect(VL).toContain('const gaS = Math.min(1, opacity[i] * sparkGa);');
  });

  it('★三期 GLSpriteLayer:uSpark uniform/段键分派/亮纹 FS 消费锚', () => {
    expect(GS).toContain('uniform float uSpark;');
    expect(GS).toContain("for (const n of ['uCanvas', 'uTex', 'uTVis', 'uSpark']) this.shimUni[n] = this.pipe.uni(p, n);");
    expect(GS).toContain("for (const n of ['uCanvas', 'uTex', 'uTVis', 'uSpark']) this.shimUni[n] = gl.getUniformLocation(prog, n);");
    expect(GS).toContain("e.key ?? '').startsWith('liqspark:') ? 1 : 0");
    // ★四期（2026-10-07 果冻感回归定谳）:g=四角 glitter 终值硬件插值（原版钳制后插值
    //  语义;旧 FS 内 remap(remap(w)×插值噪声)=插值后钳制=系统性变暗+折痕高频化已废）
    expect(GS).toContain('float g = vNoise;');
    expect(GS).toContain('outColor = vec4(c.rgb * vCol.rgb * g, c.a * vCol.a * g);');
    // 基体主式不动（rgb===a 预乘恒等域 §3.3）
    expect(GS).toContain('outColor = vec4(c.rgb * field * vCol.a, c.a * vCol.a);');
  });

  it('GLSpriteLayer:程序常量/惰性装配/发射口/分派/失败面/dispose 锚', () => {
    expect(GS).toContain("pipe.program('sprite:liqshimmer', LIQSHIM_VS, LIQSHIM_FS)");
    expect(GS).toContain('const LIQSHIM_VS = `#version 300 es');
    expect(GS).toContain('const LIQSHIM_FS = `#version 300 es');
    expect(GS).toContain('layout(location=3) in vec2 aTile;');
    expect(GS).toContain('layout(location=4) in float aNoise;');
    expect(GS).toContain('precision highp float;');   // §5 风险2:FS 强制 highp
    expect(GS).toContain('uniform float uTVis;');
    expect(GS).toContain('const float TAU = 6.283185307179586;');
    expect(GS).toContain('export const LIQSHIM_VS_SRC = LIQSHIM_VS;');
    expect(GS).toContain('export const LIQSHIM_FS_SRC = LIQSHIM_FS;');
    expect(GS).toContain('export function setLiqShimmerTVis(v: number): void');
    expect(GS).toContain('private ensureLiqShim(): boolean {');
    expect(GS).toContain('if (data.length === quads * 66) return this.quadBatchLiqShimmer(e, data, quads);');
    expect(GS).toContain('quadBatchLiqShimmer(e: TexEntry, data: Float32Array, quads: number): boolean {');
    expect(GS).toContain('gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 44, 32);');
    expect(GS).toContain('gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 44, 40);');
    expect(GS).toContain('if (this.shimFail) return false;');
    expect(GS).toContain('if (this.shimProg) this.gl.deleteProgram(this.shimProg);');
    expect(GS).toContain('if (this.shimVao) gl.deleteVertexArray(this.shimVao);');
    expect(GS).toContain('this.shimProgHandle = null;');
  });

  it('现行锁不回退:liqgl 刀2/C13b/liqpolish 结构锚保持（既有套件串仍在盘）', () => {
    expect(VL).toContain('const LIQ_RING_CAP = 16384');
    expect(VL).toContain("get('liqgl') !== '0'");
    expect(VL).toContain("get('c13b') !== '0'");
    expect(VL).toContain('function batQuad(');
    expect(VL).toContain('function shimmerCornerColors(');
    expect(VL).toContain('function shimmerCornersFromWaves(');
    expect(VL).toContain('function glitter4FromWaves(');
    expect(VL).toContain('const flushBandRun = (');
    expect(VL).toContain('let bandBatC13b = false');
  });
});
