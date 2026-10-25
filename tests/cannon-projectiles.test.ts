import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Wiring } from '../src/world/Wiring';
import { deviceTable, type DeviceCtx } from '../src/world/wiring/devices';
import { TILE_BY_KEY } from '../src/data/tiles';
import { TrapShot } from '../src/entities/Dart';
import type { GameHooks } from '../src/entities/types';

// 炮弹投射物 1:1 回归（Wiring.cs case 209/1301-1341 + case 212/1345-1418 →
// WorldGen.ShootFromCannon WorldGen.cs:50606-50718；Projectile 162/281/166 AI 与 Kill）
type Shot = { px: number; py: number; vx: number; vy: number; damage: number; kind: string; form: number };

function makeCtx() {
  const shots: Shot[] = [];
  let bunnyCount = 0;
  const ctx: DeviceCtx = {
    dropItem: () => {}, spawnNpc: () => true, mechSpawnOk: () => true, itemSpawnOk: () => true,
    shootProjectile: (px, py, vx, vy, damage, kind, form = 0) => shots.push({ px, py, vx, vy, damage, kind, form }),
    countProjectiles: (kind) => (kind === 'bunny' ? bunnyCount : 0),
    doorOpen: () => true, doorClose: () => true, teleportPair: () => {},
    relocateTownNpc: () => true, explode: () => {}, toast: () => {}, sfx: () => {},
    extractinatorPull: () => null, dropItemStack: () => {},
    worldSurface: 100,
  };
  return { ctx, shots, setBunnyCount: (n: number) => { bunnyCount = n; } };
}

/** 放置一座 4×3 大炮（tile 209）：frameX = style*72 + col*18，frameY = angle*54 + row*18 */
function placeCannon(w: Wiring, ox: number, oy: number, style: number, angle: number) {
  const t = TILE_BY_KEY['v_209_cannon']!;
  for (let cx = 0; cx < 4; cx++) {
    for (let cy = 0; cy < 3; cy++) {
      w.st.setTileSilent(ox + cx, oy + cy, t, style * 72 + cx * 18, angle * 54 + cy * 18);
    }
  }
}

/** 放置一座 3×3 雪球发射器（tile 212）：frameX = facing*54 + col*18，frameY = row*18 */
function placeSnowLauncher(w: Wiring, ox: number, oy: number, facing: number) {
  const t = TILE_BY_KEY['v_212_snowballlauncher']!;
  for (let cx = 0; cx < 3; cx++) {
    for (let cy = 0; cy < 3; cy++) {
      w.st.setTileSilent(ox + cx, oy + cy, t, facing * 54 + cx * 18, cy * 18);
    }
  }
}

function freshWiring() {
  const world = new World(60, 60, 7, 'open');
  return new Wiring(world.store);
}

