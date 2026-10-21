// ★BJ704-G11（2026-10-21）件1 [g9-tiger-body-anchor] 登记债清偿——沙漠虎 833-835
//  本体底锚专支（MinionProj.draw）+ ghost originX 乘数勘正（projGhostTrail）。
// 定谳（反编译 Terarria1457 亲读）：
//  · Main.cs:30706-30719 步态帧特支（833 frame!=8 / 834-835 frame!=10——帧号门,
//    AI 态不掺混）:zero.Y+=h/2 → 绘位=Center+(0,h/2)（num151 表 :30077-30528 无
//    833-835 项=0;gfxOffY 未建模恒 0=全仓近似）;origin8=帧尺寸×(0.5,1) 后 Y−=4、
//    X−=7|2×ToDirectionInt（Utils.cs:2131 bool→flip?1:−1——右向 W/2+7|2 / 左向
//    W/2−7|2,翻转两侧同屏矩形）。
//  · 飞行帧 8|10 回 :31578 族支缺省=盒心锚+帧心 origin（533 专支同形）。
//  · ghost 侧（:31383 与本体共用 origin8/zero）:BJ235 GHOST_FRAME 已建模帧门/
//    zeroHalfH/originY,originX 消费位旧乘数 0/1（flipInt）≠ 原文 ToDirectionInt
//    ±1——右向漏 +7|2px,随刀勘正（G10「ghost 已建模同值」表述勘误）。
// 旧通用尾（帧左上锚盒左上）偏:833 步态 +21px 右+12px 下（帧 54×36/盒 26×20）/
//  834-835 步态 +24px 右+14px 下（帧 64×44/盒 20×30）/飞行帧 +14|24px 右。
// 变异恰红（逐发验证后还原）:M1 摘虎专支（回通用尾）/M2 ox 翻转符号回 0/1 乘数/
//  M3 ghost 乘数回 0/1。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MinionProj, minionTrueBox } from '../src/entities/MinionProj';
import { ProjGhostRing, drawProjGhosts } from '../src/entities/projGhostTrail';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { setProjSpriteOverride } from '../src/entities/Arrow';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ---- 夹具（G9 §5.1 同款：fakeTex + 记录型 ctx + document 桩）----
const fakeTex = (w: number, h: number): HTMLImageElement =>
  ({ width: w, height: h }) as unknown as HTMLImageElement;
class FakeCanvas {
  width = 0; height = 0;
  getContext() {
    // tintedTex（drawProjGhosts 内染色烘焙）需要 fillRect/globalCompositeOperation 等
    return new Proxy({ imageSmoothingEnabled: false } as Record<string, unknown>, {
      get: (t, k) => {
        if (k in t) return t[k as string];
        return () => undefined;   // 所有方法 no-op
      },
      set: (t, k, v) => { t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  }
}
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (): FakeCanvas => new FakeCanvas(),
  };
});
const recordingCtx = () => {
  const draws: Array<{ tex: unknown; args: number[] }> = [];
  const translates: number[][] = [];
  const scales: number[][] = [];
  const ctx = {
    save() {}, restore() {},
    translate(x: number, y: number) { translates.push([x, y]); },
    rotate(_a: number) {},
    scale(x: number, y: number) { scales.push([x, y]); },
    set imageSmoothingEnabled(_: boolean) {},
    set globalAlpha(_: number) {},
    set fillStyle(_: string) {}, set strokeStyle(_: string) {},
    fillRect() {}, strokeRect() {},
    drawImage(tex: unknown, ...rest: number[]) { draws.push({ tex, args: rest }); },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, draws, translates, scales };
};
const mkPlayer = () => new Player(60 * 16, 90 * 16, new Inventory());
const mkTiger = (projId: 833 | 834 | 835, tigerFrame: number, facing: 1 | -1): MinionProj => {
  const p = mkPlayer();
  const bx = minionTrueBox(projId);
  const m = new MinionProj(p.cx, 100 * 16 - bx.h, projId, 10, 2, false, 0, false, () => p);
  (m as unknown as { alphaFade: number }).alphaFade = 0;
  (m as unknown as { tigerFrame: number }).tigerFrame = tigerFrame;
  m.facing = facing;
  return m;
};

// ================================================================ §0 源锚
describe('§0 源锚（Main.cs:30706-30719 + projGhostTrail 乘数）', () => {
  it('[A] MinionProj 虎专支在 533 专支后、通用尾前,带 :30706 锚注 + ToDirectionInt 语义', () => {
    const s = read('src/entities/MinionProj.ts');
    expect(s).toContain('★BJ704-G11（件1,[g9-tiger-body-anchor] 登记债清偿）沙漠虎 833-835 本体');
    expect(s).toContain('Main.cs:30706-30719 步态帧特支');
    expect(s).toContain('ox833 = img.width / 2 - kx833 * (this.facing < 0 ? 1 : -1)');
    expect(s).toContain('const flyGate833 = this.projId === 833 ? 8 : 10');
    // 专支位置：533 专支出口之后、num143/144 偏移表消费之前
    const i533 = s.indexOf('return;   // 533 专支出口');
    const iTiger = s.indexOf('if (this.projId >= 833 && this.projId <= 835 && img) {');
    const iOff = s.indexOf('// ---- 原版偏移表消费');
    expect(i533).toBeGreaterThan(0);
    expect(iTiger).toBeGreaterThan(i533);
    expect(iOff).toBeGreaterThan(iTiger);
  });
  it('[B] ghost originX 乘数=ToDirectionInt ±1（:30711/:30718）', () => {
    const s = read('src/entities/projGhostTrail.ts');
    expect(s).toContain('ox += spec.originX * (o.spriteDirection === -1 ? 1 : -1)');
    expect(s).not.toContain('ox += spec.originX * (o.spriteDirection === -1 ? 1 : 0)');
  });
  it('[C] g916 除数勘正 7→6（projFrames[916]=6,Main.cs:8592;无载体=鞭 ghost 域维持登记）', () => {
    const s = read('src/entities/projGhostTrail.ts');
    expect(s).toContain("case 'g916': sh = Math.floor(ih / 6)");
    expect(s).not.toContain("case 'g916': sh = Math.floor(ih / 7)");
  });
});

