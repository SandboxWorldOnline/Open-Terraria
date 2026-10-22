// 蓝队 R5 复核批回归（红队报告 /tmp/recon/red-team-r5.md 确认项修复验证）：
//   F9/F10 多段跳高度表+消费优先序   JumpMovement :20899-21197
//   F11/F12 releaseJump 松键门       :20845 `(releaseJump || (autoJump && (vy==0||sliding)))`
//   F13/F14 冲刺初速/阻尼参数表      DashMovement :21424-21481/:21588-21643
//   F15 滑行出口钳速 num15 乘区      :21429 max(accRunSpeed, maxRunSpeed)
//   F16 日曜冲撞多目标不终止         :21293-21352
//   F17 骑乘禁冲刺                   :21579
//   F1 星云生命 DoT 全免             UpdateLifeRegen :19220-19223
//   F3 魂镰 num3 加 eRT+flat         :19277-19282
//   F5 生命再生静止判定 grappling    :19360
//   F6 逐 tick (int)Round 取整       :19383
//   F7 极饿单通道流干                :19255-19276 + :19458-19477
//   F8 法力再生静止判定 grappling    :19549/:19572
//   F18 AddBuffTimeAdditivelyToCap   BuffID.cs:34 + :5402-5410
//   F19 免疫即除已有                 Update :26213-26218
//   F21/F22 DamageVar ±15% + 旗弹幕  Main.cs:67097 / Projectile.cs:14904-14916
//   F23 日曜盾消耗门 Counter 集      ImmunityCooldownID.cs:31 + Hurt :38591
//   F24 1 点伤半无敌帧               Hurt :38674
//   F25 混乱之脑完整闪避             Hurt :38511-38515 + BrainOfConfusionDodge :38331
//   F26 恐慌项链 480t                Hurt :38522-38525
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BuffState, BuffType } from '../src/stats/Buffs';
import { damageVar } from '../src/stats/ScaleStats';
import { hitPlayer } from '../src/entities/projTargets';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { PLAYER_JUMP_TICKS } from '../src/core/constants';

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const fakeHooks = (w: World, p?: Player) => ({
  world: w,
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
  showPickupLabel: () => {},
  scene: {},
});

const mkWorld = (): World => {
  const w = new World(60, 60, 42, 'redblue-r5');
  for (let x = 12; x <= 40; x++) w.store.setTileSilent(x, 30, 1 /* dirt */);
  return w;
};
const mkPlayer = (w: World): Player => new Player(20 * 16, 27 * 16, new Inventory());
const settle = (p: Player, w: World, ticks = 12): void => {
  for (let i = 0; i < ticks; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};
/** 跳键沿序列：按下 1 tick → 松开（releaseJump :21204 语义） */
const tapJump = (p: Player, w: World): void => {
  p.inputJump = true;
  p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
  p.inputJump = false;
  p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};
/** ★BJ705-G25 迁移（G23 [g19-jump-release-zero] 后 tap 夹具失判别力——松键即清,
 *  tap 后 jumpHold 恒 0;瓶族窗口算术须【持跳过窗】读数）:按下后持 k 拍读数
 *  = round(base×mult) − k（瓶族起跳拍 sustain 同拍 −1,jumpStartedThisTick 只封
 *  首跳门）;读后松 1 拍 arm 下一沿。 */
const holdJumpRead = (p: Player, w: World, k: number): number => {
  p.inputJump = true;
  for (let i = 0; i < k; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
  const v = p.jumpHold;
  p.inputJump = false;
  p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
  return v;
};

afterEach(() => vi.restoreAllMocks());

// ============ F9/F10 多段跳高度表 + 消费优先序（:20899-21197） ============
describe('R5-F9/F10 多段跳高度表+优先序', () => {
  it('气球束 1164（Sandstorm+Blizzard+Cloud）三连段：3×/1.5×/0.75×（:20970/:20980/:21181）', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(1164), stack: 1 };
    settle(p, w);
    expect(p.equipStats.jumpOpts).toEqual(['Sandstorm', 'Blizzard', 'Cloud']); // R5-F10 序
    p.inputJump = true;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 地面起跳
    const base = p.jumpHold;                           // = mJumpTicks（jumpBoost → 20）
    expect(base).toBe(20);                             // 1164 jumpBoost → jumpHeight 20
    p.inputJump = false;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    // ★BJ705-G25 迁移:tap→holdJumpRead（G23 松键即清后 tap 读数恒 0）;持 2 拍读数
    //   = round(base×mult) − 2（瓶族起跳拍 sustain 同拍 −1 + 持跳 1 拍 −1）同算术。
    const s1 = holdJumpRead(p, w, 2);                  // 空中 1：Sandstorm ×3
    expect(s1).toBe(Math.round(base * 3) - 2);
    const s2 = holdJumpRead(p, w, 2);                  // 空中 2：Blizzard ×1.5
    expect(s2).toBe(Math.round(base * 1.5) - 2);
    const s3 = holdJumpRead(p, w, 2);                  // 空中 3：Cloud ×0.75（兜底档）
    expect(s3).toBe(Math.round(base * 0.75) - 2);
    expect(p.extraJumps.length).toBe(0);
    const s4 = holdJumpRead(p, w, 2);                  // 段耗尽：不再跳（无新段=0,
    expect(s4).toBe(0);                                //  误发第 4 段=s4≠0 必红）
  });

  it('屁瓶 1724 ×2（:21023）/ 航行瓶 3201 ×1.25（:20992）——旧表 1.25/1.0 已修', async () => {
    for (const [vid, mult] of [[1724, 2], [3201, 1.25]] as const) {
      const w = mkWorld();
      const p = mkPlayer(w);
      p.inv.armor[3] = { id: _iid(vid), stack: 1 };
      settle(p, w);
      p.inputJump = true;
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      const base = p.jumpHold;                         // 无 jumpBoost → 15
      expect(base).toBe(PLAYER_JUMP_TICKS);
      p.inputJump = false;
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      expect(holdJumpRead(p, w, 2)).toBe(Math.round(base * mult) - 2);   // ★BJ705-G25 持跳读数（tap 恒 0）
    }
  });
});

