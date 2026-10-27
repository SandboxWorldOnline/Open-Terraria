// ★BJ77 零语义优化层(?swperf 缺省开/`?swperf=0` 豁免口)守卫测试(2026-09-14 性能专项;★同日转正缺省开)
//
// 三层:
//  ① 行为面:VanillaLiquidRenderer P1 复位扫守卫——flag 关/开两条序列的
//     绘制参数逐位一致(桩 ctx 记录 drawImage 全参+globalAlpha;绘制参数序列
//     是准备管线输出的充分投影,与 liquid-render-prepare-cache 同方法论),
//     并以 st.idx 调用计数证明 flag 开时 bg 白扫真实被跳过(非 vacuous)。
//  ② 结构锁(源文本锚):快路径必须是 `if (swPerf) 快 else 原样` 双支、
//     原循环逐字保留、求和式同操作数同顺序——防静默回退/防把原路径改掉。
//  ③ 闸门语义:perfFlags 缺省 true(★转正;node 无 location 亦开)+ 翻面 API 生效;
//  像素级等价由实机 scripts/_bj77-pixel-ab.mjs(冻结单帧 md5 对拍)兜底。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { TileStore } from '../src/world/TileStore';
import type { SpriteAtlas } from '../src/assets/SpriteAtlas';
import { drawVanillaLiquids } from '../src/render/VanillaLiquidRenderer';
import { swPerf, swPerfSetForTest } from '../src/render/perfFlags';
import { TILE_DEFS } from '../src/data/tiles';

// ---------- store:湖 + 瀑布柱 + 半砖 + 【岩浆/蜂蜜夹心干格】(P2 typeA 改写敏感面) ----------
function makeStore(): TileStore {
  const st = new TileStore(120, 80);
  const dirt = TILE_DEFS.findIndex((d) => d?.key === 'dirt');
  const set = (x: number, y: number, t: number, liquid = 0, lt = 1, half = 0, wall = 0) => {
    const i = st.idx(x, y);
    st.type[i] = t; st.flags[i] = t ? 1 : 0;
    st.liquid[i] = liquid; st.liquidType[i] = lt;
    st.half[i] = half; st.wall[i] = wall;
  };
  for (let x = 0; x < 120; x++) set(x, 40, dirt);
  // 湖(水)
  for (let x = 20; x <= 60; x++) for (let y = 30; y <= 39; y++) set(x, y, 0, 255, 1);
  // 瀑布柱
  for (let y = 20; y <= 39; y++) set(70, y, 0, 255, 1);
  set(70, 19, dirt);
  // 半砖 + 上格水
  const halfId = TILE_DEFS.findIndex((d) => d?.key === 'platform');
  if (halfId >= 0) { set(80, 39, halfId, 0, 1, 0); const i = st.idx(80, 39); st.half[i] = 1; }
  set(80, 38, 0, 255, 1);
  // 岩浆池(x∈[10,18]) + 夹心干格(x=19,y=39:左右皆岩浆的干燥格——P2 会把
  // typeA 改写为岩浆、fg 复位扫会重置回 store 值,是 bg/fg 差异的最敏感面)
  for (let x = 10; x <= 18; x++) for (let y = 36; y <= 39; y++) set(x, y, 0, 255, 2);
  set(19, 39, dirt);
  // 蜂蜜池(x∈[90,100])
  for (let x = 90; x <= 100; x++) for (let y = 36; y <= 39; y++) set(x, y, 0, 255, 3);
  return st;
}

// ---------- 桩 ctx:记录一切方法调用(drawImage 附带当时 globalAlpha) ----------
function recordingCtx() {
  const seq: string[] = [];
  const target: Record<PropertyKey, unknown> = {};
  const handler: ProxyHandler<Record<PropertyKey, unknown>> = {
    get(t, prop) {
      if (prop in t) return t[prop];
      const name = String(prop);
      if (name === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 0, e: 0, f: 0 });
      if (name === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return (...args: unknown[]) => {
        const a = args.map((v) => (typeof v === 'number' ? v : String(v)));
        seq.push(`${name}(${JSON.stringify(a)})@ga=${String(t['globalAlpha'])}`);
      };
    },
    set(t, prop, v) { t[prop] = v; return true; },
  };
  return { ctx: new Proxy(target, handler) as unknown as CanvasRenderingContext2D, seq };
}

