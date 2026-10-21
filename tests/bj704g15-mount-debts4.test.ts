// ★BJ704-G15（2026-10-21）坐骑域五件清算第四刀（G13 新登记债①③④⑤⑦,判别锁+结构锁）。
//  锚全在 1457 反编译亲读：
//  · 债① 墙跳 vx 反踢 :20950-20953 `velocity.X = 3f*-slideDir`（JumpMovement 首分支尾笔,
//    sliding 支——干湿两支同缺,G13 F1 负锁在案）。修=Player.slideDir 字段跨段承载
//    （wallCling 三置位点同拍配对写:老鼠爬墙/钉鞋驻停/钉鞋缓降）+干湿两跳跃体读位。
//  · 债③ 湿跳门 autoJump 臂 :20845 内门 `(autoJump && (vy==0||sliding))`——干支既有,
//    湿门旧缺=蛙蹼族/constantJump 坐骑湿态踩底免松键连跳不可达。修=湿门补臂
//    （!wallCling 抑制≙:20805-20808 controlJump 头压 autoJump=false;内门 vy==0）。
//  · 债④ tryStartHover 边沿键位分叉——原版 controlUp=W 独立键面（PlayerInput.cs:2072/
//    2076 默认绑定 Up=W/Jump=Space 分立 + TriggersSet.CopyInto :786/:790）,releaseUp
//    由 UpdateControlHolds :29319-29327 移动段后刷新,:26939 读上拍尾值=↑ 键上升沿。
//    旧读 `!jumpEdgePrev`（Space∪Up 合成跳键上拍电平）:持 Space 中按 W 不触发
//    （vanilla 触发）。修=upEdgePrev 通道（Player 字段+tick 尾快照+view 分立字段）。
//  · 债⑤ updateFrame 55/56/61 帧态强切臂（Mount.cs:3669-3708）：61 分派 4→2、
//    55 sliding→1/分派 4→2/分派 1∧|vx|>4→5、56 dash 沿→5/分派非 0/1→2——写 frameState
//    字段（非 case 7/48 纯组覆写）;56/61 悬停门域内迁移零行为差（纯帧态归一,
//    tryBeginningFlight/tryLanding 判据消费面）,55 为动画组面。
//  · 债⑦ CCed 臂尾视觉复位两笔 :27011-27012（sandStorm=false + CancelAllJumpVisualEffects
//    ——位序=DoubleJumpVisuals :26968 后/物理链前）。仓内承载=performingJump 清 +
//    isDownDashing 清（includeDownDash 缺省 true）;sandStorm 位仓内无独立承载
//    （run 加速 :26773/转向门 :19965 未建模,视觉面经 performingJump 键控）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { MountInstance, FRAME_STANDING, FRAME_RUNNING, FRAME_IN_AIR,
  FRAME_FLYING, FRAME_SWIMMING, FRAME_DASHING, type MountedPlayerView } from '../src/entities/Mounts';
import { BuffType } from '../src/stats/Buffs';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

const playerSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
const mountsSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

/** 真实 Player 最小钩桩（bj704g13 同款） */
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

/** 干地+立柱世界（num6=1 带:地面 row150,墙 col40 rows100-149——flag 双格探针域） */
function makeWallWorld(seed: string) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, 150, 1, 0, 0);
    w.store.setTileSilent(x, 151, 1, 0, 0);
  }
  for (let y = 100; y <= 149; y++) w.store.setTileSilent(40, y, 1, 0, 0);
  return w;
}

/** 水池+立柱世界（墙 col40 rows100-149 穿水面;水 rows110-149 cols14-46,池底 row150）。
 *  ★高 220（wetCollision 扫描界 st.h−40:180 高世界界=140 行,池底 140-149 行探不到湿
 *   →沉底段误判干态吃水面钉位;220 高界=180 全池在域）+封闭盆（全宽底板+col13/47
 *   侧壁——开边水池 ~200 拍侧漏见底,长夹具必备） */
