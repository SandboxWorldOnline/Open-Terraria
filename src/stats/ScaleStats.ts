// ============================================================================
// 专家/大师世界强度轴 1:1 移植（Terarria1456 ilspycmd 反编译为唯一标杆）
//   NPC.ScaleStats                    NPC.cs:18081-18105
//   NPC.ScaleStats_ByDifficulty       NPC.cs:18106-18116
//   NPC.ScaleStats_ByDifficulty_Tweaks NPC.cs:18118-18447
//   NPC.ScaleStats_ForExpertHardmode  NPC.cs:18448-18497
//   NPC.ScaleStats_ByPlayerCount      NPC.cs:18498-18659
//   GameDifficultyData.LinearCurve    GameDifficultyData.cs:16-70
//   GameDifficultyLevel               GameDifficultyLevel.cs:8-16
//   Utils.GetLerpValue/Remap          Utils.cs:283-320
//   Main.Difficulty/expertMode/masterMode  Main.cs:2760-2786
//   NPC.GetAttackDamage_ScaledByDifficulty / ForProjectiles  NPC.cs:7015-7035
//   NPC.GetNPCInvasionGroup           NPC.cs:79095-79212
//   NPCID.Sets 四张表                 NPCID.cs:4440/4771/4799/4801
//
// 消费面：Enemy.fromVanilla 造怪（对应原版 NewNPC→SetDefaults→ScaleStats，
// NPC.cs:8322/17791 两个调用点都无差别进 ScaleStats，**Boss 不豁免**——
// 仅 ScaleStats_ForExpertHardmode 对 boss 提前 return，:18471-18474）。
// 本模块纯函数化（状态全走入参/出参 bundle），世界上下文经 bindScaleStatsWorld
// 注入（Game.afterWorldLoad；对应原版 Main 静态单例）。
// ============================================================================
import type { World } from '../world/World';
import { damageVarRoll } from './DamageVar';

// ---------------------------------------------------------------------------
// GameDifficultyLevel（GameDifficultyLevel.cs:8-16）：档位是【浮点值】不是枚举序号
//   Journey 0.5 / Classic 1 / Expert 2 / Master 3 / Legendary 4
// ---------------------------------------------------------------------------
export const GDL = {
  JOURNEY: 0.5,
  CLASSIC: 1,
  EXPERT: 2,
  MASTER: 3,
  LEGENDARY: 4,
} as const;

/** float32（C# float 字面量/强转位）。JS number 是 float64，在原版显式 (float) 处对齐 */
export const f32 = (v: number): number => Math.fround(v);

/** C# Math.Round(double)（默认 MidpointRounding.ToEven 银行家舍入：.5 → 就近偶数；
 *  JS Math.round 是 .5 远离零舍入，逐半值处会差 1） */
export const roundCS = (v: number): number => {
  const f = Math.floor(v);
  const d = v - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
};

// ---------------------------------------------------------------------------
// ★BJ343 件 2（2026-09-25）：词缀/武器伤害舍入单源收编——三式 C# 数值语义
//   （f32 操作数 + 银行家/(int) 截断）。JS Math.round=f64+half-up 双偏离。
//   收编五站：UI.ts prefixedDamage / itemTooltip.ts legacy+tooltip 伤害行 /
//   Game.ts 天顶剑族 / Game.ts PickAmmo 弹药伤害（各站注释锚原版行号）。
// ---------------------------------------------------------------------------

/** (int)Math.Round((float)a * b)——Item.Prefix 词缀乘区（Item.cs:577-581：
 *  `damage = (int)Math.Round((float)damage * dmg)` 等）。语义 = f32 乘积 +
 *  Math.Round(double) 银行家 + (int)（乘积已整,无截断效应）。
 *  两操作数先各自 f32（C# int→float 隐转/float 常量）,乘法在 f32 域进行：
 *  f64 精确积再 f32 舍入 ≡ C# float 乘法（24 位尾数积 ≤48 位 ⊆ f64 尾数域） */
export const roundCSf32Mul = (a: number, b: number): number => roundCS(f32(f32(a) * f32(b)));

/** (int)((float)a * b)——PickAmmo 弹药伤害叠臂（Player.cs:54193
 *  `Damage += (int)((float)num * GetWeaponDamageMultiplier(item))`）。
 *  (int) 强转 = 朝零截断（非舍入!）——正域 = floor。无 +5E-06f 偏置 */
export const truncCSf32Mul = (a: number, b: number): number => Math.trunc(f32(f32(a) * f32(b)));

/** (int)((float)a * b + 5E-06f)——GetWeaponDamage/tooltip 伤害行族（Player.cs:54066
 *  `return (int)((float)damage * GetWeaponDamageMultiplier(sItem) + 5E-06f)`；
 *  Main.cs:20870 同式）。f32 乘 → f32 加偏置 → (int) 朝零截断。偏置语义 =
 *  抬动恰在整数邻域的 f32 积（f64 侧略亏时回到期望整值） */
export const truncCSf32MulBias = (a: number, b: number, bias = 5e-6): number =>
  Math.trunc(f32(f32(f32(a) * f32(b)) + f32(bias)));

// ---------------------------------------------------------------------------
// Utils.GetLerpValue / Remap（Utils.cs:283-320，Remap 重载默认 clamped=true）
// ---------------------------------------------------------------------------
export function getLerpValue(from: number, to: number, t: number, clamped = false): number {
  if (clamped) {
    if (from < to) {
      if (t < from) return 0;
      if (t > to) return 1;
    } else {
      if (t < to) return 1;
      if (t > from) return 0;
    }
  }
  return (t - from) / (to - from);
}

/** MathHelper.Lerp（XNA：a + (b-a)*t） */
export const lerpF = (a: number, b: number, t: number): number => f32(a + f32(b - a) * t);

/** Utils.Lerp(double)（:246：a + (b-a)*t，双精度）——ByPlayerCount 的 balance 混合用 */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Utils.Remap（:313，默认 clamped=true）——float 重载入参先 (float) 对齐 */
export function remap(fromValue: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  return lerpF(f32(toMin), f32(toMax), getLerpValue(f32(fromMin), f32(fromMax), f32(fromValue), true));
}

// ---------------------------------------------------------------------------
// GameDifficultyData.LinearCurve（GameDifficultyData.cs:16-60）：
//   keys 升序；Sample 找到 value 落入的相邻键区间做线性插值，
//   ≤首键输入取首键输出、≥尾键输入取尾键输出
// ---------------------------------------------------------------------------
export interface CurveKey { input: number; output: number }

/** ★②-F4 构造期 f32 预折（仿 DryadsBane ADD_* 先例：每键值 f32 物化存储）。
 *  C# LinearCurve.Key 的形参本身就是 float（GameDifficultyData.cs:8-10
 *  `Key(float input, float output)`），即字面量在**构造**处完成 (float) 舍入，
 *  Sample 里的一切算术都作用于已物化的 float 键值。旧形态把 raw double 写进表、
 *  仅在采样期对差值 fround，等价于倒置了两次舍入的次序——含非精确字面量的曲线
 *  出现系统性偏差：
 *    · KnockbackToEnemiesMultiplier 的 0.8f：num2 = 0.8f−1 = −0.199999988…（f32 域
 *      直差），旧路 = double 直差 −0.20000000298… 再 fround —— **二选不同邻居**；
 *      实证轴 value=2.75：0.82499999(旧) / 0.82500005(新)，恰为任务单点名的
 *      「−0.20000000…2 之别」。
 *    · LightningPlayerDamageScaling 首键输出 0.04f：Sample 在首键相等段走 `num===0`
 *      早退直出 key.output——存 double 就直出未折值。
 *  影响面逐曲线核算（difficulty 网格 1..4 步长 0.00025，C# float 逐 op 模拟对拍）：
 *    五表（MAX_LIFE/DAMAGE/HOSTILE/MONEY/TOWN_NPC）折前折后逐点全等——所有字面量
 *    或精确、或舍入落同一邻位（含 5.3333335f 的插值段）；
 *    KNOCKBACK 差点数占比≈32%（网格口径）、|Δ| 上限=5.9604644775390625e-8；
 *    LIGHTNING 同级 |Δ|=2.98e-8。
 *  ★消费面吸收定谳：采样差经消费链的中间 fround（f32(f32(x)·Sample) / f32(kbResist·S)）
 *    在 dmg 1..100000 × 四轴全格与 kbResist 稠密扫描内零截断翻档/零位差组——本刀的
 *    价值是构造语义忠实（消除「下次有人在边界加个字面量就滑进邻位」的潜在翻转类），
 *    而非可见行为变化；Journey 早退支 0.04raw 的样本差同样被吸收。
 *  ★残余形差登记（非本刀引入，双重差）：C# Sample 的 value 形参是 float，
 *    本仓以 double 直传且入口不折——arg 精度引入的第三类微差与预折无关
 *    （2.38e-7~9.54e-7 量级 witness 见 tests/scalestats-prefold.test.ts 注）。
 *  表钉测试 = tests/scalestats-prefold.test.ts。 */
