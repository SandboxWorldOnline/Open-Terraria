// ★BJ703-B（2026-10-21）登记债清算判别锁：ghost 残影链 + 尘域（五件）。
//
// 定谳链（1457 反编译锚,本套件逐件锁）：
//  D1 mode2/3/4 ghost dir 基底——Main.cs:31330-31344 `SpriteEffects dir`（DrawProjDirect
//    :30530-30534 当前翻转）为基底:mode2/3/4 非豁免 = dir ^ oldSpriteDirection[i]、
//    豁免（1001/933/1100）= dir 直取、mode0/1/5 = dir 直取（:31334）。1457 全量普查
//    （AI 函数逐支）:翻转员=755（AI_156 :52446-52451）+833-835（AI_067 :50753-50970）
//    +1001（AI_194 :42056,豁免档基底直取）+818（AI_162 :47589,TigerPounce 实体无
//    ghost 绘制面）+916（AI_165 :48551,WhipProj 无 ghost 环）;其余全员（671/680/686/
//    710/711/729/811/814/872/873/931/976/977/1039/1045/1097/864…）原版 AI 零
//    spriteDirection 写 → 基底恒 None、oldSpriteDirection 恒 1。
//    ★BJ704-G9 勘正（2026-10-21）:533 系 mode0（TrailingMode=0,ProjectileID.cs:385）
//    非本列（mode2/3/4）成员,旧列误并;「:30712 spriteDirection=direction 属
//    aiStyle-66 块尾」亦系结构误植（实属 aiStyle-68 块尾 :30654-30729,成员 399/669;
//    aiStyle-66 块 :30084-30649 零 spriteDirection 写）⇒ 387/388/533 幽灵恒不翻=
//    仓内 mirror 恒 false 1:1 正确,R1-P1-2 销案（详 projGhostTrail.ts mirror 参数注）。
//    旧债登记①「镜像特异 id 未在活动集」证伪（755/833-835 活跃且翻转）——记录面
//    同刀收编（Arrow/Dart 记 1;MinionProj 翻转员记 facing、余记 1）。
//  D2 mode0 其余 spriteDirection=direction 成员——AI_001 尾分派 :58622-58627
//    `435||459||682||709 → ToRotation+(direction==-1?π:0)` + 专属块 spriteDirection=
//    direction（435 :55886/682 :55922/459 :55621/709 :55666）+ :58579-58589
//    `270||585||601||706||837`（585/601/706 贴图非对称 92-93%）。像素普查（逐帧
//    水平镜像差）:435 61-90%/459 73-80%/585 92-100%/601 79-93%/682 61-90%/706 78-92%/
//    709 73-80% 非对称=翻转可见;684 1%（扩散环对称）=不可见 → 判语销案。
//    载体普查:435/682 走 Arrow（ghost 通用表活面）→ 修;459（PrismProj ChargedBlaster）
//    /585（TownShot,本体已 mirror-right）/601（PortalGunBolt）/706（PhoenixBowProj）/
//    709（SkyDragonFury）专属实体【无 ghost 环】→ ghost 整体缺面=另立登记非本债。
//  D3 orchestraFx 白影 CloneDust 化——ParticleOrchestrator.cs 四站亲读:
//    rainbowRodHit :3505-3508/princess :3404-3407/stardust :3454-3457/rainbowBoulder3
//    :1643-1648（+noLightEmittance 显式重置——CloneDust 字段表 :273-286 不含）全为
//    Dust.CloneDust(scale÷2/fadeIn×0.75/color 白）;formatC :3703-3763【无】CloneDust
//    （白核=FadingParticle 双层,本仓 spawnParticles 已承载）=债单误记,销案。
//    旧手工 spawnDust 重掷克隆=速度 ±2/scale ±2%/帧变体 267 三独立抖动近似。
//  D4 whipHueClock——原版两消费位（DrawWhip_RainbowWhip :37361/915 AI 尘 :48741）均读
//    theOwner.miscCounterNormalized（Player.cs:3373 = miscCounter/300,wrap 300
//    :29529-29532 → 5s/60fps 循环）;旧 performance.now()/5000=暂停/菜单相位漂移。
//  D5 WhipProj drawWhipFrame flatten——BJ371/BJ700-C 判例族:透明域贴图 multiply 摊平
//    =不透明染色底,'lighter' 全幅加=染色方片。鞭贴图透明域像素实测:915 81%/1034 75%/
//    1104 67%/Glow_358 86%/FishingLine 83% → A=0 档与中间档 add 笔 flatten=true 均
//    保形化（flatten=false,数学= XNA 预乘逐项:贡献=染色×tex.a,透明域贡献 0）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  Arrow, PROJ_ROT_RIGHT, PROJ_GHOST_MIRROR0, setProjSpriteOverride, projFrameCount,
} from '../src/entities/Arrow';
import { ProjGhostRing, drawProjGhosts, PROJ_TRAILING_MODE } from '../src/entities/projGhostTrail';
import { MinionProj } from '../src/entities/MinionProj';
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { WhipProj } from '../src/entities/WhipProj';
import { VanillaDust } from '../src/fx/VanillaDust';
import type { VDust } from '../src/fx/VanillaDust';
import {
  rainbowRodHitFx, stardustPunchFx, princessWeaponFx, rainbowBoulderFx, formatCFx,
} from '../src/fx/orchestraFx';
import type { GameHooks } from '../src/entities/types';
import { withMutation } from './mutation-guard';

