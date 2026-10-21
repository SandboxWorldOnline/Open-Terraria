// ★BJ704-G5（2026-10-21）坐骑/毯域八件登记债清算判别锁。
//  债源：BJ704-G4 六债（memory/bj704g4-mount-water-flight.md）+ BJ704-R4 四 P2 同域
//  三件（memory/bj704r4-player-mount-redblue.md）,去重八件 + 域外一件（D1 shimmering 腿）。
//
// 【定谳锚（1457 反编译亲读）】
//  · G4-① 骑乘水跳参数档：UpdateJumpHeight（:26211→:19746-19757）骑乘覆写在液体档
//    【后】=坐骑档终值（非叠加族整体替换;叠加族=滚轴鞋 57-60 液体基+坐骑增量）——
//    仓旧水跳门 vy=−lJSpd（液体档 6.01/30）双偏。
//  · G4-② hover 重力场感知族（Mount.cs Hover/Player.cs:26939-26941）：疲劳率
//    num2=gravity/defaultGravity（:3378-3386,slowFall ÷3/下钳 0.25）;非飞行帧臂
//    vy += gravity*gravDir（:3502）;起飞冲量 −(Acceleration+gravity+0.001)（:26941）。
//  · G4-③ 帧态分派：飞行门 jump==0（:36446）;游泳臂判据 wet 任意液体（:36485——
//    熔岩鲨 49 骑岩浆帧态 4→canHover 成立;case 49 强切 :3732-3737）。
//  · G4-④ 微光池坐骑链：vy 链（:27158-27235）无液体种类门——shimmerWet 只改参数档
//    （:24581-24593 gravity 0.15 平值/jump 23·5.51;maxFallSpeed 10.01）。
//  · G4-⑤a 湿链 num6：:24884 gravity×num6 无条件（含湿;maxFallSpeed/jumpSpeed 无乘区）。
//    ⑤b 下坐块位次=销案（vy 加法净效同,BJ704-G4 B3 已锁;寄存器拍尾登记）。
//  · R4-P2① 毯复位触发域：:26300-26311 每拍门 `!carpet→canCarpet=false;
//    carpet∧(vy==0∨sliding)→canCarpet=true,carpetTime=0`（撞顶/贴墙滑拍同复位）。
//  · R4-P2② 毯姿门：carpetFrame>=0（:36570/:36839）=CarpetMovement 带内本拍置位
//    （:22062-22064 每拍先清——松跳余油/空中卸毯拍 carpetFrame=-1）。
//  · R4-P2④ 迅猛龙 54 补燃坑：:26978-26982 `((vy==0∨sliding)∧releaseJump)∨(autoJump
//    ∧justJumped)` → ResetFlightTime——持跳跨跳不回充（每周期须松跳）;仅修 54 面。
//  · 域外件：walkDownSlopeOff 补 shimmering 腿（原版 :28255 `if (!shimmering)` 整跳
//    SlopeDown/StepDown/StepUp 块——R4 判例:解耦刀每个真豁免员必须在新通道有归宿）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { MountInstance, FRAME_SWIMMING, FRAME_IN_AIR, FRAME_FLYING,
  type MountedPlayerView } from '../src/entities/Mounts';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

/** 真实 Player 最小钩桩（bj704g4 同款） */
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

/** 液池世界（type=LIQUID_TYPE）：rows [top..bottom-1] 液、bottom 实心底（x 14..28）。
 *  groundLevel=200 显式（World 缺省 0 → num6 ±Inf 上钳支非公式面）;num6=1 于
 *  yT ≥ 60+10n5+200/6 ≈ 93.3,太空带钳 0.25（同 bj704g4 夹具口径）。 */
function makePoolWorld(seed: string, top: number, bottom: number, type: number) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, type);
  }
  return w;
}

/** 平地世界（毯/54 补燃域）：row 120-121 石板地面。groundLevel=200 → num6=1
 *  （边界 yT≈93.3——row 62 带系太空带 num6=0.25 慢重力,落地被拖长,故取 row 120）。 */
function makeFlatWorld(seed: string) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 120, 1, 0, 0);
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 121, 1, 0, 0);
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