export const curveKey = (input: number, output: number): CurveKey =>
  ({ input: f32(input), output: f32(output) });

export function sampleCurve(keys: readonly CurveKey[], value: number): number {
  // 注：keys 已在构造期 f32 预折；此处各 op 的 fround 对应 C# float 逐 op 舍入语义,
  // 与预折不是同一层（保留勿删）。
  let key = keys[0];
  let key2 = key;
  for (let i = 0; i < keys.length; i++) {
    key2 = keys[i];
    if (value <= key2.input) break;
    key = key2;
  }
  const num = f32(key2.input - key.input);
  const num2 = f32(key2.output - key.output);
  if (num === 0) return key.output;
  return f32(f32(f32(value - key.input) * num2) / num + key.output);
}

// 七条难度曲线（GameDifficultyData.cs:62-71，键值逐项照抄并经 curveKey 构造期 f32
// 预折——★②-F4；第六表 LightningPlayerDamageScaling 消费面在 entities/proj1457.ts
// 落雷家 EVP，DebuffTimeMultiplier 未消费暂不列）
export const ENEMY_MAX_LIFE_MULTIPLIER: readonly CurveKey[] = [
  curveKey(GDL.JOURNEY, 0.5), curveKey(GDL.LEGENDARY, 4),
];
export const ENEMY_DAMAGE_MULTIPLIER: readonly CurveKey[] = [
  curveKey(GDL.JOURNEY, 0.5), curveKey(GDL.MASTER, 3), curveKey(GDL.LEGENDARY, 5.3333335),
];
export const HOSTILE_PROJECTILE_DAMAGE_MULTIPLIER: readonly CurveKey[] = [
  curveKey(GDL.JOURNEY, 0.5), curveKey(GDL.MASTER, 3),
];
export const KNOCKBACK_TO_ENEMIES_MULTIPLIER: readonly CurveKey[] = [
  curveKey(GDL.CLASSIC, 1), curveKey(GDL.MASTER, 0.8),
];
export const ENEMY_MONEY_DROP_MULTIPLIER: readonly CurveKey[] = [
  curveKey(GDL.CLASSIC, 1), curveKey(GDL.EXPERT, 2.5),
  curveKey(GDL.MASTER, 2.5), curveKey(GDL.LEGENDARY, 3.5),
];
/** TownNPCDamageMultiplier（GameDifficultyData.cs:69）：城镇 NPC 自卫攻击伤害乘区。
 *  键 Journey 0.5→2 / Classic 1→1 / Expert 2→1.5 / Legendary 4→2——**无 Master 键**，
 *  Master(3) 由 Sample 在 Expert(1.5)-Legendary(2) 区间线性插值得 1.75 */
export const TOWN_NPC_DAMAGE_MULTIPLIER: readonly CurveKey[] = [
  curveKey(GDL.JOURNEY, 2), curveKey(GDL.CLASSIC, 1),
  curveKey(GDL.EXPERT, 1.5), curveKey(GDL.LEGENDARY, 2),
];

// ---------------------------------------------------------------------------
// CreativePowers.DifficultySliderPower.UpdateInfoFromSliderValueCache
// （CreativePowers.cs:1023-1035）——旅程"给 NPC 的强度"滑杆 → 倍率：
//   slider <= 0.33 → Remap(slider, 0, 0.33, 0.5, 1)
//   else           → Remap(slider, 0.33, 1, 1, 3)
//   再对 1/20 步进取整：(float)Math.Round(v * 20f) / 20f（银行家舍入）
// 放本模块（难度轴域）供 mainDifficulty 消费，JourneyPowers.ts 转发导出（避免环导）
// ---------------------------------------------------------------------------
export function strengthOfDifficultySlider(slider: number): number {
  const v = slider <= 0.33
    ? remap(slider, 0, 0.33, 0.5, 1)
    : remap(slider, 0.33, 1, 1, 3);
  return f32(f32(roundCS(f32(f32(v) * 20))) / 20);
}

// ---------------------------------------------------------------------------
// Main.Difficulty / expertMode / masterMode（Main.cs:2760-2786）
//   ★ GameMode 3（旅程）**不**走 Expert/Master 分支；旅程的 0.5×~3× 由
//     _gameModeDifficultyOverride（Main.cs:17238-17248 UpdateCreativeGameModeOverride
//     ← DifficultySliderPower.StrengthMultiplierToGiveNPCs，旅程"给 NPC 的强度"滑杆）
//     注入——**优先于** GameMode 分支求值（:2771-2773），getGoodWorld +1 仍叠加其后。
//     已建模：world.journeyPowers.difficultySlider（JourneyPowers.ts），缺省滑杆 0
//     → 0.5（旅程世界 NPC 半强度是原版真实缺省）。
//   ★ getGoodWorld（for the worthy 种子）整体 +1 档（:2783-2785）——经典 FTW 世界
//     的 expertMode 即为 true，克脑 40 爬行者/饥饿者专家分支/持械僵尸全数生效。
//   我方 world.difficulty：0 经典 / 1 专家 / 2 大师 / 3 旅程（World.ts:73）。
// ---------------------------------------------------------------------------
/** 难度轴求值所需的世界投影（seedFlags/journeyPowers 均可缺省 = 旧档/单测裸对象） */
export interface DifficultyWorldView {
  difficulty: number;
  seedFlags?: World['seedFlags'];
  journeyPowers?: import('../world/JourneyPowers').JourneyPowersState;
}

export function mainDifficulty(world: DifficultyWorldView | null | undefined): number {
  let num: number = GDL.CLASSIC;
  if (world) {
    // 旅程强度滑杆 override（Main.cs:17241 IsJourneyMode + :2771-2773 HasValue →
    // 直接取值覆盖 GameMode 档；GameMode==3 即 IsJourneyMode Main.cs:2696）
    if (world.difficulty === 3) {
      num = strengthOfDifficultySlider(world.journeyPowers?.difficultySlider ?? 0);
    } else if (world.difficulty === 1) num = GDL.EXPERT;
    else if (world.difficulty === 2) num = GDL.MASTER;
    if (world.seedFlags?.getGoodWorld) num += 1;
  }
  return num;
}

/** Main.expertMode（Main.cs:2762）：Difficulty >= Expert（getGoodWorld 抬档后同样生效；
 *  旅程强度滑杆 ≥2× 同样置位——Difficulty 轴语义） */
export function mainExpertMode(world: DifficultyWorldView | null | undefined): boolean {
  return mainDifficulty(world) >= GDL.EXPERT;
}

/** Main.masterMode（Main.cs:2760）：Difficulty >= Master */
export function mainMasterMode(world: DifficultyWorldView | null | undefined): boolean {
  return mainDifficulty(world) >= GDL.MASTER;
}

// ---------------------------------------------------------------------------
// NPCID.Sets（NPCID.cs：Factory.CreateBoolSet(...) 等价"集合包含"）
// ---------------------------------------------------------------------------
/** NeedsExpertScaling（:4799）：命中即强制进 ScaleStats（无视 lifeMax/damage 门） */
export const NEEDS_EXPERT_SCALING = new Set([25, 30, 665, 33, 112, 666, 261, 265, 371, 516, 519, 397, 396, 398, 491]);
/** ProjectileNPC（:4801）：弹体 NPC——不缩 life/value，ExpertHardmode 段只乘 damage */
export const PROJECTILE_NPC = new Set([25, 30, 665, 33, 112, 666, 261, 265, 371, 516, 519]);
/** DontDoHardmodeScaling（:4440）：豁免 ExpertHardmode 兜底增强 */
export const DONT_DO_HARDSMODE_SCALING = new Set([5, 13, 14, 15, 267, 113, 114, 115, 116, 117, 118, 119, 658, 659, 660, 400, 522]);
/** BelongsToInvasionOldOnesArmy（:4771） */
export const OLD_ONES_ARMY = new Set([552, 553, 554, 561, 562, 563, 555, 556, 557, 558, 559, 560, 576, 577, 568, 569, 566, 567, 570, 571, 572, 573, 548, 549, 564, 565, 574, 575, 551, 578]);

