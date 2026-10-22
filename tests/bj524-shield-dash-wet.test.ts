// ★BJ524 克盾冲刺入水水平锁死（用户实报：任何地方用克苏鲁护盾冲刺进入水中都不能左右移动）
// 定谳+守卫（亲读 1457 反编译，锚逐条钉死）：
//
//   原版 wet×dash 交互 = 【无交互】——Player.Update :26945 JumpMovement() → :26958
//   DashMovement() 在主移动支【无条件】调用（绳索支 :26691 亦然）；Player.cs 全文
//   dashDelay/dashTime/dashing 与 wet 零交点（wet 置位 :28060 只写湿态面，不触碰
//   dash 状态机）。wet 只改：重力/跳参数液体档（:24595-24628）+ WetCollision 位移
//   ×0.5（:23157-23172 num111，velocity 本身不动）。因此冲刺滑行阻尼（:21424-21575）
//   与冷却倒数（:21412-21422）湿态照跑：入水后 dashDelay 三态照常推进——滑行衰减落档
//   dashDelay=num17（:21567）→ 倒数回 0（:21422）→ 就绪；HorizontalMovement（:26889
//   无条件调用）在 dashDelay>=0 态正常加速转向。
//
//   原版钉值（滑行参数 :21426-21431 基础档 + 逐 dash 覆写 :21455-21501）：
//     基础档  num13=12 / num14=0.992 / num16=0.96 / num17=20
//     dash2 克盾: num14=0.985 / num16=0.94 / num17=30（:21455-21459 区）
//     dash3 日曜: num13=14   / num14=0.985 / num16=0.94 / num17=20
//     出口钳速 num15 = max(accRunSpeed, maxRunSpeed)（:21429），裸装=3
//     触发速度 :21588 dash1=16.9 / :21619 dash2=14.5 / :21643 dash3=21.9
//
//   本仓病灶（定谳）：冲刺状态机整段（克盾冲撞/dashDelay 三态/就绪段/日曜/坐骑6）
//   只嵌在跳跃块【干支 else】内（Player.ts 旧 5920 湿支整缺）→ 水中 dashDelay 冻结：
//   ①滑行期入水 = dashDelay 恒 -1 → Run() 门（dashDelay>=0）恒闭 = 左右键零加速零转向
//   （vx 冻结在触发值，位移按 liqFactor 半速漂移）= 用户实报本体；
//   ②就绪段湿缺 = 水中永远无法再发起冲刺（键面/双击两源全灭）。
//
//   落刀：DashMovement 提取为 Player.dashMovement()，干/湿两支各调用一次（湿支位次 =
//   湿重力链之前，保原版 dash-before-gravity 序）。干路径代码逐字节等价搬运。
//
// 变异证红（本文件）：
//   M1 摘湿支 dashMovement 调用 → 水中全组红（干组绿）；
//   M2 摘干支 dashMovement 调用 → 干地全组红（水中组绿）；
//   M3 dash2 冷却档 30→20 → 滑行落档钉值红；
//   M4 Run() 门 dashDelay>=0 → >0 → 冷却期移动恢复红。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

// ★世界尺寸纪律：bordersMovement 边框钳 B=640px（40 格）在 ≤80 格轴向豁免
//（Player.bordersMovement `wPx<=2B || hPx<=2B` 门）——80×80 格=豁免域。
const W = 80, H = 80;
const RUNWAY_ROW = 30;        // 干跑道地面行（顶像素 = 480）——★须 <40 行：wetCollision 探针 j 钳 st.h−40（Collision.cs 扫描窗原版口径），80 格高世界 40 行以下永不判湿
const POOL_FLOOR = 31;        // 池底行（比跑道低 1 格=1 格深涉水池）
const POOL_X0 = 30, POOL_X1 = 79;
const RUNWAY_X1 = POOL_X0;    // 跑道 x<30，池 x∈[30,79)

/** 干跑道 + 1 格深涉水池（水面与跑道顶齐平,水行=40 行 x∈[30,79)） */
function bj524World(): World {
  const w = new World(W, H, 11, 'bj524');
  const st = w.store;
  for (let x = 4; x < RUNWAY_X1; x++) st.setTile(x, RUNWAY_ROW, 1);
  for (let x = POOL_X0; x < POOL_X1; x++) {
    st.setTile(x, POOL_FLOOR, 1);
    st.setLiquid(x, RUNWAY_ROW, 255, 1);
  }
  return w;
}

