// 2026-08-19 台账 G 区八项（G3/G4/G6/G7/G8/G9/G10/G11）定谳回归。
// 标杆 Terarria1456（行号见各用例注释）；1405 仅 G10 的 GetAlpha 可对读
//（1405 NPC.AI() 主体反编译缺失："The method is too long to display"）。
// 驱动方式 = 原型直调（drive 私有 AI 方法）+ Dart/MLDeathray 弹体直驱 +
// Renderer.prototype.drawEnemy 记录型 ctx 代理（G4 翻面通道）。
import { describe, it, expect, vi, afterEach } from 'vitest';
afterEach(() => { vi.restoreAllMocks(); });   // ★BJ712-C
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { Dart } from '../src/entities/Dart';
import { MLDeathray } from '../src/entities/bossAI_duke_moonlord';
import { bouncingBallAI } from '../src/entities/bossAI_moon_events';
import { graniteElementalAI } from '../src/entities/bossAI_lunar_misc';
import { vanillaFrameIdx, Renderer } from '../src/render/Renderer';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';

const W = 160, H = 140, FLOOR = 100;

function makeWorld(difficulty = 0): World {
  const w = new World(W, H, 11, 'parity-g');
  w.difficulty = difficulty;
  const st = w.store;
  for (let x = 0; x < W; x++) st.setTile(x, FLOOR, 1);
  w.clock.timeOfDay = 0.9;   // 夜间（白天驱散门不干扰）
  return w;
}

interface Rec {
  damageCalls: Array<{ dmg: number; x: number; y: number }>;
  enemies: Enemy[];
  projectiles: unknown[];
}

function makeHooks(w: World, playerAt?: { x: number; y: number } | null) {
  const rec: Rec = { damageCalls: [], enemies: [], projectiles: [] };
  let nextId = 1;
  const em = {
    nextId,
    add: (e: unknown, bucket: string) => {
      const ent = e as { id: number };
      ent.id = nextId++;
      if (bucket === 'enemies') rec.enemies.push(e as Enemy);
      else rec.projectiles.push(e);
    },
  };
  const player = new Player((playerAt?.x ?? 80) * TILE, (playerAt?.y ?? FLOOR - 4) * TILE,
    new Inventory());
  const hooks = {
    world: w, player: playerAt === null ? null : player,
    enemies: () => rec.enemies,
    critters: () => [], npcs: () => [],
    damagePlayer: (dmg: number, x: number, y: number): number => { rec.damageCalls.push({ dmg, x, y }); return 0; },
    spawnDrop: () => null, addDamageNumber: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, spawnParticles: () => {}, spawnBurst: () => {},
    addLightAt: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, cutTile: () => {},
    scene: { zoneGraveyard: false },
    entities: em,
  } as unknown as GameHooks;
  return { hooks, rec, player, em };
}

function spawn(h: ReturnType<typeof makeHooks>, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  e.id = h.em.nextId++;
  h.rec.enemies.push(e);
  return e;
}

const drive = (e: Enemy, fn: string) =>
  (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>)[fn];