const PI = Math.PI;
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// ---------------------------------------------------------------- hooks 桩（BJ700-A/D 同款）
function mkHooks() {
  return {
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
}
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

/** 尘池 rig（bj700d 同款 + noGravity 透传 + 种子 rng） */
function makeDustRig() {
  const store = new TileStore(220, 130);
  for (let x = 0; x < 220; x++) for (let y = 104; y < 130; y++) store.setTile(x, y, 1);
  const player = new Player(50 * 16, 90 * 16, new Inventory());
  const vd = new VanillaDust();
  let s = 20261021;
  const rng = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => [],
    critters: () => [],
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
    spawnDust: (x: number, y: number, w: number, h: number, type: number, sx: number, sy: number, alpha: number, color: unknown, scale: number, noGravity: boolean) => {
      const d = vd.spawn(x, y, w, h, type, sx, sy, alpha, color as VDust['color'], scale);
      if (d && noGravity) d.noGravity = true;
      return d;
    },
    cloneDust: (d: VDust) => vd.clone(d),
    entities: { projectiles: [], add: () => {} },
  } as never;
  return { hooks, player, vd, rng };
}

/** drawProjGhosts 镜像笔计数（scale(-1,1)） */
function ghostMirrorCount(ring: ProjGhostRing, id: number, dirRecords: number[], mirror?: boolean): number {
  const doc = stubDocWithRecordingCanvases();
  try {
    const { calls, r } = makeR();
    for (const d of dirRecords) ring.record(100, 100, 0, d, false);
    drawProjGhosts((r as unknown as { ctx: CanvasRenderingContext2D }).ctx, {
      ring, id, tex: fakeImg(40, 40) as unknown as never, frames: 1, frame: 0,
      bodyW: 10, bodyH: 10, bodyRot: 0, bodyScale: 1, bodyAlpha: 1,
      ai0: 0, ai1: 0, timeLeft: 300, opacity: 1, vxLen: 5, spriteDirection: 1,
      ...(mirror !== undefined ? { mirror } : {}),
    });
    return calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
  } finally {
    doc.restore();
  }
}

