// 敌方/城镇弹幕绘制尺寸对账(G11)回归:
//   绘制尺寸 = 贴图原生帧 × SetDefaults scale(与判定盒 w/h 解耦)+ 帧切片(竖排行/
//   横向列)+ per-type 旋转模式(原版 rotation 赋值散在各 AI)。
// 锚:Terarria1456 —— Projectile.cs SetDefaults / 各 AI rotation 段 / Main.cs
//   DrawProjDirect 帧切片(Frame(1,N)/Frame(N,1))与 origin。
// 方法:记录型 ctx 代理(离屏采样等价)断言 drawImage 目标矩形;纯函数锚定视觉态。
import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TownShot, townDrawSpec, townFrameIndex, townRotation } from '../src/entities/TownShot';
import { SquidCloud, squidCloudVisual } from '../src/entities/SquidCloud';
import { MoonLeechProj } from '../src/entities/bossAI_duke_moonlord';
import { DD2GoblinBomb, DD2OgreSmash } from '../src/entities/bossAI_dd2';
import { DeerclopsSpikeProj, DeerclopsRubbleProj, InsanityShadowProj } from '../src/entities/bossAI_deerclops';
import { LunarOrb } from '../src/entities/bossAI_lunar_misc';
import { projFrameCount } from '../src/entities/Arrow';
import projData from '../src/data/vanilla-projectiles.json';
import type { TownRotMode } from '../src/entities/TownShot';

// ---------------------------------------------------------------- 记录型 ctx
type Call = { m: string; a: unknown[] };
function makeRecCtx() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => {
      if (k === 'canvas') return undefined;
      return (...a: unknown[]) => { calls.push({ m: String(k), a }); };
    },
  });
  return { calls, ctx };
}

/** 贴图假体(atlas.ensureVImage 返回 / global Image 替身共用) */
function fakeImg(w: number, h: number) {
  return { naturalWidth: w, naturalHeight: h, width: w, height: h, complete: true, src: '' };
}

/** renderer 桩:atlas 系(961/962/965/681/683/813) */
function makeAtlasR(img: { naturalWidth: number } | null) {
  const { calls, ctx } = makeRecCtx();
  const r = {
    canvas: { getContext: () => ctx },
    ctx,   // 2026-08-19 世界层重构后实体统一画 r.ctx(曾直取主画布=全弹幕隐形)
    atlas: img ? { ensureVImage: () => img, vimages: new Map() } : null,
  };
  return { calls, r: r as never };
}

// ------------------------------------------------- global Image 替身(projSprite)
let NEXT_IMG = { w: 1, h: 1 };
beforeAll(() => {
  vi.stubGlobal('Image', class {
    naturalWidth = NEXT_IMG.w; naturalHeight = NEXT_IMG.h;
    width = NEXT_IMG.w; height = NEXT_IMG.h;
    complete = true;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    // 同步装载(projSprite 2026-08-19 改 onload 才入缓存——坏 Image 不再永久驻缓存)
    set src(_v: string) { this.onload?.(); }
  });
});

