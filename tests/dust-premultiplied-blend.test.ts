// dust 预乘混合批（Renderer.drawVanillaDustPass × VanillaDust.dustPremulBake）数值闸门。
// 断言三段：①烘焙字节面精确性 ②canvas 两步合成（destination-out+lighter,W3C 语义
// 独立实现）逐像素 = XNA 预乘 AlphaBlend 公式（±2 8bit 容差）③旧直色 source-over
// 模型对同一公式必偏离（钉死被修掉的语义 bug,防回退）。
// XNA 公式（Main.DrawDust spriteBatch.Begin(BlendState.AlphaBlend) = 预乘混合
// One/InverseSourceAlpha;贴图经内容管线预乘,直色 PNG 先乘 texA;Draw 的 Color 入参
// c 逐通道调制,src.rgb=texP×c.rgb 不乘 c.a、src.a=tex.a×c.a）：
//   final = dst×(1−texA×cA) + tex.rgb×texA×cRGB   （单次 clamp）
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dustPremulBake, dustPmCacheTouch, dustPmCacheEvict, DUST_PM_CACHE_MAX, VanillaDust } from '../src/fx/VanillaDust';
import { Renderer } from '../src/render/Renderer';

/** 2×2 直色贴图：tA=255 / 半透 / 全透（形状外）/ 低α,覆盖四象限 */
const TEX = new Uint8ClampedArray([
  200, 100, 50, 255,
  255, 255, 255, 128,
  10, 20, 30, 0,
  80, 160, 240, 64,
]);

/** canvas 两步合成仿真（premult 浮点;按 W3C spec 独立实现,与烘焙代码零共享）：
 *  'destination-out': dst' = dst×(1−srcA);'lighter': dst' = clamp(dst+src.premult) */
function compositePremulPair(dst: number[], add: Uint8ClampedArray, erase: Uint8ClampedArray): number[] {
  const out = dst.slice();
  for (let i = 0; i < out.length; i += 4) {
    const ea = erase[i + 3] / 255;
    for (let ch = 0; ch < 3; ch++) out[i + ch] *= 1 - ea;                       // ① 擦
    const sa = add[i + 3] / 255;                                                // = 255 → 1
    for (let ch = 0; ch < 3; ch++) out[i + ch] = Math.min(1, out[i + ch] + (add[i + ch] / 255) * sa); // ② 加
  }
  return out;
}

/** 旧实现模型（直色 source-over:src.rgb=tex.rgb×cRGB×srcA、src.a=tex.a×cA） */
function compositeOldStraight(dst: number[], tex: Uint8ClampedArray, mR: number, mA: number): number[] {
  const out = dst.slice();
  for (let i = 0; i < out.length; i += 4) {
    const sa = (tex[i + 3] / 255) * (mA / 255);
    for (let ch = 0; ch < 3; ch++) {
      out[i + ch] = (tex[i + ch] / 255) * (mR / 255) * sa + out[i + ch] * (1 - sa);
    }
  }
  return out;
}

/** XNA 预乘公式（浮点独立推导,byte 输入） */
function xnaFormula(dst: number[], tex: Uint8ClampedArray, mR: number, mA: number): number[] {
  const out = dst.slice();
  for (let i = 0; i < out.length; i += 4) {
    const texA = tex[i + 3] / 255;
    for (let ch = 0; ch < 3; ch++) {
      out[i + ch] = Math.min(1, out[i + ch] * (1 - texA * (mA / 255)) + (tex[i + ch] / 255) * texA * (mR / 255));
    }
  }
  return out;
}

function maxDev(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i += 4) for (let ch = 0; ch < 3; ch++) m = Math.max(m, Math.abs(a[i + ch] - b[i + ch]) * 255);
  return m;
}

/** 已知背景（含 0/低/中/高/饱和五档,2×2=4 px × 3 组轮转） */
const DSTS = [0, 64, 128, 200, 255];
function mkDst(): number[] {
  // ★R2 #8:dst 通道改 0-1 浮点渐变——字节域 + Math.min(1,·) 钳使 10/12 texel 双侧
  // 饱和为 1,erase×dst 项零覆盖(通过理由失真);渐变域让每个 texel 的乘法项可见
  const px = (k: number) => [Math.round(DSTS[k % 5] * 0.72), Math.round(DSTS[(k + 1) % 5] * 0.58), Math.round(DSTS[(k + 3) % 5] * 0.44), 1];
  return [...px(0), ...px(1), ...px(2), ...px(3)];
}

