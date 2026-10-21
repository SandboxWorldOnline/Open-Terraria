// ★BJ704-G12（2026-10-21）坐骑/毯域八件清算第二刀（G5 新登记债,判别锁+结构锁）。
//  债源：memory/bj704g5-mount-carpet-debts.md「新登记债」八件。锚全在 1457 反编译亲读：
//  · 债1 未骑乘微光物理：:24581-24593 shimmerWet 档（gravity 0.15 平值/jump 23·5.51/
//    maxFall 10.01 不覆写）+ :24884 ×num6 + :28394 WetCollision 0.375 + 标准水跳门
//    （JumpMovement :20845）——旧早退支（0.62 游升/0.06 重力/±[-5.5,3.0] 带）退役。
//  · 债2 shimmering 骑乘者 CCed-dismount：buff 353 置 frozen（:11872-11875）→ CCed
//    （:3361-3372）→ :27000-27012 TryDismount+重力臂（:24585-24586 gravity/maxFall ×0.9
//    → :24884 ×num6 → :24631 +0.01=9.01）。
//  · 债3 swimFree 液体档重力：ignoreWater（buff 131/168/279/305,:9972-9999）只辖碰撞
//    （:28398/:28402）与位移因子（:28309）;重力/maxFall 走湿表（:24595-24625）。
//  · 债4 湿支 wingTime 回充 releaseJump 门：:26976-26982（干支公共段 G5 已带）。
//  · 债5 干支毯带 gravity 字段：CarpetMovement :22037 `num = gravity`（=0.4×num6,
//    :24884;湿支 ⑤a 已同修）——旧恒 GRAVITY 常数=太空带毯带 4× 错档。
//  · 债6 Mount.Hover 48 特例臂：:3411-3431 flag4=false（升力输入禁用）+num4/num5=0
//    （→-0.001 静置带）+!flag3→flag5 重力驱动臂（:3463-3468 vy+=gravity,vMax=4）
//    +controlDown→num5=8。
//  · 债7 stepUpCarpet 精确承载：:28276/:28273-28275 carpetFrame!=-1 ≙ carpetFlying
//    （G5 R4-P2② 单一真源）非 carpetTime>0∧inputJump 近似。
//  · 债8 tryStartHover 一拍滞后：G12 复核=销案（vy==0 静止拍 num6 带不变=结构性
//    不可达;slowFall 签名改写复合边例窄面新登记）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { MountInstance, FRAME_IN_AIR, FRAME_SWIMMING,
  type MountedPlayerView } from '../src/entities/Mounts';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

/** 真实 Player 最小钩桩（bj704g5 同款） */
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
  } as never as Parameters<P['fixedUpdate']>[1];
}

/** 液池世界（h 可调——shimmering 域须 h>~340 使 UnderworldLayer(=h−200)>pool rows）。
 *  groundLevel=200 显式（缺省 0 → num6 ±Inf 上钳 1 支）;num6=1 于 yT ≥ ~93.3,
 *  太空带钳 0.25（同 bj704g5 夹具口径）。 */
function makePoolWorld(seed: string, top: number, bottom: number, type: number, h = 180) {
  const w = new World(60, h, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, type);
  }
  return w;
}

/** 太空带平地世界（num6 钳 0.25 带）：地面 rows ground..ground+1。 */
function makeSpaceWorld(seed: string, ground = 62) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground, 1, 0, 0);
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  return w;
}

async function makePlayer(yTile: number, armorVid?: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const { ITEM_BY_KEY } = await import('../src/data/items');
  const { vanillaItemKey } = await import('../src/data/vanillaRecipes');
  const p = new Player(21 * 16, yTile * 16, new Inventory());
  if (armorVid !== undefined) {
    const k = vanillaItemKey(armorVid);
    const id = k ? ITEM_BY_KEY[k] : undefined;
    if (id === undefined) throw new Error(`vid ${armorVid} 未注册`);
    p.inv.armor[3] = { id, stack: 1 };
  }
  return p;
}

function rideMount(p: P, type: number) {
  p.mount.active = true;
  p.mount.type = type;
}

