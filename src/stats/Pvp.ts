// PvP 关系判定 + 队伍色 + StatusPvP debuff 表（1.4.5.6 1:1）。
// 权威：Player.InOpposingTeam（1457 Player.cs:4490-4501 / 1456 :4290-4301，
// 全服唯一 PvP 关系判定——旧锚 :4287-4299 为 1456 早期行号,2026-08-30 校准）：
//   双方都 hostile 且（对方 team==0 或 team 不同）。注意原版不检查"自己 team==0"——
//   自己无队、对方有队也算敌对。
// 队伍色：Main.teamColor（Main.cs:1230 数组 + 6610-6615 初始化）。
// StatusPvP：Projectile.StatusPvP（Projectile.cs:11092-11348 弹型表）+
//   Player.StatusToPlayerPvP（Player.cs:6251-6349 近战物品表）——PvP 命中授予 debuff。
import type { BuffState } from './Buffs';
import { BuffType } from './Buffs';

/** Main.teamColor[0..5]（Main.cs:6610-6615）：0 白 / 1 红(218,59,59) / 2 绿(59,218,85)
 *  / 3 蓝(59,149,218) / 4 黄(242,221,100) / 5 粉紫(224,100,242)。
 *  2026-08-20 校对：2-5 档曾为近似色（88,219,84/59,137,255/255,199,0/216,127,255），
 *  聊天队伍频道（PartyChatCommand 用同表）落地时按反编译源更正 */
export const TEAM_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 255, 255],
  [218, 59, 59],
  [59, 218, 85],
  [59, 149, 218],
  [242, 221, 100],
  [224, 100, 242],
];

export function teamColorCss(team: number): string {
  const c = TEAM_COLORS[Math.max(0, Math.min(5, Math.trunc(team)))];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Player.InOpposingTeam（1457 cs:4490-4501 / 1456 :4290-4301）：双方 hostile 且（对方无队 或 异队） */
export function inOpposingTeam(a: { hostile: boolean; team: number }, b: { hostile: boolean; team: number }): boolean {
  if (!a.hostile || !b.hostile) return false;
  return b.team === 0 || b.team !== a.team;
}

// ===================== Main.pvpBuff 白名单（Main.cs:8872-8887） =====================
// 原版语义：仅白名单内 debuff 允许经 PvP 网络链施加给远端玩家（AddBuff 同步门）。
// 本仓 victim-settles 模型下 debuff 全部本地授予、不经网络——此表作为 StatusPvP
// 授予合法性的文档化门禁保留（grant() 只接受白名单成员）。
// 成员：20 中毒 / 70 毒液 / 24 着火 / 323 地狱火 / 31 困惑 / 39 诅咒焰 / 44 霜燃 /
//       324 霜燃2 / 69 灵液 / 103 湿身 / 119 恋爱 / 120 恶臭 / 137 黏液 / 320 凝胶气球 /
//       30 流血 / 36 破甲
export const PVP_BUFF_WHITELIST: ReadonlySet<number> = new Set([
  20, 70, 24, 323, 31, 39, 44, 324, 69, 103, 119, 120, 137, 320, 30, 36,
]);

/** vanilla buff id → BuffType（白名单内已实装的子集；103/119/320 为纯视觉 buff 未实装。
 *  ★BJ739 B11（2026-10-31）：137 Slimed 入册（BuffType.Slimed 建模——六火族 DoT
 *  翻倍消费面;史莱姆枪 406 的 PvP 施加走 AI 专臂非 StatusPvP,见 SlimeGlob 注） */
const VANILLA_TO_BUFFTYPE: ReadonlyMap<number, BuffType> = new Map([
  [20, BuffType.Poisoned],
  [24, BuffType.OnFire],
  [30, BuffType.Bleeding],
  [31, BuffType.Confused],
  [36, BuffType.BrokenArmor],
  [39, BuffType.CursedInferno],
  [44, BuffType.Frostburn],
  [69, BuffType.Ichor],
  [70, BuffType.Venom],
  [120, BuffType.Stinky],
  [137, BuffType.Slimed],
  [323, BuffType.OnFire3],
  [324, BuffType.Frostburn2],
]);

/** 武器浸剂 BuffType → 原版 meleeEnchant id（ItemID 71/73/74/76/77/75 段,
 *  StatusPvP :11096-11124 / StatusToPlayerPvP :6253-6278 同一映射;
 *  金浸剂 4=点金/派对 7 对玩家无效果——原版无分支,不映射） */
export function meleeEnchantOf(buffs: { has(t: BuffType): boolean }): number {
  if (buffs.has(BuffType.ImbueVenom)) return 1;
  if (buffs.has(BuffType.ImbueCursed)) return 2;
  if (buffs.has(BuffType.ImbueFire)) return 3;
  if (buffs.has(BuffType.ImbueIchor)) return 5;
  if (buffs.has(BuffType.ImbueNano)) return 6;
  if (buffs.has(BuffType.ImbuePoison)) return 8;
  return 0;
}

/** Main.rand.Next(a,b)（含头不含尾）→ 秒（原表 60t=1s 系已折算进调用参数） */
const next = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a));