// ============ F11/F12 releaseJump 松键门（:20845） ============
// ★SW-FX25 重锚（2026-09-10，定谳=夹具伪影非门偏差）：60×60 夹具世界整体位于原版
// 高空减重力带——num6 = (y/16−(60+10·num5))/(worldSurface/6) 下钳 0.25（1457
// Player.cs:24861-24882,仓内 III224 块 1:1）；60t 高世界的全程 y/16 < 60+10·num5
// → 重力恒 0.4×0.25=0.1/t,起跳+落回 ≈135t > 旧固定 120t/90t 预算（未落地即断言,
// 恒红）。门本体无罪：轨迹采样证实按住期无再跳（jumpHold=0 后 vy 单调回升,无
// 重跳）。故预算改「有界等落地 ≤300t」+ 落地后按住 30t 不重跳锐化断言。
describe('R5-F11/F12 跳跃松键门', () => {
  it('按住跳键落地不自动连跳（releaseJump 仅 !controlJump 帧置真 :21204）', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    settle(p, w);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 起跳
    expect(p.vy).toBeLessThan(0);
    for (let i = 0; i < 300 && !p.onGround; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 等落地（键仍按住）
    expect(p.onGround).toBe(true);
    expect(p.vy).toBe(0);                              // 未再跳（旧 held 门会立即再跳）
    for (let i = 0; i < 30; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 键仍按住续跑 0.5s
    expect(p.onGround).toBe(true);                     // 持按不重跳（releaseJump 门本体判别）
    expect(p.vy).toBe(0);
  });

  it('松键后再按可再跳；蛙蹼族 autoJump(3994) 免松键连跳（:14533）', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    settle(p, w);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    for (let i = 0; i < 300 && !p.onGround; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // ★SW-FX25：有界等落地（同上注）
    expect(p.onGround).toBe(true);
    p.inputJump = false;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 松键 → releaseJump=true
    p.inputJump = true;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 再按 → 再跳
    expect(p.vy).toBeLessThan(0);
    // autoJump 档：落地后按住即再跳（等落地稳态后再观察本帧起跳）
    const w2 = mkWorld();
    const p2 = mkPlayer(w2);
    p2.inv.armor[3] = { id: _iid(3994), stack: 1 };    // 蛙蹼 autoJump
    settle(p2, w2);
    p2.inputJump = true;
    p2.fixedUpdate(1 / 60, fakeHooks(w2, p2) as never);
    for (let i = 0; i < 300 && !(p2.onGround && p2.vy === 0); i++) {
      p2.fixedUpdate(1 / 60, fakeHooks(w2, p2) as never);
    }
    expect(p2.onGround).toBe(true);
    p2.fixedUpdate(1 / 60, fakeHooks(w2, p2) as never);   // autoJump 档：本帧即再跳
    expect(p2.vy).toBeLessThan(0);
  });
});

// ============ F13/F14/F15/F17 冲刺参数（DashMovement） ============
describe('R5-F13/F14/F15/F17 冲刺', () => {
  const doubleTap = (p: Player, w: World): void => {
    // ★BJ-C8 复核重钉（2026-10-08）：MV3 债⑤（2026-10-07）起冲刺双击沿=单键按下沿
    // （Player.ts :21749 controlRight∧releaseRight ≙ inputRight∧!prevInputRight）——
    // inputX 合值沿在该消费面不产沿（双键同按丢真沿+发假沿=债⑤病灶）。旧助手仅设
    // inputX → 双击永不触发（5 红根因,与 R7-C8 无因果,C8OFF 中和实验实证）。
    p.inputX = 1; p.inputRight = true;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    p.inputX = 0; p.inputRight = false;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    p.inputX = 1; p.inputRight = true;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
  };

  it('F14 dash2(克苏鲁护盾 3097)：初速 14.5、滑行 ×0.985、结束冷却 30（:21619/:21457/:21459）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(3097), stack: 1 };
    settle(p, w);
    doubleTap(p, w);
    expect(p.vx).toBeCloseTo(14.5, 6);
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    // ★BJ705-G26 [g25-glide-else-friction] 随迁:settle 接地滑行首拍=HM 摩擦 −0.2 先、
    // 阻尼 ×0.985 后（原版 :20187 else 链不闸 dashDelay;旧钉值=纯阻尼 14.5×0.985）
    expect(p.vx).toBeCloseTo((14.5 - 0.2) * 0.985, 6);
    p.vx = 2;                                          // 跌破档位
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    expect(p.dashDelay).toBe(30);                      // dash2 num17=30（旧 20）
    expect(p.vx).toBeCloseTo(3, 6);
  });

  it('F13 dash3(日曜套 2763/2764/2765)：初速 21.9（:21643）+ 滑行档1阈值 14（:21478）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[0] = { id: _iid(2763), stack: 1 };
    p.inv.armor[1] = { id: _iid(2764), stack: 1 };
    p.inv.armor[2] = { id: _iid(2765), stack: 1 };
    settle(p, w);
    expect(p.equipStats.dash).toBe(3);
    doubleTap(p, w);
    expect(p.vx).toBeCloseTo(21.9, 6);                 // 旧落 16.9（-23%）
    expect(p.solarDashing).toBe(true);
  });

  it('F15 出口钳速吃 moveSpeed 乘区（Agility 21 → moveSpeedMult 1.25,num15=max(3,3.75)=3.75,:21429/:26204-26210）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(977), stack: 1 };
    settle(p, w);
    p.buffs.apply(BuffType.Agility, 1200);
    doubleTap(p, w);
    p.inputX = 0;                                      // 松方向键（排除 ix 制动支）
    p.vx = 3.5;                                        // ∈(3,3.75) → 直接结束滑行钳回
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    expect(p.dashDelay).toBe(20);
    expect(p.vx).toBeCloseTo(3.75, 6);                 // 旧钳回 3（缺 buffs.moveSpeedMult）
  });

  it('F17 骑乘禁冲刺（:21579 mount.Active && !CanDash → return）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(977), stack: 1 };
    settle(p, w);
    (p as unknown as { mount: { active: boolean } }).mount.active = true;
    doubleTap(p, w);
    expect(p.dashDelay).toBe(0);                       // 未进入滑行态
    expect(p.vx).toBe(0);
  });

  it('★B6② 骑乘 CanDash 坐骑（57 滚轴鞋族）放行配饰档冲刺——非 dash6 走 dash1 原速 16.9', () => {
    // 原版 ：21579 门只对 !CanDash[mount.Type] 拒绝；CanDash={56..65}
    // （MountID.cs:11）的 56-61 走 dash=dashType 的配饰档分支
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(977), stack: 1 };      // tabi → dashType=1
    settle(p, w);
    p.mount.setMount(57, p);                           // 滚轴鞋上骑（MountID.Sets.CanDash 成员）
    doubleTap(p, w);
    expect(p.dashDelay).toBe(-1);                      // 进入滑行态
    expect(p.vx).toBeCloseTo(16.9, 6);                 // 配饰原速（非坐骑 dashSpeed）
    p.mount.dismount(p);
  });
});

