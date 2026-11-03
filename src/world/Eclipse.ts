// 日食（Solar Eclipse）1:1 移植（Terarria1456 / 1.4.5.6）。
// 状态挂 World.clock.eclipse（Main.eclipse）。
//
// 源码锚点：
// - 自然触发（黎明 roll）           1457 Main.cs:66399-66420（UpdateTime_StartDay 尾段；1456 :64899-64920）
// - stopEvents 门槛（黎明整段压掉）  1457 Main.cs:66395-66398（1456 :64895-64898）
// - 入夜清除 + 成就 3（挺过日食）    1457 Main.cs:66221-66225（UpdateTime_StartNight；1456 :64721-64725）
// - 日耀碑牌 2767 使用/可用性门      1457 Player.cs:44330-44350（使用体）/ 52908-52911（可用性门；1456 :43308-43328/:51431-51434）
// - 专属怪出怪表（else-if 全表）     NPC.cs:3552-3614（SpawnAnNPC 内，先于蘑菇地/天空怪段；BJ591 重锚）
// - 出怪段门（地表 && 白天 && 日食）  NPC.cs:3552-3554
// - 专属掉落注册                    ItemDropDatabase.cs:185-221（RegisterEclipse）
// - 存档（世界头 bloodMoon 后一位）   WorldFile.cs:1277-1278（写）/ 2070-2072（读）
// - BGM Eclipse 27                   MusicID.cs:66；选曲 Music.ts:158-159（相机在地表半屏带内）
//
// 出怪表执行在 VanillaSpawner.pickAnNPC（日食段，行内注释对照 NPC.cs:3552-3614）；
// 本模块只做触发/持续/清除/门判定 + 表导出（测试 oracle 与文档对照）。
import type { World } from './World';
import { Lang } from '../i18n/Lang';

/** 日耀碑牌（ItemID.SolarTablet） */
export const SOLAR_TABLET_ITEM = 2767;

/** ChatColors.World（50,255,130）——日食公告（misc[20]，remix 公告 misc[106] 已接） */
export const ECLIPSE_ANNOUNCE_COLOR = [50, 255, 130] as const;

/** Game 侧宿主回调（公告/成就——避免本模块反向依赖 Game） */
export interface EclipseHost {
  /** ChatHelper.BroadcastChatMessage(Lang.misc[20], ChatColors.World) */
  broadcast(text: string, r: number, g: number, b: number): void;
  /** AchievementsHelper.NotifyProgressionEvent：2=日食开始 / 3=挺过日食（1457 :66404/:66223；1456 :64904/:64723——R31-F1 重锚） */
  notifyProgressionEvent(n: number): void;
}

/** NPC.downedMechBossAny（NPC.cs:80228/80271/80278）：击败 125|126|127|134 任一机械 Boss */
export function downedMechAny(w: World): boolean {
  return !!(w.flags['downed_125'] || w.flags['downed_126'] || w.flags['downed_127']
    || w.flags['downed_134']);
}

/** 世花已杀（NPC.downedPlantBoss = downed_262，NPC.cs:80230-80238）——出怪表 plantera 档门 */
export function downedPlantera(w: World): boolean {
  return !!w.flags['downed_262'];
}

/** 三机械全杀（NPC.cs:3554-3558 flag14：downedMechBoss1 && 2 && 3 = 134/125|126/127） */
export function downedAllMechs(w: World): boolean {
  return !!(w.flags['downed_134'] && (w.flags['downed_125'] || w.flags['downed_126'])
    && w.flags['downed_127']);
}

export type DawnEclipseResult =
  | 'eclipse'        // 命中 → eclipse=true + misc[20] 公告（当日入侵 roll 跳过）
  | 'roll-invasion'; // 未命中/门不足 → 进入原版 else 分支（哥布林/海盗自然 roll）

/**
 * 黎明日食 roll（Main.cs:64899-64920，1:1）：
 * 门 = hardMode && downedMechBossAny && rand.Next(20)==0（短路求值——肉前/无机械
 * 不消耗本次掷骰，与原版 && 序一致）。命中：
 *   sundialCooldown = 0; moondialCooldown = 0（:64901-64902——两晷冷却立即清零）
 *   eclipse = true（:64903）
 *   NotifyProgressionEvent(2)（:64904）
 *   公告 misc[20]（:64913，ChatColors.World）
 * stopEvents=true 时整段 return（:64895-64898）——调用方在 stopEvents 时不应调用本函数。
 * next01 = [0,1) 均匀源（原版 rand.Next(20)，Game 侧走 Math.random）。
 */
