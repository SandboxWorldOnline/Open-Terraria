// ★BJ704-G2（2026-10-21）登记债四件清算判别锁：ghost 缺面 7 员 + rainbowRodHit
// 源尘双偏 + 630 柔光/枪口闪光 + 563 flatten 残项。
//
// 定谳链（1457 反编译锚,逐件）：
//  债① ghost 缺面 7 员——459/585/601/706/709（mode0）/818（mode2）TrailingMode≥0
//    （ProjectileID.cs:385/:387:459/585/601/706/709=0 缺省 cacheLen10,818=2/20）。
//    逐员载体勘误:459=Arrow（PrismProj ChargedBlaster fire → new Arrow(...,459,...),
//    债单「专属实体」前提错——环本就在,缺的是姿态:PROJ_ROT_RIGHT/PROJ_GHOST_MIRROR0
//    += 459,D2 同刀式）;585=TownShot/601=PortalGunBolt/706=PhoenixBolt/709=
//    SkyDragonShot 补 ProjGhostRing+record+drawProjGhosts（MinionProj 755 接线式）;
//    818=TigerPounce 补 mode2 环（4 子步/t 逐子步采样,dir=sign(vx) :47589）。
//    916 判语销案:1457 projId 916 ≠鞭——SetDefaults :8678-8690 aiStyle 176
//    （AI_176_EdgyLightning :45878-45916 追击闪电）,由 WhipTagEffect_DarkHarvest.
//    SpawnBlackLightning 生成（黑收成 tag 链电弹）;黑收成鞭本体=item 4914/proj 915
//    （vanilla-whips.json 18 把无 916）。仓内模型=darkHarvestChain 瞬时三跳链
//    （WhipTag.ts:飞行相位差=登记债）——ghost 面为该债子面,无载体可接,销案。
//    色支（GetAlpha 亲读）:459/709=:81063-81066 (255,255,255,200) 恒（α 淡入无
//    视觉面）;706=:80830-80833 (255−α,·,·,180−⌊α/2⌋−⌊α/4⌋) afade 先于 /=i;
//    601=:80870-80873 整支替换 PortalHelper.GetPortalColor（A=66）→ tintOverride;
//    585=:80880-80885 Lerp(光,White,0.5) 保 A——白化=光照域项（登记②同账,缺省白）;
//    818=:31279-31290 OurFavoriteColor A=0 纯加法（aMul 勘误 1→0）。
//  债② rainbowRodHitFx 源尘双偏——ParticleOrchestrator.cs :3494-3510 亲读:
//    ① newColor=hslToRgb((num3+r×0.12)%1,1,0.4+r×0.25) 2 掷先于一切直入 NewDust
//    （旧 color=null 丢色丢掷）;② velocity/scale NewDust 形参缺省 0/1 后置写精确值
//    （旧 spawn 形参=池内 ±2 速抖/±2% 比例抖叠加终值）。princess :3392-3409/
//    stardust :3443-3459 源尘同②族（velocity 终值=MovementVector 覆写/scale 0.6+2r
//    后置）——三站同刀。
//  债③ 630 柔光+枪口闪光——Main.cs:32668-32676:GlowMask[200]（Images/Glow_200.png
//    32×54）白 127×num281 同帧叠画;localAI[0]>0 → Extra[65]（36×276=1×6 行）帧行
//    6−(int)localAI[0],可见窗 c∈(0,6]、c>6 负行 PointClamp 顶行全透（资产实测顶
//    4 行 α=0）不可见;位=本体位+Normalize(velocity)×2,origin=(flip?36:0,25)。
//    localAI[0]=12 于音拍（:68236）、−1/update（:68225-68228,630 无 extraUpdates）。
//  债④ drawHslMidpointTrail flatten——563 贴图 16×16 二值 α 81.3% 非零（18.7%
//    透明域）,摊平=不透明染色底方块;保形=BJ371 判例（一 token）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ProjGhostRing, drawProjGhosts, GHOST_TINT, resolveGhostLoop, PROJ_TRAILING_MODE,
} from '../src/entities/projGhostTrail';
import { Arrow, setProjSpriteOverride } from '../src/entities/Arrow';
import { TownShot, townFrameIndex } from '../src/entities/TownShot';
import { PortalGunBolt } from '../src/entities/PortalGunBolt';
import { PhoenixBolt } from '../src/entities/PhoenixBowProj';
import { SkyDragonShot } from '../src/entities/SkyDragonFury';
import { TigerPounce } from '../src/entities/MinionProj';
import { rainbowRodHitFx, princessWeaponFx, stardustPunchFx } from '../src/fx/orchestraFx';
import { VanillaDust } from '../src/fx/VanillaDust';
import type { VDust } from '../src/fx/VanillaDust';
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { projectileData } from '../src/data/vanillaProjectiles';
import type { GameHooks } from '../src/entities/types';
import { withMutation } from './mutation-guard';