// ------------------------------------------------------------ PNG IHDR 读取
function pngSize(id: number): { w: number; h: number } {
  const b = fs.readFileSync(path.join(__dirname, '..', 'public', 'sprites', 'vanilla', `Projectile_${id}.png`));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function setScale(id: number) {   // 按真实贴图尺寸装载 Image 替身(projSprite 按 id 缓存,每 id 首次触发前设)
  const s = pngSize(id);
  NEXT_IMG = s;
  return s;
}

const TOWN_IDS = [30, 880, 669, 721, 588, 48, 520, 21, 24, 582, 583, 589, 14, 587, 357, 1, 2,
  267, 242, 162, 134, 133, 135, 585, 15, 590, 950, 606, 930];

// ============================================================ TownShot 全量对账
describe('TownShot 绘制尺寸 = 原生帧 × SetDefaults scale(离屏采样)', () => {
  it.each(TOWN_IDS)('弹 %i:目标矩形 = 贴图帧格 × scale(非判定盒 w/h)', (id) => {
    const tex = setScale(id);
    const shot = new TownShot(0, 0, 3, -2, 10, 1, id);
    const { calls, r } = makeAtlasR(null);
    shot.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage');
    expect(d, `弹 ${id} 应走贴图绘制`).toBeTruthy();
    // 9 参形式:(img, sx, sy, sw, sh, dx, dy, dw, dh)
    const spec = townDrawSpec(id);
    const cols = spec.cols;
    const rows = cols > 0 ? 1 : projFrameCount(id);
    const scale = (projData as Record<string, { scale?: number }>)[String(id)]?.scale ?? 1;
    const gs = id === 586 ? 0.02 : 1;                  // 586 生长档 age=0 → 下限 0.02
    const expW = (cols > 0 ? tex.w / cols : tex.w) * scale * gs;
    const expH = (cols > 0 ? tex.h : tex.h / rows) * scale * gs;
    expect(d!.a[7]).toBeCloseTo(expW, 5);
    expect(d!.a[8]).toBeCloseTo(expH, 5);
    // 居中:dx = -dw/2
    expect(d!.a[5]).toBeCloseTo(-expW / 2, 5);
    expect(d!.a[6]).toBeCloseTo(-expH / 2, 5);
  });

  it('589 横向五列条(Main.cs:33235 Frame(5,1)):整条 100×28 不再压进 10×10', () => {
    setScale(589);
    const shot = new TownShot(0, 0, 5, 0, 10, 1, 589, { ai1: 3 });
    const { calls, r } = makeAtlasR(null);
    shot.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[1]).toBeCloseTo(3 * 20, 5);   // sx = ai1 × 列宽 20
    expect(d.a[3]).toBeCloseTo(20, 5);       // sw = 100/5
    expect(d.a[7]).toBeCloseTo(20, 5);       // dw = 原生列宽(scale=1)
    expect(d.a[8]).toBeCloseTo(28, 5);
  });

  it('590 横向六列条(Main.cs:33241 Frame(6,1)):96×20 不再压成 14×2.9', () => {
    setScale(590);
    const shot = new TownShot(0, 0, 0, 0, 40, 3, 590, { ai2: 1 });
    const { calls, r } = makeAtlasR(null);
    shot.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[7]).toBeCloseTo(16, 5);       // 96/6
    expect(d.a[8]).toBeCloseTo(20, 5);
    expect(d.a[1]).toBeCloseTo(3 * 16, 5);   // ai2=1 → 基组 3 起
  });

  it('585 四帧行(AI_001 不推帧 → 恒帧 0):28×112 切成 28×28,不再整条 26×104', () => {
    setScale(585);
    const shot = new TownShot(0, 0, 6, 0, 16, 2, 585);
    const { calls, r } = makeAtlasR(null);
    shot.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[4]).toBeCloseTo(28, 5);       // sh = 112/4
    expect(d.a[2]).toBeCloseTo(0, 5);        // sy = 帧 0
    expect(d.a[7]).toBeCloseTo(28, 5);
    expect(d.a[8]).toBeCloseTo(28, 5);
  });

  it('子弹 14:2×20 曳光 ×1.2 = 2.4×24(曾画 4×40)', () => {
    setScale(14);
    const shot = new TownShot(0, 0, 8, 0, 24, 3, 14);
    const { calls, r } = makeAtlasR(null);
    shot.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[7]).toBeCloseTo(2.4, 5);
    expect(d.a[8]).toBeCloseTo(24, 5);
  });
});