describe('大炮（case 209 → WorldGen.ShootFromCannon）', () => {
  it('普通炮：162 炮弹 / 300 伤 / 出膛 (x+2)*16 / 角度带 0 → (14, 0)', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeCannon(w, 10, 20, 0, 0);
    expect(deviceTable(w, ctx, 209, 11, 21)).toBe(true); // 命中列1行1（待发半边）
    expect(shots).toHaveLength(1);
    const s = shots[0]!;
    expect(s.kind).toBe('cannonball');
    expect(s.damage).toBe(300); // Wiring.cs:1316
    expect(s.px).toBe((10 + 2) * 16); // WorldGen.cs:50685
    expect(s.py).toBe((20 + 2) * 16);
    expect(s.vx).toBeCloseTo(14, 6); // WorldGen.cs:50642/50608 归一化到 14
    expect(s.vy).toBeCloseTo(0, 6);
    expect(w.cannonCoolDown).toBe(120); // Wiring.cs:1335
  });

  it('角度带 4 → (0, -14)；角度带 8 → (-14, 0)（WorldGen.cs:50662-50683 方向表）', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeCannon(w, 10, 20, 0, 4);
    deviceTable(w, ctx, 209, 11, 21);
    expect(shots[0]!.vx).toBeCloseTo(0, 6);
    expect(shots[0]!.vy).toBeCloseTo(-14, 6);

    const w2 = freshWiring();
    const c2 = makeCtx();
    placeCannon(w2, 10, 20, 0, 8);
    deviceTable(w2, c2.ctx, 209, 11, 21);
    expect(c2.shots[0]!.vx).toBeCloseTo(-14, 6);
    expect(c2.shots[0]!.vy).toBeCloseTo(0, 6);
  });

  it('角度带 1：方向 (7.5,-2.5) 归一化到模长 14（WorldGen.cs:50647-50648/50706-50708）', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeCannon(w, 10, 20, 0, 1);
    deviceTable(w, ctx, 209, 11, 21);
    const len = Math.hypot(7.5, -2.5);
    expect(shots[0]!.vx).toBeCloseTo((7.5 * 14) / len, 6);
    expect(shots[0]!.vy).toBeCloseTo((-2.5 * 14) / len, 6);
    expect(Math.hypot(shots[0]!.vx, shots[0]!.vy)).toBeCloseTo(14, 6);
  });

  it('兔兔炮：281 爆炸兔兔 / 350 伤 / 冷却 480（Wiring.cs:1325/1338）', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeCannon(w, 10, 20, 1, 0);
    deviceTable(w, ctx, 209, 11, 21);
    expect(shots[0]!.kind).toBe('bunny');
    expect(shots[0]!.damage).toBe(350);
    expect(w.bunnyCannonCoolDown).toBe(480);
    expect(w.cannonCoolDown).toBe(0);
  });

  it('兔兔炮场内 4 发上限（BunnyCannonCanFire WorldGen.cs:50722-50760）', () => {
    const w = freshWiring();
    const { ctx, shots, setBunnyCount } = makeCtx();
    placeCannon(w, 10, 20, 1, 0);
    setBunnyCount(4);
    deviceTable(w, ctx, 209, 11, 21);
    expect(shots).toHaveLength(0);
    // 但 CheckMech 已注册 + 冷却未置位（原版冷却在 BunnyCannonCanFire 之前设置——
    // 见 Wiring.cs:1330-1339 顺序：CheckMech 通过即置冷却，ShoutFromCannon 内再拒），
    // 与原版一致地不会连发
    expect(w.bunnyCannonCoolDown).toBe(480);
  });

  it('全局冷却 + CheckMech 双门（Wiring.cs:1312-1314/1330）', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeCannon(w, 10, 20, 0, 0);
    deviceTable(w, ctx, 209, 11, 21);
    expect(shots).toHaveLength(1);
    // 立即再触发：冷却 120 中 → 不发射（且不消费 CheckMech）
    deviceTable(w, ctx, 209, 11, 21);
    expect(shots).toHaveLength(1);
    // 120 tick 后冷却清零，但 CheckMech(480) 仍在 → 仍不发射
    for (let i = 0; i < 120; i++) w.updateMech();
    expect(w.cannonCoolDown).toBe(0);
    deviceTable(w, ctx, 209, 11, 21);
    expect(shots).toHaveLength(1);
    // 480 tick 后 CheckMech 过期 → 再发射
    for (let i = 0; i < 480; i++) w.updateMech();
    deviceTable(w, ctx, 209, 11, 21);
    expect(shots).toHaveLength(2);
  });

  it('旋转半边（列0/3）只翻帧不开火；传送门炮带(3/4)行0/1翻朝向且不发射（flag2）', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeCannon(w, 10, 20, 0, 2);
    deviceTable(w, ctx, 209, 10, 21); // 列0 → 仰角 +54
    expect(shots).toHaveLength(0);
    const i = w.st.idx(11, 21);
    expect(w.st.frameY[i]).toBe(2 * 54 + 18 + 54);

    // style 3（传送门炮带）行0/1 → frameX +72 且 flag2=false 不发射（Wiring.cs:1290-1300/1301-1304）
    const w2 = freshWiring();
    const c2 = makeCtx();
    placeCannon(w2, 10, 20, 3, 0);
    deviceTable(w2, c2.ctx, 209, 11, 21);
    expect(c2.shots).toHaveLength(0);
    const ai = w2.st.idx(10, 20);
    expect(w2.st.frameX[ai]).toBe(3 * 72 + 72);
  });
});