/** MountInstance 单测合成视图（bj703d makeView 同式） */
function makeView(over: Partial<MountedPlayerView> = {}): MountedPlayerView {
  return {
    x: 0, y: 0, w: 20, h: 42, vx: 0, vy: -1, onGround: false, inWater: false,
    facing: 1, inputX: 0, inputJump: true, inputUp: false, inputDown: false,
    prevInputJump: true, gravDir: 1, store: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. G4-① 骑乘水跳参数档（坐骑档终值,非液体档）
// ---------------------------------------------------------------------------
describe('BJ704-G5 A 骑乘水跳=坐骑档（UpdateJumpHeight :19746-19757 后覆写）', () => {
  it('A1 飞行族（驯鹿 0,5.31/17）：池底跳拍 vy=-(5.31)+0.2=-5.11/jumpHold=17（旧液体档 -5.81/30）', async () => {
    const w = makePoolWorld('bj704g5-a1', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(134.375);          // 池底贴齐（bj704g4 G1 同位）
    rideMount(p, 0);
    p.inputJump = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);   // 贴底稳定
    expect(p.vy).toBe(0);
    p.inputJump = true;                            // 边沿起跳
    p.fixedUpdate(1 / 60, game);
    // 跳拍：-坐骑档 5.31 + 同拍湿重力 0.2（原版链序:跳 → 链被 jump>0 拒 → 重力臂）
    expect(p.vy).toBeCloseTo(-5.31 + 0.2, 5);
    expect(p.jumpHold).toBe(17);                   // 坐骑档 jumpHeight（旧 30）
  }, 30000);

  it('A2 叠加族（滚轴鞋 57,jumpSpeed 1/jumpHeight 2）：水跳=液体基+坐骑增量 vy=-(6.01+1)+0.2/jumpHold=32', async () => {
    const w = makePoolWorld('bj704g5-a2', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(134.375);
    rideMount(p, 57);
    p.inputJump = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBe(0);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, game);
    // jumpBaseSnapshot(6.01,30) 液体基 + 滑鞋增量 1/2（:19748-19751 additive 支）
    expect(p.vy).toBeCloseTo(-(6.01 + 1) + 0.2, 5);
    expect(p.jumpHold).toBe(32);
  }, 30000);
});

// ---------------------------------------------------------------------------
// B. G4-② hover 重力场感知族（疲劳率 num2 / 非飞行帧臂 / 起飞冲量）
// ---------------------------------------------------------------------------
describe('BJ704-G5 B hover 重力场感知（Mount.cs :3378-3386/:3502 + Player.cs:26941）', () => {
  it('B1 疲劳率 num2=gravity/defaultGravity：湿 0.2→0.5/t;干 0.4→1;太空带 0.1→钳 0.25;slowFall ÷3', () => {
    const m = new MountInstance();
    m.setMount(5, makeView());                     // 蜜蜂坐骑：usesHover+fatigueMax 320,
    m.flyTime = 0;                                 //  不在免疲劳表 {7,8,12,23,44,49,56,61}
    m.fatigue = 0;
    m.frameState = FRAME_SWIMMING;                 // ∈ flyingState（默认门 2∨4）
    const v = makeView({ inputUp: true, vy: 0 });
    m.hover(v, 0.2);                               // 湿档重力场（水 0.2×num6=1）
    expect(m.fatigue).toBeCloseTo(0.5, 10);        // 旧常数 1=干档值
    m.hover(v, 0.4);
    expect(m.fatigue).toBeCloseTo(1.5, 10);
    m.hover(v, 0.1);                               // 太空带 → 下钳 0.25（:3383-3385）
    expect(m.fatigue).toBeCloseTo(1.75, 10);
    m.hover(makeView({ inputUp: true, vy: 0, slowFall: true }), 0.4);   // ÷3（:3379-3381）
    expect(m.fatigue).toBeCloseTo(1.75 + 1 / 3, 10);
  });

  it('B2 非飞行帧态臂 :3502：vy += gravity 字段（0.2 档,旧 DEFAULT_GRAVITY 0.4）', () => {
    const m = new MountInstance();
    m.setMount(5, makeView());
    m.frameState = FRAME_IN_AIR - 2;               // 0=STANDING,非 flyingState
    const v = makeView({ vy: 0 });
    m.hover(v, 0.2);
    expect(v.vy).toBeCloseTo(0.2, 10);             // 旧 0.4
  });

  it('B3 起飞冲量 :26941：-(acceleration+gravity 字段+0.001)——扫帚 23 acc 0.16+微光档 0.15', () => {
    const m = new MountInstance();
    m.setMount(23, makeView());
    const v = makeView({ vy: 0, inputUp: true, jumpEdgePrev: false, gravityField: 0.15 });
    m.tryStartHover(v);
    expect(v.vy).toBeCloseTo(-(0.16 + 0.15 + 0.001), 10);   // 旧 -(0.16+0.4+0.001)
  });

  it('B4 链接线（结构）：干/湿坐骑链把当拍重力场传入 hover 第二参', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
      '../src/entities/Player.ts'), 'utf8');
    expect(src).toContain('mnt2.hover(this, mountGFieldW);');
    expect(src).toContain('mnt2.hover(this, mountGField);');
  });
});

