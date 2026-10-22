// ★BJ703-F（2026-10-21）登记债清算·渲染域残余（BJ700-C flatten 族②③ + BJ682 两项定谳）
// 判别锁。逐件定谳（先定谳后动刀,反编译亲读 + 纹理 census + 预乘语义三面物证）：
//
// 【件1 PrismProj 632 光束 flatten 债（BJ700-C 登记债②）】
//  原版真值（Main.cs:32819-32840 亲读）：632 双 pass DrawLaser——hue pass
//  color79=hslToRgb(hue,1,0.5) 且 A×=laserAlphaMultiplier（普通玩家名=0 → 纯加法
//  零衰减）;白 pass Color(255,255,255,127)×0.75×Opacity。XNA 实体 pass
//  AlphaBlend=One/InvSrcAlpha（:22399）对预乘贴图贡献=tex.rgb×tex.a×C.rgb
//  【不吃 C.a】→ 'lighter'+保形染色逐 texel 精确;透明域贡献 0。旧 flatten=true
//  摊平（multiply 对 αb=0 背景 Co=Cs——BJ700-C 探针实证 329 图 6684 透明 texel 全变
//  染色底）→ 'lighter' 全幅加色 = 光束偏宽偏实。632 图 26×78 二值 α、43.4% 透明
//  （帧 0/1/2 = 43.4%/46.2%/29.4%,离线 census）→ flatten=false 语义精确。
//
// 【件2 StringLine 渔线/悠悠球线 flatten 债（BJ700-C 登记债③）】
//  消费面普查（定谳:全 LIVE,非「仅色 29」）：
//   · 悠悠球/配重球线（Main.cs:28466-28474 亲读）：White×0.4(102) →
//     TryApplyingPlayerStringColor → 非 29 GetColor 重置 A=255 → 全通道 ×0.5
//     ⇒ A=127【恒中间档】——psc=0（无任何线饰品）即命中 = 每根悠悠球线都是消费面;
//     psc=29（5540/5541 直置,Player.cs:2765）⇒ A=0 纯加色档。
//   · 钓鱼线（Main.cs:36133-36162）：非 29 A=255（保形 source-over 无害）;29 ⇒ A=0。
//  FishingLine.png 12×12 仅列 5/6 不透明白（83.3% 透明,二值 α）→ flatten=true
//  摊平加色 = 12px 宽染色带（6× 线宽）。修=两档 flatten=false（XNA One 因子精确）。
//
// 【件3 Renderer 1034 星辰鞭线体（BJ700-C 登记债⑤复审定谳——「ga≈0.047 忽略级」
//  前提不成立）】原版线色 = hslToRgb(0.6,1,0.5,20)×0.6 = (0,61,153,12)（Main.cs
//  :36718-36721）,flag3 免取光。XNA 预乘对白 texel 贡献=(0,61,153)【全额,不吃
//  C.a】（PrismProj 白 pass「白芯 ×127/255 亮度减半皆误」同判例已实证废黜）→ 旧
//  单笔 source-over@ga=12/255 = 线体 4.7% 亮度（≈21× 过暗）+摊平带。修=
//  StringLine 中间档同款两笔（黑形@ga + 保形染色 'lighter' 全额）。
//
// 【BJ682 两项】见本文件 §F 定谳锁（630 无充能帧机=登记前提证伪;drawLayer=4 族
//  =PROJ_DRAW_OVER_PLAYERS 表注既有声明近似）——判语销案面,无行为刀。
//
// 同族登记债现状（本刀域外）:WhipProj drawWhipFrame 三档（BJ700-C 债④）=
//  BJ703-B D5 已落盘（2026-10-21,flatten=false×3）;projGhostTrail drawHslMidpointTrail
//  :872（BJ700-C 债①）仍开——16×16 18.8% 透明,修法同款一 token。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { withMutation } from './mutation-guard';
import { tintedTex, drawYoyoStringLine, drawFishingStringLine } from '../src/render/StringLine';
import { PrismProng } from '../src/entities/PrismProj';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import { Renderer } from '../src/render/Renderer';

const STRINGLINE = join(process.cwd(), 'src', 'render', 'StringLine.ts');
const PRISMPROJ = join(process.cwd(), 'src', 'entities', 'PrismProj.ts');
const RENDERER = join(process.cwd(), 'src', 'render', 'Renderer.ts');

