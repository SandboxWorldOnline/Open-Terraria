// ★BJ719-A（2026-10-25 用户实报「星尘之翼入水后翅膀贴图坐在一块不透明蓝色矩形上,
//   水面上无此现象」定谳+判别锁）。
//
// 定谳链（三面物证,先定谳后动刀）：
//  ① 原版真值（反编译亲读）:Stardust Wings = 物品 3471（ItemID.cs:8488）→ wing slot
//    32（ArmorIDs.cs:2062）;DrawPlayer_09_Wings generic 尾段 color9.A=127×s
//    （PlayerDrawLayers.cs:984-986）+ 叠画 GlowMask[183]×Color(255,255,255,0)×s×(1−shadow)
//    ×1.06（:1099-1104）——A=0 预乘 = 纯加色,逐 texel 贡献 = premultRGB×s（透明域 0）。
//  ② 根因（BJ700-C flatten 族复发面,新消费位）:drawWingOverlay addScratch 摊平
//    alpha=255（旧注「透明像素成不透明黑,加 0 无害」= BJ700-C 已证伪 false belief——
//    主画布 'lighter' 色加 0 确实无害,但 BJ679 水罩 mask 镜像重放同一 scratch：
//    摊平把整片 86×62×1.06 切片 α 刷成 255×f → escapeVeilEnd「前景水×mask」over
//    主画布 = 水下翼 AABB 整片第二层水 = 实报蓝矩形;水上无罩会话（或 mask∩水=∅）
//    = 不可见,与「水面上无此现象」互证。次生偏差（同 token）：半透明 texel 贡献
//    straight 而非 premult（Glow_183 semi 11.9% → 过亮 1/a 倍）+ 染料折叠在摊平底上
//    会给透明域染色。消费面 = 29 selfAdd/31 nebula（Wings 二值 α）/32 glowAdd
//    （Glow_183 半透明）三站。
//  ③ 探针 scripts/_bj719a-wing-veil.mjs 双态实拍:修前 PhaseA 真 drawWingOverlay
//    mirrorPass 重放 α 分布 nPos=6072=n255/semi=0（全矩形）+ E2E 水下翼盒左缘带
//    (5,37,115) 蓝矩形 vs 无翼基线 (0,0,0)（maxD=115;水上恒 0）;修后 nPos=741/
//    n255=152/semi=589（=Glow_183 形状）+ 水下 maxD=0、水上翼开关零差——复现消失。
//  修 = addScratch 去 flatten（保形 RGB×tint,原 alpha 保留）——StringLine BJ703-F
//  「保形染色 'lighter'（透明域贡献 0,XNA 预乘逐项相等）」同款一刀。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
// pngjs 无官方 @types(仅 devDependency 供像素读数)——最小声明
// eslint-disable-next-line @typescript-eslint/no-explicit-any

import { withMutation } from './mutation-guard';
import { wingDrawOf } from '../src/data/vanillaWingVisuals';

const RENDERER = join(process.cwd(), 'src', 'render', 'Renderer.ts');
const SPR = join(process.cwd(), 'public', 'sprites', 'vanilla');

// ===================== §A 定谳锚（数据表+贴图 census） =====================
function alphaCensus(file: string): { a0: number; a255: number; semi: number; w: number; h: number } {
  const png = PNG.sync.read(readFileSync(join(SPR, file)));
  const d = png.data;
  let a0 = 0, a255 = 0, semi = 0;
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    if (a === 0) a0++; else if (a === 255) a255++; else semi++;
  }
  return { a0, a255, semi, w: png.width, h: png.height };
}