const PI = Math.PI;
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// ---------------------------------------------------------------- hooks 桩（bj703b 同款）
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
    playSfxFile: () => {},
    showPickupLabel: () => {},
    spawnDust: () => null,
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as unknown as GameHooks;
}
type Call = { m: string; a: unknown[] };
function makeR(atlas?: Record<string, unknown> | null) {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => {
      if (k === 'canvas') return undefined;
      return (...a: unknown[]) => { calls.push({ m: String(k), a }); };
    },
    set: (_t, k, v) => { calls.push({ m: `set:${String(k)}`, a: [v] }); return true; },
  });
  const r = {
    canvas: { getContext: () => ctx, width: 1280, height: 800 }, ctx,
    atlas: atlas ?? null, lighting: null,
  };
  return { calls, r: r as never };
}
function stubDoc() {
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

/** 尘池 rig（bj703b 同款） */
function makeDustRig() {
  const store = new TileStore(220, 130);
  const player = new Player(50 * 16, 90 * 16, new Inventory());
  const vd = new VanillaDust();
  let s = 20261021;
  const rolls: number[] = [];
  const rng = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const v = s / 4294967296;
    rolls.push(v);
    return v;
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
    playSfxFile: () => {},
    showPickupLabel: () => {},
    spawnDust: (x: number, y: number, w: number, h: number, type: number, sx: number, sy: number, alpha: number, color: unknown, scale: number) =>
      vd.spawn(x, y, w, h, type, sx, sy, alpha, color as VDust['color'], scale),
    cloneDust: (d: VDust) => vd.clone(d),
    entities: { projectiles: [], add: () => {} },
  } as never;
  return { hooks, player, vd, rng, rolls };
}

const img9 = (c: Call) => c.m === 'drawImage' && (c.a.length ?? 0) >= 9;
/** 数组中存在 |v−x|<eps 的元素（toContainCloseTo 兼容替身） */
const near = (arr: number[], x: number, eps = 1e-6) => arr.some((v) => Math.abs(v - x) < eps);

