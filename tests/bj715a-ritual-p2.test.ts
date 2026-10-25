// BJ715-A — R18-P2 清偿·DD2/仪式域五件判别锁（2026-10-25）。
// 权威锚（Terarria1457 亲读复核,R18 锚抽验全数成立）：
//  ①枯萎兽攻击梯 FindFrame case 568/569（NPC.cs:67793-67999）：基值 7 + 27 级阈值梯
//    （阈值 5i,i=1..27 → 8,9,10,7,8,9,10×5,11,12,13,14）= 6 轮 7-8-9-10（fc 1-119）
//    后 11/12/13（120-134）、135 拍起持 14;fc≥270 减 10 续持。旧式差一轮（fc∈
//    [100,134] 35 拍逐档超前）。R18 夹具 /tmp/bj713r18-ladder-check.mjs 300/300。
//  ②574/575 口部锚（NPC.cs:68687 vector4）消费 npc.rotation=AI_108 折叠值：
//    :66131 直写 atan2(vy,vx) + :66281-66287 无条件 ±π/2 折叠;FindFrame :68661-68668
//    AngleTowards 目标=同折叠式值 → 精确 no-op。修前裸 atan2,vx<0 锚过心镜像
//    （R18 夹具 7/7）。
//  ③CultistRitual 谓词域（CultistRitual.cs:85/:117 + WorldGen.cs:70642）：
//    y-7 门/柱第一臂=WorldGen.SolidTile 严格式（isSolidStrict,排半砖/坡/致动）;
//    柱第二臂=TileID.Sets.Platforms[type] 纯 type（isPlatformsType,不看 active/
//    致动/frameY）;净空臂=Collision.SolidTiles（isSolid 原式,:3468-3499）。
//    两副本（RuntimeEvents/lunar_misc）收编单源 cultistCheckFloorPts。
//  ④出生高度 NewNPC Bottom 锚（NPC.cs:81597 nPC.Bottom=(X,Y)）：四教徒
//    Y=spawnPoints.Y*16-48（:37140,底=落点面上浮 48px 坠落入场）;439 Y=num1244*16-2
//    （:37193,底=落地列面上浮 2px）。旧「顶锚」误读=贴地站。
//  ⑤枯萎兽灵气尘面（NPC.cs:64080-64109）：d271 自闪耀 1/10 无目标门（TopLeft 盒,
//    vy−3,α0,Transparent,0.6,后置 vx/=2+noGravity+fadeIn1.5+y+4）+d27 环带
//    localAI[0]>60 ∧ 1/10（Center+随机角×400×(0.3+0.7r),非实心格门=SolidTile 严格,
//    NewDustPerfect 27 径向外向×3,fadeIn 1.5）。音面 GetActiveSound-空则重播
//    （:64087-64095）登记债 D-⑤S 未落（Game.ts BJ714-A 在途域禁触）。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { Enemy } from '../src/entities/Enemy';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { cultistCheckFloorPts, cultistTrySpawning, type CultistHost } from '../src/world/evolution/RuntimeEvents';
import { ritualCheckFloor, lunarLocalAI } from '../src/entities/bossAI_lunar_misc';
import { ai107ImprovedWalkers } from '../src/entities/bossAI_dd2';

const GAME = join(__dirname, '..');
const enemySrc = readFileSync(join(GAME, 'src/entities/Enemy.ts'), 'utf8');
const eventsSrc = readFileSync(join(GAME, 'src/world/evolution/RuntimeEvents.ts'), 'utf8');
const lunarSrc = readFileSync(join(GAME, 'src/entities/bossAI_lunar_misc.ts'), 'utf8');
const dd2Src = readFileSync(join(GAME, 'src/entities/bossAI_dd2.ts'), 'utf8');
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// 件1：枯萎兽 568/569 攻击梯六轮闭式（NPC.cs:67809-67999 27 级阈值梯）
// ---------------------------------------------------------------------------
/** 原版 27 级阈值梯（阈值 5i,i=1..27;R18 夹具同式） */
const LADDER_SEQ = [8, 9, 10, 7, 8, 9, 10, 7, 8, 9, 10, 7, 8, 9, 10, 7, 8, 9, 10, 7, 8, 9, 10, 11, 12, 13, 14];
function vanillaLadder(fc: number): number {
  let f = 7;
  for (let i = 1; i <= 27; i++) if (fc >= 5 * i) f = LADDER_SEQ[i - 1];
  if (fc >= 270) f = 14;
  return f;
}
type FrameStepper = { dd2WalkerFindFrame(): void };
const step = (e: Enemy, n = 1): void => {
  const s = e as unknown as FrameStepper;
  for (let i = 0; i < n; i++) s.dd2WalkerFindFrame();
};

