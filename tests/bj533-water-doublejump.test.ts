// ★BJ533 水中二段跳语义定谳（用户问询：在水中不能二段跳是正常的吗？）
// 定谳+落刀（亲读 1457 反编译，锚逐条钉死）：
//
//   原版 wet×多段跳交互 = 【水中可以二段跳】——JumpMovement 是【单块】无干湿分裂
//   （Player.Update :26948 无条件调用），外门 :20845 含 canJumpAgain_Cloud/Sandstorm/
//   Blizzard/Fart/Sail/Unicorn/Santank/WallOfFleshGoat/Basilisk 臂（无 wet 排除）；
//   selection :20849 `if (!flag2 && !flag)`（flag2 = wet && accFlipper :20795、
//   flag = 湿史莱姆坐骑清零帧 :20816）按优先序消费一瓶；支选择 :20945
//   `if ((((velocity.Y == 0f) | flag4) || sliding) | flag)`——水下悬空 vy≠0 且
//   flag4（=wet&&accFlipper :20824-20828）假 → 跳过地面/泳跳支 → 落瓶支（沙暴
//   :20962-20971 / 暴雪 :20972-20982 / 航行 :20983-21013 / 屁 :21014-21047 / 独角兽
//   / 血肉山羊 / 蜥蜴 / 圣诞坦克 / 云朵 :21167-21196 兜底）——全程【无 wet 门】。
//   湿态跳参已被液体档覆写（:24622-24624 水档 jumpHeight 30 / jumpSpeed 6.01，
//   蜜档不覆写跳参 :24600-24602）→ 水中云跳 = (int)(30×0.75)=22t 平台段钉 -6.01
//   = 强力上浮跳（重力 0.2 :24621）。三特例：
//     ① 脚蹼湿态（flag2）：selection 整段跳过 = 泳跳支（flag4）优先且【不消费】瓶
//        （:20849 !flag2 门 / :20945 flag4 支）；
//     ② 湿史莱姆坐骑（flag）：同跳过 + 地面跳支（:20816/:20945 flag 臂，D2 已锚）；
//     ③ 踩底 vy==0：selection 消费后 :20931 `velocity.Y == 0f → RefreshDoubleJumps`
//        立即回满 = 地面跳不实耗瓶。
//   结论 A：原版水中能二段跳；本仓旧版多段跳块只嵌干支 else（Player.ts 旧 :6276，
//   湿支 :5935-6191 整缺此臂）→ 水中按跳无响应 = 本仓自造门（真债）。连带：
//   飞毯湿门 :6110 `extraJumps.length === 0` 因瓶段永无法在水中消费而恒闭（同债面，
//   本刀一并愈）。
//
//   落刀（Player.ts 湿支）：①起跳门补 else-if 瓶臂（!onGround/!blockExtraJumps/
//   !flipperJump/!justClearedWetSlime/extraJumps>0 → 消费 1 段,vy=-lJSpd、
//   jumpHold=round(lJT×hMult)——高度表/优先序/屁瓶·航行瓶起跳帧特效与干支逐位
//   同构,跳参用湿档 lJSpd/lJT）；②湿支补 doubleJumpVisuals（:26971 每帧无条件,
//   旧湿支整缺）；③湿态踩底回满块补 performingJump=null（干支 onGround 清同款,
//   原版经 jump==0 → CancelAllJumpVisualEffects :26955-26956 同净效）。
//
// 变异证红（本文件判别面,M1 已实跑验红;②③④对照组全绿=判别力专一）：
//   M1 摘湿支瓶臂（门加 false 短路）→ ①水中云瓶主判据红（extraJumps 不消费/
//      performingJump null/jumpHold 不置）+ ③优先序红——实证 2 red/4 green；
//   M2 臂序重构面（瓶臂前置于泳跳支/首支）→ ②extraJumps 消费红。注：瓶臂内
//      !flipperJump/!justClearedWetSlime 守卫被 else-if 结构性蕴含（首支
//      vy==0||flipperJump||slime 先达,单点变异不可达）——保留纯作 :20849
//      `!flag2 && !flag` 直译文档,非承载位;
//   M3 湿臂改消费不跳（只 shift 不置 vy/jumpHold）→ ①vy/hold 断言红。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { BuffType } from '../src/stats/Buffs';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => {
  const key = vanillaItemKey(vid);
  return key ? ITEM_BY_KEY[key] : -1;
};