describe('雪球发射器（case 212，Wiring.cs:1345-1418）', () => {
  it('右向（facing 1）：166 雪球 / 35 伤 / 速度 12..16.49 / 出膛偏移 +12', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeSnowLauncher(w, 10, 20, 1);
    expect(deviceTable(w, ctx, 212, 11, 21)).toBe(true); // 列1 = 待发
    expect(shots).toHaveLength(1);
    const s = shots[0]!;
    expect(s.kind).toBe('snowball');
    expect(s.damage).toBe(35); // Wiring.cs:1398
    expect(s.px).toBe((10 + 2) * 16 - 8 + 12); // Wiring.cs:1400-1405
    expect(s.py).toBe((20 + 2) * 16 - 8);
    const speed = Math.hypot(s.vx, s.vy);
    expect(speed).toBeGreaterThanOrEqual(12); // Wiring.cs:1394
    expect(speed).toBeLessThan(16.5);
    expect(s.vx).toBeGreaterThan(0); // facing 1 → X 正向（Wiring.cs:1401-1405）
    expect(w.snowballCannonCoolDown).toBe(15); // Wiring.cs:1393
  });

  it('左向（facing 0）：X 负向 + 出膛偏移 -12', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeSnowLauncher(w, 10, 20, 0);
    deviceTable(w, ctx, 212, 11, 21);
    const s = shots[0]!;
    expect(s.vx).toBeLessThan(0);
    expect(s.px).toBe((10 + 2) * 16 - 8 - 12);
  });

  it('全局冷却 15 + CheckMech(60) 双门（Wiring.cs:1391）', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeSnowLauncher(w, 10, 20, 1);
    deviceTable(w, ctx, 212, 11, 21);
    deviceTable(w, ctx, 212, 11, 21);
    expect(shots).toHaveLength(1);
    for (let i = 0; i < 15; i++) w.updateMech();
    expect(w.snowballCannonCoolDown).toBe(0);
    deviceTable(w, ctx, 212, 11, 21); // CheckMech 60 仍在 → 不发射
    expect(shots).toHaveLength(1);
    for (let i = 0; i < 60; i++) w.updateMech();
    deviceTable(w, ctx, 212, 11, 21);
    expect(shots).toHaveLength(2);
  });

  it('旋转半边（列0/2）只翻朝向带不开火（Wiring.cs:1359-1383）', () => {
    const w = freshWiring();
    const { ctx, shots } = makeCtx();
    placeSnowLauncher(w, 10, 20, 1);
    deviceTable(w, ctx, 212, 10, 21); // 列0 → frameX -54（facing 1→0）
    expect(shots).toHaveLength(0);
    const i = w.st.idx(10, 20);
    expect(w.st.frameX[i]).toBe(0); // 1*54 + 0 - 54
  });
});

// ---- TrapShot 炮弹族弹体（Projectile 162/281/166 SetDefaults + AI + Kill）----

function makeGame() {
  const world = new World(40, 40, 7, 'open');
  const hits: Array<{ dmg: number; x: number; y: number }> = [];
  const playerHits: number[] = [];
  const enemy = {
    x: 40, y: 60, w: 20, h: 20, dead: false,
    hurt: (d: number, kx: number, ky: number) => { hits.push({ dmg: d, x: kx, y: ky }); return true; },
  };
  const game = {
    world,
    player: { x: -500, y: -500, w: 20, h: 20, dead: false, cx: -490, damage: (d: number) => playerHits.push(d) },
    enemies: () => [enemy],
    critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {}, cutTile: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, showPickupLabel: () => {}, notifyInventoryChanged: () => {},
  } as unknown as GameHooks;
  return { game, hits, playerHits, enemy };
}

