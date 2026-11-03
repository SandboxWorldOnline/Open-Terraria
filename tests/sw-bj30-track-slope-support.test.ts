// SW-BJ30 2026-09-08 轨道三症状回归（用户实报,附截图）
//   症状① 45°坡轨"开不过去"——矿车贴轨爬坡相位矩阵（Minecart.ts 贴轨横墙探针
//          坡面通行门 + 原版横向碰撞坡面让行语义 Collision.cs:2361-2382）
//   症状② 挖轨道下方块破坏轨道——原版 FrameTrack 无失撑破坏支（Minecart.cs:947-1172）
//   症状③ 轨道下方插火把破坏轨道——同上,checkFurnitureSupport 314 早退分支结构锁
//   并入子任务 天然轨道超速定谳——轨上速度上限（平直 vx≤runSpeed、下坡 vy≤10
//          maxFallSpeed=Player.cs:24558/:27576、压板轨零 boost）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { TileStore } from '../src/world/TileStore';
import { TILE_BY_KEY } from '../src/data/tiles';
import {
  frameTrack, frameTrackArea, placeTrack, trackCollision,
  getOnTrack, trackTypeOf,
  FLAG_ON_TRACK, FLAG_HIT_SWITCH, FLAG_BOOST_LEFT, FLAG_BOOST_RIGHT,
  PLAYER_DEFAULT_GRAVITY,
  type TrackRider,
} from '../src/world/MinecartTrack';
import { Minecart, CART_MOUNT_TEXTURES, DEFAULT_CART_TEXTURE, WOOD_CART_MOUNT } from '../src/entities/Minecart';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { Player } from '../src/entities/Player';

const TRACK = TILE_BY_KEY['v_314_minecart_track'] ?? -1;
expect(TRACK).toBeGreaterThanOrEqual(0);
const STONE = TILE_BY_KEY['stone'] ?? -1;
expect(STONE).toBeGreaterThanOrEqual(0);

const W = 20, H = 52;              // 坐骑 hitbox（42 + heightBoost 10）
const FLAT_H = 6;                  // 平轨面高度（默认子段 (8-5)*2）