const mkHooks = (w: World, p: Player): GameHooks => ({
  world: w, player: p, enemies: () => [], critters: () => [],
  projectiles: [], spawnDrop: () => null, damagePlayer: (): number => 0,
  addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
  spawnEnemy: () => {}, spawnParticles: vi.fn(), notifyInventoryChanged: () => {},
  playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: vi.fn(),
  spawnDust: vi.fn(), showPickupLabel: () => {}, recLog: () => {},
  achievements: undefined, scene: {},
} as never);

/** 深水池：地板 y=120,水 [60,120) 全幅（世界 h=300 → wet 探针 j 钳 h−40=260,
 *  池行全在 <260 判湿域;深度 60 行 ≫ 地面跳+云瓶段合计升程 ~270px,全程不破面） */
function mkPoolWorld(): World {
  const w = new World(80, 300, 11, 'bj533');
  for (let x = 0; x < 80; x++) {
    w.store.setTileSilent(x, 120, 1);
    for (let y = 60; y < 120; y++) w.store.setLiquid(x, y, 255, LIQUID_TYPE.WATER);
  }
  return w;
}

/** 纯干地世界（干支回归面,跑道行 <40 免 wet 探针钳域） */
function mkDryWorld(): World {
  const w = new World(80, 80, 11, 'bj533-dry');
  for (let x = 4; x < 76; x++) w.store.setTileSilent(x, 30, 1);
  return w;
}

const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, mkHooks(w, p)); };

/** 沉底落稳（池中出生 → 沉到池底 onGround;≤500t） */
function settleToFloor(p: Player, w: World): void {
  for (let t = 0; t < 500 && !(p.onGround && p.vy === 0); t++) tick(p, w);
  expect(p.onGround).toBe(true);
  expect(p.inWater).toBe(true);
}

/** 地面跳后等回到「水下悬空下沉段」（平台段耗尽 + 过拐点 vy>0;≤500t） */
function waitAirborneSinking(p: Player, w: World): void {
  p.inputJump = true;
  tick(p, w);
  expect(p.jumpHold).toBe(30);        // 湿档 lJT=30（jumpStartedThisTick 免同拍递减）
  p.inputJump = false;
  tick(p, w);
  let guard = 0;
  while ((p.jumpHold !== 0 || p.vy <= 0) && guard++ < 500) tick(p, w);
  expect(guard).toBeLessThan(500);    // 有界：必达悬空下沉段（深度冗余见 mkPoolWorld）
  expect(p.inWater).toBe(true);
}