// ===========================================================================
// G3：NewProjectile 末参 whoAmI 弹-NPC 绑定（发射点 NPC.cs:59970-59979）
// ===========================================================================
describe('G3 弹-NPC 绑定通道（537 激光 / 573 蓄能弹）', () => {
  it('537：宿主 411 存活期间束原点逐 t 锁回眼部 Center+(dir*6,−4)（Projectile.cs:30308）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: FLOOR - 6 });
    const host = spawn(h, 411, 40, FLOOR - 3);
    host.facing = -1;                                   // vector60 = (direction*6, −4)
    const beam = new Dart(host.cx, host.cy, 1, 0, 60, 537);
    beam.hostile = true;
    beam.ownerNpcId = host.id;
    beam.fixedUpdate(1 / 60, h.hooks);
    // 宿主移动后下一 tick 重新锁回（UpdatePosition 跳过表 :19028 含 aiStyle84）
    host.x += 37; host.y += 11;
    beam.fixedUpdate(1 / 60, h.hooks);
    expect(beam.x).toBeCloseTo(host.cx + host.facing * 6 - beam.w / 2, 5);
    expect(beam.y).toBeCloseTo(host.cy - 4 - beam.h / 2, 5);
  });

  // ★2026-09-02 定谳改判：本例旧断言「宿主死 → 解除位锁原地照完剩余寿命」系把
  // 455 专属前置支误读成 aiStyle84 全族语义。位锁 if/else 链（537 支要求
  // Main.npc[ai[1]].active && type==411）全落空时进尾支
  // `if (type != 632 || …) { Kill(); return; }`（1456 :30327-30333 / 1458
  // :31976-31982）→ type==537 ≠632 → 下拍立即 Kill，位置钉在末锁位（Kill 先于
  // 一切位写）、不追尸位、不残留束伤。生产端 2026-08-31「A2 清偿」已对齐，此处
  // 回归锁定新语义 + 90t 寿命（1456 :30441-30453 / 1458 :32092-32105）。
  it('537：宿主死后下拍 Kill（钉在末锁位，不追尸位）；寿命 90t（:30327-30333/:30441-30453）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: FLOOR - 6 });
    const host = spawn(h, 411, 40, FLOOR - 3);
    const beam = new Dart(host.cx, host.cy, 1, 0, 60, 537);
    beam.ownerNpcId = host.id;
    beam.fixedUpdate(1 / 60, h.hooks);
    host.dead = true;
    host.x += 100;                                      // 宿主尸位变化不应再拉束
    const lockX = beam.x, lockY = beam.y;
    beam.fixedUpdate(1 / 60, h.hooks);
    expect(beam.x).toBe(lockX);                         // Kill 先于位写：钉在末锁位
    expect(beam.y).toBe(lockY);
    expect(beam.dead).toBe(true);                       // 位锁链尾支 type!=632 → Kill
    // 寿命 90t：type==537 localAI[0]++ ≥90 Kill（宿主全程存活）
    const h2 = makeHooks(w, { x: 120, y: FLOOR - 6 });
    const host2 = spawn(h2, 411, 40, FLOOR - 3);
    const beam2 = new Dart(host2.cx, host2.cy, 1, 0, 60, 537);
    beam2.ownerNpcId = host2.id;
    for (let i = 0; i < 89; i++) beam2.fixedUpdate(1 / 60, h2.hooks);
    expect(beam2.dead).toBe(false);
    beam2.fixedUpdate(1 / 60, h2.hooks);
    expect(beam2.dead).toBe(true);                      // localAI[0] >= 90 Kill
  });

  it('537：束线段命中伤害 = 原值 × 难度 ×2（:13770-13781；难度乘区随难度档）', () => {
  // ★BJ712-C：DamageVar 首掷入参包装（P.cs:14904）后链带 ±15% 掷——mock 0.5
  // = tier 0 档（×1.0）,表值即掷中值;掷形面由 tests/bj712c-martian-dmg 三掷形承载
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
    for (const [diff, want] of [[0, 120], [1, 240]] as const) {
      const w = makeWorld(diff);
      const h = makeHooks(w, { x: 120, y: FLOOR - 6 });
      const host = spawn(h, 411, 40, FLOOR - 3);
      (h.player as Player).x = host.cx + 200 - h.player.w / 2;   // 玩家摆进束路径
      (h.player as Player).y = host.cy - h.player.h / 2;
      const beam = new Dart(host.cx, host.cy, 1, 0, 60, 537);
      beam.hostile = true;
      beam.ownerNpcId = host.id;
      beam.fixedUpdate(1 / 60, h.hooks);
      expect(h.rec.damageCalls.length, `难度 ${diff}`).toBeGreaterThan(0);
      expect(h.rec.damageCalls[0].dmg, `难度 ${diff} 应为 ${want}`).toBe(want);
    }
  });

  it('573：蓄能 90t 悬停漂移；宿主死中途 → 当 t 齐射（速 20 朝玩家）并显形（:32086-32232）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 60, y: FLOOR - 6 });
    const host = spawn(h, 424, 40, FLOOR - 3);
    const orb = new Dart(host.cx, host.cy + 6, 0.15, -0.3, 60, 573);
    orb.hostile = true;
    orb.ownerNpcId = host.id;
    for (let i = 0; i < 50; i++) orb.fixedUpdate(1 / 60, h.hooks);   // 蓄能中段
    const midX = orb.x;
    expect(orb.dead).toBe(false);
    expect(Math.hypot(orb.vx, orb.vy)).toBeLessThan(1);              // 仍为出生微漂速度
    expect(midX).toBeGreaterThan(host.cx);                           // +vx 漂移（0.15×50≈7.5）
    host.dead = true;                                                // 宿主死 → 立即齐射
    orb.fixedUpdate(1 / 60, h.hooks);
    expect(Math.hypot(orb.vx, orb.vy)).toBeCloseTo(20, 5);
    // 朝玩家（±50 抖动 ×0.8-1.2 后仍应大体指向玩家）
    const p = h.player as Player;
    expect((orb.vx * (p.cx - orb.cx) + orb.vy * (p.cy - orb.cy))).toBeGreaterThan(0);
    // 蓄能中齐射后显形：绘制走 alpha（此处直接验非 255）
    expect((orb as unknown as { alpha: number }).alpha).toBe(0);
  });

  it('573：宿主存活走满 90t 同样齐射（宿主目标继承路径）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 60, y: FLOOR - 6 });
    const host = spawn(h, 424, 40, FLOOR - 3);
    const orb = new Dart(host.cx, host.cy + 6, 0, 0, 60, 573);
    orb.ownerNpcId = host.id;
    for (let i = 0; i < 90; i++) orb.fixedUpdate(1 / 60, h.hooks);
    expect(Math.hypot(orb.vx, orb.vy)).toBeCloseTo(20, 5);
  });
});

