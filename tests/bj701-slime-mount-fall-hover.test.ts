// BJ701 判别锁：史莱姆族坐骑（3 SlimySaddle / 50 QueenSlime）垂直速度 ×2 与
// 史后坐骑按↓悬浮。全部走真实 Player.fixedUpdate（makeHooks 精简桩，同
// slime-mount-water-jump / mount-combat 口径）。
//
// 【定谳锚（1457 反编译）】
//  ③ 双竖向碰撞趟 Player.cs:28408-28422：干态 DryCollision 后，骑史莱姆族
//    （IsConsideredASlimeMount=3‖50，Mount.cs:522）或弹跳杆 43 且 vy≠0 →
//    vx 临时清零重跑一趟 DryCollision——竖向位移每拍双份=垂直速度×2（上升
//    hyper jump/下降快坠；wiki Slimy Saddle："Players move at double the
//    normal vertical speed"）。闸：史莱姆族 SlimeDontHyperJump（:4108-4118 净语义
//    wetSlime>0 ∧ !controlJump）；湿态选档（:28394-28404 WetCollision）不跑。
//    旧登记债（Player.ts BJ534 块注「本仓未建模」）本刀清偿。
//  ① Flight 悬停钉位 Player.cs:27164-27222：CanFly∧controlJump∧jump==0 →
//    Flight() 余能期 TryingToHoverDown（:3920-3927 = controlDown∨锁存）→
//    vy×0.9 + (-1,0.5) 窗内钉 1E-05（横向不受影响=可漂移）；耗尽臂重力/3 +
//    maxFallSpeed/3 钳带悬停向门（:27213/:27218，翼链 :27544 同族——按↓驻留
//    不钳=快坠面）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { seededRandom, BATTERY_SEED } from './seeded-rng';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

/** 真实 Player 最小钩桩（slime-mount-water-jump 同款） */
function makeHooks(w: World) {
  return {
    world: w, player: null as unknown,
    enemies: () => [], critters: () => [], npcs: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    spawnParticles: () => {}, spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    addDamageNumber: () => {}, spawnDrop: () => null, damagePlayer: (): number => 0,
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, cutTile: () => {},
  } as never as Parameters<import('../src/entities/Player').Player['fixedUpdate']>[1];
}

/** 干地世界：y=170 实心底（x 14..28），世界 60×180（同 D2 clip-b 口径） */
function makeDryWorld(seed: string) {
  const w = new World(60, 180, 44, seed);
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, 170, 1, 0, 0);
  return w;
}

async function makePlayer() {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(21 * 16, 140 * 16, new Inventory());
}

/** 骑上指定坐骑（D2 口径：直接置 active/type） */
function rideMount(p: import('../src/entities/Player').Player, type: number) {
  p.mount.active = true;
  p.mount.type = type;
}

/** 单拍位移探针：给定初速跑一拍，返回 dy（含全部真实链：重力/飞行/碰撞/双趟） */
async function tickDy(p: import('../src/entities/Player').Player, game: ReturnType<typeof makeHooks>, vy: number) {
  const y0 = p.y;
  p.vy = vy;
  p.fixedUpdate(1 / 60, game);
  return p.y - y0;
}