// ============================================================ 债① 色支/参数（纯函数）
describe('BJ704-G2 债①① GHOST_TINT 色支（GetAlpha 亲读面）', () => {
  const C = { id: 0, i: 2, start: 1, end: 8, fade: 0.4, ai0: 0, ai1: 0, timeLeft: 300,
    opacity: 1, bodyScale: 1, vxLen: 5, rng: () => 0 };

  it('[A] 459/709：白染 + A 面 200/255（GetAlpha :81063-81066 恒,不读 α 淡入）', () => {
    expect(GHOST_TINT[459]!(C)).toEqual({ rgb: [255, 255, 255], aMul: 200 / 255 });
    expect(GHOST_TINT[709]!(C)).toEqual({ rgb: [255, 255, 255], aMul: 200 / 255 });
  });

  it('[B] 706 afade（:80830-80833 先于 /=i :31273-31278）:三分点', () => {
    // α=0（全显）:rgb=(255,127,127)（i=2 byte 除）,A=180/2=90 → 90/255
    const t0 = GHOST_TINT[706]!({ ...C, i: 2, opacity: 1 })!;
    expect(t0.rgb).toEqual([255, 127, 127]);
    expect(t0.aMul).toBeCloseTo(90 / 255, 10);
    // α=255（出生拍）:rgb 全黑、A=180−127−63<0 → 钳 0（环爆前不可见）
    const t1 = GHOST_TINT[706]!({ ...C, i: 3, opacity: 0 })!;
    expect(t1.rgb).toEqual([0, 0, 0]);
    expect(t1.aMul).toBe(0);
    // α=100（中途）:rgb=(155,77,77),A=180−50−25=105 → trunc(105/2)=52
    const t2 = GHOST_TINT[706]!({ ...C, i: 2, opacity: 155 / 255 })!;
    expect(t2.rgb).toEqual([155, 77, 77]);
    expect(t2.aMul).toBeCloseTo(52 / 255, 10);
  });

  it('[C] 818：aMul=0 纯加法（A=0 勘误）+ OurFavoriteColor k 因子两端', () => {
    const tMid = GHOST_TINT[818]!({ ...C, ai0: 0.3 })!;
    expect(tMid.aMul).toBe(0);                       // ★旧 aMul=1=source-over 遮暗背景
    expect(tMid.rgb).toEqual([255, 255, 255]);       // k=1 → Lerp 到白
    const t0 = GHOST_TINT[818]!({ ...C, ai0: 0 })!;
    expect(t0.rgb).toEqual([0, 0, 0]);               // 延迟/起步 k=0 → 加法黑零贡献
  });

  it('[D] 参数表锁:585/601/706/709/818（Main.cs:31062/:31101/:31055/:31078/:30786-30790）', () => {
    expect(PROJ_TRAILING_MODE[585]).toBe(0);
    expect(PROJ_TRAILING_MODE[601]).toBe(0);
    expect(PROJ_TRAILING_MODE[706]).toBe(0);
    expect(PROJ_TRAILING_MODE[709]).toBe(0);
    expect(PROJ_TRAILING_MODE[818]).toBe(2);
    expect(new ProjGhostRing(585).cap).toBe(10);
    expect(new ProjGhostRing(818).cap).toBe(20);
    expect(resolveGhostLoop(585, 0, 0, 1)).toMatchObject({ start: 1, end: 7, step: 1, gScale: 0.2 });
    expect(resolveGhostLoop(601, 0, 0, 1)).toMatchObject({ start: 1, end: 8, step: 1, gScale: 0.3 });
    expect(resolveGhostLoop(706, 0, 0, 1)).toMatchObject({ start: 9, end: 0, step: -2, gScale: 0.5 });
    expect(resolveGhostLoop(709, 0, 0, 1)).toMatchObject({ start: 1, end: 8, step: 2, gScale: 0.5 });
    expect(resolveGhostLoop(818, 0, 0, 1)).toMatchObject({ start: 18, end: 0, step: -2, gScale: 1 });
  });

  it('[E] tintOverride（601 门色 A=66）:短路 GHOST_TINT,双笔 cut=fade×66/255 + add=fade', () => {
    const doc = stubDoc();
    try {
      const ring = new ProjGhostRing(601);           // mode0
      for (let k = 0; k < 8; k++) ring.record(100 + k * 3, 100, 0, 1, true);
      const { calls, r } = makeR();
      drawProjGhosts((r as unknown as { ctx: CanvasRenderingContext2D }).ctx, {
        ring, id: 601, tex: fakeImg(20, 38) as unknown as never, frames: 2, frame: 0,
        bodyW: 10, bodyH: 10, bodyRot: 0, bodyScale: 1, bodyAlpha: 1,
        ai0: 0, ai1: 0, timeLeft: 300, opacity: 1, vxLen: 3, spriteDirection: 1,
        tintOverride: { rgb: [255, 170, 40], aMul: 66 / 255 },
      });
      const gas = calls.filter((c) => c.m === 'set:globalAlpha').map((c) => c.a[0] as number);
      // i=1..7 槽:fade=(8−i)/15;每槽 cut(fade×66/255)+add(fade) 两笔
      const fade1 = 7 / 15;
      expect(near(gas, fade1 * (66 / 255))).toBe(true);
      expect(near(gas, fade1)).toBe(true);
      // 无 override（601 无 GHOST_TINT 条目）= 单笔 aMul 1 档——对照
      const gas2 = (() => {
        const ring2 = new ProjGhostRing(601);
        for (let k = 0; k < 8; k++) ring2.record(100 + k * 3, 100, 0, 1, true);
        const { calls: c2, r: r2 } = makeR();
        drawProjGhosts((r2 as unknown as { ctx: CanvasRenderingContext2D }).ctx, {
          ring: ring2, id: 601, tex: fakeImg(20, 38) as unknown as never, frames: 2, frame: 0,
          bodyW: 10, bodyH: 10, bodyRot: 0, bodyScale: 1, bodyAlpha: 1,
          ai0: 0, ai1: 0, timeLeft: 300, opacity: 1, vxLen: 3, spriteDirection: 1,
        });
        return c2.filter((c) => c.m === 'set:globalAlpha').map((c) => c.a[0] as number);
      })();
      expect(near(gas2, fade1 * (66 / 255))).toBe(false);
    } finally {
      doc.restore();
    }
  });
});