// ============================================================ TownShot 旋转模式
describe('TownShot per-type 旋转模式(原版 rotation 赋值锚)', () => {
  const rotOf = (id: number, vx = 3, vy = -2, rotAcc = 0, age = 0) =>
    townRotation(townDrawSpec(id).rot, vx, vy, rotAcc, age, townDrawSpec(id).spinRate);

  it('默认族 +π/2(AI_001 尾 :54868):1/2/14/134/267/242/587/606', () => {
    for (const id of [1, 2, 14, 134, 267, 242, 587, 606, 357]) {
      expect(townDrawSpec(id).rot).toBe('up');
      expect(rotOf(id)).toBeCloseTo(Math.atan2(-2, 3) + Math.PI / 2, 6);
    }
  });

  it('aiStyle 2 姿态锁族 48/520:前 20t +π/2,之后翻滚累积(:21970-21975/:21517)', () => {
    for (const id of [48, 520]) expect(townDrawSpec(id).rot).toBe('up20');
    expect(rotOf(48, 3, -2, 9.9, 10)).toBeCloseTo(Math.atan2(-2, 3) + Math.PI / 2, 6);
    expect(rotOf(48, 3, -2, 9.9, 30)).toBe(9.9);          // 翻滚累积接管
  });

  it('aiStyle 2 翻滚族 21/162/583/589(:21517)与滚动族 30/588/133/135/721(:44913)', () => {
    for (const id of [21, 162, 583, 589]) expect(townDrawSpec(id).rot).toBe('tumble');
    for (const id of [30, 588, 133, 135, 721]) {
      expect(townDrawSpec(id).rot).toBe('roll');
      expect(rotOf(id, 5, 0)).toBeCloseTo(0.5, 6);        // vx*0.1
    }
  });

  it('恒 0 直立族(15 aiStyle 8、24 aiStyle 14、590 AI_112、950 AI_186)', () => {
    for (const id of [15, 24, 590, 950]) {
      expect(townDrawSpec(id).rot === 'upright').toBe(true);
      expect(rotOf(id, 3, -2)).toBe(0);
    }
  });

  it('582 自旋 π/10(:32893)/ 669 自旋 0.25(aiStyle 68 :29047)', () => {
    expect(townDrawSpec(582).spinRate).toBeCloseTo(Math.PI / 10, 6);
    expect(townDrawSpec(669).spinRate).toBeCloseTo(0.25, 6);
  });

  it('585 MIRROR 分支(:54715):ToRotation + 向左补 π,draw 侧向左水平镜像', () => {
    expect(townDrawSpec(585).rot).toBe('mirror-right');
    expect(rotOf(585, -3, -2)).toBeCloseTo(Math.atan2(-2, -3) + Math.PI, 6);
    expect(rotOf(585, 3, -2)).toBeCloseTo(Math.atan2(-2, 3), 6);
    // 行为侧:vx<0 → scale(-1,1) 被调用
    setScale(585);
    const left = new TownShot(0, 0, -6, 0, 16, 2, 585);
    const lr = makeAtlasR(null);
    left.draw(lr.r as never, undefined as never);
    expect(lr.calls.some((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1)).toBe(true);
    const right = new TownShot(0, 0, 6, 0, 16, 2, 585);
    const rr = makeAtlasR(null);
    right.draw(rr.r as never, undefined as never);
    expect(rr.calls.some((c) => c.m === 'scale')).toBe(false);
  });

  it('930 AI_016 镜像支(:44844-44849):+π/2 角 + 向左水平镜像(atan2(−vy,−vx)−π/2 ≡ 同角)', () => {
    expect(townDrawSpec(930).rot).toBe('up-mirror');
    expect(rotOf(930, 3, -2)).toBeCloseTo(Math.atan2(-2, 3) + Math.PI / 2, 6);
    setScale(930);
    const left = new TownShot(0, 0, -5, 0, 120, 0, 930);
    const lr = makeAtlasR(null);
    left.draw(lr.r as never, undefined as never);
    expect(lr.calls.some((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1)).toBe(true);
  });

  it('880 AI_183(:40418-40430):rotation 恒 0 + 向左镜像', () => {
    expect(townDrawSpec(880).rot).toBe('upright-mirror');
    expect(rotOf(880, -3, -2)).toBe(0);
  });

  it('586 AI_111_DryadsWard(:38728-38733):rotation = age×π/300,scale 生长钳 1', () => {
    expect(townDrawSpec(586).rot).toBe('grow');
    expect(rotOf(586, 0, 0, 0, 50)).toBeCloseTo(50 * (Math.PI / 300), 6);
    setScale(586);
    const shot = new TownShot(0, 0, 0, 0, 0, 3, 586, { noGravity: true });
    shot.life = shot.life - 50;                        // age=50 → gs=0.5
    const { calls, r } = makeAtlasR(null);
    shot.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[7]).toBeCloseTo(24 * 0.5, 5);           // 24×80 × 0.5
    expect(d.a[8]).toBeCloseTo(80 * 0.5, 5);
  });

  it('翻滚/自旋累积在 fixedUpdate 推进(tumble/spin)', () => {
    const shot = new TownShot(0, 0, 4, 0, 10, 1, 21);  // tumble
    const hooks = { world: { store: { isSolid: () => false } }, enemies: () => [] } as never;
    shot.fixedUpdate(1, hooks);
    shot.fixedUpdate(1, hooks);
    // 每 tick 先加重力 0.3 再累积(|vx|+|vy|)×0.03:(4.3 + 4.6)×0.03
    expect(shot.rotAcc).toBeCloseTo((4.3 + 4.6) * 0.03, 6);
    const spin = new TownShot(0, 0, 4, 0, 10, 1, 582); // spin π/10
    spin.fixedUpdate(1, hooks);
    spin.fixedUpdate(1, hooks);
    expect(spin.rotAcc).toBeCloseTo(2 * (Math.PI / 10), 6);
  });

  it('未知弹型回落 AI_001 默认 +π/2', () => {
    expect(townDrawSpec(9999).rot).toBe('up');
  });
});

// ============================================================ TownShot 帧号
describe('townFrameIndex(帧源锚)', () => {
  it('880 每 tick +1 钳末帧(AI_183 :40427-40430,8 帧 → 钳 7)', () => {
    expect(townFrameIndex(880, 3, 0, 0)).toBe(3);
    expect(townFrameIndex(880, 100, 0, 0)).toBe(7);
  });
  it('589 列 = ai[1](出生 rand5,NPC.cs:54953)', () => {
    expect(townFrameIndex(589, 0, 4, 0)).toBe(4);
    expect(townFrameIndex(589, 0, 9, 0)).toBe(4);      // 钳上界
    expect(townFrameIndex(589, 0, -1, 0)).toBe(0);     // 钳下界
  });
  it('590 基组 = ai[2](0→0..2 / 1→3..5)+ age/4 三帧循环(AI_112 :33025-33038)', () => {
    expect(townFrameIndex(590, 0, 0, 0)).toBe(0);
    expect(townFrameIndex(590, 4, 0, 0)).toBe(1);
    expect(townFrameIndex(590, 9, 0, 0)).toBe(0 + 2);
    expect(townFrameIndex(590, 0, 0, 1)).toBe(3);
    expect(townFrameIndex(590, 5, 0, 1)).toBe(3 + 1);
  });
  it('其余单帧/恒帧 0(456 族 AI_001 不推帧);585 乒乓帧机(BJ704-G2 勘误)', () => {
    // ★BJ704-G2（2026-10-21,债① 585 员勘误）:AI_001 585 专属块【推帧】——
    //  :57095-57104 frameCounter 12 循环 → frame=fc/2、>3 → 6−fc/2（乒乓
    //  0,1,1,2,2,3,3,2,2,1,1,0 周期 12;旧注「585 恒帧 0」系误读）。999%12=3 → 帧 1。
    expect(townFrameIndex(585, 999, 0, 0)).toBe(1);
    expect(townFrameIndex(1, 999, 0, 0)).toBe(0);
  });
});

// ============================================================ SquidCloud 813
describe('SquidCloud 813(AI_108 :32619-32767 三段视觉)', () => {
  it('纯函数:生长 51-90 / 定格 91-120 / 收缩 >120', () => {
    const v51 = squidCloudVisual(51);
    expect(v51.scale).toBeCloseTo(1 / 40, 6);
    expect(v51.rotation).toBeCloseTo(-Math.PI / 20, 6);
    const v90 = squidCloudVisual(90);
    expect(v90.scale).toBe(1);
    expect(v90.rotation).toBeCloseTo(-40 * (Math.PI / 20), 6);       // -2π
    const v120 = squidCloudVisual(120);
    expect(v120.scale).toBe(1);
    expect(v120.rotation).toBeCloseTo(-40 * (Math.PI / 20) - 30 * (Math.PI / 60), 6);
    const v140 = squidCloudVisual(140);
    expect(v140.scale).toBeCloseTo(1 - 20 / 60, 6);
  });

  it('绘制 = 原生 72×72 × scale(不再归一 32×32 判定盒)', () => {
    const c = new SquidCloud(100, 100);
    const hooks = { spawnParticles: () => {}, entities: { nextId: 1, add: () => {} } } as never;
    for (let t = 0; t < 100; t++) c.fixedUpdate(1, hooks);
    const { calls, r } = makeAtlasR(fakeImg(72, 72));
    c.draw(r);
    const d = calls.find((x) => x.m === 'drawImage')!;
    expect(d.a[3]).toBeCloseTo(72, 5);                 // dw = 72(scale=1 段)
    expect(d.a[4]).toBeCloseTo(72, 5);                 // dh
  });
});

// ============================================================ 月噬弹 456
describe('MoonLeechProj 456(Main.projFrames[456]=4,Main.cs:8490;aiStyle 85 不推帧)', () => {
  it('整条 22×96 切成帧 0 格 22×24,不再压进 16×16(胶片条)', () => {
    NEXT_IMG = { w: 22, h: 96 };
    const src = { id: 1, cx: 0, cy: 0 } as never;
    const player = { cx: 100, cy: 0 } as never;
    const p = new MoonLeechProj(src, player);
    const { calls, r } = makeAtlasR(null);
    p.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[4]).toBeCloseTo(24, 5);                 // sh = 96/4
    expect(d.a[7]).toBeCloseTo(22, 5);                 // dw = 原生帧宽
    expect(d.a[8]).toBeCloseTo(24, 5);
  });
});