// ---- fake DOM（bj700c 习语）:createElement('canvas') 返回带 op 记录仪的画布,
//      使 tintedTex 烘焙链可在 node 断言（含 fillStyle 染色身份判别）----
interface FakeCanvas { __id: string; width: number; height: number; ops: string[] }
let fakeCanvases: FakeCanvas[] = [];
function installFakeDom(): void {
  let seq = 0;
  fakeCanvases = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: (): FakeCanvas => {
      const cv: FakeCanvas = { __id: `bake-${++seq}`, width: 0, height: 0, ops: [] };
      let comp = 'source-over';
      (cv as unknown as Record<string, unknown>).getContext = (): unknown => ({
        drawImage: (...a: unknown[]) => { cv.ops.push(`draw:${(a[0] as { __id?: string }).__id ?? 'raw'}`); },
        fillRect: (...a: unknown[]) => { cv.ops.push(`fill:${a.slice(0, 4).join(',')}`); },
        get globalCompositeOperation() { return comp; },
        set globalCompositeOperation(v: string) { comp = v; cv.ops.push(`comp:${v}`); },
        fillStyle: '#000',
        imageSmoothingEnabled: false,
      });
      fakeCanvases.push(cv);
      return cv;
    },
  };
}
/** 染色身份记录仪:fillStyle 写入也入 ops（区分黑形 bake 与染色 bake） */
function installFakeDomWithStyle(): void {
  let seq = 0;
  fakeCanvases = [];
  (globalThis as Record<string, unknown>).document = {
    createElement: (): FakeCanvas => {
      const cv: FakeCanvas = { __id: `bake-${++seq}`, width: 0, height: 0, ops: [] };
      let comp = 'source-over';
      let style = '#000';
      (cv as unknown as Record<string, unknown>).getContext = (): unknown => ({
        drawImage: (...a: unknown[]) => { cv.ops.push(`draw:${(a[0] as { __id?: string }).__id ?? 'raw'}`); },
        fillRect: (...a: unknown[]) => { cv.ops.push(`fill:${a.slice(0, 4).join(',')}`); },
        get globalCompositeOperation() { return comp; },
        set globalCompositeOperation(v: string) { comp = v; cv.ops.push(`comp:${v}`); },
        get fillStyle() { return style; },
        set fillStyle(v: string) { style = v; cv.ops.push(`fillStyle:${v}`); },
        imageSmoothingEnabled: false,
      });
      fakeCanvases.push(cv);
      return cv;
    },
  };
}
afterEach(() => { delete (globalThis as Record<string, unknown>).document; });

/** 消费端记录仪 ctx（drawImage/comp/ga 全录） */
interface RecCtx {
  ops: string[]; drawIds: string[]; gas: number[];
  ctx: CanvasRenderingContext2D;
}
function recCtx(): RecCtx {
  const ops: string[] = [];
  const drawIds: string[] = [];
  const gas: number[] = [];
  let ga = 1;
  let gco = 'source-over';
  const c: Record<string, unknown> = {
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
    translate: () => ops.push('translate'),
    rotate: () => ops.push('rotate'),
    scale: () => ops.push('scale'),
    setTransform: () => ops.push('setTransform'),
    drawImage: (...a: unknown[]) => {
      ops.push('draw');
      drawIds.push((a[0] as { __id?: string }).__id ?? 'raw');
      gas.push(ga);
    },
    globalAlpha: 1,
    filter: 'none',
    imageSmoothingEnabled: false,
  };
  Object.defineProperty(c, 'globalCompositeOperation', {
    get: () => gco,
    set: (v: string) => { gco = v; ops.push(`comp:${v}`); },
  });
  Object.defineProperty(c, 'globalAlpha', {
    get: () => ga,
    set: (v: number) => { ga = v; ops.push(`ga:${v}`); },
  });
  return { ops, drawIds, gas, ctx: c as unknown as CanvasRenderingContext2D };
}
const bakeOps = (id: string): string[] => fakeCanvases.find((c) => c.__id === id)?.ops ?? [];
const texOf = (id: string, w = 12, h = 12) => ({ __id: id, width: w, height: h }) as never;

