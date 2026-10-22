// ★BJ527 绳索支 DashMovement 补面（BJ524 登记债观察项）——定谳+守卫（亲读 1457 反编译）：
//
//   原版绳面：pulley 移动支（:26500-26694）块尾【无条件】DashMovement()（:26691——
//   与主移动支 :26958 同形；1914 行号系 1456 旧锚，行为同一，锚以 1457 亲读为准）。
//   绳上可发起冲刺：就绪段 DoCommonDashHandle（:21724-21789）键面（controlDash）/
//   双击（controlRight && releaseRight & flag）两源照跑；冷却（:21412-21422 dashDelay--
//   ）与滑行阻尼（:21424-21575）绳上照常推进。发起拍块序 = X 吸附（:26650-26659
//   position.X=num39）→ 垂直链 → DashMovement——发起拍 X 仍钉绳列，DashMovement 置
//   vx=±16.9/14.5/21.9（:21588/:21619/:21643）后【下一拍】:26475 `velocity.X != 0f →
//   pulley = false` 逐出落绳，滑行转由主移动支 :26958 续跑——绳上冲刺 = 一拍挂绳 +
//   空中滑行。绳上按左右（非上爬）原版 :26455-26466 即离绳+vx=±1（本仓持键即离近似
//   同净效），故绳上发起窗口 = 上爬持键/静挂时键面触发。
//
//   绳面滑行 = 纯阻尼：HorizontalMovement Run 支（:26889）落主移动支 else-if 链，
//   绳索支整段不跑（:26366 在 pulley else 分支内）——1457 滑行期 Run 支的输入加速/
//   制动（dashDelay 门已删）在绳面【不存在】。本仓 dashMovement 的 ix 参数唯一消费点
//   即该 Run 支承载块 → 绳面调用传 ix=0（另三态：发起/冷却/冲撞全不消费 ix）。
//
//   本仓病灶（BJ524 登记）：dashMovement 只挂干/湿两支（:6484/:6137 前身），pulley
//   两支（中段 branch1 :5770 / 绳端 branch2 :5774）整缺 → 绳上 dashDelay 冻结、
//   就绪段全盲 = 绳上无法发起/推进冲刺。
//
//   落刀：pulley 两支补 this.dashMovement(game, eqM, 0, speedMult, duneBoost,
//   strongestSlow)（branch1 门 this.pulley——与非 pulley 绳攀共用；branch2 支尾
//   无条件=原版块尾语义，含 inputDown 穿落离绳拍）。
//
// 变异证红（本文件）：
//   M1 摘 branch1 调用 → ①②红（中段绳）③绿（绳端支独立）；
//   M2 摘 branch2 调用 → ③红，①②绿；
//   M3 触发速度 14.5→14.0 → ①③发起钉值红（BJ524 套件同面同红）。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];
const ROPE_T = TILE_INTERNAL_BY_SHEET.get(213)!;   // 绳 213（本仓内部 id 反查）

// ★世界尺寸纪律：80×80 格 = bordersMovement 边框钳豁免域（BJ524 同款）
const W = 80, H = 80;
const ROPE_COL = 40;

/** 无地板世界 + 竖直绳柱 rows 14..34（落绳后滑行坠空,dash 三态不受地面/摔伤干扰） */
function ropeWorld(): World {
  const w = new World(W, H, 11, 'bj527');
  for (let y = 14; y <= 34; y++) w.store.setTileSilent(ROPE_COL, y, ROPE_T);
  return w;
}

/** 单格孤立绳（绳端悬挂支 face：上下邻格均非绳） */
function endWorld(): World {
  const w = new World(W, H, 11, 'bj527-end');
  w.store.setTileSilent(ROPE_COL, 25, ROPE_T);
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

/** 悬绳位出生：头格行 = headRow（(y−8)/16），x 钉绳列中心（pulleyDir=1 居中档） */
function hangPlayer(w: World, headRow: number): Player {
  const p = new Player(ROPE_COL * TILE + 8 - 10, headRow * TILE + 8, new Inventory());
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

/** 滑行参数模拟（与实现同序同运算）：触发后落冷却档前的阻尼拍数（BJ524 同款;
 *  ★BJ705-G26 [g25-glide-else-friction] 清偿随迁:fr=每滑行拍 HM else 摩擦值,
 *  number[] 逐拍序列尾值续航——绳上滑行=落绳拍(静挂 vy=0)接地 −0.2、余拍悬空 −0.1） */
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
    return n;
  }
}

