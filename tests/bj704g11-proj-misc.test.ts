// ★BJ704-G11（2026-10-21）件3/4/5——弹幕域尾件清偿：
//  件3（G10 债①）AI_001 专属块 435/436/682 未扫面（Projectile.cs:55874-55898 435 /
//    :55107-55131 436 / :55900-55934 682）：435/436 首拍 Item12+点光、682 首拍
//    8×d272+点光（DD2_LightningBugZap 首拍音已由发射位 shootD2 承载=销案）;
//    alpha−40/t 三员死码销案（SetDefaults 无 α 行=0 起,−40 钳 0 恒等;GetAlpha
//    435/436=A25/682=A127 fixed 档不读 α,ghost bodyAlpha 通道依赖 α≡0）。
//  件4（G10 债②）PROJ_ROT_DIAG 异字面拆集（0.785f :26910-26911 vs MathF.PI/4f
//    :58632/:31582）——PROJ_ROT_DIAG_0P785/PI4 二集,消费位逐字面分派
//    （tests/proj-rotation 随案重铸）。
//  件5（G10 债③）630 num281 stealth 档——前提勘误:shroom/vortex stealth 仓内已
//    建模（Player.stealth/equipStats）=可达 → 落刀（overlay 双因子:rgb 烘焙+
//    globalAlpha）;g916 除数 7→6（projFrames[916]=6,Main.cs:8592）无载体=鞭
//    ghost 域维持登记（tests/bj704g11-tiger-anchor §0[C] 锁）。
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Arrow, PROJ_ROT_DIAG_0P785, PROJ_ROT_DIAG_PI4, setProjSpriteOverride } from '../src/entities/Arrow';
import { TileStore } from '../src/world/TileStore';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const srcArrow = () => read('src/entities/Arrow.ts');
const srcDd2 = () => read('src/entities/bossAI_dd2.ts');

afterEach(() => { vi.restoreAllMocks(); });

