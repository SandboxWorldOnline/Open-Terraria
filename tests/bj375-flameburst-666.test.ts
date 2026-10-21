// ★BJ375 爆炸烈焰塔弹 664/666/668（aiStyle 131）三面判别（2026-09-28）：
//   ① 残影旋转缺 π/2 = 用户实报「弯月/钩状缺半贴图」主因——drawProjGhosts 调用
//      bodyRot 传裸 ang（速度角），而本体缺省支 = ang+π/2（AI_001 系 rotation
//      语义 :54877）→ mode0 残影整体落后 π/2：轨迹上散落「未旋转直立彗星」
//      （圆头+下垂尾焰=弯月/钩状观感）。修 = bodyRot 传 ang+π/2（409 自旋特例
//      保留 spinRot；503/660 独占支不涉；GHOST_PARAMS mode0 族∩特判旋转集=空，
//      BJ375 普查——mode2/3/4 族 rotMul=0 不消费 bodyRot，零改动面）。
//      原版锚：Main.cs:31333-31335（mode0 num177=proj.rotation=当前本体旋转）。
//   ② AI_131 alpha 渐显整缺：SetDefaults alpha=255（Projectile.cs:7155-7163）+
//      AI −25/t 钳 0（:69543-69549）——修 = PROJ_ALPHA0 注入 + 逐 tick 衰减支。
//      消费 = vanillaProjAlpha[664/666/668] lerp 档（k0.5/mul0.7843,:76367）fade 乘子
//      + 残影 bodyAlpha（ghostA=(255−α)/255）。
//   ③ AI_131 尘链整缺：逐拍 attempts=1/2/3（664/666/668 num 档 :69551-69558）,
//      每掷 50% 门（:69557 Next(2)!=0）、尘 6 Fire、尘速=弹速×0.2×0.3、
//      vy+=Sign(dvy)×1.2、fadeIn+=0.5（:69568-69571 Next(1)==0 恒真 quirk 照抄）、
//      noGravity/scale2/α100——修 = subStep 段 BJ375 逐 tick 支。
//      弹首拍音效已在塔生成侧（MinionProj playSfxFiles dd2_flameburst_tower_shot）。
// 判别力：变异敏感（bodyRot 退回 ang → D 红；alpha −25→0 → A 红；attempts 表
//   666→664 → B 红；PROJ_ALPHA0 摘键 → A 红）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TileStore } from '../src/world/TileStore';
import { Arrow, PROJ_ALPHA0 } from '../src/entities/Arrow';
import { GHOST_PARAMS, PROJ_TRAILING_MODE } from '../src/entities/projGhostTrail';
import { PROJ_ALPHA_MOD } from '../src/data/vanillaProjAlpha';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import type { GameHooks } from '../src/entities/types';
import type { VDust } from '../src/fx/VanillaDust';

// ---------------------------------------------------------------- hooks 桩（BJ371 同款）
function mkHooks() {
  const dusts: Array<VDust & { type: number }> = [];
  const store = new TileStore(400, 400);
  const g = {
    world: { store } as never,
    player: { dead: false, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 20, h: 42 } as never,
    enemies: () => [],
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
      sx = 0, sy = 0, alpha = 0, _c = null, scale = 1, noGravity = false) => {
      const d = {
        active: true, x: _x, y: _y, vx: sx, vy: sy, type, scale, alpha,
        noGravity, fadeIn: 0, color: null, rotation: 0, fx: 0, fy: 0,
        followPlayer: false, followOnce: false, dyeVid: -1, noLight: false, noLightEmittance: false,
      } as unknown as VDust & { type: number };
      dusts.push(d);
      return d;
    },
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as unknown as GameHooks;
  return { g, dusts };
}

