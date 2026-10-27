// ★四柱掉帧定谳批（2026-09-25）主犯②锁：原版 NPC 视域剔除（Renderer.npcOffscreen
// ——Main.cs:22534 rectangle + :22653 Intersects + NPCID.cs:4877 MustAlwaysDraw 移植）。
// 红（旧码）：drawEnemy 全场无剔除——4 塔全离屏仍逐帧跑 SM2 盾泡（far 档 14ms/帧）。
// 绿（本批）：屏外实体剔除;MustAlwaysDraw{113-116,125,126} 白名单族恒画;?npccull=0
//   逃生门回旧行为。变异判别：摘白名单支 → b) 红;摘 Intersects 半开语义 → a) 边界
//   红翻;摘 behindTiles 门 → e) 结构锁红。
// 坐标基準：cam 中心 (0,0)、viewW=1600/viewH=900、zoom=1 → 可视世界
// [−800,800)×[−450,450)，剔除域 = 可视 ±800 = [−1600,1600)×[−1250,1250)
// （vanilla rectangle=[screenPosition−800, +screenW+1600) 同式）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

let Renderer: typeof import('../src/render/Renderer').Renderer;
let Camera: typeof import('../src/render/Camera').Camera;

beforeAll(async () => {
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
  ({ Renderer } = await import('../src/render/Renderer'));
  ({ Camera } = await import('../src/render/Camera'));
  Renderer.npcCullSetForTest(true);
}, 120000);

const r = () => new Renderer(null as never);
type Enemy = import('../src/entities/Enemy').Enemy;
const mkEnemy = (id: number | null, x: number, y: number, w = 40, h = 56): Enemy =>
  ({ vanillaId: id, x, y, w, h } as unknown as Enemy);
const mkCam = (x = 0, y = 0, zoom = 1): import('../src/render/Camera').Camera => {
  const c = new Camera(4200, 1200);
  c.x = x; c.y = y; c.zoom = zoom;
  return c;
};
const off = (e: Enemy, cam: import('../src/render/Camera').Camera, z = 1, vw = 1600, vh = 900): boolean =>
  (r() as unknown as { npcOffscreen(e: Enemy, cam: import('../src/render/Camera').Camera, z: number, vw: number, vh: number): boolean })
    .npcOffscreen(e, cam, z, vw, vh);

describe('四柱掉帧批②：原版 NPC 视域剔除（Main.cs:22534/:22653 移植）', () => {
  it('屏内画/±800 fluff 内画/超域剔除/半开边界（XNA Intersects 语义）', () => {
    const cam = mkCam(0, 0);
    expect(off(mkEnemy(422, 0, 0, 40, 56), cam)).toBe(false);            // 屏内
    expect(off(mkEnemy(422, 1500, 400, 40, 56), cam)).toBe(false);       // 屏外但在右 +800 fluff 内（1500<1600）
    expect(off(mkEnemy(422, 1600, 400, 40, 56), cam)).toBe(true);        // 右邻接=半开剔除（x<1600 不成立）
    expect(off(mkEnemy(422, 1599, 400, 40, 56), cam)).toBe(false);       // 左缘 1599<1600 相交=画
    expect(off(mkEnemy(422, -1640, 0, 40, 56), cam)).toBe(true);         // 左侧超域（x+w=−1600 不 > L=−1600）
    expect(off(mkEnemy(422, -1639, 0, 40, 56), cam)).toBe(false);        // 左侧 fluff 内
    expect(off(mkEnemy(422, 0, 1300, 40, 56), cam)).toBe(true);          // 下方超域（y=1300 ≥ T+RH=1250）
    expect(off(mkEnemy(422, 0, 1200, 40, 56), cam)).toBe(false);         // 下方 fluff 内
  });

  it('MustAlwaysDraw{113,114,115,116,125,126} 白名单族全离屏仍画（NPCID.cs:4877 1:1;非白名单同位=剔）', () => {
    const cam = mkCam(0, 0);
    for (const id of [113, 114, 115, 116, 125, 126]) {
      expect(off(mkEnemy(id, 50000, 50000, 40, 56), cam)).toBe(false);
    }
    expect(off(mkEnemy(422, 50000, 50000, 40, 56), cam)).toBe(true);     // 柱 422 无白名单
    expect(off(mkEnemy(null, 50000, 50000, 40, 56), cam)).toBe(true);    // 非 vanilla 实体同门
  });

  it('zoom 换算：zoom=2 可视世界宽减半（[−400,400)）,fluff 恒 ±800 世界 px → 域 [−1200,1200)', () => {
    const cam = mkCam(0, 0, 2);
    expect(off(mkEnemy(422, 1100, 0, 40, 56), cam, 2, 1600, 900)).toBe(false);
    expect(off(mkEnemy(422, 1300, 0, 40, 56), cam, 2, 1600, 900)).toBe(true);
  });

  it('?npccull=0 逃生门：总闸关=恒画（回全场无剔除旧行为,AB 对拍面）', () => {
    Renderer.npcCullSetForTest(false);
    try {
      const cam = mkCam(0, 0);
      expect(off(mkEnemy(422, 50000, 50000), cam)).toBe(false);
    } finally {
      Renderer.npcCullSetForTest(true);
    }
  });

  it('结构锁：behindTiles 段+实体主段两调用点均挂门;白名单/逃生门/原版行号锚在场', () => {
    const src = readFileSync(join(__dirname, '../src/render/Renderer.ts'), 'utf8');
    expect(src).toContain("this.isBehindTilesEnemy(e) && !this.npcOffscreen(e, cam, z, viewW, viewH)");
    expect(src).toContain('if (!this.npcOffscreen(e, cam, z, viewW, viewH)) this.drawEnemy(e, world, entities, cam);');   // ★BJ731 改判史:drawEnemy 增 cam 参(b782696c v0.1.70)——锁随签名
    expect(src).toContain('const NPC_MUST_ALWAYS_DRAW = new Set([113, 114, 115, 116, 125, 126]);');
    expect(src).toContain("new URLSearchParams(location.search).get('npccull') !== '0'");
    expect(src).toContain('Main.cs:22534');
    expect(src).toContain('NPCID.cs:4877');
  });
});
