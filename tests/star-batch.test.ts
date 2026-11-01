// ★C13 星场批守卫（2026-09-30 SHM 逐星 drawImage 洪峰根治）:
// buildStarBatch 数学锁——角点=starXform 复合矩阵×(±hw,±hh) 逐式复算、UV tie-eps、
// 顶点色=白×逐星 alpha、坠星尾迹扩 quad、按星贴图分段、亮度门剔除。
// ★坐标系:星坐标在 1920×1200 空间,px=s.x/1920×viewW（断言必须过同一映射）。
// node 面纯计算（builder 不触 GL;GL 发射位=源锚）。Float32 存储面→精度 7 位。
import { beforeAll, describe, expect, it } from 'vitest';
// ★BJ743-A（R24 SEV-2）：下述结构锁 4 处 require('fs') 直读 src 改 ESM import 形
//   经 fs-guard-shim 守卫（require 旁路收口;try/catch 兜底语义保持）。
import { readFileSync } from 'node:fs';
import { SkyRenderer } from '../src/render/SkyRenderer';

beforeAll(() => {
  if (typeof (globalThis as { Image?: unknown }).Image === 'undefined') {
    (globalThis as unknown as { Image: unknown }).Image = class {
      src = ''; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      width = 32; height = 32;
    };
  }
});

const ID_BT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as unknown as DOMMatrix;
const EPS = 1 / 4096;
const LUM_A = Math.min(255, Math.floor(155 * 1.4)) / 255;   // cots=[0,0,0] 星面 alpha 基

interface StarOverrides {
  x?: number; y?: number; rot?: number; scale?: number; type?: number;
  twinkle?: number; fadeIn?: number; falling?: boolean; fvx?: number; fvy?: number;
  fallTime?: number; hidden?: boolean;
}
const mkStar = (o: StarOverrides = {}) => ({
  x: 960, y: 600, rot: 0, scale: 1, type: 0, twinkle: 1, twSpeed: 0, rotSpeed: 0,
  falling: false, hidden: false, fvx: 0, fvy: 0, fallTime: 0, fadeIn: 0,
  cs: 1, sn: 0, csRot: 0, ...o,
});
const mkSky = (stars: ReturnType<typeof mkStar>[]) => {
  const sky = new SkyRenderer();
  const texs = [0, 1, 2, 3].map(() => ({ src: '', width: 32, height: 32 }));
  (sky as unknown as { stars: unknown[] }).stars = stars;
  (sky as unknown as { numStars: number }).numStars = stars.length;
  (sky as unknown as { starTexs: unknown[] }).starTexs = texs;
  return { sky, texs };
};
const build = (sky: SkyRenderer, stars: number, artificial = false, shim = 0, viewW = 1000, viewH = 800) =>
  (sky as unknown as {
    buildStarBatch(f: boolean, o: number, w: number, h: number, t: number, bt: DOMMatrix, s: number, c: readonly number[] | null):
      { segments: Array<{ texIdx: number; quads: number; data: Float32Array; key: string }>; quads: number } | null;
  }).buildStarBatch(artificial, 1, viewW, viewH, 0, ID_BT, shim, [0, 0, 0]);
/** 段内第 qi 个 quad 的 6 顶点 (x,y,u,v,a)（rgb=alpha=2D globalAlpha 语义） */
const quadVerts = (seg: { data: Float32Array }, qi: number): number[][] => {
  const out: number[][] = [];
  for (let v = 0; v < 6; v++) {
    const o = qi * 48 + v * 8;
    out.push([seg.data[o], seg.data[o + 1], seg.data[o + 2], seg.data[o + 3], seg.data[o + 7]]);
  }
  return out;
};