// ---------------------------------------------------------------------------
// ③ 双竖向碰撞趟：下落/上升位移翻倍（机制=位移双份，vy 本身不被双趟改写）
// ---------------------------------------------------------------------------
describe('BJ701 ③ 史莱姆族坐骑双竖向碰撞趟（:28409-28415）', () => {
  it('骑粘鞍(3)下落 vy=5：单拍 dy≈2×5.4=10.8（位移双份）；非史莱姆坐骑(49)对照≈5.4', async () => {
    const w = makeDryWorld('bj701-f3');
    const game = makeHooks(w);
    const p = await makePlayer();
    rideMount(p, 3);
    p.fixedUpdate(1 / 60, game);                    // 稳定拍（状态机走顺）
    const dySlime = await tickDy(p, game, 5);
    expect(dySlime).toBeGreaterThan(9.5);           // 双趟：5.4×2（余量容纳坡/贴合微扰）
    expect(dySlime).toBeLessThan(11.5);
    expect(p.vy).toBeCloseTo(5.4, 3);               // vy 演化与无坐骑同（双趟不改写开放空域 vy）

    const w2 = makeDryWorld('bj701-f49');
    const game2 = makeHooks(w2);
    const p2 = await makePlayer();
    rideMount(p2, 49);                              // LavaShark：非史莱姆/非弹跳杆对照
    p2.fixedUpdate(1 / 60, game2);
    const dyCtl = await tickDy(p2, game2, 5);
    expect(dyCtl).toBeGreaterThan(4.5);             // 单趟 5.4
    expect(dyCtl).toBeLessThan(6.5);
  }, 30000);

  it('骑粘鞍(3)上升 vy=-5：单拍 dy≈-9.2（hyper jump 上升面同机制）', async () => {
    const w = makeDryWorld('bj701-a3');
    const game = makeHooks(w);
    const p = await makePlayer();
    rideMount(p, 3);
    p.fixedUpdate(1 / 60, game);
    const dy = await tickDy(p, game, -5);
    expect(dy).toBeGreaterThan(-10.2);              // 2×(-5+0.4)=-9.2
    expect(dy).toBeLessThan(-8.3);
  }, 30000);

  it('骑明胶女式鞍(50)下落 vy=5：同为史莱姆族 → dy≈10.8', async () => {
    const w = makeDryWorld('bj701-f50');
    const game = makeHooks(w);
    const p = await makePlayer();
    rideMount(p, 50);
    p.inputJump = false;                            // 飞行链需 inputJump,关掉只测纯下落
    p.fixedUpdate(1 / 60, game);
    const dy = await tickDy(p, game, 5);
    expect(dy).toBeGreaterThan(9.5);
    expect(dy).toBeLessThan(11.5);
  }, 30000);

  it('弹跳杆(43)同款双趟（:28416-28422 无 SlimeDontHyperJump 闸）', async () => {
    const w = makeDryWorld('bj701-f43');
    const game = makeHooks(w);
    const p = await makePlayer();
    rideMount(p, 43);
    p.fixedUpdate(1 / 60, game);
    const dy = await tickDy(p, game, 5);
    expect(dy).toBeGreaterThan(9.5);
    expect(dy).toBeLessThan(11.5);
  }, 30000);

  it('SlimeDontHyperJump 闸：wetSlime>0 且不按跳 → 单趟；按住跳复权 → 双趟', async () => {
    const w = makeDryWorld('bj701-gate');
    const game = makeHooks(w);
    const p = await makePlayer();
    rideMount(p, 3);
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game);
    p.wetSlime = 30;                                // 液面浮态残余（干地也可设,闸只读值）
    const dyHeld = await tickDy(p, game, 5);        // inputJump=false → 闸关
    expect(dyHeld).toBeGreaterThan(4.5);            // 单趟 5.4
    expect(dyHeld).toBeLessThan(6.5);
    expect(p.wetSlime).toBeGreaterThan(0);          // 闸在读数时仍>0（29）

    p.wetSlime = 30;
    p.inputJump = true;
    p.jumpEdgePrev = true;                          // 压边沿:不触发起跳,只开 controlJump 闸
    p.onGround = false;
    const dyJump = await tickDy(p, game, 5);        // 按住跳 → 闸开（controlJump 复权/湿残余被跳键清）
    expect(dyJump).toBeGreaterThan(9.5);            // 双趟复权
    expect(dyJump).toBeLessThan(11.5);
  }, 30000);

  it('湿态选档不跑双趟：水中骑粘鞍/弹跳杆 vy=-2 → dy≈0.5×vy（缩液且无双份）', async () => {
    const w = new World(60, 180, 44, 'bj701-wet');
    for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, 103, 1, 0, 0);
    for (let y = 96; y <= 102; y++) {
      for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, 0);
    }
    const game = makeHooks(w);
    // 臂1 粘鞍（3）：不按跳 → wetSlime>0（SlimeDontHyperJump 闸+干态闸双关）
    const p = await makePlayer();
    rideMount(p, 3);
    p.x = 21 * 16;
    p.y = 103 * 16 - p.h;                           // 池底（浮力 0.25px/拍,数拍内仍在水下）
    p.inputJump = false;
    for (let i = 0; i < 3; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    expect(p.wetSlime).toBeGreaterThan(0);          // 湿态置位（浮力链消费）
    const dy = await tickDy(p, game, -2);
    expect(dy).toBeGreaterThan(-1.4);               // 单趟×0.5 液缩≈-1.15（双趟漏跑=-2.7 之外）
    expect(dy).toBeLessThan(-0.4);

    // 臂2 弹跳杆（43）：非史莱姆族无 SlimeDontHyperJump 闸——干态门是唯一把守
    //   （干态门被拆时此臂红：第二趟 liqFactor 归一跑全速 → dy≈-2.7）
    const p2 = await makePlayer();
    rideMount(p2, 43);
    p2.x = 21 * 16;
    p2.y = 103 * 16 - p2.h;
    p2.inputJump = false;
    for (let i = 0; i < 3; i++) p2.fixedUpdate(1 / 60, game);
    expect(p2.inWater).toBe(true);
    const dy2 = await tickDy(p2, game, -2);
    expect(dy2).toBeGreaterThan(-1.4);              // 单趟×0.5×(-2+0.2)=-0.9
    expect(dy2).toBeLessThan(-0.5);
  }, 30000);
});