// ===================== D1：mode2/3/4 ghost dir 基底 =====================
describe('BJ703-B D1 ghost dir 基底（Main.cs:31330-31344）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[A] mode2 非豁免（755 档):flip = 基底 XOR 槽 dir（四象限全表）', () => {
    expect(PROJ_TRAILING_MODE[755]).toBe(2);          // mode2（ProjectileID.cs:385）
    const ring = () => new ProjGhostRing(755);        // cap 10,loop i=5..1（P(5,0,-1,2.6);i=5 fade=0 跳笔 → 4 可绘槽）
    // 基底翻+槽正 → 全槽翻;基底正+槽正 → 不翻
    expect(ghostMirrorCount(ring(), 755, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], true)).toBe(4);
    expect(ghostMirrorCount(ring(), 755, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], false)).toBe(0);
    // 基底翻+槽翻 → 不翻（XOR 消解）;基底正+槽翻 → 全槽翻
    expect(ghostMirrorCount(ring(), 755, [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1], true)).toBe(0);
    expect(ghostMirrorCount(ring(), 755, [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1], false)).toBe(4);
  });

  it('[B] mode3 豁免员（1001 档）:flip = 基底直取,槽 dir 不消费（:31337-31341）', () => {
    expect(PROJ_TRAILING_MODE[1001]).toBe(3);         // mode3 豁免（:31340 条件负）
    const ring = () => new ProjGhostRing(1001);       // cap 12,loop i=10,8,6,4,2（i=10 fade=0 跳笔 → 4 可绘槽）
    // 槽 dir=-1 且基底翻 → 翻（旧豁免=恒不翻,1001 左飞缺镜像）;基底正 → 不翻
    expect(ghostMirrorCount(ring(), 1001, Array(12).fill(-1), true)).toBe(4);
    expect(ghostMirrorCount(ring(), 1001, Array(12).fill(-1), false)).toBe(0);
    // 槽 dir=-1 基底正 → 不翻（XOR 臂被豁免,槽值死面）
    expect(ghostMirrorCount(ring(), 1001, Array(12).fill(1), false)).toBe(0);
  });

  it('[C] mode0（408 回归闸）:flip = 基底直取（BJ700-A [E] 语义不回退）', () => {
    expect(PROJ_TRAILING_MODE[408]).toBe(0);
    const ring = () => new ProjGhostRing(408);        // cap 10,loop i=1,3,5,7（DEF）
    expect(ghostMirrorCount(ring(), 408, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], true)).toBe(4);
    expect(ghostMirrorCount(ring(), 408, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], false)).toBe(0);
  });

  it('[D] Arrow 记录面:mode2/3/4 全员 dir 恒 1（872 左飞不再假镜像）', () => {
    const g = mkHooks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const a = new Arrow(1600, 1600, -12, -5, 40, 2, 872, { grav: 0 });   // 872 mode2（Empress 虹）
    for (let t = 0; t < 5; t++) a.fixedUpdate(1 / 60, g);
    const ring = (a as unknown as { ghostRing: ProjGhostRing }).ghostRing;
    expect(ring).toBeTruthy();
    for (let i = 0; i < 4; i++) expect(ring.at(i)?.dir, `槽${i} dir 应恒 1`).toBe(1);
  });

  it('[E] MinionProj 记录面:翻转员（755/833-835）记 facing,零写位员（864/533）恒 1', () => {
    const rig = makeDustRig();
    const mk = (pid: number) =>
      new MinionProj(800, 800, pid, 10, 2, false, 0, false, () => rig.player);
    const rec = (m: MinionProj, facing: number) => {
      (m as unknown as { facing: number }).facing = facing;
      (m as unknown as { recordGhostTrail: () => void }).recordGhostTrail();
      return (m as unknown as { ghostRing: ProjGhostRing }).ghostRing.at(0)?.dir;
    };
    // 翻转员:facing 直入（AI_156/AI_067 spriteDirection 写位同源）
    expect(rec(mk(755), -1)).toBe(-1);
    expect(rec(mk(755), 1)).toBe(1);
    expect(rec(mk(833), -1)).toBe(-1);
    expect(rec(mk(835), -1)).toBe(-1);
    // 零写位员:AI_169（864）/AI_156_BatOfLight 946 支（946）原版无 spriteDirection 写
    //  → 恒 1（旧 facing 记录=假翻;533 系 mode0=dir 记录死面不测）
    expect(rec(mk(864), -1)).toBe(1);
    expect(rec(mk(946), -1)).toBe(1);
    // GHOST_FLIP_DIR 成员表精确锁
    const set = (MinionProj as unknown as { GHOST_FLIP_DIR: Set<number> }).GHOST_FLIP_DIR;
    expect([...set].sort((x, y) => x - y)).toEqual([755, 833, 834, 835]);
  });

  it('[F] Dart 记录面:dir 恒 1（811/814 原版零写位）', () => {
    const src = read('../src/entities/Dart.ts');
    const i0 = src.indexOf('recordGhostTrail(): void {');
    expect(i0).toBeGreaterThan(0);
    const seg = src.slice(i0, src.indexOf('}', src.indexOf('record(', i0)));
    expect(seg).toContain('this.rot, 1, this.subIsHead');
    expect(seg).not.toMatch(/this\.dir \|\| 1/);
  });
});