describe('dustPremulBake 烘焙面（Renderer 预乘对数据源）', () => {
  // ★2026-09-04 水花黑十字定谳：add[] 字节改【直色】语义（rgb=预乘×255/e、A=e）——
  // putImageData 直色解释→浏览器预乘存面 rgb×e/255 恰还原 XNA 贡献。断言以
  // "直色×α/255 重建预乘贡献"为准，±2 容差（两段量化：直色 byte + erase byte）。
  it('add=直色面(A=max(e,预乘))还原预乘贡献、erase.A=texA×mA/255(RGB=0)', () => {
    const { add, erase } = dustPremulBake(TEX, 120, 120, 120, 120);
    for (let i = 0; i < TEX.length; i += 4) {
      const tA = TEX[i + 3];
      const e = (tA * 120) / 255;
      for (let ch = 0; ch < 3; ch++) {
        const premul = Math.round((TEX[i + ch] * tA * 120) / 65025);
        const rebuilt = e >= 0.5 ? (add[i + ch] * add[i + 3]) / 255 : 0;   // e<0.5 档 add 面=0
        expect(Math.abs(rebuilt - premul)).toBeLessThanOrEqual(2);
      }
      // ★α=src.a 语义（XNA 第二混合因子=texA×cA）——旧二值 255/0 在半透 worldLayer
      //  把天空 α 顶满=水花黑十字（_splash-dust-verdict.mjs 实机复现）。本体 num 档
      //  （mRGB=mA）预乘≤e 恒 α=e 精确；亮点位过冲上限=预乘本值。
      const mExp = e >= 0.5 ? Math.max(e, (TEX[i] * tA * 120) / 65025, (TEX[i + 1] * tA * 120) / 65025, (TEX[i + 2] * tA * 120) / 65025)
        : (add[i] + add[i + 1] + add[i + 2] > 0 ? 255 : 0);
      expect(Math.abs(add[i + 3] - mExp)).toBeLessThanOrEqual(1);
      expect(Math.abs(erase[i + 3] - Math.round((tA * 120) / 255))).toBeLessThanOrEqual(1);
      expect(erase[i]).toBe(0); expect(erase[i + 1]).toBe(0); expect(erase[i + 2]).toBe(0);
    }
  });

  it('半透 dst 上 α 合成 ≡ XNA（out.a = dst.a×(1−texA·cA)+texA·cA,钉死黑十字修复）', () => {
    // worldLayer 空中域 dst.a≈0：'lighter' α 加算后 out.a 应恰为 e（天空仍透 1−e）
    const { add, erase } = dustPremulBake(TEX, 120, 120, 120, 120);
    for (let i = 0; i < TEX.length; i += 4) {
      const tA = TEX[i + 3] / 255, cA = 120 / 255;
      const e = tA * cA;
      const dstA = 0;                                   // 空中透明域
      const outA = dstA * (1 - e) + (add[i + 3] / 255); // erase 已乘 (1−e),lighter 加 src.a
      expect(Math.abs(outA - e)).toBeLessThanOrEqual(2 / 255);
      // 旧实现（a=255）同式会得 out.a=1 → 天空全挡死=黑十字（防回退钉）
      expect(1 - e).toBeGreaterThan(0.5);
    }
  });

  it('colorPass 档逐通道乘数独立（mR≠mG≠mB;rgb>a 亮点位 rgb 仍精确）', () => {
    const { add } = dustPremulBake(TEX, 250, 120, 40, 200);
    for (let i = 0; i < TEX.length; i += 4) {
      const tA = TEX[i + 3];
      const e = (tA * 200) / 255;
      for (let ch = 0; ch < 3; ch++) {
        const mul = [250, 120, 40][ch];
        const premul = Math.round((TEX[i + ch] * tA * mul) / 65025);
        const rebuilt = e >= 0.5 ? (add[i + ch] * add[i + 3]) / 255 : 0;
        // 存面 α=max(e,预乘) → 直色=预乘×255/α 回存后 rgb 恒精确（无钳位降饱和）
        expect(Math.abs(rebuilt - premul)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('canvas 两步合成 ≡ XNA 预乘公式（逐像素数值等价）', () => {
  const cases: Array<[number, number, number, number, string]> = [
    [120, 120, 120, 120, '默认档 num(α=120)'],
    [255, 255, 255, 25, 'type6 档 A=25/255'],
    [250, 120, 40, 200, 'colorPass 逐通道档'],
    [230, 230, 230, 115, 'type261 档'],
    [255, 255, 255, 0, 'A=0 加性特例(erase 无操作)'],
  ];
  for (const [mR, mG, mB, mA, name] of cases) {
    it(`${name}: maxDev ≤ 2/255`, () => {
      const { add, erase } = dustPremulBake(TEX, mR, mG, mB, mA);
      const dst = mkDst();
      const got = compositePremulPair(dst, add, erase);
      const exp = xnaFormula(dst, TEX, mR, mA);
      expect(maxDev(got, exp)).toBeLessThanOrEqual(2);
    });
  }

  it('A=0 特例退化为纯加法 dst+texP×cRGB（=既有 lighter 加性通道同式）', () => {
    const { add, erase } = dustPremulBake(TEX, 255, 255, 255, 0);
    for (let i = 3; i < erase.length; i += 4) expect(erase[i]).toBe(0);
    const dst = mkDst();
    const got = compositePremulPair(dst, add, erase);
    for (let i = 0; i < dst.length; i += 4) {
      const texA = TEX[i + 3] / 255;
      for (let ch = 0; ch < 3; ch++) {
        expect(Math.abs(got[i + ch] - Math.min(1, dst[i + ch] + (TEX[i + ch] / 255) * texA)) * 255).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('旧直色 source-over 模型必偏离公式（语义 bug 钉死,防回退）', () => {
  it('默认档（a>0）偏差 >2/255——加性项被额外乘 c.a（src 压暗）', () => {
    const dst = mkDst();
    const oldDev = maxDev(compositeOldStraight(dst, TEX, 120, 120), xnaFormula(dst, TEX, 120, 120));
    expect(oldDev).toBeGreaterThan(2);
    // 而新烘焙对对同公式 ≤2（同输入同背景）
    const { add, erase } = dustPremulBake(TEX, 120, 120, 120, 120);
    expect(maxDev(compositePremulPair(dst, add, erase), xnaFormula(dst, TEX, 120, 120))).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// dustPmCache 分代 LRU（2026-09-02 红队 PLAUSIBLE finding 清偿金标）——旧实现上限
// 溢出【整体 clear】:连续多色 colorPass/331 贴片键周期打穿时全缓存瞬间归零,每键
// 重烘 1×getImageData（GPU 回读）= 帧尖峰。金标钉死:溢出不清空全部/最旧先出/
// 热键（命中重插入）不被分代窗口淘汰。
// ---------------------------------------------------------------------------
describe('dustPmCache 分代 LRU（溢出不清空全部/最旧先出）', () => {
  it('dustPmCacheEvict:超限只逐出最旧 1/4,其余保留', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 2100; i++) m.set(`k${i}`, i);
    dustPmCacheEvict(m);
    expect(m.size).toBe(2100 - (2100 >> 2));            // 1575 —— 非 0(旧 clear 归零)
    expect(m.has('k0')).toBe(false);                    // 最旧先出
    expect(m.has(`k${(2100 >> 2) - 1}`)).toBe(false);   // 逐出窗末（k524）
    expect(m.has(`k${2100 >> 2}`)).toBe(true);          // 窗后首个幸存（k525）
    expect(m.has('k2099')).toBe(true);                  // 最新档全保留
  });

  it('dustPmCacheTouch:命中重插入=访问序,热键不被分代淘汰', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < DUST_PM_CACHE_MAX + 1; i++) m.set(`k${i}`, i);   // 2049>2048
    dustPmCacheTouch(m, 'k0');                          // 最旧键命中 → 移到尾
    dustPmCacheEvict(m);                                // 逐 2049>>2=512 个
    expect(m.size).toBe(DUST_PM_CACHE_MAX + 1 - 512);
    expect(m.has('k0')).toBe(true);                     // 刚访问者幸存
    expect(m.has('k1')).toBe(false);                    // 未访问旧键先出
  });

  it('≤上限零淘汰(顺序不变)', () => {
    const m = new Map<string, number>([['a', 1], ['b', 2]]);
    dustPmCacheEvict(m);
    expect([...m.keys()]).toEqual(['a', 'b']);
  });

  it('dustPremulPair 接线:稳态规模有界不清空、命中同对象、最旧档被逐出后重烘', () => {
    // node 环境无 canvas——桩 document.createElement（烘焙只走 clearRect/drawImage/
    // getImageData/createImageData/putImageData 五口;数据面已由上方 dustPremulBake 组覆盖）
    const px = new Uint8ClampedArray(8 * 8 * 4);
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 8, height: 8,
        getContext: () => ({
          clearRect: () => {}, drawImage: () => {}, putImageData: () => {},
          getImageData: () => ({ data: px, width: 8, height: 8 }),
          createImageData: () => ({ data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 }),
        }),
      }),
    });
    try {
      const self = { dustPmCache: null as Map<string, unknown> | null, dustPmBake: null };
      const pairFn = (Renderer.prototype as unknown as {
        dustPremulPair: (this: unknown, img: CanvasImageSource, fx: number, fy: number,
          mr: number, mg: number, mb: number, ma: number) => unknown;
      }).dustPremulPair;
      const get = (fx: number) => pairFn.call(self, {} as CanvasImageSource, fx, 0, 0.5, 0.5, 0.5, 0.1);
      const first = get(0);
      expect(get(0)).toBe(first);                       // 命中=同一烘焙对(不重烘)
      for (let i = 0; i < 2100; i++) get(i);            // 2100 独立键连续打穿
      const size = self.dustPmCache!.size;
      expect(size).toBeGreaterThan(0);                  // 溢出不清空全部(旧实现=0)
      expect(size).toBeLessThanOrEqual(DUST_PM_CACHE_MAX + 2);   // 分代后稳态有界
      expect(get(0)).not.toBe(first);                   // 最旧档已逐出 → 重烘新对象
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ===================== VDust 双轴通道（2026-09-03 双轴基建批）=====================
// PrettySparkleParticle.Draw（PrettySparkleParticle.cs:61-94）臂几何/老化同步/全亮
// 桶路由三面闸门——Renderer.drawSparkleArms 消费位（drawVanillaDustPass ★双轴通道）。
describe('VDust 双轴通道（scaleX/scaleY 缺省回落 + 老化同步 + 全亮桶路由）', () => {
  it('sparkleArmGeometry：两臂都乘整个 Vector2 Scale（逐轴,num,tex 逐值）', async () => {
    const { sparkleArmGeometry } = await import('../src/render/Renderer');
    // :72 vector=(0.3,2)×num×Scale / :73 vector2=(0.3,1)×num×Scale;Extra_98=72²
    expect(sparkleArmGeometry(0.5, 0.4, 1)).toEqual({
      hx: 0.3 * 0.5 * 1 * 72, hy: 2 * 0.4 * 1 * 72,
      vx: 0.3 * 0.5 * 1 * 72, vy: 1 * 0.4 * 1 * 72,
    });
    // num 包络（通道 alpha 域:num=(255−alpha)/255）与 tex 基尺两参
    expect(sparkleArmGeometry(1, 1, 0.5, 128)).toEqual({
      hx: 0.3 * 0.5 * 128, hy: 2 * 0.5 * 128, vx: 0.3 * 0.5 * 128, vy: 0.5 * 128,
    });
  });

  it('dustAxisScale：缺省逐轴回落单标量 scale（dual=false）,任一在位（dual=true）', async () => {
    const { dustAxisScale } = await import('../src/fx/VanillaDust');
    expect(dustAxisScale({ scale: 1.3, scaleX: undefined, scaleY: undefined }))
      .toEqual({ sx: 1.3, sy: 1.3, dual: false });
    expect(dustAxisScale({ scale: 1.3, scaleX: 0.5, scaleY: 2 }))
      .toEqual({ sx: 0.5, sy: 2, dual: true });
    expect(dustAxisScale({ scale: 1.3, scaleX: 0.5, scaleY: undefined }))
      .toEqual({ sx: 0.5, sy: 1.3, dual: true });
  });

  it('update 老化链对两轴同步（合成比逐轴同乘,X:Y 各向异性比守恒）;缺省尘字段零触碰', async () => {
    const { VanillaDust } = await import('../src/fx/VanillaDust');
    const vd = new VanillaDust();
    const d = vd.spawn(0, 0, 1, 1, 267, 0, 0, 0, null, 0.5)!;   // 267=链 A scale+0.02
    d.scaleX = 0.4; d.scaleY = 0.8;
    d.noGravity = true;                                          // 链 B 兜底 scale−0.04
    const s0 = d.scale;                                          // 拍首快照（spawn 抖动后基值）
    vd.update(0, 0, 800, 600);
    const r = d.scale / s0;                                      // 本拍合成比（+0.02−0.01−0.04）
    expect(d.scaleX).toBeCloseTo(0.4 * r, 10);
    expect(d.scaleY).toBeCloseTo(0.8 * r, 10);
    expect(d.scaleY / (d.scaleX as number)).toBeCloseTo(2, 10);  // 各向异性比守恒
    // 缺省尘：字段保持 undefined = 单标量渲染路径逐字节等价
    const d2 = vd.spawn(0, 0, 1, 1, 267, 0, 0, 0, null, 0.5)!;
    vd.update(0, 0, 800, 600);
    expect(d2.scaleX).toBeUndefined();
    expect(d2.scaleY).toBeUndefined();
  });

  it('each()：双轴尘恒入全亮桶（编排粒子不受 tile 光照）,同型缺省尘路由不变', async () => {
    const { VanillaDust } = await import('../src/fx/VanillaDust');
    const vd = new VanillaDust();
    const dual = vd.spawn(0, 0, 1, 1, 267, 0, 0, 0, null, 0.5)!;
    dual.scaleX = 1; dual.scaleY = 1;
    const plain = vd.spawn(0, 0, 1, 1, 267, 0, 0, 0, null, 0.5)!;
    const fb = new Set([...vd.each(true)]);
    const lit = new Set([...vd.each(false)]);
    expect(fb.has(dual)).toBe(true);      // 双轴 → 全亮桶（光照合成后独立加色层）
    expect(lit.has(dual)).toBe(false);
    expect(lit.has(plain)).toBe(true);    // 同型缺省尘 → lit 桶（既有路由不变）
    expect(fb.has(plain)).toBe(false);
  });
});

// ===========================================================================
// A=0 加性族逐通道乘数 rgbv 金标（2026-09-03）——GetAlpha 非白 RGB 档:
//   183 = (50,0,0,0)  纯红加性（:2619-2621;活发射方 = HealProj 305 尾迹 ×3/子步）
//   258 = (150,50,50,0) 红主加性（:2519-2521;原版/本仓均无字面发射方,dormant）
// alphaOf 标量 rgb 表达不了通道比 → rgbv?: [r,g,b]（XNA Color 字面/255）;
// 消费位 = Renderer.drawVanillaDustPass A=0 加性 s1 ImageData 逐通道乘
// （id.data 本就逐通道,只换乘数来源;标量档归一 [s,s,s] 语义零改动）。
// ===========================================================================
describe('A=0 加性族逐通道乘数 rgbv 金标（2026-09-03）', () => {
  it('alphaOf:183 纯红 [50,0,0]/255、258 红主 [150,50,50]/255;标量档返回形零改动', async () => {
    const { VanillaDust } = await import('../src/fx/VanillaDust');
    const dust = (type: number, scale = 1) => ({ type, alpha: 0, scale } as never);
    expect(VanillaDust.alphaOf(dust(183)))
      .toEqual({ rgb: 0, a: 0, rgbv: [50 / 255, 0, 0] });
    expect(VanillaDust.alphaOf(dust(258)))
      .toEqual({ rgb: 0, a: 0, rgbv: [150 / 255, 50 / 255, 50 / 255] });
    // 标量档回归:未设 rgbv 的既有返回精确形不变（防 rgbv 泄漏进标量档）
    expect(VanillaDust.alphaOf(dust(206))).toEqual({ rgb: 1, a: 0 });
    expect(VanillaDust.alphaOf(dust(110))).toEqual({ rgb: 200 / 255, a: 0 });
  });

  it('逐通道乘数值金标:texel×rgbv = XNA 加法项 tex.rgb×cRGB（G/B 压零=纯红）', () => {
    const m = [50 / 255, 0, 0];                    // alphaOf(183).rgbv
    const texel = [200, 100, 50, 255];             // 尘帧任一不透明 texel
    expect(texel[0] * m[0]).toBeCloseTo(200 * 50 / 255, 6);
    expect(texel[1] * m[1]).toBe(0);               // G 通道压零
    expect(texel[2] * m[2]).toBe(0);               // B 通道压零
    const m2 = [150 / 255, 50 / 255, 50 / 255];    // alphaOf(258).rgbv
    expect(texel[0] * m2[0]).toBeCloseTo(200 * 150 / 255, 6);
    expect(texel[1] * m2[1]).toBeCloseTo(100 * 50 / 255, 6);
    expect(texel[2] * m2[2]).toBeCloseTo(50 * 50 / 255, 6);
  });
});

// ===========================================================================
// ★F1 dust 43 闪光尘档（2026-09-08 红队清偿）——GetAlpha（Dust.cs:2503 num=
// (255−alpha)/255; :2757-2758 (num+9)/10 【只乘 RGB】; :2786-2792 尾段 A=newColor.A
// −alpha,DrawDust Main.cs:39664 传 Lighting 色 A 恒 255 → A=255−alpha≡num）。
// 旧 `a:(num+9)/10` 让烘焙对 erase=texA×0.9 → tileShine 闪尘（spawn α=254,
// TileDrawing.cs:7657）每颗把世界层 90% alpha 擦掉=矿石/宝箱贴图被亮斑掏底
// （用户可见伪影,同 2026-09-04 水花黑十字族）。Renderer 侧 43 恒走 A=0 直绘
// 双 pass（判据结构锁见本 describe 末测试）。
// ===========================================================================
describe('dust 43 闪光尘档（★F1:a=num、rgb=(num+9)/10;43+color 不走烘焙对）', () => {
  const dustOf = (type: number, alpha: number, color: import('../src/fx/VanillaDust').DustColor | null = null) =>
    ({ type, alpha, scale: 0.5, color, noGravity: false, noLight: false } as never);

  it('alphaOf(43) α=254 → a=1/255（纯加性 glint）、rgb=(num+9)/10≈0.9004', () => {
    const got = VanillaDust.alphaOf(dustOf(43, 254));
    expect(got.a).toBeCloseTo(1 / 255, 10);
    expect(got.rgb).toBeCloseTo((1 / 255 + 9) / 10, 10);
    // 判别力：旧档 a=(num+9)/10=0.9004 与正确 num=0.0039 相差 230 倍（防回退钉）
    expect(Math.abs(got.a - (1 / 255 + 9) / 10)).toBeGreaterThan(0.5);
  });

  it('alphaOf(43) 全 α 域 a=(255−alpha)/255 恒等式（:2786-2792 尾段语义）', () => {
    for (const alpha of [0, 100, 200, 254, 255]) {
      const num = (255 - alpha) / 255;
      const got = VanillaDust.alphaOf(dustOf(43, alpha));
      expect(got.a).toBeCloseTo(num, 10);
      expect(got.rgb).toBeCloseTo((num + 9) / 10, 10);
    }
  });

  it('43 自定义色 GetColor pass：红 (255,0,0) → G/B 压 0 的彩色加性（α≈1/255）', () => {
    const rgb = (1 / 255 + 9) / 10;
    const cp = VanillaDust.colorPass(
      dustOf(43, 254, { r: 255, g: 0, b: 0, a: 255 }) as never, rgb, 1 / 255,
    );
    // GetColor = clamp(color.ch − (255 − base.ch)) 后 /255;base 字节 229.6 按字节
    // 语义截断（clamp255 的 v|0）→ 229/255（C# byte 算术同款）
    expect(cp!.r).toBeCloseTo(Math.floor(rgb * 255) / 255, 10);
    expect(cp!.g).toBe(0);                                                // 压零=纯红
    expect(cp!.b).toBe(0);
    expect(cp!.a).toBeCloseTo(1 / 255, 10);   // α 项低于本体支 0.004 阈 → 直绘支门槛看 RGB
  });

  it('结构锁：Renderer 直绘判据含 `|| d.type === 43`、43 GetColor 直绘 pass 在位', () => {
    const src = readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');
    // A=0 直绘支最小判据（43 型恒走直绘,不经烘焙对——烘焙对 e<0.5 二值残段会
    // 把半透 worldLayer α 顶满=掏底/黑块族）
    // ★RB-彩虹魔杖批（2026-09-20）：判据扩员 66 RainbowTorch（Dust.cs:2767-2769
    //  A=0 纯加算档,带 d.color 同样禁入烘焙对——见 dust66-rainbowtorch-additive-verdict）
    expect(src).toContain('if ((a <= 0.004 && !d.color) || d.type === 43 || d.type === 66) {');
    // 43 自定义色 GetColor 加性 pass（本体后的第二 Draw,Main.cs:39696-39704;
    //  66 同程扩员——disco 色靠本程上画面,门槛=RGB 内容）
    expect(src).toContain('if ((d.type === 43 || d.type === 66) && d.color) {');
    expect(src).toContain('VanillaDust.colorPass(d, rgb, a)');
  });
});

// ===========================================================================
// ★BJ342 ND5（2026-09-25）GetAlpha 全表补缺金标（Dust.cs:2497-2798 [1457] 逐档,
// 1458 同文）。变异证红：缺档尘落 default {num,num}=亮度/擦除双偏离——本面任一
// 档回退 default 即红。63/288/289/400/542-545 原版本就无 GetAlpha 分支（default
// 尾=原版相,勿补,BJ228 CENSUS_EXEMPT 同款钉）。
// ===========================================================================
describe('BJ342 ND5 GetAlpha 全表补缺金标', () => {
  const nd = (type: number, o: { alpha?: number; scale?: number; color?: { r: number; g: number; b: number; a: number } | null } = {}) =>
    ({ type, alpha: o.alpha ?? 0, scale: o.scale ?? 1, color: o.color ?? null } as never);
  const num = (a: number) => (255 - a) / 255;

  it('27/197 判别面：27=(num+3)/4 亮度比值档（α100 rgb 0.608→0.902,BJ313 观感域）、197=(250,250,250,150) 与 172 同档', () => {
    expect(VanillaDust.alphaOf(nd(27, { alpha: 100 })))
      .toEqual({ rgb: (num(100) + 3) / 4, a: num(100) });
    expect(VanillaDust.alphaOf(nd(197)))
      .toEqual({ rgb: 250 / 255, a: 150 / 255 });
  });

  it('活跃面：15 rgb 面 + (num+3)/4 族余员、213/260 亮度档、157 脉冲档（f32 双相+无钟兜底）、226·272·228/269/259/306/263', () => {
    expect(VanillaDust.alphaOf(nd(15, { alpha: 150 })))
      .toEqual({ rgb: (num(150) + 3) / 4, a: num(150) });   // 全亮桶成员仍经 alphaOf 取 rgb 面
    for (const t of [29, 35, 41, 44, 45, 56, 57, 73, 74, 274]) {
      expect(VanillaDust.alphaOf(nd(t, { alpha: 100 })))
        .toEqual({ rgb: (num(100) + 3) / 4, a: num(100) });
    }
    expect(VanillaDust.alphaOf(nd(213, { scale: 1 }))).toEqual({ rgb: 102 / 255, a: 102 / 255 });   // (int)(1/2.5×255)=102
    expect(VanillaDust.alphaOf(nd(260, { scale: 1 }))).toEqual({ rgb: 102 / 255, a: 102 / 255 });
    // 157 f32 语义：2.55f=2.54999995（就近舍入向下）→ n7=0.9499999f →
    // rgb=min(255,(int)242.25+50)=255、a=(int)94.99999=94
    expect(VanillaDust.alphaOf(nd(157), { mouseTextColor: 255 })).toEqual({ rgb: 1, a: 94 / 255 });
    // mtc=190（脉冲谷）→ n7=0.29999995f → rgb=(int)76.5+50=126、a=(int)29.999995=29（f64 直算=30 偏差）
    expect(VanillaDust.alphaOf(nd(157), { mouseTextColor: 190 })).toEqual({ rgb: 126 / 255, a: 29 / 255 });
    expect(VanillaDust.alphaOf(nd(157))).toEqual({ rgb: 1, a: 94 / 255 });   // 无钟兜底=255 相
    for (const t of [226, 272, 228]) {
      expect(VanillaDust.alphaOf(nd(t))).toEqual({ rgb: 1, a: 25 / 255 });   // Lerp(light,White,.8) rgb=1 备案、A=25 精确
    }
    expect(VanillaDust.alphaOf(nd(269))).toEqual({ rgb: 1, a: 25 / 255 });   // 与 229 同句 :2687
    expect(VanillaDust.alphaOf(nd(259))).toEqual({ rgb: 230 / 255, a: 230 / 255 });
    // ★BJ707-A 域勘误（2026-10-22）：VDust.color 契约=0-255（doSpawnDust 62-65/
    //  dash6 尾尘/colorPass/331 全消费面同域）——旧夹具误用 0-1 域 color 恰好把
    //  裸域 bug（rgbv=c.ch×num 未归一）锁成"正确"。夹具订正 0-255 域,期望值
    //  归一语义不变（rgbv/a=[c.ch/255]×num）。
    expect(VanillaDust.alphaOf(nd(306, { alpha: 100, color: { r: 255, g: 128, b: 64, a: 255 } })))
      .toEqual({ rgb: 0, a: num(100), rgbv: [num(100), (128 / 255) * num(100), (64 / 255) * num(100)] });   // this.color×num 四通道
    expect(VanillaDust.alphaOf(nd(263, { color: { r: 255, g: 0, b: 0, a: 64 } })))
      .toEqual({ rgb: 0.5, a: (8 / 255) * 0.5 });   // 与 264 同句 :2558
  });

  it('dormant 抽验：323/292 恒白、299-301/305 四色 rgbv、308/309/324×num、304/159、270/271、219-223、279 scale 面、244-247/71/72、284/327', () => {
    expect(VanillaDust.alphaOf(nd(323))).toEqual({ rgb: 1, a: 1 });          // :2506 Color.White
    expect(VanillaDust.alphaOf(nd(292))).toEqual({ rgb: 1, a: 1 });          // :2538 Color.White
    expect(VanillaDust.alphaOf(nd(299))).toEqual({ rgb: 0, a: 200 / 255, rgbv: [50 / 255, 1, 50 / 255] });
    expect(VanillaDust.alphaOf(nd(300))).toEqual({ rgb: 0, a: 1, rgbv: [50 / 255, 200 / 255, 1] });
    expect(VanillaDust.alphaOf(nd(301))).toEqual({ rgb: 0, a: 200 / 255, rgbv: [1, 50 / 255, 125 / 255] });
    expect(VanillaDust.alphaOf(nd(305))).toEqual({ rgb: 0, a: 200 / 255, rgbv: [200 / 255, 50 / 255, 200 / 255] });
    expect(VanillaDust.alphaOf(nd(308))).toEqual({ rgb: 0, a: 190 / 255, rgbv: [225 / 255, 200 / 255, 250 / 255] });
    expect(VanillaDust.alphaOf(nd(309))).toEqual(VanillaDust.alphaOf(nd(308)));
    expect(VanillaDust.alphaOf(nd(324, { alpha: 100 })))
      .toEqual({ rgb: 0, a: (190 / 255) * num(100), rgbv: [(225 / 255) * num(100), (200 / 255) * num(100), (250 / 255) * num(100)] });
    expect(VanillaDust.alphaOf(nd(304, { alpha: 100 }))).toEqual({ rgb: 1, a: num(100) });   // White×num
    expect(VanillaDust.alphaOf(nd(159))).toEqual({ rgb: 250 / 255, a: 50 / 255 });
    expect(VanillaDust.alphaOf(nd(270))).toEqual({ rgb: 1, a: 25 / 255 });   // Lerp .5 仿射光面备案
    expect(VanillaDust.alphaOf(nd(271))).toEqual({ rgb: 1, a: 127 / 255 });
    for (const t of [219, 220, 221, 222, 223]) {
      expect(VanillaDust.alphaOf(nd(t))).toEqual({ rgb: 1, a: 25 / 255 });   // 219/220 活发射方（966/436）
    }
    expect(VanillaDust.alphaOf(nd(279, { scale: 0.64 }))).toEqual({ rgb: 0.64, a: 0.64 });   // ×min(scale,1) 四通道
    expect(VanillaDust.alphaOf(nd(279, { scale: 2 }))).toEqual({ rgb: 1, a: 1 });
    for (const t of [244, 245, 246, 247]) {
      expect(VanillaDust.alphaOf(nd(t))).toEqual({ rgb: 1, a: 0 });
    }
    expect(VanillaDust.alphaOf(nd(71))).toEqual({ rgb: 200 / 255, a: 0 });
    expect(VanillaDust.alphaOf(nd(72))).toEqual({ rgb: 200 / 255, a: 200 / 255 });
    // ★BJ707-A 域勘误（同 306 条注：夹具 color 订正 0-255 契约域）
    expect(VanillaDust.alphaOf(nd(284, { color: { r: 204, g: 153, b: 102, a: 128 } })))
      .toEqual({ rgb: 0, a: 128 / 255, rgbv: [204 / 255, 153 / 255, 102 / 255] });   // newColor×color,A=color.A
    expect(VanillaDust.alphaOf(nd(327))).toEqual({ rgb: 1, a: 1 });   // 夜相面（dormant,isDay 二相判别接线时补）
  });
});