// ============================================================ 债① 载体接线（行为面）
describe('BJ704-G2 债①② 载体接线（记录+绘制行为）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('[A] 585 TownShot：帧乒乓（:57095-57104）+ ghost 先于本体/帧行锚/左飞镜像', () => {
    // 帧乒乓:age 1..12 → 0,1,1,2,2,3,3,2,2,1,1,0（周期 12）
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((a) => townFrameIndex(585, a, 0, 0)))
      .toEqual([0, 1, 1, 2, 2, 3, 3, 2, 2, 1, 1, 0, 0]);
    const doc = stubDoc();
    try {
      setProjSpriteOverride(585, fakeImg(28, 112) as unknown as ImageBitmap);
      const shot = new TownShot(1000, 1000, -12, -4, 30, 2, 585);
      (shot as unknown as { life: number }).life = 3600 - 4;   // age=4 → 帧 2
      for (let k = 0; k < 8; k++) (shot as unknown as { recordGhostTrail(): void }).recordGhostTrail();
      const { calls, r } = makeR();
      shot.draw(r as never, {} as never);
      const draws = calls.filter(img9);
      // ghost:P(1,7,1,0.2) → i=1..6 共 6 槽 + 本体 1
      expect(draws.length).toBe(7);
      for (const c of draws) expect(c.a[2]).toBe(2 * 28);      // sy=帧 2 行（28×112 四帧行）
      // 左飞（vx<0）:ghost 每槽镜像 + 本体镜像
      const mirrors = calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length;
      expect(mirrors).toBe(7);
      // ghost 角=本体 mirror-right 角（ang+π 左飞）
      const ang = Math.atan2(-4, -12) + PI;
      const rots = calls.filter((c) => c.m === 'rotate').map((c) => c.a[0] as number);
      for (const v of rots) expect(v).toBeCloseTo(ang, 6);
    } finally {
      doc.restore();
    }
  });

  it('[B] 601 PortalGunBolt：ghost 门色双笔 + 本体姿态勘误（+π+镜像）', () => {
    const doc = stubDoc();
    try {
      const atlas = {
        ensureVImage: (p: string) => (p.includes('Projectile_601') ? fakeImg(20, 38) : null),
      };
      const bolt = new PortalGunBolt(2000, 2000, -9, 3, 0);
      for (let k = 0; k < 8; k++) (bolt as unknown as { recordGhostTrail(): void }).recordGhostTrail();
      const { calls, r } = makeR(atlas);
      bolt.draw(r as never, {} as never);
      const draws = calls.filter(img9);
      // ghost i=1..7 七槽 ×（cut+add 两笔）=14（本体 5 参 drawImage 不入 img9 账）
      expect(draws.length).toBe(14);
      const ang = Math.atan2(3, -9) + PI;
      const rots = calls.filter((c) => c.m === 'rotate').map((c) => c.a[0] as number);
      expect(rots.every((v) => Math.abs(v - ang) < 1e-9)).toBe(true);
      // 本体镜像（spriteDirection=direction）:14 ghost 笔 + 本体 1
      expect(calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length).toBe(15);
    } finally {
      doc.restore();
    }
  });

  it('[C] 706 PhoenixBolt：ghost Size/2=33 锚（绘制盒 66 与命中盒 10 解耦）', () => {
    const doc = stubDoc();
    try {
      setProjSpriteOverride(706, fakeImg(72, 608) as unknown as ImageBitmap);
      const bolt = new PhoenixBolt(1500, 1500, 14, 5, 30, 2);
      (bolt as unknown as { alphaI: number }).alphaI = 0;      // 全显（afade rgb 白）
      const ring = (bolt as unknown as { ghostRing: ProjGhostRing }).ghostRing;
      for (let k = 0; k < 10; k++) ring.record(1500 - 14 * k, 1500, 0, 1, true);
      const { calls, r } = makeR();
      bolt.draw(r as never, {} as never);
      // ghost:P(9,0,-2,0.5) → i=9 fade=0 跳笔 → 4 槽（7,5,3,1）×两笔（aMul=trunc(180/i)/255<1）
      //  + 本体（9 参）1 = 9
      expect(calls.filter(img9).length).toBe(9);
      // ghost 位=slot.x+66/2（原版 vector38+Size/2,Size=(66,66) 非命中盒 10）;
      // 槽 i=第 9−i 拍记录（record k=0..9,x_k=1500−14k → slot_i.x=1500−14(9−i)）
      const trs = calls.filter((c) => c.m === 'translate').map((c) => c.a[0] as number);
      for (const i of [7, 5, 3, 1]) {
        expect(near(trs, 1500 - 14 * (9 - i) + 33)).toBe(true);
      }
    } finally {
      doc.restore();
    }
  });

  it('[D] 709 SkyDragonShot：ghost 4 槽 + 本体恒 A=200（α 淡入无视觉面勘误）+ 左飞镜像', () => {
    const doc = stubDoc();
    try {
      setProjSpriteOverride(709, fakeImg(36, 102) as unknown as ImageBitmap);
      const shot = new SkyDragonShot(1800, 1800, -11, 4, 20);
      for (let k = 0; k < 10; k++) (shot as unknown as { recordGhostTrail(): void }).recordGhostTrail();
      const { calls, r } = makeR();
      shot.draw(r as never, {} as never);
      // ghost:P(1,8,2,0.5) → i=1,3,5,7 四槽 ×两笔（aMul 200/255）+ 本体 1 = 9
      expect(calls.filter(img9).length).toBe(9);
      // 本体 A 面=200/255 恒（GetAlpha :81063-81066;旧 (255−α)/255 渐显系误读）
      expect(calls.some((c) => c.m === 'set:globalAlpha' && (c.a[0] as number) === 200 / 255)).toBe(true);
      // 左飞本体镜像（:55666 spriteDirection=direction）
      expect(calls.filter((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1).length)
        .toBeGreaterThanOrEqual(5);
    } finally {
      doc.restore();
    }
  });

  it('[E] 818 TigerPounce：mode2 逐子步采样（延迟 4 记/拍 dir=1,活相 4 记/拍 dir=sign）+ 纯加法 ghost', () => {
    const g = mkHooks();
    const doc = stubDoc();
    try {
      setProjSpriteOverride(818, fakeImg(132, 132) as unknown as ImageBitmap);
      const tp = new TigerPounce(1200, 1200, 200, 60, 30, () => null, -8, 40);
      // 延迟 2 拍（a0 −8→0）:每拍 4 记（UpdateTrails 于 AI 早退后照跑）
      tp.fixedUpdate(1 / 60, g);
      tp.fixedUpdate(1 / 60, g);
      const ring = (tp as unknown as { ghostRing: ProjGhostRing }).ghostRing;
      expect(ring.filled).toBe(8);
      expect(ring.at(0)!.dir).toBe(1);              // 初始 spriteDirection=1（:356）
      // 活相第 1 拍:4 记（k=1..4 子步,每子步 rot−0.2·sign）
      tp.fixedUpdate(1 / 60, g);
      expect(ring.filled).toBe(12);
      expect(ring.at(0)!.dir).toBe(1);              // sign(ivx)=1（:47589）
      expect(ring.at(0)!.rot).toBeCloseTo(-0.2 * 4, 6);
      expect(ring.at(1)!.rot).toBeCloseTo(-0.2 * 3, 6);
      // 再 4 拍 → filled 钳 cap 20
      for (let t = 0; t < 4; t++) tp.fixedUpdate(1 / 60, g);
      expect(ring.filled).toBe(20);
      // 绘制:P(18,0,-2,1) → i=18 fade=0 跳笔 → 8 槽 'lighter' 纯加法（A=0,单笔/槽）
      const { calls, r } = makeR();
      tp.draw(r as never);
      expect(calls.filter(img9).length).toBe(8);    // 8 ghost（本体 5 参不入 img9 账）
      const blends = calls.filter((c) => c.m === 'set:globalCompositeOperation')
        .map((c) => c.a[0]);
      expect(blends.filter((b) => b === 'lighter').length).toBe(8);
    } finally {
      doc.restore();
    }
  });

  it('[V] 916 判语销案锁:非鞭（aiStyle 176 EdgyLightning）,黑收成鞭=915,仓内瞬时链=飞行相位差债', () => {
    // 1457 SetDefaults :8678-8690:916 aiStyle=176（AI_176_EdgyLightning :45878）
    expect(projectileData(916)?.aiStyle).toBe(176);
    // 黑收成鞭本体=item 4914 → proj 915（vanilla-whips.json 18 把无 916）
    const whips = JSON.parse(read('../src/data/vanilla-whips.json')) as Record<string, { proj: number }>;
    expect(Object.values(whips).some((w) => w.proj === 916)).toBe(false);
    expect(whips['4914']?.proj).toBe(915);
    // 仓内 916=WhipTagEffect_DarkHarvest 黑闪电链电,瞬时三跳模型（飞行弹体=登记债）
    const wt = read('../src/entities/WhipTag.ts');
    expect(wt).toContain('AI_176_EdgyLightning');
    expect(wt).toContain('飞行相位差=登记债');
    expect(wt).not.toContain('ProjGhostRing');      // 无载体可接 ghost 环（销案面）
  });
});