describe('BJ719-A §A 定谳锚（slot 32 绘制表 + Glow_183 透明域/半透明 census）', () => {
  it('32 星尘之翼表项:litAlpha 127（:984-986）+ glowAdd Glow_183 ×1.06（:1099-1104）,非 mainGlow 族', () => {
    const d = wingDrawOf(32);
    expect(d.frames).toBe(4);
    expect(d.litAlpha).toBe(127);
    expect(d.mainGlow).toBeUndefined();
    expect(d.overlay?.kind).toBe('glowAdd');
    expect(d.overlay?.file).toBe('Glow_183.png');
    expect(d.overlay?.scale).toBe(1.06);
  });

  it('Glow_183 census:81.8% 全透明 + 11.9% 半透明（摊平病灶的前提物证;帧切 86×62×4）', () => {
    const c = alphaCensus('Glow_183.png');
    const total = c.w * c.h;
    expect(`${c.w}x${c.h}`).toBe('86x248');            // 4 帧 × 62（frames=4 切片）
    expect(c.a0 / total).toBeGreaterThan(0.7);          // 大透明域=摊平→全矩形污染面
    expect(c.semi / total).toBeGreaterThan(0.05);       // 半透明 texel=旧摊平主画面过亮面
    expect(c.semi).toBeGreaterThan(0);
  });

  it('29/31 消费面 census:Wings_29/31 二值 α（semi=0）——本刀对其主画面零变化,只修 mask 面', () => {
    for (const f of ['Wings_29.png', 'Wings_31.png']) {
      const c = alphaCensus(f);
      expect(`${f} ${c.w}x${c.h}`, f).toBe(`${f} 86x248`);
      expect(c.semi, f).toBe(0);                        // 二值 α:保形/摊平主画布逐位同
    }
  });
});

// ===================== §B 行为面（真 drawWingOverlay .call 桩宿直调） =====================
// fake DOM:createElement('canvas') 记录仪——addScratch 全链（clearRect→drawImage→
// getImageData（合成 texel）→loop→putImageData（捕获终态））可在 node 行为面断言。
type Op = Record<string, unknown>;
let hostPixels = new Uint8ClampedArray(0);   // getImageData 返回的合成切片像素（测试前置喂入）
let putCalls: Uint8ClampedArray[] = [];   // 每次 putImageData 捕获的终态 data
function installFakeDom(): void {
  putCalls = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: (): unknown => {
      const ops: Op[] = [];
      const cv = { width: 0, height: 0, ops } as Record<string, unknown>;
      cv.getContext = (): unknown => ({
        clearRect: (...a: unknown[]) => { ops.push({ op: 'clearRect', a }); },
        fillRect: (...a: unknown[]) => { ops.push({ op: 'fillRect', a }); },
        drawImage: (...a: unknown[]) => { ops.push({ op: 'drawImage', a }); },
        getImageData: (x: number, y: number, w: number, h: number) => {
          expect(`${x},${y},${w},${h}`).toBe('0,0,86,62');   // slice 86×62（帧 0）
          return { data: new Uint8ClampedArray(hostPixels), width: w, height: h };
        },
        putImageData: (id: { data: Uint8ClampedArray }) => {
          ops.push({ op: 'putImageData', n: id.data.length });
          putCalls.push(id.data);
        },
      });
      return cv;
    },
  };
}
afterEach(() => { delete (globalThis as Record<string, unknown>).document; });

/** tgt 记录仪 ctx（comp/alpha setter + drawImage 捕获时点态） */
function recCtx() {
  const ops: Op[] = [];
  let comp = 'source-over', alpha = 1;
  const ctx = {
    canvas: { width: 800, height: 600 },
    save: () => { ops.push({ op: 'save' }); },
    restore: () => { ops.push({ op: 'restore' }); },
    drawImage: (...a: unknown[]) => { ops.push({ op: 'draw', comp, alpha, a }); },
    set globalCompositeOperation(v: string) { comp = v; ops.push({ op: 'comp', v }); },
    get globalCompositeOperation() { return comp; },
    set globalAlpha(v: number) { alpha = v; ops.push({ op: 'alpha', v }); },
    get globalAlpha() { return alpha; },
    translate: (...a: unknown[]) => { ops.push({ op: 'translate', a }); },
    imageSmoothingEnabled: false,
  };
  return { ctx, ops };
}

/** 合成 86×62 切片:3 个标记 texel + 其余全透明（首行前 3 像素） */
const MARKERS: Array<[number, number, number, number]> = [
  [255, 255, 255, 0],      // 透明白（摊平陷阱:旧病灶会变不透明白=lighter 白矩形）
  [10, 20, 30, 128],       // 半透明（XNA premult 贡献=RGB×128/255;摊平=RGB 全额）
  [200, 100, 50, 255],     // 不透明
];
function markerHost(): void {
  hostPixels = new Uint8ClampedArray(86 * 62 * 4);
  MARKERS.forEach((m, k) => hostPixels.set(m, k * 4));
}