/** 无跳键沿持跳（jumpEdgePrev 预置真——全程无 edge,隔离起跳门） */
function holdJumpNoEdge(p: P) {
  p.inputJump = true;
  p.jumpEdgePrev = true;
}

/** MountInstance 单测合成视图（bj704g5 makeView 同式） */
function makeView(over: Partial<MountedPlayerView> = {}): MountedPlayerView {
  return {
    x: 0, y: 0, w: 20, h: 42, vx: 0, vy: -1, onGround: false, inWater: false,
    facing: 1, inputX: 0, inputJump: true, inputUp: false, inputDown: false,
    prevInputJump: true, gravDir: 1, store: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. 债1 未骑乘微光物理（早退近似支退役,湿支 shimmer 档承接）
// ---------------------------------------------------------------------------
describe('BJ704-G12 A 未骑乘微光=湿支 shimmer 档（:24590-24592 0.15 平值/23·5.51/10.01）', () => {
  it('A1 中池静沉：0.15/t（num6=1;旧 0.06/t）,10 拍 vy=1.5（旧 0.6）;30 拍过 3.0（旧 ±带顶 3.0）', async () => {
    const w = makePoolWorld('bj704g12-a1', 90, 137, LIQUID_TYPE.SHIMMER);
    const game = makeHooks(w);
    const p = await makePlayer(130);                 // 中池（盒底 132.6<137 地板）
    p.vy = 0;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inShimmer).toBe(true);
    expect(p.shimmering).toBe(false);                // h=180 → UnderworldLayer=−20 门拒 buff
    expect(p.vy).toBeCloseTo(1.5, 8);                // 0.15×10（旧 0.06×10=0.6）
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeGreaterThan(3.0);               // 旧 ±[-5.5,3.0] 带顶 3.0;新 10.01 钳
  }, 30000);

  it('A2 池底边沿水跳：vy=-(5.51)+0.15=-5.36/jumpHold=23（旧 0.62 游升无跳门）;续拍钉 -5.51', async () => {
    const w = makePoolWorld('bj704g12-a2', 90, 137, LIQUID_TYPE.SHIMMER);
    const game = makeHooks(w);
    const p = await makePlayer(134.375);             // 池底贴齐（bj704g5 D2 同位）
    p.inputJump = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBe(0);
    p.inputJump = true;                              // 边沿起跳（jumpEdgePrev=false）
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(-5.51 + 0.15, 8);       // 跳拍：-shimmer 档 5.51 + 同拍湿重力 0.15
    expect(p.jumpHold).toBe(23);                     // shimmer 档 jumpHeight（旧无跳门）
    p.fixedUpdate(1 / 60, game);                     // 持跳 sustain 钉
    expect(p.vy).toBeCloseTo(-5.51, 10);
    expect(p.jumpHold).toBe(22);
  }, 30000);

  it('A3 中池持跳（无沿）不游升：vy=1+10×0.15=2.5（旧 0.62/t 连续上浮冲 -5.5）', async () => {
    const w = makePoolWorld('bj704g12-a3', 90, 137, LIQUID_TYPE.SHIMMER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    p.vy = 1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(2.5, 8);                // 照常沉（原版水跳门须边沿+踩底/脚蹼）
  }, 30000);
});

// ---------------------------------------------------------------------------
// B. 债2 shimmering 骑乘者 CCed-dismount + CCed 重力臂 num6/9.01
// ---------------------------------------------------------------------------
describe('BJ704-G12 B 微光化骑乘者强制下坐（:27000-27012 CCed 臂）', () => {
  it('B1 骑扫帚入微光：buff353→shimmering 同拍下坐（mount.active=false）+ 0.36/t 穿落', async () => {
    const w = makePoolWorld('bj704g12-b1', 90, 145, LIQUID_TYPE.SHIMMER, 360);  // h=360→UL=160>pool
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 23);                                // 巫婆扫帚
    p.vy = 1;
    p.fixedUpdate(1 / 60, game);
    expect(p.shimmering).toBe(true);                 // buff 353 生效（y/16=130<160）
    expect(p.mount.active).toBe(false);              // ★CCed 强制下坐（旧保持骑乘穿落）
    expect(p.vy).toBeCloseTo(1.36, 8);               // 1 + 0.4×0.9×num6(1)
    for (let i = 0; i < 2; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(1 + 3 * 0.36, 8);
  }, 30000);

  it('B2 太空带微光化（num6 钳 0.25）：重力 0.36×0.25=0.09/t（旧 0.36 平值=4× 偏重）', async () => {
    const w = makePoolWorld('bj704g12-b2', 60, 67, LIQUID_TYPE.SHIMMER, 360);
    const game = makeHooks(w);
    const p = await makePlayer(63);                  // yT≈63 → num6=(63−60)/33.3→钳 0.25
    p.vy = 0;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(p.shimmering).toBe(true);
    expect(p.vy).toBeCloseTo(0.9, 8);                // 0.09×10（旧 3.6）
  }, 30000);

  it('B3 CCed 终速钳=10×0.9+0.01=9.01（旧 PLAYER_MAX_FALL_SPEED(10.01)×0.9=9.009）', async () => {
    const w = makePoolWorld('bj704g12-b3', 90, 145, LIQUID_TYPE.SHIMMER, 360);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 23);
    p.vy = 1;
    for (let i = 0; i < 3; i++) p.fixedUpdate(1 / 60, game);   // 2.08（B1 形）
    expect(p.mount.active).toBe(false);
    for (let i = 0; i < 22; i++) p.fixedUpdate(1 / 60, game);  // 2.08+0.36k → 9.01 钳
    expect(p.vy).toBeCloseTo(9.01, 10);              // 0.001 差判别（9.009 红）
  }, 30000);
});

// ---------------------------------------------------------------------------
// C. 债3 swimFree 液体档重力（水 0.2/蜜 0.1;旧干路 0.4）
// ---------------------------------------------------------------------------
describe('BJ704-G12 C swimFree 坐骑液体档重力（ignoreWater 只辖碰撞/liqFactor）', () => {
  it('C1 海龟 4 水中沉：0.2/t（旧 0.4）;30 拍钳 5.01（旧 10.01）', async () => {
    const w = makePoolWorld('bj704g12-c1', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(100);
    rideMount(p, 4);                                 // buff 131 → swimFree
    expect(p.ridingMountSwimFree).toBe(true);
    p.vy = 0;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    expect(p.vy).toBeCloseTo(2.0, 8);                // 0.2×10（旧干路 0.4×10=4.0）
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(5.01, 8);               // 液体档 maxFall 钳（旧 10.01）
  }, 30000);

  it('C2 海龟蜜中沉：0.1/t（GRAVITY×0.25 蜜档;旧干路 0.4）', async () => {
    const w = makePoolWorld('bj704g12-c2', 90, 137, LIQUID_TYPE.HONEY);
    const game = makeHooks(w);
    const p = await makePlayer(100);
    rideMount(p, 4);
    p.vy = 0;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inHoney).toBe(true);
    expect(p.vy).toBeCloseTo(1.0, 8);                // 0.1×10（旧 4.0）
  }, 30000);

  it('C3 猪鲨崽 12 水中↑沿起飞：冲量读湿档 gField 0.2——vy=-0.401（旧干档 -0.601）', async () => {
    const w = makePoolWorld('bj704g12-c3', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(134.375);             // 池底贴齐
    rideMount(p, 12);                                // buff 168 → swimFree + hover 免疲劳
    p.inputJump = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);   // 贴底稳定（gField=0.2,增益态 mult=1）
    expect(p.vy).toBe(0);
    p.inputUp = true;                                // ↑沿（inputJump 未按 → jumpEdgePrev 假）
    p.fixedUpdate(1 / 60, game);
    // upkeep tryStartHover 冲量 -(accel 0.2+gField 0.2+0.001)=-0.401 → 同拍 hover 升臂
    // 再 -0.2（-0.601 落带 [-8,-0.001] 内带回拉不咬）→ -0.601（旧干档 gField 0.4 → -0.801）
    expect(p.vy).toBeCloseTo(-0.601, 8);
    expect(p.mount.frameState).toBe(FRAME_SWIMMING);
  }, 30000);
});

// ---------------------------------------------------------------------------
// D. 债4 湿支玩家 wingTime 回充 releaseJump 门
// ---------------------------------------------------------------------------
describe('BJ704-G12 D 湿支 wingTime 回充 releaseJump 门（:26976-26982）', () => {
  it('D1 池底持跳（无沿）翼时量不回满;松跳拍回满（旧持跳逐拍回满=免松键无限扇动）', async () => {
    const w = makePoolWorld('bj704g12-d1', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(134.375, 493);        // 天使之翼
    p.inputJump = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBe(0);
    const wt = p.equipStats.wing?.time ?? -1;
    expect(wt).toBeGreaterThan(0);
    p.wingTime = 1;                                  // 耗尽形态
    holdJumpNoEdge(p);
    for (let i = 0; i < 5; i++) p.fixedUpdate(1 / 60, game);
    expect(p.wingTime).toBe(1);                      // ★持跳不回充（旧=wt 回满）
    p.inputJump = false;                             // 松跳
    p.fixedUpdate(1 / 60, game);
    expect(p.wingTime).toBe(wt);                     // releaseJump 拍回满
  }, 30000);
});

// ---------------------------------------------------------------------------
// E. 债5 干支毯带 gravity 字段（太空带 num6）
// ---------------------------------------------------------------------------
describe('BJ704-G12 E 干支毯带=gravity 字段（:22037;太空带 0.4×0.25）', () => {
  it('E1 太空带毯带：钉 -(0.1+ε) 与重力 +0.1 相消 → 拍末 vy≈-1e-6 高度保持（旧 -0.4 钉=0.3/t 上爬）', async () => {
    const w = makeSpaceWorld('bj704g12-e1', 62);     // 地面 row 62 → 飞行带 num6=0.25
    const game = makeHooks(w);
    const p = await makePlayer(59.375, 934);         // 飞毯;盒底=62×16 贴地
    p.inputJump = false;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);   // 落地稳定（canCarpet=true）
    expect(p.vy).toBe(0);
    expect(p.equipStats.carpet).toBe(true);
    p.inputJump = true;
    p.jumpEdgePrev = false;                          // 边沿起跳
    p.fixedUpdate(1 / 60, game);
    p.jumpEdgePrev = true;                           // 持跳
    let deployed = false;
    for (let i = 0; i < 120 && !deployed; i++) {
      p.fixedUpdate(1 / 60, game);
      deployed = p.carpetFlying;
    }
    expect(deployed).toBe(true);                     // 跳预算尽后毯激活
    // 上升段（vy<-0.1 不钉,0.1/t 减速）→ 顶点入 (-0.1,0] 窗后进入钉位稳态
    let converged = false;
    for (let i = 0; i < 200 && !converged; i++) {
      p.fixedUpdate(1 / 60, game);
      converged = p.vy > -0.05;
    }
    expect(converged).toBe(true);
    for (let i = 0; i < 5; i++) p.fixedUpdate(1 / 60, game);   // 过窗瞬态（-0.01 一拍）后入稳态
    // 拍末序=毯钉 -(g+ε) → 干重力 +g → vy=-ε（vanilla CarpetMovement :26967 先于
    // vy 链 :27158 同构）;旧常数钉 -0.400001 vs 重力 +0.1 → -0.300001 = 0.3/t 上爬
    expect(p.vy).toBeCloseTo(-1e-6, 9);
    const yAtBand = p.y;
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);
    expect(Math.abs(p.y - yAtBand)).toBeLessThan(0.001);   // 高度保持（旧 20 拍爬 6px）
    expect(p.carpetTime).toBeGreaterThan(0);
  }, 30000);
});