function makeWallPoolWorld(seed: string) {
  const w = new World(60, 220, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, 150, 1, 0, 0);
    w.store.setTileSilent(x, 151, 1, 0, 0);
  }
  for (let y = 105; y <= 151; y++) {
    w.store.setTileSilent(13, y, 1, 0, 0);
    w.store.setTileSilent(47, y, 1, 0, 0);
  }
  for (let x = 14; x <= 46; x++) {
    for (let y = 110; y <= 149; y++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
  }
  for (let y = 100; y <= 149; y++) w.store.setTileSilent(40, y, 1, 0, 0);
  return w;
}

/** 液池世界（bj704g13 同款口径;bottom=137 池底贴齐 134.375） */
function makePoolWorld(seed: string, top = 90, bottom = 137) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
  }
  return w;
}

/** 干地世界 */
function makeGroundWorld(seed: string, ground = 100) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground, 1, 0, 0);
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  return w;
}

async function makePlayer(xPx: number, yPx: number, shoesVid?: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const inv = new Inventory();
  if (shoesVid !== undefined) inv.armor[3] = { id: iid(shoesVid), stack: 1 };
  return new Player(xPx, yPx, inv);
}

/** MountInstance 单测合成视图（bj704g13 makeView 同式） */
function makeView(over: Partial<MountedPlayerView> = {}): MountedPlayerView {
  return {
    x: 0, y: 0, w: 20, h: 42, vx: 0, vy: -1, onGround: false, inWater: false,
    facing: 1, inputX: 0, inputJump: true, inputUp: false, inputDown: false,
    prevInputJump: true, gravDir: 1, store: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. 债① 墙跳 vx 反踢（:20950-20953,干湿两支）
// ---------------------------------------------------------------------------
describe('BJ704-G15 A 墙跳 vx 反踢 3*-slideDir（:20950-20953）', () => {
  it('A1 干支:贴墙滑（钉鞋 976 tier2 驻停）按跳——反踢 vx=-3 离壁（旧无反踢=贴墙上爬）', async () => {
    const w = makeWallWorld('bj704g15-a1');
    const game = makeHooks(w);
    const p = await makePlayer(40 * 16 - 20, 120 * 16, 976);   // 钉鞋 2（无 dash 面）
    p.inputX = 1;                                              // 按向墙（=撞向）
    let clung = false;
    for (let t = 0; t < 30; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.wallCling) { clung = true; break; }
    }
    expect(clung).toBe(true);                                  // tier2 驻停挂壁
    expect(p.slideDir).toBe(1);                                // 挂壁向配对写
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);   // 驻停稳定（vy=-g+ε）
    p.inputJump = true; p.jumpEdgePrev = false;                // 跳键沿（挂壁中未按过）
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(-3);                             // 蹬墙跳 vy=-jumpSpeed
    expect(p.vx).toBe(-3);                                     // ★反踢 3*-slideDir（旧=0 贴壁直上）
    expect(p.wallCling).toBe(false);                           // 起跳拍离壁（vy<0 → 头门出）
  }, 30000);

  it('A2 湿支:干支挂壁滑入水（wallCling 跨湿拍滞留承载）——湿跳门 wallCling 腿+反踢', async () => {
    const w = makeWallPoolWorld('bj704g15-a2');
    const game = makeHooks(w);
    const p = await makePlayer(40 * 16 - 20, 100 * 16, 976);
    p.inputX = 1; p.inputDown = true;                          // tier2 快滑 4/t 下水
    let wet = false;
    for (let t = 0; t < 90; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.inWater) { wet = true; break; }
    }
    expect(wet).toBe(true);
    expect(p.wallCling).toBe(true);                            // 湿支无清零段=跨湿拍滞留（G13 判例）
    p.inputDown = false;                                       // 收 ↓（快滑停,湿重力缓沉）
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);
    expect(p.wallCling).toBe(true);                            // 滞留位保持
    p.inputJump = true; p.jumpEdgePrev = false;                // 水中按跳（沿）
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(-3);                             // 湿跳门 wallCling 腿（G13 债3）
    expect(p.vx).toBe(-3);                                     // ★湿支反踢同款（旧=0）
  }, 30000);

  it('A3 对照:平地起跳无反踢（wallCling 假 → vx 不被写）', async () => {
    const w = makeGroundWorld('bj704g15-a3');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 90 * 16, 976);
    for (let t = 0; t < 60; t++) p.fixedUpdate(1 / 60, game);  // 落地
    expect(p.onGround).toBe(true);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(-3);
    expect(p.vx).toBe(0);                                      // 无挂壁=无反踢
  }, 30000);

  it('A4 结构锁:slideDir 字段+三置位点配对写+干湿两读位', () => {
    expect(playerSrc).toContain('slideDir = 0;');
    expect(playerSrc.match(/this\.slideDir = /g)?.length).toBe(3);      // 老鼠/驻停/缓降
    expect(playerSrc.match(/this\.vx = 3 \* -this\.slideDir/g)?.length).toBe(2);  // 干+湿
  });
});