describe('TrapShot 炮弹族弹体', () => {
  it('炮弹 162：前 18 tick 直线，之后 vy+=0.28 / vx*=0.99（Projectile.cs:21540-21550）', () => {
    const { game } = makeGame();
    const p = new TrapShot(200, 200, 14, 0, 300, 'cannonball');
    expect(p.w).toBe(16); // SetDefaults Projectile.cs:2240
    for (let t = 0; t < 17; t++) p.fixedUpdate(1, game); // age 1..17
    expect(p.vy).toBe(0);
    expect(p.vx).toBe(14);
    p.fixedUpdate(1, game); // age 18 → 重力开始
    expect(p.vy).toBeCloseTo(0.28, 6);
    expect(p.vx).toBeCloseTo(14 * 0.99, 6);
  });

  it('雪球 166：前 20 tick 直线，之后 vy+=0.3 / vx*=0.98（Projectile.cs:21879-21884）', () => {
    const { game } = makeGame();
    const p = new TrapShot(100, 100, 9, 0, 35, 'snowball');
    expect(p.w).toBe(14); // SetDefaults Projectile.cs:2283
    for (let t = 0; t < 19; t++) p.fixedUpdate(1, game);
    expect(p.vy).toBe(0);
    p.fixedUpdate(1, game); // age 20
    expect(p.vy).toBeCloseTo(0.3, 6);
    expect(p.vx).toBeCloseTo(9 * 0.98, 6);
  });

  it('炮弹撞块：落点爆炸 72px 半宽纯伤害，不伤玩家（Projectile.Kill :72768-72831）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（TrapShot blast 首掷 ×1.0）
    const { game, hits, playerHits } = makeGame();
    game.world.store.setTileSilent(5, 5, TILE_BY_KEY['stone']!); // 命中 (5,5)=80..96px
    const p = new TrapShot(40, 80, 8, 0, 300, 'cannonball');
    for (let t = 0; t < 10 && !p.dead; t++) p.fixedUpdate(1, game);
    expect(p.dead).toBe(true);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.dmg).toBe(300);
    expect(playerHits).toHaveLength(0); // friendly 弹不伤玩家
  });

  it('雪球撞块：碎裂消失无 AoE（Projectile.Kill :71758-71767）', () => {
    const { game, hits } = makeGame();
    game.world.store.setTileSilent(5, 5, TILE_BY_KEY['stone']!);
    const p = new TrapShot(40, 80, 8, 0, 35, 'snowball');
    for (let t = 0; t < 10 && !p.dead; t++) p.fixedUpdate(1, game);
    expect(p.dead).toBe(true);
    expect(hits).toHaveLength(0);
  });

  it('爆炸兔兔 281：28×28 弹体 / vCap 15.9（SetDefaults :3408-3418 + AI :26844-26853）', () => {
    const { game, hits } = makeGame();
    const p = new TrapShot(100, 100, 0, 0, 350, 'bunny');
    expect(p.w).toBe(28);
    for (let t = 0; t < 100; t++) p.fixedUpdate(1, game); // age≥18 后持续下落
    expect(p.vy).toBe(15.9);
    expect(p.dead).toBe(false); // timeLeft 600
    expect(hits).toHaveLength(0); // 未命中
  });

  it('传送门炮（num36 3/4）：弹种 portalbolt / 速度 3 / damage 0（WorldGen.cs:50622-50631）', () => {
    const w = freshWiring();
    const ctxA = makeCtx();
    placeCannon(w, 10, 20, 3, 4); // 右向传送门炮，仰角带 4 = 正上
    expect(deviceTable(w, ctxA.ctx, 209, 11, 22)).toBe(true); // 待发行 2（左向半仰角不发射门 flag2，Wiring.cs:1301-1304）
    const a = ctxA.shots[0]!;
    expect(a.kind).toBe('portalbolt');
    expect(a.damage).toBe(0);
    expect(a.vx).toBeCloseTo(0, 6);
    expect(a.vy).toBeCloseTo(-3, 6); // 速度 3（:50623 num=3f）
    expect(a.py).toBe((20 + 2) * 16 + 5); // :50689-50696 (y+2)*16+5
    expect(a.form).toBe(0); // ammo 4 → form 0 橙门

    const w2 = freshWiring();
    const ctxB = makeCtx();
    placeCannon(w2, 10, 20, 4, 4); // 左向传送门炮（ammo 5 → form 1 蓝门）
    deviceTable(w2, ctxB.ctx, 209, 11, 22);
    expect(ctxB.shots[0]!.kind).toBe('portalbolt');
    expect(ctxB.shots[0]!.form).toBe(1);
  });
});
