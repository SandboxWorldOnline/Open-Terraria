// 矿车系统完整链测试（Minecart.ts 实体 / MinecartTrack.ts 帧族 / Game.ts 接线数据面）。
// 对照原版（Terraria 1.4.5.6 反编译）：
//   轨道帧连接     Minecart.FrameTrack/GetNearbyTilesSetLookupIndex（Minecart.cs:947-1202）
//   上下车/脱轨    Player.cs:22401（默认木质车 13）/26344-26360（onWrongGround）
//   物理           Player.cs:19530-19791（Carts 段）/27031-27037（斜坡重力停摆）
//   撞敌伤害       Player.cs:27225-27296 + GetMinecartDamage :28776-28822
//   存档           SaveFile.ts flags/frameX/frameY 往返
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TileStore } from '../src/world/TileStore';
import { World } from '../src/world/World';
import { TILE_BY_KEY } from '../src/data/tiles';
import { TILE } from '../src/core/constants';
import { ITEM_DEFS } from '../src/data/items';

import { Inventory } from '../src/items/Inventory';
import { Player } from '../src/entities/Player';
import type { GameHooks } from '../src/entities/types';
import {
  Minecart, CART_MOUNT_TEXTURES, DEFAULT_CART_TEXTURE, WOOD_CART_MOUNT,
  MOLE_CART_MOUNT, TRACK_ITEM_VID, SUPER_CART_LASER_DMG,
  superCartDefenseBonus, wheelSparkTier, cartDustKindOf, type CartLaserBeam,
} from '../src/entities/Minecart';
import { mountOfItem, isCartMount, MOUNT_DATA, MOUNT_NAMES } from '../src/entities/Mounts';
import {
  frameTrack, frameTrackArea, flipSwitchTrack, placeTrack, getOnTrack,
  trackTypeOf, trackItemId, PLAYER_DEFAULT_GRAVITY,
} from '../src/world/MinecartTrack';
import { saveGame, loadSave } from '../src/save/SaveFile';

const TRACK = TILE_BY_KEY['v_314_minecart_track'] ?? -1;
const STONE = TILE_BY_KEY['stone'] ?? -1;
expect(TRACK).toBeGreaterThanOrEqual(0);
const FLAT_H = 6;   // 平轨面高度（子段高度 5 → (8-5)*2）

// ---------------------------------------------------------------------------
// 桩与助手
// ---------------------------------------------------------------------------
interface HitCall { dmg: number; kx: number; crit: boolean }

function mkPlayer(): Player {
  return new Player(0, 0, new Inventory());
}

/** 完整 GameHooks 桩（可注入敌怪表/世界旗标） */
function mkHooks(st: TileStore, p: Player, world?: World, enemies: unknown[] = []): GameHooks {
  const w = world ?? {
    store: st,
    flags: {} as Record<string, boolean>,
    isExpert: false,
  } as unknown as World;
  return {
    world: w,
    player: p,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    playSfxFile: () => {},
    showPickupLabel: () => {},
    hitTrackSwitch: () => {},
    breakTile: (x: number, y: number) => { st.setTile(x, y, 0); },
    pickPowerEnough: () => true,
  } as unknown as GameHooks;
}

/** 手写一帧轨道 */
function seg(st: TileStore, x: number, y: number, frame: number, back = -1): void {
  st.setTile(x, y, TRACK, frame, back < 0 ? 0xFFFF : back);
}

/** 放置链（placeTrack + 邻接重定型） */
function line(st: TileStore, x0: number, y: number, n: number, style = 0): void {
  for (let k = 0; k < n; k++) {
    placeTrack(st, x0 + k, y, style);
    frameTrackArea(st, x0 + k, y);
  }
}

