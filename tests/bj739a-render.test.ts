// ★BJ739-A（2026-10-31，issue #29）渲染面行为锁：B12 狩猎双色 / B13 群系视觉三色 /
// B18 危险感知原版表重建。
// 标杆：Terarria1457（NPC.cs:92126-92258; Main.cs:22006-22024; TileDrawing.cs:4473-4507;
//       TileID.cs:331/339/349/393; Minecart.cs:549）。
import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Renderer } from '../src/render/Renderer';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { BuffType } from '../src/stats/Buffs';
import { TILE_BY_KEY } from '../src/data/tiles';
import { withMutation } from './mutation-guard';

afterEach(() => { vi.restoreAllMocks(); });

beforeAll(() => {
  // SkyRenderer/Renderer 构造需要浏览器全局（bj454 同款替身）
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

type Rec = Record<string, unknown>;
type StrokeRec = Rec & { stroke?: string };

/** ctx 桩：样式可变容器 + fillRect/strokeRect 记录 */
const makeCtx = (rects: Rec[]): CanvasRenderingContext2D => {
  const style = { fill: '#000', stroke: '#000' };
  return {
    globalAlpha: 1, lineWidth: 1,
    get fillStyle() { return style.fill; },
    set fillStyle(v: string) { style.fill = v; },
    get strokeStyle() { return style.stroke; },
    set strokeStyle(v: string) { style.stroke = v; },
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, fill: style.fill }); },
    strokeRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, stroke: style.stroke }); },
  } as unknown as CanvasRenderingContext2D;
};

// ============ B13/B18：HIGHLIGHT_SETS 原版表内容 ============

describe('BJ739 B18 危险感知集原版表', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const HS = (Renderer as any).HIGHLIGHT_SETS as {
    danger: Set<number>; dangerGated: Set<number>; dangerHot: Set<number>;
    thinIce: number; cactus: number; pressurePlateTrack: number;
    biomeCorrupt: Set<number>; biomeCrimson: Set<number>; biomeHallow: Set<number>;
    lesion: number; flesh: number; crispyHoney: number;
  };
  it('蛛网与三种荆棘入危险集（issue B18 四缺口）', () => {
    expect(HS.dangerGated.has(TILE_BY_KEY['v_51_cobweb'])).toBe(true);
    expect(HS.dangerGated.has(TILE_BY_KEY['v_32_corruption_thorns'])).toBe(true);
    expect(HS.dangerGated.has(TILE_BY_KEY['v_69_jungle_thorns'])).toBe(true);
    expect(HS.dangerGated.has(TILE_BY_KEY['v_352_crimtane_thorns'])).toBe(true);
  });
  it('基集成员：巨石 137 与炸药与地雷与起爆器与 TNT 与狱石 58 无坡面门', () => {
    for (const k of ['v_137_traps', 'v_141_explosives', 'v_210_landmine', 'v_411_detonator',
      'v_654_tnt_barrel', 'ore_hellstone']) {
      expect(HS.danger.has(TILE_BY_KEY[k] ?? -1)).toBe(true);
    }
  });
  it('灼热族：陨石 37 与狱石 58 与狱石砖 76 与脆蜂蜜块 230（fireWalk 豁免档）', () => {
    expect(HS.dangerHot.has(TILE_BY_KEY['ore_meteorite'] ?? -1)).toBe(true);    // 37 陨石（TouchDamageHot）
    expect(HS.dangerHot.has(TILE_BY_KEY['ore_hellstone'] ?? -1)).toBe(true);    // 58 狱石（基集+Hot 双位）
    expect(HS.dangerHot.has(TILE_BY_KEY['v_76_hellstone_brick'] ?? -1)).toBe(true);
    expect(HS.dangerHot.has(TILE_BY_KEY['v_230_crispy_honey_block'] ?? -1)).toBe(true);
  });
  it('薄冰与仙人掌与压板轨道（314=矿车轨道,压板帧 20 与 21）位', () => {
    expect(HS.thinIce).toBe(TILE_BY_KEY['thin_ice']);
    expect(HS.cactus).toBe(TILE_BY_KEY['v_80_cactus']);
    expect(HS.pressurePlateTrack).toBe(TILE_BY_KEY['v_314_minecart_track']);
  });
  it('旧 regex 混入面收敛：宝箱 21 与腐化草 23 不再是 danger 成员', () => {
    expect(HS.danger.has(TILE_BY_KEY['chest'])).toBe(false);
    expect(HS.danger.has(TILE_BY_KEY['v_23_corrupt_grass_block'])).toBe(false);
    expect(HS.dangerGated.has(TILE_BY_KEY['v_23_corrupt_grass_block'])).toBe(false);
  });
});

