// ★BJ756-A（2026-11-02,g36a 任务书 T5 / bj739a D-③ 真着色面清偿）行为锁:
// Hunter 药水逐通道钳底剪影 pass（applyHunterTintFloor）。
//
// 标杆（Terarria1457 亲读）:
//   · NPC.cs:92126-92135 AppearsFriendlyToHunterPotion（friendly||catchItem>0||
//     (damage==0&&lifeMax==5);HunterPotionFriendlyOverride {689:false}=NPCID.cs:4462）
//   · NPC.cs:92137 CanApplyHunterPotionEffects（PerspectivePlayer.detectCreature=buff17）
//   · NPC.cs:92230-92258 尾段逐通道钳底:友好 (50,255,50)/其余 (255,50,50)
//   · NPC.cs:92226-92229 ichor 整色替换 (255,255,0) 先于钳底
//   · Main.cs:23115+23170 npcColor = 单点光照(中心格)→着色链→Draw 乘贴图
//     = 钳底作用在光照色上 ⇒ 全黑暗保底可见（「乘光前调制=红」BJ739 病根的反面）
//
// 锁面:
//   T1 暗场全黑钳底色钉值（敌红/友绿/ichor 黄）+ 三步烘焙形态（BJ481 掩膜快照）
//   T2 部分光逐通道差值（含 max 钳负）
//   T3 乘光前调制=红 回归锁（全亮+tint 暗化 debuff → 差值非零=不被乘光抹掉;
//      全亮+无 tint → 零差值零开销跳过）
//   T4 mask 对位锁（捕获变换与本体重绘同参:translate/rotate/scale/drawImage dest）
//   T5 GL sink 分支（texFromImage+quad vCol=(1,1,1,0),无 2D blit;失败旗）
//   T6 多实体循环完整性（逐实体 continue——⑦月总 return 截断病的反向锁）
//   T7 谓词单源（B12 近似层退役后语义收编;城镇族判绿勘误）
//   S* 结构锁（合成后位序/B12 框退役/捕获排除族）
//   M* 变异恰红
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Renderer } from '../src/render/Renderer';
import { TownNPC } from '../src/entities/TownNPC';
import { withMutation } from './mutation-guard';

afterEach(() => { vi.restoreAllMocks(); });

beforeAll(() => {
  // Renderer 构造域浏览器全局替身（bj739a 同款）
  (globalThis as Record<string, unknown>).Image = class {
    src = ''; onload: (() => void) | null = null;
    width = 0; height = 0;
    addEventListener() { /* noop */ }
  };
  const anyStub = (): Record<string, unknown> => new Proxy(function stub() { /* noop */ } as unknown as Record<string, unknown>, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyStub()),
    set: () => true,
    apply: () => anyStub(),
    construct: () => anyStub(),
  });
  (globalThis as Record<string, unknown>).document = { createElement: () => anyStub() };
  (globalThis as unknown as { addEventListener: unknown }).addEventListener = () => {};
  (globalThis as Record<string, unknown>).window = { addEventListener: () => {}, removeEventListener: () => {} };
});

const rendererSrc = readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');