// ============================================================
// §A 件2:StringLine 三档消费面（悠悠球 A=127 中间档/29 纯加色/钓线 A=255）
// ============================================================
describe('BJ703-F §A StringLine flatten 保形（FishingLine 12×12 列 5/6 白,83.3% 透明）', () => {
  it('悠悠球线默认档（psc=0）恒中间档 A=127：黑形@ga=127/255 + 保形染色 lighter 全额（每段两笔）', () => {
    installFakeDomWithStyle();
    const rc = recCtx();
    drawYoyoStringLine(rc.ctx, texOf('line'), 0, 0,
      { x: 0, y: 40, w: 12, h: 12, vx: 0, vy: 0 }, 0,
      { disco: [255, 255, 255], mouseTextColor: 255 });
    expect(rc.drawIds.length).toBeGreaterThanOrEqual(1);            // 段链 ≥1 段
    // 每段两笔:黑形 bake(rgb(0,0,0)) + 染色 bake(rgb(127,127,127)——127=255×0.5)
    const black = fakeCanvases.find((c) => c.ops.includes('fillStyle:rgb(0,0,0)'));
    const tint = fakeCanvases.find((c) => c.ops.includes('fillStyle:rgb(127,127,127)'));
    expect(black, '黑形 bake 在位').toBeDefined();
    expect(tint, '染色 bake 在位(A=127 档线色 127,127,127)').toBeDefined();
    // ★判别点:两 bake 必须 destination-in 保形（flatten=false;摊平=透明域染色底回潮）
    expect(black!.ops).toContain('comp:multiply');
    expect(black!.ops).toContain('comp:destination-in');
    expect(tint!.ops).toContain('comp:multiply');
    expect(tint!.ops, '染色烘焙须保 alpha 形状（flatten=false）').toContain('comp:destination-in');
    // 笔序:黑形 source-over@127/255 → 染色 'lighter'@1
    const iBlack = rc.drawIds.indexOf(black!.__id);
    const iTint = rc.drawIds.indexOf(tint!.__id);
    expect(iBlack).toBeGreaterThanOrEqual(0);
    expect(iTint).toBeGreaterThan(iBlack);
    expect(rc.gas[iBlack]).toBeCloseTo(127 / 255, 9);
    expect(rc.gas[iTint]).toBeCloseTo(1, 9);
    expect(rc.ops).toContain('comp:lighter');
  });

  it('线色 29（5540/5541）⇒ A=0 纯加色档:单笔保形染色 lighter,无黑形笔', () => {
    installFakeDomWithStyle();
    const rc = recCtx();
    drawFishingStringLine(rc.ctx, texOf('line'), 0, 0,
      { x: 0, y: 40, w: 12, h: 12, vx: 0, vy: 0 }, [200, 200, 200], 29,
      { disco: [255, 255, 255], mouseTextColor: 255, rand: () => 0.5 });
    expect(rc.drawIds.length).toBeGreaterThanOrEqual(1);
    expect(rc.ops).toContain('comp:lighter');                       // 纯加色
    const drawn = [...new Set(rc.drawIds)];
    for (const id of drawn) {
      expect(bakeOps(id), 'A=0 档烘焙须保形（flatten=false）').toContain('comp:destination-in');
      expect(bakeOps(id)).not.toContain('fillStyle:rgb(0,0,0)');    // 无黑形笔
    }
    expect(rc.gas.every((g) => g === 1)).toBe(true);                // ga 不衰减
  });

  it('钓鱼线默认档 A=255:单笔保形 source-over（无 lighter/无黑形）', () => {
    installFakeDomWithStyle();
    const rc = recCtx();
    drawFishingStringLine(rc.ctx, texOf('line'), 0, 0,
      { x: 0, y: 40, w: 12, h: 12, vx: 0, vy: 0 }, [200, 200, 200], 0,
      { disco: [255, 255, 255], mouseTextColor: 255 });
    expect(rc.drawIds.length).toBeGreaterThanOrEqual(1);
    expect(rc.ops).not.toContain('comp:lighter');
    const drawn = [...new Set(rc.drawIds)];
    for (const id of drawn) {
      expect(bakeOps(id), 'A=255 档烘焙须保形').toContain('comp:destination-in');
    }
  });
});