// ---------------------------------------------------------------------------
// B. 债③ 湿跳门 autoJump 臂（:20845 内门第二支）
// ---------------------------------------------------------------------------
describe('BJ704-G15 B 湿跳门 autoJump 臂（:20845 (autoJump&&(vy==0||sliding))）', () => {
  it('B1 弹跳杆 43（constantJump）池底持跳:免松键连跳环（落地拍 autoJump 再起;旧持跳只跳一次）', async () => {
    const w = makePoolWorld('bj704g15-b1');
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 134.375 * 16);         // 池底贴齐
    p.mount.setMount(43, p);                                    // 弹跳杆（constantJump）
    p.inputJump = false;
    for (let t = 0; t < 6; t++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBe(0);                                       // 池底稳定
    // 持跳全程不松:计 jumpHold 再臂事件（0→正 = 新一次起跳）
    p.inputJump = true;
    let events = 0, prevHold = 0;
    for (let t = 0; t < 260; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.jumpHold > prevHold && prevHold === 0) events++;
      prevHold = p.jumpHold;
      if (events >= 3) break;
    }
    expect(events).toBeGreaterThanOrEqual(3);                   // 首跳（沿）+ ≥2 次落地 autoJump 再起
  }, 30000);

  it('B2 抑制:湿态 wallCling 滞留 + 配饰 autoJump（3996）持跳——不跳（:20805-20808 压 autoJump）', async () => {
    const w = makeWallPoolWorld('bj704g15-b2');
    const game = makeHooks(w);
    const p = await makePlayer(40 * 16 - 20, 100 * 16, 3996);  // autoJump+spikedBoots2（无蹼无 dash）
    p.vy = 3;                                                   // 下落中开按（首拍沿死于外门:vy≠0 无落地臂——:20845 outer 只认 vy==0/sliding/蹼/史莱姆）
    p.inputJump = true;                                         // 全程持跳（此后无沿）
    p.inputX = 1; p.inputDown = true;                           // 挂壁快滑入水
    let wet = false;
    for (let t = 0; t < 90; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.inWater) { wet = true; break; }
    }
    expect(wet).toBe(true);
    expect(p.wallCling).toBe(true);
    p.inputDown = false;
    // 沉底稳定（vy===0 拍持续;水中位移 ×liqFactor 0.5 → 5.01 终端沉 ~2.5px/t,深池 ~270 拍）
    // ——autoJump 须被 !wallCling 抑制（撤抑制=落地即再跳）
    let settled = false;
    for (let t = 0; t < 420; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.vy === 0 && p.onGround) { settled = true; break; }
    }
    expect(settled).toBe(true);
    let minVy = 0;
    for (let t = 0; t < 10; t++) { p.fixedUpdate(1 / 60, game); minVy = Math.min(minVy, p.vy); }
    expect(minVy).toBeGreaterThanOrEqual(-0.5);                 // 持跳零起跳（旧撤抑制=落地连跳环）
    expect(p.wallCling).toBe(true);                             // 滞留位全程保持
  }, 30000);

  it('B3 内门 vy==0:蹼+弹跳杆水中悬空（flipperJump 外门放行）持跳不重置冲量', async () => {
    const w = makePoolWorld('bj704g15-b3');
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 130 * 16, 394);        // 蹼（accFlipper,非 canFloat）
    p.mount.setMount(43, p);                                    // constantJump 源
    p.inputJump = false;
    for (let t = 0; t < 6; t++) p.fixedUpdate(1 / 60, game);   // 中池下沉
    p.inputJump = true; p.jumpEdgePrev = false;                 // 蹼泳跳（flag2 外门）
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(-3);
    expect(p.jumpHold).toBeGreaterThan(0);
    // 持跳悬空 60 拍:sustain 期后 jumpHold 归 0 且不再重置（撤内门 vy==0=每拍重置 30）
    for (let t = 0; t < 60; t++) p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBe(0);                                 // ★autoJump 臂 vy!=0 不放行（旧撤门=恒 30）
  }, 30000);

  it('B4 结构锁:湿门 autoJump 臂+sliding 抑制+内门 vy==0', () => {
    expect(playerSrc).toContain('const autoJumpW = this.ridingMount ? this.mount.autoJump : eqM.autoJump;');
    expect(playerSrc).toContain('(jumpEdge || (autoJumpW && !this.wallCling && this.vy === 0))');
  });
});