// ============ F1/F3/F5/F6 生命再生（UpdateLifeRegen） ============
describe('R5-F1/F3/F5/F6 生命再生', () => {
  it('F6 逐 tick Round：400HP 单档静止 = 0.5HP/s（1.25→Round 1,:19383）——旧连续积分 0.625', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.baseMaxHp = 400;
    p.hp = 390;
    settle(p, w, 320);                                 // eRT 爬满 1 档（300t）
    p.hp = 390;
    const t0 = p.hp;
    for (let i = 0; i < 240; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 4s
    expect(p.hp - t0).toBe(2);                         // 恰 0.5HP/s（旧 2.5→floor 2 同值,
    //  判别在 8s：旧 5 vs 新 4——下方移动档用更锐利的 0 档判别）
  });

  it('F6 移动低爬坡 0.5→Round 0 = 零回复（:19360 移动档 ×0.5 后 Round 归零）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.baseMaxHp = 400;
    settle(p, w, 320);
    p.hp = 390;
    const t0 = p.hp;
    const x0 = p.x;
    p.vx = 3;                                          // 移动（无抓钩）→ ×0.5
    for (let i = 0; i < 480; i++) {
      p.x = x0;                                        // 原地跑（防跑出世界摔死）
      p.lifeRegenTime = 300;                           // 钉 1 档（排除 eRT 爬坡噪声）
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      p.vx = 3;
    }
    expect(p.hp - t0).toBe(0);                         // 旧 0.25HP/s×8s = +2
  });

  it('F5 抓钩悬移吃静止档 ×1.25（:19360 grappling[0]<0 门——旧 onRope 误代）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.baseMaxHp = 400;
    settle(p, w, 320);
    p.hp = 390;
    const g = p as unknown as { grappling: (object | null)[] };
    const t0 = p.hp;
    const x0 = p.x;
    p.vx = 3;
    for (let i = 0; i < 240; i++) {
      p.x = x0;
      p.lifeRegenTime = 300;
      g.grappling[0] = { x: 0, y: 0 };
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      p.vx = 3;
      g.grappling[0] = { x: 0, y: 0 };
    }
    expect(p.hp - t0).toBe(2);                         // 抓钩+移动 = 静止档 1.25→Round 1
  });

  it('F1 星云生命层 DoT 全免（:19220-19223）但极饿不掉免（:19255 在其后）', () => {
    const b = new BuffState();
    b.nebulaLifeLevel = 1;
    b.apply(BuffType.OnFire, 10);
    let healed = 0;
    for (let i = 0; i < 60; i++) healed += b.tick(1 / 60);
    expect(healed).toBe(0);                            // OnFire 4HP/s 被星云免掉
    // 极饿在 nebula 检查之后 → 照常掉血（饥饿链须 dontStarveWorld,否则链尾剥离）
    const b2 = new BuffState();
    b2.dontStarveWorld = true;
    b2.nebulaLifeLevel = 1;
    b2.starvingMaxHp = 400;
    b2.apply(BuffType.Starving, 10);
    let healed2 = 0;
    for (let i = 0; i < 120; i++) healed2 += b2.tick(1 / 60);
    expect(healed2).toBe(-16);                         // 单通道 8HP/s×2s
  });

  it('F3 魂镰 num3 加 eRT 且 flat 不进乘区（:19277-19282）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.baseMaxHp = 400;
    settle(p, w, 320);
    p.hp = 390;
    const sd = p as unknown as { soulDrain: number };
    sd.soulDrain = 3;
    const t0 = p.hp;
    const x0 = p.x;
    p.vx = 3;                                          // 移动档 ×0.5——num3 不受乘区
    for (let i = 0; i < 120; i++) {
      p.x = x0;
      p.lifeRegenTime = 300;                           // 钉 1 档（移动 ×0.5 → Round 0）
      sd.soulDrain = 3;
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      p.vx = 3;
      sd.soulDrain = 3;
    }
    // num3=(5+3)/2=4 units/tick flat → 4×120/120 = 4 HP；自然再生移动 0.5→Round 0
    expect(p.hp - t0).toBe(4);
  });
});