/** NPC.CommonMasterBossLifeReduction（NPC.cs:6500） */
export const COMMON_MASTER_BOSS_LIFE_REDUCTION = 0.85;

// ---------------------------------------------------------------------------
// 专家档体型放大系数（Tweaks 内 4 处 `scale *=`，NPC.cs:18187/18198/18300/18309）：
//   13-15 世吞三段 ×1.2；266/267 克脑+爬行者、134-136 毁灭者三段、139 探针 ×1.05。
//   门 difficulty >= Expert（getGoodWorld 抬档后的"经典 FTW"同样命中）。
//   单一数据源：Tweaks 与渲染侧 expertRenderScale 共用本表。
//   ★只改 npc.scale 不回写宽高——原版 NewNPC 的 width/height×scale 在 ScaleStats
//     之前（NPC.cs:17744-17747），故专家档"贴图变大、碰撞盒不变"是原版语义。
// ---------------------------------------------------------------------------
export function expertScaleMul(type: number): number {
  if (type >= 13 && type <= 15) return 1.2;
  if (type === 266 || type === 267 || (type >= 134 && type <= 136) || type === 139) return 1.05;
  return 1;
}

/** 渲染侧专家体型系数（Renderer drawEnemy scale 乘区；碰撞盒不动）。
 *  世界难度经绑定上下文取（bindScaleStatsWorld，未绑定=经典档恒 1）。 */
export function expertRenderScale(type: number, ctx: ScaleStatsWorld | null = null): number {
  if ((ctx ?? scaleStatsWorld()).difficulty < GDL.EXPERT) return 1;
  return expertScaleMul(type);
}

// ---------------------------------------------------------------------------
// NPC.GetNPCInvasionGroup（NPC.cs:79095-79212）：
//   1 哥布林 / 2 雪人军团 / 3 海盗 / 4 火星 / -1 南瓜月 / -2 霜月 / -3 旧日军团 / 0 其他
// ---------------------------------------------------------------------------
export function getNPCInvasionGroup(npcID: number): number {
  if (npcID === 26 || npcID === 27 || npcID === 28 || npcID === 29 || npcID === 111 || npcID === 471 || npcID === 472) return 1;
  if (npcID === 143 || npcID === 144 || npcID === 145) return 2;
  if (npcID === 212 || npcID === 213 || npcID === 214 || npcID === 215 || npcID === 216
    || npcID === 252 || npcID === 491 || npcID === 492 || npcID === 662) return 3;
  if (npcID === 381 || npcID === 382 || npcID === 383 || npcID === 385 || npcID === 386 || npcID === 387
    || npcID === 388 || npcID === 389 || npcID === 390 || npcID === 391 || npcID === 394 || npcID === 395 || npcID === 520) return 4;
  if (npcID >= 338 && npcID <= 352) return -1;
  if ((npcID >= 305 && npcID <= 315) || npcID === 325 || npcID === 326 || npcID === 327 || npcID === 329 || npcID === 330) return -2;
  if ((npcID >= 547 && npcID <= 578)) return -3;
  return 0;
}

// ---------------------------------------------------------------------------
// NPC.GetAttackDamage_* 家族（NPC.cs:7010-7035）——AI 段逐处消费的难度伤害 API
// ---------------------------------------------------------------------------
/** GetKnockbackMultiplier_ScaledByDifficulty（:7010） */
export function getKnockbackMultiplierScaledByDifficulty(normalKnockbackMult: number, difficulty: number): number {
  return f32(normalKnockbackMult * sampleCurve(KNOCKBACK_TO_ENEMIES_MULTIPLIER, difficulty));
}

/** GetAttackDamage_ScaledByDifficulty（:7015）：(int)(normal * EnemyDamageMultiplier.Sample(difficulty)) */
export function getAttackDamageScaledByDifficulty(normalDamage: number, difficulty: number): number {
  return Math.trunc(f32(normalDamage * sampleCurve(ENEMY_DAMAGE_MULTIPLIER, difficulty)));
}

/** GetAttackDamage_ForTownNPC（NPC.cs:7041-7044）：
 *  (int)(normalDamage * TownNPCDamageMultiplier.Sample(Main.Difficulty))
 *  消费点 = AI_007 城镇 NPC 四攻击态发射/挥击伤害入参（近战 :54897 / 弓 :55169 /
 *  魔法 :55319 / 挥击 :55466，四处同式 num = f(num * num2)——num2 为 Boss 击杀
 *  进度强化链 :53400-53557，TownNPC.townNpcProgressionBoost 1:1，2026-08-14 接）。
 *  注意 (int) = 向零截断非四舍五入 */
export function getAttackDamageForTownNPC(normalDamage: number, difficulty: number): number {
  return Math.trunc(f32(normalDamage * sampleCurve(TOWN_NPC_DAMAGE_MULTIPLIER, difficulty)));
}

/** Main.DamageVar（1457 Main.cs:67097 起 / 1456 Main.cs:65597-65620）1:1：base ±15%
 *  ±luck 重掷。luck>0：|luck| 概率重掷一次取较大；luck<0：|luck| 概率重掷取较小
 *  （两版对称双支，1457 :67104-67122）。rnd = [0,1) 均匀随机源。
 *  返回 int 截断（(int) 语义）。 */
/* 版本锚勘误存档：旧头注 "Main.cs:65597-65620" 是 1456 行号；2026-08-30 蓝队复核按
 * 1457 基准改双版标注（DamageVar 在 1457 Main.cs 自 :67097 起）。 */
export function damageVar(base: number, luck: number, rnd: () => number = Math.random): number {
  // ★F9（2026-08-31 蓝队三批）：体迁入 stats/DamageVar.ts 单源——离散档/luck 重掷
  // 逻辑不变，终值舍入改 C# ToEven 银行家形（旧 Math.round half-up 在 x.5 档
  // 偏一，见 DamageVar.ts 头注②）。
  return damageVarRoll(base, luck, rnd);
}

/** GetAttackDamage_CappedAtMaster（:7020）：大师以上钳在 Master 档 */
export function getAttackDamageCappedAtMaster(normalDamage: number, difficulty: number): number {
  const num = Math.min(difficulty, GDL.MASTER);
  return Math.trunc(f32(normalDamage * sampleCurve(ENEMY_DAMAGE_MULTIPLIER, num)));
}

/** GetAttackDamage_ForProjectiles（:7031）：Remap(difficulty, Classic, Expert, normal, expert) */
export function getAttackDamageForProjectiles(normalDamage: number, expertDamage: number, difficulty: number): number {
  return Math.trunc(remap(difficulty, GDL.CLASSIC, GDL.EXPERT, normalDamage, expertDamage));
}

/** 敌对弹幕命中玩家的难度乘区（Projectile.cs:264/544 hostileDamageScaling =
 *  GameDifficultyData.HostileProjectileDamageMultiplier，Damage_EVP :13770 消费：
 *  `if (!reflected) num3 = (int)(num3 * hostileDamageScaling.Sample(Main.Difficulty))`） */
export function hostileProjectileDamage(damage: number, difficulty: number): number {
  return Math.trunc(f32(damage * sampleCurve(HOSTILE_PROJECTILE_DAMAGE_MULTIPLIER, difficulty)));
}

// ---------------------------------------------------------------------------
// 待缩放属性 bundle（对应 NPC 字段；knockBackResist 用【原版语义】=承受击退比例）
// ---------------------------------------------------------------------------
export interface ScalingStats {
  type: number;
  lifeMax: number;
  damage: number;
  value: number;
  defense: number;
  knockBackResist: number;
  boss: boolean;
  friendly: boolean;
  townNPC: boolean;
  /** npc.scale——Tweaks 专家段 ×1.05/×1.2（:18205-18207 等） */
  scale: number;
  /** npc.difficulty（ScaleStats 内写入；缺省 0 = 未缩放，对应原版字段初值） */
  difficulty: number;
}