// ============================================================ 债② rainbowRodHit 源尘
describe('BJ704-G2 债② rainbowRodHit 源尘（校色+后置写+掷序）', () => {
  it('[A] rainbowRodHitFx：fx 流 128 掷 + 源尘带色 + 速度/scale/fadeIn 后置精确值', () => {
    const rig = makeDustRig();
    rainbowRodHitFx(rig.hooks, 1000, 1000, 2, -1, rig.rng);
    // 掷账:头 2（baseAng/hueBase）+ sparkle 6×7 + 尘 12×7（色2+circular2+dir1+scale1+fadeIn1）
    expect(rig.rolls.length).toBe(2 + 6 * 7 + 12 * 7);
    const pool = (rig.vd as unknown as { pool: VDust[] }).pool;
    const act = pool.filter((d) => d.active && d.type === 267);
    expect(act.length).toBe(24);                    // 12 源 + 12 克隆
    const whites = act.filter((d) => d.color && d.color.r === 255 && d.color.g === 255
      && d.color.b === 255 && d.color.a === 255);
    const sources = act.filter((d) => !whites.includes(d));
    expect(sources.length).toBe(12);
    // 源尘带色（hsl newColor :3496）:a=255、rgb 非全零
    for (const s of sources) {
      expect(s.color).not.toBeNull();
      expect(s.color!.a).toBe(255);
      expect(s.color!.r + s.color!.g + s.color!.b).toBeGreaterThan(0);
    }
    // 后置写精确值:用同序掷流重放逐尘期望（池内抖动被覆写消解）
    let i = 2 + 6 * 7;                              // 跳到尘段
    for (const s of sources) {
      const hue = rig.rolls[i++]!, light = rig.rolls[i++]!;
      const a = rig.rolls[i++]! * PI * 2, rad = rig.rolls[i++]!;
      const dir = (rig.rolls[i++]! * 2 - 1) * 0.5;
      const scl = 0.6 + rig.rolls[i++]! * 0.9;
      const fd = 0.7 + rig.rolls[i++]! * 0.8;
      expect(s.vx).toBeCloseTo(Math.cos(a) * rad + 2 * dir, 12);
      expect(s.vy).toBeCloseTo(Math.sin(a) * rad + (-1) * dir, 12);
      expect(s.scale).toBe(scl);                    // 精确（无 ±2% 池抖）
      expect(s.fadeIn).toBe(fd);
      expect(s.noGravity).toBe(true);
    }
    expect(i).toBe(rig.rolls.length);               // 掷序恰尽
  });

  it('[B] princessWeaponFx：velocity 终值=MovementVector 覆写、scale=0.1 常量（后置写）', () => {
    const rig = makeDustRig();
    princessWeaponFx(rig.hooks, 1000, 1000, 3, 0, rig.rng);
    const pool = (rig.vd as unknown as { pool: VDust[] }).pool;
    const sources = pool.filter((d) => d.active && d.type === 267
      && (!d.color || d.color.r !== 255 || d.color.g !== 255 || d.color.b !== 255));
    expect(sources.length).toBe(2);
    for (const s of sources) {
      expect(s.vx).toBe(3);                         // :3401 终值覆写（精确,无 ±2 池抖）
      expect(s.vy).toBe(0);
      expect(s.scale).toBe(0.1);                    // :3399 常量
      expect(s.noGravity).toBe(true);
      expect(s.fadeIn).toBe(0);
    }
  });

  it('[C] stardustPunchFx：velocity/scale 后置精确值（掷账 24 不变,f6-shape 同锁）', () => {
    const rig = makeDustRig();
    stardustPunchFx(rig.hooks, 1000, 1000, 1, 2, rig.rng);
    const pool = (rig.vd as unknown as { pool: VDust[] }).pool;
    const sources = pool.filter((d) => d.active && d.type === 267
      && (!d.color || d.color.r !== 255 || d.color.g !== 255 || d.color.b !== 255));
    expect(sources.length).toBe(2);
    let i = 8;                                      // sparkle 段 8 掷后尘段（色2+c2+df1+scl1+pc2=8/尘）
    for (const s of sources) {
      i += 2;                                       // hueC 2 掷
      const a = rig.rolls[i++]! * PI * 2, rad = rig.rolls[i++]!;
      const df = (0.5 + rig.rolls[i++]! * 0.5) * 1.4;
      const scl = 0.6 + rig.rolls[i++]! * 2;
      i += 2;                                       // pc circ(16) 2 掷
      expect(s.vx).toBeCloseTo(Math.cos(a) * rad * 2 + 1 * df, 12);
      expect(s.vy).toBeCloseTo(Math.sin(a) * rad * 2 + 2 * df, 12);
      expect(s.scale).toBe(scl);
      expect(s.noGravity).toBe(true);
    }
  });
});