// ---------------------------------------------------------------------------
// C. G4-③ 帧态分派（inWater→wet + jump==0 门 + case 49 强切）
// ---------------------------------------------------------------------------
describe('BJ704-G5 C 帧态分派（:36444-36494 jump==0/wet;case 49 :3732-3737）', () => {
  it('C1 熔岩鲨 49 骑岩浆（wet 非水）：分派 SWIMMING(4) → canHover 成立（旧 inWater 只水→2 不悬停）', () => {
    const m = new MountInstance();
    m.setMount(49, makeView());
    m.updateFrameDispatch(makeView({ vy: 0.5, inputJump: false, wet: true }));
    expect(m.frameState).toBe(FRAME_SWIMMING);
    expect(m.canHover(makeView({ wet: true }))).toBe(true);
    // 干态负对照：非湿 → IN_AIR → 49 canHover 假
    m.updateFrameDispatch(makeView({ vy: 0.5, inputJump: false }));
    expect(m.frameState).toBe(FRAME_IN_AIR);
    expect(m.canHover(makeView())).toBe(false);
  });

  it('C2 飞行门 jump==0（:36446）：54 装翼持跳上升段（jumpHold>0）分派 IN_AIR 非扇翼 FLYING', () => {
    const m = new MountInstance();
    m.setMount(54, makeView());
    m.flyTime = 10;
    m.allowedToFly = true;
    m.updateFrameDispatch(makeView({ vy: 0.5, inputJump: true, jumpHold: 5 }));
    expect(m.frameState).toBe(FRAME_IN_AIR);      // 旧：无 jump==0 门 → FLYING
    m.updateFrameDispatch(makeView({ vy: 0.5, inputJump: true, jumpHold: 0 }));
    expect(m.frameState).toBe(FRAME_FLYING);      // 钉尽后恢复扇翼帧
  });

  it('C3 case 49 强切（:3732-3737）：wet 时任意分派态（含贴地 STANDING）直切游泳帧', () => {
    const m = new MountInstance();
    m.setMount(49, makeView());
    m.updateFrame(makeView({ wet: true }), 0, 0, 0);   // 地面帧分派
    expect(m.frameState).toBe(FRAME_SWIMMING);
  });

  it('C4 全链：骑 49 浸岩浆悬停接管 vy（持跳爬升带,旧 IN_AIR→canCarpet 假→干路重力 0.4/t 直坠）', async () => {
    const w = makePoolWorld('bj704g5-c4', 90, 137, LIQUID_TYPE.LAVA);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 49);                             // buff 305 ignoreWater=干路（swimFree）
    p.vy = 1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inLava).toBe(true);
    expect(p.mount.frameState).toBe(FRAME_SWIMMING);   // wet 分派（旧 inWater 假 → 2）
    expect((p as unknown as { canHover?: boolean }).canHover === undefined || true).toBe(true);   // (view getter 无关,下条判别)
    expect(p.mount.canHover(p)).toBe(true);
    expect(p.vy).toBeLessThanOrEqual(-5);         // 悬停爬升带（-0.4/t 收敛 -8）;旧直坠 vy>1
  }, 30000);
});