/** 纯干地世界（干地回归面） */
function dryWorld(): World {
  const w = new World(W, H, 11, 'bj524-dry');
  const st = w.store;
  for (let x = 4; x < POOL_X1; x++) st.setTile(x, RUNWAY_ROW, 1);
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

/** 站在给定地面上（落脚顶 = row*TILE） */
function mkPlayer(w: World, row: number, tx: number): Player {
  const p = new Player(tx * TILE, row * TILE - 48, new Inventory());
  p.hp = 500;
  return p;
}

const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };

/** 注入面（Game.ts 同序）：controlDash 电平 + releaseDash 置位臂（TriggersSet.cs:826） */
function injectDash(p: Player, held: boolean): void {
  p.inputDash = held;
  p.releaseDash ||= !p.inputDash;
}

/** 臂位拍：键未按的任意一拍把 releaseDash 置位（:826 语义） */
function armDash(p: Player, w: World): void {
  injectDash(p, false);
  tick(p, w);
  expect(p.releaseDash).toBe(true);
}

/** 滑行参数模拟（与实现同序同运算——JS double 逐位一致）：
 *  返回触发拍后的【阻尼拍数】与终止拍判定值（终止拍 dashDelay=num17、vx=±num15）。
 *  ★BJ705-G26（[g25-glide-else-friction] 清偿随迁,2026-10-22）:每阻尼拍前叠 HM else
 *  摩擦（原版 :20187/:20202 else 链不闸 dashDelay——HM:26889 先摩擦、DM:26958 后阻尼）。
 *  fr=每滑行拍摩擦值（number 恒值;number[] 逐拍序列尾值续航;0=纯阻尼旧口径）。 */
function glideSim(v0: number, num13: number, num14: number, num15: number, num16: number,
  fr: number | number[] = 0): number {
  const seq = Array.isArray(fr) ? fr : null;
  const frAt = (i: number): number => (seq ? seq[Math.min(i - 1, seq.length - 1)] : (fr as number));
  let vx = v0; let n = 0;
  for (;;) {
    const f = frAt(n + 1);
    if (vx > f) vx -= f; else if (vx < -f) vx += f; else vx = 0;
    if (Math.abs(vx) > num13) { vx *= num14; n++; continue; }
    if (Math.abs(vx) > num15) { vx *= num16; n++; continue; }
    return n;   // 触发后第 n+1 拍落冷却档
  }
}

// 克盾 dash2 裸装钉值：14.5 起步、12/0.985、num15=3、0.94、冷却 30
const DASH2_V0 = 14.5, NUM13 = 12, NUM14 = 0.985, NUM15 = 3, NUM16 = 0.94, COOL2 = 30;
// ★BJ705-G26 摩擦时间线:干/越帽全程接地 −0.2（裸装 runSlowdown）=21 拍;①a 池内
// 发起=出生 6px 沉降尾(湿重力 0.05+位移×0.5)滑行前 9 拍悬空 −0.1、t9 落池底转接地。
const DASH2_GROUND = glideSim(DASH2_V0, NUM13, NUM14, NUM15, NUM16, 0.2);
const DASH2_POOL = glideSim(DASH2_V0, NUM13, NUM14, NUM15, NUM16, [...Array(9).fill(0.1), 0.2]);