describe('BJ739 B13 群系视觉三色集', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const HS = (Renderer as any).HIGHLIGHT_SETS as {
    biomeCorrupt: Set<number>; biomeCrimson: Set<number>; biomeHallow: Set<number>;
    lesion: number; flesh: number;
  };
  it('腐化集成员（腐化草与黑檀岩与腐化荆棘）', () => {
    expect(HS.biomeCorrupt.has(TILE_BY_KEY['v_23_corrupt_grass_block'])).toBe(true);
    expect(HS.biomeCorrupt.has(TILE_BY_KEY['v_25_ebonstone_block'] ?? -1)).toBe(true);
    expect(HS.biomeCorrupt.has(TILE_BY_KEY['v_32_corruption_thorns'])).toBe(true);
  });
  it('猩红集成员（猩红岩与猩红沙与猩红荆棘）', () => {
    expect(HS.biomeCrimson.has(TILE_BY_KEY['v_203_crimstone_block'] ?? -1)).toBe(true);
    expect(HS.biomeCrimson.has(TILE_BY_KEY['v_234_crimsand_block'] ?? -1)).toBe(true);
    expect(HS.biomeCrimson.has(TILE_BY_KEY['v_352_crimtane_thorns'])).toBe(true);
  });
  it('神圣集成员（神圣草与珍珠岩与神圣长草）', () => {
    expect(HS.biomeHallow.has(TILE_BY_KEY['v_109_hallowed_grass_block'] ?? -1)).toBe(true);
    expect(HS.biomeHallow.has(TILE_BY_KEY['v_110_hallow_short_plants'] ?? -1)).toBe(true);
    expect(HS.biomeHallow.has(TILE_BY_KEY['v_113_hallow_tall_plants'] ?? -1)).toBe(true);
  });
  it('remix 474 与 195 特例位保持（IIIII224 既有锁不回归）', () => {
    expect(HS.lesion).toBeGreaterThan(0);
    expect(HS.flesh).toBeGreaterThan(0);
  });
});

// ============ B12：狩猎真着色面（★BJ756 2026-11-02 收编——红/绿框近似层退役,
// 谓词单源 Renderer.hunterPotionAppearsFriendly;行为锁迁 tests/bj756a-hunter-tint-floor.test.ts） ============