// ===========================================================================
// G4：蜗牛象限 spriteDirection 渲染翻面（NPC.cs:34763-34795 表）
// ===========================================================================
describe('G4 蜗牛 spriteDirection 翻面通道', () => {
  /** 逐象限驱动 snailAI 并断言 snailSdir + rotation 目标 */
  function quadrant(dirY: number, dir: number, wall: 'x' | 'y',
    wantSdir: number, wantRot: number) {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 359, 40, FLOOR - 3);
    // 轴选态：ai1=1(竖爬)时撞 X 墙不翻 dirY / ai1=0(横爬)时撞 Y 墙不翻 facing
    //（撞轴翻转发生在象限块【之前】——原版同序 :34739-34761 → :34763）
    e.ai0 = 1; e.ai1 = wall === 'x' ? 1 : 0; e.ai2 = 0; e.ai3 = 1;
    e.dirY = dirY; e.facing = dir;
    for (let i = 0; i < 200; i++) {
      e.hitWall = wall === 'x';                         // collideX 旗标
      e.hitHead = wall === 'y'; e.onGround = false;     // collideY 旗标
      drive(e, 'snailAI').call(e, h.hooks, null);
    }
    expect(e.snailSdir, `dirY=${dirY} dir=${dir} wall=${wall}`).toBe(wantSdir);
    expect(e.visAngle, `dirY=${dirY} dir=${dir} wall=${wall} rotation 目标`)
      .toBeCloseTo(wantRot, 1);
  }

  it('八象限表 1:1（:34766-34794：dirY/dir/撞轴 → rotation+sdir）', () => {
    quadrant(-1, -1, 'x', -1, 1.57);
    quadrant(-1, -1, 'y', 1, 3.14);
    quadrant(-1, 1, 'y', -1, 3.14);
    quadrant(-1, 1, 'x', 1, 4.71);
    quadrant(1, -1, 'y', -1, 0);
    quadrant(1, -1, 'x', 1, 1.57);
    quadrant(1, 1, 'x', -1, 4.71);
    quadrant(1, 1, 'y', 1, 0);
  });

  it('渲染变换：rotate(visAngle) 后沿局部 X 轴翻面；通用 facing 镜像禁用（无双翻）', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 359, 40, FLOOR - 3);
    e.visAngle = Math.PI;
    e.snailSdir = 1;
    e.facing = 1;                       // 若通用镜像未排除会叠加第二张 scale(-1,1)
    // 记录型 ctx + 最小 Renderer 假体（prototype 直调，同 fullmap-bg-index.test.ts）
    const calls: Array<{ m: string; a: unknown[] }> = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (k === 'canvas' ? undefined : (...a: unknown[]) => { calls.push({ m: String(k), a }); }),
    });
    const rectStub = { img: { width: 8, height: 8 }, sx: 0, sy: 0, sw: 8, sh: 8 };
    const fake = {
      ctx,
      assets: { enemySprites: new Map() },
      atlas: { vnpc: () => rectStub, ensureVImage: () => null, vmisc: () => null },
      drawNpcGlow: () => {},
    };
    (Renderer.prototype as unknown as { drawEnemy: (this: unknown, e: Enemy, w: World) => void })
      .drawEnemy.call(fake, e, w);
    const rot = calls.find((c) => c.m === 'rotate');
    expect(rot, '应有 rotate(visAngle)').toBeTruthy();
    expect((rot!.a as number[])[0]).toBeCloseTo(Math.PI, 5);
    const flips = calls.filter((c) => c.m === 'scale'
      && (c.a as number[])[0] === -1 && (c.a as number[])[1] === 1);
    expect(flips.length, 'snailSdir=1 → 恰一次局部翻面（通用镜像已排除）').toBe(1);
    // 对照：snailSdir=-1 且 facing=1（通用镜像禁用）→ 零翻面
    calls.length = 0;
    e.snailSdir = -1;
    (Renderer.prototype as unknown as { drawEnemy: (this: unknown, e: Enemy, w: World) => void })
      .drawEnemy.call(fake, e, w);
    expect(calls.filter((c) => c.m === 'scale'
      && (c.a as number[])[0] === -1 && (c.a as number[])[1] === 1).length).toBe(0);
  });
});