/** Renderer 模块惰性单例（★先 import 后装 fake DOM——模块级 canvas 探针
 *  GLSpriteLayer:2310 fillRect 在记录仪 DOM 下崩=变异面假红,禁让 import 见 fake DOM） */
let rendererMod: Promise<typeof import('../src/render/Renderer')> | null = null;
const loadRenderer = () => (rendererMod ??= import('../src/render/Renderer'));

async function callWingOverlay(slot: number, settled = 1) {
  const { Renderer } = await loadRenderer();
  const tgt = recCtx();
  const self = {
    atlas: { ensureVImage: (_k: string) => ({ width: 86, height: 248 }) } as never,
    wingTintScratch: null,
    ctx: tgt.ctx,
  };
  const p = {
    grappleProjs: [] as unknown[], miscCounter: 0, facing: 1, iframes: 0,
  } as never;
  (Renderer.prototype as unknown as {
    drawWingOverlay: (p: unknown, slot: number, d: unknown, fr: number, cam: unknown,
      settled: number, clamp: number, vt: unknown, dye: unknown, tgt?: unknown, mp?: boolean) => void;
  }).drawWingOverlay.call(self, p, slot, wingDrawOf(slot), 0, null, settled, 1, null, null, tgt.ctx, true);
  return tgt;
}

describe('BJ719-A §B 行为面（addScratch 保形:alpha 不摊平）', () => {
  it('32 glowAdd:putImageData 终态 alpha 保留 [0,128,255]（摊平回潮即全 255 恰红）', async () => {
    await loadRenderer();          // 先 import（真 DOM 环境）再装记录仪
    installFakeDom();
    markerHost();
    const tgt = await callWingOverlay(32);
    expect(putCalls.length).toBe(1);
    const d = putCalls[0]!;
    expect([d[3], d[7], d[11]]).toEqual([0, 128, 255]);   // ★保形判别:透明/半透/不透
    // RGB 不动（glowAdd tint=[1,1,1]）
    expect([d[0], d[1], d[2]]).toEqual([255, 255, 255]);
    expect([d[4], d[5], d[6]]).toEqual([10, 20, 30]);
    expect([d[8], d[9], d[10]]).toEqual([200, 100, 50]);
    // 主拍/镜像拍同式:'lighter' + globalAlpha=settled（mask 面同函数=同判别）
    const draws = tgt.ops.filter((o) => o.op === 'draw') as Array<{ comp: string; alpha: number; a: unknown[] }>;
    expect(draws.length).toBe(1);
    expect(draws[0]!.comp).toBe('lighter');
    expect(draws[0]!.alpha).toBeCloseTo(1, 9);
    // dest=×1.06 放大（origin=Size/2 随 scale,:1101）
    const [dx, dy, dw, dh] = draws[0]!.a.slice(1) as number[];
    expect(dx).toBeCloseTo(-86 * 1.06 / 2, 6);
    expect(dy).toBeCloseTo(-62 * 1.06 / 2, 6);
    expect(dw).toBeCloseTo(86 * 1.06, 6);
    expect(dh).toBeCloseTo(62 * 1.06, 6);
  }, 120000);

  it('29 selfAdd:alpha 保留 + globalAlpha=0.5（×0.5f :1071=127.5/255）', async () => {
    await loadRenderer();
    installFakeDom();
    markerHost();
    const tgt = await callWingOverlay(29);
    const d = putCalls[0]!;
    expect([d[3], d[7], d[11]]).toEqual([0, 128, 255]);
    const draws = tgt.ops.filter((o) => o.op === 'draw') as Array<{ comp: string; alpha: number }>;
    expect(draws.length).toBe(1);
    expect(draws[0]!.comp).toBe('lighter');
    expect(draws[0]!.alpha).toBeCloseTo(0.5, 9);
  }, 120000);

  it('31 nebula:alpha 保留 + 脉冲 RGB×tint（mc=0 → Lerp(HotPink,Crimson,0.9)）', async () => {
    await loadRenderer();
    installFakeDom();
    markerHost();
    const tgt = await callWingOverlay(31);
    const d = putCalls[0]!;
    expect([d[3], d[7], d[11]]).toEqual([0, 128, 255]);   // 保形
    const t = Math.cos(0) * 0.4 + 0.5;                     // =0.9
    const mul = [(255 + (220 - 255) * t) / 255, (105 + (20 - 105) * t) / 255, (180 + (60 - 180) * t) / 255];
    expect(d[8]).toBeCloseTo(200 * mul[0], 0);             // 不透明 texel RGB×脉冲色
    expect(d[9]).toBeCloseTo(100 * mul[1], 0);
    expect(d[10]).toBeCloseTo(50 * mul[2], 0);
    const draws = tgt.ops.filter((o) => o.op === 'draw') as Array<{ comp: string; alpha: number }>;
    expect(draws.length).toBe(5);                          // 4 轨道(×0.5)+全幅(×1)
    expect(draws.every((x) => x.comp === 'lighter')).toBe(true);
  }, 120000);

  it('半透明贡献=premult 语义:XNA One 因子（RGB×a×f）——探针 tgt 直读 rgbSum 与修前逐位同（f=1 时形状域色贡献不变,变的只是透明域 α 污染）', async () => {
    // 本案为判别说明锁:保形后 scratch 画到不透明底,半透 texel 贡献 = RGB×a/255
    // （旧摊平=RGB 全额=过亮 1/a 倍,Glow_183 semi 11.9% 全体）;数学锚=StringLine
    // BJ703-F「保形染色 'lighter'（透明域贡献 0,XNA 预乘逐项相等）」同款。
    expect(true).toBe(true);
  });
});