describe('BJ715-A 件1：枯萎兽攻击梯六轮闭式（fc∈[100,134] 判别带）', () => {
  it('逐拍对拍原版 27 级梯 300/300（R18 夹具范式复跑）', () => {
    const e = Enemy.fromVanilla(568, 0, 0)!;
    e.vx = 0; e.vy = 0; e.ai0 = 110;                 // ai0>0 恒驻攻击档
    let bad = 0;
    for (let fc = 1; fc <= 300; fc++) {
      step(e);
      if (e.customFrameIdx !== vanillaLadder(fc)) {
        if (bad === 0) console.error(`首差 fc=${fc} sw=${e.customFrameIdx} vanilla=${vanillaLadder(fc)}`);
        bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('判别带逐档：fc 100→7(旧 8)/119→10/120→11/130→13/134→13/135→14 持续', () => {
    const e = Enemy.fromVanilla(568, 0, 0)!;
    e.vx = 0; e.vy = 0; e.ai0 = 110;
    step(e, 99);                                     // fc=99
    expect(e.customFrameIdx).toBe(10);               // 第 5 轮尾（q=19）
    step(e);                                         // fc=100 → q=20 第 6 轮 7（旧式 8）
    expect(e.customFrameIdx).toBe(7);
    step(e, 19);                                     // fc=119
    expect(e.customFrameIdx).toBe(10);
    step(e);                                         // fc=120 → 11（旧式 12）
    expect(e.customFrameIdx).toBe(11);
    step(e, 10);                                     // fc=130 → 13（旧式 14）
    expect(e.customFrameIdx).toBe(13);
    step(e, 4);                                      // fc=134 → 13
    expect(e.customFrameIdx).toBe(13);
    step(e);                                         // fc=135 → 14 起
    expect(e.customFrameIdx).toBe(14);
    step(e, 200);                                    // fc 135..270 续持 14（270 回卷 −10）
    expect(e.customFrameIdx).toBe(14);
  });

  it('结构锁：六轮闭式在位,旧五轮式退役', () => {
    expect(enemySrc).toContain('q < 24 ? 7 + (q % 4) : Math.min(14, 11 + (q - 24))');
    expect(enemySrc).not.toContain('8 + (q - 20)');
  });
});

// ---------------------------------------------------------------------------
// 件2：574/575 口部锚 ±π/2 折叠（AI_108 :66281-66287 → :68687 消费）
// ---------------------------------------------------------------------------
interface DustRec {
  bx: number; by: number; bw: number; bh: number; type: number;
  sx: number; sy: number; alpha: number; scale: number; noGravity: boolean; perfect: boolean;
  x: number; y: number; vx: number; vy: number; fadeIn: number;
}
function dustGame(): { game: GameHooks; spawns: DustRec[] } {
  const spawns: DustRec[] = [];
  const game = {
    spawnDust: (x: number, y: number, w: number, h: number, type: number,
      sx: number, sy: number, alpha: number, _c: unknown, scale: number,
      noGravity = false, perfect = false) => {
      const d: DustRec = {
        bx: x, by: y, bw: w, bh: h, type, sx, sy, alpha, scale,
        noGravity, perfect, x, y, vx: sx, vy: sy, fadeIn: 0,
      };
      spawns.push(d);
      return d;
    },
  } as unknown as GameHooks;
  return { game, spawns };
}
const makeKobold = (vx: number, vy: number) => {
  const e = Enemy.fromVanilla(574, 40 * TILE, 60 * TILE)!;
  e.ai0 = 1; e.vx = vx; e.vy = vy;
  return e;
};
const driveKobold = (e: Enemy, game: GameHooks) =>
  (e as unknown as { findFrameRotation(g?: GameHooks): void }).findFrameRotation(game);

describe('BJ715-A 件2：口部锚折叠（vx<0 不再过心镜像）', () => {
  it('vx=-8,vy=0：帧 9 火舌 8 粒于 (cx−56, cy−30)（旧式镜像 (cx+56, cy+30)）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);   // 拖尾掷静默
    const { game, spawns } = dustGame();
    const e = makeKobold(-8, 0);
    for (let i = 0; i < 44; i++) driveKobold(e, game); // t44 落帧 9 burst
    expect(e.customFrameIdx).toBe(9);
    expect(spawns.length).toBe(8);
    for (const d of spawns) {
      expect(d.type).toBe(6);
      expect(d.bx).toBeCloseTo(e.cx - 56, 6);          // 折叠后 rot=π−π=0、sdir=−1
      expect(d.by).toBeCloseTo(e.cy - 30, 6);
    }
  });

  it('vx=-5,vy=5 斜向：锚=(cx−60.8, cy+18.4)（R18 夹具 vanillaAnchor(−5,5) 同值）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { game, spawns } = dustGame();
    const e = makeKobold(-5, 5);
    for (let i = 0; i < 44; i++) driveKobold(e, game);
    expect(spawns.length).toBe(8);
    // raw=3π/4 → 折叠 −π/4;sdir=−1 → (−56,−30).RotatedBy(−π/4)=(−60.8,+18.4)
    for (const d of spawns) {
      expect(d.bx).toBeCloseTo(e.cx - 60.811, 2);
      expect(d.by).toBeCloseTo(e.cy + 18.385, 2);
    }
  });

  it('结构锁：AI_108 折叠两行在位', () => {
    expect(enemySrc).toContain('if (rot < -Math.PI / 2) rot += Math.PI;');
    expect(enemySrc).toContain('if (rot > Math.PI / 2) rot -= Math.PI;');
  });
});

// ---------------------------------------------------------------------------
// 件3：CultistRitual CheckFloor/CheckRitual 谓词域（单源 cultistCheckFloorPts）
// ---------------------------------------------------------------------------
// 几何：tx=80,ty=53（≙ 仪式锚 y=60 的 CheckFloor 中心）;四柱 x=70/74/86/90,
// 扫描窗 y=48..64,地板带 y=62,上方 59-61 净空。
const COLS = [70, 74, 86, 90];
function makeRitualWorld(): World {
  const w = new World(160, 120, 7, 'bj715a-ritual');
  for (const x of COLS) w.store.setTile(x, 62, 1);
  return w;
}
const CF_CX = 80 * 16 + 8, CF_CY = 53 * 16 + 8;

describe('BJ715-A 件3：柱谓词域（isSolidStrict + isPlatformsType 纯 type）', () => {
  it('基线：四柱全整砖 → 4 点齐', () => {
    const w = makeRitualWorld();
    const pts = cultistCheckFloorPts(w.store, CF_CX, CF_CY);
    expect(pts).not.toBeNull();
    expect(pts!.map((p) => p.x)).toEqual(COLS);
    expect(pts!.every((p) => p.y === 62)).toBe(true);
  });

  it('半砖柱：isSolid 真/isSolidStrict 假 → 3 点 null（旧 isSolid 宽谓词 4 点）', () => {
    const w = makeRitualWorld();
    w.store.setHalfBrick(70, 62, true);
    expect(w.store.isSolid(70, 62)).toBe(true);        // 宽谓词域（旧代码命中面）
    expect(w.store.isSolidStrict(70, 62)).toBe(false); // WorldGen.SolidTile :70642
    expect(cultistCheckFloorPts(w.store, CF_CX, CF_CY)).toBeNull();
  });

  it('坡面柱：slope=1 同病 → null', () => {
    const w = makeRitualWorld();
    w.store.setSlope(70, 62, 1);
    expect(cultistCheckFloorPts(w.store, CF_CX, CF_CY)).toBeNull();
  });

  it('致动平台柱：纯 type 谓词照算地板（旧 isPlatform 排除致动 → null）', () => {
    const w = makeRitualWorld();
    w.store.setTile(70, 62, 11);                       // 内部 11 = vanilla 19 平台
    w.store.setActuated(70, 62, true);
    expect(w.store.isPlatform(70, 62)).toBe(false);    // 旧代码不命中
    expect(w.store.isPlatformsType(70, 62)).toBe(true); // TileID.Sets.Platforms[type]
    const pts = cultistCheckFloorPts(w.store, CF_CX, CF_CY);
    expect(pts).not.toBeNull();
    expect(pts!.length).toBe(4);
  });

  it('普通平台柱：两谓词皆真 → 4 点（回归面）', () => {
    const w = makeRitualWorld();
    w.store.setTile(70, 62, 11);
    expect(w.store.isPlatform(70, 62)).toBe(true);
    expect(w.store.isPlatformsType(70, 62)).toBe(true);
    expect(cultistCheckFloorPts(w.store, CF_CX, CF_CY)).not.toBeNull();
  });

  it('家具顶柱（桌 14）：isPlatform 真/isPlatformsType 假 → null（旧代码 4 点）', () => {
    const w = makeRitualWorld();
    w.store.setTile(70, 62, 61);                       // 内部 61 = vanilla 14 桌
    expect(w.store.isPlatform(70, 62)).toBe(true);     // frameY==0 可站顶宽谓词
    expect(w.store.isPlatformsType(70, 62)).toBe(false);
    expect(cultistCheckFloorPts(w.store, CF_CX, CF_CY)).toBeNull();
  });

  it('y-7 门同病：锚上方 7 格半砖不阻仪式（旧 isSolid 阻）/整砖仍阻', () => {
    const mkHost = (w: World): CultistHost => ({
      world: w, dungeonX: 80, dungeonY: 60,
      hardMode: true, downedGolem: true, downedBoss3: true,
      anyTablet: () => false, anyDanger: () => false,
      playerLOS: () => false, spawnTablet: () => true,
    });
    const w1 = makeRitualWorld();
    w1.cultistDelay = 0;
    w1.store.setTile(80, 53, 1);                       // y-7 = 60-7 = 53
    w1.store.setHalfBrick(80, 53, true);
    expect(w1.store.isSolid(80, 53)).toBe(true);
    expect(w1.store.isSolidStrict(80, 53)).toBe(false);
    expect(cultistTrySpawning(w1, 80, 60, mkHost(w1), false)).toBe(true);   // ★新式过门
    const w2 = makeRitualWorld();
    w2.cultistDelay = 0;
    w2.store.setTile(80, 53, 1);                       // 整砖仍阻
    expect(cultistTrySpawning(w2, 80, 60, mkHost(w2), false)).toBe(false);
  });

  it('单源委托：lunar_misc.ritualCheckFloor 与 RuntimeEvents 同点集', () => {
    const w = makeRitualWorld();
    const game = { world: w } as unknown as GameHooks;
    expect(ritualCheckFloor(game, CF_CX, CF_CY)).toEqual(cultistCheckFloorPts(w.store, CF_CX, CF_CY));
    w.store.setHalfBrick(74, 62, true);
    expect(ritualCheckFloor(game, CF_CX, CF_CY)).toBeNull();
  });

  it('结构锁：两副本谓词勘正在位,旧谓词退役', () => {
    expect(eventsSrc).toContain('st.isSolidStrict(x, y - 7)');
    expect(eventsSrc).toContain('st.isSolidStrict(x, y) || st.isPlatformsType(x, y)');
    expect(eventsSrc).not.toContain('st.isPlatform(x, y)');
    expect(lunarSrc).toContain('cultistCheckFloorPts(game.world.store, cx, cy)');
    expect(lunarSrc).toContain('isSolidStrict(tx, y)');      // 439 侧面扫列 :37199
    expect(eventsSrc).not.toContain('function cultistCheckFloor(');
  });
});

// ---------------------------------------------------------------------------
// 件4：仪式四教徒/439 出生高度（NewNPC Bottom 锚 :81597）
// ---------------------------------------------------------------------------
const Wt = 160, Ht = 120, TX = 80, TY = 52, FLOOR_Y = 60;
function makeCultistWorld(): World {
  const w = new World(Wt, Ht, 7, 'bj715a-height');
  for (let x = 60; x <= 100; x++) w.store.setTile(x, FLOOR_Y, 1);
  return w;
}
function makeCultistHooks(world: World) {
  const enemies: Enemy[] = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: string) => {
      (e as { id: number }).id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
    },
  };
  const hooks = {
    world, player: { x: 80 * TILE, y: 55 * TILE, w: 20, h: 42, cx: 80 * TILE + 10, cy: 55 * TILE + 21,
      vx: 0, vy: 0, hp: 400, maxHp: 400, dead: false, iframes: 0, luck: 0,
      aabbOverlaps: () => false, useTime: 1, addDPS: () => {} },
    enemies: () => enemies, critters: () => [], entities: em,
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxWav: () => {}, playSfxFiles: () => {},
    showPickupLabel: () => {}, spawnDust: () => null,
  } as unknown as GameHooks;
  return { hooks, enemies, em };
}
function tickCultists(h: ReturnType<typeof makeCultistHooks>, n: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < h.enemies.length; j++) {
      const e = h.enemies[j];
      if (!e.dead) e.fixedUpdate(1 / 60, h.hooks);
    }
  }
}
const liveCultists = (h: ReturnType<typeof makeCultistHooks>) =>
  h.enemies.filter((n) => (n.vanillaId === 438 || n.vanillaId === 379) && !n.dead);

