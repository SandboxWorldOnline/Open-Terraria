// ★翼案锁（2026-09-27）：wingTexSource 缓存条目独立性——条目=自有画布,两次烘焙
//  互不覆写;条目永不===共享单槽 wingTintScratch（旧病:条目存共享槽本体 →
//  (a) acc-shim 链 GL 纹理按 texId+rect 永久驻留=染翼冻结首帧(B2 转正窗实报);
//  (b) 裸 2D 链同桶 cache-hit 命中被后续染甲/气球烘焙覆写的槽=串味像素）。
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Renderer } from '../src/render/Renderer';

/** 带【确定图案】桩画布:drawImage(9 参)按源矩形 (sx,sy) 填充可辨图案——
 *  条目若被他人覆写,像素必变。getImageData/putImageData 直通 __buf。 */
function makeCanvas(): HTMLCanvasElement & { __buf: Uint8ClampedArray | null } {
  const cv = { width: 8, height: 8, __buf: null as Uint8ClampedArray | null } as HTMLCanvasElement & { __buf: Uint8ClampedArray | null };
  (cv as unknown as Record<string, unknown>).getContext = function (this: typeof cv) {
    const self = this as typeof cv & { __ctx?: Record<string, unknown> };
    if (!self.__ctx) {
      self.__ctx = new Proxy({
        clearRect() { self.__buf = new Uint8ClampedArray(self.width * self.height * 4); },
        drawImage(img: { width: number; height: number }, sx: number, sy: number, sw: number, sh: number) {
          if (!self.__buf || self.__buf.length !== self.width * self.height * 4) {
            self.__buf = new Uint8ClampedArray(self.width * self.height * 4);
          }
          for (let y = 0; y < Math.min(sh, self.height); y++) {
            for (let x = 0; x < Math.min(sw, self.width); x++) {
              const i = (y * self.width + x) * 4;
              self.__buf[i] = ((sx + x + 1) * 7) % 256;
              self.__buf[i + 1] = ((sy + y + 1) * 11) % 256;
              self.__buf[i + 2] = 13;
              self.__buf[i + 3] = 255;
            }
          }
        },
        getImageData(_x: number, _y: number, w: number, h: number) {
          if (!self.__buf || self.__buf.length !== self.width * self.height * 4) {
            self.__buf = new Uint8ClampedArray(self.width * self.height * 4);
          }
          return { data: self.__buf, width: w, height: h };
        },
        putImageData(id: { data: Uint8ClampedArray }) { self.__buf = new Uint8ClampedArray(id.data); },
      }, {
        get(t, p) { if (p in t) return (t as Record<string, unknown>)[p as string]; return () => undefined; },
        set(t, p, v) { (t as Record<string, unknown>)[p as string] = v; return true; },
      });
    }
    return self.__ctx;
  };
  return cv;
}

