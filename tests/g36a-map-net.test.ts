// ★G36-A（2026-10-31，BJ738 登记债清偿）判别锁 C：地图图标/层序/MP 面。
// 覆盖：BJ738 D1（小地图双支图标——mapStyle1 角框 + mapStyle2 覆盖图 + 全图
//       drawScale 三档与悬停）、D3（msg13 双锚 + sitting 同步/远端门渲染接线）、
//       D5（门层序坐/站双档 + 远端 opacity 0.1）。
// 标杆：Terarria1457（Main.cs:56443-56453/:56524-56534/:56746-56754/:57315-57368;
//       NetMessage.cs:461-509;ReturnGatePlayerRenderer.cs:51-72;Main.cs:22488-22514）。
// 变异恰红（withMutation）在同文件 M 组。
import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMutation } from './mutation-guard';
import { Renderer } from '../src/render/Renderer';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { VanillaClient } from '../src/net/vanilla/VanillaClient';
import { VWriter, VReader, MsgId } from '../src/net/vanilla/codec';

afterEach(() => { vi.restoreAllMocks(); });

beforeAll(() => {
  // Renderer 构造链需要浏览器全局（bj739a-render 同款替身;Extra 贴图 28×30 形状）
  (globalThis as Record<string, unknown>).Image = class {
    src = ''; onload: (() => void) | null = null;
    width = 28; height = 30;
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

// ============ D1：drawPotionOfReturnMapIcons 共用体（:57315-57368） ============

type DrawCall = { img: unknown; x: number; y: number; w: number; h: number };
const mkCtx = (calls: DrawCall[]): CanvasRenderingContext2D => ({
  drawImage: (img: unknown, x: number, y: number, w: number, h: number) => { calls.push({ img, x, y, w, h }); },
} as unknown as CanvasRenderingContext2D);

const drawIcons = (
  player: Player, iconScale: number,
  toX: (wx: number) => number, toY: (wy: number) => number,
  clipRect: { x: number; y: number; w: number; h: number } | null,
  mouse: { x: number; y: number } | null,
): { calls: DrawCall[]; hover: string | null } => {
  const calls: DrawCall[] = [];
  const ctx = mkCtx(calls);
  const hover = (Renderer.prototype as unknown as {
    drawPotionOfReturnMapIcons(
      ctx: CanvasRenderingContext2D, player: Player, iconScale: number,
      toX: (wx: number) => number, toY: (wy: number) => number,
      clipRect: { x: number; y: number; w: number; h: number } | null,
      mouse: { x: number; y: number } | null,
    ): string | null;
  }).drawPotionOfReturnMapIcons.call(null as never, ctx, player, iconScale, toX, toY, clipRect, mouse);
  return { calls, hover };
};

const mkPlayer = (anchors?: { home?: { x: number; y: number }; exit?: { x: number; y: number } }): Player => {
  const p = new Player(0, 0, new Inventory());
  p.potionOfReturnHomePosition = anchors?.home ?? null;
  p.potionOfReturnOriginalUsePosition = anchors?.exit ?? null;
  return p;
};

describe('G36-A D1：地图图标共用体（位/缩放/裁剪/悬停）', () => {
  it('双锚 → 两图标（175 家门先/173 出口后,28×30×iconScale,位=Floor(锚−h/2 变换)）', () => {
    const p = mkPlayer({ home: { x: 1000, y: 2000 }, exit: { x: 500, y: 800 } });
    const zoom = 2;
    const { calls } = drawIcons(p, 1.1,
      (wx) => 100 + wx / 16 * zoom, (wy) => 60 + wy / 16 * zoom, null, null);
    expect(calls.length).toBe(2);
    expect((calls[0]!.img as { src: string }).src).toContain('Extra_175');
    expect((calls[1]!.img as { src: string }).src).toContain('Extra_173');
    // home (1000, 2000−21)：mx=floor(100+1000/16×2)=225 / my=floor(60+1979/16×2)=307
    expect(calls[0]!.x).toBe(225 - 28 * 1.1 / 2);
    expect(calls[0]!.y).toBe(307 - 30 * 1.1 / 2);
    expect(calls[0]!.w).toBeCloseTo(28 * 1.1, 6);
    expect(calls[0]!.h).toBeCloseTo(30 * 1.1, 6);
    // exit (500, 800−21)：mx=floor(100+500/16×2)=162 / my=floor(60+779/16×2)=157
    expect(calls[1]!.x).toBe(162 - 28 * 1.1 / 2);
    expect(calls[1]!.y).toBe(157 - 30 * 1.1 / 2);
  });
  it('单锚（home 缺）→ 只画出口', () => {
    const p = mkPlayer({ exit: { x: 500, y: 800 } });
    const { calls } = drawIcons(p, 1, (wx) => wx, (wy) => wy, null, null);
    expect(calls.length).toBe(1);
    expect((calls[0]!.img as { src: string }).src).toContain('Extra_173');
  });
  it('mapRect 界检（:57333 中心点 Contains——界外不画）', () => {
    const p = mkPlayer({ home: { x: 1000, y: 2000 }, exit: { x: 500, y: 800 } });
    const toX = (wx: number) => wx / 16, toY = (wy: number) => wy / 16;
    const inRect = drawIcons(p, 1, toX, toY, { x: 0, y: 0, w: 200, h: 200 }, null);
    expect(inRect.calls.length).toBe(2);        // home(62,123)/exit(31,48) 界内
    const outRect = drawIcons(p, 1, toX, toY, { x: 0, y: 0, w: 20, h: 20 }, null);
    expect(outRect.calls.length).toBe(0);       // 双双界外（exit(31,48)/home(62,123) 均出窗）
  });
  it('悬停盒 = CenteredRectangle(vec, size×iconScale)（:57338）;家门支先写不被出口覆盖', () => {
    const p = mkPlayer({ home: { x: 1000, y: 2000 }, exit: { x: 500, y: 800 } });
    const toX = (wx: number) => wx / 16, toY = (wy: number) => wy / 16;
    // 家门图标中心 = (floor(1000/16), floor(1979/16)) = (62, 123)——node 环境
    // Lang.text 未载 l10n 产物 → 回退键名（浏览器态解析为「返回传送门入口」）
    const hit = drawIcons(p, 1, toX, toY, null, { x: 62, y: 123 });
    expect(hit.hover).toBe('GameUI.PotionOfReturnHomePortal');
    const miss = drawIcons(p, 1, toX, toY, null, { x: 90, y: 123 });
    expect(miss.hover).toBeNull();
  });
  it('drawScale 三档结构锁（mapStyle1 无 UIScale / mapStyle2 ×UIScale / 全图 1.1）', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'render', 'Renderer.ts'), 'utf8');
    // mapStyle1（:56526-56531 num48=(zoom×0.5+1)/3 钳 1,无 UIScale）
    expect(src).toContain('Math.min(1, (this.minimapZoom * 0.25 * 2 + 1) / 3),');
    // mapStyle2（:56445-56450 num39=(zoom×0.4+1)/3 钳 1 ×UIScale——与头像同式 ≥2 处）
    expect((src.match(/Math\.min\(1, \(s \* 0\.2 \* 2 \+ 1\) \/ 3\) \* 1\.1/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
    // 全图（:56746-56752 终值 UIScale=1.1）
    expect(src).toContain('drawPotionOfReturnMapIcons(ctx, p, 1.1,');
  });
});

// ============ D5：门层序坐/站双档 + D3 远端门 ============

describe('G36-A D5/D3：门层序结构与远端门接线（结构锁）', () => {
  it('坐/睡双档：2c层位画坐组（BehindNPCs）/ drawPlayer 前画站组（AfterProjectiles）', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'render', 'Renderer.ts'), 'utf8');
    const iBehind = src.indexOf('if (player.sitting || player.sleeping) {\n      this.drawPotionOfReturnGates(player, cam, viewW, viewH, z);\n    }');
    const iStanding = src.indexOf('if (!(player.sitting || player.sleeping)) {\n      this.drawPotionOfReturnGates(player, cam, viewW, viewH, z);\n    }');
    const iDrawPlayer = src.indexOf('if (!directorPlayerHidden()) this.drawPlayer(player, world, swing, flicker);');
    expect(iBehind).toBeGreaterThan(0);
    expect(iStanding).toBeGreaterThan(0);
    expect(iStanding).toBeGreaterThan(iBehind);         // 站组调用在后（玩家绘制段）
    expect(iDrawPlayer).toBeGreaterThan(iStanding);     // 站组门在玩家本体之前（组内序）
  });
  it('远端门：opacity 0.1 + 坐/站同分组（ReturnGatePlayerRenderer.cs:69）', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'render', 'Renderer.ts'), 'utf8');
    expect((src.match(/drawPotionOfReturnGates\(rp, cam, viewW, viewH, z, 0\.1\);/g) ?? []).length).toBe(2);
    expect(src).toContain('private drawPotionOfReturnGates(\n    player: Player | null, cam: Camera, viewW: number, viewH: number, z: number,\n    /** ★G36-A D3：远端玩家门 opacity');
  });
});