// ---------------------------------------------------------------- 记录型 ctx（BJ371 同款）
type Call = { m: string; a: unknown[] };
function makeR() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => {
      if (k === 'canvas') return undefined;
      return (...a: unknown[]) => { calls.push({ m: String(k), a }); };
    },
    set: (_t, k, v) => { calls.push({ m: `set:${String(k)}`, a: [v] }); return true; },
  });
  const r = { canvas: { getContext: () => ctx, width: 1280, height: 800 }, ctx, atlas: null };
  return { calls, r: r as never };
}
/** 烘焙画布桩（tintedTex 消费面） */
function stubDocWithRecordingCanvases() {
  const g = globalThis as unknown as Record<string, unknown>;
  const prevDoc = g.document;
  g.document = {
    createElement: (): Record<string, unknown> => {
      const cv: Record<string, unknown> = {
        width: 0, height: 0,
        getContext: (): CanvasRenderingContext2D =>
          new Proxy({} as CanvasRenderingContext2D, {
            get: (_t, k) => ((..._a: unknown[]) => undefined) as never,
            set: (_t, _k, _v) => true,
          }),
      };
      return cv;
    },
  };
  return { restore: () => { g.document = prevDoc; } };
}
const fakeImg = (w: number, h: number) =>
  ({ naturalWidth: w, naturalHeight: h, width: w, height: h, complete: true, src: '' });