describe('BJ739 B12 狩猎谓词（BJ756 收编后单源复核）', () => {
  it('友好/敌对/catchItem/5 血零伤/689 覆写五臂（NPC.cs:92126-92135）', () => {
    const f = Renderer.hunterPotionAppearsFriendly;
    expect(f({ vanillaId: -1, maxHp: 250, def: { friendly: true, damage: 10 } })).toBe(true);
    expect(f({ vanillaId: -1, maxHp: 250, def: { friendly: false, damage: 20 } })).toBe(false);
    expect(f({ vanillaId: 46, maxHp: 5, def: { friendly: false, damage: 0 } })).toBe(true);
    expect(f({ vanillaId: -1, maxHp: 5, def: { friendly: false, damage: 0 } })).toBe(true);
    expect(f({ vanillaId: 689, maxHp: 5, def: { friendly: true, damage: 0 } })).toBe(false);
    expect(f({ vanillaId: -1, maxHp: 1, def: { friendly: false, damage: 0 } })).toBe(false);
  });
  it('★BJ756 近似层退役:drawBuffHighlights hunter-only 态零框（近似层销账复核）', () => {
    const rects: Rec[] = [];
    const ctx = makeCtx(rects);
    const w = new World(80, 80, 42, 'bj739a-r12');
    const p = new Player(40 * 16, 40 * 16, new Inventory());
    p.buffs.apply(BuffType.Hunter, 60);
    const r = new Renderer(null as never);
    const fn = (r as unknown as { drawBuffHighlights(...args: unknown[]): void }).drawBuffHighlights;
    fn.call(r, ctx, w, p, { x: 40 * 16, y: 40 * 16 } as never,
      640, 480, 1, 16, [
        { x: 600, y: 600, w: 20, h: 30, dead: false, maxHp: 250, vanillaId: -1, def: { friendly: true, damage: 10 } },
      ] as never);
    expect(rects.filter((r2) => 'stroke' in r2)).toHaveLength(0);
    expect(rects.filter((r2) => 'fill' in r2)).toHaveLength(0);   // tile 高亮三旗全关=零绘制
  });
});

// ============ 结构锁 ============

describe('BJ739 渲染结构锁', () => {
  it('B18 门源锚：坡面与致动与 fireWalk 与 iceSkate 与压板帧', () => {
    expect(rendererSrc).toContain('st.slope[i] === 0 && !(st.wire[i] & 32)');
    expect(rendererSrc).toContain('HS.dangerHot.has(t)) dangerHit = !eqHi.fireWalk');
    expect(rendererSrc).toContain('t === HS.thinIce) dangerHit = !eqHi.iceSkate');
    expect(rendererSrc).toContain('st.frameX[i] === 20 || st.frameX[i] === 21');
  });
  it('B13 三色字面量', () => {
    expect(rendererSrc).toContain("ctx.fillStyle = '#C864F0';   // (200,100,240) 腐化");
    expect(rendererSrc).toContain("ctx.fillStyle = '#FF6464';   // (255,100,100) 猩红");
    expect(rendererSrc).toContain("ctx.fillStyle = '#FFA0F0';   // (255,160,240) 神圣");
  });
  it('B12 近似层退役锁（★BJ756）:框字面量绝迹,谓词/钳底单源在位', () => {
    expect(rendererSrc).not.toContain("ctx.strokeStyle = friendly ? '#32FF32' : '#FF3232';");
    expect(rendererSrc).toContain('static hunterPotionAppearsFriendly(');
    expect(rendererSrc).toContain(
      'floor: Renderer.hunterPotionAppearsFriendly(e) ? [50, 255, 50] : [255, 50, 50],');
  });
});

// ============ 变异恰红 ============

describe('BJ739 变异恰红 render 面', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj739a-render.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_BJ739A_MUT: '1' },
    },
  );
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `BJ739-A render ${filter}` });
  };
  const RENDERER = join(process.cwd(), 'src', 'render', 'Renderer.ts');

  it('M12 B12（★BJ756 收编后重锚）:谓词 689 覆写臂摘除 → 覆写夹具红', () => {
    mutate(RENDERER,
      '    if (e.vanillaId === 689) return false;                    // HunterPotionFriendlyOverride（NPCID.cs:4462）',
      '    if (e.vanillaId === -12345) return false; /* BJ739A-M12 变异 */',
      '五臂');
  });

  it('M13 B13：猩红回统一紫 → 三色夹具红', () => {
    mutate(RENDERER,
      "ctx.fillStyle = '#FF6464';   // (255,100,100) 猩红",
      "ctx.fillStyle = '#C060FF'; /* BJ739A-M13 变异 */",
      '三色字面量');
  });

  it('M14 B18：摘坡面门 → 结构锁红', () => {
    mutate(RENDERER,
      'const slopeOk = st.slope[i] === 0 && !(st.wire[i] & 32);   // slope==0 && !inActive',
      'const slopeOk = true; /* BJ739A-M14 变异 */',
      'B18 门源锚');
  });
});
