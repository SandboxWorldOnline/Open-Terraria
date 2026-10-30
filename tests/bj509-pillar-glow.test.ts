// ★BJ509 2026-10-04（用户实报"原版四柱有自发光,本仓四柱在晚上好像很暗"）
//
// 定谳（Terarria1457 亲读；判谳链见测试段内锚）：
//   · 【照明面=零】四柱（517 日耀/422 星旋/507 星云/493 星尘,aiStyle 94）在原版
//     **没有任何 Lighting.AddLight**——全反编译源码逐文件扫描（所有 AddLight 调用行
//     ±25 行邻域含 517/422/507/493 任一 token = 零命中）;AI_094（NPC.cs:39356-39771）
//     无 AddLight;GetAlpha（NPC.cs:94549-94829）无四柱分支;UpdateNPC_CastLights
//     （NPC.cs:93478-93555）只有城镇 NPC 灯光。四柱不往光照贴图注入任何光。
//   · 【自发光=绘制面】Main.cs DrawNPCDirect 四柱 case（:24470-24550）：
//     本体 = GetAlpha(npcColor)（光照色,夜里暗,与普通 NPC 同面）;残影 = GlowMask
//     132（493 星尘）/[143]（507 星云）/[149]（422 星旋）/[162]（517 日耀）各 4 份
//     （velocity.RotatedBy(k·π/2)×num 偏移）,顶点色 = **Color(64,64,64,0)×Opacity
//     恒定不经 GetAlpha = 不吃光照**（XNA AlphaBlend 预乘链 α=0 → 纯加法 64/255 白,
//     参照 xna-alpha0-additive-idiom 判例）——夜里恒亮=塔身自发光观感主体。
//     num = base + |GetAlpha(npcColor)−(0.5,0.5,0.5)|·mult（493/422/507=4+|·|·4,
//     517=2+|·|·9 :24509/:24486）;517 另有恒定 +Vector2.UnitX×2（:24518）。
//     塔悬停速度 vy=sin(2π·ai0/300)×0.5（AI_094 :39519）→ 呼吸半径 ≈0.5×(4+0.866×4)
//     ≈3.7px——无独立脉动周期表,动态=悬停摆×光照项。
//   · 【差异=合成管线】原版光照逐 sprite 乘顶点色（残影不吃光=恒亮）;本仓
//     compositeLight 在世界层之上全屏乘光 → 旧实现残影画进实体层被按塔位光压暗
//     （塔位夜光≈0.1-0.3 → 0.25×0.2≈0.05 不可见=用户实报"晚上很暗"）。
//   · 【落刀】残影挪 7d''' 光照合成后消费（7d' 677/668/583 同域判例;BJ109-H 三修
//     参数面 1:1 保留,收编 npcGlowVel4Num/npcGlowVel4Offsets 纯函数单源）。
//     尘光照面（127[1.3,0.585,0.26]/135[0.75,0.85,1.4]/229[0.3,0.65,0.7]/
//     242[1,0,1] SMOKE_LIGHT 全档,原版 Dust.cs 光链档位 1:1）与塔盾 ForceField
//     （BJ109-G）不属本刀,已各有其面。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Enemy } from '../src/entities/Enemy';

const rendererSrc = () => readFileSync(new URL('../src/render/Renderer.ts', import.meta.url), 'utf8');
const enemySrc = () => readFileSync(new URL('../src/entities/Enemy.ts', import.meta.url), 'utf8');

/** 区块抽取：从 startMark 行起至 endMark 行前（含两端标记行） */
function block(src: string, startMark: string, endMark: string): string {
  const lines = src.split('\n');
  const s = lines.findIndex((l) => l.includes(startMark));
  const e = lines.findIndex((l, i) => i > s && l.includes(endMark));
  expect(s, `startMark 未命中: ${startMark}`).toBeGreaterThanOrEqual(0);
  expect(e, `endMark 未命中: ${endMark}`).toBeGreaterThan(s);
  return lines.slice(s, e).join('\n');
}