// ===================== D2：mode0 其余 spriteDirection=direction 成员 =====================
describe('BJ703-B D2 mode0 翻转员 435/682（AI_001 :58622-58627 族）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[A] 成员表:435/682 入 PROJ_ROT_RIGHT;PROJ_GHOST_MIRROR0={408,435,682}+459+1026（G2/G10 扩员）精确锁', () => {
    expect(PROJ_ROT_RIGHT.has(435)).toBe(true);
    expect(PROJ_ROT_RIGHT.has(682)).toBe(true);
    // ★BJ704-G2（2026-10-21,债① 459 员）扩员:459 载体勘误=Arrow（非专属实体）,
    // ghost 环本就在,姿态随族点亮（D2 同刀式）。
    // ★BJ704-G10（2026-10-21,R2-F2）1026 扩员:AI_028 :26943-26944 同式,随迁。
    expect([...PROJ_GHOST_MIRROR0].sort((a, b) => a - b)).toEqual([408, 435, 459, 682, 1026]);
  });

  const bodyPose = (vx: number, vy: number, projId: number) => {
    const a = new Arrow(1600, 1600, vx, vy, 40, 2, projId, { grav: 0 });
    const { calls, r } = makeR();
    a.draw(r as never, {} as never);
    return {
      rots: calls.filter((c) => c.m === 'rotate').map((c) => c.a[0] as number),
      mirrors: calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length,
    };
  };

  it('[B] 本体四向:右=裸速度角无镜像;左=scale(-1,1)+rotate(π−ang)（两员同 408 式）', () => {
    for (const pid of [435, 682]) {
      const ang = Math.atan2(-6, 8);
      const R = bodyPose(8, -6, pid);
      expect(R.rots).toHaveLength(1);
      expect(R.rots[0]).toBeCloseTo(ang, 6);
      expect(R.mirrors).toBe(0);
      const angL = Math.atan2(-6, -8);
      const L = bodyPose(-8, -6, pid);
      expect(L.mirrors).toBe(1);
      expect(L.rots).toHaveLength(1);
      expect(L.rots[0]).toBeCloseTo(PI - angL, 6);
    }
  });

  it('[C] ghost（mode0）:角随本体（左飞 +π）+ 每槽镜像 + 帧行 0（无帧锚特支）', () => {
    const g = mkHooks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    for (const pid of [435, 682]) {
      const a = new Arrow(1600, 1600, -15, -5, 40, 2, pid, { grav: 0 });
      for (let t = 0; t < 10; t++) a.fixedUpdate(1 / 60, g);
      setProjSpriteOverride(pid, fakeImg(34, 64) as unknown as ImageBitmap);
      const doc = stubDocWithRecordingCanvases();
      try {
        const { calls, r } = makeR();
        a.draw(r as never, {} as never);
        const ang = Math.atan2(-5, -15);
        const ghost = calls.filter((c) => c.m === 'drawImage' && (c.a.length ?? 0) >= 9);
        expect(ghost.length, `${pid} ghost 槽`).toBeGreaterThanOrEqual(1);
        for (const c of ghost) {
          expect(c.a[1]).toBe(0);        // sx
          expect(c.a[2]).toBe(0);        // sy=帧行 0（GHOST_FRAME 无 435/682 条目）
          expect(c.a[4]).toBe(16);       // sh = 64/4（projFrames=4）
        }
        const rots: number[] = [];
        for (let i = 0; i < calls.length; i++) {
          if (calls[i].m === 'drawImage' && (calls[i].a.length ?? 0) >= 9) {
            for (let j = i - 1; j >= 0; j--) {
              if (calls[j].m === 'rotate') { rots.push(calls[j].a[0] as number); break; }
              if (calls[j].m === 'save') break;
            }
          }
        }
        for (const v of rots) expect(v).toBeCloseTo(ang + PI, 6);
        const mirrors = calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
        expect(mirrors).toBe(1 + ghost.length);
      } finally {
        doc.restore();
      }
    }
  });

  it('[V] 判语锁:684 对称销案 + 459 Arrow 姿态随族（BJ704-G2 债① 清偿态）', () => {
    // 684（DD2SquireSonicBoom）:贴图 1% 非对称（扩散环对称）→ 翻转不可见;且其
    // rotation 族=ToRotation()+π/2（:58635-58637 680||684||686 族）=本仓缺省支,
    // ghost 姿态零差 → 不入集。
    expect(PROJ_GHOST_MIRROR0.has(684)).toBe(false);
    expect(PROJ_ROT_RIGHT.has(684)).toBe(false);
    // ★BJ704-G2（2026-10-21）债① 清偿态翻转:585/601/706/709 四专属载体已接线
    // （TownShot/PortalGunBolt/PhoenixBowProj/SkyDragonFury 各含 ProjGhostRing+
    // drawProjGhosts;结构锁随新形态）;459 载体勘误=Arrow（PrismProj ChargedBlaster
    // fire 走 new Arrow(...,459,...)）→ PrismProj 本体仍无 ghost 面（459 弹体不在
    // 彼类,460/461/632/633 无 TrailingMode）。
    expect(PROJ_GHOST_MIRROR0.has(459)).toBe(true);
    for (const pid of [585, 601, 706, 709]) expect(PROJ_GHOST_MIRROR0.has(pid)).toBe(false);
    const hasGhost = (p: string) => {
      const src = read(p);
      expect(src.includes('drawProjGhosts'), `${p} 应已接 ghost 通用表（BJ704-G2 债①）`).toBe(true);
      expect(src.includes('ProjGhostRing'), `${p} 应已接 ghost 环（BJ704-G2 债①）`).toBe(true);
    };
    hasGhost('../src/entities/TownShot.ts');
    hasGhost('../src/entities/PortalGunBolt.ts');
    hasGhost('../src/entities/PhoenixBowProj.ts');
    hasGhost('../src/entities/SkyDragonFury.ts');
    const noGhost = (p: string) => {
      const src = read(p);
      expect(src.includes('drawProjGhosts'), `${p} 应无 ghost 通用表消费`).toBe(false);
      expect(src.includes('ProjGhostRing'), `${p} 应无 ghost 环`).toBe(false);
    };
    noGhost('../src/entities/PrismProj.ts');
    // 585 本体姿态已由 TownShot mirror-right 承载（AI_001 MIRROR 分支 :54715 域）
    expect(read('../src/entities/TownShot.ts')).toContain("585: { rot: 'mirror-right'");
  });
});