// ============ D3：msg13 双锚 + sitting 同步（NetMessage.cs:461-509） ============

describe('G36-A D3：msg13 双锚/sitting 同步', () => {
  it('reader：bitsByte23[2]/[6] + 尾段 f32×4 → 代理镜像', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    const frame = new VWriter()
      .u8(3)                    // slot
      .u8(0).u8(0)              // c1/c2
      .u8(0x44)                 // c3 = [2]sitting | [6]porAnchors
      .u8(0)                    // c4
      .u8(0)                    // sel
      .f32(100).f32(200)        // pos
      .f32(11.5).f32(22.5)      // OriginalUse
      .f32(33.5).f32(44.5)      // Home
      .finish(MsgId.PlayerControls);
    (vc as unknown as { handle(id: number, payload: Uint8Array): void })
      .handle(MsgId.PlayerControls, frame.slice(3));
    const rp = (vc as unknown as { players: Map<number, { sitting: boolean; porAnchors: { exit: { x: number; y: number }; home: { x: number; y: number } } | null }> }).players.get(3);
    expect(rp).toBeDefined();
    expect(rp!.sitting).toBe(true);
    expect(rp!.porAnchors).toEqual({ exit: { x: 11.5, y: 22.5 }, home: { x: 33.5, y: 44.5 } });
  });
  it('reader：无 [6] 位 → porAnchors null（清空拍语义）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    const frame = new VWriter().u8(4).u8(0).u8(0).u8(0).u8(0).u8(0)
      .f32(1).f32(2).finish(MsgId.PlayerControls);
    (vc as unknown as { handle(id: number, payload: Uint8Array): void })
      .handle(MsgId.PlayerControls, frame.slice(3));
    const rp = (vc as unknown as { players: Map<number, { sitting: boolean; porAnchors: unknown }> }).players.get(4);
    expect(rp!.sitting).toBe(false);
    expect(rp!.porAnchors).toBeNull();
  });
  it('writer：双锚在场 → c3[2]/[6] + 尾段四 f32 逐位回环', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    (vc as unknown as { mySlot: number }).mySlot = 2;
    (vc as unknown as { game: unknown }).game = {
      player: {
        x: 100, y: 200, vx: 0, vy: 0, facing: 1,
        inputX: 0, inputUp: false, inputDown: false, inputJump: false,
        gravDir: 1, dead: false, mount: {},
        inv: { selected: 0 },
        sitting: true,
        potionOfReturnOriginalUsePosition: { x: 11.5, y: 22.5 },
        potionOfReturnHomePosition: { x: 33.5, y: 44.5 },
      },
    };
    const sent: Uint8Array[] = [];
    (vc as unknown as { send(f: Uint8Array): void }).send = (f: Uint8Array) => { sent.push(f); };
    (vc as unknown as { sendControls13(): void }).sendControls13();
    expect(sent.length).toBe(1);
    const r = new VReader(sent[0]!);
    expect(r.u16()).toBe(sent[0]!.length);   // frameLen 全帧长含头
    expect(r.u8()).toBe(MsgId.PlayerControls);
    expect(r.u8()).toBe(2);                  // slot
    r.u8(); r.u8();                          // c1/c2
    const c3 = r.u8();
    expect(c3 & 0x04).toBeTruthy();          // [2] sitting
    expect(c3 & 0x40).toBeTruthy();          // [6] porAnchors
    r.u8(); r.u8();                          // c4/sel
    expect(r.f32()).toBe(100);
    expect(r.f32()).toBe(200);
    expect(r.f32()).toBe(11.5);              // OriginalUse.x
    expect(r.f32()).toBe(22.5);
    expect(r.f32()).toBe(33.5);              // Home.x
    expect(r.f32()).toBe(44.5);
    expect(r.remaining).toBe(0);             // 编码语义自证
  });
  it('writer：无锚 → 无 [6] 位无尾段（清空拍只清位）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    (vc as unknown as { mySlot: number }).mySlot = 2;
    (vc as unknown as { game: unknown }).game = {
      player: {
        x: 1, y: 2, vx: 0, vy: 0, facing: 1,
        inputX: 0, inputUp: false, inputDown: false, inputJump: false,
        gravDir: 1, dead: false, mount: {},
        inv: { selected: 0 },
        sitting: false,
        potionOfReturnOriginalUsePosition: null,
        potionOfReturnHomePosition: null,
      },
    };
    const sent: Uint8Array[] = [];
    (vc as unknown as { send(f: Uint8Array): void }).send = (f: Uint8Array) => { sent.push(f); };
    (vc as unknown as { sendControls13(): void }).sendControls13();
    const r = new VReader(sent[0]!);
    r.u16(); r.u8(); r.u8(); r.u8(); r.u8();
    expect(r.u8() & 0x40).toBe(0);
    r.u8(); r.u8();
    r.f32(); r.f32();
    expect(r.remaining).toBe(0);
  });
});

