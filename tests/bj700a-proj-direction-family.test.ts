// ★BJ700-A（2026-10-20）弹 408 迷你鲨鱼龙 / 662·685 DD2 敌对标枪 贴图方向族判别锁。
// 用户实报：①暴风雨法杖 407 鲨卷射出的 408 贴图方向不对；②旧日军团标枪投掷怪
// （NPC 561/563）掷出的 662 方向不对。
//
// 定谳（1457 反编译锚,探针 scripts/_bj700a-proj-direction.mjs 像素对拍双证）：
//  · 408：AI_001 尾分派 Projectile.cs:58616-58621 `rotation = ToRotation() +
//    (direction == -1 ? π : 0)` + :55962-55967 spriteDirection = direction；
//    direction 由 Update :17122-17130（AutomaticallyChangesDirection :17387,
//    aiStyle 1 不在排除表）每拍 `vx<0 ? -1 : 1` 维护；DrawProjDirect
//    Main.cs:30530-30534 FlipHorizontally + :30606 R(rotation)∘M → 朝右贴图 +
//    左飞水平镜像（837/270 族同型）→ 入 PROJ_ROT_RIGHT。曾落缺省支 ang+π/2
//    恒不镜像 = 90° 横转+左飞上下颠倒。
//  · 662/685：AI_001 尾 :58626-58629 `rotation = ToRotation() − π − π/4`,
//    全程无 spriteDirection 写（507/508/662/680/685 家族块 :58453-58460 只做
//    ai[0]>60 后 vx×0.98+vy+0.3）→ 贴图固有 225°（左上矛头,Projectile_662.png
//    像素物证 42×42 对角条宽刃尖在 TL）恒不翻转 → PROJ_ROT_NW。曾落缺省支
//    恒偏 45°。
//  · 408 帧：Main.projFrames[408]=2（Main.cs:8662）但 AI 无帧推进支 → frame 恒 0
//    （通用 age/5 翻帧=伪影）→ PROJ_FRAME_STATIC0。
//  · 408 ghost（TrailingMode[408]=0,ProjectileID.cs:385）：mode0 ghost 角=本体
//    proj.rotation（Main.cs:31333）且 :31334 `SpriteEffects spriteEffects = dir`
//    =恒吃本体当前翻转——本仓 mode0 原无翻转通道,mirror 选项本刀补。
//  · 408 重力：AI_001 :58346-58351 ai[0]≥45 后 vy+=0.05/t（AI1_GRAV[408]=[0.05,45]）;
//    shootMinionShot `grav ?? 0` 显式 0 绕过规格链=死键（1097 同型,ctor 判例）。
// 判别力（变异恰红）：408 摘出 PROJ_ROT_RIGHT → [B] 红;662/685 摘出 PROJ_ROT_NW
//   （回落缺省 +π/2）→ [C] 红;帧钉摘除 → [A2] 红;ghost bodyRot 退回 ang+π/2 或
//   mirror 摘除 → [D] 红;drawProjGhosts mirror 通道摘除 → [E] 红;ctor 408 回落
//   摘除 → [F] 红。
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Arrow, PROJ_ROT_RIGHT, PROJ_ROT_NW, PROJ_FRAME_STATIC0, setProjSpriteOverride, projFrameCount,
} from '../src/entities/Arrow';
import { ProjGhostRing, drawProjGhosts } from '../src/entities/projGhostTrail';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

