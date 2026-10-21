// ★BJ703-D 坐骑域登记债清算判别锁：
//  D1 = mount 54 迅猛龙选择性飞行族（SelectiveFlyingMountData.allowedToFly——
//    Mount.cs:70-82/:2995-3009/:2871/:5328-5331 + 帧态 UpdateFrame_Velociraptor
//    :4549-4564 + 扇翼加速 :4361-4364）。
//    定谳要点（1457 反编译，逐句对勘见 memory/bj703d-mount-debts.md）：
//    · SelectiveFlyingMountData 全表仅 type 54 绑定（SetMount :6360-6363）;
//      showFlyingFrames(:72) 全树零消费=死字段不建模;
//    · allowedToFly 每 tick 在 UpdateEquips 尾（:13198）以【清翼前】wingsLogic 置位
//      ——骑乘清零（:26834,!CanUseWings 族）在其【后】,故 54+功能翼=闩真;
//    · CanFly :2871 在 flightTimeMax==0 拒绝前先放行 54+闩;
//    · ResetFlightTime 54 → _flyTime = wingTimeMax（无翼 0=永不飞）;
//    · 翱翔徽章 4989（empressBrooch）∧闩 → flyTime 每拍回满 wingTimeMax（无限飞）;
//    · Flight 爬升支 :27188-27193 wingStats 覆写在 vanilla 是死码（读 :26834 已清零
//      的 wingsLogic,骑 54 恒 0）——不移植（同 BJ701 的 56/61 /1.5 死码判谳）;
//    · 帧态第二析取项 ShouldDrawWingsThatAreAlwaysAnimated(ignoreMounts:true)
//      骑乘域消解为「无钩爪」单条件（vy≠0=分派门恒真;ShouldFloatInWater 骑乘≠37
//      恒假;wings/wingsLogic 清零恒 0）。
//  D2 = 坐骑飞行耗尽臂重力接当拍重力场（:27210 `gravity/3`——gravity=Player 字段
//    含太空带 ×num6 :24884;旧常量 0.4 在太空带 4× 偏快）。湿态液体档在仓内经湿支
//    先行让位=本支不可达（湿支无坐骑 vy 链,结构债 BJ703-D2b 登记,本文件不测）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import {
  MountInstance, FRAME_FLYING, FRAME_IN_AIR, FRAME_SWIMMING,
  type MountedPlayerView,
} from '../src/entities/Mounts';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

/** 真实 Player 最小钩桩（bj701 同款） */
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

/** 带地面平台的干地世界;groundLevel 显式设（World 构造缺省 0——num6 走 ±Inf 上钳 1
 *  支,非真实公式面,wing-flight.test 同款补全） */
function makeBandWorld(seed: string, groundTile: number) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 100;                       // num6=1 于 yT≥64.2;0.25 下钳于 yT<60
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, groundTile, 1, 0, 0);
  for (let y = groundTile - 1; y >= groundTile - 40; y--) {
    for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, y, 0);
  }
  return w;
}

type P = import('../src/entities/Player').Player;

async function makePlayer(groundTile: number, wings: boolean, insignia = false): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const { ITEM_BY_KEY } = await import('../src/data/items');
  const p = new Player(21 * 16, groundTile * 16 - 42, new Inventory());
  if (wings) p.inv.armor[3] = { id: ITEM_BY_KEY['vi_493_天使之翼'], stack: 1 };
  if (insignia) p.inv.armor[4] = { id: ITEM_BY_KEY['vi_4989_soaring_insignia'], stack: 1 };
  return p;
}

function rideRaptor(p: P) {
  p.mount.active = true;
  p.mount.type = 54;
}

const TILE = 16;