// ===================== D3：orchestraFx 白影 CloneDust 化 =====================
describe('BJ703-B D3 白影 cloneDust 化（ParticleOrchestrator 四站）', () => {
  /** 断言:每个白影克隆均存在一彩色/无色源尘与其 x/y/vx/vy/帧 全等,scale=源/2 */
  function assertClonePairs(vd: VanillaDust, fadeInRatio: number) {
    const pool = (vd as unknown as { pool: VDust[] }).pool;
    const act = pool.filter((d) => d.active && d.type === 267);
    const whites = act.filter((d) => d.color && d.color.r === 255 && d.color.g === 255
      && d.color.b === 255 && d.color.a === 255);
    const sources = act.filter((d) => !whites.includes(d));
    expect(whites.length).toBeGreaterThanOrEqual(2);
    expect(sources.length).toBe(whites.length);
    for (const w of whites) {
      const src = sources.find((s) => s.x === w.x && s.y === w.y && s.vx === w.vx && s.vy === w.vy
        && s.fx === w.fx && s.fy === w.fy);
      expect(src, `白影(${w.x},${w.y}) 须有速度/帧全等源尘（CloneDust 全字段拷贝）`).toBeTruthy();
      expect(w.scale).toBeCloseTo(src!.scale / 2, 10);              // :3506/:3405/:3455/:1644
      expect(w.fadeIn).toBeCloseTo(src!.fadeIn * fadeInRatio, 10);  // ×0.75（各站同式）
      expect(w.noGravity).toBe(true);                                // :276 随拷
    }
  }

  it('[A] rainbowRodHitFx（:3505-3508）:克隆=源尘逐字段镜像', () => {
    const rig = makeDustRig();
    rainbowRodHitFx(rig.hooks, 1000, 1000, 2, -1, rig.rng);
    assertClonePairs(rig.vd, 0.75);
  });

  it('[B] stardustPunchFx（:3454-3457）:克隆=源尘逐字段镜像', () => {
    const rig = makeDustRig();
    stardustPunchFx(rig.hooks, 1000, 1000, 0, 1, rig.rng);
    assertClonePairs(rig.vd, 0.75);
  });

  it('[C] princessWeaponFx（:3404-3407）:克隆=源尘逐字段镜像（fadeIn 0×0.75=0）', () => {
    const rig = makeDustRig();
    princessWeaponFx(rig.hooks, 1000, 1000, 3, 0, rig.rng);
    assertClonePairs(rig.vd, 0.75);
  });

  it('[D] rainbowBoulderFx v3（:1643-1648）:克隆镜像 + noLight/noLightEmittance 重置', () => {
    const rig = makeDustRig();
    rainbowBoulderFx(rig.hooks, 3, 1000, 1000, 1, -2, rig.rng);
    const pool = (rig.vd as unknown as { pool: VDust[] }).pool;
    const whites = pool.filter((d) => d.active && d.type === 267 && d.color
      && d.color.r === 255 && d.color.g === 255 && d.color.b === 255);
    expect(whites.length).toBeGreaterThanOrEqual(2);
    const sources = pool.filter((d) => d.active && d.type === 267 && !whites.includes(d));
    expect(sources.length).toBe(whites.length);
    for (const w of whites) {
      expect(w.noLight).toBe(true);               // :1647（源拷 + 显式重置双保险）
      expect(w.noLightEmittance).toBe(true);      // :1648（非拷贝字段,后置写）
      const src = sources.find((s) => s.x === w.x && s.y === w.y && s.vx === w.vx && s.vy === w.vy);
      expect(src, 'v3 白影须有全等源尘').toBeTruthy();
      expect(w.scale).toBeCloseTo(src!.scale / 2, 10);
    }
  });

  it('[V] formatC 判语:原版无 CloneDust（:3703-3763 纯 12×d213）——债单误记,销案', () => {
    const src = read('../src/fx/orchestraFx.ts');
    const i0 = src.indexOf('export function formatCFx');
    const i1 = src.indexOf('export function', i0 + 10);
    const seg = src.slice(i0, i1);
    expect(seg).not.toContain('cloneDust');       // 无白影克隆面（白核=FadingParticle 已由 spawnParticles 承载）
    expect(seg).not.toContain('{ r: 255, g: 255, b: 255, a: 255 }');
  });
});