// ===========================================================================
// G6：蚁狮 ±1.2rad 仰角锥（NPC.cs:24477-24479 flag25）
// ===========================================================================
describe('G6 蚁狮仰角锥门', () => {
  function fireAt(dx: number, dy: number): number {
    const w = makeWorld();
    const h = makeHooks(w, { x: 80, y: FLOOR - 4 });
    const e = spawn(h, 69, 40, FLOOR - 2);
    const p = h.player as Player;
    p.x = e.cx + dx - p.w / 2;
    p.y = e.cy + dy - p.h / 2;
    e.ai0 = 0;                           // 冷却尽（原版倒计时语义：==0 才装填射击）
    drive(e, 'antlionAI').call(e, h.hooks, p);
    return h.rec.projectiles.length;
  }

  it('锥内（|rotation|≤1.2，近似正上方）直射；锥外（近水平但仍在上）哑火', () => {
    expect(fireAt(0, -500), '正上方 rotation=0 → 直射').toBe(1);
    expect(fireAt(880, -549), 'rotation≈1.01 ≤1.2 → 直射').toBe(1);
    expect(fireAt(1100, -300), 'rotation≈1.30 >1.2 → 哑火（锥外仅传送带支路）').toBe(0);
    expect(fireAt(-1100, -300), '镜像侧同理').toBe(0);
  });
});

// ===========================================================================
// G7：鱿鱼 221 帧机（NPC.cs:74652-74662）+ 水母 ai[1] 门（:74614-74631）
// ===========================================================================
describe('G7 鱿鱼/水母帧端', () => {
  it('221：hunt 8t/帧正向钳末帧不回卷；慢速触发一次性复位帧 0；非 hunt 13t/帧循环', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 221, 40, FLOOR - 3);
    const frames = Math.max(1, e.vanilla?.frames ?? 1);
    // 非 hunt：13t 一帧全循环
    for (let i = 0; i < 13; i++) drive(e, 'squidFindFrame').call(e, h.hooks, null);   // ★tsc:无参 impl,补齐 drive 声明形参(JS 忽略)
    expect(e.customFrameIdx).toBe(1);
    for (let i = 0; i < 13 * (frames - 1); i++) drive(e, 'squidFindFrame').call(e, h.hooks, null);   // ★tsc:无参 impl,补齐 drive 声明形参(JS 忽略)
    expect(e.customFrameIdx, '非 hunt 回卷帧 0').toBe(0);
    // hunt：8t 一帧、末帧钳住不回卷
    e.lai2 = 1;
    for (let i = 0; i < 8 * frames * 3; i++) drive(e, 'squidFindFrame').call(e, h.hooks, null);   // ★tsc:无参 impl,补齐 drive 声明形参(JS 忽略)
    expect(e.customFrameIdx, 'hunt 钳末帧').toBe(frames - 1);
    // 慢速触发：帧 0 + 清标志（一次）
    e.lai0 = 1;
    drive(e, 'squidFindFrame').call(e, h.hooks, null);   // ★tsc:无参 impl,补齐 drive 声明形参(JS 忽略)
    expect(e.customFrameIdx).toBe(0);
    expect(e.lai0).toBe(0);
  });

  it('jellyfishAI：狩猎（湿玩家+视线）写 lai2=1（:24347），漂移清零（:24390）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 44, y: FLOOR - 5 });
    const e = spawn(h, 63, 40, FLOOR - 4);
    e.wet = true;
    (h.player as Player).inWater = true;
    drive(e, 'jellyfishAI').call(e, h.hooks, h.player);
    expect(e.lai2).toBe(1);
    (h.player as Player).inWater = false;               // 玩家离水 → 漂移形
    drive(e, 'jellyfishAI').call(e, h.hooks, h.player);
    expect(e.lai2).toBe(0);
  });

  it('水母帧规则：ai[1]==1 潜伏带 [4..6]@5t；否则 23t 四帧循环（0-3 各 6/6/6/5）', () => {
    const w = makeWorld();
    const h = makeHooks(w, null);
    const e = spawn(h, 63, 40, FLOOR - 3);
    e.ai1 = 1;
    expect(vanillaFrameIdx(e, 7)).toBeGreaterThanOrEqual(4);
    expect(vanillaFrameIdx(e, 7)).toBeLessThanOrEqual(6);
    e.ai1 = 0;
    const seq: number[] = [];
    for (let t = 0; t < 23; t++) { e.animT = t; seq.push(vanillaFrameIdx(e, 7)); }
    expect(seq.filter((v) => v === 0).length).toBe(6);
    expect(seq.filter((v) => v === 1).length).toBe(6);
    expect(seq.filter((v) => v === 2).length).toBe(6);
    expect(seq.filter((v) => v === 3).length).toBe(5);
  });
});