describe('BJ715-A 件4：Bottom 锚出生高度（48px 悬浮坠落入场）', () => {
  it('四教徒出生底=落点面−48px 悬浮（旧贴地站）→ 140t 内落地', () => {
    const h = makeCultistHooks(makeCultistWorld());
    const tablet = Enemy.fromVanilla(437, TX * TILE + 8, TY * TILE + 8)!;
    h.em.add(tablet, 'enemies');
    tickCultists(h, 1);
    const kids = liveCultists(h);
    expect(kids.length).toBe(4);
    const floorTop = FLOOR_Y * TILE;
    for (const k of kids) {
      const bottom = k.y + k.h;
      expect(bottom, '出生悬浮 48px 带（含首拍重力 ≤1px）').toBeLessThan(floorTop - 40);
      expect(bottom).toBeGreaterThan(floorTop - 49);
    }
    tickCultists(h, 140);                              // 重力 0.3/t² ≈18t 落定
    for (const k of liveCultists(h)) {
      expect(Math.abs((k.y + k.h) - floorTop)).toBeLessThan(0.5);
    }
  });

  it('439 出生底=落地列面−2px（旧贴地对齐差 2px）', () => {
    const h = makeCultistHooks(makeCultistWorld());
    const tablet = Enemy.fromVanilla(437, TX * TILE + 8, TY * TILE + 8)!;
    h.em.add(tablet, 'enemies');
    tickCultists(h, 3);
    for (const c of liveCultists(h)) c.dead = true;
    let boss: Enemy | undefined;
    for (let i = 0; i < 6 && !boss; i++) {
      tickCultists(h, 1);
      boss = h.enemies.find((n) => n.vanillaId === 439 && !n.dead);
    }
    expect(boss).toBeTruthy();
    const floorTop = FLOOR_Y * TILE;
    const bottom = boss!.y + boss!.h;
    expect(bottom, '底=tileY*16−2（含首拍位移余量）').toBeLessThan(floorTop - 0.1);
    expect(bottom).toBeGreaterThan(floorTop - 6);
  });

  it('结构锁：Bottom 锚换算在位', () => {
    expect(lunarSrc).toContain('pts[k].y * TILE - 48 - child.h');
    expect(lunarSrc).toContain('ty * TILE - 2 - cultist.h');
    expect(lunarSrc).not.toContain('pts[k].y * TILE - child.h');
  });
});