// ============================================================ DD2 681/683
describe('DD2GoblinBomb 681(原生 14×20,Main.cs:29805/29811/29856)', () => {
  it('目标矩形 = 原生 14×20(不再掐成 14×14),origin (7,13)', () => {
    const b = new DD2GoblinBomb(0, 0, -5, 0, 20);
    const { calls, r } = makeAtlasR(fakeImg(14, 20));
    b.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;   // 5 参:(img, dx, dy, dw, dh)
    expect(d.a[1]).toBeCloseTo(-7, 5);                 // dx = -originX
    expect(d.a[2]).toBeCloseTo(-13, 5);                // dy = -(h/2+num143=6)
    expect(d.a[3]).toBeCloseTo(14, 5);                 // dw 原生
    expect(d.a[4]).toBeCloseTo(20, 5);
  });
  it('velocity.X>0 → 水平镜像(:29811 ^= FlipHorizontally)', () => {
    const right = new DD2GoblinBomb(0, 0, 5, 0, 20);
    const rr = makeAtlasR(fakeImg(14, 20));
    right.draw(rr.r as never, undefined as never);
    expect(rr.calls.some((c) => c.m === 'scale' && c.a[0] === -1)).toBe(true);
    const left = new DD2GoblinBomb(0, 0, -5, 0, 20);
    const lr = makeAtlasR(fakeImg(14, 20));
    left.draw(lr.r as never, undefined as never);
    expect(lr.calls.some((c) => c.m === 'scale')).toBe(false);
  });
});