// ============================================================ 债③ 630 柔光+枪口闪光
describe('BJ704-G2 债③ 630 GlowMask[200]+Extra[65]（Main.cs:32668-32676）', () => {
  it('[A] 结构锁:素材通道 + 计数器置 12/递减/帧行式', () => {
    const src = read('../src/entities/Arrow.ts');
    expect(src).toContain("ensureVImage?.('vanilla/Glow_200.png')");
    expect(src).toContain("ensureVImage?.('vanilla/Extra_65.png')");
    expect(src).toContain('this.ph630Flash = 12;');
    expect(src).toContain('this.ph630Flash > 0 && this.ph630Flash <= 6 ? 6 - this.ph630Flash : -1');
    // 素材在位（单图直引族,atlas-append SINGLES 声明）
    expect(read('../scripts/atlas-append-1457.mjs')).toContain("SINGLES.push('Glow_200.png')");
  });

  it('[B] 行为面:音拍置 12 → 逐拍 −1;c∈(0,6] 可见行 [0,5]、>6/0 不可见', () => {
    const g = mkHooks();
    const doc = stubDoc();
    try {
      setProjSpriteOverride(630, fakeImg(32, 54) as unknown as ImageBitmap);
      const a = new Arrow(2000, 2000, 10, 0, 20, 2, 630, {});
      a.ph630Ctl = {
        channel: () => true,
        aim: () => ({ x: 3000, y: 2000 }),
        volley: () => ({ pid: 1, dmg: 5, kb: 1, speed: 10 }),
      };
      const glow = fakeImg(32, 54), flash = fakeImg(36, 276);
      const atlas = {
        ensureVImage: (p: string) => p.includes('Glow_200') ? glow
          : p.includes('Extra_65') ? flash : null,
      };
      const drawCount = (row: number | null) => {
        const { calls, r } = makeR(atlas);
        a.draw(r as never, {} as never);
        const draws = calls.filter((c) => c.m === 'drawImage');
        const flashDraws = draws.filter((c) => (c.a[0] as unknown as { width: number }).width === 36);
        if (row === null) {
          expect(flashDraws.length).toBe(0);
        } else {
          expect(flashDraws.length).toBe(1);
          expect(flashDraws[0].a[2]).toBe(row * 46);          // sy=帧行×行高 46（9 参 flash 笔）
        }
        // 本体+柔光=5 参两笔（32×54 贴图）
        return { body: draws.filter((c) => (c.a[0] as unknown as { width: number }).width === 32).length };
      };
      a.fixedUpdate(1 / 60, g);
      const flashOf = () => (a as unknown as { ph630Flash: number }).ph630Flash;
      expect(flashOf()).toBe(12);                  // 音拍置 12（:68236,首拍 ai0==1 免音不免置）
      const d12 = drawCount(null);                 // 12>6 → 负行 PointClamp 顶行全透=不可见
      expect(d12.body).toBe(2);                    // 本体+柔光
      for (let t = 0; t < 6; t++) a.fixedUpdate(1 / 60, g);
      expect(flashOf()).toBe(6);
      drawCount(0);                                // c=6 → 行 0 可见
      for (let t = 0; t < 3; t++) a.fixedUpdate(1 / 60, g);
      expect(flashOf()).toBe(3);
      drawCount(3);                                // c=3 → 行 3
      for (let t = 0; t < 4; t++) a.fixedUpdate(1 / 60, g);
      expect(flashOf()).toBe(0);
      drawCount(null);                             // 归零不可见
    } finally {
      doc.restore();
    }
  });
});