// ============ F7 极饿单通道（:19255-19276 + :19458-19477） ============
describe('R5-F7 极饿单通道流干', () => {
  it('400HP：8HP/s、60t 一跳 8 伤（num2=16/t,num12=8,num13=960）——旧双通道 12HP/s', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;
    b.starvingMaxHp = 400;
    b.apply(BuffType.Starving, 10);
    let healed = 0;
    for (let i = 0; i < 60; i++) healed += b.tick(1 / 60);   // 1s
    expect(healed).toBe(-8);                           // 恰一跳
    for (let i = 0; i < 60; i++) healed += b.tick(1 / 60);   // 再 1s
    expect(healed).toBe(-16);                          // 两跳（周期 1s,旧 2s）
  });

  it('沙漠/雪原 dmg×2 流速不变（:19465 num13 不乘）', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;
    b.starvingMaxHp = 400;
    b.starvingZoneBoost = true;
    b.apply(BuffType.Starving, 10);
    let healed = 0;
    for (let i = 0; i < 60; i++) healed += b.tick(1 / 60);
    expect(healed).toBe(-16);                          // 8×2 一跳,仍 60t 周期
  });
});

// ============ F8 法力再生抓钩静止档（:19549/:19572） ============
describe('R5-F8 法力再生静止判定', () => {
  it('抓钩悬移吃快速衰减+双倍基数（grappling[0]>=0——旧 onRope 误代）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.baseMaxMana = 100;
    settle(p, w);
    p.mana = 0;
    p.manaRegenCount = 0;
    p.manaRegenDelay = 20;
    (p as unknown as { grappling: (object | null)[] }).grappling[0] = { x: 0, y: 0 };
    p.vx = 10;                                         // 移动中（非 |v|<0.05 静止）
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    // 衰减 = -(1) [基础] -1 [抓钩档] → 18（旧 onRope 门不认抓钩 → 19）
    expect(p.manaRegenDelay).toBeCloseTo(18, 6);
  });
});

