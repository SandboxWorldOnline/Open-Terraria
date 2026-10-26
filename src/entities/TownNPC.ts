// 城镇 NPC：游走、夜间回家、对话气泡
// 贴图 = 原版 Images/NPC_{id}（Terarria1456 素材条），帧语义按原版 FindFrame 城镇分支
// （NPC.cs:69152+）：地面站定=帧0；腾空=帧1；行走帧 2..frames-extra-1 循环
// （frameCounter += |vx|*2+1 每 tick，>6 推进一帧，越界回卷帧2）
import { Entity } from './Entity';
import { Tombstone } from './Tombstone';   // ★BJ562（2026-10-09）城镇死亡墓碑弹面
import type { GameHooks } from './types';
import type { Player } from './Player';
import { ENEMY_GRAVITY, MAX_FALL_SPEED, TILE } from '../core/constants';
import { moveAndCollide } from '../physics/TileCollision';
import { openDoor, closeDoor as closeDoorTile, shiftTallGate, doorKillCellOpts } from '../world/Door';
import { TILE_BY_KEY as TILE_BY_KEY_DOOR_TILES, TILE_DEFS, TILE_DUNGEON_SHEETS, AVOIDED_BY_NPCS_SHEETS, INTERACTABLE_BY_NPCS_SHEETS } from '../data/tiles';
import { TOWN_CRITTER_IDS } from '../data/critters';   // ★BJ704-G3 D7：TownCritter 集单源（NPCID.cs:4827）
import type { TileStore } from '../world/TileStore';
// ★BJ656：tileSolid 真表代理已收编进 TileStore.isVanillaTileSolid（平台九件套
// PLATFORM_SOLID2_SHEETS 同集,nactive() 门）——旧直查 GenSolid.VAN_TILE_SOLID_EXTRA
// 三站（臂B/坑口/walkPrediction）全部换道,本文件不再直引
import { TOWN_NPC_IDS, VANILLA_NPCS, vanillaSoundFiles } from '../data/vanillaNpcs';
import { isNpcTownShimmerable, isNpcShimmerImmune, findShimmerFreeSpot } from '../stats/Shimmer';
import { townNpcAltTexture, townNpcProfileSheet, shouldBestiaryGirlBeLycantrope } from '../data/townNpcProfiles';
import { getAttackDamageForTownNPC, mainDifficulty } from '../stats/ScaleStats';
// ★蓝队 F2：互殴首击 Main.DamageVar 单源（Main.cs:67097 ±15% 31 档 + 银行家舍入）
import { damageVarRoll } from '../stats/DamageVar';
// ★2026-09-01 F11：树妖煞 DoT dps 专用进度链单源（NPC.cs:92898-92963，
// 与 AI_007 自卫攻击链 NPC.cs:53400-53557 是两条链——旧码误接见消费点注）
import { getDryadsBaneDamagePerSecond } from '../stats/DryadsBane';
import { hslToRgb } from '../player/Appearance';
import { newNpcName } from '../i18n/RandomText';
import { canHit } from '../physics/LineOfSight';
import { canHitLine } from '../physics/LineOfSight';
// ★2026-08-31 对齐批：AI_007 Center 点对通道（危险扫描 :54030 / 入态重验
// :56019-56026 / 挥击退出链 :55649-55658 的字面 CanHit(Vector2,0,0,…))
import { canHitPoint } from '../physics/LineOfSight';
import { getSwingStatsAnchor, tweakSwingStats } from './townNpcSwing';
import { npcCheckArmorPenetration, applyBuffTicks } from './projStatus';
import { drownCollision } from '../stats/TouchDamage';
// ★2026-08-31 治理批 B1：危险扫描候选记录门（NPC.cs:54042 flag19 = CanBeChasedBy）
import { canBeChasedBy, ON_HIT_EXCLUDED_PROJS } from './projTargets';
import { projSprite } from './Arrow';
import { updateNpcLiquid, wetCollision, lavaCollision } from './npcLiquid';
import { spawnEmote } from '../render/EmoteBubble';
import { pickNpcEmote } from '../world/EmotePick';
import {
  TOWN_ATTACK_TIME, TOWN_ATTACK_CHANCE, TOWN_ATTACK_TYPE, TOWN_DANGER_RANGE,
  TOWN_MELEE, TOWN_BOW, TOWN_MAGIC, TOWN_SWING, TOWN_PRETTY_SAFE,
  type TownShotParams,
} from '../data/vanillaTownAttack';
import { TownShot, PrincessAuraShot, DryadWardRingShot } from './TownShot';   // SW-BJ33 2026-09-08：663 魔法阵专类；★BJ256 2026-09-21：20 净化脉冲专类
// ★对抗修复批⑤ A4：出膛锚点半宽/半高按弹真实 SetDefaults 尺寸换算
import { projectileData } from '../data/vanillaProjectiles';
// ★通用湿段（2026-09-08 F2）：NurseSyringeShot 584 override 自接（基类位被替代）
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { resolveDrops, npcValueOf, dropVelocity, type NpcDropCtx } from '../drops/NpcDrops';
import { VANILLA_ITEM_KEY_BY_ID } from '../data/items';
import { ParticleOrchestraType } from '../net/syncModules';
import { RNG } from '../core/rng';
import { visEffectFrames, mouseTextColorApprox, CHECK_ACTIVE_HALF_X, CHECK_ACTIVE_HALF_Y, type Enemy } from './Enemy';
// ★BJ704-G6 D12：行走预测共享叶子（walkPrediction 本体已迁出,见下方 re-export 注）
import { walkPrediction, HOME_DRIFT_RANGE } from './npcWalkPrediction';
import { spawnVanillaEnemy } from './bossAI';
import { spawnWOF } from './bossAI_wof';   // ★BJ574：checkDead case 22 向导浸浆死召唤链
import { newLovestruckHeart, GorePiece } from './GorePiece';   // ★清偿刀 F：Lovestruck 头爱心 331 单源（城镇/敌怪共用,GorePiece.ts 尾）;★BJ592：case 11 困盹臭气团 580-582 发射面
import { Lang } from '../i18n/Lang';
import { BuffType } from '../stats/Buffs';
import { COMBAT_TEXT_DAMAGED_FRIENDLY, COMBAT_TEXT_DAMAGED_FRIENDLY_CRIT } from '../fx/CombatTextColors';
import { runModOnHitAny, runModOnNpcHitByAny, runModOnNpcDeath, runModOnKillAnyNpc, runModNpcIncomingHit } from '../mods/hooks';   // ★D20-m5:城镇 NPC 受击/击杀派发;★R-B-F4:承伤值链

// ---- 本文件随机源约定（★2026-08-31 治理批 F8 定案）----
// 运行时「行为」掷骰一律走实例注入面 this.rng()（测试 stub 后构造/回放的 NPC 同样
// 受控）。Math.random() 直呼仅限下列【演出/观感】豁免成员——它们不进确定性口径：
//   - townNpcDeathDrops 掉落种子（new RNG((Math.random()*0x7fffffff)|0)：城镇死亡
//     掉落一次性演出，无重播需求，见该方法注）
//   - lightRGB 光源数值抖动（160/209/681 AddLight / 683 相位，纯光照）
//   - shimmerRiseUpdate 微光演出尘（308/309/ShimmerBlock 视觉）
//   - tipsy 醉酒金尘（:92349 气泡视觉）
//   - lovestruck 头爱心 gore 331（:92455-92466 视觉掷,2026-09-29 刀B 批——
//     Main.rand.Next(5)==0 门 + 爱心位/速/档三掷,纯演出;★清偿刀 F 单源化:
//     Math.random 现居 GorePiece.newLovestruckHeart,城镇/敌怪共用）
//   - __DOORDBG 诊断插桩采样门（永久旗控调试面）
// 战斗/状态机判定掷骰（巫师连发表与散布/开门 Next(10)/随机坐椅 rand(300)/社交链/
// 入攻击态掷门等）一律禁直呼 Math.random。
//
// ---- 本文件色值约定（★2026-08-31 治理批 F9 定案）----
// 「飘字/对话文本」类色值一律单源自 fx/CombatTextColors（CombatText.cs 1:1）：
//   DamagedFriendly '#FF505A' / DamagedFriendlyCrit '#FF641E'（hurt 受击飘字）/
//   HealLife '#64FF64'（医师治疗弹/溺死致死链的绿字,CombatText.cs:13）。
// 豁免清单成员（非文本域,保留字面）——尘粒/演出 tint 族：受击血尘 #B01818、
// 死亡血爆 #C03030/#8A1818、醉酒金尘 rgba(245,200,30,…)、微光演出 #BFE8FF/
// #C9C2FF 与到场粒子 #BEAFFF/#BEF5FF/#FF96FF、侦察弹兜底填充 #D8C8A0；
// 以及上文随机源豁免五件的伴随视觉面。[本仓视觉添加] 标注 = 原版无此视觉件
// （如溺水 −2 的观感飘字,NPC.cs:96118-96154 为静默扣血）。

export interface NpcHome { x: number; y: number; }

/** NPCID.Sets.IsTownPet（NPCID.cs:4446）全表：猫 637/狗 638/兔 656/蓝城镇史莱姆
 *  670/城镇史莱姆族 678-684——死亡公告走 "{0} has left!" 便（checkDead :78951-78955） */
const NPC_IS_TOWN_PET = new Set([637, 638, 656, 670, 678, 679, 680, 681, 682, 683, 684]);

// ===================== 坐姿（AI_007 ai[0]==5）纯函数 =====================
// 可坐格族 = TileID.Sets.CanBeSatOnForNPCs（TileID.cs:211）恰好 {15 椅, 497 马桶}
// ——王座(102)/长凳(89) 只在 CanBeSatOnFor*Players* 集，城镇 NPC 不坐；
// 按 sheet 反查内部 tile id（LiquidSim bySheet 同款 reduce）
const sheetTileIds = (sheets: ReadonlySet<number>): ReadonlySet<number> => new Set(
  TILE_DEFS.reduce<number[]>((acc, d, id) => {
    if (d.vanilla && sheets.has(d.vanilla.sheet)) acc.push(id);
    return acc;
  }, []),
);
const CHAIR_TILE_IDS = sheetTileIds(new Set([15]));
const TOILET_TILE_IDS = sheetTileIds(new Set([497]));
/** 不坐椅的城镇实体（FindGoodRestingSpot :53214：type 638 狗 / 656 兔宠物 +
 *  IsTownSlime 族 NPCID.cs:4446 = 670/678-684——它们只在地面休息位趴窝） */
const NO_SIT_NPC_IDS = new Set([638, 656, 670, 678, 679, 680, 681, 682, 683, 684]);
/** NPCID.Sets.IsTownPet（NPCID.cs:4444）：637 猫/638 狗/656 兔 + 城镇史莱姆族
 *  （IsTownSlime 670/678-684 ⊂ IsTownPet）——无 CanTalk（不发起聊天/RPS/舞/
 *  发呆）。（★对抗修复批①2026-09-01：sitFlag 回家门/避坠豁免已拨正为消费
 *  TownCritter 集,见下方 VANILLA_TOWN_CRITTER_SHEETS;本集保留社交类真实消费位） */
const IS_TOWN_PET = new Set([637, 638, 656, 670, 678, 679, 680, 681, 682, 683, 684]);
/** NPCID.Sets.TownCritter（★蓝队A-F1：NPCID.cs:4827 行原文全量抄录，2026-09-01）。
 *  ★与 IsTownPet 是两个不同的集：宠物(637/638/656 等)不在本集、野生小动物不在
 *  IsTownPet。AI_007 的回家双臂(:54198/:54320 `!TownCritter[type]` 门)与
 *  GetWalkPrediction 避坠豁免(:56120-56123)消费的是【本集】——此前误用 IS_TOWN_PET
 *  使家化宠物不回家且恒放弃避坠判定；拨正后宠物恢复回家/避坠，两消费面不动
 *  NO_SIT_NPC_IDS / 聊天等真实 IsTownPet 位。
 *  ★BJ704-G3 D7（2026-10-21）：表体抽至 src/data/critters.ts TOWN_CRITTER_IDS
 *  单源（Enemy 侧 townCritterWalkAI 三闸/夜间即停支同集消费,防双副本漂移）,
 *  本别名保留既有消费面（含 tests/townnpc-*） */
export const VANILLA_TOWN_CRITTER_SHEETS: ReadonlySet<number> = TOWN_CRITTER_IDS;
/** NPCID.Sets.IsTownSlime（NPCID.cs:4446）——站定态湿身强制走动门（真锚
 *  cs:54171-76；★对抗修复批⑤ A11 行号考古：旧注 ":54047-4054" 系错引） */
const SLIME_TOWN_IDS = new Set([670, 678, 679, 680, 681, 682, 683, 684]);
/** AI_007 flag7（cs:54001 `type==300||447||610`）：啮齿族特化——两格高墙折返臂
 *  （cs:54657-64）与湿跳 ×1.2 豁免面（cs:54751-55）。三型按字面抄录 */
const TOWN_FLAG7_IDS = new Set([300, 447, 610]);

/** FindGoodRestingSpot 扫描期成员判定（:53223 CanBeSatOnForNPCs，无 style 门——
 *  style 门在 TryForcingSitting，见 canSitAt） */
export function isSitTile(tileId: number): boolean {
  return CHAIR_TILE_IDS.has(tileId) || TOILET_TILE_IDS.has(tileId);
}

/** AI_007_TryForcingSitting 坐下门（NPC.cs:53269-53275）：椅/马桶格 + 椅子
 *  style 27 排除（type 15 且 frameY∈[1080,1098]——上格 1080 / 下格 1098 两帧
 *  恰好夹住该样式行带；马桶无此门） */
export function canSitAt(tileId: number, frameY: number): boolean {
  if (TOILET_TILE_IDS.has(tileId)) return true;
  if (!CHAIR_TILE_IDS.has(tileId)) return false;
  return frameY < 1080 || frameY > 1098;
}

export interface SitSpot { x: number; y: number; }

/** AI_007_FindGoodRestingSpot 夜椅扫描（NPC.cs:53195-53262）：
 *  - 自 home 向下找地面（SolidOrSlopedTileOrPlatform = 实心非 top ∪ Platforms
 *    七件，:53335-53343；旧注 ":53186" 系错引，BJ657 勘误）
 *  - ±7 列 × 行 {+2,0,-2,-4,-6}（num2/num4/num3/num6）扫可坐格；上格(frameY%40==0)
 *    仅当 row+1<=floorY+2 收（:53224），下格恒收
 *  - 取 |dx|+|dy| 最小（严格 <，先到先得，:53226-53233）
 *  - 归一（:53247-53252）：下格(frameY%40!=0)先 -1 再 +2、上格直接 +2 → 返回
 *    {x, y}=落座地面行（椅上格 +2 = 地面行）。无椅 → null（白天原版直接返回
 *    home 地面（:53209-53212），由调用方不调本扫描） */
export function findChairSpot(st: TileStore, homeX: number, homeY: number): SitSpot | null {
  let fx = homeX, fy = homeY;
  if (fx < 0 || fy < 0) return null;                       // :53200-53203 home 无效
  // ★BJ657（2026-10-12）地板下探谓词换道 isSolidOrSlopedTileOrPlatform（原版
  //  SolidOrSlopedTileOrPlatform :53335-53343,唯一消费面 :53352 同式收编）——
  //  旧 isSolid∪isPlatform 多计 {239,380}+家具顶 84 件（BJ656 登记债 D1）：
  //  家具顶不是地板,下探在家具顶提前停=假地板,须穿透至真实地面行
  while (fy < st.h - 20 && !st.isSolidOrSlopedTileOrPlatform(fx, fy)) fy++;
  let best: { x: number; y: number; d: number; frameY: number } | null = null;
  for (let i = fx - 7; i <= fx + 7; i++) {
    for (let r = fy + 2; r >= fy - 6; r -= 2) {
      if (!st.inBounds(i, r)) continue;
      const ti = st.idx(i, r);
      // ★幽灵保域（2026-09-03）：active() 门补 flags bit0（原版 NPC.cs:53377
      //  `tile.active() && TileID.Sets.CanBeSatOnForNPCs[…]`）——幽灵椅残型不可坐
      if (st.type[ti] === 0 || (st.flags[ti] & 1) === 0 || !isSitTile(st.type[ti])) continue;
      const topFrame = st.frameY[ti] % 40 === 0;
      if (topFrame && !(r + 1 <= fy + 2)) continue;        // :53224
      const d = Math.abs(i - fx) + Math.abs(r - fy);       // :53226
      if (!best || d < best.d) best = { x: i, y: r, d, frameY: st.frameY[ti] };
    }
  }
  if (!best) return null;                                  // :53255-53257
  let ry = best.y;
  if (best.frameY % 40 !== 0) ry--;                        // :53249-53251 下格 → 上移一行
  ry += 2;                                                 // :53252 → 地面行
  return { x: best.x, y: ry };
}

/** 坐姿朝向（:53284 / PlayerSittingHelper.cs:231 同式）：frameX!=0（椅 flip 档
 *  +18）→ 1 朝右，否则 -1 朝左 */
export function chairFacing(frameX: number): number {
  return frameX !== 0 ? 1 : -1;
}

/** 坐姿锚（:53285-53286）：Bottom = (x*16 + 8 + 2*dir, y*16)——脚底贴地面行顶，
 *  比玩家坐姿（PlayerSittingHelper 座面上 16px）更低，即原版城镇 NPC"陷坐"观感 */
export function sittingAnchor(x: number, y: number, dir: number): { x: number; y: number } {
  return { x: x * TILE + 8 + 2 * dir, y: y * TILE };
}

/** 入座时长（:53283）：ai[1] = 900 + rand(10800) */
export const SIT_TIME_BASE = 900;
export const SIT_TIME_RAND = 10800;
/** 时限起身后的转向冷却（:54707 localAI[3] = 30 + rand(60)；本仓由 turnLock 承接） */
export const SIT_STAND_WANDER_BASE = 30;
export const SIT_STAND_WANDER_RAND = 60;

/** 坐姿帽 Y 修正链 num6（Main.cs:26965-26987：ai[0]==5 时默认 −4，例外表如下；
 *  550/588 原版显式列 −4 = 默认值，不重复入表） */
export const SITTING_HAT_OFFSET_Y_DEFAULT = -4;
export const SITTING_HAT_OFFSET_Y: Record<number, number> = {
  38: -8, 124: -2, 108: -6, 178: -6, 637: -12, 663: -8,
};
/** 坐姿帽 Y 修正取值（Renderer.drawPartyHat 消费） */
export function sittingHatY(id: number): number {
  return SITTING_HAT_OFFSET_Y[id] ?? SITTING_HAT_OFFSET_Y_DEFAULT;
}

// ===================== 攻击/坐姿帧带基准（FindFrame NPC.cs:69320 num58 族）=====================
/** NPCID.Sets.AttackFrameCount（NPCID.cs:4833，默认 0）。num58 =
 *  npcFrameCount − AttackFrameCount（NPC.cs:69320）——坐姿帧 num58−3
 *  （:69637-69643）、攻击帧 num58..num58+3（:69765-69847）、聊天/表演帧
 *  num58−1..−5 族全部以它为带基 */
export const TOWN_ATTACK_FRAME_COUNT: Record<number, number> = {
  17: 4, 18: 4, 19: 4, 20: 2, 22: 5, 37: 0, 38: 4, 54: 2, 107: 4, 108: 2,
  124: 4, 142: 4, 160: 2, 178: 4, 207: 4, 208: 4, 209: 5, 227: 4, 228: 5,
  229: 5, 353: 4, 633: 4, 368: 5, 369: 4, 453: 4, 441: 4, 550: 4, 588: 4,
  663: 2, 637: 0, 638: 0, 656: 0, 670: 0, 678: 0, 679: 0, 680: 0, 681: 0,
  682: 0, 683: 0, 684: 0,
};

/** num58（NPC.cs:69320）：frames = vanilla-npcs.json frames（= Main.npcFrameCount） */
export function townNpcBaseFrame(vanillaId: number, frames: number): number {
  return frames - (TOWN_ATTACK_FRAME_COUNT[vanillaId] ?? 0);
}

/** GetShootingFrame（NPC.cs:67061-67083）1:1：弓态瞄准帧偏移——ai[2]（= holdAim，
 *  钳 ±0.5）走原版**顺序 if 链**：<−0.3 置 1 恒被 <−0.1 置 0 覆写（原版死分支，
 *  实际档位 = <−0.1→0 / [−0.1,0.1]→−4 / >0.1→2 / >0.3→3）；枪族五人
 *  {22 向导,209 电子人,228 巫医,229 海盗,368 游商}再 +1 档移（−4→1、≥−0.1 再 +1） */
export function shootingFrameOffset(vanillaId: number, aimY: number): number {
  let n = -4;
  if (aimY < -0.3) n = 1;
  if (aimY < -0.1) n = 0;
  if (aimY > 0.1) n = 2;
  if (aimY > 0.3) n = 3;
  if (vanillaId === 228 || vanillaId === 229 || vanillaId === 209
    || vanillaId === 22 || vanillaId === 368) {
    if (n === -4) n = 1;
    if (aimY >= -0.1) n++;
  }
  return n;
}

// ===================== shimmerTransparency（NPC.cs:6112，0..1）=====================
// ★锚行校准（1457）：UpdateNPC_BuffApplyVFX 内赋值区 = :92631-62（非 :92469 系——
// 那是 UpdateNPC 尾段沾液尘/松露人 case 的行带）；上升态 −1/60 = AI_007 :53770。
export const SHIMMER_ST_RAMP = 0.01;      // shimmering（buff 353 在身）+0.01/t（:92634-36）
export const SHIMMER_ST_TRANSFORM = 0.9;  // >0.9 触发 GetShimmered（:92637-39）
export const SHIMMER_ST_RISE = 0.89;      // 城镇转化置 0.89（:92705，GetShimmered 支）
export const SHIMMER_ST_DECAY_RISE = 1 / 60;  // ai[0]=25 上升态 −1/60/t（:53770）
export const SHIMMER_ST_DECAY_HIT = 0.1;      // justHit −0.1/t（:92650）
export const SHIMMER_ST_DECAY_IDLE = 0.001;   // buffImmune[353] else 支 −0.001/t（:92658）
export const SHIMMER_ST_DECAY_IMMUNE = 0.015; // buffImmune[353] 免疫快档 −0.015/t（:92652-54）
export const SHIMMER_BUFF_TICKS = 100;        // buff 353 施加时长（AddBuff(353,100) :94214/:29457）
export const SHIMMER_BUFF_REAPPLY_LOW = 10;   // TryAddingRepeatedBuff lowThresholdUndeathToAllowBuff（:94211）

/** shimmerTransparency 每 tick 推进（赋值时序 NPC.cs:92631-46 浸位 + :92646-62
 *  衰减位 + AI 上升块 ：53765-76）：
 *  shimmering（=buff 353 在身，UpdateNPC_BuffSetFlags 扫 buffType==353 → 置位
 *  :93255-93264；施加源 = 浸液 TryAddingRepeatedBuff(:94211-18，调用点 :94446-56)
 *  与微光枪弹 1042 命中 AddBuff(353,100)（AI_060 :29456-29458）——【非】液体直读）
 *  +0.01 cap 1（rise 态抑制——GetShimmered 已摘除 buff 353（:92706-10），
 *  上升态内 shimmering 恒 false，st 走 −1/60 衰减）；非浸两独立位同 tick 叠加：
 *  justHit −0.1 位 + buffImmune[353] −0.015 / else −0.001 位（:92650-58，先减
 *  justHit 再走免疫/常规档），下限 0。>0.9 的转化触发由调用方判（见 fixedUpdate
 *  微光块）。★immune 载体 = NPCID.Sets.ShimmerImmunity（:17870，经
 *  stats/Shimmer.isNpcShimmerImmune）——2026-09-03 登记未接清偿（旧「无载体恒走
 *  else −0.001、justHit 档独占」单档模型退役，justHit 档现叠加常规 −0.001 伴位）。
 *  ★[MAJOR-F4]（红队 R1 2026-09-03）：第二参语义钉死为「buff 353 在身」——
 *  ramp【不要求浸在池中】（:92634 只读 shimmering 位），出池后 buff 余量期 ramp
 *  照常推进；旧「中心格液体直读」采样源在调用方退役 */
export function shimmerTransparencyNext(
  st: number, shimmering: boolean, justHit: boolean, rise: boolean,
  shimmerImmune = false,
): number {
  if (shimmering && !rise) return Math.min(1, st + SHIMMER_ST_RAMP);
  let st2 = st;
  if (justHit) st2 -= SHIMMER_ST_DECAY_HIT;                    // :92650
  if (rise) st2 -= SHIMMER_ST_DECAY_RISE;                      // −1/60 AI 上升块并入（运行时 rise 支由 shimmerRiseUpdate 独立推进）
  else if (shimmerImmune) st2 -= SHIMMER_ST_DECAY_IMMUNE;      // :92652-54
  else st2 -= SHIMMER_ST_DECAY_IDLE;                           // :92656-58
  return Math.max(0, st2);
}

/** 消费①：本体渐显/渐隐（GetAlpha NPC.cs:94874-94878：CurrentlyShimmerTransparent
 *  → 四通道 ×(1−shimmerTransparency)；Renderer 本体 alpha 用） */
export function shimmerBodyAlpha(shimmerTransparency: number): number {
  return 1 - shimmerTransparency;
}

/** 消费②：160 松露人微光态 Glow RGB 衰减（Main.cs:25770-25776：case 160 专属，
 *  209 无此档）——'lighter' 加性混合下 tint RGB ×(1−st) ≡ alpha ×(1−st) */
export function shimmerGlowAlpha(baseAlpha: number, shimmerTransparency: number): number {
  return shimmerTransparency > 0 ? baseAlpha * (1 - shimmerTransparency) : baseAlpha;
}

// ===================== ai[0]=25 微光上升态（NPC.cs:53737-53820；入态 =
// GetShimmered ShimmerTownTransform 支 :92695-92711——★1457 锚行校准，非 :53594
// 系/:92562 系旧 1456 行带）=====================
export const SHIMMER_RISE_VELOCITY_TICK = 30;   // ai[1]≥30 起 st 衰减 + 上浮速度（:53765-76）
export const SHIMMER_RISE_END_TICK = 75;        // ai[1]≥75 且 st≤0 → 转化收尾（:53801）
export const SHIMMER_RISE_PAUSE = 30;           // 远距落点后 ai[2]=30 暂停（:56141）
export const SHIMMER_RISE_TELEPORT_DIST = 560;  // 落点位移 ≥560px 才暂停+发送粒子（:56138）

/** Utils.Remap（Utils.cs:313，clamped 默认 true）：fromMin..fromMax 归一后
 *  线性映到 toMin..toMax（区间外钳端值） */
export function remapClamped(
  v: number, fromMin: number, fromMax: number, toMin: number, toMax: number,
): number {
  const t = fromMax === fromMin ? 0 : (v - fromMin) / (fromMax - fromMin);
  return toMin + (Math.max(0, Math.min(1, t))) * (toMax - toMin);
}

/** Main.IsItStorming（Main.cs:2978 = _shouldUseStormMusic；UpdateWindyDayState
 *  :12927-12960 迟滞机，阈值 _minWind 0.34/_maxWind 0.4/_minRain 0.4/_maxRain
 *  0.5 见 Main.cs:66137-66140）逐步推进的纯函数：无云恒 false；低雨/低风翻
 *  false；高雨(≥0.5)+强风(|w|≥0.4) 翻 true；中间带保持前值（迟滞）。带 prev
 *  逐步喂入 ≡ 原版每帧重算的全局字段。remixWorld 强制 false 分支本仓无 remix 世界 */
export function isItStormingNext(cloudAlpha: number, windSpeedTarget: number, prev: boolean): boolean {
  if (cloudAlpha === 0) return false;
  if (cloudAlpha < 0.4 || Math.abs(windSpeedTarget) < 0.34) return false;
  if (cloudAlpha >= 0.5 && Math.abs(windSpeedTarget) >= 0.4) return true;
  return prev;
}

// ===================== 游走拴绳常量（AI_007 NPC.cs:54135-54281）=====================
/** 走速上限 num22（:54280）与加速 num23（:54281）——城镇 NPC 常态档 */
export const WALK_SPEED = 1.0;
export const WALK_ACCEL = 0.07;
/** 逃速档（:54322-54326）：num22 = 1.5+失血比例×0.9 / num23 = 0.1 */
export const FLEE_SPEED_BASE = 1.5;
export const FLEE_HURT_FACTOR = 0.9;
export const FLEE_ACCEL = 0.1;
/** 走态走程入态 ai[1] = 200+Next(300)（:54146/:54245/:54409） */
export const WALK_LEG_BASE = 200;
export const WALK_LEG_RAND = 300;
/** 停态停程入态 ai[1] = 300+Next(300) 后按 critter 双分支 −Next(100)/+Next(900)
 *  （★对抗修复批⑤ A11 行号考古 + A10：真锚 cs:54377-54390 走→停换态,
 *  旧注 ":54232-54242" 系错引——:54241 一带是站定回家走臂的 200+Next(200)） */
export const STOP_LEG_BASE = 300;
export const STOP_LEG_RAND1 = 300;
export const STOP_LEG_RAND2 = 900;
/** 走→停换态 critter 臂第三掷跨度（cs:54384-85 `ai[1] -= Next(100)`） */
export const STOP_LEG_RAND_CRITTER = 100;
/** 拴绳（:54169-54188）：|myX−homeX|>25 出软界（随机转身 rand(80) 只在此内掷，
 *  命中锁 localAI[3]=200）；>50 同向 → 强制折返 */
export const LEASH_SOFT = 25;
export const LEASH_HARD = 50;
export const LEASH_TURN_CHANCE = 80;
export const LEASH_TURN_LOCK = 200;
/** 背离 home 超 ±35 格且方向背家 → 停程倒计时额外 −5/t（:54220-54231）
 *  ——★BJ704-G6 D12：常量本体迁 npcWalkPrediction.ts 共享叶子（walkPrediction
 *  家域豁免带同值同源）,此处 re-export 保既有消费面 */
export { HOME_DRIFT_RANGE } from './npcWalkPrediction';
export const HOME_DRIFT_TICK = 5;
/** 到家站定入停态 ai[1] = 200+Next(200)（★对抗修复批⑤ A11 行号考古：真锚
 *  cs:54241-43 站定回家未到走臂 / cs:54353-56 行走到家刹停入停,旧注
 *  ":54100/:54195" 系错引） */
export const REST_LEG_BASE = 200;
export const REST_LEG_RAND = 200;
/** 站定态起身走程（湿畜 :54196-54198 = 200+Next(500,700) = **700..899**；
 *  常态 :54146/:54253/:54305 = 200+Next(300)）
 *  ★对抗修复批①2026-09-01：BASE 由 200 拨正 700——旧注释把跨度 Next(500,700)
 *  读成了总值 200，致湿史莱姆起身只走 1/4 程就转停态 */
export const RISE_LEG_WET_BASE = 700;
export const RISE_LEG_WET_RAND = 200;   // Next(500,700) 跨度 200 → BASE+[0..199]

/** 回家传送视野门（:53830-53836）：NPC.sWidth=1920 / sHeight=1200（:6695/:6697）
 *  + safeRange = (dim/16)×0.52 截断（:6090-6092 → 62/39）。玩家盒与 NPC 位/home 位
 *  两个矩形任一相交 → 不可见（传送取消） */
export const TP_SCREEN_W = 1920;
export const TP_SCREEN_H = 1200;
export const TP_SAFE_X = Math.trunc((TP_SCREEN_W / 16) * 0.52);   // 62
export const TP_SAFE_Y = Math.trunc((TP_SCREEN_H / 16) * 0.52);   // 39

/** Main.tileDungeon 表（Main.cs:8131-8136 字面全集）：地牢砖族 {41,43,44}+
 *  古砖 {677,678,679}。回家传送触发的守卫老人备用臂——`type==37 && tileDungeon[
 *  脚格]` 时无视昼夜/天气旗直接参与「不在驻地→拽回」（NPC.cs:53973 OR 臂）。
 *  集合按本仓 tile 域物化：遍历 TILE_DEFS 以 vanilla.sheet 归一，免引 Housing.sheetOf */
const VANILLA_DUNGEON_SHEETS = TILE_DUNGEON_SHEETS;   // Main.tileDungeon（★BJ187 单源 data/tiles.ts）
const VANILLA_DUNGEON_TILES = (() => {
  const s = new Set<number>();
  for (let t = 1; t < TILE_DEFS.length; t++) {
    if (TILE_DEFS[t]?.vanilla && VANILLA_DUNGEON_SHEETS.has(TILE_DEFS[t].vanilla!.sheet)) s.add(t);
  }
  return s;
})();

/** TileID.Sets.AvoidedByNPCs（TileID.cs:377，旧注 :373 系行号漂移）：SearchAvoidedByNPCs
 *  谓词底表——★BJ221 收编单源 data/tiles.ts:AVOIDED_BY_NPCS_SHEETS（转出口别名,§6k） */
export const AVOIDED_BY_NPC_SHEETS = AVOIDED_BY_NPCS_SHEETS;
/** TileID.Sets.InteractableByNPCs（TileID.cs:379，旧注 :375 系行号漂移）：驻足看家具
 *  （ai[0]==9）格门——★BJ221 收编单源（转出口别名,§6k） */
export const INTERACTABLE_BY_NPC_SHEETS = INTERACTABLE_BY_NPCS_SHEETS;

/** TileID.Sets.AvoidedByNPCs / InteractableByNPCs 的本仓 tile id 空间版
 *  （vanilla.sheet 反查，LiquidSim bySheet 同款） */
const AVOIDED_BY_NPC_TILES = sheetTileIds(AVOIDED_BY_NPC_SHEETS);
const INTERACTABLE_BY_NPC_TILES = sheetTileIds(INTERACTABLE_BY_NPC_SHEETS);

/** Collision.DrownCollision 共用移植归一在 stats/TouchDamage.ts（★蓝队 F4①，
 *  2026-09-01）：本文件旧副本退役。选【抽公共函数】而非复制+双注——消费面已有
 *  三处（Player :23379 / Enemy AI_007 / 本文件五调用面），旧双副本已各自漂移过
 *  一次（本副本 st.isSolid 带 nactive() 致动闸,缺 L1「纯在场」核正;缺 solidTop
 *  族豁免;includeSlopes 只有单侧有）,单源杜绝再漂。
 *  签名 = 原文序 (st, x, y, w, h, gravDir, includeSlopes=false)
 *  （Collision.cs:1385 `DrownCollision(…, float gravDir = -1f, bool includeSlopes = false)`;
 *  本域五调用面全 gravDir=1,includeSlopes 逐一对号 NPC.cs 原文——
 *   - walkPrediction 落点没顶检验 :56311 → 缺省 false;
 *   - fixedUpdate 逃速 flag21 :54361 → true;
 *   - idle 起身 currentlyDrowning3 :54285 → true（外伞 `wet && !flag11` 在调用方）;
 *   - 行走态 flag21 同源面 :54361 → true（无 wet 门）;
 *   - CheckDrowning :96058 → 缺省 false。
 *  几何要点（10×12 头部探针/中心项整数除/降面水位/首行实心排除/lava+shimmer
 *  不计/includeSlopes blockType 臂）见 TouchDamage.drownCollision 注。
 *  ★无 wet 锁存依赖——传送落水首拍即计；带 wet 外伞的是 idle 起身支。 */
export { drownCollision };

// ===================== 敌怪互殴准入/几何表（GetHurtByOtherNPCs 通道）=====================

/** 互殴攻击者最小形状（Enemy 运行时面 + ai2/facing 档位） */
export interface MeleeAttackerLike {
  x: number; y: number; w: number; h: number;
  vanillaId?: number;
  facing?: number;       // ≈ spriteDirection/direction（±1）
  ai2?: number;          // 原版 ai[2]（咬合态计时）
  damage?: number;
  def?: { damage?: number };
  dead: boolean;
}

/** NPCID.Sets.CritterThatCanTurnOnPlayers（NPCID.cs:4781，十型）：互殴受击准入
 *  排除面——攻击者命中支直判 :93573（致变体 aiStyle==3 的【自身】门 ：93560 对
 *  城镇 NPC 恒假,无载体）。 turtle(639-645)/蜥蛙(299)/企鹅(538/539) 族接触
 *  【不再】误伤城镇 NPC */
export const CRITTERS_TURN_ON_PLAYERS = new Set([645, 639, 644, 642, 643, 641, 640, 299, 539, 538]);

/** NPCID.Sets.HurtingBees（NPCID.cs HurtingBees 集）：第二遍 GetHurtByOtherNPCs
 *  （:91601-03）受理集——蜂类攻击者 */
export const HURTING_BEES = new Set([210, 211]);

/** NPCID.Sets.Skeletons（NPCID.cs:4865）：受害 self==453 骷髅商人特判引用
 *  （:93579 `(type != 453 || !Skeletons[nPC.type])` 字面） */
export const SKELETON_IDS = new Set([77, 449, 450, 451, 452, 481, 201, 202, 203, 21,
  324, 110, 323, 293, 291, 322, 292, 197, 167, 44, 635]);

/** GetMeleeCollisionData（NPC.cs:96111-96290）互殴通道变形盒——只接本域有载体的族：
 *  - 430-436 持械僵尸六兄弟 / 591 持械火把僵尸：咬合态 ai[2]>5 时武器侧加宽
 *    （spriteDirection<0 → X−34 且 W+34，否则仅 W+34）(:96117-96133)；
 *  - 494/495 龙虾（Crawdad）：同式 ±18px (:96134-96146)；
 *  - 460 屠夫：冲刺刀击专盒 30×14（X=Center.X、<0 时 X−=W；Y=feet−20），与受害盒
 *    相交时整体替换 (:96152-96169)，不相交保持原盒；
 *  - type 400：npcRect=default → 恒不交（返回 null）(:96147-96151)。
 *  ★乘区注意：damageMultiplier/specialHitSetter 在 GetHurtByOtherNPCs 消费点是
 *  【死参】——ref 写回后弃置，BeHurtByOtherNPC 直用 Main.DamageVar(thatNPC.damage)
 *  （:93595）；此处严禁给伤害补 ×1.25/×1.35。
 *  未列族（417 独眼旗手/466 精神病屠夫/552-554 DD2 巨龙箱头目/576-577 蜂王魔像/
 *  668 月总 发射端 frameY 支）为玩家挥击通道专属窗面或本域无载体，缺席即原盒。 */
export function meleeAttackRect(
  e: MeleeAttackerLike, vx: number, vy: number, vw: number, vh: number,
): { x: number; y: number; w: number; h: number } | null {
  const t = e.vanillaId ?? -1;
  const facing = e.facing ?? 1;
  if ((t >= 430 && t <= 436) || t === 591) {
    const bite = (e.ai2 ?? 0) > 5;                       // :96116 `ai[2] > 5f`
    return bite ? { x: e.x - (facing < 0 ? 34 : 0), y: e.y, w: e.w + 34, h: e.h }
      : { x: e.x, y: e.y, w: e.w, h: e.h };
  }
  if (t === 494 || t === 495) {
    const bite = (e.ai2 ?? 0) > 5;
    return bite ? { x: e.x - (facing < 0 ? 18 : 0), y: e.y, w: e.w + 18, h: e.h }
      : { x: e.x, y: e.y, w: e.w, h: e.h };
  }
  if (t === 400) return null;                            // npcRect = default(Rectangle)
  if (t === 460) {
    // 屠夫冲刺刀击盒（:96153-96168）：30×14，锚 Center.X / feet−20
    const bx = Math.round(e.x + e.w / 2) - (facing < 0 ? 30 : 0);
    const by = Math.round(e.y + e.h - 20);
    const box = { x: bx, y: by, w: 30, h: 14 };
    // 仅当专盒与受害盒相交才替换(:96166 victimHitbox.Intersects(rectangle))，
    // 否则维持原盒判定
    if (vx < box.x + box.w && vx + vw > box.x && vy < box.y + box.h && vy + vh > box.y) {
      return box;
    }
    return { x: e.x, y: e.y, w: e.w, h: e.h };
  }
  return { x: e.x, y: e.y, w: e.w, h: e.h };
}

// ★BJ704-G6 D12（2026-10-21）：AI_007_TownEntities_GetWalkPrediction（NPC.cs:
//   56093-56165）1:1 本体迁 npcWalkPrediction.ts 共享叶子（Enemy 侧三消费位
//   :54136/:54280/:54534 接通需同源——TownNPC.ts 已 import type Enemy,反向
//   import 成环;逻辑零改动逐字迁出）。此处 re-export 保 Game.ts/测试既有导入面。
export { walkPrediction } from './npcWalkPrediction';


/** 软帽链（StrikeNPC :82147-82166）：kb>8 起每段衰减 0.9/0.8/0.7/0.6、>16 封顶 */
export function knockbackCap(kb: number): number {
  let n = kb;
  if (n > 8) n = 8 + (n - 8) * 0.9;
  if (n > 10) n = 10 + (n - 10) * 0.8;
  if (n > 12) n = 12 + (n - 12) * 0.7;
  if (n > 14) n = 14 + (n - 14) * 0.6;
  if (n > 16) n = 16;
  return n;
}

// ===================== Boss 击杀进度强化链（AI_007_TownEntities NPC.cs:53400-53557）=====================
// num2 = 伤害乘区（先于难度曲线：num = GetAttackDamage_ForTownNPC(num × num2)，
// 四攻击态入参 ：54897/:55169/:55319/:55466）；num3 = 攻击频率门除数（:55859
// num123=(int)(AttackAverageChance×num3)，钳 ≥1 后 rand(num123)==0）。两者在同一
// isLikeATownNPC 块内逐项累计。块内不属本函数的条目：防御档 :53401-53412
// （dryadWard +20/15/10 按难度——载体 dryadWardT 已接（2026-08-20），hurt() 内联）、
// type==209 num3÷3（:53548，attackUpdate 消费点内联）、对话中 num3×0.8（:55762
// ——原版总伞 (!flag5|flag16) 只在「对话且无险」整段跳过，对话中有险照常入态掷骰；
// 2026-08-31 对账批②已接（attackUpdate 内联），旧「talking 不入攻击态·不可达」
// 登记系误判作废）。
/** 进度强化链输入（全 bool；各字段 = 原版静态位/实例位，括注声明行+置位点） */
export interface TownNpcProgression {
  combatBookWasUsed: boolean;            // NPC.combatBookWasUsed（:6256；书 4382 使用 Player.cs:44710）
  combatBookVolumeTwoWasUsed: boolean;   // NPC.combatBookVolumeTwoWasUsed（:6258；书 5336 Player.cs:44723）
  downedSlimeKing: boolean;              // NPC.downedSlimeKing（:6270；case 50 event 11 :80217）
  downedBoss1: boolean;                  // NPC.downedBoss1（:6262；克眼 4 event 13 :80242）
  downedDeerclops: boolean;              // NPC.downedDeerclops（:6314；668 event 25 :80156）
  downedBoss2: boolean;                  // NPC.downedBoss2（:6264；世吞/克脑 13/14/15/266 event 14 :80258）
  downedBoss3: boolean;                  // NPC.downedBoss3（:6266；骷髅王 35 event 15 :80264）
  downedQueenBee: boolean;               // NPC.downedQueenBee（:6268；蜂后 222 event 8 :80188）
  hardMode: boolean;                     // Main.hardMode（肉山 113 → WorldGen.StartHardmode :80286）
  downedQueenSlime: boolean;             // NPC.downedQueenSlime（:6312；657 event 24 :80159）
  downedMechBoss1: boolean;              // NPC.downedMechBoss1（:6340；毁灭者 134 event 16 :80277）
  downedMechBoss2: boolean;              // NPC.downedMechBoss2（:6342；双子 125/126 event 17 :80227）
  downedMechBoss3: boolean;              // NPC.downedMechBoss3（:6344；Prime 127 event 18 :80270）
  downedPlantBoss: boolean;              // NPC.downedPlantBoss（:6280；世花 262 event 12 :80234）
  downedEmpressOfLight: boolean;         // NPC.downedEmpressOfLight（:6310；光女 636 event 23 :80153）
  downedFishron: boolean;                // NPC.downedFishron（:6286；猪鲨 370 event 7 :80150）
  downedGolemBoss: boolean;              // NPC.downedGolemBoss（:6282；石巨人 245 event 6 :80147）
  downedAncientCultist: boolean;         // NPC.downedAncientCultist（:6298；拜月教主 439 event 9 :80195）
  skyblockLowTiles: boolean;             // WorldGen.Skyblock.lowTiles（WorldGen.cs:3076；天空盒世界扫块率<0.1 置位 :3210-3216）
  tipsy: boolean;                        // NPC.tipsy（:6146；buff 25 UpdateNPC_BuffSetFlags :93179）
}

/** num2/num3/defense 进度强化链 1:1（NPC.cs:53400-53557，仅 isLikeATownNPC 块内条目）。
 *  返回 damageMul=num2 / chanceMul=num3 / defenseBonus（防御链同块逐旗累计，每
 *  tick 由 AI_007 头部 defense = defDefense 起步重算——本仓受击时现算等价）。
 *  顺序敏感项：Skyblock 的 num3 折半（num3>1 才取 (num3+1)/2，:53542-53545，
 *  非乘法）在链中段；tipsy 在链尾乘算（:53555 damage×1.1 / :53556 chance×0.9 /
 *  :53554 defense=(int)(defense×1.1) 截断）。209 的 num3÷3（:53548）在
 *  Skyblock 之后、tipsy 之前——由消费点内联（对乘法项可交换，仅与 Skyblock
 *  折半的组合序有差；skyblockLowTiles 本仓恒 false，见 fromWorld 登记） */
export function townNpcProgressionBoost(p: TownNpcProgression):
{ damageMul: number; chanceMul: number; defenseBonus: number } {
  let damage = 1;                        // num2 = 1f（:53400）
  let chance = 2;                        // num3 = 2f（:53413）
  let defense = 0;                       // defense 链累计（基值由调用方加）
  if (p.combatBookWasUsed) {             // :53419-53425（lifeMax+250 留 applyCombatBook）
    chance *= 0.8; damage += 0.25; defense += 8;
  }
  if (p.combatBookVolumeTwoWasUsed) {    // :53426-53432
    chance *= 0.8; damage += 0.25; defense += 8;
  }
  if (p.downedSlimeKing) {               // :53437-53442
    chance *= 0.985; damage += 0.05; defense += 2;
  }
  if (p.downedBoss1) {                   // :53443-53448
    chance *= 0.985; damage += 0.05; defense += 2;
  }
  if (p.downedDeerclops) {               // :53449-53454
    chance *= 0.985; damage += 0.1; defense += 3;
  }
  if (p.downedBoss2) {                   // :53455-53460
    chance *= 0.985; damage += 0.1; defense += 3;
  }
  if (p.downedBoss3) {                   // :53461-53466
    chance *= 0.985; damage += 0.1; defense += 3;
  }
  if (p.downedQueenBee) {                // :53467-53472
    chance *= 0.985; damage += 0.1; defense += 3;
  }
  if (p.hardMode) {                      // :53473-53478（伤害+0.4/防+12 双最大项）
    chance *= 0.985; damage += 0.4; defense += 12;
  }
  if (p.downedQueenSlime) {              // :53479-53484
    chance *= 0.985; damage += 0.15; defense += 6;
  }
  if (p.downedMechBoss1) {               // :53485-53490
    chance *= 0.985; damage += 0.15; defense += 6;
  }
  if (p.downedMechBoss2) {               // :53491-53496
    chance *= 0.985; damage += 0.15; defense += 6;
  }
  if (p.downedMechBoss3) {               // :53497-53502
    chance *= 0.985; damage += 0.15; defense += 6;
  }
  if (p.downedPlantBoss) {               // :53503-53508
    chance *= 0.985; damage += 0.15; defense += 8;
  }
  if (p.downedEmpressOfLight) {          // :53509-53514
    chance *= 0.985; damage += 0.15; defense += 8;
  }
  if (p.downedFishron) {                 // :53515-53520
    chance *= 0.985; damage += 0.15; defense += 8;
  }
  if (p.downedGolemBoss) {               // :53521-53526
    chance *= 0.985; damage += 0.15; defense += 8;
  }
  if (p.downedAncientCultist) {          // :53527-53532（防 +20 最大防御项）
    chance *= 0.985; damage += 0.15; defense += 20;
  }
  if (p.skyblockLowTiles) {              // :53540-53547（netMode!=1 单机恒过）
    if (chance > 1) chance = (chance + 1) / 2;
    damage += 0.5;
  }
  if (p.tipsy) {                         // :53552-53557（链尾乘算/防截断）
    damage *= 1.1; chance *= 0.9;
    defense = Math.trunc(defense * 1.1);
  }
  return { damageMul: damage, chanceMul: chance, defenseBonus: defense };
}

/** world.flags → 进度强化链输入。Boss 旗标本仓 = Game Boss 槽击杀通用记账
 *  `downed_<vanillaId>`（Game.ts 击败链，双子归一 125；世吞归一 13/克脑 266），
 *  与 Game.shopCondOk 同源键序；旧档/导入别名（downedEyeOfCthulhu/downedSkeletron/
 *  downedSlimeKing）双读。恒 false 两项 = 精确登记非近似：
 *  - skyblockLowTiles：WorldGen.Skyblock.ScanTiles 只在世界装载时跑一次
 *    （WorldFile.cs:771），活跃块率 <0.1 且 skyblockWorld 才置（WorldGen.cs
 *    :3210-3216）。本仓无 skyblock 世界生成链（sf.skyblock 仅拒绝墓园 pass,
 *    生成的是常规满图世界 >10%），WldParser 导入亦不保留该位 → 本仓可产的
 *    任何世界恒 false,不可拿 seedFlags.skyblock 近似；
 *  - tipsy：NPC 实例位非世界旗标（buff 25,:93179）——本函数恒 false,由消费点
 *    （attackUpdate 触发门 / swingUpdate / shootAt）按 this.tipsy 覆盖；施加链
 *    = 麦酒弹 669 Kill 爆炸（TownShot.kill669,Projectile.cs:68725-68734） */
export function townNpcProgressionFromWorld(world: {
  flags: Record<string, boolean>;
}): TownNpcProgression {
  const f = world.flags;
  return {
    combatBookWasUsed: !!f.combatBookWasUsed,
    combatBookVolumeTwoWasUsed: !!f.combatBookVolumeTwoWasUsed,
    downedSlimeKing: !!(f['downed_50'] || f.downedSlimeKing),
    downedBoss1: !!(f['downed_4'] || f.downedEyeOfCthulhu),
    downedDeerclops: !!f['downed_668'],
    downedBoss2: !!(f['downed_13'] || f['downed_266']),
    downedBoss3: !!(f['downed_35'] || f.downedSkeletron),
    downedQueenBee: !!f['downed_222'],
    hardMode: !!f.hardMode,
    downedQueenSlime: !!f['downed_657'],
    downedMechBoss1: !!f['downed_134'],
    downedMechBoss2: !!(f['downed_125'] || f['downed_126']),
    downedMechBoss3: !!f['downed_127'],
    downedPlantBoss: !!f['downed_262'],
    downedEmpressOfLight: !!f['downed_636'],
    downedFishron: !!f['downed_370'],
    downedGolemBoss: !!f['downed_245'],
    downedAncientCultist: !!f['downed_439'],
    skyblockLowTiles: false,
    tipsy: false,
  };
}

/** 挥击「换敌再接」候选引用（原 Main.npc[num16/num17] 直读位的结构面）。
 *  ★2026-08-31 治理批 B1②：消费端【不设活性门】——原版 :55652-55669 重接段
 *  直接 `Main.npc[num88]` 取 Center 判 CanHit，无 `.active` 查询（原文如此）。
 *  唯一活亡态差窗 = 同拍命中循环内先行致死：原版同样会把重接目标钉在
 *  该拍刚死的怪（位仍占、坐标未动），行为按原文保留——快照盒就是当时的
 *  活体盒，与"槽位读尸"等价；不引入活性查询避免登记偏离。 */
export interface ThreatRef {
  x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  /** ★对抗修复批⑤ A6：DirectionTo(候选中心).Y（pdy/pdl 归一）。pickSideTarget
   *  终选时写入——弓族入态种子 ai[2]=vector8.Y（cs:56052-59 同带检门内成值） */
  aimY?: number;
}

/** 危险扫描候选池快照（★C2 统一定案：原版 num13..num17 结构面单点产出——
 *  dangerUpdate 每 tick 全量重建,入态选靶(:56016-56105 直读 `Main.npc[num16/17]`)
 *  与态内发射瞄准(:55105-55112 num58 同源 / 近战段 :54868 族、魔法 :55333 段)
 *  一律【直读本快照】,不再独立重扫。left/right 即 num16/num17（记录前置
 *  CanBeChasedBy 门 :54054-57,B1①）；num15(危险侧) = this.dangerSide,
 *  num13/num14(|dx| 值)不出接口——侧选公式同源已并入消费端）。 */
export interface ThreatPoolSnapshot {
  left: ThreatRef | null;    // num16
  right: ThreatRef | null;   // num17
}

/** 医师治疗弹受疗对象结构面（TownNPC/任意城镇体均满足） */
interface PatientBox {
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number; dead: boolean;
}

/**
 * 医师治疗弹（Projectile 584 NurseSyringeHeal）——AI_110（Projectile.cs:34691-34727）
 * 本仓内置忠实版。SetDefaults（:6342-6349）：10×10、scale 0.8、penetrate 3、
 * friendly、damage 0（结算在 AI 内不进 Damage 管线）。发射端 = 医师 ai[0]==13
 * 首拍（localAI[3]==1，NPC.cs:55371-55382）：出生 Center+(spriteDirection×16, −2)、
 * 初速 = DirectionTo(患者.Center+(0,−20))×8（NaN 或背向 → (spriteDirection,−1) 兜底×8）。
 * 每 tick：
 *  - 目标失活（!active||!townNPC）→ Kill 静默（:34725-34727 else 分支）
 *  - 距离 < speed 或 Hitbox 与患者盒相交 → Kill + 治疗 min(lifeMax−life,20)，
 *    只在缺口 >0 时回血并 HealEffect 绿字（:34704-34712；CombatText.HealLife
 *    = (100,255,100)，无音效锚点——HealEffect 家族 NPC.cs:78234-78246 只发飘值，
 *    原文本仓 addDamageNumber '#64FF64' 承接）
 *  - 否则恒速追踪：value16=方向×speed；`if(value16.Y<velocity.Y) 取 velocity.Y`
 *    再 `value16.Y+=1`；velocity=Lerp(velocity,value16,0.04)；rotation 累加
 *    velocity.X×0.05（:34713-34721 else 支内）
 *  - tile 反弹（Projectile.cs:17696 lastVelocity 捕获 + :18233-18254 type==584
 *    专案支，2026-08-31 对账批②三点重对齐）：lastVelocity = 本帧【碰撞步首】
 *    速度（AI 追踪之后、TileCollision 改速之前——旧实现用上帧终速跨帧比较系
 *    偏离）；碰撞步 = 盒扫掠（步长 cap=clamp(min(w,h),3,16)=10,方向子步步进 +
 *    X→Y 双轴盒占用钳制,TileCollision 局部等价;>cap 快路径带 ±1e-4 微差吸附
 *    :17853-17858 同构）;接触证据 = X 轴本帧改速即触、Y 轴本帧改速且上帧速
 *    >2 或本帧 Y 归零(:18234-18243);率因子 num17 = |lastVel|/|postAxis| 后
 *    velocity /= num17(:18249-18253——decomp 字面形态:效果是【整体乘
 *    |postAxis|/|lastVel|】,单轴 0.75 弹会进一步缩到 0.75×,并非直觉的「复幅」;
 *    按反编译原样落位)
 *
 * ★消亡条件定谳（2026-08-31 蓝队 F1 再翻案）：本弹【无地物死亡出口】——
 * :18233-18254 的 type==584 反弹支只 `penetrate--`（显式 Kill 是 gem-staff 类
 * 532 支的事）。实际死亡位共三处，全在 Projectile.Update 每 tick 循环内依序：
 *   ① AI 内患者失活/抵达 → Kill（:34704/:34727；AI() 体 :34691-34727）；
 *   ② Update 尾 `timeLeft--; if(timeLeft<=0) Kill()`（Projectile.cs:17307-17311，
 *      SetDefaults 缺省 timeLeft=3600：Projectile.cs:789）；
 *   ③ 紧随其后的 `if (penetrate == 0) Kill()`（:17312-17315）。
 * Update 体序（以 1457 反编译实测行号钉定）= AI(:16880) → HandleMovement(:17120，
 * 其方法体 Projectile.cs:17578 起内含 TileCollision 步进与 type==584 反弹支
 * :18233-18254) → 尾部②③。因此第 3 次反弹把 penetrate 减到 0 的【同一拍】：
 * 碰撞受限位移已产生、该拍末尾即死——不存在"下拍头部幽灵帧"。
 * 旧映射①治理批 B4 的「第 3 次反弹存活到下拍头部才死（AI 先行、零位移）」系把
 * 尾部门判序读反到碰撞之前，废除；town-npc-attack 金标随之反转为本形。
 */
export class NurseSyringeShot extends TownShot {
  private readonly patient: PatientBox | null;
  private readonly onHeal?: (amt: number, px: number, py: number) => void;
  /** localAI[1]：首拍锁定的速率基准（:34694-34696） */
  private readonly speed: number;
  /** SetDefaults penetrate = 3（:6349）；消亡走 ：17312-17315 通用门（见类注 B4） */
  private bouncesLeft = 3;

  // ---- ★通用湿段（Projectile.cs:16895-17113 共享体;2026-09-08 红队接入面 F2 清偿）----
  //  域 id = {584}（SetDefaults :6342-6350：10×10 aiStyle110 friendly scale0.8
  //  penetrate3,无 ignoreWater 行=缺省 false（:763）→ 受段;tileCollide 缺省 true）。
  //  ★本类 override fixedUpdate 全量自写不调 super——基类 TownShot.fixedUpdate 的
  //  tick 头湿段对本类【不生效】,须在 override 内自接（TownShot.ts 头注豁免域清单
  //  已补 584 口径）。插位=tick 头：AI_110（:34691-34727 逐行核对）零湿旗消费 →
  //  共享体头注「AI 无湿旗消费者可用 tick 头插位」成立,采样位=上拍位移后 ≡ 原版
  //  湿段采样;患者失活/抵达 Kill 拍（:34704/:34727）湿段照跑（原版 AI-Kill 拍段体
  //  无 active 门）。584 ∉ IsDestroyedByWater（{85,15,188,34,1097,1106},
  //  ProjectileID.cs:287）→ 无 kill 钩;aiStyle110 ∉ Shimmer() 任何支（:22564-22719）
  //  → 缺省支=无动作,无 shimmer 面。
  //  阻尼（HandleMovement :17721-17764 湿支只在 tileCollide 支,:17594）：584
  //  tileCollide=true → 湿支生效;只削位移（wetVelocity 通道 :20555-20557）,速度场
  //  与反弹证据（lastVelocity :17696 捕获、:18233-18254 判定）不受阻尼——位移行
  //  乘档、残速累计 mvx/mvy 保持全速语义。
  //  旗持有（wet/lavaWet/honeyWet/shimmerWet/wetCount/presetDone）= 基类 TownShot
  //  字段块同形字段,本类不重decl（继承即 ProjWetFlags 形状）。

  constructor(
    x: number, y: number, vx: number, vy: number,
    patient: PatientBox | null, onHeal?: (amt: number, px: number, py: number) => void,
  ) {
    super(x, y, vx, vy, 0, 0, 584, { noGravity: true, life: 3600 });   // timeLeft 缺省档
    this.patient = patient ?? null;
    this.onHeal = onHeal;
    this.speed = Math.hypot(vx, vy);
  }

  override fixedUpdate(_dt: number, game: GameHooks): void {
    // ---- ★通用湿段（:16895-17113 共享体,tick 头插位——论证见字段块注;
    //      基类 fixedUpdate 被本 override 全量替代,基类位不跑）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    const t = this.patient;
    // :34699 目标门（vanilla `active && townNPC`；本仓城镇体 death 位承接）
    if (!t || t.dead) { this.dead = true; return; }
    const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
    const dx = tcx - (this.x + this.w / 2), dy = tcy - (this.y + this.h / 2);
    const dist = Math.hypot(dx, dy);
    const intersects = this.x < t.x + t.w && this.x + this.w > t.x
      && this.y < t.y + t.h && this.y + this.h > t.y;
    if (dist < this.speed || intersects) {
      // :34703-34712 Kill + 治疗帽 20
      this.dead = true;
      let amt = t.maxHp - t.hp;
      if (amt > 20) amt = 20;
      if (amt > 0) {
        t.hp += amt;
        this.onHeal?.(amt, tcx, t.y);   // HealEffect 锚 = 患者 position 盒
      }
      return;
    }
    // :34713-34721 恒速追踪 + Y 重力牵拉（value16.Y++）
    let hx = dx / dist * this.speed;
    let hy = dy / dist * this.speed;
    if (hy < this.vy) hy = this.vy;
    hy += 1;
    this.vx += (hx - this.vx) * 0.04;
    this.vy += (hy - this.vy) * 0.04;
    this.rotAcc += this.vx * 0.05;                       // :34721 rotation
    // ---- tile 反弹（Projectile.cs:17696 lastVelocity=碰撞步首捕获 +
    //      :17749-17858 TileCollision 步进求解 + :18233-18254 type==584 响应）----
    const st = game.world.store;
    const preVx = this.vx, preVy = this.vy;              // lastVelocity（本帧碰撞步首）
    const spd = Math.hypot(preVx, preVy);
    const stepCap = Math.min(16, Math.max(3, Math.min(this.w, this.h)));   // num2(:17747-17756)
    let mvx = 0, mvy = 0;                                // 碰撞后残速（零累计 ≡ velocity）
    // ★水中位移阻尼（HandleMovement :17721-17764 湿支;2026-09-08 F2）：wetVelocity=
    //  post-TileCollision velocity×档（:17755-17762）仅进 UpdatePosition :20555-20557
    //  `if (wet) position += wetVelocity`——位移行乘档,速度场与【反弹证据】（mvx/mvy
    //  残速累计、:18233-18254 判定）保持全速语义不受阻尼污染。档位读 tick 头湿段旗
    //  （原版 HandleMovement 亦消费当拍子步湿段旗,同位）。
    const wetDrag = projWaterDragFactor(this);
    if (spd > stepCap) {
      // 快路径：SafeNormalize×stepCap 子步循环，每步盒钳制后位移照推进
      // （:17757-17812 while 循环;零累计即末速）;±1e-4 微差吸附(:17853-17858)
      const nxs = preVx / spd, nys = preVy / spd;
      let left = spd, guard = 0;
      while (left > 0 && guard++ < 300) {
        const len = Math.min(left, stepCap);
        const [sxv, syv] = this.tileClipStep(st, nxs * len, nys * len);
        mvx += sxv; mvy += syv;                          // 残速累计=碰撞语义（全速,不阻尼）
        this.x += sxv * wetDrag; this.y += syv * wetDrag;   // 位移=wetVelocity 通道
        left -= len;
      }
      if (Math.abs(mvx - preVx) < 1e-4) mvx = preVx;
      if (Math.abs(mvy - preVy) < 1e-4) mvy = preVy;
    } else {
      // 慢路径（:17813-17844）：单步整速盒钳制；碰撞语义并入累计,位移消费阻尼
      const [sxv, syv] = this.tileClipStep(st, preVx, preVy);
      mvx = sxv; mvy = syv;
      this.x += sxv * wetDrag; this.y += syv * wetDrag;
    }
    // 接触证据判定（:18234-18243,X 轴无条件/Y 轴双条件——全部本帧同拍证据,
    // 非跨帧比较）+ 反弹率还原（:18249-18253 num17 恒复 |lastVel| 幅值）
    let vx2 = mvx, vy2 = mvy;
    let bounced = false;
    if (vx2 !== preVx) { vx2 = preVx * -0.75; bounced = true; }          // :18235-18239 X
    if ((vy2 !== preVy && preVy > 2) || vy2 === 0) {                     // :18240-18243 Y
      vy2 = preVy * -0.75;
      bounced = true;
    }
    if (bounced) {
      const dLen = Math.hypot(vx2, vy2);
      let r = dLen > 0 ? spd / dLen : 1;                 // num17==0 → 取 1（:18251-18253;
      vx2 /= r; vy2 /= r;                                //  双零幅 NaN 角点本仓钳 1）
      this.vx = vx2; this.vy = vy2;
      // :18254 penetrate--——反弹支【无显式 Kill】(gem-staff 532 支才有)；
      // 归零后的死亡在本拍 Update 尾部通用门 :17312-17315 结算（类注 F1）
      this.bouncesLeft--;
    } else {
      this.vx = vx2; this.vy = vy2;
    }
    // ---- Update 尾通用消亡门（Projectile.cs:17307-17311 timeLeft--/Kill +
    //      :17312-17315 penetrate==0/Kill——位于 HandleMovement(:17120，内含 tile
    //      碰撞步进与 :18233-18254 type==584 反弹支)【之后】；★蓝队 F1 判序定谳：
    //      第 3 次反弹当拍已产生碰撞受限位移、当拍末尾即死。旧「下拍头部才死」
    //      （治理批 B4，门置碰撞前）读反体序 = 第 3 反弹多活一拍零位移幽灵帧，废）----
    if (--this.life <= 0) { this.dead = true; return; }   // timeLeft 缺省档 3600(:789)
    if (this.bouncesLeft === 0) {                         // :17312-17315 penetrate==0
      this.dead = true; return;                           // ——本拍反弹归零者同拍结算
    }
  }

  /** 单步双轴盒钳制（Collision.TileCollision 局部等价）：先按 dx 试移动整盒、
   *  被堵清零且不推进，再以更新后的 X 试 dy——子步序列合成即扫掠采样 */
  private tileClipStep(
    st: import('../world/TileStore').TileStore, dx: number, dy: number,
  ): [number, number] {
    let rx = dx, ry = dy;
    if (dx !== 0 && this.boxBlocked(st, this.x + dx, this.y)) rx = 0;
    if (ry !== 0 && this.boxBlocked(st, this.x + rx, this.y + ry)) ry = 0;
    return [rx, ry];
  }

  /** 盒占用测试（Syringe 10×10 全盒覆盖格任一实心即堵；isSolid 含半砖/斜面侧
   *  語义的 house 约定与 TownNPC.obstacleJump solidRange 同源——实心基表直查） */
  private boxBlocked(
    st: import('../world/TileStore').TileStore, bx: number, by: number,
  ): boolean {
    const x0 = Math.floor(bx / TILE), x1 = Math.floor((bx + this.w - 0.001) / TILE);
    const y0 = Math.floor(by / TILE), y1 = Math.floor((by + this.h - 0.001) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (st.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  override draw(r: import('../render/Renderer').Renderer, _cam: unknown): void {
    // 绘制自控：rotation = 累加角（velocity.X×0.05），帧恒 0（单帧）、scale 0.8
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(this.projId);
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.rotate(this.rotAcc);
    if (img && img.width > 0) {
      const s = this.drawScale;
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, 0, 0, img.width, img.height, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = '#D8C8A0';
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();
  }
}

/** 机械师侦察弹 582 归属 tag 全局序列（type 124 = 机械师,NPCID.cs:11319）。原版形态 =
 *  弹 ai[1] 写【whoAmI 槽位】（发射 NPC.cs:55066-55068 NewProjectile 末参；归属检
 *  :53716-53725 `proj==582 && ai[1]==whoAmI` → localAI[0]、消费 :55778-55780 抑制
 *  再发）——即 Main.npc 数组下标制。★蓝队 F7 取舍：保留本仓实例单调 tag,不改回
 *  whoAmI 槽位制。等价性论证：
 *   - 主契约「单机师在途最多一枚侦察弹」两制全同（同机重复射击同 tag/own whoAmI 恒命中）；
 *   - 「死后重驻的新机械师不受旧弹压制」两制同（新实例新 tag / 新实体新 whoAmI——
 *     仅当旧数组槽被复用才会误压制继任者首射 ≤ 一枚 582 弹龄的窗口,复刻该缺陷需
 *     引入槽位生命周期近似件,复杂度不成比例且无正观测收益）;
 *   - 「多机师并发各持一弹」两制同（不同实例不同 tag）。 */
let MECH_PROBE_TAG_SEQ = 0;

export class TownNPC extends Entity {
  w = 20; h = 42;
  stepUp = true;
  /** StepUp holdsMatching（Collision.StepUp 第 8 参）+ IgnoredByNpcStepUp（NPC.cs:54382）
   *  原版 NPC 全体走 Collision.StepUp（NPC.cs:54382）。★对抗修复批③2026-09-01：
   *  holdsMatching 已改为每拍按 flag22 写入（D-F2/A-F4，见 fixedUpdate 家平线门块）
   *  ——不再是写死 true；构造缺省保留 true 只为首个 fixedUpdate 前的碰撞读法安全 */
  stepUpHolds = true; stepUpNpc = true;
  /** StepDown 吸附门（Collision.StepDown 触发面）：★对抗修复批③ D-F2——原版
   *  NPC.cs:54518 `!flag22 && velocity.Y==0f` 才吸附,即 flag22 为真时恒不吸附。
   *  本仓映射：flag22 ? 'never' : 'grounded'，fixedUpdate 每 tick 重算 */
  stepDownGate: 'grounded' | 'gravity' | 'never' = 'grounded';
  npcKey: string; // 'guide'
  /** 原版 NPCID（TOWN_NPC_IDS；Renderer 经 atlas.vnpc 取 NPC_{id}.png 贴图条） */
  vanillaId: number;
  facing = 1;
  /** 随机名字（NPC.getNewNPCNameInner 名字池；无池类型如守卫老人为空串） */
  givenName = '';
  /** NPC.townNpcVariationIndex（宠物三族 637/638/656 六变体）。缺省 0 = 原版字段
   *  缺省（NPC.cs:8375）→ VariantNPCProfile 首变体（Siamese/Labrador/White,
   *  Profiles.GetTextureNPCShouldUse IndexOutOfRange→num=0 同款语义）。
   *  RerollVariation（NPC.cs:81707-81733）换外观+名字池重掷；许可证二用触发 */
  variationIndex = 0;
  animT = 0;
  frame = 0;       // 当前贴图帧（原版 frame.Y/帧高）
  frameT = 0;      // 行走帧累加器（≈原版 frameCounter）
  home: NpcHome | null = null;
  /** ★SW-BO1 2026-09-07：NPC.homelessDespawn（NPC.cs:6552）——夜间清场扫标的位。
   *  唯一置位面 = SpawnHomelessNPC 流浪生成（WorldGen.cs:5110）；清位面 =
   *  QuickFindHome 成功（:5701）/ SpawnTownNPC RelocatedHomeless（:5380）/
   *  UnspawnHomelessNPC 非 homeless 复核（:5144）。原版 v315+ 随城镇 NPC 段持久化
   *  （WorldFile.cs:1741/:2932），本仓同走存档面（serialize npcs.homelessDespawn） */
  homelessDespawn = false;
  /** ★BJ259（2026-09-22）：NPC.lookForHomeTimeout（NPC.cs:6554）——踢出冷却位。
   *  置位面 = WorldGen.kickOut（:4797 KickOutLookForHomeTimeout=3600,NPC.cs:6556）;
   *  递减面 = NPC.UpdateNPC（:91434-91437 每 tick）;消费面 = 迁入资格门
   *  （WorldGen.cs:5543）+ 优先型锁扫描（:72176）。原版不随存档持久化（运行时位）
   *  ——本仓同（serialize 不落盘）。 */
  lookForHomeTimeout = 0;
  /** ★BJ259 本仓侧标：曾被玩家踢出（housingUiActive 右键旗 → Game.kickOutNPC）。
   *  vanilla 无此面——本仓 ①「无家者每轮再安置」臂（updateTownNpcArrival,原版
   *  【无】对应面,本仓长持 affordance）若不豁免被踢者,下一入驻轮即以旧 homeTile
   *  锚把 NPC 塞回原房 = 踢出被自动回填。消费面 = ① 臂排除;清位面 = 任一再安家
   *  成功（runQuickFindHome 成功支/housingAssign/近链 RelocatedHomeless）。随存档
   *  持久化（serialize npcs.kickedOut,repo 侧标原版无对应字段——边界登记）。 */
  kickedOut = false;
  /** 定点站岗（守卫老人）：门口地带是山坡+塔心竖井,白天的自由游走会坠入地牢；
   *  原版观感也是整日守在门口走廊 */
  stationary = false;
  /** 被绑待救援（原版为独立 NPC 类型：BoundGoblin105/BoundWizard106/BoundMechanic123/
   *  WebbedStylist354/GolferRescue589，本作以本标记近似；渲染按真帧走各捆绑姿态表——
   *  Renderer.BOUND_NPC_SHEET。原地不动，右键解救 → savedXxx 旗标置位成为正式城镇 NPC） */
  bound = false;
  /** bound 族 CheckActive 计时（NPC.timeLeft；activeTime=750，NPC.cs:6188）——
   *  被缚族非 townNPC、不在 DoesntDespawnToInactivity 名单 → 照走四步消散链
   *  （BJ122 2026-09-18 定谳重写：此前 bound 永不消散=偏差，早期刷出者钉死老位置
   *  令 !AnyNPCs 场上唯一门永久关闭 → 玩家永远遇不到新刷的【用户观测 2】） */
  boundDespawnTimer = 750;
  /** 685 被缚老史莱姆 AI_001 跳跃机 ai[0]/ai[2]/ai[3]（语义位与 Enemy.ai0/ai2/
   *  jumpStartX 同源；BJ122 落刀——原版 685=aiStyle 1 会蹦，站桩系偏差） */
  private boundHopAi0 = 0;
  private boundHopAi2 = 0;
  private boundHopAi3 = 0;
  // ---- NPC 开关门（原版 AI_007，NPC.cs:54478 开门 / 54243 过门关门）----
  private closeDoor = false;
  /** 贴墙/门前接触连续 tick 数（tryOpenDoorAhead 命中门时累加,错过清零）——
   *  满 FORCE_OPEN_TICKS 后跳过概率门直开(体验兜底:随机 Next(10) 长期不中) */
  private doorContactT = 0;
  private doorX = 0; private doorY = 0;
  /** 白天游走但不远离 home(守卫老人:锚地牢门口走廊,防走失) */
  leashHome = false;
  /** 正在与玩家对话（原版 AI_007 :53721：talkNPC==本体 → ai[0]=0 站定、面向玩家） */
  talking = false;
  talkCooldown = 0;
  /** 微光化变体 = townNpcVariationIndex==1（NPCID.Sets.ShimmerTownTransform 入
   *  微光 → GetShimmered :92668/:92695-92711 → ai[0]=25 上升态；上升收尾 :53814 翻转——
   *  **双向**：已微光化再浸微光翻转回原形态）。变体贴图经 townSheet getter 切
   *  TownNPCs/Shimmered 档（Profiles.StackedNPCProfile 档位 1），对话差分登记 GAP */
  shimmered = false;
  /** 当前 altTexture（UpdateAltTexture NPC.cs:91254-91273：1=派对 2=狼人；
   *  fixedUpdate 每 tick 由 townNpcAltTexture 刷新——月相/血月/派对随时翻态） */
  altTexture = 0;
  // ---- 坐姿（AI_007 ai[0]==5，NPC.cs:53264-53287 入座 / :54682-54710 态推进）----
  /** 正坐在椅/马桶上（ai[0]==5）。仅夜/雨"该回家"窗口（flag，:53383-53402）入座：
   *  FindGoodRestingSpot 扫 home 附近可坐格 → 走到/传送落到落座格 → TryForcingSitting。
   *  渲染消费：drawPartyHat 坐姿帽 Y 链（sittingHatY）+ hatStateOffsetX 的 550 档 */
  sitting = false;
  /** ★BJ647：坐姿态物理投影（Body.sitPose,unembedPass 让位面）。fixedUpdate 头部
   *  每 tick 同步 = this.sitting;字段独立于 Player.sitting（交互态撞名规避） */
  sitPose = false;
  /** ai[1] 坐姿倒计时（入座 = 900+rand(10800)，:53283） */
  private sitTimer = 0;
  /** 本 tick 的夜椅 rest spot（FindGoodRestingSpot 缓存；白天/无 home = null） */
  private restSpot: SitSpot | null = null;
  /** 本 tick 刚走"回家传送"（TeleportToHome :56063-56090 落位后即
   *  TryForcingSitting :56081——免"站定+同格"门，:54074 门只管走到场的情形） */
  private teleportedHome = false;
  /** 微光转化透明度（NPC.cs:6112，0..1；赋值时序 :92631-62/:53770——★1457 校准）。
   *  消费：Renderer 本体 alpha=1−st（GetAlpha :94874）+ 160 Glow ×(1−st)
   *  （Main.cs:25771-25776）——微光转化渐显/渐隐的唯一驱动字段 */
  shimmerTransparency = 0;
  /** buff 353 Shimmered 剩余 tick（buffType/buffTime 单槽近似——同 tipsyT/dryadWardT 先例）。
   *  >0 ⇔ shimmering 状态位（UpdateNPC_BuffSetFlags 扫 buffType==353 → shimmering=true,
   *  :93255-93264；免疫者 DelBuff——本仓写入面已带 isNpcShimmerImmune 门）。
   *  写入面①浸液 TryAddingRepeatedBuff(353,100)（:94211-18，调用点 :94446-56
   *  `if (Collision.shimmer)`——非免疫且(无 buff ∨ buffTime≤10) → AddBuff(353,100)，
   *  浸池持续续期、出池余量 10-100t 自然衰减；②微光枪弹 1042 命中 AddBuff(353,100)
   *  （AI_060 :29456-29458，GlobProj 消费——AddBuff max 合并 :91035）。
   *  衰减 = UpdateNPC_BuffSetFlags 1/t（buffTime[i]-- :93101）。
   *  ramp lane 只读本位（shimmerTransparencyNext 的 shimmering 入参）——
   *  [MAJOR-F4] 修复（红队 R1 2026-09-03）：旧「中心格液体直读」探针退役。
   *  转化入上升态清零（GetShimmered :92706-10 DelBuff(353)）。 */
  shimmerBuffT = 0;
  /** 微光上升态旗标（原版 ai[0]==25，NPC.cs:53737-53820：落点传送 → ai[1]≥30
   *  起 −1/60/t 衰减 + velocity.Y=−4×st 上浮 → st 归零后翻转变体 + 到场粒子 +
   *  成就 43；态内 dontTakeDamage——推进见 shimmerRiseUpdate） */
  private shimmerRise = false;
  /** ai[1]：上升态计时（0 起，暂停期外每 tick +1；浸液钳 30） */
  private shimmerRiseT = 0;
  /** ai[2]：远距落点传送后的暂停倒计时（:53604） */
  private shimmerRisePause = 0;
  /** Main.IsItStorming 缓存（isItStormingNext 逐步推进；坐姿/回家 flag 消费） */
  private storming = false;
  /** AI_007 局部 flag（:53532-53547 定义）快照 = 雨/夜/日食/史莱姆雨/(风暴且地表)。
   *  坐姿回家与开门掷门（:54578 `(Next(10)==0 | flag)` 第二操作数）共用；每 tick
   *  在 sitFlag 计算处同步写入。★2026-08-31 台账批新增 */
  private homeFlag = false;
  /** ai[0]==25 上升态只读（渲染/测试消费） */
  get shimmerRising(): boolean { return this.shimmerRise; }

  // ---- 游走双态（AI_007 ai[0]==0 站定 / ==1 行走 + ai[1] 计时，NPC.cs:54032-54278）----
  /** 0 站定（停程）/ 1 行走（走程）——社交/攻击/坐姿态外层互斥另列 */
  private walkMode: 0 | 1 = 0;
  /** ai[1]：当前态剩余 tick（走程 200+Next(300) / 停程 300+Next(300)+Next(900)） */
  private walkT = 60;
  /** localAI[3] 转身锁（随机转身 200t :54185 / 起身 30+rand(60) :54707 /
   *  溺水跳出记 position.X 后复用为跳点回位门 :54432——数值语义随消费点变体） */
  private turnLock = 0;
  /** 无家者游走锚（原版 homeTileX/Y 首落地锚 NPC.cs:53701-53704：homeless NPC
   *  的 homeTile 仍是出生点，拴绳/回家以它为锚；本仓 home=null 表无家）。
   *  ★SW-BO1 2026-09-07 起公开：= 原版 homeless NPC 的 homeTile 权威投影
   *  （vanilla QuickFindHome 以 NPC【自身】homeTile 为扫描锚——入驻环 ① face
   *  与流浪生成位 QuickFindHome 消费；y 恒为地行/vanilla homeTileY 口径） */
  anchorTile: { x: number; y: number } | null = null;
  /** 旧游走计时（已退役驱动位——保留字段防外部引用破坏；语义=停程剩余近似） */
  wanderT = 0;
  /** 溺水跳出记录的跳点 X（:54427 localAI[3]=position.X；回到该点 → 转身防横跳） */
  private jumpBackX = Number.NaN;

  // ---- 社交/表演态（AI_007 ai[0]∈{2,3,4,6,7,9,16,17,19,20,21,22}，NPC.cs:55630-55835
  //      掷骰 + :54175/:54830 站定/推进 + FindFrame :69454-69689 表演帧）----
  /** 当前社交态（null=无）。kind 对应原版 ai[0]：2 发呆 / 3,4 结对聊天（发起/
   *  应答）/ 6 派对舞 / 7 面向玩家 / 9 驻足看家具 / 11 海盗闲坐拨弄（229 掷入）
   *  / 16,17 石头剪刀布（发起/应答）/ 18 酒馆老板扔麦酒演出（550 掷入）/
   *  19 回应玩家表情（EmoteBubble.CheckForNPCsToReactToEmoteBubble 置入 :161-166）/
   *  20,21,22 城镇宠物表演三态（★对抗修复批③ F7 新增：AttemptToPlayIdleAnimations-
   *  ForPets 掷入 NPC.cs:56320-56354，掷入口 = 站定态到家臂/walkT∈[100,150]
   *  两处——推进与退场和原版一样落在 :54830 共段族）/ 24 树妖 Stardew 彩蛋
   *  施法演出（HaveDryadDoStardewAnimation :19220 置入）。20-22 为新增档，
   *  不与既有任何 kind 占位重叠 */
  social: {
    kind: 2 | 3 | 4 | 6 | 7 | 9 | 11 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 24;
    t: number;            // ai[1] 态倒计时
    other: TownNPC | null;  // ai[2] 对偶 NPC（3/4/16/17）
    frameT: number;       // frameCounter（表演帧时间线，逐 tick +1）
    prevFrame: number;    // 上一帧号（舞蹈音符尘的 −5→−4 切换检测）
    pc?: number;          // 宠物表演帧行循环计数器（FindFrame 的 frameCounter 影子,
                          // 仅 kind 20-22 消费；与 frameT 分立防时间线互踩）
    rpsA: number;         // localAI[2]（RPS 计分，:55675-55676）
    rpsB: number;         // localAI[3]
  } | null = null;

  // ---- NPC 液体宿主（npcLiquid.updateNpcLiquid 每 tick 写；Enemy 侧同款）----
  wet = false;
  wetCount = 0;
  honeyWet = false;
  shimmerWet = false;
  lavaWet = false;
  onFireT = 0;
  onFire3T = 0;
  inWater = false;
  /** liquidMoveFactor 每 tick 写（水 .5/蜜 .25/微光 .375/岩浆 .5）——moveAndCollide 消费 */
  liqFactor = 1;
  /** NpcLiquidHost.def 占位（splashSoundAllowed 的 boss 档） */
  readonly def = { boss: false };
  /** NpcLiquidHost.vanilla 占位（aiStyle 7 = AI_007 城镇族） */
  readonly vanilla = { aiStyle: 7, noGravity: false };
  /** NpcLiquidHost.ai0（skipsWet 消费：aiStyle7+ai0==25 微光上升不沾水） */
  get ai0(): number {
    return this.shimmerRise ? 25
      : this.social ? this.social.kind
        : this.sitting ? 5
          : this.atkState !== 0 ? this.atkState
            : this.corneredT > 0 ? 8 : this.walkMode;
  }

  /** 掷骰器（每次调用读当前 Math.random——测试 stub 后构造的 NPC 同样受控；
   *  可注入确定序列） */
  rng: () => number = () => Math.random();

  /** 社交态只读（测试/探针消费） */
  get socialKind(): number { return this.social?.kind ?? 0; }
  /** 开门后待关门旗（closeDoor :55638 flag32 的 partner 门消费） */
  get doorCarry(): boolean { return this.closeDoor; }
  /** 游走态只读（0 站定 / 1 行走；测试消费） */
  get walking(): boolean { return this.walkMode === 1; }
  /** 测试/读档注入：直接置走态（原版 ai[0]=1、ai[1]=t、localAI[3]=0） */
  setWalking(t: number): void { this.walkMode = 1; this.walkT = t; this.turnLock = 0; }
  /** 测试注入：直接置站定态（原版 ai[0]=0、ai[1]=t；★R3 拴绳只在站定臂生效） */
  setStanding(t: number): void { this.walkMode = 0; this.walkT = t; this.turnLock = 0; }

  /** 生命（原版城镇 NPC 可被陷阱弹幕误伤：vanilla-npcs.json lifeMax 250 / defense 15） */
  hp: number;
  maxHp: number;
  iframes = 0;
  // ★清偿刀 W1（2026-10-01）：justHit 显式载体（原版 ResetEffects 每 tick 复位
  //  NPC.cs:8534 / StrikeNPC 受理置真 :82103）。旧近似「iframes===10」(:1872-74)
  //  键于 hurt 通用档写位——鞭写梯清窗（immune[owner]=0,Projectile.cs:14175-14178
  //  usesLocal 主支）后 iframes=0,近似面丢失=鞭×微光转化镇民衰减档(−0.1/t :92650)
  //  假阴。受理 hurt 恒置 1、tick 头读后递减——与旧近似在全部既有路径逐位同相
  //  （10t 档写 10→首拍头真;同拍双伤复核/force 直击通道/xMas 清算同真）。
  justHitT = 0;
  // ---- 自卫攻击（AI_007 攻击态 ai[0]=10/12/14/15,NPC.cs:54747-55538）----
  /** 当前攻击态(0 空闲 / 10 近战弹 / 12 弓 / 14 魔法 / 15 挥击) */
  private atkState = 0;
  /** ai[0] 攻击态只读（AI_007 :54747 起的 10/12/14/15；原版同值）——渲染侧消费：
   *  drawPartyHat 海盗帽位修正（Main.cs:27001-27008 的 229 ai[0]==12 门）。
   *  坐姿 ai[0]==5 由 sitting 布尔建模（渲染侧 n.sitting?5:attackState 还原 ai0）；
   *  二者互斥：坐姿不满足攻击触发门 flag31 的 ai[0]<2（:55769），攻击态中不入座 */
  get attackState(): number { return this.atkState; }
  /** ai[2] 持械瞄准值（DrawNPCExtras :27121 消费 = 武器旋转 ai[2]×90°×朝向；
   *  :55191-55197 发射档取目标方向 Y 钳 ±0.5，态尽归零）——弓族攻击态持械绘制用 */
  get holdoutAim(): number { return this.holdAim; }
  /** world.flags.hardMode 缓存（攻击Update 每 tick 刷新）——持械表 pre/hm 选档用 */
  get hardMode(): boolean { return this.hardModeFlag; }
  /** ai[1] 态倒计时只读（AttackType3 挥砍渲染 GetSwingStats 消费） */
  get attackTimer(): number { return this.atkTimer; }
  /** localAI[3] 态内 tick 只读（AttackType2 光环 4 帧动画相位消费） */
  get attackTick(): number { return this.atkTick; }
  /** ai[0]==14 施法态进行中（★BJ256 2026-09-21：AI_111 弹体 owner 存活门
   *  Projectile.cs:41873 `type != 20 || ai[0] != 14f` 的本仓承接——DryadWardRingShot
   *  每 tick 直读,树妖离开施法态=光环弹即刻熄灭,与原版 Kill 同相） */
  get wardCasting(): boolean { return this.atkState === 14; }
  /** ai[2]：入态种子（弓族 cs:56052-59 = vector8.Y）+ 弓族连发推进档 flag28
   *  带内回写（cs:55382-91,±0.5 带外保留旧值——★对抗修复批⑤ A6）;其余态恒 0,
   *  态尽 exitAttackCommon 归零 */
  private holdAim = 0;
  /** ai[1]:态倒计时(AttackTime) */
  private atkTimer = 0;
  /** localAI[1]:触发冷却(flag31 门) */
  private atkCd = 0;
  /** localAI[3]:态内 tick 计数 */
  private atkTick = 0;
  /** 当前发射档 num46/55/65(连发升级链推进) */
  private atkNextShot = 0;
  private atkBurstIdx = 0;
  /** ★对抗修复批⑤ A3（2026-09-01）：209 电子人逐弹冷却缓存。
   *  原版 SelectRandom(134,133,135) 在 ai[0]==12 参数块内【每 tick】求值
   *  （cs:55138-55160——num51 随拍刷新,态内持续耗流,对齐 NPC.cs SelectRandom
   *  常驻调用位序）;num55/maxValue2 由 switch 按【本拍选中弹】覆写（135:30/10,
   *  133:10/1, 134:20/10）,退出块 cs:55362-55366 直读本拍终值:
   *  ai[1]=num55+Next(maxValue2) / localAI[1]=localAI[3]=num55/2+Next(maxValue2)。
   *  本仓发射档前每 tick 掷 kind 存此,退出时 exitAttackCommon 覆写参消费——
   *  非 209 / 非态 12 时恒 undefined。 */
  private cyborgRoll?: { kind: number; cdBase: number; cdRand: number };
  /** 树妖祝福光环弹 586 弹龄（AI_111 自身 ai[0]——出生(atkTick 24)起计，>=570 熄灭；
   *  半径渐扩 300→600→1200 的相位源）。非树妖恒 0 */
  private wardT = 0;
  /** world.flags.hardMode 缓存(attackUpdate 每 tick 刷新) */
  private hardModeFlag = false;
  /** 633 狼人态缓存(attackUpdate 每 tick 刷新,ShouldBestiaryGirlBeLycantrope
   *  NPC.cs:94961-94972:血月夜或满月[moonPhase==0]夜)——发射端换 proj 929 +
   *  dmg×1.5 截断(:54782-54785) */
  private werewolfFlag = false;
  // ---- 原 localAI[2]/num16/num17 载体（2026-08-31 对齐批,挥击退出链消费）----
  /** 原 localAI[2]：入攻击态前一拍 ai[0]（0 站定/1 行走/8 被逼停）。四入态支
   *  `localAI[2]=ai[0]` 写入（:55966/:56028-56029/:56057-56058/:56102）、挥击
   *  退出链读 `(localAI[2]==8)&flag16 → 复位被逼停`（:55680）与 `||localAI[2]==8f`
   *  前探豁免（:55650） */
  private prevAi0 = 0;
  /** 机械师 124 侦察弹归属 tag（首次发射时取号;== -1 未发射）——localAI[0] 的
   *  「owned 弹在途」判定键,cyborgProbeAlive/shootAt 共用 */
  private probeTag = -1;
  /** 危险扫描候选池快照（num16/num17，见 ThreatPoolSnapshot 注）——挥击
   *  「换敌再接」候选(:55652-55658)、入态选靶与态内发射瞄准（C2 统一）共用。
   *  dangerUpdate 每 tick 全量重建；引用可指向已消亡敌（消费端无 .active 门，
   *  见 ThreatRef 注/B1②）。 */
  private threatPool: ThreatPoolSnapshot = { left: null, right: null };
  /** 原 flag17：本拍候选中出现 stinky 敌怪/玩家（:54045-47/:54090-92）。唯一
   *  消费点 = 攻击触发门 flag31 的 `!flag17` 因子（:55769——有臭源在场时城镇 NPC
   *  不发起自卫攻击,逃跑面不受影响）。flag18 恒 false（全文无置位,死旗）,
   *  `(flag16|flag18)` 恒等于 flag16 本身。 */
  private dangerStinky = false;
  /** 原 flag16 的【原始】值：本拍危险扫描命中即 true，未经 PrettySafe 收口
   *  （收口只发生在非攻击态的逃离支内 :53998-54002 原地清 flag16；攻击态
   *  10..15 与其并列互斥,不落那段）。挥击退出链 :55646 判定须用原始位 */
  private threatRaw = false;
  /** 原 flag15：宽窗【准入】位。num12 只作扫描准入（对话+挥击族扩 ≥250，
   *  NPC.cs:54036-54038 设置 / :54033 Distance<num12 准入 / :54037 置位）；真实威胁
   *  面（flag16/侧选/候选簿记/PrettySafe 收口）仍锁 num11——:54040-54041
   *  `>= num11 continue` 在置位前截断。唯一消费点 = 对话朝向门 :54177
   *  `if (flag5 && num9!=0 && !flag16 && !flag15)`。（★蓝队 F4①：旧实现把 250 扩程
   *  误用于全部威胁簿记与收口面，已按双窗拆开。） */
  private admitWide = false;
  /** per-enemy 挥击免疫锁（原 npc.immune[myPlayer] = (int)ai[1]+2 的本仓等价:
   *  id → 剩余 tick,fixedUpdate 每 tick 递减）。键 = Enemy.id */
  private swingImmune = new Map<number, number>();
  /** 医师治疗弹在途载体（aiStyle 110 弹,NurseSyringeShot 入 projectiles 桶后由
   *  其自身 fixedUpdate 推进;这里仅存触发期引用供受击取消用——原版弹独立于
   *  发射者存活,发出去之后不被回收） */
  private activeSyringe: NurseSyringeShot | null = null;
  /** 医师 ai[0]==13 治疗目标（ai[2] 直读位的对象引用;态外 null） */
  private healPatient: TownNPC | null = null;
  /** ai[0]==13 态倒计时 ai[1]（入态 34 = AttackTime[18]，:55999-56000） */
  private healT = 0;
  /** ai[0]==13 态内拍 localAI[3]（发弹档 ==1，:55371） */
  private healTick = 0;

  /** 医师 ai[0]==13 治疗态进行中（NurseHealUpdate 承接;测试/渲染消费） */
  get healing(): boolean { return this.healPatient !== null; }
  /** 治疗目标（态外 null） */
  get healTarget(): TownNPC | null { return this.healPatient; }
  // 表情气泡:字段/掷骰已退役——统一走 render/EmoteBubble 模块(spawnEmote,
  // 并行会话 1:1 版);空闲随机冒泡由 Game.tickNpcEmotes 窗口喂(双画修复 2026-08-13)
  // ---- 环境与互殴受击(NPC.cs :91538 族调用点的三件套)----
  /** 岩浆专属冷却(原版 immune[255]=30,Collision_LavaCollision 1456 :94516 = 1457
   *  :94458,赋值 :94528/:94470；红蓝-D 2026-09-18 锚勘误——原 :94522 陈旧；
   *  npcLiquid.updateNpcLiquid 共写——NpcLiquidHost 公有字段) */
  lavaCd = 0;
  /** NPC 互殴专属冷却(原版 immune[255]=num(30),BeHurtByOtherNPC 1456 :93638 =
   *  1457 :93588,赋值 :93653/:93603；红蓝-D 2026-09-18 锚勘误——原「GetHurtByOtherNPCs
   *  :93667」混版陈旧;初始 0) */
  private npcVsCd = 0;
  /** 树妖结界 buff 165 剩余 tick（原版 buffType/buffTime 单槽近似——树妖祝福
   *  光环每 10t 续 120（弹 586 AI_111 :38806-38812）；hurt 防御 +20/15/10
   *  （1457 :53552/:53556/:53560）+ 荆棘反伤 num5/3（dryadWard 枝 1456 :93654-65 =
   *  1457 :93604-11,⌊num5/3⌋ :93606;红蓝-D 2026-09-18 锚勘误——原 :53401-53411/
   *  :93666-93681 均混版陈旧）两消费枝的载体） */
  dryadWardT = 0;
  /** 溺水呼吸(NPC.CheckDrowning :96118:初始 200,水内每 7t -1,离水 +3/t) */
  private breath = 200;
  private breathCounter = 0;
  /** friendlyRegen 计数（NPC.cs:6578 声明）。CheckLifeRegen 族 :93622-93641：受伤期
   *  （life<lifeMax）每 tick 累加回血率 = 基础 1 + dryadWard 10 + 型别表 {22 向导:+5,
   *  209 电子人:+9}，>180 清零并 life++（静默,无飘字/音效）；溺水伤害 tick 清零
   *  (:96069)。老人 type==37 不入族（:91592-91600 门 `type != 37 && (friendly…)`）。
   *  ★F10 蓝队移植；ward 第三消费枝即此 dryadWard 加速枝（前两枝 = hurt 防御
   *  +20/15/10 与荆棘反伤 ⌊实伤/3⌋）。 */
  private lifeRegenCounter = 0;
  // ---- 危险逃离（AI_007 危险扫描 NPC.cs:53864-54024 + 逃速 :54319-54326 +
  //      被逼停冻结 ai[0]==8 :54597-54603/:54682-54690）----
  /** 本 tick 危险评估 = flag16（扫描命中且未被 PrettySafe 收口，:53876/:53998） */
  private dangerNear = false;
  /** num15 最近敌所在侧（-1 左 / 1 右，:53960-53963）——逃离向 = −dangerSide */
  private dangerSide = 0;
  /** 本 tick 逃走中（friendly && flag16 → 逃速提档，:54319-54326） */
  private fleeing = false;
  /** ai[0]==8 被逼停：前方跳不过且逃命中 flag27 → ai[1]=240 冻结（:54727-54732）；
   *  态内 ai[1]--、<60 且仍在险(flag16 原始位) → 续 180（:54830-54837）——站定但
   *  仍可还击（触发门 flag31 含 ai[0]==8，:55769）；解冻 = 危险侧换到面前
   *  （direction==−num15，:54107-54116）；攻击态中簿记挂起、退出经
   *  exitAttackCommon 收尾（2026-08-31 对账批②，见 update 内 cornered 门注）*/
  private corneredT = 0;
  /** ai[0]==8 只读（渲染/测试消费） */
  get cornered(): boolean { return this.corneredT > 0; }
  /** 无位移卡墙计数（★对抗修复批①2026-09-01 对齐 cs:54789-54804：连续 ≥30 拍
   *  触发一次后清零再积；原版载体重用 localAI[2]） */
  private stuckT = 0;
  /** 拽起防重坐锁：危险扫描踢出坐姿的原刻阻止 sittingUpdate 走 TryForcingSitting
   *  再坐回（原版扫描先改 ai[0]=1 → 当刻坐姿块整段跳过，:53990 vs :54682） */
  private sitKickLock = 0;

  constructor(key: string, x: number, y: number,
    _inventory?: import('../items/Inventory').Inventory) {
    super();
    this.npcKey = key;
    const town = TOWN_NPC_IDS[key];
    this.vanillaId = town?.id ?? 22; // 未登记 key 兜底向导贴图
    const v = VANILLA_NPCS[String(this.vanillaId)];
    // ★碰撞盒按型同步（原版 SetDefaults width/height）：Town Cat/Bunny 官方
    // 18×20、Dog 18×28——此前硬编码 Entity 默认 20×42,小动物顶着两格高盒
    // 会卡进矮门(2026-08-30 用户实拍)
    if (v?.width) this.w = v.width;
    if (v?.height) this.h = v.height;
    this.x = x;
    this.y = y - this.h;
    this.givenName = newNpcName(this.vanillaId);
    this.maxHp = this.hp = v?.lifeMax ?? 250;
    // 第 4 参 = 签名兼容位（既有调用/测试按 4 参构造传入 Inventory——本仓城镇
    // NPC 商店库存由 Game 统一层持有，实体不消费此参）
    void _inventory;
  }

  /** 被陷阱弹幕等命中：dmg − defense×0.5（下限 1），10 tick 无敌帧
   *  （Projectile 侧 npc.immune[owner]=10 同档）；死亡即移除——"重生"由入驻轮
   *  承担（原版 UpdateTime_SpawnTownNPCs：不在场且条件满足 → 重新入驻，≈次日
   *  回归），无需独立重生系统。防御 = defDefense + 进度链（AI_007 头部每 tick
   *  defense = defDefense 起步逐旗累计 :53419-53534，受击时现算等价；dryadWard
   *  :53401-53412 树妖结界 buff 165 本仓无载体，登记）。击退 = StrikeNPC
   *  （1456 :82183-82241 = 1457 :82216-82312）：kb×kbResist 软帽链（resist 逐型取
   *  VANILLA_NPCS,SW-AF1 2026-09-04 F-1 补——旧版缺乘恒按 1）→ 大伤害门
   *  （dmg×10>lifeMax 叠加+上抛）/ 常规门置换 vx=kb×hitDir×resist、
   *  vy=−kb×0.75×resist（二次乘=原版 :82304/:82310）
   *
   *  ★穿甲契约（2026-08-31 对齐批④：Player.cs:44700 → 本接收端；GA 波次按此接线）：
   *    hurt(dmg, kbX, kbY, game, penPercent?, flatPen?)
   *      penPercent —— armorPenetrationPercent（浮点 0..1，Player.cs:44702
   *        FlyMeal(5129) 打 isLikeATownNPC 时传 1f）；省略/0 = 原版缺省档，
   *        完全向后兼容（trunc(def×0)=0 → pool≤0 早退 → 加成 0、行为不变）。
   *      flatPen   —— armorPenetration 平值池（StrikeNPC :12068 =
   *        玩家 GetArmorPenetration(melee) + 弹幕自带 arpen；近战面 = 玩家
   *        equipStats.armorPen）。默认 0。
   *    应用序（原版一字不差）：num3 += checkArmorPenetration(flat, pct)——池 =
   *      flat + trunc(def×pct)（NPC.cs:81927），pool>def 钳 def/2、pool≤0||def≤0
   *      早退 0（:81929-81938；本仓直用 projStatus.npcCheckArmorPenetration 同式，
   *      ichor/brokenArmor/betsysCurse 三支为城镇 NPC 无载体的 debuff 位→{} 面）；
   *    再入 CalculateDamageNPCsTake：max(1, num3 − def×0.5)（Main.cs:67126-67131，
   *    double 不取整）；末位 StrikeNPC_Inner 的 (int)Math.Max(1.0,
   *    CalculateDamageNPCsTake(Damage,defense)*(!crit?1:2))（NPC.cs:82067）——暴击
   *    乘法发生在【截断前】的 double 上、整体一次性 (int) 截断（★蓝队 F6：旧
   *    "先 round 再 ×2"使奇防每击多伤 0~1，已废）。
   *    与 Enemy.hurt 的既有 pen 链同序。
   *
   *   ★参数序警示：hurt(dmg,kbX,kbY,game,penPercent?,flatPen?,crit?,force?) 第 5/6/7 参与
   *   Enemy.hurt（armorPen 前置位、penPercent 居后段第 9 参）语义错位——未来把城镇
   *   受害弹幕从 Enemy.hurt 改道至此传参时必须按本签名核对（当前无此类调用方，
   *   纯防御性备注）。
   *
   *  ★force（★C1，第 8 参缺省 false）：绕过 dontTakeDamage 早退的内部直击通道——
   *   仅溺水致死一击使用。原版 StrikeNPCNoInteraction(owner=255)（NPC.cs:82012 →
   *   :82017 StrikeNPC 全链）【不查】dontTakeDamage（该旗只在 Projectile.Damage/
   *   GetHurtByOtherNPCs 等调用方门禁消费）——微光上升态(ai[0]==25)内 CheckDrowning
   *   的 StrikeNPCNoInteraction(2) 照常结算可致死。
   *  ★X1 face 2（第 9/10 参,缺省关闭）：fromPlayer/srcProjId——TryDoingOnHitEffects
   *   （Projectile.cs:13640-43 `ownedBySomeone && targetNPC.life > 5` → Player.OnHit
   *   :6912-7040）的城镇靶受理面。gate 细节见函数体 face 2 块注。 */
  hurt(dmg: number, kbx: number, _kby: number, game: GameHooks,
    penPercent = 0, flatPen = 0, crit = false, force = false,
    fromPlayer = false, srcProjId = 0): boolean {
    if (this.dead) return false;
    // force=true = 内部直击通道(StrikeNPCNoInteraction owner=255 同形):不查
    // 无敌帧也不查 dontTakeDamage(原版 StrikeNPC 全链两者皆不读)
    if ((this.iframes > 0 || this.shimmerRise) && !force) return false;
    // ★IIIII223 F-8：owner=255∧Damage≥9999 静默判据——NPC.cs:82065
    //   `bool flag = Damage >= 9999 && owner == 255`。StrikeNPCNoInteraction 形参无
    //   owner 通道（:82012 缺省 255）→ JS 全部 StrikeNPCNoInteraction 调用面（毁灭
    //   清算 Game.ts:11731 / 圣诞自灭 :2017 / DoT 致死 / 出界面 F3 / 巫毒娃娃烧毁
    //   ItemDrop.checkLavaDeath）恒 owner=255 同形,以【入参原值】dmg 判（须在下方
    //   dmg 被防御/暴击重算覆写前快照）。
    //   ★BJ-C6/F1（2026-10-06 随 BJ502 三谓词形态统一）：补 owner 维度——原版
    //   玩家/远端来源走 Projectile.cs:13702 `ownedBySomeone ? owner : 255`（owner=
    //   玩家位≠255 → 门开照飘）;hostile/陷阱弹 owner=255 → 门闭静默。本仓 owner 255
    //   位承载 = !fromPlayer（hitTownNpcs source==='playerProj' 传 fromPlayer=true;
    //   BJ502 的 pendingStrikeOwner 远端通道对 TownNPC 结构性缺位——netApplyStrike
    //   只扫 enemies 桶,访客城镇 NPC=Enemy 傀儡）→ 静默 = dmg≥9999 ∧ !fromPlayer,
    //   force 通道（调用面恒 fromPlayer=false）保持静默。
    //   flag 只憋两处：:82078 `if (!flag && lifeMax > 1)` CombatText 飘字、
    //   :82199 `if (netMode != 1 && !flag)` NPCDamageTracker（本仓无此记账面）——
    //   清算击杀不冒 9999 大字（原版系统致杀静默）;死亡/击退/ai 复位不受门影响
    const strikeSilent = dmg >= 9999 && !fromPlayer;   // ★BJ-C6/F1
    this.lastStrikeDealt = 0;   // ★X1：入口清零（Enemy.hurt 习语——拒收路径不残留陈值）
    // ---- ★X1 face 2：TryDoingOnHitEffects（Projectile.cs:13640-43）城镇靶受理面 ----
    //  原文：`if (ownedBySomeone && targetNPC.life > 5) TryDoingOnHitEffects(targetNPC);`
    //  → Player.OnHit（Player.cs:6912-7040）。门序：ownedBySomeone ≈ fromPlayer（hostile
    //  弹 owner=255 走不到 :13640）;`life > 5` 读【受击前】值——本块置于 hp 扣减前
    //  =快照位（Enemy.hurt α-H4 同式）。效果逐支（Player.OnHit 全 5 支,与 Enemy.hurt
    //  内联块同构;stardust 613 反击支在 MinionProj 侧,同 Enemy 面登记）：
    //  · 钛金风暴 flag 门 = 488 ∪ SpawnedFromStatue ∪ cd>0——城镇 NPC 两项天然不含;
    //  · 幻影闪避/帕拉钯再生/山铜花瓣无受害者的豁免;
    //  · 叶绿水晶叶支 :6988 `victim.CanBeChasedBy` 门——城镇 NPC friendly 恒假
    //    （projTargets.canBeChasedBy）→ 城镇靶【结构性排除】,不接（原版同相）;
    //  · 来源排除表 {221,227,614,729,908,977}（TryDoingOnHitEffects :15210-15220）。
    if (fromPlayer && dmg > 0 && this.hp > 5
      && !(srcProjId > 0 && ON_HIT_EXCLUDED_PROJS.has(srcProjId))) {
      const pl = game.player as unknown as {
        dead?: boolean; cx?: number; cy?: number; titaniumStormCd?: number;
        shadowDodgeTimer?: number; petalTimer?: number;
        buffs: { apply(t: number, s: number): void };
        equipStats?: { titaniumStorm?: boolean; onHitDodge?: boolean;
          onHitRegen?: boolean; onHitPetal?: boolean };
      } | null | undefined;
      if (pl && !pl.dead) {
        if (pl.equipStats?.titaniumStorm === true && (pl.titaniumStormCd ?? 0) <= 0) {
          pl.titaniumStormCd = 10;                     // titaniumStormCooldown=10（:6928）
          pl.buffs.apply(306, 10);                     // AddBuff(306,600t)=10s（:6929）
          game.spawnTitaniumShard?.(pl.cx ?? 0, pl.cy ?? 0);
        }
        if (pl.equipStats?.onHitDodge === true && (pl.shadowDodgeTimer ?? 0) <= 0) {
          pl.buffs.apply(BuffType.ShadowDodge, 30);    // AddBuff(59,1800t)=30s（:6938）
        }
        if (pl.equipStats?.onHitRegen === true) {
          pl.buffs.apply(BuffType.RapidHealing, 5);    // AddBuff(58,300t)=5s（:6943）
        }
        if (pl.equipStats?.onHitPetal === true && (pl.petalTimer ?? 0) <= 0) {
          game.spawnOnHitPetals?.(this.cx, this.cy);   // :6964 petalTimer=20 在 Game 端
        }
      }
    }
    // ↑ ai[0]==25 dontTakeDamage 承接位(= :53736 块：复位 dontTakeDamage=false
    //   :53736 + if(ai[0]==25f) 置真 :53738-39——★1457 锚行校准,非 :53596);force
    //   仅溺水致死一击使用
    const prog = townNpcProgressionFromWorld(game.world);
    prog.tipsy = this.tipsy;
    const defBase = VANILLA_NPCS[String(this.vanillaId)]?.defense ?? 15;
    let def = defBase + townNpcProgressionBoost(prog).defenseBonus;
    // 树妖结界防御枝（AI_007 头部 :53401-53411）：dryadWard → 大师 +20 / 专家 +15 /
    // 其余 +10（与原版同读当帧难度档）
    if (this.dryadWardT > 0) {
      def += game.world.isMaster ? 20 : game.world.isExpert ? 15 : 10;
    }
    // ★对齐批④：穿甲加成先进伤（Player.cs:44762 `num3 += checkArmorPenetration`）
    // 再走防御减算（Main.cs:67126）。
    // ★蓝队 F6（2026-08-31）终形：CalculateDamageNPCsTake 是【double 不取整】面
    // （Main.cs:67126-67131：num=Damage−Defense×0.5，<1 钳 1）；末位
    // (int)Math.Max(1.0, calc*(!crit?1:2))（NPC.cs:82067）——暴击乘法在截断前的
    // double 上、一次性 (int) 截断。旧"round 后再 ×2"使奇防（def×0.5 带半值）
    // 每击多伤 0~1（如 40+7−7.5=39.5：原版 39/暴击 79，旧式 40/80）。双精度后截断：
    const penAdd = npcCheckArmorPenetration(def, flatPen, penPercent, {});
    let calc = dmg + penAdd - def * 0.5;
    if (calc < 1) calc = 1;
    // ★R-B-F4(2026-10-13):mod 承伤值链(防御结算后/暴击前=tML ModifyIncomingHit 域;
    //  Enemy.hurt :15026 同族——旧=城镇域整缺,DR 族 mod 对城镇 NPC 不生效)
    calc = Math.max(1, Math.trunc(runModNpcIncomingHit(this as never, calc)));
    dmg = Math.trunc(calc * (crit ? 2 : 1));
    this.hp -= dmg;
    this.lastStrikeDealt = dmg;   // ★X1 face 4：num41 等位（StrikeNPC 返值=防后实扣）
    this.iframes = 10;
    this.justHitT = 1;   // ★W1：受理 StrikeNPC 置真（NPC.cs:82103）——含 force 通道
    // ★对齐批①：受击打断医师治疗态——原版 StrikeNPC 的 townNPC 分支直接改写
    // ai[0]=1（NPC.cs:82148-82157），治疗态同理被打断；弹已离手（独立实体）不受
    // 影响（aiStyle110 弹与发射者解耦）。本仓其余「转身走开」面维持既有 hurt
    // 语义不变（全批回归口径），只收窄到治疗态取消这一处。
    if (this.healPatient) {
      this.healPatient = null;
      this.healT = 0;
      game.behavioLog?.('nurseHeal', { phase: 'interrupted', id: this.id });
    }
    game.recLog?.('hurt', { id: this.id, vid: this.vanillaId ?? null, dmg, hp: this.hp });   // 行为录制：城镇 NPC 受击
    // ★IIIII223 F-8 静默门（:82078 `if (!flag && lifeMax > 1)`）——飘字+血粒子（本仓
    //  StrikeNPC 尘近似,原版无独立粒子臂,随飘字同门）在 owner=255 大伤清算面不触发
    if (!strikeSilent && this.maxHp > 1) {
      // 飘值色 = CombatText.DamagedFriendly(255,80,90)/DamagedFriendlyCrit(255,100,30)
      // （CombatText.cs:8/:10，NPC.StrikeNPC :82082 消费面）——单源 fx/CombatTextColors
      game.addDamageNumber(this.cx, this.y, dmg, crit,
        crit ? COMBAT_TEXT_DAMAGED_FRIENDLY_CRIT : COMBAT_TEXT_DAMAGED_FRIENDLY);
      // 受击血粒子(原版 StrikeNPC 尘近似,与 Enemy.hurt 同规)
      game.spawnParticles(this.cx, this.cy, '#B01818', 5, 1.4, { life: 22, grav: 0.06 });
    }
    // 击退（StrikeNPC 1456 锚 :82143-82241 = 1457 :82216-82312）：hitDirection = sign(kb)
    // SW-AF1 2026-09-04（F-1）：补 knockBackResist 乘——原版整段单门
    // `knockBack > 0f && knockBackResist > 0f`（1457 :82216）,num3 = knockBack×resist
    // （:82218）,常规门置换支 num3【再】乘一次 resist（:82304/:82310——二次乘=原版
    // 如此,Enemy.ts:13475-13476 同款）。resist 值源 = VANILLA_NPCS（vanilla-npcs.json
    // SetDefaults 逐型:向导 22=0.5f=NPC.cs:9089、商人 17=0.5f、机械师 0.5f…缺省 1f
    // = NPC.cs:8561）。kb=0 或 resist=0（不可击退型）整段跳过——旧版 kb=0 时大伤害门
    // 的 `if (vy < 0) vy = 0` 会误清上升速度,双门补上后自然消除。
    // onFire2 ×1.1（:82219-82222）城镇 NPC 无诅咒焰载体不接。
    // ★SW-AO1 2026-09-05：大伤害门补专家 ×15 臂（NPC.cs:82255-82259 原文位次——
    //   `int num8 = num * 10; if (Main.expertMode) { num8 = num * 15; } if (num8 > lifeMax)`，
    //   在 kb 软帽链/暴击 ×1.4 之后、Y 加法钳区内：门真=叠加+上抛衰减档,门假=常规门置换支。
    //   num = 实伤（StrikeNPC_Inner :82067 def/暴击后）= 本仓 dmg（防御/暴击已结）。
    //   Main.expertMode 在大师档恒真（Main.cs 难度轴 expertMode ⊇ masterMode）→
    //   world.isExpert（mainDifficulty≥EXPERT,ScaleStats.ts:206）即原版语义,非
    //   "expert 专属、master 不接"。×15 使门在专家/大师更易开启（阈值 lifeMax/15）,
    //   仅经击退速度可观测（1457 StrikeNPC 无 bitDamaged 出参,SW-G1 结论不变）。
    const kbr = VANILLA_NPCS[String(this.vanillaId)]?.knockBackResist ?? 1;
    const hd = kbx < 0 ? -1 : 1;
    if (Math.abs(kbx) > 0 && kbr > 0) {                 // :82216 双门
      let kb = knockbackCap(Math.abs(kbx) * kbr);       // :82218 ×resist → 五段软帽链
      if (crit) kb *= 1.4;                              // :82251-82254 暴击 ×1.4（帽后,F-4 命中面）
      const num8 = dmg * (game.world.isExpert ? 15 : 10);   // :82255-82259（SW-AO1）
      if (num8 > this.maxHp) {
        // 大伤害门（:82260-82298）：叠加 + 双倍上抛衰减档（Y 加法钳 = vy>num3 才追加）
        if (hd < 0 && this.vx > -kb) {
          if (this.vx > 0) this.vx -= kb;
          this.vx -= kb;
          if (this.vx < -kb) this.vx = -kb;
        } else if (hd > 0 && this.vx < kb) {
          if (this.vx < 0) this.vx += kb;
          this.vx += kb;
          if (this.vx > kb) this.vx = kb;
        }
        const vyKb = kb * -0.75;                        // :82290（城镇 NPC 恒有重力,-0.5 档不适用）
        if (this.vy > vyKb) {
          this.vy += vyKb;
          if (this.vy < vyKb) this.vy = vyKb;
        }
      } else {
        // 常规门（:82300-82311）：置换式,resist 二次乘
        this.vx = kb * hd * kbr;
        this.vy = -kb * 0.75 * kbr;
      }
    }
    if (this.hp <= 0) {
      this.dead = true;
      game.recLog?.('death', { id: this.id, vid: this.vanillaId ?? null });   // 行为录制：城镇 NPC 死亡
      // ★BJ561 死亡公告（NPC.checkDead townNPC 支 :78942-78974）：广播须在死亡
      //   演出（音效 :78990/NPCLoot :78999/active=false :79029）之前——原版位次
      //   = NPCLuck(:78944)→文本(:78949-78956)→墓碑(:78969)→广播(:78973)→
      //   裁缝巫毒 Skeletron(:78975)→锁复位(:78986)→死亡音(:78990)
      // ★BJ562（2026-10-09）BJ561 登记债清偿：NPCLuck + 城镇死亡墓碑按原版位次
      //   补入（Luck→文本→墓碑→广播;文本单源 deathNetworkText 供碑文/公告共用）。
      //   :78942 门 `townNPC && type != 37 && type != 453` 罩全支——老人/骷髅商
      //   死亡无运算/无碑/无公告（broadcastDeathMessage 内部门 BJ561 既有,双保险）。
      if (this.vanillaId !== 37 && this.vanillaId !== 453) {
        this.npcLuckOnDeath(game);
        const deathText = this.deathNetworkText();
        this.dropTombstoneTownNpc(game, deathText);
        this.broadcastDeathMessage(game, deathText);
      }
      // 死亡复位优先型锁（NPC.cs:78986-78989 `townNPC && netMode!=1 && homeless &&
      // WorldGen.prioritizedTownNPCType == type → =0`）——homeless 死者锁住的类型
      // 若不复位会滞留至下一轮首（UpdatePrioritizedTownNPC 只在有 homeless 者时改写,
      // 无人合格不写），晨间 SpawnHomelessNPC 会按死者类型复生同一型。★SW-BO1 2026-09-07
      game.townNpcPrioritizedLockReset?.(!this.home, this.vanillaId);
      game.spawnParticles(this.cx, this.cy, '#C03030', 8, 2);
      game.spawnParticles(this.cx, this.cy, '#8A1818', 4, 1.2);
      // checkDead 死亡音（NPC.cs:78978-78982）：PlaySound(DeathSound, position)
      // 满响——per-NPC 数据驱动（城镇宠物 637/656=NPCDeath6 等,曾硬编码
      // NPC_Killed_1 ×0.8,2026-08-18 对齐）；type 229 海盗且微光变体
      // （IsShimmerVariant = townNpcVariationIndex==1 = 本仓 shimmered）→
      // NPCDeath6 特判保留（数据层无变体区分）
      const deathFiles = vanillaSoundFiles(VANILLA_NPCS[String(this.vanillaId)]?.DeathSound) ?? ['NPC_Killed_1'];
      game.playSfxFiles?.([this.vanillaId === 229 && this.shimmered ? 'NPC_Killed_6' : deathFiles[0]], 1);
      this.voodooSkeletronOnDeath(game);
      // 掉落求值（NPC.checkDead → NPCLoot_DropItems :79653，ItemDropDatabase 城镇
      // NPC 条目）：具名纪念品（NamedNPC——Andrew 向导 867 绿帽 / Whitney 蒸汽朋克
      // 4372 / Jim 画家 5290，1/1）+ 帽子族 1/8（207/227/441 帽 3349/3350/3351）+
      // 裁缝 260/公主 5065(hardMode) 等。钱币/心星管线跳过（城镇 NPC value=0）
      this.townNpcDeathDrops(game);
      // ★BJ574（2026-10-08）checkDead case 22（NPC.cs:80176-80181）：向导(22)死亡时
      // 本体盒 Collision.LavaCollision → SpawnWOF(自身位置)——浸浆烫死（岩浆
      // StrikeNPCNoInteraction(50)/30t，NPC.cs:94528-94533）等「死于岩浆中」的一切
      // 死法都召。巫毒链向导恰浸浆时与 ItemDrop.checkLavaDeath 的 SpawnWOF(物品位)
      // 双调，由 spawnWOF 内 AnyNPCs(113)/已有墙门收口为一只（原版同相，:81114）。
      this.wofLavaDeathCheck(game);
    } else {
      // StrikeNPC 受击音 = per-NPC HitSound 满响（曾硬编码 NPC_Hit_1 ×0.6）
      const hitFiles = vanillaSoundFiles(VANILLA_NPCS[String(this.vanillaId)]?.HitSound) ?? ['NPC_Hit_1'];
      game.playSfxFiles?.(hitFiles, 1);
    }
    // ★D20-m5(2026-10-13):城镇 NPC 受击派发(tML OnHitNPC 全域对;死亡支含在
    //  this.dead 旗内=killed 真值;值=防后实扣与 lastStrikeDealt 同源;melee 探针=
    //  srcProjId===0 近战惯例[本面无 pierce 位]。零注册零成本)
    if (fromPlayer) runModOnHitAny(this as never, game, { damage: dmg, crit, killed: this.dead, projId: srcProjId, melee: srcProjId === 0 });
    runModOnNpcHitByAny(this as never, game, { damage: dmg, crit, killed: this.dead, projId: srcProjId });
    // ★D20-m5:mod 击杀钩在 onHitByAny 之后(m3 tML 序同款;死亡支/存活支共用本出口,
    //  this.dead 旗判别;per-NPC 先/global 后;城镇 NPC 含 mod townNPC 声明域)
    if (this.dead) {
      runModOnNpcDeath(this.vanillaId, this as never, game as never);
      runModOnKillAnyNpc(this as never, game as never);
    }
    return true;
  }

  /** ★BJ561 城镇 NPC 死亡公告（NPC.checkDead townNPC 支 :78942-78974 → ChatHelper.
   *  BroadcastChatMessage :78973 → DisplayMessage → Main.NewTextMultiline 左下角
   *  消息列）。定谳面（1457 亲读）：
   *  · 门 = `townNPC && type != 37 && type != 453`（:78942）——老人 37（骷髅王
   *    诅咒傀儡）与骷髅商 453 死亡静默。本仓 37/453 都是 TownNPC 实体
   *    （TOWN_NPC_IDS old_man/skeleton_merchant）→ 两排除位都是真消费。
   *  · 文本 = NetworkText.FromKey(Lang.misc[num6].Key, fullNetName)（:78956）：
   *    常规 = LegacyMisc.19 "{0} was slain..."（zh "{0}被杀死了……"）；
   *    渔夫 369 / 公主 663 / 城镇宠物 = LegacyMisc.36 "{0} has left!"（zh
   *    "{0}已离开！"）——num6=36 同支把墓碑旗 flag 置 false（:78951-78955）。
   *    IsTownPet 全表 = 637 猫/638 狗/656 兔/670 蓝史莱姆/678-684 城镇史莱姆族
   *    （NPCID.cs:4446）。
   *  · fullNetName = GetFullNetName（:7376-7383，HasGivenName=_givenName.Length!=0
   *    :6765）= 具名 ? NetworkText.FromKey("Game.NPCTitle", given, type) : 类型名；
   *    en "{0} the {1}" / zh "{1}{0}"（Renderer.ts:15556 FullName 同式）。
   *  · 颜色 = ChatColors.Death (255,25,25)（ChatColors.cs:15）恒色——血月/入侵
   *    无变体（该支仅此一处着色；玩家死亡 (225,25,25) 是 Player.cs:39222 另一支）。
   *  · 广播单口 = game.chatBroadcast（ChatHelper.BroadcastChatMessage 等价面：
   *    本地消息列 + 联机 channel2 系统行中继——同玩家死亡 Game.ts:51029/
   *    沙滩球踢次 BallProjs.ts:249 形）。
   *  · ★BJ562（2026-10-09）债面已清偿：墓碑（dropTombstoneTownNpc——
   *    DropTombstoneTownNPC :79082-79108,全员 hardcore 才落 :78957-78972）与
   *    NPCLuck（npcLuckOnDeath——:78944 瓢虫运消算,Luck.ts LuckState.npcLuck）
   *    已按原版位次补入。 */
  private broadcastDeathMessage(game: GameHooks, deathText?: string): void {
    if (this.vanillaId === 37 || this.vanillaId === 453) return;      // :78942 排除
    game.chatBroadcast?.(
      deathText ?? this.deathNetworkText(),
      255, 25, 25);                                                    // ChatColors.Death
  }

  /** ★BJ562 死亡文本单源（:78949-78956 NetworkText.FromKey(Lang.misc[num6].Key,
   *  fullNetName) 等价串）——公告与墓碑碑文（miscText）共用：原版两处同一
   *  NetworkText（:78956 构造 → :78971 传 DropTombstoneTownNPC → :79107
   *  miscText=deathText.ToString();碑文无日期,与玩家面 :39455-39461 分野）。 */
  private deathNetworkText(): string {
    const typeName = Lang.npcName(this.vanillaId) ?? this.npcKey;
    const fullName = this.givenName
      ? Lang.text('Game.NPCTitle', this.givenName, typeName)           // :7382
      : typeName;                                                      // :7380
    return Lang.text(this.petStyleDeath() ? 'LegacyMisc.36' : 'LegacyMisc.19', fullName);
  }

  /** num6=36 宠物便支谓词（:78951-78955）——同支把墓碑旗 flag 置 false（宠物不落碑） */
  private petStyleDeath(): boolean {
    return this.vanillaId === 369 || this.vanillaId === 663
      || NPC_IS_TOWN_PET.has(this.vanillaId);
  }

  /** ★BJ562（2026-10-09）NPCLuck（NPC.cs:78944-78946 `if (Main.netMode != 2)` 门
   *  ——单机/客户端态恒走,专写本地玩家）→ LuckState.npcLuck（Luck.ts 面 1:1：
   *  向导 22 延瓢虫好运 43200/3=14400t、其余城镇死亡缓瓢虫厄运 -10800/3=-3600t、
   *  护士 54 排除）。player.active 本仓单槽恒真（原版 Main.player[myPlayer].active）。 */
  private npcLuckOnDeath(game: GameHooks): void {
    game.player.luckState?.npcLuck(this.vanillaId, true, game.player.dead);
  }

  /** ★BJ562（2026-10-09）城镇 NPC 死亡墓碑（NPC.checkDead townNPC 支 :78957-78972
   *  触发门 + DropTombstoneTownNPC :79082-79108 弹面）：
   *  · 宠物便支（petStyleDeath,:78951-78955）flag=false 不落;
   *  · 全员 hardcore 门（:78960-78970）：遍历存活玩家,任一 active 玩家
   *    difficulty != 2 → 旗假（死亡玩家仍 active 仍计——原版循环无 dead 门）;
   *    本仓玩家集 = candidatePlayers（本地+联机代理,M11 槽序）缺省单机单人;
   *    空活人集旗保持真=落（原版同相,循环不中不翻旗）;
   *  · 弹面 = Tombstone 城镇构造支（商人 17/税收官 441 恒金 527+rand(5),
   *    余 43(1/6) 或 200+roll;damage 0 纯物理;碑文=死亡文本无日期）,
   *    出射口 spawnTownNpcTombstone（props 桶,玩家死亡墓碑同桶）。 */
  private dropTombstoneTownNpc(game: GameHooks, deathText: string): void {
    if (this.petStyleDeath()) return;                       // :78951-78955 flag=false
    const players = game.candidatePlayers?.() ?? [game.player];
    for (const pl of players) {
      if (pl.appearance?.difficulty !== 2) return;          // :78963-78969 任一非 hardcore
    }
    game.spawnTownNpcTombstone?.(
      new Tombstone(this.cx, this.cy, 0, deathText, 0, false, this.vanillaId));
  }

  /** 城镇 NPC 死亡掉落（NPC.checkDead → NPCLoot_DropItems :79653——vanilla-
   *  nppcdrops.json 城镇条目求值；Enemy.die 同链紧凑版）。ctx 与 Enemy 侧同构：
   *  friendly=true、value=0（城镇 NPC NPC_VALUE 表无值 → 不掉钱）、boss=false、
   *  npcGivenName=givenName（NamedNPC 条件——具名池抽中 Andrew/Whitney/Jim 才掉
   *  专属纪念品，Conditions.cs:957-981）。心/星/钱管线 value=0 不产。 */
  private townNpcDeathDrops(game: GameHooks): void {
    const w = game.world;
    const p = game.player;
    // 运行时掷骰流（Enemy 侧用 UnifiedRandom 注入的同一 RNG 类；城镇死亡无
    // 重播需求，随机种子即可）
    const rng = new RNG((Math.random() * 0x7fffffff) | 0);
    const ctx: NpcDropCtx = {
      rng, netId: this.vanillaId, type: this.vanillaId,
      isExpert: w.isExpert, isMaster: w.isMaster,
      hardMode: !!w.flags.hardMode, crimson: !!w.crimson,
      flags: w.flags,
      x: this.cx, y: this.cy,
      worldSurfaceTile: w.groundLevel, rockLayerTile: w.rockLevel,
      underworldTileY: w.lavaLine || w.h - 200,
      maxTilesX: w.w, maxTilesY: w.h,
      lifeMax: this.maxHp, friendly: true, boss: false,
      damage: VANILLA_NPCS[String(this.vanillaId)]?.damage ?? 10,
      value: npcValueOf(this.vanillaId),
      hp: p.hp, hpMax: p.maxHp, mana: p.mana, manaMax: p.maxMana,
      luck: p.luck,
      npcGivenName: this.givenName || undefined,
      extras: game.dropContext?.(),
    };
    for (const d of resolveDrops(ctx).drops) {
      const key = VANILLA_ITEM_KEY_BY_ID[d.id];
      // ★BJ311（2026-09-23）初速对拍（Item.NewItem 默认支 Item.cs:49756-49764）：
      //  原版 NPC 掉落初速=随机弹跳（vx=Next(-30,31)×0.1，vy=Next(-40,-15)×0.1
      //  向上弹；[Obsolete] 整型重载 :49727 中心语义不变）。Enemy.die 同款
      //  dropVelocity 通道（Enemy.ts:14763/14782）；城镇通道曾固定 (0,-2) →
      //  无水平散布，岩浆烫死旅商时商贩帽直上直下落回浆面必烧（配 BJ311 前的
      //  拾取窗死锁=用户实报「岩浆烫死旅商不掉商贩帽」合成根因之一）。
      if (key) {
        const v = dropVelocity(rng, d.id);
        game.spawnDrop(this.cx, this.cy, key, d.n, v.vx, v.vy);
      }
    }
  }

  /** ★BJ574（2026-10-08）checkDead case 22（NPC.cs:80176-80181）1:1：type 22 死亡时
   *  `Collision.LavaCollision(position, width, height)` → SpawnWOF(position)。
   *  盒相交判据用向导自身盒（原版同参），深度门 pos.Y/16<maxTilesY-205 与在场门
   *  AnyNPCs(113)/Main.wofNPCIndex 都在 spawnWOF 内部（bossAI_wof :81114 同源）——
   *  向导死于地表/洞穴浆池不召、已有墙在场不召、地狱岸上死（无岩浆相交）不召。
   *  调用位 = 死亡块尾（原版 switch(type) 在 NPCLoot/active=false 之后同相）。
   *  判别面 tests/bj574-voodoo-lava-wof.test.ts ⑤/⑤'。 */
  private wofLavaDeathCheck(game: GameHooks): void {
    if (this.vanillaId !== 22) return;
    if (!lavaCollision(game.world.store, this.x, this.y, this.w, this.h)) return;
    spawnWOF(game, this.x, this.y);
  }

  /** 裁缝巫毒娃娃 1307 死亡召唤（NPC.cs:78958-78967）：!day && type==54 &&
   *  !AnyNPCs(35) 且存在 active 未死 killClothier 玩家 → SpawnSkeletron。
   *  落位（SpawnSkeletron :81220-81270）：扫场上 37/54 取 position+size/2 传
   *  NewNPC——本钩子必由 54 自身触发，锚点=自身；NewNPC 的 Bottom 语义
   *  （:81547 nPC.Bottom=(X,Y)）把"裁缝中心Y"当底 Y → 头部上提半个裁缝身位，
   *  1:1 保留。redHatMode（37 夜间对话召唤，ai[3]=1 令老人消失）不涉本路径。
   *  公告 Announcement.HasAwoken + ChatColors.BossOrEvent(175,75,255)，无 Roar
   *  （SpawnSkeletron 不发声，区别于 SpawnOnPlayer 各 case）。boss 槽 =
   *  spawnWOF 先例（bossAI_wof）：击败链 bossBlock/downed_35 公告消费。 */
  private voodooSkeletronOnDeath(game: GameHooks): void {
    if (game.world.clock.isDay || this.vanillaId !== 54) return;
    if ((game.enemies() as Enemy[]).some((n) => !n.dead && n.vanillaId === 35)) return;
    const p = game.player;
    if (!p || p.dead || !p.equipStats.killClothier) return;   // :78963 active && !dead && killClothier
    const head = spawnVanillaEnemy(game, 35, this.cx, this.cy);
    if (!head) return;
    head.x = this.cx - head.w / 2;   // NewNPC(Bottom=X,Y) ← 中心X/中心Y
    head.y = this.cy - head.h;
    (game as unknown as { boss?: Enemy | null }).boss = head;
    (game as unknown as { announce?: (k: string, w: string, r: number, g: number, b: number) => void })
      .announce?.('Announcement.HasAwoken', Lang.npcName(35) ?? 'Skeletron', 175, 75, 255);
  }

  /** 战斗书增益（NPC.cs:53419-53430：每本 lifeMax+250 / 伤害出力×0.8 / 移速+0.25 /
   *  防+8——伤害/移速两项无对应战斗系统，落 lifeMax/防；每本可叠加，由调用方按旗标次数调） */
  applyCombatBook(): void {
    this.maxHp += 250;
    this.hp = Math.min(this.maxHp, this.hp + 250);
  }

  /** ★X1 face 1：debuff DoT 逐拍结算（UpdateNPC_BuffApplyDOTs :92577-92847 等价,
   *  DOTTally 速率面与 Enemy.fixedUpdate 同构——城镇 NPC 原版同一 DoT 环,NPC.cs
   *  :91484 lifeRegenCount 对全体 NPC 结算）。速率（HP/s）：onFire 4(:92616) /
   *  onFire3 15(:92632) / frostburn2 25(:92668) / poison 6(:92584) / venom 30(:92703) /
   *  cursed 24(:92684) / potentAcid 90(:92751 AddPoison(180,60)) / eelWhip 50(:92781
   *  裸 Add 不可加速）。可加速池（398,SupportAcceleration :127-131 → :92840-92847）
   *  = AddPoison/AddBloodLoss/AddFlamable 三族 = 毒(20/70/395)+六火系(24/39/323/324);
   *  裸 Add（362）不吃。Slimed(137) 六火系翻倍（AddFlamable :113-115）。扣血面 =
   *  裸 hp 减（DoT 不过防御/iframes——原版 lifeRegen 独立管线）,致死经 force hurt
   *  走完整死亡链。视觉 = 六火系火焰尘（★BJ437 起真尘直生——UpdateNPC_BuffApplyVFX
   *  城镇同环逐系独立 75%/拍,尘型 6/6/75/135,见环尾）+ DoT 飘值（LifeRegenNegative
   *  小字档,'#FF8C28'）。 */
  private tickDebuffs(dt: number, game: GameHooks): void {
    const slimedMul = this.slimedT > 0 ? 2 : 1;
    const accelMul = this.acceleratePoisonsT > 0 ? 2 : 1;
    if (this.onFireT > 0) { this.onFireT -= dt; this.onFireDoT += 4 * slimedMul * accelMul * dt; }
    if (this.onFire3T > 0) { this.onFire3T -= dt; this.onFire3DoT += 15 * slimedMul * accelMul * dt; }
    if (this.frostburn2T > 0) { this.frostburn2T -= dt; this.frostburn2DoT += 25 * slimedMul * accelMul * dt; }
    if (this.cursedT > 0) { this.cursedT -= dt; this.cursedDoT += 24 * slimedMul * accelMul * dt; }
    if (this.poisonT > 0) { this.poisonT -= dt; this.poisonDoT += 6 * accelMul * dt; }
    if (this.venomT > 0) { this.venomT -= dt; this.venomDoT += 30 * accelMul * dt; }
    if (this.potentAcidT > 0) { this.potentAcidT -= dt; this.potentAcidDoT += 90 * accelMul * dt; }
    if (this.eelWhipT > 0) { this.eelWhipT -= dt; this.eelWhipDoT += 50 * dt; }
    if (this.slimedT > 0) this.slimedT -= dt;
    if (this.acceleratePoisonsT > 0) this.acceleratePoisonsT -= dt;
    if (this.ichorT > 0) this.ichorT -= dt;
    if (this.midasT > 0) this.midasT -= dt;
    // 小数累计结算（⌊acc⌋ 扣血,DOTTally 家族同式）
    for (const dKey of ['onFireDoT', 'onFire3DoT', 'frostburn2DoT', 'poisonDoT',
      'venomDoT', 'potentAcidDoT', 'cursedDoT', 'eelWhipDoT'] as const) {
      const acc = this[dKey];
      if (acc >= 1) {
        const n = Math.floor(acc);
        this[dKey] = acc - n;
        this.applyDoT(n, game);
        game.addDamageNumber?.(this.cx, this.y, n, false, '#FF8C28', true);
      }
    }
    // 六火系火焰尘（★BJ437 2026-10-02 改真尘直生——UpdateNPC_BuffApplyVFX 城镇同环
    //  :91488 对全体 NPC 调用:逐系独立 Next(4)<3=75%/拍,同帧多系并存各发各的;
    //  旧「fireOn 合并 75% 单掷泛色方块」近似退役。形态=Enemy 火焰族共形（盒 pos−2
    //  +4、v=velocity×0.4、α100、scale3.5、noGravity→×1.8→Y−0.5→1/4 翻重力+×0.5）。
    //  城镇可达四系：onFire 6(:92356)/onFire3 6(:92372)/cursed 75(:92621)/
    //  frostburn2 135(:92605);frostburn(44) 载体未建=X1 台账债（尘随载体一并补）。
    //  点光面（:92366 等 AddLight）城镇侧缺位=登记债。）
    const flameDust = (dustId: number) => {
      const d = game.spawnDust?.(this.x - 2, this.y - 2, this.w + 4, this.h + 4,
        dustId, this.vx * 0.4, this.vy * 0.4, 100, null, 3.5);
      if (d) {
        d.noGravity = true;
        d.vx *= 1.8; d.vy *= 1.8;
        d.vy -= 0.5;
        if (Math.floor(Math.random() * 4) === 0) { d.noGravity = false; d.scale *= 0.5; }
      }
    };
    if (this.onFireT > 0 && Math.random() < 0.75) flameDust(6);
    if (this.onFire3T > 0 && Math.random() < 0.75) flameDust(6);
    if (this.cursedT > 0 && Math.random() < 0.75) flameDust(75);
    if (this.frostburn2T > 0 && Math.random() < 0.75) flameDust(135);
  }

  /** DoT 裸扣（无防御/无 iframes——原版 lifeRegen 独立管线）+ 致死走 force hurt
   *  （StrikeNPCNoInteraction(9999) 同形：owner=255 静默判据 strikeSilent 不飘大字,
   *  force 绕无敌帧保证死亡落地,死亡链/drops/音效全走 hurt 内置段）。 */
  private applyDoT(n: number, game: GameHooks): void {
    this.hp -= n;
    if (this.hp <= 0) this.hurt(9999, 0, 0, game, 0, 0, false, true);
  }

  private cbApplied = false;

  /** buff 25 Tipsy 剩余 tick（NPC.buffType/buffTime 单槽近似——本仓城镇 NPC 无
   *  buff 栏,只为 num2 链建此单槽）。唯一施加点 = 麦酒弹 669 Kill 爆炸
   *  （Projectile.cs:68725-68734 AddBuff(25, 3659),酒馆老板 550 自卫投掷,
   *  TownShot.kill669 落点）;每 tick 递减（NPC.cs:93174 lowerBuffTime）,归零
   *  即失效（:93333 整段重置）。消费:进度链 tipsy 位（num2×1.1/num3×0.9 链尾
   *  :53552-53557）+ 醉酒气泡金尘（:92349 rand(4)==0 且 rand(2)==0 → 净 1/8） */
  tipsyT = 0;

  /** NPC.AddBuff(25, ticks)（同 buff 合并取更长剩余——标准 buffTime 合并语义） */
  applyTipsy(ticks: number): void {
    if (ticks > this.tipsyT) this.tipsyT = ticks;
  }

  /** 本 tick 的 NPC.tipsy 位（:93179 buff25 在列 → true）。快照语义：原版
   *  递减（:93174）后置位——剩余 1t 的最后一 tick 仍 true,次 tick 才 false */
  private tipsyNow = false;

  get tipsy(): boolean { return this.tipsyNow; }

  /** buff 119 Lovestruck 剩余【秒】（2026-09-29 刀B：TownNPC buff 承载最小面）。
   *  单位与 Enemy.lovestruckT 同族 = applyBuffTicks 写入口径（ticks/60,SUPPORTED
   *  [119]='lovestruckT' 单一写入面——本字段即 projStatus.ts 119 映射的城镇 NPC
   *  承载位,此前 TownNPC 无此字段,ThrowKillFx.applyAura 圈支对城镇 NPC 写空）。
   *  唯一施加源 = 爱情药水 2352→弹 370 消亡 80px 圈（Projectile.cs:78947-78956
   *  NPC 循环 AddBuff(119,1800t) → ThrowKillFx.applyAura 对 enemies/critters/
   *  npcs 三桶统一,applyBuffTicks 内 max 合并）。每 tick 递减 = UpdateNPC
   *  :91484 UpdateNPC_BuffSetFlags(lowerBuffTime :93099-93102)→:93181 置位
   *  loveStruck（:91483 FlagsReset :93295 复位——本仓递减后 >0 即本 tick 在位）。
   *  消费:①头爱心 gore 331（UpdateNPC_BuffApplyVFX :92455-92466,fixedUpdate
   *  同步 block）②幸福价 ×0.9（ShopHelper.cs:103-106——vanillaHappiness
   *  .computeHappiness 在 remix/368/453/37/宠物提前 return 门【之前】乘,消费点
   *  = Game.computeShopHappiness 快照进 dialogHappiness.priceMul） */
  lovestruckT = 0;

  // ---- ★清偿刀 X1（2026-10-01）face 1：城镇 NPC debuff 载体最小面 ----
  //  锚：Damage_PVE_Inner :13634 StatusNPC(victimIndex) 对城镇靶【同面】（巫毒窄门
  //  :11970-11972 过门后无条件段）——原版城镇 NPC 有完整 buffType/buffTime 五槽
  //  （NPC.AddBuff :91035 全体 NPC 同构,UpdateNPC_BuffSetFlags :93099 同环）,着火/
  //  中毒照吃 DoT。本仓沿 lovestruckT/tipsyT 单字段先例建【载体集】= 鞭受击面实际
  //  可达集（HitTownNpcs 巫毒拍写入面逐键定谳,勿当全 buff 系统用）：
  //  · ApplyWhipDebuffs（Projectile.cs:11067-11090）：323/324/20/362;
  //  · StatusNPC 鞭表（:11255-11272 火鞭 1104 → 137 Slimed 180t + 鞭尖窗 24）;
  //  · 催化指环（:11189-11196 → 398）;
  //  · 武器浸剂 meleeEnchant（:11197-11221 → 70+395/39/24/72/69/[31 城镇免疫被
  //    applyBuffTicks 的 npcImmuneTo 门拦]/20）。31 Confused：城镇 NPC 全员在
  //    DebuffImmunitySets [31]（vanillaNpcImmunity.ts 22/17/18/19/20…）→ 不建载体。
  //  单位=秒（applyBuffTicks 写入口径,ticks/60）。DoT 消费 = tickDebuffs
  //  （UpdateNPC_BuffApplyDOTs :92577-92847 等价,DOTTally 速率面 1:1）。
  //  ★onFireT/onFire3T 两载体已有（:1158 液体宿主面——岩浆上火/入水熄火,单位同
  //  秒）：本刀并入同一 tickDebuffs 结算环（旧形态液体上火无 DoT 无倒计时=潜在
  //  火不灭残账,就此一并收编）。
  frostburn2T = 0;         // 324 Frostburn2 25 HP/s（:92668-92680）
  poisonT = 0;             // 20 Poisoned 6 HP/s（:92584-92591）
  venomT = 0;              // 70 Venom 30 HP/s（:92703-92710）
  potentAcidT = 0;         // 395 PotentAcid 90 HP/s（:92751 AddPoison(180,60)）
  cursedT = 0;             // 39 CursedInferno 24 HP/s（:92684-92695）
  ichorT = 0;              // 69 Ichor 纯倒数（穿甲位在 hurt 的 npcCheckArmorPenetration {} 档不消费——登记）
  midasT = 0;              // 72 Midas 纯倒数（城镇 NPC value=0 掉钱面不存在）
  slimedT = 0;             // 137 Slimed 纯倒数+六火系 ×2 消费位（:92623 等）
  eelWhipT = 0;            // 362 EelWhip 50 HP/s 平铺（:92781 Add(100,50),裸 Add 不可加速）
  acceleratePoisonsT = 0;  // 398 可加速族 DoT ×2（:92840-92847）
  // DoT 小数累计器（DOTTally 家族：tick 累入 dps×dt、⌊acc⌋ 扣血保小数,同 Enemy）
  private onFireDoT = 0;
  private onFire3DoT = 0;
  private frostburn2DoT = 0;
  private poisonDoT = 0;
  private venomDoT = 0;
  private potentAcidDoT = 0;
  private cursedDoT = 0;
  private eelWhipDoT = 0;

  /** ★X1 face 2 伴生：StrikeNPC 实扣值镜像（num41 等位,Enemy.lastStrikeDealt 同名
   *  同义）。入口清零/受理写实扣（防后）——ghostHealProc :13877 的 num41 消费端
   *  （face 4）读本面。 */
  lastStrikeDealt = 0;

  /** GetMagicAuraColor（★对抗修复批⑤ A11 行号考古：真锚 NPC.cs:53466 起,旧注
   *  ":53317-53332"/NPCID ":4853" 系错引——表定义体在 NPCID.cs:4859）1:1：
   *  NPCID.Sets.MagicAuraColor 五人恰好 = AttackType-2 魔法攻击族（54 裁缝/108 巫师/
   *  160 松露/20 树妖/663 公主；五人 TownNPCProfiles 全走 LegacyWithSimpleShimmer
   *  二档 StackedNPCProfile → variationIndex∈{0,1}，==1 ⟺ 微光变体）。
   *  townNpcVariationIndex==1（= 本仓 shimmered，IsShimmerVariant NPC.cs:6646-6650）
   *  → 160 R/B 互换、20 固定 (90,20,210)、663 固定 (255,0,77)。Color.ToVector3()
   *  丢弃 alpha → 三通道 0-1 归一（663 基色 = Main.hslToRgb(0.92,1,0.78) = 255,143,197）*/
  private magicAuraColor(): [number, number, number] {
    switch (this.vanillaId) {
      case 54: return [100 / 255, 4 / 255, 227 / 255];
      case 108: return [1, 80 / 255, 60 / 255];
      case 160: return this.shimmered ? [1, 80 / 255, 40 / 255] : [40 / 255, 80 / 255, 1];
      case 20: return this.shimmered ? [90 / 255, 20 / 255, 210 / 255] : [40 / 255, 1, 80 / 255];
      case 663: return this.shimmered ? [1, 0, 77 / 255] : [1, 143 / 255, 197 / 255];
      default: return [1, 1, 1];        // 集合缺省 Color.White（ToVector3 丢 alpha）
    }
  }

  /** 本 tick 点光（NPC.cs 城镇 NPC 侧三处恒亮；CastLights 锚 1456 :93520 = 1457
   *  :93470——红蓝-D 2026-09-18 行号勘误,原 935xx 系 1456 域）：
   *  - 160 松露（1456 :93546-93564 = 1457 :93496-93514）：num3=Next(28,42)×0.005+
   *    (270−mouseTextColor)/500，基色 (0.1,0.3+num3/2,0.6+num3)×0.35；变体 1
   *    （townNpcVariationIndex==1）R/B 互换——以 shimmered 承接（1457 :93503-93508）
   *  - 209 电子人（1456 :93582-93598 = 1457 :93532-93548）：同式抖动 ×0.35、B 基 0.4；
   *    ai[0]==12（火箭射击态，AttackType[209]=1 → ai0=12，NPC.cs:55902/:54936）
   *    追加 Top (0.3,0.1,0.1)（1456 :93594-93596 = 1457 :93544-93546）
   *    ——单槽逐通道 max 合并（Enemy.mergeLightRGB 同款近似）
   *  - 681 彩虹城镇史莱姆（AI_007 尾段 :55963-55974）= TorchColor(23)×0.35
   *  - 683 黄城镇史莱姆（:55974-55979）= (0.25,0.25,0.1)×WrappedLerp(0.75,1,t%120/120)
   *  条件态：魔法光环 ai[0]==14（:55394，num69=1 恒满档，atkState===14 承接）
   *  ×GetMagicAuraColor；ai[0]==24 树妖 Stardew 施法光（:55693-55694，
   *  HaveDryadDoStardewAnimation :19220 置入的彩蛋演出——2026-08-31 台账批补，
   *  social kind 24 承接；GetMagicAuraColor 全档直加， Center 处）；微光上升光
   *  :53637（ai[1] 30→90，shimmerRise 态内已接） */
  get lightRGB(): [number, number, number] | null {
    let rgb: [number, number, number] | null = null;
    // 逐通道 max 合并（原版同帧多 AddLight，单槽近似视觉并集；不挪光源位）
    const merge = (c: [number, number, number]) => {
      rgb = rgb ? [Math.max(rgb[0], c[0]), Math.max(rgb[1], c[1]), Math.max(rgb[2], c[2])] : c;
    };
    if (this.vanillaId === 160) {
      const n3 = (28 + Math.random() * 14) * 0.005 + (270 - mouseTextColorApprox()) / 500;
      const base: [number, number, number] = [0.1 * 0.35, (0.3 + n3 / 2) * 0.35, (0.6 + n3) * 0.35];
      // :93563-93567 变体 1（shimmered）→ R/B 互换（num7 交换 num4/num6）
      merge(this.shimmered ? [base[2], base[1], base[0]] : base);
    }
    if (this.vanillaId === 209) {
      const n3 = (28 + Math.random() * 14) * 0.005 + (270 - mouseTextColorApprox()) / 500;
      merge([0.1 * 0.35, (0.3 + n3 / 2) * 0.35, (0.4 + n3 / 2) * 0.35]);
      if (this.atkState === 12) merge([0.3, 0.1, 0.1]);   // :93594 火箭射击态 Top 追加光
    }
    if (this.vanillaId === 681) {
      const num = Math.min(1, Math.max(0, 0.9 + (270 - mouseTextColorApprox()) / 900));
      merge([num * 0.9 * 0.35, 0.55 * 0.35, num * 1.2 * 0.35]);   // TorchColor(23)×0.35
    }
    if (this.vanillaId === 683) {
      const p = (visEffectFrames() % 120) / 120;
      const tri = p * 2 > 1 ? 2 - p * 2 : p * 2;                   // Utils.WrappedLerp
      const l = 0.75 + 0.25 * tri;
      merge([0.25 * l, 0.25 * l, 0.1 * l]);
    }
    // 魔法光环（:55390-55396）：ai[0]==14 魔法攻击态内 num69=1 恒满档 → GetMagicAuraColor
    if (this.atkState === 14
      && (this.vanillaId === 54 || this.vanillaId === 108 || this.vanillaId === 160
        || this.vanillaId === 20 || this.vanillaId === 663)) {
      merge(this.magicAuraColor());
    }
    // 树妖 Stardew 施法光（ai[0]==24 块 :55693-55694）：GetMagicAuraColor() 全档直加
    // 于 Center——仅 type 20 可达该态（HaveDryadDoStardewAnimation :19224 循环体）
    if (this.social?.kind === 24) {
      merge(this.magicAuraColor());
    }
    // 微光上升光（:53637-53639）：Center 处 hslToRgb(t/360%1, 0.6, 0.65) ×
    // Remap(ai[1],30,90,0,0.7)——Remap 钳位使 ai[1]<30 时恒 0（无光）
    if (this.shimmerRise) {
      const k = remapClamped(this.shimmerRiseT, SHIMMER_RISE_VELOCITY_TICK, 90, 0, 0.7);
      const c = hslToRgb((visEffectFrames() / 360) % 1, 0.6, 0.65);
      merge([c[0] * k, c[1] * k, c[2] * k]);
    }
    return rgb;
  }
  lightRGBAt: { x: number; y: number } | null = null;

  /** bound 族 CheckActive 四步（NPC.cs:78698-78810 忠实重放;BJ122 2026-09-18）。
   *  几何口径与 Enemy.CheckActive 同源（共享 CHECK_ACTIVE_HALF_* 常量）:
   *  ①activeRange 盒（4032/2520 半幅 :6176-6178,+玩家半宽/半高=hitbox 相交等价
   *  改写,MINOR-1 同款）相交任一活跃玩家 → flag2 存活门;②屏幕盒（960+w/600+h
   *  :78691-78693）相交 → timeLeft=activeTime(750)+清 despawnEncouraged（bound
   *  无 EncourageDespawn 写点,旗省略）;③timer 每 tick 无条件 −1;④≤0 → flag2
   *  强制翻假（:78791-78794）→ 消散（noSpawnCycle=true :78797 + active=false
   *  :78798——bound 无尘无声,无 boss/蠕虫/挂载链）。零活跃玩家（测试桩）取
   *  Enemy 侧同款登记偏离:纯倒数归零,不当帧消散。 */
  private boundCheckActive(game: GameHooks, localPlayer: Player | null): void {
    const cands = (game.candidatePlayers?.() ?? (localPlayer ? [localPlayer] : []))
      .filter((q) => !!q);
    if (cands.length === 0) {
      if (--this.boundDespawnTimer <= 0) this.dead = true;
      return;
    }
    let flag2 = false;
    for (const q of cands) {
      if (Math.abs(q.cx - this.cx) < CHECK_ACTIVE_HALF_X + q.w / 2
        && Math.abs(q.cy - this.cy) < CHECK_ACTIVE_HALF_Y + q.h / 2) {
        flag2 = true;
        break;
      }
    }
    const screenHalfX = 960 + this.w, screenHalfY = 600 + this.h;
    const onScreen = cands.some((q) =>
      Math.abs(q.cx - this.cx) < screenHalfX + q.w / 2
      && Math.abs(q.cy - this.cy) < screenHalfY + q.h / 2);
    if (onScreen) this.boundDespawnTimer = 750;
    this.boundDespawnTimer--;
    if (this.boundDespawnTimer <= 0) flag2 = false;
    if (!flag2) {
      game.noSpawnCycleThisFrame = true;
      this.dead = true;
    }
  }

  /** ★BJ592 件2（2026-10-09）：FindFrame case 589（NPC.cs:71804-71892）被绑高尔夫
   *  球手自主练习挥杆链 1:1。原版 589=独立被缚型（aiStyle 0/18×34/13 帧表）,本仓
   *  以 bound TownNPC（vanillaId 588/体 18×40）承载——尘锚式取「足上 6px」相对
   *  语义（y+h−6;原版 height−6=34−6）。帧行链：row0 闲置 fc>Next(90,450) →
   *  row1-3 蓄力 fc>4（推进落 row≥4 且 Next(3)!=0 = 2/3 概率回弹 row0）→
   *  row4-6 fc>4 → row7 fc>Next(30,90) → row8-10 fc>3 快进（推进落 row【恰 9】拍
   *  挥杆击地:尘 32×4（Sand,NewDust(vector,1,1,32) 缺省速=内部随机化 ±2.0,锚=
   *  position.X+(dir==1?+30:−22), position.Y+height−6, :71839-71855）→ row11
   *  fc>Next(40,140) → row12 fc>6 → 越帧表回卷 0。腾空（vy≠0）帧 0+计数清零
   *  （:71808-71814;num27 先读后清=当拍仍按旧行走链,计数已归零故不推进——原版
   *  同相）。阈值 Next(40,140)/Next(30,90)/Next(90,450) 每 tick 现掷（原版
   *  Main.rand.Next 在比较式实参位逐拍求值）。 */
  private boundGolferFindFrame(game?: GameHooks): void {
    const num27 = this.frame;                                  // :71805 num27 = frame.Y/num
    this.frameT++;                                             // :71806 frameCounter++
    if (this.vy !== 0) {                                       // :71808-71814 腾空
      this.frame = 0;
      this.frameT = 0;
    }
    const fc = this.frameT;
    const roll = (a: number, b: number) => a + Math.floor(this.rng() * (b - a));
    if (num27 >= 12) {
      if (fc > 6) {                                            // :71815-71824
        this.frameT = 0;
        this.frame++;
        if (this.frame >= 13) this.frame = 0;                  // 越帧表（npcFrameCount[589]=13）
      }
    } else if (num27 >= 11) {
      if (fc > roll(40, 140)) {                                // :71826-71831
        this.frameT = 0;
        this.frame++;
      }
    } else if (num27 >= 8) {
      if (!(fc > 3)) return;                                   // :71833-71834 break
      this.frameT = 0;
      this.frame++;
      if (this.frame === 9) {                                  // :71839-71855 帧 9 到位
        const vd = game?.vanillaDust;
        if (vd) {
          const vx = this.x + (this.facing === 1 ? 30 : -22);
          const vy = this.y + this.h - 6;
          for (let j = 0; j < 4; j++) {
            vd.spawn(vx, vy, 1, 1, 32);                        // NewDust(vector,1,1,32) 缺省速/α/scale
          }
        }
      }
    } else if (num27 >= 7) {
      if (fc > roll(30, 90)) {                                 // :71856-71861
        this.frameT = 0;
        this.frame++;
      }
    } else if (num27 >= 4) {
      if (fc > 4) {                                            // :71867-71874
        this.frameT = 0;
        this.frame++;
      }
    } else if (num27 >= 1) {
      if (fc > 4) {                                            // :71875-71886
        this.frameT = 0;
        this.frame++;
        if (this.frame >= 4 && this.rng() >= 1 / 3) this.frame = 0;   // Next(3)!=0
      }
    } else if (fc > roll(90, 450)) {                           // :71887-71891
      this.frameT = 0;
      this.frame++;
    }
  }

  /** 685 BoundTownSlimeOld 专属：AI_001_Slimes 跳跃机（1457 NPC.cs;BJ122 2026-09-18）。
   *  原版本体即 aiStyle 1 敌怪型（:17641-17655 aiStyle=1/friendly/非 townNPC）——
   *  本仓 685 生成=spawnBound(685)→bound TownNPC 承载,站桩系 BJ122 定谳偏差。
   *  flag3（:61662-61667）=夜||损血||地下||史莱姆雨 → 索敌/追玩家;ai2 冷却只减到 1
   *  （:61873-61876）;init ai2==0 → ai0=-100,ai2=1,TargetClosest（:62115-62119）;
   *  wet 段（:62080-62116）碰底 vy=-2/浮起 vy 钳 -4/ai3 记下沉 X、上浮未移 → 反向+
   *  冷却 + wet&&ai2==1&&flag3 重瞄;贴地（velocity.Y==0 :62133）摩擦 ×0.8、ai0 每
   *  tick +1（flag3 再 +1 :61964-61968）;阶段表（num54=-1000 :62017-62040）:≥0 小跳
   *  (vy=-6,vx+=2dir,ai0=-1120) / [-1000,-500] 小跳(ai0=-2120) / [-2000,-1500] 大跳
   *  (vy=-8,vx+=3dir,ai0=-200);685 特支（:62287-62294）vy×0.5/vx×0.2+1/2 反向;
   *  大跳记 ai3=position.X（:62262）;滞空转向（:62120-62137）±0.2 步进/×0.93。
   *  贴地门=vy===0 原版字面（Enemy.slimeAI 同口径）;携物梯/弹射门/嵌固回退等
   *  685 不可达支未移（Enemy.slimeAI 为全量锚）。 */
  private boundSlimeHopUpdate(world: import('../world/World').World, bp: Player | null): void {
    const flag3 = !world.clock.isDay || this.hp < this.maxHp
      || this.y / TILE > world.groundLevel || !!world.weather.slimeRain;
    const faceTarget = () => {
      if (bp && !bp.dead) this.facing = bp.cx < this.cx ? -1 : 1;
    };
    if (this.boundHopAi2 > 1) this.boundHopAi2 -= 1;          // :61873-61876
    if (this.wet) {                                            // :62080-62116
      if (this.collideY) this.vy = -2;
      if (this.vy < 0 && this.boundHopAi3 !== 0 && this.boundHopAi3 === this.cx) {
        this.facing *= -1;
        this.boundHopAi2 = 200;
      }
      if (this.vy > 0) this.boundHopAi3 = this.cx;
      if (this.vy > 2) this.vy *= 0.9;
      this.vy -= 0.5;
      if (this.vy < -4) this.vy = -4;
      if (this.boundHopAi2 === 1 && flag3) faceTarget();       // :62113-62116
    }
    if (this.boundHopAi2 === 0) {                              // :62115-62119 init
      this.boundHopAi0 = -100;
      this.boundHopAi2 = 1;
      faceTarget();                                            // TargetClosest
    }
    if (this.vy === 0) {                                       // 贴地 :62133
      // 落地卡墙（:62141-62146）ai3==cx 精确相等 → 反向+冷却;ai3=0
      if (this.boundHopAi3 !== 0 && this.boundHopAi3 === this.cx) {
        this.facing *= -1;
        this.boundHopAi2 = 200;
      }
      this.boundHopAi3 = 0;
      this.vx *= 0.8;                                          // :61948-61952
      if (Math.abs(this.vx) < 0.1) this.vx = 0;
      if (flag3) this.boundHopAi0 += 1;                        // :61964-61967
      this.boundHopAi0 += 1;                                   // :61968（685 无加成表项）
      const num54 = -1000;                                     // :62017-62025
      let stage = 0;
      if (this.boundHopAi0 >= 0) stage = 1;
      else if (this.boundHopAi0 >= num54 && this.boundHopAi0 <= num54 * 0.5) stage = 2;
      else if (this.boundHopAi0 >= num54 * 2 && this.boundHopAi0 <= num54 * 1.5) stage = 3;
      if (stage > 0) {
        if (flag3 && this.boundHopAi2 === 1) faceTarget();     // :62042-62045
        if (stage === 3) {
          this.vy = -8;                                        // :62055-62059
          this.vx += 3 * this.facing;
          this.boundHopAi0 = -200;
        } else {
          this.vy = -6;                                        // :62062-62070
          this.vx += 2 * this.facing;
          this.boundHopAi0 = stage === 1 ? -120 + num54 : -120 + num54 * 2;
        }
        this.vy *= 0.5;                                        // :62287-62294 弱跳
        this.vx *= 0.2;
        if (Math.floor(Math.random() * 2) === 0) this.facing *= -1;
        if (stage === 3) this.boundHopAi3 = this.cx;           // :62262
      }
    } else if (bp && !bp.dead
      && ((this.facing === 1 && this.vx < 3) || (this.facing === -1 && this.vx > -3))) {
      // 滞空转向（:62120-62137）
      if ((this.facing === -1 && this.vx < 0.01) || (this.facing === 1 && this.vx > -0.01)) {
        this.vx += 0.2 * this.facing;                          // :62130-62133
      } else {
        this.vx *= 0.93;                                       // :62134-62137
      }
    }
  }

  fixedUpdate(dt: number, game: GameHooks) {
    // ★BJ647：坐姿态投影到物理体（unembedPass 让位面读 sitPose;TileCollision.ts
    //   Body.sitPose 字段注=本案定谳。不用 sitting 撞 Player.sitting 交互态）。
    //   每 tick 头同步:微光上升/被缚早退分支与主物理段三处 moveAndCollide 全覆盖。
    this.sitPose = this.sitting;
    // ★SW-BJ55 圣诞老人季末自灭（★1457 NPC.cs:53708,1458 同行号零漂移）：
    //   type==142 && Main.netMode!=1 && !Main.xMas → StrikeNPCNoInteraction(9999,0,0)
    //   ——圣诞窗（checkXMas Main.cs:13290：12/15-31 ∪ forceXMasForToday/Forever）
    //   关闭即死（endlessChristmas 种子 forceXMasForever 恒开窗不灭）。owner=255
    //   直击通道：不查无敌帧/dontTakeDamage → force=true;dmg≥9999 = 静默清算判据
    //   （NPC.cs:82065,hurt() 内 strikeSilent 同形）。netMode!=1=单机/服务器权威位,
    //   本仓城镇 NPC 模拟即权威侧（房主）,访客端 death 由同步面收敛。
    if (this.vanillaId === 142 && !game.world.clock.xMas) {
      this.hurt(9999, 0, 0, game, 0, 0, false, true);
      if (this.dead) return;
    }
    this.animT++;
    // per-enemy 挥击免疫锁递减（原 npc.immune[owner] 全帧统一倒计时,补齐批②）
    if (this.swingImmune.size > 0) {
      for (const [k, v] of this.swingImmune) {
        if (v <= 1) this.swingImmune.delete(k);
        else this.swingImmune.set(k, v - 1);
      }
    }
    // justHit 显式载体（★W1 替换旧「iframes===10」近似——鞭写梯清窗面丢失案,
    //  字段注见 hurt/声明处）：hurt() 受理置 1（NPC.cs:82103）,tick 头读后递减
    //  （=ResetEffects :8534 复位位次）——微光衰减 −0.1 档（:92650）消费同前。
    const justHit = this.justHitT > 0;
    if (this.justHitT > 0) this.justHitT--;
    if (this.iframes > 0) this.iframes--;
    // buff 25 Tipsy 递减（NPC.cs:93174 lowerBuffTime,UpdateNPC 每 tick 头部）+
    // 醉酒气泡金尘（:92349-92370：rand(4)==0 且 rand(2)==0 → 净 1/8,尘 4
    // 金 (245,200,30,155) alpha 75(+25×2 随机档) scale 0.9,vel×0.2 后 +0.2 下沉）
    if (this.tipsyT > 0) {
      // :93170 顶部守卫 time>0 → :93174 递减 → :93179 置位（递减后仍按本 tick 生效）
      this.tipsyNow = true;
      this.tipsyT--;
      if (Math.random() < 1 / 8) {
        game.spawnParticles(this.x - 2, this.y - 2, 'rgba(245,200,30,0.61)', 1, 0.3,
          { life: 40, grav: 0.005, size: 2 });
      }
    } else {
      this.tipsyNow = false;   // :93333 整段重置
    }
    // buff 119 Lovestruck 递减（:93099-93102 lowerBuffTime→:93181 置位 loveStruck,
    // 递减后 >0 即本 tick 在位）+ 头爱心 gore 331——★清偿刀 F 2026-09-29 单源化：
    // 发射式 = GorePiece.newLovestruckHeart（UpdateNPC_BuffApplyVFX :92455-92466,
    // 公式/掷序/调用侧三连全注在那边）。原版 :91488 该 VFX 环对【全体】NPC 调用
    // ——Enemy 桶同源复用;canDisplayBuffs 对城镇 NPC 恒 true（false 只在石巨人
    // 四件 245-248 :18042-18052）。视觉掷 = Math.random 豁免成员（头注清单）
    if (this.lovestruckT > 0) {
      this.lovestruckT -= dt;
      newLovestruckHeart(this.x, this.y, this.w, this.h);
    }
    // ★X1 face 1：debuff DoT 逐拍（UpdateNPC_BuffApplyDOTs 等价——lovestruck 同环,
    //  原版该层对全体 NPC 每 tick 运行）
    this.tickDebuffs(dt, game);
    // ★BJ259：踢出冷却递减（NPC.UpdateNPC :91434-91437 `if (lookForHomeTimeout > 0)
    //  lookForHomeTimeout--;` 每 tick 字面）
    if (this.lookForHomeTimeout > 0) this.lookForHomeTimeout--;
    // ★BJ-C6/F3（2026-10-06）：城镇 NPC 出界致死面（NPC.UpdateNPC :91439-91442）——
    //   `aiStyle==7 && position.Y > Main.bottomWorld-640f+height && netMode!=1 →
    //   StrikeNPCNoInteraction(9999,0,0)`。aiStyle==7 ⟺ 本类全成员（vanilla-npcs 表
    //   townNPC 全员 aiStyle=7,含被缚/城镇宠物族）;netMode!=1=权威域——本仓城镇 NPC
    //   fixedUpdate 不在访客端运行（TownNPC=Enemy 傀儡）,无需显式门。bottomWorld =
    //   store.h×16（WldHeaderFields 同式）;position.Y+height = 盒顶+盒高。原版序位 =
    //   UpdateNPC 头 lookForHomeTimeout 递减/TrySyncing 之后、AI 之前——读【上拍碰撞
    //   后】位置,故置于本行后（此前 repo 无此面=出界恒坠落滞留）。StrikeNPCNoInteraction
    //   同形 = force 直击通道（不查无敌帧/微光上升,dontTakeDamage 原版本就不查）+
    //   owner=255 静默（strikeSilent=dmg≥9999∧!fromPlayer,BJ-C6/F1 同门）。
    if (this.y > game.world.store.h * TILE - 640 + this.h) {
      this.hurt(9999, 0, 0, game, 0, 0, false, true);   // :91441 (9999,0f,0)
      if (this.dead) return;                            // 死亡链已走完,跳过本拍余下
    }
    this.teleportedHome = false;
    const world = game.world;
    // 战斗书增益一次性套用（后入驻的 NPC 在首 tick 补；使用书时对在场者即时叠）
    if (!this.cbApplied) {
      this.cbApplied = true;
      const books0 = (world.flags.combatBookWasUsed ? 1 : 0) + (world.flags.combatBookVolumeTwoWasUsed ? 1 : 0);
      for (let k = 0; k < books0; k++) this.applyCombatBook();
    }

    // ---- 城镇微光转化链 1:1（★1457 锚行校准：GetShimmered :92668/:92695-92711
    //      + AI_007 ai[0]==25 块 :53737-53820）。ramp lane = shimmering（buff 353
    //      在身，UpdateNPC_BuffSetFlags :93255-64）——st +0.01/t（:92634-36），
    //      >0.9 → GetShimmered（:92637-39，约 91t 渐隐非即刻）；城镇分支置 st=0.89
    //      并进 ai[0]=25 上升态（ai[0..3] 清零 ：92700-03、st=0.89 :92705、摘 buff 353
    //      :92706-10 → 本仓 shimmerBuffT=0）。
    //      上升态 = 落点传送 → ai[1]≥30 起 −1/60/t 衰减 + velocity.Y=−4×st 上浮 →
    //      st 归零后翻转微光变体 + 到场粒子 + 成就 43（推进见 shimmerRiseUpdate）。
    //      变体贴图走 townSheet getter（已接），对话差分未接（GAP）。
    //      注①：原版 UpdateNPC_BuffApplyVFX（衰减位 :92646-62）上升态外仍每 tick −0.001 共衰减，
    //      本仓并入 −1/60 单档（既有 shimmerTransparencyNext 模型，纯函数测试锁定）。
    //      注②：[MAJOR-F4]（红队 R1 2026-09-03）：ramp 采样源从「中心格液体直读」改为
    //      「buff 353 在身」——buff 由共享 WetCollision（npcLiquid.wetCollision，与
    //      Enemy.ts:2307 写 shimmerWet 同款）浸液面经 TryAddingRepeatedBuff 续期
    //      （写入面见下方液体段 :2209 与 bound 分支），出池后余量 ≤100t 内 ramp 照常
    //      推进（原版 :92634 只读 shimmering 位，【不要求浸在池中】）。旧中心格探针
    //      （liquid[si]>30 && liquidType==4）= 单格采样，浸盒 10×h/2 其余三面触液
    //      （池缘站位/部分浸没）全部丢判 → 退役 ----
    const st0 = world.store;
    const si = st0.idx(
      Math.max(0, Math.min(st0.w - 1, Math.floor(this.cx / TILE))),
      Math.max(0, Math.min(st0.h - 1, Math.floor(this.cy / TILE))),
    );
    // buffTime 逐拍衰减（UpdateNPC_BuffSetFlags lowerBuffTime :93101）——
    // 衰减后 >0 即本拍 shimmering（同方法 :93255-64 扫 buffType==353 置位）
    if (this.shimmerBuffT > 0) this.shimmerBuffT--;
    const shimmering = this.shimmerBuffT > 0;
    // 上升态内 st 由 shimmerRiseUpdate 独占推进（ai[1]<30 期间原样保持 0.89）
    if (!this.shimmerRise) {
      this.shimmerTransparency = shimmerTransparencyNext(
        this.shimmerTransparency, shimmering, justHit, false,
        isNpcShimmerImmune(this.vanillaId ?? -1),
      );
      if (isNpcTownShimmerable(this.vanillaId) && shimmering
        && this.shimmerTransparency > SHIMMER_ST_TRANSFORM) {
        this.shimmerRise = true;                    // ai[0]=25（GetShimmered :92700）
        this.shimmerRiseT = 0;                      // ai[1]=0（:92701）
        this.shimmerRisePause = 0;                  // ai[2]=0（:92702）
        this.shimmerTransparency = SHIMMER_ST_RISE; // :92705
        this.shimmerBuffT = 0;                      // GetShimmered 摘 buff 353（:92706-10）
      }
    }
    if (this.shimmerRise && this.shimmerRiseUpdate(world, game, st0.liquid[si] > 0)) {
      // ai[0]==25 块整段 return（:53820）：AI_007 游走/坐姿/攻击/开门全跳过；
      // 补齐 UpdateNPC 层在 AI() 之后照常运行的各块（:91521-91600）：
      // ① 环境生命周期三连（★C1 重排定案：CheckLifeRegen :93622 无任何 ai 门、
      //    CheckDrowning 仅 townNPC 门——两者随 Update 层每帧运行,与 ai[0]==25 正交;
      //    GetHurtByOtherNPCs 头部 dontTakeDamage 早退 :93560 → 上升态内互殴停算,
      //    但溺水直伤 life-=2(:96065)与 friendlyRegen 清零(:96069)不受 dontTakeDamage
      //    管——微光中溺水伤害【照常】结算;致死一击 StrikeNPCNoInteraction(owner=255)
      //    同样不查 dontTakeDamage(:82012→:82017)）。序位 = AI 之后、碰撞之前。
      // ② 重力 + 碰撞 + 找帧。
      // ★重力 = 0（UpdateNPC_UpdateGravity :92036-92038 aiStyle7 && ai[0]==25 档,
      //   旧注 :91918-91922 系 1456 行带漂移——Enemy 侧 applyGravity 表对该档有
      //   「域不可达勿落死码」完备性备注,BJ704-G6 R3-P2④）：
      //   微光上升演出期不坠，仅落速帽——曾加 ENEMY_GRAVITY = 上升被拽下坠
      this.envHurtUpdate(world, game);
      this.vy = Math.min(this.vy, MAX_FALL_SPEED);
      // ★BJ704-G3 D9：原版小 vx 清零（NPC.cs:91588-91591 `|vx|<0.005 → 0`，
      //   UpdateNPC 全局段 AI 后/碰撞前无条件——微光上升演出臂同样照清）
      if (this.vx < 0.005 && this.vx > -0.005) this.vx = 0;
      moveAndCollide(this, world, this.vx, this.vy);
      this.updateWalkFrame(game);
      return;
    }

    // ---- altTexture 刷新（UpdateAltTexture NPC.cs:91254-91273，原版 UpdateNPC 每
    //      tick 末尾调 :91358）：派对进行（441/453/633 除外）→ 1；633 狼人条件 → 2。
    //      partyUp 取 world.scene（Game 每 15t 写入）；MakeTransitionEffectsForTextureChanges
    //      的变身尘/烟粒子（:91277-91309）未接（登记） ----
    this.altTexture = townNpcAltTexture(
      this.vanillaId, !!world.scene?.partyUp,
      world.clock.moonPhase, world.clock.bloodMoon, world.clock.isDay,
    );

    // 被绑待救援（BJ122 2026-09-18 定谳重写）。原版被缚族=独立 friendly【非
    // townNPC】型：105/106/123/354/589 aiStyle=0（NPC.cs:10271/:10285/:10521/
    // :13530/:16680）——AI_000（:19871-19977）只做 TargetClosest+spriteDirection
    // （:19813-19816）+ vx*=0.93 衰减（:19971-19975），【无走路面】；重力=
    // UpdateNPC 全局段（:91578-91586 gravity 0.3/maxFall 10）照落。
    // ★685 BoundTownSlimeOld 例外：aiStyle=1（:17641-17655）走 AI_001_Slimes
    // 跳跃机——弱跳（:62287-62294 vy×0.5/vx×0.2）+每跳 1/2 概率反向，原版被缚
    // 老史莱姆【会蹦】非站桩（此前统一站桩=偏差，用户质疑"原版会走动"对 685 成立）。
    // 1457 AI() aiStyle==0 头段（:19872-19875）每 tick `homeless = true`
    // （NPCID.Sets.BoundTownNPCs={105,123,106,685,686,687,354,376,579,589}）——
    // 被缚者恒无家,本仓 home=null 等价（Game 入驻轮本就 skip bound,此处按 1457
    // 字面每 tick 置空防残留）。解救在 Game.talkToNearbyNpc / 净化粉 / 触碰（登记债）
    if (this.bound) {
      this.home = null;
      const bp = (game as unknown as { player: Player }).player;
      // ★本仓 bound TownNPC 的 vanillaId 携【城镇】id（wizard=108/town_slime_old=679）,
      // 绑缚态本体 id（106/685…）走 Game.BOUND_TOWN_NPC_ID 反查——685 判别双键:
      // 真 685 vanillaId（未来直生路径）∪ npcKey（现行承载,唯一被缚史莱姆键）
      if (this.vanillaId === 685 || this.npcKey === 'town_slime_old') {
        this.boundSlimeHopUpdate(world, bp);
      } else {
        if (bp && !bp.dead) this.facing = bp.cx < this.cx ? -1 : 1;
        // :19971-19975 vx*=0.93+|vx|<0.1 清零（曾直置 0=击退速度立即钉死,非
        // 原版衰减相——击退后滑停 ~30t）
        this.vx *= 0.93;
        if (Math.abs(this.vx) < 0.1) this.vx = 0;
      }
      this.vy = Math.min(this.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);
      // ★BJ704-G3 D9：同款小 vx 清零（被缚 AI_000 自带 |vx|<0.1 档 :19971-19975
      //   之外,全局 :91588 0.005 档尾清——两档并存=原版双清结构）
      if (this.vx < 0.005 && this.vx > -0.005) this.vx = 0;
      moveAndCollide(this, world, this.vx, this.vy);
      // 液体段（UpdateNpcLiquid :93712-93805）——原版 UpdateCollision 不分家,
      // bound 照跑（[MAJOR-F4] 的完整承接:此前 bound 永远 wet=false,被缚者入水
      // 无浮力/溅落/岩浆伤害;685 AI_001 wet 段 :62080 也读本位）
      updateNpcLiquid(this, game, world.store);
      // ★BJ592 件2：FindFrame case 589（NPC.cs:71804-71892）被绑高尔夫球手自主
      // 练习挥杆链 1:1（原版 13 帧表,恒帧 0=缺链；Renderer boundNpcSheet 589 支
      // 已接真帧行）——含帧 9 到位拍挥杆击地尘 32×4 落尘面（:71839-71855）
      if (this.npcKey === 'golfer') this.boundGolferFindFrame(game);
      // CheckActive 四步（:78698-78810,UpdateNPC :91629 调）——被缚族非 townNPC
      // 且不在 DoesntDespawnToInactivity 名单（:78612-78678）→ 照走:出 activeRange
      // 盒即消/屏内续 timeLeft=750;归零强翻假 → noSpawnCycle+active=false。
      // savedXxx 旗只在 Transform 侧写（:53492-53510）,消散不触 → 重刷门复开
      // （走远=消失+新位置重生,wiki 同款语义）
      this.boundCheckActive(game, bp);
      // [MAJOR-F4]：bound 早退跳过非 bound 路径的微光续期段——buff 载体补施,
      // 防被缚者微光渐隐回归（updateNpcLiquid 只更新 wet 面,不续 buff）
      this.shimmerBuffTryAddRepeated(world);
      return;
    }

    // ---- 夜椅 rest spot（AI_007_FindGoodRestingSpot NPC.cs:53195-53262，原版
    //      每 tick 开头算一次 :53708）：夜/雨"该回家"窗口（flag :53383-53402，与
    //      回家传送同式）+ **夜间**才扫椅（:53209 dayTime 早退——白天雨天也只回
    //      home 地面不坐）；以 home 为锚扫 ±7 列可坐格；城镇宠物/史莱姆不坐
    //      （:53214 type 638/656 + IsTownSlime 族 NPCID.cs:4446）→ 本仓 null ----
    // 风暴门（:53399-53402）：Main.IsItStorming 且 NPC 头顶行 < worldSurface
    // （= world.groundLevel，SceneMetrics 同源；缺省 0=未知世界恒 false）。迟滞机
    // 每 tick 逐步推进（原版 Main 全局字段 _shouldUseStormMusic 逐帧重算）
    this.storming = isItStormingNext(world.weather.cloudAlpha, world.weather.windSpeedTarget, this.storming);
    const sitFlag = world.weather.raining || !world.clock.isDay
      || !!world.clock.eclipse || !!world.weather.slimeRain
      || (this.storming && this.y / TILE < world.groundLevel);
    this.homeFlag = sitFlag;   // ★2026-08-31 台账批：同一旗的 NPC.cs:54578 开门掷门消费
                               // （aiStyle7 全体共用该局部 flag，非坐姿专属——这里快照供
                               // npcDoorUpdate/tryOpenDoorAhead 同拍读取）

    // ---- 特型头臂（AI_007 入口段一字移植；★对抗修复批③2026-09-01 蓝队 F2 收口）----
    // 【368 游商】homeless 恒真（NPC.cs:53909：`type==368 → homeless=true`）——本仓
    // home=null 承接（拴绳/回家臂全部天然失配：TeleportToHome 门 :53973 `!homeless`
    // 拒游商、夜椅扫描需 home、Housing 家槽无 368 面）。★仅防「玩家在场跨夜」窗口，
    // 黄昏离屏移除由既有 toNpc 出场轮承担。
    if (this.vanillaId === 368) {
      if (this.home) this.home = null;          // :53909 字面每 tick homeless=true
      if (!world.clock.isDay) {
        if (!this.shimmerRise) {                // :53912 !shimmering（上升态整段早退不可达）
          // UpdateHomeTileState(homeless,…,:53913-14)：锚 = 中心列 / (Bottom+2px)/16 地行——
          // 无家者的夜间游走/开门旗以它为 homeTile 锚（+2 与首落地 +4 均落同一地行）
          this.anchorTile = {
            x: Math.floor(this.cx / TILE),
            y: Math.floor((this.y + this.h + 2) / TILE),
          };
        }
        // :53916-20 `!flag5 && ai[0]==0f → ai[0]=1,ai[1]=200`：夜里被玩家切到对话,
        // 或在攻击/坐姿/社交/被逼停态时不动（原版读的是当刻 ai[0] 快照）
        const idle0 = this.walkMode === 0 && this.atkState === 0 && !this.social
          && !this.sitting && !this.healing && this.corneredT <= 0;
        if (!this.talking && idle0) {
          this.walkMode = 1;
          this.walkT = 200;
        }
      }
      if (!world.clock.isDay) this.homeFlag = false;   // :53922 flag=false——夜臂回收该旗
    } else if (this.vanillaId === 369 && !this.home && this.wet) {
      // 【369 渔夫世界边缘臂】（NPC.cs:53925-53941）：湿身且无家时远离出生点的
      // 世界边缘自救——380 格外锚回出生格 + 边缘 300 格内强制转向内海
      if (this.cx / TILE < 380 || this.cx / TILE > (world.w - 380)) {
        // UpdateHomeTileState(homeless, Main.spawnTileX/Y)（:53930）→ 本仓以 anchorTile
        // 承接（原版写 homeTileX/Y 而 homeless 不变——拴绳锚=出生点语义同源）
        this.anchorTile = { x: world.spawnX, y: world.spawnY };
        this.walkMode = 1;                      // :53932-33 ai[0]=1,ai[1]=200
        this.walkT = 200;
      }
      if (this.x < 300 * TILE) this.facing = 1;            // :53935 position.X/16 < 300
      else if (this.x > (world.w - 300) * TILE) this.facing = -1;   // :53937 右对称
    }

    // ---- 家平线门 flag22（★对抗修复批③ D-F2/A-F4 两开关一旗；NPC.cs:54513-54527）----
    // 原式：flag22 初值 true，`(float)(homeTileY*16 - 32) > position.Y` 时翻 false——
    // 即【本体顶 Y 高于「家线 −32px」= 站在明显高于家的地面】才翻转。消费面两处：
    //   ① StepDown 仅在 !flag22 且贴地帧吸附（:54518-21）→ 映射 stepDownGate =
    //      flag22 ? 'never' : 'grounded'；
    //   ② StepUp holdsMatching = flag22（:54527 第 8 参）→ 每 tick 写 Body.stepUpHolds
    //      （TileCollision.moveAndCollide applyStepUp 实参直读本字段）。
    // homeless 恒有 homeTile 锚（首落地 :53701-4 本仓 anchorTile 承接）,两者皆缺时
    // homeRow=-1 ⇒ (-48)>y 恒假 ⇒ flag22 恒真 —— 与 TownCritter 族 'never' 档判据
    // 同构不同源（该族是 homeTileY==-1 的字面特例）。
    // ★口径注（以反编译为准）：原版 homeTileY 是【地面行】；本仓 home.y 是站格
    // （地面行−1），故 +1 归一；anchorTile.y 本就是 (Bottom+4px)/16 地行口径直用。
    const homeRow = this.home != null ? this.home.y + 1 : this.anchorTile?.y ?? -1;
    const flag22 = !((homeRow * TILE - 32) > this.y);
    this.stepUpHolds = flag22;                       // StepUp holdsMatching（:54527）
    this.stepDownGate = flag22 ? 'never' : 'grounded';   // StepDown !flag22 门（:54518）

    this.restSpot = (sitFlag && !world.clock.isDay && this.home
      && !NO_SIT_NPC_IDS.has(this.vanillaId))
      ? findChairSpot(world.store, this.home.x, this.home.y) : null;

    // ---- 危险评估（NPC.cs:54014-54156 扫描/双窗/侧选/PrettySafe 收口伞）：
    //      原版在 AI 头部、状态机之前跑。结果供多处消费：逃离覆写 / 逃速提档
    //      （:54467 flag16|flag21）/ 越障冻结门（:54666 族 flag16）/ 攻击触发门
    //      flag31（:55769）/ 随机坐椅门 flag30（:55768）/ 对话朝向 num9 消费
    //      （:54177）----
    this.dangerUpdate(world, game);
    // ★F3（蓝队）：攻击冷却 localAI[1](atkCd) 的递减挂在触发总伞 `(!flag5|flag16)`
    // 内（NPC.cs:55761/:55770-55772，位于 flag31 计算之前）——对话且无险时整区跳过，
    // 冷却冻结保留剩余；挂点统一放扫描后（原版该递减不筛 ai[0]，治疗态 13/
    // 社交/坐姿期间同样逐拍递减——attackUpdate 被 nurseBusy 短路的 tick 由此处兜住）
    if ((!this.talking || this.dangerNear) && this.atkCd > 0) this.atkCd--;

    let wantDir = 0;
    // 对话归位块（原版 AI_007 NPC.cs:53871-53881：talkNPC==本体逐 tick 执行）：
    // ★F2/F4③ 定谳——豁免列只有攻击态 {10,12,14,15}；其余态【每 tick】被三件套
    // `ai[0]=0 / ai[1]=300 / localAI[3]=100` 归位（含医师治疗 13★F2、坐姿 5、
    // 被逼停 8、社交族）。朝向玩家的写向不在本块——num9(:53883 记录)的消费在
    // 危险扫描之后的 :54177 门 `!flag16 && !flag15` 下（下方 admitWide/threatRaw）。
    if (this.talking) {
      const p = (game as unknown as { player: Player }).player;
      const exemptAtk = this.atkState === 10 || this.atkState === 12
        || this.atkState === 14 || this.atkState === 15;
      if (!exemptAtk) {
        // ★T6（2026-09-01）：num9 门照原文（:53871-53883）只剔 `!active ||
        //   talkNPC != whoAmI`——【无 dead 门】（Player.KillMe 只置 dead，
        //   不清 talkNPC；talkNPC=-1 仅 SetTalkNPC(-1)/stinky buff(Player.cs:10366)/
        //   玩家重置(:56745)）⇒ 死亡对话者照常计朝向。旧 !p.dead 剔除系过度删除
        //   （尸位对话朝向冻结=偏离；talking 入场门 CanBeTalkedTo 另查 dead,
        //   那才是原版收 dead 的位）
        const num9 = p ? (p.cx < this.cx ? -1 : 1) : 0;
        // 对话打断坐姿（ai[0]==5 非豁免列 → 归 0）；治疗态同被打断（★F2：
        // :53871-53875 无 13——弹已离手独立存活，重入由后续 NurseHeal 触发面承担）
        if (this.sitting) { this.sitting = false; this.sitTimer = 0; }
        if (this.healPatient) {
          this.healPatient = null;
          this.healT = 0;
          game.behavioLog?.('nurseHeal', { phase: 'interrupted', id: this.id });
        }
        // 被逼停解除（ai[0]==8 同非豁免列——对话即脱冻结）
        if (this.corneredT > 0) { this.corneredT = 0; }
        this.social = null;
        this.vx *= 0.6;              // 本仓既有观感近似件（保留,原文本块无速度阻尼）
        this.walkMode = 0;
        this.walkT = 300;            // ai[1]=300（:53876）
        this.turnLock = 100;         // localAI[3]=100（:53877,随对话逐拍续钉）
        // 朝向消费点（:54177 字面形）：仅当扫描既无窄窗威胁(flag16)也无宽窗
        // 准入(flag15)时才转向玩家——险中不转身背敌亦不迎敌
        if (num9 !== 0 && !this.threatRaw && !this.admitWide) this.facing = num9;
      }
    } else if (!this.socialUpdate(world, game)) {
      // ---- 游走双态 + 拴绳（AI_007 :54032-54288；雨天白天也回家 = sitFlag 门）----
      // ★对抗修复批③：传【本 tick 有效】的 flag（368 夜臂 :53922 把局部旗置 false
      // 后续游走/拴绳/传送同拍生效——homeFlag 快照即该变量终值）
      wantDir = this.wanderUpdate(world, game, this.homeFlag);
    }
    // ---- 回家传送（AI_007_TownEntities_TeleportToHome :56063-56090 + 触发
    //      :53828-53856）1:1：flag = 雨/夜/食/史莱姆雨/风暴（= 该回家的状态）且
    //      不在好休息位；双矩形视野门（:53831-53846）——NPC 位与 home 位各测
    //      「玩家盒与 [中心−(sWidth/2+safeRangeX), 尺寸 sWidth+2×safeRangeX] 矩形
    //      相交」：任一相交即玩家可见 → 不传。两矩形均不相交 → 静默传回家 ----
    if (this.home) {
      const flag = sitFlag;
      // IsInAGoodRestingSpot（NPC.cs:53161-53177）1:1：夜间坐姿（!dayTime &&
      // ai[0]==5）放宽 ±7 格——防"坐在椅上被回家传送拽起"；其余一律与好休息格
      // 【精确同格】（tileX==floorX && tileY==floorY），原版无任何半径容差。
      // ★2026-09-01 修正（用户实报"染料商晚上永远回不了房间"）：旧实现非坐姿用
      //   home±4 格圆容差——NPC 在自家屋顶打转时 cx 大半时间落在 home.x±4 格内，
      //   被误判"已到家" → 传送网永不合闸。判定锚 = FindGoodRestingSpot 输出
      //   （restSpot 夜椅优先，否则 home 列向下找地面行），num7 = 脚部格
      //   （(Y+Height+1)/16，:53853）。
      const restTp = this.restSpot ?? this.restFloor(world);
      const myX6 = Math.floor(this.cx / TILE);
      const myY7 = Math.floor((this.y + this.h + 1) / TILE);
      const nearHome = restTp != null && (this.sitting && !world.clock.isDay
        ? Math.abs(myX6 - restTp.x) <= 7 && Math.abs(myY7 - restTp.y) <= 7
        : myX6 === restTp.x && myY7 === restTp.y);
      // ★红蓝批 R2（2026-09-01）：补守卫老人备用臂——原版触发条件 OR 右项
      //  `type==37 && Main.tileDungeon[脚格]`（NPC.cs:53973；tileDungeon 全集
      //  Main.cs:8131-8136）：老人白天驻足地牢砖上时同样参与「不在驻地→拽回」，
      //  不受昼夜/天气旗约束。脚格坐标即 num6/num7（myX6/myY7 同源同值）。
      const feetDungeonTile = this.vanillaId === 37
        && (() => {
          const stx = world.store;
          return stx.inBounds(myX6, myY7)
            && VANILLA_DUNGEON_TILES.has(stx.type[stx.idx(myX6, myY7)]);
        })();
      if ((flag || feetDungeonTile) && restTp != null && !nearHome) {
        const pl = (game as unknown as { player: { x: number; y: number; w: number; h: number; dead: boolean } | null }).player;
        // 矩形视野门（原文位 :53977-53998；k=0 以 NPC 位中心、k=1 以
        // home(FindGoodRestingSpot) 位中心）；尺寸 = (sWidth+2×safeRangeX) ×
        // (sHeight+2×safeRangeY) = 2044×1278。
        // ★T6（2026-09-01）：门只查 `Main.player[l].active`（:53994）——【无 dead 门】
        //   ⇒ 死亡玩家尸体在窗内照常算"可见"、照样压住回家传送。旧 pl.dead 剔除
        //   系过度删除（死亡瞬间 NPC 会被拽回家=偏离），废。
        const rw = TP_SCREEN_W + TP_SAFE_X * 2, rh = TP_SCREEN_H + TP_SAFE_Y * 2;
        const visible = (cx: number, cy: number): boolean => {
          if (!pl) return false;   // !active 槽（:53994 唯一剔除位）
          const rx = cx - rw / 2, ry = cy - rh / 2;
          return pl.x < rx + rw && pl.x + pl.w > rx && pl.y < ry + rh && pl.y + pl.h > ry;
        };
        if (!visible(this.cx, this.cy) && !visible(restTp.x * TILE + 8, restTp.y * TILE + 8)) {
          // 三列落位（TeleportToHome :56211-56237：入参=FindGoodRestingSpot 输出，
          // 即【地面行】restTp——非 home 站格！2026-09-01 定谳「拆椅冻结风暴」根因：
          // 旧实现以 home.y(站格,地面行−1) 当落位基线,y=(home.y)*TILE−h−0.1 脚底落在
          // 地面行上 16px 的空中行——nearHome 精确等值门(myY7===restTp.y)永假 ⇒ 每拍
          // 重传永不满足，onGround 恒 false 连锁钉死攻击门(case2 零还击)与逃离位移。
          // 列序 num=homeFloorX+i{0,−1,+1}（switch 字面）、净空窗 SolidTiles(num±1,
          // homeFloorY−3..−1)、type37 免净空、落点 (num*16+8−w/2, homeFloorY*16−h−0.1)
          // ——脚底恰贴地面行顶,e(int)((Y+H+1)/16)==restTp.y 一拍收敛。
          let moved = false;
          for (const off of [0, -1, 1]) {
            const hx = restTp.x + off, hy = restTp.y;
            let clear = true;
            for (let ax = hx - 1; ax <= hx + 1 && clear; ax++) {
              for (let ay = hy - 3; ay <= hy - 1; ay++) {
                if (world.store.inBounds(ax, ay) && world.store.isSolid(ax, ay)) { clear = false; break; }
              }
            }
            if (!clear && this.vanillaId !== 37) continue;   // :56222 type37 免净空
            if (!world.store.inBounds(hx, hy)) continue;
            this.x = hx * TILE + 8 - this.w / 2;
            this.y = hy * TILE - this.h - 0.1;
            this.vx = 0; this.vy = 0;
            moved = true;
            break;
          }
          if (moved) {
            this.teleportedHome = true;   // 落位即试坐（TeleportToHome :56081）
          } else {
            // 全堵（:56087-56090）：`homeless = true; WorldGen.QuickFindHome(whoAmI);`
            // （NPC.cs:56236-56237 字面——同 tick 以【旧 homeTile】为锚重扫 3 步窗,
            // WorldGen.cs:5654;成功即原房/邻位重安家,失败保持无家）。
            // ★★SW-BJ2 2026-09-06：曾错误地清 home + anchorTile=当前位置 → 无家锚随
            // NPC 漂移,且每 tick 近玩家回收链把家搬进玩家视野内空房（用户实报
            // 「入住跟着玩家走」次生根因）。重扫经 game.quickFindHomeForNpc（Game 层
            // 持占用集/松露门/成就）;测试桩无该钩子时保底按旧路径转无家。
            const oldHome = this.home;
            this.home = null;
            this.leashHome = false;
            const g = game as unknown as {
              quickFindHomeForNpc?: (npc: TownNPC, oldHome: { x: number; y: number }) => boolean;
            };
            const rehoused = oldHome != null && (g.quickFindHomeForNpc?.(this, oldHome) ?? false);
            if (!rehoused && oldHome) {
              // vanilla 失败支不清 homeTile（homeless 游走/夜行锚=旧 homeTile,
              // NPC.cs:53701 仅 -1 时首落锚）——钉回旧家地行（home.y 站格 → 地行 +1）
              this.anchorTile = { x: oldHome.x, y: oldHome.y + 1 };
            }
          }
        }
      }
    }

    // ---- 危险逃离覆写（NPC.cs:53990-54024 + 被逼停推进 :54682-54690）----
    this.fleeing = false;
    // ★cornered 簿记门（2026-08-31 对账批②）：原版递减/续冻/解冻三臂全在
    //   `if (ai[0]==8)` 状态机分支内（递减+续冻 :54830-54837、解冻 :54107-54118）
    //   ——入攻击态后 ai[0] 已换号（10/12/14/15），三臂整体挂起；退出时经
    //   exitAttackCommon 复位面收尾（有险→ai[0]=8&ai[1]=腿程，无险→ai[0]=0 清零，
    //   :55081/:55353/:55551/:55679 四处同形）。本仓 corneredT 影子计数若照旧独立
    //   递减/解锁,残留值会在急袭完成后把 NPC 钉住至 ~225t（僵尸逼停）——故本块
    //   以 atkState===0 为门：攻击态中簿记全停、wantDir 由 attackUpdate 返真接管
    if (this.corneredT > 0 && this.atkState === 0) {
      // ai[0]==8 冻结态：站定（vx 走下方 wantDir==0 刹车）但仍可还击——attackUpdate
      // 无 cornered 门（flag31 含 ai[0]==8，:55769），攻击态照常触发/推进。
      // 续冻/解冻消费 flag16 的【原始】位（threatRaw）：PrettySafe 收口只写在
      // 非 8 分支内（:53997-54002 处于 else-if(ai[0]!=8..15) 臂），被逼停 NPC
      // 的 flag16 恒保持扫描原始值
      this.corneredT--;                                          // :54833 ai[1]--
      if (this.corneredT < 60 && this.threatRaw) this.corneredT = 180;   // :54834-54837 在险续冻
      // 解冻（:54110-54115）：危险已换侧到面前（facing == −num15）→ 恢复走路；
      // ai[2]=0 / localAI[3]=0 同段清（turnLock 承接）
      // （该臂在 umbrella `(flag16 && !flag5)` 内——对话中不解冻）
      if (this.threatRaw && !this.talking && this.facing === -this.dangerSide) {
        this.corneredT = 0;
        this.walkMode = 1;
        this.walkT = 300 + Math.floor(this.rng() * 300);         // :54111-54112 单掷
        this.turnLock = 0;                                       // :54113 localAI[3]=0
      }
      wantDir = 0;
    } else if (!this.talking && this.dangerNear && this.atkState === 0 && !this.healing) {
      // ★F1① 三臂结构面（原版 ：54102-54171，总伞 `flag16 && !flag5`；ai[0]!=
      //   {10,12,13,14,15} ≡ 本仓 atkState===0 && !healing；ai[0]==8 臂由上方
      //   corneredT 块承接）。前坑（avoidFalling）只锁「非行走态」的逃离布线——
      //   社交对【不拆】、坐姿5【不起身】、腿程/朝向不重写（坑前站定）：
      //   - 行走臂（ai[0]==1，:54166-54171）：【无条件】转向背险侧（flag2 恒 false
      //     ——仅 infectedSeed type20 免疫路径置真，本域不存在），不避坑、不动腿程；
      //     fleeing 置位 = flag16 | flag21 逃速档的行走态消费面（:54467）
      //   - 非行走臂（ai[0]!=1：停 0 / 坐 5 / 社交 3·4·16·17）：!avoidFalling 才整段
      //     布线（:54143-54165）——社交拆对 + ai[0]=1（坐姿起身即此链的改写效应）+
      //     ai[1]=120+Next(120) + localAI[3]=0 + direction=-num15
      const fleeDir = -this.dangerSide;
      // ★状态互斥：坐姿5/社交3·4·16·17 在原版都是非 1 态，恒走逃离布线臂——
      // 本仓 walkMode 与它们并行存在（forceSit 不清走态残留），必须显式排除
      if (this.walkMode === 1 && !this.sitting && !this.social) {
        // 行走臂（:54166-54171 字面 `direction != -num15 → direction=-num15`）
        if (this.facing !== fleeDir) this.facing = fleeDir;
        this.fleeing = true;                                   // :54467 逃速档
        wantDir = fleeDir;
      } else {
        const homeX = this.home?.x ?? this.anchorTile?.x ?? -1;
        const ax0 = Math.floor((this.cx + 15 * fleeDir) / TILE);
        const fy0 = Math.floor((this.y + this.h - 16) / TILE);
        const fleeBlocked = this.onGround && walkPrediction(
          world.store, Math.floor(this.cx / TILE), homeX, false,
          fleeDir, ax0, fy0, this.h,
        ).avoidFalling;
        if (!fleeBlocked) {
          if (this.social) {
            const other = this.social.other;
            this.social = null;
            if (other && !other.dead && other.social
              && (other.social.kind === 3 || other.social.kind === 4
                || other.social.kind === 16 || other.social.kind === 17)) {
              other.social = null;                                 // :54146-54153
              other.walkMode = 1;
              other.walkT = 120 + Math.floor(other.rng() * 120);
              other.facing = -this.dangerSide;
            }
          }
          if (this.sitting) {
            this.sitting = false;                              // ai[0]=5→1 改写链起身
            this.sitTimer = 0;
            this.sitKickLock = 1;   // 原刻防坐回（见字段注）
          }
          this.fleeing = true;
          wantDir = fleeDir;
          this.walkMode = 1;                                   // ai[0]=1（:54154）
          this.walkT = 120 + Math.floor(this.rng() * 120);     // ai[1]=120+Next(120)
          this.turnLock = 0;                                   // localAI[3]=0（:54156）
        }
      }
    }

    // ---- 坐姿（ai[0]==5 族，见 sittingUpdate 注）----
    if (this.sittingUpdate(world, game)) wantDir = 0;

    // ---- 医师治疗态（ai[0]==13 触发/推进,NPC.cs:55986-56005/:55360-55391；
    //      原版序位 = 社交掷骰链之后、四攻击入态门之前,无掷骰）----
    const nurseBusy = this.nurseHealUpdate(world, game);
    if (nurseBusy) wantDir = 0;
    // ---- 自卫攻击（AI_007 攻击态 ：54747-55538;攻击中站定替代游走）----
    else if (this.attackUpdate(world, game)) wantDir = 0;

    // ---- 行走随机坐椅（NPC.cs:55774-55814，原版无昼夜门：flag30 = ai[0]<2 &&
    //      !flag16 && !wet（:55768）→ ai[0]==1 行走态 && 站地 && rand(300)==0
    //      （num=300；宠物/城镇史莱姆 0 恒不触发）→ 脚下格（Bottom−2px）为椅/
    //      马桶且无其他坐姿 NPC/玩家占位 → 坐 900+rand(10800)）----
    if (this.tryRandomChairSit(world, game, wantDir)) wantDir = 0;

    // ---- 环境与互殴受击(NPC.cs:91590-91600:townNPC 每帧 CheckDrowning +
    //      CheckLifeRegen + GetHurtByOtherNPCs;岩浆走 Collision_LavaCollision
    //      :94511-94530)。★C1：ai[0]==25 微光上升帧不走本调用点——上升早退分支内
    //      显式补调（序位同为 AI 后/碰撞前）----
    this.envHurtUpdate(world, game);


    // ---- 速度应用（NPC.cs:54279-54357 原版应用式）：num22/num23 常态
    //      1/0.07；逃命中（friendly && flag16）或溺水 flag21 → 1.5+失血×0.9/0.1。
    //      超速（贴地）×0.8 软回落（非硬钳）；未达帽按 direction ±num23 ——本仓
    //      wantDir 即 direction（0 = 站定走驻留刹车 ±0.1，:54096-54106）----
    // flag21（:54361）= !flag11 && DrownCollision(includeSlopes:true)——★F4 换
    // DrownCollision 真几何且【无 wet 锁存】（城镇 NPC flag11 恒 false，非 616/617/
    // 625/361/445/687 族）；逃速提档 :54467 与 walkPrediction keepwalking③ 同源消费
    const drowningNow = drownCollision(world.store, this.x, this.y, this.w, this.h, 1, true);
    const speedup = this.fleeing || drowningNow;
    const spdCap = speedup
      ? FLEE_SPEED_BASE + (1 - this.hp / this.maxHp) * FLEE_HURT_FACTOR
      : WALK_SPEED;
    const accel = speedup ? FLEE_ACCEL : WALK_ACCEL;
    if (Math.abs(this.vx) > spdCap) {
      if (this.vy === 0) this.vx *= 0.8;                     // :54341-54345 超速软回落
    } else if (wantDir === 1) {
      this.vx = Math.min(spdCap, this.vx + accel);
    } else if (wantDir === -1) {
      this.vx -= accel;
      if (this.vx > spdCap) this.vx = spdCap;                // 原版 cap 笔误照抄（:54356）
    }
    if (wantDir === 0) {
      // 原版驻留刹车（NPC.cs:54096-54106）：不走路时每 tick ±0.1 主动减速。
      // 缺此刹车时仍以全速惯性滑行且贴图不镜像 → 向右滑行显示朝左贴图（太空步）
      if (this.vx > 0.1) this.vx -= 0.1;
      else if (this.vx < -0.1) this.vx += 0.1;
      else this.vx = 0;
    }
    // ---- 行走前视链（NPC.cs:54403-54467）：GetWalkPrediction 避坠 → 溺水跳出
    //      （:54408-54427）→ avoidFalling 站坑口停走（:54444-54467）→ 障碍三档
    //      跳 else 链尾的避坠转身（:54575-54579）。门 = 站地行走中 ----
    let turned = false;
    if (this.onGround && wantDir !== 0 && this.vx !== 0 && Math.sign(this.vx) === wantDir) {
      const st = world.store;
      const homeX = this.home?.x ?? this.anchorTile?.x ?? -1;
      const myX = Math.floor(this.cx / TILE);
      const ax = Math.floor((this.cx + 15 * wantDir) / TILE);   // num26 前方列（:54405）
      const fy = Math.floor((this.y + this.h - 16) / TILE);     // num27 脚部行（:54406）
      // ★蓝队A-F1 拨正（2026-09-01）：避坠豁免参 = TownCritter 谓词（NPCID.cs:4827，
      // :56120-56123 消费）——非 IsTownPet；家化宠物（637/638/656/史莱姆族不在
      // TownCritter 集）由此【放弃豁免】照常避坠
      const isCritter = VANILLA_TOWN_CRITTER_SHEETS.has(this.vanillaId);
      // keepwalking 三参（:56098-56117）：起步期 = 走态且走程剩余 <30t；挤人 =
      // 前方盒（X−20/宽+40）内有站定（vx==0）城镇 NPC（:56105-56115）
      const startLeg = this.walkMode === 1 && this.walkT < 30;
      const crowdedOrBlocked = startLeg
        && (!this.plotAvoidClear(st) || this.crowdedByStationaryNpc(game));
      const pred = walkPrediction(st, myX, homeX, isCritter, wantDir, ax, fy, this.h,
        startLeg, drowningNow, crowdedOrBlocked);
      let jumpedOut = false;                                    // flag23 溺水跳出
      // 溺水跳出（:54408-54427）：wet+没顶+跳出冷却尽（localAI[3]<=0 → turnLock
      // 承接）→ 向上数 11 格液体深度，跳速 −sqrt((d×16+16)×2×0.3) cap 26；
      // 冷却 180t（num28）。跳点记录（position.X）在原版次帧被 flag21 段清
      // ——非溺水即清（jumpBackX 只管跳出后回落同点的转身检测）
      if (this.wet && drowningNow && this.turnLock <= 0) {
        // ★对抗修复批⑤ A8（2026-09-01）：测深环改 GetTileSafely 出界语义
        // （Framing.cs:426-431 InWorld false → 空 tile,液 0/type 0——计数即止）
        // ——旧 max/min 钳制把越界读折到边界列/行,边缘列的实体边界格液体计深
        // 虚高 → 跳速虚高。深查列 = num25−direction、基行 = num27 同原版。
        let depth = 0;
        const qx = ax - wantDir;
        for (let j = 0; j <= 10 && st.inBounds(qx, fy - j); j++) {
          if (st.liquid[st.idx(qx, fy - j)] === 0) break;
          depth++;
        }
        let jumpV = Math.sqrt((depth * 16 + 16) * 2 * 0.3);
        if (jumpV > 26) jumpV = 26;
        this.vy = -jumpV;
        this.turnLock = 180;                                    // num28 跳出冷却
        this.jumpBackX = this.x;                                // localAI[3]=position.X（:54427）
        jumpedOut = true;
      } else if (!drowningNow) {
        this.jumpBackX = Number.NaN;                            // :54450-54462 非溺水清记录
      }
      // avoidFalling 站坑口停走（:54556-54577,旧注 :54444-54467 系行号漂移）：
      // 脚下三列（cx±1, 脚行+1）实心 ≤2 → 停走五常数（ai[0]=0/ai[1]=50+Next(50)/
      // ai[2]=0/localAI[3]=40 + keepwalking3=(avoidFalling3=false)——wantDir 归 0
      // 承接,下游跳臂照原版跳过）。谓词=原版 :54563 `tileSafely2.nactive() &&
      // Main.tileSolid[tileSafely2.type]`（无液体臂）——★BJ656 统一
      // isVanillaTileSolid：平台双旗真值本就计入（平台面上不误判坑口,8-31 案保
      // 真）;家具顶（isPlatform 宽化残留）摘除=回归原版
      if (pred.avoidFalling && !jumpedOut) {
        const bx = Math.floor(this.cx / TILE);
        let solid = 0;
        for (let o = -1; o <= 1; o++) {
          if (st.isVanillaTileSolid(bx + o, fy + 1)) solid++;
        }
        if (solid <= 2) {
          this.walkMode = 0;
          this.walkT = 50 + Math.floor(this.rng() * 50);
          this.turnLock = 40;
          wantDir = 0;
        }
      }
      // 回到溺水跳出点 → 转身（:54432-54437：防在坑里来回横跳）
      if (this.x === this.jumpBackX && Number.isFinite(this.jumpBackX) && !jumpedOut) {
        this.facing *= -1;
        this.jumpBackX = Number.NaN;
      }
      // 障碍三档跳（:54517-54611）+ 避坠命中时的转身（:54575-54579：!flag24
      // 转身；flag16 危险中再叠冻结）——站坑口停走已把 wantDir 归 0 则跳过
      if (wantDir !== 0) {
        turned = this.obstacleJump(world, wantDir, pred.avoidFalling && !jumpedOut);
      }
      // keepwalking 消费（:54609-54613 障碍段尾）：起步期贴 AvoidedByNPCs 块 /
      // 前方站定友方 / 溺水 → 走程重置 90t（继续挤开走，直接赋值非 max——原版
      // ai[1]=90 同式）。被逼停（flag27 → keepwalking=false :54597）由 corneredT>0
      // 的冻结态天然覆盖（不走即不消费）
      if (pred.keepwalking && this.corneredT <= 0) {
        this.walkT = 90;
      }
      // 湿身上浮助跑（:54619：velocity.Y<0 且 wet → ×1.2——水中跳出更高）。
      // ★必须留在贴地块【内】：原版整段行走逻辑（含本行）包在 if(velocity.Y==0f)
      // （:54398-54628，= 贴地态）里，×1.2 只在【起跳那一 tick】乘一次；曾放块外
      // 每 tick 复合 → 溺水跳 vy-10.7 指数放大到 -300+，渔夫一跳窜上万格高空
      //（2026-08-21 用户报障，探针 _anglerjump 复现 vy-373/y-228179）
      if (this.vy < 0 && this.wet) this.vy *= 1.2;
      // ★对抗修复批⑤ A10(c)（cs:54751-55）：TownCritter 第二乘子——【独立 if】非
      // else-if（湿身 critter 同拍可两连乘 ×1.44,原版字面如此）;flag7（300/447/610）
      // 豁免。★死域预防：本区域现行零实体(VANILLA_TOWN_CRITTER_SHEETS 无既有
      // 城镇 NPC 载体),无既有回放依赖——rng 流位变化已记录在案
      if (this.vy < 0 && isCritter && !TOWN_FLAG7_IDS.has(this.vanillaId)) {
        this.vy *= 1.2;
      }
    } else if (!this.onGround && wantDir !== 0 && !this.wet
      && SLIME_TOWN_IDS.has(this.vanillaId)) {
      // ★对抗修复批⑤ A9 臂B（cs:54760-87：velocity.Y==0 大门的 IsTownSlime 否支,
      // 即行走中【腾空】拍——史莱姆蹦跳相）下方 ±1 列×6 行支撑格（液体>0 或
      // active&&实心)≤2 → 停走五常数：walkMode=0 / walkT=50+Next(50) /
      // turnLock=40（localAI[3] 承接）/ ai[2]=0 / vx×0.2。GetTileSafely 出界空格
      // 语义同 A8（不计入）。骰面：仅触发时耗一张 Next(50)。wantDir 归零承接
      // 原版 ai[0]=0（本 tick 不再作加速度/朝向消费位）
      // ★BJ649（2026-10-12 用户实报十周年纪念种子酷酷史莱姆「被推出房间外弹跳」
      // 定谳落刀）：支撑谓词=原版裸 Main.tileSolid[type]（cs:54771-72
      // `tileSafely6.nactive() && Main.tileSolid[tileSafely6.type]`——【无
      // !tileSolidTop 排除】）→ 平台九件套整批计入（Main.cs:8031-32
      // `tileSolidTop[19]=true; tileSolid[19]=true` 同批 239/380/427/435-439）。
      // 本仓 SOLID_LUT=defs.solid≡tileSolid∧!tileSolidTop 把平台排除,旧 isSolid
      // 谓词平台上空支撑恒 0≤2 → 臂B 每滞空拍点火（vx×0.2 停走）→ 城镇史莱姆在
      // 平台屋顶（行272 长平台）上空 0.02px/t 龟速原地蹦跳永不下地=用户实录
      // 「悬浮 home 上方 6 格、33px 振幅/300t 慢抛物线、g=0 全程」（30t 采样对
      // ~33t 常蹦周期的混叠假象）。原版平台计入支撑 → 臂B 静默 → 走态保持 →
      // vx 加速至 num22=1.0 → 正常蹦跳行走、一个腿程（200-400t）内走下平台梯回家。
      // 同族判例:2026-08-31 walkPrediction avoidFalling 平台落点修复（本文件同域
      // 已修,本支漏同步）。修=isSolid ∪ VAN_TILE_SOLID_EXTRA 九件套（sheet 域
      // 单源 GenSolid,=原版 tileSolid 真表代理,Game.solid() 同式）。家具顶
      // （桌 14/工作台 16 等原版 tileSolid=false）不计入——勿放宽到 isPlatform。
      // ★BJ656（2026-10-12）三站统一谓词=st.isVanillaTileSolid（同式收编,
      // 外加 nactive() 门——原九件套直查臂漏幽灵平台 flags=0 门,补齐=原版
      // `tileSafely6.nactive()` 同相）
      const st = world.store;
      const bx = Math.floor(this.cx / TILE);
      const fyA = Math.floor((this.y + this.h - 16) / TILE);
      let supports = 0;
      for (let o = -1; o <= 1 && supports <= 2; o++) {
        for (let d = 1; d <= 6; d++) {
          if (!st.inBounds(bx + o, fyA + d)) continue;   // 出界 = 空 tile 不计
          const ii = st.idx(bx + o, fyA + d);
          if (st.liquid[ii] > 0 || st.isVanillaTileSolid(bx + o, fyA + d)) {
            supports++;
          }
        }
      }
      if (supports <= 2) {
        this.walkMode = 0;
        this.walkT = 50 + Math.floor(this.rng() * 50);
        this.turnLock = 40;
        this.vx *= 0.2;
        wantDir = 0;
      }
    }
    const preX = this.x;
    // 湿身重力档（UpdateNPC_UpdateGravity :91940-91956）：浸水 0.2/蜜 0.1/
    // 微光 0.15；干侧 ENEMY_GRAVITY 0.3（NPC.cs:6026，2026-08-20 对齐批换正）；
    // 落速帽 7/4/5.5 由 updateNpcLiquid 第 6 段钳
    const grav = this.wet
      ? (this.shimmerWet ? 0.15 : this.honeyWet ? 0.1 : 0.2)
      : ENEMY_GRAVITY;
    this.vy = Math.min(this.vy + grav, MAX_FALL_SPEED);
    // ★BJ704-G3 D9（2026-10-21）：原版小 vx 清零（NPC.cs:91588-91591
    //   `|vx|<0.005 → 0`，UpdateNPC 全局段 AI 后/碰撞前对全体 NPC 无条件——
    //   Enemy 侧 BJ703-C D6 已接,AI_007 城镇面的走/站/坐 vx 残尾（×0.93 衰减链
    //   0.0048 级）同拍清零,帧机站定钉（vx==0 门）读到清零值）
    if (this.vx < 0.005 && this.vx > -0.005) this.vx = 0;
    moveAndCollide(this, world, this.vx, this.vy);
    // ★对抗修复批①2026-09-01：删除 `if(this.hitWall) this.vx*=0.5` 死阻尼——
    // X 轴拦截在 TileCollision.moveAxis 内已 b.vx=0，乘法恒零且原版无城镇撞墙半速
    //（cs 全文无此面）
    // ---- 卡墙折返（★对抗修复批①2026-09-01 对齐 cs:54789-54804，旧注释错引
    //      ":54403-54422"）：无位移连续 ≥30 拍触发【一次】后计数清零再积
    //      （原版 oldPosition==position && oldVelocity==velocity+gravity &&
    //      localAI[2]++>=30 → localAI[2]=0 + ai[0]=1/ai[1]=200+Next(300)/双翻）。
    //      ★原版语义精读（2026-09-02 备案收齐）：oldVelocity 在碰撞结算前快照
    //      （:93681）、oldPosition 在移动前快照（:93748）——条件本质 =「贴地+
    //      AI 走行意图逐拍原样保留+碰撞只吃速度」的贴地顶墙检测器；本仓 onGround
    //      门是该速度等式的贴地投影（非偏离），原版全等含 y 轴 → 悬空坠落态
    //      （y 逐拍变）原版同样不触发（向导电梯案实证，见 TileCollision
    //      unembedPass 悬空刷角门）。
    //      PARTIAL 余留（蓝队允许降级）：速度同符号近似判定未建，仅 x 轴位移；
    //      触发前提加 !flag16（危险中不折返,dangerNear 承接）与 !talking，
    //      旧 walkT<100 门/模10 摊销删除——原版无此二条件 ----
    if (wantDir !== 0 && this.onGround && !this.dangerNear && !this.talking
      && Math.abs(this.x - preX) < 0.01) {
      this.stuckT++;
      if (this.stuckT >= 30 && this.walkMode === 1) {
        this.stuckT = 0;                                   // :54791 localAI[2]=0 重积
        this.facing = -this.facing;
        this.vx = -this.vx;
        this.walkT = WALK_LEG_BASE + Math.floor(this.rng() * WALK_LEG_RAND);
        // ★对抗修复批⑤ A10(a)（cs:54795-97）：critter 腿程 bonus 第三掷
        // Next(200,400)=200+⌊r×200⌋（UnifiedRandom.cs:121-132 单采,勿双采）。
        // ★死域预防：该区域现行零实体,无既有回放依赖
        if (VANILLA_TOWN_CRITTER_SHEETS.has(this.vanillaId)) {
          this.walkT += 200 + Math.floor(this.rng() * 200);
        }
        turned = true;
      }
    } else {
      this.stuckT = 0;
    }
    if (!turned && wantDir !== 0) this.facing = wantDir;
    // 开关门（原版 54478-54500：撞到关着的门 → 1/10（或卡住必试）开门，两方向回退；
    // 54243-54274：走过门 >2 格关门，>4 格或 y 层差 >4 放弃）
    this.npcDoorUpdate(world, game);

    // ---- NPC 液体交互（NPC.cs UpdateCollision :93712-93805，Enemy 侧同款）：
    //      wet 判定/溅落/岩浆伤害/liqFactor 位移减速/湿身落速帽。时序与原版
    //      一致：AI 与重力/碰撞读上一 tick 的 wet（本块最后跑，更新下 tick 值）。
    //      湿身重力档（:91940-91956：水 0.2/蜜 0.1/微光 0.15）由 grav 提前消费 ----
    updateNpcLiquid(this, game, world.store);
    // ---- buff 353 浸液续期（[MAJOR-F4]：TryAddingRepeatedBuff NPC.cs:94211-18，
    //      调用点 :94446-56 `if (Collision.shimmer) { shimmerWet = true;
    //      if (Main.netMode != 1) TryAddingRepeatedBuff(353, 100); }`）——瞬时
    //      WetCollision 面（非 sticky shimmerWet：原版续期门是当拍 Collision.shimmer
    //      静态位，shimmer→水连续湿态时不续期）。序位 = 移动/碰撞后（UpdateCollision
    //      :91607 在 UpdateNPC 尾，同原版）；下拍 UpdateNPC_BuffSetFlags（:93101
    //      衰减 + :93255 shimmering 位）供上方 ramp lane 消费 ----
    this.shimmerBuffTryAddRepeated(world);

    // ---- 原版 FindFrame 城镇分支（NPC.cs:70172-70262，UpdateNPC :91565 调）----
    this.updateWalkFrame(game);

  }

  /** TryAddingRepeatedBuff(353,100)（NPC.cs:94211-94218）1:1：非免疫且
   *  （无 buff ∨ buffTime≤lowThresholdUndeathToAllowBuff=10）→ AddBuff(353,100)
   *  （:91035 免疫即拒/max 合并）。浸液判定 = 共享 wetCollision（Collision.cs
   *  :1575-1656 全量：中心 min(10,w)×min(h/2,h) 居中盒 + 液面收缩 + 坡上液体——
   *  与 Enemy 侧同款，Enemy.ts:2307 写 shimmerWet 面）的【瞬时】shimmer 位
   *  （调用点 :94446-56 读当拍 Collision.shimmer）。两调用点：主路径液体段尾 /
   *  bound 早退分支（原版 UpdateCollision 不分家）。rise 态整段早退于两调用点
   *  之前——上升态内不施加（原版入态即落点传送出池，WetCollision 恒假，等价） */
  private shimmerBuffTryAddRepeated(world: import('../world/World').World): void {
    if (isNpcShimmerImmune(this.vanillaId ?? -1)) return;   // buffImmune[353]（:17870）
    if (!wetCollision(world.store, this.x, this.y, this.w, this.h).shimmer) return;
    if (this.shimmerBuffT <= SHIMMER_BUFF_REAPPLY_LOW) this.shimmerBuffT = SHIMMER_BUFF_TICKS;
  }

  /** 游走双态 + 拴绳（AI_007 NPC.cs:54032-54288）1:1。sitFlag（雨/夜/食/史莱姆雨/
   *  风暴地表）优先于自由游走——雨天白天也走回家（:54056-54091）。返回 wantDir。
   *  状态对照：walkMode 0/1 = ai[0]==0/1；walkT = ai[1]（走程 200+Next(300) /
   *  停程 300+Next(300)+Next(900)）；turnLock = localAI[3]（随机转身锁 200t） */
  private wanderUpdate(
    world: import('../world/World').World, game: GameHooks, sitFlag: boolean,
  ): number {
    const st = world.store;
    // 无家者首落地锚定 homeTile（:53701-53704：homeTileX==-1 且站地 → UpdateHomeTileState）
    if (!this.home && !this.anchorTile && this.onGround) {
      this.anchorTile = {
        x: Math.floor(this.cx / TILE),
        y: Math.floor((this.y + this.h + 4) / TILE),
      };
    }
    const rest = this.restSpot ?? this.restFloor(world);       // FindGoodRestingSpot 输出
    const myX = Math.floor(this.cx / TILE);                    // num6
    const myY = Math.floor((this.y + this.h + 1) / TILE);      // num7
    // ★蓝队A-F1 拨正（2026-09-01）：回家双臂（站定 :54198 / 行走 :54320 的
    // `!TownCritter[type]` 门）与起身避坠豁免消费 TownCritter（NPCID.cs:4827）
    // 非 IsTownPet——家化宠物要能回家（旧集把 637/638/656 全挡在回家门外）
    const isCritter = VANILLA_TOWN_CRITTER_SHEETS.has(this.vanillaId);
    const atRest = rest != null && myX === rest.x && myY === rest.y;
    if (this.turnLock > 0) this.turnLock--;                    // :54040-54042 站定态递减
    let wantDir = 0;
    if (this.stationary || this.sitting || this.healing
      || this.atkState !== 0) return 0;   // ★状态机互斥：ai[0]∈{10..15} 时 idle/walk
      // 两臂整体挂起（原版同一 else-if 阶梯，攻击支独占）——否则游走臂的拴绳
      // 随机转身(:2118 rand(80))会在攻击态中翻 facing,把瞄准转向背离目标侧

    if (this.walkMode === 0) {
      // ---- 站定态（:54032-54168）----
      // 湿身城镇史莱姆强制走动（★对抗修复批⑤ A11 行号考古：真锚 cs:54171-76
      // `(flag9|flag10) && wet → ai[0]=1, ai[1]=200+Next(500,700)`；旧注
      // ":54047-54054" 系错引。flag10 = IsTownSlime；鳄鱼 flag9 是
      // 616/617/625/687 非 TownNPC 家族不适用）
      if (this.wet && SLIME_TOWN_IDS.has(this.vanillaId)) {
        this.walkMode = 1;
        this.walkT = RISE_LEG_WET_BASE + Math.floor(this.rng() * RISE_LEG_WET_RAND);
      } else if (sitFlag && this.home && !isCritter) {
        // 该回家（:54056-54091）：到家刹车+停稳试坐（sittingUpdate 承接）；
        // 未到家 → 走态朝 home（雨天白天同样命中——本仓旧版白天恒游走的偏离已修）
        if (atRest) {
          // :54063-54076 刹车由外层 wantDir=0 驻留刹车承担
          // ★对抗修复批③ F7-A（NPC.cs:54225-54228）：到家刹停臂的宠物表演掷口
          // ——IsTownPet → AttemptToPlayIdleAnimationsForPets(num21*4)（狗 638 为
          // 60*4=240，其余 120*4=480）。内部 vel.X==0f 门自检；骰序 1:1。
          // ★结构注：本臂原有 `this.home` 前提（旧约束沿用）——原版无家宠物同走
          // 此口，无家侧表演由 Entry B 覆盖，登记收窄）
          if (IS_TOWN_PET.has(this.vanillaId)) this.attemptPetIdle(this.petNum21 * 4);
        } else {
          this.facing = Math.sign(rest!.x - myX) || 1;
          this.walkMode = 1;
          this.walkT = REST_LEG_BASE + Math.floor(this.rng() * REST_LEG_RAND);
        }
      } else {
        // 常态站定（:54117-54168）：倒计时；溺水起身（:54138-54152）；
        // 到点起身（:54153-54165：前视有坑 → 转身再站 60+rand(120)，否则走态）
        // ★对抗修复批③ F7-B（NPC.cs:54268-54271）：`!flag5 && IsTownPet &&
        // ai[1]∈[100,150] → AttemptToPlayIdleAnimationsForPets(num21)`——原版该门
        // 位于 ai[1] 递减【之前】（检查旧值），本仓同序；骰序 1:1。
        if (!this.talking && IS_TOWN_PET.has(this.vanillaId)
          && this.walkT >= 100 && this.walkT <= 150) {
          this.attemptPetIdle(this.petNum21);
        }
        if (this.walkT > 0) this.walkT--;
        // 溺水起身（:54177-54186 外伞 `wet && !flag11` → currentlyDrowning3 =
        // DrownCollision(includeSlopes:true)，:54285）——wet 门保留、几何换真探针
        const drowning = this.wet && drownCollision(st, this.x, this.y, this.w, this.h, 1, true);
        if (drowning) {
          this.walkMode = 1;
          this.walkT = WALK_LEG_BASE + Math.floor(this.rng() * WALK_LEG_RAND);
          // ★对抗修复批⑤ A10(a)（cs:54287-92 溺水起身臂）：critter 第三掷
          // Next(200,400) 单采。★死域预防：该区域现行零实体,无既有回放依赖
          if (isCritter) this.walkT += 200 + Math.floor(this.rng() * 200);
          this.turnLock = 0;
        } else if (this.walkT <= 0) {
          const af = walkPrediction(
            st, myX, rest?.x ?? myX, isCritter, this.facing,
            Math.floor((this.cx + 15 * this.facing) / TILE),
            Math.floor((this.y + this.h - 16) / TILE), this.h,
          ).avoidFalling;
          if (!af) {
            this.walkMode = 1;
            this.walkT = WALK_LEG_BASE + Math.floor(this.rng() * WALK_LEG_RAND);
            // ★对抗修复批⑤ A10(a)（cs:54306-13 站桩耗尽起身臂）：critter 第三掷
            // Next(200,400) 单采。★死域预防：该区域现行零实体,无既有回放依赖
            if (isCritter) this.walkT += 200 + Math.floor(this.rng() * 200);
            this.turnLock = 0;
          } else {
            this.facing *= -1;
            this.walkT = 60 + Math.floor(this.rng() * 120);
          }
        }
      }
    } else {
      // ---- 行走态（:54189-54277）----
      // 该回家且已到好休息位 → 站定（:54151-54158；IsInAGoodRestingSpot 常态
      // = 精确同格，坐姿放宽 ±7 由 sitting 承接）
      const goodSpot = rest != null
        && (this.sitting
          ? Math.abs(myX - rest.x) <= 7 && Math.abs(myY - rest.y) <= 7
          : atRest);
      if (sitFlag && goodSpot && !isCritter) {
        this.walkMode = 0;
        this.walkT = REST_LEG_BASE + Math.floor(this.rng() * REST_LEG_RAND);
        this.turnLock = 60;
      } else {
        // flag21（:54361，同 fixedUpdate drowningNow 面）：行走态倒计时只在非溺水
        // 几何下挂上归家 −5/t 附加扣减——无 wet 门（★F4 换真探针）
        const drownGeom = drownCollision(st, this.x, this.y, this.w, this.h, 1, true);
        if (!drownGeom) {
          // ★红蓝批 R4（2026-09-01）：背离 drain 臂对齐 :54364-54374 字面——
          //   ①门加 `!tileDungeon[脚格]`（守卫老人驻砖上时整臂豁免,否则老人地牢
          //     游走被恒定加速耗腿）；
          //   ②方向判定改 position.X 与 home 列【左缘】比较（原版 position.X vs
          //     floorX*16）,非中心 sign 式；
          //   ③排布序=先 drain 后 ai[1]--（同拍两扣原版同序）。
          const feetOnDungeonTile = VANILLA_DUNGEON_TILES.has(st.type[st.idx(myX, myY)]);
          if (!feetOnDungeonTile && this.home && rest != null
            && (myX < rest.x - HOME_DRIFT_RANGE || myX > rest.x + HOME_DRIFT_RANGE)
            && ((this.x < rest.x * TILE && this.facing === -1)
              || (this.x > rest.x * TILE && this.facing === 1))) {
            this.walkT -= HOME_DRIFT_TICK;
          }
          this.walkT--;
        }
        // ★对抗修复批①2026-09-01：溺水（flag21）臂的递减删除——原版减法整体在
        // `if(!flag21)` 内（cs:54361-54375），没顶期间腿程【冻结】不减（drain −5/t
        // 同伞豁免，本仓结构照旧）；旧 else 臂照扣是造面
        if (this.walkT <= 0) {
          // 走→停换态（真锚 cs:54377-90——★对抗修复批⑤ A11 行号考古,旧注
          // ":54232-54242" 错引）：ai[1]=300+Next(300) 后 TownCritter 双分支
          // critter −Next(100) / 非 +Next(900)（cs:54384-85）;非 critter 路径逐骰
          // 逐值与旧实现等价（BASE+R1 两掷次序不变,第三掷即原 R2）
          this.walkMode = 0;
          this.walkT = STOP_LEG_BASE + Math.floor(this.rng() * STOP_LEG_RAND1);
          if (isCritter) {
            this.walkT -= Math.floor(this.rng() * STOP_LEG_RAND_CRITTER);
          } else {
            this.walkT += Math.floor(this.rng() * STOP_LEG_RAND2);
          }
          this.turnLock = 60;
        }
      }
      wantDir = this.facing;
    }
    // ---- 拴绳（:54324-54348）：【仅站定态 ai[0]==0 臂内】——(!flag || IsInGoodRest)
    //      门下 ±25 软界 rand(80) 随机转身 / ±50 硬界同向强制折返。★红蓝批 R3
    //      （2026-09-01）翻案：旧实现把本块放在 walkMode 无关的函数尾 ⇒ 行走态
    //      也吃随机转身/硬折返——原版行走态无拴绳干预（自然走程由 walkT/预测门
    //      终结），mid-walk 翻向会造成折返抖动。现随原版挂站定态内。
    if (this.walkMode === 0 && (!sitFlag || atRest) && rest != null) {
      if (myX < rest.x - LEASH_SOFT || myX > rest.x + LEASH_SOFT) {
        if (this.turnLock <= 0) {
          if (myX < rest.x - LEASH_HARD && this.facing === -1) this.facing = 1;
          else if (myX > rest.x + LEASH_HARD && this.facing === 1) this.facing = -1;
        }
      } else if (this.rng() * LEASH_TURN_CHANCE < 1 && this.turnLock <= 0) {
        this.turnLock = LEASH_TURN_LOCK;
        this.facing *= -1;
      }
    }
    // 行走向取拴绳翻转后的最新 facing（原版 direction 同 tick 生效于速度应用）
    return this.walkMode === 1 ? this.facing : 0;
  }

  /** 前方站定友方挤人扫（:56105-56115）：自身盒 X−20/宽+40 的扩展盒内，任一
   *  非自身城镇 NPC velocity.X==0（站定）→ true（keepwalking ②路） */
  private crowdedByStationaryNpc(game: GameHooks): boolean {
    const ex = this.x - 20, ew = this.w + 40;
    for (const o of game.npcs?.() ?? []) {
      const n = o as TownNPC;
      if (!(n instanceof TownNPC) || n === this || n.dead) continue;
      if (n.vx !== 0) continue;                     // velocity.X == 0 站定
      if (ex < n.x + n.w && ex + ew > n.x && this.y < n.y + n.h && this.y + this.h > n.y) return true;
    }
    return false;
  }

  /** FindGoodRestingSpot 的 floorX/floorY（NPC.cs:53195-53215 头段）：home/anchor
   *  列向下找地面行；白天直接返回（不扫椅——夜间扫椅由 fixedUpdate 的 restSpot
   *  前置算好）。home.y 本仓是站格（地面行−1），向下找会立刻命中所站地面行 */
  private restFloor(world: import('../world/World').World): { x: number; y: number } | null {
    const a = this.home ?? this.anchorTile;
    if (!a) return null;
    const st = world.store;
    let fy = a.y;
    // ★BJ657（2026-10-12）同 findChairSpot 换道 isSolidOrSlopedTileOrPlatform
    //  （:53352 同式;{239,380}/家具顶不当地板——下探穿透至真实地面行）
    while (fy < st.h - 20 && !st.isSolidOrSlopedTileOrPlatform(a.x, fy)) fy++;
    return { x: a.x, y: fy };
  }

  /** 社交/表演态（AI_007 掷骰 :55630-55835 + 推进 :54660-54748 + FindFrame
   *  :69577-70152 表演帧）。返回 true = 态中（调用方停走）。
   *  else-if 掷骰链每 tick 顺序掷（命中即止）——与原版同概率结构：
   *  ① 聊天 1/300（CanTalk 站定发起；partner 20..100px+LOS；时长
   *    420×[Next(2)!=0 ? Next(1,3) : Next(1,4)] 即 420/840/1260）
   *  ② RPS 1/1800（partner 同门+!IsTownPet；发起 localAI[2]=Next(4)、
   *    localAI[3]=Next(3−l2)）
   *  ③ 派对舞 1/1200（!IsTownPet 且 id==208 或派对中 AttackType==0 族；
   *    玩家 150px+Top 锚 LOS；300t）
   *  ④' 酒馆老板 550 扔麦酒 1/600（新批）：玩家 150px+Top 锚 LOS；300t→ai0=18
   *  ④ 发呆 1/1800（!IsTownPet；45t；帧 0⇄num58−1 循环）
   *  ④" 海盗 229 拨弄 1/600（新批）：30×Next(1,4)t→ai0=11（与发呆共段推进）
   *  ⑤ 面向玩家 1/1200（220t；Player.CanBeTalkedTo+UI 门收窄后触发；
   *    帧 16t 处冒 112 头像、160t 冒 60）
   *  ⑥ 驻足看家具 1/600（行走态；身上无 AvoidedByNPCs 贴块且前方 10px 格
   *    InteractableByNPCs → 40+Next(90)t）
   *  禁触 = flag30：ai[0]<2 && !flag16 && !wet（危险中/湿身/带门行走/对话/
   *  攻击/坐姿全挡） */
  private socialUpdate(world: import('../world/World').World, game: GameHooks): boolean {
    const rnd = this.rng;
    // ---- A. 态推进（:54660-54748）----
    if (this.social) {
      const s = this.social;
      this.vx *= 0.8;                                        // :54683/:54720
      s.t--;                                                 // ai[1]--
      if (s.kind === 2 || s.kind === 11) {
        // 发呆/海盗闲坐小转身（:54663-54669，ai0==2||11 共段）：rand(60)==0 且锁尽
        // → 翻向锁 60（掷骰每拍照耗——与原版非短路序一致）
        if (this.turnLock > 0) this.turnLock--;
        if (rnd() * 60 < 1 && this.turnLock <= 0) {
          this.turnLock = 60;
          this.facing *= -1;
        }
      }
      if ((s.kind === 6 || s.kind === 7 || s.kind === 18 || s.kind === 19) && s.t > 0) {
        // 对玩家态（:54861 ai0∈{6,7,18,19} 共段 + :54870-54742）：玩家失效
        // （CanBeTalkedTo 不满足 / >200px / Top 锚无 LOS）→ t=0；否则面向玩家。
        // ★2026-08-31 台账批：补 Player.CanBeTalkedTo(:3872 stealth==1f 面)；
        //   LOS 端点由盒左上角改 Entity.Top（中心-X,顶-Y）
        const pl = (game as unknown as { player?: { x: number; y: number; w: number; h: number; dead: boolean } }).player;
        const pStealth = pl ? ((pl as unknown as { stealth?: number }).stealth ?? 1) : 1;
        const talkable = !!pl && !pl.dead && pStealth >= 1;
        const pTopX = pl ? pl.x + pl.w / 2 : 0;
        if (!talkable
          || Math.hypot(pTopX - this.cx, pl!.y + pl!.h / 2 - this.cy) > 200
          || !canHitLine(world.store, this.cx, this.y, 0, 0, pTopX, pl!.y, 0, 0)) {
          s.t = 0;                                           // :54870-54874
        } else {
          this.facing = pTopX < this.cx ? -1 : 1;            // :54876-54882
        }
      }
      if (s.kind === 24) {
        // 施法态锁向（ai[0]==24 块 :55691-55692 每拍直写）
        this.facing = 1;
      }
      if (s.t <= 0) {
        if (s.kind === 24) {
          // 施法结束（:55695-55703）：ai[0]=0 / ai[1]=480 / localAI[1]=480 /
          // ai[2]=0——非社交普通退出口，不走两掷
          this.social = null;
          this.walkMode = 0;
          this.walkT = 480;
          this.atkCd = 480;
          return false;
        }
        this.social = null;
        this.walkMode = 0;
        this.walkT = 60 + Math.floor(rnd() * 60);            // :54827/:54855 两族同值
        this.turnLock = (s.kind === 2 || s.kind === 11)
          ? 40                                               // {2,11} 族 localAI[3]=40（:54828）
          : 30 + Math.floor(rnd() * 60);                     // 其余 30+Next(60)（:54859）+同拍掷骰
        return false;
      }
      return true;
    }
    // ---- B. 掷骰（:55630-55835；flag30 = ai[0]<2 && !flag16 && !wet）----
    if (this.dangerNear || this.wet || this.talking || this.atkState !== 0
      || this.healing || this.sitting || this.corneredT > 0 || !this.onGround) return false;
    const isPet = IS_TOWN_PET.has(this.vanillaId);
    const canTalk = !isPet;
    if (canTalk && this.walkMode === 0 && rnd() * 300 < 1) {
      // ① 结对聊天（:55630-55673）
      const dur = 420 * (rnd() < 0.5
        ? 1 + Math.floor(rnd() * 2)      // Next(1,3) ∈ {1,2}
        : 1 + Math.floor(rnd() * 3));    // Next(1,4) ∈ {1,2,3}
      // ★阶梯语义对齐（蓝队补记）：C# else-if 一旦分支条件匹配，即便 body 内
      // 目标扫描落空也整拍收尾——不续走后续 else-if 再耗掷。下同（②③④'⑤）。
      const partner = this.findChatPartner(world, game, false);
      if (partner) {
        const dir = this.x < partner.x ? 1 : -1;
        this.social = { kind: 3, t: dur, other: partner, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
        this.facing = dir;
        partner.social = { kind: 4, t: dur, other: this, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
        partner.facing = -dir;
        return true;
      }
      return false;
    } else if (canTalk && this.walkMode === 0 && rnd() * 1800 < 1) {
      // ② 石头剪刀布对局（:55675-55701）
      const dur = 420 * (rnd() < 0.5
        ? 1 + Math.floor(rnd() * 2)
        : 1 + Math.floor(rnd() * 3));
      const partner = this.findChatPartner(world, game, true);
      if (partner) {
        const dir = this.x < partner.x ? 1 : -1;
        const a = Math.floor(rnd() * 4);                    // localAI[2]=Next(4)
        this.social = {
          kind: 16, t: dur, other: partner, frameT: 0, prevFrame: 0,
          rpsA: a, rpsB: Math.floor(rnd() * (3 - a)),       // localAI[3]=Next(3−l2)
        };
        this.facing = dir;
        partner.social = { kind: 17, t: dur, other: this, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
        partner.facing = -dir;
        return true;
      }
      return false;
    } else if (!isPet && this.walkMode === 0 && rnd() * 1200 < 1
      && (this.vanillaId === 208
        || (!!world.scene?.partyUp && (TOWN_ATTACK_TYPE[this.vanillaId] ?? -1) === 0))) {
      // ③ 派对舞（:55860-55884 前段）：208 派对女孩恒掷；其余=派对中近战族
      // （AttackType[208]=0 同族）；玩家 150px + LOS（Top 锚）
      const pl = (game as unknown as { player?: { x: number; y: number; w: number; h: number; dead: boolean } }).player;
      if (pl && !pl.dead
        && Math.hypot(pl.x + pl.w / 2 - this.cx, pl.y + pl.h / 2 - this.cy) < 150
        && canHitLine(world.store, this.cx, this.y, 0, 0, pl.x + pl.w / 2, pl.y, 0, 0)) {
        this.social = { kind: 6, t: 300, other: null, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
        this.facing = pl.x + pl.w / 2 < this.cx ? -1 : 1;
        return true;
      }
      return false;   // 分支已命中掷门、玩家扫描落空 → 整拍收尾（阶梯语义）
    } else if (!isPet && this.walkMode === 0 && rnd() * 600 < 1 && this.vanillaId === 550) {
      // ④' 酒馆老板扔麦酒演出（:55886-55905 新批）：站定 1/600，玩家 150px +
      // CanHitLine(Top→Top) 才演——ai0=18 / ai1=300 / ai2=玩家槽 / 面向玩家。
      // FindFrame 档见 socialFrame case 18（终值帧常驻 npcFrameCount−2 反编译原文）
      const pl = (game as unknown as { player?: { x: number; y: number; w: number; h: number; dead: boolean } }).player;
      if (pl && !pl.dead
        && Math.hypot(pl.x + pl.w / 2 - this.cx, pl.y + pl.h / 2 - this.cy) < 150
        && canHitLine(world.store, this.cx, this.y, 0, 0, pl.x + pl.w / 2, pl.y, 0, 0)) {
        this.social = { kind: 18, t: 300, other: null, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
        this.facing = pl.x + pl.w / 2 < this.cx ? -1 : 1;
        return true;
      }
      return false;   // 分支已命中掷门、玩家扫描落空 → 整拍收尾（阶梯语义）
    } else if (!isPet && this.walkMode === 0 && rnd() * 1800 < 1) {
      // ④ 发呆（:55757-55762→1458 :55950 族）：45t（原版 45×Next(1,2)=45×1 恒定）
      this.social = { kind: 2, t: 45, other: null, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
      return true;
    } else if (!isPet && this.walkMode === 0 && rnd() * 600 < 1 && this.vanillaId === 229) {
      // ④" 海盗闲坐拨弄（:55908-55915 新批）：站定 1/600 → ai0=11 /
      // ai1=30×Next(1,4)（30/60/90t 三档）。尾部 `&& !flag18` 的 flag18 在 AI_007
      // 内全文无置位（死旗），按字面省略。态内推进与发呆共段（转身边+退出口），
      // 表演帧带独立（case 11：困盹气泡+dust216）
      this.social = { kind: 11, t: 30 * (1 + Math.floor(rnd() * 3)), other: null, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
      return true;
    } else if (this.walkMode === 0 && rnd() * 1200 < 1
      && this.playerCanBeTalkedTo(game)) {
      // ⑤ 面向玩家问好（:55910-55926）：★2026-08-31 台账批收窄——
      //   玩家门由「在场」修为 Player.CanBeTalkedTo(:3872，active&&!dead&&!ShouldNotDraw
      //   &&stealth==1f——隐身衣/潜行未满格不点头)+UI 占用工程门(input.uiBlocking≈
      //   原版 mouseInterface/smartInteract 家族,背包/挂牌/商店开着不点头,登记择优叠加);
      //   LOS 端点改 Entity.Top 中心锚。220t；帧 16t 冒 112、160t 冒 60
      const pl = (game as unknown as { player?: { x: number; y: number; w: number; h: number; dead: boolean } }).player;
      if (pl && !pl.dead
        && Math.hypot(pl.x + pl.w / 2 - this.cx, pl.y + pl.h / 2 - this.cy) < 150
        && canHitLine(world.store, this.cx, this.y, 0, 0, pl.x + pl.w / 2, pl.y, 0, 0)) {
        this.social = { kind: 7, t: 220, other: null, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
        this.facing = pl.x + pl.w / 2 < this.cx ? -1 : 1;
        return true;
      }
      return false;   // 分支已命中掷门、玩家扫描落空 → 整拍收尾（阶梯语义）
    } else if (this.walkMode === 1 && rnd() * 600 < 1
      && this.plotAvoidClear(world.store)) {
      // ⑥ 驻足看家具（:55816-55835）：前方 10px 格 InteractableByNPCs
      const st = world.store;
      const fx = Math.floor((this.cx + this.facing * 10) / TILE);
      const fy = Math.floor(this.cy / TILE);
      if (st.inBounds(fx, fy)) {
        const ti = st.idx(fx, fy);
        const tid = st.type[ti];
        // NPC.cs:55972-55974 `!tileSafely7.nactive() || !InteractableByNPCs[type] → false`
        // ——nactive 门读 isActive（红蓝对抗 F11：曾用 type≠0 代读，幽灵家具残型误触发驻足看）
        if (tid !== 0 && st.isActive(fx, fy) && TILE_DEFS[tid]?.vanilla
          && INTERACTABLE_BY_NPC_TILES.has(tid)) {
          this.social = { kind: 9, t: 40 + Math.floor(rnd() * 90), other: null, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
          this.vx = 0;                                      // :55831 velocity=0
          this.turnLock = 0;                                // ★对抗修复批⑤ A7（RB-L3）:55982 localAI[3]=0f——入态清驻足锁,防上拍残锁冻结转身/拴绳链
          return true;
        }
      }
    }
    return false;
  }

  /** Player.CanBeTalkedTo（Player.cs:3872-3881）：active && !dead && !ShouldNotDraw
   *  && stealth == 1f。本仓 dead 门已覆盖硬核幽灵相（ShouldNotDraw 的 invis 载体），
   *  stealth 为公开累积位（隐身药水/星璇/蘑菇矿潜行 <1 时 NPC 不问好不冒泡）。
   *  ★工程收窄叠加（2026-08-31 台账批，非原版 AI 内条件——原版对应面在 Main 的
   *  mouseInterface/smartInteract 家族 :43793-43802）：UI 占用（背包/挂牌编辑/
   *  商店等 input.uiBlocking）时同样不问好不点头。 */
  private playerCanBeTalkedTo(game: GameHooks): boolean {
    const p = (game as unknown as { player?: { dead?: boolean; stealth?: number } }).player;
    if (!p || p.dead) return false;
    if ((p.stealth ?? 1) < 1) return false;
    const ui = (game as unknown as { input?: { uiBlocking?: boolean } }).input;
    return !ui?.uiBlocking;
  }

  /** 树妖 Stardew 彩蛋施法态置入（HaveDryadDoStardewAnimation NPC.cs:19220-19248
   *  对 type==20 循环体的实体侧）：localAI[2]=480（prevAi0 承接）、ai[0]=24 /
   *  ai[1]=480 / ai[2]=0 / localAI[3]=0、direction=spriteDirection=1；弹 995 的
   *  全屏 StardewValleyAnimation 与落点扫描由 fx/StardewAnimation 编排器承担。
   *  返回 false = 已在演出中（CanDryadPlayStardewAnimation 的 ai[0]!=24 门）。 */
  enterStardewCast(): boolean {
    if (this.social?.kind === 24) return false;
    this.prevAi0 = 480;                    // 原文 localAI[2]=480 直录（该位仅被
                                           // exitAttackCommon 的 ==8 判定消费）
    this.social = { kind: 24, t: 480, other: null, frameT: 0, prevFrame: 0, rpsA: 0, rpsB: 0 };
    this.sitting = false;                  // ai[0] 换号即离坐姿（TryForcingSitting 同理）
    this.facing = 1;                       // direction = spriteDirection = 1
    this.vx = 0;
    return true;
  }

  /** num21（NPC.cs:54189-54193）：宠物表演掷口基数——120，狗 638 减半为 60。
   *  两处消费：到家臂 ×4（Entry A）与常态站定 walkT∈[100,150] 窗原值（Entry B） */
  private get petNum21(): number {
    return this.vanillaId === 638 ? 60 : 120;
  }

  /** AI_007_AttemptToPlayIdleAnimationsForPets（★对抗修复批③ F7 定义段，
   *  NPC.cs:56320-56354）1:1：掷中则置入表演态（social.kind 20/21/22 影子承接）。
   *  骰序逐张对齐：①Next(chance)==0 → ②(num==0 免骰直取 20；否则 Next(20,20+num)
   *  一张) → ③ai[1]=200+Next(300) → ④型别时长覆写各一张。时长表：
   *  猫 637@20 = 500+Next(200) / 狗 638@21 = 100+Next(100) / 兔 656@22 =
   *  200+Next(200) / 城镇史莱姆@20 = 180+Next(240)，未命中覆写的走基档
   *  200+Next(300)。turnLock=localAI[3]=0、ai[2]=0（social 字段全新建=清零）。 */
  private attemptPetIdle(chance: number): void {
    if (this.vx !== 0) return;                         // :56322 velocity.X==0f 字面前置（不耗骰）
    if (this.rng() >= 1 / chance) return;              // :56322 Main.rand.Next(chance)==0
    let num = 3;                                       // 缺省 {20,21,22}
    if (this.vanillaId === 638) num = 2;               // :56325 狗二态 {20,21}
    const slime = SLIME_TOWN_IDS.has(this.vanillaId);
    if (slime) num = 0;                                // :56328 IsTownSlime 恒演 20
    const kind = num === 0 ? 20 : 20 + Math.floor(this.rng() * num);   // Next(20,20+num)
    let dur = 200 + Math.floor(this.rng() * 300);      // ai[1]=200+Next(300)（:56335）
    if (kind === 20 && this.vanillaId === 637) dur = 500 + Math.floor(this.rng() * 200);
    if (kind === 21 && this.vanillaId === 638) dur = 100 + Math.floor(this.rng() * 100);
    if (kind === 22 && this.vanillaId === 656) dur = 200 + Math.floor(this.rng() * 200);
    if (kind === 20 && slime) dur = 180 + Math.floor(this.rng() * 240);
    this.walkMode = 0;                                 // ai[0]=20..22 ⇒ 行走终断（防残留）
    this.social = {
      kind: kind as 20 | 21 | 22, t: dur, other: null,
      frameT: 0, prevFrame: 0, pc: 0, rpsA: 0, rpsB: 0,
    };
    this.turnLock = 0;                                 // localAI[3]=0（:56344）
  }

  /** 聊天/RPS 对偶搜索（:55636-55649 / :55681-55694）：CanBeTalkedTo（站地城镇
   *  族）+ !flag32（(行走态且带门) || (行走态且走程>200) || 非走/站态 || 湿身
   *  ——社交/攻击/坐姿/对话/被逼停全算"忙"）+ 20<dist<100 + LOS 点对点 */
  private findChatPartner(
    world: import('../world/World').World, game: GameHooks, noPet: boolean,
  ): TownNPC | null {
    for (const o of game.npcs?.() ?? []) {
      const n = o as TownNPC;
      if (!(n instanceof TownNPC) || n === this || n.dead || n.bound) continue;
      if (noPet && IS_TOWN_PET.has(n.vanillaId)) continue;   // RPS 排除宠物
      if (!n.onGround || n.talking) continue;                // CanBeTalkedTo
      const busy = n.social !== null || n.sitting || n.atkState !== 0
        || n.healing                                          // ai[0]==13 同属"忙"（flag32 非走/站态）
        || n.corneredT > 0 || n.wet
        || (n.walkMode === 1 && (n.doorCarry || n.walkT > 200));   // flag32
      if (busy) continue;
      const d = Math.hypot(n.cx - this.cx, n.cy - this.cy);
      if (d >= 100 || d <= 20) continue;
      // ★F5②（NPC.cs:55805 字面）：对偶搜索 LOS 锚 = Center 点对
      // （CanHit(base.Center,0,0,nPC.Center,0,0)），非盒左上角锚—— socialUpdate 的
      // 玩家向态（6/7 :55860/:55908 base.Top）保持 Top 锚不动
      if (!canHitPoint(world.store, this.cx, this.cy, n.cx, n.cy)) continue;
      return n;
    }
    return null;
  }

  /** SearchAvoidedByNPCs 身体扫描（DelegateMethods.cs:900 + PlotTileLine）：
   *  身体覆盖盒内任一格是 AvoidedByNPCs（火把/尖刺/雕像等）→ false（有避让块） */
  private plotAvoidClear(st: TileStore): boolean {
    const x0 = Math.floor(this.x / TILE), x1 = Math.floor((this.x + this.w - 0.01) / TILE);
    const y0 = Math.floor(this.y / TILE), y1 = Math.floor((this.y + this.h - 0.01) / TILE);
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const tid = st.type[st.idx(i, j)];
        // DelegateMethods.cs:913-915 字面 `!active() || !AvoidedByNPCs[type] → true`
        // （幽灵格=无避让）——active() 位本体读 hasTile（红蓝对抗 F12：曾用 type≠0
        // 代读，幽灵火把/尖刺残型误判避让块 → NPC 永不驻足）
        if (tid !== 0 && !st.hasTile(i, j)) continue;
        if (AVOIDED_BY_NPC_TILES.has(tid)) return false;
      }
    }
    return true;
  }

  /** FindFrame 城镇分支（NPC.cs:70172-70262 + 前置 ai 态链 :69310-69847）：
   *  腾空（velocity.Y!=0 整链旁落）= 帧1；坐姿 ai[0]==5 = num58−3（:69637-69643）；
   *  攻击态 ai[0]∈{10,12,14,15} 按原版分档（attackFrame）；地面站定=帧0、计数清零；
   *  行走 frameCounter += |vx|*2+1，>6 推进，帧区间 2..frames-extra-1（越界回卷
   *  帧2）。微光上升态同样调（原版 FindFrame 在 AI 早退之后仍执行 :91565）。
   *  被逼停 ai[0]==8 不在原版 ai 态链（落 velocity.X==0 空闲帧 0）；玩家对话
   *  （talkNPC==本体 :53721 置 ai[0]=0）原版同落帧 0。社交表演帧带经 socialFrame
   *  承接（ai[0]∈{2,11,18,24,6,7,19,9,3,4,16,17} 全列 + ★对抗修复批③ 宠物表演
   *  {20,21,22}——FindFrame :69454-69689 带行表见 socialFrame 对应 case）。 */
  private updateWalkFrame(game?: GameHooks): void {
    if (!this.onGround) {
      this.frame = 1;
      this.frameT = 0;
      return;
    }
    const total = VANILLA_NPCS[String(this.vanillaId)]?.frames ?? 1;
    const base = townNpcBaseFrame(this.vanillaId, total);   // num58（:69320）
    if (this.social) {
      this.socialFrame(base, game);
      return;
    }
    if (this.sitting) {
      // ai[0]==5f（:69751-69758）：坐姿 = num60−3；637 猫特例 = 绝对行 19。
      // ★BJ592 补：原版坐椅扫描排除面只有 638/656/史莱姆族（FindGoodRestingSpot
      // :53363 `type == 638 || type == 656 || IsTownSlime || ai[0]==5`）——猫【可坐】
      // 且坐姿走专帧（本仓 NO_SIT_NPC_IDS 同式不含 637 → 旧码落 base−3=25 行=错姿态）。
      this.frame = this.vanillaId === 637 ? 19 : base - 3;
      this.frameT = 0;
      return;
    }
    if (this.atkState !== 0) {
      this.attackFrame(base);
      return;
    }
    if (Math.abs(this.vx) < 0.05) {
      this.frame = 0;
      this.frameT = 0;
    } else {
      const extra = TOWN_NPC_IDS[this.npcKey]?.extra ?? 2;
      // ★城镇宠物专项(FindFrame cs:69557-69604):兔656 家宅/进食带自帧7起
      //  (cs:69559-69575 <10||>16 归位带)、猫637 自帧10(cs:69581 <17||>21)、
      //  狗638 社交带 23..27。通用「2..frames−extra−1」会把姿态帧卷进行走
      //  (用户实拍:兔边走边啃萝卜)。上界逐型钳制如下
      let walkMax = total - extra - 1;
      if (this.vanillaId === 656) walkMax = Math.min(walkMax, 6);
      else if (this.vanillaId === 637) walkMax = Math.min(walkMax, 9);
      else if (this.vanillaId === 638) walkMax = Math.min(walkMax, Math.max(2, 16));
      this.frameT += Math.abs(this.vx) * 2 + 1;
      if (this.frame < 2 || this.frame > walkMax) this.frame = 2;
      if (this.frameT > 6) {
        this.frameT = 0;
        this.frame++;
      }
      if (this.frame > walkMax) this.frame = 2;
    }
  }

  /** NewBubbleNPC 的表情挑选语境（EmotePick.ts = EmoteBubble.PickNPCEmote :295-1065
   *  全量 1:1）。Game 启动注入世界/玩家/在场普查快照工厂；null（早期 boot/单测）
   *  → 回退 ProbeEmotions 基池近似（NPC_EMOTE_POOL） */
  static emoteHost: (() => import('../world/EmotePick').EmotePickContext | null) | null = null;

  /** ★IIIII233（2026-09-09）：旧"ProbeEmotions 基池近似"升级为 PickNPCEmote 全量池——
   *  九 Probe 按原版概率并集（TownNPCs/Emotions/Biomes/Critters/Items/Bosses/
   *  Debuffs/Events/Weather）+ ProbeExceptions NPC 专属池（19↔22/107↔124 对话
   *  other 特判、list.Contains 分支）+ boss 在场整池换 ProbeCombat。空池 → 0（:351） */
  private static emotePickFor(anchor: TownNPC, otherId?: number): number {
    const ctx = TownNPC.emoteHost?.();
    if (ctx) {
      const self = {
        vanillaId: anchor.vanillaId, y: anchor.y, cy: anchor.cy,
        onFire: anchor.onFireT > 0,
        // TownNPC 无中毒运行时位（Enemy.poisonT 为敌怪域；登记：锚 NPC.poisoned
        // 恒 false，玩家侧 poisoned 照实供）
        poisoned: false,
      };
      return pickNpcEmote(ctx, anchor.rng, self, otherId);
    }
    const pool = TownNPC.NPC_EMOTE_POOL;
    return pool[Math.floor(anchor.rng() * pool.length) % pool.length];
  }

  /** 备胎基池（ProbeEmotions :596-610 的 15 项,无语境回退用） */
  private static readonly NPC_EMOTE_POOL: readonly number[] =
    [0, 1, 2, 3, 15, 16, 17, 87, 91, 134, 135, 136, 137, 138, 139];

  /** 社交/表演帧带（FindFrame NPC.cs:69577-70152 的 ai[0]∈{2,3,4,6,7,9,16,17}
   *  分支逐条 1:1）。时间线用 tick 近似原版渲染帧 counter（本仓固定 60fps 同速）。
   *  表情触发挂在帧号精确时刻（16/70/160/216/320/40/100），天然单次 */
  private socialFrame(base: number, game?: GameHooks): void {
    const s = this.social!;
    const prev = this.frame;
    s.frameT++;
    const t = s.frameT;
    switch (s.kind) {
      case 2: {
        // 发呆（:69578-69593）：帧 0 持续 40t → num58−1（瞌睡）5t → 循环
        if (this.frame === base - 1) {
          if (t >= 5) { this.frame = 0; s.frameT = 0; }
        } else if (this.frame === 0) {
          if (t >= 40) { this.frame = base - 1; s.frameT = 0; }
        } else {
          this.frame = 0;
          s.frameT = 0;
        }
        break;
      }
      case 6: {
        // 派对舞（:69645-69700）：−5/−4 交替，−4 段每 30t 一次（[16,46)/[72,102)/
        // [120,150)/[168,198)/[216,246)/[264,294)），≥300 重置。−5→−4 切换当帧
        // 8 尘 139-143（音符，:69665-69678：Center+(10×dir,−4)，vel=(vx+dir,vy−2.5)
        // 后 vx+=dir×1.5、pos−4、vel×2、scale 0.7+rand×0.3）
        const up: Array<[number, number]> = [
          [16, 46], [72, 102], [120, 150], [168, 198], [216, 246], [264, 294],
        ];
        let f = 0;
        if (t >= 10 && t < 300) {
          f = up.some(([a, b]) => t >= a && t < b) ? base - 4 : base - 5;
        }
        if (f === base - 4 && prev === base - 5) this.danceDust(game);
        this.frame = f;
        if (t >= 300) s.frameT = 0;
        break;
      }
      case 7:
      case 19: {
        // 面向玩家 / 回应玩家表情（:69680 ai[0]==7||ai[0]==19 同帧带 :69721-69760）：
        // 16t/160t 冒 NewBubbleNPC——★第二参是【时长 tick】
        // 非表情 id（EmoteBubble.cs:134 签名 NewBubbleNPC(anchor, time, other)，表情
        // 由 PickNPCEmote 随机选；112/60 此前误当表情 id）；[16,128) 与 [160,220)
        // 说话帧 −2 交替
        let f = 0;
        if (t < 16) f = 0;
        else if (t < 128) f = t % 16 < 8 ? base - 2 : 0;
        else if (t < 160) f = 0;
        else if (t < 220) f = t % 12 < 6 ? base - 2 : 0;
        this.frame = f;
        if (t === 16) spawnEmote(this, this.npcEmotePick(), 112);   // NewBubbleNPC(anchor,112t)
        if (t === 160) spawnEmote(this, this.npcEmotePick(), 60);   // NewBubbleNPC(anchor,60t)
        if (t >= 220) s.frameT = 0;
        break;
      }
      case 9: {
        // 驻足看家具（:69722-69743）：<10 帧0 → <16 −5 → −4；临结束回看
        let f = 0;
        if (t < 10) f = 0;
        else if (t < 16) f = base - 5;
        else f = base - 4;
        if (s.t < 16) f = base - 5;
        if (s.t < 10) f = 0;
        this.frame = f;
        break;
      }
      case 3:
      case 4: {
        // 结对聊天（:69865-69942）：发起者 num92/应答者 num93 双时间线；
        // 表情由发起方掷。★2026-08-31 台账批：三处 NewBubbleNPC 按原式落——
        // 第二参=时长 tick，表情=PickNPCEmote 随机（旧码把 90/70/100 当表情 id
        // 直绘且寿命恒默认 180）；==70 泡锚在【对方头顶】（NewBubbleNPC(
        // anchor=nPC,time=90,other=self)，nPC.CanTalk 门），==216/==320 锚在自己。
        let mine = 0, theirs = 0;
        if (t < 10) mine = 0;
        else if (t < 16) mine = base - 5;
        else if (t < 46) mine = base - 4;
        else if (t < 60) mine = base - 5;
        else if (t < 216) mine = 0;
        else if (t < 286) mine = t % 12 < 6 ? base - 2 : 0;
        else if (t < 320) mine = 0;
        else if (t < 420) mine = t % 16 < 8 ? base - 2 : 0;
        if (t < 70) theirs = 0;
        else if (t < 160) theirs = t % 16 < 8 ? base - 2 : 0;
        else if (t < 166) theirs = base - 5;
        else if (t < 186) theirs = base - 4;
        else if (t < 200) theirs = base - 5;
        else if (t < 320) theirs = 0;
        else if (t < 326) theirs = base - 1;
        this.frame = s.kind === 3 ? mine : theirs;
        if (s.kind === 3) {
          // NewBubbleNPC(anchor, time, other)（EmoteBubble.cs:134）：
          //   ==216 → (self, 70, partner)  ==320 → (self, 100, partner)
          //   ==70  → (partner, 90, self)，须 partner.CanTalk（:6673 站地+非宠物）
          const partnerCanTalk = s.other ? s.other.onGround && !IS_TOWN_PET.has(s.other.vanillaId) : false;
          if (t === 216) spawnEmote(this, this.npcEmotePick(s.other?.vanillaId), 70);
          if (t === 320) spawnEmote(this, this.npcEmotePick(s.other?.vanillaId), 100);
          if (t === 70 && s.other && partnerCanTalk) {
            // 伙伴锚泡：PickNPCEmote 语境锚=伙伴、other=发起者（原版
            // NewBubbleNPC(new WorldUIAnchor(nPC), 90, new WorldUIAnchor(this))）
            spawnEmote(s.other, TownNPC.emotePickFor(s.other, this.vanillaId), 90);
          }
        }
        if (t >= 420) s.frameT = 0;
        break;
      }
      case 11: {
        // 海盗闲坐拨弄（FindFrame ai[0]==11 :69709-69750）：帧 0 →(≥20t)→
        // num60−1 困盹帧 + NewBubble(89, self, 90)；困盹满 50t 的那一拍从背后撒
        // dust 216 ×(3+Next(4))（:69719-69723 NewDust(…,−dir,1) 后整体 velocity /= 2
        // ——★BJ592 拨正：÷2 施于【spawn 结果】（含 NewDust 内随机抖动 ±2.0），
        // 旧码预折半 speed 形参=抖动未折半（幅度 2×发散））+ 1/30 gore 580-582
        // （:69724-69731 NewGore(Center+UnitX*(-dir)*8, Zero, Next(580,583))，
        // Spawn_Digestion 同款臭气团三变体（ParticleOrchestrator.cs:2350 同式）——
        // NewGore 内随机化（vy−=Next(10,31)*0.1/vx+=Next(-20,21)*0.1, Gore.cs:1347-48）
        // 后 /=2、Y=|Y|（转下坠）、X=−|X|×dir（背向漂）；Gore.cs:770-774 特例
        // rotation=0+vx×0.95 在 GorePiece.fixedUpdate 承接）；≥100t 且 Next(20)==0
        // 回帧 0。★BJ592 补 :69745-69749 恢复支（帧既非 0 又非困盹帧 → 拍回 0——
        // 社交态入场残行走帧原直坠 t≥20 分支冒泡,原版先归位帧 0）。
        // 转身/退出口与发呆共段（socialUpdate A 区 {2,11} 族）
        if (this.frame === base - 1) {
          if (t === 50) {
            const n67 = 3 + Math.floor(this.rng() * 4);              // Next(4)（无条件耗骰）
            if (game?.vanillaDust) {
              for (let i = 0; i < n67; i++) {
                const d = game.vanillaDust.spawn(
                  this.cx - this.facing * 8 - 5, this.cy + 3, 3, 6, 216,
                  -this.facing, 1, 0, null, 0.8);
                if (d) { d.vx /= 2; d.vy /= 2; d.scale = 0.8; }
              }
            }
            if (this.rng() < 1 / 30) {                               // Next(30)==0
              const g = GorePiece.newGore(580 + Math.floor(this.rng() * 3),
                this.cx - this.facing * 8, this.cy, 0, 0, 1);
              if (g) {
                g.vx /= 2; g.vy /= 2;
                g.vy = Math.abs(g.vy);
                g.vx = -Math.abs(g.vx) * this.facing;
              }
            }
          }
          if (t >= 100 && this.rng() < 1 / 20) {                   // Next(20)==0
            this.frame = 0; s.frameT = 0;
          }
        } else if (this.frame !== 0) {
          this.frame = 0; s.frameT = 0;                            // :69745-69749 恢复支
        } else if (t >= 20) {
          this.frame = base - 1; s.frameT = 0;
          spawnEmote(this, 89, 90);                                // NewBubble(89,self,90)
        }
        break;
      }
      case 18: {
        // 酒馆老板扔麦酒演出帧（FindFrame ai[0]==18 :69856-69889）：反编译原文
        // 时间带（<10 帧0/<16 num60−1/else num60−2 再被 ai[1]<16→num60−1 /
        // <10→0 两道改写）全部被末行 `num78 = Main.npcFrameCount[type] − 2`
        // 无条件覆写 ⇒ 有效终值恒为【倒数第二行】，按字面直录（不"修复"编译器
        // 保留的死赋值链）
        const total18 = VANILLA_NPCS[String(this.vanillaId)]?.frames ?? 0;
        this.frame = Math.max(0, total18 - 2);
        break;
      }
      case 24: {
        // 树妖 Stardew 施法演出帧（FindFrame ai[0]==14||24 共带 :69943-69970）：
        // 每 6t 在 num60 / num60+1 间交替；ai[0]==24 特有：60t 冒 NewBubble(87,
        // self,60)、150t 冒 NewBubble(3, self, 90)。frameCounter 不清零——
        // ≥240 后末行 `frame.Y=0` 把行号钉死回空闲帧（演出后半段静立），气泡
        // 各恰一次（480t 态长由 s.t 承载）
        let f24 = t % 12 < 6 ? base : base + 1;
        if (t >= 240) f24 = 0;
        this.frame = f24;
        if (t === 60) spawnEmote(this, 87, 60);
        if (t === 150) spawnEmote(this, 3, 90);
        break;
      }
      case 20:
      case 21:
      case 22: {
        // ★对抗修复批③ F7 宠物表演帧带（FindFrame NPC.cs:69454-69689 的
        // ai[0]==20/21/22 分支逐行 1:1，velocity.Y==0 大门由 updateWalkFrame 腾空
        // 早退承接）。帧行号 = 绝对行（非 base 偏移）：num64 = frame.Y/帧高、
        // num65 = npcFrameCount。操作符与常量照录——史莱姆档阈值是 >=12，其余
        // 族均 >4；吸附窗（row 夹回带内）只在 ai[1]>30（22 态兔 >40）时生效，
        // 尾窗溢出走「落 0」端帧（演出收尾定格一拍再回站姿）。
        // 帧↔型的行带：20 {史莱姆 8-13 循环 / 兔 7-9 / 猫 10-16(尾冻13) /
        //   狗 23-27(尾冻24)}；21 {兔 10-16(冻13) / 猫 17-21(冻19) / 狗 17-22(冻18)}；
        // 22 {兔 17..20 摆动(cs:69647 `num64>20&&ai[1]>40 → num64=19`——越 20 回弹
        //   到 19,即演出后段在 19/20 两行间往复,非"冻结到 frames-1";
        //   ★对抗修复批⑤ A1 拨正,2026-09-01) / 猫 17-27 双尾态}。
        const sP = s;
        const cnt0 = sP.pc ?? 0;
        let cnt = cnt0;             // FindFrame frameCounter 影子（帧行循环计数）
        let row = this.frame;                     // num64
        if (sP.kind === 20) {
          if (SLIME_TOWN_IDS.has(this.vanillaId)) {
            if (sP.t > 30 && (row < 8 || row > 13)) row = 8;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt >= 12) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 13 && sP.t > 30) row = 8;
              if (row > 13) row = 0;
            }
          }
          if (this.vanillaId === 656) {
            if (sP.t > 30 && (row < 7 || row > 9)) row = 7;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 8 && sP.t > 30) row = 8;
              if (row > 9) row = 0;
            }
          }
          if (this.vanillaId === 637) {
            if (sP.t > 30 && (row < 10 || row > 16)) row = 10;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 13 && sP.t > 30) row = 13;
              if (row > 16) row = 0;
            }
          }
          if (this.vanillaId === 638) {
            if (sP.t > 30 && (row < 23 || row > 27)) row = 23;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 26 && sP.t > 30) row = 24;
              if (row > 27) row = 0;
            }
          }
        } else if (sP.kind === 21) {
          if (this.vanillaId === 656) {
            if (sP.t > 30 && (row < 10 || row > 16)) row = 10;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 13 && sP.t > 30) row = 13;
              if (row > 16) row = 0;
            }
          }
          if (this.vanillaId === 637) {
            if (sP.t > 30 && (row < 17 || row > 21)) row = 17;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 19 && sP.t > 30) row = 19;
              if (row > 21) row = 0;
            }
          }
          if (this.vanillaId === 638) {
            if (sP.t > 30 && (row < 17 || row > 22)) row = 17;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 21 && sP.t > 30) row = 18;
              if (row > 22) row = 0;
            }
          }
        } else {
          if (this.vanillaId === 656) {
            const nf = VANILLA_NPCS[String(this.vanillaId)]?.frames ?? 1;   // num65
            if (sP.t > 40 && (row < 17 || row >= nf)) row = 17;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              // ★对抗修复批⑤ A1（cs:69647-50）：门值 20 非旧码的 19——越 20 回弹
              //   到 19 形成 17..20 摆动带（旧 `row>19→19` 使 19/20 两行永不可达
              //   后半,兔表演尾段提前一拍折返）
              if (row > 20 && sP.t > 40) row = 19;
              if (row >= nf) row = 0;
            }
          }
          if (this.vanillaId === 637) {
            if (sP.t > 30 && (row < 17 || row > 27)) row = 17;
            if (row > 0) cnt++;                    // row>0 才累计（原版同式）
            if (cnt > 4) {
              cnt = 0;              // 越阈清零（原版 frameCounter=0）
              row++;
              if (row > 27) row = sP.t <= 30 ? 20 : 22;      // (!(t<=30))?22:20 字面序
              else if (sP.t <= 30 && row === 22) row = 0;
              else if (sP.t > 30 && row > 19 && row < 22) row = 22;
            }
          }
        }
        sP.pc = cnt;              // 写回影子计数器（全带共享 frameCounter 语义）

        this.frame = row;
        break;
      }
      case 16:
      case 17: {
        // 石头剪刀布（:69960-70152）：双方同帧线（甩手交替）；发起者在
        // frameCounter∈{40,100,160} 掷表情 45/45/75（:69998/:70014/:70041）
        let f = 0;
        if (t < 10) f = 0;
        else if (t < 16) f = base - 5;
        else if (t < 22) f = base - 4;
        else if (t < 28) f = base - 5;
        else if (t < 34) f = base - 4;
        else if (t < 40) f = base - 5;
        else if (t < 70) f = base - 4;
        else if (t < 76) f = base - 5;
        else if (t < 82) f = base - 4;
        else if (t < 88) f = base - 5;
        else if (t < 94) f = base - 4;
        else if (t < 100) f = base - 5;
        else if (t < 130) f = base - 4;
        else if (t < 136) f = base - 5;
        else if (t < 142) f = base - 4;
        else if (t < 148) f = base - 5;
        else if (t < 154) f = base - 4;
        else if (t < 160) f = base - 5;
        else if (t < 220) f = base - 4;
        else if (t < 226) f = base - 5;
        this.frame = f;
        if (s.kind === 16 && (t === 40 || t === 100 || t === 160)) {
          this.rpsThrow(t === 160 ? 75 : 45);
        }
        if (t >= 420) s.frameT = 0;
        break;
      }
    }
    this.frameT = 0;
  }

  /** PickNPCEmote（EmoteBubble.cs:295-1065 → world/EmotePick.ts 全量 1:1）。
   *  ★otherId：结对聊天传伙伴 vanillaId（ProbeExceptions 19↔22/107↔124 特判输入）；
   *  锚=发起者自身，伙伴锚泡（:3047）由 emotePickFor(s.other, self) 反转取语境 */
  private npcEmotePick(otherId?: number): number {
    return TownNPC.emotePickFor(this, otherId);
  }

  /** 舞蹈音符尘 ×8（:69665-69678）：dust 139-143 随机（NewDust 后逐字段覆写） */
  private danceDust(game?: GameHooks): void {
    const vd = game?.vanillaDust;
    if (!vd) return;
    const px = this.cx + 10 * this.facing;
    const py = this.cy - 4;
    for (let i = 0; i < 8; i++) {
      const type = 139 + Math.floor(this.rng() * 4);   // Next(139,143)
      const d = vd.spawn(px, py, 0, 0, type,
        this.vx + this.facing, this.vy - 2.5, 0, null, 1.2);
      if (!d) continue;
      d.vx += this.facing * 1.5;
      d.x -= 4;
      d.y -= 4;
      d.vx *= 2;
      d.vy *= 2;
      d.scale = 0.7 + this.rng() * 0.3;
    }
  }

  /** RPS 掷骰+镜像配对表情（:70030-70140 1:1）：发起者帧段驱动。num97/98 =
   *  我方 localAI[2]/[3]，num99/100 = 对方 [3]/[2]；掷 rand(2)（0=对方 +[3]、
   *  1=对方 +[2]），重掷门（对方对应分 ≥ 我方对应分）无效；无效且剩余 round
   *  尽（num103<=num101）→ 2（平分收尾）。表情 num106 = SelectRandom(38,37,36)，
   *  pick 0（对方得分）→ 我方出击败图标（38→37→36→38 环）、pick 1 → 被败环；
   *  末轮双方任一分 ≥2 → −3（胜负表情族 33-35） */
  private rpsThrow(bubbleTime: number): void {
    const s = this.social!;
    const b = s.other;
    if (!b || !b.social) return;
    const rnd = this.rng;
    const myA = s.rpsA, myB = s.rpsB;               // num97/98
    let opB = b.social.rpsB, opA = b.social.rpsA;   // num99/100
    const spare = 3 - myA - myB;                    // num101
    const round = s.frameT === 40 ? 1 : s.frameT === 100 ? 2 : 3;   // num102
    const roundsLeft = 3 - round;                   // num103
    let pick = -1;
    let tries = 0;
    while (pick < 0) {
      tries++;
      if (tries >= 100) break;
      pick = Math.floor(rnd() * 2);
      if (pick === 0 && opA >= myB) pick = -1;      // :70050
      if (pick === 1 && opB >= myA) pick = -1;      // :70053
      if (pick === -1 && roundsLeft <= spare) pick = 2;   // :70056
    }
    if (pick === 0) { b.social.rpsB++; opB++; }     // :70061
    if (pick === 1) { b.social.rpsA++; opA++; }     // :70064
    let mine = [38, 37, 36][Math.floor(rnd() * 3)]; // SelectRandom（:70067）
    let theirs = mine;
    if (pick === 0) {
      theirs = mine === 38 ? 37 : mine === 37 ? 36 : 38;   // 击败环（:70071-70085）
    } else if (pick === 1) {
      theirs = mine === 38 ? 36 : mine === 37 ? 38 : 37;   // 被败环（:70087-70101）
    }
    if (roundsLeft === 0) {                         // 末轮胜负脸（:70105-70115）
      if (opB >= 2) mine -= 3;
      if (opA >= 2) theirs -= 3;
    }
    spawnEmote(this, mine, bubbleTime);
    spawnEmote(b, theirs, bubbleTime);
  }

  /** 攻击态帧（FindFrame NPC.cs:69765-69847）：
   *  - 近战 10：态内计数（frameCounter，入态清零 :54756）四档 0→num58→+1→+2→+3，
   *    档距 num79=6（633 狼人 0/2），windup num78=10（633:0）（:69765-69786）
   *  - 挥击 15：按 ai[1]/AttackTime 比例四档 >0.65/0.5/0.35/0（:69787-69802）
   *  - 弓 12：num58+GetShootingFrame(ai[2])（:69827，表 :67061）
   *  - 魔法 14：12t 周期 6t 档交替 num58/num58+1（:69943-69955 `%12*2<12`） */
  private attackFrame(base: number): void {
    if (this.atkState === 10) {
      const windup = this.vanillaId === 633 ? 0 : 10;   // num78
      const step = this.vanillaId === 633 ? 2 : 6;      // num79
      const c = this.atkTick;
      this.frame = c < windup ? 0
        : c < windup + step ? base
          : c < windup + step * 2 ? base + 1
            : c < windup + step * 3 ? base + 2
              : c < windup + step * 4 ? base + 3 : 0;
    } else if (this.atkState === 15) {
      const t = TOWN_ATTACK_TIME[this.vanillaId] ?? 15;
      const r = this.atkTimer / t;                      // num82 = ai[1]/AttackTime
      this.frame = r > 0.65 ? base : r > 0.5 ? base + 1 : r > 0.35 ? base + 2 : r > 0 ? base + 3 : 0;
    } else if (this.atkState === 12) {
      this.frame = base + shootingFrameOffset(this.vanillaId, this.holdAim);
    } else {
      // ★对抗修复批①2026-09-01：施法翻帧行走样拨正——原版 FindFrame ai[0]==14||24
      // 分支 `(frameCounter % 12 * 2 < 12)`（NPC.cs:69953-69954）= 12t 周期/档宽 6t
      //（%24<12 是 24t 周期,曾被写成同义）
      this.frame = this.atkTick % 12 < 6 ? base : base + 1;
    }
    this.frameT = 0;
  }

  /** AI_007 ai[0]==25 微光上升态（★1457 锚行校准：块 :53737-53820）1:1，返回 true = 态中。
   *  时间线：ai[1]==0 落点传送（:53752-55 → Shimmer_TeleportToLandingSpot :56130-49，
   *  位移 ≥560px(:56138) 则 ai[2]=30(:56141) 暂停 + 发送粒子）→ ai[2] 倒计时毕置
   *  ai[1]=1（:53747-50）→ 此后每 tick ai[1]+1（:53764）→ ≥30 起非浸液 st−1/60、
   *  浸液钳 30 等待（:53765-75）+ velocity=(0,−4×st)（:53776）→ ai[1]≥75 且 st≤0
   *  收尾（:53801-3820）：变体翻转（双向）+ 原地 Teleport(12)（TeleportEffect 无
   *  style 12 分支 = 纯重锚无视觉，Main.cs:13169-13414）+ ShimmerTownNPC 到场粒子 + 成就 43 */
  private shimmerRiseUpdate(
    world: import('../world/World').World, game: GameHooks, wet: boolean,
  ): boolean {
    if (this.shimmerRiseT === 0) this.vx = 0;                     // :53597-53599
    if (this.shimmerRiseT === 0 && this.shimmerRisePause < 1) {
      this.shimmerLandAt(world.store, game);                      // :53752-55/:56130
    }
    if (this.shimmerRisePause > 0) {                              // :53612-53618
      this.shimmerRisePause--;
      if (this.shimmerRisePause <= 0) this.shimmerRiseT = 1;
      return true;
    }
    this.shimmerRiseT++;                                          // :53764
    if (this.shimmerRiseT >= SHIMMER_RISE_VELOCITY_TICK) {        // :53765
      if (!wet) {
        // WetCollision 近似 = 中心格任意液体（:53622-53626）
        this.shimmerTransparency = shimmerTransparencyNext(this.shimmerTransparency, false, false, true);
      } else {
        this.shimmerRiseT = SHIMMER_RISE_VELOCITY_TICK;           // :53772-75 浸液等待
      }
      this.vx = 0;
      this.vy = -4 * this.shimmerTransparency;                    // :53776
    }
    // 上升演出（:53634-53649）——dust 309 / ShimmerBlock 的 Remap 门在 ai[1]<30
    // 时钳到恒假，与原版同 tick 生效（光走 lightRGB 的 shimmerRise 分支）
    const num5 = Math.random() * 2 - 1;                           // NextFloatDirection
    if (Math.random() > remapClamped(this.shimmerRiseT, 30, 60, 1, 0.5)) {
      // dust 309（:53640-53646）：下半身盒（Y+20/H−20）内随机点 + 圆偏(8,0)+(0,4)，
      // velocity=(0,−2).RotatedBy(num5×2π×0.11)、scale 1.7−|num5|×1.3（size 档
      // spawnBurst 无参不建模）
      game.spawnBurst?.(
        this.x + Math.random() * this.w + (Math.random() * 2 - 1) * 8,
        this.y + 20 + Math.random() * (this.h - 20) + 4,
        '#BFE8FF', 1, 2, -Math.PI / 2 + num5 * Math.PI * 2 * 0.11, 0,
        { life: 30, grav: -0.04 },
      );
    }
    if (this.shimmerRiseT > 60 && Math.floor(Math.random() * 15) === 0) {
      // ShimmerBlock ×3（:53642-53649 → Spawn_ShimmerBlock :1791-1811）：星尘带
      // MovementVector = DirectionTo(v).RotatedBy(9π/20×±1)×rand 减速漂散——
      // 无粒子编排器，随机向小速度近似
      for (let i = 0; i < 3; i++) {
        game.spawnBurst?.(
          this.x + Math.random() * this.w, this.y + Math.random() * this.h,
          '#C9C2FF', 1, 0.8, Math.random() * Math.PI * 2, Math.PI, { life: 45, damp: 0.98 },
        );
      }
    }
    // TargetClosest（:53799）：面向最近玩家
    const tp = (game as unknown as { player?: { x: number; y: number; w: number; h: number; dead: boolean } }).player;
    if (tp && !tp.dead) this.facing = tp.x + tp.w / 2 < this.cx ? -1 : 1;
    if (this.shimmerRiseT >= SHIMMER_RISE_END_TICK && this.shimmerTransparency <= 0) {
      this.shimmerRise = false;                                   // ai[0]=0（:53803-06）
      this.shimmerRiseT = 0;
      this.shimmerRisePause = 0;
      this.vx = 0; this.vy = -4;                                  // :53808
      // ★BJ704-G19（G3 备案②「松鼠黑化 lai2=0」复核翻案落地,2026-10-21）：原版
      //   转族拍整段清 ai[0..3]+localAI[0..3]（NPC.cs:53800-53815,localAI[2]=0 在
      //   :53811）。G6 备案时判「lai2 转族后无消费面」——D13（卡墙折返 :54789
      //   localAI[2]++≥30）同批落地后 stuckT 有了消费面,且本块即写位宿主（备案
      //   把宿主误记在 Enemy 域:ai[0]==25 微光上升态属 ShimmerTownTransform 集
      //   =城镇 NPC 专属,Enemy 侧 42 型 critter 结构性不可达）。落地传送
      //   （:53816 Teleport(12)）后卡墙计数若带旧值=新落点折返提前触发——补
      //   :53811 单笔（stuckT 即 localAI[2] 承载位,「无衰减清零」语义不变）。
      this.stuckT = 0;                                            // :53811 localAI[2]=0（转族拍）
      this.shimmered = !this.shimmered;                           // :53814 变体翻转（双向）
      // ShimmerTownNPC 到场粒子（:53817 BroadcastParticleSpawn(ShimmerTownNPC) →
      // Spawn_ShimmerTownNPC :1696-1752）：
      // 40 PrettySparkle（hsl(rand,1,0.5)+白，30×60 盒上升）+ 20 dust 308 四色
      // （#FFFFD2/#BEF5FF/#FF96FF/#BEAFFF = 1:1:1:3，vy−8）+ SoundID.Item29
      //（= Item bank cue 29，Sfx 键 manaCrystal → sounds/Item_29.wav；曾因登记
      //  "素材缺"走 shimmerSplash 近似——素材实测在库，已换真声）
      game.spawnParticles(this.cx, this.cy, '#BEAFFF', 12, 3.2, { life: 34, grav: -0.12 });
      game.spawnParticles(this.cx, this.cy, '#BEF5FF', 4, 3.2, { life: 34, grav: -0.12 });
      game.spawnParticles(this.cx, this.cy, '#FF96FF', 4, 3.2, { life: 34, grav: -0.12 });
      game.playSfx('manaCrystal', 1, this.cx, this.cy);
      // module8 广播（NPC.cs:53816-19 Teleport(12)+Broadcast：本地视觉上方已生）：
      // 本地视觉上方三行已生,此处只发服务器中继——他端经 Spawn_ShimmerTownNPC 同款爆发
      game.broadcastParticleOrchestra?.(ParticleOrchestraType.ShimmerTownNPC, this.cx, this.cy);
      if (this.shimmered) game.achievements?.notifyProgressionEvent(43);   // :53822-24
    }
    return true;
  }

  /** AI_007_TownEntities_Shimmer_TeleportToLandingSpot（★1457 锚行校准：调用位
   *  :53752-55 → 本体 :56130-49 + ScanForBestSpotToLandOn :56151 起）：以自身顶格
   *  扫无微光落点（home 锚兜底），传送过去；位移 ≥560px(:56138) → ai[2]=30(:56141)
   *  暂停 + ShimmerTownNPCSend 粒子（PositionInWorld=vector2+Size/2 :56144）。
   *  复用 stats/Shimmer.findShimmerFreeSpot（玩家脱困版同谓词）：环扫为原版 8 点环
   *  超集、r 并到 59、平台落点恒允许（原版仅 homeless 无 home 时 allowSolidTop）
   *  ——行为相容近似 */
  private shimmerLandAt(st: TileStore, game: GameHooks): void {
    const spot = findShimmerFreeSpot(
      st, Math.floor(this.x / TILE), Math.floor(this.y / TILE),   // Top.ToTileCoordinates
      this.home?.x, this.home?.y,
    );
    if (!spot) return;
    const nx = spot.x * TILE - this.w / 2, ny = spot.y * TILE - this.h;   // ShimmerHelper.cs:9
    const dist = Math.hypot(nx - this.x, ny - this.y);
    const oldX = this.x, oldY = this.y;
    const oldCx = oldX + this.w / 2, oldCy = oldY + this.h / 2;   // 传送前中心（:56144 vector2+Size/2）
    this.x = nx;
    this.y = ny;
    if (dist >= SHIMMER_RISE_TELEPORT_DIST) {
      this.shimmerRisePause = SHIMMER_RISE_PAUSE;                 // :56141
      game.spawnParticles(this.cx, this.cy, '#BEAFFF', 14, 1.2, { life: 30, grav: -0.05 });
      game.spawnParticles(this.cx, this.cy, '#BEF5FF', 10, 1.2, { life: 30, grav: -0.05 });
      // module8 广播（NPC.cs:56143 ShimmerTownNPCSend：旧中心位 + 位移向量
      //（= 新旧左上差,与新旧中心差同值））
      game.broadcastParticleOrchestra?.(
        ParticleOrchestraType.ShimmerTownNPCSend, oldCx, oldCy, nx - oldX, ny - oldY);
    }
  }

  /** 环境与互殴受击(UpdateEnemy :91592-91603;★C1 定案：本块在 Update 层与 AI()
   *  正交——ai[0]==25 微光上升帧同样运行,早退分支现于 fixedUpdate 内显式调用本
   *  方法承接。原版双调用位：三连 :91592-91600 挂 `type!=37 && (friendly||
   *  TakesDamageFromHostilesWithoutBeingFriendly)`；蜂二次调用 ：91601-03 无该门,
   *  见下 ④）：
   *  ① 岩浆已移交 npcLiquid.updateNpcLiquid（30t 冷却+50 直伤同语义）
   *  ② 溺水(CheckDrowning :96056-96088):几何判头浸 = Collision.DrownCollision
   *    （Collision.cs:1385-1430,gravDir=1）★F4 定案换真探针几何（drownCollision
   *    本文件）、【无 wet 锁存】——水内每 7t breath--;breath≤0 后每 7t
   *    life-=2 直写(:96073,dontTakeDamage 管不着)+friendlyRegen 清零(:96069);
   *    归零一击 StrikeNPCNoInteraction(2)(:96077-81,owner=255 链不查
   *    dontTakeDamage/immune → 微光中同样可致死,hurt 的 force 通道承接);
   *    离水 breath+3/t cap 200
   *  ③ 敌怪互殴第一遍 GetHurtByOtherNPCs(AllNPCs)（:91599）：头部 dontTakeDamage
   *    早退(:93557-60) → 微光上升态停算;攻击者准入门 = acceptable 集 + !friendly +
   *    damage>0 + !CritterThatCanTurnOnPlayers（★F3① 十型表）;命中盒 =
   *    GetMeleeCollisionData 变形面（★F3② 加宽族表 meleeAttackRect;
   *    damageMultiplier 为死参不接）;接触命中 → StrikeNPC(DamageVar(attacker.damage),
   *    6,方向),immune[255]=30;后置两枝：dryadWard 荆棘反伤(⌊实伤/3⌋,1456 :93654-65
   *    = 1457 :93604-11,反伤 :93609)+ HurtingBees 蜂反蜇(1456 :93666-77 = 1457
   *    :93612-20)（红蓝-D 2026-09-18 锚勘误——原 :93599/:93559-63/:93666-81/:93682-96
   *    均混版陈旧）
   *  ④ ★F1③ HurtingBees 第二遍（:91601-03）：门 = CanBeHurtByBees[type]（默认全
   *    类型真,翻转集 210/211/222）+ 场上存在蜂——【老人 37 也受理】伤害面放开;
   *    同 tick 若首遍已建 immune[255]=30 则早退(:93563-66)
   *  Enemy.def.damage 已含难度缩放(ScaleStats);首击掷骰走 stats/DamageVar 单源
   *  （★F2,this.rng 注入,luck=0 单掷）。 */
  /** 城镇 NPC 被动回血（CheckLifeRegen NPC.cs:93622-93641，★F10 移植）——
   *  受伤期每 tick 累加 friendlyRegen += 回血率[1 + dryadWard?10 + {22:+5|209:+9}]，
   *  >180 → 清零并 life+1；不设难度倍率、无 CombatText、无音效。困难态唯一不变式 =
   *  与原版同为线性计数制。调用面与原版同块（:91596-91599 CheckDrowning +
   *  CheckLifeRegen + GetHurtByOtherNPCs 三连），由 envHurtUpdate 承接，type 37
   *  整块豁免同门；★C1：微光上升帧无任何 ai 门照常累计（F10 面语义不变）。 */
  private lifeRegenUpdate(): void {
    if (this.dead || this.hp >= this.maxHp) return;         // :93624 life < lifeMax 门
    let rate = 1;                                           // num = 1 基础
    if (this.dryadWardT > 0) rate += 10;                    // dryadWard 加速枝(:93627-93629)
    if (this.vanillaId === 22) rate += 5;                   // 向导(:93631-93633)
    else if (this.vanillaId === 209) rate += 9;             // 电子人(:93635-93637)
    this.lifeRegenCounter += rate;
    if (this.lifeRegenCounter > 180) {
      this.lifeRegenCounter = 0;
      this.hp++;                                            // NetUpdateLowPriority 面(单机即 hp++)
    }
  }

  private envHurtUpdate(world: import('../world/World').World, game: GameHooks): void {
    if (this.dead) return;
    const st = world.store;
    if (this.npcVsCd > 0) this.npcVsCd--;
    if (this.dryadWardT > 0) this.dryadWardT--;    // buffTime 165 逐 tick 衰减
    // 整块豁免门（:91593 字面 `type != 37 && friendly…`——老人(37)不在三连受理面,
    // ★C1 上提覆盖面：豁免从「仅回血」扩为整段三连,与原版同门）
    if (this.vanillaId !== 37) {
      // ② 溺水(CheckDrowning :96056-96088)：DrownCollision 几何判定（:96058 字面
      // `DrownCollision(position,width,height,1f)`，gravDir=1 非 includeSlopes）
      // ★F4 定案 = 真 10×12 头部探针族 + 降面水位 + 首行实心排除，且【去 wet
      // 锁存】——传送落水首拍即计（原文本不查 wet;带 wet 外伞的是 idle 起身支）
      const submerged = drownCollision(st, this.x, this.y, this.w, this.h, 1);
      if (submerged) {
        if (++this.breathCounter >= 7) {
          this.breathCounter = 0;
          this.breath--;
          if (this.breath <= 0) {
            this.breath = 0;
            this.lifeRegenCounter = 0;   // :96069 溺水伤害 tick 清零 friendlyRegen（★F10/
                                         // ★C1:ai25 帧同样走此表）
            this.hp -= 2; // life-=2 直伤(不过防御,原版 :96073 静默扣——ai25 帧同样生效,
                          // dontTakeDamage 只挡外部攻击链不挡直写)
            if (this.hp <= 0) { this.hp = 1; this.hurt(2, 0, 0, game, 0, 0, false, true); } // :96077-81 致死一击
            else game.addDamageNumber(this.cx, this.y, 2, false, '#FFD060');   // [本仓视觉添加]原版 CheckDrowning 无飘字(NPC.cs:96118-96154 静默 life-=2),观感保留标注
          }
        }
      } else {
        this.breath = Math.min(200, this.breath + 3);
        this.breathCounter = 0;
      }
      // ②' 城镇被动回血 CheckLifeRegen（:91598 与 CheckDrowning 同块依序,
      //    位于互殴段之前）★F10/★C1(ai25 帧照常累计)
      this.lifeRegenUpdate();
      // ③ 敌怪互殴第一遍 GetHurtByOtherNPCs(AllNPCs)（:91599）——beHurtByOtherNpc
      //    全段（含 dryadWard 荆棘 + HurtingBees 蜂反蜇两后置枝,1456 :93654-93677 =
      //    1457 :93604-93620;红蓝-D 2026-09-18 锚勘误）。
      //    ★C1：头部早退门 (:93557-60 `dontTakeDamage||immortal||…`)——微光上升态
      //    (ai[0]==25 → this.hurt 的 dontTakeDamage 承接位)互殴停算。
      if (!this.shimmerRise && this.npcVsCd <= 0) this.enemyMeleeScan(game, null);
    }
    // ★F1③ HurtingBees 第二遍（:91601-03 字面）：无 type37/friendly 门——门 =
    //   CanBeHurtByBees[type]（NPCID.cs Factory.CreateBoolSet(true,210,211,222)
    //   翻转集 → 默认全类型为真、仅蜂/蜂后假——【老人 37 也真】）+ 场上存在蜂
    //   (210/211)(npcsFoundForCheckActive 探测,性能面)。→ 老人(37)不入三连但
    //   被蜂接触伤害面【照常放开】。
    //   两遍 immune 序：首遍命中即置 immune[255]=30(npcVsCd) → 此处同 tick 早退
    //   (:93563-66)，蜂近场判定与原版 npcsFoundForCheckActive 同为性能短路。
    const beesNear = (game.enemies() as Array<{ dead?: boolean; vanillaId?: number }>)
      .some((e) => !e.dead && (e.vanillaId === 210 || e.vanillaId === 211));
    if (beesNear && !this.shimmerRise && this.npcVsCd <= 0) {
      this.enemyMeleeScan(game, HURTING_BEES);
    }
  }

  /** GetHurtByOtherNPCs 循环体（:93555-93585）。acceptable=null = AllNPCs 全集；
   *  否则仅 HurtingBees 集。命中一个攻击者即 return——与原版 break 同构 */
  private enemyMeleeScan(
    game: GameHooks, acceptable: ReadonlySet<number> | null,
  ): void {
    for (const ent of game.enemies()) {
      const e = ent as unknown as MeleeAttackerLike & import('./Enemy').Enemy;
      if (e.dead) continue;
      const id = e.vanillaId ?? -1;
      if (acceptable !== null && !acceptable.has(id)) continue;   // acceptableNPCIDs[type]
      if (CRITTERS_TURN_ON_PLAYERS.has(id)) continue;             // :93573 准入门②(十型)
      const dmg = e.damage ?? e.def?.damage ?? 0;
      if (dmg <= 0) continue;                                     // nPC.damage > 0(:93575)
      // 命中几何 = GetMeleeCollisionData 变形后的攻击者盒(:96111)；后置特判链 :93579-80
      const rect = meleeAttackRect(e, this.x, this.y, this.w, this.h);
      if (!rect) continue;                                        // type400 npcRect=default 恒不交
      if (!(this.x < rect.x + rect.w && this.x + this.w > rect.x
        && this.y < rect.y + rect.h && this.y + this.h > rect.y)) continue;
      // (:93579 `(type != 453 || !Skeletons[nPC.type])`——self∈Skeletons 型才受限,
      // 骷髅商人 453 有城镇载体故字面保留 Skeletons 表；624/690 直判)
      if ((this.vanillaId !== 453 || !SKELETON_IDS.has(id)) && id !== 624 && id !== 690) {
        this.beHurtByOtherNpc(e, game, dmg);
      }
      return;
    }
  }

  /** BeHurtByOtherNPC（:93588-93620）：immune[255]=num(30/695·696 面 20)、首击 =
   *  Main.DamageVar(thatNPC.damage)（★F2：stats/DamageVar 单源、注入 this.rng——
   *  luck=0 单掷不涉重掷位）;dryadWard 反伤 ⌊实伤/3⌋ 与 HurtingBees 反蜇
   *  （蜂受击=受方 damage 直接取值【不再掷骰】——原文本面 num2=damage）两后置枝 */
  private beHurtByOtherNpc(
    e: MeleeAttackerLike & import('./Enemy').Enemy, game: GameHooks, rawDmg: number,
  ): void {
    const dir = e.x + e.w / 2 > this.cx ? -1 : 1;   // :93613 攻击者在右 → 向左击退
    this.npcVsCd = 30;                              // :93616 immune[255]=30
    const hpBefore = this.hp;
    // :93595 num2 = Main.DamageVar(thatNPC.damage)
    const rolled = damageVarRoll(rawDmg, 0, this.rng);
    this.hurt(rolled, dir * 6, 0, game);            // StrikeNPCNoInteraction(num2,6,num4)
    // 实伤 num5 = StrikeNPCNoInteraction 返回值（hp 差值等价，致死钳到扣血额）
    const dealt = Math.max(0, hpBefore - Math.max(0, this.hp));
    // 干掉攻击者引用（荆棘/反蜇两枝共享）
    const strikeBack = (amount: number): void => {
      const foe = e as unknown as import('./Enemy').Enemy;
      if (typeof foe.hurt !== 'function') return;
      foe.hurt(amount, -dir * 6, 0, game, 0, false, 1);     // StrikeNPCNoInteraction
    };
    // :93618-23 dryadWard 荆棘：反伤 ⌊dealt/3⌋（kb6 反向，攻击者同 30t 冷却）
    if (this.dryadWardT > 0 && dealt > 0) {
      strikeBack(Math.trunc(dealt / 3));
    }
    // :93624-31 HurtingBees：蜂攻击者额外受【本体 damage】反蜇（atkParams 取档）
    if (e.vanillaId === 210 || e.vanillaId === 211) {
      const myDmg = this.atkParams(TOWN_ATTACK_TYPE[this.vanillaId] as 0 | 1 | 2 | 3)?.dmg ?? 0;
      strikeBack(myDmg);
    }
  }

  /** 危险扫描 + 双窗收口伞（NPC.cs:54014-54156）1:1（单机 netMode!=1；★F4 重构定谳）：
   *  原版是【双窗】结构：
   *  - num11 = DangerDetectRange（默认 200；表 TOWN_DANGER_RANGE,:54006-54009）＝
   *    真实威胁窗：flag16 置位、num13/14/15/16/17 全部簿记、PrettySafe 收口、逃离
   *    覆写、攻击触发 flag31 都只见它；
   *  - num12 只作扫描【准入】（:54033 `Distance < num12` → 仅置 flag15 :54037）；
   *    对话+挥击族（AttackType==3）把准入窗扩到 ≥250（:54036-54038）；随后
   *    :54040-54041 `if (Distance >= num11) continue` 在任何 flag16/簿记之前截断。
   *    flag15 唯一消费点 = 对话朝向门 :54177；
   *  - 敌门（continue 链,CritterThatCanTurnOnPlayers/friendly/damage<=0/LOS
   *    CanHit(Center,0,0,…Center) 点对 :54030），左右各留 |dx| 最近者
   *    （num13 左最大负 / num14 右最小正,:54052-54068），候选 num16/17 记录在最近值
   *    刷新时且过 CanBeChasedBy（:54054-54057 flag19 字面嵌套,不过门保留旧候选——
   *    治理批 B1① 形状不变,仅改锚行号）；
   *  - ★C2：本方法即 num13..num17 候选池的唯一产出位（this.threatPool 快照）——
   *    入态选靶/态内发射瞄准直读快照,不再独立重扫（原版 :56016-56105/:55105-12
   *    同为池直读;红 β 三轮「同拍死亡影响重扫」议题由此结构性消解）；
   *  - ★C3②：flag17（dangerStinky）= 候选中出现 stinky 源——敌怪支(:54045-47,
   *    零伤敌唯臭味可入扫描)与玩家第二扫(:54080-96,stinky 玩家视为威胁并录
   *    num16/17);消费点只有 flag31 的 `!flag17`(:55769)。614 鳄鱼特判(:54066-75)
   *    本仓无该型入口 → 缺席即正确（存档见清零收敛批报告）;
   *  - PrettySafe 收口【不是】无条件段：整支挂在 `if (flag16 && !flag5)` 总伞内
   *    （:54102），ai[0]==8 有独立臂(:54107-54115 解冻)、`else if (ai[0]!=10..15)`
   *    支才含收口(:54120-22)/逃离布线(:54124+)——即对话中不收口、被逼停不收口、
   *    攻击态(10/12/13/14/15)不收口。★蓝队 F4②：旧实现无条件收口,使"对话×险/
   *    被逼停×超距"两面误进 flag31 假阴性,已按伞形重构。本仓序位与原版一致：
   *    此处读到的 talking/corneredT/atkState/healing 即"伞时刻的 ai[0]"。 */
  private dangerUpdate(world: import('../world/World').World, game: GameHooks): void {
    this.dangerNear = false;
    this.admitWide = false;
    this.dangerSide = 0;
    this.threatRaw = false;                           // flag16 原始位（逐拍重扫）
    this.dangerStinky = false;                        // flag17（逐拍重置,:55769 消费）
    const pool: ThreatPoolSnapshot = { left: null, right: null };
    const num11 = TOWN_DANGER_RANGE[this.vanillaId] ?? 200;
    let num12 = num11;                                // 准入窗(:54010)
    if (this.talking && TOWN_ATTACK_TYPE[this.vanillaId] === 3 && num12 < 250) {
      num12 = 250;                                    // 对话挥击族扩窗(:54036-54038)
    }
    let bestL = -1, bestR = -1;                       // num13/num14
    let scanHit = false;                              // flag16 原始位（:54043 候选点）
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean;
        damage?: number; def?: { damage?: number }; stinkyT?: number };
      if (e.dead) continue;
      const edmg = e.damage ?? e.def?.damage ?? 0;
      // 准入续链（:54031-33 字面子句 `((friendly||damage<=0) && !stinky)`）：零伤体
      // 只有带 stinky(120) 才入扫描——恶臭源的敌怪对城镇 NPC 计为威胁（C3②）
      const estinky = (e.stinkyT ?? 0) > 0;
      if (edmg <= 0 && !estinky) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      const dx = ecx - this.cx;
      const dist = Math.hypot(dx, ecy - this.cy);
      if (!(dist < num12)) continue;                  // 准入门（:54033 Distance < num12）
      // ★对齐批③：扫描 LOS 门 = Center 点对（原版字面 CanHit(base.Center,0,0,
      // Main.npc[m].Center,0,0)，NPC.cs:54030；端点 tile 与 rect 版同构、形状保真）
      if (!canHitPoint(world.store, this.cx, this.cy, ecx, ecy)) continue;
      this.admitWide = true;                          // flag15 置位（:54037）
      if (dist >= num11) continue;                    // ★窄窗截断（:54040-54041）——
                                                      // flag15 与威胁簿记在此分立
      scanHit = true;                                 // flag16 = true（:54043 候选点）
      if (estinky) this.dangerStinky = true;          // flag17 置位（:54045-47）
      // ★F5 留档：dx==0（敌怪 Center.X 与本体中心精确同列）两侧都不簿记——原版
      // 判定链是 `num18 < 0f → num13` / `num18 > 0f → num14`（:54052-54068），
      // 零值两边皆不写。本仓以 else 兜底把 dx==0 归入右侧候选（保持入池受理面）。
      // 选侧差异只在「存在严格左侧威胁 × 其余右侧皆空」时显形：原版 num14 恒
      // −1 → `(num14!=-1f)?…:(-1)` 取 −1 向西；本仓 bestR==0 参与近距比较取向东。
      // 唯一中心敌场景两侧结果同为向右（num13==-1 → 1），无差。登记性偏离,
      // 改 else-if 前须同步复核 threatPool 受理面。
      if (dx < 0) {
        if (bestL === -1 || dx > bestL) {
          bestL = dx;
          // ★B1①（:54054-54056 flag19）：候选记录在最近值刷新时发生——过 CanBeChasedBy
          // 才写 num16/17；不过门时保留上一合格候选（原版嵌套 `if(flag19)` 字面）。
          if (canBeChasedBy(e)) {
            pool.left = { x: e.x, y: e.y, w: e.w, h: e.h, cx: ecx, cy: ecy };
          }
        }
      } else {
        if (bestR === -1 || dx < bestR) {
          bestR = dx;
          if (canBeChasedBy(e)) {                  // 同上：num14 刷不刷与 flag19 无关
            pool.right = { x: e.x, y: e.y, w: e.w, h: e.h, cx: ecx, cy: ecy };
          }
        }
      }
    }
    // ---- stinky 玩家第二扫（★C3②落地，NPC.cs:54080-96；本仓无 614 鳄鱼载体，
    //      :54066-54075 特判缺席即正确——见文件头清零收敛批注）。仅当敌人第一扫
    //      零命中且非对话时执行；玩家槽不需要 CanBeChasedBy 门（原版直写
    //      num16/17）；stinky 载体 = player.buffs.has(BuffType.Stinky)（buff 120,
    //      臭味药水 2353/弹 371/PoopProj 授予链）----
    if (!scanHit && !this.talking) {
      for (const ent of (game.candidatePlayers?.() ?? [game.player])) {
        const p = ent as unknown as { x?: number; y?: number; w?: number; h?: number;
          dead?: boolean; buffs?: { has(b: number): boolean } } | null | undefined;
        if (!p || p.dead) continue;
        if (!(p.buffs?.has(BuffType.Stinky))) continue;   // stinky=buff 120 运行时位
        // （原版尾段 `(p.stinky || type!=633/37/441/228/107/453)` 恒真——死条件，
        // 反编译原文如此；无免疫分支,臭味玩家对全城镇体一律生效）
        const px = p.x ?? 0, py = p.y ?? 0, pw = p.w ?? 0, ph = p.h ?? 0;
        if (Math.hypot(px + pw / 2 - this.cx, py + ph / 2 - this.cy) >= num11) continue;
        scanHit = true;                               // :54090-91 flag16+flag17 同置
        this.dangerStinky = true;
        const dx = px + pw / 2 - this.cx;
        const ref: ThreatRef = { x: px, y: py, w: pw, h: ph, cx: px + pw / 2, cy: py + ph / 2 };
        if (dx < 0) {                                 // 无 CanBeChasedBy 门（玩家槽直录
          if (bestL === -1 || dx > bestL) { bestL = dx; pool.left = ref; }   // num16/17)
        } else {
          if (bestR === -1 || dx < bestR) { bestR = dx; pool.right = ref; }
        }
      }
    }
    this.threatPool = pool;                           // ★C2 单点产出
    if (scanHit) this.threatRaw = true;               // flag16 = 扫描命中未收口(:54043)
    if (bestL === -1 && bestR === -1) return;         // 无窄窗威胁（flag16=false 或仅玩家）
    this.dangerSide = bestL === -1 ? 1 : (bestR !== -1 ? (bestR < -bestL ? 1 : -1) : -1);
    // —— num15 选侧（:54099-54100）：仅右→1 / 仅左→−1 / 两侧取近者侧（平局判左）；
    // vanilla 在对话里另有同式重算位（:55763-55764,num3×0.8 处）,值恒同,合算。
    let nearest = bestL !== -1 ? -bestL : 0;          // num20（:54101-54106）
    if (nearest === 0 || (bestR !== -1 && bestR < nearest && bestR > 0)) nearest = bestR;
    // ---- PrettySafe 收口伞（:54102 if(flag16&&!flag5)）：外层 !flag5 先断对话路；
    // ai[0]==8（cornered）有独立解冻臂不走此支(:54107)；else-if 排除攻击态列
    // {10,12,13,14,15}（:54118,healing=13 承接）。三类之外才有 :54120-54122 的
    // `PrettySafe != -1 && PrettySafe < num20 → flag16 = false`。----
    this.dangerNear = true;                           // 收口前终值 = 原始位
    const closureBlocked = this.talking || this.corneredT > 0 || this.atkState !== 0
      || this.healing;
    if (!closureBlocked) {
      const pretty = TOWN_PRETTY_SAFE[this.vanillaId];
      if (pretty !== undefined && pretty < nearest) {
        this.dangerNear = false;                      // :54121-54122 flag16 收口
      }
    }
  }

  /** 越障三档跳 + 净空失败转身/被逼停（NPC.cs:54514-54611）。返回 true = 已折返
   *  （调用方保住翻转后的 facing 不被 wantDir 回写）。
   *  ★对抗修复批⑤ A9 补两臂：啮齿两格墙折返（cs:54657-64 flag7,一档子支）与
   *  史莱姆侧带净空小跳（cs:54721-25 梯序末档）。
   *  tile 探针（:54499-54501）：num26 = 前方列（center+15×dir）、num27 = 脚部行
   *  （Bottom−16px）；tileSafely5/4/3 = num27−2/−1/num27 本行。净空检查
   *  SolidTilesVersatile（Collision.cs:3450，越界视为堵 :3468-3479）——isSolid
   *  已排除 solidTop 家具（≈ tileSolid && !tileSolidTop）。flag25 = 身高 <3 格
   *  （42px → true）：两格档需 t5&&t4 同实心（矮个头顶要能过） */
  private obstacleJump(
    world: import('../world/World').World, wantDir: number, avoidFalling = false,
  ): boolean {
    const st = world.store;
    const dir = wantDir;
    const ax = Math.floor((this.cx + 15 * dir) / TILE);          // num26（:54515）
    const fy = Math.floor((this.y + this.h - 16) / TILE);        // num27（:54516）
    const solidRange = (x1: number, x2: number, y1: number, y2: number): boolean => {
      // ★对抗修复批①2026-09-01：入口先归一区间（vanilla Collision.SolidTilesVersatile
      // 先 Utils.Swap 再扫,Collision.cs:3454-3460）——dir=-1 时实参 (ax+2, ax+1) 倒序,
      // 不交换则空扫恒返回「净空」→ 向左越障全失效
      if (x1 > x2) { const t = x1; x1 = x2; x2 = t; }
      if (x1 < 0 || x2 >= st.w || y1 < 0 || y2 >= st.h - 40) return true;
      for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) if (st.isSolid(x, y)) return true;
      return false;
    };
    const t5 = st.isSolid(ax, fy - 2), t4 = st.isSolid(ax, fy - 1), t3 = st.isSolid(ax, fy);
    const shortBody = this.h / 16 < 3;                  // flag25（:54502）
    let turn = false, freeze = false;
    if (t5 && (!shortBody || t4)) {
      // 两格上障碍：净空 = 身侧两列 num27−5..−1 + 障碍列 −5..−3（:54522-54526）
      if (!solidRange(ax - dir * 2, ax - dir, fy - 5, fy - 1)
        && !solidRange(ax, ax, fy - 5, fy - 3)) this.vy = -6;
      else if (TOWN_FLAG7_IDS.has(this.vanillaId)) {
        // ★对抗修复批⑤ A9 啮齿折返臂（cs:54657-64 flag7）：被 SolidTiles 卡死的
        //   两格高墙 + 身侧格实心 → direction*=−1 / velocity.X=0——不走 flag26 的
        //   −vx 反冲面（速度直接清零）
        const cxT = Math.floor(this.cx / TILE), cyT = Math.floor(this.cy / TILE);
        if (st.inBounds(cxT + dir, cyT) && st.isSolid(cxT + dir, cyT)) {
          this.facing = -dir;
          this.vx = 0;
          return true;
        }
      }
      else if (this.dangerNear) { freeze = true; turn = true; }   // flag16（:54527-54530）
      else turn = true;
    } else if (t4) {
      // 一格上障碍：净空 −4..−1 / 障碍列 −4..−2（:54533-54537）
      if (!solidRange(ax - dir * 2, ax - dir, fy - 4, fy - 1)
        && !solidRange(ax, ax, fy - 4, fy - 2)) this.vy = -5;
      else if (this.dangerNear) { freeze = true; turn = true; }
      else turn = true;
    } else if (this.y + this.h - fy * 16 > 20 && t3
      && st.slope[st.idx(ax, fy)] !== 1 && st.slope[st.idx(ax, fy)] !== 2) {
      // 半格障碍（bottom 沉入脚部行 >20px 且非上坡面，:54542-54546）：净空 −3..−1
      if (!solidRange(ax - dir * 2, ax, fy - 3, fy - 1)) this.vy = -4.4;
      else if (this.dangerNear) { freeze = true; turn = true; }
      else turn = true;
    } else if (t5 && shortBody && !t4 && !t3 && this.h >= 34) {
      // ★楣阻档（2026-09-01 染料商楔死定谳补装）：仅头顶行实心而胸/脚行全空且
      // 本体高≥34px(物理上无法通过仅两空行的开口)——原版此形态三档全不受理
      // （tier1 门含 flag25 矮个需 t4 同实心），按字面移植会让顶楣行走被横碰撞
      // 逐拍吞速→0.07px/tick 微爬+腿程耗尽前永不折返；本仓高频几何=头顶一行
      // 的门楣/檐口。以兄弟支「不可进则转身」(flag26)语义收尾——登记性偏离
      // （原版无对应 branch，参照 ：54604-54608 折返面），不加跳、不动 cornered；
      // 危险中同兄弟支叠冻结。小型宠物(h<34)可钻低拱，不受理。
      if (this.dangerNear) { freeze = true; }
      turn = true;
    } else if (avoidFalling) {
      // 前视避坠命中（:54575-54579）：无障碍但前方是坑/岩浆/深水 → 转身
      // （flag24 溺水跳出时例外——跳出当帧不转身）；危险中叠冻结
      turn = true;
      if (this.dangerNear) freeze = true;
    } else if (SLIME_TOWN_IDS.has(this.vanillaId)
      && !solidRange(ax - dir * 2, ax - dir, fy - 2, fy - 1)) {
      // ★对抗修复批⑤ A9 臂A（cs:54721-25 flag14=IsTownSlime 末档）：侧带两列×
      //   两行净空 → 史莱姆小跳 vy=-5。插入序=【cs 字面梯序】置于 avoidFalling
      //   支之后（:54710 避坠臂 :54721 史莱姆臂相邻 else-if；任务书"支前"表述与
      //   反编译相邻序不符，以 cs 为准——仅当「无墙阻、非避坠」同时成立才受理，
      //   与原版受理面一致）
      this.vy = -5;
    }
    if (freeze) {                                        // flag27（:54596-54600）
      this.corneredT = 240;                              // ai[0]=8 / ai[1]=240
      this.fleeing = false;
      this.vx = 0;
    }
    if (turn) {                                          // flag26（:54604-54608）
      this.facing = -dir;
      this.vx = -this.vx;
    }
    return turn;
  }

  /** 行走随机坐椅（★对抗修复批⑤ A11 行号考古：真锚 cs:55922-85
   *  `flag30 && ai[0]==1 && velocity.Y==0 && num>0 && rand(num)==0`,掷跨度常量
   *  num=300 置于 AI_007 头部 cs:53527-31——狗 638/兔 656/IsTownSlime 恒 0;
   *  旧注 ":55774-55814" 与 ":53369-53373" 均系错引,语义面不变）：
   *  行走态（wantDir!=0 ≈ ai[0]==1）站地 rand(300)==0 → 脚下格（Bottom−2px）
   *  为椅/马桶（tile2.type∈{15,497} + style 27 排除,cs:55958-61）且无占位 → 坐。
   *  占位门 = 其他坐姿城镇 NPC（Bottom−2px 同格,:55942-49）+ 坐姿玩家（Center 同格,
   *  :55950-57）。落座锚与夜路径同构：原版 Bottom=(x*16+8+2*dir, y*16+16)
   *  （:55972-75）≡ sittingAnchor(x, y+1, dir)，故复用 forceSit
   *  （占位/朝向/锚点/时长 900+rand(10800) 全同链） */
  private tryRandomChairSit(
    world: import('../world/World').World, game: GameHooks, wantDir: number,
  ): boolean {
    if (wantDir === 0 || !this.onGround || this.sitting || this.talking
      || this.social !== null                            // flag30 的 ai[0]<2 面（★F1②）
      || this.atkState !== 0 || this.corneredT > 0
      || this.dangerNear                                  // flag30 的 !flag16（:55768）
      || this.wet                                         // flag30 的 !wet（:55768 字面）
      || NO_SIT_NPC_IDS.has(this.vanillaId)) return false;   // num=0 恒不触发（cs:53527-31）
    if (this.rng() >= 1 / 300) return false;              // rand(num)==0（num=300,cs:55922）
    const st = world.store;
    const px = Math.floor(this.cx / TILE);
    const py = Math.floor((this.y + this.h - 2) / TILE);  // Bottom−2px（:55777）
    if (!st.inBounds(px, py)) return false;
    const ti = st.idx(px, py);
    if (!canSitAt(st.type[ti], st.frameY[ti])) return false;
    for (const o of game.npcs?.() ?? []) {                // NPC 占位（:55782-55790）
      const n = o as { sitting?: boolean; cx?: number; y?: number; h?: number; dead?: boolean };
      if (o === this || n.dead || !n.sitting) continue;
      const ox = Math.floor((n.cx ?? 0) / TILE);
      const oy = Math.floor(((n.y ?? 0) + (n.h ?? 0) - 2) / TILE);
      if (ox === px && oy === py) return false;
    }
    const pl = (game as unknown as {
      player?: { x: number; y: number; w: number; h: number; sitting?: boolean };
    }).player;                                            // 玩家占位（:55791-55799）
    if (pl?.sitting
      && Math.floor((pl.x + pl.w / 2) / TILE) === px
      && Math.floor((pl.y + pl.h / 2) / TILE) === py) return false;
    return this.forceSit(world, game, { x: px, y: py + 1 });   // 落座地面行 = 椅格+1
  }

  /** 城镇 NPC 自卫攻击（AI_007 攻击态机,NPC.cs:54747-55538 + 触发门 :55761-56105）。
   *  返回 true = 攻击态中(调用方停走)。语义对照:
   *  - flag31 门 ≈ 空闲+站地+触发冷却尽+探测范围内有可打敌(flag16;stinky 分支无系统跳过)
   *  - 掷骰 rand(max(1,chance×num3))==0,num3=2(209 ÷3),:53813/:53562
   *  - 入态:ai[1]=AttackTime,面向目标;态内每 tick ai[1]--/localAI[3]++/vx×0.8
   *  - 发射档:localAI[3]==num46/55/65;连发链 `localAI[3]>档 → 推下一档`(:55066 族)
   *  - 退出:ai[1]<=0 → 冷却 localAI[1] = cdBase/2 + rand(cdRand)(:54927-54934 族)
   *  伤害缩放(考古销项 2026-08-14):四态伤害统一走 GetAttackDamage_ForTownNPC
   *  (NPC.cs:7041-7044 = ×TownNPCDamageMultiplier.Sample(Main.Difficulty),
   *  GameDifficultyData.cs:69:Journey 2/Classic 1/Expert 1.5/Legendary 2,Master 3
   *  无键→区间插值 1.75)——已接 ScaleStats.getAttackDamageForTownNPC +
   *  mainDifficulty(旅程强度滑杆/getGoodWorld +1 同链)。
   *  num2 进度强化链(2026-08-14 接):AI_007 头部 :53400-53557 = 战斗书两本
   *  +0.25/17 Boss 旗标+硬模式(+0.05~+0.4)/Skyblock+0.5/醉酒尾乘×1.1——
   *  townNpcProgressionBoost(FromWorld) 1:1,num3(频率门除数)同链同步接;
   *  恒 false 登记:skyblockLowTiles(无 ScanTiles 计数链,见 fromWorld 注);
   *  tipsy=实例位(669 麦酒爆炸施加,TownShot.kill669→applyTipsy,本类
   *  tipsyT/tipsyNow 承接——消费点按 this.tipsy 覆盖 fromWorld 的 false)。
   *  已销项:633 狼人变体 proj929+×1.5/108 连发 1-3(权重 4:2:1)±3.4/160·663
   *  落点弹原版几何+重掷次数(10/5);入态外加门(:56012-56103)=弓族斜率 ±0.5
   *  (:56048-56049)+狼人态目标 ≤50px(:56022-56025),2026-08-30 实体侧对账批补;
   *  挥击态逐 tick 弧形判定(GetSwingStats/TweakSwingStats)+危险侧前探 32px+
   *  「换敌再接」重起手链,2026-08-31 对齐批②(swingUpdate 重写,登记销账);
   *  对话还手(:55761 总伞 (!flag5|flag16) + num3×0.8 减频,2026-08-31 对账批②接
   *  ——旧「talking 不入攻击态·0.8 不可达」登记系误判作废)。
   *  登记销账（★对抗修复批⑤ A6）：flag28 带检回写已接——入态种子=vector8.Y
   *  （真锚 cs:55098 起四攻击支序列,旧注 ":55864 族" 系 1456 行号残留错引）+
   *  连发推进档 cs:55382-91 回写;防御链 :53401-53531(dryadWard+Boss 防,另批;
   *  ward 防御枝载体 dryadWardT 已在 hurt() 内联) */
  private attackUpdate(world: import('../world/World').World, game: GameHooks): boolean {
    // ★F3：atkCd(localAI[1]) 递减已上提到 fixedUpdate 危险扫描之后（NPC.cs:55770-55772
    // 挂 `(!flag5|flag16)` 伞内——对话且无险不递减;治疗/社交/坐姿各路径统一覆盖）
    const atkType = TOWN_ATTACK_TYPE[this.vanillaId];
    if (atkType === undefined) return false;
    this.hardModeFlag = !!(world.flags as Record<string, boolean>).hardMode;
    this.werewolfFlag = this.vanillaId === 633
      && shouldBestiaryGirlBeLycantrope(world.clock.moonPhase, world.clock.bloodMoon, world.clock.isDay);
    if (this.atkState === 0) {
      // 触发门:站地 + 冷却尽 + 探测范围内有 LOS 敌(:55769 flag31)
      // ★F1② ai[0]<2 结构面（:55769 字面 `(ai[0]<2 || ai[0]==8)`）：除坐姿 5 外，
      //   社交态 3/4/16/17 与驻足 9 等一切 >2 态同不入攻击触发列（本仓 social!==null
      //   承接）——被逼停 8 唯一豁免,其余按 <2 面逐项排除。
      // flag31 的 (flag16||flag18) 门(:55769)= 危险扫描命中(dangerNear,PrettySafe
      // 收口后)——远程族"敌在 PrettySafe 外"时逃/打一起停;flag18 全文无置位恒
      // false(死旗),`flag16|flag18` ≡ flag16;flag17(stinky 臭源在场,:55769 `!flag17`
      // 因子,C3②)→ 不发起自卫攻击。被逼停 ai[0]==8 在 flag31 豁免列——站定仍还击。
      // ★对话不豁免（2026-08-31 对账批②原版总伞翻案）：`(!flag5|flag16)`(:55761)
      //   = 仅「对话且无险」整段跳过——对话中有险照常掷骰入态（num3×0.8 减频,
      //   :55762-55765;num15 重算位次值与扫描伞位次公式同形同源,池统一后由
      //   threatPool/dangerSide 承接）
      if (!this.onGround || this.atkCd > 0 || this.sitting || this.social !== null
        || this.healing || !this.dangerNear || this.dangerStinky) return false;
      this.prevAi0 = this.corneredT > 0 ? 8 : this.walkMode;   // localAI[2]=ai[0]（:56028 族）
      let chance = TOWN_ATTACK_CHANCE[this.vanillaId] ?? 1;
      // num3 = 进度强化链频率除数(:53413 起 19 项累计;2026-08-14 前恒 2 近似已废)
      // tipsy = 实例位（NPC.tipsy :93179,669 麦酒爆炸施加——非世界旗标）
      const progGate = townNpcProgressionFromWorld(world);
      progGate.tipsy = this.tipsy;
      let num3 = townNpcProgressionBoost(progGate).chanceMul;
      if (this.vanillaId === 209) num3 /= 3;    // :53548 蒸汽朋克人三倍勤
      // 对话减频（:55762-55765）：总伞 = (!flag5|flag16)——仅「对话且无险」
      // 整段跳过;对话中有险照常入态掷骰,num3×0.8 后再进 num122=(int)(chance×num3)
      if (this.talking) num3 *= 0.8;
      const gate = Math.max(1, Math.floor(chance * num3));
      // 入态前特判（:55778-55792，两支皆不耗骰——前置入掷门）：
      //   ①type124 机械师：侦察弹 582 在途（localAI[0]=1,:53716-53725 每拍检
      //     owned 弹 proj==582&&ai[1]==whoAmI）→ 本拍不入攻击态（收束弹流,防
      //     每发射击都叠新探机）；
      //   ②type20 树妖：1200px 内须存在缺 buff165 的城镇 NPC 才放行——光环
      //     施放有真受众才打（:55782-55792 扫描字面,Distance 为盒心距离;含本
      //     体——Main.npc[] 直读不含 owner 排除,Distance(self)=0 恒在窗内,
      //     故本体缺 ward 即自证满足;★B2 后施法窗会给自己续 ward,衰减窗内
      //     须依赖他人才可再入态——「独处节律化」即此门的连带效应）
      if (this.vanillaId === 124 && this.mechProbeAlive(game)) return false;
      if (this.vanillaId === 20) {
        let wardNeedy = false;
        if (this.dryadWardT <= 0) {
          wardNeedy = true;                            // 本体即候选(Distance 0)
        } else {
          for (const o of game.npcs?.() ?? []) {
            const n = o as TownNPC;
            if (!(n instanceof TownNPC) || n.dead || n === this) continue;
            if (Math.hypot(n.cx - this.cx, n.cy - this.cy) > 1200) continue;
            if (n.dryadWardT <= 0) {                   // FindBuffIndex(165)==-1
              wardNeedy = true;
              break;
            }
          }
        }
        if (!wardNeedy) return false;
      }
      // ★F1 入态掷骰前置（2026-08-30 实体侧对账批）：原版入态门序 =
      //   flag31 && velocity.Y==0 && AttackType==X && chance>0 &&
      //   Main.rand.Next(num122)==0 ——【先耗骰】再进支内做候选重验+带检，
      //   无幸存候选的 tick 同样恰好消耗一次掷（1457 NPC.cs:56012 近战 /
      //   :56037 弓 / :56061 魔法 / :56090 挥击；1456 同构 :55864/:55889/
      //   :55913/:55942）。旧实现「无幸存候选先 return 再走掷门」使该类
      //   tick 骰耗 0 → 相对原版随机流平移（弓族斜率/狼人 ≤50px 新过滤放大
      //   暴露面）；town-npc-damage 曾以全局 LCG 替身迁就此事——倒果为因，
      //   已随本次撤回实例注入）
      if (this.rng() >= 1 / gate) return false;     // rand(gate)==0
      const params = this.atkParams(atkType);
      if (!params && atkType !== 3) return false;
      // 入态候选选择（★F2 check-after-select 形状 + ★C2 池直读定案）：主候选按
      // 危险侧 num15 钦定（直读本拍 threatPool 快照,不再独立重扫——原版 :56019 起
      // 直读 Main.npc[num16/num17]）→ 重验失败单次回退次候选 → 带检只对【终选者】
      // 判，不过即本 tick 拒发——不再对另一侧/另一敌重试（弓族斜率 ±0.5 :56048-56
      // vector8.Y 带；狼人态 ≤50px :56022-25 flag36；支内重验 :56019-26/:56052-57）。
      // 弓族另带 lineMode=真 CanHitLine 门（:56044/:56058 用 CanHitLine 非 CanHit,
      // 比扫描期 CanHit 更严）;方向 Y 同时存进 ai[2]=vector8.Y 做持械仰角
      const target = this.pickSideTarget(
        world,
        // 重验形状（★F5①）：近战 CanHit 点对（:56019-56023）/ 弓 CanHitLine 点对
        // （:56044-56046）+ 斜率带 ±0.5(:56048-49)/ 魔法同为 CanHitLine 点对
        // （:56066-56068——旧注释"仅弓族 lineMode"系漏读,:56061 支与 :56037 支同族
        // 字面;旧"点对同构零差"说法按分支实形态废除）/ 挥击 CanHit 点对(:56094-98)/
        // 狼人 ≤50px 带检(:56022-56025 flag36)
        atkType === 1 ? { slopeCapY: 0.5, lineMode: true }
          : atkType === 2 ? { lineMode: true }
            : (this.vanillaId === 633 && atkType === 0) ? { maxDist: 50 } : undefined,
      );
      // 树妖特例（:55936-55940）：目标全失 LOS 仍进入 ai[0]=14 施法态（净化脉冲
      // 586 是自身光环弹不需瞄准）——else if (type == 20) 无条件入态分支
      if (!target && this.vanillaId !== 20) return false;
      this.atkState = atkType === 0 ? 10 : atkType === 1 ? 12 : atkType === 2 ? 14 : 15;
      // ★对抗修复批⑤ A6：入态种子——弓族 cs:56052-59 `ai[2]=vector8.Y`（带检
      //   ±0.5 同门内成值,pickSideTarget 终选已落 aimY）;近战/魔法/挥击入态支
      //   显式 ai[2]=0f（cs:56027/:56071/:56100 字面）。旧实现无条件清零系漏读
      this.holdAim = atkType === 1 ? (target?.aimY ?? 0) : 0;
      this.atkTimer = TOWN_ATTACK_TIME[this.vanillaId] ?? 30;
      this.atkTick = 0;
      this.atkBurstIdx = 0;
      this.cyborgRoll = undefined;          // ★A3：上轮残留清偿（入态拍不掷）
      this.atkNextShot = (params as TownShotParams | undefined)?.shootTick ?? 1;
      if (target) {
        // :56031 入态方向 = position.X（盒左缘）字面比较——四攻击态 + 治疗(:56004)
        // + 挥击重接(:55669) 全族同式;2026-08-31 对账批②由中心比较纠回
        this.facing = target.x < this.x ? -1 : 1;
      }   // 树妖无目标分支不转向
      this.wardT = 0;             // 586 光环弹龄清零（发射于 atkTick 24）
      return true;
    }
    // ---- 态内推进 ----
    // ★对抗修复批⑤ A3：209 逐弹冷却参数块——原版 SelectRandom(134,133,135)
    //   位于 ai[0]==12 参数块首（cs:55138-55139），随态内【每 tick】求值（含无发射
    //   拍与退出拍），switch 覆写 num55/maxValue2 为退出块所用；故先于 vx*0.8/倒计
    //   时掷出。本仓缓存入 cyborgRoll，shootAt 发射面直接消费本拍选中值。
    if (this.vanillaId === 209 && this.atkState === 12) {
      const kind = [134, 133, 135][Math.floor(this.rng() * 3)];   // cs:55139 SelectRandom<int>
      const per: Record<number, [number, number]> = {             // switch num55/maxValue2
        134: [20, 10],                                            //   case 134 :55158-59
        133: [10, 1],                                             //   case 133 :55147-48
        135: [30, 10],                                            //   case 135 :55141-42
      };
      this.cyborgRoll = { kind, cdBase: per[kind][0], cdRand: per[kind][1] };
    }
    this.atkTimer--;
    this.atkTick++;
    this.vx *= 0.8;
    const range = TOWN_DANGER_RANGE[this.vanillaId] ?? 200;
    // 树妖祝福光环（弹 586 出生于 atkTick 24，AI_111 :38720-38816）：弹龄 wardT
    //  自出生起计；Kill 门 = 本 NPC 离开 ai[0]=14 态（:38724）→ 态尽随退态熄灭
    if (this.atkState === 14 && this.vanillaId === 20 && this.atkTick >= 24) {
      this.wardT++;
      this.updateDryadWardAura(world, game);
    }
    if (this.atkState === 15) {
      // 挥击态：退出链（含换敌再接/被逼停复位）在 swingUpdate 内闭环,
      // 此处不落通用退出（atkTimer 已重置或态已清）
      this.swingUpdate(world, game);
    } else {
      const params = this.atkParams(TOWN_ATTACK_TYPE[this.vanillaId]) as TownShotParams;
      // 连发链:localAI[3] 超过当前档 → 推下一档(原版逐档 if 链)
      const burst = params.burst ?? [];
      while (this.atkBurstIdx < burst.length && this.atkTick > this.atkNextShot) {
        this.atkNextShot = burst[this.atkBurstIdx++];
      }
      if (this.atkTick === this.atkNextShot) this.shootAt(world, game, params, range);
    }
    if (this.atkTimer <= 0 && this.atkState !== 0 && this.atkState !== 15) {
      // 退出（:54927-54934/:55196-55203/:55381-55389 共用形状→exitAttackCommon:
      // 腿程/冷却同掷序,localAI[1]≡localAI[3],cornered 复位四态一致）
      // ★对抗修复批⑤ A3：209 的 cdBase/cdRand 用【本拍选中弹】的 num55/maxValue2
      //   覆写静态表值（cs:55362-66 num52→num55 随参数块每拍刷新——退出块直读）
      const p = this.atkParams(TOWN_ATTACK_TYPE[this.vanillaId]);
      let cdBase = (p as TownShotParams | undefined)?.cdBase ?? 10;
      let cdRand = (p as TownShotParams | undefined)?.cdRand ?? 1;
      if (this.vanillaId === 209 && this.cyborgRoll) {
        cdBase = this.cyborgRoll.cdBase;
        cdRand = this.cyborgRoll.cdRand;
      }
      this.atkState = 0;
      this.exitAttackCommon(cdBase, cdRand);
    }
    return true;
  }

  /** 医师（type 18）治疗城镇 NPC 整支。返回 true = 治疗态中/本拍入态。
   *
   *  触发门（NPC.cs:55986 字面）`netMode!=1 && ai[0]<2 && velocity.Y==0 &&
   *  type==18 && breath>0`——本仓 ai[0]<2 以「非对话/社交/攻击/坐姿/被逼停/
   *  非治疗」承接，velocity.Y==0 以判定时点（重力未施、贴地）onGround 承接；
   *  breath 与溺水计数同载体（窒息期 breath≤0 不触发,原版同门）。
   *
   *  患者扫描（:55988-55997）：active && townNPC && life≠lifeMax &&
   *  缺血(lifeMax−life)最大者 && CanHitLine(盒→盒) && 距离<500。
   *  ★原版【无 !=self 门、无 buff 阻断】——医师带伤时自我治疗与治疗他人
   *  同权（反编译为准；"受疗对象 !=self" 为旧口径误记）。缺血并列保留首见
   *  （严格 `>` 比较）；bound 族跳过（原版被缚者为独立非 townNPC 型）。
   *  入态（:55998-56004）：ai[1]=34 / localAI[3]=0 / direction = 盒左比较朝患者；
   *  与原版一致,入态当拍即落态机首拍（localAI[3]==1 → 发弹）。态内 vx×0.8。
   *  退出（:55383-55390）：ai[0]=0、ai[1]=10+rand(10)（站定腿）、localAI[3]=
   *  5+rand(10)（转身锁位 turnLock 承接）。
   *  发弹（:55371-55382）：Center+(spriteDirection×16, −2)、初速 =
   *  DirectionTo(患者.Center+(0,−20))×8（NaN 或背向 → (dir,−1)×8 兜底），
   *  proj 584 dmg0 kb0 —— NurseSyringeShot（AI_110 忠实版，弹独立存活）。
   *  台词：原版治疗链无 Chat 触点（en-US.Town.json 无 Heal 族键,NPC.cs 全段
   *  不经 GetSpecialChatEvent），音效锚点同样为空——反馈 = 患者 position 盒的
   *  CombatText.HealLife 绿字（100,255,100,HealEffect NPC.cs:78234-78246），
   *  本仓 addDamageNumber '#64FF64' 承接。 */
  private nurseHealUpdate(world: import('../world/World').World, game: GameHooks): boolean {
    if (this.vanillaId !== 18 || this.bound || this.dead) return false;
    if (!this.healPatient) {
      // ---- 触发门 + 患者扫描（仅空闲态,ai[0]<2 面）----
      // ★对话不豁免（2026-08-31 对账批②）：本触发块在总伞 `(!flag5|flag16)`
      //   内（:55761..55966 同层）——对话且无险才整段跳过;对话中有险照常入治疗
      //   态。cornered（ai[0]==8）与 flag31 同理不入 ai[0]<2 列
      if ((this.talking && !this.dangerNear) || this.sitting || this.corneredT > 0
        || this.social !== null
        || this.atkState !== 0 || !this.onGround || !(this.breath > 0)) return false;
      let best: TownNPC | null = null;
      let bestMissing = 0;
      for (const o of game.npcs?.() ?? []) {
        const p = o as TownNPC;
        if (!(p instanceof TownNPC) || p.dead || p.bound) continue;
        const missing = p.maxHp - p.hp;
        if (missing <= 0) continue;                        // life == lifeMax 排除
        if (best !== null && missing <= bestMissing) continue;   // 严格 > 并列保首见
        if (Math.hypot(p.cx - this.cx, p.cy - this.cy) >= 500) continue;   // Distance < 500f
        // :55995 CanHitLine(position..→nPC6.position..) 盒版（rect 直传）
        if (!canHitLine(world.store, this.x, this.y, this.w, this.h, p.x, p.y, p.w, p.h)) continue;
        best = p;
        bestMissing = missing;
      }
      if (!best) return false;
      this.healPatient = best;
      this.healT = TOWN_ATTACK_TIME[this.vanillaId] ?? 34;          // :56000 ai[1]=34
      this.healTick = 0;                                            // :56002 localAI[3]=0
      this.facing = best.x < this.x ? -1 : 1;                       // :56003 direction
      game.behavioLog?.('nurseHeal', { phase: 'start', id: this.id, targetId: best.id });
    }
    // ---- 态推进（NPC.cs:55360-55391;入态当拍即执行首拍）----
    const patient = this.healPatient!;
    this.vx *= 0.8;                                       // :55362 velocity.X *= 0.8
    this.healT--;                                         // :55365 ai[1]--
    this.healTick++;                                      // :55366 localAI[3]++
    if (this.healTick === 1) {
      // :55371-55382 发射治疗弹 584（dmg0/kb0;弹面 aiStyle110 见 NurseSyringeShot）
      let dx = patient.cx - this.cx;
      let dy = (patient.cy - 20) - this.cy;
      const len = Math.hypot(dx, dy);
      let nvx: number, nvy: number;
      if (len === 0) { nvx = Number.NaN; nvy = Number.NaN; }
      else { nvx = dx / len; nvy = dy / len; }
      if (!Number.isFinite(nvx) || Math.sign(nvx) === -this.facing) {   // HasNaNs||背向兜底
        nvx = this.facing; nvy = -1;
      }
      const shot = new NurseSyringeShot(
        // NewProjectile(X,Y,…)=锚点（:55376 Center+(dir*16,−2)）→ 本仓 Entity
        // 顶左锚换算 −halfSize——★对抗修复批⑤ A4：半宽取弹真实 SetDefaults 尺寸源
        // （584 恰 10×10,Projectile.cs:6343-6345,数值与旧硬编码不变）
        this.cx + this.facing * 16 - (projectileData(584)?.width ?? 10) / 2,
        this.cy - 2 - (projectileData(584)?.height ?? 10) / 2,
        nvx * 8, nvy * 8,                                  // vec × 8
        patient,
        (amt, px, py) => {                                 // HealEffect(:34712→:78239)
          game.addDamageNumber(px, py, amt, false, '#64FF64');
          game.recLog?.('nurseHeal', { phase: 'healed', id: patient.id, amt });
        },
      );
      this.activeSyringe = shot;
      game.spawnTownShot?.(shot);
      game.behavioLog?.('nurseHeal', { phase: 'syringe', id: this.id, targetId: patient.id });
    }
    if (this.healT <= 0) {
      // :55383-55390 退出：站定短腿 + 转身锁位
      this.walkMode = 0;                                   // ai[0]=0
      this.walkT = 10 + Math.floor(this.rng() * 10);       // ai[1]=10+rand(10)
      this.turnLock = 5 + Math.floor(this.rng() * 10);     // localAI[3]=5+rand(10)
      this.healPatient = null;
      this.healT = 0;
      this.healTick = 0;
      game.behavioLog?.('nurseHeal', { phase: 'done', id: this.id });
    }
    return true;
  }

  /** 机械师侦察弹在途门（NPC.cs:53716-53725 每拍检 owned 弹 proj==582 &&
   *  ai[1]==whoAmI → localAI[0]=1；:55778-55780 flag31 抑制消费——侦察弹在途时
   *  不再起攻击态）——本仓 ai[1]=probeTag 发射端写入,全量扫弹等价原版 lazy 缓存
   *  查表。注:1458 热补丁未动此面,数值锚仍 1457 */
  private mechProbeAlive(game: GameHooks): boolean {
    for (const p of game.projectiles?.() ?? []) {
      const s = p as TownShot;
      if (!s.dead && s.projId === 582 && s.ai1 === this.probeTag) return true;
    }
    return false;
  }

  /** 当前类型的态参数(10/12/14;15 走 TOWN_SWING);hardMode 覆盖按 world.flags */
  private atkParams(atkType: 0 | 1 | 2 | 3): TownShotParams | undefined {
    const table = atkType === 0 ? TOWN_MELEE : atkType === 1 ? TOWN_BOW : atkType === 2 ? TOWN_MAGIC : undefined;
    if (!table) return undefined;
    const base = table[this.vanillaId];
    if (!base) return undefined;
    if (base.hardMode && this.hardModeFlag) return { ...base, ...base.hardMode } as TownShotParams;
    // 633 狼人态(:54782-54785):换 proj 929 + dmg×1.5 取(int)截断(15→22)
    if (this.vanillaId === 633 && this.werewolfFlag) {
      return { ...base, proj: 929, dmg: Math.trunc(base.dmg * 1.5) };
    }
    return base;
  }


  /** 挥击态(15)逐拍判定 + 退出链（NPC.cs:55615-55686；★2026-08-31 对齐批②,
   *  原「中段一击」登记项销账）：
   *  - 判定盒：GetSwingStats(AttackTime×2, ai[1], spriteDirection, num83, num84)
   *    + TweakSwingStats 变形（townNpcSwing.ts 纯函数 1:1），每 tick 重算；
   *  - 命中循环（:55625-55640）：active && immune[myPlayer]==0 && !dontTakeDamage &&
   *    !friendly && damage>0 && 盒相交 && (noTileCollide||CanHit(position→nPC.position))
   *    ——命中即 StrikeNPCNoInteraction 并锁 immune=(int)ai[1]+2，同一敌在剩余
   *    态程内不再吃二段（per-enemy 免疫锁本仓 swingImmune 承接）；伤 num81 =
   *    GetAttackDamage_ForTownNPC(num81×num2)，飘值/音效 = Enemy.hurt 单点
   *  - 退出链（ai[1]<=0，:55645-55686）：flag16 → 背向危险侧前探 32px 点对墙探，
   *    退路堵死（或入态时是 ai[0]==8）→「换敌再接」：优先危险侧同侧候选
   *    （num15==1?num17:num16——num15 读伞时刻快照,对话中恒 0 → 恒左,见下注），
   *    点对 CanHit 不过单次回退另一侧候选，皆失 → 不接；
   *    接上则 ai[1]=AttackTime / localAI[3]=0 重起手并按新目标转向（ai[0] 保持 15，
   *    冷却 localAI[1] 不动）。不接 → 标准退出（cornered 复位 `(localAI[2]==8)&flag16`）*/
  private swingUpdate(world: import('../world/World').World, game: GameHooks): void {
    const sw = TOWN_SWING[this.vanillaId];
    if (!sw) return;
    const t = TOWN_ATTACK_TIME[this.vanillaId] ?? 15;
    const store = world.store;
    let dmg = sw.dmg;
    let kb = sw.kb;
    if (this.vanillaId === 441 && this.givenName === 'Andrew') { dmg *= 2; kb *= 2; } // 猫单特典 :55431
    // num2 进度强化链(:53400-53557)先于难度曲线(:55466 同式)
    // tipsy = 实例位（NPC.tipsy :93179,669 麦酒爆炸施加——非世界旗标）
    const progSwing = townNpcProgressionFromWorld(world);
    progSwing.tipsy = this.tipsy;
    const num2 = townNpcProgressionBoost(progSwing).damageMul;
    // ---- 每拍弧形判定盒（GetSwingStats/TweakSwingStats,single-strike 登记销账）----
    const anchor = getSwingStatsAnchor(t * 2, this.atkTimer, this.facing, sw.rect, sw.rect,
      this.cx, this.y);
    const box = { x: Math.trunc(anchor.x), y: Math.trunc(anchor.y), w: sw.rect, h: sw.rect };
    if (this.facing === -1) box.x -= box.w;                     // :55627-55629 TopLeft 翻面
    box.y -= box.h;                                             // :55630-55632
    tweakSwingStats(box, t * 2, this.atkTimer, this.facing);    // :55634
    for (const ent of game.enemies()) {
      const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean;
        id?: number; dontTakeDamage?: boolean;
        damage?: number; def?: { damage?: number; friendly?: boolean };
        hurt: (d: number, kx: number, ky: number, g: GameHooks) => boolean };
      if (e.dead) continue;
      const eid = e.id ?? ((e as unknown as { uid?: number }).uid ?? 0);
      // 扫描门（:55625 逐字 active && immune==0 && !dontTakeDamage && !friendly &&
      // nPC2.damage>0——friendly 残留（睡渔夫 376 等）与零伤体不吃城镇卫兵挥击）
      if ((this.swingImmune.get(eid) ?? 0) > 0) continue;       // immune[myPlayer]==0
      if (e.dontTakeDamage || e.def?.friendly || (e.damage ?? e.def?.damage ?? 0) <= 0) continue;
      if (!(box.x < e.x + e.w && box.x + box.w > e.x && box.y < e.y + e.h && box.y + box.h > e.y)) continue;
      // 视线门（1457 NPC.cs:55635）：矩形相交后每敌须 noTileCollide||CanHit(rect→rect)
      if (!canHit(store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
      // 伤害结算(:55466):GetAttackDamage_ForTownNPC(num82*num2)——(int) 截断;
      // immune 锁 = (int)ai[1]+2（:55639,与态程同窗递减）
      e.hurt(getAttackDamageForTownNPC(dmg * num2, mainDifficulty(world)),
        this.facing * kb, 0, game);
      this.swingImmune.set(eid, Math.trunc(this.atkTimer) + 2);
    }
    if (this.atkTimer > 0) return;
    // ---- 退出链（NPC.cs:55645-55686）----
    let chained = false;
    if (this.threatRaw) {                                       // flag16（原始位）
      // ★F4 消费时序收口：num15 的成值位只有两处——收口伞(!flag5,:54099-54100)与
      // 触发区对话重算(:55763-55764),都【先于】挥击态机执行。退出链(:55649/:55653)
      // 读到的是"伞时刻"快照：非对话=本拍侧选值；对话中 num15 恒 0 → 前探距离
      // −0×32=Center(CanHit 恒真,重接只走 prevAi0==8 支)且主候选恒取左(num16)
      const sideRight = !this.talking && this.dangerSide === 1;
      const probeX = this.talking ? this.cx : this.cx + -this.dangerSide * 32;
      // 前探点对（CanHit(base.Center,0,0,…)：退路堵死 或 入态时是被逼停）
      if (!canHitPoint(store, this.cx, this.cy, probeX, this.cy) || this.prevAi0 === 8) {
        // 「换敌再接」候选（:55652-55658）：主候选 = 危险侧【同】侧最近敌(num15==1→num17)
        //（★C2 后与本仓其他消费位同源：直读 threatPool 快照）
        const primary = sideRight ? this.threatPool.right : this.threatPool.left;
        const alternate = sideRight ? this.threatPool.left : this.threatPool.right;
        let chosen = primary;
        if (chosen && !canHitPoint(store, this.cx, this.cy, chosen.cx, chosen.cy)) {
          // 单次回退（num89 侧不过即放弃——原版嵌套三元,无第二轮回退）
          chosen = (!alternate || !canHitPoint(store, this.cx, this.cy, alternate.cx, alternate.cy))
            ? null : alternate;
        }
        // ★B1②：不设活性门——原版 :55656 直读 Main.npc[num88] 判 CanHit 无
        // .active 查询（原文如此,详见 ThreatRef 注）；同拍致死目标原版同样可接
        if (chosen) {
          chained = true;                                       // :55664-55671 重起手:
          this.atkTimer = TOWN_ATTACK_TIME[this.vanillaId] ?? t;// num87 = AttackTime
          this.holdAim = 0;                                     // ai[2]=0
          this.atkTick = 0;                                     // localAI[3]=0
          this.facing = chosen.x < this.x ? -1 : 1;             // direction（盒左比较,:55669）
          game.behavioLog?.('npcSwing', { phase: 'rechain', id: this.id, dir: this.facing });
        }
      }
    }
    if (!chained) {
      // :55679-55685 标准退出（与四攻击态共用形状,见 exitAttackCommon）
      this.atkState = 0;
      this.exitAttackCommon(sw.cdBase, sw.cdRand);
    }
  }

  /** 三攻击态（10 近战弹/12 弓/14 魔法）标准退出的公共形状（AI_007 各态退出块
   *  :55078-55084/:55350-55356/:55548-55554 一字同构）+ 挥击态 :55676-55686 同支
   *  （护士治疗态 13 的退出是独立形——ai[0]=0/ai[1]=10+rand(10)/localAI[3]=
   *  5+rand(10) 两掷互不共享且不动 localAI[1]，:55381-55390，nurseHealUpdate 内联）：
   *  掷序 = 腿程 ai[1] = cdBase+Next(cdRand) → localAI[1]&(localAI[3]) =
   *  cdBase/2+Next(cdRand)（同值共享——atkCd 与转身锁 turnLock 同源）；
   *  cornered 复位 = (localAI[2]==8)&flag16 → 回被逼停态且 ai[1] 取腿程值；
   *  非复位臂（无险或入态时非逼停）→ ai[0]=0 归站定（本仓 walkMode=0 承接,
   *  ★对抗修复批①2026-09-01 补——旧实现漏走态归零）+ corneredT 显式清零
   *  ——原版 single ai[0]
   *  载体换号即离态，本仓影子计数须同步归零，防"急袭完成仍钉 ~225t"残窗 */
  private exitAttackCommon(cdBase: number, cdRand: number): void {
    this.holdAim = 0;                     // ai[2] 态尽归零（:55080 族）
    const legT = Math.floor(cdBase + Math.floor(this.rng() * Math.max(1, cdRand)));
    const cdV = cdBase / 2 + Math.floor(this.rng() * Math.max(1, cdRand));
    this.walkT = legT;                    // ai[1]
    this.atkCd = cdV;                     // localAI[1]
    this.turnLock = cdV;                  // localAI[3]（与 localAI[1] 同值同掷）
    if (this.prevAi0 === 8 && this.threatRaw) {
      this.corneredT = legT;              // ai[0]=8 + ai[1]=legT（flag27 复位面）
      this.fleeing = false;
      this.vx = 0;
    } else {
      // ★对抗修复批①2026-09-01：非 cornered 臂补 walkMode=0——四退出锚的
      // `(localAI[2]==8f)&flag16 ? 8 : 0` 强制归站定态（cs:55081/:55353/:55551/
      // :55679 逐字），cornered 臂保持现状。入态 prevAi0 快照语义不变
      this.walkMode = 0;
      this.corneredT = 0;                 // ai[0]=0 离逼停态（影值清偿）
    }
  }

  /** 树妖祝福光环（弹 586 AI_111_DryadsWard :38720-38816 语义收口）：
   *  - 半径（:38732-38745）：出生 300 → 300-300t 段 Lerp 至 600 → 500t 起
   *    Lerp 至 1200（钳 600/1200 上限）
   *  - 玩家授予（:38797-38802）：弹龄 >=30 且 FindBuffIndex(165)==-1 →
   *    AddBuff(165,120)；本仓 buffs.apply 的 max 合并等价续期（120t=2s）
   *  - 尘（:38754-38777,★BJ256 2026-09-21 1:1）：微光正弦混金尘 70 → 1/4 环缘向心
   *    尘 + 1/2 近心 30px 尘,向心速度 3..8（1/8 ×3+scale+0.5）
   *  - 熄灭（:38732 Kill 门 + :38814 >=570 Kill）：本 NPC 离开施法态或弹龄 570
   *  敌怪 186 DryadBane 同链 else-if 臂（Projectile.cs:41967-41970，2026-08-31 台账
   *  批补：!friendly && lifeMax>5 && !dontTakeDamage && (无186|≤20t 重授) &&
   *  (已带煞 || CanHit 弹心点对敌盒) && type!=488 蜂后豁免；DoT =
   *  GetDryadsBaneDamagePerSecond(:92898 进度链 ×4 基) → DOTTally.Add(dps×2,
   *  dps/3) = dps HP/s，Enemy.dryadBaneT/dryadBaneDps 承载） */
  private updateDryadWardAura(world: import('../world/World').World, game: GameHooks): void {
    if (this.wardT > 570) return;
    const a = this.wardT;
    let radius = 300;
    if (a >= 500) radius = 600 + (1200 - 600) * Math.min(1, (a - 500) / 100);
    else if (a >= 100) radius = 300 + (600 - 300) * Math.min(1, (a - 100) / 200);
    if (a >= 30) {
      const pl = (game as unknown as { player?: import('./Player').Player | undefined }).player;   // 测试桩可能不载 player——生产恒有，防御读
      if (pl && !pl.dead
        && Math.hypot(pl.cx - this.cx, pl.cy - this.cy) <= radius) {
        pl.buffs.apply(BuffType.DryadsWard, 2);   // AddBuff(165,120)=2s
      }
      // :38804 循环（Projectile.cs:41957-41973）——**无 owner 排除**，树妖本体同
      // 样受 buff165（nPC.townNPC 支字面收编）。★治理批 B2 对齐落地（对账批②的
      // 「tn===this 排除」登记偏离销账）：施法窗内每 10t 给自己续 120t ward →
      // hurt() 防御 +20/15/10 与荆棘反伤 ⌊实伤/3⌋ 两枝即刻覆盖本体；连带 ：55782
      // 入态门（扫描含 self、`FindBuffIndex(165)==-1` 才放行）出现「独处施法节律
      // 化」——本体带 ward 时不再自证 needy，须等 120t 衰减归零才可再入 ai[0]=14。
      if (a % 10 === 0) {
        for (const ent of (game.npcs?.() ?? [])) {
          const tn = ent as TownNPC;
          if (!(tn instanceof TownNPC) || tn.dead) continue;
          if (Math.hypot(tn.cx - this.cx, tn.cy - this.cy) > radius) continue;
          if (tn.dryadWardT <= 20) tn.dryadWardT = 120;
        }
        // else-if 臂：非友好实体的 186 树妖煞（:41967 字面门序——重授窗 FindBuff==-1
        // || buffTime<=20 由 ≤20/120t 比例承载；LOS = CanHit(弹心,1,1, 敌盒))
        const progAura = townNpcProgressionFromWorld(world);
        // GetDryadsBaneDamagePerSecond（NPC.cs:92898-92963，单源 stats/DryadsBane.ts）
        // ——★2026-09-01 F11 翻正：树妖煞 DoT 用的是【专用】进度链，与 AI_007 自卫
        // 攻击链 townNpcProgressionBoost(:53400-53557) 是两条链：本链无 combatBook/
        // slimeKing/deerclops/tipsy/skyblock 条目、首段四王是 +0.10 档（自卫链混
        // +0.05/+0.1）。旧码误接 townNpcProgressionBoost().damageMul 致战斗书世界
        // 多算 +25%/+50%、各 boss 错档。字段逐一显式挑取防再串链；infectedSeed =
        // Main.infectedSeed（Main.cs:350，"purify this"/worldIsInfected 种子）→
        // 本仓 world.seedFlags.infectedSeed
        const baneDps = getDryadsBaneDamagePerSecond({
          downedBoss1: progAura.downedBoss1,
          downedBoss2: progAura.downedBoss2,
          downedBoss3: progAura.downedBoss3,
          downedQueenBee: progAura.downedQueenBee,
          hardMode: progAura.hardMode,
          downedQueenSlime: progAura.downedQueenSlime,
          downedMechBoss1: progAura.downedMechBoss1,
          downedMechBoss2: progAura.downedMechBoss2,
          downedMechBoss3: progAura.downedMechBoss3,
          downedPlantBoss: progAura.downedPlantBoss,
          downedGolemBoss: progAura.downedGolemBoss,
          downedAncientCultist: progAura.downedAncientCultist,
          downedEmpressOfLight: progAura.downedEmpressOfLight,
          downedFishron: progAura.downedFishron,
          infectedSeed: world.seedFlags?.infectedSeed,
        }, mainDifficulty(world));
        for (const ent of (game.enemies?.() ?? [])) {
          const e = ent as unknown as import('./Enemy').Enemy & { dryadBaneT?: number };
          if (!e || e.dead || e.vanillaId === 488) continue;         // type!=488（蜂后）
          if (e.maxHp <= 5 || e.dontTakeDamage) continue;
          if (Math.hypot(e.cx - this.cx, e.cy - this.cy) > radius) continue;
          const cur = e.dryadBaneT ?? 0;
          if (cur > 20 / 60) continue;                              // 重授窗=尚余 >20t
          if (!(cur > 0) && !canHitLine(world.store, this.cx, this.cy, 1, 1,
            e.x, e.y, e.w, e.h)) continue;                          // 未带煞须见 LOS
          applyBuffTicks(e as unknown as Record<string, number | undefined>, 186, 120);   // max 合并+免疫表
          if ((e.dryadBaneT ?? 0) > cur) e.dryadBaneDps = baneDps;  // 实际写入才算吃上
        }
      }
    }
    // ---- 尘面（AI_111 :41901-41946,★BJ256 2026-09-21 1:1——旧 rr=radius×(0.5+rng×0.5)
    //      随机半径+零速近似退役；两支=环缘向心尘 + 30px 近心尘）----
    // 尘型（:41901-41909）：163 绿叶;微光变体（ai2==1 ⟺ shimmered,townNpcVariationIndex
    // 映射同 :4825 注）正弦概率混金尘 70——p = sin(age%120×τ/120)×0.5+0.5
    let dustType = 163;
    if (this.shimmered) {
      const p = Math.sin((a % 120) * (Math.PI * 2) / 120) * 0.5 + 0.5;
      if (this.rng() < p) dustType = 70;
    }
    // 支1（:41910-41928）：Next(4)==0 → 盒=弹体盒 → position=Center+单位向×radius（环缘）,
    // 速度=向心（-单位向×3..8;1/8 掷 ×3 且 scale+0.5）,noGravity,alpha100
    if (this.rng() < 0.25) {
      const jx = Math.floor(this.rng() * 21) - 10;         // Next(-10,11)
      const jy = Math.floor(this.rng() * 21) - 10;
      const len = Math.hypot(jx, jy);
      if (len > 0) {                                       // Normalize() 零向量跳过（原版会 NaN 化,防御面）
        const ux = jx / len, uy = jy / len;
        const sp = 3 + Math.floor(this.rng() * 6);         // Next(3,9)=3..8
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, dustType, 0, 0, 100, null, undefined, true);
        if (d) {
          d.x = this.cx + ux * radius;
          d.y = this.cy + uy * radius;
          if (this.rng() < 0.125) {                        // Next(8)==0
            d.vx = -ux * sp * 3; d.vy = -uy * sp * 3;
            d.scale += 0.5;
          } else {
            d.vx = -ux * sp; d.vy = -uy * sp;
          }
        }
      }
    }
    // 支2（:41929-41946）：Next(2)==0 → 同盒 scale1.5 → position=Center+单位向×30（近心）,
    // 速度同支1 模式
    if (this.rng() < 0.5) {
      const jx = Math.floor(this.rng() * 21) - 10;
      const jy = Math.floor(this.rng() * 21) - 10;
      const len = Math.hypot(jx, jy);
      if (len > 0) {
        const ux = jx / len, uy = jy / len;
        const sp = 3 + Math.floor(this.rng() * 6);
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, dustType, 0, 0, 100, null, 1.5, true);
        if (d) {
          d.x = this.cx + ux * 30;
          d.y = this.cy + uy * 30;
          if (this.rng() < 0.125) {
            d.vx = -ux * sp * 3; d.vy = -uy * sp * 3;
            d.scale += 0.5;
          } else {
            d.vx = -ux * sp; d.vy = -uy * sp;
          }
        }
      }
    }
  }

  /** 按危险侧取可打敌（★C2 统一定案：直读 dangerUpdate 产出的 this.threatPool
   *  候选池快照，独立重扫已删除——原版 :56016-56105 入态支与 :55105-55112/:54868
   *  发射位同样直读 num13..num17 池；红 β 三轮「同拍死亡影响重扫结果」议题由
   *  删除重扫结构性消解）。两种消费形状：
   *  - 入态模式（缺省,attackUpdate :56016-56103）：①选侧钦定 num15（this.dangerSide,
   *    与扫描伞内成值公式同源）定主候选,另一侧为次候选；②重验 lineMode?canHitLine:
   *    canHitPoint —— 分支实形态（★F5① 按字面钉定）：近战 CanHit 点对(:56019-56023)/
   *    弓 CanHitLine 点对(:56044-46)/魔法 CanHitLine 点对(:56066-68)/挥击 CanHit 点对
   *    (:56094-98),不过单次回退次候选同判；③带检（弓 |DirectionTo.Y|≤slopeCapY
   *    :56048-56049 / 狼人 Distance≤maxDist :56022-56025）只对【终选者】判,失败即
   *    整次 null——不跨侧、不跨同侧他敌再试。
   *  - 发射模式（shotFaceMatch,shootAt）：num58 规则（:55105-55112 / 近战段
   *    :54868 族两连 if）= 面向与危险侧同向才取该侧候选,无重验/带检（NaN 与背向
   *    的兜底在 shootAt 向量链内）。返回含实体 position/Size——160/663 落点弹几何
   *    按原版 Main.npc[n].position/Size 采样 */
  private pickSideTarget(
    world: import('../world/World').World,
    opts?: { slopeCapY?: number; maxDist?: number; lineMode?: boolean; shotFaceMatch?: boolean },
  ): ThreatRef | null {
    const pool = this.threatPool;
    // 态内发射瞄准面（★F5 锚行校准：原版 num15/spriteDirection/num16·17 池靶
    //   取向规则首现 :55052-58（ai[0]==10 支直接内联构造 vec），挑选位同形
    //   :55105-13（num58=-1 + 两连 if）——后续发射支沿同形取池靶,本仓统一为：
    //   num15==1 && spriteDirection==1 → num17；num15==-1 && spriteDirection==-1 → num16；
    //   否则 -1。面向与危险侧不同向 → 直取默认直线向量（shootAt 兜底承担）。
    if (opts?.shotFaceMatch) {
      if ((this.facing === 1) !== (this.dangerSide === 1)) return null;
      return this.facing === 1 ? pool.right : pool.left;
    }
    // ---- 入态选靶（:56018-56027/:56051-57/:56064-70/:56093-99 四支同形）----
    const rightFirst = this.dangerSide === 1;
    let sel = rightFirst ? pool.right : pool.left;
    if (sel) {
      // 支内重验+跨侧单次回退（近战/魔法/挥击 CanHit 点对 :56019-56026 族 /
      // 弓族 CanHitLine 点对 :56044/:56058——★对齐批③全部改为字面 0 尺寸点对,
      // 端点 tile 与旧 rect 写法同构、行为零差）
      const losOk = (c: ThreatRef): boolean => opts?.lineMode
        ? canHitLine(world.store, this.cx, this.cy, 0, 0, c.cx, c.cy, 0, 0)
        : canHitPoint(world.store, this.cx, this.cy, c.cx, c.cy);
      if (!losOk(sel)) {
        const alt = rightFirst ? pool.left : pool.right;   // 次候选单次回退（原版只试一次）
        if (!alt || !losOk(alt)) return null;
        sel = alt;
      }
    } else {
      return null;
    }
    // 带检仅对终选者（:56022-56025 flag36 狼人态 Vector2.Distance≤50 /
    // :56048-56049 弓族 vector8.Y ∈ [-0.5,0.5]），失败 = 本 tick 拒发——不再试对侧
    if (opts?.maxDist !== undefined) {
      if (Math.hypot(sel.cx - this.cx, sel.cy - this.cy) > opts.maxDist) return null;
    }
    if (opts?.slopeCapY !== undefined) {
      const dl = Math.hypot(sel.cx - this.cx, sel.cy - this.cy) || 1;
      if (Math.abs((sel.cy - this.cy) / dl) > opts.slopeCapY) return null;
    }
    // ★对抗修复批⑤ A6：入态种子载体——aimY = DirectionTo(中心).Y（原版在
    //   弓族入态支 :56051-57 同门内先求 vector8 再带检,此处统一随终选落位）
    sel.aimY = (sel.cy - this.cy) / (Math.hypot(sel.cx - this.cx, sel.cy - this.cy) || 1);
    return sel;
  }

  /** 发射(:54903/:55175/:55325 三族瞄准公式统一在此) */
  private shootAt(world: import('../world/World').World, game: GameHooks, params: TownShotParams, range: number): void {
    const st = world.store;
    let proj = params.proj;
    let dmg = params.dmg;
    let speed = params.speed;
    let kb = params.kb;
    let spread = params.spread;
    // 229 PrettySafe 近距保命换炮弹(:55128-55135;同样只认 num58 规则的目标)
    // 瞄准目标（★C2 池直读 + num58 规则 :55105-55112/:54868 族）：仅当面向与
    // 危险侧同向且该侧有池候选才取——背向/无候选 → target=null 走默认直线向量,
    // 原版 num58==-1 分支同形;态内【不做】LOS 重验/带检(原版射出位亦无)
    const pretty = TOWN_PRETTY_SAFE[this.vanillaId];
    const target = this.pickSideTarget(world, { shotFaceMatch: true });
    if (params.panic && pretty && target && Math.hypot(target.cx - this.cx, target.cy - this.cy) < pretty
      && this.atkTick === params.shootTick) {
      proj = params.panic.proj; dmg = params.panic.dmg; speed = params.panic.speed;
      kb = params.panic.kb; spread = params.panic.spread;
    }
    // 209 三选一弹(:55139)
    // ★对抗修复批⑤ A3：逐弹参数改为读本拍缓存(this.cyborgRoll)——SelectRandom
    //   已上移至 attackUpdate 态推进头每 tick 掷(原版常驻求值位),此处不再掷,
    //   防同一拍双耗流
    if (this.vanillaId === 209 && !params.panic) {
      const roll = this.cyborgRoll;
      const pick = roll?.kind ?? proj;
      if (roll || pick !== params.proj) {
        proj = pick;
        const m: Record<number, [number, number, number, number]> = {
          134: [20, 13, 4, 0.1], 133: [25, 10, 6, 0.2], 135: [30, 12, 7, 0.2],
        };
        if (m[pick]) {
          [dmg, speed, kb, spread] = m[pick];
          // 出膛速度散布 num57 各弹不同(134:0.1/133·135:0.2)——本仓 spread
          // 亦即 RandomVector2 半幅,等价覆写
        }
      }
    }
    // 瞄准:弓 = 目标上抬 aimLift 取向;近战/魔法 = aimLiftScaled×(dist/range 归一)上抬
    let vx = this.facing, vy = 0;
    if (target) {
      // ai[2] 持械瞄准值——★对抗修复批⑤ A6（cs:55382-55391）：发射档回写仅在
      // `(localAI[3]==num54) & flag28 && num58 != -1` 时发生——flag28 只由连发
      // 升级链置位（19 硬模/227/178/229,本仓载体 = atkBurstIdx>0 的推进拍）,
      // 带 |Y|≤0.5 外【不写保留旧值】（入态种子 vector8.Y / 上拍值）。
      // 非连发型 flag28 恒 false → 整态零覆写。旧实现无条件钳写是病根
      // （登记注 :3631 一带的旧「:55864 族直存」说法随本批销账）
      if (this.atkState === 12 && this.atkBurstIdx > 0) {
        const pdx = target.cx - this.cx, pdy = target.cy - this.cy;
        const pdl = Math.hypot(pdx, pdy) || 1;
        const aimY = pdy / pdl;
        if (aimY >= -0.5 && aimY <= 0.5) this.holdAim = aimY;
      }
      let lift = params.aimLift ?? 0;
      if (this.atkState === 10 || this.atkState === 14) {
        const dist = Math.hypot(target.cx - this.cx, target.cy - this.cy);
        lift = (params.aimLiftScaled ?? 0) * Math.max(0, Math.min(1, dist / range));
        vy = -1; // 近战/魔法默认上抛分量(初值 -UnitY)
      }
      const dx = target.cx - this.cx;
      const dy = target.cy - lift - this.cy;
      const dl = Math.hypot(dx, dy) || 1;
      vx = dx / dl; vy = dy / dl;
      if (Math.sign(vx) !== this.facing) { vx = this.facing; vy = this.atkState === 12 ? 0 : -1; }
    } else if (this.atkState !== 12) {
      vy = -1;
    }
    vx *= speed; vy *= speed;
    // 散布(Utils.RandomVector2(Main.rand, -spread, +spread) = 两轴各一 NextDouble,
    // Utils.cs:2599-2602)。★对抗修复批③ B-F8：原版此式【无条件】求值——spread=0
    // 时是零向量加法但【两张骰照耗】,旧 `spread>0` 门使零散布型少耗两骰,确定性
    // 重放流相对原版平移(仅流位差异,分布不变)。加法保序在落点选位/连发特化之前。
    vx += (this.rng() * 2 - 1) * spread;
    vy += (this.rng() * 2 - 1) * spread;
    // 伤害结算(近战 :54897/弓 :55169/魔法 :55319 同式):
    // GetAttackDamage_ForTownNPC(dmg*num2)——(int) 截断;num2 进度强化链
    // (:53400-53557,2026-08-14 接,2026-08-14 前恒 1 近似已废)
    // tipsy = 实例位（NPC.tipsy :93179,669 麦酒爆炸施加——非世界旗标）
    const progShot = townNpcProgressionFromWorld(world);
    progShot.tipsy = this.tipsy;
    const num2 = townNpcProgressionBoost(progShot).damageMul;
    const dmgFinal = getAttackDamageForTownNPC(dmg * num2, mainDifficulty(world));
    // ★对抗修复批⑤ A4（2026-09-01）：出膛锚点「中心」→ 顶左换算改用弹真实
    // SetDefaults 半宽/半高（vanilla-projectiles.json 载体），替换硬编码 ±5——
    // 原式假设全弹体 10×10，对 950(104×104)/590(14×14) 等错半宽。586 无 TownShot
    // 出膛点不适用；1/583/584/587/589 恰 10×10 → 数值不变量保持。
    // 锚点公式本体不变：Center + (dir*16, −2)（近战 :54997-55005 / 弓 :55371-79 /
    // 魔法 :55425-33 同形）。
    const shotDef = projectileData(proj);
    const shotHW = (shotDef?.width ?? 10) / 2;
    const shotHH = (shotDef?.height ?? 10) / 2;
    const sx = this.cx + this.facing * 16 - shotHW;
    const sy = this.cy - 2 - shotHH;
    // ★BJ256 2026-09-21：20 树妖净化脉冲专类承载（AI_111 域内,详注见 DryadWardRingShot
    // 头注）——原版出膛（:55531-55536）= Center+(spriteDirection×16,−2) 原地固定
    // velocity 0（num63=0f）、ai1=whoAmI/ai2=variationIndex；旧实现无此守卫,有靶时
    // 坠入下方 160/663 落点弹支（弹体出生在目标身上）+通用「命中即亡」=全程零帧可见
    if (this.vanillaId === 20 && proj === 586) {
      game.spawnTownShot?.(new DryadWardRingShot(this.cx + this.facing * 16, this.cy - 2,
        this.shimmered ? 1 : 0, this));
      return;
    }
    // 落点弹(160/663):目标区域随机点生成 velocity=0;实心重掷(160≤10/:55351、
    // 663≤5/:55369),重掷耗尽仍实心则按末次落点照常生成(原版 while 语义)
    // ★对抗修复批③ B-F10c：出膛附 ai2=townNpcVariationIndex（:55490-95/:55503-08/
    // :55512-17 NewProjectile 第 12 参）——微光变异位（本仓 shimmered ⟺ ==1）
    if (speed === 0 && target) {
      const is160 = this.vanillaId === 160;
      let retries = is160 ? 10 : 5;
      let px = 0, py = 0;
      do {
        if (is160) {   // :55349 position − Size×2 + Size×rand(0..1)×5(逐轴独立)
          px = target.x - target.w * 2 + target.w * this.rng() * 5;
          py = target.y - target.h * 2 + target.h * this.rng() * 5;
        } else {       // :55367 position + Size×rand(0..1)
          px = target.x + target.w * this.rng();
          py = target.y + target.h * this.rng();
        }
      } while (retries-- > 0 && st.isSolid(Math.floor(px / TILE), Math.floor(py / TILE)));
      // ★SW-BJ33 2026-09-08：663 公主阵改专类承载——通用 TownShot 命中即亡,而 950
      //  是在敌体内出生的 104×104 定点阵（penetrate=-1 命中不亡/AI_186 60t 包络/
      //  双环 d267 尘+PrincessWeapon 编排粒子/NPC.immune[owner]=10t 再命中窗/
      //  damage×0.98 逐击衰减,P.cs:43453-43573/:14182-14186/:13575-13577,详见
      //  PrincessAuraShot 头注）。160 松露 590 仍走通用 TownShot（AI_112,域外）。
      //  入参 (px,py)=阵心（=原版 NewProjectile X,Y 中心坐标;TownShot 顶左换算留旧面）
      if (this.vanillaId === 663) {
        game.spawnTownShot?.(new PrincessAuraShot(px, py, dmgFinal, kb, this.shimmered ? 1 : 0));
        return;
      }
      // ★对抗修复批⑤ A4：落点弹换算同步半宽化——950(104×104) 曾按 10×10 收半宽
      game.spawnTownShot?.(new TownShot(px - shotHW, py - shotHH, 0, 0, dmgFinal, kb, proj,
        { noGravity: true, ai2: this.shimmered ? 1 : 0 }));
      return;
    }
    // ★SW-BJ33 2026-09-08：落点弹无靶守卫——原版 160/663 两支出膛块均整块包裹在
    //  `if (num70 != -1)`（:55348/:55366）内,无靶整拍不出膛（散布掷已在上方照耗,
    //  与原版流序一致）;旧实现坠入通用支=在本体侧出膛（活敌中途死亡拍可复现）。
    //  20 树妖原版无 num70 守卫（:55525-55537 无条件出膛）→ 不入本守卫维持现状。
    if (speed === 0 && !target && (this.vanillaId === 160 || this.vanillaId === 663)) return;
    // 108 巫师连发(NPC.cs:55415-55427):SelectRandom(1,1,1,1,2,2,3) 掷 1-3 发
    // (权重 4:2:1),每发速度额外 ±3.4 逐轴随机(Utils.RandomVector2(Main.rand,
    // -3.4f,3.4f) 叠加 vec4)——★F8:全链走 this.rng 注入面
    if (this.vanillaId === 108) {
      const n = [1, 1, 1, 1, 2, 2, 3][Math.floor(this.rng() * 7)];
      for (let i = 0; i < n; i++) {
        const ox = (this.rng() * 2 - 1) * 3.4;
        const oy = (this.rng() * 2 - 1) * 3.4;
        // ★对抗修复批③ B-F10c：每发出膛附 ai2=townNpcVariationIndex（:55473-74）
        game.spawnTownShot?.(new TownShot(sx, sy, vx + ox, vy + oy, dmgFinal, kb, proj,
          { ai2: this.shimmered ? 1 : 0 }));
      }
      return;
    }
    // 机械师侦察弹 ai[1]=本体 tag（:55067 NewProjectile 末参 ai1=whoAmI）
    if (this.vanillaId === 124 && this.probeTag < 0) {
      this.probeTag = ++MECH_PROBE_TAG_SEQ;
    }
    // ★对抗修复批③ B-F10：出膛附加参数面（NewProjectile 变长参表 ai0/ai1/ai2）：
    //   · 124 机械师 ai1=tag（F10 前 A 批既有）/ ai2=townNpcVariationIndex（:55067
    //     第 12 参，本批补透传——TownShot.ai2 目前无消费位，登记备注随行）；
    //   · 227 画师 ai1 = Next(12)/6f 油漆色相（:55339 第 11 参）——弹体侧 AI_001
    //     消费 hslToRgb(ai[1],1,.5) 上色；本仓 TownShot 无油漆系统 → 仅传参+登记；
    //   · 142 圣诞 ai1 = Next(5) 列变体（:55067 三元末支第 11 参）→ TownShot case
    //     589 列索引消费位；
    //   · 树妖 20 原版同样附 ai1=whoAmI/ai2=variationIndex（:55533）——★BJ256
    //     2026-09-21 起光环弹 586 由 DryadWardRingShot 专类承载（上方专类出膛支
    //     先行 return,不再坠入本通用支;buff/bane 施加面仍在 updateDryadWardAura）。
    const varIdx = this.shimmered ? 1 : 0;           // townNpcVariationIndex
    let shotOpts: { ai1?: number; ai2?: number; life?: number; noGravity?: boolean } | undefined;
    // 582 侦察弹无重力直飞（Projectile.cs AI_109 :34651-34689 仅速度保持/Lerp 归位,
    // 无自管重力项;aiStyle-1 型自管重力族才走 ai 内重力）——★对抗修复批⑤ A5 补
    // noGravity 探针窗前提(缺省 GRAV 入门会使探针抛物触地早亡,窗口塌缩)
    if (this.vanillaId === 124) shotOpts = { ai1: this.probeTag, ai2: varIdx, noGravity: true };
    else if (this.vanillaId === 227) shotOpts = { ai1: Math.floor(this.rng() * 12) / 6 };
    else if (this.vanillaId === 142) shotOpts = { ai1: Math.floor(this.rng() * 5) };
    else shotOpts = { life: (this.vanillaId === 588 || this.vanillaId === 107) ? 480 : undefined };
    game.spawnTownShot?.(new TownShot(sx, sy, vx, vy, dmgFinal, kb, proj, shotOpts));
  }

  /** 城镇 NPC 开关门（原版 NPC.cs:54478-54500/54243-54252，含高门 389 族 ShiftTallGate） */
  private npcDoorUpdate(world: import('../world/World').World, game: GameHooks) {
    const st = world.store;
    const DOOR_OPEN = TILE_BY_KEY_DOOR_TILES['door_open'] ?? -1;
    const GATE_OPEN = TILE_BY_KEY_DOOR_TILES['tall_gate_open'] ?? -1;
    // 过门关门（原版 54243-54274）：触发门只看 x——中心超门列 ±2 格；先试关门
    // （门已被拆/堵则 closeDoor 保持），再判放弃（x 或 y 超门 ±4 格——y 位移>4
    // 属"放弃"而非"过门"，本仓旧版误把 y 差并进触发门）
    // ★对抗修复批①2026-09-01：走态门——原版关门块整体在 `else if(ai[0]==1f)`
    // 行走支内（cs:54387-54414），攻击/对话/坐姿/被逼停/治疗期间不执行；本仓
    // walkMode 与这些态并行残留，故以 ai0 等价值(==1) 门控+healing 显式排除。
    // 不释放 closeDoor 记忆（doorX/Y 记录保留），回到行走态即补关
    if (this.closeDoor && this.ai0 === 1 && !this.healing) {
      const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
      if (tx > this.doorX + 2 || tx < this.doorX - 2) {
        const doorType = st.type[st.idx(this.doorX, this.doorY)];
        if (doorType === DOOR_OPEN) {
          if (closeDoorTile(st, this.doorX, this.doorY)) {
            this.closeDoor = false;
            game.behavioLog?.('npcDoor', { phase: 'closed', x: this.doorX, y: this.doorY });
            game.npcDoorNet?.('door', this.doorX, this.doorY, true, this.facing);  // msg19:关门
          }
        } else if (doorType === GATE_OPEN) {
          // 高门关门（原版 54266-54274：ShiftTallGate(closing:true)，tile 389 → 388）
          // ★BJ322：blocked/afterWrite 注入（vanilla forced=false——NPC 仍站门列内则拒,
          // EmptyTile :52206 同门;尾 TileFrame 面 :52224）
          if (shiftTallGate(st, this.doorX, this.doorY, true,
            () => game.playSfx('door_close', 1, this.cx, this.cy), {
            blocked: game.overlapsEntity ? (bx, by) => game.overlapsEntity!(bx, by) : undefined,
            afterWrite: game.tallGateTileFrameFace ? (ax, ay) => game.tallGateTileFrameFace!(ax, ay) : undefined,
          })) {
            this.closeDoor = false;
            game.behavioLog?.('npcDoor', { phase: 'gateClosed', x: this.doorX, y: this.doorY });
            game.npcDoorNet?.('gate', this.doorX, this.doorY, true, this.facing);  // msg19:闸关
          }
        } else {
          this.closeDoor = false;
        }
        if (tx > this.doorX + 4 || tx < this.doorX - 4
          || ty > this.doorY + 4 || ty < this.doorY - 4) {
          this.closeDoor = false;   // 放弃（含 y 位移 >4）
        }
      }
      return;
    }
    // 撞门开门：前方碰撞点是关着的普通门（10）或高门（388）
    // （原版 54576-54608：行进贴地态每 tick 前视探格，掷门 (Next(10)==0 | 回家旗)）
    // ★2026-08-30 二改：不依赖 hitWall —— 行进态每 tick 前视扫门（原版即 tile 扫描
    //   驱动）。★2026-08-31 台账①收敛批：hitWall 兜底通道【退役】——旧兜底
    //   「任何天气赌 10%+撞墙必开、开成不加走程、堵死不转身」四点全为偏离；现唯一
    //   通道 tryOpenDoorAhead 内已按原版补齐回家旗/成功 ai[1]+=80/全败 direction
    //   翻转三语义（见下法）。站椅近门乱开的回归面由 idleInteractive 门继续承担
    //   （原版开门在行走块内，坐/对话/攻击等态整段不可达）。
    const idleInteractive = this.sitting || this.talking || this.atkState !== 0
      || this.healing || this.stationary || this.fleeing;
    if (!this.closeDoor && !idleInteractive) {
      // ★无 walkMode 前提：站坑口停走/避坠瞬间(walkMode 被清零的 tick)正是最需要
      // 开门的时刻——原版该块挂 velocity.Y==0 的贴地窗而非游走子态
      if (this.tryOpenDoorAhead(st, game)) return;
    }
  }

  /** 开门前视判定(NPC.cs:54576-54608):
   *  t5 = 头顶行(num25, num26-2) —— 原版判定门只看这一格,探列公式与 obstacleJump
   *  同源(:54515 position.X + width/2 + 15*direction)。触发 =
   *  townNPC && t5.nactive && type∈{10,388} && ((rand(10)==0) | flag)，其中 flag =
   *  该回家旗(:53532-53547,this.homeFlag 快照)——雨/夜/日食/史莱姆雨/风暴地表时免掷必开。
   *  成功（OpenDoor 两向任一 / ShiftTallGate）→ closeDoor+doorX/Y+ai[1]+=80f；
   *  全败 → direction *= -1（:54629）。
   *  ★列级三行探测为本仓忠实扩展(门槛/半砖高差工程裕度,登记):原版单行前提下本仓
   *  地形同高场景行为一致;掷门与成败语义与原版逐字对齐(2026-08-31 台账批)。 */
  private tryOpenDoorAhead(st: TileStore, game: GameHooks): boolean {
    void this.doorContactT; // 计数字段保留(reset 链路复用),扫描不再累计
    const dir = this.facing;
    const n25 = Math.floor((this.x + this.w / 2 + 15 * dir) / TILE);
    const n26 = Math.floor((this.y + this.h - 8) / TILE);
    void n26;
    // ★列级三行探测(忠实扩展):原版只看头顶行单格,前提是室内外地面严格同高;
    // 本仓门口常伴随门槛/半砖高差 ⇒ 同列三行(顶/中/底)任一命中即可触发,
    // openDoor 自归一顶锚。判型语义与原版等价(关态 10 / 高门关态 388)。
    let hitKind: 'door' | 'gate' | null = null;
    let hitY = -1;
    for (const ry of [n26 - 2, n26 - 1, n26]) {
      const ii = st.idx(n25, ry);
      // ★G1谓词批(2026-09-04)：门探格门= tileSafely5.nactive()（NPC.cs:54606）——
      // flags 位读漏 !inActive 半边（已致动门格会被误判可开）→ 改 isActive()
      if (!st.isActive(n25, ry)) continue;
      const tt = st.type[ii];
      if (tt === TILE_BY_KEY_DOOR_TILES['door_closed']) { hitKind = 'door'; hitY = ry; break; }
      if (tt === TILE_BY_KEY_DOOR_TILES['tall_gate_closed']) { hitKind = 'gate'; hitY = ry; break; }
    }
    void hitY;
    if (!hitKind) return false;

    game.behavioLog?.('npcDoor', {
      phase: 'contact', kind: hitKind ?? 'door', x: n25, y: hitY,
      cxT: Math.floor(this.cx / TILE),
    });

    // (rand(10)==0) | flag —— 第二操作数 = 「该回家」天气/时辰旗（:53532-53547 定义、
    //   :54578 消费：雨/夜/日食/史莱姆雨/风暴地表 任一为真 → 免掷必开）。
    // ★2026-08-31 台账②：旧第二操作数 (!petOrSitting && hitWall)= 本仓造面
    //   （hitWall 撞墙"必开兜底"+任何天气都赌 10%），退役；IS_TOWN_PET 豁免子句
    //   同无原版锚——原版 townNPC 一体掷门，宠物一并删除（走近门的宠物照原版语义）。
    // 注：C# `(A | B)` 非短路 ⇒ Next(10) 每拍恒耗骰，本行序与原版一致。
    const rollHit = this.rng() < 0.1;
    if (!(rollHit || this.homeFlag)) return false;            // 本 tick 未中
    const doorOpenable = hitKind === 'door';
    if (doorOpenable) {
      // ★BJ722-A D3：NPC 开门 smash=KillTile 全语义（NPC.cs:54601 → OpenDoor :38095）
      const kc = doorKillCellOpts(game.breakTile);
      const opened = openDoor(st, n25, hitY, dir, kc) || openDoor(st, n25, hitY, -dir, kc);
      if (opened) {
        this.closeDoor = true;
        this.doorX = n25; this.doorY = hitY;
        game.playSfx('door_open', 1, this.cx, this.cy);
        game.behavioLog?.('npcDoor', { phase: 'opened', x: n25, y: hitY });
        game.npcDoorNet?.('door', n25, hitY, false, dir);  // msg19:开门
        this.walkT += 80;                                  // ai[1] += 80f(:54610/:54619)
      } else {
        // 两方向皆开不动（目标侧列被非砍切格堵死）→ direction *= -1 重试
        // （:54629 全败 else 支）。仅翻向不写 vx——原版亦只动 direction
        this.facing = -dir;
        game.behavioLog?.('npcDoor', { phase: 'openBlockedTurn', x: n25, y: hitY });
      }
      return opened;
    }
    const anchor = shiftTallGate(st, n25, hitY, false, () => game.playSfx('door_open', 1, this.cx, this.cy), {
      // ★BJ322：forced=false 同 vanilla（NPC.cs:54628）——实体占位门+尾 TileFrame 面
      blocked: game.overlapsEntity ? (bx, by) => game.overlapsEntity!(bx, by) : undefined,
      afterWrite: game.tallGateTileFrameFace ? (ax, ay) => game.tallGateTileFrameFace!(ax, ay) : undefined,
    });
    if (anchor) {
      this.closeDoor = true;
      this.doorX = anchor[0]; this.doorY = anchor[1];
      this.walkT += 80;                                    // :54627 同奖励
      game.npcDoorNet?.('gate', anchor[0], anchor[1], false, dir);  // msg19:闸开
    } else {
      this.facing = -dir;                                  // :54629 高门同败支
      game.behavioLog?.('npcDoor', { phase: 'gateBlockedTurn', x: n25, y: hitY });
    }
    return !!anchor;
  }

  /** 坐姿状态机（AI_007 ai[0]==5 族，NPC.cs:53264-53287 入座 / :54682-54710 态推进）。
   *  返回 true = 坐姿中（调用方停走）。语义对照：
   *  - 入座门：夜/雨 flag（restSpot 非空）+ 非对话 + 非攻击态（坐姿与攻击互斥：
   *    flag31 的 ai[0]<2 门 :55769 不含 5）+ 站定在 rest spot 同格（:54074
   *    num6==floorX && num7==floorY）——刚走回家传送者免站定门
   *    （TeleportToHome 落位即 TryForcingSitting :56081）
   *  - 入座（forceSit）：ai[1]=900+rand(10800)、direction=frameX!=0?1:-1、
   *    Bottom=(x*16+8+2*dir, y*16)、velocity=0（:53283-53287）
   *  - 态内：vx×0.8、ai[1]--；椅格（Bottom−2px）非椅/马桶 → ai[1]=0 立即起身
   *    （:54691-54697）；对话打断在 talking 块（:53738）
   *  - 时限起身：ai[1]<=0 → ai[0]=0 / localAI[3]=30+rand(60)（:54703-54709；
   *    本仓 turnLock 承接转向冷却）。原版 Main.sittingManager.AddNPC（:54701，
   *    同椅叠坐错位）无对应渲染载体，略——占位互斥由 forceSit 的占位门承担 */
  private sittingUpdate(world: import('../world/World').World, _game: GameHooks): boolean {
    if (this.sitting) {
      this.vx *= 0.8;                                   // :54684
      this.sitTimer--;                                  // :54685
      const st = world.store;
      const tx = Math.floor(this.cx / TILE);
      // ★对抗修复批③（蓝队A low-conf③ 精确复核）：原式 = Entity.Bottom +
      // Vector2.UnitY * -2f → ToTileCoordinates()（NPC.cs:54841-542），即
      // ⌊(Bottom.Y−2px)/16⌋ ——本仓本就是该口径，维持不改。差分面：若误用
      // (Bottom)/16 直除,底边恰好压在格线上的坐姿锚（forceSit 锚 y=地行×16）
      // 会探到【地面行】而非椅行 → 每拍误起身；(−2px) 让探针稳定落在椅行。
      const ty = Math.floor((this.y + this.h - 2) / TILE);   // Bottom−2px 格（:54692）
      if (!st.inBounds(tx, ty) || !canSitAt(st.type[st.idx(tx, ty)], st.frameY[st.idx(tx, ty)])) {
        this.sitTimer = 0;                              // 椅子没了 → 起身（:54695）
      }
      if (this.sitTimer <= 0) {
        this.sitting = false;
        this.walkMode = 0;
        this.walkT = 60 + Math.floor(this.rng() * 60);   // :54692 ai[1]=60+rand(60)
        this.turnLock = SIT_STAND_WANDER_BASE + Math.floor(this.rng() * SIT_STAND_WANDER_RAND);
      }
      return this.sitting;
    }
    if (this.sitKickLock > 0) { this.sitKickLock--; return false; }   // 危险拽起当刻
    // ★对抗修复批③ F7 连带（TryForcingSitting 调用域忠实化）：原版 TryForcingSitting
    // 只在「站定态到家臂 ai[0]==0」的刹停点被调（NPC.cs:54224），其余一切非零态
    // （社交表演/治疗/被逼停…）整段不可达——补 social!==null 挡位，防表演中的
    // 宠物猫（637 可入 NO_SIT 豁免集外）被坐姿机强拽离演出。
    if (this.social !== null) return false;
    if (!this.restSpot || this.talking || this.atkState !== 0 || !this.home
      || this.healing
      || this.corneredT > 0) return false;   // 被逼停 ai[0]==8/治疗态 ai[0]==13 均非空闲态（ai[0]<2 门）
    if (!this.teleportedHome) {
      if (!this.onGround || Math.abs(this.vx) > 0.05) return false;
      // 站定同格门（:54074）：myTile == rest spot
      const myX = Math.floor(this.cx / TILE), myY = Math.floor((this.y + this.h) / TILE);
      if (myX !== this.restSpot.x || myY !== this.restSpot.y) return false;
    }
    return this.forceSit(world, _game, this.restSpot);
  }

  /** AI_007_TryForcingSitting（NPC.cs:53264-53287）：落座地面格上一行须为可坐格
   *  （canSitAt 含椅 style 27 排除门）+ 无其他坐姿城镇 NPC 占位 → 坐下 */
  private forceSit(world: import('../world/World').World, game: GameHooks, spot: SitSpot): boolean {
    const st = world.store;
    const cx = spot.x, cy = spot.y - 1;            // 椅格 = 落座地面格上一行（:53270）
    if (!st.inBounds(cx, cy)) return false;
    const ci = st.idx(cx, cy);
    // ★幽灵保域（2026-09-03）：active() 门补 flags bit0（原版 NPC.cs:53424
    //  `tile != null && tile.active() && (type==15||497)`）——幽灵椅不可落座
    if (st.type[ci] === 0 || (st.flags[ci] & 1) === 0 || !canSitAt(st.type[ci], st.frameY[ci])) return false;
    // 占位门（:53278-53286）：任一坐姿城镇 NPC 的 Bottom−2px 格 == 本椅格 → 放弃
    for (const o of game.npcs?.() ?? []) {
      const n = o as { sitting?: boolean; cx?: number; y?: number; h?: number; dead?: boolean };
      if (o === this || n.dead || !n.sitting) continue;
      const ox = Math.floor((n.cx ?? 0) / TILE);
      const oy = Math.floor(((n.y ?? 0) + (n.h ?? 0) - 2) / TILE);
      if (ox === cx && oy === cy) return false;
    }
    this.sitting = true;
    // ★治理批 B3（2026-08-31）：SIT 计时掷骰走实例 rng 注入面——旧 Math.random 直呼
    // 使桩后构造/重放的 NPC 脱离确定性口径（tryRandomChairSit 同链入座门早已走
    // this.rng）。分布 = 900..11699 tick（:53283 `ai[1] = num + Main.rand.Next(num2)`）
    this.sitTimer = SIT_TIME_BASE + Math.floor(this.rng() * SIT_TIME_RAND);
    this.facing = chairFacing(st.frameX[ci]);                                    // :53284
    const anchor = sittingAnchor(spot.x, spot.y, this.facing);                   // :53285-53286
    this.x = anchor.x - this.w / 2;
    this.y = anchor.y - this.h;
    this.vx = 0; this.vy = 0;
    return true;
  }

  /** 当前应使用的贴图 sheet（= DrawNPCCheckAlt Main.cs:22304-22309 →
   *  TownNPCProfiles.GetProfile + profile.GetTextureNPCShouldUse 净效果）。
   *  微光态 → TownNPCs/Shimmered/{Name}_Default 档；派对/狼人 alt → 同档的
   *  _Party / _Transformed 变体。无档案类型（637/638/656 宠物等）返回 null，
   *  渲染端回落 NPC_{id} 竖条。Renderer.drawTownNPC 消费 */
  get townSheet(): string | null {
    return townNpcProfileSheet(this.vanillaId, this.shimmered ? 1 : 0, this.altTexture,
      this.variationIndex);
  }

  draw() { /* Renderer 统一绘制 */ }
}

// ★环切注册（townNpcFactory.ts 头注）：模块求值尾装配 shell-key 构造器——
// Arrow（shimmerUnlock 城镇史莱姆皇后）等文件经工厂取用，斩断 TownNPC→TownShot→Arrow 环
import { registerTownNpcCtor } from './townNpcFactory';
registerTownNpcCtor((key: string, x: number, y: number) => new TownNPC(key, x, y));