/** 世界上下文（原版 Main 静态的只读投影） */
export interface ScaleStatsWorld {
  /** Main.Difficulty（Main.cs:2764-2786，mainDifficulty() 求值结果） */
  difficulty: number;
  /** Main.hardMode */
  hardMode: boolean;
  /** Main.getGoodWorld */
  getGoodWorld: boolean;
  /** Main.tenthAnniversaryWorld（celebrationmk10）——SetDefaults 尾段体型调整用 */
  tenthAnniversaryWorld: boolean;
  /** Main.remixWorld（don't dig up）——getGood 39-41 子分支 */
  remixWorld: boolean;
  /** Main.zenithWorld（getfixedboi = SeedFlags.everything）——SetDefaults 尾段 lifeMax 预调整 */
  zenithWorld: boolean;
  /** NPC.downedPlantBoss（ExpertHardmode 段 :18462 +20 阈值） */
  downedPlantBoss: boolean;
  /** NPC.AnyNPCs(type)（Tweaks/ExpertHardmode 的 getGoodWorld 联动门） */
  anyNpc: (type: number) => boolean;
  /** NPC.GetActivePlayerCount()（单人恒 1，Main.cs:18518-18521 netMode==0） */
  activePlayerCount: number;
}

/** 经典档缺省上下文（未绑定世界时用——数值与原版 Main 未加载世界时一致走 Classic） */
export const CLASSIC_SCALE_WORLD: ScaleStatsWorld = {
  difficulty: GDL.CLASSIC, hardMode: false, getGoodWorld: false,
  tenthAnniversaryWorld: false, remixWorld: false, zenithWorld: false,
  downedPlantBoss: false,
  anyNpc: () => false, activePlayerCount: 1,
};

// ---------------------------------------------------------------------------
// 世界绑定（Enemy.fromVanilla 无 world 引用；Game.afterWorldLoad 注入，
// 对应原版 Main 静态单例语义——存档不持久化缩放值，每次生成现场重算）
// ---------------------------------------------------------------------------
let boundWorld: ScaleStatsWorld | null = null;

export function bindScaleStatsWorld(ctx: ScaleStatsWorld | null): void { boundWorld = ctx; }

export function scaleStatsWorld(): ScaleStatsWorld { return boundWorld ?? CLASSIC_SCALE_WORLD; }

/** World → ScaleStatsWorld 投影（Game.afterWorldLoad 用；anyNpc 由实体桶实现）。
 *  difficulty 为 live getter（读时重算 mainDifficulty）——旅程强度滑杆运行时
 *  拖动即生效，无需重新绑定（对应原版 Main.Difficulty 属性每次读重算） */
export function scaleStatsWorldOf(
  world: Pick<World, 'difficulty' | 'seedFlags' | 'flags'> & { journeyPowers?: import('../world/JourneyPowers').JourneyPowersState },
  anyNpc: (type: number) => boolean,
): ScaleStatsWorld {
  return {
    get difficulty() { return mainDifficulty(world); },
    hardMode: !!world.flags?.hardMode,
    getGoodWorld: !!world.seedFlags?.getGoodWorld,
    tenthAnniversaryWorld: !!world.seedFlags?.tenthAnniversary,
    remixWorld: !!world.seedFlags?.remix,                 // Main.remixWorld = don't dig up
    zenithWorld: !!world.seedFlags?.everything,            // Main.zenithWorld = getfixedboi
    downedPlantBoss: !!world.flags?.['downed_262'],
    anyNpc,
    activePlayerCount: 1,   // 单机（NPC.GetActivePlayerCount :18518 netMode==0 → 1）
  };
}

// ---------------------------------------------------------------------------
// SetDefaults 尾段种子档调整族（NPC.cs:17774-17785 调用链）：
//   zenith(getfixedboi) :17774-17777 → getGood(FTW) :17778-17781 →
//   tenthAnniversary :17782-17785（getGood 与十周年【else-if 互斥】）。
//   全部先于 ScaleStats(:17791)——本层 lifeMax/defense/damage 增量仍吃 ScaleStats
//   难度乘区（原版同序）；defDamage/defDefense/defLifeMax 快照在 :17749-17751
//   （本层【前】）——调用侧 baseDamage 用未调基值即对齐。
//   ★命中分支尾部回写 width/height ×scaleNew（:18025-18026/:17861-17862）=【扩盒】，
//   与专家档 Tweaks"只缩贴图不扩盒"（ScaleStats 之后 :18187 等）语义相反。
//   批次B（2026-08-14）三项落地：
//   ①图鉴假人还原——IsABestiaryIconDummy（NPC.cs:5940）：两调整函数尾部
//     scale=还原入口值 + 不扩盒提前 return（getGood :18020-18023 / 十周年 :17856-17859；
//     图鉴图标实例以原版体型呈现）。488 训练假人本身不入图鉴
//     （NPCBestiaryDrawOffset[488].Hide=true，NPCID.cs:10429-10435 → 本仓
//     BESTIARY_HIDE_IDS）。
//   ②canDisplayBuffs——NPC 字段（★Z4/行号勘误 2026-10-02 审计 D6：:6206 默认 true /
//     :8519 SetDefaults 复位——旧引 :6124/:8423 系漂移号）；
//     FTW 245/246/247/248 石巨人族置 false（★清偿刀 P4 锚勘误 2026-09-30：旧引
//     :17945/:17950/:17955 系 1456 行号——1457 实锚 :18042/:18047/:18052,亲读复核；
//     249 无此项）。
//     原版仅两处消费：GetNPCColorTintedByBuffs 染色门（NPC.cs:92142,早退 :92144；
//     经 Main.cs:23170 调用——旧引 :92026/Main.cs:22797 系漂移号）、
//     UpdateNPC_BuffApplyVFX（NPC.cs:92263,非 Main.cs）函数头早退门 :92265
//     （鞭标闪电粒子 :92270-92277 在其内——旧引 :92135 系漂移号）——两消费者本仓
//     均未移植（debuff 自发光段 :92181+ 原版不受此门）；BuffID.Sets 无图标显隐集
//     （玩家侧 buff 图标恒画，仅时长文字被 TryGetBuffTime 门控 Main.cs:42688-42703），
//     字段先行落地保数据链一致（Enemy.canDisplayBuffs）。
//   ③sizeScaleOverride 膨胀+二次盒——见 netIdSpawnScale 头注。
// ---------------------------------------------------------------------------

/** 种子调整原值 bundle（= SetDefaults 主体已写好的 npc 原始字段，逐字段原地改） */
export interface SeedAdjustStats {
  type: number;
  scale: number;
  lifeMax: number;
  defense: number;
  damage: number;
  /** npc.value（★IIIII228 remix 逐型块 value ×scale 用；缺省 = 调用方不跟踪 value） */
  value?: number;
  /** NPC.canDisplayBuffs（NPC.cs:6124 默认 true；缺省 undefined = 调用方不跟踪）——
   *  FTW 245-248 石巨人族置 false（:17945/:17950/:17955；249 不置） */
  canDisplayBuffs?: boolean;
  /** NPC.IsABestiaryIconDummy（NPC.cs:5940；UnlockableNPCEntryIcon.cs:27 等置位）——
   *  图鉴图标实例：种子档还原 scale、不扩盒（:18020-18023/:17856-17859） */
  isBestiaryIconDummy?: boolean;
}

/** getZenithSeedAdjustmentsBeforeEverything（:17865-17872）：
 *  (uint)(type-125)<=6（=125-131）或 139 → lifeMax×0.8（(double) 截断）。
 *  先于 getGood（getfixedboi 两层都吃） */
function zenithSeedAdjustments(s: SeedAdjustStats): void {
  const t = s.type;
  if ((t >= 125 && t <= 131) || t === 139) s.lifeMax = Math.trunc(s.lifeMax * 0.8);
}

/** getGoodAdjustments（:17874-18027，FTW）。返回是否命中分支（=扩盒门；
 *  else :18014-18016 提前 return 不扩盒）。scale 乘按 (float) 逐处对齐；
 *  lifeMax/defense/damage 走 (double)×(int) 截断。
 *  尾部图鉴假人还原（:18020-18023）：scale 还原入口值、不扩盒（返回 false）——
 *  canDisplayBuffs=false 已写入不回滚（原版同样在还原前赋值） */