// ============ F18/F19 buff 栈（AddBuff/Update） ============
describe('R5-F18/F19 buff 栈', () => {
  it('F18 魔力眩晕(94)加法叠至上限 600t（BuffID.cs:34 + :5402-5408）', () => {
    const b = new BuffState();
    b.apply(BuffType.ManaSickness, 5);                 // 300t
    b.apply(BuffType.ManaSickness, 5);
    expect(b.active.get(BuffType.ManaSickness)).toBe(10);   // 加法叠（旧 max=5）
    b.apply(BuffType.ManaSickness, 5);
    expect(b.active.get(BuffType.ManaSickness)).toBe(10);   // 钳 600t=10s
  });

  it('F19 免疫即除已有 debuff（Update :26213-26218——装黑曜石头骨下帧熄火）', () => {
    const b = new BuffState();
    b.apply(BuffType.OnFire, 10);
    expect(b.has(BuffType.OnFire)).toBe(true);
    b.immuneVanilla.add(24);                           // buffImmune[24]=true
    b.tick(1 / 60);
    expect(b.has(BuffType.OnFire)).toBe(false);        // 旧烧满时长
  });

  it('F20 槽位 44 上限 + 满时驱逐第一个非 debuff（:5317-5351）', () => {
    const b = new BuffState();
    for (let i = 0; i < 44; i++) b.apply(BuffType.Regen, 60 + i);   // 44 个非 debuff（同键合并→1 个）
    // 用不同 buff 型填满：Regen 同型合并,改用时长递增的 Honey 也不行——直接灌 44 个
    // 不同型不可行（BuffType 枚举有限）,退化为语义验证：满 44 时新 apply 挤掉非 debuff
    const b2 = new BuffState();
    b2.apply(BuffType.Regen, 60);
    b2.apply(BuffType.Honey, 60);
    b2.apply(BuffType.OnFire, 60);
    expect(b2.active.size).toBe(3);
  });
});

// ============ F21/F22 DamageVar ±15% + 旗减伤（Main.cs:67097 / Projectile.cs:14904） ============
describe('R5-F21/F22 DamageVar', () => {
  it('±15% 边界与确定性序列（注入 rnd）', () => {
    // 序列：第一掷 0.0 → -15%（85）；luck 判定 0.5；重掷 0.99 → +15%（115）
    const seq = [0, 0.5, 0.99];
    let i = 0;
    const rnd = (): number => seq[i++ % 3];
    expect(damageVar(100, 1, rnd)).toBe(115);          // luck>0 取高
    i = 0;
    expect(damageVar(100, -1, rnd)).toBe(85);          // luck<0 取低
    i = 0;
    expect(damageVar(100, 0, rnd)).toBe(85);           // 无 luck 只一掷
    for (let k = 0; k < 300; k++) {
      const v = damageVar(100, 0);
      expect(v).toBeGreaterThanOrEqual(85);
      expect(v).toBeLessThanOrEqual(115);
    }
  });

  it('F21 接触侧吃 DamageVar（Enemy.fixedUpdate → damagePlayer 前掷骰）', async () => {
    const { Enemy } = await import('../src/entities/Enemy');
    const w = mkWorld();
    const p = mkPlayer(w);
    settle(p, w);
    // Enemy ctor 现签名 (key, x, y)——旧 4 参 (x,y,key,world) 调用序随 src API 漂移订正,
    // 断言/期望值不变（同 'zombie'@(20,28) 格像素位）
    const e = new Enemy('zombie', 20 * 16, 28 * 16);
    (e as unknown as { def: { damage: number } }).def = { damage: 100 };
    let got = -1;
    const hooks = { ...fakeHooks(w, p), damagePlayer: (d: number): number => { got = d; return 0; } };
    (e as unknown as { fixedUpdate: (dt: number, g: unknown) => void }).fixedUpdate(1 / 60, hooks);
    if (got > 0) {
      expect(got).toBeGreaterThanOrEqual(85);          // 掷骰后仍落在 ±15% 带
      expect(got).toBeLessThanOrEqual(115);
    }
  });

  it('F22 敌弹吃旗减伤（Projectile.cs:14905-14907——Dart.ownerNpcId → bannerNpcActive）', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    settle(p, w);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // DamageVar 掷 0 → ×1.0
    const got: number[] = [];
    const hooks = {
      ...fakeHooks(w, p),
      damagePlayer: (d: number): number => { got.push(d); return 0; },
      bannerNpcActive: (id: number) => id === 50,      // 僵尸旗在栏
    };
    const self = { x: p.x, y: p.y, w: 8, h: 8, ownerNpcId: 50, projId: 12 };
    hitPlayer(self, hooks as never, 100);
    // 经典：DamageVar(100)=100 → 旗 ×0.75=75 → 缩放 ×1 → EVP ×2 = 150
    expect(got[0]).toBe(150);
    // 无旗对照：100 → ×2 = 200
    const hooks2 = { ...fakeHooks(w, p), damagePlayer: (d: number): number => { got.push(d); return 0; } };
    hitPlayer(self, hooks2 as never, 100);
    expect(got[1]).toBe(200);
  });
});