// ---------------------------------------------------------------------------
// ① 史后坐骑(50) Flight 链：按↓悬停钉位 / 不按↓爬升 / 耗尽悬停向门
// ---------------------------------------------------------------------------
describe('BJ701 ① 史后坐骑 Flight 悬停族（:27164-27222）', () => {
  /** 地面起跳并持键飞行的前置：返回已脱离 jumpHold 段（飞行链已接管）的玩家 */
  async function makeFlyingQueen(game: ReturnType<typeof makeHooks>, holdDown: boolean) {
    const { Player } = await import('../src/entities/Player');
    const { Inventory } = await import('../src/items/Inventory');
    const p = new Player(21 * 16, 170 * 16 - 42, new Inventory());
    rideMount(p, 50);
    p.inputJump = false;
    p.inputDown = holdDown;
    p.fixedUpdate(1 / 60, game);                    // 贴地稳定
    p.inputJump = true;                             // 边沿帧起跳（autoJump=constantJump）
    return p;
  }

  it('按住 跳+↓：jumpHold 段后 Flight 接管,vy 按 ×0.9 衰减入 (-1,0.5) 窗钉 1e-5,悬停可漂移', async () => {
    const w = makeDryWorld('bj701-hov');
    const game = makeHooks(w);
    const p = await makeFlyingQueen(game, true);
    let pinned = false;
    for (let i = 0; i < 60; i++) {
      p.fixedUpdate(1 / 60, game);
      if (Math.abs(p.vy - 1e-5) < 1e-9) pinned = true;
    }
    expect(pinned).toBe(true);                      // 钉位态至少出现过
    expect(Math.abs(p.vy)).toBeLessThan(0.5);       // 终态悬停（非爬升非下坠）
    const yA = p.y;                                 // 末 10 拍位移≈0（1e-5 级）
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(Math.abs(p.y - yA)).toBeLessThan(0.01);
    expect(p.mount.flyTime).toBeGreaterThan(0);     // 余能段内（80 减飞行接管拍数）
    expect(p.mount.flyTime).toBeLessThan(80);
  }, 30000);

  it('对照：只按跳不按↓ → 爬升链 vy 钉 -jumpSpeed(7.25)×0.5×1.5=-5.4375', async () => {
    const w = makeDryWorld('bj701-clb');
    const game = makeHooks(w);
    const p = await makeFlyingQueen(game, false);
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);   // 10 拍 jumpHold + 若干飞行拍
    expect(p.vy).toBeLessThanOrEqual(-5.3);         // 爬升档（悬停支会把它拉向 0 → 判别点）
    expect(p.vy).toBeGreaterThanOrEqual(-5.6);
    const yA = p.y;
    for (let i = 0; i < 5; i++) p.fixedUpdate(1 / 60, game);
    expect(p.y).toBeLessThan(yA);                   // 持续上升
  }, 30000);

  it('耗尽臂悬停向门：flyTime=0 按住 跳+↓ → 重力/3 无钳累积(40 拍 vy≈5.3>cap)；松↓ → 钳 3.3367', async () => {
    const w = makeDryWorld('bj701-exh');
    const game = makeHooks(w);
    // 臂 A：按↓无钳（:27213 `&& !TryingToHoverDown`）
    const pA = await makeFlyingQueen(game, true);
    for (let i = 0; i < 35; i++) pA.fixedUpdate(1 / 60, game);  // 先入悬停钉位态
    expect(Math.abs(pA.vy)).toBeLessThan(0.5);
    pA.mount.flyTime = 0;                          // 手动耗尽（跳过自然耗尽等待）
    for (let i = 0; i < 40; i++) pA.fixedUpdate(1 / 60, game);
    expect(pA.vy).toBeGreaterThan(3.5);            // 无钳累积 ≈0.1333×40≈5.3（钳则 3.3367）

    // 臂 B：松↓ → 钳生效
    const pB = await makeFlyingQueen(game, true);
    for (let i = 0; i < 35; i++) pB.fixedUpdate(1 / 60, game);
    pB.mount.flyTime = 0;
    pB.inputDown = false;
    for (let i = 0; i < 40; i++) pB.fixedUpdate(1 / 60, game);
    expect(pB.vy).toBeGreaterThan(3.0);            // 仍受重力/3 驱动
    expect(pB.vy).toBeLessThanOrEqual(10.01 / 3 + 1e-6);   // 钳在 maxFallSpeed/3
  }, 30000);
});