// ---------------------------------------------------------------------------
// D. G4-④ 微光池坐骑链（骑乘者微光照飞,shimmer 档 0.15/10.01/5.51·23）
// ---------------------------------------------------------------------------
describe('BJ704-G5 D 骑乘微光链（:27158-27235 无液体种类门;:24581-24593 shimmer 档）', () => {
  it('D1 耗尽缓降：重力=0.15×num6/3=0.05/t（旧早退支 0.06 平添且无链/无 num6）', async () => {
    const w = makePoolWorld('bj704g5-d1', 90, 137, LIQUID_TYPE.SHIMMER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 0);                              // 驯鹿：飞行族,耗尽臂可观测
    p.mount.flyTime = 0;
    p.vy = -0.1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 15; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inShimmer).toBe(true);
    expect(p.shimmering).toBe(false);             // 未微光化（underworldLayer 门,h<200 世界恒假）
    expect(p.mount.active).toBe(true);
    expect(p.vy).toBeCloseTo(-0.1 + 15 * 0.05, 5);   // 0.65;旧早退支 0.06/t=0.8 无链
  }, 30000);

  it('D2 池底水跳：vy=-(坐骑档 5.31)+0.15=-5.16/jumpHold=17（液体档基 5.51/23 被骑乘覆写）', async () => {
    const w = makePoolWorld('bj704g5-d2', 90, 137, LIQUID_TYPE.SHIMMER);
    const game = makeHooks(w);
    const p = await makePlayer(134.375);
    rideMount(p, 0);
    p.inputJump = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBe(0);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(-5.31 + 0.15, 5);    // 旧早退支无跳门（-0.62 上游近似）
    expect(p.jumpHold).toBe(17);
  }, 30000);

  it('D3 悬停族（扫帚 23）微光静置：hover 接管 vy→-0.001 钉位（旧早退支 +0.06/t 直沉）', async () => {
    const w = makePoolWorld('bj704g5-d3', 90, 137, LIQUID_TYPE.SHIMMER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 23);
    p.vy = 1;
    p.inputJump = false;                          // 静置带（无升降输入）
    for (let i = 0; i < 12; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(-0.001, 8);          // 免疲劳静置钉位（旧 1+12×0.06=1.72）
  }, 30000);
});

// ---------------------------------------------------------------------------
// E. G4-⑤a 湿链 num6（:24884 gravity×num6 含湿;⑤b 下坐块位次=销案见批注）
// ---------------------------------------------------------------------------
describe('BJ704-G5 E 湿重力 ×num6（旧 0.2 平值=太空带水池 4× 偏重）', () => {
  it('E1 太空带水池（num6→钳 0.25）：未骑乘下沉 0.2×0.25=0.05/t（旧 0.2/t）', async () => {
    const w = makePoolWorld('bj704g5-e1', 60, 67, LIQUID_TYPE.WATER);   // yT≈63 太空带
    const game = makeHooks(w);
    const p = await makePlayer(63);
    p.vy = 0;
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    expect(p.vy).toBeCloseTo(20 * 0.05, 4);       // 1.0;旧 20×0.2=4.0
  }, 30000);

  it('E2 湿态断翅滑翔（:27541 gravity/3）：重力=湿档 0.2/3≈0.0667/t（旧 GRAVITY/3=0.1333/t→钳 1.67）', async () => {
    const w = makePoolWorld('bj704g5-e2', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(120, 493);         // 天使之翼（翼尽滑翔面）
    p.wingTime = 0;
    p.vy = 1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 5; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(1 + 5 * (0.2 / 3), 4);   // ≈1.333;旧 1+0.667→钳 1.67
  }, 30000);
});

// ---------------------------------------------------------------------------
// F. R4-P2① 毯复位触发域（vy==0∨sliding,每拍门）
// ---------------------------------------------------------------------------
describe('BJ704-G5 F 毯复位域（:26300-26311;旧干支 onGround/湿支 vy===0 窄门）', () => {
  it('F1 撞顶拍面：空中 vy==0（!onGround）复位 canCarpet+carpetTime 清 0', async () => {
    const w = makeFlatWorld('bj704g5-f1');
    const game = makeHooks(w);
    const p = await makePlayer(55, 934);          // 飞毯配饰;row 55 空中
    p.canCarpet = false;
    p.carpetTime = 250;                           // 空中余油（松跳残留）
    p.vy = 0;                                     // 撞顶/顶点拍形
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.onGround).toBe(false);               // 仍是空中（首拍重力刚加）
    expect(p.canCarpet).toBe(true);               // 旧 onGround 门不复位
    expect(p.carpetTime).toBe(0);
  }, 30000);

  it('F2 贴墙滑拍面：wallCling（≙sliding）任意 vy 复位', async () => {
    const w = makeFlatWorld('bj704g5-f2');
    const game = makeHooks(w);
    const p = await makePlayer(55, 934);
    p.canCarpet = false;
    p.carpetTime = 250;
    p.vy = 2;                                     // 滑落中（vy≠0）
    p.wallCling = true;                           // 上拍置位值（原版 :26305 同读上拍）
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.canCarpet).toBe(true);
    expect(p.carpetTime).toBe(0);
  }, 30000);

  it('F3 !carpet 拍拍清：卸毯（无配饰）canCarpet 立即复位 false（旧残留至落地）', async () => {
    const w = makeFlatWorld('bj704g5-f3');
    const game = makeHooks(w);
    const p = await makePlayer(55);               // 无毯
    p.canCarpet = true;                           // 陈旧残留
    p.vy = 3;
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.canCarpet).toBe(false);
  }, 30000);

  it('F4 悬停坐骑贴地拍面：骑扫帚 vy==0（恒不置 onGround）复位毯', async () => {
    const w = makeFlatWorld('bj704g5-f4');
    const game = makeHooks(w);
    const p = await makePlayer(50, 934);
    rideMount(p, 23);                             // 免疲劳贴地臂 vy==0 恒不置 onGround
    p.canCarpet = false;
    p.carpetTime = 250;
    p.vy = 0;
    p.inputJump = false;
    for (let i = 0; i < 3; i++) p.fixedUpdate(1 / 60, game);
    expect(p.onGround).toBe(false);
    expect(p.canCarpet).toBe(true);
    expect(p.carpetTime).toBe(0);
  }, 30000);
});