// ===================== D4：whipHueClock → miscCounterNormalized =====================
describe('BJ703-B D4 鞭彩虹相时钟（Player.cs:3373）', () => {
  it('[A] miscCounterNormalized:wrap 300 域 [0,1)', () => {
    const p = new Player(800, 800, new Inventory());
    p.miscCounter = 0;
    expect(p.miscCounterNormalized).toBe(0);
    p.miscCounter = 150;
    expect(p.miscCounterNormalized).toBeCloseTo(0.5, 10);
    p.miscCounter = 299;
    expect(p.miscCounterNormalized).toBeCloseTo(299 / 300, 10);
    p.miscCounter = 300;                            // wrap :29529-29532
    expect(p.miscCounterNormalized).toBe(0);
    p.miscCounter = 749;                            // 749%300=149
    expect(p.miscCounterNormalized).toBeCloseTo(149 / 300, 10);
  });

  it('[B] 915 AI 尘 hue=owner.miscCounterNormalized×9%1（P.cs:48741,tick 时钟）', () => {
    for (const [mc, exp] of [[100, [255, 0, 0]], [150, [0, 255, 255]]] as const) {
      const rig = makeDustRig();
      rig.player.miscCounter = mc;                  // 100→hue 1/3→(×9%1)=0 红;150→0.5→4.5%1=0.5 青
      const whip = new WhipProj(rig.player.cx, rig.player.cy, 0, 915, 4914, 20, 2, 30, 10,
        () => rig.player, () => 0);
      for (let t = 0; t < 120 && !whip.dead; t++) whip.fixedUpdate(1 / 60, rig.hooks);
      const pool = (rig.vd as unknown as { pool: VDust[] }).pool;
      const colored = pool.filter((d) => d.active && d.type === 267 && d.color
        && !(d.color.r === 255 && d.color.g === 255 && d.color.b === 255));
      expect(colored.length, `miscCounter=${mc} 彩色源尘应生成`).toBeGreaterThanOrEqual(3);
      for (const d of colored) {
        expect(d.color!.r, `miscCounter=${mc} hue 应锁 ${(mc / 300 * 9) % 1}`).toBe(exp[0]);
        expect(d.color!.g).toBe(exp[1]);
        expect(d.color!.b).toBe(exp[2]);
      }
    }
  });

  it('[C] 结构锁:whipHueClock/performance.now 时钟档禁复辟', () => {
    const src = read('../src/entities/WhipProj.ts');
    expect(src).not.toContain('whipHueClock()');
    expect(src).not.toMatch(/performance\.now\(\) \/ 5000/);
    expect(src).toContain('miscCounterNormalized ?? 0');
    expect(src).toContain('hue: owner?.miscCounterNormalized ?? 0');
  });
});