// ---------------------------------------------------------------------------
// F. 债6 Mount.Hover 48 特例臂（flag4 升力禁用/静置带/耗尽重力臂/↓带 8）
// ---------------------------------------------------------------------------
describe('BJ704-G12 F 暗黑魔法书 48 hover 特例臂（:3411-3431/:3463-3468）', () => {
  it('F1 能量窗（flyTime>0）持跳：无升力输入——vy 钉 -0.001 静置（旧 lift 可用 → -0.2 起爬）', () => {
    const m = new MountInstance();
    m.setMount(48, makeView());
    m.flyTime = 100;
    m.frameState = FRAME_IN_AIR;
    const v = makeView({ vy: 0, inputJump: true });
    m.hover(v);
    expect(v.vy).toBeCloseTo(-0.001, 12);            // flag4=false 升力臂不可达（旧 -0.2）
    expect(m.flyTime).toBe(99);                      // 能量池照耗（48 不在免疲劳表）
  });

  it('F2 ↑键同 F1（(controlUp||controlJump) 双输入面同禁）', () => {
    const m = new MountInstance();
    m.setMount(48, makeView());
    m.flyTime = 100;
    m.frameState = FRAME_IN_AIR;
    const v = makeView({ vy: 0, inputJump: false, inputUp: true });
    m.hover(v);
    expect(v.vy).toBeCloseTo(-0.001, 12);
  });

  it('F3 耗尽（flyTime=0/fatigueMax 0→canLift 假）：重力驱动臂 vy+=0.4 带宽 4——1 拍 0.4/25 拍 7.0（旧静置带永浮）', () => {
    const m = new MountInstance();
    m.setMount(48, makeView());
    m.flyTime = 0;
    m.frameState = FRAME_IN_AIR;
    const v = makeView({ vy: 0, inputJump: false });
    m.hover(v);
    expect(v.vy).toBeCloseTo(0.4, 12);               // flag5 重力臂（gravityField 缺省 0.4）
    for (let i = 0; i < 24; i++) m.hover(v);
    // 净 +0.2/t（重力 0.4 − 带回拉 0.2）：10 拍至 4.0,余 15 拍 → 4.0+15×0.2=7.0
    expect(v.vy).toBeCloseTo(7.0, 6);                // 无界加速坠落面（vanilla 同构）
  });

  it('F4 耗尽+↓：↓臂胜重力臂——带宽 8 收敛（48 特例臂 controlDown→num5=8 保留面）', () => {
    const m = new MountInstance();
    m.setMount(48, makeView());
    m.flyTime = 0;
    m.frameState = FRAME_IN_AIR;
    const v = makeView({ vy: 0, inputJump: false, inputDown: true });
    for (let i = 0; i < 45; i++) m.hover(v);
    expect(v.vy).toBeCloseTo(8.0, 6);                // 0.2/t 收敛 8（非重力臂 0.4 无界）
  });
});