describe('DD2OgreSmash 683(SetDefaults alpha=255,:7003-7012 → 原版不可见)', () => {
  it('不绘制本体(曾画成随盒扩张的贴图,盒扩到 640²)', () => {
    const s = new DD2OgreSmash(0, 0, 30);
    const { calls, r } = makeAtlasR(fakeImg(16, 16));
    s.draw(r as never, undefined as never);
    expect(calls.filter((c) => c.m === 'drawImage' || c.m === 'fillRect')).toHaveLength(0);
  });
});

// ============================================================ 鹿角怪 961/962/965
describe('DeerclopsSpikeProj 961(Frame(1,5) Main.cs:31004;rotation=ToRotation :48485)', () => {
  it('200×240 切五行 → 帧格 200×48 × scale(Opacity*ai1),不再 32×32', () => {
    const p = new DeerclopsSpikeProj(0, 0, -Math.PI / 2, 13, 0.5);
    for (let t = 0; t < 10; t++) p.fixedUpdate(1, { spawnParticles: () => {}, playSfxFiles: () => {}, playSfx: () => {} } as never);
    const { calls, r } = makeAtlasR(fakeImg(200, 240));
    p.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[4]).toBeCloseTo(48, 5);                       // sh = 240/5
    expect(d.a[7]).toBeCloseTo(200 * 1 * 0.5, 4);            // dw = 200 × scale
    expect(d.a[8]).toBeCloseTo(48 * 1 * 0.5, 4);             // dh = 48 × scale
  });
  it('旋转 = 出生角本身(无 +π/2 偏置,曾把横置冰泪竖过来)', () => {
    const p = new DeerclopsSpikeProj(0, 0, -Math.PI / 2, 13, 1);
    const { calls, r } = makeAtlasR(fakeImg(200, 240));
    p.draw(r as never, undefined as never);
    const rot = calls.find((c) => c.m === 'rotate')!;
    expect(rot.a[0]).toBeCloseTo(-Math.PI / 2, 6);
  });
  it('origin (16, 24) = (16, 帧高/2)(Main.cs:31005)——dx = -16×scale', () => {
    const p = new DeerclopsSpikeProj(0, 0, 0, 13, 1);
    for (let t = 0; t < 10; t++) p.fixedUpdate(1, { spawnParticles: () => {}, playSfxFiles: () => {}, playSfx: () => {} } as never);  // Opacity 长满 → scale=1
    const { calls, r } = makeAtlasR(fakeImg(200, 240));
    p.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    expect(d.a[5]).toBeCloseTo(-16, 5);
    expect(d.a[6]).toBeCloseTo(-24, 5);
  });
});