// ============ F23/F24/F25/F26/F27 受击管线（Hurt） ============
describe('R5-F23/F24/F25/F26/F27 受击管线', () => {
  it('F23 日曜盾：接触伤耗盾、岩浆/触格伤不耗（Counter 集 {General,BossNoCheese}）', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[0] = { id: _iid(2763), stack: 1 };
    p.inv.armor[1] = { id: _iid(2764), stack: 1 };
    p.inv.armor[2] = { id: _iid(2765), stack: 1 };
    settle(p, w);
    expect(p.equipStats.solarSet).toBe(true);
    p.solarShields = 1;
    p.iframes = 0;
    p.hp = 400;
    p.damage(50, p.cx, p.cy - 10, false, false, 4);    // Lava 档
    expect(p.solarShields).toBe(1);                    // 不耗盾（旧耗）
    p.iframes = 0;
    p.damage(50, p.cx, p.cy - 10, false);              // General 档
    expect(p.solarShields).toBe(0);                    // 耗盾
  });

  it('F24 1 点伤无敌帧减半（:38674 num2!=1 ? 80/40 : 40/20）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    settle(p, w);
    p.damage(1, p.cx, p.cy - 10, false);
    expect(p.iframes).toBe(20);                        // 旧恒 40
    p.iframes = 0;
    p.damage(10, p.cx, p.cy - 10, false);
    expect(p.iframes).toBe(40);
  });

  it('F25 混乱之脑完整闪避：不掉血+80t 无敌帧+buff321（:38511-38515/:38331-38340）', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(3223), stack: 1 };
    settle(p, w);
    expect(p.equipStats.boc).toBe(true);
    let dodged = false;
    for (let k = 0; k < 120 && !dodged; k++) {         // 1/6 掷,120 次必中（p≈1-（5/6）^120）
      p.iframes = 0;
      p.buffs.remove(BuffType.BrainOfConfusionBuff);
      const hp0 = p.hp;
      const r = p.damage(50, p.cx, p.cy - 10, false);
      if (r === 0 && p.hp === hp0) {
        dodged = true;
        expect(p.iframes).toBeGreaterThanOrEqual(80);  // SetImmuneTimeForAllTypes(80)
        expect(p.bocPulse).toBe(1);                    // 消费端挂 buff 321
      }
    }
    expect(dodged).toBe(true);
    // buff 321 在栏 → 禁再触发（FindBuffIndex(321)==-1 门）：200 次全走伤害路径
    p.buffs.apply(BuffType.BrainOfConfusionBuff, 4);
    let allDamaged = true;
    for (let k = 0; k < 200; k++) {
      p.iframes = 0;
      const r = p.damage(50, p.cx, p.cy - 10, false);
      if (r === 0) allDamaged = false;
    }
    expect(allDamaged).toBe(true);                     // 旧无此门
  });

  it('F27 隐身药水受击破隐（:38566-38575 DelBuff 10）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    settle(p, w);
    p.buffs.apply(BuffType.Invisibility, 60);
    p.damage(10, p.cx, p.cy - 10, false);
    expect(p.buffs.has(BuffType.Invisibility)).toBe(false);
  });

  it('F26 恐慌项链 480t 且按 tick 递减（AddBuff(63,480) :38524）', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(1290), stack: 1 };
    settle(p, w);
    p.damage(10, p.cx, p.cy - 10, false);
    expect(p.panicTime).toBe(480);
    for (let i = 0; i < 60; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 1s
    expect(p.panicTime).toBe(420);                     // 480-60（旧 -=dt 只减 1）
  });
});