describe('BJ375 爆炸烈焰塔弹 664/666/668（AI_131）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[A] SetDefaults α=255 注入 + AI_131 −25/t 钳 0（:7155-7163/:69543-69549）', () => {
    expect(PROJ_ALPHA0[664]).toBe(255);
    expect(PROJ_ALPHA0[666]).toBe(255);
    expect(PROJ_ALPHA0[668]).toBe(255);
    const { g } = mkHooks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 尘掷恒不中——隔离 α 面
    const a = new Arrow(1600, 1600, 15, 0, 40, 2, 666, { grav: 0 });
    expect(a.alpha).toBe(255);                        // 出生拍全隐（lerp 档 fade=0）
    for (let t = 0; t < 5; t++) a.fixedUpdate(1 / 60, g);
    expect(a.alpha).toBe(130);                        // 255−25×5
    for (let t = 0; t < 7; t++) a.fixedUpdate(1 / 60, g);   // 累计 12 拍
    expect(a.alpha).toBe(0);                          // −25×12=−45 → 钳 0（全显）
  });

  it('[B] AI_131 尘链：attempts 1/2/3 档 × 50% 门 + 尘 6 速度/fadeIn/scale/α（:69551-69571）', () => {
    const { g, dusts } = mkHooks();
    vi.spyOn(Math, 'random').mockReturnValue(0);      // Next(2)=0 → 恒入支
    const mk = (vid: number) => new Arrow(1600, 1600, 15, 0, 40, 2, vid, { grav: 0 });
    const a666 = mk(666);
    for (let t = 0; t < 3; t++) a666.fixedUpdate(1 / 60, g);
    const d666 = dusts.filter((d) => d.type === 6);
    expect(d666).toHaveLength(6);                     // 2 attempts × 3 tick
    for (const d of d666) {
      expect(d.noGravity).toBe(true);
      expect(d.alpha).toBe(100);
      expect(d.scale).toBe(2);
      expect(d.fadeIn).toBeCloseTo(0.5, 6);           // fadeIn += 0.5（quirk 恒入）
      expect(d.vx).toBeCloseTo(15 * 0.2 * 0.3, 6);    // 弹速×0.2×0.3 = 0.9
      expect(d.vy).toBe(0);                           // dvy=0 → Sign(0)×1.2=0
    }
    // 三档 attempts（:69551-69558：num=1/2/3）
    const c664 = mk(664);
    c664.fixedUpdate(1 / 60, g);
    const c668 = mk(668);
    c668.fixedUpdate(1 / 60, g);
    expect(dusts.filter((d) => d.type === 6).length - d666.length).toBe(1 + 3);
    // 50% 门反面：掷不中 → 零尘
    const { g: g2, dusts: dusts2 } = mkHooks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const b = mk(666);
    for (let t = 0; t < 3; t++) b.fixedUpdate(1 / 60, g2);
    expect(dusts2.filter((d) => d.type === 6)).toHaveLength(0);
    void c664; void c668;
  });

  it('[C] GetAlpha 数据面：lerp(k0.5,mul0.7843) 档在场且未 off（Projectile.cs:76367）', () => {
    for (const vid of [664, 666, 668]) {
      const m = PROJ_ALPHA_MOD[vid];
      expect(m).toBeDefined();
      expect(m.kind).toBe('lerp');
      expect(m.k).toBe(0.5);
      expect(m.mul).toBeCloseTo(200 / 255, 4);
      expect(m.off).toBeUndefined();
    }
    // 残影族参数照录（Main.cs:31029-31032 num164=8/num165=2/num167=0.4 + mode0）
    for (const vid of [664, 666, 668]) {
      expect(GHOST_PARAMS[vid]).toMatchObject({ start: 1, end: 8, step: 2, gScale: 0.4 });
      expect(PROJ_TRAILING_MODE[vid]).toBe(0);
    }
  });

  it('[D] 绘制面：残影 rotate=ang+π/2（主判据——旧 ang=0 档不落在场）+ 残影源矩形整图 14×28 + 4 槽 α=(255−α)/255×fade', () => {
    const { g } = mkHooks();
    const a = new Arrow(1600, 1600, 15, 0, 40, 2, 666, { grav: 0 });
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    for (let t = 0; t < 10; t++) a.fixedUpdate(1 / 60, g);   // 环填 10 槽、α=5
    setProjSpriteOverride(666, fakeImg(14, 28) as unknown as ImageBitmap);
    const doc = stubDocWithRecordingCanvases();
    try {
      const { calls, r } = makeR();
      a.draw(r as never, {} as never);
      // ---- 残影槽：9 参 drawImage ×4（i=1,3,5,7）+ 源矩形=整图 14×28 ----
      const ghost = calls.filter((c) => c.m === 'drawImage' && (c.a.length ?? 0) >= 9);
      expect(ghost).toHaveLength(4);
      for (const c of ghost) {
        expect(c.a[1]).toBe(0);       // sx
        expect(c.a[2]).toBe(0);       // sy（帧 0；缺半贴图变异会切出 sy≠0/14）
        expect(c.a[3]).toBe(14);      // sw
        expect(c.a[4]).toBe(28);      // sh（整图高——非 14）
      }
      // ---- 旋转：全部 rotate ≡ ang+1.57（本体 1 + 残影 4;ang=0 → 1.57=原版字面 1.57f
      //      :58733,★G10/R2-F13 字面纪律——旧 π/2 断言随迁,残影 0 档不落在场）----
      const rotVals = calls.filter((c) => c.m === 'rotate').map((c) => c.a[0] as number);
      expect(rotVals.length).toBeGreaterThanOrEqual(5);
      for (const v of rotVals) expect(v).toBe(1.57);
      expect(rotVals).not.toContain(0);               // 旧 bodyRot=ang 变异判别
      // ---- 残影 α：ghostA×fade（ghostA=(255−5)/255；fade=(8−i)/15）----
      let gaCur = 1; let gcCur = 'source-over';
      const stack: Array<[number, string]> = [];
      const ghostGa: number[] = [];
      for (const c of calls) {
        if (c.m === 'save') stack.push([gaCur, gcCur]);
        else if (c.m === 'restore') { const p = stack.pop(); if (p) { gaCur = p[0]; gcCur = p[1]; } }
        else if (c.m === 'set:globalAlpha') gaCur = c.a[0] as number;
        else if (c.m === 'set:globalCompositeOperation') gcCur = c.a[0] as string;
        else if (c.m === 'drawImage' && (c.a.length ?? 0) >= 9) ghostGa.push(gaCur);
      }
      const ghostA = (255 - 5) / 255;
      const expFade = [7 / 15, 5 / 15, 3 / 15, 1 / 15];   // i=1,3,5,7
      expect(ghostGa.map((v) => +v.toFixed(6)))
        .toEqual(expFade.map((f) => +(ghostA * f).toFixed(6)));
    } finally {
      doc.restore();
    }
  });
});