describe('DeerclopsRubbleProj 962(Frame(3,4) Main.cs:32828-32834;:54039 出世定型)', () => {
  it('102×136 按 3×4 网格切(帧格 34×34),不再 4 列×3 行非整数格', () => {
    const p = new DeerclopsRubbleProj(0, 0, 3, -4, 18, 7);
    const { calls, r } = makeAtlasR(fakeImg(102, 136));
    p.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;
    // frame=7 → frameX=7%3=1 → sx=34;frameY=2 → sy=68
    expect(d.a[1]).toBeCloseTo(34, 5);
    expect(d.a[2]).toBeCloseTo(68, 5);
    expect(d.a[3]).toBeCloseTo(34, 5);
    expect(d.a[4]).toBeCloseTo(34, 5);
    expect(d.a[7]).toBeCloseTo(34, 5);                 // 原生帧格(scale=1,不归一 32×32)
    expect(d.a[8]).toBeCloseTo(34, 5);
  });
  it('姿态角出生定型(:54039),不随当前速度重算', () => {
    const p = new DeerclopsRubbleProj(0, 0, 3, -4, 18, 0);
    p.vy = 16;                                          // 重力坠落中,姿态不变
    const { calls, r } = makeAtlasR(fakeImg(102, 136));
    p.draw(r as never, undefined as never);
    const rot = calls.find((c) => c.m === 'rotate')!;
    expect(rot.a[0]).toBeCloseTo(Math.atan2(-4, 3), 6);
  });
});

describe('InsanityShadowProj 965(原生 80×84;origin Main.cs:29934-29937;镜像 AI_187 :39850)', () => {
  it('朝右:80×84 原生(origin X=W-20=60),不再 40×40', () => {
    const p = new InsanityShadowProj({ cx: 0, cy: 0, vx: 0 }, 10);
    (p as unknown as { vx: number }).vx = 4;            // 朝右
    const { calls, r } = makeAtlasR(fakeImg(80, 84));
    p.draw(r as never, undefined as never);
    const d = calls.find((c) => c.m === 'drawImage')!;   // 5 参:(img, dx, dy, dw, dh)
    expect(d.a[1]).toBeCloseTo(-60, 5);
    expect(d.a[2]).toBeCloseTo(-42, 5);
    expect(d.a[3]).toBeCloseTo(80, 5);
    expect(d.a[4]).toBeCloseTo(84, 5);
  });
  it('朝左:水平镜像 + origin X=20(spriteDirection=-1)', () => {
    const p = new InsanityShadowProj({ cx: 0, cy: 0, vx: 0 }, 10);
    (p as unknown as { vx: number }).vx = -4;
    const { calls, r } = makeAtlasR(fakeImg(80, 84));
    p.draw(r as never, undefined as never);
    expect(calls.some((c) => c.m === 'scale' && c.a[0] === -1 && c.a[1] === 1)).toBe(true);
    const d = calls.find((c) => c.m === 'drawImage')!;   // 5 参:dx = a[1]
    expect(d.a[1]).toBeCloseTo(-20, 5);
  });
});