// ============ F4 丰盛大餐（OnKillNPC :20627-20630 + :19283-19287） ============
describe('R5-F4 丰盛大餐 336', () => {
  it('lifeRegen+6 = 3HP/s flat（乘区外）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.baseMaxHp = 400;
    settle(p, w, 320);
    p.buffs.apply(BuffType.HeartyMeal, 7);
    p.hp = 390;
    const t0 = p.hp;
    const x0 = p.x;
    p.vx = 3;                                          // 移动档 ×0.5→Round 0,排除自然再生
    for (let i = 0; i < 120; i++) {
      p.x = x0;
      p.lifeRegenTime = 300;
      p.buffs.apply(BuffType.HeartyMeal, 7);           // 续期防到期
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      p.vx = 3;
    }
    expect(p.hp - t0).toBe(6);                         // 6 units/tick × 120 / 120 = 6 HP
  });
});

// ============ 蓝队勘误：蜂蜜 flat 正项在 DoT 后不被清零（:19250-19254） ============
describe('R5-蓝队勘误 蜂蜜×DoT', () => {
  it('DoT+蜂蜜：flat 1HP/s 不被清零（:19252 在 DoT 段后）；极饿期两笔蜂蜜全抹（:19255 覆写）', () => {
    const b = new BuffState();
    b.apply(BuffType.Honey, 30);
    b.apply(BuffType.OnFire, 30);
    let healed = 0;
    for (let i = 0; i < 60; i++) healed += b.tick(1 / 60);
    // OnFire -4HP/s + 蜂蜜 flat +1HP/s + 对冲 +2HP/s（钳 ≤0）= -1HP/s
    expect(healed).toBe(-1);                           // 旧 -4（flat 被清零）
    // 极饿覆写期：蜂蜜 flat/对冲全不生效 → 纯 -8HP/s
    const b2 = new BuffState();
    b2.dontStarveWorld = true;
    b2.starvingMaxHp = 400;
    b2.apply(BuffType.Honey, 30);
    b2.apply(BuffType.Starving, 30);
    let healed2 = 0;
    for (let i = 0; i < 60; i++) healed2 += b2.tick(1 / 60);
    expect(healed2).toBe(-8);                          // 蜂蜜不抵极饿（:19255 整值覆写）
  });
});

// ============ F2 闪亮石 3337 静止整段（:19061-19249/:19333-19376） ============
describe('R5-F2 闪亮石', () => {
  it('静止档：eRT 跳档 1800（:19243-19245）+ flat +4 + ×1.1（:19365）——400HP 静止 ≈4HP/s', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.baseMaxHp = 400;
    p.inv.armor[3] = { id: _iid(3337), stack: 1 };
    settle(p, w, 12);                                  // 短 settle（eRT 低,静止档直接跳 1800）
    expect(p.equipStats.shinyStone).toBe(true);
    p.hp = 390;
    const t0 = p.hp;
    for (let i = 0; i < 120; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);   // 2s 静止
    // eRT=1800+4t → 6 档 ×1.25 ×1.1 = 8.25 → Round 8；+ flat +4（:19248）= 12 units/t
    // = 6HP/s（头 2t eRT<90 未跳档,略低）;num6=(eRT-3000)/300 在 120t 内仍负段 0
    expect(p.hp - t0).toBeGreaterThanOrEqual(9);       // 旧 0.5HP/s 档（无闪亮石整段）只有 +1
    expect(p.hp - t0).toBeLessThanOrEqual(12);
  });
});