/** 白名单门禁的 AddBuff（Player.AddBuff 语义=max 合并,BuffState.apply 自带） */
function grant(buffs: BuffState, vanillaBuff: number, seconds: number): void {
  if (!PVP_BUFF_WHITELIST.has(vanillaBuff)) return;   // 文档化门禁（原版同步门等价）
  const t = VANILLA_TO_BUFFTYPE.get(vanillaBuff);
  if (t === undefined) return;   // 103/119/137/320 纯视觉 buff 未实装
  buffs.apply(t, seconds);
}

/** 近战/鞭弹 PvP 附魔前置（Projectile.cs:11096-11124 与 Player.cs:6253-6268 同一分支,
 *  Projectile 版条件含 IsAWhip——调用方 ctx.whip 传入） */
function grantEnchant(buffs: BuffState, meleeEnchant: number, melee: boolean, whip: boolean): void {
  if (!(melee || whip) || meleeEnchant <= 0) return;
  if (meleeEnchant === 1) grant(buffs, 70, next(5, 10));        // Venom 5-10s
  else if (meleeEnchant === 2) grant(buffs, 39, next(3, 7));    // CursedInferno 3-7s
  else if (meleeEnchant === 3) grant(buffs, 24, next(3, 7));    // OnFire 3-7s
  else if (meleeEnchant === 5) grant(buffs, 69, next(10, 20)); // Ichor 10-20s
  else if (meleeEnchant === 6) grant(buffs, 31, next(1, 4));    // Confused 1-4s
  else if (meleeEnchant === 8) grant(buffs, 20, next(5, 10));   // Poisoned 5-10s
}

/** Projectile.StatusPvP（Projectile.cs:11092-11348）1:1——弹幕 PvP 命中 debuff 表。
 *  ctx：melee/ranged/whip = 弹幕性质（决定浸剂/冰霜/熔岩石前置是否生效）；
 *  meleeEnchant/frostBurn/magmaStone = 攻击者侧状态（由调用方从攻击者代理/消息位还原） */