// ---------------------------------------------------------------------------
// 结构锁（源文本锚）：防静默回退/重写（表达式与位序任一漂移即红）
// ---------------------------------------------------------------------------
describe('BJ701 结构锁（Player.ts 源文本锚）', () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');

  it('Flight 链：悬停钉位支逐字在位（:27168-27175 直译）', () => {
    const i = src.indexOf('BJ701 按住↓悬停钉位');
    expect(i).toBeGreaterThan(-1);
    const seg = src.slice(i, i + 600);
    expect(seg).toContain('if (this.tryingToHoverDown) {');
    expect(seg).toContain('this.vy *= 0.9;');
    expect(seg).toContain('if (this.vy > -1 && this.vy < 0.5) this.vy = 1e-5;');
    expect(seg).toContain('let js = mJumpSpd;');            // else 支爬升链仍在
    expect(seg).toContain('if (mnt2.type === 50) js *= 0.5;');
  });

  it('耗尽臂：悬停向门两半臂在位（:27213/:27218）', () => {
    const i = src.indexOf('BJ701 补悬停向门');
    expect(i).toBeGreaterThan(-1);
    const seg = src.slice(i, i + 500);
    expect(seg).toContain('if (this.vy > cap && !this.tryingToHoverDown) this.vy = cap;');
    expect(seg).toContain('} else if (this.vy < -cap && !this.tryingToHoverUp) this.vy = -cap;');
  });

  it('双竖向碰撞趟：BJ701 块四要素在位且独立于 BJ534 块', () => {
    const i = src.indexOf('BJ701 史莱姆/弹跳杆坐骑第二竖向碰撞趟');
    const j = src.indexOf('BJ534 下砸第二竖向碰撞趟');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    const seg = src.slice(i, j);
    expect(seg).toContain('const mntHyper = this.ridingMount ? this.mount : null;');
    expect(seg).toContain('this.liqFactor === 1');           // 干态门（湿态选档不跑）
    expect(seg).toContain('mntHyper.type === 43');
    expect(seg).toContain('isConsideredASlimeMount(mntHyper.type)');
    expect(seg).toContain('(this.wetSlime === 0 || this.inputJump)');   // SlimeDontHyperJump 净语义
    expect(seg.match(/moveAndCollide\(this, world, 0, this\.vy\);/g)?.length).toBe(1);
    expect(seg).toContain('this.hitWall = hwKeep || this.hitWall;');
  });
});