// ============================================================ LunarOrb 539/574
describe('LunarOrb 539/574(原生帧 × scale,Main.cs:32812 列表族 :32889 origin Size/2)', () => {
  beforeAll(() => {
    // projFrameImg 走 document.createElement —— 桩出极简 canvas
    vi.stubGlobal('document', {
      createElement: () => {
        const c = { width: 0, height: 0 };
        const inner = makeRecCtx();
        return Object.assign(c, { getContext: () => inner.ctx });
      },
    });
  });
  it('539:24×136 四帧行 → 帧格 24×34(不再归一 18×30 判定盒)', () => {
    NEXT_IMG = { w: 24, h: 136 };
    const orb = new LunarOrb(null, 539, 3, 0, 10, 0, 0);
    const { calls, r } = makeAtlasR(null);
    orb.draw(r as never, undefined as never);
    const dAll = calls.filter((c) => c.m === 'drawImage'); const d = dAll[dAll.length - 1];   // 5 参:(img, dx, dy, dw, dh)
    expect(d.a[3]).toBeCloseTo(24, 5);                 // dw = 原生帧宽
    expect(d.a[4]).toBeCloseTo(34, 5);                 // dh = 136/4
  });
  it('574:24×48 两帧行 → 帧格 24×24(不再归一 18×18)', () => {
    NEXT_IMG = { w: 24, h: 48 };
    const orb = new LunarOrb(null, 574, 3, 0, 10, 0, 0);
    const { calls, r } = makeAtlasR(null);
    orb.draw(r as never, undefined as never);
    const dAll = calls.filter((c) => c.m === 'drawImage'); const d = dAll[dAll.length - 1];   // 5 参:(img, dx, dy, dw, dh)
    expect(d.a[3]).toBeCloseTo(24, 5);                 // dw
    expect(d.a[4]).toBeCloseTo(24, 5);                 // dh = 48/2
  });
});

// ============================================================ 数据一致性闸门
describe('帧数权威 = Main.projFrames(json 提取)对本批弹型', () => {
  it('456=4 / 539=4 / 574=2 / 585=4 / 880=8(Main.cs:8490/:8498/:8500/:8637)', () => {
    expect(projFrameCount(456)).toBe(4);
    expect(projFrameCount(539)).toBe(4);
    expect(projFrameCount(574)).toBe(2);
    expect(projFrameCount(585)).toBe(4);
    expect(projFrameCount(880)).toBe(8);
  });
  it('962=3(projFrames)但网格是 Frame(3,4)——竖排 3 与横向 4 不冲突(Main.cs:8645/:32828)', () => {
    expect(projFrameCount(962)).toBe(3);
  });
});

// 类型自锁:TownRotMode 覆盖九种(防误删分支)
describe('TownRotMode 全枚举在表内出现(防分支误删)', () => {
  const ALL: TownRotMode[] = ['up', 'up20', 'tumble', 'roll', 'spin', 'mirror-right', 'up-mirror', 'upright', 'upright-mirror', 'grow'];
  for (const m of ALL) {
    it(`模式 ${m} 存在于规格表`, () => {
      const modeOf: Record<TownRotMode, number> = {
        up: 1, up20: 48, tumble: 21, roll: 30, spin: 582,
        'mirror-right': 585, 'up-mirror': 930, upright: 15, 'upright-mirror': 880, grow: 586,
      };
      expect(townDrawSpec(modeOf[m]).rot).toBe(m);
    });
  }
});