// ---------------------------------------------------------------------------
// 件5：枯萎兽灵气尘面（d271 自闪耀 + d27 环带,音面 D-⑤S 登记债）
// ---------------------------------------------------------------------------
describe('BJ715-A 件5：灵气尘 1:1（d271/d27,无目标门）', () => {
  it('d271 自闪耀：每拍 1/10（random=0 恒中）TopLeft 盒 + 后置链;61 拍起 d27 环带', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const w = new World(220, 160, 7, 'bj715a-aura');
    for (let x = 0; x < 220; x++) { w.store.setTile(x, 120, 1); w.store.setTile(x, 121, 1); }
    const { game, spawns } = dustGame();
    const e = Enemy.fromVanilla(568, 90 * TILE, 0)!;
    e.y = 120 * TILE - e.h;                            // 落地
    e.vx = 0; e.vy = 0;
    const hooks = {
      ...game, world: w, player: null,
      enemies: () => [e], critters: () => [], spawnParticles: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
    } as unknown as GameHooks;
    ai107ImprovedWalkers(e, hooks, null);              // 首驱（bInit 清 ai0）
    e.ai0 = 1;                                         // 灵气态驻留（1↔2 振荡）
    ai107ImprovedWalkers(e, hooks, null);
    ai107ImprovedWalkers(e, hooks, null);              // 2 拍落定（首拍碰撞 ε 沉降）
    let xMin = e.x, xMax = e.x, yMin = e.y, yMax = e.y;
    spawns.length = 0;                                 // 落定期尘不计入观测窗
    for (let i = 0; i < 68; i++) {
      ai107ImprovedWalkers(e, hooks, null);
      xMin = Math.min(xMin, e.x); xMax = Math.max(xMax, e.x);
      yMin = Math.min(yMin, e.y); yMax = Math.max(yMax, e.y);   // 站定碰撞 ε 蠕动带
    }
    const glow = spawns.filter((d) => d.type === 271);
    const ring = spawns.filter((d) => d.type === 27);
    expect(glow.length).toBe(68);                      // 每拍 1 粒（1/10 恒中）
    for (const d of glow) {
      expect(d.bx).toBeGreaterThanOrEqual(xMin - 0.01);   // TopLeft 盒（NewDustDirect）
      expect(d.bx).toBeLessThanOrEqual(xMax + 0.01);
      expect(d.by).toBeGreaterThanOrEqual(yMin - 0.01);
      expect(d.by).toBeLessThanOrEqual(yMax + 0.01);
      expect(d.bw).toBe(e.w); expect(d.bh).toBe(e.h);
      expect(d.sy).toBe(-3); expect(d.alpha).toBe(0);
      expect(d.scale).toBeCloseTo(0.6, 9);
      expect(d.noGravity).toBe(true);
      expect(d.fadeIn).toBe(1.5);                      // 后置链
      expect(d.y - d.by).toBeCloseTo(4, 9);            // position.Y += 4（后置写观测）
      expect(d.vx).toBeCloseTo(0, 9);                  // (jitter+0)/2——桩无抖动基面
    }
    // d27 环带：localAI[0]>60 起每拍 1 粒（tick 61..70 = 10 粒）;
    // random=0 → th=0、dist=400×0.3=120 → (cx+120, cy),径向外向 (3,0)
    expect(ring.length).toBe(10);
    for (const d of ring) {
      expect(d.perfect).toBe(true);                    // NewDustPerfect
      expect(d.bx).toBeGreaterThanOrEqual(xMin + e.w / 2 + 120 - 0.05);   // 蠕动带内
      expect(d.bx).toBeLessThanOrEqual(xMax + e.w / 2 + 120 + 0.05);
      expect(d.by).toBeGreaterThanOrEqual(yMin + e.h / 2 - 0.05);
      expect(d.by).toBeLessThanOrEqual(yMax + e.h / 2 + 0.05);
      expect(d.alpha).toBe(0);
      expect(d.vx).toBeCloseTo(3, 3);                  // DirectionTo(尘位)×|v|=3
      expect(d.vy).toBeCloseTo(0, 3);
      expect(d.fadeIn).toBe(1.5);
    }
  });

  it('环带实心格门：落点入整砖 → 不发（WorldGen.SolidTile 严格式）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const w = new World(220, 160, 7, 'bj715a-aura2');
    for (let x = 0; x < 220; x++) { w.store.setTile(x, 120, 1); w.store.setTile(x, 121, 1); }
    const e = Enemy.fromVanilla(568, 90 * TILE, 0)!;
    e.y = 120 * TILE - e.h;
    e.vx = 0; e.vy = 0;
    // 环点 (cx+120, cy)（random=0 → th=0、dist=120）的格位立整砖墙
    const wallX = Math.trunc((e.cx + 120) / 16);
    for (let y = 100; y < 120; y++) w.store.setTile(wallX, y, 1);
    const { game, spawns } = dustGame();
    const hooks = {
      ...game, world: w, player: null,
      enemies: () => [e], critters: () => [], spawnParticles: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
    } as unknown as GameHooks;
    ai107ImprovedWalkers(e, hooks, null);
    e.ai0 = 1;
    for (let i = 0; i < 70; i++) ai107ImprovedWalkers(e, hooks, null);
    expect(spawns.filter((d) => d.type === 271).length).toBe(70);   // 自闪耀无格门
    expect(spawns.filter((d) => d.type === 27).length).toBe(0);     // 环点全被实心格拦
  });

  it('结构锁：尘面常量在位,合并近似退役;音面登记债 D-⑤S 注释在位', () => {
    expect(dd2Src).toContain('271, 0, -3, 0');
    expect(dd2Src).toContain('400 * (0.3 + 0.7 * Math.random())');
    expect(dd2Src).toContain('isSolidStrict(Math.trunc(px / 16), Math.trunc(py / 16))');
    expect(dd2Src).not.toContain("'#C060FF', 1, 0.8"); // 旧合并近似粒子参退役
    expect(dd2Src).toContain('D-⑤S');                 // 音面窄判备案标记
  });
});