export function dawnEclipseRoll(
  w: World,
  stopEvents: boolean,
  next01: () => number,
  host: EclipseHost,
): DawnEclipseResult {
  if (stopEvents) return 'roll-invasion';   // :64895-64898（stopEvents → return，else 段不可达）
  if (!w.flags.hardMode || !downedMechAny(w)) return 'roll-invasion';
  if (!(next01() * 20 < 1)) return 'roll-invasion';   // rand.Next(20) == 0
  w.clock.eclipse = true;                    // :64903
  w.sundialCooldown = 0;                     // :64901
  w.moondialCooldown = 0;                    // :64902
  host.notifyProgressionEvent(2);            // :64904
  // ★IIIII224（:64910-64914）：remix 世界公告 misc[106]「恐怖来袭！」替代 misc[20]
  host.broadcast(Lang.misc(!!w.seedFlags?.remix ? 106 : 20), ...ECLIPSE_ANNOUNCE_COLOR);
  return 'eclipse';
}

/** 日耀碑牌可用性门（Player.cs:51431-51434）：白天 && 非日食中 && 困难模式 */
export function canUseSolarTablet(w: World): boolean {
  return !!(w.flags.hardMode && w.clock.isDay && !w.clock.eclipse);
}

/**
 * 日耀碑牌使用体（Player.cs:43308-43328）：ItemTimeIsZero && itemAnimation>0 &&
 * type==2767 && dayTime && !eclipse → 播 SoundID 15 + ApplyItemTime（Game 侧
 * useTime 消费）+ eclipse=true + misc[20] 公告（netMode!=1 分支）。返回 false =
 * 静默不可用（原版不消耗物品不播公告）。
 */
export function useSolarTablet(w: World, host: EclipseHost): boolean {
  if (!canUseSolarTablet(w)) return false;
  w.clock.eclipse = true;                    // :43314
  // ★IIIII224（:43317-43321 同 remix misc[106] 分支）
  host.broadcast(Lang.misc(!!w.seedFlags?.remix ? 106 : 20), ...ECLIPSE_ANNOUNCE_COLOR);
  return true;
}

/**
 * 入夜清除（1457 Main.cs:66221-66225，UpdateTime_StartNight :66189 起；1456 同段
 * :64721-64725——R31-F1 重锚）：日食只持续一个白天，入夜即结束。成就 3（挺过
 * 日食）在清除**前**求值（1457 :66222-66224 if eclipse →
 * NotifyProgressionEvent(3)），随后 eclipse=false（:66225）。返回是否发生了清除。
 */
export function endEclipseAtDusk(w: World, host: EclipseHost): boolean {
  if (!w.clock.eclipse) return false;
  host.notifyProgressionEvent(3);            // 1457 :66222-66224（1456 :64722-64724）
  w.clock.eclipse = false;                   // 1457 :66225（1456 :64725）
  return true;
}

/** 出怪表档门（NPC.cs:3554-3558 flag14 / downedPlantBoss :3559 等；BJ591 随段重锚） */
export type EclipseSpawnGate = 'none' | 'plantera' | 'allMech';

export interface EclipseSpawnEntry {
  /** 出怪 NPC id */
  id: number;
  /** Main.rand.Next(denom) == 0（else-if 链按序消耗掷骰） */
  denom: number;
  /** 前置档门 */
  gate: EclipseSpawnGate;
  /** 场上同时上限（null=无上限；1=AnyNPCs 唯一，2=CountNPCS<2） */
  cap: number | null;
  /** 原版行号（NPC.cs） */
  line: [number, number];
}

/**
 * 日食专属出怪表（NPC.cs:3552-3614，else-if 链 1:1；★BJ591 行号勘误——旧注
 * 3459-3521 系 1456 代际锚,1457 全段 +93 漂移,逐条目 line 字段同步重锚）。
 * 段门（:3552-3554）：spawnTileY <= worldSurface（remix 深层支省略）&& dayTime && eclipse。
 * 执行点 VanillaSpawner.pickAnNPC 日食段；本表为权威对照/测试 oracle。
 */