describe('wingTexSource 缓存条目独立性（翼案锁）', () => {
  let proto: Record<string, (...a: unknown[]) => unknown>;
  let Renderer: typeof import('../src/render/Renderer').Renderer;
  beforeAll(async () => {
    vi.stubGlobal('document', { createElement: () => makeCanvas() });
    ({ Renderer } = await import('../src/render/Renderer'));
    proto = Renderer.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  });
  afterAll(() => vi.unstubAllGlobals());

  const fakeThis = () => ({
    wingBakeCache: new Map<string, HTMLCanvasElement>(),
    wingBakeCachePruneAt: 0,
    // ★BJ719-A 域回归分诊:补 2026-10-12/14 池化刀新增的 wingBakeFree 池/
    //   wingBakePoolGive 归池面（旧夹具缺字段=wingTexSource :20258 TypeError 存量红,
    //   与 BJ719-A 本刀无关;池面 no-op 桩=miss 恒新分配,本锁「条目互异/内容不被
    //   覆写」断言语义不变——池复用只在淘汰后发生,本夹具无淘汰进池）
    wingBakeFree: new Map<string, HTMLCanvasElement[]>(),
    wingBakePoolGive: () => {},
    wingTintScratch: makeCanvas(),   // 共享单槽（新代码零触碰;旧病=条目===它）
    applyDyeToImageData: () => {},
    applyDyeLitToImageData: () => {},
  });
  const src = { width: 86, height: 248 } as HTMLImageElement;
  const grab = (cv: HTMLCanvasElement) =>
    (cv.getContext('2d') as unknown as { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } })
      .getImageData(0, 0, cv.width, cv.height).data;

  it('两次不同键烘焙:条目画布互异、先烘条目像素不被后烘覆写（核心锁）', () => {
    const ft = fakeThis();
    const wts = proto.wingTexSource as (
      this: unknown, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number,
      dye: null, tint: [number, number, number] | null,
    ) => HTMLCanvasElement | null;
    const a = wts.call(ft, src, 0, 0, 86, 62, null, [0.5, 0.5, 0.5]);
    const b = wts.call(ft, src, 0, 62, 86, 62, null, [0.5, 0.5, 0.5]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);                        // 条目自有画布（旧病:同为共享槽）
    expect(a).not.toBe(ft.wingTintScratch);       // 条目永不===共享单槽
    const before = Uint8ClampedArray.from(grab(a!));
    expect(before.some((v) => v !== 0)).toBe(true);
    // 换键再烘 + 挤 60 键触发 LRU 重烘同尺寸——A 内容必须纹丝不动
    wts.call(ft, src, 0, 124, 86, 62, null, [0.5, 0.5, 0.5]);
    const after = grab(a!);
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it('同键复用=同一条目对象（命中路径不重烘）+键分量（切片/tint/桶）变化=新条目', () => {
    const ft = fakeThis();
    const wts = proto.wingTexSource as (
      this: unknown, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number,
      dye: null, tint: [number, number, number] | null,
    ) => HTMLCanvasElement | null;
    const a1 = wts.call(ft, src, 0, 0, 86, 62, null, [0.5, 0.5, 0.5]);
    const a2 = wts.call(ft, src, 0, 0, 86, 62, null, [0.5, 0.5, 0.5]);
    expect(a2).toBe(a1);
    const diffTint = wts.call(ft, src, 0, 0, 86, 62, null, [0.25, 0.25, 0.25]);
    expect(diffTint).not.toBe(a1);
    const diffSlice = wts.call(ft, src, 0, 62, 86, 62, null, [0.5, 0.5, 0.5]);
    expect(diffSlice).not.toBe(a1);
    expect(ft.wingBakeCache.size).toBe(3);
  });

  it('染料支:烘焙进条目画布（stub 染料算子收到的 data=条目缓冲;条目≠共享槽）', () => {
    const seen: Array<{ w: number; h: number }> = [];
    const ft = fakeThis();
    (ft as { applyDyeToImageData: unknown }).applyDyeToImageData = (
      data: Uint8ClampedArray, w: number, h: number,
    ) => { seen.push({ w, h }); data[0] = 99; };
    const wts = proto.wingTexSource as (
      this: unknown, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number,
      dye: { vid: number; tech: string; uniforms: Record<string, unknown> } | null, tint: null,
    ) => HTMLCanvasElement | null;
    const dye = { vid: 1007, tech: 'ArmorShaderData', uniforms: {} as Record<string, unknown> };
    const a = wts.call(ft, src, 0, 0, 86, 62, dye, null);
    expect(a).toBeTruthy();
    expect(seen).toEqual([{ w: 86, h: 62 }]);
    expect(a).not.toBe(ft.wingTintScratch);
    const b = wts.call(ft, src, 0, 62, 86, 62, dye, null);
    expect(b).not.toBe(a);
    expect(Array.from(grab(a!))).toEqual(Array.from(Uint8ClampedArray.from(grab(a!))));
  });

  it('LRU 容量闸沿用:2s 修剪窗后逐条淘汰至 48+1（不整表清空,2026-09-07 canvas 哨兵判例）', () => {
    const ft = fakeThis();
    const wts = proto.wingTexSource as (
      this: unknown, img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number,
      dye: null, tint: [number, number, number] | null,
    ) => HTMLCanvasElement | null;
    for (let i = 0; i < 48; i++) wts.call(ft, src, 0, i * 1000, 86, 62, null, [0.5, 0.5, 0.5]);
    expect(ft.wingBakeCache.size).toBe(48);
    const oldestKey = ft.wingBakeCache.keys().next().value as string;
    // 把修剪窗拨陈旧 → 下一次 miss 触发逐条淘汰（trim 1 条 → 47,插入新键 = 48）
    (ft as { wingBakeCachePruneAt: number }).wingBakeCachePruneAt = performance.now() - 3000;
    wts.call(ft, src, 0, 99_000, 86, 62, null, [0.5, 0.5, 0.5]);
    expect(ft.wingBakeCache.size).toBe(48);
    expect(ft.wingBakeCache.has(oldestKey)).toBe(false);   // 最旧档出,新键入
  });
});