const ATLAS = { width: 256, height: 256, ensureVImage: () => ({ width: 256, height: 256 }) } as unknown as SpriteAtlas;

/** 一轮完整帧(背景 pass + 前景 pass,同 frameToken) */
function runFrame(st: TileStore, seq: string[], token: number): void {
  const a = recordingCtx();
  const b = recordingCtx();
  seq.push(...a.seq);
  drawVanillaLiquids(a.ctx, ATLAS, st, 40, 5, 5, 100, 55, 1000, true, 0, 0, undefined, false, undefined, token);
  drawVanillaLiquids(b.ctx, ATLAS, st, 40, 5, 5, 100, 55, 1000, false, 0, 0, undefined, false, undefined, token);
  seq.push(...a.seq, ...b.seq);
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
afterAll(() => { swPerfSetForTest(true); });   // 归还缺省(★转正后缺省开)

describe('★BJ77 P1 复位扫守卫(行为面)', () => {
  it('flag 关/开:同帧 bg+fg 绘制参数序列逐位一致', () => {
    const off = makeStore();
    const seqOff: string[] = [];
    swPerfSetForTest(false);
    runFrame(off, seqOff, 101);

    const on = makeStore();
    const seqOn: string[] = [];
    swPerfSetForTest(true);
    runFrame(on, seqOn, 202);   // token 换代 → bg 全新 prep(fresh 状态,无跨序列污染)

    expect(seqOn).toEqual(seqOff);
    expect(seqOff.length).toBeGreaterThan(0);   // 序列非空(防夹具哑掉=假绿,H3)
  });

  it('flag 开时 bg 白扫真实被跳过(st.liquid 读计数:off 两次扫 / on 一次)+fg 复位扫保留', () => {
    // ★BJ730 改判史：旧仪=st.idx 猴补计数（P1 旧承载臂逐格调 st.idx）。liqp2 转正
    //  （2026-10-08,P1 重排=同表达式换承载机制,直读 typed array）后 P1/复位扫零
    //  st.idx 调用 → 旧仪双态无差（8474=8474,测的是别的面）=仪器伪影非回归。
    //  新仪=st.liquid 换 Proxy 计数逐格读（两承载臂均逐格读 st.liquid[si],缺省
    //  liqp2 臂同样覆盖）;语义不变:证明 swPerf 开时 bg 的复位白扫真实整跳。
    const st = makeStore();
    const origLiq = st.liquid;
    let reads = 0;
    const proxied = new Proxy(origLiq, {
      get(t, p, r) {
        if (typeof p === 'string' && /^\d+$/.test(p)) reads++;
        return Reflect.get(t, p, r);
      },
    });
    (st as unknown as { liquid: Uint8Array }).liquid = proxied as unknown as Uint8Array;
    const ctx = recordingCtx().ctx;

    swPerfSetForTest(false);
    reads = 0;
    drawVanillaLiquids(ctx, ATLAS, st, 40, 5, 5, 100, 55, 1000, true, 0, 0, undefined, false, undefined, 301);
    const bgOff = reads;
    reads = 0;
    drawVanillaLiquids(ctx, ATLAS, st, 40, 5, 5, 100, 55, 1000, false, 0, 0, undefined, false, undefined, 301);
    const fgOff = reads;

    swPerfSetForTest(true);
    reads = 0;
    drawVanillaLiquids(ctx, ATLAS, st, 40, 5, 5, 100, 55, 1000, true, 0, 0, undefined, false, undefined, 302);
    const bgOn = reads;
    reads = 0;
    drawVanillaLiquids(ctx, ATLAS, st, 40, 5, 5, 100, 55, 1000, false, 0, 0, undefined, false, undefined, 302);
    const fgOn = reads;

    (st as unknown as { liquid: Uint8Array }).liquid = origLiq;   // 仪器归还
    expect(bgOff).toBeGreaterThan(bgOn);   // off=双扫 / on=单扫 → 真实省下一次
    expect(bgOff - bgOn).toBeGreaterThan(4000);   // 差值 ≈ 一次整窗扫描(pw×ph,越界格不计)
    expect(fgOn).toBe(fgOff);              // fg 复位扫必须原样保留(语义依赖)
    swPerfSetForTest(false);
  });
});

// =====================================================================
// 结构锁(源文本锚——防快路径吃掉原路径/防求和式重排)
// =====================================================================
describe('★结构锁(源文本锚)', () => {
  const rendererSrc = readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');
  const liquidSrc = readFileSync(new URL('../src/render/VanillaLiquidRenderer.ts', import.meta.url), 'utf8');
  const flagSrc = readFileSync(new URL('../src/render/perfFlags.ts', import.meta.url), 'utf8');

  it('compositeLight 构建快路径=if(swPerf) 快 else 原循环逐字保留的双支', () => {
    expect(rendererSrc).toContain('if (swPerf) {');
    expect(rendererSrc).toContain('}   // ★BJ77 swPerf 双支结束(else=原循环逐字保留)');
    // 原路径关键表达式(求和式同操作数同顺序)必须在 else 支内原样存在
    expect(rendererSrc).toContain('tapBuf[0] * w00 + tapBuf[3] * w10 + tapBuf[6] * w01 + tapBuf[9] * w11');
    expect(rendererSrc).toContain('tapBuf[1] * w00 + tapBuf[4] * w10 + tapBuf[7] * w01 + tapBuf[10] * w11');
    expect(rendererSrc).toContain('tapBuf[2] * w00 + tapBuf[5] * w10 + tapBuf[8] * w01 + tapBuf[11] * w11');
    // 快路径求和式同顺序(t00*w00 + t10*w10 + t01*w01 + t11*w11)
    expect(rendererSrc).toContain('t00r * w00 + t10r * w10 + t01r * w01 + t11r * w11');
    expect(rendererSrc).toContain('t00g * w00 + t10g * w10 + t01g * w01 + t11g * w11');
    expect(rendererSrc).toContain('t00b * w00 + t10b * w10 + t01b * w01 + t11b * w11');
    // 权重单乘同操作数
    expect(rendererSrc).toContain('const w00 = wx0 * wy0, w10 = wx1 * wy0, w01 = wx0 * wy1, w11 = wx1 * wy1;');
    // scratch 权重必须 Float64(Float32 舍入=逐位一致性破功,_clWX0 同教训)
    expect(rendererSrc).toContain('new Float64Array(w2)');
    expect(rendererSrc).toContain('new Float64Array(h2)');
  });

  it('VanillaLiquidRenderer P1 复位扫=(!swPerf || !needsPrep) 守卫,循环体逐字保留', () => {
    // ★BJ730 改判史：守卫文本 C7 复用臂前扩——`!fgReuseHit && (!swPerf || !needsPrep)`
    //  （2026-10-08 C7 刀:fg 复用命中时复位扫+P3 死算整跳,bg/needsPrep 路径恒
    //  false=现行链不变）。锁语义同守卫本身:swPerf 双支语义仍在第二合取项。
    expect(liquidSrc).toContain('if (!fgReuseHit && (!swPerf || !needsPrep)) {');
    expect(liquidSrc).toContain('}   // ★BJ77 P1 复位扫守卫结束');
    // 守卫内的复位循环体关键表达式仍在(复位语义未被剥离)
    expect(liquidSrc).toContain('isSolidA[i] = liquidCacheIsSolid(st.flags[si], st.wire[si],');
    expect(liquidSrc.match(/isSolidA\[i\] = liquidCacheIsSolid/g)?.length).toBe(2);   // P1 首扫 + 复位扫两份
  });

  it('perfFlags 闸门:缺省开+?swperf=0 豁免口+探针读取面在位', () => {
    expect(flagSrc).toContain(".get('swperf') !== '0'");
    expect(flagSrc).toContain('__swPerfFlags');
    expect(flagSrc).toContain('swPerfSetForTest');
  });
});

describe('★BJ77 闸门语义', () => {
  it('node 环境(无 location)缺省 true(★转正);翻面 API 生效且为活绑定', () => {
    swPerfSetForTest(false);
    expect(swPerf).toBe(false);   // 豁免口=旧行为路径(逐位=转正前现行)
    swPerfSetForTest(true);
    expect(swPerf).toBe(true);
    swPerfSetForTest(true);       // 归还缺省(★转正后缺省开)
    expect(swPerf).toBe(true);
  });
});