// ---------------------------------------------------------------------------
// D1 行为面：真实 fixedUpdate 全链（物品面之外的物理/帧态/能量）
// ---------------------------------------------------------------------------
describe('BJ703-D1 迅猛龙选择性飞行（:2995-3009/:2871/:5328-5331）', () => {
  it('无翼：闩假 → 永不飞（flyTime 恒 0、跳跃弧高 <12 格、空中帧态=2）', async () => {
    const w = makeBandWorld('bj703d-noWing', 170);
    const game = makeHooks(w);
    const p = await makePlayer(170, false);
    rideRaptor(p);
    p.inputJump = false;
    for (let i = 0; i < 30; i++) p.fixedUpdate(1 / 60, game);       // 贴地稳定（闩面采样）
    expect(p.mount.allowedToFly).toBe(false);                        // 无翼闩假
    expect(p.mount.flyTime).toBe(0);                                 // wingTimeMax=0 回充 0
    expect(p.equipStats.wing).toBeNull();
    const y0 = p.y;
    p.inputJump = true;
    let minY = y0;
    for (let i = 0; i < 80; i++) {
      p.fixedUpdate(1 / 60, game);
      minY = Math.min(minY, p.y);
    }
    const rise = (y0 - minY) / TILE;
    expect(rise).toBeLessThan(12);                                   // 纯跳跃弧（飞行≈30+ 格）
    expect(p.mount.flyTime).toBe(0);                                 // 全程零燃料
    expect(p.mount.frameState === 3).toBe(false);                    // 永不进扇翼帧态
  }, 30000);

  it('有翼：闩真 → 起跳段后 Flight 接管,爬升钳 -jumpSpeed(6.01)×1.5=-9.015,燃料=wingTimeMax(100)', async () => {
    const w = makeBandWorld('bj703d-wing', 170);
    const game = makeHooks(w);
    const p = await makePlayer(170, true);
    rideRaptor(p);
    p.inputJump = false;
    for (let i = 0; i < 30; i++) p.fixedUpdate(1 / 60, game);
    expect(p.mount.allowedToFly).toBe(true);                         // 清翼前 wingsLogic=2 置闩
    expect(p.mount.flyTime).toBe(100);                               // 地面回充=天使翼 FlyTime
    p.inputJump = true;
    let sawFlying = false, sawFrameInFly = false;
    for (let i = 0; i < 60; i++) {                                   // 15 拍 jumpHold + 45 拍爬升
      p.fixedUpdate(1 / 60, game);
      if (p.mount.frameState === 3) {
        sawFlying = true;
        if (p.mount.frame >= 16 && p.mount.frame <= 20) sawFrameInFly = true;
      }
    }
    expect(p.vy).toBeLessThanOrEqual(-8.99);                         // 爬升帽 -9.015（vanilla num45=jumpSpeed=6.01）
    expect(p.vy).toBeGreaterThanOrEqual(-9.05);
    expect(p.mount.flyTime).toBeLessThan(100);                       // 消耗中（60-15=45 拍）
    expect(p.mount.flyTime).toBeGreaterThan(40);
    expect(sawFlying).toBe(true);                                    // 扇翼帧态（16-20 行）
    expect(sawFrameInFly).toBe(true);
  }, 30000);

  it('翱翔徽章：闩真 ∧ empressBrooch → flyTime 每拍回满（无限飞,150 拍仍在帽上）', async () => {
    const w = makeBandWorld('bj703d-insignia', 170);
    const game = makeHooks(w);
    const p = await makePlayer(170, true, true);
    rideRaptor(p);
    p.inputJump = false;
    for (let i = 0; i < 30; i++) p.fixedUpdate(1 / 60, game);
    expect(p.equipStats.empressBrooch).toBe(true);
    p.inputJump = true;
    for (let i = 0; i < 60; i++) p.fixedUpdate(1 / 60, game);        // 进入爬升段
    p.mount.flyTime = 0;                                             // 手动归零（探徽章回满）
    p.fixedUpdate(1 / 60, game);
    expect(p.mount.flyTime).toBe(99);                                // 回满 100 后本拍 Flight()-1
    for (let i = 0; i < 150; i++) p.fixedUpdate(1 / 60, game);       // 无徽章 100 拍燃料必尽
    expect(p.mount.flyTime).toBe(99);                                // 持续回满（无限飞）
    expect(p.vy).toBeLessThanOrEqual(-8.99);                         // 仍在爬升帽（耗尽支会坠）
  }, 30000);
});