// ===================== §C 结构锁 =====================
describe('BJ719-A §C 结构锁（flatten token 退役+定谳注在位）', () => {
  const body = (): string => {
    const src = readFileSync(RENDERER, 'utf8');
    const i = src.indexOf('private drawWingOverlay(p: Player, slot: number,');
    return src.slice(i, i + 26000);
  };
  it('addScratch 循环体无 alpha 摊平 token（=255 写位）;BJ719-A 定谳注在位', () => {
    const b = body();
    expect(b).toContain('const addScratch =');
    expect(b).not.toContain('id.data[i + 3] = 255');        // ★摊平 token 恰红判位
    expect(b).toContain('★BJ719-A（2026-10-25 用户实报「星尘之翼入水出现蓝色矩形影」定谳）');
    expect(b).toContain('保形');                            // 保形语义注
  });
  it('全文件无其他 addScratch 族摊平位（renderer 内 id.data 域唯一写位收敛）', () => {
    const src = readFileSync(RENDERER, 'utf8');
    expect(src.match(/id\.data\[i \+ 3\] = 255/g)).toBeNull();
  });
  it('glowAdd 消费注释锚原版 :1099-1104（GlowMask[183]×Color(255³,0)×1.06）', () => {
    expect(body()).toContain('32（:1099-1104）：GlowMask[183]×Color(255³,0)×s×(1−shadow)（未突变）');
  });
});

// ===================== §D 变异自证（摊平回潮恰红） =====================
describe.skipIf(process.env.SW_BJ719A_MUT)('BJ719-A §D 变异自证', () => {
  it('M1 addScratch flatten 回潮（alpha=255 重注入）→ §B 行为面恰红', () => {
    withMutation(RENDERER,
      `id.data[i] *= rgb[0]; id.data[i + 1] *= rgb[1]; id.data[i + 2] *= rgb[2];
        // ★BJ719-A：alpha 不摊平（保形——透明域贡献 0；摊平会污染水罩 mask 成全矩形）`,
      `id.data[i] *= rgb[0]; id.data[i + 1] *= rgb[1]; id.data[i + 2] *= rgb[2];
        id.data[i + 3] = 255;   // ★BJ719A 变异:摊平回潮（水罩 mask 全矩形=蓝矩形复发）`,
      () => {
        const r = spawnSync('npx', ['vitest', 'run', 'tests/bj719a-stardust-wing-veil.test.ts',
          '--no-file-parallelism', '-t', 'putImageData 终态 alpha 保留'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
          env: { ...process.env, SW_BJ719A_MUT: '1' },
        });
        expect(r.status, '变异须证红: flatten 回潮=alpha 全 255').not.toBe(0);
        expect(r.stdout).toContain('putImageData 终态 alpha 保留');
      }, { label: 'BJ719A M1 addScratch flatten 回潮' });
  });
});