// ============================================================
// §B 件1:PrismProj 632 双 pass 保形（hue/白,26×78 二值 α 43.4% 透明）
// ============================================================
describe('BJ703-F §B 棱镜光束双 pass flatten=false（Main.cs:32819-32840）', () => {
  it('hue/白双 bake 保形 + lighter + ga=0.75×opacity（贡献不吃 C.a）', () => {
    installFakeDomWithStyle();
    setProjSpriteOverride(632, { width: 26, height: 78 } as unknown as HTMLImageElement);
    const prong = new PrismProng(0, 100, 2);
    prong.x = 100; prong.y = 100;      // cx=109,cy=109（盒 18×18）
    prong.vx = 0; prong.vy = -1;
    prong.beamLen = 100; prong.prongScale = 1; prong.opacity = 1;
    const rc = recCtx();
    prong.draw({ canvas: null as never, ctx: rc.ctx } as never);
    // 双 bake:hue（idx0 → rgb(255,0,0)）+ 白（rgb(255,255,255)）
    const hue = fakeCanvases.find((c) => c.ops.includes('fillStyle:rgb(255,0,0)'));
    const white = fakeCanvases.find((c) => c.ops.includes('fillStyle:rgb(255,255,255)'));
    expect(hue, 'hue bake 在位').toBeDefined();
    expect(white, '白 bake 在位').toBeDefined();
    for (const b of [hue!, white!]) {
      expect(b.ops).toContain('comp:multiply');
      expect(b.ops, '光束烘焙须保 alpha 形状（flatten=false=锥形辉光;摊平=偏宽偏实）')
        .toContain('comp:destination-in');
    }
    expect(rc.ops).toContain('comp:lighter');                       // 预乘纯加法等价
    expect(rc.drawIds.length).toBeGreaterThanOrEqual(3);            // 帽+身+尾 ≥3 笔
    expect(rc.gas.every((g) => Math.abs(g - 0.75) < 1e-9), 'ga=0.75×opacity').toBe(true);
    expect(new Set(rc.drawIds)).toEqual(new Set([hue!.__id, white!.__id]));
  });
});

// ============================================================
// §C 件3:Renderer.flushWhipFullbright 1034 两笔制（(0,61,153,12)）
// ============================================================
describe('BJ703-F §C 1034 星辰鞭线体两笔制（贡献=(0,61,153) 全额,不吃 C.a）', () => {
  it('黑形@ga=12/255 + 保形染色 lighter 全额（单笔 ga 档=亮度 4.7% 回潮必红）', () => {
    installFakeDomWithStyle();
    const rc = recCtx();
    const host = {
      whipFullbrightQueue: [{
        pts: [{ x: 0, y: 0 }, { x: 0, y: 40 }],
        tex: texOf('line'),
        color: [0, 61, 153, 12] as [number, number, number, number],
      }],
      ctx: rc.ctx,
      _veilActive: false,
    } as never;
    const flush = (Renderer.prototype as unknown as {
      flushWhipFullbright: (this: unknown, cam: { worldToScreen: (x: number, y: number) => [number, number] }, z: number) => void;
    }).flushWhipFullbright;
    flush.call(host, { worldToScreen: (x, y) => [x, y] }, 1);
    const black = fakeCanvases.find((c) => c.ops.includes('fillStyle:rgb(0,0,0)'));
    const tint = fakeCanvases.find((c) => c.ops.includes('fillStyle:rgb(0,61,153)'));
    expect(black, '黑形 bake 在位（背景衰减 ×(1−T.a×12/255) 载体）').toBeDefined();
    expect(tint, '染色 bake 在位（线色 0,61,153）').toBeDefined();
    for (const b of [black!, tint!]) {
      expect(b.ops).toContain('comp:multiply');
      expect(b.ops, '线体烘焙须保形（FishingLine 列 5/6）').toContain('comp:destination-in');
    }
    const iBlack = rc.drawIds.indexOf(black!.__id);
    const iTint = rc.drawIds.indexOf(tint!.__id);
    expect(iBlack).toBeGreaterThanOrEqual(0);
    expect(iTint).toBeGreaterThan(iBlack);
    expect(rc.gas[iBlack]).toBeCloseTo(12 / 255, 9);                // 衰减面 ga
    expect(rc.gas[iTint]).toBeCloseTo(1, 9);                        // ★贡献面全额(=1)
    expect(rc.ops).toContain('comp:lighter');
  });
});

