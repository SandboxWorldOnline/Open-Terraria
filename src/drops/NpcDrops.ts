// 原版 1.4.5.6 怪物击杀掉落求值运行时（1:1 对照）
// - 规则树数据：src/data/vanilla-npcdrops.json（tools/extract-npcdrops.mjs 从
//   ItemDropDatabase.cs 结构化提取；626 条注册、规则独立按注册序求值）
// - 求值语义：ItemDropResolver.cs:23-58（CanDrop 失败=DoesntFillConditions、
//   掷骰失败=FailedRandomRoll、成功=Success；链按父状态门控）
// - 钱币管线：NPC.cs NPCLoot_DropMoney(:80412) closestPlayer.luck 概率双掷取极值
//   + 8 层随机放大 + 贪心拆币（rollCoins,与原版同源 luck——非 luck=0）
// - 心/星：NPC.cs NPCLoot_DropCommonLifeAndMana(:80332)
// - Boss 药水+心：DoDeathEvents_DropBossPotionsAndHearts(:79790)
// - 初速度：Item.cs:49746-49756 vx∈[-3,3] vy∈[-4.0,-1.6]（Next(-40,-15) 上界开,RB30b-F4）
// luck 链（2026-08-14 复核全通）：ctx.luck = 击杀处注入 Player.luck（Enemy 侧,
//   Enemy.ts dropCtx luck: p.luck）——src/stats/Luck.ts RecalculateLuck（:28672-28697）
//   全来源已接：瓢虫 604/605（击杀坏运/触碰好运）、微光化币 coinLuck、火炬正确性
//   torchLuck、花园地精、灯笼夜、幸运药水三档、风筝 buff 三档、银河珍珠、恶臭、
//   幸运装备（币/马掌/四叶草族 5574/5575/5576——Player.luckEquipmentBonus 口袋+
//   装备位扫描，2026-08-20 接）、碎镜。掷骰消费 = Luck.RollLuck 同构（rollLuck/
//   tryRoll/rollCoins 双轮极值/rollHeartsAndStars）。遗留登记（非 luck 链缺口）：
//   四叶草获取链——5576 乌鸦 301 掉落 1/10（本表已载）/5574 割成熟药草 1/1000
//   （DropBait.dropCloverRoll）/5575 微光转化 5574→5575（vanilla-shimmer 已载）;
//   多人 luck 已按 closestPlayer 注入（Enemy 侧 FindClosest 1:1,lootPlayers 表
//   承载,2026-08-20 per-client 批一并落地——旧"近似为本地玩家"登记撤销）。
// 偏差（记录）：NotFromStatue 恒 true；
// 天空盒/DST 联动条件恒 false；月事件四条件已实现（ctx.moonEvent 注入，见 evalCond）。
// RedHatSkeletron/MissingTwin/EmpressOfLightIsGenuinelyEnraged 经 ctx.ai3/
// anyNpcOfType 接通（Enemy 注入）；MechdusaKill（seedFlags 投影 ctx.mechdusaWorld）/
// NamedNPC（TownNPC 死亡注入 ctx.npcGivenName）/EyeOfCthulhuDefeatedAndNoAltars
// InWorld（ctx.noAltarsInWorld 读档祭坛普查）均接真值（2026-08-20，注释见 evalCond）。
import dropData from '../data/vanilla-npcdrops.json';
import npcValueJson from '../data/vanilla-npcvalue.json';
import { STATUES } from '../data/vanillaStyleDrops';
import { ITEM_NO_GRAVITY_VIDS } from '../data/items';
import type { RNG } from '../core/rng';
import type { LootPlayerCtx } from '../entities/types';
import { Lang } from '../i18n/Lang';