function getGoodAdjustments(s: SeedAdjustStats, remixWorld: boolean): boolean {
  const t = s.type;
  const scale0 = s.scale;                              // :17875 float num = scale
  if (t === 13) { s.scale = f32(s.scale * f32(1.35)); s.defense += 2; }
  else if (t === 14 || t === 15) { s.scale = f32(s.scale * f32(1.4)); s.defense += 2; }
  else if (t === 39 || t === 40 || t === 41) {
    s.lifeMax += 100; s.defense += 2; s.damage += 4;
    s.scale = 1.1;                                    // :17897 赋值（非乘法）
    if (remixWorld) { s.lifeMax += 50; s.scale = f32(s.scale * f32(1.2)); s.defense += 4; }
  }
  else if (t === 35) { s.scale = f32(s.scale * f32(1.25)); }
  else if (t === 36) { s.scale = f32(s.scale * f32(1.15)); }
  else if (t === 113 || t === 114) {
    s.scale = f32(s.scale * f32(0.65));
    s.lifeMax = Math.trunc(s.lifeMax * 1.5);          // (double)
    s.defense += 3;
  }
  else if (t === 115 || t === 116) { s.scale = f32(s.scale * f32(1.4)); }
  else if (t === 118) { s.damage += 10; s.defense += 14; s.lifeMax *= 3; }   // :17933-17938
  else if (t === 222) { s.scale = f32(s.scale * f32(1.2)); }
  else if (t === 245 || t === 246) { s.canDisplayBuffs = false; s.scale = f32(s.scale * f32(0.5)); }  // :17942-17948
  else if (t === 247 || t === 248) { s.canDisplayBuffs = false; s.scale = f32(s.scale * f32(0.5)); }  // :17949-17958
  else if (t === 249) { s.scale = f32(s.scale * f32(0.5)); }                 // :17959-17962 无 canDisplayBuffs
  else if (t === 262) { s.scale = f32(s.scale * f32(1.3)); }
  else if (t === 266) {
    s.defense = Math.trunc(s.defense * 1.5);          // (double)
    s.damage = Math.trunc(s.damage * 1.2);            // (double)
    s.scale = f32(s.scale * f32(1.1));
  }
  else if (t === 125 || t === 126) { s.scale = f32(s.scale * f32(0.8)); }
  else if (t >= 127 && t <= 131) { s.scale = f32(s.scale * f32(1.1)); }
  else if (t >= 134 && t <= 136) { s.scale = f32(s.scale * f32(1.3)); }
  else if (t === 139) { s.scale = f32(s.scale * f32(1.6)); }
  else return false;
  if (s.isBestiaryIconDummy) { s.scale = scale0; return false; }   // :18020-18023
  return true;
}

/** getTenthAnniversaryAdjustments（:17795-17863，celebrationmk10）：列族 scale×0.5。
 *  尾部扩盒【无条件】执行（无 else-return）——未列族二次乘盒是原版真实行为：
 *  scale=1 族恒等无感，scale≠1 未列族（史莱姆王 50 等 38 条）真放大（122→152）。
 *  图鉴假人还原（:17856-17859）：scale 还原入口值、不扩盒（返回 false） */
function tenthAnniversaryAdjustments(s: SeedAdjustStats): boolean {
  const t = s.type;
  const scale0 = s.scale;                              // :17796 float num = scale
  if (t === 4 || (t >= 13 && t <= 15) || t === 266 || t === 267 || t === 35 || t === 36
    || t === 222 || (t >= 113 && t <= 116) || (t >= 134 && t <= 136) || t === 139
    || t === 125 || t === 126 || (t >= 127 && t <= 131) || t === 370 || t === 636
    || t === 422 || t === 493 || t === 507 || t === 517) {
    s.scale = f32(s.scale * f32(0.5));
  }
  if (s.isBestiaryIconDummy) { s.scale = scale0; return false; }   // :17856-17859
  return true;
}

// ---------------------------------------------------------------------------
// NPC.SetDefaults 逐型 remix（don't dig up）块（★IIIII228，1458 cs:8775/:8808/:8837/
// :8866/:9558/:9895/:11210/:11332）。运行序 = SetDefaults 主体（先于 :17774-17785
// zenith/getGood/tenth 种子档与 :17791 ScaleStats）——getfixedboi（zenith）世界
// 两层都吃（remix 块先做,种子档在其上）。
//   6 Eater of Souls / 7 8 9 World Feeder 头·身·尾 / 173 Crimera：
//     !IsABestiaryIconDummy → scale ×1.3（float），damage/defense/lifeMax/value
//     = (int)((float)v × scale)（★统计乘【不受】假人豁免——原版乘在 if(!dummy)
//     块外，假人只免 scale）
//   59 Lava Slime：定值覆写 damage=7 / defense=2 / lifeMax=25 / value=25（无 scale）
//   82 Wraith：!dummy → scale ×1.2 + stats ×scale
//   181 Face Monster：!dummy → scale ×1.1；stats = (int)((double)((float)v×scale)×1.2)
//     （double×1.2 二段截断）
// value 走 (int)(value*scale)（value 为 float 字段）。
// ---------------------------------------------------------------------------
export function applyRemixSetDefaults(s: SeedAdjustStats, ctx: Pick<ScaleStatsWorld, 'remixWorld'>): boolean {
  const t = s.type;
  if (!ctx.remixWorld) return false;
  const scaleStat = (mul: number): void => {
    if (s.damage) s.damage = Math.trunc(f32(f32(s.damage) * mul));
    if (s.defense) s.defense = Math.trunc(f32(f32(s.defense) * mul));
    if (s.lifeMax) s.lifeMax = Math.trunc(f32(f32(s.lifeMax) * mul));
    if (s.value != null && s.value !== 0) s.value = Math.trunc(f32(f32(s.value) * mul));
  };
  if (t === 6 || t === 7 || t === 8 || t === 9 || t === 173) {
    if (!s.isBestiaryIconDummy) s.scale = f32(s.scale * f32(1.3));
    scaleStat(s.scale);
    return true;
  }
  if (t === 59) {
    s.damage = 7; s.defense = 2; s.lifeMax = 25; s.value = 25;
    return true;
  }
  if (t === 82) {
    if (!s.isBestiaryIconDummy) s.scale = f32(s.scale * f32(1.2));
    scaleStat(s.scale);
    return true;
  }
  if (t === 181) {
    if (!s.isBestiaryIconDummy) s.scale = f32(s.scale * f32(1.1));
    const mul2 = (v: number): number => Math.trunc(f32(f32(v) * s.scale) * 1.2);
    if (s.damage) s.damage = mul2(s.damage);
    if (s.defense) s.defense = mul2(s.defense);
    if (s.lifeMax) s.lifeMax = mul2(s.lifeMax);
    if (s.value != null && s.value !== 0) s.value = mul2(s.value);
    return true;
  }
  return false;
}

/** SetDefaults 尾段种子档调整入口（:17774-17785）。原值逐字段原地改；
 *  返回是否【扩盒】——调用侧用调整后 scale 对已基扩盒的 width/height 二次
 *  (int) 乘（:18025-18026/:17861-17862）。isBestiaryIconDummy（s 上）时
 *  getGood/十周年还原 scale 且不扩盒（返回 false） */
export function applySeedAdjustments(
  s: SeedAdjustStats,
  ctx: Pick<ScaleStatsWorld, 'zenithWorld' | 'getGoodWorld' | 'tenthAnniversaryWorld' | 'remixWorld'>,
): boolean {
  if (ctx.zenithWorld) zenithSeedAdjustments(s);                              // :17774-17777
  if (ctx.getGoodWorld) return getGoodAdjustments(s, ctx.remixWorld);         // :17778-17781
  if (ctx.tenthAnniversaryWorld) return tenthAnniversaryAdjustments(s);       // :17782-17885
  return false;
}

