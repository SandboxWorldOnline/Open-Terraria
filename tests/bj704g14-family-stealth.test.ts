// ★BJ704-G14（2026-10-21）件3 [g11-family-body-stealth-dim] 八型族本体 stealth
//   暗化域外扩面清偿 判别锁。
//  原版族表（Main.cs:32594-32717 亲读）：439/460/600/615/630/633/705/714 八型
//  DrawProj 专属块——num281=1 起,shroomiteStealth（ArmorSetBonuses.cs:374）∨setVortex
//  ∧手持 item.ranged → projectileColor×=max(stealth,0.03)（shroom 均匀）/
//  MultiplyRGBA(Lerp(One,(0,0.12,0.16,0),1−n))（vortex 青蓝）;A 面=255n（GetAlpha
//  默认档 A=newColor.A−α,α=0 族 → ga=n）。型档专属:GetAlpha 633 (:80834 常量白
//  整弃 projectileColor RGB)/714 (:80888-94 Lerp(White,0.8)+A 保留再 ×a2/255)。
//  逐员定谳（门=手持该族武器时 ranged 位）：
//   · 439 激光机枪=2795 magic / 460 充能爆破炮=2882 magic → 手持 ranged 恒假=门死销案
//   · 600 传送枪=3384 无 ranged 旗（Item.cs:3384 块）+仓内无 600 载体 → 双死销案
//   · 633 最后棱镜=magic + GetAlpha 常量白 RGB 整弃 → 双死销案
//   · 615 旋涡吞噬者=3475 ranged / 630 幻象弓=3540 ranged / 705 幻影凤凰=3854
//     ranged / 714 庆典 MK2=3930 ranged → 四员可达=落刀（familyBodyStealthDim 单源
//     + Celeb2Muzzle/Arrow 630/PhoenixBowProj 三载体消费）
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { familyBodyStealthDim, setProjSpriteOverride } from '../src/entities/Arrow';
import { Celeb2Muzzle } from '../src/entities/Celeb2';
import { PhoenixChannel } from '../src/entities/PhoenixBowProj';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const arrowSrc = () => read('src/entities/Arrow.ts');
const celebSrc = () => read('src/entities/Celeb2.ts');
const phoenixSrc = () => read('src/entities/PhoenixBowProj.ts');

/** ranged 手持 def（G11 件5a 同法） */
const rangedDefIdx = (() => {
  for (let i = 0; i < ITEM_DEFS.length; i++) {
    const d = ITEM_DEFS[i];
    if (d && (d.vid ?? -1) >= 0 && itemCombat(d.vid!)?.ranged === true) return i;
  }
  return -1;
})();

const mkOwner = (o: { stealth?: number; shroomite?: boolean; vortex?: boolean; ranged?: boolean }) => ({
  stealth: o.stealth ?? 1,
  equipStats: { shroomiteSet: !!o.shroomite, vortexSet: !!o.vortex },
  inv: { heldItem: () => ({ id: o.ranged === false ? -1 : rangedDefIdx }) },
  cx: 100, cy: 100, facing: 1, dead: false,
});