function mkHooks(st: TileStore, p: Player): GameHooks {
  return {
    world: { store: st, flags: {}, isExpert: false } as unknown as never,
    player: p,
    enemies: () => [],
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

function mkPlayer(): Player {
  return new Player(0, 0, new Inventory());
}

/** 放置链（WorldGen.PlaceTile case 314 → PlaceTrack + 邻接重定型） */
function layTrack(st: TileStore, tx: number, ty: number): void {
  placeTrack(st, tx, ty, 0);
  frameTrackArea(st, tx, ty);
}

/** SW-BJ30 场景（与真实游戏探针 scripts/_bj30-track-slope.mjs 同构）：
 *  助跑平轨 x0-6..x0+7 → 45°上坡山体 6 格 → 顶部平轨 5 格
 *  → 45°下坡山体 6 格 → 谷底平轨 14 格。返回顶平轨首列/谷底首列。
 *  ★SW-RB8b 2026-09-09 坡 id 矫正为 vanilla 形（smoothSlope cs:70037 位编码：
 *  case5 down+right→坡2 / case6 down+left→坡1——右上行坡面=坡2、右下行坡面=坡1,
 *  与 TrackPass.smoothSlope/worldgen 生成地形一致;BJ30 原场景坡 id 镜像反标,
 *  恰好喂对了当时的 vx 符号规则=伪绿） */
function buildSlopeScene(st: TileStore, x0: number, F: number): { topX: number; valleyX: number } {
  for (let x = x0 - 8; x <= x0 + 38; x++) for (let y = F - 16; y <= F + 2; y++) {
    if (!st.inBounds(x, y)) continue;
    if (st.get(x, y) !== 0 || st.slope[st.idx(x, y)] !== 0 || st.half[st.idx(x, y)] !== 0) st.setTile(x, y, 0, 0, 0);
    st.setSlope(x, y, 0);
  }
  // 助跑平轨
  for (let x = x0 - 6; x <= x0 + 7; x++) st.setTile(x, F, STONE, 0, 0);
  for (let x = x0 - 6; x <= x0 + 7; x++) layTrack(st, x, F - 1);
  // 45° 上坡（右上行 → 坡 2）
  for (let k = 0; k <= 5; k++) {
    const col = x0 + 8 + k, surf = F - 1 - k;
    st.setTile(col, surf, STONE, 0, 0); st.setSlope(col, surf, 2);
    for (let y = surf + 1; y <= F; y++) st.setTile(col, y, STONE, 0, 0);
    layTrack(st, col, surf - 1);
  }
  // 顶部平轨
  for (let x = x0 + 14; x <= x0 + 18; x++) st.setTile(x, F - 6, STONE, 0, 0);
  for (let x = x0 + 14; x <= x0 + 18; x++) layTrack(st, x, F - 7);
  // 45° 下坡（右下行 → 坡 1）
  for (let k = 0; k <= 5; k++) {
    const col = x0 + 19 + k, surf = F - 5 + k;
    st.setTile(col, surf, STONE, 0, 0); st.setSlope(col, surf, 1);
    for (let y = surf + 1; y <= F; y++) st.setTile(col, y, STONE, 0, 0);
    layTrack(st, col, surf - 1);
  }
  // 谷底平轨
  for (let x = x0 + 25; x <= x0 + 38; x++) st.setTile(x, F, STONE, 0, 0);
  for (let x = x0 + 25; x <= x0 + 38; x++) layTrack(st, x, F - 1);
  return { topX: x0 + 14, valleyX: x0 + 25 };
}

/** 镜像场景（SW-RB8b）：助跑平轨在右、45° 左上行坡（坡 1 = 左高右低族的反向面）
 *  向左爬——覆盖「斜坡下行反向」边界（Collision.cs:2375 坡 1 让行支 ox≥格左）。 */
function buildSlopeSceneLeft(st: TileStore, x0: number, F: number): { topX: number } {
  for (let x = x0 - 38; x <= x0 + 8; x++) for (let y = F - 16; y <= F + 2; y++) {
    if (!st.inBounds(x, y)) continue;
    if (st.get(x, y) !== 0 || st.slope[st.idx(x, y)] !== 0 || st.half[st.idx(x, y)] !== 0) st.setTile(x, y, 0, 0, 0);
    st.setSlope(x, y, 0);
  }
  // 助跑平轨（右侧）
  for (let x = x0 - 7; x <= x0 + 6; x++) st.setTile(x, F, STONE, 0, 0);
  for (let x = x0 - 7; x <= x0 + 6; x++) layTrack(st, x, F - 1);
  // 45° 左上行坡（col 递减 surf 递减;面 = 坡 1）
  for (let k = 0; k <= 5; k++) {
    const col = x0 - 8 - k, surf = F - 1 - k;
    st.setTile(col, surf, STONE, 0, 0); st.setSlope(col, surf, 1);
    for (let y = surf + 1; y <= F; y++) st.setTile(col, y, STONE, 0, 0);
    layTrack(st, col, surf - 1);
  }
  // 顶部平轨
  for (let x = x0 - 18; x <= x0 - 14; x++) st.setTile(x, F - 6, STONE, 0, 0);
  for (let x = x0 - 18; x <= x0 - 14; x++) layTrack(st, x, F - 7);
  return { topX: x0 - 14 };
}

function mkCart(st: TileStore, mountId: number): { cart: Minecart; p: Player; game: GameHooks } {
  const p = mkPlayer();
  const cart = new Minecart();
  cart.mountId = mountId;
  cart.applyMountStats();
  cart.texture = CART_MOUNT_TEXTURES[mountId] ?? DEFAULT_CART_TEXTURE;
  cart.mounted = true;
  p.ridingCart = true;
  p.cart = cart;
  return { cart, p, game: mkHooks(st, p) };
}

// ---------------------------------------------------------------------------
// 症状①：45° 坡轨爬坡相位矩阵（原版坡面让行 + 原版无该横墙探针,repo 探针须放行坡体）
// ---------------------------------------------------------------------------
describe('SW-BJ30 症状①：45° 坡轨行驶相位矩阵', () => {
  const X0 = 40, F = 24;

  function runClimb(mountId: number, vx0: number, phase: number): {
    reached: boolean; wedged: boolean; maxVy: number;
  } {
    const st = new TileStore(120, 60);
    const { topX } = buildSlopeScene(st, X0, F);
    const { cart, p, game } = mkCart(st, mountId);
    const snap = getOnTrack(st, X0 - 6, F - 1, (X0 - 6) * 16, (F - 1) * 16 - 40, cart.w, cart.h);
    cart.x = (snap ? snap.x : (X0 - 6) * 16) + phase * 0.125;
    cart.y = snap ? snap.y : (F - 1) * 16 + FLAT_H - cart.h;
    cart.vx = vx0; cart.vy = 0;
    p.inputX = 1;
    let maxVy = 0;
    let reached = false;
    for (let t = 0; t < 420; t++) {
      cart.fixedUpdate(1 / 60, game);
      maxVy = Math.max(maxVy, Math.abs(cart.vy));
      if (cart.x / 16 >= topX) { reached = true; break; }
    }
    // 楔死判据：未到顶 && 脱轨 standing（vx=0、离轨、贴地）
    const wedged = !reached && !cart.onTrackNow && cart.vx === 0 && cart.vy === 0;
    return { reached, wedged, maxVy };
  }

  it('木质车（mount 13,runSpeed 10）vx=10 全相位爬上 45° 坡不楔死', () => {
    for (let phase = 0; phase < 8; phase++) {
      const r = runClimb(WOOD_CART_MOUNT, 10, phase);
      expect({ phase, ...r }, `phase ${phase} 楔死/未达顶`).toMatchObject({ reached: true, wedged: false });
    }
  });

  it('普通车（mount 6,runSpeed 13）vx=13 全相位爬上 45° 坡不楔死', () => {
    for (let phase = 0; phase < 8; phase++) {
      const r = runClimb(6, 13, phase);
      expect({ phase, ...r }, `phase ${phase} 楔死/未达顶`).toMatchObject({ reached: true, wedged: false });
    }
  });

  it('低速 vx=3 也能爬坡（原版贴轨跟面运动与速度无关）', () => {
    const r = runClimb(WOOD_CART_MOUNT, 3, 3);
    expect(r).toMatchObject({ reached: true, wedged: false });
  });

  // ★SW-RB8b 2026-09-09：镜像面向（左行爬左上行坡=坡 1）——Collision.cs:2375 坡 1
  //  让行支（preY+h-|vx|≤格底 && preX≥格左）对左行前缘格蕴含成立;BJ30 符号规则
  //  （slope1∧vx>0）对本面向恒不放行=楔死。真实 vanilla 形右上行坡=坡 2（上行
  //  测试同款判据镜像），两面向全绿才证明「与速度方向无关的几何门」1:1。
  it('镜像面向：左行爬左上行坡（坡 1）全相位不楔死（木车 vx=10）', () => {
    for (let phase = 0; phase < 8; phase++) {
      const st = new TileStore(140, 60);
      const { topX } = buildSlopeSceneLeft(st, 80, 24);
      const { cart, p, game } = mkCart(st, WOOD_CART_MOUNT);
      const snap = getOnTrack(st, 80 + 6, 24 - 1, (80 + 6) * 16, (24 - 1) * 16 - 40, cart.w, cart.h);
      cart.x = (snap ? snap.x : (80 + 6) * 16) + phase * 0.125;
      cart.y = snap ? snap.y : (24 - 1) * 16 + FLAT_H - cart.h;
      cart.vx = -10; cart.vy = 0;
      p.inputX = -1;
      let reached = false;
      for (let t = 0; t < 420; t++) {
        cart.fixedUpdate(1 / 60, game);
        if (cart.x / 16 <= topX) { reached = true; break; }
      }
      const wedged = !reached && !cart.onTrackNow && cart.vx === 0 && cart.vy === 0;
      expect({ phase, reached, wedged }, `phase ${phase} 楔死/未达顶`).toMatchObject({ reached: true, wedged: false });
    }
  });

  it('结构锁：贴轨横墙探针坡面放行 = Collision.cs:2361-2382 flag3 几何（非 vx 符号）', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/entities/Minecart.ts', 'utf8');
    expect(src).toContain('preY + this.h - avx <= feetY * 16 + 16 && preX >= headX * 16');
    expect(src).toContain('preY + this.h - avx <= feetY * 16 + 16 && preX + this.w <= headX * 16 + 16');
    expect(src).toContain('preY + avx >= feetY * 16 && preX >= headX * 16');
    expect(src).toContain('preY + avx >= feetY * 16 && preX + this.w <= headX * 16 + 16');
    // 推离前置（原版 :2406/:2428 移动前盒完全在格一侧才拦）在位
    expect(src).toContain('preX + this.w <= headX * 16 || preX >= headX * 16 + 16');
  });
});

// ---------------------------------------------------------------------------
// 并入子任务：轨上速度上限（平直 vx≤runSpeed / 下坡 vy≤maxFallSpeed 10）
// ---------------------------------------------------------------------------
describe('SW-BJ30 并入：轨上速度上限钳制（Player.cs:19985-20039/:20165-20171/:27576）', () => {
  it('全速下坡 45°：vx 不超 runSpeed（木车 10）、vy 不超 maxFallSpeed（10）', () => {
    const st = new TileStore(120, 60);
    const { topX } = buildSlopeScene(st, 40, 24);
    const { cart, p, game } = mkCart(st, WOOD_CART_MOUNT);
    // 直接置于顶平轨
    const snap = getOnTrack(st, topX + 1, 24 - 7, (topX + 1) * 16, (24 - 7) * 16 - 40, cart.w, cart.h);
    cart.x = snap ? snap.x : (topX + 1) * 16;
    cart.y = snap ? snap.y : (24 - 7) * 16 + FLAT_H - cart.h;
    cart.vx = 10; cart.vy = 0;
    p.inputX = 1;
    let maxVx = 0, maxVy = 0, reachedValley = false;
    for (let t = 0; t < 300; t++) {
      cart.fixedUpdate(1 / 60, game);
      maxVx = Math.max(maxVx, Math.abs(cart.vx));
      maxVy = Math.max(maxVy, Math.abs(cart.vy));
      if (cart.x / 16 >= 40 + 25) { reachedValley = true; break; }
    }
    expect(reachedValley).toBe(true);
    expect(maxVx, 'vx 超出原版 runSpeed 上限').toBeLessThanOrEqual(10 + 1e-6);
    expect(maxVy, 'vy 超出原版 maxFallSpeed 上限').toBeLessThanOrEqual(10 + 1e-6);
  });

  it('天然轨道（worldgen 压板帧）行车零 boost：只有 HIT_SWITCH 位（TrackGenerator 仅 style 1）', () => {
    const st = new TileStore(60, 40);
    // [1][21][1] 混合链（压板轨端盖原版保持放置帧 Minecart.cs:1032-1038 case 1 return false,
    // 天然链端=开放端;中段压板 21 与普通轨 1 相邻是合法世界态）
    for (let x = 20; x <= 22; x++) { placeTrack(st, x, 15, 0); frameTrackArea(st, x, 15); }
    st.setTile(21, 15, TRACK, 21, 0xFFFF);        // 中段设为压板 21
    frameTrack(st, 21, 15, false);                // 压板定型分支：保持 21
    expect(st.frameX[st.idx(21, 15)]).toBe(21);
    expect(trackTypeOf(st.frameX[st.idx(21, 15)])).toBe(1);
    const r: TrackRider = { x: 20 * 16 + 2, y: 15 * 16 + FLAT_H - 52, vx: 8, vy: 0, lastBoostX: 0, lastBoostY: 0 };
    let bits = 0;
    for (let t = 0; t < 60 && !(bits & (1 << FLAG_HIT_SWITCH)); t++) {
      r.vy = PLAYER_DEFAULT_GRAVITY;
      bits = trackCollision(st, r, W, H, false, false, 0, false);
      r.x += r.vx;
      r.y += r.vy;
    }
    expect(bits & (1 << FLAG_HIT_SWITCH)).toBeTruthy();       // 压板触发（原版 HitSwitch）
    expect(bits & (1 << FLAG_BOOST_LEFT)).toBe(0);            // 天然轨绝无 boost 位
    expect(bits & (1 << FLAG_BOOST_RIGHT)).toBe(0);
    expect(r.vx).toBe(8);                                     // 速度不被压板改动
  });
});

// ---------------------------------------------------------------------------
// 症状②③：轨道支撑规则矩阵（原版 FrameTrack 无失撑破坏支）
// ---------------------------------------------------------------------------
describe('SW-BJ30 症状②③：轨道支撑规则矩阵（Minecart.FrameTrack 永不拆轨）', () => {
  it('挖掉轨道正下方支撑块：轨道保留且帧不变（原版 TileFrame→FrameTrack(pound:false) 仅重定帧）', () => {
    const st = new TileStore(40, 40);
    for (let x = 10; x <= 15; x++) st.setTile(x, 20, STONE, 0, 0);
    for (let x = 10; x <= 15; x++) layTrack(st, x, 19);
    const before = st.frameX[st.idx(12, 19)];
    expect(st.get(12, 19)).toBe(TRACK);
    st.setTile(12, 20, 0);                       // 挖支撑（onTileChanged 级联等价面）
    frameTrack(st, 12, 19, false);               // checkFurnitureSupport 新分派语义
    expect(st.get(12, 19)).toBe(TRACK);          // ★轨道必须幸存（原版不拆）
    expect(st.frameX[st.idx(12, 19)]).toBe(before);
    expect(st.flags[st.idx(12, 19)] & 1).toBeTruthy();
  });

  it('孤格悬空轨道：array==null → 重置开放端 frame 0 且【保留】（Minecart.cs:984-990）', () => {
    const st = new TileStore(40, 40);
    placeTrack(st, 20, 20, 0);
    frameTrackArea(st, 20, 20);
    st.frameX[st.idx(20, 20)] = 1;               // 强设直轨帧
    frameTrack(st, 20, 20, false);
    expect(st.get(20, 20)).toBe(TRACK);          // 不拆
    expect(st.frameX[st.idx(20, 20)]).toBe(0);   // 重置开放端
    expect(st.frameY[st.idx(20, 20)]).toBe(0xFFFF);
  });

  it('挖相邻轨：幸存侧重定端盖帧但格保留（原版邻线自动改道）', () => {
    const st = new TileStore(40, 40);
    for (let x = 10; x <= 14; x++) layTrack(st, x, 19);
    st.setTile(14, 19, 0);                       // 拆走末端轨
    frameTrack(st, 13, 19, false);
    expect(st.get(13, 19)).toBe(TRACK);
    const fx = st.frameX[st.idx(13, 19)];
    expect(fx).toBeGreaterThanOrEqual(0);
    expect(fx).toBeLessThan(36);
    expect(trackTypeOf(fx)).toBe(0);
  });

  it('症状③：轨道下方空格写火把（放置成功瞬间级联）→ frameTrack 后轨道幸存', () => {
    const st = new TileStore(40, 40);
    for (let x = 10; x <= 13; x++) st.setTile(x, 21, STONE, 0, 0);   // 火把锚地面
    for (let x = 10; x <= 13; x++) layTrack(st, x, 19);              // 悬空轨（下方空）
    expect(st.get(11, 20)).toBe(0);
    st.setTile(11, 20, TILE_BY_KEY['torch'] ?? st.get(11, 20), 0, 0); // 火把写入（锚=下方石台）
    frameTrack(st, 11, 19, false);
    expect(st.get(11, 19)).toBe(TRACK);          // ★轨道必须幸存
  });

  it('结构锁：Game.checkFurnitureSupport 的 TRACK_SHEET 早退分支先于家具 hasSupport 链', () => {
    const src = readFileSync(resolve(fileURLToPath(import.meta.url), '../../src/core/Game.ts'), 'utf8');
    const i0 = src.indexOf('private checkFurnitureSupport(');
    expect(i0).toBeGreaterThan(0);
    const body = src.slice(i0, i0 + 9000);
    const guard = body.indexOf('def.vanilla?.sheet === TRACK_SHEET');
    // ★G41 改判史(2026-11-02):通用家具复验调用已重构成 furnitureBandSurvives
    //   (Check2x2-generic 独立支重构)——旧锁找 this.hasSupport( 已不在函数体内。
    //   语义不变:轨道早退仍先于家具复验链(guard < furnitureBandSurvives 位)。
    const support = body.indexOf('this.hasSupport(') >= 0
      ? body.indexOf('this.hasSupport(')
      : body.indexOf('this.furnitureBandSurvives(');
    expect(guard, 'SW-BJ30 轨道早退分支丢失').toBeGreaterThan(0);
    expect(support, '家具复验链(furnitureBandSurvives/hasSupport)须在轨道早退后').toBeGreaterThan(guard);
    expect(body).toContain('frameTrack(st, x, y, false)');
  });
});
