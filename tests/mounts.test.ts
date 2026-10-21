// 坐骑系统 1:1 回归（Terarria1456 Mount.cs + MountID.cs + Player.cs 骑乘接管段）：
//   1 数据表（tools/extract-mounts.mjs ← Mount.cs Initialize）：每坐骑参数/帧组/贴图
//   2 召唤物品链（Item.cs `mountType = N`）：1914 驯鹿/2428 胡萝卜/2429 松果/
//     2430 粘鞍/2491 硬鞍/2502 花蜜 + 矿车族 2343→6
//   3 MountInstance 状态机：上下坐/能量/疲劳/帧态/特例 RunSpeed 与跳跃加成
//   4 三模物理接管（Player.fixedUpdate）：陆行参数覆写 / 飞行 hover 能量 / 游泳 ignoreWater
//   5 摔伤系数（fallDamage）与 extraFall 豁免、海龟免淹（:22953）
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import {
  MOUNT_DATA, MOUNT_NAMES, MOUNT_SETS, MOUNT_TEXTURE_OK,
  mountOfItem, mountOfBuff, MountInstance, isCartMount, mountFallbackColor,
  FRAME_STANDING, FRAME_RUNNING, FRAME_IN_AIR, FRAME_FLYING, FRAME_SWIMMING, FRAME_DASHING,
  type MountedPlayerView,
  DRILL_PICK_POWER, DRILL_PICK_TIME, DRILL_MAX_LENGTH,
  drillBlockTarget, drillWallTarget, clampToDeadZone, scutlixFindTarget,
  groundBelowProbe,
  inAPlaceWithWind, fishronWashFactor,
  canKillTileAt, canPlayerSmashWallAt, smoothSlopeAt, bodyRotationFor, mountLights,
  MountShot,
  type DrillStore, type DrillBeam, type SlopeStore,
} from '../src/entities/Mounts';
import { TILE_DEFS, TILE_BY_KEY } from '../src/data/tiles';
import { Game } from '../src/core/Game';
import { placeTrack, frameTrackArea } from '../src/world/MinecartTrack';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE } from '../src/core/constants';
import { BuffType } from '../src/stats/Buffs';
import { mountTextureAnchorY, playerMountRotation, Renderer } from '../src/render/Renderer';

// ---- 测试世界/玩家（breath.test.ts 同款 harness） ----
const fakeHooks = (w: World, p?: Player) => ({
  world: w, player: p, enemies: () => [], critters: () => [],
  spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
  cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
  spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
  playSfxFiles: () => {}, showPickupLabel: () => {},
});
const mkWorld = (): World => {
  const w = new World(80, 120, 72, 'mounts');
  for (let x = 20; x <= 60; x++) w.store.setTileSilent(x, 80, 1);
  return w;
};
const mkPlayer = (w: World): Player => new Player(30 * 16, 77 * 16, new Inventory());
const tick = (p: Player, w: World, n: number): void => {
  for (let i = 0; i < n; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};
/** MountInstance 单元测试用的玩家视图桩 */
const view = (over: Partial<MountedPlayerView> = {}): MountedPlayerView => ({
  x: 100, y: 100, w: 20, h: 42, vx: 0, vy: 0,
  onGround: true, inWater: false, facing: 1,
  inputX: 0, inputJump: false, inputUp: false, inputDown: false,
  prevInputJump: false, gravDir: 1, store: null, ...over,
});
/** 钻头光束判定用世界桩：solid 集填内部 id 1（泥土，pick 0 可挖），walls 为 "x,y"→墙 id。
 *  frames 为 "x,y"→[frameX,frameY]（树干分支/承载帧豁免判定用） */
const fakeDrillStore = (solid: Array<[number, number]> = [],
  walls: Record<string, number> = {}, w = 40, h = 40,
  frames: Record<string, [number, number]> = {},
  types: Record<string, number> = {}): DrillStore => {
  const type = new Uint16Array(w * h);
  const wall = new Uint16Array(w * h);
  const frameX = new Uint16Array(w * h);
  const frameY = new Uint16Array(w * h);
  const idx = (x: number, y: number) => y * w + x;
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  for (const [x, y] of solid) if (inBounds(x, y)) type[idx(x, y)] = 1;
  for (const [k, v] of Object.entries(types)) {
    const [x, y] = k.split(',').map(Number);
    if (inBounds(x, y)) type[idx(x, y)] = v;
  }
  for (const [k, v] of Object.entries(walls)) {
    const [x, y] = k.split(',').map(Number);
    if (inBounds(x, y)) wall[idx(x, y)] = v;
  }
  for (const [k, [fx, fy]] of Object.entries(frames)) {
    const [x, y] = k.split(',').map(Number);
    if (inBounds(x, y)) { frameX[idx(x, y)] = fx; frameY[idx(x, y)] = fy; }
  }
  return {
    w, h, type, wall, frameX, frameY, idx, inBounds,
    isActive: (x, y) => inBounds(x, y) && type[idx(x, y)] !== 0,
  };
};
/** 坡面平滑用世界桩（solid 集 = 内部 id 1 泥土；types 覆盖指定格的类型） */
const fakeSlopeStore = (solid: Array<[number, number]> = [], w = 12, h = 12,
  frames: Record<string, [number, number]> = {}, types: Record<string, number> = {}): SlopeStore => {
  const base = fakeDrillStore(solid, {}, w, h, frames, types);
  const half = new Uint8Array(w * h);
  const slope = new Uint8Array(w * h);
  const idx = (x: number, y: number) => y * w + x;
  return {
    ...base, half, slope,
    setHalfBrick: (x, y, on) => { if (base.inBounds(x, y)) half[idx(x, y)] = on ? 1 : 0; },
    setSlope: (x, y, s) => { if (base.inBounds(x, y)) { slope[idx(x, y)] = s; half[idx(x, y)] = 0; } },
  };
};
const idleBeams = (): DrillBeam[] => [{ tx: -1, ty: -1, cooldown: 0, purpose: 0 },
  { tx: -1, ty: -1, cooldown: 0, purpose: 0 }];
/** 玩家中心位于格 (10,20) 中心的世界像素坐标 */
const DRILL_CX = 10 * 16 + 8, DRILL_CY = 20 * 16 + 8;

describe('坐骑数据表（Mount.cs Initialize 提取）', () => {
  it('66 坐骑全量登记 + 名称表（64/65 = 1457 TrustyChillet 族,extract-mounts overlay）', () => {
    expect(Object.keys(MOUNT_DATA)).toHaveLength(66);
    expect(MOUNT_NAMES['0']).toBe('Rudolph');
    expect(MOUNT_NAMES['7']).toBe('UFO');
    expect(MOUNT_NAMES['63']).toBe('ChilletIgnis');
    expect(MOUNT_NAMES['64']).toBe('TrustyChillet');
    expect(MOUNT_NAMES['65']).toBe('TrustyChilletIgnis');
  });

  it('陆行族参数：驯鹿/兔兔/史莱姆/蜥蜴/独角兽', () => {
    expect(MOUNT_DATA['0']).toMatchObject({ buff: 90, flightTimeMax: 160, runSpeed: 5.5, dashSpeed: 12, acceleration: 0.09, jumpHeight: 17, jumpSpeed: 5.31 });
    expect(MOUNT_DATA['1']).toMatchObject({ buff: 128, runSpeed: 4, dashSpeed: 7.8, acceleration: 0.13, fallDamage: 0.8 });
    expect(MOUNT_DATA['3']).toMatchObject({ constantJump: true, fallDamage: 0.5, extraFall: 10, jumpSpeed: 8.25 });
    expect(MOUNT_DATA['14']).toMatchObject({ buff: 193, runSpeed: 8, jumpHeight: 20 });
    expect(MOUNT_DATA['10']).toMatchObject({ buff: 162, fallDamage: 0.2, dashSpeed: 12 });
  });

  it('飞行族参数：UFO/蜜蜂/猪鲨崽/巫婆扫帚（usesHover + 能量双池）', () => {
    expect(MOUNT_DATA['7']).toMatchObject({ usesHover: true, flightTimeMax: 320, fatigueMax: 320, runSpeed: 8, fallDamage: 0 });
    expect(MOUNT_DATA['5']).toMatchObject({ usesHover: true, flightTimeMax: 320, fatigueMax: 320, runSpeed: 2 });
    expect(MOUNT_DATA['12']).toMatchObject({ usesHover: true, swimSpeed: 16, fallDamage: 0 });
    expect(MOUNT_DATA['23']).toMatchObject({ usesHover: true, flightTimeMax: 320, runSpeed: 9 });
    // 非 hover 的飞行坐骑：驯鹿/猪龙只有 flightTimeMax
    expect(MOUNT_DATA['2']).toMatchObject({ flightTimeMax: 160 });
    expect(MOUNT_DATA['2'].usesHover).toBeUndefined();
  });

  it('游泳族参数：海龟 swimSpeed 10 / buff 131', () => {
    expect(MOUNT_DATA['4']).toMatchObject({ buff: 131, swimSpeed: 10, runSpeed: 2, heightBoost: 26 });
    expect(MOUNT_DATA['49']).toMatchObject({ buff: 305, swimSpeed: 14 });
  });

  it('MountID.Sets 能力位（Cart/CanUseHooks/IsTransformationMount）', () => {
    expect(MOUNT_SETS.Cart[6]).toBe(true);
    expect(MOUNT_SETS.Cart[53]).toBe(true);
    expect(MOUNT_SETS.Cart[0]).toBe(false);
    expect(MOUNT_SETS.CanUseHooks).toEqual(expect.arrayContaining([true]));
    expect(MOUNT_SETS.IsTransformationMount[52]).toBe(true);
    expect(MOUNT_SETS.IsTransformationMount[0]).toBe(false);
  });

  it('贴图可得性登记：主贴图 62/66（+1457 Trusty 64/65 共用 Extra_301/302）；滚轴鞋族（57-60）无贴图走色块近似', () => {
    const ok = Object.entries(MOUNT_TEXTURE_OK).filter(([, v]) => v).length;
    expect(ok).toBe(62);
    expect(MOUNT_TEXTURE_OK['57']).toBe(false);
    expect(MOUNT_TEXTURE_OK['0']).toBe(true);
    expect(MOUNT_TEXTURE_OK['64']).toBe(true);
    expect(MOUNT_TEXTURE_OK['65']).toBe(true);
  });

  it('召唤物品链（Item.cs mountType）：鞍族 + 矿车族', () => {
    expect(mountOfItem(1914)).toBe(0);   // 驯鹿铃铛
    expect(mountOfItem(2428)).toBe(1);   // 绒毛胡萝卜
    expect(mountOfItem(2429)).toBe(2);   // 带鳞松果
    expect(mountOfItem(2430)).toBe(3);   // 粘鞍
    expect(mountOfItem(2491)).toBe(4);   // 硬鞍
    expect(mountOfItem(2502)).toBe(5);   // 花蜜
    expect(mountOfItem(3260)).toBe(10);  // 独角兽
    expect(mountOfItem(2769)).toBe(7);   // UFO
    expect(mountOfItem(4716)).toBe(37);  // 火烈鸟
    expect(mountOfItem(2343)).toBe(6);   // 矿车（DefaultToMinecart）
    expect(mountOfItem(3353)).toBe(11);  // 机械矿车
    expect(mountOfItem(8)).toBe(-1);     // 非召唤物
  });

  it('坐骑 buff 表（BuffID.Sets.MountType）', () => {
    expect(mountOfBuff(90)).toBe(0);
    expect(mountOfBuff(131)).toBe(4);
    expect(mountOfBuff(141)).toBe(7);
    expect(mountOfBuff(118)).toBe(6);
  });
});

describe('MountInstance 状态机（Mount.cs 行为）', () => {
  it('setMount/dismount 生命周期 + isCart 门', () => {
    const m = new MountInstance();
    expect(m.active).toBe(false);
    expect(m.setMount(1, view())).toBe(true);
    expect(m.active && m.type).toBe(1);
    expect(m.isCart).toBe(false);
    expect(m.setMount(6, view())).toBe(true);
    expect(m.isCart).toBe(true);          // 矿车族标记（物理仍由 Minecart 接管）
    m.dismount(view());
    expect(m.active).toBe(false);
    expect(m.type).toBe(-1);
  });

  it('蜜蜂浸水不可上（SetMount :6190 m==5 && wet）', () => {
    const m = new MountInstance();
    expect(m.setMount(5, view({ inWater: true }))).toBe(false);
    expect(m.setMount(5, view({ inWater: false }))).toBe(true);
  });

  it('同型重复上坐被拒（SetMount :6189 _type == m）', () => {
    const m = new MountInstance();
    m.setMount(1, view());
    expect(m.setMount(1, view())).toBe(false);
    expect(m.type).toBe(1);
  });

  it('RunSpeed 特例（:451-486）：蜜蜂空中随疲劳衰减 / 猪鲨崽空中 +13.5 / 海龟游泳态', () => {
    const bee = new MountInstance();
    bee.setMount(5, view());
    bee.frameState = FRAME_STANDING;
    expect(bee.runSpeed()).toBe(2);
    bee.frameState = FRAME_IN_AIR;
    expect(bee.runSpeed()).toBeCloseTo(6);        // 2 + 4×(1-0)
    // 疲劳半池 → 加成减半
    bee.fatigue = 160;
    bee.fatigueMax = 320;
    expect(bee.runSpeed()).toBeCloseTo(4);
    const fish = new MountInstance();
    fish.setMount(12, view());
    fish.frameState = FRAME_IN_AIR;
    expect(fish.runSpeed()).toBeCloseTo(15.5);    // 2 + 13.5
    const turtle = new MountInstance();
    turtle.setMount(4, view());
    turtle.frameState = FRAME_SWIMMING;
    expect(turtle.runSpeed()).toBe(10);           // swimSpeed
    turtle.frameState = FRAME_STANDING;
    expect(turtle.runSpeed()).toBe(2);
  });

  it('跳跃参数特例（:2767-2816）：驯鹿 |vx|/4 与 /7；海龟游泳态 +5/+2.5', () => {
    const rud = new MountInstance();
    rud.setMount(0, view());
    expect(rud.jumpHeight(8)).toBe(17 + 2);       // trunc(8/4)
    expect(rud.jumpSpeed(7)).toBeCloseTo(5.31 + 1);
    const turtle = new MountInstance();
    turtle.setMount(4, view());
    expect(turtle.jumpHeight(0)).toBe(12);
    turtle.frameState = FRAME_SWIMMING;
    expect(turtle.jumpHeight(0)).toBe(17);        // +5
    expect(turtle.jumpSpeed(0)).toBeCloseTo(6.2); // 3.7 + 2.5
  });

  it('canFly/canHover（:2817-2859）：陆行不可飞、hover 族可悬停、熔岩鲨限水中', () => {
    const bunny = new MountInstance();
    bunny.setMount(1, view());
    expect(bunny.canFly(view())).toBe(false);
    expect(bunny.canHover(view())).toBe(false);
    const ufo = new MountInstance();
    ufo.setMount(7, view());
    expect(ufo.canFly(view())).toBe(true);
    expect(ufo.canHover(view())).toBe(true);
    const shark = new MountInstance();
    shark.setMount(49, view());
    shark.frameState = FRAME_IN_AIR;
    expect(shark.canHover(view())).toBe(false);
    shark.frameState = FRAME_SWIMMING;
    expect(shark.canHover(view())).toBe(true);
  });

  it('飞行时量与疲劳（Flight :2937 / FatigueRecovery :2925 / ResetFlightTime :5260）', () => {
    const rud = new MountInstance();
    rud.setMount(0, view({ vx: 4 }));
    rud.resetFlightTime(view({ vx: 4 }));
    // 驯鹿落地续飞：160 + trunc(4×20) = 240
    expect(rud.flyTime).toBe(240);
    let n = 0;
    while (rud.flight()) n++;
    expect(n).toBe(240);
    expect(rud.flight()).toBe(false);
    // 疲劳恢复：每 tick -2 直至 0
    const bee = new MountInstance();
    bee.setMount(5, view());
    bee.fatigueMax = 320;
    bee.fatigue = 5;
    bee.fatigueRecovery();
    expect(bee.fatigue).toBe(3);
    bee.fatigueRecovery();
    expect(bee.fatigue).toBe(1);                  // ≤2 档下一次归 0
    bee.fatigueRecovery();
    expect(bee.fatigue).toBe(0);
  });

  it('悬停能量池（Hover :3310）：flyTime 先耗、尽后累积疲劳、满池失升力', () => {
    // 蜜蜂（5）不在疲劳豁免集（DoesHoverIgnoresFatigue :3534 = {7,8,12,23,44,49,56,61}）
    const bee = new MountInstance();
    bee.setMount(5, view());
    bee.fatigueMax = 320;
    bee.flyTime = 2;
    bee.frameState = FRAME_IN_AIR;
    bee.hover(view({ inputUp: true }));
    expect(bee.flyTime).toBe(1);
    bee.hover(view({ inputUp: true }));
    expect(bee.flyTime).toBe(0);
    bee.hover(view({ inputUp: true }));
    expect(bee.fatigue).toBe(1);                  // flyTime 尽后转入疲劳累积
    // 爬升速度：vy 向 -(2 + 6×(1-疲劳比)) 带 deadzone 钳
    bee.fatigue = 0;
    const v2 = view({ inputUp: true, vy: 0 });
    bee.hover(v2);
    expect(v2.vy).toBeLessThan(0);
    // 疲劳满 → 无升力输入时钳在 4×1=4 的下落带
    bee.fatigue = 320;
    const v3 = view({ inputUp: true, vy: 0 });
    bee.hover(v3);
    expect(v3.vy).toBeGreaterThanOrEqual(0);
    // UFO（7）在豁免集内：hover 不耗能量不积疲劳
    const ufo = new MountInstance();
    ufo.setMount(7, view());
    ufo.flyTime = 2;
    ufo.frameState = FRAME_IN_AIR;
    ufo.hover(view({ inputUp: true }));
    expect(ufo.flyTime).toBe(2);
    expect(ufo.fatigue).toBe(0);
  });

  it('帧态机（UpdateFrame :3563）：静止→站立 / 移动→跑动 / 离地→空中 / UFO 恒飞行', () => {
    const bunny = new MountInstance();
    bunny.setMount(1, view());
    bunny.updateFrame(view(), FRAME_STANDING, 0, 0);
    expect(bunny.frameState).toBe(FRAME_STANDING);
    bunny.updateFrame(view(), FRAME_RUNNING, 4, 0);
    expect(bunny.frameState).toBe(FRAME_RUNNING);
    expect(bunny.frame).toBeGreaterThanOrEqual(0);
    bunny.updateFrame(view(), FRAME_IN_AIR, 0, -3);
    expect(bunny.frameState).toBe(FRAME_IN_AIR);
    const ufo = new MountInstance();
    ufo.setMount(7, view());
    ufo.updateFrame(view(), FRAME_STANDING, 0, 0);
    expect(ufo.frameState).toBe(FRAME_STANDING);  // frameState 不被改写（:3688 只改帧组）
    expect(ufo.frame).toBe(0);                    // 空中组起点 0（inAirFrameStart 0）
  });

  it('abilityRecovery（:2897）：充能单向爬升、冷却/持续时间递减', () => {
    const scut = new MountInstance();
    scut.setMount(9, view());                     // abilityChargeMax 40 / cooldown 20
    scut.abilityCooldown = 20;
    scut.abilityRecovery();
    expect(scut.abilityCooldown).toBe(19);
    scut.abilityCharging = true;
    for (let i = 0; i < 45; i++) scut.abilityRecovery();
    expect(scut.abilityCharge).toBe(40);          // 钳在 max
  });

  it('canDismount：同尺寸盒下坐恒可（★BJ357 重锚 CanDismountWithResult :6670-6681——TryChangingSizeFromBottomCenter(20×42) 对 20×42 盒缩支零探针恒真；旧「头顶填实心拒绝」系旧列扫近似的过严语义,随缩盒刀退役;变身盒 8×14 回长被拒的判别面移至 bj357-pixie-mount-transform.test.ts）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);                                // 落地
    p.mount.setMount(1, p);
    expect(p.mount.canDismount(p)).toBe(true);
    // 正上方填实心：同尺寸盒零探针仍可下（原版同相——骑乘盒本已占据该空间）
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor((p.y + p.h - 42) / TILE);
    w.store.setTileSilent(tx, ty, 1);
    w.store.setTileSilent(tx, ty - 1, 1);
    expect(p.mount.canDismount(p)).toBe(true);
    expect(p.mount.tryDismount(p)).toBe(true);
    expect(p.ridingMount).toBe(false);
  });

  it('upkeep：控场（冰冻）强制下坐（Player.cs:26556 frozen → TryDismount）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(1, p);
    expect(p.ridingMount).toBe(true);
    p.buffs.apply(BuffType.Frozen, 1);
    tick(p, w, 1);
    expect(p.ridingMount).toBe(false);
  });
});