// ---------------------------------------------------------------------------
// D2 行为面：耗尽臂重力场（同世界同装备,地表带 vs 太空带 4:1 判别）
// ---------------------------------------------------------------------------
describe('BJ703-D2 坐骑飞行耗尽臂重力接当拍重力场（:27210 gravity/3）', () => {
  /** 太空带平台 y=55（num6 下钳 0.25 → 场 0.1）;地表带 y=170（num6 上钳 1 → 场 0.4） */
  async function measureExhaustion(groundTile: number, seed: string, holdDown: boolean) {
    const w = makeBandWorld(seed, groundTile);
    const game = makeHooks(w);
    const p = await makePlayer(groundTile, true);
    rideRaptor(p);
    p.inputJump = false;
    for (let i = 0; i < 30; i++) p.fixedUpdate(1 / 60, game);
    p.inputJump = true;
    for (let i = 0; i < 35; i++) p.fixedUpdate(1 / 60, game);        // 起跳段 + 爬升段（脱离 jumpHold,拉开离地余量）
    p.mount.flyTime = 0;                                             // 手动耗尽
    // ★vy 设非零正值:0 会踩 upkeep 的 `onGround||vy===0` 回充门（vy===0 臂 BJ701
    //   已登记的触发位点差近似）→ flyTime 回满 → Flight 钉位支劫持（1e-5 悬停）。
    p.vy = 1;
    p.inputDown = holdDown;                                          // 按↓=悬停向门不钳=纯累积
    for (let i = 0; i < 40; i++) p.fixedUpdate(1 / 60, game);
    p.inputDown = false; p.inputJump = false;
    return p.vy;
  }

  it('地表带（num6=1）：40 拍 vy≈1+0.4/3×40≈6.3;太空带（num6=0.25）：≈1+1.33=2.3（常量版判别红）', async () => {
    const vySurface = await measureExhaustion(170, 'bj703d-surf', true);
    expect(vySurface).toBeGreaterThan(5.5);                          // 1+0.1333×40≈6.33
    expect(vySurface).toBeLessThan(7.2);
    const vySpace = await measureExhaustion(55, 'bj703d-space', true);
    expect(vySpace).toBeGreaterThan(1.5);                            // 1+0.0333×40≈2.33
    expect(vySpace).toBeLessThan(3.2);
    expect((vySpace - 1) / (vySurface - 1)).toBeLessThan(0.6);       // 深度缩放比（≈0.25）
  }, 30000);

  it('松↓：终端钳 maxFallSpeed/3=3.3367（悬停向门两半臂,BJ701 同款）', async () => {
    const vyClamped = await measureExhaustion(170, 'bj703d-cap', false);
    expect(vyClamped).toBeGreaterThan(3.0);
    expect(vyClamped).toBeLessThanOrEqual(10.01 / 3 + 1e-6);
  }, 30000);
});