// ---------------------------------------------------------------------------
// C. 债④ tryStartHover ↑ 键边沿通道（:26939 controlUp∧releaseUp）
// ---------------------------------------------------------------------------
describe('BJ704-G15 C tryStartHover ↑ 键专属沿（upEdgePrev 通道）', () => {
  it('C1 合成视图:持 Space（合成跳键上拍真）按 W——触发（vanilla controlUp 独立键面;旧读跳键沿=不触发）', () => {
    const m = new MountInstance();
    m.setMount(8, makeView());                                  // 钻头（usesHover）
    const held = makeView({ inputUp: true, vy: 0, jumpEdgePrev: true, upEdgePrev: true });
    m.tryStartHover(held);
    expect(held.vy).toBe(0);                                    // ↑ 上拍已按=非沿
    const wFresh = makeView({ inputUp: true, vy: 0, jumpEdgePrev: true, upEdgePrev: false });
    m.tryStartHover(wFresh);
    expect(wFresh.vy).toBeLessThan(0);                          // ★W 新按触发（Space 持有不妨碍）
  });

  it('C2 端到端:未骑乘持 Space 落地→召唤钻头（持跳不跳:无沿无 autoJump）→按 W 起飞', async () => {
    const w = makeGroundWorld('bj704g15-c2');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 90 * 16);
    p.inputJump = true;                                         // tick0 沿跳一次（未骑乘）,此后持跳不跳
    let landed = false;
    for (let t = 0; t < 120; t++) {
      p.fixedUpdate(1 / 60, game);
      if (t > 10 && p.onGround && p.vy === 0) { landed = true; break; }
    }
    expect(landed).toBe(true);
    expect(p.jumpEdgePrev).toBe(true);                          // Space 持有=合成跳键上拍真
    p.mount.setMount(8, p);                                     // 持跳中召唤（钻头无 constantJump=不跳）
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBe(0);                                       // 持跳零跳（无沿）;贴地 frameState=0 → 悬停 vy==0 分支不写
    p.inputUp = true;                                           // ★按 W（upEdgePrev=false）
    p.fixedUpdate(1 / 60, game);
    // 冲量 -(0.16+0.4+0.001) + 同拍悬停升力臂再 -0.16（G13 P5 同拍两笔叠加判例）
    expect(p.vy).toBeCloseTo(-((0.16 + 0.4 + 0.001) + 0.16), 5);
  }, 30000);

  it('C3 尾快照通道:inputUp 逐拍尾写 upEdgePrev（撤写位=恒 false 误沿）', async () => {
    const w = makeGroundWorld('bj704g15-c3');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 90 * 16);
    p.inputUp = true;
    p.fixedUpdate(1 / 60, game);
    expect(p.upEdgePrev).toBe(true);                            // 尾快照跟当前电平
    p.inputUp = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.upEdgePrev).toBe(false);
  }, 30000);

  it('C4 结构锁:tryStartHover 读 upEdgePrev + view 分立字段', () => {
    expect(mountsSrc).toContain('p.inputUp && !p.upEdgePrev');
    expect(mountsSrc).not.toContain('p.inputUp && !p.jumpEdgePrev');   // 旧通道禁回潮
    expect(playerSrc).toContain('this.upEdgePrev = this.inputUp;');
  });
});