// ===================== D5：WhipProj drawWhipFrame flatten 保形 =====================
describe('BJ703-B D5 鞭段染色 flatten 保形（BJ371/BJ700-C 判例族）', () => {
  // fake DOM:每个 bake 画布记录自身 comp 序列（tintedTex 烘焙链可断言）
  type BakeCanvas = { __id: number; width: number; height: number; ops: string[] };
  function installBakeRecorder() {
    const g = globalThis as unknown as Record<string, unknown>;
    const prevDoc = g.document;
    const bakes: BakeCanvas[] = [];
    let seq = 0;
    g.document = {
      createElement: (): BakeCanvas => {
        const cv: BakeCanvas = { __id: ++seq, width: 0, height: 0, ops: [] };
        (cv as unknown as Record<string, unknown>).getContext = (): unknown => ({
          drawImage: () => { cv.ops.push('draw'); },
          fillRect: () => { cv.ops.push('fill'); },
          set globalCompositeOperation(v: string) { cv.ops.push(`comp:${v}`); },
          get globalCompositeOperation() { return 'source-over'; },
        });
        bakes.push(cv);
        return cv;
      },
    };
    return { bakes, restore: () => { g.document = prevDoc; } };
  }

  it('[A] 915 彩虹鞭全绘:所有染色烘焙均 destination-in 保形（透明域贡献 0）', () => {
    const rig = makeDustRig();
    const whip = new WhipProj(rig.player.cx, rig.player.cy, -0.6, 915, 4914, 20, 2, 30, 10,
      () => rig.player, () => 0);
    for (let t = 0; t < 20; t++) whip.fixedUpdate(1 / 60, rig.hooks);
    setProjSpriteOverride(915, fakeImg(22, 160) as unknown as ImageBitmap);
    const line = fakeImg(12, 12);
    const doc = installBakeRecorder();
    try {
      const { calls, r } = makeR();
      (r as unknown as { atlas: unknown }).atlas = { ensureVImage: () => line };
      whip.draw(r as never);
      // 主 ctx 须有染色笔（tintedTex 烘焙产物上屏）——夹具真消费门
      const tinted = calls.filter((c) => c.m === 'drawImage'
        && (c.a[0] as { ops?: string[] }).ops !== undefined);
      expect(tinted.length, '须有烘焙染色笔上屏').toBeGreaterThanOrEqual(2);
      // 判别面:每个含 multiply 染色的 bake 必经 destination-in 回贴保形
      //  （flatten=true 档无 destination-in=摊平方片,旧病灶）
      const tintBakes = doc.bakes.filter((b) => b.ops.includes('comp:multiply'));
      expect(tintBakes.length).toBeGreaterThanOrEqual(2);   // A=0 档 + 中间档 add 笔（黑形笔同保形）
      for (const b of tintBakes) {
        expect(b.ops).toContain('comp:destination-in');
        expect(b.ops[b.ops.indexOf('comp:destination-in') + 1]).toBe('draw');  // 回贴原 alpha
      }
    } finally {
      doc.restore();
    }
  });

  it('[B] 结构锁:A=0 档与中间档 add 笔 flatten=true 禁复辟', () => {
    const src = read('../src/entities/WhipProj.ts');
    const i0 = src.indexOf('function drawWhipFrame');
    const i1 = src.indexOf('function whipFrameRect');
    expect(i0).toBeGreaterThan(0);
    expect(i1).toBeGreaterThan(i0);
    const seg = src.slice(i0, i1);
    expect(seg).not.toContain('tintedTex(tex, [r, g, b], true)');   // 两档摊平禁回潮
    // 三处彩色染笔全保形:A=0 档 / A≥255 纯替换档 / 中间档 add 笔
    expect((seg.match(/tintedTex\(tex, \[r, g, b\], false\)/g) ?? []).length).toBe(3);
    expect(seg).toContain("tintedTex(tex, [0, 0, 0], false)");     // 中间档黑形压暗笔
  });
});