// ---------------------------------------------------------------------------
// G. 债7 stepUpCarpet/stepUpInvGate 精确承载（carpetFlying 单一真源）
// ---------------------------------------------------------------------------
describe('BJ704-G12 G stepUp 毯腿=carpetFlying（≙ carpetFrame!=-1,旧 carpetTime>0∧inputJump 偏宽）', () => {
  async function carpetFlight(p: P, game: ReturnType<typeof makeHooks>) {
    p.inputJump = true;
    p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.jumpEdgePrev = true;
    for (let i = 0; i < 120 && !p.carpetFlying; i++) p.fixedUpdate(1 / 60, game);
    return p.carpetFlying;
  }

  it('G1 展开拍 stepUpCarpet=true;extraJumps 残量拍（毯块外门拒）=false（旧恒真）;清空恢复', async () => {
    const w = makeSpaceWorld('bj704g12-g1', 62);
    const game = makeHooks(w);
    const p = await makePlayer(59.375, 934);
    p.inputJump = false;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(await carpetFlight(p, game)).toBe(true);
    expect(p.stepUpCarpet).toBe(true);               // 展开拍（carpetFrame!=-1 ≙）
    p.extraJumps = ['Cloud'];                        // 毯块外门（:22025 canJumpAgain_* 全假）拒
    p.fixedUpdate(1 / 60, game);
    expect(p.carpetFlying).toBe(false);              // 未展开（vanilla carpetFrame=-1）
    expect(p.stepUpCarpet).toBe(false);              // ★旧 carpetTime>0∧inputJump=true 偏宽
    p.extraJumps = [];
    p.fixedUpdate(1 / 60, game);
    expect(p.carpetFlying).toBe(true);               // 外门复通=余油续展（P3d 同语义）
    expect(p.stepUpCarpet).toBe(true);
  }, 30000);

  it('G2 末拍燃料（carpetTime 1→0）：本拍在带内 stepUpCarpet=true（旧 carpetTime>0 已假）', async () => {
    const w = makeSpaceWorld('bj704g12-g2', 62);
    const game = makeHooks(w);
    const p = await makePlayer(59.375, 934);
    p.inputJump = false;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(await carpetFlight(p, game)).toBe(true);
    p.carpetTime = 1;                                // 末拍燃料
    p.fixedUpdate(1 / 60, game);
    expect(p.carpetTime).toBe(0);
    expect(p.carpetFlying).toBe(true);               // 本拍在展开（vanilla carpetFrame 置位拍）
    expect(p.stepUpCarpet).toBe(true);               // ★旧式 carpetTime>0 判已假
  }, 30000);
});

