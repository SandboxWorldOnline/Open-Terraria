// ★MV1（2026-10-06）冲刺状态机分支覆盖（用户实报「某些特殊情况松键后持续左/右移,
// 反向键无法中断」定谳守卫）。
//
// 定谳（亲读 1457 反编译 + 活机探针 _mv-edge-runaway.mjs 逐 tick 取证）：
//   原版 DashMovement :26958 在主移动支【无条件】调用（pulley 支 :26691 支尾同）；
//   vortexDebuff（:24627 只改 gravity / :28374 只摆 vy）、shimmerWet/shimmering
//   （:24581 只改重力参数档）、webbed（CCed :3365 只封输入，:26958 在 :27000 CCed 块
//   【之前】不受闸）均不重定向移动支。仓内跳跃链把这些态做成独占分支且漏调
//   dashMovement()（BJ524 只补了湿支）→ 滑行中（dashDelay=-1）进入这些态：
//   阻尼不跑（vx 恒速）+ Run 门（dashDelay>=0）恒闭（加速/摩擦全停）+ 出口不推进
//   = 松键持续漂移、反向键失效，直至状态结束。
//   探针实测（修前）：星旋 120t → vx 冻 14.5px/t 漂 +1740px；微光池 → +232px；
//   绳带 11 格 → +180px（随绳宽线性放大）。
//
// 落刀：shimmer 浸没/微光化/结网/星旋四分支补 dashMovement 调用（绳支撤 pulley 门）；
//   出口 :21570-21575 补 vx==0 档原版语义（按当前键择向,无键保持 0；旧三目恒踢 +num15）。
//
// 变异证红（本文件）：摘任一分支 dashMovement 调用 → 对应组红；恢复出口三目 → ⑤红。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE_DEFS } from '../src/data/tiles';
import { BuffType } from '../src/stats/Buffs';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

// ★世界尺寸纪律：80×80 格 = bordersMovement 边框钳豁免域（≤2B 门）
const W = 80, H = 80;
const GROUND_ROW = 30;        // 跑道地面行（顶像素 480）
const ROPE_X0 = 40, ROPE_X1 = 62;   // 绳带列域（滑行中段穿过）
const POOL_X0 = 46, POOL_X1 = 78;   // 微光池列域

/** 绳内部 id 集合（TILE_DEFS .rope 旗——勿硬编码：内部 id 域与原版 sheet 域不同构） */
const ROPE_IDS = new Set(TILE_DEFS.flatMap((d, i) => (d?.rope ? [i] : [])));
const ANY_ROPE = [...ROPE_IDS][0];

/** 跑道 + 绳带（身高域行） */
function mvRopeWorld(): World {
  const w = new World(W, H, 11, 'mv1-rope');
  const st = w.store;
  for (let x = 4; x < 78; x++) st.setTile(x, GROUND_ROW, 1);
  for (let x = ROPE_X0; x < ROPE_X1; x++) {
    for (let y = GROUND_ROW - 4; y <= GROUND_ROW - 1; y++) st.setTile(x, y, ANY_ROPE);
  }
  return w;
}

/** 跑道 + 微光池（挖空注微光 type 4；池缘 x=POOL_X0×16,滑行中段入池） */
function mvShimmerWorld(): World {
  const w = new World(W, H, 11, 'mv1-shimmer');
  const st = w.store;
  for (let x = 4; x < POOL_X0; x++) st.setTile(x, GROUND_ROW, 1);
  for (let x = POOL_X0; x < POOL_X1; x++) {
    st.setTile(x, GROUND_ROW, 0);
    st.setTile(x, GROUND_ROW + 1, 1);
    st.setLiquid(x, GROUND_ROW, 255, 4);   // 微光（liquidType 4）
  }
  return w;
}

/** 星旋用纯跑道 */
function mvPlainWorld(): World {
  const w = new World(W, H, 11, 'mv1-plain');
  const st = w.store;
  for (let x = 4; x < 78; x++) st.setTile(x, GROUND_ROW, 1);
  return w;
}