// ============ ① 主判据：云朵瓶 53 水下悬空二段跳（:20845 canJumpAgain 臂 ×
//               :20945 支选择 × :21167-21196 云支 × 湿档 :24622-24624） ============
describe('BJ533① 云朵瓶水中二段跳', () => {
  it('水下悬空按跳：消费 Cloud 段、vy 反向上浮、jumpHold=round(30×0.75)-2、performingJump=Cloud', () => {
    const w = mkPoolWorld();
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.hp = 500;
    p.inv.armor[3] = { id: iid(53), stack: 1 };   // 云朵瓶（无 jumpBoost）
    settleToFloor(p, w);
    expect(p.jumpSpeedField).toBe(6.01);          // 湿档覆写（:24624,SW-FX40 承载位）
    expect(p.extraJumps).toEqual(['Cloud']);      // 踩底回满（:26247 vy==0 支）
    waitAirborneSinking(p, w);
    // —— 主判据（旧仓此拍无响应=用户实报本体）——
    p.inputJump = true;
    tick(p, w);
    expect(p.extraJumps).toEqual([]);             // selection 消费（:20849 else 臂）
    expect(p.performingJump).toBe('Cloud');       // isPerformingJump_Cloud :21168
    expect(p.vy).toBeLessThan(0);                 // 水中上浮（旧仓恒继续下沉）
    tick(p, w);                                   // ★BJ705-G23:持跳 1 拍（fire 拍 sustain 已 −1）
    expect(p.jumpHold).toBe(Math.round(30 * 0.75) - 1);   // 21+1（湿档 lJT=30;×0.75 窗口算术锁;★BJ717-A F6 −2→−1 迁移=起跳拍 sustain 不再同拍跑）
    p.inputJump = false;
    tick(p, w);
    expect(p.jumpHold).toBe(0);                   // ★BJ705-G23:松键即清（:21201-08;旧耗尽制=21 续跑）
  });

  it('水中无瓶：悬空按跳无响应（对照臂——外门 canJumpAgain 臂假则整块不进）', () => {
    const w = mkPoolWorld();
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.hp = 500;
    settleToFloor(p, w);
    expect(p.extraJumps).toEqual([]);
    waitAirborneSinking(p, w);
    p.inputJump = true;
    tick(p, w);
    expect(p.vy).toBeGreaterThan(0);              // 照常下沉
    expect(p.jumpHold).toBe(0);
    expect(p.performingJump).toBe(null);
    p.inputJump = false;
    tick(p, w);
  });

  it('踩底起跳不实耗瓶（原版 :20931 消费后 RefreshDoubleJumps 回满同净效）', () => {
    const w = mkPoolWorld();
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.hp = 500;
    p.inv.armor[3] = { id: iid(53), stack: 1 };
    settleToFloor(p, w);
    p.inputJump = true;
    tick(p, w);
    expect(p.jumpHold).toBe(30);                  // 地面/泳跳支（vy==0 → flag4 前支）
    expect(p.extraJumps).toEqual(['Cloud']);      // 上方回满先行=消费位不存在
    expect(p.performingJump).toBe(null);
    p.inputJump = false;
    tick(p, w);
  });
});

// ============ ② 脚蹼湿态：泳跳优先且【不消费】瓶（:20849 !flag2 selection 跳过） ============
describe('BJ533② 脚蹼湿态瓶段保留', () => {
  it('脚蹼药 109 悬空按跳 = 泳跳支（swimTime=30),extraJumps 原封不动', () => {
    const w = mkPoolWorld();
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.hp = 500;
    p.inv.armor[3] = { id: iid(53), stack: 1 };
    p.buffs.apply(BuffType.FlipperPotion, 4000);  // 覆盖全程（ignoreWater+accFlipper :10257-59）
    settleToFloor(p, w);
    waitAirborneSinking(p, w);
    // ★BJ705-G23:release-clear 使 waitAirborneSinking 早出（jumpHold 1 拍即清,旧=30 拍
    // 耗尽)——首跳拍置的 swimTime=30 尚余 1,泳跳支的 swimTime==0 条件刷新(:20824-28
    // 原文条件式)不可达;排空 2 拍回到判据态（泳跳行为面不变:fire/jumpHold/瓶保留）
    for (let t = 0; t < 3 && p.swimTime !== 0; t++) tick(p, w);
    expect(p.swimTime).toBe(0);
    p.inputJump = true;
    tick(p, w);
    expect(p.swimTime).toBeGreaterThan(0);        // flag4 泳跳支（:20824-20828 swimTime=30）
    expect(p.extraJumps).toEqual(['Cloud']);      // ★!flag2 门：selection 整段跳过=不消费
    expect(p.performingJump).toBe(null);          // 泳跳非瓶支,不置尾迹旗
    expect(p.vy).toBeLessThan(0);
    tick(p, w);                                   // ★BJ705-G23:持跳 1 拍
    expect(p.jumpHold).toBe(29);                  // 泳跳 lJT=30（fire 拍 jumpStartedThisTick 不进 sustain,持跳拍 −1）
    p.inputJump = false;
    tick(p, w);
    expect(p.jumpHold).toBe(0);                   // ★BJ705-G23:松键即清（:21201-08）
  });
});