/** SetDefaults 尾段两级 (int) 截断扩盒（首盒 :17842-17843 + 种子档二盒 getGood
 *  :18122-18123 / 十周年 :17958-17959；1456:17745-17746/:18025-18026/:17861-17862）。
 *  ★单源（BJ101 2026-09-16）：fromVanilla（NewNPC→SetDefaults）与 tryTransformTo
 *  （Transform→SetDefaults :81921 全链重跑）共用本函数——盒链禁止第二套实现
 *  （fx43 双源漂移同族）。
 *  @param baseScale 首盒乘数 = remix 块【后】、种子档【前】的 npc.scale
 *    （★SC1 读取点纪律：调用侧必须在 applySeedAdjustments 之前捕获）；
 *  @param seedScale 种子档调整后总 scale（= s.scale 终态）；
 *  @param seedHit  applySeedAdjustments 返回值（=命中扩盒分支；十周年恒 true、
 *    zenith-only 恒 false——zenith 只改 lifeMax 不扩盒）。
 *  未命中支原版同为 (int) 截断（:17842 恒 (int)——★RB15b-F1：旧 Math.round 曾使
 *    史莱姆王 50 盒宽 123 vs 原版 122（98×1.25=122.5））。 */
export function seedTailBox(
  rawW: number, rawH: number, baseScale: number, seedScale: number, seedHit: boolean,
): { w: number; h: number } {
  const w = Math.trunc(f32(rawW * baseScale));
  const h = Math.trunc(f32(rawH * baseScale));
  if (!seedHit) return { w, h };
  return { w: Math.trunc(f32(w * f32(seedScale))), h: Math.trunc(f32(h * f32(seedScale))) };
}

// ---------------------------------------------------------------------------
// NPCSpawnParams.sizeScaleOverride 消费链（批次B 落地）——netID 变体刷出的体型语义：
//   来源 = SetDefaultsFromNetId（NPC.cs:7633+ 各 case 的 0.6/0.9/1.05/1.2… 经
//   SetDefaults_ForNetId :8328-8330 → spawnparams.WithScale(o)）与进度条参考假人
//   （GetMatchingSpawnParams :18071-18078——本仓无进度条假人路径，不可达已登记）。
//   ① SetDefaults 入口 FTW 膨胀（:8362-8366）：getGood && !IsABestiaryIconDummy
//      && 有值 → o' = (o + o*o) / 2f（小者更小、大者更大）
//   ② 首盒（:17727-17742）：有 override 时【替换】类型默认 scale ——
//      w1=(int)(rawW×o')（:17734）、h1=(int)(rawH×o')（:17735），
//      h1==16||32 → +1（:17736-17739，贴格防卡）；
//      无 override 才走 w=(int)(rawW×s_type)（:17745-17746）
//   ③ 种子档调整（:17774-17785）在首盒【之后】：getGood/十周年在 o' 上再乘，
//      命中分支二盒 w2=(int)(w1×scaleNew)（:18025-18026/:17861-17862）——
//      十周年无 else-return 恒二盒；netID 基类型与两列表零交集 ⇒ 未列族
//      scaleNew=o' → 盒 = rawW×o'×o' 二次乘（原版怪癖，照抄）
//   ④ ScaleStats（:17791）只缩数值不动盒——调用侧（Enemy.fromVanilla）已覆盖
// ---------------------------------------------------------------------------
export interface NetIdSpawnScaleResult {
  /** 最终 npc.scale（渲染与后续消费；= 调整后的 override） */
  scale: number;
  width: number;
  height: number;
  /** NPC.canDisplayBuffs（FTW 245-248 → false；缺省 true，NPC.cs:6124） */
  canDisplayBuffs: boolean;
}

export function netIdSpawnScale(
  type: number,          // 基底 NPC id（SetDefaults(num) 语义，非负）
  override: number,      // SetDefaults_ForNetId 第 3 参（0.6/0.9/1.2…）
  rawWidth: number,      // 基底类型原始 width（未乘任何 scale）
  rawHeight: number,
  ctx: Pick<ScaleStatsWorld, 'zenithWorld' | 'getGoodWorld' | 'tenthAnniversaryWorld' | 'remixWorld'>,
  isBestiaryIconDummy = false,
): NetIdSpawnScaleResult {
  // ① FTW 入口膨胀（:8362-8366）——(o + o*o)/2f 全 float32 逐步对齐
  let o = override;
  if (ctx.getGoodWorld && !isBestiaryIconDummy) {
    o = f32(f32(o + f32(o * o)) / 2);
  }
  // ② 首盒（:17733-17735）：override 替换类型 scale + h==16/32 +1（:17736-17739）
  let w = Math.trunc(f32(rawWidth * o));
  let h = Math.trunc(f32(rawHeight * o));
  if (h === 16 || h === 32) h++;
  // ③ 种子档调整 + 命中分支二盒（十周年恒命中：:17861-17862 无条件乘）。
  //  ★IIIII228：netID 路径的 remix 逐型块只影响 stats/贴图 scale（override 在
  //  :17824 把 scale 整体替换为 o'——盒=rawW×o' 不含 remix ×1.3；stats 乘区
  //  由 fromVanilla 的 applyRemixSetDefaults 承载,此处盒链不重做）
  const s: SeedAdjustStats = {
    type, scale: o, lifeMax: 0, defense: 0, damage: 0,
    canDisplayBuffs: true, isBestiaryIconDummy,
  };
  if (applySeedAdjustments(s, ctx)) {
    w = Math.trunc(f32(w * s.scale));
    h = Math.trunc(f32(h * s.scale));
  }
  return { scale: s.scale, width: w, height: h, canDisplayBuffs: s.canDisplayBuffs !== false };
}

/** ★BJ720-A（issue #19 D12）：SetDefaultsFromNetId 尾段 flag=true 族重排终值
 *  （knockbackResist 小写 b——对齐 Enemy.def 字段名,防消费侧拼写漂移） */
export interface NetIdFlagTrueFinals {
  lifeMax: number; damage: number; defense: number; value: number; knockbackResist: number;
}

/** ★BJ720-A（issue #19 D12，2026-10-25）：SetDefaultsFromNetId 尾段 flag=true 通道
 *  （NPC.cs:8363-8372）——`netID=id; lifeMax=life; def*=* 快照` 后
 *  `if (flag) { ScaleStats(...); life = lifeMax; }`。flag=true 族=case -1..-10
 *  （史莱姆变体，三值全硬置）：case 体（:7688-7783）先 `knockBackResist *= 乘子`
 *  （乘在基底 SetDefaults 尾 :17888 ScaleStats 已缩放的现值上）、硬置 value，再由
 *  尾段对【硬置终值】重过完整难度链——专家/大师乘区（ByDifficulty）+ 肉后兜底
 *  （ForExpertHardmode：num=damage+defense+lifeMax/4 < 80 拉抬，世花后 100）+
 *  人数缩放 + lifeMax<6 下限。旧仓硬置后不再缩放=三档停经典硬编码（issue D12
 *  实测 -1..-10 三档同值；分裂幼体/风气球 594 携带变体同病）。
 *  入参 kbResist = 基底现值（Enemy.def.knockbackResist——fromVanilla 已含难度缩放）；
 *  kbMul = case 体乘子（-1/-2/-3 ×1.2、-4 ×1.4、-5 ×0.95、-7 ×0.9、其余 1）。
 *  ScaleStats 入口门（lifeMax>5 && damage≠0 && !friendly && !townNPC）不达时
 *  终值=入参原值（原版同——kbr 乘子仍先施加）。 */
export function netIdFlagTrueRescale(
  base: { type: number; boss: boolean; friendly: boolean; townNPC: boolean; scale: number },
  hard: { life: number; damage: number; defense: number; value: number; kbMul?: number },
  kbResist: number,
  ctx: ScaleStatsWorld,
): NetIdFlagTrueFinals {
  const s: ScalingStats = {
    type: base.type, lifeMax: hard.life, damage: hard.damage, defense: hard.defense,
    value: hard.value,
    knockBackResist: f32(kbResist * f32(hard.kbMul ?? 1)),   // case 体 ×乘子（f32 乘）
    boss: base.boss, friendly: base.friendly, townNPC: base.townNPC,
    scale: base.scale, difficulty: 0,
  };
  scaleStats(s, ctx);                                        // :8370 尾段重排
  return { lifeMax: s.lifeMax, damage: s.damage, defense: s.defense,
    value: s.value, knockbackResist: s.knockBackResist };
}

