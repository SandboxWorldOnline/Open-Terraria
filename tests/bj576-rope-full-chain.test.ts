// ★BJ576 绳索域全链判别（R7-C8 清偿：F1 flag14 绳列滑行支+离绳门收窄 / F2 flag15 收口门）
//   定谳锚（亲读 1457 反编译）：Player.cs :24439-24458 CanMoveForwardOnRope /
//   :26338-26392 flag12 状态机 / :26392-26405 num33+flag13 / :26406-26444 flag14 滑行支 /
//   :26445-26456 离绳支（releaseLeft/Right 单项=按下沿）/ :26457-26460 vx≠0 清除 /
//   :26500-26661 pulley 垂直块（flag15 :26511+:26521-26528 收口+vy<0 钳;攀爬臂
//   controlUp&flag15 :26531;绳端钉 :26648-26652;X 钉 :26653-26661）/
//   :27832-27862 releaseLeft/Right+leftTimer/rightTimer 尾写。
//
//   净语义（F1）：居中档（pulleyDir=1）横按=转身/侧挂（flag12）不离绳；侧挂档
//   （pulleyDir=2）同向持键=滑行（绳在前,flag14,y 钉 num30*16+22,碰撞回退 ±6px）
//   或静挂；离绳仅「侧挂档+朝向侧按下沿+前方无绳」可达（:26445 三重前置门）。
//   净语义（F2）：(y−16) 行（num37）非绳 → 攀爬臂不可达（:26531）+vy<0 钳 0
//   （:26523-26526）——头格止于顶绳格 pulley 恒真静悬（旧无门=越顶弹飞+振荡）。
//
//   伪锚翻正登记：T11（tests/bj559-rope-pulley-draw.test.ts）左右键面、string-anchor
//   fixedUpdate 集成面「松上键持横移→离绳+vx≈1.08」——两处旧断言把「持键即离」
//   偏差钉为现役形,本刀同步重钉（详见各自用例内 ★BJ-C8 注）。
//
// 变异证红映射（本文件）：
//   M1 摘 flag14 滑行支            → S1/S2/S3 红（滑行位离绳支接管=pulley 假）
//   M2 摘碰撞回退 ±6               → S2 红（x=622 非 628/pulleyDir=1 非 2）
//   M3 摘 leftTimer 尾写           → S3 红（6/8 拍再触发 cadence 断）
//   M4 离绳门回退「持键即离」       → L1 红（居中档横按误离绳）
//   M5 摘 flag15 vy<0 钳           → C1 红（越顶 pulley=false+漂移;C2/C3 绿=门仍拦攀爬臂）
//   M6 摘 ropeClimbVy flag15 门    → C1/C2/C3 红（攀爬臂越顶复动;C1 连带=M5 差异面）
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';

const ROPE_T = TILE_INTERNAL_BY_SHEET.get(213)!;   // 绳 213（本仓内部 id 反查,BJ527 同款）
const W = 80, H = 80;
const ROPE_COL = 40;

/** 竖直绳柱 rows 14..34（BJ559/BJ527 ropeWorld 同款） */
function ropeWorld(): World {
  const w = new World(W, H, 11, 'bj576');
  for (let y = 14; y <= 34; y++) w.store.setTileSilent(ROPE_COL, y, ROPE_T);
  return w;
}

/** 横排绳桥 row 25 cols 36..44（flag14 滑行域） */
function bridgeWorld(solid?: { x: number; y: number }): World {
  const w = new World(W, H, 11, 'bj576-bridge');
  for (let x = 36; x <= 44; x++) w.store.setTileSilent(x, 25, ROPE_T);
  if (solid) w.store.setTileSilent(solid.x, solid.y, 1, 1, 0);   // 实心块（ stone 直置）
  return w;
}