// ============================================================
// §D 结构锁（源锚——防静默回退）
// ============================================================
describe('BJ703-F §D 结构锁', () => {
  it('StringLine.ts 三档 flatten=false + BJ703-F 标记', () => {
    const src = readFileSync(STRINGLINE, 'utf8');
    expect(src).toContain('const t = tintedTex(tex, [color[0], color[1], color[2]], false);');
    expect(src).toContain('const black = tintedTex(tex, [0, 0, 0], false);');
    expect(src, '摊平 true 档须清零（三处全 false）').not.toMatch(/tintedTex\([^)]*,\s*true\)/);
  });
  it('PrismProj.ts 双 pass flatten=false + BJ703-F 标记', () => {
    const src = readFileSync(PRISMPROJ, 'utf8');
    expect(src).toContain('const hueTex = tintedTex(img, [rr, gg, bb], false);');
    expect(src).toContain('const whiteTex = tintedTex(img, [255, 255, 255], false);');
    expect(src).toContain('★BJ703-F（BJ700-C 同族 flatten 债清偿）');
  });
  it('Renderer.ts flushWhipFullbright 两笔制（黑形+lighter 全额）+ 1034 线色锚', () => {
    const src = readFileSync(RENDERER, 'utf8');
    const i = src.indexOf('private flushWhipFullbright');
    const body = src.slice(src.lastIndexOf('/**', i), src.indexOf('private ', i + 10));
    expect(body).toContain('const black = tintedTex(tex as never, [0, 0, 0], false);');
    expect(body).toContain('const tinted = tintedTex(tex as never, [r, g, b], false);');
    expect(body).toContain('ctx.globalAlpha = a / 255;');
    expect(body).toContain("ctx.globalCompositeOperation = 'lighter';");
    // ★BJ705-G26 件5 陈锁重锚（2026-10-22,测试侧,Renderer 代码零改）:并行
    //   whipLineBatch 批（2026-10-21 万花筒掉帧刀）在 BJ703-F 头注与函数之间插入了
    //   自带方法+注释块——「紧邻注释含标记」形被推翻一次（BJ705-A 移交件）。批收口
    //   证据=whip 会话 Renderer 静默 >3h（01:29 后无写）+内容稳定。标记锚放宽为
    //   函数前 4000 字符窗（BJ703-F 头注与在途批注释共存;勿回缩紧邻形）。
    const head = src.slice(Math.max(0, i - 4000), i);
    expect(head).toContain('★BJ703-F');
    // WhipProj 收集侧 1034 线色 = hslToRgb(0.6,1,0.5,20)×0.6 = (0,61,153,12)（:36718-36721）
    const whip = readFileSync(join(process.cwd(), 'src', 'entities', 'WhipProj.ts'), 'utf8');
    expect(whip).toContain('const WHIP_1034_LINE: RGBA = (() => {');
    expect(whip).toContain('hslToRgb255(0.6, 1, 0.5, 20)');
  });
});