// ===========================================================================
// G8：月总死光伤害管线（×2 = :13781 通用敌弹规则，非 iframes 补偿）
// ===========================================================================
describe('G8 月总死光伤害乘区', () => {
  function deathrayHit(difficulty: number): number {
    const w = makeWorld(difficulty);
    const h = makeHooks(w, { x: 60, y: FLOOR - 8 });
    const src = spawn(h, 396, 40, FLOOR - 8);
    src.ai0 = 0;                                          // ≠-2（闭眼残肢门）
    // ★2026-09-02 桩适配：1457 起 455 Colliding 有 20t 武装延迟（1457/1458
    //   P.cs:16075-16082 `num44=20; localAI[0]<num44 → 不判伤`；1456 :14675-14683
    //   无此门）——旧「单 tick 直驱」已被武装门合法拦截（R23b-K3 后空转）。
    //   出生角预摆 −20×sweep：恰在第 20 tick（首个武装拍）束线转回玩家方向，
    //   验证伤害乘区而非扫掠几何。
    const sweep = Math.PI * 2 / 540;
    const ray = new MLDeathray(src, 'head', -20 * sweep, sweep, 75);
    for (let i = 0; i < 20; i++) ray.fixedUpdate(1 / 60, h.hooks);
    expect(h.rec.damageCalls.length).toBeGreaterThan(0);
    return h.rec.damageCalls[0].dmg;
  }

  it('NewProjectile 原值 75 → 经敌弹标准乘区（难度×2）：经典 150 / 专家 300', () => {
  // ★BJ712-C：DamageVar 首掷入参包装（P.cs:14904）后链带 ±15% 掷——mock 0.5
  // = tier 0 档（×1.0）,表值即掷中值;掷形面由 tests/bj712c-martian-dmg 三掷形承载
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(deathrayHit(0)).toBe(150);   // 75 ×1×2（:13770-13781）
    expect(deathrayHit(1)).toBe(300);   // 75 ×2×2
  });
});

// ===========================================================================
// G9：克脑消散掉落门（逃走=原版静默 active=false，NPCLoot 仅在 checkDead）
// ===========================================================================
describe('G9 克脑消散掉落门（定谳：现行为已对齐，回归锁定）', () => {
  it('逃走路径（>6000px）直写 dead+bossFled，不经 hurt/掉落管线（NPC.cs:32555-32567）', async () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 80, y: FLOOR - 4 });
    const { brainOfCthulhuAI } = await import('../src/entities/bossAI');
    const e = spawn(h, 266, 40, FLOOR - 4);
    e.bInit = true;                                       // 跳过爬行者孵化
    const p = h.player as Player;
    p.x = e.cx + 6100;                                    // 曼哈顿 >6000 → active=false 逃走
    brainOfCthulhuAI(e, h.hooks, p);
    expect(e.dead).toBe(true);
    expect(e.bossFled).toBe(true);                        // Game 端：不播击败/不记账/不掉落
    // dead 直写不触发 hurt → 无死亡演出/掉落副作用（对照 checkDead 专属 NPCLoot）
  });
});