// ===================== 录制桩（bj481 同构;fillStyle 借 gco 槽 + ga 槽扩展） =====================
interface Op { op: string; gco?: string; ga?: number; src?: unknown; args?: unknown[] }
function makeRig(tag: string) {
  const ops: Op[] = [];
  const ctx = {
    _tag: tag,
    width: 0, height: 0,
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    setTransform(...a: unknown[]) { ops.push({ op: 'xf', args: a }); },
    clearRect(...a: unknown[]) { ops.push({ op: 'clear', args: a }); },
    fillRect(this: { fillStyle: string }, ...a: unknown[]) {
      ops.push({ op: 'fill', args: a, gco: String(this.fillStyle) });
    },
    drawImage(this: { globalCompositeOperation: string; globalAlpha: number }, src: unknown, ...a: unknown[]) {
      ops.push({ op: 'draw', src, args: a, gco: String(this.globalCompositeOperation), ga: this.globalAlpha });
    },
    save() { ops.push({ op: 'save' }); },
    restore() { ops.push({ op: 'restore' }); },
    translate(...a: unknown[]) { ops.push({ op: 'translate', args: a }); },
    rotate(...a: unknown[]) { ops.push({ op: 'rotate', args: a }); },
    scale(...a: unknown[]) { ops.push({ op: 'scale', args: a }); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  return { ops, ctx, canvas };
}

// ===================== 夹具 =====================
interface Entry {
  img: unknown; sx: number; sy: number; sw: number; sh: number;
  cx: number; cy: number; rot: number; mirror: boolean; scale: number;
  by: number; ga: number; tint: [number, number, number] | null; ichor?: boolean;
  floor: [number, number, number];
}

const mkEntry = (over: Partial<Entry> = {}): Entry => ({
  img: { tag: 'zombie-frame' }, sx: 0, sy: 0, sw: 40, sh: 56,
  cx: 808, cy: 608, rot: 0, mirror: false, scale: 1,
  by: -28, ga: 1, tint: null, floor: [255, 50, 50], ...over,
});

function makeFixture(opts: { light?: [number, number, number]; entries?: Entry[] } = {}) {
  const main = makeRig('main');
  const scratchRig = makeRig('hfloor');
  const maskRig = makeRig('hmask');
  const [lr, lg, lb] = opts.light ?? [0, 0, 0];
  const light = {
    r: new Uint8Array([lr]), g: new Uint8Array([lg]), b: new Uint8Array([lb]),
  };
  const cam = { zoom: 1, x: 800, y: 600 };
  const quadCalls: Array<{ tex: unknown; vd: Float32Array; additive: boolean; smooth: boolean }> = [];
  const texCalls: Array<{ key: string; img: unknown; refresh: boolean }> = [];
  const fake = {
    ctx: main.ctx,
    hunterFloorScratch: scratchRig.canvas,
    hunterFloorMaskScratch: maskRig.canvas,
    fullbright: false,
    hunterFloorQueue: opts.entries ?? [mkEntry()],
    _hunterFloorEmitGL: null as unknown,
    _hunterFloorEmitFailed: false,
    _hunterFloorSlot: 0,
    _hunterFloorTex: new Map(),
    gladdQuadEmit: (_gl: unknown, tex: unknown, vd: Float32Array, additive: boolean, smooth: boolean) => {
      quadCalls.push({ tex, vd, additive, smooth });
      return true;
    },
  };
  const run = (lrx = 50, lry = 38) => {
    (Renderer.prototype as unknown as {
      applyHunterTintFloor: (
        c: unknown, vw: number, vh: number,
        lr: Uint8Array, lg: Uint8Array, lb: Uint8Array,
        x: number, y: number, w: number, h: number,
      ) => void;
    }).applyHunterTintFloor.call(
      fake as unknown as Renderer, cam, 1512, 862,
      light.r, light.g, light.b, lrx, lry, 1, 1,
    );
  };
  const armGL = (fail = false) => {
    fake._hunterFloorEmitGL = {
      texFromImage: (key: string, img: unknown) => {
        texCalls.push({ key, img, refresh: false });
        return fail ? null : { fake: 'tex', key };
      },
      texRefresh: (key: string, img: unknown) => {
        texCalls.push({ key, img, refresh: true });
        return fail ? null : { fake: 'tex', key };
      },
    };
  };
  // 世界→屏公式同算子（cam=(800,600),z=1,1512×862:ox=756−800=−44,oy=431−600=−169;
  // 默认条目 dest 角(788,580)-(828,636) → 屏 (744,411)-(784,467)）
  const bboxOf = (it: Entry): [number, number, number, number] => {
    const m = it.mirror ? -it.scale : it.scale;
    const cos = Math.cos(it.rot), sin = Math.sin(it.rot);
    const lx0 = -it.sw / 2, lx1 = it.sw / 2, ly0 = it.by, ly1 = it.by + it.sh;
    let wx0 = Infinity, wy0 = Infinity, wx1 = -Infinity, wy1 = -Infinity;
    for (const [px, py] of [[lx0, ly0], [lx1, ly0], [lx0, ly1], [lx1, ly1]] as const) {
      const wxp = it.cx + px * m * cos - py * it.scale * sin;
      const wyp = it.cy + px * m * sin + py * it.scale * cos;
      wx0 = Math.min(wx0, wxp); wx1 = Math.max(wx1, wxp);
      wy0 = Math.min(wy0, wyp); wy1 = Math.max(wy1, wyp);
    }
    const ox = 756 - 800, oy = 431 - 600;
    return [Math.max(0, Math.floor(wx0 + ox)), Math.max(0, Math.floor(wy0 + oy)),
      Math.min(1512, Math.ceil(wx1 + ox)), Math.min(862, Math.ceil(wy1 + oy))];
  };
  return { fake, main, scratchRig, maskRig, run, armGL, quadCalls, texCalls, cam, bboxOf };
}

describe('★BJ756 applyHunterTintFloor 逐通道钳底剪影', () => {
  it('T1 暗场全黑:敌对钳底 rgb(255,50,50)/友好 rgb(50,255,50)/ichor rgb(255,255,50)'
    + '+ BJ481 三步烘焙形态（掩膜快照单 op+destination-in 单恢复+lighter 单 blit）', () => {
    const f = makeFixture({ light: [0, 0, 0] });
    f.run();
    const fill = f.scratchRig.ops.find((o) => o.op === 'fill')!;
    expect(fill.gco).toBe('rgb(255,50,50)');   // fillStyle 借 gco 槽（rig 约定）
    // 三步形态:本体 draw 恰一次 → mask 快照恰一次（source-over,源=scratch,2 参）→
    // multiply fill 恰一次 → destination-in 恰一次（源=mask）
    const bodyDraw = f.scratchRig.ops.filter((o) => o.op === 'draw' && o.gco === 'source-over');
    expect(bodyDraw).toHaveLength(1);
    const mDraw = f.maskRig.ops.filter((o) => o.op === 'draw');
    expect(mDraw).toHaveLength(1);
    expect(mDraw[0]!.gco).toBe('source-over');
    expect(mDraw[0]!.src).toBe(f.scratchRig.canvas);
    expect(mDraw[0]!.args).toEqual([0, 0]);
    const dstIn = f.scratchRig.ops.find((o) => o.op === 'draw' && o.gco === 'destination-in');
    expect(dstIn, 'destination-in 恰一次').toBeTruthy();
    expect(dstIn!.src).toBe(f.maskRig.canvas);
    // 落画布:恰一次 lighter blit @identity @bbox 原点
    const blits = f.main.ops.filter((o) => o.op === 'draw');
    expect(blits).toHaveLength(1);
    expect(blits[0]!.gco).toBe('lighter');
    expect(blits[0]!.src).toBe(f.scratchRig.canvas);
    const [bx0, by0] = f.bboxOf(mkEntry());
    expect(blits[0]!.args).toEqual([bx0, by0]);
    expect(f.scratchRig.canvas.width).toBe(40);
    expect(f.scratchRig.canvas.height).toBe(56);
    // 友好族绿钳底（NPC.cs:92235-92239）
    const f2 = makeFixture({ light: [0, 0, 0], entries: [mkEntry({ floor: [50, 255, 50] })] });
    f2.run();
    expect(f2.scratchRig.ops.find((o) => o.op === 'fill')!.gco).toBe('rgb(50,255,50)');
    // ichor 整色替换先于钳底（:92226-92229+92247-92258:G=max(255,50)=255,B=max(0,50)=50）
    const f3 = makeFixture({ light: [0, 0, 0], entries: [mkEntry({ tint: [255, 255, 0], ichor: true })] });
    f3.run();
    expect(f3.scratchRig.ops.find((o) => o.op === 'fill')!.gco).toBe('rgb(255,255,50)');
  });

  it('T2 部分光逐通道差值（light=(100,200,50) → rgb(155,0,0),负差钳 0）+ tint 乘区', () => {
    const f = makeFixture({ light: [100, 200, 50] });
    f.run();
    // dr=255−100=155;dg=max(0,50−200)=0;db=max(0,50−50)=0
    expect(f.scratchRig.ops.find((o) => o.op === 'fill')!.gco).toBe('rgb(155,0,0)');
    // poison R×0.65（tint=[165,255,255]）×light=(200,180,160):
    // dr=max(0,255−200×165/255)=126;dg/db=0
    const f2 = makeFixture({ light: [200, 180, 160], entries: [mkEntry({ tint: [165, 255, 255] })] });
    f2.run();
    expect(f2.scratchRig.ops.find((o) => o.op === 'fill')!.gco).toBe('rgb(126,0,0)');
  });

  it('T3 「乘光前调制=红」回归锁（BJ739 近似层病灶复现锁）:全亮+tint 暗化 debuff'
    + ' → 差值非零（钳底不被乘光抹掉）;全亮+无 tint → 零差值零开销整跳', () => {
    // 全亮 + poison（R×0.65）:vanilla npcColor.R=255×0.65=165 < 255 → 钳回 255
    // → 差值 90（近似层病灶=乘光前调制被 255 光抹平;真面在合成后补差,恒存）
    const f = makeFixture({ light: [255, 255, 255], entries: [mkEntry({ tint: [165, 255, 255] })] });
    f.run();
    expect(f.scratchRig.ops.find((o) => o.op === 'fill')!.gco).toBe('rgb(90,0,0)');
    // 全亮+无 tint:floor(255,50,50) 全被 255 光盖过 → 零差值,零画布 op（零开销门）
    const f2 = makeFixture({ light: [255, 255, 255] });
    f2.run();
    expect(f2.scratchRig.ops).toEqual([]);
    expect(f2.maskRig.ops).toEqual([]);
    expect(f2.main.ops.filter((o) => o.op === 'draw')).toEqual([]);
    // fullbright 门:开灯模式整 pass 跳过（⑦ 同门）
    const f3 = makeFixture({ light: [0, 0, 0] });
    (f3.fake as unknown as { fullbright: boolean }).fullbright = true;
    f3.run();
    expect(f3.main.ops).toEqual([]);
    expect(f3.scratchRig.ops).toEqual([]);
  });

  it('T4 mask 对位锁:本体重绘变换与捕获 spec 同参（translate/rotate/scale(±)/dest/ga）'
    + '+ 世界→scratch 变换式（含镜像 rot 的 bbox）', () => {
    const e = mkEntry({ rot: 0.5, mirror: true, scale: 2, by: -30, ga: 0.75, sw: 44, sh: 60 });
    const f = makeFixture({ entries: [e] });
    f.run();
    const s = f.scratchRig.ops;
    // 世界→scratch setTransform:z=1,(756−bx0−800, 431−by0−600)
    const [bx0, by0, bx1, by1] = f.bboxOf(e);
    const xf = s.find((o) => o.op === 'xf')!;
    expect(xf.args).toEqual([1, 0, 0, 1, 756 - bx0 - 800, 431 - by0 - 600]);
    // 本体重放:translate(cx,cy)→rotate(rot)→scale(−s,s)(镜像)→drawImage(源矩形+dest)
    expect(s.find((o) => o.op === 'translate')!.args).toEqual([e.cx, e.cy]);
    expect(s.find((o) => o.op === 'rotate')!.args).toEqual([e.rot]);
    expect(s.find((o) => o.op === 'scale')!.args).toEqual([-e.scale, e.scale]);
    const bodyDraw = s.find((o) => o.op === 'draw' && o.gco === 'source-over')!;
    expect(bodyDraw.src).toBe(e.img);
    expect(bodyDraw.args).toEqual([e.sx, e.sy, e.sw, e.sh, -e.sw / 2, e.by, e.sw, e.sh]);
    expect(bodyDraw.ga).toBe(e.ga);
    // 镜像+旋转的保守 bbox:四角变换后屏区原点=blit 位（对位=剪影与本体同像素域）
    const blit = f.main.ops.find((o) => o.op === 'draw')!;
    expect(blit.args).toEqual([bx0, by0]);
    expect(f.scratchRig.canvas.width).toBe(bx1 - bx0);
    expect(f.scratchRig.canvas.height).toBe(by1 - by0);
  });

  it('T5 GL sink 分支:texFromImage 上传+quad vCol=(1,1,1,0) 加性合批,无 2D blit;'
    + '队列不排空（2D 重放同源）;上传失败=失败旗', () => {
    const f = makeFixture({ entries: [mkEntry(), mkEntry({ cx: 808, cy: 640, by: -20 })] });
    f.armGL();
    f.run();
    // 每实体一次 texFromImage（slot 键递增）+ 一次 quad;主画布零 blit
    expect(f.texCalls).toHaveLength(2);
    expect(f.texCalls[0]!.key).toBe('hfloor:slot0');
    expect(f.texCalls[1]!.key).toBe('hfloor:slot1');
    expect(f.texCalls[0]!.img).toBe(f.scratchRig.canvas);
    expect(f.quadCalls).toHaveLength(2);
    expect(f.quadCalls[0]!.additive).toBe(true);
    expect(f.quadCalls[0]!.smooth).toBe(false);
    // vCol=(1,1,1,0):顶点 4-7 槽（差值色已烘进画布,加性不衰减 dst）
    const vd = f.quadCalls[0]!.vd;
    expect(vd[4]).toBe(1); expect(vd[5]).toBe(1); expect(vd[6]).toBe(1); expect(vd[7]).toBe(0);
    expect(vd[12]).toBe(1); expect(vd[15]).toBe(0);
    expect(f.main.ops.filter((o) => o.op === 'draw')).toEqual([]);
    // 队列不排空（flush 无自清=GL 失败 2D 原样重放）
    expect((f.fake as unknown as { hunterFloorQueue: unknown[] }).hunterFloorQueue).toHaveLength(2);
    // 上传失败 → _hunterFloorEmitFailed 置位（驱动器弃 FBO 回 2D 的信号）
    const f2 = makeFixture();
    f2.armGL(true);
    f2.run();
    expect((f2.fake as unknown as { _hunterFloorEmitFailed: boolean })._hunterFloorEmitFailed).toBe(true);
    expect(f2.main.ops.filter((o) => o.op === 'draw')).toEqual([]);
  });

  it('T6 多实体循环完整性:逐实体 continue（⑦月总 return 截断病的反向锁——两实体两 blit）', () => {
    const f = makeFixture({ entries: [mkEntry(), mkEntry({ cx: 808, cy: 640, by: -20, tint: [255, 255, 255] })] });
    f.run();
    expect(f.main.ops.filter((o) => o.op === 'draw')).toHaveLength(2);
    expect(f.maskRig.ops.filter((o) => o.op === 'draw')).toHaveLength(2);
    expect(f.scratchRig.ops.filter((o) => o.op === 'draw' && o.gco === 'destination-in')).toHaveLength(2);
    // GL 态同锁（continue 语义:M3 变异 return → 第二实体不发射）
    const f2 = makeFixture({ entries: [mkEntry(), mkEntry({ cx: 808, cy: 640, by: -20 })] });
    f2.armGL();
    f2.run();
    expect(f2.texCalls).toHaveLength(2);
    expect(f2.quadCalls).toHaveLength(2);
  });
});

// ===================== 谓词单源（B12 近似层语义收编+城镇族判绿勘误） =====================

describe('★BJ756 hunterPotionAppearsFriendly 单源（NPC.cs:92126-92135）', () => {
  it('689 覆写强制敌对（HunterPotionFriendlyOverride,NPCID.cs:4462）', () => {
    expect(Renderer.hunterPotionAppearsFriendly(
      { vanillaId: 689, maxHp: 5, def: { friendly: true, damage: 0 } })).toBe(false);
  });
  it('def.friendly / catchItem(vanilla 46 兔) / (damage==0&&lifeMax==5) 三臂判绿', () => {
    expect(Renderer.hunterPotionAppearsFriendly(
      { vanillaId: -1, maxHp: 250, def: { friendly: true, damage: 10 } })).toBe(true);
    expect(Renderer.hunterPotionAppearsFriendly(
      { vanillaId: 46, maxHp: 5, def: { friendly: false, damage: 0 } })).toBe(true);
    expect(Renderer.hunterPotionAppearsFriendly(
      { vanillaId: -1, maxHp: 5, def: { friendly: false, damage: 0 } })).toBe(true);
  });
  it('普通敌怪判红;lifeMax≠5 的零伤不判绿', () => {
    expect(Renderer.hunterPotionAppearsFriendly(
      { vanillaId: -1, maxHp: 250, def: { friendly: false, damage: 20 } })).toBe(false);
    expect(Renderer.hunterPotionAppearsFriendly(
      { vanillaId: -1, maxHp: 10, def: { friendly: false, damage: 0 } })).toBe(false);
  });
  it('城镇 NPC 判绿（vanilla NPC.friendly 恒 true;B12 近似层 def 缺字段恒红=勘误翻案）', () => {
    const guide = new TownNPC('guide', 40 * 16, 40 * 16);
    expect(Renderer.hunterPotionAppearsFriendly(guide)).toBe(true);
  });
});

// ===================== 结构锁 =====================

describe('★BJ756 结构锁', () => {
  it("S1 合成后位序:7b'' 注释与 applyHunterTintFloor 调用均在 compositeLight 之后", () => {
    const iComp = rendererSrc.indexOf('this.compositeLight(');
    const i7b2 = rendererSrc.indexOf("7b''. ★BJ756");
    const iCall = rendererSrc.indexOf('this.applyHunterTintFloor(cam, viewW, viewH,');
    const i7a = rendererSrc.indexOf("// 7a'. 晨昏镜头光斑");
    expect(iComp).toBeGreaterThan(-1);
    expect(i7b2).toBeGreaterThan(-1);
    expect(iCall).toBeGreaterThan(-1);
    expect(i7a).toBeGreaterThan(-1);
    expect(iComp, '剪影 pass 必须在光照合成之后（BJ739 乘光前调制病灶的根治位）').toBeLessThan(i7b2);
    expect(i7b2).toBeLessThan(iCall);
    expect(iCall).toBeLessThan(i7a);
  });
  it('S2 B12 红绿框近似层退役（框字面量绝迹）+ 收集排除族在位', () => {
    expect(rendererSrc).not.toContain("ctx.strokeStyle = friendly ? '#32FF32' : '#FF3232';");
    expect(rendererSrc).toContain('e.vanillaId !== 516 && e.vanillaId !== 289');
    expect(rendererSrc).toContain('&& !this.isBehindTilesEnemy(e)) {');
  });
  it('S3 钳底色字面量与差值式（NPC.cs:92235-92246/92247-92258）', () => {
    expect(rendererSrc).toContain(
      'floor: Renderer.hunterPotionAppearsFriendly(e) ? [50, 255, 50] : [255, 50, 50],');
    expect(rendererSrc).toContain('Math.max(0, Math.round(it.floor[0] - lr * tR))');
    expect(rendererSrc).toContain('floor: Renderer.hunterPotionAppearsFriendly(n) ? [50, 255, 50] : [255, 50, 50],');
  });
});

// ===================== 变异恰红 =====================

describe('BJ756 变异恰红 render 面', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj756a-hunter-tint-floor.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_BJ756A_MUT: '1' },
    },
  );
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `BJ756-A render ${filter}` });
  };
  const RENDERER = join(process.cwd(), 'src', 'render', 'Renderer.ts');

  it('M1 摘中心格光采样（恒全亮读）→ T1 暗场钉值红（暗场差值归零=零烘焙）', () => {
    mutate(RENDERER,
      '      const tx = Math.floor(it.cx / TILE), ty = Math.floor(it.cy / TILE);\n'
      + '      if (tx >= lrx && ty >= lry && tx < lrx + lrw && ty < lry + lrh) {\n'
      + '        const li = (ty - lry) * lrw + (tx - lrx);\n'
      + '        lr = lightR[li]; lg = lightG[li]; lb = lightB[li];\n'
      + '      }',
      '      const tx = Math.floor(it.cx / TILE), ty = Math.floor(it.cy / TILE);\n'
      + '      if (tx >= lrx && ty >= lry && tx < lrx + lrw && ty < lry + lrh) {\n'
      + '        const li = (ty - lry) * lrw + (tx - lrx);\n'
      + '        lr = 255; lg = 255; lb = 255; /* BJ756A-M1 变异 */\n'
      + '      }',
      '暗场全黑');
  });

  it('M2 差值式丢 tint 乘区（floor−light 裸减）→ T3 全亮 tint 恰红锁红', () => {
    mutate(RENDERER,
      'const dr = it.ichor && it.tint\n'
      + '        ? Math.max(0, Math.round(Math.max(it.tint[0], it.floor[0]) - lr * tR))\n'
      + '        : Math.max(0, Math.round(it.floor[0] - lr * tR));',
      'const dr = Math.max(0, Math.round(it.floor[0] - lr)); /* BJ756A-M2 变异 */',
      '乘光前调制');
  });

  it('M3 GL 分支 continue→return（⑦月总截断病克隆）→ T6 多实体 GL 锁红', () => {
    mutate(RENDERER,
      '        const ok = this.gladdQuadEmit(glEmit, e, vd, true, false);   // 加性合批（整数位 NEAREST）\n'
      + '        if (!ok) { this._hunterFloorEmitFailed = true; return; }\n'
      + '        continue;',
      '        const ok = this.gladdQuadEmit(glEmit, e, vd, true, false);   // 加性合批（整数位 NEAREST）\n'
      + '        if (!ok) { this._hunterFloorEmitFailed = true; return; }\n'
      + '        return; /* BJ756A-M3 变异 */',
      '多实体循环完整性');
  });

  it('M4 2D blit gCO lighter→source-over → T1 落画布锁红', () => {
    mutate(RENDERER,
      "ctx.drawImage(scratch, bx0, by0);                        // 加性补差（BJ756）",
      "ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(scratch, bx0, by0); /* BJ756A-M4 变异 */",
      '暗场全黑');
  });
});