describe('三模物理接管（Player.fixedUpdate 挂钩）', () => {
  it('陆行族：Run 段参数覆写（Player.cs:26329-26331）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(14, p);                      // 蜥蜴 runSpeed 8
    p.inputX = 1;
    const x0 = p.x;
    tick(p, w, 30);
    expect(p.x).toBeGreaterThan(x0 + 16 * 3);     // 蜥蜴 8px/t ≫ 步行 3px/t
    // 限速 = mount.RunSpeed（8）而非玩家 maxRun
    expect(Math.abs(p.vx)).toBeLessThanOrEqual(8.5);
    expect(p.ridingMount).toBe(true);
  });

  it('constantJump 族 autoJump 语义（Player.cs:20366/:20406）：免松键连跳、不按跳不弹', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(3, p);                       // constantJump = true（Mount.cs:848）
    expect(p.mount.autoJump).toBe(true);
    const groundY = p.y;
    // 不按跳仅移动：原版整条跳跃链在 if(controlJump) 门内（:20366），autoJump 只免
    // releaseJump（:20406）——绝不无输入自动弹跳（曾误实现为"移动即弹跳"）
    p.inputX = 1;
    let minY = p.y;
    for (let i = 0; i < 90; i++) { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); minY = Math.min(minY, p.y); }
    expect(minY).toBe(groundY);                   // 始终贴地
    // 按住跳不松手：autoJump 免 releaseJump 落地即重跳 → 持续弹跳
    // ★BJ701 窗口重校 180→400：史莱姆族双竖向碰撞趟（Player.cs:28409-28414,垂直
    //   位移×2=hyper jump）落地后,本 120 格测试世界的太空低重力带（y/16<60+10n5,
    //   深度重力斜率 IIIII224 :24861-24883 → grav×0.25）被弹跳弧顶探入 → 单次弹跳
    //   ~150 拍（旧单趟 ~35 拍）,180 拍只容 1 次落地。语义锁（免松键连跳）不变。
    p.inputX = 0; p.vx = 0; p.inputJump = true;
    minY = p.y;
    let landings = 0; let wasAir = false;
    for (let i = 0; i < 400; i++) {
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      minY = Math.min(minY, p.y);
      if (!p.onGround) wasAir = true;
      else if (wasAir) { landings++; wasAir = false; }
    }
    expect(minY).toBeLessThan(groundY - 16);      // 离地腾空
    expect(landings).toBeGreaterThanOrEqual(2);   // 多次落地重跳（无需松键）
  });

  it('悬停爬升接受单按上（Hover :3396-3424 controlUp）：松键截断段让位', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(7, p);                       // UFO hover
    p.inputUp = true;                             // 只按上、不按跳（原版合法爬升输入）
    const y0 = p.y;
    tick(p, w, 90);
    // 曾被"松键截断上升"手感段反复掐回 vy=2，90t 只爬 35px
    expect(p.y).toBeLessThan(y0 - 100);
    expect(p.mount.frameState === FRAME_FLYING || p.mount.frameState === FRAME_IN_AIR).toBe(true);
  });

  it('飞行族 hover 接管：按上升键消耗 flyTime 且免摔', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(7, p);                       // UFO hover
    p.inputJump = true;
    tick(p, w, 30);
    // 起跳离地后进入 hover 帧态，vy 不应坠回地面终端速度
    expect(p.mount.frameState === FRAME_FLYING || p.mount.frameState === FRAME_IN_AIR).toBe(true);
    expect(p.fallStartY).toBeNull();              // 悬停免摔（fallStart 重置）
  });

  it('非 hover 飞行（驯鹿）：flyTime 耗尽后缓降（重力/3 带）', () => {
    const m = new MountInstance();
    m.setMount(0, view({ vx: 0 }));
    m.resetFlightTime(view({ vx: 0 }));
    expect(m.flyTime).toBe(160);
  });

  it('游泳族：海龟浸水碰撞/位移豁免（ignoreWater 积分层）+ 免淹（★BJ704-G12 债3：重力已改走湿支液体档）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(4, p);                       // 海龟 buff 131 → swimFree
    expect(p.ridingMountSwimFree).toBe(true);
    expect(p.mount.swimFree).toBe(true);
    // 注水没顶：非骑乘会耗 breath，海龟不淹（:22953）
    const headTy = Math.floor((p.y + 2) / TILE);
    for (let j = headTy; j < 80; j++) {
      for (let i = Math.floor(p.x / TILE) - 1; i <= Math.floor((p.x + p.w) / TILE) + 1; i++) {
        w.store.setLiquid(i, j, 255, 1);
      }
    }
    tick(p, w, 1);
    expect(p.inWater).toBe(true);
    const breath0 = p.breath;
    tick(p, w, 60 * 3);
    expect(p.breath).toBe(breath0);               // 免淹：breath 不减
    expect(p.hp).toBe(p.maxHp);                   // 不掉血
  });

  it('摔伤系数（Player.cs:25081 ×mount.FallDamage）：兔兔 0.8 / 飞行族 0', () => {
    const bunny = new MountInstance();
    bunny.setMount(1, view());
    expect(bunny.fallDamageFactor).toBeCloseTo(0.8);
    const ufo = new MountInstance();
    ufo.setMount(7, view());
    expect(ufo.fallDamageFactor).toBe(0);
    const slime = new MountInstance();
    slime.setMount(3, view());
    expect(slime.extraFall).toBe(10);             // extraFall 起步豁免（:25011）
  });

  it('isCartMount：矿车族判定（Minecart.ts 接管路径不回退）', () => {
    expect(isCartMount(6)).toBe(true);
    expect(isCartMount(0)).toBe(false);
  });
});