// ---------------------------------------------------------------------------
// D. 债⑤ updateFrame 55/56/61 帧态强切臂（Mount.cs:3669-3708）
// ---------------------------------------------------------------------------
describe('BJ704-G15 D updateFrame 帧态强切臂（55/56/61）', () => {
  it('D1 仙灵 61:分派 4（游泳）→ frameState/state=2（帧组同段纯归一;旧 frameState 滞 4）', () => {
    const m = new MountInstance();
    m.setMount(61, makeView());
    m.updateFrame(makeView({ vy: -1 }), FRAME_SWIMMING, 0, -1);
    expect(m.frameState).toBe(FRAME_IN_AIR);                    // ★强切臂写帧态字段
    expect(m.frame).toBeGreaterThanOrEqual(0);                  // 空中组 [0,4)
    expect(m.frame).toBeLessThan(4);
    // 悬停门不受伤:2 ∈ 61 的 flyingState 集（2/3/4）——归一后照常可悬停升
    const v = makeView({ inputUp: true, vy: 0 });
    m.hover(v);
    expect(v.vy).toBeLessThan(0);
  });

  it('D2 老鼠 55:sliding→1 跑动组;分派 4→2;分派 1∧|vx|>4→5;|vx|≤4 保持 1', () => {
    const m = new MountInstance();
    m.setMount(55, makeView());
    m.updateFrame(makeView({ sliding: true }), FRAME_IN_AIR, 0, -1);
    expect(m.frameState).toBe(FRAME_RUNNING);                   // 爬墙显跑动组
    expect(m.frame).toBeGreaterThanOrEqual(4);                  // 跑动组 [4,11)
    expect(m.frame).toBeLessThan(11);
    m.updateFrame(makeView({ sliding: false, vy: -1 }), FRAME_SWIMMING, 0, -1);
    expect(m.frameState).toBe(FRAME_IN_AIR);                    // 分派 4 → 2
    expect(m.frame).toBeGreaterThanOrEqual(12);                 // 空中组 [12,15)
    m.updateFrame(makeView({ sliding: false }), FRAME_RUNNING, 5, 0);
    expect(m.frameState).toBe(FRAME_DASHING);                   // 跑动 ∧ |vx|>4 → 冲刺组
    expect(m.frame).toBeGreaterThanOrEqual(11);                 // 冲刺组 [11,16)
    m.updateFrame(makeView({ sliding: false }), FRAME_RUNNING, 3, 0);
    expect(m.frameState).toBe(FRAME_RUNNING);                   // |vx|≤4 不写（保持 1）
  });

  it('D3 蝙蝠 56:dash 沿→5 冲刺组;分派 3→2 归一;分派 0/1 不写', () => {
    const m = new MountInstance();
    m.setMount(56, makeView());
    m.updateFrame(makeView({ dash: 6, dashDelay: -1 }), FRAME_RUNNING, 4, 0);
    expect(m.frameState).toBe(FRAME_DASHING);                   // dash>0∧delay<0 → 5
    expect(m.frame).toBeGreaterThanOrEqual(9);                  // 冲刺组 [9,15)
    m.updateFrame(makeView({ dash: 0, dashDelay: 20 }), FRAME_FLYING, 0, -1);
    expect(m.frameState).toBe(FRAME_IN_AIR);                    // 分派 3 → 2（归一）
    m.updateFrame(makeView({ dash: 0, dashDelay: 20 }), FRAME_STANDING, 0, 0);
    expect(m.frameState).toBe(FRAME_STANDING);                  // 分派 0 不写
    m.updateFrame(makeView({ dash: 0, dashDelay: 20 }), FRAME_RUNNING, 0, 0);
    expect(m.frameState).toBe(FRAME_RUNNING);                   // 分派 1 不写
  });

  it('D4 悬停门域内不受伤:56 归一 2 后 canHover+hover 升（2 ∈ 56 集 2/3）', () => {
    const m = new MountInstance();
    m.setMount(56, makeView());
    m.updateFrame(makeView({ dash: 0, dashDelay: 20, vy: -1 }), FRAME_FLYING, 0, -1);
    expect(m.frameState).toBe(FRAME_IN_AIR);
    const v = makeView({ inputUp: true, vy: 0 });
    expect(m.canHover(v)).toBe(true);
    m.hover(v);
    expect(v.vy).toBeLessThan(0);
  });

  it('D5 结构锁:三 case 强切臂在盘', () => {
    expect(mountsSrc).toContain('case 61:');
    expect(mountsSrc).toContain('if (state === FRAME_SWIMMING) { this.frameState = FRAME_IN_AIR; state = FRAME_IN_AIR; }');
    expect(mountsSrc).toContain('if (p.sliding) { this.frameState = FRAME_RUNNING; state = FRAME_RUNNING; break; }');
    expect(mountsSrc).toContain('if ((p.dash ?? 0) > 0 && (p.dashDelay ?? 0) < 0) { this.frameState = FRAME_DASHING; state = FRAME_DASHING; }');
    expect(mountsSrc).toContain('else if (state !== FRAME_STANDING && state !== FRAME_RUNNING) { this.frameState = FRAME_IN_AIR; state = FRAME_IN_AIR; }');
  });
});