// ---------------------------------------------------------------------------
// NPC.ScaleStats（NPC.cs:18081-18105）
// ---------------------------------------------------------------------------
export function scaleStats(
  s: ScalingStats,
  ctx: ScaleStatsWorld = scaleStatsWorld(),
  activePlayersCount?: number | null,
  strengthOverride?: number | null,
): void {
  // 入口门（:18083）：NeedsExpertScaling 白名单 或 通用门
  //   lifeMax>5 && damage!=0 && !friendly && !townNPC
  //   → **Boss 不豁免**（boss 不在排除条件里）；ProjectNPC（25/30/…）靠白名单进入
  if (NEEDS_EXPERT_SCALING.has(s.type) || (s.lifeMax > 5 && s.damage !== 0 && !s.friendly && !s.townNPC)) {
    s.difficulty = strengthOverride != null ? strengthOverride : ctx.difficulty;   // :18086
    if (s.difficulty >= GDL.EXPERT && ctx.hardMode) scaleStatsForExpertHardmode(s, ctx);  // :18087-18089
    scaleStatsByDifficulty(s, ctx);                                                 // :18090
    if (s.difficulty >= GDL.EXPERT) {
      scaleStatsByPlayerCount(s, activePlayersCount != null ? activePlayersCount : ctx.activePlayerCount);  // :18091-18094
    }
    // :18096-18100 弹体 NPC 以外 lifeMax 下限 6（经典档同样生效）
    if ((s.type < 0 || !PROJECTILE_NPC.has(s.type)) && s.lifeMax < 6) s.lifeMax = 6;
    // :18101-18103 defDamage/defDefense/defLifeMax 快照 → 调用侧另存 baseDamage/baseDefense
  }
}

// ---------------------------------------------------------------------------
// NPC.ScaleStats_ByDifficulty（NPC.cs:18106-18116）
// ---------------------------------------------------------------------------
function scaleStatsByDifficulty(s: ScalingStats, ctx: ScaleStatsWorld): void {
  if (s.type < 0 || !PROJECTILE_NPC.has(s.type)) {                       // :18108-18112
    s.lifeMax = Math.trunc(f32(s.lifeMax * sampleCurve(ENEMY_MAX_LIFE_MULTIPLIER, s.difficulty)));
    s.value = Math.trunc(f32(s.value * sampleCurve(ENEMY_MONEY_DROP_MULTIPLIER, s.difficulty)));
  }
  s.damage = getAttackDamageScaledByDifficulty(s.damage, s.difficulty);  // :18113
  s.knockBackResist = getKnockbackMultiplierScaledByDifficulty(s.knockBackResist, s.difficulty);  // :18114
  scaleStatsByDifficultyTweaks(s, ctx);                                  // :18115
}

// ---------------------------------------------------------------------------
// NPC.ScaleStats_ByDifficulty_Tweaks（NPC.cs:18118-18447）
//   num=伤害系数（Classic→Expert）/ num2=生命 Classic→Expert / num3=生命 Expert→Master
// ---------------------------------------------------------------------------
function scaleStatsByDifficultyTweaks(s: ScalingStats, ctx: ScaleStatsWorld): void {
  let num = 1.0;   // damage
  let num2 = 1.0;  // lifeMax (classic→expert)
  let num3 = 1.0;  // lifeMax (expert→master)
  const type = s.type;

  // ---- getGoodWorld 世吞/骷髅王/血肉墙本体降容联动（:18125-18152）----
  //   6 世吞头 且 AnyNPCs(13)（世吞在场）→ 大师生命数 ×0.85、伤害 ×1.5、专家防 +2
  //   32 腐化头 且 AnyNPCs(35)（骷髅王在场）→ 同上、专家防 +6
  //   24 火妖 且 AnyNPCs(113)（血肉墙在场）→ 同上、专家防 +10
  if (ctx.getGoodWorld) {
    if (type === 6 && ctx.anyNpc(13)) {
      num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
      num2 *= 1.5;
      if (s.difficulty >= GDL.EXPERT) s.defense += 2;
    }
    if (type === 32 && ctx.anyNpc(35)) {
      num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
      num2 *= 1.5;
      if (s.difficulty >= GDL.EXPERT) s.defense += 6;
    }
    if (type === 24 && ctx.anyNpc(113)) {
      num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
      num2 *= 1.5;
      if (s.difficulty >= GDL.EXPERT) s.defense += 10;
    }
  }

  // ---- 类型逐档系数（:18154-18386；else-if 链，先命中先得）----
  //   210/211 蜂/毒蜂：生命 ×0.6、伤害 ×0.6、专家防御 Remap(1,0.8)
  if (type === 210 || type === 211) {
    num2 = 0.6;                       // 原文 0.6000000000000001 (double) → (float) 后为 0.6
    num = 0.6;
    s.defense = Math.trunc(remap(s.difficulty, GDL.CLASSIC, GDL.EXPERT, 1, 0.8) * s.defense);
  } else if (type === 5) {            // 5 克眼仆从（ServantOfCthulhu，:18159-18163 num2=0.75）
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
  } else if (type === 4) {            // 4 克苏鲁之眼
    num2 = 0.65;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
  } else if (type >= 13 && type <= 15) {  // 世吞三段
    num2 = 0.7;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    if (type === 13) num *= 1.1;      // 头
    if (type === 14) num *= 0.8;      // 身
    if (type === 15) num *= 0.8;      // 尾
    if (s.difficulty >= GDL.EXPERT) { s.scale *= expertScaleMul(type); s.defense += 2; }
  } else if (type === 266 || type === 267) {  // 克脑 + 爬行者
    num2 = 0.85;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num *= 0.9;
    if (s.difficulty >= GDL.EXPERT) s.scale *= expertScaleMul(type);
  } else if (type === 50) {           // 50 骷髅王
    num2 = 0.7;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num *= 0.8;
  } else if (type === 471) {          // 471 哥布林召唤师
    num2 = 0.85;
  } else if (type === 472) {          // 472 哥布林召唤师(暗影焰)
    num2 = 0.85;
    num = 0.8;
  } else if (type === 492) {          // 492 海盗神射手
    num2 = 0.85;
  } else if (type === 393 || type === 394 || type === 395) {  // 火星飞碟三段
    num2 = 0.85;
  } else if (type === 222) {          // 222 蜂后
    num2 = 0.7;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 0.9;
  } else if (type === 35) {           // 35 骷髅王头(地牢守卫同 id 族)
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 1.1;
  } else if (type === 36) {           // 36 骷髅王手
    num2 = 1.3;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 1.1;
  } else if (type === 668) {          // 668 帝王凝胶(史莱姆皇后召唤物)
    num2 = 0.85;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
  } else if (type === 113 || type === 114) {  // 血肉墙 / 之眼
    num2 = 0.7;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 1.5;
    if (s.difficulty >= GDL.EXPERT) s.defense += 6;
  } else if (type === 115) {          // 115 饥饿者
    num2 = 0.7;
    if (s.difficulty >= GDL.EXPERT) s.defense += 6;
  } else if (type === 116) {          // 116 饥饿者 II
    num2 = 0.7;
  } else if (type === 117 || type === 118 || type === 119) {  // 憎恶蜂群
    num2 = 0.8;
  } else if (type === 657) {          // 657 史莱姆皇后
    num2 = 0.8;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
  } else if (type >= 658 && type <= 660) {  // 皇后水晶/水晶仆从
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
  } else if (type >= 134 && type <= 136) {  // 毁灭者三段
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    if (type === 134) num *= 2.0;     // 头
    if (type === 135) num *= 0.85;    // 身
    if (type === 136) num *= 0.85;    // 尾
    if (s.difficulty >= GDL.EXPERT) s.scale *= expertScaleMul(type);
  } else if (type === 139) {          // 139 毁灭者探针
    num2 = 0.75;
    num = 0.8;
    if (s.difficulty >= GDL.EXPERT) s.scale *= expertScaleMul(type);
  } else if (type >= 127 && type <= 131) {  // 机械骷髅王 + 部件
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 0.85;
  } else if (type >= 125 && type <= 126) {  // 双子魔眼
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 0.85;
  } else if (type === 262) {          // 262 世纪之花
    num2 = 0.7;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 1.15;
  } else if (type === 264) {          // 264 世纪之花钩/触手
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 1.15;
  } else if (type === 636) {          // 636 光之女皇
    num2 = 0.7;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
  } else if (type >= 245 && type <= 249) {  // 石巨人族
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 0.8;
  } else if (type === 370) {          // 370 猪龙鱼公爵
    num2 = 0.65;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 0.7;
  } else if (type === 371 || type === 372 || type === 373) {  // 猪鲨气泡/鲨龙卷
    if (type !== 371) num2 = 0.75;
    num = 0.75;
  } else if (type === 439 || type === 440 || (type >= 454 && type <= 459) || type === 522 || type === 523) {
    // 拜月教邪教徒 439/440、拜月教忠实信徒 454-459、邪教弓手 522/523
    if (type !== 522) {
      num2 = 0.75;
      num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    }
    num = 0.75;
  } else if (type === 397 || type === 396 || type === 398) {  // 月总手/头/核心
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 0.75;
  } else if (type === 551) {          // 551 火星走卒(地表 UFO)
    num2 = 0.75;
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
    num = 0.65;
  } else if (OLD_ONES_ARMY.has(type)) {  // 旧日军团全体
    num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
  }

  // ---- 月事件入侵组（:18388-18420）----
  const invasionGroup = getNPCInvasionGroup(type);
  if (invasionGroup === -2 || invasionGroup === -1) {
    switch (type) {
      // 哀木 325 / 南瓜王 327 / 冰女王 345 / 圣诞坦克 346 / 精灵直升机 344：
      // 生命 ×0.65、大师生命 ×0.85、伤害 ×0.75
      case 315: case 325: case 327: case 344: case 345: case 346:
        num2 = 0.65;
        num3 *= COMMON_MASTER_BOSS_LIFE_REDUCTION;
        num = 0.75;
        break;
      default:                        // 其余南瓜/霜月杂兵：生命 ×0.75、伤害 ×0.75
        num2 = 0.75;
        num = 0.75;
        break;
    }
  }

  // ---- 汇总（:18422-18433）----
  let num4 = 1;
  num4 *= remap(s.difficulty, GDL.CLASSIC, GDL.EXPERT, 1, f32(num2));
  num4 *= remap(s.difficulty, GDL.EXPERT, GDL.MASTER, 1, f32(num3));
  s.lifeMax = roundCS(f32(f32(s.lifeMax) * num4));
  let num5 = 1;
  num5 *= remap(s.difficulty, GDL.CLASSIC, GDL.EXPERT, 1, f32(num));
  s.damage = roundCS(f32(f32(s.damage) * num5));
}