// ---------------------------------------------------------------- hooks 桩（BJ375 同款）
function mkHooks() {
  const g = {
    world: { store: new TileStore(400, 400) } as never,
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
    spawnDust: () => null,
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as unknown as GameHooks;
  return g;
}

// ---------------------------------------------------------------- 记录型 ctx（BJ375 同款）
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
/** 烘焙画布桩（tintedTex 消费面,BJ375 同款） */
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

const PI = Math.PI;

/** 本体绘制姿态提取：无贴图环境下 draw 仍落 rotate/scale（旋转提出贴图卫门外判例） */
function bodyPose(vx: number, vy: number, projId: number) {
  const a = new Arrow(1600, 1600, vx, vy, 40, 2, projId, { grav: 0 });
  const { calls, r } = makeR();
  a.draw(r as never, {} as never);
  const rots = calls.filter((c) => c.m === 'rotate').map((c) => c.a[0] as number);
  const mirrors = calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
  return { rots, mirrors };
}

describe('BJ700-A ①408 迷你鲨鱼龙（PROJ_ROT_RIGHT 朝右镜像族）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[A1] 408 入 PROJ_ROT_RIGHT;662/685 不在（两族互斥,缺省族不入表）', () => {
    expect(PROJ_ROT_RIGHT.has(408)).toBe(true);
    expect(PROJ_ROT_RIGHT.has(662)).toBe(false);
    expect(PROJ_ROT_RIGHT.has(685)).toBe(false);
  });

  it('[A2] 408 帧钉：PROJ_FRAME_STATIC0 在场且 projFrames=2（原版无推进支恒帧 0）', () => {
    expect(PROJ_FRAME_STATIC0.has(408)).toBe(true);
    expect(projFrameCount(408)).toBe(2);   // Main.projFrames[408]=2（Main.cs:8662）
  });

  it('[B] 本体四向：右/上/下 = 裸速度角无镜像;左 = scale(-1,1)+rotate(π−ang)'
    + '（P.cs:58616-58621 + Update :17122-17130 direction=vx<0）', () => {
    // 对角速度（防 0/π 巧合值）
    const ang = Math.atan2(-6, 8);                 // ≈ -0.6435（右向）
    // 右上对角：rotate(ang)，无镜像
    const R = bodyPose(8, -6, 408);
    expect(R.rots).toHaveLength(1);
    expect(R.rots[0]).toBeCloseTo(ang, 6);
    expect(R.mirrors).toBe(0);
    // 左上对角：先镜像再旋转（≡原版 R(ang+π)∘M）——ang 取左向速度角
    const angL = Math.atan2(-6, -8);               // ≈ -2.4981
    const L = bodyPose(-8, -6, 408);
    expect(L.mirrors).toBe(1);
    expect(L.rots).toHaveLength(1);
    expect(L.rots[0]).toBeCloseTo(PI - angL, 6);
    // 纯上：rotate(−π/2) 无镜像
    const U = bodyPose(0, -8, 408);
    expect(U.rots[0]).toBeCloseTo(-PI / 2, 6);
    expect(U.mirrors).toBe(0);
    // 纯下：rotate(π/2) 无镜像
    const D = bodyPose(0, 8, 408);
    expect(D.rots[0]).toBeCloseTo(PI / 2, 6);
    expect(D.mirrors).toBe(0);
  });

  it('[D] ghost（TrailingMode=0）：角随本体（左飞 +π）+ mode0 镜像 + 帧行 n408（行+1）'
    + '（Main.cs:31333-31334 + P.cs:30655-30657）', () => {
    const g = mkHooks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const a = new Arrow(1600, 1600, -15, -5, 40, 2, 408, { grav: 0 });
    for (let t = 0; t < 10; t++) a.fixedUpdate(1 / 60, g);   // 环填槽 + α 255→0
    setProjSpriteOverride(408, fakeImg(54, 56) as unknown as ImageBitmap);
    const doc = stubDocWithRecordingCanvases();
    try {
      const { calls, r } = makeR();
      a.draw(r as never, {} as never);
      const ang = Math.atan2(-5, -15);
      // ghost 槽：9 参 drawImage（源矩形整图）,帧行 'n408' → sy=28（行+1 非帧系）
      const ghost = calls.filter((c) => c.m === 'drawImage' && (c.a.length ?? 0) >= 9);
      expect(ghost.length).toBeGreaterThanOrEqual(1);
      for (const c of ghost) {
        expect(c.a[1]).toBe(0);        // sx
        expect(c.a[2]).toBe(28);       // sy = sh（:30655-30657 rect.Y=num161 行+1）
        expect(c.a[3]).toBe(54);       // sw
        expect(c.a[4]).toBe(28);       // sh = 56/2
      }
      // ghost 旋转 = ang+π（本体 proj.rotation :58616-58621 左飞 +π 档）
      const ghostRots = ghost.length
        ? (() => {
            // 每个 ghost 槽 save→translate→rotate 序：从 calls 序列里按 drawImage 前溯
            const rots: number[] = [];
            for (let i = 0; i < calls.length; i++) {
              if (calls[i].m === 'drawImage' && (calls[i].a.length ?? 0) >= 9) {
                for (let j = i - 1; j >= 0; j--) {
                  if (calls[j].m === 'rotate') { rots.push(calls[j].a[0] as number); break; }
                  if (calls[j].m === 'save') break;
                }
              }
            }
            return rots;
          })()
        : [];
      expect(ghostRots.length).toBe(ghost.length);
      for (const v of ghostRots) expect(v).toBeCloseTo(ang + PI, 6);
      // 镜像：本体 1 次 + 每 ghost 槽 1 次（mode0 mirror :31334 spriteEffects=dir）
      const mirrors = calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
      expect(mirrors).toBe(1 + ghost.length);
    } finally {
      doc.restore();
    }
  });

  it('[F] 重力回落：显式 grav:0 → 规格 [0.05,45]（:58346-58351;1097 同型判例）', () => {
    const a = new Arrow(0, 0, 8, 0, 10, 0, 408, { grav: 0, life: 300 });
    expect(a.grav).toBeCloseTo(0.05, 6);
    expect((a as unknown as { gravDelay: number }).gravDelay).toBe(45);
    // 缺省（无 opts.grav）同规格
    const b = new Arrow(0, 0, 8, 0, 10, 0, 408);
    expect(b.grav).toBeCloseTo(0.05, 6);
    // 显式非 0 调用方档不动
    const c = new Arrow(0, 0, 8, 0, 10, 0, 408, { grav: 0.3 });
    expect(c.grav).toBeCloseTo(0.3, 6);
    expect((c as unknown as { gravDelay: number }).gravDelay).toBe(-1);
    // 非 408/1097 显式 0 不回落（改动面回归闸）
    const d = new Arrow(0, 0, 8, 0, 10, 0, 376, { grav: 0 });
    expect(d.grav).toBe(0);
    expect((d as unknown as { gravDelay: number }).gravDelay).toBe(-1);
  });
});