describe('钻头坐骑（mount 8）：激光挖掘纯函数（Mount.cs :3145-3218）', () => {
  it('drillBlockTarget：射线带内首个可破坏实体格（穿透前方）', () => {
    // 玩家在 (10,20)，正右方 3 格外一堵竖墙 → 光束命中第一块实体
    const st = fakeDrillStore([[13, 20]]);
    const t = drillBlockTarget(st, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, idleBeams());
    expect(t).toEqual({ x: 13, y: 20 });
    // 空射线（全空气）→ 无目标
    const empty = fakeDrillStore();
    expect(drillBlockTarget(empty, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, idleBeams())).toBeNull();
  });

  it('射程钳制：min(鼠标距,224)+32 —— 16 格外无目标', () => {
    // 224+32 = 256px = 16 格；PlotLine 不含终点格 → 最远可命中第 25 格（15 格之外）
    const st = fakeDrillStore([[30, 20]]);
    expect(drillBlockTarget(st, DRILL_CX, DRILL_CY, DRILL_CX + 1000, DRILL_CY, idleBeams())).toBeNull();
    // 射程内（14 格）→ 命中
    const st2 = fakeDrillStore([[24, 20]]);
    expect(drillBlockTarget(st2, DRILL_CX, DRILL_CY, DRILL_CX + 1000, DRILL_CY, idleBeams()))
      .toEqual({ x: 24, y: 20 });
  });

  it('光束分工：已被他束锁定的格跳过（两束不打同一块）', () => {
    const st = fakeDrillStore([[13, 20]]);
    const beams = idleBeams();
    beams[0] = { tx: 13, ty: 20, cooldown: 1, purpose: 0 };
    expect(drillBlockTarget(st, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, beams)).toBeNull();
    // 拆墙目的（purpose 1）锁定的格不影响挖块目标
    beams[0] = { tx: 13, ty: 20, cooldown: 1, purpose: 1 };
    expect(drillBlockTarget(st, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, beams))
      .toEqual({ x: 13, y: 20 });
  });

  it('drillWallTarget：首个有墙格；wall 350（不可拆）跳过', () => {
    const st = fakeDrillStore([], { '13,20': 1 });
    expect(drillWallTarget(st, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, idleBeams()))
      .toEqual({ x: 13, y: 20 });
    const st350 = fakeDrillStore([], { '13,20': 350 });
    expect(drillWallTarget(st350, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, idleBeams())).toBeNull();
  });

  it('clampToDeadZone：瞄准点贴身时外推到死区边缘（Mount.cs :5294）', () => {
    const c = clampToDeadZone(0, 0, 5, 0, 45, 54);
    expect(Math.hypot(c.x, c.y)).toBeGreaterThanOrEqual(45);
    const far = clampToDeadZone(0, 0, 500, 0, 45, 54);
    expect(far.x).toBe(500);
    expect(far.y).toBe(0);
  });
});

describe('钻头坐骑（mount 8）：MountInstance 状态机（UseDrill/UpdateDrill/AimAbility）', () => {
  it('setDrillActive 开合 + updateDrill 光束冷却衰减与二极管 lerp（:3000-3021）', () => {
    const m = new MountInstance();
    m.setMount(8, view());
    expect(m.abilityActive).toBe(false);
    m.setDrillActive(true);
    expect(m.abilityActive).toBe(true);          // 按压边沿开
    m.setDrillActive(true);
    expect(m.abilityActive).toBe(true);
    m.setDrillActive(false);                     // 双松关
    expect(m.abilityActive).toBe(false);
    // 光束冷却 ==1 档：衰减并清目标
    m.beams[0].tx = 5; m.beams[0].ty = 6; m.beams[0].cooldown = 1;
    m.diodeRotation = 0; m.diodeRotationTarget = 1;
    m.updateDrill();
    expect(m.beams[0].cooldown).toBe(0);
    expect(m.beams[0].tx).toBe(-1);              // 冷却尽 → curTileTarget 复位
    expect(m.diodeRotation).toBeCloseTo(0.15);   // 0×0.85 + 1×0.15
  });

  it('aimDrill：光标记录 + 二极管目标角取最短旋转路径（:5465-5498）', () => {
    const m = new MountInstance();
    m.setMount(8, view());
    m.aimDrill(DRILL_CX, DRILL_CY, DRILL_CX + 100, DRILL_CY);
    expect(m.crosshairX).toBe(DRILL_CX + 100);
    expect(m.diodeRotationTarget).toBeCloseTo(0);
    m.aimDrill(DRILL_CX, DRILL_CY, DRILL_CX, DRILL_CY + 100);
    expect(m.diodeRotationTarget).toBeCloseTo(Math.PI / 2);
    // 从 ~π/2 转到 ~0：最短路径应经正向递减而非绕远
    m.aimDrill(DRILL_CX, DRILL_CY, DRILL_CX + 100, DRILL_CY);
    expect(m.diodeRotation).toBeLessThan(Math.PI / 2 + 0.01);
  });

  it('useDrill：左键挖块 / 右键拆墙，两束齐射各锁一格（:3023-3143）', () => {
    const m = new MountInstance();
    const drillView = { ...view({ x: DRILL_CX - 10, y: DRILL_CY - 21, w: 20, h: 42 }) };
    m.setMount(8, drillView);
    m.setDrillActive(true);
    m.aimDrill(DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY);
    const st = fakeDrillStore([[13, 20], [13, 19], [13, 21]]);
    const picked: Array<[number, number]> = [];
    const walled: Array<[number, number]> = [];
    m.useDrill({ ...drillView, store: st as never }, {
      useItem: true, useTile: false,
      pickTile: (tx, ty) => picked.push([tx, ty]),
    });
    expect(picked.length).toBe(2);               // amountOfBeamsAtOnce = 2
    expect(m.beams.every((b) => b.cooldown === DRILL_PICK_TIME)).toBe(true);
    expect(m.beams.every((b) => b.purpose === 0)).toBe(true);
    // 未激活不挖
    m.setDrillActive(false);
    m.useDrill({ ...drillView, store: st as never }, {
      useItem: true, useTile: true,
      pickTile: (tx, ty) => picked.push([tx, ty]),
      pickWall: (tx, ty) => walled.push([tx, ty]),
    });
    expect(picked.length).toBe(2);
    expect(walled).toHaveLength(0);
  });

  it('挖块镐力 210 / 每束每 tick 一击（drillPickTime=1）', () => {
    expect(DRILL_PICK_POWER).toBe(210);
    expect(DRILL_PICK_TIME).toBe(1);
    expect(DRILL_MAX_LENGTH).toBe(224);
  });
});

describe('悬停坐骑贴地/起落门（Mount.cs Hover :3437-3457 尾段 + Player.cs:26939）', () => {
  /** view.store 桩：solid 集合按格坐标给（groundBelowProbe/tryBeginningFlight 探针用） */
  const storeWith = (solid: Array<[number, number]>) => {
    const set = new Set(solid.map(([x, y]) => `${x},${y}`));
    return {
      inBounds: (tx: number, ty: number) => tx >= 0 && tx < 40 && ty >= 0 && ty < 40,
      idx: (tx: number, ty: number) => ty * 40 + tx,
      flags: new Uint8Array(40 * 40).fill(1),
      isSolid: (tx: number, ty: number) => set.has(`${tx},${ty}`),
    };
  };
  it('groundBelowProbe：脚底下一行有实心 = 贴地（:3443-3448 TileCollision 探针等价）', () => {
    const grounded = view({ x: 320, y: 594, w: 20, h: 42, store: storeWith([[20, 39], [21, 39]]) });
    expect(groundBelowProbe(grounded)).toBe(true);      // 探针行 (594+42+1)/16=39 = 实心
    const airborne = view({ x: 320, y: 560, w: 20, h: 42, store: storeWith([[20, 39], [21, 39]]) });
    expect(groundBelowProbe(airborne)).toBe(false);     // 探针行 (603)/16=37 无实心
  });

  it('免疲劳 hover 坐骑贴地段：下方有地面 vy 保持 0；悬空/按下 → vy=0.001 起落', () => {
    const m = new MountInstance();
    m.setMount(8, view());   // 钻头 8 = HOVER_IGNORES_FATIGUE
    m.frameState = FRAME_STANDING;
    // 贴地：探针命中 → vy 不动（原版 :3443-3451 残量=0 分支）
    const onGround = view({ x: 320, y: 594, w: 20, h: 42, store: storeWith([[20, 39], [21, 39]]) });
    m.hover(onGround);
    expect(onGround.vy).toBe(0);
    // 悬空（walked off ledge）：探针落空 → vy=0.001 起落 → 下一 tick 帧态切空中
    const offLedge = view({ x: 320, y: 560, w: 20, h: 42, store: storeWith([[20, 39], [21, 39]]) });
    m.hover(offLedge);
    expect(offLedge.vy).toBe(0.001);
    // 贴地但按下：主动下潜起落（controlDown 分支）
    const pressDown = view({ x: 320, y: 594, w: 20, h: 42, store: storeWith([[20, 39], [21, 39]]), inputDown: true });
    m.hover(pressDown);
    expect(pressDown.vy).toBe(0.001);
  });

  it('吃能量 hover 坐骑（蜜蜂 5）非悬停帧态仍走重力（:3437-3439）', () => {
    const m = new MountInstance();
    m.setMount(5, view());
    m.frameState = FRAME_STANDING;
    const v = view({ x: 320, y: 594, w: 20, h: 42, store: storeWith([[20, 39], [21, 39]]) });
    m.hover(v);
    expect(v.vy).toBeCloseTo(0.4);   // DEFAULT_GRAVITY
  });

  it('悬停静置防漂：无升降输入收敛 -0.001 且 y 下移 0.001 抵消上漂（:3446-3450）', () => {
    const m = new MountInstance();
    m.setMount(8, view());
    m.frameState = FRAME_IN_AIR;
    const v = view({ x: 320, y: 560, w: 20, h: 42, vy: 1.5, store: storeWith([]) });
    for (let i = 0; i < 40 && v.vy !== -0.001; i++) m.hover(v);   // 钳位带 0.16/tick 回拉
    expect(v.vy).toBe(-0.001);       // 静置档
    const y0 = v.y;
    m.hover(v);
    expect(v.y).toBeCloseTo(y0 + 0.001);   // position.Y -= -0.001 抵消上漂
  });

  it('tryStartHover 边沿用 upEdgePrev（↑ 键上升沿,:26939 controlUp∧releaseUp——★G15 通道翻正）', () => {
    const m = new MountInstance();
    m.setMount(8, view());
    // ↑ 键上 tick 已按 → 非 releaseUp 边沿,不触发
    const held = view({ inputUp: true, jumpEdgePrev: true, upEdgePrev: true });
    m.tryStartHover(held);
    expect(held.vy).toBe(0);
    // ↑ 键新按（上 tick 未按）→ 边沿触发
    const fresh = view({ inputUp: true, jumpEdgePrev: false, upEdgePrev: false });
    m.tryStartHover(fresh);
    expect(fresh.vy).toBeLessThan(0); // -(acceleration+gravity+0.001)
    expect(fresh.vy).toBeCloseTo(-(0.16 + 0.4 + 0.001));
    // ★G15 判别面:持 Space（合成跳键上拍已真）中按 W——vanilla 触发（controlUp 独立键面）,
    // 旧读 jumpEdgePrev=不触发
    const spaceHeldWFresh = view({ inputUp: true, jumpEdgePrev: true, upEdgePrev: false });
    m.tryStartHover(spaceHeldWFresh);
    expect(spaceHeldWFresh.vy).toBeLessThan(0);
  });
});

describe('Scutlix Gunner（mount 9）：索敌/瞄准帧/充能开火（Mount.cs :4884-4954/:5338-5418）', () => {
  it('scutlixFindTarget：850px 内、朝向锥 ±60°、视线可达的最近敌怪', () => {
    const p = { x: 100, y: 100, w: 20, h: 42, facing: 1 };
    const los = () => true;
    const near = { x: 300, y: 120, w: 20, h: 40 };      // ~208px 正前方
    const far = { x: 380, y: 130, w: 20, h: 40 };       // 更远
    expect(scutlixFindTarget(p, [far, near], los)).toEqual(near);
    // 朝向锥外（正后方）→ 无目标
    const behind = { x: -100, y: 120, w: 20, h: 40 };
    expect(scutlixFindTarget(p, [behind], los)).toBeNull();
    // 超出 850px → 无目标
    const tooFar = { x: 1100, y: 120, w: 20, h: 40 };
    expect(scutlixFindTarget(p, [tooFar], los)).toBeNull();
    // 视线被挡 → 无目标
    expect(scutlixFindTarget(p, [near], () => false)).toBeNull();
  });

  it('aimScutlix：±90° 外换向 + 眼部瞄准帧分档（6-10）', () => {
    const m = new MountInstance();
    m.setMount(9, view());
    const v = view({ x: 0, y: 0, w: 20, h: 42 });
    // 正右 → frameExtra 8 / 面右
    m.aimScutlix(v, 300, 21);
    expect(m.frameExtra).toBe(8);
    expect(v.facing).toBe(1);
    // 正上（-90°）→ frameExtra 6
    m.aimScutlix(v, 10, -200);
    expect(m.frameExtra).toBe(6);
    // 斜下 45° → 9；正下 90° → 10
    m.aimScutlix(v, 300, 300);
    expect(m.frameExtra).toBe(9);
    m.aimScutlix(v, 10, 300);
    expect(m.frameExtra).toBe(10);
    // 正后方 → 换向面左且帧归 8
    m.aimScutlix(v, -300, 21);
    expect(v.facing).toBe(-1);
    expect(m.frameExtra).toBe(8);
    // 背向移动（面右但向左跑）→ 倒放标记
    const v2 = view({ x: 0, y: 0, w: 20, h: 42, vx: -3 });
    m.aimScutlix(v2, 300, 21);
    expect(m.flipDraw).toBe(true);
  });

  it('SetMount 冷却下限 20（:6224）+ 冷却中充能 / 归零开火两连发 / 失瞄复位', () => {
    const m = new MountInstance();
    m.setMount(9, view());
    expect(m.abilityCooldown).toBe(20);          // 上坐即预热
    const target = { x: 300, y: 100, w: 20, h: 40 };
    const fired: number[][] = [];
    const v = view({ x: 100, y: 100 });
    // 冷却中：只瞄准 + 持续充能
    expect(m.updateScutlix(v, target, (x, y, vx, vy) => fired.push([x, y, vx, vy]))).toBe(false);
    expect(fired).toHaveLength(0);
    expect(m.abilityCharging).toBe(true);
    expect(m.aiming).toBe(true);
    // 冷却归零：两束眼激光 + 冷却重置 20
    m.abilityCooldown = 0;
    expect(m.updateScutlix(v, target, (x, y, vx, vy) => fired.push([x, y, vx, vy]))).toBe(true);
    expect(fired).toHaveLength(2);
    expect(m.abilityCooldown).toBe(20);
    expect(m.abilityCharging).toBe(false);
    for (const [x, y, vx, vy] of fired) {
      expect(Math.hypot(vx, vy)).toBeCloseTo(14);   // 弹速 14（:3244）
      expect(x).toBeGreaterThan(100);               // 眼部出生点在玩家前方
      void y;
    }
    // 失瞄：停充 + 头部复位
    m.updateScutlix(v, null, () => { /* 无目标不开火 */ });
    expect(m.abilityCharging).toBe(false);
    expect(m.aiming).toBe(false);
    expect(m.frameExtra).toBe(0);
  });

  it('跑动帧背向倒放（flipDraw → 帧率取负，:4245-4291）', () => {
    const m = new MountInstance();
    m.setMount(9, view());
    m.frame = 3;                                  // 跑动组 0-5
    m.flipDraw = false;
    m.updateFrame(view({ vx: 4 }), FRAME_RUNNING, 4, 0);
    expect(m.frame).toBeGreaterThanOrEqual(3);    // 正放前进
    m.flipDraw = true;
    const frBefore = m.frame;
    m.updateFrame(view({ vx: 4 }), FRAME_RUNNING, 4, 0);
    expect(m.frame).toBeLessThanOrEqual(frBefore); // 倒放不前进
  });
});