export function statusPvPProjectile(
  buffs: BuffState, projType: number,
  ctx: { melee?: boolean; ranged?: boolean; whip?: boolean; meleeEnchant: number; frostBurn: boolean; magmaStone: boolean },
): void {
  grantEnchant(buffs, ctx.meleeEnchant, !!ctx.melee, !!ctx.whip);
  const g = (b: number, s: number) => grant(buffs, b, s);
  switch (projType) {
    case 1083: g(30, next(4, 7)); break;                       // 流血 4-7s
    case 285: g(31, Math.floor(Math.random() * 3) === 0 ? 3 : 1); break; // 困惑 1/3:3s
    case 669: if (Math.floor(Math.random() * 20) === 0) g(31, next(2, 6)); break;
    case 182: g(30, next(8, 13)); break;                   // 流血 8-13s
    case 190: g(30, next(4, 7)); break;                        // 流血 4-7s
    case 301: g(36, next(10, 21)); break;                  // 破甲 10-21s
    case 383: case 262: if (Math.floor(Math.random() * 3) === 0) g(31, Math.floor(next(10, 21) * 0.1)); break;
    case 23: g(30, next(8, 13)); break;
    case 320: g(30, next(3, 6)); break;                        // 流血 3-6s
    case 1048: g(20, 10); g(120, 10); break;              // 中毒+恶臭 10s
    case 978: g(24, 3); break;
    case 295: case 296: g(323, next(8, 16)); break;            // 地狱火 8-16s
    case 399: case 400: case 401: case 402: g(24, next(3, 7)); break;
    case 478: case 480: g(39, next(3, 7)); break;              // 诅咒焰 3-7s
    case 2: if (Math.floor(Math.random() * 3) === 0) g(24, 3); break;
    case 172: if (Math.floor(Math.random() * 3) === 0) g(44, 4); break;
    case 15: if (Math.floor(Math.random() * 2) === 0) g(24, 5); break; // remixWorld→323 分支：remix 未实装恒 24
    case 253: if (Math.floor(Math.random() * 2) === 0) g(44, 8); break;
    case 19: if (Math.floor(Math.random() * 5) === 0) g(24, 3); break;
    case 113: if (Math.floor(Math.random() * 5) === 0) g(44, 3); break;
    case 33: if (Math.floor(Math.random() * 5) === 0) g(20, 7); break;
    case 976: if (Math.floor(Math.random() * 4) === 0) g(20, 7); break;
    case 34: if (Math.floor(Math.random() * 2) === 0) g(24, 4); break;
    case 35: if (Math.floor(Math.random() * 4) === 0) g(24, 3); break;
    case 54: if (Math.floor(Math.random() * 2) === 0) g(20, 10); break;
    case 267: g(20, Math.floor(Math.random() * 3) === 0 ? 60 : 30); break;
    case 63: if (Math.floor(Math.random() * 3) !== 0) g(31, 2); break;
    case 85: g(24, 20); break;
    case 95: case 103: case 104: case 482: g(39, 7); break;
    case 278: case 279: case 280: g(69, 15); break;       // 灵液 15s
    case 282: case 283: g(70, 10); break;                 // 毒液 10s
    case 163: case 310: case 1008: case 1010: case 1011:
      g(24, Math.floor(Math.random() * 3) === 0 ? 10 : 5); break;
    case 1009: g(39, 5); break;
    case 265: g(20, 20); break;
    case 355: g(70, 30); break;
    default: break;
  }
  // 冰霜盔甲（:11190 melee||ranged）+ 熔岩石（:11197 仅 melee,阶梯 6/4/2s）
  if ((ctx.melee || ctx.ranged) && ctx.frostBurn) g(324, next(1, 8));
  if (ctx.melee && ctx.magmaStone) {
    if (Math.floor(Math.random() * 4) === 0) g(24, 6);
    else if (Math.floor(Math.random() * 2) === 0) g(24, 4);
    else g(24, 2);
  }
}

/** Player.StatusToPlayerPvP（Player.cs:6251-6349）1:1——近战 PvP 命中 debuff 表。
 *  itemId = 凶器内部物品 id（仅 switch 表内 8 个原版 id 生效）;flask/frost/magma
 *  语义与弹幕版同源（magma 阶梯概率不同：1/7→6s / 1/3→2s / 其余 1s,:6279-6290） */
export function statusPvPMelee(
  buffs: BuffState, itemId: number,
  ctx: { meleeEnchant: number; frostBurn: boolean; magmaStone: boolean },
): void {
  grantEnchant(buffs, ctx.meleeEnchant, true, false);
  if (ctx.frostBurn) grant(buffs, 324, next(1, 8));
  if (ctx.magmaStone) {
    if (Math.floor(Math.random() * 7) === 0) grant(buffs, 323, 6);
    else if (Math.floor(Math.random() * 3) === 0) grant(buffs, 323, 2);
    else grant(buffs, 323, 1);
  }
  if (itemId === 5129) grant(buffs, 120, 5);
  switch (itemId) {
    case 121: if (Math.floor(Math.random() * 2) === 0) grant(buffs, 24, 3); break;
    case 3823: if (Math.floor(Math.random() * 4) === 0) grant(buffs, 323, 5); break;
    case 5382: if (Math.floor(Math.random() * 3) === 0) grant(buffs, 323, 5); break;
    case 122: if (Math.floor(Math.random() * 10) === 0) grant(buffs, 24, 3); break;
    case 190: if (Math.floor(Math.random() * 4) === 0) grant(buffs, 20, 7); break;
    case 217: if (Math.floor(Math.random() * 5) === 0) grant(buffs, 24, 3); break;
    case 1123: grant(buffs, 31, 2); break;
    default: break;
  }
}
