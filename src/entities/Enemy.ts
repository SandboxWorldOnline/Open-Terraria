// 敌人实体：统一类 + 按 key 分支行为（史莱姆/僵尸/恶魔眼/蝙蝠/克苏鲁之眼及其仆从）
// + 原版 NPC 数据驱动路径（vanillaId）：属性/AI/音效/贴图来自 vanilla-npcs.json（SetDefaults 提取）
import { Entity } from './Entity';
import { entityNet } from '../net/entitySyncHooks';
// M3 Boss 伤害统计漏斗（/boss伤害;NPC.StrikeNPC→NPCDamageTracker.AddDamage :82129-82130。
// entityNet 同模式注入——entities 层不反向依赖聊天层,单机默认 null 零开销）
import { bossDamageSink, consumePendingStrikeOwner, setPendingStrikeOwner } from '../chat/BossDamageTracker';
import { playEnemyHitSound, ON_HIT_EXCLUDED_PROJS } from './projTargets';
import { TILE_BY_KEY, TILE_DEFS, WALL_DUNGEON_SHEETS, FRIENDLY_FAIRY_CAN_LURE_TO_SHEETS } from '../data/tiles';
import { TOWN_CRITTER_IDS, NPC_CATCHABLE } from '../data/critters';   // ★BJ704-G3 D7/D10：TownCritter 集(NPCID.cs:4827)/npcCatchable 集(Main.cs:9469+)单源
import { walkPrediction } from './npcWalkPrediction';   // ★BJ704-G6 D12：AI_007 行走预测共享叶子（TownNPC 同源;Enemy↔TownNPC import 环防）
import { paintColor } from '../world/Paint';
import { inAPlaceWithWind } from './Mounts';
import { anchorSpecOf, validateAnchors } from '../world/TileAnchorValidator';
import { solidAllowBottomSlope } from '../world/BoulderMech';
import { liquidCollision, drownCollision } from '../stats/TouchDamage';
import { updateNpcLiquid, getWaterLine } from './npcLiquid';
import type { GameHooks, LootPlayerCtx } from './types';
import { Clock } from '../world/World';
import { bannerOfNpc } from '../world/Banners';   // SW-BJ47 lastCreatureHit 命中写位（旗种 id 域）
import type { Player } from './Player';
import { ENEMY_DEFS, EnemyDef } from '../data/enemies';
import { vanillaNpc, vanillaSoundFiles, NPC_STATIC_ALPHA, type VanillaNpc } from '../data/vanillaNpcs';
import { IDLE_SOUNDS, CHATTER_SOUNDS, CRITTER_SOUNDS } from '../data/vanillaNpcAmbience';
import { ENEMY_GRAVITY, MAX_FALL_SPEED, TILE } from '../core/constants';

/** 皇家凝胶 3090（ItemID.RoyalGel）的 npcTypeNoAggro 置位表（表名沿用历史,与镇静
 *  药水无关——1457 Player.cs:14790-14814 / 1456 :14144-14168：`currentItem.type
 *  == 3090` 下逐项 npcTypeNoAggro[N]=true，共 23 类；字段声明 Player.cs:2977）。
 *  ★原文全文该数组【唯一】置位源 = 装备 3090（ResetEffects :18922/UpdateDead
 *  :17157 每帧全清）;calmed 只吃刷怪率（NPC.cs:708-712）不置旗。
 *  ★SW-RB8c 2026-09-08 定谳清算：旧「Calming ∪ 3090」置位源并集（npcNoAggroActive,
 *  2026-08-22 接）整体退役——原文全部消费面（接触 skip :31588/索敌 +1000 罚
 *  :78490/:78502/不面向门 :78542/AI_001 弹射门 :61303 族/aiStyle22 :24935/:24969/
 *  :25139）一律 gel 专面判定子 npcTypeNoAggro()/royalGelActive。 */
export const CALMING_NO_AGGRO_TYPES: ReadonlySet<number> = new Set([
  1, 16, 59, 71, 81, 138, 121, 122, 141, 147, 183, 184, 204, 225, 244,
  302, 333, 335, 334, 336, 537, 676, 667,
]);

/** npcTypeNoAggro[type] 置位源并集（Player.cs:14144-14168）：镇静 buff（Calming 106）
 *  ∪ 皇家凝胶 3090 装备（equipStats.royalGel——2026-08-22 配饰审计补接，
 *  此前装备源缺位，3090 只登记不生效）。测试桩无 equipStats 时可选链兜底 false。 */
/** ★SW-BJ34 2026-09-08：皇家凝胶装备旗（仅 3090）。1457 原文 npcTypeNoAggro[] 的
 *  【唯一】置位源 = ApplyEquipFunctional `currentItem.type == 3090`（1457
 *  Player.cs:14790-14814；1456 :14144-14168），逐项置 23 类（表见
 *  CALMING_NO_AGGRO_TYPES）；镇静药水 `player.calmed` 只吃刷怪率 spawnRate×1.65/
 *  maxSpawns×0.6（1457 NPC.cs:708-712），不置 npcTypeNoAggro。故原文消费面——
 *  接触伤害跳过（Player.cs:31588 Update_NPCCollision）、AI_001 弹射门（NPC.cs
 *  :61303/:61768/:61823/:61878/:61958/:62007）、aiStyle22 122 充能/开火（:24935/
 *  :24969）与 aiStyle22 垂直决策（:25139）——一律只认装备旗，不并镇静
 *  （旧索敌三锚的镇静并集已随 SW-RB8c 2026-09-08 定谳撤销,同 gel 专面）。 */
export function royalGelActive(player: Player): boolean {
  return !!(player as unknown as { equipStats?: { royalGel?: boolean } }).equipStats?.royalGel;
}
/** ★SW-BJ34 2026-09-08：`npcTypeNoAggro[type]` 原文判定子的本仓形状——原版是玩家
 *  实例上的 bool[NPCID.Count]（Player.cs:2977 声明；:17157 UpdateDead/:18922
 *  ResetEffects 每帧全清 + :14792-14814 装备重置位），本仓以「型 ∈ 23 类表 ∧
 *  royalGelActive」等效（equipStats 内容缓存随装备变化失效，语义同每帧重算）。
 *  ★原文数组直查【无】direction!=0 守卫（该守卫仅 :78490/:78542 TargetClosest
 *  两处所有），此判定子对齐原文裸语义。 */
export function npcTypeNoAggro(vanillaId: number | null | undefined, player: Player): boolean {
  if (vanillaId == null) return false;
  if (CALMING_NO_AGGRO_TYPES.has(vanillaId) && royalGelActive(player)) return true;
  // ★四百七十四刀:mod 配饰型集并集(AquaticEmblem 鲨鱼族 5 型= npcTypeNoAggro
  //  同一原文数组面的第二置位源;聚合期整集重设)
  const modSet = (player as unknown as { modNoAggroTypes?: Set<number> | null }).modNoAggroTypes;
  return !!modSet?.has(vanillaId);
}
/** Main.wallDungeon（Main.cs:10507-10515：主题墙 7/8/9 + 1.4 变体 94-99）——地牢之魂
 *  双门的墙侧（SceneMetrics/WorldGen 各有一份同值表） */
const DUNGEON_WALL_IDS = WALL_DUNGEON_SHEETS;   // Main.wallDungeon（★BJ187 单源 data/tiles.ts）
import { spawnStardustMarks } from './StardustMarkProj';
import { moveAndCollide, moveNoSlopeBox } from '../physics/TileCollision';
import { TileStore, LIQUID_TYPE } from '../world/TileStore';
import { Dart } from './Dart';
import { Arrow } from './Arrow';
import { PoopProj } from './PoopProj';
import { BookProj } from './BookProj';
import { SquidCloud } from './SquidCloud';
import { avoidWater } from './waterAvoid';
import { daybreakStacks } from './WeaponProj';
import { npcCheckArmorPenetration } from './projStatus';
import { skeletronBossAI, skeletronHandAI, kingSlimeAI, brainOfCthulhuAI, creeperAI, twinsAI, skeletronPrimeAI, primePartAI, destroyerAI, destroyerSegmentLight, spawnPart, addEnemy, shoot, losClear, mechProbeLock } from './bossAI';

import { bindEnemyCtor } from './enemyCtorRegistry';import { mechQueenUp } from './mechQueen';
import { wallOfFleshAI, wofEyeAI, hungryAI } from './bossAI_wof';
import { lunaticCultistAI, empressOfLightAI, queenSlimeAI, ancientLightAI, ancientDoomAI } from './bossAI_lategame';
import { deerclopsAI } from './bossAI_deerclops';
import { queenBeeAI, planteraHookAI, planteraAI, planteraTentacleAI, planteraTentacle2AI } from './bossAI_queenbee_plantera';
import { dukeFishronAI, dukeBubbleAI, sharkronAI, moonLordCoreAI, moonLordHandAI, moonLordHeadAI } from './bossAI_duke_moonlord';
import { golemAI, golemHeadAI, golemFistAI } from './bossAI_golem';
import {
  mourningWoodAI, pumpkingAI, pumpkingBladeAI, iceQueenAI,
  santaNK1AI, elfCopterAI, flockoAI, snowmanAI, bouncingBallAI,
} from './bossAI_moon_events';
import {
  martianProbeAI, martianSaucerAI, martianSaucerPartAI, martianDroneAI,
  teslaTurretAI, bubbleShieldAI, angryNimbusAI, martianFighterExtras,
} from './bossAI_martian';
import {
  flyingDutchmanAI, sandElementalAI, sandSharkAI, dd2AttackerTestAI,
  eterniaCrystalAI, lanePortalAI, divingFlyerAI, darkMageAI, betsyAI,
  dd2LightningBugAI, ai107ImprovedWalkers,
} from './bossAI_dd2';
import {
  moonLordFreeEyeAI, moonLeechAI, cultistTabletAI, lunaticDevoteeAI,
  cultistArcherStandbyAI, cultistArcherWake, phantomAI, bigMimicAI,
  mothronAI, mothronEggAI, babyMothronAI, graniteElementalAI,
  starCellAI, smallStarCellAI, flowInvaderAI, nebulaFloaterAI, solarSlimeAI,
  crawltipedeAI, lunarLocalAI, VortexPortalProj, drakomireBreathAI, solarFlareAI,
  unitYRotatedByRandom,
} from './bossAI_lunar_misc';
import { RNG } from '../core/rng';
import { TOWER_KEY } from '../world/LunarEvent';
import { openDoor, shiftTallGate } from '../world/Door';
import {
  fighterMoveStep, chaosElementalStep, swampThingAmbushStep, attemptToFindTeleportSpot,
  attemptToFindTeleportSpotNearBooks,
  psychoStealthStep, nailheadHitScatter, butcherKbStep, possessedStep, fritzPounceStep,
  stormDiverStep, FIGHTER_NO_DOOR, FIGHTER_DOOR_WHITELIST, alienFlightStep, getChaseResults, factorAcceleration,
  alienLarvaMaturationStep,
} from './fighterFamilies';
import { canHit, canHitLine } from '../physics/LineOfSight';
import { ITEM_DEFS, VANILLA_ITEM_KEY_BY_ID, ITEM_BY_KEY } from '../data/items';
import { rollNaturalPrefixForVid } from '../data/vanillaPrefixes';   // ★BJ390：掉落词缀自然掷
import { isPrefixableAccessory } from '../items/Inventory';          // ★BJ390：IsAPrefixableAccessory 等价面
import type { ItemDrop } from './ItemDrop';
import {
  resolveDrops, rollCoins, rollHeartsAndStars, rollTypeHearts, rollBossPotionsAndHearts,
  dropVelocity, npcValueOf, type NpcDropCtx,
} from '../drops/NpcDrops';
import { isNpcShimmerImmune, npcShimmerTransformTo, npcShimmerTransformToItem } from '../stats/Shimmer';
import {
  scaleStats, getAttackDamageForProjectiles, type ScalingStats,
  GDL, remap, mainDifficulty, mainExpertMode, getAttackDamageCappedAtMaster,
  getKnockbackMultiplierScaledByDifficulty,
  scaleStatsWorld, applySeedAdjustments, applyRemixSetDefaults, seedTailBox, type SeedAdjustStats, f32, damageVar, netIdSpawnScale,
} from '../stats/ScaleStats';
import { BuffType } from '../stats/Buffs';
import { rollLuck, rollOnlyBadLuckExtreme } from '../stats/Luck';
import { spawnNpcDeathGore, GorePiece, newLovestruckHeart } from './GorePiece';
import { spawnNpcHitDust, spawnNpcDeathDust } from './NpcHitDust';   // ★BJ254 HitEffect 尘查表
import { hslToRgb } from '../player/Appearance';
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ330 GTW 单源（661 光皇蝴蝶点光相位）
import { npcContactBucketId, getGlobalHurtBuckets, type HurtCooldownBuckets } from '../player/HurtCooldownBuckets';
import { getMeleeCollisionData, boxesIntersect } from '../player/MeleeCollisionData';
import { enemyHurtFloatColor } from '../fx/CombatTextColors';
import { takeModNpcAi, takeVanillaNpcAiOverride, runModOnHitPlayerBuff, runModOnHitAny, runModNpcPreAiBlocked, runModNpcPostAi, runModNpcIncomingHit, runModOnNpcHitByAny, runModOnNpcDeath, runModOnKillAnyNpc } from '../mods/hooks';
import type { Game } from '../core/Game';

/** 无 key 映射的原版物品 id（一次性告警用） */
const UNMAPPED_WARNED = new Set<number>();

/** NPCID.Sets.CritterThatCanTurnOnPlayers（NPCID.cs:4779）：松鼠族 + 宝石松鼠——
 *  玩家 CanHit 内 1/3000 厄运掷 → 黑化反咬（townCritterWalkAI 头部，NPC.cs:53797） */
const CRITTER_TURN_ON_PLAYERS = new Set([299, 538, 539, 639, 640, 641, 642, 643, 644, 645]);

/** NPCID.Sets.BirdThatCanPoop（NPCID.cs:4777）：飞行时 1/50 极端霉运玩家头顶拉屎
 *  （鸟 NPC.cs:25459-25467 / 飞行鸭 aiStyle68 :34947-34955——★BJ644 行号 1456→1457，弹 1080） */
const BIRD_THAT_CAN_POOP = new Set([74, 297, 298, 442, 363, 365, 603, 609, 671, 672, 673, 674, 675]);

/** IsThisCenx（Player.cs:18032-18038）：四位开发者名（小写比较）恒被鸟粪命中 */
function isThisCenx(name: string | undefined): boolean {
  const n = (name ?? '').toLowerCase();
  return n === 'cenx' || n === 'cblox' || n === 'jade lightning' || n === 'cenigit';
}

// ================= NPC 侧点光的共享近似源（GameHooks 取不到 FlickerClock/Main 计数器） =========
/** Main.timeForVisualEffects 等价（1458 Main.cs:17340-17343 = 台账"17110"同义锚：
 *  每 tick +1、216000 回卷）。★C 批改型(2026-08-31)：曾 performance.now()/16.6667
 *  折帧 = 渲染帧时钟,暂停/世界冻结仍走表,与原版 tick 节拍错相——改逐 tick 计数器,
 *  由 Game 固定步实体轮前的 stepVisEffectTick() 推进;Game 未启动(菜单纯渲染)时
 *  回退 wall-clock 兜底动画。 */
let visTickCounter = 0;
export function stepVisEffectTick(): void {
  if (++visTickCounter >= 216000) visTickCounter = 0;
}
export function visEffectFrames(): number {
  if (visTickCounter > 0) return visTickCounter;
  return (performance.now() / 16.6667) % 216000;
}
/** 近似 Main.mouseTextColor（Main.cs:18066-18073：190↔255 每帧 ±1 三角波，周期 130 帧）。
 *  消费点：cs:24722（火轮 num306=(270−mouseTextColor)/400）、cs:93547 等
 *  UpdateNPC_CastLights 的 (270−mouseTextColor)/500 抖动项 */
export function mouseTextColorApprox(): number {
  const t = visEffectFrames();
  const p = t % 130;
  return p < 65 ? 190 + p : 255 - (p - 65);
}

/** AI_GlobalFiringDistanceCheck（1457 新增,NPC.cs:56405-56411）：
 *  `Utils.CenteredRectangle(targetPos.ToPoint(), Main.MaxWorldViewSize)` 再
 *  `Inflate(-50,-50)` → 以目标为中心的 1820×1100 视野矩形（每侧内缩 50 →
 *  半轴 1920/2−50=910 × 1200/2−50=550；曾误读"尺寸−50"得 935×575，门放宽 25px），
 *  `Contains(shootPos.ToPoint())` = 射手在目标"最大世界视野"内才允许开火/索敌。
 *  Main.MaxWorldViewSize = Point(1920,1200)（Main.cs:758 恒量,单人等价）。
 *  Rectangle.Contains 语义：Left ≤ x < Right（XNA 左闭右开）;ToPoint = (int) 截断。
 *  1457 共 11 处调用：aiStyle 8 施法者族（29 哥布林术士豁免）、13 诅咒触手 101、
 *  14 哈比 48、19 蚁狮 69、22 幽灵族 122 大蜗牛、38 雪人 143/145、
 *  73 火星炮塔 387、AI_003 战士 251 独眼僵尸/109 小丑（:60405,攻击链
 *  2026-08-23 蓝队 R1-01 补全——此前注释虚挂）、AI_005 蜂群 139 探针。
 *  超视野效果 = 不开火/不索敌（防"隐形炮"） */
export function aiGlobalFiringDistanceCheck(sx: number, sy: number, tx: number, ty: number): boolean {
  const dx = Math.trunc(sx) - Math.trunc(tx);
  const dy = Math.trunc(sy) - Math.trunc(ty);
  return dx >= -910 && dx < 910 && dy >= -550 && dy < 550;
}
/** 661 帝皇蝶离神圣渐隐一步（NPC.cs:45240-45263 纯函数化，仅 type 661）：
 *  fading（目标失效 / 中心距 ≥300 / 目标玩家不在神圣，:45244-45252）→ ai2 +1，
 *  否则 −1，钳 [0, cap]（cap=50 常态；目标不在神圣抬到 60，:45242/:45250）；
 *  opacity = GetLerpValue(60, cap/2, ai2)（:45263）——ai2 ≤ cap/2 全显，
 *  cap/2→60 线性渐隐；ai2 ≥ 60 → despawn（active=false，:45254-45261）。
 *  渲染侧 Renderer.npcGlowOrbitParams 同源消费 ai2（轨道环半径 2+ai2 /
 *  num300 下限 GetLerpValue(0,60,ai2) / 相位 0→3）。 */
export function lacewingFadeStep(
  ai2: number, fading: boolean, cap: number,
): { ai2: number; opacity: number; despawn: boolean } {
  const DESPAWN = 60;                                                // num3（cs:45240）
  const next = Math.max(0, Math.min(cap, ai2 + (fading ? 1 : -1)));   // cs:45253 Clamp(±1, 0, num4)
  if (next >= DESPAWN) return { ai2: next, opacity: 0, despawn: true };
  const from = DESPAWN, to = cap / 2;                                // cs:45263 GetLerpValue(60, num4/2, ·)
  let opacity: number;
  if (next <= to) opacity = 1;                                       // 反向区间：≤to 全显
  else if (next >= from) opacity = 0;
  else opacity = (next - from) / (to - from);
  return { ai2: next, opacity, despawn: false };
}
// 原生 def 覆盖表(钱币/凝胶/火把/晶状体→本地键)已随本地物品退役移除:
// 全量 vi_ 注册(VANILLA_ITEM_KEY_BY_ID)直接覆盖;236 曾误当 Lens(实为 Black Lens)
/** 雕像产怪战利品门（NPCID.Sets，NPC.cs :79648-79654 NPCLoot 早退用） */
const STATUE_NO_EARLYMODE_LOOT = new Set([480, 82, 86, 170, 180, 171]);
/** DoesntDespawnToInactivity 名单（NPC.cs:78584-78641）中本批涉及的仪式/月总链类型——
 *  神秘石碑 437/忠实信徒 438/弓手 379,380（拜月仪式链条，离屏消失会断 439 召唤链）与
 *  月总游离眼 400（锚核心 398 生命周期，自身不参与离屏消散）。
 *  ★690 雕像宝箱怪已从本名单摘除（MAJOR-1 收窄,2026-09-02）：原版头部门
 *  CheckActive :78700 `type==690 && ai[0]==0` 只豁免【伪装态】——AI_126 已移植
 *  （本文件 statueMimicAI,唤醒置 ai0=1）,整 id 入名单会让唤醒态也永生,场上有
 *  690 时 !AnyNPCs(690) 再刷门永久闭死。现走消费端条件项 ai0===0（见下方豁免链）,
 *  伪装态语义不变（该态另有每帧 despawnTimer=750 续命写,与本门并存不冲突） */
/** DoesntDespawnToInactivity 名单外补丁（名单本体 NPC.cs:78584-78658）：血肉墙族
 *  113 墙/114 之眼/115 饥饿者/118+119 水蛭体节在列——离屏永不因闲置消散；
 *  ★116 饿魂与 117 水蛭头【不在】名单（照原文，任务单曾列 117 系笔误）——水蛭头
 *  消散时其体节链经下方 despawn 链杀级联（原版 :51832-51841 段自查前段失效自灭） */
/** DoesntDespawnToInactivity（NPC.cs:78584-78679）全量 + 668（DoesntDespawnTo
 *  InactivityAndCountsNPCSlots :78587 唯一成员：CheckActive 循环内 `if (flag)
 *  continue` :78725 跳过屏幕盒/boss/switch,循环尾 `if (flag) return` :78786-78789
 *  在 timeLeft-- :78790 之前返回 → 668 永不倒数也永不消散。CRITICAL 摘 boss 短路
 *  后若不豁免,668 鹿角怪会走四步离屏消散=新增回归,按原版钉活）。
 *  ★14/15（EoW 体节/尾）必在——它们 SetDefaults boss=false
 * （仅头 13 是 boss）又不在此前名单,离屏 750t 消散会触发链级联整链同灭 →
 * "EoW 打两下自动战败"根因。★413/414（爬尾虫身/尾）同款补入：crawltipedeAI 的
 * 段完整性自查（NPC.cs:51807-51861）会把"邻段离屏消散"级联成整链 die（带掉落）
 * ——30 段长链尾段出屏即连锁塌链。139(Betsy 依赖 134 在场)/552-578(依赖 548 永恒
 * 水晶在场)为条件项,单独判定 */
const NO_DESPAWN_IDS = new Set([
  8, 9, 11, 12, 14, 15, 36, 40, 41, 668,
  88, 89, 90, 91, 92, 96, 97, 99, 100,
  113, 114, 115, 118, 119, 128, 129, 130, 131, 134, 135, 136, 246, 247, 248, 249,
  263, 267, 328, 379, 380, 392, 393, 394, 396, 397, 398, 400, 413, 414, 422, 437, 438,
  439, 440,
  488, 492, 493, 507, 517, 548, 549, 551, 564, 565,
]);
/** CheckActive flag2 强真名单（NPC.cs:78735-78758:boss 之外 type∈{7,10,13,35,36,
 *  39,87,127-131,392-394,491,492} 恒视屏内）。13=EoW 头（即便 boss 位被换锚到
 *  体节后,原头残段也不消散） */
const ALWAYS_ACTIVE_IDS = new Set([7, 10, 13, 35, 36, 39, 87, 127, 128, 129, 130, 131, 392, 393, 394, 491, 492]);
/** CheckActive 两窗半幅（NPC.cs:6176-6178 + sWidth/sHeight=1920/1200 :67892-67895，
 *  F1 纵向纠偏 2026-09-01）：
 *  · rectangle（ActiveRange 保命盒,:78705-78706）半幅 = activeRangeX/Y = (int)(s×2.1)
 *    = 4032 / 2520 px——旧 Y 半幅 TILE*142=2272px 系误植（2268/2272 混写）， vanilla
 *    2520 ⇒ 2272~2520px 竖向带内"原版保命、我方提前消散"（F1 判别例）。
 *  · rectangle2（屏幕盒,:78691-78693）半幅 = sWidth/2+width / sHeight/2+height
 *    = 960+w / 600+h px——旧 TILE*62/TILE*35（992/560px）系按 32×32 定宽 NPC 的
 *    中心距近似；现按本弹体盒宽高逐例求值（X 项与 32 宽 NPC 数值恰同,宽NPC/高NPC
 *    不再偏窄）。
 *  ★交测口径（F5c,MINOR-1 2026-09-02 落地）：本仓为中心距式 |Δcenter|<半幅+玩家半幅,
 *  原版为矩形与玩家 hitbox 相交——中心距式须再外扩玩家半宽/半高（q.w/2、q.h/2）
 *  才等价（曾登记为"偏窄一档"近似,现已按 canAnyPlayerSeeThisTile 同款写法在两处
 *  消费点补齐：本文件 CheckActive 两窗 + Game.ts nearbyActiveNPCs 记账盒）。
 *  导出供 Game.ts 复用（同源常量,禁再抄数字） */
export const CHECK_ACTIVE_HALF_X = 4032;
export const CHECK_ACTIVE_HALF_Y = 2520;
/** StatueSpawnedDropRarity（NPCID.cs:4795）：-1=不受限；≥0=按该概率整单出战利品 */
const STATUE_DROP_RARITY: Record<number, number> = {
  480: 0.05, 82: 0.05, 86: 0.05, 48: 0.05, 490: 0.05, 489: 0.05,
  170: 0.05, 180: 0.05, 171: 0.05, 167: 0.25, 73: 0.01, 24: 0.05,
  481: 0.05, 42: 0.05, 6: 0.05, 2: 0.05, 49: 0.2, 3: 0.2, 58: 0.2,
  21: 0.2, 65: 0.2, 449: 0.2, 482: 0.2, 103: 0.2, 64: 0.2, 63: 0.2, 85: 0,
};

/** 原版 Boss 头/主体 id（部件不标记:击杀部件不应出 Boss 退场流程）。
 *  与 1456 SetDefaults boss=true 全集逐块对齐（2026-08-13 整体 review 复核）：
 *  4 EoC / 35 骷髅王 / 50 史莱姆王 / 113 血肉墙 / 125,126 双子 / 127 Prime /
 *  134 毁灭者 / 222 蜂后 / 245 石巨人 / 262 世纪之花 / 266 克脑 / 370 猪鲨 /
 *  395 火星飞碟(:13993) / 396/397 月总头手 / 398 月总核心 / 439 异教徒 /
 *  578 DD2 闪电甲虫 T3 / 636 光皇 / 657 史莱姆皇后 / 664 火把神 / 668 鹿角怪。
 *  13-15 世吞三段：原版 :79225 动态置位(仅头实时 boss=true),本仓恒含 13 供
 *  boss 槽/掉落锚定。★68 地牢守卫(:9584 无 boss 位)、325 哀木/327 南瓜王
 *  (:13047)、345 冰女王/346 圣诞坦克(:13301)——SetDefaults 均无 boss=true,
 *  不入本集合（月事件 Boss 只有波次进度与掉落,占槽会误播"已被击败"误写
 *  downed）。396/397/578/664 已随消散审计补入（EoW 14/15 同款离屏消散隐患,
 *  见 NO_DESPAWN_IDS 注释）;boss 槽接管点已审：仅联机傀儡(:906)/F6 调试
 *  (:13085)/显式召唤链——事件怪(578/664)与月总部件无通用接管,补入无副作用 */
/** 原版 SetDefaults boss=true 全量对账（NPC.cs 逐 case 提取,2026-08-13）:
 *  4/35/50/113/125/126/127/134/222/245/262/266/370/395/396/397/398/439/578/
 *  636/657/664/668（另含本仓语义位 13） */
export const VANILLA_BOSS_IDS = new Set([
  4, 13, 35, 50, 113, 125, 126, 127, 134, 222, 245, 262, 266, 370, 395, 396, 397, 398,
  439, 578, 636, 657, 664, 668,
]);

/** ★mod NPC boss 位注册面(2026-10-05 P8,红蓝 M5 GAPS-02):mod Boss(800+)直写
 *  本集合——三处 `.has(id)` 消费点(fromVanilla/Transform/F6)零改即亮 boss 位
 *  (血条/Boss 槽/掉落锚定)。原版域只读不改。 */
export function registerModBoss(npcId: number): void {
  if (npcId < 800) throw new Error(`[mod-boss] id 须 ≥800: ${npcId}`);
  VANILLA_BOSS_IDS.add(npcId);
}

/** ★mod 蠕虫链规格注册面(2026-10-05 P8,红蓝 M5 GAPS-01):链头 id → 体/尾段 id 序
 *  (头自身不含;体先尾后,与原版 87/454 spec 同构)。wormChainSpec 查完原版白名单
 *  后查本表——自然生成/F6/召唤三条建链路全部贯通。缺注册=不建链(原语义)。 */
const MOD_WORM_CHAINS = new Map<number, { count: number; segIds: number[] }>();
export function registerModWormChain(headId: number, segIds: number[]): void {
  if (segIds.length === 0) throw new Error(`[mod-worm] 空 segIds: head ${headId}`);
  MOD_WORM_CHAINS.set(headId, { count: segIds.length, segIds });
}
/** ★D11(2026-10-14):mod Boss/蠕虫链 teardown(热重载) */
export function _resetModBossRegForTests(): void {
  for (const id of [...VANILLA_BOSS_IDS]) if (id >= 800) VANILLA_BOSS_IDS.delete(id);
  MOD_WORM_CHAINS.clear();
}
/** 训练假人 tile 378（v_378_target_dummy；dummyAI 锚定判定用） */
const DUMMY_TILE_ID = TILE_BY_KEY['v_378_target_dummy'] ?? -1;

/** tileSolid∩tileSolidTop 平台九件套（vanilla sheet 域 {19,239,380,427,435-439}；
 *  Main.cs tileSolid 表含平台——BJ187 本仓 SOLID_LUT≡tileSolid∧!tileSolidTop,
 *  原版裸 tileSolid[type] 谓词消费位（AI_039 陆龟崖边折返 NPC.cs:29494）须补此集。
 *  内部 type id 域,经 TILE_DEFS[].vanilla.sheet 反查） */
const TILE_SOLID_TOP_NINE: ReadonlySet<number> = (() => {
  const s = new Set<number>();
  for (let i = 0; i < TILE_DEFS.length; i++) {
    const sheet = TILE_DEFS[i]?.vanilla?.sheet;
    if (sheet != null && (sheet === 19 || sheet === 239 || sheet === 380 || sheet === 427
      || (sheet >= 435 && sheet <= 439))) s.add(i);
  }
  return s;
})();

// AI_003 战士族昼行豁免表（DespawnEncouragement_AIStyle3_Fighters_NotDiscouraged
// NPC.cs:60694-60724 全量 1:1，2026-08-19 B-3/B-4 批）：
//  - 大排除清单（:60696 逐 npcID!=X 项）：白天地表仍索敌的群系原住民。
//    ★624 侏儒/631 岩石巨人不在豁免表（白天停止索敌游荡）——但 :57773 else 分支
//    对二者免 EncourageDespawn（在 fighterAI 内单独豁免）。僵尸 3 不在表内 → 白天驱散。
//  - switch 保留集（:60706-60720）：409/415/419/425/427/428/429/508/524-527/580/582。
//  - default 内 528/529/530/532（:60701-60704 break → 恒 true；B-4 补齐）。
//  - CritterThatCanTurnOnPlayers（NPCID.cs:4779：645/639/644/642/643/641/640/299/539/538，
//    即 CRITTER_TURN_ON_PLAYERS）——全为小动物非 aiStyle3，对本族恒 false（黑化松鼠
//    等豁免经由小动物侧消费，登记注释）。
//  - 入侵组（B-3）：哥布林 26/27/28/111/471 仅 invasionType==1、海盗 212-216 仅
//    invasionType==3、火星组仅 invasionType==4（:60696 三个 invasionType 门 1:1——
//    原表曾无条件昼行 = 非入侵期白天不驱散，已修）。雪人军团 143-145 与哥布林术士 29
//    原版【无】豁免项（1456 终态）→ 移除。
//  - 霜月（snowMoon）门（:60696 !Main.snowMoon 组）：343/350 仅霜月期间昼行。
//  - 631 岩石巨人 ai[2]>0（攻击中）豁免（:60696 (npcID != 631 || !(ai[2] > 0))）。
//  - 411 观星者 ai[1]∈[90,180) 会被驱散（:60696 末项反相门），窗内=蓄力中段。
const FIGHTER_DAY_ACTIVE = new Set([
  73, 31, 294, 295, 296, 47, 67, 77, 78, 79, 80, 630, 110, 120, 168, 181, 185,
  198, 199, 206, 217, 218, 219, 220, 239, 243, 254, 255, 257, 258, 291, 292, 293,
  379, 380, 464, 470, 424, 409, 415, 419, 425, 427, 428, 429, 508, 524, 525, 526, 527,
  528, 529, 530, 532, 580, 582,
]);
// 入侵昼行组（cs:60696 invasionType!=N 门内名单——仅该入侵进行中生效）
const GOBLIN_DAY_ACTIVE = new Set([26, 27, 28, 111, 471]);           // invasionType 1
const PIRATE_DAY_ACTIVE = new Set([212, 213, 214, 215, 216]);        // invasionType 3
// 火星入侵昼行豁免（cs:60705 第四组 invasionType!=4 门）：入侵进行中这些战士族
// 不被白天驱散（387 特斯拉炮塔是 aiStyle 73 无此逻辑,不列）
const MARTIAN_DAY_ACTIVE = new Set([381, 382, 383, 385, 386, 389, 391, 520]);
// 霜月昼行组（cs:60696 (!snowMoon || npcID!=343/350) 门）：仅霜月期间昼行
const FROSTMOON_DAY_ACTIVE = new Set([343, 350]);
// —— NotDiscouraged 完整表的"链内真值"细分（2026-08-31 C 批，1457/1458 NPC.cs
//    :60895-60925 同锚）：显型直通表 = 大条件链尾 `npcID != X` 串（+73/624 基础项）；
//    switch 落真组 = case 列表 ∪ default 中 break 的 528-532 四型
const NOT_DISCOURAGED_CHAIN_TRUE = new Set([
  73, 624,
  31, 294, 295, 296, 47, 67, 77, 78, 79, 80, 630, 110, 120, 168, 181, 185, 198,
  199, 206, 217, 218, 219, 220, 239, 243, 254, 255, 257, 258, 291, 292, 293,
  379, 380, 464, 470, 424,
]);
const NOT_DISCOURAGED_SWITCH_TRUE = new Set([
  409, 415, 419, 425, 427, 428, 429, 508, 524, 525, 526, 527, 580, 582,
  528, 529, 530, 532,
]);
/** DespawnEncouragement_AIStyle3_Fighters_NotDiscouraged（1457/1458 NPC.cs
 *  :60895-60925 同锚；C 批 2026-08-31 从 AI_003 呻吟声窗的 despawnEncouraged 主门
 *  近似升级为完整表；fighterAI 内联 dayActive 逐步保持独立两份=同值集）。
 *  原文结构：大条件链（!eclipse&&IsItDay&&!SpawnedFromStatue&&Y≤worldSurface&&
 *  非墓地&&事件档&&显型白名单）【任一项不成立】→ 直接 return true（不被驱散）；
 *  链全成立才进 switch——case 组∪528-532 → true，余型 = CritterThatCanTurnOnPlayers
 * （黑化小动物族转战士者昼间可索敌,普通 aiStyle3 战士 false=被驱散）。 */
/** 导出供回归测试钉住极性表（tests/enemy-approx-clearing-a.test.ts） */
export function fighterNotDiscouraged(game: GameHooks, e: Enemy): boolean {
  const id = e.vanillaId ?? -1;
  if (id < 0) return false;
  const w = game.world;
  if (!(w.isItDay && !w.clock.eclipse)) return true;             // 夜/日食恒放行（★IIIII224 IsItDay remix 恒 false）
  if (e.spawnedFromStatue) return true;                              // 雕像产怪豁免
  if (!(e.cy < w.groundLevel * TILE)) return true;                   // 地下(Y≤worldSurface)
  if (w.scene?.zoneGraveyard) return true;                           // 目标玩家在墓地
  if (w.moonEvent?.kind === 1 && FROSTMOON_DAY_ACTIVE.has(id)) return true;
  if (w.invasionType === 1 && GOBLIN_DAY_ACTIVE.has(id)) return true;
  if (w.invasionType === 3 && PIRATE_DAY_ACTIVE.has(id)) return true;
  if (w.invasionType === 4 && MARTIAN_DAY_ACTIVE.has(id)) return true;
  // dontStarve 世界（theConstant）：164 血肉魔改 163 僵尸族免驱散(:60696 首段)
  if (!!w.seedFlags?.theConstant && (id === 163 || id === 164)) return true;
  if (NOT_DISCOURAGED_CHAIN_TRUE.has(id)) return true;               // 显型白名单(+624)
  if (id === 631 && e.ai2 > 0) return true;                          // 岩石巨人攻击中
  if (id === 411 && !(e.ai1 >= 90 && e.ai1 < 180)) return true;      // 观星者瞄准窗外
  // 链全成立 → switch 段落终值
  return NOT_DISCOURAGED_SWITCH_TRUE.has(id) || CRITTER_TURN_ON_PLAYERS.has(id);
}
/** 通用 ai[3] 卡死计数的跳过集（NPC.cs:57472-57546）：425/471 整段跳过（flag9，
 *  ai[3] 被各自状态机独占）；switch 集（flag10）在 ai[2]>0（瞄准/蓄力中）时跳过 */
const AI3_COUNTER_SKIP_ENTIRELY = new Set([425, 471]);
/** PlatformProperTopFrame（cs:70197）：帧列号 ∈[0,7]∪[12,16]∪[25,26]——
 *  flag5 地面扫描的顶坡平台特例用（LiquidSim.ts 同源副本） */
function platformProperTopFrame(fx: number): boolean {
  const num = Math.floor(fx / 18);
  if ((num < 0 || num > 7) && (num < 12 || num > 16)) {
    if (num >= 25) return num <= 26;
    return false;
  }
  return true;
}
// AI_003 宽探针表（1457 NPC.cs:60547-60550）：19 型前方探测点 = width/2+16（其余 15）
// ——跳跃链与攻门共用（R6-B 1-5）
const FIGHTER_WIDE_PROBE = new Set([
  109, 163, 164, 199, 236, 239, 257, 258, 290, 391, 425, 426, 427, 580, 508, 415,
  530, 532, 582,
]);
const AI3_COUNTER_SKIP_WHILE_AI2 = new Set([
  110, 111, 206, 214, 215, 216, 291, 292, 293, 350, 379, 380, 381, 382, 409, 411,
  424, 426, 466, 498, 499, 500, 501, 502, 503, 504, 505, 506, 520,
]);
/** DespawnEncouragement_AIStyle3_Fighters_CanBeBusyWithAction（NPC.cs:60726-60733）：
 *  瞄准/蓄力态（ai[2]>0）期间不做白天游荡转向的类型 */
const FIGHTER_BUSY_WITH_ACTION = new Set([
  110, 111, 206, 216, 214, 215, 291, 292, 293, 350, 381, 382, 383, 385, 386, 389,
  391, 469, 166, 466, 471, 411, 409, 424, 425, 426, 415, 419, 520,
]);
// AI_002 飘浮眼昼散表（DespawnEncouragement_AIStyle2_FloatingEye_IsDiscouraged, cs:53152-53165）：
// 白天 && y≤worldSurface → EncourageDespawn(10) + 保持水平方向向上飞离
const EYE_DAY_DESPAWN = new Set([2, 133, 190, 191, 192, 193, 194, 317, 318]);

// AI_014 wet 浮力表（cs:23232 蝙蝠/恶魔/巨狐蝠/孢子蝠 + cs:23380 哈比 48）：
// 入水上浮弹出水面（vy>0 ×0.95、恒 -0.5、钳 -4 + TargetClosest）；表外 aiStyle14 无此段
const AI014_SWIM_UP = new Set([48, 49, 51, 60, 62, 66, 93, 137, 150, 151, 152, 634]);
/** AI_001 恒激愤族（NPC.cs:61468-61799 per-type flag3=true 覆盖）：81 腐化/183 猩红
 *  Crimslime(:61483)/304 南瓜跳跳(:61489)/667 金/244 雨/184/535/658/659 仆从/204 丛林刺 */
const SLIME_FORCE_AGGRO = new Set([81, 183, 304, 667, 244, 184, 535, 658, 659, 204]);
/** AI_014 第二段移动族（NPC.cs:23227-23372 通用 else 后再跑一遍 X/Y 步进）：
 *  恶魔 62/巫毒恶魔 66/地狱蝠 49?（表见下实现）——11 类双步进 */
const AI014_DOUBLE_STEP = new Set([49, 51, 60, 62, 66, 93, 137, 150, 151, 152, 634]);
/** ★BJ588 FindFrame 死区档族（case 48..664 组 :75620-75681 连排 case 组;
 *  1456 :75522-75577 同构零漂移——BJ581 同域普查案组收编）：该组 spriteDirection
 *  =sign(vx) 死区档（vx>0→1/vx<0→−1/【vx==0 不写=保前值】,:75648-75655）+
 *  rotation=vx×0.1（:75656;蜂 210/211 覆写 ×0.2 :75657-75660）。AI 侧零写点
 *  （batAI/ghostAI/AI_122 亲读零 spriteDirection 写面——display 面唯一来源=本组），
 *  故不可用 facing 代位（facing=原版 direction,AI 索敌/探针列消费）→ 独立字段
 *  Enemy.ffSdir（缺省 -1 ≙ 原版 Entity 字段缺省 :6522）。帧节拍（num296=6/
 *  Harpy 48=5/49|51|60|634 末帧跳过/蜂 counter 双加）在 Renderer 帧引擎
 *  BAT_SKIP_LAST 档。渲染消费=drawEnemy ffSdirMirror 门（==1 镜像,Main.cs:23357）。
 *  ★BJ590 族表扩容（+7 型,15→22）：原版另有两处 case 组的 sdir 写点【同形】
 *  死区档（sign(vx) if/if+rotation=vx×0.1），逐型亲读并入——
 *  · case 150/151/152/158/226 组（:75582-75619,冰蝠/熔岩蝠/巨狐蝠/吸血蝠/飞蛇;
 *    151/150 组内尘见 findFrameRotation 尘支）：sdir if/if 死区档 :75600-75605、
 *    rotation=vx×0.1 :75606、帧 6t 回卷 num*4（:75614-75618;五型 npcFrameCount
 *    均 4,与帧引擎全帧档同形）。
 *  · 121/660（case 2/23/121/169/190-194/317/318/660 组 :74790-74856 内的
 *    `else if (type == 2 || type == 121 || type == 660)` 支 :74826-74834——Slimer/
 *    史莱姆皇后紫仆从）：同 sign(vx) 死区档+rotation=vx×0.1;首拍 frame.Y=num*2
 *    偏移（localAI[0] 门 :74810）与 121 8t/660 6t 阈在 Renderer FF_AI14_CASE_SPEC。
 *    169/190-194/317/318（恶魔眼族 Atan2 支/冰雪元素）sdir 形态不同（另有专属
 *    渲染门）不入;23 陨石头属 aiStyle5 tiltOnly5 通道不入。
 *  · 62/66（恶魔/巫毒恶魔）与 156（红恶魔）sdir=direction【非】死区档
 *    （:74684/:74687、:74701——=AI direction,通用 facing 镜像已是同值面）不入;
 *    其 rotation=vx×0.1 写点在 findFrameRotation 156/62/66 支。 */
export const FF_VXSDIR_GROUP = new Set([48, 49, 51, 60, 82, 93, 121, 137, 150, 151, 152, 158, 182, 210, 211, 226, 253, 316, 634, 660, 662, 664]);

/** ★C12/R11（2026-10-11）FindFrame sdir 写点扩面族（六案组 11 型,红蓝 R11 F1-F3 清偿）
 *  ——显示镜像同走 drawEnemy ffSdirMirror 门（==1 翻,Main.cs:23357-23361）；ffSdir 写点
 *  在 findFrameRotation 各【专属支】（形貌各异,不入 FF_VXSDIR_GROUP 通用 vx×0.1 支）：
 *  · 558-560 埃特尼亚飞龙（FindFrame case 558-560,NPC.cs:68609-68645）sdir=sign(vx)
 *    if/if 死区档（:68613-68618）+ rotation 双档（:68619-68626:ai[0]==2 → 速度角折叠
 *    ToRotation,vx<0 再 +π;余 → vx×0.1）。AI_108 层 :66279 sdir=−sign(vx) 与 :66120
 *    rotation=ToRotation 每拍被 FindFrame 覆写（FindFrame 在 AI 后 :91626）——本仓 AI 层
 *    两写点（bossAI_dd2.ts divingFlyerAI→facing/visAngle）原样保留（撞墙反弹/俯冲逻辑域,
 *    BJ588 两字段判例）,显示面独立 ffSdir/visAngle。修前显示面=facing 通用门（AI 写
 *    facing=−sign(vx)）→ flip⟺vx<0 = 反极性（原版 flip⟺sdir==1⟺vx>0）。
 *  · 574/575 小妖魔滑翔怪（:68661-68668）sdir=sign(vx) if/if 死区档（rotation=AI 直写
 *    速度角+FindFrame AngleTowards 0.02 微推,BJ591 已在轨对映不重复写）。
 *  · 330 骚灵（:75685-75691）sdir=sign(vx) 死区档 + rotation=vx×0.15（既有 330 支补 sdir）。
 *  · 224/587 飞鱼/眼球飞鱼（:75559-75568）sdir=sign(vx) 死区档 + rotation=±vy×0.2
 *    （既有支补 sdir——rotation 已接、sdir 缺=R11 定谳形态）。
 *  · 612/613 水黾（:70578-70580）sdir=Math.Sign(vx)【vx≠0 门死区档】;零 rotation 写点。
 *  · 423 进化兽（:71342-71344）sdir=Math.Sign(−vx)【反极性死区档,vx≠0 门】;零 rotation
 *    ——ffSdir=−sign(vx),镜像门 ==1 翻 → flip⟺vx<0 = 原版同相。 */
export const FF_VXSDIR_EX = new Set([558, 559, 560, 574, 575, 330, 224, 587, 612, 613, 423]);

/** Collision.SolidCollision（Collision.cs:2713-2743）1:1：盒与全实心砖重叠判定
 *  （tileSolid && !tileSolidTop；半砖顶面 +8、厚度 8）。G5 落地嵌固回退
 *  （AI_001 :61932/:62124）消费——落地后位置仍嵌进实心（坡角/台阶楔入）时的
 *  脱困门。原版扫描盒外扩 ±1/+2 列行但重叠判定过滤，等价于只扫盒内格 */
function solidBoxOverlap(
  st: GameHooks['world']['store'], x: number, y: number, w: number, h: number,
): boolean {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (!st.inBounds(tx, ty)) continue;
      const j = st.idx(tx, ty);
      if (!st.flags[j]) continue;                     // active()
      if (st.wire[j] & 32) continue;                  // inActive（致动缩入）
      const d = TILE_DEFS[st.type[j]];
      if (!d?.solid || d.platform) continue;          // tileSolid && !tileSolidTop
      const half = !!st.half[j];
      const top = ty * TILE + (half ? 8 : 0);
      const th = half ? 8 : TILE;
      if (x + w > tx * TILE && x < tx * TILE + TILE && y + h > top && y < top + th) {
        return true;
      }
    }
  }
  return false;
}

/** ★SW-BJ9 2026-09-07 全实心判定（**刻意偏离原版**的漂移门谓词，见
 *  applyUnwedgeDrift 偏离声明）：solid 且非坡/非半砖/非平台。激活感知与碰撞本体
 *  同族——solid 走 st.isSolid（active 位 + 致动位 + SOLID_LUT，与
 *  Collision.SolidCollision/moveAndCollide 实际碰撞语义一致：致动器把 tile 切成
 *  可穿态时不判实心，漂移门不会把史莱姆卡在致动态地形上；幽灵格 flags=0 同判
 *  非实心）；isPlatform 同族激活感知。坡/半砖/平台排除 = 嵌固判定
 *  （SolidCollision 整块盒）的常态来源，排除后原版退坡楔功能保留。与 unembedPass
 *  顶带/中心格判据（TileCollision.ts :980/:989 同款排除族）同构。
 *  消费者：applyUnwedgeDrift（仅 AI_001 嵌固漂移门）。 */
function fullSolidBoxOverlap(
  st: GameHooks['world']['store'], x: number, y: number, w: number, h: number,
): boolean {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (!st.inBounds(tx, ty) || !st.isSolid(tx, ty)) continue;
      const j = st.idx(tx, ty);
      if (st.slope[j] !== 0 || st.half[j] || st.isPlatform(tx, ty)) continue;
      if (x + w > tx * TILE && x < tx * TILE + TILE && y + h > ty * TILE && y < ty * TILE + TILE) {
        return true;
      }
    }
  }
  return false;
}

/** 原版路径 key（v_*）的占位 def，fromVanilla 会整体覆写 */
const PLACEHOLDER_DEF: EnemyDef = {
  key: 'v_placeholder', name: '?', hp: 1, damage: 0, knockbackResist: 0.5,
  width: 16, height: 16, mapColor: '#9A8FA0', gore: ['#9A8FA0', '#5E5566', '#C4BACC'],
  hitSound: ['NPC_Hit_1'], killedSound: ['NPC_Killed_1'], drops: [],
};

/** 生成期音效预热钩（Game.afterWorldLoad 注入 sfx.preloadFiles）——原版 LoadAll
 *  全量预载的对齐：懒加载在途时 playSfxFiles 回退合成 hit 方波 ≠ 原版音色。
 *  挂 fromVanilla/Transform 构造点 = 常规刷怪/雕像/Boss 召唤/分裂/变形零漂移覆盖
 *  （VANILLA_SPAWN_POOLS 池预热只盖池内 id，2026-08-19 秃鹫 61 漏网实证） */
let enemySoundPrewarm: ((files: string[]) => void) | null = null;
export function bindEnemySoundPrewarm(fn: ((files: string[]) => void) | null): void {
  enemySoundPrewarm = fn;
}

export class Enemy extends Entity {
  /** 原版 NPC id（数据驱动路径启用时非空） */
  vanillaId: number | null = null;
  /** 穿墙旗（原版 noTileCollide；fairyAI 状态 2-7 宝箱引导态置真） */
  noTileCollide = false;
  vanilla: VanillaNpc | null = null;
  /** npc.difficulty（ScaleStats 写入，NPC.cs:18086 = strengthOverride ?? Main.Difficulty）：
   *  原版档位浮点（Classic 1/Expert 2/Master 3，getGoodWorld +1）——AI 段
   *  GetAttackDamage_ScaledByDifficulty/ForProjectiles（如饥饿者 :26341）消费。
   *  未进 ScaleStats 门（friendly/townNPC/无伤小动物）保持 0（原版字段初值） */
  difficulty = 0;
  /** defDamage 的【未缩放】基线（ScaleStats 前的 v.damage，critter/friendly 归零后值）。
   *  敌怪弹幕出膛原版一律用 ForProjectiles(基线, 基线×N) 这类显式档位 lerp
   *  （NPC.cs:21180 等），命中玩家的难度乘区在 Projectile.cs:13770 统一做——
   *  若此处误用缩放后的 def.damage 会与命中端乘区叠加成双重缩放 */
  baseDamage = 0;
  /** 雕像产怪（Wiring.cs:2480 SpawnedFromStatue）：value=0 不掉钱、
   *  肉前集合不掉战利品、StatueSpawnedDropRarity 概率门（NPCLoot :79648-79654） */
  spawnedFromStatue = false;
  /** 捕获物释放出生（NPC.releaseOwner != 255 语义，NPC.cs:78709 不计 nearby 槽） */
  releasedFromItem = false;
  /** ★BJ704-G3 D10：NPC.catchableNPCTempImmunityCounter（NPC.cs:6536）承载位——
   *  SetDefaults 尾（:17883-17887）对 npcCatchable 型置 90（friendly=true 同拍）,
   *  SubAI（:91649-91670,本仓拍位=fixedUpdate 尾 AI 分发后）`releaseOwner!=255 ‖
   *  SpawnedFromStatue` → 清零,窗内每拍自减。★极性勘误（BJ703-C 登记读反）：90t
   *  玩家免伤窗属【自然出生】捕获型小动物,释放/雕像出生首拍即清零 */
  catchImmunityT = 0;
  /** ★BJ704-G3 D10：SubAI 投影的运行时 friendly 窗位（NPC.friendly 的 catchable
   *  覆写面）——npcCatchable 型 = catchImmunityT>0（原版每拍强写,稳态恒 false）,
   *  非捕获型恒 false（静态 def.friendly 另算）。消费面：playerCanHitEnemy
   *  （玩家免伤门）+ AI_007 逃逸档（:54467 friendly 门,下一拍读=原版 AI 先于
   *  SubAI 的上拍值时序）+ npcVsNpcContactUpdate 互殴通道（:91592） */
  catchFriendly = false;
  /** NPC.AnyInteractions（NPC.cs:5431 playerInteraction[who] 任一 true）——本仓 hurt 调用方
   *  全为玩家武器/弹幕/荆棘链 → hurt 生效即等价玩家交互；雕像门 :79651 消费 */
  playerInteracted = false;
  /** npc.playerInteraction[slot] 的 MP 位图（NPC.cs:80843-80851 ApplyInteraction）：
   *  per-client 掉落族（Boss 袋/大师宠物）只发交互过的端（CommonCode.cs:44/:71
   *  `npc.playerInteraction[i] || !interactionRequired`）。本地玩家 = hurt fromPlayer
   *  注入 net.mySlot；访客 = Game.netApplyStrike（msg42 fromSlot）。蠕虫链按
   *  realLife/链体传播、双子 125/126 互标（:80821-80841）。单人净空 = 表缺席,
   *  per-client 族退化为单掷直掉 */
  interactionSlots = new Set<number>();
  // 鞭 tag 态已于 1457 批 D 迁出（原 1456 单例 whipTagT/whipTagDmg/whipTagCrit/
  // whipTagItem/whipProcT/whipProcItem 六字段 + tick 递减退役）——1457 TagEffectStack
  // 挂玩家（Player.tagEffectStack,per-NPC 双表在栈内 Map）,查询走
  // owner.tagEffectStack.isNPCTagged(id)/canProcOnNPC(type,id)（★BJ514：anyTagged
  // 聚合查询退役——原版无此消费面）。 WhipProj 命中侧写入、
  // MinionProj/Arrow 命中侧消费。
  /** 原版 NPC 全体走 Collision.StepUp（NPC.cs:54382） */
  stepUp = true;
  stepUpHolds = true; stepUpNpc = true;   // holdsMatching + IgnoredByNpcStepUp（NPC.cs:54382 flag22 恒 true（飞行 AI 不走地面段））
  /** StepDown 门（TileCollision 'grounded' 缺省）：AI_007 TownCritter 置 'never'
   *  ——原版 flag22 恒 true（homeTileY=-1）使 StepDown 分支（NPC.cs:54373-54376）不可达 */
  stepDownGate: 'grounded' | 'gravity' | 'never' = 'grounded';
  // ---- 蠕虫多段体（AI_006，NPC.cs:18046）：头 aiStyle 6，编号约定 头+1=身 头+2=尾 ----
  /** 链上紧随本段的一段（头 → 身×n → 尾） */
  wormNext: Enemy | null = null;
  /** EoW 链总段数（头+体+尾,EaterOfWorldsProgressBar 恒定分母用——
   *  原版 maxLife = (GetEaterOfWorldsSegmentsCount()+2)×150,玩家杀段不缩分母;
   *  spawnWormChain 写入全链各段,断链拆分时各自继承原值） */
  eowChainMax = 0;
  /** 共享生命主段（NPC.realLife :6086;=null 即 -1 各自独立）。毁灭者族 134-136
   *  首帧建链时全链指向头（:50208-50222）——受击伤害传导扣主头、本段 hp 镜像
   *  （StrikeNPC :82132-82137）,段不可单独打死;EoW 族恒 null（:51524 realLife=-1
   *  各段独立 150HP）。WoF 113-115 用 wofNPCIndex（:26148）同语义由其 AI 自管 */
  realLifeHost: Enemy | null = null;
  /** 本段跟随的前一段（非空 = 本段是身体段，跳过 AI 只做跟随） */
  wormFollow: Enemy | null = null;
  /** 层序反转标记（骑手族 390/416：坐骑由骑手生成、原版槽序=坐骑画骑手【前】——
   *  与"部件画本体前"的 master 锚相反,排序时回落自然 y(骑手 y<坐骑 → 先画=在后)） */
  drawBehindMaster = false;
  /** 上一 tick 位置（段跟随用：段复制前一段的旧位置 = 经典贪吃蛇链） */
  prevX = 0;
  /** AI_003 卡死计数专用"上一拍移动前 X"（1457 oldPosition 语义，:93748 在
   *  position+=velocity 前采样）——fighterAI 移动前写、计数处读。★不可用 prevX：
   *  其在 fixedUpdate 头快照（=上一拍移动后值），计数时点 x===prevX 恒真 →
   *  计数恒 +1 永不衰减（R6-B 修正）。首值由 fromVanilla 置出生 x（首拍 +1=出生小跳） */
  fighterPrevX = 0;
  prevY = 0;
  /** EoW 掘地音效间隔（:52375-52395 soundDelay，距离/40 钳 10..20） */
  digSndDelay = 0;
  /** 蠕虫出生特效一次性门（117 水蛭爆尘/454 幻影龙音效,localAI 首帧哨兵） */
  _wormSpawnFx = false;
  /** 击杀时生效的 npc.boss 位（DropEoWLoot :79212-79228：场上再无 13/14/15 才置位；
   *  掉落门/图鉴/Boss 药水心共用。仅 EoW 三段非恒 true，其余 = def.boss） */
  killBossFlag = false;
  /** 被吸收钱币累计（WorldItem.GetPickedUpByMonsters_Money :1127-1219 写入;
   *  死亡掉钱时并入 NPC.cs:80497 `num += extraValue`）——R14-A3 */
  extraValue = 0;

  // ===================== 原版 npc.oldPos/oldRot 历史缓冲（DrawNPC 拖尾族） =====================
  // 原版 NPC.oldPos/oldRot 容量 10，UpdateNPC 头部整体后移一格 → oldPos[i] = i tick 前
  // 的左上角坐标。Main.cs DrawNPC 拖尾族读 0..9：蠕虫族 125-131（:24660 间隔 2 取 5 份）、
  // 火月怪 419（:24638 取 0..6 七份渐隐 + 帧行 5-7 循环）。
  // 定长预分配（性能审计"每帧分配热点"清单），零逐 tick 分配；联机傀儡路径同样推入
  // （fixedUpdate 头部早退分支内单独调用）——傀儡只有快照推进但拖尾同样需要历史。
  // 60 = TrailCacheLength[677]（NPCID.cs:4805，飞灵拖尾 num4=60-1-5=54 起步）；
  // 其余族原版缺省 10（NPC.cs:8390）——消费端全部自带 ≤10 的循环上限，不受影响。
  private static readonly HIST_N = 60;
  private histX = new Float64Array(Enemy.HIST_N);
  private histY = new Float64Array(Enemy.HIST_N);
  private histRot = new Float64Array(Enemy.HIST_N);
  private histHead = 0;   // 最新条目下标
  private histCount = 0;  // 已填条数（<10 时拖尾按实际深度截断）

  /** 原版 oldPos[l]=Vector2.Zero 整环清零（NPC.cs:50107-50111 猪鲨态10悬浮翻面支——
   *  防翻面瞬间残影跨图拖尾;case12 瞬移侧翻支 :50233 同款但 ai2==0 门恒假=死码,
   *  原版本相即拖尾,勿补）。只清位置不清 oldRot,与原版一致;histCount=0=拖尾按
   *  实际深度截断（等价于原版画在 (0,0) 屏外的不可见语义） */
  clearTrailHistory(): void {
    this.histX.fill(0);
    this.histY.fill(0);
    this.histCount = 0;
  }

  /** fixedUpdate 尾部推入当前快照（位置=左上角，旋转=visAngle≈npc.rotation） */
  private pushHistory(): void {
    this.histHead = (this.histHead + 1) % Enemy.HIST_N;
    if (this.histCount < Enemy.HIST_N) this.histCount++;
    this.histX[this.histHead] = this.x;
    this.histY[this.histHead] = this.y;
    this.histRot[this.histHead] = this.visAngle;
  }

  /** ★BJ175b（2026-09-20 用户实报"宝箱怪跳高无拖影"）：UpdateNPC_UpdateTrails 按
   *  NPCID.Sets.TrailingMode[type]（NPCID.cs:4769）分派（NPC.cs:91893-91992）——
   *  大宝箱怪 473-476 = mode 2：仅当 `(int)ai[0]==4 || ai[0]==5f || ai[0]==6f`
   *  （飞天 4/真俯冲 4.1【(int) 同值 :91918】/穿墙归位 5/三连扑 6——全部空中攻击态）
   *  逐拍后移记录 oldPos/oldRot；**其余态全部槽位写当前位置**（:91935-91942 else 支
   *  `for num5>=0: oldPos[num5]=position+netOffset, oldRot[num5]=rotation`——拖影清零）。
   *  ★BJ209（2026-09-20 全表普查推广）：mode 1/3/4/5/6/7 = 逐拍后移（pushHistory
   *  无条件推入即其等价实现）；**mode 0（439 拜月教邪教徒/440 僵尸教徒）= 隔拍记录**
   *  （:91899-91907 localAI[3] 节拍闸：≤0 → 置 2+后移记录，再每拍 −1——即第 0/2/4…
   *  拍记录，等效历史步长 2 拍），此前逐拍推入=拖影密度 ×2/跨度减半，已修。
   *  mode 2 是唯一带态门+整环写当前位置的档。整环 fill 后 histHead/histCount 不动——
   *  任意 histXAt(i) 都返回当前位置 = 原版清零同相（绘制端残影与本体重合不可见）。
   *  全登记表普查：NPCID.cs:4769 = 439/440→0、370/372/373/396/400/401→1、473-476→2、
   *  4/471/477/479→3、120/137/138→4、94→5、125-131/139/140/407/420/425/426/427/
   *  581/516/542-545/657→6、402/417/418/419/574/575/519/521/522/546/558/559/560/551/
   *  620/636/677/685→7；TrailCacheLength（:4809）覆写 402=36/519=20/522=20/620=20/
   *  677=60（685=10 缺省）。本仓 hist 环容量 60 全族够用（消费端循环上限 ≤20）。 */
  private recordTrailHistory(): void {
    const vid = this.vanillaId;
    if (vid === 473 || vid === 474 || vid === 475 || vid === 476) {
      const a = this.ai0;
      if (a === 4 || a === 4.1 || a === 5 || a === 6) {
        this.pushHistory();
      } else {
        this.histX.fill(this.x);
        this.histY.fill(this.y);
        this.histRot.fill(this.visAngle);
      }
    } else if (vid === 439 || vid === 440) {
      // mode 0（:91899-91907）：localAI[3] 节拍闸——≤0 时置 2 并后移记录，
      // 之后每拍递减；偶数拍记录（等效步长 2）。本仓以 trailParity 独立计数
      // （localAI[3] 槽位被 AI 语义占用，不共用）。
      if (this.trailParity <= 0) {
        this.trailParity = 2;
        this.pushHistory();
      }
      this.trailParity--;
    } else {
      this.pushHistory();
    }
  }

  /** mode 0 隔拍节拍闸（439/440 专用，:91899-91907 localAI[3] 语义等价） */
  private trailParity = 0;

  /** i tick 前的历史条数（拖尾最大可用深度） */
  historyDepth(): number { return this.histCount; }
  /** i tick 前的左上角 X（i 超出已填深度时取最旧条目） */
  histXAt(i: number): number {
    const d = Math.min(Math.max(0, i), this.histCount - 1);
    return this.histX[(this.histHead - d + Enemy.HIST_N * 2) % Enemy.HIST_N];
  }
  histYAt(i: number): number {
    const d = Math.min(Math.max(0, i), this.histCount - 1);
    return this.histY[(this.histHead - d + Enemy.HIST_N * 2) % Enemy.HIST_N];
  }
  /** i tick 前的自转角（原版 oldRot[i]） */
  histRotAt(i: number): number {
    const d = Math.min(Math.max(0, i), this.histCount - 1);
    return this.histRot[(this.histHead - d + Enemy.HIST_N * 2) % Enemy.HIST_N];
  }

  /** AI_006 头部（L18645 通用常数 maxSpd=8 accel=0.07；穿墙直行；段链跟随） */
  private wormAI(game: GameHooks, player: Player | null) {
    // EoW 三段（13/14/15）走专属核（realLife=-1 各段独立 + 断链拆分，:51524-51914）
    if (this.vanillaId !== null && this.vanillaId >= 13 && this.vanillaId <= 15) {
      this.eowAI(game, player);
      return;
    }
    // 水蛭 117 出生爆尘+音（:51357-51370 localAI[1]==0 首帧）：NPCDeath13 + 20 尘
    // （原版 velocity*3 定向散——本仓 opts 无 vx/vy,用 spawnBurst 定向近似（若不可用
    //  回退全向）;2026-08-18 修 tsc: opts 恒不认 vx）
    if (this.vanillaId === 117 && this.ai1 === 0 && !this._wormSpawnFx) {
      this._wormSpawnFx = true;
      game.playSfxFiles?.(['NPC_Killed_13'], 1, this.cx, this.cy);
      const dir = this.vx < 0 ? Math.PI : 0;   // 朝速度反方向喷
      if (game.spawnBurst) {
        game.spawnBurst(this.cx, this.cy, '#B0A080', 20, 3, dir, Math.PI, { life: 30 });
      } else {
        game.spawnParticles(this.cx, this.cy, '#B0A080', 20, 1, { life: 30 });
      }
    }
    // 幻影龙 454 出生音（:51372-51376 localAI[3]==0 首帧）：Item119
    if (this.vanillaId === 454 && !this._wormSpawnFx) {
      this._wormSpawnFx = true;
      game.playSfxFiles?.(['Item_119'], 1, this.cx, this.cy);
    }
    // ---- 血鳗鱼 621 首帧建链（NPC.cs:51672-51690，type==621 && ai[0]==0 门）：
    //      15×身(622) + 1×尾(623) 共 16 段，逐段 NewNPC 于头位（Bottom 锚），
    //      ai[3]=头/realLife=头（共享 6000 总血——段受击传导扣头）。本仓以
    //      spawnWormChain(…, sharedLife) 等价（wormNext/wormFollow 直引用替 ai 槽位）；
    //      出生即全链 spawnAlpha=255（渐显门 :51399-51421，见 fixedUpdate 尾段） ----
    if (this.vanillaId === 621 && !this._wormSpawnFx) {
      this._wormSpawnFx = true;   // ai[0]==0（未建链哨兵）等价：本仓 ai0 不复用槽位语义
      const segs = Enemy.spawnWormChain(this, 16,
        Array.from({ length: 16 }, (_, k) => (k === 15 ? 623 : 622)), true);
      for (const s of segs) addEnemy(game, s);
    }
    // ---- 402 星尘织带蠕虫 ai[2] 生命计时（NPC.cs:51402-51461，1:1）----
    // ai[2] 每 tick +1；285→570 速度 ×1→×0.5（Remap 线性减速）；恰 570 时
    // 50 尘暴（尘 180/176 各 50% 掷、noGravity、NextVector2Circular(8,8) 初速）
    // + SpawnStardustMark_StardustWorm（:44230-44314 弹 540 孵化标记 BFS 链 →
    //   星尘生物链，StardustMarkProj.spawnStardustMarks 已接）+ 速度归一化 ×6 冲刺
    //   （原版序：先孵化标记后冲刺，:51455-51458）；≥600 ai[2] 归零
    // 重开（★不自灭——渐隐由渲染端 num291/drawPrettyStarSparkle 同链消费）。
    // ★置于玩家死亡早退【前】：原版 type 段（:51402）在 target 检查（:51532）
    // 之前——玩家死亡 ai2 计时照走（曾误放早退后：玩家被磨死即冻结、渐隐链断）。
    if (this.vanillaId === 402) {
      this.ai2 += 1;
      const LIFE = 600, LIFE_LAST = 570;               // num3/num4（:51404-51405）
      const spd = Math.hypot(this.vx, this.vy);
      if (spd >= 1 && this.ai2 <= LIFE_LAST) {
        // velocity *= Remap(ai2, 285, 570, 1, 0.5)（clamped 线性）
        const half = LIFE_LAST * 0.5;
        const k = this.ai2 <= half ? 1
          : this.ai2 >= LIFE_LAST ? 0.5 : 1 - 0.5 * (this.ai2 - half) / (LIFE_LAST - half);
        this.vx *= k; this.vy *= k;
      }
      if (this.ai2 === LIFE_LAST) {
        // 尘 180=星尘深蓝(贴图帧均色 51,75,190)/176=星尘浅蓝白(176,194,215)
        for (let d = 0; d < 50; d++) {
          game.spawnParticles(this.cx, this.cy,
            Math.random() < 0.5 ? '#334BBE' : '#B0C2D7',
            1, 1.3 + Math.random() * 2, { life: 30, damp: 0.97 });
        }
        // SpawnStardustMark_StardustWorm（:44230-44314，先于冲刺 :51455-51458）：
        // 孵化池 405/406<2 ∪ 402<3 ∪ 407<1 随机选一 → BFS 世代标记弹 540 链，
        // 末端标记淡入破零时于 (Center.X, Bottom.Y) 孵化（StardustMarkProj）
        spawnStardustMarks(game, this.cx, this.cy, 'worm');
        if (spd > 0) { this.vx = (this.vx / spd) * 6; this.vy = (this.vy / spd) * 6; }
      }
      if (this.ai2 >= LIFE) this.ai2 = 0;
    }
    // 玩家死亡（:51532-51539）：TargetClosest 落空 → EncourageDespawn(300) 缓慢消散
    // （EoW flag=false 不加速下钻——靠 despawn 系统离屏倒数收尾）
    if (!player) {
      this.encourageDespawn(300);
      this.vx *= 0.97; this.vy *= 0.97;
      this.x += this.vx; this.y += this.vy;
      this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI * 0.5;
      return;
    }
    // ---- 地下蠕虫 flag 型脱战（:51506-51546，2026-08-17 仇恨审计补）----
    //  flag 表：10/39/95/117/510（地下蠕虫）恒 true 且 num11=0.2；513 玩家不在
    //  地下沙漠 → true 且 num11=0.1；621 恒 false。玩家死亡 || (flag && 玩家升到
    //  地表之上) → EncourageDespawn(300) + flag 时下潜 velocity.Y += num11
    const wormFlagType = this.vanillaId === 10 || this.vanillaId === 39 || this.vanillaId === 95
      || this.vanillaId === 117 || this.vanillaId === 510;
    const wormFlag = wormFlagType || (this.vanillaId === 513
      && !game.world.scene?.zoneUndergroundDesert);
    const wormDive = wormFlagType ? 0.2 : this.vanillaId === 513 ? 0.1 : 0;
    const playerAboveSurface = player.cy < game.world.groundLevel * TILE;
    if (player.dead || (wormFlag && playerAboveSurface)) {
      this.encourageDespawn(300);
      if (wormFlag) this.vy += wormDive;
    }
    // 621（血鳗鱼头，BloodEelHead——Dune Splicer 是 510-512；曾误注）白天
    // → EncourageDespawn(60) + vy += 1（:51541-51544）
    if (this.vanillaId === 621 && game.world.clock.isDay) {
      this.encourageDespawn(60);
      this.vy += 1;
    }
    // ---- 血鳗鱼 621 头 1:1 舵机（:52124-52127 num46=15/num47=0.45 + :52403-52408
    //      16px 格吸附目标 + :52545-52550 理想速度 = dir×num46 + :52628-52659
    //      621 专属 agitation（反向增速阈 120 + 位于玩家下方爬升）+ :52660-52747
    //      逐轴 ±num47/1.1×num47 逼近理想速度）——621 恒 flag3（:52100-52102）----
    if (this.vanillaId === 621 && player) {
      const num46 = 15, num47 = 0.45;
      // :52403-52408：目标/自身中心均 16px 格吸附后再作差
      const snap = (v: number): number => Math.floor(v / TILE) * TILE;
      let num49 = snap(player.cx) - snap(this.cx);
      let num50 = snap(player.cy) - snap(this.cy);
      const d63 = Math.hypot(num49, num50) || 1;
      const n68 = num46 / d63;
      num49 *= n68; num50 *= n68;                 // :52545-52550 理想速度
      let flag8 = false;                          // :52628-52659 反向 agitation（621 阈 120）
      if (((this.vx > 0 && num49 < 0) || (this.vx < 0 && num49 > 0)
        || (this.vy > 0 && num50 < 0) || (this.vy < 0 && num50 > 0))
        && Math.abs(this.vx) + Math.abs(this.vy) > num47 / 2 && d63 < 120) {
        flag8 = true;
        if (Math.abs(this.vx) + Math.abs(this.vy) < num46) { this.vx *= 1.1; this.vy *= 1.1; }
      }
      if (this.y > player.y || player.dead) {     // :52643 position.Y 比较（R6-B 对齐，曾用中心）
        flag8 = true;
        if (Math.abs(this.vx) < num46 / 2) {
          if (this.vx === 0) this.vx -= this.facing;
          this.vx *= 1.1;
        } else if (this.vy > -num46) {
          this.vy -= num47;
        }
      }
      if (!flag8) {
        const n66 = Math.abs(num49), n67 = Math.abs(num50);
        if ((this.vx > 0 && num49 > 0) || (this.vx < 0 && num49 < 0)
          || (this.vy > 0 && num50 > 0) || (this.vy < 0 && num50 < 0)) {
          // :52660-52701：同向轴逐轴 ±num47 逼近 + 近平轴反向的垂直助推 ×2
          if (this.vx < num49) this.vx += num47;
          else if (this.vx > num49) this.vx -= num47;
          if (this.vy < num50) this.vy += num47;
          else if (this.vy > num50) this.vy -= num47;
          if (Math.abs(num50) < num46 * 0.2 && ((this.vx > 0 && num49 < 0) || (this.vx < 0 && num49 > 0))) {
            this.vy += this.vy > 0 ? num47 * 2 : -num47 * 2;
          }
          if (Math.abs(num49) < num46 * 0.2 && ((this.vy > 0 && num50 < 0) || (this.vy < 0 && num50 > 0))) {
            this.vx += this.vx > 0 ? num47 * 2 : -num47 * 2;
          }
        } else if (n66 > n67) {
          // :52703-52724：X 主导 → X 以 1.1×num47 逼近，总速 <num46/2 时推 Y
          if (this.vx < num49) this.vx += num47 * 1.1;
          else if (this.vx > num49) this.vx -= num47 * 1.1;
          if (Math.abs(this.vx) + Math.abs(this.vy) < num46 * 0.5) {
            this.vy += this.vy > 0 ? num47 : -num47;
          }
        } else {
          // :52725-52746：Y 主导 → Y 以 1.1×num47 逼近，总速 <num46/2 时推 X
          if (this.vy < num50) this.vy += num47 * 1.1;
          else if (this.vy > num50) this.vy -= num47 * 1.1;
          if (Math.abs(this.vx) + Math.abs(this.vy) < num46 * 0.5) {
            this.vx += this.vx > 0 ? num47 : -num47;
          }
        }
      }
      this.facing = this.vx > 0 ? 1 : -1;
      this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI * 0.5;   // :52749
      this.x += this.vx; this.y += this.vy;                            // noTileCollide 直移
    }
    if (this.vanillaId !== 621) {
    // ---- AI_006 通用头核（1457 :52069-52798）R6-B 3-1/3-2 重写：入地(flag3)/出地
    // 两态 + 逐型速度表。旧"单一朝玩家加速限速舵机"退役——出地蠕虫应重力坠机
    // （vy+=0.11 钳 num46、三段横漂），入地才走逐轴逼近舵机。13-15 走 eowAI
    // （自带两态）；621 走上方专属舵机 ----
    const vidW = this.vanillaId ?? 0;
    // 速度表（:52218-52321）
    let num46 = 8, num47 = 0.07;
    if (vidW === 95) { num46 = 5.5; num47 = 0.045; }           // 食世者（World Feeder）
    else if (vidW === 10) { num46 = 6; num47 = 0.05; }         // 巨型吞噬怪
    else if (vidW === 513) { num46 = 7; num47 = 0.1; }         // 墓穴爬虫
    else if (vidW === 7) { num46 = 9; num47 = 0.1; }           // 吞噬怪
    else if (vidW === 510) {                                   // 沙虫（Tomb Crawler）
      if (!player.dead && game.world.scene?.zoneSandstorm) { num46 = 16; num47 = 0.35; }
      else { num46 = 10; num47 = 0.25; }
    } else if (vidW === 87) { num46 = 11; num47 = 0.25; }      // 飞龙
    else if (vidW === 375) { num46 = 6; num47 = 0.15; }        // 松露虫
    else if (vidW === 454) { num46 = 20; num47 = 0.55; }       // 沙虫头（Dune Splicer）
    else if (vidW === 402) { num46 = 9; num47 = 0.3; }         // 星尘织带蠕虫
    else if (vidW === 117) {
      // 水蛭：血肉墙在场按其血量三档激怒（:52293-52311）
      const wofBody = (game.enemies() as Enemy[]).find((n) => n.vanillaId === 113 && !n.dead);
      if (wofBody) {
        const r = wofBody.hp / wofBody.maxHp;
        if (r < 0.5) { num46 += 1; num47 += 0.1; }
        if (r < 0.25) { num46 += 1; num47 += 0.1; }
        if (r < 0.1) { num46 += 2; num47 += 0.1; }
      }
    } else if (vidW === 39) {                                  // 骨蛇
      num46 = 9; num47 = 0.1;
      if (game.world.seedFlags?.getGoodWorld) { num46 = 10; num47 = 0.12; }   // :52316-52320
    }
    // flag3 入地判定（:52089-52163）
    let flag3 = (vidW >= 87 && vidW <= 92) || (vidW >= 454 && vidW <= 459)
      || (vidW >= 621 && vidW <= 623) || (vidW >= 412 && vidW <= 414) || vidW === 402;
    if (!flag3) {
      // AABB 外扩（左/上 -1、右/下 +2）扫实心/液体>64 与身体盒相交（:52069-52140）
      const stW = game.world.store;
      const x0 = Math.max(0, Math.floor(this.x / TILE) - 1);
      const x1 = Math.min(stW.w - 1, Math.floor((this.x + this.w) / TILE) + 2);
      const y0 = Math.max(0, Math.floor(this.y / TILE) - 1);
      const y1 = Math.min(stW.h - 1, Math.floor((this.y + this.h) / TILE) + 2);
      for (let tx = x0; tx <= x1 && !flag3; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          const ii = stW.idx(tx, ty);
          // nactive() && (tileSolid || solidTop frameY==0) ≈ active 位 + isSolid
          // （平台 frameY≠0 不计——与 eowAI 埋地扫描同式）
          const tileSolidHere = (stW.flags[ii] & 1) !== 0 && stW.isSolid(tx, ty);
          if ((tileSolidHere || stW.liquid[ii] > 64)
            && this.x + this.w > tx * TILE && this.x < tx * TILE + TILE
            && this.y + this.h > ty * TILE && this.y < ty * TILE + TILE) {
            flag3 = true;
            break;
          }
        }
      }
      // 玩家 1000px 内无活人 → 视作入地（:52142-52162；单人=目标玩家，原版不查 dead）
      if (!flag3 && (vidW === 7 || vidW === 10 || vidW === 39 || vidW === 95
        || vidW === 98 || vidW === 117 || vidW === 375 || vidW === 454
        || vidW === 510 || vidW === 513)) {
        const far = player.x + player.w < this.x - 1000 || player.x > this.x + this.w + 1000
          || player.y + player.h < this.y - 1000 || player.y > this.y + this.h + 1000;
        if (far) flag3 = true;
      }
    }
    // 目标 Δ（:52403-52408 双方中心 16px 格吸附；375 反向逃离 :52409-52413）
    const snapW = (v: number): number => Math.floor(v / TILE) * TILE;
    let num49 = snapW(player.cx) - snapW(this.cx);
    let num50 = snapW(player.cy) - snapW(this.cy);
    if (vidW === 375) { num49 = -num49; num50 = -num50; }
    const distRaw = Math.hypot(num49, num50);
    if (!flag3) {
      // 出地：重力坠机（:52473-52521）——39 上升段 +0.08，余 +0.11 钳 num46；
      // |v|<0.4num46 → vx 沿原方向 ±1.1num47；触底(vy==num46) → vx 逐 num47 逼近
      // 目标；vy>4 → vx ∓0.9num47 减横速
      if (vidW === 39 && this.vy < 0) this.vy += 0.08;
      else this.vy += 0.11;
      if (this.vy > num46) this.vy = num46;
      if (Math.abs(this.vx) + Math.abs(this.vy) < num46 * 0.4) {
        if (this.vx < 0) this.vx -= num47 * 1.1;
        else this.vx += num47 * 1.1;
      } else if (this.vy === num46) {
        if (this.vx < num49) this.vx += num47;
        else if (this.vx > num49) this.vx -= num47;
      } else if (this.vy > 4) {
        if (this.vx < 0) this.vx += num47 * 0.9;
        else this.vx -= num47 * 0.9;
      }
      this.facing = this.vx > 0 ? 1 : -1;
      this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI * 0.5;   // :52749
      this.x += this.vx; this.y += this.vy;                            // noTileCollide 直移
    } else {
      // 入地态：掘地音（:52524-52544，仅入地；排除 621/87/117/454/412；间隔 =
      // 距离/40 钳 10..20；13-15 用 EOWDiggin——本族走 eowAI 不达）
      if (vidW !== 621 && vidW !== 87 && vidW !== 117 && vidW !== 454 && vidW !== 412) {
        if (this.digSndDelay <= 0) {
          this.digSndDelay = Math.round(Math.min(20, Math.max(10, distRaw / 40)));
          game.playSfxWav?.('Roar_1', 1, this.cx, this.cy);
        } else {
          this.digSndDelay--;
        }
      }
      // 理想速度 = Δ 归一 × num46（:52545-52550）
      let tx49 = num49, ty50 = num50;
      const d63 = Math.hypot(num49, num50);
      if (d63 > 0) { tx49 = (num49 / d63) * num46; ty50 = (num50 / d63) * num46; }
      // flag6 出生态脱战（:52551-52563）：7 目标不在腐化/猩红（或死）/513·510 目标
      // 升地表且非沙暴/地下沙漠（或死）
      let flag6 = false;
      if (vidW === 7 && (!game.world.scene?.zoneCorrupt && !game.world.scene?.zoneCrimson
        || player.dead)) flag6 = true;
      if ((vidW === 513 || vidW === 510)
        && (player.y / TILE < game.world.groundLevel
          && !game.world.scene?.zoneSandstorm && !game.world.scene?.zoneUndergroundDesert
          || player.dead)) flag6 = true;
      if (flag6) {
        // 全图无腐化区存活玩家（:52564-52598，原版扫全体玩家——单人等价）→
        // 深度过岩层中线整链清除（active=false 无掉落）；否则目标改直下潜
        if (!game.world.scene?.zoneCorrupt) {
          if (this.cy / TILE > (game.world.rockLevel + game.world.h) / 2) {
            for (let s: Enemy | null = this; s; s = s.wormNext) s.dead = true;
            return;
          }
          tx49 = 0; ty50 = num46;
        }
      }
      // flag8 折返增速（:52600-52659）：87（阈 300）/454（阈 300）背向目标且
      // |v|>num47/2 → |v|<num46 时 ×1.1；位于玩家上方（position.Y 比较）→
      // |vx|<num46/2 时（零速先 −direction）vx×1.1，否则 vy>−num46 时 vy−=num47
      let flag8 = false;
      if (vidW === 87 || vidW === 454) {
        if (((this.vx > 0 && num49 < 0) || (this.vx < 0 && num49 > 0)
          || (this.vy > 0 && num50 < 0) || (this.vy < 0 && num50 > 0))
          && Math.abs(this.vx) + Math.abs(this.vy) > num47 / 2 && distRaw < 300) {
          flag8 = true;
          if (Math.abs(this.vx) + Math.abs(this.vy) < num46) { this.vx *= 1.1; this.vy *= 1.1; }
        }
        // 87：Center.Y 比较或玩家在地表上（:52611-52612）；454：position.Y 比较（:52643）
        const belowPlayer = vidW === 87
          ? (this.cy > player.cy || player.y / TILE > game.world.groundLevel || player.dead)
          : (this.y > player.y || player.dead);
        if (belowPlayer) {
          flag8 = true;
          if (Math.abs(this.vx) < num46 / 2) {
            if (this.vx === 0) this.vx -= this.facing;
            this.vx *= 1.1;
          } else if (this.vy > -num46) {
            this.vy -= num47;
          }
        }
      }
      if (!flag8) {
        // 舵机（:52660-52747）：同向 → 双轴逐 num47 逼近 + 近平轴反向助推 ×2；
        // 横主导 → vx 以 1.1×num47 逼近 + |v|<num46/2 时沿当前 vy 方向推；纵主导对称
        const n66 = Math.abs(tx49), n67 = Math.abs(ty50);
        if ((this.vx > 0 && tx49 > 0) || (this.vx < 0 && tx49 < 0)
          || (this.vy > 0 && ty50 > 0) || (this.vy < 0 && ty50 < 0)) {
          if (this.vx < tx49) this.vx += num47;
          else if (this.vx > tx49) this.vx -= num47;
          if (this.vy < ty50) this.vy += num47;
          else if (this.vy > ty50) this.vy -= num47;
          if (Math.abs(ty50) < num46 * 0.2 && ((this.vx > 0 && tx49 < 0) || (this.vx < 0 && tx49 > 0))) {
            this.vy += this.vy > 0 ? num47 * 2 : -num47 * 2;
          }
          if (Math.abs(tx49) < num46 * 0.2 && ((this.vy > 0 && ty50 < 0) || (this.vy < 0 && ty50 > 0))) {
            this.vx += this.vx > 0 ? num47 * 2 : -num47 * 2;
          }
        } else if (n66 > n67) {
          if (this.vx < tx49) this.vx += num47 * 1.1;
          else if (this.vx > tx49) this.vx -= num47 * 1.1;
          if (Math.abs(this.vx) + Math.abs(this.vy) < num46 * 0.5) {
            this.vy += this.vy > 0 ? num47 : -num47;
          }
        } else {
          if (this.vy < ty50) this.vy += num47 * 1.1;
          else if (this.vy > ty50) this.vy -= num47 * 1.1;
          if (Math.abs(this.vx) + Math.abs(this.vy) < num46 * 0.5) {
            this.vx += this.vx > 0 ? num47 : -num47;
          }
        }
      }
      this.facing = this.vx > 0 ? 1 : -1;
      this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI * 0.5;   // :52749
      this.x += this.vx; this.y += this.vy;                            // noTileCollide 直移
    }
    }
    // 段链跟随（原版 L52271-52308）：方向向量收缩维持 linkDist 间距——
    // shrink = (dist - linkDist)/dist；position += dxC*shrink（原版 num63/num64）
    for (let s = this.wormNext; s; s = s.wormNext) {
      const fx = s.wormFollow!;
      const dxC = fx.cx - s.cx;
      const dyC = fx.cy - s.cy;
      const dist = Math.hypot(dxC, dyC);
      if (dist > 0.01) {
        // 链距覆写表（NPC.cs:52279-52303，num64 以【段自身】type/width 判定——本循环
        // 的 s 即原版跑该段的 NPC）：87-92 飞龙→42（:52280-52283）、454-459 幻影龙→36
        // （:52284-52287）、513-515 墓穴爬虫→w−6（:52288-52291）、621-623 血鳗鱼→24
        // （:52296-52299）；412-414 爬尾虫→w+6 在专属核 crawltipedeAI（bossAI_lunar_misc，
        // :52292-52295）；getGoodWorld 13-15 EoW→62 在 eowAI（:52300-52303）；其余族 =
        // 段自身 width（:52279）。曾只补 621-623，其余族误用 s.w（2026-08-21 复审 P3②）
        const vid = s.vanillaId ?? 0;
        let linkDist = s.w;
        if (vid >= 87 && vid <= 92) linkDist = 42;
        else if (vid >= 454 && vid <= 459) linkDist = 36;
        else if (vid >= 513 && vid <= 515) linkDist -= 6;
        else if (vid >= 621 && vid <= 623) linkDist = 24;
        const shrink = (dist - linkDist) / dist;
        s.x += dxC * shrink;
        s.y += dyC * shrink;
        // spriteDirection 仅 87-92/454-459/621-623 三族在此块翻转（:52310-52320，
        // num49<0→1 / >0→-1）；本仓 aiStyle6 段渲染走 rotationDriven（Renderer 通用
        // 镜像门跳过 facing）故对渲染惰性——保留全族写值，不改变现有观感
        s.facing = dxC < 0 ? 1 : -1;
      }
      // 段旋转 = 指向前一段的方向（= 本段行进切向，与原版段速度角等价）
      if (dist > 0.01) s.visAngle = Math.atan2(dyC, dxC) + Math.PI * 0.5;
    }
  }

  /** EoW 族（13/14/15，NPC.cs:51357-52671 专属语义；SetDefaults :8835-8894 各段
   *  独立 150HP、realLife=-1 :51524-51527——无整链共享生命）。
   *  断链拆分（:51874-51914，逐 tick 各段自查邻段）：
   *  - 两邻全灭 / 头(13)的下段灭 / 尾(15)的前段灭 → 自灭（走标准死亡管线=checkDead）；
   *  - 身段(14)前段灭 → Transform(13)（:51906-51909）晋升新头，断开 wormFollow；
   *  - 身段(14)后段灭 → Transform(15)（:51910-51913）收成新尾，断开 wormNext；
   *  → 杀中段把一条虫拆成两条独立虫；杀头不灭虫（下段即晋升新头）。
   *  头速度双模（:52091-52104）：num46=10/num47=0.07，专家 12/0.15，FTW +4/+0.05——
   *  埋地（AABB 外扩 1-2 格实心/液体>64 :51968-51992，玩家距 >1000px 亦视作埋地
   *  :51993-52014）走全向舵（:52511-52597）；空中 vy+=0.11 钳 num46 + 三档横漂不转向
   *  （:52324-52371）。离开腐化下潜（:52402-52450）：目标玩家 !ZoneCorrupt&&!ZoneCrimson
   *  （或死）→ 直向下潜，y > (rockLevel+h)/2 整链清除（无掉落无记账）。
   *  专家毒唾 666（:51468-51504）；掘地音效（:52375-52395 间隔=距离/40 钳 10..20）。 */
  private eowAI(game: GameHooks, _player: Player | null): void {
    const st = game.world.store;
    const w = game.world;
    // 原版 target 即便玩家死亡仍指向其槽位（:51532 TargetClosest 后舵机照用其坐标）
    // M11：target 槽 = 本帧索敌目标（联机可为访客代理），无目标史回退本地
    const tgt = this.targetRef(game);
    if (!tgt) return;
    // ---- 链维护（:51874-51914）----
    const linkAlive = (s: Enemy | null): boolean =>
      !!s && !s.dead && s.vanillaId !== null && s.vanillaId >= 13 && s.vanillaId <= 15;
    const prevOk = linkAlive(this.wormFollow), nextOk = linkAlive(this.wormNext);
    if (!prevOk && !nextOk) { this.die(game); return; }                   // :51876-51885 两邻全灭
    const kind0 = this.vanillaId ?? 0;
    if (kind0 === 13 && !nextOk) { this.die(game); return; }              // :51886-51895 头的下段灭
    if (kind0 === 15 && !prevOk) { this.die(game); return; }              // :51896-51905 尾的前段灭
    if (kind0 === 14) {
      if (!prevOk) {
        // :51906-51909 Transform(13, ai[0])：晋升新头（SetDefaults(13) 换头属性/贴图，
        // HP 按比例结转；三段 lifeMax 同为 150 → 原值保留）
        if (this.wormFollow) this.wormFollow.wormNext = null;
        this.wormFollow = null;
        this.transformTo(13, st, true, game);
      } else if (!nextOk) {
        // :51910-51913 Transform(15, 0, ai[1])：收成新尾
        if (this.wormNext) this.wormNext.wormFollow = null;
        this.wormNext = null;
        this.transformTo(15, st, true, game);
      }
    }
    // ---- 专家毒唾 666（:51468-51504）----
    const id = this.vanillaId ?? 0;
    if (w.isExpert && tgt) {
      if (id === 14 && (this.cy / TILE < w.groundLevel || w.seedFlags?.getGoodWorld)) {
        // :51470-51489 身段仅地表（中心格无墙）1/900 掷（FTW 1/450）
        const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
        if (st.inBounds(tx, ty) && st.wall[st.idx(tx, ty)] === 0
          && Math.floor(Math.random() * (w.seedFlags?.getGoodWorld ? 450 : 900)) === 0) {
          this.eowSpit(game, tgt);
        }
      } else if (id === 13) {
        // :51491-51503 头段 1/(90 + life/lifeMax×300) 掷
        const denom = 90 + Math.floor((this.hp / this.maxHp) * 300);
        if (Math.floor(Math.random() * denom) === 0) this.eowSpit(game, tgt);
      }
    }
    // ---- 身/尾段（ai[1]>0 → :52266-52321）：朝前段收缩维持链距（num64=width）----
    if (this.wormFollow) {
      const fx = this.wormFollow;
      const dxC = fx.cx - this.cx, dyC = fx.cy - this.cy;
      const dist = Math.hypot(dxC, dyC);
      if (dist > 0.01) {
        // :52300-52302 getGoodWorld 且 type∈13-15 → num64=62（段间距拉宽）；其余蠕虫族不覆写
        const vid = this.vanillaId ?? 0;
        const gap = (w.seedFlags?.getGoodWorld && vid >= 13 && vid <= 15) ? 62 : this.w;
        const shrink = (dist - gap) / dist;
        this.x += dxC * shrink;
        this.y += dyC * shrink;
        this.visAngle = Math.atan2(dyC, dxC) + Math.PI / 2;
      }
      this.vx = 0; this.vy = 0;   // :52307 velocity = Vector2.Zero
      return;
    }
    // ---- 头段 ----
    // 玩家死（:51536-51543，EoW flag=false 不加速下钻）：离屏倒数消散
    if (tgt.dead) this.encourageDespawn(300);
    // 常数（:52091-52104）
    let maxSpd = 10, acc = 0.07;
    if (w.isExpert) { maxSpd = 12; acc = 0.15; }
    if (w.seedFlags?.getGoodWorld) { maxSpd += 4; acc += 0.05; }
    // 埋地判定 flag3（:51968-51992）：AABB 外扩 1-2 格内实心块或液体>64
    let buried = false;
    const tx0 = Math.max(0, Math.floor(this.x / TILE) - 1);
    const tx1 = Math.min(st.w - 1, Math.floor((this.x + this.w) / TILE) + 2);
    const ty0 = Math.max(0, Math.floor(this.y / TILE) - 1);
    const ty1 = Math.min(st.h - 1, Math.floor((this.y + this.h) / TILE) + 2);
    for (let x = tx0; x <= tx1 && !buried; x++) {
      for (let y = ty0; y <= ty1; y++) {
        const i = st.idx(x, y);
        if (((st.flags[i] & 1) !== 0 && st.isSolid(x, y)) || st.liquid[i] > 64) {
          if (this.x + this.w > x * TILE && this.x < x * TILE + 16
            && this.y + this.h > y * TILE && this.y < y * TILE + 16) { buried = true; break; }
        }
      }
    }
    // :51993-52014 无玩家外扩矩形相交（>1000px）→ 视作埋地（远离时照走地下舵机）
    if (!buried && (tgt.dead
      || Math.abs(tgt.cx - this.cx) > 1000 + this.w
      || Math.abs(tgt.cy - this.cy) > 1000 + this.h)) buried = true;
    // 朝向分量（:52173-52259 tile 吸附差值）
    const dx = Math.floor(tgt.cx / TILE) * TILE - Math.floor(this.cx / TILE) * TILE;
    const dy = Math.floor(tgt.cy / TILE) * TILE - Math.floor(this.cy / TILE) * TILE;
    const dist = Math.hypot(dx, dy);
    if (!buried) {
      // 空中（:52324-52371）：vy+=0.11 钳 num46；三档横漂（不主动转向）
      this.vy += 0.11;
      if (this.vy > maxSpd) this.vy = maxSpd;
      if (Math.abs(this.vx) + Math.abs(this.vy) < maxSpd * 0.4) {
        this.vx += this.vx < 0 ? -acc * 1.1 : acc * 1.1;
      } else if (this.vy === maxSpd) {
        if (this.vx < dx) this.vx += acc;
        else if (this.vx > dx) this.vx -= acc;
      } else if (this.vy > 4) {
        this.vx += this.vx < 0 ? acc * 0.9 : -acc * 0.9;
      }
    } else {
      // 掘地/咆哮音效（:52375-52395）：间隔 = num63/40 钳 10..20；
      // EoW 三段(13-15) = eow_dig 专属轨；【其余蠕虫族 = SoundID 15 Roar】——
      // 骨蛇 39-41/食世者等接近时的周期咆哮(用户报"骨龙接近有音效",2026-08-18)；
      // 排除表 621/87/117/454/412 不发声；EoW 另有 skyblock lowTiles 门(不涉)
      const isEow = (this.vanillaId ?? 0) >= 13 && (this.vanillaId ?? 0) <= 15;
      const digSndType = [621, 87, 117, 454, 412].includes(this.vanillaId ?? -1);
      if (!digSndType && this.digSndDelay <= 0) {
        this.digSndDelay = Math.round(Math.min(20, Math.max(10, dist / 40)));
        game.playSfx(isEow ? 'eowDig' : 'roar', 1, this.cx, this.cy);
      } else {
        this.digSndDelay--;
      }
      if (Math.random() < 0.02) {
        game.spawnParticles(this.cx, this.cy, '#7A5A3C', 1, 0.9, { life: 28, damp: 0.96, grav: 0.06 });
      }
      // 目标速度（:52396-52401 归一到 num46 模长）
      let tvx = dx, tvy = dy;
      const d2 = Math.hypot(tvx, tvy) || 1;
      tvx = (tvx / d2) * maxSpd;
      tvy = (tvy / d2) * maxSpd;
      // 离开腐化下潜（:52402-52450）：目标 !ZoneCorrupt && !ZoneCrimson（或死）→ 直下潜。
      // 原版另有 flag7 多玩家扫描（任一存活玩家在腐化即不潜，:52417-52424）——
      // 单人等价于目标自身，联机 Boss 权威在房主，略（登记）
      const scene = w.scene;
      const zoneOk = scene == null ? true : (scene.zoneCorrupt || scene.zoneCrimson);
      if (tgt.dead || !zoneOk) {
        if (this.cy / TILE > (w.rockLevel + w.h) / 2) {
          // :52427-52446 深度达标：头 + 后继链整体清除（active=false，无掉落无记账）
          this.bossFled = true;
          for (let s: Enemy | null = this; s; s = s.wormNext) s.dead = true;
          return;
        }
        tvx = 0; tvy = maxSpd;   // :52447-52449
      }
      // 全向舵（:52511-52597，与毁灭者地下核同构）
      const sameX = (this.vx > 0 && tvx > 0) || (this.vx < 0 && tvx < 0);
      const sameY = (this.vy > 0 && tvy > 0) || (this.vy < 0 && tvy < 0);
      // :52513 首分支 = 四条件【跨轴 OR】(sameX || sameY)——单轴同向即走温和支；
      // 曾抄成 &&（毁灭者 :50481/:50500 才是 &&/|| 双块结构，勿混）
      if (sameX || sameY) {
        if (this.vx < tvx) this.vx += acc; else if (this.vx > tvx) this.vx -= acc;
        if (this.vy < tvy) this.vy += acc; else if (this.vy > tvy) this.vy -= acc;
        if (Math.abs(tvy) < maxSpd * 0.2 && ((this.vx > 0 && tvx < 0) || (this.vx < 0 && tvx > 0))) {
          this.vy += this.vy > 0 ? acc * 2 : -acc * 2;
        }
        if (Math.abs(tvx) < maxSpd * 0.2 && ((this.vy > 0 && tvy < 0) || (this.vy < 0 && tvy > 0))) {
          this.vx += this.vx > 0 ? acc * 2 : -acc * 2;
        }
      } else if (Math.abs(dx) > Math.abs(dy)) {
        if (this.vx < tvx) this.vx += acc * 1.1; else if (this.vx > tvx) this.vx -= acc * 1.1;
        if (Math.abs(this.vx) + Math.abs(this.vy) < maxSpd * 0.5) {
          this.vy += this.vy > 0 ? acc : -acc;
        }
      } else {
        if (this.vy < tvy) this.vy += acc * 1.1; else if (this.vy > tvy) this.vy -= acc * 1.1;
        if (Math.abs(this.vx) + Math.abs(this.vy) < maxSpd * 0.5) {
          this.vx += this.vx > 0 ? acc : -acc;
        }
      }
    }
    // :52600 rotation = 速度角 + π/2（贴图正面朝上）
    this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI / 2;
    this.x += this.vx;
    this.y += this.vy;
  }

  /** 专家毒唾 666（:51483-51501）：CanHitLine(本体中心,1,1,玩家中心,1,1) 才出膛，
   *  弹体落点 = 本体中心 + 速度（NewNPC(666, 0, 0f, 1f)） */
  private eowSpit(game: GameHooks, tgt: Player): void {
    const st = game.world.store;
    if (!canHit(st, this.cx, this.cy, 1, 1, tgt.cx, tgt.cy, 1, 1)) return;
    const spit = Enemy.fromVanilla(666, this.cx + this.vx, this.cy + this.vy);
    if (!spit) return;
    // ★Bottom 锚（1457 :51635 NewNPC((int)(cx+vx),(int)(cy+vy)) → nPC.Bottom=(X,Y)）:
    //  毒唾顶 = cy+vy−h——旧中心锚低 h/2
    spit.y = this.cy + this.vy - spit.h;
    spit.ai0 = 0; spit.ai1 = 1;
    addEnemy(game, spit);
  }

  /** AI_006 链头白名单（自然生成池/召唤可达的建链头）。不在表内 = 原版不建链：
   *  体/尾段裸生(面板)=光杆；402 星尘织带蠕虫原版无链(全树无 403/404 生成点,
   *  天柱生成=光杆头)；412 爬尾虫/621 血鳗鱼由各自 AI 首帧自建(再建=双链)；
   *  375 鳀鱼? 375=NPC_375 单体蠕虫(原版同名单独,链上 376/377=错族)；
   *  13 EoW 走 boss 召唤专属路径(GetEaterOfWorldsSegmentsCount,realLife=-1)；
   *  134-136 毁灭者 aiStyle 37 非蠕虫 */
  static readonly WORM_CHAIN_HEADS = new Set([7, 10, 39, 87, 95, 98, 117, 454, 510, 513]);

  /** AI_006 逐型链规格（自然生成/召唤共用——NPC.cs:51660-51905 建链块 + :51853-51905
   *  通用头 ai[2] 覆写表;C# Next(lo,hi) 上界不含）。87 飞龙 = 固定 14 段精确序列
   *  (:51700-51724 m0..m13:1/8=88 翼段、11/12=90/91、13=92 尾,余 89);454 幻影龙 =
   *  固定 30 段(:51743-51769:默认 456、(n-2)%4==0 且 n<26 → 455、27/28/29 →
   *  457/458/459——曾按仪式点 5 段 [455..459]=误读,2026-09-02 全面 review 纠)。
   *  非链头（段裸生/自建链族/无链族）返回 undefined=不建链 */
  static wormChainSpec(vid: number, rand: () => number): { count: number; segIds?: number[] } | undefined {
    // ★P8 mod 链分支(2026-10-05):mod 蠕虫链注册表先于原版白名单——mod 头(800+)
    //  不在 WORM_CHAIN_HEADS,旧实现恒 undefined=mod Boss 永远光杆。零 mod 零扰动。
    const modSpec = MOD_WORM_CHAINS.get(vid);
    if (modSpec) return { count: modSpec.count, segIds: modSpec.segIds };
    if (!Enemy.WORM_CHAIN_HEADS.has(vid)) return undefined;
    const next = (lo: number, hi: number) => lo + ((rand() * (hi - lo)) | 0);
    switch (vid) {
      case 87: return { count: 14, segIds: [89, 88, 89, 89, 89, 89, 89, 89, 88, 89, 89, 90, 91, 92] };
      case 454: {
        const segIds: number[] = [];
        for (let n = 0; n < 30; n++) {
          if (n === 27) segIds.push(457);
          else if (n === 28) segIds.push(458);
          else if (n === 29) segIds.push(459);
          else if ((n - 2) % 4 === 0 && n < 26) segIds.push(455);
          else segIds.push(456);
        }
        return { count: 30, segIds };
      }
      case 510: return { count: next(12, 21) + 1 };
      case 513: return { count: next(6, 10) + 1 };
      case 39: return { count: next(14, 23) + 1 };
      case 95: return { count: next(6, 12) + 1 };
      case 98: return { count: next(20, 26) + 1 };
      case 117: return { count: next(3, 6) + 1 };
      default: return { count: next(8, 13) + 1 };   // 7 吞噬怪等通用头(ai[2]=Next(8,13))
    }
  }

  /** 由头生成段链（原版各 worm 的 NewNPC 链，NPC.cs:18174+）：body×n + tail。
   *  segIds 显式段表（454 幻影龙 = wormChainSpec 的 30 段表——456 主体+455 翼节+
   *  457/458/459 尾三连,非 head+1/head+2 连号族）；
   *  sharedLife = realLife 共享头血池（StrikeNPC :82132-82137——毁灭者/幻影龙段不可单独打死） */
  static spawnWormChain(head: Enemy, segCount: number, segIds?: number[], sharedLife = false): Enemy[] {
    const segs: Enemy[] = [];
    const bodyId = head.vanillaId! + 1, tailId = head.vanillaId! + 2;
    // EoW 族记链总段数（血条恒定分母,EaterOfWorldsProgressBar :30-33;
    // 毁灭者族不消费,统一写入无副作用）
    const chainTotal = segCount + 1;
    head.eowChainMax = chainTotal;
    let prev = head;
    for (let k = 0; k < segCount; k++) {
      const id = segIds ? segIds[k] : (k === segCount - 1 ? tailId : bodyId);
      const s = Enemy.fromVanilla(id, head.cx, head.cy);
      if (!s) continue;
      s.wormFollow = prev;
      prev.wormNext = s;
      prev = s;
      s.eowChainMax = chainTotal;
      if (sharedLife) s.realLifeHost = head;
      segs.push(s);
    }
    // ★RB31:共享池族头自指(原版建链块给头写 realLife=whoAmI——NPC.cs:51703/51738/
    //   51776/51800/51824/51852/:51897;头 realLife≥0 ⇒ checkDead 首行 :78846 第二支
    //   豁免+魂镰 DoT 免疫门 NPC.cs:92802 覆盖;毁灭者/千足蜈蚣两处已显式 self 同式)
    if (sharedLife) head.realLifeHost = head;
    return segs;
  }

  /** SetDefaults alpha/color 复位面（NPC.cs:8553 `alpha = 0` / :8554 `color = default`
   *  → per-type 终值）。fromVanilla 出生与 tryTransformTo 变身（★BJ101 尾刀
   *  2026-09-16）共用单源——原版 Transform → SetDefaults(newType)（:81921）全链重跑
   *  会复位这两面，旧实现变身保留旧 spawnAlpha/alphaFade/colorRGBA：
   *  EoW 身段晋升（Transform(13),1457 NPC.cs:52057）不重渐显 + AI_006 尾段尘 14 死链（渐显段
   *  alphaFade 门）、净Id变体史莱姆（-3/-4/-7 由 AI 直写 color）微光化 676 后残色。
   *  1458 对拍：SetDefaults 头段 :8449-8475 / Transform :81909-81970 / AI_006 尾段
   *  :52797-52820 三区 byte-diff 全等（2026-09-16）。
   *  消费面：spawnAlpha/colorRGBA 渲染链（drawEnemy Opacity + GetColor 二次绘制、
   *  slimeColorTick 踩漆 lerp、掉落 drop.color）。
   *  dontCountMe（:8472 复位→per-type）本仓无 per-instance 位——由
   *  NPC_DONT_COUNT_ME_1457 静态表按当前 vanillaId 求值隐式跟随（雷达谓词唯一读点,
   *  InfoAccs.ts；vanilla 31 处写点全在 SetDefaults 主体块内=按型常量,同构）。 */
  private initSetDefaultsAlphaColor(id: number, v: VanillaNpc): void {
    this.alphaFade = false;   // ★变身复用须显式归零（fromVanilla 新实体字段缺省 false 等价）
    this.spawnAlpha = NPC_STATIC_ALPHA[id] ?? v.alpha ?? 0; // 原版 SetDefaults alpha（静态不透明度，NPC.Opacity=1-alpha/255；2026-08-20 补全表：史莱姆 175 等曾恒 0=浊暗）
    // alpha=255 = 出生全透明渐显标记（13-15 世吞 / 134-136 毁灭者；其余 alpha 为
    // 静态不透明度,勿动）：置 alphaFade 交渐显路径逐 tick 减回 0。EoW 族保持原版
    // 初值 255（AI_006 尾段 :52650-52670 移动门 -42/t，见 fixedUpdate 渐显段）；
    // 134-136 毁灭者同保 255 但【不置 alphaFade】——AI_037 链门淡入（头恒过/
    // 段须前段<128、无条件 -42/t+红尘 182，:50162-50182，destroyerAI 内）接管，
    // 通用 -1/t 近似对其已退役；其余 alpha=255 族沿用 254 起步走 -1/t 近似
    if (this.spawnAlpha >= 255) {
      if (id >= 134 && id <= 136) { /* 保持 255 初值，AI_037 链门淡入接管 */ }
      // 586 僵尸人鱼出水演出（F16，NPC.cs:56445-56466）：保持 255 初值，fighterAI 内
      // 首帧 TargetClosest+vy=-6+35 尘爆发后 −15/t 渐显（alpha==255 门须原值）
      else if (id === 586) { /* fighterAI 586 出水演出接管 */ }
      // 621-623 血鳗鱼（SetDefaults alpha=255）：AI_006 头段链门渐显 -42/t
      // （:51399-51421）保持 255 原值起步（勿走通用 254/-1t 近似）
      else if (id >= 621 && id <= 623) { this.alphaFade = true; }
      else { this.alphaFade = true; this.spawnAlpha = (id >= 13 && id <= 15) ? 255 : 254; }
    }
    this.colorRGBA = v.color ? [v.color[0], v.color[1], v.color[2], v.color[3] ?? 255] : null; // 原版 color 字段
  }

  /** 用原版数据造怪：属性/碰撞/音效全部来自 SetDefaults 提取值 */
  static fromVanilla(id: number, x: number, y: number): Enemy | null {
    const v = vanillaNpc(id);
    if (!v) return null;
    const e = new Enemy(`v_${id}`, x, y);
    e.vanillaId = id;
    e.vanilla = v;
    e.fighterPrevX = x;   // 原版 NewNPC 后 oldPosition==position（首 tick 计数 +1=出生小跳）
    const hit = vanillaSoundFiles(v.HitSound) ?? ['NPC_Hit_1'];
    // DeathSound 显式 null(246 头)=原版无声,不给 fallback(缺键=提取漏→通用档)
    const kill = v.DeathSound === null ? [] : vanillaSoundFiles(v.DeathSound) ?? ['NPC_Killed_1'];
    // 受击/死亡 wav 随【生成】预热（Game 注入 sfx.preloadFiles）——原版 LoadAll
    // 全量预载；不预热则本怪首击懒加载在途,playSfxFiles 回退合成 hit 方波
    // （"第一击不像受击音、后续才对"根因;VANILLA_SPAWN_POOLS 池预热漏掉沙尘暴
    // 池的秃鹫 61/怒滚虫 546/蚁狮 69 等）。挂构造 = 雕像/Boss 召唤/分裂全路径覆盖
    enemySoundPrewarm?.([...hit, ...kill]);
    // 飞行档（StrikeNPC :82217/-0.5 受击档用）：数据 noGravity 族 + aiStyle 2/5/14
    // （原版各 AI 开头 noGravity=true）+ aiStyle 23/44（飞行武器 83/84/179 kb0.4
    // :25318、飞鱼/蚁狮蜂族 224/509/581/587 :31001——JSON noGravity=false 但原版
    // AI 每 tick 置位，静态表覆盖不到，2026-08-17 补）；按态族（17/87/91）走运行时
    // this.noGravity 位（hurt() 读 noGravity || def.flying）
    const flying = v.noGravity || v.aiStyle === 2 || v.aiStyle === 5 || v.aiStyle === 14
      || v.aiStyle === 23 || v.aiStyle === 44;
    // ---- NPC.ScaleStats（NPC.cs:18081-18105，NewNPC→SetDefaults 后调用 :8322/:17791）----
    // 世界难度轴（Main.Difficulty → 生命/伤害/钱/击退倍率 + 逐类型系数 +
    // 专家困难模式兜底增强）。Boss **不豁免**（仅 ExpertHardmode 段跳过 :18471）。
    // 上下文经 bindScaleStatsWorld 注入（Game.afterWorldLoad；原版 Main 静态单例语义），
    // 未绑定=经典档（倍率恒 1，仅 lifeMax<6 下限与类型系数在 Classic 档同样无变化）。
    const rawDamage = (v.critter || v.friendly) ? 0 : v.damage;   // def.damage 基线
    // 原版"承受比例"语义——缺省 1f（NPC.cs:8449 SetDefaults 默认 knockBackResist=1,
    // JSON 提取表只写显式赋值,无字段的 137 只（克眼仆从等）此前落 0.5 吃半击退,2026-08-13 修正）
    const rawKb = v.knockBackResist ?? 1;
    // ---- SetDefaults 尾段种子档调整（NPC.cs:17774-17785，ScaleStats :17791 之前）----
    // zenith(getfixedboi)→getGood(FTW)→tenthAnniversary（else-if 互斥）。命中分支
    // 扩盒（★与专家档 Tweaks"只缩贴图不扩盒"语义相反），详 ScaleStats.applySeedAdjustments 头注。
    const seedS: SeedAdjustStats = {
      type: id, scale: v.scale ?? 1, lifeMax: v.lifeMax, defense: v.defense, damage: v.damage,
      value: npcValueOf(id),
      canDisplayBuffs: true,   // NPC.canDisplayBuffs 默认 true（NPC.cs:6124）
    };
    // ★IIIII228：SetDefaults 逐型 remix 块（NPC.cs:8775/:8808/:8837/:8866/:9558/:9895/
    // :11210/:11332）——remix 世界 6/7/8/9/173 ×1.3 全乘、59 定值覆写、82 ×1.2、
    // 181 ×1.1+×1.2。原版序=主体块（先）→ zenith/getGood/tenth（后）→ ScaleStats。
    const remixHit = applyRemixSetDefaults(seedS, scaleStatsWorld());
    // ★vScale = 首盒基 scale（1457 NPC.cs:17842 首盒乘数；1456:17745）——必须在
    //  applySeedAdjustments【之前】读取：种子档命中后 seedS.scale 已是调整后总 scale，
    //  在其后读会把首盒也用种子档 scale 再乘一遍 = 盒被平方（SC1 2026-09-13 定谳：
    //  09-09 3c6df9d76 把 08-13 213dcc9d1 的 `v.scale ?? 1` 改为此行且读取点落在
    //  applySeedAdjustments 之后，245/266/113/39/13 五族盒全错）。remix 命中=入口
    //  scale 已乘（原版 remix 块在 SetDefaults 主体、先于 :17842 首盒）；zenith 只改
    //  lifeMax 不动 scale。
    const vScale = seedS.scale;
    const seedBox = applySeedAdjustments(seedS, scaleStatsWorld());
    // 碰撞盒：:17842 基扩盒 (int)(w×scale)（1456:17745）之后，种子档命中分支再
    // (int)(w×scaleNew)（getGood :18122 / 十周年 :17958；1456:18025-18026/:17861-17862）
    // ——按原文两级 (int) 截断重算（s≠1 族 113/114/134-136 差 1px）；
    // ★BJ101（2026-09-16）：两级 (int) 截断抽为 seedTailBox 单源——Transform→
    // SetDefaults(:81921) 全链重跑的 tryTransformTo 与本处共用（fx43 双源漂移防）。
    // 表达式逐位等价迁移（双未命中支原文同式，RB15b-F1 注释随迁 ScaleStats.ts）。
    // ★remix 命中时基 scale 已含 ×1.3/×1.2/×1.1（原版 scale *= 语句）——非种子档
    // 分支也须走 (int) 截断（原版 :17842 恒 (int)，remix 非 1.0 尺度下 round/trunc
    // 会出现 1px 差，如 22×1.3=28.6）
    // ★BJ101（2026-09-16）：两级 (int) 截断抽为 seedTailBox 单源——Transform→
    // SetDefaults(:81921) 全链重跑的 tryTransformTo 与本处共用（fx43 双源漂移防）。
    // 表达式逐位等价迁移（双未命中支原文同式，RB15b-F1 注释随迁 ScaleStats.ts）。
    const { w: boxW, h: boxH } = seedTailBox(v.width, v.height, vScale, seedS.scale, seedBox);
    const ss: ScalingStats = {
      type: id, lifeMax: seedS.lifeMax, damage: seedS.damage,
      value: seedS.value ?? npcValueOf(id),   // ★IIIII228：remix value ×scale 已并入
      defense: seedS.defense, knockBackResist: rawKb,
      boss: VANILLA_BOSS_IDS.has(id), friendly: !!v.friendly, townNPC: !!v.townNPC,
      scale: seedS.scale, difficulty: 0,
    };
    scaleStats(ss);
    e.difficulty = ss.difficulty;          // npc.difficulty（AI 段 GetAttackDamage_* 消费）
    e.baseDamage = rawDamage;              // defDamage 快照的【未缩放】基线（弹幕出膛用）
    // def.knockBackResist 直存原版"承受比例"语义（ScaleStats :307 缩放后仍是比例；
    // hurt() 无条件 kbx*resist——0=免疫、1=全额）。旧"1-比例"换算+0.89 钳已废（2026-08-13）
    const kbr = ss.knockBackResist;
    e.def = {
      ...e.def,
      // friendly（被缚 NPC 等城镇系）与 critter 一样零接触伤害——原版 friendly 旗
      // ★此前漏写字段本体（仅注释），def.friendly 恒 undefined——玩家伤害门/索敌
      // 全部穿透（2026-08-19 睡渔夫可被攻击掉血根因）
      friendly: !!v.friendly,
      critter: !!v.critter,
      name: v.name, hp: ss.lifeMax, damage: rawDamage !== 0 ? ss.damage : 0, defense: ss.defense,
      // 原版 knockBackResist="承受击退的比例"（0=免疫 Boss、0.5=吃一半、1=全额）
      knockbackResist: kbr,
      width: boxW, height: boxH, flying,
      boss: VANILLA_BOSS_IDS.has(id),
      nightOnly: v.aiStyle === 2 || v.aiStyle === 5, underground: false,
      mapColor: '#9A8FA0', gore: ['#9A8FA0', '#5E5566', '#C4BACC'],
      hitSound: hit, killedSound: kill, drops: [], // 掉落走 NpcDrops 规则树（击杀时求值，不再预展开）
      // hitSound/killedSound 为 wav 变体组（DD2_*/Deerclops* 多变体，playSfxFiles 组内随机）
      // ScaleStats 后的 npc.value（EnemyMoneyDropMultiplier 已乘，经典档=原值；
      // 弹体 NPC 不缩）——击杀掉钱消费位（Enemy.ts 掉落 ctx.value）
      value: ss.value,
      // 小动物：无接触伤害、不夜行（ScaleStats 对 damage=0/lifeMax≤5 的它们本就不进门）
      ...(v.critter ? { damage: 0, nightOnly: false } : {}),
    };
    // 接触伤害：战斗怪 = ScaleStats 缩放后 npc.damage（damage!=0 的 friendly/critter
    // 恒 0，与旧归零语义一致）
    e.hp = ss.lifeMax;
    e.maxHp = ss.lifeMax;
    // ★BJ704-G3 D10：SetDefaults 尾捕获窗初始化（NPC.cs:17883-17887——npcCatchable
    //   型 catchableNPCTempImmunityCounter=90+friendly=true；蚱蜢 377/446 json
    //   friendly=true 系同窗的静态投影,与计数并行不冲突）。释放/雕像出生的清零由
    //   fixedUpdate 尾 SubAI 拍（releasedFromItem/spawnedFromStatue 首拍归零=原版
    //   :91653 在 NewNPC→ReleaseNPC/雕像置位后首拍生效同构）
    e.catchImmunityT = NPC_CATCHABLE.has(id) ? 90 : 0;
    e.catchFriendly = e.catchImmunityT > 0;
    e.noGravity = flying;   // 运行时位初值=静态飞行档（按态族由各自 AI 每 tick 改写）
    // 碰撞盒乘 npc.scale(NPC.cs:17745-17747 width/height=(int)(×scale))——
    // 史莱姆王/毁灭者 1.25、血肉墙 1.2:此前未乘,贴图放大了盒子没放大,
    // 判定区比视觉小一圈(与渲染 scale 不一致的"盒贴图不匹配"来源)。
    // 种子档命中族（boxW/boxH）已含 :18025/:17862 二次扩盒
    e.w = boxW;
    e.h = boxH;
    // 渲染乘区同步（Renderer.ts drawEnemy :7092 = vanilla.scale × vanillaScale）：
    // 注入"SetDefaults 终态 scale / def 基 scale"比值，使贴图与扩盒后的碰撞盒一致
    // （113=0.65、134-136=1.3、39-41=1.1[remix 1.32]）。
    // ★RB15b-F3(2026-09-14)：remix 命中族（6-9/173/59/82/181，NPC.cs:8775-11332
    //   SetDefaults 主体块）盒已 ×1.3/×1.2/×1.1 而此处不写 → 贴图按 def 基 scale
    //   画 = 盒贴图不匹配，补 remixHit 支。除数必须为 def 基 scale（v.scale ?? 1）
    //   而非 vScale——vScale 在 remix 块【之后】读取已含 ×1.3，remix-only 时
    //   seedS.scale===vScale → 比值恒 1 修不动；语义=Game.ts:39129 -12 臂先例
    //   box.scale/(v6.scale ?? 1)，vanilla 侧贴图消费 npc.scale 终态（remix 乘在
    //   主体、先于 :17842 首盒）。种子档-only 命中族与 remix 乘 scale 族零交集
    //   ⇒ 未 remix 时 vScale===defBase，既有值逐位不变（scale-stats 金标零漂移）；
    //   tenth 未列族（seedBox 恒真、scale 未改）比值=1 同旧值。
    if (seedBox || remixHit) e.vanillaScale = seedS.scale / (v.scale ?? 1);
    // NPC.canDisplayBuffs（批次B 落地）：FTW getGood 245-248 石巨人族置 false
    // （ScaleStats.getGoodAdjustments :17945/:17950/:17955）。原版两处消费
    // （染色门 :92026 / 鞭标 VFX 门 :92135）本仓均未移植——字段先行保数据链一致
    e.canDisplayBuffs = seedS.canDisplayBuffs !== false;
    e.initSetDefaultsAlphaColor(id, v);   // alpha/color 复位面单源（★BJ101 尾刀：变身同参复用）
    // 266 克脑 SetDefaults :12372 dontTakeDamage=true——一阶段（爬行者存活）不可击，
    // AI_054 二阶段入场段 :32589 自行解除（存档载入即二阶段也由该段下一 tick 清除）
    if (id === 266) e.dontTakeDamage = true;
    // 263 世纪之花钩蔓 SetDefaults :12331-12332 dontTakeDamage=true——恒不可击
    // （AI_052 本体消失时自伤 9999 走直改 hp 通道,不受此门禁阻塞）
    if (id === 263) e.dontTakeDamage = true;
    // 690 雕像宝箱怪 SetDefaults :17615-17627 immortal+dontTakeDamage=true——伪装态
    // 不可击；AI_126 唤醒段 :43873 解除（ai[0] 0→1）
    if (id === 690) e.dontTakeDamage = true;
    if (id === 392) e.dontTakeDamage = true;
    // 395 火星飞碟 SetDefaults(1458 :14055-14074)dontTakeDamage=true——出生首拍前
    // 的无敌兜底（AI 内按 ai0==1 解除闩锁维护,bossAI_martian.ts）
    if (id === 395) e.dontTakeDamage = true;
    // 328 南瓜王之刃 SetDefaults :13092 dontTakeDamage=true——恒不可击的表情节拍体
    // （曾缺=可被玩家打死,2026-08-19 终审修）
    if (id === 328) e.dontTakeDamage = true;
    // 70 刺球(:9722)/72 火轮(:9757) SetDefaults dontTakeDamage=true——两只地牢机关球
    // 恒不可击（def.dontTakeDamage 提取面不含此字段,手补表同款;曾缺=可被磨死/放死音/
    // 出尸块,地牢永久威胁可被清空——2026-09-02 红蓝对抗完备性批评定谳补）
    if (id === 70 || id === 72) e.dontTakeDamage = true;
    // ★BJ347-② 437 神秘石碑 SetDefaults(:14219) dontTakeDamage=true——恒不可击的
    //  仪式锚（"跪拜魔法阵"本体;AI_083a 全程无解除点）。曾用 iframes=2 每 tick 刷新
    //  近似（bossAI_lunar_misc）被 hurt 免疫门 pierce===1 豁免绕过（箭/枪弹/多数
    //  随从可磨死 400 血石碑）→ 四守卫随碑亡消散、召唤链中止不出教主=用户实报。
    //  手补表同款（提取面不含此字段）
    if (id === 437) e.dontTakeDamage = true;
    // ★BJ385-④ 636 光之女皇 SetDefaults :17234 dontTakeDamage=true——出生首拍前的
    //  无敌兜底（AI_120 :47431 `dontTakeDamage = !flag6` 每拍重算接管,bossAI_lategame
    //  empressOfLightAI;SetDefaults 行在其前=原版 spawn 同拍语义）。657 史莱姆皇后
    //  SetDefaults :17342-17358【无】此行=无手补项,其无敌面纯 AI 重算
    if (id === 636) e.dontTakeDamage = true;
    // ★BJ468：374/375/686 SetDefaults 静态置位 dontTakeDamageFromHostiles=true——
    //  净效应/消费面见字段处静态表注;赋值形=原版「序章 :8529 复位+:13803/:13822/:17670
    //  置位」净语义（同参线在 tryTransformTo）
    e.dontTakeDamageFromHostiles = Enemy.DONT_TAKE_DAMAGE_FROM_HOSTILES_SETDEFAULTS.has(id);
    // SetDefaults immortal（NPC.cs:14630 假人 488/:17715 雕像宝箱怪 690——690 的
    // 显隐态由其 AI :43873 翻 false）。DoT 直扣路径以本位守卫（GetHurtByDebuff
    // :92995 同款）——DoT/血条曾绕过 488 守卫（2026-09-02 用户实报闪烁血条）
    if (id === 488 || id === 690) e.immortal = true;
    // 290 圣骑士底对齐缩盒（GetTileCollisionParameters :93976-93978,IIIII235 2026-09-10）：
    // cHeight=40（SetDefaults 盒高 62 → inset=22）——TileCollision/SlopeCollision/StepUp
    // 三消费点（:93685/:93824/:64909）全走缩盒,碰撞域只看身体下部 40px 窗,视觉头/盔
    // 可压进上方墙格（原版 3 格高走廊通行靠此;feet 不变=落地语义零变化）。1456:94035/
    // 1457:93977 同值
    if (id === 290) e.collTopInset = 62 - 40;
    e.x = x - e.w / 2;
    e.y = y - e.h / 2;
    return e;
  }

  def: EnemyDef;
  hp: number;
  maxHp: number;
  iframes = 0;
  animT = 0;
  facing = 1;
  aiT = 0;               // 通用 AI 计时
  state = 0;             // 行为状态
  /** 渲染层回填：本帧实际绘制的贴图底边（世界 y）。血条定位用——原版条在
   *  盒底+10 的前提是"贴图底≈盒底+4"，中心锚+显式下移（如 EoC +23/+30）会
   *  破坏该前提 → 条会扎进贴图（2026-08-13 用户报"血条在眼球内"）。
   *  drawHealthBar 以 max(盒底+10, 贴图底+6) 兜底。仅渲染消费，AI/存档无关 */
  spriteBottomWorld = 0;
  phase = 1;             // Boss 阶段
  target: { x: number; y: number } | null = null;
  squash = 0;            // 史莱姆挤压动画 -1..1
  stuckT = 0;            // 飞行怪卡墙计时（脱困用）
  stuckCd = 0;           // 脱困后的游荡冷却
  jumpStartX = 0;        // 史莱姆本次起跳的 x（落地时判定是否白跳）
  chargesLeft = 0;       // EoC 剩余冲撞次数
  dashing = false;       // EoC 冲撞中（无视地形）
  visAngle = 0;          // npc.rotation 默认 0（EoC 素材正面朝下须 π——eocAI 入口自置；
                         // ★曾用 π 做类默认，新接旋转的族不归零会倒栽葱，2026-08-20 根修）
  spin = 0;              // EoC 变身旋转进度 0..1
  hpBarT = 0;            // 受击后血条显示计时（tick）
  /** 原版 NPC.immortal（NPC.cs:6266）：StrikeNPC/GetHurtByDebuff 只跳过 life 扣减,
   *  飘值/音效照走、血条永不出现（life 恒=lifeMax）。SetDefaults 置位:488 训练假人
   *  （:14630）/690 雕像宝箱怪（:17715,其 AI :43873 显隐态翻 false）;运行时置位:
   *  infectedSeed 世界 type20（:53687,本仓未建模）。DoT 直扣路径必须以本位守卫——
   *  曾 3 处 DoT 裸扣 hp 绕过 488 守卫=假人吃燃烧 buff 闪烁血条（2026-09-02 实报） */
  immortal = false;
  // ---- EoC(AI_004)专属 ----
  servantT = 0;          // 悬浮时"位于玩家上方"累计(110t 召仆从)
  spinSpeed = 0;         // 自旋角速度(cs ai[2]:0.005 步进钳 0.5)
  spinPhase = 0;         // 自旋段:0 加速 / 1 减速
  walkCycleT = 0;        // 行走帧累加器（≈原版 frameCounter，按 |vx| 推进）
  crawlT = 0;            // AI_040 爬墙帧累加器（FindFrame case 165 族：(|vx|+|vy|)×0.5，24 循环）
  mimicFrameT = 0;       // ★BJ464 AI_025 宝箱怪族帧累加器（FindFrame case 85 :74247-74252：腾空++/落地--，钳 0..12；伪装态清零。mimicAI 维护，vanillaFrameIdx 消费）
  /** ★BJ700b 龟族(616/617/625) FindFrame 计数器（frameCounter,NPC.cs:77486-77578）。
   *  每拍 +1；站定(vx==0)/腾空(vy≠0,仅 616/617——625 无腾空钉)清零=周期重启。
   *  turtleFindFrameStep（fixedUpdate 尾=findFrameRotation 层,读碰撞末态）维护,
   *  vanillaFrameIdx 消费。 */
  turtleFrameT = 0;
  /** 龟族 FindFrame 帧行(frame.Y/num)：干走带 0..7(625:0..5)/湿泳带 8..13(625:6..11);
   *  腾空钉帧行 8(=蜷壳旋跳)——落地后保持 8 拍再回卷 0（「跳旋落地→蜷壳定拍→出壳」
   *  原版节拍,旧全局相位实现落地即跳任意中幅帧=BJ700b 用户实报病灶） */
  turtleFrame = 0;
  /** ★BJ704 陆龟族(153/154/496/497) FindFrame 计数器（frameCounter,NPC.cs:78093-78162,
   *  type≠417 门）——态 0 走带 +=|vx|×1.1（带 6/12/18/24/32,≥32 回卷;vy<0 锁 0）;
   *  态 1 缩壳 5→6→7 / 态 5 出壳 7→6→5（ai1 带 10/20）/ 态 3/4 恒帧 7。 */
  tortoiseFrameT = 0;
  /** 陆龟族帧行（frame.Y/num）：走带 0..4 / 缩壳带 5..7（vanilla 同帙,496/497 12 帧表
   *  仅消费 0-7）。tortoiseFindFrameStep 维护（fixedUpdate 尾 findFrameRotation 层）。 */
  tortoiseFrame = 0;
  justHitT = 0;          // 受击单帧旗标计数（hurt() 置 2，AI 消费原版 justHit 语义）
  /** StrikeNPC 返回值 num41 等价（2026-08-31 批⑥：本次命中防后实扣,hurt() 实扣路径写；
   *  弹幕调用方读走做 on-hit 门——Projectile.ghostHurt 的 dmg<=1 早退） */
  lastStrikeDealt = 0;
  /** 岩浆接触冷却（原版 immune[255]=30,NPC.cs:94528）与 onFire 状态（buff 24,秒） */
  lavaCd = 0;
  lavaWet = false;
  onFireT = 0;
  onFireDoT = 0;
  /** 原版液体态（NPC.cs UpdateCollision :93712-93805，npcLiquid.updateNpcLiquid 每 tick 写）：
   *  wet=中心小盒 WetCollision 命中（含岩浆格）；honeyWet/shimmerWet 选减速档与熄火门；
   *  wetCount=出入水 10t 去抖（溅落声/尘）。inWater 为旧字段别名（=wet） */
  wet = false;
  wetCount = 0;
  honeyWet = false;
  shimmerWet = false;
  /** AI_001 wet 段的 ai[3] 语义位（cs:61889：vy>0 时记 position.X，上浮中 X 未动 → 掉头） */
  slimeWetX = 0;
  /** 微光浸入进度（≈shimmerTransparency ×100，NPC.cs:92468-92483：+0.01/t，
   *  90t 到 0.9 阈值触发 NPC.GetShimmered；离池 -0.01/t） */
  shimmerT = 0;
  /** 武器浸剂 debuff（R2，近战命中施加；单位=秒）
   *  DoT 对应 NPC.cs UpdateNPC_BuffApplyDOTs（lifeRegen/2 = HP/s）：
   *  poison lifeRegen-12→6HP/s(:92590)、venom -60→30(:92706)、cursed(onFire2) -48→24(:92690) */
  poisonT = 0;
  venomT = 0;
  cursedT = 0;
  /** Frostburn(44)/Frostburn2(324)/OnFire3(323)/ShadowFlame(153)/Oiled(204)
   *  （NPC.cs UpdateNPC_BuffApplyDOTs：44→lifeRegen-16=8HP/s(:92648) / 324→-50=25HP/s
   *  (:92668) / 323→-30=15HP/s(:92632) / 153→-30=15HP/s(:92712)。
   *  Oiled(:92728-92737) = 六火系任意在身时【再叠 -50 = +25 HP/s】,flat 加算
   *  非"翻倍"(旧实现按倍率,2026-08-13 G7 回源修正) */
  frostburnT = 0;    frostburnDoT = 0;
  frostburn2T = 0;   frostburn2DoT = 0;
  onFire3T = 0;      onFire3DoT = 0;
  shadowFlameT = 0;  shadowFlameDoT = 0;
  oiledT = 0;        oiledDoT = 0;
  /** BrokenArmor(36)=受击无视 20 防 / BetsysCurse(203)=无视 40 防
   *  (NPC.cs:81919-81924 armorPenetration += 20/40);Daybreak(189) 层数模型
   *  已接(原版:场上附着 636 太阳耀斑数 num8,lifeRegen -= num8×2×100 = 100HP/s/层,
   *  零层兜底 1——NPC.cs:92807-92830;636 实体 = WeaponProj.DaybreakFlare) */
  brokenArmorT = 0;
  betsysCurseT = 0;
  daybreakT = 0;  daybreakDoT = 0;
  /** R2 余量批(NPC.cs UpdateNPC_BuffApplyDOTs 逐条):Bleeding(30)=-24=12HP/s(:92598)/
   *  Hemorrhage(375)=-200=100HP/s(:92610)。
   *  贴附族层数模型已接(2026-08-15,NPC.cs:92740-92863 逐条):层数=场上附着弹计数
   *  (169←598 骨标 3HP/s/层 :92740-92759 / 337←971 触手刺 3HP/s/层 :92761-92779 /
   *  344←975 血腥屠夫 4HP/s/层 :92786-92804 / 183←614 星尘弹 20HP/s/层 :92846-92863
   *  ——均无零层兜底,唯 Daybreak 189 有 :92822-92825)。
   *  仓内 598/614/971/975 无附着实体,以"层=独立倒计时条目"等价建模:
   *  每层寿命=对应 buff 时长(贴附弹寿命 60×num11 AI 次,AI_113 :38252-38272
   *  默认 num11=15→900t/971·975=9×MaxUpdates→540t,恰与 AddBuff 时长
   *  169/183=900t、337/344=540t 等长)——层自然消亡与 buff 到期同步,无独立衰减。
   *  137 Slimed = 六火系 DoT 翻倍(drippingSlime 六处等量叠伤,见 onFireT 块)。
   *  151 SoulDrain = -50 lifeRegen = 25 HP/s(:92927-92935,realLife==-1 即非蠕虫
   *  分体)——玩家侧魂镰联动(3006 持械挥击时 player.soulDrain++ 计数,
   *  UpdateNPC_SoulDrainDebuff :91952-91979)依赖魂镰实装,登记 GAP */
  slimedT = 0;
  /** Wet(103)（2026-08-30 孤儿武器 A 波：水枪弹 358 施加源落地）：非 DoT 计时位
   *  ——原版 NPC.AddBuff 后由 buff 更新链驱动滴水视觉与交互门(NPC.cs :11319-
   *  11352)；本仓先承载倒计时,视觉以施加瞬间湿尘最小近似。
   *  Shimmered(353)（微光枪弹 1042 同批,现为【消费态】:X-F4 接线后并入 Enemy
   *  fixedUpdate 的微光链）——原版 buff 在身即 shimmering=true(NPC.cs:93255-93265),
   *  变形触发不要求浸池(:92634-92644 透明度累计→GetShimmered :92668 四分支);
   *  秒制时长 100t=5/3s ≥ 阈值 91 拍 ⇒ 满时长命中必触发一次 */
  wetT = 0;
  /** buff 353 剩余（秒,applyBuffTicks max 合并写入；>0 即等价 shimmering 状态位,
   *  驱动 shimmerT 累计并在 >90 时 npcGetShimmered 一次 + 自清防重入） */
  shimmeredT = 0;
  bleedT = 0;      bleedDoT = 0;
  hemorrhageT = 0; hemorrhageDoT = 0;
  javelinT = 0;    javelinDoT = 0;
  spikeT = 0;      spikeDoT = 0;
  butcherT = 0;    butcherDoT = 0;
  soulDrainT = 0;  soulDrainDoT = 0;
  /** 本体 soulDrain（SoulDrainDebuff debuff 位 :91951）——Game 侧邻域扫描
   *  3006 挥击中玩家供给计数用（:91966 soulDrain++），非 DoT 计时 */
  soulDrainActive = false;
  stardustT = 0;   stardustDoT = 0;
  /** 贴附族层数池（每元素=一层的剩余秒数；addStickerStack 入池、buff tick 衰减，
   *  ≤0 剪除）。上限=KillOldestJavelin（Projectile.cs:13019-13030/:13995-14020
   *  杀 timeLeft 最低=最老）：598=6 / 614=10；971/975 不在白名单无上限。
   *  189 Daybreak 有 DaybreakFlare 实体走 daybreakStacks 活计数，不入本表 */
  javelinStacks: number[] = [];    // 598 骨标枪（cap 6）
  stardustStacks: number[] = [];   // 614 星尘细胞弹（cap 10）
  spikeStacks: number[] = [];      // 971 触手刺（无上限）
  butcherStacks: number[] = [];    // 975 血腥屠夫（无上限）
  poisonDoT = 0;
  venomDoT = 0;
  cursedDoT = 0;
  /** ichor(69)：受击时防御 -15（ArmorPenetration += 15 :92096） */
  ichorT = 0;
  /** midas(72)：掉钱 ×1.1-1.5（NPC.cs:80424） */
  midasT = 0;
  /** confused(31)：纳米药剂/浸剂命中——buff 存量（秒）。语义见 {@link confused} */
  confusedT = 0;
  /** ---- 1457 新敌怪 debuff 家族（BuffID 395/397/398/399/400 + 362 电鳗鞭标记；
   *  DOTTally 管线 NPC.cs:92746-92800,单位换算 lifeRegen/2 = HP/s）----
   *  395 强酸 / 397 叶绿孢子：AddPoison(180,60) = 90 HP/s（:92751/:92755,可被 398 加速）
   *  398 毒素加速：可加速族（AddPoison/AddBloodLoss/AddFlamable）DoT ×2（:92840-92847）
   *  399/400 蓝/红闪电：纯视觉（Blue/RedLightningSmall 粒子 1/10,:92274/:92281）
   *  362 markedByEelWhip：Add(100,50) = 50 HP/s 平铺（:92781——不可加速、不吃
   *  Slimed 翻倍;1457 链式放电/标记玩家数机制全删,ApplyEelWhipDoT 成死代码） */
  potentAcidT = 0;
  chlorophyteSporeT = 0;
  acceleratePoisonsT = 0;
  blueLightningT = 0;
  redLightningT = 0;
  eelWhipT = 0;
  potentAcidDoT = 0;
  chlorophyteSporeDoT = 0;
  eelWhipDoT = 0;
  /** stinky(120)：苍蝇美食 5129 挥砍命中 5s（Player.StatusToNPC :6203-6206）。
   *  NPC 侧三消费支（2026-08-31 清偿，行号 1457=1458 同锚）：
   *   ①险情扫描当威胁(:54033 `!stinky` 子句+玩家支 :54081-54100)→ AI_007 小动物逃离;
   *   ②自身带味不休整(:54179-54182 ai[0]=0 段首强制起走);
   *   ③整体变暗(GetNPCColorTintedByBuffs :92208-92213 R×0.7 B×0.55)+苍蝇尘 188
   *     (UpdateNPC_BuffApplyVFX :92465-92475);
   *  附：液体即除(TryRemovingWaterPerishableEffects :94433,见 npcLiquid.ts)。
   *  B1 批新增授予源：恶臭药水弹 371 消亡 80px 圈（P.cs:78947-78956 → ThrowKillFx） */
  stinkyT = 0;
  /** 树妖煞(186 DryadBane)：树妖祝福光环弹 586 的 else-if 臂（Projectile.cs:41967-
   *  41970，2026-08-31 台账批接）——施加端 TownNPC.updateDryadWardAura：
   *  !friendly && lifeMax>5 && !dontTakeDamage && (FindBuff==-1||≤20t) &&
   *  (已带煞 || CanHit 弹心点对敌盒) && type!=488。DoT = DOTTally.Add(dps×2,
   *  dps/3) = dps HP/s，dps = GetDryadsBaneDamagePerSecond(NPC.cs:92898 基数4×
   *  downed 进度链，GetAttackDamage_ForTownNPC 截断)——由施加端换算写入
   *  dryadBaneDps；视觉 dust 163 1/4（UpdateNPC_BuffApplyVFX :92448-92453）。*/
  dryadBaneT = 0;
  dryadBaneDps = 0;
  /** DoT 累计器（DOTTally 家族同款：tick 累入 dps×dt、结算面按 ⌊acc⌋ 扣血保小数）
   *  ——漏声明曾致 L2279/2299 引用编译红（2026-08-31 补） */
  dryadBaneDoT = 0;
  /** lovestruck(119)：爱情药水弹 370 消亡 80px 圈授予（P.cs:78940/:78955）——
   *  NPC.buffType 挂账但 UpdateNPC 无任何 case（纯展示位），纯计时承载（B1 批） */
  lovestruckT = 0;
  /** gelBalloonBuff(320)：微光气球弹 936 消亡 80px 圈授予（P.cs:78943/:78955）——
   *  玩家侧 = drippingSparkleSlime 滴落展示（Player.cs:11843-11846）；NPC 侧三消费
   *  （终零波补齐 2026-09-01）：染色 G×0.75 B×0.85（debuffTintRGB :92220-92225）+
   *  微光滴尘 dust243 尾迹（updateBuffVfx :92563-92583）。 */
  gelBalloonT = 0;
  /** 实例级 buff 免疫覆写（1457 AI_001 熔岩史莱姆段 :61312-61316 运行时
   *  `buffImmune[70/397/395/20] = false`）：vanilla buff id → false = 静态免疫表
   *  （data/vanillaNpcImmunity）被运行时复位,AddBuff 照常施加。projStatus 施加门
   *  与本表对账；true 侧暂无消费（原版运行时只做复位） */
  debuffImmuneOverride?: Map<number, boolean>;
  /** 原版 confused 全局语义（NPC.TargetClosest 尾段 NPC.cs:78569-78572）：
   *  `if (confused) direction *= -1;`——各 AI 族用 direction 决定水平移动方向，
   *  因此 confused = 索敌的水平方向反向（directionY 不反转）。本仓各 AI 的
   *  "TargetClosest"= 从玩家算 facing 的赋值点，统一走 {@link seekDirX} 应用反转；
   *  直接用玩家坐标差算位移向量的族（AI_005 蜂群/AI_013 植物/AI_056 地牢之魂）
   *  原版不读 direction，同样不反转（勿在这些族接 confused）。 */
  get confused(): boolean { return this.confusedT > 0; }
  /** GetNPCColorTintedByBuffs（1457 NPC.cs:92142-92255）等价：debuff 染色的 RGB
   *  乘区（1=不变）。原版在 draw color 上逐 debuff 累乘（buffColor 闭式 = 累乘后
   *  一次乘 npcColor,与逐次乘等价）;本仓返回 [R,G,B] 乘区由 Renderer.drawEnemy 以
   *  tintedSprite(multiply) 消费。ichor 为整色替换 (255,255,0)（:92226-92229）。
   *  求值序 = 原版 if 链顺序（brokenArmor→poisoned→venom→chlorophyteSpore→
   *  potentAcid→bleeding/hemorrhage→midas→betsysCurse→oiled→stinky→drippingSlime→
   *  drippingSparkle→ichor;Sparkle 段 :92220-92224 已补(2026-09-01 终零波,buff 320=
   *  微光气球滴落 gelBalloonT)。hunter 段(:92230-92259)为后置缺口登记,见下。
   *  门 = canDisplayBuffs（:92144,FTW getGood 245-248 石巨人族 false）。1457 新增
   *  chlorophyteSpore（中毒式 R×0.65 B×0.75）与 potentAcid（剧毒式 G×0.45 R×0.75）
   *  两段。
   *  ★hunter 缺口（C 类登记）：原版尾段 `CanApplyHunterPotionEffects(:92137) &&
   *  lifeMax>1`（:92230-92259）把最终色逐通道钳底——AppearsFriendlyToHunterPotion
   *  (:92126)=friendly||catchItem>0||(damage==0&&lifeMax==5)，友好族钳 (50,255,50)、
   *  其余钳 (255,50,50)；门 = Main.SceneMetrics.PerspectivePlayer.detectCreature
   *  （本地玩家 Hunter 药水 buff 54 狩猎）。
   *  ★该段作用于【乘光后的 npcColor】（Main.cs:23115 npcColor=Lighting.GetColor →
   *  :23170 着色链 → Draw 才乘贴图）＝全黑暗中仍保底可见；本仓敌方精灵在世界层
   *  绘制后整体被 lightCanvas 乘暗（Renderer.ts 收口注释），钳底必须在乘光之后合成
   *  才能等效，精灵调制期无法表达——现有狩猎高亮走 drawBuffHighlights 红框近似
   *  （同在乘光之前，亦不透暗）。升级路径 = 光照收口后的实体剪影 pass（新基建，
   *  另批），勿把钳底塞进本乘区（会被后续乘暗抹掉）。 */

  get debuffTintRGB(): [number, number, number] | null {
    if (!this.canDisplayBuffs) return null;
    let r = 1, g = 1, b = 1;
    let hit = false;
    const mul = (rr: number, gg: number, bb: number) => { r *= rr; g *= gg; b *= bb; hit = true; };
    if (this.brokenArmorT > 0) mul(0.75, 0.75, 0.75);            // :92152-92158
    if (this.poisonT > 0) mul(0.65, 1, 0.75);                    // :92159-92164
    if (this.venomT > 0) mul(0.75, 0.45, 1);                     // :92165-92170
    if (this.chlorophyteSporeT > 0) mul(0.65, 1, 0.75);          // :92171-92176（1457 新）
    if (this.potentAcidT > 0) mul(0.75, 0.45, 1);                // :92177-92182（1457 新）
    if (this.bleedT > 0 || this.hemorrhageT > 0) mul(1, 0.85, 0.85);  // :92183-92188
    if (this.midasT > 0) mul(0.85, 1, 0.3);                      // :92189-92194
    if (this.betsysCurseT > 0) mul(0.8, 0.6, 1);                 // :92195-92200
    if (this.oiledT > 0) mul(0.4, 0.4, 0.4);                     // :92201-92207
    if (this.stinkyT > 0) mul(0.7, 1, 0.55);                     // :92208-92213 stinky(R×0.7 B×0.55)
    if (this.slimedT > 0) mul(0.8, 0.8, 1);                      // :92214-92219 drippingSlime
    if (this.gelBalloonT > 0) mul(1, 0.75, 0.85);                // :92220-92225 drippingSparkle(320) G×0.75 B×0.85
    if (this.ichorT > 0) return [255, 255, 0];                   // :92226-92229 整色替换（drip 两段后、hunter 钳底前）
    return hit ? [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)] : null;
  }
  /** oldTarget 等效（NPC.cs:6374 `public int target = -1;` + :8472/:91442 每帧
   *  `oldTarget = target;`）：-1=从未索过敌 → 首次 seekDirX 必转身（原版 oldTarget=-1
   *  使 :78553 门失效）；首次后恒 0（单人 target 槽位）→ 门生效 */
  hadTarget = false;
  /** TargetClosest + confused 反转（NPC.cs:78555-78572）：返回朝玩家的水平方向。
   *  无玩家时保持现方向（原版 TargetClosest 无目标不重算） */
  seekDirX(player: Player | null): number {
    if (!player) return this.facing;
    // ⑫-2 aggro 不转身门（NPC.cs:78549-78561 SetTargetTrackingValues faceTarget 段，
    //  普通 TargetClosest :78456 的 283 处 AI 调用均走此段）：
    //    bool flag = oldTarget >= 0 && oldTarget <= 254;      （:78553）
    //    bool num   = player.itemAnimation == 0 && player.aggro < 0;  （:78552）
    //    bool flag2 = !boss;                                  （:78554）
    //    if (!(num && flag && flag2)) { direction = …; directionY = …; }  （:78555-78561）
    //  → 玩家未挥击 && aggro<0（潜行）&& 曾索过敌 && 非 Boss：整段保留旧朝向。
    //  ★此段【无距离检查】；带 `num8 > 尺寸和/4+800` 距离门的是
    //  TargetClosestUpgraded(:78447-78452) 与 ShouldFaceTarget(:78318-78337)——
    //  两者在 1.4.5.6 本体源码中【零调用点】（mod API 面）。旧实现误取该距离门，
    //  已按实际调用路径对齐移除（2026-08-13）。
    //  itemAnimation==0 窗代理 = itemAnimTicks<=0 && useTime<=0（Player.ts:1353/:2264
    //  同口径；原版 itemAnimation 为挥舞动画窗，非挥砍武器由 useTime 代）
    const itemAnimZero = player.itemAnimTicks <= 0 && player.useTime <= 0;
    // 镇静不面向门（NPC.cs:78543-78546 SetTargetTrackingValues）：
    //   if (player.npcTypeNoAggro[type] && direction != 0) faceTarget = false;
    // faceTarget=false 时整段朝向更新跳过（direction 保留旧值）——与潜行门同落点，
    // 原版里它在 :78547 `if (faceTarget)` 外层判定，故先于潜行门生效。
    // ★SW-RB8c 2026-09-08 定谳：npcTypeNoAggro 唯一置位源=装备 3090（:14790-14814），
    // calmed 不置旗 → 门改 gel 专面（旧镇静并集撤销）
    if (CALMING_NO_AGGRO_TYPES.has(this.vanillaId ?? -1) && this.facing !== 0
      && royalGelActive(player)) {
      return this.facing;
    }
    if (itemAnimZero && player.aggro < 0 && this.hadTarget && !this.def.boss) {
      return this.facing;
    }
    this.hadTarget = true;   // 本次生效=原版 AI 后 target=0，下一帧 oldTarget 门激活
    const raw = player.cx > this.cx ? 1 : -1;
    return this.confused ? -raw : raw;
  }
  /** 原版索敌有效距离（NPC.cs:78485-78492 TryTrackingTarget——TargetClosest 选距）：
   *    num  = |player.cx - npc.cx| + |player.cy - npc.cy|  （曼哈顿距离，非欧氏）
   *    num -= player.aggro                                  （:78491）
   *    if (player.npcTypeNoAggro[type] && direction != 0) num += 1000;  （:78493-78496）
   *  aggro<0（潜行装/变态刀）→ 有效距离拉长 → 索敌门更难命中（敌人"看不见"）。
   *  同式变体：TargetClosestUpgraded :78375（欧氏）/NPCUtils.SearchForTarget
   *  :78230（欧氏）——后两者本体无调用点；以曼哈顿版为准。
   *  ★单人下 TargetClosest 的选距循环退化（仅一名玩家恒选它），本方法在本仓的
   *  落点是各 AI 族近似索敌门（canTargetPlayerAt）——原版索敌本身无距离概念 */
  effectiveTargetDist(player: Player): number {
    const num = Math.abs(player.cx - this.cx) + Math.abs(player.cy - this.cy);
    let dist = num - player.aggro;                       // :78491 num -= player.aggro
    // 镇静罚项（NPC.cs:78492-78495）：player.npcTypeNoAggro[type] && direction != 0
    // → num += 1000f。npcTypeNoAggro[type] 置位源 = 装备 3090 皇家凝胶（1457
    // Player.cs:14790-14814 逐项置位 23 类;镇静不置旗,NPC.cs:708-712 calmed 只吃
    // 刷怪率——★SW-RB8c 2026-09-08 定谳,旧「镇静∪凝胶」并集撤销改 gel 专面）。
    // ★单人语义：NPC.direction
    // 恒 ±1（本仓 facing 同构，:324 `vx>0?1:-1` / :675 缺省 1，无 0 值）→
    // 罚项对表内怪恒生效 = 索敌半径 +1000 曼哈顿（canTargetPlayerAt 门等效收窄）。
    if (CALMING_NO_AGGRO_TYPES.has(this.vanillaId ?? -1) && this.facing !== 0
      && royalGelActive(player)) dist += 1000;
    return dist;
  }
  /** 各 AI 族索敌门统一入口：有效距离（已按原版减 aggro）< range。
   *  接线现状：flyAI 恶魔眼式 18 格门（原版无此门，为仓内近似；见 flyAI 注） */
  canTargetPlayerAt(player: Player, range: number): boolean {
    return this.effectiveTargetDist(player) < range;
  }
  // ================= M11 多人索敌（TargetClosest 全玩家槽，NPC.cs:78456-78472） =================
  /** 原版 NPC.target 槽位的本地等价：TargetClosest 每 AI tick 刷新的当前目标玩家。
   *  粘性：无候选（全员 dead/ghost）时保留上一目标（原版 target 字段不清零，
   *  SetTargetTrackingValues 直接沿用旧槽位 :78527-78528 → 尸体坐标照消费）。
   *  null = 从未有过目标（原版 target=-1 初值，:6374）。
   *  傀儡敌怪（访客端）fixedUpdate 早退不跑 AI，恒 null。 */
  targetPlayer: Player | null = null;
  /** TryTrackingTarget 选距原式（NPC.cs:78503-78505 逐字符照抄）：
   *    num = |p.x + p.w/2 − position.X + width/2| + |p.y + p.h/2 − position.Y + height/2|
   *  ★基准是 NPC **左上角 position** 加自宽半偏置，非两中心间曼哈顿（x 项恒等于
   *  |Δ中心 + width|——对比较两名玩家仍是原式口径，勿"修正"成中心距）。
   *  :78510/:78512 realDist 同式重算（不带 aggro/镇静罚项），但 SetTargetTracking
   *  Values 形参未被使用（死参数）——不落地。 */
  private targetMetric(p: Player): number {
    return Math.abs(p.x + p.w / 2 - this.x + this.w / 2)
      + Math.abs(p.y + p.h / 2 - this.y + this.h / 2);
  }
  /** TargetClosest 1:1（NPC.cs:78456-78472 主循环 + TryTrackingTarget :78501-78536
   *  选距段）：扫候选玩家（active && !dead && !ghost——ghost⊆dead，本仓无独立
   *  ghost 位；active 门=候选表构造即活，Game.candidatePlayers），取最小者写
   *  this.targetPlayer。fixedUpdate 头部每 AI tick 调（原版各 AI 族每帧调）。
   *  - aggro 减量 :78507 / 镇静 +1000 罚项 :78508-78510（CALMING_NO_AGGRO_TYPES
   *    × Calming buff——代理无 buff 同步，访客永不触发罚项，数据链限制）；
   *  - :78511 `!t || num < distance`：首个候选必取，平距取先扫描者（严格 <，
   *    候选序 [本地(槽 0), …代理] 对齐原版槽序）；
   *  - 无候选【不清目标】（粘性，见 targetPlayer 注）。
   *  未落地段：①tankPet 嘲讽宠支（:78518-78535，本仓无 tankPet 实体）；
   *  ②SetTargetTrackingValues 朝向/转身门（:78516-78572）——direction/directionY
   *  的赋值与 aggro 不转身门在各 AI 族 seekDirX(目标) 消费同一语义（本仓架构：
   *  TargetClosest 只选目标不抢朝向）；③netUpdate 网络位（房主权威模型无此链）。 */
  private targetClosest(game: GameHooks): void {
    const cands = game.candidatePlayers?.()
      ?? [(game as unknown as { player?: Player }).player];
    let distance = 0, t = false;
    for (const p of cands) {
      if (!p || p.dead) continue;
      let num = this.targetMetric(p);                       // :78503-78505
      num -= p.aggro ?? 0;                                  // :78507 num -= aggro（真 Player 恒数值；?? 0 护测试桩）
      if (CALMING_NO_AGGRO_TYPES.has(this.vanillaId ?? -1) && this.facing !== 0
        && royalGelActive(p)) num += 1000;   // :78508-78510（★SW-RB8c gel 专面）
      if (!t || num < distance) {                           // :78511
        t = true; distance = num; this.targetPlayer = p;
      }
    }
  }
  /** MP 交互登记（NPC.ApplyInteraction :80843-80859 等价）：slot 打击过本怪 →
   *  per-client 掉落族（Boss 袋/大师宠物）的发放门。realLife 链（:80845 打到
   *  realLife 宿主——共享生命蠕虫族任一段被打全族登记）以链体遍历覆盖;
   *  双子 125/126 互标（:80829-80837——另一半的交互位同置,双活同打各得袋） */
  applyNetInteraction(slot: number, game?: GameHooks): void {
    this.interactionSlots.add(slot);
    let head: Enemy = this;
    while (head.wormFollow) head = head.wormFollow;
    for (let s: Enemy | null = head; s; s = s.wormNext) s.interactionSlots.add(slot);
    if (this.vanillaId === 125 || this.vanillaId === 126) {
      const other = this.vanillaId === 125 ? 126 : 125;
      for (const o of game?.enemies?.() ?? []) {
        const e2 = o as Enemy;
        if (e2 !== this && !e2.dead && e2.vanillaId === other) e2.interactionSlots.add(slot);
      }
    }
  }
  /** 原版各 AI 族 `Main.player[npc.target]` 读法：当前索敌目标优先，无目标史
   *  回退本地玩家（原版 :78526-78528 target<0 钳 0 → 槽 0 = 房主本地）。
   *  fallback = 该 AI 族的分发传参（分发层已把死亡滤成 null 时的兜底链尾）。
   *  单机无代理 = 恒本地玩家（targetPlayer 即本地），零回归。
   *  game 可选（AI_020 火轮等签名 game?: GameHooks——undefined 时仅剩粘性目标） */
  targetRef(game?: GameHooks, fallback?: Player | null): Player | null {
    return this.targetPlayer
      ?? (game as unknown as { player?: Player } | undefined)?.player
      ?? fallback ?? null;
  }
  /** 本 tick 实体点光（原版 Lighting.AddLight，Game 渲染前扫描落入光照引擎）；
   *  AI 每帧重写，null=不发光（萤火虫闪烁/发光蜗牛/魔化夜 crawler） */
  lightRGB: [number, number, number] | null = null;
  /** 点光像素坐标覆盖（缺省=实体中心）：光源不在中心格的原版语义位——
   *  火把僵尸 590/591 手持火把（NPC.cs:57309-57366，±22/±36px 偏移格） */
  lightRGBAt: { x: number; y: number } | null = null;
  lai0 = 0;              // localAI 语义位（萤火虫：闪烁间隔计时）
  lai1 = 0;              // localAI 语义位（萤火虫：发光剩余帧）
  lai2 = 0;              // localAI[2] 语义位（AI_054 克脑：二阶段入场演出门；AI_007 critter：卡墙折返粘滞计数——NPC.cs:54789 `localAI[2]++>=30` 短路累加,仅触发时清零再积（无衰减清零）;★BJ704-G6 D13。两族不共实例）
  lai3 = 0;              // localAI[3] 语义位（AI_054 克脑：玩家死/离场下坠计数；AI_008 法师 32：RedHat 变体带 +3）
  /** 红帽骷髅王标记（NPC.cs:81262-81266 redHatMode 召唤置 ai[3]=1；RedHatSkeletron
   *  AdjustmentsEnabled :67282 消费——35 看 ai[3]、36/32 看 localAI[3]、33 看 ai[3]）。
   *  ★召唤链已接通（Game.updateSitting，2026-08-18）：夜间坐长凳 89 款式 43 +
   *  装备裁缝巫毒娃娃(equipStats.killClothier) + 裁缝师 54 在场 CanHit →
   *  SpawnSkeletron(redHatMode:true)，此处写 true 且 ai3 同步写 1（NpcDrops 五条
   *  RedHat 条件/Renderer 红臂骨/GorePiece gore 表全依赖此旗）。
   *  32 的 lai3 变体带/双倍计时由此激活（casterAI aiInit 段每帧扫描消费）。 */
  redHat = false;
  /** 原版 NPC.dontTakeDamage（SetDefaults 静态置位，如 266 克脑 :12372 一阶段
   *  不可击；AI 段自行清除）。与 iframes 不同：持续态而非帧计数 */
  dontTakeDamage = false;
  /** 原版 NPC.dontTakeDamageFromHostiles（NPC.cs:6284）：仅敌意来源免伤——玩家
   *  伤害通道（StrikeNPC/弹幕 Damage_PVE friendly 链）【不】设此门。消费面=
   *  GetHurtByOtherNPCs 头门（:93557 与 dontTakeDamage 并列）/敌对弹伤 friendly
   *  门（Projectile.cs:12626 Damage_PVE_Inner flag2）/索敌水晶候选
   *  （NPCUtils.SearchFilters.OnlyCrystal :16-21）。置位方=AI_105 胜/败演出
   *  （:41170/:41280 每拍重写）、checkDead 548 血尽转换（:78896）、AI_112 仙灵
   *  引导态（:49119 与 dontTakeDamage 同掷）。复位=SetDefaults 尾（:8529）——
   *  1457 无 NPC.ResetEffects 调用位（grep 全文件零命中,原版无每帧复位）,本仓
   *  同款「字段缺省+置位方每拍重写」惯例（与 dontTakeDamage 先例同构）。★BJ450
   *  （SetDefaults 静态置位型 374 松露虫/:375/:686 本仓无消费通道——375/686
   *  原版即不在该表=旗为摆置——登记不扩）。★BJ454 清偿 374 面：T-set 受害门
   *  已建模（TAKES_DAMAGE_FROM_HOSTILES 表+互殴通道 :91592 门）。★BJ468 翻案：
   *  「摆置」判语只查 T-set 通道漏蜂通道（:91601 CanBeHurtByBees :4789
   *  CreateBoolSet(true,210,211,222)=除 210/211/222 全真）——375/686 蜂通道开而
   *  头门（:93557）闭=拒蜂蜇、374 双通道开=敌怪接触+蜂蜇全免疫,静态置位已补
   *  （下方表,fromVanilla/tryTransformTo 双路同参;BJ454「374 被僵尸互伤」行为锁
   *  同批翻案,见 tests/bj454-dd2-edge-three.test.ts 翻案腿） */
  dontTakeDamageFromHostiles = false;
  /** ★BJ468：SetDefaults 静态置位型 dontTakeDamageFromHostiles（1457 NPC.cs:13803 374
   *  藏匿松露虫/:13822 375 遁地松露虫/:17670 686 笨笨气球史莱姆;1456 同 :13707/
   *  :13726/:17573;序章 :8529 复位,无每帧复位）。玩家/弹幕 Damage_PVE 通道不设此门
   *  （照常可捕可杀）;判别测试 tests/bj468-hostile-immunity-setdefaults.test.ts */
  private static readonly DONT_TAKE_DAMAGE_FROM_HOSTILES_SETDEFAULTS = new Set([374, 375, 686]);
  /** 击退抗性运行时覆写（游泳族专用）：461 wet→0 / dry→0.4（难度曲线，
   *  NPC.cs:56366/:56412 GetKnockbackMultiplier_ScaledByDifficulty）；null=用 def 值 */
  kbResistOverride: number | null = null;
  /** 694 水书宝箱怪专用帧计数（FindFrame case 694 frameCounter，态切换清零） */
  npcFrameT = 0;
  /** AI 侧算定的帧号直读位（694 态机帧；null=走渲染端 vanillaFrameIdx 通用档） */
  customFrameIdx: number | null = null;
  /** 渲染端网格帧引擎回填位：drawDd2OgreGrid（576/577）与 drawDeerclopsGrid（668）
   *  每次绘制把 dd2OgreNextFrame / deerclopsNextFrame 的输出（=原版 FindFrame 帧
   *  索引 frame.Y）写回本字段。消费方=玩家接触侧 GetMeleeCollisionData 的食人魔
   *  近挥帧窗（NPC.cs:96185-96235 y∈15..18 → specialHitSetter=2+专盒×1.75）与
   *  鹿角怪斧臂帧判定（:96253-96278 y==15 ∧ ai[0]!=4）。相位锚证：原版
   *  DoUpdateInWorld_Inner 内 UpdateWorld_Players 先于 UpdateWorld_NPCs
   *  （Main.cs:17929/:17938/:17952）⇒ 接触环读到的就是【上一拍】FindFrame 终值；
   *  本仓渲染落盘同理晚一拍——位序等价。null=尚未绘过（出生首拍/离屏）→ 按窗外
   *  处理（General 桶 + 裸盒），与旧路径无差。 */
  vanillaGridFrameIdx: number | null = null;
  /** 运行时 noGravity 位（原版 NPC.noGravity 逐 tick 置位，StrikeNPC :82217/:82228
   *  受击档读【运行时值】非静态表）：AI_017 秃鹫(:24079 飞行态 true/栖息 0 态 false)、
   *  AI_087 珍珑宝箱怪(:39525 起始 false、4/4.1/5 空中态 true)、AI_091 花岗岩元素
   *  (:40688 起始 true、-1 石化态 false)在各自 AI 内同步置位；hurt() 读
   *  noGravity || def.flying（def.flying=静态兜底，覆盖数据 noGravity 族与
   *  aiStyle 2/5/14/23/44 恒飞行族） */
  noGravity = false;
  /** 原版 justHit 语义（本 tick 内受过击） */
  get justHit(): boolean { return this.justHitT > 0; }
  /** 原版 netID 变种（负数 SetDefaultsFromNetId）：scale/颜色/属性覆盖 */
  vanillaScale = 1;
  /** 携物史莱姆（SlimeCanContainItems 且 ai[1]>0，NPC.cs:61088-61089 门）逐档梯
   *  的 defDamage/defDefense/knockBackResist/defLifeMax 基线快照——原版四字段只读，
   *  本仓 def.* 为可变位，梯段每 tick 以基线重算（:61107-61433 全梯消费） */
  slimeItemBase?: { dmg: number; def: number; kb: number; hp: number };
  /** 上一 tick 位移段的碰撞前 vy（原版 oldVelocity.Y，NPC.cs:93739 AI 后、
   *  TileCollision 前快照；groundPhysics 每次调用后写入）。消费点：AI_001
   *  携物梯 :61309 气球史莱姆落地弹跳 / :61932/:62124 落地嵌固回退（配对
   *  collideY=TileCollision 层 Y 碰撞位） */
  preCollideVy = 0;
  /** ★SW-BJ6 2026-09-07：vanilla 嵌固回退漂移活跃旗——:61932/:62124 两处
   *  `position.X -= velocity.X + direction`（NPC.cs:62139/:62331）执行的当拍置位，
   *  由 TileCollision.unembedPass 消费即清（consume-once）：原版无 unembed 等价
   *  机制，嵌入体由该漂移每拍 1px 自行解卡，unembedPass 在漂移活跃期整段让位
   *  （坡角相移穿越案：流浪汉舌 (1825,317) s1 坡角，实录 t=188-211）。 */
  unwedgeDrift = false;
  /** ★SW-BJ9 2026-09-07：嵌固漂移 episode 终止闩（**刻意偏离原版**——产品拍板
   *  「避免穿墙，哪怕偏离原版」）。原版漂移（NPC.cs:62139/:62331）在「地坡高端邻
   *  实心柱」几何下不自限：SolidCollision(:2713) 坡格整块盒令嵌固判定恒真 +
   *  TileCollision 对已重叠体忽略(:2440) → 每拍 1px 匀速相移穿整条墙带（流浪汉舌
   *  (1825,317) s1 坡角实录 t=188-211）。本仓漂移步应用前先测「漂移后位盒全实心
   *  重叠」（激活感知谓词，见 fullSolidBoxOverlap）：命中 → 本拍取消 + 本闩置位
   *  （episode 终止，防逐拍磨墙）；只与坡格重叠 → 照常漂移（原版退坡楔功能保留）。
   *  清位锚 = 嵌固判定链断开（两漂移点 else 臂）——此后原版行为链自然继续
   *  （跳跃机/卡墙掉头接管）。范围铁律：仅 AI_001 两处漂移应用点进入本门
   *  （applyUnwedgeDrift 全体消费者），行走/跳跃/击退/液浮/unembed 救援等一切
   *  其它位移路径零触碰。 */
  unwedgeBlocked = false;
  /** 471 哥布林术士 defDefense 基线快照（NPC.cs:56891/:56920 飞行态 ×1.1 / 地面复原） */
  warlockDefBase?: number;
  /** 417 SolarSroller 态 6 伤害/防御覆写基线（原版 defDamage/defDefense = ScaleStats
   *  【后】快照 NPC.cs:18197——首入态 6 捕获、态 0 复位消费；直接读写 def.* 会逐 tick
   *  复利。AI_039 417 逐值批 2026-09-03） */
  srollerDefBase?: { dmg: number; def: number };
  /** 非 417 陆龟族 defDamage/defDefense 基准快照（首 AI 拍=ScaleStats 后、先于任何 AI
   *  写点）——态 0 每拍属性复位（NPC.cs:29453-29462）的 def 侧基准（R3 清债落位） */
  tortoiseDefBase?: { dmg: number; def: number };
  /** AI_039 oldVelocity.X 快照（NPC.cs:93681 `oldVelocity = velocity` 在 ApplyTileCollision
   *  :93687 之前——即"本拍 AI 写速后、碰撞改速前"的 vx；下一拍态 0 翻转臂
   *  `!justHit && velocity.X != oldVelocity.X`（:29469-29472）消费 = 上一拍碰撞是否改变
   *  了 vx（撞墙停/反向 → 折返）。tortoiseAI 每 tick 移动积分前写（与原版每拍写同相） */
  tortoiseOldVx = 0;
  /** NPC.canDisplayBuffs（★Z4/行号勘误 2026-10-02 审计 D6:NPC.cs:6206 默认 true /
   *  :8519 SetDefaults 复位——旧引 :6124/:8423 系漂移号）。
   *  FTW 世界 245-248 石巨人族置 false（getGoodAdjustments :18042/:18047/:18052，
   *  249 不置）。原版门控消费两处：GetNPCColorTintedByBuffs 染色门（NPC.cs:92142,
   *  早退 :92144;经 Main.cs:23170 DrawNPC 链调用）与 UpdateNPC_BuffApplyVFX
   *  （NPC.cs:92263）鞭标闪电粒子——后者即函数头 canDisplayBuffs 早退门 :92265
   *  （markedByEelWhip 鞭标蓝闪 :92270-92277 等粒子全谱在其内;旧引「:92026/
   *  Main.cs:22797/:92135」均系漂移号+函数错挂 Main.cs）——两消费者本仓未移植
   *  （debuff 自发光 :92263+ 段 UpdateNPC_BuffApplyVFX 不受此门——★BJ449 勘误
   *  2026-10-03:旧引 :92181+ 系 potentAcid 染色块行,漂移）,字段落地保数据链一致（批次B） */
  canDisplayBuffs = true;
  /** 实际生效的负 netID（SetDefaultsFromNetId；凝胶染色过滤用） */
  vanillaNetId = 0;
  /** 原版 NPC.color 当前值（SetDefaults/SetDefaultsFromNetId 初值，AI_001 逐 tick 渐变）。
   *  渲染语义（Main.cs:24527 + NPC.GetColor L94903）：color≠default 时用同贴图二次绘制，
   *  逐像素乘 color（贴轮廓）；通道 A 决定该 pass 强度 */
  colorRGBA: [number, number, number, number] | null = null;
  /** 原版 SetDefaults alpha：每类型静态不透明度基线（渲染 1-alpha/255，NPC.Opacity）。
   *  多数为 0=不透明；史莱姆 175/120=半透明凝胶、水母 20、蝙蝠 30 等。
   *  无通用渐隐——仅特定家族（幽灵/怨灵等）在自己的 AI 内衰减 */
  spawnAlpha = 0;
  /** 出生渐显中（仅原版 alpha=255 的 EoW 族）;静态半透明(史莱姆 175 等)不参与 */
  alphaFade = false;
  /** 原版 ai[0] 跳跳计数器（史莱姆 hop 节奏）；ai[2] 卡墙禁追冷却 */
  ai0 = -1120;
  ai2 = 0;
  /** 原版 ai[1]（史莱姆体内物品 id，驱动 SLIME_ITEM_COLORS 渐变色；0=无） */
  ai1 = 0;
  /** 原版 ai[3]（地牢 AI 族用：诅咒头骨状态/火轮速度档/刺球相位） */
  ai3 = 0;
  /** ★F2 黑化松鼠族运行时位（NPC.cs:53958-53974：CritterThatCanTurnOnPlayers ∧
   *  ai[3]!=0 → aiStyle=3 运行时翻转——原版 IsCritterThatIsHostileToPlayers
   *  （:19849-19856）读的是【实例】aiStyle，本仓 def.aiStyle 恒为出生值 7，
   *  故以该位承载"已转战士"事实；消费点 = projTargets.isCritterThatIsHostileToPlayers
   *  （dontHurtCritters 复权放行）∪ Enemy 接触伤害族） */
  blackenedCritter = false;
  /** 原版 directionY（火轮/刺球对角弹跳的纵向方向；AI_002 飘浮眼亦在此持久化——
   *  玩家死亡后 TargetClosest 无操作,沿用最后垂直方向滑行而非恒上飞） */
  dirY = 1;
  /** 渡鸦 301 spriteDirection（FindFrame case 301 :74257-74271 有态写点——
   *  落地=-direction、飞行 vx±0.5 滞回、|vx|≤0.5 死区保前值。缺省=-1 与
   *  原版 NPC.spriteDirection 字段缺省一致（NPC.cs:6430）。渲染层
   *  drawEnemy 消费（==1 镜像,Main.cs:22984） */
  ravenSdir = -1;
  /** AI_026 跳梯行进侧门的 spriteDirection 闩（NPC.cs:63513 num24）：86/155/329/
   *  315/410/423 全族在 AI_026 内【只】在卡墙折返写 spriteDirection=direction
   *  （:63251）——出生缺省 -1（Entity 字段缺省 :6522,SetDefaults 不复位）,
   *  平时是滞后闩;546 每 tick 写 -direction（:63571）。消费=跳梯门 num24
   *  (410/423/546 再 ×−1 :63514-63517)。不可用 facing 代位:facing(=direction)
   *  随仇恨重瞄逐帧翻转,闩不随(2026-09-02 遗留对齐批) */
  sdir26 = -1;
  /** AI 首帧初始化标记（原版 ai[0]==0 门在 ai0 初值 -1120 的史莱姆语义下不可用） */
  aiInit = false;
  /** AI_024 鸮族 localAI[0]（出生即飞行一次性门,NPC.cs:25410-25416） */
  owlAirborneInit = false;
  /** AI_007 TownCritter homeTileX/Y（NPC.cs:53696-53699 出生一次锚：X=出生列,
   *  Y 恒 -1 → flag22(StepDown/holdsMatching) 恒 true；雨天鱼链 :94101/:94114
   *  会把 X 挪 position.X/16+10×direction） */
  critterHomeX = -1;
  critterHomeY = -1;
  /** ★BJ704-G6 D13：AI_007 卡墙折返快照（=原版 oldPosition :93748 移动前 /
   *  oldVelocity :93681 碰撞前——townCritterWalkAI 尾 moveAndCollide 前采样,
   *  行走臂尾卡墙检查（NPC.cs:54789）消费;仅本 AI 族读写,初值 0=首拍无可比
   *  （x===0 不可达）自然不触发） */
  critterPreMoveX = 0;
  critterPreMoveY = 0;
  critterOldVX = 0;
  critterOldVY = 0;
  /** AI_112 仙灵 localAI[1] 寿命计数（仅引导态 ai[2]>1 才累计,cs:48459-48473;
   *  与各状态复用的 ai3 计时器分离——曾共用导致寿命被状态转换反复清零） */
  fairyAge = 0;
  /** AI_112 仙灵圆舞行进向快照（入态 3/5 时写=direction 语义）：原版圆舞期间
   *  GetFairyCircleOffset 的 X 幅 6·−direction 与摆轴 ±π/8 全程读【行进向】,
   *  而舞中只直写 spriteDirection（:48797/:49073）不改 direction——本仓 facing
   *  双责（行进向+渲染面）,舞中被 danceFace 写覆写,故入态时快照分离
   *  （2026-10-02 BJ434 全量重写随刀） */
  fairyDanceDir = 1;
  /** AI_013 植物 stale target 偏移（玩家死亡时保持最后伸展目标——原版 :22655
   *  直读 target 槽位坐标,无 dead 门;曾缩回锚点发呆） */
  plantLastOx = 0;
  plantLastOy = 0;
  // ---- AI_127 Palworld 双宠（NPC.cs:43239-43339）状态 ----
  /** 威慑双僵尸直引用（原版 ai[1]/ai[2] 存 npc 槽位+1；null/死 = 已解） */
  palZombies: Array<Enemy | null> = [null, null];
  /** 原版 soundDelay（守望期 Pain 音随机间隔 600-1800；欢庆段 -2 哨兵只播一次） */
  palSndDelay = 0;
  /** 威慑态僵尸 → 被威慑的双宠直引用（原版僵尸 ai[3]=-(pal+1) 反查；
   *  AI_003 :57369-57407：面向宠贴地站立，受击或玩家 <200px 转普通僵尸） */
  menacePal: Enemy | null = null;
  /** 原版 immune[255]（NPC-vs-NPC 接触通道：蜜蜂反蜇/树妖结界荆棘共用的 30t 槽）——
   *  与玩家命中的 iframes 分离（原版按槽位独立计时） */
  npcImmune255 = 0;
  /** 原版 timeLeft（CheckActive 屏内每 tick 重置；activeTime=750，非 7500） */
  despawnTimer = 750;
  /** Boss 离场逃走标记（EncourageDespawn/天亮撤离等非击杀消亡）：
   *  Game 记账分支据此区分「逃走」（不播击败公告、不写 downed 标志）与「被击败」 */
  bossFled = false;
  /** 原版 despawnEncouraged（EncourageDespawn 置位，屏内重置清除） */
  despawnEncouraged = false;
  /** 蜗牛象限 spriteDirection（NPC.cs:34763-34795 表锁存值，±1；渲染层
   *  aiStyle67 专用局部翻面通道——XNA 的 translate→rotate→scale(flip) 组合里
   *  翻面沿【已旋转的局部 X 轴】施加，与通用 facing 镜像（未旋转轴）不同源）。
   *  默认 -1 = 不翻（与原版 spriteDirection 缺省一致） */
  snailSdir = -1;
  /** 鲨龙卷 372/373 spriteDirection（AI_071 :35196-35315）：AI direction 与
   *  spriteDirection 是**两个字段**——蓄力段(ai0=0) 373 摆头向按 cos 符号写
   *  spriteDirection（:35219-35221），372 全程不写（恒字段缺省 -1）；起扑段
   *  TargetClosest 后 spriteDirection=direction（:35254）随 facing。缺省 -1 =
   *  不翻（Entity 字段缺省 :6522，NewNPC 不复位）。渲染层 372/373 flip 消费
   *  （蓄力段读本字段，起扑后读 facing） */
  sharkronSdir = -1;
  /** ★BJ591 DD2 滑翔怪 574/575 帧档态（FindFrame case 574/575,NPC.cs:68658-68751
   *  的 frame.Y/frameCounter 侧写——有态机,renderer 通用 6t 档无法承接）:
   *  koboldFrameY = 帧号 0..9（ai0!=0 滑翔支 2..9 每 4/8t 推进钳 9、落地支 0..1
   *  每 6t 乒乓 :68741-68749）;koboldFC = frameCounter（帧推进重置、帧 9 钳住后
   *  无界增长——拖尾 maxValue 阶梯 60/180/300/600 的驱动源 :68713-68727）。 */
  koboldFrameY = 0;
  koboldFC = 0;
  /** ★BJ706-A DD2 walker 族（AI_107 竖条帧条,552-557/561-563/566-573）帧档态
   *  ——FindFrame 各专属 case（NPC.cs:67793-68608）的 frame.Y/frameCounter 侧写。
   *  dd2WalkFrame ≙ frame.Y/num（当前帧行）,dd2WalkFC ≙ frameCounter（单计数器
   *  全相位共用：攻击带内 ++ 推进、行走 += |vx|、腾空/站定清零——原版同字段
   *  NPC.frameCounter 跨相位携带,本字段 1:1 承接）。修前：Renderer vanillaFrameIdx
   *  通用 fighter 档（ai===107 → 行走 2..frames-1/站定 0/腾空 frames-1）把各族
   *  攻击帧行当行走帧播——枯萎兽 568 走路播灵气带 7-16（60% 帧）、德拉肯 570
   *  播喷吐带 10-15（43% 帧）+ 腾空/站定帧全错（原版 4/6 与 1/9,通用档 16 与 0）
   *  = 用户实报「一直倒着走」（贴图姿态错乱）。 */
  dd2WalkFrame = 0;
  dd2WalkFC = 0;
  /** ★BJ588 FindFrame case 48..664 死区档 15 型族（FF_VXSDIR_GROUP）的显示面
   *  spriteDirection（NPC.cs:75648-75655 if/if 死区档——vx==0 不写=保前值）。
   *  缺省 -1 ≙ 原版 Entity.spriteDirection 字段缺省（:6522,NewNPC 不复位）。
   *  独立字段的缘由：这 15 型的 AI（batAI/ghostAI/AI_122）把 facing 当原版
   *  direction 用（索敌/探针列/失靶滑行）,原版 direction 与 spriteDirection 是
   *  两个字段——FindFrame 只写后者,代位会污染 AI。渲染层 drawEnemy
   *  ffSdirMirror 门消费（==1 镜像,Main.cs:23357-23361）。写点=Enemy.
   *  findFrameRotation 族支（AI 后同拍,≡原版 FindFrame 每 update :91626）。
   *  此前债形态：蜂 210/211 无任何写点+渲染走通用 facing 门（缺省 1）=恒镜像面
   *  （BJ581 案组登记,本刀收编） */
  ffSdir = -1;
  inWater = false;       // 入水检测（溅落声用）
  /** Boss 专属初始化标记(部件生成等一次性动作;aiN 默认值有歧义故独立字段) */
  bInit = false;
  /** 部件 → 主体引用（骷髅王手 36 → 头：渲染臂骨 IK 与存活判定用） */
  master: Enemy | null = null;
  /** 原版 NPC.reflectsProjectiles（NPC.cs:6019）：冲刺中反射玩家弹幕（419 旋刃怪
   *  cs:57171 置位；Projectile.cs:12050 命中前反射——CanBeReflected 弹型白名单 +
   *  ReflectProjectile cs:67036 反向归属玩家管线未接，登记依赖） */
  reflectsProjectiles = false;
  /** 原版 NPC.takenDamageMultiplier（NPC.cs:6018，StrikeNPC :81997-82000 防
   *  御结算后 ×N）：419 旋刃冲刺中受击 ×3（cs:57172） */
  takenDamageMultiplier = 1;

  constructor(public key: string, x: number, y: number) {
    super();
    this.def = ENEMY_DEFS[key] ?? PLACEHOLDER_DEF;
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.w = this.def.width;
    this.h = this.def.height;
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
  }

  /** 贴附族层数登记（projStatus.applyProjStatus 施加 169/183/337/344 时调用，
   *  等价原版一枚贴附弹入场的 KillOldestJavelin 检查 :13019-13030）：
   *  push 一层（寿命=dur 秒），超上限杀最老（最早入池者剩余时间最低，对应
   *  原版扫 timeLeft 最低者 Kill，:13995-14020）。598=6 / 614=10；
   *  971/975 不在 :13021 白名单 → 无上限 */
  addStickerStack(buff: 169 | 183 | 337 | 344, dur: number): void {
    const arr = buff === 169 ? this.javelinStacks : buff === 183 ? this.stardustStacks
      : buff === 337 ? this.spikeStacks : this.butcherStacks;
    const cap = buff === 169 ? 6 : buff === 183 ? 10 : Infinity;
    arr.push(dur);
    while (arr.length > cap) arr.shift(); // 最老离池
  }

  fixedUpdate(dt: number, game: GameHooks) {
    this.prevX = this.x; this.prevY = this.y;
    // 联机傀儡（房主权威快照驱动）：无本地 AI——P3.2 插值/外推推进 + 动画计时，
    // 打击/拾取等交互经 entityNet 上报房主结算
    if (this.netPuppet) {
      this.aiT++;
      this.animT++;
      this.netPuppetStep();
      this.onGround = Math.abs(this.vy) < 0.6;
      if (Math.abs(this.vx) > 0.05) this.walkCycleT += Math.abs(this.vx);
      this.turtleFindFrameStep();   // ★BJ700b 傀儡龟帧机推进（wet 未同步→干侧语义,联机近似备案）
      if (this.iframes > 0) this.iframes--;
      this.recordTrailHistory();   // 傀儡无本地 AI 但拖尾渲染同样需要历史位置
                                   // （同走 TrailingMode 分派;ai0 未同步的傀儡宝箱怪
                                   //  落清零支=拖影不画,房主权威渲染,登记债）
      return;
    }
    this.aiT++;
    if (this.iframes > 0) this.iframes--;
    if (this.justHitT > 0) this.justHitT--;
    if (this.npcImmune255 > 0) this.npcImmune255--;   // immune[255]（NPC-vs-NPC 接触槽）
    this.lightRGB = null; // 点光由 AI 每帧重写（不残留上一帧状态）
    this.lightRGBAt = null;
    if (this.hpBarT > 0) this.hpBarT--;
    if (this.squash !== 0) this.squash *= 0.85;
    this.animT++;
    this.walkCycleT += Math.abs(this.vx); // 原版 zombie/fighter 行走帧按 |vx| 累加（L77072/L70216）
    // 原版 case46 族 vx==0 清 frameCounter（NPC.cs:77571-77577）——站定即清相位，
    // 起步必从帧 0 起稳走（2026-08-18 审查：曾保留相位起步首帧非 0）
    if (Math.abs(this.vx) <= 0.05) this.walkCycleT = 0;

    // 出生渐显（alphaFade 族，AI 分发【前】的近似段）——静态半透明不受影响。
    // EoW 族（13-15）除外：走下方 AI 分发后的 1:1 段（移动门 -42/t，NPC.cs:52650-52670）；
    // 血鳗鱼 621-623 同理：走下方 1:1 链门渐显段（-42/t，NPC.cs:51399-51421）
    if (this.alphaFade && !(this.vanillaId !== null && this.vanillaId >= 13 && this.vanillaId <= 15)
      && !(this.vanillaId !== null && this.vanillaId >= 621 && this.vanillaId <= 623)) {
      this.spawnAlpha = Math.max(0, this.spawnAlpha - 1);
      if (this.spawnAlpha === 0) this.alphaFade = false;
    }

    // M11 索敌：TargetClosest 每 AI tick 刷新（原版各 AI 族帧首调用，NPC.cs:78456）。
    // player 语义升级 = 原版 Main.player[npc.target]：优先本帧索敌目标（联机含访客
    // 代理——房主端敌怪会追击访客），无目标史回退本地（原版 target 钳 0 → 槽 0）。
    // 单机无代理 = 恒本地玩家，分发行为零回归。
    // ★localPlayer 独立保留：接触伤害/蜂蜜 buff 走本地玩家结算（victim-settles——
    // damagePlayer 只扣本地血；访客被撞由其端 netPuppetContact 对傀儡本地结算）。
    const localPlayer = (game as unknown as { player: Player }).player;
    this.targetClosest(game);
    const player = this.targetRef(game);
    const hasPlayer = !!player && !player.dead;
    // Collision_DecideFallThroughPlatforms（NPC.cs:94118-94252 全表 1:1）——
    // 原版 Update 在 AI 后、ApplyTileCollision 前逐 tick 求值（本仓物理在 AI 内,
    // 取上一 tick 态=标准一拍滞后等价）；true = 平台不作为落面（下落穿透）。
    // 恶魔眼/飞行武器/蜘蛛/幽灵等飞行族恒穿;战士族 aiStyle3 仅 directionY==1
    // （下落中）穿、落地 dirY 归 0 恢复站面。玩家不受此表（Player 侧 inputDown）
    this.dropThrough = this.decideFallThroughPlatforms(game);

    // ---- 原版数据驱动路径：按 aiStyle 分发到已移植的 AI 家族（分发后落入共享尾段） ----
    // 蠕虫身体段（wormFollow 非空）无 AI：位置由头部 wormAI 沿链驱动，但仍走共享尾段（接触伤害等）
    // 例外：EoW 三段各段独立跑 eowAI（断链自查 + 身/尾自跟随，:51874/:52266），
    // 不再由头统一驱动链——断链拆分后每条子虫的头各自驱动
    const eowSeg = this.vanillaId !== null && this.vanillaId >= 13 && this.vanillaId <= 15;
    const wormBody = this.wormFollow && !eowSeg;
    // 小动物（critter）优先走被动游荡，绝不落入 default 的追击 fallback
    if (this.vanilla && !wormBody && this.vanilla.critter && takeModNpcAi(this.vanillaId) === null) {
      // ★P4 红蓝修正(C-MINOR-6):mod AI 已注册的 critter 不走被动游荡(旧序 npcAi
      //  注册被 critter 前置支静默吞掉);原版 critter 域 takeModNpcAi 恒 null 零扰动
      this.critterWanderAI(game, hasPlayer ? player : null);
    } else if (this.vanilla && !wormBody && !runModNpcPreAiBlocked(this, game as unknown as Game)) {
      // ★B 批:GlobalNPC PreAI(全域;返 false=本 tick 跳过 AI 派发——mod 返 false 面只在
      //  本 vanilla 分支生效;wormBody 链驱段/critter 前置支不适用=登记)
      const p = hasPlayer ? player : null;
      // ★mod AI 派发（2026-10-04,docs/mod-loader-design.md §2.3）：mod NPC（800+）
      //  经 entry.js 的 sw.npcAi 注册了自定义 AI 时整支接管（不走原版 switch），
      //  共享尾段（接触伤害/击退/掉落）照走——与 critter/wormBody 前置分支同构。
      //  空注册/原版域=Map size 短路零成本，行为逐位恒等（中立性金标锁）。
      // ★一百三十九刀:vanilla AI 覆盖(mod 侧复仇变体族;先于 mod NPC 派发)
      const vAi = this.vanillaId === null ? null : takeVanillaNpcAiOverride(this.vanillaId);
      if (vAi !== null) {
        vAi(this, game as unknown as Game, p);
        // ★红队 R-A-m2:PostAI 无条件(tML 逐字)——vAi 整支接管也要发(旧 return 直出=跳)
        runModNpcPostAi(this, game as unknown as Game);
        return;
      }
      const modAi = takeModNpcAi(this.vanillaId);
      if (modAi !== null) {
        // GameHooks→Game:本实参运行时恒为全量 Game 实例(Enemy 形参窄化仅类型面)
        modAi(this, game as unknown as Game, p);
      } else switch (this.vanilla.aiStyle) {
        case 92: this.dummyAI(game); break;                            // AI_092 训练假人（NPC 488）
        case 1: this.slimeAI(game, p); break;                          // AI_001 史莱姆
        case 2: this.floatEyeAI(game, p); break;                        // AI_002 飘浮眼（原版核）
        case 3:
          // AI_003 拜月教弓手 379/380 仪式待机（NPC.cs:56575-56601,ai[3]<0 静立面碑零伤；
          // 碑置 ai[3]=0 后激活复位 :56602-56609,回战士核）——bossAI_lunar_misc
          if ((this.vanillaId === 379 || this.vanillaId === 380) && this.ai3 < 0) {
            cultistArcherStandbyAI(this, game);
            break;
          }
          if (this.vanillaId === 379 || this.vanillaId === 380) cultistArcherWake(this);
          this.fighterAI(game, p);
          // 火把僵尸 590/591 手持火把发光（NPC.cs:57309-57366 AI_003 内 type 段）：
          //  590 按朝向取 (Center±22 / y+6) 格，火把格与相邻格均无液体才点亮；
          //  591 持械变体 !wet 即亮，偏移 ±36/±28（专家变体，尘需 ai[2]==0 门）。
          //  色 (1, 0.95, 0.8) = 与手持火把同色；尘 6 号 1/30 概率
          if (this.vanillaId === 590 || this.vanillaId === 591) this.torchZombieLight(game);
          // AI_003 火星尾段（bossAI_martian.ts）：军官 383 带盾无敌/补盾、工程师 386 放炮塔
          if (this.vanillaId === 383 || this.vanillaId === 386) martianFighterExtras(this, game, p);
          break;                                                        // AI_003 战士族（原版通用核）
        // EoC 传参例外:玩家死亡也要传原对象(cs:19931 dead 判定走逃离分支,
        // 冲刺计时合法冻结;传 null 会让 aiT 照走、状态机停摆 → 首冲时长翻倍)
        case 4: this.eocAI(game, player ?? null); break;   // AI_004 克苏鲁之眼（NPC.cs:19909）；M11：分发级索敌目标（联机可为访客）
        case 5: this.swarmerAI(game, p); break;                         // AI_005 噬魂怪族（原版蜂群核）
        case 6:
          // AI_006 蠕虫族（头）；412 爬尾虫走专属核（bossAI_lunar_misc：
          // 30 段链 + 空泳追击环 + 414 尾受击红闪 localAI[2] 状态机，cs:51357-52671）
          if (this.vanillaId === 412) crawltipedeAI(this, game, p);
          else this.wormAI(game, p);
          break;
        // ★BJ703-C D3（2026-10-21）：aiStyle 7 非 CountsAsCritter 面（唯 614 爆炸兔
        //   ——453 骷髅商走 TownNPC 桶不达此）此前落 default zombieAI（释放 1338 放出
        //   的兔追人=非原版）；原版 aiStyle 7 一律 AI_007（NPC.cs:18879 case 7，
        //   isLikeATownNPC=false → critter 游荡支）——路由 critterWanderAI（内层
        //   default → townCritterWalkAI）。★614 不在 TownCritter 集（NPCID.cs:4827）,
        //   其走/站计时器三闸差异（:54287/:54308/:54382-54389 + 夜间即停支
        //   :54352-54358）登记债 BJ703-C D7。
        case 7: this.critterWanderAI(game, hasPlayer ? player : null); break;
        // 玩家死亡也传原对象（A 批 2026-08-19）：法师族对尸体坐标继续运转（cs:20786
        // TargetClosest→:78539 dead 时 faceTarget=false 只冻结朝向,传送采样/弹幕照跑）
        case 8: this.casterAI(game, player ?? null); break; // AI_008 法师族（传送+弹幕）；M11：分发级索敌目标（尸体语义同 case 4）
        case 10: this.cursedSkullAI(game, p); break;                     // AI_010 诅咒头骨（地牢飞行族）
        case 11:
          // 68 守卫走专用分支（bossAI.skeletronBossAI 注释"守卫分支已在 skeletronHeadAI"
          // 即此拆分：守卫恒速追击与骷髅王战斗状态机互不混用）
          if (this.vanillaId === 68) this.dungeonGuardianAI(game, p);
          else skeletronBossAI(this, game, p);
          break;                                                         // AI_011 骷髅王头战斗核/地牢守卫
        case 12: skeletronHandAI(this, game, p); break;                    // AI_012 骷髅王手(锚定头)
        // ★aiStyle↔type 权威对齐（SetDefaults :9708-9724 + AI 分发 :24662/:24740，
        //  名字权威 = NPCID.cs:11205/:11209：70=SpikeBall 刺球、72=BlazingWheel 火轮）：
        //  type 70 刺球 = aiStyle 20（锚点 ai[1]/ai[2] 像素 + 随机速档 6×(1+Next(15)×0.1)
        //  + 初段垂直俯冲 15t + 恒速弹跳加速——锚链摆荡体,渲染面 Main.cs:23087-23113
        //  锚链+锚座）；type 72 火轮 = aiStyle 21（恒速 6 对角 + rotation ±0.13/t 滚动）。
        //  1405/1456/1457 三版一致 → 现行 dispatch 正确;两个函数名沿用历史（互换）,
        //  行为归属以本注为准（2026-09-02 勘误：旧注释把 70/72 名字写反）。
        case 20: this.blazingWheelAI(game); break;                           // AI_020 刺球（type 70，:24662）
        case 21: this.spikeBallAI(game); break;                          // AI_021 火轮（type 72，:24740）
        case 14: this.batAI(game, p); break;                            // AI_014 蝙蝠/飞行族（1.4.5.6 原版核）
        case 16: this.swimAI(game, p); break;                           // AI_016 游泳族（鲨鱼/食人鱼）
        case 18:
          this.jellyfishAI(game, p);                       // AI_018 水母族（脉冲游动）
          if (this.vanillaId === 221) this.squidFindFrame(); // 鱿鱼帧机（:74652-74662，AI 后同序）
          break;
        // 玩家死亡传原对象（A 批）：幽灵对尸体坐标继续追击（cs:24726 无 dead 早退）
        case 22: this.ghostAI(game, player ?? null); break; // AI_022 幽灵族（穿墙缓速）；M11：分发级索敌目标（尸体照追）
        case 13: this.plantAI(game, p); break;                          // AI_013 植物/攀爬者族（锚点伸展）
        case 15: kingSlimeAI(this, game, p); break;                       // AI_015 史莱姆王(大跳+小史莱姆)
        case 54: brainOfCthulhuAI(this, game, p); break;                  // AI_054 克脑(爬行者环→瞬移冲刺)
        case 55: creeperAI(this, game, p); break;                         // AI_055 爬行者(环绕漂移)
        case 30: twinsAI(this, game, p, false); break;                    // AI_030 雷神之眼 125(悬浮/连冲/变身/激光)
        case 31: twinsAI(this, game, p, true); break;                     // AI_031 魔神之眼 126(诅咒焰/火焰喷射)
        case 32: skeletronPrimeAI(this, game, p); break;                  // AI_032 机械骷髅王头 127(4 部件/旋冲/白天狂暴)
        case 33: case 34: case 35: case 36: primePartAI(this, game, p); break; // AI_033-036 Prime 部件(锯/激光/钳/炮)
        case 37: destroyerAI(this, game, p); break;                       // AI_037 毁灭者 134(80 段链穿地/探针激光)
        case 27: wallOfFleshAI(this, game, player ?? null); break; // AI_027 血肉墙(空腔扫描/速度血量档/Leech 轮)；M11：分发级索敌目标
        case 28: wofEyeAI(this, game, p); break;                          // AI_028 血肉墙之眼(钉墙吸附/激光连射 83)
        case 29: hungryAI(this, game, p); break;                          // AI_029 饥饿者(挂墙环绕→受击脱落扑咬)
        case 84: lunaticCultistAI(this, game, p); break;                  // AI_084 拜月教邪教徒(瞬移+四系弹幕轮换)
        // ---- 月系批（bossAI_lunar_misc.ts）----
        case 81: moonLordFreeEyeAI(this, game, p); break;                // AI_081 月总游离眼 400（cs:38224 十槽攻击表+死光）
        case 82: moonLeechAI(this, game, p); break;                       // AI_082 月总水蛭块 401（cs:38668 90t 插值吸血回灌）
        case 83:                                                            // AI_083 神秘石碑 437/忠实信徒 438（cs:38793）
          if (this.vanillaId === 437) cultistTabletAI(this, game, p);
          else lunaticDevoteeAI(this, game, p);
          break;
        case 86: phantomAI(this, game, p); break;                          // AI_086 暗焰幻影 472/远古幻影 521（cs:39261 穿墙横掠循环）
        case 87: bigMimicAI(this, game, p); break;                         // AI_087 珍稀四宝箱怪 473-476（cs:39520 跳扑+蓄能/俯冲/三连扑）
        case 88: mothronAI(this, game, p); break;                          // AI_088 飞蛾魔 477（cs:39876 日食限定轮换+产卵）
        case 89: mothronEggAI(this, game, p); break;                       // AI_089 蛾卵 478（cs:40407 900t→Transform 479）
        case 90: babyMothronAI(this, game, p); break;                      // AI_090 幼蛾 479（cs:40450 日食贴脸冲撞）
        case 91: graniteElementalAI(this, game, p); break;                 // AI_091 花岗岩元素 483（cs:40686 五态寻路）
        case 120: empressOfLightAI(this, game, p); break;                 // AI_120 光之女皇(连段选招/半血变身)
        case 121: queenSlimeAI(this, game, p); break;                     // AI_121 史莱姆皇后(走路四连跳→飞行二阶段)
        case 122: this.pirateGhostAI(game, p); break;                     // AI_122 海盗幽灵 662（穿墙追击+失标渐隐自灭）
        case 123: deerclopsAI(this, game, p); break;                      // AI_123 鹿角怪(尖刺/碎石/影手/回家)
        case 100: ancientLightAI(this, game, p); break;                  // AI_100 远古之光 522(直飞投射物型)
        case 101: ancientDoomAI(this, game, p); break;                  // AI_101 远古末日 523(锚邪教徒蓄能自爆)
        case 43: queenBeeAI(this, game, p); break;                        // AI_043 蜂后(悬浮俯冲/蜜蜂机枪/毒刺)
        case 50: planteraHookAI(this, game, p); break;                    // AI_050 真菌孢子 261/孢子 265
        case 51: planteraAI(this, game, p); break;                        // AI_051 世纪之花(钩蔓牵引→二阶段)
        case 52: planteraTentacleAI(this, game, p); break;                // AI_052 钩蔓 263(抓墙换锚收线)
        case 53: planteraTentacle2AI(this, game, p); break;               // AI_053 触须 264(二阶段环绕)
        case 69: dukeFishronAI(this, game, p); break;                     // AI_069 猪鲨(冲撞/泡泡/龙卷,半血变身)
        case 70: dukeBubbleAI(this, game, p); break;                      // AI_070 爆裂泡泡 371
        case 71: sharkronAI(this, game, p); break;                        // AI_071 鲨鱼龙 372/373(龙卷出鲨,升空蓄力→扑咬)
        case 77: moonLordCoreAI(this, game, p); break;                    // AI_077 月总核心 398(双手死前无敌)
        case 78: moonLordHandAI(this, game, p); break;                    // AI_078 月总手 397(攻表/睁眼可击)
        case 79: moonLordHeadAI(this, game, p); break;                    // AI_079 月总头 396(死亡之光/吸血)
        case 45: golemAI(this, game, p); break;                        // AI_045 石巨人本体 245(蓄力跳/挂头无敌)
        case 46: golemHeadAI(this, game, p); break;                      // AI_046 挂载头 246(锚本体/火焰弹眼激光;249 自由态)
        case 47: golemFistAI(this, game, p); break;                      // AI_047 石巨人拳 247/248(肩锚冲拳)
        case 40: this.wallCreeperAI(game, p); break;                      // AI_040 爬墙蜘蛛族（贴背景墙爬行+形态互转）
        case 42: this.lostGirlAI(game, p); break;                         // AI_042 失落女孩（伪装静止→Nymph 变身 cs:30281-30310）
        case 0: this.boundNPCAI(game, p); break;                          // AI_000 被缚NPC（cs:19774 站立/水上漂流；Enemy 侧防御，常规走 TownNPC.bound）
        case 17: this.vultureAI(game, p); break;                          // AI_017 秃鹫（cs:24079 栖息→200px盒/受击起飞，单向不回落）
        case 19: this.antlionAI(game, p); break;                          // AI_019 蚁狮（cs:24465 扎沙不动+沙球；传送带特例略）
        case 23: this.flyingWeaponAI(game, p); break;                     // AI_023 飞行武器（cs:25316 冲/漂100/转120 循环，受击回蓄转）
        case 25: this.mimicAI(game, p); break;                            // AI_025 宝箱怪（cs:25621 伪装200px盒→小小大跳循环）
        case 39: this.tortoiseAI(game, p); break;                         // AI_039 陆龟族（cs:29257 待机蓄力→蓄势→旋冲→恢复）
        case 41: this.herplingAI(game, p); break;                         // AI_041 赫柏林/德普林/378 咬齿炸弹（cs:30017 低跳连扑+自爆链）
        case 44: this.flyingSwarmerAI(game, p); break;                    // AI_044 飞鱼/蚁狮蜂（cs:30999 分轴限速追+失视逃逸）
        case 56: this.dungeonSpiritAI(game, p); break;                    // AI_056 地牢之魂（cs:32915 穿墙0.99惯性追踪）
        case 26: this.chargerAI(game, p); break;                        // AI_026 独角兽/冲锋族（原版核）
        case 107:                                                          // AI_107 ImprovedWalkers（NPC.cs:63372-64919）
          if (this.vanillaId !== 620) ai107ImprovedWalkers(this, game, p); // DD2 walker 族 1:1（bossAI_dd2.ts：近战前摇/投弹/掷矛/喷吐/自爆/灵气）
          else this.chargerAI(game, p);                                    // 620 地精鲨（wet 游泳档 + 陆地 8 速/811 射链/夜扑,cs:64118-64277）
          break;
        case 94: this.towerAI(game, p); break;                          // AI_094 星璇四塔（NPC.cs:41029-41443，核心 1:1）
        // ---- 星璇塔四组专属怪 1:1（bossAI_lunar_misc.ts；docs/event-lunar-pillars.md §4）----
        // 74 穿心者 418 / 75 日耀骑手 416 已由火星批 bossAI_martian.ts 落位（见下方
        // 火星族分发）；85/95/96/97/99 五族 1:1 内核在 lunar_misc（一期近似档已退役）。
        // 勘误：NPC 408 无 NewNPC 调用源（docs §4"408 由投射物 539 生成"不成立）。
        case 85: starCellAI(this, game, p); break;                    // AI_085 星细胞 405/星云头蟹 421（六态寻路+吸附）
        case 95: smallStarCellAI(this, game, p); break;               // AI_095 小星细胞 406（300t 长大 Transform 405）
        case 96: flowInvaderAI(this, game, p); break;                 // AI_096 水流入侵者 407(/408)（悬顶伺服+甩 539）
        case 97: nebulaFloaterAI(this, game, p); break;               // AI_097 星云悬浮脑 420（瞬移+环绕球 574→弹 576）
        case 99: solarSlimeAI(this, game, p); break;                  // AI_099 日耀黏液 519（坠落→落地 5t 自爆）
        // ---- 月事件（南瓜月/霜月）Boss 族 1:1（bossAI_moon_events.ts）----
        case 57: mourningWoodAI(this, game, p); break;                  // AI_057 悲木 325/常世吼 344（cs:32937 悬浮树怪+分阶段弹幕）
        case 58: pumpkingAI(this, game, p); break;                       // AI_058 南瓜王 327（cs:33246 悬浮/俯冲+生双刃）
        case 59: pumpkingBladeAI(this, game, p); break;                   // AI_059 南瓜王之刃 328（cs:33405 锚主环绕/俯冲/横扫）
        case 60: iceQueenAI(this, game, p); break;                        // AI_060 冰雪女王 345（cs:33588 滑翔/落冰/旋射三态）
        case 61: santaNK1AI(this, game, p); break;                        // AI_061 圣诞坦克 346（cs:33902 悬浮+链炮/火箭/礼盒）
        case 62: elfCopterAI(this, game, p); break;                       // AI_062 玩具直升机 347（cs:34155 近距悬停点射）
        case 63: flockoAI(this, game, p); break;                          // AI_063 弗洛科 352（cs:34208 追踪+旋冲）
        case 38: snowmanAI(this, game, p); break;                         // AI_038 雪人三兄弟 143/144/145（cs:29115 跳扑/停顿/雪球）
        case 9:
          // 516 太阳耀斑走专属支（AI_009 内 type==516 段 NPC.cs:21463-21481 + :21582-21600
          // ——火蜥蜴 415 喷火产物：出膛渐隐 alpha→220 + 锥形出膛 + 15 步进追踪 + 擦墙/
          // 近身 20px 自爆；曾误入弹跳球族通用档 = 516 永不爆且追踪全缺）
          if (this.vanillaId === 516) solarFlareAI(this, game, p);
          else bouncingBallAI(this, game, p);                             // AI_009 弹跳球族 25/30/33/112/665/666（cs:21349）
          break;
        // ---- 火星疯狂族 1:1（bossAI_martian.ts）----
        case 80: martianProbeAI(this, game, p); break;                    // AI_080 火星探测器 399（cs:38129 逃逸→StartInvasion(4)）
        case 76: martianSaucerAI(this, game, p); break;                   // AI_076 火星飞碟核心 395（cs:36322 600t 六窗口+部件生成）
        case 72: bubbleShieldAI(this, game, p); break;                    // AI_072 泡泡盾 384（cs:35318 锚军官 383）
        case 73: teslaTurretAI(this, game, p); break;                     // AI_073 特斯拉炮塔 387（cs:35340 部署渐显+180t 电击）
        case 74:                                                          // AI_074 火星无人机 388/日耀 Corite 418（cs:35452 悬浮→扑咬→自爆）
          if (this.vanillaId === 388 || this.vanillaId === 418) martianDroneAI(this, game, p);
          else this.floatEyeAI(game, p);                                  // 其余（一期近似档保留）
          break;
        case 75:                                                          // AI_075 飞碟部件 392/393/394 + 骑手 390（cs:35745 锚主体+攻击窗）
          if (this.vanillaId === 390 || this.vanillaId === 392
            || this.vanillaId === 393 || this.vanillaId === 394
            || this.vanillaId === 416 || this.vanillaId === 492) martianSaucerPartAI(this, game, p);
          else this.fighterAI(game, p);                                   // 其余（一期近似档保留）
          break;
        case 48: golemHeadAI(this, game, p); break;                       // AI_048 自由石巨人头 249（cs:31500,golemHeadAI 已含自由态分支）
        case 49: angryNimbusAI(this, game, p); break;                     // AI_049 愤怒云 250（cs:31742 悬顶淋雨 264）
        // ---- DD2/旧日军团 + 沙漠族（bossAI_dd2.ts）----
        case 93: flyingDutchmanAI(this, game, p); break;                  // AI_093 荷兰飞盗船 491（cs:40918 四炮部件+海盗跳舱+贴地巡航）
        case 102: sandElementalAI(this, game, p); break;                  // AI_102 沙尘精 541（cs:42224 walker 核+沙暴标记 658）
        case 103: sandSharkAI(this, game, p); break;                      // AI_103 沙鲨族 542-545（cs:42621 沙中巡游+跃沙扑咬,沙族豁免碰撞）
        case 104: dd2AttackerTestAI(this, game); break;                   // AI_104 DD2AttackerTest 547（cs:42807 出生即消）
        case 105: eterniaCrystalAI(this, game, p); break;                 // AI_105 永恒水晶 548（cs:42810 180t 双端放门+胜负演出）
        case 106: lanePortalAI(this, game, p); break;                     // AI_106 神秘传送门 549（cs:43063 出怪门节拍,事件依赖 DD2_EVENT_HOOKS）
        case 108: divingFlyerAI(this, game, p); break;                    // AI_108 飞龙 558-560/小妖魔滑翔怪 574-575（cs:65959 俯冲五态+自爆）
        case 109: darkMageAI(this, game, p); break;                       // AI_109 黑暗魔法师 564/565（cs:66392 walker+三连招 675/674/673）
        case 110: betsyAI(this, game, p); break;                          // AI_110 双足翼龙 551（cs:62266 八槽攻表+rotation 收敛）
        case 111: dd2LightningBugAI(this, game, p); break;                // AI_111 埃特尼亚荧光虫 578（cs:66799 悬停蓄电 682 电弧）
        case 113: this.windyBalloonAI(game, p); break;                    // AI_113 风气球 594（cs:48253 挂史莱姆 ai[0]=-999）
        case 125: this.balloonSlimeAI(game, p); break;                    // AI_125 笨笨气球史莱姆 686（cs:44009 漂浮悬停+爆裂解救）
        case 117: this.bloodNautilusAI(game, p); break;                  // AI_117 恐惧鹦鹉螺 618（cs:47488 血月钓鱼 Boss）
        case 119: this.dandelionAI(game, p); break;                      // AI_119 蒲公英 628（cs:43254 下风喷籽；非critter勿只登 critterWanderAI）
        case 126: this.statueMimicAI(game, p); break;                    // AI_126 雕像宝箱怪 690（cs:43760 伪装/唤醒/跳跃穿墙）
        case 127: this.palAI(game, p); break;                            // AI_127 Palworld 双宠 695/696（cs:43239 遇袭待援/救出奖赏）
        default: this.zombieAI(game, p); break;                        // 其余家族待逐个移植
      }
    } else switch (this.key) {
      case 'slime_green':
      case 'slime_blue': this.slimeAI(game, hasPlayer ? player : null); break;
      case 'zombie': this.zombieAI(game, hasPlayer ? player : null); break;
      case 'demon_eye':
      case 'cave_bat': this.flyAI(game, hasPlayer ? player : null, 0.09); break;
      case 'servant_of_cthulhu': this.flyAI(game, hasPlayer ? player : null, 0.22); break;
      case 'eye_of_cthulhu': this.eocAI(game, player ?? null); break;
    }

    // ---- ★BJ703-C D6（2026-10-21）：原版小 vx 清零（NPC.cs:91588-91591
    //      `|vx|<0.005 → 0`，UpdateNPC 在 AI 后、UpdateCollision 前对全体 NPC 无条件
    //      跑）——刹车/僵立 ×0.8 衰减链的浮点残尾（2.8e-17 量级）不再多活 1 拍；
    //      帧机站定钉（vx==0 门,如龟族 :77520）读到清零值 = 与原版同拍面。
    //      本仓拍位 = AI 分发后（碰撞在各 AI 内已毕,拍内位差 <0.005px/tick 无感;
    //      战士族 0.001 哨兵（:56656-56659）同被清零=原版 :91588 同样清它,零冲突）。
    //      TownNPC 侧同款缺（独立类 fixedUpdate 全量自写）——登记债 BJ703-C D9。
    //      ★BJ704-G3 D9（2026-10-21）：TownNPC 侧三臂（微光/被缚/主物理段）已补。
    //      ★BJ704-G19 销案锁死（G3 备案①「|vx|<0.005 拍位差」,2026-10-21 复核）：
    //      原版清位在重力后/碰撞前（UpdateNPC :91588-91591）,本仓在 AI 分发后（各
    //      AI 内碰撞已毕）——差异面=碰撞所见残速 <0.005px/t（亚像素）+ 卡墙稳态
    //      vx=±acc(≥0.07) 不在清零带（两拍位皆不辖）。【可感知面=零,正式销案】;
    //      勿再以「拍位与原版不同」重登记——改拍位须重构 Enemy AI 分发/碰撞序,
    //      收益为亚像素位差=负收益刀。 ----
    // ---- ★BJ704-G3 D10（2026-10-21）：SubAI_HandleTemporaryCatchableNPC
    //      PlayerInvulnerability（NPC.cs:91649-91670,UpdateNPC :91533 AI 后即拍）——
    //      npcCatchable 型（NPC_CATCHABLE,Main.cs:9469+）：`releaseOwner!=255 ‖
    //      SpawnedFromStatue` → 计数清零（本仓=releasedFromItem/spawnedFromStatue,
    //      释放/雕像首拍归零）；窗内 friendly=true 且每拍自减,窗外强制 false。
    //      极性（BJ703-C 登记勘误）：90t 玩家免伤窗属【自然出生】捕获型小动物。
    //      拍位=AI 分发后（原版 AI() 先于 SubAI → AI 读上拍投影值,本仓同构——
    //      AI_007 逃逸档 friendly 门在本拍 AI 内读的是上拍 catchFriendly）。
    //      CheckLifeRegen（:91594,friendly 通道随行）对无 buff 小动物为 no-op
    //      （lifeRegen=0）——不移植=边界备案。 ----
    if (this.vanillaId !== null && NPC_CATCHABLE.has(this.vanillaId)) {
      if (this.releasedFromItem || this.spawnedFromStatue) this.catchImmunityT = 0;
      this.catchFriendly = this.catchImmunityT > 0;
      if (this.catchImmunityT > 0) this.catchImmunityT--;
    } else {
      this.catchFriendly = false;
    }
    if (this.vx < 0.005 && this.vx > -0.005) this.vx = 0;

    // ---- AI 家族外的三段恒走点光（与 AI 分发无关，原版各自独立方法）----
    // ★B 批:GlobalNPC PostAI(AI 派发完成后;全域;空表零成本)
    runModNpcPostAi(this, game as unknown as Game);
    this.updateNpcCastLights();
    this.updateNpcTrailLights();
    this.updateNpcDebuffLights();
    // 毁灭者族段光：原版 AI_037 每段独立发光，本仓身/尾 wormBody 跳过 AI 分发 →
    // 全族三 id（134/135/136）统一在此结算（含头，防与 destroyerAI 双写）
    if (this.vanillaId === 134 || this.vanillaId === 135 || this.vanillaId === 136) {
      destroyerSegmentLight(this, game);
    }

    // ---- EoW 出生渐显（AI_006 尾段 1:1，NPC.cs:52650-52670；须在 AI 分发后跑——
    //      原版位移门 `(position - oldPosition).Length() > 2` 量的是本 tick 位移，
    //      fixedUpdate 头部 prevX/prevY 在 AI 前采样）----
    // 门（:52650 原文为反写 return 表达式）：13 头恒过；14/15 身/尾须前段
    //   spawnAlpha < 85 才启动——渐显沿链向尾传播（头先现、段逐级跟上）。
    //   prev 链断（晋升中瞬时态）按头段放行，防残段卡全透明。
    // alpha>0 且存活（:52656-52664）：每 tick 2 颗 14 号腐化尘（noGravity/noLight、
    //   scale 2、尘 alpha 100——spawnParticles 紫尘近似，DustID.Corruption）。
    // 位移 >2px（:52666-52670）：spawnAlpha -42 钳 0——255→0 共 7 tick 现身。
    // ---- 幻影龙 454-459 出生渐显（AI_006 头段 :51379-51400 1:1）：头无条件 -42/t、
    //      身/尾须前段 spawnAlpha<85 沿链传播（无位移门——龙自传送圈直接成型）；
    //      渐隐期 dontTakeDamage + 每 tick 2 颗 228 紫尘（noGravity/noLight/scale 2）----
    if (this.vanillaId !== null && this.vanillaId >= 454 && this.vanillaId <= 459) {
      const prev = this.wormFollow;
      if (this.vanillaId === 454 || !prev || prev.spawnAlpha < 85) {
        this.dontTakeDamage = this.spawnAlpha > 0;    // :51381-51382
        if (this.spawnAlpha > 0 && this.hp > 0) {
          // 尘 228（:51535-51540）——C 批改真实尘型（scale2/alpha100/noGravity/noLight;
          // type228 的烟雾族初速特例由 VanillaDust.spawn 镜像承担）
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 228, 0, 0, 100, null, 2);
          if (d) { d.noGravity = true; d.noLight = true; }
        }
        this.spawnAlpha = Math.max(0, this.spawnAlpha - 42);
        if (this.spawnAlpha === 0) this.alphaFade = false;
      }
    }

    // ---- 血鳗鱼 621-623 出生渐显（AI_006 头段 :51399-51421 1:1）：头(621)无条件
    //      -42/t、身/尾须前段 spawnAlpha<85 沿链传播；渐隐期 dontTakeDamage +
    //      每 tick 2 颗 5 号血尘；现身(alpha==0)后 1/5 掷续飘 1 颗 ----
    if (this.vanillaId !== null && this.vanillaId >= 621 && this.vanillaId <= 623) {
      const prev = this.wormFollow;
      this.dontTakeDamage = this.spawnAlpha > 0;      // :51402（含现身后的持续重置）
      if (this.vanillaId === 621 || !prev || prev.spawnAlpha < 85) {
        if (this.spawnAlpha > 0 && this.hp > 0) {
          // 尘 5 血尘 ×2/t（:51556-51561）——C 批改真实尘型
          for (let k = 0; k < 2; k++) game.spawnDust?.(this.x, this.y, this.w, this.h, 5);
        }
        this.spawnAlpha = Math.max(0, this.spawnAlpha - 42);
        if (this.spawnAlpha === 0) this.alphaFade = false;
      }
      if (this.spawnAlpha === 0 && Math.floor(Math.random() * 5) === 0) {
        game.spawnDust?.(this.x, this.y, this.w, this.h, 5);   // :51565-51566 现身后续尘——C 批真实尘型
      }
    }

    if (this.vanillaId !== null && this.vanillaId >= 13 && this.vanillaId <= 15 && this.alphaFade) {
      const prev = this.wormFollow;
      if (this.vanillaId === 13 || !prev || prev.spawnAlpha < 85) {
        if (this.spawnAlpha > 0 && this.hp > 0) {
          // 尘 14 ×2/t（AI_006 尾段 :52807-52811：vel0、alpha100、scale2、
          // noGravity/noLight——C 批真实尘型）：
          for (let i2 = 0; i2 < 2; i2++) {
            const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 14, 0, 0, 100, null, 2);
            if (d) { d.noGravity = true; d.noLight = true; }
          }
        }
        if (Math.hypot(this.x - this.prevX, this.y - this.prevY) > 2) {
          this.spawnAlpha = Math.max(0, this.spawnAlpha - 42);
          if (this.spawnAlpha === 0) this.alphaFade = false;
        }
      }
    }

    // ---- 液体态 1:1（NPC.cs UpdateCollision :93712-93805，全量细节在 npcLiquid.ts）----
    // 岩浆判定(受伤/onFire)→wet 判定(WetCollision 中心小盒/蜂蜜/微光)→出入水去抖溅落声
    // →!wet 清液体态→熄火(24+323)→liqFactor 供 moveAndCollide 缩位移（水 .5/岩浆 .5/
    // 蜂蜜 .25/微光 .375；DD2 族与 612/613 = 1）。此前中心格 liquid>80 近似 + 无减速已退役。
    // ---- 蜜蜂反蜇通道（NPC.cs:91540-91542 GetHurtByOtherNPCs(HurtingBees) +
    //      BeHurtByOtherNPC :93666-93681 蜂段）：任一蜜蜂(210/211)接触本 NPC →
    //      本体受蜂 contact 伤（kb6 反向），蜂受【本体 damage】反蜇；双双
    //      immune[255]=30。victim 门 = CanBeHurtByBees（除 210/211/222 全真）+
    //      type1 携蜂巢变体(ai1 1124/1125，:91540-91542)豁免 +
    //      CritterThatCanTurnOnPlayers∧aiStyle3（:93607-93611）。敌怪互殴主通道
    //      （:91592）对 friendly ∥ T-set 96 型（★BJ454 松露虫 374 等；37 豁免）
    //      ——Enemy 侧非 friendly 受害者唯 T-set 与蜂通道适用（TownNPC
    //      侧见 TownNPC.envHurtUpdate） ----
    this.npcVsNpcContactUpdate(game);
    updateNpcLiquid(this, game, game.world.store);
    // 微光接触（NPC.cs:94268-94274）：WetCollision 盒命中微光 → shimmerWet +
    // TryAddingRepeatedBuff(353,100)；离池衰减 :92484-92500 一并 1:1（见下），
    // 视觉渐隐侧未接（GAP：shimmerTransparency 渲染消费）。
    // ---- X-F4 接线（2026-08-30）：原版是【单一系统】，不存在"液体/弹体两套"——
    //      buff 353 在身即 shimmering=true（:93255-93265,免疫条目 :17870
    //      buffImmune[353]=NPCID.Sets.ShimmerImmunity[type] 已由下方入口门排除）；
    //      变形触发只读该状态位导出的透明度累计（:92634-92644,+0.01/t,
    //      Main.netMode!=1 且 >0.9 → GetShimmered() :92668 四分支），
    //      【不要求浸在池中】。液体只是施加源之一（TryAddingRepeatedBuff），弹体
    //      施加同链——微光枪弹 1042 AddBuff(353,100t)（AI_060 :29456-29458,经
    //      GlobProj→applyBuffTicks 写入本仓秒制 shimmeredT）。故把 buff 位并入
    //      同一驱动面：shimmeredT>0 ⇔ shimmering=true,与浸池共用 shimmerT 累计器
    //      与唯一触发点。阈值换算：counter 是 transparency×100,每拍 +1 ⇔ 原版
    //      +0.01/t；严格不等式 >0.9 需第 91 拍（0.91）跨过；弹体时长 100t≈1.67s
    //      ≥ 所需 91/60s ⇒ 满时长命中必达阈。差异登记（对照原版空调用语义）：
    //      原版对无任何表项的 NPC 每 tick 重入 GetShimmered 空调用直至 buff 走完
    //      （:92668 无 else 兜底）；本仓真实分支在 npcGetShimmered 内自清 shimmerT,
    //      空分支靠下述【清零 buff 位防重入】剪成一次调用——省掉的必然为空的重放
    //      调用无可观测行为差。
    // 入口门（NPC.cs:17773）：免表 NPC（史莱姆王/石巨人/城镇宠物/事件军…）不进；
    // 非免表 Boss（克苏鲁之眼 4 等）原版照进，npcGetShimmered 无表项时为空操作
    if (this.vanillaId !== null && !isNpcShimmerImmune(this.vanillaId)) {
      // shimmerWet 由 updateNpcLiquid 的 WetCollision（中心小盒）写出——原版同一判定
      if (this.shimmerWet || this.shimmeredT > 0) {
        this.shimmerT += 1;
        if (this.shimmerT > 90) {
          this.npcGetShimmered(game);
          if (this.shimmeredT > 0) this.shimmeredT = 0;   // 弹体位用后清零,防逐拍重入
        }
      } else if (this.shimmerT > 0) {
        // 离池衰减（NPC.cs:92646-62 两独立位同 tick 叠加，先 justHit 后免疫/常规档）：
        // justHit −0.1 位（×100 计数 −10）+ buffImmune[353]（=NPCID.Sets.
        // ShimmerImmunity，:17870 经 stats/Shimmer.isNpcShimmerImmune）−0.015 位
        // （−1.5）else 常规 −0.001 位（−0.1）。本仓 shimmerT=transparency×100。
        // 曾单档 −0.1（快 10 倍伪影）→ 2026-09-03 两 lanes 1:1 补齐
        let dec = isNpcShimmerImmune(this.vanillaId ?? -1) ? 1.5 : 0.1;
        if (this.justHit) dec += 10;
        this.shimmerT = Math.max(0, this.shimmerT - dec);
      }
    }
    // onFire DoT（NPC.cs:92616-92630:lifeRegen-8 = 4 HP/s,无防御结算）+ 火尘粒子（:92187）
    // Slimed(137 = drippingSlime,凝胶易燃):六火系每系再叠等量 lifeRegen → 各系 DoT 翻倍
    //  （1457 DOTTally.AddFlamable :113-115 统一——六系全走 AddFlamable,语义同旧六处）
    // Oiled(204):六火系任意在身时【flat 再叠 -50 = +25 HP/s】(:92801-92803)——
    //  非"按系翻倍"(旧 oiledMul=2 系误读,2026-08-13 G7 回源修正);slimedT 独立递减
    const slimedMul = this.slimedT > 0 ? 2 : 1;
    // 1457 AddFlamable :116-119：木史莱姆(type 1 && ai[1]==9 吞火把)每系 lifeRegen
    // 额外 -16 = +8 HP/s——1456 该 +16 只挂在 onFrostBurn 块内(:92648 段),1457 收进
    // AddFlamable 后六火系全吃;本仓按字面六系统一加
    const woodSlimeFire = this.vanillaId === 1 && this.ai1 === 9 ? 8 : 0;
    // 1457 DOTTally.SupportAcceleration(:127-131)+:92840-92847：398 毒素加速把
    // "可加速"DoT(AddPoison/AddBloodLoss/AddFlamable——毒/流血/六火系)×2;
    // 裸 Add(oiled/eelWhip/贴附族/daybreak/soulDrain)不加成
    const accelMul = this.acceleratePoisonsT > 0 ? 2 : 1;
    // Oiled 的 -50 是【单块一次性】(:92801-92803),多火系并存时不得按系重复叠——
    // 独立 oiledDoT 累加器结算,不并入各系
    const fireOn = this.onFireT > 0 || this.cursedT > 0 || this.onFire3T > 0
      || this.frostburnT > 0 || this.frostburn2T > 0 || this.shadowFlameT > 0;
    if (this.oiledT > 0 && fireOn) this.oiledDoT += 25 * dt;
    if (this.slimedT > 0) this.slimedT -= dt;
    // Wet(103)/Shimmered(353) 纯计时递减（非 DoT 族,UpdateNPC_BuffApplyDOTs 无条目）
    if (this.wetT > 0) this.wetT -= dt;
    if (this.shimmeredT > 0) this.shimmeredT -= dt;
    // :92733 FTW 豁免门:onFire && (type != 1 || ai[1] != 8 || !getGoodWorld) 才
    // AddFlamable(8)——getGood 下 type 1 且变体 ai[1]==8 的蓝史莱姆免着火 DoT
    // (1456 :92616 同款;蓝队 R1-10 补,1456/1457 两版皆有非新改)
    // ★BJ437 流程备案（诚实注;2026-10-02 审计 D6 判「注缺失」后 Z4 补记）：
    //  BJ437 曾试把下方 onFireT 倒数提出本豁免门（重构）,经定谳为行为等价——
    //  FTW 火把史莱姆本就是永燃设计（AI_001_Slimes 每拍 AddBuff(24,216000) 续 3600,
    //  NPC.cs:61442-61450;不因倒数出门产生残账）,且原注释「火不灭残账」论据不成立,
    //  已逐字节回退——豁免门结构维持蓝队 R1-10 原判。本区终态 = 单遍直生移植
    //  （燃烧族 debuff VFX 见 :2689 区）,勿再动门结构。
    const ftwSlimeFireExempt = !!game.world.seedFlags?.getGoodWorld
      && this.vanillaId === 1 && this.ai1 === 8;
    if (this.onFireT > 0 && !ftwSlimeFireExempt) {
      this.onFireT -= dt;
      this.onFireDoT += (4 * slimedMul + woodSlimeFire) * accelMul * dt;
      if (this.onFireDoT >= 1) {
        const n = Math.floor(this.onFireDoT);
        this.onFireDoT -= n;
        this.applyDoT(n, game);
        game.addDamageNumber(this.cx, this.y, n, false, '#FF8C28', true);   // DoT 飘值(LifeRegenNegative :93070,dot 小字)
      }
      // ★BJ437（2026-10-02）：火尘粒子已迁下方「燃烧族 debuff VFX」区真尘直生——
      //  旧泛色方块近似曾挂在本豁免门内 = FTW 火把史莱姆（ai1=8 永燃,
      //  NPC.cs:61442-61450 AddBuff(24,216000) :61445 每拍续 3600）被门误杀零粒子;
      //  非 FTW 面色方块画在光照合成前被乘光+形态非火（用户实报「只发红没有火粒子」）。
      //  原版粒子/点光在 UpdateNPC_BuffApplyVFX :92353（旗位驱动,与 DoT 豁免无涉）。
    }

    // ---- 武器浸剂 debuff 滴血（R2，NPC.cs:92585/92703/92684 DoT 同 onFire 模式；
    //      1457 起毒/流血/六火系均入"可加速"池（AddPoison/AddBloodLoss/AddFlamable）） ----
    if (this.poisonT > 0) { this.poisonT -= dt; this.poisonDoT += 6 * accelMul * dt; }
    if (this.venomT > 0) { this.venomT -= dt; this.venomDoT += 30 * accelMul * dt; }
    // 六火系:各自基档 × slimedMul(cursed=onFire2 亦吃 Slimed 翻倍) × accelMul(398)
    if (this.cursedT > 0) { this.cursedT -= dt; this.cursedDoT += (24 * slimedMul + woodSlimeFire) * accelMul * dt; }
    // 四新系(NPC.cs:44→8HP/s(:92648) / 324→25HP/s(:92668) / 323→15HP/s(:92632) /
    //  153→15HP/s(:92712),各吃 Slimed 翻倍 + 398 加速 + 木史莱姆 +8)
    if (this.frostburnT > 0) { this.frostburnT -= dt; this.frostburnDoT += (8 * slimedMul + woodSlimeFire) * accelMul * dt; }
    if (this.frostburn2T > 0) { this.frostburn2T -= dt; this.frostburn2DoT += (25 * slimedMul + woodSlimeFire) * accelMul * dt; }
    if (this.onFire3T > 0) { this.onFire3T -= dt; this.onFire3DoT += (15 * slimedMul + woodSlimeFire) * accelMul * dt; }
    if (this.shadowFlameT > 0) { this.shadowFlameT -= dt; this.shadowFlameDoT += (15 * slimedMul + woodSlimeFire) * accelMul * dt; }
    if (this.oiledT > 0) this.oiledT -= dt;
    if (this.brokenArmorT > 0) this.brokenArmorT -= dt;
    if (this.betsysCurseT > 0) this.betsysCurseT -= dt;
    // 层数模型（NPC.cs:92807-92830）：num8 = 场上附着 636 太阳耀斑数（WeaponProj
    // .daybreakStacks），零层兜底 1（:92822-92825）→ num8×100 HP/s（:92826）
    if (this.daybreakT > 0) {
      this.daybreakT -= dt;
      this.daybreakDoT += 100 * Math.max(1, daybreakStacks(this.id)) * dt;
    }
    if (this.bleedT > 0) { this.bleedT -= dt; this.bleedDoT += 12 * accelMul * dt; }
    if (this.hemorrhageT > 0) { this.hemorrhageT -= dt; this.hemorrhageDoT += 100 * accelMul * dt; }
    // 贴附族层数结算（1457 AddStackedProjecitle NPC.cs:88-105）：层数先随 dt 衰减
    // （每层独立倒计时,寿命=对应 buff 时长——与场上附着弹到寿消亡等价）,再按层 ×
    // 单层 HP/s。1457 起 num==0 兜底 1（:100-103——debuff 旗标在而场上无附着弹时
    // 按 1 层计;1456 为 0 伤害,唯 Daybreak 旧已有兜底）→ 598/971/975/614 四系统一
    const decay = (arr: number[]): number => {
      let n = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        arr[i] -= dt;
        if (arr[i] <= 0) arr.splice(i, 1); else n++;
      }
      return n;
    };
    if (this.javelinT > 0) { this.javelinT -= dt; this.javelinDoT += 3 * Math.max(1, decay(this.javelinStacks)) * dt; }   // :92776-92779
    else this.javelinStacks.length = 0;   // buff 尽层同步清（防御性；正常两钟同步到期）
    if (this.spikeT > 0) { this.spikeT -= dt; this.spikeDoT += 3 * Math.max(1, decay(this.spikeStacks)) * dt; }           // :92782-92785
    else this.spikeStacks.length = 0;
    if (this.butcherT > 0) { this.butcherT -= dt; this.butcherDoT += 4 * Math.max(1, decay(this.butcherStacks)) * dt; }   // :92786-92789
    else this.butcherStacks.length = 0;
    this.soulDrainActive = this.soulDrainT > 0;   // :91951 debuff 位镜像
    if (this.soulDrainT > 0) { this.soulDrainT -= dt; this.soulDrainDoT += 25 * dt; } // :92927-92935
    if (this.stardustT > 0) { this.stardustT -= dt; this.stardustDoT += 20 * Math.max(1, decay(this.stardustStacks)) * dt; } // :92792-92795
    else this.stardustStacks.length = 0;
    // ---- 1457 新 debuff 家族（DOTTally :92746-92800）----
    // 395/397 各 AddPoison(180,60) = 90 HP/s（可加速池）;362 电鳗鞭 Add(100,50) =
    // 50 HP/s 平铺（裸 Add——不可加速、不吃 Slimed;链式缩放/标记玩家数/链电粒子全删）
    if (this.potentAcidT > 0) { this.potentAcidT -= dt; this.potentAcidDoT += 90 * accelMul * dt; }
    if (this.chlorophyteSporeT > 0) { this.chlorophyteSporeT -= dt; this.chlorophyteSporeDoT += 90 * accelMul * dt; }
    if (this.eelWhipT > 0) { this.eelWhipT -= dt; this.eelWhipDoT += 50 * dt; }
    // 树妖煞(186)：DOTTally.Add(dps×2, dps/3)=dps HP/s（:92797-92800）——裸 Add,
    // 不入 398 加速池；dps 由施加端按世界进度链换算写入
    if (this.dryadBaneT > 0) { this.dryadBaneT -= dt; this.dryadBaneDoT += this.dryadBaneDps * dt; }
    if (this.acceleratePoisonsT > 0) this.acceleratePoisonsT -= dt;
    if (this.blueLightningT > 0) this.blueLightningT -= dt;
    if (this.redLightningT > 0) this.redLightningT -= dt;
    // Oiled 独立结算(:92801-92803 单块 -50 = 25 HP/s,不随各系翻倍/重复)
    if (this.oiledDoT >= 1) {
      const n = Math.floor(this.oiledDoT);
      this.oiledDoT -= n;
      this.applyDoT(n, game);
      game.addDamageNumber(this.cx, this.y, n, false, '#FF8C28', true);
    }
    for (const [tKey, dKey] of [['poisonT', 'poisonDoT'], ['venomT', 'venomDoT'], ['cursedT', 'cursedDoT'],
      ['frostburnT', 'frostburnDoT'], ['frostburn2T', 'frostburn2DoT'],
      ['onFire3T', 'onFire3DoT'], ['shadowFlameT', 'shadowFlameDoT'],
      ['daybreakT', 'daybreakDoT'], ['bleedT', 'bleedDoT'], ['hemorrhageT', 'hemorrhageDoT'],
      ['javelinT', 'javelinDoT'], ['spikeT', 'spikeDoT'], ['butcherT', 'butcherDoT'],
      ['soulDrainT', 'soulDrainDoT'], ['stardustT', 'stardustDoT'],
      ['potentAcidT', 'potentAcidDoT'], ['chlorophyteSporeT', 'chlorophyteSporeDoT'],
      ['eelWhipT', 'eelWhipDoT'], ['dryadBaneT', 'dryadBaneDoT']] as const) {
      const acc = this[dKey];
      if (acc >= 1) {
        const n = Math.floor(acc);
        this[dKey] -= n;
        // soulDrain 条目带 realLife==-1 门（:92802）：共享血池族免 soulDrain——
        // 原版该条目不进 tally,伤害与飘字都不出
        if (!(dKey === 'soulDrainDoT' && this.realLifeHost && !this.realLifeHost.dead)) {
          this.applyDoT(n, game);
          game.addDamageNumber(this.cx, this.y, n, false, '#FF8C28', true);
        }
      }
    }
    if (this.ichorT > 0) this.ichorT -= dt;
    if (this.midasT > 0) this.midasT -= dt;
    // confused（buff 31）存量倒数；反向语义在各 AI 的索敌点（seekDirX）按
    // 原版 TargetClosest :78569 应用——不再对 vx 做周期翻转（旧近似已移除）
    if (this.confusedT > 0) this.confusedT -= dt;
    if (this.stinkyT > 0) this.stinkyT -= dt;   // stinky(120) 存量倒数（AI 转向 GAP 见字段注）
    // buff 119 Lovestruck 递减（:93099-93102 lowerBuffTime→:93181 置位 loveStruck,
    // 递减后 >0 即本 tick 在位;119 纯展示位倒数,B1 批）+ 头爱心 gore 331——
    // ★清偿刀 F 2026-09-29：原版 UpdateNPC_BuffApplyVFX（:92455-92466）由 :91488
    // UpdateNPC 对【全体】NPC 调用,敌怪与城镇 NPC 同式同环——刀B 只落了 TownNPC 侧,
    // 本补 Enemy 桶。发射式单源 = GorePiece.newLovestruckHeart（公式/掷序/调用侧
    // 三连 ×0.4/vy−0.6/sticky=false 全注在那边;视觉掷 = Math.random 纯演出面）。
    // ★清偿刀 P3-F1（2026-09-30,C1 红蓝翻案）：门改读逐实例 canDisplayBuffs——
    // 原版 false 面只由 getGoodAdjustments 置（:18040-18052 245-248）,而该函数
    // 整体在 Main.getGoodWorld 门内（SetDefaults :17875-17878）⇒ 仅 FTW 世界
    // 石巨人四件拒发;普通世界四件 ResetEffects :8519 复位 true（字段缺省 :6206
    // 亦 true）照发爱心。旧 vid 硬拒把普通世界四件误杀。本仓字段链=种子档
    // fromVanilla :1493 / Transform :6508 双路落位（scaleStats.getGoodAdjustments
    // 已按 getGoodWorld 条件化）。递减保留在门外（原版倒数在 lowerBuffTime
    // :93099-93102,与 :92265 VFX 环早退互不影响=同相）。
    if (this.lovestruckT > 0) {
      this.lovestruckT -= dt;
      if (this.canDisplayBuffs) {
        newLovestruckHeart(this.x, this.y, this.w, this.h);
      }
    }
    if (this.gelBalloonT > 0) this.gelBalloonT -= dt;   // 320 滴落展示位倒数（B1 批）
    // ---- 燃烧族 debuff VFX（★BJ437 2026-10-02,UpdateNPC_BuffApplyVFX :92303-92440/
    //      :92586-92634 1:1）——真尘直生（Dust.NewDustDirect 全链 1:1,盒扩/频率/尘型/
    //      速度修型/重力翻转逐 buff 钉值;旧 onFire 泛色方块近似随本刀退役）。点光面
    //      不在此重复:六火系/betsy (1,.3,.1)/(0.6,.1,.9) 与冰霜 (0.1,.6,1) 已由
    //      updateNpcDebuffLights(:2402 调用)承担（原版同块 AddLight :92366/:92384/
    //      :92400/:92415/:92600/:92616/:92633 并入该处=同帧等价）。canDisplayBuffs 门
    //      = :92265 早退（FTW 245-248 石巨人族 false——旧 chlorophyteSpore 等批未挂门,
    //      差异登记）。onFire3 customData=0 的实心格收缩档(:92382→Dust.cs:604-616)
    //      引擎无消费面=登记债（发射面/运动学不受影响）。----
    if (this.canDisplayBuffs) {
      // 火焰族共形：盒(pos−2,+4)、v=velocity×0.4、α100、scale3.5、noGravity→
      // velocity×mul→Y−add→1/4 概率翻重力+scale×0.5（onFire :92353-92367 形）
      const flameDust = (dustId: number, mul: number, yAdd: number) => {
        const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 4,
          dustId, this.vx * 0.4, this.vy * 0.4, 100, null, 3.5);
        if (d) {
          d.noGravity = true;
          d.vx *= mul; d.vy *= mul;
          d.vy -= yAdd;
          if (Math.floor(Math.random() * 4) === 0) { d.noGravity = false; d.scale *= 0.5; }
        }
        return d;
      };
      if (this.onFireT > 0 && Math.random() < 0.75) flameDust(6, 1.8, 0.5);            // 火尘 6(:92356)
      if (this.onFire3T > 0 && Math.random() < 0.75) flameDust(6, 1.8, 0.5);           // 地狱火尘 6(:92372)
      if (this.cursedT > 0 && Math.random() < 0.75) flameDust(75, 1.8, 0.5);           // 诅咒焰尘 75(:92621)
      if (this.frostburnT > 0 && Math.random() < 0.75) flameDust(135, 1.8, 0.5);       // 冰焰尘 135(:92589)
      if (this.frostburn2T > 0 && Math.random() < 0.75) flameDust(135, 1.8, 0.5);      // 冻伤尘 135(:92605)
      if (this.daybreakT > 0 && Math.random() < 0.75) flameDust(158, 2.8, 0.5);        // 耀斑尘 158(:92389,×2.8)
      if (this.betsysCurseT > 0 && Math.random() < 0.75) {
        // 贝希摩斯诅咒尘 55（:92402-92416）：×2.8、Y−1.5 后【无条件】翻重力+scale=0.9
        // +色(0,0,180,255)+velocity×0.2——无 1/4 翻转面
        const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 4,
          55, this.vx * 0.4, this.vy * 0.4, 100, null, 3.5);
        if (d) {
          d.noGravity = true;
          d.vx *= 2.8; d.vy *= 2.8;
          d.vy -= 1.5;
          d.noGravity = false;
          d.scale = 0.9;
          d.color = { r: 0, g: 0, b: 180, a: 255 };
          d.vx *= 0.2; d.vy *= 0.2;
        }
      }
      if (this.shadowFlameT > 0 && Math.random() < 0.8) {
        // 暗影焰尘 27（:92340-92352）：Next(5)<4=80%/拍、α180、scale1.95;
        // velocity×0.75→X 再×0.75、Y−1；1/4 翻重力+scale×0.5（无点光——原版本块无 AddLight）
        const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 4,
          27, this.vx * 0.4, this.vy * 0.4, 180, null, 1.95);
        if (d) {
          d.noGravity = true;
          d.vx *= 0.75; d.vy *= 0.75;
          d.vx *= 0.75;
          d.vy -= 1;
          if (Math.floor(Math.random() * 4) === 0) { d.noGravity = false; d.scale *= 0.5; }
        }
      }
      if (this.poisonT > 0 && Math.floor(Math.random() * 30) === 0) {
        // 中毒泡尘 46（:92303-92308）：1/30、盒不扩、α120、scale0.2、noGravity+fadeIn1.9
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 46, 0, 0, 120, null, 0.2);
        if (d) { d.noGravity = true; d.fadeIn = 1.9; }
      }
      if (this.venomT > 0 && Math.floor(Math.random() * 10) === 0) {
        // 毒液泡尘 171（:92309-92314）：1/10、α100、scale0.5、noGravity+fadeIn1.5
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 171, 0, 0, 100, null, 0.5);
        if (d) { d.noGravity = true; d.fadeIn = 1.5; }
      }
      if ((this.bleedT > 0 || this.hemorrhageT > 0) && Math.random() < 0.5) {
        // 血尘 5（:92334-92339）：1/2、缺省参直生;Y+0.5 先于 ×0.35（原版语句序）
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 5);
        if (d) { d.vy += 0.5; d.vx *= 0.35; d.vy *= 0.35; }
      }
      if (this.oiledT > 0 && Math.floor(Math.random() * 3) !== 0) {
        // 油滴尘 4（:92417-92440）：外掷 Next(3)!=0=2/3、内 Next(2)==0 生效（净 1/3）;
        // α175+两次 1/2 各+25、色(0,0,0,250)、noLight、v×0.2→Y+0.2→+=实体速度
        if (Math.floor(Math.random() * 2) === 0) {
          const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 2,
            4, 0, 0, 175, { r: 0, g: 0, b: 0, a: 250 }, 1.4);
          if (d) {
            if (Math.random() < 0.5) d.alpha += 25;
            if (Math.random() < 0.5) d.alpha += 25;
            d.noLight = true;
            d.vx *= 0.2;
            d.vy *= 0.2;
            d.vy += 0.2;
            d.vx += this.vx;
            d.vy += this.vy;
          }
        }
      }
    }
    // ---- 1457 新 debuff VFX（UpdateNPC_BuffApplyVFX :92263-92330 + A-5 孢子云
    //      :92878-92894）。原版走 Dust/ParticleOrchestrator,本仓以 spawnParticles
    //      近似（颜色/概率/速率 1:1;粒子形态差异登记）----
    if (this.chlorophyteSporeT > 0) {
      // 叶尘 dust 157（:92321-92330；2026-08-31 C 批：spawnParticles 色近似 →
      // 真实尘型直生）：盒(position−2,+4)、v=velocity×0.4、alpha180、scale1.95
      // noGravity；尾段 velocity×0.75 → X 再 ×0.75、Y−1；1/4 概率转重力+scale×0.5
      if (Math.random() < 4 / 5) {
        const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 4,
          157, this.vx * 0.4, this.vy * 0.4, 180, null, 1.95);
        if (d) {
          d.noGravity = true;
          d.vx *= 0.75; d.vy *= 0.75; d.vx *= 0.75;
          d.vy -= 1;
          if (Math.floor(Math.random() * 4) === 0) { d.noGravity = false; d.scale *= 0.5; }
        }
      }
      // 孢子云 SporeCloud 1/60 每秒掷（:92878,在 !dontTakeDamage 门之外）——
      // 编排粒子型（ParticleOrchestrator），非 Dust 表项：spawnParticles 近似维持（登记）
      if (Math.floor(Math.random() * 60) === 0) {
        game.spawnParticles(
          this.x + 2 + Math.random() * Math.max(1, this.w - 4),
          this.y + 2 + Math.random() * Math.max(1, this.h - 4),
          '#A8D060', 3, Math.min(5, Math.hypot(this.vx, this.vy) * 0.5) || 0.5,
          { life: 40, grav: -0.02, damp: 0.95 });
      }
    }
    if (this.potentAcidT > 0 && Math.random() < 1 / 2) {
      // 强酸气泡尘 dust 171 1/2（:92325-92331,noGravity、fadeIn 1.5、scale 0.5；
      // C 批改真实尘型）
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 171, 0, 0, 100, null, 0.5);
      if (d) { d.noGravity = true; d.fadeIn = 1.5; }
    }
    if (this.stinkyT > 0 && Math.floor(Math.random() * 5) === 0) {
      // 苍蝇尘 dust188（UpdateNPC_BuffApplyVFX :92465-92475，2026-08-31 清偿：
      // spawnParticles 色近似 → 真实尘型直生）：Next(-10,11)^2 归一化、X×0.66、
      // Y 取 |·|；v = 单位向量 × Next(3,5)×0.25；NewDustDirect(position,w,h,188,
      // vX,vY×0.5,100,default,1.5)，尾段 velocity×0.1、Y−0.5
      let ux = Math.random() * 21 - 10, uy = Math.random() * 21 - 10;
      const ul = Math.hypot(ux, uy);
      if (ul > 0) { ux /= ul; uy /= ul; }
      ux *= 0.66; uy = Math.abs(uy);
      const mag = (3 + Math.floor(Math.random() * 2)) * 0.25;   // Next(3,5)
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 188,
        ux * mag, (uy * mag) * 0.5, 100, null, 1.5);
      if (d) {
        d.vx *= 0.1;
        d.vy *= 0.1;
        d.vy -= 0.5;
      }
    }
    if (this.dryadBaneT > 0 && Math.floor(Math.random() * 4) === 0) {
      // 树妖煞尘 dust163 1/4（UpdateNPC_BuffApplyVFX :92448-92453）：盒 (pos−2,w+4,h)
      // vel=(vX*0.4,vY*0.4)，尾段 velocity ×(NextFloat*4−2, 0)、noGravity+noLight
      const d = game.spawnDust?.(this.x - 2, this.y, this.w + 4, this.h, 163,
        this.vx * 0.4, this.vy * 0.4, 100, null, 1.5);
      if (d) {
        d.noGravity = true;
        d.noLight = true;
        d.vx *= Math.random() * 4 - 2;
        d.vy = 0;
      }
    }
    if (this.gelBalloonT > 0 && Math.floor(Math.random() * 4) !== 0) {
      // 微光滴落 dust 243（UpdateNPC_BuffApplyVFX :92563-92583,终零波补齐
      // drippingSparkleSlime NPC 侧尾迹）：外掷 Next(4)!=0=3/4、内 Next(2)==0 生效；
      // 盒 (pos−2,+2,w+4,h+2)、α150 + 内两次 Next(2)==0 各 +25、noLight、
      // velocity×0.2 → Y+=0.2 → +=实体速度（Dust.velocity += this.velocity）
      if (Math.floor(Math.random() * 2) === 0) {
        const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 2,
          243, 0, 0, 150);
        if (d) {
          if (Math.random() < .5) d.alpha += 25;
          if (Math.random() < .5) d.alpha += 25;
          d.noLight = true;
          d.vx *= 0.2;
          d.vy *= 0.2;
          d.vy += 0.2;
          d.vx += this.vx;
          d.vy += this.vy;
        }
      }
    }
    if ((this.blueLightningT > 0 || this.redLightningT > 0) && Math.floor(Math.random() * 10) === 0) {
      //   P57:3617-3672;★2026-08-24 r15 R15-18 接 1457 升级:红雷档
      //   UniqueInfoPiece=GetLightningColor(1122)=(255,60,60) → ①色对覆写
      //   color=PackedValue/value=color×0.75 ②伴生光尘 226→**331 自色**+
      //   noLight(:3654-3670)。916 帧电弧粒子无编排器池 → spawnParticles 近似
      //   (形态差异登记);尘侧按原版参数直生)
      const red = this.redLightningT > 0;
      // 色对(:3619-3627):蓝 (133,255,255)/(15,100,155);红 = 1122 色 / ×0.75
      const cr = red ? 255 : 133, cg = red ? 60 : 255, cb = red ? 60 : 255;
      const vr = red ? 191 : 15, vg = red ? 45 : 100, vb = red ? 45 : 155;
      const n = 1 + (Math.random() < 0.5 ? 1 : 0);            // Next(1,3)(:3619)
      for (let i = 0; i < n; i++) {
        const px = this.x + Math.random() * this.w, py = this.y + Math.random() * this.h;
        game.spawnParticles(px, py, red ? '#FF3C3C' : '#85FFFF', 1, 1.0,
          { life: 14, grav: 0, damp: 0.92 });
        // 1/2 概率伴生光尘(:3661-3672):蓝 226 / 红 331(色=lerp(color,value))
        if (Math.random() < 0.5) {
          const t = Math.random();
          const col = {
            r: Math.round(cr + (vr - cr) * t), g: Math.round(cg + (vg - cg) * t),
            b: Math.round(cb + (vb - cb) * t), a: 0,
          };
          const d = game.spawnDust?.(px, py, 0, 0, red ? 331 : 226, 0, 0, 0, col, 1);
          if (d) {
            d.noGravity = true;
            d.vx = (Math.random() * 2 - 1) * 4;              // NextVector2Circular(4,4)
            d.vy = (Math.random() * 2 - 1) * 4;
            d.scale = 1;                                     // 0.8×1.25(:3665/:3668)
            d.noLight = true;                                // :3669
          }
        }
      }
      game.addLightAt?.(this.cx, this.cy, 0.28, 0.56, 0.7);  // (0.4,0.8,1)×0.7(:3633)
    }

    // 接触伤害（带上攻击者引用，供荆棘反伤）。damage=0（小动物等友好生物）不触发——
    // 否则 damagePlayer(0) 仍会击退/闪红，表现为"兔子撞我有攻击性"。
    // M11：恒对【本地玩家】判定/结算（victim-settles：damagePlayer 只扣本地血；
    // 索敌目标可为访客代理，但访客的接触伤害由其端 netPuppetContact 对傀儡
    // 权威位本地结算——此处若用目标代理会误扣本地玩家的血）
    // ★GetMeleeCollisionData 玩家接触侧收口（2026-08-31，NPC.cs:96111-96280 全支，
    // 求解器=player/MeleeCollisionData.ts）：Update_NPCCollision(:31557-31668) 循环内
    // 三件事按原文序——①specialHitSetter 缺省分道（见下方 npcContactBucketId，含
    // :31571-31587 Boss 族与 :96185-96235 食人魔帧窗覆写 2=LegacyUnused2）；②盒变形/
    // 替换先于 Intersects（:31598-31601）；③乘区在 DamageVar 前乘入（:31624），漏斗
    // 内 banner/荆棘/resistCold 以同一基准消费。先求解后判交：加宽族（430-436·591 /
    // 494-495）无相交门恒生效；460/417/466/552-554/576-577/668 的专盒未命中时回落裸
    // 盒 ×1.0（ref 未被改写）。rect=null ⇒ 原版 npcRect=default 永不相交：400 真眼零
    // 接触（此前显式 vanillaId!==400 早退并入此路，语义同式 ：96143-96144）。
    // ★SW-BJ34 2026-09-08：皇家凝胶接触面跳过（原版 Update_NPCCollision 循环头
    //  :31588 `|| npcTypeNoAggro[Main.npc[i].type]` → continue；1456 :30892 同式）
    //  ——装备 3090 后 23 类史莱姆（含熔岩史莱姆 59）【零接触结算】：无伤/无击退/
    //  无无敌帧/无 buff 蹭，且先于 GetMeleeCollisionData(:31595) 与蜂蜜史莱姆支
    //  (:31598)——凝胶在身蜂蜜史莱姆也不蹭蜜。此前整缺 = 熔岩史莱姆照撞掉血
    //  （用户实报）。旗源 npcTypeNoAggro（装备旗 3090 专面，不含镇静）。
    if (localPlayer && !localPlayer.dead && this.def.damage > 0
      && this.vanillaId != null
      && !npcTypeNoAggro(this.vanillaId, localPlayer)) {
      const victim = { x: localPlayer.x, y: localPlayer.y, w: localPlayer.w, h: localPlayer.h };
      const gmc = getMeleeCollisionData(victim, {
        vanillaId: this.vanillaId,
        ai0: this.ai0, ai1: this.ai1, ai2: this.ai2, ai3: this.ai3,
        x: this.x, y: this.y, w: this.w, h: this.h,
        direction: (this.facing === -1 ? -1 : 1),
        spriteDirection: (this.facing === -1 ? -1 : 1),
        frameY: this.vanillaGridFrameIdx,
      });
      if (!gmc.rect || !boxesIntersect(victim, gmc.rect)) {
        // rect=null（真眼）或变形后不相交 ⇒ 整段跳过（无 buff 蹭/无伤/无无敌帧）
      } else if (this.vanillaId === 1 && this.ai1 === 1125) {
        // 蜂蜜史莱姆（NPC 1 且 ai[1]=1125，Player.cs:30902-30908 接触分支最前）：
        // AddBuff(48 Honey, 1800t=30s) 后 continue——**免接触伤害/击退/无敌帧**，
        // 语义是"蹭一身蜜"而非攻击（此前仅 SLIME_ITEM_COLORS 染色，接触照常掉血）
        localPlayer.buffs?.apply(BuffType.Honey, 30);
      } else {
        // R5-F21：接触伤 DamageVar ±15% 掷骰（Player.cs:31624 `num4 = Main.DamageVar(
        // npc.damage × damageMultiplier, -luck)`——multiplier 先于 DamageVar 乘入；
        // banner 减伤/thorns 反射/resistCold 在 Game.damagePlayer 内吃同一基准,
        // 序 = DamageVar → banner → resistCold → Hurt 与原版一致）
        // ★Notes⑤ 前半（四轮蓝队）：月总族接触分桶（Update_NPCCollision :31571-31587）
        //   ——type 396/397/398/400/401·636 specialHitSetter=BossNoCheese(1);636 于
        //   ai[0]==0||10 整段 continue;该族同时跳过 :31588 General immune 早退=通用
        //   无敌帧吞不掉本桶命中（免疫改由 hurtCooldowns[1] 独立计时,p.damage 分桶门
        //   已建模）。★LegacyUnused2 档：576/577 FindFrame y∈15..18 帧窗把 ref 覆写 2
        //   （GetMeleeCollisionData 后写赢,先于相交判定置位）。桶经瞬态通道注入漏斗,
        //   出站即清（与环境站同形）。null=原文 continue。
        const frameY = this.vanillaGridFrameIdx;
        const bucket = npcContactBucketId(this.vanillaId, this.ai0 ?? 0, frameY);
        const chan = localPlayer as unknown as {
          __swNextHitBucket?: { id: number; table: HurtCooldownBuckets };
        };
        const table = getGlobalHurtBuckets();
        const inject = bucket !== null && bucket !== -1 && table
          ? { id: bucket, table }
          : undefined;
        if (inject) chan.__swNextHitBucket = inject;
        try {
          const landed = game.damagePlayer(
            damageVar(this.def.damage * gmc.damageMultiplier, -localPlayer.luck),
            this.cx, this.cy, this, true);
          // IIII225：StatusFromNPC 携物史莱姆支（Player.cs:22559-22640，调用点
          // :31663 `Hurt(...) > 0 && !dead && !flag2` → StatusFromNPC(npc)——
          // 实扣>0 才授）。SlimeCanContainItems ∧ ai[1]>0 的接触携物状态梯；
          // ★StatusFromNPC 全表其余 type 臂（蜘蛛 Chill/木乃伊流血/猪龙等
          // :22645-22760）本批未建模=登记债（非五旗面,唯 FTW 火把史莱姆臂在此支内）
          if (landed) {
            const oreRet = this.slimeCarryContactStatus(game, localPlayer);
            // ★IIIII228：StatusFromNPC 全表 type 臂（Player.cs:22513-22771）——
            //  蜘蛛 Chill/木乃伊流血/猪龙 Rabies/脑专家九选一等 33 臂整表接线
            this.statusFromNpcTypeArms(game, localPlayer, oreRet);
            // ★CalPlayer 基建(六十四刀):mod NPC 接触命中 → 声明面 debuff
            //  (OnHitPlayer AddBuff 形;chance 掷+modBuffTypeOf 9000+ 域,hooks 内)
            runModOnHitPlayerBuff(this.vanillaId, localPlayer, game);
          }
        } finally {
          if (inject) chan.__swNextHitBucket = undefined;
        }
      }
    }

    // Despawn 系统（原版 CheckActive :78698-78810 + EncourageDespawn :7276-7283）：
    // 四步流程——①activeRange 盒（2.1×屏,4032/2520px）相交任一活跃玩家 → flag2 存活门
    // （+nearbyActiveNPCs 记账,现移 Game.ts 按盒累计）；②boss :78743 / 强真名单
    // :78747-78767 存在活跃玩家即保命（无几何要求）；③屏幕盒（960+w/600+h）相交
    // → timeLeft=activeTime(750)+清鼓励旗——EncourageDespawn 钉低值的唯一抵消点；
    // ④timeLeft 每帧无条件 −1,归零 → flag2 强制翻假 :78791-78794 → 消散 :78795-78808。
    // ★CRITICAL（2026-09-02 定罪落锤）：原版【无 boss 短路】——boss 的 flag2 强真
    //   :78743 挡不住 timeLeft 归零强制翻假 ⇒ boss 离 activeRange 盒即消、盒内离屏
    //   750t 也消（bossFled 记账承接,Game 端不写 downed/不播击败）。旧
    //   `!this.def.boss || despawnEncouraged` 短路使 boss 从不进四步 = boss 永生偏离,
    //   已摘除；boss 保命完全交②（任一活跃玩家在场,尸体 hitbox 照常,T6 注）。
    //   推演：boss 离屏 750t → ④归零 → runDespawnFx → bossFled=true ✓；
    //   boss 屏内/activeRange 内 → ①②保命 ✓；白天 EncourageDespawn(10) 封顶后
    //   飞出屏带 → ③停更 → 剩余 timer≈10 → 秒消（原版天亮 boss 退场语义）✓。
    // ★消散域登记不修（红队 C 仲裁,2026-09-02 备案,勿当新债重复报）：
    //   ① cands 空支：零活跃玩家时原版经 !flag2 当帧消散(:78795),本仓取纯倒数归零
    //     ——护栏是有意偏离（改立消=测试桩/无世界态场景死亡瞬间团灭;真实环境恒含
    //     local player,量化差 0 帧 vs ≤12.5s）；
    //   ② 594 风气球 slave 44px 屏幕边界几何巧合（挂载链路径,不可观测窗）
    //     → 已清偿（T4 2026-09-02,删 runDespawnFx 随杀支,slave 自身四步清账）；
    //   ③ case 399 火星探测器潜伏态缺口（:78768-78774 未移植——逃逸 ≤240t≪750t,
    //     无可观测窗）→ 已清偿（T3 2026-09-02,四步内补 case 399 支,见 fairy 块后）；
    //     ⑥清偿后 canAnyPlayerSeeThisTile 画布无关化已做,不在此列；
    //   ④ nearbyActiveNPCs 按盒记账（Game.ts,MINOR-5）若引发刷怪回归则回退并登记。
    if (this.vanillaId === 488
      || (this.vanillaId != null && this.vanillaId in TOWER_KEY)
      || (this.vanillaId != null && NO_DESPAWN_IDS.has(this.vanillaId))
      // 376 睡渔夫/579 醉酒酒保：原版 CheckActive 可离屏消散，但由 spawner 海洋/沙滩
      // 支每轮重掷即时补回（NPC.cs:1685-1837 各门 !savedAngler && !AnyNPCs(376) 恒开）；
      // 本仓改为 placeSleepingAngler 确定性补放（2 分钟一轮），离屏 750t 自灭会让
      // "未解救则持续在场"断供——豁免 despawn 为仓内等价（何时放差异登记在案）
      || this.vanillaId === 376 || this.vanillaId === 579
      // 条件豁免（NPC.cs:78645-78679）：139 Betsy 需 134 在场；552-578 OOA 怪需 548
      // 永恒水晶在场（事件怪不应离屏自灭）
      || (this.vanillaId === 139 && this.anyNpcAlive(game, 134))
      || (this.vanillaId != null && this.vanillaId >= 552 && this.vanillaId <= 578 && this.anyNpcAlive(game, 548))
      // 690 雕像宝箱怪伪装态（MAJOR-1 收窄,原版 CheckActive 头部门 :78700 只豁免
      // ai[0]==0 伪装态;唤醒态 ai0=1 照走四步,离屏消散 → !AnyNPCs(690) 再刷门解除。
      // 伪装态另有 statueMimicAI 每帧 despawnTimer=750 续命写(:43765),与本门并存不冲突）
      || (this.vanillaId === 690 && this.ai0 === 0)) {
      // 训练假人不参与 despawn（原版 netAlways + TileEntity 生命周期由锚 tile 管理）；
      // 四塔同样豁免（DoesntDespawnToInactivity 名单 NPC.cs:78634-78635 含 422/493/507/517
      // ——事件建筑离屏消失会让 UpdateLunarApocalypse 永远等不到塔死）
    } else {
      // ★T6（2026-09-01，RV-R4 附带定罪）：候选剔 dead 系过度删除，废——原版扫描门
      //   只有 `if (!Main.player[i].active) continue;`（:78706-78710），死亡玩家
      //   active 仍真（Player.KillMe 只置 dead/respawnTimer，不动 active；active=false
      //   仅离线/槽回收）⇒ 尸体照样吃两窗几何：activeRange 盒照常置 flag2 保命、
      //   屏幕盒照常 timeLeft=750 + 清鼓励旗——死亡玩家屏内仍阻挠 despawn 续命。
      //   旧「尸体不算屏内」（M11 dev 注）双向偏离：死亡瞬间全场怪离屏倒数、Boss
      //   鼓励消散在尸位屏内提前成立。
      //   同口径收窄参照：原版【不查 dead】的门 = CheckActive :78706 /
      //   CanAnyPlayerSeeThisTile :43877 / AI_007 回家传送视野门 :53994 /
      //   对话朝向 num9 :53871-53883（KillMe 不清 talkNPC）；【查 dead】的门 =
      //   TargetClosest :78459 / stinky 玩家扫 :54081 / CanBeTalkedTo
      //   Player.cs:3872 / dryad 咏唱 Projectile.cs:41952——后者本仓均已保留。
      // M11：原版 :78703-78720 扫全部 255 槽——任一活跃玩家在屏内即重置；
      // 联机下访客在屏内同样压制 despawn（单机 = 仅本地，零回归）
      // 消散副作用（bossFled/风气球挂载/蠕虫整链）——两条路径共用
      const runDespawnFx = () => {
        // NPC.noSpawnCycle（:78797,先于 active=false :78798）：本帧消散 → 同帧刷怪
        // 周期跳过一次（Game.trySpawnEnemy 入口消费+清零,原版 SpawnNPC :80991-80995）
        game.noSpawnCycleThisFrame = true;
        if (this.def.boss) this.bossFled = true; // 非击杀消亡:天亮离场/离屏消散/玩家死后撤离
        // ★T4 清偿（2026-09-02,用户拍板"登记不修"清零）：删「594 消散随杀 slave」支。
        //   原版气球自然消散（CheckActive）不牵连挂载史莱姆——vanilla 无 594 支,slave
        //   靠自身四步清账：ai[0]=-999 只冻结 AI_001 跳跃机（:61644 帧 0 return,冻结
        //   的只是 AI 不冻 despawn）,slave vanillaId=1 不在 NO_DESPAWN_IDS/豁免表,
        //   照走本四步;气球盒 20×20×scale 与 slave 吊挂 -44px 的屏幕边界带几何差
        //   （红队 C"44px 巧合"）由 slave 独立计时自然抹平。爆裂（击杀）路径的解冻
        //   臂不动（HitEffect :82586-82594 slave ai0=0+上移 10,死亡路径另有同款）
        this.dead = true;
        // 蠕虫离屏消散 → 整链同灭（消散路径原版 = CheckActive_WormSegments
        // :78812-78833：自 ai[0] 前向逐段 active=false——头消散即全链退场,Transform
        // 自愈 :52059-52065 只服务伤害路径头死;水蛭头 117 不在闲置豁免名单，离屏
        // 消散时其体节 118/119 在名单内不会自行消散，需此处级联，否则留无驱动的
        // 冻结残段；段自查 :51832-51841 为伤害路径同归臂）
        if (this.wormNext || this.wormFollow) {
          let wh: Enemy = this;
          while (wh.wormFollow) wh = wh.wormFollow;
          for (let s: Enemy | null = wh; s; s = s.wormNext) s.dead = true;
        }
      };
      // ★忠实重放 CheckActive(:78698-78810,2026-09-01 定罪重写):
      //  前结构「encouraged 屏内也倒数」系杜撰——原版机制分四步:
      //  ①rectangle(ActiveRange)=2.1×屏(:6176-6178)相交任一玩家 → flag2=true 存活门
      //  ②boss(:78743)/强真名单(:78747-78767)只需存在活跃玩家即 flag2=true
      //  ③rectangle2 屏幕矩形(半幅 960+w/600+h,:78691-78693——F1 纠偏,旧 62×35 格近似退役)每 tick 重置 750+清鼓励旗
      //    ——这是 EncourageDespawn 钉低值的唯一抵消点:怪天亮向上飞,**在屏内绝不
      //    消散**;飞出屏幕瞬间 reset 停止 → 剩余 timer≈封顶值(10t)→ 秒消散
      //  ④timer 每帧无条件−1,归零 → flag2 强制翻假(:78791-78794,无视①②保命门)
      // ★T6（2026-09-01）：候选剔 dead 系过度删除——死玩家 active 仍真（见上注）,
      //   照常参与①④两窗几何。此处仅剔空槽（!Main.player[i].active,:78706 唯一门）。
      const cands = (game.candidatePlayers?.() ?? [localPlayer as Player])
        .filter((q) => !!q);
      if (cands.length > 0) {
        let flag2 = false;
        for (const q of cands) {
          // ★F1 纠偏：activeRangeX/Y = (int)(sWidth*2.1)/(int)(sHeight*2.1) =
          //   4032/2520px（NPC.cs:6176-6178,sWidth/sHeight=1920/1200 :6791-6793,
          //   rectangle 相交 :78705-78706）——旧 Y 半幅 TILE*142=2272px 系误植,
          //   2272~2520px 竖向带内原版保命、我方提前消散。中心距式再外扩玩家
          //   半宽/半高 = hitbox 相交的等价改写（MINOR-1,见 CHECK_ACTIVE_HALF_X 注）
          if (Math.abs(q.cx - this.cx) < CHECK_ACTIVE_HALF_X + q.w / 2
            && Math.abs(q.cy - this.cy) < CHECK_ACTIVE_HALF_Y + q.h / 2) {
            flag2 = true;
            break;
          }
        }
        // boss(:78743)/ALWAYS_ACTIVE 名单(:78747-78767):存在活跃玩家即保命,
        // 无几何要求(强真名单只置 flag2 不续 timeLeft)。★boss 归零翻假 :78791-78794
        // 仍会消散(CRITICAL 摘短路后的唯一 boss 保命通道就是本支+①几何窗)
        if (!flag2 && ((this.vanillaId != null && ALWAYS_ACTIVE_IDS.has(this.vanillaId))
          || this.def.boss)) {
          flag2 = true;
        }
        // case 583/584/585 仙灵钉活（MAJOR-2,NPC.cs:78775-78783）：夜间且 ai[2]==0
        // （闲置微漂态;引导/逃逸/飞离等 ai2∈{1,2..7} 特殊行为态不续命,本仓 fairyAI
        // ai2 语义同源）→ flag2=true + timeLeft=activeTime 每 tick 续命——仙灵夜里
        // 离屏不消散,天亮即恢复普通倒数（原版昼消夜存的夜灯语义）
        if (this.vanillaId != null && this.vanillaId >= 583 && this.vanillaId <= 585
          && !game.world.clock.isDay && this.ai2 === 0) {
          flag2 = true;
          this.despawnTimer = 750;
        }
        // case 399 火星探测器（★T3 清偿 2026-09-02,NPC.cs:78768-78774 直译——原版
        // switch 在玩家循环内、矩形门外=有活跃玩家即生效,与①无几何差）：
        // flag2=true 恒置（潜伏 ai0=0 亦然——超出 activeRange 不再秒消,保命到
        // timeLeft 归零强制翻假 :78791）;报警 ai0=1/逃逸 ai0=2 态再续
        // timeLeft=activeTime → 计时器永不归零 = 逃逸全程不消散,直至 AI 侧出屏/
        // 180t 入侵自灭（bossAI_martian.martianProbeAI ai0 三态与原版 1:1:
        // 0 巡逻/1 受惊悬停 60t/2 逃逸,-1/-2 冻结态为飞碟专属不涉本支）
        if (this.vanillaId === 399) {
          flag2 = true;
          if (this.ai0 === 1 || this.ai0 === 2) this.despawnTimer = 750;
        }
        // ★F1 纠偏：rectangle2 半幅 = sWidth/2+width / sHeight/2+height = 960+w /
        //   600+h（NPC.cs:78691-78693 逐项展开）——旧 TILE*62/TILE*35（992/560px）
        //   系 32×32 定宽近似；高≥48 的怪（560<600+32≤600+h）屏内续命窗被低估
        //   40~72px。逐例求值后 X 项对 32 宽 NPC 数值不变（960+32=992）。
        //   MINOR-1：再外扩玩家半宽/半高 = hitbox 相交等价改写,消除"玩家贴边半身
        //   入屏时 activeRange 窗续命、屏幕窗不续命"的边缘带不对称
        const screenHalfX = 960 + this.w, screenHalfY = 600 + this.h;
        const onScreen = cands.some((q) =>
          Math.abs(q.cx - this.cx) < screenHalfX + q.w / 2
          && Math.abs(q.cy - this.cy) < screenHalfY + q.h / 2);
        if (onScreen) {
          this.despawnTimer = 750;
          this.despawnEncouraged = false;
        }
        this.despawnTimer--;
        if (this.despawnTimer <= 0) {
          flag2 = false; // :78791-78794 归零 → 无条件允许消散(含 boss/名单)
        }
        if (!flag2) runDespawnFx();
      } else {
        // 零活跃玩家（仅测试桩/无世界态可现；真实游玩本地槽恒 active、死亡也照常
        // 算几何=T6）：原版该态经 `!flag2` 立即消散(:78795-78798)——本仓保守取
        // 纯倒数归零（登记项①,见上方消散域备案;防桩场景团灭误伤,量化差
        // 0 帧 vs ≤12.5s）。runDespawnFx 照置 noSpawnCycle（:78797 该态同样置位）
        this.despawnTimer--;
        if (this.despawnTimer <= 0) runDespawnFx();
      }
    }
    this.ambientSoundTick(game);   // 环境声三表（IdleSounds/闲话/Critter,2026-08-18 批）
    this.findFrameRotation(game);  // FindFrame 旋转写点层+组内尘（AI 后同序，2026-08-20 旋转审计;★BJ589 传 game=组内尘位次）
    this.recordTrailHistory();   // 原版 UpdateNPC_UpdateTrails（TrailingMode 分派——
                                 // 473-476 mode 2 态门+清零,余族逐拍;拖尾族 419/125-131 读）
  }

  /** Collision_DecideFallThroughPlatforms（NPC.cs:94118-94252）1:1 全表：
   *  true = 本 tick 平台不作为落面（下落穿透）。极性对读：Update :93738
   *  `fall = Collision_DecideFallThroughPlatforms()` → ApplyTileCollision(fall,…)
   *  → TileCollision fallThrough 参（恶魔眼族/aiStyle 5 飞行武器/40 蜘蛛/44 飞鱼/
   *  22 幽灵/49/14 等飞行族恒 true；aiStyle 3 战士族 directionY==1 下落中才穿）。
   *  aiStyle 7 城镇支（:94216-94251）依赖 homeTileY——本仓城镇 NPC 恒 homeTileY=-1
   *  （无 home,Enemy.townNPC 注），两分母（homeTileY-行>16 / 行<-2）恒假 → 恒不穿 */
  decideFallThroughPlatforms(game: GameHooks): boolean {
    const t = this.vanillaId;
    const st = this.vanilla?.aiStyle ?? 0;
    if (t != null && (t === 2 || t === -43 || (t >= 190 && t <= 194) || t === 317 || t === 318 || t === 133)) return true;
    if (st === 10 || st === 5 || st === 40 || st === 44 || st === 22 || st === 49 || st === 14) return true;
    if (t != null && (t === 467 || t === 477 || t === 173 || t === 210 || t === 211
      || t === 247 || t === 248 || t === 418 || t === 405 || t === 406 || t === 490 || t === 301)) return true;
    if (t === 469 && this.ai2 === 1) return true;                       // :94161
    if (st === 3 && this.dirY === 1) return true;                       // :94164 战士族下落穿
    const p = game.player as Player | null;
    const pBelow = !!p && p.y > this.y + this.h;                        // player.position.Y > bottom
    // target>=0 门（:6374 缺省 -1）≈ hadTarget（seekDirX 生效过即置位;潜行/镇静
    // 早退分支原版仍写 target、本仓不置——一拍自愈,登记）
    if (t === 50 && this.hadTarget && pBelow) return true;              // :94170 史王
    if (t === 657 && this.hadTarget && p && p.y > this.y + this.h) return true; // :94174 史皇后
    if (st === 26 && this.hadTarget && p && p.y + p.h - this.vy > this.y + this.h) return true; // :94178 独角兽族
    if (t === 245 && this.hadTarget && pBelow) return true;             // :94183 石巨人本体
    if (t != null && t >= 542 && t <= 545) return true;                 // :94187
    if (st === 107 && this.dirY === 1) return true;                     // :94190
    if (st === 87 && pBelow) return true;                               // :94194 宝箱怪(原版无 target 判)
    return false;
  }

  /** FindFrame 旋转写点层（NPC.cs FindFrame 逐 case 1:1，AI 主体之后执行——
   *  原版 FindFrame 每 tick 在 AI 后跑，其中十余 case 写 rotation；本仓此前只搬了
   *  帧 logic 漏了旋转，2026-08-20 旋转三件套审计补齐。spriteDirection=direction
   *  的 case 全部保留通用 facing 镜像（不进 rotationDriven）。 */
  /** ★BJ700b 龟族(616/617/625) FindFrame 逐字帧机（NPC.cs case 616 :77486-77530 /
   *  case 625 :77532-77578;FindFrame 在 UpdateCollision 后跑=读碰撞末态 vx/vy/wet,
   *  本方法挂 fixedUpdate 尾 findFrameRotation 层同拍面）。三带：
   *  · 湿泳带 8..13（625:6..11）——阈值 vx==0 加倍（num196 5→10 / num187 4→8）,
   *    >wetWrap 回 wetBase；616/617 入水【无】带切换（帧号续走,原版 quirk 照抄）,
   *    625 入水 <wetBase 抬 wetBase（:77543）/ 出水 >wrap 回 0（:77559）。
   *  · 干走带 0..7（625:0..5）——9t/帧（num195=8,625 num186=7 → 8t）。
   *  · 站定(vx==0)清零钉帧 0；腾空(vy≠0)清零钉帧行 8（625 无此钉）。
   *  ★落地节拍:腾空每拍清零 → 落地拍 counter 从 0 起步 → 帧 8 保持 8 拍(L..L+7),
   *  L+8 拍 8+1=9 过回卷门 >wrap → 帧 0,再 9 拍进 1——「跳旋落地→蜷壳定拍→出壳
   *  起步」；旧 Renderer 全局相位（floor(t/9)%8）落地即跳任意中幅帧（BJ700b 病灶）。 */
  private turtleFindFrameStep(): void {
    const vid = this.vanillaId ?? 0;
    if (vid !== 616 && vid !== 617 && vid !== 625) return;
    const sea = vid === 625;
    const walkStep = sea ? 7 : 8;                                    // num186 / num195
    const wetStep = this.vx === 0 ? (sea ? 8 : 10) : (sea ? 4 : 5);  // num187 / num196(vx==0 加倍)
    const wrap = sea ? 5 : 7;                                        // 干带回卷上界
    const wetBase = sea ? 6 : 8, wetWrap = sea ? 11 : 13;
    if (this.wet) {
      if (sea && this.turtleFrame < wetBase) this.turtleFrame = wetBase;   // :77543 入水抬带
      this.turtleFrameT++;
      if (this.turtleFrameT > wetStep) {
        this.turtleFrameT = 0;
        this.turtleFrame++;
        if (this.turtleFrame > wetWrap) this.turtleFrame = wetBase;
      }
    } else {
      if (sea && this.turtleFrame > wrap) this.turtleFrame = 0;           // :77559 出水回落带
      this.turtleFrameT++;
      if (this.turtleFrameT > walkStep) {
        this.turtleFrameT = 0;
        this.turtleFrame++;
        if (this.turtleFrame > wrap) this.turtleFrame = 0;
      }
      if (this.vx === 0) { this.turtleFrameT = 0; this.turtleFrame = 0; } // 站定钉（:77520）
      if (!sea && this.vy !== 0) { this.turtleFrameT = 0; this.turtleFrame = 8; }   // 腾空钉（:77525,625 无）
    }
  }

  /** ★BJ704（用户实报「巨型陆龟倒着走+边走边缩龟壳」定谳）：AI_039 陆龟族 FindFrame
   *  （NPC.cs:78093-78162,type≠417——417 Sroller 走态 6 专支不入本帧机）。
   *  旧仓 153/154/496/497 【零帧机路由】=两症状同根：
   *  · 症状①倒走：态 3 旋冲 visAngle 累计（:8035/:8060）经 justHit 直跳态 0
   *    （:7728 无中途态 5）后无人清角——原版 FindFrame 态 0 头 :78097 `rotation=0f`
   *    【每帧复位】是唯一回收点,仓内整块缺失 → 残留 π 量级累计角=倒挂行走;
   *  · 症状②缩壳帧混播：渲染层无专支落通用年龄循环,8 帧表连播走带(0-4)+缩壳带
   *    (5-7)=「边走边缩龟壳」（Renderer 533 支同病先例「两带混播」）。
   *  帧机逐字：态 0 vy==0 → spriteDirection=direction（仓 facing≡direction 同源,
   *  写面内含）;vy<0 → frameCounter=0（上升锁帧 0）;counter += |vx|×1.1,带
   *  <6/<12/<18/<24/<32 → 帧 0/1/2/3/4,≥32 回卷（帧 4 多停一拍=原文 else 只清
   *  counter 不写 Y 的 quirk 照录）。态 1（ai1<10/<20/else→5/6/7）,态 5 反序
   *  （7/6/5）,态 3/4 恒帧 7+counter=0。 */
  private tortoiseFindFrameStep(): void {
    const vid = this.vanillaId ?? 0;
    if (vid !== 153 && vid !== 154 && vid !== 496 && vid !== 497) return;
    // ★BJ704-R12 P2-1：496/497 巨贝=FindFrame【双段】——switch case 块（NPC.cs
    //   :70776-70846）先跑 +=|vx|×1.1 且自身 ≥24 回卷掐周期,switch 外的 aiStyle-39
    //   尾段（:78093+）再 += 并以尾段帙（0-4/<32）覆写 ⇒ 双增量=走态 ~2×速、帧 4
    //   仅 ~1t 闪现（|vx|=1 周期 ≈12t）。态 1/5/else 的 case 帙（4/5/6、10/11/3）
    //   被尾段覆写=无行为差。153/154 无 case 块=单增量（勿连坐）。旧注「帧机逐字」
    //   对 496/497 不确切,本刀勘正。
    const shellyDouble = vid === 496 || vid === 497;
    if (this.ai0 === 0) {
      this.visAngle = 0;                                   // :78097 逐帧清（justHit 出旋冲残角唯一回收点）
      if (this.vy < 0) this.tortoiseFrameT = 0;            // :78104 上升锁帧计数（帧落带 0）
      if (shellyDouble) {
        this.tortoiseFrameT += Math.abs(this.vx) * 1.1;    // :70788 case 侧第一增量
        if (this.tortoiseFrameT >= 24) this.tortoiseFrameT = 0;   // :70807-70810 case 侧 ≥24 回卷（Y 不写,尾段再赋）
      }
      this.tortoiseFrameT += Math.abs(this.vx) * 1.1;      // :78108 尾段第二增量（153/154=唯一增量）
      if (this.tortoiseFrameT < 6) this.tortoiseFrame = 0;
      else if (this.tortoiseFrameT < 12) this.tortoiseFrame = 1;
      else if (this.tortoiseFrameT < 18) this.tortoiseFrame = 2;
      else if (this.tortoiseFrameT < 24) this.tortoiseFrame = 3;
      else if (this.tortoiseFrameT < 32) this.tortoiseFrame = 4;
      else this.tortoiseFrameT = 0;                        // :78128-78130 回卷（Y 不写=帧 4 多停一拍原文形）
    } else if (this.ai0 === 1) {
      this.tortoiseFrameT = 0;
      this.tortoiseFrame = this.ai1 < 10 ? 5 : this.ai1 < 20 ? 6 : 7;   // :78134-78146 缩壳递进
    } else if (this.ai0 === 5) {
      this.tortoiseFrameT = 0;
      this.tortoiseFrame = this.ai1 < 10 ? 7 : this.ai1 < 20 ? 6 : 5;   // :78149-78161 出壳反序
    } else {
      this.tortoiseFrameT = 0;
      this.tortoiseFrame = 7;                              // :78163-78167 态 3/4 恒壳
    }
  }

  private findFrameRotation(game?: GameHooks): void {
    const vid = this.vanillaId ?? 0;
    if (vid === 616 || vid === 617 || vid === 625) this.turtleFindFrameStep();   // ★BJ700b 龟族帧机（无 rotation 写点,只推进计数器）
    if (vid === 153 || vid === 154 || vid === 496 || vid === 497) this.tortoiseFindFrameStep();   // ★BJ704 陆龟族帧机+态 0 rotation 复位
    // ★BJ706-A DD2 walker 族帧机（FindFrame 专属 case 逐字,无 rotation/sdir 写点——
    //  显示镜像仍走通用 facing 门,与原版 sdir=direction 同极性）。customFrameIdx 落
    //  位后 Renderer 通用 fighter 档（ai===107 → 2..frames-1/0/frames-1）对这 14 型
    //  不再生效（vanillaFrameIdx 顶部直读优先）——修前走路播攻击带 = 用户实报
    //  枯萎兽/德拉肯「一直倒着走」。620 地精鲨（wet 档）与 576/577（网格）不入。
    if ((vid >= 552 && vid <= 557) || (vid >= 561 && vid <= 563) || (vid >= 566 && vid <= 573)) this.dd2WalkerFindFrame();
    if (vid === 75) this.visAngle = this.vx * 0.1;                    // 精灵 :74820
    else if (vid === 122) this.visAngle = this.vx * 0.05;             // 蜗牛怪 :74307
    else if (vid === 330) {
      // 骚灵 FindFrame case 330（:75684-75691）——★C12/R11-F3 补 sdir 死区档
      // （:75685-75690 if/if,vx==0 保前值;AI_022 亲读 330 无 sdir 写点=显示面唯一来源）;
      // rotation=vx×0.15（:75691）原有。
      if (this.vx > 0) this.ffSdir = 1;
      else if (this.vx < 0) this.ffSdir = -1;
      this.visAngle = this.vx * 0.15;
    }
    else if (vid === 301) {
      // 渡鸦 FindFrame case 301（:74257-74271 专属支）：spriteDirection 有态写点——
      //   落地(vy==0) =-direction(:74260)；飞行 vx>0.5→-1 / vx<-0.5→1(:74263-74270)、
      //   |vx|≤0.5 死区保前值（滞回）。rotation=vx×0.1（:74287）。
      //   渲染层 drawEnemy 按 ravenSdir==1 镜像（Main.cs:22984 spriteDirection==1）
      if (this.vy === 0) this.ravenSdir = -this.facing;
      else if (this.vx > 0.5) this.ravenSdir = -1;
      else if (this.vx < -0.5) this.ravenSdir = 1;
      this.visAngle = this.vx * 0.1;
    }
    else if (vid === 156 || vid === 62 || vid === 66) this.visAngle = this.vx * 0.1;  // ★BJ590 红魔/恶魔/巫毒恶魔(FindFrame :74699/:74683-74698 vx×0.1,sdir=direction→通用 facing 镜像;226 已并 FF_VXSDIR_GROUP 族支)
    else if (vid === 509 || vid === 581) this.visAngle = this.vx * 0.1;  // 巨型飞蚁狮/飞蚁狮（AI 段 :31107/:31140）
    else if (vid === 224 || vid === 587) {                            // 飞鱼/眼球飞鱼 :75559-75568
      // ★C12/R11-F3 补 sdir 死区档（:75561-75568 if/if——rotation ±vy×0.2 与 sdir
      // 同支同写,本仓 rotation 已接 sdir 缺=R11 定谳形态）;vx==0 两面均保前值。
      if (this.vx > 0) { this.ffSdir = 1; this.visAngle = this.vy * 0.2; }
      else if (this.vx < 0) { this.ffSdir = -1; this.visAngle = -this.vy * 0.2; }
    } else if (vid === 603) {                                         // 海鸥2 :74550+
      if (this.wet || this.vy === 0 || (this.vx === 0 && this.vy === 0)) this.visAngle = 0;
      else this.visAngle = this.vx * 0.1;
    } else if (vid === 230 || vid === 593) {                          // 走路金鱼/金走路金鱼 :76585+
      if (this.vy === 0) this.visAngle = 0;
      else if (this.vy > 4) this.visAngle -= this.vy * 0.01;          // 高速下落抬头
    } else if (vid === 461) {                                         // 深渊来客 :76025-76075
      if (this.vy !== 0) {
        // spriteDirection=direction；翻面时 rotation 取反（:76027-76033）
        const dir = this.vx !== 0 ? (this.vx > 0 ? 1 : -1) : this.facing;
        if (this.facing !== dir) { this.visAngle *= -1; this.facing = dir; }
        const tgt = Math.atan2(this.vy * dir, this.vx * dir);
        if (Math.abs(this.visAngle - tgt) >= Math.PI) {
          this.visAngle += this.visAngle < tgt ? 6.283 : -6.283;      // 走最短弧
        }
        this.visAngle = (this.visAngle * 4 + tgt) / 5;                // 平滑追踪
      } else if (this.visAngle > 0.01 || this.visAngle < -0.01) {
        this.visAngle *= 0.9;                                         // 落地回正
      } else this.visAngle = 0;
    } else if (vid === 469) {                                         // 被附身者 :76365+
      if (this.ai2 === 1) this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      else this.visAngle = 0;
    } else if (vid === 133) {                                         // 游荡眼 :74760-74769
      if (this.vx > 0) this.visAngle = Math.atan2(this.vy, this.vx);
      else if (this.vx < 0) this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI;
    } else if (vid === 574 || vid === 575) {
      // ★BJ591 DD2 滑翔怪 FindFrame case 574/575（NPC.cs:68658-68751）——帧档+尘面
      // 有态机（koboldFlyerFindFrame）。sdir/rotation 两写点已有在轨对映:AI_108 每
      // tick 直写 facing=-sign(vx)（≙ :68661-68668 sdir=sign(vx) if/if 死区档,
      // 取负系本仓 facing 语义）与 visAngle=±π 折叠速度角（:66120 rotation 直写+
      // 本 case :68669-68674 AngleTowards 0.02 微推 ≤0.02rad,渲染端 108 旋转消费
      // 已定谳）——本层只补帧机与尘面,不重复写旋转。
      // ★C12/R11-F2 sdir 死区档收编（:68661-68668 sign(vx) if/if → ffSdir 单源写点,
      //   本层序 = 原版 case 内 sdir 写（:68663-68668）先于口部尘锚 vector4 消费
      //   （:68687）——koboldFlyerFindFrame 的口部锚改读 ffSdir 同拍同值;AI 层
      //   facing=−sign(vx) 原样保留（AI 语义）,显示镜像走 ffSdirMirror 门（修前
      //   通用 facing 门 flip⟺vx<0 = 反极性,与 558-560 同病同刀）。
      if (this.vx > 0) this.ffSdir = 1;
      else if (this.vx < 0) this.ffSdir = -1;
      this.koboldFlyerFindFrame(game);
    } else if (vid === 558 || vid === 559 || vid === 560) {
      // ★C12/R11-F1 埃特尼亚飞龙 FindFrame case 558-560（NPC.cs:68609-68645）：
      //  · sdir=sign(vx) if/if 死区档（:68613-68618,vx==0 保前值）→ ffSdir;
      //  · rotation 双档（:68619-68626）：ai[0]==2（俯冲态）→ 速度角折叠
      //    ToRotation（vx<0 再 +π,原版 num53 折叠式）;余态 → vx×0.1（俯仰档）。
      //    AI_108 层 :66120 rotation=ToRotation + :66282-66290 折叠 ±π/2 与
      //    :66279 sdir=−sign(vx) 每拍被本 FindFrame 层覆写（原版 FindFrame 在 AI
      //    后 :91626）——本仓 AI 层两写点原样保留（撞墙反弹/俯冲逻辑域）,显示面
      //    独立 ffSdir/visAngle（BJ588 两字段判例）。修前显示面=facing 通用门
      //    （AI 写 facing=−sign(vx)）→ flip⟺vx<0 = 反极性（原版 flip⟺sdir==1
      //    ⟺vx>0）;旋转恒 AI 速度角 = 常态俯仰档缺失。
      //  · 帧档（ai[0]==2 → 帧 4 定格/余 6t×4 帧循环,:68627-68643）不在本层
      //    （帧机=Renderer vanillaFrameIdx 域,帧 4 定格支缺=登记债,见 C12 报告）。
      if (this.vx > 0) this.ffSdir = 1;
      else if (this.vx < 0) this.ffSdir = -1;
      if (this.ai0 === 2) this.visAngle = Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0);
      else this.visAngle = this.vx * 0.1;
    } else if (vid === 612 || vid === 613) {
      // ★C12/R11-F3 水黾 FindFrame case 612/613（:70578-70580）：sdir=Math.Sign(vx)
      // 【vx≠0 门死区档——Math.Sign(0)=0 由门挡】→ ffSdir;零 rotation 写点
      // （aiStyle116 原版不旋转,AI_116 亲读无 sdir/rotation 写面=显示面唯一来源）。
      if (this.vx !== 0) this.ffSdir = this.vx > 0 ? 1 : -1;
    } else if (vid === 423) {
      // ★C12/R11-F3 进化兽 FindFrame case 423（:71342-71344）：sdir=Math.Sign(−vx)
      // 【反极性死区档,vx≠0 门】→ ffSdir=−sign(vx);镜像门 ==1 翻 → flip⟺vx<0 =
      // 原版同相。零 rotation 写点。（R11 U2 复核：亲读 case 423 块 :71320-71355,
      // 反极性形与 sdir 写点确认无误,非邻域 419/425-429 误配。）
      if (this.vx !== 0) this.ffSdir = this.vx > 0 ? -1 : 1;
    } else if (FF_VXSDIR_GROUP.has(vid)) {
      // ★BJ588 FindFrame case 48..664 死区档 15 型族（NPC.cs:75620-75681;1456
      //  :75522-75577 同构零漂移——BJ581 案组收编）。本层 ≙ 原版 FindFrame 每
      //  update AI 后一调（:91626）：
      //  · spriteDirection = sign(vx)【死区档】（:75648-75655 if/if——vx==0 不写
      //    保前值,字段缺省 -1 ≙ Entity 缺省 :6522）→ ffSdir。蝙蝠/幽灵族 facing
      //    =AI direction 双责（batAI 撞墙反弹/失靶滑行、ghostAI 探针列）,不可代位;
      //    蜂 210/211 此前全仓零写点+渲染走通用 facing 门（缺省 1）=恒镜像面（债本体）。
      //  · rotation = vx×0.1（:75656）;蜂 210/211 覆写 ×0.2（:75657-75660——渲染端
      //    aiStyle5 支 rotate(e.vx*0.2) 同值消费, Bee rotation 债销案）。
      //  · 帧节拍（num296=6/Harpy 48=5/49|51|60|634 末帧跳过/蜂 frameCounter 双加
      //    :75657-75660+:75661,推进门 :75663-75671）在 Renderer 帧引擎 BAT_SKIP_LAST
      //    档,不在本层。664 火把神原版本体无生成路径（事件=弹幕 949,664 仅图鉴记账
      //    Player.cs:37109-37116）——本支为其三件套完备性预置（rotation-ledger 台账④）。
      //  · ★BJ589 组内尘收编（原版 FindFrame 组内发尘=每 tick 一拍——:91626
      //    FindFrame 在 Update AI/碰撞后、UpdateTrails 前跑,本层同拍同位次:尘在
      //    sdir/rotation 写点【前】,同 tick 内两平面不互观,序仅按原文保持）：
      //    60 地狱蝠尘 6 每 tick（:75636-75640 speed=v×0.2/α100/scale2/noGravity）；
      //    634 孢子蝠尘 165 1/10 掷（:75641-75646 speed=v 生成、随后 ×0.1、α50/
      //    缺省 scale/noGravity）。game 缺省（BJ588 直驱桩/傀儡早退）=静默跳过,
      //    尘面 spawnDust 桩缺省同契约。
      //  · ★BJ590 组内尘扩面（case 150..226 组 :75582-75619,五型中仅两型带尘,
      //    152/158/226 纯帧档零尘面）：151 熔岩蝠尘 6 每 tick（:75587-75591
      //    speed=v×0.2/α100/scale2/noGravity）;150 冰蝠尘 67 1/10 掷（:75592-75599
      //    speed=v×0.5 生成、随后 ×0.2、α90/scale1.5/noGravity+noLight——150 尘
      //    noLight 为该组独有参,光照面不再自发光）。位次同 60/634:尘在 sdir 写点前。
      if (game) {
        if (vid === 60) {
          const d60 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
            this.vx * 0.2, this.vy * 0.2, 100, null, 2);
          if (d60) d60.noGravity = true;
        } else if (vid === 634 && Math.floor(Math.random() * 10) === 0) {
          const d634 = game.spawnDust?.(this.x, this.y, this.w, this.h, 165,
            this.vx, this.vy, 50, null, 1);
          if (d634) { d634.vx *= 0.1; d634.vy *= 0.1; d634.noGravity = true; }
        } else if (vid === 151) {
          const d151 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
            this.vx * 0.2, this.vy * 0.2, 100, null, 2);
          if (d151) d151.noGravity = true;
        } else if (vid === 150 && Math.floor(Math.random() * 10) === 0) {
          const d150 = game.spawnDust?.(this.x, this.y, this.w, this.h, 67,
            this.vx * 0.5, this.vy * 0.5, 90, null, 1.5);
          if (d150) { d150.noGravity = true; d150.vx *= 0.2; d150.vy *= 0.2; d150.noLight = true; }
        }
      }
      if (this.vx > 0) this.ffSdir = 1;
      else if (this.vx < 0) this.ffSdir = -1;
      this.visAngle = this.vx * 0.1;
      if (vid === 210 || vid === 211) this.visAngle = this.vx * 0.2;
    }
  }

  /** ★BJ591 FindFrame case 574/575（DD2 小妖魔滑翔怪 574/575,1457 NPC.cs:68658-68751）
   *  帧档+尘面。574 与 575 共用同一 case 块（:68658-68659 case 574: case 575:）——
   *  FindFrame 域两型零差异（差异全在 AI_108 参数档,flyerParams 已 1:1）。
   *  帧=帧高/10 帧表（vanilla-npcs.json frames=10）:
   *  · ai0!=0（滑翔/瞄准/俯冲/回旋/自爆全部非 0 态）:帧钳 ≥2（进态清 frameCounter
   *    :68677-68681）;推进延迟 = 帧<5 为 4t、≥5 为 8t（:68682-68686 读【推进前】帧号）;
   *    钳 9（:68688 frame.Y<num*9 门）。**落到帧 9 的那拍**喷 8× 尘 6（火把火舌,
   *    VanillaDust 精植在档）于口部 vector4=Center+(56·sdir,−30).RotatedBy(rotation)
   *    （:68687）——NewDustDirect(α100) 后 velocity×3/scale 0.6/fadeIn 1.2/noGravity/
   *    noLight（:68694-68703）。rotation 用 AI 直写的原始速度角 atan2(vy,vx)（原版
   *    FindFrame 读到的 npc.rotation 即 AI_108 :66120 直写值,AngleTowards 微推
   *    ≤0.02rad 不可辨;sdir=−facing ≙ sign(vx) 死区档,facing 本身即 AI 每 tick
   *    按速度写的显示面闩）。
   *  · 帧 9 钳住后 frameCounter 不再被推进支重置（推进门 frame.Y<num*9 恒假,
   *    ++ 仍在条件位执行）→ 无界增长,拖尾密度阶梯 maxValue 5→4(>60)→3(>180)→
   *    2(>300)→1(>600)（:68712-68728,严格大于）。拖尾门 = 帧≥9 且 ai0<3
   *    （:68706——ai0==3 自爆/4 回旋不喷）;每拍 2 掷（n=0,1）,1/maxValue 中出
   *    1 粒尘 6 @Lerp(value2,value,n/10+0.1)——value2=vector4+(oldPos[3]−position)
   *    （:68710-68711,TrailingMode 7 逐拍后移 ≙ 本仓 histAt(3),recordTrailHistory
   *    在 findFrameRotation 后一拍=原版 :91626→:91627 同序）;α50/scale 0.3/
   *    fadeIn 1.5/noGravity+noLight（:68733-68737）。
   *  · ai0==0 落地:++frameCounter≥6 → 帧推进 0↔1 乒乓（:68741-68749）。 */
  private koboldFlyerFindFrame(game?: GameHooks): void {
    if (this.ai0 !== 0) {
      if (this.koboldFrameY < 2) { this.koboldFrameY = 2; this.koboldFC = 0; }
      const delay = this.koboldFrameY >= 5 ? 8 : 4;      // :68682-68686（推进前帧号定档）
      // 口部锚 vector4 = Center + (56*sdir, -30).RotatedBy(rotation)（:68687）
      const sdir = this.ffSdir;                           // ★C12/R11-F2 单源对齐：FindFrame 层
      //  sdir=sign(vx) 死区档（:68661-68668,本支 :68663-68668 写→:68687 消费同序,
      //  本仓 findFrameRotation 内 ffSdir 写先于本调用同拍同值;旧式 −facing 全链
      //  等值〔AI 每 tick facing=−sign(vx)〕但语义两面脱钩,随单源收编）
      const rot = Math.atan2(this.vy, this.vx);           // ≙ npc.rotation（AI :66120 直写值）
      const mx = 56 * sdir, my = -30;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const mouthX = this.cx + mx * cosR - my * sinR;
      const mouthY = this.cy + mx * sinR + my * cosR;
      this.koboldFC++;
      if (this.koboldFC >= delay && this.koboldFrameY < 9) {
        this.koboldFC = 0;
        this.koboldFrameY++;
        if (this.koboldFrameY === 9 && game) {
          // :68692-68704 落帧 9 一次性 8× 火舌（推进支内——每轮滑翔恰一拍）
          for (let m = 0; m < 8; m++) {
            const d = game.spawnDust?.(mouthX, mouthY, 0, 0, 6, 0, 0, 100, null, 1);
            if (d) {
              d.vx *= 3; d.vy *= 3;                       // :68698 velocity *= 3f
              d.scale = 0.6;                              // :68699
              d.fadeIn = 1.2;                             // :68700
              d.noGravity = true;                         // :68701
              d.noLight = true;                           // :68702
            }
          }
        }
      }
      if (this.koboldFrameY >= 9 && this.ai0 < 3 && game) {
        // :68706-68739 帧钳住后的拖尾面
        const ox = this.histXAt(3) - this.x;              // oldPos[3] − position（:68711）
        const oy = this.histYAt(3) - this.y;
        let maxValue = 5;
        if (this.koboldFC > 60) maxValue = 4;             // :68713-68715
        if (this.koboldFC > 180) maxValue = 3;            // :68717-68719
        if (this.koboldFC > 300) maxValue = 2;            // :68721-68723
        if (this.koboldFC > 600) maxValue = 1;            // :68725-68727
        for (let n = 0; n < 2; n++) {
          if (Math.floor(Math.random() * maxValue) === 0) {
            const l = n / 10 + 0.1;
            const d = game.spawnDust?.(mouthX + ox * (1 - l), mouthY + oy * (1 - l),
              0, 0, 6, 0, 0, 50, null, 1);
            if (d) {
              d.scale = 0.3;                              // :68734
              d.fadeIn = 1.5;                             // :68735
              d.noGravity = true;                         // :68736
              d.noLight = true;                           // :68737
            }
          }
        }
      }
      this.customFrameIdx = this.koboldFrameY;
    } else {
      this.koboldFC++;                                    // :68741
      if (this.koboldFC >= 6) {
        this.koboldFC = 0;
        this.koboldFrameY++;                              // :68743（先推进）
        if (this.koboldFrameY >= 2) this.koboldFrameY = 0;  // :68745-68748（再钳——1→2→钳 0,周期 0↔1）
      }
      this.customFrameIdx = this.koboldFrameY;
    }
  }

  /** ★BJ706-A DD2 walker 族帧机（FindFrame 专属 case 逐字,NPC.cs:67793-68608）——
   *  AI_107 竖条帧条族 552-557/561-563/566-573（576/577 食人魔=网格路径 drawDd2OgreGrid、
   *  620 地精鲨=通用 fighter 档,均不入）。单计数器 dd2WalkFC ≙ frameCounter 跨相位
   *  携带（攻击 ++ 推进/行走 += |vx| wrap 64|56/腾空·逆行·站定清零）;输出
   *  customFrameIdx（vanillaFrameIdx 顶部直读,不再走通用 fighter 档）。
   *  逆行门 = vy!=0 || (facing 与 vx 反号)（原版 direction 与 velocity.X 反号,
   *  cs:68244/68286/68310 等）→ 各族腾空帧;帧表（帧行,walkWrap/步长 8px·|vx|）:
   *  · 552-554 哥布林（:68222-68262）:攻(ai0>0)10-13@6t[ai1==29 复位]/腾 8/站 9/走 0-7·64
   *  · 555-557 投弹手（:68568-68608）:攻(ai1>0&&ai0>0)10-16@6t[41]/腾 1/站 0/走 2-9·64
   *  · 561-563 标枪手（:68527-68567）:攻同上 10-13@6t[89]/腾 8/站 9/走 0-7·64
   *  · 566/567 骷髅（:68329-68353）:无攻/腾 8/站 0/走 0-7·64
   *  · 568/569 枯萎兽（:67793-68025）:攻(ai0>0)梯 7+(fc/5%4)×5 轮→8..14 钳持,
   *    fc>=270 持 14[带外 5-16 复位]/腾 4/站 6/走 0-6·56
   *  · 570/571 德拉肯（:68482-68526）:攻(ai1>0&&ai0>0)10-15@5t[14 持 35t,59]/腾 1/站 9/走 2-9·64
   *  · 572/573 小妖精地面型（:68263-68328）:点火(ai0>0&&ai1==0)恒 8;冲锋(ai1==1)
   *    腾 17/站 8/走 8-15·64;常态 腾 16/站 0/走 0-7·64
   *  [aiN]==N 复位 = 攻击循环里 ai[1] 递减至该值当拍重排帧行（各族字面量）。
   *  未实装（登记债）:①572/573 点火带 EmoteBubble(3) 一闪（:68273-68277,本仓
   *  敌怪 emote 面未建）;②spriteDirection=direction 仅 vy==0/攻击态写（腾空保
   *  前值,:68240 等）——本仓显示镜像走 AI facing 恒随重瞄,腾空瞬态极性差（低暴露）。 */
  private dd2WalkerFindFrame(): void {
    const id = this.vanillaId ?? 0;
    // 逆行/腾空门（原版 vy!=0 || (direction==-1&&vx>0)||(direction==1&&vx<0)）
    const backslide = this.vy !== 0
      || (this.facing === -1 && this.vx > 0) || (this.facing === 1 && this.vx < 0);
    let f = this.dd2WalkFrame;
    let fc = this.dd2WalkFC;
    const walk = (wrap: number, base: number): void => {
      fc += Math.abs(this.vx);
      if (fc >= wrap || fc < 0) fc = 0;              // 原版 frameCounter wrap（64/56）
      f = Math.floor(fc / 8) + base;
    };
    if (id >= 552 && id <= 557) {
      if (id <= 554) {                               // 哥布林（:68222-68262）
        if (this.ai0 > 0) {
          if (f < 10 || f > 13 || this.ai1 === 29) { f = 10; fc = 0; }
          if (++fc >= 6 && f < 13) { fc = 0; f++; }
        } else if (backslide) { fc = 0; f = 8; }
        else if (this.vx === 0) { fc = 0; f = 9; }
        else walk(64, 0);
      } else {                                       // 投弹手（:68568-68608）
        if (this.ai1 > 0 && this.ai0 > 0) {
          if (f < 10 || f > 16 || this.ai1 === 41) { f = 10; fc = 0; }
          if (++fc >= 6 && f < 16) { fc = 0; f++; }
        } else if (backslide) { fc = 0; f = 1; }
        else if (this.vx === 0) { fc = 0; f = 0; }
        else walk(64, 2);
      }
    } else if (id >= 561 && id <= 563) {             // 标枪手（:68527-68567）
      if (this.ai1 > 0 && this.ai0 > 0) {
        if (f < 10 || f > 13 || this.ai1 === 89) { f = 10; fc = 0; }
        if (++fc >= 6 && f < 13) { fc = 0; f++; }
      } else if (backslide) { fc = 0; f = 8; }
      else if (this.vx === 0) { fc = 0; f = 9; }
      else walk(64, 0);
    } else if (id === 566 || id === 567) {           // 骷髅（:68329-68353）
      if (backslide) { fc = 0; f = 8; }
      else if (this.vx === 0) { fc = 0; f = 0; }
      else walk(64, 0);
    } else if (id === 568 || id === 569) {           // 枯萎兽（:67793-68025）
      if (this.ai0 > 0) {
        if (f < 5 || f > 16) fc = 0;                 // 带外复位（:67799-67802,fc 清零）
        fc++;
        const q = Math.floor(fc / 5);                // 反编译梯（5t/档）:7,8,9,10×5 轮→8..14
        f = q < 20 ? 7 + (q % 4) : Math.min(14, 8 + (q - 20));
        if (fc >= 270) { f = 14; fc -= 10; }         // :67995-67999 终态持 14
      } else if (backslide) { fc = 0; f = 4; }
      else if (this.vx === 0) { fc = 0; f = 6; }
      else walk(56, 0);                              // 56 wrap = 7 帧行走带 0-6
    } else if (id === 570 || id === 571) {           // 德拉肯（:68482-68526）
      if (this.ai1 > 0 && this.ai0 > 0) {
        if (f < 10 || f > 15 || this.ai1 === 59) { f = 10; fc = 0; }
        const hold = f === 14 ? 35 : 5;              // 帧 14 长持（:68492-68496）
        if (++fc >= hold && f < 15) { fc = 0; f++; }
      } else if (backslide) { fc = 0; f = 1; }
      else if (this.vx === 0) { fc = 0; f = 9; }
      else walk(64, 2);
    } else if (id === 572 || id === 573) {           // 小妖精地面型（:68263-68328）
      if (this.ai0 > 0 && this.ai1 === 0) {
        if (f !== 8 || fc > 2) { f = 8; fc = 0; }    // 点火帧行恒 8（emote 债见组注）
      } else if (this.ai1 === 1) {                   // 冲锋态
        if (backslide) { fc = 0; f = 17; }
        else if (this.vx === 0) { fc = 0; f = 8; }
        else walk(64, 8);
      } else {
        if (backslide) { fc = 0; f = 16; }
        else if (this.vx === 0) { fc = 0; f = 0; }
        else walk(64, 0);
      }
    } else {
      return;                                        // 非 DD2 walker（防御门,不应到达）
    }
    this.dd2WalkFrame = f;
    this.dd2WalkFC = fc;
    this.customFrameIdx = f;
  }

  /** 环境声三表（UpdateNPC IdleSounds :91184-91246 + AI_003 闲话 :57914-57945 +
   *  CritterSounds :93365-93468,数据在 data/vanillaNpcAmbience.ts）。
   *  每 tick 每 NPC 至多一次掷骰（原版各表独立掷,同帧双中概率≈0 取先闲话后 idle）。
   *  playSfxWav = GameHooks→Sfx.playWavFile 直 wav（FILE_CASE_VOL 带 Zombie_24-87
   *  ×0.5 等档,零新增 SfxName）。 */
  private ambientSoundTick(game: GameHooks): void {
    const id = this.vanillaId;
    if (id == null || this.dead) return;
    const world = game.world;
    const clock = world.clock;
    const st = world.store;
    // 小动物声（:93365-93468）——门控族(day/night/dawn/still);微光浸入即静默
    const cs = CRITTER_SOUNDS[id];
    if (cs) {
      if (this.shimmerT > 0) return;
      let ok = true;
      if (cs.gate === 'day') ok = clock.isDay;
      else if (cs.gate === 'night') ok = !clock.isDay;
      else if (cs.gate === 'dawn') ok = clock.isDay && clock.timeOfDay < Clock.DAWN + (Clock.DUSK - Clock.DAWN) / 3;  // Main.time<18000(清晨 1/3)
      else if (cs.gate === 'still') ok = Math.abs(this.vx) < 0.5
        && (!clock.isDay || this.y > world.groundLevel * 16);
      if (ok && Math.floor(Math.random() * cs.denom) === 0) {
        // 稀有变体先掷（联合概率 = 主掷命中 × rare 掷命中,原版两层掷在 LSP case 内
        // 串联:鸭 case30 :1105-1126 Next(300)==0 换 Zombie_12 / 枭 case46 :1074-1093
        // Next(300)==0 三均分 {112,113,114}）——命中即独占本次发声跳过常规池
        // （★BJ291：鸭稀有支 Zombie_12 的"独占忙检"已由 Sfx.SINGLE_INSTANCE 逐文件
        //   槽承接=在播跳过,:1110-1114 原文语义;枭稀有支 {112,113,114} 原文本就无忙检）
        if (cs.rare && Math.floor(Math.random() * cs.rare.denom) === 0) {
          game.playSfxWav?.(cs.rare.files[Math.floor(Math.random() * cs.rare.files.length)], 1, this.cx, this.cy);
        } else {
          const f = cs.pool ? cs.pool[Math.floor(Math.random() * cs.pool.length)] : cs.file;
          game.playSfxWav?.(f, 1, this.cx, this.cy);
        }
      }
      return;   // 原版 critter 段互斥(else-if 链)
    }
    // AI_003 闲话（:57913-57945）——位于 `if (ai[3] < num58 && NotDiscouraged(...))`
    // 窗内：卡死计数未满 + DespawnEncouragement_AIStyle3_Fighters_NotDiscouraged
    // （2026-08-31 C 批：despawnEncouraged 旗主门近似 → 完整表 fighterNotDiscouraged）
    // ★微光门分档修正：旧实现全局 `shimmerT>0 早退`,把闲话门一并收窄——原版闲话门 =
    //   `shimmerTransparency < 1f`（:57916,仅全饱和静默）;shimmerT≈transparency×100 →
    //   本仓 shimmerT≥100 才哑,渐入期(0..100)照常呻吟。IdleSounds 是另一档门
    //   (!transparency>0 即浸入即静默,:91185),保持 ==0 门不动。
    if (this.vanilla?.aiStyle === 3 && !(this.shimmerT >= 100)
      && this.ai3 < (id === 120 ? 180 : 60)
      && fighterNotDiscouraged(game, this)) {
      // 值可数组 = 同 tick 多路【独立掷】（原版 AI_003 尾段多条 if 各自 Main.rand.Next,
      // 同帧双中都各播一次——弗兰肯 162 双源 :57918+:57930,F2 2026-08-26）
      const rawCh = CHATTER_SOUNDS[id];
      const specs = Array.isArray(rawCh) ? rawCh : rawCh ? [rawCh] : [];
      let chatterPlayed = false;
      for (const ch of specs) {
        if (Math.floor(Math.random() * ch.denom) === 0) {
          const f = ch.pool ? ch.pool[Math.floor(Math.random() * ch.pool.length)] : ch.file;
          game.playSfxWav?.(f, 1, this.cx, this.cy);
          chatterPlayed = true;
        }
      }
      if (chatterPlayed) return;
    }
    // IdleSounds（:91184-91246,门 !shimmerTransparency>0 = 浸入即静默——shimmerT>0 即哑,
    // 与闲话的 <1f 宽门分档;旧实现靠函数头全局早退承担,拆门后在此显式承接）
    const is = IDLE_SOUNDS[id];
    if (is && !(this.shimmerT > 0)) {
      if (is.gate === 'wet') {
        const ti = st.idx(Math.floor(this.cx / 16), Math.floor(this.cy / 16));
        if (st.liquid[ti] <= 0) return;
      }
      if (Math.floor(Math.random() * is.denom) === 0) {
        const n = is.range[0] + Math.floor(Math.random() * (is.range[1] - is.range[0]));
        game.playSfxWav?.(`Zombie_${n}`, 1, this.cx, this.cy);
      }
    }
  }

  /** NPC.AnyNPCs（NPC.cs:6611-6630 子集）：场上是否存在指定 vanilla id 的存活段
   *  ——DoesntDespawnToInactivity 条件豁免（139 依赖 134 / 552-578 依赖 548）用 */
  private anyNpcAlive(game: GameHooks, id: number): boolean {
    return (game.enemies() as Enemy[]).some((e) => !e.dead && e.vanillaId === id);
  }

  /** CanAnyPlayerSeeThisTile（1457/1458 NPC.cs:43877-43890 同锚）：以世界点为中心、
   *  边长 = sWidth/sHeight+32 的屏盒与任一【活跃】玩家命中盒求交。
   *  原版只查 active 不查 dead——本仓 candidates 表含远端代理照算。
   *  ★MINOR-6（2026-09-02 画布无关化）：sWidth/sHeight = 原版常量 1920×1200
   *  （NPC.cs:6791-6793;消费点 :43879-43880 num=32 → 半幅 960+16/600+16）。
   *  旧 GameHooks.screenWorldSize（真实视口,随窗口/缩放变化）会让可见域随设备
   *  漂移且与 CheckActive 屏幕盒（960+w/600+h 常量）不同源——两处统一回常量 */
  private canAnyPlayerSeeThisTile(game: GameHooks, wx: number, wy: number): boolean {
    const hw = 960 + 16, hh = 600 + 16;   // sWidth/2 + num/2, sHeight/2 + num/2（num=32）
    const cands = game.candidatePlayers?.() ?? [game.player];
    return cands.some((q) => !!q && Math.abs(q.cx - wx) < hw + q.w / 2
      && Math.abs(q.cy - wy) < hh + q.h / 2);
  }

  /** 原版 EncourageDespawn(despawnTime)（NPC.cs:7276-7283）：timeLeft 封顶 + 置鼓励旗 */
  encourageDespawn(despawnTime: number): void {
    // ★封顶语义(2026-09-01 定罪):原版 EncourageDespawn(d) = min(timeLeft,d) 封顶赋值
    //  + despawnEncouraged=true,它本身不杀怪——真正的快速消散由 CheckActive 屏外窗口
    //  完成:屏内每 tick 被重置到 750 抵挡(AI 每 tick 重新钉 10),一旦离屏 reset 停止,
    //  剩余 timer≈最后封顶值(常为 10t)→ 约 10 帧内消失。屏内永远有重置保护。
    //  (曾两次误译:①despawnTimer=d 屏内也倒数=日出原地蒸发;②−=d 减法同为杜撰)
    if (this.despawnTimer > despawnTime) this.despawnTimer = despawnTime;
    this.despawnEncouraged = true;
  }

  /** 原版 DiscourageDespawn(despawnTime)（NPC.cs:7285-7292）：timeLeft 抬底（不封顶）
   *  + 清鼓励旗——EncourageDespawn 的反操作。消费面=火星飞碟挂载部件 390/416/392/
   *  393/394/492（aiStyle 75 锚定链 :35857/:35874/:35884/:35960/:35974/:35989 每 tick
   *  重钉 ≥60）：锚主存活期间部件 despawnTimer 恒 ≥60,白天 EncourageDespawn 置位
   *  也被此清回;锚主亡故（mountOk 假）不再调用 → 部件随消散系统退场。
   *  其中 392/393/394/492 本身在 DoesntDespawnToInactivity 名单（永不倒数）,
   *  调用为保真;实际功能面=390 骑手/416 骑手（不在名单,离屏 60t 保命窗） */
  discourageDespawn(despawnTime: number): void {
    if (this.despawnTimer < despawnTime) this.despawnTimer = despawnTime;
    this.despawnEncouraged = false;
  }

  /** 敌怪弹幕发射辅助：从 (ox,oy) 朝 (tx,ty) 偏移方向以 speed 定速发射敌对 Dart；
   *  projId = 原版弹型（Dart.ts DART_STYLE 表,贴图/旋转/重力/加速 1:1） */
  private shootDart(game: GameHooks, ox: number, oy: number, tx: number, ty: number, speed: number, dmg: number, projId = 0): void {
    const d = Math.hypot(tx, ty) || 1;
    const dart = new Dart(ox, oy, (tx / d) * speed, (ty / d) * speed, dmg, projId);
    dart.hostile = true; // 敌怪发射弹（原版 Projectile.hostile）——联机 v5 随 msg27 bit7 下发
    (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities
      .add(dart, 'projectiles');
  }

  /** 敌怪弹幕发射辅助（原始速度向量版）：Nailhead 463 散射（NPC.cs:57611）等
   *  "速度向量已定"的发射点——shootDart 会把 (tx,ty) 归一到 speed，不适用此处。
   *  projId = 原版弹型（Dart.ts DART_STYLE 表）。
   *  ownerId = 弹-NPC 绑定通道（原版 NewProjectile 末参 whoAmI 落 ai[1] 槽）：
   *  仅 411→537 / 424→573 消费（Projectile.cs :30308/:32087 起），其余发射点不传 */
  spawnHostileProj(game: GameHooks, x: number, y: number, vx: number, vy: number, dmg: number, projId = 0, ownerId = 0): void {
    const dart = new Dart(x, y, vx, vy, dmg, projId);
    dart.hostile = true;
    dart.ownerNpcId = ownerId;
    (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities
      .add(dart, 'projectiles');
  }

  /** 原版共享位移段 1:1（NPC.cs:91533-91547 + UpdateCollision :93723-93810）：
   *  AI 写速度 → 重力（:91533 velocity.Y += gravity + 落速帽）→ TileCollision
   *  + position += velocity（:93808）。**无速度钳、无尾段摩擦**——一切摩擦/加速/
   *  帽均属各 AI 自管（AI_001 :61948 地面 ×0.8 / :61930-62137 滞空转向；AI_003
   *  num 段逐族自带）。原 ±maxSpd 逐 tick 硬钳 + onGround×0.8 / 空中×0.98 尾段
   *  摩擦（仓内早期 walker 地基约定）2026-08-19 G1 批废除——硬钳曾把史莱姆跳冲量
   *  （±2/±3/659×1.2）逐 tick 砍到 ±1（原版无此钳，跳冲量完整保留到摩擦段），
   *  尾段摩擦亦为本仓自创（原版空中无摩擦）。
   *  注：水中位移减速由 npcLiquid→liqFactor 在 moveAndCollide 内统一承担（原版
   *  Collision_MoveWhileWet），浮力族（史莱姆）的弹跳漂浮在 slimeAI 的 wet 段（cs:61877）。
   *  ★preCollideVy/collideY 快照（原版 oldVelocity/collideY :93739/:93804——下一 tick
   *  AI 直读）：AI_001 携物梯 :61309 气球弹跳 / :61932/:62124 落地嵌固回退消费。 */
  private groundPhysics(game: GameHooks) {
    this.applyGravity(game);
    const preVy = this.vy;      // oldVelocity（:93739 AI 后、碰撞前快照）
    moveAndCollide(this, game.world, this.vx, this.vy);
    this.preCollideVy = preVy;
  }

  /** NPCID.Sets.SlimeCanContainItems（NPCID.cs:4791）：可携带体内物品的史莱姆族 */
  private static readonly SLIME_CAN_CONTAIN_ITEMS = new Set([1, 59, 147, 184, 537]);

  /** AI_001_Slimes_GenerateItemInsideBody（NPC.cs:62150-62258）1:1：num=Next(4) 四桶；
   *  isBallooned（风气球 ai[0]==-999，:62154）→ 13 桶风筝/纸飞机。
   *  WorldGen.Skyblock.lowTiles 三处修正（:62156-62164 / :62199-62207 / :62230-62237）
   *  依赖天空盒世界——本仓无天空盒世界（NpcDrops evalCond 'SkyblockIsUp' 同判恒
   *  false）→ 跳过。case 0 default 的 netMode!=0 分支（多人 2997 虫洞药水）单人
   *  不可达——1458 行号勘误：:62408-62413（终零波 M 域复核,语义维持 MP-only 不动） */
  private slimeGenItemInsideBody(isBallooned: boolean): number {
    const roll = (n: number) => Math.floor(Math.random() * n);              // Next(n)
    const rollR = (a: number, b: number) => a + Math.floor(Math.random() * (b - a)); // Next(a,b) 含a不含b
    let num = roll(4);
    if (isBallooned) {
      switch (roll(13)) {                                                     // :62166-62191 风筝桶
        case 1: return 4368; case 2: return 4369; case 3: return 4370; case 4: return 4371;
        case 5: return 4612; case 6: return 4674;
        case 7: case 8: case 9: return 4343;
        case 10: case 11: case 12: return 4344;
        default: return 4367;
      }
    }
    switch (num) {
      case 0:                                                                // 药水桶 :62193
        switch (roll(7)) {
          case 0: return 290;            // 迅捷
          case 1: return 292;            // 铁皮
          case 2: return 296;            // 光标
          case 3: return 2322;           // 挖矿
          default: return 2350;          // 回忆（2997 虫洞仅多人,:62408-62413 netMode!=0）
        }
      case 1:                                                                // 火把/炸弹桶 :62196
        num = roll(4);
        return num === 0 ? 8 : num === 1 ? 965 : num === 2 ? 166 : 58;        // 火把/荧光棒/炸弹/红心
      case 2: {                                                              // 矿物桶 :62222
        if (roll(2) === 0) return rollR(11, 15);   // 11-14 铜/铁/银/金矿
        return rollR(699, 703);                    // 699-702 同序锭
      }
      default:                                                                // 钱币桶 :62239
        num = roll(3);
        return num === 0 ? 71 : num === 1 ? 72 : 73;   // 铜/银/金币（堆叠档在掉落侧）
    }
  }

  /** IIII225：StatusFromNPC 携物史莱姆支（Player.cs:22559-22640 1:1）——携物史莱姆
   *  （SlimeCanContainItems ∧ ai[1]>0）接触命中玩家时按体内物品授状态。
   *  消费点=Update_NPCCollision 接触支（:31663 `Hurt>0 && !dead && !flag2`）。
   *  梯序与 cs else-if 链同序；时长 tick→s（÷60 取整）。 */
  /** 返回值 = 原版矿石支 `return`（:22581）——命中时整段 StatusFromNPC 终止,
   *  后续 type 臂不再执行（IIIII228 全表接线沿用该语义） */
  private slimeCarryContactStatus(game: GameHooks, player: Player): boolean {
    const a1 = this.ai1;
    if (!(this.vanillaId !== null && Enemy.SLIME_CAN_CONTAIN_ITEMS.has(this.vanillaId) && a1 > 0)) return false;
    const buffs = player.buffs;
    if (!buffs) return false;
    const sf = game.world.seedFlags;
    const expert = mainExpertMode(game.world);
    const t = (ticks: number) => Math.max(1, Math.round(ticks / 60));
    const R = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1)); // Next(lo,hi+1)
    const ore = a1 === 364 || a1 === 1104 || a1 === 365 || a1 === 1105 || a1 === 366 || a1 === 1106;
    if (ore) {
      // :22561-22581：rand(7) 重映射 {0→31,1→35,2→23,3→32,4→80,5→33,6→36},时长 60-300t
      const pool = [BuffType.Confused, BuffType.Silenced, BuffType.Cursed, BuffType.Slow,
        BuffType.Blackout, BuffType.Weak, BuffType.BrokenArmor];
      buffs.apply(pool[Math.floor(Math.random() * 7)], t(R(60, 300)));
      return true;                                   // :22581 return
    } else if (a1 === 3) {
      buffs.apply(BuffType.Stoned, t(R(30, 59)));                          // :22583-22585
    } else if (a1 === 150) {
      buffs.apply(BuffType.Webbed, t(R(30, 59)));                          // :22587-22589
    } else if (a1 === 147) {
      buffs.apply(BuffType.Bleeding, t(R(600, 1199)));                     // :22591-22593
    } else if (a1 === 8 && !!sf?.getGoodWorld) {
      buffs.apply(BuffType.WellFed, t(R(180, 299)));                       // :22595-22597 FTW 火把史莱姆
    } else if (a1 === 5395) {
      let num4 = R(300, 599);                                              // :22599-22606
      buffs.apply(BuffType.Stinky, t(num4));
      if (expert) num4 = Math.trunc(num4 / 2);
      buffs.apply(BuffType.Poisoned, t(num4));
    } else if (a1 === 174) {
      buffs.apply(BuffType.Burning, t(R(60, 179)));                        // :22607-22609
    } else if (a1 === 1103 || a1 === 593) {
      buffs.apply(BuffType.Frostburn, t(R(180, 359)));                     // :22611-22617
    } else if (a1 === 3347) {
      buffs.apply(BuffType.Cursed, t(R(60, 299)));                         // :22619-22621
    }
    return false;
  }

  /** ★IIIII228 StatusFromNPC 全表 type 臂（Player.cs:22513-22545 脑臂 + :22642-22771
   *  type 表,1:1 梯序与掷序）。原版各臂为独立 if（命中类型即掷,可多项叠加）;
   *  专家档脑臂在表前。371 潮湿臂（:22639-22643）已由 Game 受击汇入点承担,此处
   *  不重施（防双掷）。`!frozen` 门 = 玩家无 Frozen(47)（:9749 frozen=true）。
   *  时长 tick→s（÷60）;R(a,b)=vanilla Next(a,b) 含头不含尾。 */
  private statusFromNpcTypeArms(game: GameHooks, player: Player, oreReturned: boolean): void {
    const buffs = player.buffs;
    if (!buffs || oreReturned) return;
    const vid = this.vanillaId;
    if (vid == null) return;
    const expert = mainExpertMode(game.world);
    const t = (ticks: number) => Math.max(1, Math.round(ticks / 60));
    const R = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1)); // Next(lo,hi+1)
    const frozen = buffs.has(BuffType.Frozen);           // Player.frozen（buff 47 专属）
    // ---- 脑臂（:22515-22545）：专家 && (266 1/3 || 267) → Next(9)（2/4 重掷一次）
    //      × Next(75,150)×0.01 系数九选一 debuff ----
    if (expert && ((vid === 266 && Math.floor(Math.random() * 3) === 0) || vid === 267)) {
      let num = Math.floor(Math.random() * 9);
      if (num === 2 || num === 4) num = Math.floor(Math.random() * 9);
      const num2 = R(75, 149) * 0.01;                    // Next(75,150)
      const dur = (mul: number) => t(Math.trunc(60 * num2 * mul));
      switch (num) {
        case 0: buffs.apply(BuffType.Poisoned, dur(3.5)); break;
        case 1: buffs.apply(BuffType.Darkness, dur(2)); break;
        case 2: buffs.apply(BuffType.Cursed, dur(0.5)); break;
        case 3: buffs.apply(BuffType.Bleeding, dur(10)); break;
        case 4: buffs.apply(BuffType.Confused, dur(1)); break;
        case 5: buffs.apply(BuffType.Slow, dur(3.5)); break;
        case 6: buffs.apply(BuffType.Weak, dur(7.5)); break;
        case 7: buffs.apply(BuffType.Silenced, dur(1)); break;
        case 8: buffs.apply(BuffType.BrokenArmor, t(Math.trunc(60 * num2 * 6.5))); break;  // (double)
      }
    }
    if (oreReturned) return;                             // 携物矿石支 return 在脑臂之后（vanilla 序:脑→携物）
    // ---- type 表（:22642-22771）----
    if (vid === 530 || vid === 531) buffs.apply(BuffType.Venom, t(R(240, 240)));    // Next(240,241)=240 恒
    if (vid === 159 || vid === 158) buffs.apply(BuffType.Bleeding, t(R(600, 1199)));
    if (vid === 525) buffs.apply(BuffType.CursedInferno, t(240));
    if (vid === 526) buffs.apply(BuffType.Ichor, t(420));
    if (vid === 527) buffs.apply(BuffType.Confused, t(840));
    if (expert && (vid === 49 || vid === 93 || vid === 51 || vid === 152 || vid === 634)
      && Math.floor(Math.random() * 10) === 0) buffs.apply(BuffType.Rabies, t(R(1800, 5399)));
    if (expert && vid === 222) buffs.apply(BuffType.Poisoned, t(R(60, 239)));
    if (expert && (vid === 210 || vid === 211)) buffs.apply(BuffType.Poisoned, t(R(60, 179)));
    if (expert && vid === 35) buffs.apply(BuffType.Bleeding, t(R(360, 599)));
    if (expert && vid === 36 && Math.floor(Math.random() * 2) === 0) buffs.apply(BuffType.Slow, t(R(30, 59)));
    if (vid >= 269 && vid <= 272) {
      if (Math.floor(Math.random() * 3) === 0) buffs.apply(BuffType.Bleeding, t(1200));
      else if (Math.floor(Math.random() * 3) === 0) buffs.apply(BuffType.Slow, t(300));
    }
    if (vid >= 273 && vid <= 276 && Math.floor(Math.random() * 2) === 0) buffs.apply(BuffType.BrokenArmor, t(600));
    if (vid >= 277 && vid <= 280) buffs.apply(BuffType.OnFire, t(600));
    if (vid === 370 && expert) {
      const num5 = [0, BuffType.Rabies, BuffType.Bleeding][Math.floor(Math.random() * 3)];
      if (num5 !== 0) buffs.apply(num5 as BuffType, t(60 * R(6, 20)));   // 60×Next(6,21)
    }
    if (((vid === 1 && this.vanillaNetId === -6) || vid === 81 || vid === 79 || vid === 183 || vid === 630)
      && Math.floor(Math.random() * 4) === 0) buffs.apply(BuffType.Darkness, t(900));
    if ((vid === 23 || vid === 25) && Math.floor(Math.random() * 3) === 0) buffs.apply(BuffType.OnFire, t(420));
    if ((vid === 34 || vid === 83 || vid === 84 || vid === 179 || vid === 289)
      && Math.floor(Math.random() * 3) === 0) buffs.apply(BuffType.Cursed, t(240));
    if ((vid === 104 || vid === 102) && Math.floor(Math.random() * 5) === 0) buffs.apply(BuffType.Bleeding, t(2700));
    if (vid === 75 && Math.floor(Math.random() * 10) === 0) buffs.apply(BuffType.Silenced, t(420));
    if ((vid === 163 || vid === 238 || vid === 236 || vid === 237)
      && Math.floor(Math.random() * 10) === 0) buffs.apply(BuffType.Venom, t(240));
    if ((vid === 79 || vid === 103 || vid === 630) && Math.floor(Math.random() * 5) === 0) buffs.apply(BuffType.Silenced, t(420));
    if ((vid === 75 || vid === 78 || vid === 82) && Math.floor(Math.random() * 8) === 0) buffs.apply(BuffType.Slow, t(900));
    if ((vid === 93 || vid === 109 || vid === 80) && Math.floor(Math.random() * 14) === 0) buffs.apply(BuffType.Confused, t(300));
    if (vid >= 305 && vid <= 314 && Math.floor(Math.random() * 10) === 0) buffs.apply(BuffType.Weak, t(3600));
    if (vid === 77 && Math.floor(Math.random() * 6) === 0) buffs.apply(BuffType.BrokenArmor, t(7200));
    if (vid === 112 && Math.floor(Math.random() * 20) === 0) buffs.apply(BuffType.Weak, t(18000));
    if (vid === 182 && Math.floor(Math.random() * 25) === 0) buffs.apply(BuffType.Weak, t(7200));
    if (vid === 141 && Math.floor(Math.random() * 2) === 0) buffs.apply(BuffType.Poisoned, t(600));
    if (vid === 147 && !frozen && Math.floor(Math.random() * 12) === 0) buffs.apply(BuffType.Chilled, t(600));
    if (vid === 150) {
      if (Math.floor(Math.random() * 2) === 0) buffs.apply(BuffType.Chilled, t(900));
      if (!frozen && Math.floor(Math.random() * 35) === 0) buffs.apply(BuffType.Frozen, t(60));
      else if (!frozen && expert && Math.floor(Math.random() * 35) === 0) buffs.apply(BuffType.Frozen, t(60));
    }
    if (vid === 184) {
      buffs.apply(BuffType.Chilled, t(1200));
      if (!frozen && Math.floor(Math.random() * 15) === 0) buffs.apply(BuffType.Frozen, t(60));
      else if (!frozen && expert && Math.floor(Math.random() * 25) === 0) buffs.apply(BuffType.Frozen, t(60));
    }
  }

  /** AI_001_Slimes 体内物品主掷段（NPC.cs:60750-60960）：首 AI 帧 ai[1]==0 且 value>0
   *  时掷内容物——先置 -1（空）再最多 num2 次机会，任一分支赋正值后即停（:60777-60781）。
   *  netID -5/-4（地牢/丛林彩装变种）整体不掷（:60815 continue），-6 额外 +4 次
   *  （:60769），-10（蜜蜂丛林变种）走 1124/1125/314/5395 特例（:60840），史莱姆雨
   *  +2 次（:60773）。跳过分支（登记）：
   *  - WorldGen.Skyblock.{lowTiles,noHellstone,noFossils,noLifeCrystals} 六处（:60757/
   *    :60806/:60813/:60822/:60827/:60859/:60892）——天空盒世界未实装恒 false
   *  - Item.GetRandomVoiceItem（:60828-60830，天空盒子分支内）——连带跳过
   *  - Main.vampireSeed :60920-60923 已接（sf.vampireSeed——SeedEasterEggs
   *    "what a horrible night to have a curse"） */
  private slimeRollContainedItem(game: GameHooks): void {
    const vid = this.vanillaId;
    if (vid === null || !Enemy.SLIME_CAN_CONTAIN_ITEMS.has(vid)) return;
    if (this.ai1 !== 0) return;                    // 已掷过：-1=空 / >0=物品（只掷一次）
    const netId = this.vanillaNetId !== 0 ? this.vanillaNetId : vid;
    const value = this.spawnedFromStatue ? 0                       // 与死亡掉落链同式（:6258 侧）
      : (netId === vid ? (this.def.value ?? npcValueOf(netId)) : npcValueOf(netId));
    if (value <= 0) return;                        // :60750 value>0 门
    const w = game.world;
    const sf = w.seedFlags;
    this.ai1 = -1;                                 // :60752 先置空
    const roll = (n: number) => Math.floor(Math.random() * n);
    let maxValue = 20;                             // :60753 主桶分母
    let maxValue2 = 40;                            // :60754 副桶分母
    let num2 = 1;                                  // :60755 掷骰次数
    // ★IIIII61 WorldGen.Skyblock.lowTiles 首臂（NPC.cs:60957-60970）：低格世界
    //   maxValue2=20 / num2+4 / maxValue=15，且 netID==-6 再 +5（非低格 -6 仅 +4）
    if (w.skyblockLowTiles) {
      maxValue2 = 20;
      num2 += 4;
      maxValue = 15;
      if (netId === -6) num2 += 5;
    } else if (netId === -6) {
      num2 += 4;                                   // :60769-60772
    }
    if (w.weather.slimeRain) num2 += 2;            // :60773-60775 Main.slimeRain
    const surfaceY = w.groundLevel;                // Main.worldSurface（tile）
    const yTile = this.y / TILE;
    const rockLayer = (y: number): boolean => (sf.remix   // WorldGen.isThisInTheRockLayer :26916
      ? (y > surfaceY && y <= w.rockLevel) : y > w.rockLevel);
    for (let i = 0; i < num2; i++) {
      if (this.ai1 !== -1) break;                  // :60777-60781 已中即停
      if (vid === 59) {                            // :60784 岩浆史莱姆
        if (sf.remix && roll(maxValue) === 0) {    // Main.remixWorld
          this.ai1 = this.slimeGenItemInsideBody(this.ai0 === -999);
        }
        // ★IIIII61 Skyblock.noHellstone && downedBoss3 && Next(15)==0 → 174 狱石
        else if (w.skyblockNoHellstone
          && !!(w.flags['downed_35'] || w.flags.downedSkeletron)
          && roll(15) === 0) {
          this.ai1 = 174;
        }
      } else if (yTile > surfaceY && (vid === 147 || vid === 184)) {  // :60796 地下棘刺史莱姆
        // 两 lowTiles 子分支（:60800-60811）与普通分支同体 → 合并
        if (roll(maxValue2) === 0) this.ai1 = roll(2) === 0 ? 1103 : 593;  // 淤泥/雪块
      } else if (vid === 537) {                    // :60812 沙漠史莱姆
        // ★IIIII61 Skyblock.noFossils && Next(5)==0 → 3347 沙漠化石（:61023-61027）
        if (w.skyblockNoFossils && roll(5) === 0) this.ai1 = 3347;
      } else {
        if (vid !== 1 || netId === -5 || netId === -4) continue;   // :60815 仅蓝史莱姆族
        let num4 = 500;                            // :60817 史莱姆法杖分母
        if (sf.noTraps) num4 = 20;                 // Main.noTrapsWorld
        else if (sf.getGoodWorld) num4 = 100;      // Main.getGoodWorld
        else if (this.cy < surfaceY * TILE) num4 = -1;             // 地表蓝史莱姆不掷法杖
        // ★IIIII61 蓝史莱姆三臂前置接入（NPC.cs:61047-61078 原版为一条互斥
        //   else-if 链的【最前两臂】——必须与后续派对/蜜蜂臂共链，不得另起分支）：
        //   ① rockLayer && (noLifeCrystals||lowTiles) && !AnyLifeCrystalSlimes() &&
        //      Next(200)==0 → ai[1]=29（水晶史莱姆，死后掉生命水晶）
        //      （AnyLifeCrystalSlimes :90966-90976 = 场上存在 type==1 && ai[1]==29）
        //   ② lowTiles && 地下(worldSurface 以深) && Next(1000)==0 →
        //      Item.GetRandomVoiceItem（Item.cs:49431-49450：Next(14) 池=
        //      5500-5509/5484/5485/5534/5499 录音道具）；未注册键回退空 -1
        const genuineParty = !!w.scene?.partyGenuine;       // BirthdayParty.GenuineParty（真派对；NPC.cs:61055 判据=本体非 PartyIsUp）
        if (rockLayer(yTile) && (w.skyblockNoLifeCrystals || w.skyblockLowTiles)
          && !(game.enemies() as Array<Enemy>).some((o) => o !== this && !o.dead
            && o.vanillaId === 1 && o.ai1 === 29)
          && roll(200) === 0) {
          this.ai1 = 29;
        } else if (w.skyblockLowTiles && yTile > surfaceY && roll(1000) === 0) {
          const VOICE_POOL: Record<number, number> = {
            1: 5500, 2: 5501, 3: 5502, 4: 5503, 5: 5504, 6: 5505, 7: 5506,
            8: 5507, 9: 5508, 10: 5509, 11: 5484, 12: 5485, 13: 5534, 0: 5499,
          };
          const vidPick = roll(14);
          const itemId = VOICE_POOL[vidPick] ?? 5499;
          this.ai1 = VANILLA_ITEM_KEY_BY_ID[itemId] ? itemId : -1;
        } else if (genuineParty && this.cy < surfaceY * TILE) {    // :60831-60839 地表真派对
          this.ai1 = roll(2) === 0 ? 3736 + roll(3) : 1345;         // Next(3736,3739) 气球/彩纸
        } else if (netId === -10 && roll(20) === 0) {               // :60840-60849 蜜蜂丛林变种
          const num5 = sf.notTheBees ? roll(4) : roll(3);           // notTheBeesWorld 扩到 314/5395
          this.ai1 = num5 === 1 ? 1125 : num5 === 2 ? 314 : num5 === 3 ? 5395 : 1124;
        } else if (roll(maxValue) === 0) {                          // :60850-60854 主桶
          this.ai1 = this.slimeGenItemInsideBody(this.ai0 === -999);
        } else if (roll(maxValue2) === 0) {                         // :60855 副桶
          if (yTile <= surfaceY) {
            // Skyblock.lowTiles 表层分支（:60859-60876：194/195/62/27）：天空盒未实装跳过
            this.ai1 = 751;                        // 云块
          } else if (!rockLayer(yTile)) {                            // :60882-60887 浅地下
            const num7 = roll(3);
            this.ai1 = num7 === 1 ? 3 : num7 === 2 ? 9 : 2;         // 石/木/土
          } else if (roll(10) === 0) {
            this.ai1 = 3609;                        // :60888-60890 传送带
          } else {
            // Skyblock.lowTiles && hardMode 矿桶（:60892-60902）：天空盒未实装跳过
            const num9 = roll(4);                   // :60904-60910 深层
            this.ai1 = num9 === 1 ? 150 : num9 === 2 ? 3086 : num9 === 3 ? 3081 : 3; // 蛛网/花岗岩/大理石/石
          }
        } else if (num4 > 0 && roll(num4) === 0) {
          this.ai1 = 539;                           // :60911-60913 史莱姆法杖
        } else if (sf.getGoodWorld && yTile > surfaceY && roll(num4) === 0) {
          this.ai1 = 147;                           // :60914-60916 ftw 地下 → 棘刺丛林史莱姆物
        } else if (i === 0 && sf.remix && this.ai0 !== -999 && roll(3) === 0) {
          this.ai1 = 75;                            // :60917-60919 首掷 remix → 生命水晶星史莱姆
        } else if (sf.vampireSeed && !sf.remix && roll(13) === 0 && yTile > surfaceY) {
          // Main.vampireSeed（:60920-60923）：吸血鬼种子世界地下 1/13 → 持木头(9)
          this.ai1 = 9;
        }
      }
    }
  }

  /** WorldGen.PlaceSuitableHerbHere + PlaceAlch（WorldGen.cs:45948-45976 / :45386-
   *  45484）运行期版——药草史莱姆洒籽（NPC.cs:61296）消费。基座格 (x,y) 按类型
   *  分派 style（顺序覆盖式 if 链，PlaceAlch 落在 y-1）；PlaceAlch 门 = 目标格净空
   *  + 基座 nactive/整砖/无坡 + style 白名单（78/380 草变体各族通用）+ 液体门
   *  （style≤3 拒一切液体 / 4·6 拒岩浆 / 5 仅容岩浆）；放 82 号芽 frameX=style*18，
   *  油漆继承基座（CopyPaintAndCoating）。sheet 比对走 TILE_DEFS[].vanilla.sheet。 */
  private placeSuitableHerbHere(st: import('../world/TileStore').TileStore, x: number, y: number): void {
    if (!st.inBounds(x, y) || !st.inBounds(x, y - 1)) return;
    const sheet = TILE_DEFS[st.type[st.idx(x, y)]]?.vanilla?.sheet ?? -1;
    let style = -1;
    if (sheet === 2 || sheet === 109) style = 0;               // :45950-45953 草
    else if (sheet === 60) style = 1;                          // :45955-45958 丛林草
    else if (sheet === 0 || sheet === 59) style = 2;           // :45960-45963 土/泥
    else if (sheet === 23 || sheet === 661 || sheet === 25 || sheet === 203
      || sheet === 199 || sheet === 662) style = 3;            // :45965-45968 邪恶草
    else if ((sheet === 53 || sheet === 116)
      && x >= 380 && x <= st.w - 380) style = 4;               // :45970-45973 沙（beachDistance=380，WorldGen.cs:4102）
    else if (sheet === 57 || sheet === 633) style = 5;         // :45975-45978 灰烬
    else if (sheet === 147 || sheet === 163 || sheet === 164 || sheet === 161
      || sheet === 200) style = 6;                             // :45980-45983 冰雪族
    if (style === -1) return;
    // PlaceAlch（:45386-45484）：目标格 (x, y-1) 净空、基座 nactive 整砖无坡
    const k = st.idx(x, y - 1), g = st.idx(x, y);
    if (st.flags[k]) return;                                   // 目标格已活（原版裸 active()——非 nactive,勿改）
    // ★G1谓词批(2026-09-04)：基座门= tile2.nactive()（WorldGen.cs:45790）——flags
    // 位读漏 !inActive 半边,已致动基座会误种药草 → 改 isActive()
    if (!st.isActive(x, y) || st.half[g] || st.slope[g] !== 0) return;
    const ground = TILE_DEFS[st.type[g]]?.vanilla?.sheet ?? -1;
    const liq = st.liquid[k];
    const liqType = st.liquidType[k];
    const lava = liq > 0 && liqType === 2;
    let ok = false;
    if (style === 0) ok = [2, 477, 492, 78, 380, 109].includes(ground) && liq === 0;
    else if (style === 1) ok = [60, 78, 380].includes(ground) && liq === 0;
    else if (style === 2) ok = [0, 59, 78, 380].includes(ground) && liq === 0;
    else if (style === 3) ok = [661, 662, 203, 199, 23, 25, 78, 380].includes(ground) && liq === 0;
    else if (style === 4) ok = [53, 78, 380, 116].includes(ground) && !(liq > 0 && lava);
    else if (style === 5) ok = [57, 633, 78, 380].includes(ground) && !(liq > 0 && !lava);
    else if (style === 6) ok = [78, 380, 147, 161, 163, 164, 200].includes(ground) && !(liq > 0 && lava);
    if (!ok) return;
    st.setTile(x, y - 1, TILE_BY_KEY['v_82_herbs_sprout'] ?? 0, 18 * style, 0);
    st.paint[k] = st.paint[g];                                 // CopyPaintAndCoating（:45479）
    // 涂层位侧（Tile.CopyPaintAndCoating，Tile.cs:897-903：color+invisibleBlock+
    // fullbrightBlock 三拷——方块侧两位随漆继承，墙位不动）
    st.coat[k] = (st.coat[k] & ~TileStore.COAT_BLOCK_MASK) | (st.coat[g] & TileStore.COAT_BLOCK_MASK);
  }

  /** AI_001_Slimes 原版核（1.4.5.6 NPC.cs:60735+）：
   *  站定 vx*=0.8；ai[0] 每 tick +1（激愤 +1 额外）；
   *  阶段判定（num54=-1000）：ai0>=0 → 小跳（vy=-6, vx+=2*dir, ai0=-1120）；
   *  -1000..-500 → 小跳（ai0=-2120）；-2000..-1500 → 大跳（vy=-8, vx+=3*dir, ai0=-200）。
   *  即：小跳→小跳→大跳循环，约 5-10 秒节奏。
   *  flag3 激愤（L61446）= 夜晚 || 受过伤 || 地下 → 追玩家；白天满血地表 = 被动保持方向。
   *  卡墙（L61937）：落地 X == 起跳 X → direction 反转 + ai[2]=200 冷却（期间不索敌）。
   *  蚱蜢(377/446) 复用本 AI（ai0 额外 +3，跳得更频繁） */
  /** GetAttackDamage_ForProjectiles_MultiLerp（NPC.cs:7036-7039）：t = GetLerpValue(
   *  Classic, Master, difficulty) 钳 [0,1]——GDL 档位是浮点 Classic=1/Expert=2/
   *  Master=3（ScaleStats.GDL），故 t=(difficulty−1)/2；Utils.MultiLerp 三值两段
   *  线性（t=0/0.5/1 → 经典/专家/大师），(int) 截断 */
  private projDmgMultiLerp(normal: number, expert: number, master: number): number {
    const t = Math.min(1, Math.max(0, (this.difficulty - 1) / 2));
    return Math.trunc(t < 0.5
      ? normal + (expert - normal) * t * 2
      : expert + (master - expert) * (t - 0.5) * 2);
  }

  /** ★SW-BJ9 2026-09-07 **刻意偏离原版**（deliberate deviation，产品拍板：避免穿墙，
   *  哪怕偏离原版）——嵌固回退漂移步的「全程不进全实心」门 + episode 终止闩。
   *  原版行为（NPC.cs:62139 贴地支/:62331 滞空支 `position.X -= velocity.X + direction`，
   *  门 collideY + oldVelocity.Y≠0 + SolidCollision）在「地坡高端邻实心柱」几何下
   *  不自限：SolidCollision(:2713) 对坡格取整块盒 → 嵌固判定恒真，且 TileCollision
   *  对已重叠体忽略(:2440) → 每拍 1px 匀速相移穿越整条墙带（流浪汉舌 (1825,317)
   *  s1 坡角实录 t=188-211，绿史莱姆整只穿到井侧=原版本体行为）。本仓偏离：
   *  · 漂移 X 位移应用前先测【漂移后】位盒的全实心重叠（fullSolidBoxOverlap——
   *    solid 且非坡/非半砖/非平台，激活感知谓词）：
   *    - 命中全实心 → 本拍漂移取消（X 位移归零）+ episode 终止（unwedgeBlocked
   *      置位，防逐拍磨墙）；unwedgeDrift 旗【不】置位 → unembedPass 不再让位，
   *      真活埋照旧走既有救援通道；
   *    - 只与坡格重叠（嵌固判定的常态来源）→ 照常漂移，原版退坡楔功能保留。
   *  · episode 终止后不再漂移（unwedgeBlocked 消费于方法头），嵌固判定链断开时由
   *    两调用点的 else 臂清位——此后原版行为链自然继续（跳跃机/卡墙掉头接管）。
   *  偏离范围铁律：仅 AI_001 两处漂移应用点（slimeAI 贴地支 ：61932 通道/滞空支
   *  :62124 通道）进入本门；右移漂移（direction 反向）同门（门测漂移后位盒，与
   *  方向无关）。行走/跳跃/击退/液浮/unembed/StepUp/StepDown 等一切其它位移路径
   *  零触碰。测试接缝：反证测试经原型补丁关断 unwedgeGateBlocksFullSolid 即复现
   *  原版穿越（决定性翻转实验）。 */
  private applyUnwedgeDrift(st: GameHooks['world']['store'], dir: number): void {
    if (this.unwedgeBlocked) return;                       // episode 已终止：不再漂移
    const postX = this.x - (this.vx + dir);                // 原版 position.X -= velocity.X + direction
    if (this.unwedgeGateBlocksFullSolid(st, postX)) {
      this.unwedgeBlocked = true;                          // 本拍取消 + episode 终止（SW-BJ9）
      return;
    }
    this.x = postX;
    this.unwedgeDrift = true;                              // SW-BJ6：漂移活跃旗（unembedPass 让位）
  }

  /** 全实心门判定（SW-BJ9，偏离声明见 applyUnwedgeDrift）。独立方法 = 反证测试的
   *  唯一关断接缝：原型补丁置恒 false → 门关闭 → 同夹具复现原版穿越。 */
  private unwedgeGateBlocksFullSolid(st: GameHooks['world']['store'], postDriftX: number): boolean {
    return fullSolidBoxOverlap(st, postDriftX, this.y, this.w, this.h);
  }

  private slimeAI(game: GameHooks, player: Player | null) {
    // ---- 体内物品掷骰（NPC.cs:60750 主掷段，只掷一次）。原版位于 ai[0]==-999 早退
    //      【之前】（:61436 才 return）——风气球挂载史莱姆（出生即 ai0=-999）由此
    //      掷出 isBallooned 风筝/纸飞机桶；曾置于早退后 = 挂载体永不掷物（2026-08-19
    //      G2 批按 :61436 时序归位）----
    this.slimeRollContainedItem(game);
    // ---- 携物变体梯（S10/G2，NPC.cs:61088-61433 全梯 1:1，2026-08-19）：
    //  门 = NPCID.Sets.SlimeCanContainItems[type] && ai[1]>0（:61088-61089——可携物
    //  族 {1,59,147,184,537} 全体，非仅 type1）。逐档 else-if 与原版同序：
    //  539 史莱姆法杖物 / 364 族 金属矿（S9 原段并入）/ 2 泥 / 9 木 / 3 石（滞空）/
    //  751 云（滞空）/ 150 蛛网 / 3086 花岗岩 / 3081 大理岩 / 147 棘刺 / 8 火把
    //  （ftw）/ 5395 屎 / 1124 蜂巢 / 1125 蜂蜜 / 314 药草 / 3736-3738 气球 /
    //  1345 彩纸 / 1103 淤泥 / 593 雪 / 3347 化石 / 29 生命水晶 / 3609 传送带 /
    //  174 地狱石。
    //  各档 _givenName 特殊名（Language/SpecialNPCName.*）本仓无敌怪名显示通道，
    //  整体跳过（备案）。尾档 ai[1]>0 && ItemID.Sets.IsAVoiceChangeItem（:61426-
    //  61433 lifeMax×3）：变声物品集 {215,5484,5485,5499-5509,5534}（ItemID.cs:1084）
    //  仅经 WorldGen.Skyblock 的 GetRandomVoiceItem 出生（:60827-60830）——天空盒
    //  世界未实装（slimeRollContainedItem 同判），完全不可达，跳过（备案）----
    let flag2 = false;                    // :61088 金属矿悬停位（:61434 direction 复位门消费）
    const vidC = this.vanillaId;
    if (vidC !== null && Enemy.SLIME_CAN_CONTAIN_ITEMS.has(vidC) && this.ai1 > 0) {
      const base = this.slimeItemBase ?? (this.slimeItemBase = {
        dmg: this.def.damage, def: this.def.defense ?? 0,
        kb: this.def.knockbackResist, hp: this.def.hp,
      });
      const roll = (n: number) => Math.floor(Math.random() * n);   // Main.rand.Next(n)
      const stL = game.world.store;
      const sf = game.world.seedFlags;
      const a1 = this.ai1;
      if (a1 === 539) {
        // :61090-61105 史莱姆法杖物：noTraps/getGood 分母 300−120−120；1/num11 且
        //  目标存活视线可达 → 弹 1073（direction×12, 0）伤 20。kb=2 出参本仓敌弹
        //  出口（spawnHostileProj）无 knockback 通道，登记。
        //  ★SW-BJ34 2026-09-08：补 `!Main.player[target].npcTypeNoAggro[type]` 门
        //  （1457 :61303；1456 :61102）——曾整缺（登记为「与 S7 仆从段同口径省略」，
        //  本批与凝胶接触面一并清偿）。可携物族 {1,59,147,184,537} 全在 23 类表内，
        //  门对凝胶装着者恒关。
        let num11 = 300;
        if (sf.noTraps) num11 -= 120;
        if (sf.getGoodWorld) num11 -= 120;
        if (roll(num11) === 0 && player && !player.dead
          && !npcTypeNoAggro(this.vanillaId, player) && this.canSeePlayer(stL, player)) {
          this.spawnHostileProj(game, this.cx, this.cy, this.facing * 12, 0, 20, 1073);
          // 出膛音（Projectile.cs:56284-56287 ai[1]==0 首拍）:弹 1073 → Item17——
          // 发射位等价结算（弹先出生后补播,同 bossAI.ts 83=Item_33 先例）
          game.playSfxWav?.('Item_17', 1, this.cx, this.cy);
        }
      } else if (a1 === 364 || a1 === 1104 || a1 === 365 || a1 === 1105 || a1 === 366 || a1 === 1106) {
        // ---- 金属矿史莱姆强化段（S9，NPC.cs:61107-61178 全段，2026-08-19）：
        //  lavaImmune（:61108）由 npcLiquid.ts 状态位按 ai[1] 求值（非 SetDefaults
        //  表内，本 AI 不重复置位）/ 防御 +30 / 伤害 ×3 / kbResist=0。
        //  1457 :61312-61316 运行时 buffImmune 复位（70/397/395/20 → false）——
        //  本仓无实例级免疫表,以 debuffImmuneOverride 覆写位等价（projStatus 施加门
        //  消费）：蓝史莱姆族静态免疫 20（中毒）,熔岩变体运行时可被中毒/强酸/叶绿
        //  孢子/毒液命中（398 毒素加速全文件无 buffImmune 条目=无豁免,勿加）；
        //  一次性（lifeMax==defLifeMax 门）scale ×1.2 + 盒随 bottom-center 重扩（w/h
        //  ×1.2 增量——原版 num22 字面，勿乘总 scale 复合）+ HP ×3；悬停重力：玩家在
        //  正上方（X 重叠 + Bottom<Top + CanHit）→ flag2、direction=0、vx×0.5、
        //  vy 钳 ≥0 后 +gravity（沉降贴人）；否则 vy>0 +gravity / vy<0 −gravity×0.75
        //  （升沉阻尼）。光 (color/500) 在 slimeAI 尾段（:61152）。
        if (!this.debuffImmuneOverride) this.debuffImmuneOverride = new Map();
        this.debuffImmuneOverride.set(70, false);                  // :61313 buffImmune[70]=false
        this.debuffImmuneOverride.set(397, false);                 // :61314（1457 新）
        this.debuffImmuneOverride.set(395, false);                 // :61315（1457 新）
        this.debuffImmuneOverride.set(20, false);                  // :61316
        if (this.maxHp === this.def.hp) {                         // :61115 lifeMax==defLifeMax 一次性门
          const num22 = 1.2;
          this.vanillaScale = (this.vanillaScale ?? 1) * num22;   // :61119 scale ×1.2
          const cx0 = this.cx, bot0 = this.y + this.h;
          this.w = Math.trunc(this.w * num22);                    // :61120-61121 width/height ×1.2
          this.h = Math.trunc(this.h * num22);
          this.x = cx0 - this.w / 2;                              // bottom-center 重锚
          this.y = bot0 - this.h;
          if (this.hp === this.maxHp) this.hp = base.hp * 3;      // :61124-61126 life ×3
          this.maxHp = base.hp * 3;                               // :61128 lifeMax ×3
        }
        this.def.defense = base.def + 30;                         // :61110 defDefense+30
        this.def.damage = Math.trunc(base.dmg * 3);               // :61111 (int)(defDamage×3)
        this.def.knockbackResist = 0;                             // :61114
        if (player && this.y + this.h < player.y && this.x + this.w >= player.x
          && this.x <= player.x + player.w
          && canHit(game.world.store, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)) {
          flag2 = true;                                           // :61132 悬停位
          this.facing = 0;                                        // :61133 direction = 0
          this.vx *= 0.5;                                         // :61134
          if (this.vy < 0) this.vy = 0;                           // :61135-61138
          this.vy += ENEMY_GRAVITY;                                // :61139 gravity（叠加共享重力=npc.gravity 0.3）
        } else {
          if (this.vy > 0) this.vy += ENEMY_GRAVITY;              // :61143-61146
          if (this.vy < 0) this.vy -= ENEMY_GRAVITY * 0.75;       // :61147-61150
        }
      } else if (a1 === 2) {
        // :61179-61186 泥史莱姆：贴地（vy==0）跳跳计数 +9/t——全梯最快档
        if (this.vy === 0) this.ai0 += 9;
      } else if (a1 === 9) {
        this.def.defense = base.def + 16;                         // :61187-61188 木史莱姆 防御+16
      } else if (a1 === 3 && this.vy !== 0) {
        // :61192-61199 石史莱姆（整档门=滞空）：下坠期 +2g（叠加共享段 +g → 3g 沉坠）
        if (this.vy > 0) this.vy += ENEMY_GRAVITY * 2;
      } else if (a1 === 751 && this.vy !== 0) {
        // :61200-61204 云史莱姆（整档门=滞空）：恒 −0.6g（净 +0.4g 缓落缓升）
        this.vy -= ENEMY_GRAVITY * 0.6;
      } else if (a1 === 150) {
        // :61205-61221 蛛网史莱姆：1/120 在自身包围盒随机格放蛛网。WorldGen.
        //  PlaceTile(51)（:59393）：非实心族免 EmptyTile 门 + 液体格拒绝（:59477-
        //  59495 的 num==51 名单）+ default 分支裸放（:60258）无锚定——即"格净空
        //  且无液体即放"。checkingLiquid（液体处理中标记）单人不可观测，液体>0 等价
        if (roll(120) === 0) {
          const wx0 = Math.floor(this.x / TILE), wx1 = Math.floor((this.x + this.w) / TILE);
          const wy0 = Math.floor(this.y / TILE), wy1 = Math.floor((this.y + this.h) / TILE);
          const wx = wx0 + roll(wx1 - wx0 + 1);                   // Next(left, right+1)
          const wy = wy0 + roll(wy1 - wy0 + 1);
          if (stL.inBounds(wx, wy) && !stL.flags[stL.idx(wx, wy)]
            && stL.liquid[stL.idx(wx, wy)] === 0) {
            stL.setTile(wx, wy, TILE_BY_KEY['v_51_cobweb'] ?? 0);
          }
        }
      } else if (a1 === 3086) {                                   // :61425-61430 花岗岩 防御+16 kb0
        this.def.defense = base.def + 16;
        this.def.knockbackResist = 0;
      } else if (a1 === 3081) {                                   // :61431-61436 大理岩 同款
        this.def.defense = base.def + 16;
        this.def.knockbackResist = 0;
      } else if (a1 === 147) {
        this.def.damage = base.dmg * 2;                           // :61437-61441 棘刺史莱姆 伤害×2
      } else if (a1 === 8 && sf.getGoodWorld) {
        // ★Z4/行号勘误（审计 D6,2026-10-02）：火把史莱姆（ftw 专属）实锚 =
        //  NPC.cs:61442-61450（AddBuff(24, 216000) :61445 永燃（火尘/光 (1,0.3,0.1)
        //  均已由 onFireT 管线承担）+ buffImmune[323/44/324/39]（OnFire3/Frostburn/
        //  Frostburn2/CursedInferno）:61446-61449——旧引 61239-61247 系同函数
        //  slime 染色块（color Lerp 带 :61215-61287）的错位撞号,非本块）。
        //  本仓无实例级 buff 免疫表——梯段每 tick 清四计时位等效免疫（梯先于
        //  debuff tick 跑，零漏帧）
        this.onFireT = 3600;
        this.onFire3T = 0; this.frostburnT = 0; this.frostburn2T = 0; this.cursedT = 0;
      } else if (a1 === 5395) {
        // :61451-61462 屎史莱姆：1/30 PooFly 粒子编排（ParticleOrchestrator，
        //  clientOnly,掷门 :61454）——本仓无 ParticleOrchestrator 管线，纯视觉跳过（备案）
      } else if (a1 === 1124) {
        // :61463-61480 蜂巢史莱姆：Next(60)==7 且目标存活视线可达 → NewNPC 蜂
        //  210/211 @Center（:61466-61469）；初速 = (Next(−20,21)×0.1, −1) 归一 ×3；
        //  localAI[0]=60 / ai[1]=60 蜂状态位随实体带入。CanBeReplacedByOtherNPCs
        //  （出怪池替换标记 :61470）本仓 spawner 无对应位，登记
        if (roll(60) === 7 && player && !player.dead && this.canSeePlayer(stL, player)) {
          const bee = Enemy.fromVanilla(210 + roll(2), this.cx, this.cy);
          if (bee) {
            // ★Bottom 锚勘误（1457 :61466 NewNPC((int)Center.X,(int)Center.Y) →
            //  nPC.Bottom=(Center.X,Center.Y)）:蜂顶 = 父 cy−h——旧中心锚低 h/2
            bee.y = this.cy - bee.h;
            const bx = (Math.floor(Math.random() * 41) - 20) * 0.1, by = -1;
            const bl = Math.hypot(bx, by);
            bee.vx = (bx / bl) * 3;
            bee.vy = (by / bl) * 3;
            bee.lai0 = 60;
            bee.ai1 = 60;
            (game as unknown as { entities?: { add?: (e: unknown, b: string) => void } })
              .entities?.add?.(bee, 'enemies');
          }
        }
      } else if (a1 === 1125) {
        // :61278-61281 蜂蜜史莱姆：仅特殊名，无行为段
      } else if (a1 === 314) {
        // :61282-61307 药草史莱姆：尘 41 1/60（alpha250 scale0.8）+ 中心格光
        //  (0.4,0.9,1)（光位在 slimeAI 尾段）+ 贴地且 localAI[3]<5 时 1/180 于
        //  脚下 (Bottom−8) 格洒药草芽（PlaceSuitableHerbHere），放成即计数
        if (roll(60) === 0) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 41, 0, 0, 250, null, 0.8);
        }
        if (this.vy === 0 && this.lai3 < 5 && roll(180) === 0) {
          const hx = Math.floor(this.cx / TILE);
          const hy = Math.floor((this.y + this.h - 8) / TILE);
          if (stL.inBounds(hx, hy) && !stL.flags[stL.idx(hx, hy)]) {
            this.placeSuitableHerbHere(stL, hx, hy + 1);          // :61296 WorldGen.PlaceSuitableHerbHere(x, y+1)
            if (stL.flags[stL.idx(hx, hy)]) this.lai3 += 1;       // :61298-61304 放成即 localAI[3]+1
          }
        }
      } else if (a1 === 3736 || a1 === 3737 || a1 === 3738) {
        // :61308-61315 气球史莱姆：collideY 且碰撞前下坠 >4 → 落地反弹 −vy×0.7
        //  （collideY=TileCollision 层 Y 碰撞位；preCollideVy=oldVelocity.Y）
        if (this.collideY && this.preCollideVy > 4) this.vy = -this.preCollideVy * 0.7;
      } else if (a1 === 1345) {
        // :61316-61333 彩纸史莱姆：尘 139-142 1/30（speedY −10、scale 1.2 ±30%、
        //  X 向 ±0.05 抖动）+ gore 276-282 1/60（scale ±20%、同抖动）
        if (roll(30) === 0) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h,
            139 + roll(4), 0, -10, 0, null, 1.2);
          if (d) {
            d.scale *= 1 + (roll(61) - 30) * 0.01;
            d.vx += (Math.floor(Math.random() * 101) - 50) * 0.05;
          }
        }
        if (roll(60) === 0) {
          const g = GorePiece.newGore(276 + roll(7), this.x, this.y, 0, -10,
            1 + (roll(41) - 20) * 0.01);
          if (g) g.vx += (Math.floor(Math.random() * 101) - 50) * 0.05;
        }
      } else if (a1 === 1103 || a1 === 593) {
        // :61334-61369 淤泥/雪史莱姆（两档逐字相同）：尘 135 1/3（speed=速度×0.4、
        //  alpha100 scale2.5、noGravity、速度×1.8、Y−0.75；1/4 转 noGravity=false
        //  且 scale×0.5）
        if (roll(3) === 0) {
          const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 4, 135,
            this.vx * 0.4, this.vy * 0.4, 100, null, 2.5, true);
          if (d) {
            d.vx *= 1.8;
            d.vy = d.vy * 1.8 - 0.75;
            if (roll(4) === 0) { d.noGravity = false; d.scale *= 0.5; }
          }
        }
      } else if (a1 === 3347) {
        // :61370-61376 化石史莱姆：alpha 125 半透明 + 跳跳计数每 tick +1（梯段
        //  先于 grounded 段——空中也加）+ 伤害 +10
        this.spawnAlpha = 125;
        this.ai0 += 1;
        this.def.damage = base.dmg + 10;
      } else if (a1 === 29) {
        // :61377-61389 生命水晶史莱姆：防御 +4；一次性 lifeMax ×2（满血则 life 同步）
        this.def.defense = base.def + 4;
        if (this.maxHp === this.def.hp) {
          if (this.hp === this.maxHp) this.hp = base.hp * 2;
          this.maxHp = base.hp * 2;
        }
      } else if (a1 === 3609) {
        // :61390-61395 传送带史莱姆：防御 +8 伤害 +6（地面摩擦替换段见 grounded
        //  分支 :61938-61948——不减速、恒向 direction 加速 ±0.1 钳 ±2.5）
        this.def.defense = base.def + 8;
        this.def.damage = base.dmg + 6;
      } else if (a1 === 174) {
        // :61396-61425 地狱石史莱姆：防 +14 伤 +20；一次性 kbResist÷3 + life/lifeMax
        //  ×2 + scale×1.2（num22 增量）盒随底心重扩；每 tick 火尘 6（速度×0.2、
        //  alpha100 scale1.7→×0.6、速度×2、Y−2）+ 尘 31（scale 0.1-0.5、fadeIn
        //  1.5-1.9、Y−5、noGravity）
        this.def.defense = base.def + 14;
        this.def.damage = base.dmg + 20;
        if (this.maxHp === this.def.hp) {
          this.def.knockbackResist = base.kb / 3;                 // :61404 knockBackResist /= 3
          this.hp *= 2;                                           // :61405 life *= 2
          this.maxHp = base.hp * 2;                               // :61406 lifeMax *= 2
          const num22b = 1.2;                                     // :61409-61418 scale ×1.2 + 盒重扩
          this.vanillaScale = (this.vanillaScale ?? 1) * num22b;
          const cx0 = this.cx, bot0 = this.y + this.h;
          this.w = Math.trunc(this.w * num22b);
          this.h = Math.trunc(this.h * num22b);
          this.x = cx0 - this.w / 2;
          this.y = bot0 - this.h;
        }
        const d6 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
          this.vx * 0.2, this.vy * 0.2, 100, null, 1.7);
        if (d6) { d6.scale *= 0.6; d6.vx *= 2; d6.vy = d6.vy * 2 - 2; }
        const d31 = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 50,
          null, 0.1 + roll(5) * 0.1, true);
        if (d31) { d31.fadeIn = 1.5 + roll(5) * 0.1; d31.vy -= 5; }
      }
    }
    // :61434-61435 type1 且 direction==0（金属矿悬停置 0）非悬停时复位为 1——曾缺
    //  = 悬停过一次的金属矿史莱姆永久 facing 0（跳冲量全无横向分量）
    if (this.vanillaId === 1 && this.facing === 0 && !flag2) this.facing = 1;
    // :61436-61441 ai[0]==-999 风气球挂载冻结（帧 0 不行动，位置由气球驱动）——
    //  原版时序在掷骰+携物梯之后：挂载体照掷物/照跑梯（风筝桶 isBallooned 链即
    //  依赖此序）。尾段点光（原版 :61442-61531）本就在早退后，无分歧
    //  ★F4（2026-09-02 红队 I′）：原版 AI 早退仍落【共享尾】velocity.Y+=gravity
    //  +UpdateCollision（NPC.cs:91580-91607）——slave（type1 noGravity=false）挂载
    //  期照吃重力,气球消散后 ~19 拍落地坐地;本仓冻结支裸 return = 零物理悬浮尸。
    //  补共享尾等价（groundPhysics = applyGravity(:91580-91607+:91882-91952 含
    //  per-type/高空/wet 档,ENEMY_GRAVITY 0.3+MAX_FALL_SPEED 10)+moveAndCollide,
    //  与 slimeAI 正常尾 :3772 同款）再 return;气球活时下拍挂载写回
    //  （windyBalloonAI 尾 slave.x/y/vx/vy 钉位）覆盖,零可见差异。
    if (this.ai0 === -999) {
      this.groundPhysics(game);
      return;
    }
    // ---- 史莱姆族点光（cs:61445-61456 / :61508-61515 / :61527-61531 / :61866-61870）----
    if (this.vanillaId === 244) {
      // :61444-61456 彩虹史莱姆 = Main.Disco 三色（6 相状态机 ≈ hsl 时间色，s=1 l=0.5）
      const [dr, dg, db] = hslToRgb((visEffectFrames() / 222) % 1, 1, 0.5);
      this.lightRGB = [dr, dg, db];
    } else if (this.vanillaId === 667) {
      // :61508-61513 金史莱姆 Color(204,181,72)/255×1.1
      this.lightRGB = [(204 / 255) * 1.1, (181 / 255) * 1.1, (72 / 255) * 1.1];
    } else if (this.vanillaId === 676) {
      // :61527-61530 微光史莱姆 = TorchColor(23)（TorchID.cs:48-62 公式）
      const num = Math.min(1, Math.max(0, 0.9 + (270 - mouseTextColorApprox()) / 900));
      this.lightRGB = [num * 0.9, 0.55, num * 1.2];
    } else if (this.vanillaId === 59) {
      // ★BJ243（2026-09-21，NPC.cs:62068-62075；用户实报"熔岩史莱姆无粒子"定谳：
      //  原版 AI_001 每 tick 无条件 1× 尘 6 Torch——曾只接光半块=尘面整缺）：
      //  光 :62071 (1,0.3,0.1)（旧注 :61866-61870 系行号漂移,该段为 658 仆从弹幕）
      //  + 尘 :62072 Speed=velocity×0.2、α100、scale1.7 + :62073 noGravity=true。
      //  netOffset 加减（:62070/:62074）为 MP 位置噪声补偿,本仓单源坐标无此项；
      //  携地狱石变体（ai1=174 :61619-61628）另发己档两尘,两块原版本就叠加。
      this.lightRGB = [1, 0.3, 0.1];                                    // :62071 岩浆史莱姆
      game.spawnDust?.(this.x, this.y, this.w, this.h, 6,
        this.vx * 0.2, this.vy * 0.2, 100, null, 1.7, true);
    }
    const st = game.world.store;
    const underground = this.cy / TILE > game.world.groundLevel;
    const grasshopper = this.vanillaId === 377 || this.vanillaId === 446;
    // flag3 激愤判定（:61459-61463）：!白天 || 受伤 || 地下 || ★史莱姆雨
    //  （第四项曾缺——史莱姆雨白天满血地表史莱姆应主动追人 :61462）
    // ★R6-B 2-9：尖刺/仆从射击门的 !wet 曾用 liquid>80 近似（inWater 局部量随
    //  2-10 一并退役），原版 wet=任意水深（NPC.wet 由碰撞段置位）
    const hurt = this.hp < this.maxHp;
    let flag3 = !game.world.clock.isDay || hurt || underground || !!game.world.weather.slimeRain;
    // per-type 恒激愤覆盖（cs:61468-61799）：81 腐化/183 猩红/304 南瓜跳跳/667 金/
    // 244 雨/184/535/658/659 仆从/204 丛林刺——白天满血地表照追（曾全缺 =
    // 白天只见游荡,审计 S2,2026-08-19）
    if (this.vanillaId !== null && SLIME_FORCE_AGGRO.has(this.vanillaId)) flag3 = true;
    // ★IIIII224（NPC.cs:61667）：remix 满血岩浆史莱姆强制不追人
    if (game.world.seedFlags?.remix && this.vanillaId === 59 && this.hp === this.maxHp) flag3 = false;
    // ---- 244 彩虹史莱姆（1457 :61698-61702，R6-B 2-4）：flag3=true + ai[0]+=2
    // 每 tick 无条件（空中也计）→ 跳频约 3×（曾只接 Disco 光，ai[0]+=2 缺）----
    if (this.vanillaId === 244) this.ai0 += 2;
    if (grasshopper) {
      // 蚱蜢（1457 :61479-61483）：玩家 200px 内且非 wet 才索敌（flag3 只关索敌，
      // 跳 machine 照跑——平静态也蹦跳，只是不追人）
      flag3 = !!player && !player.dead && !this.wet
        && Math.hypot(player.cx - this.cx, player.cy - this.cy) <= 200;
      // :62057-62066 localAI[2]<90 → ++，否则 friendly=false（90t 后转为敌对，
      // 可被仇恨/击杀计数系统按敌怪处理；原版 SetDefaults damage=0，翻转不带来
      // 接触伤害）
      if (this.lai2 < 90) this.lai2 += 1;
      else if (this.def.friendly) this.def = { ...this.def, friendly: false };
    }
    // ai[2] 卡墙冷却倒数（cs:61873-61876 `if (ai[2] > 1f) ai[2] -= 1f`——**只减到
    // 1 不归零**：0 仅首帧出现）。索敌时机 1:1（S 批 2026-08-19）：
    //  首帧 ai[2]==0 → ai[0]=−100、ai[2]=1、TargetClosest（:61926-61931）；
    //  每次起跳 flag3 且 ai[2]==1 → TargetClosest（:62042-62045，已接）；
    //  wet 且 ai[2]==1 且 flag3 → TargetClosest（:61920-61923，已接）。
    //  ★曾为"冷却归零后每帧重瞄"——金属矿史莱姆悬停段（:61133 direction=0）会被
    //  逐帧覆盖，且追踪硬度高于原版
    if (this.ai2 > 1) this.ai2 -= 1;
    if (this.ai2 === 0) {
      this.ai0 = -100;                                      // :61928
      this.ai2 = 1;                                         // :61929
      if (player) this.facing = this.seekDirX(player);      // :61930 TargetClosest
    }
    // ★R6-B 2-3：蚱蜢平静态曾走"0.2 慢爬不进跳循环"自造档——原版 flag3 只关索敌
    // （:62245 TargetClosest 门），跳 machine 照跑（平静也原地蹦跳），删 early-return
    const dir = this.facing;
    // 贴地门 = 原版字面 velocity.Y==0（1457 :62135 精确判）——碰撞后 vy（AI 时点
    // 重力未加，落地/贴地恒 0；顶头清零同取此门）。曾用 onGround：携物梯空中改 vy
    // 的档（:61309 气球弹跳 / :61139 金属悬停 / 云·石重力改写）会被误判贴地，跳段
    // 反冲掉梯段 vy。★R6-B 2-10：曾加 `inWater && |vy|<0.8` 慢浮近似——水中 wet 段
    // 每 tick vy=-2 → 原版恒走空中转向档（±0.2 步进钳 3），近似门令水中史莱姆多跑
    // 跳跃机，摘除
    const grounded = this.vy === 0;
    if (grounded) {
      // 落地嵌固回退（G5，:61932-61935）：上一 tick Y 碰撞（collideY）且碰撞前在
      // 动（oldVelocity.Y!=0，本仓 preCollideVy）而当前位置嵌进实心 → 后退
      // vx+direction 脱困（vx 通常已被碰撞清零 → 净退 1px/t 持续推出）
      // ★SW-BJ6 2026-09-07：置漂移活跃旗——unembedPass 本拍让位（vanilla 无
      //  unembed,该漂移即原版唯一嵌入自救通道）
      // ★SW-BJ9 2026-09-07：漂移步改经 applyUnwedgeDrift——「全程不进全实心」门 +
      //  episode 终止闩（刻意偏离原版：原版此通道会匀速相移穿墙,偏离声明在方法注）;
      //  嵌固判定链断开 → else 臂清 episode 闩,原版行为链自然继续
      if (this.collideY && this.preCollideVy !== 0
        && solidBoxOverlap(st, this.x, this.y, this.w, this.h)) {
        this.applyUnwedgeDrift(st, dir);
      } else if (this.unwedgeBlocked) {
        this.unwedgeBlocked = false;         // SW-BJ9：episode 锚清位（已离楔）
      }
      // 落地卡墙检测（1457 :62141-62146）：ai[3]==position.X 精确相等 = 白跳 →
      // 反转 + ai[2]=200（R6-B 2-5：曾用 |Δ|<1 容差）
      if (this.jumpStartX !== 0 && this.cx === this.jumpStartX) {
        this.facing *= -1;
        this.ai2 = 200;
      }
      this.jumpStartX = 0;                                   // ai[3] = 0（:62146）
      if (this.ai1 === 3609) {
        // 传送带史莱姆摩擦替换（:61938-61948）：不减速——恒向 direction 加速
        // ±0.1/t 钳 ±2.5（direction==0 走 else +0.1，原版字面）
        if (this.facing < 0) this.vx -= 0.1;
        else this.vx += 0.1;
        this.vx = Math.max(-2.5, Math.min(2.5, this.vx));
      } else {
        this.vx *= 0.8;                                              // :61948-61952 地面摩擦
        if (Math.abs(this.vx) < 0.1) this.vx = 0;
      }
      // ---- ai[0] 递增阶梯（S1，cs:61964-62016 全表 1:1，2026-08-19）----
      if (flag3) this.ai0 += 1;                                  // :61964-61967
      this.ai0 += 1;                                             // :61968
      const vidS = this.vanillaId ?? 0;
      if (vidS === 59 && !game.world.seedFlags?.remix) this.ai0 += 2;   // :61969-61972 岩浆史莱姆（★IIIII224 !remix 门 :62172）
      if (vidS === 71) this.ai0 += 3;                            // :61973-61976 地牢史莱姆
      if (vidS === 667) this.ai0 += 3;                           // :61977-61980 金史莱姆
      if (vidS === 138) this.ai0 += 2;                           // :61981-61984 微光史莱姆
      if (vidS === 183) this.ai0 += 1;                           // :61985-61988 猩红史莱姆
      if (vidS === 658) this.ai0 += 5;                           // :61989-61992 史后蓝仆从
      if (vidS === 659) this.ai0 += 3;                           // :61993-61996 史后粉仆从
      if (vidS === 304) this.ai0 += (1 - this.hp / this.maxHp) * 10; // :61997-62001 南瓜跳跳按损血 0-10
      if (grasshopper) this.ai0 += 3;                            // :62002-62005 蚱蜢 377/446
      if (vidS === 81) this.ai0 += (this.vanillaScale ?? 1) >= 0 ? 4 : 1; // :62006-62016 腐化史莱姆
      // num54 阶段基线表（S5，cs:62017-62025）：659 −500 / 667 −400 / 其余 −1000
      const num54 = vidS === 659 ? -500 : vidS === 667 ? -400 : -1000;
      // 阶段判定（L62029-62040）
      let stage = 0;
      if (this.ai0 >= 0) stage = 1;
      else if (this.ai0 >= num54 && this.ai0 <= num54 * 0.5) stage = 2;
      else if (this.ai0 >= num54 * 2 && this.ai0 <= num54 * 1.5) stage = 3;
      if (stage > 0) {
        if (flag3 && this.ai2 === 1 && player) this.facing = this.seekDirX(player); // :62042-62045 起跳前重瞄
        if (stage === 3) {
          // 大跳（L62055-62059）+ 59 岩浆史莱姆跳力加成（S4，:62049-62057）
          this.vy = -8;
          if (vidS === 59 && !game.world.seedFlags?.remix) this.vy -= 2;   // ★IIIII224 !remix 门 :62252
          this.vx += 3 * dir;
          if (vidS === 59 && !game.world.seedFlags?.remix) this.vx += 0.5 * dir;
          this.ai0 = -200;
        } else {
          // 小跳（L62062-62070）+ 59 追加 2*dir（:62065-62068）
          this.vy = -6;
          this.vx += 2 * dir;
          if (vidS === 59 && !game.world.seedFlags?.remix) this.vx += 2 * dir;   // ★IIIII224 !remix 门 :62268
          this.ai0 = stage === 1 ? -120 + num54 : -120 + num54 * 2;
        }
        // :62079-62083 659 粉仆从跳乘区（S5）
        if (vidS === 659) { this.vy *= 1.6; this.vx *= 1.2; }
        // :62084-62092 685 老旧颤抖宝箱（S10）——半跳力 + 1/2 概率反向
        if (vidS === 685) {
          this.vy *= 0.5;
          this.vx *= 0.2;
          if (Math.floor(Math.random() * 2) === 0) this.facing *= -1;
        }
        // :62093-62097 141 毒泥跳乘区（S6）
        if (vidS === 141) { this.vy *= 1.3; this.vx *= 1.2; }
        if (grasshopper) {
          // 蚱蜢（S8，1457 :62301-62315）：跳力衰减 + 激愤逃跑反转 + 头顶限高
          this.vy *= 0.9;
          this.vx *= 0.6;
          if (flag3) { this.facing *= -1; this.vx *= -1; }       // :62305-62308 激愤 = 反向逃跳
          const i2 = Math.floor(this.cx / TILE);
          const j2 = Math.floor(this.cy / TILE) - 1;
          if (st.inBounds(i2, j2) && st.isSolid(i2, j2)
            && -this.vy + this.h > 16) {
            this.vy = -(16 - this.h);                            // :62312-62314 顶上实心 → 限高
          }
        }
        // ai[3] = position.X（1457 :62262）——仅大跳（stage3）记录：小跳撞墙不反转
        // （要等大跳；曾所有 stage 都写 → 小跳撞墙即反转，R6-B 2-5）
        if (stage === 3) this.jumpStartX = this.cx;
      }
    } else if (player && ((dir === 1 && this.vx < 3) || (dir === -1 && this.vx > -3))) {
      // ---- 滞空转向（S3，cs:62120-62137）：目标存活（target<255）且未达方向满速 3
      //  → 朝 direction ±0.2/t 步进；逆向（含微同向）×0.93 衰减 ----
      // G5 贴角 1.4px 挪移（:62121-62123）：collideX（本仓 hitWall，上一 tick 位移段
      //  产物——与原版 AI 先于 UpdateCollision 的时序一致）且 |vx|==0.2（float 精确）
      //  → 后退 1.4px 卡角脱困。★触发窗说明：原版 |vx|==0.2 由共享碰撞段的
      //  clip-to-gap 语义产生（TileCollision :2454/:2472 result.X=墙距——贴墙爬行时
      //  钳到残余 0.2）；本仓 moveAxis 撞墙为贴齐+清零（TileCollision.ts:197-199，
      //  终位置与原版一致、仅存活 vx 值不同）→ 该精确值在本仓仅当碰撞后有他者把
      //  vx 写回 ±0.2 时可达，按原文字面 1:1 保留（G1 批同时废除的空中×0.98 尾段
      //  摩擦曾把存活值进一步抹掉）。1.4px 自我维持节奏（后退 1.4 → 0.2+0.4+0.6
      //  步进三 tick 后又钳 0.2）在 clip 语义缺失下不构成，登记。
      if (this.hitWall && Math.abs(this.vx) === 0.2) {
        this.x -= 1.4 * dir;
      }
      // 落地嵌固回退（G5，:62124-62127）——grounded 分支 :61932 同款（空中态版）
      // ★SW-BJ6 2026-09-07：置漂移活跃旗（同 grounded 支——vanilla :62331 滞空支）
      // ★SW-BJ9 2026-09-07：同贴地支改经 applyUnwedgeDrift（全实心门+episode 闩，
      //  刻意偏离原版,偏离声明在方法注）+ else 臂清 episode 闩
      if (this.collideY && this.preCollideVy !== 0
        && solidBoxOverlap(st, this.x, this.y, this.w, this.h)) {
        this.applyUnwedgeDrift(st, dir);
      } else if (this.unwedgeBlocked) {
        this.unwedgeBlocked = false;         // SW-BJ9：episode 锚清位（已离楔）
      }
      if ((dir === -1 && this.vx < 0.01) || (dir === 1 && this.vx > -0.01)) {
        this.vx += 0.2 * dir;                                     // :62130-62133
      } else {
        this.vx *= 0.93;                                          // :62134-62137
      }
    }
    // ---- 尖刺史莱姆（1457 :61753-61814：184 冰/:61816-61869 535 尖刺/:62000-62055
    //  204 丛林刺；R6-B 2-1/2-9 重写）。冷却 localAI[0]（本仓 ai3）在 type 块内
    //  【无条件】每 tick 递减（:61764/:61819/:62004，曾被 player/wet/onGround 门包住
    //  → 玩家死/入水/腾空时冷却冻结）。!wet + 目标存活门；CanHit（204 用抬升盒
    //  (x, y−20, w, h+20)）。两档为 if/else-if（184/535 :61774/:61796）或两段独立
    //  if（204 :62013/:62035）：专家近档 120（204 200）→ 五连扇 + 冷却 30（204 80）；
    //  否则 <200（204 400）→ 单发 + 冷却 50（204 65）——专家下 120-200px（204
    //  200-400px）仍走单发档（曾合并单门 → 专家中距完全不射击）。ai[0]=-40（204
    //  单发档 -80）+ vx×0.9 在【命中冷却期间同样每 tick 生效】（localAI[0] 只门弹体）。
    //  184/535 单发瞄准 = (玩家中心X−中心X, 玩家顶Y−中心Y−rand(0,200))，速 4.5、伤 9；
    //  204 单发 = (玩家左X−中心X−rand(−20,20), 玩家顶Y−中心Y−rand(−30,20)−距×0.05)，
    //  速 7、伤 13。
    const spiked = this.vanillaId === 184 || this.vanillaId === 535 || this.vanillaId === 204;
    if (spiked) {
      if (this.ai3 > 0) this.ai3 -= 1;                         // :61764/:61819/:62004 无条件递减
      // ★SW-BJ34 2026-09-08：尖刺三型射击头门补 `!npcTypeNoAggro[type]`
      //  （184=1457 :61768 / 535=:61823 / 204=:62007；1456 :61565/:61620/:61804）
      //  ——凝胶在身不蓄射。逐型覆盖：184/204 在 23 类表内=凝胶装着者禁射；
      //  535 不在表内（:14792-14814 无此型）→ 门原文即恒开,写上是为逐字 1:1。
      if (player && !player.dead && !this.wet && !npcTypeNoAggro(this.vanillaId, player)) {
        const expert = mainExpertMode(game.world);
        const is204 = this.vanillaId === 204;
        // 204 视线用抬升 20px 的碰撞盒（:62013/:62035 CanHit(new Vector2(x, y-20), w, h+20)）
        const sees = is204
          ? canHit(st, this.x, this.y - 20, this.w, this.h + 20, player.x, player.y, player.w, player.h)
          : this.canSeePlayer(st, player);
        const nearExpert = is204 ? 200 : 120;
        const nearSingle = is204 ? 400 : 200;
        const dp = Math.hypot(player.cx - this.cx, player.cy - this.cy);
        const fireSingle = (): void => {
          const proj = this.vanillaId === 184 ? 174 : is204 ? 176 : 605;
          let tx: number, ty: number, spd: number, dmg: number;
          if (is204) {
            ty = player!.y - this.cy - (Math.floor(Math.random() * 50) - 30) - dp * 0.05;
            tx = player!.x - this.cx - (Math.floor(Math.random() * 41) - 20);
            spd = 7; dmg = 13;
          } else {
            ty = player!.y - this.cy - Math.random() * 200;
            tx = player!.cx - this.cx;
            spd = 4.5; dmg = 9;
          }
          this.shootDart(game, this.cx, this.cy, tx, ty, spd, dmg, proj);
          this.ai3 = is204 ? 65 : 50;                          // :62051 / :61792/:61810
        };
        if (expert && dp < nearExpert && sees && this.vy === 0) {
          this.ai0 = -40;                                      // :61776/:61831/:62015
          this.vx *= 0.9;                                      // :61779/:61834/:62018
          if (this.ai3 === 0) {
            // 五连扇（:61783-61793 / :61838-61848 / :62022-62032）
            const proj = this.vanillaId === 184 ? 174 : is204 ? 176 : 605;
            for (let k = 0; k < 5; k++) {
              let fx = (k - 2) * (1 + (Math.floor(Math.random() * 101) - 50) * (is204 ? 0.02 : 0.005));
              let fy = (is204 ? -2 : -4) * (1 + (Math.floor(Math.random() * 101) - 50) * (is204 ? 0.02 : 0.005));
              const fl = Math.hypot(fx, fy) || 1;
              const spd = (is204 ? 3 : 4) + (Math.floor(Math.random() * 101) - 50) * 0.01;
              fx = (fx / fl) * spd; fy = (fy / fl) * spd;
              const dmg = getAttackDamageForProjectiles(is204 ? 13 : 9, is204 ? 13 : 9, this.difficulty);
              this.spawnHostileProj(game, this.cx, this.cy, fx, fy, dmg, proj);
              this.ai3 = is204 ? 80 : 30;                      // :61792/:61847/:62031
            }
          }
        } else if (!is204 && dp < nearSingle && sees && this.vy === 0) {
          // 184/535 else-if 单发档（:61796-61813）：专家中距 120-200 也走此档
          this.ai0 = -40;
          this.vx *= 0.9;
          if (this.ai3 === 0) fireSingle();
        } else if (is204 && dp < nearSingle && sees && this.vy === 0) {
          // 204 第二段为独立 if（:62035-62054）：ai[0]=-80 压跳
          this.ai0 = -80;
          this.vx *= 0.9;
          if (this.ai3 === 0) fireSingle();
        }
      }
    }
    // ---- 史后仆从凝胶弹（cs:61668-61796：658 蓝 / 659 粉）。门 = |ΔX|<500 且
    // |ΔY|<550 且 CanHit 且 velocity.Y==0（cs:61683/:61717/:61763）；冷却 ai3。
    // 经典档：瞄准 Y 上抬 rand(0,200)，基速 (4.5/距)×2，>350 ×2（658）/×1.75（659）、
    // >250 ×1.5（658）/×1.25（659）；伤 MultiLerp(15,17,20)；冷却 50（658）/40（659）。
    // 专家档（658 且 CountNPCS(658)<5，cs:61683-61715）：三星连发 (m−1,−4) 归一 ×6±0.5
    // 同距离增益、冷却 25、连发内计数超 4 即断。659 专家仅冷却 30（:61787-61790）。
    const queenMinion = this.vanillaId === 658 || this.vanillaId === 659;
    if (queenMinion) {
      if (this.ai3 > 0) this.ai3 -= 1;                         // :61874-61876/:61954-61956 无条件递减
      // ★SW-BJ34 2026-09-08：射击头门补 `!npcTypeNoAggro[type]`（1457 :61878/:61958；
      //  1456 :61675/:61755）——逐字 1:1（658/659 不在 23 类表内 → 门原文即恒开）。
      if (player && !player.dead && !this.wet && this.vy === 0
        && !npcTypeNoAggro(this.vanillaId, player)) {
        const mdx = player.cx - this.cx;
      const mdy = player.cy - this.cy;
      const mdist = Math.hypot(mdx, mdy);
      const expertQ = mainExpertMode(game.world);
      const cnt = this.vanillaId === 658
        ? (game.enemies() as Enemy[]).filter((o) => !o.dead && o.vanillaId === 658).length : 0;
      if (Math.abs(mdx) < 500 && Math.abs(mdy) < 550 && this.ai3 === 0
        && this.canSeePlayer(st, player)) {
        this.ai0 = -40; // 压制下一跳（cs:61685/:61720/:61765）
        this.vx *= 0.9;
        const dmgQ = this.projDmgMultiLerp(15, 17, 20);           // :61707/:61742/:61791 MultiLerp(15,17,20)
        if (this.vanillaId === 658 && expertQ && cnt < 5) {
          // 三星连发（:61692-61714）
          for (let m = 0; m < 3; m++) {
            let fx = (m - 1) * (1 + (Math.floor(Math.random() * 101) - 50) * 0.005);
            let fy = -4 * (1 + (Math.floor(Math.random() * 101) - 50) * 0.005);
            const fl = Math.hypot(fx, fy) || 1;
            let spd = 6 + (Math.floor(Math.random() * 101) - 50) * 0.01;
            if (mdist > 350) spd *= 2;
            else if (mdist > 250) spd *= 1.5;
            this.spawnHostileProj(game, this.cx, this.cy, (fx / fl) * spd, (fy / fl) * spd,
              dmgQ, 920);
            this.ai3 = 25;                                       // :61709
            if (cnt + m > 4) break;                              // :61710-61713
          }
        } else {
          const aimY = player.y - this.cy - Math.random() * 200;   // :61727/:61772
          let k = (4.5 / (Math.hypot(mdx, aimY) || 1)) * 2;        // :61729-61730 ×2
          if (mdist > 350) k *= this.vanillaId === 658 ? 2 : 1.75; // :61731-61738/:61776-61783
          else if (mdist > 250) k *= this.vanillaId === 658 ? 1.5 : 1.25;
          // 920/921 均为 aiStyle 1 弹跳凝胶弹（Projectile.cs:8443-8457）；本仓敌弹出口
          // 统一 grav 0 直飞（shoot），上抛补偿已含在瞄准点
          shoot(game, this.cx, this.cy, mdx * k, aimY * k, dmgQ, this.vanillaId === 658 ? 920 : 921, 240);
          this.ai3 = this.vanillaId === 658 ? 50 : (expertQ ? 30 : 40); // :61741/:61786-61790
        }
      }
      }
    }
    // ---- wet 浮力段（cs:61877-61935 1:1，替换旧 groundPhysics buoyant 近似）----
    // 纵向碰撞(上帧 collideY) → vy=-2 上弹；上浮中 X 原地未动 → 掉头 + ai[2]=200 冷却；
    // vy>2 ×0.9、恒 -0.5 上浮、钳 -4（59 岩浆史莱姆钳 -10 且 directionY<0 追加 -0.8）
    // ——史莱姆在水中以弹跳方式漂浮，贴面上下起落（collideY 读的是上一 tick 碰撞，
    // 与原版 AI 先于 UpdateCollision 的时序一致）
    if (this.wet) {
      if (this.onGround || this.hitHead) this.vy = -2;
      if (this.vy < 0 && this.slimeWetX === this.x) {
        this.facing *= -1;
        this.ai2 = 200;
      }
      if (this.vy > 0) this.slimeWetX = this.x;
      // ★IIIII224（NPC.cs:62095）：59 水中上浮臂带 !remix 门——remix 岩浆史莱姆不泳
      if (this.vanillaId === 59 && !game.world.seedFlags?.remix) {
        if (this.vy > 2) this.vy *= 0.9;
        else if (this.dirY < 0) this.vy -= 0.8;
        this.vy -= 0.5;
        if (this.vy < -10) this.vy = -10;
      } else {
        if (this.vy > 2) this.vy *= 0.9;
        this.vy -= 0.5;
        if (this.vy < -4) this.vy = -4;
      }
      if (this.ai2 === 1 && flag3 && player) this.facing = this.seekDirX(player);
    }
    // 重力+碰撞（原版共享位移段 :91533-91547；水中位移减速由 wet→liqFactor 统一承担）
    this.groundPhysics(game);
    // AI_001 尾部颜色渐变（NPC.cs:60971 起为 slime(type 1) 专属段；
    // 此前误挂在 zombieAI——守卫 vanillaId!==1 使其全程空转，移回 slimeAI）
    this.slimeColorTick(game);
    // ---- SlimeCanContainItems 三处 ai[1] 物品变体光（NPC.cs:60737/:61152/:61289）----
    // 放染色后与原版同序（:61152 读渐变后的 this.color）。:60740 同段 dust 228 星尘
    // （1/12 帧闪烁上飘）未接——repo 粒子桶无 dust 228 语义，登记
    if (this.ai1 === 75 && this.vanillaId === 1) {
      // :60737-60740 type1 携 29 生命水晶：num=0.3 → (0.24,0.21,0.03) @ 中心格
      this.mergeLightRGB([0.8 * 0.3, 0.7 * 0.3, 0.1 * 0.3]);
    } else if (this.ai1 === 364 || this.ai1 === 1104 || this.ai1 === 365
      || this.ai1 === 1105 || this.ai1 === 366 || this.ai1 === 1106) {
      // :61152 金属矿史莱姆（钴/钯金/秘银/山铜/精金/钛金）：this.color 各通道/500
      // @ position（顶左格，非中心）——lavaImmune/防御+30/伤害×3/悬浮重力等行为段
      // （:61095-61155）属 AI_001 行为侧，本批只接光位
      const c = this.colorRGBA ?? [0, 0, 0, 0];
      this.mergeLightRGB([c[0] / 500, c[1] / 500, c[2] / 500], { x: this.x, y: this.y });
    } else if (this.ai1 === 314) {
      // :61289 草药史莱姆 (0.4,0.9,1) @ 中心格（尘 41 每帧闪烁 :61285 未接，登记）
      this.mergeLightRGB([0.4, 0.9, 1]);
    }
  }

  /** 原版 UpdateNPC_UpdateGravity（NPC.cs:91876-91953）通用重力档 1:1：
   *  ⓪ per-type 覆写表（:91882-91922）：258 真菌瓢虫缓降 0.1/钳 3；425 漩涡步枪兵
   *     飞行态（ai[2]==1）0.1；576/577 食人魔俯冲态（ai[0]>0 且 ai[1]==2）0.45/
   *     钳 32；427 漩涡蜂飞行态（ai[2]==1）0.1/钳 4；426 漩涡蜂后恒 0.1/钳 3；
   *     541 沙元素 0（AI_102 walker 内自管 0.1 档，尾段只钳不坠）——原表在通用
   *     重力段而非各自 AI（2026-08-20 生物物理 review 补全，曾误登记"AI 自带档"）；
   *  ① 高空衰减（:91916-91934）：num=(maxTilesX/4200)²、num2=(y/16−(60+10·num))/
   *     (worldSurface/6) 钳 [0.25,1] → gravity×num2——空岛/太空高度下落明显变缓
   *     （worldSurface=world.groundLevel，LunarEvent.ts:143 同源换算）；
   *  ② wet 三档（:91936-91952）：0.2(水)/0.1(蜜)/0.15(微光)——原版为绝对值直替
   *     （覆盖①的高空系数），照抄 TownNPC.ts:1200 先例；落速帽 7/4/5.5 已由
   *     npcLiquid.ts 第 6 段每 tick 钳，此处不重复。
   *  基数 = ENEMY_GRAVITY 0.3（NPC.cs:6026，2026-08-20 史莱姆跳跃高度/距离
   *  对齐批换正——曾误用玩家 GRAVITY 0.4：跳跃矮 25%、滞空/距离短 25%）；
   *  wet 档取原版绝对值（0.2/0.1/0.15）直替。 */
  applyGravity(game: GameHooks) {
    let g = ENEMY_GRAVITY;
    let fallCap = MAX_FALL_SPEED;
    // ⓪ per-type 覆写表（:91882-91922，else-if 同序；258/426 的 vy 钳在重力前生效）
    const vid = this.vanillaId;
    if (vid === 258) {
      g = 0.1;
      if (this.vy > 3) this.vy = 3;
    } else if (vid === 425 && this.ai2 === 1) {
      g = 0.1;
    } else if ((vid === 576 || vid === 577) && this.ai0 > 0 && this.ai1 === 2) {
      g = 0.45;
      if (this.vy > 32) this.vy = 32;
    } else if (vid === 427 && this.ai2 === 1) {
      g = 0.1;
      if (this.vy > 4) this.vy = 4;
    } else if (vid === 426) {
      g = 0.1;
      if (this.vy > 3) this.vy = 3;
    } else if (vid === 541) {
      g = 0;
    }
    // ★BJ704-G6 R3-P2④（2026-10-21 判语销案+完备性备注,勿落死码）：原表此处还有
    //   `else if (aiStyle == 7 && ai[0] == 25f) gravity = 0f`（NPC.cs:92036-92038）
    //   ——ai[0]==25 = GetShimmered ShimmerTownTransform 微光上升态（:92695-99
    //   唯一 setter,城镇 NPC 专属）。Enemy 域不可达：①敌怪侧 aiStyle7=critter 42 型
    //   （城商族走 TownNPC 桶）,townCritterWalkAI 头 ai0 钳 0..8 恒不达 25;
    //   ②TownNPC 独立类已移植该档（TownNPC.ts 微光上升臂重力=0,注释锚
    //   UpdateNPC_UpdateGravity）。补入本表=死码,不入。
    // ① 高空衰减（worldSurface/6 与 (60+10num) 为原版双参，浮点同式；
    //    groundLevel<=0 的手工/测试世界无地表线 → 视作全重力，防 ÷0/NaN）
    const surf = game.world.groundLevel;
    if (surf > 0) {
      const num = (game.world.store.w / 4200) ** 2;
      let alt = (this.y / TILE - (60 + 10 * num)) / (surf / 6);
      if (alt < 0.25) alt = 0.25;
      else if (alt > 1) alt = 1;
      g *= alt;
    }
    // ② wet 三档（绝对值直替，覆盖高空系数——原版同序）
    if (this.wet) { g = this.shimmerWet ? 0.15 : this.honeyWet ? 0.1 : 0.2; fallCap = this.shimmerWet ? 5.5 : this.honeyWet ? 4 : 7; }
    this.vy = Math.min(this.vy + g, fallCap);
  }

  private zombieAI(game: GameHooks, player: Player | null) {
    // 卡墙脱困：朝玩家走却持续撞墙（高墙跳不过去）→ 掉头往另一侧探索
    if (this.onGround && this.hitWall && player) {
      if (++this.stuckT > 80) {
        this.stuckT = 0;
        this.stuckCd = 90; // 掉头冷却：期间不再朝玩家折返
      }
    } else if (!this.hitWall) {
      this.stuckT = 0;
    }
    if (this.stuckCd > 0) this.stuckCd--;
    let dir = this.facing;
    if (player && this.stuckCd === 0) {
      dir = Math.sign(player.cx - this.cx) || 1;
      // 跳过障碍
      if (this.onGround && this.hitWall) this.vy = -6;
      // 门：会尝试跳，不做开门
    } else if (this.hitWall && this.onGround) {
      dir = -this.facing; // 掉头期间撞墙就反向
    }
    this.facing = dir;
    this.vx += dir * 0.08;
    this.vx = Math.max(-0.9, Math.min(0.9, this.vx));
    // ±0.9 帽在调用方自带（legacy 兜底 AI 的自有档；groundPhysics G1 批起零钳
    // 零摩擦——空中 vx 保持原样，同原版 AI_003 空中无摩擦语义）
    this.groundPhysics(game);
    this.slimeColorTick(game); // 守卫 vanillaId!==1：僵尸走此路径为 no-op（1:1）
  }

  // ---- AI_001 颜色渐变（NPC.cs:60971-61105）：每 tick (c*19+target)/20 向目标色靠拢 ----
  // 优先级（:60971-60984）：底边下方一格踩到油漆（color>0 且 !=30 负相）→ 向油漆色 lerp
  //  （flag 置位，体内物品色本轮不生效）；无油漆时才回落 ai[1] 体内物品目标色表。
  private static SLIME_ITEM_COLORS: Record<number, [number, number, number, number]> = {
    751: [185, 235, 255, 100], 2: [169, 125, 93, 150], 3: [128, 128, 128, 150], 9: [229, 149, 93, 150],
    150: [193, 202, 203, 100], 3086: [59, 28, 136, 150], 3081: [138, 145, 170, 150], 147: [189, 159, 139, 150],
    29: [220, 36, 117, 125], 3609: [232, 172, 162, 150], 3736: [255, 66, 152, 125], 3737: [179, 132, 255, 125],
    3738: [0, 206, 180, 125], 1345: [200, 200, 200, 50], 5395: [198, 72, 12, 150], 1124: [255, 158, 49, 150],
    1125: [255, 156, 12, 150], 314: [79, 163, 241, 75], 364: [37, 118, 172, 100], 1104: [227, 52, 14, 100],
    365: [22, 119, 125, 100], 1105: [205, 30, 199, 100], 366: [173, 15, 13, 100], 1106: [91, 90, 119, 100],
  };

  private slimeColorTick(game: GameHooks) {
    if (this.vanillaId !== 1 || !this.colorRGBA) return;
    // ---- 踩油漆扫描（NPC.cs:60973-60983）----
    // j 自 floor(Left.X/16) 至 floor(Right.X/16)（含端点，跨格史莱姆每格各 lerp一次）；
    // num10 = floor((Bottom.Y+1)/16)（底边下一格）；门槛 = SolidTile3（:70470-70489
    // active && !inActive && tileSolid && !tileSolidTop）&& color>0 && color!=30（负相不吃）
    const st = game.world.store;
    let flag = false;
    const ty = Math.floor((this.y + this.h + 1) / TILE);
    for (let j = Math.floor(this.x / TILE); j <= Math.floor((this.x + this.w) / TILE); j++) {
      // ★A-5 边带（2026-09-04）：SolidTile3(j,num10)（NPC.cs:61178 坐标重载）首门
      // InWorld(·,1)（WorldGen.cs:71006-71008）——世界最外一圈不踩漆不变色
      if (!st.inWorld1(j, ty)) continue;
      const i = st.idx(j, ty);
      const t = st.type[i];
      // SolidTile3：非活性格/已致动/非实心/平台（tileSolidTop）都不算立足点
      if (!(st.flags[i] && t !== 0)) continue;
      if (st.wire[i] & 32) continue;                       // inActive（致动缩入）
      const d = TILE_DEFS[t];
      if (!d?.solid || d.platform) continue;
      const pc = st.paint[i];
      if (pc > 0 && pc !== 30) {
        const c = paintColor(pc);                          // WorldGen.paintColor :60979
        for (let k = 0; k < 3; k++) this.colorRGBA[k] = (this.colorRGBA[k] * 19 + c[k]) / 20;
        this.colorRGBA[3] = (this.colorRGBA[3] * 19 + 100) / 20; // :60980 alpha 目标恒 100
        flag = true;
      }
    }
    // ---- 体内物品色（NPC.cs:60984-61086：ai[1]>0 且本轮无踩漆才生效） ----
    if (this.ai1 <= 0 || flag) return;
    const t = Enemy.SLIME_ITEM_COLORS[this.ai1];
    if (!t) return;
    for (let k = 0; k < 3; k++) this.colorRGBA[k] = (this.colorRGBA[k] * 19 + t[k]) / 20;
    this.colorRGBA[3] = (this.colorRGBA[3] * 19 + t[3]) / 20;
  }

  /** AI_003_Fighters 通用核（NPC.cs:24559-24733，剥离 per-type 特例）：
   *  前方 tile 探测 + 四级跳（2 格墙 -8 / 1 格墙 -7 / 卡半格 -5 / 前方悬空且目标在上 -8 加速），
   *  加速度 0.1、最大速度 1.0（原版 num1/num2 常量），门/高门交互待移植 */
  /** AI_092 训练假人（NPC 488，NPC.cs:39196-39214;★旧锚 :40871-40914 为 1456 行段）：
   *  静止站立于锚定 tile（tile 378，
   *  ai0/ai1 = 锚点 tile 坐标）；锚 tile 被破坏 → 消失。受击显示伤害数字+播声音+
   *  摇晃动画（shake = clamp(dmg,20,120)，帧由渲染层读取），永不死亡（immortal）。 */
  doorWarm = 0;            // 攻门蓄势（AI_003 ai[2]：门前每 tick +1，满 60 一击后归零）
  doorHit = 0;             // 攻门累计（AI_003 ai[1]：每击 +5[388 +2/27 +1/31 族 +6]，≥10 开门）
  dummyShake = 0;          // localAI[0]：受击摇晃强度（20..120，每 tick -1）
  dummyHitDir = 0;         // localAI[1]：受击方向
  dummyAnchor: [number, number] | null = null;  // ai[0]/ai[1]：tile 378 锚点
  /** 实例级受击音覆写（原版 NPC.HitSound 本就是实例字段,SetDefaults 赋默认值;
   *  本仓 def.hitSound 是按型共享档——488 假人 AI 每 tick 重卷需实例槽承接,
   *  非空时 playEnemyHitSound 优先消费。勿写回 def(会串到同型所有实例)! */
  hitSoundOverride: string[] | null = null;
  /** DoT 直扣统一结算（GetHurtByDebuff :92986-93006 1:1）：
   *  ①immortal 守卫——不扣血/不拉血条/不触发死亡（训练假人 488 曾被三条 DoT 裸扣
   *    hp 又被 dummyAI 回满=闪烁血条，2026-09-02 用户实报）；
   *  ②realLife 重定向——共享血池族（毁灭者/幻影龙/血鳗鱼）打节段=扣头血池
   *    （:92991-92993 num=realLife≥0?realLife:whoAmI;曾直扣节段 hp=下次 hurt 被
   *    头池覆盖,DoT 白打）；血条照拉（头池<max 即出条,节段无条由 wormFollow 门）。
   *  飘值【无条件】由调用侧保留（原版 LifeRegenNegative 对 immortal 同样出字）。 */
  private applyDoT(n: number, game: GameHooks): void {
    if (this.immortal) return;
    if (this.realLifeHost && !this.realLifeHost.dead) {
      this.realLifeHost.hp -= n;
      this.hp = this.realLifeHost.hp;
    } else {
      this.hp -= n;
    }
    this.hpBarT = 240;
    if (this.hp <= 0) this.hurt(9999, 0, 0, game);
  }

  private dummyAI(game: GameHooks) {
    const st = game.world.store;
    const [ax, ay] = this.dummyAnchor ?? [-1, -1];
    // 锚 tile 378 消失 → 失活（1457 NPC.cs:39221-39223 `(!active() || type != 378)`——
    //   active() 位本体读 hasTile。红蓝对抗 F5：曾漏该门只查 type，幽灵残型 378 锚误判存活）
    if (ax < 0 || !st.inBounds(ax, ay)
      || !st.hasTile(ax, ay) || st.type[st.idx(ax, ay)] !== DUMMY_TILE_ID) {
      this.dead = true;
      return;
    }
    // 受击音重卷（AI_092 头段 cs:39196-39212）：每 tick Next(20)==0 → 在
    // {NPCHit15,16,17} 重卷实例 HitSound——假人被连打时音色逐击漂移的原版语义。
    // （Next(15,18)=15/16/17 三均分;播报单点在 Enemy.hurt→playEnemyHitSound,
    //   该处读本槽优先于 def.hitSound）
    if (Math.floor(Math.random() * 20) === 0) {
      this.hitSoundOverride = [`NPC_Hit_${15 + Math.floor(Math.random() * 3)}`];
    }
    // 摇晃衰减（FindFrame 488 分支 cs:71522-71527：>24 钳 24 是【字段写入】——
    // 命中侧存 clamp(dmg,20,120)（cs:83498-83507），帧机每拍先钳 24 再 -1，
    // 净效果=计时器恒 20..24。曾漏钳 → 大伤害命中 shake=100 时
    // ceil(100/4)=25 帧号越界被 min(frames-1) 钳到末帧并卡 ~76 tick（用户报
    // "连射卡在错误帧,停火才播完后续帧"）
    if (this.dummyShake > 24) this.dummyShake = 24;
    if (this.dummyShake > 0) this.dummyShake--;
    // 静止：仅重力站立
    this.applyGravity(game);
    this.vx = 0;
    moveAndCollide(this, game.world, this.vx, this.vy);
    this.hp = this.maxHp; // immortal：血量恒满（cs:14535 lifeMax=1000 + immortal）
  }

  /** UpdateNPC_CastLights（NPC.cs:93520-93603）敌怪侧两段：发光蘑菇族闪烁蓝光 +
   *  44 不死矿工头盔灯。城镇 NPC 段（160 松露 / 209 电子人）归 TownNPC 实体不在此。
   *  蘑菇族（:93576-93588）：num9 = Next(28,42)×0.005 + (270−mouseTextColor)/500，
   *  基色 (0.1, 0.3+num9/2, 0.6+num9) × num13（634 孢子蝙蝠 0.65，其余 0.35）。 */
  private updateNpcCastLights() {
    const vid = this.vanillaId;
    if (vid === null) return;
    if ((vid >= 254 && vid <= 261) || vid === 634 || vid === 635) {
      const num9 = (28 + Math.random() * 14) * 0.005 + (270 - mouseTextColorApprox()) / 500;
      const num13 = vid === 634 ? 0.65 : 0.35;
      this.mergeLightRGB([0.1 * num13, (0.3 + num9 / 2) * num13, (0.6 + num9) * num13]);
      // 256 菌鱼与 AI_018 水母光（cs:24276）原版同帧叠加——单槽逐通道 max
    } else if (vid === 44) {
      // :93599-93602 不死矿工：(0.9, 0.75, 0.5) @ (position.x+w/2, position.y+4)
      this.lightRGB = [0.9, 0.75, 0.5];
      this.lightRGBAt = { x: this.cx, y: this.y + 4 };
    }
  }

  /** UpdateNPC_UpdateTrails TrailingMode==4（NPC.cs:91825-91841）：120 混沌元素 /
   *  137 荧光蝠 / 138 荧光史莱姆——循环体内在 position（顶左格）加 (0.3,0,0.2)。 */
  private updateNpcTrailLights() {
    const vid = this.vanillaId;
    if (vid !== 120 && vid !== 137 && vid !== 138) return;
    this.lightRGB = [0.3, 0, 0.2];
    this.lightRGBAt = { x: this.x, y: this.y };
  }

  /** debuff 自发光（NPC.cs:92263-92667 UpdateNPC_BuffApplyVFX,DrawNPC 前的 buff 视效段
   *  ——★BJ449 勘误 2026-10-03:旧引 :92181-92467 系 GetNPCColorTintedByBuffs 染色块
   *  行号错挂 VFX 函数;AddLight 实位 onFire :92367/onFire3 :92384/daybreak :92400/
   *  betsysCurse :92415/onFrostBurn :92600/onFrostBurn2 :92616/onFire2 :92632）：
   *  onFire/onFire3/
   *  daybreak/onFire2(诅咒焰) (1,0.3,0.1)、betsysCurse (0.6,0.1,0.9)、onFrostBurn/
   *  onFrostBurn2 (0.1,0.6,1)。位置 = (position.x, position.y+16)。原版同帧可与
   *  type 光叠加；本仓单槽 → 逐通道 max 合并（AI 已写 lightRGBAt 时不挪光源位） */
  /** 单槽点光的通道 max 合并：AI 已写 lightRGB 时逐通道取大（原版 AddLight 可同帧
   *  叠加，单槽下 max 最接近视觉并集）且不挪既有 lightRGBAt；空槽则直接写入 */
  private mergeLightRGB(rgb: [number, number, number], at?: { x: number; y: number }) {
    if (this.lightRGB) {
      this.lightRGB = [
        Math.max(this.lightRGB[0], rgb[0]),
        Math.max(this.lightRGB[1], rgb[1]),
        Math.max(this.lightRGB[2], rgb[2]),
      ];
    } else {
      this.lightRGB = rgb;
      if (at) this.lightRGBAt = at;
    }
  }

  private updateNpcDebuffLights() {
    let bl: [number, number, number] | null = null;
    if (this.onFireT > 0 || this.onFire3T > 0 || this.daybreakT > 0 || this.cursedT > 0) {
      bl = [1, 0.3, 0.1];
    }
    if (this.frostburnT > 0 || this.frostburn2T > 0) {
      bl = bl ? [Math.max(bl[0], 0.1), Math.max(bl[1], 0.6), Math.max(bl[2], 1)] : [0.1, 0.6, 1];
    }
    if (this.betsysCurseT > 0) {
      bl = bl ? [Math.max(bl[0], 0.6), Math.max(bl[1], 0.1), Math.max(bl[2], 0.9)] : [0.6, 0.1, 0.9];
    }
    if (bl) this.mergeLightRGB(bl, { x: this.x, y: this.y + 16 });
  }

  /** 火把僵尸 590/591 手持火把点光（NPC.cs:57309-57366，AI_003 内 type 段 1:1）。
   *  590：光源格 = floor((Center.x + dir 偏移)/16)，y 取 floor((y+6)/16)；火把格与
   *  相邻格（dir 侧）液体均须为 0。591（持械专家变体）：!wet 即亮，偏移 ±36/±28、
   *  y+24。色均 (1, 0.95, 0.8)；尘 6 号 1/30（591 另有 ai[2]==0 门）。 */
  private torchZombieLight(game: GameHooks) {
    const st = game.world.store;
    if (this.vanillaId === 590) {
      const ty = Math.floor((this.y + 6) / TILE);
      const left = this.facing < 0;           // 原版 spriteDirection < 0
      const tx = Math.floor((this.cx + (left ? -22 : 14)) / TILE);
      const near = left ? tx + 1 : tx - 1;
      if (!st.inBounds(tx, ty) || !st.inBounds(near, ty)) return;
      if (st.liquid[st.idx(tx, ty)] !== 0 || st.liquid[st.idx(near, ty)] !== 0) return;
      this.lightRGB = [1, 0.95, 0.8];
      this.lightRGBAt = { x: tx * TILE, y: ty * TILE };
      if (Math.random() * 30 < 1) {
        game.spawnParticles(this.cx + (left ? -22 : 14), this.y + 6, '#C87830', 1, 0.3, { life: 20 });
      }
      return;
    }
    // 591：wet 门（原版 Collision.WetCollision ≈ 中心格 liquid>20 近似）+ ai[2]==0 尘门
    const tx2 = Math.floor(this.cx / TILE), ty2 = Math.floor(this.cy / TILE);
    if (st.inBounds(tx2, ty2) && st.liquid[st.idx(tx2, ty2)] > 20) return;
    const left2 = this.facing < 0;
    this.lightRGB = [1, 0.95, 0.8];
    this.lightRGBAt = { x: this.cx + (left2 ? -36 : 28), y: this.y + 24 };
    if (this.ai2 === 0 && Math.random() * 30 < 1) {
      game.spawnParticles(this.cx + (left2 ? -36 : 28), this.y + 24, '#C87830', 1, 0.3, { life: 20 });
    }
  }

  /** 游泳化三族 wet 分支 1:1 —— 461 深海水怪 / 586 僵尸人鱼（AI_003 cs:56361/:56486）
   *  与 620 地精鲨（AI_107 flag27 cs:64300-64336，参数 num28/29/30=5/3/8、
   *  amount/2/3=0.05/0.04/0.1 与 461 同表）。共用结构：
   *   wet：kbResist=0、ai[3]=-0.10101（出水加速哨兵）、noGravity（本仓=跳过重力）、
   *     461 另缩盒 18×40→34×24（Center 保持）；collideX → vx=-oldVx；direction 跟 vx
   *     （620 原文是 `direction=Math.Sign(direction)` 无操作怪癖 → 保持）；
   *     有视线 → Lerp 向玩家（461/620 速 5 系数 1/20；586 速 clamp(1+|dy|/40,5,20)、
   *     vy>0 系数 1/30 否则 1/5）；无视线 → 巡航 (dir,−1) 归一 ×(5|3|8)，
   *     3 档（下坠）Lerp 1/25、5/8 档 Lerp 1/10。
   *   dry：461 复原 kbResist=0.4（难度曲线）+缩盒复原；461/586 在 ai[3]==哨兵时
   *     出水冲量：|v|×2 钳 10（586 钳 15）沿原方向。
   *  移动：本仓各 AI 自带积分——wet 时经 moveAndCollide 走 liqFactor（461/586 水 0.5；
   *  620 DD2 全速 1），与原版 UpdateCollision 语义一致。
   *  @returns true = 本 tick 已接管（调用方跳过行走/重力） */
  /** 美杜莎 480 蓄力石化（NPC.cs AI_003_Fighters 前置段，1458 :56932-57140 = 台账
   *  "P.cs:56751-56889" 的 1456 行号锚；2026-08-31 清偿段序）。返回 true = 本 tick
   *  接管。原版块位于通用行走【之前】：冷却态只递减 ai[2] 后照常落通用行走（本仓
   *  返回 false 放行同构）；蓄力两段均以 return 终止本拍 AI——不跑行走加速,重力/
   *  碰撞由 UpdateMovement 承担（本仓以 applyGravity+moveAndCollide 复刻,曾裸
   *  x+=vx 无碰撞积分+行走先跑=段序偏差，见 fighterAI 调用点注）。
   *  ai2 语义：>0 冷却递减 / 0 待机判定起手 / <0 蓄力（-(num23+num25)→0）；蓄力两段
   *  均阻尼 vx 0.9，被挑空(|vy|超阈)或受击打断回 num21；走完回 num22。
   *  低血(<1/3)：num21 180→120 / num22 300→240 / num23 180→240 / num24 60→90。
   *  发石化窗（ai2 ≥ -num23 段）：双相对视 + 距<700 + (贴脸<30 或 45°锥) + 三路视线
   *  任一通 → AddBuff(156, num24+剩余蓄力)（:57018-57024）——变身伤害/死因在 Player 过渡段 */
  private medusaChargeStep(game: GameHooks, player: Player): boolean {
    const lowHp = this.hp < this.maxHp / 3;
    const num21 = lowHp ? 120 : 180;   // 打断冷却
    const num22 = lowHp ? 240 : 300;   // 放完冷却
    const num23 = lowHp ? 240 : 180;   // 发石化窗长度
    const num24 = lowHp ? 90 : 60;     // buff 基础时长
    const num25 = 20;                  // 起手辉光段
    if (this.ai2 > 0) {
      this.ai2 -= 1;
    } else if (this.ai2 === 0) {
      // 待机起手判定（1458 :56957-56966）：正对玩家 + 站地 + <900 +
      // CanHit(Center,1,1,targetCenter,1,1)——中心 1px 盒视线（2026-08-31 换精确式,
      // 曾 losClear 逐格塔线近似）
      const facing = (player.cx < this.cx && this.facing < 0) || (player.cx > this.cx && this.facing > 0);
      if (facing && this.vy === 0 && Math.hypot(player.cx - this.cx, player.cy - this.cy) < 900
        && canHit(game.world.store, this.cx, this.cy, 1, 1, player.cx, player.cy, 1, 1)) {
        this.ai2 = -(num23 + num25);
      }
    } else {
      // 蓄力两段（:56973-57040 起手辉光 / :57041-57040 尾 发石化窗）：打断/推进
      this.vx *= 0.9;
      if (this.vy < -2 || this.vy > 4 || this.justHitT > 0) {
        this.ai2 = num21;
      } else {
        this.ai2 += 1;
        if (this.ai2 === 0) this.ai2 = num22;
      }
      this.lightRGB = [0.9, 0.75, 0.1];          // :56816/:56820 蓄力点光——曾误写 0-255 标度致 254× 过曝
      const rem = this.ai2 + num23 + num25;      // 起手辉光段计时（:56996 num26）
      if (rem === 1) game.playSfxFile?.('Item_17', 1, this.cx, this.cy); // SoundID 4-17(充能)
      if (rem < num25) {
        // 充能尘（1458 :56999-57011 尘 228 头顶环;num26<num25 含首 tick 0）：
        // 锚 = Top+(spriteDirection×6,6)；单位向量 UnitY.RotatedByRandom(2π)×
        // (r×0.5+0.5)，offset=v×Lerp(20,30,(rem×3+50)/182)、velocity=v×2、
        // scale=0.5+r×0.5、noGravity——2026-08-31 由 spawnParticles 色近似改真实尘型
        const ang = Math.random() * Math.PI * 2;
        const mlen = Math.random() * 0.5 + 0.5;
        const vx7 = -Math.sin(ang) * mlen, vy7 = Math.cos(ang) * mlen;
        const rad7 = 20 + (30 - 20) * ((rem * 3 + 50) / 182);   // Lerp(20,30,(num26×3+50)/182)
        // 构造零速（原版 NewDust 无速参,Dust.NewDust 自随机+228 烟雾族特例在
        // spawn 内镜像）,随后按原文覆写 velocity=v×2/scale/noGravity
        const d7 = game.spawnDust?.(
          this.cx + this.facing * 6 + vx7 * rad7,
          this.y + 6 + vy7 * rad7, 0, 0, 228, 0, 0, 0, null,
          0.5 + Math.random() * 0.5);
        if (d7) {
          d7.noGravity = true;
          d7.vx = vx7 * 2;
          d7.vy = vy7 * 2;
        }
        // 每拍【两】粒（原版 num28 循环 ×2）——第二粒独立随机角
        const angB = Math.random() * Math.PI * 2;
        const vx72 = -Math.sin(angB) * mlen, vy72 = Math.cos(angB) * mlen;
        const d72 = game.spawnDust?.(
          this.cx + this.facing * 6 + vx72 * rad7,
          this.y + 6 + vy72 * rad7, 0, 0, 228, 0, 0, 0, null,
          0.5 + Math.random() * 0.5);
        if (d72) {
          d72.noGravity = true;
          d72.vx = vx72 * 2;
          d72.vy = vy72 * 2;
        }
      }
      if (this.ai2 >= -num23) {
        // 发石化窗（:57033-57040 尘段 + :57041-57024 石化判定）：锚=Top+(dir×10,10)、
        // 单位向量同式、offset=v×Lerp、velocity=v×4、scale=0.5+r×0.5、noGravity
        const n29 = this.ai2 + num23;
        if (n29 < 180 && (Math.random() < 1 / 3 || this.ai2 % 3 === 0)) { // :57042-57043
          const ang9 = Math.random() * Math.PI * 2;
          const m9 = Math.random() * 0.5 + 0.5;
          const v9x = -Math.sin(ang9) * m9, v9y = Math.cos(ang9) * m9;
          const rad9 = 20 + (30 - 20) * ((n29 * 3 + 50) / 182); // Lerp(20,30,(num29×3+50)/182)
          const d9 = game.spawnDust?.(
            this.cx + this.facing * 10 + v9x * rad9,
            this.y + 10 + v9y * rad9, 0, 0, 228, 0, 0, 0, null,
            0.5 + Math.random());
          if (d9) {
            d9.noGravity = true;
            d9.vx = v9x * 4;
            d9.vy = v9y * 4;
          }
        }
        if (!player.dead && !player.buffs.has(BuffType.Stoned)) {
          const dx = player.cx - this.cx, dy = player.cy - this.cy;
          const dist = Math.hypot(dx, dy);
          if (dist < 700) {
            let hit = dist < 30;                                    // 贴脸必中（:56866）
            if (!hit) {
              // 45° 锥（:56870-56877）：|单位向量 X| > cos(45°) → 视为正面
              const ux = dx / dist;
              hit = ux > 0.7071 || ux < -0.7071;
            }
            const mutualFacing = (player.cx < this.cx && this.facing < 0 && player.facing > 0)
              || (player.cx > this.cx && this.facing > 0 && player.facing < 0);
            if (hit && mutualFacing) {
              // 三路视线任一通（:56880-56882：头/上 16px/下 8px）
              const sees = (ox: number, oy: number) => losClear(game,
                Math.floor((this.cx + ox) / TILE), Math.floor((this.cy + oy) / TILE),
                Math.floor(player.cx / TILE), Math.floor(player.cy / TILE));
              if (sees(0, 0) || sees(0, -16) || sees(0, 8)) {
                player.buffs.apply(BuffType.Stoned, (num24 + Math.trunc(-this.ai2)) / 60);
              }
            }
          }
        }
      }
      // 蓄力期接管 AI_003 余段（原版两段末尾 return——通用行走整拍跳过,重力/碰撞
      // 由 UpdateMovement 承担;2026-08-31 由裸 x+=vx 改 applyGravity+moveAndCollide
      // 等价复刻,修站立位穿墙/无重力悬浮漂移）。
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      return true;
    }
    return false;
  }

  private wetSwimStep(game: GameHooks, player: Player | null, mode: 461 | 586 | 620): boolean {
    if (!this.wet) {
      // ---- 出水复原（461 :56597-56624 / 586 :56730-56750,1456 锚 :56409-56440/
      //      :56536-56558 已统一 1457）----
      if (mode === 461) {
        this.kbResistOverride = getKnockbackMultiplierScaledByDifficulty(0.4, this.difficulty);
        const cx = this.cx, cy = this.cy;
        this.w = 18; this.h = 40;
        this.x = cx - this.w / 2; this.y = cy - this.h / 2;
      } else {
        this.kbResistOverride = null;
      }
      if (this.ai3 === -0.10101) {
        this.ai3 = 0;
        let spd = Math.hypot(this.vx, this.vy) * 2;
        if (spd > (mode === 586 ? 15 : 10)) spd = mode === 586 ? 15 : 10;
        const l = Math.hypot(this.vx, this.vy);
        if (l > 0) { this.vx = (this.vx / l) * spd; this.vy = (this.vy / l) * spd; }
        if (this.vx < 0) this.facing = -1;
        if (this.vx > 0) this.facing = 1;
      }
      return false;
    }
    // ---- 入水游泳 ----
    this.kbResistOverride = 0;                                 // knockBackResist = 0f
    this.ai3 = -0.10101;                                       // 出水冲量哨兵
    if (mode === 461) {
      // 缩盒 34×24（Center 保持，:56369-56373）
      const cx = this.cx, cy = this.cy;
      this.w = 34; this.h = 24;
      this.x = cx - this.w / 2; this.y = cy - this.h / 2;
    }
    if (player && !player.dead) this.facing = this.seekDirX(player);  // TargetClosest
    if (this.hitWall) this.vx = -this.vx;                      // collideX → -oldVelocity.X
    if (mode !== 620) {                                        // 620 保持 direction（原文怪癖）
      if (this.vx < 0) this.facing = -1;
      if (this.vx > 0) this.facing = 1;
    }
    const sees = !!player && !player.dead && this.canSeePlayer(game.world.store, player);
    if (sees) {
      const dx = player!.cx - this.cx, dy = player!.cy - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      let spd = 5;
      let k = 1 / 20;                                          // 461/620 amount=0.05
      if (mode === 586) {
        spd = 1 + Math.abs(this.cy - player!.cy) / 40;         // num8（:56503-56506）
        spd = Math.max(5, Math.min(20, spd));
        k = this.vy > 0 ? 1 / 30 : 1 / 5;                      // :56511-56516
      }
      const tx = (dx / d) * spd, ty = (dy / d) * spd;
      this.vx += (tx - this.vx) * k;
      this.vy += (ty - this.vy) * k;
      moveAndCollide(this, game.world, this.vx, this.vy);
      return true;
    }
    // 无视线：斜上巡航（461 :56575-56595 / 586 :56708-56726 / 620 :64524-64539，
    // 1456 锚 :56388-56405/:56519-56536/:64321-64336 已统一 1457）
    let cruise = 5;
    if (this.vy > 0) cruise = 3;
    if (this.vy < 0) cruise = 8;
    const k2 = cruise < 5 ? 1 / 25 : 1 / 10;
    const l = Math.hypot(this.facing, -1) || 1;
    const tx2 = (this.facing / l) * cruise, ty2 = (-1 / l) * cruise;
    this.vx += (tx2 - this.vx) * k2;
    this.vy += (ty2 - this.vy) * k2;
    moveAndCollide(this, game.world, this.vx, this.vy);
    return true;
  }

  private fighterAI(game: GameHooks, player: Player | null) {    const st = game.world.store;
    // ---- AI_003 尾段点光（cs:58802-58823，恒亮；放函数头防各 type 分支提前 return 漏写）----
    const vidF = this.vanillaId ?? -1;
    if (vidF >= 277 && vidF <= 280) {
      this.lightRGB = [0.2, 0.1, 0];                                   // :58802-58804 地牢骷髅四族
    } else if (vidF === 520) {
      this.lightRGB = [0.3, 0.3, 0.7];                                 // :58806-58808 火星行者 Top+20
      this.lightRGBAt = { x: this.cx, y: this.y + 20 };
    } else if (vidF === 525) {
      this.lightRGB = [0.35, 0.5, 0.1];                                // :58810-58813 腐化沙鬼 Top+15
      this.lightRGBAt = { x: this.cx, y: this.y + 15 };
    } else if (vidF === 526) {
      this.lightRGB = [0.4, 0.4, 0.2];                                 // :58815-58818 猩红沙鬼 Top+15
      this.lightRGBAt = { x: this.cx, y: this.y + 15 };
    } else if (vidF === 527) {
      this.lightRGB = [0.24, 0.12, 0.4];                               // :58820-58823 圣域沙鬼 Top+15
      this.lightRGBAt = { x: this.cx, y: this.y + 15 };
    }
    // 原始玩家对象（A 批 2026-08-19）：分发入口把死亡玩家滤成 null，但原版 TargetClosest
    // 对死者只冻结朝向（faceTarget=false，:78539-78542），坐标消费（索敌门/传送采样/
    // 冲刺瞄准）继续走尸体坐标——下列子段一律用 rawPlayer。
    // M11：rawPlayer = 当前索敌目标（Main.player[npc.target]，联机可为访客代理）
    const rawPlayer = this.targetRef(game, player);
    // :56248-56251 AI_003 帧首 directionY 维护（穿透表 :94164 消费——玩家与 NPC
    // 脚底同高 → -1（同层追击可站平台）；缺省 1 → 其余情况（含站台上玩家在别层）
    // 下落/站立均判下落 = 平台穿透，vanilla 僵尸不恋平台的行为根基）
    if (rawPlayer && rawPlayer.y + rawPlayer.h === this.y + this.h) this.dirY = -1;
    // ---- 624 侏儒日光石化（AI_003_Fighters :56433-56470 + AI_003_Gnomes_ShouldTurnToStone
    //      :56413-56424——AI_003 帧首序：directionY 维护(:56428-56431,1456 锚
    //      :56248-56251 已统一 1457)之后、其余 type 段之前）。
    //      谓词 = remix 世界 `position.Y/16 > maxTilesY-350`（:56415-56417 深度支,昼夜
    //      无关）；否则 Main.dayTime && WorldGen.InAPlaceWithWind(position,width,height)
    //      （:56418-56421 白天+风高户外盒——Mounts.inAPlaceWithWind 单源,AllowsWind
    //      白名单+remix 翻转已对齐 WorldGen.cs:88124-88162）。旧「头顶无遮挡+脚下实心」
    //      五格盒与 gnomeAge>60 自创冷却退役（2026-09-04 谓词重写批）。
    //      效果链(:56438-56470)：尘43(白,α254,scale.5,velocity×.2)×1 → 脚面格
    //      (Center.X/16, Bottom.Y/16) SolidTileAllowBottomSlope（:70698 单源,收坡 0/3/4
    //      拒顶坡 1/2）→ 尘×5 → TileObject.CanPlace(num,num2-1,567,0,direction,onlyCheck)
    //      && PlaceTile(num,num2-1,567,rand(5)) → 图鉴 RegisterKill(IsNPCValidForBestiary
    //      KillCredit 门)+CountKillForBannersAndDropThem(原文无交互门)+成就
    //      NotifyProgressionEvent(24) → life=0+active=false（不走 checkDead——无掉落/
    //      尸块/死音;石像被拆才出 4609,CheckGnome :54400 于 Game 'gnome' 支）。傀儡不跑
    //      fighterAI ⇒ 石化只发生在权威端（旧 fixedUpdate 头置位曾让访客本地误判）。
    if (this.vanillaId === 624 && !this.dead) {
      const w = game.world;
      const remixG = w.seedFlags?.remix === true;
      // AI_003_Gnomes_ShouldTurnToStone（:56413-56423）
      const toStone = remixG
        ? this.y / 16 > w.store.h - 350
        : !!w.clock?.isDay
          && inAPlaceWithWind(st, this.x, this.y, this.w, this.h, w.groundLevel);
      if (toStone) {
        const num = Math.floor(this.cx / 16);              // :56438 (int)(Center.X / 16f)
        const num2 = Math.floor((this.y + this.h) / 16);   // :56439 (int)(Bottom.Y / 16f)
        game.spawnParticles(this.cx, this.cy, '#E0E0E0', 1, 0.2, { life: 30 });
        if (solidAllowBottomSlope(st, num, num2)) {
          game.spawnParticles(this.cx, this.cy, '#E0E0E0', 5, 0.2, { life: 30 });
          const gnomeTile = TILE_BY_KEY['v_567_garden_gnome'] ?? 0;
          // 占位左上 = Origin(0,1) 对位（Style1x2,TileObjectData.cs:4126-4141
          // addTile(567)：CoordinateWidth 26+pad2=风格步 28、heights{18,18}+pad2=行帧 0/20）
          const ax = num, ay = num2 - 2;
          const rec = anchorSpecOf(567);
          // CanPlace(onlyCheck)（:56449）——占位/锚点/液体全门；direction 仅作用
          // alternates 维,567 无备选 ⇒ 方向无关（TileObject.cs:205-208 循环单圈）
          const canPlace = !!rec && gnomeTile !== 0 && validateAnchors(st, ax, ay, rec, 0);
          if (canPlace) {
            const style = Math.floor(Math.random() * 5);   // Main.rand.Next(5)（:56450）
            const cells = [
              { x: num, y: ay, type: gnomeTile, fx: style * 28, fy: 0 },
              { x: num, y: num2 - 1, type: gnomeTile, fx: style * 28, fy: 20 },
            ];
            if (game.placeObjectCells) game.placeObjectCells(cells, num, num2 - 1);
            else for (const c of cells) st.setTile(c.x, c.y, c.type, c.fx, c.fy);  // mock 兜底
            // 音位 = PlaceObject(x,y) 尾 PlaySound(0, x*16, y*16)（WorldGen.cs:51891），
            // 传入的 y = 锚点行 num2-1（:56450 PlaceTile(num, num2-1, 567,...)）
            game.playSfx('place', 1, num * 16, (num2 - 1) * 16);   // PlaceObject !mute → PlaySound(0)
            // 击杀记账（:56456-56463 netMode!=1 域=权威端）：onEnemyKilled = 仓内单口
            // （图鉴 RegisterKill 带 isNpcValidForBestiaryKillCredit 门+net 广播+
            // achCheckBestiary;旗杀 CountKillForBannersAndDropThem → recordBannerKill）
            // ★石化旁路（H2-2）：原文无交互门也不调 lastCreatureHit/NotifyNPCKilled,
            // 经 opts.petrifyBypassInteractionGate 逐项对齐
            // ★R-B-F5(2026-10-13):dead 先置再记账——mod onKill 快照=e.dead=true/hp=0
            //  (旧序 mod 钩内读活态,与 hurt 死亡支快照不一致)
            this.dead = true; this.hp = 0;                   // life=0+active=false（:56467-56468）
            game.onEnemyKilled(this.key, this, { petrifyBypassInteractionGate: true });
            game.achievements?.notifyProgressionEvent(24);   // :56466（prog24=TURN_GNOME_TO_STATUE 地精石化;IIIII231 订正旧注——ev24 才是 GAIN_TORCH_GODS_FAVOR,prog24 域不同）
            return;
          }
        }
      }
    }
    // ---- 111 僵尸威慑态（AI_003 :57550-57586,1456 锚 :57368-57407 已统一 1457，
    //      AI_127_Pal 生成的双僵尸 ai[3]<0）：
    //      TargetClosest(不转面) + 受击/玩家 <200px 解除（转普通僵尸 ai0=0）；
    //      威慑期 directionY=-1、vx ×0.93（<0.1 归零）、恒面向被威慑宠、
    //      ai0 计 1000→1300 循环（无行为效果），本 tick 到此为止（不追不跳） ----
    if (this.vanillaId === 111 && this.menacePal && !this.menacePal.dead) {
      const rawP = this.targetRef(game);
      if (this.justHit || (rawP && !rawP.dead && Math.hypot(rawP.cx - this.cx, rawP.cy - this.cy) < 200)) {
        this.menacePal = null;                       // :57556-57559 ai[3]=0, ai[0]=0
        this.ai0 = 0;
      } else {
        this.dirY = -1;                              // :57561 directionY = -1
        this.vx *= 0.93;                             // :57563-57567
        if (this.vx > -0.1 && this.vx < 0.1) this.vx = 0;
        const pal = this.menacePal;                  // num56 = -ai[3]-1 → num57 朝向宠
        const dir57 = Math.sign(pal.cx - this.cx) || 1;
        if (dir57 !== this.facing) { this.vx = 0; this.facing = dir57; }
        if (this.ai0 < 1000) this.ai0 = 1000;        // :57574-57576
        if (++this.ai0 >= 1300) this.ai0 = 1000;
        // :57582 跳过常规战士 AI（1456 锚 :57403 已统一 1457）——但 UpdateNPC 尾部重力/碰撞（:91523-91534）仍跑
        //（本仓 gravity/move 在 fighterAI 内 → 威慑段自补 groundPhysics 等价）
        this.groundPhysics(game);
        return;
      }
    } else if (this.vanillaId === 111 && this.ai0 >= 1000) {
      this.ai0 = 0;                                  // :57583-57586（解除后归零,1456 锚 :57405-57407 已统一 1457）
    }
    // ---- 586 僵尸人鱼出水演出（F16，NPC.cs:56626-56650）：出生 alpha=255（SetDefaults
    //  :16648）首帧 TargetClosest + vy=-6 + 35 尘爆发；随后 alpha −15/t 渐显，渐显期
    //  2 尘/t + 1/3 环境尘。fromVanilla 对 586 不走通用 alphaFade（保 255 初值）----
    if (this.vanillaId === 586) {
      if (this.spawnAlpha === 255) {
        if (rawPlayer && !rawPlayer.dead) this.facing = this.seekDirX(rawPlayer);
        this.vy = -6;                                          // :56632（1456 锚 :56451 已统一 1457）
        game.spawnParticles(this.x, this.y, '#B09058', 35, 1.5, { life: 30 });
      }
      this.spawnAlpha = Math.max(0, this.spawnAlpha - 15);     // :56462-56466
      if (this.spawnAlpha !== 0) {
        game.spawnParticles(this.x, this.y, '#B09058', 2, 1.2, { life: 30 });
      }
      if (Math.floor(Math.random() * 3) === 0) {
        game.spawnParticles(this.x, this.y, '#B09058', 1, 0.6, { life: 24 });
      }
    }
    // 游泳化双族 461/586（AI_003_Fighters cs:56361/:56486）：块在通用行走与白天驱散
    // （cs:57732，位于其后）之前，wet 时整段接管本 tick——故 hook 在函数最前
    if (this.vanillaId === 461 || this.vanillaId === 586) {
      if (this.wetSwimStep(game, player, this.vanillaId as 461 | 586)) return;
    }
    // ---- 482 花岗岩傀儡石壳（F13，NPC.cs:56646-56684）：ai[2] 数到 300（justHit
    //  每次 +15）且落地 → ai[2]=-120 入壳：壳内 dontTakeDamage、vx×0.9 衰减
    //  （|vx|<0.001 → 0.001×direction 保向）、|vy|>1 时 ai[2]+10/t 加速出壳、
    //  归零时 vx += direction×0.3 破壳起跳，整段 return 接管本 tick ----
    if (this.vanillaId === 482) {
      const num15 = 300, num16 = 120;                          // :56648-56649
      this.dontTakeDamage = false;                             // :56650
      if (this.ai2 < 0) {
        this.dontTakeDamage = true;                            // :56653
        this.ai2 += 1;
        this.vx *= 0.9;
        if (Math.abs(this.vx) < 0.001) this.vx = 0.001 * this.facing;  // :56656-56659
        if (Math.abs(this.vy) > 1) this.ai2 += 10;             // :56660-56663
        if (this.ai2 >= 0) this.vx += this.facing * 0.3;       // :56664-56668
        this.applyGravity(game);
        moveAndCollide(this, game.world, this.vx, this.vy);
        return;
      }
      if (this.ai2 < num15) {
        if (this.justHit) this.ai2 += 15;                      // :56673-56676
        this.ai2 += 1;
      } else if (this.vy === 0) {
        this.ai2 = -num16;                                     // :56681
      }
    }
    // ---- 471 哥布林术士全 AI（F12，NPC.cs:56886-57113）----
    if (this.vanillaId === 471 && this.goblinWarlockStep(game, rawPlayer)) return;
    // ---- 111 哥布林弓手营地待机（F17，NPC.cs:57367-57411）：ai[3]<0 = 营地锚
    //  （−ai[3]−1 为锚 NPC 下标，Spawner 侧置位）：面朝锚、摩擦定身、ai[0] 1000→1300
    //  循环；受击或玩家 <200px 唤醒（ai[3]=0/ai[0]=0）。唤醒时 ai[0]≥1000 → 0 ----
    if (this.vanillaId === 111) {
      if (this.ai3 < 0) {
        // :57371 TargetClosest(faceTarget:false)——只更新 targetRect 不改朝向
        if (this.justHit || (rawPlayer && !rawPlayer.dead
          && Math.hypot(rawPlayer.cx - this.cx, rawPlayer.cy - this.cy) < 200)) {
          this.ai3 = 0;                                        // :57373-57378
          this.ai0 = 0;
        }
      }
      if (this.ai3 < 0) {
        this.dirY = -1;                                        // :57561（1456 锚 :57381 已统一 1457）
        this.vx *= 0.93;                                       // :57563
        if (Math.abs(this.vx) < 0.1) this.vx = 0;
        const num56 = Math.trunc(-this.ai3 - 1);               // :57568
        const anchor = (game.enemies() as Enemy[])[num56];
        if (anchor && !anchor.dead) {
          const num57 = Math.sign(anchor.cx - this.cx) || 1;   // :57569-57570
          if (num57 !== this.facing) { this.vx = 0; this.facing = num57; }
        }
        if (this.ai0 < 1000) this.ai0 = 1000;                  // :57574-57576
        this.ai0 += 1;
        if (this.ai0 >= 1300) this.ai0 = 1000;                 // :57577-57581
        this.applyGravity(game);
        moveAndCollide(this, game.world, this.vx, this.vy);
        return;                                                // :57582
      }
      if (this.ai0 >= 1000) this.ai0 = 0;                      // :57583-57586
    }
    // 美杜莎 480 蓄力石化（NPC.cs:56751-56889,位于 AI_003 通用行走之后——行走段先跑,
    //  蓄力期行走被本块 velocity.X*=0.9 阻尼近似）。ai2: >0 冷却递减 / 0 蓄机判定 /
    //  <-(num23+num25) 起手辉光 / >=-num23 发石化窗;贴脸|45°锥内|双向对视|视线通→
    //  AddBuff(156, num24+剩余蓄力)——变身瞬间伤害/死因在 Player 石化过渡段。
    //  ★死亡玩家照常运转（A 批）：起手门对尸体坐标求值（cs:56771 无 dead 门），
    //  石化命中窗自带 !dead（:56859）
    if (this.vanillaId === 480 && rawPlayer) {
      if (this.medusaChargeStep(game, rawPlayer)) return;
    }
    // ---- Psycho 466 潜伏突袭（NPC.cs:56290-56326，AI_003 最前段——先于白天驱散）：
    // 潜伏/显形两分支 return 跳过本 tick 余段（helper 自补重力+碰撞）
    if (psychoStealthStep(this, game, player)) return;
    // ---- 通用 ai[3] 卡死计数（F14，NPC.cs:57472-57546）：X 未动 / 超过 num58 /
    //  落地逆行 → +1/t；|vx|>0.9 且在计数 → −1/t；超 num58×10 归零；justHit 归零；
    //  与玩家 AABB 相交归零。num58=60（120 混沌元素 180）。计数 ≥num58 时下方索敌门
    //  关闭（转游荡转向）——120 的传送消费在 chaosElementalStep ----
    const num58F = vidF === 120 ? 180 : 60;                    // :57430-57433
    const counterEligible = !AI3_COUNTER_SKIP_ENTIRELY.has(vidF)
      && !(AI3_COUNTER_SKIP_WHILE_AI2.has(vidF) && this.ai2 > 0);   // :57473-57515
    if (counterEligible) {
      const opposite = this.vy === 0
        && ((this.vx > 0 && this.facing < 0) || (this.vx < 0 && this.facing > 0)); // :57518-57521
      if (this.x === this.fighterPrevX || this.ai3 >= num58F || opposite) this.ai3 += 1;
      else if (Math.abs(this.vx) > 0.9 && this.ai3 > 0) this.ai3 -= 1;
      if (this.ai3 > num58F * 10) this.ai3 = 0;                // :57530-57533
      if (this.justHit) this.ai3 = 0;                          // :57534-57537
      if (rawPlayer && rawPlayer.x < this.x + this.w && rawPlayer.x + rawPlayer.w > this.x
        && rawPlayer.y < this.y + this.h && rawPlayer.y + rawPlayer.h > this.y) {
        this.ai3 = 0;                                          // :57542-57545 触碰归零
      }
    }
    // flag6（:57595-57602）：tick 初 velocity.X==0（上拍碰撞后残值=被墙挡停）且未受击。
    // 消费点 = :60740 卡死小跳——原版靠"flag6 在 tick 初取零速、跳跃链在行走加速后
    // 评估（此时 vx=accel×dir≠0 通过方向门）"的时序差进入本门，非死代码
    const flag6Stuck = this.vx === 0 && !this.justHit;
    // ---- 白天地表驱散（cs:57732-57798 + NotDiscouraged :60694）：
    // 白天 && y<worldSurface && 类型不在昼行豁免表【或 ai[3] 卡死计数满】→ 停止索敌 +
    // EncourageDespawn(10)，沿原方向游荡（站定 2t 转向），离屏后由 CheckActive ~10t 清除。
    // ★日食豁免（:60694 首条件 !Main.eclipse）：日食期间全体战士族不被驱散——
    // 日食怪（Eyezor/Psycho/Nailhead/Butcher/Possessed/Fritz/Dr Man Fly）都是白天
    // 刷的，缺此门会一出生就停止索敌游荡离场。
    // 墓地豁免（:60698 `!Main.player[npcInstance.target].ZoneGraveyard`）：目标玩家在
    // 墓地时白天不驱散——墓地白天刷出的僵尸/蛆僵尸白天照常索敌（scene 为本地玩家
    // 快照，单人下与"目标玩家所在区"等价）
    const daySurface = game.world.clock.isDay && !game.world.clock.eclipse
      && this.cy < game.world.groundLevel * TILE
      && !game.world.scene?.zoneGraveyard;
    // NotDiscouraged（B-3/B-4，:60694-60724 全量）：无条件豁免表 + 入侵三组（1/3/4，
    // 仅入侵进行中）+ 霜月 343/350 + 631 攻击中（ai[2]>0）+ 411 蓄力窗（ai[1]∈
    // [90,180) 会驱散——窗内为瞄准定身段，原版行为）+ 小动物反咬集（本族恒 false）
    const dayActive = this.vanillaId != null
      && (FIGHTER_DAY_ACTIVE.has(this.vanillaId)
        || (game.world.invasionType === 1 && GOBLIN_DAY_ACTIVE.has(this.vanillaId))
        || (game.world.invasionType === 3 && PIRATE_DAY_ACTIVE.has(this.vanillaId))
        || (game.world.invasionType === 4 && MARTIAN_DAY_ACTIVE.has(this.vanillaId))
        || (game.world.moonEvent.kind === 1 && FROSTMOON_DAY_ACTIVE.has(this.vanillaId))
        || (this.vanillaId === 631 && this.ai2 > 0)
        || (this.vanillaId === 411 && !(this.ai1 >= 90 && this.ai1 < 180))
        // :60897 NotDiscouraged 首条件 !SpawnedFromStatue——雕像刷出物跳过白天驱散
        // 判定整体（白天照常索敌），R6-B 补
        || this.spawnedFromStatue);
    // :57732 `if (ai[3] < num58 && NotDiscouraged(...))` —— 卡死满 60t 同样停索敌
    const targeting = this.ai3 < num58F && (!daySurface || dayActive);
    if (targeting) {
      // :57765 TargetClosest（死亡 → faceTarget=false 只换 targetRect 不改朝向）
      if (player && !player.dead) {
        this.facing = this.seekDirX(player);
        // 1457 SetTargetTrackingValues(:78562-78568) aiStyle==3 专档：directionY
        // 不再按中心比较,改按"目标脚底 ≤ 自身脚底 → -1（上跳）/否则 +1"——
        // 唯一消费点 = :60466 跳跃段总门（type 580 行走蚁狮 directionY==1 不跳）
        this.dirY = (player.y + player.h <= this.y + this.h) ? -1 : 1;
      }
    } else if (!(this.ai2 > 0 && FIGHTER_BUSY_WITH_ACTION.has(vidF))) {
      // :57771-57797 游荡转向；624/631 免 EncourageDespawn（:57773）
      if (daySurface && vidF !== 624 && vidF !== 631) this.encourageDespawn(10);
      // 游荡转向（原版 else 分支 ：57783-57797）：★原版结构 = vx≠0 才清零；
      // vx==0&&vy==0 计数+1；**vx==0&&vy≠0（空中未移动）计数保持**（内层无
      // else-reset）——曾误加内层 else 清零，贴墙跳循环每周期被空中 tick 归零
      // → 卡死计数满后永不转向（凹槽重放 face 恒 -1 实锤）。★vy 门补 onGround：
      // 原版 AI 在物理前读 vy==0=贴地；本仓跳跃段在物理后，落地 tick 尾 vy=-8
      // （跳已排队），onGround=上一 tick 碰撞落地态，两时点同义
      if (this.vx === 0) {
        if (this.vy === 0 || this.onGround) {
          this.state += 1;
          if (this.state >= 2) { this.facing *= -1; this.state = 0; }
        }
      } else {
        this.state = 0;
      }
      if (this.facing === 0) this.facing = 1;
    }
    // ---- 419 日耀旋刃怪（AI_003_Fighters cs:57114-57173 type==419 段）：旋刃冲刺
    //  状态机。该段位于原版通用行走段之前，各分支 return 跳过本 tick 行走/跳跃/远程——
    //  helper 返回 true = 已自管重力+碰撞，调用方直接收尾。
    //  ★死亡玩家照常运转（A 批，cs:57114 无 dead 门——:57116-57117 每帧复位
    //  reflectsProjectiles/takenDamageMultiplier，曾停在 true/×3 永久残留）
    if (this.vanillaId === 419) {
      if (rawPlayer && this.solenianDashAI(game, rawPlayer)) {
        return;
      }
      // 无玩家对象（测试桩）：冲刺链停摆但两标志照原版每帧复位
      this.reflectsProjectiles = false;
      this.takenDamageMultiplier = 1;
    }
    // ---- 415 火蜥蜴喷火（AI_003_Fighters cs:57362-57430 type==415 段）：喷吐风停段
    //  原版 return 跳过行走/跳跃链（三拍 -18/-26/-34 各撒尘 259 + 权威端生 516），
    //  待机/冷却段照走行走链；场上 516 >6 → 冷却 90 ----
    if (this.vanillaId === 415 && drakomireBreathAI(this, game, rawPlayer)) {
      return;
    }
    // ---- 428 外星幼虫 / 427 外星蜂 羽化变身（cs:57431-57468 AI_003 顶层段，不拦截
    //  行走链）：428 满龄 300t + 3×2 净空 → Transform(427)；427 满龄 1200t
    //  （1+|vx|/2 累计）+ 5×5 净空 → Transform(426)；蜂群升级链主干 ----
    alienLarvaMaturationStep(this, game);
    const dir = this.facing;
    // 前方探测点（1457 :60545-60550）：默认体中心前 15px、脚底上 15px；宽探针 19 型
    // （109/163/164/199/236/239/257/258/290/391/425/426/427/580/508/415/530/532/582）
    // = 体中心前 (width/2+16)px——跳跃与攻门共用本点，R6-B 补表
    const wideProbe = this.vanillaId != null && FIGHTER_WIDE_PROBE.has(this.vanillaId);
    const probeDist = wideProbe ? this.w / 2 + 16 : 15;
    const fx = Math.floor((this.x + this.w / 2 + probeDist * dir) / TILE);
    const fy = Math.floor((this.y + this.h - 15) / TILE);
    const solidAt = (x: number, y: number) => x >= 0 && y >= 0 && x < st.w && y < st.h && st.isSolid(x, y);
    // 门块/跳梯互斥探测（:60584 if(门) else 跳梯）：前方脚上一格是关闭的门
    // （sheet 10）或高门（388）且 flag8 → 本 tick 走攻门、跳梯整体短路
    // ★G1谓词批(2026-09-04)：原版门= tile.nactive()（NPC.cs:60584）——flags 位读
    // 漏 !inActive 半边,已致动门格会被误判可攻 → 改 isActive()
    let atDoorTile: number | null = null;              // 命中的门 sheet（10/388）
    if (this.vanillaId != null && !FIGHTER_NO_DOOR.has(this.vanillaId)
      && st.inBounds(fx, fy - 1) && st.isActive(fx, fy - 1)) {
      const sheet = TILE_DEFS[st.type[st.idx(fx, fy - 1)]]?.vanilla?.sheet;
      if (sheet === 10 || sheet === 388) atDoorTile = sheet;
    }
    // 沼泽怪 166 伏击（NPC.cs:56327-56360）：伏击态接管本 tick（原地减速，跳过行走）
    if (swampThingAmbushStep(this, !!player && this.canSeePlayer(st, player))) return;
    // 混沌元素 120（NPC.cs:57431-57460/:60679-60696）：ai[3] 卡死计数 + 传送。
    // 死亡玩家照常（A 批：计数/传送对尸体坐标运转）
    if (this.vanillaId === 120 && rawPlayer) this.ai3 = chaosElementalStep(this, game, rawPlayer);
    // ---- 日食怪战士族专属段（NPC.cs:57547-57710，位于卡死计数与横向移动链之间）----
    // Nailhead 463 受击散射（:57547-57613）；Butcher 460 空中免击退（:57615-57624）；
    // Possessed 469 爬墙冲刺（:57626-57677，冲刺分支 return 跳过余段）；
    // Fritz 462 跳扑（:57678-57710，改 vx/vy 后继续走本 tick 行走）
    nailheadHitScatter(this, game, player);
    butcherKbStep(this);
    if (possessedStep(this, game, player)) return;
    fritzPounceStep(this, player);
    // 横向移动逐族表（NPC.cs:57799-58800 else-if 链 1:1，fighterFamilies.ts）——
    // 取代一期固定档（加速 0.1 / 限速 ±1）；射击族（:58719 排除表）与扑咬突进族
    // （:58658，lungeFamilyStep）链上无通用分支
    fighterMoveStep(this, game, dir, player);
    // ---- 稻草人 305-309 蹦跳（F7，NPC.cs:58236-58252，第二段阶梯内）：落地 vx×0.85，
    //  |vx|<0.3 → vy=−7、vx=num86×direction；空中且贴图朝向=direction →
    //  vx = (vx×10 + num86×dir)/11（保持跳向）。310-314 走通用行走 ----
    if (vidF >= 305 && vidF <= 309) {
      const num86 = vidF === 305 ? 2 : vidF === 306 ? 1.25 : vidF === 307 ? 2.25
        : vidF === 308 ? 1.5 : 1;
      if (this.vy === 0) {
        this.vx *= 0.85;                                       // :58238-58240
        if (this.vx > -0.3 && this.vx < 0.3) {
          this.vy = -7;                                        // :58244
          this.vx = num86 * dir;                               // :58245
        }
      } else {
        this.vx = (this.vx * 10 + num86 * dir) / 11;           // :58248-58251
      }
    }
    // ---- 258 蘑菇瓢虫（F8，NPC.cs:58836-58864，第二段阶梯内）：空中朝玩家转向
    //  （±0.1 步进钳 ±5、反向 ×0.95）；落地且玩家高于 50px + 盒级视线 → vy=−7 上扑 ----
    if (vidF === 258) {
      if (this.vy !== 0) {
        if (player) this.facing = this.seekDirX(player);       // :58840 TargetClosest
        const pcx = player?.cx ?? this.cx;
        if (pcx < this.x && this.vx > 0) this.vx *= 0.95;      // :58842-58849
        else if (pcx > this.x + this.w && this.vx < 0) this.vx *= 0.95;
        if (pcx < this.x && this.vx > -5) this.vx -= 0.1;      // :58850-58857
        else if (pcx > this.x + this.w && this.vx < 5) this.vx += 0.1;
      } else if (player && player.cy + 50 < this.y
        && canHit(st, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)) {
        this.vy = -7;                                          // :58859-58863
      }
    }
    // ---- 427/426 外星蜂伺服飞行（F9，NPC.cs:59015-59212，第二段阶梯内）----
    alienFlightStep(this, game, player);
    // 425 风暴潜水员专属段（NPC.cs:58865-59013，原版独立第二段 if/else-if 阶梯，
    // 位于移动链之后/重力之前）：喷包伺服 + 起飞门 + ai3 瞄准蓄力（stormDiverAimStep
    // 计数节奏）——ai3 专用于蓄力，不再与任何通用计数共用（Renderer.npcGlowSparkleEnvelope 消费）
    stormDiverStep(this, game, player);
    // 原版跳跃判定用碰撞前的速度符号（NPC 碰撞在 AI 之后）——
    // 此处必须先捕获再碰撞，否则撞墙清零 vx 后 movingInto 恒假、战士永不跳墙。
    // 1457 :60466 跳跃段总门 = velocity.Y>=0 && (type!=580 || directionY!=1)——
    // 行走蚁狮 580 目标在下方（directionY==1,1457 SetTargetTrackingValues 专档赋值）
    // 时整段跳过（贴地行走不跳）；directionY 由上方 targeting 段按 1457 规则写
    const jumpGate580 = vidF !== 580 || this.dirY !== 1;
    const vxSign = this.vx > 0 ? 1 : this.vx < 0 ? -1 : 0;
    // ---- 台阶自动步升（L24512-24554）：前方高差 ≤16.1px 直接跨上（gfxOffY 视觉补偿略）----
    if (this.vy >= 0 && vxSign !== 0) {
      const ax = Math.floor((this.x + this.vx + this.w / 2 + (this.w / 2 + 1) * vxSign) / TILE);
      const fr = Math.floor((this.y + this.h - 1) / TILE);
      if (ax >= 0 && fr >= 2 && ax < st.w && fr < st.h
        && solidAt(ax, fr) && !st.half[st.idx(ax, fr)]
        && !solidAt(ax, fr - 1) && !solidAt(ax, fr - 2) && !solidAt(ax, fr - 3)) {
        const top = fr * TILE;
        const rise = this.y + this.h - top;
        if (rise > 0 && rise <= 16.1) this.y = top - this.h;
      }
    }
    // 重力 + 碰撞（原版 SteepSlowing/WalkDownSlope 略）。471 术士飞行态（ai[3]<0，
    // F12）noGravity+noTileCollide——直积分（-4 下降态无 return，继续走本通用段）
    // ★卡死计数采样点（:93748 oldPosition = position 前移动）——下一拍计数读
    this.fighterPrevX = this.x;
    if (vidF === 471 && this.ai3 < 0) {
      this.x += this.vx;
      this.y += this.vy;
    } else {
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
    }
    // ---- flag5 地面扫描（:60213-60255 扫描体 + :60412 `if (flag5)` 跳跃段总门）----
    // 原版外层门 `velocity.Y == 0f || flag`（:60213；flag=特型跳攻态，僵尸族恒 false）
    // ——AI 时点 vy==0 = 上一 tick 碰撞清零后（贴地/磕檐均满足）。扫描盒中段列
    // （x+8..x+w-8）：头上 -9px 行 SolidTileNoPlatforms → flag5=false（封顶禁跳）；
    // 脚下 +7px 行 SolidTileAllowBottomSlope → flag5=true（可跳）。flag5 默认 false，
    // 空中 tick（vy≠0）整段扫描跳过 = 跳跃段不跑。
    // ★缺此门的后果（2026-08-25 用户报双僵尸凹槽"卡死不动弹"，重放实锤 t16 起
    // y=3808/hitHead=1/vy=-8 三量 900+ tick 恒定）：本仓跳跃段在碰撞【后】，
    // vy===0 会被磕檐本身满足 + vxSign 捕获的是碰撞前非零值 → 磕檐+前方实心 →
    // 每 tick 重新起跳 -8 → 永久钉死天花板。原版钉檐态下一 tick 扫描找不到脚下
    // 地面 → flag5=false → 不跳 → 重力累积 → 落回。扫描按位置判定，两时点同效。
    // （:60253-55 的 `!flag5 && vy<0 → vy=0` 在原版时点才可达，本时点 vy 恒 0，略。）
    let flag5 = false;
    if (this.vy === 0) {
      const rowFeet = Math.floor((this.y + this.h + 7) / TILE);   // num188（:60214）
      const rowHead = Math.floor((this.y - 9) / TILE);            // num189（:60215）
      const colL = Math.floor(this.x / TILE);                     // num190
      const colR = Math.floor((this.x + this.w) / TILE);          // num191
      const scan0 = Math.floor((this.x + 8) / TILE);              // num192
      const scan1 = Math.floor((this.x + this.w - 8) / TILE);     // num193
      let flag23 = false;
      for (let c = scan0; c <= scan1; c++) {
        if (c >= colL && c <= colR && !st.inBounds(c, rowFeet)) { flag23 = true; continue; } // tile==null
        // SolidTileNoPlatforms（WorldGen.cs:70444）：active && !Platforms 集 &&
        // (tileSolid||tileSolidTop) && !inActive——Platforms 集 = 本仓 solid∧platform
        if (st.inBounds(c, rowHead) && st.flags[st.idx(c, rowHead)]) {
          const hd = TILE_DEFS[st.type[st.idx(c, rowHead)]];
          const hi = st.idx(c, rowHead);
          if (hd && (hd.solid || hd.platform) && !(hd.solid && hd.platform)
            && !(st.wire[hi] & TileStore.WIRE_ACTUATED)) { flag5 = false; break; }
        }
        // SolidTileAllowBottomSlope（WorldGen.cs:70471）：active && (solid||solidTop)
        // && (!topSlope || (Platforms && PlatformProperTopFrame)) && !halfBrick && !inActive
        if (!flag23 && c >= colL && c <= colR && st.inBounds(c, rowFeet) && st.flags[st.idx(c, rowFeet)]) {
          const fi = st.idx(c, rowFeet);
          const fd = TILE_DEFS[st.type[fi]];
          if (fd && (fd.solid || fd.platform) && !st.half[fi]
            && !(st.wire[fi] & TileStore.WIRE_ACTUATED)) {
            const sl = st.slope[fi];
            if (!(sl === 1 || sl === 2)) flag5 = true;                    // 非顶坡直过
            else if (fd.solid && fd.platform && platformProperTopFrame(st.frameX[fi] ?? 0)) flag5 = true;
          }
        }
      }
    }
    // ---- 四级跳判定（L24651-24733）：仅在朝移动方向撞到东西时 ----
    // 原版全部跳跃赋值都有 velocity.Y == 0f 前置（AI_003 内 44 处同款门）——
    // 缺失此门时空中贴墙每帧 vy=-8 → 沿墙飞天贴天花板（主角靠近才掉落）
    // ★门前短路（:60584 if/else 互斥）：攻门 tick 跳梯/卡死跳/专家梯整体不跑
    // ★整段在原版 `if (flag5)` 内（:60412）——含卡死小跳/专家跳扑/攻门
    const movingInto = flag5 && atDoorTile === null && jumpGate580 && vxSign === dir
      && vxSign !== 0 && this.vy === 0;
    if (movingInto) {
      if (this.h >= 32 && solidAt(fx, fy - 2)) {
        // 胸口前 2 格墙：上方再 1 格也堵 → -8，否则 -7
        this.vy = solidAt(fx, fy - 3) ? -8 : -7;
      } else if (solidAt(fx, fy - 1)) {
        // 脚前 1 格墙：624 侏儒特例（:60508-60518）跳力 -8，头顶 8 格实心 →
        // 掉头 + vx=3×direction（防跳进天花板夹缝）
        if (this.vanillaId === 624) {
          this.vy = -8;
          const num205 = Math.floor((this.y + this.h) / TILE);
          if (solidAt(Math.floor(this.cx / TILE), num205 - 8)) {
            this.facing *= -1;
            this.vx = 3 * this.facing;
          }
        } else {
          this.vy = -6;
        }
      } else if (this.y + this.h - fy * TILE > 20 && solidAt(fx, fy)
        && st.slope[st.idx(fx, fy)] !== 1 && st.slope[st.idx(fx, fy)] !== 2) {
        this.vy = -5;                       // 卡在格内下部（非顶坡——原版 topSlope 门 :60523）
      } else if (this.vanillaId !== 67 && player && player.y + player.h < this.y
        && !solidAt(fx, fy + 1) && !solidAt(fx + dir, fy + 1)) {
        this.vy = -8;                       // 前方悬空且目标在上方 → 大跳 + 冲刺（67 噬人藤不跳 :60527）
        this.vx *= 1.5;
      } else if (this.vanillaId != null && !FIGHTER_NO_DOOR.has(this.vanillaId)) {
        // :60735-60739 行进无障碍（未命中任何跳跃分支）且 flag8 → 攻门进度归零
        this.doorHit = 0;
        this.doorWarm = 0;
      }
      // :60740 卡死小跳（R6-B 1-3）：flag6（tick 初零速未受击）+ 卡死计数恰 1 →
      // vy=-5——全战士族经典模式同样生效（顶墙/嵌格脱困；与上链互斥：链已起跳则
      // vy≠0 跳过，与原版序一致）★在原版 `if (flag5)` 内
      if (flag5 && this.vy === 0 && flag6Stuck && this.ai3 === 1) {
        this.vy = -5;
      }
      // :60744 专家跳扑梯（R6-B 1-2）：门 = 落地 &&（专家||586）&& 玩家底边高于
      // 自身顶边 && |Δcx|<玩家宽×3 && CanHit——无 vx==0/ai3 条件（贴墙奔跑时每 tick
      // 都可触发；曾误并入卡死计数恰 1 的单 tick 窗 → 专家模式战士跳不上玩家平台）
      // ★同在 `if (flag5)` 内
      if (flag5 && this.vy === 0 && (mainExpertMode(game.world) || vidF === 586) && player
        && player.y + player.h < this.y
        && Math.abs(this.cx - player.cx) < player.w * 3
        && canHit(st, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)) {
        if (vidF === 586) {
          // :60748-60775 num205 = (Bottom−16−玩家Bottom)/16
          const num205 = Math.trunc((this.y + this.h - 16 - (player.y + player.h)) / TILE);
          if (num205 < 14) {
            if (num205 < 7) this.vy = -8.8;
            else if (num205 < 8) this.vy = -9.2;
            else if (num205 < 9) this.vy = -9.7;
            else if (num205 < 10) this.vy = -10.3;
            else if (num205 < 11) this.vy = -10.6;
            else this.vy = -11;
          }
        }
        if (this.vy === 0) {
          const num206 = 6;                                      // :60779
          if (player.y + player.h > this.y - num206 * TILE) {
            this.vy = -7.9;                                      // :60780-60783
          } else {
            // :60786-60795 自身列向上 6 格内扫平台
            const num207 = Math.floor(this.cx / TILE);
            const num208 = Math.floor((this.y + this.h) / TILE) - 1;
            for (let t = num208; t > num208 - num206; t--) {
              if (st.inBounds(num207, t) && st.get(num207, t) !== 0 && st.isPlatform(num207, t)) {
                this.vy = -7.9;
                break;
              }
            }
          }
        }
      }
    }
    // ---- 门交互（AI_003 :60584-60681 攻门态 1:1 重写 R6-B1；旧"doorWarm 站定 60t +
    //  doorHit 每 tick +5 + 失败 30t 脱离"三连错整段退役）----
    // 门块位于 flag5（落地）顶层，不要求行进方向；探针 = (fx, fy-1)（宽探针 19 型见
    // :60547）。每 tick：ai[2]++（doorWarm）+ ai[3]=0（攻门期保持索敌）；每满 60t
    // 一击：velocity.X = 0.5×−direction、ai[1]（doorHit）+= 5（388 高门 +2；27 +1；
    // 31/294-296 与玩家置不可破墙 +6）、ai[2]=0。白名单型（flag25 =
    // FIGHTER_DOOR_WHITELIST）在非血月（FTW 除外）且墓地未掷中（1/60 每击）时 ai[1]
    // 先归零再累计 → 恒 5 < 10 **普通夜永不开门**（仅血月/FTW/墓地掷中/不可破墙时
    /// 开门）；表外攻门型任意夜累计。ai[1] ≥ 10 → 开门：26 直接拆门 KillTile、
    // 460 恒一击即开、10=OpenDoor、388=ShiftTallGate，失败 → ai[3]=num58（停索敌
    // 转游荡）。行进无障碍时跳梯尾 else if(flag8) 归零 ai[1]/ai[2]（:60735-60739）。
    // ★flag8=false 族（FIGHTER_NO_DOOR）整段短路（doorWarm/doorHit 不累计）。
    // atDoorTile 已在跳梯前探测（互斥门）；★门块在原版 `if (flag5)` 顶层（:60584）
    // ——曾用 vy==0 代理，磕檐后 vy==0 同样满足 → 钉檐态凭空攻门；现用真 flag5
    if (flag5 && atDoorTile !== null && this.vanillaId != null) {
      this.doorWarm += 1;                              // ai[2]++（:60586）
      this.ai3 = 0;                                    // ai[3]=0 保持索敌（:60587）
      if (this.doorWarm >= 60) {                       // :60588 每 60t 一击
        this.doorWarm = 0;                             // ai[2]=0（:60629）
        const clock = game.world.clock;
        const graveyardRoll = !!game.world.scene?.zoneGraveyard
          && Math.floor(Math.random() * 60) === 0;     // flag26（:60591）
        const inUnbreakable = !!(rawPlayer && !rawPlayer.dead
          && !rawPlayer.isGhostPhase(game.world)
          && rawPlayer.insideUnbreakableWalls);        // flag27（:60593-60600）
        // flag28（:60601）= ((!bloodMoon||getGoodWorld) && !graveyardRoll) & flag25
        if (FIGHTER_DOOR_WHITELIST.has(this.vanillaId)
          && (!clock.bloodMoon || game.world.seedFlags?.getGoodWorld)
          && !graveyardRoll && !inUnbreakable) {
          this.doorHit = 0;                            // ai[1]=0 → 普通夜永不开门
        }
        this.vx = 0.5 * -dir;                          // :60610
        this.doorHit += atDoorTile === 388 ? 2 : 5;    // num202（:60611-60616）
        if (inUnbreakable) this.doorHit += 6;          // flag27（:60617-60620）
        else if (this.vanillaId === 27) this.doorHit += 1;                 // :60621-60624
        else if (this.vanillaId === 31 || this.vanillaId === 294
          || this.vanillaId === 295 || this.vanillaId === 296) this.doorHit += 6;  // :60625-60628
        let strike = this.doorHit >= 10;
        if (strike) this.doorHit = 10;                 // 钳 10（:60631-60635）
        if (this.vanillaId === 460) strike = true;     // 屠夫恒一击开门（:60636-60639）
        game.playSfx?.('dig', 1, this.cx, this.cy);   // KillTile(fail:true)（:60640）敲门声
        if (strike) {
          const dtx = fx, dty = fy - 1;
          if (this.vanillaId === 26) {
            game.breakTile?.(dtx, dty);                // 哥布林苦力直接拆门（:60643-60650）
          } else if (atDoorTile === 10) {
            const opened = openDoor(st, dtx, dty, dir);
            if (!opened) {
              this.ai3 = num58F;                       // 开门失败 → ai[3]=num58 停索敌（:60658）
            } else {
              game.npcDoorNet?.('door', dtx, dty, false, dir); // msg19 等价：即时广播
            }
          } else if (!shiftTallGate(st, dtx, dty, false, undefined, {
            // ★BJ322：forced=false 同 vanilla（NPC.cs:60668）——实体占位门+尾 TileFrame 面
            blocked: game.overlapsEntity ? (bx, by) => game.overlapsEntity!(bx, by) : undefined,
            afterWrite: game.tallGateTileFrameFace ? (ax, ay) => game.tallGateTileFrameFace!(ax, ay) : undefined,
          })) {
            this.ai3 = num58F;                         // 高门开启失败（:60668-60673）
          } else {
            game.npcDoorNet?.('gate', dtx, dty, false, dir); // msg19 等价：闸开即时广播
          }
        }
      }
    }
    // ---- 近身扑跳族（F1，NPC.cs:60599-60651）：落地 + |Δcx|<100（586 150）+
    //  |Δcy|<50（586 150）+ 朝移动方向 |vx|≥1 → vx×2 钳 3（586 先 +dir 钳 8）+
    //  vy=−4（586 −4.5 再按 y+40/80/120 三档 −2）。族表：愤怒骷髅 31/294-296/
    //  蚁狮 47/装甲骷髅 77/狼人 104/沙鬼 168/豺狼人 196/火星兵 385/389/腐蟹 464/
    // 爬行者 470/沙虫 524-527。★586 内分支（:60603-60634）存在即证据——外层
    // 门不含 586 为反编译条件拆分伪迹，按分支意图并入 ----
    if ((vidF === 31 || vidF === 294 || vidF === 295 || vidF === 296 || vidF === 47
      || vidF === 77 || vidF === 104 || vidF === 168 || vidF === 196 || vidF === 385
      || vidF === 389 || vidF === 464 || vidF === 470 || (vidF >= 524 && vidF <= 527)
      || vidF === 586) && this.vy === 0 && player) {
      const num211 = vidF === 586 ? 150 : 100;                 // :60601-60607
      const num212 = vidF === 586 ? 150 : 50;
      if (Math.abs(this.cx - player.cx) < num211 && Math.abs(this.cy - player.cy) < num212
        && ((dir > 0 && this.vx >= 1) || (dir < 0 && this.vx <= -1))) {
        if (vidF === 586) {
          this.vx += dir;                                      // :60612
          this.vx *= 2;
          this.vx = Math.max(-8, Math.min(8, this.vx));
          this.vy = -4.5;
          if (this.y > player.y + 40) this.vy -= 2;            // :60623-60634
          if (this.y > player.y + 80) this.vy -= 2;
          if (this.y > player.y + 120) this.vy -= 2;
        } else {
          this.vx *= 2;                                        // :60638
          this.vx = Math.max(-3, Math.min(3, this.vx));
          this.vy = -4;                                        // :60647
        }
      }
    }
    // ---- 空中乘区三处（F15，NPC.cs:60652-60671）：120 混沌元素上升 ×1.1；
    //  287 骨李落地近距突进（vx=8×dir、vy=−4）+ 空中上升 vx×1.2/vy×1.1；
    //  460 屠夫空中上升 vx×1.3/vy×1.1 ----
    if (vidF === 120 && this.vy < 0) this.vy *= 1.1;           // :60652-60655
    if (vidF === 287 && this.vy === 0 && player
      && Math.abs(this.cx - player.cx) < 150 && Math.abs(this.cy - player.cy) < 50
      && ((dir > 0 && this.vx >= 1) || (dir < 0 && this.vx <= -1))) {
      this.vx = 8 * dir;                                       // :60656-60661
      this.vy = -4;
    }
    if (vidF === 287 && this.vy < 0) { this.vx *= 1.2; this.vy *= 1.1; }   // :60662-60666
    if (vidF === 460 && this.vy < 0) { this.vx *= 1.3; this.vy *= 1.1; }   // :60667-60671
    // ---- ★R3-4 蜘蛛族专家毒液弹（1457 :59438-59458；1456 :59464 同支无 !confused）：
    //      expert+视线可达（163/238/236/237）→ lai0 蓄力（justHit 回退 Next(20,60)
    //      钳 0），超 Next(180,900) → 朝玩家单位向量×8 吐弹 472，伤
    //      GetAttackDamage_ForProjectiles(18,18)。曾备案"未启用专家模式不移植"
    //      ——World.isExpert 已实装（World.ts:137），理由失效
    if (!this.confused && game.world.isExpert && player
      && (this.vanillaId === 163 || this.vanillaId === 238
        || this.vanillaId === 236 || this.vanillaId === 237)
      && canHit(st, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)) {
      this.lai0++;
      if (this.justHit) {
        this.lai0 -= Math.floor(Math.random() * 40) + 20;      // Next(20,60)
        if (this.lai0 < 0) this.lai0 = 0;
      }
      if (this.lai0 > Math.floor(Math.random() * 720) + 180) { // Next(180,900)
        this.lai0 = 0;
        const vdx = player.cx - this.cx, vdy = player.cy - this.cy;
        const vl = Math.hypot(vdx, vdy) || 1;
        const dmgV = getAttackDamageForProjectiles(18, 18, this.difficulty);
        this.spawnHostileProj(game, this.cx, this.cy, (vdx / vl) * 8, (vdy / vl) * 8, dmgV, 472);
      }
    }
    // ---- 蜘蛛上墙形态切换（NPC.cs:59273-59293）：站定（velocity.Y==0）且身边有
    // 背景墙（NPCCanStickToWalls）→ 先 TryMoveToTransformableSpaceInto（K2，
    //  :59290——底边中心扩盒挪位，挪不进则不转化）再 Transform 成爬墙形态
    //  （164→165 等）——蜘蛛洞里贴墙爬的就是这一步，地表无背景墙自然不触发。
    //  ★R3-4 1457 :59460 外门加 !confused + :59479 lai1==0 冷却门 + 变换后
    //  lai1=12（:59487）+ 地面形态每帧衰减（:59489-59491）
    if (!this.confused && this.vy === 0 && this.vanillaId != null) {
      const wallForm = Enemy.SPIDER_WALL_FORM[this.vanillaId];
      // 1457 :59481 贴墙检查同样按变换后（爬墙形态）盒评估
      if (this.lai1 === 0 && wallForm !== undefined && this.npcCanStickToWalls(st, wallForm)
        && this.tryMoveToTransformableSpaceInto(wallForm, st)) {
        this.tryTransformTo(wallForm, st, true, game);
        this.lai1 = 12;
      }
    }
    if (this.vanillaId != null && Enemy.SPIDER_GROUND_IDS.includes(this.vanillaId)) {
      this.lai1 = Math.max(0, this.lai1 - 1);
    }
    // ---- 吸血鬼离远 → 化回蝙蝠（cs:59236-59244：type 159 距玩家 >300 → Transform(158)）
    if (this.vanillaId === 159 && player
      && Math.hypot(player.cx - this.cx, player.cy - this.cy) > 300) {
      this.tryTransformTo(158, st, false, game);
    }
    // ---- 半血变身（cs:57422-57429）：198 蜥蜴人 → 199 爬行态；348 礼物宝箱怪 →
    //  349 胡桃夹子（F18，原注"霜月未引入不移植"已废——1:1 无条件按 HP 门）
    if (this.vanillaId === 198 && this.hp <= this.maxHp * 0.55) {
      this.tryTransformTo(199, st, false, game);
    }
    if (this.vanillaId === 348 && this.hp <= this.maxHp * 0.55) {
      this.tryTransformTo(349, st, false, game);
    }
    // 地面摩擦：原版 walker 摩擦链已在 fighterMoveStep（fighterFamilies.ts）1:1
    // （AI_003_Fighters :60115-60175——num3 档 velocity×damp【双轴】、vy==0 落地门、
    // 仅 |vx|>max 超速段衰减,逐族 damp 0.7/0.8/0.95…;未超速段是 +=accel 钳 ±max）;
    // 坡面逐面链（Collision.SlopeCollision :1796-2036 贴合/受阻清零）在
    // TileCollision.slopeCollide。此处的 onGround ×0.85 是 slope 系统落地前的
    // 陈旧近似,与 damp 叠乘成双阻尼（超速段 0.8×0.85,匀速段把平衡点压到
    // accel/(1-0.85)≈0.47px/t,远低于原版 max 1-1.5）——2026-08-15 摘除回归单链
    // ---- 战士族远程攻击（NPC.cs:59464-60197 全段 1:1，F2/F3/F4/F5/F9/F19/F20 批
    //  2026-08-19）：落地 + 视线 + 距离<射程 → 开瞄（ai[2]=姿态分档 1-5），ai[1]
    //  倒数至 num165 发射；justHit → ai[1]=30、ai[2]=0（F3，cs:59486-59492 重瞄）。
    //  槽位：ai1=蓄力倒数（vanilla ai[1]）、ai2=瞄准姿态（vanilla ai[2]）----
    // ★原版射击族块对 target 无条件跑（NPC.cs:59659-60393,坐标消费含尸体）——本仓
    // 用 rawPlayer（A 批口径）；仅开瞄门保留 !dead（:60226）。曾用 null 滤后的
    // player=整块随玩家死亡冻结（ai1/ai2 停摆,复活瞬间续掷）——红蓝对抗清偿
    if (rawPlayer && this.vanillaId != null && Enemy.RANGED_FIGHTERS.has(this.vanillaId)) {
      const vidR = this.vanillaId;
      const R = Enemy.RANGED_TABLE[vidR];
      // ---- 216 海盗船长分档（F4，cs:59562-59579）：localAI[2]≥20（命中计数）→
      //  num163=max(60,180−localAI[3]×20) 激怒档 + num166=15 + 伤 100 弹 240 精准
      //  （发射时清 localAI[2]/[3]）；否则 9 档 ±50 散布 ----
      const flag20 = vidR === 216 && this.lai2 >= 20;
      let cooldown = R.cooldown, speed = R.speed, dmg = R.dmg, proj = R.proj;
      let spread = R.spread ?? 40;
      if (vidR === 216) {
        if (flag20) {
          cooldown = Math.max(60, 180 - Math.trunc(this.lai3) * 20);   // :59573
          speed = 15;                                          // :59629-59632
          dmg = 100; proj = 240;                               // :59914-59920
          spread = 0;                                          // 精准（:59779-59786 散布仅 !flag20）
        } else {
          cooldown = 9;                                        // :59577
        }
      }
      let fireAt = R.fireAt ?? Math.floor(cooldown / 2);       // num165（:59580）
      if (vidR === 424 || vidR === 426) fireAt = R.fireAt ?? cooldown - 1;
      // flag16：瞄准中照常行走（381/382/520 恒真、411 恒真、468 非日食真）
      const flag16 = R.aimFreeMove === true
        || (R.aimDecelOffEclipse && !game.world.clock.eclipse);
      // flag17 = 426（瞄准不因空中解除，cs:59467/:60015/:60020/:60030）
      const flag17 = vidR === 426;
      const ai1Pre = this.ai1;                                 // :59666-59679 flag19 按减【前】值判（411 窗口）
      if (this.ai1 > 0) this.ai1 -= 1;                         // :59481-59484 先倒数
      // F3 justHit 重瞄（cs:59486-59492，后于倒数）：ai[1]=30、ai[2]=0；
      // 216 激怒档受击 → lai3+1（:59680-59687 flag20=受击时瞄准 + :59758-59766
      // localAI[2]>=20 档门内计数——双门缺一不可,曾漏档门=激怒前白涨 lai3 预缩短
      // 首个激怒冷却,2026-09-02 全面评审 C 定谳补）
      if (this.justHit) {
        if (vidR === 216 && flag20 && this.ai2 > 0) this.lai3 += 1;
        this.ai1 = 30;                                         // :59489
        this.ai2 = 0;                                          // :59490
      }
      // 困惑清计时（NPC.cs:59788-59792，后于 justHit 前于瞄掷分支）：confused →
      // ai[1]=0、ai[2]=0——困惑态停火且压掉 justHit 的 ai1=30 重瞄（射击族全型共用；
      // 曾整缺=困惑态照常掷锤,2026-09-02 红蓝对抗 R3 定谳补）
      if (this.confused) {
        this.ai1 = 0;
        this.ai2 = 0;
      }
      // 枪口（chaserPosition2，cs:59674-59703）：oy 均为中心相对；例外 520=:59887-59890
      // 【赋值】Top+20（绝对顶边,盒高 110 → cy−35）、426=:59896-59901 追加横偏 +(sd*2,−12)
      const mx = this.cx + (vidR === 426 ? this.facing * 2 : 0), my = this.cy + (R.oy ?? 0);
      if (this.ai2 > 0) {           // 瞄准中
        // :59599-59602 flag18（411 ai1>220 才 TargetClosest——窗外冻结朝向,★按减前值
        // ai1Pre 判:原版 flag19 求值在倒数前,:59666-59679）;TargetClosest 对死者只冻结
        // 朝向不改向（:78538-78541）→ dead 时停更 facing
        if (!(vidR === 411 && ai1Pre <= 220) && !rawPlayer.dead) this.facing = this.seekDirX(rawPlayer);
        if (this.ai1 === fireAt) {
          if (vidR === 216) this.lai2 += 1;                    // :59605-59608
          // ---- 弹速/瞄准（cs:59609-59703）----
          let num168 = Math.abs(rawPlayer.cx - mx) * 0.1;      // :59704-59705 默认下坠补偿
          if (vidR === 291 || vidR === 292) num168 = 0;        // :59706-59709
          if (vidR === 215) num168 *= 0.8;                     // :59710-59713 ×0.08
          if (vidR === 214 || (vidR === 216 && !flag20)) num168 = 0;  // :59714-59717
          if (vidR === 381 || vidR === 382 || vidR === 520) num168 = 0;  // :59719-59722
          if (vidR >= 449 && vidR <= 452) num168 = Math.abs(rawPlayer.cx - mx) * (10 + Math.floor(Math.random() * 40)) * 0.01;  // :59723-59726
          if (vidR === 468) num168 = Math.abs(rawPlayer.cx - mx) * (10 + Math.floor(Math.random() * 40)) * 0.01;   // :59727-59730
          if (vidR === 481) num168 = Math.abs(rawPlayer.cx - mx) * (Math.floor(Math.random() * 21) - 10) * 0.0035; // :59731-59734
          if (vidR >= 498 && vidR <= 506) num168 = Math.abs(rawPlayer.cx - mx) * (1 + Math.floor(Math.random() * 10)) * 0.0025; // :59735-59738
          let tx = rawPlayer.cx - mx;
          let ty = rawPlayer.cy - my - num168;                 // :59739
          // 散布链（cs:59740-59791）
          if (vidR === 291) {
            tx += (Math.floor(Math.random() * 81) - 40) * 0.2; // :59742-59743 ±8
            ty += (Math.floor(Math.random() * 81) - 40) * 0.2;
          } else if (vidR === 381 || vidR === 382 || vidR === 520) {
            // :59745-59757 ±40 后 ×0.85-1.15；520 再叠 ±60 ×(1.275-1.74)
            tx += (Math.floor(Math.random() * 201) - 100) * 0.4;
            ty += (Math.floor(Math.random() * 201) - 100) * 0.4;
            tx *= (85 + Math.floor(Math.random() * 31)) * 0.01;
            ty *= (85 + Math.floor(Math.random() * 31)) * 0.01;
            if (vidR === 520) {
              tx += (Math.floor(Math.random() * 201) - 100) * 0.6;
              ty += (Math.floor(Math.random() * 201) - 100) * 0.6;
              tx *= (85 + Math.floor(Math.random() * 31)) * 0.015;
              ty *= (85 + Math.floor(Math.random() * 31)) * 0.015;
            }
          } else if (vidR === 481) {
            tx += (Math.floor(Math.random() * 81) - 40) * 0.4; // :59759-59763 ±16
            ty += (Math.floor(Math.random() * 81) - 40) * 0.4;
          } else if (vidR >= 498 && vidR <= 506) {
            tx += (Math.floor(Math.random() * 81) - 40) * 0.3; // :59764-59768 ±12
            ty += (Math.floor(Math.random() * 81) - 40) * 0.3;
          } else if (vidR === 426) {
            tx += (Math.floor(Math.random() * 61) - 30) * 0.3; // :59769-59773 ±9
            ty += (Math.floor(Math.random() * 61) - 30) * 0.3;
          } else if (vidR === 214) {
            tx += Math.floor(Math.random() * 91) - 45;         // :59774-59778 ±45
            ty += Math.floor(Math.random() * 91) - 45;
          } else if (vidR === 216) {
            if (!flag20) {
              tx += Math.floor(Math.random() * 101) - 50;      // :59779-59786 ±50
              ty += Math.floor(Math.random() * 101) - 50;
            }
          } else if (vidR !== 292) {
            tx += Math.floor(Math.random() * 81) - 40;         // :59787-59791 默认 ±40
            ty += Math.floor(Math.random() * 81) - 40;
          }
          const dR = Math.hypot(tx, ty) || 1;
          let vx = (tx / dR) * speed, vy = (ty / dR) * speed;
          // ---- 弹型/伤害（cs:59797-59921）----
          let dmgF = dmg;
          if (R.projDmgScale) {
            dmgF = getAttackDamageForProjectiles(R.projDmgScale[0], R.projDmgScale[1],
              this.difficulty);
          }
          if (vidR === 216 && flag20) {
            this.lai2 = 0; this.lai3 = 0;                      // :59918-59919
          }
          if (vidR === 292) {
            // 战术骷髅四连发（:59955-59968）：每发重新瞄准 ±40、速 12
            for (let n = 0; n < 4; n++) {
              const fx2 = rawPlayer.cx - mx + Math.floor(Math.random() * 81) - 40;
              const fy2 = rawPlayer.cy - my + Math.floor(Math.random() * 81) - 40;
              const fd = Math.hypot(fx2, fy2) || 1;
              this.spawnHostileProj(game, mx, my, (fx2 / fd) * 12, (fy2 / fd) * 12, dmgF, proj);
            }
          } else if (vidR === 424) {
            // 预言者四发扇（:59974-59979）：枪口 Center+(−spriteDir*4, +6)；
            // 末参 whoAmI（G3 通道）——573 蓄能弹的宿主绑定（Projectile.cs:32087
            // 起消费：宿主死 → 立即对最近玩家齐射；宿主活 → 继承其目标）
            const sx = this.cx - this.facing * 4, sy = this.cy + 6;
            for (let k = 0; k < 4; k++) {
              this.spawnHostileProj(game, sx, sy,
                (-3 + 2 * k) * 0.15, -Math.floor(Math.random() * 3) * 0.2 - 0.1, dmgF, proj, this.id);
            }
          } else if (vidR === 409) {
            // 闪爆虫（1457 :60178-60181 type==409 支）：发射 = 生 NPC 410 子弹星，
            // 速度 (vx, −6+vy)。★Bottom 锚（NPC.cs:81594 NewNPC nPC.Bottom=(Center.X,
            //  Center.Y)）→ 左上 = (cx−w/2, cy−h)——★勘误：旧注释"cy−h/2"系算术错
            //  （h/2 是中心锚换算），曾致子弹星低 11px（h=22）
            const star = Enemy.fromVanilla(410, this.cx, this.cy);
            if (star) {
              star.x = this.cx - star.w / 2;
              star.y = this.cy - star.h;
              star.vx = vx;
              star.vy = -6 + vy;
              addEnemy(game, star);
            }
          } else if (vidR === 426) {
            // 蜂后（:59924-59937）：玩家盒内随机点 + GetChaseResults 前置补偿
            const px2 = rawPlayer.x + Math.random() * rawPlayer.w;
            const py2 = rawPlayer.y + Math.random() * rawPlayer.h;
            const chase = getChaseResults(mx, my, speed, px2, py2, rawPlayer.vx, rawPlayer.vy);
            if (chase) {
              const v2 = factorAcceleration(chase.x, chase.y, chase.t, 0.1, 15);
              vx = v2.x; vy = v2.y;
            }
            this.spawnHostileProj(game, mx + vx, my + vy, vx, vy, dmgF, proj);
          } else if (vidR === 411) {
            // 末参 whoAmI（G3 通道）：537 激光弹的宿主绑定（Projectile.cs:30308
            // ——宿主存活期间束原点逐 t 锁回宿主眼部 Center+(dir*6,−4)）
            this.spawnHostileProj(game, mx + vx, my + vy, vx, vy, dmgF, proj, this.id);   // :59970-59973
          } else {
            // 通用：出生点 = 枪口 + 弹速（:59938-59939；214 再 +1.5 倍弹速）
            const ox2 = mx + vx * (vidR === 214 ? 2.5 : 1);
            const oy2 = my + vy * (vidR === 214 ? 2.5 : 1);
            this.spawnHostileProj(game, ox2, oy2, vx, vy, dmgF, proj);
            // 出膛音（Projectile.cs:56221-56225 / :56232-56235 ai[1]==0 首拍）:
            // 弹 438（382 激光枪手）→ Item12、弹 592（520 火星行者）→ Item12——
            // 发射位等价结算（弹先出生后补播,同 bossAI.ts 83=Item_33 先例）
            if (proj === 438 || proj === 592) game.playSfxWav?.('Item_12', 1, mx, my);
          }
          // 姿态分档（cs:59991-60013）
          if (Math.abs(ty) > Math.abs(tx) * 2) this.ai2 = ty > 0 ? 1 : 5;
          else if (Math.abs(tx) > Math.abs(ty) * 2) this.ai2 = 3;
          else this.ai2 = ty > 0 ? 2 : 4;
        }
        // 解除瞄准（cs:60015-60019）：空中（!flag17）或冷却尽
        if ((this.vy !== 0 && !flag17) || this.ai1 <= 0) { this.ai2 = 0; this.ai1 = 0; }
        // 瞄准减速（:60216-60220）：flag17=381/382/520（★不含 468——:60222 的非日食
        // 置位在瞄准块【之后】,块内恒 false=468 残瞄窗照减速）；第二窗项对全型死码
        // （num160 仅 411=120,而 411 已走 !flag17=true）→ 简化为非 freeMove 即减速。
        // 曾误用含日食项的 flag16=468 非日食跳减速 + 411 窗外跳减速（评审 C 定谳修）
        else if (!(vidR === 381 || vidR === 382 || vidR === 520)) {
          this.vx *= 0.9;                                      // :60218 瞄准减速
        }
      }
      // ---- 开瞄（cs:60026-60109）：468 非日食整段跳过（flag16=true 分支）----
      const canOpenAim = !(vidR === 468 && !game.world.clock.eclipse);
      if (canOpenAim && (this.ai2 <= 0 || flag16) && (this.vy === 0 || flag17)
        && this.ai1 <= 0 && !rawPlayer.dead) {
        let flag21 = this.canSeePlayer(st, rawPlayer);         // :60032
        if (vidR === 520) {
          // :60033-60036 CanHitLine(Top+(0,20) → 玩家)
          flag21 = canHitLine(st, this.cx, this.y + 20, 0, 0, rawPlayer.cx, rawPlayer.cy, 0, 0);
        }
        // :60233-60236（1456 :60037-60040）满潜行(stealth==0)且未挥击(itemAnimation==0)
        // → CanHit=false：施法/射击族对满潜行玩家停火（不开瞄）。曾只转录
        // itemAnimation 半边且反向（idle 即停火,潜行半边整缺）——黄蜂待机清零
        // :51312 同款动画窗代理 = itemAnimTicks>0||useTime>0（Enemy.ts:6142 口径）
        if (!(rawPlayer.stealth > 0) && !(rawPlayer.itemAnimTicks > 0 || rawPlayer.useTime > 0)) {
          flag21 = false;
        }
        if (flag21) {
          const dx = rawPlayer.cx - this.cx, dy = rawPlayer.cy - this.cy;
          // :60241-60246 开瞄门矢量 = 原始中心差先做 0.1|dx| 下坠补偿、再 ±40 抖动，
          // 射程判 hypot(gdx,gdy) < num180——非原始中心距（曾按裸 hypot 判,边界差
          // 最多 ±40 抖动 + 0.1|dx| 下坠项 ~70px@700,红蓝对抗 C 定谳 2026-09-02 补；
          // 抖动 81 值域整数 Next(−40,41) 惯用法,勿写 ×80 off-by-one）
          const gdx = dx + (Math.floor(Math.random() * 81) - 40);
          const gdy = dy - Math.abs(dx) * 0.1 + (Math.floor(Math.random() * 81) - 40);
          if (Math.hypot(gdx, gdy) < R.range) {
            this.vx *= 0.5;                                    // :60079
            this.ai2 = 3;                                      // :60083
            this.ai1 = cooldown;
            // 开瞄即细分姿态 1-5（:60279-60303,与发射段 :60187-60209 同式,消费抖动矢量
            // num176/num178——曾只置 3,接姿态渲染时会露差;评审 C 定谳补）
            if (Math.abs(gdy) > Math.abs(gdx) * 2) this.ai2 = gdy > 0 ? 1 : 5;
            else if (Math.abs(gdx) > Math.abs(gdy) * 2) this.ai2 = 3;
            else this.ai2 = gdy > 0 ? 2 : 4;
          }
        }
      }
      // ---- 射击族行走档（cs:60111-60187）：非瞄准（flag16 族瞄准中也走）→
      //  超速落地衰减 / 限速内 ±accel；flag22（381/382<300px、520<400px 视线通）
      //  恒衰减并清 ai[3] ----
      const moveOk = this.ai2 <= 0 || (flag16
        && !(vidR === 411 && this.ai1 >= 120 && this.ai1 < 240));
      if (moveOk) {
        const num182 = R.moveMax ?? 1, num183 = R.moveAccel ?? 0.07, num184 = R.moveDamp ?? 0.8;
        let flag22 = false;
        if (R.nearDampRange
          && Math.hypot(rawPlayer.cx - this.cx, rawPlayer.cy - this.cy) < R.nearDampRange
          && canHitLine(st, this.cx, this.cy, 0, 0, rawPlayer.cx, rawPlayer.cy, 0, 0)) {
          flag22 = true;
          this.ai3 = 0;                                        // :60157/:60162
        }
        if (this.vx < -num182 || this.vx > num182 || flag22) {
          if (this.vy === 0) this.vx *= num184;                // :60164-60170
        } else if (this.vx < num182 && this.facing === 1) {
          this.vx += num183;
          if (this.vx > num182) this.vx = num182;
        } else if (this.vx > -num182 && this.facing === -1) {
          this.vx -= num183;
          if (this.vx < -num182) this.vx = -num182;
        }
      }
    }
    // ---- 冰雪巨人 243 霜冻光束（cs:59331-59360）：ai[2] 计时 ≥ rand(30..900)×(HP 比)+30
    // 且落地 + 朝向玩家 + 视线 → 光束（速 15、伤 32、散布 ±40）；阈值随机数缓存 ai[3]，
    // 发射后双双清零（受击 ai[2]-=rand(30) 略）
    if (this.vanillaId === 243 && player && !player.dead) {
      this.ai2 += 1;
      if (this.ai3 === 0) this.ai3 = 30 + Math.floor(Math.random() * 870);
      if (this.vy === 0 && this.facing === (player.cx > this.cx ? 1 : -1)
        && this.ai2 >= this.ai3 * (this.hp / this.maxHp) + 30 && this.canSeePlayer(st, player)) {
        // 枪口（cs:59323/:59340）：基点 (cx + 10×朝向, y + 20) 瞄准（含 ±40 散布），
        // 出生点再沿弹向 +vel×3（速 15 → 前移 45px）
        const baseX = this.cx + 10 * this.facing, baseY = this.y + 20;
        // ★O3 漏网核销(2026-09-02)：1457 NPC.cs:59516-59517 = Next(-40,41)（81 值域
        // [−40..40]）——曾 `Math.random()*80-40` 浮点 80 宽 off-by-one（+40 端永不可取）
        const bdx = player.cx - baseX + (Math.floor(Math.random() * 81) - 40);
        const bdy = player.cy - baseY + (Math.floor(Math.random() * 81) - 40);
        const bd = Math.hypot(bdx, bdy) || 1;
        this.shootDart(game, baseX + (bdx / bd) * 45, baseY + (bdy / bd) * 45,
          bdx, bdy, 15, 32, 257);
        this.ai2 = 0; this.ai3 = 0;
        return;
      }
    }
    // ---- 岩石巨人 631 投石（F10，cs:56685-56750 全段重写）：num17=100 前摇 /
    //  num18=32。ai[2]==0：玩家 320px 内且 CanHit → 开摇（ai[2]=100、vx=dir×0.01）；
    //  ai[2]<100：每 tick +1、vx×0.9、|vy|>1 打断归零；==84（100−32/2）且未贴脸
    //  且 CanHit → 发岩石（DirectionTo 玩家中心 ×8 + ±0.8 抖动、伤 20、kb1）；
    //  ≥100 钳 100 落位；落地且近（贴脸或 CanHit）→ ai[2]=68 连发循环（100↔68）。
    //  原版发射点 = Center（:56723）----
    if (this.vanillaId === 631 && player && !player.dead) {
      const num17 = 100, num18 = 32;                           // :56693-56694
      const flag2 = Math.hypot(player.cx - this.cx, player.cy - this.cy) < 320;
      const canHit631 = this.canSeePlayer(st, player);
      const overlap = player.x < this.x + this.w && player.x + player.w > this.x
        && player.y < this.y + this.h && player.y + player.h > this.y;
      if (this.ai2 === 0) {
        if (flag2 && canHit631) {
          this.ai2 = num17;                                    // :56700
          this.vx = this.facing * 0.01;                        // :56702
        }
      } else {
        if (this.ai2 < num17) {
          this.ai2 += 1;
          this.vx *= 0.9;                                      // :56711
          if (Math.abs(this.vx) < 0.001) this.vx = 0;
          if (Math.abs(this.vy) > 1) this.ai2 = 0;             // :56716-56719 被挑空打断
          // :56720-56734 发射门：==84（num17−num18/2）且玩家盒不相交且 CanHit
          if (this.ai2 === num17 - num18 / 2 && !overlap && canHit631) {
            const num19 = 8;                                   // :56722
            const dx6 = player.cx - this.cx, dy6 = player.cy - this.cy;
            // Utils.RandomVector2(±0.8) 抖动后 SafeNormalize ×8（:56730-56733）
            const jx = (Math.random() * 1.6 - 0.8), jy = (Math.random() * 1.6 - 0.8);
            const jl = Math.hypot(dx6 + jx, dy6 + jy) || 1;
            this.spawnHostileProj(game, this.cx, this.cy,
              ((dx6 + jx) / jl) * num19, ((dy6 + jy) / jl) * num19, 20, 909);
          }
          if (this.ai2 >= num17) {
            this.ai2 = num17;                                  // :56735-56741 钳满
            this.vx = this.facing * 0.01;
          }
        } else if (this.vy === 0 && flag2 && (overlap || canHit631)) {
          this.ai2 = num17 - num18;                            // :56744-56747 → 68 连发循环
        }
      }
    }
    // ---- 小丑 109 炸弹链（NPC.cs:60394-60425 独立 type 段，**不在**通用射击族
    //      :59464 表——蓝队 R1-01 补全段，此前纯走位零威胁）：ai[2] 计时 +
    //      justHit 清零（:60399-60401）；>60t 过 AI_GlobalFiringDistanceCheck
    //      视野门（:60405，全函数第 11 处接线，超视野不投掷防隐形炮）；
    //      4/5 掷或场上已有 378 → 投 75 HappyBomb（伤 80/timeLeft 300，出手点
    //      (cx−dir×24, y+4)，速 (Next(3,8)×dir, Next(−8,−5))=:60412-60414）；
    //      1/5 且无 378 → 同点召 378 咬齿炸弹（NewNPC Bottom 锚 :81594；AI_041
    //      自爆链已实装 Enemy.ts herplingAI）+ ai[2]=−120 长冷却（:60420-60423）。
    //      netMode!=1 门 = 单人恒真（房主权威）
    if (this.vanillaId === 109 && player && !player.dead) {
      if (this.justHit) this.ai2 = 0;                                    // :60399-60401
      this.ai2 += 1;                                                     // :60402
      if (this.ai2 > 60) {                                               // :60403
        const mx = this.cx - this.facing * 24, my = this.y + 4;          // :60404 vector38
        if (!aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)) {
          this.ai2 = 0;                                                  // :60405-60407
        } else if (Math.floor(Math.random() * 5) !== 0                   // :60408 Next(5)!=0
          || (game.enemies() as Enemy[]).some((n) => !n.dead && n.vanillaId === 378)) {
          // AnyNPCs(378)（:60408 全场扫描）
          this.spawnHostileProj(game, mx, my,
            (3 + Math.floor(Math.random() * 5)) * this.facing,           // :60412 Next(3,8)×dir
            -8 + Math.floor(Math.random() * 3),                          // :60413 Next(−8,−5)
            80, 75);                                                     // :60414 伤 80（timeLeft 300=表内）
          this.ai2 = 0;                                                  // :60417
        } else {
          this.ai2 = -120;                                               // :60420
          const bomb = Enemy.fromVanilla(378, mx, my);                   // :60421 NewNPC
          if (bomb) {
            bomb.y = my - bomb.h;          // NewNPC Bottom 锚（:81594）= 底边中点落点
            (game as unknown as { entities?: { add: (en: unknown, b: string) => void } })
              .entities?.add(bomb, 'enemies');
          }
        }
      }
    }
    // ---- Eyezor 251 死光（NPC.cs:59335-59378：独立 type 段，**不在**通用射击族
    // （:59464 表无 251）；ai[2] 每 tick +1（:59349），justHit 倒扣 rand(30)（:59337），
    // confused 清零（:59345），负值钳 0（:59341）。阈值 = rand(60..1799)×(HP比)+15
    // （:59350-59352 每次判定重掷）。命中门：计时达标 + 落地 + 玩家存活且未冰冻
    // （:59353 !Main.player[target].frozen = buff 47）+ 朝向玩家 + CanHit；再过
    // <700px 距离门（:59363-59364）→ EyeLaser 83（速 15 伤 30；枪口
    // (Center.X + 6×direction, position.Y + 12)，瞄准 + 散布 ±40 / Y −30..−1，
    // 出生点沿弹向 +vel×3）；发射后 ai[2]=0（:59374）
    if (this.vanillaId === 251 && player) {
      if (this.justHit) this.ai2 -= Math.floor(Math.random() * 30);      // :59337-59340
      if (this.ai2 < 0) this.ai2 = 0;                                    // :59341-59344
      if (this.confused) this.ai2 = 0;                                   // :59345-59348
      this.ai2 += 1;                                                     // :59349
      // num142（:59350-59352）：rand(60,1800) × (life/lifeMax) + 15
      const num142 = (60 + Math.floor(Math.random() * 1740)) * (this.hp / this.maxHp) + 15;
      const facingPlayer = (this.facing > 0 && this.cx < player.cx)
        || (this.facing < 0 && this.cx > player.cx);                     // :59353 direction 锥
      if (this.ai2 >= num142 && this.vy === 0 && !player.dead
        && !player.buffs?.has(BuffType.Frozen)                           // :59353 !frozen
        // 1457 :59545-59549 flag14 = AI_GlobalFiringDistanceCheck 入开火门
        && facingPlayer && aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)
        && this.canSeePlayer(st, player)) {
        // 枪口（:59356-59357）：(Center.X + 6×direction, position.Y + 12)
        const mx = this.cx + 6 * this.facing, my = this.y + 12;
        // ★O3 漏网核销(2026-09-02)：1457 NPC.cs:59558 = Next(-40,41)（81 值域 [−40..40]，
        // 非 ±41！）——曾 `Math.random()*82-41` 双端错位（min −41 越界 + max 41 不可取）
        let num144 = player.cx - mx + (Math.floor(Math.random() * 81) - 40);   // 1456:59358 / 1457:59558
        let num145 = player.cy - my + (Math.floor(Math.random() * 30) - 30); // :59359/:59361 −30..−1
        const num146 = Math.hypot(num144, num145);                       // :59362
        // ★R8 F2:1456 伪影门删除——1457(:59562-59566)无 <700 距离门(远距由
        // flag14=AI_GlobalFiringDistanceCheck 承担,链内已接 :5349);原版归一化后直射
        const num143 = 15;                                             // :59355 弹速
        // 出生点沿弹向 +vel×3（:59371-59372）
        const u = num146 || 1;
        // ★N 批:出膛音 Item_33（AI_001 首拍 ai[1]==0 :56195-56199,发射位等价结算
        // 与 shootBolt462 先例同构;Eyezor 251 同款 :59335-59378 本位即此处）
        game.playSfxWav?.('Item_33', 1, this.cx, this.cy);
        this.shootDart(game, mx + (num144 / u) * num143 * 3, my + (num145 / u) * num143 * 3,
          num144, num145, num143, 30, 83);                             // :59373 proj 83 伤 30
        this.ai2 = 0;                                                  // :59374
      }
    }
  }

  /** 471 哥布林术士全 AI（F12，NPC.cs:56886-57113）。ai[3] 状态机：
   *    0   地面：ai[2] 计数——落地且 472 幻影 <10 → ≥180 转召唤（ai[3]=1）；
   *        否则（空中或满员 ai[2]+1）≥360 → 起飞（ai[3]=−2、vy−=3）；玩家 >800px → −1
   *    1   召唤演出：顶上 70px 处 60t 时召 472 暗焰幻影、90t 转 −2（升空离场）；
   *        每 tick 2 颗紫色汇聚尘
   *    -1  追踪飞行：TargetClosest + 8+距/200 速度 1/40 平滑逼向玩家；
   *        <500px 且未嵌实心 → 落地态 0
   *    -2  升空：vy−0.2 钳 −10；玩家低于自身 200px → −3 并记 ai[2]=水平朝向
   *    -3  滑翔：vy×0.9、vx += ai[2]×0.3 钳 ±10；越过玩家 300px → −4；距 >800 → −1
   *    -4  下降：vy+0.1、|v|>4 ×0.9；脚下 3 格有实心且未嵌 → 0；
   *        ai[2]>300 或低于玩家+200 → −1（无 return——继续走通用行走段）
   *  ai[3]<0 全程：kbResist=0、防×1.1、noGravity+noTileCollide、rotation=vx×0.1、
   *  lai3 计数 rand(20,180) 到点在 Center+velocity 生混沌球 NPC 30；
   *  ai[3]==1 追加 kbResist=0+防+10。玩家死亡 → EncourageDespawn(1)。
   *  @returns true = 本 tick 已接管（调用方跳过通用段；-4 返回 false 走通用段，
   *  位移经 fighterAI 尾部的飞行直积分支） */
  private goblinWarlockStep(game: GameHooks, player: Player | null): boolean {
    if (this.vanillaId !== 471) return false;
    if (this.warlockDefBase === undefined) {
      this.warlockDefBase = this.def.defense ?? 0;             // defDefense 基线快照
    }
    const flying = this.ai3 < 0;
    if (flying) {
      this.kbResistOverride = 0;                               // :56890
      this.def.defense = Math.trunc(this.warlockDefBase * 1.1); // :56891 (int)(defDefense*1.1)
      this.noGravity = true;                                   // :56892-56893
      if (this.vx < 0) this.facing = -1;                       // :56894-56901
      else if (this.vx > 0) this.facing = 1;
      this.visAngle = this.vx * 0.1;                           // :56902 rotation
      this.lai3 += 1;                                          // :56905
      if (this.lai3 > 20 + Math.floor(Math.random() * 160)) {  // :56906 Next(20,180)
        this.lai3 = 0;
        const ball = Enemy.fromVanilla(30, this.cx + this.vx, this.cy + this.vy);
        // ★Bottom 锚（1457 :57092 center6=Center+velocity → NewNPC Bottom=(X,Y)）:
        //  球顶 = cy+vy−h——旧中心锚低 h/2
        if (ball) { ball.y = this.cy + this.vy - ball.h; addEnemy(game, ball); }   // :57092
      }
    } else {
      this.lai3 = 0;                                           // :56917
      this.kbResistOverride = getKnockbackMultiplierScaledByDifficulty(0.35, this.difficulty); // :56918
      this.visAngle *= 0.9;                                    // :56919
      this.def.defense = this.warlockDefBase;                  // :56920
      this.noGravity = false;                                  // :56921
    }
    if (this.ai3 === 1) {
      this.kbResistOverride = 0;                               // :56926
      this.def.defense += 10;                                  // :56927
    }
    const flyIntegrate = () => {                               // noGravity+noTileCollide 直移
      this.x += this.vx;
      this.y += this.vy;
    };
    if (this.ai3 === -1) {
      if (player) this.facing = this.seekDirX(player);         // :56931 TargetClosest
      const num32 = 8 + Math.hypot((player?.cx ?? this.cx) - this.cx,
        (player?.cy ?? this.cy) - this.cy) / 200;              // :56932-56936
      const dx = (player?.cx ?? this.cx) - this.cx, dy = (player?.cy ?? this.cy) - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      const tvx = (dx / d) * num32, tvy = (dy / d) * num32;    // :56937-56938
      this.vx = (this.vx * 39 + tvx) / 40;                     // :56939 (v*39+tv)/40
      this.vy = (this.vy * 39 + tvy) / 40;
      if (d < 500 && !this.embeddedInSolid(game.world.store)) {
        this.ai3 = 0;                                          // :56942-56943
        this.ai2 = 0;
      }
      flyIntegrate();
      return true;                                             // :56945
    }
    if (this.ai3 === -2) {
      this.vy -= 0.2;                                          // :56949
      if (this.vy < -10) this.vy = -10;
      if (player && player.cy - this.cy > 200) {               // :56954
        if (player) this.facing = this.seekDirX(player);       // :56956 TargetClosest
        this.ai3 = -3;
        this.ai2 = player.cx > this.cx ? 1 : -1;               // :56958-56965
      }
      this.vx *= 0.99;                                         // :56967
      flyIntegrate();
      return true;                                             // :56968
    }
    if (this.ai3 === -3) {
      if (this.facing === 0 && player) this.facing = this.seekDirX(player);   // :56972-56975
      if (this.ai2 === 0) this.ai2 = this.facing;              // :56976-56979
      this.vy *= 0.9;                                          // :56980
      this.vx += this.ai2 * 0.3;                               // :56981
      this.vx = Math.max(-10, Math.min(10, this.vx));
      const num35 = (player?.cx ?? this.cx) - this.cx;         // :56990
      if ((this.ai2 < 0 && num35 > 300) || (this.ai2 > 0 && num35 < -300)) {
        this.ai3 = -4;                                         // :56991-56994
        this.ai2 = 0;
      } else if (Math.abs(num35) > 800) {
        this.ai3 = -1;                                         // :56996-56999
        this.ai2 = 0;
      }
      flyIntegrate();
      return true;                                             // :57001
    }
    if (this.ai3 === -4) {
      this.ai2 += 1;                                           // :57005
      this.vy += 0.1;                                          // :57006
      if (Math.hypot(this.vx, this.vy) > 4) { this.vx *= 0.9; this.vy *= 0.9; } // :57007-57010
      const num36 = Math.floor(this.cx / TILE);
      const num37 = Math.floor((this.y + this.h + 12) / TILE); // :57011-57012
      let flag4 = false;                                       // :57013-57024 脚下 3 格实心
      for (let l = num36 - 1; l <= num36 + 1; l++) {
        if (game.world.store.inBounds(l, num37)
          && game.world.store.get(l, num37) !== 0
          && game.world.store.isSolid(l, num37)) flag4 = true;
      }
      if (flag4 && !this.embeddedInSolid(game.world.store)) {
        this.ai3 = 0;                                          // :57025-57029
        this.ai2 = 0;
      } else if (this.ai2 > 300
        || (player && this.cy > player.cy + 200)) {
        this.ai3 = -1;                                         // :57030-57034
        this.ai2 = 0;
      }
      // :57036 无 return——本仓返回 false 走通用段（飞行直积分支在 fighterAI 尾部）
      return false;
    }
    if (this.ai3 === 1) {
      // 召唤演出（:57038-57075）
      const center7 = { x: this.cx, y: this.cy - 70 };
      this.vx *= 0.8;                                          // :57042
      this.ai2 += 1;
      if (this.ai2 === 60) {
        const phantom = Enemy.fromVanilla(472, center7.x, center7.y + 18);
        // ★Bottom 锚（1457 :57229 NewNPC((int)center7.X,(int)center7.Y+18) →
        //  Bottom=(X,Y)）:幻影顶 = cy−52−h——旧中心锚低 h/2
        if (phantom) { phantom.y = center7.y + 18 - phantom.h; addEnemy(game, phantom); }   // :57229
      } else if (this.ai2 >= 90) {
        this.ai3 = -2;                                         // :57051-57054
        this.ai2 = 0;
      }
      for (let m = 0; m < 2; m++) {                            // :57056-57073 汇聚尘 ×2
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.random() * 10;
        game.spawnParticles(center7.x + Math.cos(ang) * rad, center7.y + Math.sin(ang) * rad,
          '#B050E0', 1, 0.8, { life: 26, damp: 0.94 });
      }
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      return true;                                             // :57074
    }
    // ---- 地面态（:57076-57104）----
    this.ai2 += 1;
    const num39 = 10;                                          // 幻影上限
    const cnt472 = (game.enemies() as Enemy[]).filter((o) => !o.dead && o.vanillaId === 472).length;
    if (this.vy === 0 && cnt472 < num39) {
      if (this.ai2 >= 180) {
        this.ai2 = 0;                                          // :57082
        this.ai3 = 1;
      }
    } else {
      if (cnt472 >= num39) this.ai2 += 1;                      // :57088-57091
      if (this.ai2 >= 360) {
        this.ai2 = 0;                                          // :57092-57097 起飞
        this.ai3 = -2;
        this.vy -= 3;
      }
    }
    if (player && !player.dead
      && Math.hypot(player.cx - this.cx, player.cy - this.cy) > 800) {
      this.ai3 = -1;                                           // :57099-57103 远距转飞
      this.ai2 = 0;
    }
    if (player && player.dead) {
      this.encourageDespawn(1);                                // :57105-57112
    }
    return false;
  }

  /** 自身碰撞盒是否嵌在实心块内（Collision.SolidCollision 近似——逐格实心判定） */
  private embeddedInSolid(st: GameHooks['world']['store']): boolean {
    for (let tx = Math.floor(this.x / TILE); tx <= Math.floor((this.x + this.w - 0.01) / TILE); tx++) {
      for (let ty = Math.floor(this.y / TILE); ty <= Math.floor((this.y + this.h - 0.01) / TILE); ty++) {
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  /** 419 日耀旋刃怪冲刺（NPC.cs:57114-57173，AI_003_Fighters 内 type==419 专属段，
   *  位于通用行走段之前——各分支 return 跳过行走/跳跃/远程，仅留全局重力+碰撞）。
   *  ai[2] 状态机（num40=6 / num41=10 / num42=16）：
   *    >0   落地恢复倒数（触地或受击置 60）
   *    0    巡航：面朝玩家 + 视线 → -1（本 tick 仍走通用段，cs 无 return）
   *    -1..-6  蓄力：vx×0.9
   *    -7   发射：朝 player.Top+(0,-30) 方向 ×16
   *    <-7  冲刺：-17 起 vy+0.15 钳 24（前 10t 无重力增量）；反射弹幕 + 受击 ×3
   *  拖尾渲染（ai2≤-9 oldPos 拖尾）已就位：Renderer NPC_GLOW[419] mode 'trail'。
   *  @returns true = 冲刺族本 tick 已自管重力+碰撞，调用方应跳过通用战士段 */
  private solenianDashAI(game: GameHooks, player: Player): boolean {
    const WINDUP = 6;    // num40：蓄力 tick 数（-1..-6）
    const DASH_SPEED = 16; // num42：冲刺初速
    this.reflectsProjectiles = false;
    this.takenDamageMultiplier = 1;
    if (this.ai2 > 0) this.ai2 -= 1;
    if (this.ai2 === 0) {
      // 巡航待发（cs:57124-57131）：面朝玩家（direction 与玩家水平侧一致）+ 中心视线
      if (((player.cx < this.cx && this.facing < 0) || (player.cx > this.cx && this.facing > 0))
        && this.canSeePlayer(game.world.store, player)) {
        this.ai2 = -1;
      }
      return false;   // 未触发/刚起手 → 本 tick 走通用行走段（cs 该分支无 return）
    }
    if (this.ai2 < 0 && this.ai2 > -WINDUP) {
      // 蓄力减速（cs:57135-57140）
      this.ai2 -= 1;
      this.vx *= 0.9;
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      return true;
    }
    if (this.ai2 === -WINDUP) {
      // 发射（cs:57141-57152）：朝玩家头顶上方 30px 直冲；零向量退化 (spriteDirection,-1)
      this.ai2 -= 1;
      let dx = player.cx - this.cx;
      let dy = (player.y - 30) - this.cy;   // player.Top + (0,-30)
      let d = Math.hypot(dx, dy);
      if (d < 0.001) { dx = this.facing || 1; dy = -1; d = Math.hypot(dx, dy); }
      this.vx = (dx / d) * DASH_SPEED;
      this.vy = (dy / d) * DASH_SPEED;
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      return true;
    }
    if (this.ai2 < -WINDUP) {
      // 冲刺（ai2 < -6，cs:57153-57177）。★恢复态（ai2>0 且未到 0）原版整个 else
      // 块无一命中 → 直接落回通用行走段（A 批修：曾无条件落进冲刺段把恢复态
      // 也置 reflectsProjectiles=true——"复位后同 tick 又拉满"的残留根因之一）
      this.ai2 -= 1;
      // 落地判定读上一 tick 碰撞结果（原版 velocity.Y==0f 是碰撞后清零值）
      if (this.vy === 0) this.ai2 = 60;
      else if (this.ai2 < -WINDUP - 10) this.vy = Math.min(this.vy + 0.15, 24); // num41=10
      this.reflectsProjectiles = true;
      this.takenDamageMultiplier = 3;
      if (this.justHit) this.ai2 = 60;
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      return true;
    }
    return false;   // ai2>0 恢复倒数中：走通用行走段（cs else 块无命中即落穿）
  }

  /** AI_003 远程战士参数（NPC.cs:59464-60197 各 type 修正汇总，F2/F4/F9/F19/F20 批
   *  2026-08-19 全量对账 + 火星七型补齐）：
   *  cooldown=蓄力时长（num163）/ fireAt=发射点（num165，缺省 num163/2；424/426=
   *  num163−1、411=220、292=60）/ speed=弹速（num166）/ dmg=弹伤（num171）/ range=
   *  开瞄距离（num181 默认 700）/ drop=下坠补偿系数（num168，默认 0.1；0=直射；
   *  [lo,hi] = 每发 rand(lo..hi)，可负）/ spread=散布 ±px（num167 后修正，默认 40）/
   *  oy=枪口 Y 偏移 / burst=连发数（292 ×4 各自重新瞄准速 12，cs:59967）/
   *  aimDecelOffEclipse=非日食不因瞄准减速且不开新瞄（468 :60026-60029 flag16 门）/
   *  aimFreeMove=瞄准中照常行走（flag16：381/382/520 及 411 窗外）/
   *  projDmgScale=[normal,expert] 对（GetAttackDamage_ForProjectiles）/ moveMax/
   *  moveAccel/moveDamp=射击族行走档（:60111-60187）/ nearDampRange=flag22 近距
   *  衰减门（381/382=300、520=400，:60153-60163） */
  private static readonly RANGED_FIGHTERS = new Set([
    111, 214, 215, 216,                       // 入侵：哥布林弓手/海盗三件
    110, 206, 290, 291, 292, 293, 350,        // 骷髅弓手/冰鱼人/圣骑士/神射/战术/爆破/精灵弓手
    449, 450, 451, 452, 481,                  // 投骨骷髅×4/希腊骷髅
    498, 499, 500, 501, 502, 503, 504, 505, 506, // 蝾螈族
    379, 380,                                 // 拜月教弓手（cs:56575 仪式待机解除后射击，num163=80）
    468,                                      // 蝇博士 Dr. Man Fly（日食，cs:59464 表内）
    // ---- F9 火星批（cs:59464 表补齐，2026-08-19）----
    381, 382,                                 // 脑洗器/射线枪手
    411, 409, 424, 426, 520,                  // 观星者/闪爆虫/预言者/蜂后/火星行者
  ]);
  private static readonly RANGED_TABLE: Record<number, {
    cooldown: number; speed: number; dmg: number; range: number;
    fireAt?: number;
    // ★drop/spread/burst 是【记录性字段,运行链零消费】——实际下坠补偿/散布/连发
    // 全在下方 if 链硬编码（弹速补偿 :5008-5017、散布 :5019-5051、四连发 :5068-5074）。
    // 改数值必须改 if 链,改表无效（红蓝对抗 R3 定谳:290 曾误记 drop:0,实为 0.1 默认链）
    drop?: number | [number, number]; spread?: number; oy?: number; burst?: number;
    aimDecelOffEclipse?: boolean;
    aimFreeMove?: boolean;
    projDmgScale?: [number, number];
    moveMax?: number; moveAccel?: number; moveDamp?: number;
    nearDampRange?: number;
    /** 原版弹型（NPC.cs:59797 起各 num172：贴图/旋转/重力见 Dart.ts DART_STYLE） */
    proj: number;
  }> = {
    111: { cooldown: 180, speed: 9, dmg: 11, range: 700, drop: 0.1, proj: 81 },
    379: { cooldown: 80, speed: 11, dmg: 40, range: 700, drop: 0.1, proj: 81 },  // 拜月教弓手（F19：num171=40 cs:59807-59810；num163=80 :59494）
    380: { cooldown: 80, speed: 11, dmg: 40, range: 700, drop: 0.1, proj: 81 },
    214: { cooldown: 50, speed: 10, dmg: 25, range: 500, drop: 0, spread: 45,
      moveMax: 2, moveAccel: 0.09, proj: 180 },
    215: { cooldown: 90, speed: 14, dmg: 35, range: 650, drop: 0.08,
      moveMax: 1.5, moveAccel: 0.08, proj: 82 },
    216: { cooldown: 9, speed: 9, dmg: 30, range: 700, drop: 0.1, spread: 50, proj: 180 },
    110: { cooldown: 70, speed: 11, dmg: 35, range: 700, drop: 0.1, proj: 82 },          // 骷髅弓手 火焰箭
    206: { cooldown: 50, speed: 7, dmg: 37, range: 700, drop: 0.1, oy: -10, proj: 177 },  // 冰鱼人 冰水吐息
    290: { cooldown: 30, speed: 9, dmg: 60, range: 700, drop: 0.1, oy: -10,
      projDmgScale: [60, 45], proj: 300 },   // 圣骑士 圣锤（:60078-60082 (60,45)+:60142-60145 重映射）
    291: { cooldown: 200, speed: 11, dmg: 100, range: 700, drop: 0, spread: 8, proj: 302 },// 骷髅神射 狙击弹（R6-B 1-4：num165 无覆写=默认 11，:59805；曾误 4=293 的值）
    292: { cooldown: 120, speed: 11, dmg: 50, range: 700, drop: 0, fireAt: 60, burst: 4, proj: 180 }, // 战术骷髅（F2：num165=120/2=60；速度同为默认 11，:59805 无 292 覆写）
    293: { cooldown: 90, speed: 4, dmg: 60, range: 700, drop: 0.1, proj: 303 },           // 骷髅爆破 火箭
    350: { cooldown: 110, speed: 11, dmg: 45, range: 700, drop: 0.1, proj: 82 },          // 精灵弓手（:59506/:59609 默认 11/:59811-59814）
    449: { cooldown: 70, speed: 7, dmg: 15, range: 200, drop: [0.1, 0.49], proj: 471 },   // 投骨骷髅（F20：drop rand 0.10-0.49、散布默认 ±40）
    450: { cooldown: 70, speed: 7, dmg: 15, range: 200, drop: [0.1, 0.49], proj: 471 },
    451: { cooldown: 70, speed: 7, dmg: 15, range: 200, drop: [0.1, 0.49], proj: 471 },
    452: { cooldown: 70, speed: 7, dmg: 15, range: 200, drop: [0.1, 0.49], proj: 471 },
    481: { cooldown: 100, speed: 8, dmg: 18, range: 400, drop: [-0.035, 0.035], spread: 16, oy: -14, proj: 508 }, // 希腊骷髅 标枪（F20：drop ±0.0035×rand(−10..10)）
    498: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 }, // 蝾螈吐息（F20：rand(1..10)×0.0025）
    499: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    500: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    501: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    502: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    503: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    504: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    505: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    506: { cooldown: 70, speed: 7, dmg: 14, range: 190, drop: [0.0025, 0.025], spread: 12, oy: -8, proj: 572 },
    // 蝇博士 Dr. Man Fly（cs:59493 num163=70 默认 / :59662-59665 num166=7.5 /
    // :59727-59730 num168=rand(10..49)×0.01 / :59815-59818 num171=50 /
    // :59861-59864 num172=501 / :60072-60075 num181=400；:60026-60029 非日食不减速）
    468: { cooldown: 70, speed: 7.5, dmg: 50, range: 400, drop: [0.1, 0.49], spread: 40,
      proj: 501, aimDecelOffEclipse: true },
    // ---- F9 火星批（2026-08-19）----
    // 381 脑洗器（:59498-59501 num163=80 / :59687-59690 枪口 +6 / :59719-59722 drop 0 /
    //  :59745-59757 ±40×rand / :59827-59831 弹 436 伤 24 / 重映射(24,19.2)=:60146-60149,弹 436=:59827-59831）
    381: { cooldown: 80, speed: 11, dmg: 24, range: 700, drop: 0, oy: 6,
      aimFreeMove: true, projDmgScale: [24, 19.2],
      moveMax: 2, moveAccel: 0.5, nearDampRange: 300, proj: 436 },
    // 382 射线枪手（:59642-59645 num166=7 / :59832-59836 弹 438 伤 30 / 其余同 381）
    382: { cooldown: 80, speed: 7, dmg: 30, range: 700, drop: 0, oy: 6,
      aimFreeMove: true, projDmgScale: [30, 24],
      moveMax: 2, moveAccel: 0.5, nearDampRange: 300, proj: 438 },
    // 411 观星者（:59471-59480 flag16/num161=120/num162=120/flag18=ai1>220 /
    //  :59546-59549 num163=330 / :59589-59592 num165=220 / :59666-59669 num166=1 /
    //  :59865-59869 弹 537 伤 (60,45) / :60137-60141 行走 2/0.5）
    411: { cooldown: 330, speed: 1, dmg: 60, range: 700, drop: 0.1, fireAt: 220,
      aimFreeMove: true, projDmgScale: [60, 45],
      moveMax: 2, moveAccel: 0.5, proj: 537 },
    // 409 闪爆虫（:59550-59553 num163=60 / :59650-59653 num166=4 /
    //  :59981-59985 发射 = NewNPC 410 子弹星，速度 (num167, −6+num169)）
    409: { cooldown: 60, speed: 4, dmg: 0, range: 700, drop: 0.1, proj: 0,
      moveMax: 2, moveAccel: 0.5 },
    // 424 预言者（:59554-59557 num163=180 / :59581-59584 num165=179 /
    //  :59870-59874 弹 573 伤 (60,45) / :59974-59979 四发扇：枪口 Center+(−sd*4,+6)、
    //  vx=(−3+2k)×0.15、vy=−rand(0,3)×0.2−0.1）
    424: { cooldown: 180, speed: 11, dmg: 60, range: 700, drop: 0.1, fireAt: 179,
      projDmgScale: [60, 45], proj: 573 },
    // 426 蜂后（:59558-59561 num163=60 / num165=59 / :59896-59901 枪口 +=(sd*2,−12)
    //  ——纵半走 oy:−12、横半 sd*2 在枪口行 vidR===426 支；曾整缺=出膛/追逐点低 12px
    //  横偏 ±2（评审 C 定谳补）/ num166=7 / :59875-59879 弹 581 伤 (60,45) /
    //  :59924-59937 追逐者前置补偿：玩家盒内随机点 GetChaseResults +
    //  FactorAcceleration((0,0.1),15) / :60015 flag17：瞄准不因空中解除）
    426: { cooldown: 60, speed: 7, dmg: 60, range: 700, drop: 0.1, fireAt: 59, oy: -12,
      spread: 9, projDmgScale: [60, 45],
      moveMax: 4, moveAccel: 0.6, moveDamp: 0.95, proj: 581 },
    // 520 火星行者（:59502-59505 num163=15 / :59646-59649 num166=8 /
    //  :59887-59890 枪口=【赋值】Top+20(顶边绝对,盒高 110→oy=−35;曾误记中心+20=低 55px)
    //  / :59751-59757 双层抖动 / :60022-60026 num171=592/num170=35 固定——★无
    //  ForProjectiles 重映射（重映射块 :60142-60149 仅 290/381-392）,expert 亦恒 35,
    //  曾误记 projDmgScale[35,28]=高难度少伤 20%（评审 C 定谳撤）/
    //  :60131-60136 行走 4/1/0.7 / :60159-60163 flag22 400）
    520: { cooldown: 15, speed: 8, dmg: 35, range: 700, drop: 0, oy: -35,
      aimFreeMove: true,
      moveMax: 4, moveAccel: 1, moveDamp: 0.7, nearDampRange: 400, proj: 592 },
  };

  /** 蜘蛛家族地面↔爬墙形态对照（NPC.cs:59276-59289 地→墙 / :29994-30008 墙→地）：
   *  164 Wall Creeper→165 Wall Creeper Wall、236→237 Black Recluse、163→238、239→240、530→531 */
  private static readonly SPIDER_WALL_FORM: Record<number, number> = { 164: 165, 236: 237, 163: 238, 239: 240, 530: 531 };
  private static readonly SPIDER_GROUND_FORM: Record<number, number> = { 165: 164, 237: 236, 238: 163, 240: 239, 531: 530 };
  /** 地面/爬墙形态 id 集（1457 :59489-59491 衰减块/:59460 变换块字面）★R3-4 */
  private static readonly SPIDER_GROUND_IDS = [164, 236, 163, 239, 530];
  private static readonly SPIDER_WALL_IDS = [165, 237, 238, 240, 531];

  /** NPCCanStickToWalls 1:1（NPC.cs:56209-56229）：身体中心 3×3 内"非实心 tile 且有背景墙"
   *  的格数 >4 → 可贴墙（蜘蛛洞/洞穴天然满足，地表不满足 → 落回地面形态） */
  /** NPCCanStickToWalls（NPC.cs:56382-56403 无参版 + 1457 :56357-56380 transformID 版）：
   *  中心 3×3 内 >4 格"可通行且有背景墙"才算贴墙。1457 新签名按【变换后尺寸】
   *  （TryGetAdjustedHitboxFromTransformation = Collision.TryChangingSizeFromBottomCenter
   *  :81885-81893）评估——蜘蛛地↔墙互变时用目标形态的盒判断能否贴墙,失败回退
   *  现尺寸。transformId 缺省 = 无参版（现盒）。 */
  private npcCanStickToWalls(st: GameHooks['world']['store'], transformId?: number): boolean {
    const evaluate = (bx: number, by: number, bw: number, bh: number): boolean => {
      const cx = Math.floor((bx + bw / 2) / TILE), cy = Math.floor((by + bh / 2) / TILE);
      let n = 0;
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let j = cy - 1; j <= cy + 1; j++) {
          if (!st.inBounds(i, j)) continue;
          const ii = st.idx(i, j);
          const passable = st.type[ii] === 0 || !st.isSolid(i, j) || st.isPlatform(i, j);
          if (passable && st.wall[ii] > 0) {
            n++;
            if (n > 4) return true;
          }
        }
      }
      return false;
    };
    if (transformId !== undefined) {
      // TryGetAdjustedHitboxFromTransformation：底边中心锚定的尺寸变换盒（挪位
      // 失败 = null → 回退现盒,原版 :56366-56377 同构）
      const adj = this.computeAdjustedHitboxFromTransformation(transformId, st);
      if (adj && evaluate(adj.x, adj.y, adj.w, adj.h)) return true;
    }
    return evaluate(this.x, this.y, this.w, this.h);
  }

  /** Collision.TryChangingSizeFromBottomCenter（NPC.cs:81885-81893 纯求值版,
   *  不写回 position）：按目标 id 尺寸自底边中心扩/收盒,空间不足返回 null。
   *  与 tryMoveToTransformableSpaceInto 共用探移算法（该函数 = 本式 + 写回） */
  private computeAdjustedHitboxFromTransformation(
    id: number, st: GameHooks['world']['store'],
  ): { x: number; y: number; w: number; h: number } | null {
    const v = vanillaNpc(id);
    if (!v) return null;
    const s = v.scale ?? 1;
    const tw = Math.round(v.width * s), th = Math.round(v.height * s);
    let x = this.x, y = this.y, w = this.w, h = this.h;
    // 盒与实心（含半砖上半净空）是否相交
    const rectClear = (bx: number, by: number, bw: number, bh: number): boolean => {
      const tx0 = Math.floor(bx / TILE), tx1 = Math.floor((bx + bw - 0.01) / TILE);
      const ty0 = Math.floor(by / TILE), ty1 = Math.floor((by + bh - 0.01) / TILE);
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          if (!st.inBounds(tx, ty) || !st.isSolid(tx, ty)) continue;
          const top = ty * TILE + (st.half[st.idx(tx, ty)] ? 8 : 0);
          if (bx < (tx + 1) * TILE && bx + bw > tx * TILE
            && by < (ty + 1) * TILE && by + bh > top) return false;
        }
      }
      return true;
    };
    // 沿轴向最大可滑行像素（d=0 起逐像素；首撞返回 d−1）
    const freeTravel = (axis: 'x' | 'y', delta: number, amount: number,
      bx: number, by: number, bw: number, bh: number): number => {
      for (let d = 1; d <= amount; d++) {
        const nx = axis === 'x' ? bx + delta * d : bx;
        const ny = axis === 'y' ? by + delta * d : by;
        if (!rectClear(nx, ny, bw, bh)) return d - 1;
      }
      return amount;
    };
    const num = th - h;                                        // :2498 纵向高差
    if (num > 0) {
      const num2 = freeTravel('y', 1, num, x, y, w, h);        // :2501 向下可探
      const num3 = freeTravel('y', -1, num, x, y, w, h);       // :2502 向上可探
      if (num3 + num2 < num) return null;                      // :2503-2506
      let num4 = Math.min(num, num3);                          // :2507
      let num5 = 0;                                            // :2508
      let val = num - num4 - num5;
      num4 += Math.min(val, num3 - num4);
      val = num - num4 - num5;
      num5 += Math.min(val, num2 - num5);
      y -= num4;                                               // :2513 顶上移 num4
      h += num4 + num5;                                        // :2514 底下延 num5
    } else {
      y -= num;                                                // :2518（num≤0 → 顶下移）
      h = th;
    }
    const num6 = tw - w;                                       // :2521 横向宽差
    if (num6 > 0) {
      const num7 = freeTravel('x', 1, num6, x, y, w, h);       // :2524 向右可探
      const num8 = freeTravel('x', -1, num6, x, y, w, h);      // :2525 向左可探
      if (num8 + num7 < num6) return null;                     // :2526-2529
      let num10 = Math.min(Math.trunc(num6 / 2), Math.min(num8, num7));  // :2531
      let num9 = num10;
      let val2 = num6 - num10 - num9;
      num10 += Math.min(val2, num8 - num10);
      val2 = num6 - num10 - num9;
      num9 += Math.min(val2, num7 - num9);
      x -= num10;                                              // :2536 左延 num10
      w += num10 + num9;                                       // :2537 右延 num9
    } else {
      x += Math.trunc(num6 / 2);                               // :2541 居中收窄
      w = tw;
    }
    return { x, y, w, h };
  }

  /** Transform 1:1（1458 NPC.cs:81909-81940 = 台账"81861-81919"同义锚）：换类型 +
   *  按比例结转 HP + ai[0..3] 清零；位置锚定 = withReposition 的 Y 加旧高减新高
   *  （底边对齐）+ X 不动（左缘保持），【无】实心重叠检测——★2026-08-31 ⑧清偿：
   *  删除旧"新盒撞实心整体拒收"多加语义与 X 居中锚定，嵌墙态由物理救援承接
   * （TryChangingSizeFromBottomCenter 只属于蜘蛛族挪位链 TryMoveToTransformableSpaceInto,
   *  与本函数并存不互替）。game 可选 = TransformVisuals（:82051 Transform 尾对所有
   *  转化统一调用）播音效用——见 transformVisuals */
  /** TryMoveToTransformableSpaceInto（NPC.cs:81836-81848 + Collision.
   *  TryChangingSizeFromBottomCenter :2495-2545，K2 批 2026-08-19）：蜘蛛族地↔墙
   *  Transform 前的"挪位"——按目标盒先纵向（需长高：上探优先、余量补下探，探距
   *  不足整段放弃）再横向（需加宽：左右对半起步、余量再补）扩盒并写回 position。
   *  探距 = 盒沿该轴向可自由滑行的像素数（TileCollisionInStepsOf16 :2462-2493 的
   *  逐像素等价；半砖按上半 8px 净空计）。返回 false = 挪不进 → 不转化。
   *  成功后调用方走 tryTransformTo(…, allowEmbedded=true)（原版 Transform
   *  withReposition:false——挪位已就绪，跳过底边锚定自检）。 */
  private tryMoveToTransformableSpaceInto(id: number, st: GameHooks['world']['store']): boolean {
    // 求值体已抽到 computeAdjustedHitboxFromTransformation（F-40 微光/蜘蛛变换
    // 贴墙检查共用同一 TryChangingSizeFromBottomCenter 算法）——本函数 = 求值 + 写回
    const box = this.computeAdjustedHitboxFromTransformation(id, st);
    if (!box) return false;
    this.x = box.x;                                            // :81846 position = box.TopLeft()
    this.y = box.y;
    return true;
  }

  private tryTransformTo(id: number, st: GameHooks['world']['store'], allowEmbedded = false, game?: GameHooks): boolean {
    const v = vanillaNpc(id);
    if (!v) return false;
    // ★⑧变换拒收改底边改尺寸式（2026-08-31，1458 NPC.cs:81909-81940=台账
    //  "81861-81919" 同义锚；allowEmbedded 形参保留兼容蜘蛛链 — withReposition
    //  仅控制 Y 锚定,X 一律不动）:
    //  原文序 = position.Y += 旧高（顶移到底缘）→ SetDefaults(newType) 换 w/h →
    //  position.Y -= 新高 ⇒ 底边对齐、X 不动【左缘保持】,全程无实心重叠检测——
    //  本仓旧实现"新盒撞实心整体拒收"(+X 居中锚定) 为多加语义已删;嵌墙后由
    //  unembedPass/物理救援承接(原版同态)。锚定差异表：
    //   旧 nx=cx−nw/2 → 原版语义左缘不动(nx=this.x)；ny 两版同（底边对齐）
    const oldType = this.vanillaId;
    const nx = this.x;                            // X 恒左缘保持（原版无水平位移）
    void st;                                      // st 形参保留:嵌墙自检已删
    const oldMax = this.maxHp;                    // :81916 num3 = 旧 lifeMax（缩放后终值）
    // ★BJ101（2026-09-16）：Transform → SetDefaults(newType)（:81921）= SetDefaults
    // 【全链】重跑——remix 主体块 → 首盒 (int) 截断（:17842-17843）→ defDamage 快照
    // （:17846-17848）→ zenith（:17871-17874 只改 lifeMax）/getGood（:17875-17878，13
    // ×1.35+def+2 / 14,15 ×1.4+def+2、二盒 :18122-18123）/十周年（:17879-17882，列族
    // ×0.5、二盒 :17958-17959 恒乘）→ ScaleStats（:17888，活体 Main.Difficulty+玩家数
    // 门）→ life=lifeMax（:17889）。旧实现全取基表值（盒 round 无二盒、maxHp/damage/
    // defense/kb/value 停经典档）= 与已移植 spawn 段（fromVanilla 同链）内部不一致。
    // 链体经 seedTailBox/applyRemixSetDefaults/applySeedAdjustments/scaleStats 单源复用
    // （禁止第二套种子/难度实现，fx43 同族），与 fromVanilla 逐式同参。
    const rawDamage = (v.critter || v.friendly) ? 0 : v.damage;   // defDamage 基线（:17846 快照在种子/难度乘【前】）
    const rawKb = v.knockBackResist ?? 1;          // SetDefaults 缺省 1f（NPC.cs:8449）
    const seedS: SeedAdjustStats = {
      type: id, scale: v.scale ?? 1, lifeMax: v.lifeMax, defense: v.defense, damage: v.damage,
      value: npcValueOf(id),
      canDisplayBuffs: true,   // NPC.canDisplayBuffs 默认 true（NPC.cs:6124）
    };
    const remixHit = applyRemixSetDefaults(seedS, scaleStatsWorld());
    const vScale = seedS.scale;                    // ★首盒乘数=remix 后种子档前（SC1 读取点纪律）
    const seedBox = applySeedAdjustments(seedS, scaleStatsWorld());
    const { w: nw, h: nh } = seedTailBox(v.width, v.height, vScale, seedS.scale, seedBox);
    const ny = this.y + this.h - nh;              // Y 底边对齐(:81912-81918)
    this.vanillaId = id;
    // ★netID 重推导（实报 2026-09-15「杀宁芙不触发傻瓜骗子」定谳）：原版 Transform
    // → SetDefaults(newType) 尾 NPC.cs:17849 `netID = type`——变身即脱变体，出生
    // netId 不跟随。本仓 spawnNPC 无条件 `vanillaNetId = netId`（VanillaSpawner.ts:676，
    // 失落女孩 195 出生即 netId=195）→ tryTransformTo 换 vanillaId 后 netId 陈旧，
    // 击杀链 `vanillaNetId!==0 ? netId : id`（Game.onEnemyKilled killAchId/图鉴
    // killNetId/旗 recordBannerKill/Enemy.hurt lastCreatureHit 四消费点）全按 195 计：
    // DECEIVER_OF_FOOLS（NPCKilledCondition 196,AchievementInitializer.cs:207）永不
    // 完成、图鉴 killNetId 错账(★RB31 勘误:旗半边不成立——BannerSystem.cs:618-620
    // case 195/196 同旗 80,旗/lastCreatureHit 修复前后照样进账)。原版 Transform 后 netID 恒
    // 等于新 type（恒正 id），本仓编码 0≙"无变体=vanillaId"（四消费点统一
    // `!==0 ? netId : id` 归一，Enemy.ts:14109 同惯例）→ 置 0 即 1:1。
    this.vanillaNetId = 0;
    this.vanilla = v;
    this.w = nw; this.h = nh;
    this.x = nx; this.y = ny;
    const ss: ScalingStats = {
      type: id, lifeMax: seedS.lifeMax, damage: seedS.damage,
      value: seedS.value ?? npcValueOf(id),   // ★IIIII228：remix value ×scale 已并入（同 fromVanilla）
      defense: seedS.defense, knockBackResist: rawKb,
      boss: VANILLA_BOSS_IDS.has(id), friendly: !!v.friendly, townNPC: !!v.townNPC,
      scale: seedS.scale, difficulty: 0,
    };
    scaleStats(ss);                            // :17888 ScaleStats（活体难度/玩家数门，同 fromVanilla 无显式参）
    this.difficulty = ss.difficulty;           // npc.difficulty（AI 段 GetAttackDamage_* 消费）
    this.baseDamage = rawDamage;               // :17846 defDamage 快照语义（未缩放基线，弹幕出膛用）
    // HP 结转 life = num2 * lifeMax / num3（:81931，C# int 乘除=逐级 (int) 截断，
    // ≤0 钳 1 :81933-81935）——num2=旧 life、num3=旧【缩放】lifeMax、lifeMax=新【缩放】
    // lifeMax ⇒ 新缩/旧缩比例结转。旧实现 Math.round 且分子用【基表】lifeMax（新基/旧缩
    // =伪值），专家/大师世界 HP 比例错档 + .5 处舍入偏差。
    this.maxHp = ss.lifeMax;
    this.hp = Math.max(1, Math.trunc((this.hp * ss.lifeMax) / oldMax));
    // 飞行档表达式与 fromVanilla 同源（noGravity 数据族 + aiStyle 2/5/14/23/44）
    const flying = v.noGravity || v.aiStyle === 2 || v.aiStyle === 5 || v.aiStyle === 14
      || v.aiStyle === 23 || v.aiStyle === 44;
    this.noGravity = flying;   // 运行时位随 Transform 重置（原版 SetDefaults 复位语义）
    this.def = {
      ...this.def,
      name: v.name, hp: ss.lifeMax, damage: rawDamage !== 0 ? ss.damage : 0, defense: ss.defense,
      width: nw, height: nh,
      // ScaleStats 终态击退承受比例/掉钱值（:18211 GetKnockbackMultiplier_*、
      // :18208 EnemyMoneyDropMultiplier）——旧实现残留旧型值（348→349 kb/value 停旧档）
      knockbackResist: ss.knockBackResist,
      value: ss.value,
      flying,
      boss: VANILLA_BOSS_IDS.has(id),
      hitSound: vanillaSoundFiles(v.HitSound) ?? ['NPC_Hit_1'],
      killedSound: v.DeathSound === null ? [] : vanillaSoundFiles(v.DeathSound) ?? ['NPC_Killed_1'],
      drops: [], // 掉落走 NpcDrops 规则树（击杀时求值，不再预展开）
    };
    // 种子档 canDisplayBuffs（FTW 245-248 石巨人族 false）+ 渲染乘区（与 fromVanilla
    // 同式：种子/remix 命中才写，经典世界不写=缺省 1 零漂移）
    this.canDisplayBuffs = seedS.canDisplayBuffs !== false;
    if (seedBox || remixHit) this.vanillaScale = seedS.scale / (v.scale ?? 1);
    // ★BJ704-G3 D10：SetDefaults 全链重跑 ⇒ 捕获窗同链复位——① releaseOwner=255
    //   （SetDefaults 复位块 NPC.cs:8473）：变身即脱「释放出生」籍（释放鸭湿身
    //   走→飞形 Transform 后重新计入 nearby 槽=原版同拍）；② catchable 计数重置
    //   （:17883-17887）——变身型为 npcCatchable 时窗口重新武装（释放鸭变身即
    //   重新获得 90t 玩家免伤窗=原版 quirk 照单全收）
    this.releasedFromItem = false;
    this.catchImmunityT = NPC_CATCHABLE.has(id) ? 90 : 0;
    this.catchFriendly = this.catchImmunityT > 0;
    // Transform 换音组（如蝙蝠 158→吸血鬼 159 换 NPCHit/Death）同样预热——
    // 变形态首击的懒加载竞态与出生路径同构
    enemySoundPrewarm?.([...this.def.hitSound, ...this.def.killedSound]);
    // ★BJ101 尾刀（2026-09-16）：SetDefaults 其余复位面随刀——alpha/color/dontCountMe/
    // TargetClosest（各自在 Transform :81909-81970 变身序内的锚）：
    //  - alpha/color：SetDefaults :8553 alpha=0 / :8554 color=default → per-type 终值
    //    （13/14/15 :8949/:8969/:8989 =255；color 全库仅 1/16/537 三型 :8611/:9003/
    //    :15897，本仓数据面未提取=登记债）。旧实现变身保留旧 spawnAlpha/alphaFade/
    //    colorRGBA → EoW 身段晋升（Transform(13),1457 :52057/:52061）不重渐显 + AI_006 尾段尘 14
    //    死链（渐显段 alphaFade 门 Enemy.ts:2333）、净Id变体史莱姆残色二次绘制。
    //    与 fromVanilla 出生初始化单源 initSetDefaultsAlphaColor（fx43 双源防漂移）。
    //  - dontCountMe：:8472 复位=false → per-type（14/15 等 32 id 置 true）。本仓无
    //    per-instance 位——NPC_DONT_COUNT_ME_1457 静态表按当前 vanillaId 求值（雷达
    //    谓词唯一读点），上一行换 id 即隐式复位（vanilla 31 处写点全在 SetDefaults
    //    主体块内=按型常量，表求值与字段复位同构；tests/transform-setdefaults-tail 有行为锁）。
    this.initSetDefaultsAlphaColor(id, v);
    // ★BJ468：dontTakeDamageFromHostiles 复位+per-type 静态置位（Transform 全链重跑
    //  SetDefaults 序章 :8529 复位+:13803/:13822/:17670 置位同构）——此前实例旗残留:
    //  686 死亡 Transform(680)（Game.onEnemyKilled 686 支）会把旗带给骑手;374→375
    //  变身（遁地松露虫主生产路）由本行承接置位
    this.dontTakeDamageFromHostiles = Enemy.DONT_TAKE_DAMAGE_FROM_HOSTILES_SETDEFAULTS.has(id);
    //  - TargetClosest（:81926，SetDefaults ClearTarget 后重建）：变身即重索敌。本仓
    //    架构 targetClosest 每 AI tick 于 fixedUpdate 头刷新（:2069）且只选目标不抢
    //    朝向（facing 由各 AI 族 seekDirX 消费——鱼链 retarget 补的是朝向半边）；此处
    //    补 :81926 的【同拍】重选。旧实现变身沿用旧 targetPlayer 一拍：单人单候选退化
    //    零观察，联机平距边例 1 拍窗。game 缺省（无 game 的调用点/测试桩）= 下拍头
    //    targetClosest 承接（原版语义下拍同值）。
    if (game) this.targetClosest(game);
    this.ai0 = 0; this.ai1 = 0; this.ai2 = 0; this.ai3 = 0;
    this.transformVisuals(game, oldType, id);
    return true;
  }

  /** TransformVisuals（NPC.cs 1456:81739-81771 / 1457:81788-81820——Transform 尾部
   *  1456:81902 / 1457:81961 对所有转化统一
   *  调用,按 (oldType,newType) 对分发）。当前移植对仅 158⇄159（吸血蝙蝠⇄吸血鬼,
   *  1456:81742-81749 / 1457:81791-81798）：Item_8 + 3 个 gore 99（三锚点 y−10 / y+h/2−10 / y+h−10、
   *  初速 ×0.3——GorePiece 血块收缩族含 99）。478→479（dust 238+gore 684-686）/
   *  406→405 等其余对无音效号,粒子侧未移植维持现状。 */
  private transformVisuals(game: GameHooks | undefined, oldType: number | null, newType: number): void {
    if (!game) return;
    if (!((oldType === 158 && newType === 159) || (oldType === 159 && newType === 158))) return;
    game.playSfxWav?.('Item_8', 1, this.cx, this.cy);
    for (const gy of [this.y - 10, this.y + this.h / 2 - 10, this.y + this.h - 10]) {
      GorePiece.newGore(99, this.x, gy, this.vx * 0.3, this.vy * 0.3, this.vanillaScale ?? 1);
    }
  }

  /** 外部 AI 文件的 Transform 入口（骑手 390 失坐骑 → 382,cs:36291）。
   *  allowEmbedded：noTileCollide 族（EoW 断链晋升 13/15 常处实心块内）跳过
   *  实心重叠自检——原版 Transform 无此回退（SetDefaults 后仅底边锚定改尺寸） */
  transformTo(id: number, st: GameHooks['world']['store'], allowEmbedded = false, game?: GameHooks): boolean {
    return this.tryTransformTo(id, st, allowEmbedded, game);
  }

  /** NPC.FishTransformationDuringRain（NPC.cs:94084-94115，UpdateCollision :93742
   *  每 tick 调——wet 计算后、位移积分前）：雨天金鱼链。
   *  230 行走金鱼 wet → 55 游形（vy<0 归 0）；55 非湿且 raining → 230 + homeTileX
   *  挪 position.X/16+10×direction（下风重建家）；593/592 镜像同链。
   *  放置：Game 敌怪轮（entities.update 后逐敌调用——wet 已是本 tick 新值）。 */
  fishTransformationDuringRain(game: GameHooks): void {
    if (this.dead || this.netPuppet) return;
    const vid = this.vanillaId;
    if (vid === null) return;
    const st = game.world.store;
    const raining = game.world.weather.raining;
    // Transform 内 TargetClosest（:81875）→ direction 朝玩家；离场玩家保旧向。
    // M11：TargetClosest = 当前索敌目标（联机可为访客），无目标史回退本地
    const retarget = (): void => {
      const p = this.targetRef(game);
      if (p && !p.dead) this.facing = p.cx >= this.cx ? 1 : -1;
    };
    if (vid === 230 && this.wet) {
      if (this.transformTo(55, st, false, game)) { retarget(); if (this.vy < 0) this.vy = 0; }
    } else if (vid === 55 && !this.wet && raining) {
      if (this.transformTo(230, st, false, game)) {
        retarget();
        this.critterHomeX = Math.floor(this.x / TILE) + 10 * this.facing;   // :94101
      }
    } else if (vid === 593 && this.wet) {
      if (this.transformTo(592, st, false, game)) { retarget(); if (this.vy < 0) this.vy = 0; }
    } else if (vid === 592 && !this.wet && raining) {
      if (this.transformTo(593, st, false, game)) {
        retarget();
        this.critterHomeX = Math.floor(this.x / TILE) + 10 * this.facing;   // :94114
      }
    }
  }

  /** NPC.GetShimmered（NPC.cs:92502-92584）子集：雕像产怪直接消散（:92504-92519）→
   *  ShimmerTransformToNPC 则 Transform（:92521-92533）→ ShimmerTransformToItem 则
   *  掉微光化物品后消散（:92535-92560）。表来自 tools/extract-shimmer.mjs
   *  （114 NPC 对 + 15 NPC→物品）。原版四分支全落空时整函数为空操作（无表项 Boss
   *  浸微光仅反复空调用，:92502-92573 无 else 兜底）——先判分支可达再出转化特效，
   *  避免每 90t 粒子空刷；城镇变体分支（:92560-92573）在 TownNPC 侧实现 */
  private npcGetShimmered(game: GameHooks): void {
    if (this.vanillaId === null) return;
    const toNpc = npcShimmerTransformTo(this.vanillaId);
    const toItem = npcShimmerTransformToItem(this.vanillaId);
    // 空操作门：非雕像产怪且无任何转化目标 → 原版同帧不产生任何副作用
    if (!this.spawnedFromStatue && !(toNpc >= 0 && toNpc !== this.vanillaId) && toItem < 0) return;
    this.shimmerT = 0;
    // 发声/尘面 = WorldItem.ShimmerEffect（WorldItem.cs:1690-1727）：SoundID.Item176
    // （LegacySoundPlayer.cs:519-523 case2 num==176 → 音量 ×0.9）+ 20× dust 309
    // （scale×1.2 + Next(6) 四色表）——原版三实支（雕像消散 :92672 / Transform 后
    // :92684 / 化物 :92689）各调一次；城镇变体支（:92691-92704,本仓 TownNPC 侧）
    // 不调（其到位音 = Spawn_ShimmerTownNPC 的 Item29/manaCrystal,TownNPC 尾部已接）。
    // ★2026-09-17 微光发声面普查接线：此前整缺（旧 '#BFE8FF' 10 粒泛用粒子系
    // ShimmerEffect 尘的近似替身,已随本刀退役为原版 309 四色直尘）
    if (this.spawnedFromStatue) {           // SpawnedFromStatue → active=false（:92508-92514）
      this.shimmerEffectFace(game);         // ShimmerEffect(base.Center)（:92672）
      this.dead = true;
      return;
    }
    if (toNpc >= 0 && toNpc !== this.vanillaId) {
      this.transformTo(toNpc, game.world.store, false, game);
      this.shimmerEffectFace(game);         // Transform() 后 ShimmerEffect(base.Center)（:92684）
      return;
    }
    if (toItem >= 0) {
      const key = VANILLA_ITEM_KEY_BY_ID[toItem];
      if (key) {
        const d = game.spawnDrop(this.cx, this.cy, key, 1);
        if (d) { d.shimmered = true; d.shimmerTime = 1; }  // 微光化物品上浮（:92540-92545）
      }
      this.shimmerEffectFace(game);         // ShimmerEffect(base.Center)（:92689）
      this.dead = true;                    // noSpawnCycle + active=false（:92557-92559）
    }
  }

  /** WorldItem.ShimmerEffect（WorldItem.cs:1690-1727）本体面：Item_176 ×0.9 +
   *  20× dust 309（NewDust(Center,1,1,309) 后 scale×1.2 + Next(6) 四色表）。
   *  消费位 = npcGetShimmered 三实支（上注）——2026-09-17 接线 */
  private shimmerEffectFace(game: GameHooks): void {
    game.playSfxFile?.('Item_176', 0.9, this.cx, this.cy);
    for (let i = 0; i < 20; i++) {
      const d = game.spawnDust?.(this.cx, this.cy, 1, 1, 309);
      if (d) {
        d.scale *= 1.2;                     // :1701 scale *= 1.2f
        const roll = (Math.random() * 6) | 0;   // Main.rand.Next(6)（:1702）
        d.color = roll === 0 ? { r: 255, g: 255, b: 210, a: 255 }
          : roll === 1 ? { r: 190, g: 245, b: 255, a: 255 }
          : roll === 2 ? { r: 255, g: 150, b: 255, a: 255 }
          : { r: 190, g: 175, b: 255, a: 255 };
      }
    }
  }

  /** AI_040 爬墙蜘蛛族 1:1（NPC.cs:29784-30022）：无重力、贴背景墙表面爬行。
   *  速度表：165 默认 2/0.08、237 3/0.12、531 4/0.16（:29789-29798）；
   *  有视线 → 分轴伺服追玩家（:29880-29920，朝向角 atan2(期望速度)）；
   *  无视线 → ai[0] ±200 振荡漂移（:29833-29878，角 atan2(当前速度)）；
   *  531 朝向角额外 +π/2（:29922）；spriteDirection 恒 -1（:29829，渲染层处理）；
   *  碰撞反弹（:29924-29950）：旧速 ×-0.5，X 朝移动方向保底 ±2、Y 保底 ±2；
   *  专家模式毒液弹（1457 :30045-30063，type 472）★R3-4 已补（lai0 蓄力+
   *  lai1 变换冷却；曾备案"未启用专家模式"——World.isExpert 已实装，理由失效）；
   *  脱墙（NPCCanStickToWalls 假）→ Transform 回地面形态（:29991-30010） */
  private wallCreeperAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    let maxSpd = 2, accel = 0.08;
    if (this.vanillaId === 237) { maxSpd = 3; accel = 0.12; }
    else if (this.vanillaId === 531) { maxSpd = 4; accel = 0.16; }
    // 目标向量（8px 量化，:29799-29819）；无目标/目标死亡 → 沿方向漂离上浮（:29824-29827）
    let tx: number, ty: number;
    const alive = !!player && !player.dead;
    if (alive) {
      tx = Math.floor(player!.cx / 8) * 8 - Math.floor(this.cx / 8) * 8;
      ty = Math.floor(player!.cy / 8) * 8 - Math.floor(this.cy / 8) * 8;
      // K1（cs:29811-29815）：confused → 目标向量反向且加倍（归一化前）
      if (this.confused) { tx *= -2; ty *= -2; }
    } else {
      tx = this.facing * maxSpd / 2;
      ty = -maxSpd / 2;
    }
    const dist = Math.hypot(tx, ty);
    let sx: number, sy: number; // 期望速度向量（num636/637）
    if (dist === 0) { sx = this.vx; sy = this.vy; }
    else { sx = (tx / dist) * maxSpd; sy = (ty / dist) * maxSpd; }
    // direction（TargetClosest 语义：朝目标水平方向；死亡保持）
    if (alive) this.facing = this.seekDirX(player!);
    const los = alive ? this.canSeePlayer(st, player!) : false;
    if (!los) {
      // 无视线：振荡漂移（:29833-29878）——ai[0] 驱动的 X/Y 交替扰动 + 微弱趋目标分量
      if (this.ai0 < -200) this.ai0 = 0; // 类默认 -1120 钳回原版下界（同 swarmerAI 清查）
      this.ai0 += 1;
      this.vy += this.ai0 > 0 ? 0.023 : -0.023;
      this.vx += (this.ai0 < -100 || this.ai0 > 100) ? 0.023 : -0.023;
      if (this.ai0 > 200) this.ai0 = -200;
      this.vx += sx * 0.007;
      this.vy += sy * 0.007;
      this.visAngle = Math.atan2(this.vy, this.vx);
      if (this.vx > 1.5 || this.vx < -1.5) this.vx *= 0.9;
      if (this.vy > 1.5 || this.vy < -1.5) this.vy *= 0.9;
      this.vx = Math.max(-3, Math.min(3, this.vx));
      this.vy = Math.max(-3, Math.min(3, this.vy));
    } else {
      // 有视线：分轴非对称伺服（:29880-29920，与 servoTo 同构、目标为期望速度）
      if (this.vx < sx) {
        this.vx += accel;
        if (this.vx < 0 && sx > 0) this.vx += accel;
      } else if (this.vx > sx) {
        this.vx -= accel;
        if (this.vx > 0 && sx < 0) this.vx -= accel;
      }
      if (this.vy < sy) {
        this.vy += accel;
        if (this.vy < 0 && sy > 0) this.vy += accel;
      } else if (this.vy > sy) {
        this.vy -= accel;
        if (this.vy > 0 && sy < 0) this.vy -= accel;
      }
      this.visAngle = Math.atan2(sy, sx);
    }
    if (this.vanillaId === 531) this.visAngle += Math.PI / 2; // :29922
    // 移动 + 碰撞反弹（:29924-29950；旧速 = 碰撞前速度）
    const oldVx = this.vx, oldVy = this.vy;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) {
      this.vx = oldVx * -0.5;
      if (this.facing === -1 && this.vx > 0 && this.vx < 2) this.vx = 2;
      if (this.facing === 1 && this.vx < 0 && this.vx > -2) this.vx = -2;
    }
    if (this.hitHead || this.onGround) {
      this.vy = oldVy * -0.5;
      if (this.vy > 0 && this.vy < 1.5) this.vy = 2;
      if (this.vy < 0 && this.vy > -1.5) this.vy = -2;
    }
    // 行走帧累加（FindFrame case 165/237/238/240/531，cs:73795-73817：
    // frameCounter += (|vx|+|vy|)×0.5（531 ×0.4），24 一循环）
    this.crawlT = (this.crawlT + (Math.abs(this.vx) + Math.abs(this.vy))
      * (this.vanillaId === 531 ? 0.4 : 0.5)) % 24;
    // 脱墙 → TryMoveToTransformableSpaceInto 挪位后 Transform 回地面形态
    // （:29990-30014；K2 批 2026-08-19：挪不进目标盒空间则不转化）。
    // 1457 :30085 贴墙检查改 NPCCanStickToWalls(groundForm)——按【变换后地面形态】
    // 的盒评估（TryGetAdjustedHitboxFromTransformation）,失败回退现盒。
    // ★R3-4 1457 :30084 lai1==0 冷却门 + 变换后 lai1=12（:30091）+ 墙形态每帧衰减
    const groundForm = Enemy.SPIDER_GROUND_FORM[this.vanillaId ?? -1];
    if (this.lai1 === 0 && groundForm !== undefined && !this.npcCanStickToWalls(st, groundForm)
      && this.tryMoveToTransformableSpaceInto(groundForm, st)) {
      this.tryTransformTo(groundForm, st, true, game);
      this.lai1 = 12;
    }
    if (this.vanillaId != null && Enemy.SPIDER_WALL_IDS.includes(this.vanillaId)) {
      this.lai1 = Math.max(0, this.lai1 - 1);
    }
    // ---- ★R3-4 专家毒液弹（1457 :30045-30063,AI_040 版多 !player.dead 门）：
    //      与 AI_003 版共用 lai0 蓄力语义（墙形态 237/238 照吐）
    if (!this.confused && game.world.isExpert && alive
      && (this.vanillaId === 163 || this.vanillaId === 238
        || this.vanillaId === 236 || this.vanillaId === 237)
      && this.canSeePlayer(st, player!)) {
      this.lai0++;
      if (this.justHit) {
        this.lai0 -= Math.floor(Math.random() * 40) + 20;      // Next(20,60)
        if (this.lai0 < 0) this.lai0 = 0;
      }
      if (this.lai0 > Math.floor(Math.random() * 720) + 180) { // Next(180,900)
        this.lai0 = 0;
        const vdx = player!.cx - this.cx, vdy = player!.cy - this.cy;
        const vl = Math.hypot(vdx, vdy) || 1;
        const dmgV = getAttackDamageForProjectiles(18, 18, this.difficulty);
        this.spawnHostileProj(game, this.cx, this.cy, (vdx / vl) * 8, (vdy / vl) * 8, dmgV, 472);
      }
    }
  }

  /** Collision.CanHit 1:1（Collision.cs:388-480）：实体矩形 → 逐 tile 扫描。
   *  半砖/坡面/平台/已致动/开门态不阻挡；"两邻格均为整实心"= 被夹住 → 无视线 */
  private canSeePlayer(st: GameHooks['world']['store'], p: Player): boolean {
    return canHit(st, this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h);
  }

  /** AI_042 失落女孩 1:1（NPC.cs:30281-30310）：伪装成无害 NPC 静止站立（无移动逻辑，
   *  仅重力）；玩家靠到 200px 内有视线、或自身被推动/下落/受伤（ai[0] 0→1 的三重触发，
   *  cs:30292-30300）→ 21 tick 后 Transform(196 Nymph) 显形追杀 */
  private lostGirlAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    if (this.ai0 < 0) this.ai0 = 0; // 类字段默认 -1120 是史莱姆专用初值；原版 ai[0] 从 0 起步
    if (this.ai0 === 0) {
      if (player && !player.dead) {
        const dx = player.cx - this.cx, dy = player.y - this.cy;
        if (Math.hypot(dx, dy) < 200 && this.canSeePlayer(st, player)) this.ai0 = 1;
      }
      if (this.vx !== 0 || this.vy < 0 || this.vy > 2 || this.hp !== this.maxHp) this.ai0 = 1;
    } else {
      this.ai0 += 1;
      if (this.ai0 >= 21) {
        this.ai0 = 21;
        if (this.tryTransformTo(196, st, false, game)) return;
      }
    }
    // 静止站立 + 重力（原版 AI_042 无任何速度代码）
    this.vx = 0;
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
  }

  /** AI_000 被缚 NPC（NPC.cs:19774-19893）：105/106/123/354 静态站立（面朝玩家+摩擦，
   *  无任何移动）；376 睡渔夫/579 醉酒酒保水上漂流（vy=-0.4 上浮 + 缓漂）。
   *  376/579 在永不沾水表（:94252）→ wet 恒 false，原版用水线判定：wet || 头顶上方格
   *  ((position.Y-4)/16) 有液体（:19818-19820）——睡在水面上恒漂不沉。
   *  解救（对话 Transform 成对应城镇 NPC）在 TownNPC 侧；Enemy 侧仅防御性兜底 */
  private boundNPCAI(game: GameHooks, player: Player | null) {
    if (player && !player.dead) this.facing = this.seekDirX(player);
    this.vx *= 0.93;
    if (Math.abs(this.vx) < 0.1) this.vx = 0;
    const st = game.world.store;
    if (this.vanillaId === 376 || this.vanillaId === 579) {
      const headTile = st.liquid[st.idx(
        Math.floor(this.cx / TILE), Math.floor((this.y - 4) / TILE))] > 0;
      if (headTile) {
        this.vy = -0.4;                     // 水面漂流（cs:19821-19883）
        this.vx *= 0.99;
        this.x += this.vx; this.y += this.vy;
        return;
      }
    }
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
  }

  /** AI_017 秃鹫 61（Raven 301 同块，NPC.cs:24079-24209）：ai[0]=0 栖息（重力站立），
   *  200px 盒与玩家相交 / life<max / 有速度 → 起飞（vy-=6）单向 0→1 不回落；
   *  飞行态无重力：X accel 0.1 clamp±3，Y 目标=玩家上方（|dx|>50 再抬高 100）accel 0.05 clamp±3；
   *  碰撞反弹旧速×-0.5（X 朝 direction 保底 2 / Y 保底 1） */
  private vultureAI(game: GameHooks, player: Player | null) {
    if (this.ai0 < 0) this.ai0 = 0;
    // noGravity 运行时位（:24079-24084）：AI 开头恒 true，栖息 0 态置 false——
    // StrikeNPC :82217 受击档（def.flying=false 覆盖不到，2026-08-17 补）
    this.noGravity = true;
    if (this.ai0 === 0) {
      this.noGravity = false;
      // TargetClosest 每 tick 刷新（:24085 栖息态帧首——FindFrame 落地支
      // spriteDirection=±direction 消费：秃鹫 61 正向(:74236)=面向玩家、
      // 渡鸦 301 反向(:74260)=背向玩家,各自 vanilla 观感）。player 死亡门
      // =本仓 seekDirX 调用侧统一约定（飞行支同门）
      if (player && !player.dead) this.facing = this.seekDirX(player);
      // 唤醒判定用重力前的速度（原版 AI 先读 velocity、重力在其后施放——
      // 落地碰撞清零后站立态 vy==0，不会被本 tick 重力误判成"有速度"）
      const preVy = this.vy;
      const near = player && !player.dead
        && Math.abs(player.cx - this.cx) < 100 + (this.w + player.w) / 2
        && Math.abs(player.cy - this.cy) < 100 + (this.h + player.h) / 2;
      if (this.vx !== 0 || preVy < 0 || preVy > 0.3) {
        // 速度触发唤醒(:24091):置 ai[0]=1 但不跳(无 vy-=6)
        this.ai0 = 1;
        return;
      }
      if (near || this.hp < this.maxHp) {
        // 玩家靠近/掉血唤醒(:24101-24105):起身跳 vy-=6
        this.ai0 = 1;
        this.vy = -6;
        return;
      }
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      return;
    }
    if (!player) {
      // 玩家死亡（:24105 `else if (!dead)` 包住全部 steering）：原版速度冻结由
      // 共享积分段滑行——本仓等价"只积分"。曾造 ty=cy-100 自引用悬停目标 =
      // 永远够不到 → vy 收敛 -3 无限上飞出世界顶（审计 A2,2026-08-19）
      moveAndCollide(this, game.world, this.vx, this.vy);
      return;
    }
    if (player && !player.dead) this.facing = this.seekDirX(player);
    const dir = this.facing;
    // (:24151-24170) else-if 链:基础 ∓0.1;>3(同向满速不可达档)/>0(逆行)追加 ∓0.05;
    // 曾把逆行追加错写成 ∓0.1(减速过猛)
    if (dir === -1 && this.vx > -3) {
      this.vx -= 0.1;
      if (this.vx > 3) this.vx -= 0.1;
      else if (this.vx > 0) this.vx -= 0.05;
      if (this.vx < -3) this.vx = -3;
    } else if (dir === 1 && this.vx < 3) {
      this.vx += 0.1;
      if (this.vx < -3) this.vx += 0.1;
      else if (this.vx < 0) this.vx += 0.05;
      if (this.vx > 3) this.vx = 3;
    }
    // 悬停目标(:24172-24174):player.Y - h/2;水平距离>50 → 再抬 100px。
    // ★曾写成【vy】与【世界坐标 ty】比较(单位错位恒 false → 永远 vy+=0.05 向下
    // 加速):秃鹫唤醒后不悬停,贴地乱撞冲向玩家。原版比较的是 position.Y 与 ty
    let ty = player && !player.dead ? player.y - this.h / 2 : this.cy - 100;
    if (player && Math.abs(player.cx - this.cx) > 50) ty -= 100;
    if (this.y < ty) {
      this.vy += 0.05;
      if (this.vy < 0) this.vy += 0.01;   // :24183-24185 上行中额外 +0.01 减速(曾写反 -0.01)
    } else {
      this.vy -= 0.05;
      if (this.vy > 0) this.vy -= 0.01;
    }
    // （秃鹫无沙球攻击——:24475 沙球块属 aiStyle 19 蚁狮,曾误植于此并错用
    //  ai0 状态机字段自减,已撤;蚁狮侧 antlionAI 已含 Item_5 音,2026-08-18 复核）
    this.vy = Math.max(-3, Math.min(3, this.vy));
    const oldVx = this.vx, oldVy = this.vy;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) {
      this.vx = -oldVx * 0.5;
      if (this.facing === -1 && this.vx > 0 && this.vx < 2) this.vx = 2;
      if (this.facing === 1 && this.vx < 0 && this.vx > -2) this.vx = -2;
    }
    if (this.hitHead || this.onGround) {
      this.vy = -oldVy * 0.5;
      if (Math.abs(this.vy) < 1) this.vy = this.vy >= 0 ? 1 : -1;
    }
    // 入水(:24194-24208):vy>0 ×0.95 阻下落,恒 -0.5 上浮,下限 -4
    if (this.inWater) {
      if (this.vy > 0) this.vy *= 0.95;
      this.vy -= 0.5;
      if (this.vy < -4) this.vy = -4;
    }
  }

  /** AI_019 蚁狮 69（NPC.cs:24465-24595）：完全不动（knockBackResist=0）；底部 3 列任一
   *  实心 → 无重力上浮 0.2 出沙面（cs:24543 动态 noTileCollide），否则正常落地；
   *  沙球（cs:24499）：ai[0] 冷却 200、玩家在上方+视线 → 速 12 直射（伤害 10）；
   *  传送带 ConveyorBelt 特例（cs:24526）未引入不移植 */
  private antlionAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    // npc.rotation 默认 0（visAngle 类字段默认 π 是 EoC 语境——不归零会倒栽葱）
    if (!this.aiInit) { this.aiInit = true; this.visAngle = 0; }
    if (this.ai0 < 0) this.ai0 = 0;
    this.vx *= 0.9;
    if (Math.abs(this.vx) < 0.1) this.vx = 0;
    // 脚下行（取盒内最底行；站地时该行为空气 → 正常落地，半埋沙中才触发浮出）
    const bx = Math.floor(this.cx / TILE), by = Math.floor((this.y + this.h - 1) / TILE);
    let rooted = false;
    for (let i = -1; i <= 1; i++) if (st.isSolid(bx + i, by)) { rooted = true; break; }
    // ---- 开火（cs:24474-24541 在 rooted 判定【之前】——埋沙栖息中照常装填开火）----
    //  原版 ai[0] = 【倒计时】：>0 每 tick −1（==200 即装填后第一 tick 播音）；
    //  ==0 且 flag25（锥门）且 CanHit → 装填 ai[0]=200 + 射沙球（proj 31 ai[0]=2
    //  敌版档/timeLeft300）。flag25 只在 directionY<0（玩家在上方）时重算——
    //  玩家不在上方保留旧值（与 rotation 保留语义同构）。曾写反成 ai0 递增计数、
    //  且冷却只在玩家存活时累计（原版 :24502 无条件递减）、多加"玩家在上方"射门
    //  （原版无）——2026-08-21 A 区遗留清偿按字面重写
    //  ★flag25 是局部变量每 tick 重置 false（:24476）——玩家不在上方
    //  （directionY≥0）时恒 false=本 tick 不射；锥门无跨 tick 锁存
    //  （曾用 lai2 锁存=自创语义，review 自查纠正）
    let flag25 = false;
    if (player && !player.dead) {
      // 仰角锥门（:24477-24479）：rotation = atan2(dy,dx)+π/2（自正上方起算的
      // 瞄准角），flag25 = rotation∈[-1.2,1.2]（±68.75°）。else 分支（:24526-24533）
      // 是传送带特例（tile 421/422），本仓传送带机制未移植故不接（G6 定谳）
      const aimRot = Math.atan2(player.cy - this.cy, player.cx - this.cx) + Math.PI / 2;
      // ★瞄准倾斜（cs:24477-24486，玩家在上方 directionY<0 时每帧执行）：
      //  rotation = atan2(瞄准向量)+π/2 钳 ±0.8（玩家正上方=0 直立），玩家不在
      //  上方时保留上次倾角（原版 AI 不复位）。2026-08-20 用户实报"蚁狮贴图不
      //  倾斜"——曾只借 aimRot 做锥门从未写回视觉角
      if (player.cy < this.cy) {
        this.visAngle = Math.max(-0.8, Math.min(0.8, aimRot));
        flag25 = aimRot >= -1.2 && aimRot <= 1.2;
      }
      // 直射门（:24508-24521）：冷却尽 + 锥内 + CanHit → 装填 200 + 射。
      // 1457 :24579 锥门内再加 AI_GlobalFiringDistanceCheck（超视野不装填）
      if (this.ai0 <= 0 && flag25 && aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)
        && this.canSeePlayer(st, player)) {
        this.ai0 = 200;
        game.playSfxFiles?.(['Item_5'], 1, this.cx, this.cy);   // :24503（==200 第一 tick 音）
        this.shootDart(game, this.cx, this.cy, player.cx - this.cx, player.cy - this.cy, 12, 10, 31);
      }
    }
    // 倒计时递减（:24502 无条件——玩家死/ absent 也走到 0）
    if (this.ai0 > 0) this.ai0 -= 1;
    if (rooted) {
      this.vy = -0.2;
      this.x += this.vx;
      this.y += this.vy;
      return;
    }
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
  }

  /** AI_023 飞行武器 83/84/179（NPC.cs:25316-25395）：块内强制 noGravity+noTileCollide 穿墙。
   *  三态循环：0 冲刺（朝玩家单位向量×9、rotation=atan2+0.785）→ 1 漂移（×0.99/帧，
   *  justHit 直接进 2；100 帧 → 清速进 2）→ 2 蓄转（×0.96/帧，转速 0.1+ai/120*0.4 递增，
   *  justHit 重转；120 帧 → 回 0）。受击永远回蓄转态 */
  private flyingWeaponAI(_game: GameHooks, player: Player | null) {
    if (this.ai0 < 0) this.ai0 = 0;
    if (this.ai0 === 0) {
      if (player && !player.dead) {
        const dx = player.cx - this.cx, dy = player.cy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        this.vx = (dx / d) * 9;
        this.vy = (dy / d) * 9;
        this.visAngle = Math.atan2(this.vy, this.vx) + 0.785;
      } else {
        this.vx = this.facing * 3;
        this.vy = -3;
      }
      this.ai0 = 1;
      this.ai1 = 0;
    } else if (this.ai0 === 1) {
      this.vx *= 0.99;
      this.vy *= 0.99;
      this.ai1 += 1;
      if (this.justHit) { this.ai0 = 2; this.ai1 = 0; }
      else if (this.ai1 >= 100) { this.ai0 = 2; this.ai1 = 0; this.vx = 0; this.vy = 0; }
    } else {
      this.vx *= 0.96;
      this.vy *= 0.96;
      this.ai1 += 1;
      this.visAngle += (0.1 + (this.ai1 / 120) * 0.4) * this.facing; // 越转越快
      if (this.justHit) this.ai1 = 0;
      else if (this.ai1 >= 120) this.ai0 = 0;
    }
    this.x += this.vx;
    this.y += this.vy;
    // ---- 点光（cs:25321-25331 aiStyle23 全族 Center 恒亮）----
    // 83 诅咒锤 (0.2,0.05,0.3) / 179 猩红斧 (0.3,0.15,0.05) / else 84 魔化剑 (0.05,0.2,0.3)
    if (this.vanillaId === 83) this.lightRGB = [0.2, 0.05, 0.3];
    else if (this.vanillaId === 179) this.lightRGB = [0.3, 0.15, 0.05];
    else this.lightRGB = [0.05, 0.2, 0.3];
  }

  /** AI_025 宝箱怪 85/341/629（NPC.cs:25621-25713）：ai[0]=0 伪装（重力站立），玩家进
   *  200px 盒 / life<max / 有速度 → 显形；ai[0]=1 跳跃循环——落地 ai[2] 计数，
   *  不足 12（首跳）/20 帧 vx×0.9 蓄力，然后小跳（vx=dir*3.5, vy=-4）×2 →
   *  第三跳大跳（vx=dir*2.5, vy=-8）清零循环；空中朝 dir 补 |vx|≥1（±0.1/帧）。
   *  341 礼物宝箱怪仅雪月索敌（flag36 = snowMoon，NPC.cs SpawnNPC 传入）——雪月已落地
   *  （MoonEvent），索敌门按 world.moonEvent.kind===1（霜月）判定 */
  private mimicAI(game: GameHooks, player: Player | null) {
    if (this.ai0 < 0) this.ai0 = 0;
    // ★BJ464 变体段一次性锁定（AI_025 NPC.cs:25684-25697）：ai[3]==0 时 position.X+=8f
    //  并按生成深度锁段——地表=1（帧行 0-5 金箱）/ >worldSurface=2（+6 暗影箱）/
    //  >UnderworldLayer=3（+12 黑曜石箱）。UnderworldLayer=maxTilesY-200（Main.cs:2863，
    //  非 GenVars.lavaLine——SceneMetrics.ts:302 判例）。锁后 ai[3] 永不回 0=生成时锁定。
    if (this.ai3 === 0) {
      this.x += 8;                          // position.X += 8f（:25686，一次性）
      const ty = this.y / TILE;             // position.Y/16f（顶左格浮点，:25687-25694 同式）
      if (ty > game.world.h - 200) this.ai3 = 3;
      else if (ty > game.world.groundLevel) this.ai3 = 2;
      else this.ai3 = 1;
    }
    if (this.vanillaId === 341 || this.vanillaId === 629) this.ai3 = 1;   // :25699-25701 恒段 1
    // ★BJ464 FindFrame case 85 frameCounter（:74247-74252）：腾空++/落地--钳 0..12、
    //  伪装态清零（:74240-74243）。置于 AI 头=读上一拍终速度，与原版 FindFrame
    //  （Update 尾）同值同相；mimicAI 三处 early-return 均已覆盖。渲染面 vanillaFrameIdx 消费。
    if (this.ai0 === 0) this.mimicFrameT = 0;
    else if (this.vy === 0) this.mimicFrameT = Math.max(0, this.mimicFrameT - 1);
    else this.mimicFrameT = Math.min(12, this.mimicFrameT + 1);
    const flag36 = this.vanillaId === 341 && game.world.moonEvent.kind === 1;
    if (this.ai0 === 0) {
      // 同 AI_017：唤醒判定用重力前速度（站立态 vy==0 不误触发）
      const preVy = this.vy;
      const near = !flag36 && player && !player.dead
        && Math.abs(player.cx - this.cx) < 100 + (this.w + player.w) / 2
        && Math.abs(player.cy - this.cy) < 100 + (this.h + player.h) / 2;
      if (near || this.hp < this.maxHp || this.vx !== 0 || preVy < 0 || preVy > 0.3) {
        this.ai0 = 1;
        return;
      }
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      return;
    }
    if (player && !player.dead) this.facing = this.seekDirX(player);
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.onGround && this.vy === 0) {
      this.ai2 += 1;
      const wait = this.ai1 === 0 ? 12 : 20;
      if (this.ai2 < wait) { this.vx *= 0.9; return; }
      this.ai2 = 0;
      if (this.ai1 === 2) {           // 第三跳：大跳清零
        this.vx = this.facing * 2.5;
        this.vy = -8;
        this.ai1 = 0;
      } else {
        this.vx = this.facing * 3.5;
        this.vy = -4;
        this.ai1 += 1;
      }
    } else if (this.vy !== 0) {
      if (this.facing === -1 && this.vx > -1) this.vx -= 0.1;
      else if (this.facing === 1 && this.vx < 1) this.vx += 0.1;
    }
  }

  /** AI_039 陆龟族 153/154/417/496/497（NPC.cs:29257-29783）：
   *  justHit → 回待机（417 除外；无 ai0 门——旋冲受击同断,回待机拍 TargetClosest 面向）；
   *  0 待机：direction=sign(vx)（vx==0 保向）+ 速度反转折返（!justHit∧vx≠oldVx → 反转）；
   *    远距(>200)+视线蓄力+4/t（496/497 +2），>600 ∧（视线∨盒底>玩家顶−200）再+10/t
   *    （496/497 +4），wet→1000 仅非 496/497（wet=碰撞盒触液），≥400 → 1（转态拍
   *    走完态 0 尾不早退）；行走 accel 0.07 三臂（|vx|>max∧vy==0 衰减 ×0.8 / direction
   *    门加速 / 死区），近(<400) max±1 远 ±1.5（496/497 恒 0.5），前方 3×4 无地转身；
   *  1 蓄势：vx×0.5、ai[1]+1(496/497 ×0.5) ≥30 → 3（417 → 6 态滚动）；
   *  3 旋冲：首帧 TargetClosest（:29635）+单式两支定速 有视线10/无视线6（496/497 ×0.75;
   *    aim=player顶−cy−|dx|×0.2（directionY>0 归 0）归一,vx=朝玩家归一分量,无视线仅
   *    vy=-10,R3）,飞行中与玩家 X 重叠 → vx×0.8 停升，否则 vy-=0.22 持续上旋，≥90t → 4；
   *    wet∧dirY<0 → vy-=0.3（:29693,每拍含弹射拍,R3）；
   *  4 下落：wet∧dirY<0 → vy-=0.3（:29701,R3）+ vx×0.96，落地 → 5；
   *  5 复位：rotation=0（:29838,R3）+ vx=0，+1/t(×0.5) ≥30 → TargetClosest（:29850,
   *    先于清零,R3）→ 回 0；wet 直接回 3（转态门后置,≥30∧wet 拍 TargetClosest 仍面）；
   *    417 底边锚定复原 52 高；
   *  6 Sroller 日耀滚动（NPC.cs:29699-29832 全量,2026-09-03 骨架→逐值定版）：
   *    每 tick damage=lerp(defDmg×1.8,×1.4)/defense=defDef×2/kbResist=0（:29700-03）；
   *    2/3 尘 aura（:29704-12）；ai[1]++ 后 ai[3] 尘爆子计数 1..10 循环（:29717-53，
   *    ==1 大爆 32×[尘6×2 档]+4 gore、每 tick 5×尘31、≥10 归零——接触专盒窗
   *    ai[3]∈(0,4) 100² ×1.35 = MeleeCollisionData 417 支驱动源）；首 tick 定速冲撞
   *    CanHit 16/无 10（:29774-806,aim 偏置 |dx|×0.2 directionY>0 归 0、无视线 vy=−12）；
   *    玩家 X 重叠 vx×0.9/vy<0→+0.2、ai[2]==0∨ai[1]≥1200 → 5（:29808-14）；
   *    撞块反弹 0.9（Collision_MoveSolarSroller :93879-96,ai[2]−−/ai[3]=1/X 反弹转向）；
   *    wet 上浮助推 + rotation+=clamp(vx/10×dir,±π/10)（:29828-32）。 */
  private tortoiseAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    // npc.rotation 默认 0（visAngle 类字段默认 π 是 EoC 语境）
    if (!this.aiInit) {
      this.aiInit = true;
      this.visAngle = 0;
      // defDamage/defDefense 基准快照（首 AI 拍=ScaleStats 后、先于任何 AI 写点;
      // :29453-29462 态 0 每拍复位的 def 侧基准。417 走 srollerDefBase 态 6 快照,
      // 此快照对其仅为冗余兜底）
      this.tortoiseDefBase = { dmg: this.def.damage ?? 0, def: this.def.defense ?? 0 };
    }
    if (this.ai0 < 0) this.ai0 = 0;
    const t496 = this.vanillaId === 496 || this.vanillaId === 497;
    const sroller = this.vanillaId === 417;
    // justHit 复位（NPC.cs:29393-29398）：门 = justHit ∧ type!=417——★【无 ai0 门】，
    // 旋冲（态 3/4/5）受击同断（BJ410-Q2 定谳#5;旧 `ai0!==3` 门=自造豁免,旋冲不断=偏差）。
    // TargetClosest()（:29397,faceTarget=true → SetTargetTrackingValues :78515 朝向段,
    // 含 aggro 不转身门/confused 反转）= 本仓 seekDirX 同语义;朝向随后被态 0 头
    // direction=sign(vx) 覆写（vx≠0 时）——与原版同序
    if (this.justHit && !sroller) {
      this.ai0 = 0; this.ai1 = 0;
      this.facing = this.seekDirX(player);
    }
    const dx = player ? player.cx - this.cx : 0;
    const dy = player ? player.cy - this.cy : 0;
    // num606 距离基准（NPC.cs:29424-29427）= hypot(playerCenterX−npcCenterX,
    //   player【顶】Y−npcCenterY)——玩家顶对龟心（非中心距;42 高玩家 ≈21px 偏置）。
    //   消费面=蓄力双臂（>200/>600）与加速档（<400）——本仓 dist 单源同式（R3 定谳:
    //   旧中心距在玩家近竖直方位时跨档=加速 max 1/1.5 误档、蓄力 200/600 阈漂移）
    const dist = player ? Math.hypot(dx, player.y - this.cy) : Infinity;
    // flag46（:29428 Collision.CanHit）= 纯几何,无 dead 门——原版 target 停留死玩家
    //   （TargetClosest 只在【选段】跳过 dead(:78459),旧 target 保持 → flag46/弹射
    //   仍以尸体位姿几何结算;死亡玩家角落照常蓄力/全速弹射=原版语义）。faceTarget=
    //   false 的「不面向死玩家」由各 TargetClosest 位点的 !dead 门承担（R3 定谳,
    //   旧 los 含 !player.dead → 蓄力臂断+弹射降档=偏差）
    const los = !!player && this.canSeePlayer(st, player);
    const gravityStep = () => {
      // oldVelocity.X 快照（NPC.cs:93681 Update 尾 oldVelocity=velocity 在
      // ApplyTileCollision :93687 前）——态 0 翻转臂 :29469 消费;每拍移动前写=原版每拍写同相
      this.tortoiseOldVx = this.vx;
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
    };
    if (this.ai0 === 0 || this.ai0 > 5) {
      // ---- 待机/接近 ----
      if (this.ai0 === 0) {
        // 态 0 头：direction = sign(velocity.X)（vx==0 保持原向,NPC.cs:29413-29420）——
        // 朝向源=行进向而非玩家侧（BJ410-Q2 定谳#1;旧 facing=sign(dx) 每 tick 重查玩家
        // 侧 = 崖边折返后下一拍又转回玩家 → 贴崖爬行;原版一次折返 vx=0.1×direction →
        // 下一拍 sign(vx) 定向 → 全速离崖。spriteDirection=direction（:29421）本仓
        // facing 同源双角色）
        if (this.vx < 0) this.facing = -1;
        else if (this.vx > 0) this.facing = 1;
        if (sroller) {
          // 态 0 每 tick 属性复位（:29464-29466 damage=defDamage / defense=defDefense /
          // knockBackResist=GetKnockbackMultiplier_ScaledByDifficulty(0.3)）——态 6 覆写
          // 的解除点；仅 417 落位（态 3 强化面 :29629-29630 已由 S3 刀落位,经 wet 转态
          // 3 的 417 亦被该面覆盖;态 0 复位=其逐拍解除点）
          if (this.srollerDefBase) {
            this.def.damage = this.srollerDefBase.dmg;
            this.def.defense = this.srollerDefBase.def;
          }
          this.kbResistOverride = getKnockbackMultiplierScaledByDifficulty(0.3, this.difficulty || 1);
        } else {
          // 态 0 每 tick 属性复位·非 417 支（:29453-29462 1:1,R3 定谳——原版复位是
          // 全型段,旧只落 417=登记债）：defense=defDefense / damage=defDamage /
          // knockBackResist=GetKnockbackMultiplier_ScaledByDifficulty(0.75 496/497 |
          // 0.3)。★现时行为面=稳态零差（153/154 SetDefaults kb=0.3 :10965/:10980、
          // 496/497=0.75 :14716,ScaleStats :18114 出生已乘同曲线=复位值;def.damage/
          // defense 的 AI 内写点=态 3 强化面 :29629-29630,S3 刀已落位）——
          // 本复位=该强化面的逐拍解除点（进 3 强化/回 0 卸载同拍互验）。
          // 写值等值时不动 this.def（ENEMY_DEFS 共享 def 防跨实例污染;异值=外部
          // 写点已 COW 或此处 COW 后逐实例复位=原版 per-NPC 字段语义）
          const tBase = this.tortoiseDefBase;
          if (tBase && ((this.def.damage ?? 0) !== tBase.dmg || (this.def.defense ?? 0) !== tBase.def)) {
            if (this.def === (ENEMY_DEFS[this.key] ?? PLACEHOLDER_DEF)) this.def = { ...this.def };
            this.def.damage = tBase.dmg;
            this.def.defense = tBase.def;
          }
          this.kbResistOverride = getKnockbackMultiplierScaledByDifficulty(t496 ? 0.75 : 0.3, this.difficulty || 1);
        }
        // 蓄力双臂（NPC.cs:29427-29451）：>200∧视线 +2/4；>600 ∧（视线 ∨ 盒底>
        // 玩家顶−200）+4/10——★第二臂纵向条件 = NPC【不】在玩家头顶远处（BJ410-Q2
        // 定谳#3;旧 `dy>200`=只在远高于玩家时才蓄,与原版反相=无视线蓄力臂恒断）。
        // wet→ai[1]=1000 仅非 496/497 支（:29448-29451），wet=碰撞盒 WetCollision
        // 任意接触（this.wet 中心小盒判水线,非 liquid>80 阈;BJ410-Q2 定谳#2——
        // 旧无差别越族:496/497 入水即满蓄直跳蓄势）
        if (los && dist > 200) this.ai1 += t496 ? 2 : 4;
        if (dist > 600 && (los || (!!player && this.y + this.h > player.y - 200))) {
          this.ai1 += t496 ? 4 : 10;
        }
        if (!t496 && this.wet) this.ai1 = 1000;
        // ai[1]++ / ≥400 → 态 1（:29463-29468）——★不早退：原版 else-if 链,转态拍
        // 继续走完态 0 尾（反转折返/崖边折返/加速,下拍才进态 1;BJ410-Q2 定谳#4;
        // 旧 `return`=转态拍整尾蒸发,崖边恰好满蓄时折返丢失）
        this.ai1 += 1;
        if (this.ai1 >= 400) { this.ai0 = 1; this.ai1 = 0; }
        // 速度反转折返（:29469-29472）：!justHit ∧ vx≠oldVelocity.X（oldVx=上一拍
        // AI 写速后/碰撞改速前快照——差值=上一拍碰撞改了 vx,撞墙停/反向）→ direction 反转
        if (!this.justHit && this.vx !== this.tortoiseOldVx) this.facing *= -1;
        // 崖边折返（NPC.cs:29473-29504 1:1,BJ410 2026-09-30 定谳刀）：门 = 落地
        // (velocity.Y==0) ∧ 玩家顶<盒底（Main.player[target].position.Y <
        // position.Y+height）——★玩家在下方悬崖外时【不】折返,原版继续头朝玩家
        // 跟进（随行跳崖）;此前缺 Y 门 = 玩家在下方也折返 → 龟在崖边滞留、屁股朝
        // 玩家（用户实报"贴图朝向与角色相反"实锚）。窗 = 朝向侧 center..center±3
        // 列（4 列）× num609..num609+4 行（5 行,num609=floor((bottom+2)/16)−1）。
        // 谓词 = nactive() ∧ tileSolid[type]——本仓 SOLID_LUT≡tileSolid∧
        // !tileSolidTop,平台九件套（tileSolid∩tileSolidTop,sheet 19/239/380/427/
        // 435-439）补 TILE_SOLID_TOP_NINE 支（active 位+致动位同门）。全空 →
        // direction*=−1 且 velocity.X=0.1×direction;序 = 先折返后加速（原版折返
        // :29473 在 accel :29507 前,加速吃折返后 direction——本仓 facing 同源）
        if (this.vy === 0 && player && player.y < this.y + this.h) {
          const cCol = Math.floor(this.cx / TILE);
          const colA = this.facing > 0 ? cCol : cCol - 3;
          const colB = this.facing > 0 ? cCol + 3 : cCol;
          const row0 = Math.floor((this.y + this.h + 2) / TILE) - 1;
          let ground = false;
          for (let cx2 = colA; cx2 <= colB && !ground; cx2++) {
            for (let cy2 = row0; cy2 <= row0 + 4 && !ground; cy2++) {
              if (st.isSolid(cx2, cy2)) { ground = true; break; }
              if (!st.hasTile(cx2, cy2) || st.isActuated(cx2, cy2)) continue;
              if (TILE_SOLID_TOP_NINE.has(st.type[st.idx(cx2, cy2)])) { ground = true; break; }
            }
          }
          if (!ground) { this.facing *= -1; this.vx = 0.1 * this.facing; }
        }
        // 加速三臂（NPC.cs:29506-29532 496/497 / :29534-29570 其余；BJ410-Q2 定谳#6;
        // 旧单臂恒 accel+clamp = 超速瞬钳到 max 且空中照钳——原版:|vx|>max ∧ vy==0
        // 才衰减 ×0.8（两轴 velocity×0.8,vx 主导）,空中超速三臂全跳=速度保持;
        // |vx|≤max 时 direction 门 accel 0.07 死区收口。496/497 原文本臂尾 return
        // 只截 AI 不截物理（碰撞在 AI 外通用段）→ 本仓 gravityStep 照跑）
        if (t496) {
          if (this.vx < -0.5 || this.vx > 0.5) {
            if (this.vy === 0) this.vx *= 0.8;
          } else if (this.vx < 0.5 && this.facing === 1) {
            this.vx += 0.07;
            if (this.vx > 0.5) this.vx = 0.5;
          } else if (this.vx > -0.5 && this.facing === -1) {
            this.vx -= 0.07;
            if (this.vx < -0.5) this.vx = -0.5;
          }
        } else {
          const max = dist < 400 ? 1 : 1.5;
          if (this.vx < -max || this.vx > max) {
            if (this.vy === 0) this.vx *= 0.8;
          } else if (this.vx < max && this.facing === 1) {
            this.vx += 0.07;
            if (this.vx > max) this.vx = max;
          } else if (this.vx > -max && this.facing === -1) {
            this.vx -= 0.07;
            if (this.vx < -max) this.vx = -max;
          }
        }
        gravityStep();
        return;
      }
      // ---- Sroller 6 态滚动（NPC.cs:29699-29832 全量逐值,2026-09-03 骨架→定版；
      //      星柱未引入前 417 仅测试/指令域可达,行为面按原文落位）----
      // ①每 tick 属性覆写（:29700-29703）：damage = GetAttackDamage_LerpBetweenFinalValues(
      //   defDamage×1.8, defDamage×1.4)（=Utils.Remap Classic→Expert 截断,NPC.cs:7074-7076;
      //   defDamage 为 ScaleStats 【后】快照 :18197——srollerDefBase 防复利）、
      //   defense = defDefense×2、knockBackResist = 0
      if (this.def === (ENEMY_DEFS[this.key] ?? PLACEHOLDER_DEF)) this.def = { ...this.def };
      if (!this.srollerDefBase) {
        this.srollerDefBase = { dmg: this.def.damage ?? 0, def: this.def.defense ?? 0 };
      }
      const diff = this.difficulty || 1;
      this.def.damage = Math.trunc(remap(diff, GDL.CLASSIC, GDL.EXPERT,
        this.srollerDefBase.dmg * 1.8, this.srollerDefBase.dmg * 1.4));
      this.def.defense = this.srollerDefBase.def * 2;
      this.kbResistOverride = 0;
      // ②尘 aura（:29704-29712）：2/3 概率,尘 6 @Center±30 盒 60²、初速 v×0.5、
      //   noGravity、fadeIn=1、速度×0.2
      if (Math.random() * 3 < 2) {
        const da = game.spawnDust?.(this.cx - 30, this.cy - 30, 60, 60, 6,
          this.vx * 0.5, this.vy * 0.5, 90, null, 1.5, true);
        if (da) { da.vx *= 0.2; da.vy *= 0.2; da.fadeIn = 1; }
      }
      // ③ai[1]++（:29713）
      this.ai1 += 1;
      // ④ai[3] 尘爆子计数（:29717-29753）——置 1 在撞块（见⑧）;1..10 循环：
      //   ==1 大爆（32×[尘 6 scale2.5 速×3 + 尘 6 scale1.5 速×2] + 4 gore 61-64）、
      //   每 tick 5×尘 31 速×NextFloat、≥10 归零。★接触专盒窗 = ai[3]∈(0,4)
      //   （CenteredRectangle(Center,100²) ×1.35——MeleeCollisionData.ts 417 支
      //   :96161-96167,GMC 求解器已接,本批补 ai3 驱动侧 = 分支可达前提）
      if (this.ai3 > 0) {
        if (this.ai3 === 1) {
          const bx = this.cx - 50, by = this.cy - 50;
          for (let k = 0; k < 32; k++) {
            const d1 = game.spawnDust?.(bx, by, 100, 100, 6, 0, 0, 100, null, 2.5, true);
            if (d1) { d1.vx *= 3; d1.vy *= 3; }
            const d2 = game.spawnDust?.(bx, by, 100, 100, 6, 0, 0, 100, null, 1.5, true);
            if (d2) { d2.vx *= 2; d2.vy *= 2; }
          }
          // gore 61-64（日耀碎屑）无 gore 通道 → 橙粒近似（C 类观感登记,原版 4 片
          // vel×0.3 + ±0.5 抖动）
          game.spawnParticles?.(this.cx, this.cy, '#FF7A1E', 4, 3, { life: 30, damp: 0.94, grav: 6 });
        }
        for (let k = 0; k < 5; k++) {
          const d3 = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
          if (d3) { const f = Math.random(); d3.vx *= f; d3.vy *= f; }   // NextFloat
        }
        this.ai3 += 1;
        if (this.ai3 >= 10) this.ai3 = 0;
      }
      // ⑤首 tick 定速冲撞（:29774-29806）：TargetClosest（:29775 通用中心比规则
      //   :78544-78552）→ CanHit 16/无 10;aim 偏置 num631=|dx|×0.2（directionY>0 归 0）、
      //   num632=playerTop−cy−num631 归一×速;无视线 vy 强制 −12（:29803-29805）
      if (this.ai1 === 1) {
        if (player && !player.dead) {
          // TargetClosest 朝向段（:29781→SetTargetTrackingValues :78515）= seekDirX
          // 同语义（冗余备案③c 收刀:旧 raw sign(dx) 缺 aggro 不转身/镇静/confused
          // 反转门——与态 3 弹射/态 5 复位/态 1 转态位点同族统一）
          this.facing = this.seekDirX(player);
          this.dirY = dy < 0 ? -1 : 1;
        }
        const spd = los ? 16 : 10;
        const num631 = this.dirY > 0 ? 0 : Math.abs(dx) * 0.2;
        const num632 = (player ? player.y - this.cy : 0) - num631;
        const dd = Math.hypot(dx, num632) || 1;
        this.vx = (dx / dd) * spd;
        this.vy = los ? (num632 / dd) * spd : -12;
      } else {
        // ⑥玩家 X 重叠阻尼（:29808-29814）：vx×0.9、vy<0→+0.2;ai[2]==0 ∨ ai[1]≥1200 → 5
        if (player && this.x + this.w > player.x && this.x < player.x + player.w
          && this.y < player.y + player.h) {
          this.vx *= 0.9;
          if (this.vy < 0) this.vy += 0.2;
        }
        if (this.ai2 === 0 || this.ai1 >= 1200) { this.ai1 = 0; this.ai0 = 5; }
      }
      // ⑦wet 上浮助推（:29828-29830）+ 旋转（:29831-29832 rotation += clamp(
      //   velocity.X/10×direction, ±π/10)）
      if (this.wet && this.dirY < 0) this.vy -= 0.3;
      this.visAngle += Math.max(-Math.PI / 10, Math.min(Math.PI / 10, this.vx / 10 * this.facing));
      // ⑧Collision_MoveSolarSroller（NPC.cs:93879-93896）：态 6 撞块 → ai[2]−−、
      //   ai[3]=1（尘爆子计数点火/接触专盒窗开启）;预算 ai[2]>0 时速度 ×0.9 镜面反弹、
      //   X 反弹伴随 direction 翻转。ai0===6 守卫 = 原文本句首门（同 tick 内 ⑥ 已切
      //   态 5 则不再结算反弹）
      this.tortoiseOldVx = this.vx;   // oldVelocity 快照同相（:93681）
      this.applyGravity(game);
      const ovx = this.vx, ovy = this.vy;
      moveAndCollide(this, game.world, this.vx, this.vy);
      if (this.ai0 === 6 && (this.vx !== ovx || this.vy !== ovy)) {
        this.ai2 -= 1;
        this.ai3 = 1;
        if (this.ai2 > 0) {
          if (this.vx !== ovx) { this.vx = -ovx * 0.9; this.facing = -this.facing; }
          if (this.vy !== ovy) { this.vy = -ovy * 0.9; }
        }
      }
      return;
    }
    if (this.ai0 === 1) {
      // ---- 蓄势（原版无 rotation 写点）----
      this.vx *= 0.5;
      this.ai1 += t496 ? 0.5 : 1;
      gravityStep();
      // 冗余备案③a（S3 定谳,:29599 TargetClosest）：原版转态拍调 TargetClosest,但其
      // 朝向在下拍弹射拍重调（:29635 非 417|:29781 417）消费前【零读点】（转态尾无
      // direction 消费,物理段不读）→ 行为面无差=冗余。本仓非 417 支省略=等价;
      // 417 支落位（罐装段与 TargetClosest 同拍,height 变不影响朝向）——门语义对齐
      // 见下 seekDirX。
      if (this.ai1 >= 30) {
        this.ai0 = sroller ? 6 : 3;
        this.ai1 = 0;
        this.ai2 = 0;
        if (sroller) {
          // （NPC.cs:29613-29622）TargetClosest（通用中心比规则 :78544-78552）→
          // 罐装高度 52→32（position.Y±height 底边锚定换算）、ai[0]=6、
          // ai[2]=Next(2,5) 撞块弹跳预算（态 6 ⑧消费）。
          // 冗余备案③c 收刀:TargetClosest 朝向段（:29599→SetTargetTrackingValues
          // :78515）= seekDirX 同语义——旧 raw sign(dx) 缺 aggro 不转身/镇静/
          // confused 反转三门（与态 3 弹射/态 5 复位位点同族统一）
          if (player && !player.dead) {
            this.facing = this.seekDirX(player);
            this.dirY = dy < 0 ? -1 : 1;
          }
          this.y += this.h; this.h = 32; this.y -= this.h;
          this.ai2 = 2 + Math.floor(Math.random() * 3);
        }
      }
      return;
    }
    if (this.ai0 === 3) {
      // ---- 旋转弹射 ----
      // 态 3 每拍伤害/防御强化（NPC.cs:29624-29630,Q2/R3 登记主面 S3 落刀）：
      //   num616=2（全域缺省 :29624）|1.5（496/497 :29625-29628 系数亲读）;
      //   damage = GetAttackDamage_LerpBetweenFinalValues(defDamage×num616,
      //   defDamage×num616×0.9)（:29629 = Utils.Remap Classic→Expert 截断,NPC.cs:7074,
      //   ≥Expert 取右值——经典 ×2/专家 ×1.8,496/497 ×1.5/×1.35）;defense =
      //   defDefense×2（:29630）。defDamage/defDefense 基准 = tortoiseDefBase
      //   （首 AI 拍 ScaleStats 后快照,防复利）;COW 同态 0 复位机构。417 经 wet 转态 3
      //   （态 5 :29855-29858）亦落本面（原版无型门,num616 对 417 取 2）。出态 3 后
      //   态 4/5 原版无复位写点（值残留）→ 态 0 复位机构（R3#1）=逐拍解除点,
      //   与本写点同拍互验（进 3 强化/回 0 卸载）。
      if (this.def === (ENEMY_DEFS[this.key] ?? PLACEHOLDER_DEF)) this.def = { ...this.def };
      const num616 = t496 ? 1.5 : 2;
      const tBase3 = this.tortoiseDefBase ?? { dmg: this.def.damage ?? 0, def: this.def.defense ?? 0 };
      this.def.damage = Math.trunc(remap(this.difficulty || 1, GDL.CLASSIC, GDL.EXPERT,
        tBase3.dmg * num616, tBase3.dmg * num616 * 0.9));
      this.def.defense = tBase3.def * 2;
      if (this.ai1 === 0) {
        // TargetClosest（:29635,faceTarget=true;dead→faceTarget=false 不转向 :78540-42）
        // ——先于弹射/偏置/旋向消费（旧缺=无视线支按行走朝向发射、dirY 域无源,R3 定谳）
        if (player && !player.dead) {
          this.facing = this.seekDirX(player);
          this.dirY = dy < 0 ? -1 : 1;
        }
        // 弹射定速（:29636-29655 单式两支,R3 定谳——旧 LOS 支 bias 反号+中心距、
        //   无视线支 vx=facing×spd 全速=三重偏差）：num617=视线 10/无 6（496/497
        //   ×0.75 :29645-47）;num618=playerCenterX−centerX;num619=|num618|×0.2
        //   （directionY>0 归 0 :29644-46）;num620=player【顶】Y−centerY−num619
        //   （玩家在上方时 bias 再抬高=弧线补偿）;归一×num617（:29650-54）;无视线
        //   仅 vy 强制 −10（:29652-54）,vx 仍=朝玩家归一分量（玩家近正上/正下方
        //   时 vx→0,非全速）
        const spd = (los ? 10 : 6) * (t496 ? 0.75 : 1);
        const num618 = dx;
        const num619 = this.dirY > 0 ? 0 : Math.abs(num618) * 0.2;
        const num620 = (player ? player.y - this.cy : 0) - num619;
        const num621 = Math.hypot(num618, num620) || 1;
        this.vx = (num618 / num621) * spd;
        this.vy = los ? (num620 / num621) * spd : -10;
        this.ai3 = this.vx; // 存 vx
        // 旋踢一脚（cs:29562-29563 首帧）：ai[2] +0.3 且 rotation += ai[2]×direction
        this.ai2 += 0.3;
        this.visAngle += this.ai2 * this.facing;
      } else {
        // 飞行重叠阻尼门（:29672-29680 两段【串行】if,非互斥——S3 定谳收刀）：
        //   X 重叠 = 盒对盒（npc 右>玩家左 ∧ npc 左<玩家右——旧 |dx|<(w1+w2)/2+8
        //   的 +8=自造容差,退位）∧ Y 门 npc 顶<玩家底（:29672 第三连项,旧缺=
        //   玩家悬在上方时也阻尼）→ vx×0.8 / ai3 归零 / vy<0→+0.2 托升（旧缺）;
        //   ai3≠0（续航段）→ vx=ai3 恒速 + vy−=0.22 上推。★串行序:重叠拍 ai3
        //   先归零 → 同拍续航支空转（旧 if/else 在 ai3==0 时照写 vx=0+vy−=0.22
        //   =无源上推偏差）。同款形态参照 sroller 态 6 ⑥（:29810-29817 ×0.9 无
        //   ai3 归零臂）。
        if (player && this.x + this.w > player.x && this.x < player.x + player.w
          && this.y < player.y + player.h) {
          this.vx *= 0.8;
          this.ai3 = 0;
          if (this.vy < 0) this.vy += 0.2;
        }
        if (this.ai3 !== 0) {
          this.vx = this.ai3;
          this.vy -= 0.22;
        }
      }
      // wet 段（:29693-29696,态 3 每拍含弹射拍;原版序=else 支/转态门后、旋转尾前;
      //   R3 定谳=旧缺）：wet ∧ directionY<0（玩家在上）→ vy−=0.3 上浮助推
      if (this.wet && this.dirY < 0) this.vy -= 0.3;
      // 全程续旋（cs:29619 态尾）：rotation += ai[2]×direction（恒速，~0.3 rad/t）
      this.visAngle += this.ai2 * this.facing;
      this.ai1 += 1;
      gravityStep();
      // 转态门（:29686-29690）——冗余备案③b（S3 定谳）:原版同拍还写 noGravity=false
      // （:29688）,但本族 SetDefaults 显式 false（153 :10972 / 154 :10990）、496/497/
      // 417 字段缺省 false（:14710-14721/:15388-15399 无写点）,aiStyle 39 全域
      // （:29335-29861）无 noGravity=true 写点 → 恒空操作,本仓省略=等价。
      if (this.ai1 >= 90) { this.ai0 = 4; }
      return;
    }
    if (this.ai0 === 4) {
      // ---- 下落恢复（cs:29631-29645）：ai[2]>0 时 −0.01/t 且续旋衰减；
      //      ai[2]≤0 且 vy≥0 → rotation=0；落地清 ai[2]/rotation → 复位 ----
      // wet 段（:29701-29704,与态 3 同谓词同族;R3 定谳一并落位）
      if (this.wet && this.dirY < 0) this.vy -= 0.3;
      this.vx *= 0.96;
      this.ai2 -= 0.01;
      if (this.ai2 > 0) this.visAngle += this.ai2 * this.facing;
      else if (this.vy >= 0) this.visAngle = 0;
      gravityStep();
      if (this.ai2 <= 0 && (this.onGround || this.wet)) { this.ai0 = 5; this.ai1 = 0; this.visAngle = 0; }
      return;
    }
    // ---- 5 复位 ----
    if (sroller) {
      // （NPC.cs:29813-29816）罐装高度复原 32→52（底边锚定;h 已 52 时逐 tick 无操作）
      this.y += this.h; this.h = 52; this.y -= this.h;
    }
    // rotation=0（:29838,态 5 每拍;R3 定谳=旧缺,收旋期残余倾角带入复位态）
    this.visAngle = 0;
    this.vx = 0;
    this.ai1 += t496 ? 0.5 : 1;
    gravityStep();
    // 转态门先于 wet（原版序 :29847-29856）:≥30 → TargetClosest（:29850,先于
    //   ai1/ai0 清零——wet tick 亦面,面后 wet 覆写转 3 :29853-29856）→ 回 0 态
    //   （回 0 态头 sign(vx)=vx 0 保向 → 此处面向即复走朝向,R3 定谳=旧缺+旧序
    //   wet 先判早退使 ≥30∧wet 拍 TargetClosest 整蒸发）
    if (this.ai1 >= 30) {
      if (player && !player.dead) {
        this.facing = this.seekDirX(player);
        this.dirY = dy < 0 ? -1 : 1;
      }
      this.ai1 = 0;
      this.ai0 = 0;
    }
    if (this.wet) { this.ai0 = 3; this.ai1 = 0; }
  }

  /** AI_041 赫柏林 174/德普林 177（NPC.cs:30017-30280）：ai[0] 负数倒计时（ai[2]==0 时
   *  置 -100），落地 +5/t（177 +2）+ 距离加速 400/dist×10(177 ×5)（(int) 截断）、cap 30；
   *  ≥0 触发跳：小跳 vy=-5/vx+5dir（177 -7.5/+4dir），第 3/2 跳大跳 vy=-9/vx+3dir
   *  （177 -11.5/+2dir）清零并记 ai[3]=X；原地卡墙（ai[3]==X）→ 转向+ai[2]=300 惩罚；
   *  空中朝 dir 补 |vx| 到 3（177 4）（±0.2/帧）；wet 浮力段略；
   *  378 格格牙炸弹自爆序列（cs:30030-30107 + 跳跃尖叫 :30204）——起爆门（湿/
   *  距玩家<64 → ai[1]=5）→ 引爆态（冻结+扩 160×160 判定盒接触伤害、ai[2]==9 首
   *  tick Item_14 自爆音、ai[2]==1 消散无掉落）+ 每次起跳 Zombie_124 咬齿尖叫 */
  private herplingAI(game: GameHooks, player: Player | null) {
    if (this.ai2 === 0) { this.ai0 = -100; this.ai2 = 1; }
    else if (this.ai2 > 1) this.ai2 -= 1;
    const derpling = this.vanillaId === 177;
    const bomb = this.vanillaId === 378;
    if (player && !player.dead) this.facing = this.seekDirX(player);
    const dist = player ? Math.hypot(player.cx - this.cx, player.cy - this.cy) : Infinity;
    // ---- 378 引爆态（cs:30044-30082）----
    if (bomb && this.ai1 === 5) {
      this.vx = 0; this.vy = 0;
      // 判定盒扩 160×160（:30050-30053,接触伤害 200 = def.damage 数据自带）
      this.x = this.cx - 80; this.y = this.cy - 80;
      this.w = 160; this.h = 160;
      this.dontTakeDamage = true;
      if (this.ai2 > 7) {
        // 8× dust 31（:30056-30060）+ 32×2 dust 6（:30062-30073,×3/×2 速档近似）
        for (let i = 0; i < 8; i++) game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
        for (let i = 0; i < 32; i++) {
          game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 3, 3, 100, null, 2.5);
          game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 2, 2, 100, null, 1.5);
        }
        for (let i = 0; i < 2; i++) {   // 2× gore 61-63（:30075-30083）
          GorePiece.newGore(61 + Math.floor(Math.random() * 3),
            this.x + this.w * Math.random() - 10, this.y + this.h * Math.random() - 10,
            0, 0, 1);
        }
        if (this.ai2 === 9) game.playSfxWav?.('Item_14', 1, this.cx, this.cy);  // :30082 自爆音
      }
      if (this.ai2 === 1) this.dead = true;   // life=-1+active=false（:30087-30090,不走掉落/死亡管线）
      return;
    }
    // ---- 378 起爆门（cs:30098-30107）：湿 / 距玩家 <64 → 引爆态 ----
    if (bomb && (this.wet || (player != null && !player.dead && dist < 64))) {
      this.ai1 = 5;
      this.ai2 = 10;
      return;
    }
    // ---- 378 引信火花（cs:30034-30043,1/3）：dust 6 上飘 ----
    if (bomb && Math.floor(Math.random() * 3) === 0) {
      game.spawnDust?.(this.cx - 6 * this.facing - 5, this.cy - 15, 4, 4, 6, 0, -1, 0, null, 1.5);
    }
    // ---- wet 段（cs:30105-30120，177 Derpling 除外）：撞墙翻向；纵向碰撞 → 重新索敌 +
    // 上撞 vy=5 / 落水 vy-=2；随后 vy>0 ×0.95、恒 -0.3 上浮钳 -4——赫柏林入水上浮。
    // collideX/Y 读上一 tick 碰撞（原版 AI 先于 UpdateCollision）
    if (this.wet && !derpling) {
      if (this.hitWall) this.facing *= -1;
      if (this.onGround || this.hitHead) {
        if (player) this.facing = this.seekDirX(player);
        if (this.vy < 0) this.vy = 5;
        else this.vy -= 2;
      }
      if (this.vy > 0) this.vy *= 0.95;
      this.vy -= 0.3;
      if (this.vy < -4) this.vy = -4;
    }
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.onGround && this.vy === 0) {
      this.vx *= 0.8;
      if (Math.abs(this.vx) < 0.1) this.vx = 0;
      if (this.ai3 === this.x && this.ai3 !== 0) { // 原地白跳：转向 + 冷却惩罚
        this.facing *= -1;
        this.ai2 = 300;
      }
      this.ai0 += derpling ? 2 : 5;
      if (player && Number.isFinite(dist) && dist > 0) {
        this.ai0 += Math.trunc((400 / dist) * (derpling ? 5 : 10));
      }
      if (this.ai0 > 30) this.ai0 = 30;
      if (this.ai0 >= 0) {
        // 378 起跳咬齿尖叫（cs:30204 PlaySound(29,x,y,124) = Zombie_124,音量无修正）
        if (bomb) game.playSfxWav?.('Zombie_124', 1, this.cx, this.cy);
        if (player && dist > 200 && dist < 350) this.vx += this.facing;
        const bigAt = derpling ? 2 : 3;
        if (this.ai1 === bigAt) {
          this.vy = derpling ? -11.5 : -9;
          this.vx += (derpling ? 2 : 3) * this.facing;
          this.ai0 = -200;
          this.ai1 = 0;
          this.ai3 = this.x;
        } else {
          this.vy = derpling ? -7.5 : -5;
          this.vx += (derpling ? 4 : 5) * this.facing;
          this.ai0 = -120;
          this.ai1 += 1;
        }
      }
    } else {
      const cap = derpling ? 4 : 3;
      if (this.facing === -1 && this.vx > -cap) {
        this.vx -= 0.2;
        if (this.vx > 0) this.vx -= 0.2;
      } else if (this.facing === 1 && this.vx < cap) {
        this.vx += 0.2;
        if (this.vx < 0) this.vx += 0.2;
      }
    }
  }

  /** AI_044 飞鱼 224/巨蚁狮蜂 509/蚁狮蜂 581/眼球飞鱼 587（NPC.cs:31083-31322
   *  行号 1457=1458 同锚；2026-08-31 清偿：补 587 参数档与白天下潜反转、
   *  分轴二档加速原文式、同型聚群互斥环——见下各注）。无重力分轴限速追击：
   *  目标刷新（:31164-31177）：中点视线通 ∨ 非 587 且玩家湿身 ∨ 玩家死 → ai[0]=90，
   *  否则 ai[0]>0 每帧 −1（两支 TargetClosest 都调）；失视 ai[0]≤0 垂直逃逸
   *  （maxX×0.8/accel×0.7，目标线 = 中心±1000×directionY）；撞墙 direction 翻转
   *  vx=±1；wet 浮力除 587。
   *  参数表（xAccel/yAccel/maxX/maxY/xGate/yGate）：224 0.05/0.01/3/1/30/100、
   *  509 0.08/0.03/4.5/2/40/150、581 0.06/0.02/4/2/40/150、**587 0.13/0.09/6.5/
   *  3.5/0/250**（:31241-31247,xGate=0 → 横向恒加速） */
  private flyingSwarmerAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const vid = this.vanillaId ?? 224;
    const T = vid === 509
      ? { ax: 0.08, ay: 0.03, mx: 4.5, my: 2, gx: 40, gy: 150 }
      : vid === 581
        ? { ax: 0.06, ay: 0.02, mx: 4, my: 2, gx: 40, gy: 150 }
        : vid === 587
          ? { ax: 0.13, ay: 0.09, mx: 6.5, my: 3.5, gx: 0, gy: 250 }
          : { ax: 0.05, ay: 0.01, mx: 3, my: 1, gx: 30, gy: 100 };
    const pLive = !!player && !player.dead;
    // 目标刷新（:31164-31169）：CanHit(Center,1,1,targetCenter,1,1)=中心点视线；
    // `(type != 587 && wet)` 门 = 玩家湿身不算"看得见"（飞鱼不入水追击）
    if (!pLive || (vid !== 587 && !!player?.inWater)
      || !!(player && canHit(st, this.cx, this.cy, 1, 1, player.cx, player.cy, 1, 1))) {
      this.ai0 = 90;
    } else if (this.ai0 > 0) this.ai0 -= 1;
    // TargetClosest（:31170/:31174 两支都调）
    if (player) this.facing = this.seekDirX(player);
    let mx = T.mx, ax = T.ax;
    // 目标线 num717（:31163/:31132/:31202/:31248）：224 = 玩家顶−h/2、
    // 509/581 = 玩家中心 Y−h/2、587 = 玩家顶缘
    let ty: number;
    if (vid === 587) {
      // 白天下潜反转（:31249-31253 `if (Main.dayTime)`）：目标线锁 0（世界顶）
      // + direction 每 tick 反相——净效果 = 白天恒背向玩家横漂（下一拍复位再反相）
      // + 全程上浮离地
      ty = player ? player.y : this.y;
      if (game.world.clock.isDay) { ty = 0; this.facing = -this.facing; }
    } else if (player) {
      ty = vid === 509 || vid === 581 ? player.cy - this.h / 2 : player.y - this.h / 2;
      if (vid === 509 || vid === 581) this.visAngle = this.vx * 0.1;   // :31135/:31205
    } else {
      ty = this.cy;                                  // 无目标退档（原版本体恒持有目标槽）
    }
    // 同型聚群互斥环（:31189-31227 仅 509/581 两支）：同型 ∧ 曼哈顿和 < width →
    // X/Y 各 ±0.05 轴向推挤（A 左 B 右→左移反之同理,Y 同构）
    if (vid === 509 || vid === 581) {
      for (const o of game.enemies()) {
        const e = o as Enemy;
        if (e === this || e.dead || e.vanillaId !== vid) continue;
        if (Math.abs(this.x - e.x) + Math.abs(this.y - e.y) >= this.w) continue;
        this.vx += this.x < e.x ? -0.05 : 0.05;
        this.vy += this.y < e.y ? -0.05 : 0.05;
      }
    }
    // 失视逃逸（:31254-31263）：maxX×0.8/accel×0.7、目标线 = 中心+directionY×1000、
    // 速度定方向（vx<0→dir=-1,vx>0 或 dir==0→1）
    if (this.ai0 <= 0) {
      mx *= 0.8; ax *= 0.7;
      ty = this.cy + (this.dirY ?? 0) * 1000;
      if (this.vx < 0) this.facing = -1;
      else if (this.vx > 0 || this.facing === 0) this.facing = 1;
    }
    // X 二档加速（:31265-31297 原文式：基础步 ax；若已越帽再加全步，否则仍为正
    // （朝目标侧）加半步；末尾钳 ±maxX）；门 = 中心水平距|xGate|（587 xGate=0 恒开）
    const horiz = Math.abs(this.cx - (player ? player.cx : this.cx));   // num716
    if (horiz > T.gx) {
      if (this.facing === -1 && this.vx > -mx) {
        this.vx -= ax;
        if (this.vx > mx) this.vx -= ax;
        else if (this.vx > 0) this.vx -= ax / 2;
        if (this.vx < -mx) this.vx = -mx;
      } else if (this.facing === 1 && this.vx < mx) {
        this.vx += ax;
        if (this.vx < -mx) this.vx += ax;
        else if (this.vx < 0) this.vx += ax / 2;
        if (this.vx > mx) this.vx = mx;
      }
    }
    // yGate 抬升（:31281-31283）：横向距 > yGate → 目标线再上移 yGate/2
    if (horiz > T.gy) ty -= T.gy / 2;
    // 纵向步进（:31284-31308 与【位置】比较而非速度差）：顶缘在目标线上方/线之上
    if (this.y < ty) {
      this.vy += T.ay;
      if (this.vy < 0) this.vy += T.ay;
    } else {
      this.vy -= T.ay;
      if (this.vy > 0) this.vy -= T.ay;
    }
    this.vy = Math.max(-T.my, Math.min(T.my, this.vy));
    // wet 浮力（cs:31256-31266，587 飞鱼眼除外）：vy>0 ×0.95、恒 -0.5 上浮钳 -4
    if (this.wet && vid !== 587) {
      if (this.vy > 0) this.vy *= 0.95;
      this.vy -= 0.5;
      if (this.vy < -4) this.vy = -4;
    }
    const oldVy = this.vy;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) {
      this.facing *= -1;
      this.vx = this.facing; // cs:31086-31093 反弹后单位速（direction 由旧速翻转）
    }
    // collideY 反弹（:31094-31101）：旧速向下 → directionY=-1/vy=-1,向上 → +1/+1——
    // directionY 是失视逃逸的目标线符号源,须随反弹持久化
    if (this.hitHead) { this.dirY = 1; this.vy = oldVy < 0 ? 1 : -1; }
    else if (this.onGround) { this.dirY = -1; this.vy = oldVy < 0 ? 1 : -1; }
  }

  /** AI_056 地牢之魂 288（NPC.cs:32915-32936）：穿墙（SetDefaults noTileCollide+noGravity）
   *  惯性追踪——期望速度=朝玩家单位向量×12，velocity=(v*100+期望)/101（0.99 平滑、
   *  巨大惯性转向极慢）；rotation=atan2(dy,dx)-π/2 */
  private dungeonSpiritAI(game: GameHooks, player: Player | null) {
    let ex: number, ey: number;
    if (player && !player.dead) {
      this.facing = this.seekDirX(player);
      const d = Math.hypot(player.cx - this.cx, player.cy - this.cy) || 1;
      ex = ((player.cx - this.cx) / d) * 12;
      ey = ((player.cy - this.cy) / d) * 12;
    } else {
      ex = this.facing * 6;
      ey = -6;
    }
    this.vx = (this.vx * 100 + ex) / 101;
    this.vy = (this.vy * 100 + ey) / 101;
    // rotation 基向 = 目标方向向量 (num886/887) 而非当前速度（cs:32926-32927,
    // 审计 D dungeonSpirit——曾用速度角致惯性漂移时魂火倒转）
    this.visAngle = Math.atan2(ey, ex) - Math.PI / 2;
    // 每 tick 尾尘 180（:33009-33012；C 批改真实尘型）：NewDust(position,w,h,180)
    // 随机初速 ×0.1、scale=1.3、noGravity
    {
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 180);
      if (d) {
        d.vx *= 0.1; d.vy *= 0.1;
        d.scale = 1.3;
        d.noGravity = true;
      }
    }
    this.x += this.vx;
    this.y += this.vy;
  }

  /** AI_008 法师族（Fire Imp 24 / Goblin Sorcerer 29 / Dark Caster 32）：
   *  悬浮 + 周期传送（原版 ai[0] 计时到阈值或目标不可见时 TeleportSearch）+ 三连弹幕（原版 ai[1] volley）。
   *  弹幕复用 Dart（命中玩家）；传送条件：4-16 格内有地面 + 上下净空（原版 100 次随机试探） */
  /** AI_002_FloatingEye 通用核（NPC.cs:19118-19440）：
   *  分轴非对称加速 X±4 / Y±2.5（Wandering Eye 133 半血以下激怒 ±6/±4）；
   *  撞墙/撞地按 旧速度*-0.5 反弹并保证最小弹速（L19124-19140）；
   *  白天地表驱散（cs:52707/53152 昼散表）：EncourageDespawn(10)+保持水平方向上飞 */
  private floatEyeAI(game: GameHooks, player: Player | null) {
    // 猪龙 grunt（AI_002 :52677-52680）：170/171/180 → PlaySound(29,9)=Zombie_9 1/1000
    if ((this.vanillaId === 170 || this.vanillaId === 171 || this.vanillaId === 180)
      && Math.floor(Math.random() * 1000) === 0) {
      game.playSfxWav?.('Zombie_9', 1, this.cx, this.cy);
    }
    // 撞墙反弹（collideX/Y → hitWall/hitHead/onGround + 上一帧速度近似 oldVelocity）
    const oldVx = this.vx, oldVy = this.vy;
    // ---- 白天地表驱散（cs:52707-52715 + IsDiscouraged :53152）：
    // 白天 && y≤worldSurface && 类型 ∈ 眼族昼散表 → EncourageDespawn(10) +
    // 保持水平运动方向、directionY=-1 向上飞离（离屏后 CheckActive ~10t 清除）。
    // 墓地豁免（:53154 `!Main.player[target].ZoneGraveyard` 首条件）：目标玩家在墓地时
    // 恶魔眼白天不驱散（scene 为本地玩家快照，单人下等价）
    const day = game.world.clock.isDay && !game.world.scene?.zoneGraveyard;
    const eyeDiscouraged = day && this.cy <= game.world.groundLevel * TILE
      && this.vanillaId != null && EYE_DAY_DESPAWN.has(this.vanillaId);
    let dirX: number, dirY: number, cx: number, cy: number;
    // Y 轴步长/二档/漂移（R6-B 2-2，1457 :53225-53256 default 档：步 0.04、超帽
    // −0.05、vy>0 漂移 +0.03；133 狂怒档 :53086-53117：步 0.1、超帽 −0.1、漂移
    // +0.05）。帽 num2=4/num3=1.5 ×(1+(1−scale))（:53189-53192）——曾 Y 步 0.1
    // （2.5×过快）、Y 帽 2.5、二档并档无漂移
    let stepY = 0.04, overCapY = 0.05, driftY = 0.03;
    const eyeScaleK = 2 - (this.vanillaScale ?? 1);          // 1+(1−scale)
    if (eyeDiscouraged) {
      this.encourageDespawn(10);
      dirX = oldVx > 0 ? 1 : -1;   // 原版保持水平方向（direction=-1，vx>0 时翻 1）
      dirY = -1;
      this.dirY = -1;              // 原版 directionY=-1 随 discouragement 持续
      cx = 4 * eyeScaleK; cy = 1.5 * eyeScaleK;
    } else if (!player) {
      // 玩家死亡/无目标（原版语义：TargetClosest 落空是【无操作】——
      // TargetClosestUpgraded :78421 无有效玩家时 num4 哨兵未动直接 return，
      // direction/directionY 全部保持原值）→ 保持当前朝向 + 沿用上次垂直方向
      // 滑行，由 despawn 系统（CheckActive 屏外倒数；死亡玩家 active 仍真照常
      // 计屏内=T6 收窄，:78706 只剔 !active）750t 倒数消散。
      // 曾写 dirX=-sign(vx)（朝自己速度的反方向看 → X 反复减速过零 = 左右朝向
      // 抽搐）+ 恒 dirY=-1（无条件上飞——上飞是白天驱散分支专属），2026-08-19 修正
      dirX = this.facing;
      dirY = this.dirY;
      cx = 4 * eyeScaleK; cy = 1.5 * eyeScaleK;
    } else {
      // TargetClosest（confused 反转 X；directionY 原版不反转）
      dirX = this.seekDirX(player);
      dirY = player.cy > this.cy ? 1 : -1;
      this.dirY = dirY;   // 持久化（玩家死亡后沿用最后垂直方向,≈原版 directionY 保留）
      const rage = this.vanillaId === 133 && this.hp < this.maxHp * 0.5;
      cx = rage ? 6 : 4 * eyeScaleK;
      cy = rage ? 4 : 1.5 * eyeScaleK;
      if (rage) { stepY = 0.1; overCapY = 0.1; driftY = 0.05; }   // :53086-53117
    }
    this.facing = dirX;
    const vid2 = this.vanillaId ?? 0;
    const isPigron = vid2 === 170 || vid2 === 171 || vid2 === 180;
    // ---- 猪龙三色（170 腐化/171 圣域/180 猩红,cs:52726-52791,审计眼睛族）：
    //  穿墙相位机——失视线累计 ai[0]≥300t → ai[1]=1 入相（α200 + noTileCollide,
    //  half-transparent 穿墙逼近）;有视线且自身已脱出实心块 → ai[1]/ai[0] 双清回
    //  实体态。移动带"未越过玩家"门（整盒仍在目标侧才加速）;rotation=vy×0.1×dir ----
    let pigronPhased = false;
    if (isPigron && player && !player.dead) {
      if (this.canSeePlayer(game.world.store, player)) {
        if (this.ai1 > 0 && !this.embeddedInSolid(game.world.store)) {
          this.ai1 = 0;
          this.ai0 = 0;
        }
      } else if (this.ai1 === 0) {
        this.ai0 += 1;
      }
    }
    if (this.ai0 >= 300) { this.ai1 = 1; this.ai0 = 0; }
    if (this.ai1 === 0) {
      this.spawnAlpha = 0;                     // alpha=0 实体态（渲染 globalAlpha=1-α/255）
    } else {
      this.spawnAlpha = 200;                   // α200 + noTileCollide（wet=false 由下方 wet 排除门承担）
      pigronPhased = true;
    }
    if (isPigron) {
      if (player && !player.dead) {
        // X（cs:52769-52787）：整盒仍在玩家左侧（dir=1）/右侧（dir=-1）才加速;
        // 步 0.08、二档(>4) 0.04、逆向修正 0.2（朝目标强反转）、帽 ±4
        if (dirX === -1 && this.vx > -4 && this.x > player.x + player.w) {
          this.vx -= 0.08;
          if (this.vx > 4) this.vx -= 0.04; else if (this.vx > 0) this.vx -= 0.2;
          if (this.vx < -4) this.vx = -4;
        } else if (dirX === 1 && this.vx < 4 && this.x + this.w < player.x) {
          this.vx += 0.08;
          if (this.vx < -4) this.vx += 0.04; else if (this.vx < 0) this.vx += 0.2;
          if (this.vx > 4) this.vx = 4;
        }
        // Y（cs:52788-52791+）：整盒仍在玩家上方/下方才加速;步 0.1、二档 0.05、
        // 逆向修正 0.15、帽 ±2.5
        if (dirY === -1 && this.vy > -2.5 && this.y > player.y + player.h) {
          this.vy -= 0.1;
          if (this.vy > 2.5) this.vy -= 0.05; else if (this.vy > 0) this.vy -= 0.15;
          if (this.vy < -2.5) this.vy = -2.5;
        } else if (dirY === 1 && this.vy < 2.5 && this.y + this.h < player.y) {
          this.vy += 0.1;
          if (this.vy < -2.5) this.vy += 0.05; else if (this.vy < 0) this.vy += 0.15;
          if (this.vy > 2.5) this.vy = 2.5;
        }
      }
    } else if (vid2 === 116) {
      // ---- 116 饿魂 II 专属档（cs:52825-52899,审计眼睛族）：X 步 0.1/帽 ±6/
      //      二档 0.1/逆向修正 0.2;Y 上行门 2.5 步 0.04、下行门 1.5（帽仍 2.5）;
      //      1/40 血尘 ----
      if (dirX === -1 && this.vx > -6) {
        this.vx -= 0.1;
        if (this.vx > 6) this.vx -= 0.1; else if (this.vx > 0) this.vx -= 0.2;
        if (this.vx < -6) this.vx = -6;
      } else if (dirX === 1 && this.vx < 6) {
        this.vx += 0.1;
        if (this.vx < -6) this.vx += 0.1; else if (this.vx < 0) this.vx += 0.2;
        if (this.vx > 6) this.vx = 6;
      }
      if (dirY === -1 && this.vy > -2.5) {
        this.vy -= 0.04;
        if (this.vy > 2.5) this.vy -= 0.05; else if (this.vy > 0) this.vy -= 0.15;
        if (this.vy < -2.5) this.vy = -2.5;
      } else if (dirY === 1 && this.vy < 1.5) {
        this.vy += 0.04;
        if (this.vy < -2.5) this.vy += 0.05; else if (this.vy < 0) this.vy += 0.15;
        if (this.vy > 2.5) this.vy = 2.5;
      }
      if (Math.random() < 1 / 40) {
        game.spawnParticles(this.cx, this.y + this.h * 0.5, '#8A3030', 1, 0.3, { life: 30, damp: 0.9, grav: 0 });
      }
    } else {
    // X 轴（1457 :53193-53224）：未越过目标且未达上限 → 朝目标加速 0.1；仍超对侧
    // 帽再 −0.1（急回）；0<vx<帽 漂移过冲 +0.05（原版字面，制造绕目标摆动）
    if (dirX === -1 && this.vx > -cx) {
      this.vx -= 0.1;
      if (this.vx > cx) this.vx -= 0.1;
      else if (this.vx > 0) this.vx += 0.05;
      if (this.vx < -cx) this.vx = -cx;
    } else if (dirX === 1 && this.vx < cx) {
      this.vx += 0.1;
      if (this.vx < -cx) this.vx += 0.1;
      else if (this.vx < 0) this.vx -= 0.05;
      if (this.vx > cx) this.vx = cx;
    }
    // Y 轴（1457 :53225-53256，R6-B 2-2 档位还原）：步 0.04（133 狂怒 0.1）、
    // 超帽 −0.05（狂怒 −0.1）、反向漂移 +0.03（狂怒 +0.05）、帽 ±num3
    if (dirY === -1 && this.vy > -cy) {
      this.vy -= stepY;
      if (this.vy > cy) this.vy -= overCapY;
      else if (this.vy > 0) this.vy += driftY;
      if (this.vy < -cy) this.vy = -cy;
    } else if (dirY === 1 && this.vy < cy) {
      this.vy += stepY;
      if (this.vy < -cy) this.vy += overCapY;
      else if (this.vy < 0) this.vy -= driftY;
      if (this.vy > cy) this.vy = cy;
    }
    }
    // rotation = vy × 0.1 × direction（AI_002 全族无条件，1457 :52906——俯冲/爬升
    // 倾斜旋转+镜像翻转;曾误锁猪龙 170/171/180 支,恶魔眼本体不转=用户实报）
    this.visAngle = this.vy * 0.1 * dirX;
    // ---- 眼族尘（1457 :53258-53268，R6-B 4-12）：2 恶魔眼/133/190-194 克苏鲁眼
    //  仆从 1/40 尘 5（棕烟）——曾只接 116 尘 ----
    if ((vid2 === 2 || vid2 === 133 || (vid2 >= 190 && vid2 <= 194))
      && Math.floor(Math.random() * 40) === 0) {
      game.spawnParticles(this.cx, this.cy, '#8B7355', 1, 0.3, { life: 30, damp: 0.9, grav: 0 });
    }
    if (pigronPhased) {
      // 相位态 noTileCollide：幽灵位移、无碰撞无反弹（cs:52692-52715 的 !noTileCollide 门）
      this.hitWall = false; this.hitHead = false; this.onGround = false;
      this.x += this.vx;
      this.y += this.vy;
      return;
    }
    moveAndCollide(this, game.world, this.vx, this.vy);
    // 碰撞反弹（在碰撞后按旧速度算）
    if (this.hitWall) {
      this.vx = -oldVx * 0.5;
      if (this.facing === -1 && this.vx > 0 && this.vx < 2) this.vx = 2;
      if (this.facing === 1 && this.vx < 0 && this.vx > -2) this.vx = -2;
    }
    if (this.hitHead || this.onGround) {
      this.vy = -oldVy * 0.5;
      if (this.vy > 0 && this.vy < 1) this.vy = 1;
      if (this.vy < 0 && this.vy > -1) this.vy = -1;
    }
    // wet 浮力尾段（cs:53117-53127）：wet 且非 170/171/180（猪龙三色变种，照常潜行）→
    // vy>0 ×0.95 阻下落、恒 -0.5 上浮、下限 -4 并重新索敌——飘浮眼入水弹出水面
    // 而非照常追击；此前缺失（"怪物下水照常攻击"主诉的飞行侧成因）
    if (this.wet && this.vanillaId !== 170 && this.vanillaId !== 171 && this.vanillaId !== 180) {
      if (this.vy > 0) this.vy *= 0.95;
      this.vy -= 0.5;
      if (this.vy < -4) this.vy = -4;
      if (player) this.facing = this.seekDirX(player);   // TargetClosest
    }
    // ---- 点光（cs:52826-52828）：116 饿魂 II（脱落追击态）Center (0.3,0.2,0.1) 恒亮
    if (this.vanillaId === 116) this.lightRGB = [0.3, 0.2, 0.1];
  }

  /** AI_005 噬魂怪族（NPC.cs:17567-17790）"蜂群"AI：
   *  目标方向 8px 网格量化 → 期望速度 = 归一化方向 × maxSpd；
   *  ai[0] 环绕摆动（>0 加 vy、|>100| 加 vx，±200 循环）产生盘旋蜂群感（L17742-17752）；
   *  近距(<150) 附加 0.007×期望速度制导（L17754-17757）；
   *  各轴以 accel 步进逼近期望速度（L17774-17789）。
   *  速度表（L17610-17617）：Eater of Souls(6)/Crimera(173) 4/0.02，默认 6/0.05 */
  /** AI_013 植物/攀爬者族(NPC.cs:22604-22700 一比一):锚点格(ai0/ai1)固定,
   *  朝玩家伸展(range 内钳制),逆向加速 ×1.5;锚点格被挖掉即死;300-450 tick 周期 range ×1.3。
   *  攀爬者 101: range 175、accel 0.035、noTileCollide 幽灵位移(穿墙摆动)。 */
  private plantAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    // 未初始化(-1120)自愈：绕过 VanillaSpawner 锚点传参的生成路径(fromVanilla/
    // spawnNpcByVanilla/微光 Transform 等)从这里进——用当前格补锚点,否则下方
    // ai0<0 判定会即刻误杀(2026-08-13 ai0 陷阱清查)
    if (this.ai0 === -1120) {
      this.ai0 = Math.floor(this.cx / TILE);
      this.ai1 = Math.floor(this.cy / TILE);
    }
    // 锚点格失活 → 死亡（1457 NPC.cs:22729-22734 `if (!Main.tile[ai0,ai1].active())
    //   { life=-1; HitEffect(); active=false; return; }`——active() 位本体读 hasTile。
    //   红蓝对抗 F4：曾用 type===0 代读 active 位，幽灵残型锚（flags=0,type≠0）漏判存活）
    if (this.ai0 < 0 || this.ai1 < 0 || !st.inBounds(this.ai0, this.ai1)
      || !st.hasTile(this.ai0, this.ai1)) {
      this.dead = true;
      return;
    }
    let range = 150;  // 默认 num218(:22632)；族内覆盖(:22636-22658)
    let accel = 0.035; // num217(:22630)
    if (this.vanillaId === 43) range = 250;          // 食人怪（getGoodWorld 350 未接入）
    else if (this.vanillaId === 101) range = 175;    // 邪恶触手
    else if (this.vanillaId === 259) range = 100;    // 真菌球
    else if (this.vanillaId === 175) { range = 500; accel = 0.05; }   // 怒牙捕兽草
    else if (this.vanillaId === 260) { range = 350; accel = 0.15; }   // 巨型真菌球
    // ai2:300-450 tick 周期 → range ×1.3(:22644-22653)
    this.ai2 += 1;
    if (this.ai2 > 300) {
      range = Math.floor(range * 1.3);
      if (this.ai2 > 450) this.ai2 = 0;
    }
    const ax = this.ai0 * 16 + 8, ay = this.ai1 * 16 + 8;
    // 目标点 = 锚点 + 朝玩家偏移(钳制在 range 内,:22655-22665)。玩家死亡时
    // 原版无 dead 门(:22655 直读 target 槽位)——保持最后偏移,不缩回锚点
    let ox = 0, oy = 0;
    if (player) {
      ox = player.cx - this.w / 2 - ax;
      oy = player.cy - this.h / 2 - ay;
      const d = Math.hypot(ox, oy);
      if (d > range) { ox = ox / d * range; oy = oy / d * range; }
      this.plantLastOx = ox; this.plantLastOy = oy;
    } else if (this.plantLastOx !== 0 || this.plantLastOy !== 0) {
      ox = this.plantLastOx; oy = this.plantLastOy;   // stale target（审计 A3）
    }
    // 各轴逼近,逆向 ×1.5(:22666-22699)
    const tx = ax + ox, ty = ay + oy;
    if (this.x < tx) {
      this.vx += accel;
      if (this.vx < 0 && ox > 0) this.vx += accel * 1.5;
    } else if (this.x > tx) {
      this.vx -= accel;
      if (this.vx > 0 && ox < 0) this.vx -= accel * 1.5;
    }
    if (this.y < ty) {
      this.vy += accel;
      if (this.vy < 0 && oy > 0) this.vy += accel * 1.5;
    } else if (this.y > ty) {
      this.vy -= accel;
      if (this.vy > 0 && oy < 0) this.vy -= accel * 1.5;
    }
    // 速度钳（cs:22725-22760,曾全缺 = 追击段越冲越快抖振,审计 P1,2026-08-19）：
    //  43 食人怪 ±3（FTW 3.5）/ 175 怒牙 ±4 / 其余（101/259/260）±2
    {
      const cap43 = game.world.seedFlags?.getGoodWorld ? 3.5 : 3;
      const cap = this.vanillaId === 43 ? cap43 : this.vanillaId === 175 ? 4 : 2;
      this.vx = Math.max(-cap, Math.min(cap, this.vx));
      this.vy = Math.max(-cap, Math.min(cap, this.vy));
    }
    this.facing = this.vx > 0 ? 1 : -1;
    // ---- 头部旋转（cs:22778-22794）：259/260 真菌球恒 +π/2；其余（43 食人怪/101 触手/175）
    // 朝玩家伸展方向 atan2(num220,num219)，目标在左（num219<0）+π 且 spriteDirection=-1——
    // 旋转+镜像组合保证头从不倒挂（此前只镜像不旋转 → 横向硬转）
    if (this.vanillaId === 259 || this.vanillaId === 260) {
      this.visAngle = Math.atan2(oy, ox) + Math.PI / 2;
    } else {
      if (ox > 0) { this.facing = 1; this.visAngle = Math.atan2(oy, ox); }
      else if (ox < 0) { this.facing = -1; this.visAngle = Math.atan2(oy, ox) + Math.PI; }
    }
    // ---- 爬行者 101 诅咒焰（cs:22824-22852）：localAI[0]（本仓 ai3）每 tick +1，
    // ≥120 且自身未嵌实心且有视线 → 喷诅咒焰（速 10、伤 GetAttackDamage(22,17.6)、
    // 散布 ±10、timeLeft 300——P3 批）；justHit → 计数清零（:22826-22829）；
    // 条件不满足回退 100（20t 重试）----
    if (this.vanillaId === 101 && player && !player.dead) {
      if (this.justHit) this.ai3 = 0;                           // :22826-22829
      this.ai3 += 1;
      if (this.ai3 >= 120) {
        // 1457 :22880-22884：开火门加 flag23 = AI_GlobalFiringDistanceCheck
        if (!this.embeddedInSolid(st)
          && aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)
          && this.canSeePlayer(st, player)) {
          const dmgP = getAttackDamageForProjectiles(22, 17.6, this.difficulty);  // :22843
          // :22837-22845：瞄准 ±10 抖动 → 归一 ×10（num222）
          let txP = player.cx - this.cx + (Math.floor(Math.random() * 21) - 10);
          let tyP = player.cy - this.cy + (Math.floor(Math.random() * 21) - 10);
          const dP = Math.hypot(txP, tyP) || 1;
          txP = (txP / dP) * 10;
          tyP = (tyP / dP) * 10;
          const dart96 = new Dart(this.cx, this.cy, txP, tyP, dmgP, 96);
          dart96.hostile = true;
          dart96.life = 300;                                    // :22846 timeLeft=300
          (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities
            .add(dart96, 'projectiles');
          this.ai3 = 0;
        } else this.ai3 = 100;                                  // :22851
      }
    }
    // ---- 巨型真菌球 260 孢子连发（P2，cs:22855-22893）：justHit 清零计数，
    // ≥150 且未嵌实心且有视线 → 朝玩家喷真菌孢子 NPC 261（速 14、瞄准 ±10 抖动 +
    // |dx|×0.1 下坠补偿），发射后归零；条件不满足回退 250（净空即发）----
    if (this.vanillaId === 260 && player && !player.dead) {
      if (this.justHit) this.ai3 = 0;                           // :22859-22862
      this.ai3 += 1;
      if (this.ai3 >= 150) {
        // ★2026-08-30 实体侧对账批：原版 260 开火门同样带 flag23 =
        //   AI_GlobalFiringDistanceCheck（1457 NPC.cs:22927 `(!SolidCollision & flag23)
        //   && Collision.CanHit(this, Main.player[target])`；与 Clinger 101 支 :22892
        //   同式，aiStyle13 公共 flag23 定义于段首）——此前漏接距离门。
        if (!this.embeddedInSolid(st)
          && aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)
          && this.canSeePlayer(st, player)) {
          const num225 = 14;                                    // :22870
          let dxS = player.cx - this.cx + (Math.floor(Math.random() * 21) - 10);
          let dyS = player.cy - this.cy + (Math.floor(Math.random() * 21) - 10)
            - Math.abs(dxS * 0.1);                              // :22872-22878
          const dS = Math.hypot(dxS, dyS) || 1;
          dxS = (dxS / dS) * num225;
          dyS = (dyS / dS) * num225;
          const spore = Enemy.fromVanilla(261, this.cx, this.cy);
          if (spore) {
            // ★Bottom 锚（1457 :22942 NewNPC((int)Center.X,(int)Center.Y,261) →
            //  Bottom=(Center.X,Center.Y)）:孢子顶 = cy−h——旧中心锚低 h/2
            spore.y = this.cy - spore.h;
            spore.vx = dxS;                                     // :22884-22885 NewNPC 261
            spore.vy = dyS;
            addEnemy(game, spore);
          }
          this.ai3 = 0;                                         // :22887
        } else {
          // ★F6 回退延时两版分叉（2026-08-30 实体侧对账批）：1456 NPC.cs:22891 =
          //   localAI[0]=250f；1457 同支 :22950 改 130f（1457 新增 flag23 =
          //   AI_GlobalFiringDistanceCheck 批同步收紧,CLAUDE.md 冲突以 1457 为准）
          this.ai3 = 130;                                       // 1456 cs:22891=250f → 1457 :22950=130f
        }
      }
    }
    // noTileCollide:幽灵位移(原版 plants 不做 tile 碰撞)
    this.x += this.vx;
    this.y += this.vy;
  }

  private swarmerAI(game: GameHooks, player: Player | null) {
    // ---- Mechdusa 探针挂链(NPC.cs AI_005 :50866-50920):ai3≠0 = 召唤链出生的
    //      挂链探针 → 绕毁灭者头公转锁位(queen 在场时无敌);失效即脱落回常规 ----
    if (this.vanillaId === 139 && this.ai3 !== 0 && mechProbeLock(this, game, player)) return;
    const st = game.world.store;
    const vid = this.vanillaId ?? 0;   // swarmerAI 仅数据驱动路径可达，vanillaId 恒非空
    const scale = this.vanilla?.scale ?? 1;
    const isBee = vid === 210 || vid === 211;         // 蜜蜂（TargetClosestNonBees 差异无蜜蜂敌人,略）
    const isHornet = vid === 42 || vid === 176 || (vid >= 231 && vid <= 235);
    // ---- 619 血鱿鱼头部整段（cs:50645-50681,审计蜂群#4,2026-08-19）：
    //  白天 vy-0.3 + EncourageDespawn(60)（其余族白天走尾部通用表）；
    //  出生 alpha=255 渐显 -15/t：首帧 spriteDirection=direction、vy=-6、35 颗血尘
    //  （dust 5,velocity+自身速度×0.5）；显影期(α≠0)每 tick 再 2 颗 ----
    if (vid === 619) {
      if (game.world.clock.isDay) { this.vy -= 0.3; this.encourageDespawn(60); }
      if (!this.bInit) { this.bInit = true; this.spawnAlpha = 255; this.alphaFade = false; }
      if (this.spawnAlpha === 255) {
        this.vy = -6;
        game.spawnParticles(this.cx, this.cy, '#B01830', 12, 3, { life: 40, grav: 0 });
      }
      this.spawnAlpha = Math.max(0, this.spawnAlpha - 15);
      if (this.spawnAlpha !== 0) {
        game.spawnParticles(this.cx, this.cy, '#B01830', 2, 2, { life: 40, grav: 0 });
      }
    }
    // flag（cs:50682-50686）= 目标玩家死亡（原版 TargetClosest 后仍指向尸体——
    // 分发入口滤成 null 时经 rawPlayer 取原对象,A 批先例）。
    // M11：rawPlayer = 当前索敌目标（Main.player[npc.target]，联机可为访客代理）
    const rawPlayer = this.targetRef(game, player);
    const flag = !rawPlayer || rawPlayer.dead;
    // ---- 速度/加速表（cs:50687-50766,审计蜂群#1 速度表 2026-08-19 已铺,
    //      本批补齐 252 鹦鹉视线档 + 231-235 基速 3.5 与 ×(1-scale) 乘区）：
    //  6/173 噬魂怪 4/0.02（6 专家 0.035,remix 5/0.06）；94 腐化者 4.2/0.022；
    //  619 血鱿鱼 6/0.1；252 鹦鹉 6/0.1（失视线 2/0.01）；42/231-235 黄蜂族
    //  3.5/0.021（231 覆写 3/0.017）×(1−scale)；205 飞蛾 3.25/0.018；
    //  176 苔藓黄蜂 4/0.017；23 陨石头 1/0.03；5 仆从 5/0.03；默认 6/0.05 ----
    let maxSpd = 6, accel = 0.05;
    if (vid === 6 || vid === 173) {
      maxSpd = 4; accel = 0.02;
      if (vid === 6 && mainExpertMode(game.world)) accel = 0.035;
      if (game.world.seedFlags?.remix) { accel = 0.06; maxSpd = 5; }
    } else if (vid === 94) { maxSpd = 4.2; accel = 0.022; }
    else if (vid === 619) { maxSpd = 6; accel = 0.1; }
    else if (vid === 252) {
      // :50707-50717 有目标且有视线 → 6/0.1，否则 2/0.01（游荡慢飞档）
      if (player && !player.dead && this.canSeePlayer(st, player)) { maxSpd = 6; accel = 0.1; }
      else { maxSpd = 2; accel = 0.01; }
    } else if (isHornet) {
      maxSpd = 3.5; accel = 0.021;
      if (vid === 231) { maxSpd = 3; accel = 0.017; }
      // 1457 :50884-50885 修复：×(1f−scale) → ×(2f−scale)——蜂族 scale=1 时 1456
      // 乘 0 = 速度/加速全零（只余 ±0.023 漂移悬停），1457 恢复正常追击
      maxSpd *= 2 - scale; accel *= 2 - scale;
      // ---- 黄蜂地表 Y 阻尼（cs:50735-50747,审计蜂群#2）：自身在地表以上时,
      //      目标远低于自身 300px(下追过冲)或仅低 80px 内(贴地平飞)都 ×0.97 阻垂速 ----
      if (this.y / TILE < game.world.groundLevel && player) {
        if (player.y - this.y > 300 && this.vy < 0) this.vy *= 0.97;
        if (player.y - this.y < 80 && this.vy > 0) this.vy *= 0.97;
      }
    } else if (vid === 205) { maxSpd = 3.25; accel = 0.018; }
    else if (vid === 176) { maxSpd = 4; accel = 0.017; }
    else if (vid === 23) { maxSpd = 1; accel = 0.03; }
    else if (vid === 5) { maxSpd = 5; accel = 0.03; }
    else if (vid === 139 && game.world.seedFlags?.remix) { maxSpd = 3; }
    // 蜜蜂（210/211，cs:50768-50784）：ai[1] 计数爬坡 num3=(ai1-60)/60≤1；
    // 暖机期（num3<1）逐轴速度钳 ±6（四个独立 if,非 else-if 链）；5 / 0.1×num3
    if (isBee) {
      this.ai1 += 1;
      let ramp = (this.ai1 - 60) / 60;
      if (ramp > 1) ramp = 1;
      else {
        if (this.vx > 6) this.vx = 6;
        if (this.vx < -6) this.vx = -6;
        if (this.vy > 6) this.vy = 6;
        if (this.vy < -6) this.vy = -6;
      }
      maxSpd = 5;
      accel = 0.1 * ramp;
    }
    // ---- 目标向量：8px 网格量化（cs:50768-50790）。死亡玩家仍走尸体坐标（rawPlayer）;
    //      真无玩家才退自身位置 → dist=0 → 期望速度=当前速度（不转向,滑行） ----
    const tp = rawPlayer ?? player;
    const tx = tp ? tp.cx : this.cx;
    const ty = tp ? tp.cy : this.cy;
    const dx = Math.floor(tx / 8) * 8 - Math.floor(this.cx / 8) * 8;
    const dy = Math.floor(ty / 8) * 8 - Math.floor(this.cy / 8) * 8;
    const dist = Math.hypot(dx, dy);        // num6/num7（量化距离）
    const flag2 = dist > 600;               // :50791-50795 远距门（探针增速）
    let sx: number, sy: number;
    if (dist === 0) { sx = this.vx; sy = this.vy; }   // :50796-50799
    else { sx = (dx / dist) * maxSpd; sy = (dy / dist) * maxSpd; }
    // :50850-50862：玩家死亡 → 期望速度 = direction×num/2, −num/2（半速上飞离场）；
    // 619 有目标且 Center.Y > 目标 Center.Y − 200（掉到悬停线下方）→ vy −0.3 抬升
    if (flag) {
      sx = this.facing * maxSpd / 2;
      sy = -maxSpd / 2;
    } else if (vid === 619 && tp && this.cy > tp.cy - 200) {
      this.vy -= 0.3;
    }
    // ---- 摆动项（cs:50863-50885）：num8 族（6/139/173/205）需 dist>100；flag3 族
    //      （42/94/619/176/210/211/231-235）无条件摆动。★num8 族近距【不归零 ai[0】
    //      （原版无 else 清零——审计蜂群#8,曾自造 `ai0=0` 致出近距相位突跳）----
    const num8 = vid === 6 || vid === 139 || vid === 173 || vid === 205;
    const flag3 = isHornet || vid === 94 || vid === 619 || isBee;
    // flag4（cs:50888-50889）：非 173/6/42/231-235/94/139/619 = 双步加速
    const flag4 = vid !== 173 && vid !== 6 && vid !== 42 && (vid < 231 || vid > 235)
      && vid !== 94 && vid !== 139 && vid !== 619;
    if (num8 || flag3) {
      if (dist > 100 || flag3) {
        if (this.ai0 < -200) this.ai0 = 0; // 类默认 -1120 钳回原版下界（振荡相位漂移 ~22s,2026-08-13 清查）
        this.ai0 += 1;
        if (this.ai0 > 0) this.vy += 0.023;
        else this.vy -= 0.023;
        if (this.ai0 < -100 || this.ai0 > 100) this.vx += 0.023;
        else this.vx -= 0.023;
        if (this.ai0 > 200) this.ai0 = -200;
      }
      // 近距制导（cs:50878-50882，仅 6/94/173/619）
      if (dist < 150 && (vid === 6 || vid === 94 || vid === 173 || vid === 619)) {
        this.vx += sx * 0.007;
        this.vy += sy * 0.007;
      }
    }
    // ---- 各轴步进逼近期望速度（cs:50929-50962）：flag4 族逆向时追加一步 ----
    if (this.vx < sx) {
      this.vx += accel;
      if (flag4 && this.vx < 0 && sx > 0) this.vx += accel;
    } else if (this.vx > sx) {
      this.vx -= accel;
      if (flag4 && this.vx > 0 && sx < 0) this.vx -= accel;
    }
    if (this.vy < sy) {
      this.vy += accel;
      if (flag4 && this.vy < 0 && sy > 0) this.vy += accel;
    } else if (this.vy > sy) {
      this.vy -= accel;
      if (flag4 && this.vy > 0 && sy < 0) this.vy -= accel;
    }
    // ---- 朝向/旋转基座按族分流（cs:50962-51046,审计蜂群#10）：
    //  23 陨石头/139 探针：spriteDirection=sx 符号 + rotation=atan2(sy,sx)
    //   （sx<0 再 +π；★无 −1.57 转头修正——贴图正面朝 +X）；
    //  6/94/173/619：rotation=atan2(sy,sx)−1.57（期望速度角,噬魂怪永远盯着目标）；
    //  42/176/205/231-235：spriteDirection=vx 符号 + rotation=vx×0.1（仅倾斜）；
    //  其余（仆从 5 等）：atan2(vy,vx)−1.57（当前速度角） ----
    if (vid === 23 || vid === 139) {
      this.facing = sx > 0 ? 1 : -1;
      this.visAngle = Math.atan2(sy, sx) + (sx < 0 ? Math.PI : 0);
    } else if (vid === 6 || vid === 94 || vid === 173 || vid === 619) {
      this.visAngle = Math.atan2(sy, sx) - Math.PI * 0.5;
    } else if (isHornet || vid === 205) {
      // ★BJ581：≡原版 AI_005 三元 spriteDirection（NPC.cs:51186-51189,vx==0 强制 -1;
      //   1456 :51031-51042 为 if/if 死区档——按 1457 三元落）。黄蜂族=随面镜像族,
      //   渲染端经 tiltOnly5+通用 facing 门翻面（极性/节拍全等,销案锚 tests/bj581）。
      this.facing = this.vx > 0 ? 1 : -1;
      this.visAngle = this.vx * 0.1;
    } else {
      this.visAngle = Math.atan2(this.vy, this.vx) - Math.PI * 0.5;
    }
    // ---- 探针 139 射击段（cs:50975-51007,原版位于旋转段内）：localAI[0] +1/t
    //      （挂链 +3 已在 mechProbeLock）、受击清零；cadence 120（常规）/360（mech）；
    //      84 号弹 25 伤——mech 弹道 = 目标中心−自身中心−玩家速度×20 归一 ×8 ----
    if (vid === 139) {
      this.lai0 += 1;
      if (this.justHit) this.lai0 = 0;
      if (this.lai0 >= (mechQueenUp() ? 360 : 120)) {
        this.lai0 = 0;
        // 1457 :50830-50836 flag2（AI_GlobalFiringDistanceCheck）入探针开火门
        if (player && aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)
          && losClear(game, this.cx, this.cy, player.cx, player.cy)) {
          let pvx = sx, pvy = sy;
          if (mechQueenUp()) {
            const ddx = player.cx - this.cx - player.vx * 20;
            const ddy = player.cy - this.cy - player.vy * 20;
            const dl = Math.hypot(ddx, ddy) || 1;
            pvx = ddx / dl * 8; pvy = ddy / dl * 8;
          }
          shoot(game, this.cx, this.cy, pvx, pvy,
            getAttackDamageForProjectiles(25, 22, this.difficulty), 84);
        }
      }
      // 点光（cs:51009-51017）：中心格在世界内且非实心 → Center (0.3,0.1,0.05)
      const ltx = Math.floor(this.cx / TILE), lty = Math.floor(this.cy / TILE);
      if (st.inBounds(ltx, lty) && !st.isSolid(ltx, lty)) {
        this.lightRGB = [0.3, 0.1, 0.05];
      }
    }
    // ---- 碰撞族 12 类型门（cs:51047-51105,审计蜂群#9）：{6,619,23,42,94,139,
    //      173,176,205,210,211,231-235} 吃 collideX/Y 反弹（6/173 ×0.4,其余 ×0.7,
    //      最小弹速 X ±2 朝向/Y ±2）；表外成员（5 仆从/252 鹦鹉）无反弹只滑行,
    //      252 连尘都不出,其余表外 1/40 血尘。反弹基 = 移动前速度（moveAxis 撞击
    //      清零,原版 oldVelocity 语义——曾误用撞后 this.vx=0 → 弹速恒最小档） ----
    const inCollideList = vid === 6 || vid === 619 || vid === 23 || vid === 42 || vid === 94
      || vid === 139 || vid === 173 || vid === 176 || vid === 205 || isBee
      || (vid >= 231 && vid <= 235);
    const ghost = !!this.vanilla?.noTileCollide;   // 5/23/139 等原版幽灵位移（无 tile 碰撞）
    const oldVx = this.vx, oldVy = this.vy;
    if (ghost) {
      this.hitWall = false; this.hitHead = false; this.onGround = false;
      this.x += this.vx;
      this.y += this.vy;
    } else {
      moveAndCollide(this, game.world, this.vx, this.vy);
    }
    if (inCollideList) {
      const bounce = (vid === 6 || vid === 173) ? 0.4 : 0.7;
      if (this.hitWall) {
        this.vx = -oldVx * bounce;
        if (this.facing === -1 && this.vx > 0 && this.vx < 2) this.vx = 2;
        if (this.facing === 1 && this.vx < 0 && this.vx > -2) this.vx = -2;
      }
      if (this.onGround || this.hitHead) {
        this.vy = -oldVy * bounce;
        if (this.vy > 0 && this.vy < 1.5) this.vy = 2;
        if (this.vy < 0 && this.vy > -1.5) this.vy = -2;
      }
      // 拖尾尘：619 每 tick 血尘（cs:51082-51086）；6/94/173 1/20（黄蜂/蜂/蛾/
      // 探针/鹦鹉族无尘；dust 18 紫 / 173 Crimera dust 5 红）
      // ★BJ411 同族普查（2026-09-30）：6/94/173 紫尘 1/20 的锚 cs:51082-51086 经 1457
      // 亲读为【幻影锚】（该区=moth/probe ai[3] 段零尘；aiStyle 5 主族 AI 全域
      // Dust.NewDust=0 发,唯一拖尾=下方 23 火尾）——登记 npcdust 族债,勿在本刀强扩。
      // 23 摘出紫尘支（原版无紫尾）→ 走下方 1:1 火尾。
      if (vid === 619) {
        game.spawnParticles(this.cx, this.cy, '#B01830', 1, 0.3, { life: 30, damp: 0.9, grav: 0 });
      } else if (!isHornet && vid !== 139 && vid !== 205 && vid !== 23 && !isBee && Math.random() < 1 / 20) {
        game.spawnParticles(this.cx, this.y + this.h * 0.5,
          vid === 173 ? '#8A3030' : '#7A4FA8', 1, 0.3, { life: 30, damp: 0.9, grav: 0 });
      }
    } else if (vid !== 252 && Math.random() < 1 / 40) {
      game.spawnParticles(this.cx, this.y + this.h * 0.5, '#8A3030', 1, 0.3, { life: 30, damp: 0.9, grav: 0 });
    }
    // ---- 陨石头火尾（★BJ411：NPC.cs:74803-74809 FindFrame case 23,1458 同行逐字节
    //      全等;FindFrame 每 tick 在 AI 后跑=本仓 swarmerAI 移动/反弹段后同拍）：
    //      每 tick 1 发 dust 6,盒 = position−velocity（移动后旧位=拖尾同相）、
    //      初速 vel×0.2、α100、scale 2、noGravity、尘速 ×0.3 ----
    if (vid === 23) {
      const d = game.spawnDust?.(this.x - this.vx, this.y - this.vy, this.w, this.h, 6,
        this.vx * 0.2, this.vy * 0.2, 100, null, 2);
      if (d) {
        d.noGravity = true;
        d.vx *= 0.3;
        d.vy *= 0.3;
      }
    }
    // ---- wet 浮力（cs:51106-51141,审计蜂群#7）：6/94/173/619 vy>0 ×0.95、−0.3、
    //      钳 −2（不重瞄）；205 −0.5 钳 −4 + TargetClosest ----
    if ((vid === 6 || vid === 94 || vid === 173 || vid === 619) && this.wet) {
      if (this.vy > 0) this.vy *= 0.95;
      this.vy -= 0.3;
      if (this.vy < -2) this.vy = -2;
    }
    if (vid === 205 && this.wet) {
      if (this.vy > 0) this.vy *= 0.95;
      this.vy -= 0.5;
      if (this.vy < -4) this.vy = -4;
      if (player) this.facing = this.seekDirX(player);   // TargetClosest
    }
    // ---- 黄蜂毒刺（cs:51142-51237）：ai[1] 每 tick +rand(5,20)×0.1×scale（176 再
    //      一掷,getGood 再一掷）；==101 清零+发射音 Item17；目标待机（潜行 0 且
    //      itemAnimation==0）清零；≥130：有视线且朝向与移动方向一致 → 毒刺
    //      （速 8、伤 10×scale/176 30×scale、散布 ±20、proj 55）；★失视线/无目标
    //      → ai[1]=0（cs:51236-51237,审计蜂群#11,曾只在上分支清 = 失视后计数
    //      悬停,重新得视线瞬间满蓄力毒刺） ----
    if (isHornet) {
      if (this.wet) {
        if (this.vy > 0) this.vy *= 0.95;
        this.vy -= 0.5;
        if (this.vy < -4) this.vy = -4;
        if (player) this.facing = this.seekDirX(player);   // TargetClosest
      }
      if (this.ai1 === 101) { this.ai1 = 0; game.playSfxFiles?.(['Item_17'], 1, this.cx, this.cy); } // :51147-51150
      this.ai1 += (Math.random() * 15 + 5) * 0.1 * scale;
      if (vid === 176) this.ai1 += (Math.random() * 15 + 5) * 0.1 * scale;
      if (game.world.seedFlags?.getGoodWorld) this.ai1 += (Math.random() * 15 + 5) * 0.1 * scale;
      // 待机清零（:51168-51175 stealth==0 && itemAnimation==0;动画窗代理 =
      // itemAnimTicks>0 || useTime>0,Player.ts:1859 同款口径）
      if (player && !player.dead && !(player.stealth > 0)
        && !(player.itemAnimTicks > 0 || player.useTime > 0)) this.ai1 = 0;
      if (this.ai1 >= 130) {
        if (player && !player.dead && this.canSeePlayer(st, player)) {
          const sxp = player.cx - this.cx + (Math.random() * 41 - 20);
          const syp = player.cy - this.cy + (Math.random() * 41 - 20);
          if ((sxp < 0 && this.vx < 0) || (sxp > 0 && this.vx > 0)) {
            this.shootDart(game, this.cx, this.cy, sxp, syp, 8, Math.round((vid === 176 ? 30 : 10) * scale), 55);
            this.ai1 = 101;
          } else this.ai1 = 0;
        } else this.ai1 = 0;
      }
    }
    // ---- 探针 139 远距增速（cs:51238-51256,审计蜂群#5）：dist>600（flag2,恒不
    //      限 mech 态——曾误嵌 mechQueenUp 门）时,速度与目标同向 → |vx|<cap
    //      （mech 5 / 常规 12）×1.05 增速；逆向 ×0.9 ----
    if (vid === 139 && flag2) {
      if ((this.vx > 0 && sx > 0) || (this.vx < 0 && sx < 0)) {
        const cap27 = mechQueenUp() ? 5 : 12;
        if (Math.abs(this.vx) < cap27) this.vx *= 1.05;
      } else {
        this.vx *= 0.9;
      }
    }
    // :51257-51266 mech && ai2==0（身体段掉落的散探针）：距玩家 <120 →
    // 沿连线推到 120px 外（贴脸风筝位）
    if (vid === 139 && mechQueenUp() && this.ai2 === 0 && player) {
      const kx = player.cx - this.cx, ky = player.cy - this.cy;
      const kl = Math.hypot(kx, ky);
      if (kl < 120) {
        this.x = player.cx - kx / (kl || 1) * 120 - this.w / 2;
        this.y = player.cy - ky / (kl || 1) * 120 - this.h / 2;
      }
    }
    // ---- 94 腐化者唾液（cs:51281-51301,审计蜂群#3）：localAI[0] 计数（受击清零）,
    //      ==180 且有视线 → NewNPC 112 VileSpit（aiStyle 9 直飞球,AI_009 已 1:1）,
    //      无论是否发射计数归零 ----
    if (vid === 94 && !flag) {
      if (this.justHit) this.lai0 = 0;
      this.lai0 += 1;
      if (this.lai0 === 180) {
        if (player && !player.dead && this.canSeePlayer(st, player)) {
          const spit = Enemy.fromVanilla(112, this.cx + this.vx, this.cy + this.vy);
          // ★Bottom 锚（1457 :51412 NewNPC((int)(cx+vx),(int)(cy+vy),112)）:
          //  唾液顶 = cy+vy−h——旧中心锚低 h/2
          if (spit) { spit.y = this.cy + this.vy - spit.h; addEnemy(game, spit); }
        }
        this.lai0 = 0;
      }
    }
    // ---- 619 后撤退 + BloodShot（cs:51298-51327,审计蜂群#4）：localAI[0]（受击
    //      +10 而非清零）≥120：有视线且 <400px → 背向 (目标X,自身Y) 方向 5 速退避
    //      + 朝 (目标±100,目标±100) 15 速 811 BloodShot（35 伤）;超距/失视 → 计 50 ----
    if (vid === 619 && !flag) {
      if (this.justHit) this.lai0 += 10;
      this.lai0 += 1;
      if (this.lai0 >= 120) {
        if (player && !player.dead && this.canSeePlayer(st, player)) {
          if (Math.hypot(player.cx - this.cx, player.cy - this.cy) < 400) {
            const rx = player.cx - this.cx, ry = player.y - this.cy;
            const rl = Math.hypot(rx, ry) || 1;
            this.vx = -rx / rl * 5;
            this.vy = -ry / rl * 5;
            this.lai0 = 0;
            const bx = player.cx + (Math.random() * 201 - 100) - this.cx;
            const by = player.y + (Math.random() * 201 - 100) - this.cy;
            const bl = Math.hypot(bx, by) || 1;
            // ★批六 C1 载体归位：811 由 Arrow(shoot) 改走 spawnHostileProj→Dart——
            //  批五在 DART_STYLE 811 的 AI 尘/Kill 尘/α 渐显/白化剪影在 Arrow 载体上
            //  全部不可达;弹道参数不变（原版 NPC.cs:51435 速 15/伤 35/ai 缺省）
            this.spawnHostileProj(game, this.cx, this.cy, bx / bl * 15, by / bl * 15, 35, 811);
          } else this.lai0 = 50;
        } else this.lai0 = 50;
      }
    }
    // ---- 白天驱散表（cs:51302-51309,审计蜂群#12）：豁免 {6,23,42,94,173,176,
    //      205,210,211,252,619,231-235};表外（5 仆从/139 探针/252 外其他）白天,
    //      或玩家死亡（flag）恒：vy −= num2×2 + EncourageDespawn(10) ----
    const dayExempt = vid === 6 || vid === 23 || isHornet || vid === 94 || vid === 173
      || vid === 619 || isBee || vid === 252;
    if ((game.world.clock.isDay && !dayExempt) || flag) {
      this.vy -= accel * 2;
      this.encourageDespawn(10);
    }
  }

  /** AI_010 诅咒头骨（NPC.145.cs:21553+；type 34 路径，书怪 694/魔法骷髅 289 分支未达）：
   *  距离分档速度（>350:5/0.3 >300:3/0.2 >250:1.5/0.1 其余 1/0.011，L21655-21672）；
   *  <250 环绕摆动（ai[0] +=0.9、vy ±0.019、|ai0|>100 时 vx 反向，L21636-21651）；
   *  ai[1] 追击计数 >600 加速档（×8/速度4）>650 清零；贴脸 <100 时 ai[1]=-60（L21620-21634）；
   *  noTileCollide 穿墙直移 */
  private cursedSkullAI(game: GameHooks, player: Player | null) {
    // AI_010 全块 1:1（NPC.cs:21552-21888）。flag9 族员 = 694 水书宝箱怪（多状态机）；
    // 34 诅咒头骨/289 巨型诅咒颅走通用悬浮档
    const isMimic = this.vanillaId === 694;
    let maxSpd = 1, accel = 0.011;                 // num145/num146（:21562-21563）
    const num147 = 600, num148 = 650;              // 脱离加速门（:21564-21565）
    let dx = player ? player.cx - this.cx : this.facing * 100;
    let dy = player ? player.cy - this.cy : -100;
    const dist = Math.hypot(dx, dy) || 1;          // num153
    if (this.ai3 !== 3) this.ai1 += 1;             // :21577-21579
    const flag13 = this.ai2 >= 0 && this.ai3 === 2;   // 冲刺态（694 专属）
    const flag14 = this.ai2 >= 0 && this.ai3 === 1;   // 咒球态（694 专属）
    const flag15 = this.ai1 > num147;
    const flag16 = this.ai1 < -30;
    const flag17 = isMimic && !flag13 && !flag14 && !flag15 && flag16;  // 逃逸档
    // 帧机（FindFrame case 694 :77905-77980——AI 侧维护，customFrameIdx 供渲染端直读；
    // 34/289 单帧恒 0 由渲染端缺省，不进此链）
    if (isMimic) this.mimic694Frame();
    // ---- 伪装态 ai[3]==3（:21581-21590）：钉死成"放着的书"——静止、无旋转、
    //      击退免疫；受击 → ai[3]=4 觉醒。AI 早退（不移动不索敌）----
    if (this.ai3 === 3) {
      this.facing = 1; this.visAngle = 0;
      this.vx = 0; this.vy = 0;
      this.kbResistOverride = 0;                   // knockBackResist=0f（:21586）
      if (this.justHit) this.ai3 = 4;              // :21587-21589（frameCounter 清零在帧机）
      return;
    }
    // ---- 觉醒态 ai[3]==4（:21592-21601）：翻书动画 80t，静止，结束转 0----
    if (this.ai3 === 4) {
      this.facing = 1; this.visAngle = 0;
      this.vx = 0; this.vy = 0;
      this.kbResistOverride = 1;                   // knockBackResist=1f（:21597）
      if (this.ai1 > 80) { this.ai1 = 0; this.ai3 = 0; }   // :21598-21600 num149=80
      return;
    }
    if (isMimic) this.kbResistOverride = null;     // :21603-21605 knockBackResist=0.2（def 数据）
    // ---- 逼近/悬停段（:21607-21636；冲刺态跳过）----
    if (!flag13) {
      if (flag15) {
        accel *= 8; maxSpd = 4;                    // 超时脱离加速（:21609-21611）
        if (this.ai1 > num148) this.ai1 = 0;
      } else if (isMimic && player && dist < 100 && this.ai1 >= 0) {
        this.ai1 = -60;                            // 贴脸重置冷却（:21615-21621 flag10 专属）
      } else if (dist < 250) {
        this.ai0 += 0.9;                           // 近距 8 字漂移（:21622-21635）
        if (this.ai0 < -200) this.ai0 = 0;         // 类默认 -1120 钳回（同 swarmerAI 清查）
        this.vy += this.ai0 > 0 ? 0.019 : -0.019;
        this.vx += (this.ai0 < -100 || this.ai0 > 100) ? 0.019 : -0.019;
        if (this.ai0 > 200) this.ai0 = -200;
      }
    }
    // 速度档（:21638-21658）：逃逸 8/0.25 → >350 5/0.3 → >300 3/0.2 → >250 1.5/0.1 → 默认 1/0.011
    if (flag17) { maxSpd = 8; accel = 0.25; }
    else if (dist > 350) { maxSpd = 5; accel = 0.3; }
    else if (dist > 300) { maxSpd = 3; accel = 0.2; }
    else if (dist > 250) { maxSpd = 1.5; accel = 0.1; }
    let sx = (dx / dist) * maxSpd, sy = (dy / dist) * maxSpd;   // num150/num151
    const num154 = sx, num155 = sy;                // 未反向的目标方向（朝向判据）
    if (flag17) { sx = -sx; sy = -sy; }            // :21662-21665 逃逸反向
    if (!player) { sx = this.facing * maxSpd / 2; sy = -maxSpd / 2; }  // 玩家死亡漂移（:21666-21669）
    if (flag13) {
      // 冲刺态速度（:21700-21711）：前 10t 速度 ×0.5（≥18t 归零）；之后以 14px/t
      // 直线冲（方向 = 当前速度，慢于 0.1 时改取朝玩家）
      const n156 = this.ai2;
      if (n156 < 10) {
        this.vx *= 0.5; this.vy *= 0.5;
        if (n156 >= 18) { this.vx = 0; this.vy = 0; }
      } else {
        let vx2 = this.vx, vy2 = this.vy;
        // 玩家死于冲刺段（player=null）保持现速度方向（原版 Main.player[target]
        // 槽位坐标恒可读不判 null——我们等价取"维持最后方向"；曾 player!.cx
        // 对 null 解引用炸整帧敌怪更新,2026-08-19 审计 A-1）
        if (player && Math.hypot(this.vx, this.vy) < 0.1) { vx2 = player.cx - this.cx; vy2 = player.cy - this.cy; }
        const vl = Math.hypot(vx2, vy2) || 1;
        this.vx = (vx2 / vl) * 14;
        this.vy = (vy2 / vl) * 14;
      }
    } else {
      if (this.vx < sx) this.vx += accel;
      else if (this.vx > sx) this.vx -= accel;
      if (this.vy < sy) this.vy += accel;
      else if (this.vy > sy) this.vy -= accel;
    }
    // 朝向/旋转（:21713-21727；冲刺态冻结）：num154>0 → 右向不翻 + atan2；
    // <0 → 翻转 + atan2+π；694 的 spriteDirection 再取反（贴图口朝向与 34 相反）
    if (!flag13) {
      if (num154 > 0) { this.facing = -1; this.visAngle = Math.atan2(num155, num154); }
      else if (num154 < 0) { this.facing = 1; this.visAngle = Math.atan2(num155, num154) + Math.PI; }
      if (isMimic) this.facing *= -1;
    }
    // ---- 巨型诅咒颅 289 暗影焰（1457 :21861-21918）：justHit 清态 + ≤500px 状态机
    //      （0 累计 >120t → 1 攻击段 40t），攻击段 ai[2]==20 发射暗影焰（速 6、伤 25）；
    //      ai[2]>40 → ai[3]=0 但 ai[2]【保留】继续计数（:21890-21897）→ 回态 0 后
    //      只需再数到 121，稳态周期 = 80+40 = 120t（曾误归零 ai[2] → 160t 慢 33%）----
    if (this.vanillaId === 289) {
      if (this.justHit) { this.ai2 = 0; this.ai3 = 0; }    // :21863-21867（受击打断蓄力）
      dx = player ? player.cx - this.cx : this.facing * 100;
      dy = player ? player.cy - this.cy : -100;
      const d289 = Math.hypot(dx, dy) || 1;
      if (player && d289 <= 500) {
        this.ai2 += 1;
        if (this.ai3 === 0) {
          if (this.ai2 > 120) { this.ai2 = 0; this.ai3 = 1; }   // :21881-21886
        } else {
          if (this.ai2 === 20) this.shootDart(game, this.cx, this.cy, dx, dy, 6, 25, 299);
          if (this.ai2 > 40) this.ai3 = 0;                 // :21890-21897 ai[2] 不归零
        }
      } else { this.ai2 = 0; this.ai3 = 0; }
    }
    this.x += this.vx;
    this.y += this.vy;
    // ---- 694 水书宝箱怪攻击状态机（:21763-21888）----
    if (!isMimic) return;
    if (this.justHit) { this.ai2 = 0; this.ai3 = 0; }      // :21765-21767
    const mcx = this.cx, mcy = this.cy + 10;               // center4 = Center+(0,10)（:21768）
    const mdx = player ? player.cx - mcx : this.facing * 100;
    const mdy = player ? player.cy - mcy : -100;
    const md = Math.hypot(mdx, mdy);                       // num152
    // :21776-21783 flag18 = 中距带[100,300]+态 0/2（冲刺蓄力）;flag19 = ≤500+态 0/1（咒球蓄力）
    const flag18 = md >= 100 && md <= 300 && this.ai2 >= 0 && (this.ai3 === 0 || this.ai3 === 2);
    const flag19 = md <= 500 && this.ai2 >= 0 && (this.ai3 === 0 || this.ai3 === 1);
    if (flag18 && (!flag19 || Math.floor(Math.random() * 3) === 0)) {
      // 冲刺链（:21786-21797）：态 0 蓄 120t → 态 2 冲刺 60t → ai[2]=-300 冷却
      this.ai2 += 1;
      if (this.ai3 === 0) {
        if (this.ai2 > 120) { this.ai2 = 0; this.ai3 = 2; }
      } else if (this.ai3 === 2 && this.ai2 > 60) {
        this.ai2 = -300; this.ai3 = 0;
      }
    } else if (flag19) {
      // 咒球链（:21798-21827）：态 0 蓄 120t → 态 1 发射段；态 1 内 30t 结束，
      // ai[2]==17 时 Center+(0,10) 出一颗水球 33（NewNPC :21820-21824）
      this.ai2 += 1;
      if (this.ai3 === 0) {
        if (this.ai2 > 120) { this.ai2 = 0; this.ai3 = 1; }
      } else if (this.ai3 === 1) {
        if (this.ai2 > 30) { this.ai2 = 0; this.ai3 = 0; }
        if (this.ai2 === 17) {
          game.playSfxFiles?.(['Item_8'], 1, this.cx, this.cy);
          // NewNPC 锚 = 底边对齐 center4（16px 球 → 中心再 -8）
          const ball = Enemy.fromVanilla(33, mcx, mcy - 8);
          if (ball) addEnemy(game, ball);
        }
      }
    } else {
      // 脱档衰减（:21879-21886）：ai[2] 归零、态回 0
      this.ai2 += 1;
      if (this.ai2 > 0) this.ai2 = 0;
      this.ai3 = 0;
    }
  }

  /** 694 帧机（FindFrame case 694，NPC.cs:77905-77980）：
   *  态 3 伪装 → 帧 0；态 4 觉醒 → 帧 0..16（5t/帧）；态 2 冲刺 → 17..19(<40t)/..23；
   *  态 1 咒球 → 24..29；态 0 巡航 → 17/22/23 三帧循环（6t/帧）。
   *  npcFrameT = frameCounter（态切换清零），customFrameIdx 供渲染端直读 */
  private mimic694Frame(): void {
    this.npcFrameT += 1;
    let n = this.customFrameIdx ?? 0;
    if (this.ai3 === 3) {
      n = 0; this.npcFrameT = 0;
    } else if (this.ai3 === 4) {
      if (this.npcFrameT >= 5) { this.npcFrameT = 0; n = Math.min(16, n + 1); }
    } else if (this.ai3 === 2) {
      if (this.ai2 === 0) n = 17;
      if (n < 17 || n > 23) n = 17;
      if (this.npcFrameT >= 5) {
        this.npcFrameT = 0; n += 1;
        if (this.ai2 < 40 && n > 19) n = 19;
        if (n > 23) n = 23;
      }
    } else if (this.ai3 === 1) {
      if (n < 24 || n > 29) n = 24;
      if (this.npcFrameT >= 5) { this.npcFrameT = 0; n = Math.min(29, n + 1); }
    } else {
      if (n < 17 || n > 23) n = 17;
      if (this.npcFrameT >= 6) {
        this.npcFrameT = 0;
        n = n === 17 ? 22 : n === 22 ? 23 : 17;
      }
      if (n >= 30) n = 0;
    }
    this.customFrameIdx = n;
  }

  // AI_011 骷髅王(35)战斗状态机在 bossAI.ts skeletronBossAI；68 守卫走下方专用分支

  /** AI_011 地牢守卫(68)（NPC.cs:21937-22387；1458 同域 :22039-22380 行号-2 内对齐）：
   *  恒 ai[1]=2：伤害 9999、恒速 8 直线追击；玩家死/超 2000px → ai[1]=3 下坠脱场。
   *  noTileCollide 直移。★生成拍双声 Roar（BJ68 2026-09-14 补第二声,1:1）：
   *  ①:22039-22042 (type==68||netMode==1)&&localAI[0]==0 → localAI[0]=1+吼（aiInit 支）；
   *  ②:22054-22058 (type==68||IsItDay)&&ai[1]∉{3,2} → ai[1]=2+吼——守卫生成拍 ai[1]=0
   *  必中此支 = 同拍第二声（有活目标时；目标超距/死亡拍 ai[1]=3 → 只有①无②）。
   *  原文档注"一声"系漏读②支——地牢守卫是全游戏唯一"非物品召唤也咆哮"的生成点。
   *  mode-3 下坠支补 EncourageDespawn(50)（:22378-22380,原版=离场计时钉低值+置
   *  despawnEncouraged;离屏后 ~50t 消散,玩家死后血条不再滞留——语义同 35/127 离场支） */
  private dungeonGuardianAI(game: GameHooks, player: Player | null) {
    if (!this.aiInit) {
      this.aiInit = true; this.ai0 = 1;   // 初始化（L21910；68 无手 NPC）
      if (player) this.facing = this.seekDirX(player);   // ★:22022 TargetClosest（ai[0]==0 初索敌）
      game.playSfx('roar', 1, this.cx, this.cy);
    }
    if (!player || Math.abs(this.cx - player.cx) > 2000 || Math.abs(this.cy - player.cy) > 2000) {
      if (player) this.facing = this.seekDirX(player);   // ★:22048 TargetClosest（超远沿重索敌）
      this.ai1 = 3;
    } else if (this.ai1 !== 3 && this.ai1 !== 2) {
      // :22054-22058 强制块原条件 = ai[1]∉{3,2}（68 恒 type==68 腿成立）——
      // 补 !==2 门后本支仅在 0→2 转换拍走一次（曾恒真重写=行为同值但 roar#2 会误连响）
      this.ai1 = 2;
      game.playSfx('roar', 1, this.cx, this.cy);   // ★第二声（:22057,生成拍与①同拍双吼）
    }
    if (this.ai1 === 2) {
      // :22246-22248 白天狂暴 damage/defense 均 9999（守卫恒处本态；json
      // defDefense 本就 9999，显式对齐防难度缩放口径漂移）
      this.def.damage = 9999;
      this.def.defense = 9999;
      const dx = player!.cx - this.cx, dy = player!.cy - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      this.vx = (dx / d) * 8;
      this.vy = (dy / d) * 8;
      // ★2026-09-13（用户实报"守卫骷髅头不旋转"）：:22359 rotation += direction×0.3f
      //  ——type 68 恒处 ai[1]=2f（:22054 守卫无条件强制），该模式首行逐拍旋 0.3 rad
      //  （~0.35s/圈电锯观感）；direction 由 :22022/:22048 TargetClosest 刷新。
      //  写 spin（渲染 rotId 分支消费位,与 35 头 bossAI.ts:89 同通道）而非 visAngle
      //  ——visAngle 对 rotId 家族不进绘制（曾写成 visAngle=本体仍不转,渲染断链）
      this.spin += this.facing * 0.3;
    } else {
      // :22372-22380 ai[1]==3f 离场态（守卫 ai1∈{0→2,2,3},本 else ≡ 3f 支）：
      // vy+=0.1 下坠 + 双 0.95 阻尼逐字对齐;★补 EncourageDespawn(50)（:22380,
      // timeLeft 封顶 min(·,50)+despawnEncouraged——离屏后 CheckActive 停更③,
      // 剩余 timer≈50 → 约 50t 消散;屏内 ③ 每 tick 重置 750 抵挡=照常保命）
      this.vy += 0.1;
      if (this.vy < 0) this.vy *= 0.95;
      this.vx *= 0.95;
      this.encourageDespawn(50);
    }
    this.x += this.vx;
    this.y += this.vy;
  }

  /** AI_020 刺球（NPC.cs:24662-24739，type 70 SpikeBall——NPCID.cs:11205；本函数
   *  沿用历史名 blazingWheelAI，与 72 火轮的 spikeBallAI 名字互换，dispatch 正确）：
   *  ai[3]=1+Next(15)*0.1 速度档；出生 W1 批（2026-08-19）补 TargetClosest + 双取反
   *  （:24668-24670 direction 与 directionY 各 ×−1——面朝玩家后再反向，出生即背向
   *  玩家俯冲）；首段垂直俯冲 spd/acc/2≈15 tick（:24694-24701），随后恒速 ±spd
   *  弹跳——noTileCollide 穿墙，"弹"靠 |v|≥spd 时 direction 翻转（:24711-24731）
   *  而非碰撞。
   *  ai[1]/ai[2] = 锚点像素快照（:24672-24673，position.Y += h/2+8 后的中心）——
   *  ★渲染侧消费：Main.cs:23087-23113 据此画锚链 Chain+锚座 Spike_Base（曾误当
   *  "格快照无本地消费"除以 TILE → 链画不到锚点，2026-09-02 用户报地牢刺球缺链） */
  private blazingWheelAI(game?: GameHooks) {
    if (!this.aiInit) { this.aiInit = true;
      // :24602 TargetClosest（有玩家即朝向；无目标 direction 保持 0→1 兜底）。
      // M11：索敌目标优先（联机可为访客），无目标史回退本地
      const p = this.targetRef(game);
      if (p) this.facing = this.seekDirX(p);
      this.facing *= -1;                    // :24603 direction ×−1
      this.dirY *= -1;                      // :24604 directionY ×−1（W1 双取反）
      this.y += this.h / 2 + 8;             // :24671
      if (this.facing === 0) this.facing = 1;
      if (this.dirY === 0) this.dirY = 1;
      this.ai1 = this.cx;                   // :24672 ai[1] = Center.X（像素锚点）
      this.ai2 = this.cy;                   // :24673 ai[2] = Center.Y（像素锚点）
      this.ai3 = 1 + Math.floor(Math.random() * 15) * 0.1;
      this.vy = 6 * this.ai3 * this.dirY;
      this.ai0 = 1;
      this.x += this.vx;
      this.y += this.vy;
      return;
    }
    const spd = 6 * this.ai3, accel = 0.2 * this.ai3;
    const phaseLen = Math.floor(spd / accel / 2); // num304（ai3 约掉=15）
    if (this.ai0 >= 1 && this.ai0 < phaseLen) {
      this.vy = this.dirY * spd;
      this.ai0 += 1;
    } else if (this.ai0 >= phaseLen) {
      this.vy = 0;
      this.dirY *= -1;
      this.vx = spd * this.facing;
      this.ai0 = -1;
    } else {
      // 常态弹跳（L24637-24660）：到 ±spd 翻向，持续加 accel
      if (this.dirY > 0 && this.vy >= spd) { this.dirY *= -1; this.vy = spd; }
      else if (this.dirY < 0 && this.vy <= -spd) { this.dirY *= -1; this.vy = -spd; }
      if (this.facing > 0 && this.vx >= spd) { this.facing *= -1; this.vx = spd; }
      else if (this.facing < 0 && this.vx <= -spd) { this.facing *= -1; this.vx = -spd; }
      this.vx += accel * this.facing;
      this.vy += accel * this.dirY;
    }
    this.x += this.vx;
    this.y += this.vy;
  }

  /** AI_021 火轮（NPC.cs:24740-24790，type 72 烈焰火轮 BlazingWheel——NPCID.cs:11209；
   *  本函数沿用历史名 spikeBallAI，与 70 刺球的 blazingWheelAI 名字互换,dispatch 正确）：
   *  出生 TargetClosest + directionY=1；恒速 6 对角移动，撞轴翻转（collideX→dirY 翻、
   *  collideY→facing 翻）；rotation ±0.13/t 随 direction×directionY 与 ai[1] 交替符号
   *  步进（W2 批 2026-08-19——npc.rotation 累计角写 visAngle；渲染侧 Renderer.drawEnemy
   *  旋转链 aiStyle 21 分支 ctx.rotate(e.visAngle) 每帧消费,rotationDriven 含 21 禁镜像
   *  ——同原版 Main.cs:23660 通用绘制消费 rotation） */
  private spikeBallAI(game: GameHooks) {
    if (!this.aiInit) { this.aiInit = true;
      {
        const p = this.targetRef(game);                       // M11：索敌目标优先
        if (p) this.facing = this.seekDirX(p);                // :24678 TargetClosest
      }
      this.dirY = 1;                                          // :24679
      this.ai0 = 1;                                           // :24680
    }
    // 上一 tick moveAndCollide 留下的碰撞旗标（原版 AI 开头读 collideX/Y 同语义）
    const collideX = this.hitWall;
    const collideY = this.onGround || this.hitHead;
    // W2：rotation ±direction×directionY×0.13（:24685/:24704——ai[1] 两相位符号相反）
    const rotStep = this.facing * this.dirY * 0.13 * (this.ai1 === 0 ? 1 : -1);
    this.visAngle += rotStep;
    if (this.ai1 === 0) {
      if (collideY) this.ai0 = 2;
      if (!collideY && this.ai0 === 2) { this.facing *= -1; this.ai1 = 1; this.ai0 = 1; }
      if (collideX) { this.dirY *= -1; this.ai1 = 1; }
    } else {
      if (collideX) this.ai0 = 2;
      if (!collideX && this.ai0 === 2) { this.dirY *= -1; this.ai1 = 0; this.ai0 = 1; }
      if (collideY) { this.facing *= -1; this.ai1 = 0; }
    }
    this.vx = 6 * this.facing;
    this.vy = 6 * this.dirY;
    // type 72 走原版专用碰撞（NPC.cs:93755-93757 → Collision_MoveBlazingWheel :
    // 93918 → noSlopeCollision 12×12 中心盒/斜面当整块/平台穿透）。通用路径的
    // slopeCollide 推离不置 collideY 旗 → AI 看不到 Y 碰撞、永不翻向 = 凹袋楔死
    // （2026-08-25 用户报地牢刺球卡死,种子 12345 复现实录）
    if (this.vanillaId === 72) moveNoSlopeBox(this, game.world, this.vx, this.vy);
    else moveAndCollide(this, game.world, this.vx, this.vy);
    // ---- 点光（cs:24722-24724）：aiStyle21 全族（=72 火轮）火焰光
    //  (0.9, 0.3+num306, 0.2)，num306=(270−mouseTextColor)/400（190-255 三角波 → 0.0375-0.1375）
    if (this.vanillaId === 72) {
      const num306 = (270 - mouseTextColorApprox()) / 400;
      this.lightRGB = [0.9, 0.3 + num306, 0.2];
    }
  }

  /** AI_026 独角兽/冲锋族（NPC.cs:25863-26292）：
   *  冲锋 walker：accel 0.07 / maxSpd 6（num7/num8，独角兽 315 配置 L26100-26116）；
   *  逆向阻尼 0.95、超速落地 ×0.8；卡墙 30 tick 折返（ai[3]≥num1，玩家 <200px 重置 L25936-25941）；
   *  台阶步升 16.1 同战士（L26182-26207）；跳梯 -8.5/-7.5/-7/-6/-8（L26245-26279，
   *  前方探测含 (w/2+2)×dir + 5×vx 提前量 L26226-26227） */
  private chargerAI(game: GameHooks, player: Player | null, _maxSpd = 6) {
    const st = game.world.store;
    const vid = this.vanillaId ?? 0;
    // 游泳化 620 地精鲨（AI_107_ImprovedWalkers flag27=wet，cs:64122/:64300-64336）：
    // 游泳块在 walker 逻辑之前且 return 接管本 tick——wet 时跳过冲锋/跳跃（1:1 勿动）
    if (vid === 620 && this.wetSwimStep(game, player, 620)) return;
    // ---- 620 陆地段（AI_107 case 620,cs:64118-64277 专属分支 + flag12 射链
    //      :64551-64679——审计 B charger「620 陆地 8 速+远程 811+夜扑」）----
    if (vid === 620) { this.goblinSharkLandAI(game, player); return; }
    // ---- 点光（cs:62852-62865）：type==315 无头骑士骑手段——Center (0.4,0.36,0.2)
    //  恒亮（南瓜灯头；在 type==315 块内、于 1001 骑手弹幕计时之后）
    if (vid === 315) this.lightRGB = [0.4, 0.36, 0.2];
    const solidAt = (x: number, y: number) => x >= 0 && y >= 0 && x < st.w && y < st.h && st.isSolid(x, y);
    // ================= AI_026_Unicorns（cs:62804-63365）=================
    const num = 30;            // 卡墙阈值 num（AI_026 头部默认）
    let flag = false;          // 423 蓄力中（停走位加速门）
    // ---- 546 怒滚虫头部（cs:62816-62852）：同类斥离（重叠盒 ±0.05/轴,落地清 vy）----
    if (vid === 546) {
      const wasGrounded546 = this.vy === 0;
      for (const o of game.enemies() as Enemy[]) {
        if (o === this || o.vanillaId !== vid || o.dead) continue;
        if (Math.abs(this.x - o.x) + Math.abs(this.y - o.y) < this.w) {
          if (this.x < o.x) this.vx -= 0.05; else this.vx += 0.05;
          if (this.y < o.y) this.vy -= 0.05; else this.vy += 0.05;
        }
      }
      if (wasGrounded546) this.vy = 0;
    }
    // flag2：落地且速度与朝向相逆（cs:62808-62814）
    const flag2 = this.vy === 0 && ((this.vx > 0 && this.facing < 0) || (this.vx < 0 && this.facing > 0));
    // ---- 315 无头骑士骑手弹（cs:62852-62867）：localAI[0] 每 480t 一发 1001
    //      （傑克灯笼追踪弹,伤 40/30 难度化,出生点 Center+NextVector2Circular(40,40)
    //      随机盘,速度 (vx, ±3),timeLeft 360=SetDefaults :9519——AI_194 追踪面
    //      在 Arrow 1001 支,★BJ643①）----
    if (vid === 315) {
      // `localAI[0]++ >= 480` 后缀自增:比旧值,命中后归零(自增被覆写)
      const oldLai = this.lai0;
      this.lai0 = oldLai + 1;
      if (oldLai >= 480) {
        this.lai0 = 0;
        if (player && !player.dead) {
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * 40;   // NextVector2Circular 盘掷（Utils.cs:1301 角均匀×线性半径;
                                            // F6 判例。★BJ643① 曾恒满径 40=NextVector2CircularEdge 档）
          shoot(game, this.cx + Math.cos(ang) * rad, this.cy + Math.sin(ang) * rad,
            this.vx, (Math.random() * 2 - 1) * 3,
            getAttackDamageForProjectiles(40, 30, this.difficulty), 1001, 360);   // life=360（:9519 timeLeft,shoot 缺省 300 系旧直飞档）
        }
      }
    }
    // ---- 卡墙计数（cs:62889-62918）：X 未动 / ≥30 / 逆向 → +1;移动中回落;
    //      >300 归零;受击归零 ----
    const xBefore = this.x;
    let flag3 = false;
    // ---- 距玩家（cs:62919-62927,full 2D）----
    const dist9 = player ? Math.hypot(player.cx - this.cx, player.cy - this.cy) : Infinity;
    // ---- 410 自爆骷髏（cs:62940-62977）：ai[1] ≥240 或头顶 20px 内有玩家 800px 内
    //      → 3 发 538 火花弹（伤 50）+ 即刻自灭 ----
    if (vid === 410) {
      this.ai1 += 1;
      let boom = this.ai1 >= 240;
      if (!boom && this.vy === 0 && player && !player.dead) {
        boom = player.cy < this.cy && Math.hypot(player.cx - this.cx, player.cy - this.cy) < 800
          && Math.abs(player.cx - this.cx) < 20;
      }
      if (boom) {
        for (let k = 0; k < 3; k++) {
          shoot(game, this.cx, this.cy, (Math.random() - 0.5) * 2, -4 - 10 * Math.random(), 50, 538);
        }
        this.dead = true;   // life=0 + HitEffect(9999) + active=false（:62971-62975）
        return;
      }
    }
    // ---- 423 蓄力冲（cs:62978-63022,审计 B charger「423 蓄力冲」）：
    //  ai[2]==1 蓄力态——ai[1] +1、vx ×0.7/帧刹车、<30 蓄力尘、==30 反向发 575
    //  弹（枪口 Center+(−20×spriteDir,0)、速 (−7×spriteDir,0)、伤 50/35）,
    //  ≥60 → ai[1]=−rand(320,601)、ai[2]=0（进入冷却段,ai[1] 计满 180 再蓄）;
    //  ai[2]==0 常态——≥180 且 <500px 落地 → flag=true（停走位）进蓄力 ----
    else if (vid === 423) {
      if (this.ai2 === 1) {
        flag = true;
        this.ai1 += 1;
        this.vx *= 0.7;
        if (this.vx > -0.5 && this.vx < 0.5) this.vx = 0;
        if (this.ai1 === 30 && player && !player.dead) {
          shoot(game, this.cx - this.facing * 20, this.cy, -this.facing * 7, 0,
            getAttackDamageForProjectiles(50, 35, this.difficulty), 575);
        }
        if (this.ai1 >= 60) {
          this.ai1 = -Math.floor(Math.random() * 281) - 320;   // −rand(320,601)
          this.ai2 = 0;
        }
      } else {
        this.ai1 += 1;
        // 1457 :63194 加 !confused——困惑（纳米浸剂）中的星云兽不再进入蓄力冲
        if (!this.confused && this.ai1 >= 180 && dist9 < 500 && this.vy === 0) {
          flag = true;
          this.ai1 = 0;
          this.ai2 = 1;
        }
      }
    }
    // ---- 155 狼 / 329 犬扑跳（cs:63003-63012,审计 B charger）：落地 + <100px +
    //      |vx|>3 + 朝玩家侧 → vy −4 ----
    else if (vid === 155 || vid === 329) {
      if (this.vy === 0 && dist9 < 100 && Math.abs(this.vx) > 3 && player
        && ((this.cx < player.cx && this.vx > 0) || (this.cx > player.cx && this.vx < 0))) {
        this.vy -= 4;
      }
    }
    // ---- 546 追击跳（cs:63015-63021）：同门 + PlaySound(3,11) ----
    else if (vid === 546 && this.vy === 0 && Math.abs(this.vx) > 3 && player
      && ((this.cx < player.cx && this.vx > 0) || (this.cx > player.cx && this.vx < 0))) {
      this.vy -= 4;
      game.playSfxWav?.('NPC_Hit_11', 1, this.cx, this.cy);
    }
    // ---- 546 沙漠驱散（cs:63023-63036,审计 B charger）：目标不在沙漠 →
    //      重瞄一次仍不在 → EncourageDespawn(10) + ai[3]=num（停追击）----
    if (vid === 546 && player && !game.world.scene?.zoneDesert) {
      const keepDir = this.facing;
      this.facing = this.seekDirX(player);
      if (!game.world.scene?.zoneDesert) {
        this.encourageDespawn(10);
        this.stuckT = num;
        this.facing = keepDir;
      }
    }
    // ---- 重瞄门（cs:63037-63067,审计 B charger「重瞄门 200px 太窄」）：
    //      非卡墙态（ai[3] < 30）【每帧 TargetClosest】（独角兽冲过头必回头;
    //      曾套 200px 距离门 = 冲线后瞎走）;329/315 非南瓜月 → 驱散。
    //      卡墙态：完全静止（vx=vy=0）2t 才折返;directionY=-1 ----
    if (this.stuckT < num) {
      if ((vid === 329 || vid === 315) && game.world.moonEvent.kind !== 2) {
        this.encourageDespawn(10);
      } else if (player && !player.dead) {
        this.facing = this.seekDirX(player);
      }
    } else {
      if (this.vx === 0) {
        if (this.vy === 0) {
          this.ai0 += 1;
          if (this.ai0 >= 2) {
            this.facing *= -1;
            this.ai0 = 0;
          }
        }
      } else this.ai0 = 0;
      this.dirY = -1;
      if (this.facing === 0) this.facing = 1;
      this.sdir26 = this.facing;   // 卡墙折返同步闩（cs:63251 spriteDirection = direction）
    }
    // ---- 水平推进（cs:63069-63165）：门 = !flag &&（落地 || wet || 顺向）;
    //      基档 num11=6 / num12=0.07 ----
    let num11 = 6, num12 = 0.07;
    const dir = this.facing;
    if (!flag && (this.vy === 0 || this.wet || (this.vx <= 0 && dir < 0) || (this.vx >= 0 && dir > 0))) {
      if (vid === 155) {
        // 155 狼（cs:63070-63078）：逆向 ×0.95 ×2
        if (this.vx > 0 && dir < 0) this.vx *= 0.95;
        if (this.vx < 0 && dir > 0) this.vx *= 0.95;
      } else if (vid === 329) {
        // 329 幼鹿怪（cs:63079-63093）：逆向 ×0.9 ×2 + 自带 0.1/±3 推进
        if (this.vx > 0 && dir < 0) this.vx *= 0.9;
        if (this.vx < 0 && dir > 0) this.vx *= 0.9;
        if (dir > 0 && this.vx < 3) this.vx += 0.1;
        if (dir < 0 && this.vx > -3) this.vx -= 0.1;
      } else if (vid === 315) {
        // 315（cs:63094-63124）：逆向 ×0.95 + 内联全套推进（0.07/±6,后接通用段=双倍 0.14/t）
        if (this.vx > 0 && dir < 0) this.vx *= 0.95;
        if (this.vx < 0 && dir > 0) this.vx *= 0.95;
        if (this.vx < -6 || this.vx > 6) {
          if (this.vy === 0) { this.vx *= 0.8; this.vy *= 0.8; }
        } else if (this.vx < 6 && dir === 1) {
          this.vx += 0.07;
          if (this.vx > 6) this.vx = 6;
        } else if (this.vx > -6 && dir === -1) {
          this.vx -= 0.07;
          if (this.vx < -6) this.vx = -6;
        }
      } else if (vid === 410) {
        if (Math.sign(this.vx) !== dir) this.vx *= 0.9;
        num11 = 6; num12 = 0.2;
      } else if (vid === 423) {
        if (Math.sign(this.vx) !== dir) this.vx *= 0.85;
        num11 = 10; num12 = 0.2;
      } else if (vid === 546) {
        // 546（cs:63138-63152）：逆向 ×0.92;风偏滚转 num11 = 4 + wind×direction×3
        // （Lerp(0.6,1,|windTarget|)×sign,非沙尘暴归 0）;num12=0.05
        if (Math.sign(this.vx) !== dir) this.vx *= 0.92;
        const wind = game.world.weather.windSpeedTarget ?? 0;
        let num13 = 0.6 + Math.abs(wind) * 0.4;
        num13 *= Math.sign(wind);
        if (!game.world.scene?.zoneSandstorm) num13 = 0;
        num11 = 4 + num13 * dir * 3;
        num12 = 0.05;
      }
      // 通用尾段（cs:63153-63165）：超帽落地 ×0.8;否则顺向 += num12 钳 ±num11
      if (this.vx < -num11 || this.vx > num11) {
        if (this.vy === 0) { this.vx *= 0.8; this.vy *= 0.8; }
      } else if (this.vx < num11 && dir === 1) {
        this.vx += num12;
        if (this.vx > num11) this.vx = num11;
      } else if (this.vx > -num11 && dir === -1) {
        this.vx -= num12;
        if (this.vx < -num11) this.vx = -num11;
      }
    }
    const vxSign = this.vx > 0 ? 1 : this.vx < 0 ? -1 : 0;
    // 台阶步升（同战士：前方高差 ≤16.1 直接抬升）
    if (this.vy >= 0 && vxSign !== 0) {
      const ax = Math.floor((this.x + this.vx + this.w / 2 + (this.w / 2 + 1) * vxSign) / TILE);
      const fr = Math.floor((this.y + this.h - 1) / TILE);
      if (ax >= 0 && fr >= 2 && ax < st.w && fr < st.h
        && solidAt(ax, fr) && !st.half[st.idx(ax, fr)]
        && !solidAt(ax, fr - 1) && !solidAt(ax, fr - 2) && !solidAt(ax, fr - 3)) {
        const rise = this.y + this.h - fr * TILE;
        if (rise > 0 && rise <= 16.1) this.y = fr * TILE - this.h;
      }
    }
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
    // 卡墙计数（X 未动，原版 position.X == oldPosition.X 判定;cs:62889-62906）
    if (Math.abs(this.x - xBefore) < 0.01 || this.stuckT >= num || flag2) {
      this.stuckT += 1;
      flag3 = true;
    } else if (this.stuckT > 0) {
      this.stuckT -= 1;
    }
    if (this.stuckT > num * 10) this.stuckT = 0;
    if (this.justHit) this.stuckT = 0;
    // 近身（<200px 且本 tick 未计数）→ 清卡墙（cs:62928-62931）
    if (dist9 < 200 && !flag3) this.stuckT = 0;
    // 跳梯（前方探测带 5×vx 提前量）——整块仅落地帧执行（AI_026 总门
    // NPC.cs:63455 `if (velocity.Y == 0f)`）。曾缺门=空中每帧照跑,悬崖档每帧
    // vy=-8 覆盖重力 → 独角兽 86 恒速 8px/t 爬升"飞天"（2026-09-02 用户实报,
    // case 26 全族 86/155/329/315/410/423/546 同吃;fighterAI 同款块 :4666 有门）。
    // 遗留对齐批（2026-09-02）1:1 补齐：
    // ① flag6 头顶净空（:63457-63468）：行 (y-7)/16、列 (x-7)/16..(x+w+7)/16
    //   任一实心 → 整块不跑（顶头不跳）;
    // ② 行进侧门 num24 = spriteDirection 闩 sdir26,410/423/546 再 ×−1
    //   （:63513-63518）——曾以 facing(=direction) 代位=逐帧随仇恨翻转,闩不随;
    // ③ -7/-6 档 !topSlope（:63535-63542,slope 1|2=坡顶不判墙）;曾带 h>=32 高度门
    //   系 AI_003 :60692 串味（AI_026 无 → 410 星尘蜘蛛 h<32 墙档被吞）;
    // ④ 悬崖档门+格位（:63545-63548）：(directionY<0 ∥ |vx|>3) 且 [n23+2] 空 且
    //   [n22+dir,n23+3] 空（410/423 flag7 才加看 [n23+1]）——曾查 n+1/n+dir+1/
    //   n+dir+2 且无速度门=浅一格+误跳。
    if (this.vy === 0) {
      const rTop = Math.floor((this.y - 7) / TILE);
      const cL = Math.floor((this.x - 7) / TILE);
      const cR = Math.floor((this.x + this.w + 7) / TILE);
      let headroom = true;
      for (let c = cL; c <= cR; c++) {
        if (solidAt(c, rTop)) { headroom = false; break; }
      }
      if (headroom) {
        const fx = Math.floor((this.x + this.w / 2 + (this.w / 2 + 2) * dir + this.vx * 5) / TILE);
        const fy = Math.floor((this.y + this.h - 15) / TILE);
        const topSlopeAt = (x: number, y: number) => {
          if (x < 0 || y < 0 || x >= st.w || y >= st.h) return false;
          const sl = st.slope[st.idx(x, y)];
          return sl === 1 || sl === 2;
        };
        let num24 = this.sdir26;
        if (vid === 410 || vid === 423 || vid === 546) num24 = -num24;
        if ((this.vx < 0 && num24 === -1) || (this.vx > 0 && num24 === 1)) {
          const flag7 = vid === 410 || vid === 423;
          if (solidAt(fx, fy - 2)) {
            this.vy = solidAt(fx, fy - 3) ? -8.5 : -7.5;
          } else if (solidAt(fx, fy - 1) && !topSlopeAt(fx, fy - 1)) {
            this.vy = -7;
          } else if (this.y + this.h - fy * TILE > 20 && solidAt(fx, fy) && !topSlopeAt(fx, fy)) {
            this.vy = -6;
          } else if ((this.dirY < 0 || Math.abs(this.vx) > 3)
            && (!flag7 || !solidAt(fx, fy + 1))
            && !solidAt(fx, fy + 2)
            && !solidAt(fx + dir, fy + 3)) {
            this.vy = -8; // 前方悬空（悬崖/沟）大跳
          }
        }
      }
    }
    // ---- 423 冲刺尾尘（cs:63365-63377）：|vx| ≥ num11×0.95 → 2×(1/3) 尘 242 ----
    if (vid === 423 && Math.abs(this.vx) >= num11 * 0.95 && Math.random() < 1 / 3) {
      game.spawnParticles(this.cx, this.cy, '#C8D8E8', 1, 0.2, { life: 30, grav: 0 });
    }
    // ---- 546 滚转（cs:63365-63369）：rotation += vx×0.05 持续累积（滚转无态机——
    //      台账"case 3/0.05/AngleTowards 态机"实为 AI_110_Betsy 段误归属）；半句
    //      spriteDirection=−direction 落 Renderer 546 反翻档（facing<0 才翻，facing
    //      兼作本 AI 的 direction 不可就地取反）；渲染派发门 stR===26&&idR===546 ----
    if (vid === 546) {
      this.visAngle += this.vx * 0.05;
      this.sdir26 = -this.facing;   // spriteDirection=−direction（cs:63571 每 tick 闩写）
    }
    // 注意：原版 AI_026 无逐帧地面摩擦（速度持续加到 maxSpd，只有逆向阻尼/超速落地衰减）——
    // 不能带 fighterAI 的 onGround *=0.9，否则平衡点被压到 0.63 远低于 6
  }

  /** 620 地精鲨陆地段（AI_107_ImprovedWalkers case 620,cs:64118-64277 +
   *  flag12 射链 :64551-64679,审计 B charger「620 陆地 8 速+远程 811+夜扑」）：
   *  夜间追击 + BloodShot 811 射链（60 蓄 / 40 发 / 150 间歇,枪口 (−4×dir,−20),
   *  弧降 0.15、散布 ±2.5、速 13、伤 40/30 难度化）;白天停射驱散;
   *  夜扑 = 玩家在上且 |dx|<width×3 有视线 → 按 (底−16−玩家底)/16 梯度
   *  −11/−13/−14/−15.9（<27 格才跳）;陆行 8 速 / 0.21 加速、超帽 ×0.9。 */
  private goblinSharkLandAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const night = !game.world.clock.isDay;
    // ---- 出生淡入（cs:64156-64177）：alpha==255 首帧 vy=−6 + 35 血尘,−15/t 渐显 ----
    if (!this.bInit) { this.bInit = true; this.spawnAlpha = 255; this.alphaFade = false; }
    if (this.spawnAlpha === 255) {
      this.vy = -6;
      game.spawnParticles(this.cx, this.cy, '#B01830', 12, 3, { life: 40, grav: 0 });
    }
    this.spawnAlpha = Math.max(0, this.spawnAlpha - 15);
    if (this.spawnAlpha !== 0) {
      game.spawnParticles(this.cx, this.cy, '#B01830', 2, 2, { life: 40, grav: 0 });
    }
    if (Math.random() < 1 / 3) {
      game.spawnParticles(this.cx, this.cy, '#B01830', 1, 0.4, { life: 30, grav: 0 });
    }
    // ---- 夜扑（cs:64199-64230）：落地 + 玩家底在自身顶上方 + |dx|<width×3 +
    //      有视线 → (Bottom−16−玩家底)/16 <27 时按梯度跳 ----
    if (night && player && !player.dead && this.vy === 0
      && player.y + player.h < this.y
      && Math.abs(this.cx - player.cx) < this.w * 3
      && this.canSeePlayer(st, player)) {
      const tiles32 = Math.floor((this.y + this.h - 16 - (player.y + player.h)) / TILE);
      if (tiles32 < 27) {
        if (tiles32 < 11) this.vy = -11;
        else if (tiles32 < 15) this.vy = -13;
        else if (tiles32 < 19) this.vy = -14;
        else this.vy = -15.9;
      }
    }
    // ---- flag12 射链（cs:64551-64679 + case 620 参数）----
    const dist = player ? Math.hypot(player.cx - this.cx, player.cy - this.cy) : Infinity;
    if (night) {
      // 招式音（case 620,cs:64174-64177,ai[0]>0 且读减数前 ai[1]）
      if (this.ai0 > 0) {
        if (this.ai1 === 40) game.playSfxFiles?.(['dd2_drakin_shot_0', 'dd2_drakin_shot_1', 'dd2_drakin_shot_2'], 0.7, this.cx, this.cy);
        else if (this.ai1 === 60) game.playSfxFiles?.(['dd2_drakin_breath_in_0', 'dd2_drakin_breath_in_1', 'dd2_drakin_breath_in_2'], 0.6, this.cx, this.cy);
      }
      const preAi1 = this.ai1;              // case 块读到的减数前 ai[1]（num9 依据）
      if (this.ai1 > 0) this.ai1 -= 1;
      if (this.justHit) { this.ai1 = 20; this.ai0 = 0; }    // num19=20（:64558-64561）
      if (this.ai0 > 0) {
        if (this.ai1 > 40 && player && !player.dead) this.facing = this.seekDirX(player);  // flag15
        // num9 出手帧（case 620 :64129-64134,按减数前 ai[1] 求,命中减数后值）
        const num9 = (preAi1 > 10 && preAi1 <= 40 && Math.floor(preAi1) % 5 === 0) ? preAi1 - 1 : 40;
        if (this.ai1 === num9 && player && !player.dead) {
          const mx = this.cx - 4 * this.facing, my = this.cy - 20;      // vector（:64135-64136）
          let bvxx = player.cx - mx, bvyy = player.cy - my;
          bvyy -= Math.abs(bvxx) * 0.15;                                // 弧降补偿 num15
          const bl = Math.hypot(bvxx, bvyy) || 1;
          const sx = bvxx / bl * 13 + (Math.random() * 5 - 2.5);        // num10=13、散布 ±2.5
          const sy = bvyy / bl * 13 + (Math.random() * 5 - 2.5);
          // ★批六 C1 载体归位（同 619 口）：Arrow(shoot)→spawnHostileProj→Dart——
          //  case 620 伤 40/30 难度化、13 速 ±2.5 散布原样保留
          this.spawnHostileProj(game, mx, my, sx, sy, getAttackDamageForProjectiles(40, 30, this.difficulty), 811);
          // 发后 ai[0] 记弹道方位档,flag16 → direction 随弹向（:64605-64623）
          if (Math.abs(sy) > Math.abs(sx) * 2) this.ai0 = sy > 0 ? 1 : 5;
          else if (Math.abs(sx) > Math.abs(sy) * 2) this.ai0 = 3;
          else this.ai0 = sy > 0 ? 2 : 4;
          this.facing = sx > 0 ? 1 : -1;
        }
        // 结束（:64624-64637）：空中或倒数尽 → ai[0]=0、ai[1]=150（num20 间歇）
        if (this.vy !== 0 || this.ai1 <= 0) {
          this.ai0 = 0;
          this.ai1 = 150;
        } else {
          this.vx *= 0.9;    // 蓄力刹车（:64638-64641）
        }
      }
      // 起手（:64640-64668）：非蓄力 + 落地 + 倒数尽 + 有目标有视线 <600px →
      // vx×0.5、ai[1]=60（num8）、ai[0] 方位档
      if (this.ai0 <= 0 && this.vy === 0 && this.ai1 <= 0 && player && !player.dead
        && this.canSeePlayer(st, player) && dist < 600) {
        this.vx *= 0.5;
        this.ai0 = 3;
        this.ai1 = 60;
        const ddx = player.cx - this.cx, ddy = player.cy - this.cy;
        if (Math.abs(ddy) > Math.abs(ddx) * 2) this.ai0 = ddy > 0 ? 1 : 5;
        else if (Math.abs(ddx) > Math.abs(ddy) * 2) this.ai0 = 3;
        else this.ai0 = ddy > 0 ? 2 : 4;
        this.facing = ddx > 0 ? 1 : -1;
      }
    }
    // ---- 重瞄/驱散（cs:64403-64441,flag21=夜/flag22=射倒数中/flag23=日）：
    //      夜 = 非卡墙每帧 TargetClosest;日 = EncourageDespawn(10) + 静止折返
    //      （卡墙态优先级同链:夜且射倒数中两者皆不进） ----
    if (this.stuckT < 30 && night) {
      if (player && !player.dead) this.facing = this.seekDirX(player);
    } else if (!(night && this.ai1 > 0)) {
      if (!night) this.encourageDespawn(10);
      if (this.vx === 0 && this.vy === 0) {
        this.ai2 += 1;
        if (this.ai2 >= 2) { this.facing *= -1; this.ai2 = 0; }
      }
      if (this.facing === 0) this.facing = 1;
    }
    // ---- 陆行推进（cs:64669-64698,num23=8 / num24=0.07×3=0.21 / num25=0.9）：
    //      蓄力/射倒数中（ai[0]>0）不推进 ----
    if (this.ai0 <= 0 || !night) {
      if (this.vx < -8 || this.vx > 8) {
        if (this.vy === 0) this.vx *= 0.9;
      } else if ((this.vx < 8 && this.facing === 1) || (this.vx > -8 && this.facing === -1)) {
        this.vx = Math.max(-8, Math.min(8, this.vx + 0.21 * this.facing));
      }
    }
    // ---- 跳梯（AI_107 :64695-64830,6695+）：-7/-8/-6/-5 档 + 悬崖 vx×1.5 vy=−8 ----
    const solidAt = (x: number, y: number) => x >= 0 && y >= 0 && x < st.w && y < st.h && st.isSolid(x, y);
    if (this.vy === 0) {
      const vxS = this.vx > 0 ? 1 : this.vx < 0 ? -1 : 0;
      if (vxS === this.facing) {
        const fx = Math.floor((this.cx + this.vx * 5) / TILE);
        const fy = Math.floor((this.y + this.h - 15) / TILE);
        if (this.h >= 32 && solidAt(fx, fy - 2)) {
          this.vy = solidAt(fx, fy - 3) ? -8 : -7;
        } else if (solidAt(fx, fy - 1)) {
          this.vy = -6;
        } else if (this.y + this.h - fy * TILE > 20 && solidAt(fx, fy)) {
          this.vy = -5;
        } else if (this.dirY < 0 && !solidAt(fx, fy + 1)) {
          this.vx *= 1.5;
          this.vy = -8;
        }
      }
    }
    this.applyGravity(game);
    const xBefore = this.x;
    moveAndCollide(this, game.world, this.vx, this.vy);
    // 卡墙计数（cs:64424-64434:静止/超阈/逆向 → +1;|vx|>0.9 移动中回落;>300 归零）
    if (Math.abs(this.x - xBefore) < 0.01 || this.stuckT >= 30) this.stuckT += 1;
    else if (Math.abs(this.vx) > 0.9 && this.stuckT > 0) this.stuckT -= 1;
    if (this.stuckT > 300) this.stuckT = 0;
    if (this.justHit) this.stuckT = 0;
  }

  /** AI_014 蝙蝠/飞行族（1.4.5.6 完整反编译 NPC.145.cs:22895+）：
   *  noGravity；撞墙旧速×-0.5 反弹（X 最小弹速朝向 ±2 / Y ±1）；
   *  通用分轴加速 X 0.1/±4、Y 0.04/±1.5（逆转修正 0.05/0.03）；
   *  Giant Bat(158) 0.2/±7；血乌贼(660) X 0.35/±6、Y 0.3/±5。
   *  （1.4.0.5 反编译包 AI() 空壳，此处以 1.4.5.6 源为准——旧编号行为两版未变） */
  private batAI(game: GameHooks, player: Player | null) {
    const oldVx = this.vx, oldVy = this.vy;
    const vid = this.vanillaId ?? -1;
    const vampireBat = vid === 158;
    // ---- 索敌（cs:22938-22954）：226 飞蛇专属档（审计 batAI#4）——重瞄后失视线
    //      则保留重瞄前的速度符号方向（穿墙折返感）;其余 TargetClosest ----
    let dirX: number, dirY: number;
    if (vid === 226) {
      const keepX = this.vx < 0 ? -1 : 1;
      const keepY = this.vy < 0 ? -1 : 1;
      if (player) {
        dirX = player.cx > this.cx ? 1 : -1;
        dirY = player.cy > this.cy ? 1 : -1;
        this.dirY = dirY;
        if (!this.canSeePlayer(game.world.store, player)) { dirX = keepX; dirY = keepY; }
      } else { dirX = this.facing; dirY = this.dirY; }
    } else if (player) {
      dirX = player.cx > this.cx ? 1 : -1;
      dirY = player.cy > this.cy ? 1 : -1;
      this.dirY = dirY;   // 持久化:玩家死亡后 TargetClosest 无操作(AI_014 :22943
      // 同款语义)→ 沿用最后垂直方向滑行,而非恒上飞(2026-08-19 修正)
    } else { dirX = this.facing; dirY = this.dirY; }
    // 吸血蝙蝠白天离场（cs:22944-22949）：158 且在地表之上 && 白天 && 非日食 →
    // directionY=-1 上飞、direction 翻转水平远离（曾缺——白天吸血蝙蝠赖场不退）
    if (vampireBat && this.y < game.world.groundLevel * TILE
      && game.world.clock.isDay && !game.world.clock.eclipse) {
      dirY = -1;
      this.dirY = -1;
      dirX = -dirX;
    }
    this.facing = dirX;
    // ---- 第一段移动 per-type 档（cs:22955-23155）：
    //  158 吸血蝙蝠（#2/#3）：X/Y 步 0.2、帽 ±7、二档阈值 4（步 0.1）、修正 0.05；
    //  226 飞蛇（#4）：X 0.2/±4 二档 4/0.1 修 0.05；Y 0.1/±2.5 二档 2.5/0.05 修 0.03；
    //  660 皇后紫仆从（#3）：X 0.35/±6 二档 6/0.35 修 0.175；Y 0.3/±5 二档 5/0.3 修 0.225；
    //  其余：X 0.1/±4 二档 4/0.1 修 0.05；Y 0.04/±1.5 二档 1.5/0.05 修 0.03 ----
    let ax: number, ay: number, cx: number, cy: number, t2x: number, t2xs: number, corx: number,
      t2y: number, t2ys: number, cory: number;
    if (vid === 158) {
      ax = 0.2; cx = 7; t2x = 4; t2xs = 0.1; corx = 0.05;
      ay = 0.2; cy = 7; t2y = 4; t2ys = 0.1; cory = 0.05;
    } else if (vid === 226) {
      ax = 0.2; cx = 4; t2x = 4; t2xs = 0.1; corx = 0.05;
      ay = 0.1; cy = 2.5; t2y = 2.5; t2ys = 0.05; cory = 0.03;
    } else if (vid === 660) {
      ax = 0.35; cx = 6; t2x = 6; t2xs = 0.35; corx = 0.175;
      ay = 0.3; cy = 5; t2y = 5; t2ys = 0.3; cory = 0.225;
    } else {
      ax = 0.1; cx = 4; t2x = 4; t2xs = 0.1; corx = 0.05;
      ay = 0.04; cy = 1.5; t2y = 1.5; t2ys = 0.05; cory = 0.03;
    }
    if (dirX === -1 && this.vx > -cx) {
      this.vx -= ax;
      if (this.vx > t2x) this.vx -= t2xs; else if (this.vx > 0) this.vx += corx;
      if (this.vx < -cx) this.vx = -cx;
    } else if (dirX === 1 && this.vx < cx) {
      this.vx += ax;
      if (this.vx < -t2x) this.vx += t2xs; else if (this.vx < 0) this.vx -= corx;
      if (this.vx > cx) this.vx = cx;
    }
    if (dirY === -1 && this.vy > -cy) {
      this.vy -= ay;
      if (this.vy > t2y) this.vy -= t2ys; else if (this.vy > 0) this.vy += cory;
      if (this.vy < -cy) this.vy = -cy;
    } else if (dirY === 1 && this.vy < cy) {
      this.vy += ay;
      if (this.vy < -t2y) this.vy += t2ys; else if (this.vy < 0) this.vy -= cory;
      if (this.vy > cy) this.vy = cy;
    }
    // ---- 第二段移动（cs:23227-23378：{49,51,60,62,66,93,137,150,151,152,634}
    //      11 类在通用段之后再跑一遍 X/Y 步进——先 wet 浮力再步进（60 地狱蝠
    //      二档 X 0.07/修 0.03、Y 0.03/修 0.02;其余 X 0.1/0.05、Y 0.05/0.03）----
    if (AI014_DOUBLE_STEP.has(vid)) {
      if (this.wet && AI014_SWIM_UP.has(vid)) {   // 双步族 11 类 = wet 表成员（cs:23232-23243）
        if (this.vy > 0) this.vy *= 0.95;
        this.vy -= 0.5;
        if (this.vy < -4) this.vy = -4;
        if (player) this.facing = this.seekDirX(player);   // TargetClosest
      }
      const x2b = vid === 60 ? 0.07 : 0.1;
      const x2c = vid === 60 ? 0.03 : 0.05;
      const y2b = vid === 60 ? 0.03 : 0.05;
      const y2c = vid === 60 ? 0.02 : 0.03;
      if (dirX === -1 && this.vx > -4) {
        this.vx -= 0.1;
        if (this.vx > 4) this.vx -= x2b; else if (this.vx > 0) this.vx += x2c;
        if (this.vx < -4) this.vx = -4;
      } else if (dirX === 1 && this.vx < 4) {
        this.vx += 0.1;
        if (this.vx < -4) this.vx += x2b; else if (this.vx < 0) this.vx -= x2c;
        if (this.vx > 4) this.vx = 4;
      }
      if (dirY === -1 && this.vy > -1.5) {
        this.vy -= 0.04;
        if (this.vy > 1.5) this.vy -= y2b; else if (this.vy > 0) this.vy += y2c;
        if (this.vy < -1.5) this.vy = -1.5;
      } else if (dirY === 1 && this.vy < 1.5) {
        this.vy += 0.04;
        if (this.vy < -1.5) this.vy += y2b; else if (this.vy < 0) this.vy -= y2c;
        if (this.vy > 1.5) this.vy = 1.5;
      }
    }
    // ---- 哈比 48 wet 浮力（cs:23379-23392）
    if (vid === 48 && this.wet) {
      if (this.vy > 0) this.vy *= 0.95;
      this.vy -= 0.5;
      if (this.vy < -4) this.vy = -4;
      if (player) this.facing = this.seekDirX(player);   // TargetClosest
    }
    moveAndCollide(this, game.world, this.vx, this.vy);
    // 撞墙/撞地反弹（L22899-22923：collideX/Y → oldVelocity*-0.5 + 最小弹速）
    if (this.hitWall) {
      this.vx = -oldVx * 0.5;
      if (this.facing === -1 && this.vx > 0 && this.vx < 2) this.vx = 2;
      if (this.facing === 1 && this.vx < 0 && this.vx > -2) this.vx = -2;
    }
    if (this.hitHead || this.onGround) {
      this.vy = -oldVy * 0.5;
      if (this.vy > 0 && this.vy < 1) this.vy = 1;
      if (this.vy < 0 && this.vy > -1) this.vy = -1;
    }
    // ---- 吸血蝙蝠俯袭击变形（cs:23393-23402）：玩家在下方 200px 内且有视线 →
    // 落地化作人形吸血鬼（159，AI_003 战士 + 离远化回）
    if (vampireBat && player && !player.dead) {
      const d = Math.hypot(player.cx - this.cx, player.cy - this.cy);
      if (d < 200 && this.y + this.h < player.y + player.h && this.canSeePlayer(game.world.store, player)) {
        this.tryTransformTo(159, game.world.store, false, game);
      }
    }
    // ---- 失视 200t 缓速振荡（cs:23405-23462,审计 batAI#5）：ai[1] 每 tick +1
    //      （158 ×2 = 双倍计数）;>200 且玩家不湿身 + 有视线 → 归零(常态追击不受
    //      此段影响——ai[1] 只在被墙体/水隔开时累计);振荡参数 X 步/帽/Y 步/帽 =
    //      0.2/4/0.1/1.5（48/62/66 0.12/3/0.07/1.25）,ai[2] 为相位(±300 循环);
    //      ai[1]>1000 强制归零。★ai[2] 为振荡专用,勿挪用 ----
    this.ai1 += 1;
    if (vid === 158) this.ai1 += 1;
    if (this.ai1 > 200) {
      if (player && !player.dead && !player.inWater
        && this.canSeePlayer(game.world.store, player)) {
        this.ai1 = 0;
      }
      let osX = 0.2, osY = 0.1, ocX = 4, ocY = 1.5;
      if (vid === 48 || vid === 62 || vid === 66) { osX = 0.12; osY = 0.07; ocX = 3; ocY = 1.25; }
      if (this.ai1 > 1000) this.ai1 = 0;
      this.ai2 += 1;
      if (this.ai2 > 0) {
        if (this.vy < ocY) this.vy += osY;
      } else if (this.vy > -ocY) {
        this.vy -= osY;
      }
      if (this.ai2 < -150 || this.ai2 > 150) {
        if (this.vx < ocX) this.vx += osX;
      } else if (this.vx > -ocX) {
        this.vx -= osX;
      }
      if (this.ai2 > 300) this.ai2 = -300;
    }
    // ---- 飞行射击族（cs:23465-23543，逐发要求视线；轮空段阈值【每帧重掷】
    //      （审计 batAI#6：`ai[0] >= 400 + rand(400)` 每 tick 重掷,非缓存——曾
    //      缓存进 ai2 与上方振荡相位冲突））：哈比 48 羽毛 38（30/60/90 连三、
    //      速 6、伤 15、±100、400+rand400）/ 恶魔 62/66 飞镰 44（20/40/60/80 连四、
    //      速 0.2 起步 AI_018 加速、伤 21、±100、300+rand300）/ 红恶魔 156 三叉戟
    //      115（20/40/60/80/100 连五、速 0.2 起步 AI_027、伤 80、±50、250+rand250；
    //      出生点 = 中心 + 自身速度×5 + 弹向×20（cs:23584-23595,★F1 清偿 2026-10-14——
    //      num259/260 经 num261=num258/num261(:23589) 归一并 ×0.2（弹速 num258）,
    //      :23595 的 ×100 作用在该已乘 0.2 的速度向量上 → 净偏移=单位弹向×0.2×100
    //      =20px;旧「弹向×100」把 0.2 速率系数漏乘=出膛点 5 倍远。审计 batAI#7——
    //      曾漏速度前置使贴身三叉戟从脸后出膛）） ----
    const shooter = vid === 48
      ? { ticks: [30, 60, 90], spd: 6, dmg: 15, spread: 100, reset: 400, proj: 38, lead: 0, velLead: 0 }
      : vid === 62 || vid === 66
        ? { ticks: [20, 40, 60, 80], spd: 0.2, dmg: 21, spread: 100, reset: 300, proj: 44, lead: 0, velLead: 0 }
        : vid === 156
          ? { ticks: [20, 40, 60, 80, 100], spd: 0.2, dmg: 80, spread: 50, reset: 250, proj: 115, lead: 20, velLead: 5 } // ★F1:lead=净 px 偏移（单位弹向×20——原版 ×100 作用在已乘 0.2 的弹速向量上 :23589/:23595）
          : null;
    if (shooter) {
      if (this.ai0 < 0) this.ai0 = 0; // 类字段默认 -1120 是史莱姆初值；原版 ai[0] 从 0 起步
      this.ai0 += 1;
      if (shooter.ticks.includes(this.ai0)) {
        if (player && !player.dead && this.canSeePlayer(game.world.store, player)) {
          const ox = player.cx - this.cx + (Math.random() * 2 - 1) * shooter.spread;
          const oy = player.cy - this.cy + (Math.random() * 2 - 1) * shooter.spread;
          const d = Math.hypot(ox, oy) || 1;
          // 出生点 = 中心 + 速度×velLead + 弹向×lead（156：vector25 += velocity*5 后
          // + num259*100（:23594-23595）——num259 已是 ×0.2 弹速向量（:23589-23591）
          // → lead 表值口径=净 px 偏移,156=0.2×100=20;48/62/66 原版无偏移项=lead 0）
          this.shootDart(game,
            this.cx + this.vx * shooter.velLead + (ox / d) * shooter.lead,
            this.cy + this.vy * shooter.velLead + (oy / d) * shooter.lead,
            ox, oy, shooter.spd, shooter.dmg, shooter.proj);
        }
      } else if (this.ai0 > shooter.ticks[shooter.ticks.length - 1]
        && this.ai0 >= shooter.reset + Math.floor(Math.random() * shooter.reset)) {
        // 1457 :23537-23539：哈比 48 的轮空重置门加 flag24（超视野不重置——
        // 计数器越过阈值继续攀升,回视野后从下一阈值重新对拍）
        if (vid !== 48 || !player
          || aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)) this.ai0 = 0;
      }
    }
  }

  /** AI_016 游泳族（1.4.5.6 NPC.145.cs:23549+）：鲨鱼/食人鱼/琵琶鱼等
   *  通用档水中 accel 0.1/0.1、上限 X±3/Y±2（L23883-23897）；Arapaima(157) 0.25/0.2、±7/±4（L23831+）；
   *  撞墙掉头；离水缓慢上浮。螺旋转向/专家模式特化略 */
  private swimAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    // npc.rotation 默认 0（visAngle 类字段默认 π 是 EoC 语境——不归零会倒栽葱）
    if (!this.aiInit) { this.aiInit = true; this.visAngle = 0; }
    // wet = 原版 Collision.WetCollision（npcLiquid 每 tick 写；中心小盒判水线，
    // 浅水/贴面与中心格 liquid>80 近似有别——水面行为以此为准）
    const inWater = this.wet;
    const ara = this.vanillaId === 157;
    // ---- 河鲀 688 膨胀（cs:23555-23620）：受击进入膨胀 180t——缓速悬浮贴水面，
    // 期间不吃通用鱼逻辑（简化为阻尼漂浮，贴水线钉法省略）
    if (this.vanillaId === 688) {
      if (this.justHit && this.ai2 === 0) { this.ai2 = 1; this.ai3 = 180; }
      if (this.ai2 === 1) {
        this.vx *= 0.98;
        this.vy = inWater ? Math.max(this.vy - 0.3, -10) : Math.min(this.vy + 0.3, 10);
        this.vy *= 0.98;
        this.ai3 -= 1;
        if (this.ai3 <= 0) this.ai2 = 0;
        moveAndCollide(this, game.world, this.vx, this.vy);
        return;
      }
    }
    // ---- 海豚 615 周期跃出（cs:23629-23747）：每 300-1199t 触发，水中持续上冲
    //  （vy-=0.4 限 -6）出水后抛物线落回
    if (this.vanillaId === 615) {
      if (this.ai2 !== 1) {
        this.ai1 += 1;
        if (this.ai1 >= 300 + Math.random() * 900 && inWater) { this.ai2 = 1; this.ai1 = 0; }
      } else {
        if (inWater) {
          this.vy -= 0.4;
          if (this.vy < -6) this.vy = -6;
          // 跃出倾斜（cs:23664-23673）：rotation = vy×direction×0.3 钳 ±2π/5
          this.visAngle = Math.max(-Math.PI * 2 / 5, Math.min(Math.PI * 2 / 5, this.vy * this.facing * 0.3));
          // 跃出叫声（cs:23735-23740）：ai[3] 每 tick +1（≥300 清零回落），
          // ==60 且 1/2 掷 → (45)=Zombie_109 海豚音
          this.ai3 += 1;
          if (this.ai3 >= 300) { this.ai2 = 0; this.ai3 = 0; this.vy = 4; }
          else if (this.ai3 === 60 && Math.floor(Math.random() * 2) === 0) {
            game.playSfxWav?.('Zombie_109', 1, this.cx, this.cy);
          }
        } else {
          this.vy = Math.min(this.vy + 0.3, 10); // 出水抛物线
          this.visAngle += this.facing * 0.2;    // 空中翻滚（cs:23682-23683 rotation += dir×0.2）
        }
        if (this.onGround || this.hitWall) this.ai2 = 0;
        moveAndCollide(this, game.world, this.vx, this.vy);
        return;
      }
    }
    if (inWater) {
      // ---- flag22 攻击门（cs:23731-23740）：55 金鱼/592/607 鳉/615 海豚/688 河鲀
      //    五族不索敌（连 TargetClosest 都不调）恒游荡；其余玩家【湿身】+视线
      //    可及才追击。★此前无条件朝玩家全速追（±3/±2）——岸上玩家会把鱼
      //    vy=-2 直拖出水面,出水落岸后无限拍打 = "鱼经常蹦出水面上岸"根因
      //    （2026-08-19 用户报,食人鱼例）
      const noChase = this.vanillaId === 55 || this.vanillaId === 592
        || this.vanillaId === 607 || this.vanillaId === 615 || this.vanillaId === 688;
      const chase = !noChase && !!player && !player.dead
        && player.inWater && this.canSeePlayer(st, player);
      if (chase && player) {
        // 攻击形（cs:23822-23862）：TargetClosest + 分族推进档
        this.facing = this.seekDirX(player);
        const dy = player.cy > this.cy ? 1 : -1;
        if (ara) {
          // 157 巨骨舌鱼（cs:23829-23845）：逆向阻尼 + 0.25/0.2 推进,钳 ±7/±4
          if ((this.vx > 0 && this.facing < 0) || (this.vx < 0 && this.facing > 0)) this.vx *= 0.95;
          this.vx += this.facing * 0.25;
          this.vy += dy * 0.2;
          if (this.vx > 8) this.vx = 7;
          if (this.vx < -8) this.vx = -7;
          if (this.vy > 5) this.vy = 4;
          if (this.vy < -5) this.vy = -4;
        } else if (this.vanillaId === 65 || this.vanillaId === 102 || this.vanillaId === 692) {
          // 鲨鱼/琵琶鱼/虎鲸（cs:23846-23862）：0.15/0.15,钳 ±5/±3
          this.vx += this.facing * 0.15;
          this.vy += dy * 0.15;
          this.vx = Math.max(-5, Math.min(5, this.vx));
          this.vy = Math.max(-3, Math.min(3, this.vy));
        } else {
          // 其余（食人鱼 58 等,cs:23856-23862）：0.1/0.1,钳 ±3/±2
          this.vx += this.facing * 0.1;
          this.vy += dy * 0.1;
          this.vx = Math.max(-3, Math.min(3, this.vx));
          this.vy = Math.max(-2, Math.min(2, this.vy));
        }
      } else {
        // 游荡形（cs:23864-24004）：direction 恒存（撞墙翻,不追玩家）——
        // 水平 vx += dir*0.1 钳 ±1（615 海豚 ±3,cs:23952 num269）；
        // 垂直 ai[0] 慢振荡 ±0.3（cs:23968-23981,0.01 步进）贴水深游
        this.vx += this.facing * 0.1;
        const capX = this.vanillaId === 615 ? 3 : 1;
        if (this.vx < -capX || this.vx > capX) this.vx *= 0.95;
        if (ara) {
          // 157 游荡档（cs:23898-23945）：directionY 取自玩家纵深;ai[0] 振荡阈值
          // ±0.6 随 dirY 偏移（<0→-1/0.2,>0→-0.2/1）,0.02 步进
          this.dirY = player ? (player.cy > this.cy ? 1 : -1) : this.dirY;
          if (this.ai0 === -1) {
            this.vy -= 0.02;
            if (this.vy < (this.dirY < 0 ? -1 : this.dirY > 0 ? -0.2 : -0.6)) this.ai0 = 1;
          } else {
            this.vy += 0.02;
            if (this.vy > (this.dirY < 0 ? 0.2 : this.dirY > 0 ? 1 : 0.6)) this.ai0 = -1;
          }
          this.vx += this.facing * 0.1;   // 157 共 0.2 推进（cs:23919）
          this.vx = Math.max(-2, Math.min(2, this.vx));
        } else {
          if (this.ai0 === -1) {
            this.vy -= 0.01;
            if (this.vy < -0.3) this.ai0 = 1;
          } else {
            this.vy += 0.01;
            if (this.vy > 0.3) this.ai0 = -1;
          }
          // 浅水上升检查（cs:23984-24000）：头顶格 liquid>128 且脚下 1-2 格
          // 有实心 → ai[0]=-1 上浮（浅水贴面巡游,不触底）
          const tx = Math.floor(this.cx / 16), ty = Math.floor((this.y + this.h / 2) / 16);
          if (st.inBounds(tx, ty - 1) && st.liquid[st.idx(tx, ty - 1)] > 128
            && ((st.inBounds(tx, ty + 1) && st.flags[st.idx(tx, ty + 1)])
              || (st.inBounds(tx, ty + 2) && st.flags[st.idx(tx, ty + 2)]))) {
            this.ai0 = -1;
          }
          // 垂直阻尼（cs:24001-24004,157 豁免）：|vy|>0.4 ×0.95
          if (this.vy > 0.4 || this.vy < -0.4) this.vy *= 0.95;
        }
      }
      moveAndCollide(this, game.world, this.vx, this.vy);
      // 撞轴反弹（仅 !chase,cs:23790-23807）：撞墙 vx/朝向双翻;撞顶/底
      // vy 反弹并同步 ai[0] 方向（追击态不吃反弹）
      if (!chase) {
        if (this.hitWall) { this.vx *= -1; this.facing *= -1; }
        if (this.hitHead || this.onGround) {
          if (this.vy > 0) { this.vy = -Math.abs(this.vy); this.ai0 = -1; }
          else if (this.vy < 0) { this.vy = Math.abs(this.vy); this.ai0 = 1; }
        }
      }
    } else {
      // 离水（cs:24019-24034）：vy==0 → 拍打挣扎 vy=rand(-5,-2)/vx=rand(-2,2)
      // （65 食人鱼/692 貌鱼例外：只 ×0.94 阻尼不蹦）；重力 0.3 钳 10
      if (this.vy === 0) {
        if (this.vanillaId === 65 || this.vanillaId === 692) {
          this.vx *= 0.94;
          if (Math.abs(this.vx) < 0.2) this.vx = 0;
        } else {
          this.vy = -5 + Math.random() * 3;   // rand(-50,-20) × 0.1
          this.vx = -2 + Math.random() * 4;   // rand(-20,20) × 0.1
          this.facing = Math.random() < 0.5 ? 1 : -1;   // direction 随机（rotation 基向）
        }
      }
      this.vy = Math.min(this.vy + 0.3, 10);
      moveAndCollide(this, game.world, this.vx, this.vy);
    }
    // ---- 通用倾斜（cs:24046-24076 AI 尾段）：692 貌鱼 ai[0]==0 朝玩家瞄准
    //      钳 ±0.3（spriteDirection==1 再 +π）；其余鱼 rotation = vy×direction×0.1
    //      钳 ±0.2（游动俯仰）。2026-08-20 旋转三件套审计（蚁狮批延伸）----
    if (this.vanillaId === 692 && this.ai0 === 0) {
      if (player && !player.dead) {
        const nx = this.cx - player.cx, ny = this.cy - player.cy;
        const rot = Math.atan2(ny, nx) + (this.facing > 0 ? Math.PI : 0);
        this.visAngle = Math.max(-0.3, Math.min(0.3, Math.atan2(Math.sin(rot), Math.cos(rot))));
      }
    } else {
      this.visAngle = Math.max(-0.2, Math.min(0.2, this.vy * this.facing * 0.1));
    }
    // ---- 102 灯笼鱼额前小灯（cs:23820-23822）：面朝方向前 (width+8)px、y+2 处
    //  0.07/0.04/0.025 微光（钓竿诱饵）——位置偏移走 lightRGBAt ----
    if (this.vanillaId === 102) {
      this.lightRGB = [0.07, 0.04, 0.025];
      this.lightRGBAt = { x: this.x + this.w / 2 + this.facing * (this.w + 8), y: this.y + 2 };
    }
  }

  /** AI_018 水母族 1:1（cs:24212-24474）：潜伏（专家）+ 水中追击脉冲 + 上下漂移。
   *  潜伏 lurk（cs:24215-24269，仅专家且 63/64/103/242）：
   *   - ai[1]=1 潜伏中 → dontTakeDamage（不可击）且 AI 提前 return（原地悬浮）；
   *   - 玩家湿身+视线+150px 内：非潜伏 ai[2]+2（提前触发）/潜伏中 ai[2]−0.25（延长）；
   *   - 非潜伏 ai[2]≥420 → 入潜伏（ai[1]=1, ai[2]=0）；潜伏 ai[2]≥120 → 出潜伏；
   *   - 离水 → ai[1]=ai[2]=0（潜伏态清零）。发光 ×1.5（num274）。
   *  水中（cs:24330-24457）：撞轴反弹（collideX/collideY 原文 ± 反转）；玩家湿身+视线
   *   → 攻击形：阻尼（0.98 + 逐族再乘）+ 静止阈值 num277（63/64=0.2、103=0.6、221=1、
   *   242=3）内重定向脉冲 num278（7/103 9）；否则漂移形：vx+=dir×0.02 钳 ±1、
   *   rotation=vx×0.4、ai[0] 上下振荡（0.01 步进 ±1 阈值）+ 液深探测（上格液>128 且
   *   下 1-2 格有实心 → 转向上）。
   *  离水（cs:24459-24474）：rotation+=vx×0.1、vy==0 时 vx 阻尼归零、重力 0.2 钳 10
   *  ——水母离水只坠不蹦（与 aiStyle16 鱼的拍打挣扎不同） */
  private jellyfishAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const vid = this.vanillaId ?? 63;
    const inWater = this.wet;
    // ---- 潜伏态（专家 + 63/64/103/242，cs:24215）----
    const lurkCapable = mainExpertMode(game.world) && (vid === 63 || vid === 64 || vid === 103 || vid === 242);
    let lurking = false;
    if (inWater && this.ai1 === 1) lurking = true;
    else this.dontTakeDamage = false;                     // :24224 else 分支
    const playerWet = !!player && !player.dead && player.inWater;
    const near = !!player && !player.dead && playerWet
      && this.canSeePlayer(st, player)
      && Math.hypot(player.cx - this.cx, player.cy - this.cy) < 150;  // :24229-24236
    if (lurkCapable) {
      if (inWater) {
        if (near) {
          if (this.ai1 === 0) this.ai2 += 2;              // 非潜伏：提前触发
          else this.ai2 -= 0.25;                          // 潜伏中：延长
        }
        if (lurking) {
          this.dontTakeDamage = true;                     // :24247
          this.ai2 += 1;
          if (this.ai2 >= 120) this.ai1 = 0;              // :24252 出潜伏
        } else {
          this.ai2 += 1;
          if (this.ai2 >= 420) { this.ai1 = 1; this.ai2 = 0; }  // :24257 入潜伏
        }
      } else {
        this.ai1 = 0; this.ai2 = 0;                       // :24262 离水清零
      }
      lurking = inWater && this.ai1 === 1;
    }
    // ---- 发光（cs:24272-24290，num274 = 1 + 潜伏 0.5）----
    const lum = lurking ? 1.5 : 1;
    if (vid === 63) this.lightRGB = [0.05 * lum, 0.15 * lum, 0.4 * lum];
    else if (vid === 103) this.lightRGB = [0.05 * lum, 0.45 * lum, 0.1 * lum];
    else if (vid !== 221 && vid !== 242) this.lightRGB = [0.35 * lum, 0.05 * lum, 0.2 * lum];
    // ---- 潜伏中：原地悬浮（AI 提前 return，velocity 保持 → 缓漂）----
    if (lurking) return;
    // direction==0 → TargetClosest()（cs:24278-24281）——SetTargetTrackingValues
    // (:78543-78553) 只在 faceTarget 且目标未死时置 ±1（玩家中心 ≥ 本体中心取 1）；
    // 无有效目标【保持 0】（漂移段 direction*0.02 = 垂直悬浮，不再横向漂）。
    // 曾强制 ±1（无玩家兜底 -1）= 离场水母恒单向漂（审计 B jellyfish,2026-08-19）
    if (this.facing === 0 && player && !player.dead) {
      this.facing = player.cx >= this.cx ? 1 : -1;
    }
    if (inWater) {
      // ---- cs:24344-24372 三连段（2026-08-31 清偿 ⑤斜坡翻向+轴碰撞显式反向）----
      // 斜坡翻向（cs:24346-24356 原文式）：底缘格及其下一行 topSlope(slope 1|2) 时
      // 左坡(leftSlope=slope 2|4 侧) → direction=-1、vx=−|vx|；右坡 → +1/+|vx|
      // （此前交给 moveAndCollide 的 slopeCollide 承担，无显式翻向——沿坡会滑离源向）
      {
        const botCol = Math.floor(this.cx / TILE);                  // num277 = Center.X/16
        const botRow = Math.floor((this.y + this.h) / TILE);        // num278 = (pos.Y+h)/16
        // ★G1谓词批(2026-09-04)：原版裸 topSlope()（NPC.cs:24346/:24350）无 active/
        // nactive 门——isActive 门会漏判已致动/残型坡格致不翻向 → 去门,仅留界内守卫
        // （vanilla null→空 Tile slope=0 同构）
        const slAt = (x: number, y: number): number =>
          st.inBounds(x, y) ? (st.slope[st.idx(x, y)] ?? 0) : 0;
        const sa = slAt(botCol, botRow);
        const sb = slAt(botCol, botRow + 1);
        if (sa === 1 || sa === 2 || sb === 1 || sb === 2) {         // topSlope()
          const ls = sa === 2 || sb === 2;                          // leftSlope()
          this.facing = ls ? -1 : 1;
          this.vx = ls ? -Math.abs(this.vx) : Math.abs(this.vx);
        }
      }
      // 撞轴反弹（cs:24357-24363 collideX / :24364-24371 collideY 显式反向）：
      // collideX → vx×−1 且 direction 随之；collideY 按【旧速】符号显式 ±|·| 并写
      // directionY 与 ai[0]（本仓解析后落速被截为 ±0/0.01——以 onGround/hitHead
      // 标志代"旧速向下/向上撞"的判别位）
      if (this.hitWall) { this.vx *= -1; this.facing *= -1; }
      if (this.onGround) {
        this.vy = -Math.abs(this.vy);
        this.dirY = -1;
        this.ai0 = -1;
      } else if (this.hitHead) {
        this.vy = Math.abs(this.vy || 0.01);
        this.dirY = 1;
        this.ai0 = 1;
      }
      // 玩家湿身 + 视线 → 攻击形（cs:24366-24420 flag24）
      if (playerWet && player && this.canSeePlayer(st, player)) {
        this.lai2 = 1;                                     // :24347 狩猎旗（221 FindFrame 消费）
        let damp = 0.98;
        let still = 0.2;                                   // num277：静止阈值
        if (vid === 103) { damp *= 0.98; still = 0.6; }
        if (vid === 221) { damp *= 0.99; still = 1; }
        if (vid === 242) { damp *= 0.995; still = 3; }
        this.visAngle = Math.atan2(this.vy, this.vx) + Math.PI / 2;
        this.vx *= damp; this.vy *= damp;
        if (Math.abs(this.vx) < still && Math.abs(this.vy) < still) {
          if (vid === 221) this.lai0 = 1;                  // :24361 鱿鱼慢速触发（FindFrame 帧 0 复位）
          if (player) {
            this.facing = this.seekDirX(player);          // TargetClosest
            const spd = vid === 103 ? 9 : 7;              // num278
            const dx = player.cx - this.cx, dy = player.cy - this.cy;
            const d = Math.hypot(dx, dy) || 1;
            this.vx = (dx / d) * spd;
            this.vy = (dy / d) * spd;
          }
        }
        moveAndCollide(this, game.world, this.vx, this.vy);
        return;
      }
      // 漂移形（cs:24421-24457）
      this.lai2 = 0;                                       // :24390 狩猎旗清除
      this.vx += this.facing * 0.02;
      this.visAngle = this.vx * 0.4;
      if (this.vx < -1 || this.vx > 1) this.vx *= 0.95;
      if (this.ai0 === -1) {
        this.vy -= 0.01;
        if (this.vy < -1) this.ai0 = 1;
      } else {
        this.vy += 0.01;
        if (this.vy > 1) this.ai0 = -1;
      }
      // 液深探测（cs:24440-24455）：中心上格液>128 且下 1-2 格实心 → 转向上
      // ★G1谓词批(2026-09-04)：原版裸 active()（NPC.cs:24488/:24491）——含已致动格,
      // isActive 误排致动底格 → 改 hasTile（:8717 姊妹副本 flags 读同语义,统一向
      // 正确副本）
      const cx = Math.floor(this.cx / TILE), cy = Math.floor(this.cy / TILE);
      if (st.inBounds(cx, cy) && st.liquid[st.idx(cx, cy - 1)] > 128) {
        if ((st.inBounds(cx, cy + 1) && st.hasTile(cx, cy + 1))
          || (st.inBounds(cx, cy + 2) && st.hasTile(cx, cy + 2))) this.ai0 = -1;
      } else {
        this.ai0 = 1;
      }
      if (this.vy > 1.2 || this.vy < -1.2) this.vy *= 0.99;
      moveAndCollide(this, game.world, this.vx, this.vy);
      return;
    }
    // ---- 离水（cs:24459-24474）----
    this.visAngle += this.vx * 0.1;
    if (this.vy === 0) {
      this.vx *= 0.98;
      if (Math.abs(this.vx) < 0.01) this.vx = 0;
    }
    this.vy = Math.min(this.vy + 0.2, 10);
    this.ai0 = 1;
    moveAndCollide(this, game.world, this.vx, this.vy);
  }

  /** 鱿鱼 221 FindFrame（NPC.cs:74652-74662，dispatch 在 jellyfishAI 之后调用
   *  ——原版 AI 先跑、FindFrame 后跑的同序）：狩猎态（localAI[2]==1，AI 侧 lai2）
   *  8t/帧【正向推进钳末帧不回卷】；慢速触发（localAI[0]==1，扑咬前瞬时近静止，
   *  AI 侧 lai0）一次性复位帧 0（扑咬帧）并清标志；非狩猎 13t/帧全帧循环。
   *  ★63/64/103/242 的 localAI[2] 是原版只写不读的死槽（G7 定谳 2026-08-19：
   *  水母攻击形帧走 ai[1]==1 潜伏门 :74615-74631，非 localAI[2]）——照写不读 */
  private squidFindFrame(): void {
    const frames = Math.max(1, this.vanilla?.frames ?? 1);
    this.npcFrameT += 1;
    if (this.lai2 === 1) {
      if (this.lai0 === 1) { this.customFrameIdx = 0; this.lai0 = 0; }
      if (this.npcFrameT >= 8) {
        this.npcFrameT = 0;
        this.customFrameIdx = Math.min(frames - 1, (this.customFrameIdx ?? 0) + 1);
      }
    } else if (this.npcFrameT >= 13) {
      this.npcFrameT = 0;
      this.customFrameIdx = ((this.customFrameIdx ?? 0) + 1) % frames;
    }
  }

  /** AI_022 幽灵族（NPC.cs:24726-25315 全量,2026-08-19 移动核重写）：
   *  成员 75 小精灵/82 幽魂/122 蜗牛怪/169 冰雪元素/182 浮空血肉/253 死神/
   *  268 脓水粘怪/316 墓园幽灵/330 骚灵/490 血滴怪。
   *  状态机（cs:24729-24811）：事件驱散门（330 非南瓜月/253 非日食/490 白天 →
   *  flag28 游荡）;ai[2] 锚点游荡（±16/±40 静止 60t → 背向玩家漂 200t）;移动核
   *  = 方向步进 X 0.1±cap[75→3/253/330→4/490→1.5,余 2] + Y 0.04±1.5（490 ±1）+
   *  flag31/32 悬浮-穿行（前方探测列 num310 深度内实心/液 → 上升,否则缓降）;
   *  collideX ×-0.4 / collideY ×-0.25 反弹。 */
  private ghostAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const vid = this.vanillaId ?? 0;
    // npc.rotation 默认 0（visAngle 类字段默认 π 是 EoC 语境）——169/268 之外
    // 的族员（幽灵/死神/骚灵等）原版不设 rotation
    if (!this.aiInit) { this.aiInit = true; this.visAngle = 0; }
    // ---- 点光（cs:24858-24860 蜗牛怪 / cs:24934-24936 冰雪元素，Center，恒亮）----
    if (vid === 122) this.lightRGB = [0.4, 0, 0.25];
    else if (vid === 169) this.lightRGB = [0, 0.6, 0.75];
    // ---- flag27（穿行/直落门）/ flag28（游荡离场）+ 事件驱散门（cs:24729-24748,
    //      审计 ghostAI 驱散门）：330 骚灵非南瓜月/253 死神非日食/490 血滴怪白天 ----
    let flag27 = false;
    let flag28 = false;
    if (vid === 330 && game.world.moonEvent.kind !== 2) flag28 = true;   // MOON_KIND_PUMPKIN
    if (vid === 253 && !game.world.clock.eclipse) flag28 = true;
    if (vid === 490 && game.world.clock.isDay) flag28 = true;
    if (this.justHit) this.ai2 = 0;                       // cs:24749-24752
    // ---- 316 墓园幽灵离场（cs:24753-24776）：玩家死/3000px 外——ai[3]==1 态
    //      Opacity −0.025/t 渐隐（≈alpha +6.375/t）至全隐自灭（NPCDeath55 首帧）;
    //      否则 EncourageDespawn(10) + 穿行 + 游荡 ----
    if (vid === 316 && player && (player.dead || Math.hypot(player.cx - this.cx, player.cy - this.cy) > 3000)) {
      if (this.ai3 === 1) {
        if (this.lai3 === 0) {
          this.lai3 = 1;
          game.playSfxFiles?.(['NPC_Killed_55'], 1, this.cx, this.cy);
        }
        flag28 = true;
        this.spawnAlpha = Math.min(255, this.spawnAlpha + 6.375);
        if (this.spawnAlpha >= 255) { this.dead = true; return; }   // active=false
      } else {
        this.encourageDespawn(10);
        flag27 = true;
        flag28 = true;
      }
    }
    // ---- 顶部状态机（cs:24777-24811）----
    if (flag28) {
      // 游荡：停住则随机取横向速度 rand(-1,2)×1.5
      if (this.vx === 0) this.vx = (Math.floor(Math.random() * 3) - 1) * 1.5;
    } else if (this.ai2 >= 0) {
      // 锚点游荡：距锚 X ±16（或速度与朝向相逆）/ Y ±40 → ai[2]++；
      // 静止满 60t → 背向玩家漂离 200t（ai[2]=-200）；出锚窗 → 重锚归零
      const flag29 = (this.x > this.ai0 - 16 && this.x < this.ai0 + 16)
        || (this.vx < 0 && this.facing > 0) || (this.vx > 0 && this.facing < 0);
      const flag30 = this.y > this.ai1 - 40 && this.y < this.ai1 + 40;
      if (flag29 && flag30) {
        this.ai2 += 1;
        // (cs:24795 `num307==16` 为反编译死条件——num307 已 +24,flag27 不在此置位)
        if (this.ai2 >= 60) {
          this.ai2 = -200;
          this.facing *= -1;
          this.vx *= -1;
        }
      } else {
        this.ai0 = this.x;
        this.ai1 = this.y;
        this.ai2 = 0;
      }
      if (player && !player.dead) {   // TargetClosest
        this.facing = this.seekDirX(player);
        this.dirY = player.cy > this.cy ? 1 : -1;
      }
    } else if (vid === 253) {
      // 死神：ai[2] 双速回落 + 每帧重瞄
      if (player && !player.dead) this.facing = this.seekDirX(player);
      this.ai2 += 2;
    } else {
      // 漂离期：direction = 背向玩家（cs:24806-24810）
      this.ai2 += vid === 330 ? 0.1 : 1;
      if (player) this.facing = player.cx > this.cx ? -1 : 1;
    }
    // ---- 探测列 + 各类型专属段（cs:24813-25054）----
    const probeX = Math.floor(this.cx / TILE) + this.facing * 2;   // num308
    const feetY = Math.floor((this.y + this.h) / TILE);            // num309
    let num310 = 3;                                                // 探测深度
    // 小精灵 75（cs:24900-24915）：尘 55 1/6 + 声 27 1/40;深度 4
    if (vid === 75) {
      num310 = 4;
      if (Math.random() < 1 / 6) {
        game.spawnParticles(this.cx, this.cy, '#FFE896', 1, 0.3, { life: 30, damp: 0.9, grav: 0 });
      }
      if (Math.floor(Math.random() * 40) === 0) {
        game.playSfxWav?.('Pixie', 1, this.cx, this.cy);
      }
    }
    // 蜗牛怪 122 充能机（1457 :24922-24975）：待机 localAI[1] >120 且 AI_GlobalFiring
    // DistanceCheck+视线 → 充能(ai[3]=1,受击清);充能满 64 归零;ai[3]==32 发粉激光 84
    // （速 7、伤 25、RotatedByRandom 散布）——★充能中无距离取消、开火无距离门
    // （1457 字面；曾自创 700px 取消/开火双门，R6-B 4-10 摘除）;深度 8
    const aimDX = player ? player.cx - this.cx : 0;
    const aimDY = player ? player.cy - this.cy : 0;
    const aimDist = Math.hypot(aimDX, aimDY) || 1;
    if (vid === 122) {
      num310 = 8;
      if (this.justHit) { this.ai3 = 0; this.lai1 = 0; }
      // ★SW-BJ34 2026-09-08：开火门补 `!Main.player[target].npcTypeNoAggro[type]`
      //  （1457 :24935；1456 :24868）——122 在 23 类表内,凝胶装着者不吃粉激光。
      if (this.ai3 === 32 && player && !npcTypeNoAggro(vid, player)) {
        const ang = Math.atan2(aimDY, aimDX) + (Math.random() - 0.5) * 0.157;
        const laser = new Dart(this.cx, this.cy, Math.cos(ang) * 7, Math.sin(ang) * 7, 25, 84);
        laser.hostile = true;
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities
          .add(laser, 'projectiles');
      }
      if (this.ai3 > 0) {
        this.ai3 += 1;
        if (this.ai3 >= 64) this.ai3 = 0;
      }
      if (this.ai3 === 0) {
        this.lai1 += 1;
        // 1457 :24949-24951 flag36 = AI_GlobalFiringDistanceCheck——超视野不充能
        // ★SW-BJ34 2026-09-08：充能门补 `!player7.npcTypeNoAggro[type]`
        //  （1457 :24969；1456 :24908）——凝胶在身不充能。
        if (this.lai1 > 120 && player && !player.dead
          && !npcTypeNoAggro(vid, player)
          && aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy)
          && this.canSeePlayer(st, player)) {
          this.lai1 = 0;
          this.ai3 = 1;
        }
      }
    }
    // 冰雪元素 169（cs:24916-24996）：α30 + 霜尘 1/3;朝向/rotation 取瞄准向量;
    // ai[3]==16 发霜爆 128（速 5、伤 45）;深度 10
    if (vid === 169) {
      num310 = 10;
      this.spawnAlpha = 30;
      if (Math.random() < 1 / 3) {
        game.spawnParticles(this.cx, this.cy, '#BDE8F5', 1, 0.3, { life: 30, damp: 0.9, grav: 0 });
      }
      if (this.justHit) { this.ai3 = 0; this.lai1 = 0; }
      const ax5 = (aimDX / aimDist) * 5, ay5 = (aimDY / aimDist) * 5;
      this.facing = ax5 > 0 ? 1 : -1;
      // 渲染端 aiStyle22 rotation 分支未接（visAngle=169 瞄准角,登记）
      this.visAngle = Math.atan2(this.facing < 0 ? -ay5 : ay5, this.facing < 0 ? -ax5 : ax5);
      if (this.ai3 === 16 && player && !player.dead) {
        this.spawnHostileProj(game, this.cx, this.cy, ax5, ay5, 45, 128);
      }
      if (this.ai3 > 0) {
        this.ai3 += 1;
        if (this.ai3 >= 64) this.ai3 = 0;
      }
      if (this.ai3 === 0) {
        this.lai1 += 1;
        if (this.lai1 > 120 && player && !player.dead && this.canSeePlayer(st, player)) {
          this.lai1 = 0;
          this.ai3 = 1;
        }
      }
    }
    // 脓水粘怪 268 金雨（cs:24997-25043）：rotation=vx×0.1;深度 = 玩家在下 ?6:12;
    // ai[3] 每 tick +1（受击 −45 且清 localAI[1]）,≥60+rand(60) 且有视线 → 喷
    // （速 10、伤 40、|dx|×0.1 下坠补偿、枪口 (cx−4, y+h×0.7)、散布 x±10/y−30..20）
    if (vid === 268) {
      num310 = player && player.cy > this.cy ? 6 : 12;
      this.visAngle = this.vx * 0.1;
      this.ai3 += 1;
      if (this.justHit) { this.ai3 = -45; this.lai1 = 0; }
      if (player && !player.dead && this.ai3 >= 60 + Math.floor(Math.random() * 60)
        && this.canSeePlayer(st, player)) {
        const ox = this.cx - 4, oy = this.y + this.h * 0.7;
        const tx = player.cx - ox + (Math.random() * 21 - 10);
        const ty = player.cy - oy - Math.abs(player.cx - ox) * 0.1 + (Math.random() * 51 - 30);
        this.shootDart(game, ox, oy, tx, ty, 10, 40, 288);
        this.ai3 = 0;
      }
    }
    // 血滴怪 490（cs:25044-25054）：深度 4 + 距离/70（帽 8）
    if (vid === 490 && player) {
      num310 = 4 + Math.min(8, Math.floor(aimDist / 70));
    }
    // ---- 垂直决策（cs:25055-25103）：flag31 悬浮缓降 / flag32 贴地标记 ----
    let flag31 = true;
    let flag32 = false;
    if (player && this.y + this.h > player.y) {
      // 自身在玩家顶以下才探测（330 恒穿行）
      if (vid === 330) flag31 = false;
      else {
        for (let ty = feetY; ty < feetY + num310; ty++) {
          if (!st.inBounds(probeX, ty)) break;
          if (st.isSolid(probeX, ty) || st.liquid[st.idx(probeX, ty)] > 0) {
            if (ty <= feetY + 1) flag32 = true;
            flag31 = false;
            break;
          }
        }
      }
    }
    // ★SW-BJ34 2026-09-08：no-aggro 垂直决策（1457 :25136-25154；1456 :25078-25096）
    //  ——`if (Main.player[target].npcTypeNoAggro[type])` 时重探探测列
    //  [feetY, feetY+num310-2)（深度比主探短 2 行）：有支承（实心/液）→
    //  directionY=-1 上浮 / 悬空 → +1 下落（=(!flag37).ToDirectionInt()），整段
    //  覆写 TargetClosest 的 dirY。表内成员仅 122 蜗牛怪（凝胶在身即悬停失的，
    //  不随玩家上下追）。越界格原版 null tile=nactive 假 → 无支承,同 continue。
    if (player && npcTypeNoAggro(vid, player)) {
      let flag37 = false;
      for (let ty = feetY; ty < feetY + num310 - 2; ty++) {
        if (!st.inBounds(probeX, ty)) continue;
        if (st.isSolid(probeX, ty) || st.liquid[st.idx(probeX, ty)] > 0) {
          flag37 = true;
          break;
        }
      }
      this.dirY = flag37 ? -1 : 1;
    }
    // 169/268 头顶 3 行内实心/液 → 直落下穿（flag27,cs:25076-25088）
    if (vid === 169 || vid === 268) {
      for (let ty = feetY - 3; ty < feetY; ty++) {
        if (!st.inBounds(probeX, ty)) continue;
        if (st.isSolid(probeX, ty) || st.liquid[st.idx(probeX, ty)] > 0) {
          flag32 = false;
          flag27 = true;
          break;
        }
      }
    }
    if (flag27) {
      flag32 = false;
      flag31 = true;
      if (vid === 268) this.vy += 2;
    }
    if (flag31) {
      // 悬浮缓降档
      if (vid === 75 || vid === 169) {
        this.vy += 0.2;
        if (this.vy > 2) this.vy = 2;
      } else if (vid === 490) {
        this.vy += 0.03;
        if (this.vy > 0.75) this.vy = 0.75;
      } else {
        this.vy += 0.1;
        if (vid === 316 && flag28) {          // 离场中的 316 恒升帽 6（净 +0.05/t）
          this.vy -= 0.05;
          if (this.vy > 6) this.vy = 6;
        } else if (this.vy > 3) this.vy = 3;
      }
    } else {
      if (vid === 75 || vid === 169) {
        if ((this.dirY < 0 && this.vy > 0) || flag32) this.vy -= 0.2;
      } else if (vid === 490) {
        if ((this.dirY < 0 && this.vy > 0) || flag32) this.vy -= 0.075;
        if (this.vy < -0.75) this.vy = -0.75;
      } else if (this.dirY < 0 && this.vy > 0) {
        this.vy -= 0.1;
      }
      if (this.vy < -4) this.vy = -4;
    }
    // ---- 75 wet 浮力（cs:25104-25109,审计 ghostAI wet）----
    if (vid === 75 && this.wet) {
      this.vy -= 0.2;
      if (this.vy < -2) this.vy = -2;
    }
    // ---- 碰撞反弹（cs:25114-25133）：collideX 旧速 ×−0.4 / collideY ×−0.25 +
    //      最小弹速 ±1（朝向门）——仅 tile 碰撞成员（253/316/330 noTileCollide 恒无碰撞） ----
    const ghost = !!this.vanilla?.noTileCollide;
    const oldVx = this.vx, oldVy = this.vy;
    if (ghost) {
      this.hitWall = false; this.hitHead = false; this.onGround = false;
      this.x += this.vx;
      this.y += this.vy;
    } else {
      moveAndCollide(this, game.world, this.vx, this.vy);
      if (this.hitWall) {
        this.vx = -oldVx * 0.4;
        if (this.facing === -1 && this.vx > 0 && this.vx < 1) this.vx = 1;
        if (this.facing === 1 && this.vx < 0 && this.vx > -1) this.vx = -1;
      }
      if (this.hitHead || this.onGround) {
        this.vy = -oldVy * 0.25;
        if (this.vy > 0 && this.vy < 1) this.vy = 1;
        if (this.vy < 0 && this.vy > -1) this.vy = -1;
      }
    }
    // ---- 水平步进（cs:25135-25190）：X 步 0.1 帽 per-type（75→3/253/330→4/
    //      490→1.5/余 2）,二档同帽步 0.1、逆向修正 0.05 ----
    let cap = 2;
    if (vid === 75) cap = 3;
    if (vid === 253) cap = 4;
    if (vid === 490) cap = 1.5;
    if (vid === 330) {
      cap = 4;
      this.spawnAlpha = 0;
      if (flag28) this.encourageDespawn(10);
      else if (player && !player.dead) this.facing = this.seekDirX(player);   // TargetClosest
      if (this.facing < 0 && this.vx > 0) this.vx *= 0.9;
      if (this.facing > 0 && this.vx < 0) this.vx *= 0.9;
    }
    if (this.facing === -1 && this.vx > -cap) {
      this.vx -= 0.1;
      if (this.vx > cap) this.vx -= 0.1; else if (this.vx > 0) this.vx += 0.05;
      if (this.vx < -cap) this.vx = -cap;
    } else if (this.facing === 1 && this.vx < cap) {
      this.vx += 0.1;
      if (this.vx < -cap) this.vx += 0.1; else if (this.vx < 0) this.vx -= 0.05;
      if (this.vx > cap) this.vx = cap;
    }
    // ---- 垂直步进（cs:25191-25315）：Y 步 0.04 帽 ±1.5（490 ±1）----
    const capY = vid === 490 ? 1 : 1.5;
    if (this.dirY === -1 && this.vy > -capY) {
      this.vy -= 0.04;
      if (this.vy > capY) this.vy -= 0.05; else if (this.vy > 0) this.vy += 0.03;
      if (this.vy < -capY) this.vy = -capY;
    } else if (this.dirY === 1 && this.vy < capY) {
      this.vy += 0.04;
      if (this.vy < -capY) this.vy += 0.05; else if (this.vy < 0) this.vy -= 0.03;
      if (this.vy > capY) this.vy = capY;
    }
  }

  /** AI_122 海盗幽灵 662（NPC.cs:45177-45210 1:1；SetDefaults :17302-17317
   *  noGravity+noTileCollide+lavaImmune+trapImmune——此前误落 default zombieAI 成
   *  地面怪，2026-08-17 修正）：
   *  - localAI[0]==0 → 一次性出场音 NPCHit6（:45179-45183）；
   *  - 失标（玩家死亡/无效，TargetClosest 后仍无目标，:45184-45202）：velocity×0.9、
   *    alpha +5/t 渐隐，至 255 → StrikeNPCNoInteraction(9999) 自灭；
   *  - 有标：alpha −5/t 渐显（:45204）；targetPos = 指向玩家向量限长 4
   *    （Vector2.Zero.MoveTowards(Δ,4)），velocity 以 2/15 步进趋近（MoveTowards）；
   *  - 同型互斥（:45206-45219）：50px 内另一只 662 → velocity −= unit×0.1、
   *    X 再 −= unit.X×1（合计 X 推离 0.2 / Y 0.1）；
   *  - noGravity+noTileCollide → 无重力直接积分位移（ghostAI 同款先例）。
   *  FindFrame case 122（:74305，spriteDirection/rotation=vx×0.05/8t 三帧）渲染侧
   *  未接，登记。 */
  private pirateGhostAI(game: GameHooks, player: Player | null) {
    const x = lunarLocalAI(this);
    if (x[0] === 0) {
      x[0] = 1;
      game.playSfxFiles?.(['NPC_Hit_6'], 1, this.cx, this.cy);
    }
    if (!player) {
      this.vx *= 0.9;
      this.vy *= 0.9;
      this.spawnAlpha = Math.min(255, this.spawnAlpha + 5);
      if (this.spawnAlpha >= 255) this.hurt(9999, 0, 0, game); // 走标准死亡管线
      return;
    }
    this.spawnAlpha = Math.max(0, this.spawnAlpha - 5);
    const dx = player.cx - this.cx, dy = player.cy - this.cy;
    const d = Math.hypot(dx, dy);
    const tx = d > 4 ? (dx / d) * 4 : dx;   // MoveTowards(Zero, Δ, 4)：限长 4
    const ty = d > 4 ? (dy / d) * 4 : dy;
    const step = 2 / 15;                    // velocity.MoveTowards(targetPos, 2/15)
    const mv = (cur: number, tgt: number) => {
      const diff = tgt - cur;
      return Math.abs(diff) <= step ? tgt : cur + Math.sign(diff) * step;
    };
    this.vx = mv(this.vx, tx);
    this.vy = mv(this.vy, ty);
    for (const o of game.enemies() as Enemy[]) {
      if (o === this || o.dead || o.vanillaId !== 662) continue;
      const ox = o.cx - this.cx, oy = o.cy - this.cy;
      const od = Math.hypot(ox, oy);
      if (od > 0 && od < 50) {
        const ux = (ox / od) * 0.1, uy = (oy / od) * 0.1;
        this.vx -= ux; this.vx -= ux;   // −unit×0.1 后 X 再 −unit.X×1 → X 合计 0.2
        this.vy -= uy;
      }
    }
    // ★BJ588 销案锚：原版 AI_122 方法体（NPC.cs:45329-45456 亲读）spriteDirection/
    //  rotation/direction 全零写点——662 的显示面唯一来源=FindFrame case 662 组支
    //  （:75648-75655 死区档）。本行为本仓自有的 direction 侧写（vx 符号死区档,
    //  值恒等 FindFrame 写面）——渲染镜像已收编至 findFrameRotation FF_VXSDIR_GROUP
    //  族支（e.ffSdir,AI 后一拍 ≙ 原版 FindFrame :91626 位置）,显示面以 ffSdir 为准,
    //  本行仅存续 facing=direction 侧写（behaviorlog）。
    if (this.vx !== 0) this.facing = this.vx > 0 ? 1 : -1;
    this.x += this.vx;
    this.y += this.vy;
  }

  /** AI_024 鸟（NPC.cs:25396-25622 1:1）：三态——0 地面站立 / 1 飞行 / 2 降落。
   *  鸮族(611/689)专属：出生即飞行；夜间栖息城镇 NPC 屋檐(ai0=2)；689 夜间
   *  玩家 <80px 有视线 → Transform(317 魔眼)。
   *  飞行：X 轴 0.1 步进,帽 3(丛林鸟 671-675 帽 4,:25495-25499);Y 轴前方
   *  下探 15 格——全空 vy+=0.05 缓沉,受阻 vy-=0.1,近障 5 格内再 -0.2(:25568-25605);
   *  撞墙 direction 反转 + 旧速×-0.5(最小 ±(cap-1)/±1);湿态上浮(:25596-25610)。
   *  鸟粪彩蛋（:25459-25467，BirdThatCanPoop 表 NPCID.cs:4779 = 74/297/298/442/
   *  363/365/603/609/671-675）：飞行态 + localAI[3]==0 + 鸟 Center.X 落在玩家
   *  水平带内 + 玩家在鸟下方 + CanHit + 玩家 RollOnlyBadLuckExtreme(50)==0
   *  （1/50 极端霉运或 IsThisCenx 四名,2026-08-19 补）→ localAI[3]=1 + 弹 1080
   *  落在 (玩家.Center.X, 鸟.Center.Y)。★:34863 aiStyle 68 飞行鸭同款 10 行
   *  在 duckFlyAI（非本函数域，未移植——登记） */
  private birdAI(game: GameHooks, player: Player | null) {
    // ai0===0/2 等值门：类默认 -1120 全空转 = 鸟永久滞空（地面/降落态成死代码）
    if (this.ai0 < 0) this.ai0 = 0;
    const st = game.world.store;
    const oldVx = this.vx, oldVy = this.vy;
    const id = this.vanillaId ?? 0;
    const owl = id === 611 || id === 689;
    const day = game.world.clock.isDay;
    const cloud = (game.world.weather.cloudAlpha ?? 0) > 0;
    // ---- 鸟粪彩蛋（:25459-25467）----
    if (this.ai0 === 1 && BIRD_THAT_CAN_POOP.has(id) && this.lai3 === 0 && player && !player.dead) {
      if (this.cx >= player.x && this.cx <= player.x + player.w
        && player.y > this.y + this.h
        && canHit(st, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)
        && (rollOnlyBadLuckExtreme((player as unknown as { luck: number }).luck, 50) === 0
          || isThisCenx((player as unknown as { name?: string }).name))) {
        this.lai3 = 1;
        game.spawnCritterProj?.(new PoopProj(player.cx, this.cy));
      }
    }
    // ---- 鸮族专属段（:25408-25451）----
    // 689 夜间玩家 <80px 有视线 → Transform(317 魔眼)（:25409-25416）
    if (id === 689 && !day && player && !player.dead
      && Math.hypot(player.cx - this.cx, player.cy - this.cy) < 80
      && canHit(st, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)) {
      this.tryTransformTo(317, st, false, game);
      return;
    }
    // 出生即飞行（localAI[0]==0 → TargetClosest+ai[0]=1,:25410-25416）
    if (owl && !this.owlAirborneInit) {
      this.owlAirborneInit = true;
      this.ai0 = 1;
      if (player) this.facing = player.cx > this.cx ? 1 : -1;
    } else if (owl && this.ai0 === 1 && !cloud && !day) {
      // 夜间晴空栖息轮（:25426-25451）：城镇 NPC 下方（|dx|<96、dy 32-320、无视线）
      // → ai0=2 降落栖息；同型非飞行个体 320px 内 → 回 ai0=1 防扎堆
      for (const n of (game.npcs?.() ?? []) as Array<{ x: number; y: number; w: number; h: number; dead?: boolean }>) {
        if ((n as { dead?: boolean }).dead) continue;
        const ncx = n.x + n.w / 2, ncy = n.y + n.h / 2;
        if (Math.abs(this.cx - ncx) < 96) {
          const dy = ncy - this.cy;
          if (dy > 32 && dy < 320
            && !canHit(st, this.x, this.y, this.w, this.h, n.x, n.y, n.w, n.h)) {
            this.ai0 = 2;
          }
        }
      }
      for (const c of (game.critters?.() ?? []) as Array<{ cx?: number; x?: number; w?: number; vanillaId?: number; ai0?: number; dead?: boolean }>) {
        if ((c as { dead?: boolean }).dead || c === (this as unknown) || c.vanillaId !== id || c.ai0 === 1) continue;
        const ccx = (c.cx ?? (c.x ?? 0) + (c.w ?? 0) / 2);
        if (Math.abs(this.cx - ccx) < 320) { this.ai0 = 1; break; }
      }
    }
    if (this.ai0 === 0) {
      // 地面态（NPC.cs:25453-25481 1:1）：重力站立，**不踱步**——原版 vx 恒 0
      // （降落态 :25488 归零后不再赋值），FindFrame 站定门 vx==0&&vy==0 → 站立帧。
      // 曾自创 ±0.7 随机踱步 → vx 永不为 0，地面恒播飞行动画（2026-08-18 报）。
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
      // 鸮族白天/阴天自动起飞（:25456-25459）——不翻向不设速
      if (owl && (day || cloud)) {
        this.ai0 = 1;
      } else if (this.vx !== 0 || this.vy < 0 || this.vy > 0.3) {
        // 被释放/被推动 → 起飞 + 翻向（:25463-25468；releaseOwner 未建字段,
        // 释放路径落速即触发生效）
        this.ai0 = 1;
        this.facing = -(this.facing || 1);
      } else if (!owl && player && !player.dead) {
        // 玩家进 ±100px 盒（:25472 position-100±(w+200) 相交）或受伤 → 起飞：
        // vy-=6 + direction 翻转（TargetClosest 朝玩家后取反 = 远离玩家）
        const near = player.x < this.x + this.w + 100 && player.x + player.w > this.x - 100
          && player.y < this.y + this.h + 100 && player.y + player.h > this.y - 100;
        if (near || this.hp !== this.maxHp) {
          this.ai0 = 1;
          this.vy -= 6;
          this.facing = player.cx > this.cx ? -1 : 1;
        }
      }
    } else if (this.ai0 === 2) {
      // 降落态（:25482-25493）：vx×0.98 缓降 vy+0.05 帽 2;落地（vy==0 检查在重力前,
      // onGround 旗标等价）→ 回地面态 + vx 归零（站定门的保证）
      this.vx *= 0.98;
      this.vy = Math.min(this.vy + 0.05, 2);
      moveAndCollide(this, game.world, this.vx, this.vy);
      if (this.onGround) { this.ai0 = 0; this.vx = 0; }
    } else if (player && !player.dead) {
      // 飞行态（:25495-25595;目标玩家死亡时跳过 steering——但原版共享积分段
      // （:93808）仍按冻结速度滑行,本仓无共享积分 → 死亡时补"只积分"分支,
      // 否则鸟空中冻结成雕像,审计 A1,2026-08-19）
      const dir = this.facing;
      const cap = (id >= 671 && id <= 675) ? 4 : 3;   // num356:丛林鸟 4 其余 3
      if (dir === -1 && this.vx > -cap) {
        this.vx -= 0.1;
        if (this.vx > 0) this.vx -= 0.05;
        if (this.vx < -cap) this.vx = -cap;
      } else if (dir === 1 && this.vx < cap) {
        this.vx += 0.1;
        if (this.vx < 0) this.vx += 0.05;
        if (this.vx > cap) this.vx = cap;
      }
      // Y 轴：前方 15 格下探（:25568-25602）
      const aheadX = Math.floor(this.cx / TILE) + dir;
      const footY = Math.floor((this.y + this.h) / TILE);
      let allClear = true, nearBlock = false;
      for (let k = 0; k < 15; k++) {
        const yy = footY + k;
        if (yy >= st.h) continue;
        if (st.isSolid(aheadX, yy) || st.liquid[st.idx(aheadX, yy)] > 0) {
          if (k < 5) nearBlock = true;
          allClear = false;
          break;
        }
      }
      if (allClear) this.vy += 0.05;
      else this.vy -= 0.1;
      if (nearBlock) this.vy -= 0.2;
      this.vy = Math.max(-4, Math.min(2, this.vy));
      moveAndCollide(this, game.world, this.vx, this.vy);
      if (this.hitWall) {
        this.facing *= -1;
        this.vx = -oldVx * 0.5;
        if (this.facing === -1 && this.vx > 0 && this.vx < cap - 1) this.vx = cap - 1;
        if (this.facing === 1 && this.vx < 0 && this.vx > -(cap - 1)) this.vx = -(cap - 1);
      }
      if (this.hitHead || this.onGround) {
        this.vy = -oldVy * 0.5;
        if (this.vy > 0 && this.vy < 1) this.vy = 1;
        if (this.vy < 0 && this.vy > -1) this.vy = -1;
      }
    } else {
      // 玩家死亡（飞行态）：只积分不 steering（原版共享积分段 :93808 语义）
      moveAndCollide(this, game.world, this.vx, this.vy);
    }
    // 湿态上浮（:25596-25610,三态通用）：ai[1]=0 + vy>0×0.95 + vy-=0.5 钳 -4
    //  + TargetClosest（朝玩家）
    if (this.wet) {
      this.vy = (this.vy > 0 ? this.vy * 0.95 : this.vy) - 0.5;
      if (this.vy < -4) this.vy = -4;
      if (player && !player.dead) this.facing = player.cx > this.cx ? 1 : -1;
    }
  }

  /** AI_065 蝴蝶族（AI_065_Butterflies cs:45231-45458）1:1：ai[0]/ai[1]=目标速度分量
   *  （漂移重选计时 localAI[0] = Next(90,240)=90-239 帧，:45315——曾 60-179）；
   *  近距构型 ±100/±100 分量归一 × Next(26,301)×0.01（0.26-3.00）；|ΔX|>700 且
   *  localAI[3]==0 时远距构型（direction×Next(100,251)+Y 偏置，三档速 0.5-2.0）；
   *  ai[3]=随机 scale Next(75,111)×0.01；平滑 v=(v×59+目标)/60；
   *  垂直避障：vy>0 中心列 [cy,cy+3) 三行逐格（实心/液 → 翻目标+vy×0.9，:45356-45371
   *  ——曾 5 行）、vy<0 下 30 行无实心 → 同款（:45373-45393）；
   *  避敌（localAI[1] 门 15t / 661 → 10t，:45395-45427）：zero=Σ单位向/count×2 叠到
   *  【实际速度】钳 16（曾加在目标上）；collideX → 目标翻离墙侧 + vx×−0.2。
   *  ★661 帝皇蝶 ai2 = 离神圣渐隐计数（cs:45253，专用——见 lacewingFadeStep），
   *  漂移计时对该 id 移 lai0（= 原版 localAI[0]）。653 地狱蝴蝶尾段：恒亮 + 1/60 尘 6。 */
  private butterflyAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    if (!this.aiInit) { this.aiInit = true; this.ai0 = 0; this.ai1 = 0; this.ai2 = 0; }
    const isLacewing = this.vanillaId === 661;
    // ---- 物种槽（cs:45292-45307）：ai[2]==0 且非 661 → 加权掷八物种
    //  （Next(100) 映射:1%→5/2%→1/6%→2/10%→7/15%→3/19%→6/25%→0/其余 22%→4），
    //  ai[2]=1+物种；释放入口带 Style 直存（ReleaseNPC case 356 ai[2]=Style——
    //  捕获物 1994-2001 → placeStyle=1+item-1994）不掷 ----
    if (!isLacewing && this.ai2 < 1) {
      const r100 = Math.floor(Math.random() * 100);
      const sp = r100 === 0 ? 5 : r100 < 3 ? 1 : r100 < 9 ? 2 : r100 < 19 ? 7
        : r100 < 34 ? 3 : r100 < 53 ? 6 : r100 >= 75 ? 0 : 4;
      this.ai2 = 1 + sp;
    }
    // ---- 点光（AI_065_Butterflies，NPC.cs:45389 实文）----
    if (isLacewing) {
      // :45389 光皇蝴蝶：hslToRgb(GlobalTimeWrappedHourly×0.33 % 1, 1, 0.5)×0.3
      //  + 白 0.1。★BJ330 二次窗口（BJ327 归队后补齐）：原 (visEffectFrames()/54000)×0.33
      //  系把 GTW 误读进 Main.time 域（54000=昼夜全长 tick 数,且 GTW 本非游戏内钟）,
      //  色相周期被拉长 ~900×（≈45.5min vs 原版 1/0.33≈3.03s 一轮）——今 1:1 校准并入
      //  GameTime 单源（hslToRgb 内含 ((h%1)+1)%1 包绕,%1 显式照抄原版表达式）。
      const [hr, hg, hb] = hslToRgb(globalTimeWrappedHourly() * 0.33 % 1, 1, 0.5);
      this.lightRGB = [hr * 0.3 + 0.1, hg * 0.3 + 0.1, hb * 0.3 + 0.1];
    } else if (this.vanillaId === 653) {
      this.lightRGB = [0.6, 0.3, 0.1];      // :45448-45453 地狱蝴蝶恒亮 + 尘 6 号 1/60
    }
    // ---- 661 渐隐计数（cs:45235-45291，段内 return = 原版 active=false 消散）----
    if (isLacewing) {
      let cap = 50;                                            // num4（cs:45242）
      // cs:45244-45247：目标失效或中心距 ≥300 → 渐隐（本仓目标=主角，死亡由分发传 null）
      let fading = !player
        || Math.hypot(player.cx - this.cx, player.cy - this.cy) >= 300;
      // cs:45248-45252：非 remix 世界且目标玩家不在神圣 → 上限抬 60 且渐隐
      //（scene 缺席按"在神圣"处理——不因快照缺失误触发渐隐）
      // ★IIIII224：补 !remixWorld 门——remix 世界 661 不渐隐（原注释"本仓无 remix"陈旧）
      if (player && game.scene && !game.scene.zoneHallow && !game.world.seedFlags?.remix) { cap = 60; fading = true; }
      const f = lacewingFadeStep(this.ai2, fading, cap);
      this.ai2 = f.ai2;
      if (f.despawn) { this.dead = true; return; }             // cs:45254-45262
      this.spawnAlpha = Math.round((1 - f.opacity) * 255);     // cs:45263 Opacity → alpha
      this.dontTakeDamage = this.ai2 >= cap / 2;               // cs:45290 渐隐过半不可击
      if (this.ai2 > 0 && Math.floor(Math.random() * 5) === 0) {
        // cs:45264-45289 尘 267 双份（彩虹原色 + 半幅白叠）→ 单粒近似
        game.spawnParticles(this.cx, this.cy, '#E8B0FF', 1, 0.5, { life: 30, damp: 0.94 });
      }
    }
    // 漂移目标重选（计时槽 = localAI[0]（cs:45312 lai0 递减，Next(90,240)=90-239——
    //  曾 60-179）；ai[2] 留给蝴蝶物种/661 渐隐）
    const driftGet = (): number => this.lai0;
    const driftSet = (v: number): void => { this.lai0 = v; };
    // ai[3] = 随机 scale Next(75,111)×0.01（:45308-45311）+ scale = ai[3]（:45352）
    if (this.ai3 === 0) {
      this.ai3 = (75 + Math.floor(Math.random() * 36)) * 0.01;
      this.vanillaScale = this.ai3;
    }
    let n0 = this.ai0, n1 = this.ai1;    // num/num2（:45233-45234）
    driftSet(driftGet() - 1);
    if (driftGet() <= 0) {
      // TargetClosest 定向（远距构型用）
      let dir = this.facing;
      if (player && !player.dead) dir = player.cx >= this.cx ? 1 : -1;
      this.facing = dir;
      const dx = player ? Math.abs(player.cx - this.cx) : 0;
      if (dx > 700 && this.lai3 === 0) {
        // 远距构型（:45318-45338）：三档速 + direction×Next(100,251)（+下方偏置）
        let spd = (50 + Math.floor(Math.random() * 101)) * 0.01;
        if (dx > 1000) spd = (150 + Math.floor(Math.random() * 51)) * 0.01;
        else if (dx > 850) spd = (100 + Math.floor(Math.random() * 51)) * 0.01;
        const vx0 = dir * (100 + Math.floor(Math.random() * 151));
        let vy0 = -50 + Math.floor(Math.random() * 101);
        if (player && this.y > player.y - 100) vy0 -= 100 + Math.floor(Math.random() * 151);
        const inv = spd / Math.hypot(vx0, vy0);
        n0 = vx0 * inv;
        n1 = vy0 * inv;
      } else {
        // 近距构型（:45339-45348）：localAI[3]=1 锁定；±100 分量归一 × Next(26,301)×0.01
        this.lai3 = 1;
        const spd = (26 + Math.floor(Math.random() * 275)) * 0.01;
        const vx0 = -100 + Math.floor(Math.random() * 201);
        const vy0 = -100 + Math.floor(Math.random() * 201);
        const inv = spd / Math.hypot(vx0, vy0);
        n0 = vx0 * inv;
        n1 = vy0 * inv;
      }
      driftSet(90 + Math.floor(Math.random() * 150));    // Next(90,240)（:45315）
    }
    // ---- 平滑逼近（:45353-45355，系数 60）----
    this.vx = (this.vx * 59 + n0) / 60;
    this.vy = (this.vy * 59 + n1) / 60;
    // ---- 垂直避障（:45356-45394：vy>0 中心列 [cy,cy+3) 三行逐格；vy<0 下 30 行无实心）----
    const cx = Math.floor(this.cx / TILE), cy = Math.floor(this.cy / TILE);
    if (this.vy > 0) {
      for (let j = cy; j < cy + 3; j++) {
        if (st.inBounds(cx, j) && (st.isSolid(cx, j) || st.liquid[st.idx(cx, j)] > 0)) {
          n1 = -n1;
          if (this.vy > 0) this.vy *= 0.9;
        }
      }
    }
    if (this.vy < 0) {
      let ground = false;
      for (let j = cy; j < cy + 30; j++) {
        if (st.inBounds(cx, j) && st.isSolid(cx, j)) ground = true;
      }
      if (!ground) {
        n1 = -n1;
        if (this.vy < 0) this.vy *= 0.9;
      }
    }
    // ---- 避敌（:45395-45427，localAI[1] 门：15t / 661 → 10t）：zero=Σ单位向/count×2
    //      叠到【实际速度】（曾加在 ai0/ai1 目标上）钳 16；只扫敌怪不扫玩家 ----
    if (this.lai1 > 0) {
      this.lai1 -= 1;
    } else {
      this.lai1 = isLacewing ? 10 : 15;
      let count = 0, ux = 0, uy = 0;
      const boxDist = (b: { x: number; y: number; w: number; h: number }): number => {
        const qx = Math.max(b.x, Math.min(this.cx, b.x + b.w));
        const qy = Math.max(b.y, Math.min(this.cy, b.y + b.h));
        return Math.hypot(this.cx - qx, this.cy - qy);
      };
      for (const o of game.enemies()) {
        const e = o as Enemy;
        if (e === this || e.dead || e.def.damage <= 0 || !!e.vanilla?.friendly) continue;
        if (boxDist(e) <= 100) {
          const d = Math.hypot(this.cx - e.cx, this.cy - e.cy) || 1;
          count++; ux += (this.cx - e.cx) / d; uy += (this.cy - e.cy) / d;
        }
      }
      if (count > 0) {
        this.vx += (ux / count) * 2;
        this.vy += (uy / count) * 2;
        const spd = Math.hypot(this.vx, this.vy);
        if (spd > 16) { this.vx = (this.vx / spd) * 16; this.vy = (this.vy / spd) * 16; }
      }
    }
    const oldVx = this.vx;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) {
      // collideX（:45428-45432）：目标翻离墙侧（按 vx 符号）+ vx×−0.2（不重置漂移计时）
      n0 = this.vx < 0 ? Math.abs(n0) : -Math.abs(n0);
      this.vx = oldVx * -0.2;
    }
    this.facing = this.vx > 0 ? 1 : -1;
    this.ai0 = n0;
    this.ai1 = n1;
    // 653 地狱蝴蝶尾段（:45447-45456）：恒亮 + 1/60 播尘 6（零速粒子）
    if (this.vanillaId === 653 && Math.floor(Math.random() * 60) === 0) {
      game.spawnParticles(this.cx, this.cy, '#FFB060', 1, 0, { life: 26 });
    }
  }

  /** 小动物路由：按 aiStyle 精确分流到各家族 1:1 实现（AI_001/016 复用既有精确 AI） */
  private critterWanderAI(game: GameHooks, player: Player | null) {
    switch (this.vanilla?.aiStyle ?? 0) {
      case 24: this.birdAI(game, player); return;                        // AI_024 鸟
      case 1: this.slimeAI(game, player); return;                         // AI_001 蚱蜢（含专属差异项）
      case 16: this.swimAI(game, player); return;                         // AI_016 鱼类小动物（含河鲀/海豚特化）
      case 64: this.fireflyAI(game, player); return;                      // AI_064 萤火虫
      case 65: this.butterflyAI(game, player); return;                    // AI_065 蝴蝶
      case 66: this.wormCritterAI(game); return;                          // AI_066 蠕虫
      case 67: this.snailAI(game); return;                                // AI_067 蜗牛
      case 68: this.duckFlyAI(game, player); return;                      // AI_068 鸭飞形
      case 112: this.fairyAI(game, player); return;                       // AI_112 仙灵
      case 113: this.windyBalloonAI(game, player); return;                // AI_113 风气球（cs:43036 挂史莱姆）
      case 114: this.dragonflyAI(game, player); return;                   // AI_114 蜻蜓
      case 119: this.dandelionAI(game, player); return;                   // AI_119 蒲公英（cs:43254 喷籽）
      case 115: this.ladybugAI(game, player); return;                     // AI_115 瓢虫/椿象
      case 116: this.waterStriderAI(game); return;                        // AI_116 水黾
      case 118: this.seahorseAI(game); return;                            // AI_118 海马
      default: this.townCritterWalkAI(game, player); return;              // AI_007 小动物行走
    }
  }

  /** AI_007 小动物行走（NPC.cs:53366-54711 的 TownCritter 路径，isLikeATownNPC=false
   *  → 无对话/坐姿/开门/城镇史莱姆支；homeTileY 恒 −1 → flag22 恒 true → StepDown
   *  永不跑（stepDownGate='never'——★BJ703-C D1 后 'never' 只辖 StepDown,WalkDownSlope
   *  预备阶段照跑=原版 :93667）、StepUp holdsMatching 恒 true）。
   *  速度表（cs:54280-54328）：默认 1/0.07；爆炸兔(614) 危险档 1.5/0.1（:54427-54431
   *  档头，★BJ703-C D3）；松鼠族(299/538/539/639-645) 1.5；
   *  龟(616/617/625) 陆 0.5、湿 2/acc1（625 覆写：湿 2.5、干 0.2）；鼠(300/447/610)
   *  2/1；逃逸/溺水加成（friendly&&(flag16||flag21)，:54467-54473）＝1.5+残血×0.9/0.1
   *  （覆写族表；★BJ703-C D3 勘误：野生小动物 friendly 恒【假】——npcCatchable 每
   *  tick 强制清旗 :91649-91670 → 该档野生面不触发=原版语义,释放后 90t 窗未建模
   *  登记债 D10）。青蛙湿身（:54334-54344）：|v|<0.05 补 maxX×10 一窜，否则 ×0.9
   *  ——替代常规加速。超帽减速 = 向量 ×0.8（:54345-54351）。
   *  节奏：站→走 200+Next(300)+Next(200,400)=400-898（:54156-54168，蛙湿身
   *  700-899 :54049-54056；泡水逃离同式 :54136-54151）；走→站 300+Next(300)−Next(100)
   *  =201-599（:54232-54244）；走计时溺水冻结（:54216-54231 flag21）+ 离家 >35 格
   *  逆行每 tick 额外 −5（:54219-54229）。
   *  台阶跳三档（:54471-54627，★探测行 num27=脚上一行）：t5=num27−2 实心（小个子
   *  免 t4 联检）→ 后方+前柱净空 → vy=−6（净空堵 → 鼠类查中心前一格实心转身、其余
   *  掉头/危险僵立）；t4=num27−1 实心 → vy=−5；沉入 >20px 且 num27 非坡实心 →
   *  vy=−4.4 半砖档；上升 ×1.2（湿身恒乘、TownCritter 非鼠再乘，:54619-54626）。
   *  跳点回位（:54450-54455）：落地 X 与 localAI[3](跳时 position.X) 相等 → 掉头。
   *  家域约束（:54179-54202，站立即）：晴日（!flag）或正踩家格 → 超家 25 格外仍
   *  逆行 50 格回头；家 ±25 格内 1/80 随机翻向（localAI[3]=200 锁）。
   *  危险扫描（:53884-54028，每 tick）：200px 内敌怪（黑化松鼠族/690 豁免）+CanHit
   *  → num15 双侧最近者；僵立态背向险 → 复走 300-599；非走态 → 走 120-239 + 背向；
   *  走态仅调向（不重置计时）。僵立 ai0=8（:54682-54711）：v×0.8 计时归零回站，
   *  险情续命 180。
   *  钉水面（cs:55706-55750 flag12&&wet，1456 旧注 :55574-55612 漂移）：龟/蛙
   *  Center 钉 GetWaterLine 液面（蛙走计时→50）;★G6 R3-P2⑤ 重力后移钉面后
   *  （原版序=AI 内钉面/AI 外重力 :91579-83,旧重力先行=钳界 ±0.2/tick 差）。
   *  ★G6 D12 避坠（GetWalkPrediction :56241——TownCritter :56268 恒 false=41 型
   *  零扰动,唯 614 真值）：三消费位=遇险起步门 :54136/站立起走门 :54280（悬崖
   *  边计时到点改掉头 60-179）/行走前视 :54534（支撑≤2 停走 50-99+40 / 前视无墙
   *  但会坠（岩浆列）掉头）;★G6 D13 卡墙折返（:54789-54804 无位移+速度仅差重力
   *  连续 31 拍 → 续走+双翻,快照=moveAndCollide 前）。
   *  鸭/海鸥/鷿鷈行走形(362/364/602/608)：wet（碰撞盒）或 |vy|>4 → Transform(+1) 飞形（cs:53585） */
  private townCritterWalkAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const vid = this.vanillaId ?? 0;
    // ---- 松鼠黑化彩蛋（NPC.cs:53797-53812）：CritterThatCanTurnOnPlayers
    //  （NPCID.cs:4779 = 松鼠 299/红 538/金 539 + 宝石松鼠 639-645）玩家 CanHit
    //  内 RollOnlyBadLuckExtreme(3000)==0 → ai[3]=2 → lifeMax 25/防+6/伤 20/
    //  aiStyle=3 反咬（永久转战士；IsThisCenx 彩蛋不移植）----
    if (CRITTER_TURN_ON_PLAYERS.has(vid)) {
      if (this.ai3 !== 2 && player && !player.dead
        && canHit(st, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)
        && rollOnlyBadLuckExtreme((player as unknown as { luck: number }).luck, 3000) === 0) {
        this.ai3 = 2;
      }
      if (this.ai3 === 2) {
        this.blackenedCritter = true;     // ★F2：运行时翻转位（等价原版 aiStyle=3 写入）
        if (this.maxHp === 5) {           // lifeMax==5 门（一次性升级）
          this.maxHp = 25;
          this.hp = 25;
          this.def.defense = (this.def.defense ?? 0) + 6;   // defense 可选字段,复合赋值须空合并
          this.def.damage = 20;
        }
        this.fighterAI(game, player);     // aiStyle=3 转战士核
        return;
      }
    }
    // 687 神秘青蛙点光（NPC.cs:55974-55979：type==683||687 → (0.25,0.25,0.1)×
    //  Utils.WrappedLerp(0.75,1,t%120/120)；683 黄城镇史莱姆在 TownNPC 桶自报）
    if (vid === 687) {
      const p120 = (visEffectFrames() % 120) / 120;
      const tri = p120 * 2 > 1 ? 2 - p120 * 2 : p120 * 2;
      const l = 0.75 + 0.25 * tri;
      this.lightRGB = [0.25 * l, 0.25 * l, 0.1 * l];
    }
    if (this.ai0 < 0 || this.ai0 > 8) this.ai0 = 0;
    if (this.ai1 < 0) this.ai1 = 0;   // 初值 0（原版出生即走;曾 100 站立）
    const turtle = vid === 616 || vid === 617 || vid === 625;   // flag8 乌龟免危险扫描（:53857/:53884）
    const rat = vid === 300 || vid === 447 || vid === 610;      // flag7 鼠类
    const frog = vid === 361 || vid === 445 || vid === 687;     // flag9 蛙族
    const squirrel = vid === 299 || vid === 538 || vid === 539 || (vid >= 639 && vid <= 645);
    const canBreathe = turtle || frog;   // flag11/flag12：龟蛙水中呼吸（免溺水逃离/钉面）
    // ★BJ704-G3 D7：NPCID.Sets.TownCritter（NPCID.cs:4827,TOWN_CRITTER_IDS 单源）——
    //   计时器三闸+夜间即停支的集判据。敌怪侧 aiStyle7 达此的 42 型中唯 614 爆炸兔
    //   非集成员（城商族走 TownNPC 桶不达）→ 起走短计时/站立长计时+夜间归家即停。
    //   avoidFalling 面（GetWalkPrediction :56241——TownCritter 恒 false :56268,
    //   614 真值）★BJ704-G6 D12 已接通（npcWalkPrediction.ts 共享叶子,三消费位
    //   :54136 危险起步门/:54280 站立起走门/:54534 行走前视→悬崖停走+避坠掉头）
    const townCritter = TOWN_CRITTER_IDS.has(vid);
    // ---- homeTile 锚（:53683-53699 出生一次：X=出生列,Y 恒 -1）+ FindGoodRestingSpot
    //  日间 floorX/floorY（:53195-53217：自 home 列下扫首个实心/站台；夜椅搜索未移植）----
    if (this.critterHomeX === -1) {
      this.critterHomeX = Math.floor((this.x + this.w / 2) / TILE);
      if (player && !player.dead && this.facing === 0) {
        this.facing = player.cx >= this.cx ? 1 : -1;   // TargetClosest（:53685-53695）
      }
    }
    const homeX = this.critterHomeX;
    let floorY = this.critterHomeY;
    while (floorY < st.h - 20
      && !(st.inBounds(homeX, floorY) && (st.isSolid(homeX, floorY) || st.isPlatform(homeX, floorY)))) {
      floorY++;
    }
    // flag（:53383-53399）= 雨天/夜间/日食/史莱姆雨/风暴地表（家域约束的"晴日"门）
    const wthr = game.world.weather;
    const stormSurface = false;   // Main.IsItStorming 地表门（本仓天气无独立风暴旗）
    const notCalm = !game.world.clock.isDay || wthr.raining || wthr.slimeRain || stormSurface;
    const wet = this.wet;         // 原版一律碰撞盒 wet（:54049/:54293/:53585 等，曾中心格 liquid>80）
    const drowning = !canBreathe
      // flag21（NPC.cs:54361——旧注 :54216 系漂移行号）：AI_007 原文
      // `!flag11 && Collision.DrownCollision(position, width, height, 1f, includeSlopes: true)`
      // ★F4②（2026-09-01）：includeSlopes 补 true——坡面/半砖带液计水触发溺逃
      && drownCollision(st, this.x, this.y, this.w, this.h, 1, true);
    // ★BJ704-G6 R3-P2⑤/D13 前置单源：湿侧重力档（UpdateNPC_UpdateGravity
    //   :92055-92064 水 0.2/帽 7、蜜 0.1/4、微光 0.15/5.5——绝对值直替,覆盖
    //   高空系数）。重力应用行已随 R3-P2⑤ 后移到钉面之后（=原版 AI 内钉面/
    //   AI 外重力 :91579-83 同序）;D13 卡墙检查在行走臂尾（重力前）读此值。
    const wetGrav = this.shimmerWet ? 0.15 : this.honeyWet ? 0.1 : 0.2;
    const wetCap = this.shimmerWet ? 5.5 : this.honeyWet ? 4 : 7;
    // ---- 危险扫描（cs:53884-54028，每 tick；乌龟整段跳过）----
    let danger = false;           // flag16
    let dangerDir = -1;           // num15：朝最近险情侧
    if (!turtle) {
      let leftDelta = -1, rightDelta = -1;   // num13 槽/ num14 槽（非 614=左最近负/右最近正）
      // ★BJ704-R3 P1②：614 爆炸兔互换支（:54049-54061）——左距入 num14/右距入
      //   num13,且守卫跨侧互斥（先见侧独占,后见同侧覆写=扫描序末位;两侧槽永不
      //   并存,最近比较式不再达）→ num15 同式（:54103）反转 → direction=-num15
      //   （:54156-54163,flag2=感染种向导专属 614 恒 false）=【追险情】——爆炸兔
      //   冲向敌怪送死引爆=物品 1338 武器语义（危险速度档 1.5/0.1 BJ703-C D3 与
      //   追向合成=冲刺扑敌）。★仅 NPC 支互换：玩家 stinky 支（:54088-54100）
      //   原版无 614 特判=照常【逃离】臭玩家（原版 quirk 逐字保真）。
      const swap614 = vid === 614;
      for (const o of game.enemies()) {
        const e = o as Enemy;
        if (e === this || e.dead) continue;
        const et = e.vanillaId ?? -1;
        if (CRITTER_TURN_ON_PLAYERS.has(et) || et === 690) continue;   // :53888 豁免源
        // :54033 原文 = `(friendly||damage<=0) && !stinky` 才跳过——带臭味(120)
        // 的敌怪【不计】攻击性/阵营,照常计为险情让小动物逃离(2026-08-31 清偿)
        if ((e.def.damage <= 0 || !!e.vanilla?.friendly) && !(e.stinkyT > 0)) continue;
        if (Math.hypot(e.cx - this.cx, e.cy - this.cy) >= 200) continue;   // num11/num12 均 200
        if (!e.noTileCollide
          && !canHit(st, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
        danger = true;
        const dx = e.cx - this.cx;
        if (dx < 0 && (leftDelta === -1 || dx > leftDelta)) { if (swap614) rightDelta = dx; else leftDelta = dx; }
        if (dx > 0 && (rightDelta === -1 || dx < rightDelta)) { if (swap614) leftDelta = dx; else rightDelta = dx; }
      }
      // 玩家 stinky 支（:54081-54100）：无 NPC 险情时,带臭味的玩家也置 flag16/17
      // ——num13/num14 并入同一方向结算（critter 分支只消费 num15,不消费 num16/17
      // 槽位）。原版 `(player.stinky || type∉{633,...})` 恒真条件按字面照写为活体门
      if (!danger) {
        const cands = game.candidatePlayers?.() ?? [player];
        for (const q of cands) {
          if (!q || q.dead || !q.buffs?.has(BuffType.Stinky)) continue;   // player.stinky(:54084)
          if (Math.hypot(q.cx - this.cx, q.cy - this.cy) >= 200) continue;   // num11=200
          danger = true;
          const dx = q.cx - this.cx;
          if (dx < 0 && (leftDelta === -1 || dx > leftDelta)) leftDelta = dx;
          if (dx > 0 && (rightDelta === -1 || dx < rightDelta)) rightDelta = dx;
        }
      }
      if (danger) {
        // num15（:54103）：num13 槽==-1→1 / num14 槽在→num14<−num13 取向 / 否则 −1。
        //  614 经上方互换支=num13 装右距/num14 装左距 → 本式产出反向 → 三消费位
        //  facing=-dangerDir 随之=追险情（非 614=逃离最近险情侧,原语义）。
        dangerDir = leftDelta === -1 ? 1
          : rightDelta !== -1 ? (rightDelta < -leftDelta ? 1 : -1) : -1;
        if (this.ai0 === 8) {
          // 僵立背向险情 → 复走（:54146-54156;614 互换后=面向险情即复走=扑敌前奏）
          if (this.facing === -dangerDir) {
            this.ai0 = 1;
            this.ai1 = 300 + Math.floor(Math.random() * 300);
            this.ai2 = 0;
            this.lai3 = 0;
          }
        } else if (this.ai0 !== 1) {
          // ★BJ704-G6 D12①：非走态 → 起步逃离门（NPC.cs:54130-54170——先
          //   GetWalkPrediction（:54136,前视探针=center+15·dir/脚上一行,同
          //   :54277/:54520 三站同式）,!avoidFalling 才整段起步+定向。TownCritter
          //   :56268 恒 false=41 型零扰动;唯 614：悬崖边遇险不冲（原位僵待险情
          //   离开——方向也不写=原版整段包在 if 内）。flag2（感染种向导）614 恒
          //   false → direction=-num15（追险情,R3 互换支）不引入新分支。
          const tileX1 = Math.floor((this.x + this.w / 2 + 15 * this.facing) / TILE);
          const tileY1 = Math.floor((this.y + this.h - 16) / TILE);
          const avoidFalling1 = walkPrediction(
            st, Math.floor((this.x + this.w / 2) / TILE), homeX, townCritter,
            this.facing, tileX1, tileY1, this.h, false, wet && !canBreathe, false, this.w,
          ).avoidFalling;
          if (!avoidFalling1) {
            this.ai0 = 1;
            this.ai1 = 120 + Math.random() * 120;
            this.ai2 = 0;
            this.lai3 = 0;
            this.facing = -dangerDir;
          }
        } else if (this.facing !== -dangerDir) {
          this.facing = -dangerDir;   // 走态仅调向,不重置计时（:54168-54175）
        }
      }
    }
    // 形态链：行走鸭族湿身/坠落 → 飞形（cs:53585-53589，|vy|>4 或 wet）
    //  ai0/ai1 归零（原版 Transform(363,0,0) 新形起步——走形站计时 200-400 若
    //  继承进飞形 = ai1 恒 ≥300 → 起飞即进入降落段，水面模式反复惊飞秒落抖动）
    if ((vid === 362 || vid === 364 || vid === 602 || vid === 608) && (wet || Math.abs(this.vy) > 4)) {
      if (this.tryTransformTo(vid + 1, st, false, game)) { this.ai0 = 0; this.ai1 = 0; }
      return;
    }
    // ★BJ704-G3 D7：IsInAGoodRestingSpot（NPC.cs:53165-53183 非坐姿路径）单源求值
    //   ——蛙湿恒否;余 = 正踩 (floorX,floorY)。原版 AI 头 :53851-52 算 num6/num7 后
    //   站/走两臂共用（AI 内无位移,状态机前一次求值等价）
    const restSpot = !((vid === 361 || vid === 445 || vid === 687) && wet)
      && Math.floor((this.x + this.w / 2) / TILE) === homeX
      && Math.floor((this.y + this.h + 1) / TILE) === floorY;
    if (this.ai0 === 0) {
      // ---- 站立（:54103-54202）----
      // 自身 stinky(120) 强制起走（:54179-54182 `if (stinky) ai[0] = 1f;`——带臭味的
      // 小动物不再回站休整,每拍进入行走态;本拍其余站立段照常求值,下一拍转走）
      if (this.stinkyT > 0) this.ai0 = 1;
      if (this.lai3 > 0) this.lai3 -= 1;                    // :54040-54042
      if (frog && wet) {
        // 蛙湿身起走（:54049-54056，200+Next(500,700)=700-899）
        this.ai0 = 1;
        this.ai1 = 200 + 500 + Math.floor(Math.random() * 200);
        this.ai2 = 0;
        this.lai3 = 0;
      } else if (notCalm && !townCritter) {
        // ★BJ704-G3 D7：夜间/风雨即停支·站定臂（NPC.cs:54202-54244
        //   `else if (flag && !flag5 && !TownCritter[type])`——flag=notCalm,
        //   flag5=对话中,敌怪侧小动物无对话恒假）。614 爆炸兔等非 TownCritter 型
        //   夜间不再游荡：正踩家格（IsInAGoodRestingSpot :53165——蛙湿恒否,余=正踩
        //   (floorX,floorY)）→ 刹停挂机（原版续跑 AI_007_TryForcingSitting :53413
        //   椅面检测转 ai[0]=5 坐姿——敌怪侧坐姿态未建模=边界备案,免刹停不坐）;
        //   不在家 → 朝家走 200+Next(200)（该臂取代常规件——站计时递减/泡水逃离
        //   全部跳过,即夜袭/雨夜 614 恒归家）
        const num6n = Math.floor((this.x + this.w / 2) / TILE);
        const num7n = Math.floor((this.y + this.h + 1) / TILE);
        if (num6n === homeX && num7n === floorY) {
          if (this.vx > 0.1) this.vx -= 0.1;                // 同款 ±0.1 线性刹车（:54212-54220）
          else if (this.vx < -0.1) this.vx += 0.1;
          else this.vx = 0;
        } else {
          this.facing = num6n > homeX ? -1 : 1;             // :54234-54237 朝家定向
          this.ai0 = 1;
          this.ai1 = 200 + Math.floor(Math.random() * 200);   // :54238 200-399
          this.ai2 = 0;
          this.lai3 = 0;
        }
      } else {
        if (rat) this.vx *= 0.5;                            // :54105-54108
        if (this.vx > 0.1) this.vx -= 0.1;                  // ±0.1 线性刹车（:54109-54120）
        else if (this.vx < -0.1) this.vx += 0.1;
        else this.vx = 0;
        if (this.ai1 > 0) this.ai1 -= 1;
        // ★BJ704-G6 D12②：站立起走 avoidFalling 门（NPC.cs:54276-54322——
        //   GetWalkPrediction（:54280）后 `flag20 && !avoidFalling2`（flag20 仅
        //   被 avoidFalling2 置 false ≡ 取非）才 startWalk；else = 掉头 +
        //   站计时 60+Next(120)=60-179（:54314-54318）。TownCritter 恒 false
        //   =旧直通;唯 614：悬崖边站计时到点不起步,改朝崖背侧掉头再等。
        //   泡水逃离（:54282-95）前置且【不受门辖】——照旧先行。
        const tileX2 = Math.floor((this.x + this.w / 2 + 15 * this.facing) / TILE);
        const tileY2 = Math.floor((this.y + this.h - 16) / TILE);
        const avoidFalling2 = walkPrediction(
          st, Math.floor((this.x + this.w / 2) / TILE), homeX, townCritter,
          this.facing, tileX2, tileY2, this.h, false, wet && !canBreathe, false, this.w,
        ).avoidFalling;
        const startWalk = (): void => {
          this.ai0 = 1;
          // ★BJ704-G3 D7：startWalk 两拍同门（:54161-54166/:54289-54292/:54305-54311）
          //   ——TownCritter 型 +Next(200,400)=400-898;非集（614）裸 200+Next(300)
          //   =200-499（短起走计时）
          this.ai1 = 200 + Math.floor(Math.random() * 300)
            + (townCritter ? 200 + Math.floor(Math.random() * 200) : 0);
          this.ai2 = 0;
          this.lai3 = 0;
        };
        if (wet && !canBreathe && drowning) {
          startWalk();                                       // 泡水逃离（:54136-54151）
        } else if (this.ai1 <= 0) {
          if (!avoidFalling2) {
            startWalk();
          } else {
            this.facing *= -1;                               // :54315 掉头（悬崖背侧）
            this.ai1 = 60 + Math.floor(Math.random() * 120); // :54316 60-179
          }
        }
      }
      // ---- 家域约束（:54179-54202，仅站立态）----
      const num6 = Math.floor((this.x + this.w / 2) / TILE);
      const num7 = Math.floor((this.y + this.h + 1) / TILE);
      // IsInAGoodRestingSpot（:53165-53183）：蛙湿身恒否；余 = 正踩 (floorX,floorY)
      // ★BJ704-G3 D7：改读 AI 头单源 restSpot（同式同值——AI 内无位移）
      const atRest = restSpot;
      if (!notCalm || atRest) {
        if (num6 < homeX - 25 || num6 > homeX + 25) {
          if (this.lai3 === 0) {
            if (num6 < homeX - 50 && this.facing === -1) this.facing = 1;
            else if (num6 > homeX + 50 && this.facing === 1) this.facing = -1;
          }
        } else if (Math.floor(Math.random() * 80) === 0 && this.lai3 === 0) {
          this.lai3 = 200;                                   // 站立期 1/80 随机翻向（:54197-54202）
          this.facing *= -1;
        }
      }
    } else if (this.ai0 === 1 && !(notCalm && !townCritter && restSpot)) {
      // ---- 行走（:54205-54658）----
      // ★BJ704-G3 D7：分支头排夜间即停态（NPC.cs:54352-54358 `flag &&
      //   IsInAGoodRestingSpot && !TownCritter → 停走`——取非入行走条件,夜态转
      //   下方专用臂 = 原版 if/else 同构,行走体零位移改动）
      if (!drowning) {
        // 离家 >35 格逆行 → 走计时额外 −5（:54219-54229）
        const num6w = Math.floor((this.x + this.w / 2) / TILE);
        if (num6w < homeX - 35 || num6w > homeX + 35) {
          if (this.x < homeX * TILE && this.facing === -1) this.ai1 -= 5;
          else if (this.x > homeX * TILE && this.facing === 1) this.ai1 -= 5;
        }
        this.ai1 -= 1;
      }
      if (this.ai1 <= 0) {
        // 走→站（:54232-54246）★BJ704-G3 D7 集判据：TownCritter −Next(100)
        //   =300+Next(300)−Next(100)=201-599;非集（614）+Next(900)
        //   =300+Next(300)+Next(900)=300-1498（长站立计时）
        this.ai0 = 0;
        this.ai1 = 300 + Math.floor(Math.random() * 300)
          + (townCritter ? -Math.floor(Math.random() * 100) : Math.floor(Math.random() * 900));
        this.ai2 = 0;
        this.lai3 = 60;
      }
      // ---- 速度表（:54280-54328）----
      let maxX = 1, acc = 0.07;
      // ★BJ703-C D3：档头 (type==614)&flag16 → 1.5/0.1（NPC.cs:54427-54431——爆炸兔
      //   危险档;else-if 链头位,无危险时 614 落全默认 1/0.07）
      if (vid === 614 && danger) {
        maxX = 1.5; acc = 0.1;
      } else if (squirrel) maxX = 1.5;
      else if (turtle) {
        if (wet) { acc = 1; maxX = 2; } else { acc = 0.07; maxX = 0.5; }
      }
      if (vid === 625) {   // 独立覆写块（:54304-54316）
        if (wet) { acc = 1; maxX = 2.5; } else { acc = 0.07; maxX = 0.2; }
      }
      if (rat) { maxX = 2; acc = 1; }
      // ★BJ703-C D3 勘误：逃逸/溺水加成（:54467-54473）原注「friendly 恒真」系误读
      //   ——野生小动物 friendly 恒【假】：SubAI_HandleTemporaryCatchableNPCPlayer
      //   Invulnerability（NPC.cs:91649-91670）对 87 型 npcCatchable（Main.cs:9469+）
      //   每 tick 强制 friendly=false（释放后 90t 免疫窗 :17885 例外——本仓未建模,
      //   登记债 D10）；SetDefaults 侧亦仅蠕虫 357 等零星置 true。补 friendly 门后
      //   野生小动物遇险/溺水维持族速（原版语义;城镇 NPC 面 friendly=true 不受影响
      //   ——TownNPC.ts 独立 AI 不走此）。
      // ★BJ704-G3 D10：friendly 读运行时投影（NPC.friendly 当前值——npcCatchable 型
      //   被 SubAI 每拍强写:自然出生首 90t 窗内 true → 逃逸档生效（新刷小动物遇险
      //   1.5+残血×0.9 族速）,窗外/释放/雕像 false → 族速；蚱蜢 377/446 json
      //   friendly=true 静态位与窗并行=原版 AI_001 自清 :62057-66 双清结构同构）
      if (((this.vanilla?.friendly ?? false) || this.catchFriendly) && (danger || drowning)) {
        maxX = 1.5 + (1 - this.hp / this.maxHp) * 0.9;
        acc = 0.1;
      }
      if (frog && wet) {
        // 青蛙水中窜游（:54334-54344，替代常规加速）
        if (Math.abs(this.vx) < 0.05 && Math.abs(this.vy) < 0.05) this.vx += maxX * 10 * this.facing;
        else this.vx *= 0.9;
      } else if (this.vx < -maxX || this.vx > maxX) {
        if (this.vy === 0) { this.vx *= 0.8; this.vy *= 0.8; }   // velocity 向量 ×0.8（:54345-54351）
      } else if (this.vx < maxX && this.facing === 1) {
        this.vx += acc;
        if (this.vx > maxX) this.vx = maxX;
      } else if (this.vx > -maxX && this.facing === -1) {
        this.vx -= acc;
        if (this.vx > maxX) this.vx = maxX;      // 原版字面（:54360-54366）
      }
      // StepDown 恒不跑（flag22 恒 true——homeTileY=-1）；StepUp 在 moveAndCollide 内
      // 贴地 → 台阶跳三档（:54398-54627）
      if (this.vy === 0) {
        const num26 = Math.floor((this.x + this.w / 2 + 15 * this.facing) / TILE);
        const num27 = Math.floor((this.y + this.h - 16) / TILE);   // ★脚上一行
        // ★BJ704-G6 D12③：行走前视预测真值（NPC.cs:54534——GetWalkPrediction
        //   (num6,floorX,flag11,flag21,num25,num26)：critter 无 isLikeATownNPC →
        //   keepwalking=drowning 单值（=旧实现同构）;avoidFalling 对 614 真值。
        //   flag24（:54537 isLikeATownNPC 跳出水面旗）critter 恒 false。
        const pred3 = walkPrediction(
          st, Math.floor((this.x + this.w / 2) / TILE), homeX, townCritter,
          this.facing, num26, num27, this.h, false, drowning, false, this.w,
        );
        let keepwalking = pred3.keepwalking;
        let avoidFalling3 = pred3.avoidFalling;
        // ★BJ704-G6 D12③a：悬崖停走（NPC.cs:54556-54577——avoidFalling 且脚下
        //   3 支撑格（中心±1 × 地面行 num26+1,`nactive() && Main.tileSolid`
        //   =isVanillaTileSolid,平台计入/家具顶不计——BJ656 三站同式）≤2 →
        //   停走：ai0=0/站计时 50+Next(50)=50-99/lai3=40,keepwalking 与
        //   avoidFalling 同拍清 false（后续障碍段 keepwalking→90 与避坠掉头
        //   分支均不再消费）。不早退=原版续跑跳点回位/障碍链。
        if (avoidFalling3) {
          const centerCol = Math.floor((this.x + this.w / 2) / TILE);
          let support = 0;
          for (let d = -1; d <= 1; d++) {
            const sx = centerCol + d, sy = num27 + 1;
            if (st.inBounds(sx, sy) && st.isActive(sx, sy) && st.isVanillaTileSolid(sx, sy)) support++;
          }
          if (support <= 2) {
            keepwalking = false;
            avoidFalling3 = false;
            this.ai0 = 0;
            this.ai1 = 50 + Math.floor(Math.random() * 50);
            this.ai2 = 0;
            this.lai3 = 40;
          }
        }
        const solidNotTop = (x: number, y: number): boolean =>
          st.inBounds(x, y) && st.isActive(x, y) && st.isSolid(x, y) && !st.isPlatform(x, y);
        const solidTiles = (x1: number, x2: number, y1: number, y2: number): boolean => {
          // Collision.SolidTiles（:3468-3501）：越界恒 true；实心且非站台
          if (Math.min(x1, x2) < 0 || Math.max(x1, x2) >= st.w
            || Math.min(y1, y2) < 0 || Math.max(y1, y2) >= st.h - 40) return true;
          for (let i = Math.min(x1, x2); i <= Math.max(x1, x2); i++) {
            for (let j = Math.min(y1, y2); j <= Math.max(y1, y2); j++) {
              if (solidNotTop(i, j)) return true;
            }
          }
          return false;
        };
        // 跳点回位（:54450-54455）：X 未动（撞墙悬空跳）→ 掉头 + localAI[3]=180
        if (this.x === this.lai3) {
          this.facing *= -1;
          this.lai3 = 180;
        }
        if (drowning) {                       // :54456-54470
          if (this.lai3 > 180) this.lai3 = 180;
          if (this.lai3 > 0) this.lai3 -= 1;
        } else {
          this.lai3 = -1;
        }
        const t3Solid = solidNotTop(num26, num27);
        const t4Solid = solidNotTop(num26, num27 - 1);
        const t5Solid = solidNotTop(num26, num27 - 2);
        const t3Slope = st.inBounds(num26, num27) ? st.slope[st.idx(num26, num27)] : 0;
        const small = this.h / TILE < 3;       // flag25（:54474）
        if ((this.vx < 0 && this.facing === -1) || (this.vx > 0 && this.facing === 1)) {
          let turn = false, freeze = false;    // flag26/flag27
          if (t5Solid && (!small || t4Solid)) {
            // 2+ 格墙（:54519-54544）
            if (!solidTiles(num26 - this.facing * 2, num26 - this.facing, num27 - 5, num27 - 1)
              && !solidTiles(num26, num26, num27 - 5, num27 - 3)) {
              this.vy = -6;
            } else if (rat) {
              // 鼠类（:54526-54534）：中心前一格实心 → 转身 vx=0（不跳 2 格墙）
              const cxT = Math.floor(this.cx / TILE) + this.facing;
              const cyT = Math.floor(this.cy / TILE);
              if (st.inBounds(cxT, cyT) && st.isSolid(cxT, cyT)) {
                this.facing *= -1;
                this.vx = 0;
              }
            } else if (danger) {
              freeze = true;
              turn = true;
            } else {
              turn = true;
            }
          } else if (t4Solid) {
            // 1 格墙（:54545-54561）
            if (!solidTiles(num26 - this.facing * 2, num26 - this.facing, num27 - 4, num27 - 1)
              && !solidTiles(num26, num26, num27 - 4, num27 - 2)) {
              this.vy = -5;
            } else if (danger) {
              freeze = true;
              turn = true;
            } else {
              turn = true;
            }
          } else if (this.y + this.h - num27 * TILE > 20 && t3Solid
            && !(t3Slope === 1 || t3Slope === 2)) {
            // 沉入 >20px 半砖档（:54562-54578，topSlope=坡 1|2 豁免）
            if (!solidTiles(num26 - this.facing * 2, num26, num27 - 3, num27 - 1)) {
              this.vy = -4.4;
            } else if (danger) {
              freeze = true;
              turn = true;
            } else {
              turn = true;
            }
          } else if (avoidFalling3) {
            // ★BJ704-G6 D12③b：避坠掉头（NPC.cs:54710-54716——前视列无墙
            //   （t5/t4/半砖三档全空）但会坠崖/入岩浆 → flag26 掉头;flag16 险情
            //   另置 flag27 僵立（`if(!flag24) flag26`——flag24=跳出水面旗
            //   critter 恒 false=恒掉头）。可达面（探针列≈中心±1 格,与支撑
            //   三列共面）：岩浆前视（:56236-40 液断先于实心 → 恒避）为主
            //   ——深水/悬空因支撑 ≤2 先落 ③a 停走分支。flag14（城镇史莱姆
            //   跳水）不移植——★BJ704-G19 销案锁死（G3 备案③,2026-10-21 复核）：
            //   flag14 = NPCID.Sets.IsTownSlime[type]（:56329/:56347——城镇史莱姆
            //   专属跳水/避水支）。Enemy 域 aiStyle7 = 42 型 critter,零成员在
            //   IsTownSlime 集（城镇史莱姆走 TownNPC 桶,仓内消费面= TownNPC.ts
            //   flag14 臂）→ 本域恒 false=结构性不可达。【正式销案,勿以「walk AI
            //   有 flag14 分支未移植」重登记——正确宿主在 TownNPC 域且已接】。
            turn = true;
            if (danger) freeze = true;
          }
          if (freeze) {                          // 危险中跳不过 → 僵立 240t（:54595-54602）
            keepwalking = false;
            this.vx = 0;
            this.ai0 = 8;
            this.ai1 = 240;
          }
          if (turn) {                            // 掉头（:54603-54608）
            this.facing *= -1;
            this.vx *= -1;
          }
          if (keepwalking) this.ai1 = 90;        // 溺水中保持走（:54609-54613）
          if (this.vy < 0) this.lai3 = this.x;   // 记跳点 X（:54614-54617）
        }
        if (this.vy < 0 && wet) this.vy *= 1.2;  // :54619-54622（湿身恒乘）
        // ★BJ704-R9 P1-1：:54754 原文 = `vy<0 ∧ TownCritter[type] ∧ !flag7`——614 非
        //   集成员（D7 定谳）→ 原版对 614 干跳无第二乘（障碍跳 -6/-5/-4.4 原值）。
        //   旧 `!rat` 恒乘 = 614 跳 -7.2/-6.0/-5.28 偏高（BJ703-C 前旧码,D3 路由转活;
        //   D7 集判据刀扫了计时器四闸,漏同 AI 第五个 TownCritter 消费面）。
        if (this.vy < 0 && !rat && (this.vanillaId !== null && TOWN_CRITTER_IDS.has(this.vanillaId))) this.vy *= 1.2; // TownCritter 补偿（鼠豁免,614 不乘）
      }
      // ★BJ704-G6 D13：卡墙折返（NPC.cs:54789-54804——`oldPosition==position &&
      //   oldVelocity==velocity+(0,gravity) && !flag16 && localAI[2]++>=30` →
      //   续走 200+Next(300)（+TownCritter Next(200,400)=三拍第三处,G3 D7 已注）
      //   +direction/velocity.X 双翻,localAI[2] 清零再积）。oldPosition/oldVelocity
      //   语义 = 上拍 UpdateCollision（:93681 oldVelocity=AI+重力后碰撞前 /
      //   :93748 oldPosition=position+=前）——本仓 = 下方 moveAndCollide 前快照
      //   （critterPreMoveX/Y + critterOldVX/VY,重力+钉面后）;检查点在行走臂尾
      //   （本拍重力前）：this.x/y=上拍碰撞后位置 ↔ oldPosition==position 同构;
      //   critterOldVY===vy+g ↔ oldVelocity==velocity+(0,gravity)（g=本拍将加
      //   重力,湿 wetGrav/干 0.3 平档——高空带 D11 备案不缩放,与重力行同值）。
      //   ★可达面（先证可达再落刀——1 格墙场景）：前视 t3 实心/t4·t5 空
      //   （1 格台阶）且 StepUp 无净空失败（applyStepUp flag 门 j=2 探柱被
      //   顶棚拦）→ 障碍三档全不触发、碰撞逐拍清 vx → 每拍两条件恒真,31 拍
      //   （后置 ++ 比较旧值）触发;鼠类槽位折返（vx×0）同稳态。危险（flag16）
      //   抑制且不计数（短路 ++ 在前三真后）;计数粘滞=原版 localAI[2] 无衰减
      //   清零（仅触发时归零）。残差备案：原版 |vx|<0.005→0（:91586）在重力后
      //   碰撞前,本仓 D6 拍位在碰撞后——卡墙稳态 vx=±acc(≥0.07)>0.005 不受辖。
      if (this.x === this.critterPreMoveX && this.y === this.critterPreMoveY
        && this.critterOldVX === this.vx && this.critterOldVY === this.vy + (this.wet ? wetGrav : ENEMY_GRAVITY)
        && !danger && this.lai2++ >= 30) {
        this.lai2 = 0;
        this.ai0 = 1;                                        // :54794 续走（走态幂等）
        this.ai1 = 200 + Math.floor(Math.random() * 300)
          + (townCritter ? 200 + Math.floor(Math.random() * 200) : 0);   // :54795-98 三拍第三处
        this.ai2 = 0;
        this.facing *= -1;                                   // :54799 双翻
        this.vx *= -1;
      }
    } else if (this.ai0 === 1) {
      // ★BJ704-G3 D7：夜间即停支·行走臂（NPC.cs:54352-54358——notCalm ∧
      //   IsInAGoodRestingSpot ∧ !TownCritter → 立即停走回站,200+Next(200) 站计时
      //   +localAI[3]=60;速度表/台阶跳整段跳过=原版 else 结构同构）。614 夜间走到
      //   家位即挂机（TownCritter 型无此臂=夜行游荡照旧）
      this.ai0 = 0;
      this.ai1 = 200 + Math.floor(Math.random() * 200);
      this.ai2 = 0;
      this.lai3 = 60;
    } else if (this.ai0 === 8) {
      // ---- 僵立（:54682-54711）----
      this.vx *= 0.8;
      this.ai1 -= 1;
      if (this.ai1 < 60 && danger) this.ai1 = 180;    // 险情续命（:54686-54690）
      if (this.ai1 <= 0) {
        this.ai0 = 0;
        this.ai1 = 60 + Math.floor(Math.random() * 60);
        this.ai2 = 0;
        this.lai3 = 30 + Math.floor(Math.random() * 60);
      }
    }
    // ---- 龟/蛙钉水面（cs:55706-55750 flag12&&wet，AI_007 顶层非状态分支——
    //      旧注 :55574-55612 系 1456 行带漂移）----
    // flag12 = 龟族(616/617/625) ∪ 蛙族(361/445/687)。湿身时 Center 钉在 GetWaterLine
    // 线上（Collision.cs:1501，液面 = 行×16 − liquid/16 整除）：线下 → 上浮 0.8 钳 −4
    // 且不过线（num95=Center+1）；线上 → 只允许落到线。蛙另把走计时砍到 50（连窜）。
    // 撞墙/贴图边 → 掉头 ×−0.25。无液面可钉（中心上 2 行仍有液=深处/越界）→ vy−0.2。
    // 湿侧重力档（UpdateNPC_UpdateGravity :92055-92064 wet 尾置直替：water 0.2/帽 7、
    // honey 0.1/4、shimmer 0.15/5.5——全 NPC 无差别）——★BJ703-C D2（2026-10-21）：
    // 旧实现 wet 0.2/帽 7 只覆盖龟/蛙（pinSurface 门），其余湿身小动物（兔/企鹅/鼠…）
    // 0.3/10 = 原版漂移；且龟/蛙在蜜/微光中恒 0.2/7（原版 0.1/4、0.15/5.5）同修。
    // 干侧平 0.3/10 维持（原版高空衰减 num2 钳 0.25 带仅空域生效——真世界地表
    // num2=1 恒等;applyGravity 全档化登记债 BJ703-C D11 备案）
    // ★BJ704-G6 R3-P2⑤（2026-10-21）：重力应用后移到钉面【后】——原版钉面在
    //   AI 内（:55706-50）、重力在 AI 外（UpdateNPC :91579-83 AI() 后统一
    //   `velocity.Y+=gravity` + maxFallSpeed 钳）,旧序（重力先行）= 钳界
    //   ±0.2/tick vy 差（`min(vy,line−anchor)` 支:原版=钳值+0.2 / 旧=钳值;
    //   −0.8 支 −4 钳:原版 −3.8 / 旧 −4;无液面支 −0.2↔+0.2 交换=净零,不受序影响）。
    const pinSurface = (turtle || frog) && wet;
    if (pinSurface) {
      if (frog) this.ai1 = 50;
      const ctx = Math.floor(this.cx / TILE);
      if (this.hitWall || (ctx < 5 && this.facing === -1) || (ctx > st.w - 5 && this.facing === 1)) {
        this.facing *= -1;
        this.vx *= -0.25;
      }
      const { found, line } = getWaterLine(st, ctx, Math.floor(this.cy / TILE));
      if (found) {
        const anchor = this.cy + 1;                       // num95
        if (this.cy > line) {
          this.vy -= 0.8;
          if (this.vy < -4) this.vy = -4;
          if (anchor + this.vy < line) this.vy = line - anchor;
        } else {
          this.vy = Math.min(this.vy, line - anchor);
        }
      } else {
        this.vy -= 0.2;                                   // 与湿侧重力 0.2 抵消 → 深水中性悬浮
      }
    }
    // ★BJ704-G6 R3-P2⑤：重力 = AI 外（原版 :91579-83 UpdateNPC 在 AI() 后统一
    //   加 + maxFallSpeed 钳）——钉面先行、重力+帽后置 = 原版序（见上块注）。
    this.vy = wet
      ? Math.min(this.vy + wetGrav, wetCap)
      : Math.min(this.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
    // ★BJ704-G6 D13：卡墙折返快照（=原版 oldPosition :93748 / oldVelocity
    //   :93681——移动前/碰撞前采样;含重力+钉面终值）。仅本 AI 族读写; duck
    //   Transform/blackened 松鼠转族后不再回本 AI=残值无害。
    this.critterPreMoveX = this.x;
    this.critterPreMoveY = this.y;
    this.critterOldVX = this.vx;
    this.critterOldVY = this.vy;
    // StepDown 门（AI_007 critter：flag22 恒 true → 原版永不 StepDown）。
    // ★BJ703-C D1：'never' 只辖 StepDown——moveAndCollide 内的 WalkDownSlope 预备
    //   阶段（= 原版 UpdateCollision 首步 :93667,无条件跑）已解耦照跑,下坡贴地。
    this.stepDownGate = 'never';
    moveAndCollide(this, game.world, this.vx, this.vy);
    // （原版行走态无地面摩擦：velocity.X 持续到 cap，仅站立 ±0.1 刹车 + 超帽向量
    //  ×0.8；掉头全部来自跳档 turn/家域约束/危险调向——无泛化 hitWall 掉头）
  }

  /** AI_064 萤火虫族（cs:34256-34485）1:1：ai[0]/ai[1]=漂移目标速度（localAI[0] 计时
   *  60-179，本仓以 ai[2] 承接）；ai[3]=scale（Next(75,111)×0.01）。
   *  漂移重选（:34267-34304）：|ΔX|>700 且 localAI[3]==0 → 【远距构型】方向×
   *  Next(100,251) + Y Next(−50,51)（在玩家下方 100px 再 −Next(100,251)），归一 ×
   *  三档速（>1000：1.5-2.0 / >850：1.0-1.5 / 其余 0.5-1.5）——曾随机角近似；
   *  否则 → localAI[3]=1（此后恒近距构型）+ ±100/±100 分量归一 × Next(5,151)×0.01。
   *  677 仙尘（:34307-34389）：世界缘 40 格内推离（分量 ±0.5 钳 ±3）+ 逃逸（15t 门）
   *  对【实际速度】叠加 Σ单位向/count×2 钳 8，并把 localAI[0] 置 10（强制重选）。
   *  闪烁（:34391-34423）：localAI[2] 发光倒计 / localAI[1] 暗间隔 30-180；
   *  !白天或地下（y>worldSurface+10）才亮 10-30 帧。
   *  平滑 v=(v×79+目标)/80；垂直避障：vy>0 中心列 [cy,cy+4) 逐格（实心/液 → 翻 ai1
   *  +vy×0.9，无 break）；vy<0 [cy,cy+30) 无实心 → 同款；collideX → 目标翻离墙侧
   *  + vx×−0.2。677 rotation = vx×0.3（:47473 同段） */
  private fireflyAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const isFaeling = this.vanillaId === 677;
    if (!this.aiInit) {
      this.aiInit = true;
      this.ai0 = 0; this.ai1 = 0; this.ai2 = 0;
      // 随机 scale 0.75-1.10（ai[3] = Next(75,111)×0.01，:34263-34266）
      this.ai3 = (75 + Math.floor(Math.random() * 36)) * 0.01;
      this.vanillaScale = this.ai3;
    }
    let n0 = this.ai0, n1 = this.ai1;   // num1022/num1023（先写局部再回存，:34258-34259）
    // ---- 漂移目标重选（localAI[0] 计时，:34262-34304）----
    this.ai2 -= 1;
    if (this.ai2 <= 0) {
      // TargetClosest（direction 朝玩家侧——远距构型用）
      let dir = this.facing;
      if (player && !player.dead) dir = player.cx >= this.cx ? 1 : -1;
      this.facing = dir;
      this.ai2 = 60 + Math.floor(Math.random() * 120);
      const dx = player ? Math.abs(player.cx - this.cx) : 0;
      if (dx > 700 && this.lai3 === 0) {
        // 远距构型（:34272-34292）：三档速 + direction×Next(100,251) + Y 分量
        let spd = (50 + Math.floor(Math.random() * 101)) * 0.01;
        if (dx > 1000) spd = (150 + Math.floor(Math.random() * 51)) * 0.01;
        else if (dx > 850) spd = (100 + Math.floor(Math.random() * 51)) * 0.01;
        const vx0 = dir * (100 + Math.floor(Math.random() * 151));
        let vy0 = -50 + Math.floor(Math.random() * 101);
        if (player && this.y > player.y - 100) vy0 -= 100 + Math.floor(Math.random() * 151);
        const inv = spd / Math.hypot(vx0, vy0);
        n0 = vx0 * inv;
        n1 = vy0 * inv;
      } else {
        // 近距构型（:34293-34302）：localAI[3]=1 锁定（此后不再走远距）；±100 分量
        this.lai3 = 1;
        const spd = (5 + Math.floor(Math.random() * 146)) * 0.01;
        const vx0 = -100 + Math.floor(Math.random() * 201);
        const vy0 = -100 + Math.floor(Math.random() * 201);
        const inv = spd / Math.hypot(vx0, vy0);
        n0 = vx0 * inv;
        n1 = vy0 * inv;
      }
    }
    if (isFaeling) {
      // ---- 677 世界缘推离（:34307-34347：Center 格 40 格内推离，分量 += 0.5 钳 ±3）----
      let offEdge = true;
      const px4 = Math.floor(this.cx / TILE), py4 = Math.floor(this.cy / TILE);
      if (px4 < 40) { n0 += 0.5; if (n0 > 3) n0 = 3; offEdge = false; }
      else if (px4 > st.w - 40) { n0 -= 0.5; if (n0 < -3) n0 = -3; offEdge = false; }
      if (py4 < 40) { n1 += 0.5; if (n1 > 3) n1 = 3; offEdge = false; }
      else if (py4 > st.h - 40) { n1 -= 0.5; if (n1 < -3) n1 = -3; offEdge = false; }
      // ---- 677 逃逸（localAI[1] 15t 门；世界缘时不扫，:34348-34389）----
      if (this.lai1 > 0) {
        this.lai1 -= 1;
      } else if (offEdge) {
        this.lai1 = 15;
        let count = 0, ux = 0, uy = 0;
        const boxDist = (b: { x: number; y: number; w: number; h: number }): number => {
          const qx = Math.max(b.x, Math.min(this.cx, b.x + b.w));
          const qy = Math.max(b.y, Math.min(this.cy, b.y + b.h));
          return Math.hypot(this.cx - qx, this.cy - qy);
        };
        for (const o of game.enemies()) {
          const e = o as Enemy;
          if (e === this || e.dead || e.def.damage <= 0 || !!e.vanilla?.friendly) continue;
          if (boxDist(e) <= 100) {
            const d = Math.hypot(this.cx - e.cx, this.cy - e.cy) || 1;
            count++; ux += (this.cx - e.cx) / d; uy += (this.cy - e.cy) / d;
          }
        }
        const pp: Player | null = this.targetRef(game, player);   // M11：索敌目标优先
        if (pp && boxDist(pp) <= 150) {
          const d = Math.hypot(this.cx - pp.cx, this.cy - pp.cy) || 1;
          count++; ux += (this.cx - pp.cx) / d; uy += (this.cy - pp.cy) / d;
        }
        if (count > 0) {
          const zx = (ux / count) * 2, zy = (uy / count) * 2;   // zero/=count; ×2
          this.vx += zx; this.vy += zy;                        // 对实际速度叠加（:34380）
          const spd = Math.hypot(this.vx, this.vy);
          if (spd > 8) { this.vx = (this.vx / spd) * 8; this.vy = (this.vy / spd) * 8; }
          this.ai2 = 10;                                       // localAI[0]=10 强制重选（:34386）
        }
      }
    } else {
      // ---- 闪烁发光（:34391-34423）：localAI[2]=发光 / localAI[1]=暗间隔 ----
      if (this.lai2 > 0) {
        if (this.lai2 > 3) {
          const s = this.ai3;
          this.lightRGB = this.vanillaId === 358 ? [0.10125 * s, 0.21375 * s, 0.225 * s]
            : this.vanillaId === 654 ? [0.225 * s, 0.105 * s, 0.06 * s]
              : [0.1095 * s, 0.15 * s, 0.0615 * s];
        }
        this.lai2 -= 1;
      } else if (this.lai1 > 0) {
        this.lai1 -= 1;
      } else {
        this.lai1 = 30 + Math.floor(Math.random() * 150);
        if (!game.world.clock.isDay || this.cy / TILE > game.world.groundLevel + 10) {
          this.lai2 = 10 + Math.floor(Math.random() * 20);
        }
      }
    }
    // ---- 平滑逼近（:34424-34426）----
    this.vx = (this.vx * 79 + n0) / 80;
    this.vy = (this.vy * 79 + n1) / 80;
    // ---- 垂直避障（:34427-34465：中心列逐格，无 break）----
    const cx = Math.floor(this.cx / TILE), cy = Math.floor(this.cy / TILE);
    if (this.vy > 0) {
      for (let j = cy; j < cy + 4; j++) {
        if (st.inBounds(cx, j) && (st.isSolid(cx, j) || st.liquid[st.idx(cx, j)] > 0)) {
          n1 = -n1;
          if (this.vy > 0) this.vy *= 0.9;
        }
      }
    }
    if (this.vy < 0) {
      let ground = false;
      for (let j = cy; j < cy + 30; j++) {
        if (st.inBounds(cx, j) && st.isSolid(cx, j)) ground = true;
      }
      if (!ground) {
        n1 = -n1;
        if (this.vy < 0) this.vy *= 0.9;
      }
    }
    const oldVx = this.vx;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) {
      // collideX（:34466-34470）：目标翻离墙侧（按 vx 符号），vx×−0.2
      n0 = this.vx < 0 ? Math.abs(n0) : -Math.abs(n0);
      this.vx = oldVx * -0.2;
    }
    if (isFaeling) this.visAngle = this.vx * 0.3;   // rotation（:34471-34474）
    this.facing = this.vx > 0 ? 1 : -1;
    this.ai0 = n0;
    this.ai1 = n1;
  }

  /** AI_066 蠕虫族（cs:34490-34585）1:1：状态机整体套 vy==0 门（:34498——腾空期计时
   *  冻结）；localAI[1]=切换计时（静止 Next(300,900) / 蠕动 Next(600,1800)，NewNPC 0 起
   *  → 出生即蠕动）；蠕动 vx=方向×0.2（485=0.25/486=0.325/487=0.4，374 ×3），
   *  direction==0 时 TargetClosest 定向（:34502-34505），翻向【仅 collideX】
   *  （:34506-34509——曾状态切换随机翻向）。374 松露虫（:34560-34584）：ai[1]=玩家
   *  160px 累计计数（<90 才 +1，离场【不重置】——曾归零=惊吓进度丢失），==90 →
   *  y+16 + Transform(375) 钻地 */
  private wormCritterAI(game: GameHooks) {
    const st = game.world.store;
    // 484 魔化夜爬虫点光（cs:34492-34497）：num1047 = Next(90,111)×0.01 × (essScale+0.5)/2，
    // 紫光。essScale = Main.cs:61703-61713 三角波 0.7↔1.0（每帧 ±0.01，周期 60 帧）
    if (this.vanillaId === 484) {
      const t = visEffectFrames() % 60;
      const ess = t < 30 ? 1 - t / 100 : 0.7 + (t - 30) / 100;
      const f = (0.9 + Math.random() * 0.2) * ((ess + 0.5) / 2);
      this.lightRGB = [0.3 * f, 0.1 * f, 0.25 * f];
    }
    if (this.ai0 < 0) this.ai0 = 0;
    if (this.ai1 < 0) this.ai1 = 0;
    const player = this.targetRef(game);   // M11：索敌目标优先（TargetClosest 目标）
    if (this.vy === 0) {
      // ---- 贴地：状态机 + 蠕动推进（:34498-34551）----
      if (this.ai0 === 1) {
        // direction==0 → TargetClosest（:34502-34505，按玩家方位定向）
        if (this.facing === 0 && player && !player.dead) this.facing = player.cx >= this.cx ? 1 : -1;
        const mult = this.vanillaId === 485 ? 0.25 : this.vanillaId === 486 ? 0.325
          : this.vanillaId === 487 ? 0.4 : this.vanillaId === 374 ? 0.6 : 0.2;
        this.vx = this.facing * mult;                     // :34510-34527
      } else {
        this.vx = 0;                                      // :34529-34532
      }
      // localAI[1] 计时（:34533-34550）：蠕动 Next(600,1800) / 静止 Next(300,900)
      this.lai1 -= 1;
      if (this.lai1 <= 0) {
        if (this.ai0 === 1) {
          this.ai0 = 0;
          this.lai1 = 300 + Math.floor(Math.random() * 600);
        } else {
          this.ai0 = 1;
          this.lai1 = 600 + Math.floor(Math.random() * 1200);
        }
      }
    } else if (this.facing === 0) {
      // 腾空期 direction 兜底（:34552-34559）
      this.facing = this.vx < 0 ? -1 : 1;
    }
    // ---- 374 松露虫（:34560-34584）：160px 内计数（<90 才自增；离场不清零）----
    if (this.vanillaId === 374) {
      const near = !!player && !player.dead
        && Math.hypot(player.cx - this.cx, player.cy - this.cy) <= 160;
      if (near && this.ai1 < 90) this.ai1 += 1;
      if (this.ai1 === 90) {
        this.y += TILE;                                   // position.Y += 16（:34582）
        // 375 钻地形态本就要嵌进地里（穿墙蠕虫），跳过实心适配检查
        this.tryTransformTo(375, st, true, game);
        return;
      }
    }
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.ai0 === 1 && this.hitWall) this.facing *= -1;  // 仅 collideX（:34506-34509）
    // ---- FindFrame case 357/485-487 的旋转（cs:73460-73508/:73516-73563,补齐）：
    //      腾空自旋 direction×0.1/tick 累积;贴地(vy==0)归零;坡面钉 ±0.785
    //      （检头顶格,平坡再检其下格;slope1=+0.785/slope2=−0.785,覆写自旋）----
    this.spin = this.vy !== 0 ? this.spin + this.facing * 0.1 : 0;
    {
      const sx2 = Math.floor(this.cx / TILE);
      let sy2 = Math.floor(this.y / TILE);
      let sl = st.inBounds(sx2, sy2) ? st.slope[st.idx(sx2, sy2)] : 0;
      if (sl === 0) {
        sy2 += 1;
        sl = st.inBounds(sx2, sy2) ? st.slope[st.idx(sx2, sy2)] : 0;
      }
      if (sl === 1) this.spin = 0.785;
      else if (sl === 2) this.spin = -0.785;
    }
  }

  /** AI_067 蜗牛族（cs:34586-34860）1:1 结构重做（2026-08-19，曾对角爬+自创 dirY 翻
   *  且无碰撞积分 = 沉地）：
   *  · 微光水门（:34588-34597）：中心格微光液 >30 → GetShimmered。
   *  · 359 随机 scale ai[3]=Next(80,111)×0.01，盒缩至 12×scale（:34599-34621）。
   *  · 贴墙爬（ai[2]==0，noGravity，:34726-34859）：速度恒 (spd×direction,
   *    spd×directionY)——【双轴贴墙状态机】ai[1] 轴选档（0：撞 Y 墙锁存 ai[0]=2、
   *    释放时翻 direction；撞 X 墙翻 directionY；1：镜像）——撞哪面墙就拐进垂直向，
   *    沿墙四象限环行；rotation 四象限目标 0.1 步进缓转（:34763-34857）。
   *  · 惊扰下落（ai[2]>0，:34668-34721）：重力落地逃（vx=spd×direction），着地
   *    （collideY 且脚下格非坡）每 tick ai[2]−1 至 0 回贴墙；1/7200 随机或脱墙
   *    （无 collideX/Y 超 5t，:34646-34666）触发；下落撞墙且已着地 → 立即回贴墙
   *    且 directionY=−1（往墙上爬）；vy==0 且 X 不动超 10t → direction=1。
   *  · 速度：普通 0.3 / 360 发光·655 熔岩 0.6（:34631-34635）。 */
  private snailAI(game: GameHooks) {
    const st = game.world.store;
    // ---- 微光水（:34588-34597：Center 格 tile.shimmer() && liquid>30 → GetShimmered）----
    {
      const sx = Math.floor(this.cx / TILE), sy = Math.floor(this.cy / TILE);
      if (st.inBounds(sx, sy) && st.liquidType[st.idx(sx, sy)] === 4
        && st.liquid[st.idx(sx, sy)] > 30) {
        this.npcGetShimmered(game);
        return;
      }
    }
    // ---- 359 随机缩放（:34599-34621：ai[3]=Next(80,111)×0.01；盒 = 12×scale，
    //      Y 底锚 / X 按 Center.X + w/2 − newW − 2 原式）----
    if (this.vanillaId === 359) {
      if (this.ai3 !== 0) {
        const scale = this.ai3;
        this.vanillaScale = scale;
        const nw = Math.floor(12 * scale), nh = Math.floor(12 * scale);
        if (nw !== this.w) { this.x = this.x + this.w / 2 - nw - 2; this.w = nw; }
        if (nh !== this.h) { this.y = this.y + this.h - nh; this.h = nh; }
      } else {
        this.ai3 = (80 + Math.floor(Math.random() * 31)) * 0.01;
      }
    }
    // 点光（cs:34623-34630）：360 发光蜗牛 (0.1,0.2,0.7)、655 熔岩蜗牛 (0.6,0.3,0.1)，恒定
    if (this.vanillaId === 360) this.lightRGB = [0.1, 0.2, 0.7];
    else if (this.vanillaId === 655) this.lightRGB = [0.6, 0.3, 0.1];
    const spd = this.vanillaId === 360 || this.vanillaId === 655 ? 0.6 : 0.3;
    if (this.ai0 < 0 || this.ai0 > 2) this.ai0 = 0;
    // 出生定向（:34636-34645）：ai[0]==0 → TargetClosest + directionY=1 + ai[0]=1
    if (this.ai0 === 0) {
      const pl = this.targetRef(game);   // M11：索敌目标优先（TargetClosest 目标）
      if (pl && !pl.dead && this.facing === 0) this.facing = pl.cx >= this.cx ? 1 : -1;
      if (this.facing === 0) this.facing = 1;
      this.dirY = 1;
      this.ai0 = 1;
    }
    // collideX/collideY 读上一 tick 位移旗标（原版语义：AI 早于本 tick 碰撞）
    const collideX = this.hitWall;
    const collideY = this.onGround || this.hitHead;
    // ---- 惊扰触发（:34646-34667）：1/7200 随机 或 脱墙（无 collideX/Y）超 5t ----
    if (this.ai2 === 0 && Math.floor(Math.random() * 7200) === 0) this.ai2 = 2;
    if (!collideX && !collideY) {
      this.lai3 += 1;
      if (this.lai3 > 5) this.ai2 = 2;
    } else {
      this.lai3 = 0;
    }
    let flag64 = false;
    if (this.ai2 > 0) {
      // ---- 惊扰下落态（:34668-34721）----
      this.ai1 = 0;
      this.ai0 = 1;
      this.dirY = 1;
      this.visAngle = this.vy > spd ? this.visAngle + this.facing * 0.1 : 0;  // 滚转/归零
      this.vx = spd * this.facing;
      this.noGravity = false;
      // 脚下探测 A（:34684-34689）：身后列 (y+h+8)/16 格非坡 且 collideY → 计数递减
      const ax = Math.floor((this.cx + (this.w / 2) * -this.facing) / TILE);
      const ay = Math.floor((this.y + this.h + 8) / TILE);
      if (st.inBounds(ax, ay)) {
        const sl = st.slope[st.idx(ax, ay)];
        if (!(sl === 1 || sl === 2) && collideY) this.ai2 -= 1;
      }
      // 探测 B（:34690-34695）：前方列 (y+h−4)/16 是底坡 → 翻 direction
      const bx = Math.floor((this.cx + (this.w / 2) * this.facing) / TILE);
      const by = Math.floor((this.y + this.h - 4) / TILE);
      if (st.inBounds(bx, by)) {
        const sl2 = st.slope[st.idx(bx, by)];
        if (sl2 === 3 || sl2 === 4) this.facing *= -1;
      }
      // 落地撞墙（:34696-34702）：立即回贴墙，directionY=−1（贴墙向上爬）
      if (collideX && this.vy === 0) {
        flag64 = true;
        this.ai2 = 0;
        this.dirY = -1;
        this.ai1 = 1;
      }
      // X 卡死检测（:34703-34720）：vy==0 且 X 不动超 10t → direction=1
      if (this.vy === 0) {
        if (this.lai1 === this.x) {
          this.lai2 += 1;
          if (this.lai2 > 10) { this.facing = 1; this.vx = this.facing * spd; this.lai2 = 0; }
        } else {
          this.lai2 = 0;
          this.lai1 = this.x;
        }
      }
    }
    if (this.ai2 === 0) {
      // ---- 贴墙爬（noGravity，:34726-34859）----
      this.noGravity = true;
      if (this.ai1 === 0) {
        if (collideY) this.ai0 = 2;                       // Y 墙锁存（:34729-34731)
        if (!collideY && this.ai0 === 2) { this.facing = -this.facing; this.ai1 = 1; this.ai0 = 1; }
        if (collideX) { this.dirY = -this.dirY; this.ai1 = 1; }   // 撞 X 墙 → 转竖向（:34739-34743）
      } else {
        if (collideX) this.ai0 = 2;                       // X 墙锁存（:34747-34750）
        if (!collideX && this.ai0 === 2) { this.dirY = -this.dirY; this.ai1 = 0; this.ai0 = 1; }
        if (collideY) { this.facing = -this.facing; this.ai1 = 0; } // 撞 Y 墙 → 转横向（:34757-34761）
      }
      // rotation 四象限目标 + 0.1/t 缓转 + spriteDirection 象限锁存（:34763-34857
      // ——目标按 collideX/collideY 上一 tick 旗标取象限：dirY<0·dir<0：X 墙 1.57 /
      // Y 墙 3.14；dirY<0·dir>0：Y 墙 3.14 / X 墙 4.71；dirY>0·dir<0：Y 墙 0 /
      // X 墙 1.57；dirY>0·dir>0：X 墙 4.71 / Y 墙 0；无命中目标保持现值。
      // spriteDirection 随象限独立锁存（±1 与 direction 无关——天花板档取反等，
      // 渲染层 aiStyle67 旋转后局部翻面消费，G4 批 2026-08-19 接通）
      if (!flag64) {
        let target = this.visAngle;
        if (this.dirY < 0) {
          if (this.facing < 0) {
            if (collideX) { target = 1.57; this.snailSdir = -1; }
            else if (collideY) { target = 3.14; this.snailSdir = 1; }
          } else if (collideY) { target = 3.14; this.snailSdir = -1; }
          else if (collideX) { target = 4.71; this.snailSdir = 1; }
        } else if (this.facing < 0) {
          if (collideY) { target = 0; this.snailSdir = -1; }
          else if (collideX) { target = 1.57; this.snailSdir = 1; }
        } else if (collideX) { target = 4.71; this.snailSdir = -1; }
        else if (collideY) { target = 0; this.snailSdir = 1; }
        let rot = this.visAngle % (Math.PI * 2);
        if (rot < 0) rot += Math.PI * 2;
        const diff = Math.abs(rot - target);
        if (rot > target) {
          if (diff > Math.PI) rot += 0.1;
          else { rot = Math.max(target, rot - 0.1); }
        } else if (rot < target) {
          if (diff > Math.PI) rot -= 0.1;
          else { rot = Math.min(target, rot + 0.1); }
        }
        this.visAngle = rot;
      }
      this.vx = spd * this.facing;
      this.vy = spd * this.dirY;
      moveAndCollide(this, game.world, this.vx, this.vy);
    } else {
      // 惊扰下落：重力 + 碰撞积分（原版共享段；曾裸积分无碰撞 = 沉地根因）
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
    }
  }

  /** AI_068 鸭飞形 363/365/603/609（cs:34861-35117）：整族 noGravity，仅 ai[0]=0 且非 wet
   *  时有重力。水中：X 平滑到 dir×2、前方无水/实心翻向、钉水面；脱离水 → 起飞翻向；
   *  玩家 200px 盒或受伤 → 起飞（vy-=6 翻向）。飞行：X 渐近 ±3、前方 15 格下探避障
   *  （5 格内障碍 -0.2/有障碍 -0.1/无 +0.1，Y 限 [-4,3]）；ai[1]>=300 且落地/落水 →
   *  Transform(type-1) 回行走形（cs:35000） */
  private duckFlyAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    if (this.ai0 < 0) this.ai0 = 0;
    if (this.ai1 < 0) this.ai1 = 0;
    const inWater = st.liquid[st.idx(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))] > 80;
    if (this.ai0 === 0) {
      // ---- 水面模式（cs:34886-34983 wet 分支）----
      // wet：vx Lerp 到 direction×2（1/20）；前方 (体半宽+8)×dir 处实心/无水/贴图边 →
      // 掉头；下沉 vy×0.5；钉水面——内联 GetWaterLine（:34934-34971）再 −6，
      // Center 在线下 → vy−0.1 钳 −8 且不过线，线上 → vy 直接=线差。
      // !wet（完全离水）→ 立即起飞翻向（cs:34975-34980，不等落地）；
      // 玩家 100px 盒或残血 → 起飞 vy−6 翻向（cs:34981-34988）
      if (this.wet) {
        this.vx = (this.vx * 19 + 2 * this.facing) / 20;
        const aheadX = Math.floor((this.cx + (this.w / 2 + 8) * this.facing) / TILE);
        const midY = Math.floor(this.cy / TILE);
        const topY = Math.floor(this.y / TILE), botY = Math.floor((this.y + this.h) / TILE);
        if (aheadX < 5 || aheadX > st.w - 5
          || st.isSolid(aheadX, midY) || st.isSolid(aheadX, topY) || st.isSolid(aheadX, botY)
          || !(st.inBounds(aheadX, botY) && st.liquid[st.idx(aheadX, botY)] > 0)) {
          this.facing *= -1;
        }
        if (this.vy > 0) this.vy *= 0.5;
        // 内联液面探测（cs:34934-34958）——★非 GetWaterLine：无"上 2 行有液→false"
        // 早退，深水同样给出最近液面（行×16 − liquid/16 整除），三行皆无液才退盒底−6
        const ccx = Math.floor(this.cx / TILE);
        const liqRow = (ty: number) => (st.inBounds(ccx, ty) ? st.liquid[st.idx(ccx, ty)] : 0);
        const upL = liqRow(midY - 1), midL = liqRow(midY), dnL = liqRow(midY + 1);
        let surface = this.y + this.h;
        if (upL > 0) surface = midY * TILE - Math.trunc(upL / 16);
        else if (midL > 0) surface = (midY + 1) * TILE - Math.trunc(midL / 16);
        else if (dnL > 0) surface = (midY + 2) * TILE - Math.trunc(dnL / 16);
        surface -= 6;                                       // num1069 −6（吃水线）
        if (this.cy > surface) {
          this.vy -= 0.1;
          if (this.vy < -8) this.vy = -8;
          if (this.cy + this.vy < surface) this.vy = surface - this.cy;
        } else {
          this.vy = surface - this.cy;
        }
        const scared = !!player && !player.dead
          && Math.abs(player.cx - this.cx) < 100 + (this.w + player.w) / 2
          && Math.abs(player.cy - this.cy) < 100 + (this.h + player.h) / 2;
        if (scared || this.hp < this.maxHp) {
          this.ai0 = 1; this.vy -= 6; this.facing *= -1;
        }
        moveAndCollide(this, game.world, this.vx, this.vy);
        return;
      }
      // 离水（cs:34887 noGravity=false → 有重力）：陆行待起飞
      this.applyGravity(game);
      if (Math.abs(this.vx) < 2) this.vx += this.facing * 0.1;
      if (player && !player.dead
        && Math.abs(player.cx - this.cx) < 100 + (this.w + player.w) / 2
        && Math.abs(player.cy - this.cy) < 100 + (this.h + player.h) / 2) {
        this.ai0 = 1; this.vy -= 6; this.facing *= -1;
      }
      moveAndCollide(this, game.world, this.vx, this.vy);
      if (this.onGround && !this.wet) { // 陆上：起飞回飞形
        this.ai0 = 1; this.vy -= 6;
      }
      return;
    }
    // 飞行
    this.ai1 += 1;
    // 原版飞行分支从不重定 direction（出生 TargetClosest 一次 + collideX 翻）——
    // 曾逐帧"背向玩家"改向 = 持续远离转向（审计 9.1,2026-08-19）。
    // 玩家死亡（:34980-34984 dead → return）：原版速度冻结由共享积分段
    // （:93808）继续滑行——本仓无共享积分,等价取"只积分不 steering"（审计 A4）
    if (!player) {
      moveAndCollide(this, game.world, this.vx, this.vy);
      return;
    }
    // ---- 鸟粪彩蛋（aiStyle 68 飞行鸭同款,:34863-34872;BIRD_THAT_CAN_POOP
    //      表含 363/365/603/609——B 批代理在 birdAI(:25459) 实现了 PoopProj,
    //      此处补齐本族 10 行,2026-08-19）----
    if (this.lai3 === 0 && !player.dead) {
      if (this.cx >= player.x && this.cx <= player.x + player.w
        && player.y > this.y + this.h
        && canHit(st, this.x, this.y, this.w, this.h, player.x, player.y, player.w, player.h)
        && (rollOnlyBadLuckExtreme((player as unknown as { luck: number }).luck, 50) === 0
          || isThisCenx((player as unknown as { name?: string }).name))) {
        this.lai3 = 1;
        game.spawnCritterProj?.(new PoopProj(player.cx, this.cy));
      }
    }
    if (this.ai1 >= 300) {
      // 300t 后强制降落段（cs:34986-35001）：vx×0.98 缓降、vy 逼近 2,触地/水收尾
      this.vx *= 0.98;
      if (this.vy < 2) this.vy = Math.min(2, this.vy + 0.1);
    } else {
      if (this.facing === -1 && this.vx > -3) this.vx -= 0.1;
      else if (this.facing === 1 && this.vx < 3) this.vx += 0.1;
      const aheadX = Math.floor((this.cx + this.facing * 24) / TILE);
      const footY = Math.floor(this.cy / TILE);
      let obstruction = 0;
      for (let k = 0; k < 15; k++) {
        if (st.isSolid(aheadX, footY + k) || st.liquid[st.idx(aheadX, footY + k)] > 0) { obstruction = k + 1; break; }
      }
      if (obstruction > 0 && obstruction <= 5) this.vy -= 0.2;
      else if (obstruction > 0) this.vy -= 0.1;
      else this.vy += 0.1;
      this.vy = Math.max(-4, Math.min(3, this.vy));
    }
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) { this.vx *= -0.5; this.facing *= -1; }
    if (this.ai1 >= 300 && (this.hitHead || this.onGround || inWater)) {
      this.ai0 = 0;
      // ★原版 :34996 ai[1]=0f——落地即清飞行计时（曾误用 Transform 第三参
      // 200+Next(200)（那是给新走形的初始站计时）→ 落水后 ai1 恒 200-400，
      // 惊飞（ai0=1）→ 几 tick 就 ai1≥300 → 又落水 → 循环 =
      // 用户实报"鸭子在水中飞/游之间抽搐"根因，2026-08-21）
      this.ai1 = 0;
      // 回行走形（cs:35000 Transform(type-1)，363→362/365→364/603→602/609→608）
      // 仅 !wet 落地/撞顶才变形;落水只回 ai0=0 水面漂浮态（行走形遇水又变回
      // → 曾水陆互变死循环抖动,审计 9.2,2026-08-19）
      if (!this.wet) this.tryTransformTo((this.vanillaId ?? 363) - 1, st, false, game);
    }
  }

  /** AI_112 仙灵 583-585（AI_112_FairyCritter cs:48453）：状态 0 绕出生点 20px 微漂、
   *  玩家 250px 内 → 状态 1 逃离飞（X 渐近 dir×4.5、前方 20×8 扫描定 Y、限 [-5,3]）；
   *  2 穿墙寻人 → 3 起舞（GetFairyCircleOffset 相对增量小圆舞）→ 4 穿墙带路 →
   *  5 宝箱处终演消散（FairyEffects）/ 6 无宝重试 / 7 飞离（EncourageDespawn）；
   *  引导态存活 18000 帧（5 分钟）→ 7（cs:48457-48473）。
   *  ★BJ434（2026-10-02）：状态 2-7 全量 1:1 重写——旧「绕宝箱绝对点直写速度」
   *  的圆舞近似（差值可达 ~1200px/tick,noTileCollide 直积分=逐帧跳位）即用户实报
   *  「指路瞬移」根因;同时补 noTileCollide→物理直积分接线（旧置旗但 moveAndCollide
   *  不读=引导态仍撞墙,穿墙引导名存实亡）。 */
  private fairyAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    // 圆舞朝向门（cs:49134 尾写 flag 门）——状态 3 / 状态 4 等玩家臂 / 状态 5 圆舞段
    // 直写面向玩家并跳过方向尾写
    let danceFace = false;
    if (!this.aiInit) {
      this.aiInit = true;
      // 锚点补设（cs:48621-48623 仅 ai[0]==0&&ai[1]==0 时）。ai[2]/ai[3] 不清——
      // 野生仙灵生成即 ai[2]=2 引导态（NPC.cs:3615-3623 SpawnNPC 第 8 参传 2f）,
      // 曾在此无条件清零=引导链死码、fairyAge 永不累计(2026-09-02 审计 D7)
      if (this.ai0 === 0 && this.ai1 === 0) { this.ai0 = this.cx; this.ai1 = this.cy; }
      // 状态 0 首帧漂移起速（cs:48625-48631 localAI[0]==0 门）：vx=±Lerp(2,4)、
      // vy=±Lerp(1,2) 再 ×0.7——曾缺=闲置微漂从零起步发死(遗留批 D10 细节)
      if (this.ai2 === 0) {
        const sgn = () => (Math.random() < 0.5 ? -1 : 1);
        this.vx = (2 + Math.random() * 2) * sgn() * 0.7;
        this.vy = (1 + Math.random()) * sgn() * 0.7;
      }
    }
    // ---- 点光（cs:48991-49010）：value3 主色 ×0.7（value4 仅尘色不进光）
    //  583 粉仙灵 HotPink(255,105,180) / 584 绿仙灵 LimeGreen(50,205,50) /
    //  585 蓝仙灵 RoyalBlue(65,105,225)
    if (this.vanillaId === 583) this.lightRGB = [(255 / 255) * 0.7, (105 / 255) * 0.7, (180 / 255) * 0.7];
    else if (this.vanillaId === 584) this.lightRGB = [(50 / 255) * 0.7, (205 / 255) * 0.7, (50 / 255) * 0.7];
    else if (this.vanillaId === 585) this.lightRGB = [(65 / 255) * 0.7, (105 / 255) * 0.7, (225 / 255) * 0.7];
    // 成就：FIND_A_FAIRY（AI_112 视效段尾 NPC.cs:49163-49171：`Main.netMode != 2` 内
    // `!localPlayer.dead && localPlayer.HitboxForBestiaryNearbyCheck.Intersects(base.Hitbox)
    // → HandleSpecialEvent(22)`——判据盒 = 玩家盒 Inflate(300,200)
    // （Player.HitboxForBestiaryNearbyCheck Player.cs:3297-3303）,逐帧幂等
    {
      const lp = player;
      if (lp && !lp.dead
        && lp.x - 300 < this.x + this.w && lp.x + lp.w + 300 > this.x
        && lp.y - 200 < this.y + this.h && lp.y + lp.h + 200 > this.y) {
        game.achievements?.handleSpecialEvent(22,
          { statLifeMax: lp.maxHp, statManaMax: lp.maxMana });
      }
    }
    // 寿命（cs:48457-48473）：仅引导态 ai[2]>1 才累计（曾全态累计且与 ai3 复用
    // 被清零）;期满进状态 7 飞离而非原地消失
    if (this.ai2 > 1) {
      this.fairyAge += 1;
      if (this.fairyAge >= 18000) { this.ai2 = 7; this.ai3 = 0; }
    }
    if (this.ai2 === 0) {
      this.noTileCollide = false;   // 引导态 2-6 置 true,回 0/1 显式清（cs:48480）
      // 绕锚点微漂（cs:48636-48645 1:1）:离锚 >20 → sign×0.04 + |vy|>2 时 ×0.95
      // 阻尼——曾自造 else 抖动 + ±2 硬钳（硬钳把首帧起速当场压平）
      const dx = this.ai0 - this.cx, dy = this.ai1 - this.cy;
      if (Math.hypot(dx, dy) > 20) {
        this.vx += Math.sign(dx) * 0.04;
        this.vy += Math.sign(dy) * 0.04;
        if (Math.abs(this.vy) > 2) this.vy *= 0.95;
      }
      // 玩家 250px 内 → 状态 1;direction 取【背向玩家】（cs:48499-48505
      // `direction = !(player.X > X) ? 1 : -1`——野生仙灵是逃离不是追随,
      // 曾逐帧 seekDirX 追人像宠物,审计 10.1,2026-08-19）
      if (player && !player.dead && Math.hypot(player.cx - this.cx, player.cy - this.cy) < 250) {
        this.facing = player.cx > this.cx ? -1 : 1;
        if (this.vx * this.facing < 0) this.vx = this.facing * 2;   // 逃离起步踢(cs:48502-48504)
        this.ai3 = 0;
        this.ai2 = 1;
      }
    } else if (this.ai2 === 1) {
      // 逃逸飞（cs:48660-48752）：direction 只在 0→1 转换时设（背向玩家）,
      // 引导态只能经虫网释放进入（ReleaseNPC :80911 预置 ai[2]=2）——曾 40px 自发进引导
      this.noTileCollide = false;   // cs:48661
      // 撞墙折返 / 撞顶反向（cs:48663-48668 collideX/collideY;本仓 X 位=hitWall）
      // ——曾缺=持续顶墙不折返(审计 D8;preCollideVy=碰撞前 vy 快照,moveAndCollide 前存)
      if (this.hitWall) { this.facing *= -1; this.vx = this.facing * 2; }
      if (this.collideY) this.vy = this.preCollideVy > 0 ? 1 : -1;
      // X 渐近 4.5（cs:48670-48682 1:1:逆行补速分两档 |vx|>4.5→0.4/否则 0.2）
      const num12 = 4.5;
      if (Math.sign(this.vx) !== this.facing || Math.abs(this.vx) < num12) {
        this.vx += this.facing * 0.04;
        if (this.vx * this.facing < 0) {
          if (Math.abs(this.vx) > num12) this.vx += this.facing * 0.4;
          else this.vx += this.facing * 0.2;
        } else if (Math.abs(this.vx) > num12) {
          this.vx = this.facing * num12;
        }
      }
      // 前方扫描窗 21×8（cs:48684-48717:num13=中心列、dir<0 左移 20——行进侧
      // 整幅而非单列;内层 break 外层【不】break,任一列上 5 行有挡即 flag6）
      const num13 = Math.floor(this.cx / TILE) + (this.facing < 0 ? -20 : 0);
      const num15 = Math.floor((this.y + this.h) / TILE);
      let allClear = true, highBlocked = false;
      for (let i = num13; i <= num13 + 20; i++) {
        for (let j = num15; j < num15 + 8; j++) {
          if (st.isSolid(i, j) || st.liquid[st.idx(i, j)] > 0) {
            if (j < num15 + 5) highBlocked = true;
            allClear = false;
            break;
          }
        }
      }
      if (allClear) this.vy += 0.05;
      else this.vy -= 0.2;
      if (highBlocked) this.vy -= 0.3;
      this.vy = Math.max(-5, Math.min(3, this.vy));
    } else if (this.ai2 === 2) {
      // ---- 状态 2 玩家引导（cs:48753-48846 1:1）：noTileCollide=true 穿墙寻人；
      //      锚盒（CenteredRect(player.Center,(W+60,H/2))）接触 → 宝箱搜索（命中→态 3
      //      起舞 / 未中→态 6 寻箱）;飞行 = DirectionTo(锚盒最近点)×2（距>150 ×2 /
      //      >80 ×1.5）lerp 0.07 + 鸟飞建议(6,3,vy 钳[−4,2],ai3<300 门) + 卡墙计数
      //      （中心实心 ai3+=2 / 开放 −1,钳[0,400]）。旧实装缺鸟飞/卡墙计数,且锚盒
      //      中心误上移 h/4（原版 GetTargetData 中心=玩家 Center 无偏移,BJ434 修）----
      this.noTileCollide = true;
      if (player && player.dead) {
        this.ai2 = 1; this.ai3 = 0;
        this.facing = player.cx > this.cx ? -1 : 1;   // 背向玩家逃离（cs:48760 !(...>X)）
        if (this.vx * this.facing < 0) this.vx = this.facing * 2;
      } else if (player) {
        const rw = player.w + 60, rh = player.h / 2;
        if (this.x < player.cx + rw / 2 && this.x + this.w > player.cx - rw / 2
          && this.y < player.cy + rh / 2 && this.y + this.h > player.cy - rh / 2) {
          const treasure = fairyTreasureCoords(st, this.cx, this.cy);
          if (treasure) {
            this.ai0 = treasure[0]; this.ai1 = treasure[1];
            this.ai2 = 3; this.ai3 = 0;
            this.fairyDanceDir = this.facing;   // 圆舞 dir=入态时行进向（舞中 direction 不改写）
          }
          else { this.ai2 = 6; this.ai3 = 0; }
        } else {
          // 最近点（cs:48778 ClosestPointInRect=逐轴钳入）
          const qx = Math.min(Math.max(this.cx, player.cx - rw / 2), player.cx + rw / 2);
          const qy = Math.min(Math.max(this.cy, player.cy - rh / 2), player.cy + rh / 2);
          const dx = qx - this.cx, dy = qy - this.cy;
          const d = Math.hypot(dx, dy) || 1;
          let spd = 2;
          if (d > 150) spd = 4; else if (d > 80) spd = 3;   // :48786 value×2 / ×1.5
          this.vx += (dx / d * spd - this.vx) * 0.07;   // Lerp(velocity, value, 0.07)
          this.vy += (dy / d * spd - this.vy) * 0.07;
          const txi = Math.floor(this.cx / TILE), tyi = Math.floor(this.cy / TILE);
          if (this.ai3 < 300) {
            const bf = fairyBirdFlight(st, this.facing, txi, tyi, 6, 3);
            if (bf.down) this.vy += 0.05;
            if (bf.up) this.vy -= 0.02;
            if (this.vy > 2) this.vy = 2;
            if (this.vy < -4) this.vy = -4;
          }
          if (st.inBounds(txi, tyi)) {
            if (st.isSolid(txi, tyi)) this.ai3 = Math.min(this.ai3 + 2, 400);
            else this.ai3 = Math.max(this.ai3 - 1, 0);
          }
        }
      }
    } else if (this.ai2 === 3) {
      // ---- 状态 3 引导起舞（cs:48688-48742 1:1）：≤15t 减速收势（音 27@15）;
      //      velocity = GetFairyCircleOffset(t+Δ)−GetFairyCircleOffset(t)——绕【入态身位】
      //      小圆舞（X 幅 6·dir、Y 幅 14/18/22 三段摆 + 摆轴 ±π/8）。★BJ434 瞬移根因：
      //      旧实装写「绕宝箱绝对点−当前位置」（寻箱窗 ±75×±50 格 → 单帧差值可达
      //      ~1200px,noTileCollide 直积分=逐帧跳位）;原版圆舞纯相对增量 ≤2.2px/tick。
      //      毕（210t）→ 状态 4 带路 ----
      this.noTileCollide = true;
      if (this.ai3 === 15) game.playSfxWav?.('Pixie', 1, this.cx, this.cy);   // :48692 音27=Pixie(曾误 roar 近似)
      if (this.ai3 <= 15) { this.vx *= 0.9; this.vy *= 0.9; }
      else {
        if (player && !player.dead) { this.facing = player.cx > this.cx ? 1 : -1; danceFace = true; }   // cs:48797-48801 spriteDirection 直写（仓内极性沿旧写法）
        const num7 = this.ai3 - 15;
        let rot = 0, circleHeight = 22;
        if (num7 <= 65) { rot = Math.PI / 8; circleHeight = 14; }         // :48719-48721
        else if (num7 <= 130) { rot = -Math.PI / 8; circleHeight = 18; }  // :48722-48724
        rot *= this.fairyDanceDir;   // num6 *= direction
        const o3 = fairyCircleOffset(num7 / 65, rot, circleHeight, this.fairyDanceDir);
        const o4 = fairyCircleOffset(num7 / 65 + 1 / 65, rot, circleHeight, this.fairyDanceDir);
        this.vx = o4[0] - o3[0];
        this.vy = o4[1] - o3[1];
      }
      this.ai3 += 1;
      if (this.ai3 >= 210) { this.ai2 = 4; this.ai3 = 0; }
    } else if (this.ai2 === 4) {
      // ---- 状态 4 带路（cs:48744-48925 1:1）：达宝箱 5×5px 盒 → 态 5 终演;
      //      距玩家 >300 → 等待臂（>360 追人 DirectionFrom×−0.1 + Pixie 1/30 /
      //      <330 回宝箱 DirectionTo×0.1;总速钳 1;开域落地窗 noTileCollide=false
      //      + 上拍碰撞旗反弹——原版同拍读上拍旗,仓内同构）;≤300 → 直飞
      //      （DirectionTo(盒最近点) ×3/>150 ×2/>80 lerp 0.07 + 鸟飞建议(4,2,
      //      vy 钳[−1,1],ai3<300 门) + 卡墙计数）。旧实装=0.1 累加+总速钳 6（原版
      //      等待臂钳 1/直飞臂 ≤3）+ 到达盒误 80×80（原版 5×5px,BJ434 修）----
      this.noTileCollide = true;
      if (player && player.dead) {
        this.ai2 = 1; this.ai3 = 0;
        this.facing = player.cx > this.cx ? -1 : 1;
        if (this.vx * this.facing < 0) this.vx = this.facing * 2;
      } else {
        const tx = this.ai0 * TILE + 8, ty = this.ai1 * TILE + 8;
        // 到达宝箱 5×5px 盒（cs:48774 CenteredRect(tile 中心,Vector2.One×5)）→ 终演
        if (this.x < tx + 2.5 && this.x + this.w > tx - 2.5
          && this.y < ty + 2.5 && this.y + this.h > ty - 2.5) {
          this.ai2 = 5; this.ai3 = 0;
          this.fairyDanceDir = this.facing;
        } else if (player) {
          const dp = Math.hypot(player.cx - this.cx, player.cy - this.cy);
          if (dp > 300) {
            // 等待臂（cs:48777-48807）:开域落地窗（原版 :48779-48785）
            if (dp < 400 && !solidBoxOverlap(st, this.x, this.y, this.w, this.h)) {
              this.noTileCollide = false;
              if (this.hitWall) this.vx *= -1;
              if (this.collideY) this.vy *= -1;
            }
            this.facing = player.cx > this.cx ? 1 : -1;
            danceFace = true;
            const awayX = this.cx - player.cx, awayY = this.cy - player.cy;   // DirectionFrom(player)
            const m = Math.hypot(awayX, awayY) || 1;
            if (dp > 360) {
              this.vx += -awayX / m * 0.1;   // DirectionFrom×−0.1 = 追向玩家（:48791-48794）
              this.vy += -awayY / m * 0.1;
              if (Math.random() < 1 / 30) game.playSfxWav?.('Pixie', 1, this.cx, this.cy);   // :48798 音27=Pixie
            } else if (dp < 330) {
              // 回宝箱最近点（:48796-48800 DirectionTo(destination)×0.1）
              const qx = Math.min(Math.max(this.cx, tx - 2.5), tx + 2.5);
              const qy = Math.min(Math.max(this.cy, ty - 2.5), ty + 2.5);
              const ddx = qx - this.cx, ddy = qy - this.cy;
              const dd = Math.hypot(ddx, ddy) || 1;
              this.vx += ddx / dd * 0.1;
              this.vy += ddy / dd * 0.1;
            }
            const spd = Math.hypot(this.vx, this.vy);
            if (spd > 1) { this.vx /= spd; this.vy /= spd; }   // :48805 总速钳 1
          } else {
            // 直飞臂（cs:48809-48925）
            const qx = Math.min(Math.max(this.cx, tx - 2.5), tx + 2.5);
            const qy = Math.min(Math.max(this.cy, ty - 2.5), ty + 2.5);
            const dx = qx - this.cx, dy = qy - this.cy;
            const d = Math.hypot(dx, dy) || 1;
            let sx = dx / d, sy = dy / d;
            if (d > 150) { sx *= 3; sy *= 3; }               // :48910 num11>150 ×3
            else if (d > 80) { sx *= 2; sy *= 2; }           // :48912 >80 ×2
            this.vx += (sx - this.vx) * 0.07;   // Lerp(velocity, value2, 0.07)
            this.vy += (sy - this.vy) * 0.07;
            const txi = Math.floor(this.cx / TILE), tyi = Math.floor(this.cy / TILE);
            if (this.ai3 < 300) {
              const bf = fairyBirdFlight(st, this.facing, txi, tyi, 4, 2);
              if (bf.down) this.vy += 0.05;
              if (bf.up) this.vy -= 0.05;
              if (this.vy > 1) this.vy = 1;
              if (this.vy < -1) this.vy = -1;
            }
            if (st.inBounds(txi, tyi)) {
              if (st.isSolid(txi, tyi)) this.ai3 = Math.min(this.ai3 + 2, 400);
              else this.ai3 = Math.max(this.ai3 - 1, 0);
            }
          }
        }
      }
    } else if (this.ai2 === 5) {
      // ---- 状态 5 终演（cs:48897-49005 1:1）：fairyAge=0 停寿龄;≤15t 收势（音 27@15）;
      //      圆舞 50t 步（Δ=0.02）+ 摆轴/摆幅 50t 相位摆（cos(num5)·2π/16、
      //      cos(2·num5)·10+8,range [−2,18]）;>200t → 消散 + FairyEffects
      //      （尘 278×40 爆散 + 音 Item4）。原版 flag2 失效门（:48903-48907）为死码
      //      ——无提前毕,旧仓提前毕=自造偏差（BJ434 撤,目标被挖时照舞满 200t）----
      this.noTileCollide = true;
      this.fairyAge = 0;   // localAI[1]=0(cs:49058 逐 tick 清=终演期不累计寿龄)
      if (this.ai3 === 15) game.playSfxWav?.('Pixie', 1, this.cx, this.cy);   // :48913 音27=Pixie
      if (this.ai3 <= 15) { this.vx *= 0.9; this.vy *= 0.9; }
      else {
        // 圆舞同态 3 但 50t 步 + 相位摆;面向玩家+尾写门（cs:49073-49091）
        if (player && !player.dead) { this.facing = player.cx > this.cx ? 1 : -1; danceFace = true; }
        const num3 = this.ai3 - 15;
        const num5 = Math.floor(num3 / 50);
        let rot = Math.cos(num5) * (Math.PI * 2) / 16;      // :49048 num2
        const h = Math.cos(num5 * 2) * 10 + 8;              // :49049 num4
        rot *= this.fairyDanceDir;
        const o1 = fairyCircleOffset(num3 / 50, rot, h, this.fairyDanceDir);
        const o2 = fairyCircleOffset(num3 / 50 + 0.02, rot, h, this.fairyDanceDir);
        this.vx = o2[0] - o1[0];
        this.vy = o2[1] - o1[1];
      }
      this.ai3 += 1;
      if (this.ai3 > 200) {
        // FairyEffects（:49021-49052）：尘 278×40 Lerp 主色/副色 0.65 scale 爆散
        const fairyCols: Record<number, [string, string]> = {
          583: ['#FF69B4', '#FFB6C1'], 584: ['#32CD32', '#20B2AA'], 585: ['#4169E1', '#ADD8E6'],
        };
        const [c1, c2] = fairyCols[this.vanillaId ?? 583] ?? fairyCols[583];
        for (let k = 0; k < 40; k++) {
          const col = k % 2 === 0 ? c1 : c2;
          game.spawnParticles(this.cx, this.cy, col, 1, 2.2, { life: 32, grav: 0, size: 2 });
        }
        game.playSfxFiles?.(['Item_4'], 1, this.cx, this.cy);
        this.dead = true; return;
      }
    } else if (this.ai2 === 6) {
      // ---- 状态 6 找不到宝箱（cs:48746-48790 1:1）：>100px 回态 2 重试;开域落地窗
      //      （同态 4）;>20px 逐轴 0.04 漂移（|vy|>2 ×0.95 阻尼,无总速钳——原版同式,
      //      旧仓 vy ±2 硬钳=自造）;宝箱重搜【逐 tick】（原版 :48917-48923 无节流,
      //      旧 150t 门=自造,BJ434 撤——节流会让仙灵漏看玩家身边新宝箱 2.5s）----
      this.noTileCollide = true;
      if (player) {
        const dx = player.cx - this.cx, dy = player.cy - this.cy;
        const d = Math.hypot(dx, dy);
        if (d > 100) { this.ai2 = 2; this.ai3 = 0; }
        else {
          if (!solidBoxOverlap(st, this.x, this.y, this.w, this.h)) {
            this.noTileCollide = false;
            if (this.hitWall) this.vx *= -1;
            if (this.collideY) this.vy *= -1;
          }
          if (d > 20) {
            this.vx += (dx > 0 ? 1 : -1) * 0.04;   // :48870-48872（>0?1:−1,非 Math.sign）
            this.vy += (dy > 0 ? 1 : -1) * 0.04;
            if (Math.abs(this.vy) > 2) this.vy *= 0.95;
          }
          const treasure = fairyTreasureCoords(st, this.cx, this.cy);
          if (treasure) {
            this.ai0 = treasure[0]; this.ai1 = treasure[1];
            this.ai2 = 3; this.ai3 = 0;
            this.fairyDanceDir = this.facing;
          }
        }
      }
    } else if (this.ai2 === 7) {
      // ---- 状态 7 离场（cs:48950-48958 1:1）：加速飞离 + EncourageDespawn(10)
      //      （曾缺=寿满飞离只能靠离屏自然倒数,原版封顶 10t 快速消散,BJ434 补）----
      this.noTileCollide = true;
      this.vx += 0.05 * this.facing;
      this.vx = Math.max(-10, Math.min(10, this.vx));
      this.vy -= 0.025;
      this.vy = Math.max(-5, Math.min(5, this.vy));
      this.encourageDespawn(10);
    }
    // ---- 免疫旗（cs:49119,状态机尾无条件重算）：引导/逃逸/圆舞/离场态（ai[2]>1）
    //      双旗全置,微漂/潜伏态（ai[2]≤1）双旗全清——原版 dontTakeDamage 与
    //      dontTakeDamageFromHostiles 一式同掷（状态机后、尘段前）。★BJ450 消费面
    //      接线（旧档整缺=引导态仙灵可被磨死/接触伤）----
    this.dontTakeDamage = this.dontTakeDamageFromHostiles = this.ai2 > 1;
    // ---- 呼吸闪粉尘 278（cs:49139-49161）：每 2 视效 tick 一粒,8×8 盒 @Center−2、
    //      v=本速×0.3（spawn 自带 ±2 随机漂,后置覆写精确化）、scale 0.65、α 200、
    //      noGravity/noLight;色 = Lerp(主色,副色,rand) ----
    if (game.vanillaDust && visEffectFrames() % 2 === 0) {
      const pal = this.vanillaId === 584 ? [[50, 205, 50], [32, 178, 170]]
        : this.vanillaId === 585 ? [[65, 105, 225], [173, 216, 230]]
        : [[255, 105, 180], [255, 182, 193]];
      const k = Math.random();
      const c = {
        r: Math.round(pal[0][0] + (pal[1][0] - pal[0][0]) * k),
        g: Math.round(pal[0][1] + (pal[1][1] - pal[0][1]) * k),
        b: Math.round(pal[0][2] + (pal[1][2] - pal[0][2]) * k),
        a: 255,
      };
      const d = game.vanillaDust.spawn(this.cx - 2, this.cy - 2, 8, 8, 278,
        this.vx * 0.3, this.vy * 0.3, 200, c, 0.65);
      if (d) { d.noGravity = true; d.noLight = true; d.vx = this.vx * 0.3; d.vy = this.vy * 0.3; }
    }
    if (!danceFace) this.facing = this.vx > 0 ? 1 : -1;   // cs:49134-49138 flag 门
    this.preCollideVy = this.vy;   // oldVelocity 快照(:93739)——下一 tick 撞顶反向用
    if (this.noTileCollide) {
      // ★BJ434：原版 noTileCollide 直积分（ApplyTileCollision 穿墙支 position += velocity,
      //  :93685+ 门）——旧实装置旗但 moveAndCollide 只读 tileCollide（本仓穿墙约定
      //  通道）= 引导态仍撞墙,穿墙引导名存实亡。旗清零与 moveAndCollide
      //  tileCollide=false 支同构
      this.x += this.vx; this.y += this.vy;
      this.onGround = false; this.hitWall = false; this.hitHead = false; this.collideY = false;
    } else {
      moveAndCollide(this, game.world, this.vx, this.vy);
    }
  }

  /** AI_114 蜻蜓族 595-601（AI_114_Dragonflies cs:48080）：ai[0]=0 悬停/1 突进，
   *  ai[1]=计时、ai[2]/ai[3]=锚点。悬停：v×0.94，每 60-119 帧结束；离锚 >96px →
   *  朝锚突进×3、16-96px → ×1+抖动；突进 4 帧（离锚 >112px 延长 200 帧）；
   *  向下 3 格实心/液体 → vy-=0.2 且 v×0.9、向上 30 格无实心 → v×0.9；wet → vy=-3 弹出；
   *  避敌（每 15 帧）：100px 敌/150px 玩家叠加逃逸（上限 16）并把锚点挪向逃逸方向 */
  /** AI_113 风气球 594（NPC.cs:48253-48430，SetDefaults :16638-16651 noGravity）：
   *  首帧挂载史莱姆（1/180 金 -4 / 1/10 母 -7 / 1/3 绿 -3，ai[0]=-999 冻结 :61441）
   *  + TargetClosest 定向一次（:48257——此后不再朝玩家改向，曾逐帧改向）；
   *  盒 = 20×20×ai[1]（slave scale，:48279-48282 Center 保位改尺寸）。
   *  瓦片碰撞盒（GetTileCollisionParameters :94013-94018）：x+w/2、y+(44+20×scale)、
   *  w、h+(44+20×scale)——★只罩吊挂史莱姆区（气球本体不撞墙）。爆条件
   *  （:48304-48318）：wet（本体或 slave）|| collideX || (collideY 且 oldVy<0=
   *  撞顶)；落地（collideY 且 oldVy>0）不爆——vy=±1 弹跳沿地面滑行（:48319-48323，
   *  曾"嵌实心即爆"近似）。爆时 X 回退 oldVx+direction×8（本体+slave）、direction
   *  翻转、vx=direction×2 → 死亡（HitEffect :82590 解冻 slave ai[0]=0 落地开打）。
   *  横速朝向加速至 2+|wind|×2；前方 8+num3 格探测升降；玩家 400px 内跟随 Y
   *  （±0.035，同向再 −0.035）。slave 亡 → 自由上飘随风（vy−0.2 钳 ±8、vx+=wind×0.3
   *  钳 ±4），collideX/Y 即爆 */
  private windyBalloonAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const wind = game.world.weather.windSpeedTarget;
    if (!this.aiInit) {
      this.aiInit = true;
      this.ai2 = 1 + Math.floor(Math.random() * 7); // ai[2] 装饰随机
      // TargetClosest（:48257，仅此一次——目标中心 X ≥ 本体取 1）
      if (player && !player.dead) this.facing = player.cx >= this.cx ? 1 : -1;
      const slave = Enemy.fromVanilla(1, this.cx, this.cy);
      if (slave) {
        // 变体覆盖（SetDefaults case -3/:7658、-4/:7668、-7/:7699：
        // SetDefaults_ForNetId(scale) + 属性/颜色/kbResist 覆写）。
        // kbResist 乘子（:7665/:7675/:7705）直乘"承受比例"（def 已存原版语义）
        const kbMul = (m: number) => {
          slave.def.knockbackResist = Math.max(0, slave.def.knockbackResist * m);
        };
        const r = Math.random();
        if (r < 1 / 180) { // 金史莱姆 -4：scale 0.6/dmg 5/def 5/hp 150/kb×1.4
          //（曾除以已更新的 vanillaScale → 缩放自抵消不缩身，已改同 -7/-3 直乘）
          slave.w = Math.round(slave.w * 0.6); slave.h = Math.round(slave.h * 0.6);
          slave.vanillaScale = 0.6;
          slave.hp = slave.maxHp = 150; slave.def.damage = 5; slave.def.defense = 5;
          slave.colorRGBA = [250, 30, 90, 90]; kbMul(1.4);
        } else if (r < 1 / 10) { // 母史莱姆 -7（SetDefaults case -7 :7699：scale 1.2/
          // damage 12/defense 6/life 40/kbResist×0.9/color 200,0,255,150——曾近似成纯 scale 1.05）
          slave.vanillaScale = 1.2; slave.w = Math.round(slave.w * 1.2); slave.h = Math.round(slave.h * 1.2);
          slave.hp = slave.maxHp = 40; slave.def.damage = 12; slave.def.defense = 6;
          slave.colorRGBA = [200, 0, 255, 150]; kbMul(0.9);
        } else if (r < 1 / 3) { // 绿史莱姆 -3
          slave.vanillaScale = 0.9; slave.w = Math.round(slave.w * 0.9); slave.h = Math.round(slave.h * 0.9);
          slave.hp = slave.maxHp = 14; slave.def.damage = 6; slave.def.defense = 0;
          slave.colorRGBA = [0, 220, 40, 100]; kbMul(1.2);
        }
        slave.ai0 = -999; // 挂载冻结标记（slimeAI 首行放行）
        slave.id = (game as unknown as { entities: { nextId: number; add(e: unknown, b: string): void } }).entities.nextId++;
        (game as unknown as { entities: { add(e: unknown, b: string): void } }).entities.add(slave, 'enemies');
        this.ai3 = slave.id;
        this.vanillaScale = slave.vanillaScale ?? 1; // ai[1] = slave.scale（气球随之缩放）
      }
    }
    const scale = this.vanillaScale ?? 1;
    const enemies = game.enemies() as Enemy[];
    const slave = enemies.find((n) => n.id === this.ai3 && !n.dead && n.vanillaId === 1 && n.ai0 === -999) ?? null;
    // 盒 = 20×20×scale（:48279-48282，Center 保位）
    {
      const nw = Math.round(20 * scale), nh = Math.round(20 * scale);
      if (nw !== this.w || nh !== this.h) {
        const cx0 = this.cx, cy0 = this.cy;
        this.w = nw; this.h = nh;
        this.x = cx0 - nw / 2;
        this.y = cy0 - nh / 2;
      }
    }
    this.visAngle = this.vx * 0.05; // rotation（:48284）
    // 上一 tick 瓦片碰撞旗标 + 碰撞前速度（原版 collideX/collideY/oldVelocity 语义：
    // 本仓 moveAndCollide 探测旗标存于本体，lai1/lai2 承接碰撞前 vy/vx）
    const collideX = this.hitWall;
    const collideY = this.onGround || this.hitHead;
    const oldVx = this.lai2, oldVy = this.lai1;
    const pop = (shift: boolean) => {
      // 爆支（:48304-48318 / :48416-48428）：X 回退 oldVx+direction×8（本体+slave）、
      // direction 翻转、vx=direction×2 → HitEffect(:82590 解冻) + 死亡
      if (shift) {
        const num4 = oldVx + this.facing * 8;
        this.x -= num4;
        if (slave) slave.x -= num4;
        this.facing *= -1;
        this.vx = this.facing * 2;
      }
      if (slave) { slave.ai0 = 0; slave.y -= 10; } // HitEffect :82590 解冻落地
      this.dead = true;
      game.playSfxFiles?.(this.def.killedSound, 1, this.cx, this.cy);
    };
    if (slave) {
      // ---- 爆/弹跳（:48304-48323）----
      if (this.wet || slave.wet || collideX || (collideY && oldVy < 0)) { pop(true); return; }
      if (collideY) this.vy = oldVy > 0 ? 1 : -1;   // 落地/撞顶 ±1 弹跳（TargetClosest(false) 无向变）
      const dir = this.facing;
      const num5 = 2 + Math.abs(wind) * 2;
      if (Math.sign(this.vx) !== dir || Math.abs(this.vx) < num5) {
        this.vx += dir * 0.01;
        if (this.vx * dir < 0) this.vx += Math.abs(this.vx) > num5 ? dir * 0.1 : dir * 0.05;
        else if (Math.abs(this.vx) > num5) this.vx = dir * num5;
      }
      // 目标相对本体底边的高差（cs:48292-48303）：zero = 目标中心 − 本体底边；
      // 目标在上(zy<0)时 num3 = (int)zy / -16（目标高出本体底边多少格）；
      // num2 = zero.Length()（底边到目标中心的距离，非中心距）；direction 与目标方位
      // 不一致则 num3 归 0
      let num3 = 0, num2 = Infinity;
      if (player && !player.dead) {
        const zx = player.cx - this.cx;
        const zy = player.cy - (this.y + this.h);
        if (zy < 0) num3 = Math.trunc(Math.trunc(zy) / -16);
        num2 = Math.hypot(zx, zy);
        if (dir !== Math.sign(zx)) num3 = 0;
      }
      // 前方探测（num6/num7，cs:48344-48364：深度 num8 = 8 + num3，
      // 近距判定线 num7 + 5 + num3）
      const num6 = Math.floor((this.x + this.w / 2) / TILE) + dir;
      const num7 = Math.floor((this.y + this.h) / TILE);
      const num8 = 8 + num3;
      let open = true, near = false;
      for (let i = num7; i < num7 + num8; i++) {
        if (!st.inBounds(num6, i)) break;
        const ii = st.idx(num6, i);
        if (st.isSolid(num6, i) || st.liquid[ii] > 0) {
          if (i < num7 + 5 + num3) near = true;
          open = false;
          break;
        }
      }
      // 目标 400px 内且有视线（cs:48365-48408）→ 跟随 Y：±0.035，且减后仍同号再 ±0.035
      //（原版两段 if，曾并成单段 0.07 边界不同）；比较位 = Center.Y+h/4 对 position.Y+h/4
      if (num2 < 400 && player && this.canSeePlayer(st, player)) {
        const by = this.cy + this.h / 4, py = player.cy - player.h / 4;
        if (by > py && this.vy > -2) {
          this.vy -= 0.035;
          if (this.vy > 0) this.vy -= 0.035;
        } else if (by < py && this.vy < 2) {
          this.vy += 0.035;
          if (this.vy < 0) this.vy += 0.035;
        }
      } else {
        if (open) this.vy += 0.05; else this.vy -= 0.1;
        if (near) this.vy -= 0.2;
        this.vy = Math.max(-4, Math.min(2, this.vy));
      }
    } else {
      // 无 slave：自由上飘随风（:48412-48415）
      this.vy = Math.max(-8, Math.min(8, this.vy - 0.2));
      this.vx = Math.max(-4, Math.min(4, this.vx + wind * 0.3));
      if (collideX || collideY) { pop(true); return; }
    }
    // ---- 瓦片碰撞积分（GetTileCollisionParameters :93955-93963 + :93808 共享段）----
    // 盒 = Y+ext/Height+ext（ext = 44+20×scale,罩吊挂史莱姆区）+ **X 移中心后宽度改
    // (6+26×scale) 居中窄条**（cPosition.X += cWidth/2; cWidth = (int)(6f+26f*ai[1]);
    // cPosition.X -= cWidth/2）——曾漏宽度改窄且漏居中回移 = 盒自中心起右移半宽
    // （左半无碰撞沉墙/右半提前挡停 = 气球史莱姆卡地卡墙,2026-08-24 用户报）；
    // scratch Body 探测,受阻轴速度归零（TileCollision 语义）,旗标留存本体供下 tick
    const ext = 44 + 20 * scale;
    const cw = Math.trunc(6 + 26 * scale);
    const probe = {
      x: this.cx - cw / 2, y: this.y + ext, w: cw, h: this.h + ext,
      vx: this.vx, vy: this.vy, onGround: false, hitWall: false, hitHead: false,
    };
    this.lai2 = this.vx;
    this.lai1 = this.vy;
    moveAndCollide(probe, game.world, this.vx, this.vy);
    this.x = probe.x + cw / 2 - this.w / 2;
    this.y = probe.y - ext;
    this.vx = probe.vx;
    this.vy = probe.vy;
    this.onGround = probe.onGround;
    this.hitWall = probe.hitWall;
    this.hitHead = probe.hitHead;
    if (slave) {
      // slave 挂气球下（:48409 nPC.Center = Bottom + (0,−8+56×scale)）
      slave.x = this.cx - slave.w / 2;
      slave.y = this.y + this.h - 8 + 56 * scale - slave.h / 2;
      slave.vx = this.vx; slave.vy = this.vy;
    }
  }

  /** AI_125 笨笨气球史莱姆 686（NPC.cs:44009-44139 1:1）：noGravity+noTileCollide
   *  漂浮体（原版 SetDefaults :17559-17570：lifeMax 1/damage 0）——水平朝
   *  direction 加速 0.04 至 3+|wind|×2；垂直两态：玩家 400px 内且 CanHit →
   *  ±0.035 追平高度（±2 钳内），否则前方一列（中心+direction）自底向下扫
   *  8+num2 格——实心/液体命中 5+num2 内=近距；开阔 vy+0.05 / 有阻 vy-0.1 /
   *  近距再 -0.2，钳 [-4,2]。湿 → 爆裂死亡（原版另含 collideX/collideY↑ 两支
   *  ——noTileCollide 下恒 false 不可达；本仓以"嵌入实心"为 collideX 的生成
   *  兜底等价）。死链 Transform(680)+解锁旗在 Game.onEnemyKilled 686 支。 */
  private balloonSlimeAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    if (player && !player.dead) this.facing = player.cx >= this.cx ? 1 : -1;
    const dir = this.facing;
    this.visAngle = this.vx * 0.05;                     // rotation（cs:44019）
    if (this.inWater
      || st.isSolid(Math.floor(this.cx / TILE), Math.floor((this.y + 4) / TILE))) {
      // life=-1+active=false → CheckDead 死链——走 die()（hurt 死亡管线）保证
      // onEnemyKilled 触发（Game 侧 686 支 = Transform(680)+解锁旗+气球碎粒子）
      this.die(game);
      return;
    }
    // 水平（cs:44055-44070）：加速 0.04；逆行段 0.15/0.1 补偿（125 档，比 113 的
    // 0.01/0.1/0.05 快——两气球非同参）
    const num4 = 3 + Math.abs(game.world.weather.windSpeedTarget) * 2;
    if (Math.sign(this.vx) !== dir || Math.abs(this.vx) < num4) {
      this.vx += dir * 0.04;
      if (this.vx * dir < 0) this.vx += Math.abs(this.vx) > num4 ? dir * 0.15 : dir * 0.1;
      else if (Math.abs(this.vx) > num4) this.vx = dir * num4;
    }
    // 目标高差（cs:44017-44031）：zero = 目标中心 − 本体底边；目标在上时
    // num2 = 高出格数；direction 与目标方位不一致则归 0
    let num2 = 0, dist = Infinity;
    if (player && !player.dead) {
      const zx = player.cx - this.cx, zy = player.cy - (this.y + this.h);
      if (zy < 0) num2 = Math.trunc(Math.trunc(zy) / -16);
      dist = Math.hypot(zx, zy);
      if (dir !== Math.sign(zx)) num2 = 0;
    }
    // 前方一列下扫（cs:44072-44092）：深度 8+num2，近距线 5+num2
    const num5 = Math.floor((this.x + this.w / 2) / TILE) + dir;
    const num6 = Math.floor((this.y + this.h) / TILE);
    let open = true, near = false;
    for (let i = num6; i < num6 + 8 + num2; i++) {
      if (!st.inBounds(num5, i)) break;
      const ii = st.idx(num5, i);
      if ((st.flags[ii] !== 0 && st.isSolid(num5, i)) || st.liquid[ii] > 0) {
        if (i < num6 + 5 + num2) near = true;
        open = false;
        break;
      }
    }
    // 垂直（cs:44093-44138）
    if (player && !player.dead && dist < 400
      && canHit(st, this.cx, this.cy, this.w, this.h, player.cx, player.cy, player.w, player.h)) {
      if (this.cy + this.h / 4 > player.cy + player.h / 4 && this.vy > -2) {
        this.vy -= 0.035;
        if (this.vy > 0) this.vy -= 0.035;
      } else if (this.cy + this.h / 4 < player.cy + player.h / 4 && this.vy < 2) {
        this.vy += 0.035;
        if (this.vy < 0) this.vy += 0.035;
      }
    } else {
      if (open) this.vy += 0.05;
      else this.vy -= 0.1;
      if (near) this.vy -= 0.2;
      if (this.vy > 2) this.vy = 2;
      if (this.vy < -4) this.vy = -4;
    }
    this.x += this.vx;
    this.y += this.vy;
  }

  /** AI_119 蒲公英 628（NPC.cs:47344-47429）：非风日（!IsItAHappyWindyDay =
   *  Main._shouldUseWindyDayMusic，Main.cs:2976）快速消散 timeLeft=10；TargetClosest
   *  Downwind 600px + |dy|<100 + 顺风 → 喷籽态 ai[0]=1。喷籽态【500px 门】
   *  （:47363-47369 localAI[0]：num2<500 才置 1，否则计数冻结直接 return——
   *  曾无门 = 600px 边缘空转计时）；计数 >80 回待机，==40 发 1+Next(3) 枚种子：
   *  速 = (dir×2,−2) + (dir×Next(−2,10), 10+Next(−6,6))×0.25（vy 保底 −3），
   *  出生点 = Center + vector 再 X+dir×6（:47411-47412——曾漏 vector 偏移） */
  private dandelionAI(game: GameHooks, player: Player | null) {
    // ai0===0/1 等值门：类默认 -1120 会全空转 = 蒲公英永不喷籽（2026-08-13 ai0陷阱清查）
    if (this.ai0 < 0) this.ai0 = 0;
    const wt = game.world.weather;
    if (!wt.shouldUseWindyDayMusic) this.encourageDespawn(10); // :47346-47349
    // flag（:47353-47362）：TargetClosestDownwindFromNPC 600 → 有玩家目标才计算
    //  （无玩家 flag=false：喷籽态照常回落 ai[0]=0，不 early-return——:47374-47378）
    let flag = false;
    let num = 0, num2 = 0;
    if (player && !player.dead) {
      num = player.cx - this.cx;
      num2 = Math.abs(num);
      flag = Math.abs(player.cy - this.cy) < 100 && num2 < 600
        && ((num > 0 && wt.windSpeedCurrent > 0) || (num < 0 && wt.windSpeedCurrent < 0));
    }
    if (this.ai0 === 1) {
      // localAI[0] = 距离 <500 门（:47365-47369）
      this.lai0 = num2 < 500 ? 1 : 0;
      if (!flag) {
        this.ai0 = 0;                                  // :47374-47377
      } else {
        if (this.lai0 !== 1) return;                   // :47381-47384 计数冻结
        this.lai1 += 1;                                // localAI[1] 计数（:47385）
        if (this.lai1 > 80) {
          this.ai0 = 0;                                // :47386-47389
        } else if (this.lai1 === 40) {
          // 种子（:47397-47415）
          const dir = num > 0 ? 1 : -1;
          const n = 1 + Math.floor(Math.random() * 3);
          const ents = (game as unknown as { entities: { add(e: unknown, b: string): void } }).entities;
          for (let i = 0; i < n; i++) {
            const vecX = dir * (Math.floor(Math.random() * 12) - 2);
            const vecY = 10 + Math.floor(Math.random() * 12) - 6;
            const vx = dir * 2 + vecX * 0.25;
            let vy = -2 + vecY * 0.25;
            if (vy > -3) vy = -3;
            const seedDart = new Dart(this.cx + vecX + dir * 6, this.cy + vecY, vx, vy, 7, 836);
            seedDart.hostile = true; // 628 蒲公英籽直构弹——敌怪弹（v5 bit7）
            ents.add(seedDart, 'projectiles');
          }
        }
      }
    } else if (this.ai0 === 0) {
      this.lai0 = 0;
      this.lai1 = 0;                                   // :47422-47423
      if (flag) this.ai0 = 1;                          // :47424-47427
    }
  }

  /** AI_126 雕像宝箱怪 690（NPC.cs:43760-44010）：SetDefaults immortal+dontTakeDamage
   *  （:17615，fromVanilla 侧已置 dontTakeDamage）。伪装态 ai[0]=0：timeLeft=60 恒续命、
   *  direction 冻结、玩家 96px+CanHit 唤醒；每 10t 屏外向玩家屏带内更近落点传送
   *  （候选=双格实心底+净空3+不可见，SolidTile2 下扫 ≤10）。激活态：Scare 惊吓音 →
   *  地面 ai[2] 倒数 20 节奏跳（vy=-9.01-高差/40 钳10、vx=(4+|dx|/50 钳12)×dir）；
   *  跳跃/上升/玩家正上 noTileCollide 穿墙（直接位移）；玩家正下俯冲 vy=16；

   *  玩家死 Laugh+300t 强制俯冲。绘制侧恒为雕像形态（Tiles_105 切片，见 Renderer）。 */
  private statueMimicAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    if (this.ai0 < 0) this.ai0 = 0;                       // 类默认 -1120 → 伪装态 0（ai0 初值坑）
    if (!this.aiInit) {
      // 首帧：ai[1] = 随机雕像样式（localAI[1] 分支 :43771-43775 ←
      // WorldGen.GetRandomStatueStyleForStatueMimics :37934 Next(83) 拒绝 43-49）
      this.aiInit = true;
      let s = Math.floor(Math.random() * 83);
      while (s >= 43 && s <= 49) s = Math.floor(Math.random() * 83);
      this.ai1 = s;
    }
    // 位置参考 = 真身（含尸体——原版 Main.player[target] 不因死亡失位；主 switch 传参
    // 玩家死亡即 null，故走 targetRef 兜底，与 case 4 EoC 例外同型）。
    // M11：Main.player[target] = 当前索敌目标（联机可为访客代理）
    const pp: Player | null = this.targetRef(game, player);
    const alive = !!pp && !pp.dead;
    const tgt = alive ? pp : null;
    if (this.ai0 === 0) {
      // 伪装态：不消散（原版 timeLeft=60 每帧续命 :43765）
      this.despawnTimer = 750;
      this.despawnEncouraged = false;
      if (tgt && Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy) < 96 && this.canSeePlayer(st, tgt)) {
        this.ai0 = 1;                                     // 唤醒（:43780-43788）
        this.dontTakeDamage = false;                      // immortal=false（:43873）
        this.immortal = false;                            // 显身同拍（:44017 immortal=false——显身后 DoT 可伤）
        game.playSfx('statueMimicScare', 0.8, this.cx, this.cy);
        return;
      }
      // 屏外传送（1458 NPC.cs AI_126_StatueMimic :43912-43977，本体不可见才动）。
      // 可见门 = CanAnyPlayerSeeThisTile(:43877-43890)：以测点为中心 sWidth+32×
      // sHeight+32 屏盒 ∩ 任一活跃玩家命中盒——⑥清偿(2026-08-31)：固定 62×35 格
      // 单人近似 → 真实视口盒+全候选玩家求交（原版传格点取整坐标,此处像素点,
      // ≤16px 取整差登记）;band ±sWidth/2 同源视口尺寸（原文 num=0）
      if (++this.lai0 < 10) return;
      this.lai0 = 0;
      if (!tgt) return;
      const scr6 = game.screenWorldSize?.() ?? { w: 1920, h: 1080 };
      if (this.canAnyPlayerSeeThisTile(game, this.cx, this.y + this.h)) return;
      const halfW = scr6.w / 2, halfH = scr6.h / 2;
      let x2: number, x3: number;
      if (Math.abs(tgt.cx - this.cx) < halfW) { x2 = (tgt.cx - halfW) / TILE; x3 = (tgt.cx + halfW) / TILE; }
      else if (tgt.cx < this.cx) { x2 = (tgt.cx + halfW) / TILE; x3 = this.cx / TILE; }
      else { x2 = this.cx / TILE; x3 = (tgt.cx - halfW) / TILE; }
      let y4: number, y5: number;
      if (Math.abs(tgt.cy - this.cy) < halfH) { y4 = (tgt.cy - halfH) / TILE; y5 = (tgt.cy + halfH) / TILE; }
      else if (tgt.cy < this.cy) { y4 = (tgt.cy + halfH) / TILE; y5 = this.cy / TILE; }
      else { y4 = this.cy / TILE; y5 = (tgt.cy - halfH) / TILE; }
      // ★G1谓词批(2026-09-04)：落点基座= WorldGen.SolidTile2（NPC.cs:43891 →
      //  WorldGen.cs:71023 active&&!inActive&&tileSolid[+坡/半砖细支]）——手搓 flags
      //  读漏 !inActive 半边（已致动实心会被当落地基座）→ 改 st.isSolid()（active+
      //  致动位+实心 LUT 同核;坡/半砖细支为既有近似,非本批面）
      const solid2 = (tx: number, ty: number): boolean => st.isSolid(tx, ty);
      const clearAbove = (tx: number, ty: number): boolean => {   // IsThisAGoodPlaceForAStatueMimic（:43751）
        for (let dy = 1; dy <= 3; dy++) {
          if (!st.inBounds(tx, ty - dy)) continue;
          if (st.flags[st.idx(tx, ty - dy)] !== 0) return false;
        }
        return true;
      };
      for (let attempt = 10; attempt > 0; attempt--) {
        const cx0 = Math.floor(x2 + Math.random() * (x3 - x2));
        let cy0 = Math.floor(y4 + Math.random() * (y5 - y4));
        let ground = -1;
        for (let i = 0; i < 10; i++) {                     // 下扫找双格实心底
          if (solid2(cx0, cy0) && solid2(cx0 + 1, cy0)) { ground = cy0; break; }
          cy0++;
        }
        if (ground < 0 || !clearAbove(cx0, ground) || !clearAbove(cx0 + 1, ground)) continue;
        if (this.canAnyPlayerSeeThisTile(game, (cx0 + 1) * TILE, ground * TILE)) continue;   // :43986
        const nx = cx0 * TILE + TILE - this.w / 2, ny = ground * TILE - this.h;
        const dNew = Math.hypot(nx + this.w / 2 - tgt.cx, ny + this.h / 2 - tgt.cy);
        const dOld = Math.hypot(this.cx - tgt.cx, this.cy - tgt.cy);
        if (dNew < dOld) {
          if (nx < this.x) this.facing = -1;               // direction 朝来向（:43872-43876）
          else if (nx > this.x) this.facing = 1;
          this.x = nx; this.y = ny; this.vx = 0; this.vy = 0;
          return;
        }
      }
      return;
    }
    // ---- 激活态（:43872-44010）----
    let jump = false;
    if (tgt && this.vy > 0 && this.y > tgt.y + tgt.h) {
      // 下落中且已落到玩家脚下（Top>玩家 Bottom）且身体陷实心 → 立即再跳
      const bx0 = Math.floor(this.x / TILE), bx1 = Math.floor((this.x + this.w - 0.01) / TILE);
      const by0 = Math.floor(this.y / TILE), by1 = Math.floor((this.y + this.h - 0.01) / TILE);
      let inSolid = false;
      outer: for (let tx = bx0; tx <= bx1; tx++) for (let ty = by0; ty <= by1; ty++) {
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { inSolid = true; break outer; }
      }
      if (inSolid) {
        jump = true;
        game.playSfx('statueMimicJump', 0.3, this.cx, this.cy);
      }
    } else if (this.vy === 0) {
      // 地面节奏：ai[2]==20 预告音 → 递减 → ≤0 重置 20 并跳（首落地 ai2=0 立即跳）
      if (this.ai2 === 20) game.playSfx('statueMimicJump', 0.3, this.cx, this.cy);
      this.vx = 0;
      if (--this.ai2 <= 0) { this.ai2 = 20; jump = true; }
    }
    // flag3：与玩家水平重叠（:43912-43925，尸体照算）；本体底在玩家顶上方时削弱横/升速
    let overX = false;
    if (pp && this.x + this.w >= pp.x && this.x <= pp.x + pp.w) {
      if (this.y + this.h < pp.y) {
        this.vx *= 0.75;
        if (this.vy < 0) this.vy *= 0.75;
      }
      overX = true;
    }
    if (!alive) {
      // 玩家死亡：Laugh（ai[3]==0 播一次）+ >200t 强制 flag3 俯冲撤离（:43926-43938）
      if (this.ai3 === 0) { game.playSfx('statueMimicLaugh', 0.8, this.cx, this.cy); this.ai3 = 300; }
      if (this.ai3 > 200) { overX = true; this.ai3 -= 1; }
    } else if (this.ai3 > 0) this.ai3 -= 1;
    if (jump) {
      // 跳跃（:43940-43955）：noTileCollide 穿墙直接位移；
      // vy = -9.01 - (Bottom差/40 钳 0..10，死亡取 0)；vx = (4+|dx|/50 钳 12)×direction
      let dir = this.facing;
      if (pp) dir = Math.sign(pp.cx - this.cx) || 1;
      this.facing = dir;
      let lift = 0;
      if (pp && alive) lift = Math.max(0, Math.min(10, (this.y + this.h - (pp.y + pp.h)) / 40));
      this.vy = -9.01 - lift;
      const drive = pp ? Math.min(12, Math.abs(this.cx - pp.cx) / 50) : 12;
      this.vx = (4 + drive) * dir;
      this.x += this.vx;
      this.y += this.vy;
      return;
    }
    // 非跳跃帧（:43958-44008）：vy==0 立返；玩家正下俯冲 vy=16；
    // 否则下落加重力 + 朝向越顶衰减 ×0.96（活玩家才衰减）
    if (this.vy === 0) return;
    let phase: boolean | null = null;                      // 本帧 noTileCollide 目标态
    if (!alive && overX && pp && this.y + this.h < pp.y + pp.h) {
      this.vy = 16;                                        // 死亡撤离俯冲（Bottom < 尸体 Bottom）
      phase = true;
    } else if (overX && pp && this.y + this.h < pp.y) {
      this.vy = 16;                                        // 玩家正下俯冲
      phase = true;
    } else {
      if (this.vy > 0) this.applyGravity(game);
      if (alive && pp) {
        if (this.facing > 0 && this.cx > pp.cx) { this.vx *= 0.96; this.vy *= 0.96; }
        if (this.facing < 0 && this.cx < pp.cx) { this.vx *= 0.96; this.vy *= 0.96; }
      }
      // noTileCollide：上升 或 (水平重叠且在玩家上方) → 穿墙；身体离实心 → 复原
      if (this.vy < 0 || (overX && pp && this.y + this.h < pp.y)) phase = true;
    }
    if (phase === null) {
      const bx0 = Math.floor(this.x / TILE), bx1 = Math.floor((this.x + this.w - 0.01) / TILE);
      const by0 = Math.floor(this.y / TILE), by1 = Math.floor((this.y + this.h - 0.01) / TILE);
      let inSolid = false;
      outer2: for (let tx = bx0; tx <= bx1; tx++) for (let ty = by0; ty <= by1; ty++) {
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { inSolid = true; break outer2; }
      }
      // 原版仅在 !SolidCollision 时清 noTileCollide（陷实心维持穿墙态防卡墙）
      phase = !inSolid;
    }
    if (phase) { this.x += this.vx; this.y += this.vy; }   // 穿墙直接位移
    else moveAndCollide(this, game.world, this.vx, this.vy);
  }


  /** CritterThatCanTurnOnPlayers（NPCID.cs:4779：宝石鼠兔 639-645/地狱三小 538-539/
   *  金龟 299）——GetHurtByOtherNPCs 门（:93607）排除项（∧aiStyle==3） */
  private static readonly CRITTER_CAN_TURN = new Set([645, 639, 644, 642, 643, 641, 640, 299, 539, 538]);

  /** ★BJ454 NPCID.Sets.TakesDamageFromHostilesWithoutBeingFriendly（1457
   *  NPCID.cs:4783 全表 96 项 1:1，序保真）——非 friendly NPC 的「敌意可伤」置表：
   *  全版小动物族（兔 46/55/74、鸟 148/149/230/297/298/299、鼠 303、海鸥 355-367、
   *  松露虫 374、金小动物 442-448、地狱/宝石/蝴蝶萤火 538-540/592-609/611-617/
   *  625-627/639-655/669/671-677、末日前夕 687/688 等）。消费点全原版唯一：
   *  受害 tick 门 NPC.cs:91592 `type != 37 && (friendly || T-set[type])` →
   *  GetHurtByOtherNPCs(AllNPCs)（敌怪互殴通道对它们可设受害者位——松露虫被
   *  敌怪追杀机制的数据面；敌怪【索敌】不读本表，接触伤害通道消费本表）。
   *  tile 域 IDG 域哨兵同款判例：域键表单点建模+金标测试钉表。 */
  static readonly TAKES_DAMAGE_FROM_HOSTILES = new Set([46, 55, 74, 148, 149, 230, 297, 298, 299, 303, 355, 356, 358, 359, 360, 361, 362, 363, 364, 365, 366, 367, 377, 357, 374, 442, 443, 444, 445, 446, 448, 538, 539, 337, 540, 484, 485, 486, 487, 592, 593, 595, 596, 597, 598, 599, 600, 601, 602, 603, 604, 605, 606, 607, 608, 609, 611, 689, 612, 613, 614, 615, 616, 617, 625, 626, 627, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 650, 651, 652, 653, 654, 655, 583, 584, 585, 669, 671, 672, 673, 674, 675, 677, 687, 688]);

  /** NPC-vs-NPC 接触双通道（NPC.cs:91534-91542 两调用点 1:1）：
   *  ① friendly/T-set 通道（:91592，AllNPCs）——本 NPC 为 friendly（Palworld 双宠、
   *    水晶 548 等）或 T-set 96 型（★BJ454，松露虫 374 等；37 老人豁免）时任意
   *    敌怪接触皆可伤（攻击者门 :93620：!friendly ∧ damage>0 ∧ 非 624/690）；
   *  ② 蜂通道（:91540，HurtingBees）——场上有蜂时蜜蜂(210/211)可蜇任意
   *    CanBeHurtByBees 的 NPC（敌怪/双宠；TownNPC 侧在 TownNPC.envHurtUpdate）。
   *  共用 GetHurtByOtherNPCs 门（:93607：dontTakeDamage/变节小动物）与
   *  immune[255]=30；BeHurtByOtherNPC 蜂段（:93666-93696）：蜂攻击者另受
   *  【victim.damage】反蜇（kb6 反向）。DamageVar≈1（Classic）直用 def.damage。 */
  private npcVsNpcContactUpdate(game: GameHooks): void {
    // GetHurtByOtherNPCs 头门（:93557）：dontTakeDamage ∥ dontTakeDamageFromHostiles
    // ∥ immortal ∥（变节小动物∧aiStyle3）——★BJ450 补 FromHostiles 支（原版三旗
    // 并列;548 演出期/仙灵引导态经此拒敌意接触伤）
    if (this.npcImmune255 !== 0 || this.dontTakeDamage
      || this.dontTakeDamageFromHostiles || this.dead) return;
    const id = this.vanillaId;
    if (id === null) return;
    // GetHurtByOtherNPCs 门（:93607-93611）：CritterThatCanTurnOnPlayers ∧ aiStyle3
    if (Enemy.CRITTER_CAN_TURN.has(id) && this.vanilla?.aiStyle === 3) return;
    // 蜂通道 victim 门（:91540-91542）：CanBeHurtByBees（除 210/211/222 全真）
    // + type1 携蜂巢变体豁免
    const beeHurtable = id !== 210 && id !== 211 && id !== 222
      && !(id === 1 && (this.ai1 === 1124 || this.ai1 === 1125));
    // 受害通道门（★BJ454 补 T-set 臂）：NPC.cs:91592 `type != 37 && (friendly ||
    // TakesDamageFromHostilesWithoutBeingFriendly[type])`——37 老人（friendly=true）
    // 显式豁免互殴通道；T-set 96 型（松露虫 374 等）非 friendly 也开 AllNPCs 通道
    const friendlyChannel = id !== 37
      // ★BJ704-G3 D10：friendly 读运行时投影（:91592 原文 `friendly || T-set`——
      //   npcCatchable 型窗内 friendly=true ⇒ 自然出生小动物首 90t 互殴通道开
      //   （敌怪接触可伤）;窗外强制 false 通道关（玩家可打/敌怪不可打的稳态反转
      //   = TemporaryCatchableNPCPlayerInvulnerability 本义）
      && (!!this.def.friendly || this.catchFriendly || Enemy.TAKES_DAMAGE_FROM_HOSTILES.has(id));
    if (!friendlyChannel && !beeHurtable) return;
    // npcsFoundForCheckActive 预门（:91540）：蜂通道需场上有蜂——懒扫等价（无蜂
    // 即无蜂攻击者，循环体自筛）；enemies 缺省 = 测试桩无实体桶，静默跳过
    const foes = (game.enemies?.() ?? []) as unknown[];
    for (const ent of foes) {
      const foe = ent as Enemy;
      if (!(foe instanceof Enemy) || foe === this || foe.dead) continue;
      // 攻击者门（:93620-93624）：!friendly ∧ damage>0 ∧ 非 624 侏儒/690 雕像
      if (foe.def.friendly || foe.def.damage <= 0) continue;
      const fid = foe.vanillaId;
      if (fid === 624 || fid === 690) continue;
      if (fid !== null && Enemy.CRITTER_CAN_TURN.has(fid)) continue;   // :93620 攻击者门尾
      const isBee = fid === 210 || fid === 211;     // acceptableNPCIDs=HurtingBees
      if (!friendlyChannel && !isBee) continue;     // 蜂通道只认蜂
      if (!(this.x < foe.x + foe.w && this.x + this.w > foe.x
        && this.y < foe.y + foe.h && this.y + this.h > foe.y)) continue;
      const dir = foe.cx > this.cx ? -1 : 1;        // :93661 攻击者在右 → 向左击退
      // 1457 :93594-93596：695/696（Palworld 双宠受难态）受 NPC 伤固定 5，
      // 不吃攻击方 damage（原版 `if (type == 695 || type == 696) num2 = 5;`）
      const contactDmg = (id === 695 || id === 696) ? 5 : foe.def.damage;
      this.hurt(contactDmg, dir * 6, 0, game, 0, false, 1);   // StrikeNPCNoInteraction
      // immune[255]=num（:93663-93664）：缺省 30,**水晶 548 特档 20**（:93653-93655
      // `int num = 30; if (type == 548) num = 20;`）——★BJ356 补:曾漏特档=水晶受击
      // 频率低 1/3（DD2 怪拆水晶节奏变慢）
      this.npcImmune255 = id === 548 ? 20 : 30;
      if (isBee) {
        // :93666-93696 蜂段：蜂受【victim.damage】反蜇（damage=0 也走 Strike
        // 管线——防后 Math.Max(1,…) 下限 1，原版同款）
        foe.hurt(this.def.damage, -dir * 6, 0, game, 0, false, 1);
        foe.npcImmune255 = 30;
      }
      break;                                        // :93631-93636 首个命中即 break
    }
  }

  /** AI_127_Pal（NPC.cs:43239-43339，1456 新增）——Palworld 联动双宠 695 Cattiva/
   *  696 Foxparks（自然刷在草/丛林草/雪/冰面上，VanillaSpawner :4281 段）：
   *  遇袭待援三态机：
   *  - 首帧（localAI[0]==0）：CultistRitual.CheckFloor2（:43248-43256，
   *    CultistRitual.cs:133-162 两列 ±6 格找"实心/平台面+上方净空"）失败即静默自灭；
   *    成功 → 两点各生成 1 只僵尸 111（Bottom=y*16-48 高 3 格落下），原版
   *    ai[3]=-(whoAmI+1) 威慑态 ← 本仓 menacePal 直引用
   *  - ai0==0 守望：双僵尸均灭 → ai0=1；否则 timeLeft 恒续命（activeTime）
   *  - ai0==1 等待：玩家距 <100px → ai0=2 救出（ai1/ai2 清零）
   *  - ai0==2 欢庆：Joy 音一次（soundDelay=-2 哨兵）；ai1 满 120 → 奖赏
   *    （695→vi_5663 Cattiva / 696→vi_5664 Foxparks，:43341-43349）+ life=0
   *    active=false 静默消散（不走死亡管线——无掉落无死亡音）
   *  - 守望期 soundDelay==0 → 随机 600-1800 后播 Pain 音（:43295-43305）；
   *    696 恒亮 (0.5,0.3,0.1)（:43330）；vx ×0.93（|vx|<0.1 归零，:43333）；
   *    spriteDirection=-direction（背对玩家瑟缩，:43244）；695 帧 FindFrame
   *    case 695（:67318-67331）：ai0==1→帧2 / ai0==2→帧1 / 默认帧0 */
  private palAI(game: GameHooks, player: Player | null) {
    if (this.ai0 < 0) this.ai0 = 0;             // 类默认 -1120 → 守望态 0（ai0 初值坑）
    // TargetClosest（:43243）+ spriteDirection = -direction → 背向玩家
    if (player) this.facing = player.cx > this.cx ? -1 : 1;
    // 首帧：CheckFloor2 失败自灭（:43246-43260）
    if (!this.aiInit) {
      this.aiInit = true;
      const pts = Enemy.checkFloor2(game.world.store, this.cx, this.cy);
      if (!pts) { this.hp = 0; this.dead = true; return; }
      for (let i = 0; i < 2; i++) {
        // NewNPC(…, spawnPoints[i].X*16+8, spawnPoints[i].Y*16-48, 111)——Bottom 锚
        const z = Enemy.fromVanilla(111, pts[i][0] * TILE + 8, pts[i][1] * TILE - 48);
        if (!z) { this.palZombies[i] = null; continue; }
        z.y = pts[i][1] * TILE - 48 - z.h;        // Bottom = (x*16+8, y*16-48)
        z.menacePal = this;                       // ai[3] = -(whoAmI+1)（:43258）
        this.palZombies[i] = z;
        addEnemy(game, z);
      }
    }
    if (this.ai0 === 0) {
      // :43268-43280 双僵尸均灭 → ai0=1；否则 timeLeft=activeTime 恒续命
      const a = this.palZombies[0], b = this.palZombies[1];
      if ((!a || a.dead) && (!b || b.dead)) this.ai0 = 1;
      else this.despawnTimer = 750;
    }
    if (this.ai0 === 1 && player && !player.dead
      && Math.hypot(player.cx - this.cx, player.cy - this.cy) < 100) {
      // :43282-43290 玩家 <100px → 救出
      this.ai0 = 2; this.ai1 = 0; this.ai2 = 0;
    }
    if (this.ai0 === 0 && this.palSndDelay === 0) {
      // :43293-43305 守望 Pain 音（随机 600-1800 间隔）
      this.palSndDelay = 600 + Math.floor(Math.random() * 1200);
      game.playSfxFiles?.([this.vanillaId === 695 ? 'pal_cattiva_pain' : 'pal_foxparks_pain'],
        0.35, this.cx, this.cy);
    }
    if (this.palSndDelay > 0) this.palSndDelay--;
    if (this.ai0 === 2) {
      // :43307-43328 欢庆：Joy 音一次（-2 哨兵）+ 120t 后奖赏+静默消散
      if (this.palSndDelay !== -2) {
        this.palSndDelay = -2;
        game.playSfxFiles?.([this.vanillaId === 695 ? 'pal_cattiva_joy' : 'pal_foxparks_joy'],
          0.35, this.cx, this.cy);
      }
      if (++this.ai1 >= 120) {
        // :43341-43349 奖赏：695→5663 Cattiva / 696→5664 Foxsparks（Item.NewItem）
        const key = VANILLA_ITEM_KEY_BY_ID[this.vanillaId === 696 ? 5664 : 5663];
        // ★BJ399 普查⑤（2026-09-29）：救援奖赏显式 -1 自然掷（NPC.cs:43481-43489
        //  AI_127_Pal_GiveRewerd `Item.NewItem(GetItemSource_Loot(), base.Center, vid,
        //  1, -1)` Vector2 中心重载第 5 参=prefix）——召唤武器词缀域（5663/5664）。
        //  骰源/形参同 BJ390 掉落族通道（isPrefixableAccessory 单源 Inventory）。
        if (key) {
          const vid = this.vanillaId === 696 ? 5664 : 5663;
          const prefix = rollNaturalPrefixForVid(vid, isPrefixableAccessory(ITEM_BY_KEY[key] ?? -1),
            () => Math.random()) || undefined;
          game.spawnDrop(this.cx, this.y, key, 1, undefined, undefined, undefined, prefix);
        }
        this.hp = 0; this.dead = true;             // life=0 + active=false（无死亡管线）
        return;
      }
    }
    // 696 恒亮（:43330-43334）；帧（695 FindFrame case 695）；尾速阻尼（:43333-43339）
    if (this.vanillaId === 696) game.addLightAt?.(this.cx, this.cy, 0.5, 0.3, 0.1);
    if (this.vanillaId === 695) this.customFrameIdx = this.ai0 === 1 ? 2 : this.ai0 === 2 ? 1 : 0;
    this.vx *= 0.93;
    if (this.vx > -0.1 && this.vx < 0.1) this.vx = 0;
  }

  /** CultistRitual.CheckFloor2（CultistRitual.cs:133-162）：中心列 ±6 格两列
   *  （i∈{-3,3}×2），每列自中心-5 到 +11 行找首个"实心面或平台"且上方 3 行
   *  净空（全宽净空 或 窄式三段净空）的格；两列均得点才算成。返回 2 点。 */
  private static checkFloor2(st: TileStore,
    cx: number, cy: number): Array<[number, number]> | null {
    const px = Math.floor(cx / TILE), py = Math.floor(cy / TILE);
    const solidTiles = (x0: number, x1: number, y0: number, y1: number): boolean => {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (!st.inBounds(x, y)) continue;
          const i = st.idx(x, y);
          if (st.flags[i] !== 0 && TileStore.SOLID_LUT[st.type[i]] === 1
            && !(st.wire[i] & TileStore.WIRE_ACTUATED)) return true;   // nactive && tileSolid && !actuated
        }
      }
      return false;
    };
    const pts: Array<[number, number]> = [];
    for (const i of [-3, 3]) {
      const x = px + i * 2;
      for (let j = -5; j < 12; j++) {
        const y = py + j;
        if (!st.inBounds(x, y)) break;
        const ti = st.idx(x, y);
        const solidFace = st.flags[ti] !== 0 && TileStore.SOLID_LUT[st.type[ti]] === 1
          && !(st.wire[ti] & TileStore.WIRE_ACTUATED);   // WorldGen.SolidTile
        // TileID.Sets.Platforms（TileID.cs:243:{19,427,435,436,437,438,439}——
        // 复审 R2 P3:曾误用站台表 {19,239,380,427}(矿石条/花盆箱混入,队伍平台漏)
        const sheet = TILE_DEFS[st.type[ti]]?.vanilla?.sheet;
        const platform = sheet === 19 || sheet === 427 || (sheet !== undefined && sheet >= 435 && sheet <= 439);
        if ((solidFace || platform)
          && (!solidTiles(x - 1, x + 1, y - 3, y - 1)
            || (!solidTiles(x, x, y - 3, y - 1) && !solidTiles(x + 1, x + 1, y - 3, y - 2)
              && !solidTiles(x - 1, x - 1, y - 3, y - 2)))) {
          pts.push([x, y]);
          break;
        }
      }
    }
    return pts.length === 2 ? pts : null;
  }
  /** AI_117 恐惧鹦鹉螺 618（NPC.cs:47488-47835）：血月钓鱼小 Boss。
   *  常量（:47490-47499）：加速 0.15 / 巡航 7.5 / 悬停 60 / 冲刺蓄力 90+180 /
   *  血弹蓄力 90+90（3 脉冲）/ 召唤 180。出场 ai[0]=-1：升空 vy=-2.5+渐显
   *  （-10/t，陷实心回补 +15 钳 150）50t。悬停 0：绕目标侧后方（-ai[2]×300,-200）
   *  SimpleFly；60t 后按 ai[3] 轮换：/7==3→召唤 3；偶→血弹 2；奇→冲刺 1（均 Item170）。
   *  冲刺 1：蓄力 90t 反向旋进（reflectsProjectiles=true 反弹玩家弹幕）+Item172；
   *  后 180t mouth 反向 -16 冲撞（嘴=rotation+0.4712×spriteDir，spriteDir=-1 再 +π）。
   *  血弹 2：蓄力 90t 吸尘；后每 30t 一脉冲（后坐 -8 + 5-10 发弹 814，
   *  mouthDir×10±6，伤 GetAttackDamage_ForProjectiles(30,25)）。召唤 3：定身发光
   *  （light 1,0.5,0.5 脉冲）+10/20/30t CallForHelp（≤3 只 619，落点搜索 ±20 格）。
   *  白天/非血月目标失效（悬停漂移）；noTileCollide 直接位移。 */
  private bloodNautilusAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    const HOVER_T = 60, CHARGE_WIND = 90, CHARGE_T = 180, BLOOD_WIND = 90, BLOOD_T = 90;
    const SUMMON_T = 180, FLY_SPD = 7.5, FLY_ACC = 0.15;
    // 位置参考 = 真身（含尸体——同 690 处理；Main.player[target] 不因死亡失位）。
    // M11：target = 当前索敌目标（联机可为访客代理）
    const pp: Player | null = this.targetRef(game, player);
    const alive = !!pp && !pp.dead;
    // 目标失效（:47526-47530）：白天或非血月 → 无目标悬停
    const w = game.world;
    const bloodNight = !w.clock.isDay && w.clock.bloodMoon;
    const hasT = alive && bloodNight;
    const tx = hasT ? pp!.cx : 0, ty = hasT ? pp!.cy : 0;
    if (!this.aiInit) {                       // localAI[0]==0（:47502-47509）
      this.aiInit = true;
      this.ai0 = -1;
      this.spawnAlpha = 255;                  // alpha=255 出场渐显
      // 首帧 target==255 分支（:47521-47524）在 case -1 计数起步前补 ai[2]=direction
      this.ai2 = hasT ? (Math.sign(pp!.cx - this.cx) || 1) : 1;
    }
    // 嘴部（NPC.cs:67025-67034）：mouthAngle = rotation+0.4712×spriteDirection
    // （spriteDirection==-1 再 +π）；mouthPos = Center+mouthDir×50。
    // spriteDirection ↔ 本仓 facing（1=贴图水平翻转=朝右）
    const mouthAngle = () => this.visAngle + 0.47123894 * this.facing + (this.facing === -1 ? Math.PI : 0);
    let reflect = false;
    let next = -1;
    // 圆周角工具：AngleTowards（步长钳）/ AngleLerp（圆周插值）
    const angTowards = (a: number, b: number, max: number) => {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return a + Math.max(-max, Math.min(max, d));
    };
    const angLerp = (a: number, b: number, t: number) => {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    };
    switch (this.ai0) {
      case -1: {
        // 出场（:47534-47575）：减速 + 朝向目标（spriteDirection=-direction）
        this.vx *= 0.98; this.vy *= 0.98;
        if (hasT) {
          const d = Math.sign(tx - this.cx) || 1;
          this.facing = -d;                   // spriteDirection = -direction
        }
        if (this.ai2 > 5) {
          this.vy = -2.5;
          this.spawnAlpha -= 10;
          // 陷实心回补（:47560-47566 Collision.SolidCollision）
          const bx0 = Math.floor(this.x / TILE), bx1 = Math.floor((this.x + this.w - 0.01) / TILE);
          const by0 = Math.floor(this.y / TILE), by1 = Math.floor((this.y + this.h - 0.01) / TILE);
          let inSolid = false;
          outerN: for (let xx = bx0; xx <= bx1; xx++) for (let yy = by0; yy <= by1; yy++) {
            if (st.inBounds(xx, yy) && st.isSolid(xx, yy)) { inSolid = true; break outerN; }
          }
          if (inSolid) this.spawnAlpha = Math.min(150, this.spawnAlpha + 15);
          if (this.spawnAlpha < 0) this.spawnAlpha = 0;
        }
        this.ai2 += 1;
        if (this.ai2 >= 50) {
          // 出场结束四槽清零（:47572-47577）——ai[2]=direction 由悬停态迁出时
          // （next==0 分支）重新赋值，此处保持 0
          this.ai0 = 0; this.ai1 = 0; this.ai2 = 0; this.ai3 = 0;
        }
        break;
      }
      case 0: {
        // 悬停伺机（:47601-47633）：目标侧后方 (-ai[2]×300,-200) 巡航
        if (hasT) {
          const destX = tx - this.ai2 * 300, destY = ty - 200;
          if (Math.hypot(destX - this.cx, destY - this.cy) > 50) {
            // SimpleFlyMovement（:78100 逐轴 ±moveSpeed，过零双步）
            const dx = destX - this.cx, dy = destY - this.cy;
            const dl = Math.hypot(dx, dy) || 1;
            const wantVx = (dx / dl) * FLY_SPD, wantVy = (dy / dl) * FLY_SPD;
            if (this.vx < wantVx) { this.vx += FLY_ACC; if (this.vx < 0 && wantVx > 0) this.vx += FLY_ACC; }
            else if (this.vx > wantVx) { this.vx -= FLY_ACC; if (this.vx > 0 && wantVx < 0) this.vx -= FLY_ACC; }
            if (this.vy < wantVy) { this.vy += FLY_ACC; if (this.vy < 0 && wantVy > 0) this.vy += FLY_ACC; }
            else if (this.vy > wantVy) { this.vy -= FLY_ACC; if (this.vy > 0 && wantVy < 0) this.vy -= FLY_ACC; }
          }
          const dir = this.cx < tx ? 1 : -1;
          let want = Math.atan2(ty - this.cy, tx - this.cx) - 0.47123894 * this.facing;
          if (this.facing === -1) want += Math.PI;
          if (this.facing !== dir) { this.facing = dir; this.visAngle = -this.visAngle; want = -want; }
          this.visAngle = angTowards(this.visAngle, want, 0.02);
        }
        this.ai1 += 1;
        if (this.ai1 > HOVER_T) {
          const n3 = this.ai3 | 0;
          if (n3 % 7 === 3) next = 3;
          else {
            game.playSfxFile?.('Item_170', 1, this.cx, this.cy);
            next = n3 % 2 === 0 ? 2 : 1;
          }
        }
        break;
      }
      case 1: {
        // 冲刺（:47636-47700）：direction=背向目标；蓄力期朝反向旋进（反弹弹幕）
        const dir = !(this.cx < tx) ? 1 : -1;   // 注意：与悬停态相反（背向）
        let want = Math.atan2(this.cy - ty, this.cx - tx) - 0.47123894 * this.facing;
        if (this.facing === -1) want += Math.PI;
        const windup = this.ai1 < CHARGE_WIND;
        if (this.facing !== dir && windup) { this.facing = dir; this.visAngle = -this.visAngle; want = -want; }
        if (windup) {
          if (this.ai1 === CHARGE_WIND - 1) game.playSfxFile?.('Item_172', 1, this.cx, this.cy);
          reflect = true;                       // reflectsProjectiles（:47834）
          this.vx *= 0.95; this.vy *= 0.95;
          this.visAngle = angLerp(this.visAngle, want, 0.02);
          if (Math.random() < 0.4) {            // 吸入尘近似（mouth 前方红色尘）
            const ma = mouthAngle();
            game.spawnParticles(this.cx + Math.cos(ma) * 80, this.cy + Math.sin(ma) * 80,
              '#C83848', 1, 1.2, { life: 20 });
          }
        } else if (this.ai1 < CHARGE_WIND + CHARGE_T) {
          this.visAngle = angLerp(this.visAngle, want, 0.05);
          if (hasT && Math.hypot(tx - this.cx, ty - this.cy) > 150) {
            // 反嘴冲刺：v = -mouthDir×16 + 朝目标×1.5（:47679-47682）
            const ma = mouthAngle();
            this.vx = -Math.cos(ma) * 16 + Math.sign(tx - this.cx) * 1.5;
            this.vy = -Math.sin(ma) * 16 + Math.sign(ty - this.cy) * 1.5;
          }
          if (Math.random() < 0.6) {            // 喷尾尘
            const ma = mouthAngle();
            game.spawnParticles(this.cx + Math.cos(ma) * 100, this.cy + Math.sin(ma) * 100,
              '#A82838', 1, 1.6, { life: 18 });
          }
        }
        this.ai1 += 1;
        if (this.ai1 >= CHARGE_WIND + CHARGE_T) next = 0;
        break;
      }
      case 2: {
        // 血弹齐射（:47703-47766）：蓄力 90t 吸尘 → 90t 内每 30t 一脉冲
        if (hasT) {
          const dir = this.cx < tx ? 1 : -1;
          let want = Math.atan2(ty - this.cy, tx - this.cx) - 0.47123894 * this.facing;
          if (this.facing === -1) want += Math.PI;
          if (this.facing !== dir) { this.facing = dir; this.visAngle = -this.visAngle; want = -want; }
          this.visAngle = angLerp(this.visAngle, want, 0.2);
        }
        if (this.ai1 < BLOOD_WIND) {
          this.vx *= 0.95; this.vy *= 0.95;
          if (Math.random() < 0.5) {
            const ma = mouthAngle();
            game.spawnParticles(this.cx + Math.cos(ma) * 80, this.cy + Math.sin(ma) * 80,
              '#C83848', 1, 1.2, { life: 20 });
          }
        } else if (this.ai1 < BLOOD_WIND + BLOOD_T) {
          this.vx *= 0.9; this.vy *= 0.9;
          const pulse = (this.ai1 - BLOOD_WIND) % (BLOOD_T / 3);
          if (pulse === 0) {
            const ma = mouthAngle();
            const mx = this.cx + Math.cos(ma) * 50, my = this.cy + Math.sin(ma) * 50;
            // 后坐（:47742 velocity += mouthDir×-8）
            this.vx += -Math.cos(ma) * 8; this.vy += -Math.sin(ma) * 8;
            const n = 5 + Math.floor(Math.random() * 6);   // Next(5,11)
            const dmg = getAttackDamageForProjectiles(30, 25, this.difficulty);
            const ents = (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities;
            for (let k = 0; k < n; k++) {
              const vx = Math.cos(ma) * 10 + (Math.random() * 12 - 6);
              const vy = Math.sin(ma) * 10 + (Math.random() * 12 - 6);
              const dart = new Dart(mx - Math.cos(ma) * 5, my - Math.sin(ma) * 5, vx, vy, dmg, 814);
              dart.hostile = true;             // 敌怪弹（v5 bit7）
              ents.add(dart, 'projectiles');
            }
            for (let k = 0; k < 4; k++) game.spawnParticles(mx, my, '#B03040', 1, 2, { life: 22 });
          }
        }
        this.ai1 += 1;
        if (this.ai1 >= BLOOD_WIND + BLOOD_T) next = 0;
        break;
      }
      case 3: {
        // 召唤（:47769-47808）：定身 + 旋转归零 + 红光脉冲；10/20/30t CallForHelp
        if (hasT) this.facing = this.cx < tx ? 1 : -1;
        if (this.ai1 < SUMMON_T) {
          this.vx = 0; this.vy = 0;
          this.visAngle = angLerp(this.visAngle, 0, 0.02);
          const t01 = Math.min(1, this.ai1 / SUMMON_T);
          const pulse = Math.max(0, 1 - Math.abs(t01 - 0.5) * 2);  // GetLerpValue(0,.5,t)×(.5→1 反向)
          this.lightRGB = [1 * pulse, 0.5 * pulse, 0.5 * pulse];   // Lighting.AddLight（:47792）
          if (Math.random() < 0.6) {
            game.spawnParticles(this.cx + this.facing * 12, this.cy + 12, '#C83848', 1, 0.6, { life: 20 });
          }
        }
        if (this.ai1 === 10 || this.ai1 === 20 || this.ai1 === 30) this.bloodNautilusCallForHelp(game);
        this.ai1 += 1;
        if (this.ai1 >= SUMMON_T) next = 0;
        break;
      }
      default: this.ai0 = 0; break;
    }
    if (next !== -1) {                          // 状态迁移（:47810-47822）
      this.ai0 = next;
      this.ai1 = 0;
      this.ai2 = 0;
      if (next === 0) this.ai2 = this.facing;   // ai[2] = direction（悬停侧向记忆）
      else this.ai3 += 1;
    }
    this.reflectsProjectiles = reflect;         // :47834
    // noTileCollide（json）：直接位移
    this.x += this.vx;
    this.y += this.vy;
  }

  /** AI_117 CallForHelp（NPC.cs:47841-47879）：≤3 只 619 在场才召；落点 =
   *  本体 ±20 格、离本体/玩家各 >8/>3 格、非实心非岩浆、±2 格无实心、对玩家有
   *  视线；掷弹 813（血云 90t 后出鱿鱼）。100 次尝试。 */
  private bloodNautilusCallForHelp(game: GameHooks) {
    const st = game.world.store;
    const pp: Player | null = this.targetRef(game);   // M11：索敌目标优先（联机可为访客）
    if (!pp || pp.dead) return;
    if (Math.hypot(pp.cx - this.cx, pp.cy - this.cy) > 2000) return;
    const squids = (game.enemies() as Enemy[]).filter((n) => !n.dead && n.vanillaId === 619).length;
    if (squids >= 3) return;
    const cxT = Math.floor(this.cx / TILE), cyT = Math.floor(this.cy / TILE);
    const pxT = Math.floor(pp.cx / TILE), pyT = Math.floor(pp.cy / TILE);
    // ★G1谓词批(2026-09-04)：落点门= !tile.nactive()（NPC.cs:48009）+ 排实心=
    // Collision.SolidTiles ±2（:48014 → Collision.cs:3494 active&&!inActive&&
    // tileSolid&&!tileSolidTop;本仓平台 solid=false 同域排除）——手搓 flags 读漏
    // !inActive 半边 → st.isActive()/st.isSolid()
    const solid2 = (tx: number, ty: number) => st.isSolid(tx, ty);
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = cxT + Math.floor(Math.random() * 41) - 20;
      const y = cyT + Math.floor(Math.random() * 41) - 20;
      // 双排除环（:47855-47857）：离本体 ±8 / 离玩家 ±3 之外
      if (Math.abs(y - cyT) <= 8 && Math.abs(x - cxT) <= 8) continue;
      if (Math.abs(y - pyT) <= 3 && Math.abs(x - pxT) <= 3) continue;
      if (st.isActive(x, y)) continue;          // nactive()
      if (st.inBounds(x, y) && st.liquid[st.idx(x, y)] === 2) continue;   // lava
      let clear = true;                         // Collision.SolidTiles ±2
      for (let xx = x - 2; xx <= x + 2 && clear; xx++) {
        for (let yy = y - 2; yy <= y + 2; yy++) {
          if (solid2(xx, yy)) { clear = false; break; }
        }
      }
      if (!clear) continue;
      // 视线（CanHitLine 本体→玩家；point 重载按 0×0 盒）
      if (!canHit(st, this.cx, this.cy, 0, 0, pp.cx, pp.cy, 0, 0)) continue;
      const cloud = new SquidCloud(x * TILE + 8, y * TILE + 8);
      (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(cloud, 'projectiles');
      return;
    }
  }

  /** AI_114 蜻蜓族 595-601（AI_114_Dragonflies cs:48080-48250）1:1（noGravity，SetDefaults :16664）。
   *  出生（:48082-48092）：锚=Center、velocity=(NextVector2Circular(5,3)+NextVector2Circular
   *  Edge(5,3))×0.4、ai[1]=0、ai[0]=1（突进态起步）。
   *  悬停 ai[0]=0（:48095-48115）：v×0.94；计时 +1 ≥ 60+Next(60) → 按离锚距离三档：
   *  >96：v=朝锚×3（突进）；16-96：v=朝锚×1+NextVector2Circular(1,0.5)（近锚突进档，
   *  曾缺）；≤16：v=随机（同出生式）→ 全部转 ai[0]=1、计时清零。
   *  突进 ai[0]=1（:48117-48163）：时限 4（离锚 >112 → 200）；计时满 → 回悬停。
   *  下探：中心列 [cy,cy+3) 每格实心/液：vy>0 则 ×0.9 再 −0.2（无 break，逐格叠）；
   *  上升中：[cy,cy+30) 无实心 → vy×0.9（只 vy——曾连 vx 一起 ×0.9）。
   *  两态通用：direction 由 vx；wet → vy=−3（:48170-48173，switch 外——曾只在突进态）。
   *  避敌（:48174-48216，localAI[1] 15t 门）：敌 100px（Hitbox 盒距）/玩家 150px
   *  （原版无 dead 门，尸体照算）→ zero=Σ逃离向/count×2 → velocity += zero 钳 16、
   *  锚=Center+zero×10、ai[1]=−10（曾缺）、ai[0]=1。无威胁且离锚 <16px →
   *  1/30（锚格=519 香蒲）/1/4 掷：FindCattailTop 重锚，否则本列下扫至地表下
   *  Next(3,6) 格（:48217-48249） */
  private dragonflyAI(game: GameHooks, player: Player | null) {
    const st = game.world.store;
    // 椭圆均匀/边缘随机点（NextVector2Circular / NextVector2CircularEdge）
    const circIn = (rx: number, ry: number): [number, number] => {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
      return [Math.cos(a) * rx * r, Math.sin(a) * ry * r];
    };
    const circEdge = (rx: number, ry: number): [number, number] => {
      const a = Math.random() * Math.PI * 2;
      return [Math.cos(a) * rx, Math.sin(a) * ry];
    };
    const randVel = (): void => {
      const [ax, ay] = circIn(5, 3), [bx, by] = circEdge(5, 3);
      this.vx = (ax + bx) * 0.4;
      this.vy = (ay + by) * 0.4;
    };
    if (!this.aiInit) {
      this.aiInit = true;
      this.ai2 = this.cx; this.ai3 = this.cy;   // localAI[0]==0 出生段（:48082-48091）
      randVel();
      this.ai1 = 0;
      this.ai0 = 1;
    }
    if (this.ai0 === 0) {
      // 悬停
      this.vx *= 0.94; this.vy *= 0.94;
      this.ai1 += 1;
      if (this.ai1 >= 60 + Math.floor(Math.random() * 60)) {
        const dx = this.ai2 - this.cx, dy = this.ai3 - this.cy;
        const d = Math.hypot(dx, dy);
        if (d > 96) {
          this.vx = (dx / d) * 3;
          this.vy = (dy / d) * 3;
        } else if (d > 16) {
          const [jx, jy] = circIn(1, 0.5);
          this.vx = (dx / d) * 1 + jx;
          this.vy = (dy / d) * 1 + jy;
        } else {
          randVel();
        }
        this.ai1 = 0;
        this.ai0 = 1;
      }
    } else {
      // 突进
      const dx = this.ai2 - this.cx, dy = this.ai3 - this.cy;
      const limit = Math.hypot(dx, dy) > 112 ? 200 : 4;
      this.ai1 += 1;
      if (this.ai1 >= limit) { this.ai1 = 0; this.ai0 = 0; }
      const cx = Math.floor(this.cx / TILE), cy = Math.floor(this.cy / TILE);
      for (let i = cy; i < cy + 3; i++) {                 // 下探 3 行（:48131-48144）
        if (st.inBounds(cx, i) && (st.isSolid(cx, i) || st.liquid[st.idx(cx, i)] > 0)) {
          if (this.vy > 0) this.vy *= 0.9;
          this.vy -= 0.2;
        }
      }
      if (this.vy < 0) {                                  // 上升中下 30 格无地 → vy×0.9
        let ground = false;
        for (let j = cy; j < cy + 30; j++) {
          if (st.inBounds(cx, j) && st.isSolid(cx, j)) { ground = true; break; }
        }
        if (!ground && this.vy < 0) this.vy *= 0.9;
      }
    }
    if (this.vx !== 0) this.facing = this.vx > 0 ? 1 : -1;   // :48166-48169
    if (this.wet) this.vy = -3;                              // 两态通用（:48170-48173）
    // ---- 避敌（localAI[1] 15t 门，:48174-48179）----
    if (this.lai1 > 0) {
      this.lai1 -= 1;
    } else {
      this.lai1 = 15;
      // 盒距（Hitbox.Distance(Center)：中心点距敌盒最近点）
      const boxDist = (b: { x: number; y: number; w: number; h: number }): number => {
        const qx = Math.max(b.x, Math.min(this.cx, b.x + b.w));
        const qy = Math.max(b.y, Math.min(this.cy, b.y + b.h));
        return Math.hypot(this.cx - qx, this.cy - qy);
      };
      // zero = Σ(DirectionFrom(threat)) → /count → ×2（:48180-48205：DirectionFrom =
      // (Center−威胁中心).SafeNormalize 的单位逃离向,先合计后平均再放大）
      let count = 0, ux = 0, uy = 0;
      for (const o of game.enemies()) {
        const e = o as Enemy;
        if (e.dead || e.def.damage <= 0 || !!e.vanilla?.friendly) continue;
        if (boxDist(e) <= 100) {
          const d = Math.hypot(this.cx - e.cx, this.cy - e.cy) || 1;
          count++; ux += (this.cx - e.cx) / d; uy += (this.cy - e.cy) / d;
        }
      }
      // 玩家 150px（原版无 !dead 门——尸体照算；分发层死亡传 null，回 targetRef）。
      // M11：索敌目标优先（联机可为访客代理）
      const pp: Player | null = this.targetRef(game, player);
      if (pp && boxDist(pp) <= 150) {
        const d = Math.hypot(this.cx - pp.cx, this.cy - pp.cy) || 1;
        count++; ux += (this.cx - pp.cx) / d; uy += (this.cy - pp.cy) / d;
      }
      if (count > 0) {
        const nx = (ux / count) * 2, ny = (uy / count) * 2;   // zero /= count; zero *= 2
        this.vx += nx; this.vy += ny;                         // velocity += zero（实际速度）
        const spd = Math.hypot(this.vx, this.vy);
        if (spd > 16) { this.vx = (this.vx / spd) * 16; this.vy = (this.vy / spd) * 16; }
        this.ai2 = this.cx + nx * 10;   // 锚 = Center + zero×10（:48210-48214）
        this.ai3 = this.cy + ny * 10;
        this.ai1 = -10;                 // 逃逸突进计时（:48211）
        this.ai0 = 1;
      } else if (Math.hypot(this.ai2 - this.cx, this.ai3 - this.cy) < 16) {
        // 近锚重锚（:48217-48249）：1/30（锚格 519 香蒲）否则 1/4
        const ax = Math.floor(this.ai2 / TILE), ay = Math.floor(this.ai3 / TILE);
        const cattail = st.inBounds(ax, ay)
          && TILE_DEFS[st.type[st.idx(ax, ay)]]?.vanilla?.sheet === 519;
        if (Math.floor(Math.random() * (cattail ? 30 : 4)) === 0) {
          // FindCattailTop（NPC.cs:80977-81004）：±30×±20 找 frameX≥180 香蒲顶,蓄水池采样
          // ★G1谓词批(2026-09-04)：原版裸 active()（NPC.cs:81007 `tile.active() &&
          //  type==519`）——isActive 误排已致动香蒲 → 改 hasTile（对齐
          //  VanillaSpawner.findCattailTop 正确副本 flags 读）
          let bx = ax, by = ay, found = false, denom = 1;
          for (let i = ax - 30; i <= ax + 30; i++) {
            for (let j = ay - 20; j <= ay + 20; j++) {
              if (!st.inBounds(i, j) || !st.hasTile(i, j)) continue;
              const ii = st.idx(i, j);
              if (TILE_DEFS[st.type[ii]]?.vanilla?.sheet === 519 && st.frameX[ii] >= 180
                && Math.floor(Math.random() * denom) === 0) {
                bx = i; by = j; denom++; found = true;
              }
            }
          }
          if (found) {
            this.ai2 = bx * TILE; this.ai3 = by * TILE;
          } else {
            // 本列下扫至首个实心（不越 worldSurface），再抬 Next(3,6) 格
            const col = Math.floor(this.cx / TILE);
            let m = Math.floor(this.cy / TILE);
            while (m < st.h && !(st.inBounds(col, m) && st.isSolid(col, m))
              && m < game.world.groundLevel) m++;
            m -= 3 + Math.floor(Math.random() * 3);
            this.ai2 = col * TILE; this.ai3 = m * TILE;
          }
        }
      }
    }
    moveAndCollide(this, game.world, this.vx, this.vy);
  }

  /** AI_115 瓢虫/椿象 604/605/669（AI_115_LadyBugs cs:47944）：ai[0]=飞行方向角、
   *  ai[2]=0 飞/1 陆行、localAI 重选 60-180 帧 1/5 概率切换。飞行：v → Lerp(角向×1, v, 0.0125)
   *  慢飞、垂直避障同蝶族、collideX → 角反射+vx×-0.2；陆行：一跳一跳 Lerp(UnitX*dir, 0.05)
   *  +vy+=0.2、前方 1 格下 4 格有水 → 起飞（cs:48036-48075） */
  private ladybugAI(game: GameHooks, _player: Player | null) {
    const st = game.world.store;
    // 玩家身体接触活瓢虫 → 好运（NPC.UpdateNPC 接触段 cs:78730-78732 →
    // LadyBugLuck :82366：800px 内按距离^6 衰减，详见 LuckState.ladyBugTouched；
    // 仅 604/605——同 AI_115 的椿象 669 不参与）
    if (_player && !_player.dead && (this.vanillaId === 604 || this.vanillaId === 605)) {
      if (this.x < _player.x + _player.w && this.x + this.w > _player.x
        && this.y < _player.y + _player.h && this.y + this.h > _player.y) {
        _player.luckState?.ladyBugTouched(
          Math.hypot(this.cx - _player.cx, this.cy - _player.cy), this.vanillaId === 605);
      }
    }
    if (!this.aiInit) { this.aiInit = true; this.ai0 = Math.random() * Math.PI * 2; this.ai1 = 60 + Math.floor(Math.random() * 120); this.ai2 = 0; }
    this.ai1 -= 1;
    if (this.ai1 <= 0) {
      this.ai1 = 60 + Math.floor(Math.random() * 120);
      if (Math.random() < 0.2) this.ai2 = this.ai2 === 0 ? 1 : 0;
      if (this.ai2 === 0) this.ai0 = Math.random() * Math.PI * 2;
    }
    if (this.ai2 === 0) {
      // 飞行（cs:47988-47990）：目标向量 = ai[0] 角向 ×1 + windSpeedTarget×0.8，
      // 再整体 Lerp(velocity, 目标, 0.0125)——★风漂在 Lerp【目标】内（稳态漂速
      // ≈ wind×0.8，1.25%/t 缓进）。曾把 +wind×0.8 直接加在 Lerp 之后的 velocity
      // 上 = 每 tick 无阻尼恒加速，风大时瓢虫侧向狂飙（审计 B 风漂残余,2026-08-19）
      const tx = Math.cos(this.ai0) + game.world.weather.windSpeedTarget * 0.8;
      const ty = Math.sin(this.ai0);
      this.vx += (tx - this.vx) * 0.0125;
      this.vy += (ty - this.vy) * 0.0125;
      const cx = Math.floor(this.cx / TILE), cy = Math.floor(this.cy / TILE);
      let belowSolid = false;
      for (let k = 1; k <= 4; k++) if (st.isSolid(cx, cy + k) || st.liquid[st.idx(cx, cy + k)] > 0) { belowSolid = true; break; }
      if (belowSolid) this.ai0 = -this.ai0;
      // 上升中且下方 30 格无地 → -ai0 垂直翻转转下降（cs:48021-48023;曾写
      // π-ai0 水平镜像+探上方 = 开阔地上空持续爬升,审计 13.2,2026-08-19）
      if (this.vy < 0) {
        let groundBelow = false;
        for (let k = 1; k <= 30 && !groundBelow; k++) if (st.isSolid(cx, cy + k)) groundBelow = true;
        if (!groundBelow) this.ai0 = -this.ai0;
      }
      this.facing = this.vx > 0 ? 1 : -1;
      const oldVx = this.vx;
      moveAndCollide(this, game.world, this.vx, this.vy);
      if (this.hitWall) { this.vx = oldVx * -0.2; this.ai0 = Math.PI - this.ai0; }
      return;
    }
    // 陆行
    const fx = Math.floor((this.cx + this.facing * (this.w / 2 + 8)) / TILE);
    const fy = Math.floor(this.cy / TILE);
    let waterAhead = false;
    for (let k = 1; k <= 4; k++) if (st.liquid[st.idx(fx, fy + k)] > 80) { waterAhead = true; break; }
    if (waterAhead) { this.ai2 = 0; this.ai0 = Math.random() * Math.PI * 2; return; }
    if (this.vy !== 0) {
      this.vx *= 0.98;
      this.vy += (2 - this.vy) * 0.005;   // 腾空下落 Lerp 0.005（cs:48063）
    } else {
      // 陆行 Lerp 0.05 → 目标速度 1 px/t（cs:48036-48044;曾目标 0.05 =
      // 爬行慢 20 倍近乎趴窝,审计 13.1,2026-08-19）
      this.vx += (this.facing - this.vx) * 0.05;
      this.vy += 0.2; // 一跳一跳
    }
    this.vy = Math.min(this.vy, 10);
    const oldVx = this.vx;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) { this.facing *= -1; this.vx = oldVx * -0.2; }
  }

  /** AI_116 水黾 612/613（AI_116_WaterStriders cs:47882-47942）1:1：
   *  钉水面——GetWaterLine（Collision.cs:1501-1547：中心格上 2 行仍有液=深处返回
   *  false；否则 Y−1/Y/Y+1 三行多行搜索取液面 = 行×16−trunc(液/16)）；锚点
   *  num = Bottom.Y−1（:47887）：Center.Y 在线下 → vy−0.8 钳 −4 且锚点不过线；
   *  线上 → vy 钳到线（flag=贴面）。无液面且 wet → vy−0.2。ai[0]≠0 早退。
   *  冲刺门（:47920-47941）：flag2 = wet||贴面；flag3 = flag2 || vy==0（落地）——
   *  【仅 flag3 才冲刺】；间隔 flag2 ? 120-240 : 60-240；冲刺 vx=±5，
   *  !flag2 且落地顺带 vy=−2 + 计时 60 */
  private waterStriderAI(game: GameHooks) {
    const st = game.world.store;
    if (this.ai0 < 0) this.ai0 = 0;   // 类默认 −1120 → NewNPC ai[0]=0 语义
    let onSurface = false;
    const { found, line } = getWaterLine(st, Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
    if (found) {
      const num = this.y + this.h - 1;                 // 底边−1 锚（:47887）
      if (this.cy > line) {
        this.vy -= 0.8;
        if (this.vy < -4) this.vy = -4;
        if (num + this.vy < line) this.vy = line - num;
      } else {
        this.vy = Math.min(this.vy, line - num);
        onSurface = true;
      }
    } else if (this.wet) {
      this.vy -= 0.3;                                  // 深水无液面（1457 :48060,0.2→0.3）
    }
    if (this.ai0 !== 0) return;                        // ai[0]≠0 早退（:47910-47913）
    this.ai1 += 1;
    this.vx *= 0.9;
    if (this.vy === 0) this.vx *= 0.6;                 // collideY 落地（:47916-47919）
    const flag2 = this.wet || onSurface;               // :47920
    const flag3 = flag2 || this.vy === 0;              // :47921
    const interval = flag2 ? 120 + Math.floor(Math.random() * 121) : 60 + Math.floor(Math.random() * 181);
    if (flag3 && this.ai1 >= interval) {               // ★仅 flag3 冲刺（:47927）
      this.ai1 = 0;
      this.vx = (Math.random() < 0.5 ? -1 : 1) * 5;
      this.facing = this.vx > 0 ? 1 : -1;
      if (!flag2 && this.vy === 0) { this.vy = -2; this.ai1 = 60; }
    }
    // 原版无 noGravity——共享段恒加重力，浮面/下沉由上方钉面逻辑接管（vy==0 亦
    // 为冲刺门与贴地阻尼的一部分；曾"湿时跳过重力"自创）
    this.applyGravity(game);
    moveAndCollide(this, game.world, this.vx, this.vy);
  }

  /** AI_118 海马 626/627（AI_118_Seahorses cs:47432-47486）1:1：noGravity=wet；
   *  GetWaterLineIterate（Collision.cs:1554-1573）向上迭代找液面 → 贴皮 flag =
   *  液面有效且 Top 距液面 <20。湿：ai[1] 归零时沿 ai[0] 角 +0.06 推进，合速 >3 →
   *  vx 钳 ±3（仅 X，:47454）+ 重掷计时 450-600 + 随机角（贴皮且新角朝上 θ>π →
   *  θ−π 折返压回水下，:47457-47460）；非推进帧 v×0.95；rotation = vx×0.1。
   *  干：vy==0 时 vx×0.95 瘫软 + rotation += (vx+vy)/2×0.05。碰撞角反射
   *  （:47470-47485）：collideX → 角向量 X 取反；collideY（湿且(非贴皮|上升中)）→
   *  Y 取反；velocity = 新角向 × 原速率（保速换向） */
  private seahorseAI(game: GameHooks) {
    const st = game.world.store;
    // 类默认 -1120 当角度用 = 出生朝向固化 ~92°(2026-08-13 清查)——归 0 与 NewNPC
    // ai[]=0 一致：角 0(朝东)，首帧 ai[1]=0−1≤0 即 +0.06 推进直到 >3 才掷随机角
    //（原版无"==0 掷随机角"自愈——曾自创，审计 15.2 残余,2026-08-19）
    // ★只重置哨兵值：反射(:47482 ToRotation=atan2)与贴皮折角(:47459 ai[0]−π)都会
    //  产生负角（原版照存，ToRotationVector2 任意角皆可）——曾 `ai0<0→0` 把反射
    //  出的 −π(朝西)砸回 0(朝东) = 撞墙海马永远顶着墙（2026-08-19）
    if (this.ai0 === -1120) this.ai0 = 0;
    // GetWaterLineIterate：中心列自中心格逐行上行越过液柱，回退一格；该格有液 →
    // 线 = 行×16 − trunc(上一格液量/16)（cs:1557-1571 原式即用 Y−1 格液量）
    const itx = Math.floor(this.cx / TILE);
    let iy = Math.floor(this.cy / TILE);
    while (iy > 0 && st.inBounds(itx, iy) && st.liquid[st.idx(itx, iy)] > 0) iy--;
    iy++;
    let waterLine = 0;
    if (st.inBounds(itx, iy) && st.liquid[st.idx(itx, iy)] > 0) {
      const up = st.inBounds(itx, iy - 1) ? st.liquid[st.idx(itx, iy - 1)] : 0;
      waterLine = iy * TILE - Math.trunc(up / 16);
    }
    const nearSurface = waterLine > 0 && this.y - waterLine < 20;   // flag（:47436）
    const wet = this.wet;    // noGravity = wet（:47434）；水中判据 = 碰撞盒 wet
    if (!wet) {
      if (this.vy === 0) this.vx *= 0.95;
      this.visAngle += ((this.vx + this.vy) / 2) * 0.05;            // rotation（:47443）
    } else {
      this.ai1 -= 1;
      if (this.ai1 <= 0) {
        this.vx += Math.cos(this.ai0) * 0.06;
        this.vy += Math.sin(this.ai0) * 0.06;
        if (Math.hypot(this.vx, this.vy) > 3) {
          this.vx = Math.min(3, Math.max(-3, this.vx));             // 仅 X 钳 ±3（:47454）
          this.ai1 = 450 + Math.floor(Math.random() * 150);
          this.ai0 = Math.random() * Math.PI * 2;
          // 贴水皮且新角朝上（θ∈(π,2π)）→ θ−π 掉头压回水下（:47457-47460）
          if (nearSurface && this.ai0 > Math.PI) this.ai0 -= Math.PI;
        }
      } else {
        this.vx *= 0.95;
        this.vy *= 0.95;
      }
      this.visAngle = this.vx * 0.1;                                // rotation（:47468）
    }
    // 角反射（:47470-47485，读上一 tick collideX/collideY——本仓 moveAndCollide 旗标）
    const reflectY = (this.onGround || this.hitHead) && wet && (!nearSurface || this.vy < 0);
    if (this.hitWall || reflectY) {
      let rx = Math.cos(this.ai0), ry = Math.sin(this.ai0);
      if (this.hitWall) rx = -rx;
      if (reflectY) ry = -ry;
      this.ai0 = Math.atan2(ry, rx);
      const spd = Math.hypot(this.vx, this.vy);
      this.vx = Math.cos(this.ai0) * spd;
      this.vy = Math.sin(this.ai0) * spd;
    }
    this.facing = this.vx > 0 ? 1 : -1;
    if (!wet) this.applyGravity(game);   // noGravity = wet 的本仓等价（干侧重力）
    moveAndCollide(this, game.world, this.vx, this.vy);
  }

  /** Caster 族传送双端爆发（:20818-20867 旧位 / :20901-20967 新位）：
   *  Item8 + 50 尘，尘 id→近似色按族映射。 */
  private static readonly CASTER_TP_DUST: Record<number, string> = {
    29: '#7A5AC8', 45: '#7A5AC8',      // dust 27 阴影焰（scale 1-2）
    32: '#9AC8E8',                     // dust 172
    693: '#F0F0F0',                    // dust 269 白（noLight）
    283: '#5AC86A', 284: '#5AC86A',    // dust 173（速度 ×2）
    285: '#E8705A', 286: '#E8705A',    // dust 174
    281: '#8AE8C8', 282: '#8AE8C8',    // dust 175
    172: '#E8C85A',                    // dust 106（scale 2.5）
    533: '#7A5AC8',                    // dust 27（scale 2.5）
  };
  private casterTeleportBurst(game: GameHooks) {
    const color = Enemy.CASTER_TP_DUST[this.vanillaId ?? -1] ?? '#FFA040'; // 默认 dust 6 火把焰
    game.playSfxFiles?.(['Item_8'], 1, this.cx, this.cy);   // :20818/:20901 双端各一次
    game.spawnParticles(this.cx, this.cy, color, 50, 3, { life: 30 });    // :20819-20885 ×50
  }

  private casterAI(game: GameHooks, player: Player | null) {
    const vid = this.vanillaId ?? -1;
    if (!this.aiInit) {
      this.aiInit = true;
      this.ai0 = 500;                        // :20799-20801 初始 500
      this.ai1 = 0; this.ai2 = 0; this.ai3 = 0;
      if (vid === 172) this.spawnAlpha = 255;  // :20797-20804 alpha 0 起步（spawnAlpha=255 对应不可见）
    }
    // 172 符文法师淡入（:20797-20809：alpha 每帧 +1 ≈ spawnAlpha -1/t；受击归零重淡）
    if (vid === 172) {
      if (this.justHit) this.spawnAlpha = 255;
      if (this.spawnAlpha > 0) this.spawnAlpha = Math.max(0, this.spawnAlpha - 1);
    }
    // ---- ① 传送执行（:20811-20968）：目的地待执行 → 双端 FX + 改写 ----
    if (this.ai2 !== 0 && this.ai3 !== 0) {
      this.casterTeleportBurst(game);
      this.x = this.ai2 * TILE - this.w / 2 + 8;   // :20888-20889（+8 为贴图格内偏移）
      this.y = this.ai3 * TILE - this.h;
      this.vx = 0; this.vy = 0;
      this.ai2 = 0; this.ai3 = 0;
      this.casterTeleportBurst(game);
    }
    this.ai0 += 1;                                 // :20971 每帧计时
    // :20877-20884 RedHat 变体（红帽骷髅王 35 在场且 FindFirstNPC(35) 的 ai[3]==1 →
    // localAI[3]=1 置位永不清；帧侧整带 +3、计时双倍 :21135 分支+弹球支 :21321）。
    // 召唤链已接通（Game.updateSitting 长凳+巫毒娃娃 easter egg 写 head.redHat=true
    // 且 ai3=1）——此处与原版一致改查 ai[3]==1 双门（2026-09-01 终零波更新：旧注
    // "红帽召唤链未实装"已过期）。enemies 可选访问：测试桩 hooks 可能未实现）
    if (vid === 32 && this.lai3 === 0) {
      const enemiesOf = (game as { enemies?: () => unknown[] }).enemies;
      const sk = enemiesOf
        ? (enemiesOf.call(game) as Enemy[]).find((n) => n.vanillaId === 35 && !n.dead)
        : undefined;
      if (sk?.redHat || sk?.ai3 === 1) this.lai3 = 1;
    }
    // :20787-20791 X 摩擦 0.93 + |vx|<0.1 归零（Y 不阻尼——重力由引擎共享段承担）
    this.vx *= 0.93;
    if (this.vx > -0.1 && this.vx < 0.1) this.vx = 0;
    // 物理：全族 SetDefaults 均无 noGravity/noTileCollide → 受重力+瓦片碰撞
    // （传送落点即站面、受击呈正常抛物线回落）。旧实现 vx/vy 同乘 0.9 裸积分——
    // 无重力无碰撞，受击 vy<0 只缓衰减不回落 = "被击退就往上飞"（2026-08-17 用户报告）
    if (!this.vanilla?.noGravity) {
      this.applyGravity(game);
      moveAndCollide(this, game.world, this.vx, this.vy);
    } else {
      this.x += this.vx; this.y += this.vy;        // 数据侧若标 noGravity 则保悬浮直移
    }
    // ---- 点光（cs:21274-21341 粉尘链后的 AddLight 分支，在移动后每帧执行）----
    if (vid === 693) {
      // :21272-21276 图书管理员骷髅：num116=Remap(ai[0],0,60,0,1)²>0 时 Top 位
      // （0.91/0.82/0.57)×num116——传送后 ai[0] 归 1 再涨 60 帧到 1，常态恒满
      const ramp = Math.min(Math.max(this.ai0 / 60, 0), 1);
      const n116 = ramp * ramp;
      if (n116 > 0) {
        this.lightRGB = [0.91 * n116, 0.82 * n116, 0.57 * n116];
        this.lightRGBAt = { x: this.cx, y: this.y };          // base.Top
      }
    } else if (vid === 533) {
      this.lightRGB = [0.6, 0.6, 0.3];                        // :21331-21333 沙漠幽魂 Top
      this.lightRGBAt = { x: this.cx, y: this.y };
    } else if (vid !== 172) {
      // :21336-21338 兜底（24 火妖/29 哥布林术士/32 黑暗施法者/45 Tim/281-286 地牢
      // 法师）Center 0.6/0.39/0.24；172 符文法师走粉尘分支不发光
      this.lightRGB = [0.6, 0.39, 0.24];
    }
    // ★A 批（2026-08-19）：玩家死亡不早退——原版 AI_008 对尸体坐标照常运转
    // （cs:20786 TargetClosest → :78539 dead 时 faceTarget=false 只冻结朝向，
    // 传送采样/蓄力计时/弹幕瞄准继续走 Main.player[target] = 尸体 rect）。
    // player 为 null 仅剩测试桩场景：索敌段整体跳过（计时/传送执行/物理已在上）
    if (!player) return;
    if (!player.dead) this.facing = this.seekDirX(player);   // :20786 死亡保持朝向
    // ---- ② 攻击蓄力点（:20984-21054）→ ai1=30（下帧起倒数，==25 发射）----
    // 1457 :21080-21086 flag5 = AI_GlobalFiringDistanceCheck——超视野（玩家中心
    // ±935/±575px 外）不开火；29 哥布林术士豁免（:21082-21084 flag5=true）
    const flag5 = vid === 29 || aiGlobalFiringDistanceCheck(this.cx, this.cy, player.cx, player.cy);
    const at = (pts: number[]) => { if (flag5 && pts.includes(this.ai0)) this.ai1 = 30; };
    if (vid === 283 || vid === 284) at([100, 150, 200, 250, 300]);
    else if (vid === 172) at([75, 150, 225, 300, 375, 450]);
    else if (vid === 281 || vid === 282) at([100, 120, 140, 200, 220, 240, 300, 320, 340]);
    else if (vid === 533) { if (flag5 && this.ai0 === 180) this.ai1 = 181; }   // :21005-21007 特殊循环支
    else {
      // :21033-21037 flag4（RedHat 变体 32）双倍计时：+1 后奇数回退 → 恒落偶数、
      // 净 +2/t（蓄力点 100/200/300 均偶数照常命中 = 红帽法师整轮 2 倍速）。
      // （getGood+24+血肉墙在场的同型双倍档 :21029-21032 未接，FTW 种子消费登记）
      if (this.lai3 === 1) { this.ai0 += 1; if (this.ai0 % 2 === 1) this.ai0 -= 1; }
      at([100, 200, 300]);                          // :21042 默认（24/29/32/45/285-286/693）
    }
    // ---- ③ 提前传送上限（族内阈值 → 直拉 650/700 档）----
    if ((vid === 283 || vid === 284) && this.ai0 >= 450) this.ai0 = 700;    // :20991
    else if ((vid === 281 || vid === 282) && this.ai0 >= 540) this.ai0 = 700; // :21019
    else if ((vid === 285 || vid === 286) && this.ai0 > 400) this.ai0 = 650;  // :21048
    else if (vid === 533 && this.ai0 >= 360) this.ai0 = 650;                  // :21052
    // ---- ④ 传送触发（:21056-21078）：≥650 → ai0=1 + 采样落点（失败=整轮重来）----
    if (this.ai0 >= 650) {
      this.ai0 = 1;
      // :21068-21072 693 图书管理员骷髅：先尝试贴书落点（NearBooks 30 格窗，
      // AI_AttemptToFindTeleportSpotNearBooks :18948），失败落回通用法师传送
      const ptx = Math.floor(player.cx / TILE), pty = Math.floor(player.cy / TILE);
      let spot = vid === 693
        ? attemptToFindTeleportSpotNearBooks(this, game, ptx, pty, 30) : null;
      if (!spot) {
        spot = attemptToFindTeleportSpot(this, game, ptx, pty,
          // 1457 :18996 地牢墙门家族追加 693 图书管理员骷髅（骷髅王在场豁免同族）
          20, 5, { dungeonWallGate: vid === 32 || (vid >= 281 && vid <= 286) || vid === 693 });  // :21070 caster 参数 telefrag=5
      }
      if (spot) {
        this.ai1 = vid === 24 ? 5 : 20;            // :21062-21066（Imp 短冷却 → 跳过 ==25 发射门）
        this.ai2 = spot.x; this.ai3 = spot.y;
      }
    }
    // ---- ⑤ 弹幕（:21080-21240）：ai1>0 递减；533 每 30t 循环支；Imp ==10 专属；其余 ==25 ----
    if (this.ai1 > 0) {
      this.ai1 -= 1;
      if (vid === 533) {
        if (this.ai1 % 30 === 0 && this.ai1 / 30 < 5) this.fireCasterVolley(game, player);
      } else if (vid === 24) {
        if (this.ai1 === 10) this.fireCasterVolley(game, player);   // :21131-21136
      } else if (this.ai1 === 25) {
        this.fireCasterVolley(game, player);                         // :21139
      }
    }
  }

  /** Caster 族单发弹幕（:21139-21240 volley）：蓄力 30t 倒数至 25/10 时发射 + Item8（172 无声） */
  private fireCasterVolley(game: GameHooks, player: Player) {
      const vid = this.vanillaId ?? -1;
      // 弹跳球系法师（NPC.cs:21136/:21199-21206）：火妖 24→25 焰球 / 哥布林术士
      // 29→30 混沌球 / 水球术士 32→33 水球 / 黑暗法师 45→665 混沌球(Tim 变体)——
      // 原版每轮 volley 只 NewNPC 一球（AI_009 自带出膛定速），其余法师走 Dart 三连
      const ballByCaster: Record<number, number> = { 24: 25, 29: 30, 32: 33, 45: 665 };
      const ballId = ballByCaster[this.vanillaId ?? -1];
      if (ballId) {
        // 出膛锚（NewNPC :81547 Bottom 锚点换算回中心）：其余 = (X+width/2, Y-8)
        // → 中心 y = top-16；Imp 25 = (X+width/2+dir*8, Y+20) → 中心 y = top+12
        // （:21134/:21199-21201；曾用 cy±偏移 → 球生在法师躯体中部）
        const ball = Enemy.fromVanilla(ballId,
          this.cx + (ballId === 25 ? this.facing * 8 : 0),
          this.y + (ballId === 25 ? 12 : -16));
        if (ball) {
          // :21204 NewNPC(33,...,flag4?1:0) → 末参 ai[3]：RedHat 变体标记（球侧
          // RedHatSkeletronAdjustmentsEnabled 消费，getGood 提速档用）
          if (vid === 32) ball.ai3 = this.lai3 === 1 ? 1 : 0;
          addEnemy(game, ball);
        }
      } else if (this.vanillaId != null && this.vanillaId >= 281 && this.vanillaId <= 286) {
        // 史后三法师（NPC.cs:21146-21191 num100/104/105）：布道者 281/282 迷失之魂 293
        // （速 4、伤 40、timeLeft 300）;死灵法师 283/284 暗影束 290（速 6、伤 30,散布 ±30
        // + 目标速度前置补偿 ×10）;魔法师 285/286 地狱火弹 291（速 8、伤 40）。
        // 枪口 = (cx, y)（vector13 = 顶部中心）
        const vid = this.vanillaId;
        const proj = vid <= 282 ? 293 : vid <= 284 ? 290 : 291;
        const spd = vid <= 282 ? 4 : vid <= 284 ? 6 : 8;
        // :21180 num104 = GetAttackDamage_ForProjectiles(num104, num104*0.8) =
        // Remap(difficulty, Classic, Expert, 基线, 基线×0.8)（大师钳在 Expert 端）。
        // 弹体基线【不】用缩放后的 def.damage——命中玩家的难度乘区在
        // projTargets.hitPlayer（Projectile.cs:13770）统一做，双乘会 ×4
        const dmg = getAttackDamageForProjectiles(
          vid <= 282 || vid >= 285 ? 40 : 30,
          (vid <= 282 || vid >= 285 ? 40 : 30) * 0.8, this.difficulty);
        let dx = player.cx - this.cx, dy = player.cy - this.cy;
        if (vid === 283 || vid === 284) {           // 散布 + 前置补偿（1456:21157-21162 / 1457:21268-21272）
          // ★O1 核销(2026-09-02)：1457 NPC.cs:21269-21270 = Next(-30,31)（61 值域
          // 整型 [−30..30]）——曾 `Math.random()*60-30` 浮点 60 宽 off-by-one
          // （+30 端永不可取），改 floor 精确整型形。
          dx += (Math.floor(Math.random() * 61) - 30) - player.vx * 10;
          dy += (Math.floor(Math.random() * 61) - 30) - player.vy * 10;
        }
        const d = Math.hypot(dx, dy) || 1;
        const dart = new Dart(this.cx, this.y, (dx / d) * spd, (dy / d) * spd, dmg, proj);
        // ★SW-FX7（2026-09-10）：291 发射点显式传目标锚 ai[0]/ai[1]=玩家心（NPC.cs:
        //  21294 NewProjectile 末两参 Main.player[target].Center.X/Y）——此前缺省 0
        //  由 Dart 首子步补偿捕获（差 1 拍玩家位移）。293/290 原版即传 0/0 不动
        if (proj === 291) { dart.spawnAi0 = player.cx; dart.spawnAi1 = player.cy; }
        dart.hostile = true; // 史后三法师直构弹——敌怪弹（v5 bit7）
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(dart, 'projectiles');
      } else if (vid === 533) {
        // 沙漠精灵（:21104-21135）：落点采样=玩家 ±6 格（C1 修正：玩家排除窗
        //  num95=0 = 仅玩家所在格本身，cs:21109 反相与——曾误 6×6 邻域全排；
        //  自身排除窗 num94=6 保留；非激活格 + 非岩浆 + ±2 无实心），50 次，
        //  >2000px 放行 → 在落点原位放追踪弹 596（零初速）
        const st = game.world.store;
        const ptx = Math.floor(player.cx / TILE), pty = Math.floor(player.cy / TILE);
        const mtx = Math.floor(this.cx / TILE), mty = Math.floor(this.cy / TILE);
        // ★批六 M1：原版 far = Length()>2000f 欧氏度量（NPC.cs:21207）——曾误曼哈顿
        const far = Math.hypot(this.cx - player.cx, this.cy - player.cy) > 2000;
        for (let att = 0; att < 50 && !far; att++) {
          const sx = ptx + Math.floor(Math.random() * 13) - 6;
          const sy = pty + Math.floor(Math.random() * 13) - 6;
          // :21109 玩家窗（num95=0）：仅 (sx==ptx && sy==pty) 排除；自身窗（num94=6）
          if (sx === ptx && sy === pty) continue;
          if (Math.abs(sy - mty) <= 6 && Math.abs(sx - mtx) <= 6) continue;
          // :21216 占用判定 = !nactive()（nactive 门读 isActive）——红蓝对抗 F13：
          //   曾用 type≠0 代读，幽灵残型格被误排（原版幽灵=合法落点）
          if (!st.inBounds(sx, sy) || st.isActive(sx, sy)) continue;
          if (st.liquid[st.idx(sx, sy)] > 0 && st.liquidType[st.idx(sx, sy)] === 2) continue;
          let ok = true;
          for (let dx2 = -2; dx2 <= 2 && ok; dx2++) {
            for (let dy2 = -2; dy2 <= 2; dy2++) {
              if (st.inBounds(sx + dx2, sy + dy2) && st.isSolid(sx + dx2, sy + dy2)) { ok = false; break; }
            }
          }
          if (!ok) continue;
          const curse = new Dart(sx * TILE + 8, sy * TILE + 8, 0, 0, this.baseDamage, 596);
          curse.hostile = true;
          (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(curse, 'projectiles');
          break;
        }
        // ★批六 M1：far（>2000px）分支删除——原版超距只播 Item8 零弹（NPC.cs:21195
        //  PlaySound 在 far 判定【前】恒播;while(!flag7) 门整跳 = 不生成任何弹体）。
        //  本仓发射音已在 fireCasterVolley 尾非 172 恒播（Item_8）,far 语义自此成立
      } else if (vid === 172) {
        // 符文法师（:21228-21240）：单发符文爆弹 129——速 10、伤 40、瞄准 ±10 抖动、
        //  timeLeft 300；发射音 21196 例外门已在外层跳过（172 无声）
        // ★O3 漏网核销(2026-09-02)：1457 NPC.cs:21343-21344 = Next(-10,11)（21 值域
        // [−10..10]）——曾 `Math.random()*20-10` 浮点 20 宽 off-by-one（+10 端永不可取）
        let dx = player.cx - this.cx + (Math.floor(Math.random() * 21) - 10);
        let dy = player.cy - this.cy + (Math.floor(Math.random() * 21) - 10);
        const d = Math.hypot(dx, dy) || 1;
        dx = (dx / d) * 10; dy = (dy / d) * 10;
        const dmg172 = getAttackDamageForProjectiles(40, 32, this.difficulty);
        const blast = new Dart(this.cx, this.cy, dx, dy, dmg172, 129);
        blast.hostile = true;
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(blast, 'projectiles');
      } else if (vid === 693) {
        // 图书管理员骷髅（NPC.cs:21208-21215）：书锚 = AI_FindNearbyBook（tile 50 放置书
        // = 本仓 v_50_books，Center−(10,20) 起 20×30 窗随机一本，:26275-62804）——
        // 书由玩家放置（书架 101 掉书物 → 桌面/书架放置），无书走原版兜底
        // Center+NextVector2Circular(30,15)。弹 1092 书弹 dmg 13 原值（无难度包装），
        // 零初速、ai1=45、ai2=target——三态 AI 见 BookProj（Projectile.cs:23742-23809）
        const st = game.world.store;
        const mtx = Math.floor(this.cx / TILE), mty = Math.floor(this.cy / TILE);
        let bx = this.cx, by = this.cy;
        const books: Array<[number, number]> = [];
        for (let sy = Math.max(0, mty - 20); sy < Math.min(st.h, mty + 10); sy++) {
          for (let sx = Math.max(0, mtx - 10); sx < Math.min(st.w, mtx + 10); sx++) {
            const t = st.get(sx, sy);
            // :62972 `!tile.active() || tile.type != 50 → continue`——active() 位本体读
            // hasTile（红蓝对抗 F14：曾用 truthy type 代读，幽灵书残型误当书锚）
            if (st.hasTile(sx, sy) && TILE_DEFS[t]?.vanilla?.sheet === 50) books.push([sx, sy]);
          }
        }
        if (books.length > 0) {
          // 随机一本（closestBook=false 分支 :2733-2740）→ 书格中心
          const [bx2, by2] = books[Math.floor(Math.random() * books.length)];
          bx = bx2 * TILE + 8; by = by2 * TILE + 8;
        } else {
          // NextVector2Circular(30,15)（Utils.cs：单位角×(30,15)×NextFloat）
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random();
          bx += Math.cos(ang) * 30 * rad;
          by += Math.sin(ang) * 15 * rad;
        }
        const book = new BookProj(bx - 8, by - 8, 13, player);
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(book, 'projectiles');
      } else {
        // 原版通用分支无兜底发射（NPC.cs:21196-21241 的 if 链外零弹）——法师族全员
        // （24/29/32/45/281-286/533/693/172）均有专属分支，此处仅防守性静默
      }
    if (this.vanillaId !== 172) {
      game.playSfxFiles?.(['Item_8'], 1, this.cx, this.cy);   // :21196 发射音（172 例外）
    }
  }

  private flyAI(game: GameHooks, player: Player | null, steer: number) {
    // 恶魔眼式飞行 AI：
    // 游荡时自主调整航向（朝巡航点平滑转向、到点即换新目标、撞墙自动绕开）；
    // 玩家进入索敌范围后：朝向玩家明显加速逼近；脱离后回落游荡。
    const dist = player ? Math.hypot(player.cx - this.cx, player.cy - this.cy) : Infinity;
    const aggro = 18 * 16; // 18 格索敌（仓内近似门——原版 aiStyle 2 无距离索敌）
    // 卡墙脱困：追击中持续撞墙/贴地/顶头 → 暂时退回游荡重新选航向（冷却内不再贴脸），
    // 防止顶在崖壁/坑洞里原地抖动
    if (this.stuckCd > 0) this.stuckCd--;
    if (this.state === 1 && (this.hitWall || this.onGround || this.hitHead)) {
      if (++this.stuckT > 18) { this.stuckT = 0; this.stuckCd = 45; this.state = 0; this.target = null; }
    } else this.stuckT = 0;
    // 索敌门走统一入口 canTargetPlayerAt：有效距离按原版公式减 player.aggro
    // （NPC.cs:78485-78492）——潜行装（星璇 -1200/蘑菇矿 -750/变态刀 -750）拉远
    // 索敌，脱潜（挥击/移出潜行）恢复正常。★原版 aiStyle 2 飞行族索敌无距离门
    // （TargetClosest 无条件锁定唯一玩家），18 格为仓内近似，仅门内挂 aggro 消费
    if (player && this.canTargetPlayerAt(player, aggro) && this.stuckCd === 0) {
      // ---- 追击：朝向玩家，加速逼近 ----
      const dx = player.cx - this.cx, dy = player.cy - this.cy;
      const d = dist || 1;
      this.vx += (dx / d) * steer * 4.5;
      this.vy += (dy / d) * steer * 4.5;
      this.facing = dx > 0 ? 1 : -1;
      this.state = 1; // 标记追击态（脱离后回到游荡时重新选巡航点）
    } else {
      // ---- 游荡：自主巡航，到点换向 ----
      if (this.state === 1 || !this.target || Math.hypot(this.target.x - this.cx, this.target.y - this.cy) < 32) {
        this.state = 0;
        // 脱困冷却内：重选目标强制向上（120-260px）——困在谷底时随机目标仍在低位，永远飞不出去
        const escape = this.stuckCd > 0;
        this.target = {
          x: this.cx + (Math.random() - 0.5) * (escape ? 200 : 320),
          y: this.cy + (escape ? -(100 + Math.random() * 160) : (Math.random() - 0.5) * 220),
        };
      }
      const dx = this.target.x - this.cx, dy = this.target.y - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      this.vx += (dx / d) * steer * 1.4;
      this.vy += (dy / d) * steer * 1.4;
      this.facing = dx > 0 ? 1 : -1;
    }
    const damp = 0.96;
    this.vx *= damp; this.vy *= damp;
    const spd = Math.hypot(this.vx, this.vy);
    // 追击上限略高于游荡：游荡 1.8，追击 2.2（太快会贴脸躲不开）
    const maxSpd = this.key === 'servant_of_cthulhu' ? 4.2 : (this.state === 1 ? 2.2 : 1.8);
    if (spd > maxSpd) { this.vx = (this.vx / spd) * maxSpd; this.vy = (this.vy / spd) * maxSpd; }
    // 通用飞行避水（def.avoidWater 声明式开启）：避让时重选航向
    if (this.def.avoidWater && avoidWater(this, game.world)) {
      this.state = 0;
      this.target = null;
      return;
    }
    // 原版 noTileCollide（穿墙族）：直接位移不走碰撞
    if (this.vanilla?.noTileCollide) {
      this.x += this.vx;
      this.y += this.vy;
      return;
    }
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall) { this.vx = -this.vx * 0.7; this.state = 0; this.target = null; } // 撞墙重新选向
    if (this.hitHead) this.vy = -this.vy * 0.7;
    if (this.onGround) this.vy = -Math.abs(this.vy) - 0.5;
  }

  /**
   * AI_004 克苏鲁之眼 1:1（1456 NPC.cs:19909-20757；经典+专家双档，getGoodWorld
   * （for the worthy）分支全量实装；netcode 跳过）。
   *  ai 槽位映射：ai0=ai[0]（0 P1 / 1 变身段一 / 2 段二 / 3 P2）、state=ai[1]（态号，
   *  变身期闲置）、ai2=ai[2]（态内计时，本函数内自增——不用自动预增的 aiT，保证与
   *  原版"先判后增"逐 tick 对齐）、spinSpeed=变身段 ai[2]（自旋角速度）、
   *  servantT/chargesLeft 共享 ai[3]（P1 仆从累计 / P2 冲撞计数，两段互斥不并存，
   *  原版各清零点照抄）、phase 仅为仓内 umbrella（变身起置 2，legacy 渲染路径消费）。
   *  P1 悬浮(上方 200px, 5/0.04；专家 7/0.15) → 600t(专家 210t) → 3 连冲(6/专家 7,
   *  冲程 150t/专家 100t, 40t 后 0.98 摩擦+专家再 ×0.985);
   *  悬浮期 NPC 在玩家上方且 <500px(专家仅距离门) 累计 110t(专家 44t) 召仆从
   *  (速 5/专家 6) + NPCHit(3); HP<50%(专家 65%) → 变身两段各 100t（段一加速自旋+
   *  gore 8/7/6×2/尘 20/NPCHit+Roar，段二减速收尾）→ P2;
   *  P2 每 tick 覆写 defense=0 / damage=LerpBetweenFinalValues(23,18)+CappedAtMaster
   *  （经典 23 / 专家 36 / 大师 54；专家 hp<12% 防 -15、<4% lerp 上限 20+防 -30）;
   *  悬浮(上方 120px, 6/0.07, 专家按 400/600/800px 距离爬坡 +1/+0.05) → 200t →
   *  3 连冲(6.8, 专家 2/3 冲 ×1.15/×1.30, 冲程 130/专家 90t, 50t 摩擦) → 专家 hp<50%
   *  转 ai[1]=3 预测连冲（速 20、冲程 20t、5 连、hp<12% 悬玩家下方 600px 回冲 ×4
   *  提前量、<4% 双倍提前量）;
   *  白天/玩家死亡: vy-=0.04 漂离 + EncourageDespawn(10)，状态机冻结。
   *  旋转: 恒定速率线性步进追脸(cs:19975-20012)，分档表 cs:19939-19966（专家 ×1.5）。
   */

  /** 原版轴伺服（cs:20050-20081）：分轴逼近期望速度,符号相反时双倍加速 */
  private servoTo(tx: number, ty: number, spd: number, accel: number): void {
    const d0 = Math.hypot(tx - this.cx, ty - this.cy) || 1;
    const ex = ((tx - this.cx) / d0) * spd;
    const ey = ((ty - this.cy) / d0) * spd;
    if (this.vx < ex) {
      this.vx += accel;
      if (this.vx < 0 && ex > 0) this.vx += accel;
    } else if (this.vx > ex) {
      this.vx -= accel;
      if (this.vx > 0 && ex < 0) this.vx -= accel;
    }
    if (this.vy < ey) {
      this.vy += accel;
      if (this.vy < 0 && ey > 0) this.vy += accel;
    } else if (this.vy > ey) {
      this.vy -= accel;
      if (this.vy > 0 && ey < 0) this.vy -= accel;
    }
  }

  /** EoC 旋转追踪（cs:19975-20012 1:1）：向 target 以恒定 rate 线性步进（最短弧，
   *  环绕判定用原版 3.1415 字面量），步进后归一到 [0,6.283) 并在 |Δ|<rate 吸附带内
   *  直接对齐。rate=0（expert 且 hp<4%）时冻结朝向不步进。
   *  此前为 diff×min(1,rate*10) 指数逼近——快速档直接瞬移、慢速档永不到位，均偏离原版。 */
  private applyEocRotation(target: number, rate: number): void {
    let t = target;
    while (t < 0) t += Math.PI * 2;
    while (t >= Math.PI * 2) t -= Math.PI * 2;
    let a = this.visAngle;
    while (a < 0) a += Math.PI * 2;
    while (a >= Math.PI * 2) a -= Math.PI * 2;
    if (rate > 0) {
      if (a < t) {
        if (t - a > 3.1415) a -= rate; else a += rate;
      } else if (a > t) {
        if (a - t > 3.1415) a += rate; else a -= rate;
      }
      // 归一（cs:20001-20008 单步）+ 吸附带（cs:19997-20000/20009-20011 两次判定）
      if (a < 0) a += 6.283;
      else if (a > 6.283) a -= 6.283;
      if (a > t - rate && a < t + rate) a = t;
    }
    this.visAngle = a;
  }

  private eocAI(game: GameHooks, player: Player | null) {
    const T = TILE;
    if (!this.aiInit) { this.aiInit = true; this.visAngle = Math.PI; }   // 素材正面朝下（类默认已根修为 0）
    if (!player) return;
    // 类字段默认 ai0=-1120 是史莱姆族约定初值;原版 ai[0] 从 0 起步(NewNPC 清零)。
    // 缺此归一时 ai0∉{0,1,2,3} 状态机无分支匹配 → 夜晚整段 P1/P2 全空转 =
    // 眼悬停不动(F6 面板/自然刷怪两路都会触发)。同 bInit 复位族(kingSlime/queenBee)
    // 的入口级归一——2026-08-13 用户报"克眼呆在空中"
    if (this.ai0 < 0) this.ai0 = 0;
    const dx = player.cx - this.cx, dy = player.cy - this.cy;
    const dist = Math.hypot(dx, dy) || 1;
    // Main.Difficulty / Main.expertMode（:19903 起；getGoodWorld 抬档同义）
    const diff = mainDifficulty(game.world);
    const expert = mainExpertMode(game.world);
    // Main.getGoodWorld（for the worthy 种子）——11 处抬档分支（:20037-20691）
    const ftw = !!game.world.seedFlags?.getGoodWorld;
    // flag2/flag3（:19906-19915，专家档专用）：hp<12% / hp<4%
    const flag2 = expert && this.hp < this.maxHp * 0.12;
    const flag3 = expert && this.hp < this.maxHp * 0.04;
    // num4（:19917-19921）：连冲冲程，狂暴档减半
    let num4 = 20;
    if (flag3) num4 = 10;

    // num7（:20024-20034）：脸向角 = atan2(NPC→player) − π/2；Y 锚 = 底边上方 59px
    // （position.Y + height − 59——EoC 高 110,与几何中心差 4px≈2° 瞄准偏角;
    // 曾用 cy,R23a 低偏差修;bossAI.ts 双子核同款 −59 写法早已保留）
    const face = Math.atan2(player.cy - (this.y + this.h - 59), dx) - Math.PI * 0.5;

    // ---- 旋转追踪速率表（:19939-19966）：默认 0；专家 ×1.5；狂暴归 0 锁脸 ----
    // 此前恒 0.02 起步 + 悬浮 40t 抬 0.05——与原版分档表不符（悬浮 40t 档属冲刺态）
    let rotRate = 0;
    if (this.ai0 === 0 && this.state === 0) rotRate = 0.02;
    if (this.ai0 === 0 && this.state === 2 && this.ai2 > 40) rotRate = 0.05;
    if (this.ai0 === 3 && this.state === 0) rotRate = 0.05;
    if (this.ai0 === 3 && this.state === 2 && this.ai2 > 40) rotRate = 0.08;
    if (this.ai0 === 3 && this.state === 4 && this.ai2 > num4) rotRate = 0.15;
    if (this.ai0 === 3 && this.state === 5) rotRate = 0.05;
    if (expert) rotRate *= 1.5;
    if (flag3 && expert) rotRate = 0;
    this.applyEocRotation(face, rotRate);

    // reflectsProjectiles 每 tick 复位（:20029）——变身段 getGoodWorld 下置 true
    // （:20258-20261）反弹玩家弹幕；出变身段后由本行自然清回
    this.reflectsProjectiles = false;

    // ---- 共享血雾（:20112-20117，aiStyle4 旋转段后/状态机前,全阶段每拍执行）：
    //      1/5 概率 dust 5（EoC 红雾),盒 (w, h×0.5) @ (0, h×0.25),
    //      speedX = velocity.X（★冲刺 15px/t 时红雾随眼同速喷出再凝滞 = 速度感
    //      拖影轨迹）+ speedY = 2,生后 v×(0.5, 0.1) 凝滞。
    //      ★曾整段漏移植——P2 冲刺只有本体残影、无血雾轨迹（2026-09-01 用户对照）----
    if (Math.random() < 0.2) {
      const mist = game.spawnDust?.(this.x, this.y + this.h * 0.25, this.w, Math.floor(this.h * 0.5), 5,
        this.vx, 2);
      if (mist) { mist.vx *= 0.5; mist.vy *= 0.1; }
    }

    // ---- 白天/NPC 自身死亡动画位：向上漂离 + EncourageDespawn(10)（:20122-20127）----
    // 原版在旋转段之后 return：状态机与 ai[2] 全部冻结，复活后从冻结处继续。
    // ★MINOR-3（2026-09-02 双触发摘除）：原版门 = `Main.IsItDay() | dead`——dead 是
    //   NPC 自身死亡动画位（checkDead 置位）,非玩家死亡。`|| player.dead` 系自加偏离,
    //   摘除：死亡玩家 active 仍真、hitbox 照常参与索敌与 CheckActive 两窗（:78736
    //   尸体几何）,EoC 夜间对尸继续状态机、复活原地续打;本仓死亡怪即时出桶,AI 不再
    //   跑 → NPC 自身 dead 位无对应消费面（登记）。兜底 `dist > T*120 → dead=true`
    //   同为自加偏离一并摘除——离屏退场统一由 CheckActive 四步承担（boss 归零翻假
    //   :78791-78794,无需 AI 层自杀;旧兜底会把"玩家死后漂离"曲解为瞬灭）
    // ★IIIII224：Main.IsItDay()（:20121；remix 世界恒 false）——非渲染昼夜
    if (game.world.isItDay) {
      this.vy -= 0.04;
      this.encourageDespawn(10);
      this.x += this.vx; this.y += this.vy;
      return;
    }

    if (this.ai0 === 0) {
      // ================= P1（ai[0]==0，:20026-20236） =================
      if (this.state === 0) {
        // ---- 悬浮伺服（:20030-20081）：5/0.04；专家 7/0.15；FTW +1/+0.05（:20037-20041） ----
        this.dashing = false;
        let num10 = 5, num11 = 0.04;
        if (expert) { num11 = 0.15; num10 = 7; }
        if (ftw) { num11 += 0.05; num10 += 1; }
        this.servoTo(player.cx, player.cy - 200, num10, num11);
        this.facing = dx > 0 ? 1 : -1;
        this.ai2 += 1;
        // num15（:20046-20047）= 到悬浮目标点(玩家中心−200y)的距离——仆从门专用
        const hoverDist = Math.hypot(player.cx - this.cx, player.cy - 200 - this.cy);
        // 悬浮计时 600t 出冲（:20083-20095；专家 ×0.35 = 210）
        let num16 = 600;
        if (expert) num16 *= 0.35;
        if (this.ai2 >= num16) {
          this.state = 1; this.ai2 = 0; this.chargesLeft = 0; this.servantT = 0;
        } else if ((this.y + this.h < player.y && hoverDist < 500) || (expert && hoverDist < 500)) {
          // 仆从累计（:20096-20111）：NPC 在玩家上方且 num15<500（专家仅距离门）——
          // num15 = 到【悬浮目标点】(玩家中心−200y)的距离（:20046-20047），非到玩家中心；
          // 110t（专家 ×0.4；FTW 再 ×0.8 = 35.2t）召一只，速度 5 / 专家 6
          if (!player.dead) this.servantT += 1;
          let num17 = 110;
          if (expert) num17 *= 0.4;
          if (ftw) num17 *= 0.8;                    // :20107-20110
          if (this.servantT >= num17) {
            this.servantT = 0;
            const num18 = expert ? 6 : 5;
            const s = Enemy.fromVanilla(5, this.cx + (dx / dist) * 10, this.cy + (dy / dist) * 10);
            if (s) {
              // ★Bottom 锚（1457 :20233 NewNPC((int)vector2.X,(int)vector2.Y,5),
              //  vector2=Center+dir×10 → Bottom=(X,Y)）:仆从顶 = 锚点 y−h——旧中心锚低 h/2
              s.y = this.cy + (dy / dist) * 10 - s.h;
              s.vx = (dx / dist) * num18;
              s.vy = (dy / dist) * num18;
              (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(s, 'enemies');
              // SoundID 3 = NPCHit（:20140，原版在仆从落点播，非召唤音）
              game.playSfxFiles?.(['NPC_Hit_1'], 1, this.cx, this.cy);
              game.spawnParticles(s.cx, s.cy, '#9A8FA0', 10, 2);
            }
          }
        }
      } else if (this.state === 1) {
        // ---- 冲刺预备（:20148-20169）：锁脸即发，速 6 / 专家 7 / FTW +1 ----
        this.visAngle = face;
        let num23 = expert ? 7 : 6;
        if (ftw) num23 += 1;                        // :20156-20159
        this.vx = (dx / dist) * num23;
        this.vy = (dy / dist) * num23;
        this.state = 2; this.ai2 = 0;
        this.dashing = true;
      } else if (this.state === 2) {
        // ---- 冲刺（:20170-20222）：40t 后 0.98 摩擦（专家再 ×0.985）；冲程 150 / 专家 100 ----
        // （无粒子:原版冲刺无尘,速度感=共享血雾(:20112)+P2 残影;曾加合成灰粒补偿,清）
        this.dashing = true;
        this.ai2 += 1;
        if (this.ai2 >= 40) {
          this.vx *= 0.98; this.vy *= 0.98;
          if (expert) { this.vx *= 0.985; this.vy *= 0.985; }
          if (ftw) { this.vx *= 0.99; this.vy *= 0.99; }   // :20180-20183
          if (this.vx > -0.1 && this.vx < 0.1) this.vx = 0;
          if (this.vy > -0.1 && this.vy < 0.1) this.vy = 0;
        } else {
          // 冲刺前 40t 旋转锁移动方向（:20195）
          this.visAngle = Math.atan2(this.vy, this.vx) - Math.PI * 0.5;
        }
        let num27 = expert ? 100 : 150;
        if (ftw) num27 -= 15;                       // :20202-20205 冲程 −15
        if (this.ai2 >= num27) {
          this.chargesLeft += 1;
          this.ai2 = 0;
          this.visAngle = face;
          if (this.chargesLeft >= 3) {
            this.state = 0; this.chargesLeft = 0;   // 3 连结束回悬浮（:20212-20216）
          } else {
            this.state = 1;                          // 再冲
          }
        }
      } else {
        this.state = 0; this.ai2 = 0; this.chargesLeft = 0;
      }
      // 变身阈值（:20223-20235）：hp < 50%（专家 65%）→ 段一加速自旋（速度不清零，
      // 由变身段 0.98/t 阻尼自然收尾——原版语义）
      const num28 = expert ? 0.65 : 0.5;
      if (this.hp < this.maxHp * num28) {
        this.ai0 = 1; this.state = 0; this.ai2 = 0;
        this.chargesLeft = 0; this.servantT = 0;
        this.spinSpeed = 0;
        this.phase = 2;                 // 仓内 umbrella：变身起即二阶段（legacy 渲染消费）
        this.dashing = false;
      }
    } else if (this.ai0 === 1 || this.ai0 === 2) {
      // ================= 变身两段（ai[0]==1/2，:20238-20344） =================
      // 段一（ai0==1）加速：ai[2] +=0.005 钳 0.5；段二（ai0==2）减速：-0.005 钳 0。
      // getGoodWorld 再循环旗标 ai[3]==1（本仓 chargesLeft）走加速支（:20241-20250）
      this.dashing = false;
      // FTW 变身段反射玩家弹幕（:20258-20261）——每 tick 先在旋转段后复位
      if (ftw) this.reflectsProjectiles = true;
      if (this.ai0 === 1 || this.chargesLeft === 1) {
        this.spinSpeed = Math.min(0.5, this.spinSpeed + 0.005);
      } else {
        this.spinSpeed = Math.max(0, this.spinSpeed - 0.005);
      }
      this.visAngle += this.spinSpeed;
      this.ai2 += 1;                    // 原 ai[1]：段内计时
      // 专家自旋期每 num29t 甩一只仆从（:20262-20300）：随机向 ±200（FTW ×3）归一到速
      // 5、落点 +10；num29 = 20，FTW 且 hp<1/3 时 10（:20263-20266）
      const num29 = ftw && this.hp < this.maxHp / 3 ? 10 : 20;
      if (expert && this.ai2 % num29 === 0) {
        let rx = Math.random() * 400 - 200, ry = Math.random() * 400 - 200;
        if (ftw) { rx *= 3; ry *= 3; }   // :20273-20277 散布 ±600
        const rl = Math.hypot(rx, ry) || 1;
        const s = Enemy.fromVanilla(5, this.cx + (rx / rl) * 10, this.cy + (ry / rl) * 10);
        if (s) {
          // ★Bottom 锚（1457 :20389 vector6=Center+dir×10 → Bottom=(X,Y)）:
          //  仆从顶 = 锚点 y−h——旧中心锚低 h/2
          s.y = this.cy + (ry / rl) * 10 - s.h;
          s.vx = (rx / rl) * 5;
          s.vy = (ry / rl) * 5;
          (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(s, 'enemies');
          game.spawnParticles(s.cx, s.cy, '#9A8FA0', 10, 2);
        }
      }
      if (this.ai2 >= 100) {
        if (this.chargesLeft === 1) {
          // 再自旋一轮满 100t（:20305-20310）：旗标与计时归零，留在段二减速收尾
          this.chargesLeft = 0;
          this.ai2 = 0;
        } else {
          this.ai0 += 1;
          this.ai2 = 0;
          if (this.ai0 === 3) {
            // 段二满 100t → P2（:20312-20315）：ai[2] 清零收住残余自旋
            this.spinSpeed = 0;
          } else {
            // 段一满 100t（1456:20316-20330 / 1457:20417-20431）：NPCHit(3) + gore 8/7/6 ×2 + 尘 5 ×20 + Roar(15)
            game.playSfxFiles?.(['NPC_Hit_1'], 1, this.cx, this.cy);
            game.playSfx('roar', 1, this.cx, this.cy);   // 1456:20329/1457:20430 style0(带坐标衰减,曾缺坐标)
            // gore 8/7/6 ×2（1456:20321-20326 / 1457:20421-20424）：眼肉红条飞散(Gore_6/7/8),速度 ±6px/t,
            // GorePiece.newGore 内叠 NewGore 随机扰动——★曾是 '#8A1A1A' 色块近似,
            // 二阶段变身后的红色触须飞散观感全靠它们(2026-09-01 用户对照原版视频)
            // ★O1 核销(2026-09-02)：原文本目 Next(-30,31)*0.2（61 值域）——61 形合法,勿"修"成 60
            for (let gi = 0; gi < 2; gi++) {
              for (const gid of [8, 7, 6]) {
                GorePiece.newGore(gid, this.x, this.y,
                  (Math.random() * 61 - 30) * 0.2, (Math.random() * 61 - 30) * 0.2);
              }
            }
            // 尘 5 ×20（1456:20327 / 1457:20428 EoC 血雾;★曾误注"尘 20"且用色块近似）
            // ★O1 核销(2026-09-02)：同上 Next(-30,31)*0.2 61 形合法
            for (let di = 0; di < 20; di++) {
              game.spawnDust?.(this.x, this.y, this.w, this.h, 5,
                (Math.random() * 61 - 30) * 0.2, (Math.random() * 61 - 30) * 0.2);
            }
          }
        }
      }
      // :20434（1456:20333）变身期每 tick 掉 1 颗 5 号尘（±6px/t 初速;曾用 '#FF3030' 色块近似）
      // ★O1 核销(2026-09-02)：原文本目 Next(-30,31)*0.2（61 值域）——61 形合法,勿"修"成 60
      game.spawnDust?.(this.x, this.y, this.w, this.h, 5,
        (Math.random() * 61 - 30) * 0.2, (Math.random() * 61 - 30) * 0.2);
      // 速度 0.98/t 阻尼 + 小值清零（:20333-20343）
      this.vx *= 0.98; this.vy *= 0.98;
      if (this.vx > -0.1 && this.vx < 0.1) this.vx = 0;
      if (this.vy > -0.1 && this.vy < 0.1) this.vy = 0;
    } else if (this.ai0 === 3) {
      // ================= P2（ai[0]==3，:20346-20756） =================
      // ---- 伤害/防御每 tick 覆写（:20346-20362，猪鲨同款先例） ----
      // legacy 路径 def 是 ENEMY_DEFS 共享引用——覆写前先拷成实例私有（vanilla 路径
      // fromVanilla 已是拷贝，恒等判断最多拷一次）
      if (this.def === (ENEMY_DEFS[this.key] ?? PLACEHOLDER_DEF)) this.def = { ...this.def };
      this.def.defense = 0;
      let num38 = 18;
      if (expert) {
        if (flag2) this.def.defense = -15;                      // 专家 hp<12%
        if (flag3) { num38 = 20; this.def.defense = -30; }      // 专家 hp<4%
      }
      // GetAttackDamage_LerpBetweenFinalValues(23, num38)（:7026 = Remap Classic→Expert）
      // 再 CappedAtMaster（:7020）：经典 23 / 专家 36 / 大师 54
      this.def.damage = getAttackDamageCappedAtMaster(
        Math.trunc(remap(diff, GDL.CLASSIC, GDL.EXPERT, 23, num38)), diff);

      // 专家 hp<12% 起手即走"悬下方回冲"（:20363-20366；ai[2] 不清零为原版怪癖）
      if (this.state === 0 && flag2) this.state = 5;

      if (this.state === 0) {
        // ---- 悬浮（:20367-20430）：6/0.07；专家按 400/600/800px 距离爬坡 +1/+0.05；
        //      FTW +1/+0.1（:20390-20394） ----
        this.dashing = false;
        let num39 = 6, num40 = 0.07;
        if (dist > 400 && expert) {
          num39 += 1; num40 += 0.05;
          if (dist > 600) {
            num39 += 1; num40 += 0.05;
            if (dist > 800) { num39 += 1; num40 += 0.05; }
          }
        }
        if (ftw) { num39 += 1; num40 += 0.1; }
        this.servoTo(player.cx, player.cy - 120, num39, num40);
        this.facing = dx > 0 ? 1 : -1;
        this.ai2 += 1;
        if (this.ai2 >= 200) {
          this.state = 1; this.ai2 = 0; this.chargesLeft = 0;
          if (expert && this.hp < this.maxHp * 0.35) this.state = 3;   // :20436-20439 → 连冲
        }
        if (expert && flag3) {
          // :20443-20450 狂暴：直接转连冲，ai[3] −1000（计数远不达 5 → 持续连冲）
          this.state = 3; this.ai2 = 0; this.chargesLeft -= 1000;
        }
      } else if (this.state === 1) {
        // ---- 冲刺预备（:20452-20478）：ForceRoar(36) style0 = Roar_0 满响带坐标衰减；
        //      case36 直接覆盖槽(旧实例续播)——replace=true 豁免互斥；
        //      6.8（专家第 2/3 冲 ×1.15/×1.30；FTW ×1.2 :20465-20468） ----
        game.playSfxWav?.('Roar_0', 1, this.cx, this.cy, undefined, true);
        this.visAngle = face;
        let num44 = 6.8;
        if (expert && this.chargesLeft === 1) num44 *= 1.15;
        if (expert && this.chargesLeft === 2) num44 *= 1.3;
        if (ftw) num44 *= 1.2;
        this.vx = (dx / dist) * num44;
        this.vy = (dy / dist) * num44;
        this.state = 2; this.ai2 = 0;
        this.dashing = true;
      } else if (this.state === 2) {
        // ---- 冲刺（:20479-20534）：50t(专家)后 0.97 摩擦(+专家 ×0.98)；冲程 130 / 专家 90 ----
        this.dashing = true;
        if (this.ai2 % 2 === 0) {
          game.spawnParticles(this.cx, this.cy, '#FF4040', 2, 2);
        }
        this.ai2 += 1;
        const num48 = expert ? 50 : 40;
        if (this.ai2 >= num48) {
          this.vx *= 0.97; this.vy *= 0.97;
          if (expert) { this.vx *= 0.98; this.vy *= 0.98; }
          if (this.vx > -0.1 && this.vx < 0.1) this.vx = 0;
          if (this.vy > -0.1 && this.vy < 0.1) this.vy = 0;
        } else {
          this.visAngle = Math.atan2(this.vy, this.vx) - Math.PI * 0.5;
        }
        const num49 = expert ? 90 : 130;
        if (this.ai2 >= num49) {
          this.chargesLeft += 1;
          this.ai2 = 0;
          this.visAngle = face;
          if (this.chargesLeft >= 3) {
            this.state = 0; this.chargesLeft = 0;   // 3 连结束回悬浮（:20518-20521）
            if (expert && this.hp < this.maxHp * 0.5) {
              // :20522-20526 专家 hp<50% → 预测连冲，起手计数 +Next(1,4)
              this.state = 3;
              this.chargesLeft += 1 + Math.floor(Math.random() * 3);
            }
          } else {
            this.state = 1;                          // 再冲
          }
        }
      } else if (this.state === 3) {
        // ---- 预测连冲预备（:20535-20644，专家专属态）：带玩家速度提前量直冲 ----
        if (this.chargesLeft === 4 && flag2 && this.cy > player.cy) {
          // :20537-20544 已连冲 4 次且漂到玩家下方 → 回悬浮（防无限连冲）
          this.state = 0; this.ai2 = 0; this.chargesLeft = 0;
          this.dashing = false;
        } else {
          let num50 = 20;                  // 冲速
          let num51 = dx, num52 = dy;      // 指向玩家
          // 提前量系数（:20552-20561）：|pvx|+|pvy|/4 再 +=10−self ≡ 恒 10（钳 5..15 原文照抄）
          let num53 = Math.abs(player.vx) + Math.abs(player.vy) / 4;
          num53 += 10 - num53;
          if (num53 < 5) num53 = 5;
          if (num53 > 15) num53 = 15;
          if (this.ai2 === -1 && !flag3) { num53 *= 4; num50 *= 1.3; }   // :20562-20566 悬下方回冲
          if (flag3) num53 *= 2;                                          // :20567-20570 狂暴双倍
          num51 -= player.vx * num53;
          num52 -= player.vy * num53 / 4;
          num51 *= 1 + (Math.random() * 21 - 10) * 0.01;                  // :20573-20574 ±10% 散布
          num52 *= 1 + (Math.random() * 21 - 10) * 0.01;
          if (flag3) {
            num51 *= 1 + (Math.random() * 21 - 10) * 0.01;
            num52 *= 1 + (Math.random() * 21 - 10) * 0.01;
          }
          const num54 = Math.hypot(num51, num52) || 1;
          const num55 = num54;
          this.vx = (num51 / num54) * num50;
          this.vy = (num52 / num54) * num50;
          this.vx += (Math.random() * 41 - 20) * 0.1;                     // :20585-20586 ±2 抖动
          this.vy += (Math.random() * 41 - 20) * 0.1;
          if (flag3) {
            // 狂暴（:20587-20607）：再抖 ±5 → 十字翻折（|v| 分量互换带侧向符号）→ 归一 ×num50
            this.vx += (Math.random() * 101 - 50) * 0.1;
            this.vy += (Math.random() * 101 - 50) * 0.1;
            let num56 = Math.abs(this.vx), num57 = Math.abs(this.vy);
            if (this.cx > player.cx) num57 *= -1;
            if (this.cy > player.cy) num56 *= -1;
            this.vx = num57 + this.vx;
            this.vy = num56 + this.vy;
            const vl = Math.hypot(this.vx, this.vy) || 1;
            this.vx = (this.vx / vl) * num50;
            this.vy = (this.vy / vl) * num50;
            this.vx += (Math.random() * 41 - 20) * 0.1;
            this.vy += (Math.random() * 41 - 20) * 0.1;
          } else if (num55 < 100) {
            // 近距（:20608-20625）：水平冲 → 垂直翻折（v 分量互换带侧向符号）
            if (Math.abs(this.vx) > Math.abs(this.vy)) {
              let num58 = Math.abs(this.vx), num59 = Math.abs(this.vy);
              if (this.cx > player.cx) num59 *= -1;
              if (this.cy > player.cy) num58 *= -1;
              this.vx = num59;
              this.vy = num58;
            }
          } else if (Math.abs(this.vx) > Math.abs(this.vy)) {
            // 远距水平（:20626-20640）：斜 45° 折冲
            let num60 = (Math.abs(this.vx) + Math.abs(this.vy)) / 2;
            let num61 = num60;
            if (this.cx > player.cx) num61 *= -1;
            if (this.cy > player.cy) num60 *= -1;
            this.vx = num61;
            this.vy = num60;
          }
          this.state = 4;
          this.dashing = true;
        }
      } else if (this.state === 4) {
        // ---- 连冲（:20645-20698）：冲程 num4（20 / 狂暴 10），+13t 摩擦尾，5 连后回悬浮 ----
        // SoundID 36 ForceRoar style-1（:20647-20650/:1312-1325）= Roar_0 满响 + pitch0.6
        // （升调吼——playWavFile 第 5 参直传 2^0.6;case36 覆盖槽语义 replace=true;
        //  曾 0.7 音量+无变调,2026-08-18 对账修）
        if (this.ai2 === 0) game.playSfxWav?.('Roar_0', 1, this.cx, this.cy, 0.6, true);
        this.dashing = true;
        // （无粒子:原版连冲无尘,速度感=共享血雾+残影;曾加合成红粒补偿,清）
        const num62 = num4;
        this.ai2 += 1;
        if (this.ai2 === num62 && Math.hypot(this.x - player.x, this.y - player.y) < 200) {
          this.ai2 -= 1;   // :20653-20656 贴脸 <200px 原地延时一格
        }
        if (this.ai2 >= num62) {
          this.vx *= 0.95; this.vy *= 0.95;
          if (this.vx > -0.1 && this.vx < 0.1) this.vx = 0;
          if (this.vy > -0.1 && this.vy < 0.1) this.vy = 0;
        } else {
          this.visAngle = Math.atan2(this.vy, this.vx) - Math.PI * 0.5;
        }
        const num63 = num62 + 13;
        if (this.ai2 >= num63) {
          this.chargesLeft += 1;
          this.ai2 = 0;
          if (this.chargesLeft >= 5) {
            // 5 连结束（:20679-20682）回悬浮；FTW 且与玩家有视线 → Roar 后重启
            // 变身段二自旋（:20683-20691：ai[0]=2 / ai[1]=0 / ai[2]=0 / ai[3]=1，
            // 再循环旗标落在本仓 chargesLeft，变身段加速支复跑一轮）。CanHit 玩家
            // 矩形传 boss 自身 w/h（原版即如此，:20686）
            if (ftw && canHit(game.world.store, this.x, this.y, this.w, this.h,
              player.x, player.y, this.w, this.h)) {
              game.playSfx('roar', 1, this.cx, this.cy);   // :20685 style0(带坐标衰减,曾缺坐标)
              this.ai0 = 2; this.state = 0; this.ai2 = 0;
              this.spinSpeed = 0; this.chargesLeft = 1;
            } else {
              this.state = 0; this.chargesLeft = 0;
            }
            this.dashing = false;
          } else {
            this.state = 3;                          // 继续连冲
          }
        }
      } else if (this.state === 5) {
        // ---- 悬玩家下方 600px（:20699-20752，专家 hp<12% 狂暴态）：9/0.3 快伺服 ----
        this.dashing = false;
        this.servoTo(player.cx, player.cy + 600, 9, 0.3);
        this.facing = dx > 0 ? 1 : -1;
        this.ai2 += 1;
        if (this.ai2 >= 70) {
          this.state = 3;
          this.ai2 = -1;                                        // → 连冲预备走 ×4 提前量支（:20562）
          this.chargesLeft = Math.floor(Math.random() * 4) - 3;  // Next(-3,1) ∈ [-3,0]
        }
      } else {
        this.state = 0; this.ai2 = 0; this.chargesLeft = 0;
      }
      // 狂暴档不允许停留悬下方态（:20753-20755）
      if (flag3 && this.state === 5) this.state = 3;
    }

    // 移动：EoC 全程 noTileCollide——AI 内自积分（:5717 的 noTileCollide 分支属
    // flyAI,非通用物理;此处是唯一积分点,曾误删致 EoC 定格）+ 世界边界钳制
    this.x += this.vx; this.y += this.vy;
    this.onGround = false; this.hitWall = false; this.hitHead = false;
    const maxX = game.world.w * T - this.w, maxY = game.world.h * T - this.h;
    this.x = Math.max(0, Math.min(maxX, this.x));
    this.y = Math.max(0, Math.min(maxY, this.y));
  }

  /** AI_094 星璇四塔（NPC.cs:41029-41443，1:1）。塔 = NPC（非 tile entity）。
   *  原版 dontTakeDamage（盾>0 完全免伤，:41162-41176 每 tick 重算）= 真 dontTakeDamage
   *  全通道闸（R23b-P1 落刀,见下方 §3——旧「iframes=2 每 tick 刷新近似」被 pierce===1
   *  单发弹绕过,已退役）。血尽先由 hurt() 转 ai2=1 死亡演出（checkDead
   *  :78867-78875），180t 渐隐后走标准死亡管线（碎片掉落/塔灭公告）。
   *  分塔支线【已全量实装】（旧头注「按文档简化许可折叠为直接 spawnNPC/传送门演出
   *  二期补」失真,BJ112-c 清债 2026-09-17 更真;实装清单见 §7 :13559-13660）：
   *  · 493 星尘 = 真 540 标记链（StardustMarkProj.spawnStardustMarks 'tower' 档,
   *    :44142-44228,「折叠直生」已退役）
   *  · 422 星旋 = 玩家头顶门+空中随机点门双支线（578/579=VortexPortalProj,90t 演出
   *    门,!CanHitLine 视线门;1458 :39694-39737 支线 b 在位）
   *  · 517 日耀 = 塔顶直投 519（RotatedByRandom 斜抛）
   *  · 507 星云 = 仅环境尘（ai1 无消费面,怪全靠 Zone 刷怪表）
   *  · 四塔共用 = 环境尘（柱身 241+顶晶分塔 id/黑染色）+ 死亡演出尘（towerDeathDust） */
  private towerAI(game: GameHooks, player: Player | null) {
    const w = game.world;
    const key = TOWER_KEY[this.vanillaId ?? -1];
    if (!key || this.dead) return;   // 真死后不再跑（防死亡管线重复触发）
    // ★BJ510（2026-10-04 用户复报"四柱晚上依然暗"定谳面）：原版塔 spriteDirection =
    // 字段默认 -1（NPC.cs:6522）且 AI_094 全程无 spriteDirection 写面 → DrawNPC
    // :23357-23361 `spriteDirection==1 → FlipHorizontally` 判否 = 塔【恒不镜像】。
    // 本仓 facing 缺省 1（Enemy:1552）≙ spriteDirection=1 → 通用镜像门（Renderer
    // drawEnemy `e.facing>0 → scale(-1,1)`）误翻本体，且 BJ509 vel4 收集侧 `!mirror`
    // 守卫恒假 → towerGlowQueue 永不入队（探针实锤：四塔在场 queueLen=0/facing=1）
    // → 7d''' 光照合成后消费层永不生效，残影留在实体层被 compositeLight 压暗 =
    // 用户实报夜间塔身暗。钉 -1 = spriteDirection 恒默认语义（towerAI 无 gameplay
    // 消费面；贴图近对称此前未显形）。
    this.facing = -1;
    const le = w.lunarEvent;
    const st = w.store;
    const count = (id: number): number => {
      let n = 0;
      for (const o of game.enemies() as Enemy[]) {
        if (!o.dead && o.vanillaId === id) n++;
      }
      return n;
    };
    const distTo = (px: number, py: number) => Math.hypot(px - this.cx, py - this.cy);

    // ---- 1. 死亡演出（ai2==1，:41031-41128）----
    if (this.ai2 === 1) {
      // velocity = UnitY * velocity.Length()（:41033）：保留速率只留 +Y 分量，±0.25 钳（步进 0.02）
      const spd = Math.hypot(this.vx, this.vy);
      this.vx = 0;
      this.vy = spd;
      if (this.vy < 0.25) this.vy += 0.02;
      if (this.vy > 0.25) this.vy -= 0.02;
      // ★须用真 dontTakeDamage 而非 iframes——hurt 的免疫门有 pierce!==1 豁免
      // （单发弹绕过 iframes），原版死亡演出期是全通道 dontTakeDamage（1458 :39368）
      this.iframes = 2;
      this.dontTakeDamage = true;
      this.ai1++;
      if (this.ai1 > 120) {
        // Opacity = 1-(ai1-120)/60（:41046）→ 本仓 spawnAlpha（0..255，越大越透明）
        const opacity = Math.max(0, 1 - (this.ai1 - 120) / 60);
        this.spawnAlpha = Math.round((1 - opacity) * 255);
      }
      // 分塔演出尘（1457 :39375-39444 逐组 1:1；1458 同域 diff 零变更）——四组全走
      // 原版 Dust 池（towerDeathDust），dustId 分塔（:39375-39389 switch 序）：
      // 日耀 127 / 星旋 229 / 星云 242 / 星尘 135（柱体环境尘是 6/229/242/135，
      // 死亡演出日耀换 127=柱身白烟同族）。BJ109-D 登记的「三组折二组+塔色 hex
      // 近似」在本刀清偿。爆散声在组 3 内逐处播（每 tick 0-3 次，:39435）。
      const ddust = this.vanillaId === 517 ? 127 : this.vanillaId === 422 ? 229
        : this.vanillaId === 507 ? 242 : this.vanillaId === 493 ? 135 : 6;
      this.towerDeathDust(game, ddust);
      // 每 60t 音效（1457 :39445-39448）= PlaySound(4,…,22) = **NPC_Killed_22**(case4
      // 死音库)——曾误配 Killed_1+Unlock 双音(旧批查的是 aiStyle 92 木桩段,终审修)
      if (this.ai1 % 60 === 1) game.playSfxWav?.('NPC_Killed_22', 1, this.cx, this.cy);
      this.x += this.vx;
      this.y += this.vy;
      if (this.ai1 >= 180) {
        // life=0 + HitEffect + checkDead（:41122-41127）→ 真死（碎片 3456-3459 + 塔灭公告）
        // 先清 dontTakeDamage 再走标准死亡管线（同 golem 先例，hurt 门会早退该旗）
        // ★BJ502（2026-10-04）：1e9=合成致死值（原版本位=life=0 直落,无 StrikeNPC）
        //   ——飘值门已统一原版形态（rawDmg>=9999 且合成 owner255 位,见 hurt 飘值块）
        //   后恒静音;曾冒 999999990（1e9−塔防20×0.5,用户实报"9999990"）大字。
        //   勿回改精确匹配门;勿改传 9999（hp 已满血重置,9999+0−10 不足致死）。
        this.iframes = 0;
        this.dontTakeDamage = false;
        this.hurt(1e9, 0, 0, game);
      }
      return;
    }

    // ---- 2. 受击闪光 ai3>0（:41130-41161；ai3 由扣盾置 1，>120 归零）----
    if (this.ai3 > 0) {
      if (this.ai3 === 1) game.playSfxFiles?.(['NPC_Killed_3'], 1, this.cx, this.cy); // :41152-41155
      this.ai3++;
      if (this.ai3 > 120) this.ai3 = 0;
    }
    // ---- 3. 盾判定（1458 :39493-39501）：dontTakeDamage = 本塔 ShieldStrength>0（每帧重算）----
    // ★R23b-P1 修：曾用 iframes=2 每 tick 刷新近似，但 Enemy.hurt 免疫门是
    // `pierce!==1 && iframes>0`——pierce===1 单发弹（箭/枪弹/多数随从）完全绕过，
    // 盾 100 层期间可被弓/枪直接磨塔血。原版是全通道闸 dontTakeDamage
    // （NPC.cs:39493-39501 switch 四塔逐 id 重算），改法同 golem 先例
    // （bossAI_golem.ts:334）；盾扣到 0 的下一 tick 本式自动清旗=解封。
    // （盾破瞬间的 NPCDeath58 音效由 Game.onEnemyKilled 扣盾归零处播放——等价 :41148-41151）
    this.dontTakeDamage = le.shield[key] > 0;

    // ---- 4. 远离自愈（:41177-41191）----
    if (player && distTo(player.cx, player.cy) > 2000) this.lai0++;
    if (this.lai0 >= 60) {
      this.lai0 = 0;
      this.hp = Math.max(0, Math.min(this.maxHp, this.hp + 200));
    } else {
      this.lai0 = 0;   // 原版 else 每 tick 清零（:41188-41191）——自愈实际不可达，照抄不"修"
    }

    // ---- 5. 悬停（:41192）+ 贴地（:41193-41214）----
    this.vx = 0;
    this.vy = Math.sin(Math.PI * 2 * (this.ai0 / 300)) * 0.5;
    const ox = Math.floor(this.cx / TILE);
    const oy = Math.floor((this.y + this.h) / TILE);
    const solidDown = (maxDist: number): number => {
      for (let d = 0; d <= maxDist; d++) {
        const yy = oy + d;
        if (!st.inBounds(ox, yy)) return -1;
        if (st.isSolid(ox, yy)) return yy;
      }
      return -1;
    };
    const near = solidDown(10);
    if (near >= 0) {
      // 近（≤10 格）：按距离比下沉 1.5×（:41200-41204，塔底压向地面）
      this.y -= 1.5 * (1 - Math.abs(oy - near) / 10);
    } else if (solidDown(20) < 0) {
      // 远（>20 格）：上浮 1.5×，20-30 格间线性插值（:41205-41213）
      let f = 1;
      const far = solidDown(30);
      if (far >= 0) f = Math.max(0, Math.min(1, (Math.abs(oy - far) - 20) / 10));
      this.y += 1.5 * f;
    }

    // ---- 6. 世界边界钳制（:41215-41238；60 格边距 + 80px 内推）----
    // 原版 Y 上限也取 maxTilesX*16（:41215-41216 的 num1489 怪癖）——照抄
    const limX = w.w * TILE;
    const limY = w.w * TILE;
    const m = 60 * TILE;
    if (this.cx < m) this.x = m + 80 - this.w / 2;
    if (this.cx > limX - m) this.x = limX - m - 80 - this.w / 2;
    if (this.cy < m) this.y = m + 80 - this.h / 2;
    if (this.cy > limY - m) this.y = limY - m - 80 - this.h / 2;
    // 塔底地表钳（1458 :39566-39571）：isThereAWorldSurface(=worldSurface>50) 为假
    // （remix 系无地表）→ Y<640 提到 rockLayer*16；否则仅 !remix && !getGood 才执行
    // 「塔底 > worldSurface*16-100 → 提到线下 100」（R23b-P3：曾无条件钳制，
    // FTW/remix 种子下塔被错误按地表钳位）
    if (w.groundLevel <= 50) {
      if (this.y < 640) this.y = w.rockLevel * TILE;
    } else if (!w.seedFlags?.remix && !w.seedFlags?.getGoodWorld
      && this.y + this.h > w.groundLevel * TILE - 100) {
      this.y = w.groundLevel * TILE - this.h - 100;
    }

    this.ai0++;
    if (this.ai0 >= 300) this.ai0 = 0;   // :41251-41256

    // ---- 7. 分塔支线 ----
    if (this.vanillaId === 493) {
      // 星尘（1456 :41257-41286 = 1457 :39584-39603）：环境尘（柱身 241 + 顶晶 135）
      // + SpawnStardustMark_StardustTower（:44142-44228）
      this.towerEnvDust(game, 135, false);
      if (this.ai1 > 0) this.ai1--;
      if (this.ai1 <= 0 && player && !player.dead
        && distTo(player.cx, player.cy) < 1080 && player.y - this.y < 400) {
        // 真 540 标记链（:44142-44228，StardustMarkProj.spawnStardustMarks 'tower' 档）：
        // 孵化池 {405∪406<2→405, 402<2→402, 407<1→407} 随机选一 → BFS 世代展开一串
        // 标记弹（根锚 = 塔 Top−UnitY×120 = (cx, y−120)，:44154），仅末位标记淡入破零
        // 时孵化该 NPC——旧「折叠直生」已退役（行为对齐蠕虫 402 侧 :44230-44314）
        const marks = spawnStardustMarks(game, this.cx, this.y - 120, 'tower');
        this.ai1 = marks ? 30 * (5 + ((Math.random() * 11) | 0)) : 30;   // 30*Next(5,16) / :44225-44227
      }
    } else if (this.vanillaId === 422) {
      // 星旋（1456 :41310-41406 = 1457 :39637-39734）：环境尘（柱身 241 + 顶晶 229
      // 黑染色）+ 玩家头顶传送门 + 空中随机点传送门（均先 90t 门演出再开门）
      this.towerEnvDust(game, 229, true);
      if (this.ai1 > 0) this.ai1--;
      // 支线 a（:41336-41361）：3240px 内且【塔→玩家视线被阻】(!CanHitLine) → 玩家头顶门；
      // n428+n427+n426<14 → 579 门（90t 后生 2× Alien Hornet 427，VortexPortalProj）否则
      // 578 门（90t 放 580 电击弹）。!CanHitLine 门 2026-08-19 补（原省略——玩家躲在墙后
      // 塔才开门，原版语义）
      if (this.ai1 <= 0 && player && !player.dead && distTo(player.cx, player.cy) < 3240
        && !losClear(game, this.cx, this.cy, player.cx, player.cy)) {   // :41336
        this.ai1 = 60 + ((Math.random() * 120) | 0);
        // 玩家头顶上扫 ≤10 格找空隙（:41341-41349：SolidTile 即停 / 越上界即停）
        const ptx = Math.floor(player.cx / TILE);
        let py = Math.floor(player.y / TILE);               // player.Top
        for (let i = 0; i < 10; i++) {
          if (!st.inBounds(ptx, py) || st.isSolid(ptx, py) || py <= 10) break;
          py--;
        }
        const portal = count(428) + count(427) + count(426) < 14   // flag100 :41345
          ? new VortexPortalProj(ptx * TILE + 8, py * TILE + 24, 579)   // :41355
          : new VortexPortalProj(ptx * TILE + 8, py * TILE + 17, 578);  // :41359（578 门低 7px）
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } })
          .entities.add(portal, 'projectiles');
      }
      // 支线 b（1458 :39694-39737）：1080px 内且低于塔顶 400px、n427+n426*3+n428<20 →
      // 玩家 ±20 格随机空中点 579 门（合格点须塔→玩家视线通畅 :39722-39724）
      if (this.ai1 <= 0 && player && !player.dead
        && distTo(player.cx, player.cy) < 1080 && player.y - this.y < 400
        && count(427) + count(426) * 3 + count(428) < 20) {
        this.ai1 = 420 + ((Math.random() * 360) | 0);
        const ptx = Math.floor(player.cx / TILE);
        const pty = Math.floor(player.cy / TILE);
        const ttx = Math.floor(this.cx / TILE);
        const tty = Math.floor(this.cy / TILE);
        // :41370-41373 塔心→玩家心 >2000px 跳过搜索（flag101 预门）
        if (Math.hypot(player.cx - this.cx, player.cy - this.cy) <= 2000) {
          for (let attempt = 0; attempt < 100; attempt++) {
            const mx = ptx - 20 + ((Math.random() * 41) | 0);
            const my = pty - 20 + ((Math.random() * 41) | 0);
            if (Math.abs(my - pty) <= 8 && Math.abs(mx - ptx) <= 8) continue;   // :41381 玩家 8 格禁圈
            if (Math.abs(my - tty) <= 3 && Math.abs(mx - ttx) <= 3) continue;   // :41381 塔 3 格禁圈
            if (!st.inBounds(mx, my)) continue;
            if (st.isActive(mx, my)) continue;                // :41384 !nactive()（须空格）——nactive 门读 isActive（红蓝对抗 F13：曾用 type≠0 代读,幽灵格误排落点）
            if (st.liquid[st.idx(mx, my)] > 0 && st.liquidType[st.idx(mx, my)] === 2) continue;   // :41386 lava
            let solid5 = false;                               // :41387 SolidTiles 5×5（任一实心即弃）
            for (let sx = mx - 2; sx <= mx + 2 && !solid5; sx++) {
              for (let sy = my - 2; sy <= my + 2; sy++) {
                if (st.inBounds(sx, sy) && st.isSolid(sx, sy)) { solid5 = true; break; }
              }
            }
            if (solid5) continue;
            // ★R23b-P2 修：原版合格点要求塔→玩家 CanHitLine【通过】
            // （1458 :39722-39724 `if (flag105 && !CanHitLine(...)) flag105=false`——
            // 视线被阻则弃点）。曾写反成保留视线被阻点=开阔地形原版会刷的空中门
            // 永不出现、掩体场景与支线 a 重叠
            if (!losClear(game, this.cx, this.cy, player.cx, player.cy)) continue;   // :39722-39724
            (game as unknown as { entities: { add: (e: unknown, b: string) => void } })
              .entities.add(new VortexPortalProj(mx * TILE + 8, my * TILE + 8, 579),   // :41400
                'projectiles');
            break;
          }
        }
      }
    } else if (this.vanillaId === 517) {
      // 日耀（1456 :41431-41443 = 1457 :39736-39761）：环境尘（柱身 241 + 顶晶 6）
      // + 1080px 内且低于塔顶 700px → 塔顶直投 519（斜抛 7-12px/t）
      this.towerEnvDust(game, 6, false);
      if (this.ai1 > 0) this.ai1--;
      if (this.ai1 <= 0 && player && !player.dead
        && distTo(player.cx, player.cy) < 1080 && player.y - this.y < 700) {
        const flare = spawnPart(game, this, 519);
        if (flare) {
          // ★BJ503 坐标面 1:1（:39747-39749）：NewNPC 的 X,Y = 519 中心锚（NPC.cs
          //  NewNPC：position = (X−w/2, Y−h/2)）；vector195 = Top(顶部中点=x+w/2)
          //  + (−w·0.33, −20) + (w·0.66, 20)·RandomVector2(0..1)——★旧码漏 Top 的
          //  +w/2 基准 → 发射带整体左偏半塔宽 65px（519 从塔左肩外喷出=实报
          //  「弹幕效果不对」主面之一），且 Y 漏 (−20..0) 随机带与 −h/2 中心换算。
          //  (int) 截断照抄（:39749 NewNPC 实参强转 float→int 向零取整）。
          const rx = Math.random();                       // RandomVector2 掷 X（:39747）
          const ry = Math.random();                       // 掷 Y（同拍次序）
          flare.x = Math.trunc(this.x + this.w / 2 - this.w * 0.33 + rx * this.w * 0.66) - flare.w / 2;
          flare.y = Math.trunc(this.y - 20 + ry * 20) - flare.h / 2;
          // ★BJ503 掷角面（:39748）：-UnitY.RotatedByRandom(π/4)——RotatedByRandom
          //  = (NextDouble−NextDouble)×max = 对称【三角分布】（峰朝正上）,旧
          //  (rand×2−1)×max 是 uniform=散布形态错（BJ112-④ 三角单源收编清单漏网,
          //  本仓 516/415/428 三处已收编、519 出膛角漏）；方向恒等：unitY 旋转 a
          //  = (−sin a, cos a) → 负号即原版 −UnitY 形 (sin a, −cos a)。
          const sp = 7 + Math.random() * 5;               // :39748 NextFloat×5 + 7
          const [ux, uy] = unitYRotatedByRandom(0.7853981852531433);
          flare.vx = -ux * sp;
          flare.vy = -uy * sp;
        }
        this.ai1 = 60;
      }
    } else if (this.vanillaId === 507) {
      // 星云（1456 :41287-41309 = 1457 :39614-39636）：仅环境尘（柱身 241 + 顶晶 242
      // 黑染色）——ai1 无消费面，怪全靠 Zone 刷怪表
      this.towerEnvDust(game, 242, true);
    }

    // noTileCollide + noGravity：直接位移（原版速度由引擎积分）
    this.x += this.vx;
    this.y += this.vy;
    this.onGround = false;
  }

  /** Vector2.UnitY.RotatedByRandom(maxRadians)（Utils.cs:1785-1787：NextDouble×max −
   *  NextDouble×max = 对称【三角分布】，orchestraFx F6 清偿同式）——RotatedBy 矩阵
   *  [x·c−y·s, x·s+y·c] 作用于 (0,1) → (−sin a, cos a)。
   *  ★BJ112-④ 单源收编：实现委托 bossAI_lunar_misc.unitYRotatedByRandom——415 喷火
   *  尘 / 516 出膛角 / 428 分裂初速三处消费与塔尘族共用同一掷（旧三处 uniform 已收编）。 */
  private towerRotSpread(maxRadians: number): [number, number] {
    return unitYRotatedByRandom(maxRadians);
  }

  /** 四柱环境尘（每 tick，1457 :39584-39603 星尘 / :39614-39636 星云 / :39637-39660
   *  星旋 / :39736-39761 日耀；四段同构仅两参不同，1458 同域 diff 零变更）：
   *  ① 1/5 柱身 241 白烟——NewDust(Left, w, h/2, 241) 后 position 覆写为
   *     Center + UnitY.RotatedByRandom(2π/3)×(w/2, h/2)×(0.8..1)（:39589）、vx=0、
   *     vy=|NewDust 抖 vy|×0.25（:39591）；241 不在烟雾族初速表（Dust.cs:216-222），
   *     抖 vy 是原始 ±2 域。
   *  ② 顶晶 3 连掷各 1/5——盒 Top+(−w·(0.33−0.11i), −20) 宽 (int)(w·(0.66−0.22i))×20
   *     随 i 收窄；vx=0、vy=−|抖 vy−i+悬停 vy−4|（×1 :39599）、noGravity、fadeIn=1、
   *     scale=1+rand+i·0.3（覆写 NewDust 结果，含烟雾族 ×0.7 :39602）。分塔尘 id：
   *     493→135 / 507→242 / 422→229 / 517→6；507/422 两柱 dust.color=Color.Black
   *     黑染色（:39632/:39655）。 */
  private towerEnvDust(game: GameHooks, crystalDust: number, blackTint: boolean): void {
    if (Math.floor(Math.random() * 5) === 0) {          // Main.rand.Next(5) == 0（:39586）
      const d = game.spawnDust?.(this.x, this.cy, this.w, this.h / 2, 241);
      if (d) {
        const m = 0.8 + Math.random() * 0.2;            // :39589 尺度因子（两轴共享单掷）
        const [rx, ry] = this.towerRotSpread(2.094395160675049);
        d.x = this.cx + rx * (this.w / 2) * m;
        d.y = this.cy + ry * (this.h / 2) * m;
        d.vx = 0;                                       // :39590
        d.vy = Math.abs(d.vy) * 0.25;                   // :39591（读 NewDust 抖 vy）
      }
    }
    for (let i = 0; i < 3; i++) {                       // :39593 顶晶 3 连掷
      if (Math.floor(Math.random() * 5) !== 0) continue;
      const d = game.spawnDust?.(this.cx - this.w * (0.33 - 0.11 * i), this.y - 20,
        Math.trunc(this.w * (0.66 - 0.22 * i)), 20, crystalDust);
      if (!d) continue;
      d.vx = 0;                                         // :39598
      d.vy = -Math.abs(d.vy - i + this.vy - 4);         // :39599（this.vy=悬停 ±0.5）
      d.noGravity = true;                               // :39600
      d.fadeIn = 1;                                     // :39601
      d.scale = 1 + Math.random() + i * 0.3;            // :39602
      if (blackTint) d.color = { r: 0, g: 0, b: 0, a: 255 };   // Color.Black（:39632/:39655）
    }
  }

  /** 四柱死亡演出尘（ai2==1 每 tick，1457 :39375-39444 逐组 1:1；1458 同域 diff 零变更）。
   *  dustId 分塔：517→127 / 422→229 / 507→242 / 493→135（:39375-39389）。四组：
   *  ① 柱身 3 粒（1/5 且 ai1<120 :39391）——位 Center±RotatedByRandom(4π/3)×
   *     (w×1.5, h×1.1)×0.8×(0.8..1)（:39396）、vx=0、vy=−|抖 vy−i+上升 vy−4|×3
   *     （:39398）、noGravity/fadeIn=1/scale=1+rand+i·0.3（:39401）；
   *  ② 顶晶 3 掷各 1/4（ai1<150 :39404）——同环境顶晶盒；vy×(1+ai1/180×0.5) 渐强
   *     （:39412）；位不覆写（留 NewDust 盒抖）；
   *  ③ 爆散 3 处×6 粒（1/5 且 ai1<150 :39419）——处位 Center±Rot(4π/3)×(w,h)×0.7×rand
   *     （:39423）、功率 num1372=1+rand×2+ai1/180×4（:39424）、粒位=处位（:39428）、
   *     vx=抖 vx×功率 / vy=−|抖 vy|×功率（:39429-39430）、scale=1.5+rand+j·0.13
   *     （:39433）；逐处 PlaySound(3, SelectRandom(1,18))（:39435 → NPC_Hit_1/18 各半）；
   *  ④ 241 白烟（2/3 且 ai1<150 :39438）——同①盒；位 Center±Rot(4π/3)×(w/2,h/2)×
   *     (0.8..1)（:39441）、vx=0、vy=|抖 vy|×0.25（:39443）。 */
  private towerDeathDust(game: GameHooks, dustId: number): void {
    // ① 柱身（:39391-39404）
    if (Math.floor(Math.random() * 5) === 0 && this.ai1 < 120) {
      for (let i = 0; i < 3; i++) {
        const d = game.spawnDust?.(this.x, this.cy, this.w, this.h / 2, dustId);
        if (!d) continue;
        const m = 0.8 * (0.8 + Math.random() * 0.2);    // :39396 ×0.8×(0.8..1)
        const [rx, ry] = this.towerRotSpread(4.188790321350098);
        d.x = this.cx + rx * (this.w * 1.5) * m;
        d.y = this.cy + ry * (this.h * 1.1) * m;
        d.vx = 0;                                       // :39397
        d.vy = -Math.abs(d.vy - i + this.vy - 4) * 3;   // :39398（this.vy=上升钳值）
        d.noGravity = true;
        d.fadeIn = 1;
        d.scale = 1 + Math.random() + i * 0.3;          // :39401
      }
    }
    // ② 顶晶（:39404-39419）
    if (this.ai1 < 150) {
      for (let i = 0; i < 3; i++) {
        if (Math.floor(Math.random() * 4) !== 0) continue;   // Main.rand.Next(4) == 0
        const d = game.spawnDust?.(this.cx - this.w * (0.33 - 0.11 * i), this.y - 20,
          Math.trunc(this.w * (0.66 - 0.22 * i)), 20, dustId);
        if (!d) continue;
        d.vx = 0;                                       // :39411
        d.vy = -Math.abs(d.vy - i + this.vy - 4) * (1 + this.ai1 / 180 * 0.5);   // :39412
        d.noGravity = true;
        d.fadeIn = 1;
        d.scale = 1 + Math.random() + i * 0.3;          // :39415
      }
    }
    // ③ 爆散（:39419-39437）
    if (Math.floor(Math.random() * 5) === 0 && this.ai1 < 150) {
      for (let k = 0; k < 3; k++) {
        const m = 0.7 * Math.random();                  // :39423 ×(w,h)×0.7×rand
        const [rx, ry] = this.towerRotSpread(4.188790321350098);
        const bx = this.cx + rx * this.w * m;
        const by = this.cy + ry * this.h * m;
        const pw = 1 + Math.random() * 2 + this.ai1 / 180 * 4;   // :39424 num1372
        for (let j = 0; j < 6; j++) {
          const d = game.spawnDust?.(bx, by, 4, 4, dustId);      // :39427 盒 4×4
          if (!d) continue;
          d.x = bx; d.y = by;                          // :39428 position = vector193
          d.vx *= pw;                                  // :39429（抖 vx×功率）
          d.vy = -Math.abs(d.vy) * pw;                 // :39430
          d.noGravity = true;
          d.fadeIn = 1;
          d.scale = 1.5 + Math.random() + j * 0.13;    // :39433
        }
        game.playSfxWav?.(Math.random() < 0.5 ? 'NPC_Hit_1' : 'NPC_Hit_18', 1, bx, by);
      }
    }
    // ④ 241 白烟（:39438-39444）
    if (Math.floor(Math.random() * 3) !== 0 && this.ai1 < 150) {   // Next(3) != 0 = 2/3
      const d = game.spawnDust?.(this.x, this.cy, this.w, this.h / 2, 241);
      if (d) {
        const m = 0.8 + Math.random() * 0.2;            // :39441
        const [rx, ry] = this.towerRotSpread(4.188790321350098);
        d.x = this.cx + rx * (this.w / 2) * m;
        d.y = this.cy + ry * (this.h / 2) * m;
        d.vx = 0;                                       // :39442
        d.vy = Math.abs(d.vy) * 0.25;                   // :39443
      }
    }
  }

  /** 受击。返回是否死亡。
   *  ★srcProjId（2026-08-31 蓝队三批 A-F1）：弹幕来源弹 id 的可选尾参——仅服务
   *  Player.OnHit 系 proc 的来源排除面（Projectile.TryDoingOnHitEffects :15210-15220
   *  对 case {221,227,614,729,908,977} 硬排除——钛金碎片 908/村正刀气 977 等
   *  "由 on-hit 效果产出的弹"再命中时不再触发任何玩家 OnHit 效果，自续风暴/
   *  刷新 buff 在原版不存在）。非弹幕/未知源保持缺省 0 = 不排除。 */
  hurt(dmg: number, kbx: number, kby: number, game: GameHooks, armorPen = 0, crit = false, pierce = 0, fromPlayer = false, penPercent = 0, srcProjId = 0): boolean {
    // pierce 语义（Projectile.cs:11903-11907/13152-13155 Damage_PVE）：
    //   0   = 近战/荆棘等非弹幕 → 命中设免疫 10t（原版 immune[owner] 默认档）；
    //   1   = 单发弹（maxPenetrate==1，flag3）→ **无视免疫且命中后不设帧**
    //         ——同 tick 多发（霰弹/多随从）全部生效,不再互挡（旧全局 iframes=8
    //         致 8 发四管霰弹只吃 1 发,DPS≈1/8,2026-08-13 修）；
    //   >1  = 穿透弹 → 设 10t;同弹重复命中由弹侧 hitSet 拦（原版 per-owner 槽单人
    //         近似;弹型覆写 1-8 表 :13032 未接,登记）
    //   -2  = IDStatic 单发型（孢子云 567/568：usesIDStaticNPCImmunity=true +
    //         penetrate=1 + appliesImmunityTimeOnSingleHits=false,★拍板#1A
    //         红蓝-J3 2026-09-18）→ 免疫门照走（原版 :12636 immune[owner]==0,
    //         flag3=false）但命中【三不写】（:14031-14038 首支内层条件假:组行/
    //         全局窗/尾档全不可达）=不开全局窗,多云同拍连击同敌本相。
    //         ★清偿刀 R（2026-09-29）第二消费位：634/635 Kill AoE 环（Kill 先置
    //         maxPenetrate=penetrate=-1 → flag3 假门照走;原版写支=显型定档 5t
    //         :14080-14082,由弹侧受理面补写——本档三不写=门位读不被写支污染）。
    //         （−1 已被日曜爆闪 608 反击面占用:penetrate=−1 非-IDStatic → 原版
    //         尾档真=写 10t,Game.ts:39206 依赖该支,勿混用）
    //   -3  = usesLocalNPCImmunity 族（禁戒沙暴柱 656：SetDefaults :7059-7060
    //         usesLocal=true+cd=8;★BJ398 2026-09-29,BJ385 登记独立决策刀）→
    //         免疫门照走（:12636 全局窗门,flag3=false 不豁免）但命中写=
    //         【清全局窗】immune[owner]=0（梯 :14175-14178 usesLocal 主支——
    //         节流全归弹内局部表,局部窗由弹侧 localImmune 表承载）;旧 pierce=0
    //         写 10t → 真敌再命中节拍 10t vs 原版 8t。与 vanillaProjImmuneTiers
    //         .PROJ_IMMUNE_SLOW_MAGIC_TIER(=-3) 无值域交集（后者仅桥层返回域哨兵）。
    // Critter 兼容：critters 桶的调用方按 Critter.hurt(game) 单参调用；
    // 原版小动物是 Enemy 进该桶，这里把 Game 对象重映射回 game 参、伤害取固定 5
    if (typeof dmg === 'object' && dmg !== null) {
      game = dmg as unknown as GameHooks;
      dmg = 5; kbx = 0; kby = 0;
    }
    const rawDmg = dmg; // 傀儡上报用原始值（下方 def 凘认算只做一次，双端一致）
    // ★批⑥修订（蓝队二轮 F2②,2026-08-31）：lastStrikeDealt 语义收紧为「本拍
    // StrikeNPC 结算面」——入口先清零（原版 StrikeNPC 各早退门 :82023-82052 返回 0、
    // num41 是【单次调用】返回值而非持久字段）。旧「只在实际扣血路径写」的空档 =
    // dontTakeDamage/iframes 等无伤路径残留上一拍实扣值,ghostHurst 消费群按
    // lastStrikeDealt ?? dmg 读到陈值虚增预算。凡结算路径见 :12262 与 488 分支写点。
    this.lastStrikeDealt = 0;
    // 死亡单次门(用户报"多弹头武器打出双份僵尸碎块"):pierce=1 豁免免疫帧后,
    // 同 tick 多弹头(霰弹/食人鱼咬+随从)会全部进 hurt——首发致死后,后续弹头
    // 对"已死未出列"的敌怪二次触发死亡管线(碎块/掉落/音效翻倍)。原版由
    // Damage_PVE 的 npc.active 前置门(Projectile.cs:11869)天然防重;此处等价。
    if (this.dead) return false;
    if (pierce !== 1 && this.iframes > 0) return false; // 单发弹豁免免疫检查（flag3）
    // ★BJ308 注勘误:原注「StrikeNPC 早退」失实——dontTakeDamage 门在原版
    //   NPC.hurt()（玩家受击面）;StrikeNPC 全链（:82017→:82063,仅 immortal 一门
    //   :82197）无此门（BJ302 395 自毁支 9999 伤害实证）。本仓 hurt() 合并玩家
    //   面+弹幕结算面两通道,门置函数头=合并通道的等价补偿（原版弹幕面对
    //   dontTakeDamage 的拦截在攻端命中层 Damage_PVE/StrikeNPC 调用者）。
    if (this.dontTakeDamage) return false;
    // ★F1 翻案收口（2026-08-31 蓝队三批）：本函数【不再】内挂旗乘区。原版旗加伤
    // （Player.GetBannerBuffEffect→effect.DamageDealt.Sample）是**攻端调用面**乘区：
    //   · ApplyDamageToNPC 内置段 Player.cs:20599（狱火/矿车冲撞/荆棘反伤/TryHittingNPC 等）；
    //   · ProcessHitAgainstNPC :44658-61（近战挥击链，Game.ts 挥击段已接）；
    //   · Projectile.Damage_PVE :13388-90（全部玩家弹幕结算面）。
    // StrikeNPC 本体（NPC.cs:81958 起）无任何旗逻辑——旧注释"统一入口=StrikeNPC"
    // 为虚构锚：这里内乘一次，与上述攻端面叠成 ×1.5² / 与 ApplyDamageToNPC 面
    // 二连乘；攻端各站的采样现统一走 projTargets.applyBannerDamageDealt 单源。
    // ★F6 钛金屏障 on-hit 迁位（Player.cs:6916-6935）：proc 必须落在免疫窗
    //   （ProcessHitAgainstNPC :44598 immune[whoAmI]==0 早退 / Damage_PVE_Inner
    //   :12641-46 immune[owner] 门）与 dontTakeDamage 判别**之后**——拒收的命中
    //   不 proc、不消费 10t 冷却。此前块排在两个早退门前=被拒命中也吃 cd。
    // ★α-H4（终局扫尾批）：`target.life>5` 残血豁免门保留（Player.OnHit 调用位
    //   原文全在残血门内 :44754/:13642-44），读受击前 life（=入口 this.hp）。
    //   flag 豁免（Player.cs:6917-6921 type==488 || SpawnedFromStatue）照旧并入。
    // ★A-F1 来源排除表（Projectile.TryDoingOnHitEffects :15210-20）：弹 id ∈
    //   {221,227,614,729,908,977} 的命中不触发 OnHit 族（钛金碎片再命中不 proc/
    //   不刷 cd）。srcProjId 由弹侧结算点携带（proj1457.dealContacts /
    //   MuramasaSlashProj 等 on-hit 效果产出弹）。
    {
      const plT = game.player as unknown as {
        dead?: boolean; cx?: number; cy?: number; titaniumStormCd?: number;
        buffs: { apply(t: number, s: number): void };
        equipStats?: { titaniumStorm?: boolean };
      } | null | undefined;
      const titanExempt = this.vanillaId === 488 || this.spawnedFromStatue
        || (srcProjId > 0 && ON_HIT_EXCLUDED_PROJS.has(srcProjId));
      if (fromPlayer && dmg > 0 && !titanExempt && this.hp > 5
        && plT && !plT.dead && plT.equipStats?.titaniumStorm === true) {
        if ((plT.titaniumStormCd ?? 0) <= 0) {
          plT.titaniumStormCd = 10;                      // titaniumStormCooldown=10（:6928）
          plT.buffs.apply(306, 10);                      // AddBuff(306,600t)=10s（:6929）
          // ownedProjectileCounts[908]<7 支（:6931-6934）——计数与上限在 Game 端
          game.spawnTitaniumShard?.(plT.cx ?? 0, plT.cy ?? 0);
        }
      }
    }
    // ---- 神圣套幻影闪避授予（终零波批,2026-09-01）----
    // Player.OnHit 第二支（:6937-6940）：`if (onHitDodge && shadowDodgeTimer==0)
    // AddBuff(59,1800)`——buff59 = ShadowDodge（Hurt 第四闪避支来源,:38516 消费）。
    // 复用 OnHit 调用位残血门族（fromPlayer/dmg>0/hp>5）+ 来源排除表独立适用；
    // 原文此支【不】含 488/statue 特豁（flag 仅钛金分支消费）。
    {
      const plH = game.player as unknown as {
        dead?: boolean; shadowDodgeTimer?: number;
        buffs: { apply(t: number, s: number): void };
        equipStats?: { onHitDodge?: boolean };
      } | null | undefined;
      if (fromPlayer && dmg > 0 && this.hp > 5 && plH && !plH.dead
        && plH.equipStats?.onHitDodge === true
        && (plH.shadowDodgeTimer ?? 0) <= 0                                  // :6938 timer==0 门
        && !(srcProjId > 0 && ON_HIT_EXCLUDED_PROJS.has(srcProjId))) {
        plH.buffs.apply(BuffType.ShadowDodge, 30);                           // AddBuff(59,1800t)=30s
      }
    }
    // ---- 帕拉钯套快速再生授予（终零波批,2026-09-01）----
    // Player.OnHit 第三支（:6942-6945）：`if (onHitRegen) AddBuff(58,300)`——
    // buff58 = RapidHealing（UpdateLifeRegen lifeRegenCount+=4/t,:19385-19387 消费）。
    {
      const plP = game.player as unknown as {
        dead?: boolean;
        buffs: { apply(t: number, s: number): void };
        equipStats?: { onHitRegen?: boolean };
      } | null | undefined;
      if (fromPlayer && dmg > 0 && this.hp > 5 && plP && !plP.dead
        && plP.equipStats?.onHitRegen === true
        && !(srcProjId > 0 && ON_HIT_EXCLUDED_PROJS.has(srcProjId))) {
        plP.buffs.apply(BuffType.RapidHealing, 5);                           // AddBuff(58,300t)=5s
      }
    }
    // ---- 山铜套花瓣弹（终零波批,2026-09-01）----
    // Player.OnHit 第四支（:6963-6985）：`if (onHitPetal && petalTimer==0) { petalTimer=20;
    // NewProjectile(...221,36,kb0); }`——全语义在 Game.spawnOnHitPetals（屏幕边出生/
    // 归一速度），此处仅 OnHit 门族复用。原文此支同样不含 488/statue 特豁。
    // petalTimer 与叶绿引援共享计时字段（petal=20 / 叶绿=50 同一 player.petalTimer）。
    {
      const plO = game.player as unknown as {
        dead?: boolean; petalTimer?: number;
        equipStats?: { onHitPetal?: boolean };
      } | null | undefined;
      if (fromPlayer && dmg > 0 && this.hp > 5 && plO && !plO.dead
        && plO.equipStats?.onHitPetal === true && (plO.petalTimer ?? 0) <= 0    // :6963 双门
        && !(srcProjId > 0 && ON_HIT_EXCLUDED_PROJS.has(srcProjId))) {
        game.spawnOnHitPetals?.(this.cx ?? (this.x + this.w / 2), this.cy ?? (this.y + this.h / 2));
      }
    }
    // ---- 叶绿水晶叶 on-hit 引援叶（台账 L3 清偿批 2026-08-31）----
    // Player.OnHit 尾段（Player.cs:6986-7040,1456 :6615-6640"三修门"本体）。原版
    // OnHit 调用位同在 target.life>5 残血门内（:44754/:13642-44），故复用钛金
    // proc 的 fromPlayer/dmg>0/hp>5 门族；差异面：本支仅查 victim CanBeChasedBy
    // （:6988 flag2——原文不含 488/statue 特豁，假人被 canBeChasedBy 天然拒），
    // 且 OnHit 来源排除表独立适用（TryDoingOnHitEffects :15210-15220 → srcProjId∈
    // ON_HIT_EXCLUDED_PROJS 含 227/221 自续断链）。扫桶+序依赖 break 怪癖全语义在 Game 端。
    {
      const plL = game.player as unknown as {
        dead?: boolean; petalTimer?: number;
        equipStats?: { crystalLeaf?: boolean };
      } | null | undefined;
      if (fromPlayer && dmg > 0 && this.hp > 5 && plL && !plL.dead
        && plL.equipStats?.crystalLeaf === true && (plL.petalTimer ?? 0) <= 0
        && !(srcProjId > 0 && ON_HIT_EXCLUDED_PROJS.has(srcProjId))) {
        game.chloroOnHitLeafStrike?.(this);
      }
    }
    this.justHitT = 2; // 原版 justHit 单帧旗标（AI_023 飞行武器/陆龟受击回态消费）
    // 猪鲨爆裂泡泡（NPC 371）★1458 行为裁定（台账②，2026-08-31 报告单列）：
    //   · 旧档（1456 StrikeNPC cs:82102-82107）：命中【伤害清零】+ 就地转引信态
    //     （ai0=1/ai1=4 + iframes 近似）——已在本次清偿移除；
    //   · 1457/1458：命中照常扣血（本函数通用管线照走——lifeMax=1 时 CombatText/
    //     HitSound 的 lifeMax>1 门天然静音,与原版一致）；每次命中播 legacy 破裂音
    //     （StrikeNPC :85185 PlaySound(4,…,3)=死音库 style3）,致命拍另撒蓝环尘
    //     （:85190-85211,d212×60,视觉面在 dukeBubbleAI 转换点近似承担）；
    //   · 血尽转换移交 dukeBubbleAI 首行（checkDead NPC.cs:78850-78855 → ai0=1/
    //     ai1=4 + PrepareForDeathAnimation），本函数下方 hp<=0 死亡段对其放行。
    if (this.vanillaId === 371) {
      game.playSfxWav?.('NPC_Killed_3', 1, this.cx, this.cy);
    }
    // 原版结算序（Projectile.cs:12796-12808 + Main.cs:65626-65635）：
    //   弹幕侧最终伤 num12 先 += checkArmorPenetration（穿甲加成【加进伤害】，
    //   单池：弹幕/玩家 armorPen（Arrow.settlePen 即此参）+ ichor15 + brokenArmor20
    //   + betsysCurse40 + (int)(def×pct)——NPC.cs:81913-81938，池>def 钳 def/2、
    //   池≤0 或 def≤0 早退 0）→ 再入 StrikeNPC 的 CalculateDamageNPCsTake：
    //   max(1, dmg + pen − def×0.5)。pen/2 上限=def/2 ⇒ 穿甲永不把伤害推过全额
    //   （旧自造"def 钳 2×dmg"删除，下限 1 由本式承担）；负防御 def≤0 不吃穿甲
    //   但 −def×0.5 为增伤（原版直算式,2026-08-13 对齐保留）。
    //   已知偏差登记：crit ×2 原版在防后（StrikeNPC :81990），仓内调用侧预倍——
    //   crit 会连带翻倍 pen/防（Game.ts 挥击侧,并行会话领走未动）
    // ★A5(2026-10-14):GlobalNPC ModifyIncomingHit 移防前(tML HitModifiers 位
    //  —StrikeNPC 头部对原始 Damage 修正后入防御链;DR/伤害帽族按 tML 语义
    //  作用全链)。≥9999 演出通道门保持(R-A-M2)。旧防后位=R-A-M3 登记债清偿。
    if (dmg < 9999) {
      dmg = Math.max(1, Math.trunc(runModNpcIncomingHit(this, dmg)));
    }
    const def = this.def.defense ?? 0;
    const penAdd = npcCheckArmorPenetration(def, armorPen, penPercent, {
      ichor: this.ichorT > 0, brokenArmor: this.brokenArmorT > 0, betsysCurse: this.betsysCurseT > 0,
    });
    // ★F9/η（2026-08-31 蓝队三批）取整链锚修正：原版 StrikeNPC_Inner
    //   `int num = (int)Math.Max(1.0, Main.CalculateDamageNPCsTake(Damage, defense)
    //   × (crit?2:1))`——CalculateDamageNPCsTake 为 double 全程不取整
    //   （Main.cs:67126-33），终值只在 StrikeNPC_Inner 处 `(int)` 向零截断
    //   （NPC.cs:82067）。旧 round() 在奇防非暴击面每击系统性 +1（例 10/7→6.5：
    //   原版 6、旧实现 7），统一换 trunc。
    dmg = Math.trunc(Math.max(1, dmg + penAdd - def * 0.5));
    // takenDamageMultiplier（NPC.StrikeNPC cs:81997-82000）：防御结算后 >1 时 ×N
    // （419 旋刃怪冲刺中 ×3，cs:57172）
    // （takenDamageMultiplier 段 NPC.cs:82070-82072 亦为 (int) 截断非 round）
    if (this.takenDamageMultiplier > 1) dmg = Math.max(1, Math.trunc(dmg * this.takenDamageMultiplier));
    // ---- 伤害飘值 + 受击音：原版 StrikeNPC 内【单点】发射（:82006-82015 CombatText、
    // :82118 起 HitSound）——调用方零重复。曾调用方多点各发 + 假人分支再发 =
    // 一次打击双份飘值+音效双播（2026-08-23 用户报）。
    // 门（★BJ502 2026-10-04 形态统一原版 StrikeNPC_Inner）：:82065
    //   `flag = Damage >= 9999 && owner == 255` → :82081 `if (!flag && lifeMax>1)`
    //   才发射 CombatText+受击音（本仓同形双静音）。旧形 `(takenDamageMultiplier>1 ||
    //   rawDmg!==9999)` 两处偏离：①精确匹配!==9999——四塔死亡演出收刀 hurt(1e9)
    //   （towerAI ai1>=180;原版本位=life=0 直落 :39456-39460,无 StrikeNPC 无飘字）
    //   防后 1e9−20×0.5=999999990 击穿门 → 星云柱收刀冒 999999990 大字（用户实报
    //   "9999990"）,系 BJ476 蠕虫 10059 同族第二发=精确匹配门窄化的系统性暴露;
    //   ②takenDamageMultiplier>1 恒飘支系自造（原版门无此支,乘区只作用 num 值）。
    //   owner==255 本仓承载=合成击杀位（!fromPlayer 且非远端访客——远端访客 hurt 前
    //   被 netApplyStrike 置 pendingStrikeOwner,原版 fromNet 路径 owner=-1→myPlayer
    //   门开照飘 Others 灰）。:81998-82000 旧行号锚已漂移（该区间实为
    //   checkArmorPenetration 尾/KeyBrandStrike 头）。
    // 色（CombatText.cs:8-16 全表）：★附带④ 单源收口 fx/CombatTextColors.ts——
    // friendly/hostile 分档 + 远端访客 ×0.4 灰；旧 '#665A14' 系误值亲核勘正
    // （OthersDamagedHostileCrit=(255,100,30)×0.4=#66280C）。
    // 位置=受击 NPC 锚点（原版 position 矩阵）；数值=防后终值（原版 num 同）。
    {
      const remoteOwner = consumePendingStrikeOwner();
      // ★BJ502：门条件=原版 flag 取反（rawDmg>=9999 且合成 owner255 位 → 静默）
      if (!(rawDmg >= 9999 && !fromPlayer && remoteOwner === null) && this.maxHp > 1) {
        const friendly = this.def.friendly ?? false;
        const col = enemyHurtFloatColor({
          friendly,
          crit,
          fromRemoteVisitor: remoteOwner !== null && remoteOwner >= 0,
        });
        playEnemyHitSound(game, this);
        game.addDamageNumber(this.cx, this.y, dmg, crit, col);
      }
      if (remoteOwner !== null) setPendingStrikeOwner(remoteOwner);
    }
    // M3 Boss 伤害统计（NPC.StrikeNPC :82129-82130 → NPCDamageTracker.AddDamage：
    // min(dmg, life) 溢杀不膨胀;owner -1=本地/255=世界,远端访客由 pendingStrikeOwner
    // （netApplyStrike 置 msg42 fromSlot）覆写。须在扣血前取 life——原版同位）
    if (bossDamageSink.add) {
      bossDamageSink.add(this, consumePendingStrikeOwner() ?? (fromPlayer ? -1 : 255), dmg);
    }
    // 训练假人（NPC 488，cs:83498 localAI 赋值）：immortal=true 永不死——原版
    // 走完整 StrikeNPC 管线（防御结算/飘值/受击音全跑），仅 life 不减与击退跳过
    // （kbResist=0 零击退,等效）。
    // 曾早退在管线前 = 无飘值无音；又曾在分支内自发反馈 = 与调用方双份
    // （2026-08-23 用户报"一下双飘值"）。现对齐：全管线跑完在此只记摇晃+免扣血。
    if (this.vanillaId === 488) {
      this.dummyShake = Math.max(20, Math.min(120, dmg));
      this.dummyHitDir = Math.sign(kbx);   // cs:83506 localAI[1]=hitDirection 无条件写入（0=未定向）
      // 免疫帧与通用档一致（:13152 对全 NPC 含假人 10t；旧 8 偏差）;−2=IDStatic
      // 单发型不写（云命中三不写,拍板#1A——假人上多云同拍连击=原版本相）;
      // ★BJ340 F-A（2026-09-25）:1=flag3 单发弹同样不写——命中写分支表
      // （:14032-14196）对 488 同样适用,:14176-14182 尾档 `penetrate != 1` 不达
      // =原版单发弹打假人【不改】共享窗余值（旧支写 10=无中生有新窗）
      // ★BJ398:-3=usesLocal 族清零档（梯 :14175-14178 写 immune[owner]=0,假人同梯）
      if (pierce === -3) this.iframes = 0;
      else if (pierce !== -2 && pierce !== 1) this.iframes = 10;
      this.hpBarT = 240;
      // ★蓝队二轮 F2①（2026-08-31）：immortal 只跳过 `life -= num` 扣血段
      // （StrikeNPC_Inner :82197-82215 的 if (!immortal) 支），num41 在 :82067 防后
      // 结算、:82400 `return num` 恒 ≥1 与 immortal 无关——lastStrikeDealt 必须
      // 写足额，否则幽灵套 ghostHurt 的 `dealt<=1 早退` 门让假人永不 proc。
      this.lastStrikeDealt = dmg;
      // 玩家侧公共受击尾段（本分支早退须自带,否则永久跳过——原版 ApplyDamageToNPC
      // 对假人同样置位）：①DPS 计累计（Player.cs:20165-20168 accDreamCatcher 门禁
      // 在 addDPS 内侧）——曾漏=DPS 计量器对假人恒"无 DPS"（2026-09-02 用户实报）;
      // ②AnyInteractions 玩家交互位（雕像门 :79651 同源）+ MP 交互登记。
      if (fromPlayer) {
        const pl = game.player as Player | null;
        pl?.addDPS(dmg);
        this.playerInteracted = true;
        // ★SW-BJ47 计数器"最近击杀"命中写位（假人分支——原版 ApplyDamageToNPC 对
        // 488 同样走全管线写 lastCreatureHit;NPCtoBanner(488)=0 → 行灰"杀敌数不可用"）
        if (pl) pl.lastCreatureHit = bannerOfNpc(this.vanillaNetId !== 0 ? this.vanillaNetId : (this.vanillaId ?? 0));
        const net = (game as unknown as { net?: { active: boolean; mySlot: number } }).net;
        if (net?.active) this.applyNetInteraction(net.mySlot, game);
      }
      // ★D20-m1(2026-10-13):假人受理伤派发(onHitByAny/onHitAny killed=false;
      //  incomingHit 已在本分支前 :15026 过链=DR 族不重派)
      this.dispatchAcceptedHit(game, fromPlayer, dmg, crit, pierce, srcProjId);   // ★A4(2026-10-14):防后值(tML damageDone;旧=rawDmg 防前)
      return true;
    }
    // realLife 共享生命（StrikeNPC :82132-82137）：伤害扣主段,本段 hp/maxHp 镜像
    // ——毁灭者族打任意节都扣头 80000 总血,节不可单独打死
    if (this.realLifeHost && !this.realLifeHost.dead) {
      this.realLifeHost.hp -= dmg;
      this.hp = this.realLifeHost.hp;
      this.maxHp = this.realLifeHost.maxHp;
    } else {
      this.hp -= dmg;
    }
    // ★批⑥(2026-08-31)：lastStrikeDealt = StrikeNPC 返回值 num41 等价（防后实扣,
    // 命中调用方读走做 on-hit 联动门——Projectile.ghostHurt 的 `dmg<=1 早退` 消费）。
    // 实扣路径写终值;无伤早退分支依赖 hurt() 头部的入口清零=等价返回 0。
    // （2026-08-31 蓝队二轮 F2 修订：旧「只在实际扣血路径写、早退不触碰」的空档 =
    //  dontTakeDamage/iframes 等无伤分支残留上一拍实扣值,ghostHurst 消费群
    //  `lastStrikeDealt ?? dmg` 读到陈值虚增预算——现入口清零 + 本写点 + 488 分支
    //  写足额三件套收口,消费点兜底已撤（??dmg → ??0）。）
    this.lastStrikeDealt = dmg;
    // ★BJ254（2026-09-21）受击尘单源化：vanilla-npcdust.json 查表（tools/extract-npcdust.mjs
    // 从 HitEffect :82492-:90939 机械提取,首批 78 门组/299 型）。原鸟族 61/252/301、
    // 猪鲨族 370/372/373、岩浆族 59/60/151 精确块转查表（值不变=金标保形,R1-F2/FX45/
    // BJ243 锚行随表迁移）。hd = hitDirection 蒸馏（kbx 符号,0 兜 1,同旧手块约定）。
    // ★hp>0 门=原版 HitEffect 相位门：击杀拍 life<=0 只走死亡支（下方死亡管线),
    // 受击支不重入——两相互斥,缺门曾致致死拍 hitK 簇+死亡簇双发（BJ243 ⑤/FX45 ③ 实红）。
    if (this.hp > 0) spawnNpcHitDust(this, game, Math.sign(kbx) || 1, dmg);
    // WoF 家族受击尘（HitEffect life>0 段）：血肉墙 113/114 = 20 簇 5 号血尘、
    // 115/116 = 5 簇（1457 :88353-88355/:88405-88408）。★本族死亡面有 netMode 权威
    // 门+StrikeNPC 扇出派发（1457:82313-82328 / 1456:82240-82255）与 gore 跳过纠缠,首批不入尘表——手块保留,
    // 待后续批次 gates 支持后转表（extract-npcdust _meta.pending 有登记）。
    const wofVid = this.vanillaId;
    if ((wofVid === 113 || wofVid === 114 || wofVid === 115 || wofVid === 116) && this.hp > 0) {
      const hdWof = Math.sign(kbx) || 1;
      const nWof = wofVid === 113 || wofVid === 114 ? 20 : 5;
      for (let k = 0; k < nWof; k++) game.dust?.spawn(this.x, this.y, this.w, this.h, 5, hdWof, -1);
    }
    // 岩浆族受击尘已转查表（BJ254,见上方 spawnNpcHitDust——86539-86551 支）。
    // 59 熔岩史莱姆每拍环境尘另有独立面（AI_001 :62072,slimeAI 内）——两块互不替代。
    // lavaVid 保留：下方死亡管线的 BJ246 泼岩浆 carve-out 消费。
    const lavaVid = this.vanillaId;
    // DPS 计累计(Projectile.cs:12817-12818/Player.cs:20165-20168 两调用点均
    // accDreamCatcher 门禁+fromPlayer 标记;全仓伤害漏斗单点收口)
    if (fromPlayer) {
      const pl = game.player as Player | null;
      pl?.addDPS(dmg);
      this.playerInteracted = true;  // AnyInteractions（playerInteraction 位）——雕像门 :79651
      // ★SW-BJ47 计数器"最近击杀"命中写位（1:1 命中即写,非击杀写）：原版三写位
      //  Player.cs:20609-20619（ApplyDamageToNPC）/:44769-44775（ItemCheck 近战命中）/
      //  Projectile.cs:13382-13389（ownedBySomeone 弹）——并集 = 仓内 hurt(fromPlayer)
      //  单漏斗（近战/玩家弹/召唤物全经此）。值域 = 旗种 banner id（Player.cs:2575,
      //  写 `BannerSystem.NPCtoBanner(BannerID())`,未映射 = 0 → 行灰"杀敌数不可用"
      //  Main.cs:47845-47853）;非击杀路径（岩浆/陷阱/石化 624）不写 = 原版本相。
      //  免疫帧/无伤早退在 hurt() 头部 = 原版免疫门先行等价（须实扣命中才写）。
      //  MP 远端访客弹（remoteOwner,fromPlayer=false）不写 = 原版 ownedBySomeone
      //  写 Main.player[myPlayer] 的 host 聚合面登记未建模（与旗杀 MP credit 同族债）。
      if (pl) pl.lastCreatureHit = bannerOfNpc(this.vanillaNetId !== 0 ? this.vanillaNetId : (this.vanillaId ?? 0));
      // MP：本地玩家交互登记（ApplyInteraction 等价——per-client 掉落发放门;
      //  单人无 net 净空,interactionSlots 恒空不参与结算）
      const net = (game as unknown as { net?: { active: boolean; mySlot: number } }).net;
      if (net?.active) this.applyNetInteraction(net.mySlot, game);
    }
    // 毁灭者身段受击出探针（HitEffect :90265-90281：135 身段存活受击时,ai[2]==0
    // （本段未出过探针）掷 1/25（Mechdusa 合体态 1/50）→ 置 ai[2]=1 并于段底中心
    // 生成探针 139——每身段至多一只。★底锚换算：原版 NewNPC(X,Y) 为 Bottom 锚
    // （NewNPC 体 :81594 nPC.Bottom=(X,Y)）→ 探针底=节底;本仓 fromVanilla 中心锚 → Y 补
    // +h/2（★139.h=30→15,RB15c 勘误见下方生成点——本行旧「h=20→-10」前提已废,勿据
    // 此回改;结构锁=tests/mech-gaps.test.ts ①）。ai[2]=1 由 FindFrame case 135
    // （:74229 灭帧）与 destroyerSegmentLight 灯熄门消费——帧分支见 Renderer
    // vanillaFrameIdx（2026-09-03 接上:此前帧选择未跟随 ai2=亮灭闪根因）。
    if (this.vanillaId === 135 && this.hp > 0 && this.ai2 === 0) {
      const max = mechQueenUp() ? 50 : 25;
      if (Math.floor(Math.random() * max) === 0) {
        this.ai2 = 1;
        // ★RB15c 勘误(2026-09-13)：-10 系旧注"h=20"错误前提——原版 SetDefaults(139)
        //   (NPC.cs:10748-10751)=30×30；原版生成=NewNPC(Bottom 锚 :90342)传【中心】坐标
        //   → 探针中心=节底−探针半高=−15（fromVanilla y=中心语义,Enemy.ts:1429）。
        //   旧 -10 曾使探针低 5px
        const probe = Enemy.fromVanilla(139, this.cx, this.y + this.h - 15);
        if (probe) addEnemy(game, probe);
      }
    }
    // 通用档 10t（:13152 默认;旧恒 8）;−2=IDStatic 单发型（云 567/568,:14032-14039
    // 组行内层假=命中三不写,拍板#1A）。★BJ340 F-A（2026-09-25）:1=flag3 单发弹
    //（maxPenetrate==1,如 405 泡泡）命中【三不写】——写分支表三档全不达：
    // 组行 :14032-14039（内层 `penetrate != 1` 假）/ 局部行 :14172-14175（flag3 要求
    // !usesLocalNPCImmunity,不进）/ 尾档 :14176-14182（`penetrate != 1 ||` 假）——
    // immune[owner]（=本仓 iframes 共享窗）余值原样保持。旧 `pierce===1?0:10` 写 0
    // =把 404/悠悠球已建的剩余窗【擦除】（405 命中解锁共享窗=多打），与假人支写 10
    // 同为原版无的两向偏差。免疫门（:13956 `pierce !== 1` 臂）保证非单发弹进此路径
    // 时 iframes==0 → 写 10 等价原版缺省档
    // ★BJ398:-3=usesLocal 族清零档（梯 :14175-14178 usesLocal 主支写 immune[owner]=0
    // ——节流全归弹内局部表;全局 10t 不开,后到他弹照达=原版单表跨弹语义）
    if (pierce === -3) this.iframes = 0;
    else if (pierce !== -2 && pierce !== 1) this.iframes = 10;
    this.hpBarT = 240; // 受击后血条持续显示 4 秒
    // 击退管线（NPC.cs:82144-82239 1:1）。武器路径（kby===0，kbx=方向×力度）：
    //   num3 = kb×resist（:82145 ★resist 先乘、五段软封顶作用在乘后值——旧实现
    //   封顶算在裸 kb 上再乘 resist，顺序反）→ onFire2（诅咒焰 buff39，cursedT 代）
    //   ×1.1（:82148）→ 五段封顶 8/10/12/14/16（:82152-82175）→ crit×1.4（:82181）
    //   → num8 = (int)防后最终伤 ×10（专家 ×15，:82183-82187）
    //   num8>lifeMax = 轻路（大伤害打小怪，:82188-82226）：X 减法收敛（同向不足
    //   才推、同号余速 ×2 步、钳 ±num3，:82189-82206）→ 小丑 185 num3×1.5
    //   （:82209-82212，★仅轻路——旧实现放在共享段）→ num3 翻负（noGravity
    //   ×-0.5 / 有重力 ×-0.75，:82217）→ Y 加法钳（vy>num3 才 += 并钳下限，
    //   :82220-82225——下落/静止中挨打才起跳，上升中不追加）
    //   否则重路（:82227-82237）：直接赋值 vy=-num3×(0.75|0.5)×resist、
    //   vx=num3×dir×resist（★resist 二次乘=原版如此,num3 已含一次）
    // kby!==0 = 爆炸/光环等非武器冲量 → 加法冲量（原版同走 StrikeNPC 管线，
    //   仓内双参冲量约定，登记）
    const resist = this.kbResistOverride ?? this.def.knockbackResist;
    // :82217/:82228 读【运行时】noGravity（AI_017 秃鹫飞行态/AI_087 空中态/AI_091
    // 浮游态按态置位）——def.flying 仅静态兜底（数据 noGravity + aiStyle 2/5/14/23/44）
    const kbFlying = this.noGravity || this.def.flying;
    // ★F10（2026-08-31 蓝队三批）：原版击退整段单门 `knockBack>0f && knockBackResist>0f`
    // （NPC.cs:82144）——标量 knockBack 与两分支共享。仓内双参冲量约定（kby≠0=爆炸/
    // 环形冲量）在此以「向量非零」等价承载 knockBack>0：两分支现都要求 [冲量非零 ∧
    // resist>0]，与武器支 :12366 同式；送参侧零冲量调用点同步归零（扑击弹 818 案，
    // 见 MinionProj TigerPounce F10 注）。
    if (kby !== 0) {
      if (resist > 0) { this.vx += kbx * resist; this.vy += kby * resist; }
    } else if (Math.abs(kbx) > 0 && resist > 0) {   // :82144 knockBack>0 && resist>0 双门
      const hitDir = Math.sign(kbx) || 1;
      let num3 = Math.abs(kbx) * resist;            // :82145 kb×resist
      if (this.cursedT > 0) num3 *= 1.1;            // :82148 onFire2=诅咒焰（buff 39）
      if (num3 > 8) num3 = 8 + (num3 - 8) * 0.9;    // :82152-82156 五段软封顶
      if (num3 > 10) num3 = 10 + (num3 - 10) * 0.8; // :82157-82161
      if (num3 > 12) num3 = 12 + (num3 - 12) * 0.7; // :82162-82166
      if (num3 > 14) num3 = 14 + (num3 - 14) * 0.6; // :82167-82171
      if (num3 > 16) num3 = 16;                     // :82172-82175
      if (crit) num3 *= 1.4;                        // :82179-82182
      const num8 = Math.trunc(dmg) * (mainExpertMode(game.world) ? 15 : 10); // :82183-82187
      if (num8 > this.maxHp) {                      // 轻路 :82188
        if (hitDir < 0 && this.vx > -num3) {        // :82189-82197 X 减法收敛
          if (this.vx > 0) this.vx -= num3;
          this.vx -= num3;
          if (this.vx < -num3) this.vx = -num3;
        } else if (hitDir > 0 && this.vx < num3) {  // :82198-82206
          if (this.vx < 0) this.vx += num3;
          this.vx += num3;
          if (this.vx > num3) this.vx = num3;
        }
        if (this.vanillaId === 185) num3 *= 1.5;    // :82209-82212 小丑特例
        num3 = kbFlying ? num3 * -0.5 : num3 * -0.75; // :82217 noGravity 运行时档
        if (this.vy > num3) {                       // :82220-82225 Y 加法钳
          this.vy += num3;
          if (this.vy < num3) this.vy = num3;
        }
      } else {                                      // 重路 :82227-82237
        this.vy = -num3 * (kbFlying ? 0.5 : 0.75) * resist; // :82228-82233
        this.vx = num3 * hitDir * resist;           // :82235 resist 二次乘
      }
    }
    // 法师族受击打断（StrikeNPC cs:82061-82088：aiStyle 8 受击即跳 ai[0]——已过全部
    // 蓄力点(100/200/300)、650 传送前不再发射 = "攻击中挨一下就取消本轮齐射"）：
    // 172→450 / 283·284 掷 1/2→390 / 533 掷 2/3→181 / 其余（24/29/32/45/281-286）→400
    // （693 的 localAI[1]/[2] 受击段 :82083-82087 未接，登记）
    if (this.vanilla?.aiStyle === 8) {
      if (this.vanillaId === 172) this.ai0 = 450;
      else if (this.vanillaId === 283 || this.vanillaId === 284) {
        if (Math.random() < 0.5) this.ai0 = 390;
      } else if (this.vanillaId === 533) {
        if (Math.random() < 2 / 3) this.ai0 = 181;
      } else this.ai0 = 400;
    }
    // 联机傀儡受击：上报房主权威结算（本地视觉反馈已生效：扣血/飘字/击退）
    if (this.netPuppet) entityNet.reportStrike?.(this.netId, rawDmg, kbx, kby);
    // 行为录制：受击（防后结算值 + 剩余 hp；受击本身低频——无敌帧天然节流）
    game.recLog?.('hurt', { id: this.id, vid: this.vanillaId ?? null, dmg, hp: this.hp });
    if (this.hp <= 0) {
      // ★FX44b（2026-09-16 用户实报飞龙不掉飞翔之魂 F5 日志定谳）：realLife 共享池
      // 死亡归属门——原版 checkDead 首行（NPC.cs:78846）`realLife>=0 && realLife!=whoAmI
      // → return`（段自身【永不】进死亡管线），StrikeNPC 尾（:82392-82398）
      // `if (realLife>=0) Main.npc[realLife].checkDead(); else checkDead();`——共享池
      // （87 飞龙 :51703/:51727 段 realLife=头、454 幻影龙、621 血鳗、134 毁灭者族）
      // 生命池全在头，池空时死亡【唯一归属头】= 头的 checkDead→NPCLoot（飞翔之魂
      // 575 @100%/风筝/钱币全挂头）。曾缺门：末击落在段 hitbox 时段先走死亡分支→
      // 级联 `.dead=true` 静默杀头（头 hurt 死亡分支被整体绕过）=整链死而零掉落
      // （F5 日志 t=8378：仅段 979/vid88 一条 death+段位钱币，头 961 无死亡无 575）。
      // 修复=段 hp≤0 且头仍活 → 头走标准死亡管线（die() 清 iframes 后 hurt 全管线，
      // 掉落/事件/级联清链全在头）；段自身不做任何死亡结算（vanilla 同款早退）。
      // ★RB30b-F1（2026-09-16 P0 停机定谳）：自指豁免——原版首行
      // `realLife>=0 && realLife!=whoAmI`（NPC.cs:78846）第二支=whoAmI 比对，头自身
      // realLife=whoAmI（建链块 :51859-51861 `ai[3]=whoAmI; realLife=whoAmI`，毁灭者
      // :50208 同式）→ checkDead 对头【不】早退。曾缺此支：头 realLifeHost===this 时
      // 门判"头活着"→ head.die→hurt→本门→die 无限递归 → RangeError → rAF 熔断整机
      // 停机（末击落在毁灭者/千足蜈蚣/Mechdusa 头 hitbox 时复现×4）。
      if (this.realLifeHost && this.realLifeHost !== this && !this.realLifeHost.dead) {
        // ★R-B-F2(2026-10-13):转移死的头部不打受击拍——tML 语义=OnHit 只对【被击段】
        //  一拍(头 checkDead 只走死亡管线,无伤害管线);旧 die→hurt(9999) 全管线在头
        //  上派发 killed=true 幻影拍(damage=9999+实体错位)。静默旗只压 onHitAny/
        //  onHitByAny,击杀双钩照发(头=真死者)。
        (this.realLifeHost as { __swModSilentHit?: boolean }).__swModSilentHit = true;
        this.realLifeHost.die(game);
        (this.realLifeHost as { __swModSilentHit?: boolean }).__swModSilentHit = false;
        this.dispatchAcceptedHit(game, fromPlayer, dmg, crit, pierce, srcProjId);   // ★A4(2026-10-14):防后值(tML damageDone;旧=rawDmg 防前)   // ★D20-M1
        return false;
      }
      // 月总族(396/397/398)血尽不直死:原版 checkDead(:78864-78883)转为闭眼残肢/死亡演出,
      // 转换逻辑在各自 AI 首行(hp<=0 → ai0 置态+满血续命),此处放行让 AI 下一 tick 接管
      // 月总族:血尽转 -2/-3/演出在各 AI 首行,放行。★398 死亡演出态(ai0==2)
      // 豁免——演出 600t 满时 AI 调 die() 走标准死亡管线(掉落/旗标),若仍放行
      // = 零掉落(boss 袋/夜明矿/武器池全不出,2026-08-19 终审修)
      // ★清偿刀 Y（2026-09-29,X4-债14）：补 PrepareForDeathAnimation 真旗
      //   （:78870/:78881 → :78838 dontTakeDamage=true）。原版在致死 StrikeNPC 内
      //   同步写旗（StrikeNPC_Inner :82393-82398 尾调 checkDead,无 AI tick 延迟）,
      //   转换窗（致死拍→下个 AI tick）内全通道拒收：弹幕 Damage_PVE 两门
      //   （Projectile.cs:12598/:12686）、近战（Player.cs:20542 等）、NPC 互伤
      //   （:93557）。旧档只放行不写旗=窗内清零档写入方（567/568/251 idStatic、
      //   656/856 usesLocal,命中写 iframes=0）下同拍补刀可再结算（飘字/proc/入账/
      //   iframes 覆写）。ai0===-2/-3 态不可达（首转换已写旗+满血,checkDead 于
      //   life>0 早退）——此处无条件写=幂等。
      if (this.vanillaId === 396 || this.vanillaId === 397
        || (this.vanillaId === 398 && this.ai0 !== 2)) {
        this.dontTakeDamage = true;
        this.dispatchAcceptedHit(game, fromPlayer, dmg, crit, pierce, srcProjId);   // ★A4(2026-10-14):防后值(tML damageDone;旧=rawDmg 防前)   // ★D20-M1
        return false;
      }
      // 猪鲨爆裂泡泡（NPC 371）：血尽不直死——checkDead（NPC.cs:78850-78855）
      // 转 ai[0]=1/ai[1]=4 引信态 + PrepareForDeathAnimation（life=lifeMax/
      // dontTakeDamage=true），转换逻辑在 dukeBubbleAI 首行接管（★1458 行为裁定,
      // 台账②——旧 1456 零伤早退档已退役,见上方 hurt 头部注释）。
      // 爆裂态（ai0==1）内再次血尽（理论不可达,dontTakeDamage 拒后续弹）直接放行死亡。
      // ★清偿刀 Y（X4-债14）：写旗提前到致死拍（原版 :78854 直调,无 ai 守卫）——
      //   引信态转出前（AI 首 tick 前）同拍补刀（清零档清窗）照拒;引信态本身由
      //   dukeBubbleAI :1363 每 tick 重写旗维持（台账①面）。
      if (this.vanillaId === 371 && this.ai0 !== 1) {
        this.dontTakeDamage = true;
        this.dispatchAcceptedHit(game, fromPlayer, dmg, crit, pierce, srcProjId);   // ★A4(2026-10-14):防后值(tML damageDone;旧=rawDmg 防前)   // ★D20-M1
        return false;
      }
      // 石巨人族:仅挂载头 246 放行且须【本体活】(血尽转自由态在 golemHeadAI
      // 首行——一阶段本体无敌,玩家先打头的场景本体必活;本体死后原版头是
      // StrikeNPCNoInteraction 标准死 :31287-31290,落回通用管线)。
      // 本体 245 = 标准死亡(部件随终战消亡=各 AI 锚主检测后自杀,boss#19 定案,
      // 原 DoDeathEvents :80146-80148——原版部件也是下一 tick 自杀,时序同构);
      // 拳 247/248 = 普通死亡(原版无转换)。★曾全族放行→转换只在 AI 首行而拳/
      // 本体无处理 = 负血条不死(用户报 2026-08-19,放行在 dead=true 之前,hurt
      // 不会置 dead——"AI 首行接管"的契约对本/拳不成立)
      // ★清偿刀 Y（X4-债14）：原版 checkDead 无 246 支——挂载头致死拍=HitEffect
      //   召 249（:85913-85920）+ 标准死 active=false,后续命中被 active 门天然拒。
      //   本仓转换在 golemHeadAI 首行（boss#19 定案,golemHeadGoFree=召 249+原位
      //   dead 让位）,窗内以真旗闭合同拍补刀;下 tick AI 双向归位（自由态 true/
      //   挂载态 false 各自每拍重写）。本体死分支走标准死管线不受此旗影响
      //   （golemHeadAI 强杀面先清旗再 die,:31287-31290 等价）。
      if (this.vanillaId === 246
        && (game.enemies() as Enemy[]).some((n) => !n.dead && n.vanillaId === 245)) {
        this.dontTakeDamage = true;
        this.dispatchAcceptedHit(game, fromPlayer, dmg, crit, pierce, srcProjId);   // ★A4(2026-10-14):防后值(tML damageDone;旧=rawDmg 防前)   // ★D20-M1
        return false;
      }
      // 星璇四塔(517/422/507/493)：checkDead（NPC.cs:78884-78889）血尽转 ai2=1 死亡演出
      // （ai1=0、满血续命 + dontTakeDamage），180t 上升渐隐后由 towerAI 走标准死亡管线（掉碎片）
      if (this.vanillaId != null && this.vanillaId in TOWER_KEY && this.ai2 !== 1) {
        this.ai2 = 1; this.ai1 = 0; this.hp = this.maxHp; this.iframes = 2;
        // ★清偿刀 Y（X4-债14）：补真旗（:78888 → :78838）。旧档只写 iframes=2,
        //   flag3 单发弹（pierce===1 豁免免疫门 :13990）转换同帧至下个 AI tick 间
        //   绕门再结算（2t 窄缝）;真旗=全通道闸,演出期由 towerAI 每 tick 重写
        //   （R23b-P1 形态）,本行=原版 checkDead 位（AI tick 前的窗闭合）。
        this.dontTakeDamage = true;
        this.dispatchAcceptedHit(game, fromPlayer, dmg, crit, pierce, srcProjId);   // ★A4(2026-10-14):防后值(tML damageDone;旧=rawDmg 防前)   // ★D20-M1
        return false;
      }
      // 永恒水晶 548（NPC.cs:78891-78898）：血尽转败北演出——ai1=1/ai0=0/满血/
      // dontTakeDamageFromHostiles=true（仅敌意来源免伤,非全免旗）;【不】调
      // PrepareForDeathAnimation（无死亡动画/无掉落/无死亡音,return 存活）。
      // 演出 600t 由 eterniaCrystalAI ai1==1 支接管（bossAI_dd2:起跑帧 ReportLoss+
      // 效果弹 672、96t 上浮→渐隐、末帧 StopInvasion+life=0+checkDead——彼时
      // ai[1]==1 守卫使本支跳过,且 StopInvasion 的 WipeEntities 已把水晶清场
      // （Game.dd2WipeEntities en.dead=true≡原版 active=false）,死亡管线双兜底）。
      // ★BJ450:此前全仓无 548 ai1=1 setter=败北演出支死码,水晶血尽走标准死。
      // :78897 netUpdate=true 为联机同步位,本仓 netPuppet 域无此位（四塔支同款略）。
      if (this.vanillaId === 548 && this.ai1 !== 1) {
        this.ai1 = 1;
        this.ai0 = 0;
        this.hp = this.maxHp;
        this.dontTakeDamageFromHostiles = true;
        this.dispatchAcceptedHit(game, fromPlayer, dmg, crit, pierce, srcProjId);   // ★A4(2026-10-14):防后值(tML damageDone;旧=rawDmg 防前)   // ★D20-M1
        return false;
      }
      this.dead = true;
      // ★SW-FX7（2026-09-10）：死亡面 noSpawnCycle 置位（NPC.checkDead 尾
      //  NPC.cs:78941 无条件 `noSpawnCycle = true`——与消散面 :78797 对偶；下一
      //  刷怪周期整体跳过,NPC.SpawnNPC :80991-80995）。消散面已由 runDespawnFx
      //  承接（:2787），死亡面此前整缺=战斗高频击杀帧仍照常刷生。SW 下帧消耗/
      //  清零（Game.trySpawnEnemy 头）。登记残差：城镇 NPC 死亡管线未接本旗
      //  （checkDead 全型共用,本仓 TownNPC 走独立类）;微光 GetShimmered
      //  两置位（:92673/:92690）未接。
      game.noSpawnCycleThisFrame = true;
      game.recLog?.('death', { id: this.id, vid: this.vanillaId ?? null });   // 行为录制：敌怪死亡
      // 瓢虫被杀 → 坏运（NPC.checkDead cs:78838-78840 → LadyBugKilled :82332）：
      // 604 普通 / 605 金瓢虫（距离衰减公式见 LuckState.ladyBugKilled）；
      // 副产物 ladyBugRainBoost +1800 钳 18000（cs:82334-82338，雨调度提前开雨）
      if (this.vanillaId === 604 || this.vanillaId === 605) {
        const pl = (game as unknown as { player?: Player }).player;
        if (pl && !pl.dead) {
          pl.luckState?.ladyBugKilled(Math.hypot(this.cx - pl.cx, this.cy - pl.cy), this.vanillaId === 605);
        }
        const w = game.world.weather;
        w.ladyBugRainBoost = Math.min(18000, w.ladyBugRainBoost + 1800);
      }
      // 风气球 594 爆裂：解冻挂载史莱姆（原版 HitEffect :82586-82594 slave ai[0]=0 + 上移 10）
      if (this.vanillaId === 594) {
        const slave = (game.enemies() as Enemy[]).find((n) => n.id === this.ai3 && n.ai0 === -999);
        if (slave) { slave.ai0 = 0; slave.y -= 10; }
      }
      // 饥饿者 115 死亡 → 饿魂 116（1457 :88413 HitEffect：type==115 且 life<=0 →
      // NewNPC((int)(position.X+width/2),(int)(position.Y+height), 116)——aiStyle 2
      // 飘浮眼独立追击，80hp/防6，不锚定墙）。联机傀儡跳过（分裂权威在房主，同母史莱姆门）
      if (this.vanillaId === 115 && !this.netPuppet) {
        const h2 = Enemy.fromVanilla(116, this.cx, this.y + this.h);
        if (h2) {
          // ★Bottom 锚（:88413 → nPC.Bottom=(cx, 父底)）:顶 = 父底−h——旧 y 半盒低 h/2
          h2.x = this.cx - h2.w / 2;
          h2.y = this.y + this.h - h2.h;
          (game as unknown as { entities?: { add?: (en: unknown, b: string) => void } })
            .entities?.add?.(h2, 'enemies');
        }
      }
      // 史莱姆王死亡爆小史莱姆（HitEffect :86573-86607：4-7 只 NPC 1 体内随机
      // 落点+随机初速——曾缺=死王不爆怪,2026-08-19 终审补;傀儡跳过同上）。
      // 1457 :86674-86676 补 ai[0]=-1000×Next(3)（首跳长延迟）+ ai[1]=-1（显式空
      // 体内——0 会让 slimeRollContainedItem 触发吞物掷,C-18）
      if (this.vanillaId === 50 && !this.netPuppet) {
        const add = (game as unknown as { entities?: { add: (en: unknown, b: string) => void; nextId?: number } }).entities;
        const n = 4 + Math.floor(Math.random() * 4);   // Next(4)+4 = 4-7（1457 :86666）
        for (let k = 0; k < n; k++) {
          // ★Bottom 锚勘误（1457 :86668-86669）：落点 = 体内 inset32 整数随机点
          // (x+Next(w−32), y+Next(h−32)) 作【底中】锚 → 顶 = 点−h；旧 (rand×w, rand×h)
          // 中心锚 = 半盒低 h/2 且无 inset。初速 Next(−15,16)×0.1 / Next(−30,1)×0.1
          // （:86671-86672，旧 (rand−0.5)×6 / −3−rand×3 自造域）
          const px = this.x + Math.floor(Math.random() * (this.w - 32));
          const py = this.y + Math.floor(Math.random() * (this.h - 32));
          const b = Enemy.fromVanilla(1, px, py);
          if (!b) continue;
          b.x = px - b.w / 2;
          b.y = py - b.h;
          b.vx = (Math.floor(Math.random() * 31) - 15) * 0.1;
          b.vy = (Math.floor(Math.random() * 31) - 30) * 0.1;
          b.ai0 = -1000 * Math.floor(Math.random() * 3);   // :86675
          b.ai1 = -1;                                      // :86676（1457:0→-1）
          add?.add(b, 'enemies');
        }
      }
      // 母史莱姆死亡分裂（1457 :85716-85735 HitEffect：type==16 → Next(2)+2 = 2-3 只，
      // ★旧"Wiki 权威 1-3"与代码不符；netID -5 = 半透明灰黑小史莱姆（base 1 × scale 0.9
      // + color(0,0,0,50) + alpha 120，hp30/dmg13/def4）。落点 = (cx, 父底)【底中】锚
      // （:85719 NewNPC((int)(x+w/2),(int)(y+h),1)）——旧 cx±14 散布+cy−6 中心锚系自造。
      // 初速 = 父 vx×2 + Next(−20,20)×0.1 + k×direction×0.3 / 父 vy − Next(0,10)×0.1 − k
      // （:85724-85727）。联机傀儡跳过：分裂权威在房主（其真身分裂后经 msg23 快照下发，
      // 本地生成会留幽灵实体）。★登记：原版 NewNPC 后才 SetDefaults(-5) 重定尺寸且
      // 顶左不动 → 有效底=父底−(h₁₆−h₅)≈1px——本仓按"底=父底"锚（差 1px 不可观测）
      if (this.vanillaId === 16 && !this.netPuppet) {
        const n = 2 + Math.floor(Math.random() * 2);
        const add = (game as unknown as { entities?: { add: (en: unknown, bucket: string) => void; nextId?: number } }).entities;
        for (let k = 0; k < n; k++) {
          const b = Enemy.fromVanilla(1, this.cx, this.y + this.h);
          if (!b) continue;
          b.x = this.cx - b.w / 2;
          b.y = this.y + this.h - b.h;
          b.vanillaNetId = -5;
          b.vanillaScale = 0.9;
          b.colorRGBA = [0, 0, 0, 50];
          b.spawnAlpha = 120;
          b.hp = b.maxHp = 30;
          b.def.damage = 13;
          b.def.defense = 4;
          b.vx = this.vx * 2 + (Math.floor(Math.random() * 41) - 20) * 0.1 + k * this.facing * 0.3;
          b.vy = this.vy - Math.floor(Math.random() * 10) * 0.1 - k;
          b.ai0 = -1000 * Math.floor(Math.random() * 3);   // :85728
          add?.add(b, 'enemies');
        }
      }
      // ★BJ263 站1 飞尸 121 死 → 小腐化史莱姆（1457 :86418-86431 HitEffect 死亡支：type==121 →
      // NewNPC(GetSpawnSource_NPCHurt(),(int)(position.X+width/2),(int)(position.Y+height),81)
      // + SetDefaults(-2)）。★netID -2 定谳（FromNetId(NPCID.cs:12478-12484)→NetIdMap[1]=81
      // =腐化史莱姆基底×scale0.9,非蓝史莱姆系）：dmg45/def20/life90/kbResist×1.2/value100f
      // （覆写后不再 ScaleStats——与母史莱姆 -5 判例同相,raw 值直写）。落点=父底【底中】锚
      // （:86419 NewNPC→:81594 Bottom）；速度=父 vx/vy 原值继承（:86421-86422）。
      // Gore 94@scale 走 gore 表（carveOut）;联机傀儡跳过（分裂权威在房主,同 -5 门）。
      // ★登记（-5 同族潜伏差）：kbResist ×1.2 本站已接（base 81 缺省 1f×1.2）,-5 旧站
      // ×0.95 未接=既有潜伏差,本批不动旧站留台账。
      if (this.vanillaId === 121 && !this.netPuppet) {
        const s = Enemy.fromVanilla(81, this.cx, this.y + this.h);
        if (s) {
          // 盒链=VanillaSpawner 批次B 同款 netIdSpawnScale（override 0.9【替换】基 scale 1.1
          // 非——SetDefaults sizeScaleOverride 尾 :17824-17839 重定尺寸底中不动）：
          // 盒=(int)(40×0.9f)×(int)(30×0.9f)（f32 截断=35×26）、渲染 vanillaScale=
          // 0.9/(v.scale??1)（v.scale×vanillaScale=npc.scale,批次B 口径）。
          const v81 = s.vanilla!;
          const box = netIdSpawnScale(81, 0.9, v81.width, v81.height, scaleStatsWorld());
          s.w = s.def.width = box.width;
          s.h = s.def.height = box.height;
          s.vanillaScale = box.scale / (v81.scale ?? 1);
          s.x = this.cx - s.w / 2;              // 盒定后 Bottom 锚重定（:86419+:81594）
          s.y = this.y + this.h - s.h;
          s.vanillaNetId = -2;
          s.hp = s.maxHp = 90;
          s.def.damage = 45;
          s.def.defense = 20;
          s.def.knockbackResist = 1.2;
          s.vx = this.vx;
          s.vy = this.vy;
          addEnemy(game, s);
        }
      }
      // ★BJ263 站2 腐化史莱姆 81（scale≥1）死 → 2-3 只小腐化史莱姆（1457 :86434-86452：同支
      // else if (scale >= 1f) → Next(2)+2 掷数量;NewNPC(…,1)+SetDefaults(-1)——★netID -1
      // 定谳（FromNetId→NetIdMap[0]=81）=腐化史莱姆基底×scale0.6（NewNPC 的 type 1 被
      // SetDefaults(-1) 重写为 81,dmg45/def10/life90/value100f）。速度=父 vx×3f+
      // Next(−10,10)×0.1+k×direction×0.3 / 父 vy−Next(0,10)×0.1−k（:86443-86446）;
      // ai[1]=k=分裂序号【原版本相】——ai1==0 的首只由 slimeAI 首帧掷体内物
      // （:60951 门 value>0f=-1 变体 100f 过门）,ai1>0 的后两只走携物梯 1/2 档
      // （:61290 消费）——勿"修"成 -1（王驴 minis 的 -1 是 :86676 专属,两支语义不同）。
      // 门=npc.scale 终态≥1f：本仓镜像=(v.scale??1)×vanillaScale（批次B 渲染口径逆读;
      // 天然 81=1.1×1=1.1 过门,-2 小骑乘=0.9/-1 幼体=0.6 恒拒——分裂产物不再裂）。
      // 联机傀儡跳过。
      if (this.vanillaId === 81
        && (this.vanilla?.scale ?? 1) * this.vanillaScale >= 1   // 原版门=npc.scale≥1f（终态）
        && !this.netPuppet) {
        const n81 = 2 + Math.floor(Math.random() * 2);
        for (let k = 0; k < n81; k++) {
          const c = Enemy.fromVanilla(81, this.cx, this.y + this.h);
          if (!c) continue;
          const v81c = c.vanilla!;
          const box = netIdSpawnScale(81, 0.6, v81c.width, v81c.height, scaleStatsWorld());
          c.w = c.def.width = box.width;        // (int)(40×0.6f)×(int)(30×0.6f)=24×18
          c.h = c.def.height = box.height;
          c.vanillaScale = box.scale / (v81c.scale ?? 1);
          c.x = this.cx - c.w / 2;              // 盒定后 Bottom 锚重定（:86434+:81594）
          c.y = this.y + this.h - c.h;
          c.vanillaNetId = -1;
          c.hp = c.maxHp = 90;
          c.def.damage = 45;
          c.def.defense = 10;
          c.def.knockbackResist = 1.2;
          c.vx = this.vx * 3 + (Math.floor(Math.random() * 21) - 10) * 0.1 + k * this.facing * 0.3;
          c.vy = this.vy - Math.floor(Math.random() * 10) * 0.1 - k;
          c.ai1 = k;                            // :86449 ai[1]=num419
          addEnemy(game, c);
        }
      }
      // ★BJ263 站3 蛆虫僵尸 632 死 → 2-3× 蛆虫 606（1457 :87982-87993 HitEffect 死亡支 gore 段
      // 内：Next(2)+2 掷数量;NewNPC(GetSpawnSource_NPCHurt(),(int)(position.X+width/2),
      // (int)position.Y+Next(height/2)+10,606)——★落点 Y=父顶+Next(h/2)+10 逐只独掷,
      // Bottom 锚落在父体下半带内（与 Slimer 的父底锚不同源,勿并轨）;速度=
      // (Next(−10,10)×0.2, −3.5−Next(5,10)×0.3−k×0.5)（:87987/:87991 vector28 逐只重掷）;
      // netUpdate=true=原版联机同步位（房主权威已由 netPuppet 门承载）。gore 1214-1216
      // +受击面 gore 1217（1457:87929-87931 / 1456:87857-87859 Next(5)==0）走 gore 表。
      if (this.vanillaId === 632 && !this.netPuppet) {
        const n632 = 2 + Math.floor(Math.random() * 2);
        for (let k = 0; k < n632; k++) {
          const spawnBottomY = this.y + Math.floor(Math.random() * (this.h / 2)) + 10;
          const m = Enemy.fromVanilla(606, this.cx, spawnBottomY);
          if (!m) continue;
          m.x = this.cx - m.w / 2;
          m.y = spawnBottomY - m.h;             // Bottom 锚（:87989+:81594）
          m.vx = (Math.floor(Math.random() * 21) - 10) * 0.2;
          m.vy = -3.5 - (Math.floor(Math.random() * 5) + 5) * 0.3 - k * 0.5;
          addEnemy(game, m);
        }
      }
      // ---- 四柱小怪死亡分裂链（HitEffect 死亡段 life≤0 支，权威端）----
      // 426 外星蜂后死 → 3× 外星幼虫 428（NPC.cs:83981-83996）：场上 428+427+426×3
      //  <20 才分裂（★CountNPCS 含垂死本体——原版 active=false 在 NPCLoot 之后才置，
      //  本仓 dead=true 已先置 → 426 项显式 +3 补回自身）；初速 -UnitY.RotatedByRandom
      //  (2π)×Next(3,6) − UnitY×2（★三角分布 Utils.cs:1785-88,BJ112-④；★BJ112-c
      //  清债 2026-09-17：乘数已整数化=Next(3,6) 语义{3,4,5},旧 3+rand×3 连续
      //  浮点域外偏差已收;405 侧 3f+NextFloat()×4f 原版本就浮点,不动）；Bottom 锚
      //  (Center.X, Center.Y)（:83989 NewNPC → :81594 nPC.Bottom=(X,Y)，BJ112-② 勘误：
      //  旧 cy−h/2 = 中心锚半格偏低）。
      if (this.vanillaId === 426 && !this.netPuppet) {
        const aliveQ = (t: number) => (game.enemies() as Enemy[])
          .filter((o) => o !== this && !o.dead && o.vanillaId === t).length;
        if (aliveQ(428) + aliveQ(427) + (aliveQ(426) + 1) * 3 < 20) {
          for (let k = 0; k < 3; k++) {
            const larva = Enemy.fromVanilla(428, this.cx, this.cy);
            if (!larva) continue;
            larva.x = this.cx - larva.w / 2;
            larva.y = this.cy - larva.h;                     // Bottom 锚（:83989+:81594）
            const [rx, ry] = unitYRotatedByRandom(Math.PI * 2);   // −UnitY.RotatedByRandom(2π)（:83992）
            const s = 3 + Math.floor(Math.random() * 3);          // Next(3,6)=整数{3,4,5}（:83992,BJ112-c）
            larva.vx = -rx * s;
            larva.vy = -ry * s - 2;
            addEnemy(game, larva);
          }
        }
      }
      // 405 星细胞死 → 最多 4× 小星细胞 406（1457 :84395-84405）：场上 406+405
      //  ≥10/7/4 → 1/2/3 只，否则 4（CountNPCS 含垂死本体 → +1）；速度
      //  UnitY.RotatedByRandom(2π)×(3+rand×4)（★BJ112-④ 收编 2026-09-17：旧 uniform
      //  均匀角改三角分布单源 unitYRotatedByRandom——与 428 分裂/415 喷火尘同源）；
      //  Bottom 锚 (Center.X, Bottom.Y)。
      if (this.vanillaId === 405 && !this.netPuppet) {
        const aliveC = (t: number) => (game.enemies() as Enemy[])
          .filter((o) => o !== this && !o.dead && o.vanillaId === t).length;
        const cnt = aliveC(406) + aliveC(405) + 1;
        const n = cnt >= 10 ? 1 : cnt >= 7 ? 2 : cnt >= 4 ? 3 : 4;
        for (let k = 0; k < n; k++) {
          const mini = Enemy.fromVanilla(406, this.cx, this.y + this.h);
          if (!mini) continue;
          mini.x = this.cx - mini.w / 2;
          mini.y = this.y + this.h - mini.h;
          const [rx, ry] = unitYRotatedByRandom(Math.PI * 2);   // UnitY.RotatedByRandom(2π)（:84399）
          const s = 3 + Math.random() * 4;                      // 3f+NextFloat()×4f（浮点,原版同型）
          mini.vx = rx * s;
          mini.vy = ry * s;
          addEnemy(game, mini);
        }
      }
      // 蠕虫任一段死亡 → 整链同死（原版 realLife 共享生命，L18152-18156）
      // 例外：EoW 13/14/15 realLife=-1（:51524-51527）各段独立——杀中段拆两条、
      // 邻段晋升/自灭由 eowAI 每 tick 自查（:51874-51914），此处不传染
      if ((this.wormNext || this.wormFollow)
        && !(this.vanillaId !== null && this.vanillaId >= 13 && this.vanillaId <= 15)) {
        let head: Enemy = this;
        while (head.wormFollow) head = head.wormFollow;
        for (let s: Enemy | null = head; s; s = s.wormNext) s.dead = true;
      }
      // npc.boss 位（checkDead :78984-78987 DropEoWLoot :79212-79228）：EoW 三段仅
      // "场上再无 13/14/15"（本段即最后一段，i != whoAmI）才置位——全套 Boss 掉落
      // （宝袋/纪念章/宠物/魔矿 20-60/面具/奖旗）与 downedBoss2 都挂此位；中间段
      // 只出非门控小额（86/56 每段独立掷）。其余怪 = def.boss
      const eowId = this.vanillaId !== null && this.vanillaId >= 13 && this.vanillaId <= 15;
      this.killBossFlag = eowId
        ? !(game.enemies() as Enemy[]).some((o) => o !== this && !o.dead
          && o.vanillaId !== null && o.vanillaId >= 13 && o.vanillaId <= 15)
        : !!this.def.boss;
      // 掉落：1.4.5.6 ItemDropDatabase 规则树 + 钱币/心星管线（src/drops/NpcDrops.ts）
      // 求值序对照 NPCLoot(:79628)：规则 → 钱币 → 心星（Boss 另有药水+心）。
      // 联机傀儡跳过：掉落权威在房主（真身死亡掉落经 msg21 广播，本地生成会被
      // 自己的 netDropSweep 当作本端掉落二次广播 → 幽灵物品+重复掉落）
      // ★BJ688（2026-10-16 用户实报「打完毁灭者零掉落」定谳）：checkDead 掉落锚
      //  重定位（NPC.cs:79003-79024 type==134 专支）——NPCLoot 前头 position 临时
      //  顶替为【距 Main.player[target] 曼哈顿最近的在场 134/135/136 段】position，
      //  掉落全落玩家交战处后再还原。毁灭者头常钻地/出屏（80 段链 ~3500px），缺位时
      //  全套战利品生成在头位（探针 _bj688 实证：头移远 3150px 时 14-15 件掉落全部
      //  落在头位 3px 内、距玩家 3110px = 玩家侧零可见「打完零掉落」）。锚=胜段中心
      //  （DropItemFromNPC CommonCode.cs:13-14 position+w/2,+h/2）；窗口=整个掉落段
      //  （规则+钱币+心星+Boss 药水+MP instanced 袋+地牢魂墙门,原版 NPCLoot 全程顶替
      //  ——死亡音/尘/gore 在原版 HitEffect/78997 先行,不在此窗,仍用头真位）。
      //  段 dead 不滤：级联段（上方「蠕虫任一段死亡 → 整链同死」s.dead=true 循环,
      //  ★BJ704-G6 注锚随迁——旧自引行号 :15631→:15723 系本文件增行漂移,改按
      //  代码身份引用防再漂）已先翻位而原版 active=false 在 NPCLoot 后才置
      //  （数组在场=active 同义）;含头自身（原版扫描含 whoAmI 槽,头最近时锚=头）。
      //  非 134 恒自身中心 = 零漂移（134 的规则集无位置条件,ctx.x/y 不受影响）。
      let lootX = this.cx, lootY = this.cy;
      if (this.vanillaId === 134) {
        const tpBJ688 = this.targetRef(game) ?? game.player;
        if (tpBJ688) {
          let bestBJ688 = Infinity;
          for (const o of game.enemies() as Enemy[]) {
            if (o.vanillaId !== 134 && o.vanillaId !== 135 && o.vanillaId !== 136) continue;
            const dBJ688 = Math.abs(o.cx - tpBJ688.cx) + Math.abs(o.cy - tpBJ688.cy);
            if (dBJ688 < bestBJ688) { bestBJ688 = dBJ688; lootX = o.cx; lootY = o.cy; }
          }
        }
      }
      const rng = new RNG(Math.floor(Math.random() * 1e9));
      // R14-A2：FTW（getGoodWorld）肉前骷髅族"杀之无掉落"早退门（NPCLoot 首行
      // NPC57:79645 `(getGoodWorld || !isThereAWorldSurface) && !downedBoss3 &&
      // !onlyShimmerOceanWorlds && type∈{31,294,296,295,32,34,71,693,694}` → 整次
      // NPCLoot return（无钱无物无心星）——FTW 肉前打骷髅零收益补偿机制。
      // !isThereAWorldSurface（无地表世界）/onlyShimmerOcean 本仓无对应世界形态不接。
      // ★门并入下方掉落段条件而非裸 return：本段内联在 hurt():boolean 死亡分支里,
      // 裸 return 会连带跳过其后双子抑制/Boss 药水等死亡处理（TS2322 即此误）。
      // 可达集（肉前骷髅族）非双子非 Boss → 被门跳过的后续段对这些 type 恒无产出,
      // 并入条件=与"NPCLoot 函数级 return"语义逐字节等价
      const FTW_NO_LOOT_SKELETONS = new Set([31, 294, 296, 295, 32, 34, 71, 693, 694]);
      const ftwNoLoot = game.world.seedFlags?.getGoodWorld === true
        && !(game.world.flags['downed_35'] || game.world.flags.downedSkeletron)
        && this.vanillaId != null && FTW_NO_LOOT_SKELETONS.has(this.vanillaId);
      if (this.vanillaId && !this.netPuppet && !ftwNoLoot) {
        // 雕像产怪战利品门（NPCLoot :79648-79654）：肉前集合 / StatueSpawnedDropRarity
        // 概率门外 → 整单不出（连钱带心星一起跳过，原版直接 return）
        const statueSkip = this.spawnedFromStatue && (() => {
          if (STATUE_NO_EARLYMODE_LOOT.has(this.vanillaId!) && !game.world.flags.hardMode) return true;
          const rarity = STATUE_DROP_RARITY[this.vanillaId!] ?? -1;
          // :79651 `rand >= rarity || !AnyInteractions()`——掷中还需玩家曾交互
          // （岩浆/陷阱杀的雕像怪即便掷中也不出；近似：hurt fromPlayer 生效置位）
          return rarity >= 0 && (rng.next() >= rarity || !this.playerInteracted);
        })();
        if (!statueSkip) {
        const w = game.world;
        const p = game.player;
        // 专家/大师判定读**世界难度**（Main.expertMode/masterMode = GameMode 1/2，
        // Main.cs:2775/:2779）——角色难度（软/中/硬核）只管死亡惩罚，不参与掉落
        // （曾错接 p.appearance.difficulty：专家掉落/宝袋被角色难度误触发）
        // vanillaNetId 默认 0=无变体：netId/value 查表都要把 0 归一到 type
        const netId = this.vanillaNetId !== 0 ? this.vanillaNetId : this.vanillaId;
        // MP 掉落结算玩家表（2026-08-20 per-client 批）：结算端（房主/SimHost）注入
        // [本地+代理]/在线端——closestPlayer 的 luck/hp/mana 注入（NPCLoot :79634
        // Player.FindClosest：曼哈顿中心距,active&&!dead,严格 < 取先扫描槽）与
        // per-client 族（bossBag/masterAll）发放门的数据源。undefined = 单人
        // （表缺席,resolveDrops lootPlayers 缺席——今日行为零变化）
        const lootPlayers = game.lootPlayers?.(this);
        // closestPlayer 三元组：luck（钱币/心星/地牢魂/规则掷骰 Luck 链）+ hp/mana
        // （心星条件 statLife<statLifeMax2 / statMana<statManaMax2,:80334-:80345）。
        // 单人 = 本地玩家（表缺席时回退 p.*，与旧实现逐字节同源）
        let closestLuck = p.luck, closestHp = p.hp, closestHpMax = p.maxHp,
          closestMana = p.mana, closestManaMax = p.maxMana;
        // MP 最近结算玩家对象（zoneDungeon 等标量外字段的地牢魂条件消费源；
        // 单人 null → 走 scene 回退,与旧实现同）
        let closest: LootPlayerCtx | null = null;
        if (lootPlayers) {
          let best = -1;
          for (let i = 0; i < lootPlayers.length; i++) {
            const c = lootPlayers[i];
            if (c.dead) continue;
            const d = Math.abs(c.x - this.cx) + Math.abs(c.y - this.cy);
            if (best < 0 || d < best) {
              best = d;
              closestLuck = c.luck; closestHp = c.hp; closestHpMax = c.hpMax;
              closestMana = c.mana; closestManaMax = c.manaMax;
              closest = c;
            }
          }
        }
        const ctx: NpcDropCtx = {
          rng,
          netId,
          type: this.vanillaId,
          isExpert: w.isExpert, isMaster: w.isMaster,
          hardMode: !!w.flags.hardMode, crimson: !!w.crimson,
          flags: w.flags,
          // R14-A12①：位置条件半格语义——X 用 Center（cx），Y 用顶缘 position.Y
          // （PirateMap CND57:392 `(position.Y/16) < worldSurface+10` 与 Center.X/16;
          // 高个怪 Y 向差 ~0.7 格,近界偶发翻转）
          x: this.cx, y: this.y,
          worldSurfaceTile: w.groundLevel, rockLayerTile: w.rockLevel,
          underworldTileY: w.lavaLine || w.h - 200,
          maxTilesX: w.w, maxTilesY: w.h,
          lifeMax: this.maxHp, friendly: false, boss: this.killBossFlag,
          damage: this.def.damage ?? 0,
          // value：ScaleStats 后的缩放值（def.value，NPC.cs:18110 EnemyMoneyDropMultiplier）；
          // 雕像产怪 value=0（Wiring.cs:2479）——雕像归零优先于难度缩放。
          // ★负 netID 变体走 npcValueOf(netId) 原值：原版 SetDefaultsFromNetId（NPC.cs:7633+）
          //   先 SetDefaults_ForNetId（含 ScaleStats）再硬覆写 damage/life/value 常数，
          //   覆写后【不再缩放】→ 变体 value 是未缩放原值，不得用基底缩放值顶掉
          value: this.spawnedFromStatue ? 0
            : (netId === this.vanillaId ? (this.def.value ?? npcValueOf(netId)) : npcValueOf(netId)),
          statueSpawned: this.spawnedFromStatue,
          hp: closestHp, hpMax: closestHpMax, mana: closestMana, manaMax: closestManaMax,
          luck: closestLuck,
          // per-client 族（bossBag/masterAll）求值开关 + 四塔碎片堆叠加成
          // （DropOneByOne :63-64 ActivePlayersCount）
          lootPlayers: lootPlayers?.map((c) => ({ slot: c.slot, interacting: c.interacting })),
          activePlayers: lootPlayers ? Math.max(1, lootPlayers.length) : 1,
          moonEvent: game.moonEventCtx?.() ?? undefined,
          ai3: this.ai3, // NPC ai[3]：RedHatSkeletron / 光之女皇暴怒掉落条件
          ai1: this.ai1, // NPC ai[1]：史莱姆体内物品 id（SlimeBodyItemDropRule 数据源，
          //  Enemy.slimeRollContainedItem 首帧掷定；-1=掷过为空，0=未掷）
          // NPC.HasPlayerTarget（NPC.cs:6603）：TryTrackingTarget 无距离门，
          // 单人 = 玩家存活非 ghost——悠悠球五条件（Conditions.cs:1136-1244）数据源
          hasPlayerTarget: !!p && !p.dead,
          anyNpcOfType: (t) => game.enemies().some((o) => {
            const e2 = o as Enemy;
            return e2 !== this && !e2.dead && e2.vanillaId === t;
          }), // NPC.AnyNPCs：MissingTwin（先死的那只眼不掉）/MechdusaKill（三王同场全灭）
          // SpecialSeedFeatures.Mechdusa（SpecialSeedFeatures.cs:119-129 = remixWorld
          // && getGoodWorld）：getfixedboi 是唯一双真种子——本仓 seedFlags.everything
          // 已含 getGoodWorld 但未级联 remix，取 everything 等价（另容手工档双旗）
          mechdusaWorld: !!(w.seedFlags?.everything
            || (w.seedFlags?.remix && w.seedFlags?.getGoodWorld)),
          // WorldGen.Skyblock.noAltars（读档全图祭坛普查缓存，Game 侧实现）
          noAltarsInWorld: game.worldNoAltars?.() ?? false,
          // ★IIIII61 秘种子掉落条件族数据源（Conditions.cs:1448-1566 + SpecialSeedFeatures）
          dontStarveWorld: !!w.seedFlags?.theConstant,
          // Main.remixWorld（RemixSeed 四变体条件,Conditions.cs:1282-1412——2026-09-03
          // R3-B2 接线:曾恒 false 降级=remix 世界猪鲨掉错武器/袋 remix 支死）
          remixWorld: !!w.seedFlags?.remix,
          tenthAnniversaryWorld: !!w.seedFlags?.tenthAnniversary,
          skyblockLowTiles: !!w.skyblockLowTiles,
          // SpecialSeedFeatures.ShouldDropExtraGel（十周年×醉酒×非 remix×非蜜蜂）
          extraGelWorld: !!(w.seedFlags?.tenthAnniversary && w.seedFlags?.drunkWorld
            && !w.seedFlags?.remix && !w.seedFlags?.notTheBees),
          playerHasSickle: (() => {
            // Player.HasItemInInventoryOrOpenVoidBag（Conditions.cs:1560→Player.cs
            // :56578-56589）：HasItem = 背包 58 格逐槽(:56554-56564);未持有且
            // useVoidBag() 时再扫 bank4(虚空保险库,Player.banks[3])。
            // ★⑨清偿(2026-08-31)：补虚空袋支——曾只扫背包（"袋内物格未建模"登记
            // 已过时,banks[3] 自 F3 批起有真实物格）
            try {
              for (const s of p.inv.slots) {
                if (s && s.stack > 0 && (ITEM_DEFS[s.id]?.vid ?? -1) === 1786) return true;
              }
              if (p.useVoidBag?.() && Array.isArray(p.banks?.[3])) {
                for (const s of p.banks[3]) {
                  if (s && s.stack > 0 && (ITEM_DEFS[s.id]?.vid ?? -1) === 1786) return true;
                }
              }
              return false;
            } catch { return false; }
          })(),
          extras: game.dropContext?.(),
        };
        const unmapped = (id: number) => {
          if (!UNMAPPED_WARNED.has(id)) { UNMAPPED_WARNED.add(id); console.warn(`[NpcDrops] 物品 ${id} 无 key 映射，跳过`); }
        };
        const spawn = (id: number, n: number, px?: number, py?: number, vx0?: number, vy0?: number): ItemDrop | null => {
          // ★GLM娘 rivals 批修复:mod 物品(30000+ 段)不在原版 id→key 映射,掉落被
          //   unmapped 静默吞。plan-A 后 internal≡stable≡vid,ITEM_DEFS[id].key 直接可查
          //   (原版 id 两源同键,零漂移)。
          const key = VANILLA_ITEM_KEY_BY_ID[id] ?? ITEM_DEFS[id]?.key;
          if (!key) { unmapped(id); return null; }
          // ★BJ390（2026-09-28）掉落词缀自然掷：CommonCode 三投掷口（DropItemFromNPC
          //  :20 / DropItemLocalPerClientAndSetNPCMoneyTo0 :29 / DropItemForEachInteracting
          //  PlayerOnThePlayer :48）NewItem 第 8 参恒 -1 → NewItem 内 item.Prefix(prefix)
          //  （Item.cs:49735）先于初速掷（:49746-49756）——掷序=词缀→速度照抄。钱币/心星/
          //  药水族 CanHavePrefixes=null（GetRollablePrefixes 返 null）零掷自门（Prefix
          //  :516-518 提前 false），全量走同一通道=原版同相。骰源 = 本仓掉落族 Math.random
          //  通道惯例（Main.rand→Math.random,killTileDropItems 同口径）。
          const prefix = rollNaturalPrefixForVid(id, isPrefixableAccessory(ITEM_BY_KEY[key] ?? -1),
            () => Math.random());
          const v = vx0 !== undefined ? { vx: vx0, vy: vy0 ?? 0 } : dropVelocity(rng, id);
          const drop = game.spawnDrop(px ?? lootX, py ?? lootY, key, n, v.vx, v.vy, undefined, prefix || undefined);   // ★BJ688:掉落锚=134 重定位位（余=自身中心）
          // 心(58)/星(184) 标记为 pickup：触碰回血/回蓝，不进背包
          if (drop) {
            if (id === 58) drop.pickup = 'heart';
            else if (id === 184) drop.pickup = 'star';
          }
          return drop;
        };
        const res = resolveDrops(ctx);
        for (const d of res.drops) {
          // ---- per-client 族分发（CommonCode.cs:35-88 netMode==2 段 1:1）----
          // scope 由 resolveDrops 仅在 lootPlayers 在场（MP 结算端）时标记
          if (d.scope === 'local') {
            // DropItemLocalPerClientAndSetNPCMoneyTo0：求值端单掷已过 → 每个交互端
            // 各得一份 instanced 副本（原版 msg90 定向;位置/初速各端同值——服务器
            // 序列化同一份 item 数据）。金钱清零在求值侧（out.zeroValue）
            // ★BJ390：词缀单掷一次（CommonCode.cs:29 NewItem(-1),先于初速掷）
            const keyL = VANILLA_ITEM_KEY_BY_ID[d.id];
            const prefixL = rollNaturalPrefixForVid(d.id,
              isPrefixableAccessory(ITEM_BY_KEY[keyL ?? ''] ?? -1), () => Math.random());
            const v = dropVelocity(rng, d.id);
            if (lootPlayers && game.grantInstancedLoot) {
              for (const c of lootPlayers) {
                if (!c.interacting) continue;   // npc.playerInteraction[slot]（:44）
                game.grantInstancedLoot(c.slot, lootX, lootY, keyL ?? '', d.n, v.vx, v.vy, prefixL || undefined);   // ★BJ688:instanced 袋随重定位锚（CommonCode.cs:29 npc.position=顶替位）
              }
            } else {
              spawn(d.id, d.n);   // 防御：MP 求值但发放钩子缺失（理论不可达）→ 世界掉落兜底
            }
            continue;
          }
          if (d.scope === 'perPlayer') {
            // DropItemForEachInteractingPlayerOnThePlayer：掷骰在求值侧逐玩家完成
            // （NpcDrops masterAll,槽序）→ 命中者头顶落【普通广播物品】
            // （Item.NewItem noBroadcast:false,:73——他人理论可抢,原版同款）
            const c = lootPlayers?.find((q) => q.slot === d.slot);
            spawn(d.id, d.n, c ? c.x : this.cx, c ? c.y : this.cy);
            continue;
          }
          const drop = spawn(d.id, d.n);
          // 凝胶染色（CommonCode.ModifyItemDropFromNPC）：gel(item 23) 由 type 1 掉落且
          // netID∉{-1,-2,-5,-6} → item.color = npc.color（当前渐变色）
          if (drop && d.id === 23 && this.vanillaId === 1
            && this.vanillaNetId !== -1 && this.vanillaNetId !== -2
            && this.vanillaNetId !== -5 && this.vanillaNetId !== -6 && this.colorRGBA) {
            drop.color = [...this.colorRGBA];
          }
        }
        // 地牢之魂（DoDeathEvents_SummonDungeonSpirit，NPC.cs:79863-79878）：世纪之花
        // 已击败 + 目标玩家身处地牢，击杀 lifeMax>100、value>0、非 288 的敌怪 →
        // closestPlayer.RollLuck(13/专家9)==0（★luck 改掷，2026-08-15 前误为均匀掷）
        // 且【本 NPC 中心格墙为地牢墙】（Main.wallDungeon 7/8/9/94-99——原版双门，
        // 此前缺墙门=误在砖外刷魂）→ 原地刷 288
        if (this.vanillaId !== 288 && ctx.lifeMax > 100 && ctx.value > 0 && ctx.hasPlayerTarget
          && ctx.hardMode && ctx.flags['downed_262']
          && (lootPlayers
            ? (closest?.zoneDungeon
              ?? (game as unknown as { scene?: { zoneDungeon?: boolean } }).scene?.zoneDungeon)
            : (game as unknown as { scene?: { zoneDungeon?: boolean } }).scene?.zoneDungeon)
          && rollLuck(ctx.luck ?? 0, ctx.isExpert ? 9 : 13, () => rng.next()) === 0) {
          const st2 = game.world.store;
          // ★BJ688:墙门与魂落点同用重定位锚（原版 :79889/:79891 读 base.Center=
          // 顶替位;非 134 时锚=自身中心,零漂移）
          const wx = Math.floor(lootX / TILE), wy = Math.floor(lootY / TILE);
          if (st2.inBounds(wx, wy) && DUNGEON_WALL_IDS.has(st2.wall[st2.idx(wx, wy)])) {
            spawnPart(game, this, 288, lootX, lootY);
          }
        }
        // 双子 BeforeLoot（NPC.cs DoDeathEvents_BeforeLoot :79761）：另一只眼还活着时
        // value=0 + boss=false——钱与 Boss 药水/心只给后死的那只（先死的只出规则掉落）
        const twinSuppressed = (this.vanillaId === 125 || this.vanillaId === 126)
          && game.enemies().some((o) => {
            const e = o as Enemy;
            return e !== this && !e.dead
              && e.vanillaId === (this.vanillaId === 125 ? 126 : 125);
          });
        // ★结算序对齐（红蓝对抗 R3-B4 校正,1457 NPCLoot :79643 实测线性序：
        // BeforeLoot → DropItems(:79668,上方 resolveDrops) → DoDeathEvents(:79669)内
        // 线性执行 money(:79712) → DropHeals(:79714) → DropCommonLifeAndMana(:79916)
        // → DropBossPotionsAndHearts(:80323)。R14-A11① 曾以" potions 先于 money"
        // 重排——:80323 > :79712 实为【后】,本序回归原版线性位）
        // 钱币（规则未清零 value 时走 NPCLoot_DropMoney 管线）
        // R14-A3：extraValue（怪吸收钱累计）改经 rollCoins 尾参并入（:80497 乘区/
        // luck 双掷之后、拆币之前——曾并入基数被六级乘区放大,R3-B3 校正）
        const value = res.zeroValue || twinSuppressed ? 0 : ctx.value;
        const extraV = this.extraValue;
        this.extraValue = 0;
        if (value > 0 || extraV > 0) {
          for (const c of rollCoins(value, ctx, !!ctx.extras?.bloodMoon, this.midasT > 0, extraV)) spawn(c.id, c.n);
        }
        // 按 type 额外心（NPCLoot_DropHeals :79714,钱币后调用）——R14-A4
        for (const h of rollTypeHearts(ctx)) spawn(h.id, h.n);
        // 心/星（NPCLoot_DropCommonLifeAndMana :79916 调用点）
        for (const h of rollHeartsAndStars(ctx)) spawn(h.id, h.n);
        // Boss 药水+心（DoDeathEvents_DropBossPotionsAndHearts :80323,boss 门 :80322）——
        // EoW 中间段 killBossFlag=false 不出（仅最后一段）
        if (this.killBossFlag && !twinSuppressed) for (const b of rollBossPotionsAndHearts(ctx)) spawn(b.id, b.n);
        }
      } else {
        for (const d of this.def.drops) {
          if (rng.next() < d.chance) {
            const n = rng.int(d.min, d.max);
            if (n > 0) game.spawnDrop(this.cx, this.cy, d.item, n, rng.range(-1.5, 1.5), -2);
          }
        }
      }
      // ★D20-m3(2026-10-13):mod 击杀钩改尾派发(tML 序=StrikeNPC 内 OnHitNPC 先于
      //  checkDead→OnKill;旧序 onEnemyKilled 头=onKill 先于 onHitByAny(killed) 反相)
      //  ——skipModKillHooks 让 onEnemyKilled 只走原版记账,mod 双钩随 hurt 尾
      //  onHitByAny(killed=true) 之后派发(顺序=per-NPC 先/global 后,镜像原 onEnemyKilled)
      game.onEnemyKilled(this.key, this, { skipModKillHooks: true });
      // 死亡声 = 本体 DeathSound（NPC.Strike :48316 全 NPC 同链，Boss 亦然——
      // 血肉墙 NPCDeath10 / 机械族 NPCDeath14 / 克脑 NPCDeath11 / 猪鲨 NPCDeath20 /
      // 光皇 65 / 史后 64 / 异教徒 59 / 月总头手 62 / Betsy DD2 / 鹿角怪专属）。
      // HitEffect 里唯一额外 Boss 咆哮 = EoC（NPC.cs 1456:88205-88210 / 1457:88277-88282：gore 循环体内
      // PlaySound(15)，×2 次迭代 → 连播两声）；月总核心 398 DeathSound=null 无声。
      // （旧"Boss 一律咆哮吞掉 DeathSound"2026-08-14 对账修正）
      if (this.vanillaId === 4) {
        game.playSfx('roar', 1, this.cx, this.cy);
        game.playSfx('roar', 1, this.cx, this.cy);
      }
      if (this.vanillaId !== 398) {
        if (this.def.killedSound.length) game.playSfxFiles?.(this.def.killedSound, 1, this.cx, this.cy);
        // 空 = 显式无声(原版 DeathSound=null,246 头:血尽本应转 249,标准死零死音)——
        // 旧 'killed' 合成 fallback 无可达场景(fromVanilla 恒非空除 null 路径),撤
      }
      // ★BJ254（2026-09-21）死亡尘单源化：vanilla-npcdust.json 查表（hit/death 两相
      // 单源,语义见 NpcHitDust.ts 头注）。原鸟族 61/252/301 死亡 50 簇块、猪鲨
      // 370/372/373、圣骑士 290、唾液 112/666、岩浆族 59/60/151 死亡尘全部转查表
      // （值不变=金标保形;spawnNpcDeathGore 表承担 gore,先尘后 gore 与原版同序）。
      // hd = hitDirection 蒸馏（kbx 符号,0 兜 1,同旧手块约定）。
      spawnNpcDeathDust(this, game, Math.sign(kbx) || 1);
      // WoF 家族死亡尘（HitEffect life<=0 段）：血肉墙 113 / 大眼 114 = 50 簇
      // 5 号血尘 SpeedX=2×hitDirection / SpeedY=-1（1457 NPC.cs:88359-88361；
      // 1456 :88287-88289）。饥饿者 115 权威侧（SP/房主——与本管线前段
      // NewNPC(116) 同用 !netPuppet 门）= 10 簇 hitDirection/-1，且原版该支出尘后
      // 直接 return——单机 Hungry 死亡无任何 gore（1457 :88411-88417；1456
      // :88337-88346）；客户端傀儡 115 与 TheHungryII 116 落通用支 = 20 簇
      // hitDirection/-1（1457 :88420-88423；1456 :88348-88350），随后 gore
      // 132/133 由下方查表承担。
      // ★113 全屏肉浆尘幕的逐格尘不在此补：
      //   · 逐格 gore（140-142）已由 vanilla-gore.json 的 screenGrid 条目承担
      //     （GorePiece.spawnScreenGridGore，玩家深度门 playerDeepHell 1:1）；
      //   · 逐格 5 尘（1457 :88392-88395；1456 :88322-88324，32×32 盒、速度
      //     rand(-60..60)*0.1）已由 Renderer.spawnWoFDeathFx 代位——Game 尘池
      //     512 放不下原版满屏 ~570 粒（Renderer 侧自持粒子列表 2 尘/格折半，
      //     见其方法头注），此处再发会双倍叠加。
      const wofDeadVid = this.vanillaId;
      const wofHungryAuthority = wofDeadVid === 115 && !this.netPuppet;
      if (wofDeadVid === 113 || wofDeadVid === 114) {
        const hdWofD = Math.sign(kbx) || 1;
        // StrikeNPC 扇出派发（1457 NPC.cs:82313-82328；1456 :82240-82255）：113/114
        // 致死拍不直接 self-HitEffect，而是遍历全场 active 的 113/114 逐个调
        // HitEffect——受击者之外的眼/墙此刻 life 仍是上一帧 AI 镜像值（眼
        // :26209-26213 仅在 host.life>0 时回填）→ 落各自盒的受击支 20 簇；
        // 同帧已 life<=0 的同型（多重致命 AOE，理论态）按原版落同款死亡支。
        // 只做视觉重放：不置 dead、不进掉落（CheckDead 链原版另派发，
        // :82392-82397），部件消散仍由 bossAI_wof 的静默离场承担
        for (const oRaw of game.enemies()) {
          const o = oRaw as Enemy;
          if (o === this || o.dead || (o.vanillaId !== 113 && o.vanillaId !== 114)) continue;
          if (o.hp > 0) {
            for (let k = 0; k < 20; k++) game.dust?.spawn(o.x, o.y, o.w, o.h, 5, hdWofD, -1);
          } else {
            for (let k = 0; k < 50; k++) game.dust?.spawn(o.x, o.y, o.w, o.h, 5, 2 * hdWofD, -1);
            spawnNpcDeathGore(o, game, hdWofD, o.facing);
          }
        }
        // 受击者自身死亡支
        for (let k = 0; k < 50; k++) game.dust?.spawn(this.x, this.y, this.w, this.h, 5, 2 * hdWofD, -1);
      } else if (wofHungryAuthority) {
        const hdWofD = Math.sign(kbx) || 1;
        for (let k = 0; k < 10; k++) game.dust?.spawn(this.x, this.y, this.w, this.h, 5, hdWofD, -1);
      } else if (wofDeadVid === 116 || wofDeadVid === 115) {
        const hdWofD = Math.sign(kbx) || 1;
        for (let k = 0; k < 20; k++) game.dust?.spawn(this.x, this.y, this.w, this.h, 5, hdWofD, -1);
      }
      // 原版死亡 gore 碎块（NPC.HitEffect life<=0 段全表，NPC.cs 1456:82421-90870 /
      // 1457:82492-90939（★BJ308 终点勘误:90870=方法体闭括号,旧 90873 伪锚落
      // 入邻方法 CountNPCS）→
      // tools/extract-gore.mjs → src/data/vanilla-gore.json）：查表炸 GorePiece
      // （位置/速度/ai 门/gates 守卫/post 后处理 1:1，Gore.NewGore 随机扰动在
      // GorePiece.newGore 内）。spriteDirection = 本仓 facing（同符号约定，表内
      // `spriteDirection != -1` 类镜像分支门用）。无表项 = 原版只出尘不出块
      // （史莱姆族等）→ 只走下方彩色粒子近似
      // 115 权威支跳查表：HitEffect :88411-88417 的 return 在 NewNPC(116)+10 尘
      // 之后立即发生，132/133 不落——vanilla-gore.json 表未建模该早退（132/133
      // 行被提取器记到 115 头上，是 116 共用段）；此处按原版控制流门掉，联机
      // 傀儡端不加门=通用支语义（客户端也出 132/133）
      if (!wofHungryAuthority) {
        spawnNpcDeathGore(this, game, Math.sign(kbx) || 1, this.facing);
      }
      // ★BJ704-R3 P1②b：爆炸兔死亡爆弹（checkDead case 614,NPC.cs:80182-80191——
      //  1.4.4 起【任意死因】的兔 614 皆炸:NewProjectile(Center,0,0,281,dmg,kb 0,
      //  owner=Main.myPlayer,ai[0]=-2,ai[1]=releaseOwner+1)。dmg=175,
      //  SpawnedFromStatue → 0（雕像兔=纯 FX 爆,Arrow.bunnyBlastExplode damage<=0
      //  早退）。释放链 releasedFromItem → ai[1]=1（爆炸可炸释放者本人,Arrow 侧
      //  :14873-77 门）;野兔 releaseOwner=255 → 256（不可炸玩家）。弹体侧 AI_049
      //  头 :28651-56 hostile+Kill 即灭,载荷全在 Kill case 281（盒扩 128×128+
      //  dealContacts idStatic 10+FX）。兔炮 1338 弹药面/活兔投掷支（ai[0]>=0
      //  跳跃态）未实装=边界声明（另刀）。
      if (this.vanillaId === 614) {
        const bBlast = new Arrow(this.cx - 14, this.cy - 14, 0, 0,
          this.spawnedFromStatue ? 0 : 175, 0, 281, {});
        bBlast.bunnyBlastForm = -2;
        bBlast.bunnyOwner = this.releasedFromItem ? 1 : 256;
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities
          .add(bBlast, 'projectiles');
      }
      // 死亡尘各精确块（鸟族/猪鲨/圣骑士/唾液/岩浆族）已全部转查表（BJ254,上方
      // spawnNpcDeathDust 单源）；★通用彩色粒子近似（def.gore 三簇 spawnParticles）
      // 就此退役——原版 HitEffect 无通用尘尾,表外型死亡不出尘=原版本相（本批唯一
      // 故意行为变化,tests/bj254-npcdust.test.ts 结构锁）。
      // 岩浆族死亡泼岩浆 carve-out（BJ246）保留：lavaExactDust 仅作其门用。
      const lavaExactDust = lavaVid === 59 || lavaVid === 60 || lavaVid === 151;
      // ★BJ246（2026-09-21,BJ243 登记债清偿）岩浆族死亡泼岩浆（HitEffect life<=0 支
      // 尾段,NPC.cs:86561-86645;1458 同行号逐字全等 2026-09-21 对拍零变更）：
      //  门1（:86561）59 熔岩史莱姆——(Main.expertMode || WorldGen.Skyblock.lowTiles)
      //    && Main.netMode != 1 && !Main.remixWorld;内分 Skyblock.lowTiles 全盒支
      //    （:86565-86584,Left.X..Right.X × Top.Y..Bottom.Y 四至含端,逐格非实心∧
      //    liquid==0 → liquid=255+lava+honey(false)+SquareTileFrame）/否则中心格支
      //    （:86587-86595,(int)(Center.X/16f) 截断除,非实心∧无液 → liquid=
      //    (byte)Main.rand.Next(50,150)+lava+honey(false)+SquareTileFrame）;
      //  门2（:86602-86645,原文 || 短路早退取反）60 地狱蝙蝠/151 熔岩蝙蝠——
      //    Main.netMode != 1 && Main.remixWorld && (Main.getGoodWorld ||
      //    WorldGen.Skyblock.lowTiles),几何/写位同门1。
      //  两门 type 互斥（59 vs 60/151）恒至多落一支。写位=裸 tile 写+SquareTileFrame
      //  （:86594/:86637）——运行时等价=setLiquid 监听链（LiquidSim 唤醒/光照脏/
      //  联机 reportLiquidChange,RollingBoulder.rbPlaceLiquidLava 同判例）;
      //  honey(false) 并入 liquidType 直写。SolidTile 门=WorldGen.SolidTile(:70642,
      //  active∧tileSolid∧!tileSolidTop∧!halfBrick∧slope==0∧!inActive)→ 模块尾
      //  npcSolidTile1457 同式（不引 VanillaSpawner.worldSolidTile——其 import Enemy
      //  成环,WeatherRenderer.solidTileExact 同式先例）;越界格=原版 tile==null →
      //  SolidTile true → 拒泼（try/catch 域等价）。netMode!=1 → 权威端（!netPuppet;
      //  傀儡端不写液,液态经房主通道下发）。普通世界零泼面=两门皆不满足=原版本相
      //  （经典非 Skyblock/专家非 remix 的 60/151 均不泼,测试钉死）。
      if (lavaExactDust) {
        const sbLow = !!game.world.skyblockLowTiles;        // WorldGen.Skyblock.lowTiles
        const remix = !!game.world.seedFlags?.remix;        // Main.remixWorld
        const ftw = !!game.world.seedFlags?.getGoodWorld;   // Main.getGoodWorld
        if ((mainExpertMode(game.world) || sbLow) && lavaVid === 59
          && !this.netPuppet && !remix) {                   // :86561 门1
          this.deathLavaSplash1457(game, sbLow);
        }
        if ((lavaVid === 151 || lavaVid === 60) && !this.netPuppet
          && remix && (ftw || sbLow)) {                     // :86602 门2（取反式）
          this.deathLavaSplash1457(game, sbLow);
        }
      }
      // ★BJ254：死亡通用彩色粒子近似退役（上方注释）——表外型死亡零粒子=原版相。
      // ★R-B-F2:转移死幻影拍抑制窗(realLifeHost.__swModSilentHit)
      if (!(this as { __swModSilentHit?: boolean }).__swModSilentHit) {
        if (fromPlayer) runModOnHitAny(this, game, { damage: dmg, crit, killed: true, projId: srcProjId, melee: srcProjId === 0 && pierce === 0 });   // ★A4:防后
        runModOnNpcHitByAny(this, game, { damage: dmg, crit, killed: true, projId: srcProjId });   // ★B 批:全域受击;★A4:防后
      }
      // ★D20-m3:mod 击杀双钩尾派发(tML OnKill 序;onHitByAny 之后)
      runModOnNpcDeath(this.vanillaId, this, game as unknown as Game);
      runModOnKillAnyNpc(this, game);
      return true;
    }
    // ★BJ254：受击通用彩色粒子近似（def.gore[0] 5 粒 spawnParticles）退役——
    // 受击尘全归 spawnNpcHitDust 查表（表外型受击零尘=原版相,唯一故意行为变化）。
    // ★四百七十刀:OnHit 域派发缝（C# CalamityPlayerOnHit.ItemOnHit/ProjOnHit 同位
    //  =玩家来源受理伤害结算尾;fromPlayer 门=NPC 互伤/陷阱/环境伤不进;免疫帧/
    //  dontTakeDamage/零伤转换早退支不进=原版 OnHitNPC 同相）。
    //  零注册=零成本（runModOnHitAny 头门）。melee 探针=非弹幕穿面（pierce=0 近战惯例）。
    if (fromPlayer) runModOnHitAny(this, game, { damage: dmg, crit, killed: false, projId: srcProjId, melee: srcProjId === 0 && pierce === 0 });   // ★A4:防后
    runModOnNpcHitByAny(this, game, { damage: dmg, crit, killed: false, projId: srcProjId });   // ★A4:防后
    return false;
  }

  /** ★D20-M1 清偿(2026-10-13):受理伤非死亡支的受击派发——①六致死转态支
   *  (realLife/月总/泡泡/石巨人头/四塔/水晶,hp≤0 入转态非拒收)②训练假人 488
   *  (immortal 早退支,D20-m1 清偿=mod 武器打假人出特效)。tML OnHitNPC 语义=受理
   *  即发(死亡与否只影响 killed 旗;两支均 killed=false)。onKill 不在此发:转态非
   *  死亡(realLife 经头 die()→标准管线含击杀派发;四塔/水晶演出终末走标准死亡管线
   *  时派发),假人 immortal 永不死亡。零注册零成本(头门)。 */
  private dispatchAcceptedHit(game: GameHooks, fromPlayer: boolean, dmg: number,
    crit: boolean, pierce: number, projId: number): void {
    if (fromPlayer) runModOnHitAny(this, game, { damage: dmg, crit, killed: false, projId, melee: projId === 0 && pierce === 0 });
    runModOnNpcHitByAny(this, game, { damage: dmg, crit, killed: false, projId });
  }

  /** AI 触发的标准死亡（EoW 断链自灭，NPC.cs:51876-51905 的 life=0 + HitEffect +
   *  checkDead 语义；毁灭者 AI_037 :50490-50502 同式）：清无敌帧后走 hurt 全管线
   *  （掉落/记账/音效/粒子）——原版直改 life 不经 StrikeNPC，故 iframes 不应阻塞。
   *  ★BJ476（2026-10-03 用户实报）：传参=9999 整（非 maxHp+9999）——原版级联死/
   *  断链自灭【无伤害飘字无受击音】（checkDead 面非 StrikeNPC 面）;本仓 hurt 的
   *  飘值门（hurt 飘值块 :14702 ★BJ502 2026-10-04 起原版形态 rawDmg>=9999 且合成
   *  owner255 位,锚原版 StrikeNPC_Inner :82065/:82081 DoT 静默）对 9999 整天然静音——旧 maxHp+9999
   *  （墓穴爬虫头 513 lifeMax 60+9999=10059）击穿门=每次断链自灭冒 ~10K 橙字
   *  （伤害色 (255,160,80) 本就橙,非暴击）。致死性无涉：hp 已先置 0,any dmg≥1
   *  即进死亡管线（applyDoT :4636 同款 9999 通道）。 */
  die(game: GameHooks): void {
    this.hp = 0;
    this.iframes = 0;
    this.hurt(9999, 0, 0, game);
  }

  /** ★BJ246 岩浆族死亡泼岩浆写位面（NPC.cs:86563-86600/:86606-86644 try 域 1:1,
   *  两门共用）：Skyblock.lowTiles 全盒支（:86565-86584 Left.X..Right.X ×
   *  Top.Y..Bottom.Y 四至含端,(int)(px/16f) 截断除,逐格非实心∧liquid==0 →
   *  liquid=255+lava+honey(false)+SquareTileFrame）/否则中心格支（:86587-86595
   *  (int)(Center.X/16f),非实心∧无液 → liquid=(byte)Next(50,150)+lava 同后处理）。
   *  setLiquid 触发监听链=LiquidSim 唤醒/光照脏/联机上报（SquareTileFrame 运行时
   *  等价,RollingBoulder.rbPlaceLiquidLava 同判例）;honey(false) 并入 liquidType。 */
  private deathLavaSplash1457(game: GameHooks, sbLow: boolean): void {
    const st = game.world.store;
    if (sbLow) {
      // :86567-86570 四至（Left/Top=position,Right/Bottom=position+size,f32 链同
      // RollingBoulder.rbCenterTileTruncX 判例）;越界=tile null → SolidTile true → 拒
      const x0 = Math.trunc(Math.fround(Math.fround(this.x) / 16));
      const x1 = Math.trunc(Math.fround(Math.fround(Math.fround(this.x) + Math.fround(this.w)) / 16));
      const y0 = Math.trunc(Math.fround(Math.fround(this.y) / 16));
      const y1 = Math.trunc(Math.fround(Math.fround(Math.fround(this.y) + Math.fround(this.h)) / 16));
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          if (!st.inBounds(x, y)) continue;
          const i = st.idx(x, y);
          if (npcSolidTile1457(st, x, y) || st.liquid[i] !== 0) continue;  // :86575
          st.setLiquid(x, y, 255, LIQUID_TYPE.LAVA);                       // :86577-86579
        }
      }
      return;
    }
    // :86587-86595 中心格支——Center=position+size/2（Entity.cs:50-55 float 链）
    const cX = Math.fround(Math.fround(this.x) + Math.fround(this.w / 2));
    const cY = Math.fround(Math.fround(this.y) + Math.fround(this.h / 2));
    const tx = Math.trunc(Math.fround(cX / 16));
    const ty = Math.trunc(Math.fround(cY / 16));
    if (!st.inBounds(tx, ty)) return;                     // tile null → SolidTile true → 拒
    const ti = st.idx(tx, ty);
    if (npcSolidTile1457(st, tx, ty) || st.liquid[ti] !== 0) return;        // :86589
    st.setLiquid(tx, ty, 50 + Math.floor(Math.random() * 100), LIQUID_TYPE.LAVA);  // :86591-86593
  }

  draw() { /* Renderer 统一绘制 */ }
}
// 构造器回填（enemyCtorRegistry 叶模块承载,导入序无关——2026-08-26 生产包
// TDZ 实报后抽叶根修,详见 enemyCtorRegistry.ts 头注）
bindEnemyCtor(Enemy);

// ===================== 仙灵宝箱搜索（GetFairyTreasureCoords NPC.cs:48794-48852 1:1）=====================

/** FriendlyFairyCanLureTo（TileID.cs:413——旧注 :409 系行号漂移）：仙灵可引导到的宝箱/家具 tile 表
 *  ——★BJ210 收编单源 data/tiles.ts:FRIENDLY_FAIRY_CAN_LURE_TO_SHEETS（逐值对拍 17≡17,§6i） */
const FAIRY_LURE_SHEETS = FRIENDLY_FAIRY_CAN_LURE_TO_SHEETS;

/** tileOreFinderPriority（Main.cs:6540-6571，短整型数组 Main.cs:1486 零填充→未列
 *  tile 默认 0=有效候选）：引导优先级——同优先级取最近（NPC.cs:49280-49290）。
 *  矿脉门见 fairyTreasureCoords（±3×±3 同类计数<40 → 剔除，NPC.cs:49258-49278）。
 *  ★Z3 补 236 生命果/702 生命果复制品=810（全表最高，Main.cs:6570-6571）——
 *  缺失时「生命果永不成为引路目标」（repo 旧 fallback −1 跳过式）。
 *  656/701/751/752=760/770 同段缺但均不在 FriendlyFairyCanLureTo 集内（lure 集外
 *  无消费面）=零实害，刻意不补（D5 定谳）。 */
const FAIRY_LURE_PRIORITY: Record<number, number> = {
  28: 100, 407: 150, 404: 150, 7: 200, 166: 210, 6: 220, 167: 230, 9: 240,
  168: 250, 8: 260, 169: 270, 22: 300, 204: 310, 37: 400, 21: 500, 467: 500,
  441: 500, 468: 500, 12: 550, 665: 550, 639: 550, 107: 600, 221: 610,
  108: 620, 222: 630, 111: 640, 223: 650, 129: 675, 211: 700, 227: 750,
  236: 810, 702: 810,
};

/** IsValidForOreFinder（SceneMetrics.cs:895-907）：227 草药（DyePlants）仅成熟株
 *  272≤frameX≤374、129 水晶碎晶（Crystals）仅大晶 frameX≥324 才算（旧注误标
 *  「生命果/宝箱」，Z3 勘误） */
function fairyOreFinderValid(sheet: number, frameX: number): boolean {
  if (sheet === 227) return frameX >= 272 && frameX <= 374;
  if (sheet === 129) return frameX >= 324;
  return true;
}

/** GetFairyCircleOffset（NPC.cs:49231-49235）1:1：仙灵圆舞轨迹参数化——
 *  (((2π·t + π/2).ToRotationVector2() + (0,−1)) × (6·−dir, h)).RotatedBy(rot)。
 *  消费式 = velocity = P(t+Δ) − P(t)（纯相对增量,X 幅 6·dir、Y 幅 h,≤2.2px/tick）,
 *  ★非绝对定位（BJ434：绝对点直写=瞬移根因） */
function fairyCircleOffset(
  t: number, rot: number, h: number, dir: number,
): [number, number] {
  const a = Math.PI * 2 * t + Math.PI / 2;
  const x = Math.cos(a) * (6 * -dir);
  const y = (Math.sin(a) - 1) * h;
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x * c - y * s, x * s + y * c];   // RotatedBy（逆时针,屏幕 Y 向下=视觉顺时针）
}

/** GetBirdFlightRecommendation（NPC.cs:49206-49229）1:1：朝向列（tCoords.X += dir）
 *  向下探 downScanRange 格,首个实心/液体格——在 upRange 行内 → 建议上浮,否则下沉 */
function fairyBirdFlight(
  st: import('../world/TileStore').TileStore, dir: number,
  tx: number, ty: number, downRange: number, upRange: number,
): { down: boolean; up: boolean } {
  tx += dir;
  let down = true, up = false;
  for (let j = ty; j < ty + downRange && st.inBounds(tx, j); j++) {
    if (st.isSolid(tx, j) || st.liquid[st.idx(tx, j)] > 0) {
      if (j < ty + upRange) up = true;
      down = false;
      break;
    }
  }
  return { down, up };
}

/** 矿脉门矿种（TileID.cs:403 Ore ∩ TileID.cs:413 FriendlyFairyCanLureTo = 9 种）：
 *  金 8/铂 169/钴 107/钯 221/秘银 108/山铜 222/精金 111/钛 223/叶绿 211。NPC.cs:49257
 *  矿脉门只作用于 lure 预筛后的候选 ⇒ 门谓词 TileID.Sets.Ore[t] ≡ 此交集。
 *  ★IDG-T2 内部域平移（勿直查 data/tiles 裸 sheet 键表；推导锁见 tests/fairy-treasure） */
export const FAIRY_ORE_VEIN_SHEETS: ReadonlySet<number> = new Set([
  8, 169, 107, 221, 108, 222, 111, 223, 211,
]);

/** 宝箱/引导目标搜索（GetFairyTreasureCoords NPC.cs:49236-49295）：中心 ±75×±50 窗
 *  （钳世界缘 40，Main.maxTiles 四向 −40 收缩取交 :49245-49248），按优先级取最高
 *  （同优先取最近 :49280-49290）；矿石族（TileID.Sets.Ore∩lure 集=金/铂/钴/钯/
 *  秘银/山铜/精金/钛/叶绿 9 种）±3×±3 同类计数 ≥40 才有效（矿脉门 :49258-49278） */
export function fairyTreasureCoords(
  st: import('../world/TileStore').TileStore, cx: number, cy: number,
): [number, number] | null {
  const px = Math.floor(cx / 16), py = Math.floor(cy / 16);
  const x0 = Math.max(40, px - 75), x1 = Math.min(st.w - 41, px + 75);
  const y0 = Math.max(40, py - 50), y1 = Math.min(st.h - 41, py + 50);
  let bestPrio = -1, bestD = -1, bx = -1, by = -1;
  for (let i = x0; i <= x1; i++) {
    for (let j = y0; j <= y1; j++) {
      const idx = st.idx(i, j);
      const sheet = st.flags[idx] ? (TILE_DEFS[st.type[idx]]?.vanilla?.sheet ?? 0) : 0;
      if (!sheet || !FAIRY_LURE_SHEETS.has(sheet)) continue;
      if (!fairyOreFinderValid(sheet, st.frameX[idx])) continue;
      const prio = FAIRY_LURE_PRIORITY[sheet] ?? 0;   // 未列默认 0=有效候选（Main.cs:1486 零填充；旧 fallback −1 跳过式=偏离,Z3 修）
      if (prio < 0) continue;   // 表内无负值,防御位（原版 return num2!=−1 同语义）
      if (FAIRY_ORE_VEIN_SHEETS.has(sheet)) {
        // 矿脉门（NPC.cs:49258-49278）：±3×±3（7×7=49 格）同类计数<40 → num4=−1。
        // num2 初值 −1 ∧ 返回 num2!=−1 ⇒ num4=−1 等价移出候选（单块散矿不算宝藏,
        // 亦不被任何实候选压过；此处 continue 与原版赋 −1 逐结果等价）。
        // 搜索窗已钳世界缘 40 ⇒ 7×7 窗恒在界内,inBounds 守卫纯防御。
        let vein = 0;
        for (let k = i - 3; k <= i + 3; k++) {
          for (let l = j - 3; l <= j + 3; l++) {
            if (!st.inBounds(k, l)) continue;
            const i2 = st.idx(k, l);
            if (st.flags[i2] && (TILE_DEFS[st.type[i2]]?.vanilla?.sheet ?? 0) === sheet) vein++;
          }
        }
        if (vein < 40) continue;
      }
      if (bestPrio <= prio) {
        const d = Math.hypot(i * 16 + 8 - cx, j * 16 + 8 - cy);
        if (bestPrio !== prio || d < bestD) {
          bestPrio = prio; bestD = d; bx = i; by = j;
        }
      }
    }
  }
  return bx >= 0 ? [bx, by] : null;
}

/** 宝箱格当前是否仍有效（状态 5 的 :48905 失效门） */
export function fairyTreasureValidAt(
  st: import('../world/TileStore').TileStore, x: number, y: number,
): boolean {
  if (!st.inBounds(x, y)) return false;
  const idx = st.idx(x, y);
  const sheet = st.flags[idx] ? (TILE_DEFS[st.type[idx]]?.vanilla?.sheet ?? 0) : 0;
  return !!sheet && FAIRY_LURE_SHEETS.has(sheet) && fairyOreFinderValid(sheet, st.frameX[idx]);
}

/** WorldGen.SolidTile(i,j) 1:1（WorldGen.cs:70642-70663；BJ246 岩浆族死亡泼岩浆门
 *  谓词）——active∧tileSolid∧!tileSolidTop∧!halfBrick∧slope==0∧!inActive。SOLID_LUT
 *  域=tileSolid∩!tileSolidTop（平台九件套 19/239/380/427/435-439 原版双 true 被
 *  !tileSolidTop 排除,本仓 solid:false 已排除同构）。越界=原版 tile==null → true
 *  （:70646-70649,泼岩浆面=拒写;WeatherRenderer.solidTileExact 同式——entities 层
 *  不引 render/,亦不引 VanillaSpawner.worldSolidTile（其 import Enemy 成环）,局部
 *  同式+引注为既定先例）。 */
function npcSolidTile1457(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return true;
  const i = st.idx(x, y);
  if (st.flags[i] === 0 || (st.wire[i] & TileStore.WIRE_ACTUATED) !== 0) return false;
  return TileStore.SOLID_LUT[st.type[i]] === 1 && st.half[i] === 0 && st.slope[i] === 0;
}