// ===================== 变异自证（回潮恰红） =====================
describe.skipIf(process.env.SW_BJ703B_MUT)('BJ703-B 变异自证', () => {
  const spawn = (filter: string) => spawnSync('npx', ['vitest', 'run',
    'tests/bj703b-ghost-dust-debts.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
    env: { ...process.env, SW_BJ703B_MUT: '1' },
  });
  const GHOST = join(process.cwd(), 'src', 'entities', 'projGhostTrail.ts');
  const ARROW = join(process.cwd(), 'src', 'entities', 'Arrow.ts');
  const WHIP = join(process.cwd(), 'src', 'entities', 'WhipProj.ts');
  const ORCH = join(process.cwd(), 'src', 'fx', 'orchestraFx.ts');

  it('M1 D1 基底摘除（回退 slot-only XOR）→ [A]/[B] 红', () => {
    withMutation(GHOST,
      'const ghostFlip = useOldRot\n      ? (mirrorExempt ? dirFlip : dirFlip !== (slot.dir === -1))       // XOR 镜像\n      : dirFlip;',
      'const ghostFlip = (useOldRot && !mirrorExempt && slot.dir === -1) || (!useOldRot && o.mirror === true);   // ★BJ703B 变异:基底摘除',
      () => {
        const r = spawn('mode2 非豁免');
        expect(r.status, '变异须证红: dir 基底摘除').not.toBe(0);
        const r2 = spawn('mode3 豁免员');
        expect(r2.status, '变异须证红: 豁免档基底摘除').not.toBe(0);
      }, { label: 'BJ703B M1' });
  });

  it('M2 D2 ghost 集回退 408-only → [C] 红', () => {
    withMutation(ARROW,
      'const PROJ_GHOST_MIRROR0 = new Set([408, 435, 682, 459, 1026]);',
      'const PROJ_GHOST_MIRROR0 = new Set([408]);   // ★BJ703B 变异:扩员回退',
      () => {
        const r = spawn('ghost（mode0）');
        expect(r.status, '变异须证红: 435/682 ghost 姿态回退').not.toBe(0);
      }, { label: 'BJ703B M2' });
  });

  it('M3 D3 cloneDust 回退手搓（rainbowRod 站）→ [A] 红', () => {
    withMutation(ORCH,
      'if (d) {\n      const w = game.cloneDust?.(d);\n      if (w) {\n        w.scale /= 2;                                  // :3506 dust.scale /= 2f',
      'if (d) { /* ★BJ703B 变异:手搓克隆复辟 */ const w = game.spawnDust?.(1004, 1004, 1, 1, 267, d.vx, d.vy, 0, { r: 255, g: 255, b: 255, a: 255 }, d.scale / 2, true); if (w) {\n        w.scale /= 2;                                  // :3506 dust.scale /= 2f',
      () => {
        const r = spawn('rainbowRodHitFx');
        expect(r.status, '变异须证红: 手搓克隆三抖动复辟').not.toBe(0);
      }, { label: 'BJ703B M3' });
  });

  it('M4 D4 时钟回退 performance.now → [B] 红', () => {
    withMutation(WHIP,
      'const [r, g, b] = hslToRgb255((c.hue * 9) % 1, 1, 0.5, 255);',
      'const [r, g, b] = hslToRgb255((((typeof performance !== "undefined" ? performance.now() / 5000 : 0) % 1) * 9) % 1, 1, 0.5, 255);   // ★BJ703B 变异:时钟回退',
      () => {
        const r = spawn('915 AI 尘 hue');
        expect(r.status, '变异须证红: wall-clock 相位漂移复辟').not.toBe(0);
      }, { label: 'BJ703B M4' });
  });

  it('M5 D5 flatten 回潮 true（A=0 档）→ [A] 红', () => {
    withMutation(WHIP,
      'const t = tintedTex(tex, [r, g, b], false);\n    if (t) { ctx.globalCompositeOperation = \'lighter\'; ctx.drawImage(t, sx, sy, sw, sh, dx, dy, dw, dh); }',
      'const t = tintedTex(tex, [r, g, b], true);   // ★BJ703B 变异:摊平回潮\n    if (t) { ctx.globalCompositeOperation = \'lighter\'; ctx.drawImage(t, sx, sy, sw, sh, dx, dy, dw, dh); }',
      () => {
        const r = spawn('915 彩虹鞭全绘');
        expect(r.status, '变异须证红: 透明域染色方片复辟').not.toBe(0);
      }, { label: 'BJ703B M5' });
  });
});