// 克盾 dash2 裸装钉值：14.5 起步、12/0.985、num15=3、0.94、冷却 30（:21455-21459 区）
// ★BJ705-G26 摩擦时间线:落绳拍接地 0.2+余拍悬空 0.1（纯阻尼 36 → 26 拍）
const DASH2_GLIDE = glideSim(14.5, 12, 0.985, 3, 0.94, [0.2, 0.1]);

describe('BJ527① 绳上发起冲刺（中段绳柱,branch1 门 this.pulley）', () => {
  it('发起拍 vx=14.5/dashDelay=-1/eocDash=15 且仍钉绳;次拍 :26475 落绳续滑至冷却 30 回就绪', () => {
    const w = ropeWorld();
    const p = hangPlayer(w, 25);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };     // Shield of Cthulhu → dashType 2
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);                      // 抓绳自证（FindPulley :19355-19460）
    p.inputUp = false;
    tick(p, w);
    expect(p.vx).toBe(0);                             // 静挂（hover 归零 :26120-26124）
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(14.5, 5);                // :21619 dash2=14.5×dir（绳上照发）
    expect(p.dashDelay).toBe(-1);                     // :21138 进入滑行态
    expect(p.eocDash).toBe(15);                       // :21627 克盾冲撞窗
    expect(p.pulley).toBe(true);                      // 发起拍仍钉绳（X 吸附已先行,逐出在下一拍）
    tick(p, w);
    expect(p.pulley).toBe(false);                     // :26475 velocity.X≠0 → 落绳
    expect(p.dashDelay).toBe(-1);                     // 滑行离绳照常续跑（:26958 支）——
    //                                                本拍已吃滑行阻尼第 1 拍（主移动支同拍接管）
    expect(p.vx).toBeCloseTo((14.5 - 0.2) * 0.985, 12);   // ★BJ705-G26:落绳拍主移动支
    //  HM else 摩擦(静挂拍末 vy=0 → 接地 −0.2)+阻尼同拍（发起拍绳支无摩擦=14.5 原值）
    injectDash(p, false);
    for (let i = 2; i <= DASH2_GLIDE; i++) {
      tick(p, w);
      expect(p.dashDelay, `落绳滑行第 ${i} 拍须保持 -1`).toBe(-1);
    }
    tick(p, w);                                        // 终止拍
    expect(p.dashDelay).toBe(30);                      // :21567 num17（dash2=30）
    expect(Math.abs(p.vx)).toBe(3);                    // :21570-21575 钳回 ±num15（裸装 3）
    for (let i = 0; i < 30; i++) { injectDash(p, false); tick(p, w); }
    expect(p.dashDelay).toBe(0);                       // 冷却倒数回就绪
  });
});

describe('BJ527② 绳上冷却推进（病灶=绳上 dashDelay 恒冻结）', () => {
  it('挂绳置 dashDelay=25 → 逐拍倒数至 0;就绪后绳上可再发起（触发/滑行钉值同①）', () => {
    const w = ropeWorld();
    const p = hangPlayer(w, 25);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputUp = false;
    tick(p, w);
    p.dashDelay = 25;                                 // 冷却中段直置（状态机注入面）
    for (let i = 24; i >= 1; i--) {
      tick(p, w);
      expect(p.dashDelay, `绳上冷却第 ${25 - i} 拍须= ${i}`).toBe(i);   // :21422 dashDelay--
    }
    tick(p, w);
    expect(p.dashDelay).toBe(0);                      // 回就绪
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(14.5, 5);                // 就绪后绳上再发起
    expect(p.dashDelay).toBe(-1);
    expect(p.pulley).toBe(true);
  });
});

describe('BJ527③ 绳端悬挂支（孤立绳格,branch2 支尾无条件=原版块尾语义）', () => {
  it('绳端静挂发起：发起拍 vx=14.5 仍钉绳,次拍落绳续滑', () => {
    const w = endWorld();
    const p = hangPlayer(w, 25);                      // 头格=孤立绳 → num3=格顶+22 挂绳下沿
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputUp = false;
    tick(p, w);
    expect(p.vy).toBe(0);                             // 绳端钉悬（:26133-26137 vy=0+y 钉位）
    expect(p.dashDelay).toBe(0);
    p.facing = 1;
    armDash(p, w);
    injectDash(p, true);
    tick(p, w);
    expect(p.vx).toBeCloseTo(14.5, 5);                // 绳端支同面发起
    expect(p.dashDelay).toBe(-1);
    expect(p.pulley).toBe(true);
    tick(p, w);
    expect(p.pulley).toBe(false);                     // 落绳
    expect(p.dashDelay).toBe(-1);
  });
});