// ---------------------------------------------------------------------------
// H/I. 债8 销案判语锁 + 全刀结构锁
// ---------------------------------------------------------------------------
describe('BJ704-G12 H/I 债8 销案 + 结构锁（Player.ts/Mounts.ts 源文本锚）', () => {
  const playerSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
  const mountsSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');

  it('H1 债8 tryStartHover 一拍滞后=销案（vy==0 静止拍 num6 带不变;slowFall 签名复合边例窄面登记）', () => {
    expect(mountsSrc).toContain('G5 登记债8 复核=销案');
    expect(mountsSrc).toContain('p.gravityFieldFresh ?? p.gravityField ?? DEFAULT_GRAVITY) + 0.001');   // 消费面不变
  });

  it('I1 债1：早退支退役（负锁）+ 湿门两臂合流', () => {
    expect(playerSrc).not.toContain('if (this.inShimmer && !this.shimmering && !this.ridingMount) {');
    expect(playerSrc).not.toContain('this.vy - 0.62');
    expect(playerSrc).toContain('if (this.inWater || this.inLava');
    expect(playerSrc).toContain('|| (this.inShimmer && !this.shimmering)) {');
  });

  it('I2 债2：CCed 下坐集补 shimmering + 重力臂 num6/9.01', () => {
    expect(playerSrc).toContain('|| this.buffs.has(BuffType.Webbed)\n        || this.shimmering) {');
    expect(playerSrc).toContain('this.vy = Math.min(this.vy + GRAVITY * 0.9 * num6Sh, 10 * 0.9 + 0.01);');
  });

  it('I3 债4：湿支 wingTime 回充 !inputJump 门（extraJumps/rocketTime 无门保持）', () => {
    expect(playerSrc).toContain('if (!this.inputJump) this.wingTime = eqM.wing ? eqM.wing.time : 0;');
    expect(playerSrc).toContain('this.extraJumps = [...eqM.jumpOpts];');
  });

  it('I4 债5：num6 提取块 + 毯带 mountGField 双臂', () => {
    expect(playerSrc).toContain('mountGField = GRAVITY * num6D2;');
    expect(playerSrc).toContain('if (this.vy < mountGField) this.vy = mountGField + 1e-6;');
    expect(playerSrc).toContain('this.vy = -(mountGField + 1e-6);');
  });

  it('I5 债6：hover 48 特例臂四件（flag4/静置带/flag5 重力臂/↓带 8）', () => {
    expect(mountsSrc).toContain('let gravFall = false;');
    expect(mountsSrc).toContain('if (this.type !== 48 && (p.inputUp || p.inputJump) && canLift) {');
    expect(mountsSrc).toContain('} else if (gravFall) {');
    expect(mountsSrc).toContain('vy += gravityField * p.gravDir;');
    expect(mountsSrc).toContain('if (p.inputDown) vMax = 8;');
  });

  it('I6 债7：stepUpCarpet/stepUpInvGate 毯腿改读 carpetFlying', () => {
    expect(playerSrc).toContain('this.stepUpCarpet = this.carpetFlying;');
    expect(playerSrc).toContain('(this.carpetFlying || this.vy <= this.gField)');
    expect(playerSrc).not.toContain('this.stepUpCarpet = this.carpetTime > 0 && this.inputJump;');
  });
});