// ---------------------------------------------------------------------------
// E. 债⑦ CCed 臂尾视觉复位（:27011-27012,位序=尾迹后/物理链前）
// ---------------------------------------------------------------------------
describe('BJ704-G15 E CCed 视觉复位（performingJump+isDownDashing）', () => {
  it('E1 干支:冻结拍多段跳尾迹旗下靶+下砸旗清（CancelAllJumpVisualEffects :36932-36944）', async () => {
    const w = makeGroundWorld('bj704g15-e1');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 90 * 16);
    p.vy = -3; p.onGround = false;                              // 空中上升（尾迹门 rising 域）
    p.performingJump = 'Cloud';
    p.isDownDashing = true;
    p.buffs.apply(BuffType.Frozen, 60);
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe(null);                        // ★CCed 复位（旧=旗跨冻结期滞留）
    expect(p.isDownDashing).toBe(false);
  }, 30000);

  it('E1b 湿支:同款双笔（池中冻结）', async () => {
    const w = makePoolWorld('bj704g15-e1b');
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 130 * 16);
    p.vy = -3; p.onGround = false;
    p.performingJump = 'Sandstorm';
    p.isDownDashing = true;
    p.buffs.apply(BuffType.Frozen, 60);
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe(null);
    expect(p.isDownDashing).toBe(false);
  }, 30000);

  it('E2 对照:非 CCed 空中拍旗保持（上升尾迹照常）', async () => {
    const w = makeGroundWorld('bj704g15-e2');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 90 * 16);
    p.vy = -3; p.onGround = false;
    p.performingJump = 'Cloud';
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Cloud');                     // 无 CCed=不清（落地/踩底才清）
  }, 30000);

  it('E3 结构锁:干湿两支复位块在盘', () => {
    expect(playerSrc.match(/if \(this\.cced\) \{ this\.performingJump = null; this\.isDownDashing = false; \}/g)?.length).toBe(2);
  });
});