describe('BJ524① 克盾冲刺入水：滑行衰减→冷却→就绪全链照常推进（原版钉值）', () => {
  it('①a 水中发起冲刺：滑行恰 DASH2_POOL+1 拍落冷却档 30、vx 钳回 +3（num15），30 拍回就绪', () => {
    const w = bj524World();
    const p = mkPlayer(w, POOL_FLOOR, 40);            // 站在池中（y=41 地面,40 行水）
    p.inv.armor[3] = { id: iid(3097), stack: 1 };     // Shield of Cthulhu → dashType 2
    for (let i = 0; i < 10; i++) tick(p, w);          // 落地沉降至涉水稳态
    expect(p.inWater).toBe(true);                     // 涉水（居中探针湿）——前置自证
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(14.5, 5);                // :21619 dash2=14.5×dir（水中照发）
    expect(p.dashDelay).toBe(-1);
    expect(p.eocDash).toBe(15);                       // :21627 冲撞窗
    // 滑行 DASH2_POOL 拍阻尼+摩擦（沉降尾 9 拍空中 0.1,余接地 0.2——G26 随迁）
    // + 1 拍终止（dashDelay=30、vx=±num15）
    injectDash(p, false);
    for (let i = 1; i <= DASH2_POOL; i++) {
      tick(p, w);
      expect(p.dashDelay, `滑行第 ${i} 拍须保持 -1`).toBe(-1);
    }
    tick(p, w);                                        // 终止拍
    expect(p.dashDelay).toBe(30);                      // :21567 num17（dash2=30）
    expect(p.vx).toBe(3);                              // :21570-21573 钳回 ±num15（裸装 3）
    for (let i = 0; i < 30; i++) { injectDash(p, false); tick(p, w); }
    expect(p.dashDelay).toBe(0);                       // 冷却倒数回就绪（水中照常倒数）
  });

  it('①b 干地起跑冲入水（用户实报本体）：滑行期入水不冻结,事后左右键恢复位移与转向', () => {
    const w = bj524World();
    const p = mkPlayer(w, RUNWAY_ROW, 24);            // 跑道上,池缘（x=480）左侧 96px
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);          // 落地
    expect(p.inWater).toBe(false);
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.dashDelay).toBe(-1);
    injectDash(p, false);
    // 滑行全程（跨干/湿两域）+ 冷却 + 1 拍裕量——dashDelay 必须走到 0（病灶=湿段冻结恒 -1）
    let recovered = -1;
    for (let i = 0; i < DASH2_GROUND + 1 + COOL2 + 40; i++) {
      tick(p, w);
      if (p.dashDelay === 0) { recovered = i; break; }
    }
    expect(recovered, '入水后冲刺状态机须推进到就绪（滑行 DASH2_GROUND+终止+冷却 30 拍内,0 基计数;G26 摩擦时间线:跨缘步降拍同拍落地=全程接地档）').toBe(DASH2_GROUND + COOL2);
    // 恢复面：持右先到稳态再测窗。★原版两段模型全速段本相 = branch2(+0.08) 与
    // 摩擦支(−0.2) 振荡收敛（干地稳态均值 ≈2.91,实测）——水中 vx 不打折（Run 段
    // 无水因子,原版 :25694-25695 乘区链无 wet）,位移打半（WetCollision :23157-23172
    // num111=0.5：velocity 不动只缩位移）→ 稳态位移 ∈ 半速带 [1.2,2.0) px/t
    p.inputX = 1;
    for (let i = 0; i < 90; i++) tick(p, w);
    expect(p.vx, '水中稳态 vx 须达 maxRun 档（Run 段无水因子）').toBeGreaterThan(2.7);
    expect(p.vx).toBeLessThan(3.1);
    const x0 = p.x;
    for (let i = 0; i < 30; i++) tick(p, w);
    const perTick = (p.x - x0) / 30;
    expect(perTick, '水中稳态位移须≈半速带 1.2-2.0 px/t（maxRun 振荡带 × liqFactor 0.5）').toBeGreaterThan(1.2);
    expect(perTick, '水中位移不得达干速（liqFactor 0.5 必须在位）').toBeLessThan(2.0);
    // 转向面：持左反向位移（病灶=滑行冻结态输入全盲）
    p.inputX = -1;
    const x1 = p.x;
    for (let i = 0; i < 60; i++) tick(p, w);
    expect(p.x - x1, '持左 60 拍须净左移（转向恢复）').toBeLessThan(-20);
    p.inputX = 0;
  });
});

describe('BJ524② 干地冲刺不回归（提取搬运零行为差）', () => {
  it('干地发起：滑行落档钉值 30/+3 与水中逐位相同,冷却回就绪,持右达 maxRun 3', () => {
    const w = dryWorld();
    const p = mkPlayer(w, RUNWAY_ROW, 24);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(14.5, 5);
    expect(p.dashDelay).toBe(-1);
    injectDash(p, false);
    for (let i = 1; i <= DASH2_GROUND; i++) {
      tick(p, w);
      expect(p.dashDelay, `干地滑行第 ${i} 拍`).toBe(-1);
    }
    tick(p, w);
    expect(p.dashDelay).toBe(30);
    expect(p.vx).toBe(3);
    for (let i = 0; i < 30; i++) { injectDash(p, false); tick(p, w); }
    expect(p.dashDelay).toBe(0);
    // 恢复后持右到稳态：干地 vx 收敛 maxRun 振荡带（branch2/摩擦支,≈2.8-3.05）,
    // 位移无液体折扣（≈2.9 px/t）
    p.inputX = 1;
    for (let i = 0; i < 90; i++) tick(p, w);
    expect(p.vx).toBeGreaterThan(2.7);
    expect(p.vx).toBeLessThan(3.1);
    const x0 = p.x;
    for (let i = 0; i < 30; i++) tick(p, w);
    expect((p.x - x0) / 30).toBeGreaterThan(2.5);
    expect((p.x - x0) / 30).toBeLessThan(3.2);
    p.inputX = 0;
  });
});