// ================================================================ §1 本体行为锁
describe('§1 本体底锚（步态带 :30706-30719 / 飞行帧回缺省 :31578）', () => {
  it('[A] 833 步态帧 0·朝右：translate=[cx,盒底]、drawImage=[−(W/2+7),−(H−4)]', () => {
    setProjSpriteOverride(833, fakeTex(54, 360));            // 10 帧 × 36（projFrames[833]=10）
    const m = mkTiger(833, 0, 1);
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy + 10]]);     // 盒底锚（cy+盒高/2;旧通用尾=[cx−13+27,cy] → 必红）
    expect(rec.draws).toHaveLength(1);
    expect(rec.draws[0].args).toEqual([-34, -32]);           // ox=27+7（ToDirectionInt −1 右向）、oy=36−4
    expect(rec.scales).toHaveLength(0);                      // 右向不镜像
  });
  it('[B] 833 步态帧 0·朝左：镜像 scale(−1,1) + ox=W/2−7（翻转侧同屏矩形）', () => {
    setProjSpriteOverride(833, fakeTex(54, 360));
    const m = mkTiger(833, 0, -1);
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy + 10]]);
    expect(rec.draws[0].args).toEqual([-20, -32]);           // ox=27−7
    expect(rec.scales).toContainEqual([-1, 1]);
  });
  it('[C] 834/835 步态帧：k=2 档（帧 64×44/盒 20×30）', () => {
    setProjSpriteOverride(834, fakeTex(64, 528));            // 12 帧 × 44（projFrames[834]=12）
    const m = mkTiger(834, 2, 1);                            // 走带帧 2
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy + 15]]);     // 盒高 30 → +15
    expect(rec.draws[0].args).toEqual([-34, -40]);           // ox=32+2、oy=44−4
    setProjSpriteOverride(835, fakeTex(64, 528));
    const m2 = mkTiger(835, 9, -1);                          // 835 走带上限帧 9（≠10 飞行门）
    const rec2 = recordingCtx();
    m2.draw({ ctx: rec2.ctx } as never);
    expect(rec2.draws[0].args).toEqual([-30, -40]);          // ox=32−2（朝左）
  });
  it('[D] 833 飞行帧 8：回族支缺省=盒心锚+帧心（:31578）', () => {
    setProjSpriteOverride(833, fakeTex(54, 360));
    const m = mkTiger(833, 8, 1);
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy]]);          // 盒心（旧通用尾=[cx+14,cy] → 必红）
    expect(rec.draws[0].args).toEqual([-27, -18]);           // 帧心 54/2×36/2
  });
  it('[E] 834 飞行帧 10 同缺省（门=10 非 9）', () => {
    setProjSpriteOverride(834, fakeTex(64, 528));
    const m = mkTiger(834, 10, -1);
    const rec = recordingCtx();
    m.draw({ ctx: rec.ctx } as never);
    expect(rec.translates).toEqual([[m.cx, m.cy]]);
    expect(rec.draws[0].args).toEqual([-32, -22]);
    expect(rec.scales).toContainEqual([-1, 1]);
  });
});

// ================================================================ §2 ghost originX 乘数（±1）
describe('§2 ghost 833 originX（:31383 共用 origin8——右向 +7 旧漏勘正）', () => {
  const ghostDraw = (sd: 1 | -1) => {
    const ring = new ProjGhostRing(833);
    ring.record(100, 200, 0, 1, true);
    ring.record(100, 200, 0, 1, true);   // 2 槽（start=6 step=−1 → 仅 i=1 可达）
    const rec = recordingCtx();
    drawProjGhosts(rec.ctx, {
      ring, id: 833, tex: fakeTex(54, 360), frames: 10, frame: 0,
      bodyW: 26, bodyH: 20, bodyRot: 0, bodyScale: 1, bodyAlpha: 1,
      ai0: 0, ai1: 0, timeLeft: 300, opacity: 1, vxLen: 6, spriteDirection: sd,
    } as Parameters<typeof drawProjGhosts>[1]);
    const dr = rec.draws[0].args;        // 记录器剥 tex → （sx,sy,sw,sh,dx,dy,dw,dh）
    const s1 = 1 + (1.5 - 1) * (1 / 15); // i=1 槽 scale=Lerp(1,1.5,1/15)
    return { dx: dr[4] as number, dy: dr[5] as number, s1 };
  };
  it('[A] 朝右（sd=1）：ox=W/2+7=34（旧 0/1 乘数=27 → 必红）', () => {
    const { dx, dy, s1 } = ghostDraw(1);
    expect(dx).toBeCloseTo(-34 * s1, 6);
    expect(dy).toBeCloseTo(-32 * s1, 6);   // oy=帧高36−4（zeroHalfH 纵锚 bj235 既有）
  });
  it('[B] 朝左（sd=−1）：ox=W/2−7=20（bj235 既有锁保持）', () => {
    const { dx, s1 } = ghostDraw(-1);
    expect(dx).toBeCloseTo(-20 * s1, 6);
  });
});