export const ECLIPSE_SPAWN_TABLE: readonly EclipseSpawnEntry[] = [
  { id: 477, denom: 80, gate: 'plantera', cap: 1, line: [3559, 3562] },   // 飞蛾魔 Mothron（唯一）
  { id: 251, denom: 50, gate: 'none', cap: 1, line: [3563, 3566] },       // 独眼怪 Eyezor（唯一）
  { id: 466, denom: 5, gate: 'plantera', cap: 1, line: [3567, 3570] },    // 精神病人 Psycho（唯一）
  { id: 463, denom: 20, gate: 'plantera', cap: 1, line: [3571, 3574] },   // 钉头 Nailhead（唯一）
  { id: 467, denom: 20, gate: 'plantera', cap: 2, line: [3575, 3578] },   // 致命球 Deadly Sphere（≤2）
  { id: 159, denom: 15, gate: 'none', cap: null, line: [3579, 3582] },    // 吸血鬼 Vampire
  { id: 253, denom: 13, gate: 'allMech', cap: null, line: [3583, 3586] }, // 死神 Reaper（三机械全杀）
  { id: 469, denom: 8, gate: 'none', cap: null, line: [3587, 3590] },     // 被附身者 The Possessed
  { id: 468, denom: 7, gate: 'plantera', cap: null, line: [3591, 3594] }, // 蝇博士 Dr. Man Fly
  { id: 460, denom: 5, gate: 'plantera', cap: null, line: [3595, 3598] }, // 屠夫 Butcher
  { id: 162, denom: 4, gate: 'none', cap: null, line: [3599, 3602] },     // 科学怪人 Frankenstein
  { id: 461, denom: 3, gate: 'none', cap: null, line: [3603, 3606] },     // 深海怪形 Creature from the Deep
  { id: 462, denom: 2, gate: 'none', cap: null, line: [3607, 3610] },     // 弗里茨 Fritz
  { id: 166, denom: 1, gate: 'none', cap: null, line: [3611, 3614] },     // 沼泽怪 Swamp Thing（兜底）
];

/**
 * 日食专属掉落注册的 NPC 集（ItemDropDatabase.cs:185-221 RegisterEclipse 全量）。
 * 掉落本体在 data/vanilla-npcdrops.json（含 DownedAllMechBosses/DownedPlantera
 * 条件链与 ExpertGetsRerolls 档），此处导出做完整性对照。
 */
export const ECLIPSE_DROP_NPCS: readonly number[] = [
  461,   // :187  Deep 海龟壳 497（专家重掷 1/50）
  158, 159,   // :188-189  蝙蝠/吸血鬼：月魂 900（专家重掷 1/35）+ 5597（1/40）
  251,   // :190-192  Eyezor：死亡镰刀 1311（专家 1/15）+ 5239/5236（各 1/15）
  477,   // :193,201-205  Mothron：5237（1/15）+ 机械全杀门 → 破茧之刃 1570（1/4）/
         //   世花门 → 蛾翼 2770（1/20）+ 蛾蛋 3292（1/3）
  253,   // :194,206  Reaper：5223（1/60）+ 机械全杀门 → 死神镰刀 1327（1/40）
  460,   // :195,207-210  Butcher：5227（1/60）+ 屠夫电锯 3098（世花门 1/40）+ 屠夫套装 4740-4742（各 1/50）
  469,   // :196  The Possessed：5260（1/60）
  166, 162,   // :197  Swamp Thing/Frankenstein：5261（1/450）
  462,   // :198  Fritz：5262（1/60）
  468,   // :211-213  Dr. Man Fly：疯狂手套 3105（世花门 1/40）+ 蝇博士套装 4738/4739（各 1/50）
  466,   // :214  Psycho：精神病人刀 3106（世花门 1/40）
  467,   // :215  Deadly Sphere：致命球法杖 3249（世花门 1/30）
  463,   // :216-220  Nailhead：钉头 3107（1/25，专家重掷）→ 附带 3108（100-200）
];