// MechdusaKill 目标集（Conditions.cs:581：{127 毁灭者, 126 Retinazer 侧眼,
// 125 Spazmatillum 侧眼, 134 Skeletron Prime}——同场任一「其它」存活即不放行）
const MECHDUSA_TARGETS = [127, 126, 125, 134];
// NamedNPC 构造实参（ItemDropDatabase.cs:732-734 仅有三处）——提取器剥了
// "<类目>Names." 前缀，此处按原版全键拼回（Language.GetTextValue 比对侧）
const NAMED_NPC_KEYS: Record<string, string> = {
  Andrew: 'GuideNames.Andrew',
  Whitney: 'SteampunkerNames.Whitney',
  Jim: 'PainterNames.Jim',
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rule = any;
const ENTRIES: Array<{ npcs?: number[]; global?: boolean; rule: Rule }> = (dropData as any).entries;
const SLIME_BODY: Record<string, [number, number]> = (dropData as any).slimeBody;
const NPC_VALUE: Record<string, number> = npcValueJson as any;

/** netID → 规则列表（注册序）；原版 _entriesByNpcNetId */
const rulesByNpc = new Map<number, Rule[]>();
const globalRules: Rule[] = [];
for (const e of ENTRIES) {
  if (e.global) { globalRules.push(e.rule); continue; }
  for (const n of e.npcs ?? []) {
    let l = rulesByNpc.get(n);
    if (!l) rulesByNpc.set(n, l = []);
    l.push(e.rule);
  }
}

/** NPC.value（铜币）。传 netId：负 id 变体（史莱姆 -1..-10 等）有自己的 value 表，
 *  正 netID/无变体传 type 即可。
 *  ★P7 红蓝修正(M4 高优①):mod NPC(id≥800)金币价值经 registerModNpcValue
 *  注册面直写(旧实现 ModNpcContent.value 声明被丢弃=mod 怪恒 0 金)。原版域查表先行,零扰动。 */
const MOD_NPC_VALUE = new Map<number, number>();
export function registerModNpcValue(npcId: number, value: number): void {
  if (npcId < 800) return;
  MOD_NPC_VALUE.set(npcId, Math.max(0, value));
}
export function npcValueOf(netIdOrType: number): number {
  if (netIdOrType >= 800 && MOD_NPC_VALUE.has(netIdOrType)) return MOD_NPC_VALUE.get(netIdOrType)!;
  return NPC_VALUE[String(netIdOrType)] ?? 0;
}

// ---------------------------------------------------------------------------
// ★issue#46 N11 / N16：掉落域纯函数（Game.dropContext / Game.skyblockBossCompensation
//   的求值源——数据与判据单源，Game 只负责注入世界投影与派发落地）
// ---------------------------------------------------------------------------

/** Main.WindyEnoughForKiteDrops（1457 Main.cs:3003 `Math.Abs(windSpeedTarget) >=
 *  _maxWind`；`_maxWind = 0.4f` Main.cs:67637）——判据用 **windSpeedTarget**（不是
 *  跟随中的 current），阈值 0.4 且为 `>=`。消费 = Conditions.WindyEnoughForKiteDrops
 *  （Conditions.cs:1246-1252 直读该属性）。
 *  ★issue#46 N11：旧实现读 windSpeedCurrent 且 `> 0.5`——①0.45 档漏发风筝
 *  ②风速回落/追随途中 current 仍高时错发（0/0.6）。 */
export function windyEnoughForKiteDrops(windSpeedTarget: number): boolean {
  return Math.abs(windSpeedTarget) >= 0.4;
}

/** Player.FindClosest（1457 Player.cs:4934-4958）在掉落结算玩家表上的 1:1 投影。
 *  原版是**两步式**：①`result` 先置为【最小槽位】的 active 玩家（**不排除 dead**）；
 *  ②按槽位 0..254 **升序**、严格 `<` 取曼哈顿中心距最近的存活者；③全员死亡时返回
 *  ①（首个 active，哪怕已死）。返回值恒被 `Main.player[...]` 解引用（NPC.cs:79634
 *  `NPCLoot` 的 closestPlayer、:80332/:80412 的 luck/hp/mana）——故「全员死亡」
 *  不能返回 null。
 *  ★issue#46 N17 红队勘正（2026-11-03）：`Game.lootPlayers` 的排列是
 *  `[本地, ...net.players 插入序]`，不是槽位序；旧 Enemy 侧遍历直接按它取最近，
 *  两头偏离原文——等距破缺取本地/插入序靠前者（原版取低槽），全员死亡时保持 null
 *  （→ dropContext 回落房主 scene，魂/钥匙群系条件随房主位置翻转）。 */
export function pickClosestLootPlayer(
  players: readonly LootPlayerCtx[], cx: number, cy: number,
): LootPlayerCtx | null {
  let best: LootPlayerCtx | null = null;
  let bestD = -1;
  for (const c of players) {
    if (c.dead) continue;
    const d = Math.abs(c.x - cx) + Math.abs(c.y - cy);
    // 等距 → 低槽优先（原版按槽位升序遍历 + 严格 `<`，先到者不退让）
    if (bestD < 0 || d < bestD || (d === bestD && best !== null && c.slot < best.slot)) {
      bestD = d;
      best = c;
    }
  }
  if (best) return best;
  // 全员死亡：原版 result 仍停在首个 active 槽（Player.cs:4938-4946 只认 active）
  let first: LootPlayerCtx | null = null;
  for (const c of players) if (!first || c.slot < first.slot) first = c;
  return first;
}

export interface SkyblockCompensationInput {
  /** 原版 NPC.type（非 netID；负变体不进本表） */
  type: number;
  /** WorldGen.crimson（NPCLoot_DropAltar :80417-80428 二选一） */
  crimson: boolean;
  noAltars: boolean; noDungeon: boolean; noTemple: boolean; noHellforge: boolean;
  lowTiles: boolean;
}

export interface SkyblockCompensationResult {
  /** 待发放物品（原版 id + 堆叠数；调用方按 GetItemSource_Loot 盒中心锚生成） */
  drops: Array<{ id: number; n: number }>;
  /** 需清除的普查旗（= 原版 `WorldGen.Skyblock.noX = false`；245 **不含** noTemple） */
  clear: Array<'noAltars' | 'noDungeon' | 'noTemple' | 'noHellforge'>;
}

/** 缺结构世界 Boss 补偿表（1457 NPC.cs:79689-79706 分支 + :80375-80434 五实现）。
 *  调用方门谱（不在本函数内）：IsNPCValidForBestiaryKillCredit（:79689）、雕像产怪
 *  NPCLoot 头早退（:79648-79654）、netPuppet 不结算。
 *  逐条按原文：`Next(a,b)` = [a,b) 整数（上界开）。
 *  ★石巨人 245 的触发旗是 **lowTiles**（:79703），函数体 :80401-80406 **不写
 *  noTemple**——勿"多修"。该函数反编译有平铺痕迹：`Next(4)` 后嵌套三元实际可达域
 *  = 0→1149(长矛机关) / 非0→1146(飞镖机关)，1147/1148 两臂恒不可达；按原文执行，
 *  不据此推断"均匀四选"（issue 明示）。 */
export function rollSkyblockCompensation(
  s: SkyblockCompensationInput, rand: () => number = Math.random,
): SkyblockCompensationResult {
  const out: SkyblockCompensationResult = { drops: [], clear: [] };
  const next = (lo: number, hiEx: number): number => lo + Math.floor(rand() * Math.max(1, hiEx - lo));
  const drop = (id: number, n = 1): void => { out.drops.push({ id, n }); };
  // 克眼 4 + 无祭坛 → 便携祭坛（猩红 5533 / 腐化 5532），清 noAltars
  if (s.type === 4 && s.noAltars) {
    drop(s.crimson ? 5533 : 5532);
    out.clear.push('noAltars');
  }
  // 世吞 13/14/15 或 克脑 266 + 无地牢 → 砖 1 堆(×500-600) + 墙 3 堆(×400-500)，清 noDungeon
  if ((s.type === 13 || s.type === 14 || s.type === 15 || s.type === 266) && s.noDungeon) {
    switch (next(0, 3)) {
      case 0: drop(134, next(500, 601)); drop(5365, next(400, 501));
        drop(5367, next(400, 501)); drop(5366, next(400, 501)); break;
      case 1: drop(137, next(500, 601)); drop(5371, next(400, 501));
        drop(5373, next(400, 501)); drop(5372, next(400, 501)); break;
      default: drop(139, next(500, 601)); drop(5368, next(400, 501));
        drop(5370, next(400, 501)); drop(5369, next(400, 501)); break;
    }
    out.clear.push('noDungeon');
  }
  // 骷髅王 35 + 无地狱熔炉 → 221，清 noHellforge
  if (s.type === 35 && s.noHellforge) {
    drop(221);
    out.clear.push('noHellforge');
  }
  // 世花 262 + 无神庙 → 1294、1292、1101×500-600、5376×1200-1500，清 noTemple
  if (s.type === 262 && s.noTemple) {
    drop(1294); drop(1292);
    drop(1101, next(500, 601)); drop(5376, next(1200, 1501));
    out.clear.push('noTemple');
  }
  // 石巨人 245 + 低格世界（**不是 noTemple**）→ 机关材料×5-10；原文不清旗
  if (s.type === 245 && s.lowTiles) {
    drop(next(0, 4) === 0 ? 1149 : 1146, next(5, 11));
  }
  return out;
}

/** 条件求值补充上下文（玩家 zone/季节/风——Game 侧提供） */
export interface DropExtras {
  zoneHallow: boolean; zoneCorrupt: boolean; zoneCrimson: boolean;
  zoneJungle: boolean; zoneSnow: boolean; zoneDesert: boolean; zoneDungeon: boolean;
  /** 玩家 zoneBeach（SceneMetrics.zoneBeach：DesertKeyCondition 需 !zoneBeach，Conditions.cs:1096） */
  zoneBeach: boolean;
  bloodMoon: boolean; halloween: boolean; xmas: boolean; windy: boolean;
}

export interface NpcDropCtx {
  rng: RNG;
  /** 原版规则按 netID 索引；变体（-5 等负 id）有则先查，否则回退 type */
  netId: number;
  type: number;
  /** Main.expertMode（大师模式也算，Main.cs:2762） */
  isExpert: boolean;
  isMaster: boolean;
  hardMode: boolean;
  crimson: boolean;
  /** world.flags（downedEyeOfCthulhu/downed_134 等） */
  flags: Record<string, boolean>;
  /** 击杀位置 px */
  x: number; y: number;
  /** 层界 px / tile（灵魂/海盗地图等位置条件） */
  worldSurfaceTile: number; rockLayerTile: number; underworldTileY: number;
  maxTilesX: number; maxTilesY: number;
  lifeMax: number; friendly: boolean; boss: boolean; damage: number; value: number;
  /** 雕像产怪（SpawnedFromStatue）：NotFromStatue 类条件为 false */
  statueSpawned?: boolean;
  /** 玩家血蓝（心/星条件 statLife<statLifeMax2 等） */
  hp: number; hpMax: number; mana: number; manaMax: number;
  /** 玩家幸运（Player.luck，RecalculateLuck :28671；luck=0 时全链退化为 rand.Next 语义）。
   *  MP 掉落结算端（房主/SimHost）注入 closestPlayer 的 luck（Player.FindClosest
   *  选最近者,Player.cs:11666-11689；NpcDrops.ts:11-20 登记的单人近似由本表替代） */
  luck?: number;
  /** MP 掉落结算玩家表（结算端构造：Game = [本地+msg13/16 代理],SimHost = 在线端 ×
   *  enemy 交互集）。在场 = per-client 族语义启用（bossBag/masterAll 按原版
   *  CommonCode.cs:35-88 的 netMode==2 段求值,ResolvedDrop 带 scope）;
   *  缺席 = 单人语义（scope 不标,直接掉——今日行为零变化） */
  lootPlayers?: Array<{ slot: number; interacting: boolean }>;
  /** Main.CurrentFrameFlags.ActivePlayersCount（DropOneByOne 四塔碎片的每玩家堆叠
   *  加成,DropOneByOne.cs:63-64）；单人缺省 1 */
  activePlayers?: number;
  /** 月事件（南瓜月/霜月）上下文：kind 1=霜月 2=南瓜月；wave=当前波（无事件缺省 0）。
   *  四个 wave-gate 掉落条件的数据源（Conditions.cs:55-229），Game 击杀掉落处注入 */
  moonEvent?: { kind: 1 | 2; wave: number };
  /** NPC ai[3]（Enemy 注入；RedHatSkeletron / 光之女皇暴怒条件数据源） */
  ai3?: number;
  /** NPC ai[1]（Enemy 注入；史莱姆体内物品 id——SlimeBodyItemDropRule 数据源，
   *  NPC.cs:60750 主掷段首帧掷定：-1=掷过为空 / >0=物品 id / 0=未掷） */
  ai1?: number;
  /** NPC localAI[3]（引擎未承载，恒 undefined → 依赖它的分支恒 false） */
  localAi3?: number;
  /** NPC.HasPlayerTarget（NPC.cs:6603 = target∈[0,255)；TargetClosest 的 TryTrackingTarget
   *  无距离门，单人 = 玩家存活非 ghost）。五个悠悠球掉落条件的数据源（Conditions.cs:1136-1244），
   *  Enemy 击杀处注入 */
  hasPlayerTarget?: boolean;
  /** NPC.AnyNPCs(type)（Enemy 注入存活同型扫描；MissingTwin/MechdusaKill 条件数据源） */
  anyNpcOfType?: (type: number) => boolean;
  /** SpecialSeedFeatures.Mechdusa（SpecialSeedFeatures.cs:119-129 = remixWorld &&
   *  getGoodWorld——getfixedboi 是唯一双真种子；Enemy 注入 world.seedFlags 投影）。
   *  MechdusaKill 条件数据源（Conditions.cs:579-596） */
  mechdusaWorld?: boolean;
  /** WorldGen.Skyblock.noAltars（:3062/:3148/:3163-3166：读档全图普查 tile 26 恶魔
   *  祭坛，无一存活才 true——1.4.5 skyblock 世专属）；Enemy 注入 Game 侧缓存扫描。
   *  EyeOfCthulhuDefeatedAndNoAltarsInWorld 条件数据源（Conditions.cs:1422-1437） */
  noAltarsInWorld?: boolean;
  // ---- ★IIIII61 秘种子掉落条件数据源（Enemy 注入 world.seedFlags/SkyblockRuntime） ----
  /** Main.dontStarveWorld（"the constant"）；DontStarveIsUp/IsNotUp 条件
   *  （Conditions.cs:1484-1511——录音道具 5089-5097 族） */
  dontStarveWorld?: boolean;
  /** Main.remixWorld（remix 种子）；RemixSeed 四变体条件数据源（Conditions.cs:1282-1412，
   *  2026-09-03 R3-B2 接线）。缺省 false = 非 remix（旧调用方零变化） */
  remixWorld?: boolean;
  /** Main.tenthAnniversaryWorld（celebrationmk10）；TenthAnniversaryIsUp/IsNotUp 条件 */
  tenthAnniversaryWorld?: boolean;
  /** WorldGen.Skyblock.lowTiles（动态普查旗）；SkyblockIsUp 条件（Conditions.cs:1516-1532）
   *  ——僵尸族 189/435/188/434 掉 9 蜂蜜块（低格世界无蜂巢产蜜的补充面） */
  skyblockLowTiles?: boolean;
  /** 玩家背包/虚空袋含物品 1786（幸运马蹄铁? no——镰刀 Sickle：草籽割取工具）；
   *  SkyblockIsUpNoSickle 条件（Conditions.cs:1552-1566）：lowTiles 且【未持】时才掉 */
  playerHasSickle?: boolean;
  /** SpecialSeedFeatures.ShouldDropExtraGel（:5-13 = tenth && drunk && !remix && !ntb）；
   *  DropExtraGel/NotDropExtraGel 条件数据源（Conditions.cs:448/:466） */
  extraGelWorld?: boolean;
  /** 死亡 NPC 具名（TownNPC.givenName；NamedNPC 条件数据源——Conditions.cs:957-981
   *  `info.npc.HasGivenName && GivenName == Language[neededName]`，具名随机池抽中
   *  Andrew/Whitney/Jim 时该 NPC 死亡掉专属纪念品）。Enemy 无名 → undefined 恒 false */
  npcGivenName?: string;
  extras?: DropExtras;
}

export interface ResolvedDrop {
  id: number; n: number;
  /** per-client 族标记（仅 ctx.lootPlayers 在场=MP 结算端时设置）：
   *  'local'（DropLocalPerClientAndResetsNPCMoneyTo0,bossBag 族）= 求值端单掷已过,
   *    结算层对每个交互端各发一份 instanced 副本（msg90/module14 语义）；
   *  'perPlayer'（DropPerPlayerOnThePlayer,masterAll 族）= 已按玩家独立掷,
   *    slot=受奖玩家,结算层在其头顶落普通世界掉落（广播物品）。
   *  undefined = 单人语义/共享世界掉落（照常） */
  scope?: 'local' | 'perPlayer';
  /** scope='perPlayer' 时的受奖玩家槽位 */
  slot?: number;
}
export interface NpcDropOutcome {
  drops: ResolvedDrop[];
  /** 规则内 BossBag/local/perPlayer 清零 → 钱币管线跳过 */
  zeroValue: boolean;
}

/** NPCID.Sets.SlimeCanContainItems（NPCID.cs:4791）：可携带体内物品的史莱姆族 */
const SLIME_CAN_CONTAIN = new Set([1, 59, 147, 184, 537]);
type State = 'success' | 'failedRoll' | 'failedCond';

const warned = new Set<string>();
function warnOnce(key: string, msg: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[NpcDrops] ${msg}`);
}

// ============ 条件求值（Conditions.cs 1:1；未知 → false+warn） ============
function downed(ctx: NpcDropCtx, ...ids: number[]): boolean {
  return ids.every((id) => !!ctx.flags[`downed_${id}`]);
}
export function evalCond(name: string, args: unknown[], ctx: NpcDropCtx): boolean {
  const ex = ctx.extras;
  switch (name) {
    case 'NotExpert': return !ctx.isExpert;
    case 'IsExpert': return ctx.isExpert;
    // Conditions.cs:610-670（LegacyHack_IsBoss* = npc.boss && 档位）：
    // boss 位由 Enemy 死亡路径按 DropEoWLoot（NPC.cs:79212-79228）注入 ctx——
    // EoW 13/14/15 仅"场上再无同族"的最后一段为 true（宝袋/纪念章/宠物/魔矿
    // 20-60/面具/奖旗全挂此位），中间段恒 false 只出非门控小额
    case 'LegacyHack_IsBossAndExpert': return ctx.boss && ctx.isExpert;
    case 'LegacyHack_IsBossAndNotExpert': return ctx.boss && !ctx.isExpert;
    case 'LegacyHack_IsABoss': return ctx.boss;
    case 'Easymode': return !ctx.hardMode;
    case 'IsHardmode': return ctx.hardMode;
    // ---- remix 条件族（Conditions.cs:1282-1412 全六类 1:1；2026-09-03 红蓝对抗
    //  R3-B2 接线：曾以"remixWorld 恒 false"降级约定整体钉死,但 remix 种子已可产
    //  （WorldCreation 'Seed_Remix'）——remix+困难非专家杀猪鲨掉 BubbleGun 而非
    //  AquaScepter、袋 3330 remix 支死。ctx.remixWorld 缺省 false=旧调用方零变化）
    case 'NotRemixSeedHardmode': return !ctx.remixWorld && ctx.hardMode;   // :1396-1412
    case 'RemixSeedHardmode': return !!ctx.remixWorld && ctx.hardMode;     // :1344-1368
    case 'NotRemixSeedEasymode': return !ctx.remixWorld && !ctx.hardMode;  // :1370-1394
    case 'RemixSeedEasymode': return !!ctx.remixWorld && !ctx.hardMode;    // :1318-1342
    case 'RemixSeed': return !!ctx.remixWorld;                              // :1282-1295
    case 'NotRemixSeed': return !ctx.remixWorld;
    case 'NeverTrue': return false;
    case 'NotFromStatue': return !ctx.statueSpawned; // Conditions.NotFromStatue
    // ★三百零八:mod loot flag 门(world.flags 直查;downed_x 族)
    case 'WorldFlag': return !!(ctx.flags?.[String(args[0])]);
    case 'IsBloodMoonAndNotFromStatue': return !!ex?.bloodMoon && !ctx.statueSpawned;
    case 'IsCrimsonAndNotExpert': return ctx.crimson && !ctx.isExpert;
    case 'IsCorruptionAndNotExpert': return !ctx.crimson && !ctx.isExpert;
    case 'IsChristmas': return !!ex?.xmas;
    case 'HalloweenWeapons': return !!ex?.halloween;
    case 'HalloweenGoodieBagDrop': case 'XmasPresentDrop': {
      // Conditions.cs:891-934：季节门之外还有 NPC 门——lifeMax>1 && damage>0 && !friendly
      // && type∉{121 墓穴爬虫,23 诅咒骷髅头} && value>0（曾只看季节，雕像怪 0 value 也会掉袋）
      const seasonal = name === 'HalloweenGoodieBagDrop' ? !!ex?.halloween : !!ex?.xmas;
      return seasonal && ctx.lifeMax > 1 && ctx.damage > 0 && !ctx.friendly
        && ctx.type !== 121 && ctx.type !== 23 && ctx.value > 0;
    }
    // ★IIIII61：Main.dontStarveWorld / Main.tenthAnniversaryWorld 直投（seedFlags 投影）
    case 'DontStarveIsUp': return !!ctx.dontStarveWorld;
    case 'TenthAnniversaryIsUp': return !!ctx.tenthAnniversaryWorld;
    case 'DontStarveIsNotUp': return !ctx.dontStarveWorld;
    case 'TenthAnniversaryIsNotUp': return !ctx.tenthAnniversaryWorld;
    case 'DownedPlantera': return downed(ctx, 262);
    case 'FirstTimeKillingPlantera': return !downed(ctx, 262); // 掉落先于 downed 写入 → 首杀语义
    case 'DownedAllMechBosses': return downed(ctx, 134, 125, 127);
    case 'BeatAnyMechBoss': return downed(ctx, 134) || downed(ctx, 125) || downed(ctx, 127);
    case 'MechdusaKill':
      // Conditions.cs:579-596（ Mechdusa 秘密种子世界 + 三机械王 AnyNPCs 扫描）：
      // !SpecialSeedFeatures.Mechdusa → false；目标集 {127 毁灭者,126 双子一眼,
      // 125 双子另眼,134 Prime} 中【其它仍存活】任一在场 → false——即同场三王
      // 全灭时最后倒下那只掉 5382（Mekdusa 召唤链前置物品）。掉落规则注册于
      // 127/134/126+125（ItemDropDatabase.cs:441/:454/:469）
      if (!ctx.mechdusaWorld) return false;
      for (const t of MECHDUSA_TARGETS) {
        if (t !== ctx.type && ctx.anyNpcOfType?.(t)) return false;
      }
      return true;
    case 'FromCertainWaveAndAbove': {
      // Conditions.cs:249-261：NPC.waveNumber >= neededWave（不查事件——无事件时
      // waveNumber=0 恒不满足；注册仅在冰女王专属掉落 1914 上，neededWave=15）
      return (ctx.moonEvent?.wave ?? 0) >= Number(args[0] ?? 0);
    }
    case 'PumpkinMoonDropGatingChance': case 'FrostMoonDropGatingChance': {
      // 稀有掉落总门（Conditions.cs:55-121）：霜月基数 28 / 南瓜月 24；
      // 专家 wave+5；denom = ⌊(base-wave)/2.5⌋，专家再 -2(霜)/-1(南瓜)；下限 1；
      // RollLuck(denom)==0 才放行（luck=0 ≡ rng.Next(denom)==0）
      const me = ctx.moonEvent;
      const frost = name === 'FrostMoonDropGatingChance';
      if (!me || me.kind !== (frost ? 1 : 2)) return false;
      let wave = me.wave;
      if (ctx.isExpert) wave += 5;
      let denom = Math.trunc(((frost ? 28 : 24) - wave) / 2.5);
      if (ctx.isExpert) denom -= frost ? 2 : 1;
      if (denom < 1) denom = 1;
      return rollLuck(ctx, denom, 1);
    }
    case 'PumpkinMoonDropGateForTrophies': case 'FrostMoonDropGateForTrophies': {
      // 纪念碑门（Conditions.cs:123-229）：wave≥15；denom = 4(15/16)/3(17/18)/2(19/20+)，
      // 专家 1/3 概率再 -1；info.rng.Next(denom)==0
      const me = ctx.moonEvent;
      const frost = name === 'FrostMoonDropGateForTrophies';
      if (!me || me.kind !== (frost ? 1 : 2) || me.wave < 15) return false;
      let denom = me.wave >= 19 ? 2 : me.wave >= 17 ? 3 : 4;
      if (ctx.isExpert && ctx.rng.int(0, 2) === 0) denom--;
      return ctx.rng.int(0, Math.max(1, denom) - 1) === 0;
    }
    case 'EmpressOfLightIsGenuinelyEnraged':
      // Conditions.cs:525 → NPC.cs AI_120_HallowBoss_IsGenuinelyEnraged(:46169)：
      // ai[3]∈{2,3}（白天暴怒/二阶段白天）。白天 ai3=2 已实装（bossAI_lategame
      // 白天满血 ai3+=2 段）——运行时真通,Terraprisma(5005) 白天击杀链生效
      // （曾注"恒 false"为陈旧描述,2026-08-19 终审更正）
      return ctx.type === 636 && (ctx.ai3 === 2 || ctx.ai3 === 3);
    case 'MissingTwin':
      // Conditions.cs:502：另一只眼（125↔126）不在场才放行——先死者不掉（NPC.AnyNPCs）
      return !!ctx.anyNpcOfType && !ctx.anyNpcOfType(ctx.type === 125 ? 126 : 125);
    case 'RedHatSkeletron':
      // Conditions.cs:543 → NPC.cs RedHatSkeletronAdjustmentsEnabled(:67282)：
      // 35/33 看 ai[3]==1（持有裁缝巫毒娃娃击杀裁缝召出的红帽骷髅王，NPC.cs:81203-81264），
      // 36/32 看 localAI[3]==1（引擎未承载 localAI[3] → 恒 false，均为不可达内容）
      return (ctx.type === 35 || ctx.type === 33) ? ctx.ai3 === 1
        : (ctx.type === 36 || ctx.type === 32) ? ctx.localAi3 === 1 : false;
    // ★IIIII61：低格世界动态普查旗——僵尸族 189/435/188/434 的蜂蜜块 9 补给
    case 'SkyblockIsUp': return !!ctx.skyblockLowTiles;
    case 'SkyblockIsUpNoSickle':
      // Conditions.cs:1552-1566：lowTiles 且玩家背包/虚空袋【无】1786 镰刀
      return !!ctx.skyblockLowTiles && !ctx.playerHasSickle;
    case 'WindyEnoughForKiteDrops':
      // ★issue#46 N11：1457 Conditions.cs:1246-1252 直接读 `Main.WindyEnoughForKiteDrops`
      // =|windSpeedTarget| >= _maxWind(0.4)（Main.cs:3003/:67637）——数据源 = Game.dropContext
      // 的 ex.windy（本轮改 target/0.4，旧实现 current/>0.5 两向偏差）
      return !!ex?.windy;
    case 'EyeOfCthulhuDefeatedAndNoAltarsInWorld':
      // Conditions.cs:1422-1437：NPC.downedBoss1 && WorldGen.Skyblock.noAltars——
      // skyblock 世界的坠星补给（僵尸族 2/317/318/190-194/133 掉 43 坠星 1/50，
      // ItemDropDatabase.cs:1086-1088）。downedBoss1 = EoC（world.flags.downed_4，
      // 与 Game.shopCondOk 同口径含 downedEyeOfCthulhu 旧键）；noAltars = 读档普查
      // 无恶魔祭坛（ctx.noAltarsInWorld，Enemy 注入）。
      // ★issue#46 N16 清偿（原"未接重置支"登记）：EoC 击杀掉落便携祭坛并清
      // noAltars 的分支已接——1457 实锚 NPC.cs:79691-79694 分支体 +
      // :80417-80428 NPCLoot_DropAltar；本仓落点 Game.skyblockBossCompensation
      // （onEnemyKilled 死亡结算口），清旗同步运行时普查旗 + World 投影。
      return !!(ctx.flags['downed_4'] || ctx.flags.downedEyeOfCthulhu) && !!ctx.noAltarsInWorld;
    case 'NamedNPC': {
      // Conditions.cs:957-981：info.npc.HasGivenName && GivenName ==
      // Language.GetTextValue(neededName)——【NPC 自身的随机具名】命中参数名才掉
      // （Andrew=Redigit：向导掉绿帽 867 / Whitney：蒸汽朋克掉 4372 / Jim：画家掉
      // 5290，ItemDropDatabase.cs:733-735）。提取器把 "GuideNames.Andrew" 键剥成
      // "Andrew"（tools/extract-npcdrops.mjs condArg），此处按 NPC 类目拼回全键取
      // 本地化名比对（zh 名池亦本地化——直比英文恒不中）
      if (!ctx.npcGivenName) return false;
      const key = NAMED_NPC_KEYS[String(args[0] ?? '')];
      return key !== undefined && ctx.npcGivenName === Lang.text(key);
    }
    case 'LivingFlames':
      // ★issue#46 N12：1457 Conditions.cs:935-944 —— lifeMax>5 && value>0 && !friendly
      // && hardMode && `npc.position.Y / 16f > Main.UnderworldLayer`（**严格 >**；
      // UnderworldLayer = maxTilesY-200,Main.cs:2886）+ !IsInSimulation（仅图鉴模拟
      // 恒 false）。判据本身 1:1；缺陷在数据源——调用方曾把 UnderworldLayer 填成
      // GenVars.lavaLine（≈h-340±，见 World.lavaLine 注）。现应取 World.underworldLine。
      return ctx.lifeMax > 5 && ctx.value > 0 && !ctx.friendly && ctx.hardMode
        && ctx.y / 16 > ctx.underworldTileY;
    case 'SoulOfLight': case 'SoulOfNight': {
      // SoulOfWhateverConditionCanDrop(Conditions.cs:1574)：hardMode && lifeMax>1 &&
      // !friendly && !boss && y>rockLayer && value>=1；先拒 NPCID.Sets.DontDropDungeonKeysOrSouls
      // （= {23} 诅咒骷髅头，NPCID.cs:4438）再排除 switch 黑名单 {1,13,14,15,121,535}
      // ★issue#46 N17：zone 族（本条件 + 钥匙/悠悠球/DesertKey）在原版读
      // `info.player.Zone*`（Conditions.cs:827-861）——player = 掉落结算的最近玩家
      // （NPCLoot closestPlayer），非房主。extras 由 Game.dropContext(最近玩家) 供。
      if (ctx.type === 23) return false;
      if (!ctx.hardMode || ctx.lifeMax <= 1 || ctx.friendly || ctx.boss || ctx.value < 1) return false;
      if (ctx.y / 16 <= ctx.rockLayerTile) return false;
      if ([1, 13, 14, 15, 121, 535].includes(ctx.type)) return false;
      return name === 'SoulOfLight' ? !!ex?.zoneHallow
        : !!(ex?.zoneCorrupt || ex?.zoneCrimson);
    }
    case 'PirateMap':
      // Conditions.cs:391 value>0 && hardMode && y<worldSurface+10 && 近海（x<380 或 >maxTilesX-380）
      return ctx.value > 0 && ctx.hardMode && ctx.y / 16 < ctx.worldSurfaceTile + 10
        && (ctx.x / 16 < 380 || ctx.x / 16 > ctx.maxTilesX - 380);
    case 'JungleKeyCondition': case 'CorruptKeyCondition': case 'CrimsonKeyCondition':
    case 'HallowKeyCondition': case 'FrozenKeyCondition': case 'DesertKeyCondition': {
      // Conditions.cs:986-1120：value>0 && !DontDropDungeonKeysOrSouls（={23}，NPCID.cs:4438）
      // && hardMode && 玩家在对应 zone（Desert 还需非海滩）
      if (ctx.value <= 0 || !ctx.hardMode || ctx.type === 23) return false;
      switch (name) {
        case 'JungleKeyCondition': return !!ex?.zoneJungle;
        case 'HallowKeyCondition': return !!ex?.zoneHallow;
        case 'CorruptKeyCondition': return !!ex?.zoneCorrupt;
        case 'CrimsonKeyCondition': return !!ex?.zoneCrimson;
        case 'FrozenKeyCondition': return !!ex?.zoneSnow;
        case 'DesertKeyCondition': return !!ex?.zoneDesert && !ex?.zoneBeach;
      }
      return false;
    }
    // 五个悠悠球条件（Conditions.cs:1136-1244）共用谓词：HasPlayerTarget + lifeMax>5 +
    // !friendly + value>0（曾漏 HasPlayerTarget——NPC.cs:6603，Enemy 注入 ctx.hasPlayerTarget）
    case 'YoyoCascade': // !hardMode && y>maxTilesY-350 && downedBoss3
      return !ctx.hardMode && !!ctx.hasPlayerTarget && ctx.lifeMax > 5 && !ctx.friendly && ctx.value > 0
        && ctx.y / 16 > ctx.maxTilesY - 350 && downed(ctx, 35);
    case 'YoyosAmarok': // hardMode && ZoneSnow
      return ctx.hardMode && !!ex?.zoneSnow && !!ctx.hasPlayerTarget
        && ctx.lifeMax > 5 && !ctx.friendly && ctx.value > 0;
    case 'YoyosYelets': // hardMode && ZoneJungle && downedMechAny
      return ctx.hardMode && !!ex?.zoneJungle && (downed(ctx, 134) || downed(ctx, 125) || downed(ctx, 127))
        && !!ctx.hasPlayerTarget && ctx.lifeMax > 5 && !ctx.friendly && ctx.value > 0;
    case 'YoyosKraken': // hardMode && ZoneDungeon && downedPlantera
      return ctx.hardMode && !!ex?.zoneDungeon && downed(ctx, 262)
        && !!ctx.hasPlayerTarget && ctx.lifeMax > 5 && !ctx.friendly && ctx.value > 0;
    case 'YoyosHelFire': // hardMode && !ZoneDungeon && y>(rockLayer+maxTilesY*2)/3
      return ctx.hardMode && !ex?.zoneDungeon
        && ctx.y / 16 > (ctx.rockLayerTile + ctx.maxTilesY * 2) / 3
        && !!ctx.hasPlayerTarget && ctx.lifeMax > 5 && !ctx.friendly && ctx.value > 0;
    // —— 以下条件在当前 JSON 未出现（提取器按注册表收敛），但 Conditions.cs 有定义、
    //    语义可精确实现：先补齐避免未来重建后落 default 假绿 ——
    case 'NotMasterMode': return !ctx.isMaster;            // Conditions.cs:484
    case 'IsMasterMode': return ctx.isMaster;              // Conditions.cs:694
    case 'IsCrimson': return ctx.crimson;                  // Conditions.cs:712（WorldGen.crimson）
    case 'IsCorruption': return !ctx.crimson;              // Conditions.cs:730
    case 'MechanicalBossesDummyCondition': return true;    // Conditions.cs:372
    case 'PlayerNeedsHealing': return ctx.hp < ctx.hpMax;  // Conditions.cs:561
    case 'IsPumpkinMoon': return ctx.moonEvent?.kind === 2; // Conditions.cs:231
    case 'SkyblockIsNotUp': return !ctx.skyblockLowTiles;  // Conditions.cs:1534-1550
    // ★IIIII61：SpecialSeedFeatures.ShouldDropExtraGel（SpecialSeedFeatures.cs:5-13 =
    //  tenthAnniversary && drunkWorld && !remixWorld && !notTheBeesWorld——生日庆祝
    //  世界史莱姆凝胶增益档）
    case 'DropExtraGel': return !!ctx.extraGelWorld;
    case 'NotDropExtraGel': return !ctx.extraGelWorld;
    // 备案（无法精确实现，当前 JSON 也未用到）：IsUsingSpecificAIValues(Conditions.cs:27)
    // 需按槽位比对 ai[0..3]——ctx 仅承载 ai3，若未来注册表引用需先扩 ctx
    default:
      warnOnce(`cond:${name}`, `未知掉落条件 ${name}（按 false 处理）`);
      return false;
  }
}

// ============ 规则求值（ItemDropResolver.cs 语义） ============
/** Player.RollLuck(denom, luck=0) ≡ rng.Next(denom) */
function rollLuck(ctx: NpcDropCtx, denom: number, num: number): boolean {
  if (denom <= 1) return true;
  const luck = ctx.luck ?? 0;
  if (luck !== 0 && ctx.rng.next() < Math.abs(luck)) {
    // Luck.RollLuck（Luck.cs:6）：幸运 → 先掷 [denom/2, denom) 再掷（<num 更易命中）；
    // 负幸运反向 → [denom, denom*2) 更难命中
    const inner = luck > 0
      ? ctx.rng.int(Math.floor(denom / 2), denom - 1)
      : ctx.rng.int(denom, denom * 2 - 1);
    return ctx.rng.int(0, Math.max(1, inner) - 1) < num;
  }
  return ctx.rng.int(0, denom - 1) < num;
}

/** 规则掷骰统一入口：JSON 的 noLuck 标记（NotScalingWithLuck 族）此前被忽略——
 *  CommonDropNotScalingWithLuck.cs:17 / OneFromOptionsNotScaledWithLuckDropRule.cs:115
 *  用 info.rng.Next(denom)<num（不进 Luck.RollLuck），必须走直掷而非 rollLuck，
 *  否则幸运玩家在这些规则上白吃加成（如 EoC 专家 Ore 池 NormalvsExpert…NotScalingWithLuck）。
 *  denom<=1 直接过与 rollLuck 同约定（结果恒真，仅差一次空抽） */
function tryRoll(ctx: NpcDropCtx, rule: Rule): boolean {
  const denom = rule.denom ?? 1;
  const num = rule.num ?? 1;
  if (rule.noLuck) {
    if (denom <= 1) return true;
    return ctx.rng.int(0, denom - 1) < num;
  }
  // R14-A1：CommonDropScalingWithOnlyBadLuck（CommonDropScalingWithOnlyBadLuck.cs:21-35
  // → Luck.RollOnlyBadLuck LUK57:31-36）——仅 luck<0 时掷 NextFloat()<-luck 进内掷
  // Next(Next(denom/2,denom))（更易中）；luck>=0 就是裸 Next(denom)（正运无加成）。
  // 曾记成普通 common → 幸运玩家白吃加成/负运玩家反被惩罚（双向都反）
  if ((rule as { onlyBadLuck?: number }).onlyBadLuck) {
    if (denom <= 1) return true;
    if ((ctx.luck ?? 0) < 0 && ctx.rng.next() < -(ctx.luck ?? 0)) {
      return ctx.rng.int(0, Math.floor(ctx.rng.int(Math.floor(denom / 2), denom - 1))) < num;
    }
    return ctx.rng.int(0, denom - 1) < num;
  }
  return rollLuck(ctx, denom, num);
}

function pushDrop(out: NpcDropOutcome, id: number, n: number, scope?: 'local' | 'perPlayer', slot?: number) {
  if (n > 0) out.drops.push(scope ? { id, n, scope, slot } : { id, n });
}

/** DropPerPlayerOnThePlayer 的逐玩家独立掷（CommonCode.cs:70 `rng.Next(denom)<num`，
 *  不走 Luck）；denom=1 时 Next(1)=0<1 恒中（与 VanillaDrop 求值语义一致） */
function rollPerPlayer(ctx: NpcDropCtx, denom: number, num: number): boolean {
  return ctx.rng.int(0, Math.max(1, denom) - 1) < num;
}

function condPass(rule: Rule, ctx: NpcDropCtx): boolean | null {
  if (!rule.cond) return true;
  const pass = evalCond(rule.cond.name, rule.cond.args ?? [], ctx);
  return pass;
}

function evalRule(rule: Rule, ctx: NpcDropCtx, out: NpcDropOutcome): State {
  let state: State;
  switch (rule.k) {
    case 'common': {
      if (tryRoll(ctx, rule)) {
        pushDrop(out, rule.item, ctx.rng.int(rule.min ?? 1, rule.max ?? 1));
        state = 'success';
      } else state = 'failedRoll';
      break;
    }
    case 'rerolls': {
      // CommonDropWithRerolls：rerolls+1 次掷骰任一成功（继承 RollLuck，无 noLuck 变体）
      let hit = false;
      for (let i = 0; i <= (rule.rerolls ?? 0); i++) hit = hit || rollLuck(ctx, rule.denom ?? 1, rule.num ?? 1);
      if (hit) { pushDrop(out, rule.item, ctx.rng.int(rule.min ?? 1, rule.max ?? 1)); state = 'success'; }
      else state = 'failedRoll';
      break;
    }
    case 'cond': {
      // ItemDropWithConditionRule：条件不过 = DoesntFillConditions（failedRoll 链不进）
      if (!condPass(rule, ctx)) { state = 'failedCond'; break; }
      if (rollLuck(ctx, rule.denom ?? 1, rule.num ?? 1)) {
        pushDrop(out, rule.item, ctx.rng.int(rule.min ?? 1, rule.max ?? 1));
        state = 'success';
      } else state = 'failedRoll';
      break;
    }
    case 'oneOf': {
      // OneFromOptionsDropRule：过掷后等权取一。提取器保证 ids 非空（空池会带
      // _unresolved 备案），防御性兜底防 ids.length-1 为负
      if (!rule.ids?.length) {
        if (rule._unresolved) warnOnce(`unresolved:${rule._unresolved}`, `oneOf 池未解析：${rule._unresolved}（跳过）`);
        state = 'failedRoll';
        break;
      }
      if (tryRoll(ctx, rule)) {
        pushDrop(out, rule.ids[ctx.rng.int(0, rule.ids.length - 1)], 1);
        state = 'success';
      } else state = 'failedRoll';
      break;
    }
    case 'expert': { // DropBasedOnExpertMode：normal/expert 二选一委托
      state = evalRule(ctx.isExpert ? rule.expert : rule.normal, ctx, out);
      break;
    }
    case 'master': { // DropBasedOnMasterMode
      state = evalRule(ctx.isMaster ? rule.master : rule.def, ctx, out);
      break;
    }
    case 'masterExpert': { // DropBasedOnMasterAndExpertMode：master>expert>def
      state = evalRule(ctx.isMaster ? rule.master : ctx.isExpert ? rule.expert : rule.def, ctx, out);
      break;
    }
    case 'bossBag': {
      // BossBag = DropBasedOnExpertMode(DropNothing, DropLocalPerClientAndResetsNPCMoneyTo0(bag)+value=0)；
      // DropNothing 状态 = DoesntFillConditions（非专家分支不进 OnSuccess 链）
      if (rule.cond && !evalCond(rule.cond.name, rule.cond.args ?? [], ctx)) { state = 'failedCond'; break; }
      if (ctx.isExpert) {
        // local 规则 rng.Next(1)<1 恒过 → 掉袋 + 清 value。
        // MP：结算端标记 scope='local'——各交互端各得一份 instanced 副本
        // （CommonCode.cs:35-58 netMode==2 段,原版掷骰单次所有端同结果）
        pushDrop(out, rule.item, 1, ctx.lootPlayers ? 'local' : undefined);
        out.zeroValue = true;
        state = 'success';
      } else state = 'failedCond';
      break;
    }
    case 'masterCommon': { // ByCondition(IsMasterMode, item)（非 master = DoesntFillConditions）
      if (ctx.isMaster) { pushDrop(out, rule.item, 1); state = 'success'; }
      else state = 'failedCond';
      break;
    }
    case 'masterAll': { // DropBasedOnMasterMode(DropNothing, DropPerPlayerOnThePlayer(item, denom, IsMasterMode))
      if (ctx.isMaster) {
        // DropPerPlayerOnThePlayer → CommonCode.DropItemForEachInteractingPlayerOnThePlayer
        // （CommonCode.cs:60-88）：服务器段=逐交互玩家独立掷 rng.Next(denom)<1（不走 Luck,
        // 同一 rng 流按槽序）；单人段=单掷。无论掷中与否收尾 `npc.value = 0f`——即
        // 大师模式 Boss 掉宠物/遗物这条恒清钱币（曾漏：宠物+钱币双掉）
        out.zeroValue = true;
        if (ctx.lootPlayers) {
          for (const pl of [...ctx.lootPlayers].sort((a, b) => a.slot - b.slot)) {
            if (!pl.interacting) continue;      // npc.playerInteraction[slot]（:71）
            if (rollPerPlayer(ctx, rule.denom ?? 1, 1)) pushDrop(out, rule.item, 1, 'perPlayer', pl.slot);
          }
        } else if (rollPerPlayer(ctx, rule.denom ?? 1, 1)) {
          pushDrop(out, rule.item, 1);
        }
        state = 'success';
      } else state = 'failedCond';
      break;
    }
    case 'local': case 'perPlayer': {
      // 直接注册的 DropLocalPerClient/DropPerPlayerOnThePlayer（1.4.5.6 注册表为空——
      // 两族全部经由 BossBag/masterAll 包装注册,提取器保留 kind 供重建后命中）：
      // 'local'=单掷+逐交互端 instanced 副本 + value 清零（仅掷中时,CommonCode.cs:46-58）；
      // 'perPlayer'=逐玩家独立掷 + 落该玩家 + value 恒清（:60-88）
      if (rule.cond && !evalCond(rule.cond.name, rule.cond.args ?? [], ctx)) { state = 'failedCond'; break; }
      if (rule.k === 'local') {
        if (ctx.rng.int(0, Math.max(1, rule.denom ?? 1) - 1) < 1) {
          pushDrop(out, rule.item, ctx.rng.int(rule.min ?? 1, rule.max ?? 1), ctx.lootPlayers ? 'local' : undefined);
          out.zeroValue = true;
          state = 'success';
        } else state = 'failedRoll';
      } else {
        out.zeroValue = true;
        if (ctx.lootPlayers) {
          for (const pl of [...ctx.lootPlayers].sort((a, b) => a.slot - b.slot)) {
            if (!pl.interacting) continue;
            if (rollPerPlayer(ctx, rule.denom ?? 1, 1)) {
              pushDrop(out, rule.item, ctx.rng.int(rule.min ?? 1, rule.max ?? 1), 'perPlayer', pl.slot);
            }
          }
          state = 'success';
        } else if (rollPerPlayer(ctx, rule.denom ?? 1, 1)) {
          pushDrop(out, rule.item, ctx.rng.int(rule.min ?? 1, rule.max ?? 1));
          state = 'success';
        } else state = 'failedRoll';
      }
      break;
    }
    case 'gate': {
      // LeadingConditionRule：CanDrop=cond、DropAttempt 恒 success → 放行 OnSuccess 链
      state = condPass(rule, ctx) ? 'success' : 'failedCond';
      break;
    }
    case 'nothing': state = 'failedCond'; break; // DropNothing 状态 = DoesntFillConditions
    case 'mechSpawn': {
      // MechBossSpawnersDropRule：value>0 && hardMode && 未三王齐灭 → 各 1/2500
      const can = ctx.value > 0 && ctx.hardMode && !downed(ctx, 134, 125, 127);
      if (!can) { state = 'failedCond'; break; }
      if (!downed(ctx, 134) && rollLuck(ctx, 2500, 1)) { pushDrop(out, 556, 1); state = 'success'; break; }
      if (!downed(ctx, 125) && rollLuck(ctx, 2500, 1)) { pushDrop(out, 544, 1); state = 'success'; break; }
      if (!downed(ctx, 127) && rollLuck(ctx, 2500, 1)) { pushDrop(out, 557, 1); state = 'success'; break; }
      state = 'failedRoll';
      break;
    }
    case 'slimeBody': {
      // SlimeBodyItemDropRule.cs:14-18 CanDrop = SlimeCanContainItems[type] && ai[1]>0
      //   && ai[1]<ItemID.Count(=6147)；TryDroppingItem(:26-30) = GetDropInfo 档位掷
      //   Next(min, max+1)。规则注册为 global（ItemDropDatabase.cs:684）。
      // ★类型门必须在此本判（NPCID.cs:4791 SlimeCanContainItems = {1,59,147,184,537}）：
      //   曾把类型门外包给"只有史莱姆掷 ai1"——但 ai[1] 是全族共享计时器（兔子行走
      //   计时 120-898/战士计数/蝙蝠计时都用它），任何怪死时 ai1 恰落 1..6146 都会被
      //   当成"体内物品 id"掉出来 = 兔子掉珍珠石砖(ai1=412)根因（2026-08-19 用户实报）
      if (!SLIME_CAN_CONTAIN.has(ctx.type)) { state = 'failedCond'; break; }
      const itemId = Math.floor(ctx.ai1 ?? 0);
      if (itemId <= 0 || itemId >= 6147) { state = 'failedCond'; break; }
      const [mn, mx] = SLIME_BODY[String(itemId)] ?? [1, 1];
      pushDrop(out, itemId, ctx.rng.int(mn, mx));      // Next(mn, mx+1) ≡ rng.int 闭区间 [mn,mx]
      state = 'success';
      break;
    }
    case 'statueMimic': {
      // StatueMimicItemDropRule.cs（1458 同名文件）1:1——R25-A10 接通：
      // CanDrop(:15-22) = ai[1]>0 && ai[1]<ItemID.Count(=6147)；
      // TryDroppingItem(:29-37) = WorldGen.StatueStyleToItem((int)ai[1]) →
      // CommonCode.DropItemFromNPC(npc, itemId, 1)。注册仅 690
      // （ItemDropDatabase.cs:1134 RegisterToNPC(690,…)），故无需类型门。
      // 墓地自然刷（NPC.cs:1571 SpawnNPC(…,690)）不置 SpawnedFromStatue（仅
      // Wiring.cs:2480 雕像通电置位），且 690 不在 StatueSpawnedDropRarity
      // （NPCID.cs:4799 缺省 -1）/NoEarlymodeLootWhenSpawnedFromStatue
      // （:4801={480,82,86,170,180,171}）两限制集 → 原版掉落无雕像减损。
      // 映射表复用 vanillaStyleDrops.STATUES（StatueStyleToItem 全量转录，83 档）
      const style = Math.floor(ctx.ai1 ?? 0);
      if (style <= 0 || style >= 6147) { state = 'failedCond'; break; }
      pushDrop(out, STATUES[style] ?? STATUES[0], 1);   // 表外 style 回落 default 档=style0（本表口径）
      state = 'success';
      break;
    }
    case 'dropOneByOne': {
      // DropOneByOne（DropOneByOne.cs TryDroppingItem 1:1）。注册仅四塔碎片
      // （ItemDropDatabase.cs RegisterBoss_LunarTowers :610-629），参数 json 未数值化、
      // 按 :611-627 硬编码：普通 12-20 块 × 每块 1-3；专家块数同、每块基数 ×1.5
      // （min=(int)1.5=1 / max=(int)4.5=4）+ 每活跃玩家 +1/块。
      // ChanceNumerator/Denominator=1 → RollLuck(1) 恒过
      {
        const expert = ctx.isExpert;
        const chunks = ctx.rng.int(12, 20);                    // Next(12, 21)
        // Main.CurrentFrameFlags.ActivePlayersCount（:63-64 每活跃玩家 +1/块——
        // MP 结算端注入表长;单人缺省 1）
        const players = Math.max(1, ctx.activePlayers ?? 1);
        const minStack = (expert ? 1 : 1) + players * (expert ? 1 : 0);
        const maxStack = (expert ? 4 : 3) + players * (expert ? 1 : 0);
        for (let i = 0; i < chunks; i++) {
          pushDrop(out, rule.item, ctx.rng.int(minStack, maxStack));
        }
        state = 'success';
      }
      break;
    }
    case 'oneOfRules': { // OneFromRulesRule：rng.Next(denom) 过后等权取一，
      // 被选中的 option 走完整子求值（含其自身链）；规则状态恒以掷骰为准
      // （OneFromRulesRule.cs TryDroppingItem(info, resolveAction)）
      if (rollLuck(ctx, rule.denom ?? 1, 1)) {
        evalRule(rule.rules[ctx.rng.int(0, rule.rules.length - 1)], ctx, out);
        state = 'success';
      } else state = 'failedRoll';
      break;
    }
    case 'listRef': { // List<IItemDropRule>{…}（OneFromRulesRule 参数）
      state = 'success';
      break;
    }
    case 'noRepeat': { // FromOptionsWithoutRepeatsDropRule.cs:27-45：
      // CanDrop 恒 true；dropCount 次不放回抽样（每件 rng.Next(len) 取一后移除），
      // 每件数量恒 1；规则状态恒 Success（无掷骰）
      {
        const pool = [...(rule.ids as number[])];
        for (let i = 0; i < (rule.count ?? 0); i++) {
          if (pool.length <= 0) break;
          const idx = ctx.rng.int(0, pool.length - 1);
          pushDrop(out, pool[idx], 1);
          pool.splice(idx, 1);
        }
        state = 'success';
      }
      break;
    }
    default:
      // 未知 kind：按 DoesntFillConditions 处理（曾返回 success——会让挂在它身上的
      // OnSuccess 链整支误触发；failedCond 则三条链全部不进，语义最保守）
      warnOnce(`rule:${rule.k}`, `未实现的规则 kind ${rule.k}（按 failedCond 跳过）`);
      state = 'failedCond';
      break;
  }
  // 链：按父状态门控（Chains.cs TryIfSucceeded/TryIfFailedRandomRoll/TryIfDoesntFillConditions）
  for (const c of rule.chain ?? []) {
    if ((c.on === 'success' && state === 'success')
      || (c.on === 'failedRoll' && state === 'failedRoll')
      || (c.on === 'failedConditions' && state === 'failedCond')) {
      evalRule(c.rule, ctx, out);
    }
  }
  return state;
}

/**
 * 规则掉落主入口（ItemDropSolver.TryDropping 语义）：
 * 全局规则 + 该 netID（回退 type）规则按注册序独立求值。
 */
export function resolveDrops(ctx: NpcDropCtx): NpcDropOutcome {
  const out: NpcDropOutcome = { drops: [], zeroValue: false };
  const rules = [
    ...globalRules,
    ...(rulesByNpc.get(ctx.netId) ?? rulesByNpc.get(ctx.type) ?? []),
  ];
  for (const r of rules) evalRule(r, ctx, out);
  return out;
}

/** ★Mod NPC 掉落注册面(2026-10-04):构造原版 Rule 形追加进 rulesByNpc——与提取器
 *  规则同池同语义(evalRule 求值器零改)。mod 侧只用 {k:'common', item, min, max,
 *  denom, num, noLuck:true}(确定性掷,不吃幸运——mod 掉落率跨世界恒定)。
 *  item 域=物品 stable id(mod 物品传 30000+ 段 id,与 drop 面其他消费方同域)。 */
export function registerModNpcRules(npcId: number, rules: Array<Record<string, unknown>>): void {
  if (npcId < 800) throw new Error(`[mod-drops] npcId 须 ≥800(mod 段): ${npcId}`);
  let l = rulesByNpc.get(npcId);
  if (!l) rulesByNpc.set(npcId, l = [] as Rule[]);
  for (const r of rules) l.push(r as Rule);
}

/** ★D11-M2(2026-10-14):mod 掉落规则 teardown(热重载;旧=push 累积 N 倍掉落) */
export function _resetModNpcRulesForTests(): void {
  for (const k of [...rulesByNpc.keys()]) if (k >= 800) rulesByNpc.delete(k);
}

// ============ 钱币管线（NPCLoot_DropMoney :80412 1:1） ============
export function rollCoins(value: number, ctx: NpcDropCtx, bloodMoon: boolean, midas = false,
  extraValue = 0): ResolvedDrop[] {
  // :80414-80417：|luck| 概率掷两轮；:80477-80487 第一轮存底，第二轮 luck>0 取大 /
  // luck<0 取小（幸运取极值——曾两个分支都是单掷，重掷门形同虚设）
  const luck = ctx.luck ?? 0;
  const twice = luck !== 0 && ctx.rng.next() < Math.abs(luck);
  let num = coinAmountOnce(value, ctx, bloodMoon, midas);
  if (twice) {
    const second = coinAmountOnce(value, ctx, bloodMoon, midas);
    num = luck > 0 ? Math.max(num, second) : Math.min(num, second);
  }
  // :80497 num += extraValue 在乘区/luck 双掷【之后】、拆币之前——曾由调用方并入
  // 基数 value=被六级乘区放大（红蓝对抗 R3-B3 校正,怪吸钱 extraValue 不吃乘区）
  num += extraValue;
  return splitCoins(num, ctx.rng);
}
/** 单轮金额（:80422-80459 的乘子链，抽签顺序照抄：midas 在基线掷之前） */
function coinAmountOnce(value: number, ctx: NpcDropCtx, bloodMoon: boolean, midas: boolean): number {
  const rng = ctx.rng;
  let num = value;
  // 1457 :80450 Midas 加成 Next(10,51) → Next(30,51)（+10~50% → +30~50%）
  if (midas) num *= 1 + rng.int(30, 50) * 0.01;   // 金药剂 midas（1457 :80450 Next(30,51) 左闭右开 → int(30,50)；rng.int(a,b)=Next(a,b+1) 约定）
  num *= 1 + rng.int(-20, 75) * 0.01;             // :80425 Next(-20,76) → [-20,75]
  if (rng.int(0, 1) === 0) num *= 1 + rng.int(5, 10) * 0.01;    // 1/2 ×(1.05-1.10)
  if (rng.int(0, 3) === 0) num *= 1 + rng.int(10, 20) * 0.01;   // 1/4 ×(1.10-1.20)
  if (rng.int(0, 7) === 0) num *= 1 + rng.int(15, 30) * 0.01;   // 1/8 ×(1.15-1.30)
  if (rng.int(0, 15) === 0) num *= 1 + rng.int(20, 40) * 0.01;  // 1/16 ×(1.20-1.40)
  if (rng.int(0, 31) === 0) num *= 1 + rng.int(25, 50) * 0.01;  // 1/32 ×(1.25-1.50)
  if (rng.int(0, 63) === 0) num *= 1 + rng.int(50, 100) * 0.01; // 1/64 ×(1.50-2.00)
  if (bloodMoon) num *= 1 + rng.int(0, 100) * 0.01;             // :80457 Next(101)
  return num;
}
/** 贪心拆币（:80489-80540，大额先裂变再按面额摊） */
function splitCoins(num: number, rng: RNG): ResolvedDrop[] {
  const drops: ResolvedDrop[] = [];
  while (Math.floor(num) > 0) {
    if (num > 1000000) {
      let n = Math.floor(num / 1000000);
      if (n > 50 && rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 2) + 1));
      if (rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 2) + 1));
      let rest = n;
      while (rest > 999) { rest -= 999; drops.push({ id: 74, n: 999 }); }
      num -= 1000000 * n;
      if (rest > 0) drops.push({ id: 74, n: rest });
    } else if (num > 10000) {
      let n = Math.floor(num / 10000);
      if (n > 50 && rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 2) + 1));
      if (rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 2) + 1));
      num -= 10000 * n;
      if (n > 0) drops.push({ id: 73, n });
    } else if (num > 100) {
      let n = Math.floor(num / 100);
      if (n > 50 && rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 2) + 1));
      if (rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 2) + 1));
      num -= 100 * n;
      if (n > 0) drops.push({ id: 72, n });
    } else {
      let n = Math.floor(num);
      if (n > 50 && rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 2) + 1));
      if (rng.int(0, 4) === 0) n = Math.floor(n / (rng.int(0, 3) + 1));
      n = Math.max(1, n);
      num -= n;
      drops.push({ id: 71, n });
    }
  }
  return drops;
}

// ============ 心/星（NPCLoot_DropCommonLifeAndMana :80332 1:1） ============
// :80334/:80345 closestPlayer.RollLuck(6/2)——带幸运双掷（曾用裸随机丢 luck 语义）
export function rollHeartsAndStars(ctx: NpcDropCtx): ResolvedDrop[] {
  const drops: ResolvedDrop[] = [];
  // R14-A7：NPC57:80345-80370 1:1——①排除集按【netID】16/121（num=1 整段跳过,零掷）
  // /81（num=1）;②两支都是「num==0 && RollLuck 先掷 && lifeMax>1 && damage>0」短路序
  // （damage=0 的小动物也消耗 RollLuck 掷）;③第二支(星)同样带 lifeMax/damage 门
  // （曾缺=无伤怪也能出星）
  const num = (ctx.netId === 16 || ctx.netId === 121 || ctx.netId === 81) ? 1 : 0;
  if (num === 0) {
    if (rollLuck(ctx, 6, 1) && ctx.lifeMax > 1 && ctx.damage > 0) {
      if (ctx.rng.int(0, 1) === 0 && ctx.mana < ctx.manaMax) drops.push({ id: 184, n: 1 });
      else if (ctx.rng.int(0, 1) === 0 && ctx.hp < ctx.hpMax) drops.push({ id: 58, n: 1 });
    }
    if (rollLuck(ctx, 2, 1) && ctx.lifeMax > 1 && ctx.damage > 0
      && ctx.mana < ctx.manaMax) drops.push({ id: 184, n: 1 });
  }
  return drops;
}

// ============ 按 type 额外心掉落（NPCLoot_DropHeals :79913-80010 switch 1:1） ============
// 南瓜月小怪 305-314/329/330 RollLuck(4)、树精 326 RollLuck(6)、无头骑士 315 必掉、
// 341 Next(5,11) 颗、338-340 RollLuck(5)、342 Next(3)!=0、月事件 Boss 325/327/344/345/346
// Next(6)+6 颗、267 Next(2)&&未满血、13-15 EoW Next(4)&&未满血、116-119 WoF 族
// !expert||Next(5)==0、139 Next(2)==0。R14-A4（此前整支缺失）
export function rollTypeHearts(ctx: NpcDropCtx): ResolvedDrop[] {
  const drops: ResolvedDrop[] = [];
  const t = ctx.type;
  const heart = (n = 1) => { for (let i = 0; i < n; i++) drops.push({ id: 58, n: 1 }); };
  const inSet = (set: number[]) => set.includes(t);
  if (inSet([305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 329, 330])) {
    if (rollLuck(ctx, 4, 1)) heart();                       // :79939-79943
  } else if (t === 326) {
    if (rollLuck(ctx, 6, 1)) heart();                       // :79946-79950
  } else if (t === 315) {
    heart();                                                // :79953-79955 必掉
  } else if (t === 341) {
    heart(ctx.rng.int(5, 10));                              // :79958-79964 Next(5,11)
  } else if (inSet([338, 339, 340])) {
    if (rollLuck(ctx, 5, 1)) heart();                       // :79967-79971
  } else if (t === 342) {
    if (ctx.rng.int(0, 2) !== 0) heart();                   // :79974-79978
  } else if (inSet([325, 327, 344, 345, 346])) {
    heart(ctx.rng.int(0, 5) + 6);                           // :79981-79990 Next(6)+6
  } else if (t === 267) {
    if (ctx.rng.int(0, 1) === 0 && ctx.hp < ctx.hpMax) heart();   // :79993-79997
  } else if (inSet([13, 14, 15])) {
    if (ctx.rng.int(0, 3) === 0 && ctx.hp < ctx.hpMax) heart();   // :80000-80004
  } else if (inSet([116, 117, 118, 119])) {
    if (!ctx.isExpert || ctx.rng.int(0, 4) === 0) heart();        // :80007-80011
  } else if (t === 139) {
    if (ctx.rng.int(0, 1) === 0) heart();                   // :80014-80018
  }
  return drops;
}

// ============ Boss 药水+心（DoDeathEvents_DropBossPotionsAndHearts :79790） ============
export function rollBossPotionsAndHearts(ctx: NpcDropCtx): ResolvedDrop[] {
  const drops: ResolvedDrop[] = [];
  const stack = ctx.rng.int(5, 15); // Next(5,16)
  let potion = 28; // 弱效治疗药水
  if (ctx.type === 113 || ctx.type === 35 || ctx.type === 668) potion = 188; // 治疗药水
  else if (ctx.type === 222) potion = 1134;
  else if (ctx.type === 657) potion = 499;
  else if (ctx.type > 113 && ctx.type < 222) potion = 499; // 强效治疗
  else if (ctx.type === 636 || ctx.type === 245 || ctx.type === 262 || ctx.type === 370
    || ctx.type === 395 || ctx.type === 439) potion = 499;
  else if (ctx.type === 398) potion = 3544;
  drops.push({ id: potion, n: stack });
  const hearts = ctx.rng.int(5, 9); // Next(5)+5 → 5..9? 原版 Next(5)+5 = 5..9
  for (let i = 0; i < hearts; i++) drops.push({ id: 58, n: 1 });
  return drops;
}

// ============ 掉落初速度（Item.cs:49746-49756,RB30b-F4 修正区间） ============
// :49753-49754 vx=Next(-30,31)*0.1 / vy=Next(-40,-15)*0.1（闭区间口换算 Next(-40,-15)
// =[-40,-16]；曾写 int(-40,-15) 多含 -1.5 一档,RB30b-F4 改 int(-40,-16)）；859/4743 零速
// 特判已删（不在 ItemNoGravity 集,见下方 R14-A6 注）；:49747-49750 520/521/星云拾取
// 族（ItemID.cs:1110 NebulaPickup={3453,3454,3455}）双向 Next(-30,31)
const NEBULA_PICKUP = new Set([3453, 3454, 3455]);
/** ItemID.Sets.ItemNoGravity（ItemID.cs:1108,16 项逐字）——掉落初速双向飘。
 *  ★FX44 权威收敛到 src/data/items.ts ITEM_NO_GRAVITY_VIDS（与 ItemDrop.fixedUpdate
 *  重力门同源——曾本文件私拷贝一份,两处清单漂移=物理与初速分家） */
const ITEM_NO_GRAVITY = ITEM_NO_GRAVITY_VIDS;

export function dropVelocity(rng: RNG, id?: number): { vx: number; vy: number } {
  // R14-A6：ITM57:49746-49756 三分支——①velocity.HasValue（调用方显式给,不走此函数）
  // ②ItemNoGravity[type] → 双向 Next(-30,31)×0.1；③默认 vx Next(-30,31)/vy Next(-40,-15)。
  // 1456 的 859/4743 零速特判已删（二者不在 ItemNoGravity 集 → 走默认下坠）;
  // 双向族补全 547/548/549/575/3456-3459/3580/3581/4143（曾仅 520/521+3453-3455）
  if (id !== undefined && ITEM_NO_GRAVITY.has(id)) {
    return { vx: rng.int(-30, 30) * 0.1, vy: rng.int(-30, 30) * 0.1 };
  }
  // ★RB30b-F4：rng.int 是闭区间 ≡ Next(a,b+1)——原版 Next(-40,-15) 上界【开】
  // =[-40,-16]，×0.1=[-4.0,-1.6]。曾写 int(-40,-15) 多含 -1.5 一档（注释自知未改码）
  return { vx: rng.int(-30, 30) * 0.1, vy: rng.int(-40, -16) * 0.1 };
}

export { SLIME_BODY };