// ---------------------------------------------------------------------------
// G. R4-P2② 毯姿门余油窗（carpetFlying ≙ carpetFrame>=0 单一真源）
// ---------------------------------------------------------------------------
describe('BJ704-G5 G 毯姿门（:36570/:36839 carpetFrame>=0;旧 !onGround&&carpetTime>0）', () => {
  it('G1 带内飞：carpetFlying=true,燃料逐拍耗', async () => {
    const w = makeFlatWorld('bj704g5-g1');
    const { Player } = await import('../src/entities/Player');
    const { Inventory } = await import('../src/items/Inventory');
    const game = makeHooks(w);
    const p = new Player(21 * 16, 55 * 16, new Inventory()) as P;
    p.inv.armor[3] = { id: (await import('../src/data/items')).ITEM_BY_KEY['vi_934_FlyingCarpet'], stack: 1 };
    p.carpetTime = 300;
    p.vy = 3;
    holdJumpNoEdge(p);
    p.fixedUpdate(1 / 60, game);
    expect(p.carpetFlying).toBe(true);            // 本拍在展开
    expect(p.carpetTime).toBe(299);
  }, 30000);

  it('G2 松跳余油窗：carpetFlying=false 而燃料保留（旧渲染门 carpetTime>0 → 毯姿残留）', async () => {
    const { Player } = await import('../src/entities/Player');
    const { Inventory } = await import('../src/items/Inventory');
    const { ITEM_BY_KEY } = await import('../src/data/items');
    const w = makeFlatWorld('bj704g5-g2');
    const game = makeHooks(w);
    const p = new Player(21 * 16, 55 * 16, new Inventory()) as P;
    p.inv.armor[3] = { id: ITEM_BY_KEY['vi_934_FlyingCarpet'], stack: 1 };
    p.carpetTime = 250;                           // 余油
    p.vy = 3;
    p.inputJump = false;                          // 松跳（余油窗）
    p.fixedUpdate(1 / 60, game);
    expect(p.carpetFlying).toBe(false);           // 姿态位每拍先清（≙ carpetFrame=-1）
    expect(p.carpetTime).toBe(250);               // 燃料不耗
  }, 30000);

  it('G3 空中卸毯：无配饰持跳 carpetFlying=false（燃料保留但姿态退出）', async () => {
    const { Player } = await import('../src/entities/Player');
    const { Inventory } = await import('../src/items/Inventory');
    const w = makeFlatWorld('bj704g5-g3');
    const game = makeHooks(w);
    const p = new Player(21 * 16, 55 * 16, new Inventory()) as P;
    p.carpetTime = 250;                           // 卸毯前余油（无配饰）
    p.vy = 3;
    holdJumpNoEdge(p);
    p.fixedUpdate(1 / 60, game);
    expect(p.carpetFlying).toBe(false);           // 旧渲染门 !onGround&&carpetTime>0 → 残留毯姿
    expect(p.carpetTime).toBe(250);
  }, 30000);
});