// ============================================================
// §E BJ682 两项定谳锁（判语销案面）
// ============================================================
describe('BJ703-F §E BJ682 两登记债定谳（销案,无行为刀）', () => {
  it('630 充能三档帧前提证伪:projFrames[630] 无赋值（单帧）;档位只驱 volley 节奏(已 1:1)', () => {
    // 原版 1456≡1457 亲读:Main.cs 无 projFrames[630] 赋值(单帧 32×54);充能档
    // (ai[0]≥40/80/120,Projectile.cs:68201-68213)只改 volley interval 24/22/20/18
    // ——本仓 Arrow.ph630Age 档位已 1:1(节奏面无帧面)。真缺口=Main.cs:32668-32676
    // 的 GlowMask[200] 白 127 柔光叠画(32×54,76.4% 透明) + Extra[65] 6 帧枪口闪光
    // (t=30 后 6 拍渐隐,负 frameY=PointClamp 顶行=全透不可见)——cosmetic 未实报,
    // 新登记(见 memory),非「三档帧」补帧刀。
    const proj = readFileSync('/Users/vinlic/Project/GLM/SandboxWorld/Terarria1457/Terraria/Projectile.cs', 'utf8');
    expect(proj).not.toContain('projFrames[630]');            // 单帧铁证(无赋值)
    const main = readFileSync('/Users/vinlic/Project/GLM/SandboxWorld/Terarria1457/Terraria/Main.cs', 'utf8');
    expect(main).toContain('projFrames[633] = 5;');           // 对照:633 有(5 帧)
    expect(main).toContain('GlowMask[200].Value');            // 630 真缺口锚
    expect(main).toContain('TextureAssets.Extra[65].Value');  // 枪口闪光锚
    // 本仓节奏档位在位(40/80/120 → 24/22/20/18)
    const arrow = readFileSync(join(process.cwd(), 'src', 'entities', 'Arrow.ts'), 'utf8');
    expect(arrow).toContain('加速窗档位 40/80/120 → interval 24/22/20/18');
  });
  it('drawLayer=4 族(759/1106/1115/1116) OverPlayers 层序=表注既有声明近似(销案)', () => {
    // 原版 1457 SetDefaults 亲读:759(:7846)/1106(:10316)/1115(:10411)/1116(:10427)
    // drawLayer=4 → DrawCacheProjsOverPlayers(:63205,玩家层组后)——本仓 postPlayerDraws
    // (drawPlayer 后冲刷)对普通甲=层序正确;对 7e 恒色甲重绘面=PROJ_DRAW_OVER_PLAYERS
    // 表注既有声明近似(R2 内容整窗重放无法夹层,无报面)。
    const src = readFileSync(RENDERER, 'utf8');
    expect(src).toContain('const PROJ_DRAW_OVER_PLAYERS = new Set<number>([');
    expect(src).toContain('759, 1106, 1115, 1116,');
    expect(src).toContain('4/5/7/8 族统一留在既有"玩家后"冲刷');
  });
});

// ============================================================
// §F 变异自证（flatten 回潮恰红）
// ============================================================
describe.skipIf(process.env.SW_BJ703F_MUT)('BJ703-F §F 变异自证', () => {
  const runCase = (t: string) => {
    const r = spawnSync('npx', ['vitest', 'run', 'tests/bj703f-render-legacy-reds.test.ts',
      '--no-file-parallelism', '-t', t], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ703F_MUT: '1' },
    });
    expect(r.status, `变异须证红: ${t}`).not.toBe(0);
    expect(r.stdout).toContain(t);
  };
  it('M1 StringLine A=0 档 flatten=false→true（染色带回潮）→ §A 恰红', () => {
    withMutation(STRINGLINE,
      `const t = tintedTex(tex, [color[0], color[1], color[2]], false);
    if (!t) { ctx.restore(); return; }
    ctx.globalCompositeOperation = 'lighter';`,
      `const t = tintedTex(tex, [color[0], color[1], color[2]], true);   // ★BJ703F 变异:摊平回潮
    if (!t) { ctx.restore(); return; }
    ctx.globalCompositeOperation = 'lighter';`,
      () => runCase('线色 29'), { label: 'BJ703F M1 StringLine A=0 档' });
  });
  it('M2 StringLine 中间档 flatten=false→true（悠悠球线带回潮）→ §A 恰红', () => {
    withMutation(STRINGLINE,
      `const t = tintedTex(tex, [color[0], color[1], color[2]], false);
    if (!black || !t)`,
      `const t = tintedTex(tex, [color[0], color[1], color[2]], true);   // ★BJ703F 变异:摊平回潮
    if (!black || !t)`,
      () => runCase('悠悠球线默认档'), { label: 'BJ703F M2 StringLine 中间档' });
  });
  it('M3 PrismProj hue pass flatten=false→true（光束偏宽回潮）→ §B 恰红', () => {
    withMutation(PRISMPROJ,
      'const hueTex = tintedTex(img, [rr, gg, bb], false);',
      'const hueTex = tintedTex(img, [rr, gg, bb], true);   // ★BJ703F 变异:摊平回潮',
      () => runCase('hue/白双 bake 保形'), { label: 'BJ703F M3 PrismProj' });
  });
  it('M4 Renderer 1034 染色笔 flatten=false→true（线带回潮）→ §C 恰红', () => {
    withMutation(RENDERER,
      'const tinted = tintedTex(tex as never, [r, g, b], false);',
      'const tinted = tintedTex(tex as never, [r, g, b], true);   // ★BJ703F 变异:摊平回潮',
      () => runCase('黑形@ga=12/255'), { label: 'BJ703F M4 Renderer 1034' });
  });
});