// ---------------------------------------------------------------------------
// 单元直测：MountInstance 闩/燃料/帧态（合成视图,BJ701 rideMount 口径的正面版）
// ---------------------------------------------------------------------------
describe('BJ703-D1 单元直测（updateAfterEquips/canFly/resetFlightTime/帧态）', () => {
  function makeView(over: Partial<MountedPlayerView> = {}): MountedPlayerView {
    return {
      x: 0, y: 0, w: 20, h: 42, vx: 0, vy: -1, onGround: false, inWater: false,
      facing: 1, inputX: 0, inputJump: true, inputUp: false, inputDown: false,
      prevInputJump: true, gravDir: 1, store: null,
      ...over,
    };
  }

  it('updateAfterEquips（:2995-3009）：闩=wingsLogic>0;徽章∧闩→回满;非 54 无操作', () => {
    const m = new MountInstance();
    m.setMount(54, makeView());
    expect(m.allowedToFly).toBe(false);                              // 上骑即假（SetMount 新 data）
    m.updateAfterEquips(0, 100, true);
    expect(m.allowedToFly).toBe(false);                              // 无翼不闩（徽章无效）
    expect(m.flyTime).toBe(0);                                       // 徽章不写燃料（闩假）
    m.updateAfterEquips(2, 100, false);
    expect(m.allowedToFly).toBe(true);
    expect(m.flyTime).toBe(0);                                       // 无徽章不回满
    m.flyTime = 7;
    m.updateAfterEquips(2, 100, true);
    expect(m.flyTime).toBe(100);                                     // 徽章回满 wingTimeMax
    const m50 = new MountInstance();
    m50.setMount(50, makeView());
    m50.flyTime = 3;
    m50.updateAfterEquips(2, 100, true);                             // 非 54 整臂无操作
    expect(m50.flyTime).toBe(3);
    expect(m50.allowedToFly).toBe(false);
  });

  it('canFly（:2865-2881）：54+闩真放行（flightTimeMax=0 之前）;闩假沿 0 恒假;50 走 80', () => {
    const m = new MountInstance();
    m.setMount(54, makeView());
    expect(m.canFly(makeView())).toBe(false);                        // 闩假 + flightTimeMax=0
    m.updateAfterEquips(2, 100, false);
    expect(m.canFly(makeView())).toBe(true);                         // 闩真放行
    const m50 = new MountInstance();
    m50.setMount(50, makeView());
    expect(m.canFly(makeView())).toBe(true);                         // 常规 80 面
    m.dismount(makeView());
    expect(m.allowedToFly).toBe(false);                              // reset 清闩
  });

  it('resetFlightTime（:5320-5331）：54 → wingTimeMax;50 → flightTimeMax 80;驯鹿 0 面', () => {
    const m = new MountInstance();
    m.setMount(54, makeView());
    m.resetFlightTime(makeView({ wingTimeMax: 180 }));
    expect(m.flyTime).toBe(180);                                     // 54 读玩家 wingTimeMax
    m.resetFlightTime(makeView());                                   // 缺省无翼 0
    expect(m.flyTime).toBe(0);
    const m50 = new MountInstance();
    m50.setMount(50, makeView());
    m50.resetFlightTime(makeView({ wingTimeMax: 180 }));
    expect(m50.flyTime).toBe(80);                                    // 非 54 不吃 wingTimeMax
  });

  it('帧态（UpdateFrame_Velociraptor :4549-4564）：闩真+空中→扇翼帧 16-20;闩假/钩爪→空中帧 5-6;游泳态重写', () => {
    // ★frameState 记的是【分派态】（UpdateFrame 头 :3614-3617 先于 case 54 的 ref state
    //   改写赋值——vanilla 同构）,Velociraptor 臂的升降改写只作用帧推进行 → 判别量=frame。
    const inFlyRows = (m: MountInstance) => m.frame >= 16 && m.frame <= 20;
    const inAirRows = (m: MountInstance) => m.frame >= 5 && m.frame <= 6;
    const m = new MountInstance();
    m.setMount(54, makeView());
    m.flyTime = 10;                                                  // 分派门 FlyTime>0 假面手动置
    m.allowedToFly = true;
    m.updateFrameDispatch(makeView());                               // 空中+按跳+非 hover → 分派 state 3
    expect(m.frameState).toBe(FRAME_FLYING);
    expect(inFlyRows(m)).toBe(true);                                 // 闩真保持 3 → 扇翼行
    m.allowedToFly = false;
    m.updateFrameDispatch(makeView());                               // 闩假 → 3 降级 2（帧行随迁）
    expect(m.frameState).toBe(FRAME_FLYING);                         // 分派态不变（:3614 先赋值）
    expect(inAirRows(m)).toBe(true);                                 // 空中行 5-6
    m.allowedToFly = true;
    m.updateFrameDispatch(makeView({ grapplingHooked: true }));      // 钩爪挂中 → 降级 2
    expect(inAirRows(m)).toBe(true);
    m.updateFrameDispatch(makeView({ inWater: true, inputJump: false, vy: 0.5 }));
    // inputJump=false → 走 inWater 支 state 4 → 闩真重写为 3
    expect(m.frameState).toBe(FRAME_SWIMMING);
    expect(inFlyRows(m)).toBe(true);
    m.allowedToFly = false;
    m.updateFrameDispatch(makeView({ inWater: true, inputJump: false, vy: 0.5 }));
    expect(m.frameState).toBe(FRAME_SWIMMING);                       // 分派态 4 不变
    expect(inAirRows(m)).toBe(true);                                 // 闩假 → 4 重写为 2
  });

  it('扇翼加速（:4361-4364）：54 燃料期帧延迟 6-2=4（第 5 拍进帧）;耗尽回 6（第 7 拍）', () => {
    const m = new MountInstance();
    m.setMount(54, makeView());
    m.allowedToFly = true;
    m.flyTime = 10;
    m.frame = 16; (m as unknown as { frameCounter: number }).frameCounter = 0;
    for (let i = 0; i < 4; i++) m.updateFrame(makeView({ inputJump: true }), FRAME_FLYING, 0, -1);
    expect(m.frame).toBe(16);                                        // counter 4 未过 4（> 严格比较）
    m.updateFrame(makeView({ inputJump: true }), FRAME_FLYING, 0, -1);
    expect(m.frame).toBe(17);                                        // 第 5 拍 counter 5>4 → 进帧
    const m2 = new MountInstance();
    m2.setMount(54, makeView());
    m2.allowedToFly = true;
    m2.flyTime = 0;                                                  // 耗尽态 → 延迟 6 原值
    m2.frame = 16; (m2 as unknown as { frameCounter: number }).frameCounter = 0;
    for (let i = 0; i < 6; i++) m2.updateFrame(makeView({ inputJump: true }), FRAME_FLYING, 0, -1);
    expect(m2.frame).toBe(16);                                       // 6 拍未过 6
    m2.updateFrame(makeView({ inputJump: true }), FRAME_FLYING, 0, -1);
    expect(m2.frame).toBe(17);                                       // 第 7 拍进帧
  });
});