/** 上轨就位的骑乘矿车（GetOnTrack 吸附语义，Player.cs:22407） */
function mountedCart(st: TileStore, tx: number, ty: number, mountId = 6): {
  cart: Minecart; p: Player; game: GameHooks;
} {
  const p = mkPlayer();
  const cart = new Minecart();
  cart.mountId = mountId;
  cart.applyMountStats();
  cart.texture = CART_MOUNT_TEXTURES[mountId] ?? DEFAULT_CART_TEXTURE;
  const snap = getOnTrack(st, tx, ty, tx * TILE, ty * TILE - 40, cart.w, cart.h);
  cart.x = snap ? snap.x : tx * TILE;
  cart.y = snap ? snap.y : ty * TILE + FLAT_H - cart.h;
  cart.mounted = true;
  p.ridingCart = true;
  p.cart = cart;
  return { cart, p, game: mkHooks(st, p) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// A. 轨道帧连接规则（Minecart.cs:947-1202）
// ---------------------------------------------------------------------------
describe('轨道帧连接与邻接防护', () => {
  it('frameTrackArea 不触碰非轨道邻格（原版 FrameTrack 仅 case 314 调用）', () => {
    const st = new TileStore(30, 20);
    // 带帧的多格物件占位：石砖块 + 手写非零帧（模拟家具/门的 frameX/frameY）
    st.setTile(9, 12, STONE, 36, 72);
    st.setTile(9, 11, STONE, 18, 36);
    const b0 = { fx: st.frameX[st.idx(9, 12)], fy: st.frameY[st.idx(9, 12)] };
    const b1 = { fx: st.frameX[st.idx(9, 11)], fy: st.frameY[st.idx(9, 11)] };
    // 紧贴放置轨道（左邻即带帧石块）
    line(st, 10, 12, 3);
    expect(st.frameX[st.idx(9, 12)]).toBe(b0.fx);
    expect(st.frameY[st.idx(9, 12)]).toBe(b0.fy);
    expect(st.frameX[st.idx(9, 11)]).toBe(b1.fx);
    expect(st.frameY[st.idx(9, 11)]).toBe(b1.fy);
    // 拆除中段再次触发六邻重定型——邻块帧仍不被写
    st.setTile(11, 12, 0);
    frameTrackArea(st, 11, 12);
    expect(st.frameX[st.idx(9, 12)]).toBe(b0.fx);
    expect(st.frameY[st.idx(9, 12)]).toBe(b0.fy);
  });

  it('三连轨端盖改道：补第三格后旧墙挡端自动变平接（GetNearbyTilesSetLookupIndex）', () => {
    const st = new TileStore(30, 20);
    line(st, 10, 10, 2);
    expect(st.frameX[st.idx(11, 10)]).toBe(3);   // 右端墙挡（frame 3）
    line(st, 12, 10, 1);
    expect(st.frameX[st.idx(11, 10)]).toBe(1);   // 变中段平接
    expect(st.frameX[st.idx(12, 10)]).toBe(3);   // 新右端
  });

  it('锤击（pound）分叉成形：先补后轨、再换前轨（Minecart.cs:1079-1112 原版锤分叉语义）', () => {
    const st = new TileStore(30, 20);
    // 四个对角邻格都有轨道 → mask = 1|4|8|32 = 45，同时容纳
    // frame 8（左 TOP 右 BOTTOM，conn 33）与 frame 9（左 BOTTOM 右 TOP，conn 12）
    line(st, 10, 9, 1);
    line(st, 10, 11, 1);
    line(st, 12, 9, 1);
    line(st, 12, 11, 1);
    line(st, 11, 10, 1);
    const mid = st.idx(11, 10);
    expect(st.frameX[mid]).toBe(8);
    expect(st.frameY[mid]).toBe(0xFFFF);        // 无后轨
    // 第一锤：后轨循环先命中 → 补出后轨 9（前轨保持 8）→ 分叉成形
    expect(frameTrack(st, 11, 10, true)).toBe(true);
    expect(st.frameX[mid]).toBe(8);
    expect(st.frameY[mid]).toBe(9);
    // 第二锤：后轨循环到头（num5 越界回 -1）→ 前轨切到 9、后轨撤销
    expect(frameTrack(st, 11, 10, true)).toBe(true);
    expect(st.frameX[mid]).toBe(9);
    expect(st.frameY[mid]).toBe(0xFFFF);
  });

  it('FlipSwitchTrack 加速轨：左右向循环（Minecart.cs:1320-1324 pound 路径）', () => {
    const st = new TileStore(30, 20);
    // 三连加速轨：mask = 2|16 = 18 → 候选含 30(boostRight)/31(boostLeft)
    line(st, 10, 10, 1, 3);   // style 3 = 右加速首帧
    line(st, 11, 10, 1, 3);
    line(st, 12, 10, 1, 3);
    const mid = st.idx(11, 10);
    expect(trackTypeOf(st.frameX[mid])).toBe(2);
    const before = st.frameX[mid];
    expect(flipSwitchTrack(st, 11, 10)).toBe(true);
    expect(st.frameX[mid]).not.toBe(before);          // 换向
    expect(trackTypeOf(st.frameX[mid])).toBe(2);      // 保持加速型
    expect(flipSwitchTrack(st, 11, 10)).toBe(true);
    expect(st.frameX[mid]).toBe(before);              // 再翻回
  });
});

// ---------------------------------------------------------------------------
// B. 矿车坐骑族数据（Mount.cs mounts[n] / MountID.Sets.Cart）
// ---------------------------------------------------------------------------
describe('矿车坐骑族数据面', () => {
  it('27 种矿车坐骑全部有贴图登记（CART_MOUNT_TEXTURES = Mount.frontTexture）', () => {
    const carts = Object.keys(MOUNT_DATA)
      .map(Number)
      .filter((id) => MOUNT_DATA[String(id)]?.Minecart);
    expect(carts.length).toBe(27);
    for (const id of carts) expect(CART_MOUNT_TEXTURES[id]).toBeTruthy();
  });

  it('26 种召唤物品 → 坐骑 id 且均属 Cart 族（Item.cs DefaultToMinecart）', () => {
    const items = [2343, 3353, 4066, 4067, 4426, 4427, 4428, 4429, 4443, 4450,
      4451, 4452, 4453, 4454, 4455, 4456, 4467, 4468, 4469, 4470, 4471, 4472,
      4745, 4763, 5125, 5288];
    for (const it of items) {
      const m = mountOfItem(it);
      expect(m, `item ${it}`).toBeGreaterThanOrEqual(0);
      expect(isCartMount(m), `item ${it} -> mount ${m}`).toBe(true);
    }
  });

  it('默认矿车 = 木质车 13（Player.cs:22401 `int num4 = 13`）：参数/贴图/伤害档', () => {
    expect(WOOD_CART_MOUNT).toBe(13);
    expect(MOUNT_NAMES[String(13)]).toBe('MinecartWood');
    expect(MOUNT_DATA['13'].runSpeed).toBe(10);
    expect(MOUNT_DATA['13'].acceleration).toBe(0.03);
    expect(MOUNT_DATA['13'].jumpHeight).toBe(12);
    expect(DEFAULT_CART_TEXTURE).toBe('vanilla/Mount_MinecartWood.png');
  });

  it('逐型 hitbox：h = 42 + heightBoost（机械矿车 11 → 54，其余矿车 52）', () => {
    const c6 = new Minecart();
    c6.mountId = 6; c6.applyMountStats();
    expect(c6.h).toBe(52);
    const c11 = new Minecart();
    c11.mountId = 11; c11.applyMountStats();
    expect(c11.h).toBe(54);          // Mount.cs:1459-1465 heightBoost 12
    expect(c11.w).toBe(20);
    const c39 = new Minecart();
    c39.mountId = 39; c39.applyMountStats();   // Digging Molecart：run 6/acc 0.02
    expect(c39.runSpeed).toBe(6);
    expect(c39.acceleration).toBeCloseTo(0.02, 5);
  });
});

// ---------------------------------------------------------------------------
// C. 物理算例（Player.cs:19530-19791 / 27031-27043）
// ---------------------------------------------------------------------------
describe('矿车物理算例', () => {
  it('贴轨加速 0.04/tick，上限 maxRunSpeed 13（mounts[6]）', () => {
    const st = new TileStore(220, 30);
    line(st, 8, 12, 200);
    const { cart, p, game } = mountedCart(st, 9, 12);
    p.inputX = 1;
    for (let t = 0; t < 350; t++) cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBe(13);
    expect(cart.onTrackNow).toBe(true);
  });

  it('SuperCart 档：上限 20 / 加速 0.1（Mount.cs:371-379 + _shouldSuperCart）', () => {
    const st = new TileStore(280, 30);
    line(st, 8, 12, 260);
    const { cart, p, game } = mountedCart(st, 9, 12);
    cart.superCart = true;
    p.inputX = 1;
    for (let t = 0; t < 250; t++) cart.fixedUpdate(1 / 60, game);
    expect(cart.runSpeed).toBe(20);
    expect(cart.vx).toBe(20);
  });

  it('木质车 13：加速 0.03/tick、上限 10', () => {
    const st = new TileStore(280, 30);
    line(st, 8, 12, 260);
    const { cart, p, game } = mountedCart(st, 9, 12, 13);
    p.inputX = 1;
    cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBeCloseTo(0.03, 5);   // 首帧净加速 = acceleration
    for (let t = 0; t < 400; t++) cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBe(10);
  });

  it('贴轨反推 = runSlowdown(runAcceleration) + runAcceleration = 0.08/tick（:26357）', () => {
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const { cart, p, game } = mountedCart(st, 9, 12);
    p.inputX = -1;
    cart.fixedUpdate(1 / 60, game);   // 首帧：vx 0 → -0.04（未超 runSlowdown 不吃反推）
    expect(cart.vx).toBeCloseTo(-0.04, 5);
    cart.vx = 5;
    cart.fixedUpdate(1 / 60, game);   // 反推一帧：-(0.04 + 0.04)
    expect(cart.vx).toBeCloseTo(5 - 0.08, 5);
  });

  it('无输入 |vx|≥1 贴轨不减速；|vx|<1 落地摩擦刹停（:19731/:19764）', () => {
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const { cart, p, game } = mountedCart(st, 9, 12);
    cart.vx = 6;
    for (let t = 0; t < 30; t++) cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBeCloseTo(6, 5);          // 保持
    cart.vx = 0.5;
    cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBeCloseTo(0.5 - 0.04, 5); // 贴轨摩擦 = runAcceleration
    for (let t = 0; t < 30; t++) cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBe(0);                    // 刹停
  });

  it('加速轨道：trackBoost +4 并入后钳 ±maxRunSpeed（:27849 + :19530-19544）', () => {
    const st = new TileStore(80, 30);
    line(st, 8, 12, 2);
    seg(st, 10, 12, 30);      // boostRight
    seg(st, 11, 12, 1);
    frameTrack(st, 9, 12, false);
    const { cart, game } = mountedCart(st, 8, 12);
    cart.vx = 12;
    let boosted = false;
    for (let t = 0; t < 100 && !boosted; t++) {
      cart.fixedUpdate(1 / 60, game);
      boosted = cart.trackBoost !== 0;
    }
    expect(boosted).toBe(true);
    expect(cart.vx).toBe(12);          // 本帧只记 trackBoost，速度未变
    cart.fixedUpdate(1 / 60, game);    // 下帧并入 12+4 → 钳 13
    expect(cart.vx).toBe(13);
  });

  it('斜坡起飞：cartRampTime 窗口内重力停摆（:27031-27037）', () => {
    const st = new TileStore(60, 30);
    seg(st, 10, 10, 16);   // L=BOTTOM、子段 2-7 RAMP_END → 向右上抛
    const { cart, game } = mountedCart(st, 10, 10);
    cart.vx = 8;
    let launched = false;
    for (let t = 0; t < 40 && !launched; t++) {
      cart.fixedUpdate(1 / 60, game);
      launched = cart.cartRampTime > 0;
    }
    expect(launched).toBe(true);
    expect(cart.cartRampTime).toBe(Math.trunc(Math.min(1, 8 / 13) * 20));  // :27841
    const vyAtLaunch = cart.vy;
    const rampAtLaunch = cart.cartRampTime;
    cart.fixedUpdate(1 / 60, game);
    // 起飞窗口：重力不加（vy 保持），只递减窗口计数
    expect(cart.vy).toBeCloseTo(vyAtLaunch, 6);
    expect(cart.cartRampTime).toBe(rampAtLaunch - 1);
  });

  it('液体缩放结构：湿/蜂蜜/微光只缩放 TrackCollision 采样速度，净位移还原（:27802-27811 num108）',
    () => {
      // 原版 velocity *= num108 → TrackCollision → velocity /= num108：位置积分用还原后的
      // 速度——平轨上湿车不降速（液体只影响轨内子段采样状态机）
      const run = (liq: 'dry' | 'water' | 'honey' | 'shimmer'): number => {
        const st = new TileStore(80, 30);
        line(st, 8, 12, 40);
        const { cart, p, game } = mountedCart(st, 9, 12);
        cart.vx = 6;
        if (liq === 'water') p.inWater = true;
        if (liq === 'honey') p.inHoney = true;
        if (liq === 'shimmer') p.inShimmer = true;
        const x0 = cart.x;
        for (let t = 0; t < 20; t++) cart.fixedUpdate(1 / 60, game);
        return cart.x - x0;
      };
      const dry = run('dry');
      expect(dry).toBeGreaterThan(0);
      expect(run('water')).toBeCloseTo(dry, 5);
      expect(run('honey')).toBeCloseTo(dry, 5);
      expect(run('shimmer')).toBeCloseTo(dry, 5);
    });
});

// ---------------------------------------------------------------------------
// D. 脱轨链（Player.cs:26344-26360 onWrongGround + DryCollision + 摔伤）
// ---------------------------------------------------------------------------
describe('脱轨：落地面 / 刹车 / 下车 / 摔伤', () => {
  /** 开放端轨道（8,12)-(10,12) + 石板地面（宽地面防滑出边缘） */
  function derailWorld(floorY = 20): { st: TileStore; world: World } {
    const world = new World(70, floorY + 8, 42, 'cart-derail');
    const st = world.store;
    line(st, 8, 12, 2);
    seg(st, 10, 12, 14);   // 右开放端（L=-1,R=1）
    frameTrack(st, 9, 12, false);
    for (let x = 4; x < 66; x++) st.setTile(x, floorY, STONE);
    return { st, world };
  }

  /** 推进到稳定落地（脱轨 + vy 归零 + 已离开轨道高度层），再补一 tick 让 onWrongGround 就位 */
  function runToGround(cart: Minecart, game: GameHooks, floorY: number, maxT = 600): boolean {
    let landed = false;
    for (let t = 0; t < maxT && !landed; t++) {
      cart.fixedUpdate(1 / 60, game);
      // 需排除开放端抛出瞬间"离轨但仍在轨高"的瞬态（该帧 vy 尚未积累）
      landed = !cart.onTrackNow && cart.vy === 0 && cart.y > (12 + 2) * TILE;
    }
    if (!landed) return false;
    cart.fixedUpdate(1 / 60, game);   // 下一 tick 开头结算 onWrongGround
    return cart.onWrongGround;
  }

  it('开放端脱轨：抛出后落石板地面停住（不穿地、vy 归零）', () => {
    const { st } = derailWorld(20);
    const { cart, game } = mountedCart(st, 8, 12);
    cart.vx = 8;
    expect(runToGround(cart, game, 20)).toBe(true);
    expect(cart.mounted).toBe(true);
    expect(cart.y).toBeGreaterThan(15 * TILE);          // 已落到 y=20 附近
    expect(cart.y).toBeLessThan(20 * TILE);             // 未穿入石板
    expect(cart.vy).toBe(0);
  });

  it('脱轨落地按方向键 → 下车（:26353-26355 TryDismount）', () => {
    const { st } = derailWorld(20);
    const { cart, p, game } = mountedCart(st, 8, 12);
    cart.vx = 8;
    expect(runToGround(cart, game, 20)).toBe(true);
    const cartX = cart.x;
    p.inputX = 1;                       // 方向键按下边沿
    cart.fixedUpdate(1 / 60, game);
    expect(cart.mounted).toBe(false);
    expect(cart.dead).toBe(true);
    expect(p.ridingCart).toBe(false);
    expect(p.cart).toBeNull();
    expect(p.x).toBe(cartX);            // 玩家留在车位
  });

  it('脱轨落地无输入：按 runSlowdown 0.2 刹车至停（:19731-19750）', () => {
    const { st } = derailWorld(20);
    const { cart, game } = mountedCart(st, 8, 12);
    cart.vx = 8;
    expect(runToGround(cart, game, 20)).toBe(true);
    const v0 = cart.vx;
    expect(v0).toBeGreaterThanOrEqual(1);
    cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBeCloseTo(v0 - 0.2, 5);   // WRONG_GROUND_SLOWDOWN
    for (let t = 0; t < 200; t++) cart.fixedUpdate(1 / 60, game);
    expect(cart.vx).toBe(0);
  });

  it('脱轨高空落地摔伤：num10>25 → (num10-25)×10（:25005-25091）；矮落无伤', () => {
    // 高落：轨道 y=12（fallStart=trunc(146/16)=9），石板 y=40 → 落点 y=588 → tileY=36
    // → num10 = 36-9 = 27 > 25 → 摔伤 (27-25)×10 = 20
    const { st, world } = derailWorld(40);
    expect(world.store.h).toBeGreaterThanOrEqual(44);
    const { cart, p, game } = mountedCart(st, 8, 12);
    cart.vx = 8;
    expect(runToGround(cart, game, 40, 800)).toBe(true);
    const num10 = Math.trunc(cart.y / 16) - 9;          // fallStart = 9（轨面几何）
    expect(num10).toBeGreaterThan(25);
    expect(p.lastDamageCause?.kind).toBe('fell');
    expect(p.hp).toBeLessThan(p.maxHp);
    expect(p.maxHp - p.hp).toBe((num10 - 25) * 10);

    // 矮落对照（y=20 石板 → num10=7 < 25）：无摔伤
    const low = derailWorld(20);
    const { cart: c2, p: p2, game: g2 } = mountedCart(low.st, 8, 12);
    c2.vx = 8;
    const hp0 = p2.hp;
    for (let t = 0; t < 400; t++) c2.fixedUpdate(1 / 60, g2);
    expect(p2.hp).toBe(hp0);
    expect(p2.lastDamageCause?.kind).not.toBe('fell');
  });
});

// ---------------------------------------------------------------------------
// E. 撞敌伤害（Player.cs:27225-27296 + GetMinecartDamage :28776-28822）
// ---------------------------------------------------------------------------
describe('矿车撞敌伤害', () => {
  /** 固定随机（damageVar ±15% 取 +15% 档；暴击掷骰不中） */
  function fixedRand(): void {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
  }

  function fakeEnemy(x: number, y: number, calls: HitCall[]): unknown {
    return {
      x, y, w: 20, h: 20, dead: false, iframes: 0, friendly: false,
      hurt: (dmg: number, kx: number, _ky: number, _g: GameHooks, _ap: number, crit: boolean) => {
        calls.push({ dmg, kx, crit });
        return true;
      },
    };
  }

  function cartWithEnemy(mountId: number, vx: number, opts: {
    hardMode?: boolean; expert?: boolean; superCart?: boolean; ex: number; ey: number;
  }): { calls: HitCall[]; run: () => void } {
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const { cart, p } = mountedCart(st, 9, 12, mountId);
    if (opts.superCart) cart.superCart = true;
    const flags = {} as Record<string, boolean>;
    if (opts.hardMode) flags.hardMode = true;
    const world = {
      store: st, flags,
      isExpert: !!opts.expert,
    } as unknown as World;
    const calls: HitCall[] = [];
    const game = mkHooks(st, p, world, [fakeEnemy(opts.ex, opts.ey, calls)]);
    cart.vx = vx;
    return { calls, run: () => cart.fixedUpdate(1 / 60, game) };
  }

  it('速度>4 命中：25+55×速比（DamageVar +15% 档）、击退 10+40×速比、免疫 30t', () => {
    fixedRand();
    const { calls, run } = cartWithEnemy(6, 13, { ex: 9 * 16, ey: 12 * 16 });
    run();
    expect(calls.length).toBe(1);
    // ★2026-08-30 R5 对齐：撞怪块读的是轨驱段之前的车速 = 本 tick 重力已入（原版
    //   :27556 cartRampTime<=0 → velocity.Y += gravity 先于 :27748 撞怪块执行，轨驱
    //   吸附在 :28315 之后才把 vy 归零）→ speed = hypot(vx, 0.4)。
    const spd = Math.hypot(13, PLAYER_DEFAULT_GRAVITY);           // ≈13.00615
    const ratio = spd / 13;
    // base = 25+55×ratio = 80.026 → DamageVar +15% → round(92.030) = 92；kb = 50.0189
    expect(calls[0].dmg).toBe(Math.round((25 + 55 * ratio) * 1.15));
    expect(calls[0].kx).toBeCloseTo(10 + 40 * ratio, 3);
    expect(calls[0].crit).toBe(false);
  });

  it('速度≤4 不命中（:27224 velocity.Length() > 4 门）——门用含重力的本帧速度原版字面', () => {
    // ★vx=4 在重力并入后 Length=√(16.16)≈4.02>4 会命中（原版同判）；取 vx=3 钉死
    //   "低速不结算"语义（hypot(3,0.4)≈3.03<4）
    const { calls, run } = cartWithEnemy(6, 3, { ex: 9 * 16, ey: 12 * 16 });
    run();
    expect(calls.length).toBe(0);
  });

  it('木质车 13 低伤害档 15+30×速比（:28809-28811 case 13）', () => {
    fixedRand();
    const { calls, run } = cartWithEnemy(13, 10, { ex: 9 * 16, ey: 12 * 16 });
    run();
    // base = 15+30×(10/10) = 45 → DamageVar +15% = round(51.75) = 52
    expect(calls[0].dmg).toBe(52);
  });

  it('SuperCart 伤害档 50+100×速比（:28814-28817；速比分母 = RunSpeed 20）', () => {
    fixedRand();
    const { calls, run } = cartWithEnemy(6, 13, { superCart: true, ex: 9 * 16, ey: 12 * 16 });
    run();
    // 速比 = 13/20 = 0.65（分母是 SuperCart 的 RunSpeed 20，Mount.cs:480-486）
    // base = 50+100×0.65 = 115 → +15% = round(132.25) = 132
    expect(calls[0].dmg).toBe(132);
  });

  it('hardMode ×1.5 且 expertMode ×1.5（:28818-28822，(int) 截断）', () => {
    fixedRand();
    const both = cartWithEnemy(6, 13, { hardMode: true, expert: true, ex: 9 * 16, ey: 12 * 16 });
    both.run();
    // 92 → ×1.5 = 138 → ×1.5 = 207
    expect(both.calls[0].dmg).toBe(207);
  });

  it('命中盒按速度扩张：vx>1 右扩 15px、vx>10 再扩 10px（:27229-27244）', () => {
    fixedRand();
    // 敌怪在车盒右侧紧贴（车盒 x∈[144,164)，敌盒 x∈[164,184)）：
    // 不扩张则两盒相切不命中；vx=13 → 扩张 +25px 后命中
    const fast = cartWithEnemy(6, 13, { ex: 164, ey: 12 * 16 + 4 });
    fast.run();
    expect(fast.calls.length).toBe(1);
    // 速度不足门（spd≤4）：无扩张也不命中
    const slow = cartWithEnemy(6, 0.5, { ex: 164, ey: 12 * 16 + 4 });
    slow.run();
    expect(slow.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F. 物品链（WorldGen.PlaceTile case 314 + Minecart.GetTrackItem）
// ---------------------------------------------------------------------------
describe('轨道物品链', () => {
  it('placeStyle：2340→普通(-1) / 2492→压板 / 2739→加速（Item.cs + Minecart.cs:1492-1512）', () => {
    const st = new TileStore(30, 20);
    line(st, 8, 10, 1, 0);
    expect(trackTypeOf(st.frameX[st.idx(8, 10)])).toBe(0);
    line(st, 12, 10, 1, 1);
    expect(trackTypeOf(st.frameX[st.idx(12, 10)])).toBe(1);
    expect(st.frameX[st.idx(12, 10)]).toBe(20);   // _firstPressureFrame
    line(st, 16, 10, 1, 2);
    expect(trackTypeOf(st.frameX[st.idx(16, 10)])).toBe(2);
    expect(st.frameX[st.idx(16, 10)]).toBe(31);   // _firstLeftBoostFrame
    line(st, 20, 10, 1, 3);
    expect(st.frameX[st.idx(20, 10)]).toBe(30);   // _firstRightBoostFrame
  });

  it('GetTrackItem 反查：普通 2340 / 压板 2492 / 加速 2739（Minecart.cs:1514-1523）', () => {
    expect(trackItemId(1)).toBe(2340);
    expect(trackItemId(20)).toBe(2492);
    expect(trackItemId(21)).toBe(2492);
    expect(trackItemId(30)).toBe(2739);
    expect(trackItemId(31)).toBe(2739);
  });
});

// ---------------------------------------------------------------------------
// G. 存档（SaveFile.ts frameX/frameY/flags 往返）
// ---------------------------------------------------------------------------
describe('矿车存档往返', () => {
  it('轨道帧（含 0xFFFF 空后轨）与 superCart 旗标存读一致', () => {
    const w = new World(32, 24, 42, 'cart-save');
    line(w.store, 8, 10, 3);
    // 手写一个分叉态：前平接后下行（frameY=4）
    w.store.setTile(9, 10, TRACK, 1, 4);
    (w.flags as Record<string, boolean>).superCart = true;
    const p = new Player(100, 100, new Inventory());
    const back = loadSave(saveGame(w, p, 0));
    const st = back.world.store;
    expect(st.frameX[st.idx(8, 10)]).toBe(w.store.frameX[w.store.idx(8, 10)]);
    expect(st.frameX[st.idx(9, 10)]).toBe(1);
    expect(st.frameY[st.idx(9, 10)]).toBe(4);
    expect(st.frameY[st.idx(8, 10)]).toBe(0xFFFF);    // 空后轨 -1 往返
    expect((back.world.flags as Record<string, boolean>).superCart).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H. SuperCart 防御 + 机械激光（Mount.cs:4790-4799 / 5200-5258）
// ---------------------------------------------------------------------------
describe('SuperCart 防御 + 机械激光', () => {
  it('防御加成公式：(int)(2×(1+|vx|/RunSpeed×2.5))（Mount.cs:4797-4798）', () => {
    // RunSpeed 取 SuperCart 档 20（_shouldSuperCart 整体覆写，Mount.cs:480-486）
    expect(superCartDefenseBonus(0, 20)).toBe(2);     // 2×1.0 = 2
    expect(superCartDefenseBonus(13, 20)).toBe(5);    // 2×2.625 = 5.25 → (int) 5
    expect(superCartDefenseBonus(20, 20)).toBe(7);    // 2×3.5 = 7
  });

  it('fixedUpdate 每帧回写 p.cartDefenseBonus 并计入 defense；非 SuperCart 恒 0', () => {
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const { cart, p, game } = mountedCart(st, 9, 12);
    cart.superCart = true;
    cart.vx = 13;
    cart.fixedUpdate(1 / 60, game);
    expect(p.cartDefenseBonus).toBe(5);              // 2×(1+13/20×2.5)
    expect(p.defense).toBeGreaterThanOrEqual(5);     // defense getter 计入坐骑加成
    cart.superCart = false;
    cart.fixedUpdate(1 / 60, game);
    expect(p.cartDefenseBonus).toBe(0);
  });

  it('激光：前向 ±π/4 锥内敌人即时 60 伤（Mount.cs:5215-5230；591 无暴击旗）', () => {
    // ★TileStore 高度取 60：LineOfSight.centerTiles 的 y 钳是 st.h-40（世界底
    //   保护），30 格的矮桩会把扫描行钳到负值 → 视线恒断（测试环境伪影）
    const st = new TileStore(80, 60);
    line(st, 8, 12, 40);
    const calls: Array<{ dmg: number; kx: number; crit: boolean }> = [];
    const { cart, p } = mountedCart(st, 9, 12);
    cart.superCart = true;
    cart.vx = 6;                                     // 静止不发（:5207 vx==0 门）
    const enemy = {
      x: cart.x + 120, y: cart.y + 10, w: 20, h: 20, dead: false, iframes: 0,
      friendly: false,
      hurt: (dmg: number, kx: number, _ky: number, _g: GameHooks, _ap: number, crit: boolean) => {
        calls.push({ dmg, kx, crit });
        return true;
      },
    };
    const game = mkHooks(st, p, undefined, [enemy]);
    // ★BJ744 改判史：BJ741 R19-4 激光 DV 接入（Mount.cs:5282 Damage()→:12970
    //  Main.DamageVar(60, luck)）——60 断言须 DV 中性档（0.5→tier 0;随机跑必漂移）。
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    cart.fixedUpdate(1 / 60, game);
    expect(calls.length).toBe(1);
    expect(calls[0].dmg).toBe(SUPER_CART_LASER_DMG); // 60
    expect(calls[0].kx).toBe(0);                     // NewProjectile kb 0
    expect(calls[0].crit).toBe(false);               // 591 无 melee/ranged/magic → 不暴击（夹具无蓄能暴击）
    expect(cart.laserBeams.length).toBe(1);          // 余辉束登记
    expect(cart.laserBeams[0].dirX).toBe(1);
  });

  it('激光门：身后/超距/免免疫帧的敌人不命中', () => {
    const st = new TileStore(80, 60);   // 同上：高度 ≥ 41 防 LOS 钳位伪影
    line(st, 8, 12, 40);
    const { cart, p } = mountedCart(st, 9, 12);
    cart.superCart = true;
    cart.vx = 6;
    const mk = (x: number, iframes = 0) => ({
      x, y: cart.y + 10, w: 20, h: 20, dead: false, iframes, friendly: false,
      hurt: () => true,
    });
    const behind = mk(cart.x - 60);                  // 身后：angleFrom≈π 不在锥内
    const far = mk(cart.x + 500);                    // Distance ≥ 300
    const immune = mk(cart.x + 80, 10);              // immune[player] > 0（:5218）
    const game = mkHooks(st, p, undefined, [behind, far, immune]);
    cart.fixedUpdate(1 / 60, game);
    expect(cart.laserBeams.length).toBe(0);
  });

  it('激光余辉 20t 寿 + 玩家反向即灭（Projectile.cs:31993/32020-32024）', () => {
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const { cart, p, game } = mountedCart(st, 9, 12);
    cart.superCart = true;
    cart.vx = 6;
    // 手动注入一束（绕开敌怪布置，单测寿命语义）
    (cart.laserBeams as CartLaserBeam[]).push({
      dx: -20, dy: -39, vx: 60, vy: 0, dirX: 1, age: 0,
    });
    for (let t = 0; t < 19; t++) cart.fixedUpdate(1 / 60, game);
    expect(cart.laserBeams.length).toBe(1);          // age 1..19 存活
    cart.fixedUpdate(1 / 60, game);
    expect(cart.laserBeams.length).toBe(0);          // age 到 20 即灭
    // 反向即灭：dirX=1 而 vx 反向
    (cart.laserBeams as CartLaserBeam[]).push({
      dx: -20, dy: -39, vx: 60, vy: 0, dirX: 1, age: 0,
    });
    cart.vx = -6;
    cart.fixedUpdate(1 / 60, game);
    expect(cart.laserBeams.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// I. 鼠马车挖掘（Player.cs:19912-19933 + MinecartDiggerHelper.cs）
// ---------------------------------------------------------------------------
describe('鼠马车挖掘（Digging Molecart）', () => {
  /** 探针点 = 车中心 + (12,20) + (0,10)（RotatedRelativePoint 平地态）：
   *  车吸附在 tile 9 → 探针 ≈ (166,202) → tile(10,12) = 轨道末格；目标 (11,12) 石柱。
   *  trackLen ≥ 6 时轨道贯穿 (11,12)（不摆石柱——"已连通不重挖"对照用） */
  function moleWorld(trackLen = 3, withStone = true): { st: TileStore; p: Player; cart: Minecart; game: GameHooks } {
    const st = new TileStore(40, 30);
    line(st, 8, 12, trackLen);                       // 轨道 8..(8+len-1)
    if (withStone) for (let y = 8; y <= 12; y++) st.setTile(11, y, STONE);   // 前方 5 格石柱
    const { cart, p } = mountedCart(st, 9, 12, MOLE_CART_MOUNT);
    p.facing = 1;
    p.inputX = 1;
    const world = {
      store: st, flags: {} as Record<string, boolean>, isExpert: false, groundLevel: 5,
    } as unknown as World;
    const game = mkHooks(st, p, world);
    return { st, p, cart, game };
  }

  /** 轨道物品 2340 的仓库 id（vi_2340_* 反查） */
  const TRACK_ITEM_REPO_ID = ITEM_DEFS.findIndex((d) => d && d.vid === TRACK_ITEM_VID);   // ★方案 A:守洞+vid 直读(BJ265)

  it('在轨按方向键：挖穿前方 5 格 + 消耗 1 轨道 + 延轨 + 限速 ±1（Helper.cs:41-54）', () => {
    expect(TRACK_ITEM_REPO_ID).toBeGreaterThanOrEqual(0);   // 2340 已在 vi_ 空间
    const { st, p, cart, game } = moleWorld();
    p.inv.slots[5] = { id: TRACK_ITEM_REPO_ID, stack: 10 };
    cart.vx = 5;
    cart.fixedUpdate(1 / 60, game);
    // 前方 5 格被 KillTile（y=8..11 清空）
    for (let y = 8; y <= 11; y++) {
      expect(st.type[st.idx(11, y)]).toBe(0);
    }
    // (11,12) 放置新轨（PlaceATrack style 0）
    expect(st.type[st.idx(11, 12)]).toBe(TRACK);
    // 消耗 1 个轨道物品
    expect(p.inv.slots[5]!.stack).toBe(9);
    // 挖穿瞬间速度钳 ±1（:50）
    expect(cart.vx).toBe(1);
  });

  it('无轨道物品（CanConsumeATrackItem :58-61）→ 不挖不消耗', () => {
    const { st, cart, game } = moleWorld();
    cart.vx = 5;
    cart.fixedUpdate(1 / 60, game);
    expect(st.type[st.idx(11, 8)]).toBe(STONE);      // 石柱原封
    expect(st.type[st.idx(11, 12)]).toBe(STONE);
    expect(cart.vx).toBeGreaterThan(1);              // 无限速（未挖）
  });

  it('站位不在轨道/地表以上（:14 worldSurface 门）→ 不挖', () => {
    const { st, p, cart, game } = moleWorld();
    // 地表线抬到轨道之下（py=12 < groundLevel=20 → 不挖）
    (game.world as unknown as { groundLevel: number }).groundLevel = 20;
    p.inv.slots[5] = { id: TRACK_ITEM_REPO_ID, stack: 10 };
    cart.vx = 5;
    cart.fixedUpdate(1 / 60, game);
    expect(st.type[st.idx(11, 8)]).toBe(STONE);
  });

  it('镐力门（pickPowerEnough :36 → Player.cs:52964）false → 不挖', () => {
    const { st, p, cart, game } = moleWorld();
    p.inv.slots[5] = { id: TRACK_ITEM_REPO_ID, stack: 10 };
    (game as { pickPowerEnough: (x: number, y: number) => boolean })
      .pickPowerEnough = () => false;
    cart.fixedUpdate(1 / 60, game);
    expect(st.type[st.idx(11, 8)]).toBe(STONE);
  });

  it('已连通轨道（AlreadyLeadsIntoWantedTrack :21）→ 不重挖', () => {
    const { st, p, cart, game } = moleWorld(6, false);   // 轨道 8..13 贯穿（无石柱）
    p.inv.slots[5] = { id: TRACK_ITEM_REPO_ID, stack: 10 };
    cart.fixedUpdate(1 / 60, game);
    expect(p.inv.slots[5]!.stack).toBe(10);          // 未消耗
    expect(st.type[st.idx(11, 12)]).toBe(TRACK);     // 原轨道未被重写
  });
});

// ---------------------------------------------------------------------------
// J. 车轮火花（Player.cs:19573-19673 + Minecart.cs:1629 + DelegateMethods.cs:224-413）
// ---------------------------------------------------------------------------
describe('车轮火花 + 滚动声', () => {
  it('速度档（Player.cs:19585-19596）：0.66/0.33×maxRunSpeed 三档', () => {
    expect(wheelSparkTier(13, 13)).toBe(2);
    expect(wheelSparkTier(8.6, 13)).toBe(2);         // > 8.58
    expect(wheelSparkTier(8.58, 13)).toBe(1);
    expect(wheelSparkTier(4.3, 13)).toBe(1);
    expect(wheelSparkTier(4.29, 13)).toBe(0);
    expect(wheelSparkTier(0, 13)).toBe(0);
  });

  it('尘型分派（Mount.cs 各 mounts[n].delegations.MinecartDust）', () => {
    expect(cartDustKindOf(33)).toBe('sparksMeow');   // MeowmereMinecart（:988）
    expect(cartDustKindOf(51)).toBe('sparksFart');   // FartMinecart（:1074）
    expect(cartDustKindOf(53)).toBe('sparksTerraFart'); // TerraFart（:1082）
    expect(cartDustKindOf(11)).toBe('sparksMech');   // MinecartMech（:1462）
    expect(cartDustKindOf(6)).toBe('sparks');        // 默认 Sparks（:891）
    expect(cartDustKindOf(39)).toBe('sparks');       // SetAsMinecart 默认（:2708）
  });

  it('贴轨反向推动触发：Item_55 滚动声 + 档位掷发火花（磁石位 WheelSparks）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);     // 全部掷位命中
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const { cart, p } = mountedCart(st, 9, 12);
    const sfxFiles: string[] = [];
    const dusts: number[] = [];
    const game = {
      ...mkHooks(st, p),
      playSfxFile: (f: string) => { sfxFiles.push(f); },
      spawnDust: () => {
        dusts.push(1);
        return {
          x: 0, y: 0, vx: 1, vy: 1, scale: 1, alpha: 0, fadeIn: 0,
          noGravity: false, noLight: false, noLightEmittance: false, color: null,
        };
      },
    } as unknown as GameHooks;
    cart.vx = 6;                                     // > 0.33×13 = 4.29 → 档 1
    p.inputX = -1;                                   // 左推（门 vx>=0 ✓）
    cart.fixedUpdate(1 / 60, game);                  // 首 tick：onTrackNow 尚未置位
    expect(dusts.length).toBe(0);
    cart.fixedUpdate(1 / 60, game);                  // 次 tick：上 tick 碰撞后态
    expect(sfxFiles).toContain('Item_55');
    expect(dusts.length).toBe(2);                    // 档 1 = 0.5/0 两位各 2/3（random=0 全中）
  });

  it('门：itemAnimation>0（:19573 itemAnimation==0）与正向推动不触发', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const mkGame = (): { game: GameHooks; dusts: number[]; sfx: string[] } => {
      const dusts: number[] = [];
      const sfx: string[] = [];
      const game = {
        ...mkHooks(st, mkPlayer()),
        playSfxFile: (f: string) => { sfx.push(f); },
        spawnDust: () => {
          dusts.push(1);
          return {
            x: 0, y: 0, vx: 1, vy: 1, scale: 1, alpha: 0, fadeIn: 0,
            noGravity: false, noLight: false, noLightEmittance: false, color: null,
          };
        },
      } as unknown as GameHooks;
      return { game, dusts, sfx };
    };
    // 挥舞中（itemAnimation > 0）→ 不触发
    {
      const { cart, p } = mountedCart(st, 9, 12);
      const { game, dusts } = mkGame();
      cart.vx = 6; p.inputX = -1; p.itemAnimTicks = 5;
      cart.fixedUpdate(1 / 60, game);
      cart.fixedUpdate(1 / 60, game);
      expect(dusts.length).toBe(0);
    }
    // 右推 + vx>0（门 vx<=0 不满足）→ 不触发
    {
      const { cart, p } = mountedCart(st, 9, 12);
      const { game, dusts } = mkGame();
      cart.vx = 6; p.inputX = 1;
      cart.fixedUpdate(1 / 60, game);
      cart.fixedUpdate(1 / 60, game);
      expect(dusts.length).toBe(0);
    }
  });

  it('火花尘后置（DelegateMethods.cs:229-241）：213 型 noGravity/fadeIn/速度缩放', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);  // rand 恒取上界-1 档
    const st = new TileStore(80, 30);
    line(st, 8, 12, 40);
    const { cart, p } = mountedCart(st, 9, 12);
    const game = mkHooks(st, p);
    interface SparkDust {
      type: number; x: number; y: number; vx: number; vy: number;
      noGravity: boolean; fadeIn: number; scale: number;
    }
    let spawned: SparkDust | undefined;
    (game as { spawnDust?: unknown }).spawnDust = (
      x: number, y: number, _w: number, _h: number, type: number, sx: number, sy: number,
    ): SparkDust => {
      spawned = { type, x, y, vx: sx, vy: sy, noGravity: false, fadeIn: 0, scale: 1 };
      return spawned;
    };
    // 直调尘型委派（绕开掷位随机门，单测 NewDust 后置字段算术）
    (cart as unknown as { wheelSparkDust(g: GameHooks, x: number, y: number): void })
      .wheelSparkDust(game, 100, 200);
    expect(spawned).not.toBeNull();
    const d = spawned as SparkDust;
    expect(d.type).toBe(213);                         // 默认 Sparks 尘型（mount 6）
    // random=0.999：rand(-2,3)=2、Next(0,3)=2≠0 → noGravity 复位 false
    expect(d.noGravity).toBe(false);
    // v × rand(15,51)·0.01(=0.50) × rand(25,101)·0.01(=1.00)；y -= 4
    expect(d.vx).toBeCloseTo(2 * 0.5, 5);
    expect(d.y).toBe(196);                            // 200 - 4（:236 position.Y -= 4）
  });
});