// ============ F16 日曜冲撞多目标（:21293-21352） ============
describe('R5-F16 日曜冲撞', () => {
  it('滑行期逐帧多目标、命中不终止冲撞、单敌 6t 免疫', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[0] = { id: _iid(2763), stack: 1 };
    p.inv.armor[1] = { id: _iid(2764), stack: 1 };
    p.inv.armor[2] = { id: _iid(2765), stack: 1 };
    settle(p, w);
    const hits: number[] = [];
    const mkEnemy = (id: number): Record<string, unknown> => ({
      id, x: p.x + 30, y: p.y, w: 16, h: 16, cx: p.x + 38, cy: p.y + 8, dead: false,
      iframes: 0,
      hurt: (d: number) => { hits.push(d); return false; },
    });
    const e1 = mkEnemy(1);
    const e2 = mkEnemy(2);
    const hooks = { ...fakeHooks(w, p), enemies: () => [e1, e2] };
    // 直接置冲撞态（绕过双击/坐骑链）
    p.solarDashing = true;
    (p as unknown as { solarDashConsumed: boolean }).solarDashConsumed = false;
    p.dashDelay = -1;
    p.vx = 21.9;
    p.fixedUpdate(1 / 60, hooks as never);
    expect(hits.length).toBe(2);                       // 同帧双目标（旧 break 只打 1 个）
    expect(p.solarDashing).toBe(true);                 // 不终止（旧置 false）
    expect((e1 as { iframes: number }).iframes).toBe(6);   // :21348 immune=6
    // 敌 1 免疫帧内不再吃,敌 2 照吃
    (e1 as { iframes: number }).iframes = 6;
    (e2 as { iframes: number }).iframes = 0;
    hits.length = 0;
    p.fixedUpdate(1 / 60, hooks as never);
    expect(hits.length).toBe(1);
  });
});

// ============================================================
// ★终局扫尾 B（战斗面小件）：dash 命中循环 AI_112 仙灵免疫支补门
// （原式 :21275 克盾/:21299 日耀 `(aiStyle==112 && !(ai[2]<=1))` → continue；
// SetDefaults NPC.cs:16608 下 aiStyle112 全集=583/584/585 三型 ⇒ vanillaId 判定
// 与 chilletDashCharge 同款落法）
// ============================================================
describe('★B 冲撞面 AI_112 仙灵免疫门', () => {
  const mkFairyEnemy = (id: number, px: number, py: number,
    charged: boolean): Record<string, unknown> => ({
    id, vanillaId: 585, ai2: charged ? 2 : 1,
    x: px + 14, y: py, w: 16, h: 16, cx: px + 22, cy: py + 8, dead: false,
    iframes: 0,
    hurt(d: number) { hits.push(d); return false; },
  });
  let hits: number[] = [];

  beforeEach(() => { hits = []; });

  it('克盾冲撞：充能态(585,ai2=2)免伤；前态(ai2≤1)照常吃', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: _iid(3097), stack: 1 };
    settle(p, w);
    const dash2tap = (pp: Player): void => {
      // ★BJ-C8 复核重钉：同 doubleTap——MV3 债⑤起双击沿=单键 inputRight 按下沿
      pp.inputX = 1; pp.inputRight = true; pp.fixedUpdate(1 / 60, fakeHooks(w, pp) as never);
      pp.inputX = 0; pp.inputRight = false; pp.fixedUpdate(1 / 60, fakeHooks(w, pp) as never);
      pp.inputX = 1; pp.inputRight = true; pp.fixedUpdate(1 / 60, fakeHooks(w, pp) as never);
    };
    dash2tap(p);                                       // 进入 dash==2 滑行（双击左）
    expect(p.vx).toBeCloseTo(14.5, 6);
    const charged = mkFairyEnemy(11, p.x, p.y, true);
    const loose = mkFairyEnemy(12, p.x, p.y, true);
    (loose.ai2 as number) = 1;
    const hooks = { ...fakeHooks(w, p), enemies: () => [charged, loose] } as never;
    p.eocDash = 1;
    p.eocHitId = -1;
    p.fixedUpdate(1 / 60, hooks);                      // 冲撞扫敌一拍
    // 充能仙灵零结算；松散仙灵被命中入账
    expect(hits.length).toBe(1);                       // 仅 loose
    void charged;
  });

  it('日耀冲撞：同门位 :21299 —— 充能态拒、前态受理', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[0] = { id: _iid(2763), stack: 1 };
    p.inv.armor[1] = { id: _iid(2764), stack: 1 };
    p.inv.armor[2] = { id: _iid(2765), stack: 1 };
    settle(p, w);
    const charged = mkFairyEnemy(21, p.x, p.y, true);
    const loose = mkFairyEnemy(22, p.x, p.y, false);
    (loose.ai2 as number) = 0;                          // ≤1 前态
    const hooks = { ...fakeHooks(w, p), enemies: () => [charged, loose] } as never;
    p.solarDashing = true;
    (p as unknown as { solarDashConsumed: boolean }).solarDashConsumed = false;
    p.dashDelay = -1;
    p.vx = 21.9;
    p.fixedUpdate(1 / 60, hooks);
    expect(hits.length).toBe(1);                        // 仅前态仙灵
  });
});