// ===================== 测试具装 =====================
function recorder() {
  const ops: Array<Record<string, unknown>> = [];
  let alpha = 1;
  let comp = 'source-over';
  const ctx = {
    save: () => ops.push({ op: 'save' }),
    restore: () => ops.push({ op: 'restore' }),
    translate: (x: number, y: number) => ops.push({ op: 'translate', x, y }),
    rotate: (r: number) => ops.push({ op: 'rotate', r }),
    scale: (x: number, y: number) => ops.push({ op: 'scale', x, y }),
    drawImage: (img: unknown, sx: number, sy: number, sw: number, sh: number,
      dx: number, dy: number) => ops.push({ op: 'draw', img, sx, sy, sw, sh, dx, dy, alpha }),
  };
  Object.defineProperty(ctx, 'globalAlpha', {
    set(v: number) { alpha = v; ops.push({ op: 'alpha', v }); },
    get() { return alpha; },
  });
  Object.defineProperty(ctx, 'globalCompositeOperation', {
    set(v: string) { comp = v; ops.push({ op: 'composite', v }); },
    get() { return comp; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const atlasStub = {
  ensureVImage: (_k: string) => ({ width: 174, height: 364 }),
} as never;

/** drawNpcGlow 的 this 假体（私有方法 prototype.call;塔无旋转无镜像主路径） */
function fakeThis(rec: { ctx: CanvasRenderingContext2D },
  light: readonly [number, number, number] | null = [0, 0, 0]) {
  return {
    atlas: atlasStub,
    ctx: rec.ctx,
    lighting: { lightAt: () => light },
    towerGlowQueue: [] as Array<Record<string, unknown>>,
  } as unknown as {
    atlas: typeof atlasStub; ctx: CanvasRenderingContext2D;
    lighting: { lightAt: (x: number, y: number) => readonly [number, number, number] | null };
    towerGlowQueue: Array<Record<string, unknown>>;
  };
}

/** 塔实体假体（drawNpcGlow 消费面字段最小集） */
function towerFake(vid: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    vanillaId: vid, vx: 0, vy: 0.5, visAngle: 0, spawnAlpha: 0,
    vanilla: { frames: 1, scale: 1 }, vanillaScale: 1,
    cx: 1000, cy: 2000, master: null,
    ...over,
  } as unknown as Enemy;
}

const FRAME = { sx: 0, sy: 0, sw: 174, sh: 364 };
async function glowFn() {
  const { Renderer } = await import('../src/render/Renderer');
  return (Renderer.prototype as unknown as {
    drawNpcGlow: (e: Enemy, r: typeof FRAME, bx: number, by: number, mirror?: boolean) => void;
  }).drawNpcGlow;
}
function draws(ops: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return ops.filter((o) => o.op === 'draw');
}

// ===================== A. 照明面定谳锚（四柱零 AddLight） =====================
describe('BJ509-A 四柱照明面定谳锁（原版零 AddLight——本仓同相）', () => {
  it('towerAI 全块无 addLightAt（四柱 AI 不注入光照=与原版 AI_094 零 AddLight 同相）', () => {
    const fn = block(enemySrc(), 'private towerAI(', 'private towerRotSpread(');
    expect(fn).not.toContain('addLightAt');
    expect(fn).not.toContain('AddLight');
  });
  it('Enemy.ts 照明 API 在而非四柱用（反向对照：2938 翅膀 28/12595 696 专用微光）', () => {
    const src = enemySrc();
    expect(src).toContain('game.addLightAt?.(this.cx, this.cy, 0.28, 0.56, 0.7)');
    expect(src).toContain('game.addLightAt?.(this.cx, this.cy, 0.5, 0.3, 0.1)');
  });
  it('NPC_GLOW 表四柱成员钉值（GlowMask 132/143/149/162,mode vel4）', { timeout: 60000 }, async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const G = (Renderer as unknown as { NPC_GLOW: Record<number, { tex: string; mode: string }> }).NPC_GLOW;
    expect(G[493]).toMatchObject({ tex: 'vanilla/Glow_132.png', mode: 'vel4' });   // 星尘
    expect(G[507]).toMatchObject({ tex: 'vanilla/Glow_143.png', mode: 'vel4' });   // 星云
    expect(G[422]).toMatchObject({ tex: 'vanilla/Glow_149.png', mode: 'vel4' });   // 星旋
    expect(G[517]).toMatchObject({ tex: 'vanilla/Glow_162.png', mode: 'vel4' });   // 日耀
  });
});

// ===================== B. npcGlowVel4Num 纯函数钉值（Main.cs:24509/:24486） =====================
describe('BJ509-B 残影半径 num 纯函数（base+|GetAlpha−0.5|·mult）', () => {
  it('base/mult 分塔钉值：493/422/507=4+|·|·4,517=2+|·|·9', { timeout: 60000 }, async () => {
    const { Renderer } = await import('../src/render/Renderer');
    const N = (Renderer as unknown as { npcGlowVel4Num: (vid: number, l: readonly number[] | null) => number }).npcGlowVel4Num;
    const black = Math.sqrt(3 * 0.25);   // 黑/白光档 length 恒 √0.75≈0.86603
    expect(N(493, [0, 0, 0])).toBeCloseTo(4 + black * 4, 6);
    expect(N(422, [0, 0, 0])).toBeCloseTo(4 + black * 4, 6);
    expect(N(507, [0, 0, 0])).toBeCloseTo(4 + black * 4, 6);
    expect(N(517, [0, 0, 0])).toBeCloseTo(2 + black * 9, 6);
    // 满光同 length（(1-0.5)²×3 同式）
    expect(N(493, [255, 255, 255])).toBeCloseTo(4 + black * 4, 6);
    // 偏色档连续域：[128,0,0] → dr=128/255−0.5,dg=db=−0.5
    const dr = 128 / 255 - 0.5;
    expect(N(493, [128, 0, 0])).toBeCloseTo(4 + Math.sqrt(dr * dr + 0.5) * 4, 6);
    // 光照未就绪 → base
    expect(N(493, null)).toBe(4);
    expect(N(517, null)).toBe(2);
  });
});

// ===================== C. vel4 收集行为（塔→队列,不再原位画） =====================
describe('BJ509-C vel4 收集面（塔残影入 towerGlowQueue）', () => {
  it('塔 517 调 drawNpcGlow → 收集 1 条,字段钉值,无原位 draw', { timeout: 60000 }, async () => {
    const drawNpcGlow = await glowFn();
    const rec = recorder();
    const self = fakeThis(rec, [0, 0, 0]);
    drawNpcGlow.call(self, towerFake(517), FRAME, -87, -182, false);
    expect(self.towerGlowQueue.length).toBe(1);
    const q = self.towerGlowQueue[0];
    expect(q.vid).toBe(517);
    expect(q.tex).toBe('vanilla/Glow_162.png');
    expect(q.iw).toBe(174);           // img.width（贴图源宽）
    expect(q.sy).toBe(0);             // 帧行（塔 frames=1）
    expect(q.gh).toBe(364);           // img.height/frames
    expect(q.sw).toBe(174);           // NPC 帧宽（绘制目标尺寸）
    expect(q.sh).toBe(364);
    // 世界帧左上 = 盒心 + bx·scale（bx=−sw/2 → wx=cx−sw·scale/2）
    expect(q.wx).toBe(1000 - 87);
    expect(q.wy).toBe(2000 - 182);
    expect(q.vx).toBe(0);
    expect(q.vy).toBe(0.5);           // 悬停摆透传（呼吸驱动）
    expect(q.num).toBeCloseTo(2 + Math.sqrt(3 * 0.25) * 9, 6);   // 517 黑光档
    expect(q.xoff).toBe(2);           // 517 +UnitX×2
    expect(q.opacity).toBe(1);        // spawnAlpha=0 → Opacity=1
    // 残影不原位画（收集分支 0 draw;save/composite 头除外）
    expect(draws(rec.ops).length).toBe(0);
  });
  it('非 517 塔 xoff=0,num=4+|·|·4 档（493 主路径）', { timeout: 60000 }, async () => {
    const drawNpcGlow = await glowFn();
    const rec = recorder();
    const self = fakeThis(rec, [0, 0, 0]);
    drawNpcGlow.call(self, towerFake(493), FRAME, -87, -182, false);
    expect(self.towerGlowQueue.length).toBe(1);
    const q = self.towerGlowQueue[0];
    expect(q.vid).toBe(493);
    expect(q.tex).toBe('vanilla/Glow_132.png');
    expect(q.num).toBeCloseTo(4 + Math.sqrt(3 * 0.25) * 4, 6);
    expect(q.xoff).toBe(0);
    expect(draws(rec.ops).length).toBe(0);
  });
  it('num 动态=随塔位光照变化（lightAt 偏色档→num 收窄=原版光照项同相）', async () => {
    const drawNpcGlow = await glowFn();
    const rec = recorder();
    const self = fakeThis(rec, [128, 0, 0]);
    drawNpcGlow.call(self, towerFake(493), FRAME, -87, -182, false);
    const dr = 128 / 255 - 0.5;
    expect(self.towerGlowQueue[0].num).toBeCloseTo(4 + Math.sqrt(dr * dr + 0.5) * 4, 6);
  });
  it('呼吸动态形态=悬停摆透传（塔 vy=±0.5 → 偏移幅 0.5×num≈3.7px 呼吸,无独立脉动周期表）', async () => {
    const drawNpcGlow = await glowFn();
    for (const vy of [-0.5, 0.5]) {
      const rec = recorder();
      const self = fakeThis(rec, [0, 0, 0]);
      drawNpcGlow.call(self, towerFake(422, { vy }), FRAME, -87, -182, false);
      expect(self.towerGlowQueue[0].vy).toBe(vy);
      expect(self.towerGlowQueue.length).toBe(1);
    }
  });
  it('守卫：带旋转（visAngle≠0）或镜像（mirror=true）→ 回退原位画 4 份,不收集', async () => {
    const drawNpcGlow = await glowFn();
    // visAngle≠0
    {
      const rec = recorder();
      const self = fakeThis(rec, [0, 0, 0]);
      drawNpcGlow.call(self, towerFake(517, { visAngle: 0.3 }), FRAME, -87, -182, false);
      expect(self.towerGlowQueue.length).toBe(0);
      expect(draws(rec.ops).length).toBe(4);   // 原位 4 份（保底分支）
    }
    // mirror=true
    {
      const rec = recorder();
      const self = fakeThis(rec, [0, 0, 0]);
      drawNpcGlow.call(self, towerFake(517), FRAME, -87, -182, true);
      expect(self.towerGlowQueue.length).toBe(0);
      expect(draws(rec.ops).length).toBe(4);
    }
  });
  it('残影 alpha=64/255×Opacity（Color(64,64,64,0) 纯加法语义,不吃光照）', async () => {
    const drawNpcGlow = await glowFn();
    const rec = recorder();
    const self = fakeThis(rec, [0, 0, 0]);
    // opacity=1（spawnAlpha=0）——vel4 分支头设置的 alpha（收集分支也先设）
    drawNpcGlow.call(self, towerFake(493), FRAME, -87, -182, false);
    const alphas = rec.ops.filter((o) => o.op === 'alpha').map((o) => o.v as number);
    expect(alphas).toContain(64 / 255);
  });
});

// ===================== D. 非四柱照明面不回归 =====================
describe('BJ509-D 非四柱 GlowMask 面不回归（收集仅 vel4 分支）', () => {
  it('frame4 模式（415 龙马）仍原位画中心+4 向,queue 恒空', async () => {
    const drawNpcGlow = await glowFn();
    const rec = recorder();
    const self = fakeThis(rec, [0, 0, 0]);
    // 415: mode frame4, a:'255a', velMult 0.5 → 中心 1 + 4 向 = 5 draw
    drawNpcGlow.call(self, towerFake(415, { vx: 1.2, vy: 0 }), FRAME, -87, -182, false);
    expect(self.towerGlowQueue.length).toBe(0);
    expect(draws(rec.ops).length).toBe(5);
  });
  it('frame 模式（551 Betsy）仍原位画,queue 恒空', async () => {
    const drawNpcGlow = await glowFn();
    const rec = recorder();
    const self = fakeThis(rec, [0, 0, 0]);
    drawNpcGlow.call(self, towerFake(551), FRAME, -87, -182, false);
    expect(self.towerGlowQueue.length).toBe(0);
    expect(draws(rec.ops).length).toBe(1);
  });
  it('trail 模式（419 火月怪）仍原位画本体罩+四向,queue 恒空', async () => {
    const drawNpcGlow = await glowFn();
    const rec = recorder();
    const self = fakeThis(rec, [0, 0, 0]);
    drawNpcGlow.call(self, towerFake(419, { ai2: 0 }), FRAME, -87, -182, false);
    expect(self.towerGlowQueue.length).toBe(0);
    // 本体罩 1 + ai2>=-6 分支 4 向 = 5
    expect(draws(rec.ops).length).toBe(5);
  });
});

// ===================== E. 消费面结构锁（7d''' 光照合成后） =====================
describe("BJ509-E 7d''' 消费面结构锁（光照合成后 lighter 重放）", () => {
  it("7d''' 块在 compositeLight 之后主画布消费队列（npcGlowVel4Offsets 单源+64/255 α;★BJ-C1 F4 方法化 flushTowerGlow 重锚）", () => {
    const src = rendererSrc();
    // ★⑫-b 拆分(2026-10-28)后 flushTrailShade→flushTrailStrips/flushProjFullbright:
    //  块终界锚改用 flushTrailStrips(同区下一 private 方法,span 语义不变)
    const consumer = block(src, 'private flushTowerGlow(', 'private flushTrailStrips(');
    expect(consumer).toContain('this.towerGlowQueue.length');
    expect(consumer).toContain("ctx.globalCompositeOperation = 'lighter'");
    expect(consumer).toContain('Renderer.npcGlowVel4Offsets(q.vx, q.vy, q.num, q.xoff)');
    // ★BJ510：α 调度扩 noOpac 位（516 恒定色不乘 Opacity;塔走 q.opacity 原式）
    expect(consumer).toContain('(64 / 255) * (q.noOpac ? 1 : q.opacity)');
    // 相机变换同 7d'（round 吸附式）
    expect(consumer).toContain('Math.round(cam.x * z) / z');
    // tex 存名（零跨拍 img 持有——wingGlowQueue 同款）
    expect(consumer).toContain('ensureVImage(q.tex)');
    // ★BJ-C1 F4：render 内调用位保持（同序位零行为差）
    expect(src).toContain('this.flushTowerGlow(cam, z, viewW, viewH);');
  });
  it('帧头清队列（逐帧重建,收集/消费跨帧零残留）', () => {
    const src = rendererSrc();
    expect(src).toContain('this.towerGlowQueue.length = 0;   // ★BJ509 四塔 GlowMask 残影队列逐帧重建');
  });
  it('vel4 收集分支调用点带 mirror 位（drawNpcGlow 第 5 参）', () => {
    const src = rendererSrc();
    expect(src).toContain('this.drawNpcGlow(e, r, -r.sw / 2, anchorY, gMirror)');
  });
});