// ================================================================ §0 源锚/结构锁
describe('§0 源锚（单源求值器 + 三载体消费 + 四员门死销案锁）', () => {
  it('[A] Arrow.ts：familyBodyStealthDim 导出 + 630 本体双路径（queue 光×tint 合成 / 直画烘焙）', () => {
    const s = arrowSrc();
    expect(s).toMatch(/export function familyBodyStealthDim\(/);
    expect(s).toContain('const dim630 = familyBodyStealthDim(r.mainPlayer);');
    expect(s).toContain('const effTint630');          // queue 路径（lq630×dim.rgb 逐通道）
    expect(s).toMatch(/src630F = tintedTex\(img630, t630F, false\) \?\? img630;/);   // 直画路径
    expect(s).toContain('if (dim630) c.globalAlpha = dim630.ga;');
  });
  it('[B] Celeb2.ts：615/714 双员消费 + 714 GetAlpha 专属代数（a2f²;★G19 两遍制迁移后锁）', () => {
    const s = celebSrc();
    expect(s).toContain('const dimCeleb = familyBodyStealthDim(this.owner);');
    expect(s).toContain('gaCeleb = a2f * a2f;');
    // ★BJ704-G19（714 暗光基面两遍制）：基座烘 0.2·n_ch·a2f（+204 抬升项移出
    //   tintedTex → projFullbrightQueue 'lighter' 0.8·a2f³——旧「0.2+204 烘一起」
    //   随 compositeLight 乘光=暗处灭失,期望随刀迁移）。
    expect(s).toContain('Math.trunc(255 * 0.2 * nCh[0] * a2f)');
    expect(s).toContain('liftCeleb = 0.8 * a2f * a2f * a2f;');
    expect(s).not.toContain('* 0.2 + 204');
  });
  it('[C] PhoenixBowProj.ts：705 消费（默认 GetAlpha 档 rgb+ga 直取）', () => {
    const s = phoenixSrc();
    expect(s).toContain('const dim705 = familyBodyStealthDim(this.owner);');
    expect(s).toMatch(/ga705 = dim705\.ga;/);
  });
  it('[D] 四员门死销案锁：439/460/633/600 载体类零消费（负锁——误接即红）', () => {
    expect(read('src/entities/proj1457.ts')).not.toContain('familyBodyStealthDim');   // 439 激光机枪载体
    expect(read('src/entities/PrismProj.ts')).not.toContain('familyBodyStealthDim');  // 460/633 载体
    // 600 传送枪载体：仓内无 600（firePortalGun 直发 601 弹）——负锁 Game 侧无 600 生成位
    expect(read('src/core/Game.ts')).not.toMatch(/new (Arrow|TrapShot)\([^)]*,\s*600\s*,/);
  });
});

// ================================================================ §1 求值器单元
describe('§1 familyBodyStealthDim（Main.cs:32623-32640 两支原文代数）', () => {
  it('[A] 前提：仓内存在 ranged 手持 def', () => {
    expect(rangedDefIdx).toBeGreaterThan(-1);
  });
  it('[B] shroomite+远程+stealth0.5 → 均匀 [0.5,0.5,0.5] ×ga0.5（:32625-32630 ×=num282）', () => {
    const d = familyBodyStealthDim(mkOwner({ stealth: 0.5, shroomite: true }));
    expect(d).not.toBeNull();
    expect(d!.rgb[0]).toBeCloseTo(0.5, 6);
    expect(d!.rgb[1]).toBeCloseTo(0.5, 6);
    expect(d!.rgb[2]).toBeCloseTo(0.5, 6);
    expect(d!.ga).toBeCloseTo(0.5, 6);
  });
  it('[C] vortex+远程+stealth0.5 → 青蓝 [0.5,0.56,0.58]（:32631-32640 lerp(0,0.12,0.16)）', () => {
    const d = familyBodyStealthDim(mkOwner({ stealth: 0.5, vortex: true }));
    expect(d).not.toBeNull();
    expect(d!.rgb[0]).toBeCloseTo(0.5, 6);                       // 1+(0−1)×0.5
    expect(d!.rgb[1]).toBeCloseTo(0.12 + 0.88 * 0.5, 6);         // 0.56
    expect(d!.rgb[2]).toBeCloseTo(0.16 + 0.84 * 0.5, 6);         // 0.58
    expect(d!.ga).toBeCloseTo(0.5, 6);
  });
  it('[D] 双支同钳 0.03（:32626/:32637 stealth<0.03 钳底）', () => {
    expect(familyBodyStealthDim(mkOwner({ stealth: 0.01, shroomite: true }))!.rgb[0]).toBeCloseTo(0.03, 6);
    expect(familyBodyStealthDim(mkOwner({ stealth: 0.001, vortex: true }))!.ga).toBeCloseTo(0.03, 6);
  });
  it('[E] 门关三态：无套装 / 手持非远程 / stealth 满档(恒等) → null', () => {
    expect(familyBodyStealthDim(mkOwner({}))).toBeNull();
    expect(familyBodyStealthDim(mkOwner({ stealth: 0.01, shroomite: true, ranged: false }))).toBeNull();
    expect(familyBodyStealthDim(mkOwner({ stealth: 1, shroomite: true }))).toBeNull();
    expect(familyBodyStealthDim(mkOwner({ stealth: 1, vortex: true }))).toBeNull();
  });
});

// ================================================================ §2 载体绘制行为
describe('§2 载体绘制（tint 烘焙 + globalAlpha 双因子）', () => {
  const fakeImg = (w: number, h: number) => ({ width: w, height: h }) as never;
  class FakeCanvas {
    width = 0; height = 0;
    getContext() {
      return new Proxy({ imageSmoothingEnabled: false } as Record<string, unknown>, {
        get: (t, k) => (k in t ? t[k as string] : () => undefined),
        set: (t, k, v) => { t[k as string] = v; return true; },
      }) as unknown as CanvasRenderingContext2D;
    }
  }
  beforeAll(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: (): FakeCanvas => new FakeCanvas(),
    };
  });
  const mkCtx = () => {
    const draws: Array<{ tex: unknown; ga: number; args: number[] }> = [];
    let gaNow = 1;
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      set imageSmoothingEnabled(_: boolean) {},
      set globalAlpha(v: number) { gaNow = v; },
      set globalCompositeOperation(_: string) {},
      drawImage(tex: unknown, ...args: number[]) { draws.push({ tex, ga: gaNow, args }); },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, draws, gaNowRef: () => gaNow };
  };
  const muzzleOf = (projId: 714 | 615, owner: unknown) =>
    new Celeb2Muzzle(owner as never, projId, () => true, () => ({ x: 200, y: 100 }), () => true);
  const bowOf = (owner: unknown) =>
    new PhoenixChannel(owner as never, 5, 0, 30, 2, 18,
      { channel: () => true, aim: () => ({ x: 200, y: 100 }), volley: () => null, fire: () => {} } as never);

  it('[A] 615 旋涡吞噬者（默认 GetAlpha 档）：shroomite0.5 → 烘焙换源 + ga=0.5', () => {
    const raw = fakeImg(22, 154);
    setProjSpriteOverride(615, raw as never);
    const mz = muzzleOf(615, mkOwner({ stealth: 0.5, shroomite: true }));
    const { ctx, draws } = mkCtx();
    mz.draw({ ctx } as never, {} as never);
    expect(draws).toHaveLength(1);
    expect(draws[0]!.ga).toBeCloseTo(0.5, 6);          // A=255×0.5（默认 GetAlpha）
    expect(draws[0]!.tex).not.toBe(raw);               // tintedTex 烘焙画布换源
  });
  it('[B] 615 无 stealth → 原图直画 + ga 恒 1（恒等档零烘焙）', () => {
    const raw = fakeImg(22, 154);
    setProjSpriteOverride(615, raw as never);
    const mz = muzzleOf(615, mkOwner({}));
    const { ctx, draws } = mkCtx();
    mz.draw({ ctx } as never, {} as never);
    expect(draws).toHaveLength(1);
    expect(draws[0]!.ga).toBe(1);                      // 未写 globalAlpha（恒等折 null）
    expect(draws[0]!.tex).toBe(raw);                   // 原图直画
  });
  it('[C] 714 庆典 MK2（GetAlpha :80888-94 专属档）：stealth0.5 → ga=a2f²', () => {
    const raw = fakeImg(22, 154);
    setProjSpriteOverride(714, raw as never);
    const mz = muzzleOf(714, mkOwner({ stealth: 0.5, shroomite: true }));
    const { ctx, draws } = mkCtx();
    mz.draw({ ctx } as never, {} as never);
    const a2f = Math.trunc(255 * 0.5) / 255;           // a2=(int)(255×0.5)=127
    expect(draws[0]!.ga).toBeCloseTo(a2f * a2f, 6);    // A=a2×a2/255（≈0.248）
    expect(draws[0]!.tex).not.toBe(raw);               // mult 烘焙换源
  });
  it('[D] 705 幻影凤凰（默认 GetAlpha 档）：vortex0.4 → ga=0.4 + 烘焙换源', () => {
    const raw = fakeImg(30, 30);
    setProjSpriteOverride(705, raw as never);
    const bow = bowOf(mkOwner({ stealth: 0.4, vortex: true }));
    const { ctx, draws } = mkCtx();
    bow.draw({ ctx } as never, {} as never);
    expect(draws).toHaveLength(1);
    expect(draws[0]!.ga).toBeCloseTo(0.4, 6);
    expect(draws[0]!.tex).not.toBe(raw);
  });
});