describe('蜥蜴 14 / 山羊 47：特殊跳与冲刺态（UpdateEffects + JumpMovement）', () => {
  it('jumpOption 映射 + 跳跃保持时长（:20603 trunc(20×0.75)=15 / 山羊 10×2=20）', () => {
    const goat = new MountInstance();
    goat.setMount(47, view());
    expect(goat.jumpOption).toBe('WallOfFleshGoat');
    expect(goat.mountJumpTicks()).toBe(20);
    const basilisk = new MountInstance();
    basilisk.setMount(14, view());
    expect(basilisk.jumpOption).toBe('Basilisk');
    expect(basilisk.mountJumpTicks()).toBe(15);
    const unicorn = new MountInstance();
    unicorn.setMount(10, view());
    expect(unicorn.jumpOption).toBe('Unicorn');
    expect(unicorn.mountJumpTicks()).toBe(20);
    const bunny = new MountInstance();
    bunny.setMount(1, view());
    expect(bunny.jumpOption).toBeNull();          // 其余坐骑无特殊跳
  });

  it('冲刺免击退门（:4962 |vx| > DashSpeed-RunSpeed/2；蜥蜴未设 dashSpeed 门恒过）', () => {
    const goat = new MountInstance();
    goat.setMount(47, view());
    expect(goat.dashNoKnockback(11)).toBe(true);  // 12 - 2 = 10
    expect(goat.dashNoKnockback(9)).toBe(false);
    const basilisk = new MountInstance();
    basilisk.setMount(14, view());
    expect(basilisk.dashNoKnockback(0)).toBe(true);   // 裸 dashSpeed 0 → -4 门恒过（原版怪癖）
  });

  it('冲刺帧组切换（:3827 跑动中超速 → FRAME_DASHING 帧 9-14）', () => {
    const goat = new MountInstance();
    goat.setMount(47, view());
    goat.updateFrame(view({ vx: 12 }), FRAME_RUNNING, 12, 0);
    expect(goat.frame).toBeGreaterThanOrEqual(9);     // dashingFrameStart 9
    expect(goat.frame).toBeLessThan(15);
    // 低速跑动 → 常规跑动帧组
    goat.frame = 9;
    goat.updateFrame(view({ vx: 2 }), FRAME_RUNNING, 2, 0);
    expect(goat.frame).toBeLessThan(8);               // 回到 running 组 1-7
    void FRAME_DASHING;
  });

  it('Player 挂钩：空中再跳触发特殊跳（vy 脉冲 + 保持 20t + 常驻加速标记）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);                                    // 落地（mountJumpReady 就绪）
    p.mount.setMount(47, p);
    p.inputJump = true;
    tick(p, w, 6);                                    // 起跳离地，首跳保持(10t)未耗尽
    expect(p.onGround).toBe(false);
    expect(p.mount.mountJumpPerforming).toBe(false);
    tick(p, w, 10);                                   // jumpHold 耗尽 → 空中再跳（按住不松）
    expect(p.mount.mountJumpPerforming).toBe(true);
    expect(p.jumpHold).toBeGreaterThan(0);            // 保持 = jumpHeight×2 = 20t（逐 tick 递减中）
    expect(p.jumpHold).toBeLessThanOrEqual(20);
    expect(p.vy).toBeLessThan(0);                     // -jumpSpeed 脉冲
    expect(p.mount.mountJumpReady).toBe(false);       // 已消费，落地才恢复
    p.inputJump = false;
    tick(p, w, 120);                                  // 落地恢复
    expect(p.mount.mountJumpReady).toBe(true);
  });
});

describe('山羊 47 火焰编排器门（Mount.cs :3885-3896 SolidTileAllowBottomSlope）', () => {
  /** 落脚格视图桩：flags/type/half/slope/frameX 按需覆写（落脚格 = (tx,ty) 由调用方定） */
  const footStore = (tx: number, ty: number, over: {
    type?: number; half?: number; slope?: number; frameX?: number; liquid?: number; flagsOn?: boolean;
  } = {}) => {
    const w = 40, h = 40;
    const idx = (x: number, y: number) => y * w + x;
    const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
    const flags = new Uint8Array(w * h); flags[idx(tx, ty)] = over.flagsOn === false ? 0 : 1;
    const type = new Uint16Array(w * h); type[idx(tx, ty)] = over.type ?? 1;
    const half = new Uint8Array(w * h); half[idx(tx, ty)] = over.half ?? 0;
    const slope = new Uint8Array(w * h); slope[idx(tx, ty)] = over.slope ?? 0;
    const frameX = new Uint16Array(w * h); frameX[idx(tx, ty)] = over.frameX ?? 0;
    const liquid = new Uint8Array(w * h); liquid[idx(tx, ty)] = over.liquid ?? 0;
    return { w, h, inBounds, idx, flags, type, half, slope, frameX, liquid,
      isSolid: (x: number, y: number) => inBounds(x, y) && flags[idx(x, y)] !== 0,
    } as never;
  };
  const runGoat = (st: never) => {
    const m = new MountInstance();
    m.setMount(47, view());
    m.dashing = true;
    // 玩家底边落在 ty-1 → 落脚格 = ty（Mount.cs num25+1）
    const p = view({ y: 100, h: 42, vy: 0, store: st });
    const fires: Array<[number, number]> = [];
    m.updateMountEffects(p, {
      scutlixTargets: [], los: () => true, fishron: {
        hp: 100, maxHp: 100, inWater: false, inLava: false, inHoney: false,
        dripping: false, raining: false, windExposed: false,
      },
      goatFlames: (x, y) => fires.push([x, y]),
    });
    return fires;
  };
  const FOOT_Y = Math.trunc((100 + 42 - 1) / 16) + 1;   // (141)/16=8 → 落脚格 y=9

  it('整砖实心无液 → 触发，出生点 = (tx×16+8, ty×16+16)', () => {
    const tx = Math.trunc((100 + 20 / 2) / 16);          // Center.X/16 = 6
    const fires = runGoat(footStore(tx, FOOT_Y));
    expect(fires).toHaveLength(1);
    expect(fires[0]).toEqual([tx * 16 + 8, FOOT_Y * 16 + 16]);   // ★纵向 +16 偏移（:3895）
  });

  it('SolidTileAllowBottomSlope（cs:70172-70194）：平台放行 / 半砖拦 / 顶坡按帧 / 有液拦', () => {
    const tx = Math.trunc((100 + 20 / 2) / 16);
    // 平台（tileSolidTop）→ 放行
    const platId = TILE_DEFS.findIndex((d) => d.platform);
    expect(runGoat(footStore(tx, FOOT_Y, { type: platId }))).toHaveLength(1);
    // 半砖 → 拦
    expect(runGoat(footStore(tx, FOOT_Y, { half: 1 }))).toHaveLength(0);
    // 顶坡 slope 1 + 非平台 → 拦（topSlope=1|2，Tile.cs:320）
    expect(runGoat(footStore(tx, FOOT_Y, { slope: 1 }))).toHaveLength(0);
    expect(runGoat(footStore(tx, FOOT_Y, { slope: 2 }))).toHaveLength(0);
    // 顶坡 + 平台 + 合法顶帧（frameX 0 → 列 0 ∈[0,7]）→ 放行（cs:70223 豁免）
    expect(runGoat(footStore(tx, FOOT_Y, { type: platId, slope: 1, frameX: 0 }))).toHaveLength(1);
    // 顶坡 + 平台 + 非法帧（frameX 198 → 列 11 ∉ 合法段）→ 拦
    expect(runGoat(footStore(tx, FOOT_Y, { type: platId, slope: 1, frameX: 198 }))).toHaveLength(0);
    // 有液体 → 拦（:3891 tile.liquid == 0 门）
    expect(runGoat(footStore(tx, FOOT_Y, { liquid: 255 }))).toHaveLength(0);
    // 底坡（slope 3/4 非 topSlope）→ 放行
    expect(runGoat(footStore(tx, FOOT_Y, { slope: 3 }))).toHaveLength(1);
  });

  it('非冲刺态/空中不触发（:3887 flag6 && velocity.Y==0）', () => {
    const tx = Math.trunc((100 + 20 / 2) / 16);
    const m = new MountInstance();
    m.setMount(47, view());
    m.dashing = false;
    const p = view({ y: 100, h: 42, vy: 0, store: footStore(tx, FOOT_Y) });
    let n = 0;
    m.updateMountEffects(p, {
      scutlixTargets: [], los: () => true, fishron: {
        hp: 100, maxHp: 100, inWater: false, inLava: false, inHoney: false,
        dripping: false, raining: false, windExposed: false,
      },
      goatFlames: () => { n++; },
    });
    expect(n).toBe(0);
  });
});