// ---------------------------------------------------------------------------
// 结构锁（源文本锚）：防静默回退/重写
// ---------------------------------------------------------------------------
describe('BJ703-D 结构锁（源文本锚）', () => {
  const pSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
  const mSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');

  it('Mounts.ts：canFly 54 门 / resetFlightTime 54 覆写 / updateAfterEquips 三要素', () => {
    expect(mSrc).toContain('if (this.type === 54 && this.allowedToFly) return true;');
    expect(mSrc).toContain('if (this.type === 54) this.flyTime = p.wingTimeMax ?? 0;');
    const i = mSrc.indexOf('BJ703-D1 Mount.UpdateAfterEquips');
    expect(i).toBeGreaterThan(-1);
    const seg = mSrc.slice(i, i + 900);
    expect(seg).toContain('this.allowedToFly = wingsLogic > 0;');
    expect(seg).toContain('if (this.allowedToFly && empressBrooch) this.flyTime = wingTimeMax;');
    expect(seg).toContain('if (!this.active || this.type !== 54) return;');
  });

  it('Mounts.ts：帧态 case 54（Velociraptor 三臂 + 钩爪门）与扇翼加速', () => {
    const i = mSrc.indexOf('UpdateFrame_Velociraptor（Mount.cs:4549-4564');
    expect(i).toBeGreaterThan(-1);
    const seg = mSrc.slice(i, i + 1400);
    expect(seg).toContain('if (state === FRAME_SWIMMING) state = this.allowedToFly ? FRAME_FLYING : FRAME_IN_AIR;');
    expect(seg).toContain('&& !p.grapplingHooked) {');
    expect(seg).toContain('} else if (state === FRAME_FLYING) {');
    expect(seg).toContain('state = FRAME_IN_AIR;');
    expect(mSrc).toContain('if (this.type === 54 && this.flyTime > 0) flyDelay -= 2;');
    expect(mSrc).toContain('this.allowedToFly = false;');             // reset 清闩
  });

  it('Player.ts：闩接线（清翼前 wingsLogic）+ 耗尽臂重力场', () => {
    const i = pSrc.indexOf('BJ703-D1 Mount.UpdateAfterEquips 54 臂');
    expect(i).toBeGreaterThan(-1);
    const seg = pSrc.slice(i, i + 700);
    expect(seg).toContain('this.mount.updateAfterEquips(');
    expect(seg).toContain('eqAE.wing ? eqAE.wing.logic : 0');         // 清翼前值（勿传清零后局部量）
    expect(seg).toContain('eqAE.empressBrooch');
    expect(pSrc).toContain('this.vy += mountGField / 3 * gd;');       // 耗尽臂=当拍重力场
    const j = pSrc.indexOf('BJ703-D2 坐骑飞行域【当拍重力场】');
    // ★BJ704-G12（G5 债5）：G12 注释块（num6 提至 if(mnt2) 外=毯带并源）插入后窗口加宽
    const seg2 = pSrc.slice(j, j + 1900);
    expect(seg2).toContain('mountGField = GRAVITY * num6D2;');
    expect(pSrc).toContain('get wingTimeMax(): number');
    expect(pSrc).toContain('get grapplingHooked(): boolean');
  });
});