// ============================================================ 债④ 563 flatten
describe('BJ704-G2 债④ drawHslMidpointTrail flatten 保形（BJ703-F 债①）', () => {
  it('[A] 结构锁:563 轨染笔 flatten=false 禁回潮（贴图 18.7% 透明域）', () => {
    const src = read('../src/entities/projGhostTrail.ts');
    const i0 = src.indexOf('export function drawHslMidpointTrail');
    const i1 = src.indexOf('}', src.indexOf('drawAt(s0.x + 8'));
    const seg = src.slice(i0, i1);
    expect(i0).toBeGreaterThan(0);
    expect(seg).toContain('tintedTex(tex, [Math.round(r), Math.round(g), Math.round(b)], false)');
    expect(seg).not.toContain('], true)');
  });
});

// ============================================================ 变异自证（回潮恰红）
describe.skipIf(process.env.SW_BJ704G2_MUT)('BJ704-G2 变异自证', () => {
  const spawn = (filter: string) => spawnSync('npx', ['vitest', 'run',
    'tests/bj704g2-ghost-gaps.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
    env: { ...process.env, SW_BJ704G2_MUT: '1' },
  });
  const GHOST = join(process.cwd(), 'src', 'entities', 'projGhostTrail.ts');
  const TOWN = join(process.cwd(), 'src', 'entities', 'TownShot.ts');
  const ORCH = join(process.cwd(), 'src', 'fx', 'orchestraFx.ts');

  it('M1 818 aMul 回潮 1（source-over 遮暗）→ 债①[C] 红', () => {
    withMutation(GHOST,
      '      // ★BJ704-G2（2026-10-21）aMul 1→0 勘误：原版 ourFavoriteColor.A=0 ∧\n      //  value17=(255,255,255,0).A=0 → Lerp A≡0 → A=0 纯加法（833-835 同族;\n      //  旧 aMul=1=source-over 黑染衰减背景——延迟相 ai0<0 时 num175=0 → 全黑\n      //  残影可见遮暗,原版加法黑=零贡献不可见）。\n      aMul: 0,',
      '      aMul: 1,   // ★BJ704G2 变异:纯加法回潮',
      () => {
        const r = spawn('818：aMul=0 纯加法');
        expect(r.status, '变异须证红: 818 aMul 回潮').not.toBe(0);
      }, { label: 'BJ704G2 M1' });
  });

  it('M2 459 A 面回潮 255 → 债①[A] 红', () => {
    withMutation(GHOST,
      '459: () => ({ rgb: WHITE, aMul: 200 / 255 }),',
      '459: () => ({ rgb: WHITE, aMul: 1 }),   // ★BJ704G2 变异:A 面回潮',
      () => {
        const r = spawn('459/709：白染');
        expect(r.status, '变异须证红: 459 A=200/255 回潮').not.toBe(0);
      }, { label: 'BJ704G2 M2' });
  });

  it('M3 TownShot 环记录体摘除 → 债①②[A] 红', () => {
    withMutation(TOWN,
      '    // mode0 不记 rot/dir（UpdateTrails 只写 oldPos）;绘制面 ghost 角=本体当前角\n    this.ghostRing?.record(this.x, this.y, 0, 1, true);',
      '    // ★BJ704G2 变异:环记录体摘除',
      () => {
        const r = spawn('585 TownShot');
        expect(r.status, '变异须证红: 585 环记录摘除').not.toBe(0);
      }, { label: 'BJ704G2 M3' });
  });

  it('M4 563 flatten 回潮 true → 债④[A] 红', () => {
    withMutation(GHOST,
      'const addTex = tintedTex(tex, [Math.round(r), Math.round(g), Math.round(b)], false);',
      'const addTex = tintedTex(tex, [Math.round(r), Math.round(g), Math.round(b)], true);   // ★BJ704G2 变异:摊平回潮',
      () => {
        const r = spawn('flatten 保形');
        expect(r.status, '变异须证红: 563 摊平回潮').not.toBe(0);
      }, { label: 'BJ704G2 M4' });
  });

  it('M5 rainbowRod 源尘校色摘除（回退 color=null 丢掷）→ 债②[A] 红', () => {
    withMutation(ORCH,
      '    const [cr2, cg2, cb2] = orchestraHsl255((hueBase + rng() * 0.12) % 1, 1, 0.4 + rng() * 0.25);\n    const d = game.spawnDust?.(x, y, 1, 1, 267, 0, 0, 0,\n      { r: cr2, g: cg2, b: cb2, a: 255 }, 1);',
      '    const d = game.spawnDust?.(x, y, 1, 1, 267, 0, 0, 0, null, 1);   // ★BJ704G2 变异:校色摘除',
      () => {
        const r = spawn('rainbowRodHitFx：fx 流 128 掷');
        expect(r.status, '变异须证红: 源尘校色/掷序摘除').not.toBe(0);
      }, { label: 'BJ704G2 M5' });
  });

  it('M6 princess 后置写回潮 spawn 形参（±2 池抖叠加）→ 债②[B] 红', () => {
    withMutation(ORCH,
      '      d.noGravity = true;                                // :3398\n      d.scale = 0.1;                                     // :3399（常量,非掷）\n      d.vx = moveX;                                      // :3401 终值覆写（精确值）\n      d.vy = moveY;',
      '      d.noGravity = true;   // ★BJ704G2 变异:后置写摘除（形参回潮:速度 0/抖动叠加）',
      () => {
        const r = spawn('princessWeaponFx');
        expect(r.status, '变异须证红: princess 后置写回潮').not.toBe(0);
      }, { label: 'BJ704G2 M6' });
  });
});