// ---------------------------------------------------------------------------
// NPC.ScaleStats_ForExpertHardmode（NPC.cs:18448-18497）
//   专家+困难模式 的"杂兵兜底增强"：把 damage+defense+lifeMax/4 拉到 80
//   （世花后 100）的强度水位。boss / lifeMax>=1000 / DontDoHardmodeScaling 全豁免。
// ---------------------------------------------------------------------------
function scaleStatsForExpertHardmode(s: ScalingStats, ctx: ScaleStatsWorld): void {
  const isProj = s.type >= 0 && PROJECTILE_NPC.has(s.type);   // :18449
  let flag2 = !DONT_DO_HARDSMODE_SCALING.has(s.type);         // :18450
  if (ctx.getGoodWorld) {                                     // :18452-18468
    if ((s.type === 24 || s.type === 25) && ctx.anyNpc(113)) flag2 = false;
    if ((s.type === 32 || s.type === 33) && ctx.anyNpc(35)) flag2 = false;
    if (s.type === 6 && ctx.anyNpc(13)) flag2 = false;
  }
  if (s.boss || s.lifeMax >= 1000) flag2 = false;             // :18469-18472 ★Boss 豁免点
  if (!flag2) return;

  let num = s.damage + s.defense + Math.trunc(s.lifeMax / 4); // :18476-18478 (int 除法)
  if (num === 0) num = 1;
  let num2 = 80;                                              // :18480
  if (ctx.downedPlantBoss) num2 += 20;                        // :18481-18483
  if (num < num2) {                                           // :18484
    // ★BJ585（2026-10-09）：原版 `float num3 = num2 / num;`（NPC.cs:18584）——
    //   num2/num 均 int，C# 整数除法天然截断（floor）后再隐式转 float。
    //   旧式 f32(num2/num) 保留浮点商（80/46≈1.739）→ 专家困难杂兵伤害/血防全面虚高
    //   （用户实报：哥布林侦察兵 51 防御扣血 30-41，修正后应为 1-2）。
    //   侦察兵钉值：n=46<threshold 80 → num3=floor(80/46)=1（世花后 floor(100/46)=2）。
    const num3 = f32(Math.floor(num2 / num));
    s.damage = Math.trunc(f32(f32(s.damage * num3) * 0.9));   // :18486
    if (!isProj) {                                            // :18487-18492
      s.defense = Math.trunc(f32(s.defense * num3));
      s.lifeMax = Math.trunc(f32(f32(s.lifeMax * num3) * 1.1));
      s.value = Math.trunc(f32(f32(s.value * num3) * 0.8));
    }
  }
}

// ---------------------------------------------------------------------------
// NPC.ScaleStats_ByPlayerCount（NPC.cs:18498-18659）
//   多人玩家数缩放。单人 balance=1 → 全部 `num *= balance` 恒等，仅多人有意义；
//   击退段全部门在 numPlayers>1，单人同样恒等。1:1 抄录以备多人接入。
// ---------------------------------------------------------------------------
export function getStatScalingFactors(numPlayers: number): { balance: number; boost: number } {
  let balance = 1;
  let boost = 0.35;
  for (let i = 1; i < numPlayers; i++) {
    balance += boost;
    boost += (1 - boost) / 3;
  }
  if (balance > 8) balance = (balance * 2 + 8) / 3;
  if (balance > 1000) balance = 1000;
  return { balance, boost };
}

function scaleStatsByPlayerCount(s: ScalingStats, numPlayers: number): void {
  const { balance, boost } = getStatScalingFactors(numPlayers);
  let num = 1.0;
  const type = s.type;
  if (type === 4) num *= balance;
  if (type >= 13 && type <= 15) {
    num *= balance;
    // 世吞：balance 每 +0.34 一档削击退（:18508-18524）
    for (let num2 = 1; num2 < balance; num2 += 0.34) {
      if (s.knockBackResist < 0.1) { s.knockBackResist = 0; break; }
      s.knockBackResist *= 0.8;
    }
  }
  if (type === 266 || type === 267) num *= balance;
  if (type === 50) num *= balance;
  if (type === 471) num *= lerp(1, balance, 2 / 3);
  if (type === 472) num *= lerp(1, balance, 0.5);
  if (type === 222) num *= balance;
  if (type === 35) num *= balance;
  else if (type === 36) num *= balance;
  if (type === 668) num *= balance;
  if (type === 113 || type === 114) num *= balance;
  else if (type === 115) {
    num *= balance;
    if (numPlayers > 4) s.knockBackResist = 0;
    else if (numPlayers > 1) s.knockBackResist *= 1 - boost;
  } else if (type === 116) {
    num *= balance;
    if (numPlayers > 4) s.knockBackResist = 0;
    else if (numPlayers > 1) s.knockBackResist *= 1 - boost;
  }
  if (type === 657) num *= balance;
  if (type >= 658 && type <= 660) num *= balance;
  if (type >= 134 && type <= 136) num *= balance;
  else if (type === 139) num *= lerp(1, balance, 2 / 3);
  if (type >= 127 && type <= 131) num *= balance;
  if (type >= 125 && type <= 126) num *= balance;
  if (type === 262) num *= balance;
  else if (type === 264) num *= balance;
  if (type === 636) num *= balance;
  if (type >= 245 && type <= 249) num *= balance;
  if (type === 370) num *= balance;
  if (type === 439 || type === 440 || (type >= 454 && type <= 459) || type === 523) num *= balance;
  if (type === 397 || type === 396 || type === 398) num *= balance;
  if (type === 551) num *= balance;
  else if (OLD_ONES_ARMY.has(type)) num *= lerp(1, balance, 6 / 7);   // 原文 0.8571428656578064
  const invasionGroup = getNPCInvasionGroup(type);
  if (invasionGroup === -2 || invasionGroup === -1) {
    switch (type) {
      case 315: case 325: case 327: case 344: case 345: case 346:
        break;   // 月事件 Boss 不吃玩家数生命加成（:18648-18653）
      default:
        num *= 1 + (numPlayers - 1) * 0.2;
        break;
    }
  }
  s.lifeMax = roundCS(s.lifeMax * num);
}