function fakeHooks(w: World, p: Player): GameHooks {
  return {
    world: w, player: p, enemies: () => [], critters: () => [], npcs: () => [],
    damagePlayer: (): number => 0, spawnDrop: () => null, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, recLog: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
  } as unknown as GameHooks;
}

function mkPlayer(w: World, tx: number): Player {
  const p = new Player(tx * TILE, GROUND_ROW * TILE - 48, new Inventory());
  p.hp = 500;
  return p;
}

const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };

/** 双击右发起冲刺（prevInputX 沿 = tick 尾快照,两击间隔 4 拍 < 15 拍窗） */
function dashRight(p: Player, w: World): void {
  p.facing = 1;
  p.inputX = 1; p.inputLeft = false; p.inputRight = true;
  tick(p, w);
  p.inputX = 0; p.inputLeft = false; p.inputRight = false;
  for (let i = 0; i < 4; i++) tick(p, w);
  p.inputX = 1; p.inputLeft = false; p.inputRight = true;
  tick(p, w);
  p.inputX = 0; p.inputLeft = false; p.inputRight = false;
  expect(p.dashDelay).toBe(-1);           // 发起自证
}

/** 滑行参数模拟（bj524 同式）：返回触发拍后阻尼拍数 */
function glideSim(v0: number, num13: number, num14: number, num15: number, num16: number): number {
  let vx = v0; let n = 0;
  while (Math.abs(vx) > num13) { vx *= num14; n++; }
  while (Math.abs(vx) > num15) { vx *= num16; n++; }
  return n;
}
// dash2 克盾裸装钉值（:21619 14.5 / :21455-21459 12/0.985/0.94/30）
const DASH2_GLIDE = glideSim(14.5, 12, 0.985, 3, 0.94);
const COOL2 = 30;

describe('MV1① 星旋减益：滑行阻尼照常（原版 vortex 不重定向移动支,:26958 无条件）', () => {
  it('滑行中持续星旋：dashDelay 仍推进到就绪,vx 有界（修前 vx 冻 14.5 漂 120t=+1740px）', () => {
    const w = mvPlainWorld();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    const xAtDash = p.x;
    let recovered = -1;
    // 120t 星旋（原版星锥敌持续在场=每帧续注）内状态机必须走完
    for (let i = 0; i < 120; i++) {
      p.buffs.apply(BuffType.VortexDebuff, 2);
      tick(p, w);
      if (p.dashDelay === 0) { recovered = i; break; }
    }
    expect(recovered, `星旋期 dashDelay 须回 0（修前冻结恒 -1）`).toBeGreaterThan(0);
    expect(recovered, `星旋期 dashDelay 须在 ${DASH2_GLIDE + 1 + COOL2} 拍内回 0`)
      .toBeLessThanOrEqual(DASH2_GLIDE + 1 + COOL2);
    const drift = Math.abs(p.x - xAtDash);
    expect(drift, '松键星旋漂移下界（有滑程）').toBeGreaterThan(100);
    expect(drift, '松键星旋漂移须有界（修后≈滑行全程 350-450px;修前 120t×14.5≈1740px+滑程）').toBeLessThan(600);
  });

  it('星旋滑行中按住反向：vx 必须跨零（滑行制动块活体;修前输入整段无效）', () => {
    const w = mvPlainWorld();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    expect(p.vx).toBeGreaterThan(10);
    let crossed = false;
    for (let i = 0; i < 120; i++) {
      p.buffs.apply(BuffType.VortexDebuff, 2);
      p.inputX = -1; p.inputLeft = true; p.inputRight = false;
      tick(p, w);
      if (p.vx <= 0) { crossed = true; break; }
    }
    expect(crossed, '星旋期反向按住须在滑行窗内把 vx 制动到 ≤0（原版 :19984 反向制动门不闸 dashDelay）').toBe(true);
  });
});