describe('猪鲨崽 12：MountFishronSpecial 湿身语义（Player.cs:3882 + Mount.cs:3354/:4996）', () => {
  const fv = (over: Partial<Parameters<MountInstance['fishronSpecial']>[0]> = {}) => ({
    hp: 100, maxHp: 100, inWater: false, inLava: false, inHoney: false,
    dripping: false, raining: false, windExposed: false, ...over,
  });

  it('增益真值表：湿身/半血以下/雨中露天 = 全额；干爽满血无雨 = 减半', () => {
    const m = new MountInstance();
    m.setMount(12, view());
    expect(m.fishronSpecial(fv())).toBe(false);               // 干爽满血无雨
    expect(m.fishronSpecial(fv({ inWater: true }))).toBe(true);   // ★湿身是全额（旧实现误减半）
    expect(m.fishronSpecial(fv({ inLava: true }))).toBe(false);   // 岩浆湿不算
    expect(m.fishronSpecial(fv({ inHoney: true }))).toBe(false);  // 蜂蜜湿不算
    expect(m.fishronSpecial(fv({ hp: 40 }))).toBe(true);      // 半血以下
    expect(m.fishronSpecial(fv({ raining: true, windExposed: true }))).toBe(true);
    expect(m.fishronSpecial(fv({ raining: true, windExposed: false }))).toBe(false);
  });

  it('计数器维护（:4996-5003：半血→60 / 湿身或雨中露天→420）', () => {
    const m = new MountInstance();
    m.setMount(12, view());
    m.updateFishron(fv({ inWater: true }));
    expect(m.fishronCounter).toBe(420);
    expect(m.fishronBoost).toBe(true);
    m.updateFishron(fv({ hp: 40 }));
    expect(m.fishronCounter).toBe(60);
    // 计数器 >0 期间即便已干爽也保持增益（出水后 420t 余效）
    m.updateFishron(fv());
    expect(m.fishronBoost).toBe(true);
    expect(m.fishronCounter).toBe(59);                        // 先衰减再判（:25340）
    m.fishronCounter = 0;
    expect(m.fishronSpecial(fv())).toBe(false);
  });

  it('dripping 消费（Player.cs:3886 `!dripping`）：buff 103 Wet 激活 → 全额增益', () => {
    const m = new MountInstance();
    m.setMount(12, view());
    // 干爽满血无雨无 Wet → 减半
    expect(m.fishronSpecial(fv({ dripping: true }))).toBe(true);
    // dripping 只进增益判定——updateFishron 不因 Wet 写计数器（Mount.cs :4996-5003
    // 计数器仅由 wet | 雨中露天驱动）
    m.updateFishron(fv({ dripping: true, inWater: false, raining: false }));
    expect(m.fishronCounter).toBe(0);
    expect(m.fishronBoost).toBe(true);
    // Wet 到期（dripping 回落）且无其他增益源 → 减半恢复
    expect(m.fishronSpecial(fv({ dripping: false }))).toBe(false);
  });

  it('liquidAlpha 渐变因子（Mount.Draw case 12 :5780-5787）：clamp(计数器/60, 0, 1)', () => {
    // num8 = clamp(MountFishronSpecialCounter/60f, 0f, 1f)；color.A=127 后整色 × num8
    expect(fishronWashFactor(0)).toBe(0);
    expect(fishronWashFactor(30)).toBeCloseTo(0.5);
    expect(fishronWashFactor(60)).toBe(1);
    expect(fishronWashFactor(420)).toBe(1);          // 钳上界
    expect(fishronWashFactor(-5)).toBe(0);           // 钳下界
    // 渲染层 alpha = 127/255 × num8（Renderer.drawMountLayer 消费同一因子）
    expect((127 / 255) * fishronWashFactor(15)).toBeCloseTo((127 / 255) * 0.25);
  });

  it('hover 增益态全额 / 非增益态加速度减半（:3354 num=0.5）', () => {
    const m = new MountInstance();
    m.setMount(12, view());
    m.frameState = FRAME_IN_AIR;
    m.fatigueMax = 320;
    m.flyTime = 320;
    m.fishronBoost = false;
    const v1 = view({ inputUp: true, vy: 0 });
    m.hover(v1);
    expect(v1.vy).toBeCloseTo(-0.1);                          // 0.2 × 0.5
    m.fishronBoost = true;
    m.flyTime = 320;
    const v2 = view({ inputUp: true, vy: 0 });
    m.hover(v2);
    expect(v2.vy).toBeCloseTo(-0.2);                          // 全额
  });

  it('Player 挂钩：fixedUpdate 内计数器维护 + 四系伤害 +15%', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(12, p);
    expect(p.mount.fishronBoost).toBe(false);                 // 干爽满血无雨
    expect(p.damageMult('melee')).toBeCloseTo(1);
    p.hp = 20;                                                // 半血以下 → 增益
    tick(p, w, 1);
    expect(p.mount.fishronBoost).toBe(true);
    expect(p.damageMult('melee')).toBeCloseTo(1.15);
    expect(p.damageMult('summon')).toBeCloseTo(1.15);
  });

  it('Player 挂钩：Wet buff 103 → dripping 全额增益（:3886 `!dripping`）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);
    p.mount.setMount(12, p);
    expect(p.mount.fishronBoost).toBe(false);                 // 干爽满血无雨
    p.buffs.apply(BuffType.Wet, 4);                           // 371 接触授予
    tick(p, w, 1);
    expect(p.mount.fishronBoost).toBe(true);                  // dripping → 全额
    expect(p.damageMult('melee')).toBeCloseTo(1.15);
    // ★Wet 不写 420 计数器（Mount.cs :4996-5003 计数器仅 wet|雨天驱动）——
    // Wet 到期后增益即消失（区别于出水后的 420t 余效）
    p.buffs.remove(BuffType.Wet);
    tick(p, w, 1);
    expect(p.mount.fishronBoost).toBe(false);
    expect(p.mount.fishronCounter).toBe(0);
  });

  it('inAPlaceWithWind：地表以上无液无墙（WorldGen.cs:66135）', () => {
    const st = fakeDrillStore([], {}, 40, 200);
    const liquid = new Uint8Array(40 * 200);
    (st as unknown as { liquid: Uint8Array }).liquid = liquid;
    // y=10 格（< worldSurface 72）且无液无墙 → 露天
    expect(inAPlaceWithWind(st as never, 160, 160, 20, 42, 72)).toBe(true);
    // 地下（y ≥ 72 格）→ 非露天
    expect(inAPlaceWithWind(st as never, 160, 72 * 16, 20, 42, 72)).toBe(false);
    // 贴墙 → 非露天
    const walled = fakeDrillStore([], { '10,10': 1 }, 40, 200);
    expect(inAPlaceWithWind(walled as never, 160, 160, 20, 42, 72)).toBe(false);
  });
});

describe('史后坐骑 50 + constantJump 表核对', () => {
  it('挤压副帧（:4041-4061）：落地恒 3；空中 0-3 循环（flyTime 双倍速）', () => {
    const m = new MountInstance();
    m.setMount(50, view());
    m.updateFrame(view(), FRAME_STANDING, 0, 0);
    expect(m.frameExtra).toBe(3);
    // 空中 8 tick（counter > 7）→ 越过 3 回卷 0
    for (let i = 0; i < 8; i++) m.updateFrame(view({ vy: -3 }), FRAME_IN_AIR, 0, -3);
    expect(m.frameExtra).toBe(0);
    m.flyTime = 80;
    for (let i = 0; i < 4; i++) m.updateFrame(view({ vy: -3 }), FRAME_FLYING, 0, -3);
    expect(m.frameExtra).toBe(1);                             // flyTime 双倍速推进
  });

  it('RenderTarget 主贴图 = QueenSlime 着色器纯装饰（静态近似，登记）；四层贴图可得', () => {
    // PlayerQueenSlimeMountTextureContent 仅把 Extra_204 过一遍 QueenSlime misc shader
    //（结晶微光重着色）——非大眼跟随等行为语义，静态贴图近似不损失玩法
    expect(MOUNT_DATA['50'].backTexture).toBe('Extra_204.png');
    expect(MOUNT_TEXTURE_OK['50']).toBe(true);
  });

  it('constantJump 表 = {3,43,50}（Mount.cs Initialize 提取）', () => {
    const cj = Object.keys(MOUNT_DATA).filter((k) => MOUNT_DATA[k].constantJump)
      .map(Number).sort((a, b) => a - b);
    expect(cj).toEqual([3, 43, 50]);
    // 兔兔 1 非 autoJump：常规跳跃链已覆盖其免松键连跳语义
    expect(MOUNT_DATA['1'].constantJump).toBeUndefined();
  });
});

// ============================================================================
// 坐骑批（Q）边缘 1:1：钻头 CanKillTile/拆墙子集 + 坡面平滑 + 机身倾斜 + 点光 + 606 实体化
// ============================================================================

const TREE_ID = TILE_DEFS.findIndex((d) => d.vanilla?.sheet === 5);   // 树干（IsATreeTrunk）

describe('钻头边缘①：CanKillTile/CanPlayerSmashWall 子集（WorldGen.cs:62249 / Player.cs:45303）', () => {
  it('canKillTileAt：不查镐力（树干同为合法目标——原版挖掘实效走 PickTile 主链）', () => {
    const st = fakeDrillStore([], {}, 40, 40, {}, { '13,20': TREE_ID });
    expect(canKillTileAt(st, 13, 20)).toBe(true);   // 树干无 pick 力，仍可锁定（:3169）
  });

  it('canKillTileAt：上方异种树干 → false（承载保护 :62274-62281）；分支/树顶帧豁免', () => {
    // 目标泥土 (13,20)，正上方 (13,19) 树干（frameY 0 <198）→ 不可杀
    const st = fakeDrillStore([[13, 20]], {}, 40, 40, {}, { '13,19': TREE_ID });
    expect(canKillTileAt(st, 13, 20)).toBe(false);
    // 同种（上方同为泥土）→ 不拦（:62277 tile.type != type 门）
    const same = fakeDrillStore([[13, 20], [13, 19]]);
    expect(canKillTileAt(same, 13, 20)).toBe(true);
    // 树顶帧（frameY ≥198）豁免
    const top = fakeDrillStore([[13, 20]], {}, 40, 40, { '13,19': [0, 200] }, { '13,19': TREE_ID });
    expect(canKillTileAt(top, 13, 20)).toBe(true);
  });

  it('canKillTileAt：自身墙 350 / 越界 / 未激活 → false（:62252-62269）', () => {
    const st = fakeDrillStore([[13, 20]], { '13,20': 350 });
    expect(canKillTileAt(st, 13, 20)).toBe(false);
    expect(canKillTileAt(st, -1, 20)).toBe(false);
    expect(canKillTileAt(fakeDrillStore(), 13, 20)).toBe(false);
  });

  it('drillBlockTarget：承载保护使光束不锁定树干下格——束停在树干本体（:3169-3173）', () => {
    // (13,19) 树干 / (13,20) 泥土：下格受承载保护不可锁定，树干本身可锁定 →
    // 光束停在树干（原版同款：钻头光束会被树挡住，挖掘实效再由 PickTile 主链
    // 判 tileAxe → 0 伤害）
    const st = fakeDrillStore([[13, 20]], {}, 40, 40, {}, { '13,19': TREE_ID });
    expect(drillBlockTarget(st, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, idleBeams()))
      .toEqual({ x: 13, y: 19 });
  });

  it('canPlayerSmashWallAt：房墙直接可拆；天然墙需 3×3 曝露；wall 350 恒不可（:45303）', () => {
    // wall 1（木墙，wallHouse）→ 直接可拆
    expect(canPlayerSmashWallAt(fakeDrillStore([], { '13,20': 1 }), 13, 20)).toBe(true);
    // 天然墙 7 被 3×3 同墙包裹 → 不可拆
    const sealed: Record<string, number> = {};
    for (let i = 12; i <= 14; i++) for (let j = 19; j <= 21; j++) sealed[`${i},${j}`] = 7;
    expect(canPlayerSmashWallAt(fakeDrillStore([], sealed), 13, 20)).toBe(false);
    // 曝露一格（邻墙 0）→ 可拆
    const exposed = { ...sealed };
    delete exposed['14,20'];
    expect(canPlayerSmashWallAt(fakeDrillStore([], exposed), 13, 20)).toBe(true);
    expect(canPlayerSmashWallAt(fakeDrillStore([], { '13,20': 350 }), 13, 20)).toBe(false);
  });

  it('drillWallTarget：3×3 规则下天然墙仅曝露缘可锁（钻头侧已接 CanPlayerSmashWall）', () => {
    // 3×3 天然墙 7 块：外缘格（外侧邻墙 0）可拆、内芯未曝露不可拆 → 光束锁定
    // 扫带内的首个曝露缘格（12,19)
    const sealed: Record<string, number> = {};
    for (let i = 12; i <= 14; i++) for (let j = 19; j <= 21; j++) sealed[`${i},${j}`] = 7;
    const st = fakeDrillStore([], sealed);
    expect(drillWallTarget(st, DRILL_CX, DRILL_CY, DRILL_CX + 400, DRILL_CY, idleBeams()))
      .toEqual({ x: 12, y: 19 });
    // 内芯 (13,20) 直接判定：3×3 全同墙 → 不可拆
    expect(canPlayerSmashWallAt(st, 13, 20)).toBe(false);
  });
});

// ============================================================================
// CanKillTile 追加四子项（WorldGen.cs:62316-62356）：锁门/巨石承载/传送器 235/
// 容器内容（CanDestroyChest）
// ============================================================================

const sheetId = (sheet: number): number => TILE_DEFS.findIndex((d) => d.vanilla?.sheet === sheet);
const DOOR_ID = sheetId(10);      // 关门表（内部 17）
const CHEST_ID = sheetId(21);     // 基础宝箱（内部 16）
const DRESSER_ID = sheetId(88);   // 梳妆台
const TELEPORTER_ID = sheetId(235);
const BOULDER_ID = sheetId(138);
const ALTAR_ID = sheetId(77);
/** KillTileCtx 桩：occupied = 内容非空的宝箱锚格集合 */
const mkCtx = (occupied: Array<[number, number]> = [], hardMode = false) => ({
  hardMode,
  chestDestroyable: (x: number, y: number) => !occupied.some(([ox, oy]) => ox === x && oy === y),
});