describe('BJ700-A ②662/685 DD2 敌对标枪（PROJ_ROT_NW 225° 固有朝向族）', () => {
  it('[A] 成员表：662/685 在 PROJ_ROT_NW;408/缺省族不在', () => {
    expect(PROJ_ROT_NW.has(662)).toBe(true);
    expect(PROJ_ROT_NW.has(685)).toBe(true);
    expect(PROJ_ROT_NW.has(408)).toBe(false);
    expect(PROJ_ROT_NW.has(1)).toBe(false);
    expect(PROJ_ROT_NW.has(14)).toBe(false);
  });

  it('[C] 本体四向：rotate(ang − π − π/4) 恒无镜像（P.cs:58626-58629;无 spriteDirection 写）', () => {
    for (const pid of [662, 685]) {
      const R = bodyPose(8, 0, pid);
      expect(R.rots).toHaveLength(1);
      expect(R.rots[0]).toBeCloseTo(-PI - PI / 4, 6);
      expect(R.mirrors).toBe(0);
      const L = bodyPose(-8, 0, pid);
      expect(L.rots[0]).toBeCloseTo(PI - PI - PI / 4, 6);   // = −π/4
      expect(L.mirrors).toBe(0);
      const U = bodyPose(0, -8, pid);
      expect(U.rots[0]).toBeCloseTo(-PI / 2 - PI - PI / 4, 6);
      expect(U.mirrors).toBe(0);
      const D = bodyPose(0, 8, pid);
      expect(D.rots[0]).toBeCloseTo(PI / 2 - PI - PI / 4, 6);
      expect(D.mirrors).toBe(0);
    }
  });

  it('[E] drawProjGhosts mirror 通道：mode0 传入 → scale(-1,1);缺省 → 无（Main.cs:31334）', () => {
    const ring = new ProjGhostRing(408);
    for (let i = 0; i < 10; i++) ring.record(100 + i, 100, 0, 1, false);   // 灌足 loop 窗（i=1..7）
    const tex = fakeImg(54, 56);
    const doc = stubDocWithRecordingCanvases();
    try {
      const run = (mirror?: boolean) => {
        const { calls, r } = makeR();
        drawProjGhosts((r as unknown as { ctx: CanvasRenderingContext2D }).ctx, {
          ring, id: 408, tex: tex as unknown as never, frames: 2, frame: 0,
          bodyW: 10, bodyH: 10, bodyRot: PI, bodyScale: 1, bodyAlpha: 1,
          ai0: 0, ai1: 0, timeLeft: 300, opacity: 1, vxLen: 15, spriteDirection: -1,
          ...(mirror !== undefined ? { mirror } : {}),
        });
        return calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
      };
      expect(run(true)).toBeGreaterThanOrEqual(1);   // mirror=true → 每槽镜像
      expect(run(false)).toBe(0);                    // 显式 false → 不镜像
      expect(run()).toBe(0);                          // 缺省（旧调用面）→ 不镜像（零改动面）
    } finally {
      doc.restore();
    }
  });
});