describe('MV1② 绳格重叠：非 pulley 绳攀滑行照常阻尼（撤 BJ527 this.pulley 门）', () => {
  it('滑行穿过绳带：dashDelay 推进到就绪（修前绳上冻结,漂程随绳宽线性放大）', () => {
    const w = mvRopeWorld();
    // ★BJ705-G26 迁移:摩擦时间线滑程 ~350→~200px（G26 else 摩擦逐拍叠加）,起点
    //   20→32 保「滑行中段穿绳带」（绳带 640-992px,新滑程终于 ~712px）。
    const p = mkPlayer(w, 32);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    let sawRope = false;
    let recovered = -1;
    for (let i = 0; i < DASH2_GLIDE + 1 + COOL2 + 30; i++) {
      tick(p, w);
      const tx = Math.floor((p.x + p.w / 2) / TILE);
      const ty = Math.floor((p.y + p.h / 2) / TILE);
      if (w.store.inBounds(tx, ty) && ROPE_IDS.has(w.store.type[w.store.idx(tx, ty)])) sawRope = true;
      if (p.dashDelay === 0) { recovered = i; break; }
    }
    expect(sawRope, '前置自证：滑行须真实穿过绳格（探针 213 误植=假绿教训）').toBe(true);
    expect(recovered, '绳上 dashDelay 须推进到就绪（修前非 pulley 绳支整漏恒 -1）').toBeGreaterThan(0);
    expect(recovered).toBeLessThanOrEqual(DASH2_GLIDE + COOL2 + 1);
  });
});

describe('MV1③ 微光浸没/微光化：滑行阻尼照常（原版 shimmerWet/shimmering 只改重力档）', () => {
  it('滑行冲入微光池：dashDelay 推进到就绪、无恒速漂移段', () => {
    const w = mvShimmerWorld();
    // ★BJ705-G26 迁移:摩擦时间线滑程 ~350→~200px,起点 26→38 保「滑行中段入池」
    //   （池缘 736px,新滑程终于 ~808px;跨缘步降拍同拍落地=全程接地摩擦档）。
    const p = mkPlayer(w, 38);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    let sawShimmer = false;
    let recovered = -1;
    for (let i = 0; i < DASH2_GLIDE + 1 + COOL2 + 60; i++) {
      tick(p, w);
      if (p.inShimmer) sawShimmer = true;
      if (p.dashDelay === 0) { recovered = i; break; }
    }
    expect(sawShimmer, '前置自证：滑行须真实入微光').toBe(true);
    expect(recovered, '微光中 dashDelay 须推进到就绪（修前 inShimmer 独占支整漏）').toBeGreaterThan(0);
    expect(recovered).toBeLessThanOrEqual(DASH2_GLIDE + COOL2 + 30);
  });
});

describe('MV1④ 出口 vx==0 档（:21570-21575 原版语义）', () => {
  it('滑行态 vx 被外力清零且无输入：出口保持 0（修前三目恒踢 +num15=自造右蹬）', () => {
    const w = mvPlainWorld();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    p.vx = 0;                                // 外力清零（结网/矿车/贴墙注入等价）
    p.inputX = 0; p.inputLeft = false; p.inputRight = false;
    tick(p, w);
    expect(p.dashDelay).toBeGreaterThan(0);  // |vx|≤num15 → 落冷却档
    expect(p.vx).toBe(0);                    // ★无键保持 0（修前=+3.0）
  });

  it('结网拍 dash 即时归零就绪（★C5-B3 翻正：:11965-11966 dash=0 → :21221 dashDelay/dashTime 清零,无 20/30t 虚假冷却）', () => {
    const w = mvPlainWorld();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    p.buffs.apply(BuffType.Webbed, 50 / 60);
    p.inputX = 0; p.inputLeft = false; p.inputRight = false;
    tick(p, w);
    // ★C5-B3：结网支先行清 dashDelay/dashT/dashLatched（原版 :11965 dash=0 净效链
    //  :21221）→ 滑行即时止、即时就绪。旧期望 `dashDelay > 0`（滑行收敛落冷却档）
    //  = 把偏离行为钉成金标的伪锚（原版结网拍 dash==0 → 冷却拍内清零）,本组翻正。
    expect(p.vx).toBe(0);
    expect(p.dashDelay, '结网拍滑行须即时清零就绪（:21221 dash==0 净效）').toBe(0);
    expect(p.dashT, '双击窗同步清零（:21221 dashTime=0）').toBe(0);
  });
});