describe('钻头边缘①b：CanKillTile 追加四子项（WorldGen.cs:62316-62356）', () => {
  it('上锁门（case 10 :62323-62330）：关门表 + frameY 594-646 + frameX<54 → 不可杀', () => {
    // 神庙锁门帧段 → 不可锁定
    const locked = fakeDrillStore([], {}, 40, 40, { '13,20': [0, 594] }, { '13,20': DOOR_ID });
    expect(canKillTileAt(locked, 13, 20)).toBe(false);
    // 锁段右列（frameX≥54）→ 可杀（IsLockedDoor 仅认关闭态左列）
    const lockedRight = fakeDrillStore([], {}, 40, 40, { '13,20': [54, 594] }, { '13,20': DOOR_ID });
    expect(canKillTileAt(lockedRight, 13, 20)).toBe(true);
    // 锁段之外（frameY 648，已 +54 解锁）→ 可杀
    const unlocked = fakeDrillStore([], {}, 40, 40, { '13,20': [0, 648] }, { '13,20': DOOR_ID });
    expect(canKillTileAt(unlocked, 13, 20)).toBe(true);
    // 开门表（sheet 11）不参与锁判定
    const openDoor = sheetId(11);
    const opened = fakeDrillStore([], {}, 40, 40, { '13,20': [0, 594] }, { '13,20': openDoor });
    expect(canKillTileAt(opened, 13, 20)).toBe(true);
  });

  it('巨石-承载保护（:62316-62321 + CheckBoulderChest :48810）：锚点上方两格有容器 → 不可杀', () => {
    // (13,20) 巨石 frameX 18（中列）→ 锚点归一到左列 (12,20)；其上方 (12,19) 放宝箱
    const st = fakeDrillStore([], {}, 40, 40, { '13,20': [18, 0] }, { '13,20': BOULDER_ID, '12,19': CHEST_ID });
    expect(canKillTileAt(st, 13, 20)).toBe(false);
    // 上方两格皆空 → 可杀
    const clear = fakeDrillStore([], {}, 40, 40, { '13,20': [18, 0] }, { '13,20': BOULDER_ID });
    expect(canKillTileAt(clear, 13, 20)).toBe(true);
    // 祭坛 77 非困难模式也拦（CheckTileBreakability :62494）
    const altar = fakeDrillStore([], {}, 40, 40, { '13,20': [18, 0] }, { '13,20': BOULDER_ID, '12,19': ALTAR_ID });
    expect(canKillTileAt(altar, 13, 20, mkCtx([], false))).toBe(false);
    expect(canKillTileAt(altar, 13, 20, mkCtx([], true))).toBe(true);   // hardMode 放行
  });

  it('传送器 235（case 235 :62331-62344）：锚点列起上方 3 格扫描', () => {
    // (13,20) 传送器 frameX 54（右列，%54=0 → baseX=13）；上方 (14,19) 放模特 470 → 拦
    const mannequin = sheetId(470);
    const st = fakeDrillStore([], {}, 40, 40, { '13,20': [54, 0] },
      { '13,20': TELEPORTER_ID, '14,19': mannequin });
    expect(canKillTileAt(st, 13, 20)).toBe(false);
    // 上方 3 格外（(17,19)，超出 baseX+2）→ 不拦
    const far = fakeDrillStore([], {}, 40, 40, { '13,20': [54, 0] },
      { '13,20': TELEPORTER_ID, '17,19': mannequin });
    expect(canKillTileAt(far, 13, 20)).toBe(true);
    // 同型自身顶行不拦（ignoreType 门 :62493）
    const self = fakeDrillStore([], {}, 40, 40, { '13,20': [54, 0] },
      { '13,20': TELEPORTER_ID, '13,19': TELEPORTER_ID });
    expect(canKillTileAt(self, 13, 20)).toBe(true);
  });

  it('容器内容门（case 21/467/88 :62345-62356）：CanDestroyChest——有物不可杀', () => {
    // 宝箱 frameX 18（右列，/18=1，%2=1 → 锚 x=12）；frameY 18（底行 → 锚 y=19）
    const frames: Record<string, [number, number]> = { '13,20': [18, 18] };
    const types: Record<string, number> = { '13,20': CHEST_ID };
    const st = fakeDrillStore([], {}, 40, 40, frames, types);
    // 无 ctx（坡面平滑链）→ 最宽近似可杀
    expect(canKillTileAt(st, 13, 20)).toBe(true);
    // 锚格 (12,19) 有内容 → 不可杀
    expect(canKillTileAt(st, 13, 20, mkCtx([[12, 19]]))).toBe(false);
    // 内容在别的锚 → 可杀
    expect(canKillTileAt(st, 13, 20, mkCtx([[13, 19]]))).toBe(true);
    // 梳妆台 88：%3 归一（frameX 36 → /18=2，%3=2 → 锚 x=11）
    const df: Record<string, [number, number]> = { '13,20': [36, 18] };
    const dt: Record<string, number> = { '13,20': DRESSER_ID };
    const dst = fakeDrillStore([], {}, 40, 40, df, dt);
    expect(canKillTileAt(dst, 13, 20, mkCtx([[11, 19]]))).toBe(false);
    expect(canKillTileAt(dst, 13, 20, mkCtx([[12, 19]]))).toBe(true);
  });
});

describe('钻头边缘②：Tile.SmoothSlope 命中钩（Tile.cs:822-895）', () => {
  it('四邻实心位形推导：下+左 → slope1 / 仅下 → 半砖（num 位序 :841）', () => {
    // (5,5) 左 (4,5) 与下 (5,6) 实心 → num=6 → slope 1
    const st = fakeSlopeStore([[5, 5], [4, 5], [5, 6]]);
    smoothSlopeAt(st, 5, 5);
    expect(st.slope[st.idx(5, 5)]).toBe(1);
    expect(st.half[st.idx(5, 5)]).toBe(0);
    // 仅下方实心 → num=4 → 半砖
    const st2 = fakeSlopeStore([[5, 5], [5, 6]]);
    smoothSlopeAt(st2, 5, 5);
    expect(st2.half[st2.idx(5, 5)]).toBe(1);
  });

  it('applyToNeighbors=true：四邻（右/左/下/上 序）与自身均被平滑（:824-830）', () => {
    // 竖列 (5,4)→(5,6)：对 (5,4) 平滑 → 自身（上空下实 num=4）半砖；邻格 (5,5)
    // 上下皆实（num=12 → default）维持整砖——原版位形语义
    const st = fakeSlopeStore([[5, 4], [5, 5], [5, 6]]);
    smoothSlopeAt(st, 5, 4);
    expect(st.half[st.idx(5, 4)]).toBe(1);   // 自身（下有 (5,5)）
    expect(st.half[st.idx(5, 5)]).toBe(0);   // 邻格上下皆实 → 整砖
    expect(st.slope[st.idx(5, 5)]).toBe(0);
  });

  it('CanPoundTile 门：黑名单/巨石/上格禁坡物 → 不动（:81448-81480）', () => {
    // 门（sheet 10）在黑名单 → 平滑无效
    const doorId = TILE_DEFS.findIndex((d) => d.vanilla?.sheet === 10);
    const st = fakeSlopeStore([[5, 5]], 12, 12, {}, { '5,5': doorId });
    smoothSlopeAt(st, 5, 5);
    expect(st.slope[st.idx(5, 5)]).toBe(0);
    expect(st.half[st.idx(5, 5)]).toBe(0);
    // 上格为宝箱（sheet 21，ForbidsSloping）→ 不可砸
    const chestId = TILE_DEFS.findIndex((d) => d.vanilla?.sheet === 21);
    const st2 = fakeSlopeStore([[5, 5], [5, 6]], 12, 12, {}, { '5,4': chestId });
    smoothSlopeAt(st2, 5, 5);
    expect(st2.half[st2.idx(5, 5)]).toBe(0);
  });
});

describe('渲染装饰：机身倾斜 fullRotation（Mount.cs Hover 尾段 :3468-3521）', () => {
  it('UFO 7 / 钻头 8：π/4 × clamp(vx/dash, ±0.95) / 2', () => {
    expect(bodyRotationFor(7, 8, 0, 1, 8)).toBeCloseTo(Math.PI / 4 * 0.95 / 2);   // 满速钳 0.95
    expect(bodyRotationFor(7, 4, 0, 1, 8)).toBeCloseTo(Math.PI / 4 * 0.5 / 2);    // 半速
    expect(bodyRotationFor(8, -4, 0, -1, 4)).toBeCloseTo(-Math.PI / 4 * 0.95 / 2); // 钻头满速反向
    expect(bodyRotationFor(5, 8, 0, 1, 2)).toBe(0);                               // 其余坐骑不倾
  });

  it('巫婆扫帚 23：-π/16×clamp(-vy/dash)×dir + π/16×clamp(vx/dash)', () => {
    // 满速爬升（vy=-9）面右 → -π/16；满速右移 → +π/16；合成 0
    expect(bodyRotationFor(23, 0, -9, 1, 9)).toBeCloseTo(-Math.PI / 16);
    expect(bodyRotationFor(23, 9, 0, 1, 9)).toBeCloseTo(Math.PI / 16);
    expect(bodyRotationFor(23, 9, -9, 1, 9)).toBeCloseTo(0);
  });

  it('MountInstance.updateBodyRotation：fullRotation 写入 + 钻头外环随 vx/80 累积（:3499）', () => {
    const m = new MountInstance();
    m.setMount(8, view());
    const v = view({ vx: 4, vy: 0 });
    m.updateBodyRotation(v);
    expect(m.fullRotation).toBeCloseTo(Math.PI / 4 * 0.95 / 2);   // 4/4=1 → 钳 0.95
    expect(m.outerRingRotation).toBeCloseTo(4 / 80);
    m.updateBodyRotation(v);
    expect(m.outerRingRotation).toBeCloseTo(8 / 80);              // 累积（曾恒 0 的死字段）
    // UFO 满速
    const ufo = new MountInstance();
    ufo.setMount(7, view());
    ufo.updateBodyRotation(view({ vx: 8, vy: 0 }));
    expect(ufo.fullRotation).toBeCloseTo(Math.PI / 4 * 0.95 / 2);
  });

  it('玩家本体旋转变换：UFO 7/钻头 8 绕 mounted 盒心、扫帚 23 绕底心（TransformDrawData）', () => {
    // LegacyPlayerRenderer.cs:481 把 fullRotation/fullRotationOrigin 整组传入 PlayerDrawSet，
    // TransformDrawData（PlayerDrawLayers.cs:4199-4230）绕 Position+origin 旋转全部层。
    // 玩家盒 (100,200,20,42)：7/8 heightBoost=16 → mounted 盒高 58 底锚
    //   → 盒心 = (110, 200+42-29=213)；23 heightBoost=0 → 底心 = (110, 242)
    const box = { x: 100, y: 200, w: 20, h: 42 };
    const r78 = playerMountRotation(7, 0.3, box, 16)!;
    expect(r78.pivotX).toBe(110);
    expect(r78.pivotY).toBe(213);
    expect(r78.angle).toBe(0.3);
    expect(playerMountRotation(8, -0.2, box, 16)!.pivotY).toBe(213);
    const r23 = playerMountRotation(23, 0.1, box, 0)!;
    expect(r23.pivotX).toBe(110);
    expect(r23.pivotY).toBe(242);
    expect(r23.angle).toBe(0.1);
  });

  it('玩家本体旋转变换：零角/非倾斜族 → null（矿车族走 cart.rotation 独立链）', () => {
    const box = { x: 100, y: 200, w: 20, h: 42 };
    expect(playerMountRotation(7, 0, box, 16)).toBeNull();     // 静止悬停不转
    expect(playerMountRotation(5, 0.5, box, 0)).toBeNull();    // 非倾斜族
    expect(playerMountRotation(8, 0, box, 16)).toBeNull();
    expect(playerMountRotation(23, 0, box, 0)).toBeNull();
  });

  it('玩家本体旋转变换：端到端角度 = bodyRotationFor 产出直通', () => {
    // 满速 UFO：π/4×0.95/2；角度由 Mounts.fullRotation 透传（渲染侧不重算）
    const box = { x: 0, y: 0, w: 20, h: 42 };
    const m = new MountInstance();
    m.setMount(7, view());
    m.updateBodyRotation(view({ vx: 8, vy: 0 }));
    const r = playerMountRotation(m.type, m.fullRotation, box, m.heightBoost)!;
    expect(r.angle).toBeCloseTo(Math.PI / 4 * 0.95 / 2);
    expect(r.pivotY).toBeCloseTo(42 - 29);   // 42+16=58 → 盒心 y=42-29
  });
});

describe('坐骑贴图行锚 Y（mountTextureAnchorY——Mount.Draw :5596-5599 净式，PlayerOffset 两处相消）', () => {
  // 原版链：PlayerDrawSet.cs:429-430 先 `Position.Y -= mountOffSet`
  // （mountOffSet = mount.PlayerOffset = playerYOffsets[帧]），Mount.Draw 再
  // `Position.Y += height/2 + (YOffset + PlayerOffset)` → 两处 PlayerOffset 相消，
  // 净锚 = mounted 盒中心 + YOffset，【与帧无关】（史莱姆挤压动画在贴图行内完成，
  // 坐骑贴图不随帧浮动；随帧浮动的是玩家精灵 = 骑姿抬升 −mOff）。
  // 本仓曾直抄 num2 字面 +PlayerOffset 而漏 PlayerDrawSet:430 预减 → 史莱姆坐骑
  // 整贴图下坠 20-22px：史莱姆半埋地里、鞍位错到玩家脚踝（用户实报 2026-09-17）。
  const feetY = 442;   // p.y=400 + p.h=42（本仓玩家盒恒 42，底锚换算）
  it('史莱姆 3（hB=20,yOff=11）：锚 = feetY−31+11 = feetY−20，四帧恒定（贴图不随帧浮动）', () => {
    expect(mountTextureAnchorY(feetY, 20, 11)).toBe(422);       // 442 − 31 + 11
    // 帧无关签名（结构性）：入参只有 feetY/hB/yOff，锚【不存在】帧入参可吃；
    // 消费端（Renderer.drawMountLayer）不得再混入 mnt.playerOffset——
    // 史莱姆 playerYOffsets=[20,22,20,18] 全非零（实时数据核对），回归即 20px 级可见
    const slime = MOUNT_DATA['3'];
    expect(slime.playerYOffsets).toEqual([20, 22, 20, 18]);
    expect(slime.playerYOffsets!.every((po) => po !== 0)).toBe(true);
    expect(mountTextureAnchorY(feetY, slime.heightBoost, slime.yOffset)).toBe(422);
  });
  it('原版锚表抽查：兔 1 / UFO 7 / 钻头 8（vanilla-mounts.json hB/yOff 直读）', () => {
    expect(mountTextureAnchorY(feetY, 20, 4)).toBe(415);   // 兔 1：442−31+4
    expect(mountTextureAnchorY(feetY, 16, 4)).toBe(417);   // UFO 7 / 钻头 8：442−29+4
  });
  it('缺表回退：hB/yOff undefined → 0（feetY−21）', () => {
    expect(mountTextureAnchorY(feetY, undefined, undefined)).toBe(421);
  });
});