/** 两格短柱 rows 20..21（branch2 midRope×flag15 双态域） */
function shortColumnWorld(): World {
  const w = new World(W, H, 11, 'bj576-short');
  w.store.setTileSilent(ROPE_COL, 20, ROPE_T);
  w.store.setTileSilent(ROPE_COL, 21, ROPE_T);
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

const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };
const hangHead24 = (w: World): Player => {
  const p = new Player(ROPE_COL * TILE + 8 - 10, 24 * TILE + 8, new Inventory());
  p.hp = 500;
  return p;
};

// ================= S1-S3 flag14 绳列滑行支（:26406-26444+计时器 :27832-27862） =================

describe('BJ576 S1-S3 flag14 横排绳桥滑行（:26406-26444）', () => {
  it('S1 侧挂档按沿→滑到前方格：x 吸格中心/y 钉 num30*16+22/pulleyDir 归 1（M1 变异位）', () => {
    const w = bridgeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 25 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);                   // 桥上抓绳（孤立格 y 钉 25*16+22）
    expect(p.y).toBe(25 * TILE + 22);              // FindPulley 孤立格钉（:19806 同构）
    p.inputUp = false;
    tick(p, w);                                    // 静挂 settle（branch2 绳端钉,y 不动）
    p.pulleyDir = 2; p.facing = -1;                // 侧挂档注入（机器路径→L1;此处直测 flag14 面）
    p.inputLeft = true; p.inputX = -1;
    tick(p, w);
    expect(p.pulley, '滑行不离绳').toBe(true);
    expect(p.pulleyDir).toBe(1);                   // :26412
    expect(p.facing).toBe(-1);                     // :26413
    expect(p.x).toBe(39 * TILE + 8 - 10);          // :26439 滑到前方格中心（622）
    expect(p.y).toBe(25 * TILE + 22);              // :26441 y 钉 num30*16+22
    expect(p.gfxOffY).toBe(0);                     // :26440 覆写=y−y2（本例同位=0）
    expect(p.vx).toBe(0);                          // 滑行非离绳,无 vx 推量
  });

  it('S2 碰撞回退 ±6px：目标位实心→侧挂目标格近侧+转向（:26429-26434,M2 变异位）', () => {
    // 阻挡块 (38,27)：与滑行目标盒 [622,642)×[422,464) 相交、与源盒 [638,658) 不相交
    const w = bridgeWorld({ x: 38, y: 27 });
    const p = new Player(ROPE_COL * TILE + 8 - 10, 25 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputUp = false;
    tick(p, w);
    p.pulleyDir = 2; p.facing = -1;
    p.inputLeft = true; p.inputX = -1;
    tick(p, w);
    expect(p.pulley).toBe(true);                   // 回退仍挂绳
    expect(p.pulleyDir).toBe(2);                   // :26431
    expect(p.facing).toBe(1);                      // :26432 direction=−num33
    expect(p.x).toBe(39 * TILE + 8 - 10 + 6);      // :26433 回退 +6·direction（628）
    expect(p.y).toBe(25 * TILE + 22);              // y 钉照走（:26441 无条件）
  });

  it('S3 持键 8 拍再触发 cadence：滑行→6 拍侧挂→8 拍滑行（timer 尾写 :27832-27862,M3 变异位）', () => {
    const w = bridgeWorld();
    const p = new Player(ROPE_COL * TILE + 8 - 10, 25 * TILE + 8, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    p.inputUp = false;
    tick(p, w);
    p.pulleyDir = 2; p.facing = -1;
    p.inputLeft = true; p.inputX = -1;
    tick(p, w);
    expect(p.x).toBe(39 * TILE + 8 - 10);          // 按沿滑行（slide #1,pulleyDir→1,现居列 39）
    for (let i = 0; i < 5; i++) tick(p, w);        // 持键非沿非 timer==0 → 静止
    expect(p.x).toBe(39 * TILE + 8 - 10);
    tick(p, w);                                    // 第 6 拍 leftTimer==0 → flag12 侧挂支先行（:26345-26349）
    expect(p.pulleyDir).toBe(2);
    expect(p.x).toBe(39 * TILE + 8 - 10 - 6);      // X 钉【所在列 39】中心+6·direction（616）
    for (let i = 0; i < 7; i++) tick(p, w);        // 侧挂档机器不消费 timer → 静止
    expect(p.x).toBe(39 * TILE + 8 - 10 - 6);
    tick(p, w);                                    // 侧挂后第 8 拍 leftTimer==0 → flag14 滑行（pulleyDir==2 不设 flag12）
    expect(p.pulleyDir).toBe(1);
    expect(p.x).toBe(38 * TILE + 8 - 10);          // slide #2（606）
    expect(p.pulley).toBe(true);
  });
});

// ================= L1 离绳三支（:26338-26392 状态机+:26445-26456 离绳门） =================

describe('BJ576 L1 离绳三支（居中转身/侧挂静挂/按沿离绳,M4 变异位）', () => {
  it('居中档横按=转身不离绳;朝向侧按沿=侧挂;持键静挂;新沿+前方无绳=离绳 vx=−1', () => {
    const w = ropeWorld();
    const p = hangHead24(w);
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    p.inputUp = false;
    // ① 居中档横按（按沿）→ 转身（flag12 :26356-26360）不离绳
    p.inputLeft = true; p.inputX = -1;
    tick(p, w);
    expect(p.pulley, '居中档横按=转身不离绳（旧伪锚「持键即离」翻正面）').toBe(true);
    expect(p.facing).toBe(-1);
    expect(p.vx).toBe(0);
    p.inputLeft = false; p.inputX = 0;
    tick(p, w);
    // ② 居中档朝向侧按沿 → 侧挂档（:26345-26349）不离绳,X 钉中心−6
    p.inputLeft = true; p.inputX = -1;
    tick(p, w);
    expect(p.pulley).toBe(true);
    expect(p.pulleyDir).toBe(2);
    expect(p.x).toBe(ROPE_COL * TILE + 8 - 10 - 6);
    // ②续 持键不放 → 静挂（离绳门要求 releaseLeft 按沿,:26445）
    for (let i = 0; i < 5; i++) tick(p, w);
    expect(p.pulley).toBe(true);
    expect(p.x).toBe(ROPE_COL * TILE + 8 - 10 - 6);
    // ③ 松键→再按（新沿）+前方无绳 → 离绳+vx=−1（:26445-26456）
    p.inputLeft = false; p.inputX = 0;
    tick(p, w);
    p.inputLeft = true; p.inputX = -1;
    tick(p, w);
    expect(p.pulley, '侧挂+朝向侧按下沿+前方无绳→离绳').toBe(false);
    expect(p.vx).toBeLessThan(0);
  });

  it('侧挂档背绳侧按沿+回中位无碰撞 → 回中归位（:26369-26392 回中支）', () => {
    const w = ropeWorld();
    const p = hangHead24(w);
    p.inputUp = true;
    tick(p, w);
    p.inputUp = false;
    p.pulleyDir = 2; p.facing = 1;                 // 右侧挂注入
    p.inputLeft = true; p.inputX = -1;             // 向绳侧按（左）
    tick(p, w);
    expect(p.pulley).toBe(true);
    expect(p.pulleyDir).toBe(1);                   // :26376-26378 回中
    expect(p.facing).toBe(-1);                     // :26377 direction=−1
    expect(p.x).toBe(ROPE_COL * TILE + 8 - 10);    // X 钉列中心
  });
});

// ================= C1-C3 flag15 收口门（:26521-26528+:26531,M5/M6 变异位） =================

describe('BJ576 C1-C3 flag15 越顶收口（(y−16) 行门+vy<0 钳）', () => {
  it('C1 branch1 攀至柱顶：vy 钳 0+头格止于顶绳格 pulley 恒真静悬（M5 变异位）', () => {
    const w = ropeWorld();
    const p = hangHead24(w);
    p.inputUp = true;                              // ★BJ737-A：攀爬键=W（inputUp,:26531 controlUp）——Space 并设即 findPulley 拒抓+绳上跳离
    tick(p, w);                                    // 抓绳拍（pulley 当拍置位）
    expect(p.pulley).toBe(true);
    let pulleyFalseTicks = 0;
    for (let i = 0; i < 200; i++) {                // 攀至顶（vy −0.2/t 加速到 −8）
      tick(p, w);
      if (!p.pulley) pulleyFalseTicks++;
    }
    expect(pulleyFalseTicks, '攀爬全程 pulley 恒真（★瞬态判别:无 vy<0 钳=满速 −8 首达顶必越顶出口≥1 拍再坠落回抓——M5 变异位;收敛后终态同位故终态断言不可判,须判过程）').toBe(0);
    expect(p.pulley).toBe(true);
    expect(p.vy).toBe(0);                          // :26523-26526 越顶拍钳 0+idle 臂归零
    expect(p.y).toBeGreaterThanOrEqual(14 * TILE); // 头格不出顶绳格（head row=14 ⟺ y∈[224+8,240)）
    expect(p.y).toBeLessThan(15 * TILE);
    const yTop = p.y;
    p.inputUp = false;
    for (let i = 0; i < 12; i++) tick(p, w);       // 松键静悬 12 拍
    expect(p.pulley).toBe(true);
    expect(p.vy).toBe(0);
    expect(p.y).toBe(yTop);                        // 静悬零漂移（绳端钉/收口钳双稳态）
  });

  it('C2 branch2 顶格（(y−16) 行已出绳）：攀爬臂不可达,持攀爬键 y 钉位不动（M6 变异位）', () => {
    const w = shortColumnWorld();                  // 两格柱 rows 20..21
    // 头格行 20（顶格）、y=333 ∈ [331,336) → (y−16)/16=19（空中）→ flag15 假;
    // 身体中心行 22（空中）→ branch2;midRope=行 21 绳 → midRope 臂+flag15 假
    const p = new Player(ROPE_COL * TILE + 8 - 10, 333, new Inventory());
    p.hp = 500;
    p.inputUp = true;
    tick(p, w);
    expect(p.pulley).toBe(true);
    expect(p.y).toBe(333);                         // 非孤立格→y 不钉（FindPulley num3=y）
    // ★BJ737-A：持攀爬键=W（inputUp 持续按住——原 inputJump 并设即触发 :26481 跳离臂）
    for (let i = 0; i < 30; i++) tick(p, w);
    expect(p.pulley).toBe(true);
    expect(p.vy).toBe(0);
    expect(p.y).toBe(333);                         // 攀爬臂 controlUp&flag15 拒→y 钉位（M6：无门则 vy<0 爬飞）
  });

  it('C3 branch2 底格起攀：flag15 真段照爬、顶格收口停（链路双态,M5/M6 变异位）', () => {
    const w = shortColumnWorld();
    // 头格行 21（底格）、y=349 ∈ [347,352) → (y−16)/16=20（绳）→ flag15 真→可爬;
    // 身体中心行 23（空中）→ branch2
    const p = new Player(ROPE_COL * TILE + 8 - 10, 349, new Inventory());
    p.hp = 500;
    p.inputUp = true;                              // ★BJ737-A：攀爬键=W 单键面（同 C1 注）
    tick(p, w);
    expect(p.pulley).toBe(true);
    for (let i = 0; i < 60; i++) tick(p, w);
    expect(p.pulley).toBe(true);
    expect(p.vy).toBe(0);                          // 顶格（行 20）收口钳 0
    expect(p.y).toBeGreaterThanOrEqual(20 * TILE); // 头格止于顶绳格行 20（y∈[328,336)）
    expect(p.y).toBeLessThan(21 * TILE);
    expect(p.y).toBeLessThan(349);                 // 确已爬升（flag15 真段链路通）
  });
});