// ---------------------------------------------------------------------------
// H. R4-P2④ 迅猛龙 54 补燃坑（releaseJump 门,仅 54 面）
// ---------------------------------------------------------------------------
describe('BJ704-G5 H 54 回充 releaseJump 门（:26978-26982;勿动 mount50 族）', () => {
  it('H1 单元：upkeep 持跳（inputJump）拍不回充,松跳拍回满 wingTimeMax;mount 50 不受门辖', () => {
    const m54 = new MountInstance();
    m54.setMount(54, makeView());
    m54.allowedToFly = true;
    m54.flyTime = 10;
    m54.upkeep(makeView({ onGround: true, inputJump: true }));   // 持跳落地拍
    expect(m54.flyTime).toBe(10);                 // 旧：无门 → 回满（持跳无限飞根）
    m54.upkeep(makeView({ onGround: true, inputJump: false }));  // 松跳拍
    expect(m54.flyTime).toBe(0);                  // wingTimeMax 缺省 0（合成视图无翼）
    const m50 = new MountInstance();
    m50.setMount(50, makeView());
    m50.flyTime = 5;
    m50.upkeep(makeView({ onGround: true, inputJump: true }));   // 50 族维持既有语义
    expect(m50.flyTime).toBe(80);                 // flightTimeMax 80（探针已验面）
  });

  it('H2 全链：54+翼落地持跳不回充 → 松跳次拍回满 100（探针 BJ704-R4 复现锁）', async () => {
    const w = makeFlatWorld('bj704g5-h2');
    const game = makeHooks(w);
    const p = await makePlayer(112, 493);         // 天使之翼（wingTimeMax 100）;地板
    rideMount(p, 54);                             //  row 120——num6=1 常重力带
    p.inputJump = false;
    for (let i = 0; i < 60; i++) p.fixedUpdate(1 / 60, game);   // 落地稳定（松跳回充面）
    expect(p.mount.allowedToFly).toBe(true);
    expect(p.mount.flyTime).toBe(100);
    p.mount.flyTime = 0;                          // 耗尽形态（爬升臂不消费,纯观测回充门）
    p.inputJump = true;                           // 持跳（jumpEdgePrev 真值继承=无沿,
    p.jumpEdgePrev = true;                        //  不触发起跳门;canFly∧jump==0 → 耗尽臂）
    p.fixedUpdate(1 / 60, game);                  // 落地拍（onGround/vy==0）
    expect(p.mount.flyTime).toBe(0);              // ★门咬住：持跳不回充（旧回满 100）
    p.inputJump = false;                          // 松跳
    p.fixedUpdate(1 / 60, game);
    expect(p.mount.flyTime).toBe(100);            // 松跳拍回满
  }, 30000);
});