function mkHooks() {
  return {
    world: { store: new TileStore(400, 400) } as never,
    player: { dead: true, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 20, h: 42 } as never,
    enemies: () => [], critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {}, playSfx: () => {}, showPickupLabel: () => {},
    spawnDust: () => null,
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as unknown as GameHooks;
}

// ================================================================ 件3：435/436/682 专属块
describe('件3 AI_001 专属块 435/436/682 余面（:55874-55898/:55107-55131/:55900-55934）', () => {
  it('[A] 源锚：三分支在位 + alpha 死码不建模（判语）', () => {
    const s = srcArrow();
    expect(s).toContain('if (this.projId === 435) {');
    expect(s).toContain("game.playSfxFiles?.(['Item_12'], 1, this.x, this.y);   // :55876-55880");
    expect(s).toContain('this.lightRGB = [0.3, 0.8, 1.1];');
    expect(s).toContain('this.lightRGB = [0.3, 1.1, 0.5];');
    expect(s).toContain('this.lightRGB = [0.5, 0.2, 1.1];');
    // alpha 面三员死码（SetDefaults α=0 起,−40 钳 0 恒等）——块内零 alpha 写
    const blk = s.slice(s.indexOf('if (this.projId === 435) {'), s.indexOf('if (this.projId === 435) {') + 1900);
    expect(blk).not.toMatch(/this\.alpha\s*[-+*]?=/);
  });
  it('[B] 行为·435：首拍 Item_12 + 点光 (0.3,0.8,1.1)（:55876-55880/:55896）', () => {
    const sfx: string[][] = [];
    const g = mkHooks();
    (g as unknown as { playSfxFiles: unknown }).playSfxFiles =
      (names: string[]) => { sfx.push(names); };
    const a = new Arrow(1600, 1600, 8, 0, 35, 2, 435, { grav: 0, life: 300, hostile: true });
    a.fixedUpdate(1 / 60, g);                          // age 1 → 首拍音
    expect(sfx).toEqual([['Item_12']]);
    expect((a as unknown as { lightRGB: number[] | null }).lightRGB)
      .toEqual([0.3, 0.8, 1.1]);
    a.fixedUpdate(1 / 60, g);                          // age 2 → 单发门不再播
    expect(sfx).toHaveLength(1);
  });
  it('[C] 行为·436：首拍 Item_12 + 点光 (0.3,1.1,0.5)（:55108-55112/:55130）', () => {
    const sfx: string[][] = [];
    const g = mkHooks();
    (g as unknown as { playSfxFiles: unknown }).playSfxFiles =
      (names: string[]) => { sfx.push(names); };
    const a = new Arrow(1600, 1600, 11, 0, 24, 2, 436, { grav: 0, life: 300, hostile: true });
    a.fixedUpdate(1 / 60, g);
    expect(sfx).toEqual([['Item_12']]);
    expect((a as unknown as { lightRGB: number[] | null }).lightRGB)
      .toEqual([0.3, 1.1, 0.5]);
  });
  it('[D] 行为·682：首拍 8×d272（vel=v×0.65 覆写/位+=尘速×3/scale0.6/fadeIn0.8）+ 点光（:55902-55933）', () => {
    const dusts: Array<{ type: number; vx: number; vy: number; scale: number; fadeIn: number;
      noGravity: boolean; noLight: boolean; x: number; y: number }> = [];
    const g = mkHooks();
    (g as unknown as { spawnDust: unknown }).spawnDust =
      (_x: number, _y: number, _w: number, _h: number, type: number) => {
        const d = { type, vx: 0, vy: 0, scale: 1, fadeIn: 0, noGravity: false, noLight: false, x: 0, y: 0 };
        dusts.push(d as never);
        return d;
      };
    const a = new Arrow(1600, 1600, 10, -4, 50, 2, 682, { grav: 0, life: 30, hostile: true });
    a.fixedUpdate(1 / 60, g);                          // age 1 → 8 尘
    expect(dusts).toHaveLength(8);
    for (const d of dusts) {
      expect(d.type).toBe(272);
      expect(d.vx).toBeCloseTo(10 * 0.65, 6);          // vel×1 恒等 + v×0.65
      expect(d.vy).toBeCloseTo(-4 * 0.65, 6);
      expect(d.scale).toBe(0.6);
      expect(d.fadeIn).toBe(0.8);
      expect(d.noGravity).toBe(true);
      expect(d.noLight).toBe(true);
      expect(d.x).toBeCloseTo(10 * 0.65 * 3, 6);       // position += 尘速×3
      expect(d.y).toBeCloseTo(-4 * 0.65 * 3, 6);
    }
    expect((a as unknown as { lightRGB: number[] | null }).lightRGB)
      .toEqual([0.5, 0.2, 1.1]);
    a.fixedUpdate(1 / 60, g);                          // age 2 → 单发门
    expect(dusts).toHaveLength(8);
  });
  it('[E] 682 首拍音=发射位承载（shootD2 PROJ_SHOT_SFX,等效销案）', () => {
    expect(srcDd2()).toContain("682: 'dd2_lightning_bug_zap',    // :52055 DD2_LightningBugZap");
  });
});

// ================================================================ 件4：PROJ_ROT_DIAG 拆集
describe('件4 PROJ_ROT_DIAG 异字面拆集（0.785f vs π/4f）', () => {
  it('[A] 成员分派：0P785=aiStyle27 六员 / PI4={660,451};451 锚勘误（Projectile.cs 非 Main.cs）', () => {
    expect([...PROJ_ROT_DIAG_0P785].sort((a, b) => a - b)).toEqual([114, 115, 116, 132, 156, 173]);
    expect([...PROJ_ROT_DIAG_PI4].sort((a, b) => a - b)).toEqual([451, 660]);
    expect(srcArrow()).toContain('AI_081 :31582/:31633');   // 451 源锚勘误注
  });
  it('[B] 消费位逐字面分派（132→+0.785 / 660→+π/4）', () => {
    const s = srcArrow();
    expect(s).toContain('PROJ_ROT_DIAG_0P785.has(this.projId) ? ang + 0.785');
    expect(s).toContain('PROJ_ROT_DIAG_PI4.has(this.projId) ? ang + Math.PI / 4');
  });
});

// ================================================================ 件5a：630 num281 stealth 档
describe('件5a 630 overlay num281 stealth 档（Main.cs:32623-32640——前提勘误:可达）', () => {
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
  // 找一个 ranged 手持 def（itemCombat(vid).ranged === true）
  const rangedDefIdx = (() => {
    for (let i = 0; i < ITEM_DEFS.length; i++) {
      const d = ITEM_DEFS[i];
      if (d && (d.vid ?? -1) >= 0 && itemCombat(d.vid!)?.ranged === true) return i;
    }
    return -1;
  })();
  const mkR = (mainPlayer: unknown) => {
    const glowTex = fakeImg(32, 54);
    const draws: Array<{ tex: unknown; ga: number; args: number[] }> = [];
    let gaNow = 1;
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      set imageSmoothingEnabled(_: boolean) {},
      set globalAlpha(v: number) { gaNow = v; },
      set fillStyle(_: string) {},
      fillRect() {}, strokeRect() {},
      drawImage(tex: unknown, ...args: number[]) { draws.push({ tex, ga: gaNow, args }); },
    } as unknown as CanvasRenderingContext2D;
    const r = {
      ctx, mainPlayer,
      atlas: {
        ensureVImage: (p: string) => (p === 'vanilla/Glow_200.png' ? glowTex : fakeImg(36, 276)),
        vimages: new Map(),
      },
    } as never;
    return { r, draws, glowTex };
  };
  const mk630 = (opts: { stealth?: number; shroomite?: boolean; vortex?: boolean; ranged?: boolean }) => {
    setProjSpriteOverride(630, fakeImg(22, 22) as never);   // 本体贴图（无 override 时 630 支整跳）
    const mp = {
      stealth: opts.stealth ?? 1,
      equipStats: { shroomiteSet: !!opts.shroomite, vortexSet: !!opts.vortex },
      inv: { heldItem: () => ({ id: opts.ranged === false ? -1 : rangedDefIdx }) },
      facing: 1, cx: 100, y: 100, h: 42,
    };
    const a = new Arrow(1600, 1600, 8, 0, 40, 2, 630, { grav: 0, life: 600 });
    (a as unknown as { ph630Flash: number }).ph630Flash = 2;   // 闪光可见窗（row 4）
    return { a, mp };
  };
  // drawImage 记录形态：本体/glow = 2 参（tex,x,y）;闪光 = 8 参（源矩形 4+目标 4）
  const glowDrawOf = (draws: Array<{ tex: unknown; ga: number; args: number[] }>, bodyTex: unknown) =>
    draws.filter((d) => d.args.length === 2 && d.tex !== bodyTex)[0];

  it('[A] 前提自证：仓内存在 ranged 手持 def（itemCombat 通道）', () => {
    expect(rangedDefIdx).toBeGreaterThan(-1);
  });
  it('[B] 无 stealth → n=1：ga=127/255、源=原 tex', () => {
    const { a, mp } = mk630({});
    const { r, draws, glowTex } = mkR(mp);
    a.draw(r, {} as never);
    const bodyTex = draws[0].tex;
    const glow = glowDrawOf(draws, bodyTex);
    expect(glow).toBeTruthy();
    expect(glow.ga).toBeCloseTo(127 / 255, 6);
    expect(glow.tex).toBe(glowTex);                    // 未烘焙
  });
  it('[C] shroomite+远程手持+stealth0.5 → n=0.5：ga=trunc(127×0.5)/255=63/255、rgb 烘焙换源', () => {
    const { a, mp } = mk630({ stealth: 0.5, shroomite: true });
    const { r, draws, glowTex } = mkR(mp);
    a.draw(r, {} as never);
    const bodyTex = draws[0].tex;
    const glow = glowDrawOf(draws, bodyTex);
    expect(glow.ga).toBeCloseTo(Math.trunc(127 * 0.5) / 255, 6);   // 63/255（rgb×trunc(255×0.5)/255 烘焙另证源切换）
    expect(glow.tex).not.toBe(glowTex);                // tintedTex 烘焙画布
  });
  it('[D] 钳底档 stealth0.01 → n=0.03（:32626/:32637 双支同钳）:ga=3/255', () => {
    const { a, mp } = mk630({ stealth: 0.01, vortex: true });
    const { r, draws } = mkR(mp);
    a.draw(r, {} as never);
    const glow = glowDrawOf(draws, draws[0].tex);
    expect(glow.ga).toBeCloseTo(Math.trunc(127 * 0.03) / 255, 6);  // trunc(3.81)=3
  });
  it('[E] 手持非远程（ranged=false）→ n=1（draw 期活查门）', () => {
    const { a, mp } = mk630({ stealth: 0.01, shroomite: true, ranged: false });
    const { r, draws } = mkR(mp);
    a.draw(r, {} as never);
    const glow = glowDrawOf(draws, draws[0].tex);
    expect(glow.ga).toBeCloseTo(127 / 255, 6);
  });
  it('[F] 闪光 overlay 同档（9 参切片绘,ga 同 glow）', () => {
    const { a, mp } = mk630({ stealth: 0.5, shroomite: true });
    const { r, draws } = mkR(mp);
    a.draw(r, {} as never);
    const flash = draws.filter((d) => d.args.length === 8)[0];
    expect(flash).toBeTruthy();
    expect(flash.ga).toBeCloseTo(Math.trunc(127 * 0.5) / 255, 6);
  });
  it('[G] 源锚：本体 projectileColor×=stealth 族面域外登记注在位', () => {
    expect(srcArrow()).toContain('g11-family-body-stealth-dim');
  });
});