// ============ ⑤ 优先序+jumpBoost 湿档：气球束 1164 水中先耗 Sandstorm ============
describe('BJ533③ 水中消费优先序与湿档跳参', () => {
  it('1164 水下悬空首段=Sandstorm（×3）、jumpSpeedField=6.51（jumpBoost 湿档钳 :19717-20）', () => {
    const w = mkPoolWorld();
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.hp = 500;
    p.inv.armor[3] = { id: iid(1164), stack: 1 }; // Sandstorm+Blizzard+Cloud+jumpBoost
    settleToFloor(p, w);
    expect(p.extraJumps).toEqual(['Sandstorm', 'Blizzard', 'Cloud']);
    waitAirborneSinking(p, w);
    expect(p.jumpSpeedField).toBe(6.51);          // max(6.01, jumpBoost→6.51)（:19717-19720 钳）
    p.inputJump = true;
    tick(p, w);
    expect(p.extraJumps).toEqual(['Blizzard', 'Cloud']);   // Sandstorm 消费（优先序 :20875-20922）
    expect(p.performingJump).toBe('Sandstorm');
    tick(p, w);                                             // ★BJ705-G23:持跳 1 拍（★BJ717-A F6:fire 拍 sustain 不跑,−1 只在本拍）
    expect(p.jumpHold).toBe(Math.round(30 * 3) - 1);       // 88+1（×3 窗口算术锁;★BJ717-A F6 −2→−1 迁移）
    p.inputJump = false;
    tick(p, w);
    expect(p.jumpHold).toBe(0);                             // ★BJ705-G23:松键即清（:21201-08）
  });
});

// ============ ⑥ 干支回归面：干燥空气中瓶段照旧（湿刀不溅干链） ============
describe('BJ533④ 干地二段跳回归', () => {
  it('干地云瓶空中按跳照常（jumpHold=round(15×0.75)-2、消费、performingJump）', () => {
    const w = mkDryWorld();
    const p = new Player(40 * TILE, 30 * TILE - 48, new Inventory());
    p.hp = 500;
    p.inv.armor[3] = { id: iid(53), stack: 1 };
    for (let t = 0; t < 100 && !(p.onGround && p.vy === 0); t++) tick(p, w);
    expect(p.onGround).toBe(true);
    expect(p.inWater).toBe(false);
    p.inputJump = true;
    tick(p, w);
    expect(p.jumpHold).toBe(15);                  // 干档 PLAYER_JUMP_TICKS
    p.inputJump = false;
    tick(p, w);
    let guard = 0;
    while ((p.jumpHold !== 0 || p.vy <= 0) && guard++ < 500) tick(p, w);
    expect(guard).toBeLessThan(500);
    p.inputJump = true;
    tick(p, w);
    expect(p.extraJumps).toEqual([]);
    expect(p.performingJump).toBe('Cloud');
    tick(p, w);                                            // ★BJ705-G23:持跳 1 拍（★BJ717-A F6:fire 拍 sustain 不跑,−1 只在本拍）
    expect(p.jumpHold).toBe(Math.round(15 * 0.75) - 1);   // 9+1（干档 ×0.75 窗口算术锁;★BJ717-A F6 −2→−1 迁移）
    p.inputJump = false;
    tick(p, w);
    expect(p.jumpHold).toBe(0);                            // ★BJ705-G23:松键即清（:21201-08）
  });
});