// ---------------------------------------------------------------------------
// I. 域外件 + 结构锁（walkDownSlopeOff shimmering 腿 / 各刀源文本锚）
// ---------------------------------------------------------------------------
describe('BJ704-G5 I 结构锁（Player.ts/Mounts.ts/Renderer.ts 源文本锚）', () => {
  const playerSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
  const mountsSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');
  const rendererSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/render/Renderer.ts'), 'utf8');

  it('I1 域外件：walkDownSlopeOff 补 shimmering 腿（原版 :28255 整跳块豁免员归宿）', () => {
    expect(playerSrc).toContain(
      'this.walkDownSlopeOff = this.onTrack || this.ridingCart || flag28Fx || flag29Fx || this.shimmering;');
  });

  it('I2 G4-④ 路由（★BJ704-G12 债1 更新：未骑乘微光早退支退役=骑/未骑同走湿门微光臂）', () => {
    // G12 债1 清偿：`if (this.inShimmer && !this.shimmering && !this.ridingMount) {`
    // 早退近似支（0.62 游升/0.06 重力/±带）整支删除——未骑乘微光与骑乘同走湿支
    // shimmer 档（原版 :24581-24593 参数表无骑乘分叉）。
    expect(playerSrc).not.toContain('if (this.inShimmer && !this.shimmering && !this.ridingMount) {');
    expect(playerSrc).toContain('|| (this.inShimmer && !this.shimmering)) {');
    expect(playerSrc).toContain('lGrav = 0.15; lMaxFall = 10.01;');
  });

  it('I3 G4-①：骑乘态不覆写（坐骑档终值）+ 叠加族液体基单源 + jumpBaseSnapshot 液体基参数', () => {
    expect(playerSrc).toContain(
      'else if (mnt2.movementStatsAdditive) ({ spd: lJSpd, ticks: lJT } = this.jumpBaseSnapshot(this.vx, 6.01, 30));');
    expect(playerSrc).toContain(
      'private jumpBaseSnapshot(vx: number, baseSpd = PLAYER_JUMP_SPEED, baseTicks = PLAYER_JUMP_TICKS)');
  });

  it('I4 G4-⑤a：湿重力 ×num6 统一源 + 滑翔 lGrav/3 + mountGFieldW 并源', () => {
    expect(playerSrc).toContain('lGrav *= num6W;');
    expect(playerSrc).toContain('lGrav = lGrav / 3;');
    expect(playerSrc).toContain('const mountGFieldW = lGrav;');
  });

  it('I5 R4-P2①②：毯复位公共位 + carpetFlying 双写位 + 渲染门改读', () => {
    expect(playerSrc).toContain('if (!eqM.carpet) this.canCarpet = false;');
    expect(playerSrc).toContain(
      'else if (this.vy === 0 || this.wallCling) { this.canCarpet = true; this.carpetTime = 0; }');
    expect(playerSrc).toContain('this.carpetFlying = false;');
    expect((playerSrc.match(/this\.carpetFlying = true;/g) ?? []).length).toBe(2);
    expect(rendererSrc).toContain('if (p.carpetFlying) legs = 0;');
    // ★BJ704-G19 迁移：沙暴臂改读 sandStormVisual（jump 窗口∧上升——原版 :36838-36840
    //   读 sandStorm 字段;旧 performingJump 键控含下落段,G19 窗口勘正）
    expect(rendererSrc).toContain('p.sandStormVisual || p.carpetFlying) body = 6');
  });

  it('I6 Mounts.ts：hover 重力参/疲劳率/非飞行臂/冲量/分派双门/49 强切/54 回充门', () => {
    expect(mountsSrc).toContain('hover(p: MountedPlayerView, gravityField = DEFAULT_GRAVITY)');
    expect(mountsSrc).toContain('this.fatigue += fatigueRate;');
    expect(mountsSrc).toContain('p.vy += gravityField * p.gravDir;');
    expect(mountsSrc).toContain('p.gravityFieldFresh ?? p.gravityField ?? DEFAULT_GRAVITY) + 0.001');
    expect(mountsSrc).toContain('this.flyTime > 0 && (p.jumpHold ?? 0) === 0 && p.inputJump && !this.canHover(p)');
    expect(mountsSrc).toContain('} else if (p.wet ?? p.inWater) {');
    expect(mountsSrc).toContain('if (this.type !== 54 || !p.inputJump) this.resetFlightTime(p);');
    expect(mountsSrc).toMatch(/if \(state !== FRAME_SWIMMING && \(p\.wet \?\? p\.inWater\)\) \{\s*\n\s*state = FRAME_SWIMMING;\s*\n\s*this\.frameState = FRAME_SWIMMING;/);
  });

  it('I7 Player 视图三 getter（wet/slowFall/gravityField——MountedPlayerView 承载源）', () => {
    expect(playerSrc).toContain('get wet(): boolean {');
    expect(playerSrc).toContain('get slowFall(): boolean { return this.buffs.slowFall || this.equipStats.slowFall; }');
    expect(playerSrc).toContain('get gravityField(): number { return this.gField; }');
  });
});