describe('渲染装饰：坐骑点光（Mount.cs AddLight 汇总）——mock 注入器', () => {
  const collect = (m: MountInstance, v: MountedPlayerView,
    over: Partial<Parameters<typeof mountLights>[2]> = {}) => {
    const sink: Array<[number, number, number, number, number]> = [];
    for (const l of mountLights(m, v, {
      liquidColor: [9, 61, 191], worldSurface: 72, miscCounter: 0, ...over,
    })) sink.push([l.tx, l.ty, l.r, l.g, l.b]);
    return sink;
  };

  it('emitsLight 族（8/45/49）：lightColor 于中心格（:3614-3617）', () => {
    const m = new MountInstance();
    m.setMount(8, view());
    expect(collect(m, view())).toEqual([[6, 7, 0.3, 0.3, 0.4]]);
    const l45 = new MountInstance();
    l45.setMount(45, view());
    expect(collect(l45, view())).toEqual([[6, 7, 0.6, 0.4, 0.35]]);
  });

  it('UFO 7：帧脉冲橙光 g = 0.2×|2-帧/2|/2（:3481）', () => {
    const m = new MountInstance();
    m.setMount(7, view());
    m.frame = 0;
    expect(collect(m, view())[0]).toEqual([6, 7, 0.4, 0.2, 0]);
    m.frame = 4;
    expect(collect(m, view())[0]).toEqual([6, 7, 0.4, 0, 0]);
  });

  it('Scutlix 9：瞄准+充能 → 眼部红光 ×充能比（:5411）；Santank 46 炮口 (0.7,0.4,0.4)×2（:5456）', () => {
    const m = new MountInstance();
    m.setMount(9, view());
    m.aiming = true;
    m.abilityCharge = 20;                 // max 40 → 0.5
    m.frameExtra = 8;                     // → 眼对 (8-6)*2=4/5
    const lights = collect(m, view());
    expect(lights).toHaveLength(2);
    for (const l of lights) {
      expect(l[2]).toBeCloseTo(0.5);      // r = 1 × charge
      expect(l[3]).toBe(0);
      expect(l[4]).toBe(0);
    }
    // 未瞄准 → 无光
    m.aiming = false;
    expect(collect(m, view())).toHaveLength(0);
    const tank = new MountInstance();
    tank.setMount(46, view());
    tank.aiming = true;
    tank.abilityCharge = 40;
    // 炮口 = 底心 + (width×dir, -12) = (100+10+20, 100+42-12) → 格 (8,8)，双点累加
    expect(collect(tank, view())).toEqual([[8, 8, 0.7, 0.4, 0.4], [8, 8, 0.7, 0.4, 0.4]]);
  });

  it('猪鲨崽 12：增益态 → 环境液色×0.4 于身前点；落点实心退回身侧（:4981-4991）', () => {
    const m = new MountInstance();
    m.setMount(12, view({ x: 100, y: 100, vx: 0, vy: 0 }));
    m.fishronBoost = true;
    const approx = (l: Array<[number, number, number, number, number]>) =>
      l.map(([tx, ty, r, g, b]) => [tx, ty, +r.toFixed(6), +g.toFixed(6), +b.toFixed(6)]);
    // 空中全速右移：身前点 = 中心 + dir×20 + v×10 = (130+160, 121) → 格 (18,7)
    expect(approx(collect(m, view({ x: 100, y: 100, vx: 16, vy: 0 })))).toEqual(
      [[18, 7, +((9 / 255 * 0.4)).toFixed(6), +((61 / 255 * 0.4)).toFixed(6), +((191 / 255 * 0.4)).toFixed(6)]]);
    // 身前点实心 → 退回身侧 (130,121) → 格 (8,7)
    const base = fakeDrillStore([[18, 7]]);
    const flags = new Uint8Array(40 * 40);
    flags[base.idx(18, 7)] = 1;
    const solidView = {
      inBounds: base.inBounds, idx: base.idx, flags, type: base.type,
      isSolid: (x: number, y: number) => base.isActive(x, y),
    } as never;
    const withStore = view({ x: 100, y: 100, vx: 16, vy: 0, store: solidView });
    expect(approx(collect(m, withStore))[0].slice(0, 2)).toEqual([8, 7]);
    // 非增益态无光
    m.fishronBoost = false;
    expect(collect(m, view({ x: 100, y: 100 }))).toHaveLength(0);
  });

  it('猪鲨崽落点门 = WorldGen.SolidTile（:4984→cs:70155）：半砖/坡面/平台不算实心', () => {
    // WorldGen.SolidTile = active && tileSolid && !tileSolidTop && !half && slope==0
    // && !inActive——落点是半砖/坡面/平台时【不退回身侧】（光落在原格）
    const base = fakeDrillStore([[18, 7]]);
    const flags = new Uint8Array(40 * 40);
    flags[base.idx(18, 7)] = 1;
    const mkStore = (over: { half?: number; slope?: number; type?: number }) => ({
      inBounds: base.inBounds, idx: base.idx, flags,
      type: (() => { const t = new Uint16Array(40 * 40); t[base.idx(18, 7)] = over.type ?? 1; return t; })(),
      half: (() => { const h = new Uint8Array(40 * 40); h[base.idx(18, 7)] = over.half ?? 0; return h; })(),
      slope: (() => { const s = new Uint8Array(40 * 40); s[base.idx(18, 7)] = over.slope ?? 0; return s; })(),
      isSolid: (x: number, y: number) => base.isActive(x, y),
    } as never);
    const m = new MountInstance();
    m.setMount(12, view({ x: 100, y: 100 }));
    m.fishronBoost = true;
    const lightAt = (st: unknown) => {
      const ls = collect(m, view({ x: 100, y: 100, vx: 16, vy: 0, store: st as never }));
      return [ls[0][0], ls[0][1]];
    };
    // 整砖实心 → 退回身侧 (8,7)
    expect(lightAt(mkStore({}))).toEqual([8, 7]);
    // 半砖 → SolidTile false → 光落身前点 (18,7)
    expect(lightAt(mkStore({ half: 1 }))).toEqual([18, 7]);
    // 坡面 1-4 → 全部不算实心
    for (const s of [1, 2, 3, 4]) expect(lightAt(mkStore({ slope: s }))).toEqual([18, 7]);
    // 平台（内部 id 查 TILE_DEFS：platform tile）→ tileSolidTop 排除
    const platId = TILE_DEFS.findIndex((d) => d.platform);
    expect(platId).toBeGreaterThan(0);
    expect(lightAt(mkStore({ type: platId }))).toEqual([18, 7]);
  });

  it('蜥蜴 14：worldSurface 以下红光 (0.5,0.1,0.1)（:4079）', () => {
    const m = new MountInstance();
    m.setMount(14, view());
    // 中心 y = 5000+21 = 5021 → 格 313
    expect(collect(m, view({ x: 100, y: 5000 }))).toEqual([[6, 313, 0.5, 0.1, 0.1]]);
    expect(collect(m, view({ x: 100, y: 100 }))).toHaveLength(0);
  });
});

describe('Scutlix 眼激光 606 实体化（MountShot：直线/子步/命中消散）', () => {
  const shotHooks = (solid: Array<[number, number]> = [], enemies: unknown[] = []) => {
    const base = fakeDrillStore(solid);
    const st = { ...base, isSolid: (x: number, y: number) => base.isActive(x, y) };
    const dmg: number[] = [];
    return {
      hooks: {
        world: { store: st },
        enemies: () => enemies,
        addDamageNumber: (_x: number, _y: number, n: number) => dmg.push(n),
        playSfxFiles: () => {},
        playSfx: () => {},
      } as never,
      dmg, st,
    };
  };

  it('extraUpdates 2 → 每 tick 3 子步（42px/tick），直线无重力（606：aiStyle 1 直飞弹）', () => {
    const { hooks } = shotHooks();
    const s = new MountShot(0, 0, 14, 0, 150, 0, 606);
    expect(s.w).toBe(5);                       // proj 表 width 5
    s.fixedUpdate(1 / 60, hooks);
    expect(s.x).toBeCloseTo(42);               // 14 × 3 子步
    expect(s.vy).toBe(0);                      // noGravity
    expect(s.dead).toBe(false);
  });

  it('命中实心格即消散；命中敌怪结算伤害并消散（penetrate 1 近似）', () => {
    // 格 2 实心（32-48px）：第 1 tick 第 3 子步 x=42 → 中心 44.5/16 → 格 2 即撞
    const { hooks } = shotHooks([[2, 0]]);
    const s = new MountShot(0, 0, 14, 0, 150, 0, 606);
    s.fixedUpdate(1 / 60, hooks);
    expect(s.dead).toBe(true);
    // 敌怪
    const hit: number[] = [];
    const enemy = {
      x: 44, y: -4, w: 20, h: 20, dead: false,
      hurt: (d: number) => { hit.push(d); return true; },
    };
    const { hooks: hooks2 } = shotHooks([], [enemy]);
    const s2 = new MountShot(0, 0, 14, 0, 150, 0, 606);
    s2.fixedUpdate(1 / 60, hooks2);
    expect(s2.dead).toBe(true);
    expect(hit).toEqual([150]);
  });

  it('Santank 炮击 930 重力抛物线（noGravity: false → vy 累加 0.3/tick，1 子步）', () => {
    const { hooks } = shotHooks();
    const s = new MountShot(0, 0, 0, -4, 120, 0, 930, { noGravity: false });
    s.fixedUpdate(1 / 60, hooks);
    expect(s.vy).toBeCloseTo(-4 + 0.3);   // 930 无 extraUpdates → 单子步
  });
});

describe('Santank 46：专属炮击节拍（UpdateEffects :4919-4921 cooldown%10）', () => {
  it('SetMount 预热 40 + 冷却 %10==0 开火：40 拍开、31-39 充能、30 再开', () => {
    const m = new MountInstance();
    m.setMount(46, view());
    expect(m.abilityCooldown).toBe(40);
    const target = { x: 300, y: 100, w: 20, h: 40 };
    const fired: string[] = [];
    const fire = (_k: 'cannon' | 'bullet') => fired.push(_k);
    const v = view({ x: 100, y: 100 });
    // 冷却 40：40%10==0 → 开火（且非 0 拍不重置冷却）
    expect(m.updateScutlix(v, target, () => {}, fire)).toBe(true);
    expect(m.abilityCooldown).toBe(40);
    m.abilityCooldown = 39;
    expect(m.updateScutlix(v, target, () => {}, fire)).toBe(false);
    expect(m.abilityCharging).toBe(true);
    m.abilityCooldown = 30;
    expect(m.updateScutlix(v, target, () => {}, fire)).toBe(true);
    // 归零拍：先停充（冷却重置 40）再开火
    m.abilityCooldown = 0;
    expect(m.updateScutlix(v, target, () => {}, fire)).toBe(true);
    expect(m.abilityCooldown).toBe(40);
    expect(m.abilityCharging).toBe(false);
  });

  it('fireSantank：冷却 ≤10 伴生炮击 + 恒发子弹（UseAbility case 46 :3256-3280）', () => {
    const m = new MountInstance();
    m.setMount(46, view());
    const shots: Array<{ kind: string; vy: number; vyNeg: boolean }> = [];
    const v = view({ x: 100, y: 100 });
    m.abilityCooldown = 5;      // ≤10 → 双弹
    m.fireSantank(v, 300, 100, (kind, _x, _y, _vx, vy) => shots.push({ kind, vy, vyNeg: vy < 0 }));
    expect(shots.map((s) => s.kind).sort()).toEqual(['bullet', 'cannon']);
    expect(shots.find((s) => s.kind === 'cannon')!.vyNeg).toBe(true);   // (0,-4) 上抛
    shots.length = 0;
    m.abilityCooldown = 20;     // >10 → 仅子弹
    m.fireSantank(v, 300, 100, (kind) => shots.push({ kind, vy: 0, vyNeg: false }));
    expect(shots.map((s) => s.kind)).toEqual(['bullet']);
  });

  it('AllowDirectionChange：Scutlix 冷却过半才许改向 / Santank 恒许（:604-614）', () => {
    const m = new MountInstance();
    m.setMount(9, view());
    m.abilityCooldown = 15;
    expect(m.allowDirectionChange).toBe(false);   // 15 ≥ 20/2
    m.abilityCooldown = 9;
    expect(m.allowDirectionChange).toBe(true);    // <10
    const tank = new MountInstance();
    tank.setMount(46, view());
    tank.aiming = true;
    expect(tank.allowDirectionChange).toBe(true);
  });

  it('aimScutlix 不写 Santank frameExtra（case 46 无眼帧分档 :5420-5464——腿部帧自驱）', () => {
    const tank = new MountInstance();
    tank.setMount(46, view({ x: 0, y: 0 }));
    tank.frameExtra = 25;                         // 瞄准中腿部帧 24-26
    tank.aimScutlix(view({ x: 0, y: 0, w: 20, h: 42 }), 300, 21);
    expect(tank.frameExtra).toBe(25);             // 不被眼帧 6-10 覆写
    expect(tank.aiming).toBe(true);
    const scut = new MountInstance();
    scut.setMount(9, view());
    scut.aimScutlix(view({ x: 0, y: 0, w: 20, h: 42 }), 300, 21);
    expect(scut.frameExtra).toBe(8);              // Scutlix 仍按角度分档
  });
});

// ---- X2① QuickMinecartSnap（Player.cs:6140-6176；唯一消费位 QuickMount 物品支 :6075）----
// 候选规则判别：GetTilesIn 列序（x 外层升序）± oldStyleParkour 首枚免视线臂 + 最近
// 且 CanHitLine 替换门。世界高 140（clampYTile 上界 maxTilesY-40=100 在候选行之上，
// 排除钳制掺入）。玩家盒 [480..500]×[926..968] → 扫描窗 ±24px = 列 28..32 行 56..62。
const TRACK = TILE_BY_KEY['v_314_minecart_track']!;
expect(TRACK).toBeGreaterThanOrEqual(0);
const iidOf = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