describe('★C13 buildStarBatch 数学锁', () => {
  it('静止星:恒等 base 下角点=映射后中心±半贴图,UV=全跨度−tie-eps,顶点色 rgb=a（globalAlpha 精确式）', () => {
    const { sky } = mkSky([mkStar({ x: 960, y: 600 })]);
    const batch = build(sky, 1, false, 0, 1920, 1200);
    const seg = batch!.segments[0];
    expect(seg.texIdx).toBe(0);
    expect(seg.quads).toBe(1);
    expect(seg.key).toBe('sbat:0:1');
    const verts = quadVerts(seg, 0);
    // px = 960/1920×1920 = 960;py = 600/1200×1200 = 600;角点 = (960±16, 600±16)
    expect(verts[0][0]).toBe(960 - 16); expect(verts[0][1]).toBe(600 - 16);
    expect(verts[1][0]).toBe(960 + 16); expect(verts[1][1]).toBe(600 - 16);
    expect(verts[2][0]).toBe(960 + 16); expect(verts[2][1]).toBe(600 + 16);
    expect(verts[5][0]).toBe(960 - 16); expect(verts[5][1]).toBe(600 + 16);
    expect(verts[0][2]).toBeCloseTo(-EPS / 32, 12);
    expect(verts[2][2]).toBeCloseTo((32 - EPS) / 32, 12);
    for (const v of verts) expect(v[4]).toBeCloseTo(LUM_A, 7);
  });

  it('旋转星:角点随 rot 旋转（rot=π/2 → (u,v)→(−v,u) 逐式;坐标过 1920→viewW 映射）', () => {
    const { sky } = mkSky([mkStar({ x: 500, y: 400, rot: Math.PI / 2 })]);
    const batch = build(sky, 1);
    const seg = batch!.segments[0];
    const verts = quadVerts(seg, 0);
    // px = 500/1920×1000 = 260.4167;py = 400/1200×800 = 266.6667
    // rot=π/2:a=cs·sc=0,b=sn·sc=1 → m11=0,m12=1,m21=−1,m22=0 → (u,v)→(−v,u)
    const cx = 500 / 1920 * 1000, cy = 400 / 1200 * 800;
    expect(verts[0][0]).toBeCloseTo(cx + 16, 4); expect(verts[0][1]).toBeCloseTo(cy - 16, 4);
    expect(verts[1][0]).toBeCloseTo(cx + 16, 4); expect(verts[1][1]).toBeCloseTo(cy + 16, 4);
    expect(verts[2][0]).toBeCloseTo(cx - 16, 4); expect(verts[2][1]).toBeCloseTo(cy + 16, 4);
  });

  it('坠星尾迹:fallTime=5 → 4 段尾迹+1 主星=5 quad;尾迹位移/缩放/alpha 逐式（过映射）', () => {
    const { sky } = mkSky([mkStar({ x: 100, y: 100, falling: true, fvx: 2, fvy: 5, fallTime: 5 })]);
    const batch = build(sky, 1);
    const seg = batch!.segments[0];
    expect(seg.quads).toBe(5);
    const sxv = 1000 / 1920, syv = 800 / 1200;
    const px = 100 / 1920 * 1000, py = 100 / 1200 * 800;
    // 尾迹 j=1:x = px − fvx·1·0.4·sxv;sc = 1−1/30;a = LUM_A×(1−1/30)
    const t1 = quadVerts(seg, 0);
    const jx = px - 2 * 1 * 0.4 * sxv, jy = py - 5 * 1 * 0.4 * syv, sc = 1 - 1 / 30;
    expect(t1[0][0]).toBeCloseTo(jx - 16 * sc, 4);
    expect(t1[0][1]).toBeCloseTo(jy - 16 * sc, 4);
    expect(t1[0][4]).toBeCloseTo(LUM_A * (1 - 1 / 30), 7);
    // 主星(末 quad)无尾迹位移
    const main = quadVerts(seg, 4);
    expect(main[0][0]).toBeCloseTo(px - 16, 4);
    expect(main[0][4]).toBeCloseTo(LUM_A, 7);
  });

  it('按星贴图分段:type 0/1 两星=2 段;亮度门剔除(fadeIn=1→lum≤0)与 hidden 剔除', () => {
    const { sky } = mkSky([
      mkStar({ type: 0 }),
      mkStar({ type: 1 }),
      mkStar({ type: 2, fadeIn: 1 }),     // num2=0 → lum=0 → 剔
      mkStar({ type: 3, hidden: true }),  // 剔
    ]);
    const batch = build(sky, 4);
    expect(batch!.segments.length).toBe(2);
    expect(batch!.segments[0].texIdx).toBe(0);
    expect(batch!.segments[1].texIdx).toBe(1);
    expect(batch!.segments.map((s) => s.quads).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('微光支:shim 因子乘 alpha（artificial=×shim×meanF;Float32 精度 7 位）', () => {
    const { sky } = mkSky([mkStar({})]);
    const shim = 0.8;
    const batch = build(sky, 1, true, shim);
    const expectA = LUM_A * shim * (1 - shim * (1 - 1) / 3);
    expect(batch!.segments[0].data[7]).toBeCloseTo(expectA, 7);
  });
});

describe('★C13 结构锁', () => {
  const SKY = (() => { try { return readFileSync('src/render/SkyRenderer.ts', 'utf8'); } catch { return ''; } })();
  it('发射位源锚:自然星 sstarn 原位 blit+恒等变换守卫;人工星 sstars;2D 回退保留', () => {
    expect(SKY).toContain("emitStarBatchGL(layer, batch, 'sstarn', viewW, viewH)");
    expect(SKY).toContain("emitStarBatchGL(layer, batch, 'sstars', viewW, viewH)");
    expect(SKY.match(/setTransform\(1, 0, 0, 1, 0, 0\);\n\s*ctx\.drawImage\(layer\.canvas/g)?.length).toBe(2);
    expect(SKY).toContain('quadBatchRgba(e, seg.data, seg.quads, true)');
    expect(SKY).toContain('this.drawStar(ctx, i, starDim, viewW, viewH, skyBgTopY, bt, shim, false, cotsFaded)');
    expect(SKY).toContain('this.drawStar(ctx, i, starDim, viewW, viewH, this._lastStarBgTopY, bt, shim, true, cotsFaded)');
  });
  const GL = (() => { try { return readFileSync('src/render/GLSpriteLayer.ts', 'utf8'); } catch { return ''; } })();
  it('quadBatchRgba smooth 参数锁（缺省 false=既有调用零变化;星场=true 线性）', () => {
    expect(GL).toContain('quadBatchRgba(e: TexEntry, data: Float32Array, quads: number, smooth = false)');
    expect(GL).toContain('bindSampler(0, smooth');
  });
});

describe('★K3 星批 idle 预热（2026-10-01 prewarmStarBatch）', () => {
  it('starTexKey 与 buildStarBatch 段键同源（键漂移=预热白做守卫）', () => {
    const { sky } = mkSky([mkStar(), mkStar({ type: 1 })]);
    const batch = build(sky, 2);
    const keyOf = (i: number) => (sky as unknown as { starTexKey(i: number): string | null }).starTexKey(i);
    for (const seg of batch!.segments) expect(keyOf(seg.texIdx)).toBe(seg.key);
  });

  it('starTexKey 未就绪贴图=null（loadTex 异步窗跳过自愈）', () => {
    const { sky } = mkSky([mkStar()]);
    (sky as unknown as { starTexs: unknown[] }).starTexs = [null];
    expect((sky as unknown as { starTexKey(i: number): string | null }).starTexKey(0)).toBeNull();
  });

  it('prewarmStarBatch 无 GL 层静默不抛（node 面判死守卫+懒路径兜底语义）', () => {
    const { sky } = mkSky([mkStar(), mkStar({ type: 2 })]);
    expect(() => (sky as unknown as { prewarmStarBatch(): void }).prewarmStarBatch()).not.toThrow();
    // 再跑一遍幂等（重复预热=幂等 texFromImage 键）
    expect(() => (sky as unknown as { prewarmStarBatch(): void }).prewarmStarBatch()).not.toThrow();
  });

  it('结构锁:mainFlow rIC 挂点+GLSpriteLayer.prewarmPrecip 面', () => {
    const MF = (() => { try { return readFileSync('src/mainFlow.ts', 'utf8'); } catch { return ''; } })();
    expect(MF).toContain('prewarmStarBatch()');
    expect(MF).toContain('requestIdleCallback');
    const GL = (() => { try { return readFileSync('src/render/GLSpriteLayer.ts', 'utf8'); } catch { return ''; } })();
    expect(GL).toContain('prewarmPrecip(): boolean');
  });
});