describe('BJ524③ 其他 dashType 湿态同构抽验', () => {
  it('忍者足具 977（dash1）：水中滑行走基础档 0.992/0.96/20,落档 20 回就绪', () => {
    const w = bj524World();
    const p = mkPlayer(w, POOL_FLOOR, 40);
    p.inv.armor[3] = { id: iid(977), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    expect(p.inWater).toBe(true);
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(16.9, 5);                // :21588 dash1=16.9
    expect(p.dashDelay).toBe(-1);
    expect(p.eocDash).toBe(0);                        // dash1 无冲撞窗
    injectDash(p, false);
    const glide1 = glideSim(16.9, 12, 0.992, 3, 0.96, [...Array(9).fill(0.1), 0.2]);   // 基础档+池沉降尾摩擦（G26）
    for (let i = 1; i <= glide1; i++) { tick(p, w); expect(p.dashDelay).toBe(-1); }
    tick(p, w);
    expect(p.dashDelay).toBe(20);                     // num17 基础档
    expect(p.vx).toBe(3);
    for (let i = 0; i < 20; i++) { injectDash(p, false); tick(p, w); }
    expect(p.dashDelay).toBe(0);
  });

  it('日耀套 2763/2764/2765（dash3）：水中滑行 num13=14 档,落档 20,solarDashing 随就绪清位', () => {
    const w = bj524World();
    const p = mkPlayer(w, POOL_FLOOR, 40);
    p.inv.armor[0] = { id: iid(2763), stack: 1 };     // Solar Flare Helmet
    p.inv.armor[1] = { id: iid(2764), stack: 1 };     // Solar Flare Breastplate
    p.inv.armor[2] = { id: iid(2765), stack: 1 };     // Solar Flare Leggings
    for (let i = 0; i < 10; i++) tick(p, w);
    expect(p.inWater).toBe(true);
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(21.9, 5);                // :21643 dash3=21.9
    expect(p.dashDelay).toBe(-1);
    expect(p.solarDashing).toBe(true);                // SolarDashStart :21258-21260
    injectDash(p, false);
    // 日耀套 moveMult=1.15（vanillaArmorSets 全套聚合）→ num15=max(accRun, 3×1.15)=3.45
    //（原版 num15 = Math.Max(accRunSpeed, maxRunSpeed) :21429,maxRunSpeed 已吃 moveSpeed 乘区）
    const glide3 = glideSim(21.9, 14, 0.985, 3.45, 0.94, [...Array(9).fill(0.1), 0.2]);   // dash3 覆写档 num13=14+池沉降尾摩擦（G26）
    for (let i = 1; i <= glide3; i++) { tick(p, w); expect(p.dashDelay).toBe(-1); }
    tick(p, w);
    expect(p.dashDelay).toBe(20);
    expect(p.vx, '出口钳速=±num15（日耀 3.45,非裸装 3）').toBeCloseTo(3.45, 5);
    expect(p.solarDashing, 'dashDelay>=0 即清 solarDashing（:21662 dashDelay>=0 支）').toBe(false);
    for (let i = 0; i < 20; i++) { injectDash(p, false); tick(p, w); }
    expect(p.dashDelay).toBe(0);
  });
});

describe('BJ524④ 水中再冲刺：BJ508 键面 + 双击两触发源协同', () => {
  it('键面：水中就绪态按 Dash 键即发起（DoCommonDashHandle 湿态照跑）,闩照常清位', () => {
    const w = bj524World();
    const p = mkPlayer(w, POOL_FLOOR, 40);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(14.5, 5);
    expect(p.releaseDash).toBe(false);                // :21779-21782 闩清位
    for (let i = 0; i < 120; i++) { injectDash(p, true); tick(p, w); }   // 按住走完全程
    expect(p.dashDelay).toBe(0);                      // 不重触（闩）且回就绪
  });

  it('双击：水中就绪态双击沿照常登记 ±15 窗并触发（:21761/:21776 窗、二击消费）', () => {
    const w = bj524World();
    const p = mkPlayer(w, POOL_FLOOR, 40);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    expect(p.inWater).toBe(true);
    p.facing = 1;
    // ★MV3（2026-10-07）：双击沿改单键承载（prevInputRight，原版 releaseRight 同源
    //   :27827-27845）后，注入须走 Game 同式全键面（Game.ts:9923 inputX 由
    //   inputLeft/Right 派生,单写 inputX=不可达态）。语义不变：水中照登记/消费。
    p.inputX = 0; p.inputRight = false; tick(p, w);
    p.inputX = 1; p.inputRight = true; tick(p, w);     // 首击右向 → 登记窗
    expect(p.dashT).toBe(15);                          // :21761 dashTime=15（湿态照登记）
    p.inputX = 0; p.inputRight = false; tick(p, w);
    p.inputX = 1; p.inputRight = true; tick(p, w);     // 二击 → 消费
    expect(p.vx).toBeCloseTo(14.5, 5);                 // dash2 触发
    expect(p.dashDelay).toBe(-1);
    p.inputX = 0; p.inputRight = false;
  });
});