function snapShell(rails: Array<[number, number]>, blockers: Array<[number, number]> = [],
  parkourBook = false) {
  const w = new World(64, 140, 42, 'snap');
  const st = w.store;
  for (const [x, y] of rails) { placeTrack(st, x, y, 0); frameTrackArea(st, x, y); }
  for (const [x, y] of blockers) st.setTileSilent(x, y, 1);     // 内部 id 1=泥土
  const p = new Player(480, 926, new Inventory());
  const g = Object.create(Game.prototype) as Record<string, unknown> & {
    quickMinecartSnap(): boolean; mountMinecartAt(x: number, y: number, m: number): boolean;
  };
  g.world = w;
  g.player = p;
  g.trackTile = TRACK;
  g.minecart = null;
  g.entities = { add: vi.fn() };
  g.playSfxFile = vi.fn();
  if (parkourBook) p.inv.slots[5] = { id: iidOf(6190), stack: 1 };   // equipStats 实时 getter
  const spy = vi.spyOn(g, 'mountMinecartAt');                        // 默认透传真身
  return { w, p, g, spy };
}

describe('X2① QuickMinecartSnap（Player.cs:6140-6176 oldStyleParkour 臂 + :6075 消费位）', () => {
  it('无跑酷指南：视线可达双轨取最近吸附，result=true 并上车', () => {
    const { g, spy } = snapShell([[31, 60], [32, 60]]);            // 距心 25.2 < 36.6 → (31,60)
    expect(g.quickMinecartSnap()).toBe(true);
    expect(spy.mock.calls.length).toBe(1);
    expect(spy.mock.calls[0][0]).toBe(31);
    expect(spy.mock.calls[0][1]).toBe(60);
    expect(g.minecart).not.toBeNull();                             // LaunchMinecartHook 等价收敛=即时上车
    expect((g.player as unknown as { ridingCart: boolean }).ridingCart).toBe(true);
  });

  it('无跑酷指南：全候选被实心隔断视线 → result=false 零接管（:6160 CanHitLine 门）', () => {
    // 环形实心封死扫描窗内全部射线（除两枚轨道格自身）
    const blockers: Array<[number, number]> = [];
    for (let x = 27; x <= 33; x++) for (let y = 55; y <= 63; y++) blockers.push([x, y]);
    const { g, spy } = snapShell([[31, 60], [32, 60]],
      blockers.filter(([x, y]) => !(y === 60 && (x === 31 || x === 32))));
    expect(g.quickMinecartSnap()).toBe(false);
    expect(spy.mock.calls.length).toBe(0);
    expect(g.minecart).toBeNull();
  });

  it('★oldStyleParkour 臂：首枚轨道格【免视线】直入候选——同一堵死布局翻转为命中', () => {
    const blockers: Array<[number, number]> = [];
    for (let x = 27; x <= 33; x++) for (let y = 55; y <= 63; y++) blockers.push([x, y]);
    const rails: Array<[number, number]> = [[31, 60], [32, 60]];
    const keep = new Set(rails.map(([x, y]) => `${x},${y}`));
    const { g, spy } = snapShell(rails,
      blockers.filter(([x, y]) => !keep.has(`${x},${y}`)), true);
    // 判据 = 候选选择面 + result 语义解耦钉死：候选命中恒 true（vanilla result 不看
    // 403 挂载终局——环堵布局下车位被围实心 → mountMinecartAt 拒载,但 flag 仍吃掉
    // 本拍 SetMount：原版此时留悬钩待松手,本仓空手拍=登记偏差）。与无书例成对差分：
    // B=零候选零接管 / 此处=候选必中（:6155-6157 无条件臂）。
    expect(g.quickMinecartSnap()).toBe(true);
    expect(spy.mock.calls.length).toBe(1);
    expect(spy.mock.calls[0][0]).toBe(31);                         // GetTilesIn 列序首个（x 外层升序）
    expect(spy.mock.calls[0][1]).toBe(60);
    expect(g.minecart).toBeNull();                                 // 塌缩收敛在拒载分支收尾
  });

  it('oldStyleParkour 次序锚：更近但后扫者无视线【不得】替换先扫免视候选', () => {
    const blockers: Array<[number, number]> = [];
    for (let x = 27; x <= 33; x++) for (let y = 55; y <= 63; y++) blockers.push([x, y]);
    const rails: Array<[number, number]> = [[28, 56], [31, 60]];   // 先扫 (28,56) 远 / 后扫 (31,60) 近
    const keep = new Set(rails.map(([x, y]) => `${x},${y}`));
    const { g, spy } = snapShell(rails,
      blockers.filter(([x, y]) => !keep.has(`${x},${y}`)), true);
    expect(g.quickMinecartSnap()).toBe(true);                       // 候选命中恒接管（result 不随挂载成败）
    expect(spy.mock.calls.length).toBe(1);
    expect(spy.mock.calls[0][0]).toBe(28);                          // 首枚锁死（CanHitLine 全断无法替换）
    expect(spy.mock.calls[0][1]).toBe(56);
  });
});

// ★BJ167 骑乘态逐层清单（原版零多余绘制）：Mount.Draw（:5560-5622）逐层各画
//   各的贴图——`texture2D == null → return`（:5620-5622），Asset<Texture2D>.Empty
//   （Value=null）层零绘制；调用点 PlayerDrawLayers.cs:225-226（背 0/背Extra 1，
//   玩家前）、:3016/:3030（前 2/前Extra 3，玩家后）。史莱姆鞍 3 四贴图仅 back
//   非空（Mount.cs:910-913）→ 原版骑乘视觉 = 背层 Mount_Slime 贴图 + 玩家本体，
//   front 层零绘制。本仓 drawMountLayer 的近似胶囊（色块体+头两椭圆）只允许兜底
//   "整只坐骑无任何贴图可得"；曾对 front Empty 层照画 → 一大一小两颗
//   mountFallbackColor[3]=#4080FF 蓝椭圆叠在真贴图与玩家上（用户实报残留两椭圆）。
describe('骑乘态逐层清单（drawMountLayer——BJ167 front Empty 层零绘制,胶囊只兜底无贴图坐骑）', () => {
  type Op = { op: string; a: unknown[]; fillStyle?: string };
  const recCtx = () => {
    const ops: Op[] = [];
    const ctx = {
      save() { ops.push({ op: 'save', a: [] }); },
      restore() { ops.push({ op: 'restore', a: [] }); },
      translate(...a: unknown[]) { ops.push({ op: 'translate', a }); },
      rotate(...a: unknown[]) { ops.push({ op: 'rotate', a }); },
      scale(...a: unknown[]) { ops.push({ op: 'scale', a }); },
      beginPath() { ops.push({ op: 'beginPath', a: [] }); },
      fill() { ops.push({ op: 'fill', a: [], fillStyle: (ctx as { fillStyle?: string }).fillStyle }); },
      ellipse(...a: unknown[]) { ops.push({ op: 'ellipse', a, fillStyle: (ctx as { fillStyle?: string }).fillStyle }); },
      fillRect(...a: unknown[]) { ops.push({ op: 'fillRect', a, fillStyle: (ctx as { fillStyle?: string }).fillStyle }); },
      drawImage(img: { tag?: string; width?: number }, ...a: unknown[]) {
        ops.push({ op: 'drawImage', a: [img.tag ?? '', ...a] });
      },
      globalAlpha: 1,
      fillStyle: '' as string | CanvasGradient | CanvasPattern,
    };
    return { ctx, ops };
  };
  // 背层贴图可控的假图集：loads=false 模拟"整只坐骑无任何贴图可得"（缺表/加载失败）
  const SERVED = ['vanilla/Mount_Slime.png', 'vanilla/Mount_Turtle.png'];
  const fakeAtlas = (loads: boolean) => ({
    ensureVImage: (file: string) =>
      loads && SERVED.includes(file) ? { width: 100, height: 288, tag: file } : null,
  });
  const fakePlayer = {
    x: 100, y: 400, w: 20, h: 42, facing: 1,
    petting: { isPetting: false, mount: false },
  };
  const fakeMount = (over: Record<string, unknown> = {}) => ({
    type: 3, frame: 0, frameExtra: 0, playerOffset: 20, heightBoost: 20,
    textures: { back: 'vanilla/Mount_Slime.png' },
    data: MOUNT_DATA['3'],
    ...over,
  });
  const drawLayer = (stub: unknown, ctx: CanvasRenderingContext2D, mnt: unknown, layer: 'back' | 'front') => {
    (Renderer.prototype as unknown as {
      drawMountLayer: (c: CanvasRenderingContext2D, p: unknown, m: unknown, l: 'back' | 'front', ws?: number) => void;
    }).drawMountLayer.call(stub, ctx, fakePlayer, mnt, layer, 0);
  };

  it('原版逐层清单：史莱姆鞍 3 骑乘 = 背层贴图恰 1 绘 + front 层零绘制（零椭圆）', () => {
    const stub = { atlas: fakeAtlas(true), lighting: null } as unknown as Renderer;
    // 背层（玩家后）：Mount_Slime 帧行恰 1 次 drawImage，无任何椭圆
    const back = recCtx();
    drawLayer(stub, back.ctx as unknown as CanvasRenderingContext2D, fakeMount(), 'back');
    expect(back.ops.filter((o) => o.op === 'drawImage')).toHaveLength(1);
    expect(back.ops.some((o) => o.op === 'ellipse')).toBe(false);
    // front 层（玩家前）：frontTexture=Asset.Empty → 零绘制（曾在此画胶囊两椭圆）
    const front = recCtx();
    drawLayer(stub, front.ctx as unknown as CanvasRenderingContext2D, fakeMount(), 'front');
    expect(front.ops.some((o) => o.op === 'ellipse' || o.op === 'fill')).toBe(false);
    expect(front.ops.filter((o) => o.op === 'drawImage')).toHaveLength(0);
  });

  it('兜底语义保留：整只坐骑无任何贴图可得（ensureVImage null）→ 近似胶囊两椭圆', () => {
    const stub = { atlas: fakeAtlas(false), lighting: null } as unknown as Renderer;
    const front = recCtx();
    drawLayer(stub, front.ctx as unknown as CanvasRenderingContext2D, fakeMount(), 'front');
    const ells = front.ops.filter((o) => o.op === 'ellipse');
    expect(ells).toHaveLength(2);                                  // 大身体 + 小头
    expect(ells.every((o) => o.fillStyle === mountFallbackColor(3))).toBe(true);
    expect(mountFallbackColor(3)).toBe('#4080FF');                 // 用户实报"蓝色"
    // 背层缺图也不画胶囊（近似体单层，front 层承担）
    const back = recCtx();
    drawLayer(stub, back.ctx as unknown as CanvasRenderingContext2D, fakeMount(), 'back');
    expect(back.ops.some((o) => o.op === 'ellipse' || o.op === 'drawImage')).toBe(false);
  });

  it('同族回归（back-only 22 座）：龟 4 背贴图已得 → front 层同样零绘制', () => {
    const stub = { atlas: fakeAtlas(true), lighting: null } as unknown as Renderer;
    const turtle = fakeMount({
      type: 4, textures: { back: 'vanilla/Mount_Turtle.png' }, data: MOUNT_DATA['4'],
    });
    const front = recCtx();
    drawLayer(stub, front.ctx as unknown as CanvasRenderingContext2D, turtle, 'front');
    expect(front.ops.some((o) => o.op === 'ellipse' || o.op === 'fill')).toBe(false);
    expect(front.ops.filter((o) => o.op === 'drawImage')).toHaveLength(0);
  });

  it('front-only 族（矿车 6）不受门误伤：front 贴图可得 → 照常 1 绘；缺图 → 胶囊兜底', () => {
    const cart = (tex: { back?: string; front?: string }) => fakeMount({
      type: 6, textures: tex, data: MOUNT_DATA['6'],
    });
    // front 贴图加载成功：texture 路径 1 绘、无胶囊（门读的是 tex.back——矿车 back=undefined）
    const stubOk = { atlas: fakeAtlas(true), lighting: null } as unknown as Renderer;
    const okAtlas = stubOk['atlas'] as { ensureVImage: (f: string) => unknown };
    const origEnsure = okAtlas.ensureVImage;
    okAtlas.ensureVImage = (f: string) =>
      f === 'vanilla/Mount_Minecart.png' ? { width: 200, height: 40, tag: 'Mount_Minecart' } : origEnsure(f);
    const frontOk = recCtx();
    drawLayer(stubOk, frontOk.ctx as unknown as CanvasRenderingContext2D, cart({ front: 'vanilla/Mount_Minecart.png' }), 'front');
    expect(frontOk.ops.filter((o) => o.op === 'drawImage')).toHaveLength(1);
    expect(frontOk.ops.some((o) => o.op === 'ellipse')).toBe(false);
    // front 贴图缺表：back 也无 → 胶囊兜底两椭圆
    const stubMiss = { atlas: fakeAtlas(false), lighting: null } as unknown as Renderer;
    const frontMiss = recCtx();
    drawLayer(stubMiss, frontMiss.ctx as unknown as CanvasRenderingContext2D, cart({ front: 'vanilla/Mount_Minecart.png' }), 'front');
    expect(frontMiss.ops.filter((o) => o.op === 'ellipse')).toHaveLength(2);
  });
});