// ===========================================================================
// G10：516 耀斑 α 方向（GetAlpha :94729-94733 特判 → α 是亮度兼不透明度）
// ===========================================================================
describe('G10 日耀耀斑渐显方向', () => {
  it('出生隐形（255），−40/t 渐显到 86% 驻留（35=255−220），不反向渐隐', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 44, y: FLOOR - 5 });
    const e = spawn(h, 516, 40, FLOOR - 4);
    bouncingBallAI(e, h.hooks, h.player);
    expect(e.spawnAlpha, '首 tick = 255−40（原版 α=40 → 15.7% 可见）').toBe(215);
    for (let i = 0; i < 20; i++) bouncingBallAI(e, h.hooks, h.player);
    expect(e.spawnAlpha, '钳 35（=255−220，86% 不透明度驻留）').toBe(35);
    expect(e.spawnAlpha, '永不回到全显 0（非渐隐方向）').toBeGreaterThan(0);
  });
});

// ===========================================================================
// G11：花岗岩双段锚升级门 = 列锚距 |ΔX|（原版字面 vector264 复检，:40734-40742）
// ===========================================================================
describe('G11 花岗岩元素锚点升级门', () => {
  it('|ΔX|>8 且 |ΔY|≤8（升级门为列锚距字面复检——|ΔY| 版会漏升）', () => {
    const w = makeWorld();
    const st = w.store;
    const h = makeHooks(w, null);
    const e = spawn(h, 483, 40, FLOOR - 4);
    const p = h.player as Player;
    // 布局（按中心摆位）：敌 (cx, 30T+1) 行 30 顶；玩家中心 (cx+160, 29T+14)
    // （|ΔX|=160>8，|ΔY|=3≤8，玩家行 29）；挡板 (敌列+9, 行 29) 恰在直连
    // tile-walk 的抬行落点 → 直连 blocked；列锚线（行 30）净空。
    const exT = Math.floor(e.cx / TILE);
    const targetCx = exT * TILE + 160 + TILE / 2;
    p.x = targetCx - p.w / 2;
    p.y = (29 * TILE + 14) - p.h / 2;
    e.x = e.cx - 0;                                       // 保持 x，只校准 y 到行 30 顶
    e.y = (30 * TILE + 1) - e.h / 2;
    st.setTile(exT + 9, 29, 1);                           // 挡直连的抬行落点
    graniteElementalAI(e, h.hooks, p);
    expect(e.ai0, '应入锚点态 3').toBe(3);
    expect(e.ai1, '升级门按 |ΔX| 字面 → 升级为行锚 (selfX, playerY)').toBeCloseTo(e.cx, 0);
    expect(e.ai2).toBeCloseTo(p.cy, 0);
  });

  it('|ΔX|>8 且 |ΔY|>8 常规档同样升级（回归护栏）', () => {
    const w = makeWorld();
    const st = w.store;
    const h = makeHooks(w, null);
    const e = spawn(h, 483, 40, FLOOR - 4);
    const p = h.player as Player;
    const exT = Math.floor(e.cx / TILE);
    p.x = exT * TILE + 160 + TILE / 2 - p.w / 2;
    p.y = (26 * TILE) - p.h / 2;                          // 高 4 行（|ΔY|>8）
    e.y = (30 * TILE + 1) - e.h / 2;
    // 直连 tile-walk (0,30)→(10,26) 路径：行30×6 → (6,29)(7,29) → (7,28)(8,28)
    // → (8,27)(9,27) → (9,26)(10,26)——挡 (8,28) 恰在路径
    st.setTile(exT + 8, 28, 1);                           // 挡直连
    graniteElementalAI(e, h.hooks, p);
    expect(e.ai0).toBe(3);
    expect(e.ai1).toBeCloseTo(e.cx, 0);
    expect(e.ai2).toBeCloseTo(p.cy, 0);
  });
});