// ============ 变异恰红 ============

const spawnVitest = (filter: string) => spawnSync(
  'npx', ['vitest', 'run', 'tests/g36a-map-net.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, SW_G36A_MUT: '1' },
  },
);
const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
  withMutation(file, trigger, replacement, () => {
    const r = spawnVitest(filter);
    expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
    expect(r.stdout).toContain(filter);
  }, { label: `G36-A map-net ${filter}` });
};

describe('G36-A 变异恰红（地图/MP 面）', () => {
  it('M9 D5：站组门调用摘除 → 层序结构锁红', () => {
    mutate(join(process.cwd(), 'src', 'render', 'Renderer.ts'),
      'if (!(player.sitting || player.sleeping)) {\n      this.drawPotionOfReturnGates(player, cam, viewW, viewH, z);\n    }',
      'if (!(player.sitting || player.sleeping)) {\n      /* G36 mut */ }',
      '门层序结构与远端门接线');
  });
  it('M10 D1：mapStyle1 drawScale 换 mapStyle2 档（0.5→0.4）→ 三档结构锁红', () => {
    mutate(join(process.cwd(), 'src', 'render', 'Renderer.ts'),
      'Math.min(1, (this.minimapZoom * 0.25 * 2 + 1) / 3),',
      'Math.min(1, (this.minimapZoom * 0.2 * 2 + 1) / 3),',
      'drawScale 三档结构锁');
  });
  it('M11 D3：writer 摘 [6] 位 → 回环夹具红', () => {
    mutate(join(process.cwd(), 'src', 'net', 'vanilla', 'VanillaClient.ts'),
      'const c3 = (p.sitting ? 4 : 0) | (porOn ? 0x40 : 0);',
      'const c3 = (p.sitting ? 4 : 0);',
      'writer：双锚在场');
  });
});
