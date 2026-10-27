// 玩家实体：移动、跳跃、游泳、Buff/配饰属性聚合、摔伤
import { Entity } from './Entity';
import type { GameHooks } from './types';
import {
  GRAVITY, MAX_FALL_SPEED, PLAYER_MAX_FALL_SPEED, PLAYER_WALK_ACCEL, PLAYER_WALK_MAX,
  PLAYER_FRICTION, PLAYER_AIR_FRICTION, PLAYER_JUMP_SPEED, PLAYER_JUMP_TICKS,
  PLAYER_IFRAME_TICKS, TILE, RUN_ACCELERATION, RUN_SLOWDOWN,
} from '../core/constants';
import { moveAndCollide, isClearSpotTest, findCollisionTileVertical, waterSurfacePinCrossed } from '../physics/TileCollision';
import { dustWaterFor } from '../render/WeatherRenderer';   // Dust.dustWater()（Dust.cs:405-421,waterStyle 映射）
import { queueRippleSized, RippleShape } from '../render/WaterWaves';   // ★用户明令分歧 2026-09-14 唇入必响：掠水涟漪走既有公共口（QueueRipple 玩家重载）
import { wetCollision, getWaterLine } from './npcLiquid';
import { mountJumpStomps, tickSlimeWetState, consumeWetSlimeOnJumpControl,
  mountHorizontalCharges, grantCollisionAttackImmunity, chilletDashCharge,
  isConsideredASlimeMount, MOUNT_DASH6_TYPES, MOUNT_CAN_DASH_TYPES, ramRuneDownDashStomp,
  playerArmorPenOf } from './MountCombat';
import { playerHurtFloatColor } from '../fx/CombatTextColors';
import { canBeChasedBy, playerCanHitEnemy, applyBannerDamageDealt, playerProjectileCanHitNpcGate } from './projTargets';
// ★Forbidden 禁戒套引擎面（组C 终盘 2026-09-18）——656 弹实体 + 几何/预览尘助手
import { ForbiddenSignProj, canSpawnSandstormFriendly, aimingLaserScan, spawnStormPreviewDust } from './ForbiddenSignProj';
import { getGlobalHurtBuckets, ImmunityCooldownID } from '../player/HurtCooldownBuckets';
import { randomizeFriendlyInsanityShadow } from './InsanityShadowFriendly';
import { Inventory, ACC_ARMOR_START } from '../items/Inventory';

import { BUFF_DEFS, BuffState, BuffType, buffTypeByVanilla } from '../stats/Buffs';
import { LuckState } from '../stats/Luck';
import { runModHoldItem, runModAccEffect, runModDodgeRoll, runModPlayerHurt, runModDamageGate, modDashSpecOf, runVanillaOverrideValue, runModPlayerPreHurt, runModPlayerPostHurt, runModPlayerModifyMoveSpeed, hasModPreHurts } from '../mods/hooks';
import { ITEM_DEFS, VANILLA_ITEM_KEY_BY_ID } from '../data/items';
import { itemCombat, BONUS_MELEE_SPEED_MULTIPLIER, NO_MELEE_SPEED_BONUS } from '../data/vanillaItemCombat';
import { itemFuncOfVid } from '../data/vanillaItemFunc';
import type { TileStore } from '../world/TileStore';
import { TileStore as TileStoreRT } from '../world/TileStore';   // 运行时 SOLID_LUT（type-only import 会被剥）
import { surviveHardcoreDeath } from '../world/gen/SeedEasterEggs';   // Main.surviveHardcoreDeath（Main.cs:2723）
import { emptyInfoAccGates, refreshInfoAccsFromItemType, type InfoAccGates } from '../stats/InfoAccs';
import { VI_ID } from '../data/itemKeys';
import { statOfInternal } from '../data/vanillaItemStats';
import type { VDust } from '../fx/VanillaDust';   // ★BJ595 尘池窄接口复用（纯函数臂）
import { MOD_ITEM_STABLE_BASE } from '../mods/types';
import { wingStatOf } from '../data/vanillaWingStats';
import { options } from '../core/Options';   // ★SW-FX14：hoverControl 档读数（Player.Settings.HoverControl 镜像）
import { stepWingFrame, FLAP_HOVER_SET } from '../data/vanillaWingVisuals';

/** ★BJ722-A（2026-10-26）：悬浮缓降臂谓词槽位集（Player.cs:27607 硬码表 1:1）
 *  ——与另两表互异勿混用：FLAP_HOVER_SET（:26991 flag19 悬浮臂,含 29/32 缺 31）、
 *  wingStats.hover=HasDownHoverStats（:29540 横移覆盖臂,{22,30,31,37,45}——
 *  WingStatsInitializer.cs:45-58,28/33/35 在默认链无 hover 特性）。本表=悬浮缓降
 *  ×0.9/×0.8 面——28 Lazure 平台/33 Yoraiz0r 咒/35 Skiphs 爪三员 BJ717-A 登记
 *  [bj717a-hover-slowfall-slotset] 漏员（旧谓词误用 eq.wing?.hover=五员表） */
const HOVER_SLOWFALL_SET = new Set([22, 28, 30, 31, 33, 35, 37, 45]);
import type { WingFrameState } from '../data/vanillaWingVisuals';
import { accFxOfInternal, accFxJsonOfVid } from '../data/vanillaAccFx';
import { accDrawSlotsOf, BALLOON_TORSO_FRAMING, BACK_DRAW_IN_BACKPACK, BACK_DRAW_IN_TAIL,
  FACE_HEAD_LAYER, FACE_MASK_LAYER, FACE_FLOWER_LAYER } from '../data/vanillaAccDrawslots';
import { plotTileLine } from '../lighting/LightingEngine';
import { dyeEntryOf } from '../data/vanillaDyes';
import { ARMOR_SET_BONUSES, DD2_PIECE_FX, matchArmorSetBonusVid, type ArmorSetBonus } from '../data/vanillaArmorSets';
import { SUMMON_GEAR } from '../data/vanillaSummonStats';
import { TagEffectStack } from './WhipTag';
import { harpyCharmEffect } from './Arrow';
import { TILE_DEFS, TILE_BY_KEY, PLATFORMS_SHEETS, CLOUDS_SHEETS } from '../data/tiles';
import { isCrackedSheet, isCrackedAt } from '../world/CrackedBricks';
// ★SW-BJ59 滚轴鞋轨骑：TrackCollision/TrackRotation 单源复用（Minecart 实体同函数）
import { trackCollision, trackRotation, magnetPosition, FLAG_ON_TRACK, FLAG_BOUNCY_BUMPER, FLAG_USED_RAMP, FLAG_HIT_SWITCH, FLAG_BOOST_LEFT, FLAG_BOOST_RIGHT } from '../world/MinecartTrack';
import { getAutoDoorVelocityContribution } from '../world/DoorOpeningHelper';   // SW-AS1 2026-09-05 自动门速度贡献
import { hurtTiles, canTileHurt, liquidCollision, drownCollision, TOUCH_IMMEDIATE, TOUCH_HOT, TOUCH_BLEEDING, SUFFOCATE, TOUCH_DESTROY, TILE_SOLID_TOP_FAMILY, type HurtTile } from '../stats/TouchDamage';
import { damageVarRoll } from '../stats/DamageVar';
import { findShimmerFreeSpot, shimmerTeleportPos } from '../stats/Shimmer';
import { ParticleOrchestraType } from '../net/syncModules';
import { mainExpertMode, mainDifficulty, getAttackDamageScaledByDifficulty, scaleStatsWorld, GDL } from '../stats/ScaleStats';
import { journeyPowers } from '../world/JourneyPowers';

/** 旅程上帝模式激活（GodmodePower.IsEnabledForPlayer——绑定态读取，
 *  对应原版 Player.creativeGodMode 每帧自 power 授予 Player.cs:25208） */
/** ★SW-FX14 悬停锁存单步纯函数（Player.cs:25452-25484 字面直译——updateHoverLatch
 *  主体，测试直调面）：↓ press 边沿（inputDown ∧ 上拍未按=controlDown∧releaseDown
 *  :25452）互斥切换：上锁存开着则关掉，否则开下锁存；↑ press 边沿（:25463）对称；
 *  vyZero（:25475 velocity.Y==0f）双清；holdMode（:25479 Settings.HoverControl==Hold，
 *  :357 缺省）双清=缺省档锁存永不驻留。 */
export function hoverLatchStep(
  cur: { up: boolean; down: boolean },
  inputUp: boolean, inputDown: boolean,
  prevUpHeld: boolean, prevDownHeld: boolean,
  vyZero: boolean, holdMode: boolean,
): { up: boolean; down: boolean } {
  const next = { up: cur.up, down: cur.down };
  if (inputDown && !prevDownHeld) {              // :25452-25461
    if (next.up) next.up = false;
    else next.down = true;
  }
  if (inputUp && !prevUpHeld) {                  // :25463-25472
    if (next.down) next.down = false;
    else next.up = true;
  }
  if (vyZero) {                                  // :25475-25478
    next.up = false;
    next.down = false;
  }
  if (holdMode) {                                // :25479-25484
    next.up = false;
    next.down = false;
  }
  return next;
}

function journeyGodmodeActive(): boolean { return journeyPowers().godmode; }

/** 强风推力脉冲（buff 194 MightyWind；Player.cs:19922-19946 逐系数 1:1——
 *  基速 sign(wind)×0.06、强风(|wind|>0.5)×1.37、腾空 ×1.5、持方向键 ×0.8 且钳
 *  ±0.072。应用侧(:20221-20232 flag2 段)向风速目标推、不越过。纯函数便于对拍 */
export function windPushImpulse(windSpeed: number, airborne: boolean, hasInput: boolean): number {
  let push = Math.sign(windSpeed) * 0.06;
  if (Math.abs(windSpeed) > 0.5) push *= 1.37;
  if (airborne) push *= 1.5;
  if (hasInput) {
    push *= 0.8;
    if (push > 0.072) push = 0.072;
    else if (push < -0.072) push = -0.072;
  }
  return push;
}

// ---- ★用户明令分歧 2026-09-14「唇入必响」（超越原版）——表层掠水反馈几何探针 ----
// 分歧面专用（非原版移植体）：判定「脚位带与液面物理接触」。原版湿态判定仍是
// wetCollision 居中盒 1:1（上方液体解析段，一字不动）——本探针只喂反馈支。
/** 脚位带液面探针：盒 [px,px+pw)×[py,py+ph) 与液面带（surfY=行顶+(256−liquid)/32×2
 *  ..【格底】）物理相交的首个液体格（扫序同 WetCollision :1614-1627 行优先首中即返）。
 *  返回 { type, surfY }；null = 无接触。液型 0/1=水 3=蜜 4=微光 2=岩浆（调用侧对
 *  岩浆保守 Skip，见 surfaceSkimSplashFeedback 边缘 case⑤定谳）。
 *  ★液带下沿取【格底物理值】而非原版 effH 甩尾（WetCollision :1610 effH=16−trunc(drop·2)
 *  的 surfY+effH 对满水/半水可超格底 0.06-0.75px）——岸侧贴走（脚=相邻水格底）零接触
 *  判据依赖严格格底；该甩尾在原版湿探针上是被 BJ79 亚像素测试冻结的 1:1 面，此处不复用。
 *  导出面=行为测试对边缘 case 定谳逐条冻结（tests/bj79-lip-pocket-wet-parity）。 */
export function skimSurfaceProbe(
  st: TileStore, px: number, py: number, pw: number, ph: number,
): { type: number; surfY: number } | null {
  const i0 = Math.max(0, Math.floor(px / TILE));
  const i1 = Math.min(st.w - 1, Math.floor((px + pw) / TILE));
  const j0 = Math.max(0, Math.floor(py / TILE));
  const j1 = Math.min(st.h - 1, Math.floor((py + ph) / TILE));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!st.inBounds(i, j)) continue;
      const idx = st.idx(i, j);
      if (st.liquid[idx] <= 0) continue;
      const type = st.liquidType[idx];
      if (type === 2) return { type, surfY: j * TILE };   // 岩浆：带内即报（保守 Skip）
      // 液面高度：同 WetCollision :1607-1610 float 收缩（255 满水 = +0.0625px）
      const drop = (256 - st.liquid[idx]) / 32;
      const surfY = j * TILE + drop * 2;
      if (px + pw > i * TILE && px < i * TILE + TILE
        && py + ph > surfY && py < (j + 1) * TILE) {
        return { type, surfY };
      }
    }
  }
  return null;
}

/** 蘑菇矿潜行加成轴 = Utils.Remap(stealth, 1f, 0.75f, 1f, 0f)（1457 Player.cs:26015
 *  num26；Utils.cs:345-348 Remap = Lerp(toMin,toMax,GetLerpValue(fromMin,fromMax,v,
 *  clamped))，Utils.cs:315-342 反序轴钳制）——s=1（无潜行）→1、s=0.75→0、s<0.75 钳 0，
 *  解析式 clamp(4s−3, 0, 1)。加成因子 (1−num26) 只在深潜行段升起、s≤0.75 起恒满，
 *  非旧平铺 (1−s) 全程线性（:26016-26018 伤 +0.5/暴 +10/仇恨 -750 全走此轴） */
function shroomiteStealthRemap(s: number): number {
  return Math.min(1, Math.max(0, 4 * s - 3));
}

// ---- 1457 弹药轮换槽序（Player.cs:3175-3180 静态表 1:1）----
/** AmmoSlotOrder_Default（:3175）：币槽 50-53 → 弹药槽 54-57 → 背包 0-53 */
export const AMMO_SLOT_ORDER_DEFAULT: readonly number[] = Object.freeze([
  50, 51, 52, 53, 54, 55, 56, 57, ...Array.from({ length: 54 }, (_, i) => i),
]);
/** AmmoSlotOrder_AmmoOnly（:3178）：弹药槽 54-57（AmmoSlots 轮换模式专用） */
export const AMMO_SLOT_ORDER_AMMO_ONLY: readonly number[] = Object.freeze([54, 55, 56, 57]);
/** AmmoSlotOrder_CoinsOnly（:3180）：币槽 50-53（币族武器 + AmmoSlots 模式） */
export const AMMO_SLOT_ORDER_COINS_ONLY: readonly number[] = Object.freeze([50, 51, 52, 53]);

/** PickAmmo_IterateRange（Player.cs:54326-54366）1:1：按槽序扫 `matches(slot) &&
 *  stack>0` 的弹药——cycling 时先数兼容组数 num2（:54332-54341,0 组早退 null），
 *  跳过 `offset % num2` 组（:54346）后取第一组；forceFirst（779/5134 :54347-54350）
 *  压 0。返回槽位下标，-1 = 无弹药（原版 null）。 */
export function pickAmmoIterateRange(
  order: readonly number[],
  slots: ReadonlyArray<{ id: number; stack: number } | null>,
  matches: (id: number) => boolean,
  offset: number,
  cycling: boolean,
  forceFirst: boolean,
): number {
  let skip = 0;
  if (cycling) {
    let count = 0;                                       // num2 :54332
    for (const s of order) {
      const it = slots[s];
      if (it && it.stack > 0 && matches(it.id)) count++;
    }
    if (count === 0) return -1;                          // :54342-54345
    skip = forceFirst ? 0 : offset % count;              // :54346-54350
  }
  for (const s of order) {                               // :54352-54364
    const it = slots[s];
    if (it && it.stack > 0 && matches(it.id)) {
      if (skip === 0) return s;
      skip--;
    }
  }
  return -1;                                             // :54365
}
import type { Enemy } from './Enemy';
import { GrappleProj, GRAPPLE_LATCH } from './GrappleProj';
import { TRACK_SHEET } from '../data/grappleHooks';
import { canHitLine } from '../physics/LineOfSight';
import { PARTY_HAIR_DYE_SHADER_ID } from '../data/vanillaHairDyes';
import { GorePiece } from './GorePiece';
import { TownShot } from './TownShot';
import { hslToRgb } from '../player/Appearance';
import { playDeathVoice, voiceSlotOfItem, type VoiceState } from '../player/PlayerVoice';
import {
  MountInstance, SCUTLIX_PROJ_ID, SCUTLIX_SHOT_DAMAGE, inAPlaceWithWind, MountShot,
  SantankShellProj, mountRollerSkateStep, MOUNT_DATA, MOUNT_SETS,
  playerFullRotationOf, rotatedBy, solidTileAt,
} from './Mounts';
import { flameParticles } from '../fx/FlameParticles';
// L5 长尾批：拍击石充能三连 Spawn_*Recharge 收编本体（fx/orchestraFx 同池）
import { snappingStoneRechargeFx } from '../fx/orchestraFx';
import { nightsEdgeFx } from '../fx/orchestraFx';   // δB B4：TimerCrit 命中面 NightsEdge 编排（P.cs:28576-28581）
import { shimmerBlockFx } from '../fx/orchestraFx';   // ★SW-FX47：MakeFloorDust 微光块 659/667 编排粒子（Player.cs:24002）
import { lightningSmallOrchestra } from '../fx/orchestraFx';   // ★BJ674 蓝/红雷 buff 编排粒子（PlayerDrawSet:1222-1239）
import { playerAccessoryVidEquipped } from '../stats/builderAcc';   // ★SW-FX19:重力地球仪 1131 装备判定（gravControl2）
import { deadCellsBeheadedHeadFx } from '../fx/orchestraFx';   // ★2026-09-01 Spawn_DeadCellsHeadEffect 本体（:1920-1953）
import { heldItemCritBonus } from './proj1457';   // ★BJ-C2/F11 持械折入单源（proj1457 无反向 Player 依赖,无环）

// 摔伤参数已对齐 Player.cs:25005-25091（25 格起伤+超格×10 线性，结算在落地段）——原 Maples 三次方曲线已废

// 沙族地格集合（TileID.Sets.Conversion：Sand{53,112,116,234} / HardenedSand{397,398,399,402}
// / Sandstone{396,400,401,403}——TileID.cs:30-34）。53/396/397 是本地基础方块键。
/** 地面材质内部 id 集（Player.cs FloorCheck :23453-23455 五旗的 tile 族——
 *  内部 id 经 TILE_BY_KEY 反查；★曾直接拿原版 sheet id 对比 st.type 永不命中
 *  = 冰面滑移整链死代码（"角色在冰面不脚滑"根因，2026-08-18 修）） */
export const ICE_SLIP_IDS = new Set<number>([
  'ice', 'thin_ice', 'v_127_ice_ice_rod', 'v_163_purple_ice_block',
  'v_164_pink_ice_block', 'v_200_red_ice_block', 'v_659_aetherium_block',
].map((k) => TILE_BY_KEY[k] ?? 0).filter((id) => id > 0));   // IceSkateSlippery(TileID.cs:149)
export const FROZEN_SLIME_ID = TILE_BY_KEY['v_197_frozen_slime_block'] ?? 0;   // slippy2
export const ASPHALT_ID = TILE_BY_KEY['v_198_asphalt_block'] ?? 0;             // powerrun

/** ★SW-BJ59：item.tileWand > 0 的六件（Item.cs SetDefaults 各 case——832 活木魔杖
 *  :11150 / 932 骨魔杖 :12149 / 933 树叶魔杖 :12162 / 1129 蜂巢魔杖 :13889 /
 *  3360+3361 红木魔杖 :30698/:30711）。滚轴鞋巡航挡 num3 门（Player.cs:28747
 *  `HeldItem.createTile >= 0 || HeldItem.tileWand > 0`）的非放置臂全集；
 *  六件 useTime 恒 10 = 与缺省档数值等价（登记） */
export const TILE_WAND_VIDS = new Set<number>([832, 932, 933, 1129, 3360, 3361]);

/** TileID.Sets.Clouds（TileID.cs:197 `Factory.CreateBoolSet(189,196,460,717,718,719)`：
 *  189 云/196 雨云/460 雪云/717 岩浆云/718 星云/719 彩虹云）——落地云床缓冲扫描
 *  （Player.cs:25538,本仓 2026-09-04 终审 B⑤ 补）消费面；本仓 sheet 域直比
 *  （消费者先经 TILE_DEFS[].vanilla?.sheet 归一,同 ICE_SLIP_IDS 教训） */
const CLOUD_SHEETS = CLOUDS_SHEETS;   // ★BJ210 收编单源 data/tiles.ts:CLOUDS_SHEETS（TileID.cs:197,§6i）

/** ★SW-FX47（b）：Main.tileBouncy（Main.cs:1484 表 + :9626-9629 初始化）——
 *  371 粉色史莱姆块 / 446-448 派对气球三色（四件全 tileSolid：Main.cs:9623/
 *  :10114-10116）。TryBouncingBlocks（Player.cs:35102）触碰扫描消费；本仓
 *  sheet 域直比（消费者先经 TILE_DEFS[].vanilla?.sheet 归一,同 CLOUD_SHEETS 口径） */
const TILE_BOUNCY_SHEETS = new Set([371, 446, 447, 448]);

/** ★C5-B7（2026-10-06）多段跳高度乘数单源（JumpMovement :20899-21197——旧湿/干
 *  两支各持一份字面镜像表,BJ533 定谳镜面漂移零判别=静默错高类债,收编单源根断）：
 *  沙暴 ×3（:20970）/ 暴雪 ×1.5（:20980）/ 航行瓶 ×1.25（:20992）/ 屁瓶 ×2
 *  （:21023）/ 蜥蜴坐骑 ×0.75（:21104）/ 云朵 ×0.75（:21181）；缺省档 ×2 =
 *  独角兽（:21048）/ 血肉山羊（:21076）/ 圣诞坦克（:21134）。干/湿两消费支共用。 */
const BOTTLE_JUMP_HMULT: Record<string, number> = {
  Sandstorm: 3, Blizzard: 1.5, Fart: 2, Sail: 1.25, Cloud: 0.75, Basilisk: 0.75,
};
const jumpHMultOf = (opt: string): number => BOTTLE_JUMP_HMULT[opt] ?? 2;

// ---- 绳锚几何系统常量（绳锚批 2026-08-19：pulley 悬挂 + 线起点链）----
/** ItemID.Sets.Yoyo（ItemID.cs:1166）——悠悠球物品 vid 集
 *  （ApplyItemPositionOffsetFromMount flag9 :50660） */
const YOYO_ITEM_VIDS = new Set([3262, 3278, 3279, 3280, 3281, 3282, 3283, 3284,
  3285, 3286, 3287, 3288, 3289, 3290, 3291, 3292, 3315, 3316, 3317, 3389, 5294]);
/** ItemID.Sets.IsAKite（ItemID.cs:153）——风筝物品 vid 集（flag12 :50663） */
const KITE_ITEM_VIDS = new Set([4367, 4368, 4369, 4370, 4371, 4379, 4610, 4611,
  4612, 4613, 4648, 4649, 4650, 4651, 4669, 4670, 4671, 4674, 4675, 4676, 4677,
  4681, 4683, 4684]);
/** TileID.Sets.Platforms（TileID.cs:243，sheet id）——WorldGen.IsRope 的
 *  "绳穿平台/花盆箱/矿轨"支（WorldGen.cs:70140-70146：314 矿轨 / 380 花盆箱 /
 *  平台族格，上下 5 格内皆有绳时该格视作绳，可攀穿） */
// ★BJ182b 收编单源 data/tiles.ts:PLATFORMS_SHEETS(sheet 域;逐值对拍全等,tests/tile-domain-sentinel §6d)
const VANILLA_PLATFORM_SHEETS = PLATFORMS_SHEETS;
/** Player.AFKTimeNeededForNoWormSpawns（Player.cs:971）——AFK 计数达此值 →
 *  NPC.cs:412 noGroundWorms=true（挂机玩家周围不出蠕虫族） */
export const AFK_TIME_NEEDED_FOR_NO_WORM_SPAWNS = 300;
/** Player.AFKTimeNeededForAutoKiting（Player.cs:977 `public static int` 原值 3600）
 *  ——afkCounterForKiting 达此值 → PickItemSelectionOverride 自动选中+使用风筝
 *  （Player.cs:17537-17547）。★Q4 刀 2026-09-30（BJ413 登记·挂机放风筝建模）：
 *  此前已登记未建模（Player.ts:6216/Game.ts:6217 注），本刀全链接通。 */
export const AFK_TIME_NEEDED_FOR_AUTO_KITING = 3600;
/** AFK 计数链步进核（纯函数,tests/finalzero-game-domain 直测）——
 *  Player.cs:25692-25701 Update 段 1:1：IsConsideredStandingStill(:3307 |vx|<0.05
 *  && |vy|<0.05) && (itemAnimation==0 || IsAKite[HeldItem]) && 六输入皆空
 *  （controlUp/Down/Left/Right/Jump/Torch）→ ++；否则清零。 */
export function stepAfkCounter(s: {
  vx: number; vy: number; itemAnimTicks: number; heldIsKite: boolean;
  inputX: number; inputUp: boolean; inputDown: boolean;
  inputJump: boolean; inputTorch: boolean; afkCounter: number;
}): number {
  const standingStill = Math.abs(s.vx) < 0.05 && Math.abs(s.vy) < 0.05;
  const animIdle = s.itemAnimTicks <= 0 || s.heldIsKite;   // ItemID.Sets.IsAKite 豁免支
  const noCtrl = s.inputX === 0 && !s.inputUp && !s.inputDown
    && !s.inputJump && !s.inputTorch;
  return standingStill && animIdle && noCtrl ? s.afkCounter + 1 : 0;
}
/** ★BJ550 下砸过程残影 stamps（纯函数,tests/bj550-downdash-vfx 直测）——
 *  Player.cs:37354-37357 isPerformingJump_DownDash → armorEffectDrawShadow=true →
 *  LegacyPlayerRenderer.cs:415-421 三张社交残影（shadowPos[0..2] 环位,3/6/9 拍滞后）
 *  × shadow=0.5+0.2i（GetImmuneAlpha/Pure Color.Multiply 全通道乘 (1−shadow)
 *  Player.cs:54810-54840 → k=0.5/0.3/0.1,RGB 变暗+α 同降=暗剪影拖带）。
 *  ring = Player.shadowRing()（SW-FX36 载体 spX/spY 快照,y 已含 gfxOffY 烘焙
 *  :16722-16725）。lx/ly = 残影脚底锚在绘制镜像空间（scale(facing)·[gravDir 翻转]）
 *  内的偏移：lx = facing·(shadow.x−p.x)+2.5（仓内精灵前移 −facing·2.5 于锚点自消）、
 *  ly = gravDir·(shadow.y−p.y−stepRenderY)。下砸期 gfxOff/坐骑抬升/netOffset
 *  结构性为 0（触发门 !mount.Active+骑乘清态 :24799-24801;netOffset 仅远端——
 *  下砸态不入联机同步,远端无残影,登记）。★定谳:原版下砸过程【零尘/零音】
 *  （发起 :20958-20961 与下坠全程无 Dust/SoundEngine 调用——过程视觉唯本残影带
 *  + 秒表双计 Main.cs:47882-47884;落地爆含音已由 BJ534
 *  deadCellsDownDashExplosionFx 落位）。 */
export function downDashGhostStamps(p: {
  facing: number; gravDir: number;
  x: number; y: number; stepRenderY: number;
}, ring: Array<{ x: number; y: number }>): Array<{ k: number; lx: number; ly: number }> {
  const out: Array<{ k: number; lx: number; ly: number }> = [];
  for (let i = 0; i < 3; i++) {
    const sp = ring[i];
    out.push({
      k: 1 - (0.5 + 0.2 * i),                                        // :419 shadow=0.5+0.2i
      lx: p.facing * (sp.x - p.x) + 2.5,
      ly: p.gravDir * (sp.y - p.y - p.stepRenderY),
    });
  }
  return out;
}
/** ★BJ594 日耀天闪套全身判定（Player.cs:37371-37375 SetArmorEffectVisuals：
 *  head==171 && body==177 && legs==112 → armorEffectDrawShadow+armorEffectDrawOutlines
 *  双旗）。甲位 id = Item.cs SetDefaults 2763/2764/2765 → headSlot/bodySlot/legSlot
 *  （2763 SolarFlareHelmet→171、2764 Breastplate→177、2765 Leggings→112）。 */
export const SOLAR_FLARE_SET = { head: 171, body: 177, legs: 112 } as const;
export function isSolarFlareFullSet(head: number, body: number, legs: number): boolean {
  return head === SOLAR_FLARE_SET.head && body === SOLAR_FLARE_SET.body && legs === SOLAR_FLARE_SET.legs;
}

/** ★BJ594 armorEffectDrawOutlines 四向脉冲描边 stamps（纯函数,tests/bj594 直测）——
 *  LegacyPlayerRenderer.cs:343-372：ghostFade 振荡体见 advanceSolarGhostFade；
 *  四张全玩家复制 offset = (±ghostFade·5, 0) ∪ (0, ±ghostFade·5)（num2=ghostFade·5,
 *  :361-372 switch 四向）、α = ×(1−ghostFade)（DrawPlayer shadow=ghostFade →
 *  GetImmuneAlphaPure Color.Multiply 全通道乘 1−shadow,Player.cs:54834-54846）。
 *  k/offset 单源此处（渲染端 brightness(k)+globalAlpha(k) 同 BJ550 习语）。
 *  集合 {(±d,0),(0,±d)} 对 facing/gravDir 镜像不变（镜像双射=集合恒等）——
 *  渲染端镜像空间直接画,无需乘向。 */
export function solarOutlineStamps(ghostFade: number): Array<{ ox: number; oy: number; k: number }> {
  const d = ghostFade * 5;                                       // :361 num2
  // ★C13-F9 注释订正（实现对注释错,2026-10-11）：乘子 = 1−shadow = 1−ghostFade
  //  （DrawPlayer shadow=ghostFade → GetImmuneAlphaPure Player.cs:54834-54846
  //  `num *= 1f - alphaReduction`——非「shadow=ghostFade 全通道乘」）
  const k = 1 - ghostFade;
  return [
    { ox: d, oy: 0, k },                                         // default: (num2,0)
    { ox: -d, oy: 0, k },                                        // case 1: (−num2,0)
    { ox: 0, oy: d, k },                                         // case 2: (0,num2)
    { ox: 0, oy: -d, k },                                        // case 3: (0,−num2)
  ];
}

/** ★BJ594 ghostFade 振荡步进（纯函数,tests/bj594 直测）——LegacyPlayerRenderer.cs:346-360：
 *  !gamePaused 时 fade += dir·0.075;<0.1 → dir=1/fade=0.1、>0.9 → dir=−1/fade=0.9
 *  （呼吸回弹钳）。fade/dir = Player 持久字段（Player.cs:1487-1489,初值 0/1——
 *  首帧 0.075<0.1 钳入 0.1）。paused=true 原样返回（:347 Main.gamePaused 门）。
 *  armorEffectDrawOutlinesForbidden（禁戒套 :373-405）共享同字段步长 0.025——
 *  本仓禁戒套未接此描边,登记（BJ594 只接日耀 0.075 档）。 */
export function advanceSolarGhostFade(
  fade: number, dir: number, paused: boolean,
): { fade: number; dir: number } {
  if (paused) return { fade, dir };
  fade += dir * 0.075;
  if (fade < 0.1) { dir = 1; fade = 0.1; }
  else if (fade > 0.9) { dir = -1; fade = 0.9; }
  return { fade, dir };
}

/** ★BJ594 日耀盾球旋转角（纯函数,tests/bj594 直测）——PlayerDrawLayers.cs:3136-3140：
 *  num = (solarShieldPos[0] × (1,0.5)).ToRotation() = atan2(y·0.5, x)；
 *  direction==−1 → += π（:3137-3139）；再 += π/50·direction（:3140 摆头微角）。 */
export function solarShieldRotation(
  pos: { x: number; y: number }, facing: number,
): number {
  let rot = Math.atan2(pos.y * 0.5, pos.x);
  if (facing === -1) rot += Math.PI;
  rot += (Math.PI / 50) * facing;
  return rot;
}

/** ★BJ594 日曜盾球贴图选择（PlayerDrawLayers.cs:3134）：Extra[61 + shields − 1]
 *  ——1/2/3 层各一张整簇贴图（14×30/18×36/22×42,簇内盾数随层递增）。 */
export function solarShieldTextureId(shields: number): number {
  return 61 + shields - 1;
}

/** ★BJ594 日耀盾球恒定色 α（PlayerDrawLayers.cs:3135 Color(255,255,255,127)——
 *  恒量支免光照,R1-F1 判例域:此 DrawData 不取光=暗处恒亮;127/255 直配 globalAlpha） */
export const SOLAR_SHIELD_ALPHA = 127 / 255;

// ===================== ★BJ595 套装视效普查·纯函数臂（tests/bj595 直测） =====================
// 落刀面四件：星璇潜行衰减环尘 / 忍者足具+水晶刺客冲刺拖尘·起爆尘 / 玩家受击尘爆
// （寒霜 d135·骨甲 d26 选型支）/ 死亡尘爆。发射站内联调用,逐参锁在此单源。

/** BJ595 尘池窄接口（VanillaDust.spawn 形状;测试以录制桩直喂） */
export interface BJ595DustPool {
  spawn(x: number, y: number, w: number, h: number, type: number,
    speedX?: number, speedY?: number, alpha?: number,
    color?: { r: number; g: number; b: number; a: number } | null, scale?: number,
    opts?: { perfect?: boolean }): VDust | null;
}

/** 受击/死亡尘选型（Player.cs:38830-38848 存活支与 :39336-39353 死亡支同构双链）：
 *  stoned→d1 / frostArmor→d135 / boneArmor→d26 / 默认 d5。 */
export function armorHurtDustType(stoned: boolean, frost: boolean, bone: boolean): number {
  return stoned ? 1 : frost ? 135 : bone ? 26 : 5;
}

/** 受击尘粒数（Player.cs:38825-38827：num24 = num2/statLifeMax2×100 双精度循环界，
 *  `for (num27 < num24)` ⇒ floor；<1% 最大生命的伤害零尘=原版相） */
export function playerHurtDustCount(dmg: number, maxHp: number): number {
  return Math.floor(dmg / maxHp * 100);
}

/** ★星璇套潜行衰减拍环尘（Player.cs:26059-26092 flag11 段）：每拍独立 1/2 掷两族。
 *  d229：位=Center−v×Next(5,11)（单掷×整向量,v=(0,1).RotatedByRandom(2π)=(−sinθ,cosθ)、
 *  θ=(rng−rng)×2π=Utils.cs:1785-87 三角化）、vel=v.RotatedBy(π/2)×4=(−v.y,v.x)×4、
 *  scale=.5+rand、fadeIn=.5；d240：位=Center−v×12、vel=v.RotatedBy(−π/2)×2=(v.y,−v.x)×2、
 *  同 scale/fadeIn。spawn 位参 (Center−v×30,0,0) 仅作 NewDust 裁剪盒,位随后覆写
 *  （:26074/:26083 原序）。返回实发粒数（0-2）。 */
export function emitVortexStealthFadeDust(
  pool: BJ595DustPool | undefined, cx: number, cy: number, rand: () => number = Math.random,
): number {
  if (!pool) return 0;
  let emitted = 0;
  for (const kind of [0, 1]) {
    if (Math.floor(rand() * 2) !== 0) continue;   // Next(2)==0 门（两族独立掷）
    const th = (rand() - rand()) * 6.2831854820251465;
    const v = { x: -Math.sin(th), y: Math.cos(th) };
    if (kind === 0) {
      const d = pool.spawn(cx - v.x * 30, cy - v.y * 30, 0, 0, 229);
      if (d) {
        d.noGravity = true;
        const r511 = 5 + Math.floor(rand() * 6);   // Next(5,11) 单掷×整向量
        d.x = cx - v.x * r511;
        d.y = cy - v.y * r511;
        d.vx = -v.y * 4; d.vy = v.x * 4;           // RotatedBy(π/2)×4
        d.scale = 0.5 + rand();
        d.fadeIn = 0.5;
        emitted++;
      }
    } else {
      const d = pool.spawn(cx - v.x * 30, cy - v.y * 30, 0, 0, 240);
      if (d) {
        d.noGravity = true;
        d.x = cx - v.x * 12;
        d.y = cy - v.y * 12;
        d.vx = v.y * 2; d.vy = -v.x * 2;           // RotatedBy(−π/2)×2
        d.scale = 0.5 + rand();
        d.fadeIn = 0.5;
        emitted++;
      }
    }
  }
  return emitted;
}

/** ★BJ596 甲虫 orb 单体步进（UpdateArmorSets_Always_Beetle 循环体 Player.cs:16579-16612
 *  逐式纯函数;rand 可注入供判别测试,实机默认 Math.random=Main.rand 域）：
 *  · pos+=vel（:16580）→ vel += Next(-100,101)×0.005 双轴（:16581-82,±0.5/t² 随机游走）
 *  · 外环 |pos|>100 → 弹簧目标 -pos/|pos|×20、vel=vel×9/10+目标×1/10（:16587-16595）
 *  · 内环 |pos|>30 → 同式目标半径 10、混合 19/20+1/20（:16596-16603）
 *  · |vel|>2 → vel×0.9（:16604-16610——非硬钳,超 2 才衰减的渐近限速）
 *  · pos -= playerVel×0.25（:16611——玩家移动球拖尾） */
export function stepBeetleOrb(
  pos: { x: number; y: number }, vel: { x: number; y: number },
  pvx: number, pvy: number, rand: () => number = Math.random,
): void {
  pos.x += vel.x; pos.y += vel.y;                                    // :16580
  vel.x += (Math.floor(rand() * 201) - 100) * 0.005;                 // :16581
  vel.y += (Math.floor(rand() * 201) - 100) * 0.005;                 // :16582
  let x = pos.x, y = pos.y;
  let d = Math.sqrt(x * x + y * y);
  if (d > 100) {                                                     // :16587-16595
    const s = 20 / d;
    x *= -s; y *= -s;
    const n = 10;
    vel.x = (vel.x * (n - 1) + x) / n;
    vel.y = (vel.y * (n - 1) + y) / n;
  } else if (d > 30) {                                               // :16596-16603
    const s = 10 / d;
    x *= -s; y *= -s;
    const n = 20;
    vel.x = (vel.x * (n - 1) + x) / n;
    vel.y = (vel.y * (n - 1) + y) / n;
  }
  x = vel.x; y = vel.y;
  d = Math.sqrt(x * x + y * y);
  if (d > 2) { vel.x *= 0.9; vel.y *= 0.9; }                         // :16604-16610
  pos.x -= pvx * 0.25; pos.y -= pvy * 0.25;                          // :16611
}

/** ★BJ596 甲虫 orb 绘制参数面（DrawPlayer_37_BeetleBuff PlayerDrawLayers.cs:4130-4155
 *  逐式纯函数）：每 orb = 5 残影（j=0..4:偏移 -vel×j、色×(0.5-j·0.1)——R,G,B,A 全通道
 *  字节截断乘）+ 本体（全色、零偏移、最后入缓存=画在最上）。帧条源矩形 =
 *  (0, H/3·frame+1, W, H/3-2)（:4151,C# 整除）;origin=(W/2, H/6)（:4153,整除）。
 *  k 因子供 canvas α 合成：RGB×k·A×k ≙ α_eff=k·A（不透明底线性等价,实体窗
 *  compositeLight 域内成立）。 */
export function beetleOrbDrawPlan(
  vel: { x: number; y: number }, beetleFrame: number, texW: number, texH: number,
): { ox: number; oy: number; k: number; main: boolean; sy: number; sh: number; orgX: number; orgY: number }[] {
  const f3 = Math.floor(texH / 3);                                   // Height/3 整除
  const sy = f3 * beetleFrame + 1;                                   // :4151
  const sh = f3 - 2;                                                 // :4151
  const orgX = Math.floor(texW / 2);                                 // :4153 Width/2
  const orgY = Math.floor(texH / 6);                                 // :4153 Height/6 整除
  const plan: { ox: number; oy: number; k: number; main: boolean; sy: number; sh: number; orgX: number; orgY: number }[] = [];
  for (let j = 0; j < 5; j++) {
    plan.push({ ox: -vel.x * j, oy: -vel.y * j, k: 0.5 - j * 0.1, main: false, sy, sh, orgX, orgY });
  }
  plan.push({ ox: 0, oy: 0, k: 1, main: true, sy, sh, orgX, orgY });
  return plan;
}

/** ★冲刺滑行拖尘（DashMovement :21440-21452 dash1 / :21461-21478 dash3★BJ594 /
 *  :21501-21515 dash5,滑行期每拍）：
 *  dash1=2×d31（盒=(x, 空中?y+h/2−num19×2 : y+h−num19)×(w, num20|trunc(num20/2)),
 *  num18=h/42、num19=4×num18、num20=trunc(16×num18)、vel×0.1、scale×(1+Next(20)×.01)、
 *  α100 s1.4,无染料）；dash3=4×d6（盒=(x, y+4×num18)×(w, h−trunc(8×num18))——
 *  无 vy 分支,s1.7、vel×0.1、scale×(1+Next(20)×.01)、noGravity、套染料、
 *  50% fadeIn .5（Next(2)==0））；dash5=2×d68/69/70（num32/num33 同值、vel×0.2、
 *  scale×(1+..)、fadeIn=.5+Next(20)×.01、noGravity、套染料）。
 *  ★BJ707-A dash6=8×d306（:21529-21548,Chillet 62-65 滑行尾尘——仅在【同向滑行拍】
 *  发射:收敛拍(反向/下鞍)vanilla 落 dashDelay=30 支零尘;调用位=dashMovement m6
 *  收敛判定后）。盒=(x+facing×80, y+12)×(w, h−20)、α100 s1、vel×1.5、
 *  scale×(1+Next(40)×.01)、fadeIn=.5+Next(20)×.01、noGravity、velX+=facing×1.5、
 *  color=Lerp((229,178,255)→White,f³)（63/65 Ignis=Lerp((255,178,127)→White,f³)）
 *  ——XNA Color(float) 构造 0.9/0.7/1×255 截断=229/178/255,Lerp 逐通道含 A=255。
 *  坐骑染料 shader（:21539 GetSecondaryShader(cMount)——非 ArmorSetDye）★BJ707-G29
 *  接线：dash6 支染料=dyeVid 入参（调用方传 mountDyeVid()=miscDyes[3]→d.dyeVid）;
 *  dash3/5 支仍 ArmorSetDye（:21470/:21515）。缺省 cMount=0→null=无染同相。
 *  其余 dash 档零尘（dash2 循环 m<0/dash4 死支）。返回实发粒数。 */
export function emitDashSlideDust(
  pool: BJ595DustPool | undefined,
  p: { x: number; y: number; w: number; h: number; vx: number; vy: number;
    facing?: number; mount?: { type: number } | null },
  dash: number, dyeVid: number, rand: () => number = Math.random,
): number {
  if (!pool) return 0;
  const num18 = p.h / 42;
  if (dash === 3) {
    const num25 = 4 * num18;
    const num26 = Math.trunc(8 * num18);              // (int)(8f*num18)
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const d = pool.spawn(p.x, p.y + num25, p.w, p.h - num26, 6, 0, 0, 100, null, 1.7);
      if (d) {
        d.vx *= 0.1; d.vy *= 0.1;
        d.scale *= 1 + Math.floor(rand() * 20) * 0.01;
        d.noGravity = true;
        d.dyeVid = dyeVid;
        if (Math.floor(rand() * 2) === 0) d.fadeIn = 0.5;   // Next(2)==0 → fadeIn
        n++;
      }
    }
    return n;
  }
  if (dash === 1) {
    const num19 = 4 * num18;
    const num20 = Math.trunc(16 * num18);
    let n = 0;
    for (let l = 0; l < 2; l++) {
      const d = pool.spawn(p.x, p.vy !== 0 ? p.y + p.h / 2 - num19 * 2 : p.y + p.h - num19,
        p.w, p.vy !== 0 ? num20 : Math.trunc(num20 / 2), 31, 0, 0, 100, null, 1.4);
      if (d) {
        d.vx *= 0.1; d.vy *= 0.1;
        d.scale *= 1 + Math.floor(rand() * 20) * 0.01;
        n++;
      }
    }
    return n;
  }
  if (dash === 5) {
    const num32 = 4 * num18;
    const num33 = Math.trunc(16 * num18);
    let n = 0;
    for (let i = 0; i < 2; i++) {
      const t = [68, 69, 70][Math.floor(rand() * 3)];   // NextFromList
      const d = pool.spawn(p.x, p.vy !== 0 ? p.y + p.h / 2 - num32 * 2 : p.y + p.h - num32,
        p.w, p.vy !== 0 ? num33 : Math.trunc(num33 / 2), t, 0, 0, 100);
      if (d) {
        d.vx *= 0.2; d.vy *= 0.2;
        d.scale *= 1 + Math.floor(rand() * 20) * 0.01;
        d.fadeIn = 0.5 + Math.floor(rand() * 20) * 0.01;
        d.noGravity = true;
        d.dyeVid = dyeVid;
        n++;
      }
    }
    return n;
  }
  if (dash === 6) {
    // ★BJ707-A dash6 Chillet 滑行尾尘（:21531-21548 同向滑行支 8×d306/拍）
    const facing = p.facing ?? 1;
    const ignis = p.mount?.type === 63 || p.mount?.type === 65;
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const d = pool.spawn(p.x + facing * 80, p.y + 12, p.w, p.h - 20, 306, 0, 0, 100, null, 1);
      if (d) {
        d.vx *= 1.5; d.vy *= 1.5;                       // :21535 velocity *= 1.5f
        d.scale *= 1 + Math.floor(rand() * 40) * 0.01;  // :21536 Next(40)×0.01
        d.fadeIn = 0.5 + Math.floor(rand() * 20) * 0.01;   // :21537 .5+Next(20)×.01
        d.noGravity = true;                             // :21538
        d.dyeVid = dyeVid;                              // :21539 shader=GetSecondaryShader(cMount)（★BJ707-G29）
        d.vx += facing * 1.5;                           // :21540
        const t3 = rand() ** 3;                         // :21541-21542 num38³ Lerp 权
        // Color.Lerp 逐通道 (int) 截断（XNA Color.Lerp）:a=(229,178,255)/(255,178,127),b=White
        d.color = ignis
          ? { r: 255, g: Math.trunc(178 + 77 * t3), b: Math.trunc(127 + 128 * t3), a: 255 }
          : { r: Math.trunc(229 + 26 * t3), g: Math.trunc(178 + 77 * t3), b: 255, a: 255 };
        n++;
      }
    }
    return n;
  }
  return 0;
}

/** BJ595 gore 窄接口（GorePiece.newGore 形状） */
export interface BJ595GoreSpawner {
  (type: number, x: number, y: number, vx: number, vy: number): { vx: number; vy: number } | null;
}

/** ★冲刺起爆尘爆（DoCommonDashHandle dashing 段）：dash1（:21583-21612）20×d31
 *  （位=盒内点+Next(−5,6) 双轴抖、vel×0.2、scale×(1+Next(20)×.01)、α100 s2）
 *  + gore 61-63×2（位=(x+w/2−24, y+h/2−34 / −14),vel=Next(−50,51)×.01 双轴后×0.4
 *  ——NewGore 内建扰动被显式覆写同净效）；dash3（:21641-21652★BJ594）20×d6
 *  （位抖同 dash1、vel×0.2、s2×(1+Next(20)×.01)、套染料、noGravity、fadeIn=.5
 *  无条件——无 gore 支）；dash5（:21700-21715）20×d68/69/70（位抖
 *  同上、vel=DirectionTo(dust.position)×2=尘位−Center 归一×2、scale/fadeIn 同滑行档、
 *  noGravity、套染料）。dash2 起爆循环 m<0=死支零尘。返回实发粒数。 */
export function emitDashLaunchBurst(
  pool: BJ595DustPool | undefined, gore: BJ595GoreSpawner | null,
  p: { x: number; y: number; w: number; h: number; cx: number; cy: number },
  dash: number, dyeVid: number, rand: () => number = Math.random,
): number {
  if (!pool || (dash !== 1 && dash !== 3 && dash !== 5)) return 0;
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const t = dash === 1 ? 31 : dash === 3 ? 6 : [68, 69, 70][Math.floor(rand() * 3)];
    const d = pool.spawn(p.x, p.y, p.w, p.h, t, 0, 0, 100, null, dash === 5 ? 1.5 : 2);
    if (d) {
      d.x += Math.floor(rand() * 11) - 5;   // Next(−5,6)
      d.y += Math.floor(rand() * 11) - 5;
      if (dash === 1) {
        d.vx *= 0.2; d.vy *= 0.2;
        d.scale *= 1 + Math.floor(rand() * 20) * 0.01;
      } else if (dash === 3) {
        // ★BJ594 dash3 日耀起爆（:21641-21652）：vel×0.2/scale×(1+Next(20)×.01)
        // 同 dash1 核 + 套染料/noGravity/fadeIn=.5 无条件（dash5 fadeIn 带掷,此档不带）
        d.vx *= 0.2; d.vy *= 0.2;
        d.scale *= 1 + Math.floor(rand() * 20) * 0.01;
        d.noGravity = true;
        d.dyeVid = dyeVid;
        d.fadeIn = 0.5;
      } else {
        const dx = d.x - p.cx, dy = d.y - p.cy;
        const len = Math.sqrt(dx * dx + dy * dy);
        const k = len > 0 ? 2 / len : 0;   // DirectionTo×2（len=0 原版 NaN 域不可达,防池污染）
        d.vx = dx * k; d.vy = dy * k;
        d.scale *= 1 + Math.floor(rand() * 20) * 0.01;
        d.fadeIn = 0.5 + Math.floor(rand() * 20) * 0.01;
        d.noGravity = true;
        d.dyeVid = dyeVid;
      }
      n++;
    }
  }
  if (dash === 1 && gore) {
    for (const gy of [p.y + p.h / 2 - 34, p.y + p.h / 2 - 14]) {
      const g = gore(61 + Math.floor(rand() * 3), p.x + p.w / 2 - 24, gy, 0, 0);
      if (g) {
        g.vx = (Math.floor(rand() * 101) - 50) * 0.01;   // Next(−50,51)×.01
        g.vy = (Math.floor(rand() * 101) - 50) * 0.01;
        g.vx *= 0.4; g.vy *= 0.4;
      }
    }
  }
  return n;
}

/** ★存活受击尘爆发射（Player.Hurt 尾 :38825-38852）：粒数=playerHurtDustCount、
 *  选型=armorHurtDustType、vx=2×hitDirection、vy=−2（num25=2×hitDir;num26 反编译
 *  恒 0 → 无第二叠加项）。frost/bone 支套染料（GetSecondaryShader(ArmorSetDye())）。 */
export function emitPlayerHurtDust(
  pool: BJ595DustPool | undefined,
  box: { x: number; y: number; w: number; h: number },
  dmg: number, maxHp: number, hitDir: number,
  stoned: boolean, frost: boolean, bone: boolean, dyeVid: number,
  rand: () => number = Math.random,
): number {
  const n = playerHurtDustCount(dmg, maxHp);
  if (n <= 0 || !pool) return 0;
  const type = armorHurtDustType(stoned, frost, bone);
  for (let i = 0; i < n; i++) {
    const d = pool.spawn(box.x, box.y, box.w, box.h, type, 2 * hitDir, -2);
    if ((frost || bone) && d) d.dyeVid = dyeVid;
  }
  return n;
}

/** ★死亡尘爆（KillMe_DustExplosion Player.cs:39330-39360,KillMe :39208 调）：100×
 *  盒内尘、vx=2×hitDirection、vy=−2、选型同 armorHurtDustType。尾支 velocity×1/
 *  scale×1/fadeIn×0（反编译字面恒等量=纯 no-op 不落）。 */
export function emitPlayerDeathDustExplosion(
  pool: BJ595DustPool | undefined,
  box: { x: number; y: number; w: number; h: number },
  hitDir: number, stoned: boolean, frost: boolean, bone: boolean, dyeVid: number,
): number {
  if (!pool) return 0;
  const type = armorHurtDustType(stoned, frost, bone);
  for (let i = 0; i < 100; i++) {
    const d = pool.spawn(box.x, box.y, box.w, box.h, type, 2 * hitDir, -2);
    if ((frost || bone) && d) d.dyeVid = dyeVid;
  }
  return 100;
}

/** 绳索攀爬速度链（Player.cs:26016-26125）：上爬 -0.2/-0.02 下限 -8；
 *  下滑 +0.2/+0.1 上限 maxFallSpeed；静止 ×0.7（|vy|<0.1 归 0 :26120-26124） */
const ROPE_IDLE_ZERO = 0.1;
export const HONEY_FLOOR_ID = TILE_BY_KEY['v_229_honey_block'] ?? 0;           // sticky(地面材质档,与 StickyTiles 泡块阻尼不同链)

const SAND_FLOOR_IDS = new Set<number>([
  'sand', 'sandstone', 'hardened_sand',
  'v_112_ebonsand_block', 'v_116_pearlsand_block', 'v_234_crimsand_block',
  'v_398_corrupt_hardened_sand_block', 'v_399_crimson_hardened_sand_block',
  'v_402_hallow_hardened_sand_block', 'v_400_corrupt_sandstone_block',
  'v_401_crimson_sandstone_block', 'v_403_hallow_sandstone_block',
].map((k) => TILE_BY_KEY[k] ?? 0).filter((id) => id > 0));

/** 十字章免疫族：物品 id → 免疫的 vanilla buff id 列表
 *  （Player.cs:14911-15003 buffImmune 逐件赋值全表）。
 *  885 抛光剂→30 流血 / 886 维生素→36 破甲 / 887 牛黄→20 中毒 / 888 创可贴→22 沉默 /
 *  889 快速时钟→32 缓慢 / 890 三折地图→35 蛛网 / 891 眼罩→23 黑暗 / 892 护腕→33 虚弱 /
 *  893 药用绷带→31 困惑 / 3781 袖珍镜→156 石化 / 901 反诅咒→33+36 / 902 扩音器→30+20 /
 *  903 计划→32+31 / 904 十字章护身符→35+23+22 / 5354 反光墨镜→22+156 /
 *  1921 暖手宝→46+47 冰寒冰冻 / 1612 十字章盾→十项全免 / 1613 十字章守护→46+十项 */
/** 背包生效域 vid 集（UpdateEquips :12494-12500 消费集合 = RefreshInfoAccsFromItemType
 *  :12319-12400 全响应 vid ∪ RefreshMechanicalAccsFromItemType :12397-12430 本仓
 *  已建模三族）——equipStatsKey 背包段只对命中格记键：未命中格不进 computeEquipStats
 *  输出,内容键仍对全部实际输入完备（直写背包放取即失效）。
 *  export 仅为 BJ563 两表同步测试锁（tests/bj563-mech-acc-vids.test.ts）,消费单点
 *  仍=equipStatsKey,禁外挂双抄 */
export const INV_EFFECTIVE_VIDS = new Set<number>([
  // 信息族（RefreshInfoAccsFromItemType 逐 if 响应 vid）
  15, 707, 16, 708, 17, 709,          // 表三档+升级版
  393, 18, 395,                        // 罗盘/深度计/GPS
  3036, 3037, 3096,                    // 渔夫耳语/天气电台/六分仪
  3084, 3095, 3118,                    // 雷达/计数器/生命体分析仪
  3099, 3102, 3119,                    // 秒表/金属探测器/DPS 计
  3120, 3121, 3122,                    // 渔夫指南/哥布林科技/REK 混合件
  3123, 3124, 5358, 5359, 5360, 5361,  // PDA/REK3000/手机/贝壳手机三态
  5574, 5575, 5576,                    // 幸运饰族（hasLuck_*）
  // 机械族（RefreshMechanicalAccsFromItemType 本仓建模面——★F3 补 4767/5323/
  // 4346/5095：漏键=袋外背包放取相应饰品不失效缓存；★F5③ 补 6190；
  // ★BJ583 补 3611：BJ572 只补了 compute 侧分支,漏键=宏伟蓝图入包/取出不失效
  // equipStats 缓存 ⇒ mechShowWires 恒陈旧,电线整层不出（探针 _bj583 实证:
  // 入包 40 拍后 equipStats.mechShowWires 仍 false=用户复报「大部分时候看不到电线」
  // 第一真凶;光照面=第二真凶见 Renderer.drawWiresPass 注））
  3619, 3611, 3624, 2216, 3061, 5126, 4767, 5323, 4346, 5095, 6190,
]);

/** ★IIIII250：vid 解析查表。equipStatsKey 旧逐槽内联
 *  `d.vid ?? -1`（★BJ283:键前缀 parseInt 兜底已退役,方案 A ⑥回填恒短路）——
 *  58 槽×2 遍×每次键重建，parseInt/startsWith/切片是键重建热点（用户雨天
 *  trace：equipStatsKey self 381ms）。vid 是 ItemDef 纯函数且 ITEM_DEFS 在
 *  items.ts 模块顶层一次性注册（物品入槽前必已注册），按 id 惰性缓存安全 */
const VID_BY_ITEM_ID: number[] = [];
function vidOfItemId(id: number): number {
  let v = VID_BY_ITEM_ID[id];
  if (v === undefined) {
    const d = ITEM_DEFS[id];
    v = d ? (d.vid ?? -1) : -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
    VID_BY_ITEM_ID[id] = v;
  }
  return v;
}

/** RefreshMechanicalAccsFromItemType 的仓内旗集（机械族，Player.cs:12916-12930
 *  建模面）——装备位（GrantArmorBenefits :13204）/主背包扫描/虚空袋传播（★F3
 *  :13029-13040）三路共用同一函数，禁双抄。dontHurtNature 5309·5323 无消费端登记不接 */
interface MechanicalAccFlags {
  mechShowWires: boolean;
  autoActuator: boolean;
  autoPaint: boolean;
  dontHurtCritters: boolean;
  preventAllItemPickups: boolean;   // 4346（Prevent All Item Pickups 位——本次补建模成面）
  hasLucyTheAxe: boolean;           // 5095 Lucy the Axe 持斧位
  oldStyleParkour: boolean;         // ★F5③ 6190 旧世界跑酷指南（Player.cs:12933-12936）
}

/** ItemID.Sets.IgnoresEncumberingStone（ItemID.cs:250 字面）：preventAllItemPickups
 *  （4346 Prevent All Item Pickups / Encumbering Stone 拖累石）生效期唯一放行拾取的
 *  白名单 = 心/星族（CanAcceptItemIntoInventory Player.cs:35172-35179 的取反面）。
 *  ★F5① 消费端挂门后自 1457 反编译原表逐 id 抄录：58 心 / 184 魔力星 /
 *  1734 大红心 / 1735 大魔力星 / 1867 圣诞之心 / 1868 圣诞之星 /
 *  3453·3454·3455 心红花红(命匣档) / 4143 法力斗篷之星 */
export const IGNORES_ENCUMBERING_STONE_VIDS = new Set<number>([
  58, 184, 1734, 1735, 1867, 1868, 3453, 3454, 3455, 4143,
]);
function refreshMechanicalAccsFromItemType(m: MechanicalAccFlags, vid: number): void {
  // ★BJ572 面③（2026-10-08）：3611 宏伟蓝图补入 InfoAccMechShowWires 置位域
  //  （Player.cs:12897-12901 `if (accType == 3619 || accType == 3611)`——蓝图
  //  【背包在册】即全图显线,与手持无关;旧缺支=蓝图收起后电线整层消失,用户复报
  //  「看不见电线」真凶）。反编译内部名 3611=WireKite（宏伟蓝图历史内部名,
  //  ItemID.cs:8766;不在 IsAKite 集 :157=4367..4684 族）;3619=机械透镜
  //  （任务面猜测的 3612 实为黄扳手 :8770）。
  if (vid === 3619 || vid === 3611) m.mechShowWires = true; // Mechanical Lens/The Grand Design（:12897-12901）
  else if (vid === 3624) m.autoActuator = true;             // Presserator（:12915 加压器）
  else if (vid === 2216 || vid === 3061 || vid === 5126) m.autoPaint = true;   // Paint Sprayer/Architect/Hand Of Creation
  else if (vid === 4767 || vid === 5323) m.dontHurtCritters = true;            // Guide To Critter Companionship/双件套
  else if (vid === 4346) m.preventAllItemPickups = true;    // Prevent All Item Pickups
  else if (vid === 5095) m.hasLucyTheAxe = true;            // hasLucyTheAxe
  else if (vid === 6190) m.oldStyleParkour = true;          // ★F5③ 旧世界跑酷指南（:12933-12936）
}
export { refreshMechanicalAccsFromItemType };

/** ItemID.Sets.WorksInVoidBag（ItemID.cs:82 `Factory.CreateBoolSet(true, 4346, 5095)`）：
 *  默认全真，例外仅此二件——虚空袋内【不】重放信息/机械刷新。
 *  ★终零波批注订正：CanVoidVaultAccept 注"例外未逐 id 建表"退役——本表即逐 id 真值 */
const WORKS_IN_VOID_BAG_FALSE = new Set<number>([4346, 5095]);
/** UpdateItemDye hidden 早退豁免名单（Player.cs:9708 `bool num =`，★R4-acc0-① 2026-09-30）：
 *  num = armorItem.wingSlot>0 ∨ type∈{934 飞毯,4341 折叠凳,5126 造物之手,4563 Shroud,
 *  1987 天使光环}——功能槽∧隐藏（:9709 flag）时 `!num && flag` 早退（:9714）对名单成员
 *  不生效 ⇒ 隐藏配饰仍把配对染料写进 c* 通道（视觉槽仍被 UpdateVisibleAccessory
 *  :36361 !hide 门挡住=只染不显,染的是该层【其他】 occupants 的贴图）。
 *  翼 face 不入本表（wingSlot>0 分支在调用点经 statOfInternal().wing 判）;934/4341/
 *  4563/1987 的 cCarpet/cPortableStool/cUnicornHorn/cAngelHalo 专通道本仓未建模
 *  （无绘制面,染料无消费端=落位即 no-op,登记债）;5126 的 back/handOn/handOff 为
 *  可达判别面。 */
const HIDDEN_DYE_NUM = new Set<number>([934, 4341, 5126, 4563, 1987]);
/** 甲件 aggro 轴（终零波批 2026-09-01）——GrantArmorBenefits :13201 逐 armorPiece.type
 *  if 链的 aggro 半臂（:13852-13874/:13983-13997）：龟甲三件 1316/1317/1318 各 +250、
 *  甲虫头/腿 2199/2202 各 +250、壳胸 2201 +400、日曜三件 2763/2764/2765 各 +300。
 *  数值面其余字段（meleeDamage/crit/lifeRegen 等）走既有各自通道；aggro getter 并入 */
const AGGRO_ARMOR_PIECE: Record<number, number> = {
  1316: 250, 1317: 250, 1318: 250,
  2199: 250, 2201: 400, 2202: 250,
  2763: 300, 2764: 300, 2765: 300,
};
/** 机械族 vid 全集（equipStatsKey 虚空袋段用；与上方
 *  refreshMechanicalAccsFromItemType 的分支表一一对应，改其一必同步另一
 *  （不变式锁=tests/bj563-mech-acc-vids.test.ts §2）。
 *  ★BJ583 补 3611（同上 INV_EFFECTIVE_VIDS 注——虚空袋段同步,袋内蓝图放取失效）;
 *  ★BJ563 补 4346/5095/6190（★F3/★F5③ 当年只补了 INV_EFFECTIVE_VIDS——虚空袋段
 *  对三件同族 stale 债清偿,补齐后与 INV_EFFECTIVE_VIDS 机械族段恒等;4346/5095 虽
 *  入本表,虚空袋段仍被 WORKS_IN_VOID_BAG_FALSE（ItemID.cs:82 例外=恰此二件,
 *  Player.cs:13031-13034）先行挡掉,重放面不扩）。
 *  导出仅为测试锁;消费单点=equipStatsKey,禁外挂双抄 */
export const MECH_ACC_VIDS = new Set<number>([3619, 3611, 3624, 2216, 3061, 5126, 4767, 5323, 4346, 5095, 6190]);

/** Item.questItem 全集（1457 反编译枚举：Item.cs 全文仅 DefaultToQuestFish()
 *  :27653-27654 一处置 true——调用面 = 任务鱼区间 `type >= 2450 && type <= 2488`
 *  （:24153 段 if 块内）∪ `case 4393: case 4394:`（:37327 两 case 共支）。
 *  ★F4 CanVoidVaultAccept（Player.cs:39735-39747）的 questItem 半臂拒收源表；
 *  另一半 = type==3822（DD2EnergyCrystal 埃特尼亚魔力）。 */
export const QUEST_ITEM_VIDS = new Set<number>((() => {
  const s = new Set<number>();
  for (let v = 2450; v <= 2488; v++) s.add(v);
  s.add(4393); s.add(4394);
  return s;
})());

/** CanVoidVaultAccept（Player.cs:39735-39747）仓内形：questItem ∪ 3822 拒。 */
export function canVoidVaultAccept(vanillaVid: number): boolean {
  return vanillaVid !== 3822 && !QUEST_ITEM_VIDS.has(vanillaVid);
}

const IMMUNE_ACC: Record<number, number[]> = {
  885: [30], 886: [36], 887: [20], 888: [22],
  889: [32], 890: [35], 891: [23], 892: [33], 893: [31],
  3781: [156],
  901: [33, 36], 902: [30, 20], 903: [32, 31], 904: [35, 23, 22],
  5354: [22, 156], 1921: [46, 47],
  1612: [33, 36, 30, 20, 32, 31, 35, 23, 22, 156],
  1613: [46, 33, 36, 30, 20, 32, 31, 35, 23, 22, 156],
};

/** UnbreakableWallScan.InsideUnbreakableWalls（UnbreakableWallScan.cs:47-66）：
 *  8 向射线各 250 格，遇墙 350（UnbreakableBlockWall，双地牢不可破墙）记方向位；
 *  随后 8 次环形移位检查——任一次低 5 位全零即 false（≈5 个连续方向命中才算
 *  被墙包围）。★LineScan（:80-91）遇 350 的返回值是【条件式】：
 *  `return tile.wallColor() >= 16`——wallColor≥16（进度分层涂装档,染色的才计入
 *  包围判定；双地牢未上漆/低色阶档不截断也不命中,且该方向立即停扫）。
 *  （2026-08-31 台账清偿⑥落地：旧"墙 350 即命中"过宽判定退役） */
/** ★SW-BJ48 2026-09-09 改导出：传送药水随机落点（Game.requestTeleportationPotionSpot）
 *  双地牢臂须按【落点格】重扫（Utils.cs:641-645 传 new Point(num9,num10)）——
 *  Player.insideUnbreakableWalls 缓存旗只代表玩家现位,不可代读 */
export function insideUnbreakableWallsScan(st: import('../world/TileStore').TileStore, px: number, py: number): boolean {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let num = 0;
  for (let i = 0; i < 8; i++) {
    let x = px, y = py, n = 0, hit = false;
    while (n < 250) {                                   // ScanDistance :19
      if (x < 0 || y < 0 || x >= st.w || y >= st.h) { hit = false; break; }
      const ti = st.idx(x, y);
      if (st.wall[ti] === 350) { hit = st.paintWall[ti] >= 16; break; }   // :89 条件返
      n++; x += dirs[i][0]; y += dirs[i][1];
    }
    if (hit) num |= 1 << i;
  }
  for (let j = 0; j < 8; j++) {
    if ((num & 0x1F) === 0) return false;
    num = ((num << 1) & 0xFF) | (num >> 7);
  }
  return true;
}

/** equipStats 形状(getter/computeEquipStats 共用;2026-08-19 记忆化改造时从内联注释放别) */
export type PlayerEquipStats = {    def: number; mana: number; hpPerSec: number;
    dmgMelee: number; dmgRanged: number; dmgMagic: number;
    critMelee: number; critRanged: number; critMagic: number;
    moveMult: number; meleeSpeed: number;
    accRunSpeed: number;   // 靴族 accRunSpeed 原值（0=未装备）
    bootFx: 'hellfire' | 'sail' | 'cold' | 'desert' | 'fairy' | null;   // 跑靴奔跑尘型（:36285 switch 按装备 vid）
    bootDyeVid: number;   // 鞋染料 vid（cShoe——尘色）
    autoReuseGlove: boolean; // 力量手套族：近战武器自动连挥（Player.cs:52040-52042）
    /** 手套族近战放大：GetAdjustedItemScale（Player.cs:41919-41930）melee 武器
     *  判定盒/手持贴图 ×1.1——泰坦手套 536(:15029-15033)/力量手套 897(:14749-14756)/
     *  机械手套 936(:14820-14826)/火焰护手 1343(:14757-14764)/狂战士手套 3992(:13993-13999) */
    meleeScaleGlove: boolean;
    extraFall: number; lavaMax: number; armorPen: number;
    rocketBoots: number; autoJump: boolean; fireWalk: boolean;
    noKnockback: boolean; noFallDmg: boolean; desertBoots: boolean;
    frostBurn: boolean;   // 冰霜盔甲引擎（StatusNPC :93712:近/远程命中 → Frostburn2）
    huntressT2: boolean;  // 女猎手 T2/T3（setHuntressT2 :16119/:16149）：爆炸机关弹 Oiled 门
    anglerSetSpawnReduction: boolean;   // 渔夫套：生成环 ×1.3/×0.7（NPC.cs:627-630）
    iceSkate: boolean;   // 冰刀族 950/1861/1862/5000：冰面不滑+加速（:26237-26255）
    waterWalk: boolean; jumpBoost: boolean; panic: boolean; starCloak: boolean;
    /** ★BJ227：纯 waterWalk 源（Player.cs:15282-15288 熔岩护足 908/泰拉靴 5000 置
     *  waterWalk、buff15 :10102 亦 waterWalk）∪——区别于 waterWalk2 源（水上漂靴 863
     *  :15269-15272/黑曜石水上漂靴 907 :15273-15277 只置 waterWalk2）。消费面二：
     *  ①Collision.WaterCollision 第 7 参 lavaWalk（:23738/:23774 只传 waterWalk 非
     *  waterWalk2——waterWalk2 族岩浆面不钉位照常下沉）；②LavaCollision 探针缩高
     *  6px（:27873-27881 `if (waterWalk) num82 -= 6`——水上漂靴族无此臂,贴浆面即灼）。
     *  液面钉位/StepDown 液面臂等其余消费面两源同权（waterWalk||waterWalk2）。 */
    waterWalkLava: boolean;
    jumpOpts: string[];
    wing: { logic: number; slot: number; time: number; accSpeed: number; accelMult: number; hover: boolean; hidden: boolean } | null;
    dash: number; blackBelt: boolean; bees: boolean; carpet: boolean;
    jumpSpd: number; flipper: boolean; longInvince: boolean;
    /** ★SW-FX1 档位还原（2026-09-09）：原版 spikedBoots 是 int 计数（Player.cs:1075），
     *  非布尔——953/975 各 +1（:15154/:15158）、976 +=2（:15162）、3995/3996 +=2
     *  （:14549/:14555）、984 【=2 赋值】（:15180,同槽覆盖前积——1:1 quirk）。
     *  档位消费分档：WallslideMovement 头门 `spikedBoots <= 0`（:21935）= >0 可贴墙；
     *  `spikedBoots >= 2`（:21955）= 驻停档（控制下 4 速滑落、否则 −gravity+1e-5
     *  缓慢上攀）；单件档（:21991 else-if）只缓降 0.5（按 ↓ 4）。曾布尔化 1/2 同档
     *  =976/984 与裸 953/975 无差别（item-audit ⚠️ 档位塌缩，本批还原）。 */
    spikedBoots: number;
    canFloat: boolean;   // canFloatInWater（字段 :2711——仅两源：甲件 4404 水上漂靴 :13364-67 ∪ buff265 Flamingo 坐骑 :9982-86；脚蹼药 109 只授 ignoreWater+accFlipper 不置此位 :10257-59、flipper 饰品亦不授——旧注":9592 脚蹼药水"系 1456 期 ignoreWater 面错锚，R1-F1 勘误 2026-09-03）
    /** Player.hasFloatingTube（:2713）——浮游圈 4404 管体绘制旗（UpdateVisibleAccessory
     *  :37265-37268 置位）。源=可见轮两环：功能槽 3-9（!hideVisibleAccessory 门内
     *  :36362-36364）∪ 社交槽 13-19（无条件 :36368-36375）——功能槽与 canFloat 的
     *  差分面：①per-slot 隐藏开关挡管不挡浮力（canFloat 走 ApplyEquipFunctional
     *  :13364 独立扫）②社交槽挂管不授浮力 ③expertOnly 门不入可见轮（清偿刀 U
     *  同臂——专家档浮游圈经典世界照画管体零浮力）。消费=渲染管体（PlayerDrawSet
     *  :1797 drawFloatingTube → PlayerDrawLayers :1273 背半/:2037 前半） */
    hasFloatingTube: boolean;
    shimmerImmune: boolean;   // Player.shimmerImmune（:15643-46 幻彩斗篷 5355 且未按住下 45t——浮液/微光 buff 双消费 :23641/:27944）
    killGuide: boolean; killClothier: boolean;   // 巫毒娃娃 267/1307
    /** 死人毛衣 5007（GrantArmorBenefits case 5007 :13226-13229 `deadMansSweater = true`
     *  ——功能性胸甲槽件 bodySlot 234,社交槽不授：UpdateEquips_CanItemGrantBenefits
     *  case 1 门=`bodySlot > -1` 而 case 3-9 门=`item.accessory`）;重置位 :18434。
     *  消费面 = Projectile.SelfHurtPlayers :15131-15134 `sweater && trap →
     *  自伤 ×0.5 截断再 min 300`（Game.selfHurtSweaterCap,SW-AC1 2026-09-04） */
    deadMansSweater: boolean;
    dontHurtCritters: boolean;   // ★E：4767/5323（RefreshMechanicalAccs :12922-12924）
    preventAllItemPickups: boolean;   // ★F3：4346（WorksInVoidBag=false 例外面）
    hasLucyTheAxe: boolean;           // ★F3：5095
    oldStyleParkour: boolean;         // ★F5③：6190 旧世界跑酷指南（:12933-12936）
    infoAccs: InfoAccGates;  // 信息饰品门禁(DrawInfoAccs)
    treasureMagnet: boolean; goldRing: boolean; luckyCoin: boolean; discount: boolean;
    arrowDmg: number; kbGlove: boolean; yoyoString: boolean;
    /** 线饰品线色（Player.stringColor，UpdateVisibleAccessory :36441-36449）：0=无；
     *  1-12/13/14/27/28/30=油漆域线色，29=魔法线鼠标文字色闪烁。钓线/悠悠球线消费 */
    stringColor: number;
    /** 身上贴图绘制槽（配饰审计系统性批 2026-08-22：UpdateVisibleAccessories
     *  :36324-36368 功能槽 3-9 + 社交槽 13-19 逐槽【后写覆盖前写】+ back 披风清
     *  front :36468-36471；槽值=ArmorIDs 槽序号,0=该族无贴图。染料槽 vid 对
     *  UpdateItemDye :9329-9420 的 cBack/cFront/... 逐族路由,-1=无染料） */
    accDraw: {
      back: number; front: number; shield: number; shoe: number; waist: number;
      neck: number; face: number;
      /** face 四层路由余三槽（UpdateVisibleAccessory :37216-37230；face=base∪
       *  underHair 同字段,mask/flower/head 各独立字段=同帧可并存四件） */
      faceMask: number; faceFlower: number; faceHead: number;
      balloon: number; balloonFront: number;
      handOn: number; handOff: number; beard: number;
      backpack: number; tail: number;
      dyeBack: number; dyeFront: number; dyeShield: number; dyeShoe: number; dyeWaist: number;
      dyeNeck: number; dyeFace: number; dyeFaceMask: number; dyeFaceFlower: number; dyeFaceHead: number;
      dyeBalloon: number; dyeBalloonFront: number;
      dyeHandOn: number; dyeHandOff: number; dyeBeard: number;
      dyeBackpack: number; dyeTail: number;
      /** ★BJ423：cFloatingTube（浮游圈 4404 专染料通道,UpdateItemDye :9815-9818——
       *  非槽族不走 accDrawSlotsOf 路由,功能/社交两环直写；-1=无染料） */
      dyeFloatingTube: number;
    };
    /** 配饰仇恨轴合计（ApplyEquipFunctional aggro ±400：3015 恶臭香氛/3991 奥术花/
     *  4005 侦察瞄准镜/4006 潜行箭袋 -400(:14098/:13992/:14064/:14067)，
     *  3016 血肉指虎/3992 狂战士手套/3998 英雄盾 +400(:14109/:13999/:14029)。
     *  ★审计台账"1300"有误——1300=Rifle Scope,1456 反编译无 aggro 赋值,以源码为准） */
    aggroAcc: number;
    /** 甲件 aggro 轴（终零波批 2026-09-01,GrantArmorBenefits :13201 逐槽循环）：
     *  龟甲三件 1316/1317/1318 各 +250(:13852-54)、甲虫头/腿 2199/2202 +250、
     *  壳胸 2201 +400(:13871-74)、日曜三件 2763/2764/2765 各 +300(:13983-97) */
    aggroPiece: number;
    /** 语音饰品槽（PlayHurtSound/PlayDeathSound 的 voiceOverride,Player.cs:1689）：
     *  ApplyEquipFunctional :14487-14491（!hideVisibleAccessory 门内）+ ApplyEquipVanity
     *  :14337-14341（社交槽无门）逐槽 voiceSlot!=0 直赋=后写覆盖前写;0=无 override。
     *  消费端 PlayerVoice.hurtVoicePlan/deathVoicePlan（受击/死亡分派最高优先层) */
    voiceOverride: number;
    // ↑省弹四档独立旗（原版 Player 四布尔字段，PickAmmo :52791-52804 逐档各掷一次
    //  Next(N)==0——huntressAmmoCost90 1/10 女猎手 3804/水晶忍者胸 4983、
    //  chloroAmmoCost80 1/5 叶绿头盔 1002、ammoCost80 1/5 蘑菇矿胸 1549/化石套/女猎
    //  旧衬衫 3878、ammoCost75 1/4 星旋胸 2758。旧单 denom 聚合会漏并戴时的第二次掷）
    ammoSaveHuntress: boolean; ammoSaveChloro: boolean; ammoSaveCost80: boolean; ammoSaveCost75: boolean;
    magmaStone: boolean;   // 近战命中点燃（岩浆石/火焰护手；StatusNPC:10866/Player.cs:6184）
    titaniumStorm: boolean;   // 钛金全套 on-hit（ArmorSetBonuses.cs:222-225;Player.cs:6927-6936）
    /** 蜂巢背包 3333（ApplyEquipFunctional :15457-15459 currentItem.type==3333 →
     *  strongBees）——beeType() 50% 弹 566 巨蜂/beeDamage 强蜂 +Next(1,3)/
     *  beeKB 0.5+KB×1.1（:12505-12531）；消费端 Game.ts 1121 蜂枪 volley 分支 */
    strongBees: boolean;
    quiver: boolean;
    moltenQuiver: boolean;
    arrowStack: number;      // 箭袋 additiveStack（仅箭，:14785）
    shroomiteType: 'arrow' | 'bullet' | 'rocket' | null;
    shroomiteSet: boolean; vortexSet: boolean; nebulaSet: boolean; beetleOff: boolean;
    beetleDef: boolean;
    /** R27：陨石套 spaceGun（ArmorSetBonuses.Add :436 "ArmorSetBonus.Meteor" =
     *  头123/胸124/腿125 → player.spaceGun :266-270）——Space Gun/Zapinator/钉枪
     *  无限蓝（ItemCheck_PayMana_ShouldSkipManaUse :53331 + ApplyManaRegenDelay
     *  :51198 两消费门） */
    spaceGun: boolean;
    wolfAcc: boolean; boc: boolean;
    tileSpeed: boolean; wallSpeed: boolean; tileRange: boolean; pStone: boolean;
    autoPaint: boolean;    // 喷漆器族 2216/3061/5126：放置后自动上漆（:14720-14734）
    chiselSpeed: boolean;  // 古凿 4056/5126：pickSpeed-0.25（:12610-12612/:13981）
    hasDeadCellsDownDash: boolean;   // ★BJ534：重锤符文 5465 下砸装备源（ApplyEquipFunctional case 5465 :14498-14501）——
                                     //   消费 = JumpMovement flag13 触发腿（:20895-20898,干/湿两路由）
    toolbelt: boolean;     // 工具腰带 407：装备生效 blockRange+1（:14873-14876）
    flowerBoots: boolean;   // 花靴 3017/仙灵靴 3993（Player.cs:12688 行走生花）
    stepStool: boolean;     // 折叠凳 4341/造物之手 5126（:14077-14080 HasAStool,HeightBoost 26）
    /** 配重球物品 id（Player.counterWeight，int——0=无；556-561 彩色/1079 黑）：
     *  悠悠球袋族装备映射（UpdateEquips :14174-14226），Counterweight() 消费 */
    counterWeight: number;
    /** 悠悠球袋(3366/5541):配重球颜色在使用端掷(rollYoyoCounterweight,
     *  原版 :14176/:14200 每帧重掷=使用期随机;曾放 getter 每访问掷,记忆化时迁出) */
    yoyoBag: boolean;
    /** 虚荣配重球 id（Player.vanityCounterWeight，ApplyEquipVanity :13800-13803：
     *  社交槽 13-19 彩色配重球 3309-3314 → 556+vid-3309；黑球 5547 无虚荣档） */
    vanityCounterWeight: number;
    /** 悠悠球手套（3334/3366/5541 → Player.yoyoGlove，:14187/:14211/:14225）：
     *  悠悠球命中时掷同型二号球（Counterweight() :11973 手套分支） */
    yoyoGlove: boolean;
    /** 魔法线（5540/5541 → Player.magicString，:14196/:14213）：松手回收时
     *  原球转 -3 隐身幽灵 + 掷 75% 伤/击退的脱离态克隆（AI_099 :65110-65116） */
    magicString: boolean;
    manaMagnet: boolean; magicCuffs: boolean; manaFlower: boolean;
    manaRegenBonus: number; manaRegenDelayBonus: number;
    setBonus: ArmorSetBonus | null;   // ARMOR_SET_BONUSES 表值(activeArmorSetMatch 非 summonSetOnly 投影)
    manaCostMul: number;
    // ---- 召唤师链（vanillaSummonStats：ApplyEquipFunctional type if-chain 1:1）----
    minionSlots: number;   // maxMinions += N（散件+套装合计）
    minionDmg: number;     // minionDamage += X（加算乘区，散件+套装合计）
    minionKB: number;      // minionKB += N
    sentrySlots: number;   // maxTurrets += N
    // ---- 1457 鞭 tag 栈族（ApplyEquipFunctional :13068-13083 + :14615-14648）----
    maxTagEffects: number;   // Player.maxTagEffects（:1187,默认 1;6156/6158/6159 系各 +1,满配 4）
    tagEffectDuration: number; // Player.tagEffectDuration（:1189,默认 1f;6156 系 +2f → ×3）
    accSnakeBand: boolean;   // Player.accSnakeBand（:1191;6157/6162/6186——每 3 挥中段补挥下一把鞭）
    accWickedArmlet: boolean;  // Player.accWickedArmlet（:1197;6159/6163/6179/6182——出鞭击退+1 :49159）
    fishingSkill: number;  // fishingSkill 合计（钓具+渔夫甲+软糖虫）
    /** 钓具箱族 accTackleBox（2375/3721/5064 :14123-14140）：鱼饵消耗分母 +1（:51645，Bobber 消费） */
    fishingTackle: boolean;
    /** accFishingLine（2373 高测钓线/3721 渔具袋/5064 防熔渔具袋 :14759/:14779/:14785）——
     *  收竿 1/7 断线免疫（PLA57:53076-53079）R14-E6 */
    fishingLine: boolean;
    /** 岩浆钓族 accLavaFishing（4881/5064 :14127-14140）：岩浆钓门（:19230，Bobber 消费） */
    lavaFishing: boolean;
    /** 皇家凝胶 3090（:14144-14168）：23 类史莱姆 npcTypeNoAggro（Enemy 索敌门消费） */
    royalGel: boolean;
    /** 耗魔【加算】折扣合计（manaCost 从 1f 逐项减：魔力花 0.08 :14040 + 大自然的恩赐
     *  223 0.06 :14561-14563）——消费端 (1 - manaCostOff) × manaCostMul，对齐原版加算语义 */
    manaCostOff: number;
    /** 工具箱 1923（:14405-14408 tileRangeX/Y 各 +1；与 2215 族 +3/+2 叠加，Game.inTileRange 消费） */
    toolboxRange: number;
    /** 机械透镜 3619（:12400-12402 InfoAccMechShowWires）：装备即显电线（Game showWires 消费） */
    mechShowWires: boolean;
    /** 加压器 3624（:14746-14748）：放置实心瓦自动上致动器（Game tryPlace 消费 :39977-40010） */
    autoActuator: boolean;
    /** 荧光体 5107（:26188-26194）：地面 acc×1.75/maxRun×1.15/accRun×1.15/slowdown×1.75 */
    magiluminescence: boolean;
    /** 冰冻护盾族（1253/3997 :14348-14351）：半血挂 buff 62 IceBarrier（fixedUpdate 消费） */
    iceBarrierAcc: boolean;
    /** 植物纤维绳索宝典 3068（Player.cordage :1016,UpdateEquips :14461-14463 装备置位）：
     *  割藤 52/62/382 时 1/2 掉藤绳 2996（WorldGen.cs:65087-65092 GetPlayerForTile
     *  .cordage 门）——D-4 效果端（物品 3068 已注册,效果链曾全仓未接） */
    cordage: boolean;
    /** 玫瑰族 lavaRose（1323/908/4003/4004/5000）：岩浆伤 80-45/OnFire 420-210（:27384-27387） */
    lavaRose: boolean;
    /** ★Notes④ Ash Wood 全套（头 278/胸 246/腿 234——1456 UpdateArmorSetsOld
     *  :15772-15775 赋位；1457 消费位 :27885/:27904）：remix 岩浆档 145+半减、
     *  OnFire−210，与玫瑰并持 = 完全免疫岩浆 */
    ashWood?: boolean;
    /** 浮漂饰品弹型覆写（Player.overrideFishingBobber :1920；-1=无，986-993=5139-5146） */
    overrideFishingBobber: number;
    runAccMul: number; maxRunMul: number; runSlowMul: number;   // 暗影套移动四参数(:26195-26201)
    enduranceEq: number; solarSet: boolean;
    /** 叶绿水晶叶套装（台账 L3 清偿批 2026-08-31；ArmorSetBonuses.cs:128-146 四头
     *  变体 AddBuff(60,5)+setChlorophyte——引擎 entities/ChloroLeafCrystalProj.ts,
     *  buff 维护/锚体对账位在 fixedUpdate） */
    crystalLeaf: boolean;
    shieldItem?: boolean;   // 日曜套(:16224-16295)
    whipRange: number;     // whipRangeMultiplier += X
    whipSpd: number;       // 鞭 useTime 倍率（黑曜套 1/1.15）
    /** 召唤套装通道（BJ147 组D：SUMMON_SET 并入 vanillaArmorSets 单表——本通道 =
     *  单表命中条目的召唤字段族投影,无召唤字段的套恒 null=既有正确面） */
    summonSet: ArmorSetBonus | null;
    // ---- 呼吸族（GrantArmorBenefits/ApplyEquipFunctional 行为型）----
    divingHelm: boolean;   // accDivingHelm（Player.cs:12829/14652）：breathCDMax ×6
    merman: boolean;       // accMerman（:15019/14587/14855）：水中不耗气
    arcticDivingGear: boolean; // 1861（:14701）：专家雪原冷水 Chilled 免疫（:27692）
    jellyfishGlow: boolean;    // 1860（:14682-14688）：浸水发光
    // ---- 组A/B 单件旗面（GrantArmorBenefits 甲件行为旗,2026-09-18 批）----
    nightVision: boolean;   // 3109 夜视头盔/4008 超亮头盔（:13408-13411 nightVision=true）——
                            // 消费端 Game.updateLightDecay（LightingEngine.cs:184/LegacyLighting
                            // :949 衰减 ×1.03,与夜枭药水同源）
    moonLordLegs: boolean;  // 5001 月亮领主腿（:13215-13219 moveSpeed+0.25 走 accfx;旗面
                            // :19731-19734 jumpSpeedBoost+1.8/extraFall+10/jumpHeight++——
                            // ★BJ220 jumpSpeed+1.8 走甲件主属性环 accfx '5001'.jumpSpd→
                            // jumpSpd 聚合位（起跳/翼飞 JS/火箭脉冲同源）;extraFall+10 走
                            // 下方 extraFall 聚合;jumpHeight++ 走 jumpBaseSnapshot ticks）
    slowFall: boolean;      // 3770 神灵诅咒（:13360-13362）——下落重力 /3（悬升 /10）+
                            // 终速钳 maxFall/3（/10）+ fallStart 逐帧重置免摔（:27224/
                            // :27571/:25576——与羽落 buff 8 同一 player.slowFall 字段并集,
                            // 消费端 fall 段三处 `buffs.slowFall || equipStats.slowFall`）
    pickSpeedOff: number;   // 挖矿速度折扣池【加算】（Mining 套 pickSpeed-0.1 :299-303 +
                            // 单件 410/411/5589/5590 各 -0.1 :13944-13947;消费端
                            // Game.pickSpeedMult,镜像 manaCostOff 加算池语义）
    // ---- 1457 新配饰行为旗（ApplyEquipFunctional case 6166-6189 :14596-14739）----
    accSentryBackpack: boolean;      // 6172/6175/6176/6177（:14613/:14671/:14679/:14683）
    accGolemSentryBackpack: boolean; // 6176 TemplarSling（:14680）——sentry/SentryShot 10% 强制暴击
    accHarpyCharm: boolean;          // 6166/6180/6181（:14598/:14695/:14700）——弧线引矢
    accSeraphNecklace: boolean;      // 6180（:14697）——引矢冷却 ×0.8（:28671-28673）
    hasPhoenixQuiver: boolean;       // 6181（:14701）——引矢标记箭 PhoenixQuivered（命中 323/300）
    accSnappingStone: boolean;       // 6167（:14601）——远程命中脉冲
    accPyroclast: boolean;           // 6178（:14688）——近战命中脉冲（45 伤/300px/323）
    accArmletOfRuin: boolean;        // 6179（:14692）——tag 命中脉冲（150 伤/400px）
    accPoisonBarb: boolean;          // 6165/6184/6185（:14610/:14717/:14722）——箭 100% 中毒 90t
    accHoneyedBarb: boolean;         // 6184（:14718）——箭命中 20% 放蜂
    catalystBand: boolean;           // 6185（:14724）——命中 398 AcceleratePoisons 300t
    accSharpBarb: boolean;           // 6160（:14607;rangedCrit+8 走 accfx 主链,旗登记）
    ammoCyclerMode: number;          // 6168/6169/6193/6194（:14635-14648）PlayerAmmoCyclingMode
    mysticSashDodge: boolean;        // 6189（:14739）——受击闪避（批 1 段登记位）
    accTimerCrit: boolean;           // 6170（:14604——消费端 Game 近战 tryConsumingTimerCrit 已接）
    shinyStone: boolean;             // 3337（:14874-14876）——生命再生 ×1.1 + 静止整段
    /** ★SW-FX1（2026-09-09）单件批四旗——全部 UpdateEquips if-chain 装备位：
     *  jellyfishNecklace 1303（:15339-15348 双支 AddLight !wet 0.225/0.05/0.15、
     *    wet 1.8/0.4/1.2——与 1860 :15343-15358 同值对,消费 Game 光照段）；
     *  boneGlove 3245（:14660-14662 boneGloveItem=currentItem;挥击掷骨弹 532
     *    25 伤 5 kb 10 速 60t 冷却 :43961-43968,Game tick 段承载）;
     *  sporeSac 3336（:14884-14886 SporeSac(currentItem)+sporeSac——1/15 每拍掷
     *    孢子云 567/568（AI_105),云寿加速旗在 AI_105 :40874 读 player.sporeSac）;
     *  volatileGelatin 4987（:14888-14890 VolatileGelatin+volatileGelatin——
     *    40t 计数掷 937 凝胶弹 65 伤 7 kb :42820-42857） */
    jellyfishNecklace: boolean;
    boneGlove: boolean;
    sporeSac: boolean;
    volatileGelatin: boolean;
    /** ★BJ216 翱翔徽章 4989（:14877-14881 empressBrooch=true;moveSpeed+0.075 走 accfx
     *  '4989'.move→moveMult 已接）——消费端四面：①:19721-19724 jumpSpeedBoost+1.8
     *  → jumpSpeed 字段同喂起跳/翼飞 JS/火箭脉冲三端（本仓=accfx '4989'.jumpSpd 手补
     *  1.8→eqM.jumpSpd 聚合,jumpBaseSnapshot 与翼飞 JS 同源生效）;②:22419-22422
     *  WingMovement 扇动消耗后 `wingTime != 0f` 即回满 wingTimeMax = 无限飞行
     *  （含喷气 -2 档/hover ×0.5 档;原版无湿态/悬浮/坐骑豁免——湿链 WingMovement 同吃）；
     *  ③:26702-26713 runAcceleration×1.75（★BJ665 勘正 伪锚 :26698-26700;无 vy/坐骑门,钩爪/舌头支外）；
     *  ④:27063-27065 rocketTime 恒回满 7（无门,无靴态也置 7=原版同,
     *  消费端全带 rocketBoots 门故惰性） */
    empressBrooch: boolean;
    /** 老猩红甲套装（Crimson,ArmorSetBonuses.cs:433 items 792/793/794=槽 57|37|35）：
     *  再生三面（1458 :19233 eRT+1、:19362 num5×1.5、:19412 脉搏回血红粒十粒/HP）。 */
    crimsonRegen: boolean;
    /** ---- 硬模式矿族 on-hit 三套（终零波批 2026-09-01,vanillaArmorSets 表收编位：
     *  ArmorSetBonuses.cs :216-236 Palladium/Orichalcum/Hallowed(·Summoner)——
     *  OnHit 生效链全部在 Enemy.hurt fromPlayer 段（钛金同位次区）消费 ---- */
    /** 帕拉钯全套（:217-220 Palladium→onHitRegen）：OnHit AddBuff(58,300) 快速再生 */
    onHitRegen: boolean;
    /** 山铜全套（:222-226 Orichalcum→onHitPetal)：OnHit 花瓣弹 221,petalTimer 共享窗 20t */
    onHitPetal: boolean;
    /** 神圣套/神圣召唤套（:228-236 Hallowed·HallowedSummoner→onHitDodge）：OnHit
     *  shadowDodgeTimer==0 门 → AddBuff(59,1800) 幻影闪避（Hurt 第四闪避支来源链） */
    onHitDodge: boolean;
};

export class Player extends Entity {
  w = 20; h = 42;        // 原版 Player 构造(Player.cs:55083-55084 width=20 height=42;
                         // ResizeHitbox :28744 同值)。曾 16×39(窄 4px 矮 3px)——
                         // 精灵帧 40×56 已对齐,盒偏小导致判定区比视觉小一圈
  facing = 1;            // 1 右 -1 左
  baseMaxHp = 100;
  baseMaxMana = 20;   // 原版 statManaMax2 起步 20,坠落之星 +20/颗(上限 200)
  mana = 20;
  /** 奥术水晶（item 5339 使用后永久旗标，Player.cs:44780-44783）——本仓 5339 尚无使用
   *  链路，恒 false；接使用系统后置 true 即自动进回复模型（:19242/:19259） */
  usedArcaneCrystal = false;
  /** 神盾果 5338(:44776)→ statDefense += 4(UpdatePermanentBoosters :12447) */
  usedAegisFruit = false;
  /** 神盾水晶 5337(:44769)→ lifeRegenTime +0.2/tick 爬坡加速(:18931) */
  usedAegisCrystal = false;
  /** 软糖虫 5341(:44790)→ fishingSkill += 3(:12451) */
  usedGummyWorm = false;
  /** 仙馔蜜酒 5342(:44796)→ pickSpeed/tileSpeed/wallSpeed ±0.05(:12455) */
  usedAmbrosia = false;
  // ChaosState(88) 已走 buffs 真实装（BuffType.ChaosState=83；混乱之杖 Game 侧
  // case 1326 的 has/apply 门）——旧"独立冷却字段"近似已退役（2026-08-15 销项）
  /** 魔力蓄能（Player.manaRegenCount :1824，UpdateManaRegen :19274 累积 ≥120 +1 魔） */
  manaRegenCount = 0;
  /** 用魔惩罚期（Player.manaRegenDelay :1826，float）：>0 时每帧产额 0（:19270-19271） */
  manaRegenDelay = 0;
  /** 用魔物品动画窗剩余 tick（itemAnimation>0 期每帧重置 delay，:42131-42137） */
  manaAnimTicks = 0;
  // ---- 1457 ManaHeat 魔力过热族（Player.cs:961-967 字段声明）----
  /** Player.slowMagicUse（:961）：蓝空过载施法标记——DebugOptions.ManaV2 默认 true
   *  （Testing/DebugOptions.cs:30）→ release 正式机制。置位 = CheckMana 蓝不足分支
   *  :53241-53256 → DoRunOutOfManaEffect :53258-53261（空蓝照放+攻速 ×0.4）；
   *  每次施法入口 CheckMana :53217 先清、喝蓝药 UndoSlowMagicUse :52585 清 */
  slowMagicUse = false;
  /** Player.yoyoHitCounter（:1203，初始 -1）：EverySomeYoyoHits 共享命中计数器——
   *  仅悠悠球 per-hit 族（545/546/554/555）命中时经 everySomeYoyoHits() 自增 */
  yoyoHitCounter = -1;
  /** Player.manaHeat（:963）：魔法伤害乘区，ResetEffects 每帧清 1f（:18709），
   *  UpdateBuffs buff 396 段累加（:10416-10429） */
  manaHeat = 1;
  /** Player.latestManaPotionDamageBonus（:965）：最近一次 ManaHeat 源的功率 */
  latestManaPotionDamageBonus = 0;
  /** Player.latestManaPotionDuration（:967）：最近一次 ManaHeat 源时长（tick） */
  latestManaPotionDuration = 0;
  /** Player.chlorophyteBladeCounter（1457 新字段，叶绿巨剑 1226 三连击计数——
   *  ItemCheck :43161-43163 每帧递减，ItemCheck_Shoot :49406 奖励击后 += itemAnimation×3） */
  chlorophyteBladeCounter = 0;
  /** 调试：无敌 + 无限魔力（F2 切换，原版无）——damage() 早退 + 每 tick 血蓝回满
   *  （回满兜住 DoT/溺水/摔落等直改 hp 的路径）。仅本地调试语义，不入存档 */
  debugGod = false;
  shieldRaised = false;      // 格挡盾举起(:31263)
  shieldParryTimeLeft = 0;  // 格挡窗口(:30981 >0 面敌免疫+反伤2×)
  shieldParryCd = 0;        // 降盾冷却(:31276 15t)
  /** ★R2-H2 桥（蓝队二轮，跨界最小补——接触反伤区由并行段已写入本旗，
   *  编译面必须落字段）：盾反成功 → 下次近战命中 ×5 并清旗
   *  （Player.cs:31668 AddBuff(198,300) / :44662-64 消费；buff198 枚举未建模，
   *  以「旗 + 倒计时」承载。倒计时推进点在 Game.updateSwingHits 管线序章） */
  parryDamageBuff = false;
  parryDamageBuffT = 0;
  /** 盾反就绪提示待播（Player.cs:31955-31963 cd 归零拍播 MaxMana+橙尘×10）。
   *  置位在 damage()（本仓盾冷却递减所在,无 game 钩子）,fixedUpdate 消费——
   *  bocPulse 同款延一拍模式 */
  parryReadyCue = false;
  /** 玩家对决开关（Player.cs:2436 hostile，会话态不存档——仅网络同步，进服默认 false） */
  hostile = false;
  /** 队伍 0-5（Player.cs:1312 team，PlayerTeamID：0 无/1 红/2 绿/3 蓝/4 黄/5 粉紫；存档持久） */
  team = 0;
  /** 发色剂槽（Player.cs:2412 hairDye byte——染料 shaderId 1..12，0=无/去除剂清除；
   *  使用发色剂物品赋值 Player.cs:42179-42186，随存档持久化 :53805-53808）。
   *  原版无装备槽位——使用即换色，清除走 1990 去除剂 */
  hairDye = 0;
  /** 热键栏锁定（SW-FX10 债⑪；Player.hbLocked :1419——DrawHotbarLockIcon Main.cs:43231
   *  点击切换 + PlaySound(22)；锁定后关包快捷栏格不响应鼠标（Main.cs:44353 hover 门
   *  /:44357 changeItem 门），数字键 1-0 照常）。.plr 持久化 PL:55543 写/:56268 读 */
  hbLocked = false;
  /** 超级矿车开关（SW-FX10 债⑩；Player.enabledSuperCart :2037 缺省 true——矿车升级
   *  套件解锁(unlockedSuperCart)后可切换；消费面 UsingSuperCart :3955-3961 =
   *  unlockedSuperCart && enabledSuperCart（Mount.cs:4851 _shouldSuperCart）。
   *  .plr 持久化 PL:55572 位 [1] 写/:56368 位 [1] 读；杂项页开关 Main.cs:41963-41995） */
  enabledSuperCart = true;
  /** 建筑配件开关位（SW-FX19 债；Player.builderAccStatus[BuilderAccToggleIDs.Count=12],
   *  Player.cs:797/40-63——0 RulerLine / 1 RulerGrid / 2 AutoActuate / 3 AutoPaint /
   *  4-7 WireVisibility RGBY / 8 HideAllWires / 9 WireVisibility_Actuators / 10 BlockSwap /
   *  11 TorchBiome）。0=开 1=关（二态位）；4-7/9 四态（0 Bright/1 Normal/2 Faded/3 Hidden）。
   *  ★ResetData 缺省 [0]=1（Player.cs:56749——标尺线默认【关】,1.4.4+ 同款）、其余 0。
   *  开关 UI=背包左侧图标列（Main.cs:48142-48377 DrawBuilderAccToggles @(10,77) 24px 步距
   *  + 方块替换图标 (:43242 @(0,44)) + 群系炬图标 (:43282 @(0,68))）；
   *  .plr 持久化 PL:55553-55555 写/:56306-56325 读。 */
  builderAccStatus: number[] = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  /** 上一 tick PvP 死亡标记（Player.cs:1250 pvpDeath：KillMe 时若 pvp 置位——
   *  死亡不掉钱 + 复活满血/300t 无敌/跳过 Boss 延迟，:38208/:38321/:37223/:38388） */
  lastPvpDeath = false;
  hp = 100;
  /** 最近一次伤害死因（PlayerDeathReason 语义子集）——死亡瞬间由 Game 消费生成原版死亡文本 */
  lastDamageCause: import('../i18n/RandomText').DeathCause | null = null;
  /** 上一 tick 石化态（:24941 lastStoned——变身过渡检测） */
  lastStoned = false;
  inv: Inventory;
  /** 玩家储物（原版 Player.cs:1468-1474 Chest.CreateBank(-2..-5)，各 40 槽）：
   *  [0]=bank 存钱罐(29) / [1]=bank2 保险箱(97) / [2]=bank3 守护者熔炉(463) /
   *  [3]=bank4 虚空保险库(491)——右键绑定见 Player.cs:32598+。内容随玩家存档，
   *  方块破坏不丢内容（原版同语义，掉落回收 place_v_ 物品） */
  banks: Array<Array<{ id: number; stack: number; /** 重铸词缀（Item.prefix，0/缺省=无）——★F2：虚空袋空位落格整件随行须带（Player.cs:39845） */ prefix?: number; /** ★SW-AY1 R7：收藏标记——虚空保险库(-5)语境 32 ∈ retainFavoriteOnMoveAt（ItemSlot.cs:365）/canFavoriteAt[32]（:361），存档随行（SavedItem.favorited） */ favorited?: boolean } | null>> = [
    Array(40).fill(null), Array(40).fill(null), Array(40).fill(null), Array(40).fill(null),
  ];
  buffs = new BuffState();
  /** ★BJ579 狱火药水火圈状态（原版 Player.cs:931/:933 字段;推进=Game fixedUpdate
   *  buff 116 块内 advanceFlameRing——DrawInfernoRings :65262-65285 draw:Update 1:1@60
   *  → 每 60t 一次;渲染纯消费）。无重置面（原版 ResetEffects 零消费）=buff 消失
   *  相位残留、重新喝药续相（照抄）。flameRingFrame/flameRingAlpha（:935/:937）
   *  原版零消费死字段不抄。 */
  flameRingRot = 0;
  flameRingScale = 1;
  /** 角色外观（来自角色系统；渲染层 M7 切换 PaperDoll 时使用） */
  appearance?: import('../player/Appearance').Appearance;
  /** 语音分派入参聚合（PlayerVoice.VoiceState——PlayHurtSound :38867-39011/
   *  PlayDeathSound :39013-39041 的本仓入参面）：appearance 三字段
   *  （skinVariant/voiceVariant/voicePitchOffset,后两者随角色档持久化)+
   *  equipStats.voiceOverride（语音饰品装备聚合）。受击/死亡播声点统一取此 */
  get voiceState(): VoiceState {
    return {
      skinVariant: this.appearance?.skinVariant,
      voiceVariant: this.appearance?.voiceVariant,
      voicePitchOffset: this.appearance?.voicePitchOffset,
      voiceOverride: this.equipStats.voiceOverride,
    };
  }
  iframes = 0;
  jumpHold = 0;          // 长按跳跃剩余加速 tick
  /** 游泳划水动画计时（Player.swimTime :2634——脚蹼水中跳/人鱼按住刷新 30，
   *  PlayerFrame :35307-35312 每帧 -1；帧档 0/5/0 三段 :36098-36118。仅动画语义，
   *  本仓渲染未消费——状态位保留） */
  swimTime = 0;
  inWater = false;
  /** WorldGen.InAPlaceWithWind(中心格) 每 tick 缓存（Player.fixedUpdate 头刷新）——
   *  扫帚坐骑挂件摆幅的露天 1f/室内 0.5f 档（Mount.cs :3597-3602）渲染端消费 */
  mountWindExposed = false;
  /** 出入水 10t 去抖（Player.wetCount，1457 :27986/:28080 置 10、:28169-28171 每tick 递减、
   *  :37921 重生清零；1456 = :27464/:27558/:27649/:37203）——水波涟漪尺寸因子
   *  （WaterShaderData.cs:263 h·wetCount/9）+ 出入液溅花门（:27984/:28078） */
  wetCount = 0;
  // ---- ★用户明令分歧 2026-09-14「唇入必响」（超越原版）——表层掠水反馈三件套 ----
  // 判例 = smart-cursor-dark-visibility-user-divergence（用户拍板动刀+分歧标注+回滚口单点）。
  // BJ79 定谳的唇缘水袋几何静默（1 格宽满水袋嵌半砖唇缘间，湿探针盒底差 2.06px 够不到
  // 液面→左入 0/9 翻转静默，tests/bj79-lip-pocket-wet-parity）被用户裁决为 bug：任何
  // 入水姿态都应有入水声+波纹。反馈与状态解耦：湿/游泳状态（wetCollision 探针）原版
  // 1:1 不动，本支只在其【干】时按脚位带液面接触的上升沿复用同一 splash 路径。
  /** 回滚口（运行时单点闸）：false = 摘除掠水反馈支，BJ79 原版几何静默语义原样恢复。
   *  摘除式回滚 = 删本字段 + surfaceSkimSplashFeedback 方法 + 其唯一调用行 + 本区两计数器。 */
  static SURFACE_SKIM_SPLASH = true;
  /** 掠水 anti-spam 冷却（镜像 wetCount :28169 递减语义：置 10、每拍 −1、门 ===0）
   *  ——连走多格水袋防逐格连响，跨袋间隔 >10t（vanilla 溅花再入门同窗）可再响 */
  private _skimSplashCooldown = 0;
  /** 脚位带液接触上升沿检测（上一拍接触值；被门拦下的边沿即消费——冷却窗内新袋静默） */
  private _skimContactPrev = false;
  /** 原版 wet 湿粘滞位（Player.cs:27872 flag23/:27982 `if (!wet)` 读、:28060 num86 支内
   *  置真、:28071 `else if (wet)` 支首置假、:28160 拍末 `if (!wet)` 清偿读）——溅花块
   *  出入水翻转的【唯一驱动】。★BJ89 定谳：原版 wet 只由 num86（WetCollision 居中
   *  探针，任意液体）驱动；旧实现以 inWater∪inLava∪inHoney∪inShimmer 四桶并集近似，
   *  其中 inLava 是全盒 LavaCollision——「探针干+全盒岩浆擦过」姿态下并集为真而
   *  原版 wet 为假 → 出浆分支幻影发射（bj80 域外观察坐标，实测 1 条 Splash）。
   *  ★RB21（2026-09-15）：private 摘除——F6③ 后 MountCombat.tickSlimeWetState 跨模块
   *  消费本位（结构参数同名遇 private=TS2345），按 wetSlime 先例转 public,零运行时差。 */
  wetSticky = false;
  /** 原版 lavaWet 粘滞镜像（Player.cs:27872 flag24 / :27883 lavaWet=flag25 / :28164 !wet 清）
   *  ——溅花液型门专用：入水门=本拍 flag25（:27989）、出水门=上拍值（:28083）。
   *  与 inLava 桶位分离：inLava 无 :27878 的 !shimmering 门且消费面更广（灼烧/Wet 剥离）
   *  ★BJ652 件3：private 摘除——wet 灭火门（Game.updateUse,Player.cs:52751
   *  `wet && !lavaWet`）跨模块消费本位，按 wetSticky/RB21 先例转 public,零运行时差 */
  splashLavaWet = false;
  /** ★BJ705-G26 件3（[g20-buff305-lavavision] 清偿）:熔岩潜水镜渐变字段
   *  （Player.cs:1517 `public float lavaOpacity = 1f`）。渐变斜坡见湿段
   *  UpdateBuffs :12140-12153 锚注;消费=Renderer 液体三面（drawVanillaLiquids
   *  岩浆 run α ×lavaOpacity ≙ LiquidRenderer.cs:659 case 1 / drawLiquidBehind
   *  TilesOnly 基线+地表覆写门 ≙ TileDrawing.cs:4116/:4125）。public=渲染侧
   *  跨模块读位（Renderer 帧头快照）,按 splashLavaWet/RB21 先例。 */
  lavaOpacity = 1;
  /** 原版 shimmerWet 粘滞镜像（:27943 置位 / :28161 !shimmer 清 / :28164 !wet 清）
   *  ——inShimmer 桶位是当拍即时值,溅花需要跨拍粘滞（出水拍读上拍液型） */
  private splashShimmerWet = false;
  /** 原版 honeyWet 粘滞镜像（:27957 置位（!shimmering 门）/ :28155 !flag27 清 / :28164 !wet 清）
   *  ——inHoney 桶位混入 :3416 二次盒查询（"任一含蜜"≠原版 WetCollision 首中语义）,不作溅花源 */
  private splashHoneyWet = false;
  /** 史莱姆坐骑湿态（Player.wetSlime，1457 Player.cs:1538 / 1456 :1472）：骑史莱姆族
   *  坐骑（3 粘粘鞍/50 史莱姆皇后）浸液置 30、每 tick 递减；>0 期间压制 JumpMovement
   *  的弹跳踩踏循环（:20693 门）+ 起跳瞬间清除（:28108-28114，出水跳门）。滴答/
   *  浮力档 = MountCombat.tickSlimeWetState（液体解析段调用） */
  wetSlime = 0;
  /** ★附带① 出水截跳（Player.cs:28074 `if (jump > jumpHeight/5 && wetSlime == 0)
   *  jump = jumpHeight/5`）：wet 翻转 false 的帧置位（液体解析段），跳跃段尾以当帧
   *  jumpHeight 等效值（_curJumpTicksCap）的整除 5 截断剩余跳预算；wetSlime>0 豁免 */
  private _wetExitJumpClip = false;
  /** 当帧 jumpHeight 等效值（mJumpTicks 终值，Player.UpdateJumpHeight 的仓内形） */
  private _curJumpTicksCap = 0;
  /** ★F5① dashType==6 生效位（Player.cs:21211-21213 dashType=6 + :21215-17
   *  dash=dashType 的仓内承载）：Chillet 坐骑（62-65，MOUNT_DASH6_TYPES）触发帧置真、
   *  滑行反向收敛/冷却/被配饰冲刺取代时清零 */
  mountDash6Active = false;
  /** ★C5-B5（2026-10-06）原版 dash 字段闩锁镜像（Player.cs:21217
   *  `if (dashDelay == 0) dash = dashType;`——:21211 mount∈{62..65}→dashType=6 在前）：
   *  仅 dashDelay==0 拍从活值（eq.dash/mountDashing6）重推导，滑行/冷却期冻结在
   *  发起拍档位。消费面=eoc 扫敌门（:21225 dash==2）、滑行阻尼参数档（:21434-21499
   *  num13-17 各 dash 覆写）、出口冷却档（:21567）——中途换装不漂移（旧式滑行读
   *  活 eq.dash=阻尼档中途换装即变,原版不可能路径）。dash==0 清双击窗面（:21221）
   *  同源。ResetEffects 清 dashType（:18775）+UpdateBuffs 结网置 0（:11966）+
   *  UpdateEquips 装备重推导（:15166-15181/:16552）的仓内净效=本字段每
   *  dashDelay==0 拍直读活值。 */
  dashLatched = 0;
  /** dash==6 语境判定：骑乘中且坐骑属 Chillet 冲刺族 */
  private mountDashing6(): boolean {
    return this.ridingMount && this.mount.active && MOUNT_DASH6_TYPES.has(this.mount.type);
  }
  headUnderwater = false;
  /** 税务员累积税款（Player.cs:792 taxMoney，铜币；对话「收集」领取） */
  taxMoney = 0;
  /** 渔夫任务完成数（Player.cs:1790 anglerQuestsFinished；随角色存档 PL:53943/54670。
   *  交付时先 ++ 再结算奖励（Main.cs:39671-39672）——奖励阶梯/稀有度系数全看此值 */
  anglerQuestsFinished = 0;
  /** PVE 死亡计数（Player.numberOfDeathsPVE，PL:53840；存档 player 段持久化） */
  deathsPve = 0;
  /** PvP 死亡计数（Player.numberOfDeathsPVP，KillMe :38228 按 pvpDeath 分道计数） */
  deathsPvp = 0;
  /** 圣骑士盾转移冷却（hurtCooldowns[ImmunityCooldownID.PaladinsShield] 槽近似,
   *  Player.cs:37756-37763——独立于常规无敌帧;Game.fixedUpdate 递减） */
  paladinShieldCd = 0;
  /** 钛金屏障 on-hit 冷却（Player.cs:6919 titaniumStormCooldown>0 门,10t） */
  titaniumStormCd = 0;
  /** 山铜花瓣/叶绿叶弹共享 on-hit 计时（Player.petalTimer :1165,OnHit :6963 花瓣=20/
   *  :7009 叶绿=50；:25652-25655 每 tick 递减——终零波批 2026-09-01 起两面共享：
   *  生产位 = Enemy.hurt fromPlayer 段 onHitPetal（Game.spawnOnHitPetals）与
   *  crystalLeaf 引援（chloroOnHitLeafStrike,petalTimer=50 先置支） */
  petalTimer = 0;
  /** 叶绿水晶叶锚体出手冷却（Player.crystalLeafCooldown :1367,Projectile aiStyle42
   *  :28254 写 40、:25664-25667 每 tick 递减——fixedUpdate 减位点在本类同段） */
  crystalLeafCooldown = 0;
  /** ★SW-FX1 骨头手套掷骨冷却（Player.boneGloveTimer :1169）：:43961 命中置 60、
   *  :25662-25664 每 tick 递减（原版递减位在 shadowDodge 之后、crystalLeaf cd
   *  之前——本类 fixedUpdate 同段承接） */
  boneGloveTimer = 0;
  /** ★SW-FX1 挥发明胶 40t 计数（Player.volatileGelatinCounter :1981）：仅装备期
   *  逐 tick 递增（VolatileGelatin :42826-42831 在 UpdateEquips 内被调,卸下即冻结
   *  不清零——1:1 保留;>40 拍清零掷 937） */
  volatileGelatinCounter = 0;

  /** 收税计时（Player.cs:793 taxTimer；taxRate=3600 即每游戏小时一结） */
  taxTimer = 0;
  /** 蜂蜜浸入（原版 honeyWet，Player.cs:27436-27438）：授予 Honey buff(48,1800t) 的来源 */
  inHoney = false;
  /** 微光浸入（原版 shimmerWet，Player.cs:27420-27424：Collision.shimmer 盒命中） */
  inShimmer = false;
  /** Player.ShouldFloatInWater（:3856-3870）：canFloatInWater 且未按下方向键
   *  （controlDown）；坐骑时仅坐骑 37 浮液。canFloatInWater 源全源码仅两处
   *  （红队 R1-F1 勘误 2026-09-03）：甲件 4404 Floating Tube（ApplyEquipFunctional
   *  :13364-67）∪ buff 265 Flamingo（UpdateBuffs 坐骑支 :9982-86）；【脚蹼药 buff 109
   *  只授 ignoreWater+accFlipper（:10257-59）不置 canFloatInWater】。buff265 =
   *  Mount 37 的坐骑 buff（Mount.cs:1801-03 mounts[37].buff=265），本仓坐骑 buff
   *  不入 BuffState（Mounts.ts 承运注释）→ 以在骑坐骑 37 等价表达——真值表同原版：
   *  仅 4404 而骑他坐骑=假（坐骑支短路）、骑 37=真、均无=假。
   *  消费：TryFloatingInFluid 浮力 :23641、湿态阻尼 :28061、accFlipper 湿授予
   *  :13115、翼帧 waterFloat（WingFrame :30456/:30724/:30732）、
   *  ShouldDrawWingsThatAreAlwaysAnimated :30971 */
  get shouldFloatInWater(): boolean {
    const canFloatInWater = this.equipStats.canFloat || (this.ridingMount && this.mount.type === 37);
    if (!canFloatInWater || this.inputDown) return false;   // :3860 canFloatInWater && !controlDown
    if (this.ridingMount) return this.mount.type === 37;    // :3862-65 mount.Active → Type==37
    return true;
  }
  /** 坐椅起身钩（TryFloatingInFluid :23646-49 isSitting → SitUp；SitUp 实现在
   *  Game.standUp（PlayerSittingHelper.SitUp 1:1），Player 无 Game 引用 → 经钩反转。
   *  未接线（测试/远端代理）= 只清 sitting 位） */
  sitUpHook: (() => void) | null = null;
  /** 微光化态（buff 353，Player.cs:11381-11388）：frozen 封输入 + fallStart 重置 +
   *  受击免疫（Hurt :37591-37595 直接 0）+ 穿墙下坠（:27868 velocity×0.375 完全
   *  绕过 tile collision；:24117-24119 gravity/maxFall ×0.9）——直到落入能容纳的
   *  空腔（盒覆盖全非实心）才实体化（:11403-11419 DelBuff） */
  shimmering = false;
  /** 微光滞留 tick（TryToShimmerUnstuck :28378：钳 0-7200，shimmering +1/否则 -10） */
  timeShimmering = 0;
  /** ShimmerUnstuckHelper 最小建模（ShimmerUnstuckHelper.cs:5-58；红队 R1-F6 2026-09-03）：
   *  TimeLeftUnstuck/IndefiniteProtectionActive 两裸位承载（原版 struct 字段）。
   *  ShouldUnstuck :11-21 消费于 AddBuff(353) 三因子门（Player.cs:27944）；StartUnstuck
   *  :47-51（indefinite+120t）由 ShimmerUnstuck 无位支 :29107-29110 调；Update :23-45
   *  （Player.cs:25843 每 tick：脱微光清 indefinite+倒计时,归零广播 ShimmerTownNPC）；
   *  Clear :53-58（UpdateDead :17041）。近不可达路径（findShimmerFreeSpot 三层兜底后
   *  仍无位）——按判定条件最小建模 */
  shimmerUnstuckTimeLeft = 0;
  shimmerUnstuckIndefinite = false;
  /** ShouldUnstuck getter（ShimmerUnstuckHelper.cs:11-21 字面） */
  get shimmerUnstuckShouldUnstuck(): boolean {
    return this.shimmerUnstuckIndefinite || this.shimmerUnstuckTimeLeft > 0;
  }
  /** Update（ShimmerUnstuckHelper.cs:23-45 字面，Player.cs:25843 每 tick 调） */
  /** ★三百四十五刀:右键使用态(C# Player.altFunctionUse;右键按住=2) */
  altFunctionUse = 0;
  /** ★三百四十八刀:mod 手持光源(holdItem 钩设置;每帧 fixedUpdateBody 头重置) */
  modHeldLight: [number, number, number] | null = null;
  /** ★三百六十五刀:mod 配饰光源(accEffect 钩设置;每帧 computeEquipStats 重算域
   *  重置——由 acc-immunes 同款 accEffect 闭包重设) */
  modAccLight: [number, number, number] | null = null;
  /** ★四百七十二刀:mod 配饰水中机动旗(DeepDiver ignoreWater=C# :12 装备期;
   *  聚合期重置+van 键形重设——liqFactor 组合面消费) */
  modIgnoreWater = false;
  /** ★四百七十四刀:mod 配饰每 tick 防御加值(AquaticEmblem 湿态爬坡=C# statDefense
   *  Remap 面;postUpdate 消费器【赋值】语义=非累积;defense 访问器消费) */
  modDefBoost = 0;
  /** ★四百七十四刀:mod 配饰无仇恨型集(AquaticEmblem 鲨鱼族 5 型=C#
   *  npcTypeNoAggro[type] 置位;聚合期重置+accEffect 整集重设——Enemy 索敌门并集) */
  modNoAggroTypes: Set<number> | null = null;
  /** ★四百八十二刀:mod 套装旗名集(ArmorSetBonus.modFlags;聚合期整集重设=卸甲即清) */
  __swSetFlags: Set<string> | null = null;
  /** ★四百九十五刀:mod 每 tick 条件伤加算面(Victide 水下系伤/条件系伤族;
   *  postUpdate 消费器【赋值】语义=非累积;damageMult 双支加算池) */
  modDmgAdd: Partial<Record<'melee' | 'ranged' | 'magic' | 'summon', number>> | null = null;
  /** ★五百零三刀:mod 装备运气加算面(C# calamityBonusLuck=OldDie +0.2/MOAB
   *  +0.05;聚合期重置+accEffect 加算——luckEquipmentBonus 现读面并入) */
  modLuckBonus = 0;
  /** ★五百四十六:mod 受伤增伤乘区(C# damageMult += CrushingEgo 0.2/Demonshade
   *  enrage;【赋值】语义=每 tick mod 侧重写,缺省 1=零扰动;damagePlayer 头乘区) */
  modTakenMult = 1;
  /** ★五百四十七:mod 输出乘区面(C# multiplicativeDamage——GenericDamageClass
   *  全系 ×N;【赋值】语义=每 tick mod 侧重写,缺省 1;damageMult 尾乘区) */
  modDmgMult = 1;
  /** ★五百五十三:mod 暴击加算面(C# GetCritChance<系> 加法池——vanilla stat face;
   *  【赋值/累加】双语义=mod 侧自管;critChance 访问器消费) */
  modCritAdd: Partial<Record<'melee' | 'ranged' | 'magic', number>> = {};
  /** ★四百七十八刀:mod 百分比生命上限面(C# CalamityPlayer :2104-2122
   *  percentMaxLifeIncrease 家族——bloodPact 25/chalice 25/affliction 10/community
   *  2-10/shatteredCommunity 10;静态=accEffect 加算(聚合期重置),动态=community
   *  CalculatePower 战勋比例(postUpdate 消费器赋值);换算 C# statLifeMax/5/20×pct */
  modMaxLifePct = 0;
  modMaxLifePctDyn = 0;
  /** ★五百七十九:mod 每帧 endurance 动态面(PSC 夜相 +0.05;C# :4174 endurance+=
   *  PostUpdateMiscEffects 每帧位——equipStats.enduranceEq=cache-period 冻结面
  *  承载不了昼夜翻转,走 dyn 台账赋值语义,消费与 enduranceEq 同口径双点) */
  modEnduranceDyn = 0;
  /** ★五百八十六:mod 岩浆完全豁免(van.lavaImmune;computeEquipStats 重置域) */
  modLavaImmune = false;
  /** ★596:mod 每帧 aggro 动态面(mirage_mirror -200;postUpdate 赋值语义) */
  modAggroDyn = 0;
  /** ★五百七十九:mod 随从上限动态面(PSC 守卫进攻加成 maxMinions+1;C# :1652
   *  Player.maxMinions++——gate=profanedSoulBuffs mod 侧每帧算;赋值语义同上) */
  modMinionAddDyn = 0;
  private shimmerUnstuckHelperUpdate(game: GameHooks): void {
    const dry = !this.shimmering && !this.inShimmer;   // flag = !shimmering && !shimmerWet（:26）
    if (dry) this.shimmerUnstuckIndefinite = false;
    if (this.shimmerUnstuckTimeLeft > 0 && !dry) this.startShimmerUnstuckHelper();
    if (!this.shimmerUnstuckIndefinite && this.shimmerUnstuckTimeLeft > 0) {
      this.shimmerUnstuckTimeLeft--;
      if (this.shimmerUnstuckTimeLeft === 0) {
        game.broadcastParticleOrchestra?.(ParticleOrchestraType.ShimmerTownNPC, this.cx, this.y + this.h);   // :37-43 player.Bottom
      }
    }
  }
  /** StartUnstuck（ShimmerUnstuckHelper.cs:47-51 字面） */
  private startShimmerUnstuckHelper(): void {
    this.shimmerUnstuckIndefinite = true;
    this.shimmerUnstuckTimeLeft = 120;
  }
  /** 微光化半透明（Player.cs:18147-18162 shimmerTransparency：shimmering +0.015/t
   *  钳 0.8；解除后 -0.015/t 回 0，衰减起始帧（恰 0.8）播 Sound 19 style 3）。
   *  渲染侧 globalAlpha = 1 - 值（GetAlpha :53253 三通道乘 (1-t) 近似） */
  shimmerTransparency = 0;
  // ---- 呼吸 1:1（Player.cs:1402-1406 / CheckDrowning :22914-23002）----
  breathMax = 200;   // :1404（全源码无修改点——潜水头盔加的是 breathCDMax ×6 非 breathMax）
  breath = 200;      // :1406（显示侧气泡数 = breathMax/20 = 10）
  breathCD = 0;      // :1402（每 tick +1，≥breathCDMax 时 breath--）
  /** 传送后环境 buff 免疫窗（Player.environmentBuffImmunityTimer :1341；写位唯一 =
   *  Teleport :37701 →4,每 tick 递减 :24778——消费位=专家雪原冷水 Chilled 门
   *  :28209 `environmentBuffImmunityTimer == 0`。★终零波批（2026-09-01）实装:
   *  旧注"十字盾族第 6 门未实装恒 0"系门源误标——该 timer 与十字盾无关,是
   *  Teleport 的环境免疫窗。仓内 Teleport 等价位=shimmerUnstuck(微光脱困传送) */
  environmentBuffImmunityTimer = 0;
  /** 原版 itemAnimation 等效（>0 = 挥舞动画中）：芦苇管换气门禁（:22920/:3698）
   *  用。Game.fixedUpdate 每帧注入（swing 在 postUpdate 递减，读到的是上一帧尾值，
   *  ≤1 tick 偏差，注释存档） */
  itemAnimTicks = 0;
  /** 原版 heldProj（Player.cs:1499 `public int heldProj = -1`）：本 tick 持用中投射物
   *  槽号——投射物 AI 每拍自写（Projectile.cs:23919/:29536/:41497 等族），Update 前置
   *  复位块每拍清 -1（:24570）。★BJ68 2026-09-14 死码移植面（fx51 剩债②）：
   *  消费者 TryInterruptingItemUsage（P.cs:24353-24440）在 1456/1457/1458 反编译全树
   *  **零调用点**（1.4.0.5 无此方法）= 原版死码——本仓同构：字段+复位+Game.
   *  tryInterruptingItemUsage 定义面在,无生产面（aiStyle160 风筝弹未实装）无调用点。
   *  勿据此自造调用/生产（接了=自创行为偏离原版;风筝 AI 实装时随新定谳翻转）。 */
  heldProj = -1;
  /** 魂镰 3006 吸魂计数（Player.cs:784 字段；NPC.cs:91952-91979 每帧邻域敌
   *  SoulDrain+3006 挥击中 → ++；Player.cs:9555 UpdateBuffs >0 → AddBuff(151,2)
   *  自持；:18939 lifeRegenTime+2；:18979 回复加成 (5+n)/2——每 tick 0 归零） */
  soulDrain = 0;
  /** 本帧吸魂回复加成缓存（(5+soulDrain)/2 截断，:18980） */
  soulDrainBonus = 0;
  /** SuperCart 矿车坐骑防御加成（Mount.cs:4797-4798 UpdateEffects 每帧写入：
   *  statDefense += (int)(2×(1+|vx|/RunSpeed×2.5))；下车清零）——Minecart 持有 */
  cartDefenseBonus = 0;
  /** ★BJ709-G34（G32-D2 清偿）:Hell 矿车（mountId 22）骑乘期岩浆宽限提帽 +420
   *  （Mount.cs:5138 UpdateEffects `mountedPlayer.lavaMax += 420`）——Minecart.
   *  fixedUpdate 逐拍写（cartDefenseBonus 同模式）,下车三位清零;消费面=岩浆段
   *  lavaMax 聚合（eqM.lavaMax+本字段）与 :27930-27932 无条件钳。提帽非回填:
   *  宽限只经离浆恢复 +1/tick 灌满（vanilla lavaTime 同相）。recall Spawn face
   *  读同一聚合（★BJ713-A=G34 登记债①清偿:传送随迁后仍骑乘,帽持续含 420）;
   *  respawn face 死亡已卸=equip 面单读。 */
  cartLavaMaxBonus = 0;
  /** ★BJ714-A（R16-P2①）:vanilla lavaMax 单帧累计字段的聚合读口——ResetEffects
   *  :18779 清零→ApplyEquips 配饰面（Player.cs:15286/:15295）→Mount.UpdateEffects
   *  :25855 坐骑面（Mount.cs:5138 Hell 车 +420）→岩浆段 :27880 消费,同帧序。
   *  第四消费位=BreathMeter 火焰条（原版 DrawInterface_Resources_Breath 读
   *  player.lavaMax 字段含坐骑面,Main.cs:42829-42932）——旧 equipStats.lavaMax
   *  单读=骑 Hell 车 grace 窗 [equip,equip+420) 条不显示/刻度错。既有两内联
   *  聚合位（岩浆段 const lavaMax / Game fireRecall spawn 支）语义同式,由
   *  bj709g34 B6/bj713a A5 结构锁钉面,不随本刀改写（防热文件扰动）。 */
  get lavaMaxTotal(): number { return this.equipStats.lavaMax + this.cartLavaMaxBonus; }
  /** accMerman 人鱼化态（:22965 merman=true，水中呼吸；本作仅标志，变身渲染后续） */
  merman = false;
  inLava = false;
  private lavaAccum = 0;
  animTime = 0;          // 走路动画计时
  useTime = 0;           // 通用动作冷却
  // ---- pulley 绳索悬挂态（Player.cs:1028/1026/994/1506/1504；FindPulley :19771-19876;1456 伪锚 :19355-19460 勘正）----
  /** 绳上悬挂（原版 pulley）：按上/下键抓绳吸附进态；HorizontalMovement 整段不跑
   *  （Player.cs:26889 在 pulley else 分支内;1456 伪锚 :26366 勘正）、X 钉绳列、gfxOffY 视觉偏移 */
  pulley = false;
  /** 悬挂侧向档（原版 pulleyDir，Player.cs:1026）：0=未定（状态机首帧归 1）、
   *  1=绳列中心、2=中心±6px（贴绳侧挂） */
  pulleyDir = 0;
  /** 滑轮贴图帧（Player.cs:1057 pulleyFrame）：0/1 两帧循环，绳上滑动时推进
   *  （advancePulleyFrame :26661-26681；渲染消费 = DrawPlayer_24_Pulley 帧行） */
  pulleyFrame = 0;
  /** 滑轮帧推进累加器（Player.cs:1059 pulleyFrameCounter）：每拍 += |vy|·0.75、
   *  vy≠0 再 +0.75，>10 → pulleyFrame++ 归零（Player.cs:26661-26681） */
  pulleyFrameCounter = 0;
  /** 视觉纵向偏移（Player.cs:1504 gfxOffY）：挂绳/上绳瞬间 position.Y 跳变时
   *  记录差值（=position.Y−新Y），渲染锚点（钓线/悠悠球线/持物）消费；
   *  每 tick 衰减回 0（:27695-27719），钳 ±32。矿车态另有 Minecart.gfxOffY
   *  （贴轨补偿，Renderer:8590）——两源互斥（pulley 门含 !mount.Active） */
  gfxOffY = 0;
  // ---- ★SW-BJ59 滚轴鞋轨骑态（Player.cs 字段族——57-60 CanRideMinecartTracks 唯一
  //      非矿车 AnyTrackRider；矿车族走 Minecart 实体不进本组）----
  /** Player.onTrack（:2099）：本 tick 贴轨（TrackCollision bitsByte[0] :28324 置位、
   *  :28303-28304 每拍重置）。消费面：摔伤豁免（:25508 num11=0→fallStart=null）、
   *  TileCollision 盒高 −10（:23786）、RollerSkateMovement fullRotation 保留
   *  （:28777）、IsRidingTracks（:4136-4152 → StepUp/StepDown 门 :28265/:28276）、
   *  轨面滚轮音/火花（:19996/:20054） */
  onTrack = false;
  /** Player.trackBoost（:2105）：加速轨累积（TrackCollision bits[4]/[5] :28365/:28369
   *  ±4），HorizontalMovement 头并入 vx（:19946-19958，钳 ±maxRunSpeed） */
  skateTrackBoost = 0;
  /** Player.cartRampTime（:2101）：斜坡起飞窗口（bits[2] :28361 置
   *  min(1,|vx|/mount.RunSpeed)×20；重力段 :27553-27560 停摆、:27022-27025 vy==0 清零） */
  cartRampTime = 0;
  /** Player.cartFlip（:2103）：挡板反弹输入反转闩（:25199-25210 消费——按住方向时
   *  左/右互换、松键清除；:28336-28343 挡板命中按向时翻转） */
  cartFlip = false;
  /** TrackCollision lastBoost（:28313 引出——加速轨同格去重，Minecart 实体同构） */
  skateLastBoostX = 0;
  skateLastBoostY = 0;
  /** 台阶/挂绳视觉缓动速度（Player.cs:1506 默认 1f；FindPulley 置 2.5——
   *  gfxOffY 衰减步长乘子。原版 Collision.StepUp/Down 会按台阶改写 1/1.5/2/2.5，
   *  本仓台阶走 stepRenderY 独立系统不写此值） */
  stepSpeed = 1;
  /** 绳端下穿冷却（Player.cs:994 ropeCount）：孤立绳格按下键穿落时置 10，
   *  归零前 FindPulley 不再抓绳（:26316-26323 门 / :26644 置位;1456 伪锚 :25801-25805/:26129 勘正） */
  ropeCount = 0;
  /** 手持物品 useTurn（Item.cs SetDefaults；Game 每帧注入）——itemAnimation 窗内
   *  允许移动改朝向的唯一豁免（:19546-19556） */
  itemUseTurn = false;
  dead = false;
  /** 重生倒计时（Player.cs:1522 1456 语义=【倒计数】：死亡时置满值
   *  GetRespawnTime(:38303)，每 tick 递减(:16896/:16907)，≤0 重生(:16908)；
   *  显示 :44788 1+timer/60 自然倒数；.plr 存剩余值(:53956)。曾移植为正计数
   *  （deadTime 语义）→ 死亡界面秒数往上数，2026-08-25 校正为双计数器 */
  respawnTimer = 0;
  /** 法力斗篷魔法命中星雨冷却(Projectile.cs:13894 = 60f*5f = 300t;
   *  受击星雨无冷却门,仅此魔法命中通道用) */
  starCloakCooldown = 0;
  /** 死亡经过时间（Player.cs:1518 deadTime，死亡起每 tick 递增 :16780、
   *  Spawn 归零 :37182）——观战门 CanDeathSpectate(:3939 ≥60) 与跳过锁
   *  (DeadSkipLockoutTime 90) 的 elapsed 语义计数器，与 respawnTimer 分立 */
  deadTime = 0;
  /** sunScorchCounter（Player.cs:2228）：吸血鬼种子"阳光炽灼"蓄能 0-300（每 tick
   *  updateSunScorchValues 推进；写入端 vampireSeedSunlightExposure 已接，见
   *  updateSunScorch——非吸血鬼世界恒 0）。消费：耀斑强度 AdjustIntensity
   *  （NextHorizonRenderer.cs:398-406，SkyRenderer.drawLensFlare 经 frameCtx.player
   *  透传读）、炽灼音环音量（updateSunScorchValues）、120 档点火链（updateSunScorch）
   *  与热浪扭曲门（SceneState.cs:122 flag7 / :187-191 强度 lerp×4——本仓无
   *  HeatDistortion 滤镜，登记） */
  sunScorchCounter = 0;
  /** vampireBurningInSunlight（Player.cs:2676）：阳光暴露位。置 true =
   *  vampireSeedSunlightExposure（:28228，vampireSeed 且露天白天自脚下向上扫 15 格
   *  透光墙）；清 false = 帧首重置（ResetEffects :18549 等价位）/死亡(:28103)。
   *  消费：counter 步进方向（±1/−6）、Molten 套 buffImmune[24] 门(:15883)、
   *  死亡文案 ByOther(22)(:19187)、点火链门(:28153) */
  vampireBurningInSunlight = false;
  /** 夜/日食相位（fixedUpdate 每帧从 world 灌入：!isDay || eclipse——月亮石 900
   *  :14871-14874 的天界石复合门）。equipStats 记忆化输入 → equipStatsKey 的 N/d 档 */
  nightPhase = false;
  /** 死亡画面淡入（Player.cs:16873：dead 时 +2/tick 钳 255；GetDeathAlpha :53284 消费）
   *  ——兼作散飞体渐隐（GetImmuneAlpha :53253：(255−值)/255，>125 直接全透明） */
  immuneAlpha = 0;
  /** 死亡三段散飞（KillMe :38287-38298 初速 / UpdateDead :16878-16888 翻滚解体）：
   *  头/身/腿各带 pos（相对死亡位像素偏移）/vel/rot——渲染 drawDeadPlayerParts
   *  按三件分离绘制（原版 PlayerDrawLayers 逐层 + headPosition/bodyPosition/legPosition） */
  deadParts = {
    head: { px: 0, py: 0, vx: 0, vy: 0, rot: 0 },
    body: { px: 0, py: 0, vx: 0, vy: 0, rot: 0 },
    legs: { px: 0, py: 0, vx: 0, vy: 0, rot: 0 },
  };
  /** 击杀击退方向（KillMe hitDirection 参：X 初速 +2×dir；环境死（岩浆/窒息/溺水
   *  等无击退源）=0——damage() 击退段捕获，同原版 Hurt 的 hitDirection 口径） */
  deathHitDir = 0;
  /** 硬核幽灵帧 0-3（Ghost() :6444-6450：ghostFrameCounter 每 8t 推进 %4） */
  ghostFrame = 0;
  private ghostFrameCounter = 0;
  /** 死亡初速已掷标记（见死亡结算门——dead 可能被 Game 侧先直置） */
  private _deathPartsInit = false;
  /** 眼睑帧 0-2（PlayerEyeHelper.EyeFrameToShow：0 睁 1 半闭 2 全闭——
   *  渲染叠 Player_0_15 帧于头/眼之上；死亡态不更新（UpdateDead 无该链）） */
  eyeFrame = 0;
  private eyeState = 0;      // PlayerEyeHelper.EyeState 枚举序（见文件尾 EYE_* 常量）
  private eyeTimeInState = 0;
  // 摔伤追踪
  fallStartY: number | null = null;   // 矿车骑乘同步清空（车上不计摔伤），公开给 Minecart
  /** 蛛网挣扎计数（原版 stickyBreak，Player.cs:22653） */
  private stickyBreak = 0;
  sinceHurt = 0;               // 距上次受击 tick（自然回血计时；渲染层读取做心心跳动效）
  /** 移动段当前速度上限探针（mounts.test 等消费;非原版字段） */
  _maxRunProbe = 0;
  /** 日曜护盾层数 0-3（Player.solarShields,:16250）;受击每层该次伤 ×0.2（:37699-37720） */
  solarShields = 0;
  /** 护盾回充计时（Player.solarCounter,:16227 每 180t=3s 回 1 层） */
  solarCounter = 0;
  /** 日曜冲撞进行中（solarDashing,:20855）;命中已耗盾标记（solarDashConsumedFlare） */
  solarDashing = false;
  private solarDashConsumed = false;
  /** 盾球环绕偏移/速度（Player.solarShieldPos/Vel :876;轨道更新 :16258-16283,
   *  渲染 DrawPlayer_26_SolarShield——Extra_61+shields-1 单贴图含全簇） */
  solarShieldPos = [ { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 } ];
  solarShieldVel = [ { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 } ];
  /** 甲虫 orb 环绕偏移/速度（Player.beetlePos/Vel :947/:949,3 槽=两族各 3 档上限;
   *  轨道更新 UpdateArmorSets_Always_Beetle :16556-16612——随机游走+100/30 双环回拉
   *  +>2 限速 ×0.9+玩家速度 0.25 反向漂移;渲染 DrawPlayer_37_BeetleBuff——★BJ596） */
  beetlePos = [ { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 } ];
  beetleVel = [ { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 } ];
  /** 甲虫 orb 3 帧条动画帧（Player.beetleFrame/FrameCounter :951/:953——每 tick 步进
   *  0→1→2 循环,frameCounter>=1 门恒真=反编译残迹式照抄;套离身冻结 :16558 早退） */
  beetleFrame = 0;
  private beetleFrameCounter = 0;
  /** ★BJ594 armorEffectDrawOutlines 脉冲振荡载体（Player.ghostFade/ghostDir
   *  :1487-1489,初值 0/1）——渲染端 advanceSolarGhostFade 步进（0.075/帧,
   *  钳 0.1..0.9 呼吸回弹）;日耀套全身在身时消费（四向描边 stamps）。 */
  ghostFade = 0;
  ghostDir = 1;
  /** 自然回血爬坡计时（Player.lifeRegenTime：受击 :37784 / DoT :18781+ / 流血 :19000 清零，
   *  每 tick 基础 +1（:18930）、蜂蜜 +2（:18954）。★旧注"本仓自然回血为恒 1HP/s
   *  简化"已退役（2026-08-13 九档公式重写,消费段见 updateLifeRegen:
   *  eRT 八档阶梯+3600 封顶+乘区族 1:1）——爬坡即产额本身 */
  lifeRegenTime = 0;
  /** 本 tick 落地冲击速度（碰撞前 vy≥3 落地才非 0；Game 消费：起爆器 411 坠落触发） */
  landImpactVy = 0;
  private regenAccum = 0;
  stepRenderY = 0;             // 跨台阶的渲染高度补偿（缓动到 0，消除瞬移顿挫）
  stepUp = true;               // Collision.StepUp 自动上台阶（moveAndCollide 内消费）
  /** ★SW-FX34b 2026-09-15：Collision.TileCollision 第 10 参 hoik（Collision.cs:2299
   *  形参缺省 true）。原版玩家经 Player.TileCollision 包装传 `!flag`
   *  （Player.cs:23785-23791：flag = width≤16 || height≤16 → 20×42 玩家恒
   *  false → hoik 恒 true）；NPC 族 TileCollision 不传该参同样吃缺省 true
   *  （NPC.cs:93868/:93881/:93904）。hoik=true 时撞墙支读取邻格坡向
   *  （Collision.cs:2412 右行/left 支查 slope2/4、:2432 左行/right 支查 slope1/3）
   *  ——「实心格+配套坡邻」组合不拦 = wiki 水平单向墙（楼梯平台列贴墙）的
   *  穿越通道。此前本仓 Body.hoik 缺省 falsy=全局关（2026-09-01 tent 案把缺省
   *  误读为 vanilla 默认 false），单向墙两向全堵=用户实报。普通 Body/测试裸
   *  对象缺省仍关（NPC 侧 2026-09-01 登记债不动，仅玩家恢复原版半边）。 */
  hoik = true;
  /** ★SW-FX34c 2026-09-18：跨格态无条件自由通行（原版 Collision.cs:2437-2456 跨格态
   *  各支前提全假=无推离,与齿列无关）——fx34b 玩家语义原样钉住。弹幕域 hoik 开启
   *  （同批）但【不置】本旗=跨格态仍受身后格坡邻配对门收窄（保 fx 时代穿门"止步"
   *  容器,详 Body.hoikAcrossFree 注）。 */
  hoikAcrossFree = true;
  stepUpHolds = false;         // holdsMatching（Player.cs:23258 第 8 参 = controlUp，fixedUpdate 灌入）
  stepUpNpc = false;
  /** StepDown 门 = vy===GRAVITY（Player.cs:23252 字面）；★SW-BJ59 滚轴鞋贴轨帧
   *  fixedUpdate 灌 'never'（:28265/:28276 `!IsRidingTracks` 否决腿） */
  stepDownGate: 'grounded' | 'gravity' | 'never' = 'gravity';
  /** ★BJ703-C D1：WalkDownSlope 预备阶段 opt-out（Body.walkDownSlopeOff 通道）。
   *  原版玩家 SlopeDownMovement 仅 mount48/shimmering 豁免（Player.cs:23607——
   *  矿车/贴轨照跑）;本仓载具态（onTrack/ridingCart/flag28/flag29）保守同关 =
   *  既存行为保留（防矿车回归,矿车 y 链未按 vy 前置注入审过）——原版差登记债
   *  BJ703-C D8。非载具态 false = 照跑（'gravity' 内门,行为不变）。 */
  walkDownSlopeOff = false;
  /** ★BJ227：StepDown waterWalk 形参（Body 通道,fixedUpdate 每 tick 写——
   *  液面落面臂 Collision.cs:3603-3610,消费面 applyStepDown） */
  stepDownWaterWalk = false;
  /** ★SW-FX34：倒挂 StepUp 每 tick 门（Player.cs:28273-28275，fixedUpdate 灌入；
   *  moveAndCollide 仅 gravDir=-1 时消费—— gravDir=1 半边照旧走 vy>=0 通用门） */
  stepUpInvGate = false;
  /** ★SW-RB14d：正挂 StepUp 速度门两腿（Player.cs:28276 `(carpetFrame != -1 ||
   *  velocity.Y >= gravity)`，fixedUpdate 灌入——①毯展开腿（仓承载 carpetTime>0∧
   *  controlJump）;②阈=gravity 字段（gField）。moveAndCollide 正挂臂消费） */
  stepUpCarpet = false;
  stepUpVeloFloor: number | undefined = undefined;
  /** ★SW-FX34：本 tick Y 轴向下被拦（原版 Collision.down）——moveAxis 置位、
   *  moveAndCollide 头复位；倒挂顶头臂（:28467-28471 vy=-0.01+jump=0）消费 */
  hitDown = false;
  /** ★SW-FX40（h2）：原版 Player.gravity 字段拍末值（:24559 复位 0.4 → :24884
   *  ×num6 深度缩水 → 慢Fall 链 :27228/:27232 签名改写）。每 tick 重力链灌入,
   *  Body.gField 通道喂 StepDown/StepUp 倒挂/WalkDown 三门（TileCollision 消费）。 */
  gField: number = GRAVITY;
  /** ★BJ704-G13（G12 登记债5）：无符号新鲜重力场——gField 的并行快照,干/湿支
   *  终值写位同拍同值写入,【不掺】干支尾部慢Fall 签名改写（/3|/10×gravDir）。
   *  ≙ 原版次拍 Update 头 :24559-:24884 重算链值（gravity 字段每拍从头算,
   *  :27228/:27232 尾部改写不跨拍存活）;跨拍早消费面（tryStartHover 起飞冲量
   *  :26941——upkeep 在物理相前）经 MountedPlayerView.gravityFieldFresh 读此。 */
  gFieldUnsigned: number = GRAVITY;
  /** ★SW-FX40（e）：原版 jumpSpeed 字段承载位（:24561 复位 5.01 + 跳参链/湿档覆写
   *  :24624/:19301-19366）——坐骑 43 弹跳臂（:19912）消费。跳参链在移动相后=一拍滞后。 */
  jumpSpeedField: number = PLAYER_JUMP_SPEED;
  /** ★SW-FX40（g）：本系统触碰格清单（UpdateTouchingTiles :57734 写、GetHurtTile
   *  兜底 :29189 读）——上拍值（原版同拍滞后时序,见方法注） */
  touchedTiles: Array<{ x: number; y: number }> = [];
  // （gravDir 字段本类既有声明 :8047 `gravDir: 1 | -1 = 1`——SW-FX34 经 Body.gravDir
  //   可选位供 moveAndCollide/walkDownSlopePre 消费,缺省 1=gd=1 半边恒等）
  /** 高尔夫累计分（Player.cs:1792 AccumulateGolfingScore——Golfer 商店门槛/月相画门） */
  golferScoreAccumulated = 0;
  /** 鞭命中授予的玩家 buff（WhipTagEffect.PlayerBuffId → 剩余 tick；
   *  效果实装（:9790-9802）：311 镰鞭=鞭攻速+35%、308 剑鞭=+25%、314 荆棘鞭=+12%
   *  ——Game 鞭 useTime 结算读取；312/365 登记持续期（效果端暂不接） */
  whipBuffs: Record<number, number> = {};
  // ---- 1457 鞭 tag 栈（TagEffectStack,Player.cs:1867 字段 + :56750 init + :24785
  //      Update）——每玩家 MRU 栈,容量 5;门控 maxTagEffects/tagEffectDuration 出
  //      equipStats（配饰 6156/6158/6159 系）。 WhipProj 打 tag、随从/哨兵命中侧
  //      resolveWhipTagHit 统一经此查询（敌实体不再存 tag 态） ----
  tagEffectStack = new TagEffectStack(this);
  /** Player.maxTagEffects（:1187,默认 1;ResetEffects :18633 重置→equipStats 聚合） */
  get maxTagEffects(): number { return this.equipStats.maxTagEffects ?? 1; }   // ★BJ175 桩面 ?? 防御（缺省 1=:1187/:2448）
  /** Player.tagEffectDuration（:1189,默认 1f）——tag/proc/自 buff 时长乘区 */
  get tagEffectDuration(): number { return this.equipStats.tagEffectDuration ?? 1; }   // ★BJ175（缺省 1=:1189）
  /** Player.repeatWhipSwings（:1199,初始 -1）——蛇环补挥计数（真挥 +1 :49184,
   *  120t 无挥经 Update_SnakeBand :28623-28628 归 -1） */
  repeatWhipSwings = -1;
  /** Player.repeatWhipsResetCooldown（:1201） */
  repeatWhipsResetCooldown = 0;
  /** 拍击石系共用冷却（Player.accSnappingStoneCooldown :1215,360t——6167 拍击石/
   *  6178 焰爆石/6179 毁灭臂镗三脉冲同轴,Update :28599-28610 递减。★终零波批注订正:
   *  旧注"回充音登记未接"退役——归零拍 snappingStoneRechargeFx + 三型 Recharge
   *  编排广播 + Item_30/20/28 三味音已在轨(2026-08-31 L5+ 批收编) */
  accSnappingStoneCooldown = 0;
  // ---- 1457 配饰四件运行态（字段 :1219/:1229/:1231/:1237/:1241；Update 调用链
  //      :24760-24763，本体 :28521-28659。消费端：弹药轮换=Game 射击路径
  //      PickAmmo :54326-54390；哨兵携带=MinionProj sentry 分支
  //      CanGetPickedUpBySentryBackpack :80532-80557；蓄能暴击=Game 近战命中
  //      TryConsumingTimerCrit :28564-28572；弧线引矢=Arrow.ts harpyCharmEffect）----
  /** Player.ammoCyclingCooldown（:1229）：PickAmmo 实耗一发 → useAnimation+120
   *  （:54211-54212）；Update_AmmoCycler :28632-28638 走完归 0 拍把 offset 复位
   *  = 停火 useAnimation+120t 后轮换回第一组弹药 */
  ammoCyclingCooldown = 0;
  /** Player.snowBallLauncherInteractionCooldown（:1069）：雪球发射器 tile 212 右键
   *  手动发射冷却（TileInteractionsUse :32370 门 `<=0` → 命中置 7 :32373）。
   *  与导线路径的 Wiring.snowballCannonCoolDown（15t+CheckMech）是两套独立冷却——
   *  本字段在 Player.Update 递减（:24752-24756 myPlayer 门） */
  snowballLauncherInteractionCooldown = 0;
  /** Player.ammoCyclingOffset（:1231）：每发 ++（:54213）、Random 模式直写
   *  Main.rand.Next()（:54214-54217）；选弹 = offset % 兼容弹药组数（:54346） */
  ammoCyclingOffset = 0;
  /** Player.accHarpyCharmCooldown（:1219）：引矢冷却 90t、6180 炽天使 ×0.8=72
   *  （:28670-28674）；Update_HarpyCharm :28648-28659 递减、归零拍才扫描 */
  accHarpyCharmCooldown = 0;
  /** Player.accSentryBackpackGrabCooldown（:1237）：携带中每拍被哨兵 AI 续约 2
   *  （SetAsSelectedSentryBackpackTarget :80554-80557）——>0 期其余哨兵不可再被拾
   *  （CanGetPickedUpBySentryBackpack :80543 门）= 同时至多携带一门 */
  accSentryBackpackGrabCooldown = 0;
  /** Player.accTimerCritCharge（:1241，0..1000；timerCritChargeFull :3387 ≥1000）：
   *  Update_TimerCrit :28521-28562 充能 3/t（用物中）+3/t（闲置）+3/t（|v|<0.1 驻立）；
   *  近战命中消费 → −15（:28570），负窗 1/t 回充（:28528-28533）且窗内命中仍暴击
   *  （TryConsumingTimerCrit :28566 `charge < 0f` 亦过门） */
  accTimerCritCharge = 0;
  /** 1457 相机平移档（Player.Settings.PanControl_Keyboard :359;ButtonControlMode.cs:
   *  Hold=0/Click=1/OnAlways=2/OffAlways=3,缺省 Hold=旧行为。设置 UI 循环切换
   *  CyclePanControl_KeyboardAndMouse :379-382——2026-09-03 设置页 UI 已接
   *  （Settings.PanControl 行,循环序 Utils.CycleControlControl_OffOnClickHold）） */
  panControlMode = 0;
  /** Player.hasClickPanOn（:2837）——Click 档互动键（右键）切换的平移开关 */
  hasClickPanOn = false;
  // ---- 信息显示运行态(Player.cs 对应字段) ----
  /** 各信息显示开关(Player.hideInfo[13] :776;按下标=图标序,随存档;
   *  唯一交互=背包界面点图标切换,Main.cs:46547-46573) */
  hideInfo: boolean[] = new Array(13).fill(false);
  /** 配饰格可见性开关(Player.hideVisibleAccessory[10] :1590;下标=装备槽序,随存档)。
   *  交互=装备页配饰格旁眼睛图标点击翻转(Main.cs:40855-40880,仅 num40>2 配饰段
   *  3-9 有图标;盔甲 0-2 与社交 13-19 无)。消费侧:①UpdateVisibleAccessories
   *  :36361 !hide 才 UpdateVisibleAccessory(功能槽贴图隐藏,功能效果不受影响
   *  ——ApplyEquipFunctional :13962 独立扫);②翅膀特例 :12580 隐藏翼在
   *  vy≠0 且 mount.CanUseWings 时仍显形;③UpdateItemDye :9702 起（★BJ665 勘正 伪锚 :9313-9322）隐藏槽染料
   *  不应用(翼族/盾 fallback 豁免);④社交槽 13-19 第二轮 :36368-36375 无 hide 门。
   *  ★原版语义定谳:眼睛图标只挂功能配饰段,"虚荣槽 13-19 也可隐藏"与原版不符,
   *  审计登记回写不改码 */
  hideVisibleAccessory: boolean[] = new Array(10).fill(false);
  /** 击杀计数行"最近击杀"——值域 = 旗种 banner id（Player.cs:2575 `public int
   *  lastCreatureHit = -1;` 1:1;写位存 `BannerSystem.NPCtoBanner(...)` 结果,未映射
   *  = 0 → 行灰"杀敌数不可用",非 NPC id 域）。写入面 = 玩家致伤命中即写非击杀写：
   *  Player.cs:20609-20619（ApplyDamageToNPC）/:44769-44775（ItemCheck 近战命中）/
   *  Projectile.cs:13382-13389（ownedBySomeone 弹）——仓内单漏斗 Enemy.hurt(fromPlayer)
   *  （SW-BJ47 2026-09-09,原击杀时写已摘除）。非持久玩家态,读档回 -1=原版本相 */
  lastCreatureHit = -1;
  /** 渔情行粘性缓存(Player.displayedFishingInfo :2498;浮漂在水时保持旧值) */
  displayedFishingInfo = '';
  /** 秒表速度滑动窗口(Player.speedSlice :1292,长 60;窗口长随速度变化) */
  speedSlice = new Float32Array(60);
  // ---- 指针物品/交互图标(DrawInterface_40 :44474;Player.cs:1730-1740 五字段,
  //      Game 每帧 hover 扫描写入、帧首重置——reset 在 Game.tickCursorIcon) ----
  cursorItemIconEnabled = false;
  /** 覆写图标物品 id(0=用手持;悬停交互物时设) */
  cursorItemIconID = 0;
  /** 光标图标偏移推进(基 10px 之上) */
  cursorItemIconPush = 0;
  /** 光标旁 tooltip 文本(空=无) */
  cursorItemIconText = '';
  /** 图标水平翻转(高门族) */
  cursorItemIconReversed = false;
  /** MouseText 缓存 rare/diff 域(Main._mouseTextCache.rare/diff Main.cs:2449 域,
   *  ★SW-BJ105 2026-09-16)：掉落物名 MouseTextHackZoom(text, rare, 0)(:43628-43628)/
   *  他玩家血名 (text, 0, difficulty)(:43655) 携带;渲染端 drawMouseTextLayer 按
   *  MouseTextInner :20430-20474 色表消费。rare=0/diff=0=默认灰白(NPC 名/箱名/行标签
   *  同相);Game.mouseOversClear 每帧清零(=缓存 isValid=false 重建域) */
  cursorItemIconRare = 0;
  cursorItemIconDiff = 0;
  /** 雷达/稀有生物节流(Player.accThirdEyeCounter/accCritterGuideCounter :2462/:2472,
   *  byte;ResetEffects :12625 卸下雷达时 accThirdEyeCounter 归零 → 重装备立即重扫) */
  accThirdEyeCounter = 0;
  accCritterGuideCounter = 0;
  /** 雷达扫描间缓存的敌数(Player.accThirdEyeNumber :2464,byte;唯一消费点
   *  DrawInfoAccs :46406-46408 行文本;byte++ 255 回绕此处不模拟——2000px 内
   *  敌数 >255 不现实) */
  accThirdEyeNumber = 0;
  /** 稀有生物行缓存。原版 accCritterGuideNumber(:2474)缓存的是 npc[] 槽位索引,
   *  消费点 npc[num13].GivenOrTypeName(:46366/:46371)——本仓实体无 npc 槽位数组,
   *  索引不可移植,直接缓存消费产出(生物名)+ id(金色生物行染色判定)等效 */
  accCritterGuideText: string | null = null;
  accCritterGuideVid: number | null = null;
  // ---- DPS 计(Player.cs:2488-2496 字段 + :53290-53353 addDPS/checkDPSTime/getDPS) ----
  /** dpsDamage/dpsStart/dpsEnd/dpsLastHit/dpsStarted;墙钟 3 秒窗口,停手自动归 N/A */
  private dpsDamage = 0;
  private dpsStart = 0; private dpsEnd = 0; private dpsLastHit = 0;
  private dpsStarted = false;
  /** addDPS(:53301-53309)——命中伤害累计;accDreamCatcher 门禁在调用侧(原版两调用点均门禁:
   *  Projectile.cs:12817/Player.cs:20165),此处同样收口 */
  addDPS(dmg: number): void {
    if (!this.equipStats.infoAccs.accDreamCatcher) return;
    const now = Date.now();
    if (!this.dpsStarted) {
      this.dpsStarted = true;
      this.dpsDamage = 0;
      this.dpsStart = now;
      this.dpsEnd = now;
    }
    this.dpsLastHit = now;
    this.dpsDamage += dmg;
    this.dpsEnd = now;
  }
  /** checkDPSTime(:53319-53327):距上次命中 ≥3 秒 → 停表 */
  private checkDPSTime(): void {
    if (this.dpsStarted && Date.now() - this.dpsLastHit >= 3000) this.dpsStarted = false;
  }
  /** getDPS(:53328-53353):窗口归一,elapsed 下限 1s,>3s 重均并把起点重置为 now-1s */
  getDPS(): number {
    this.checkDPSTime();
    if (!this.dpsStarted) return 0;
    const elapsed = Math.max(1, (this.dpsEnd - this.dpsStart) / 1000);
    const dps = this.dpsDamage / elapsed;
    if (elapsed > 3) {
      this.dpsDamage = Math.round(dps);
      this.dpsStart = this.dpsEnd - 1000;
    }
    return Math.floor(dps);
  }
  /** 右键集火目标（MinionAttackTargetNPC，Player.cs:48952：召唤杖右键指定，
   *  随从索敌优先；-1=无。★SW-FX19 补两写源：鞭命中同槽直写
   *  （Projectile.cs:14321-14323,aiStyle 165 per-hit,单槽最新写胜出——
   *  approx-registry L5+④ 定谳:非"多 tag 争距"）+ 每 tick 失效清除
   *  （:57682-57685,!CanBeChasedBy ∨ 距玩家中心 >3000px）。 */
  minionTargetId = -1;

  /** ★SW-FX19：MinionAttackTargetNPC 失效清除（Player.cs:57682-57685 1:1）。
   *  ★BJ512：距离面由中心距改 Hitbox.Distance 1:1——原版读
   *  `npc.Hitbox.Distance(base.Center)`（XNA Rectangle.Distance:盒外=点到矩形
   *  最近边欧氏距离,盒内=0）;大体型敌（蠕虫节链/克眼等）中心距 >3000 而盒距
   *  ≤3000 的窗内误清除面即此。语义同 Game.npcHitboxDistance（Game.ts 定义,
   *  此处内联避免 entities→Game 环）。 */
  updateMinionAttackTarget(game: GameHooks): void {
    if (this.minionTargetId === -1) return;
    const t = (game.enemies() as Array<{ id: number; dead: boolean; x: number; y: number; w: number; h: number }>)
      .find((e) => e.id === this.minionTargetId);
    const dx = t ? Math.max(t.x - this.cx, 0, this.cx - (t.x + t.w)) : 0;
    const dy = t ? Math.max(t.y - this.cy, 0, this.cy - (t.y + t.h)) : 0;
    if (!t || t.dead || !canBeChasedBy(t) || Math.hypot(dx, dy) > 3000) {
      this.minionTargetId = -1;
    }
  }

  // ---- ★Forbidden 禁戒套指令面（组C 终盘 2026-09-18）----

  /** UpdateForbiddenSetLock 1:1（Player.cs:57459-57471）：扫全场 656 弹（本玩家所有）
   *  → 根数 >1 = 冷却闩（至多同时 2 根;第 2 根落位后闩死到其中一根消亡）。 */
  updateForbiddenSetLock(game: GameHooks): void {
    let count = 0;
    const projs = (game as unknown as { entities?: { projectiles?: unknown[] } })
      .entities?.projectiles;
    if (!projs) { this.setForbiddenCooldownLocked = false; return; }
    for (const p of projs) {
      if ((p as { dead?: boolean }).dead) continue;
      if (p instanceof ForbiddenSignProj) count++;
    }
    this.setForbiddenCooldownLocked = count > 1;
  }

  /** CommandForbiddenStorm 1:1（Player.cs:57476-57566）。门链：
   *  CanSpawnSandstormFriendly(30,30) ∧ 柱根≤1 ∧ 瞄准视线通（AimingLaserScan
   *  采样容差 10f）→ CheckMana(20,pay)+ApplyManaRegenerationDelay → 旧根前跳
   *  死亡相位（ai[0]<780 → 780+ai[0]%60）→ NewProjectile(656) 于
   *  MinionRestTargetPoint,damage=(int)(20×(1+magicDamage+minionDamage−2))。 */
  commandForbiddenStorm(game: GameHooks): void {
    const st = game.world.store;
    const projs = (game as unknown as { entities?: { projectiles?: unknown[] } })
      .entities?.projectiles;
    const signs: ForbiddenSignProj[] = [];
    if (projs) for (const p of projs) {
      if (!(p as { dead?: boolean }).dead && p instanceof ForbiddenSignProj) signs.push(p);
    }
    const aimX = this.minionRestTargetX;
    const aimY = this.minionRestTargetY;
    const flag = canSpawnSandstormFriendly(st, aimX, aimY, 30, 30);          // :57484
    const aimIsZero = !this.hasMinionRestTarget;                             // :57485
    const center = { x: this.cx, y: this.cy };
    const endPoint = aimIsZero ? center : { x: aimX, y: aimY };               // :57487-57489
    // AimingLaserScan(center, endPoint, 60f, 10)（:57492-57493——Center 出射）
    const { vectorTowardsTarget, samples } =
      aimingLaserScan(st, center, endPoint, 60, 10);
    const vtLen = Math.hypot(vectorTowardsTarget.x, vectorTowardsTarget.y);
    let flag2 = false;                                                       // :57495-57504
    for (const s of samples) {
      if (Math.abs(s - vtLen) < 10) { flag2 = true; break; }
    }
    let num2 = 0;                                                            // :57506-57511
    for (const s of samples) if (s > num2) num2 = s;
    if (signs.length <= 1) {                                                 // :57513 预览尘
      spawnStormPreviewDust(game, center, vectorTowardsTarget, num2);
    }
    let ok = flag && signs.length <= 1 && flag2;                             // :57524-57526
    if (ok) ok = this.checkMana(20);                                         // :57528（pay:true;
    //   本仓 ManaV2 面=恒真扣蓝（Player.checkMana 单源）;魔力花链在其内）
    if (ok) this.applyManaRegenerationDelay();                               // :57529-57531
    if (!ok) return;                                                         // :57535-57537
    for (const s of signs) {                                                 // :57537-57545
      if (s.ai0 < 780) s.ai0 = 780 + (s.ai0 % 60);                           // 旧根前跳死亡相位
    }
    const es = this.equipStats;
    // :57546 (int)(20×(1+magicDamage+minionDamage−2))——原版 magicDamage/minionDamage
    // 为 1.0 基线全乘区,本仓 dmgMagic/minionDmg 为 0 基线加算累加器 ⇒ X+Y−1 =
    // (1+X')+(1+Y')−1 = 1+X'+Y'（零加成 = 20 基伤,组C 终盘换算勘误 2026-09-18）
    const damage = Math.trunc(20 * (1 + (es.dmgMagic ?? 0) + (es.minionDmg ?? 0)));        // :57546（★BJ175 桩面 ?? 防御,缺省 0）
    // C# float→int 截断同式（(int) 溢出 clamp 不建模——20×乘区量级无溢出面）
    const ent = game as unknown as {
      entities?: { add?: (e: unknown, bucket?: string) => void };
    };
    ent.entities?.add?.(new ForbiddenSignProj(aimX, aimY, damage), 'projectiles');  // :57564
    game.playSfxWav?.('Item_82', 1, Math.trunc(center.x), Math.trunc(center.y));
  }

  /** MinionRestTargetAim 1:1（Player.cs:57599-57670）：光标格起,列扫描找最近
   *  可站立地面（上 20t/下 20t 启发位 + SolidTileAllowBottomSlope 5 格行进走查），
   *  距玩家 ≤1000px 才入账 MinionRestTargetPoint。 */
  minionRestTargetAim(game: GameHooks): void {
    const st = game.world.store;
    const mx = Math.floor(this.inputAimWorldX / 16);
    const my = Math.floor(this.inputAimWorldY / 16);
    // 光标格地面支（:57604 tileSolid ∧ ¬tileSolidTop;本仓 groundAt 不排 half/slope
    // ——与原版同式,后行进走查兜真地）
    const groundAt = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= st.w || y >= st.h) return false;
      const i = st.idx(x, y);
      if ((st.flags[i] & 1) === 0) return false;
      const d = TILE_DEFS[st.type[i]];
      return !!d && d.solid && !d.platform;
    };
    // SolidTileAllowBottomSlope（WorldGen.cs:8458 定义面 :8466-8472）：active ∧
    // (solid ∨ solidTop) ∧ ¬topSlope(平台顶帧门不建模,登记) ∧ ¬halfBrick ∧ ¬inActive;
    // InWorld 外/空格 = true（try 缺省支）
    const standableAt = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= st.w || y >= st.h) return true;
      const i = st.idx(x, y);
      // 原版语义（WorldGen.cs:8466-8472）：InWorld 外/Tile null（=越界）→ true;
      // 存在但 inactive → 落穿尾 return false（★首测红修正：inactive ≠ null）
      if ((st.flags[i] & 1) === 0) return false;
      if (st.wire[i] & 32) return false;                       // inActive（WIRE_ACTUATED）
      const d = TILE_DEFS[st.type[i]];
      if (!d || (!d.solid && !d.platform)) return false;
      if (st.half[i]) return false;
      const slope = st.slope[i];
      if (slope === 1 || slope === 2) return d.platform;       // topSlope 拒(平台豁免近似)
      return true;
    };
    let num3 = 0;                                              // :57606-57627 启发位
    if (groundAt(mx, my)) {
      let num4 = 0;
      let num5 = 0;
      while (num5 > -20 && my + num5 > 1) {                    // 上行最近实心行距
        if (groundAt(mx, my + num5)) { num4 = num5; num5--; continue; }
        num4 = num5;
        break;
      }
      let num7 = 0;
      for (let i = 0; i < 20 && my + i < st.h; i++) {          // 下行 20t 内最近实心行距
        if (groundAt(mx, my + i)) { num7 = i; continue; }
        num7 = i;
        break;
      }
      num3 = num7 <= -num4 ? num7 + 3 : num4 - 2;              // :57626
    }
    let num9 = my + num3;                                      // :57629
    let flag = false;                                          // :57630-57637 5 格行进查
    for (let j = num9; j < num9 + 5; j++) {
      if (standableAt(mx, j)) flag = true;
    }
    while (!flag) {                                            // :57638-57647 下行到地
      num9++;
      for (let k = num9; k < num9 + 5; k++) {
        if (standableAt(mx, k)) flag = true;
      }
    }
    const vx = mx * 16 + 8;                                    // :57648-57653
    const vy = num9 * 16;
    if (Math.hypot(vx - this.cx, vy - this.cy) <= 1000) {
      this.minionRestTargetX = vx;
      this.minionRestTargetY = vy;
    }
  }
  /** 星云三族等级（0-3，各自独立 480t；NebulaLevelup :56091-56121 逐级升/降）：
   *  0=伤害 179-181（四系 +15%/级）1=生命 173-175（lifeRegen +6/级）2=魔力 176-178 */
  nebula = [0, 0, 0];
  private nebulaT = [0, 0, 0];
  private nebulaManaAccum = 0;
  private nebulaLifeAccum = 0;
  /** NebulaLevelup（:56091-56121）：本族 +1 级 cap3，满 480t 重置（拾取驱动） */
  nebulaLevelup(family: 0 | 1 | 2): void {
    this.nebula[family] = Math.min(3, this.nebula[family] + 1);
    this.nebulaT[family] = 480;
  }

  /** 取消一族星云增益（buff 栏右键 DelBuff 等价，Main.cs:42793 TryRemovingBuff——
   *  原版 UpdateBuffs_NebulaBuffs :11660 从 buffType 派生等级，buff 没了效果即停；
   *  本仓等级即真值 → 清零同语义） */
  nebulaCancel(family: 0 | 1 | 2): void {
    this.nebula[family] = 0;
    this.nebulaT[family] = 0;
  }

  /** 星云增益 buff 栏视图（补 C ⚠️图标批）：等级>0 的族 → 原版档位 buff id +
   *  剩余秒。档位映射 = UpdateBuffs_NebulaBuffs（Player.cs:11660-11669
   *  num = 1 + buffType[b] - baseBuffId）+ AddBuff(type + level - 1, 480)
   *  （NebulaLevelup :56109/:56113/:56117）——0=伤 179-181 / 1=命 173-175 /
   *  2=魔 176-178。图标 Buff_173-181.png（UI 直链） */
  nebulaBuffIcons(): Array<{ fam: 0 | 1 | 2; vanillaBuff: number; secs: number }> {
    const base = [179, 173, 176] as const;
    const out: Array<{ fam: 0 | 1 | 2; vanillaBuff: number; secs: number }> = [];
    for (const fam of [0, 1, 2] as const) {
      const lvl = this.nebula[fam];
      if (lvl > 0) out.push({ fam, vanillaBuff: base[fam] + lvl - 1, secs: Math.ceil(this.nebulaT[fam] / 60) });
    }
    return out;
  }
  /** 甲虫攻击球（0-3）：蓄能/衰减/家族唯一权威 = BeetleMeter（Game 每 tick 驱动；
   *  buff 图标 95-100 亦由 meter 钉挂）。旧 lastMeleeTick/beetleCharge 时间蓄能
   *  近似已拆（2026-08-31，meter 单一来源化） */
  beetleOrbs = 0;
  /** 潜行度：1=无潜行(全可见)、0=满潜行——越低越隐（1457 Player.cs:1545 初值 1f；
   *  消费式全走 (1−stealth) 加成：变态刀伤/暴 :25970-25971、星璇伤/暴/仇恨
   *  :26043-26045、蘑菇矿 Remap :26015-26018）。此前误写 0=出生即"满潜行"，
   *  变态刀/潜行装在首帧即吃满加成、渲染 s'=max(stealth,0.03) 近乎全隐。
   *  蘑菇矿=移动蓄/星璇=双击↓开关（1457 :25981-26021/:26022-26068） */
  stealth = 1;
  private stealthTimer = 0;
  vortexStealthActive = false;
  private prevDown = false;
  private downTapT = 0;
  /** 原版 holdDownCardinalTimer[0]（Player.cs:1387/:25260-25268）：下方向连按
   *  计时，松开清零；≥45 → controlDownHold（Chromatic Cloak 5355 微光豁免门
   *  :15643-46 的例外入口——按住下键 45t 主动浸微光） */
  downHoldT = 0;
  /** Player.controlDownHold（:25268） */
  controlDownHold = false;
  // ---- ★Forbidden 禁戒套引擎面（组C 终盘 2026-09-18;Player.cs:2809/:2811/:2989）----
  /** setForbidden（:2809,ResetEffects :18861 每拍清 → Benefits.Forbidden :61-65 重置位
   *  = 本仓每拍 equipStats.setBonus.forbidden 投影,赋值位在 fixedUpdate 套装段） */
  setForbidden = false;
  /** setForbiddenCooldownLocked（:2811——在场的 656 弹 >1 根 = 指令冷却闩,
   *  UpdateForbiddenSetLock :57459-57471 每拍重算） */
  setForbiddenCooldownLocked = false;
  /** MinionRestTargetPoint（:2989,Vector2.Zero 缺省;HasMinionRestTarget :4044）。
   *  星尘守护者共用面（★BJ157⑧ 消费面已接：MinionProj guardianBody 状态 1/3 +
   *  KeyHoldDown 星尘支 + rest 点尘环;原版 rest 环 {1,3} 单机休眠支 1:1 照抄） */
  minionRestTargetX = 0;
  minionRestTargetY = 0;
  /** 双击↓检测私有相位（与星旋套 downTapT 分离——星旋检测只在其 else-if 分支内
   *  推进 prevDown,跨分支共用会互相污染相位） */
  private forbiddenPrevDown = false;
  private forbiddenTapT = 0;
  /** 光标世界坐标（Game.fixedUpdate 输入段注入;MinionRestTargetAim :57599 的
   *  Main.MouseWorld 等价入参——Player 无相机,由 Game 侧 screenToWorld 单源供给） */
  inputAimWorldX = 0;
  inputAimWorldY = 0;
  /** Player.HasMinionRestTarget（:4044 `MinionRestTargetPoint != Vector2.Zero`） */
  get hasMinionRestTarget(): boolean {
    return this.minionRestTargetX !== 0 || this.minionRestTargetY !== 0;
  }
  /** BOC 受击脉冲（fixedUpdate 内消费：buff 321 + 困惑近敌） */
  bocPulse = 0;
  /** 幻影闪避重整冷却（Player.shadowDodgeTimer，:1167 声明 / :25656-25659 每 tick
   *  递减 / :38326 消费置位）：神圣套 on-hit 授予 buff 59 的节流窗（30s）。
   *  ★终零波批（2026-09-01）第四闪避支来源接线完成——旧注"神圣套装加成未建模、
   *  无自然写入端"退役：vanillaArmorSets 收编 Hallowed/HallowedSummoner 键
   *  （1458 ArmorSetBonuses.cs :462-464 全组合展开,
   *  槽序 hs{41,42,43,255,256,257}·hs{254,258}×bs{24,229}×ls{23,212}）→
   *  equipStats.onHitDodge → Enemy.hurt fromPlayer 段 buff59 授予位（OnHit :6937-6940
   *  shadowDodgeTimer==0 门）→ 本 timer 消费链全链可达 */
  shadowDodgeTimer = 0;
  /** Player.insanityShadowCooldown（Player.cs:1060；SpawnHallucination :13633 递减）：
   *  骸骨头盔幻影生成节流——归零时重掷 Next(20,101) */
  insanityShadowCooldown = 0;
  /** 原版 Player.insideUnbreakableWalls（Player.cs:2678；UpdateUnbreakableWallScan
   *  :28125-28141 更新）：getfixedboi 双地牢不可破墙内的越界判定——刷怪链
   *  tresspassingDualDungeon（NPC.cs:313）消费。普通世界恒 false */
  insideUnbreakableWalls = false;
  private uwScanCd = 0;
  private uwScanX = 0;
  private uwScanY = 0;
  /** UpdateUnbreakableWallScan（Player.cs:28125-28141）：Main.dualDungeonsSeed 门
   *  （getfixedboi）+ 20t 冷却/256px 移动重扫；扫描=UnbreakableWallScan.cs。
   *  Game 刷怪周期调用（内部冷却幂等） */
  updateUnbreakableWallScan(world: import('../world/World').World, force = false): void {
    // ★SW-RB10a 旗域定谳：vanilla 门=Main.dualDungeonsSeed（DoUnbreakableWallScan
    //  :28826-28829「if (!Main.dualDungeonsSeed || Main.netMode == 1) return;」）＝
    //  SecretSeed.dualDungeons（"double daring dangers"）专属旗。旧刀挂 seedFlags.
    //  everything（getfixedboi）——zenith 依赖七件套（WorldSeedOption_Everything.
    //  Dependencies=Remix/Drunk/NotTheBees/NoTraps/DontStarve/Anniversary/ForTheWorthy）
    //  【不含 dualDungeons】：ddual 世界扫描整死（insideUnbreakableWalls 恒 false →
    //  NPC.cs:402 inDualDungeon/1256/5452/60596 全链哑火）；zenith 世界则误扫（墙 350
    //  不生成恒 false=侥幸无害）。消费端 Game.setPlayerFlags 位同步改（同批）。
    if (!world.seedFlags?.dualDungeons) return;   // Main.dualDungeonsSeed（:28127-28129）
    if (force || --this.uwScanCd <= 0
      || Math.hypot(this.cx - this.uwScanX, this.cy - this.uwScanY) >= 256) {
      this.insideUnbreakableWalls = insideUnbreakableWallsScan(
        world.store, Math.floor(this.cx / 16), Math.floor(this.cy / 16));
      this.uwScanCd = 20;                       // UnbreakableWallRescanPeriod :2970
      this.uwScanX = this.cx; this.uwScanY = this.cy;
    }
  }
  /** 睡眠（PlayerSleepingHelper SH:155-191：脚侧悬停右键入睡；床失效/移动输入/挥武器唤醒。
   *  ★受伤不唤醒（StopSleeping 全调用点仅 5 处，SH:98-131）。睡熟阈值 120t（SH:11） */
  sleeping = false;
  timeSleeping = 0;
  /** 坐椅（PlayerSittingHelper 1:1，2026-08-15）：isSitting = isLockedToATile——
   *  重力/常规移动锁死（velocity 恒 0，矿车同款早退段）；任意移动输入/朝向变化/
   *  椅失效 → 起身（Game.updateSitting 每帧）。渲染偏移 seatOffsetX/Y =
   *  offsetForSeat + sittingIndex 叠坐位（单人恒 0） */
  sitting = false;
  /** 座位渲染偏移（offsetForSeat，px） */
  seatOffsetX = 0;
  seatOffsetY = 0;
  /** 马桶座位（ExtraSeatInfo.IsAToilet）——TryToPoop 门 */
  seatIsToilet = false;
  /** 坐椅恢复加成计时（坐满 10t 后 TryToPoop 可触发） */
  sitTicks = 0;
  /** 联机远端位置平滑偏移（原版 Player.netOffset，MessageBuffer.cs case 13 注入、
   *  Player.UpdateNetOffset :28240 衰减）：模拟位置与权威快照的差，渲染时叠加。
   *  本地玩家恒 0 */
  netOffX = 0;
  netOffY = 0;
  /** 联机远端挥舞动画（msg13 useItem 位驱动；Game 派生，Renderer 以 swing 参数消费）。
   *  useStyle/aim 与本地 Game.swing 同构（远端无瞄准角同步，aim 取 0=正前方）——
   *  缺失时 Renderer 退化为 useStyle 1 剑挥（喝药/开枪/举火把全错）。
   *  本地玩家不用（本地走 Game.swing） */
  swingNet: { t: number; dur: number; item: number; useStyle?: number; aim?: number } | null = null;
  /** 矿车骑乘中（原版 mount.Active && mount.Cart）：常规移动/跳跃/重力由 Minecart
   *  实体接管（Player.cs:27783-27850 TrackCollision 段），fixedUpdate 提前返回；
   *  渲染层消费本标志取坐姿帧（mount.BodyFrame=3）并叠画车身 */
  ridingCart = false;
  /** 当前所骑矿车（渲染层叠画车身/倾角用；Game 挂载） */
  cart: import('./Minecart').Minecart | null = null;
  /** 坐骑实例（Mount.cs Mount 1:1：非矿车坐骑状态机/能量/帧态；矿车族由 Minecart 接管） */
  mount = new MountInstance();
  /** 骑乘中（非矿车坐骑；渲染/物理分支消费——原版 mount.Active && !mount.Cart） */
  get ridingMount(): boolean { return this.mount.active && !this.mount.isCart; }
  /** ★BJ703-D1 Player.wingTimeMax 等价（GetWingStats(wingSlot).FlyTime，:15568
   *  ApplyEquipFunctional 翼件落值;无翼 0）——坐骑 54 选择性飞行族消费
   *  （mount.resetFlightTime / updateAfterEquips 经 MountedPlayerView.wingTimeMax）。 */
  get wingTimeMax(): number { return this.equipStats.wing?.time ?? 0; }
  /** ★BJ703-D1 grappling[0] >= 0（钩爪挂中）——迅猛龙帧态门唯一存活项
   *  （UpdateFrame_Velociraptor → ShouldDrawWingsThatAreAlwaysAnimated
   *  ignoreMounts:true, MountedPlayerView.grapplingHooked 承载）。本仓 grappling
   *  持 GrappleProj 引用非 int 下标（仓内同谓词惯用真值判,如 :5120 mana 系数门）。 */
  get grapplingHooked(): boolean { return !!this.grappling[0]; }
  /** 游泳族坐骑门（坐骑 buff 的 ignoreWater 语义：海龟 131/猪鲨崽 168/海盗船 279/
   *  熔岩鲨 305——★G13 勘正：265 火烈鸟非本门（canFloatInWater,见 Mounts.ts 注）） */
  get ridingMountSwimFree(): boolean { return this.ridingMount && this.mount.swimFree; }
  /** ★BJ704-G5（G4-③）原版 wet 位（Collision.cs:1608 `liquid > 0` 任意液体,首中即返
   *  ——水∪蜜∪岩浆∪微光;DrownCollision 的 !lava&&!shimmer 是呼吸口位非 wet 位）。
   *  MountedPlayerView.wet 承载（帧态分派 :36485 游泳臂判据）。 */
  get wet(): boolean {
    return this.inWater || this.inLava || this.inHoney || this.inShimmer;
  }
  /** ★BJ704-G5（G4-②）slowFall 并集（buff 8 羽落 ∪ 3770 神灵诅咒——原版同一
   *  player.slowFall 字段并集,:1113 注）——MountedPlayerView.slowFall 承载
   *  （Hover 疲劳率 ÷3 档 :3379-3381）。 */
  get slowFall(): boolean { return this.buffs.slowFall || this.equipStats.slowFall; }
  /** ★BJ704-G5（G4-②）当拍重力场（Player.gravity 字段 :24884 终值等价）——
   *  gField 链尾快照（干 :7894/湿 :7337 每拍无条件写,RB14a）。tryStartHover 起飞
   *  冲量 :26941 消费（MountedPlayerView.gravityField 承载;物理相前=上拍值,
   *  vy==0 静止拍等价——Mounts.ts tryStartHover 注）。 */
  get gravityField(): number { return this.gField; }
  /** ★BJ704-G13（债5）无符号新鲜重力场（gFieldUnsigned 承载,见字段注）——
   *  MountedPlayerView.gravityFieldFresh 通道（tryStartHover 跨拍读）。 */
  get gravityFieldFresh(): number { return this.gFieldUnsigned; }
  /** ★BJ704-G13（债4）Player.sliding 承载位（贴墙滑=wallCling 仓内代词）——
   *  Mounts.updateFrame 帧计数复位抑制 55 臂（Mount.cs:3633 `state==2 && sliding`）
   *  经 MountedPlayerView.sliding 消费。 */
  get sliding(): boolean { return this.wallCling; }
  /** ★BJ704-G13（债4）Player.dash 承载位（dashLatched 镜像,C5-B5）——Mounts.
   *  updateFrame 56 臂冲刺沿复位（Mount.cs:3615 `dash>0 ∧ dashDelay<0`）经
   *  MountedPlayerView.dash 消费。 */
  get dash(): number { return this.dashLatched; }

  /** ★SW-AS1 2026-09-05 自动开门速度贡献（Player.cs:24534-24540 1:1）：velocity.X；
   *  骑滚轴鞋（MountID.Sets.IsRollerSkates={57,58,59,60}）且 |vx|<3f → 3f×sign(vx)。
   *  消费点=DoorOpeningHelper.GetPlayerInfoForOpeningDoor（:325）。 */
  getAutoDoorVelocityContribution(): number {
    return getAutoDoorVelocityContribution(this.vx, this.mount.active, this.mount.type);
  }

  constructor(x: number, y: number, inv: Inventory) {
    super();
    this.x = x; this.y = y;
    this.inv = inv;
    // ★SW-FX36：残影基线=原版 Spawn 冲洗后态（Player.cs:37927-37932
    //  ResetAdvancedShadows+3×UpdateSocialShadow——count 0→1→2→0 轮转后
    //  shadowPos[0]=出生位、[1]/[2] 仍为零向量、shadowCount=0）。
    //  ★SW-RB14d 勘误：旧刀 [x,x,x]（三槽全出生位）系误判"冲洗后全等当前位"——
    //  轮转只写 [0],旧开局 4 拍 shadowLagDist()=0（网格满幅 0.7）,原版 |pos−0|
    //  巨大 → 网格钳 0.2 下档（开局暗 4 拍=原版本相）。本基线即冲洗后态逐位复刻。
    this.spX = [x, 0, 0];
    this.spY = [y, 0, 0];
  }

  // ---- 配饰效果（重算式聚合，幂等）----
  /** Lucky Horseshoe 158（本地 accessory 枚举退役,vid 判定） */
  get hasHorseshoe(): boolean {
    const want = VI_ID(158);
    for (let i = ACC_ARMOR_START; i < 10; i++) { // armor[3-7 基座+恶魔之心 8+大师 9(原版 Player.cs:36326)
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // ★清偿刀 P :12669-12690
      const s = this.inv.armor[i];
      if (!s) continue;
      // ★清偿刀 U：expertOnly 效益门（ApplyEquipFunctional 头 :14475-14478——
      //   hasLuck_LuckyHorseshoe 在该函数 :12628 族内,门内）
      if (ITEM_DEFS[s.id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) continue;
      if (s.id === want) return true;
    }
    return false;
  }
  /** Feral Claws 211 */
  get hasFeralClaws(): boolean {
    const want = VI_ID(211);
    for (let i = ACC_ARMOR_START; i < 10; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // ★清偿刀 P :12669-12690
      const s = this.inv.armor[i];
      if (!s) continue;
      if (ITEM_DEFS[s.id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) continue;   // ★清偿刀 U :14475
      if (s.id === want) return true;
    }
    return false;
  }
  /** 防御 = 基础(0) + 盔甲/配饰（含 vi_ 表防御+accfx def+词缀 62-65）+ 铁皮 Buff(+6)（时装不计） */
  get defense(): number {
    let d = this.buffs.defenseBonus + (this.equipStats.def ?? 0) + this.cartDefenseBonus;   // ★BJ175 桩面 ?? 防御（缺省 0）
    if (this.usedAegisFruit) d += 4;   // UpdatePermanentBoosters :12447-12449
    d += this.modDefBoost;   // ★四百七十四刀:mod 配饰每 tick 防御面(AquaticEmblem 爬坡;赋值语义非累积)
    // ★BJ585（2026-10-09）：armor[0..2] 改走 GetEffectiveArmor——原版 statDefense 护甲段
    //   在 GrantArmorBenefits（Player.cs:13220 `statDefense += armorPiece.defense`）内，
    //   其调用面 k=0..9 【全走 GetEffectiveArmor(k)】（Player.cs:13014-13019）——
    //   跨配装共享护甲（他页 favorited 件）参与基础防御。旧 equippedArmor() 只读裸
    //   armor[0..2] = 共享装时基础防御漏算（用户实测 51→31；R4-19 消费面裁决
    //   「属性聚合不存在走裸 armor[] 的例外」的漏网面）。共享准入由
    //   getEffectiveArmor→canShareArmor（槽型门+低位配对扫）承担，0..2 槽原版
    //   UpdateEquips_CanItemGrantBenefits 仅槽型校验（Player.cs:13061-13078）已被覆盖。
    for (let slot = 0; slot < 3; slot++) {
      const id = this.inv.getEffectiveArmor(slot)?.id ?? null;
      // ★armor.defense 死前腿已随 ItemDef.armor 死字段移除（2026-09-02,全仓零写入,
      //   真值源 = vanilla-itemstats.json,与配饰段同源）
      if (id == null) continue;
      // ★清偿刀 U：expertOnly 效益门（GrantArmorBenefits :13220 statDefense +=
      //   armorPiece.defense,k-loop :13017-13018 门内——专家档甲经典世界零防御）
      if (ITEM_DEFS[id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) continue;
      d += statOfInternal(id)?.def ?? 0;
    }
    // 破甲(36)/枯萎护甲(195)：终值各减半（Player.cs:25704/:25708——全部来源加总之后）
    if (this.buffs.has(BuffType.BrokenArmor)) d = Math.floor(d / 2);
    if (this.buffs.has(BuffType.WitheredArmor)) d = Math.floor(d / 2);
    return d;
  }

  /** 装备数值聚合（GrantArmorBenefits/ApplyEquipFunctional/GrantPrefixBenefits 可移植切片）。
   *  覆盖：配饰防御/魔力/回复/移速/近战速度/全系伤害/暴击 + 词缀 62-80 效益；
   *  行为型效果（火箭靴飞行/熔岩护身等）不在内。每帧重算式聚合，幂等 */
  /** 翅膀染料 vid（Player.cs:9306-9312 UpdateItemDye 链 + :9417 cWings）：
   *  armor[0..19] 中最后一个 wingSlot>0 槽位 → dye[i%10]（vanity 10-19 后扫
   *  自然胜出 = 原版同序）；无染料/无翅 → -1 */
  wingDyeVid(): number {
    let slot = -1;
    for (let i = 0; i < 20; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // ★清偿刀 P：UpdateItemDye :9693 同门
      const it = this.inv.armor[i];
      if (!it) continue;
      if ((statOfInternal(it.id)?.wing ?? 0) > 0) slot = i % 10;
    }
    if (slot < 0) return -1;
    const dye = this.inv.getEffectiveDye(slot);   // LoadoutShare（GetEffectiveDye :5736）
    if (!dye) return -1;
    return (ITEM_DEFS[dye.id]?.vid ?? -1);
  }

  /** 盔甲套染料 vid（Player.cs:9456 ArmorSetDye：Next(3) → 0=cHead/1=cBody/2=cLegs,
   *  兜底 cBody——dye[0..2] 对应头/身/腿；无染料 → 0=无 shader） */
  armorSetDyeVid(): number {
    const pick = Math.floor(Math.random() * 3);
    const dye = this.inv.getEffectiveDye(pick === 0 ? 0 : pick === 1 ? 1 : 2)
      ?? this.inv.getEffectiveDye(1);   // LoadoutShare（GetEffectiveDye :5736）
    if (!dye) return -1;
    return (ITEM_DEFS[dye.id]?.vid ?? -1);
  }

  /** ★BJ707-G29 坐骑染料 vid（Player.cs:9689 UpdateDyes `cMount = miscDyes[3].dye`
   *  ——坐骑染料槽下标 3，直读无掷；无染料/槽空 → -1=GetSecondaryShader(0)=null
   *  同相（ArmorShaderDataSet.cs:63-70 id==0 早退 null）。零 RNG=掷流中立
   *  （vanilla cMount 消费面全链无掷）。消费=cMount 尘发射方五处（dashDust 环/
   *  dashDustBody 尾/dash6 尾尘/坐骑特跳尘环/独角兽上升尾迹——GetSecondaryShader
   *  (cMount) :3920/:3931/:4138/:4168/:21064/:21092/:21120/:21539/:22126） */
  mountDyeVid(): number {
    const dye = this.inv.miscDyes[3];
    if (!dye) return -1;
    return (ITEM_DEFS[dye.id]?.vid ?? -1);
  }

  /** ★BJ709-G32③ 矿车染料 vid（Player.cs:9688 UpdateDyes `cMinecart = miscDyes[2].dye`
   *  ——矿车染料槽下标 2（cMount 是 3,勿混）,直读无掷同径;无染料/槽空 → -1 同相
   *  （GetSecondaryShader(0)=null）。消费=矿车七尘面 d.dyeVid（Minecart.
   *  updateEffectsDust,Minecart.ts census 注 BJ707-G31④） */
  minecartDyeVid(): number {
    const dye = this.inv.miscDyes[2];
    if (!dye) return -1;
    return (ITEM_DEFS[dye.id]?.vid ?? -1);
  }


  get equipStats(): PlayerEquipStats {
    // ★记忆化(2026-08-19 367s trace 剖析:207 个调用点大量逐帧访问,每次现建
    //   200+ 字段对象+遍历装备表 = 0.22% 自耗时 + MajorGC 每 5s 的分配 churn 主源)。
    //   内容哈希键失效(输入清单见 equipStatsStructKey/equipStatsTailKey——★改
    //   computeEquipStats 的输入必须同步键 + tests/equip-stats-cache.test.ts 六路锁);
    //   返回对象冻结(全仓零改写已审计,冻结把将来误写变成显式 TypeError)
    //   ★IIIII250(2026-09-14 用户雨天 trace 86.5MB 定谳):computeEquipStats 全程
    //   零样本=缓存恒命中,burn 全在【每访问重键】——字符串键 equipStatsKey
    //   self 381ms(30×getEffective+58 槽×2 遍 vid 解析+~100 段串接)+get
    //   equipStats self 161ms(长串 === 逐字符全等比较)。字符串键退役改双 32 位
    //   FNV 数值键:重建整数化零分配,比较变 number ===(输入清单逐字不变,仍
    //   内容键——对一切写入方天然免疫语义保持)。
    //   ★IIIII251(2026-09-25 记忆化收口,x-ray:日曜柱 53 次/106ms 全是重键;
    //   BakeWorker 场景 equipStatsKey 99.4% 烧满):双 FNV 后余量=【结构段每访问
    //   全量重扫】(甲 20+染 10+空槽 loadout 扫+背包单遍 50-58 格+虚空袋)。
    //   按帧级键缓存收口(dropScanCtx/projScanCtx 帧上下文同判例家族),键二分:
    //   · 结构段(槽位/背包/虚空袋域)=武装窗内首读重建一次,窗内复用——窗=
    //     fixedUpdate 函数体(head 武装/finally 解除,见 fixedUpdate 注);窗内
    //     槽位零写面(projScanCtx 同论证)⇒ 与逐次重建逐位同。
    //   · 标量尾段(恶魔心/软糖虫/世界旗/panic/controlDown/槽解锁+hide 位/
    //     炽灼三态/夜相/expert·master 门)+buffs 键集合=每访问现算,任何时刻
    //     (窗内窗外)变化立即失效,与逐次全量重建逐位同(战斗中 buff 增删=高频面)。
    //   · 窗外读(entities 桶/render/UI/单测直调/MP 远端代理)=解除态=旧的逐访问
    //     全量重建路径,直写槽位立即生效、行为逐位不变(六路锁/breath 族即此面)。
    //     drops/projectiles 桶的每物放大面已由各自帧上下文快照收口。
    const structKey = this._equipStatsArm
      ? (this._equipStatsStructKeyCache ?? (this._equipStatsStructKeyCache = this.equipStatsStructKey()))
      : this.equipStatsStructKey();
    const key = this.combineEquipStatsKeys(structKey, this.equipStatsTailKey());
    if (this._equipStatsCache !== null && key === this._equipStatsKey) return this._equipStatsCache;
    this._equipStatsKey = key;
    const stats = this.computeEquipStats();
    Object.freeze(stats);
    Object.freeze(stats.jumpOpts);
    if (stats.wing) Object.freeze(stats.wing);
    this._equipStatsCache = stats;
    return stats;
  }
  private _equipStatsCache: PlayerEquipStats | null = null;
  private _equipStatsKey = 0;   // ★IIIII250:双 FNV 数值键(原字符串键退役,见 getter 注)
  // ★IIIII251:结构段帧级缓存——武装窗(fixedUpdate 函数体,head 置位/finally 解除)
  //   内非 null 且只算一次;解除态恒 null(每访问现算=旧路径)
  private _equipStatsStructKeyCache: number | null = null;
  private _equipStatsArm = false;   // ★IIIII251:仅 fixedUpdate 壳内置位/finally 复位
  /** ★IIIII224：世界旗直读位（Game 每帧注入,computeEquipStats 巫师帽 238 十周年臂消费。
   *  不入 equipStats 缓存键——键内有独立 T/t 位,旗翻转帧即失效） */
  worldSeedFlags?: { tenthAnniversary?: boolean; remix?: boolean; theConstant?: boolean; everything?: boolean };

  /** equipStats 内容键——★IIIII251 起【结构段/标量尾段】二分（输入清单 =
   *  computeEquipStats 读到的全部可变状态,与旧单函数逐字同一清单,只是哪些段
   *  进帧级缓存不同;段 tag 沿用旧编号）:
   *  结构段(equipStatsStructKey,帧级缓存)=甲/饰品/社交 20 槽+染料 10 槽的
   *  【id+prefix】(★prefix 是槽条目字段——2026-08-19 review 实证漏过:重铸换词缀
   *  不换 id = 键不变 = Warding→Arcane 数值陈旧,tests/equip-stats 的词缀用例
   *  当场红)+空槽 loadout 收藏候选+背包 I 档(2026-08-22 信息/机械饰品背包
   *  生效域 :12494-12500——只记 INV_EFFECTIVE_VIDS 命中格,未命中格不影响输出)
   *  +虚空袋 4131 在场位/vault 段。
   *  标量尾段(equipStatsTailKey,每访问现算)=extraAccessory(恶魔心→第 6 饰品位)
   *  +usedGummyWorm+世界旗(★IIIII224 巫师帽随从臂输入)+panicTime>0(受击加速
   *  300t 窗口,布尔)+controlDownHold+槽解锁/hide 位+buffs.active 键集合(getter
   *  对 buffs 的用法全是存在性判定 has()——时长到期=键集合变化自然失效)+炽灼
   *  三态+夜相+expert/master 门。
   *  内容键对一切写入方(测试直写槽位/控制台/未来新代码)天然免疫,无事件式
   *  失效可漏。★审计输入时勿只 grep this.*——槽条目对象字段(s.prefix)也是输入!
   *  ★IIIII250(2026-09-14):键值由字符串改【双独立 32 位 FNV 族哈希】——
   *  h1 质数 0x01000193(FNV-1a 标准质数)/h2 质数 0x27220a95,每段先混段 tag
   *  再混值;定长段(甲/染每槽固定 3 值)无跨界歧义,变长段(背包命中格/buffs/
   *  hide 位)以 tag+槽位/解锁位定界（清偿刀 P：hide 段=解锁位+解锁格 hide 位）。
   *  打包 (h1>>>0)*2^21+(h2>>>0 & 2^21-1)
   *  落在 [0,2^53-1] 精确整数域(=== 逐位比较,无浮点误差)。伪相等概率/对
   *  ≈2^-53,实际可达状态空间(换装/词缀/buff 组合远小于 2^53)期望碰撞≈0;
   *  失效合同:任一输入位变化→h1/h2 全域雪崩→键必变(概率意义)→【标量尾段
   *  逐访问立即重算;结构段≤1 拍自愈】(帧级缓存语义见 getter 注,六路锁测试为证)。 */
  private equipStatsStructKey(): number {
    const inv = this.inv;
    let h1 = 0x811c9dc5 | 0;
    let h2 = 0x9dc5811c | 0;
    const mix = (v: number): void => {
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 ^ v, 0x27220a95);
    };
    // R4-19（1457 P57:13015-13048 属性聚合走 GetEffectiveArmor）：共享段（跨配装
    // 收藏件填空槽）也是聚合输入——键段同步走 effective,否则共享件变更不失效缓存。
    // ★IIIII250 v3 键廉价化（页内组件基准定谳：30×getEffective≈234ns+背包 58 槽
    // 双遍扫描≈300ns 为大头，字符串拼接退役后仅占 ~0）：甲/染段改【裸槽打包混入
    // + 仅空槽扫 loadout 收藏候选】，背包段【单遍合并】I 档命中+4131 探测，
    // vid 查表内联（免逐槽方法调用）。超敏感化备案：候选混入不做 armorAccepts
    // 兼容门（GetEffectiveArmor 的 break 语义复刻代价>收益）——门拒绝的候选变更
    // 只多触发一次重算（computeEquipStats 纯幂等+immuneVanilla.add 幂等），缓存
    // 正确性不变；effective 真输入（候选 favorited/id/prefix 变更）仍全部进键。
    mix(1);
    const los = inv.loadouts;
    for (let i = 0; i < inv.armor.length; i++) {
      const s = inv.armor[i];
      mix(s ? (s.id * 256 + (s.prefix ?? 0)) : 0);
      if (!s) {
        for (let li = 0; li < los.length; li++) {
          const c = los[li].armor[i];
          if (c && c.favorited) { mix(1048576 + li * 32 + i); mix(c.id * 256 + (c.prefix ?? 0)); }
        }
      }
    }
    mix(2);
    for (let i = 0; i < inv.dye.length; i++) {
      const s = inv.dye[i];
      mix(s ? (s.id * 256 + (s.prefix ?? 0)) : 0);
      if (!s) {
        for (let li = 0; li < los.length; li++) {
          const c = los[li].dye[i];
          if (c && c.favorited) { mix(2097152 + li * 32 + i); mix(c.id * 256 + (c.prefix ?? 0)); }
        }
      }
    }
    // 背包生效域段（I 档,信息/机械饰品背包扫描 :12494-12500 的输入）+ 虚空袋
    // 4131 在场位探测（★F3）——★IIIII250 单遍合并：只记 INV_EFFECTIVE_VIDS
    // 命中格（vid+槽位）——未命中格不影响 computeEquipStats 输出，内容键对
    // 实际输入仍完备；4131 在场任一格即开 vault 段
    mix(9);
    let voidLens = false;
    for (let i = 0; i < inv.slots.length; i++) {
      const s = inv.slots[i];
      if (!s) continue;
      let vid = VID_BY_ITEM_ID[s.id];
      if (vid === undefined) {
        const d = ITEM_DEFS[s.id];
        vid = d ? (d.vid ?? -1) : -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
        VID_BY_ITEM_ID[s.id] = vid;
      }
      if (vid > 0 && INV_EFFECTIVE_VIDS.has(vid)) { mix(i); mix(vid); }
      if (vid === 4131) voidLens = true;
    }
    mix(10); mix(voidLens ? 1 : 0);
    if (voidLens) {
      const vault = this.banks[3];
      if (vault) {
        mix(11);
        for (let i = 0; i < vault.length; i++) {
          const s = vault[i];
          if (!s) continue;
          const vid = vidOfItemId(s.id);
          if (vid > 0 && !WORKS_IN_VOID_BAG_FALSE.has(vid)
            && (INV_EFFECTIVE_VIDS.has(vid) || MECH_ACC_VIDS.has(vid))) { mix(i); mix(vid); }
        }
      }
    }
    // 打包：两独立 32 位字 → 2^53 精确整数（h1 无符号全宽 ×2^21 + h2 低 21 位）
    return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 2097151);
  }

  /** ★IIIII251 标量尾段键（每访问现算,mid-frame 变化立即失效——不入帧级缓存,
   *  战斗中 buff 增删/panic 窗/昼夜翻转=高频面）。段 tag 沿用旧编号。 */
  private equipStatsTailKey(): number {
    let h1 = 0x811c9dc5 | 0;
    let h2 = 0x9dc5811c | 0;
    const mix = (v: number): void => {
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 ^ v, 0x27220a95);
    };
    mix(3); mix(this.inv.extraAccessory ? 1 : 0);
    mix(4); mix(this.usedGummyWorm ? 1 : 0);
    mix(5); mix(this.worldSeedFlags?.tenthAnniversary ? 1 : 0);
    mix(6); mix(this.panicTime > 0 ? 1 : 0);
    mix(7); mix(this.controlDownHold ? 1 : 0);   // shimmerImmune（5355 && !controlDownHold :15643）的输入
    // 配饰格可见性开关段（hideVisibleAccessory,Player.cs:1590——UpdateVisibleAccessories
    // :36361 !hide 门进 accDraw 聚合,翻转帧必须失效缓存;只记配饰段 3..9。
    // ★清偿刀 P：键面改逐槽解锁位(8/9)+解锁格 hide 位——锁槽的 hide 位与
    // accSlotMax 界均不进输出面（绘制/效果被 :12669-12690 门拦）,不入键;
    // 解锁位保证「大师无恶魔心」等开合翻转正确失效缓存）
    mix(8);
    mix(this.inv.isItemSlotUnlockedAndUsable(8) ? 1 : 0);
    mix(this.inv.isItemSlotUnlockedAndUsable(9) ? 1 : 0);
    for (let i = ACC_ARMOR_START; i < 10; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;
      mix(this.hideVisibleAccessory[i] ? 1 : 0);
    }
    // 吸血鬼炽灼三态（computeEquipStats 读 vampireBurningInSunlight/sunScorchCounter：
    // Molten buffImmune[24] 反门 :15883 + 120 档卸翅膀/火箭靴 :28186-28187——翻转帧
    // 必须失效缓存，否则 Molten 玩家点火帧拿着旧免疫把 AddBuff(24) 挡掉）
    mix(12);
    mix(this.vampireBurningInSunlight ? (this.sunScorchCounter >= 120 ? 2 : 1) : 0);
    // 夜/日食相位（月亮石 900 天界石复合门 :14871-14874——昼夜翻转帧必须重算）
    mix(13); mix(this.nightPhase ? 1 : 0);
    // ★清偿刀 U：expertOnly 效益门输入位（:13018/:14475 Main.expertMode——
    //   旅程滑杆改档翻转帧必须失效;gateExpert∨gateMaster ≙ World.isExpert≥EXPERT）
    mix(14);
    mix(this.inv.gateExpert ? 1 : 0);
    mix(this.inv.gateMaster ? 1 : 0);
    mix(15);
    for (const bt of this.buffs.active.keys()) mix(bt);
    return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 2097151);
  }

  /** ★IIIII251 结构段×标量尾段合成全键：两段各为 2^53 精确整数,按打包的逆运算
   *  精确拆半(floor//mod 2^21 对 <2^53 无浮点误差)后过一对 tag+同族 FNV 混合,
   *  防两段值域跨段别名。键值仅供自比较,数值形状与旧单段键无关——失效合同
   *  「任一输入位变→键必变」由两段各自雪崩+本合成混合保持。 */
  private combineEquipStatsKeys(structKey: number, tailKey: number): number {
    let h1 = 0x811c9dc5 | 0;
    let h2 = 0x9dc5811c | 0;
    const mix = (v: number): void => {
      h1 = Math.imul(h1 ^ v, 0x01000193);
      h2 = Math.imul(h2 ^ v, 0x27220a95);
    };
    mix(16);
    mix(Math.floor(structKey / 2097152)); mix(structKey % 2097152);
    mix(17);
    mix(Math.floor(tailKey / 2097152)); mix(tailKey % 2097152);
    return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 2097151);
  }

  private computeEquipStats(): PlayerEquipStats {
    // R4-19 裁决（1457 P57:13015-13048 逐行）：属性聚合 k=0..9 全走 GetEffectiveArmor
    // （GrantPrefixBenefits+GrantArmorBenefits）+ m=3..9 ApplyEquipFunctional 同——
    // 【共享件给全部属性】;"防空槽白嫖"由 GetEffectiveArmor 只填空槽 + CanShareArmor
    // （槽型/配件互斥门）承担。本函数全部 armor[] 读点统一走 effArmor。
    const effArmor = (slot: number) => this.inv.getEffectiveArmor(slot);
    /** 当前套装匹配（armor[0-2] 的 hs/bs/ls 槽序号 → ARMOR_SET_BONUSES 单表；通配
     *  `${hs}|${bs}|*` 兜底）。★BJ147 组D：返回【原始命中】（含 summonSetOnly 条目）——
     *  sb（setBonus）通道与 summonSet（召唤）通道共用一次查找,各自投影：
     *  ★组A 表批（2026-09-18）legs=0 空腿语义对齐（原版 TryCounting :189-199
     *  needed=0 腿位不计）：腿槽无件时回退 `*` 键（原 `*` 需腿件在场=登记债清偿;
     *  有件时仍先试具体键,与原 GetCompleteSet 单键首命中等价）。 */
    function activeArmorSetMatch(self: Player) {
      const st0 = statOfInternal(self.inv.getEffectiveArmor(0)?.id ?? -1);
      const st1 = statOfInternal(self.inv.getEffectiveArmor(1)?.id ?? -1);
      const st2 = statOfInternal(self.inv.getEffectiveArmor(2)?.id ?? -1);
      if (!st0?.hs || st1?.bs === undefined) return null;
      if (st2?.ls === undefined) return ARMOR_SET_BONUSES[`${st0.hs}|${st1.bs}|*`] ?? null;
      return ARMOR_SET_BONUSES[`${st0.hs}|${st1.bs}|${st2.ls}`]
        ?? ARMOR_SET_BONUSES[`${st0.hs}|${st1.bs}|*`] ?? null;
    }
    let def = 0, mana = 0, life = 0;
    // ★三百三十五刀:mod 配饰效果累加器(sw.accEffect 闭包直改;return 合并)
    const modAcc: import('../mods/hooks').ModAccAccumulator = { def: 0, mana: 0, life: 0, moveMult: 0, fish: 0, wingTime: 0 };
    this.modAccLight = null;   // ★三百六十五刀:每帧重置(accEffect 闭包重设)
    this.modIgnoreWater = false;   // ★四百七十二刀:同面重置(van 键形重设)
    this.modNoAggroTypes = null;   // ★四百七十四刀:同面重置(accEffect 整集重设)
    this.modLuckBonus = 0;   // ★五百零三刀:同面重置(accEffect 加算重设)
    this.modLavaImmune = false;   // ★五百八十六:同面重置(van.lavaImmune 重设)
    this.modMaxLifePct = 0;   // ★四百七十八刀:同面重置(accEffect 加算重设)
    let dmgMelee = 0, dmgRanged = 0, dmgMagic = 0;
    let critMelee = 0, critRanged = 0, critMagic = 0;
    let move = 0, meleeSpeed = 0, runSpeed = 0;
    let bootFx: 'hellfire' | 'sail' | 'cold' | 'desert' | 'fairy' | null = null;   // 跑靴尘型（:36285）
    let bootDyeVid = -1;   // cShoe 鞋染料 vid（尘 GetSecondaryShader 着色源）
    let fish = 0;             // fishingSkill（钓具配饰+渔夫甲）
    let setRunAccMul = 1, setMaxRunMul = 1, setRunSlowMul = 1;
    let shieldItem = false;   // 暗影套移动四参数(:26195)
    let setEndurance = 0, solarSet = false;   // 日曜套(:16224-16295)
    let setManaCostMul = 1;   // DD2 散件魔耗乘区(:12770-12775)
    // 魔力回复直值（ApplyEquipFunctional if-chain :14379-14383——魔力斗篷 982 专属）
    let manaRegenBonus = 0, manaRegenDelayBonus = 0;
    let extraFall = 0, lavaMax = 0, armorPen = 0, rocketBoots = 0;
    let autoJump = false, fireWalk = false, noKnockback = false, noFallDmg = false;
    let frostBurn = false; // 冰霜盔甲 46 套装引擎
    let anglerSetSpawnReduction = false;   // Player.anglerSetSpawnReduction（:2672）
    const immuneBuffs = new Set<number>(); // Player.buffImmune（十字章族装备扫描累积）
    let desertBoots = false, waterWalk = false, waterWalkLava = false, jumpBoost = false, panic = false, starCloak = false;
    const jumpSet = new Set<string>();
    let wing: { logic: number; slot: number; time: number; accSpeed: number; accelMult: number; hover: boolean; hidden: boolean } | null = null;
    let dash = 0, blackBelt = false, bees = false, carpet = false;
    let strongBees = false;   // 蜂巢背包 3333（:15457-15459，消费 beeType()/beeDamage()/beeKB()）
    let jumpSpd = 0, arrowDmg = 0;
    let equipHasQuiver = false;
    let wolfAcc = false, boc = false;
    let moltenQuiver = false;
    let shroomiteType: 'arrow' | 'bullet' | 'rocket' | null = null;
    let shroomiteSet = false, vortexSet = false, nebulaSet = false, beetleOff = false;
    let beetleDef = false;
    let spaceGun = false;   // R27：陨石套（123/124/125,ArmorSetBonuses :436）
    let flipper = false, longInvince = false;
    let spikedBoots = 0;   // ★SW-FX1：int 计数（Player.cs:1075；984 为 =2 赋值 quirk,见 vid 门）
    // ★SW-FX1 单件批四旗（jellyfishNecklace/boneGlove/sporeSac/volatileGelatin）
    let jellyfishNecklace = false, boneGlove = false, sporeSac = false, volatileGelatin = false;
    let canFloat = false;   // canFloatInWater（4404 甲件；buff265 在消费侧并集）
    let hasFloatingTubeVis = false;   // hasFloatingTube（4404 可见轮——功能槽 !hide 门 ∪ 社交槽无条件,注释见接口字段）
    let shimmerImmune = false;   // Player.shimmerImmune（5355 幻彩斗篷 :15643-46）
    let bobberOverride = -1;   // Player.overrideFishingBobber（:1920 初值 -1；浮漂饰品覆写）
  let killGuide = false, killClothier = false;   // 巫毒娃娃 267/1307(Player.cs UpdateEquips killGuide/killClothier)
  let dontHurtCrittersAcc = false;   // ★E（4767 善待小动物指南/5323 双件——RefreshMechanicalAccsFromItemType Player.cs:12922-12924）
  const infoAccs: InfoAccGates = emptyInfoAccGates(); // 信息饰品门禁(RefreshInfoAccs :12198)
  // ★F3 机械旗聚合器（GrantArmorBenefits 装备位 ∪ 背包 58 格 ∪ 虚空袋三路共用）
  const mech: MechanicalAccFlags = {
    mechShowWires: false, autoActuator: false, autoPaint: false, dontHurtCritters: false,
    preventAllItemPickups: false, hasLucyTheAxe: false, oldStyleParkour: false,
  };
    let treasureMagnet = false, goldRing = false, luckyCoin = false, discount = false;
    let ammoSaveHuntress = false, ammoSaveChloro = false, ammoSaveCost80 = false, ammoSaveCost75 = false;
    let kbGlove = false, yoyoString = false, autoReuseGlove = false;
    let meleeScaleGlove = false;   // Player.meleeScaleGlove（:2258）：手套族近战放大 ×1.1
    // 线饰品线色（Player.stringColor）：0=无——UpdateVisibleAccessory 逐槽后写覆盖前写
    //（Player.cs:36441-36449：5540/5541→29 在前、item.stringColor>0 在后，槽序 3-9→13-19）
    let stringColor = 0;
    let magmaStone = false;   // Player.magmaStone（:1850）：近战命中点燃（1322/1343）
    let titaniumStorm = false;   // ArmorSetBonuses.cs:222-225 Titanium（:461 三头盔变体）    let titaniumStorm = false;   // ArmorSetBonuses.cs:222-225 Titanium（:461 三头盔变体）
    let crystalLeaf = false;     // 叶绿水晶叶套（台账 L3 清偿批 2026-08-31,:128-146 四头变体）
    let onHitRegen = false;      // 帕拉钯全套 onHitRegen（ArmorSetBonuses.cs:217-220,终零波批）
    let onHitPetal = false;      // 山铜全套 onHitPetal 花瓣弹 221（:222-226,终零波批）
    let onHitDodge = false;      // 神圣套 onHitDodge 幻影闪避链（:228-236,终零波批）
    let ashWood = false;         // ★Notes④ Ash Wood 全套（vanillaArmorSets 'AshWood'→:27885/:27904）
    let iceSkate = false;      // Player.iceSkate（:1077 族）：冰面移动修正
    let tileSpeed = false, wallSpeed = false, tileRange = false, skyStone = false, pStone = false;
    let counterWeight = 0, vanityCounterWeight = 0;   // int 物品 id（0=无）
    let yoyoBag = false;   // 悠悠球袋(3366/5541):配重球颜色使用端掷(见类型注释)
    let yoyoGlove = false, magicString = false;
    let autoPaint = false, chiselSpeed = false, toolbelt = false;
    let hasDeadCellsDownDash = false;   // ★BJ534：重锤符文 5465（ApplyEquipFunctional case 5465 :14498-14501 hasDeadCellsDownDash=true）
    let flowerBoots = false;
    let stepStool = false;
    let manaMagnet = false, magicCuffs = false, manaFlower = false;
    let manaCostMul = 1;
    // 配饰审计 P0 批（2026-08-22）聚合位
    let fishingTackle = false, lavaFishing = false, royalGel = false, fishingLine = false;
    let manaCostOffAcc = 0, toolboxRange = 0, accDmgMinion = 0;
    let pickSpeedOff = 0;   // 挖矿速度折扣池（Mining 套 sb + accfx 甲件 pickSpeed 面,组A/B 批）
    let mechShowWires = false, autoActuator = false, magiluminescence = false;
    let iceBarrierAcc = false, lavaRose = false;
    let cordage = false;   // 植物纤维绳索宝典 3068（:14461-14463,割藤掉藤绳 2996 效果端）
    let divingHelm = false, merman = false;
    // ★组A/B 单件面批（2026-09-18）甲件行为旗聚合位（消费链见 PlayerEquipStats 字段注;
    //  声明须先于 divingHelm/nightVision 三件扫描环——同环夜视位读 nightVisionArmor）
    let moonLordLegsArmor = false, slowFallArmor = false, nightVisionArmor = false;
    let arcticDivingGear = false, jellyfishGlow = false;
    // ---- 1457 新配饰行为旗（ApplyEquipFunctional case 6166-6189 :14596-14739）----
    let accSentryBackpack = false, accGolemSentryBackpack = false;
    let accHarpyCharm = false, accSeraphNecklace = false, hasPhoenixQuiver = false;
    let accSnappingStone = false, accPyroclast = false, accArmletOfRuin = false;
    let accPoisonBarb = false, accHoneyedBarb = false, catalystBand = false;
    let accSharpBarb = false, mysticSashDodge = false, accTimerCrit = false;
    let shinyStone = false;   // 闪亮石 3337（:14874-14876——regen ×1.1 + 静止整段）
    let empressBrooch = false;   // ★BJ216 翱翔徽章 4989（:14877-14881;四消费端见接口注）
    let crimsonRegen = false;   // 老猩红甲套（ArmorSetBonuses.cs:433,检测在下方甲槽段）
    let ammoCyclerMode = 0;   // PlayerAmmoCyclingMode（PlayerAmmoCyclingMode.cs:None=0/AmmoSlots=1/FullInventory=2/Random=3）
    // ---- 召唤师链聚合位（vanillaSummonStats：ApplyEquipFunctional armor[0-9] 单遍语义 =
    //      盔甲三件 + 配饰各扫一遍 SUMMON_GEAR；套装查 vanillaArmorSets 单表召唤通道）——
    //      声明须在配饰循环前：1457 侦察背包 6175（:14670-14677）在循环内直加 minionDmg ----
    let minionSlots = 0, minionDmg = 0, minionKB = 0, sentrySlots = 0, whipRange = 0;
    // ---- 身上贴图绘制槽 + 仇恨轴（配饰审计系统性批 2026-08-22）----
    let aggroAcc = 0;
    let voiceOverrideAcc = 0;   // 语音饰品 override（两轮槽扫逐槽直赋,后写覆盖前写同原版）
    const accDraw = {
      back: 0, front: 0, shield: 0, shoe: 0, waist: 0, neck: 0, face: 0,
      faceMask: 0, faceFlower: 0, faceHead: 0,
      balloon: 0, balloonFront: 0, handOn: 0, handOff: 0, beard: 0,
      backpack: 0, tail: 0,
      dyeBack: -1, dyeFront: -1, dyeShield: -1, dyeShoe: -1, dyeWaist: -1,
      dyeNeck: -1, dyeFace: -1, dyeFaceMask: -1, dyeFaceFlower: -1, dyeFaceHead: -1,
      dyeBalloon: -1, dyeBalloonFront: -1,
      dyeHandOn: -1, dyeHandOff: -1, dyeBeard: -1, dyeBackpack: -1, dyeTail: -1,
      dyeFloatingTube: -1,   // ★BJ423：cFloatingTube（UpdateItemDye :9815-9818——4404 专通道,非槽族不走 accDrawSlotsOf 路由,两环直写）
    };
    /** 槽 → 族赋值（UpdateVisibleAccessory :36451-36520 后写覆盖语义 + back 披风
     *  清 front :36468-36471；face 槽按 ArmorIDs.Face.Sets 分流 face/mask/flower/
     *  head 四层——本仓单层合并,head 层并入 face（同锚同帧,登记偏差））。
     *  ★dyeOnly（R4-acc0-①）：hidden num 名单直通模式——视觉槽不写（原版可见轮
     *  :36361 !hide 门独立于 UpdateItemDye）,仅染料通道照写（UpdateItemDye :9714
     *  `!num&&flag` 早退的 num 豁免 :9708）;back 披风的 front 互斥清写亦跳过
     *  （那是 :36468-36471 可见轮语义,UpdateItemDye 无此臂）。 */
    const accDrawApply = (s: { id: number }, slotIdx: number, dyeOnly = false): void => {
      const d = ITEM_DEFS[s.id];
      const vid = d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
      const ds = accDrawSlotsOf(vid);
      if (!ds) return;
      const dyeItem = this.inv.getEffectiveDye(slotIdx % 10);   // UpdateItemDye :9696 走 GetEffectiveDye
      const dyeVid = dyeItem ? (ITEM_DEFS[dyeItem.id]?.vid ?? -1) : -1;
      if (ds.handOn) { if (!dyeOnly) accDraw.handOn = ds.handOn; accDraw.dyeHandOn = dyeVid; }
      if (ds.handOff) { if (!dyeOnly) accDraw.handOff = ds.handOff; accDraw.dyeHandOff = dyeVid; }
      if (ds.back) {
        // Back 子层三路由（UpdateVisibleAccessory :36455-36466）：DrawInBackpackLayer
        // → Player.backpack / DrawInTailLayer → Player.tail（两者不占 back 不清 front）/
        // 其余（披风族）→ back + front=-1 互斥清写
        if (BACK_DRAW_IN_BACKPACK.has(ds.back)) { if (!dyeOnly) accDraw.backpack = ds.back; accDraw.dyeBackpack = dyeVid; }
        else if (BACK_DRAW_IN_TAIL.has(ds.back)) { if (!dyeOnly) accDraw.tail = ds.back; accDraw.dyeTail = dyeVid; }
        else if (dyeOnly) { accDraw.dyeBack = dyeVid; }
        else { accDraw.back = ds.back; accDraw.dyeBack = dyeVid; accDraw.front = 0; accDraw.dyeFront = -1; }
      }
      if (ds.front) { if (!dyeOnly) accDraw.front = ds.front; accDraw.dyeFront = dyeVid; }
      if (ds.shoe) { if (!dyeOnly) accDraw.shoe = ds.shoe; accDraw.dyeShoe = dyeVid; }
      if (ds.waist) { if (!dyeOnly) accDraw.waist = ds.waist; accDraw.dyeWaist = dyeVid; }
      if (ds.shield) { if (!dyeOnly) accDraw.shield = ds.shield; accDraw.dyeShield = dyeVid; }
      if (ds.neck) { if (!dyeOnly) accDraw.neck = ds.neck; accDraw.dyeNeck = dyeVid; }
      if (ds.face) {
        // face 四层路由（UpdateVisibleAccessory :37216-37230 逐槽分流，★1457
        // ArmorIDs.cs:2143-2150 集合）：head 层（12/10/13/11 骷髅族）→ faceHead /
        // mask 22 → faceMask / flower 1,6,8,9 → faceFlower / 余（base ∪ underHair 5
        // 同字段）→ face。四字段各存该路由最后一件（逐槽后写覆盖前写），同帧可并存
        // 至多四件；染料逐族随路由（UpdateItemDye :9774-9788 cFaceHead/cFaceMask/
        // cFaceFlower/cFace）。头盔互斥/换档门（PlayerFrame :36252-36271）按帧在
        // 渲染侧 resolveFaceLayers 应用（head 随狼/人鱼强改在纸娃娃装备侧）
        if (FACE_HEAD_LAYER.has(ds.face)) { if (!dyeOnly) accDraw.faceHead = ds.face; accDraw.dyeFaceHead = dyeVid; }
        else if (FACE_MASK_LAYER.has(ds.face)) { if (!dyeOnly) accDraw.faceMask = ds.face; accDraw.dyeFaceMask = dyeVid; }
        else if (FACE_FLOWER_LAYER.has(ds.face)) { if (!dyeOnly) accDraw.faceFlower = ds.face; accDraw.dyeFaceFlower = dyeVid; }
        else { if (!dyeOnly) accDraw.face = ds.face; accDraw.dyeFace = dyeVid; }
      }
      if (ds.beard) { if (!dyeOnly) accDraw.beard = ds.beard; accDraw.dyeBeard = dyeVid; }
      if (ds.balloon) {
        // DrawInFrontOfBackArmLayer（ArmorIDs.cs:2213={18}）→ balloonFront,余 → balloon
        if (BALLOON_TORSO_FRAMING.has(ds.balloon)) { if (!dyeOnly) accDraw.balloonFront = ds.balloon; accDraw.dyeBalloonFront = dyeVid; }
        else { if (!dyeOnly) accDraw.balloon = ds.balloon; accDraw.dyeBalloon = dyeVid; }
      }
    };
    // 仇恨轴（ApplyEquipFunctional case 内 aggro ±400 直赋——功能槽 only,
    // 社交槽 ApplyEquipVanity 无 aggro）
    const AGGRO_NEG = new Set([3015, 3991, 4005, 4006, 6175]);   // 6175 侦察哨兵背包（★1457 :14670-14677 aggro-=400;V6 复核补）
    const AGGRO_POS = new Set([3016, 3992, 3998]);
    for (let i = ACC_ARMOR_START; i < 10; i++) {   // ★清偿刀 P：段恒 3..9,逐槽 :13044 门
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // :12669-12690（锁槽不结算不显）
      const s = effArmor(i);   // R4-19：功能配饰聚合走 GetEffectiveArmor（:13044-13048）
      if (!s) continue;
      const sVid = (ITEM_DEFS[s.id]?.vid ?? -1);
      // ★清偿刀 U（2026-09-29）：expertOnly 门【不】遮的两臂先结算——画廊臂
      //  （UpdateVisibleAccessories :36331-36351）与线色臂（UpdateVisibleAccessory
      //  :36441-36449）原版无 expertOnly 门（UpdateEquips_CanItemGrantBenefits/
      //  ApplyEquipFunctional 头两门都不在可见轮上）：专家档配饰经典世界仍上身
      //  照画/照染线,只是零效益。两臂与后段写互不叠写（独立变量,槽序即写序）,
      //  提序不改语义。
      // ★R4-acc0-①（2026-09-30）：hidden num 名单染料直通（UpdateItemDye
      //   :9708-9717——num=wingSlot>0∨{934,4341,5126,4563,1987} 时 `!num∧flag`
      //   早退豁免=隐藏仍染;视觉槽仍被可见轮 :36361 !hide 门挡住=只染不显）。
      //   R4 双旗族进功能段后 1987/4563 使该缝新可达。翼 face=wingDyeVid 无 hide
      //   门（:1758）=cWings num 豁免同相,不在此重复落位。
      if (sVid > 0) {
        if (!this.hideVisibleAccessory[i]) accDrawApply(s, i);
        else if (HIDDEN_DYE_NUM.has(sVid) || (statOfInternal(s.id)?.wing ?? 0) > 0) {
          accDrawApply(s, i, true);
        }
      }
      if (sVid === 5540 || sVid === 5541) stringColor = 29;
      const funcStrV = statOfInternal(s.id)?.str;
      if ((funcStrV ?? 0) > 0) stringColor = funcStrV!;
      // 浮游圈管体可见旗+染料（UpdateVisibleAccessory :37265-37268 在 !hide 门内
      // :36362-36364;染料 UpdateItemDye :9815-9818,num/flag 门 :9714——功能槽隐藏
      // 时 `!num&&flag` 早退=染料也不写,同门合并）——置于 expertOnly 门【前】
      // （可见轮/染轮均无该门,清偿刀 U 同臂;浮力旗 canFloat 仍走下方门后
      // =ApplyEquipFunctional :13364 门语义）
      if (sVid === 4404 && !this.hideVisibleAccessory[i]) {
        hasFloatingTubeVis = true;
        const tubeDyeItem = this.inv.getEffectiveDye(i % 10);   // UpdateDyes :9697 num=i%10
        accDraw.dyeFloatingTube = tubeDyeItem ? (ITEM_DEFS[tubeDyeItem.id]?.vid ?? -1) : -1;
      }
      // ★清偿刀 U：expertOnly 效益门——k-loop :13017-13018
      //  `(!effectiveArmor.expertOnly || Main.expertMode)`（GrantPrefixBenefits+
      //  GrantArmorBenefits 全效益）+ ApplyEquipFunctional 头 :14475-14478 整函数
      //  早退（本循环余下全部臂=该两原版函数的内容物：行为旗/aggro/语音/免疫/
      //  翅膀/悠悠球/def/life/词缀 62-80；RefreshInfo/Mechanical 由 GrantArmorBenefits
      //  :13204-13205 载体,同门）。Main.expertMode ≙ gateExpert∨gateMaster
      //  （World.isExpert = difficulty ≥ EXPERT,大师含）。命中即 continue =
      //  原版两门逐槽合取的最短路径。
      if (ITEM_DEFS[s.id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) continue;
      const fx = accFxOfInternal(s.id);
      // ★B6 六十七刀:mod 配饰 UpdateEquip 加法面读侧(STATS 表→equipStats 同名域;
      //  dmgX=加法 +0.05 形(:2386 同构)/life=lifeRegen 语义)。mod 段守卫=vanilla
      //  件 life 已走 fx.life(:2429),不守卫=vanilla 再生系双计。
      const mvid = ITEM_DEFS[s.id]?.vid ?? -1;
      if (mvid >= MOD_ITEM_STABLE_BASE) {
        const mst = statOfInternal(s.id);
        if (mst) {
          if (mst.life) life += mst.life;
          if (mst.dmgMelee) dmgMelee += mst.dmgMelee;
          if (mst.dmgRanged) dmgRanged += mst.dmgRanged;
          if (mst.dmgMagic) dmgMagic += mst.dmgMagic;
          if (mst.dmgAll) { dmgMelee += mst.dmgAll; dmgRanged += mst.dmgAll; dmgMagic += mst.dmgAll; }
          if (mst.critMelee) critMelee += mst.critMelee;
          if (mst.critRanged) critRanged += mst.critRanged;
          if (mst.critMagic) critMagic += mst.critMagic;
          if (mst.moveMult) move += mst.moveMult;
          if (mst.endurance) setEndurance += mst.endurance;
        }
      }
      // 巫毒娃娃(Player.cs:8801 killGuide / :8804 killClothier):装备即置位——
      // 玩家弹幕/近战对向导(22)/裁缝师(54) 的伤害门(Projectile.cs:11970-11972)
      // ★三百三十五刀:mod 配饰效果钩(mod vid 域 30000+;零注册零开销;
      //  game=__swGame 全局面——环宿主无 game 形参,窗面单例取)
      runModAccEffect(s.id, this, (globalThis as { __swGame?: unknown }).__swGame, modAcc);
      const accVid = (ITEM_DEFS[s.id]?.vid ?? -1);
      // 语音饰品（ApplyEquipFunctional :14485-14491：currentItem.voiceSlot!=0 →
      // voiceOverride=voiceSlot,!hideVisibleAccessory[itemSlot] 门内——隐藏的语音
      // 饰品不生效;逐槽直赋=后写覆盖前写）
      const vSlot = voiceSlotOfItem(accVid);
      if (vSlot > 0 && !this.hideVisibleAccessory[i]) voiceOverrideAcc = vSlot;
      // 身上贴图绘制槽（UpdateVisibleAccessories :36331-36351 功能槽轮 + !hide 门
      // :36361——per-slot 隐藏开关已建模（hideVisibleAccessory,眼睛图标只藏贴图,
      // 功能效果 ApplyEquipFunctional :13962 独立扫不受影响）;社交槽 13-19 轮在
      // 下方独立 for,原版无 hide 门）
      // ★清偿刀 U：accDrawApply 已提序到循环头 expertOnly 门之前（原版可见轮
      //   :36331 无 expertOnly 门,专家档配饰经典世界照画）——此处不再重复结算。
      // 仇恨轴（aggro ±400 七件,见 PlayerEquipStats.aggroAcc 注）
      if (AGGRO_NEG.has(accVid)) aggroAcc -= 400;
      else if (AGGRO_POS.has(accVid)) aggroAcc += 400;
      if (accVid === 4404) canFloat = true;   // 水上漂靴（ApplyEquipFunctional :12842-12846）
      if (accVid === 5355 && !this.controlDownHold) shimmerImmune = true;   // 幻彩斗篷（:15643-46——按住下 45t 例外 = 主动浸微光）
      if (accVid === 3068) cordage = true;   // 绳索宝典（UpdateEquips :14461-14463 currentItem.type==3068 → cordage=true）
      // ---- ★SW-FX1 单件批四件（2026-09-09,均 UpdateEquips if-chain 装备位）----
      if (accVid === 1303) jellyfishNecklace = true;                 // 水母项链（:15339-15348,双支 AddLight——Game 光照段）
      if (accVid === 3245) boneGlove = true;                         // 骨头手套（:14660-14662 case 3245 boneGloveItem=currentItem）
      if (accVid === 3336) sporeSac = true;                          // 孢子囊（:14884-14886 SporeSac(currentItem)+sporeSac=true）
      if (accVid === 4987) volatileGelatin = true;                   // 挥发明胶（:14888-14890 VolatileGelatin(currentItem)+volatileGelatin=true）
      // ★BJ216 翱翔徽章（:14877-14881 empressBrooch=true——原版此 case 同置
      //  moveSpeed += 0.075f,数据面 vanilla-accfx.json '4989'.move→fx.move→moveMult 已消费）
      if (accVid === 4989) empressBrooch = true;
      // 984 老虎攀爬档【赋值】quirk（:15176-15181 blackBelt/dashType=1 走 accfx,
      // spikedBoots = 2 原文是赋值非 +=——覆盖此前 953/975/976 累积）
      if (accVid === 984) spikedBoots = 2;
      if (accVid === 5465) hasDeadCellsDownDash = true;   // 重锤符文下砸链（★BJ534 :14498-14501——下砸触发谓词装备源）
      if (accVid === 4341 || accVid === 5126) stepStool = true;   // 折叠凳/造物之手（:14077-14080，Player 侧 SetStats 非物品字段）
      // 天界石复合门（1457 :15531-15535 / 1458 :15529-15533 双版同值）：太阳石 899
      // `Main.dayTime`（日食中 dayTime 仍真 → 日食期关闭）、月亮石 900
      // `(!Main.dayTime || Main.eclipse)`。本仓 nightPhase ≙ !isDay||eclipse（Game
      // 每帧灌入 :4576）⇒ !nightPhase ≙ day&&!eclipse 精确等价；昼夜/日食翻转帧由
      // equipStats 内容键 'N'/'d' 位失效缓存。
      if (accVid === 899 && !this.nightPhase) skyStone = true;
      if (accVid === 900 && this.nightPhase) skyStone = true;
      if (accVid === 267) killGuide = true;
      else if (accVid === 1307) killClothier = true;
      // 浮漂饰品 5139-5146（Player.cs:14121-14124 accFishingBobber → fishingSkill+10
      // :12552-12554；UpdateFishingBobber :36244-36272 → overrideFishingBobber=986+(vid-5139)）
      if (accVid >= 5139 && accVid <= 5146) {
        fish += 10;
        bobberOverride = Math.max(bobberOverride, 986 + (accVid - 5139));
      }
      // 十字章免疫族（Player.cs:14911-15003 buffImmune 逐件赋值——vanilla buff id）
      const immune = IMMUNE_ACC[accVid];
      if (immune) immune.forEach((b) => immuneBuffs.add(b));
      // 信息饰品门禁(Player.cs:12486 UpdateEquips→RefreshInfoAccsFromItemType)
      if (accVid > 0) refreshInfoAccsFromItemType(infoAccs, accVid);
      // ★F3 机械族装备位面（vanilla GrantArmorBenefits :13204-13206 对 armor[0-9]
      // 每槽调 RefreshMechanicalAccsFromItemType——4767/5323 戴着即生效,曾只覆盖
      // 背包携带面;机械透镜等装备位此前走 accfx 直表,本行补齐 dontHurtCritters 族）
      if (accVid > 0) refreshMechanicalAccsFromItemType(mech, accVid);
      // 翅膀（Item.wingSlot>0 → WingStatsInitializer 全字段；多翅膀【后槽胜出】——
      // 原版 :12578-12586 for n=3..10 循环内直赋 wings/wingsLogic,后写覆盖前写;
      // 曾 `!wing` 先到先得 = 槽序反向偏差,2026-08-22 审计系统性批修）
      const wingSlot = statOfInternal(s.id)?.wing;
      if (wingSlot && wingSlot > 0) {
        const ws = wingStatOf(wingSlot);
        // 隐藏翼门（UpdateEquips :12577-12586）：!hideVisibleAccessory[n] 才写
        // wings（视觉）,wingsLogic 恒写;隐藏翼不覆盖前槽可见翼（gate 败=保持旧值）。
        // hidden 随翼记录,渲染侧补 vy≠0 且未骑坐骑的显形特例（:12580 vy 项不入
        // 记忆化键,只能在消费侧判）
        const wingHidden = this.hideVisibleAccessory[i] ?? false;
        if (!wingHidden || !wing) {
          wing = { logic: wingSlot, slot: wingSlot, time: ws.time + modAcc.wingTime, accSpeed: ws.accSpeed, accelMult: ws.accelMult, hover: ws.hover, hidden: wingHidden };
        }
      }
      // 悠悠球线（Item.stringColor>0 → yoyoString，Player.cs:14170）
      if (statOfInternal(s.id)?.str) yoyoString = true;
      // 线色（Player.cs:36441-36449 UpdateVisibleAccessory）两行已提序到循环头
      // expertOnly 门之前（★清偿刀 U：可见面不设门,funcStrV 同 str 源）。
      // ---- 悠悠球袋族（Player.cs:14174-14226 ApplyEquipFunctional if-chain；提取器
      //      default 区间段抓不到，此处 vid 直表）。★配重球掷骰(1/7→1079 黑/
      //      556+Next(6) 彩,:14176/:14200)2026-08-19 迁消费端 rollYoyoCounterweight:
      //      原版 ResetEffects 每帧清零重掷 = 使用期随机;getter 记忆化会把它冻结成
      //      "每套装备一次",故此处只标 yoyoBag 旗,Counterweight 命中时掷 ----
      if (accVid === 3366) {   // 悠悠球袋（:14174-14189）
        yoyoBag = true;
        yoyoGlove = true;
        yoyoString = true;
      }
      if (accVid === 5540) magicString = true;   // 魔法线（:14195-14197）
      if (accVid === 5541) {   // 魔法悠悠球袋（:14199-14214 段：袋旗同 3366 + 全套旗）
        yoyoBag = true;
        yoyoGlove = true;
        yoyoString = true;
        magicString = true;
      }
      if (accVid === 5547) counterWeight = 1079;              // 黑配重球（:14215-14218）
      if (accVid >= 3309 && accVid <= 3314) counterWeight = 556 + accVid - 3309;  // 彩色配重球（:14219-14222）
      if (accVid === 3334) yoyoGlove = true;                  // 悠悠球手套（:14223-14226）
      // ---- 1457 新配饰行为旗（ApplyEquipFunctional case 6166-6189 :14596-14739;
      //      数值主属性走下方 accfx/SUMMON_GEAR 链,此处只收行为布尔/模式）----
      //  消费端落点（蓝队 R2-14 勘误：下四项曾标"登记未接",实均已接）：
      //  · accHarpyCharm 6166/6180/6181——弧线引矢三段已接（Arrow.ts harpyCharmEffect
      //    :2703 扫 arrow 弹改向 + 冷却 90t/6180 ×0.8=72）
      //  · accSnappingStone 6167——远程命中触发已接（Arrow.ts 命中环 trySnapStrike
      //    kind0;脉冲本体 stats/SnapStrike）
      //  · ammoCyclerMode 6168-6194——弹药轮换本体已接（Player.ts pickAmmoSlot +
      //    noteAmmoCycledShot :1940-1955,PickAmmo_IterateRange :54330-54389）
      //  · accTimerCrit 6170——时间蓄能暴击已接（Game.ts 近战命中 tryConsumingTimerCrit）
      //  · accSentryBackpack 6172/6175/6176/6177——哨兵携带全链已接（2026-09-03 批）：
      //    拾起门 CanGetPickedUpBySentryBackpack（Projectile.cs:80532-80552）+ 续约
      //    SetAsSelectedSentryBackpackTarget（:80554-80557,MinionProj 携带支每拍=2,
      //    Player Update_SentryBackpack :28640-28646 递减）+ 重定位 AI_Sentries_
      //    HeavySlingReposition（:70096-70470,MinionProj.heavySlingReposition 1:1,
      //    per-aiStyle/per-type 落位几何）+ 各 AI 携带支朝向/旋转/探测盒差异——
      //    6172/6175/6176/6177 仅装备面数值差异（:14612-14685）,全四件同旗
      if (accVid === 3337) shinyStone = true;                                      // 闪亮石（:14874-14876）
      else if (accVid === 3333) strongBees = true;                                 // 蜂巢背包（:15457-15459 strongBees）
      else if (accVid === 6166) { accHarpyCharm = true; critRanged += 5; }         // 鹰妖护符（:14596-14599）
      else if (accVid === 4002) moltenQuiver = true;                               // 熔火箭袋（:14049-14052 hasMoltenQuiver——
                                                                                   //   accfx 表缺标 moltenQuiver 旗,此处补：
                                                                                   //   木箭→火矢 +2 伤 PickAmmo :52702-52705）
      else if (accVid === 6167) accSnappingStone = true;                           // 拍击石（:14600-14602）
      else if (accVid === 6170) accTimerCrit = true;                               // 计时暴击（:14603-14605,登记未接）
      else if (accVid === 6160) { accSharpBarb = true; critRanged += 8; }          // 锐刺（:14606-14608 rangedCrit+8 :13062-13066）
      else if (accVid === 6165) accPoisonBarb = true;                              // 毒刺（:14609-14611）
      else if (accVid === 6168) { ammoCyclerMode = 1; dmgRanged += 0.08; }         // 弹药循环·四格（:14634-14637）
      else if (accVid === 6169) { ammoCyclerMode = 2; dmgRanged += 0.08; }         // 弹药循环·全背包（:14638-14641）
      else if (accVid === 6193) { ammoCyclerMode = 3; dmgRanged += 0.08; }         // 弹药循环·随机（:14642-14645）
      else if (accVid === 6194) { ammoCyclerMode = 0; dmgRanged += 0.08; }         // 弹药循环·禁用（:14646-14648）
      //  ^ 四件共 accAmmoCyclerDamage → rangedDamage += 0.08（:13054-13057 UpdateEquips 段）
      else if (accVid === 6172) accSentryBackpack = true;                          // 重携哨兵背包（:14612-14614）
      else if (accVid === 6175) {                                                  // 侦察背包（:14670-14677）
        accSentryBackpack = true;
        dmgMelee += 0.05; dmgMagic += 0.05; dmgRanged += 0.05; minionDmg += 0.05;  //   四系伤+5%+ aggro−400（★★终零波批注订正：仇恨轴在上方 AGGRO_NEG 表已接,V6 复核批落位）
      } else if (accVid === 6176) {                                                // 圣殿骑士背包（:14678-14681）
        accSentryBackpack = true;
        accGolemSentryBackpack = true;                                             //   sentry/SentryShot 10% 强制暴击（:12963-12967）
      } else if (accVid === 6177) { accSentryBackpack = true; noKnockback = true; } // 皇家卫队背带（:14682-14685）
      else if (accVid === 6178) { magmaStone = true; accPyroclast = true; }        // 焰爆石（:14686-14689）
      else if (accVid === 6179) accArmletOfRuin = true;                            // 毁灭臂镯（:14690-14693;6159 旗走 SUMMON_GEAR）
      else if (accVid === 6180) {                                                  // 炽天使项链（:14694-14698）
        accHarpyCharm = true; longInvince = true; accSeraphNecklace = true;
      } else if (accVid === 6181) {                                                // 凤凰箭袋（:14699-14704）
        accHarpyCharm = true; hasPhoenixQuiver = true; moltenQuiver = true;
        equipHasQuiver = true; arrowDmg += 0.1;
      } else if (accVid === 6182) {                                                // 邪恶之爪（:14705-14710）
        autoReuseGlove = true; meleeSpeed += 0.12;
      } else if (accVid === 6183) { noKnockback = true; fireWalk = true; }         // 白银之盾（:14711-14715;6156 旗走 SUMMON_GEAR）
      else if (accVid === 6184) { accPoisonBarb = true; accHoneyedBarb = true; bees = true; } // 蜜刺（:14716-14719 honeyCombItem→bees 受击放蜂）
      else if (accVid === 6185) { accPoisonBarb = true; pStone = true; catalystBand = true; } // 催化指环（:14720-14725）
      else if (accVid === 6186) { starCloak = true; }                              // 德鲁伊蛇斗篷（:14726-14729;6157 旗走 SUMMON_GEAR）
      else if (accVid === 6187) { panic = true; longInvince = true; }              // 十字心项链（:14730-14733）
      else if (accVid === 6188) noKnockback = true;                                // 复原之盾（:14734-14736;1457 case 只置 noKnockback——缓回+法40 走 vanilla-accfx.json '6188' mana40/regen60,已生效）
      else if (accVid === 6189) mysticSashDodge = true;                            // 神秘艺术腰布（:14737-14739）
      // ★UpdateEquips_CanItemGrantBenefits :12977-12985（case 3-9 = item.accessory）——
      //   GrantArmorBenefits（:13220 def/:13221 lifeRegen）与 GrantPrefixBenefits
      //   （:13020-13022）两支的受理门；ApplyEquipFunctional :13046 只门槽位解锁，
      //   勿上提到整圈（行为旗/绘制槽会被误伤）。谓词 = vanilla accessory 旗等价：
      //   acc 1 功能/0 社交【都】设 accessory=true（SetDefaults 抽查 208/1987/2276/
      //   2501 均 accessory=true+vanity=true）故取 acc 有定义而非 acc===1;legacy 走
      //   accessory 效果标签——UI 面 armorAccepts 已拦非配饰,此处为存档异常兜底
      const grantArmorBenefits = statOfInternal(s.id)?.acc !== undefined || !!ITEM_DEFS[s.id]?.accessory;
      // 生命回复优先取 Item.lifeRegen 字段（再生手环族，GrantArmorBenefits :12700），
      // accfx.life 为 if-chain 段的 lifeRegen += N
      const itemLife = statOfInternal(s.id)?.life ?? 0;
      if (grantArmorBenefits && itemLife) life += itemLife;
      // ★item.defense 面（GrantArmorBenefits :13220 statDefense += armorPiece.defense——
      //   原版 UpdateEquips :13015-13026 k=0..9 全装备槽统一加算；盔甲 0-2 走 defense
      //   getter 的 equippedArmor()，此处只补配饰段 3..9（逐槽 :13044 门）防双计。曾整面缺失=
      //   脚镣/钴盾/黑曜石骷髅/黑曜石盾/圣骑士盾/魔力手铐/天界手铐/肉拳/克苏鲁盾/
      //   狂战士手套/冰冻盾/英雄盾/6177/6183 防御不叠，仅 6188 由 BEHAVIOR_FX 硬补）
      const itemDef = statOfInternal(s.id)?.def ?? 0;
      if (grantArmorBenefits && itemDef) def += itemDef;
      if (fx) {
        if (fx.def) def += fx.def;
        if (fx.mana) mana += fx.mana;
        if (fx.life) life += fx.life;
        if (fx.move) move += fx.move;
        if (fx.fish) fish += fx.fish;
        if (fx.shield) shieldItem = true;   // 钓具族+渔夫甲 fishingSkill（:12549-12556/:14115-14140/:13022-13027）
        if (fx.meleeSpd) meleeSpeed += fx.meleeSpd;
        if (fx.runSpeed) {
          runSpeed = Math.max(runSpeed, fx.runSpeed);
          // 跑靴奔跑尘型（SpawnFastRunParticles :36285-36320 switch——按装备 vid 授予；
          // 后装覆盖先装，原版 CancelAllBootRunVisualEffects 语义）
          const vidDef = ITEM_DEFS[s.id];
          const vid = vidDef ? (vidDef.vid ?? -1) : -1;
          bootFx = vid === 4874 ? 'hellfire'
            : vid === 3200 || vid === 3990 ? 'sail'
            : vid === 1579 ? 'cold'
            : vid === 4055 ? 'desert'
            : vid === 3993 ? 'fairy' : null;
          // 跑靴染料（cShoe :9355-9369：shoeSlot 装备所在槽的 dye → GetSecondaryShader）
          const dyeS = this.inv.dye[i % 10];
          bootDyeVid = dyeS ? (ITEM_DEFS[dyeS.id]?.vid ?? -1) : -1;
        }
        if (fx.dmgMelee) dmgMelee += fx.dmgMelee;
        if (fx.dmgRanged) dmgRanged += fx.dmgRanged;
        if (fx.dmgMagic) dmgMagic += fx.dmgMagic;
        if (fx.dmgAll) { dmgMelee += fx.dmgAll; dmgRanged += fx.dmgAll; dmgMagic += fx.dmgAll; }
        if (fx.critMelee) critMelee += fx.critMelee;
        if (fx.critRanged) critRanged += fx.critRanged;
        if (fx.critMagic) critMagic += fx.critMagic;
        // ---- 行为型（ApplyEquipFunctional 布尔/数值字段）----
        if (fx.extraFall) extraFall += fx.extraFall;
        if (fx.lavaMax) lavaMax += fx.lavaMax;       // 熔岩护身符族：叠加（lavaMax += 420）
        if (fx.armorPen) armorPen += fx.armorPen;
        if (fx.rocketBoots) rocketBoots = Math.max(rocketBoots, fx.rocketBoots);
        if (fx.autoJump) autoJump = true;
        if (fx.fireWalk) fireWalk = true;
        if (fx.noKnockback) noKnockback = true;
        if (fx.noFallDmg) noFallDmg = true;
        if (fx.desertBoots) desertBoots = true;
        // ★BJ227：waterWalk2 源（863/907）并入 waterWalk（液面钉位/StepDown 液面臂
        // 两源同权,原版消费面 `waterWalk || waterWalk2`）——纯 waterWalk 源单独记
        // waterWalkLava（岩浆面钉位 + Lava 探针缩高 6px 仅熔岩护足/泰拉靴/药水族）
        if (fx.waterWalk) { waterWalk = true; waterWalkLava = true; }
        if (fx.waterWalk2) waterWalk = true;
        if (fx.jumpBoost) jumpBoost = true;
        if (fx.panic) panic = true;
        if (fx.starCloak) starCloak = true;
        if (fx.dashType) dash = Math.max(dash, fx.dashType);
        if (fx.blackBelt) blackBelt = true;
        if (fx.bees) bees = true;
        if (fx.carpet) carpet = true;
        // jumpSpeedBoost 叠加语义（Player.jumpSpeedBoost float 累加字段 :2590,
        // ResetEffects :18605 清零后逐件 += 1.6：2423 :14250 / 3990 :13986 /
        // 3994-3996 :14011-14024——蛙腿+两栖靴同戴 = +3.2。曾 Math.max 取单件）
        if (fx.jumpSpd) jumpSpd += fx.jumpSpd;
        if (fx.arrowDmg) arrowDmg += fx.arrowDmg; // 箭袋 +0.1（仅箭吃，见 rangedDamageMult）
        if (fx.nightWolf) wolfAcc = true;
        if (fx.quiver) equipHasQuiver = true;
        if (fx.moltenQuiver) moltenQuiver = true;
        if (fx.brainOfConfusion) boc = true;
        if (fx.flipper) flipper = true;
        if (fx.longInvince) longInvince = true;
        // ★SW-FX1：+= 计数（953/975 :15154/:15158 各+1、976 :15162 与 3995/3996
        //  :14549/:14555 各+2）——984 是【赋值】=2（:15180）不走本支（vid 门直赋,
        //  同槽覆盖前积=原版 quirk：976 先 984 后终值 2、984 先 976 后终值 4）
        if (fx.spikedBoots && accVid !== 984) spikedBoots += fx.spikedBoots;
        if (fx.treasureMagnet) treasureMagnet = true;
        if (fx.goldRing) goldRing = true;
        if (fx.luckyCoin) luckyCoin = true;
        if (fx.discount) discount = true;
        if (fx.ammoSave) ammoSaveCost80 = true;       // ammoCost80 1/5（:52799）
        if (fx.huntressSave) ammoSaveHuntress = true; // huntressAmmoCost90 1/10（:52791）
        if (fx.kbGlove) kbGlove = true;
        if (fx.autoReuseGlove) autoReuseGlove = true;   // 力量手套族：近战自动连挥
        if (fx.meleeScaleGlove) meleeScaleGlove = true;   // 手套族近战放大（:14754 等 5 件）
        if (fx.yoyoString) yoyoString = true;
        if (fx.magmaStone) magmaStone = true;   // 岩浆石 1322/火焰护手 1343（:14764/:14787-14790）
        if (fx.iceSkate) iceSkate = true;       // 冰刀族（:14542/:14703/:14843/:14846）
        if (fx.tileSpeed) tileSpeed = true;
        if (fx.wallSpeed) wallSpeed = true;
        if (fx.tileRange) tileRange = true;
        if (fx.autoPaint) autoPaint = true;      // 喷漆器族（:14720/:14726-14734）
        if (fx.chiselSpeed) chiselSpeed = true;  // 古凿/创造之手（:12610-12612/:13981）
        if (fx.toolbelt) toolbelt = true;        // 工具腰带 407（:14873 blockRange++）
        // skyStone 表消费收窄：原版三源 = 1865∪3110【无门】(:15527-15529)、
        // 899&&dayTime、900&&(!day||eclipse)（:15531-15535）。json '899' 无条件档
        // 是旧"恒开"登记偏差的表源——899/900 改走上方功能槽昼夜门(:1363-1364)，
        // 此处仅保留无门族（moon shell/celestial shell）。
        if (fx.skyStone && !(accVid === 899 || accVid === 900)) skyStone = true;
        if (fx.pStone) pStone = true;
        if (fx.flowerBoots) flowerBoots = true;   // 花靴/仙灵靴（:12688）
        if (fx.manaMagnet) manaMagnet = true;
        if (fx.magicCuffs) magicCuffs = true;
        if (fx.manaFlower) {
          manaFlower = true;
          // 1457: 法力花增强（ApplyEquipFunctional case 3991 :14511-14516）——
          // 新增 magicCrit += 5 / magicDamage += 0.05（manaCost -0.08 迁至
          // UpdateEquips if(manaFlower) :13058-13062，本仓 Game 侧 ×0.92 已等价）。
          // ★仅 3991 裸法力花有此两项：4000/4001(:14561-14569)与 555(:15706-15709)
          // 只置 manaFlower 旗，不吃增强
          if (accVid === 3991) { critMagic += 5; dmgMagic += 0.05; }
        }
        if (fx.manaRegenBonus) manaRegenBonus += fx.manaRegenBonus;           // 魔力斗篷 982（:14383）
        // 1458 已删 982/6188/6189 的 delayBonus++（:15044）,数据面 vanilla-accfx 三键已清——
        // 此消费行恒 0,保留仅为 equipStats 字段完整性
        if (fx.manaRegenDelayBonus) manaRegenDelayBonus += fx.manaRegenDelayBonus;
        // ---- 配饰审计 P0 批（2026-08-22）消费 ----
        if (fx.fishingTackle) fishingTackle = true;   // 钓具箱族 2375/3721/5064（:14123-14140）
        if (fx.fishingLine) fishingLine = true;       // 高测钓线族 2373/3721/5064（R14-E6）
        if (fx.lavaFishing) lavaFishing = true;       // 防熔钓族 4881/5064（:14127-14140）
        if (fx.dmgMinion) accDmgMinion += fx.dmgMinion;   // 召唤伤 935/1301/3015（:14900/:14431/:14105）
        if (fx.endurance) setEndurance += fx.endurance;   // 蠕虫围巾 3224（:14532-14535）
        if (fx.manaCostOff) manaCostOffAcc += fx.manaCostOff; // 大自然的恩赐 223（:14561-14563）
        if (fx.royalGel) royalGel = true;             // 皇家凝胶 3090（:14144-14168）
        if (fx.toolboxRange) toolboxRange += fx.toolboxRange;  // 工具箱 1923（:14405-14408）
        if (fx.mechShowWires) mechShowWires = true;   // 机械透镜 3619（:12400-12402）
        if (fx.autoActuator) autoActuator = true;     // 加压器 3624（:14746-14748）
        if (fx.magiluminescence) magiluminescence = true;  // 荧光体 5107（:14087-14093）
        if (fx.iceBarrier) iceBarrierAcc = true;      // 冰冻护盾族 1253/3997（:14348-14351）
        if (fx.lavaRose) lavaRose = true;             // 玫瑰族 1323/908/4003/4004/5000（:27384-27387）
        // （fx.counterWeight 已并入上方悠悠球袋族 vid 直表——5547 是唯一 accfx 条目，
        //  原版语义是 int 1079 非 bool，此处不再消费表字段）
        if (fx.divingHelm) divingHelm = true;   // 394/1860/1861 潜水装备族
        if (fx.merman) merman = true;           // 497/861/3110 贝壳族
        if (fx.arcticDivingGear) arcticDivingGear = true; // 1861
        if (fx.jellyfishGlow) jellyfishGlow = true;      // 1860
        for (const j of fx.jumpOpts ?? []) jumpSet.add(j);
      }
      // 词缀效益（GrantPrefixBenefits :13531：配饰前缀 62-80;受理门同 grantArmorBenefits——
      //  原版 :13020-13022 if (effectiveArmor.accessory) 方入）
      const p = s.prefix;
      if (grantArmorBenefits && p && p >= 62 && p <= 80) {
        if (p <= 65) def += p - 61;              // 62-65：+1..4 防御
        else if (p === 66) mana += 20;           // Arcane：魔力 +20
        else if (p === 67) { critMelee += 2; critRanged += 2; critMagic += 2; }
        else if (p === 68) { critMelee += 4; critRanged += 4; critMagic += 4; }
        else if (p >= 69 && p <= 72) {
          // ★BJ723-A S01：69-72 四系独立各 +1..4%（1457 GrantPrefixBenefits
          //   :14087-14114——melee/ranged/magic/minionDamage 逐系 `+= 0.01f..0.04f`）。
          //   曾写成 `dmgMelee += dmgRanged += dmgMagic += x` 复合赋值——右结合串联：
          //   远程吃魔法【累加值】、近战吃远程累加值（5×+4% 词缀实测近战+140%/
          //   远程+60%/魔法+20%，应各+20%）、召唤整漏；修=四系各自独立加法
          const pd = (p - 68) / 100;
          dmgMelee += pd; dmgRanged += pd; dmgMagic += pd; minionDmg += pd;
        }
        else if (p <= 76) move += (p - 72) / 100; // 73-76：+1..4% 移速
        else meleeSpeed += (p - 76) / 100;        // 77-80：+1..4% 近战速度
      }
    }
    // 时装配饰槽 13-19 的线色（Player.cs:36361-36372 UpdateVisibleAccessories 第二轮：
    // 社交槽无条件走 UpdateVisibleAccessory——时装线饰品同样染线；yoyoString 不在此轮，
    // ApplyEquipFunctional 只扫功能槽）。★per-slot 隐藏定谳（2026-08-23）：社交槽
    // 原版【无】hideVisibleAccessory 门（:36368-36375 第二轮无条件;Main.cs:40855
    // 眼睛图标只挂 num40>2 功能配饰段）——"虚荣槽 13-19 可隐藏"与原版不符,
    // 审计登记项回写备案,本仓同原版不设门。
    // ★清偿刀 P：解锁门仍在（ApplyEquipVanity :13110+可见轮 :37080 同门
    // :12669-12690——社交 18/19=恶魔心/大师孪生格,大师无心态 18 锁 19 开;
    // N 刀「放置 UI 门下正常玩法不可达」已证伪：右键装备段扫 13..19 可达 18）。
    for (let i = 13; i < 20; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // :12669-12690
      const s = effArmor(i);   // ApplyEquipVanity :13108-13112 同走 GetEffectiveArmor
      if (!s) continue;
      const v = ITEM_DEFS[s.id];
      const vid = v?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
      if (vid === 5540 || vid === 5541) stringColor = 29;
      const sc = statOfInternal(s.id)?.str;
      if ((sc ?? 0) > 0) stringColor = sc!;
      // 虚荣配重球（ApplyEquipVanity :13800-13803，社交槽 13-19 彩色配重球 →
      // vanityCounterWeight；Counterweight() 消费端优先于功能槽 counterWeight :11991-11994）
      if (vid >= 3309 && vid <= 3314) vanityCounterWeight = 556 + vid - 3309;
      // 语音饰品·社交槽（ApplyEquipVanity :14337-14341：voiceSlot!=0 直赋,
      // 无 !hide 门——时装槽同样改声,同原版）
      const vSlotVanity = voiceSlotOfItem(vid);
      if (vSlotVanity > 0) voiceOverrideAcc = vSlotVanity;
      // 社交槽身上贴图（UpdateVisibleAccessories :36353-36361 第二轮：
      // UpdateVisibleAccessory 无 !hide 门,时装配饰贴图无条件生效,后写覆盖功能槽）
      if (vid > 0) accDrawApply(s, i);
      // 浮游圈社交槽挂管+染料（UpdateVisibleAccessory :37265-37268 同函数,社交槽
      // :36368-36375 无 !hide 门;染料 UpdateItemDye :9815-9818——isNotInVanitySlot
      // =false → flag 恒假,`!num&&flag` 早退不触发=染料照写）——管体照画,
      // 浮力不授（canFloat 仅功能轮）
      if (vid === 4404) {
        hasFloatingTubeVis = true;
        const tubeDyeItem = this.inv.getEffectiveDye(i % 10);   // UpdateDyes :9697 num=i%10
        accDraw.dyeFloatingTube = tubeDyeItem ? (ITEM_DEFS[tubeDyeItem.id]?.vid ?? -1) : -1;
      }
    }
    // ---- 信息/机械饰品背包生效域（配饰审计系统性批 2026-08-22）----
    // UpdateEquips :12494-12500：for j=0..57 inventory 全格扫
    // RefreshInfoAccsFromItemType + RefreshMechanicalAccsFromItemType——信息族
    // （表/罗盘/深度计/渔夫族/PDA/手机/REK3000 3124…）与机械族（机械透镜 3619/
    // 加压器 3624/喷漆器 2216/建筑师包 3061/造物之手 5126）【放背包即生效】,
    // 对这两类豁免穿戴槽位要求;其余饰品仍走上方配饰槽循环。equipStatsKey 的
    // 背包段（下方 key I 档）保证放取失效重算
    let hasVoidLens = false;   // UpdateEquips :13021 flag = 背包 58 格任一 4131 Void Lens
    for (let j = 0; j < this.inv.slots.length; j++) {
      const s = this.inv.slots[j];
      if (!s) continue;
      const d = ITEM_DEFS[s.id];
      const vid = d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
      if (vid <= 0) continue;
      if (vid === 4131) hasVoidLens = true;
      refreshInfoAccsFromItemType(infoAccs, vid);
      // RefreshMechanicalAccsFromItemType（Player.cs:12916-12930 本仓建模子集）——
      // 主背包与虚空袋两路共用同一 helper（★F3 禁双抄）
      refreshMechanicalAccsFromItemType(mech, vid);
    }
    // ★F3 虚空袋传播（UpdateEquips Player.cs:13026-13040）：背包持 4131（VoidLens）
    // 时对 bank4 虚空保险库逐槽重放 RefreshInfoAccs + RefreshMechanicalAccs——
    // 门 = type2<0 ∨ type2>ItemID.Count ∨ WorksInVoidBag[type2]；后者默认全真、
    // 仅 4346/5095 假（ItemID.cs:82），即袋内除"防捡起磁石/Lucy 斧"外全部照常生效。
    // 容量=Chest.CreateBank(-5) bank:true 默认 maxItems=40（Chest.cs:185）——按本仓
    // banks[3] 全长遍历与之等价。
    if (hasVoidLens && this.banks[3]) {
      for (const bs of this.banks[3]) {
        if (!bs) continue;
        const bd = ITEM_DEFS[bs.id];
        const bvid = bd?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
        if (bvid > 0 && WORKS_IN_VOID_BAG_FALSE.has(bvid)) continue;   // WorksInVoidBag=false 两例外
        if (bvid <= 0) continue;
        refreshInfoAccsFromItemType(infoAccs, bvid);
        refreshMechanicalAccsFromItemType(mech, bvid);
      }
    }
    dontHurtCrittersAcc = mech.dontHurtCritters;   // ★E 消费端 = playerProjectileCanHitNpcGate 统一出口
    // ★F3 合流：装备槽（accfx 链）∪ 背包扫描 ∪ 虚空袋传播 的三路并集
    if (mech.mechShowWires) mechShowWires = true;
    if (mech.autoActuator) autoActuator = true;
    if (mech.autoPaint) autoPaint = true;
    // 恐慌项链受击加速窗口（PanicSpeedBoost :25034：panicTime 300 tick 内 moveSpeed +0.5）
    if (this.panicTime > 0) move += 1.0;   // PanicSpeedBoost（:25034 满档 +1.0=+100%;旧 +0.5 是 1.4.0 旧值,2026-08-13 修）
    // （moveMult 的终值折算迁至聚合尾部——下方 sumFx/SUMMON_GEAR 主属性面、
    //   DD2_PIECE_FX 甲件 moveSpeed、套装 sb.move 三处 += 都在原折算点之后,
    //   曾被 1831 旧折算吞掉 = 忍者套 +20%/诡异腿 +20%/DD2 胸腿 moveSpeed 全失效,
    //   2026-09-03 DD2 主属性批接线时由 1834 诡异护腿用例当场暴露）
    // 多段跳按原版消费优先序排列（JumpMovement :20875-20922 else-if 链）：
    // 坐骑族 Basilisk>WallOfFleshGoat>Santank>Unicorn 在前（:20875-20893）,瓶族
    // Sandstorm>Blizzard>Fart>Sail>Cloud（:20899-20922,Cloud 兜底）。
    // ★数据键只有 Cloud/Sandstorm/Blizzard/Fart/Sail（vanilla-accfx.json）——
    // 'Tsunami' 键不存在（航行瓶=Sail,TsunamiInABottle 数据键即 Sail）,R5-F9 已删
    const JUMP_ORDER = ['Basilisk', 'WallOfFleshGoat', 'Santank', 'Unicorn', 'Sandstorm', 'Blizzard', 'Fart', 'Sail', 'Cloud'];
    const jumpOpts = JUMP_ORDER.filter((j) => jumpSet.has(j));
    // （召唤师链 minionSlots/minionDmg/... 声明已上移至配饰循环前——6175 循环内直加）
    minionDmg += accDmgMinion;   // accfx dmgMinion 通道（935/1301/3015 :14900/:14431/:14105）
    // 1457 鞭 tag 栈族（Player.maxTagEffects/tagEffectDuration/accSnakeBand :1187-1199）
    let maxTagEffects = 1, tagEffectDuration = 1, accSnakeBand = false, accWickedArmlet = false;
    // 原版 ApplyEquipFunctional armor[0-9] 单遍 = 盔甲三件 + 配饰各扫（SummonFx 同表直查）
    const sumFx = (s: { id: number } | null): void => {
      if (!s) return;
      // ★清偿刀 U：expertOnly 效益门（k-loop :13017-13018——sumFx 全调用点
      //   = GrantArmorBenefits 面 0-2 甲件 + 3-9 配饰,k=0..9 统一门内）
      if (ITEM_DEFS[s.id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) return;
      const d = ITEM_DEFS[s.id];
      const vid = d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
      const fx = vid >= 0 ? SUMMON_GEAR[vid] : undefined;
      if (!fx) return;
      if (fx.dd2) {
        // dd2Accessory 布尔（Player.cs:12571-12575）：四件全戴只计一次 +1哨兵/+10%召唤伤
        if (!seenDd2) { seenDd2 = true; sentrySlots += 1; minionDmg += 0.10; }
        return;
      }
      if (fx.slot) minionSlots += fx.slot;
      if (fx.sentry) sentrySlots += fx.sentry;
      if (fx.dmg) minionDmg += fx.dmg;
      if (fx.kb) minionKB += fx.kb;
      if (fx.whipRange) whipRange += fx.whipRange;
      // ---- 主属性面（SummonFx 扩展字段,2026-09-03 接线退役"登记未接"——DD2 头盔
      //  散件/禁戒/诡异的主属性 GrantArmorBenefits case 实读值;聚合语义同 accfx 链:
      //  伤/速/移速加算、暴击加算、耗魔走【加算】manaCostOff 池、lifeRegen 走
      //  hpPerSec=life/2（原版 120 单位/tick→N/2 HP/s :19383-19407））----
      if (fx.manaCostOff) manaCostOffAcc += fx.manaCostOff;
      if (fx.lifeRegen) life += fx.lifeRegen;
      if (fx.dmgMagic) dmgMagic += fx.dmgMagic;
      if (fx.dmgMelee) dmgMelee += fx.dmgMelee;
      if (fx.critRanged) critRanged += fx.critRanged;
      if (fx.meleeSpeed) meleeSpeed += fx.meleeSpeed;
      if (fx.move) move += fx.move;
      if (fx.mana) mana += fx.mana;
      // 1457 鞭 tag 栈族（:13068-13083 if-chain 数值段）
      if (fx.tagDur) tagEffectDuration += fx.tagDur;
      if (fx.maxTag) maxTagEffects += fx.maxTag;
      if (fx.snakeBand) accSnakeBand = true;
      if (fx.wickedArmlet) accWickedArmlet = true;
    };
    let seenDd2 = false;
    for (let i = 0; i < 3; i++) sumFx(effArmor(i));   // R4-19：GrantArmorBenefits k=0..9
    // GrantArmorBenefits 盔甲三件扫描（Player.cs:12826-12831）：armor 268 潜水头盔 → accDivingHelm
    // ★组A 单件面批（2026-09-18）：3109/4008 夜视旗同行承载（:13408-13411 nightVision=true）
    for (let i = 0; i < 3; i++) {
      const s = effArmor(i);
      if (!s) continue;
      // ★清偿刀 U：expertOnly 效益门（k-loop :13017-13018,甲件面同门）
      if (ITEM_DEFS[s.id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) continue;
      const afx = accFxOfInternal(s.id);
      if (afx?.divingHelm) divingHelm = true;
      if (afx?.nightVision) nightVisionArmor = true;
    }
    // 套装/头盔 type 检测（vid 直查）：蘑菇矿头 1546箭/1547弹/1548火箭（:13274-13288）
    // ——vidOfItemId（★IIIII250 查表族）单源复用（BJ147 组D）
    const aVid = (i: number): number => vidOfItemId(effArmor(i)?.id ?? -1);
    const [hVid, bVid, lVid] = [aVid(0), aVid(1), aVid(2)];
    // ★清偿刀 U：GrantArmorBenefits 单件面的 vid 读（套装【检测】面除外——
    //   ArmorSetBonus.QueryContext :29-35 直读 GetEffectiveArmor,无 expertOnly 门,
    //   故 aVid/vidSet 不设门;下方 gVid 只喂单件效益消费位）：
    //   死人毛衣 5007(:13226)/月亮领主腿 5001(:13215)/神灵诅咒 3770(:13360)/
    //   巫师帽 238(:13352)/甲件 aggro 轴(:13852/:13983)/蘑菇矿头 1546-1548(:13274)/
    //   DD2 散件 3798-3882(:13236-13342)——k-loop :13017-13018 门内。
    const gVid = (i: number): number => {
      const s = effArmor(i);
      if (!s) return -1;
      if (ITEM_DEFS[s.id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) return -1;
      return vidOfItemId(s.id);
    };
    // SW-AC1 2026-09-04：死人毛衣 5007 胸甲件旗（GrantArmorBenefits case 5007
    //  Player.cs:13226-13229 `deadMansSweater = true`——装甲三件扫描位,社交槽
    //  3-9 门=item.accessory 不授 :12970-12989;消费=SelfHurtPlayers :15131-15134）
    let deadMansSweater = false;
    if (gVid(1) === 5007) deadMansSweater = true;    // ★清偿刀 U：单件效益面走 gVid（:13018 门）
    // ★组A/B 单件面批（2026-09-18）甲件行为旗 vid 直查（同 deadMansSweater 件位形态;
    //  声明位在配饰环上方本地块,旗消费链见 PlayerEquipStats 字段注）：
    if (gVid(2) === 5001) moonLordLegsArmor = true;  // 月亮领主腿（:13215-13219;★U gVid）
    if (moonLordLegsArmor) extraFall += 10;          // :19733 extraFall += 10（BJ234 摔伤面:
                                                     // 摔伤安全距 25→35,消费 fixedUpdate 摔伤结算
                                                     // safeT=25+eqM.extraFall ≙ :25497-25498;
                                                     // jumpSpeed+1.8 走 accfx '5001'.jumpSpd;
                                                     // jumpHeight++ 走 jumpBaseSnapshot 消费
                                                     // equipStats.moonLordLegs）
    if (gVid(2) === 3770) slowFallArmor = true;      // 神灵诅咒（:13360-13362;★U gVid）
    // ★IIIII224（GrantArmorBenefits case 238,Player.cs:13352-13359）：巫师帽
    //  （头槽 238）magicDamage +5%；十周年世界随从上限 +1（tenthAnniversaryWorld）
    if (gVid(0) === 238) {
      dmgMagic += 0.05;
      if (this.worldSeedFlags?.tenthAnniversary) minionSlots += 1;
    }
    // ---- BJ147 组D：套装 vid 三元组判定收编（原内联 vid 直比 7 处 →
    //      vanillaArmorSets.ARMOR_SET_BONUSES_VID 单表,键 = h|b|l 物品 id——
    //      原版 QueryContext 语义;消费旗经专用通道,equipStats 字段名不变）----
    // 老猩红甲 crimsonRegen（Benefits.Crimson :433）：再生三面 = UpdateLifeRegen
    //   :19233 eRT+1 / :19362 num5×1.5 / :19412 每回 1HP 十粒红尘（消费端在 regen 段）
    // 陨石套 spaceGun（:436）——Space Gun/Zapinator/钉枪无限蓝（R27 消费面）
    // 蘑菇矿/星旋/星云/甲虫双档（:394/:471/:472/:416-417）——各自引擎通道
    const vidSet = matchArmorSetBonusVid(hVid, bVid, lVid);
    if (vidSet?.crimsonRegen) crimsonRegen = true;
    if (vidSet?.shroomiteSet) shroomiteSet = true;
    if (vidSet?.vortexSet) vortexSet = true;
    if (vidSet?.nebulaSet) nebulaSet = true;
    if (vidSet?.spaceGun) spaceGun = true;
    if (vidSet?.beetleOff) beetleOff = true;     // 进攻甲
    if (vidSet?.beetleDef) beetleDef = true;     // 防御甲（壳：beetleEndurance 15%/球）
    // 甲件 aggro 轴（GrantArmorBenefits :13852-13874/:13983-13997——逐槽 +=：
    //   龟甲三件 +250、甲虫头/腿 +250 与壳胸 +400、日曜三件各 +300。
    //   ★终零波批（2026-09-01）实装——旧注"甲件轴暂未建模,登记"退役）
    //   ★清偿刀 U：单件效益面走 gVid（:13018 门）
    const aggroPiece = (AGGRO_ARMOR_PIECE[gVid(0)] ?? 0)
      + (AGGRO_ARMOR_PIECE[gVid(1)] ?? 0) + (AGGRO_ARMOR_PIECE[gVid(2)] ?? 0);
    // 蘑菇矿头单件 type 面（GrantArmorBenefits case 1546-1548 :13274-13288——
    //   箭/弹/火箭 ×1.12 + crit+5,shroomiteType 单源承载,套装层 vidSet 之上）
    if (gVid(0) === 1546) shroomiteType = 'arrow';
    else if (gVid(0) === 1547) shroomiteType = 'bullet';
    else if (gVid(0) === 1548) shroomiteType = 'rocket';
    for (let i = ACC_ARMOR_START; i < 10; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // ★清偿刀 P :13044 门
      sumFx(effArmor(i));   // R4-19
    }
    // 盔甲套装加成（vanillaArmorSets.ts：槽序号三键匹配）
    // DD2 盔甲散件主属性（DD2_PIECE_FX——GrantArmorBenefits case 3798-3882 :13236-13342
    //  胸/腿件逐件扫描;2026-08-13 建,2026-09-03 对账批补 dmgMelee/dmgRanged/lifeRegen/
    //  manaCostOff 四通道——3801/3807 近战伤、3804/3878 远程伤、3872 再生、3875 耗魔加算）
    for (let _i = 0; _i < 3; _i++) {
      const _fx = DD2_PIECE_FX[hVid + bVid + lVid]; void _fx;
      break;
    }
    const dd2Vids = [gVid(0), gVid(1), gVid(2)];   // ★清偿刀 U：单件效益面走 gVid（:13018 门）
    for (const _v of dd2Vids) {
      const _d = DD2_PIECE_FX[_v];
      if (!_d) continue;
      if (_d.dmgMelee) dmgMelee += _d.dmgMelee;
      if (_d.dmgRanged) dmgRanged += _d.dmgRanged;
      if (_d.dmgMagic) dmgMagic += _d.dmgMagic;
      if (_d.dmgMinion) minionDmg += _d.dmgMinion;
      if (_d.critMagic) critMagic += _d.critMagic;
      if (_d.critMelee) critMelee += _d.critMelee;
      if (_d.critRanged) critRanged += _d.critRanged;
      if (_d.move) move += _d.move;
      if (_d.meleeSpd) meleeSpeed += _d.meleeSpd;
      if (_d.lifeRegen) life += _d.lifeRegen;             // N/2 HP/s（:19383-19407 120 单位/tick 语义,同 accfx life）
      if (_d.manaCostOff) manaCostOffAcc += _d.manaCostOff;   // 【加算】折扣池（:13306 manaCost -= 0.15f）
      if (_d.manaCostMul) setManaCostMul *= _d.manaCostMul;
      if (_d.ammoCost80) ammoSaveCost80 = true;
      if (_d.huntressAmmoCost90) ammoSaveHuntress = true;
    }
    // ---- ★armorStat 甲件主属性环（2026-09-04 死键批收偿,退役 2026-09-03 死键备案）——常规甲件
    //      GrantArmorBenefits if-chain（Player.cs:13557-14052）逐件主属性。此前
    //      vanilla-accfx.json 甲件行只被配饰槽 3+ 消费环（Player.ts:1524）与 divingHelm
    //      专查（:1945）扫到,盔甲三件面全死键;此处对 [hVid,bVid,lVid] 消费 json 数值
    //      主属性面（mana/life/move/meleeSpd/dmg×3/crit×3/manaCostOff,与配饰链
    //      Player.ts:1688-1715 同字段同聚合;accfx 提取器漏标的 manaCost 面已补进 json:
    //      4982 :13726/1003 :13755/2760 :14021/2189 :13782/1282-1287+4256 :13825-13850）。
    //      单源互斥（免双计）:
    //      · 1546-1548 蘑菇矿头（叶/弹/火箭 ×1.12+crit5）→ shroomiteType 单源
    //        （本仓 :2358-2363 乘区 + :2604 crit）,整行跳过;
    //      · 行为旗（1549 ammoSave/4983 huntressSave…）不消费——省弹档由
    //        ARMOR_AMMO_SAVE_VID（下方表）单源承载;
    //      · 召唤面 minionDamage（552/4901/1004/403/1208/1209/1214/1218/1219）→
    //        SUMMON_GEAR 承载（2026-09-04 入表）;maxMinions 面（5524/4873/4899）原已在表;
    //      · SUMMON_GEAR 已带主属性面的甲件（3776 禁戒面具/3777/3778 禁戒袍裤/
    //        1834 诡异腿——sumFx 盔甲扫描位已加）→ 字段级优先,本环对已覆盖字段
    //        记 0（accfx 行与其同源同值,tests/accfx-armor-mainstats 断言恒等）;
    //      · 套装层（vanillaArmorSets 槽序键）与甲件层分属原版两通道,不重叠。
    //      ★任务清单勘误:4982-4984 = CrystalNinja 水晶忍者套（ItemID.cs 实名）,非日曜;
    //        真日曜 Solar Flare = 2763-2765（aggro+300/lifeRegen+2/melee 面——accfx 行
    //        2763-2765 值经核对 :13987-14000 无误,由本环消费,aggro 走 AGGRO_ARMOR_PIECE）。
    for (const v of [hVid, bVid, lVid]) {
      if (v === 1546 || v === 1547 || v === 1548) continue;
      const afx = accFxJsonOfVid(v);
      if (!afx) continue;
      const sg = SUMMON_GEAR[v];
      const sgHas = (f: string): boolean => sg !== undefined && (sg as unknown as Record<string, number | undefined>)[f] !== undefined;
      const face = (f: 'mana' | 'life' | 'move' | 'meleeSpd' | 'dmgMelee' | 'dmgRanged' | 'dmgMagic' | 'dmgAll' | 'critMelee' | 'critRanged' | 'critMagic' | 'manaCostOff' | 'pickSpeed' | 'jumpSpd'): number =>
        sgHas(f) ? 0 : afx[f] ?? 0;
      mana += face('mana');                                  // statManaMax2（:13757 1003 等）
      life += face('life');                                  // lifeRegen（:13987 2763 等,N/2 HP/s）
      move += face('move');                                  // moveSpeed
      jumpSpd += face('jumpSpd');                            // jumpSpeedBoost（'5001' 月领腿 +1.8 :19732——
                                                             //   ★BJ220 手补钉值自快照手码迁此聚合位,与
                                                             //   翼飞 JS/火箭脉冲(PLAYER_JUMP_SPEED+eqM.jumpSpd)
                                                             //   及 jumpBaseSnapshot(baseJumpSpd+=eqJ.jumpSpd)
                                                             //   同源;SUMMON_GEAR 无 jumpSpd 键,face 直读）
      meleeSpeed += face('meleeSpd');                        // meleeSpeed
      dmgMelee += face('dmgMelee');
      dmgRanged += face('dmgRanged');
      dmgMagic += face('dmgMagic');
      if (face('dmgAll')) { dmgMelee += face('dmgAll'); dmgRanged += face('dmgAll'); dmgMagic += face('dmgAll'); }
      critMelee += face('critMelee');
      critRanged += face('critRanged');
      critMagic += face('critMagic');
      manaCostOffAcc += face('manaCostOff');                 // manaCost -= X【加算】池（:13726 等）
      pickSpeedOff += face('pickSpeed');                     // pickSpeed -= X【加算】池（410/411/
                                                             // 5589/5590 矿工件 :13944-13947,组A 批）
    }
    // ---- 盔甲单件省弹门（Player.cs GrantArmorBenefits if-chain + :13226 switch 逐件
    //      1:1——提取器 accfx 表漏标 2758/1002 档位键，此处手读直表；行号 1457 重锚）：
    //  星旋胸 2758 → ammoCost75=1/4（:14008）；叶绿头 1002 → chloroAmmoCost80=1/5
    //  （:13749）；蘑菇矿胸 1549 → ammoCost80=1/5（:13815，accfx 已标 ammoSave 同值）；
    //  水晶忍者胸 4983 → huntressAmmoCost90=1/10（:13734）；女猎手护甲 3804 →
    //  huntressAmmoCost90=1/10（:13278）；女猎手 T3 胸 3878 → ammoCost80=1/5（:13321）。
    //  （★accfx 盔甲死键备案 2026-09-03 → 2026-09-04 armorStat 环接线,见上）
    // ★1457 叶绿素套水晶叶三修（OnHit :6986-7036,1456 :6615-6640）——叶绿素套
    //  SetBonus 的水晶叶追踪弹（226 剑气→227 花瓣）三处门：①目标须 CanBeChasedBy
    //  （:6991-6996,1456 无）②226 弹 !active 即跳过（:7000,1456 无 active 检）③
    //  新增 1200px 距离上限（:7007,1456 无半径门,首个 226 即触发）。本仓叶绿素套
    //  SetBonus（水晶叶弹）未移植（仅头盔单件省弹 1/5 在上表）→ 三修无宿主。备案：
    //  移植水晶叶套弹时按 1457 三门落地。
    const ARMOR_AMMO_SAVE_VID: Record<number, 'huntress' | 'chloro' | 'cost80' | 'cost75'> = {
      2758: 'cost75', 1002: 'chloro', 1549: 'cost80', 4983: 'huntress', 3804: 'huntress', 3878: 'cost80',
    };
    for (const v of [hVid, bVid, lVid]) {
      const tier = ARMOR_AMMO_SAVE_VID[v];
      if (tier === 'huntress') ammoSaveHuntress = true;
      else if (tier === 'chloro') ammoSaveChloro = true;
      else if (tier === 'cost80') ammoSaveCost80 = true;
      else if (tier === 'cost75') ammoSaveCost75 = true;
    }
    // 渔夫套/升级渔夫套单件 fishingSkill +5（ApplyEquipFunctional :13549-13552：
    // 2367/2368/2369 + 5591/5592/5593 各 +5,三件套共 +15）——R14-E9 补（此前整套少 15 渔力）
    for (const v of [hVid, bVid, lVid]) {
      if (v === 2367 || v === 2368 || v === 2369 || v === 5591 || v === 5592 || v === 5593) fish += 5;
    }
    // 盔甲套装加成（vanillaArmorSets.ts 单表：槽序号三键匹配,一次查找双通道投影——
    // sb = setBonus 通道（summonSetOnly 条目不亮,既有 85 键正确面）;summonSet = 召唤通道）
    const setMatch = activeArmorSetMatch(this);
    const sb = setMatch?.summonSetOnly ? null : setMatch;
    if (sb) {
      if (sb.def) def += sb.def;
      if (sb.mana) mana += sb.mana;
      if (sb.move) move += sb.move;
      if (sb.meleeSpd) meleeSpeed += sb.meleeSpd;
      if (sb.dmgMelee) dmgMelee += sb.dmgMelee;
      if (sb.dmgRanged) dmgRanged += sb.dmgRanged;
      if (sb.dmgMagic) dmgMagic += sb.dmgMagic;
      if (sb.dmgAll) { dmgMelee += sb.dmgAll; dmgRanged += sb.dmgAll; dmgMagic += sb.dmgAll; }   // ★四百八十二:GenericDamageClass 全系
      if (sb.critMelee) critMelee += sb.critMelee;
      if (sb.critRanged) critRanged += sb.critRanged;
      if (sb.critMagic) critMagic += sb.critMagic;
      if (sb.critAll) { critMelee += sb.critAll; critRanged += sb.critAll; critMagic += sb.critAll; }
      if (sb.noKnockback) noKnockback = true;
      if (sb.runAccMul) setRunAccMul = sb.runAccMul;      // 暗影套 :26195-26201
      if (sb.maxRunMul) setMaxRunMul = sb.maxRunMul;
      if (sb.runSlowMul) setRunSlowMul = sb.runSlowMul;
      if (sb.endurance) setEndurance += sb.endurance;   // 日曜套 :16224
      if (sb.solar) solarSet = true;
      if (sb.titaniumStorm) titaniumStorm = true;   // ★修齐批②      if (sb.titaniumStorm) titaniumStorm = true;   // ★修齐批②
      if (sb.crystalLeaf) crystalLeaf = true;       // 叶绿三件套四头变体（L3 清偿批）
      if (sb.onHitRegen) onHitRegen = true;         // 帕拉钯全套（ArmorSetBonuses.cs:217-220,终零波批）
      if (sb.onHitPetal) onHitPetal = true;         // 山铜全套花瓣弹 221（:222-226,终零波批）
      if (sb.onHitDodge) onHitDodge = true;         // 神圣套幻影闪避 buff59 链（:228-236,终零波批）
      // （套装层 maxMinions 通道预留：当前召唤面槽位全走 summonSet 召唤通道
      //   （vanillaArmorSets 单表召唤字段族）+ SUMMON_GEAR 散件链——
      //   HallowedSummoner+2 已由单表条目 slot 承载,勿双记）
      if (sb.ashWood) ashWood = true;               // ★Notes④ Ash Wood 全套
      if (sb.dashType) dash = Math.max(dash, sb.dashType);   // 日曜套 :16288-16294（dash 与 accfx 同聚合链）
      if (sb.fireWalk) fireWalk = true;
      // Molten 套 buffImmune[24] 门（Player.cs:15883 UpdateArmorSetsOld：裸 Molten
      // 三件套免疫 On Fire!——★阳光炽灼中不免疫，:15882 vampireBurningInSunlight 反门）
      if (sb.name === 'Molten' && !this.vampireBurningInSunlight) immuneBuffs.add(24);
      if (sb.frostBurn) frostBurn = true; // 冰霜套引擎(:93712)
      if (sb.anglerSet) anglerSetSpawnReduction = true;   // 渔夫套生成环（NPC.cs:627-630）
      if (sb.ammoCost80) ammoSaveCost80 = true;
      // ---- 组A/B 表批消费位（2026-09-18;Effects 通道逐行对应 vanillaArmorSets 注）----
      if (sb.dmgMinion) minionDmg += sb.dmgMinion;        // CrystalNinja/Pumpkin minionDamage+=X
                                                          // （minionDmg 与 DD2/summon 通道同池加算）
      if (sb.manaCostOff) manaCostOffAcc += sb.manaCostOff; // 钴/秘银/精金法袍 manaCost−X【加算】池
      if (sb.ammoCost75) ammoSaveCost75 = true;           // 精金远程省弹 1/4（:207-209）
      if (sb.buffImmune) for (const b of sb.buffImmune) immuneBuffs.add(b);   // Snow 46/47
                                                          // （immuneDirty 已由 size>0 覆盖翻转失效）
      if (sb.pickSpeed) pickSpeedOff += sb.pickSpeed;     // Mining 套 pickSpeed−0.1（:299-303）
      if (sb.manaCostMul !== undefined) manaCostMul = sb.manaCostMul;
    manaCostMul *= setManaCostMul;   // DD2 散件魔耗乘区并入(2026-08-13)
    }
    // ★四百八十二刀:mod 套装旗面整集重设(main.js postUpdate 消费;替换式=卸甲即清)
    this.__swSetFlags = setMatch?.modFlags ? new Set(setMatch.modFlags) : null;
    // 女猎手 T2/T3 套装旗标（setHuntressT2,Player.cs:16119/:16149——爆炸机关弹
    // 694-696 的 Oiled 门,StatusNPC :10786;由 MinionProj 经 ctx 传入 applyProjStatus）
    let huntressT2 = false;
    // 召唤系套装通道（BJ147 组D：SUMMON_SET 已并入 vanillaArmorSets 单表——本通道 =
    // setMatch 命中条目的召唤字段族投影;无召唤字段的套（Molten 等纯数值套）恒 null
    // = equipStats.summonSet 既有正确面。散件效果已在上扫,此处只叠套装层）
    const summonSet = (() => {
      const s = setMatch;
      if (!s || (s.slot === undefined && s.sentry === undefined && s.dmg === undefined
        && s.whipRange === undefined && s.whipSpd === undefined && !s.guardian
        && !s.huntressT2 && !s.huntressT3 && !s.squireT2 && !s.apprenticeT2
        && !s.monkT2 && !s.squireT3 && !s.apprenticeT3 && !s.monkT3)) return null;
      if (s.slot) minionSlots += s.slot;
      if (s.sentry) sentrySlots += s.sentry;
      if (s.dmg) minionDmg += s.dmg;
      if (s.whipRange) whipRange += s.whipRange;
      if (s.huntressT2) huntressT2 = true;
      return s;
    })();
    // 天界石族复合（1457 Player.cs:13088-13102 skyStoneEffects：lifeRegen+2/def+4/
    // 近战速+10%/四系伤+10%【含 minionDamage】/三系暴+2%/镐速−15%/召唤击退+0.5）。
    // ★BJ723-A S06：原块漏 minionDmg+0.1/minionKB+0.5/pickSpeedOff+0.15 三行
    // （issue 点名召唤伤；另两行同块补齐至 1:1——昼夜八组验证召唤曾恒 0%）
    if (skyStone) {
      life += 2; def += 4; meleeSpeed += 0.1;
      dmgMelee += 0.1; dmgRanged += 0.1; dmgMagic += 0.1; minionDmg += 0.1;
      critMelee += 2; critRanged += 2; critMagic += 2;
      pickSpeedOff += 0.15; minionKB += 0.5;   // :13099/:13101（pickSpeed−0.15 折入折扣正池）
    }
    // buffImmune 刷新（Player.cs:14911-15003 装备段 + :9576-9578 黑曜石皮 buff 段；
    // buff 103 Wet 的 buffImmune[24]/[323]/[67] 见 UpdateBuffs :11342-11346——水行族
    // 授予三段火免疫）。★必须在下方 return 之前执行（曾位于 return 之后成死代码，
    // 黑曜石皮/Wet 免疫全灭）。空集路径 O(1) 清零
    const immuneDirty = immuneBuffs.size > 0
      || this.buffs.immuneVanilla.size > 0
      || this.buffs.has(BuffType.ObsidianSkin)
      || this.buffs.has(BuffType.Wet)
      // Molten 套 24 免疫（Player.cs:15883）——炽灼翻转时也要失效重建（key 的 V 档）
      || (sb?.name === 'Molten');
    if (immuneDirty) {
      this.buffs.immuneVanilla = new Set(immuneBuffs);
      if (this.buffs.has(BuffType.ObsidianSkin)) this.buffs.immuneVanilla.add(24);   // :9577
      // Wet 103：着火 24 / 地狱火 323 / 燃烧 67 免疫（Player.cs:11344-11346——
      // UpdateBuffs 内 buffType==103 分支逐帧置位，DrippingSlime 同族语义）
      if (this.buffs.has(BuffType.Wet)) {
        this.buffs.immuneVanilla.add(24);
        this.buffs.immuneVanilla.add(323);
        this.buffs.immuneVanilla.add(67);
      }
    }
    // 吸血鬼炽灼 120 档卸翅膀/火箭靴（Player.cs:28186-28187 wingsLogic=0;
    // rocketBoots=0——原版在 UpdateEquips 后直清字段；本仓 wing/rocketBoots 出自本
    // getter，等价实现 = 炽灼档（burning 且 counter≥120）下归零，equipStatsKey 的
    // S/V/v 档保证翻转帧失效重算）
    if (this.vampireBurningInSunlight && this.sunScorchCounter >= 120) {
      wing = null;
      rocketBoots = 0;
    }
    // moveMult 终值折算（原 acc 为 1831 位置,在 sumFx/DD2_PIECE_FX/sb.move 三处
    // += 之前 = 吞掉其后全部来源——原版 moveSpeed 是单累计字段,Update :26205
    // maxRunSpeed *= moveSpeed 在一切装备来源之后）。语义注：只含 moveSpeed 加成
    // （accRunSpeed 不随 moveSpeed 缩放——靴族冲刺走【慢爬坡段】到 6/6.75,旧折算
    // runSpeed/3-1 把 sprint 当移速乘区致 Flurry 装备即 +1.0 移速上限,2026-08-13
    // 拆除;accRunSpeed 单独经 equipStats）
    // ★四百七十二刀:modAcc 消费面补全(曾只接 def/mana/life/fish/wingTime——
    //  moveMult 加算 + dash/van 面整缺=acc-boosts moveMult 域静默丢弃)。
    //  C# moveSpeed 加算语义 → move += ;dash 取 max(同 fx.dashType 链)。
    move += modAcc.moveMult;
    // ★四百八十四刀:modAcc 系别伤/暴击/减伤加算消费面(C# GetDamage<系>/
    //  GetCritChance<系>/endurance 加算;与 accfx 链同池)
    if (modAcc.dmgMelee) dmgMelee += modAcc.dmgMelee;
    if (modAcc.dmgRanged) dmgRanged += modAcc.dmgRanged;
    if (modAcc.dmgMagic) dmgMagic += modAcc.dmgMagic;
    if (modAcc.dmgAll) { dmgMelee += modAcc.dmgAll; dmgRanged += modAcc.dmgAll; dmgMagic += modAcc.dmgAll; }
    if (modAcc.critMelee) critMelee += modAcc.critMelee;
    if (modAcc.critRanged) critRanged += modAcc.critRanged;
    if (modAcc.critMagic) critMagic += modAcc.critMagic;
    if (modAcc.critAll) { critMelee += modAcc.critAll; critRanged += modAcc.critAll; critMagic += modAcc.critAll; }
    if (modAcc.endurance) setEndurance += modAcc.endurance;
    if (modAcc.pickSpeedOff) pickSpeedOff += modAcc.pickSpeedOff;   // ★五百八十七:mod 挖掘折扣池
    if (modAcc.minionSlots) minionSlots += modAcc.minionSlots;   // ★595:mod 随从上限加算池
    if (modAcc.dash) dash = Math.max(dash, modAcc.dash);
    if (modAcc.van) {
      const f = modAcc.van;
      if (f.dashType) dash = Math.max(dash, Number(f.dashType));
      if (f.blackBelt) blackBelt = true;
      if (f.noFallDmg) noFallDmg = true;
      if (f.accFlipper) flipper = true;
      if (f.spikedBoots) spikedBoots = Math.max(spikedBoots, Number(f.spikedBoots));
      if (f.waterWalk) { waterWalk = true; waterWalkLava = true; }
      if (f.jumpBoost) jumpBoost = true;
      if (f.fireWalk) fireWalk = true;
      if (f.autoJump) autoJump = true;
      if (f.noKnockback) noKnockback = true;
      if (f.ignoreWater) this.modIgnoreWater = true;
      // ★五百八十六:mod 岩浆完全豁免面(van 键形;C# UpdateAccessory lavaImmune=true
      //  ——hydrothermic_armor/reaver_head_explore;消费=lavaTotalImmune 并集)
      if (f.lavaImmune) this.modLavaImmune = true;
      // ★612:渔猎 van 键(accLavaFishing=岩浆钓门 :14127-14140——直入 equipStats
      //  lavaFishing 池,Bobber ownerLavaOk 消费;accFishingBobber=fishingSkill+10 面=登记)
      if (f.lavaFishing) lavaFishing = true;
      // ★五百九十二:长无敌帧(van 键形;C# longInvince=true——Regenerator;
      //  消费=黑带/克脑闪避 SetImmuneTimeForAllTypes 120:80 档)
      if (f.longInvince) longInvince = true;
    }
    const moveMult = 1 + move;
    return {
      def: def + modAcc.def, mana: mana + modAcc.mana,
      hpPerSec: (life + modAcc.life) / 2, // lifeRegen 单位 = 每半秒（NaturalLifeRegen 语义）;modAcc=三百三十五刀配饰钩累加器
      dmgMelee, dmgRanged, dmgMagic,   // 箭袋 arrowDmg 移入 arrowStack（仅箭吃，:3820）
      critMelee, critRanged, critMagic,
      moveMult, meleeSpeed,
      accRunSpeed: runSpeed,   // 靴族 accRunSpeed（裸 0=未装备 → 消费侧取基准 3）
      bootFx, bootDyeVid,
      extraFall, lavaMax, armorPen, rocketBoots,
      autoJump, fireWalk, noKnockback, noFallDmg, desertBoots,
      frostBurn,
      huntressT2,                // 女猎手 T2/T3（setHuntressT2 :16119/:16149）
      anglerSetSpawnReduction,   // 渔夫套生成环（NPC.cs:627-630）
      waterWalk, waterWalkLava, jumpBoost, panic, starCloak,
      jumpOpts,
      wing, dash, blackBelt, bees, carpet,
      strongBees,   // 蜂巢背包 3333（beeType 566 档/强蜂伤/kb——Game 1121 蜂枪分支消费）
      jumpSpd: jumpSpd + (this.buffs.has(BuffType.Werewolf) ? 0.2 : 0), flipper, longInvince, spikedBoots, canFloat, shimmerImmune,
      hasFloatingTube: hasFloatingTubeVis,   // 浮游圈管体（可见轮两环,注释见接口字段）
      jellyfishNecklace, boneGlove, sporeSac, volatileGelatin,   // ★SW-FX1 单件批四旗
      treasureMagnet, goldRing, luckyCoin, discount,
      killGuide, killClothier,   // 巫毒娃娃(城镇 NPC 玩家伤害门)
      deadMansSweater,   // SW-AC1：死人毛衣 5007 胸甲件(SelfHurtPlayers 自伤 cap 面)
      dontHurtCritters: dontHurtCrittersAcc,   // ★E（4767/5323——小动物免伤面）
      preventAllItemPickups: mech.preventAllItemPickups,   // ★F3（4346——WorksInVoidBag=false 面）
      hasLucyTheAxe: mech.hasLucyTheAxe,                    // ★F3（5095）
      oldStyleParkour: mech.oldStyleParkour,                // ★F5③（6190 旧世界跑酷指南）
      infoAccs,                 // 信息饰品 12 门禁(DrawInfoAccs)
      arrowDmg, ammoSaveHuntress, ammoSaveChloro, ammoSaveCost80, ammoSaveCost75,
      kbGlove, autoReuseGlove, yoyoString, magmaStone, titaniumStorm,
      crystalLeaf,   // 叶绿水晶叶套（L3 清偿批——fixedUpdate buff 维护 + 锚体对账消费）
      meleeScaleGlove,   // 手套族近战放大 ×1.1（GetAdjustedItemScale :41919-41930）
      stringColor,   // 线饰品线色（UpdateVisibleAccessory :36441-36449）
      accDraw,       // 身上贴图十族绘制槽（UpdateVisibleAccessory :36441-36520;渲染层消费）
      aggroAcc,      // 仇恨轴 ±400 七件合计（aggro getter 并入）
      aggroPiece,    // 甲件轴：龟/甲虫/日曜件位 +=（GrantArmorBenefits :13852-97,终零波批）
      voiceOverride: voiceOverrideAcc,   // 语音饰品 override（PlayHurt/DeathSound 最高优先层）
      iceSkate,
    quiver: equipHasQuiver,
    moltenQuiver, // 箭袋族：箭速/击退 ×1.1（Player.cs:52711-52715）
      arrowStack: arrowDmg, shroomiteType, shroomiteSet, vortexSet, nebulaSet, beetleOff,
      beetleDef,
      spaceGun,   // R27：陨石套无限蓝（Game case 'magic'/Player 回蓝豁免消费）
      wolfAcc, boc,
      tileSpeed, wallSpeed, tileRange, autoPaint, chiselSpeed, toolbelt, pStone, counterWeight, vanityCounterWeight, yoyoBag,
      hasDeadCellsDownDash,   // ★BJ534：下砸装备源（触发腿干/湿两路由消费）
      yoyoGlove, magicString,   // 悠悠球袋族（UpdateEquips :14174-14226）
      flowerBoots, stepStool,
      manaMagnet, magicCuffs, manaFlower,
      manaRegenBonus, manaRegenDelayBonus,
      fishingSkill: fish + (this.usedGummyWorm ? 3 : 0) + modAcc.fish,   // +软糖虫(:12451)
      fishingTackle, lavaFishing, fishingLine,   // 钓具箱族/防熔钓族/断线免疫（R14-E6）
      royalGel,                     // 皇家凝胶 23 类史莱姆不索敌（Enemy 索敌门消费）
      manaCostOff: (manaFlower ? 0.08 : 0) + manaCostOffAcc,   // 耗魔加算折扣（:14040+:14561）
      toolboxRange, mechShowWires, autoActuator, magiluminescence,
      iceBarrierAcc, lavaRose, ashWood,   // ★Notes④ Ash Wood 全套（lava 双档+完全豁免源）
      cordage,
      overrideFishingBobber: bobberOverride,   // 浮漂饰品弹型覆写（:1920/-1=无）
      runAccMul: setRunAccMul, maxRunMul: setMaxRunMul, runSlowMul: setRunSlowMul,
      enduranceEq: setEndurance, solarSet,
      shieldItem,
      setBonus: sb,
      // 水晶球预见(29) 耗魔 -2%（manaCost -= 0.02f，Player.cs:11485——原版与饰品同池
      // 加算,本仓饰品侧为乘法聚合,折乘 0.98 并入;buffs.active 已在 equipStatsKey 缓存键内）
      manaCostMul: manaCostMul * this.buffs.clairvoyanceManaCostMult,
      minionSlots, minionDmg, minionKB, sentrySlots, whipRange,
      maxTagEffects, tagEffectDuration, accSnakeBand, accWickedArmlet,
      whipSpd: summonSet?.whipSpd ?? 1,
      summonSet,
      divingHelm, merman, arcticDivingGear, jellyfishGlow,
      nightVision: nightVisionArmor, moonLordLegs: moonLordLegsArmor,
      slowFall: slowFallArmor, pickSpeedOff,   // 组A/B 单件旗面（字段注见接口）
      accSentryBackpack, accGolemSentryBackpack,
      accHarpyCharm, accSeraphNecklace, hasPhoenixQuiver,
      accSnappingStone, accPyroclast, accArmletOfRuin,
      accPoisonBarb, accHoneyedBarb, catalystBand,
      accSharpBarb, ammoCyclerMode, mysticSashDodge, accTimerCrit, shinyStone,
      empressBrooch,   // ★BJ216 翱翔徽章 4989（四消费端见接口注）
      crimsonRegen,
      onHitRegen, onHitPetal, onHitDodge,   // 硬模式矿族 on-hit 三套（终零波批）
    };
  }
  get maxHp(): number {
    // 生命力药水（Lifeforce :9883）：statLifeMax2 += statLifeMax/5/20*20 → +20%（按 20 取整）
    const lf = this.buffs.has(BuffType.Lifeforce) ? Math.floor(this.baseMaxHp / 5 / 20) * 20 : 0;
    // ★四百七十八刀:mod 百分比生命上限(C# :2121 statLifeMax/5/20×pct——每点=
    //  基础上限/100;静态+动态双源)
    const modPct = this.modMaxLifePct + this.modMaxLifePctDyn;
    const modLife = modPct > 0 ? Math.floor(this.baseMaxHp / 5 / 20) * modPct : 0;
    return this.baseMaxHp + this.buffs.healthBonus + lf + modLife;
  }
  get maxMana(): number {
    return this.baseMaxMana + (this.equipStats.mana ?? 0) + this.buffs.manaMaxBonus; // 星力手环族等 + 水晶球预见 +20（:11481)（★BJ175 桩面 ?? 防御,缺省 0）
  }
  /** 随从/鞭伤害乘区（GetWeaponDamageMultiplier summon → minionDamage 链：独立第四链，
   *  不再复用 magic——MagicPower 等 magic-only 来源不吃召唤；四系通用来源照常） */
  get summonDamageMult(): number {
    return this.damageMult('summon');
  }
  /** 随从上限（Player.cs:9855+ buff + ApplyEquipFunctional 散件/配饰 + 套装层） */
  get maxMinions(): number {
    return 1 + (this.buffs.has(BuffType.Bewitched) ? 1 : 0)
      + (this.buffs.has(BuffType.Summoning) ? 1 : 0)
      + (this.equipStats.minionSlots ?? 0)   // ★BJ175 桩面 ?? 防御（缺省 0）
      + this.modMinionAddDyn;   // ★五百七十九:mod 动态面(PSC 守卫 +1;postUpdate 赋值)
  }
  /** 哨兵上限（maxTurrets 链 :9863 War Table buff + 散件/套装——★终零波批注订正：
   *  旧注"War Table buff 未实装暂缺"系陈位,BuffType.WarTable(27,vanilla 348) 与
   *  buffs.has 消费位早已在轨） */
  get maxSentries(): number {
    // War Table buff 348（:9863-9866 maxTurrets++，:2714 默认 1）
    return 1 + (this.equipStats.sentrySlots ?? 0) + (this.buffs.has(BuffType.WarTable) ? 1 : 0);   // ★BJ175 桩面 ?? 防御（缺省 0）
  }
  get thornsActive(): boolean {
    return this.thornsAmount > 0 || this.turtleSet;
  }
  /** 荆棘反伤乘数 thorns（UpdateBuffs 赋值链：buff14=1 / dryadWard165=0.5(<1 补)）；
   *  海龟套在消费端覆写 2（Player.cs:30912-30914 num2=turtleThorns?2:thorns——覆写非叠加） */
  get thornsAmount(): number {
    return this.buffs.thornsAmount;
  }
  /** 海龟套装（1316-1318 h99|b65|l54,Player.cs:15930-15934 turtleThorns → 反伤 ×2） */
  /** 海龟套装（vanillaArmorSets.ARMOR_SET_BONUSES_VID '1316|1317|1318'——Benefits.Turtle
   *  :159-164/注册 :447 turtleThorns → 反伤 ×2 覆写（Game :39102 turtleSet?2:thorns）。
   *  ★BJ147 组D 收编：原内联槽检（hs99/bs65/ls54）→ 单表 vid 键;等价性由闸门全三元组
   *  碰撞普查证明。★通道注：读裸 armor[]（原实现同,与 R4-19 effArmor 聚合链的分叉
   *  = loadout 共享边缘登记债,组B/C） */
  get turtleSet(): boolean {
    const a = this.inv.armor;
    return matchArmorSetBonusVid(vidOfItemId(a[0]?.id ?? -1), vidOfItemId(a[1]?.id ?? -1), vidOfItemId(a[2]?.id ?? -1))?.turtleThorns === true;
  }
  /** 仙人掌套装（vanillaArmorSets vid '894|895|896'——Benefits.Cactus :154-157/注册 :446
   *  cactusThorns → 独立定值反伤 Player.cs:30948-30958;收编注同 turtleSet） */
  get cactusSet(): boolean {
    const a = this.inv.armor;
    return matchArmorSetBonusVid(vidOfItemId(a[0]?.id ?? -1), vidOfItemId(a[1]?.id ?? -1), vidOfItemId(a[2]?.id ?? -1))?.cactusThorns === true;
  }
  /** player.head 语义（Player.cs:25336 = armor[0].headSlot；:35315-35322 时装头
   *  armor[10].headSlot ≥ 0 时覆盖）——displayArmor()[0] 即"时装优先"同式。
   *  消费：SkyRenderer 太阳分支（Main.cs:62365 head==12 太阳镜 → Sun2 骷髅头太阳）。
   *  头槽 12 = 物品 237 太阳镜（Item.cs:4273 headSlot=12, vanity） */
  get headArmorSlot(): number {
    return statOfInternal(this.inv.displayArmor()[0] ?? -1)?.hs ?? -1;
  }
  /** player.body 语义（ApplyArmorSoundAndDustChanges num2 = GetEffectiveArmor(11)
   *  .bodySlot 回落 armor[1].bodySlot，Player.cs:38454-38456）——BJ595 骨甲受击/死亡
   *  尘选型消费（:38844/:39349 boneArmor 分支）。 */
  get bodyArmorSlot(): number {
    return statOfInternal(this.inv.displayArmor()[1] ?? -1)?.bs ?? -1;
  }
  /** player.legs 语义（同上 num3 = GetEffectiveArmor(12).legSlot 回落 armor[2]） */
  get legsArmorSlot(): number {
    return statOfInternal(this.inv.displayArmor()[2] ?? -1)?.ls ?? -1;
  }
  /** boneArmor（Player.cs:38461-38465：`(num == 75 || num == 7) && num2 == 7 &&
   *  num3 == 7`——necro 骨甲三件,受击尘 26/受击音 case3 :38989/死亡尘 26 三面门）。
   *  狼人覆写支（:38458-38460 三槽改 38/21/20）= 变身域,本仓变身渲染面未建模
   *  （wereWolf 时装位）不承载=登记。frostArmor 同法检测（num2==27&&num==46&&num3==26
   *  :38467-38469）由 equipStats.frostBurn 同三元组承载,不另设旗。 */
  get boneArmor(): boolean {
    const h = this.headArmorSlot, b = this.bodyArmorSlot, l = this.legsArmorSlot;
    return (h === 75 || h === 7) && b === 7 && l === 7;
  }
  /** 近战攻速倍率（CapAttackSpeeds + TurnAttackSpeedToUseTimeMultiplier，Player.cs
   *  :29253-29262 1:1）：meleeSpeed 【加法】总和（装备 0.12 框 + 词缀 77-80 + 套装 +
   *  buff + 甲虫球 + 食物档——原版全部 `meleeSpeed +=` 同一加算堆,:26110 前完成），
   *  封顶 3 后取倒数，作为 useAnimation/useTime 的时长乘数。
   *  ★BJ640（2026-10-11）链条普查批3三面：
   *  ①聚合加法化——旧式 Tipsy/Werewolf/Weak/甲虫/食物走【乘法】叠在装备和上
   *  （(1+0.12)×1.1=1.232 vs 原版 1+0.12+0.1=1.22,多源堆叠漂移放大）;
   *  ②per-item BonusMeleeSpeedMultiplier（:26110-26112,num29=(meleeSpeed−1)×
   *  ItemID.Sets.BonusMeleeSpeedMultiplier[selectedItem]、ItemID.cs:1168 四件——
   *  Bladed Glove 0.5/Fetid Baghnakhs 0.25/Psycho Knife 0.33/Terra Blade 0.75,
   *  按手持物品缩放,在封顶【前】）;
   *  ③NoMeleeSpeedBonus（ItemID.cs:62 {3821}）排除=该物品不吃近战攻速（原版
   *  :4456 走 else 支零缩放;3821 vanilla ranged 本就不可达,表携带为数据面）。
   *  原"猛爪手套 ×2"档已废——原版猛爪手套 211 只给 meleeSpeed += 0.12 +
   *  autoReuseGlove（:14559-14562），0.12 已经 vanilla-accfx.json 走
   *  equipStats.meleeSpeed，不应再翻倍。
   *  ★R17-F5（2026-10-12）f64 vs f32 登记维持：本 getter 及攻速链消费站按 JS f64
   *  直算,原版 f32（TurnAttackSpeedToUseTimeMultiplier :29260-29266——仅 csCompat
   *  桥面 truncCSf32Mul/roundCSf32Mul 显式 f32 化）。184 态堆叠档普查零差异,
   *  非穷尽证明（f32 舍入差可存在于未普查的中间值组合）——登记为接受债,
   *  不逐一 f32 化;若未来出±1 ULP 级实报,先查此处再动刀。 */
  get attackSpeedMult(): number {
    let accum = 1
      + (this.equipStats.meleeSpeed ?? 0)                    // ★BJ175 桩面 ?? 防御（缺省 0）
      + (this.buffs.has(BuffType.Tipsy) ? 0.1 : 0)           // Tipsy meleeSpeed += 0.1（:12012）
      + (this.buffs.has(BuffType.Werewolf) ? 0.051 : 0)      // 狼人 meleeSpeed += 5.1%（:11989）
      - (this.buffs.has(BuffType.Weak) ? 0.051 : 0)          // 虚弱 meleeSpeed -= 5.1%（:12002）
      + 0.1 * this.beetleMightOrbs                           // 甲虫力量攻速（:10518-10520 98-100 分支）
      + this.buffs.wellFedMeleeSpeed                         // 食物近战速 +5/7.5/10%（:12025/:12041/:12057）
      + this.buffs.hungerMeleeSpeed;                         // 饥饿/极饿近战速 -5/-10%（:12073/:12088）
    const held = this.inv.heldItem();
    const heldVid = held ? (ITEM_DEFS[held.id]?.vid ?? -1) : -1;
    if (NO_MELEE_SPEED_BONUS.has(heldVid)) return 1;         // :62 排除表（不缩放不封顶=中性）
    const scale = BONUS_MELEE_SPEED_MULTIPLIER[heldVid] ?? 1;
    accum = 1 + (accum - 1) * scale;                         // :26110-26112 per-item 缩放
    return accum > 3 ? 1 / 3 : 1 / accum;                    // :29260-29266 封顶取倒数
  }

  /** 甲虫力量档球数（buff 98/99/100 在场派生——原版攻伤/攻速由 UpdateBuffs 的
   *  98-100 分支直加（:10518-10520），穿防御壳攒出的球【不】给猛攻数值） */
  private get beetleMightOrbs(): number {
    return this.buffs.has(BuffType.BeetleMight3) ? 3
      : this.buffs.has(BuffType.BeetleMight2) ? 2
        : this.buffs.has(BuffType.BeetleMight1) ? 1 : 0;
  }
  /** 全系伤害加成装备聚合（ApplyEquipFunctional dmgX 段；四系分道——summon 是独立
   *  minionDamage 链：装备走 SUMMON_GEAR/SET，不含 magic-only 来源） */
  damageMult(kind: 'melee' | 'ranged' | 'magic' | 'summon'): number {
    const st = this.equipStats;
    if (kind === 'summon') {
      // minionDamage 链（Player.cs GetWeaponDamageMultiplier summon 分支）：仅四系通用
      // 来源（怒气/食物）+ 召唤装备链；MagicPower/Archery 等 class 来源不吃
      let m = 1 + (st.minionDmg ?? 0);   // ★BJ175 桩面 ?? 防御（缺省 0）
      if (this.buffs.has(BuffType.Rage)) m += 0.1;
      if (this.buffs.has(BuffType.BrainOfConfusionBuff)) m += 0.1; // BOC 321（:9639-9646）
      m += this.buffs.wellFedDamage;
      m += this.buffs.hungerDamage;      // 饥饿/极饿全系 -5/-10%（:11565+/:11588+，含召唤）
      m += this.modDmgAdd?.summon ?? 0;   // ★四百九十五:mod 每 tick 条件伤加算池
      m += 0.15 * this.nebula[0];        // 星云伤害 179-181 每级四系 +15%（:10118-10124）
      // 猪鲨崽增益（Mount.cs UpdateEffects case 12 :4991：minionDamage += 0.15）
      if (this.ridingMount && this.mount.type === 12 && this.mount.fishronBoost) m += 0.15;
      // 帕鲁坐骑 62-65（1457 Mount.cs UpdateEffects case 62/63/64/65 :4862-4867：
      // melee/ranged/magic/minion 四系各 += 0.1——疾旋鼬/疾旋火鼬及其 Trusty 版）
      if (this.ridingMount && this.mount.type >= 62 && this.mount.type <= 65) m += 0.1;
      m += (this.equipStats as any).modDmgMinion ?? 0;   // ★五百七十七:mod dmgMinion
      // ★BJ725-A D1（2026-10-26）：枯萎 ×0.5 移全加算源后（1457 Player.cs:26232-26238
      //  Update 尾=UpdateEquips :25830 全部加算源（含坐骑 :25855 鱼鲨+0.15/帕鲁+0.1/
      //  modDmgMinion）聚合后才乘——旧位在坐骑加算前=增益逃过折半;melee/ranged/magic
      //  支同序（M01 批对齐）,召唤支本批补齐（bj723a 登记债 D1 清偿）
      if (this.buffs.has(BuffType.WitheredWeapon)) m *= 0.5;   // 枯萎武器（:26236）
      return m;
    }
    let m = 1 + (kind === 'melee' ? (st.dmgMelee ?? 0) : kind === 'ranged' ? (st.dmgRanged ?? 0) : (st.dmgMagic ?? 0));   // ★BJ175 桩面 ?? 防御（缺省 0）
    m += this.modDmgAdd?.[kind] ?? 0;   // ★四百九十五:mod 每 tick 条件伤加算池(Victide 水下族)
    if (kind === 'magic') {
      m += this.buffs.magicDmgBonus;            // MagicPower +20%（:9669）
    }
    // Archery 药水(16) ×1.1 不在此乘（:9711-9712 只进 arrowDamage → bowEffectiveDamage
    // :3820-3822 仅箭族消费；枪弹 gunEffective/火箭 specialistEffective 均不含
    // arrowDamage）——本仓在 rangedDamageMult('arrow') 分道处乘（:1508 附近）
    // R1 药水：怒气(117)全系 +10%（:9947）；醉酒(25)近战 +10%（:11513）
    if (this.buffs.has(BuffType.Rage)) m += 0.1;
    if (kind === 'melee') {
      if (this.buffs.has(BuffType.Tipsy)) m += 0.1;
      if (this.buffs.has(BuffType.Werewolf)) m += 0.051;      // 狼人（:11488）
      if (this.buffs.has(BuffType.Weak)) m -= 0.051;         // 虚弱（:11506）
      m += 0.1 * this.beetleMightOrbs;                         // 甲虫力量每档 +10%（:10518-10520 98-100 分支）
      if (this.heldPsychoKnife) m += (1 - this.stealth) * 3;   // 变态刀潜行（:25487）
    }
    // ★BJ723-A R01 潜行加伤【加算】入远程池（1457 Player.cs:26015-26018/:26043：
    // shroomite `rangedDamage += (1−Remap(s,1,0.75,1,0))×0.5f`、vortex
    // `rangedDamage += (1−s)×0.8f`——Update 内直加远程池，随后 GetWeaponDamageMultiplier
    // :54032-54047 箭/弹/火箭/other 四弹种统一消费；other(:54046) 裸吃 rangedDamage）。
    // 曾误作【乘数】（箭/弹/火箭 ×(1+bonus)）且 other 整漏——满潜行+50% 通用远程：
    // 星璇箭 2.70/other 1.50，应均 2.30（=1+0.5+0.8）；蘑菇矿箭 2.25 应 2.00。
    // 互斥链序 = 变态刀(:25930) > 蘑菇矿(:25982) > 星璇(:26024) if-else——
    // 手持变态刀时链首支吃掉潜行语义，远程无潜行加成
    if (kind === 'ranged' && !this.heldPsychoKnife) {
      if (st.shroomiteSet) m += (1 - shroomiteStealthRemap(this.stealth)) * 0.5;   // :26016
      else if (st.vortexSet && this.vortexStealthActive) m += (1 - this.stealth) * 0.8;                        // :26043
      // ★BJ725-A D2：vortexStealthActive 开关门（原版 :26027-26052 三加成全在块内,关开关即刻归零——移速位 :6274 既有门,三消费位本批补齐）
    }
    m += this.buffs.wellFedDamage;   // 食物三档全系 +5/7.5/10%（:11527+）
    m += this.buffs.hungerDamage;    // 饥饿/极饿全系 -5/-10%（:11564+/:11587+）
    m += 0.15 * this.nebula[0];      // 星云四系 +15%/层
    // 猪鲨崽增益（Mount.cs UpdateEffects case 12 :4988-4992：melee/ranged/magic/minion
    // 四系各 += 0.15——湿身/半血以下/雨中露天的 MountFishronSpecial 态）
    if (this.ridingMount && this.mount.type === 12 && this.mount.fishronBoost) m += 0.15;
    // 帕鲁坐骑 62-65（1457 Mount.cs UpdateEffects case 62/63/64/65 :4862-4867）：
    // melee/ranged/magic/minion 四系各 += 0.1
    if (this.ridingMount && this.mount.type >= 62 && this.mount.type <= 65) m += 0.1;
    // ★BJ723-A M01 乘区序（1457 Player.cs:26098-26105）：manaSick/manaHeat 两乘区在
    // Update 内位于 UpdateBuffs(:25763)/UpdateEquips(:25830 含坐骑 :25855)/
    // UpdateArmorSets(:25882) 全部加算源聚合【之后】才乘（枯萎 ×0.5 :26234 又在其后）。
    // 曾折在暴怒/食物/饥饿/星云/坐骑加算源之前 = 这些通用来源逃过眩晕/过热乘区
    // （基准 1+暴怒.10+食物.10+星云.45 眩晕 0.75 时得 1.40，应 1.2375）
    if (kind === 'magic') {
      m *= this.buffs.manaSickMagicMult;        // 魔力眩晕最高 -25% 线性恢复（:10412-10414/:26100）
      m *= this.manaHeatMult;                   // 1457 魔力过热乘区（:26104 magicDamage *= manaHeat）
    }
    // 枯萎武器(196)：四系伤害 ×0.5（Player.cs:25712-25719）
    if (this.buffs.has(BuffType.WitheredWeapon)) m *= 0.5;
    // ★五百四十七:mod 输出乘区面(C# multiplicativeDamage :4535-4540——
    //  GenericDamageClass 全系 ×N;【赋值】语义=每 tick mod 侧重写,缺省 1)
    if (this.modDmgMult !== 1) m *= this.modDmgMult;
    return m;
  }
  /** 远程分道乘区（1457 Player.cs:3966-3970 bowEffectiveDamage/gunEffectiveDamage/
   *  specialistEffectiveDamage 拆分,消费 GetWeaponDamageMultiplier :54031-54055）：
   *  箭 = (rangedDamage + 箭袋stack) × Archery × 蘑菇矿箭头 1.12；
   *  弹/火箭 = rangedDamage × 对应蘑菇矿头 1.12；其他（飞镖等）= rangedDamage。
   *  ★BJ723-A R01：潜行加伤已【加算】入 base（damageMult('ranged') :26016/:26043），
   *  四弹种统一随池消费——不再是独立乘数，other 不再整漏 */
  rangedDamageMult(kind: 'arrow' | 'bullet' | 'rocket' | 'other'): number {
    const st = this.equipStats;
    const base = this.damageMult('ranged'); // rangedDamage 全链（装备+四系 buff+潜行加算）
    if (kind === 'arrow') {
      // 1457 Player.cs:3966 bowEffectiveDamage = (rangedDamage/rangedMultDamage
      //   + arrowDamageAdditiveStack) × rangedMultDamage × arrowDamage——箭袋 stack
      //   只乘 arrowDamage 一次（旧码 stack×arrowMult 内外双乘 = stack 段 ×arrowMult²
      //   登记债,2026-08-22 备案遗留①修复）。rangedMultDamage 全仓仅枯萎武器 ×0.5
      //   （:26233;:18454 ResetEffects 每帧复位 1f）,本仓枯萎已折入 damageMult
      //   ('ranged')（:1769）→ 先 /M 还原加算链、stack 加在后、再回乘 M,与原式逐项等价
      const arrowMult = this.buffs.arrowDmgMult * (st.shroomiteType === 'arrow' ? 1.12 : 1);
      const rangedMultDamage = this.buffs.has(BuffType.WitheredWeapon) ? 0.5 : 1;   // :26233
      return ((base / rangedMultDamage) + (st.arrowStack ?? 0)) * rangedMultDamage * arrowMult;   // ★BJ175 桩面 ?? 防御（缺省 0）
    }
    if (kind === 'bullet') return base * (st.shroomiteType === 'bullet' ? 1.12 : 1);
    if (kind === 'rocket') return base * (st.shroomiteType === 'rocket' ? 1.12 : 1);
    return base;
  }
  /** 手持变态刀 3106（潜行判定用） */
  get heldPsychoKnife(): boolean {
    const d = ITEM_DEFS[this.inv.heldItem()?.id ?? -1];
    const vid = d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
    return vid === 3106;
  }
  /** 潜行 aggro（:25976 psycho / :26016 蘑菇矿 Remap 轴 / :26045 星璇：三源【互斥】
   *  if-else-if 链（UpdateStealth 单链），优先序 = 手持变态刀 3106 > shroomite >
   *  vortex——★⑨ 台账清偿（2026-08-31）：旧序 vortex 最先,变态刀+星璇同持时本仓
   *  吃 -1200 档而原版走 ：25929 首支 psycho -750,已按原版链序翻转。
   *  敌人索敌距离缩短（NPC.cs:78375 dist -= aggro）；各 AI 家族索敌门消费见后续批 */
  get aggro(): number {
    const eqA = this.equipStats;   // ★IIIII250 快照(4 直读→1;每敌怪每拍索敌调用)
    const s1 = 1 - this.stealth;
    // 原版 aggro 是累加字段（ResetEffects :18491 清零 → 装备 ±400/套装 ±250·300
    // 逐源 += → 潜行装 else-if 链减一面）+ 配饰轴 aggroAcc 并入（±400 七件,
    // ApplyEquipFunctional :13992-14109）+甲件轴（龟/甲虫/日曜 :13852-97,
    // GrantArmorBenefits 逐槽循环=多源 +=——★终零波批实装,旧注"甲件轴暂未建模"
    // 退役;AGGRO_ARMOR_PIECE 表见模块常量区）
    let a: number;
    if (this.heldPsychoKnife) a = -Math.round(750 * s1);             // :25976 平铺 (1−s),首支
    else if (eqA.shroomiteSet) a = -Math.round(750 * (1 - shroomiteStealthRemap(this.stealth)));  // :26016 Remap 轴
    else if (eqA.vortexSet && this.vortexStealthActive) a = -Math.round(1200 * s1);  // :26045 平铺 (1−s),尾支
    // ★BJ725-A D2：vortexStealthActive 开关门（原版 :26027-26052 三加成全在块内,关开关即刻归零——移速位 :6274 既有门,三消费位本批补齐）
    else a = 0;
    a += (eqA.aggroAcc ?? 0) + (eqA.aggroPiece ?? 0);   // 配饰轴+甲件轴（多源 +=,终零波批;★BJ175 桩面 ?? 防御,缺省 0）
    a += this.modAggroDyn;   // ★596:mod 每帧 aggro 动态面(mirage_mirror -200 等;赋值语义)
    // 隐身药水(10)：aggro 钳位（Player.cs:25437-25445）——未挥击钳 -750（索敌距离
    // +750 曼哈顿 = 敌怪"看不见"），挥击中只钳 -250；只降不升（潜行套 -1200 不被抬回）
    if (this.buffs.has(BuffType.Invisibility)) {
      const attacking = !(this.itemAnimTicks <= 0 && this.useTime <= 0);
      if (!attacking) {
        if (a > -750) a = -750;
      } else if (a > -250) {
        a = -250;
      }
    }
    return a;
  }
  /** 近战护甲穿透（磨刀 159：meleeArmorPenetration += 12，仅近战/投掷） */
  get meleeArmorPen(): number {
    return this.buffs.has(BuffType.Sharpened) ? 12 : 0;
  }
  /** 星云 booster CD（命中驱动，Game 侧判定；:12895 nebulaCD=30） */
  nebulaCD = 0;
  /** 用魔物品起手（Game 在设定 useTime 后调用）：登记动画窗，窗内每帧重置
   *  manaRegenDelay（Player.cs:42131-42137 itemAnimation>0 && item.mana>0 →
   *  ItemCheck_ApplyManaRegenDelay :49851；本仓单计时器模型以 useTime 代 useAnimation） */
  onManaItemUsed(): void {
    this.manaAnimTicks = Math.max(this.manaAnimTicks, this.useTime);
  }
  /** channel 族持械续期（channel 弹实体在 channelCb() 活跃期每 tick 调用）：
   *  原版 channel 武器按住期间 itemAnimation 持续 >0 → ItemCheck_ApplyManaRegenDelay
   *  （Player.cs:43143-43146 itemAnimation>0 && item.mana>0 每帧）恒把 manaRegenDelay
   *  刷回 4（ApplyManaRegenerationDelay :19517-19540 ManaV2 钉值）→ 全程 5% 滴流回蓝
   *  （UpdateManaRegen flag3 支 :19563-19567/:19601-19604）。本仓 channel 弹寿命 >
   *  useTime，manaAnimTicks 只在出手拍登记（onManaItemUsed）→ useTime 耗尽即回满速
   *  回蓝 = channel 期白嫖魔力（2026-08-22 审计 ❌）。修复 = channel 活跃期把动画窗
   *  钉 ≥1，下一帧 fixedUpdate 的 `manaAnimTicks>0` 支消费（--→applyManaRegeneration
   *  Delay → delay 钉 4 → 衰减 3 ∈ (0,4) → 5% 滴流），与直射武器每拍刷新同语义。
   *  调用侧用可选链（`?.()`）——容忍测试 mock player 缺该方法 */
  onChannelManaHold(): void {
    this.manaAnimTicks = Math.max(this.manaAnimTicks, 1);
  }

  // ---- 1457 配饰四件本体（ammoCycler / sentry backpack / accTimerCrit /
  //      accHarpyCharm——旗落聚合在 equipStats,运行态+消费端 2026-08-23 批）----

  /** Update_AmmoCycler + Update_SentryBackpack + Update_HarpyCharm + Update_TimerCrit
   *  （Player.cs:24760-24763 四连调,本体 :28632-28659/:28521-28562/:28661-28704）。
   *  fixedUpdate 每 tick 调（原版 Update 同位）。 */
  /** 冷却回充三连尘（Spawn_SnappingStoneRecharge P57:454-470 / Pyroclastic :437-452 /
   *  ArmletOfRuin :418-435 共用形态）：NewDust(position,w,h,type,0,0,α) 后置字段
   *  noLight/noGravity/scale/fadeIn/y=半高/customData=player/noLightEmittance。
   *  pull 系（226/15）velocity×0.5 再 vy×3；circular 系（6）v=Circular(2,4)。 */
  private emitRechargeDust(game: GameHooks, type: number, count: number,
    scale: number, alpha: number, pull: boolean): void {
    for (let i = 0; i < count; i++) {
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, type, 0, 0, alpha, null, scale);
      if (!d) continue;
      d.noLight = true;
      d.noGravity = true;
      d.scale = scale;
      d.fadeIn = 1.1;
      d.y = this.y + this.h / 2;
      if (pull) {
        d.vx *= 0.5;
        d.vy *= 3;
      } else {
        d.vx = (Math.random() * 2 - 1) * 2;               // NextVector2Circular(2,4)
        d.vy = (Math.random() * 2 - 1) * 4;
      }
      d.alpha = alpha;
      d.followPlayer = true;                              // customData=player
      d.noLightEmittance = true;
    }
  }

  /** 荧光体 5107 手持光（ApplyEquipFunctional case 5107 :14663-14669；经 UpdateEquips
   *  :25830 每 tick 无条件跑——地面门只在跑速四参数 :26703-26709,光照臂无门）：
   *  DelegateMethods.v3_1=(0.9,0.8,0.5) + 两条宽 20px 的 PlotTileLine 布光线——
   *  ① Center→Center+velocity*6（速度前伸臂）;② Left→Right（碰撞盒横贯臂）。
   *  CastLightOpen（DelegateMethods.cs:729-748）=开放格才布光:active 实心非 solidTop
   *  非致动格跳过【但不截断线】（恒返 true）,界外/空 tile 返 false 截断整线 */
  private emitMagiluminescenceLight(game: GameHooks): void {
    if (!this.equipStats.magiluminescence || !game.addLightAt) return;
    const store = game.world.store;
    const emit = (tx: number, ty: number): boolean => {
      if (tx < 0 || tx >= store.w || ty < 0 || ty >= store.h) return false;   // 界外截断(:731-735)
      // 开放门(:738-742)：!active || inActive || solidTop || !solid 才 AddLight
      // ——本仓 isActive=nactive(active&&!inActive) 与原版 or 门在两分支下等价
      if (!store.isActive(tx, ty) || !store.isSolid(tx, ty)) {
        game.addLightAt!(tx * TILE + 8, ty * TILE + 8, 0.9, 0.8, 0.5);
      }
      return true;
    };
    // PlotTileLine 几何见 plotTileLine 注（Utils.cs:2460-2487 垂直 ±10px 平行线对）。
    // ★线 1 锚=base.Center（盒中心;MountedCenter 只出现在丢弃返回值的
    //   ToTileCoordinates() 调用 :14665,坐骑态两者不同,勿混）
    plotTileLine(this.x + this.w / 2, this.y + this.h / 2,
      this.x + this.w / 2 + this.vx * 6, this.y + this.h / 2 + this.vy * 6, 20, emit);
    plotTileLine(this.x, this.y + this.h / 2, this.x + this.w, this.y + this.h / 2, 20, emit);
  }

  private update1457AccBodies(game: GameHooks): void {
    // Player.Update 主体的雪球发射器右键冷却递减（:24752-24756，myPlayer 门；
    // 原版位置紧邻 Update_SnappingStone/HarpyCharm/AmmoCycler 之前）
    if (this.snowballLauncherInteractionCooldown > 0) this.snowballLauncherInteractionCooldown--;
    // Update_AmmoCycler（:28632-28638）：冷却走完归 0 拍把轮换偏移复位
    if (this.ammoCyclingCooldown > 0 && --this.ammoCyclingCooldown === 0) {
      this.ammoCyclingOffset = 0;
    }
    // Update_SentryBackpack（:28640-28646）：抓取占位冷却递减（携带中哨兵 AI 每拍续约）
    if (this.accSentryBackpackGrabCooldown > 0) this.accSentryBackpackGrabCooldown--;
    // Update_HarpyCharm（:28648-28659）：冷却 >0 递减,归零拍扫描在场箭引矢
    if (this.accHarpyCharmCooldown > 0) this.accHarpyCharmCooldown--;
    else harpyCharmEffect(game, this);
    // Update_TimerCrit（:28521-28562）：num=1000 上限
    if (this.accTimerCritCharge < 1000) {
      if (this.accTimerCritCharge < 0) {
        this.accTimerCritCharge += 1;                    // :28528-28533 负窗 1/t 回充
      } else {
        // :28534-28537 num5 = 3 + (UsingOrReusingItem ? 0 : 3) + (|v|<0.1 ? 3 : 0)
        // ——本仓 UsingOrReusingItem ≈ itemAnimTicks>0 || useTime>0（挥舞窗/冷却窗）
        const usingItem = this.itemAnimTicks > 0 || this.useTime > 0;
        const speed = Math.hypot(this.vx, this.vy);
        this.accTimerCritCharge += 3 + (usingItem ? 0 : 3) + (speed < 0.1 ? 3 : 0);
        if (this.accTimerCritCharge >= 1000) {
          this.accTimerCritCharge = 1000;                // :28538-28542 钳满
          if (this.equipStats.accTimerCrit) {
            // :28543-28561 满蓄提示 SoundID.Item28（vol 0.04/pitch −0.9）+ 尘 228×5
            game.playSfxFiles?.(['Item_28'], 0.04, this.cx, this.cy);
            for (let i = 0; i < 5; i++) {
              game.spawnDust?.(this.x, this.y + this.h * (1 - this.accTimerCritCharge / 1000),
                this.w, this.h, 228, 0, 0.03, 255, null, 0.9, true);
            }
          }
        }
      }
    }
  }

  /** TryConsumingTimerCrit（Player.cs:28564-28595；调用点 :44657 ItemCheck 近战命中
   *  等 5 处全在近战接触结算）：满蓄（timerCritChargeFull :3387 ≥1000）或负冷却窗
   *  （charge<0，:28566）→ 强制暴击；charge>0 时消费置 −15（:28568-28571,负窗内
   *  不重置=15t 连暴窗）。粒子面按原文两段直译（δB B4 接线,2026-08-31——旧 6 颗
   *  '#E8E8FF' 通用白粒近似退役）：
   *   ① :28574-28577 NightsEdge 编排 RequestParticleSpawn(clientOnly:false)——
   *      PositionInWorld=hitbox.Center;本地直生(fx/orchestraFx.nightsEdgeFx 同本体)
   *      + module8 上行补远端；
   *   ② :28578-28593 尘 228×20：noLight/noGravity、scale .9/fadeIn 1.1、Y 钳盒垂直
   *     中点（position.Y=vector.Y+num2/2）、customData=null(不跟随)、noLightEmittance;
   *      velocity 终值 = (π/4+π/2·i) 方向 × NextFloat()×4 径向环——原文先 ×0.5 再
   *      vy×3 的中间式被尾式赋值整体覆写=死支，直译终值不叠算。
   *  返回 true = 本次命中强制暴击。 */
  tryConsumingTimerCrit(game: GameHooks, rx: number, ry: number, rw: number, rh: number): boolean {
    if (!this.equipStats.accTimerCrit) return false;
    if (!(this.accTimerCritCharge >= 1000 || this.accTimerCritCharge < 0)) return false;
    if (this.accTimerCritCharge > 0) this.accTimerCritCharge = -15;   // :28568-28571
    const cx0 = rx + rw / 2, cy0 = ry + rh / 2;                       // hitbox.Center
    nightsEdgeFx(game, cx0, cy0);                                     // Spawn_NightsEdge 收编本体
    game.broadcastParticleOrchestra?.(ParticleOrchestraType.NightsEdge, cx0, cy0);
    for (let i = 0; i < 20; i++) {                                    // 尘 228×20（:28578）
      const d = game.spawnDust?.(rx, ry, rw, rh, 228, 0, 0, 255, null, 0.9);
      if (!d) continue;
      d.noLight = true;                                               // :28581
      d.noGravity = true;                                             // :28582
      d.scale = 0.9;                                                  // :28583
      d.fadeIn = 1.1;                                                 // :28584
      d.y = cy0;                                                      // :28585 position.Y=盒中点
      const ang = Math.PI / 4 + (Math.PI / 2) * i;                    // :28588 基角族
      const sp = Math.random() * 4;                                   // NextFloat()×4 幅
      d.vx = Math.cos(ang) * sp;
      d.vy = Math.sin(ang) * sp;
      d.noLightEmittance = true;                                      // :28591
    }
    return true;
  }

  /** PickAmmo 实耗侧轮换推进（Player.cs:54209-54217）：模式≠None 且真实射击
   *  （!dontConsume）→ cooldown = useAnimation+120、offset++；Random 模式 offset
   *  直写随机（:54214-54217）。无弹药早退（:54101-54104）不推进——调用侧须在
   *  选弹命中后调。 */
  noteAmmoCycledShot(useAnimation: number): void {
    if (this.equipStats.ammoCyclerMode === 0) return;
    this.ammoCyclingCooldown = useAnimation + 120;
    this.ammoCyclingOffset++;
    if (this.equipStats.ammoCyclerMode === 3) {
      this.ammoCyclingOffset = Math.floor(Math.random() * 2147483647);   // Main.rand.Next()
    }
  }

  /** PickAmmo_PickAmmoItem（Player.cs:54368-54390）+ PickAmmo_IterateRange
   *  （:54326-54366）：按 ammoCyclerMode 选弹药槽,返回命中的背包槽位（-1=无弹药）。
   *  AmmoSlots(1)=先只在弹药槽（54-57;币族 50-53）内轮换,空则回退默认序【不轮换】
   *  （:54389 allowAmmoCycling=false）;FullInventory(2)/Random(3)=默认序轮换;
   *  None(0)=默认序首个（1.4.4 语义）。默认序 = 币 50-53 → 弹药 54-57 → 背包 0-53
   *  （AmmoSlotOrder_Default :3175）。克塔敏化器 779/大地改造器 5134 恒取第一组
   *  （:54347-54350）。matches = `item.ammo == sItem.useAmmo && stack > 0` 的槽判定。 */
  pickAmmoSlot(matches: (id: number) => boolean, useAmmo: number, weaponVid: number): number {
    const mode = this.equipStats.ammoCyclerMode;
    const forceFirst = weaponVid === 779 || weaponVid === 5134;   // :54347-54350
    if (mode === 1) {
      const order = useAmmo === 71 ? AMMO_SLOT_ORDER_COINS_ONLY : AMMO_SLOT_ORDER_AMMO_ONLY;
      const hit = pickAmmoIterateRange(order, this.inv.slots, matches,
        this.ammoCyclingOffset, true, forceFirst);
      if (hit >= 0) return hit;
    }
    return pickAmmoIterateRange(AMMO_SLOT_ORDER_DEFAULT, this.inv.slots, matches,
      this.ammoCyclingOffset, mode === 2 || mode === 3, forceFirst);
  }

  /** 装备暴击率（critX 段 + 词缀 67/68） */
  critChance(kind: 'melee' | 'ranged' | 'magic'): number {
    const st = this.equipStats;
    let c = kind === 'melee' ? (st.critMelee ?? 0) : kind === 'ranged' ? (st.critRanged ?? 0) : (st.critMagic ?? 0);   // ★BJ175 桩面 ?? 防御（缺省 0,基础 4 在调用侧）
    // R1 药水：暴怒(115)全系暴击 +10（:9890）；醉酒(25)近战暴击 +2（:11515）
    if (this.buffs.has(BuffType.Wrath)) c += 10;
    if (this.buffs.has(BuffType.BrainOfConfusionBuff)) c += 10; // BOC（:9639）
    if (kind === 'melee' && this.buffs.has(BuffType.Tipsy)) c += 2;
    if (kind === 'melee' && this.buffs.has(BuffType.Werewolf)) c += 2; // 狼人（:11493）
    if (kind === 'magic') c += this.buffs.clairvoyanceMagicCrit; // 水晶球预见 +2（:11482）
    if (kind === 'melee' && this.heldPsychoKnife) c = Math.min(100, c + Math.round((1 - this.stealth) * 30)); // 变态刀（:25489）
    if (kind === 'ranged') {
      if (this.equipStats.shroomiteType) c += 5; // 蘑菇矿头 rangedCrit+5（:13274+）
      // 潜行暴击：星璇平铺 (1−s)×20（:26044）；蘑菇矿 Remap 轴 ×10（:26015/:26017）
      if (st.vortexSet && this.vortexStealthActive) c += Math.round((1 - this.stealth) * 20);
      // ★BJ725-A D2：vortexStealthActive 开关门（原版 :26027-26052 三加成全在块内,关开关即刻归零——移速位 :6274 既有门,三消费位本批补齐）
      else if (st.shroomiteSet) c += Math.round((1 - shroomiteStealthRemap(this.stealth)) * 10);
    }
    c += this.buffs.wellFedCrit;    // 食物三档全系暴击 +2/3/4（:11525+）
    c += this.buffs.hungerCrit;     // 饥饿/极饿全系暴击 -2/-4（:11562+/:11585+）
    c += this.modCritAdd[kind] ?? 0;   // ★五百五十三:mod 暴击加算面(C# GetCritChance<系> 加法池)
    return c;
  }

  get frame(): number {
    if (!this.onGround) return 4;
    if (Math.abs(this.vx) > 0.3) {
      return 1 + Math.floor(this.animTime / 8) % 3;
    }
    return 0;
  }

  /** 坐骑能力维护上下文（Mount.updateMountEffects 用）：Scutlix/Santank 索敌候选
   *  （CanBeChasedBy 口径过滤）+ 视线门 + 发射桶（606 眼激光 / 930 炮击 / 14 子弹）+
   *  冲刺尘/山羊火焰 + 猪鲨崽天气视图（Player.cs:25373 UpdateEffects
   *  :4884-4930/:4996-5003 对应数据源）。索敌候选惰性组装——仅眼炮族（9/46）消费 */
  private mountEffectsCtx(game: GameHooks): import('./Mounts').MountEffectsCtx {
    const st = this.lastStore;
    const raining = !!game.world.weather?.raining;
    const needTargets = this.mount.type === 9 || this.mount.type === 46;
    const targets: import('./Mounts').ScutlixTarget[] = [];
    if (needTargets) {
      for (const e of game.enemies()) {
        const n = e as { x: number; y: number; w: number; h: number; dead: boolean;
          maxHp: number; def?: { friendly?: boolean; critter?: boolean } };
        // NPC.CanBeChasedBy（NPC.cs:28334：active && chaseable && lifeMax>5 && !friendly && !immortal）
        if (n.dead || n.maxHp <= 5 || n.def?.friendly || n.def?.critter) continue;
        if (n.x === undefined || n.w === undefined) continue;
        targets.push({ x: n.x, y: n.y, w: n.w, h: n.h });
      }
    }
    return {
      scutlixTargets: targets,
      los: (cx, cy, t) => !!st && canHitLine(st, cx, cy, 0, 0, t.x, t.y, t.w, t.h),
      // 眼激光 606（UseAbility case 9）：MountShot 实体化（extraUpdates 2 → 42px/tick）
      fireScutlixShot: game.spawnTownShot
        ? (x, y, vx, vy) => {
          game.spawnTownShot?.(new MountShot(x, y, vx, vy, SCUTLIX_SHOT_DAMAGE, 0, SCUTLIX_PROJ_ID));
        }
        : undefined,
      // Santank 双炮（UseAbility case 46）：930 炮击（伤 120——SantankShellProj 全量：
      // penetrate−1/归航/触墙引信/128×128 爆散）+ Item_89 / 14 子弹（伤 100 直线
      // + Item_11；自带 light 0.5 走 Game 弹幕点光通道）
      fireSantankShot: game.spawnTownShot
        ? (kind, x, y, vx, vy) => {
          if (kind === 'cannon') {
            game.spawnTownShot?.(new SantankShellProj(x, y, vx, vy, 120, 0, 930));
            game.playSfxFile?.('Item_89', 0.2, x, y);
          } else {
            game.spawnTownShot?.(new MountShot(x, y, vx, vy, 100, 0, 14));
            game.playSfxFile?.('Item_11', 0.2, x, y);
          }
        }
        : undefined,
      // 冲刺尘（UpdateFrame case 10/47 dashBurst 段 :3896-3922 原式改）：
      //   · 起锚 = Center+(width×direction, 0)（身侧非盒心）；
      //   · 相位 = UnitY.RotatedBy(i·2π/14+rand 首拍相位)，半径缩放 = 0.2×frameExtra
      //     （冲刺帧数累积→尘环外扩），轴向 (40,30)；
      //   · velocity = 方向单位向量【原样】(幅值 0.2×frameExtra) + (RunSpeed−sign(vx)
      //     ×frameExtra×2, 0)（此前 ×4 环向均匀+恒定 runSpeed 为近似式）；
      //   · 尘参 noGravity/scale 1+r0.8/fadeIn r2 一致；山羊 noLightEmittance。
      //   独角兽额外追尾尘（:3924-3932）：dashing 每 tick 盒内 1 粒（vel=0、scale
      //   0.5+r0.8、fadeIn 1+r2）。 dye shader GetSecondaryShader(cMount)（:3920）
      //   ★BJ707-G29 接线：尘池 dyeVid 面（d.dyeVid）+mountDyeVid()（miscDyes[3]）。
      //   缺省池回退程序粒子环向爆发保持原状
      dashDust: (x, y, n, spread, type) => {
        void x; void y; void n;   // 入参退役：原版几何由下方 mount 态自算（兼容旧签名）
        const pool = game.vanillaDust;
        if (!pool) {
          game.spawnBurst?.(this.cx + this.w * this.facing, this.cy,
            type === 6 ? '#8C6A4A' : '#D8D0E0', 14, 3, 0, Math.PI * 2, { life: 30, grav: 0 });
          return;
        }
        void spread;
        const ax = this.cx + this.w * this.facing, ay = this.cy;
        const phase = Math.random() * Math.PI * 2;               // num22 = rand·2π
        const mDyeVid = this.mountDyeVid();                      // cMount（:3920，环外取一次）
        for (let i = 0; i < 14; i++) {                           // num23 <14f（:3906）
          const ang = i * (Math.PI * 2) / 14 + phase;            // :3909
          let ux = -Math.sin(ang), uy = Math.cos(ang);           // UnitY.RotatedBy
          const k = 0.2 * spread;                                // *= 0.2f×frameExtra(:3910)
          ux *= k; uy *= k;
          const velX = ux + this.mount.runSpeed()
            - Math.sign(this.vx) * spread * 2;                   // vector11 + (RunSpeed−sign·fe·2)(:3912)
          const d = pool.spawn(ax + ux * 40, ay + uy * 30, 0, 0, type, velX, uy);
          if (d) {                                               // :3913-3919
            d.noGravity = true;
            if (type === 6 && this.mount.type === 47) d.noLightEmittance = true;
            d.scale = 1 + Math.random() * 0.8;
            d.fadeIn = Math.random() * 2;
            d.dyeVid = mDyeVid;                                  // :3920 shader=GetSecondaryShader(cMount)
          }
        }
      },
      // 独角兽追尾尘（UpdateFrame case 10 :3924-3932）：dashing 每 tick 玩家盒内
      // 1 粒——position=NewDust(整盒)、velocity=Zero、noGravity、scale .5+r×.8、
      // fadeIn 1+r×2；dye shader（:3931 obj3.shader=cMount）★BJ707-G29 同 dashDust 接线
      dashDustBody: (type) => {
        const pool = game.vanillaDust;
        if (!pool) return;
        const d = pool.spawn(this.x, this.y, this.w, this.h, type, 0, 0, 100, null, 1);
        if (d) {
          d.vx = 0; d.vy = 0;
          d.noGravity = true;
          d.scale = 0.5 + Math.random() * 0.8;
          d.fadeIn = 1 + Math.random() * 2;
          d.dyeVid = this.mountDyeVid();                         // :3931 shader=GetSecondaryShader(cMount)
        }
      },
      // 山羊火焰（ParticleOrchestrator.WallOfFleshGoatMountFlames :3892-3895 引用，
      //  Spawn_WallOfFleshGoatMountFlames 编排器定义 ParticleOrchestrator.cs:3259-3306）：
      //  3 束 FlameParticle（x = 入参 ±5.3333335px，零速，scale 0.1-1.0，TTL 50，
      //  贴图 326/327/328——本体层已 1:1 落地 src/fx/FlameParticles.ts，绘制走
      //  Renderer.drawFlameParticles = Main.ParticleSystem_World_BehindPlayers）+
      //  每束 1/8 概率 dust 6（NewDustDirect(vector,4,4,6,0,0,α100) 后 velocity×0.6、
      //  vy-1.2、y-4、noLight；50% noGravity+fadeIn1.15 / 50% scale0.6）——尘段 1:1。
      goatFlames: (x, y) => {
        // FlameParticle 本体层（编排器 :3262-3290 的三束段）
        flameParticles.spawnGoatFlames(x, y);
        const pool = game.vanillaDust;
        if (!pool) return;   // 无尘池（测试桩）：尘段静默跳过（火焰本体层不受影响）
        for (let i = -1; i <= 1; i++) {
          const vx0 = x + i * 5.3333335;                     // :3269 三束同偏移
          if (Math.floor(Math.random() * 8) !== 0) continue;   // :3292 Next(8)==0
          const d = pool.spawn(vx0, y, 4, 4, 6, 0, 0, 100);
          if (!d) continue;
          if (Math.floor(Math.random() * 2) === 0) {           // :3293 Next(2)==0
            d.noGravity = true;
            d.fadeIn = 1.15;
          } else {
            d.scale = 0.6;
          }
          d.vx *= 0.6;                                          // :3299 velocity *= 0.6
          d.vy = d.vy * 0.6 - 1.2;                              // :3300 velocity.Y -= 1.2
          d.noLight = true;                                     // :3301
          d.y -= 4;                                             // :3302 position.Y -= 4
        }
      },
      // ★BJ357 仙灵武库 61 拖尾辉尘落池（Mount.cs UpdateEffects case 61 :5203-5224
      //  发粒段;掷门/色算/速度式在 Mounts.updateMountEffects）——NewDustDirect
      //  (Center,0,0,278,0,0,α200,color,0.65) 后 velocity×mul + v×0.3、noGravity、
      //  noLight 字段覆写（:5213-5223）。0 宽盒出尘=抖动窗仍掷（mul 消费它）,
      //  perfect 变体不用（会消解抖动=丢 :5214/:5217 乘项）
      pixieTrailDust: ({ x, y, mul, pvx, pvy, color }) => {
        const pool = game.vanillaDust;
        if (!pool) return;
        const d = pool.spawn(x, y, 0, 0, 278, 0, 0, 200, color, 0.65);
        if (!d) return;
        d.vx = d.vx * mul + pvx * 0.3;
        d.vy = d.vy * mul + pvy * 0.3;
        d.noGravity = true;
        d.noLight = true;
      },
      miscCounter: this.miscCounter,
      fishron: {
        hp: this.hp, maxHp: this.maxHp,
        inWater: this.inWater, inLava: this.inLava, inHoney: this.inHoney,
        dripping: this.buffs.has(BuffType.Wet),  // Player.dripping（buff 103 Wet 激活 :11342）
        raining,
        windExposed: raining && !!st
          && inAPlaceWithWind(st, this.x, this.y, this.w, this.h, game.world.groundLevel,
            game.world.seedFlags?.remix === true),
      },
      // ★SW-FX18 高尔夫球车轮尘（EmitGolfCartWheelDust :4710-4742）：掷门与轮位
      // 在 Mounts.updateMountEffects；此处补实心地面门（:4720 SolidTile）后发 1 粒
      // mapColor 粒子（KillTile_MakeTileDust 尘族 = breakTile 同款 mapColor 粒子制,
      // 登记口径；KillTile_GetTileDustAmount 尘量钳 1（:4723-4725）→ 恒 1 粒）。
      // 速度 = tileDust×0.2 + (kickDir, −gravDir)（:4727-4731）→ 显式初速 =
      // (kickDir, −1) ± 0.3 抖（tileDust 初速随机 ±2 的 ×0.2 档）；position 钉轮位
      // （:4732 obj.position = legSpot）,scale×0.8/fadeIn×0.8（:4733-4734——tile 尘
      // fadeIn 多为 0,等价 0）
      wheelDust: (wx, wy, kickDir) => {
        const st2 = this.lastStore;
        if (!st2) return;
        const tx = Math.trunc(wx / 16), ty = Math.trunc((wy + 2) / 16);
        // WorldGen.SolidTile(p) 门（:4720——半砖/坡/平台不算实心）
        if (!solidTileAt(st2 as unknown as import('./Mounts').SolidTileView, tx, ty)) return;
        const i = st2.idx(tx, ty);
        const color = TILE_DEFS[st2.type[i]]?.mapColor ?? '#8B7553';
        game.spawnParticles(wx, wy, color, 1, 1,
          { vx: kickDir + (Math.random() - 0.5) * 0.6, vy: -1 + (Math.random() - 0.5) * 0.6 });
      },
      // ★BJ707-G31（G29 登记债②清偿）:cMount 尘发射面通道——海盗船 44（尘 228×2 面）/
      //  惊魂木 45（d6/d31×2 面）/扫帚 23（星尘 43×2 面）/蜥蜴 14（d31×2+蓄能 d6 环）
      //  的发射几何全在 Mounts.updateMountEffects（updateFrame 写沿闩/速度门旗）,
      //  落池走本 typed 尘池直入（NewDust 同构,后置字段调用侧覆写——goatFlames/
      //  pixieTrailDust 同惯例）;染料 = mountDyeVid()（miscDyes[3] 单源零掷,G29
      //  通道勿重建——尘池 d.dyeVid+Renderer 染料 pass 既有）。
      vanillaDust: game.vanillaDust,
      mountDyeVid: () => this.mountDyeVid(),
      // 扫帚挂件风摆两项（GetWitchBroomTrinketRotation :3591-3604 与 mountLights
      // case 23 同式共享）:WindForVisuals=windSpeedCurrent;露天档=mountWindExposed
      // （InAPlaceWithWind 中心格快照,扫帚挂件批既有位）
      wind: game.world?.weather?.windSpeedCurrent ?? 0,
      windExposed: this.mountWindExposed === true,
      // 蜥蜴 14 面 1 的 cMount==0 地板尘（:4140-4148 `position ±num2×24 移位
      //  FloorVisuals(Falling:true)`——MakeFloorDust 落地 20 连发;旗块面仓内为
      //  即时读无持久旗=等效只尘面;±24 移位内联本闭包,finally 语义还原）
      basiliskFloorDust: (shiftX) => {
        const ox = this.x;
        this.x += shiftX;
        this.makeFloorDust(game, true, game.world);
        this.x = ox;
      },
    };
  }

  /** 1457 新方法 ApplyManaRegenerationDelay（Player.cs:19515-19540）：用魔惩罚期置值
   *  统一入口。公式与 1456 三处内联相同（(1−mana/max)×240+45 再 ×0.7 取整），但
   *  新增 manaRegenBuff 时钳 20f——1456 该钳只在 UpdateManaRegen 每帧做，1457 挪到
   *  置值时点（QuickBuff :5877 / ItemCheck_ApplyManaRegenDelay :51204 /
   *  CommandForbiddenStorm :57546 三处改调本方法）→ 回蓝 buff 期间惩罚期变短。
   *  smm = statManaMax2（调用侧已备）。
   *  ★DebugOptions.ManaV2 分支（:19526-19537）为 release 正式行为（ManaV2 默认 true,
   *  Testing/DebugOptions.cs:30）——2026-08-21 批 1 遗漏半边补齐：置值后钳 4 帧
   *  （num2=num3=4：delay>4 → 4；statMana>0 → 恒钉 4）。官方"完全移除延迟"即此
   *  4 帧残桩（0.067s），攻击期每帧刷新 delay=4 → UpdateManaRegen 恒落 5% 滴流支 */
  applyManaRegenerationDelay(smm = this.maxMana): void {
    const base = smm > 0 ? (1 - this.mana / smm) * 240 + 45 : 45;
    this.manaRegenDelay = Math.floor(base * 0.7);      // :19518-19521（×0.7 后才取整）
    if (this.buffs.manaRegenBuff && this.manaRegenDelay > 20) {
      this.manaRegenDelay = 20;                        // :19522-19525 回蓝期钳 20f
    }
    // DebugOptions.ManaV2（:19526-19537）：num2=num3=4
    if (this.manaRegenDelay > 4) this.manaRegenDelay = 4;   // if (delay > num3) delay = num3
    if (this.mana > 0) this.manaRegenDelay = 4;             // if (statMana > 0) delay = num2（空蓝只钳上界不钉值）
  }

  /** 魔力花 QuickMana 钩子（CheckMana manaFlower 支 :53226-53239 内的 QuickMana()
   *  调用,:5590）。Player 层无 Game 引用（音效/背包变更回调在 Game 侧）→ 构造后由
   *  Game 接线到 quickMana()（QuickMana 全门版：死亡/满蓝/药水病 healBlocked 门,
   *  :5590-5596 + :5621 GetItemToUse 的 potionDelay 门）。未接线（测试/远端代理）
   *  = 该支静默跳过,行为同无魔力花 */
  quickManaHook: (() => void) | null = null;

  /** 1457 CheckMana（Player.cs:53216-53253；DebugOptions.ManaV2 默认 true——
   *  Testing/DebugOptions.cs:30,release 正式行为）：入口清 slowMagicUse（:53217）→
   *  蓝够扣魔返 true；不足 → manaFlower QuickMana 支（:53226-53239,2026-08-22 备案
   *  遗留②补齐：channel 续发每拍 ItemCheck_TryStartUse :52660-52690 →
   *  ItemCheck_ActuallyPayMana :53277 → CheckMana 直通本端口,装备魔力花时自动喝蓝
   *  重估——Game 主施法链 :9943-9961 内联支不动,两条入口语义自此一致）→ 仍不足
   *  statMana=0（:53243/:53254）+ DoRunOutOfManaEffect()（:53258-53261
   *  slowMagicUse=true）→ ManaV2 恒返 true =【空蓝照放】（慢施惩罚经
   *  GetSlowMagicUseTime/Rate/Scalar :47425-47456 消费） */
  checkMana(amount: number, blockQuickMana = false): boolean {
    this.slowMagicUse = false;                     // :53217 入口清标记（每次重估）
    if (this.mana >= amount) {
      this.mana -= amount;                         // if (pay) statMana -= num
      return true;
    }
    if (this.equipStats.manaFlower && !blockQuickMana) {   // :53226 if (manaFlower && !blockQuickMana)
      this.quickManaHook?.();                      // :53228 QuickMana()（Game.quickMana 全门版）
      if (this.mana >= amount) {
        this.mana -= amount;                       // if (pay) statMana -= num
        return true;
      }
    }
    // ★五百五十五:负 mana 面(C# Player.cs:5878 statMana -= mana×manaCost
    //  可产负值;ChaosStone statMana<0 门依赖此态——原两路径分离→本仓 checkMana
    //  单路径=负值结构性不可达;修=扣量直落(可负)=C# :5878 直扣同相)
    this.mana -= amount;                           // 可负=ChaosStone 检测面
    this.slowMagicUse = true;                      // DoRunOutOfManaEffect :53258-53261
    return true;                                   // ManaV2：照常施法
  }

  /** 1457 新方法 TryApplyManaHeat（Player.cs:52644-52652）：登记最近 ManaHeat 源并
   *  挂 buff 396（时长 = time×60 tick）。power/time 任一为 0 不挂 buff（字段仍覆写） */
  tryApplyManaHeat(power: number, time: number): void {
    this.latestManaPotionDamageBonus = power;            // :52646
    this.latestManaPotionDuration = time * 60;           // :52647
    if (time !== 0 && power !== 0) {
      this.buffs.apply(BuffType.ManaHeat, (time * 60) / 60);  // :52650 AddBuff(396, duration)
    }
  }

  /** 1457 ApplyManaPotionManaHeat（Player.cs:52606-52642）：蓝药 189/500/2209 →
   *  0.05/0.10/0.15 × 20s。★1457 该方法【无调用点】（死代码——活路径只有魔力星
   *  35350/:35368 直调 TryApplyManaHeat），按原样备位不接线，喝蓝不触发 ManaHeat */
  static readonly MANA_POTION_MANA_HEAT: Record<number, [number, number]> = {
    189: [0.05, 20], 500: [0.1, 20], 2209: [0.15, 20],
  };

  /** 1457 魔力过热伤害乘区（Update :26098-26105 + UpdateBuffs buff 396 段 :10416-10429）：
   *  manaHeat 每帧 ResetEffects 清 1f 后由 buff 396 累加
   *  latestManaPotionDamageBonus × (buffTime/latestManaPotionDuration)——线性随
   *  剩余时长衰减。本仓以纯读 getter 等价（active 存秒） */
  get manaHeatMult(): number {
    const left = this.buffs.active.get(BuffType.ManaHeat);
    if (left === undefined || this.latestManaPotionDamageBonus === 0) return 1;
    const duration = this.latestManaPotionDuration > 0 ? this.latestManaPotionDuration : 1;
    return 1 + this.latestManaPotionDamageBonus * ((left * 60) / duration);
  }

  // ---- 1457 slowMagic 蓝空过载施法减速（Player.cs:47425-47456/:52593-52604）----
  /** GetSlowMagicMultiplier（:47453-47456）：恒 2.5（private static） */
  static readonly SLOW_MAGIC_MULTIPLIER = 2.5;
  /** GetSlowMagicUseTime（:47425-47432）：出手窗时长 ×2.5 */
  getSlowMagicUseTime(originalTime: number): number {
    if (!this.slowMagicUse) return originalTime;
    return Math.floor(Player.SLOW_MAGIC_MULTIPLIER * originalTime);
  }
  /** GetSlowMagicUseRate（:47434-47442）：充能速率 ÷2.5（弹幕 AI 每帧增量） */
  getSlowMagicUseRate(): number {
    if (!this.slowMagicUse) return 1;
    return 1 / Player.SLOW_MAGIC_MULTIPLIER;
  }
  /** GetSlowMagicScalar（:47444-47451）：节拍/阈值标量 ×2.5（slowMagicUse=false → 1）。
   *  ★1457 全部消费点核实（grep 全仓仅 3 处,全在 Projectile.cs）：439 激光机枪
   *  帧拍 frameCounter≥4×scalar（:67211）+ 音隔 soundDelay=(24−6×档)×scalar（:67222）、
   *  535 美杜莎之首石化阈值 (int)(60×scalar)/4（:45301）。★R34：2795 激光机枪已实装
   *  （LaserMachinegunHolder rate/scalar 双通道接线）;535 弹仍无 AI（登记债） */
  getSlowMagicScalar(): number {
    if (!this.slowMagicUse) return 1;
    return Player.SLOW_MAGIC_MULTIPLIER;
  }
  /** UndoSlowMagicUse（:52591-52604,★1458 修）：喝蓝药时清标记（QuickMana :52585
   *  调用）。★1458 把窗缩回从 ×GetSlowMagicMultiplier()(2.5,越撤越慢=1457 bug,
   *  "slow magic resetting when using Quick buff"修复半边)改为 ×GetSlowMagicUseRate()
   *  (0.4,真正还原)+min 钳 2;零耗蓝物品路径 ItemCheck_ActuallyPayMana 早退
   *  （:53278 sItem.mana==0 return true）不再副作用清标记=修复另半边。本仓无
   *  itemAnimationMax/itemTimeMax 窗字段（swing 模型不同）→ 只清标记;零耗蓝物品
   *  本就不入 checkMana 端口=两半边天然对齐 1458 终态 */
  undoSlowMagicUse(): void {
    this.slowMagicUse = false;
  }
  /** EverySomeYoyoHits（Player.cs:4293-4301）：悠悠球 per-hit 族共享计数器。
   *  yoyoHitCounter 初始 -1 → 首次命中 -1%N≠0 不触发（原版同款,第 2 击才首触发）；
   *  countUp=true 时命中后自增（伤害乘区侧 :13428/:13434 传 false 只读不加） */
  everySomeYoyoHits(amount: number, countUp: boolean): boolean {
    const result = this.yoyoHitCounter % amount === 0;
    if (countUp) this.yoyoHitCounter++;
    return result;
  }

  // ---- 出入液溅花尘四发射器（Player.cs:27991-28056 入 / :28085-28150 出循环体 1:1）----
  //  spawnDust 后置覆写与原版逐行同序;★308 与 34/35/152 的 NewDust 型内初速预处理
  //  （Dust.cs:227-231 v×0.5+Y++ / :246-254 v×0.1+vy 钉 −0.5）VanillaDust.spawn 未植
  //  → 发射器内按原版链补齐（水族 33/98-105 池内已植、123/288 原文本就无——逐型净
  //  初速与原版逐位等价）;scale/alpha 为绝对覆写（消解 NewDust ±0.2 scale 抖）。
  //  waterStyle 探测同 FakeFish 结构化约定（renderer?.waterStyle,测试 mock 兼容）
  /** 水支（:28031-28041 入 / :28125-28135 出）：50×dustWater(),vy−kick、vx×2.5、
   *  scale0.8、α100、noGravity */
  private splashWaterDust(game: GameHooks, boxY: number, vyKick: number): void {
    const waterStyle = (game as { renderer?: { waterStyle?: number } }).renderer?.waterStyle ?? 0;
    for (let i = 0; i < 50; i++) {
      const d = game.spawnDust?.(this.x - 6, boxY, this.w + 12, 24, dustWaterFor(waterStyle));
      if (d) {
        d.vy -= vyKick;
        d.vx *= 2.5;
        d.scale = 0.8;
        d.alpha = 100;
        d.noGravity = true;
      }
    }
  }
  /** 微光支（:27991-28016 入 / :28085-28110 出）：50×308,vy−4、vx×2.5、scale 入 0.8/
   *  出 0.75、noGravity（α 不设=0）+ Next(6) 六掷三色/缺省第四色 */
  private splashShimmerDust(game: GameHooks, boxY: number, scale: number): void {
    for (let i = 0; i < 50; i++) {
      const d = game.spawnDust?.(this.x - 6, boxY, this.w + 12, 24, 308);
      if (d) {
        d.vx *= 0.5; d.vy = d.vy * 0.5 + 1;   // NewDust 308 支补链（Dust.cs:227-231）
        d.vy -= 4;
        d.vx *= 2.5;
        d.scale = scale;
        d.noGravity = true;
        const roll = (Math.random() * 6) | 0;   // Main.rand.Next(6)（:28000/:28094）
        d.color = roll === 0 ? { r: 255, g: 255, b: 210, a: 255 }
          : roll === 1 ? { r: 190, g: 245, b: 255, a: 255 }
          : roll === 2 ? { r: 255, g: 150, b: 255, a: 255 }
          : { r: 190, g: 175, b: 255, a: 255 };
      }
    }
  }
  /** 蜜支（:28018-28028 入 / :28112-28122 出）：20×152,vy−1、vx×2.5、scale1.3、
   *  α100、noGravity */
  private splashHoneyDust(game: GameHooks, boxY: number): void {
    for (let i = 0; i < 20; i++) {
      const d = game.spawnDust?.(this.x - 6, boxY, this.w + 12, 24, 152);
      if (d) {
        d.vx *= 0.1; d.vy = -0.5;   // NewDust 34/35/152 支补链（Dust.cs:246-254）
        d.vy -= 1;
        d.vx *= 2.5;
        d.scale = 1.3;
        d.alpha = 100;
        d.noGravity = true;
      }
    }
  }
  /** 岩浆支（:28045-28055 入 / :28139-28149 出）：20×35,vy−1.5、vx×2.5、scale1.3、
   *  α100、noGravity */
  private splashLavaDust(game: GameHooks, boxY: number): void {
    for (let i = 0; i < 20; i++) {
      const d = game.spawnDust?.(this.x - 6, boxY, this.w + 12, 24, 35);
      if (d) {
        d.vx *= 0.1; d.vy = -0.5;   // NewDust 34/35/152 支补链（Dust.cs:246-254）
        d.vy -= 1.5;
        d.vx *= 2.5;
        d.scale = 1.3;
        d.alpha = 100;
        d.noGravity = true;
      }
    }
  }

  // ---- ★用户明令分歧 2026-09-14「唇入必响」（超越原版）——表层掠水反馈支 ----
  // 触发与正常入水同一 splash 路径（同尘发射器/同 Splash_N 音量 1/同规模涟漪注入），
  // 但湿/游泳状态面零参与：wetCollision 探针（居中盒,液体解析段）保持原版 1:1。
  // 边缘 case 定谳（逐条冻结于 tests/bj79-lip-pocket-wet-parity）：
  //  ① 水上漂靴/水面行走=不发——本仓水行=湿支 water-walk 悬停块（canWaterWalk ∧
  //     vy>=0 → vy=0，运动段液体档内），悬停期主探针
  //     恒湿 → main-dry 门天然拦截（判别器=支撑来源：液面支撑 ⇒ 主探针湿 ⇒ 正常入水
  //     splash 已发；唇缘实心/半砖支撑 ⇒ 主探针干 ⇒ 本支发）。onWaterSurface 字段曾
  //     考虑作门，弃（干态不重置=陈旧真,不可靠；main-dry 已蕴含非液面支撑）。
  //  ② 宽水域=无双发——主探针沉入即正常 splash；descent 期（腾空/下行速度）被
  //     onGround∧vy==0 门拦，入水后主探针湿被 main-dry 门拦，两段都不可能双发。
  //  ③ 连走多格水袋=anti-spam——_skimSplashCooldown 镜像 wetCount :28169（置 10、
  //     每拍 −1、门 ===0）：冷却窗（10t≈vanilla 溅花再入门同窗）内逐格不连响；跨袋
  //     间隔 >10t 可再响（证据地形两袋间隔 ~31px≈12t 步行 → 双响）。
  //  ④ 跳跃掠过=不发——上升沿=接触开始，跳跃中 onGround=false；StepDown 下行帧
  //     vy=stepSpeed≠0 亦拦（坡道下行入水只走 vanilla 入水 splash，无双发）。
  //  ⑤ 岩浆袋=保守 Skip——原版岩浆侧反馈已 1:1 齐备且更响：LavaCollision 全盒
  //     （Collision.cs:1657-1692）在本几何（袋面高出脚位）照样命中 → inLava →
  //     重伤 80+OnFire 420（:27888-27932）+hurt 音；vanilla 溅花本就静默（居中湿探针
  //     够不到,与水袋同几何）。再叠一层掠水 splash 音=分歧面上再叠分歧,不做。
  //  蜜/微光袋=发对应档（蜜 :28018 Splash_1+蜜尘 / 微光 :27991 Splash_2+微光尘），
  //  微光态（shimmering）整体静默（:27987 !shimmering 门镜像）。
  /** 掠水反馈主入口（液体解析段粘滞清偿后唯一调用；摘除=回滚口单点） */
  private surfaceSkimSplashFeedback(game: GameHooks, st: TileStore, wetNow: boolean): void {
    if (!Player.SURFACE_SKIM_SPLASH) { this._skimContactPrev = false; return; }
    if (this._skimSplashCooldown > 0) this._skimSplashCooldown--;   // 镜像 :28169 每拍递减
    // 脚位带 [脚底, 脚底+8)（★不用任务草案的 foot−2 上沿：+2px 会把「岸侧贴走」
    // （脚=相邻满水格底,液带下沿=格底）2px 掠边误触成溅水——带收进脚底以下后该姿态
    // 零接触;涉行（脚踩池底）同样零接触=vanilla 涉行静默 1:1 不扩）。倒挂镜像。
    const gd = this.gravDir;
    const bandTop = gd === -1 ? this.y - 8 : this.y + this.h;
    const hit = skimSurfaceProbe(st, this.x, bandTop, this.w, 8);
    const contact = hit !== null;
    const rising = contact && !this._skimContactPrev;
    this._skimContactPrev = contact;   // 边沿每拍更新：被门拦下的边沿即消费（窗内静默）
    if (!rising || hit === null || hit.type === 2) return;   // 岩浆=边缘 case⑤ 保守 Skip
    // 门序：主湿探针干（②宽水域/①水行悬停——vanilla splash 已发）∧ 非岩浆全盒
    // （:3859 inLava 本拍即时值）∧ vanilla 溅花 anti-spam 门（wetCount===0,:27984 同式）
    // ∧ 本支冷却（③）∧ 非微光态（:27987 镜像）∧ 着地静止（④走/站;descent/跳/StepDown 不发）
    if (wetNow || this.inLava || this.wetCount !== 0 || this._skimSplashCooldown !== 0
      || this.shimmering || !this.onGround || this.vy !== 0) return;
    this._skimSplashCooldown = 10;   // ③（置位序同 :27986；本方法头递减→再入门=置位后第10拍,与 wetCount :28169 同拍距）
    const boxY = gd === -1 ? this.y - 16 : this.y + this.h - 8;   // 尘盒锚脚位（入水支 −8 同式）
    if (hit.type === 3) {                              // 蜜（:28018-28029 同款）
      this.splashHoneyDust(game, boxY);
      game.playSfxWav?.('Splash_1', 1, this.x, this.y);
    } else if (hit.type === 4) {                       // 微光（:27991-28016 入水档 0.8 同款）
      this.splashShimmerDust(game, boxY, 0.8);
      game.playSfxWav?.('Splash_2', 1, this.x, this.y);
    } else {                                           // 水 0/1（:28031-28042 同款）
      this.splashWaterDust(game, boxY, 3);
      game.playSfxWav?.('Splash_0', 1, this.x, this.y);
    }
    // 涟漪注入（玩家入水拍同式=Renderer pushPlayer→injectEntity :792 queueRippleSized：
    // strength=num3·3=0.15√|vel|、尺寸 (w,h)·k、Circle）——水平镜像入水 +5·v̂,垂直钉
    // 接触液面线 surfY：唇袋姿态下身体中心悬于水面上方 ~13px,中心点入队能量落空气/
    // 水下,掠水反馈必须在水面即刻可见（同 player-water-entry-splash v2 钳液面线方向）
    const velLen = Math.hypot(this.vx, this.vy);
    const s3 = 0.15 * Math.sqrt(velLen);
    const k = Math.min(1, Math.max(0, s3 * 10));
    const vnx = velLen > 0 ? this.vx / velLen : 0;
    queueRippleSized(this.cx + vnx * 5, hit.surfY, s3, this.w * k, this.h * k,
      RippleShape.Circle, 0);
  }

  /** ★SW-BJ59：Player.tileSpeed 原始聚合单源（Player.cs:2453 基 1f，加法叠加，
   *  更大=更快）。来源：建筑工药水 buff 107 +0.25（:10248）/ 仙馔蜜酒 +0.05
   *  （:12960）/ 风筝 buff 383 +0.15（:10005）/ 砌砖刀族配饰 +0.5（:13122-13130，
   *  ★手持门：selectedItem.createTile≥0 且非火把 TileID.Sets.Torches——本仓
   *  createTile≥0 ⇔ def.tile 存在，火把族走 Torch 特链无该字段天然排除）。
   *  消费面两处：①放置冷却 = useTime × 1/min(3,raw)（Game.paintTileSpeed 委托
   *  本方法，:26113-26117 钳 3 取倒数）；②滚轴鞋巡航挡 num4 = ⌊num3 × tileSpeed⌋
   *  （RollerSkateMovement :28751——"滑行速度与放置速度相匹配" tooltip 的机制面） */
  placeSpeedTileRaw(): number {
    let s = 1;
    if (this.buffs.has(BuffType.Builder)) s += 0.25;
    if (this.usedAmbrosia) s += 0.05;
    if (this.buffs.has(BuffType.KiteBuff)) s += 0.15;
    if (this.equipStats.tileSpeed) {
      const heldDef = ITEM_DEFS[this.inv.heldItem()?.id ?? -1];
      if (heldDef?.tile !== undefined) s += 0.5;
    }
    return s;
  }

  /** ★SW-BJ59：DelegateMethods.Minecart.Sparks（DelegateMethods.cs:224-243）1:1——
   *  滚轴鞋轨骑缺省 MinecartDust 委托臂（MountDelegatesData ctor :125，dust 213）。
   *  位置抖动 ±13px 绕 DelegateMethods.Minecart.rotation（=玩家贴轨倾角）旋转；
   *  速度/寿命/noGravity/fadeIn 逐字段同序 */
  private skateSparkDust(game: GameHooks, x: number, y: number): void {
    const rot = this.mount.fullRotation;                       // DelegateMethods rotation
    const off = Math.random() < 0.5 ? 13 : -13;                // Next(2)==0 ? 13 : -13
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const px = x + off * cos, py = y + off * sin;              // RotatedBy(rotation)
    const d = game.spawnDust?.(px, py, 1, 1, 213,
      Math.floor(Math.random() * 5) - 2, Math.floor(Math.random() * 5) - 2);   // Next(-2,3)
    if (!d) return;
    d.noGravity = true;                                        // :232（双重赋值照抄=单写）
    d.fadeIn = d.scale + 1 + 0.01 * Math.floor(Math.random() * 51);           // :233
    d.vx *= (Math.floor(Math.random() * 36) + 15) * 0.01;      // :236 Next(15,51)×0.01
    d.vx *= (Math.floor(Math.random() * 76) + 25) * 0.01;      // :237 Next(25,101)×0.01
    d.vy -= (Math.floor(Math.random() * 16) + 15) * 0.1;       // :238 Next(15,31)×0.1
    d.y -= 4;                                                  // :239 position.Y -= 4
    if (Math.random() < 2 / 3) {                               // :241 Next(3)!=0
      d.noGravity = false;
    } else {
      d.scale *= 0.6;                                          // :244
    }
  }

  /** ★IIIII251 equipStats 结构段帧级缓存武装窗（语义合同见 getter 注）。
   *  窗 = fixedUpdate 函数体（head 武装/finally 解除——体内各早退 return 支也被
   *  finally 覆盖）。窗内不变式（projScanCtx 同论证域,本仓亲测函数体对 armor/dye/
   *  loadouts/slots/banks 零写入面,仅两处读）：装备槽位在 fixedUpdate 全程零写
   *  （装备变更只在输入处理 updateUse/存档装载边界,均窗外）⇒ 结构段窗内恒定;
   *  标量尾段（buffs/panic/夜相/炽灼/gates/解锁·hide）仍逐访问现算=mid-tick 变化
   *  立即失效。窗外读（entities 桶/render/UI/单测直调）=解除态=逐访问全量重建
   *  旧路径,直写槽位立即生效（six-way 锁与 breath 族「settle 后直写盔甲立即 42」
   *  即此面）。MP 远端代理不走 fixedUpdate=恒解除态。 */
  fixedUpdate(dt: number, game: GameHooks) {
    this._equipStatsArm = true;
    this._equipStatsStructKeyCache = null;
    try {
      this.fixedUpdateBody(dt, game);
    } finally {
      this._equipStatsArm = false;
      this._equipStatsStructKeyCache = null;
    }
  }

  fixedUpdateBody(dt: number, game: GameHooks) {
    const world = game.world;
    this.lastStore = world.store;   // dashWallAhead 探测缓存（本 tick 内有效）
    this.modHeldLight = null;   // ★三百四十八刀:每帧重置(holdItem 钩重设)
    // ★三百三十九刀:mod 手持效果钩(C# HoldItem 同位;手持 mod 物品每 tick 调)
    runModHoldItem(this.inv.heldItem()?.id ?? -1, this, game);

    // ★SW-BJ59 滚轴鞋弹性挡板输入反转（Player.cs:25199-25210 cartFlip 支——挡板
    //  [1] 按向命中后左/右控制互换，直到松键才清除；movementX 由 control 派生，
    //  互换 ⇔ inputX 取反。本仓 fixedUpdate 在 Game 输入注入之后 = 原文同拍位）
    if (this.cartFlip) {
      if (this.inputLeft || this.inputRight) {
        const l = this.inputLeft;
        this.inputLeft = this.inputRight;
        this.inputRight = l;
        this.inputX = -this.inputX;
      } else {
        this.cartFlip = false;
      }
    }
    // 扫帚挂件露天位（WorldGen.InAPlaceWithWind 中心格 :3597——GetWitchBroomTrinket
    // Rotation 的 num3 露天 1f/室内 0.5f 档消费源；渲染端 mountLights 直读）
    this.mountWindExposed = inAPlaceWithWind(world.store, this.x, this.y, this.w, this.h,
      world.groundLevel, world.seedFlags?.remix === true);
    this.prevInputJump = this.inputJump;   // 坐骑 releaseJump 边沿（Mount.tryStartHover 消费）
    // 下方向连按计时（holdDownCardinalTimer[0] Player.cs:25260-25268）：held++/
    // 松开清零，≥45t → controlDownHold。本帧输入已由 Game.fixedUpdate 注入，
    // 此处推进后装备扫描（applyEquipFunctional 链）同拍消费
    this.downHoldT = this.inputDown ? this.downHoldT + 1 : 0;
    this.controlDownHold = this.downHoldT >= 45;
    // ---- ★Forbidden 指令输入面（组C 终盘;KeyDoubleTap :57434-57457 + KeyHoldDown
    //      :57567-57583——双击↓窗口 15t（:25234-25249 doubleTapCardinalTimer 语义,
    //      与星旋套 downTapT 同式但私有相位）。setForbidden 读上一拍值=原版序
    //      （ResetEffects :18861 → 输入 :25214 → UpdateEquip 套装面 :26400+）----
    {
      const fDown = this.inputDown;
      if (fDown && !this.forbiddenPrevDown) {
        if (this.forbiddenTapT > 0) {
          // KeyDoubleTap(0) 的 setForbidden 支（:57449-57456）：先 MinionRestTargetAim
          // （闩外恒跑）→ 未闩才 CommandForbiddenStorm（20 魔力/空间/视线/根数门）
          if (this.setForbidden) {
            this.minionRestTargetAim(game);
            if (!this.setForbiddenCooldownLocked) {
              this.commandForbiddenStorm(game);
            }
          }
        } else {
          this.forbiddenTapT = 15;
        }
      }
      if (this.forbiddenTapT > 0) this.forbiddenTapT--;
      this.forbiddenPrevDown = fDown;
      // KeyHoldDown(0, holdTime) 双套装支（:57574-57582）：星尘/禁戒按住 ≥60t 均
      // 复位瞄准点（Vanilla 逐 tick 调用+幂等;MinionRestTargetPoint 两套装共用面——
      // ★BJ157⑧ 星尘支原缺,守护者 rest 的取消半边）
      if (this.downHoldT >= 60
        && (this.setForbidden || this.equipStats.summonSet?.guardian === true)) {
        this.minionRestTargetX = 0;
        this.minionRestTargetY = 0;
      }
    }
    this.oldX = this.x; this.oldY = this.y;   // oldPosition（尘埃 customData 跟随差值）
    // ---- 派对染发剂彩纸（UpdateHairDyeDust Player.cs:23994-24023；2026-08-14 接通，
    //      原 HairDyeColor.ts §4 登记偏差销核）——抽为方法：MP 远端代理不走
    //      Player.fixedUpdate（Game.stepRemoteProxy 只跑移动子集）,代理彩纸在
    //      Game.simulateRemotePlayers 同门补掷（原版各端对全部 Main.player 跑此尘）。
    //      fixedUpdate 本身只在非暂停时跑 ----
    this.updateHairDyeDust(game);
    // ---- ★2026-09-01 枭首者头部 282 逐帧残影（DoDeadCellsBeheadedParticles
    //      Player.cs:24491-24510——与 UpdateHairDyeDust 同段相邻,原版在 PlayerFrame()
    //      之后逐帧跑,Main.netMode!=2 门 = 各端对全部 Main.player 生成。★F4②
    //      2026-09-01 注记订正：本仓远端代理不走 fixedUpdate,【无】模拟侧补掷（旧注
    //      "与染发剂彩纸同门在 Game.simulateRemotePlayers 补掷"失实——查无此掷）；
    //      远端画面由 owner 端本步的 broadcastParticleOrchestra(DeadCellsBeheadedEffect)
    //      → 各端 netApplyParticleOrchestra 复放 deadCellsBeheadedHeadFx 覆盖 ----
    this.deadCellsBeheadedStep(game);
    // ---- FTW 克脑重力倒置消费端（NPC.brainOfGravity → Player.forcedGravity）：
    //      克脑 266 二阶段每 tick 写 world.brainOfGravity=实体 id（NPC.cs:32650-32653），
    //      距脑 <4000px → forcedGravity=10 → gravDir=-1（Player.cs:26489-26496）；
    //      锚失效/非 266 清除 = Main.cs:18127。仅 FTW 种子会有锚写入,普通世界零行为 ----
    consumeBrainOfGravity(this, game);
    // ★SW-FX19：召唤集火槽失效清除（Player.cs:57682-57685 每 tick——目标
    //  !CanBeChasedBy 或 距玩家中心 >3000px → MinionAttackTargetNPC=-1）
    this.updateMinionAttackTarget(game);
    if (this.iframes > 0) this.iframes--;
    if (this.useTime > 0) this.useTime--;
    // ★GB2 ghostDmg 预算池每拍衰减（Player.cs:24652-24660，Player.Update 段内）：
    if (this.ghostDmg > 0) this.ghostDmg -= 6.6666665;
    if (this.ghostDmg < 0) this.ghostDmg = 0;
    // ★GB3 弩车恐慌旗逐拍衰减（AddBuff(205,300)=300t 恒值窗——vanilla 由 buff
    //  timeLeft 递减,本仓以数值字段承载,ResetEffects 读面在 MinionProj.dd2SetFlags）
    if (this.ballistaPanicT > 0) this.ballistaPanicT--;
    // 原版 heldProj 每拍前置复位（Player.cs:24570,Update 复位块——投射物 AI 同拍
    // 自写覆盖;本仓现无写面=恒 -1,复位与原版同拍在位保未来生产面语义）
    this.heldProj = -1;
    this.miscCounter++;
    // ★BJ705-G25:timeSinceLastDashStarted 逐拍 +1 帽 300（Update :24794-98,miscCounter
    //   邻位=移动段前;发起拍由 dashMovement 两发起位清 0）。
    this.timeSinceLastDashStarted++;
    if (this.timeSinceLastDashStarted >= 300) this.timeSinceLastDashStarted = 300;
    // AdvancedShadows 历史环（翅膀 45 彩虹拖尾；尾插保持 ≤31）
    this.advancedShadows.push({ x: this.x, y: this.y });
    if (this.advancedShadows.length > 31) this.advancedShadows.shift();
    // ★SW-FX36：社交残影轮转（UpdateSocialShadow :24885 每 tick 一次,相位=移动前
    // ——同 advancedShadows 环的 pre-movement 相位；机械标尺网格淡出驱动源）
    this.updateSocialShadow();
    // itemFlame（LegacyPlayerRenderer :493-502：仅翅膀 22 在用时每 5t 重掷）
    if (this.equipStats.wing?.logic === 22 && --this.itemFlameCount <= 0) {
      this.itemFlameCount = 5;
      for (let i = 0; i < 7; i++) {
        // ★O3 漏网核销(2026-09-02)：Y 掷=LegacyPlayerRenderer.cs:501 Next(-10,1)
        // （11 值域 [−10..0]）——曾 `Math.random()*10|0` 10 宽 off-by-one（0 端永不可取）
        this.itemFlamePos[i].x = ((Math.random() * 21 | 0) - 10) * 0.15;   // Next(-10,11)×0.15
        this.itemFlamePos[i].y = ((Math.random() * 11 | 0) - 10) * 0.35;   // Next(-10,1)×0.35
      }
    }

    // 调试无敌（F2）：每 tick 血蓝回满——兜住 DoT/溺水/摔落等直改 hp 的路径
    // （战斗伤害已由 damage() 早退拦截）；同时保证不会走到下方 hp<=0 死亡结算
    if (this.debugGod) {
      this.hp = this.maxHp;
      this.mana = this.maxMana;
    }
    // 旅程上帝模式回满（Main.cs:17711-17715：statLife/statMana/breath 三回满——
    // creativeGodMode 由 GodmodePower 每帧授予 Player.cs:25208-25211；战斗伤害
    // 在 damage() 早退拦截，此处兜 DoT/溺水/摔落直改 hp 的路径）
    if (journeyGodmodeActive()) {
      this.hp = this.maxHp;
      this.mana = this.maxMana;
      this.breath = this.breathMax;
    }

    // Buff tick：自然回复 / 环境 DoT（负值=持续伤害,原版 lifeRegen 路径:无视防御与无敌帧）。
    // 感电移动惩罚开关先行写入（Player.cs:18900 controlLeft||controlRight）——inputX
    // 已由 Game.fixedUpdate 注入（Game.ts:2890 → :2931），此处读到的即本帧输入
    this.buffs.electrifiedMoving = this.inputX !== 0;
    // ★BJ674 感电逐拍点光（Player.cs:10402-10405 buffType[144] 支——UpdateBuffs 循环
    //   内 `electrified = true; Lighting.AddLight((int)Center.X/16,(int)Center.Y/16,
    //   0.3f, 0.8f, 1.1f)`;本仓像素位近似（Forbidden 套同判例,Player.ts:4969））
    if (this.buffs.has(BuffType.Electrified)) {
      game.addLightAt?.(this.cx, this.cy, 0.3, 0.8, 1.1);
    }
    // ---- The Constant 饥饿链上下文注入（Main.dontStarveWorld = seedFlags.theConstant；
    //      remix 组合（"don't dig up"+constant）拉长 332/333 至 28800t；死亡态不推进
    //      ——原版 UpdateDead 无 UpdateBuffs 链。表情 146/147/148 + Hungry 音经回调）----
    this.buffs.dontStarveWorld = !!world.seedFlags?.theConstant;
    this.worldSeedFlags = world.seedFlags;   // ★IIIII224：equip 面旗读点（巫师帽 238 tenth）
    this.buffs.hungerPlayerAlive = !this.dead;   // 死亡冻结（UpdateDead 无 UpdateBuffs 链）
    this.buffs.remixHunger = !!(world.seedFlags?.theConstant && world.seedFlags?.remix);
    this.buffs.starvingMaxHp = this.maxHp;
    this.buffs.starvingZoneBoost = !!game.scene?.zoneDesert || !!game.scene?.zoneSnow;
    this.buffs.nebulaLifeLevel = this.nebula[1];   // 星云生命层数（:19220 DoT 全免消费）
    if (!this.buffs.onHungerEvent) {
      this.buffs.onHungerEvent = (kind) => {
        // EmoteBubble.MakeLocalPlayerEmote（:11706/:11726——146 Peckish/147 Hungry/
        // 148 Starving）；333→334 档附 SoundID.Hungry（:11728，Sounds/Custom/hungry）
        if (kind === 'neutral') game.playerEmote?.(146);
        else if (kind === 'hungry') game.playerEmote?.(147);
        else {
          game.playerEmote?.(148);
          game.playSfxWav?.('hungry', 1);
        }
      };
    }
    // ---- 抚摸宠物状态推进（UpdatePettingAnimal :33015-33033——目标漂移/移动键停） ----
    this.updatePettingAnimal();
    // ---- 骸骨头盔幻影（Bone Helm 5100 功能配饰槽 → SpawnHallucination
    //      Player.cs:12823 GrantArmorBenefits → :13627-13656；GrantArmorBenefits 循环
    //      只扫 armor[0-9]（时装槽 10-19 走 ApplyEquipVanity 不触发））----
    this.updateInsanityShadow(game);
    // ---- 眼球伞 5101（armor[0] 头盔或 armor[10] 时装头任一，UpdateEquips :12661 门）
    //      + 水晶鞋 5077（armor[13-19] 时装配饰槽，ApplyEquipVanity :13821 门） ----
    this.updateDontStarveCosmetics(game, world);
    // 魂镰吸魂自持（1457 Player.cs:9944-9947 UpdateBuffs 头：soulDrain>0 →
    // AddBuff(151, 2)=2【t】每帧钉值——Game 侧扫描每帧清零再 ++，无 3006 邻域供给即熄。
    // ★曾误写 2【秒】(120t) 顶破 >2t 无字门显「2秒」（2026-08-31 tick/秒单位族审计）
    if (this.soulDrain > 0) this.buffs.apply(BuffType.SoulDrain, 2 / 60);
    // ★X4-债3 清偿（2026-09-29）：死亡/幽灵相 buffs.tick 停——原版 UpdateBuffs 主调用
    //  Player.cs:25763 在 ghost/dead 早退（:24938-24948 `if (ghost) { Ghost(); return; }`
    //  `if (dead) { UpdateDead(); …; return; }`）之后，死亡/幽灵相整帧不跑（计时冻结）；
    //  死亡相改跑 UpdateDead（每帧清非持久 buff，Player.ts 死亡分支 clearNonPersistent）。
    //  本 tick 仍跑=死亡判定在 :4842 之后（死亡拍原版也在 UpdateBuffs 帧内发生，同相）；
    //  次拍起 dead=true 整门停。幽灵相 dead 恒 true（isGhostPhase 判据含 this.dead）→
    //  计时冻结与原版 Ghost() 相同。返回值 0=死亡相 heal/DoT 消费本就 hp>0 门惰性
    const buffHeal = this.dead ? 0 : this.buffs.tick(dt);
    // ★BJ357 坐骑 buff 钉时（Player.cs:9968-9971 UpdateBuffs：MountType buff 每 tick
    //  buffTime=10 重钉）——首授予 AddBuff(_data.buff,3600) 在 Game.useMountItem
    //  （SetMount :6291）;图标无倒计时字+不入档 = Main.cs:9344-9352 双置位
    //  （BUFF_NO_TIME_DISPLAY/BUFF_NO_SAVE 已收 374/377/384/391/392）。CheckMountBuff
    //  （Mount.cs:5333,经 Player.cs:18948）缺 buff 强制下坐——★BJ405-D1 右键取消
    //  面已建（UI 坐骑通道 dismountFromBuffBar=下坐本体,buff 随 ridingMount 失真
    //  同拍停钉→10t 内自然衰亡=ClearBuff 等价）;本重钉面为 BJ357 兼容残面（真值
    //  仍在 mount.active,通道图标不读 BuffState）,摘除须连坐 bj357 测试面重锚（登记）
    if (this.ridingMount) {
      const mbt = buffTypeByVanilla(this.mount.data?.buff ?? -1);
      if (mbt !== undefined) this.buffs.apply(mbt, 10 / 60);
    }
    // 叶绿孢子 397 玩家侧孢子云发射器（★2026-08-24 r15 R15-19：PL57:26178-26193
    //  chlorophyteSpore && Next(60)==0 → 盒内 Inflated(−2,−2) 掷点,v=velocity×0.5
    //  钳 5 的 SporeCloud 编排；DoT 15 HP/s 已入 Buffs ENV_DOTS。buff 来源 =
    //  敌对/反弹 1127 命中（PC57:12015-12018 StatusPvP,vanilla-statusplayer.json
    //  "1127" 叶子）。粒子形态 spawnParticles 方块近似（与 Enemy.ts:2185 同登记））
    if (this.buffs.active.has(BuffType.ChlorophyteSpore) && Math.floor(Math.random() * 60) === 0) {
      const svx = Math.min(5, Math.hypot(this.vx, this.vy) * 0.5);
      game.spawnParticles(
        this.x + 2 + Math.random() * Math.max(1, this.w - 4),
        this.y + 2 + Math.random() * Math.max(1, this.h - 4),
        '#A8D060', 3, svx || 0.5,
        { life: 40, grav: -0.02, damp: 0.95 },
      );
    }
    // 弹字门预写快照（:4104 写入可能归零——原版 :19513 弹字与 statLife 扣减同拍,
    // 死亡拍照弹不丢）
    const dotPopAlive = this.hp > 0;
    if (buffHeal > 0 && this.hp > 0) this.hp = Math.min(this.maxHp, this.hp + buffHeal);
    else if (buffHeal < 0 && this.hp > 0) {
      this.hp = Math.max(0, this.hp + buffHeal);
      // DoT 致死（:19142-19156 + :19186-19201）：suffocating→ByOther(7)；tongued 已在
      // 自身路径；其余按 :19187 链——vampireBurningInSunlight 优先 VampireBurningInDaylight
      // ByOther(22)（吸血鬼种子日光灼死文案），再 poisoned/venom→9、electrified→10、
      // 默认 Burned(8)（不区分火/毒/流血——含炽热狱石/陨石的灼烧与着火）
      if (this.hp <= 0) this.lastDamageCause = this.vampireBurningInSunlight
        ? { kind: 'vampire' }
        : this.buffs.has(BuffType.Starving)
          ? { kind: 'starved' }   // PlayerDeathReason.ByOther(18)（:19175，饥饿链 2026-08-20）
          : this.buffs.has(BuffType.Suffocation)
            ? { kind: 'suffocated' } : { kind: 'burned' };
    }
    // ★BJ451 分块显示账结转（2026-10-03）：dotChunkOut 冲刷门 = 旧 `buffHeal < 0`
    //   （当拍流量符号门）之外加「DoT 活跃即冲刷」支（dotActiveTick = Buffs.tick
    //   「本 tick DoT 流量在账」谓词,Player.ts:4277 lifeRegenTime 复位门同款消费面）
    //   ——原版定谳（1457 Player.cs 亲读）：负兑付 :19478 `while (lifeRegenCount <=
    //   -120)` 每 tick 无条件查账,兑付条件=账面值跨门槛,与当拍 lifeRegen 流量符号
    //   无关（:19436 灼烧 -600 环退出残账 ∈(-600,-120],灼烧熄灭后下一拍由 :19478
    //   通用环即时兑付——可在正流量拍弹字,证伪「只在负 heal 拍弹」;:19384 全流量
    //   合一本账,:19513 弹字与 statLife 扣减同拍）。残账结转仅存在于【低于兑付门槛】
    //   的尘埃（<120 单位）;本仓 dotChunkOut 为整 HP 口径（rateAccum 整块弹出）,
    //   >0 ⟺ 账面已跨门槛 → 旧符号门令整 HP 残块跨拍滞留（BJ447 整数化后确定性
    //   可达：蜂蜜 flat 对冲拍与 DoT 分块拍对齐 → buffHeal 恰 0）= 原版账面不可能态。
    //   冲刷块移出 heal 写入分支独立执行（覆盖 buffHeal≥0 的对齐拍/正流量拍;hp 写入
    //   面零改动,净额守恒不变）。
    //   HurtLifeRegen 飘字形态（Player.cs:19439/:19470/:19482 调用,:19509-19514 本体）：
    //   DoT 分块伤害弹掉血数字,LifeRegen 色 (255,60,70) + dot:true;原版 DoT 不触发
    //   受击闪烁/无敌帧/音效——故不进 damage(),死亡原因仍是 ByOther 默认包。
    //   ★BJ443 根因层·显示面截断（★BJ447 真值面整数化后 dotChunkOut 恒整,截断
    //   保留为兜底,对整数输入恒等）：旧唯一浮点源 = Buffs.tick 蜂蜜对冲 cancel
    //   （accum=2×dt 浮点累加,BJ447 已改整数位账 honeyOffsetUnits）——截断
    //   须在 `dot > 0` 门【前】（C# int 语义=调用侧截断,门看截后值）,否则分数块
    //   （0<x<1）过门后入口 trunc 出 "0" 飘字（原版蜂蜜对冲=延迟弹出,无弹无字）。
    //   ★BJ443 hp 真值面登记债已随 BJ447 清偿（对冲计提/兑付双端整数化,
    //   heal 恒整 → hp 恒整,原版 lifeRegen(:1919)/lifeRegenCount(:1921)
    //   双 int 同构）。
    if ((buffHeal < 0 || this.buffs.dotActiveTick) && dotPopAlive) {
      const dot = Math.trunc(this.buffs.consumeDotChunk());
      if (dot > 0) game.addDamageNumber(this.cx, this.y, dot, false, '#FF3C46', true);
    }
    // 恐慌项链加速窗口倒计时（panicTime 单位=tick,dt 秒 ×60 折算——
    // 旧 `-= dt` 把 480t 窗口拉成 480 秒,R5-F26 连带修正）
    if (this.panicTime > 0) this.panicTime = Math.max(0, this.panicTime - dt * 60);
    const eqM = this.equipStats;   // ★IIIII250 函数级快照:置于 buffs.tick(3443)+panic 递减(3479)之后——此点后至函数尾,键输入 apply/remove 面(Honey/Wet/Merfolk/Shimmered/LeafCrystal/日曜盾)均不改变本函数所读字段值(全装备派生;Werewolf jumpSpd 恰取 tick 后态),值等价;58 次直读→1 次
    // 装备生命回复（再生手环族 lifeRegen：每半秒 N/2 HP → 每秒 N/2；战斗中也生效）。
    // ★刀5:具名修正槽『Player.UpdateLifeRegen』(装备回复通道量;空槽直通零分配;
    //  自然 9 档公式不在槽=登记 D 台账;值链=后钩吃前钩产物,消费侧 ≥0 钳)
    const equipRegen = Math.max(0, runVanillaOverrideValue('Player.UpdateLifeRegen', eqM.hpPerSec, { player: this, game }));
    if (equipRegen > 0 && this.hp > 0) {
      this.regenAccum += equipRegen * dt;
      if (this.regenAccum >= 1) {
        const n = Math.floor(this.regenAccum);
        this.regenAccum -= n;
        this.hp = Math.min(this.maxHp, this.hp + n);
      }
    }
    // 自然再生 9 档公式（Player.cs:18925-19089 NaturalLifeRegen eRT 段;2026-08-13
    // 重写——旧"恒 1HP/s"简化致满配回血仅原版 1/3~1/5,续航手感差异根因）。
    // 流血 Bleeding/遮挡 Obstructed 清 lifeRegenTime → 阻断(:18998/:11424);
    // DoT 同清（:18781+）——DoT 期间自然回血重启爬坡
    this.sinceHurt++;
    // 幻影闪避重整冷却（Player.shadowDodgeTimer :25656-25659 每 tick 递减）
    if (this.shadowDodgeTimer > 0) this.shadowDodgeTimer--;
    // 金花/叶绿共享 on-hit 计时（petalTimer :25652-25655）+ 叶绿锚体出手冷却
    // （crystalLeafCooldown :25664-25667——原版同段位次：petal 在 shadowDodge 之前、
    //  cd 在 boneGloveTimer 之后；★SW-FX1 boneGloveTimer 位已补=:25662-25664 原位）
    if (this.petalTimer > 0) this.petalTimer--;
    if (this.boneGloveTimer > 0) this.boneGloveTimer--;   // :25662-25664（原版位次=shadowDodge 后、叶绿 cd 前）
    if (this.crystalLeafCooldown > 0) this.crystalLeafCooldown--;
    // environmentBuffImmunityTimer 每 tick 递减（Player.cs:24778——Teleport :37701
    // 置 4 的环境 buff 免疫窗;消费位=专家雪原 Chilled 门 :28209）
    if (this.environmentBuffImmunityTimer > 0) this.environmentBuffImmunityTimer--;
    // 日曜护盾回充（Player.cs ApplySetBonus_Solar :16222-16296 全链：
    //   回充 +1 层时 16×尘6(ArmorSetDye 染料) + AddBuff(170+shields,5)；
    //   盾球环绕轨道 :16258-16283——Y=半径 6 圆×相位(miscCounter/100·2π+l·2π/shields),
    //   X 钉朝向 20px(坐骑 52/54/56/61 推远 50/54/40),vel=(target-pos)×0.2 弹簧）
    if (eqM.solarSet) {
      this.solarCounter++;
      if (this.solarCounter >= 180 && this.solarShields < 3) {
        this.solarShields++;
        this.solarCounter = 0;
        // :16240-16250 层视觉 buff + 16×尘6（noGravity/scale1.7/fadeIn0.5/v×5/套染料）
        for (let j = 0; j < 16; j++) {
          const d = game.vanillaDust?.spawn(this.x, this.y, this.w, this.h, 6,
            0, 0, 100, null, 1.7);
          if (d) {
            d.noGravity = true; d.fadeIn = 0.5;
            d.vx *= 5; d.vy *= 5;
            d.dyeVid = this.armorSetDyeVid();
          }
        }
      }
    } else { this.solarShields = 0; this.solarCounter = 0; }
    // ---- 叶绿水晶叶套装（台账 L3 清偿批 2026-08-31）----
    // 授予/清除对账（原版双支并跑语义）：Effect=AddBuff(60,5) 每 tick 重钉
    // （ArmorSetBonuses.cs:128-146 :131/:138/:143）→ 本仓 300s=18000t 等价承载
    // buffTime 钉值（UpdateBuffs buff60 分支 :11750）；卸套 ClearBuff(60) =
    // Player.cs:16436-16440 UpdateArmorSets_Always_Chlorophyte → else remove() 同拍生效。
    // equipStats.crystalLeaf 与原版 setChlorophyte 是同一 derive 的两种写法（查询表键一致）
    if (eqM.crystalLeaf) {
      this.buffs.apply(BuffType.LeafCrystal, 300);
      // 锚体对账+缺位补生（buff60 效果分支 :11752-11763：全桶扫 type==226 只留
      // 最先扫到的一只多余 Kill、无存活才 NewProjectile(226)——Game 侧实现）
      game.updateChloroCrystalAnchor?.();
    } else {
      this.buffs.remove(BuffType.LeafCrystal);
    }
    // ---- ★Forbidden 禁戒套（组C 终盘 2026-09-18;Benefits.Forbidden
    //      ArmorSetBonuses.cs:61-65 = setForbidden 置位 + UpdateForbiddenSetLock +
    //      Lighting.AddLight(0.8,0.7,0.2)——每拍重置位面。卸套同拍清两旗
    //      （原版 ResetEffects :18861/:18870 每拍清零、套装面在场重置位=等价对账）----
    if (eqM.setBonus?.forbidden === true) {
      this.setForbidden = true;
      this.updateForbiddenSetLock(game);
      game.addLightAt?.(this.cx, this.cy, 0.8, 0.7, 0.2);
    } else {
      this.setForbidden = false;
      this.setForbiddenCooldownLocked = false;
    }
    // MinionRestTargetPoint 每 tick 失效复位（UpdateMinionTarget :57677-57681——
    // 距玩家 >1000px 清零）
    if (Math.hypot(this.minionRestTargetX - this.cx, this.minionRestTargetY - this.cy) > 1000) {
      this.minionRestTargetX = 0;
      this.minionRestTargetY = 0;
    }
    // ★BJ157⑧ rest 点尘环（UpdateMinionTarget :57683-57701）：stardustGuardian
    // （:11018-11024 buff187 ∧ owned623>0;本仓守护者常驻段 Game.ts:9343 由同一
    //  summonSet.guardian 旗驱动 623 存亡,同源等价）∧ HasMinionRestTarget →
    //  3 粒 135 尘绕点公转（miscCounter/150·2π + i·2π/3,半径 4;α100 scale1.5,
    //  velocity=0/position 直写同原版序,noGravity;noLight 置位,cPet shader 未建模）
    if (this.equipStats.summonSet?.guardian === true && !this.dead && this.hasMinionRestTarget) {
      for (let i = 0; i < 3; i++) {
        const d = game.spawnDust?.(this.minionRestTargetX, this.minionRestTargetY, 0, 0, 135, 0, 0, 100, null, 1.5, true);
        if (d) {
          const ang = (this.miscCounter / 150) * Math.PI * 2 + i * (Math.PI * 2 / 3);
          d.vx = 0; d.vy = 0;
          d.x = this.minionRestTargetX + Math.cos(ang) * 4;
          d.y = this.minionRestTargetY + Math.sin(ang) * 4;
          d.noLight = true;
        }
      }
    }
    // ---- ★BJ596 甲虫 orb 视觉体物理（UpdateArmorSets_Always_Beetle,Player.cs:16556-16612）----
    // 门 = beetleDefense||beetleOffense（:16558）——双套不在身整段早退（beetleCounter
    // 清零在 BeetleMeter 计数域 :16560,本处不重复管账;pos/vel 冻结不归零=原版同款,
    // 重穿 orbs=0 时未用槽全零 :16573-77=从中心重生）。无 stealth/wet 门（原版无）。
    // !dead 门 = 原版 Player.Update `if (dead) {UpdateDead(); return;}`（:24943-24949）
    // 先于 UpdateArmorSets（:25882）→ 死亡相物理冻结+不绘。
    // 位次：原版 UpdateArmorSets 内 Always_Beetle 先于 Always_Solar（:16421-16423）
    // → 本仓插盾球轨道块之前。
    // ★序差登记：orb 数权威 = BeetleMeter.tick（Game.postUpdate→updateSwingHits）,
    // 晚于本 fixedUpdate 步——档位切换当拍物理读上一拍 orb 数,视觉瞬态 ≤1 tick
    // （原版 UpdateBuffs 球数同步与 Always_* 同拍）。
    if (!this.dead && (eqM.beetleDef === true || eqM.beetleOff === true)) {
      this.beetleFrameCounter++;                             // :16563（>=1 门恒真=反编译残迹式照抄）
      if (this.beetleFrameCounter >= 1) {
        this.beetleFrameCounter = 0;
        this.beetleFrame++;
        if (this.beetleFrame > 2) this.beetleFrame = 0;      // :16567-16570 3 帧条循环
      }
      for (let i = this.beetleOrbs; i < 3; i++) {            // :16573-16577 未用槽归零
        this.beetlePos[i].x = 0; this.beetlePos[i].y = 0;
      }
      for (let j = 0; j < this.beetleOrbs; j++) {            // :16578-16612
        stepBeetleOrb(this.beetlePos[j], this.beetleVel[j], this.vx, this.vy);
      }
    }
    // 盾球轨道（:16258-16283）+ buff 对账（:10044-10066：层数变即清多余档,
    // setSolar 在场持续续期 5t；卸套清零）
    {
      const mntType = this.ridingMount ? this.mount.type : -1;
      for (let k = this.solarShields; k < 3; k++) this.solarShieldPos[k].x = this.solarShieldPos[k].y = 0;
      for (let l = 0; l < this.solarShields; l++) {
        const pos = this.solarShieldPos[l], vel = this.solarShieldVel[l];
        pos.x += vel.x; pos.y += vel.y;
        const ang = (this.miscCounter / 100) * Math.PI * 2 + l * (Math.PI * 2 / this.solarShields);
        const tx0 = Math.cos(ang) * 6, ty0 = Math.sin(ang) * 6;   // ToRotationVector2 × 6
        let tx = this.facing * 20;                                 // X 钉朝向（:16269）
        if (mntType === 52) tx = this.facing * 50;
        else if (mntType === 54) tx = this.facing * 54;
        else if (mntType === 56 || mntType === 61) tx = this.facing * 40;
        vel.x = (tx - pos.x) * 0.2;
        vel.y = (ty0 - pos.y) * 0.2;
      }
      const tiers = [BuffType.SolarShield1, BuffType.SolarShield2, BuffType.SolarShield3] as const;
      tiers.forEach((bt, i) => {
        // 原版钉值=UpdateBuffs 效果循环直写 buffTime[j]=5【t】(:10451-10452)+
        // 增/减档 AddBuff(170+shields,5)（:16501/:57426）→ 稳态恒 5t。
        // ★曾误 0.5s(30t)，掉档后图标多挂 25t（2026-08-31 tick/秒单位族审计）
        if (this.solarShields > 0 && i + 1 === this.solarShields) this.buffs.apply(bt, 5 / 60);
        else this.buffs.remove(bt);
      });
    }
    // 乘区外 flat lifeRegen 单位缓存（闪亮石静止 +4 :19248;丰盛大餐 +6 :19283-19287;
    // 魂镰 num3 在下方 soulDrainBonus）
    let shinyFlatUnits = 0;
    const heartyFlatUnits = this.buffs.has(BuffType.HeartyMeal) ? 6 : 0;   // 3HP/s
    this.lifeRegenTime += 1 + (this.buffs.has(BuffType.Honey) ? 2 : 0);   // 蜂蜜 +2/t（:18954 加法并列项）
    // 神盾水晶 +0.2/t（★V2a 复核 ⚠️e 勘误：原版 :18930-18934 为【加法独立项】,
    // 曾写成 (1+蜂蜜)×1.2 乘算 → 蜂蜜同挂时 3.6/t vs 原版 3.2/t）
    if (this.usedAegisCrystal) this.lifeRegenTime += 0.2;
    // 老猩红甲（1457/1458 :19233）：crimsonRegen → lifeRegenTime += 1/t（独立并列项,
    // 紧随神盾水晶 +0.2 之后、坐/睡 +3 之前——原版同段位次）
    if (eqM.crimsonRegen) this.lifeRegenTime += 1;
    // 坐/睡加成（:19053-19056）：lifeRegenTime +3/tick + 自然回血 ×1.3
    if (this.sitting || this.sleeping) this.lifeRegenTime += 3;
    // 魂镰吸魂（:19237-19240 lifeRegenTime += 2；:19277-19282 num3=(5+n)/2 同时加
    //  lifeRegenTime 与 lifeRegen——R5-F3：旧漏 num3 加 eRT 半边,且把 num3 塞进
    //  num5 吃移动/专家/mHP 乘区,原版是乘区外 flat）
    if (this.soulDrain > 0) {
      this.lifeRegenTime += 2;                       // :19239
      this.soulDrainBonus = Math.floor((5 + this.soulDrain) / 2);  // :19279
      this.lifeRegenTime += this.soulDrainBonus;     // :19280 num3 加 eRT
    } else {
      this.soulDrainBonus = 0;
    }
    if (buffHeal < 0 || this.buffs.dotActiveTick
      || this.buffs.has(BuffType.Bleeding) || this.buffs.obstructed) this.lifeRegenTime = 0;
    if (this.hp > 0 && this.hp < this.maxHp
      && !this.buffs.has(BuffType.Bleeding) && !this.buffs.obstructed) {
      // 闪亮石静止档 flag（UpdateLifeRegen :19061-19064：shinyStone &&
      // IsConsideredStandingStill(:3307 |vx|<0.05&&|vy|<0.05) && itemAnimation==0）。
      // R5-F2：整段（跳档/加速/减伤半/连续加成/×1.1/0.75 档）曾全缺
      const eqS = eqM;
      const shinyStill = !!eqS.shinyStone && Math.abs(this.vx) < 0.05
        && Math.abs(this.vy) < 0.05 && this.itemAnimTicks <= 0;
      // eRT 八档阶梯（:19301-19332）+ 3600 封顶档（:19346-19350;闪亮石静止档改走
      // (RT-3000)/300 连续加成 :19333-19345）
      const rt = this.lifeRegenTime;
      let ert = 0;
      for (const th of [300, 600, 900, 1200, 1500, 1800, 2400, 3000]) if (rt >= th) ert++;
      let num5 = ert;
      if (shinyStill) {
        // :19241-19249：eRT∈(90,1800) 直接跳档 1800；eRT += 4/t；lifeRegen flat +4
        if (rt > 90 && rt < 1800) this.lifeRegenTime = 1800;
        this.lifeRegenTime += 4;
        shinyFlatUnits += 4;
      } else if (rt >= 3600) {
        ert++;                       // :19346-19350 第 9 档（非闪亮石静止档）
        this.lifeRegenTime = 3600;
      }
      // 移动系数（:19360 `velocity.X != 0 && grappling[0] < 0 ? ×0.5 : ×1.25`）——
      // R5-F5：静止判定是【未抓钩】非攀绳;抓钩悬移吃 ×1.25 静止档,站绳移动吃 ×0.5。
      // 旧 `|vx|>0.01 && !onRope` 两处皆反,已修
      num5 *= (this.vx !== 0 && !this.grappling[0]) ? 0.5 : 1.25;
      // 老猩红甲 ×1.5（:19359-19362——原文紧随移动系数、先于闪亮石/篝火乘区）
      if (eqM.crimsonRegen) num5 *= 1.5;
      // 篝火乘区（:19369-19372——本仓篝火为 buff,lifeRegen+1 半边在 Buffs 系,此处为乘区）
      if (this.buffs.has(BuffType.Campfire)) num5 *= 1.1;
      // 闪亮石 ×1.1（:19365-19368——装备即生效,不要求静止）
      if (eqS.shinyStone) num5 *= 1.1;
      // 坐/睡回血 ×1.3（:19351-19355 下半——睡中恒静止吃 1.25 静止档，坐椅同）
      if (this.sitting || this.sleeping) num5 *= 1.3;
      // 闪亮石静止连续加成（:19333-19345）：num6=(eRT-3000)/300 钳 30 并入 num5
      if (shinyStill) {
        const num6 = Math.min(30, (this.lifeRegenTime - 3000) / 300);
        if (num6 > 0) num5 += num6;
      }
      // 专家且未进食 /2（:19373-19376——闪亮石在栏改 ×0.75 档）
      const diff = scaleStatsWorld().difficulty;
      const fed = this.buffs.has(BuffType.WellFed) || this.buffs.has(BuffType.WellFed2) || this.buffs.has(BuffType.WellFed3);
      if (diff >= GDL.EXPERT && !fed) num5 = eqS.shinyStone ? num5 * 0.75 : num5 / 2;
      // mHP 系数（:19381-19382:statLifeMax2/400×0.85+0.15）→ lifeRegen 单位=半HP/s
      num5 *= this.maxHp / 400 * 0.85 + 0.15;
      // R5-F6：逐 tick (int)Math.Round 取整（:19383）——旧 (num5/2)*dt 连续积分
      // 系统性偏快（满血 400 单档静止 1.25→Round 1 = 0.5HP/s,旧 0.625HP/s +25%;
      // 移动低爬坡 0.5→Round 0 = 原版早期零回复）。C# Math.Round = 银行家舍入
      //（2.5→2）,同款实现
      const rf = Math.floor(num5);
      const rd = num5 - rf;
      const rounded = rd > 0.5 ? rf + 1 : rd < 0.5 ? rf : (rf % 2 === 0 ? rf : rf + 1);
      // lifeRegenCount 语义：rounded(num5) + 乘区外 flat（闪亮石静止 +4、丰盛大餐 +6、
      // 魂镰 num3、快速再生 buff58 +4）逐 tick 入账,满 120 单位 = 1 HP（:19384 +
      // :19385-19387 palladiumRegen 支 + :19407-19433）。
      // 快速再生（buff 58=PalladiumRegen）:UpdateLifeRegen :19385-19387
      // `if (palladiumRegen) { lifeRegenCount += 4; }`——乘区外 flat +2HP/s;
      // 原版该支在 while(lifeRegenCount>=120) 消费前【无 hp 窗门】(满血时溢出被
      // 上限钳制吞掉),本仓等价并入再生窗 flat 和。
      const palladiumRegen = this.hasVanillaBuff(58) ? 4 : 0;
      this.regenAccum += (rounded + shinyFlatUnits + heartyFlatUnits + this.soulDrainBonus
        + palladiumRegen) / 120;
      if (this.regenAccum >= 1) {
        const n = Math.floor(this.regenAccum);
        this.regenAccum -= n;
        const healed = Math.min(this.maxHp, this.hp + n) - this.hp;
        this.hp += healed;
        // 老猩红甲脉搏红粒（:19411-19429）：每回 1 HP → 10×dust5（α175/scale1.75/
        // noGravity,±40px 内嵌偏移 + 速度 = −偏移×0.075 的收束矢量）。原版循环体
        // 在 while(lifeRegenCount>=120) 的逐 HP 支内——此处按实回点数等比例展开
        if (healed > 0 && eqM.crimsonRegen && game.vanillaDust) {
          for (let pt = 0; pt < healed; pt++) {
            for (let i = 0; i < 10; i++) {
              const d = game.vanillaDust.spawn(this.x, this.y, this.w, this.h, 5,
                0, 0, 175, null, 1.75);
              if (!d) break;
              d.noGravity = true;
              const ox = (Math.random() * 81 | 0) - 40;    // Next(-40,41)
              const oy = (Math.random() * 81 | 0) - 40;
              d.vx = -ox * 0.075;
              d.vy = -oy * 0.075;
            }
          }
        }
      }
    }
    // 上限收缩时钳制
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    // ---- 魔力自然回复 1:1（Player.UpdateManaRegen :19214-19302）----
    // maxRegenDelay（:24378-24379）：(1−mana/max)×60×4+45 再 ×0.7——用魔越狠惩罚越长
    const smm = this.maxMana;                       // statManaMax2（buff+装备后上限）
    if (this.manaAnimTicks > 0) {
      // 用魔物品动画期：每帧重置 delay（ItemCheck :42131-42137 → ApplyManaRegenDelay
      // ★R27 接上 spaceGun 豁免门（ItemCheck_ApplyManaRegenDelay :51198-51202）：
      // 陨石套在手持 127 太空枪/4347 灰 zapinator/4348 橙 zapinator/514 钉枪时不重置
      // delay = 无限施放的后半边;曾恒重置=套装主收益缺失,Player.ts 自认处）
      // 1457: 三处置 delay 改调 ApplyManaRegenerationDelay()（:19515-19540）——
      // 内联同公式但带 manaRegenBuff 钳 20f（1456 只在 UpdateManaRegen 每帧钳，
      // 1457 把钳挪到置值时点 → 回蓝 buff 期间施法/快捷 buff 的惩罚期变短）
      this.manaAnimTicks--;
      const heldDef = ITEM_DEFS[this.inv.heldItem()?.id ?? -1];
      const heldVid = heldDef ? (heldDef.vid ?? -1) : -1;
      if (!(eqM.spaceGun && (heldVid === 127 || heldVid === 4347 || heldVid === 4348 || heldVid === 514))) {
        this.applyManaRegenerationDelay(smm);
      }
    }
    // manaRegenBonus/manaRegenDelayBonus（:18481-18482 每帧清零后由 buff 158 :9629-9632
    // 与魔力斗篷 982 :14379-14383 重算）。★1458：瓶中星 buff 158 的 delayBonus+0.5
    // 已删（1458 Player.cs:10020——手环族堆叠致惩罚期衰减溢出=用武器也满速回蓝的
    // 修复半边;regen+10 保留）;手环族 982/6188/6189 的 delayBonus++ 同批删除
    // （1458 :15044）——1458 删除,数据面已同步清零（vanilla-accfx.json 三键已删,
    // equipStats.manaRegenDelayBonus 恒 0,惩罚期衰减恒 1/tick）
    const mRegenBonus = (eqM.manaRegenBonus ?? 0)   // ★BJ175 桩面 ?? 防御（缺省 0）
      + (this.buffs.has(BuffType.StarInBottle) ? 10 : 0);
    const mDelayBonus = eqM.manaRegenDelayBonus ?? 0;
    if (this.manaRegenDelay > 0) {
      // 惩罚期衰减（:19545-19557）：基础 1 + delayBonus；静止/抓钩/魔力再生再 −1
      //（R5-F8：原版静止判定 = IsConsideredStandingStill || grappling[0] >= 0,
      // 抓钩悬移吃快速衰减档;旧 onRope 误代——攀绳静止本就落在 |v|<0.05 档）
      this.manaRegenDelay -= 1 + mDelayBonus;
      const still = Math.abs(this.vx) < 0.05 && Math.abs(this.vy) < 0.05; // IsConsideredStandingStill :3307
      if (still || this.grappling[0] || this.buffs.manaRegenBuff) this.manaRegenDelay -= 1;
      if (this.usedArcaneCrystal) this.manaRegenDelay -= 0.05;   // :19442-19446
    }
    // 1457: manaRegenBuff 钳 20 从 UpdateManaRegen 移除（:19541-19560 无此段）——
    // 钳制只在置值时点（applyManaRegenerationDelay）发生
    // ★ManaV2 攻击期 5% 滴流（:19563-19567 + :19601-19604,2026-08-21 补批 1 遗漏半边）：
    // flag2 = delay≤0（衰减后）;flag3 = ManaV2 && !flag2 && delay<4 → flag2 强制 true。
    // 攻击期 ItemCheck_ApplyManaRegenDelay（:43143-43146 itemAnimation>0 && item.mana>0
    // 每帧）→ ApplyManaRegenerationDelay 把 delay 恒刷回 4 → 衰减后 3 ∈ (0,4) →
    // num10 ×= 0.05 = 攻击时 5% 产额（官方"攻击时仍以正常速率 5% 恢复"）。
    // 药水"始终最大速率+攻击时也生效"同此支：manaRegenBuff → num9=1 无低蓝惩罚。
    const flag2 = this.manaRegenDelay <= 0;
    const flag3 = !flag2 && this.manaRegenDelay < 4;      // :19563-19567（ManaV2 恒真）
    let manaRegen = 0;
    if (flag2) this.manaRegenDelay = 0;
    if (flag2 || flag3) {
      // 1457 每帧产额（UpdateManaRegen :19568-19605）三改：
      // ①基数 = max/3+manaRegenBonus+1，静止/攀绳/魔力再生档改为【再加全额基数】
      //   （num5 = max/3+bonus+1；1456 只加 max/3）
      // ②存量系数 0.2+0.8×(mana/max) → 0.5+0.5×(mana/max)（空蓝回复 2.5 倍）
      // ③下限钳 manaRegen<2 → =2；且 1456 的 ×1.15 全局乘区被移除（满蓝 -13%）
      const still = Math.abs(this.vx) < 0.05 && Math.abs(this.vy) < 0.05;
      const num5 = Math.floor(smm / 3) + mRegenBonus + 1;   // :19571
      manaRegen = num5;
      if (still || this.grappling[0] || this.buffs.manaRegenBuff) manaRegen += num5;  // :19572-19575（抓钩=静止档,R5-F8）
      if (this.usedArcaneCrystal) manaRegen += Math.floor(smm / 50);            // :19577-19580
      const num6 = smm > 0 ? this.mana / smm : 1;                               // :19582
      const num9 = this.buffs.manaRegenBuff ? 1 : 0.5;                          // :19584-19588
      let num10 = num9 + (1 - num9) * num6;                                     // :19592
      if (flag3) num10 *= 0.05;                          // :19601-19604 num11=0.05（攻击期滴流）
      manaRegen = Math.floor(manaRegen * num10);                                // :19599（×1.15 已删）
      if (manaRegen < 2) manaRegen = 2;                                         // :19600-19603 下限（滴流支同样吃 2 下限）
    }
    // 蓄能结算（:19274-19278）：≥120 扣 120 换 1 魔（满魔时也扣——原版同语义）。
    // 回蓝满触发（Player.cs:19656-19686）：每跳 flag4=「本跳实补了 1 点」；仅当
    // 补完 statMana==statManaMax2 且 flag4（本地玩家）才播 SoundID.MaxMana(25)
    // + Dust 45 ×5（noLight/noGravity/v×0.5、scale Next(20,26)×0.1）——即【只有
    // 从<max 补到 ==max 的那一跳】响,满魔后多圈循环 flag4 恒 false 不重播
    // （ManaV2 调试支 :19666-19668 置 flag4=false,本仓无 DebugOptions 不移植）
    this.manaRegenCount += manaRegen;
    while (this.manaRegenCount >= 120) {
      this.manaRegenCount -= 120;
      const filledThisJump = this.mana < smm;   // Player.cs:19660 flag4
      if (filledThisJump) this.mana++;
      if (this.mana < smm) continue;            // :19670-19672 未满不结算提示
      if (!filledThisJump) continue;
      game.playSfxWav?.('MaxMana', 1);
      for (let i = 0; i < 5; i++) {
        const d = game.vanillaDust?.spawn(this.x, this.y, this.w, this.h, 45, 0, 0, 255, null,
          (20 + Math.floor(Math.random() * 6)) / 10);   // Next(20,26)*0.1
        if (d) { d.noLight = true; d.noGravity = true; d.vx *= 0.5; d.vy *= 0.5; }
      }
    }
    if (this.manaRegenCount < 0) this.manaRegenCount = 0;  // :25686-25688
    if (this.mana > smm) this.mana = smm;                  // :25690-25693
    // 1457: 叶绿巨剑三连击计数每帧递减（ItemCheck :43161-43163
    // `if (chlorophyteBladeCounter > 0) chlorophyteBladeCounter--`）
    if (this.chlorophyteBladeCounter > 0) this.chlorophyteBladeCounter--;

    // A3（1457 :24823-24860 魔力过热蓝焰尘,2026-08-21 接线）：manaHeat≠1 期间每帧
    // 2 掷,掷中率 = Remap(manaHeat,1.3→1,  rate 1→0) = clamp((manaHeat−1)/0.3)
    // （本地玩家档;他玩家恒 0.3——本仓单本地模型恒走本地档）。尘 267 蓝焰:
    // noLight+noGravity、vx=0、vy=rand×0.5−1.5、fadeIn/scale=0.7+1.3×rand、
    // Color.Blue α200、y+5;CloneDust 伴生白尘 ×0.4 缩放/fadeIn
    if (this.manaHeatMult !== 1) {
      const pool = game.vanillaDust;
      if (pool) {
        const rate = Math.max(0, Math.min(1, (this.manaHeatMult - 1) / 0.3));
        for (let k = 0; k < 2; k++) {
          if (Math.random() * 6 >= rate) continue;
          const d = pool.spawn(this.x, this.y, this.w, this.h, 267, 0, 0, 200,
            { r: 0, g: 0, b: 255, a: 255 }, 1);
          if (!d) continue;
          d.noLight = true;
          d.noGravity = true;
          d.vy = d.vy * 0.5 - 1.5;
          d.vx = 0;
          d.fadeIn = 0.7 + Math.random() * 1.3;
          d.scale = 0.7 + Math.random() * 1.3;
          d.y += 5;
          const d2 = pool.spawn(this.x, this.y, this.w, this.h, 267, 0, d.vy, 200,
            { r: 255, g: 255, b: 255, a: 255 }, d.scale * 0.4);   // CloneDust 伴生
          if (d2) {
            d2.noLight = true;
            d2.noGravity = true;
            d2.vx = 0;
            d2.fadeIn = d.fadeIn * 0.4;
            d2.y = d.y;
          }
        }
      }
    }

    // 液体检测：Collision.WetCollision（Collision.cs:1575-1650）——**中心小盒**：
    // 宽 min(10,w) × 高 min(h/2,h)，以身体中心居中（vector = Center−(num/2,num2/2)）。
    // ★曾误移植为 [身体中心,脚底]×±10 的"下半盒"：wet 翻转点比原版深 ~10px（水面
    //   到脚底才翻）→ 出入水涟漪生成点 center+5 高出水面 ~16px、圆环大半在空气
    //   = 用户实报"角色出入水没涟漪、史莱姆正常"（NPC 侧 npcLiquid.wetCollision 是
    //   正确居中盒故无此症）。2026-08-22 改与 NPC 侧共用同一实现（含坡面格+上液
    //   满高计 :1635-1654 分支——旧手写盒缺该支，坡面涉水判定偏浅）。
    //   居中盒同样解决旧"脚底单点采样"的水下走坡 1-2px 抖动翻转问题。
    //   ★SW-RB20a F6④：旧 wasWetAny（三桶并集快照）已退役——唯一消费位
    //   _wetExitJumpClip 门改 wasWetAll(wetSticky)∧!wetNow（ vanilla else if (wet)
    //   :28071 逐位同构,见下方段注）;三桶并集 ≠ wet 粘滞位（BJ89 幻影姿态家族）。
    // 原版 wet 位 = WetCollision 原始返回：Collision.cs:1608 `liquid > 0` 对任意液体
    // 成立（岩浆/微光/蜜都是液体,无排除项）、:1627 首中即返——wet 含岩浆+微光
    // （铁证：Player.cs:28049-28056 岩浆溅花尘 35 与 :28060 `wet = true` 同体）。
    // 旧注"wet 只认 !lava && !shimmer(:1418)"系把 DrownCollision（呼吸口,
    // Collision.cs:1418 `!tile.lava() && !tile.shimmer()`）当 wet 位——勘误退役
    // （红队 R1-F5/F10 2026-09-03）。inWater 是本仓"去岩浆"窄化位,honey/shimmer
    // 桶与 wetCollision 返回同源同盒
    // 原版序（Player.cs:27871-27938）：flag24=lavaWet 上拍留存 → LavaCollision（先于
    // WetCollision）→ WetCollision → shimmer/honey 旗 → 溅花段。原版 lavaWet 带
    // !shimmering 门（:27878-27882）→ 溅花用粘滞镜像字段（见字段注）;inLava 桶位
    // 保持无门原口径（灼烧/Wet 剥离/inWater 窄化消费面不动）
    // ★BJ89 出入水翻转驱动定谳（bj80 域外观察清偿）：原版 wet 粘滞位【只】由 num86
    // （WetCollision 居中探针,任意液体）驱动——:28060 num86 支内置真、:28071
    // `else if (wet)` 支首置假、:28160 拍末 `if (!wet)` 读后值清偿。旧实现以四桶并集
    // 近似,混入全盒 LavaCollision 的 inLava → 「探针干+全盒岩浆擦过」姿态下并集真
    // 而原版 wet 假 → 出浆分支幻影发射（vanilla 静默）。修 = 显式 wetSticky 位
    // （本文件字段注）逐点对齐原版 wet 的置位/复位/清偿三处
    const wasShimmering = this.shimmering;   // 原版 UpdateBuffs(:25763) 先于本段——此刻读值 ≙ 原版 shimmering
    // ★BJ705-G26 件3（2026-10-22）[g20-buff305-lavavision] 清偿:熔岩潜水镜渐变斜坡
    //   （UpdateBuffs 尾 :12140-12153——原版在 buff 循环尾、湿段 :27883 之前 → 读
    //   【上拍】lavaWet;本位=湿段 splashLavaWet 刷新前,同拍序同相）。授予源=唯一
    //   buffType 305 熔岩鲨坐骑（:9994-9998 lavaVision=true——仓内判定式
    //   ridingMount && mount.buff === 305,同 lavaTotalImmune 腿 BJ704-G20）;
    //   lavaVision∧lavaWet∧>0.4 → −0.04/t 钳 0.4（入浆 15 拍渐透）;else <1 →
    //   +0.04/t 钳 1（出浆/下鞍 15 拍渐复）。Spawn 复位面 :37875 lavaOpacity=1
    //   （★BJ707-G29 清偿：Game.respawnPlayer 与 fireRecallTeleport 'spawn' 支两
    //   Spawn face 已落 lavaOpacity=1;★BJ707-G31 清偿:邻行 :37874 lavaTime=lavaMax
    //   同两支落 lavaImmuneTicks=equipStats.lavaMax——同段同相,债清;★BJ713-A:recall
    //   支改读聚合 equipStats.lavaMax+cartLavaMaxBonus——vanilla 同拍 lavaMax 含
    //   坐骑面（UpdateEffects :25855 先于 ItemCheck :43324,骑 Hell 车 +420 随传送
    //   不卸 mount 保全;respawn 支死亡已卸=equip 面单读原式））。
    const lavaVision = this.ridingMount && this.mount.buff === 305;
    if (lavaVision && this.splashLavaWet && this.lavaOpacity > 0.4) {
      this.lavaOpacity = Math.max(0.4, this.lavaOpacity - 0.04);
    } else if (this.lavaOpacity < 1) {
      this.lavaOpacity = Math.min(1, this.lavaOpacity + 0.04);
    }
    const flag24 = this.splashLavaWet;       // :27872（上拍 lavaWet——出水溅花岩浆门）
    const wasWetAll = this.wetSticky;        // :27872 flag23（上拍 wet 粘滞位——本拍读点）
    // 水上行走缩高 6px（原版 num82,Player.cs:27875-27881:水面行走不因脚尖触浆受伤）
    // 水上行走（装备 waterWalk 族 ∪ 水上行走药水 buff 15,:9706）——原独立块随
    // LavaCollision 前移到此（vanilla 序:27877-27938）。★SW-FX19：倒挂整禁
    // （:27866-27869 `gravDir==-1 → waterWalk/waterWalk2=false`，先于 Wet/Lava 碰撞）
    const canWaterWalk = (eqM.waterWalk || this.buffs.canWaterWalk)
      && this.gravDir !== -1;
    // ★BJ227 勘误：缩高 6px 臂原版只认【纯 waterWalk】（:27873-27881 `if (waterWalk)
    // num82 -= 6`——waterWalk2 水上漂靴族无此臂,贴浆面即灼烧）。曾用并集 canWaterWalk
    // = 863/907 超授岩浆面行走。buff15 药水原版置 waterWalk（:10102）→ 归纯源。
    const lavaWalkPure = (eqM.waterWalkLava || this.buffs.canWaterWalk) && this.gravDir !== -1;
    const lavaProbeH = lavaWalkPure ? this.h - 6 : this.h;
    this.inLava = liquidCollision(world.store, this.x, this.y, this.w, lavaProbeH, 2); // LavaCollision 盒判定
    const flag25 = !wasShimmering && this.inLava;   // :27878-27882（!shimmering 门 + 本拍 LavaCollision）
    this.splashLavaWet = flag25;                    // :27883 lavaWet = flag25
    let wetNow = false;
    let flag27 = false;      // Collision.honey（:27939,WetCollision 首中液格型）
    let shimmerNow = false;  // Collision.shimmer（:27940）
    {
      const r = wetCollision(world.store, this.x, this.y, this.w, this.h);
      this.inWater = r.wet && !this.inLava;   // inWater = 原版 inWater 窄化位（岩浆里不能"游泳"）
      this.inHoney = r.honey;
      wetNow = r.wet;                          // 原版 num86（Player.cs:27938）
      flag27 = r.honey;
      shimmerNow = r.shimmer;
    }
    // :27941-27943 shimmerWet / :27954-27958 honeyWet 置位（AddBuff(353)/(48) 本体在
    // 下方各自段落,不动;此处只镜像溅花旗标——粘滞语义见字段注）
    if (shimmerNow) this.splashShimmerWet = true;
    if (flag27 && !wasShimmering) this.splashHoneyWet = true;
    // 入水过渡拍（vanilla `if (num86) { if (!wet) { wet = true; … } }` Player.cs:27959/
    // :27982/:28060——wet 位任意液体）——湿阻尼消费旗（运动块尾 wetEntryNow 消费）
    const wetEntryNow = !wasWetAll && wetNow;
    // ---- 出入液溅花 1:1（Player.cs:27959-28153;2026-09-04 升格——曾 spawnParticles
    //      色方块近似+playSfx('splash') Splash_0..5 六变体乱掷、微光支整缺、
    //      触发门用 inWater 窄化位+inLava 后写时序差）：
    //      触发门 = num86（wet 位=任意液体）对 wasWetAll（四桶并集≙原版 wet 粘滞位）
    //      翻转 + wetCount==0（:27984/:28078）;wetCount=10 与溅花同门内置（:27986/:28080）
    //      尘逐值（见四发射器注;scale/alpha 为绝对覆写）：
    //        水   50×dustWater() vy−3(入:28036)/−4(出:28130) vx×2.5 scale0.8 α100
    //             noGravity;盒 y+h/2−8(入:28035)/y+h/2(出:28129)
    //        微光 50×308 vy−4 vx×2.5 scale0.8(入:27998)/0.75(出:28092) noGravity（α 不设）
    //             盒 y+h/2（两向均无 −8:27995/:28089）+Next(6) 六掷三色
    //        蜜   20×152 vy−1 vx×2.5 scale1.3 α100 noGravity 盒 −8（:28022/:28116）
    //        岩浆 20×35 vy−1.5 vx×2.5 scale1.3 α100 noGravity 盒 −8（:28049/:28143）
    //      岩浆门：入=本拍 flag25（:27989）、出=上拍 flag24（:28083）;微光优先蜜/水
    //      音 = PlaySound(19)=Splash_N（LegacySoundPlayer.cs:363 Style 缺省 1、:874 case19
    //      num=Style 直映变体）：水 0(:28042/:28136)/微光入 2(:28016)/微光出 3(:28110)/
    //      蜜·岩浆缺省 1(:28029/:28056/:28123/:28150)——playSfxWav 直文件;Splash_2/3
    //      ×0.75 音量与各档音高抖动由 Sfx 库层 FILE_CASE_VOL/PITCH 承载 ----
    if (wetNow) {
      // ★SW-RB20a F6①（2026-09-15）入水熄火（:27961-27970 num86 支内 ∧ !lavaWet）：
      //  OnFire(24)+地狱火(323) 双清（旧仓只清 24=漏 323 臂;旧基面 inWater&&!inLava
      //  → num86∧!lavaWet,本拍 lavaWet 已于 :27883 赋值=本仓 splashLavaWet）。
      //  旧注锚 :27426 误标已随迁正。vanilla 按 buffType 逐槽 DelBuff,buffs.remove
      //  等价单类型口。
      if (!this.splashLavaWet) {
        this.buffs.remove(BuffType.OnFire);
        this.buffs.remove(BuffType.OnFire3);
      }
      // ★SW-RB20a F6②（2026-09-15）入液洗恶臭（:27972-27980 num86 支内,无液体种别
      //  /无 !lavaWet 豁免——岩浆/蜂蜜湿亦洗;RB5a 语义保持,仅探针基面 num86 化）。
      if (this.buffs.has(BuffType.Stinky)) this.buffs.remove(BuffType.Stinky);
      if (!wasWetAll) {                                  // :27982 if (!wet)（入水翻转拍）
        if (this.wetCount === 0) {                       // :27983
          this.wetCount = 10;                            // :27986
          if (!wasShimmering) {                          // :27987 !shimmering
            if (!flag25) {                                 // :27989 !flag25（非岩浆）
              if (this.splashShimmerWet) {                 // :27991 shimmerWet
                this.splashShimmerDust(game, this.y + this.h / 2, 0.8);
                game.playSfxWav?.('Splash_2', 1, this.x, this.y);   // :28016 style 2
              } else if (this.splashHoneyWet) {            // :28018 honeyWet
                this.splashHoneyDust(game, this.y + this.h / 2 - 8);
                game.playSfxWav?.('Splash_1', 1, this.x, this.y);   // :28029 缺省 style=1
              } else {                                     // :28031 水
                this.splashWaterDust(game, this.y + this.h / 2 - 8, 3);   // :28035-28038
                game.playSfxWav?.('Splash_0', 1, this.x, this.y);   // :28042 style 0
              }
            } else {                                       // :28045 岩浆
              this.splashLavaDust(game, this.y + this.h / 2 - 8);   // :28049-28052
              game.playSfxWav?.('Splash_1', 1, this.x, this.y);     // :28056 缺省 style=1
            }
          }
        }
        this.wetSticky = true;                           // :28060 wet = true（num86 支内）
        // ShouldFloatInWater vy 对折钳 3（:28061-28067）由运动块尾 wetEntryNow 消费（湿态阻尼段）
      }
    } else if (wasWetAll) {                              // :28071 else if (wet)
      this.wetSticky = false;                            // :28073 wet = false（支首——先于 wetCount 门/出水溅花）
      // 出水截跳（:28074-28076 jump=jumpHeight/5）——本仓 _wetExitJumpClip（下方段）
      if (this.wetCount === 0) {                         // :28078
        this.wetCount = 10;                              // :28080
        if (!wasShimmering) {                            // :28081
          if (!flag24) {                                 // :28083 !flag24（上拍 lavaWet）
            if (this.splashShimmerWet) {                 // :28085
              this.splashShimmerDust(game, this.y + this.h / 2, 0.75);   // 出水 0.75（:28092）
              game.playSfxWav?.('Splash_3', 1, this.x, this.y);   // :28110 style 3
            } else if (this.splashHoneyWet) {            // :28112
              this.splashHoneyDust(game, this.y + this.h / 2 - 8);
              game.playSfxWav?.('Splash_1', 1, this.x, this.y);   // :28123
            } else {                                     // :28125 水
              this.splashWaterDust(game, this.y + this.h / 2, 4);   // :28129-28132 盒无 −8
              game.playSfxWav?.('Splash_0', 1, this.x, this.y);   // :28136 style 0
            }
          } else {                                       // :28139 岩浆
            this.splashLavaDust(game, this.y + this.h / 2 - 8);   // :28143
            game.playSfxWav?.('Splash_1', 1, this.x, this.y);     // :28150
          }
        }
      }
    }
    // :28155-28168 拍末粘滞清偿——vanilla 读【本拍后值】`if (!wet)`（:28160）。本拍后
    // wetSticky ≡ wetNow（num86 真→:28060 置真；假且上拍真→:28073 置假；假且上拍假
    // →维持假）——★BJ89 旧式 `!(wetNow||wasWetAll)` 以四桶并集近似后值，全盒岩浆
    // 擦过姿态下后值本应假却判真 = 粘滞旗少清一拍
    if (!flag27) this.splashHoneyWet = false;
    if (!shimmerNow) this.splashShimmerWet = false;
    if (!this.wetSticky) {
      this.splashLavaWet = false;
      this.splashHoneyWet = false;
      this.splashShimmerWet = false;
    }
    // ★用户明令分歧 2026-09-14「唇入必响」（超越原版）——表层掠水反馈支（唯一调用行）。
    // ★回滚口：摘除本行（+ Player.SURFACE_SKIM_SPLASH=false 运行时闸）即恢复 BJ79
    // 定谳的原版几何静默（tests/bj79-lip-pocket-wet-parity 头注）。状态面零参与。
    this.surfaceSkimSplashFeedback(game, world.store, wetNow);
    // Wet 103：浸岩浆即刻移除（UpdateBuffs :11335-11338 `if (lavaWet) DelBuff(j)`——
    // 岩浆蒸干一身水。★须在 inLava 判定同帧执行（原版 Collision 先于 UpdateBuffs），
    // 放 buffs.tick 前会因 inLava 滞后一帧）
    if (this.inLava && this.buffs.has(BuffType.Wet)) this.buffs.remove(BuffType.Wet);
    // 蜂蜜浸入（Player.cs:27436：Collision.honey 命中 → AddBuff(48, 1800t=30s) + honeyWet）。
    // 判定 = Collision.WetCollision 探测盒（Collision.cs:1581-1593）：**居中小盒**
    // num=min(10,Width) × num2=min(Height/2,Height)、首中即返——全身盒系旧版矫枉过正
    // （红队 A2：曾误注"全身盒"，实为身盒任一角搭到蜜格即宽出一条边缘带，Honey 授予
    // 与蜜中无字窗口都比原版宽）。曾更早只查脚底单格且 liq>30，同为错
    const honeyW = Math.min(10, this.w), honeyH = Math.min(Math.floor(this.h / 2), this.h);
    this.inHoney = liquidCollision(world.store, this.cx - honeyW / 2, (this.y + this.h / 2) - honeyH / 2,
      honeyW, honeyH, 3);
    if (this.inHoney) this.buffs.apply(BuffType.Honey, 30);
    // ★人鱼化（Player.cs:25774-25785，2026-09-03 备案清偿②）：accMerman 装备 +
    // wet(任意液体,inWater 已含蜜) && !lavaWet && 非史莱姆坐骑 → merman=true +
    // accFlipper=true（湿跳门 flipperOn 消费 :25779）+ AddBuff(34,2) 每帧续钉
    // （2t=1/30s 亚 50ms 不落盘，toSave 既有口径）;else merman=false（终态每帧
    // 由此块裁定——原版 :23426 呼吸段的早置位会被此处 else 覆写）。
    // wings=0（:25778）为视觉字段，flag19 用 wingsLogic 不清 → **人鱼形态翅膀
    // 照常可飞**（本仓无人鱼形体渲染，翼保持显示；旧"变身清翼禁飞"系误读）。
    // 旧版把置位挂在呼吸段（仅头部浸水触发，窄于原版 body-wet）且湿跳门漏 accFlipper
    this.merman = eqM.merman && this.inWater && !this.inLava
      && !(this.ridingMount && isConsideredASlimeMount(this.mount.type));
    if (this.merman) this.buffs.apply(BuffType.Merfolk, 2 / 60);
    // ★附带① 出水截跳标记（Player.cs:28074 消费段的进入门 = `else if (wet)`，即
    //   wet 翻转 false 的这一帧）。★SW-RB20a F6④（2026-09-15）：门基面由
    //   wasWetAny∧三桶并集反相 → wasWetAll(wetSticky=上拍 wet)∧!wetNow —— 与原版
    //   else if (wet)（:28071,上拍粘滞位 ∧ 本拍 num86 假）逐位同构;旧三桶并集在
    //   「探针干+全盒岩浆擦过」姿态下幻影进出（BJ89 同族）。标记在跳跃段尾消费
    //   （clip 对本帧新起跳同样生效——原版 Update 内本段后于 JumpMovement 调用位，
    //   新预算 set 后立即被截）。
    if (wasWetAll && !wetNow) this._wetExitJumpClip = true;
    // ---- 史莱姆坐骑液体态（1457 :28160-28207 / 1456 :27653-27689）：wetSlime--
    //      + 骑史莱姆族（3/50）浸液 → wetSlime=30 + 浮力档（vy>2 ×0.9 / vy-=0.5 /
    //      vy<-4 钳回）。原版 switch 在 mount.Active 段的 `if (wet)`（:28192）内、
    //      不分液体种类；★SW-RB20a F6③：探针基面=wetSticky（原版 wet 读点在
    //      :28060/:28073 刷新之后≡本拍 num86;本仓调用位在湿流程后,wetSticky 后值
    //      ≡wetNow 同构——旧三桶并集=幻影姿态家族,见 MountCombat.ts 段注）。
    //      踩踏循环 A 的 wetSlime==0 门消费此值（MountCombat.mountJumpStomps）----
    // ★C5-B1（2026-10-06）wet switch 下坐臂承接（:28177-28207）：返回 true = 原版
    //      本拍 Mount.TryDismount（蜜蜂5/飞碟7/可爱飞鱼56 湿拍 + 56 dripping 干拍）。
    //      执行面走 :5389 冻结下坐同款惯例：petting 终止（Mount.Dismount :6228-6231）
    //      + 伴生 buff 清偿（ClearBuff :6214,id 先于 dismount 捕获）+ tryDismount
    //      双闸（canDismount:CCed 豁免 + 空间门;失败=原版 :28183 忽略返回值,无尘
    //      无重试——QuickMount 计数链是主动下坐键路径 :5738-5753 专属,此处不挂。
    //      ★BJ704-G13（G12 登记债2 连带）：petting/buff 清偿随闸收拢——原版两者
    //      在 Dismount 【体内】=拒下坐拍不发生（旧形状拒下坐仍清 buff+停抚摸））。
    if (tickSlimeWetState(this, this.buffs.has(BuffType.Wet))) {
      if (this.mount.canDismount(this)) {
        if (this.petting.mount) this.stopPettingAnimal();
        const prevBuffVanilla = this.mount.data?.buff ?? -1;
        this.mount.dismount(this);
        const mbt = buffTypeByVanilla(prevBuffVanilla);
        if (mbt !== undefined) this.buffs.remove(mbt);
      }
    }
    this.shimmerUnstuckHelperUpdate(game);   // ShimmerUnstuckHelper.Update :23-45（Player.cs:25843 每 tick,先于 AddBuff(353) 门）
    // 微光浸入（Player.cs:27938-27953）：shimmerWet + 地狱层之上 → AddBuff(353, 60t=1s)。
    // shimmerImmune = 5355 幻彩斗篷在身且未按住下（:15643-46,已实装 equipStats 段）
    // ——旧注"恒 false（来源未移植）"退役（R1 勘误 2026-09-03）；地狱层内不授予
    // （:27948 采样处即有 position.Y/16 < UnderworldLayer 门）
    // Main.UnderworldLayer = maxTilesY-200（Main.cs:2863 恒 h-200，SceneMetrics.ts 同源）——
    // 非 world.lavaLine（本仓岩浆线 ≈(rockLayer+h)/2 生成参数，比 h-200 浅 ~170 格，
    // 误用会提前关闭地狱层门）
    const underworldLayer = world.h - 200;
    // ★⑩ 台账清偿（2026-08-31）shimmer 外门转正：原版 Player.Update :27941
    // `bool shimmer = Collision.shimmer`——Collision.WetCollision(:27888 全身盒,
    // 内部探针 min(10,W)×min(H/2,H) 居中盒 + 首中即返,任意液体) 扫到的首个液体格
    // 是微光才置位。本仓复用共享 wetCollision 1:1 移植体逐格对齐；旧中心格
    // liquidType==4&&liq>30 近似退役（浅浸漏授/多液混池错授两向偏差同时消解）
    this.inShimmer = wetCollision(world.store, this.x, this.y, this.w, this.h).shimmer;
    // 授予采样（:27947-27953）与外门不同位：内采样另取【顶格】(Center.X/16,
    // (position.Y+1)/16) 的 shimmer() 旗标——该旗标只看液体类型不看液量
    // （同句 liquid>=0 恒真），浅浸即授予。
    // 顶格越界（y<0）读 undefined !== 4 = 原版 Main.tile[负] null 短路，同语义
    const topIdx = world.store.idx(Math.floor(this.cx / TILE), Math.floor((this.y + 1) / TILE));
    // 三因子门（:27944 `whoAmI == Main.myPlayer && !shimmerImmune &&
    // !shimmerUnstuckHelper.ShouldUnstuck`）+ 内采样（:27948 顶格 shimmer 旗标）
    if (this.inShimmer && world.store.liquidType[topIdx] === 4
      && this.y / TILE < underworldLayer
      && !eqM.shimmerImmune
      && !this.shimmerUnstuckShouldUnstuck) this.buffs.apply(BuffType.Shimmered, 1);
    // buff 353 处理段（Player.cs:11381-11419）：buff 在 → shimmering=true + frozen
    // 封输入（下方移动积分前的 Frozen∪Shimmering 清零段消费）+ fallStart 重置（免摔伤）。
    // 注意：本 tick 内 DelBuff 后 shimmering 保留到下 tick 才复位（原版 :18168 帧首
    // shimmering=false、buff 循环内置位——同帧移除不撤销本帧穿落）
    if (this.buffs.has(BuffType.Shimmered)) {
      this.shimmering = true;
      this.fallStartY = null;
      if (this.y / TILE > underworldLayer) {
        // 地狱层门（:11391-11397）position.Y/16 > UnderworldLayer → DelBuff
        this.buffs.remove(BuffType.Shimmered);
      } else if (this.inShimmer) {
        // 浸液中（:11399-11402）：buffTime=60t=1s 刷新（穿落全程浸着恒续期）
        this.buffs.apply(BuffType.Shimmered, 1);
      } else {
        // 穿落落点检查（:11403-11419）：逐格扫玩家盒覆盖的全部 tile——
        // 任一实心（SolidTile3）→ buffTime=6t=0.1s 继续穿落；全非实心 →
        // DelBuff 实体化（此刻悬/站在该容纳空间，下 tick 起恢复常规碰撞）
        let inSolid = false;
        const sx0 = Math.floor(this.x / TILE), sx1 = Math.floor((this.x + this.w) / TILE);
        const sy0 = Math.floor(this.y / TILE), sy1 = Math.floor((this.y + this.h) / TILE);
        outer: for (let sy = sy0; sy <= sy1; sy++) {
          for (let sx = sx0; sx <= sx1; sx++) {
            // WorldGen.SolidTile3(num20,num21)（Player.cs:11899）——★A-5 边带（2026-09-04）：
            // 坐标重载首门 InWorld(·,1)（WorldGen.cs:71006-71008）世界最外一圈恒非实心
            if (world.store.inWorld1(sx, sy) && world.store.isSolid(sx, sy)) { inSolid = true; break outer; }
          }
        }
        if (inSolid) this.buffs.set(BuffType.Shimmered, 0.1);
        else this.buffs.remove(BuffType.Shimmered);
      }
    } else {
      this.shimmering = false; // 帧首复位（:18168 shimmering=false 语义）
    }
    if (this.wetCount > 0) this.wetCount--;   // Player.cs:27649-27651
    // shimmerTransparency（Player.cs:18147-18162）：shimmering +0.015/t 钳 0.8；
    // 解除后 -0.015/t 回 0，衰减起始帧（恰 0.8）播 PlaySound(19,…,3)=Splash_3
    // （Player.cs:18422。旧注"无 style 3 样本,shimmerSplash=Splash_4 近似"退役——
    // Splash_3 素材在库且出水溅花支 :28110 已直用,2026-09-17 发声面对齐改真声）
    if (this.shimmering) {
      this.shimmerTransparency = Math.min(0.8, this.shimmerTransparency + 0.015);
    } else if (this.shimmerTransparency > 0) {
      if (this.shimmerTransparency >= 0.8) game.playSfxWav?.('Splash_3', 1, this.x, this.y);
      this.shimmerTransparency = Math.max(0, this.shimmerTransparency - 0.015);
    }
    // TryToShimmerUnstuck（:28377-28389）：timeShimmering 钳 0-7200（shimmering +1/
    // 否则 -10）；≥3600 或 ≥1200 且有任意输入 → ShimmerUnstuck 传送脱困
    this.timeShimmering = Math.max(0, Math.min(7200,
      this.timeShimmering + (this.shimmering ? 1 : -10)));
    if (this.shimmering || this.timeShimmering > 0) {
      const anyInput = this.inputX !== 0 || this.inputJump || this.inputUp || this.inputDown;
      if (this.timeShimmering >= 3600 || (this.timeShimmering >= 1200 && anyInput)) {
        this.shimmerUnstuck(game, world);
      }
    }
    const headIdx = world.store.idx(Math.floor(this.cx / TILE), Math.floor((this.y + 8) / TILE), // 鼻子位置（头顶下方半格）
    );
    const headLiq = world.store.liquid[headIdx];
    // 纯视觉字段：Renderer 水下色调滤镜/调试面板在用。溺水判定已走 drownCollision
    // （CheckDrowning 1:1），勿以此字段做机制决策
    this.headUnderwater = headLiq > 40 && world.store.liquidType[headIdx] === 1;
    // 岩浆伤害 1:1（1457 Player.cs:27880-27926；1456 注 :27350-27440 同物）：盒判定接触 →
    // lavaTime 宽限（护身符族）耗尽后单发 80 + 着火 OnFire 420t。
    // ★A2（清零批·受击域）：改走 Game.damagePlayer msg117 通用漏斗——原版 Send 点在
    // Hurt 尾 `netMode==1 && !quiet` 全路径覆盖岩浆（:38657-38664，SendPlayerHurt 携
    // cooldownCounter=Lava 字面）。旧实现 iframes 门+手调 p.damage 两处偏差：
    //   ① 原版门 = hurtCooldowns[Lava]<=0 **独立桶**（:27889），与 General 免疫位无关；
    //   ② hitDirection=0 字面 ⇒ 不进击退段、msg117 dir 按 FR3-F 钉语义传 0。
    // 飘字值以 damagePreview 预演回填（floatDealt）、颜色 #FF6020（floatColor）保持
    // 本地像素零漂移且漏斗单点显示防双发；受击音同样由漏斗 PlayHurtSound 单点承载。
    // OnFire 门 = Hurt 返回>0（:27921 `num85 > 0.0` 字面）。
    // 黑曜石皮 buff:lavaImmune 完全豁免（Player.cs:9573）;★Notes④ 加第二完全豁免源
    // `lavaImmune |= ashWoodBonus && lavaRose`（:27885 字面）
    // ★BJ704-G20（R10-P1①）：buff305 熔岩鲨第四豁免源（UpdateBuffs :9992-9998
    //   `lavaImmune = true; lavaVision = true; fireWalk = true`——坐骑核心特性「岩浆里
    //   游」的免伤面;G4/G5 建了岩浆悬停/游泳路由但免伤整缺,R10 探针 N2:骑 49 入浆
    //   90 拍 hp 500→15=边悬停边烧死。lavaVision/fireWalk 两腿另册登记——
    //   [g20-buff305-lavavision]/[g20-buff305-firewalk]）。姊妹面海龟 4 免淹
    //   （:5899 drown=false）同族「坐骑 buff 附带免疫」先例。
    const lavaTotalImmune = this.buffs.obsidianSkin
      || this.modLavaImmune === true   // ★五百八十六:mod van.lavaImmune 面
      || (eqM.ashWood === true && !!eqM.lavaRose)
      || (this.ridingMount && this.mount.buff === 305);   // ★BJ704-G20:buff305（mount 49）
    // ★BJ709-G34（G32-D2 清偿）:lavaMax 聚合 = 配饰 fx 面（equipStats.lavaMax,
    //  熔岩护身符族 906/4038/3999/4003 + 908/5000 lavaRose 面,Player.cs:15286/
    //  :15295）+ 坐骑动态面 p.cartLavaMaxBonus（Hell 矿车 +420,Mount.cs:5138
    //  UpdateEffects case 22 首行,Minecart.fixedUpdate 逐拍写）= 原版单帧累计
    //  字段现值（ResetEffects :18779 清零 → ApplyEquips 加配饰 → mount.
    //  UpdateEffects :25855 加坐骑 → 岩浆段 :27880 消费,同帧序）。
    const lavaMax = eqM.lavaMax + this.cartLavaMaxBonus;
    if (this.inLava && !lavaTotalImmune) {
      if (lavaMax > 0 && this.lavaImmuneTicks > 0) {
        this.lavaImmuneTicks--;
      } else if (this.lavaBucketOpen()) {
        this.lastDamageCause = { kind: 'lava' };            // PlayerDeathReason.ByOther(2)
        // ★Notes④（四轮蓝队）：num83/num84 双档全表（1457 :27897-27917 字面）——
        //   主档 80/420；remix(don't dig up) 200/630；ashWoodBonus 在 remix 档改写
        //   145 后【再除二】（(int) 除法）+ OnFire −210；玫瑰层最后 −45/−210。
        //   （ashWoodBonus 生产位 = Ash Wood 全套套装加成，见 vanillaArmorSets
        //    'AshWood' 与 equipStats.ashWood——1456 赋值位 UpdateArmorSetsOld
        //    :15772-15775；1457 反编译树缺该函数但消费位 :27885/:27904 原样在。
        //    `lavaImmune |= ashWoodBonus && lavaRose` 同步落。）
        let num83 = 80;
        let num84 = 420;
        if (world.seedFlags.remix === true) {
          num83 = 200;
          num84 = 630;
        }
        if (eqM.ashWood === true) {
          if (world.seedFlags.remix === true) {
            num83 = 145;
          }
          num83 = Math.trunc(num83 / 2);
          num84 -= 210;
        }
        if (eqM.lavaRose) {
          num83 -= 45;
          num84 -= 210;
        }
        // cooldownCounter=ImmunityCooldownID.Lava(4) 经瞬态桶通道注入——日曜盾消耗门
        // Counter 集 {General,BossNoCheese} 不含（R5-F23 保持,太阳门 effId 派生见 p.damage）
        const lavaShown = this.damagePreview(num83);
        if (this.envHurtThroughFunnel(game, num83, this.cx, this.y - 10,
          ImmunityCooldownID.Lava, lavaShown, '#FF6020') > 0) {
          // AddBuff(24,num84)：原文门 `num84 > 0 && num85 > 0.0`（:27919——ashWood+
          // 玫瑰双叠时 num84 恰归 0,不加火）
          if (num84 > 0) this.buffs.apply(BuffType.OnFire, num84 / 60);
          game.spawnParticles(this.cx, this.y + this.h / 2, '#FF9A3C', 12, 1.6, { life: 32, grav: -0.05 });
        }
      }
    } else if (!this.inLava || lavaTotalImmune) {
      this.lavaAccum = 0;
      // 离浆/浸浆免疫态宽限逐步恢复（Player.cs:27884 flag26=true → :27886
      //  `if (flag25 && !lavaImmune) flag26=false` → :27926 `if (flag26 &&
      //  lavaTime < lavaMax) lavaTime++`——浸浆但免疫态（黑曜石皮 :9573/
      //  buff305 熔岩鲨坐骑/modLavaImmune）原版照回充,旧 !inLava 单门=冻结。
      //  每 tick +1 非立即回满——护身符 7s 宽限需要等价时间回充）
      if (lavaMax > 0 && this.lavaImmuneTicks < lavaMax) this.lavaImmuneTicks++;
    }
    // ★BJ709-G34（G32-D2 清偿连带）::27930-27932 无条件钳 `lavaTime > lavaMax
    //  → lavaTime = lavaMax`（岩浆段尾原行）——lavaMax 动态面（下车卸帽/卸护身符）
    //  立即截断超额宽限。仓内原缺:护身符域静止面不可达（lavaImmuneTicks 只由
    //  恢复/Spawn 写入且均以 lavaMax 为帽）,坐骑动态面落地后下车拍即需本行。
    if (this.lavaImmuneTicks > lavaMax) this.lavaImmuneTicks = lavaMax;
    // ★SW-RB20a F6①/②（2026-09-15）：OnFire/Stinky 入液清洗收口到 num86 探针
    //  （原版两臂都在 `if (num86)` 支内、先于溅花段 :27982——本仓随湿流程迁入湿流程头,
    //  消费位=下方 if (wetNow) 块首;探针基面由「inWater&&!inLava / 三桶并集」改
    //  wetNow（num86 居中探针,Player.cs:27938）——旧桶基面混入全盒 LavaCollision/
    //  窄化 inWater=BJ89 定谳的幻影姿态家族（探针干+全盒岩浆擦过时原版 num86 假
    //  → 不洗,旧桶基面真 → 幻影洗）;旧注 :27426 锚系误标（该处为翼帧代码）。
    //  冷水（专家雪原）：wet 且非岩浆/蜂蜜 → Chilled(46) 150t（1457 Player.cs:28211 /
    // 1458 :28209 逐字同,2026-09-16 对拍）`expert && ZoneSnow && wet && !lavaWet &&
    // !honeyWet && !arcticDivingGear && environmentBuffImmunityTimer == 0`）；
    // arcticDivingGear（1861 极地潜水装备）免疫。
    // ★SW-BJ93 债5（2026-09-16）定谳=同族幻影姿态 → 落刀：原版探针基面=湿粘滞位
    //  `wet`（读点 :28211 在 num86 刷新 :28060/:28073 之后≡本拍 wet；RB20a F6 同族
    //  判例——湿旗由居中探针驱动,非盒位）+ 当拍 lavaWet(:27883)/honeyWet(:27957)。
    //  旧仓用 inWater&&!inLava&&!inHoney 桶位=inWater 全盒 WetCollision 窄化位+
    //  inLava 全盒 LavaCollision（BJ89 定谳的幻影姿态家族：探针干+盒缘擦水/擦浆时
    //  原版 wet 假而桶位真 → 幻影冻结）→ 改 wetSticky（≡vanilla wet,本仓调用位在
    //  湿流程后=后值同构）/splashLavaWet/splashHoneyWet（粘滞镜像=当拍 flag25/
    //  honey 旗;:28164 !wet 清偿两镜像在湿流程内已同构落）。
    // ★终零波批（2026-09-01）：environmentBuffImmunityTimer 实装（Teleport :37701
    // 置 4/递减 :24778）——旧注"十字盾族第 6 门未实装恒 0"系门源误标（该 timer 与
    // 十字盾无关,是传送后的环境 buff 免疫窗;仓内写位=shimmerUnstuck 微光脱困传送）
    if (world.isExpert && game.scene?.zoneSnow && this.wetSticky && !this.splashLavaWet
      && !this.splashHoneyWet
      && !eqM.arcticDivingGear && this.environmentBuffImmunityTimer === 0) {
      this.buffs.apply(BuffType.Chilled, 2.5); // AddBuff(46,150)=2.5s max 合并 = 浸着恒挂
    }
    // ★BJ549（2026-10-07）着火尘 1:1 重铸（Terarria1457/Terraria.DataStructures/
    //   PlayerDrawSet.cs DrawPlayerInner 尘段亲读——原版燃烧视觉【无独立 overlay
    //   贴图】,= 玩家绘制路径的尘族火焰 + 色面两通道。旧自制 spawnParticles 橙黄
    //   方块（0.8/t、2-4px、α 随寿命衰减、无光照、岩浆亮橙底上不可辨）非原版形态
    //   =用户实报「只见扣血不见火焰」根因,退役。即 BJ465 注释所指 Player.ts:4879
    //   块的替身,BJ457/465 域锚沿用）：
    //   · onFire(24)（:1045-1083）：vampireSeed 特档（:1047-1066,shadow==0 无掷门,
    //     每拍 5 粒 dust 6 scale3 盒+10、vel×2.3/vy−0.8,首粒 vx×0.5/vy−1.5/
    //     noGravity=false/scale×0.4≡预传 1.2）;常规档（:1067-1078）Next(4)==0 掷门
    //     → 1 粒 dust 6：盒 (Position−2,w+4,h+4)、vel=player.vel×0.4、α100、scale3,
    //     后置 noGravity=true+vel×1.8+vy−0.5（:1074-1077）。
    //   · onFire3(323)（:1084-1094）=onFire 常规档逐值同。burned(67)（:1239-1250）
    //     【无】掷门（每拍恒 1 粒）scale2/vy−0.75（:1241-1246）。onFrostBurn(44)/
    //     onFrostBurn2(324)（:1253-1274）dust 135 掷门同。onFire2(39)（:1279-1290）
    //     dust 75 掷门同。原版掷序 onFire→onFire3→burned→onFrostBurn→onFrostBurn2→
    //     onFire2 按此保序（未建模族跳过不掷）。
    //   · DustCache.Add（:1078 等）唯一消费=PlayerDrawLayers.cs:4225 相机偏移补偿,
    //     无前后层级语义,不入仓。shadow==0f 门=本仓玩家单 pass 绘制恒满足。
    //   · 色面：onFire/onFire3/onFire2/onFrostBurn 族 :1448 走 GetImmuneAlpha 支
    //     【不吃】buffColor 染色=本色;burned 不在支内（:1252 num15×0.6/num14×0.7
    //     染红）——本仓玩家绘制无 buffColor 面,该单点差登记不扩（登记债）。
    //     AddLight 面：玩家本体零 onFire AddLight（Player.cs 全量 grep 无锚）,发光
    //     =dust 6 逐尘 AddLight+亮色族 {6,15,59-64} 光照合成后强白绘制（VanillaDust
    //     引擎既有,update 链 A :885 组 noGravity 门+scale−0.04/t 衰减同相）。
    //   · 尘引擎口=game.dust.spawn（Game.vanillaDust 池,NewDust 初始化链 1:1:盒内
    //     位抖/速度抖/scale±0.2 抖/帧序）;返 null（池满/BJ466 屏外裁剪）=后置写
    //     安全跳过（BJ480 哨兵蒸发同相）。离屏燃烧玩家原版不绘不尘,本仓 update 侧
    //     恒掷（1/4 门掷流为 Math.random 非种子流,不入世界掷流）。
    const burnDustSpawn = (type: number, scale: number, vyBias: number): void => {
      const d = game.dust?.spawn(this.x - 2, this.y - 2, this.w + 4, this.h + 4,
        type, this.vx * 0.4, this.vy * 0.4, 100, null, scale) as
        { noGravity: boolean; vx: number; vy: number } | null | undefined;
      if (d) {
        d.noGravity = true;              // :1075/:1090/:1244/:1284
        d.vx *= 1.8; d.vy *= 1.8;        // :1076/:1091/:1245/:1285（含 NewDust 抖动整体×1.8）
        d.vy -= vyBias;                  // :1077/:1092 −0.5 / :1246 −0.75
      }
    };
    if (this.buffs.has(BuffType.OnFire)) {
      if (world.seedFlags.vampireSeed === true) {
        // :1047-1066 vampireSeed 特档：每拍 5 粒（盒 +10）
        for (let i = 0; i < 5; i++) {
          const d = game.dust?.spawn(this.x - 2, this.y - 2, this.w + 10, this.h + 10,
            6, this.vx * 0.4, this.vy * 0.4, 100, null, i === 0 ? 1.2 : 3) as
            { noGravity: boolean; vx: number; vy: number } | null | undefined;
          if (d) {
            d.noGravity = true;          // :1055
            d.vx *= 2.3; d.vy *= 2.3;    // :1056
            d.vy -= 0.8;                 // :1057
            if (i === 0) { d.vx *= 0.5; d.vy -= 1.5; d.noGravity = false; }  // :1058-1062
          }
        }
      } else if (Math.random() < 0.25) {  // :1067 Main.rand.Next(4)==0
        burnDustSpawn(6, 3, 0.5);
      }
    }
    if (this.buffs.has(BuffType.OnFire3) && Math.random() < 0.25) burnDustSpawn(6, 3, 0.5);   // :1084-1094
    // ---- ★BJ674 感电/蓝红雷玩家视觉（PlayerDrawSet.cs:1214-1239——原版掷序
    //      ichor(:1210)→electrified(:1214)→blueLightning(:1222)→redLightning(:1230)
    //      →burned(:1239);onFire 族段在 ichor 前,本仓块按原版相对序插在
    //      onFire3 之后、burned 之前。shadow==0 单 pass 恒真（BJ549 同判例）：
    //   · electrified(144)（:1214-1219）：1/3 掷门 → 1 粒 dust 226：
    //     盒 (Position−2,w+4,h+4)、α100、scale0.5 → 后置 vel×1.6 + vy−1 +
    //     position=Lerp(position, Center, 0.5)（电花向玩家心收拢）;DustCache.Add
    //     无层级语义不入仓（BJ549 同判例）。
    //   · blueLightning(399)（:1222-1229）：1/10 掷门 → clientOnly 编排粒子
    //     BlueLightningSmall（MovementVector=Circular(1,1)、Position=盒内随机点）
    //     ——本仓 1:1 端口=lightningSmallOrchestra（orchestraFx,P57:3617-3672）。
    //   · redLightning(400)（:1230-1239）：同构,UniqueInfoPiece=
    //     GetLightningColor(1122).PackedValue=(255,60,60)→XNA ABGR 0xFF3C3CFF。----
    if (this.buffs.has(BuffType.Electrified) && Math.floor(Math.random() * 3) === 0) {
      // :1215-1218（NewDustDirect 后置链 1:1;返回 null=池满/屏外安全跳过）
      const d = game.dust?.spawn(this.x - 2, this.y - 2, this.w + 4, this.h + 4,
        226, 0, 0, 100, null, 0.5) as
        { vx: number; vy: number; x: number; y: number } | null | undefined;
      if (d) {
        d.vx *= 1.6;                                    // :1216 velocity *= 1.6f
        d.vy = d.vy * 1.6 - 1;                          // :1216-1217 velocity.Y--
        // :1218 position = Lerp(position, player.Center, 0.5)
        d.x = d.x + (this.cx - d.x) * 0.5;
        d.y = d.y + (this.cy - d.y) * 0.5;
      }
    }
    if (this.buffs.has(BuffType.BlueLightning) && Math.floor(Math.random() * 10) === 0) {
      // :1223-1228 NextVector2Circular(1,1)=角均匀×线性半径（orchestraFx circ 同式）
      const a6 = Math.random() * Math.PI * 2, r6 = Math.random();
      lightningSmallOrchestra(game,
        this.x + Math.random() * this.w, this.y + Math.random() * this.h,
        Math.cos(a6) * r6, Math.sin(a6) * r6, 0);
    }
    if (this.buffs.has(BuffType.RedLightning) && Math.floor(Math.random() * 10) === 0) {
      const a7 = Math.random() * Math.PI * 2, r7 = Math.random();
      lightningSmallOrchestra(game,
        this.x + Math.random() * this.w, this.y + Math.random() * this.h,
        Math.cos(a7) * r7, Math.sin(a7) * r7, 0xff3c3cff >>> 0);   // GetLightningColor(1122)
    }
    if (this.buffs.has(BuffType.Burning)) burnDustSpawn(6, 2, 0.75);                          // :1239-1250 无掷门
    if (this.buffs.has(BuffType.Frostburn) && Math.random() < 0.25) burnDustSpawn(135, 3, 0.5);      // :1253-1263
    if (this.buffs.has(BuffType.Frostburn2) && Math.random() < 0.25) burnDustSpawn(135, 3, 0.5);     // :1266-1276
    if (this.buffs.has(BuffType.CursedInferno) && Math.random() < 0.25) burnDustSpawn(75, 3, 0.5);  // :1279-1290
    // HurtTiles 接触伤害（Collision.cs:3128 + Player.cs:27296/28507）:
    // 尖刺/木尖刺/荆棘族直接伤害 + 流血,陨石/狱石族 Burning,沙族窒息,荆棘族触碰毁块。
    // 骑矿车时按坐骑盒采样（Mount.cs mounts[6]：玩家 hitbox 即车 20×52，
    // heightBoost 10——用 20×42 玩家盒会漏掉车底 10px,贴轨尖刺扫不到）
    const rideBox = this.ridingCart && this.cart
      ? { x: this.cart.x, y: this.cart.y, w: this.cart.w, h: this.cart.h }
      : null;
    // ★BJ704-G22（g20-buff305-firewalk 清偿）：buff305 熔岩鲨第四源（UpdateBuffs
    //  :9992-9998 `fireWalk = true`——陨石/狱石 TouchDamageHot 行走免伤;姊妹面
    //  lavaTotalImmune :5659-5662 同批同款）。Game.ts 海螺落点镜像消费
    //  （TeleportHelpers TileIsDangerous→CanTileHurt(player) 同读 player.fireWalk）
    //  缺同腿——Game.ts 争用禁触本批,登记 [g22-fw-conch-mirror] 一行未来刀。
    const fireWalkFx = eqM.fireWalk || this.buffs.obsidianSkin   // 黑曜石皮含 fireWalk（:9576）
      || (this.ridingMount && this.mount.buff === 305);   // ★BJ704-G22:buff305（mount 49,:9998）
    // ★SW-RB14a（F2）：微光化豁免整段接触伤（Player.cs:27818-27824 `if (!shimmering)
    //  { GetHurtTile… ApplyTouchDamage }`——GetHurtTile 是 HurtTiles 唯一玩家消费位,
    //  微光穿墙态原版尖刺/狱石/仙人掌全哑）。旧无门=微光态照吃接触伤,FX40-g 兜底
    //  清单扫描把暴露面又扩到上拍触碰格。
    let ht = this.shimmering ? null : hurtTiles(world.store, rideBox?.x ?? this.x, rideBox?.y ?? this.y,
      rideBox?.w ?? this.w, rideBox?.h ?? this.h,
      fireWalkFx,
      world.seedFlags); // ★IIIII224 仙人掌 theConstant/蜂蜜 ftw 触伤门（Collision.cs:3225）
    // ★SW-FX40（g·gd 无关新增）：TouchedTiles 兜底扫描（GetHurtTile :29182-29203）——
    //  HurtTiles 盒扫落空（type<0）时逐格扫上拍触碰清单：active ∧ nactive ∧
    //  非窒息族（:29192 埋沙另有窒息通道）∧ CanTileHurt。原版无盒重叠复检
    //  （清单来自本拍碰撞/探针,已含接触语义）。
    if (!ht && !this.shimmering) {
      for (const t of this.touchedTiles) {
        if (!world.store.inBounds(t.x, t.y)) continue;
        if (!world.store.hasTile(t.x, t.y)) continue;          // active()∧nactive()
        const tType = world.store.type[world.store.idx(t.x, t.y)];
        if (SUFFOCATE.has(tType)) continue;                    // :29192 !Suffocate
        if (canTileHurt(tType, fireWalkFx, world.seedFlags)) {
          ht = { type: tType, x: t.x, y: t.y };
          break;
        }
      }
    }
    if (ht) this.applyTouchDamage(game, ht);

    // ---- CheckDrowning 1:1（Player.cs:22914-23002，本地玩家门 = Main.myPlayer==whoAmI）----
    // 原版 flag = DrownCollision（Collision.cs:1385：头部盒判定，**蜂蜜也淹**，
    // 只排岩浆/微光——旧实现只认水是错的）
    let drown = drownCollision(world.store, this.x, this.y, this.w, this.h,
      this.gravDir === -1 ? -1 : 1);
    // 鱼缸头盔（armor[0]∈{250,4275}，:22917）：恒淹（戴着鱼缸无法呼吸）
    const headVid = (() => {
      const d = ITEM_DEFS[this.inv.armor[0]?.id ?? -1];
      return d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
    })();
    if (headVid === 250 || headVid === 4275) drown = true;
    // 芦苇管出水口（:22920-22945）：非挥舞中时采样头顶 44px 前偏 6px 格，
    // 该格液体<128 且非实心 → 不淹（管口在水面上）。原版整段 try/catch 吞越界
    if (this.hasBreathingReed && this.itemAnimTicks === 0) {
      const rx = Math.floor((this.x + this.w / 2 + 6 * this.facing) / TILE);
      const ry = Math.floor((this.y + (this.gravDir === -1 ? this.h : 0) - 44 * this.gravDir) / TILE);
      if (world.store.inBounds(rx, ry)) {
        const ri = world.store.idx(rx, ry);
        // ★G1谓词批(2026-09-04)：原版口格门= 裸 active()（Player.cs:23395
        //  `!tile.active() || !tileSolid[type] || tileSolidTop[type]`）——isActive 漏
        //  致动半边（已致动实心盖口会误判可换气）→ 改 hasTile;第二支 !tileSolid[type]
        //  是【类型表】读（与致动无关）,isSolid 排致动位会让已致动实心经此支漏气
        //  → 改 TILE_DEFS 实心位静态读（isPlatform≈tileSolidTop 支不变）
        const rt = world.store.type[ri];
        if (world.store.liquid[ri] < 128
          && (!world.store.hasTile(rx, ry) || !TILE_DEFS[rt]?.solid || world.store.isPlatform(rx, ry))) {
          drown = false;
        }
      }
    }
    // gills（:22946-22949）：普通世界免淹；ftw 种子（getGoodWorld）语义翻转——
    // flag = getGoodWorld && !flag（鱼鳃在 ftw 下反而水下不淹、水上淹）
    if (this.buffs.gills) drown = world.seedFlags.getGoodWorld ? !drown : false;
    if (this.shimmering) drown = false;  // :22950-22952 微光化不淹
    // mount.Type==4 海龟坐骑免淹（:22953）——坐骑系统已实装，接线
    if (this.ridingMount && this.mount.type === 4) drown = false;
    if (eqM.merman) drown = false;   // :23426-23431 accMerman→flag=false：装备即免淹
    // （merman 置位已移液态相位段 = 原版 :25774-25785 终态裁定块；此处旧置位
    //  按 :23428 早置位会被终态块 else 覆写，属冗余两写，2026-09-03 收敛单点）
    if (drown) {
      this.breathCD++;
      if (this.breathCD >= this.breathCDMax) {
        this.breathCD = 0;
        this.breath--;
        if (this.breath === 0) game.playSfx('drown'); // SoundID 23，恰减到 0 那轮播一次
        if (this.breath <= 0) {
          this.breath = 0;
          this.lastDamageCause = { kind: 'drowned' }; // PlayerDeathReason.ByOther(1)
          // statLife -= 2 直伤（1457 :23449）：不过防御/不吃无敌帧，不走 damage()
          this.hp -= 2;
          // X1 观战回体：SetOrRequestSpectating(-1)（1457 :23450——statLife 结算与
          // 致死判 :23452-54 之间逐拍调）。单机 netMode==0 两分支皆不进=纯 no-op
          // （SetOrRequestSpectating :17346-17375）；联机=退出观战相机+msg150 焦点帧，
          // spectating==-1 早退保证重拍零重发。
          game.askSpectateExit?.();
          if (this.hp <= 0) this.hp = 0; // KillMe(ByOther(1),10) :23452-54 交由下方统一死亡结算
        }
      }
    } else {
      this.breath = Math.min(this.breathMax, this.breath + 3); // :22995-23000 每 tick +3
      this.breathCD = 0;
    }
    // 溺水口部气泡尘（CheckDrowning 尾段 1458 :23473-23500）：drowning 且非岩浆/蜂蜜时
    // Next(20)==0 概率在口部出 Dust.NewDust(盒 w-8×8,d34,α0,scale 1.2)；芦苇管时移到
    // 管口上方 (-2dir,-58·gravDir)（mount 52/54 MouthPosition 分支本作无坐骑,省略）。
    // ★终零波批（2026-09-01）转正：旧"程序化圆浅蓝近似"退役——vanillaDust 池已
    // 在轨(d34=Bubbles 帧表),NewDust 盒内随机点位/±2 抖动速度/scale 逐字等价；
    // 缺池兜底保留程序粒子（裸测桩面）
    if (drown && !this.inLava && !this.inHoney && Math.floor(Math.random() * 20) === 0) {
      const num4 = this.gravDir === -1 ? this.h - 12 : 0;
      let mx = this.x + 12 * this.facing;
      let my = this.y + num4 + 4 * this.gravDir;
      if (this.hasBreathingReed) { mx += -2 * this.facing; my += -58 * this.gravDir; }
      const d = game.vanillaDust?.spawn(mx, my, this.w - 8, 8, 34, 0, 0, 0, null, 1.2);
      if (!d) {
        game.spawnParticles(mx + Math.random() * (this.w - 8), my + Math.random() * 8,
          '#BFE3FF', 1, 0.2, { life: 30, grav: -0.03, size: 2 });
      }
    }

    // ---- 眼睑状态机（PlayerEyeHelper.Update，Player.cs:25812 每 tick；死亡态不更新
    //      ——原版 dead 早退到 UpdateDead，无该链） ----
    if (!this.dead) {
      if (this._deathPartsInit) this._deathPartsInit = false;  // 重生复位（respawnPlayer 在 Game 侧）
      this.updateEyeState(game);
    }

    // 死亡等待重生（任何死法统一在此发声——溺水/岩浆/摔落/受击都经过这里）
    if (this.hp <= 0) {
      if (!this.dead) {
        playDeathVoice(game, this.voiceState);   // PlayDeathSound(:39013-39041,override 9 retro/5 铃/15 气球)
        this.dead = true;
        game.recLog?.('death', { hp: 0 });   // 行为录制：玩家死亡（任何死法统一在此结算）
        // ★F2（四轮蓝队）：直扣型致死站在此补齐完整死亡管线——原版它们都走
        // KillMe 家族（溺水 hp-=2→KillMe(ByOther(1),10) :23449-23455 / tongued DoT
        // 分块 KillMe(ByOther(7)/(8)/(12),10) :19142-19148 / 墙舌 >3000px、世界墙边
        // KillMe(ByOther(11)/(12),1000) :22507/:22511）。damagePlayer 族已在漏斗致死
        // 分支同步结算，settlePlayerDeath 幂等门防双计（非致死 tick 恒不到此=照旧零结算）。
        game.settlePlayerDeath?.(this.lastPvpDeath === true);
      }
      // 初速掷骰用独立标记：Game.damagePlayer 接触死路径会先直置 dead（Game.ts:15360）
      // ——不能拿 !dead 当 init 门；首 tick 只掷不推进（原版 KillMe 在 Hurt 中段置 dead，
      // 物理自下一 tick UpdateDead 起）
      // ★BJ400（2026-09-29）硬核幽灵自由飞行面（BJ397 邻接发现反向偏差立案）：
      //   原版 Player.Update :24938-24942 `if (ghost) { Ghost(); return; }` 先于
      //   dead 分支 :24943——ghost=true 起 UpdateDead 整体停摆（散飞冻结）,Ghost()
      //   （Player.cs:6714-6850）接管=自由飞行。旧码 hp≤0 早退贯穿 ghost 相=幽灵
      //   冻结原地（仅 ghostFrame 帧动画）=反向偏差。isGhostPhase=dead∧difficulty 2
      //   ∧respawnTimer≤0（hardcore 不重生,Game.respawnPlayer hardcoreDead 拒）,
      //   计时到点即入幽灵相。
      if (this.isGhostPhase(game.world)) {
        this.ghostFlight(game);
        return;
      }
      if (!this._deathPartsInit) {
        this._deathPartsInit = true;
        this.initDeathParts(game);      // KillMe :38287-38298 三段初速 + :39208 死亡尘爆（BJ595）
      } else {
        this.updateDeathParts(game);    // UpdateDead :16878-16888 翻滚解体
      }
      this.updateSunScorchValues(game);  // UpdateDead 尾（Player.cs:16928）：死亡档衰减 −2
      // 1457 UpdateDead 新增重置（Player.cs:17109-17110）：manaSick=false、manaHeat=1f
      // （新机制字段随死亡归零；1456 无此两行。本仓 manaSick=buff 载体 → 同步摘除）
      this.buffs.remove(BuffType.ManaSickness);
      this.manaHeat = 1;
      // ★X4-债3 清偿（2026-09-29）死亡相清非持久 buff（UpdateDead :17112-17117 1:1，
      //  判据=!Main.persistentBuff[v]，持久表=武器浸剂八族 {71,73-79} Main.cs:9337-9344
      //  ——黄金浸剂 72 不在内照清）。原版每帧跑同幂等清（UpdateDead 每帧经 :24945），
      //  本分支同每 tick 跑=同相；裸字段写零无音效/尘/飘字（表现=图标下帧消失）。
      //  幽灵相不走此路（上方 isGhostPhase 早退——原版 ghost 相 UpdateDead 停摆，
      //  buff 在死亡相已清空，UpdateBuffs 不跑=冻结）
      this.buffs.clearNonPersistent();
      this.slowMagicUse = false;
      // ShimmerUnstuckHelper.Clear()（UpdateDead :17041——脱困保护随死亡清零）
      this.shimmerUnstuckIndefinite = false;
      this.shimmerUnstuckTimeLeft = 0;
      // isPerformingJump_DownDash/downDashTime 随死亡清（UpdateDead :17040 + :24803 清零态
      //   ——★BJ534：否则死亡期残留态=重生落地误炸冲击波）
      this.isDownDashing = false;
      this.downDashTime = 0;
      // ★MV2（2026-10-06）债④：死亡相沿刷新照走——原版 UpdateDead :17185-17195 逐拍
      //   `releaseRight=!controlRight`（双击沿真值源不因死亡冻结;重生后沿相位与原版同）
      this.prevInputX = this.inputX;
      this.prevInputLeft = this.inputLeft; this.prevInputRight = this.inputRight;   // ★MV3 单键沿同源刷新
      return;
    }
    // UpdateSunScorch 调用点（Player.Update :25349，UpdateEquips(i) 后一行——
    // 本仓 fixedUpdate 中段，先于下方首个 equipStats 读取，等价原版
    // UpdateEquips→UpdateSunScorch→UpdateArmorSets 帧内序）
    this.updateSunScorch(game);

    // 水平（敏捷 Buff 提速 + 装备移速（赫尔墨斯靴族 runSpeed/词缀 73-76）；蜂蜜比水更黏滞）
    const eqEarly = eqM;
    // ---- 折叠凳（UpdatePortableStoolUsage :29425-29438（1456 :28727-28739）1:1；
    //      原版每 tick ResetEffects 清 IsInUse+ResizeHitbox 回 42 后按条件重长）----
    if (this.stoolInUse) { this.y += Player.STOOL_BOOST; this.h -= Player.STOOL_BOOST; this.stoolInUse = false; }
    // ★BJ249 补门（:29427 flag=HasAStool && controlUp && !gravControl && !mount.Active
    //  && v==0 && !pulley && grappling[0]==-1）：①!gravControl=重力药水（buff 18
    //  Gravitation）态禁凳——重力地球仪 1131 走 gravControl2 不在门内=不禁凳；
    //  ②!pulley=绳上悬挂态禁凳。时序同相：原版抓绳门（:26320）晚于本门（:25844）
    //  →读上一 tick pulley;本仓 findPulley（fixedUpdate :5047）同样晚于本块
    if (eqEarly.stepStool && this.inputUp
      && !this.buffs.has(BuffType.Gravitation)
      && !this.ridingMount
      && this.vx === 0 && this.vy === 0 && !this.pulley
      && !this.grappleProjs.some((g) => g.latched)
      && this.canFitSpaceUp(Player.STOOL_BOOST, world.store)) {
      this.y -= Player.STOOL_BOOST;
      this.h += Player.STOOL_BOOST;
      this.stoolInUse = true;
    }
    // 沙丘行者靴地板旗标（FloorVisuals :23434-23471 + GetFloorTile :23481-23509）：
    // vy==0 时取脚下一行的 x/x−1/x+1 首个 active+solid 格，属沙族地格即 runningOnSand
    // （TileID.Sets.Conversion Sand{53,112,116,234}/HardenedSand{397-399,402}/
    // Sandstone{396,400,401,403}，TileID.cs:30-34）。原版只在 vy==0 时刷新、离地不清零
    // （ResetFloorFlags 仅重生/传送调用）——空中保留加成，同语义
    if (this.vy === 0 && !this.grappling[0]) {
      // ★SW-FX40（h3）：门 !ridingCart → grappling[0]==-1（:28479 `if (velocity.Y == 0f
      //  && grappling[0] == -1) FloorVisuals(falling)`——原版坐骑矿车照跑 FloorVisuals
      //  （旗标面不豁免;只有 MakeFloorDust 内部 !mount.Cart 豁免尘 :23931),挂钩悬停
      //  (vy==0)才整段跳过。旧 !ridingCart = 矿车面全哑+挂钩面误跑,双面各偏一次。
      const floorR = this.readFloorTile(world);
      const ft = floorR.id;
      this.floorTileT = ft;
      this.runningOnSand = ft >= 0 && SAND_FLOOR_IDS.has(ft);
      // ★SW-RB14a（F3）：粪块地板恶臭 buff（FloorVisuals Player.cs:23921-23923
      //  `(num3==666||num3==712) && whoAmI==myPlayer → AddBuff(120,180)`——180t=3s,
      //  原序在坡面门/!wet 门之前=坡面粪块与湿身照挂;tile666/712=粪块族,dust 322
      //  同源）。旧缺=踩粪不臭。
      const preSheet = floorR.preSlopeId >= 0 ? TILE_DEFS[floorR.preSlopeId]?.vanilla?.sheet ?? -1 : -1;
      if (preSheet === 666 || preSheet === 712) this.buffs.apply(BuffType.Stinky, 3);
    }
    // 沙丘行者靴 1:1（Player.cs:26225-26231）：runningOnSand && desertBoots →
    // maxRunSpeed/accRunSpeed/runAcceleration/runSlowdown 全部 ×1.75（原版是乘区，
    // 非 ZoneDesert 门——曾按 zoneDesert+0.25 定值近似）。speedMult 同时乘加速与
    // 限速 = 前三者的复合；runSlowdown ×1.75 以摩擦指数 1.75 等价（乘法摩擦下
    // 每帧减量 ∝ 1−f^n）
    const duneBoost = eqEarly.desertBoots && this.runningOnSand;
    // 1457: 移动减速 debuff 折算 strongestMoveSpeedDebuff（Update :26204-26210
    // moveSpeed *= strongestMoveSpeedDebuff → runAcceleration/maxRunSpeed 随之）——
    // 取最强单项不叠加（1456 else-if 乘法链在 Buffs.moveSpeedMult，已迁出）
    // D2（2026-08-21）：盾举并入（:26155-26162 shieldRaised → min(1/3)）——Buffs
    // getter 无 Player 访问,在此合成（maxRunSpeed getter :3816 同式）
    const strongestSlow = Math.min(this.buffs.strongestMoveSpeedDebuff, this.shieldRaised ? 1 / 3 : 1);
    // 1457 :26156-26161 盾举侧效：地面(vy==0)且 |vx|>3 → vx 每帧减半（Update 段、
    // 无 dashDelay 门——冲刺滑行期举盾同样制动）。原版盾举态每帧 Update 重算
    if (this.shieldRaised && this.vy === 0 && Math.abs(this.vx) > 3) this.vx /= 2;
    // 巨魔唾液 197 地面侧效（Player.cs:26133-26135：vy==0 且 |vx|>1 → vx 每帧减半
    // ——strongestSlow ×1/3 已由 buffs.strongestMoveSpeedDebuff 承担,此半支独立）
    if (this.buffs.has(BuffType.OgreSpit) && this.vy === 0 && Math.abs(this.vx) > 1) this.vx /= 2;
    // ★BJ474（2026-10-03）：`(inHoney ? 0.5 : 1)` 自造因子撤除——原版 maxRunSpeed/
    // accRunSpeed 全链无任何 wet 因子（reset :24096-24099/moveSpeed 乘区 :25694-25695/
    // 装备链 :26184-26300），蜜减速全在位移积分层 WetCollision movementSpeed（:28380
    // 蜜 0.25/水 0.5——本仓 liqFactor 段 1:1 承载,见移动相尾）。残留因子曾把蜜中
    // maxRun 半缩而 accRun 不缩 → spawnFastRunParticles 尘门带 (accRun+maxRun)/2 由
    // 干地空带 [3,3) 张开为 (2.25,3) → 翼支 dust 186（用户 Red's Wings+绿染翼槽=
    // 绿叶色）/靴支尘+脚步声在蜜中误触发=「蜂蜜中跑动绿叶尘」全案根因
    // （真机探针 2026-10-03:用户存档+角色实录 1826/1826 全 inHoney 侧,干地零发）。
    // 判别测试 tests/bj474-liquid-run-dust-third.test.ts
    const speedMult = this.buffs.moveSpeedMult * eqM.moveMult
      * (this.vortexStealthActive ? 0.3 : 1)   // 星璇潜行移速 ×0.3（1457 Player.cs:26046-26047
                                              // vortexStealthActive 全程生效,无 stealth 门——
                                              // 旧 `&& stealth>0` 系 0/1 语义反写期产物,满潜行
                                              // 后移速惩罚反而消失,1456 :25563-25564 同无门）
      * (duneBoost ? 1.75 : 1)
      * strongestSlow
      * runModPlayerModifyMoveSpeed(this, (globalThis as { __swGame?: unknown }).__swGame);   // ★B/C 批:ModPlayer 移速乘区(空表=1)
    // 冰冻 Frozen(47,Player.cs:9749 frozen=true) ∪ 微光化 buff 353（:11381-11388
    // frozen=true 同语义）：整帧封移动输入——跳跃/攀绳/矿车同读这些标志,一并归零
    // （原版 Update 段 control* 清零语义,发生在移动积分之前）。帧末由 Game 重灌输入。
    // ★必须在水平积分（下方 const ix = this.inputX 消费点）之前执行：矿车/装备聚合
    // 重写曾把清零挪进 else-if 链的 shimmering 物理分支（位于积分之后）——清零形同
    // 虚设,微光中仍可自由行走（2026-08 回归）
    // ★MV2（2026-10-06）债②清偿：补 webbed 腿——原版 CCed（:3361-3372 frozen∨webbed∨
    //    stoned）在本段（:25432-25446）清全控制面并强制 gravDir=1f。旧缺 webbed 腿
    //    （jump/移动键残留）且漏 controlLeft/Right 两布尔（滑行火花/门助手读它们）。
    //    shimmering 腿=原版 buff 353 置 frozen 旗经 CCed 生效（SW-FX52 判例同源）。
    //    gravDir=1f 位次在重力总闸 updateGravityControls（:26892 forcedGravity 支）
    //    之前=FTW 克脑仍可覆写 -1,与原版 :25445→:26894 同序。
    if (this.buffs.has(BuffType.Frozen) || this.shimmering || this.buffs.has(BuffType.Stoned)
      || this.buffs.has(BuffType.Webbed)) {
      // 石化(156)与冰冻同段清输入（:24942 control* 清零——石化还额外清 useItem/useTile,
      // 我们输入模型只有四键,同 frozen 处理）
      this.inputX = 0; this.inputJump = false; this.inputUp = false; this.inputDown = false;
      this.inputLeft = false; this.inputRight = false;      // :25434-25435 controlLeft/Right
      this.gravDir = 1;                                     // :25445 gravDir = 1f
    } else if (this.buffs.has(BuffType.Confused)) {
      // 困惑(31)：控制轮换（Player.cs:24683-24690 字面复刻,含原版 Up←交换后Right 的
      // 怪癖——flag2=L,flag3=Up; L=R; R=flag2; **Up=R(新)**; Down=flag3）
      const wasLeft = this.inputX < 0, wasRight = this.inputX > 0;
      const wasUp = this.inputUp;
      const newRight = wasLeft;
      this.inputX = wasRight ? -1 : newRight ? 1 : 0;   // L←R / R←L
      this.inputUp = newRight;                          // Up←R(新)（原版怪癖同款）
      this.inputDown = wasUp;                           // Down←Up
      // ★MV3（2026-10-07）债⑤配套：布尔面同轮换（1457 :25190-25196 `controlLeft =
      //   controlRight; controlRight = flag2`——仓内注释旧引 :24683-24690 为 1456 行号）
      //   ——inputLeft/inputRight 是 controlLeft/Right 同源位（MV2③ 出口臂、MV3 双击
      //   沿、滑行回弹臂 :21287-21289 均读布尔），缺轮换=困惑期布尔面与合值面分叉
      //   （旧布尔恒物理键，困惑期读布尔的消费面与原版读轮换后 control 面反向）。
      const flMV3 = this.inputLeft;
      this.inputLeft = this.inputRight;
      this.inputRight = flMV3;                          // L↔R 布尔轮换（:25193-25194）
    }
    // ★SW-RB11f F1/F2：重力倒置总闸调用点迁入（原版位序 = CCed 清输入 :25436 →
    //   hover 锁存 :25452 → 翻转门 :26892 → UpdateControlHolds 末拍快照 :29324-29331；
    //   原版 `if (dead)` :24943 早退于翻转门前 → 死亡态不翻不写）。旧位在
    //   Game.fixedUpdate 读冻结/困惑换位【前】的裸 inputUp = 冻结/石化/困惑态可翻转
    //   （F2），且 Game.gravLatch 只清不置 → upEdge 退化电平、按住↑每拍翻转（F1）。
    //   本位与 hover 锁存共用同一 prevTickUpHeld 快照（= 原版同帧同 releaseUp 读数，
    //   快照仍由 updateHoverLatch 末尾单点更新）。
    if (!this.dead) {
      updateGravityControls(
        this, this.inputUp && !this.prevTickUpHeld,
        (n, v, x, y) => game.playSfx(n, v, x, y),
      );
    }
    // 悬停锁存更新（★SW-FX14 Player.cs:25452-25484——原版位序在 CCED 清输入段
    // 之后、移动积分之前；此时 inputUp/Down 已定格（冻/惑清零与换位 quirk 均在
    // 上方），vy 为上一拍碰撞末速 = 原版 Update 中段读取语义）
    this.updateHoverLatch();
    // 石化变身瞬间（1457 :25414-25431 stoned != lastStoned 过渡）：Hurt(ByOther(5),
    // 20×敌伤倍率) + SoundID 0（Dig 碎裂档）+ 20 尘。死因 = DeathText.Petrified_1..4。
    // ★F3（四轮蓝队）：原版此处即 !quiet Hurt 形（无静默参的默认调用）→ 走通用漏斗，
    // 防御/难度系数/endurance/神秘腰布·黑带·克脑闪避族/msg117 全随漏斗生效；受击语音
    // 与本地飘字由漏斗单点承载——删旧手补 playHurtVoice（闪避早退时旧路径照样喊=
    // 双发/错发）、飘字以 damagePreview 预演回填。hitDirection=0 ⇒ kb=false 原式。
    // 尘在原文是【过渡无条件】段（双向都发）——搬出 stoned 支对齐；碎裂声
    // SoundEngine.PlaySound(0,x,y)（:25417,原版序=Hurt→Sound→尘）同为无条件段。
    // ★B2①（2026-08-31）：legacy 案号 0=Dig 三变体（LSP.cs:443-458 Next(3) 择轨 +
    // Next(-10,11)×0.01 音高抖动）↔ public/sounds/Dig_{0,1,2}.wav 别名在映射表就位
    // （WAV_MAP.dig / Sfx PITCH rng('Dig_',0,2) 先例），接真名直播——旧「别名未建模
    // 登记待接入」状态退役，两态取证=择【接真名】支。
    {
      const stonedNow = this.buffs.has(BuffType.Stoned);
      if (stonedNow !== this.lastStoned) {
        if (stonedNow) {
          const dmg = getAttackDamageScaledByDifficulty(20, mainDifficulty(game.world));
          this.lastDamageCause = { kind: 'petrified' };
          this.envHurtThroughFunnel(game, dmg, this.cx, this.cy - 10, -1, this.damagePreview(dmg));
        }
        game.playSfxFiles?.(['Dig_0', 'Dig_1', 'Dig_2'], 1, this.cx, this.cy);   // ★B2① :25417（case0 抖动表内建）
        game.spawnParticles(this.cx, this.cy, '#9A8FA0', 20, 2.2);   // :25422-25429 尘×20
        this.lastStoned = stonedNow;
      }
    }
    // 睡中移动/跳跃/下移/上坐骑输入 → 起床（SH:103-105 controlLeft/Right/Up/Down/
    // Jump/pulley/mount → StopSleeping；须在物理锁【之前】判，睡中不响应移动）
    if (this.sleeping
      && (this.inputX !== 0 || this.inputJump || this.inputUp || this.inputDown
        || this.ridingMount)) {
      this.sleeping = false;
    }
    // ---- ★BJ704-G5（R4-P2①/R4-P2②）毯复位触发域归位 + 毯展开位（vanilla
    //      :26300-26311,Update 内每拍门,先于 JumpMovement(:26945)/CarpetMovement
    //      (:26967)）：`if (!carpet) canCarpet=false; else if (vy==0||sliding)
    //      { canCarpet=true; carpetTime=0; }`。旧位=干支 onGround 门/湿支 vy===0 门
    //      （分支内,BJ699 只修值未扩域）：漏撞顶拍（vy==0 且 !onGround）、贴墙滑拍
    //      （sliding≙wallCling,原版 :26305 同读上拍值）、悬停坐骑贴地拍（vy==0 恒不
    //      置 onGround——mount hover 免疲劳贴地臂）、坐睡/矿车早退支与 !carpet 拍拍
    //      清（卸毯 canCarpet 残留）。本位先于坐睡/矿车早退与同拍激活链（原版序
    //      :26300 → :26967）→ 落地拍激活/坐睡复位照常。
    //      carpetFlying（≙ carpetFrame>=0「本拍在展开」,R4-P2②）同位每拍先清,
    //      毯姿门由此单一真源（旧渲染门 !onGround&&carpetTime>0 的余油/卸毯残留窗
    //      退役,Renderer 腿 0/身 6 门改读本位）。 ----
    // ★BJ717-A F2（2026-10-25）：carpetFramePrev=上一拍毯展开位快照——vanilla 横移
    //   加速消费位（:26813 `if (carpetFrame != -1)`）在 CarpetMovement(:26967)【前】
    //   跑=读上一拍 carpetFrame；本仓 carpetFlying 每拍头清+垂直链置位,运动参数链
    //   （本拍头）读清后值恒 false——快照位让参数链读到上一拍展开态≙原文（oracle
    //   S6:carpet 激活次拍起 maxRun=4.5/runAcc=0.1,vx 收敛 4.58）。
    this.carpetFramePrev = this.carpetFlying;
    this.carpetFlying = false;
    if (!eqM.carpet) this.canCarpet = false;
    else if (this.vy === 0 || this.wallCling) { this.canCarpet = true; this.carpetTime = 0; }
    // 坐椅/睡床（isLockedToATile Player.cs:3858-3868）：重力/常规移动锁死——velocity
    // 恒 0（原版坐/睡态不跑 SlopingCollision 输入侧；锚点钉在座位/床锚）。buff/液体/
    // 受伤照常。★sleeping 曾漏在条件外——睡中重力/移动链照跑（按方向键"边睡边走"）
    if (this.sitting || this.sleeping) {
      this.vx = 0; this.vy = 0;
      this.onGround = true;
      if (this.sitting) this.sitTicks++;
      // ★Q4 刀 2026-09-30（BJ413 AFK 自动风筝）：:25705-25710 petting/sitting/
      // sleeping 逐拍清 afkCounterForKiting——本仓坐/睡态 fixedUpdate 在此整体早退
      // （AFK 步进块 :7613 不可达）⇒ 清零面在早退位补齐,防「坐下前 kite 计数已满
      // → 起身次拍即触发自动放风筝」（原文坐/睡不步进两计数且 kite 计数逐拍归零）。
      // afkCounter 坐/睡冻结 vs 原文照步（站立即步）= 本仓早退结构既有偏差,登记不接。
      this.afkCounterForKiting = 0;
      // ★MV2（2026-10-06）债④：坐/睡拍沿刷新照走——原版坐睡不早退 Update（:25708/
      //   :26326 处理后直落 :27827-27855 releaseLeft/Right 无条件刷新）
      this.prevInputX = this.inputX;
      this.prevInputLeft = this.inputLeft; this.prevInputRight = this.inputRight;   // ★MV3 单键沿同源刷新
      this.updateRopeKeyTimers();   // ★BJ-C8：坐/睡不早退原版 Update,直落 :27832-27862 timer 尾写
      return;
    }
    // 矿车骑乘（mount.Cart 语义）：移动/跳跃/重力/碰撞全部由 Minecart 实体接管
    //（原版 Player.Update :27783-27850 的 TrackCollision 段替代常规移动链）。
    // 上面的 buff/液体/受伤逻辑照常 tick；位置每 tick 由矿车回写。
    // ★肉山舌头对骑乘者同样生效（vanilla :28384 tongued 积分为 Update 顶层分支,
    //   骑矿车可达——矿车桥拽回是肉山战经典形态;曾整体早退=骑乘者永不上舌不拽,
    //   2026-09-02 评审补）。先清速度再跑舌头段:防上舌 tick 陈旧矿车速度混入。
    if (this.ridingCart) {
      this.vx = 0; this.vy = 0;
      this.wofTongue(game, world, dt);
      if (this.buffs.has(BuffType.TheTongue)) {
        // 拖拽穿墙：消费上帧拖速（与步行段 tongued 旁路同构,vanilla 同一积分分支）；
        // 矿车本 tick 让位（Minecart.fixedUpdate 头同门禁：位置权威=玩家,车随人）
        this.x += this.vx;
        this.y += this.vy;
        this.fallStartY = null;
        this.prevInputX = this.inputX;   // ★MV2 债④：矿车拍沿刷新照走（:27827 无条件）
        this.prevInputLeft = this.inputLeft; this.prevInputRight = this.inputRight;   // ★MV3 单键沿同源刷新
        this.updateRopeKeyTimers();   // ★BJ-C8：矿车拍 :27832-27862 timer 尾写照走
        return;
      }
      this.onGround = true;
      this.fallStartY = null;
      this.pulley = false;   // mount.Active → pulley=false（:25815-25818——早退路径
                             // 跳过下方维护段，此处直清防下车残留悬挂态）
      // ★MV2（2026-10-06）债④：矿车拍沿刷新照走——原版矿车 TrackCollision 段后仍直落
      //   :27827-27855（releaseLeft/Right 无条件刷新）;旧冻结=车拍按压→下车后幽灵双击沿
      //  （原版沿已在车拍被 :21579 早退消费+dashTime 清零）。
      this.prevInputX = this.inputX;
      this.prevInputLeft = this.inputLeft; this.prevInputRight = this.inputRight;   // ★MV3 单键沿同源刷新
      this.updateRopeKeyTimers();   // ★BJ-C8：矿车拍 :27832-27862 timer 尾写照走
      return;
    }
    // ---- 非矿车坐骑每 tick 维护（Mount.cs 1:1）----
    // 能量/疲劳恢复 + 地面飞行时量回充（:26538 ResetFlightTime）+ hover 起始
    //（:26416）+ 帧态机分派（:35745-35790）。冻结/石化/蛛网控场强制下坐（:26556）
    if (this.ridingMount) {
      // ★BJ704-G12（G5 登记债2）：补 shimmering 腿——原版 CCed 臂（:27000-27004
      //   `if (CCed) { if (mount.Active) mount.TryDismount(this); … }`）的 CCed=
      //   frozen∨webbed∨stoned（:3361-3372）,而 buff 353 同时置 shimmering+frozen
      //   （:11872-11875）⇒ 微光化骑乘者同拍强制下坐（SW-FX52 判例:仓内 buff 353
      //   只写 shimmering 字段,故此集补 shimmering 而非 Frozen buff）。旧缺=骑乘
      //   形变者保持骑乘（0.9 重力穿落≈原版 CCed 臂但绕过下坐）。
      //   ★BJ704-G13（G12 登记债2 清偿）：直调 dismount → TryDismount 双闸
      //   （CanDismountWithResult :6682-6696）——DontDismountWhenCCed{55,56,61}
      //   豁免（CCed 中拒下坐,MountID.cs:29）+ 20×42 无空间拒;拒下坐时 Dismount
      //   体内效果（petting 终止 :6228-6231 / ClearBuff :6214）一并不发生（原版
      //   在 Dismount 内=仅成功路径）。拒下坐骑者（变身骑族）继续骑乘,且下方
      //   维护段照跑——原版 UpdateEffects :25855/ResetFlightTime :26976/UpdateFrame
      //   均只挂 mount.Active 无 CCed 门（tryStartHover 的 controlUp 已被 CCed
      //   清零段 :25432-25442 压掉=不可达,零行为差）。
      if (this.buffs.has(BuffType.Frozen) || this.buffs.has(BuffType.Stoned) || this.buffs.has(BuffType.Webbed)
        || this.shimmering) {
        if (this.mount.canDismount(this)) {
          // 坐骑抚摸随下坐终止（Mount.Dismount :6229-6231 petting.mount → Stop）
          if (this.petting.mount) this.stopPettingAnimal();
          // ★BJ357 清坐骑伴生 buff（Dismount :6214 ClearBuff）——id 先于 dismount 捕获
          //  （reset() 后 mount.data 已 null）;Game.tryDismountMount 强制链同式
          const prevBuff = buffTypeByVanilla(this.mount.data?.buff ?? -1);
          this.mount.dismount(this, game);
          if (prevBuff !== undefined) this.buffs.remove(prevBuff);
        }
      }
      if (this.ridingMount) {
        // ★BJ703-D1 Mount.UpdateAfterEquips 54 臂（调用位=UpdateEquips 尾 Player.cs
        //  :13198,先于同拍 ResetFlightTime/飞行链）——allowedToFly 闩读【清翼前】
        //  wingsLogic:原版序 = UpdateEquips 头 :15716 置 wingsLogic → 尾 :13198 本调
        //  读 → :26834 骑 !CanUseWings 族才清零,故传 eq.wing 原值（勿传飞行链清零后
        //  局部量,后者恒 0 = 闩永不置位）。wingTimeMax=装备翼 FlyTime;徽章=4989。
        const eqAE = this.equipStats;
        this.mount.updateAfterEquips(
          eqAE.wing ? eqAE.wing.logic : 0,
          eqAE.wing ? eqAE.wing.time : 0,
          eqAE.empressBrooch,
        );
        this.mount.upkeep(this);
        // 能力维护（Player.cs:25373 UpdateEffects 能力子集）：猪鲨崽计数器/增益 +
        // Scutlix 索敌-充能-开火。须在 upkeep 后、hover 消费前（fishronBoost 本 tick 新鲜）
        this.mount.updateMountEffects(this, this.mountEffectsCtx(game));
        // 成就：RAINBOWS_AND_UNICORNS（Mount.UpdateEffects case 10 独角兽 Mount.cs:5013-5016：
        // `itemAnimation > 0 && inventory[selectedItem].type == 1260 → HandleSpecialEvent(5)`
        // ——骑独角兽持彩虹枪使用帧；本 call 位 = updateMountEffects（UpdateEffects
        // 等价）同 tick 点。playerInteraction 门无——Mount 侧直发
        if (this.mount.type === 10 && this.itemAnimTicks > 0) {
          const held = this.inv.heldItem();
          const hv = held ? (ITEM_DEFS[held.id]?.vid ?? -1) : -1;
          if (hv === 1260) {
            game.achievements?.handleSpecialEvent(5,
              { statLifeMax: this.maxHp, statManaMax: this.maxMana });
          }
        }
      }
    }
    const ix = this.inputX;
    // ---- pulley 绳索悬挂（Player.cs:26320 调用点 `!pulley && !CCed && !controlJump
    //      && gravDir==1 && ropeCount==0 && grappling[0]==-1 && !tongued &&
    //      !mount.Active` + :26328+ 状态机的可达子集）。★⑩ 台账清偿（2026-08-31）：
    //      !controlJump 门补齐——本仓 inputJump = Space ∪ Up（Game.ts 输入合成），
    //      controlJump 的仓内等价谓词 = inputJump 且非 Up（inputUp 独立读 ↓ 与 ↑），
    //      按住 Space 不再吸附进绳态、按住 W/↑ 进态不受影响；tongued=狂卷之舌 buff 38 ----
    if (this.ropeCount > 0) this.ropeCount--;                            // :26314-26317
    const ccPulley = this.buffs.has(BuffType.Frozen) || this.buffs.has(BuffType.Stoned)
      || this.buffs.has(BuffType.Webbed);
    const jumpOnlyHeld = this.inputJump && !this.inputUp;   // ≙ controlJump（键面分离近似）
    if (!this.pulley && !ccPulley && !jumpOnlyHeld && this.gravDir === 1 && this.ropeCount === 0
      && !this.grappling[0] && !this.buffs.has(BuffType.TheTongue) && !this.mount.active) {
      this.findPulley(world.store);                                      // :26320
    }
    if (this.pulley) {
      if (this.mount.active) this.pulley = false;                        // :26326-26328 上坐骑即离绳
      const num29 = Math.floor((this.x + this.w / 2) / TILE);            // :26331 头心列（num31）
      const num30 = Math.floor((this.y - 8) / TILE);                     // :26332 头格行（num32）
      // ★BJ-C8（R7-F1）flag12 状态机（:26338-26392）+flag14 绳列滑行支（:26406-26444）
      //   +离绳门收窄（:26445-26456）——旧「持左右键即离绳+inputX 翻面」整支退役。
      //   沿/计时器真值源：releaseLeft/Right ≙ !prevInputLeft/Right（MV3 同源,
      //   :27833-27845 逐拍尾刷新）、leftTimer/rightTimer=原版 8 拍再触发计时器
      //   （updateRopeKeyTimers 同址尾写）。净语义：居中档（pulleyDir=1）横按=转身/
      //   侧挂（flag12）不离绳；侧挂档（pulleyDir=2）同向持键=滑行（绳在前,flag14）
      //   或静挂；离绳仅「侧挂档+朝向侧按下沿+前方无绳」可达（:26445 三重前置门）。
      //   ★原版序：状态机/滑行/离绳先于 vx≠0/头格/gravDir/CC/抓钩各清除位。
      if (this.pulleyDir === 0) this.pulleyDir = 1;                      // :26339-26341 首帧归一
      let flag12 = false;
      let flag14 = false;
      if (this.pulleyDir === 1) {                                        // :26343
        if (this.facing === -1 && this.inputLeft
          && (!this.prevInputLeft || this.leftTimer === 0)) {
          this.pulleyDir = 2; flag12 = true;                             // :26345-26349 左侧挂
        } else if ((this.facing === 1 && this.inputRight && !this.prevInputRight)
          || this.rightTimer === 0) {
          this.pulleyDir = 2; flag12 = true;                             // :26350-26354 右侧挂（★timer==0 项无方向/按键门=原版不对称,照抄）
        } else {
          if (this.facing === 1 && this.inputLeft) { this.facing = -1; flag12 = true; }   // :26356-26360 转身
          if (this.facing === -1 && this.inputRight) { this.facing = 1; flag12 = true; }  // :26361-26365 转身
        }
      } else if (this.pulleyDir === 2) {                                 // :26369
        if (this.facing === 1 && this.inputLeft) {                       // :26370-26379 向绳侧回中
          flag12 = true;
          if (!this.solidCollision(world.store, num29 * TILE + 8 - this.w / 2, this.y)) {
            this.pulleyDir = 1; this.facing = -1;
          }
        }
        if (this.facing === -1 && this.inputRight) {                     // :26381-26390
          flag12 = true;
          if (!this.solidCollision(world.store, num29 * TILE + 8 - this.w / 2, this.y)) {
            this.pulleyDir = 1; this.facing = 1;
          }
        }
      }
      // num33/flag13（:26392-26405）：CanMoveForwardOnRope(:24439-24458) 只喂
      //   instantMovementAccumulatedThisFrame（Main.cs:47870 秒表读数消费）——
      //   本仓秒表无绳桥贡献,略（R7-C8 登记）。num33 语义照抄（左优先）。
      if (!flag12 && ((this.inputLeft && (!this.prevInputLeft || this.leftTimer === 0))
        || (this.inputRight && (!this.prevInputRight || this.rightTimer === 0)))) {
        const num33 = this.inputLeft ? -1 : 1;                           // :26392-26396
        const num34 = num29 + num33;                                     // :26409 前方格
        if (this.isRopeAt(world.store, num34, num30)) {                  // :26410 前方为绳→滑行
          this.pulleyDir = 1;                                            // :26412
          this.facing = num33;                                           // :26413
          let num35 = num34 * TILE + 8 - this.w / 2;                     // :26414 目标 x
          const y2 = num30 * TILE + 22;                                  // :26416 y 钉（:26425-26428 条件重赋值=同值 no-op,略）
          if (this.solidCollision(world.store, num35, y2)) {             // :26429-26434 碰撞回退
            this.pulleyDir = 2;
            this.facing = -num33;
            num35 = num34 * TILE + 8 - this.w / 2 + (this.facing === 1 ? 6 : -6);
          }
          this.x = num35;                                                // :26439（cameraX 平滑本仓无载体,登记）
          this.gfxOffY = this.y - y2;                                    // :26440
          this.y = y2;                                                   // :26441
          flag14 = true;
        }
      }
      // 离绳支（:26445-26456）：!flag14∧!flag12∧!controlUp∧按下沿（releaseLeft/Right
      //   单项,无 timer==0 项）——vx==0 才给 ±1 离绳推量
      if (!flag14 && !flag12 && !this.inputUp
        && ((this.inputLeft && !this.prevInputLeft)
          || (this.inputRight && !this.prevInputRight))) {
        this.pulley = false;
        if (this.inputLeft && this.vx === 0) this.vx = -1;               // :26448-26451
        if (this.inputRight && this.vx === 0) this.vx = 1;               // :26452-26455
      }
      if (this.vx !== 0) this.pulley = false;                            // :26457-26460 击退/横移即离（★位次=状态机后,原版序）
      if (!this.isRopeAt(world.store, num29, num30)) this.pulley = false; // :26465-26468 头格脱绳
      if (this.gravDir !== 1) this.pulley = false;                       // :26469-26472
      if (ccPulley) this.pulley = false;                                 // :26473-26476
      if (this.grappling[0]) this.pulley = false;                        // :26488-26491 抓钩优先
      if (this.pulley) {
        // X 钉绳列（:26653-26661）：pulleyDir 1=列中心、2=中心+6·direction——
        //   列号按【当前】x 复算（flag14 滑行已改 x,上方 num29 是滑前值）
        let num39 = Math.floor((this.x + this.w / 2) / TILE) * TILE + 8 - this.w / 2;
        if (this.pulleyDir === 2) num39 += 6 * this.facing;
        this.x = num39;
      }
    }
    // :19546-19556 门：itemAnimation 窗内仅 useTurn 物品允许移动改朝向
    // （动画窗代理 = itemAnimTicks>0 || useTime>0——非挥砍武器以 useTime 计窗）
    const animBusy = this.itemAnimTicks > 0 || this.useTime > 0;
    // Scutlix/Santank 瞄准中锁朝向（Player.cs:19549 flag3 的 AllowDirectionChange 门；
    // 声明在冲刺分支外——滑行段的改向门同样消费）
    const mountAllowDir = !this.ridingMount || this.mount.allowDirectionChange;
    // ★BJ704-G16（G15 登记债⑥）：sandStorm 位仓内承载（vanilla Player.sandStorm :1093
    //   置位=DoubleJumpVisuals :22099（isPerformingJump_Sandstorm ∧ hasJumpOption ∧
    //   !canJumpAgain ∧ 上升中）每拍;清位=拍首 :26944/翼或骑乘 :26971/CCed :27011/
    //   上绳 :26334）。有效窗口=沙暴瓶跳【上升段】且无翼无坐骑（:26971 清位门——
    //   wingsLogic>0 为装备面值（:26834 骑乘清零在其后）≡ eqM.wing 真值）。消费面:
    //   ①run 加速 :26773-26777（runAcceleration×1.5/maxRunSpeed×2——沙暴瓶跳横移
    //   翻倍 = 瓶族机动面核心）;②转向门 :19965（!sandStorm——沙暴跳中不可转身）。
    //   残余登记:上绳/挂爪/瓶卸装 mid-jump 清位面未建模（超窄边例）;暴雪/屁瓶
    //   邻行加速（:26779-26787,×3/×1.5·×1.75——isPerformingJump_* 门,非本债面）
    //   另册登记债。视觉旋面（:36577 4tick 自翻+:36839 帧 6）=渲染域,备案。
    //   ★BJ704-G19（G16 债②③清偿,2026-10-21）：上三行残余就此清账——窗口勘正
    //   （isPerformingJump_Sandstorm 在 :26953 `jump==0 → CancelAllJumpVisualEffects`
    //   收口 ⇒ 沙暴位同受 jump 窗口辖,旧实现持续到落地=减速尾多跑数十拍）+
    //   挂爪（PlayerFrame :36578-36580 grapple 清位）/:26334 上绳/瓶卸装
    //   （hasJumpOption ≙ jumpOpts 实时含瓶）三清位面入闩;4tick 自翻落
    //   fixedUpdateBody 尾;视觉经 sandStormVisual 持久位同窗。
    const sandStormActive = this.performingJump === 'Sandstorm'
      && this.vy * this.gravDir < 0 && !eqM.wing && !this.ridingMount
      && eqM.jumpOpts.includes('Sandstorm') && this.jumpHold > 0
      && !this.grappling[0] && !this.pulley;
    // ★BJ704-G19：vanilla sandStorm 字段的视觉/自翻消费位（每拍移动相头持久;
    //   Renderer 腿 0/身 6 与 fixedUpdateBody 尾 4tick 自翻同读=窗口一致）。
    this.sandStormVisual = sandStormActive;
    // pulley 悬挂期 HorizontalMovement 整段不跑（Player.cs:26889 在 pulley else;1456 伪锚 :26366 勘正
    // 分支内）——朝向翻转归 flag12 状态机（★BJ-C8 F1：转身 :26356-26365/侧挂回中
    // :26369-26392,移动相 pulley 块内;下方空支仅承载分派）
    // ★SW-FX47（e）：jumpSpeed 字段前置快照（原版序 = UpdateJumpHeight :19714 经
    //  :26211 调用位【先于】HorizontalMovement :26889——弹跳臂 :19912 消费当拍
    //  值）。本仓跳参链原在物理相（:4853 写）=弹跳臂读上拍值,FX40-e 一拍滞后备案
    //  项就此清偿：移动相头按同一 base 公式（jumpBaseSnapshot 单源）重写字段,
    //  vx 用移动【前】值（原版 :26211 在 HorizontalMovement 前读 velocity.X 同序）。
    //  honey/dazed 两尾削弱（UpdateJumpHeight :19759-19768 尾段,坐骑赋值【后】）
    //  照原文随快照;湿档覆写对弹跳臂不可达（坐骑 43 非叠加档,mount.JumpSpeed
    //  赋值覆盖湿值 :19755-19756）故不进快照。
    {
      const jb0 = this.jumpBaseSnapshot(this.vx);
      let jsPre = jb0.spd;
      if (this.floorTileT === HONEY_FLOOR_ID) jsPre /= 5;      // :19759-19763 sticky（jumpSpeed/=5 :19762）
      if (this.buffs.has(BuffType.Dazed)) jsPre /= 2;          // :19764-19768 dazed（jumpSpeed/=2 :19767）
      this.jumpSpeedField = jsPre;
    }
    // ★SW-FX40（e·gd=1 新增行为 + gd=-1 倒挂 quirk）：坐骑 43 弹跳座（PogoStick）
    //  自动弹跳臂（HorizontalMovement 头 :19909-19921）——横向输入∧贴地(vy==0)∧
    //  未持跳 → 播 Item168 + vy=-(max(jumpSpeed·gravDir·0.5, 2)+0.01) + jump=jumpHeight
    //  + fullRotation=0 + HorizontalMovement 余段整段 return。★倒挂 quirk：gd=-1 时
    //  num3=jumpSpeed·(-1)·0.5<2 → 钳 2 → vy=-2.01（向上顶进天花板侧而非向下弹,
    //  原文照单全收）。jumpSpeed=玩家字段（:19912）——★SW-FX47（e）起读当拍前置
    //  快照（上方）,坐骑变档拍不再滞后一拍。
    //  命中拍跳过 dashDelay/ix 朝向两分支（:19921 return 语义）。
    let pogoFired = false;
    if (!this.pulley && this.inputX !== 0 && this.ridingMount && this.mount.active
      && this.mount.type === 43 && this.vy === 0 && !this.inputJump) {
      game.playSfxFile?.('Item_168', 1, this.cx, this.cy);            // :19911 SoundID.Item168
      let num3 = this.jumpSpeedField * this.gravDir * 0.5;            // :19912
      if (num3 < 2) num3 = 2;                                         // :19913-19916 clamp<2（倒挂 quirk 源）
      num3 += 0.01;                                                   // :19917
      this.vy = -num3;                                                // :19918
      this.jumpHold = PLAYER_JUMP_TICKS;                              // :19919 jump = jumpHeight(15)
      // fullRotation = 0（:19920）——本仓 fullRotation 未建模（坐骑旋转域）,略
      pogoFired = true;                                               // :19921 return
    }
    // ★BJ705-G25（2026-10-22）[g23-num15-field-face]/[g23-fullspeed-dashdelay-1457]
    //   清偿前置:四运动字段声明提升出滑行门（≙原版 maxRunSpeed/accRunSpeed/runSlowdown/
    //   runAcceleration 字段——每拍在移动支头重算,DashMovement :21429 num15/滑行制动块
    //   读字段【终值】;链体随下方 !pogoFired 放行=滑行期照跑,裸装初值=pulley/pogo 拍
    //   （链不跑）的字段面≙原版 pulley 支字段=reset+装备链终值）。runAcc 初式=滑行制动
    //   块旧式逐字（绳支零漂移;dune 项=原版 :26742 链在正常支——pulley 拍本无,既有
    //   1 拍窄面保旧形不扩刀）。
    let maxRun = PLAYER_WALK_MAX * speedMult;
    let accRun = eqM.accRunSpeed || 3;
    let runSlow = RUN_SLOWDOWN * eqM.runSlowMul;
    let runAcc = RUN_ACCELERATION * (duneBoost ? 1.75 : 1)
      * this.buffs.moveSpeedMult * eqM.moveMult * strongestSlow;
    if (this.pulley) {
      // ★BJ-C8（R7-F1）：pulley 期朝向翻转整支迁 flag12 状态机（:26356-26365 转身支+
      //   :26369-26392 侧挂回中支,移动相 pulley 块内）——旧 pulleyDir==1 inputX 翻面
      //   退役（侧挂档按异向键翻面会瞬移到绳列另一侧=偏差面;转身/回中双支 1:1 落
      //   状态机,本空支仅承载 else 链分派）
    } else
    // ★BJ705-G25（2026-10-22）[g23-num15-field-face]/[g23-fullspeed-dashdelay-1457] 清偿:
    //   门放宽为 !pogoFired——参数链（翼档 cap/坐骑覆写/沙丘/暗影/瓶 boost）滑行期
    //   （dashDelay<0）照跑=原版字段在正常移动支每拍重算（不闸 dashDelay）;整合段
    //   （加速/爬坡/摩擦）保 1456 形内门（下方 `if (this.dashDelay >= 0)`——滑行反向
    //   制动面由 dashMovement 滑行支承载+四字段直通;滑行期 else 摩擦缺失面已随
    //   BJ705-G26 清偿——本门下方 else-if/else 两臂补摩擦支,见 glideElseFriction 注）。
    // ★BJ717-A F7（2026-10-25,R13 清偿）：pogoFired 门改辖【整合段】（下方内嵌
    //   `if (!pogoFired)`）——原版弹跳臂在 HorizontalMovement 头（:19909-21）return
    //   的是 HM 余段（加速/爬坡/摩擦）,而 run 参数链（:26694-26888,坐骑覆写/
    //   sticky 钳/毯/刀全含）在 HM【前】=弹跳拍照跑,四字段终值=坐骑档（mount 43:
    //   :26828 !CanUseWings → runSlowdown=0.2 平值复位族）。旧仓整链跳过=弹跳拍
    //   四字段裸装面（消费面=dashMovement num15/制动,骑 43+冲刺+落地震荡拍）。
    //   ★R13-F5 勘误随刀：vanilla :26718-21 mount43∧vy≠0→runSlowdown=0 与
    //   :26824-28 !CanUseWings→runSlowdown=0.2 同链后者覆写前者=死码（1456 :26202
    //   →:26310 同序,oracle S5 实测空中 runSlow=0.2/vx 0.1t 衰减）——「空中零摩擦」
    //   系 R13 误读,不移植。
    {
      // ---- 原版两段加速模型（Player.cs:19559-19800 HorizontalMovement Run 段）----
      // maxRunSpeed=3×moveSpeed（常规上限）;accRunSpeed=6（靴族 6/6.75,冲刺爬坡上限）
      // 全速段（:19559:|vx|<maxRun）runAcceleration=0.08 全力;慢爬坡段（:19675:
      // maxRun≤|vx|<accRun）仅 ×0.2 且需 onGround(vy==0)或翼飞行——空中爬坡无效;
      // 翼飞行再 +0.2 一份（:19690）。无输入减速（:19771）:地面 runSlowdown=0.2
      // 空中 ×0.5,加法钳 0（旧乘法摩擦曲线高速段衰减过快）。
      // 1457: 慢速/燃烧爬坡门已删（:20091/:20121），Chilled 压 accRun 门改
      // oldStyleParkour-only（:19901）——减速统一折入 strongestMoveSpeedDebuff
      // ★[g23-fullspeed-dashdelay-1457] 登记（BJ705-G23 定谳连带）:1457 全速两支
      //   删了 `dashDelay >= 0`（:19975/:20033;1456 :19559/:20033 在）,爬坡两支
      //   保留（:20091/:20121）——本仓整段门=1456 形（滑行期全速段照跳）。1457
      //   差异面=滑行尾 |vx|<maxRun 拍全速加速仍跑;dash 域批处置（涉滑行收敛尾）。
      const mnt = this.ridingMount ? this.mount : null;   // 坐骑参数接管（Player.cs:26310-26334）
      // ★BJ705-B：非叠加坐骑骑乘期「覆写前乘区全灭」镜像旗（:26852-54 覆写冲掉的
      //   净效;见下方 mount 覆写块内定谳注）+ :26826-28 摩擦平值复位旗
      let mntWipeBoost = false;
      let mntSlowFlat = false;
      // ★水中不缩 Run 参数：原版 reset(:24096-24099)/moveSpeed 乘区(:25694-25695)/
      // 装备链(:26184-26300) 全链无任何 wet 因子——水中减速全在位移积分层
      //（:27874-27888 WetCollision：位移 ×0.5/蜜 0.25/微光 0.375，见下方 liqFactor 段）。
      // 旧 `inWater→maxRun×0.55` 是自造速度模型：accRun 不缩 → 裸装水中爬坡带
      // [1.65,3) 非空 → 尘门 vx>(3+1.65)/2=2.325 可越 → 跑尘+脚步声误触发（2026-08-17 修）
      maxRun = PLAYER_WALK_MAX * speedMult;
      // accRunSpeed 定值不随 moveSpeed（:25694-25695 只乘 runAcceleration/maxRunSpeed
      // ——旧误乘 speedMult,2026-08-13 修）。裸装基准 = 3：原版每 tick reset
      // :24099 accRunSpeed = maxRunSpeed（reset 时 maxRunSpeed 尚为裸值 3，moveSpeed
      // 乘区在其后）；6/6.75 是靴族 equip 覆写。曾 `|| 6` = 裸装极速翻倍 6 px/t
      // （30mph vs 原版 15mph，2026-08-16 默认移速审计修）。声明已提升（G25——滑行
      // 期链照跑）,此式幂等重赋。
      accRun = eqM.accRunSpeed || 3;
      // 1457: accRunSpeed 也吃减速 debuff（Update :26207-26210 accRunSpeed *=
      // strongestMoveSpeedDebuff）——★F5③ 豁免臂接通：6190 旧世界跑酷指南
      // （RefreshMechanicalAccsFromItemType :12933-12936 → equipStats.oldStyleParkour）
      // 在场时不乘；HorizontalMovement 头 `chilled && oldStyleParkour` 支
      // （:19901-19903）同步落地——accRun ← maxRun（此时 maxRun 已含 debuff，
      // 与原文 Update :26204-26210 先行减完再进 HorizontalMovement 的值序一致）
      const parkourBook = eqM.oldStyleParkour === true;
      if (!parkourBook) accRun *= strongestSlow;
      else if (this.buffs.has(BuffType.Chilled)) accRun = maxRun;
      if (mnt) {
        // :26836-26853：三支——MovementStatsAreAdditive(滚轴鞋 57-60,Mount.cs:2580)
        // 走 += 叠加；CanUseWings 空中档 Math.max(本仓坐骑恒禁翼,不可达)；否则覆盖。
        //  RunSpeed 含每坐骑特例（蜜蜂空中+4×(1-疲劳)、猪鲨崽空中+13.5、游泳态→swimSpeed）
        if (mnt.movementStatsAdditive) {                 // 台账批:累加式原为赋值(B 档)
          maxRun += mnt.runSpeed();
          accRun += mnt.dashSpeed;
        } else {
          maxRun = mnt.runSpeed();
          accRun = mnt.dashSpeed;
        }
        // ★BJ705-B（2026-10-21 用户实报「远古号角坐骑二段跳后平地最高速度 41→63mph」
        //   定谳）：vanilla 一切【覆写前】乘区（翱翔徽章 runAcc×1.75 :26700-03/荧光体
        //   :26704-10/暗影套 :26711-17/瓶族跳 boost :26778-26812/坐骑特殊跳 boost
        //   :26788-26807——G19 已撤消费线）对非叠加坐骑被 :26852-54 赋值覆写【整体
        //   冲掉】=骑乘期零效果;本仓覆写在本块先行 → 上述乘区落在覆写后=骑乘期 live。
        //   活码面:骑 14 Basilisk（Mount.cs:1648-1697 无 blockExtraJumps 赋值=瓶跳
        //   放行,Player.cs:26245-56 只清 BlockExtraJumps=true 族;:20875 选择序坐骑
        //   族先瓶族后）空中第 2 跳耗瓶置 performingJump='Blizzard'/'Fart'/'Sail' →
        //   maxRun=8×1.5/×1.75/×1.25+runAcc×3 过冲 → 弧内峰 ≈12.7/14.7/10.35px/t ≈
        //   63/73/52mph（用户实报 41→63 数值吻合;判别锁=tests/bj705b-basilisk-
        //   lowsweep.test.ts §0A）。镜像=非叠加骑乘期这些乘区整块跳过;加法坐骑（滚轴
        //   鞋）乘叠加前基底（mulPreAdd ≙ vanilla 先乘后加序,add=0 退化恒等）。
        mntWipeBoost = !mnt.movementStatsAdditive;
        // :26826-26828 `if (!mount.CanUseWings) runSlowdown = 0.2f`——骑乘期摩擦平值
        //   复位（gear runSlowMul 与荧光体 ×1.75 均为覆写前乘区=同被冲掉）
        mntSlowFlat = MOUNT_DATA[String(mnt.type)]?.CanUseWings !== true;
      }
      // ★FX58b：加法坐骑（滚轴鞋 57-60,MovementStatsAreAdditive=Mount.cs:2580）的乘区
      // 序代数。原版荧光体(:26704-26710)/沙丘支(:26742-26749)/地面材质链(:26722-26772)
      // 都作用在坐骑 stats 叠加(:26838-26842)【之前】的基底上;本仓叠加先行(上方 mnt 支),
      // 故以 mulPreAdd=(v−add)×m+add 还原「先乘后加」序——add=0(步行/赋值坐骑)时退化
      // 为 ×m,既有路径逐位不变。★BJ705-G23 起翼档 cap 亦消费（声明提前至本位）。
      const additiveRun = mnt && mnt.movementStatsAdditive ? mnt.runSpeed() : 0;
      const additiveDash = mnt && mnt.movementStatsAdditive ? mnt.dashSpeed : 0;
      const additiveAcc = mnt && mnt.movementStatsAdditive ? mnt.acceleration : 0;
      const mulPreAdd = (v: number, m: number, add: number): number => (v - add) * m + add;
      // ★BJ705-G23（2026-10-22）[bj705b-wing-cap] 清偿+⑩（2026-08-31）滚轴鞋翼横移
      //   deferred 域收口——WingAirLogicTweaks 1:1（1457 :29536-55,1456 :28838-62）。
      //   总门=:26696 `wingsLogic>0 && vy≠0 && !merman && mount.CanUseWings`——CanUseWings
      //   分型（Mount.cs:574-83）:未骑乘恒真;骑乘仅滚轴鞋 57-60（SetAsRollerSkate
      //   :2579 唯一置位）真,其余坐骑 :26830-33 wings/wingsLogic 清零=cap 不达。
      //   修前三面:①缺 CanUseWings 门→骑乘+翼 airborne maxRun=max(8,accSpeed≤9)=
      //   9px/t≈45mph 瞬态（幽灵翼 29/32;恶魔翼 6.25<8 数值死面）+accRun=maxRun
      //   置换坐骑 DashSpeed;②cap 抬 maxRun 而原版 :29550-52 只抬 accRunSpeed
      //   （AccRunSpeedOverride>accRunSpeed 才写=只抬不压）——maxRun 保持未抬,顶速
      //   经慢爬坡支（:20091/:20121 内门 wingsLogic>0）从 maxRun 爬到 accRun,
      //   BJ705-B 的 boostBase/preWingMaxRun 补丁基底就此退役（boost 直接乘 maxRun
      //   =vanilla :26778-812 原句）;③accRun=maxRun 置换 gear accRunSpeed（靴 6/6.75
      //   被 clobber）+悬浮档 :29543-45 DownHoverSpeedOverride【无条件置换可压低】
      //   （如沙丘 10.5→悬浮板 10）被折进 max()。滚轴鞋加法序:vanilla cap 在
      //   :26838-42 叠加【前】=翼值参与 += 基底;本仓叠加先行,以 (max(accRun−add,
      //   wingVal))+add 还原（未骑乘 add=0 退化恒等）。merman 门（:26696,人鱼湿态
      //   横移 cap 不抬——ramp 门 wingsLogic>0 仍放行=原版同构）与悬浮 flag 第四项
      //   !isDownDashing（:29540）随刀补齐。翼 45 掷后摩擦 ×6（:29557-59）已随
      //   BJ705-G25 清偿（runSlow *=6 位=下方 mntSlowFlat 行后,wingCapFired 门）。
      let wingAccMul = 1;
      let wingCapFired = false;
      const mntCanWings = !mnt || MOUNT_DATA[String(mnt.type)]?.CanUseWings === true;
      // ≙ :26833-35 骑禁翼族清零后的 wingsLogic（HorizontalMovement :20091/:20121
      // 爬坡内门与 :20096/:20126 第二份 ×0.2 消费同一面值;下方 canRamp/双份加速用）
      const wingsLogicEff = eqM.wing && mntCanWings ? eqM.wing.logic : 0;
      if (eqM.wing && this.vy !== 0 && !this.merman && mntCanWings) {
        const ws = wingStatOf(wingsLogicEff);
        const hoverDive = this.tryingToHoverDown && this.inputJump && ws.hover && this.wingTime > 0
          && !this.isDownDashing;   // ★SW-FX14 :29540 flag=TryingToHoverDown∧controlJump∧wingTime>0∧!DownDash
        wingCapFired = true;
        wingAccMul = hoverDive ? ws.hoverAccelMult : ws.accelMult;   // :29546/:29555（1456 :28852/:28856）——26/45/29/32/30/31/37/44 档 ×1.5-4.5,其余 ×1
        if (hoverDive) {
          if (ws.hoverSpeed !== -1) accRun = ws.hoverSpeed + additiveDash;   // :29543-45 无条件置换（可压低）
        } else if (ws.accSpeed !== -1 && ws.accSpeed > accRun - additiveDash) {
          accRun = ws.accSpeed + additiveDash;   // :29550-52 只抬不压;maxRun 不动
        }
      }
      runSlow = mntSlowFlat ? RUN_SLOWDOWN : RUN_SLOWDOWN * eqM.runSlowMul;   // 暗影套 ×1.75(:26195-26201);★BJ705-B :26826-28 骑乘平值 0.2 复位(mntSlowFlat)
      // ★BJ705-G25 [g23-wing45-dash-friction] 清偿（WingAirLogicTweaks 尾段
      //   :29557-59 `wingsLogic==45 && timeSinceLastDashStarted>=60 → runSlowdown×6`）:
      //   星盘（4954,wing 45,月领专家掉落）掷后 60t 起,空中横移摩擦 ×6（dash 拍重置
      //   计时戳 :21756/:21771,逐拍 +1 帽 300 :24794-98）——翼 45 的"掷后动量守恒"
      //   手感面。wingCapFired ≙ 总门 :26696 已触发（含 CanUseWings 分型——骑禁翼族
      //   平值复位 :26826-28 序后本就不可达）;canRamp/爬坡加速面不受 runSlow 影响
      //   （只乘摩擦支）。
      if (wingCapFired && wingsLogicEff === 45 && this.timeSinceLastDashStarted >= 60) runSlow *= 6;
      // 沙丘行者靴:四参数全 ×1.75（Player.cs:26226-26232——maxRun/accRun/acc/slowdown）。
      // ★SW-FX44 定谳（a-batch1 沙丘 5.25 红根因）：maxRun 的 ×1.75 已由 speedMult
      // 承载（:4296 duneBoost 因子→:4520 maxRun=3×speedMult）——此处再乘=双 ×1.75
      //（maxRun=9.19,探针实测全速段爬到 9.28 才落 ×0.2 档,原版 :20033 全速段恰止于
      // maxRunSpeed=5.25）。本行只补 accRun 的 ×1.75（accRun=equipStats 值,无 speedMult
      // 路由）——原版 :26743-26744 maxRunSpeed/accRunSpeed 各恰一次。maxRun 经 speedMult
      // 的消费面（:5543 滑行步行支 mRun=滑行中落步行分支=乘区后值;:5592 num15）同取单次。
      // ★FX58b：加法坐骑也吃沙丘支 accRun×1.75——原版 :26746 无坐骑门且先于叠加
      // (:26838-26842)：滚轴鞋+沙丘行者靴+沙 accRun=(6×1.75)+1=11.5 → 极速帽 11.5
      // px/t ≈ 58.8mph（秒表实测 ~58 的出处）。旧 !mnt 门整支跳过 → 6+1=7 ≈ 35.8mph。
      if (duneBoost && (!mnt || mnt.movementStatsAdditive)) {
        accRun = mulPreAdd(accRun, 1.75, additiveDash);
      }
      // D3（1457 :26206 runAcceleration *= moveSpeed）：步行支加速度也吃 moveSpeed
      // 乘区——构成 = moveSpeedMult×装备 moveMult×strongestSlow（含盾举,上方合成）。
      // ★勿整乘 speedMult：星璇潜行 0.3 是场景因子,原版不走 moveSpeed 链
      // （蜜减速在位移积分层 WetCollision;潜行只乘 accRun/maxRunSpeed :26046-26047。
      //  ★BJ474：inHoney 0.5 已自 speedMult 撤除,见其定义处注——原版无 wet 因子）。
      // 坐骑支不乘（:26329-26331 mount.Acceleration 覆写在乘区之后,不吃减速）
      // ★滚轴鞋 additive 支（:26838-26840 同句 runAcceleration += mount.Acceleration
      //  ——加法作用于装备/减速链合成的基底之上；赋值支保持原覆写语义）
      runAcc = mnt && !mnt.movementStatsAdditive ? mnt.acceleration
        : RUN_ACCELERATION * (duneBoost ? 1.75 : 1)
          * this.buffs.moveSpeedMult * eqM.moveMult * strongestSlow;
      if (mnt && mnt.movementStatsAdditive) runAcc += mnt.acceleration;
      // 翼飞行加速倍率（WingAirLogicTweaks :29546/:29555,乘区在 moveSpeed 链之后）
      // ★BJ705-G23:门=cap 实触发（≙:26696 CanUseWings——未骑乘/滚轴鞋放行）;旧
      //   `!mnt` 门把滚轴鞋+翼的 accelMult（×1.5-4.5）整面吞掉。加法坐骑乘叠加前
      //   基底（vanilla tweaks 在 :26838-42 叠加前,只乘装备/减速链合成基底）。
      if (wingCapFired) runAcc = mulPreAdd(runAcc, wingAccMul, additiveAcc);
      // ★BJ216 翱翔徽章（:26698-26700）：runAcceleration ×1.75——原版位在
      //  WingAirLogicTweaks(:26694) 之后、荧光体(:26703)/暗影套(:26711)/地面材质链
      //  (:26722-26772) 之前,无 velocity/坐骑门（坐骑域在 :26835-26853 其后,加法族
      //  乘叠加前基底 → 随 FX58b mulPreAdd 序;钩爪/舌头支门与荧光体等邻居共域,同 modeling 面）。
      //  另 :14880 moveSpeed += 0.075 经 accfx '4989'.move 已进 moveMult 乘区
      if (eqM.empressBrooch && !mntWipeBoost) runAcc = mulPreAdd(runAcc, 1.75, additiveAcc);   // ★BJ705-B:vanilla :26700-03 覆写前=非叠加骑乘期被冲掉
      // 荧光体 5107（★1457 :26703-26709,旧注 :26188-26194 系 1456 锚）：地面四参数
      // ——acc×1.75/maxRun×1.15/accRun×1.15/slowdown×1.75（velocity.Y==0 门 ≈
      // onGround;手持光走 emitMagiluminescenceLight——ApplyEquipFunctional case 5107
      // :14663-14669 无地面门）
      if (this.onGround && eqM.magiluminescence && !mntWipeBoost) {   // ★BJ705-B:vanilla :26704-10 覆写前=非叠加骑乘期被冲掉(修前 8×1.15=9.2≈46mph 持续)
        // ★FX58b：加法坐骑乘叠加前基底（原版 :26704-26710 先于 :26838-26842 叠加）——
        // 滚轴鞋地面 maxRun=(3×1.15)+1=4.45、acc=(0.08×1.75)+0.1=0.24；旧序乘在已
        // 叠加值上 =(3+1)×1.15=4.6 / (0.08+0.1)×1.75=0.315。add=0 时退化 ×m 不变。
        runAcc = mulPreAdd(runAcc, 1.75, additiveAcc);
        maxRun = mulPreAdd(maxRun, 1.15, additiveRun);
        accRun = mulPreAdd(accRun, 1.15, additiveDash);
        runSlow *= 1.75;
      }
      // ★FX58c：暗影套/远古暗影运动四参的缺失三参（:26711-26717 acc×1.75/maxRun×1.15/
      // accRun×1.15——第四参 slowdown 已由 runSlowMul 在 runSlow 基底消费;runAccMul/
      // maxRunMul 曾零消费死数据,vanillaArmorSets.ts '5|5|5'/'74|48|44'）。原版
      // shadowArmor 无地面门（与荧光体 :26704 的 velocity.Y==0 门不同）。加法坐骑乘
      // 叠加前基底;add=0 时补齐裸装暗影套同面（×1 恒等,漂移为零）。
      if ((eqM.runAccMul !== 1 || eqM.maxRunMul !== 1) && !mntWipeBoost) {   // ★BJ705-B:vanilla :26711-17 覆写前=非叠加骑乘期被冲掉(修前暗影套 8×1.15=9.2≈46mph 持续)
        runAcc = mulPreAdd(runAcc, eqM.runAccMul, additiveAcc);
        maxRun = mulPreAdd(maxRun, eqM.maxRunMul, additiveRun);
        accRun = mulPreAdd(accRun, eqM.maxRunMul, additiveDash);
      }
      // ---- 地面材质链（1457 :26722-26772 原版 else-if 真序：sticky→powerrun→
      //      sand→slippy2→slippy；floorTileT 已带坡面门 :23466）----
      // sticky 蜂蜜块地面（:26722-26735）：maxRun/acc×0.25、slowdown×2 + 钳 ±maxRun
      //   ——与 StickyTiles 泡块阻尼（:22650+，上面已接）是两条链
      // powerrun 沥青（:26736-26741）：maxRun×3.5、slowdown×2（跑道）
      // slippy2 冻结史莱姆块（:26750-26759）：acc×0.6、slowdown=0（无摩擦滑到底）；
      //   冰刀族 acc 再×3.5+maxRun×1.25
      // slippy 冰族七 tile（:26760-26772）：acc×0.7；冰刀 acc×3.5+maxRun×1.25，
      //   无冰刀 slowdown×0.1（打滑）
      // ★FX58b（1457 坐骑门勘误）：原版此链无坐骑门,且先于坐骑 stats 叠加
      //   (:26838-26842)与 RollerSkateMovement 的沥青 ×2.25(:28769-28774)。旧
      //   `!mnt` 门把加法坐骑（滚轴鞋）整链跳过：沥青极速帽 (3+1)=4,原版
      //   (3×3.5+1)×2.25=25.875 px/t ≈ 132mph（wiki 沥青面"基速×7.875+12mph"）。
      //   加法族按叠加前基底乘（mulPreAdd/additive*）；非加法坐骑 maxRun/runAcc
      //   会被 :26840-26842 赋值覆盖、链仅余 sticky 钳+slowdown 面——独立坐骑族
      //   保持 !mnt 跳过（FX58b 登记,另刀处置）。
      if ((!mnt || mnt.movementStatsAdditive) && this.floorTileT >= 0) {
        const iceSkate = !!eqEarly.iceSkate;
        const ft = this.floorTileT;
        if (ft === HONEY_FLOOR_ID) {                        // sticky（:26722-26735）
          maxRun = (maxRun - additiveRun) * 0.25;           // :26724 链时基底
          runAcc = (runAcc - additiveAcc) * 0.25;           // :26725
          runSlow *= 2;                                     // :26726
          if (this.vx > maxRun) this.vx = maxRun;           // :26727-26734 钳【未叠加】maxRun
          if (this.vx < -maxRun) this.vx = -maxRun;
          maxRun += additiveRun; runAcc += additiveAcc;     // :26838-26842 叠加补位
        } else if (ft === ASPHALT_ID) {                     // powerrun（:26736-26741）
          maxRun = mulPreAdd(maxRun, 3.5, additiveRun);     // = 3×3.5+1 = 11.5（×2.25 后 25.875）
          runSlow *= 2;
        } else if (ft === FROZEN_SLIME_ID) {                // slippy2（:26750-26759）
          runAcc = mulPreAdd(runAcc, 0.6, additiveAcc);
          runSlow = 0;
          if (iceSkate) { runAcc = mulPreAdd(runAcc, 3.5, additiveAcc); maxRun = mulPreAdd(maxRun, 1.25, additiveRun); }
        } else if (ICE_SLIP_IDS.has(ft)) {                  // slippy（:26760-26772）
          runAcc = mulPreAdd(runAcc, 0.7, additiveAcc);
          if (iceSkate) { runAcc = mulPreAdd(runAcc, 3.5, additiveAcc); maxRun = mulPreAdd(maxRun, 1.25, additiveRun); }
          else runSlow *= 0.1;
        }
      }
      // 猪鲨崽非增益态减半（Player.cs:26333-26337：mount.Type==12 && !MountFishronSpecial
      //  → runAcceleration/=2、maxRunSpeed/=2——干爽满血且无雨才减，湿身/雨中/半血以下全额）
      if (mnt && mnt.type === 12 && !mnt.fishronBoost) { runAcc /= 2; maxRun /= 2; }
      // ★BJ704-G19 定谳撤线（G16 债②亲读连带）：坐骑特殊跳 run 加速（Player.cs
      //   :26791-26815 isPerformingJump_{Unicorn,Santank,WallOfFleshGoat,Basilisk}
      //   ∧ hasJumpOption_* → runAcceleration×3、maxRunSpeed×1.5）——【骑乘期整块
      //   死码】：四型均非滚轴鞋（Mount.cs:2578-2581 唯 SetAsRollerSkate 置
      //   CanUseWings/MovementStatsAreAdditive）→ flag17 恒假 → :26852-26856
      //   `maxRunSpeed=mount.RunSpeed; accRunSpeed=mount.DashSpeed;
      //   runAcceleration=mount.Acceleration` 覆写支必走——boost 乘区被坐骑 stats
      //   整体覆写冲掉（vanilla 骑乘期零效果）。旧仓 `if (mnt && mnt.mountJumpPerforming)
      //   {×3/×1.5}` 在覆写【后】乘=独角兽一次特殊跳后骑乘期永久 1.5× 极速=
      //   与 vanilla 相反的活码,本刀撤消费线（mountJumpPerforming 状态位保留,
      //   G15 帧域/测试锁不受扰）。
      //   【登记 g19-mountjump-residual】vanilla 真活面=下坐骑后的残余 boost：
      //   山羊 47/蜥蜴 14 的 isPerformingJump 无任何复位（CancelAllJumpVisualEffects
      //   :36932-36944 清位表不含）→ 骑乘中出特殊跳后下坐=步行态 ×3/×1.5 常驻;
      //   独角兽 10/圣诞坦克 46 在表内=仅 jump 窗口（:26953 收口）。需 Player 级
      //   跨下坐持久位+分族清位语义——坐骑域批处置,勿按「简单漏行」再登记。
      // ★BJ704-G16（G15 登记债⑥）：沙暴瓶跳 run 加速（:26773-26777 `if (sandStorm)
      //   { runAcceleration *= 1.5f; maxRunSpeed *= 2f; }`——位置=sticky/sand 链后、
      //   isPerformingJump 族加速前;坐骑参数接管后乘=骑乘面本就 !ridingMount 不可达）。
      if (sandStormActive) { runAcc *= 1.5; maxRun *= 2; }
      // ★BJ704-G19（G16 登记债②）：瓶族跳 run 加速（:26779-26787 暴雪 ×3/×1.5、
      //   屁瓶 ×3/×1.75;:26798-26801 航行瓶 ×1.5/×1.25 同族补全——云瓶无加速行）。
      //   门=isPerformingJump_*（performingJump）∧ hasJumpOption_*（瓶在身）∧ jump
      //   窗口（:26953 jump==0 → CancelAllJumpVisualEffects 收口≙jumpHold>0——无
      //   rising 门,窗口内下落尾也吃）∧ 非挂爪（:36776 清）/上绳（:26335 清）;
      //   CCed 清位由 performingJump 清（:7692/:7261 承载）。松键面:原版 :21201-21208
      //   else 支松键即 jump=0（窗止）,仓内 jumpHold 耗尽制=松键后余量照跑——
      //   jumpHold 全体消费者共有近似,登记 [g19-jump-release-zero] 待机动面批。
      if (this.jumpHold > 0 && !this.grappling[0] && !this.pulley && !mntWipeBoost) {
        // ★BJ705-B：!mntWipeBoost=vanilla :26778-26812 瓶族 boost 在 :26852-54 坐骑
        //   覆写【前】=非叠加骑乘期被整体冲掉（骑 14 瓶跳弧内 63/73/52mph 活码面,
        //   见上方 mount 覆写块定谳注）;mulPreAdd=加法坐骑乘叠加前基底(≙先乘后加)。
        //   ★BJ705-G23:boostBase/preWingMaxRun 补丁基底退役——cap 已 1:1 只抬
        //   accRunSpeed（上方 cap 块注）,boost 直接乘 maxRun 即 vanilla 原句
        //   (:26778-812 乘的就是未抬 maxRunSpeed);顶速经 ramp 支到 accRun 承接。
        if (this.performingJump === 'Blizzard' && eqM.jumpOpts.includes('Blizzard')) { runAcc = mulPreAdd(runAcc, 3, additiveAcc); maxRun = mulPreAdd(maxRun, 1.5, additiveRun); }
        else if (this.performingJump === 'Fart' && eqM.jumpOpts.includes('Fart')) { runAcc = mulPreAdd(runAcc, 3, additiveAcc); maxRun = mulPreAdd(maxRun, 1.75, additiveRun); }
        else if (this.performingJump === 'Sail' && eqM.jumpOpts.includes('Sail')) { runAcc = mulPreAdd(runAcc, 1.5, additiveAcc); maxRun = mulPreAdd(maxRun, 1.25, additiveRun); }
      }
      // ★BJ717-A F2（2026-10-25,R13 清偿）：飞毯横移加速——vanilla :26813-26817
      //   `if (carpetFrame != -1) { runAcceleration *= 1.25f; maxRunSpeed *= 1.5f; }`
      //   （瓶族 boost 与变态刀之间,坐骑覆写块前=覆写前乘区）。消费位=carpetFramePrev
      //   （上一拍展开快照,≙ 原文链先于 CarpetMovement 的滞后一拍读法;oracle S6:
      //   毯飞横移 maxRun 3→4.5、runAcc 0.08→0.1,vx 收敛 4.58px/t——修前 SW 整缺
      //   =2/3 速 3.06,probe1 实测）。!mntWipeBoost=BJ705-B 覆写前乘区家族门
      //   （非叠加骑乘期被 :26852-54 覆写冲掉;实际毯与骑乘互斥 :22025,门为家族
      //   一致性保险）。mulPreAdd=加法坐骑乘叠加前基底（毯态恒 add=0,退化纯乘）。
      if (this.carpetFramePrev && !mntWipeBoost) {
        runAcc = mulPreAdd(runAcc, 1.25, additiveAcc);
        maxRun = mulPreAdd(maxRun, 1.5, additiveRun);
      }
      // ★BJ717-A F4（2026-10-25,R13 清偿）：变态刀 3106 潜行移速惩罚——vanilla
      //   :26818-26823 `if (inventory[selectedItem].type == 3106 && stealth < 1f)
      //   { num41 = maxRunSpeed/2*(1-stealth); maxRunSpeed -= num41;
      //   accRunSpeed = maxRunSpeed; }`（毯行后、坐骑覆写块前）。heldPsychoKnife
      //   =手持位单源（:3974/:4260 消费同源）;stealth<1 潜行斜坡（满潜行减半+
      //   accRun 压平——oracle S4:stealth=0 时 maxRun 3→1.5、accRun=1.5、run 收敛
      //   ~1.5,修前 SW 移速面零消费=3.04 恒速）。乘叠加前基底（原文本臂在
      //   :26838-42 坐骑加法【前】）;accRun 置换=减后值+坐骑加法（≙原序）。
      //   !mntWipeBoost=同族覆写前乘区门（非叠加骑乘期整段被冲掉）。
      if (this.heldPsychoKnife && this.stealth < 1 && !mntWipeBoost) {
        const preKnife = maxRun - additiveRun;
        const num41 = preKnife / 2 * (1 - this.stealth);
        maxRun = preKnife - num41 + additiveRun;
        accRun = preKnife - num41 + additiveDash;
      }
      // ★滚轴鞋滑行分支（Player.RollerSkateMovement :28736-28778，台账批 A×2+B）：
      // 无输入阻尼带（减速带 accRun−1f + 空中门 flag2）+ runSlowdown 尾钳 + 沥青
      // ×2.25/×1.6 特支——替换此前“坐骑无专属滑行段走通用阻尼链”的近似。glideCap
      // = 巡航挡 num6 = max(1.5,16/(num3×tileSpeed))：★SW-BJ59 清偿"恒基准档"登记——
      // num3（手持可放置物/魔杖 useTime）与 tileSpeed（placeSpeedTileRaw 倒数域）
      // 两面已接，见下方实现注。fullRotation 归零段（:28775-28777 !onTrack）随
      // SW-BJ59 轨骑落地（onTrack 真值可用）——贴轨/滞空保留倾角。
      if (mnt && mnt.movementStatsAdditive) {
        // 巡航挡 num6 = max(1.5, 16/(num3×tileSpeed))（:28746-28751）——
        // ★SW-BJ59 清偿：num3 = 手持可放置物（createTile≥0 ⇔ def.tile 存在）/魔杖
        // （tileWand>0：832/932/933/1129/3360/3361，Item.cs 各 case）时取其 useTime
        // （itemCombat 数据面），否则基准 10；tileSpeed = 原版倒数域终值
        // （1/min(3,raw)，:26113-26117——与 Game.paintTileSpeed 同式单源）。
        // num4=0 守卫：16/0=+Inf 会经 lerp 毒化速度——原版该档需 useTime≤2 的
        // 可放置物（查无），钳 1 等价不可达。
        const heldIt = this.inv.heldItem();
        const heldDef = heldIt ? ITEM_DEFS[heldIt.id] : undefined;
        const heldVid = heldDef ? (heldDef.vid ?? -1) : -1;
        let num3 = 10;
        if (heldDef && (heldDef.tile !== undefined || TILE_WAND_VIDS.has(heldVid))) {
          num3 = itemCombat(heldVid)?.useTime ?? 10;   // HeldItem.useTime（vanilla-itemcombat 数据面）
        }
        const num4 = Math.trunc(num3 * (1 / Math.min(3, this.placeSpeedTileRaw())));   // :28751 (int)(num3×tileSpeed)
        const glideCap = Math.max(1.5, 16 / Math.max(1, num4));            // :28750-28751
        const step = mountRollerSkateStep(this.vx, this.vy, this.inputX === 0,
          !!this.grappling[0], accRun, maxRun, runSlow,
          glideCap, this.floorTileT === ASPHALT_ID);
        if (step.dampedVx !== undefined) this.vx = step.dampedVx;
        runSlow = step.runSlow;               // :28775-28776 clamp(|vx|−max(maxRun,accRun),0,slow)
        // ★FX58b：powerrun ×2.25 外层帽同步（:28769-28774 原版在 RollerSkateMovement
        // 入口就地乘 maxRunSpeed,HorizontalMovement 全速帽 :20033 消费同一步长变量;
        // step 内 mr 是局部副本仅及尾钳——外层帽不同乘则沥青极速止步 11.5）:
        // 11.5×2.25 = 25.875 px/t ≈ 132mph。
        if (this.floorTileT === ASPHALT_ID) maxRun *= 2.25;
        // fullRotation 归零段（:28775-28777）：vy==0 且上一拍未贴轨 → 倾角清零
        //（贴轨/滞空保留 = 原版语义；onTrack 在本 tick 尾部轨骑段重算）
        if (this.vy === 0 && !this.onTrack) mnt.fullRotation = 0;
      }
      // ★BJ705-G23（2026-10-22）⑩（2026-08-31）「滚轴鞋 wingAir 钉死等价」退役——
      //   deferred 域本刀收口。爬坡内门/双份加速的翼谓词 ≙ 原版 :20091/:20121 内门
      //   `vy==0 || wingsLogic>0 || mount.CanFly(this)` 与 :20096/:20126 第二份 ×0.2
      //   的 `wingsLogic>0`——wingsLogic=骑禁翼族清零后装备面（上方 wingsLogicEff）:
      //   ①无 wingTime 项——滑翔相（燃料尽）ramp/双份照跑（旧 wingTime>0 门把滑翔
      //     横移压回 maxRun=3,原版保持爬到 accRun）;
      //   ②无 !mnt 项——滚轴鞋 57-60（CanUseWings）骑乘+翼 ramp 放行;飞行坐骑
      //     （CanFly:0 驯鹿/2 猪龙/50 史后/54 迅猛龙…）无翼亦放行;
      //   ③无 !onGround 项——坡面瞬态（onGround∧vy≠0）持翼 ramp 照跑（vy==0 支
      //     已覆盖常态地面）。
      //   旧 wingAir=`!onGround && wing && wingTime>0 && !mnt` 三重窄化全数退役。
      // ★BJ717-A F7：!pogoFired 内门——弹跳臂命中拍 HorizontalMovement 余段 return
      //   （:19909-21,pogo 臂自身已写 vy/jumpHold）=整合段（加速/爬坡/摩擦/火花/
      //   风推）跳过,参数链（上方）照跑。滑行门 dashDelay 族语义不变（G25/G26 既有面）。
      if (!pogoFired) {
      // 水平链 1:1（:19559-19800）：两段加速 + 【超额回落摩擦】。原版整链不设
      // 硬钳（仅 sticky :26211 钳 maxRun）——持方向键越过帽（全速段 +0.08 过冲
      // 到 3.04）时落入摩擦分支（地面 −0.2/空中 −0.1）→ 2.84 → 再 +0.08……
      // 锯齿均值 ≈2.93-3.0 = 原版"15mph"的真实纹理（曾硬钳帽值=恒 3.0，2026-08-16 审计修）
      const grounded = this.onGround || this.vy === 0;
      const applyRunFriction = () => {
        const fr = grounded ? runSlow : runSlow * 0.5;
        if (this.vx > fr) this.vx -= fr;
        else if (this.vx < -fr) this.vx += fr;
        else this.vx = 0;
      };
      // ★BJ705-G26（2026-10-22）[g25-glide-else-friction] 清偿:滑行期（dashDelay<0）
      //   HorizontalMovement else 链摩擦支 1:1 落地（原版 :20187-20196 `vy==0` 地面
      //   runSlowdown / :20202-20212 空中 ×0.5 加法钳 0——两摩擦支【不闸 dashDelay】,
      //   1456 :19771-19800 同形;1457 全速两支删门（:19975/:20033）由 dashMovement
      //   滑行支 :9561 承载,爬坡两支保门（:20091/:20121）——else 摩擦两版恒在,旧仓
      //   整段 1456 形门漏滑行期=滑行独占纯阻尼）。G25 期「净效≈阻尼带重叠 2-3 拍」
      //   估量勘误:oracle 重导=摩擦逐拍全程叠加（先摩擦后阻尼,:26889→:26958 序）,
      //   接地滑程 36→21 拍/悬空 36→28 拍,出口钉值不变（dashDelay=num17、vx=±num15）。
      //   谓词=vanilla 字面 this.vy===0（applyRunFriction 的 onGround 复合=正常支既有
      //   接地面,坡面瞬态拍两谓词可分,勿合并）。门=!grapple/!tongued（原版两支
      //   :27598 else 整段不跑 HM——挂爪拍写面被 grappleMovement 覆写净零,舌缚拍被
      //   舌拖 position+=velocity 消费=泄漏面,故门死）;pulley（绳支无 HM :26366）/
      //   pogo（:19921 早退）由外层门承载;矿车=骑乘早退不可达;矿车钳臂（:20151）
      //   同不可达不建模。调用位序=本 HM 段先于 dashMovement（≙原版 :26889→:26958）。
      const glideElseFriction = (): void => {
        const fr = this.vy === 0 ? runSlow : runSlow * 0.5;
        if (this.vx > fr) this.vx -= fr;
        else if (this.vx < -fr) this.vx += fr;
        else this.vx = 0;
      };
      if (ix !== 0) {
        // :19546-19556：itemAnimation 窗内仅锁【朝向】不锁移动（挥砍中可跑）——
        // useTurn 物品（工具族）豁免
        if ((!animBusy || this.itemUseTurn) && mountAllowDir && !sandStormActive) this.facing = ix;
        // 跑靴脚步声冷却（Item_17，IntendedCooldown 9t :35517）
        if (this.runSoundDelay > 0) this.runSoundDelay--;
        // ★BJ705-G25:朝向/声冷却随 :19963-19977 ChangeDir 位（分支链前）留滑行期
        //   放行（原版 H-movement 不闸 dashDelay——滑行反向转向照跑）;下方整合段
        //   （加速/爬坡/摩擦）主门保 1456 形（滑行反向制动由 dashMovement 滑行支
        //   承载）;滑行 else 摩擦面已随 BJ705-G26 清偿（本门 else-if 臂+else 臂,
        //   见 glideElseFriction 注）。
        if (this.dashDelay >= 0) {
          const canRamp = this.vy === 0 || wingsLogicEff > 0 || !!(mnt && mnt.canFly(this));   // :20091/:20121 内门三支
          const toward = ix * Math.max(maxRun, canRamp ? accRun : 0);
          // 全速段（|vx| 未到 maxRun → 加速;反向先 runSlowdown 制动 :19563-19568）
          if (ix > 0 ? this.vx < maxRun : this.vx > -maxRun) {
            if (ix > 0 ? this.vx < -runSlow : this.vx > runSlow) this.vx += ix * runSlow;
            this.vx += ix * runAcc;
          } else if (ix > 0 ? this.vx < accRun : this.vx > -accRun) {
            // 慢爬坡段（:19675-19690:×0.2,翼飞行双份）。1457: 爬坡分支删 `!slow && !burned`
            // 门（:20091/:20121 只剩 dashDelay>=0——本段在外层 1456 形门内已承载）——
            // 减速改由 accRun×strongestSlow 承担（上面已乘），Slow/Burning 下仍可爬坡但上限被压
            // ★BJ705-G25 [g23-coast-band-friction] 清偿:分支选择改带内面（≙原版
            //   :20091/:20121 else-if 链选支）——!canRamp（无翼滞空 vx∈[maxRun,accRun)
            //   持向）=分支选中而内门假 →【无写=滑行保持】（原版无 else 摩擦）;
            //   旧仓 canRamp 假折进 else 空气摩擦 0.1/t 衰减=瓶跳弧/滑行出口后
            //   横速渐失面。带内滑行期不可达（|vx|>num15≥maxRun）=内层无需重门。
            if (canRamp) {
              if (ix > 0 ? this.vx < -runSlow : this.vx > runSlow) this.vx += ix * runSlow;
              this.vx += ix * runAcc * 0.2;
              if (wingsLogicEff > 0) this.vx += ix * runAcc * 0.2;   // :20096/:20126 第二份（wingsLogic>0）
              // 跑靴快速奔跑尘+脚步声（:19697/:19731）：★尘门【嵌套在爬坡分支内】——
              // 分支入口门 vx<accRunSpeed 与尘门 vx>(accRunSpeed+maxRunSpeed)/2 构成
              // 互斥带，裸装 accRun==maxRun==3 → 带 [3,3) 为空 → 永不触发（原版裸装
              // 跑动无尘无声，2026-08-17 用户原版实测纠偏；此前误作全局门，裸装锯齿
              // 3.04 越线误触发）
              this.spawnFastRunParticles(game, maxRun, accRun);
            }
          } else {
            // 超帽回落（:19771/:19786——持键越帽同摩擦）。
            applyRunFriction();
          }
          this._maxRunProbe = Math.max(accRun, toward);
        } else if (ix > 0 ? this.vx >= maxRun : this.vx <= -maxRun) {
          // ★BJ705-G26 [g25-glide-else-friction] 清偿·持键臂:滑行期持键落 else 摩擦支
          //   （全速支补集=同向越帽 |vx|≥maxRun,或带内 [maxRun,accRun) 爬坡支闸
          //   dashDelay 落空）;反向输入/带尾 |vx|<maxRun 落全速支（dashMovement :9561
          //   承载）不达本臂。挂爪/舌缚门=原版 HM 整段不跑（见 glideElseFriction 注）。
          if (!this.grappling[0] && !this.buffs.has(BuffType.TheTongue)) glideElseFriction();
        }
      } else {
        // 无输入减速（:19771-19800:地面 0.2 / 空中 0.1 加法钳 0）。
        //   ★BJ705-G26 [g25-glide-else-friction] 清偿·无键臂:滑行期 else 摩擦同支
        //   （原版 else 链无键恒落摩擦两支,不闸 dashDelay——BJ524/BJ527 钉值锁已随迁
        //   摩擦时间线;挂爪/舌缚门同持键臂）。
        if (this.dashDelay >= 0) applyRunFriction();
        else if (!this.grappling[0] && !this.buffs.has(BuffType.TheTongue)) glideElseFriction();
      }
      // ★SW-BJ59 滚轴鞋轨面刹车火花（Player.cs:19996-20060 两镜像支 1:1）：
      // 贴轨 ∧ vy==0 ∧ itemAnimation==0 ∧ 输入与运动反向（controlLeft∧vx≥0 /
      // controlRight∧vx≤0）→ Item_55 滚轮声 + 三档速度掷位 WheelSparks
      // （delegations 缺省臂 = DelegateMethods.Minecart.Sparks，dust 213——
      // MountDelegatesData ctor :125-130 空表即缺省,滚轴鞋 delegations 未覆写）。
      // 矿车实体侧同面在 Minecart.emitWheelSparks（本仓不混用,实体域独立）
      if (this.onTrack && this.vy === 0 && this.itemAnimTicks <= 0
        && ((this.inputLeft && this.vx >= 0) || (this.inputRight && this.vx <= 0))) {
        game.playSfxFile?.('Item_55', 1, this.x + this.w / 2, this.y + this.h / 2);   // :19997
        const absVx = Math.abs(this.vx);
        const sparkAt = (mul: number): void => {
          const mp = magnetPosition(this.x + this.vx * mul, this.y + this.vy * mul, this.w, this.h);
          this.skateSparkDust(game, mp.x, mp.y);
        };
        if (absVx > maxRun * 0.66) {                     // 档2（:19999-20007）：三位各 50%
          if (Math.random() < 0.5) sparkAt(0.66);
          if (Math.random() < 0.5) sparkAt(0.33);
          if (Math.random() < 0.5) sparkAt(0);
        } else if (absVx > maxRun * 0.33) {              // 档1（:20008-20019）：两位各 2/3
          if (Math.random() < 2 / 3) sparkAt(0.5);
          if (Math.random() < 2 / 3) sparkAt(0);
        } else {                                         // 档0（:20020-20023）：原位恒一发
          sparkAt(0);
        }
      }
      // 强风推力（buff 194：UpdateBuffs :11923-11926 置 windPushed；CanBePushedByWind
      // :19869-19893 三排除=锁 tile/滚轴鞋坐骑(IsRollerSkates={57,58,59,60},MountID.cs:19)/
      // 坐骑着地持键。★矿车分支整段早退吃不到推力——原版矿车非滚轴鞋且未持键时
      // CanBePushedByWind 为真、flag2 照推（红队 B4 备案，本仓矿车链独立未接）。
      // flag2 应用段 :20221-20232=向风速目标推、不越过。★原版 |num2|×40 只作用于
      // cap-slam 分支的减速修正(:19944 num)，本仓两段加速链无该结构，差异备案
      const rollerSkates = !!mnt && mnt.type >= 57 && mnt.type <= 60;
      if (this.buffs.has(BuffType.WindPushed) && !rollerSkates && !(mnt && this.vy === 0 && ix !== 0)) {
        const wind = world.weather?.windSpeedCurrent ?? 0;
        if (wind !== 0) {
          const push = windPushImpulse(wind, this.vy !== 0, ix !== 0);
          if (push < 0 && this.vx > push) { this.vx += push; if (this.vx < push) this.vx = push; }
          else if (push > 0 && this.vx < push) { this.vx += push; if (this.vx > push) this.vx = push; }
        }
      }
      }   // ★BJ717-A F7:!pogoFired 整合段门闭
    }
    // （★BJ705-G25 退役:旧「滑行期朝向」else-if 支——参数链随 !pogoFired 放行后,
    //   朝向随 :19963-77 ChangeDir 位在主块内承载（滑行照跑）,本支不可达零删;
    //   滑行朝向语义不变）

    // 绳索攀爬 + pulley 悬挂（原版 Player.cs:26366-26694 pulley 大块的本仓合流。
    // ★BJ570（2026-10-08）支门补 this.pulley——原版绳上态=pulley 唯一（调用门 :26320
    // +FindPulley :19776-19855 按↑/↓且头格绳吸附【当拍置位】+:26328/:26500 两大块
    // 状态机/清除/X 钉列/垂直链/帧推进/DashMovement(:26691) 全在 pulley 位内）,非
    // pulley 身体贴绳不存在攀爬/悬浮态=正常重力穿落。旧「身体中心格为绳即攀」无门
    // 合流造出原版不存在的 pulley=false 贴绳态（跳上绳静悬浮/空格攀/孤格悬浮——滑轮
    // 门 :3036 读 pulley 恒不画=用户复报「静止不显、按上下键吸附后才显」BJ570）,
    // 整支退役落主移动支（重力/跳跃/冲刺照常,MV1② dashDelay 主路径照推进）。
    // 中心格脱绳但 pulley 未离（绳端/孤立绳格——头格仍绳）走 :26503-26649 绳端支
    // =branch2 不变；空格攀爬键面差异（pulley 态内 inputJump 攀爬,台账⑥ 登记）不变）
    // 坐骑飞行 vy 独占标记（本 tick 悬停/飞行接管时置 true）——下方"松键截断上升"
    // 手感段须让位：原版 Player 无此截断，且 Hover 接受 controlUp 单独爬升
    //（Mount.cs:3396-3424），截断会把不按跳的爬升当场掐死
    let mountFlight = false;
    const st = world.store;
    const ropeTx = Math.floor((this.x + this.w / 2) / TILE);
    const ropeTy = Math.floor((this.y + this.h / 2) / TILE);
    const ropeHere = !!(st.inBounds(ropeTx, ropeTy) && st.flags[st.idx(ropeTx, ropeTy)]
      && TILE_DEFS[st.type[st.idx(ropeTx, ropeTy)]]?.rope);
    this.onRope = ropeHere;
    // ★BJ570（2026-10-08）：支门补 this.pulley——原版绳物理全在 pulley 位内（:26500）,
    // 非 pulley 贴绳=未吸附正常穿落（:26320 门未过）；旧无门合流使 pulley=false 贴绳
    // 态可达（BJ570 病灶,判别 tests/bj559-rope-pulley-draw T8后半/T10/T11,M7 变异位）
    if (this.pulley && ropeHere && !this.inWater) {
      // ★BJ-C8（R7-F2）flag15 收口门（:26521-26528）：(y−16) 行（num37）非绳 →
      //   vy<0 钳 0（越顶拍收口）——攀爬臂本体另受 controlUp&flag15 门（:26531,
      //   ropeClimbVy 形参）。旧无门=越顶弹飞+oscillation（探针 pulley 真 196/600）,
      //   修后头格止于顶绳格 pulley 恒真静悬。
      const flag15 = this.isRopeAt(st, ropeTx, Math.floor((this.y - 16) / TILE));
      if (!flag15 && this.vy < 0) this.vy = 0;                         // :26523-26526
      // 攀爬速度链（Player.cs:26016-26125——见 ropeClimbVy 注;flag15 门=:26531）
      this.ropeClimbVy(flag15);
      this.fallStartY = null; // 绳上不计摔伤
      // ★BJ527（2026-10-05）绳面冲刺状态机：原版 pulley 移动支 :26691 在支尾【无条件】
      // 调用 DashMovement()（与主移动支 :26958 同形,1914 反编译行号系 1456 旧锚,行为
      // 同一）——绳上可发起冲刺（就绪段 DoCommonDashHandle 键面/双击两源照跑）、冷却/
      // 滑行三态照常推进。发起拍 X 仍钉绳列（原版块序：X 吸附→垂直链→DashMovement）,
      // 发起置 vx=±16.9/14.5/21.9 后下一拍 :26475 `velocity.X != 0 → pulley=false`
      // 落绳续滑——绳上冲刺=一拍挂绳+空中滑行,两引擎同构。本支与非 pulley 绳攀共用。
      // ★MV1（2026-10-06）撤 this.pulley 门：非 pulley 绳攀（身体中心落绳）同样每拍
      // 调 DashMovement——原版无此分支重定向（:26958 主移动支无条件）,门把「滑行中
      // 穿过绳格」的拍全部漏掉 = dashDelay 冻结 -1、阻尼不跑（定谳:滑行穿 11 格绳带
      // vx 恒 14.5 漂 +180px,绳场越宽漂越远）。ix 传 0：dashMovement 滑行支的输入
      // 加速/制动块承载的是 HorizontalMovement Run 支（:26889 落主移动支 else-if 链,
      // 绳索支整段不跑 :26366）——原版绳面滑行=纯阻尼,无输入贡献。
      // ★BJ559（2026-10-08）滑轮帧推进：原版 :26661-26681 在 pulley 块尾（X 吸附
      // 后/DashMovement 前）无条件执行——本支按 pulley 门收窄（非 pulley 绳攀=
      // 原版不存在的攀爬态,滑轮贴图门同为 pulley,不合帧）。
      if (this.pulley) this.advancePulleyFrame();
      this.dashMovement(game, eqM, 0, maxRun, accRun, runSlow, runAcc);
    } else if (this.pulley) {
      // 绳端悬挂支（:25985-26137）：头格列/行 num34/num36，上下邻格（:25998 flag17）
      const num34 = Math.floor((this.x + this.w / 2) / TILE);
      const num35 = Math.floor((this.y - 16) / TILE);        // :25994 上身格行
      const num36 = Math.floor((this.y - 8) / TILE);         // :25995 头格行
      const midRope = this.isRopeAt(st, num34, num36 - 1) || this.isRopeAt(st, num34, num36 + 1);
      if (midRope) {
        // ★BJ-C8（R7-F2）flag15 收口门（:26521-26528+:26531）——同 branch1：
        //   (y−16) 行（=num35）非绳 → vy<0 钳 0+攀爬臂不可达
        const flag15 = this.isRopeAt(st, num34, num35);
        if (!flag15 && this.vy < 0) this.vy = 0;                       // :26523-26526
        // 中段绳但身体中心已顶出（攀到绳上端）：速度链照走（:26016-26125）
        this.ropeClimbVy(flag15);
      } else if (this.inputDown) {
        // 孤立绳格按下 → 穿落（:26642-26647;1456 伪锚 :26127-26132 勘正）：ropeCount=10 拦 FindPulley 十 tick
        this.ropeCount = 10;
        this.pulley = false;
        this.vy = 1;
      } else {
        // 挂在绳端（:26133-26137）：vy 钉 0、y 钉上身格顶+22
        this.vy = 0;
        this.y = num35 * TILE + 22;
      }
      this.fallStartY = null; // 绳上不计摔伤（:25987 fallStart）
      // ★BJ527：绳端/浸水支同面补位（原版 :26691 同一调用位=pulley 块尾无条件——
      // 含 :26644-26648 inputDown 穿落离绳拍,原版离绳拍块尾照跑 DashMovement;
      // 中段浸水 pulley 也落本支=branch1 的 !inWater 门让位）。ix 同上传 0（绳面无
      // Run 支,见上支注）。
      // ★BJ559：帧推进支尾无条件=原版 :26661 块序（穿落拍 pulley 已置假、vy=1
      // 照推进——原版块内无 pulley 复查）。
      this.advancePulleyFrame();
      this.dashMovement(game, eqM, 0, maxRun, accRun, runSlow, runAcc);
    } else
    // ★BJ704-G12（G5 登记债1 清偿,2026-10-21）：未骑乘微光早退近似支【退役】——
    //   原版 shimmerWet（非微光化浸微光）无独立物理分支,与普通湿态同链：湿档表
    //   :24590-24592 gravity **0.15 平值**（非 GRAVITY×0.15）/jump 23·5.51
    //   （UpdateJumpHeight :19714-19758 尾段再叠 jumpBoost 钳/jumpSpd 加成）/
    //   maxFallSpeed 不覆写=10.01（:24631 +0.01）;:24884 ×num6 含微光;位移
    //   WetCollision 0.375（num113 :28381,liqFactor 段既有）;跳门=标准水跳门
    //   （jumpEdge∧踩底/脚蹼,JumpMovement :20845——非按住即升的连续游升）。
    //   旧近似（持跳 0.62 游升无跳门/GRAVITY×0.15=0.06 重力错基/±[-5.5,3.0] 带）
    //   全数退役,由下方湿支 shimmer 档（G5-④ 落地,:24581-24593 序在 wet 前）承接;
    //   骑乘 !ridingMount 门随整支删除——骑乘/未骑乘同走湿门微光臂（原版参数表无
    //   骑乘分叉,UpdateJumpHeight 骑乘覆写序内建）;MV1 dash 补位由湿支 dashMovement
    //   同拍承接（滑行入池 dashDelay 照推进,tests/mv1 判别锁仍在）。
    if (this.shimmering) {
      // buff 353（:11381-11388）：frozen 封输入（输入清零在上方移动积分前的
      // Frozen∪Shimmering 段执行——此处只做物理）+ fallStart 重置（免摔伤）；
      // 物理 :24117-24119 gravity/maxFall ×0.9——速度只用于积分，位移走下方
      // :27868 的 velocity×0.375 穿墙下坠（绕过 tile collision）
      // ★BJ704-G12（G5 登记债2）：重力/终速对齐原版字段链——:24585 gravity×0.9
      //   后 :24884 无条件 ×num6（旧 GRAVITY×0.9 平值=太空带 4× 偏重;就地 fresh 算
      //   同 mountGField 式,本支在重力块前无同拍字段可读）;maxFallSpeed :24586 ×0.9
      //   → :24631 +0.01 = **9.01**（旧 PLAYER_MAX_FALL_SPEED(10.01)×0.9=9.009 差
      //   0.001——原版 +0.01 在 ×0.9 之后追加,不可交换）。
      const n5Sh = (world.w / 4200) ** 2;
      let num6Sh = (this.y / 16 - (60 + 10 * n5Sh)) / (world.groundLevel / 6);
      if (world.seedFlags?.remix) num6Sh = (this.y / 16 - (60 + 10 * n5Sh)) / world.groundLevel;
      num6Sh = Math.min(1, Math.max(world.seedFlags?.remix ? 0.1 : 0.25, num6Sh));
      if (Number.isNaN(num6Sh)) num6Sh = world.seedFlags?.remix ? 0.1 : 0.25;   // FX20 同款防灌
      this.vy = Math.min(this.vy + GRAVITY * 0.9 * num6Sh, 10 * 0.9 + 0.01);
      this.fallStartY = null;
      // ★MV1（2026-10-06）冲刺状态机补位：原版 shimmering 亦不重定向移动支（CCed 只
      // 封输入 :25436,:26958 照跑）——本支此前整漏 = 微光化期 vx 恒速漂移。输入已被
      // 上方 Frozen∪Shimmering 段清零 → ix 恒 0（纯阻尼,与原版 CCed+阻尼同相）。
      this.dashMovement(game, eqM, ix, maxRun, accRun, runSlow, runAcc);
    } else if (this.buffs.has(BuffType.Webbed)) {
      // 结网(149)（Player.cs:11459-11476）：本帧 velocity 清零（下落中留 1e-6 缓降）、
      // gravity=0、jumpHeight=0、moveSpeed=0（已走 moveSpeedMult）、dash 归零、
      // 免击退；摘钩 RemoveAllGrapplingHooks（:11476——幂等，多帧重复调用无害）
      this.vx = 0;
      this.vy = this.vy !== 0 ? 0.000001 : 0;
      this.fallStartY = null;
      this.removeAllGrapplingHooks();
      // ★C5-B3（2026-10-06）dash 归零落地（:11965-11966 `dash = 0; dashType = 0;`
      //  ——旧注释自称"dash 归零"但从未落码=伪注）。dashType=0 的原版净效仅到同拍
      //  UpdateEquips（:25830 晚于 UpdateBuffs :25763）重推导=瞬态;dash=0 的净效：
      //  本拍 DashMovement derive（:21217 dashDelay==0 才推导）在滑行/冷却态
      //  （dashDelay≠0）被跳过 → dash 保持 0 → :21221 `dash==0 → dashTime=0;
      //  dashDelay=0` = 滑行/冷却拍内清零即时就绪（无 20/30t 虚假冷却;若结网拍本已
      //  就绪,derive 同拍重推导装备档=:21221 不触发,窗自然衰减=原版同相）。
      //  dashLatched=0 同时关 eoc/日曜/dash6 扫敌门（:21225/:21293/:21354 dash 位）。
      //  结网期不可再发起（CCed 键面闸在 dashKeyNum/dblTap 双门）。
      this.dashLatched = 0;
      this.mountDash6Active = false;
      // ★MV1（2026-10-06）冲刺状态机补位：原版 webbed=CCed（:3365 CCed 定义 frozen∨
      // webbed∨stoned）——输入封零但 :26958 DashMovement 照跑（在 :27000 CCed 块之前
      // = 不受其闸）→ 结网拍滑行态照常收敛退出（vx=0 → |vx|≤num15 → dashDelay=20）。
      // ★C5-B3 起本支已先行清 dashDelay（:11965 dash=0 净效）→ 本调用走就绪支
      // （dashLatched 0/derive 相）,旧"滑行收敛落冷却"面退役（MV1④ 期望已翻正）。
      // ix 传 0=CCed 封控制等价（原版控制已清,滑行制动块/出口 vx==0 择向键臂均不可达;
      // ★MV2（2026-10-06）债②起本仓 webbed 在 :5261 CCed 块清全控制面——出口臂改读
      // 已清的 inputLeft/Right,与原版恒保持 0 同相;此处传 0 仍为滑行制动臂承载位）。
      this.dashMovement(game, eqM, 0, maxRun, accRun, runSlow, runAcc);
    } else if (this.buffs.has(BuffType.VortexDebuff)) {
      // 星旋减益(164)：gravity=0（:24162-24164）+ vy 摆动（:27854-27857：
      // vy×0.8 + cos(cx%120/120×2π)×5×0.2——按世界 X 相位正弦悬浮）
      this.vy = this.vy * 0.8 + Math.cos((this.cx % 120) / 120 * Math.PI * 2) * 5 * 0.2;
      this.fallStartY = null;
      // ★MV1（2026-10-06）冲刺状态机补位：原版 vortexDebuff 不重定向移动支（:24627 只
      // 改 gravity,:28374 只摆 vy——:26958 无条件照跑）——本支此前整漏 = 用户实报主面:
      // 星旋敌持续在场期间 dashDelay 冻结 -1、vx 恒 14.5px/t 漂移 120t=+1740px,松键/
      // 反向键/再按键全部无效。输入原版不封（非 CCed）→ 传实 ix（滑行反向制动照常）。
      this.dashMovement(game, eqM, ix, maxRun, accRun, runSlow, runAcc);
    } else
    // ---- 跳跃参数链（每帧先于物理求值：UpdateJumpHeight :19301-19341 + 坐骑档
    //      Mount.JumpHeight/JumpSpeed :19307-19308——原版 jumpHeight/jumpSpeed 是
    //      玩家字段，液体链 :24130-24155 在湿态覆写；sustain 段消费当帧生效值）----
    //      ★SW-FX47（e）：base 段抽为 jumpBaseSnapshot() 单源——移动相头弹跳臂
    //      前置快照（原版 :26211 UpdateJumpHeight 调用位先于 :26889
    //      HorizontalMovement）与本链共用一份 base 公式,防两处漂移。
    {
      const gd = this.gravDir;      // 倒挂物理臂/湿档臂同块续用（下方既有消费）
      const mnt2 = this.ridingMount ? this.mount : null;
      const eqJ = eqM;
      const { spd: mJumpSpd0, ticks: mJumpTicks0 } = this.jumpBaseSnapshot(this.vx);
      // 蜂蜜块【地面】sticky 跳削弱（Player.cs:19343-19346：jumpHeight/=10（整数除）、
      // jumpSpeed/=5——在坐骑赋值【之后】=坐骑跳同样被削；与泡块阻尼
      // （StickyTiles :22650+）不同链；dazed 同位点（:19350-19353 jumpHeight/=5、
      // jumpSpeed/=2——1458 施加面=美杜莎之首 PvP 命中族,BuffType.Dazed 已入档,
      // 终零波 接入本同位点）。折叠凳 IsInUse +5（:19337-19340）已在 baseJumpTicks 前段
      let mJumpSpd = mJumpSpd0, mJumpTicks = mJumpTicks0;
      if (this.floorTileT === HONEY_FLOOR_ID) {
        mJumpTicks = Math.floor(mJumpTicks / 10);
        mJumpSpd /= 5;
      }
      if (this.buffs.has(BuffType.Dazed)) {                     // :19762-19766 dazed
        mJumpTicks = Math.floor(mJumpTicks / 5);
        mJumpSpd /= 2;
      }
      // 本帧生效跳跃速度（湿态液体档覆写；长跳 sustain 钉速用它——原版钉的是当帧
      // jumpSpeed，出水瞬间自动切回干燥档）
      let effJumpSpd = mJumpSpd;
      this.jumpSpeedField = mJumpSpd;   // ★SW-FX47（e）：拍末快照改由移动相头前置写
                                        //  （弹跳臂当拍消费,原版序 :26211→:26889）;
                                        //  本行保留为拍末字段态（无游戏内消费者,
                                        //  sw-fx40 域E 测试读数面）
      this._curJumpTicksCap = mJumpTicks;   // ★附带①：当帧 jumpHeight 等效值（clip 段尾消费）
      // 起跳帧标记（原版 JumpMovement 的 if(jump>0)/else-if(起跳) 同帧互斥——
      // 起跳帧不进 sustain，平台段全长 = 起跳帧 + jumpHold 帧）
      let jumpStartedThisTick = false;
      // 手持三叉戟 277（UpdateEquips :12487-12490：手持即 trident，非装备槽）
      const heldIt = this.inv.heldItem();
      const heldVid = heldIt ? (ITEM_DEFS[heldIt.id]?.vid ?? (ITEM_DEFS[heldIt.id].vid ?? -1)) : -1;
      const trident = heldVid === 277;
      // 跳键沿（releaseJump 等价，JumpMovement :20845 消费门 `(releaseJump ||
      // (autoJump && (velocity.Y == 0 || sliding)))`——原版按住跳键落地【不会】自动
      // 连跳（releaseJump 仅在 !controlJump 帧 :21204 置真），须松键再按；autoJump
      // 是蛙蹼族配饰/系统设置授予的免松键档（:14507 等）。R5-F11/F12：旧 held 门
      // （inputJump+vy>-2+8t cd）= 全员恒 autoJump 语义，已废）
      const jumpEdge = this.inputJump && !this.jumpEdgePrev;
      // flag19 翅膀飞行中（:26987）——干/湿两支共用声明（湿态扇动支 2026-09-03 翻案落位）：
      // 原版翅膀链（flag19 :26987 → WingMovement :22203 → WingFrame :26497）全程【无 wet
      // 门】——水中翅膀照常工作（唯一 wet 相关 = merman 挡 WingAirLogicTweaks 横移覆盖
      // :26688，Run 段本仓干湿同链无分叉无需补）。本仓旧版把整块锁进干燥分支 else =
      // 水中翅膀恒死 + 湿态踩底不回满 → 翼装玩家 wingTime 干涸落水后即困死弹跳环
      // （用户行为日志 2026-09-03 Starter World：Red's Wings+脚蹼，池底到水面仅 3 格
      // 仍无法脱离飞起）。湿侧核心见下方湿分支 ★湿态翅膀核心段。
      let flying = false;
      // ★BJ717-A F1+F8（2026-10-25,R13 P0/P2 清偿）：长跳平台段 sustain 钉——
      //   原版序=JumpMovement 钉(:20831,Update 内调用位 :26945)→重力(:27556
      //   `velocity.Y += gravity*gravDir`)→积分(:28385),平台拍积分速度=-js+grav
      //   （地表 -4.61）;旧仓钉位在重力【后】=钉覆写重力,平台拍恒 -5.01,全持跳
      //   apex +10.6px≈+11%（SW 108.7 vs vanilla 98.07）。本闭包随两分支臂段尾调用
      //   （湿 :7641 前/干 :8134 前,≙原版 JumpMovement 位=飞行链/重力【前】）。
      //   oracle 双证:vanilla-headless harness（tools/voracle,S1 全持跳逐拍
      //   vy=-4.61×16t+弹道,apex=98.07px=6.13 格恰合「裸跳六格」）+解析模型
      //   108.68 自证（probe4b 修前 108.7 逐位吻合=SW 侧测量面可靠）。
      //   ★F8 连带：钉写去 !mountFlight 门——原版钉无条件（:20831）,坐骑 vy 链
      //   （:27158）在其后覆写 vy=终值同,而 sustain 副作用（jump--/swimTime 刷 30
      //   :20832-36）照跑;旧仓门=吞 merman swimTime 刷新（oracle S8c:骑 49 熔岩鲨
      //   水中持跳,swimTime 10→29 周期刷新,vy 由坐骑悬停接管 -5.9 恒速=两写并存）。
      //   ★相位族连带（G23 备案「自然耗尽一拍滞后」就此根治）:翼飞行/飞毯/坐骑
      //   canFly 各门读 sustain【后】jumpHold（≙原版 :26987/:26945 序）,耗尽拍当拍
      //   可开门;boost 窗（:6953 域）在参数链=读 sustain 前值,两版同序不动。
      const sustainPin = () => {
        // ★BJ705-G25 [g23-sustain-grapple-freeze] 清偿（:26692 else-if 门）:原版
        //   JumpMovement 在 grappling/tongued 支【整段不跑】=挂爪/舌缚期预算【冻结】
        //   （不钉速、不流逝、不清零——vy 由 GrappleMovement/WoFTongue 独占）;收爪后
        //   冻结余量续跑。旧仓 sustain 常规支照跑=滑行中烧预算+松键清（G25 已清偿）。
        if (this.jumpHold > 0 && !jumpStartedThisTick
        && !this.grappling[0] && !this.buffs.has(BuffType.TheTongue)) {
          if (this.vy === 0) this.jumpHold = 0;
          else if (!this.inputJump) {
            // ★BJ705-G23 [g19-jump-release-zero] 清偿：原版 else 支（:21201-21208）松键即
            //   jump=0——剩余预算丢弃,半空再按不恢复钉速;CCed 同构（:25432-34）。
            this.jumpHold = 0;
          } else {
            // ★BJ705-G25 [g23-merman-sustain-infinite] 清偿（:20832-36）:merman&&!cart
            //   支原版【不减计数】（if/else 同体:swimTime≤10 刷 30 置换 jump--）=湿态
            //   无限 sustain——持跳水中恒钉 -jumpSpeed 连续泳升;旧仓照减=15 拍脉冲化
            //   （泳升须反复点按）。防再登记:勿以「计数器必须流逝」直觉回加 jump--
            //   （ramp 消费面读 wingsLogic 不读 jump）。
            const mermanSustain = this.merman && !this.ridingCart;   // :20832 原文读 merman 变身态
            this.vy = -effJumpSpd * gd;          // :20831 钉（重力在链后 +grav → 净 -js+grav,BJ717-A F1）
            if (mermanSustain) {
              if (this.swimTime <= 10) this.swimTime = 30;   // :20834-36 无条件（BJ717-A F8:去 mountFlight 门）
            }
            if (!mermanSustain) this.jumpHold--;  // :20838 jump--（controlJump 门内）
          }
        }
      };
    // ---- ★F2/Note① 移动相三段时序归位：HorizontalMovement 尾五分块
    //      （1457 Player.cs:20238-20320 CollideWithNPCs，随 HorizontalMovement :26889 跑）
    //      先于 JumpMovement 三踩踏循环（:20693-20801，JumpMovement :26945 头部），
    //      再进 controlJump 清湿——本仓自 F6 批的"移动相尾（摔伤段后）双通道"位次
    //      上提到跳跃门前。同帧脚底带+面向带双候选仍按原文常数集由横撞先手
    //      （高尔夫车 17：kb10/npc 免疫30/玩家钟12 vs 竖踩 kb5/npc 免疫12），第二通道
    //      因 npc immune≠0 门自然落空；DashMovement 全结算面（含 dash==6 冲撞命中）
    //      天然排在本位之后=原文 :26958 序。D1 横撞族阈值/伤害/击退/免疫档见
    //      MountCombat.chargeConfigs；踩踏三支参数见 SLIME_STOMP/GOLF_CART_STOMP。
    //      速度语境红利：横撞阈值从此读 DashMovement 阻尼【前】的 vx（原文位置等价
    //      ——阻尼在 DashMovement :21424+ 才跑）。
    mountHorizontalCharges(this, game);
    mountJumpStomps(this, game);
    // ★BJ534 B 支下砸踩踏接线（JumpMovement :20731-20765——isPerformingJump_DownDash &&
    //   vy>0 脚底横带扫掠,同盒同值 40×minionDamage/kb5/immune10/GiveImmune6/sourceItem
    //   5465,无弹跳）。A/C 支要求坐骑、下砸态要求非骑乘 ⇒ 三支互斥,调用位序等价原文
    //   （:20731 在 A :20693 与 C :20768 之间——互斥域内先后不可观测）。触发帧本站先于
    //   跳跃面 flag13 置位跑 = 与原文同拍序（触发帧不踩,次拍起 vy>0 逐帧扫）。
    if (this.isDownDashing && this.vy > 0) ramRuneDownDashStomp(this, game);
    // 控跳清湿（JumpMovement controlJump 头部，1457 :20805-20818 / 1456 :20366-20379）：
    // 骑史莱姆族坐骑时按住跳键即清 wetSlime——★原版 gate 无液体位置要求：controlJump
    // 块内直接判 mount.Active/IsSlimeMount/wetSlime>0，陆上残余同样按跳即刻清除（旧版曾
    // 把消费点嵌进下方水中分支 → 出水湿残余 ~30t 抑制踩踏且陆地按跳无法提前解压，
    // 2026-08-30 R3 复核外提）。★终零波批注订正（2026-09-01）：旧注"flag2&&flag3
    // 组合门本仓未整体建模,出水跳仍走 vy==0/脚蹼门（近似）"退役——下方 ★D2 支已落
    // （justClearedWetSlime=JumpMovement flag 仓内形,进入起跳门 :20845 外门）。
    // ★Note① 节拍复原：consumeWetSlimeOnJumpControl 自 stompSweep 【之后】调用——
    // 恢复 vanilla"三踩踏循环先于 controlJump 清湿"的函数内先后（湿帧落地按住跳：
    // 先判踩（wetSlime>0→竖踩 A 支拒绝）、后清湿、下一拍才可踩），拆分点=上一行
    // mountJumpStomps 与本行之间的分界。
    // ★D2 出水起跳链（JumpMovement :20813-20818 + 外门 ：20845）：清湿发生的这一帧
    //  = 原文 flag=true——干门 `(sliding||vy==0)|flag` 放行任意 vy 的起跳（史莱姆坐骑
    //  水中起跳的完整链；旧近似只认 vy==0/脚蹼，出水跳全靠踩底）。该旗与 flipperJump
    // （flag2&flag3 的仓内形）并列进下方湿段起跳门。
    const justClearedWetSlime = consumeWetSlimeOnJumpControl(this);
    // 原版 wet 位（红队 R1-F5/F10 2026-09-03）：Collision.WetCollision 对任意液体成立
    // （Collision.cs:1608 `liquid > 0` 无 lava/shimmer 排除、:1627 首中即返）——wet 含
    // 岩浆+微光+蜜。本仓 inWater 是"去岩浆"窄化位、inLava/inHoney/inShimmer 是分桶位
    // （honey/shimmer 桶与 wetCollision 返回同源同盒）→ 四桶并集 ≙ wet。旧注
    // "wet=水∪蜜(:1418)"系把 DrownCollision（呼吸口,Collision.cs:1418 !lava&&!shimmer）
    // 当 wet 位——勘误退役。消费：flipperOn 湿授予（:13115-18）、翼帧 waterFloat
    // （WingFrame :30456/:30724/:30732）、ShouldDrawWingsThatAreAlwaysAnimated :30971
    const wetVanilla = this.inWater || this.inLava || this.inHoney || this.inShimmer;
    // ★BJ534：门帧入口 vy 快照（=JumpMovement 被调时点 velocity.Y——:20935 分支选择/
    //   :20873-20898 flag13 选择全用该时点值）。本仓起跳腿会当帧改写 this.vy（站立起跳
    //   vy≠0、多段跳翻负）,下砸腿的 vy!=0 门必须读【腿前】值 ≙ 原文——站立帧入口 vy=0
    //   （上拍碰撞清零,重力在跳跃面后）= 下砸拒绝;空中帧任意 vy=下砸可达。
    const vyAtJumpGate = this.vy;
    // 跳跃 / 游泳
    // ★BJ704-G12（G5 登记债3 清偿）：swimFree（游泳族坐骑 buff 131/168/279/305 的
    //   ignoreWater，Player.cs:9972-9999——旧注 :9592-9608 系 1456 期锚）骑乘者液体中
    //   【改走湿支】——原版 ignoreWater 只辖碰撞选档（:28398/:28402 DryCollision）与
    //   位移因子（num110 :28309=1,两者均在积分段 ridingMountSwimFree 门既有豁免）,
    //   重力/maxFallSpeed/jumpSpeed 仍走液体档（:24595-24625 湿表对 ignoreWater 零特判
    //   →水/岩浆 0.2·5.01/蜜 0.1·3.01,再 ×num6 :24884）——旧干路 GRAVITY 0.4/10.01
    //   =液体中 2× 偏重（熔岩鲨岩浆悬停的 hover 重力场同偏,fatigue 率 1 vs 原版 0.5）。
    //   跳参无扰：骑乘覆写在液体档后（UpdateJumpHeight :19746-57）=坐骑档终值,
    //   frameState==4 的 +5/+2.5（Mount.JumpHeight/JumpSpeed）经 jumpBaseSnapshot 同源。
    //   ★G5 微光路由保留：swimFree 微光态照旧入本湿门微光臂（gravity 0.15 档）。
    //   ★随行既有债（本刀不扩,湿族共性非 swimFree 专属）：湿跳门无 wallCling 腿
    //   （原版 :20845 sliding 放行,湿态贴墙滑登记）;swimFree buff 的 accFlipper 面
    //   （:10257-10261 ignoreWater+accFlipper 并授——仓内 swimFree 只建模 ignoreWater,
    //   液中悬空泳跃不可达,干湿两路同缺）登记另刀。
    if (this.inWater || this.inLava
      || (this.inShimmer && !this.shimmering)) {   // ★BJ704-G5（G4-④）微光湿门臂保留
      //   （未骑乘微光经 G12 债1 退役早退支后同入本臂;shimmering 骑乘者已在
      //   CCed 下坐门强制下坐=不可达本门）
      // ---- 液体参数档（Player.cs:24130-24155 wet 链；inWater 已含蜂蜜 type3，
      //      岩浆 wet 同链走 else 档）----
      // honeyWet → gravity 0.1/maxFall 3（跳跃参数保持干燥档——原版分支不覆写）；
      // merman → 0.3/7（跳跃参数同保持）；trident 且非岩浆 → 0.25/6 + jump 25/5.51
      // （按住 ↑ 0.1/2 浮升）；其余湿态 → 0.2/5(+0.01) + jump 30/6.01
      // :13115-18 `if (wet && ShouldFloatInWater) accFlipper = true`——4404/buff265
      //  （canFloat 源）湿态授予脚蹼泳跃能力；equipStats.flipper=accFlipper 饰品源、
      //  脚蹼药 109 亦直接授 accFlipper（:10257-59）——两臂各按原版源承运；
      //  wet = 任意液体含岩浆/微光（Collision.cs:1608/:1627，见上方 wetVanilla 注）
      const flipperOn = eqM.flipper || this.buffs.has(BuffType.FlipperPotion)
        || (wetVanilla && this.shouldFloatInWater)
        || (this.ridingMount && this.mount.flipperMount)   // ★BJ704-G13（G12 登记债3）：坐骑 buff 授 accFlipper（:9974-9998 ignoreWater 族 ∪ 265 火烈鸟 :9982-86,无条件授予——非 :13115 浮液面臂的 !inputDown 限宽）
        || this.merman;   // :25779-25781 变身授 accFlipper（2026-09-03 备案清偿②）
      let lGrav = GRAVITY * 0.5, lMaxFall = 5.01;
      let lJSpd = mJumpSpd, lJT = mJumpTicks;
      // ★SW-RB14d：湿档 lMaxFall 补 :24637 无条件 `maxFallSpeed += 0.01f`——原版
      //  该加法在 wet/shimmer/传送门各分支之后逐档生效（3→3.01/7→7.01/6→6.01/
      //  2→2.01;水档 5.01 与干档 10.01 旧已含,同批补齐四档）
      // ★BJ534 下砸湿态档（:24576-24580 else-if 链【首支】——`!shimmering && wet &&
      //  isPerformingJump_DownDash` → gravity×0.85/maxFallSpeed×0.85 于【干基】
      //  （0.4→0.34 / 10→8.5,+0.01 后置 :24631）——压过全部液体档（水下下砸照常快坠,
      //  非游泳 0.2/5.01 档）；jumpSpeed/jumpHeight 不覆写=保持干档（原文该支无此二项）。
      if (this.isDownDashing && !this.shimmering) { lGrav = GRAVITY * 0.85; lMaxFall = 10 * 0.85 + 0.01; }
      else if (this.inShimmer) {
        // ★BJ704-G5（G4-④）shimmerWet 档（:24581-24593 else-if 序在 wet 前）：gravity
        //   0.15 平值（:24590——非 GRAVITY×0.15!）+ jumpHeight 23/jumpSpeed 5.51
        //   （:24591-24592）;maxFallSpeed 不覆写（:24631 +0.01 → 10.01）。仅骑乘可达
        //   （非骑乘微光走上支早退近似）。
        lGrav = 0.15; lMaxFall = 10.01;
        // ★BJ704-G5（G4-①）骑乘覆写在液体档【后】（UpdateJumpHeight :19746-19757）→
        //   骑乘终值=坐骑档;非叠加族不覆写（mJumpSpd/mJumpTicks 即坐骑档终值）,
        //   叠加族（滚轴鞋 57-60）=液体基+坐骑增量（jumpBaseSnapshot 液体基参数单源）。
        if (!mnt2) { lJSpd = Math.max(5.51, eqM.jumpBoost ? 6.51 : 0) + eqM.jumpSpd; lJT = 23; }
        else if (mnt2.movementStatsAdditive) ({ spd: lJSpd, ticks: lJT } = this.jumpBaseSnapshot(this.vx, 5.51, 23));
      }
      else if (this.inHoney) { lGrav = GRAVITY * 0.25; lMaxFall = 3.01; }
      else if (this.merman) { lGrav = GRAVITY * 0.75; lMaxFall = 7.01; }   // :24602 原文读 merman 变身态（非装备位）
      else if (trident && !this.inLava) {
        lGrav = GRAVITY * 0.625; lMaxFall = 6.01;
        // ★BJ260-F1 湿链残项（S6）：覆写后补 UpdateJumpHeight 尾段——原版序=液体档
        //  覆写（jumpSpeed=5.51 :24611-24612）先于 UpdateJumpHeight（Update(i) 内
        //  :26211→:19714），后者 jumpBoost 钳（max 6.51 :19717-19720）+ jumpSpeed
        //  += jumpSpeedBoost（:19745；eqM.jumpSpd 聚合位=装备 1.6 族+徽章 1.8+蛙腿
        //  2.4+月领腿 1.8+狼人 0.2）。旧写覆写平值 → 湿态蛙腿/徽章加成整丢。
        //  ★BJ704-G5（G4-①）骑乘态不覆写（坐骑档终值,见 shimmer 档注）。
        if (!mnt2) { lJSpd = Math.max(5.51, eqM.jumpBoost ? 6.51 : 0) + eqM.jumpSpd; lJT = 25; }
        else if (mnt2.movementStatsAdditive) ({ spd: lJSpd, ticks: lJT } = this.jumpBaseSnapshot(this.vx, 5.51, 25));
        if (this.inputUp) { lGrav = GRAVITY * 0.25; lMaxFall = 2.01; }
      } else {
        // ★BJ260-F1：水档覆写 6.01（:24622-24624）后同补尾段（蜜/人鱼支不覆写=
        //  lJSpd=mJumpSpd 已含加成,勿动）。★BJ704-G5（G4-①）骑乘态不覆写——
        //  原版骑乘湿态水跳=坐骑档（如扫帚 4/10、驯鹿 5.31/17、史后 7.25/10）,
        //  旧液体档 6.01/30 = 骑乘者水下起跳速度/预算双偏;长跳钉/effJumpSpd 同源修复。
        if (!mnt2) { lJSpd = Math.max(6.01, eqM.jumpBoost ? 6.51 : 0) + eqM.jumpSpd; lJT = 30; }
        else if (mnt2.movementStatsAdditive) ({ spd: lJSpd, ticks: lJT } = this.jumpBaseSnapshot(this.vx, 6.01, 30));
      }
      // ★BJ704-G5（G4-⑤a）湿重力 ×num6（:24884 无条件——含湿;maxFallSpeed/jumpSpeed
      //   无乘区）：lGrav 自此=gravity 字段当拍终值,后续毯带/坐骑链（mountGFieldW）/
      //   翼滑翔（glidingW）/终端重力/gField 快照全消费此源（旧各面均未乘=太空带
      //   水池重力 4× 偏重;坐骑链原就地 num6W 重算并入本源=同值收编）。
      {
        const n5W = (world.w / 4200) ** 2;
        let num6W = (this.y / 16 - (60 + 10 * n5W)) / (world.groundLevel / 6);
        if (world.seedFlags?.remix) num6W = (this.y / 16 - (60 + 10 * n5W)) / world.groundLevel;
        num6W = Math.min(1, Math.max(world.seedFlags?.remix ? 0.1 : 0.25, num6W));
        if (Number.isNaN(num6W)) num6W = world.seedFlags?.remix ? 0.1 : 0.25;   // FX20 同款防灌
        lGrav *= num6W;
      }
      effJumpSpd = lJSpd;
      this.jumpSpeedField = lJSpd;      // ★SW-FX40（e）：湿档覆写（:24624 6.01 族）
      // ---- ★BJ227 定谳重定位（2026-09-21 用户实报「水上/液面站一会慢慢沉」）----
      // 旧「水面悬停钉」（canWaterWalk ∧ !headUnderwater ∧ vy≥0 ∧ !↓ → vy=0）退役。
      // 原版湿态运动路径 Player.WetCollision（:23622-23640）【无任何液面钉位】——钉位
      // 只存在于干态 DryCollision→Collision.WaterCollision（:23738/:23774,本文件下方
      // moveAndCollide 后 waterSurfacePinCrossed 承接）。旧钉只清 vy 不钉位置:每拍钉后
      // 湿重力链又 +lGrav → liqFactor 位移净沉 0.1px/t（6px/s,水档）——首湿点（探针湿
      // ≈沉 10.5px）到头部没水 ~5s 后 headUnderwater 门失能、钉整段摘除 → 加速直沉,
      // 即用户实报「站一会→慢慢沉→没顶」。原版水面站立 = 干态（湿探针 dry,永不入本
      // 湿支——盒底恰在面顶时居中探针底=面顶−h/4 < 面顶）。
      this.onWaterSurface = false;   // 湿态=游泳/下潜,非水面站立（干态钉位回写）
      // 湿态 vy==0 回满（vanilla :26247 `velocity.Y == 0f || sliding → RefreshDoubleJumps`
      // + :26304-26310 `canCarpet = true`——湿态踩底通用,非 boots 限定;旧块同套四件）。
      // 水面站立侧的回满在干态钉位块（vy 钉 0 同门自然通过）。
      if (this.vy === 0) {
        this.extraJumps = [...eqM.jumpOpts];
        // ★BJ704-G12（G5 登记债4）：wingTime 回充补 releaseJump 门（原版 :26976-26982
        //   `(((vy==0||sliding)&&releaseJump)||(autoJump&&justJumped)) → wingTime=
        //   wingTimeMax`——镜像 G5 件8 54 面;干支公共段 :8080 已带 !inputJump）。
        //   旧无门=湿底【持跳】翼时量逐拍回满（翼耗尽后水中按住跳即回满=免松键
        //   无限扇动,宽于原版「每周期须松跳」）。extraJumps（:26257 RefreshDoubleJumps
        //   无此门）/rocketTime（:27060-27063 无此门）保持逐拍回满面。
        if (!this.inputJump) this.wingTime = eqM.wing ? eqM.wing.time : 0;
        this.rocketTime = 7; this.rocketRelease = true; this.rocketDelay = 0;
        // ★BJ704-G5（R4-P2①）：毯复位（canCarpet/carpetTime）迁出至 fixedUpdate
        //  头部公共位（vy==0∨sliding 域,每拍门）——本块剩余=RefreshDoubleJumps 族。
        this.performingJump = null;   // ★BJ533：湿态踩底清尾迹旗（干支 onGround 清同款 :6270——
          //  原版经 jump==0 → CancelAllJumpVisualEffects :26955-26956 同净效）
        this.isDownDashing = false;   // ★BJ534：RefreshDoubleJumps(:23053-23055) 湿路由并入
      }
      // ---- 水中起跳门（JumpMovement :20405-20496 原版语义，2026-08-16 对齐）：
      //   vy==0（踩底 / 水行站立）或 贴墙滑（sliding :20845 外门首位——★BJ704-G13
      //   （G12 登记债3）补 wallCling 腿,湿态贴墙滑蹬墙跳;湿态 sliding 置位机制
      //   本身未实装=既有登记,本腿读上拍值与干支门同承载）或 脚蹼族湿态任意时刻
      //   （flag2&&flag3 :20407）;均须按键边沿（releaseJump :20409）。
      //   ★头露出水面【不是】原版起跳条件——
      //   踩水悬停 vy≠0 不能跳出水面，须踩底/水行/脚蹼（旧"头露即可跳+冷却"自制
      //   门已废）；起跳 = vy=-jumpSpeed + jump=jumpHeight（:20496-20500，脚蹼
      //   不消费多段跳 :20449 !flag2 门），脚蹼起跳置 swimTime=30（:20419-20422）----
      const flipperJump = flipperOn && !this.ridingCart;
      // ★BJ704-G15（G13 登记债③）：湿跳门 autoJump 臂（:20845 内门第二支
      //   `(autoJump && (velocity.Y == 0f || sliding))`——干支 :7486 既有,湿门旧缺
      //   =蛙蹼族配饰/constantJump 坐骑湿态踩底免松键连跳不可达）。sliding 抑制
      //   （:20805-20808 controlJump 头把 autoJump 字段压假）≙ !wallCling;内门
      //   vy==0（sliding 位已被抑制排除——vanilla 同死支）;来源=骑乘 constantJump
      //   覆写/配饰档（与干支同式同源）。
      const autoJumpW = this.ridingMount ? this.mount.autoJump : eqM.autoJump;
      // ★BJ704-G20（R10-P1②）：湿支坐骑跳族回满（vanilla :26258-26260 `vy==0||sliding →
      //   RefreshDoubleJumps()` 恢复 canJumpAgain_Unicorn/Santank/WoFGoat/Basilisk——
      //   湿位=vy==0【池底/水行】,sliding 腿随湿墙滑登记族另册）;干支承载位 :7626 的
      //   onGround 近似镜像。per-tick 链前位（首跳门同拍亦回满——原版 RefreshDoubleJumps
      //   在 JumpMovement 外逐拍跑,不受跳键状态辖）。
      if (mnt2?.jumpOption && this.vy === 0) this.mount.mountJumpReady = true;
      // ★D2：justClearedWetSlime = JumpMovement flag 支（:20813-20818 湿史莱姆清零帧
      //  置真 → 外门 `((sliding||vy==0)|flag)` 的放行位）——史莱姆坐骑水中任意 vy 可起跳
      //  （一次完整跃出水面；下一帧出水干门照常接管）。flipperJump ≡ flag2&flag3 位。
      //  ★头门 this.inputJump（:20802 `if (controlJump)` 块头——autoJump 臂也在块内,
      //    跳键未按整门死;旧仅 jumpEdge 支可省头（沿⇒按）,autoJump 臂入列后头门必需）。
      if (this.inputJump && (jumpEdge || (autoJumpW && !this.wallCling && this.vy === 0))
        && (this.vy === 0 || this.wallCling || flipperJump || justClearedWetSlime)) {
        if (flipperOn && this.swimTime === 0) this.swimTime = 30;
        this.vy = -lJSpd * gd;
        this.jumpHold = lJT;
        jumpStartedThisTick = true;
        this.isDownDashing = false;   // ★BJ704-G22（g20 微残清偿）：:20934 门帧无条件写 flag13=false——任何过门跳清下砸（湿首跳臂;瓶/坐骑臂既有,本臂补齐）
        if (this.stoolInUse) {   // 湿跳同离凳（:20504 无分支门）
          this.stoolInUse = false;
          this.y -= Player.STOOL_BOOST;
          this.h -= Player.STOOL_BOOST;
        }
        if (this.wallCling) this.vx = 3 * -this.slideDir;   // ★BJ704-G15（G13 登记债①）：蹬墙跳 vx 反踢（:20950-20953 `velocity.X = 3f*-slideDir`,首分支尾笔——干湿同门承载）
      } else if (jumpEdge && mnt2?.jumpOption && this.mount.mountJumpReady
        && this.jumpHold <= 0) {
        // ★BJ704-G20（R10-P1②）：湿支坐骑特殊跳族（独角兽 10/圣诞坦克 46/山羊 47/
        //   蜥蜴 14）。vanilla JumpMovement 单块无干湿分裂——外门 :20845 的
        //   canJumpAgain_* 四族臂湿态照常放行;selection :20875-20900 坐骑族在
        //   flag13 下砸与瓶族【前】（Basilisk>WoFGoat>Santank>Unicorn>下砸>瓶序）——
        //   本臂链位=优先序修正（旧湿链瓶族独享 → 骑独角兽+瓶湿态按跳误耗瓶,
        //   vanilla 消费坐骑选项）。else-if 到达即非首跳门形（vy≠0 且无 flag4 脚蹼/
        //   flag 清湿帧——脚蹼湿态 vanilla 走 flag4 首支普通泳跳不耗坐骑选项,
        //   :20939 `((vy==0)|flag4)||sliding|flag` 同相）。跳参=坐骑档 mJumpSpd/
        //   mountJumpTicks（UpdateJumpHeight 骑乘覆写在液体档【后】 :19746-57 →湿态
        //   终值同干支;液体档 lJSpd 对骑乘者本就=坐骑档,见 :7117 注）。尾迹旗
        //   performingJump（:22119 独角兽上升尾迹——doubleJumpVisuals 'Unicorn' 消费
        //   面,干支同拍接线）;mountJumpPerforming 状态位（G19 撤线后帧域/测试锁）。
        //   门 jumpHold<=0 ≙ 原文 `jump > 0` sustain 优先（:20823——首跳拍 sustain
        //   未耗尽整链不跑）;持跳耗尽自动接火=jumpHold 耗尽制家族近似
        //   （[g19-jump-release-zero] 域,干支同款）。
        this.mount.mountJumpReady = false;
        this.mount.mountJumpPerforming = true;
        this.performingJump = mnt2.jumpOption;   // isPerformingJump_*（尾迹/CCed 清位族）
        this.vy = -mJumpSpd * gd;
        this.jumpHold = this.mount.mountJumpTicks();
        jumpStartedThisTick = true;   // ★BJ717-A F6（R13 清偿）：原版 JumpMovement 单块 if/else-if（:20823 钉支 vs :20845 起跳支同拍互斥）——坐骑跳臂起跳拍 sustain 不跑（jump-- 次拍起）;旧缺=起跳拍 sustain 同拍 −1+钉冗余=平台短 1 拍。oracle S3:瓶臂拍 jump=22 原值入次拍递减。
        this.isDownDashing = false;   // ★BJ704-G22（g20 微残清偿）：:20934 无条件 flag13=false——坐骑跳清下砸（残留旗会吃 0.85 重力+封翼,湿干两支同补）
        this.mountJumpBurstFx(game, mnt2.jumpOption);   // ★BJ704-G22（g20-mountjump-firefx 清偿）：起跳帧爆发特效（湿干两支同拍;else-if 链=与下砸/瓶族同帧互斥）
      } else if (jumpEdge && !this.onGround && vyAtJumpGate !== 0 && this.inputDown
        && eqM.hasDeadCellsDownDash && !this.ridingMount && !this.ridingCart
        && !flipperOn && !justClearedWetSlime && !this.isDownDashing) {
        // ★BJ534 湿路由下砸触发腿（:20895 flag13 支——原版湿/干共块,Selection 前置门
        //  `if (!flag2 && !flag)` :20873-20898 = !脚蹼湿(flag2)/!清湿帧(flag) 排除臂,
        //  此处与 BJ533 水中多段跳同门形）。链位在瓶族前=按住↓时下砸优先于水中多段跳
        //  （原文 :20895 else-if 序）。触发体与干支逐位同构（isPerformingJump_DownDash
        //  :20934 + velocity.Y=16×gravDir :20958-20961 + canRocket/rocketRelease 清零
        //  :20924-20925 + jumpHold=0 sustain 停——干支注同源）。
        this.isDownDashing = true;
        this.vy = 16 * gd;
        this.jumpHold = 0;
        this.canRocket = false;
        this.rocketRelease = false;
      } else if (jumpEdge && !this.onGround && !mnt2?.blockExtraJumps
        && !flipperJump && !justClearedWetSlime && this.extraJumps.length > 0) {
        // ★BJ533 水中多段跳（2026-09-23 定谳：用户实报「水中不能二段跳」=本仓自造门）：
        //  原版 JumpMovement 是【单块】无干湿分裂（:26948 无条件调用）——外门 :20845 的
        //  canJumpAgain_* 臂湿态照常放行；selection :20849 `if (!flag2 && !flag)`
        //  （flag2=wet&&accFlipper :20795,flag=湿史莱姆清零 :20816）消费一瓶 → 支选择
        //  :20945 `((vy==0)|flag4)||sliding|flag` 恒假（水下悬空 vy≠0、flag4=脚蹼位假）
        //  → 落瓶支（云 :21167-21196 兜底）。湿态跳参=液体档（:24622-24624 水档
        //  jumpHeight 30/jumpSpeed 6.01）→ 水中云跳=(int)(30×0.75)=22t 钉 -6.01 上升
        //  =强力上浮跳。脚蹼湿态 flag2 令 selection 整段跳过=泳跳优先且【不消费】瓶
        //  （本臂 !flipperJump 门）；踩底 vy==0 走上支+上方回满=不实耗（原版
        //  RefreshDoubleJumps :20931 同净效）。旧仓此臂整缺（多段跳块只嵌干支 else
        //  :6276）→ 水中按跳无响应（且 :6110 飞毯 extraJumps==0 门在水中恒闭=同债面）。
        //  高度表/优先序/起跳帧特效与干支逐位同构——★C5-B7 起收编模块单源
        //  BOTTLE_JUMP_HMULT（jumpHMultOf）,镜像漂移类债根断。jumpHold 用干支同款
        //  Math.round（原版 (int) 截断在 ×1.5/×1.25 半值档差 1t——干湿同款保家族
        //  一致,登记不单侧改）。
        const opt = this.extraJumps.shift()!;
        const hMult = jumpHMultOf(opt);   // ★C5-B7 单源（:20899-21197 各档）
        this.vy = -lJSpd * gd;
        this.jumpHold = Math.round(lJT * hMult);
        jumpStartedThisTick = true;   // ★BJ717-A F6（湿瓶臂同款）：起跳拍 sustain 不跑（原版 if/else-if 同拍互斥;oracle S3:Blizzard 拍 jump=22,(int) 截断 vs 仓 Math.round=+1t 既有登记偏差不动）
        this.performingJump = opt;                          // isPerformingJump_* 等价标记
        this.isDownDashing = false;                         // :20934 门帧写 flag13=false——双跳打断下砸（★BJ534,干支同款）
        if (opt === 'Fart') game.playSfxWav?.('Item_16', 1, this.cx, this.cy);
        else game.playSfxWav?.('Double_Jump', 1, this.cx, this.cy);
        const D = game.vanillaDust;
        const mk = (x: number, y: number, w: number, h: number, type: number,
          alpha: number, scale: number, vx = 0, vy = 0) => D ? D.spawn(x, y, w, h, type, vx, vy, alpha, null, scale) : null;
        if (opt === 'Fart') {
          const fy = gd === 1 ? this.y + this.h - 16 : this.y - 16;
          for (let m = 0; m < 10; m++) {
            const d = mk(this.x - 34, fy, 102, 32, 188, 100, 1.5, -this.vx * 0.5, this.vy * 0.5);
            if (d) { d.vx = d.vx * 0.5 - this.vx * 0.1; d.vy = d.vy * 0.5 - this.vy * 0.3; }
          }
          for (let gi = 0; gi < 3; gi++) {
            const gx = gi === 0 ? this.x + this.w / 2 - 16 : gi === 1 ? this.x - 36 : this.x + this.w + 4;
            const g = GorePiece.newGore(435 + (Math.random() * 3 | 0), gx, fy, -this.vx, -this.vy, 1, false);
            if (g) { g.vx = g.vx * 0.1 - this.vx * 0.1; g.vy = g.vy * 0.1 - this.vy * 0.05; }
          }
        } else if (opt === 'Sail') {
          const sy = gd === 1 ? this.y + this.h : this.y;
          for (let l = 0; l < 30; l++) {
            const d = mk(this.x, sy, this.w, 12, 253, 100, 1.5, this.vx * 0.3, this.vy * 0.3);
            if (!d) continue;
            if (l % 2 === 0) d.vx += (30 + Math.random() * 41 | 0) * 0.1;
            else d.vx -= (30 + Math.random() * 41 | 0) * 0.1;
            d.vy += (Math.floor(Math.random() * 41) - 10) * 0.1;   // O3 漏网核销同干支
            d.noGravity = true;
            d.scale += (Math.floor(Math.random() * 51) - 10) * 0.01;
            d.vx *= d.scale * 0.7; d.vy *= d.scale * 0.7;
          }
        }
      }
      // ★BJ717-A F1：sustain 钉=JumpMovement 位（:26945,原版序 钉→DashMovement
      //   :26958→Wallslide/CarpetMovement→DoubleJumpVisuals :26968→飞行链/重力）。
      sustainPin();
      // 多段跳上升尾迹（DoubleJumpVisuals :26971 每帧无条件调用——原版无 wet 门,
      //  旧湿支整缺=水中尾迹随臂一并补齐；干支同款调用位 :6328）
      this.doubleJumpVisuals(game);
      // ★BJ704-G15（G13 登记债⑦）：CCed 臂尾视觉复位两笔（vanilla :27011-27012——
      //   位序=DoubleJumpVisuals :26968 【后】/翅膀-悬停-重力链【前】:冻结拍尾迹照出
      //   （vanilla 同拍序）,次拍起灭。仓内承载:CancelAllJumpVisualEffects
      //   （:36932-36944,includeDownDash 缺省 true）≙ performingJump 清 +
      //   isDownDashing 清;sandStorm 位仓内无独立承载（run 加速 ×1.5/×2 :26773 与
      //   转向门 :19965 未建模,视觉面经 performingJump 键控）——双笔即全覆盖。
      //   （CCed 物理面 vy+=gravity+钳制 :27005-27010 与 55/56/61 悬停让位另刀登记。）
      if (this.cced) { this.performingJump = null; this.isDownDashing = false; }
      // ---- ★湿态翅膀核心（2026-09-03 翻案）：位序按原文 :26945 JumpMovement →
      //      canRocket :26973 → :26987 flag19 → WingMovement → WingFrame →
      //      火箭合并 :27024 → 火箭靴 :27069 → 推力 :27126 → 悬浮 :27083 →
      //      重力+液体钳制（:27156 else-if 链）。
      //      ①回满/清零已并入跳跃段尾公共段（★回满/清零公共段 = :26947-26982 原文位序
      //        JumpMovement 尾，不分干湿——旧版湿侧缺失/干地 onGround 近似均退役）。
      //      ②flag19 扇动 :26987（wings>0 && controlJump && wingTime>0 && jump==0 && vy≠0）
      //        + hover 档 :26991。JS 传当帧 effJumpSpd——原版 WingMovement 读 jumpSpeed
      //        字段，湿态已被液体链覆写（:24623-24624 水档 6.01）；干态沿用
      //        PLAYER_JUMP_SPEED+jumpSpd（下方干燥分支原值不动）。
      //      ③帧状态机/特效：WingFrame 每 tick（:26497）+ WingAirVisuals 挂 wingFx
      //        （:30284），waterFloat/shouldDraw 输入按 ShouldFloatInWater :3710-3722。
      //      ④火箭靴/飞毯/悬浮湿态镜像（2026-09-03 备案清偿①）：原版全链无 wet 门——
      //        湿态 JS/lGrav 用液体档。悬浮带 CanUseWingAbilities 的 !merman 门
      //        （:27606）；canRocket/rocketRelease 锁与干支同构。飞毯原版位在
      //        CarpetMovement :26969（canRocket 之前）——随干支既有后置位（已登记）。
      const eqWet = eqM;
      const mountCanWingsW = !mnt2 || MOUNT_DATA[String(mnt2.type)]?.CanUseWings === true;
      const wingsW = eqWet.wing && mountCanWingsW ? eqWet.wing.logic : 0;   // wingsLogic=armor.wingSlot（:12584）
      // wingsLogic 骑【禁翼族】坐骑清零（:26833-26835 `if (!mount.CanUseWings)
      // { wings=0; wingsLogic=0; }`，1456 :26319 同在）——flag19 hover 档 :26991
      // 消费清零后值；旧注"不随坐骑清零"系误读，2026-09-03 矫正
      const wingsLogicW = eqWet.wing && mountCanWingsW ? eqWet.wing.logic : 0;
      if (!this.inputJump) this.rocketRelease = true;   // :21204 松跳锁（与干支同构）
      // :26974-26976 canRocket 门（湿档 jumpSpeed）——★SW-FX34 补倒挂臂（同干支）
      if ((this.gravDir === -1 ? this.vy < effJumpSpd : this.vy > -effJumpSpd) && this.vy !== 0) this.canRocket = true;
      flying = (wingsW > 0 && this.inputJump && this.wingTime > 0 && this.jumpHold === 0 && this.vy !== 0)
        // ★BJ717-A F9（2026-10-25,R13 清偿）：inputDown→tryingToHoverDown——原版
        //   :26991 flag19 悬浮臂谓词=TryingToHoverDown（:3920-3927=controlDown∨
        //   tryKeepingHoveringDown 锁存,★SW-FX14 干支同款已接）。湿臂旧读裸
        //   inputDown=Click 悬停锁存模式+湿态漏触（干支 :8232 同位读 hoverDown）。
        || (FLAP_HOVER_SET.has(wingsLogicW) && this.inputJump && this.tryingToHoverDown && this.wingTime > 0);
      if (this.isDownDashing) flying = false;   // ★BJ534：flag20 → flag19=false（:26995-26998——下砸期扇动/滑翔全让位）
      if (flying) this.wingMovement(wingsW, this.tryingToHoverDown, effJumpSpd, eqWet.wing ? eqWet.wing.time : 0);   // ★SW-FX14 :22410 TryingToHoverDown + ★BJ216 wingMax 回满上限（湿链同吃徽章）
      // ★BJ704-G19（G16 债④b 湿侧）：CCed 冻结翼帧机——vanilla 唯一 WingFrame 调用位
      //   :27021 在 CCed 臂 else 内（:26999-27014 `if (CCed)… else {…WingFrame…}`）,
      //   冻结中帧不推进（解冻续走）;旧注":26497 每 tick 无条件"系误锚已勘正（干支同款）。
      if (wingsLogicW > 0 && !this.cced) {
        const glideW = !flying && this.inputJump && this.vy > 0 && !this.isDownDashing;   // :26718 族 !downDash 门（★BJ534 落位）
        this.wingFrameScratch.frame = this.wingFrame;
        this.wingFrameScratch.counter = this.wingFrameCounter;
        // waterFloat/shouldDraw 门 = wet && ShouldFloatInWater（WingFrame :30456/
        // :30724/:30732 + ShouldDrawWingsThatAreAlwaysAnimated :30971）——浮源判统一
        // 走 shouldFloatInWater getter（canFloatInWater 两源 :13364-67/:9982-86；脚蹼药
        // 109 不置 canFloatInWater :10257-59——R1-F1 勘误,旧内联手写式退役）
        stepWingFrame(wingsLogicW, this.wingFrameScratch, {
          flap: flying,
          jump: this.jumpHold > 0,
          vy: this.vy,
          controlJump: this.inputJump,
          controlLR: this.inputX !== 0,
          hoverDown: this.tryingToHoverDown, hoverUp: this.tryingToHoverUp,   // ★SW-FX14 :29714/:29792 取值门
          wingTime: this.wingTime,
          glide: glideW,
          downDash: this.isDownDashing,   // ★BJ534：⑤号债清偿（vanillaWingVisuals 台账——WingFrame 下砸帧态）
          waterFloat: wetVanilla && this.shouldFloatInWater,
          shouldDraw: this.vy !== 0 && !this.ridingMount
            && !this.grappleProjs.some((g) => g.latched)
            && !(wetVanilla && this.shouldFloatInWater),
        });
        this.wingFrame = this.wingFrameScratch.frame;
        this.wingFrameCounter = this.wingFrameScratch.counter;
        // 翅膀尘埃/音效（WingAirVisuals :30284 + WingFrame 各分支尘 + 滑翔尘 :26914+）
        this.wingFx(game, wingsW, wingsLogicW, flying, glideW, !!this.wingFrameScratch.justSwitched);
      }
      // 翅膀+火箭靴动态合并（:27024-27036）：湿态同链（rocketTime 有余 → ×6 并入
      // wingTime，上限 = wingTimeMax + 本次转换量，rocketTime 清零）
      // ★BJ704-G19（G16 债④d 湿侧）：!cced——合并块在 CCed 臂 else 内（:27023-27031）,
      //   冻结期不并（旧:CCed 落水拍即并 → 落地回满 wingTime=wingTimeMax 把 6× 转化量
      //   冲掉 = 火箭燃料静默灭失面;干支 :7819 本在 !cced 块内无需动）。
      if (!this.cced && wingsW > 0 && eqWet.rocketBoots > 0 && this.vy !== 0 && this.rocketTime > 0) {
        const add = this.rocketTime * 6;
        this.wingTime += add;
        const cap = (eqWet.wing ? eqWet.wing.time : 0) + add;
        if (this.wingTime > cap) this.wingTime = cap;
        this.rocketTime = 0;
      }
      // 火箭靴（:27069）：翅膀不可用（无翅或时间尽）才接管——湿态同链无 wet 门
      // ★BJ717-A F3（2026-10-25,R13 清偿）：!isDownDashing=第 7 项 CanUseBootFlyingAbilities
      //   （:3972 `=> !isPerformingJump_DownDash`;BJ534 同波漏员——flying 门有 :26995-98
      //   下砸旗,火箭门漏）。vanilla 下砸旗 :20934 置位后持到落地（:23053 RefreshDoubleJumps
      //   清）/:26956 CancelAll(includeDownDash:false) 不清——下砸期整门拒点火。
      //   oracle S7:下砸中重按跳 rocketTime 恒 7/rocketDelay 恒 0;S7b 对照（无下砸）
      //   同拍 7→6/delay=9。
      if (!flying && !mnt2 && (this.wingTime <= 0 || wingsW === 0) && eqWet.rocketBoots > 0
        && this.inputJump && this.rocketDelay === 0 && this.canRocket && this.rocketRelease
        && !this.isDownDashing) {
        if (this.rocketTime > 0) {
          this.rocketTime--;
          this.rocketDelay = 10;    // 推力脉冲段（:27074）
          if (this.rocketDelay2 <= 0) this.rocketDelay2 = eqWet.rocketBoots === 1 ? 30 : 15;
        } else {
          this.canRocket = false;
        }
      }
      // ★BJ704-G19（G16 债④c 湿侧）：!cced——rocketDelay2--（:27109-27111）在 CCed 臂
      //   else 内=冻结期不递减（重燃锁窗保真;干支 :7837 本在 !cced 块内无需动）。
      if (this.rocketDelay2 > 0 && !this.cced) this.rocketDelay2--;
      if (this.rocketDelay > 0 && !this.cced) {
        // 推力脉冲速度模型（:27126-27153，与翅膀同构 0.1/0.5/1.5 档）：湿态 JS=液体档；
        // 推力期整链让位（下方重力段 rocketDelay 互斥）。★SW-FX34 补倒挂臂（同干支）
        // ★BJ704-G16（G15 登记债①）：!cced——原版推力块在 CCed 臂 else 内,冻结中
        //   不推力不递减（解冻续推,rocketDelay 冻结保留）;下方湿重力段 ||cced 放行。
        this.rocketDelay--;
        this.vy -= 0.1 * this.gravDir;
        if (this.gravDir === -1) {
          if (this.vy < 0) this.vy += 0.5;
          else if (this.vy < effJumpSpd * 0.5) this.vy += 0.1;
          if (this.vy > effJumpSpd * 1.5) this.vy = effJumpSpd * 1.5;
        } else {
          if (this.vy > 0) this.vy -= 0.5;
          else if (this.vy > -effJumpSpd * 0.5) this.vy -= 0.1;
          if (this.vy < -effJumpSpd * 1.5) this.vy = -effJumpSpd * 1.5;
        }
        this.fallStartY = null;
      } else if (!flying) {
        // 飞毯（CarpetMovement :26969）：条件=无多段跳余量/jumpHold 空/vy≠0/
        // 火箭靴未在用/翅膀时间尽；湿态重力=液体档 lGrav（原版写 gravity 字段）
        // SW-RB6b 2026-09-07：补 !grappling[0] 门（原版 CarpetMovement :22025 首条件
        // `grappling[0] == -1`——挂钩中飞毯不启动；旧码漏接 ⇒ 挂钩悬空持跳=飞毯缓降
        // 覆写锚点牵引 vy）
        if (eqWet.carpet && !mnt2 && !this.grappling[0] && this.extraJumps.length === 0 && this.jumpHold === 0
          && this.vy !== 0 && this.rocketTime === 0 && this.wingTime <= 0) {
          // ★SW-FX19：倒挂禁【新激活】（:26312-26314 `gravDir==-1 → canCarpet=false`
          //   每 tick 先于 CarpetMovement——已激活毯飞行续期不受此限 :22038）
          if (this.gravDir === -1) this.canCarpet = false;
          if (this.inputJump && this.canCarpet) { this.canCarpet = false; this.carpetTime = 300; }
          if (this.carpetTime > 0 && this.inputJump) {
            this.carpetTime--;
            this.carpetFlying = true;   // ★BJ704-G5（R4-P2②）本拍在展开（≙ carpetFrame>=0）
            this.fallStartY = null;
            // 微升抵消随后重力 → 净缓降（湿档）。★SW-FX34 补倒挂臂（:22041,
            //  同干支；gd=1 旧无条件写维持=已登记债）
            // ★SW-FX40（a·gd=1 行为补齐）：gd=1 臂补门 `vy > -gravity`（:22037-22040
            //  `if (gravDir == 1f && velocity.Y > 0f - num) velocity.Y = -(num+1E-06f)`）
            //  ——旧无条件钉写把上升段（二段跳耗尽仍上升 vy<-gravity）剪成 -0.4，
            //  原版门内不写、续升照旧。gd=-1 臂（FX34）逐位不动。
            if (this.gravDir === -1) {
              if (this.vy < lGrav) this.vy = lGrav + 1e-6;
            } else if (this.vy > -lGrav) {
              this.vy = -(lGrav + 1e-6);
            }
          }
        }
      }
      // 悬浮缓降（真锚 :27607-27619,重力后公共段——旧注「:27083-27102」系误锚,序差
      //   见 BJ717-A 登记）：硬码槽位集 {22,28,30,31,33,35,37,45}（HOVER_SLOWFALL_SET
      //   ——★BJ722-A [bj717a-hover-slowfall-slotset]：旧谓词 eqWet.wing?.hover=五员
      //   stats 表,28/33/35 漏 ×0.9/×0.8）+ TryingToHoverDown + 跳 + wingTime>0 →
      //   vy×0.9（45=0.8）;canUseWingAbilities=CanUseWingAbilities(:3975)=!merman∧
      //   !downDash——!isDownDashing 腿 BJ722-A 补（BJ717-A
      //   [bj717a-hover-slowfall-downdash]）。
      // ★BJ717-A F9（R13 清偿）：inputDown→tryingToHoverDown——原文谓词=TryingToHoverDown
      //   锁存（Click 悬停锁存模式湿态漏触;干支 :8321 同位 hoverDown 已对）。
      if (HOVER_SLOWFALL_SET.has(wingsW) && this.tryingToHoverDown && this.inputJump && this.wingTime > 0
        && !this.merman && !this.isDownDashing) {
        this.vy *= wingsW === 45 ? 0.8 : 0.9;
        if (this.vy > -2 && this.vy < 1) this.vy = 1e-5;
      }
      // ★BJ722-A [bj717a-wing37-extra-slowfall]：翼 37 再 ×0.92（:27620-27626,干支同款）
      if (wingsW === 37 && this.tryingToHoverDown && this.inputJump && this.wingTime > 0
        && !this.merman && !this.isDownDashing) {
        this.vy *= 0.92;
        if (this.vy > -2 && this.vy < 1) this.vy = 1e-5;
      }
      // ---- ★BJ704-G4（BJ703-D2b 登记债清偿,2026-10-21）：坐骑飞行族湿支 vy 链 ----
      //      原版 Player.cs:27158-27235 else-if 链【无湿门】（26940-27245 wet 零
      //      token,D2b 定谳锚）——骑乘者湿态照跑：CanHover→Hover 全控 vy /
      //      CanFly∧controlJump∧jump==0→Flight() 余能爬升 / 耗尽 gravity/3+maxFallSpeed/3
      //      缓降。三参数全读 Player 字段：重力=湿档 lGrav×num6（Update 头 :24590-24625
      //      液体变体后 :24884 无条件 ×num6——含湿;非坐骑湿重力链的 num6 缺乘=既有登记
      //      债不在此连坐,本链按 :24884 语义就地 fresh 算）;maxFallSpeed 无 num6 乘区
      //      →终端钳 lMaxFall/3;jumpSpeed=【坐骑档】mJumpSpd（UpdateJumpHeight
      //      :26211→:19746-19757 骑乘覆写在液体档【后】→终值坐骑档,非液体档 lJSpd
      //      ——湿支水跳门的液体档覆写=另行登记债）。干支同构位 :7442-7495（镜像）。
      //      湿面存活：悬停族 8 钻头/23 巫婆扫帚/48 暗黑魔法书/61 仙灵（5 蜜蜂/7 飞碟/
      //      56 蝙蝠 湿拍自动下坐 C5-B1 已承;12 猪鲨崽/44 海盗船/49 熔岩鲨 buff
      //      168/279/305 ignoreWater=游泳自由走干路既有链）+飞行族 0 驯鹿/2 猪龙/50
      //      史后（slime 浮力 switch :28195-28207 在 :5511 先行,vy 加法可交换=净效同;
      //      带内钳序差=登记债）/54 迅猛龙（allowedToFly 闩）。56∨61 的 /1.5 爬升臂
      //      与 54 wingStats 臂=vanilla 死码不移植（BJ701/BJ703-D 判谳,canHover 先达）。
      // ★BJ704-G16（G15 登记债①湿面）：CCed 坐骑链让位（同干支 :7695 注——
      //   vanilla CCed 臂替换整条 else 链,湿支同构:56/61 拒下坐骑者液体中不悬停,
      //   落下方湿重力段平 lGrav 坠）。
      // ★BJ717-A F10（湿支同款）:!rocketDelay=原版 :27158 else-if 互斥——推力脉冲
      //   期坐骑 Hover/Flight 整链不跑（flyTime/fatigue 不静默消耗）。
      if (mnt2 && !this.cced && this.rocketDelay === 0) {
        // ★BJ704-G5（G4-⑤a/G4-②）：重力源=lGrav（液体档×num6 字段并源,上方
        //   G5 段已乘;旧就地 num6W 重算收编）——hover 疲劳率/非飞行臂重力场感知
        //   消费同一值（Mounts.hover 第二参）。
        const mountGFieldW = lGrav;
        if (mnt2.canHover(this)) {
          mnt2.hover(this, mountGFieldW);
          mountFlight = true;
        } else if (mnt2.canFly(this) && this.inputJump && this.jumpHold === 0) {
          if (mnt2.flight()) {
            // ★BJ701 按住↓悬停钉位（:27168-27175）同干支：Flight 余能期
            //   TryingToHoverDown → vy×0.9 + (-1,0.5) 窗内钉 1e-05。
            if (this.tryingToHoverDown) {
              this.vy *= 0.9;
              if (this.vy > -1 && this.vy < 0.5) this.vy = 1e-5;
            } else {
              let js = mJumpSpd;                       // 坐骑档（见上注,非液体档）
              if (mnt2.type === 50) js *= 0.5;         // 史后坐骑爬升减半（:27180-27183）
              if (this.vy > 0) this.vy -= 0.1 * 5;     // 下落中反抽 5×（:27194-27197）
              else if (this.vy > -js * 1.5) this.vy -= 0.1;
              if (this.vy < -js * 1.5) this.vy = -js * 1.5;
            }
          } else {
            // 能量耗尽缓降（:27208-27222）湿档：重力=mountGFieldW（湿档×num6）/3、
            //   终端钳 lMaxFall/3（湿档 maxFallSpeed 无 num6 乘区）,悬停向驻留门同干支
            //   （:27213/:27218——按↓驻留不钳=快坠面）。
            this.vy += mountGFieldW / 3 * gd;
            const capW = lMaxFall / 3;
            if (gd === 1) {
              if (this.vy > capW && !this.tryingToHoverDown) this.vy = capW;
            } else if (this.vy < -capW && !this.tryingToHoverUp) this.vy = -capW;
          }
          mountFlight = true;
        }
      }
      // 断翅滑翔（:27015-27027 else-if 链替换常规重力，干湿同链）：wingTime 尽后按住跳
      // = 重力/3 + 终端 lMaxFall/3——湿链 gravity 已被 :24621 覆写为液体档,滑翔在其后
      // 再 /3（原版同序）。旧版锁干燥分支 → 水下断翅直坠 5.01（原版 1.67）
      // ★BJ704-G4：原版臂门=wingsLogic>0（:27236）——骑 !CanUseWings 族两字段清零
      //   （:26833-26835）恒不达;旧 `!!eqWet.wing`（骑乘时 wingTime 亦被 :7924 清零
      //   →`wingTime<=0` 恒真）在骑乘悬停/飞行减速带上伪触发钳 lMaxFall/3（悬停下行
      //   被截）——补 wingsLogicW>0 门（未骑乘时 ≡ 旧式,零扰动）。
      const glidingW = !!eqWet.wing && wingsLogicW > 0 && this.wingTime <= 0 && this.inputJump && this.vy > 0 && !this.inputDown
        && this.rocketDelay === 0;
      if (glidingW) {
        // ★BJ704-G5（G4-⑤a）：滑翔重力=字段/3（:27541 `vy += gravity/3`——湿档×num6
        //   后再 /3,旧 GRAVITY/3 恒干档常量=湿滑翔 2× 偏陡）;终端钳带
        //   !TryingToHoverDown 门（:27544,干支 :7843 同式——下悬停驻留不钳）。
        lGrav = lGrav / 3;
        if (this.vy > lMaxFall / 3 && !this.tryingToHoverDown) this.vy = lMaxFall / 3;
      }
      // flag19/火箭推力期整条重力链跳过（原版 :27156 else-if 链：rocketDelay>0 → 推力
      // 独占挂起滑翔/重力；!flag19 → 滑翔/飞毯/重力——WingMovement 的 0.1/0.5 档独立
      // 驱动 vy,液体钳制同属该链 = 水下飞行不受 ±6.01/5.01 钳,升限 -jumpSpeed×1.5。
      // 旧版曾把 +0.2 湿重力照加 → 扇动 -0.1 被净 +0.1/t 掐死,水下爬升归零）
      // ★BJ524：冲刺状态机湿支补位（原版 DashMovement :26958 无条件调用,wet 不闸——
      // 滑行阻尼/冷却倒数/就绪触发/克盾冲撞/日曜冲撞/坐骑6 冲撞全链湿态照跑）。
      // 位次=湿重力施加（下方块）之前,与干支同保 dash-before-gravity 原序。
      this.dashMovement(game, eqM, ix, maxRun, accRun, runSlow, runAcc);
      // ★BJ704-G4：坐骑飞行族已独占 vy（上方湿支坐骑链）——湿重力段整体让位
      //   （原版 :27158 else-if 链互斥语义,同干支 mountFlight→grav=0 面）
      // ★BJ704-G16（G15 登记债①④湿面）：|| this.cced——CCed 臂平重力照施加
      //   （vanilla :27005 无湿门,湿态 gravity 字段=液体档 lGrav 同值;推力块
      //   已 !cced 让位 → rocketDelay>0 冻结中重力仍走本段=原版 CCed 平坠）。
      if (!flying && !mountFlight && (this.rocketDelay === 0 || this.cced)) {
        // ★BJ704-G20（R10-P2）：CCed 臂单侧钳（vanilla :27006-27010 `velocity.Y +=
        //   gravity; if (velocity.Y > maxFallSpeed) velocity.Y = maxFallSpeed`——CCed
        //   替换整条液体钳制链,无 -jumpSpeed 上升侧钳;重力=lGrav 平值加【无 gravDir
        //   符号——原版字面,CCed 拍 gravDir 已清 1（:25445）,FTW 克脑覆写 -1 面同
        //   原版怪癖下拉】）。旧双侧 Math.max(-lJSpd,…) 把冻结拍火箭/坐骑跳上升段
        //   |vy|>lJSpd 剪到 -lJSpd（~1-3px 跳变,R10 定谳）。
        // ★BJ704-G22（g20-wet-clamp-rising-side 销案+回滚近似）：非 CCed 上升侧钳
        //   vanilla 干湿两域均无对应（:27563-27595 单侧 per gravDir 只钳坠落端）——
        //   G20 登记「活面=水中受击退」复核为死面：本仓玩家受击退=固定 vx±4.5/
        //   vy=-3.5（Player.Hurt :37908-37912,不按攻击方 kb 缩放,1:1 已移植）,
        //   |-3.5|<6.01 恒不触发;其余上升写位=湿跳族恰 -lJSpd（边界 no-op）/坐骑
        //   飞行 -1.5×js（mountFlight 让位本段）/钩爪牵引每拍重写 vy（本段之后,
        //   钳值零消费）——全列遍零活面,SW-FX34 倒挂臂时期近似回滚 1:1。勿再按
        //   「水中受击退弹起偏矮」登记（受击退面=固定 -3.5 两域同相）。
        if (this.cced) {
          this.vy += lGrav;
          if (this.vy > lMaxFall) this.vy = lMaxFall;
        } else if (this.gravDir === -1) {
          this.vy -= lGrav;
          if (this.vy < -lMaxFall) this.vy = -lMaxFall;   // :27582-27585 单侧（倒挂坠落端=上行）
        } else {
          this.vy += lGrav;
          if (this.vy > lMaxFall) this.vy = lMaxFall;     // :27567-27570 单侧
        }
        // ★SW-FX40（b·gd=1 行为补齐 + gd=-1 新增镜像臂）：慢Fall 终端钳湿链
        //  （:27571-27578/:27586-27593——maxFallSpeed 字段=湿档 lMaxFall
        //  :24600-24622;原版 :26695 链不排湿态,钳制湿干同闸）。蜜蜂坐骑豁免同干链。
        //  ★湿链 slowFall 重力本身未 /3（:27224-27235 湿态可达,本仓 lGrav 恒全值）
        //  = 登记债,仅终端收敛,逼近速率仍偏陡。
        if (!this.cced && !(this.ridingMount && this.mount.type === 5)) {   // ★G16 !cced=CCed 平终端（同干支,慢Fall 钳让位）
          if (this.gravDir === -1) {
            if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy < -lMaxFall / 3 && !this.tryingToHoverDown) this.vy = -lMaxFall / 3;
            if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy < -lMaxFall / 5 && this.tryingToHoverUp) this.vy = -lMaxFall / 10;
          } else {
            if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy > lMaxFall / 3 && !this.tryingToHoverDown) this.vy = lMaxFall / 3;
            if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy > lMaxFall / 5 && this.tryingToHoverUp) this.vy = lMaxFall / 10;
          }
        }
      }
      // ★SW-RB14a（F5）：湿档 gravity 字段快照改【每拍无条件写】（原版字段复位链
      //  Player.cs:24559 `gravity = defaultGravity` → :24590-24628 液体变体
      //  （水 0.2/蜜 0.1/人鱼 0.3/三叉戟 0.25|上 0.1/微光 0.15）→ :24884 `*= num6`
      //  全在 Update 头部执行,湿/飞/推力各态都拿到当拍新值）。旧写位在
      //  `!flying && rocketDelay===0` 支内 → 湿态扇翅/火箭推力期 gField 吃上拍
      //  陈值（最坏=干链慢Fall 签名改写的带符号值）,falling 旗/StepDown/
      //  StepUpInv 三门阈值漂移。湿链未乘 num6=既有债不变（:24884 语义）。
      this.gField = lGrav;
      this.gFieldUnsigned = lGrav;   // ★BJ704-G13（债5）无符号并行快照（湿支无慢Fall 改写,同值）
      this.fallStartY = null;
    } else {
      // 悬停坐骑贴地档（JumpMovement :20845 落地门 = velocity.Y==0f 原版字面）：
      // 免疲劳 hover 族（UFO 7/钻头 8 等）静置时 vy 恒 0 且无 Y 位移 → onGround
      // （落地碰撞置位）恒假 → 跳跃门全灭 = 地底无法起飞只能横移（用户实报）。
      // 原版以 vy==0 为贴地语义,此处对 CanHover 坐骑补同义门
      const hoverGrounded = this.ridingMount && this.mount.canHover(this) && this.vy === 0;
      // ★⑤ 台账清偿（2026-08-31）JumpMovement 滑行支：外门 `(sliding||vy==0)|flag`
      // （:20819-20845）的 sliding 位——墙滑/坡滑态任意 vy 可起跳（蹬墙离壁走标准
      // jumpSpeed/jumpHeight 链）。本仓滑行代词 = wallCling（WallslideMovement 家族
      // 贴墙缓降/老鼠爬墙，:21990/:22003 sliding=true 的仓内承载位），读上一 tick
      // 置位值（本方法内跳跃门先于积分碰撞段,1 tick 滞后=等价登记）。
      // 与之配套 autoJump 抑制（:20805-20808 `if (sliding) { autoJump = false; }`）：
      // controlJump 头部把玩家 autoJump 字段压真为假 ⇒ 内门 `(autoJump&&(vy==0||sliding))`
      // 在滑行期恒空转——原版按住跳键踩墙【不会】自动连跳,须松键重按。此处以
      // wallCling 抑制 autoJump 支等效（releaseJump=jumpEdge 边沿支不受影响）。
      const slidingAutoSupp = this.wallCling;
      if (this.inputJump && (jumpEdge || ((this.ridingMount ? this.mount.autoJump : eqJ.autoJump) && !slidingAutoSupp))
        && (this.onGround || (this.onTrack && this.vy === 0) || (this.gravDir === -1 && this.hitHead) || hoverGrounded || this.wallCling
          || (this.onWaterSurface && this.vy === 0))) {
        // ★BJ227 水面站立起跳腿：原版起跳外门 `(sliding||velocity.Y==0f)|flag`（JumpMovement
        // :20845）无 onGround 要求——水面钉位态 velocity.Y==0（WaterCollision :23774 替换值
        // 稳定拍=0）→ 原版水面可直接起跳。onWaterSurface=上一拍干态钉位回写（本门先于本拍
        // 钉位,寄存器语义同 wallCling 惯例）;vy==0 门排掉被湿路由摘钉的帧（下潜中不给跳）。
        // ★SW-BJ59：onTrack 臂——原版起跳门 `velocity.Y == 0f`（JumpMovement :20845），
        // 贴轨滑行帧 vy==0 但无实心接触（本仓 onGround 近似漏轨面）→ 滚轴鞋贴轨
        // 可跳离轨道；坡面轨 vy≠0 帧同原文不跳。
        // ★SW-FX34 倒挂起跳腿（:28267 门域——原版起跳外门 `(sliding||vy==0)|flag` 的
        //  vy==0 支对倒挂贴顶态成立（贴顶碰撞清 vy=0）；本仓承载位 onGround 在
        //  moveAndCollide 头被轴结算覆写（上行阻挡不置 onGround），:5667 的
        //  onGround=hitHead 等效写又在本 tick 积分【前】被同位覆写 → 倒挂贴顶在
        //  本门恒假=永远无法起跳。hitHead 在本门时点=上一拍碰撞残留（未被本拍
        //  moveAndCollide 头复位）≡ 原版 vy==0 贴顶语义。gd=1 臂逐位恒等。
        // 跳跃速度 = 基础 + jumpSpeedBoost（蛙腿族 +1.6，Player.jumpSpeedBoost :22427）；
        // 重力倒置时方向取反（gravDir，Player.cs:3207 全部 vy 乘 gravDir 语义）
        // 起跳门 = releaseJump || (autoJump && vy==0)（JumpMovement :20845——按住跳键
        // 落地不自动连跳,须松键再按;autoJump 来源 = 蛙蹼族配饰（:14507/:14533/:14539/
        // :14546）或坐骑 constantJump 族（Mount.UpdateEffects :4850 `mountedPlayer.
        // autoJump = AutoJump`——骑乘期【覆写】配饰档）。R5-F12：旧 held 门（按住即
        // 落地重跳）= 全员恒 autoJump,已废）
        this.vy = -mJumpSpd * gd;
        this.jumpHold = mJumpTicks;
        jumpStartedThisTick = true;
        this.isDownDashing = false;   // ★BJ704-G22（g20 微残清偿）：:20934 门帧无条件 flag13=false——干首跳臂补齐（hoverGrounded/wallCling 等非 onGround 臂不落 :7720 清位）
        // 折叠凳起跳离凳（Player.cs:20504-20512：IsInUse=false + position.Y −= 26
        // ——从凳上一步起跳=净多 26px 高度；相机 bump 无对应载体略）
        if (this.stoolInUse) {
          this.stoolInUse = false;
          this.y -= Player.STOOL_BOOST;
          this.h -= Player.STOOL_BOOST;
        }
        if (this.wallCling) this.vx = 3 * -this.slideDir;   // ★BJ704-G15（G13 登记债①）：蹬墙跳 vx 反踢（:20950-20953 首分支尾笔,sliding 支——离壁横冲 3px/t）
      }
      // ---- 坐骑特殊跳（hasJumpOption_*：UpdateEffects :4933/:4877/:4956/:4963 授予；
      //      JumpMovement :20435-20688 链——优先于装备多段跳） ----
      let mountJumpFired = false;   // 本帧坐骑跳已消费（与装备多段跳 else-if 互斥）
      // 独角兽 10 / 圣诞坦克 46 / 山羊 47：vy = -mountJumpSpeed、保持 jumpHeight×2；
      // 蜥蜴 14：保持 trunc(jumpHeight×0.75)（:20659）。落地恢复（:22612-22628
      // canJumpAgain_* 段）。
      // ★BJ704-G20（G19 [g19-mountjump-residual] 销案勘正,防再登记）：G19 旧注
      //   「蜥蜴/山羊 isPerformingJump_* 无复位 → 骑乘期 run 加速常驻」系过读——
      //   加速消费面 :26788-26803 全部 AND hasJumpOption_*（ResetEffects :18883-18891
      //   逐拍清,仅 Mount.UpdateEffects :4940/:5006/:5017/:5024 骑乘期重授）:
      //   骑乘期=坐骑 stats 覆写支（:26852-26856 else,四型 flag17 恒假）冲掉、
      //   下坐后=hasJumpOption 假 → 两态皆死码。山羊/蜥蜴标志位不复位仅系 vanilla
      //   无消费者的怪癖（唯一消费 :22119 尾迹/:26788 加速均带 hasJumpOption 门）。
      //   仓内 mountJumpPerforming（mount 实例域,reset 清）≙ vanilla 净效等价。
      if (mnt2?.jumpOption) {
        if (this.onGround) this.mount.mountJumpReady = true;
        else if (this.mount.mountJumpReady && this.inputJump && this.jumpHold <= 0) {
          this.mount.mountJumpReady = false;
          this.mount.mountJumpPerforming = true;
          this.performingJump = mnt2.jumpOption;   // ★BJ704-G20:isPerformingJump_*（:22119 独角兽上升尾迹,湿支同拍接线）
          this.vy = -mJumpSpd * gd;
          this.jumpHold = this.mount.mountJumpTicks();
          jumpStartedThisTick = true;   // ★BJ717-A F6（干坐骑跳臂同款）：起跳拍 sustain 不跑（原版 :20823/:20845 同拍互斥——jump-- 次拍起）
          this.isDownDashing = false;   // ★BJ704-G22（g20 微残清偿）：:20934 无条件 flag13=false——坐骑跳清下砸（干支;残留旗吃 0.85 重力+封翼）
          this.mountJumpBurstFx(game, mnt2.jumpOption);   // ★BJ704-G22（g20-mountjump-firefx 清偿）：起跳帧爆发特效（干支,湿支同拍接线）
          mountJumpFired = true;   // 与装备多段跳同帧互斥（原版 :20935 else-if 单分支）
        }
      }
      // ---- ★BJ534 重锤符文下砸触发腿（JumpMovement :20895-20898 flag13 支）----
      //  门（原文）= hasDeadCellsDownDash(5465 装备链 ApplyEquipFunctional :14498-14501)
      //  && controlDown && !isPerformingJump_DownDash && velocity.Y!=0 && !mount.Active,
      //  链位在坐骑多段跳（flag12..9,Basilisk>WoFGoat>Santank>Unicorn）之后、瓶族
      //  （flag5..8）之前；外门 = 跳键沿（releaseJump :20845——仓内 jumpEdge）。
      //  jumpHold<=0 = 原文 `if (jump > 0)` sustain 分支优先（:20823——sustain 存续帧
      //  整条链不跑）;jumpEdge（按 press 边沿）帧 sustain 必已归零/耗尽（原版松键
      //  :21203 jump=0;本仓窗口耗尽同达 jumpHold=0）。湿∧脚蹼（flag2）/湿史莱姆清湿帧
      //  （flag）排除臂由 `if (!flag2 && !flag)` 门承载——干支两 flag 恒假,湿支见下。
      //  触发 = isPerformingJump_DownDash=true（:20934）+ velocity.Y=16×gravDir
      //  （:20958-20961——同帧重力链钳回 maxFallSpeed,净效果=秒达终端速;快坠本体
      //  = 下方第二竖向碰撞趟 :28424-28430）。canRocket/rocketRelease 清零 =
      //  :20924-20925 门帧公共段（按下帧火箭不点火）;jumpHold=0 = 原文本帧 sustain
      //  分支不跑（:20823 `if (jump > 0)` 假——原文松键 :21203 即 jump=0,仓内窗口
      //  残余态（:6807 判例不清零）由本行显式归零=同净效）。
      let downDashFired = false;
      // ★BJ704-G16（G15 登记债③）：!jumpStartedThisTick 互斥（vanilla :20845-21196 单
      //   if-else-if 链——首支 (sliding||vy==0) 过门时执行恒落普通跳支 :20939-20953,
      //   flag13/瓶族皆不可达）。仓内干支首跳门拆独立 if → 下砸腿同拍双发：挂壁
      //   (wallCling,vy≠0)+按↓+重锤符文按跳 → 旧=普通跳+下砸双发（下砸后写胜出= vy=16
      //   直坠）vs vanilla=蹬墙跳。湿支 else-if 链本就互斥（:7168 链形）。
      if (!mountJumpFired && !jumpStartedThisTick && vyAtJumpGate !== 0 && jumpEdge && this.inputDown
        && eqM.hasDeadCellsDownDash && !this.ridingMount && !this.isDownDashing) {
        this.isDownDashing = true;
        this.vy = 16 * gd;
        this.jumpHold = 0;
        this.canRocket = false;
        this.rocketRelease = false;
        downDashFired = true;
      }
      // ---- 多段跳（JumpMovement :20899-21197）：高度表 1:1——沙暴 jumpHeight×3
      //      （:20970）/ 暴雪 (int)(×1.5)（:20980）/ 航行瓶 (int)(×1.25)（:20992）/
      //      屁瓶 ×2（:21023）/ 独角兽×2（:21048）/ 血肉山羊×2（:21076）/ 蜥蜴坐骑
      //      (int)(×0.75)（:21104）/ 圣诞坦克×2（:21134）/ 云朵 (int)(×0.75)（:21181）。
      //      消费优先序（:20875-20922 else-if 链）：坐骑族 Basilisk>WoFGoat>Santank>
      //      Unicorn 在前,瓶族 Sandstorm>Blizzard>Fart>Sail>Cloud（Cloud 兜底必消费）。
      //      R5-F9/F10：旧表 Fart/Cloud 1.25、Sail 落 1.0（'Tsunami' 键在数据不存在）
      //      + JUMP_ORDER 完全倒序,均已修。
      //      起跳帧特效（:20953-21196）：沙暴/暴雪/航行 播 SoundID 16（Item_16 跳跃音）；
      //      屁瓶 10×尘188+3×gore435-437（:21024-21038）；航行瓶 30×尘253（:20993-21011）。
      //      持续尾迹见 doubleJumpVisuals（DoubleJumpVisuals :21615-21745） ----
      const eq = eqM;
      // RefreshDoubleJumps 落地段（:23053-23055 isPerformingJump_DownDash=false 同位并入）
      if (this.onGround) { this.extraJumps = [...eq.jumpOpts]; this.performingJump = null; this.isDownDashing = false; }
      // 坐骑封段（Mount.BlockExtraJumps，Player.cs:25730）：大多数坐骑禁多段跳。
      // 触发门 = releaseJump（:20845 `(releaseJump || (autoJump && (vy==0||sliding)))`
      // ——空中档 autoJump 分支 vy==0 恒假,多段跳【必须松键再按】。R5-F11：旧 held 门
      // （inputJump+vy>-2+8t cd）按住跳键即自动连段,已废;坐骑跳与多段跳同帧互斥
      // （原版 :20935 else-if 链单分支）由 mountJumpFired 旗保证）。
      // ★BJ534：下砸腿与多段跳同帧互斥（原文 else-if 链,flag13 在瓶族前）——
      //   downDashFired 帧多段跳不消费；反向：多段跳消费帧 :20934 无条件写 flag13=false
      //   （双跳打断下砸），此处随腿清。
      // ★BJ704-G16（G15 登记债③）：!jumpStartedThisTick 互斥（vanilla :20845-21196 单
      //   if-else-if 链——首支 (sliding||vy==0) 过门即普通跳支,瓶族不可达;且 :20931
      //   `if (vy==0||sliding||…) RefreshDoubleJumps()` 同拍退款=瓶不实耗）。仓内干支
      //   首跳门拆独立 if → 瓶族缺互斥：挂壁/水面钉位/贴轨/hoverGrounded（皆
      //   onGround=假）+瓶在身按跳 → 旧=同拍首跳+瓶跳双发（vy 二写同值但瓶 charge 实耗
      //   +jumpHold 落瓶档 ×0.75 等=比普通跳更矮,G15 探针 P1c 实证面）。湿支 else-if
      //   链（:7186）本就互斥。onGround∧vy≠0 坡面瞬态（vanilla=瓶/下砸支,仓=普通跳）
      //   =首跳门 onGround 代 vy==0 既有近似域,另册登记不动。
      //   ★BJ704-G19 维持备案判语（G16 债①复核,2026-10-21）：瞬态=坡面下行 1-2 拍
      //   （vy=坡降残余≠0 而 onGround 真）;面非零但超窄——修法须把首跳门从 onGround
      //   近似改 vy==0 字面相位,牵连 hoverGrounded/onTrack/hitHead/waterSurface 四臂
      //   承重（各自修过的实报面）=相位重构非漏行补刀。勿按「简单漏行」再登记;
      //   根治归 jump 相位域批（与 [g19-jump-release-zero] 同域）。
      if (!this.onGround && !mnt2?.blockExtraJumps && jumpEdge && this.extraJumps.length > 0
        && !mountJumpFired && !downDashFired && !jumpStartedThisTick) {
        const opt = this.extraJumps.shift()!;
        const hMult = jumpHMultOf(opt);   // ★C5-B7 单源（:20899-21197 各档,湿支同表）
        this.vy = -mJumpSpd * gd;
        this.jumpHold = Math.round(mJumpTicks * hMult);
        jumpStartedThisTick = true;   // ★BJ717-A F6（干瓶臂同款）：起跳拍 sustain 不跑（原版 :20823/:20845 同拍互斥,jump-- 次拍起;redblue-r5 高度表 −2 期望随刀迁移）
        this.performingJump = opt;                          // isPerformingJump_* 等价标记
        this.isDownDashing = false;                         // :20934 门帧写 flag13=false——双跳打断下砸（★BJ534）
        // 双跳音分流（Player.cs:20689/:20966 族 SoundEngine.PlaySound(16)=cue16
        //   DoubleJump（SoundID.cs:54）→ Sounds/Double_Jump.wav（LSP.cs:235 Load,
        //   :846-857 case16 Pitch±0.10 经 PITCH_CASE 生效）;屁瓶例外 :21019 用
        //   SoundID.Item16=bank(2,16)=Item_16.wav（PITCH_CASE Item 档 ±0.06）。
        //   ★case16 单实例语义差异备案：原版播前 Stop 上一 DoubleJump 实例,本仓
        //   非 Item_N 文件不入单实例槽——快速连段可能叠响,登记不建模）
        if (opt === 'Fart') game.playSfxWav?.('Item_16', 1, this.cx, this.cy);
        else game.playSfxWav?.('Double_Jump', 1, this.cx, this.cy);
        const D = game.vanillaDust;
        const mk = (x: number, y: number, w: number, h: number, type: number,
          alpha: number, scale: number, vx = 0, vy = 0) => D ? D.spawn(x, y, w, h, type, vx, vy, alpha, null, scale) : null;
        if (opt === 'Fart') {
          const fy = gd === 1 ? this.y + this.h - 16 : this.y - 16;
          for (let m = 0; m < 10; m++) {
            const d = mk(this.x - 34, fy, 102, 32, 188, 100, 1.5, -this.vx * 0.5, this.vy * 0.5);
            if (d) { d.vx = d.vx * 0.5 - this.vx * 0.1; d.vy = d.vy * 0.5 - this.vy * 0.3; }
          }
          for (let gi = 0; gi < 3; gi++) {
            const gx = gi === 0 ? this.x + this.w / 2 - 16 : gi === 1 ? this.x - 36 : this.x + this.w + 4;
            const g = GorePiece.newGore(435 + (Math.random() * 3 | 0), gx, fy, -this.vx, -this.vy, 1, false);
            if (g) { g.vx = g.vx * 0.1 - this.vx * 0.1; g.vy = g.vy * 0.1 - this.vy * 0.05; }
          }
        } else if (opt === 'Sail') {
          const sy = gd === 1 ? this.y + this.h : this.y;
          for (let l = 0; l < 30; l++) {
            const d = mk(this.x, sy, this.w, 12, 253, 100, 1.5, this.vx * 0.3, this.vy * 0.3);
            if (!d) continue;
            if (l % 2 === 0) d.vx += (30 + Math.random() * 41 | 0) * 0.1;
            else d.vx -= (30 + Math.random() * 41 | 0) * 0.1;
            // ★O3 漏网核销(2026-09-02)：1457 Player.cs:21003/:21005 = Next(-10,31)/
            //   Next(-10,41) 整型掷——曾 `rand*41-10|0`/`rand*51-10|0` 用 |0 向零截断，
            //   负数侧整桶上移且 −10 端永不可取（floor 才是 Next 直译），改 floor 形
            d.vy += (Math.floor(Math.random() * 41) - 10) * 0.1;
            d.noGravity = true;
            d.scale += (Math.floor(Math.random() * 51) - 10) * 0.01;
            d.vx *= d.scale * 0.7; d.vy *= d.scale * 0.7;
          }
        }
      }
      // ★BJ717-A F1：sustain 钉=JumpMovement 位（干支同款,臂段尾/飞行链与重力前）。
      sustainPin();
      // 多段跳上升尾迹（DoubleJumpVisuals，Update :26445 每帧调用位）
      this.doubleJumpVisuals(game);
      // ★BJ704-G15（G13 登记债⑦）：CCed 臂尾视觉复位两笔（vanilla :27011-27012,湿支
      //   同款双笔——位序=尾迹后/物理链前;承载与注见湿支同块）
      if (this.cced) { this.performingJump = null; this.isDownDashing = false; }
      // ---- 坐骑飞行族接管（Player.cs:26637-26700 的 else-if 链 1:1）----
      // usesHover（UFO/蜜蜂/猪鲨崽/巫婆扫帚/熔岩鲨(水中)）→ Mount.Hover 接管 vy
      //（flyTime→疲劳双池，疲劳满失升力）；非 hover 飞行坐骑（驯鹿/猪龙）→ 按住跳
      // 消耗 flyTime 爬升（0.1/tick、上限 -jumpSpeed×1.5），耗尽重力/3 缓降。
      // 两者独占 vy：下方翅膀/火箭靴段与重力段全部跳过（原版同链互斥）。
      // ★BJ703-D2 坐骑飞行域【当拍重力场】（:27210 耗尽臂 `velocity.Y += gravity/3f`
      //  的 gravity=Player 字段,Update 头 :24559-24884 已算——干域唯一缩放项=太空带
      //  ×num6 深度缩放 :24884,旧常量 GRAVITY/3 在太空带 4× 偏快（num6 下钳 0.25）。
      //  就地 fresh 算（同 :7790 干重力块式,先例墙滑 gFieldWs :7673——本段在重力块
      //  【前】,仓内无同拍字段可读;湿态 0.2/蜜 0.1 液体档在仓内经湿支先行让位=本
      //  支不可达——湿支坐骑 vy 链已由 BJ704-G4 落地（湿段另有 mountGFieldW 就地
      //  算,本常量段仅辖干支））。maxFallSpeed
      //  无 num6 乘区（:24884 只乘 gravity）,终端钳保持常量 PLAYER_MAX_FALL_SPEED/3。
      // ★BJ704-G12（G5 登记债5）：num6 计算提至 if(mnt2) 外——干域重力场单源
      //   （mountGField=GRAVITY×num6）,坐骑链与下方毯带（CarpetMovement :22037
      //   `float num = gravity` 读字段=0.4×num6,镜像湿支 ⑤a lGrav 并源式）共用;
      //   旧毯带恒 GRAVITY 常数=太空带毯缓降带 4× 偏陡。mnt2 域内值不变（同式同序）。
      let mountGField = GRAVITY;
      {
        const n5D2 = (world.w / 4200) ** 2;
        let num6D2 = (this.y / 16 - (60 + 10 * n5D2)) / (world.groundLevel / 6);
        if (world.seedFlags?.remix) num6D2 = (this.y / 16 - (60 + 10 * n5D2)) / world.groundLevel;
        num6D2 = Math.min(1, Math.max(world.seedFlags?.remix ? 0.1 : 0.25, num6D2));
        if (Number.isNaN(num6D2)) num6D2 = world.seedFlags?.remix ? 0.1 : 0.25;   // FX20 同款防灌
        mountGField = GRAVITY * num6D2;
      }
      // ★BJ704-G16（G15 登记债①）：CCed 物理臂坐骑链让位（vanilla :26999-27014
      //   `if (CCed) {…vy+=gravity+钳…} else {整链}`——坐骑 Hover/Flight 链整段在
      //   else 内）。55/56/61 拒下坐骑者（DONT_DISMOUNT_WHEN_CCED,下坐闸 :6262 已
      //   承载）CCed 中不悬停:56 蝙蝠/61 仙灵 hover() 静置 -0.001 收敛+位补=静悬浮
      //   vs vanilla 平重力下坠。canFly 支 inputJump 已被 CCed 清零段(:6107)压死,
      //   门只为 canHover 支而设（两支合并门=零非 CCed 扰动）。
      // ★BJ717-A F10（2026-10-25,R13 清偿）：!rocketDelay=原版 :27158 else-if 互斥
      //   （`if (rocketDelay > 0) {推力} else if (!flag19) {坐骑链}`）——推力脉冲期
      //   坐骑 Hover/Flight 整链【不跑】（flyTime/fatigue 不烧;vanilla 终 vy=推力值
      //   同,旧仓先跑坐骑再被推力覆写=能量静默消耗,唯副作用差）。
      if (mnt2 && !this.cced && this.rocketDelay === 0) {
        if (mnt2.canHover(this)) {
          mnt2.hover(this, mountGField);   // ★BJ704-G5（G4-②）重力场感知（当拍 fresh）
          mountFlight = true;
        } else if (mnt2.canFly(this) && this.inputJump && this.jumpHold === 0) {
          if (mnt2.flight()) {
            // ★BJ701 按住↓悬停钉位（1457 Player.cs:27168-27175）：Flight 余能期
            //   TryingToHoverDown（=controlDown∨锁存,getter :10416）→ vy×0.9 阻尼 +
            //   (-1,0.5) 窗内钉 1e-05——史后坐骑 50「按住↓悬浮」（横向速度不经
            //   本支=可漂移）；不按↓走原爬升链（else 支,原语义零变化）。
            if (this.tryingToHoverDown) {
              this.vy *= 0.9;
              if (this.vy > -1 && this.vy < 0.5) this.vy = 1e-5;
            } else {
              let js = mJumpSpd;
              if (mnt2.type === 50) js *= 0.5;               // 史后坐骑爬升减半（:26660）
              if (this.vy > 0) this.vy -= 0.1 * 5;          // 下落中反抽 5×（:26672）
              else if (this.vy > -js * 1.5) this.vy -= 0.1;
              if (this.vy < -js * 1.5) this.vy = -js * 1.5;
            }
          } else {
            // 能量耗尽缓降（:26683-26696 / 1457 :27208-27222）：重力/3 + 终端
            //   maxFallSpeed/3——★BJ701 补悬停向门（:27213/:27218,翼链 :27544 同族）：
            //   按↓（gd=1）/按↑（gd=-1）驻留时不钳,gravity/3 持续累积=原版
            //   「能量尽仍按↓」快坠面。★BJ703-D2：重力源=当拍重力场 mountGField
            //   （上方链头计算）非常量。
            this.vy += mountGField / 3 * gd;
            const cap = PLAYER_MAX_FALL_SPEED / 3;
            if (gd === 1) {
              if (this.vy > cap && !this.tryingToHoverDown) this.vy = cap;
            } else if (this.vy < -cap && !this.tryingToHoverUp) this.vy = -cap;
          }
          mountFlight = true;
        }
      }
      // ---- 翅膀/火箭靴/飞毯 1:1（Player.Update :26388-27092 + WingMovement :21746 +
      //      CarpetMovement :21568 + RocketBoots :26548-26628）----
      // 坐骑禁翼禁靴（Player.cs:26316-26322：mount.Active → rocketBoots=0、
      // CanUseWings 假族 wings=0——本仓坐骑恒属禁翼族）
      // ★1457 翅膀"隐藏显形"门变更（ApplyEquipFunctional :15710-15716,1456 :12583）：
      // `!hideVisibleAccessory[slot] || (vy≠0 && mount.CanUseWings)` → `(… && !mount.Active)`
      // ——1456 骑【可飞】坐骑时被隐藏的翅膀下落中仍显形,1457 骑任何坐骑都不再显形。
      // 本仓 per-slot 隐藏已建模（hideVisibleAccessory,聚合侧 hidden 旗随翼记录）:
      // 隐藏翼的【飞行逻辑】不受影响（原版 wingsLogic 恒写 :12585,本仓 wingsLogic
      // 同）,显形门在渲染侧补 vy≠0 特例（Renderer 翅膀层）。
      // 绘制侧 ShouldDrawWingsThatAreAlwaysAnimated（:30271,1457 未改,仍 mount.CanUseWings）
      // 本仓以 !ridingMount 等价（坐骑恒禁翼族,两式同假）——下方 shouldDraw 同。
      // R4-23（P57:26824-26834 + Mount.cs:572-580）：原版骑乘只清【禁翼族】坐骑
      // （CanUseWings 缺省 false,仅滚轴鞋 57-60 置 true）;本仓曾骑任何坐骑恒清零。
      // 与 Renderer.ts 翼门同表（vanilla-mounts.json 仅 57-60 带键）
      const mountCanWings2 = !mnt2 || MOUNT_DATA[String(mnt2.type)]?.CanUseWings === true;
      const wings = eq.wing && mountCanWings2 ? eq.wing.logic : 0;   // wingsLogic = armor.wingSlot（:12584）
      const wingsLogic = eq.wing && mountCanWings2 ? eq.wing.logic : 0;  // 骑禁翼族清零（:26833-26835，2026-09-03 矫正旧"不清"误读）
      const hoverDown = this.tryingToHoverDown;    // TryingToHoverDown（:3920-3927——★SW-FX14
      //  2026-09-10 锁存接线：旧注"保持态近似省略"登记债清偿，Click 档经
      //  tryKeepingHoveringDown（Player.cs:1801/:25452-25484）驻留悬停）
      const JS = PLAYER_JUMP_SPEED + eqM.jumpSpd;   // jumpSpeed（含 jumpSpeedBoost）
      // 落地重置（原版 :26173 地面块——wingTime/rocketTime 回满已并入跳跃段尾
      // ★回满/清零公共段 = :26947-26982 原文位序；此处保留 rocket/carpet 连带复位）
      // 松跳重触发（原版 :20765 松跳段独立于地面状态——rocketRelease/wingRelease）
      if (!this.inputJump) { this.rocketRelease = true; this.wingRelease = true; }
      // flying（flag19）声明已上提到跳跃参数块（干/湿两支共用——湿态扇动支 2026-09-03 落位）
      if (this.onGround) {
        this.rocketDelay = 0;
        this.canRocket = false;
        this.rocketRelease = false;
        // ★BJ704-G5（R4-P2①）：毯复位（canCarpet/carpetTime,BJ699 定谳的清零面）
        //  迁出至 fixedUpdate 头部公共位（vy==0∨sliding 域,每拍门）——本块只余
        //  火箭三件复位。激活面（canCarpet=false+carpetTime=300 授予拍）不动。
      } else if (!this.cced) {
        // ★BJ704-G16（G15 登记债① 连带）：CCed 空中支整块让位（vanilla 该块全在
        //   CCed 臂的 else 内——canRocket 门/翼火箭合并/点火/推力脉冲/飞毯/悬浮缓降
        //   一并不跑）。核心面=推力脉冲（rocketDelay>0 期 vy-=0.1/0.5 档直写）:
        //   冻结中续推=vanilla 已停（解冻后 rocketDelay 保留续推,原版同构——
        //   rocketDelay-- 只在 else 内跑=冻结期冻结计数）。flying 留 false ≙
        //   flag19（CCed 清 controlJump → 原版同假）。
        // canRocket 门（:26974-26976）：gd=1 → vy > -jumpSpeed；gd=-1 → vy < jumpSpeed
        //（★SW-FX34 补倒挂臂——旧恒 gd=1 形,倒挂升限/坠落端错置）且 vy≠0
        if ((this.gravDir === -1 ? this.vy < JS : this.vy > -JS) && this.vy !== 0) this.canRocket = true;
        // rocketTime 回满（:27060-27063 vy==0||sliding||(autoJump&&justJumped)——含
        // 撞顶悬停/贴墙滑/autoJump 起跳帧，已并入下方公共段（原 vy==0 单臂近似退役）
        // flag19 = 翅膀飞行中（:26469-26483：wings>0 && controlJump && wingTime>0 &&
        //   jump==0 && vy≠0；hover 档固定集 {22,28,30,32,29,33,35,37,45} + ↓+跳 :26477）
        flying =
          (wings > 0 && this.inputJump && this.wingTime > 0 && this.jumpHold === 0 && this.vy !== 0)
          || (FLAP_HOVER_SET.has(wingsLogic) && this.inputJump && hoverDown && this.wingTime > 0);
        if (this.isDownDashing) flying = false;   // ★BJ534：flag20 → flag19=false（:26995-26998——下砸期扇动/滑翔全让位）
        if (flying) {
          this.wingMovement(wings, hoverDown, JS, eq.wing ? eq.wing.time : 0);   // ★BJ216 wingMax（:22419 徽章回满上限）
          // ★ WingFrame 帧状态机已移至 if/else 之后每 tick 执行（原版 :26498
          //   无条件调 WingFrame(flag19)——33/38 落地不归零等语义依赖此执行位）
        }
        // 翅膀+火箭靴动态合并（:26523-26531）：空中且 rocketTime 有余 →
        // 剩余脉冲×6 并入 wingTime（上限 = wingTimeMax + 本次转换量），rocketTime 清零
        if (wings > 0 && eq.rocketBoots > 0 && this.vy !== 0 && this.rocketTime > 0) {
          const add = this.rocketTime * 6;
          this.wingTime += add;
          const cap = (eq.wing ? eq.wing.time : 0) + add;
          if (this.wingTime > cap) this.wingTime = cap;
          this.rocketTime = 0;
        }
        // ---- 火箭靴（:26548-26628）：翅膀不可用（无翅或时间尽）才接管 ----
        // ★BJ717-A F3（湿支同款,干支补腿）：!isDownDashing=CanUseBootFlyingAbilities
        //   （:27069 第 7 项/:3972 `!isPerformingJump_DownDash`,BJ534 同波漏员）。
        if (!flying && !mnt2 && (this.wingTime <= 0 || wings === 0) && eq.rocketBoots > 0
          && this.inputJump && this.rocketDelay === 0 && this.canRocket && this.rocketRelease
          && !this.isDownDashing) {
          if (this.rocketTime > 0) {
            this.rocketTime--;
            this.rocketDelay = 10;    // 推力脉冲段（:26556）
            if (this.rocketDelay2 <= 0) this.rocketDelay2 = eq.rocketBoots === 1 ? 30 : 15;
          } else {
            this.canRocket = false;
          }
        }
        if (this.rocketDelay2 > 0) this.rocketDelay2--;
        if (this.rocketDelay > 0) {
          // 推力脉冲速度模型（:27126-27140，与翅膀同构 0.1/0.5/1.5 档）：
          // ★SW-FX34 补倒挂臂（:27127 `-= 0.1f * gravDir` + :27141-27152 else 镜像）
          this.rocketDelay--;
          this.vy -= 0.1 * this.gravDir;
          if (this.gravDir === -1) {
            if (this.vy < 0) this.vy += 0.5;
            else if (this.vy < JS * 0.5) this.vy += 0.1;
            if (this.vy > JS * 1.5) this.vy = JS * 1.5;
          } else {
            if (this.vy > 0) this.vy -= 0.5;
            else if (this.vy > -JS * 0.5) this.vy -= 0.1;
            if (this.vy < -JS * 1.5) this.vy = -JS * 1.5;
          }
          this.fallStartY = null;
        } else if (!flying) {
          // ---- 飞毯（CarpetMovement :21568-21602）：条件=无多段跳余量/jumpHold 空/
          //      vy≠0/火箭靴未在用/翅膀时间尽；效果=vy 钳到 -(gravity+ε) 抵消重力 ----
          if (eq.carpet && !mnt2 && !this.grappling[0] && this.extraJumps.length === 0 && this.jumpHold === 0
            && this.vy !== 0 && this.rocketTime === 0 && this.wingTime <= 0) {   // !grappling[0]: SW-RB6b 2026-09-07（:22025）
            // ★SW-FX19：倒挂禁【新激活】（:26312-26314；干支——已激活毯续期 :22038 不受限）
            if (this.gravDir === -1) this.canCarpet = false;
            if (this.inputJump && this.canCarpet) { this.canCarpet = false; this.carpetTime = 300; }
            if (this.carpetTime > 0 && this.inputJump) {
              this.carpetTime--;
              this.carpetFlying = true;   // ★BJ704-G5（R4-P2②）本拍在展开（≙ carpetFrame>=0）
              this.fallStartY = null;
              // :22038-22045 微升抵消随后重力 → 净缓降。★SW-FX34 补倒挂臂：
              //  gd=1 → `vy > -gravity` 才钉 -(gravity+ε)；gd=-1 → `vy < gravity`
              //  钉 +(gravity+ε)（已激活毯倒挂续期 :22041 不受限——FX19 的
              //  canCarpet=false 只封【新激活】）。gd=1 分支维持仓内旧无条件写
              //  （上升段条件缺失=已登记债,本波 gd=1 禁碰）。
              // ★SW-FX40（a·gd=1 行为补齐）：gd=1 臂补门 `vy > -gravity`（:22037-22040,
              //  同湿档注）——上升段不再被剪成 -(g+ε)。FX34 注的"gd=1 禁碰债"就此清偿。
              // ★BJ704-G12（G5 登记债5）：gravity=字段（:22037 `num = gravity`——
              //  干域 0.4×num6,上方 mountGField 并源）非 GRAVITY 常数（旧太空带
              //  毯缓降带 4× 偏陡;湿支 lGrav 档 G5-⑤a 已同修）。
              if (this.gravDir === -1) {
                if (this.vy < mountGField) this.vy = mountGField + 1e-6;
              } else if (this.vy > -mountGField) {
                this.vy = -(mountGField + 1e-6);
              }
            }
          }
        }
        // 悬浮缓降（真锚 :27607-27619,重力后公共段——旧注「:27083-27102」系误锚）：
        //  硬码槽位集 {22,28,30,31,33,35,37,45}（HOVER_SLOWFALL_SET——★BJ722-A
        //  [bj717a-hover-slowfall-slotset]：旧谓词 eq.wing?.hover=五员 stats 表,
        //  28/33/35 漏 ×0.9/×0.8）+ ↓+跳 + wingTime>0 → vy×0.9（45=0.8）。
        //  canUseWingAbilities（:3975-3982 = !merman∧!downDash）——干支 merman 不可达
        //  （merman 置位需 inWater :5649）,!isDownDashing 腿 BJ722-A 补（BJ717-A
        //  [bj717a-hover-slowfall-downdash]——下砸期不缓降）
        if (HOVER_SLOWFALL_SET.has(wings) && hoverDown && this.inputJump && this.wingTime > 0
          && !this.isDownDashing) {
          this.vy *= wings === 45 ? 0.8 : 0.9;
          if (this.vy > -2 && this.vy < 1) this.vy = 1e-5;
        }
        // ★BJ722-A [bj717a-wing37-extra-slowfall]：翼 37（Betsy）在 :27607 ×0.9 之上
        //  【再】×0.92（:27620-27626——37 双表在列,独立 if 全谓词复检=原版形态）
        if (wings === 37 && hoverDown && this.inputJump && this.wingTime > 0
          && !this.isDownDashing) {
          this.vy *= 0.92;
          if (this.vy > -2 && this.vy < 1) this.vy = 1e-5;
        }
      }
      // ---- 翅膀帧状态机（Player.cs:27018-27021 `WingFrame(flag19)`——★BJ704-G19
      //      锚勘正+CCed 冻结（G16 债④b 清偿）：原版全文件唯一调用位在 CCed 臂
      //      else 内（:26999-27014 `if (CCed)… else {…WingFrame(flag19);…}`）,旧注
      //      「:26497-26501 每 tick 无条件」系误锚（该行为 pulley/forcedGravity 区,
      //      无 WingFrame）——冻结中帧不推进,解冻续走。地面也跑——33/38 落地保持
      //      帧 2、generic 地面归 0 均在此位生效。 ----
      if (wingsLogic > 0 && !this.cced) {
        const glide = !flying && this.inputJump && this.vy > 0 && !this.isDownDashing;   // :26718 族 !downDash 门（★BJ534 落位）
        this.wingFrameScratch.frame = this.wingFrame;
        this.wingFrameScratch.counter = this.wingFrameCounter;
        stepWingFrame(wingsLogic, this.wingFrameScratch, {
          flap: flying,
          jump: this.jumpHold > 0,
          vy: this.vy,
          controlJump: this.inputJump,
          controlLR: this.inputX !== 0,
          hoverDown, hoverUp: this.tryingToHoverUp,   // ★SW-FX14 :29714/:29792 取值门
          wingTime: this.wingTime,
          glide,
          downDash: this.isDownDashing,   // ★BJ534：⑤号债清偿（vanillaWingVisuals 台账——WingFrame 下砸帧态）
          waterFloat: wetVanilla && this.shouldFloatInWater,   // WingFrame :30456/:30724/:30732 wet && ShouldFloatInWater
          // ShouldDrawWingsThatAreAlwaysAnimated :30969-30980（坐骑恒禁翼 → !ridingMount）
          shouldDraw: this.vy !== 0 && !this.ridingMount
            && !this.grappleProjs.some((g) => g.latched)
            && !(wetVanilla && this.shouldFloatInWater),
        });
        this.wingFrame = this.wingFrameScratch.frame;
        this.wingFrameCounter = this.wingFrameScratch.counter;
        // 翅膀尘埃/音效（WingAirVisuals :30284 + WingFrame 各分支尘 + 滑翔尘 :26914+）
        this.wingFx(game, wings, wingsLogic, flying, glide, !!this.wingFrameScratch.justSwitched);
      }
      // ---- 冲刺 1:1（DashMovement + DoCommonDashHandle）——★BJ524 提取为 dashMovement()
      // 方法（干/湿两支共用;原版 :26958 无条件调用,wet 不闸）。位次保持:翼帧段后、
      // wallCling/ratClimb/spikedBoots/重力施加前 ----
      this.dashMovement(game, eqM, ix, maxRun, accRun, runSlow, runAcc);
      // ---- 攀壁钉鞋（spikedBoots：攀爬爪/鞋钉/忍者大师装备——贴墙缓降+蹬墙跳）----
      this.wallCling = false;
      // ---- 老鼠坐骑 55 爬墙（WallClimbMovement :21329-21450 非 spikedBoots 支）：
      //      按向墙方向 + 墙延到脚下一格 → 上 -2/t、下 4/t、松手 0.5/t 缓滑；
      //      fallStart 重置免坠伤；爬墙期间平台穿透（:27777 flag29 num107!=0）----
      this.ratClimbVy = null;
      const ratClimb = this.mount.active && this.mount.type === 55
        && !this.onGround && this.hitWall && this.inputX !== 0
        && Math.sign(this.inputX) === Math.sign(this.vx || this.facing);
      if (ratClimb) {
        const st = game.world.store;
        const sideX = this.inputX > 0
          ? Math.floor((this.x + this.w + 1) / TILE) : Math.floor((this.x - 1) / TILE);
        const footY = Math.floor((this.y + this.h + 1) / TILE);
        if (st.inBounds(sideX, footY) && st.isSolid(sideX, footY)) {
          this.ratClimbVy = this.inputUp ? -2 : this.inputDown ? 4 : 0.5;
          this.fallStartY = null;
          this.wallCling = true;
          this.slideDir = this.inputX > 0 ? 1 : -1;   // ★BJ704-G15：挂壁向（WallClimbMovement 头门 :21793 按=撞向;蹬墙跳反踢 :20950 消费）
          game.spawnParticles(this.inputX > 0 ? this.x + this.w : this.x,
            this.cy, '#B0907A', 1, 0.5, { life: 20 });
        }
      }
      // ★SW-FX1 档位分档（WallslideMovement :21955-22016 双支 1:1）：
      //  ≥2 驻停档（:21955-21990,976/984/3995/3996）——头门 vy>0 即挂墙（:21957）；
      //  按 ↓ vy=4*gravDir 快滑（:21960），否则 vy=(−gravity+1e-5)*gravDir
      //  （:21988-21997 num3=gravity,slowFall 时 /3——TryingToHoverUp /10 档本仓
      //  无翼悬停升键建模,登记偏差）= 缓慢上攀驻停;尘 31 只在 ↓ 支（:21961）。
      //  ==1 缓降档（:21991-22016 else-if,裸 953/975）——门 vy>0.5（:21991）；
      //  按 ↓ 4、否则 0.5 缓滑（:21995-21999）,尘 31 恒出（:22002）。曾布尔化
      //  1/2 同档 vy=min(vy,1.5)——按 ↓ 快滑/驻停上攀两语义整缺。
      //  蹬墙跳仍统一走 JumpMovement 外门（wallCling=sliding 仓内承载位）。
      if (eq.spikedBoots > 0 && this.hitWall && this.inputX !== 0 && !this.mount.active) {
        // ★mount.Active 排除（WallslideMovement 头门 :21935——坐骑中贴墙滑/驻停整段不跑;
        //  ★SW-RB11f F3：`!this.onGround` 撤除——原版头门（:21935-21937 slideDir==0∨
        //  spikedBoots<=0∨mount.Active∨方向不符）【无】落地态项,落地排除由内层 vy 门
        //  自然承载（gd=1: vy>0/vy>0.5 恒假;gd=-1: 天花板挂壁 vy=0 <gravity=原版
        //  驻停-active 态,旧外门把整类堵死）。
        //  老鼠坐骑 55 爬墙走上方 ratClimb 专属支,非 55 坐骑两支皆拒）
        const slideDirSign = Math.sign(this.inputX);
        // ★SW-FX19：门与速度全 ×gravDir（:21957 头门 gravDir==1→vy>0 / gravDir==-1→
        //   vy<-gravity 镜像,:21994 tier1 门 `vy>0.5&&gravDir==1 || vy<-0.5&&gravDir==-1`;
        //   速度字面 :21960/:21988-21997/:21996/:21998 均 `f*gravDir`——倒挂即镜像,
        //   gravDir=1 时数值逐位恒等）
        const gdSlide = this.gravDir;
        // ★SW-RB11b F1：flag 双格探针（:21944-21954）：slideDir 向邻列
        //  num=position.X(+width if slideDir==1)+slideDir、num2=gd>0?(y+h+1):(y-1)，
        //  须 WorldGen.SolidTile(col,num2) ∧ SolidTile(col,num2-1) 双格实——
        //  墙延到玩家重力向边缘之外才可挂。原版 flag 同时吃 ≥2 门（:21957 !flag 早退）
        //  与 <2 门 gd=1 半边（:21991;gd=-1 半边无 flag=原文 quirk）。缺此探针=
        //  悬浮墙（不落地墙/墙底缘以下）可驻停攀爬（Tiger Climbing Gear 越悬浮岛）。
        //  slideDir≙按压向（:28456 由碰撞拍写入=撞向,头门已要求按向=撞向）
        const stWs = game.world.store;
        const colWs = Math.floor((slideDirSign > 0 ? this.x + this.w + 1 : this.x - 1) / TILE);
        const edgeWs = Math.floor((gdSlide > 0 ? this.y + this.h + 1 : this.y - 1) / TILE);
        const wsSolid = (c: number, r: number) => stWs.inBounds(c, r) && stWs.isSolid(c, r);
        const wsFlag = wsSolid(colWs, edgeWs) && wsSolid(colWs, edgeWs - 1);
        // ★SW-RB11b F2：原版门/num3 读 Player.gravity 字段=0.4×深度斜率（:24559 拍首
        //  复位 0.4f → :24880 `gravity *= num6`——先于 :26965 调用）——高空带 num6<1
        //  时上攀速度与 gd=-1 门阈值同步缩小。num6 式与 :24861-24879 一致（remix 分母
        //  worldSurface/1、钳 0.1/0.25~1；本仓 III224 块同式,world.groundLevel≡worldSurface）
        const n5Ws = (game.world.w / 4200) ** 2;
        let num6Ws = (this.y / 16 - (60 + 10 * n5Ws)) / (game.world.groundLevel / 6);
        if (game.world.seedFlags?.remix) {
          num6Ws = (this.y / 16 - (60 + 10 * n5Ws)) / game.world.groundLevel;
        }
        num6Ws = Math.min(1, Math.max(game.world.seedFlags?.remix ? 0.1 : 0.25, num6Ws));
        // ★SW-FX20 NaN 防灌同款（III224 块）：半成品 world 夹具 w/groundLevel=undefined →
        //  num6=NaN 穿钳 → gFieldWs=NaN → vy=NaN 整链冻结——归各支下钳档
        if (Number.isNaN(num6Ws)) num6Ws = game.world.seedFlags?.remix ? 0.1 : 0.25;
        const gFieldWs = GRAVITY * num6Ws;
        // ★SW-RB11f F3：tier2 头门按原版异或形拆写（:21957 `(!(vy>0)||gd!=1) &&
        //  (!(vy<gravity)||gd!=-1)` 取反 = (vy>0∧gd==1)∨(vy<gravity∧gd==-1)——
        //  旧 `vy*gdSlide>0` 在倒挂半边漏 vy∈[0,gravity) 带（贴墙静止 vy=0/碰撞钳
        //  0 帧不驻停=脱挂下坠）;gd=1 半边逐位恒等。★SW-RB11b：补 !flag 早退半边
        //  （:21957 首项）+ gravity 字段=深度缩放值（gFieldWs））
        if (eq.spikedBoots >= 2 && wsFlag
          && ((gdSlide === 1 && this.vy > 0) || (gdSlide === -1 && this.vy < gFieldWs))) {
          // ≥2 驻停档（:21955-21990）：快滑臂 = (↓∧gd==1)∨(↑∧gd==-1)（:21958-21960
          //  `(controlDown && gravDir==1f) || (controlUp && gravDir==-1f)`——★SW-RB11b
          //  旧只认 ↓,倒挂时原版按 ↑ 快滑）;否则 (−num3+1e-5)×gravDir 缓慢上攀
          if ((this.inputDown && gdSlide === 1) || (this.inputUp && gdSlide === -1)) {
            this.vy = 4 * gdSlide;          // :21960 velocity.Y = 4f*gravDir（★SW-FX19 ×gravDir）
            this.spawnWallSlideDust(game, slideDirSign);       // :21961-21975 尘 31
          } else {
            // :21960-21968 + :21988-21997 1:1（★SW-FX14：slowFall 时 TryingToHoverUp
            // /10 档接线（:21964））。★SW-RB11b F2b：slowFall 档 num3=gravity/3f*gravDir
            //  （:21963-21967 gravDir【在内】——外式再 ×gravDir 双乘相消=慢Fall 时
            //  vy≡−g/3 与重力向无关（原文 quirk）;旧无内乘 → 倒挂半边符号翻转）;
            //  gravity 字段=深度缩放值（num3=:21962 `float num3 = gravity`）
            const num3 = (this.buffs.slowFall || this.equipStats.slowFall)
              ? (this.tryingToHoverUp ? gFieldWs / 10 : gFieldWs / 3) * gdSlide
              : gFieldWs;
            this.vy = (-num3 + 1e-5) * gdSlide;   // :21979-21997 `(−num3+1E-05f)*gravDir`
          }
          this.fallStartY = null;           // :21959 fallStart 重置
          this.wallCling = true;            // :21989 sliding=true 仓内承载位
          this.slideDir = slideDirSign;     // ★BJ704-G15：挂壁向与 wallCling 同拍配对写（反踢 :20950 消费）
        } else if (eq.spikedBoots < 2
          && ((wsFlag && this.vy > 0.5 && gdSlide === 1) || (this.vy < -0.5 && gdSlide === -1))) {
          // ==1 缓降档（:21991-22016 else-if,裸 953/975）：↓ 4 / 否则 0.5 缓滑
          //  ★SW-RB11b：门=原文双支 `(flag∧vy>0.5∧gd==1)∨(vy<-0.5∧gd==-1)`——
          //  gd=1 半边吃 flag、gd=-1 半边不吃（原文 quirk;旧 `vy*gd>0.5` 全 gd
          //  无 flag=悬浮墙可缓降+按向不符侧误挂）
          if (this.inputDown) this.vy = 4 * gdSlide;           // :21996 4f*gravDir
          else this.vy = 0.5 * gdSlide;                        // :21998 velocity.Y = 0.5f*gravDir
          this.spawnWallSlideDust(game, slideDirSign);         // :22002 尘 31 恒出
          this.fallStartY = null;           // :21992 fallStart 重置
          this.wallCling = true;            // :22015 sliding=true
          this.slideDir = slideDirSign;     // ★BJ704-G15：挂壁向与 wallCling 同拍配对写（反踢 :20950 消费）
        }
        // 起跳统一走 JumpMovement 外门（外门 sliding 支 + autoJump 抑制 :20805-20808）。
        // ★2026-08-31 台账清偿⑤：旧内嵌 inputJump 直写蹬墙跳退役——原版
        // WallslideMovement 自身不处理跳键，滑行起跳一律经 JumpMovement 外门
        // （releaseJump 边沿、无 vx 反踢项），单路权归一。
      }
      // 翅膀滑翔（:27015-27027）：wingTime 尽后按住跳 = 重力/3 + 终端 maxFallSpeed/3
      // （!hoverDown）——原版此段在 else-if 链替换常规重力，此处以等价条件并入；
      // rocketDelay>0 时链被推力独占（:27156 else-if 互斥）→ 滑翔不参与
      const gliding = !!eq.wing && this.wingTime <= 0 && this.inputJump && this.vy > 0 && !hoverDown
        && this.rocketDelay === 0;
      // 羽落 buff（slowFall,:27224-27235 else-if 臂 1:1）：!TryingToHoverDown 门
      // （下悬停驻留中缓降整臂跳过=常规重力）+ TryingToHoverUp /10 档（:27226）；
      // flag20=isPerformingJump_DownDash（:26995,本仓 downDash 未建模 ≡ false）。
      // ★SW-FX14：旧式无条件 /3 缺两门,锁存接线后按原文补齐
      let grav = (this.buffs.slowFall || this.equipStats.slowFall) && !this.tryingToHoverDown
        ? (this.tryingToHoverUp ? GRAVITY / 10 : GRAVITY / 3)
        : GRAVITY;
      if (gliding) {
        grav = GRAVITY / 3;
        // :27211-27215 终端钳带 !TryingToHoverDown 门（下悬停中不钳 → 满速下坠）
        if (this.vy > PLAYER_MAX_FALL_SPEED / 3 && !this.tryingToHoverDown) this.vy = PLAYER_MAX_FALL_SPEED / 3;
      }
      // 坐骑飞行族已独占 vy（上方 Hover/Flight 段）——重力段整体让位（原版 :26637
      // else-if 链互斥语义）；悬停免摔（Hover :3450 fallStart 每帧重置）
      if (mountFlight) {
        grav = 0;
        this.fallStartY = null;
      }
      // 翅膀扇动中（flag19）：原版重力走 :27156 火箭靴 if 的【else-if 链】
      // （!flag19 → 滑翔 → 飞毯 → 常规重力 :27033）——flag19 时整链跳过 = 飞行期
      // 不加重力（WingMovement 的 0.1/0.5 档独立驱动 vy）。曾无条件 +GRAVITY，
      // 扇动 −0.1 被重力 +0.3 盖成净 +0.2/tick → 爬升被掐死在跳跃高度附近
      // （2026-08-13"翅膀飞不高"报障根因）
      if (flying) {
        grav = 0;
        this.fallStartY = null;
      }
      // 火箭靴推力脉冲期整链让位（原版 :27156 `if (rocketDelay > 0) {推力} else if
      // (!flag19) {…重力}` else-if 互斥——2026-09-03 备案清偿①补漏：曾漏此互斥，
      // 推力 −0.1/−0.6 被重力 +0.4 盖成净上浮/下坠畸变）
      if (this.rocketDelay > 0) {
        grav = 0;
      }
      // ★BJ704-G16（G15 登记债①+④）：CCed 平重力覆写（vanilla :27005-27010
      //   `velocity.Y += gravity; if (vy > maxFallSpeed) vy = maxFallSpeed`——
      //   CCed 臂替换整条 else 链,重力=Update 头 num6 缩放后的 gravity 字段
      //   【平值】:无 slowFall /3|/10 档（④的窄面:slowFall+冻结同持 → 仓旧
      //   /3 重力+/3 终端钳 vs vanilla 全重力全终端）、无滑翔/飞毯/坐骑让位、
      //   无 rocketDelay 推力挂起。置位点在一切 grav 改写【后】=单笔覆写全清;
      //   下方 num6 块照乘（≙ 原版 :24884 头部缩放,同值）。终端=主积分
      //   Math.min(vy+grav, PLAYER_MAX_FALL_SPEED)（CCed 清 gravDir=1 :6110
      //   → gd=1 臂即 vanilla 字面正钳;慢Fall 终端钳另门 !cced 让位）。
      if (this.cced) grav = GRAVITY;
      // ★IIIII224（Player.cs:24861-24883 深度重力斜率，此前整段漏移植）：
      //  num5=(maxTilesX/4200)²；num6 = (y/16 − (60+10·num5)) / (worldSurface/6)——
      //  remix 分母改 worldSurface/1（斜率×6 缓,Don't Dig Up 世界地下低重力）；
      //  下钳 remix 0.1 / vanilla 0.25，上钳 1；gravity *= num6。普通世界只在
      //  太空带（y/16 < 60+10n5+ws/6）减重，remix 世界低重力带下探到近地表。
      {
        const n5 = (world.w / 4200) ** 2;
        let num6 = (this.y / 16 - (60 + 10 * n5)) / (world.groundLevel / 6);
        if (world.seedFlags?.remix) num6 = (this.y / 16 - (60 + 10 * n5)) / world.groundLevel;
        if (world.seedFlags?.remix) {
          if (num6 < 0.1) num6 = 0.1;
        } else if (num6 < 0.25) {
          num6 = 0.25;
        }
        if (num6 > 1) num6 = 1;
        // ★SW-FX20 NaN 防灌（2026-09-10）：原版 Main.maxTilesX / Main.worldSurface 在任何
        //  Player.Update 前必经 worldgen 初始化 → num6 结构性不可达 NaN。本仓半成品 world
        //  对象（如旧夹具 `{store}`：w/groundLevel=undefined）→ n5/num6=NaN,且 NaN 穿透
        //  上面两道钳（NaN<x / NaN>1 恒 false）→ grav*=NaN → :5539 vy=NaN 整链冻结
        //  （moveAndCollide 步数 NaN=悬空定身,FX20 定谳）。有限元数据的 ±Inf（如测试小世界
        //  groundLevel=0 → N/0=∓Inf）由原钳原样承接（−Inf→0.25/0.1、+Inf→1,旧行为逐位不变,
        //  sw-fx19-gravity 金标窗依赖此面）；唯 NaN 无钳可依 → 归各支下钳档（vanilla 0.25 /
        //  remix 0.1=地表上带低重力档）。y 本身 NaN 不在此钳（会掩盖位置腐化）——由
        //  防NaN断言测试负起（tests/sw-fx20-physics-nan.test.ts）。
        if (Number.isNaN(num6)) num6 = world.seedFlags?.remix ? 0.1 : 0.25;
        grav *= num6;
        // ★SW-FX40（h2·gd=1 行为补齐 + gd=-1 新增符号臂）：gravity 字段拍末值快照
        //  （:24884 `gravity *= num6`——慢Fall 签名因子在门灌入位补乘,见下）
        this.gField = GRAVITY * num6;
        this.gFieldUnsigned = GRAVITY * num6;   // ★BJ704-G13（债5）无符号并行快照（尾部慢Fall 改写前值）
      }
      // ★SW-BJ59：斜坡起飞重力停摆窗（Player.cs:27553-27560 else-if——cartRampTime>0
      //  时不加重力、窗口递减；:27022-27025 vy==0 清零 = 落地即收窗。滚轴鞋轨骑
      //  bits[2] 起飞帧置窗；矿车族窗口在 Minecart 实体独立承载）
      if (this.vy === 0) this.cartRampTime = 0;              // :27022-27025
      else if (!this.cced && grav !== 0 && this.cartRampTime > 0) {        // :27553-27560（干重力臂;★G16 !cced=CCed 平重力无此窗,原版臂在 else 内）
        this.cartRampTime--;
        grav = 0;
      }
      // 重力倒置（gravDir，R7）：方向取反（Player.cs:3207 vy×gravDir 全局语义近似）
      this.vy = gd === 1
        ? Math.min(this.vy + grav, PLAYER_MAX_FALL_SPEED)
        : Math.max(this.vy - grav, -PLAYER_MAX_FALL_SPEED);
      // ★SW-FX40（b·gd=1 行为补齐 + gd=-1 新增镜像臂）：终端钳总闸（:27563-27595
      //  `if (!mount.Active || mount.Type != 5)`——蜜蜂坐骑 5 整段豁免=原文逐位）。
      //  ① maxFallSpeed 钳 gd=1 半边已由上行 Math.min 承载（同值同序）;gd=-1 由
      //  Math.max 承载。② 慢Fall 终端钳（:27571-27578 正挂/:27586-27593 镜像）整缺
      //  ——羽落药水终速原版 = maxFall/3 ≈ 3.33（ TryingToHoverUp 时 maxFall/5 过门
      //  → maxFall/10=1.0 驻留,:27575-27578),旧缺钳 → 羽落终速 10 直坠。③ 本闸在
      //  干链尾（原版 :27563 属 !wet 大支,湿链钳制在液体段 lMaxFall 承载,不双钳）。
      //  ★BJ704-G16（G15 登记债④）：!cced 门——CCed 臂终端=平 maxFallSpeed 单钳
      //  （:27007-27009）,慢Fall /3|/10 终端钳不参与（slowFall+冻结 → vanilla
      //  全速 10 坠 vs 仓旧 3.33 缓坠）。
      if (!this.cced && !(this.ridingMount && this.mount.type === 5)) {
        if (gd === 1) {
          if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy > PLAYER_MAX_FALL_SPEED / 3 && !this.tryingToHoverDown) this.vy = PLAYER_MAX_FALL_SPEED / 3;
          if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy > PLAYER_MAX_FALL_SPEED / 5 && this.tryingToHoverUp) this.vy = PLAYER_MAX_FALL_SPEED / 10;
        } else {
          if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy < -PLAYER_MAX_FALL_SPEED / 3 && !this.tryingToHoverDown) this.vy = -PLAYER_MAX_FALL_SPEED / 3;
          if ((this.buffs.slowFall || this.equipStats.slowFall) && this.vy < -PLAYER_MAX_FALL_SPEED / 5 && this.tryingToHoverUp) this.vy = -PLAYER_MAX_FALL_SPEED / 10;
        }
      }
      // 老鼠坐骑爬墙速度钉（原版序：重力 :26200s 先行、WallClimb :26436 直写
      // velocity.Y 覆盖）——上 -2/下 4/松手 0.5 精确落碰撞
      if (this.ratClimbVy !== null) this.vy = this.ratClimbVy;
      if ((this.buffs.slowFall || this.equipStats.slowFall)) this.fallStartY = null;
      // 倒置时天花板即地板（TileCollision.hitHead → onGround 近似）
      if (gd === -1) this.onGround = this.hitHead;
      // ★SW-FX40（h2·gd=-1 新增符号臂,gd=1 慢Fall 亦然）：慢Fall 字段签名改写
      //  （:27228/:27232 `gravity = gravity/10f|/3f * gravDir`——分支被走时才写,
      //  滑翔/火箭/翼飞/坐骑飞行各支整链让位=不改写;湿链不进此段）。in-place
      //  镜像原文:基于刚写好的 0.4×num6 字段再乘——StepDown/StepUp 倒挂/
      //  WalkDownSlope 三门在本段之后消费 gField（原版 :28265/:28271/:23610 同序）。
      if ((this.buffs.slowFall || this.equipStats.slowFall) && !this.tryingToHoverDown && !gliding && !flying
        && this.rocketDelay === 0 && !mountFlight) {
        this.gField = (this.tryingToHoverUp ? this.gField / 10 : this.gField / 3) * this.gravDir;
      }
    }
    // ★BJ717-A F1（2026-10-25）：长跳平台段 sustain 钉已迁至分支内臂段尾（sustainPin
    //   闭包,湿/干各一调用位≙原版 JumpMovement :26945 序——钉→重力→积分;旧公共位
    //   在重力【后】=平台拍 -5.01 vs vanilla -4.61,全持跳 apex +10.6px。历史注与
    //   G23/G25 判语随闭包迁移,详见声明位注释）。grappling/tongued 冻结门
    //   （[g23-sustain-grapple-freeze]）随闭包保留;松键归零（[g19-jump-release-zero]）
    //   同。
    if (this.swimTime > 0) this.swimTime--;   // PlayerFrame :35307-35312

    // ---- ★回满/清零公共段（2026-09-03 备案清偿③；原版 :26947-26953 + :27060-27063 +
    //      :26976-26982 = JumpMovement 尾、Wallslide 前的公共路径，不分干湿）----
    //   ①清零：无翼/骑禁翼族 → wingTime=0（:26948 wingsLogic==0，:26833-26835 骑乘清）；
    //     无靴 → rocketTime=0（:26951）——旧版缺，空中卸翼留僵尸 wingTime 会错封飞毯门
    //   ②rocketTime 回满 :27060-27063 `(vy==0||sliding||(autoJump&&justJumped))`
    //     ——sliding ≙ wallCling（仓内承载位；湿态贴墙滑未实装=登记）、
    //     justJumped ≙ jumpStartedThisTick（起跳帧标记）
    //   ③wingTime 回满 :26976-26982 `(((vy==0||sliding)&&releaseJump)||(autoJump&&justJumped))`
    //     ——releaseJump ≙ !inputJump（:21199/:21204 controlJump 帧块尾 false/其余 true）。
    //     旧版分叉：干地 onGround 无条件回满（按住跳也回，宽于原版）+ 水行鞋面回满 +
    //     湿态无回满 → 水里踩底/悬空 vy==0（撞顶）不回满 = 2026-09-03"有翅膀困死水中"
    //     死锁根因之一。mount.ResetFlightTime(:26981) 由 upkeep(onGround||vy==0) 承担
    //     （触发位点差已登记）。
    //     ★原文 vy==0 在本仓时序下 ≙ onGround：原版重力链在回满【之后】跑
    //     （:27156 else-if 尾），站立帧到回满点 vy=碰撞清零值 0；本仓湿/干重力在
    //     分支内【先】跑 → 站立帧 vy=+grav≠0。onGround（上帧碰撞置位）恰承载同一
    //     "贴地/踩底"语义；悬停坐骑 vy==0 例经 ①清零归零（骑乘恒禁翼/无靴）不成差。
    const wingsLogicC = (eqM.wing && (!mnt2 || MOUNT_DATA[String(mnt2.type)]?.CanUseWings === true))
      ? eqM.wing.logic : 0;
    if (wingsLogicC === 0) this.wingTime = 0;
    // ★[g23-mounted-wingframe-reset] 销案（BJ705-G25 定谳,2026-10-22）:原版 :27596-99
    //   运动段尾 `if (!mount.CanUseWings) wingFrame = 0`——【零玩家可感知面,不落刀】:
    //   ①骑禁翼族坐骑期 wings=0（:26833-35 同拍清）=翼【不绘制】（Renderer wingSlot
    //   门同构）,清位与残留帧在骑乘期同不可见;②唯一差面=飞行中上骑→下骑后翼帧
    //   从残留值续走 vs 原版从 0 续走=扇动相位差,帧机数拍内推进,肉眼不可辨。
    //   47/49/50 光偏移表（:10954 wingFrame≠0 读数）同拍内自愈。防再登记:本件已
    //   按零感知销案锁死——再登记须先给出可感知物证（截图/数值差）,勿按「字段未清」
    //   结构直觉回炉。
    if (eqM.rocketBoots === 0) this.rocketTime = 0;
    const autoJumpC = this.ridingMount ? this.mount.autoJump : eqJ.autoJump;
    if (this.onGround || this.wallCling || (autoJumpC && jumpStartedThisTick)) {
      this.rocketTime = eqM.rocketBoots > 0 ? 7 : 0;
    }
    if (((this.onGround || this.wallCling) && !this.inputJump) || (autoJumpC && jumpStartedThisTick)) {
      this.wingTime = eqM.wing ? eqM.wing.time : 0;
    }
    // ★BJ216 翱翔徽章（:27063-27065）：无门恒回满 rocketTimeMax=7——原版置在标准
    //  回满(:27060)之后、火箭靴消耗(:27069)之前;无靴态也置 7（:26951 先清零再被本行
    //  回满=原版同序）,消费端全带 rocketBoots 门故惰性;副作用 = 徽章佩戴者飞毯
    //  空中门 rocketTime==0 被封（CarpetMovement :22025 读上一拍尾值,原版同相）
    if (eqM.empressBrooch) this.rocketTime = 7;
    }
    // 松键上升衰减（原版语义 1:1，:22435-22446）：原版无"跳高截断"——松键仅在
    // 下一个 tick 使 vy += 0.01（几乎不衰减，小跳靠 platform 段耗尽前的松键时间差
    // 实现不了，原版跳高基本固定）；曾自制 vy>2→vy=2 狠掐上升（手感大偏，
    // 2026-08-15 审计）。坐骑飞行族（悬停/飞行）vy 独占 tick 让位
    if (!this.inputJump && !mountFlight
      && (this.gravDir === 1 ? this.vy < 0 : this.vy > 0)) this.vy += 0.01 * this.gravDir;


    // ---- 黏滞 tile（Collision.StickyTiles + Player.cs:22650-22740 1:1）----
    // 蛛网(51)：泡在网里 X/Y 双重阻尼、禁跳、不计摔伤、挣扎随机会撕破网（掉蛛丝）；
    // 蜂蜜块(229)：只阻尼、不破坏、不禁跳（原版 type!=229 才清 jump）
    {
      const stickId = TILE_BY_KEY['v_51_cobweb'] ?? 0;
      const honeyId = TILE_BY_KEY['v_229_honey_block'] ?? 0;
      const tx0 = Math.floor(this.x / TILE) - 1, tx1 = Math.floor((this.x + this.w) / TILE) + 1;
      const ty0 = Math.floor(this.y / TILE) - 1, ty1 = Math.floor((this.y + this.h) / TILE) + 1;
      let inWeb = false, inHoney = false;
      let webTx = 0, webTy = 0;
      // 扫描顺序 1:1（Collision.StickyTiles cs:3399-3402）：外层 X 自左向右、
      // 内层 Y 自顶向下——撕网目标=最左重叠列的顶端那张（垂直蛛网串即从身体最上方
      // 开始撕，原版语义；此前行优先会错撕横向蛛网层的最上行）
      for (let tx = tx0; tx <= tx1 && !(inWeb || inHoney); tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          if (!st.inBounds(tx, ty)) continue;
          const t = st.type[st.idx(tx, ty)];
          // ★幽灵保域（2026-09-03）：active() 门补 flags bit0（原版 Collision.cs:3404
          //  `!Main.tile[i,j].active() → continue`）——幽灵蛛网/蜂蜜块不黏滞
          //  ★G1谓词批(2026-09-04)：原版全门= `null || !active() || inActive() →
          //  continue`（Collision.cs:3402-3405）——粘着须 nactive,位读漏致动半边
          //  （已致动蛛网/蜂蜜块会继续黏滞）→ 改 isActive()
          if (t === 0 || !st.isActive(tx, ty)) continue;
          const cell = { x: tx * TILE, y: ty * TILE };
          const pad = t === honeyId ? 1 : 0;
          if (this.x + this.w > cell.x - pad && this.x < cell.x + TILE + pad
            && this.y + this.h > cell.y && this.y < cell.y + TILE + 0.01) {
            if (t === stickId) { inWeb = true; webTx = tx; webTy = ty; break; }
            if (t === honeyId) { inHoney = true; break; }
          }
        }
      }
      if (inWeb || inHoney) {
        this.fallStartY = null; // fallStart 重置（黏滞中不积累摔伤）
        // X 阻尼（L22688-22699）：钳 ±1；|vx|>0.75 → ×0.85，否则 ×0.6
        this.vx = Math.max(-1, Math.min(1, this.vx));
        this.vx *= Math.abs(this.vx) > 0.75 ? 0.85 : 0.6;
        // Y 阻尼（L23175-23208 双支 1:1）：gravDir=1 → 下落钳 1（缓沉）、上升钳 -5、
        // 上升 ×0.96、下落 ×0.3；gravDir=-1 → 整体镜像（:23175-23190：钳 [-1,+5]、
        // vy>0 ×0.96、否则 ×0.3）——★SW-FX19 补倒挂支（旧恒 gravDir=1 半边）
        if (this.gravDir === -1) {
          if (this.vy < -1) this.vy = -1;
          if (this.vy > 5) this.vy = 5;
          this.vy *= this.vy > 0 ? 0.96 : 0.3;
        } else {
          if (this.vy > 1) this.vy = 1;
          if (this.vy < -5) this.vy = -5;
          this.vy *= this.vy < 0 ? 0.96 : 0.3;
        }
        // 丝尘（Collision.cs:3416）：纠缠中速度>0.7 时每 tick 1/30 出白色网屑
        if (inWeb && Math.abs(this.vx) + Math.abs(this.vy) > 0.7 && Math.random() < 1 / 30) {
          game.spawnParticles(webTx * TILE + 8, webTy * TILE + 8, '#C8C8CC', 1, 0.4, { life: 26, damp: 0.96, grav: 0 });
        }
        // 蜂蜜滴落尘（Player.cs:22747-22760，dust 153）：1/5 且垂直有速
        if (inHoney && (this.vy > 0.15 || this.vy < 0) && Math.random() < 1 / 5) {
          const side = this.cx > webTx * TILE + TILE / 2 ? -1 : 1;
          game.spawnParticles(this.cx + side * (this.w / 2 + 2), this.y + this.h * 0.6,
            '#E8A020', 1, 0.3, { life: 22, damp: 0.97, grav: 0.02 });
        }
        if (inWeb) {
          this.jumpHold = 0; // L22676：type != 229 → jump 清零（蛛网内禁跳）
          // 挣扎撕网（L22653-22670）：移动中 stickyBreak++，超 rand(20,100) →
          // WorldGen.KillTile(检测格)——原版直接破坏 StickyTiles 返回的那一格
          if (this.vx !== 0 || this.vy !== 0) {
            this.stickyBreak++;
            if (this.stickyBreak > 20 + Math.floor(Math.random() * 80)) {
              this.stickyBreak = 0;
              st.setTile(webTx, webTy, 0);
              // 破坏爆散（KillTile HitEffect 网屑四溅近似）
              game.spawnParticles(webTx * TILE + 8, webTy * TILE + 8, '#C8C8CC', 8, 1.4, { life: 30, grav: 0.05 });
              game.spawnDrop(webTx * TILE + 8, webTy * TILE, VANILLA_ITEM_KEY_BY_ID[150] ?? 'vi_150_cobweb', 1);
            }
          }
        }
      }
    }

    // 摔伤追踪：开始下落记录高度，落地结算
    const fallVy = this.vy * this.gravDir;
    if (!this.onGround && fallVy > 0 && this.fallStartY === null) {
      this.fallStartY = this.y;
    }
    if (fallVy < -0.1) this.fallStartY = null; // 重新上升则重置

    // ★附带① 出水截跳消费（Player.cs:28074）：wet 翻转帧对本 tick 跳跃段（含新起跳
    // 预算）落定后的剩余 jumpHold 截到 jumpHeight/5 整除——骑史莱姆湿态豁免
    if (this._wetExitJumpClip) {
      this._wetExitJumpClip = false;
      const cap5 = Math.trunc(this._curJumpTicksCap / 5);
      if (this.wetSlime === 0 && this.jumpHold > cap5) this.jumpHold = cap5;
    }

    // ---- 坐骑碰撞攻击双通道已按原文三段时序上提（★F2/Note①，HorizontalMovement 尾
    //      → JumpMovement 头，今在跳跃门 `justClearedWetSlime` 行上方）——此处原挂位
    //      与 dash 段（DashMovement 面 :26958）的先后关系随之上对齐。移动相尾仍保持
    //      位移积分【前】语境不变（TileCollision 在更晚的 moveAndCollide）。

    this.dropThrough = !!this.inputDown || this.ratClimbVy !== null;   // 爬墙期间平台穿透（:27777）
    // ★BJ609（2026-10-10）：fallThrough/fall2 拆分——原版 Player.cs:28296
    //   `fallThrough = controlDown`（逐拍态,无窗口计时器）与 :28298 flag30 源
    //   （GoingDownWithGrapple/pulley/mount.Cart/gravDir==-1 → flag30∧fallThrough 双置）
    //   两语义:按 S 平台 vy≤1 放行、vy>1 仍承接（Collision.cs:2391 后半=逐级阶梯下降）;
    //   ratClimb（SW 侧机制,无原版锚）与钩爪下拉=fall2 恒不承接,只走 dropThrough 单旗。
    //   gravDir=-1 原版强 fall2（:28298 首项）→ platFallThrough 不置=平台整体不承接。
    //   平台门消费面=TileCollision moveAxis 两支（边缘行+BJ-C9-SP 越行补扫）。
    this.platFallThrough = !!this.inputDown && this.gravDir !== -1;
    // SW-RB6b 2026-09-07：补 StepUp 的钩爪否决腿（原版 :28278 `(…)&& !controlDown &&
    // !IsRidingTracks && !flag28 && grappling[0] == -1` 才 StepUp——挂钩中不自动上
    // 台阶,牵引撞上半砖/台阶即被拦停）。旧恒 true = 挂钩沿地被拖时仍爬台阶。
    // grappling[0] 语义=有 latched 锚（每 tick 由 stepLatched 重登记）≙ 原版 >=0。
    // ★SW-BJ59：!IsRidingTracks 否决腿（:28278 `!IsRidingTracks`——滚轴鞋贴轨帧
    //  onTrack=true → IsRidingTracks（:4136-4152 CanGrindRails∧onTrack）→ 不自动上台阶，
    //  防贴轨滑行被台阶弹起脱轨。上拍 onTrack（本拍轨骑段在下方重算 = 同原文时序）
    // ★SW-FX40（h1）：补 controlDown / IsRidingTracks 矿车腿 / flag28 三腿（:28276
    //  `else if ((carpetFrame != -1 || velocity.Y >= gravity) && !controlDown &&
    //  !IsRidingTracks && !flag28 && grappling[0] == -1`）——flag28 = mount.Active ∧
    //  Type∈{7 UFO,8 钻头,12 猪鲨崽,44 海盗船,49 熔岩鲨}（:28258,飞行/钻探/冲撞坐骑
    //  不自动上台阶）;IsRidingTracks（:4136-4152）= mount.Cart ∨ (CanGrindRails∧
    //  onTrack)——旧缺 mount.Cart 腿（骑矿车非贴轨帧仍探台阶）。
    const flag28Fx = this.ridingMount && (this.mount.type === 7 || this.mount.type === 8
      || this.mount.type === 12 || this.mount.type === 44 || this.mount.type === 49);
    const flag29Fx = this.ridingMount && this.mount.type === 48;   // :28259 黑魔书（StepDown 专属否决）
    this.stepUp = !this.grappling[0] && !this.onTrack && !this.ridingCart
      && !this.inputDown && !flag28Fx; // 原版玩家走 Collision.StepUp（:28278 门;:23258/:27753）
    this.stepUpHolds = this.inputUp;   // holdsMatching=controlUp：按住↑行走可踏上站台面（桌子/平台/铁砧…）
    // ★SW-RB14d：:28276 速度门两条腿经 Body 通道承载（消费面 TileCollision moveAndCollide
    //  正挂 StepUp 臂）——①毯展开腿 carpetFrame!=-1;②`velocity.Y >= gravity` 阈=gravity
    //  字段（gField,深度缩水带 0.4×num6——旧消费者恒 `vy >= 0`,水行/悬停/跳顶点 [0,g)
    //  窗误探、飞毯缓降 vy<0 误拦）。本拍 gField 已由重力链写好（:5898 段在前）。
    // ★BJ704-G12（G5 登记债7）：毯展开腿承载 carpetTime>0∧inputJump → carpetFlying
    //   （G5 R4-P2② 单一真源,≙ carpetFrame>=0「本拍在展开」——毯块外门（挂钩/火箭靴/
    //   翼时量/jumpHold/多段跳/vy==0/骑乘任一不满足=未展开）与余油末拍（carpetTime
    //   已减到 0 但本拍在带内）两面精确;旧近似在挂钩+余油+持跳边例偏宽——vanilla
    //   CarpetMovement :22062-22065 `if (!flag) carpetFrame = -1` 同拍先清后置）。
    this.stepUpCarpet = this.carpetFlying;
    this.stepUpVeloFloor = this.gField;
    // ★SW-BJ59：StepDown !IsRidingTracks 否决腿（:28265/:28276 两处 StepDown 调用门的
    //  `!IsRidingTracks`——IsRidingTracks（:4136-4152）= mount.Cart ∨ (CanGrindRails∧onTrack)，
    //  非矿车面 = 滚轴鞋贴轨帧；上拍 onTrack（本拍轨骑段在下方重算 = 同原文时序）。
    //  贴轨滑行禁自动走下台阶，防轨面被台阶步降拽离轨线（轨面跟随由 TrackCollision 接管）
    //  ★SW-FX40（h1）：补矿车腿 + flag28/flag29 腿（:28265 `velocity.Y == gravity &&
    //  !IsRidingTracks && !flag29 && !flag28`）。
    this.stepDownGate = (this.onTrack || this.ridingCart || flag28Fx || flag29Fx) ? 'never' : 'gravity';
    // ★BJ703-C D1：WalkDownSlope 预备阶段与 stepDownGate 解耦——载具态显式 opt-out
    //   （保守档=既存行为;原版仅 mount48/shimmering 豁免,矿车/贴轨照跑——登记债 D8）。
    //   ★BJ704-G5：补 shimmering 腿（原版 :28255 `if (!shimmering)` 整跳 SlopeDown-
    //   Movement/StepDown/StepUp 块——微光化穿落态豁免员在新通道的归宿,R4 判例
    //   「解耦刀每个真豁免员必须在新通道有归宿」;mount48=flag29Fx 既有 ✓）。
    this.walkDownSlopeOff = this.onTrack || this.ridingCart || flag28Fx || flag29Fx || this.shimmering;
    // ★BJ227：StepDown 第 8 参 waterWalk（:23717/:28267 两处调用均传 `waterWalk ||
    // waterWalk2`——含 buff15 药水;canWaterWalk 已含 gravDir==-1 清旗门 :27866-27869）。
    // 消费面 = applyStepDown 液面落面臂（TileCollision.ts,Collision.cs:3603-3610）。
    this.stepDownWaterWalk = canWaterWalk;
    // ★SW-FX34：倒挂 StepUp 每 tick 门（:28273-28275 `if (gravDir == -1f) {
    //  if ((carpetFrame != -1 || velocity.Y <= gravity) && !controlUp) StepUp(…,(int)gravDir,controlUp) }`）。
    //  carpetFrame!=-1 ≙ 飞毯本 tick 在展开——★BJ704-G12（G5 债7）：承载改
    //  carpetFlying 单一真源（同 stepUpCarpet 面,旧 carpetTime>0∧inputJump 近似偏宽）;
    //  ★SW-FX40（h2）：门值 GRAVITY → gField（gravity 字段拍末值,深度缩水带同步缩水）。
    //  moveAndCollide 只在 gravDir=-1 时消费。
    this.stepUpInvGate = this.gravDir === -1
      && (this.carpetFlying || this.vy <= this.gField)
      && !this.inputUp;
    // 跑动/下落撞碎裂砖（Player.Update :27733 CheckIceBreak 后紧随——在 StepDown/StepUp
    // （:27745-27760）与 TileCollision（:27783+）【之前】调用：读碰撞前的完整速度与
    // 上 tick 已落定位置。曾挂在 fixedUpdate 尾部（碰撞后）——空中横移（跳跃顶点
    // vy<1）以 vx 撞脚行裂砖的场景碰撞已清零 vx，速度门必失败，2026-08-17 归位）
    this.checkCrackedBrickBreak(game);
    // 钩爪牵引（GrappleMovement 1:1，Player.cs:22338-22483）——moveAndCollide 前覆写速度
    this.grappleMovement(game);
    // SW-RB6b 2026-09-07：钩爪下拉穿平台（原版 :28298 `… | GoingDownWithGrapple | pulley`
    // → fallThrough=true——锚在下方向下牵引时平台不承接，玩家被拖穿站台落地）。
    // dropThrough 旧仅 inputDown/ratClimb 两源，GoingDownWithGrapple 消费面整缺。
    // 位序=grappleMovement 置位【后】、moveAndCollide 消费【前】（同原版 :27863→:28298 同拍序）
    if (this.goingDownWithGrapple) this.dropThrough = true;
    // ---- gfxOffY 衰减（Player.cs:27695-27719，TileCollision 前位）。FindPulley
    //      落位同 tick 即衰减一次（原版 FindPulley :25805 早于本段）----
    this.decayGfxOffY();
    // 落地冲击速度留存（原版 TryLandingOnDetonator Player.cs:34368 的 velocity.Y>=3 门；
    // 碰撞前捕获——碰撞会清零 vy。Game 侧消费：落在起爆器 411 上触发电路）
    const impactVy = this.vy;
    const preY = this.y;
    // ---- 水中位移减速（Player.cs:27858-27888 湿态碰撞选档 + WetCollision :23157-23172：
    //      velocity 原值进碰撞、位移 ×factor——水中 vx 照常加速到 3，只是每 tick 只走
    //      一半路程。经 moveAndCollide 的 liqFactor 入口（NPC MoveWhileWet 同机制）。
    //      选档：shimmerWet→0.375(num113 :28381) > honeyWet&&!ignoreWater→0.25 >
    //      wet&&!merman&&!ignoreWater&&!trident→0.5（岩浆同 0.5，num111/num112
    //      :28378-79；R1 勘误 2026-09-03,旧注"num111/num109-110"系 1456 期锚）>
    //      其余 DryCollision=1。ignoreWater = 游泳族坐骑(:9972-9999) ∪ 脚蹼药 109
    //      (:10257-59) ∪ 星旋强化翼 wingSlot26(:15570-72)；trident=手持三叉戟 277
    //      (:12992)。shimmering 穿墙分支不走 moveAndCollide，不消费此值。----
    {
      const ignoreWater = this.ridingMountSwimFree
        || this.buffs.has(BuffType.FlipperPotion)
        || eqM.wing?.slot === 26
        || this.modIgnoreWater === true;   // ★四百七十二刀:mod 配饰面(DeepDiver)
      const heldIt2 = this.inv.heldItem();
      const heldVid2 = heldIt2 ? (ITEM_DEFS[heldIt2.id]?.vid ?? (ITEM_DEFS[heldIt2.id].vid ?? -1)) : -1;
      this.liqFactor = this.inShimmer ? 0.375
        : this.inHoney && !ignoreWater ? 0.25
        : (this.inWater || this.inLava) && !this.merman && !ignoreWater && heldVid2 !== 277 ? 0.5
        : 1;
    }
    // ---- ★SW-BJ59 滚轴鞋轨骑（Player.cs:28306-28377 AnyTrackRider 支 1:1）----
    // 57-60 经 SetAsRollerSkate（Mount.cs:2578）CanRideMinecartTracks=true →
    // Mount.AnyTrackRider（Mount.cs:558-573 = Minecart ∪ CanRideMinecartTracks）。
    // 矿车族本仓走 Minecart 实体（ridingCart），此块只接非矿车轨骑（=滚轴鞋四件；
    // MountID 全表 CanRideMinecartTracks 别无他家——extract-mounts 全表核对）。
    // 时序 = 原文：TrackCollision 先于 Wet/DryCollision 选档（同 tick 同位）、
    // 后于 gfxOffY 衰减段（:27695-27719 → 本仓 decayGfxOffY 在上方）。
    const mntRail = this.ridingMount && !this.ridingCart ? this.mount : null;
    const grind = !!mntRail && MOUNT_DATA[String(mntRail.type)]?.CanRideMinecartTracks === true;
    const flag31 = this.onTrack;                 // :28303（离轨音门——委托空实现不发声）
    this.onTrack = false;                        // :28304
    if (grind && mntRail) {
      // 液体速度缩放 num110（:28310-28311：merman 1 / shimmer·honey 0.25 / wet 0.5）
      const liq = this.merman ? 1 : this.inShimmer ? 0.25
        : this.inHoney ? 0.25 : !this.inWater ? 1 : 0.5;
      const rider = {
        x: this.x, y: this.y,
        vx: this.vx * liq, vy: this.vy * liq,
        lastBoostX: this.skateLastBoostX, lastBoostY: this.skateLastBoostY,
      };
      // fallStart2（:28315）——本仓 fallStartY 像素口径同源换算格行
      const fs2 = this.fallStartY !== null ? Math.trunc(this.fallStartY / TILE) : Math.trunc(this.y / TILE);
      const bits = trackCollision(world.store, rider, this.w, this.h,
        !!this.inputDown, !!this.inputUp, fs2, false, {
          // 落轨（TrackCollision :815-817 fallStart 门）→ 缺省委托
          // DelegateMethods.Minecart.LandingSound（Item_53）+ WheelSparks×10
          //（Sparks dust 213，MountDelegatesData ctor 缺省 :125-130——滚轴鞋
          // delegations 未覆写 = 全缺省臂）
          landing: (lx, ly) => {
            game.playSfxFile?.('Item_53', 1, this.x + this.w / 2, this.y + this.h / 2);
            const mp = magnetPosition(lx, ly, this.w, this.h);
            for (let k = 0; k < 10; k++) this.skateSparkDust(game, mp.x, mp.y);
          },
        });
      this.skateLastBoostX = rider.lastBoostX;
      this.skateLastBoostY = rider.lastBoostY;
      const bOn = (bits & (1 << FLAG_ON_TRACK)) !== 0;
      const bRamp = (bits & (1 << FLAG_USED_RAMP)) !== 0;
      const bBoostL = (bits & (1 << FLAG_BOOST_LEFT)) !== 0;
      const bBoostR = (bits & (1 << FLAG_BOOST_RIGHT)) !== 0;
      if (!bOn && !bRamp && !bBoostL && !bBoostR) {
        // 非矿车回退规则（:28319-28322）：无贴轨/斜坡/加速 → 位置/速度整还原
        //（=轨道系统不位移玩家，正常物理照走；vector5/vector6 = 进轨前快照）
      } else {
        this.x = rider.x; this.y = rider.y;
        this.vx = rider.vx / liq;
        this.vy = rider.vy / liq;
      }
      if (bOn) {
        this.onTrack = true;                     // :28324
        // 贴轨帧摔伤豁免（:25508 num11=0 语义 = fallStart 重置，本仓 fallStartY=null）
        this.fallStartY = null;
        // TrackRotation（:28325-28327）：倾角写玩家 fullRotation（本仓态存
        // mount.fullRotation——57-60 无 Hover 倾斜占用，渲染层同轴消费）、
        // gfxOffY = 贴轨纵向补偿（写玩家字段，decayGfxOffY 次拍照常衰减）
        const rot = { v: mntRail.fullRotation };
        this.gfxOffY = trackRotation(world.store, this.x + this.vx, this.y + this.vy,
          this.w, this.h, !!this.inputDown, !!this.inputUp, rot);
        mntRail.fullRotation = rot.v;
      }
      if ((bits & (1 << FLAG_BOUNCY_BUMPER)) !== 0) {        // 弹性挡板 :28340-28358
        if (this.inputLeft || this.inputRight) {
          this.cartFlip = !this.cartFlip;
        }
        if (this.vx > 0) this.facing = 1;
        else if (this.vx < 0) this.facing = -1;
        game.playSfxFile?.('Item_56', 0.8, this.x, this.y);  // MinecartBumperSound→Item_56
      }
      if ((bits & (1 << FLAG_HIT_SWITCH)) !== 0) {           // 压板 :28359-28363
        // HitTrackSwitch 磁铁位（Minecart.ts 同式：magnet = 中心 + (0,26)）
        game.hitTrackSwitch?.(Math.trunc((this.x + this.w / 2) / 16), Math.trunc((this.y + this.h / 2 + 26) / 16));
      }
      if (bRamp) {                                           // 斜坡起飞 :28364-28367
        this.cartRampTime = Math.trunc(Math.min(1, Math.abs(this.vx) / Math.max(0.01, mntRail.runSpeed())) * 20);
      }
      if (bBoostL) this.skateTrackBoost -= 4;                // 加速轨 :28368-28375
      if (bBoostR) this.skateTrackBoost += 4;                //（Minecart.BoosterSpeed=4）
      void flag31;   // 离轨音 MinecartJumpingSound（DelegateMethods.cs:246-248 空实现）
    }
    if (this.buffs.has(BuffType.TheTongue)) {
      // 舌头拖拽穿墙（Player.cs:28384-28388 `if (tongued) position += velocity`）——
      // **完全绕过 tile collision**（moveAndCollide/SlopingCollision/传送带
      // :28435-28440 同跳），肉山反绕后拽回无视地形，否则绕后玩家会被隧道/
      // 熔岩窑卡死拽不回（2026-09-02 用户实测卡地形）。onGround/hitWall 不更新
      // （原版同语义）；flag33 置假=跑动成就里程不计（:28386,本仓无此消费面）。
      // 拖拽速度 = wofTongue ④ 上帧覆写值（次帧消费,原版同 tick 一拍差备案）
      this.x += this.vx;
      this.y += this.vy;
      this.landImpactVy = 0;
    } else if (this.shimmering) {
      // 穿墙下坠（Player.cs:27868-27870）：position += velocity × 0.375（num111）——
      // **完全绕过 tile collision**（moveAndCollide/DryCollision 不跑），穿湖底与
      // 岩层直落；onGround/hitWall 不更新（原版同语义——穿墙中不落地不贴墙）
      this.x += this.vx * 0.375;
      this.y += this.vy * 0.375;
      this.landImpactVy = 0;
    } else {
      // ★SW-BJ59：贴轨碰撞盒收缩（Player.cs:23782-23795 TileCollision——onTrack 时
      // 盒高 −10，防贴轨滑行被轨下地面/坡面刮停；DryCollision 经 Player.TileCollision
      // 帮助函数消费同一收缩值。上拍 onTrack（轨骑段在上方 = 同原文时序），后写还原）
      const hKeep = this.h;
      if (this.onTrack) this.h = Math.max(16, this.h - 10);
      // ★SW-FX40（d）：falling 旗（:28283-28290 `falling = vy > gravity || vy < -gravity`
      //  ——gravity=字段拍末值（gField）；FloorVisuals 的落地尘 20 连发参数）。
      //  原版在 StepUp/Down 门后、碰撞位移【前】求值——同位捕获。
      const fallingFx = this.vy > (this.gField ?? GRAVITY) || this.vy < -(this.gField ?? GRAVITY);
      moveAndCollide(this, world, this.vx, this.vy);
      this.h = hKeep;
      // ---- ★BJ701 史莱姆/弹跳杆坐骑第二竖向碰撞趟（1457 Player.cs:28409-28422，
      //   位于干/湿选档 if/else 的干态臂内=仅 DryCollision 路由跑）：骑史莱姆族
      //   （IsConsideredASlimeMount=type 3 SlimySaddle ∪ 50 QueenSlime，Mount.cs:522，
      //   本仓 MountCombat.isConsideredASlimeMount）或弹跳杆 43 且 vy≠0 → vx 临时
      //   清零重跑一趟碰撞后还原——竖向位移每拍【双份】=垂直速度 ×2（上升=hyper
      //   jump/下降=快坠；wiki Slimy Saddle："Players move at double the normal
      //   vertical speed"，即用户实报「更快垂直下落」）。旧登记债（BJ534 块注
      //   「本仓未建模」）本刀清偿。史莱姆族闸 = SlimeDontHyperJump（:4108-4118
      //   净语义 wetSlime>0 ∧ !controlJump——液面浮态不按跳不双跳；按住跳即复权
      //   =出水跳 :20814 族联动）；弹跳杆 43 无此闸（:28416 字面）。干态门=本拍
      //   liqFactor===1（湿态选档 WetCollision :28394-28404 时本趟不跑——与下砸趟
      //   :28424「选档外两态照跑」的结构差,见下方 BJ534 块注）。落地拍主趟已清
      //   vy ⇒ vy!==0 门自然跳过,落地语义零扰动；dx=0 ⇒ stepUp 临时关断/
      //   liqFactor 归一/hitWall 并集还原 = BJ534 同款承载。----
      const mntHyper = this.ridingMount ? this.mount : null;
      if (mntHyper && this.liqFactor === 1 && this.vy !== 0
          && (mntHyper.type === 43
              || (isConsideredASlimeMount(mntHyper.type)
                  && (this.wetSlime === 0 || this.inputJump)))) {
        const suKeep = this.stepUp, lfKeep = this.liqFactor, hwKeep = this.hitWall;
        this.stepUp = false;
        this.liqFactor = 1;
        moveAndCollide(this, world, 0, this.vy);
        this.stepUp = suKeep;
        this.liqFactor = lfKeep;
        this.hitWall = hwKeep || this.hitWall;
      }
      // ---- ★BJ534 下砸第二竖向碰撞趟（:28424-28430）：isPerformingJump_DownDash &&
      //   velocity.Y!=0 → velocity.X=0 重跑 DryCollision 后还原——下砸期每拍双份竖向
      //   位移 = 快坠承载体（史莱姆坐骑 hyper-jump 同构 :28409-28414,★BJ701 已在
      //   上方块建模——湿态照跑仍为本趟独有语义）。
      //   原版该趟在湿/干选档 if/else【外】= 湿态照跑且为 DryCollision 全速（不缩液体
      //   位移）→ 本仓第二趟 liqFactor 临时归一；dx=0 ⇒ StepUp/坡速辅助无横向意图,
      //   stepUp 临时关断防探柱误抬升;dx=0 趟不可能新增撞墙 → hitWall 保守并集还原
      //   （原版 hitWall 判据读还原后 velocity.X,同净效）。落地拍主趟已清 vy ⇒ 本趟
      //   自然跳过（:28424 vy!=0 门）——落地语义零扰动。----
      if (this.isDownDashing && this.vy !== 0) {
        const suKeep = this.stepUp, lfKeep = this.liqFactor, hwKeep = this.hitWall;
        this.stepUp = false;
        this.liqFactor = 1;
        moveAndCollide(this, world, 0, this.vy);
        this.stepUp = suKeep;
        this.liqFactor = lfKeep;
        this.hitWall = hwKeep || this.hitWall;
      }
      // ---- ★BJ227 液面钉位（vanilla DryCollision :23736-23740 有限元支/:23771-23777 单步支
      //      → Collision.WaterCollision :2793-2820,waterSurfacePinCrossed 1:1 移植）----
      //  干态运动路径专属：下坠跨越液面 → 位置回钉面顶（盒底=面顶）+ velocity.Y 替换为
      //  面跨越位移（原版 `velocity = WaterCollision(position, velocity, …)` :23774——稳定
      //  站立拍=0 → 起跳门 vy==0 自然通过;落面拍=剩余位移,次拍归零,原版同两拍收敛）;
      //  fallStart 重置（:23775-23778 `if (vector6 != velocity) fallStart = position.Y/16`）。
      //  ★先定谳（本刀锚定）：钉位在原版只挂 DryCollision——湿态 WetCollision（:23622）
      //  无钉位;按 ↓（fallThrough=controlDown :28296,本仓 dropThrough 通道）主动下潜让位;
      //  湿路由（:28395-28404 shimmerWet ∨ honeyWet∧!ignoreWater ∨ wet∧!merman∧!ignoreWater
      //  ∧!trident → WetCollision）让位——本仓湿支三豁免（merman/ignoreWater/三叉戟 277）
      //  原版走干路由照钉。lavaWalk=纯 waterWalk（waterWalk2 水上漂靴 863/黑曜石 907 岩浆
      //  面不钉,照常下沉）;buff15 药水原版置 waterWalk → 含岩浆面。原版序 = TileCollision
      //  → WaterCollision → position+=,本仓 moveAndCollide 内已积分 → 等价位次 = 积分后
      //  位置修正（新旧盒跨面判定,UpdateTouchingTiles/TryBouncingBlocks 前同原文）。
      {
        const ignoreWaterPin = this.ridingMountSwimFree
          || this.buffs.has(BuffType.FlipperPotion)
          || eqM.wing?.slot === 26;
        const heldItPin = this.inv.heldItem();
        const heldVidPin = heldItPin ? (ITEM_DEFS[heldItPin.id]?.vid ?? (ITEM_DEFS[heldItPin.id].vid ?? -1)) : -1;
        const wetRoutePin = (this.wetSticky || this.inHoney || this.splashShimmerWet)
          && !this.merman && !ignoreWaterPin && heldVidPin !== 277;
        if (canWaterWalk && !wetRoutePin && !this.dropThrough && !this.ridingCart && this.vy > 0) {
          const surf = waterSurfacePinCrossed(world.store, this.x, preY, this.w, this.h,
            this.x, this.y, eqM.waterWalkLava || this.buffs.canWaterWalk);
          if (surf !== null) {
            this.y = surf - this.h;
            this.vy = surf - (preY + this.h);
            this.fallStartY = null;
            this.onWaterSurface = true;
          }
        }
      }
      // ★SW-FX40（g）：UpdateTouchingTiles（:28432——SlopingCollision/传送带后、
      //  顶头臂前，原版同序；GetHurtTile 兜底面/弹跳块 TryBouncingBlocks 消费）
      this.updateTouchingTiles(world);
      // ★SW-FX47（b）：TryBouncingBlocks（:28433——UpdateTouchingTiles 后、
      //  TryLandingOnDetonator(≙landImpactVy)/SlopingCollision/顶头臂前,原版同序）。
      //  弹跳块族（tileBouncy 371/446-448）落地反弹整支,见方法注。
      //  preY/impactVy（:6178-6179 碰撞前快照）=落地拍残量重建通道（方法注②）。
      //  备案：landImpactVy（:6344）读碰撞前 impactVy,原版 TryLandingOnDetonator
      //  （:34368 vy≥3 门）读【反弹后】vy——弹跳拍原版门假（|vy|×0.8 后可 <3）,
      //  本仓真=引爆器面上弹跳拍会误触发（引爆器+弹跳块邻接极端几何,登记）。
      this.tryBouncingBlocks(game, world, fallingFx, preY, impactVy);
      // ★SW-FX40（c·gd=1 行为补齐）：正挂顶头臂（:28463-28470 `if (gravDir == 1f &&
      //  Collision.up) { velocity.Y = 0.01f; if (!merman) jump = 0; }`）——上撞天花板
      //  同拍 vy=+0.01 + 取消跳 hold（FX34 注的"gd=1 禁碰债"就此清偿;Collision.up ≙
      //  hitHead=moveAxis dir<0 阻挡位）。FX34 G3 的 Body 级 vy=0 钉面=碰撞层语义,
      //  本臂在其后写 +0.01,两层不冲突（G3 注已重锚）。merman 豁免 jump=0 照原文。
      // ★SW-FX34：倒挂顶头臂（:28471-28478 else if 臂,波 4 已接）——结构按原文
      //  if/else-if 归位（gravDir 互斥,数值面不变）。Collision.down ≙ hitDown
      //  （moveAxis dir>0 阻挡位,坡面贴合置位的 onGround 不算）。
      if (this.gravDir === 1 && this.hitHead) {
        this.vy = 0.01;
        // ★SW-RB14a 复核定谳（F1 撤销）：merman 门【保留】=原版净语义 1:1——
        //  原版 DryCollision 两处无门站（:23731/:23767 `Collision.up && gravDir==1
        //  → jump=0`）是【干路径专属】（WetCollision :23157-23172 无此站）,而
        //  merman ⊆ wet（:22965 变身态只在水中置位;本仓 :3895 同域推导）——
        //  干态 merman 恒 false ⇒ 门对干态不可达=无门站净语义自动成立;湿态人鱼
        //  原版本就不经 DryCollision ⇒ 不清。单门双臂=干/湿/正挂/倒挂四面全等。
        if (!this.merman) this.jumpHold = 0;
      } else if (this.gravDir === -1 && this.hitDown) {
        this.vy = -0.01;
        if (!this.merman) this.jumpHold = 0;
      }
      // ★SW-FX40（d）：FloorVisuals 调用位（:28479-28482 `vy==0 && grappling[0]==-1`）
      //  ——地板旗块（上文 ~:4220 处,消费面同原版 HorizontalMovement 读上拍旗）
      //  + MakeFloorDust 整支（内部 !wet && !mount.Cart 闸 :23931）
      if (this.vy === 0 && !this.grappling[0]) {
        const wetVanillaFx = this.inWater || this.inLava || this.inHoney || this.inShimmer;
        const cartFx = this.ridingMount && this.mount.isCart;
        if (!wetVanillaFx && !cartFx) this.makeFloorDust(game, fallingFx, world);
      }
      this.landImpactVy = this.onGround && impactVy >= 3 ? impactVy : 0;
    }
    // ---- 浮液物理（TryFloatingInFluid Player.cs:23639-23679，运动位积分后调用）：
    //      ShouldFloatInWater（:3856-3870 canFloatInWater=4404∪buff265、未按下、坐骑仅 37）
    //      且非（微光浸身而幻彩斗篷豁免缺失）→ GetWaterLine 定液面（npcLiquid 1:1）：
    //      深处（ty-2 有液）恒上浮 −0.4 钳 −6；液面下沿 −0.4 上爬；到线钉线（钳 −3、
    //      vy==0 置 float.Epsilon 防"落地"语义吞）。坐椅先起（SitUp :23646-49 经钩）----
    // ★SW-FX46（2026-09-12）补湿域门：TryFloatingInFluid 的原版调用点 = WetCollision
    //  体内尾段（Player.cs:23622 方法头 / :23640 调用），即只在 UpdateMovement 湿/干
    //  选档（:28396-28428 shimmerWet > honeyWet&&!ignoreWater > wet&&!merman&&
    //  !ignoreWater&&!trident 三支走 WetCollision；shimmering/tongued 积分分支、
    //  其余走 DryCollision）的拍才执行。出水（身体离液）后浮液停、干重力全额拉回
    //  → 落回水面由钉线支钳定稳态 cy*=waterLine−num2（vy≈0）。
    //  旧仓缺此门：else 支（GetWaterLine false）的 vy−=0.4 在空中照跑，与天空缩水
    //  重力（:24876 num6 钳下限 0.25 → 0.4×0.25=0.1）净 −0.3/拍 无界加速——深水上
    //  浮攒速冲出水面后直飞世界顶（vy=−30.78，shimmer-immune-float 钉线用例红）。
    //  选档三式与下方 liqFactor 块（SW 同源，原版 :28396-28408 同形）逐字同构；
    //  shimmering/tongued（:28390-28394 积分顶层分支）与原版同走旁路不吃浮液。----
    const heldFloat = this.inv.heldItem();
    const tridentHeld = heldFloat
      ? (ITEM_DEFS[heldFloat.id]?.vid ?? (ITEM_DEFS[heldFloat.id].vid ?? -1)) === 277 : false;
    const ignoreWaterF = this.ridingMountSwimFree
      || this.buffs.has(BuffType.FlipperPotion)
      || eqM.wing?.slot === 26;
    const floatWetDomain = this.inShimmer
      || (this.inHoney && !ignoreWaterF)
      || ((this.inWater || this.inLava || this.inHoney || this.inShimmer)
        && !this.merman && !ignoreWaterF && !tridentHeld);
    if (!this.shimmering && !this.buffs.has(BuffType.TheTongue) && this.shouldFloatInWater
      && !(this.inShimmer && !eqM.shimmerImmune) && floatWetDomain) {
      if (this.sitting) this.sitUpHook?.();
      const wl = getWaterLine(world.store, Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
      if (!wl.found) {
        this.vy -= 0.4;                                     // 深水中（GetWaterLine false）恒上浮（原文 else 支无钳）
      } else {
        let num = this.cy;
        if (this.ridingMount && this.mount.type === 37) num -= 6;   // :23651-52
        const num2 = num + 8;
        if (num2 + this.vy >= wl.line) {                    // 液面下太深 → 本拍不动
          if (num > wl.line) {
            this.vy -= 0.4;
            if (this.vy < -6) this.vy = -6;
          } else {
            this.vy = wl.line - num2;
            if (this.vy < -3) this.vy = -3;
            if (this.vy === 0) this.vy = 1.4e-45;           // float.Epsilon（XNA 最小正规数）
          }
        }
      }
    }
    // ---- 湿态阻尼（Player.cs:28060-28068，在 `if (!wet)` :27982 过渡拍体内=仅
    //      入水首拍）：wet 且浮起源在身 → 下落对折钳 3。逐拍执行会抵消浮力
    //      （递推不动点 −0.2=缓沉），过渡拍语义经 wetEntryNow 精确对齐 ----
    if (wetEntryNow && this.shouldFloatInWater) {
      this.vy = Math.fround(this.vy / 2);
      if (this.vy > 3) this.vy = 3;
    }
    this.bordersMovement(world, game);
    // StepUp 抬升检测（原版 gfxOffY）：水平移动中被抬升 ≤16px → 渲染缓动补偿
    const lifted = preY - this.y;
    if (this.inputX !== 0 && lifted > 0.5 && lifted <= 16.1) this.stepRenderY = lifted;

    // 边缘滑落：已移除（改为收窄支撑判定宽度——本质相同但无侧推力）
    if (false) {
      const fy = Math.floor((this.y + this.h + 1) / TILE);
      const fx0 = Math.floor(this.x / TILE), fx1 = Math.floor((this.x + this.w - 0.01) / TILE);
      let support = 0;
      let supportX = 0; // 支撑面积加权重心
      for (let tx = fx0; tx <= fx1; tx++) {
        if (!world.store.isSolid(tx, fy)) continue;
        const left = Math.max(this.x, tx * TILE);
        const right = Math.min(this.x + this.w, tx * TILE + TILE);
        const ov = Math.max(0, right - left);
        support += ov;
        supportX += (left + right) / 2 * ov;
      }
      // 主动移动（上行爬坡/走动）时只在彻底失撑（≤2px）才坠落，不参与缓滑——
      // 爬台阶时身体经常大半悬空，缓滑会把人往回推；静止站边缘才触发缓滑
      const moving = this.inputX !== 0 && Math.abs(this.vx) > 0.3;
      // 固定 3px 阈值：几乎完全悬空才滑落（比例阈值对放大后的宽碰撞盒过敏）
      void moving;
      if (support > 0 && support < 3) {
        const cen = supportX / support;
        const dir = cen < this.cx ? 1 : -1; // 支撑在身体哪侧，就往反侧滑
        if (support <= 2) {
          this.x += dir * 1.2;
          this.onGround = false; // 彻底失撑，下坠
        } else {
          this.x += dir * 0.9; // 缓慢滑向悬空侧
        }
      }
    }

    // 自动上台阶：统一走原版 Collision.StepUp（moveAndCollide 内 stepUp 门，
    // Physics/TileCollision.ts applyStepUp 1:1）——此前自研版只处理玩家，
    // 敌人/小动物卡死半砖；原版玩家与 NPC 共用同一 StepUp。视觉缓动保留：
    // 每帧检测被抬升时记录补偿高度
    if (this.onGround && this.hitWall && this.inputX !== 0) {
      // 碰撞被拦但 StepUp 已抬升过（y 比上一帧高出一格内）→ 渲染缓动
      void 0;
    }
    // 台阶视觉缓动：每帧向 0 收敛
    if (this.stepRenderY > 0.5) this.stepRenderY *= 0.55;
    else this.stepRenderY = 0;
    // ---- 职业状态机（对账批实装）----
    // 狼人（月亮符 485 + 夜间：Player.cs:11488-11501 链 !dayTime && wolfAcc && !merman——
    // else 分支 DelBuff：人鱼化（accMerman 浸水态 merman）期间狼人 buff 直接移除，
    // 回复/近战加成随 buff 一起失效）
    if (eqM.wolfAcc && !this.merman && !(game.world.clock?.isDay ?? true)) {
      // :25798 每帧 AddBuff(28,60)=60t 钉值（60t=1s；原 apply(...,2) 误为 2 秒，
      // 曾顶破 >2t 无字门露出「2秒」字样——buffNoTimeDisplay[28]=true Main.cs:9215 本恒无字）
      this.buffs.apply(BuffType.Werewolf, 1);
    } else if (this.buffs.has(BuffType.Werewolf)) {
      this.buffs.remove(BuffType.Werewolf);
    }
    // 夜/日食相位（月亮石 900 天界石复合门 :14871-14874；equipStatsKey 的 N/d 档输入）
    this.nightPhase = !(game.world.clock?.isDay ?? true) || game.world.clock?.eclipse === true;
    // 冰冻护盾族（冰龟壳 1253/冰冻盾 3997 :14348-14351）：半血以下每帧 AddBuff(62,5)；
    // buff 侧 :10148-10152 超半血 DelBuff——同构为 else 移除（回复跨过半血的当帧即掉）
    if (eqM.iceBarrierAcc && this.hp <= this.maxHp / 2) {
      this.buffs.apply(BuffType.IceBarrier, 5 / 60);
    } else if (this.buffs.has(BuffType.IceBarrier)) {
      this.buffs.remove(BuffType.IceBarrier);
    }
    // 磨刀站(377)无邻近光环——1457 仅右键授予 AddBuff(159,108000)（Player.cs:32863-32866，
    // Game.ts 工位右键分支已 1:1）；且 buffNoTimeDisplay[159]=true（Main.cs:9322）恒无倒计时

    // BOC 闪避脉冲消费（BrainOfConfusionDodge :38331-38340 后半：AddBuff(321,240)=4s。
    // R5-F25：困惑近敌是 Hurt :38690-38721 命中侧 Retaliate 分支（Game.damagePlayer）,
    // 闪避侧只挂 321——旧消费端在此困惑近敌系错位,已移） */
    if (this.bocPulse > 0) {
      this.bocPulse = 0;
      this.buffs.apply(BuffType.BrainOfConfusionBuff, 4);
    }
    // 盾反冷却就绪提示（Player.cs:31953-31963）：shield_parry_cooldown 归零拍播
    // SoundEngine.PlaySound(25,Center)=MaxMana + 橙尘 45×10——位置 Center+
    // (direction*6+左向偏 -10, -14)、10×16 盒、Color(255,100,0,127)、
    // scale Next(10,16)×0.1、noLight/noGravity/velocity×0.5。置位在 damage()
    // （parryReadyCue 字段注），此处延一拍消费
    if (this.parryReadyCue) {
      this.parryReadyCue = false;
      game.playSfxWav?.('MaxMana', 1);
      const dirP = this.facing;
      for (let i = 0; i < 10; i++) {
        const d = game.vanillaDust?.spawn(
          this.cx + dirP * 6 + (dirP === -1 ? -10 : 0), this.cy - 14, 10, 16, 45,
          0, 0, 127, { r: 255, g: 100, b: 0, a: 127 },
          (10 + Math.floor(Math.random() * 6)) / 10);
        if (d) { d.noLight = true; d.noGravity = true; d.vx *= 0.5; d.vy *= 0.5; }
      }
    }
    // 潜行（1:1 改写 1457 :25930-26021）：蘑菇矿套=移动蓄(|vx|+|vy|)×0.0075/t、
    // 静止散 0.015/t 且衰减拍 stealthTimer=30（:25991——原版无 useTime 置 5、无 ==0 门）；
    // 星璇套=双击↓开关 vortexStealthActive
    // （开时 stealth 从满每 t -0.04、移速 ×0.3；再双击关）——星璇的增伤/暴在乘区读同一 stealth
    // ⑭ 变态刀 3106 单件潜行（:25448-25493：挥击中 stealth +0.1/t 且 timer=15；
    // 静止衰减同蘑菇矿；效果在 damageMult/critChance 消费）
    const heldVid = (() => {
      const d = ITEM_DEFS[this.inv.heldItem()?.id ?? -1];
      return d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
    })();
    if (heldVid === 3106) {
      if (this.useTime > 0) { this.stealthTimer = 15; if (this.stealth > 0) this.stealth = Math.min(1, this.stealth + 0.1); }
      // :25940 静止衰减分支带 !mount.Active——骑乘不走衰减（落 else 回升段）
      else if (Math.abs(this.vx) < 0.1 && Math.abs(this.vy) < 0.1 && !this.mount.active
        && this.stealthTimer === 0 && this.stealth > 0) {
        this.stealth = Math.max(0, this.stealth - 0.02);   // :25944 0.02f（曾误 0.015=蘑菇矿档）
      }
      // :25955-25965 else 段（移动/骑乘）：回升 +0.1/t、骑坐骑 stealth 直归 1（曾整缺
      // ——移动后潜行度冻结不回升、骑坐骑仍保持隐身加成）
      else {
        if (this.stealth > 0) this.stealth = Math.min(1, this.stealth + 0.1);   // :25957-25960
        if (this.mount.active) this.stealth = 1;                                 // :25961-25964
      }
      if (this.stealth > 1) this.stealth = 1;   // :25966-25969 钳顶
      if (this.stealthTimer > 0) this.stealthTimer--;
    } else if (eqM.shroomiteSet) {
      // :25984-25986 静止阈 = maxRunSpeed−0.1（原版此执行点 maxRunSpeed 恒 =originalRunSpeed=3f
      // ——Update 内序:reset :24562 → UpdateBuffs :25763 → 潜行块 :25982-26021 → moveSpeed
      // 乘区 :26206 → 装备/地板/坐骑链 :26707-26859 → HorizontalMovement :26889,乘区与装备
      // 全在潜行块之后、不参与阈值;曾写死 0.1 = 慢速漂移也判"移动",原版 |v|<2.9 全算静止衰减档）
      const num24 = PLAYER_WALK_MAX - 0.1;
      const still = this.vx > -num24 && this.vx < num24 && this.vy > -num24 && this.vy < num24
        && !this.mount.active;   // :25986 骑乘不走衰减,落 else 回升段
      if (still) {
        // :25988-25991 衰减拍:仅 stealth>0 门,每拍 −0.015 且 stealthTimer=30——原版无
        // stealthTimer==0 门、也无 useTime→5（timer 纯"衰减中"标记,衰减停后自 30 递减 :26019-26021）
        if (this.stealth > 0) {
          this.stealth = Math.max(0, this.stealth - 0.015);   // :25990（≤0 钳 0 :25992-25994）
          this.stealthTimer = 30;                             // :25991
        }
      } else {
        this.stealth = Math.min(1, this.stealth + (Math.abs(this.vx) + Math.abs(this.vy)) * 0.0075);   // :26004-26009
        if (this.mount.active) this.stealth = 1;   // :26010-26013 骑坐骑 stealth=1f（曾缺）
      }
      if (this.stealthTimer > 0) this.stealthTimer--;   // :26019-26021
    } else if (eqM.vortexSet) {
      // 双击↓检测（KeyDoubleTap :24740-24749 窗口 15t）——:57444-57448 双击只翻
      // vortexStealthActive 开关、不复位 stealth（衰减/回升段自然处理；曾强置 1 =
      // 半潜行态双击开反而先回满再衰减）
      const downNow = this.inputDown;
      // :57445-57447 KeyDoubleTap:`if (setVortex && !mount.Active)` 才翻转——骑乘中双击↓
      // 不切潜行（曾缺门=骑乘可开潜行,移速 ×0.3 叠骑速且 stealth 照衰减,原版骑乘即断）
      if (downNow && !this.prevDown && this.downTapT > 0 && !this.mount.active) {
        this.vortexStealthActive = !this.vortexStealthActive;
      }
      if (downNow && !this.prevDown) this.downTapT = 15;
      else if (this.downTapT > 0) this.downTapT--;
      this.prevDown = downNow;
      // ★BJ595 潜行衰减拍星璇环尘（Player.cs:26034-26092 flag11 面）：flag11=衰减拍
      // 且减后仍 ≥0（`stealth -= 0.04; if (<0) =0; else flag11=true`——触底拍不掷）。
      // 每拍独立 1/2 掷两族：d229 位=Center−v×Next(5,11)、v=(0,1).RotatedByRandom(2π)
      // (式=(rng−rng)×2π,Utils.cs:1785-87)、vel=v.RotatedBy(π/2)×4=(−v.y,v.x)×4、
      // scale .5+r、fadeIn .5；d240 位=Center−v×12、vel=v.RotatedBy(−π/2)×2=(v.y,−v.x)×2、
      // 同 scale/fadeIn。两者 noGravity；NewDust 位参 (Center−v×30,0,0) 仅作裁剪盒,
      // 位随后覆写（:26074/:26083 序）。骑乘置位 :26045-26047 在掷尘面之后=当拍照掷
      //（本仓无骑乘强显分支,开关面双击门已有 !mount.active）
      let vortexFadeDust = false;
      if (this.vortexStealthActive) {
        this.stealth -= 0.04;
        if (this.stealth < 0) this.stealth = 0;
        else vortexFadeDust = true;
      }
      // 未潜行态回升 +0.04/t 至 1（1457 Player.cs:26052-26060 else 分支——缺此段则
      // 关潜行后 stealth 恒 0：渲染 settled=s'≈0.03 近似永久隐身 + (1−s)×0.8 伤/
      // ×20 暴恒满（:26043-26044）。2026-08-23 潜行语义统一批补）
      else this.stealth = Math.min(1, this.stealth + 0.04);
      if (vortexFadeDust) {
        emitVortexStealthFadeDust(game.vanillaDust, this.cx, this.cy);
      }
    } else {
      this.stealth = 1;   // 无潜行装=无潜行（1457 Player.cs:26094-26097 else 分支 stealth=1f；初值同 :1545）
      this.vortexStealthActive = false;
    }
    // 星云三族逐级衰减（:11660-11670：到时降 1 级并重挂 480t，非直接清零）
    for (let f = 0; f < 3; f++) {
      if (this.nebula[f] > 0 && --this.nebulaT[f] <= 0) {
        this.nebula[f]--;
        if (this.nebula[f] > 0) this.nebulaT[f] = 480;
      }
    }
    // nebulaCD 递减（Benefits.Nebula ArmorSetBonuses.cs:49-52——UpdateArmorSets 每
    // tick 经套装 Effect 走，只在套装在身时递减；卸装冻结。★BJ424：旧态在 Game
    // updateNebulaBoosters 无门递减=偏差，随 booster 迁移落原版语义位）
    if (this.nebulaCD > 0 && this.equipStats.nebulaSet) this.nebulaCD--;
    // 星云生命 173-175（:10111-10115 lifeRegen+6/级 = 3HP/s/级）
    if (this.nebula[1] > 0 && this.hp > 0) {
      this.nebulaLifeAccum += 3 * this.nebula[1] * dt;
      if (this.nebulaLifeAccum >= 1) { const n = Math.floor(this.nebulaLifeAccum); this.nebulaLifeAccum -= n; this.hp = Math.min(this.maxHp, this.hp + n); }
    }
    // 星云魔力 176-178（:19214-19226 counter+level/t，>=6 → mana++）
    if (this.nebula[2] > 0) {
      this.nebulaManaAccum += this.nebula[2] * dt;
      if (this.nebulaManaAccum >= 6) { this.nebulaManaAccum -= 6; this.mana = Math.min(this.maxMana, this.mana + 1); }
    }
    // 甲虫球蓄能已迁 BeetleMeter（Game.tick 驱动）——旧 lastMeleeTick/beetleCharge
    // 时间蓄能近似拆除（2026-08-31）
    // 鞭 buff 倒计时（WhipTagEffect.PlayerBuffTime=180 系）
    for (const k of Object.keys(this.whipBuffs)) {
      if (--this.whipBuffs[Number(k)] <= 0) delete this.whipBuffs[Number(k)];
    }
    // 鞭 tag 栈 Update（TagEffectStack.Update :24785——Limit(maxTagEffects) 超限驱逐
    // + 各 state per-NPC 双表递减；1456 的敌侧单值递减已退役）
    this.tagEffectStack.update();
    // 蛇环补挥计数复位（Update_SnakeBand :28623-28628：冷却 120t 走完归 -1）
    if (this.repeatWhipsResetCooldown > 0 && --this.repeatWhipsResetCooldown === 0) {
      this.repeatWhipSwings = -1;
    }
    // 拍击石系冷却递减（Update_SnappingStone :28595-28621）——归零帧按在身饰品
    // 三选一回充反馈（★2026-08-24 r15 R15-16 补齐：三段纯 Dust + 三音效）。
    // L5 长尾批（2026-08-31）：原版充能编排=Spawn_*Recharge :418-471 的 BroadcastOrRequest 面
    // （netMode 联机广播）——本地直生改走 fx/orchestraFx.snappingStoneRechargeFx 同本体
    // （视觉逐参一致）+ module8 上行补远端（消费端经 orchestraPlayerAnchor 以 invoker 槽
    // 代放;尾音 Item30/Item20/Item28 档保留原置）：
    if (this.accSnappingStoneCooldown > 0 && --this.accSnappingStoneCooldown === 0) {
      const es = eqM;
      const cx = this.mountedCenter.x, cy = this.mountedCenter.y;
      const rk: 0 | 1 | 2 | null = es.accSnappingStone ? 0 : es.accPyroclast ? 1 : es.accArmletOfRuin ? 2 : null;
      if (rk !== null) {
        snappingStoneRechargeFx(game, rk, this.x, this.y, this.w, this.h);
        (game as unknown as { broadcastParticleOrchestra?: (t: number, x: number, y: number) => void })
          .broadcastParticleOrchestra?.(
            rk === 0 ? ParticleOrchestraType.SnappingStoneRecharge
              : rk === 1 ? ParticleOrchestraType.PyroclasticStoneRecharge
                : ParticleOrchestraType.ArmletOfRuinRecharge, cx, cy);
        if (rk === 0) game.playSfxWav?.('Item_30', 0.08, cx, cy, -0.9);
        else if (rk === 1) game.playSfxWav?.('Item_20', 1, cx, cy);
        else game.playSfxWav?.('Item_28', 0.08, cx, cy, -0.9);
      }
    }
    // ---- 1457 配饰四件运行态（Update_AmmoCycler :28632 / Update_SentryBackpack
    //      :28640 / Update_HarpyCharm :28648 / Update_TimerCrit :28521——原版
    //      Update :24760-24763 同段连排）----
    this.update1457AccBodies(game);

    // 荧光体 5107 手持光（PlotTileLine 光照臂,2026-09-03 接——登记销核）
    this.emitMagiluminescenceLight(game);

    // ---- ★BJ534 下砸态维护（:24799-24810）：骑乘即清（下砸中上坐骑打断）+ 计时器
    //      递增/清零。位次 = 跳跃面/碰撞之后、摔伤结算之前——原版 :24803 先于 :26945
    //      触发（触发帧计 0）、落地拍次拍 :25516 结算（读数=下坠拍数）；本仓单拍折叠后
    //      此位次使触发帧即计 1、落地拍当场结算读数 = 原版次拍读数,蓄力阈值零漂移。
    if (this.isDownDashing && this.ridingMount) this.isDownDashing = false;   // :24799-24801
    if (this.isDownDashing) this.downDashTime++;                               // :24803-24810
    else this.downDashTime = 0;

    // 落地摔伤结算（Player.cs:25495-25580：velocity.Y==0 段逐 tick——num11 整数格距
    // 两端截断(:25503)、num10=25+extraFall(+mount.ExtraFall)；结算后无条件重置
    // fallStart(:25574)，本仓以单发后清 fallStartY 等价）。
    // ★F1（四轮蓝队）：①immune 次序两形分开——石化支=先 Hurt 后 `immune=false`
    //   （:25549-25550 字面）；常规支=先 `immune=false`（:25559）再算伤 Hurt（:25567）。
    //   ②取整式纠偏——常规 `(int)((float)num11*gravDir − num10) * 10`（:25560，
    //   格差【截断】后才 ×10）；石化 `(int)((num11*gravDir − 2f) * 20f)`（:25546，
    //   ×20 在截断窗内）。删旧 round + Math.max(1,…) 补底：半格落差原版不结伤
    //   （trunc→0 ⇒ num16/num17≤0 直接跳过），0 档补 1 点属越权。
    // ★BJ534 下砸落地支（:25516-25519）：isPerformingJump_DownDash → num11=0（全档
    //   免摔伤——云床/落水/石化各支一并让位,原版 num11=0 后各支自然全假）+
    //   DoDeadCellsGroundPoundEffect(:29004,冲击波本体见 deadCellsGroundPound)。
    //   不入 fallStartY 门：原版落地块不要求 num11>0,原地/短距下砸落地照炸。
    if (this.onGround && this.isDownDashing) {
      this.fallStartY = null;             // num11=0 消费面（:25517）
      this.deadCellsGroundPound(game);    // :25519
    } else if (this.onGround && this.fallStartY !== null) {
      const startTileY = Math.trunc(this.fallStartY / TILE);
      const landTileY = Math.trunc(this.y / TILE);
      this.fallStartY = null;
      const gd = this.gravDir === -1 ? -1 : 1;         // 倒挂世界 num11*gravDir 归正
      const feetLiq = world.store.liquid[world.store.idx(Math.floor(this.cx / TILE), Math.floor((this.y + this.h - 1) / TILE))];
      const landedInWater = feetLiq > 60 || this.inWater;
      let fallSigned = (landTileY - startTileY) * gd; // ≙ 原 num11*gravDir（顺势落为正）
      // ★终审 B⑤（2026-09-04）落地云床缓冲扫描（Player.cs:25531-25542,本仓整缺补）：
      //  num11>0（倒挂 num11<0,统一 ≙ fallSigned>0）时扫脚线一行——num14 =
      //  gd==1 ? (int)((position.Y+height+1)/16)（脚底像素下一格,原式 +1 在底缘
      //  恰在格界时外推一行,照抄）: (int)((position.Y-1)/16)（头顶上一格）;
      //  num12..num13 = (int)(position.X/16)..(int)((position.X+width)/16) 含端。
      //  格 tile.active()（=hasTile,裸位含已致动,原版照致动格生效）且
      //  [TileID.Sets.Clouds[type]（TileID.cs:197={189,196,460,717,718,719}）
      //  || type==666 粪块 || (type==19 平台 && frameY/18==49 云平台样)] →
      //  num11=0 break——云床/云格落地免摔伤。消费位=下方石化支(:25544-25556,
      //  num11=0 → num16=(0-2)×20<0 不伤)与常规支(:25557-25567,门槛不入)同源。
      if (fallSigned > 0) {
        const stC = world.store;
        const yC = gd === 1
          ? Math.floor((this.y + this.h + 1) / TILE)
          : Math.floor((this.y - 1) / TILE);
        const x0C = Math.floor(this.x / TILE);
        const x1C = Math.floor((this.x + this.w) / TILE);
        for (let xc = x0C; xc <= x1C; xc++) {
          if (!stC.hasTile(xc, yC)) continue;
          const iC = stC.idx(xc, yC);
          const sheetC = TILE_DEFS[stC.type[iC]]?.vanilla?.sheet ?? -1;
          const cloudPlatform = sheetC === 19 && Math.floor(stC.frameY[iC] / 18) === 49;
          if (CLOUD_SHEETS.has(sheetC) || sheetC === 666 || cloudPlatform) {
            fallSigned = 0;
            break;
          }
        }
      }
      if (landedInWater) { /* 落水缓冲：不计摔伤 */ }
      else if (this.buffs.has(BuffType.Stoned)) {
        // 石化摔伤（:25544-25556）：(num11*gravDir−2)×20——无 25 格安全阈值、不吃
        // 翼/马掌/noFallDmg 豁免（独立于常规链）；幸存 ≤10% → event 8。
        // ★A2 接漏斗：原版 Hurt(ByOther(5), num16, hitDirection=0)（:25549）；
        // 飘字=num16 字面直传 floatDealt、音由漏斗单点承载；immune 清除在 Hurt
        // 【之后】（:25550 先后序=F1 分形②）。带免疫帧落地时本拍 Hurt 被吞、下一
        // tick immune 已清照常结伤（与原版同拍语义一致）。
        const num16 = Math.trunc((fallSigned - 2) * 20);
        if (num16 > 0) {
          this.lastDamageCause = { kind: 'fell' };
          this.envHurtThroughFunnel(game, num16, this.cx, this.y - 10, -1, num16);
          this.iframes = 0;                            // :25550 原版在 Hurt 之后清
          if (!this.dead && this.hp > 0 && this.hp <= this.maxHp / 10) {
            game.achievements?.handleSpecialEvent(8,
              { statLifeMax: this.maxHp, statManaMax: this.maxMana });
          }
        }
      }
      else {
        const safeT = 25 + eqM.extraFall + (this.ridingMount ? this.mount.extraFall : 0);
        // 常规链门槛（:25557）：((gd==1&&num11>num10)||(gd==-1&&num11<-num10))
        // && !noFallDmg && !hasWings。extraFall/坐骑 extraFall 并入门槛；
        // 坐骑 FallDamage 乘后再截断（:25563 `(int)(num17×FallDamage)`）。
        if (fallSigned > safeT
          && !(eqM.wing || this.hasHorseshoe || eqM.noFallDmg)) {
          this.iframes = 0;                            // :25559 原版在算伤/Hurt 之前清
          let num17 = Math.trunc(fallSigned - safeT) * 10;
          if (this.ridingMount) {
            if (this.mount.type === 1) { return; }     // 兔兔 :25512 归零→不可达伤害（既有早退面保留）
            num17 = Math.trunc(num17 * this.mount.fallDamageFactor);
          }
          if (num17 > 0) {                             // :25565 字面守门（≤0 不入漏斗）
            this.lastDamageCause = { kind: 'fell' };
            this.envHurtThroughFunnel(game, num17, this.cx, this.y - 10, -1, num17);
            // 成就：摔落幸存（:25568-25571 `!dead && statLife<=statLifeMax2/10` → event 8）
            if (!this.dead && this.hp > 0 && this.hp <= this.maxHp / 10) {
              game.achievements?.handleSpecialEvent(8,
                { statLifeMax: this.maxHp, statManaMax: this.maxMana });
            }
          }
        }
      }
    }

    // ---- 坐骑踩踏/横撞两通道已按 ★F6 迁至碰撞积分前（见上方锚点注释）----

    // 走跑动画计时（仅地面；空中贴图静态不参与动画）
    if (Math.abs(this.vx) > 0.3 && this.onGround) this.animTime += Math.abs(this.vx);
    else this.animTime = 0;

    // 越界保护（引擎安全网）：★A2 接漏斗——General 桶、hitDirection=0（kb=false）、
    // 无本地飘字（floatDealt 缺省 ⇒ noLocalFloat）,msg117 广播与死亡结算随漏斗单点。
    // 原版注记：1457 Player.cs 无 Out-of-world KillMe 站（全树 9999 直死仅 KillMe
    // 参数面,46065 半血/22464-22511 WOF 千伤为异源）——本站为本仓引擎护栏,接漏斗
    // 只统一死亡面不加伤害语义。
    const maxY = world.h * TILE;
    if (this.y > maxY + 100) {
      this.envHurtThroughFunnel(game, 9999, this.cx, this.y, ImmunityCooldownID.General);
    }
    // ---- AFK 计数链（Player.cs:25692-25701 Update 段 1:1；终零波 补 Game 层链）：
    //      消费=NPC.cs:412 noGroundWorms（≥300=AFKTimeNeededForNoWormSpawns）→
    //      SetSpawnFlagsForChosenTile:1053 !skyMob 门起 noWorms（挂机不出蠕虫族）。
    //      ★计时粒度：本仓 fixedUpdate 定步频 60Hz 与原版 Update 同拍。
    //      controlTorch=this.inputTorch（Game 输入合成段写入）;死亡观战退出钳 300
    //      （HandleSpectatingControls :17200）同属计数链旁支不接（登记）。
    //      Select 族清零在 Game 键位段（ Digit/Hotbar±/滚轮）。
    //      步进核心抽 stepAfkCounter 纯函数（tests/finalzero-game-domain 直测）。
    //      ★Q4 刀 2026-09-30（BJ413 登记·挂机放风筝）：afkCounterForKiting 同条件
    //      同拍步进（:25697-25702 两计数同一 if/else），独有清零面两支补齐——
    //      ①光标持物（:25702-25704 `i==whoAmI && !Main.mouseItem.IsAir`→0,本仓
    //      等价=inv.cursorMirror）②petting/sitting/sleeping（:25705-25710→0）。
    //      消费=Game.updateSmartSelect AFK 臂（PickItemSelectionOverride :17537）。 ----
    {
      const heldAfk = this.inv.heldItem();
      const heldVidAfk = heldAfk ? (ITEM_DEFS[heldAfk.id]?.vid ?? (ITEM_DEFS[heldAfk.id].vid ?? -1)) : -1;
      const steppedAfk = stepAfkCounter({
        vx: this.vx, vy: this.vy, itemAnimTicks: this.itemAnimTicks,
        inputX: this.inputX, inputUp: this.inputUp, inputDown: this.inputDown,
        inputJump: this.inputJump, inputTorch: this.inputTorch,
        heldIsKite: KITE_ITEM_VIDS.has(heldVidAfk),
        afkCounter: this.afkCounter,
      });
      this.afkCounter = steppedAfk;
      this.afkCounterForKiting = steppedAfk;                     // :25697/:25702 同拍
      if (this.inv.cursorMirror) this.afkCounterForKiting = 0;   // :25702-25704 光标持物
      if (this.petting.isPetting || this.sitting || this.sleeping) {
        this.afkCounterForKiting = 0;                            // :25705-25710 体力面
      }
      // selectedKite 逐 tick 重算（UpdateEquips :12994/:13001 →
      // RefreshAutoKitingFromItemTypeAndSlot :12939-12944：每 tick ResetEffects
      // :18548 先清 -1，再 HeldItem 槽优先、后 0..57 顺序扫——首个 IsAKite 槽胜出）
      this.selectedKite = -1;
      const heldSel = this.inv.heldItem();
      const heldSelVid = heldSel ? (ITEM_DEFS[heldSel.id]?.vid ?? -1) : -1;
      if (heldSelVid >= 0 && KITE_ITEM_VIDS.has(heldSelVid)) {
        this.selectedKite = this.inv.selected;                   // :12994 HeldItem 优先
      }
      if (this.selectedKite < 0) {
        const slots = this.inv.slots;
        for (let j = 0; j < slots.length && j < 58; j++) {       // :13001 j<58
          const it = slots[j];
          const vid = it ? (ITEM_DEFS[it.id]?.vid ?? -1) : -1;
          if (vid >= 0 && KITE_ITEM_VIDS.has(vid)) { this.selectedKite = j; break; }
        }
      }
    }
    this.prevInputX = this.inputX; // 冲刺双击检测（DoCommonDashHandle release 语义）
    this.prevInputLeft = this.inputLeft; this.prevInputRight = this.inputRight;   // ★MV3 单键沿同源刷新（:27827-27845 releaseLeft/Right=!control 逐拍尾刷新同址）
    this.updateRopeKeyTimers();   // ★BJ-C8（R7-F1）：:27832-27862 leftTimer/rightTimer 逐拍尾写（松键置 7/持键递减/归 0 回充）
    this.jumpEdgePrev = this.inputJump;  // 跳键边沿（tick 尾快照——水中起跳 releaseJump :20409 消费；prevInputJump 在 tick 头快照故不可用）
    this.upEdgePrev = this.inputUp;      // ★BJ704-G15：↑ 键边沿（同址尾快照——Mount.tryStartHover :26939 的 controlUp∧releaseUp 消费;CCed 清输入 :6107 在前=冻结拍快照清零,与原版 releaseUp 刷新同相）
    // 血肉墙舌头（Player.WOFTongue :21993-22056，Update 内 myPlayer 段调用）
    this.wofTongue(game, world, dt);
    // ★BJ704-G19（G16 登记债③）：挂爪/上绳清位（vanilla PlayerFrame :36775-36778
    //   抓钩臂 `else if (grappling[0] >= 0) { sandStorm = false; CancelAllJumpVisualEffects(); }`
    //   + :26334-26335 pulley 块同款双清——isPerformingJump_*/sandStorm 全灭,次拍起
    //   run 加速/转向门/尾迹/瓶族加速全灭）。位序=物理后（≙ PlayerFrame :28496
    //   移动段后调用）;pulley 清位原版在同拍 run 块前=1 拍差,面上不可达（沙暴门内
    //   !pulley）备案。
    if (this.grappling[0] || this.pulley) this.performingJump = null;
    // ★BJ704-G19（G16 登记债③）：沙暴跳 4tick 自翻（PlayerFrame :36577-36581
    //   `if (sandStorm) { if (grappling[0] >= 0) sandStorm = false; if (miscCounter % 4 == 0
    //   && itemAnimation == 0) ChangeDir(direction * -1); … }`——挂爪清位由上行承载）。
    //   sandStormVisual 读移动相头持久位=视觉 1 拍滞后等价登记;miscCounter 仓内拍首
    //   递增（:4793）vs 原版拍尾（:29529）=4tick 相位差 1 拍,振荡周期等价。ChangeDir
    //   的臂旋/itemLocation 镜像（:42434-42436）=渲染侧 facing 派生等价;pulley 侧挂
    //   改位支（:42416-42430）在 sandStorm 门内 !pulley 不可达。itemAnimation==0 门用
    //   animBusy 同代理（:6414——非挥砍以 useTime 计窗）。
    if (this.sandStormVisual && this.miscCounter % 4 === 0
      && this.itemAnimTicks <= 0 && this.useTime <= 0) this.facing = -this.facing;
    // 钩爪锚点表重建（Player.cs:27991-27992 Update 尾清表）：锚由 GrappleProj
    // 每帧自登记（挂墙 :49797-49801 / 锚定段 :49954-49957），下 tick 消费前重建
    this.grappling[0] = null;
    this.grapCount = 0;
  }

  /**
   * ★BJ524（2026-10-05）冲刺状态机独立化（DashMovement :20769-21265 + DoCommonDashHandle
   * :21267-21323 整段搬运）。原版 Update :26945 JumpMovement() → :26958 DashMovement()
   * 在主移动支【无条件】调用（绳索支 :26691 亦然）——wet 不闸 dash：Player.cs 全文
   * dashDelay/dashTime/dashing 与 wet 零交点（wet 置位 :28060 只写湿态面）。旧仓整段
   * 嵌在跳跃块干支 else 内=湿支整缺 → 水中 dashDelay 冻结（滑行期入水恒 -1/冷却期
   * 入水恒 >0）→ Run() 门（dashDelay>=0）恒闭 = 用户实报「克盾冲刺入水不能左右移动」。
   * 现干/湿两支各调用一次本方法，位次均=重力施加之前（原版 dash-before-gravity 序）。
   * 干路径逐位等价搬运（入参即旧干支同名局部）。★BJ705-G25:后四参=运动链四字段
   * 终值（maxRun/accRun/runSlow/runAcc——滑行期链照跑直通,num15/滑行制动消费）。
   */
  private dashMovement(
    game: GameHooks, eqM: PlayerEquipStats,
    ix: number, maxRun: number, accRun: number, runSlow: number, runAcc: number,
  ): void {
    const eq = eqM;   // 旧干支局部别名（extraJumps 段 const eq = eqM）随段迁入
    // ★C5-B2（2026-10-06）移动支门（Player.cs:26691/:26695/:27598）：原版
    //  DashMovement 只在绳索支（:26691）与正常移动支（:26695
    //  `else if (grappling[0] == -1 && !tongued)`）调用；挂钩/舌缚支（:27598 else）
    //  只调 UpdateControlHolds —— 冲刺状态机【整支不可达】：就绪不发起、滑行不
    //  阻尼、冷却不倒数、eoc/日曜/dash6 扫敌全停。旧式挂钩期照跑 = 就绪段可发起 +
    //  eocDash=15 恒冻逐帧扫敌（原版不可能路径）。冻结≠清零：松钩后滑行/冷却原样
    //  续跑（绳攀非 pulley 支已并入正常移动支=MV1②,门统一承载于此,勿散布调用点）。
    if (this.grappling[0] || this.buffs.has(BuffType.TheTongue)) return;
    // ★C5-B5 dash 字段闩锁（:21211-21217：mount∈{62..65}→dashType=6 在前,
    //  dashDelay==0 拍才从活值重推导——滑行/冷却期冻结在发起拍档位）
    // ★C5-B6 双击窗清（:21221-21223：dash==0 → dashTime=0 + dashDelay=0——摘装备
    //  窗冻结→重装后单击即冲=原版不可能路径。dashDelay=0 承载写非恒 no-op：
    //  结网支 dash=0×滑行/冷却态（C5-B3）正靠本写拍内清零即时就绪）
    if (this.dashDelay === 0) {
      this.dashLatched = this.mountDashing6() ? 6 : eq.dash;
    }
    if (this.dashLatched === 0) {
      this.dashT = 0;
      this.dashDelay = 0;
    }
    // ---- 冲刺 1:1（DashMovement :20769-21265 + DoCommonDashHandle :21267-21323）----
    // 1=忍者足具/水晶刺客（纯位移） 2=克苏鲁护盾（冲撞 30+反弹）。
    // dashDelay 三态（:20775-20782）：0=就绪 / -1=滑行中（阻尼衰减） / >0=冷却倒计时。
    // 三态互斥（原版 if/else-if/else 同 tick 只走一支：:20958/:20970/:21128）——
    // 触发帧不再叠跑阻尼。触发帧单次置速（:21131 dash1=16.9 / :21162 dash2=14.5，
    // 原版 px 值），此后靠滑行阻尼自然衰减——无恒速段（旧 dashTicks=15×12.5 近似
    // 已废）；重力照常作用（原版 JumpMovement 不因 dashing 豁免）
    // 克苏鲁护盾冲撞（:20784-20846）：eocDash>0 且未命中时逐帧扫敌。命中判定盒 =
    // 位置 + 速度×0.5 外扩 4px（:20786）；伤害 30×meleeDamage 可暴击、击退 9
    // （kbGlove ×2 / 泰坦 kbBuff ×1.5，:20800-20808）；命中 → eocDash=10、30t 冷却、
    // 反弹 vx=-dir×9 vy=-4（:20825-20840）
    // ★C5-B4/B5（2026-10-06）外门改 dash 闩锁位（:21225 `if (dash == 2 && eocDash
    //  > 0)`——dash 字段冻结在发起拍档位,中途卸盾滑行期扫敌照续=原版相;旧式读活
    //  eq.dash 且把 eocHitId<0 折入外门 → 回弹臂整支不可达）。
    // ★606:mod ShieldSlam 档(≥7 spec.shieldSlam)走 dash2 同款扫敌门
    const modDashLatched = this.dashLatched >= 7 ? modDashSpecOf(this.dashLatched) : null;
    if ((this.dashLatched === 2 || modDashLatched?.shieldSlam === true) && this.eocDash > 0) {
      // ★C5-B4 内门劈两支（:21227-21289）：eocHit<0 逐帧扫敌；else（已命中,
      //  eocDash 10t 冷却窗内）无同向输入 → vx×0.95 回弹衰减——持同向键=「接住」
      //  反弹不衰减（原版 `(!controlLeft || !(velocity.X < 0f)) && (!controlRight
      //  || !(velocity.X > 0f))` De Morgan 直译）。旧式回弹全程 -9 无衰减。
      if (this.eocHitId < 0) {
        let eocHitFlag = false;         // :21270/:21281 eocHit>=0 本轮快照
        const parkourArm = eq.oldStyleParkour === true;   // ★F5③ 6190 两臂开关
        const bhx = this.x + this.vx * 0.5 - 4, bhy = this.y + this.vy * 0.5 - 4;
        const bhw = this.w + 8, bhh = this.h + 8;
        for (const e of game.enemies()) {
          const en = e as { id?: number; x?: number; y?: number; w?: number; h?: number; cx?: number; cy?: number;
            dead?: boolean; hurt?: (d: number, kx: number, ky: number, g: unknown, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean };
          if (en.dead || !en.hurt || en.cx === undefined || en.cy === undefined) continue;
          // friendly 门（原版 :20793 !nPC.friendly continue——冲撞对睡渔夫 376 等友好 NPC 无效）
          if (!playerCanHitEnemy(e, game)) continue;
          // ★AI_112 仙灵免疫门（B 扫尾补账：原式 :21275 冲撞扫敌门禁串
          //  `(nPC.aiStyle == 112 && !(nPC.ai[2] <= 1f))` → continue——充能态
          //  （虫网释放后态 2+）仙灵免伤克盾冲撞）。SetDefaults（NPC.cs:16608
          //  type==583||584||585）下 aiStyle=112 全集恰为仙灵三型 ⇒ 三型 vanillaId
          //  判定与原式等价（chilletDashCharge 同款落法）；ai[2]≤1 前态照常可打。
          const dashFairy = en as unknown as { vanillaId?: number; ai2?: number };
          if ((dashFairy.vanillaId === 583 || dashFairy.vanillaId === 584
            || dashFairy.vanillaId === 585) && (dashFairy.ai2 ?? 0) > 1) continue;
          const ex = en.x ?? en.cx - 8, ey = en.y ?? en.cy - 8, ew = en.w ?? 16, eh = en.h ?? 16;
          if (!(bhx < ex + ew && bhx + bhw > ex && bhy < ey + eh && bhy + bhh > ey)) continue;
          const dir = this.vx < 0 ? -1 : this.vx > 0 ? 1 : this.facing; // :20809-20815
          // ★BJ-C2/F11（2026-10-06）：原版掷面 = meleeCrit 字段值（:21260 `Main.rand.Next
          //  (100) < meleeCrit`）——含基 4（:2413 字段初值）与 :25712-14 逐帧链入的持械
          //  item.crit+crt；this.critChance('melee') 只载装备/buff 面 ⇒ 补 4+heldItemCritBonus。
          const crit = Math.random() * 100 < 4 + this.critChance('melee')
            + heldItemCritBonus(this.inv.heldItem());   // :20811-20813
          const dmg = Math.max(1, Math.round(30 * this.damageMult('melee')));
          // ★S02(BJ723-B):克盾冲撞 crit 直传（原版 :21258-21267 ApplyDamageToNPC(…,
          //  crit,3097) 单布尔,×2 在 StrikeNPC_Inner 防后 NPC.cs:82067=Enemy.hurt 承载）
          //  ——旧「预倍 dmg+crit=false 字面」=暴击飘字色双缺,随刀归位。
          const kb = 9 * (eq.kbGlove ? 2 : 1) * (this.buffs.has(BuffType.Titan) ? 1.5 : 1);
          en.hurt(dmg, dir * kb, -4, game, 0, crit, 0, true);   // 克脑盾冲撞=玩家伤害=DPS 计(:20811 PlayerAttack 族)
          // ★FR4-F（三轮蓝队）：删自发飘字——Enemy.hurt 单点已发（受击音+飘值同点，
          // 见 Enemy.hurt 内 :82006-82015 收口注）；免疫早返 false 时本行曾仍弹
          // 「幻影伤害」（2026-08-31 二轮红队同案复核）。色走单源敌方族表
          // （fx/CombatTextColors.enemyHurtFloatColor），勿在调用方重设
          // ★D3 玩家侧碰撞攻击免疫统一时钟（克盾冲撞 GiveImmune(4)——vanilla
          //  DashMovement 冲撞段 :21277 GiveImmuneTimeForCollisionAttack(4) 同位）
          grantCollisionAttackImmunity(this, 4);
          this.eocDash = 10;            // :20833
          eocHitFlag = true;
          this.eocHitId = en.id ?? -2;  // :20840（后续帧不再对同一敌结算）
          this.dashDelay = 30;          // :20834 反弹并结束滑行
          // ★F5③ inline 臂（:21272-21276）：跑酷书 6190 在场 → 命中迭代内即翻速
          if (parkourArm) {
            this.vx = -dir * 9;
            this.vy = -4;
          }
          break;
        }
        // ★F5③ post-loop 臂（:21281-21286）：非跑酷书走循环尾统一反弹，num4 取
        // 【整轮终态】vx 符号或朝向——单命中 break 模型下终态 vx=±14.5（本帧无人写）
        // ⇒ num4=dir 与 inline 同值；接通多命中续扫时两臂差异在此兑现。
        if (eocHitFlag && !parkourArm) {
          const num4 = this.vx !== 0 ? Math.sign(this.vx) : this.facing;   // :21283 num4
          this.vx = -num4 * 9;
          this.vy = -4;
        }
      } else if (!(this.inputLeft && this.vx < 0) && !(this.inputRight && this.vx > 0)) {
        this.vx *= 0.95;              // :21287-21289 回弹臂（★C5-B4 补）
      }
    }
    if (this.dashDelay > 0) {
      // 冷却段（:20958-20968）：eocDash 同步倒数，归零清冲撞命中标记
      if (this.eocDash > 0) this.eocDash--;
      if (this.eocDash === 0) this.eocHitId = -1;
      this.dashDelay--;
    } else if (this.dashDelay < 0) {
      // ★BJ595 滑行拖尘（DashMovement :21434-21515 逐档段——dash3 日耀 4×尘6
      // 已由 BJ594 落位（2026-10-10,emitDashSlideDust dash===3 支）、
      // dash4=原版死支（dashType=4 无赋值面,1457 全树 grep）不落、dash2 循环 m<0 死支
      // 不落）。逐参在 emitDashSlideDust 单源（tests/bj595+tests/bj594 直测）。
      // adjustDashDustMethod（坐骑委托改尘位,:21439 等 6 站）本仓无委托面未建模=登记。
      // ★BJ707-A：dash6（Chillet）不在此位发射——vanilla :21519-21550 dash==6 支
      // 的尾尘在【收敛判定后】的同向 else 臂（收敛拍落 dashDelay=30 支零尘）,见下方 m6 块。
      if (this.dashLatched !== 6) {
        emitDashSlideDust(game.vanillaDust, this, this.dashLatched, this.armorSetDyeVid());
      }
      // ★606:mod dash 滑行期钩(MidDashEffects 同位)
      if (modDashLatched?.midDash) modDashLatched.midDash(this, (globalThis as { __swGame?: unknown }).__swGame);
      // 滑行阻尼（:20970-21113）：|vx|>12 → ×0.985；否则 |vx|>max(accRunSpeed,
      // maxRunSpeed) → ×0.94；跌破档位即结束滑行（dashDelay=20）并把 vx 钳回
      // ±maxRunSpeed（:21108-21113）。num13 = max(accRunSpeed,maxRunSpeed)
      // （accRunSpeed=靴 6/裸 3，maxRunSpeed=3×moveSpeed）
      // 1457: 步行两分支删 `dashDelay >= 0` 门（HorizontalMovement :19984/:20010）——
      // 滑行中按反方向输入现在会制动冲刺：原版落 maxRunSpeed 步行分支
      // （反向时 vx<maxRun / vx>-maxRun 成立）→ runSlowdown 制动 + runAcceleration
      // 反向加速；同向输入不满足门，无效果。爬坡分支仍保留 dashDelay>=0（:20091/:20121）
      // ★BJ705-G25 [g23-fullspeed-dashdelay-1457] 清偿·字段直通:maxRun/runSlow/runAcc
      //   =移动相链终值（翼档 mult/坐骑覆写+平值/沙丘/暗影/翼45×6 摩擦全入——D3
      //   moveSpeed 乘区 :26206 同在链内;绳支=pulley 拍裸装面,旧式逐字等值零漂移）。
      if (ix !== 0) {
        if (ix > 0 ? this.vx < maxRun : this.vx > -maxRun) {
          if (ix > 0 ? this.vx < -runSlow : this.vx > runSlow) this.vx += ix * runSlow;
          this.vx += ix * runAcc;
        }
      }
      // 滑行阻尼参数（DashMovement :21424-21431 基础档 + 各 dash 段覆写）：
      //   num13=档1阈值 12（dash3 日曜=14 :21478）、num14=档1阻尼 0.992
      //   （dash2/3/4=0.985 :21457/:21479/:21499）、num16=档2阻尼 0.96
      //   （dash2/3/4=0.94）、num17=结束冷却 20（dash2=30 :21459）。
      //   R5-F14：旧恒 12/0.985/0.94/20——dash1 克盾衰减过快（20t 残速 74% vs
      //   原版 85%）、dash2 冷却短 1/3、dash3 阈值档错,均已修
      // ★F5① dash==6 滑行特例（:21521-21527）：`Sign(vx) != direction || dashType != 6`
      // → num17=(dashDelay)=30、vx×0.3、dashTime=0。
      // ★F1 dashType!=6 半支修正：原文 dashType 由 DashMovement 头逐帧覆写
      //（:21211-21214 mount∈{62..65} → dashType=6；ResetEffects :18775 每帧清 0）
      //⇒ 运行期恒等式 dashType==6 ⟺ 本 tick 仍在 Chillet 鞍上。旧近似把半支承载在
      //"mountDashing6()" 上——滑行中途下鞍瞬间既失收敛判定又落配饰档污染
      //（eq.dash∈{2,3,4} 会冒充覆写）；现拆 m6Glide(本轮滑行发起源=dash6,即原文
      // dash 字段保持 6 的窗口)与 onChillet6(dashType==6 位)两个真值面：
      //   反向 ⟺ Sign(vx)!=direction；脱离鞍位 ⟺ !onChillet6 ⇒ 任一成立即收敛。
      let m6Ended = false;
      const m6Glide = this.mountDash6Active;       // 本轮滑行=dash6 发起（= 原文 dash==6）
      const onChillet6 = this.mountDashing6();     // dashType==6 位（本 tick 在鞍上）
      if (m6Glide) {
        if (Math.sign(this.vx) !== this.facing || !onChillet6) {
          m6Ended = true;
          this.vx *= 0.3;                  // velocity.X *= 0.3f（:21525）
        } else {
          // ★BJ707-A 同向滑行尾尘（:21527-21548 else 臂 8×d306/拍——曾整段
          //  「未建模视觉面」=冲刺零尾焰,用户实报「冷却感觉比原版长」的体感主源
          //  （时序机本体 1:1:实测全周期 51 拍≈手算 vanilla 52,冷却 20/收敛 30）。
          //  光照段（:21530 AddLight(0.5,0.1,0.6)/(0.6,0.3,0.1)）在 mountLights
          //  case 62-65 渲染端承载（p.dash>0∧dashDelay<0 同门同拍）。dashDelay 保持 -1 继续阻尼。
          // ★BJ707-G29：dash6 尘染料=cMount（:21539 非 ArmorSetDye——换道为
          //  mountDyeVid()=miscDyes 直读零掷,旧 armorSetDyeVid() 的 Next(3) 掷
          //  在 vanilla 该拍不存在=顺手撤除掷流多耗）
          emitDashSlideDust(game.vanillaDust, this, 6, this.mountDyeVid());
        }
      }
      // ★F1 滑行参数基础档化：覆写表按【滑行发起源的 dash 档】查（原文 num13-17 只认
      // dash 字段值 :21434-21499）——dash6 发起的滑行 dash==6 无任何条目=恒基础档
      // 12/0.992/0.96/20；骑乘期 eq.dash 不得污染。配饰档（eq.dash∈{1,2,3}）只在
      // 配饰发起的滑行生效（含骑 CanDash 非 6 型坐骑 56-61 场景,dash 保持装备值）。
      // ★C5-B5（2026-10-06）：档位读 dashLatched（dash 字段闩锁位,:21434-21499 原文
      //  num13-17 只认 dash 字段值）——旧式读活 eq.dash=滑行中途卸/换装备阻尼档
      //  即漂移（原版不可能路径）。m6Glide 期 dashLatched===6 不落任何装备档,门保
      //  留（!m6Glide）作 F1 结构锚。
      const accOverridden = !m6Glide && (this.dashLatched === 2 || this.dashLatched === 3 || this.dashLatched === 4);
      // ★606:mod dash 档阻尼(decelMult 覆写 num14;v8=0.925/ornate 12.5 速=decel 面近似)
      const modDashSpec = this.dashLatched >= 7 ? modDashSpecOf(this.dashLatched) : null;
      const dashNum13 = (!m6Glide && this.dashLatched === 3) ? 14 : 12;
      const dashNum14 = modDashSpec?.decelMult ?? (accOverridden ? 0.985 : 0.992);
      const dashNum16 = accOverridden ? 0.94 : 0.96;
      const dashNum17 = m6Ended ? 30 : (!m6Glide && this.dashLatched === 2 ? 30 : 20);   // :21523 num17=(dashDelay)=30（反向收敛特例）;其余按各档
      if (m6Ended) { this.dashDelay = 30; this.mountDash6Active = false; }   // dashTime=0 无独立窗建模
      // num15（:21429 出口钳速）= max(accRunSpeed, maxRunSpeed)——★BJ705-G25
      //   [g23-num15-field-face] 清偿:改读【字段面】（链终值直通:WingAirLogicTweaks
      //   抬/坐骑 stats 覆写/DuneBoost ×1.75/暗影 ×1.15 全入——翼空中滑行出口钳=
      //   翼 accSpeed（幽灵翼/星盘 9 vs 旧裸装 3=3 倍面;靴 6/6.75 同步）;绳支=
      //   pulley 拍裸装面=旧式恒等零漂移）。R5-F15 面（maxRun 吃 moveSpeed 乘区
      //   buffs.moveSpeedMult × strongestSlow）由链 maxRun 同源承载。
      const num15 = Math.max(accRun, maxRun);
      this.vortexStealthActive = false;  // :21106 滑行中强制显形
      if (Math.abs(this.vx) > dashNum13) {
        this.vx *= dashNum14;
      } else if (Math.abs(this.vx) > num15) {
        this.vx *= dashNum16;
      } else {
        this.dashDelay = dashNum17;      // :21567 dashDelay = num17
        // :21570-21575 钳回 ±num15——符号保持；★MV1（2026-10-06）补 vx==0 档原版语义:
        // 原版 `if (velocity.X < 0 || (velocity.X == 0f && controlLeft)) -num15;
        // else if (> 0 || (==0 && controlRight)) +num15;`——vx==0 时按当前左右键择向,
        // 【无键则保持 0】（旧式三目把 vx==0 恒踢 +num15=自造右向蹬出）。
        // ★MV2（2026-10-06）债③清偿：vx==0 择向臂直读 inputLeft/inputRight（=原版
        // controlLeft/Right 同源位,CCed 拍已被 :5261 清零=恒保持 0 与原版同相;双键
        // 同按原版 controlLeft 优先臂=−num15,旧经 ix 承载时 inputX=0 两臂皆不落,
        // 1 拍 ±num15 级边缘）。滑行制动/加速臂（上方 ix!==0 块）仍读 ix=HorizontalMovement
        // Run 支承载,不动（mv1 定谳）。
        if (this.vx < 0 || (this.vx === 0 && this.inputLeft)) this.vx = -num15;
        else if (this.vx > 0 || (this.vx === 0 && this.inputRight)) this.vx = num15;
      }
    } else if (eq.dash > 0 || this.mountDashing6()) {
      // 就绪段（:21128 else）：DoCommonDashHandle（:21267-21323）——双击窗收敛 +
      // 同向二连击触发（原版此段只在 dashDelay==0 时运行：冷却/滑行期点击不登记窗）
      // 1457: 触发条件加 `!CCed`（DoCommonDashHandle :21740 `controlDash && !CCed &&
      // releaseDash`）——冻结/结网/石化不能冲刺
      if (this.dashT > 0) this.dashT--;   // :21268-21271 每帧向 0 收敛
      else if (this.dashT < 0) this.dashT++;
      // ★BJ508（2026-10-04）Quick Dash 键面（DoCommonDashHandle :21738-21747）：
      //   `controlDash && !CCed && releaseDash` → num = direction（facing），持反向
      //   时改持向（num3 = controlRight−controlLeft == −num2 → num4 = num3）。
      //   本路径不受双击冲刺设置门（:21737 flag 只门双击支 :21749/:21764）；
      //   releaseDash 闩 = :21779-21782 `dashing && controlDash → releaseDash=false`
      //   （按住不重触），Game 注入面 `releaseDash ||= !inputDash`（TriggersSet.cs
      //   :826 同序）任一拍松键即重臂。inputX === −facing ⟺ num3 == −num2
      //   （inputX 合值与 num3 同源同值；keyNum≠0 ⟹ inputX∈{0,±keyNum}）。
      const dashKeyNum = this.inputDash && !this.cced && this.releaseDash
        ? (this.inputX === -this.facing ? this.inputX : this.facing)
        : 0;                                  // num（:21736 初值 0=键面不触发）
      let dashed = false;                     // DoCommonDashHandle dashing 出参（:21727）
      // 入支序 = 原版右支（:21749 `(controlRight && releaseRight) & flag) || num == 1`）
      // 先、左支（:21764）后——双击沿带 flag 门（双击冲刺设置），num 支无 flag 门。
      // ★MV3（2026-10-07）债⑤清偿：双击沿改单键按下沿承载。原版 releaseRight/Left
      //   逐拍尾刷新（:27827-27845 `releaseRight = !controlRight`，位次晚于 DashMovement
      //   调用 :26691/:26958 ⇒ 消费面读到上一拍键态）⟺ 消费面 `controlRight ∧
      //   ¬controlRight(前拍)` = 单键按下沿——双键同按时另一键的按/放不产生本键沿。
      //   旧 inputX 合值沿（≠0 ∧ prev=0）在双键同按面丢真沿（本键重按 inputX 归 0，
      //   原版 :21760/:21775 照登记 ±15 窗）+发假沿（松本键 inputX 0→±1，反向窗提前
      //   1 拍登记，二次松键即反向冲刺=与原版方向相反）。
      const tapRight = options.data.doubleTapDash && !this.cced
        && this.inputRight && !this.prevInputRight;      // controlRight ∧ releaseRight（:21749）
      const tapLeft = options.data.doubleTapDash && !this.cced
        && this.inputLeft && !this.prevInputLeft;        // controlLeft ∧ releaseLeft（:21764）
      const dashEntryDir =
        dashKeyNum === 1 || tapRight ? 1
          : dashKeyNum === -1 || tapLeft ? -1
          : 0;
      // 原版 dir=分支向硬编码（:21755 dir=1 / :21769 dir=-1；调用方 :21588
      //   `velocity.X = 16.9f * dir` 等按支消费）——右支含 num==1、左支含 num==-1，
      //   故 dir ≡ dashEntryDir（num=±1 落同号支；单键沿与 num 异号时沿支优先=原版
      //   分支序）。旧 `keyNum ?: inputX` 在单键域逐位同值；双键同按 inputX=0 时丢窗
      //  （原版按支记 ±15）。
      const dashDir = dashEntryDir;
      if (dashEntryDir !== 0) {
        const dir = dashDir;
        // 执行门（:21751 `dashTime > 0 || num == 1` / :21766 `dashTime < 0 || num == -1`
        //  ——键面即触不等窗,双击沿须窗活）
        const dashExecute = dashEntryDir === 1
          ? (this.dashT > 0 || dashKeyNum === 1)
          : (this.dashT < 0 || dashKeyNum === -1);
        if (dashExecute) {
          // 骑乘门（:21579 `dash <= 0 || (mount.Active && !MountID.Sets.CanDash[
          // mount.Type]) → return`——表={56..65}，MountID.cs:11 字面）。★治理批
          // B6②（2026-08-31）：旧 F5① 落地只放行 dash==6 的 Chillet 族 62-65，
          // 滚轴鞋 56-60/仙灵 61 六型被误禁——原版骑乘【可】冲的是配饰档
          // （dash1 忍者足具 16.9/dash2 克盾 14.5/dash3 日耀 21.9，速度取装备值非
          // 坐骑 dashSpeed；vanilla-mounts.json 已含该六型 dashSpeed 提取面:
          // 56=4.5、57-60=7.5、61=4.5,本通道不消费——阈值面只服务 charge 族横撞）。
          // 非 CanDash 坐骑照旧整段 return（dashT 清窗）；骑 CanDash 坐骑无配饰档
          // 时 dash==0 → 后续分支不落（等价原文门）。eocDash 残迹清除对应 :21408
          // 的 !CanDash 门,同被本 gate 覆盖。
          if (this.ridingMount && !(MOUNT_CAN_DASH_TYPES.has(this.mount.type))) {
            this.dashT = 0;
          } else if (MOUNT_DASH6_TYPES.has(this.mount.type)) {
            // dash==6 就绪分支（DoCommonDashHandle 尾 :21710-21731 dashing 支）
            dashed = true;              // ★BJ508 dashing 出参（闩清位臂消费）
            this.timeSinceLastDashStarted = 0;   // ★BJ705-G25 :21756/:21771 发起拍清 0（G25 [g23-wing45-dash-friction]）
            this.dashT = 0;
            this.mountDash6Active = true;                       // dashType=6 生效位（:21211-21213）
            this.facing = dir;                                  // direction 随冲向（sign 判定用）
            if (this.vy === 0) this.vy = -4;                    // :21713-21715
            this.vx = 16 * dir;                                 // :21716 velocity.X = 16f*dir5
            if (this.vy > 0) this.vy /= 2;                      // :21717-21719
            if (this.dashWallAhead(dir)) this.vx /= 2;          // :11720-11727 头部撞墙减半
            this.dashDelay = -1;                                // :21728 进入滑行态
          } else {
          dashed = true;                // ★BJ508 dashing 出参（闩清位臂消费）
          this.timeSinceLastDashStarted = 0;   // ★BJ705-G25 :21756/:21771 发起拍清 0（G25 [g23-wing45-dash-friction]）
          this.dashT = 0;               // :21305 触发即清双击窗
          this.mountDash6Active = false;   // 配饰冲刺取代 dash6 语境
          this.dashDir = dir;
          this.dashDelay = -1;          // :21138 进入滑行态
          // ★606:mod dash 档(≥7=PlayerDashEffect 类;speed=CalculateDashSpeed)
          const modDash = eq.dash >= 7 ? modDashSpecOf(eq.dash) : null;
          this.vx = (modDash ? modDash.speed
            : eq.dash === 2 ? 14.5 : eq.dash === 3 ? 21.9 : 16.9) * dir;
          // :21588 dash1=16.9 / :21619 dash2=14.5 / :21643 dash3 日曜=21.9
          //（R5-F13：旧 dash3 落 16.9,冲撞初速低 23%）
          // ★组B 批（2026-09-18）dash5 水晶刺客（套装 sb.dashType=5 → Math.max 链入位）
          //   落 16.9 else 档（:21666 与 dash1 同速）;阻尼/冷却走基础档（:21503 无
          //   num13-17 覆写,accOverridden 不含 5）;无冲撞伤害（仅 dash2/3/6 有伤害支）
          //   ——★BJ595 水晶尘 68/69/70 视觉面补齐（下块）;dash2 起爆尘循环 m<0=死支
          //   不落;dash3 日耀尘已由 BJ594 落位（emitDashLaunchBurst dash===3 支）。
          // 头部将撞墙减半（:21132-21137）：身前半宽+2px 的头部点/身体中点格
          // SolidOrSlopedTile → velocity.X /= 2
          if (this.dashWallAhead(dir)) this.vx /= 2;
          if (eq.dash === 2) { this.eocDash = 15; this.eocHitId = -1; } // :21170
          if (modDash?.shieldSlam) { this.eocDash = 15; this.eocHitId = -1; }   // ★606:ShieldSlam=接触伤害同 dash2 扫敌
          if (eq.dash === 3) { this.solarDashing = true; this.solarDashConsumed = false; } // :21258-21260 SolarDashStart
          // ★BJ595 起爆尘（DashMovement 起爆段——dash1 :21583-21612 / dash5
          //   :21700-21715,逐参在 emitDashLaunchBurst 单源=tests/bj595 直测;
          //   dash2 起爆循环 m<0=死支零尘、dash3 日耀尘=BJ594 在途）。
          emitDashLaunchBurst(game.vanillaDust, GorePiece.newGore.bind(GorePiece),
            this, eq.dash, this.armorSetDyeVid());
          }
        } else if (this.ridingMount && !MOUNT_CAN_DASH_TYPES.has(this.mount.type)) {
          // ★Note② 非 CanDash 坐骑：:21579 早退在 DoCommonDashHandle 前整体 return
          // ——【窗口同样不登记】（dashTime ±15 不落）。旧版只挡消费端：鞍上首击
          // 登记的残窗 + 快速下鞍后二击可消费 = 原文不可达路径。
          // 门集 = MountID.Sets.CanDash {56..65}（MountID.cs:11 字面）。
          this.dashT = 0;
        } else {
          this.dashT = dir * 15;        // :21761/:21776 首击登记双击窗（右 15/左 −15）
        }
      }
      // ★BJ508 releaseDash 闩清位臂（:21779-21782 `if (dashing && controlDash)
      //   releaseDash = false`）——发起后按住不重触;置位臂在 Game 注入面（:826）
      if (dashed && this.inputDash) this.releaseDash = false;
    }
    // 日曜冲撞命中（DashMovement :21293-21352：solarDashing && dashDelay<0 逐帧
    // 扫敌——【不反弹不结束滑行】,滑行期每帧可多目标;命中置 nPC.immune[whoAmI]=6
    // （:21348）防同敌连击 + GiveImmuneTimeForCollisionAttack(4)。首中耗一层盾
    // （solarDashConsumedFlare :21312-21316）。R5-F16：旧"命中即 solarDashing=false"
    // = 每次冲撞只伤一个目标,已修为逐帧多目标）
    if (this.solarDashing && this.dashDelay < 0) {
      const bhx3 = this.x + this.vx * 0.5 - 4, bhy3 = this.y + this.vy * 0.5 - 4;
      const bhw3 = this.w + 8, bhh3 = this.h + 8;
      for (const e of game.enemies()) {
        const en = e as { id?: number; x?: number; y?: number; w?: number; h?: number; cx?: number; cy?: number;
          dead?: boolean; hurt?: (d: number, kx: number, ky: number, g: unknown, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
          iframes?: number };
        if (en.dead || !en.hurt || en.cx === undefined || en.cy === undefined) continue;
        // friendly 门（原版 :21299 !nPC2.friendly continue——同克盾冲撞）+
        // immune[whoAmI] > 0 门（:21299——6t 免疫帧内不再吃冲撞）
        if ((en.iframes ?? 0) > 0) continue;
        if (!playerCanHitEnemy(e, game)) continue;
        // ★AI_112 仙灵免疫门（B 扫尾补账：原式 :21299 `nPC2.aiStyle == 112 &&
        //   !(nPC2.ai[2] <= 1f)` → continue——充能态仙灵免伤日耀冲撞。三型
        //   vanillaId 判定落法与 chilletDashCharge/克盾支同源，ai2≤1 前态可打）
        const solFairy = en as unknown as { vanillaId?: number; ai2?: number };
        if ((solFairy.vanillaId === 583 || solFairy.vanillaId === 584
          || solFairy.vanillaId === 585) && (solFairy.ai2 ?? 0) > 1) continue;
        const ex3 = en.x ?? en.cx - 8, ey3 = en.y ?? en.cy - 8, ew3 = en.w ?? 16, eh3 = en.h ?? 16;
        if (!(bhx3 < ex3 + ew3 && bhx3 + bhw3 > ex3 && bhy3 < ey3 + eh3 && bhy3 + bhh3 > ey3)) continue;
        if (this.solarShields > 0 && !this.solarDashConsumed) {
          this.solarDashConsumed = true;
          this.solarShields--;          // ConsumeSolarFlare(:21312-21316)
          this.solarCounter = 0;
        }
        const dir3 = this.vx < 0 ? -1 : this.vx > 0 ? 1 : this.facing;
        // ★BJ-C2/F11（2026-10-06）：同克盾冲撞——原版 :21328 `Main.rand.Next(100) <
        //  meleeCrit` 含基 4+:25712-14 持械折入,补 4+heldItemCritBonus（F11 同式）。
        const crit3 = Math.random() * 100 < 4 + this.critChance('melee')
          + heldItemCritBonus(this.inv.heldItem());
        const dmg3 = Math.max(1, Math.round(150 * this.damageMult('melee')));  // :21317
        // ★S02(BJ723-B):crit3 直传（原版 :21317-21327 ApplyDamageToNPC 形,×2 在
        //  StrikeNPC_Inner 防后=Enemy.hurt 承载）——旧「预倍+false 字面」色缺随刀归位
        const kb3 = 9 * (eq.kbGlove ? 2 : 1) * (this.buffs.has(BuffType.Titan) ? 1.5 : 1);        // :21318-21327
        en.hurt(dmg3, dir3 * kb3, -4, game, 0, crit3, 0, true);   // 日耀盾滑行=玩家伤害=DPS 计(:21317)
        if (en.iframes !== undefined) en.iframes = 6;   // :21348 immune[whoAmI]=6
        // ★GC1/D3 统一时钟双写：NPC 面 → 共享表（近战三重门消费）；
        // 玩家面 GiveImmuneTimeForCollisionAttack(4)（:21349——原旧注"仍走各自旧近似，
        // 不并入"备案就此清偿，汇入 MountCombat.grantCollisionAttackImmunity 统一时钟）
        (game as unknown as { noteNpcPlayerImmune?: (id: number, t: number) => void })
          .noteNpcPlayerImmune?.(en.id ?? -1, 6);
        grantCollisionAttackImmunity(this, 4);
        // ★FR4-F（三轮蓝队）：删自发飘字——Enemy.hurt 单点已发（同克盾冲撞站；
        // 免疫早返 false 时不再出幻影伤害，色归敌方族表单源）
        // 不置 solarDashing=false——滑行全程逐帧结算（原版 :21352 无终止写）
      }
    } else if (this.dashDelay >= 0) {
      this.solarDashing = false;
    }
    // ★F5① dash==6 冲撞命中（DashMovement :21354-21405：`dash == 6 && dashDelay < 0
    // && whoAmI == Main.myPlayer` 滑行期逐帧扫敌——盒朝向前沿 +60px 外扩、伤害
    // (150|64/65特例150否则32)×minionDamage、kb6（kbGlove×2/泰坦×1.5）、crit 恒字面、
    // npc.immune[whoAmI]=20、GiveImmune(10)、sourceItemId=5665。实现 MountCombat.
    // chilletDashCharge；小动物门 = 统一出口 projectile=null 面）
    if (this.mountDash6Active && this.mountDashing6() && this.dashDelay < 0) {
      chilletDashCharge(this, game, this.buffs.has(BuffType.Titan));
    }
    if (!this.mountDashing6()) this.mountDash6Active = false;
  }

  /** 派对染发剂彩纸（UpdateHairDyeDust Player.cs:23994-24023 1:1）：
   *  门=hairDye==派对 shaderId 且非死亡/石化/冰冻（本仓 shimmering≈frozen 语义）。
   *  独立方法供 MP 远端代理同门补掷（代理不走 fixedUpdate,原版各端对全部
   *  Main.player 跑此尘——本地/远端双消费,2026-08-20 补远端） */
  updateHairDyeDust(game: GameHooks): void {
    if (this.hairDye !== PARTY_HAIR_DYE_SHADER_ID || this.dead || this.shimmering) return;
    const jit = () => 1 + (Math.floor(Math.random() * 101) - 50) * 0.01;   // 1±0.5
    if (Math.random() < 1 / 45) {
      // 尘 139-142（Next(139,143) 上界排除）：盒 width×8、scale 1.2×(0.7±0.3)、
      // 速度 ×(1±0.5)+±0.5、vy−1、+自身速度×0.2
      const d = game.vanillaDust?.spawn(this.x, this.y, this.w, 8,
        139 + Math.floor(Math.random() * 4), 0, 0, 0, null, 1.2);
      if (d) {
        d.vx = d.vx * jit() + jit() - 0.5 + this.vx * 0.2;
        d.vy = d.vy * jit() + jit() - 0.5 - 1 + this.vy * 0.2;
        //   ★O1 核销(2026-09-02)：scale 行=1456:24007 / 1457:24473 Next(-30,31)（61 值域
        //   整型）——floor(rand*61)-30 逐位精确,合法勿动
        d.scale *= 0.7 + (Math.floor(Math.random() * 61) - 30) * 0.01;
      }
    }
    if (Math.random() < 1 / 225) {
      // 内脏 gore 276-282（Next(276,283) 上界排除）：NewGore 自带抖动后再
      // ×(1±0.5)+±0.5、vy−1、scale×(1±0.2)、+自身速度×0.2
      const g = GorePiece.newGore(276 + Math.floor(Math.random() * 7),
        this.x + Math.random() * this.w, this.y + Math.random() * 8, 0, 0, 1, false);
      if (g) {
        g.vx = g.vx * jit() + jit() - 0.5 + this.vx * 0.2;
        g.vy = g.vy * jit() + jit() - 0.5 - 1 + this.vy * 0.2;
        g.scale *= 1 + (Math.floor(Math.random() * 41) - 20) * 0.01;
      }
    }
  }

  /** ★2026-09-01 枭首者头部 282 联动残影发射位（DoDeadCellsBeheadedParticles
   *  Player.cs:24491-24510 1:1）：门 = !dead && !ghost && !stoned && !frozen &&
   *  head==282 && !sitting && !sleeping && (坐骑不隐藏玩家)。载荷：
   *  PositionInWorld = MountedTop + (0, 8×gravDir + gfxOffY + Remap(|vx|,0,3,0,−4)×
   *  gravDir);MovementVector = velocity（骑乘轨道支旋后,见下）。原版
   *  RequestParticleSpawn(clientOnly:true)（各端对全部玩家本地生成）→ 本仓只模拟
   *  本地玩家 → 本地直生 + 广播补远端（34 型偏差口径）。消费本体 =
   *  fx/orchestraFx.deadCellsBeheadedHeadFx。
   *  ★旋位支清偿（2026-09-03）：fullRotation≠0 → 载荷位绕 position+fullRotation
   *  Origin 旋（:24497-24500 vector.RotatedBy(fullRotation, pivot)——矿车轨面
   *  TrackRotation（:28325-28326 origin=(w/2,h)）∪ UFO 7/钻头 8/扫帚 23 倾斜机身
   *  （Hover Mount.cs:3519-3568）,playerFullRotationOf 与渲染层同源）,旋后值直入
   *  module8 载荷 = 远端复放自动同位（载荷格式不变,旋转由 producer 烘入坐标）。
   *  ★R3 复核翻案（2026-09-03）：骑乘速度旋转支（:24501-24504 vector2.RotatedBy(
   *  fullRotation, Zero)）此前登记"AnyTrackRider∩fullRotation 写面=∅ 死支保留"
   *  有误——:28325 Minecart.TrackRotation 在 bitsByte[0]（onTrack）直接 ref 写玩家
   *  fullRotation,而矿车族 MountData.Minecart=true ⇒ AnyTrackRider（Mount.cs:558-573
   *  Minecart ∪ CanRideMinecartTracks）恒真,交集非空。本仓接线：门 = fullRotation≠0
   *  ∧（ridingCart ‖ mount.Active ∧ MOUNT_DATA.CanRideMinecartTracks）——57-60 滚轴
   *  冰鞋 CanRideMinecartTracks=true；★SW-BJ59 轨骑落地后该支可达（mount.fullRotation
   *  由贴轨帧 TrackRotation 写入，playerFullRotationOf 滚轴鞋支消费）。
   *  ★载荷纵项清偿（2026-09-03,红队R3②③）：gfxOffY 聚合 = this.gfxOffY（滑轮
   *  :19837/:19854/:19871/:26440 + 衰减 :28216-28238）+ stepRenderY（StepUp/Down
   *  :28267-28278 `ref gfxOffY` 的本仓登记等价系统,Player.ts 台阶检测注释锚）+
   *  cart.gfxOffY（:28325 TrackRotation 返回值——三态互斥,和 = 原版单字段现值）;
   *  MountedTop（:3333-3346）gravDir=−1 走 Bottom−HOC 分支（曾漏 → FTW 倒挂锚差
   *  整盒高）。HOC = HeightOffsetHitboxCenter（:3237-3248）= mount.Active ?
   *  PlayerOffsetHitbox（Mount.cs:427-436 = −PlayerOffset + heightBoost）: 0
   *  （折叠凳支 HeightBoost−VisualYOffset=26−26=0,本仓 stoolInUse 盒已含 +26 →
   *  同式自消）。坐标换算与 mountedCenter 同约定：坐骑态 vanilla pos.Y ≡ this.y−boost
   *  （SetMount :6335-6344 盒高 42+boost、底锚 preserved）、Bottom ≡ this.y+this.h;
   *  矿车态玩家被锁车盒顶（Minecart.ts:530-531）→ vanilla pos.Y ≡ this.y、
   *  Bottom ≡ this.y+cart.h（cart.h = 42+heightBoost = 原版 mounted 盒高）;
   *  矿车 bob = playerYOffsets（SetAsMinecart Mount.cs:2770-2776 填 8−vOff+pOff →
   *  默认 8;51/53 传 (−10,−8) → 10（:1102/:1110）——json 提取器缺该数组,硬补同
   *  anchorPlayerOffset 口径）,boost = cart.h−42（SetAsMinecart :2766 heightBoost=10）。 */
  /** ★BJ534 DoDeadCellsGroundPoundEffect（Player.cs:29004-29040 1:1）：重锤符文下砸
   *  落地冲击波。调用位 = 摔伤结算段落地拍（:25519）。门 = whoAmI==Main.myPlayer
   *  （:29006——本仓本地玩家即 this,远端代理不走 fixedUpdate 同BJ508口径）。
   *  蓄力档 = 32×downDashTime>300（:29014 ⇔ downDashTime≥10t）：半径 128→176、
   *  kb 10→20、crit false→true。伤害 30 平值（无 DamageVar 掷、无 minionDamage 乘区）
   *  ——crit 走本仓惯例【调用侧预倍 ×2】（Enemy.hurt 不内部翻倍,MountCombat 矿车/
   *  踩踏同款偏差登记）。命中门 = active∧!friendly∧!dontTakeDamage∧
   *  CanNPCBeHitByPlayerOrPlayerProjectile（:29030——enemy∪critter 双桶并扫,
   *  CountsAsCritter∧dontHurtCritters 统一出口;无 LOS 门=原版设计）;半径判据 =
   *  中心距 ≤num（:29033 字面 >num continue）;击退方向 = 目标在玩家哪侧（:29035）。
   *  ★不落 npc.immune（原版本支无 immune 写面——单发结算无连击面）;ApplyDamageToNPC
   *  通道旗加伤（DamageDealt :20599）与穿甲（GetArmorPenetration(melee:false)）同源链
   *  照踩踏族接法。编排放大粒子 DeadCellsDownDashExplosion（clientOnly:false → owner
   *  端广播,远端经 netApplyParticleOrchestra 复放 deadCellsDownDashExplosionFx——
   *  producer 侧缺口就此闭合,fx/orchestraFx 台账注）：PositionInWorld=
   *  Center+(0,height/2−4)×gravDir、UniqueInfoPiece=蓄力?1:0、MovementVector=(半径,gravDir)。 */
  deadCellsGroundPound(game: GameHooks): void {
    const charged = 32 * this.downDashTime > 300;          // :29014
    const radius = charged ? 176 : 128;                    // :29010/:29018
    const damage = charged ? 60 : 30;                      // :29011 平值 30;蓄力 crit 本仓预倍 ×2
    const knockback = charged ? 20 : 10;                   // :29012/:29019
    const crit = charged;                                  // :29013/:29017
    const gd = this.gravDir === -1 ? -1 : 1;
    game.broadcastParticleOrchestra?.(ParticleOrchestraType.DeadCellsDownDashExplosion,
      this.cx, this.cy + (this.h / 2 - 4) * gd, radius, gd, charged ? 1 : 0);   // :29021-29026
    // 原版 Main.npc 单数组并扫 = 本仓 enemies ∪ critters 双桶并扫（fromCritterBucket
    // 注入 CountsAsCritter 成员源,MountCombat.npcHitTargets 同式）
    const critterBucket = game.critters?.() ?? [];
    const buckets: Array<[unknown[], boolean]> = [
      [game.enemies() ?? [], false],
      [critterBucket, true],
    ];
    for (const [bucket, fromCritter] of buckets) {
      for (const ent of bucket) {
        const e = ent as { x?: number; y?: number; w?: number; h?: number; cx?: number; cy?: number;
          dead?: boolean; dontTakeDamage?: boolean; hurt?: (d: number, kx: number, ky: number,
            g: GameHooks, ap?: number, crit?: boolean, pierce?: number, fp?: boolean) => boolean };
        if (!e || e.dead || e.dontTakeDamage || !e.hurt) continue;              // :29030 active/dontTakeDamage
        if (!playerCanHitEnemy(ent, game)) continue;                            // :29030 !friendly 同式
        if (!playerProjectileCanHitNpcGate(game, ent, fromCritter)) continue;   // CanNPCBeHitByPlayerOrPlayerProjectile
        const ex = e.cx ?? (e.x ?? 0) + (e.w ?? 16) / 2;
        const ey = e.cy ?? (e.y ?? 0) + (e.h ?? 16) / 2;
        const dx = ex - this.cx, dy = ey - this.cy;                             // :29032 nPC.Center - base.Center
        if (Math.hypot(dx, dy) > radius) continue;                              // :29033 vector.Length() > num
        const dir = dx > 0 ? 1 : -1;                                            // :29035
        e.hurt(applyBannerDamageDealt(game, ent as never, damage), dir * knockback, 0,
          game, playerArmorPenOf(game), crit, 0, true);                         // :29036 ApplyDamageToNPC
      }
    }
  }

  /** ★BJ550 社交残影环采样出口（SW-FX36 载体 spX/spY 的只读快照）——
   *  下砸过程残影（Renderer.drawPlayer → downDashGhostStamps）消费面。
   *  环语义/相位归 SW-FX36 原位（updateSocialShadow :16699-16726,fixedUpdate
   *  头 :4159 每 tick 调）;传送/spawn 冲洗不建模已由 SW-RB14d 勘误定谳
   *  （差 ≤1 拍,原版本相）。分配面 = 仅下砸中每帧 3 对象（渲染路径既有量级）。 */
  shadowRing(): Array<{ x: number; y: number }> {
    return [{ x: this.spX[0], y: this.spY[0] }, { x: this.spX[1], y: this.spY[1] }, { x: this.spX[2], y: this.spY[2] }];
  }

  deadCellsBeheadedStep(game: GameHooks): void {
    // ★F4③（2026-09-01）补 !stoned 门——仓内有真实石化态（BuffType.Stoned=156,
    // :3619 lastStoned 过渡同源）非"不可达态",原版门串 :24494 含 !stoned && !frozen
    // ★F4④/V7（2026-09-03）frozen 真实映射落地——原版 `!frozen` 是 Player.frozen
    //   状态位（每帧 :18767 复位、buff 循环内 :10143 buff47 Frozen / :11874-11875
    //   buff353 Shimmer 双源置位）。旧写 frozen≈shimmering 登记映射只覆盖 353 源,
    //   47 源（冰冻枪/冰雪敌人/寒冰buff）漏门 ⇒ 戴 282 头被冻结时仍喷残影。本仓
    //   BuffType.Frozen=63 ↔ vanilla 47（Buffs.ts:520）,双源口径与 projTargets
    //   frozen 探针（frozen: has(63)||shimmering）同式对齐。
    if (this.dead || this.isGhostPhase(game.world) || this.shimmering
      || this.buffs.has(BuffType.Frozen) || this.buffs.has(BuffType.Stoned)) return;   // !frozen 双源 + !stoned
    if (this.headArmorSlot !== 282) return;                    // head == 282（枭首者头部 5457）
    if (this.sitting || this.sleeping) return;                 // !sitting.isSitting && !sleeping.isSleeping
    if (this.mount.active && !!MOUNT_SETS.PlayerIsHidden?.[this.mount.type]) return;   // PlayerIsHidden 门
    const cart = this.ridingCart ? this.cart : null;
    // ---- MountedTop（Player.cs:3333-3346）：x = position.X+w/2;y = pos+HOC
    //      （gravDir=1）/ Bottom−HOC（gravDir=−1）。HOC = −bob+boost
    //      （Mount.cs:435 −PlayerOffset+heightBoost;未骑乘/折叠凳=0,见方法头）
    const bob = cart
      ? (cart.mountId === 51 || cart.mountId === 53 ? 10 : 8)  // SetAsMinecart playerYOffsets（:2770-2776）
      : this.anchorPlayerOffset;                               // Mount.PlayerOffset（:411-425）
    const boost = cart ? cart.h - 42                           // SetAsMinecart heightBoost=10（:2766）
      : (this.mount.active ? this.mount.heightBoost : 0);      // MountData.heightBoost
    const hoc = boost - bob;                                   // HeightOffsetHitboxCenter（:3237-3248→Mount.cs:435）
    const posVY = cart ? this.y : this.y - boost;              // vanilla position.Y（换算见方法头）
    const bottomY = cart ? this.y + cart.h : this.y + this.h;  // vanilla Bottom.Y
    let px = this.cx;
    let py = (this.gravDir === 1 ? posVY + hoc : bottomY - hoc)                              // MountedTop.Y
      + 8 * this.gravDir + this.gfxOffY + this.stepRenderY + (cart ? cart.gfxOffY : 0)       // :24496 gfxOffY 聚合
      + Math.max(0, Math.min(1, (Math.abs(this.vx) - 0) / 3)) * -4 * this.gravDir;   // Remap(|vx|,0,3,0,-4)
    // ★旋位支（:24497-24500）：if (fullRotation != 0) vector = vector.RotatedBy(
    //   fullRotation, position + fullRotationOrigin)——矿车轨面（:28326 (w/2,h)）∪
    //   Hover 机身倾斜,playerFullRotationOf 单源
    const fr = playerFullRotationOf(this, this.mount, cart);
    if (fr) {
      const rp = rotatedBy(px, py, fr.angle, fr.pivotX, fr.pivotY);
      px = rp.x; py = rp.y;
    }
    // ★:24501-24504 骑乘速度旋转支（R3 复核翻案,见方法头）：MovementVector 绕
    //   Zero 旋同一 fullRotation——门 = fullRotation≠0（fr 非 null）∧ mount.Active
    //   ∧ AnyTrackRider（矿车族恒真;非矿车读 CanRideMinecartTracks）
    let mvx = this.vx, mvy = this.vy;
    if (fr && (cart || (this.mount.active
      && !!MOUNT_DATA[String(this.mount.type)]?.CanRideMinecartTracks))) {
      const rv = rotatedBy(mvx, mvy, fr.angle);                // pivot = Vector2.Zero
      mvx = rv.x; mvy = rv.y;
    }
    deadCellsBeheadedHeadFx(game, px, py, mvx, mvy);
    game.broadcastParticleOrchestra?.(ParticleOrchestraType.DeadCellsBeheadedEffect,
      px, py, mvx, mvy);
  }

  /** CheckCrackedBrickBreak（Player.cs:23040-23110 全 1:1）：跑动/下落撞上地牢
   *  裂砖族（481-483）徒手撞碎一片。速度门：|vx|>rand(2,12) 或 vy>rand(2,12)；
   *  vy<1 时脚底三点（Bottom/BottomLeft/BottomRight+1px）任一为"实心非裂砖"
   *  则不触发（站在普通地面跑不算）；扫掠命中格压 vy→1；破坏区=预测位外扩
   *  （横 ±(16+8)px、脚行至 +2 行）内全部"上方无实心"的裂砖 KillTile（掉落）。 */
  private checkCrackedBrickBreak(game: GameHooks): void {
    if (this.shimmering || this.dead) return;               // :23043 shimmering 豁免
    const st = game.world.store;
    const cxT = Math.floor(this.cx / 16), cyT = Math.floor(this.cy / 16);
    if (cxT < 10 || cyT < 10 || cxT >= st.w - 10 || cyT >= st.h - 10) return;  // InWorld 10
    let flag = (2 + Math.random() * 10) < Math.abs(this.vx)
      || (2 + Math.random() * 10) < this.vy;                // rand.Next(2, 12)
    if (flag && this.vy < 1) {
      const feetY = Math.floor((this.y + this.h + 1) / 16); // Bottom + UnitY
      for (const px of [this.x + this.w / 2, this.x, this.x + this.w]) {
        const tx = Math.floor(px / 16);
        if (!st.inBounds(tx, feetY)) continue;
        const t = st.get(tx, feetY);
        // SolidTileAllowBottomSlope active 门（WorldGen.cs:70712）——hasTile 位本体
        // （红蓝对抗 F10：曾用 type≠0 代读，幽灵残型地面误判"站普通地面"不触发）
        // ★G1谓词批(2026-09-04)：原式含 !inActive()（:70718）——isActive 位读补致动
        // 半边（已致动地面不算普通地面,裂碎照常触发）
        if (t === 0 || !st.isActive(tx, feetY)) continue;
        const d = TILE_DEFS[t];
        // SolidTileAllowBottomSlope && !CrackedBricks（:23060）→ 站普通地面不触发
        if (d?.solid && !d.platform && !isCrackedSheet(d.vanilla?.sheet)) { flag = false; break; }
      }
    }
    if (!flag) return;
    const pvx = this.x + this.vx;                            // position + velocity（:23072）
    const num = Math.floor(pvx / 16), num2 = Math.floor((pvx + this.w) / 16);
    const num3 = Math.floor((this.y + this.h + 1) / 16);
    const solidTopAt = (x: number, y: number): boolean => {  // WorldGen.SolidTile
      if (!st.inBounds(x, y)) return false;
      const t = st.get(x, y);
      // SolidTile active 门（WorldGen.cs:70652）——hasTile 位本体（红蓝对抗 F10：
      //   曾用 type≠0 代读，幽灵残型顶盖误判实心顶 → 裂砖不碎）
      // ★G1谓词批(2026-09-04)：SolidTile 原式含 !inActive()（:70658）——isActive
      // 位读补致动半边（已致动顶盖不算实心顶）
      if (t === 0 || !st.isActive(x, y)) return false;
      const d = TILE_DEFS[t];
      return !!d?.solid && !d.platform;
    };
    const rx = this.x - 1, ry = this.y - 1, rw = this.w + 2, rh = this.h + 2;  // getRect Inflate(1,1)
    let hit = false;
    for (let i = num; i <= num2; i++) {
      for (let j = num3; j <= num3 + 1 && i >= 0 && i < st.w && j >= 0 && j < st.h; j++) {
        if (isCrackedAt(st, i, j) && !solidTopAt(i, j - 1)
          && i * 16 < rx + rw && i * 16 + 16 > rx
          && j * 16 < ry + rh && j * 16 + 16 > ry) {
          hit = true;
          if (this.vy > 1) this.vy = 1;                      // :23091 速度钳
        }
      }
    }
    if (!hit) return;
    // 破坏区（:23099-23106：(x−16−8)/16 .. (x+w+16+8)/16，脚行 num3..num3+2）
    const k0 = Math.floor((pvx - 16 - 8) / 16), k1 = Math.floor((pvx + this.w + 16 + 8) / 16);
    for (let k = k0; k <= k1; k++) {
      for (let l = num3; l <= num3 + 2; l++) {
        if (isCrackedAt(st, k, l) && !solidTopAt(k, l - 1)) game.breakTile?.(k, l);
      }
    }
  }

  // ==================== 钩爪（Grappling Hooks 1:1）====================
  // 原版锚点表登记（Projectile.cs:49797-49801 挂墙 / :49954-49957 锚定段每帧重登记；
  // grapCount < 10 上限）
  registerGrapple(g: GrappleProj): void {
    if (this.grapCount < 10) {
      this.grappling[this.grapCount] = g;
      this.grapCount++;
    }
  }

  /** 发射时登记在役钩（= 原版扫 Main.projectile[owner] aiStyle==7，Player.cs:5984） */
  registerGrappleProj(g: GrappleProj): void {
    if (!this.grappleProjs.includes(g)) this.grappleProjs.push(g);
  }

  /** Kill 反注册（GrappleProj.kill） */
  unregisterGrapple(g: GrappleProj): void {
    const i = this.grappleProjs.indexOf(g);
    if (i >= 0) this.grappleProjs.splice(i, 1);
  }

  /** 现役锚定格集合（SmartCursorHelper.cs:106-115 _grappleTargets：
   *  锚点表各锚 Center 的 tile 坐标——智能光标镐线终点/免挖集） */
  grappleAnchorTiles(): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < this.grapCount; i++) {
      const g = this.grappling[i];
      if (g) out.push({ x: Math.floor(g.cx / TILE), y: Math.floor(g.cy / TILE) });
    }
    return out;
  }

  /** Player.RemoveAllGrapplingHooks（1457 Player.cs:33826-33838）：清黑名单 + 清锚点表 +
   *  杀全部自有 aiStyle7 弹体。
   *  ★SW-BJ14 2026-09-07：原版 = `for (int i=0;i<1000;i++) 扫 Main.projectile 全量
   *  (owner==whoAmI && aiStyle==7) → Kill()`（:33831-33837）——Kill 不摘数组元素，全数
   *  必死。本仓按登记表 grappleProjs 等价实现，但 GrappleProj.kill() 会同步反注册
   *  （unregisterGrapple → splice），裸 for..of 在迭代中变异数组 = 游标跳格，只杀到
   *  一半（n 钩杀 ⌊n/2⌋、余 ⌈n/2⌉ 个幸存钩）；随后 length=0 把幸存钩逐出登记表成
   *  「孤儿钩」——仍每 tick 自登记锚点表拉人（GrappleProj.stepLatched），却不再被
   *  任何收爪/上限面看见（Jump 收爪/fireGrapple 扫描/黑名单全走本表）⇒ 玩家悬空
   *  卡死到钩 10 分钟 timeLeft 耗尽或死亡（用户实报 SW-BJ14）。快照迭代 = 语义对齐
   *  原版「全量杀」；kill() 幂等（dead 短路），重复杀安全。 */
  removeAllGrapplingHooks(): void {
    this.clearGrapplingBlacklist();
    this.grappling[0] = null;
    this.grapCount = 0;
    for (const g of [...this.grappleProjs]) g.kill();   // SW-BJ14：快照迭代防 kill→splice 游标跳格
    this.grappleProjs.length = 0;
    this.goingDownWithGrapple = false;
  }

  /** Player.ClearGrapplingBlacklist（:5880-5882） */
  clearGrapplingBlacklist(): void {
    this.grappleBlacklist.clear();
  }

  /** Player.IsBlacklistedForGrappling（:5885-5887） */
  isBlacklistedForGrappling(x: number, y: number): boolean {
    return this.grappleBlacklist.has(x * 100000 + y);
  }

  /** Player.UpdateBlacklistedTilesForGrappling（:5890-5927）：
   *  每个已锚钩的 3×3 邻域中【非实心】格入黑名单（防同点叠锚——实心格本就可挂，
   *  此名单实际只拦截平台/轨道等非实心可挂格）+ 轨道/平台锚的 5×5 同族格网。
   *  store 缺省取 lastStore（fixedUpdate 每帧刷新）；GrappleProj 挂墙回调显式传入 */
  updateBlacklistedTilesForGrappling(store?: import('../world/TileStore').TileStore): void {
    this.clearGrapplingBlacklist();
    const st = store ?? this.lastStore ?? null;
    if (!st) return;
    for (const g of this.grappleProjs) {
      if (!g.latched) continue;                            // :5893-5895 ai[0]!=2 跳过
      const px = Math.floor(g.cx / TILE);
      const py = Math.floor(g.cy / TILE);
      for (let j = -1; j <= 1; j++) {                      // :5897-5905 3×3 非实心
        for (let k = -1; k <= 1; k++) {
          if (!st.inBounds(px + j, py + k)) continue;
          if (!st.isSolid(px + j, py + k)) {
            this.grappleBlacklist.add((px + j) * 100000 + (py + k));
          }
        }
      }
      const sheet = TILE_DEFS[st.get(px, py)]?.vanilla?.sheet ?? -1;
      if (sheet !== TRACK_SHEET && !TILE_DEFS[st.get(px, py)]?.platform) continue; // :5907-5909
      for (let l = -2; l <= 2; l++) {                      // :5911-5925 5×5 同族格网
        for (let m = -2; m <= 2; m++) {
          if (!st.inBounds(px + l, py + m)) continue;
          const s2 = TILE_DEFS[st.get(px + l, py + m)]?.vanilla?.sheet ?? -1;
          if (s2 === TRACK_SHEET || TILE_DEFS[st.get(px + l, py + m)]?.platform) {
            this.grappleBlacklist.add((px + l) * 100000 + (py + m));
          }
        }
      }
    }
  }

  /** ★BJ704-G22（g20-mountjump-firefx 清偿）：坐骑特殊跳起跳帧爆发特效（干湿两支
   *  同拍调用——vanilla JumpMovement 单块无干湿分裂）。各执行支（:20935-21196）：
   *  · 独角兽 flag9（:21040-21067）/血肉山羊 flag11（:21068-21095）/蜥蜴 flag12
   *    （:21096-21123）三族同构 5×14 椭圆尘环——phase=2π·rand;n 环 0..4 × k 点
   *    0..13:dir=UnitY 旋 (k·2π/14+phase) 再 ×0.2n,出生=Center+dir·(50,20) 椭圆,
   *    速度=dir+(0,gravDir·4),noGravity、scale=1+rand·0.8、fadeIn=rand·2。尘型:
   *    独角兽 SelectRandom(176,177,179)/山羊 6/蜥蜴 31。armor shader（:21064/
   *    :21092/:21120 obj.shader=GetSecondaryShader(cMount)）★BJ707-G29 接线尘池
   *    dyeVid=mountDyeVid()（miscDyes[3];圣诞坦克支原版无 shader 不接）。
   *  · 圣诞坦克 flag10（:21124-21169）：15×（尘4 色(250,230,230,150) α100 s1.5 +
   *    尘6 α20 vy−1 偶数序 fadeIn=rand·2）@盒下带 (x−34,y+h−16) 102×32 + gore
   *    61|62×3（Next(61,63) 右开=61..62,G20 注「61-63」勘正）@（心−16/x−36/右+4,
   *    Bottom−22）,速度 ×0.1 −v×(0.1,0.05) + NextVector2Circular(1,1)×0.5。
   *  音=SoundEngine.PlaySound(16)（cue16 Double_Jump,瓶族跳同款——坐骑跳旧整缺
   *  =「哑跳」零反馈,玩家可感知面）。 */
  private mountJumpBurstFx(game: GameHooks, opt: 'Unicorn' | 'Santank' | 'WallOfFleshGoat' | 'Basilisk'): void {
    game.playSfxWav?.('Double_Jump', 1, this.cx, this.cy);
    const D = game.vanillaDust;
    const gd = this.gravDir;
    if (opt === 'Santank') {
      const num20 = gd === 1 ? this.h : 0;   // 倒挂锚 0（:21127-21131）
      for (let i = 0; i < 15; i++) {
        const d4 = D ? D.spawn(this.x - 34, this.y + num20 - 16, 102, 32, 4,
          -this.vx * 0.5, this.vy * 0.5, 100, { r: 250, g: 230, b: 230, a: 150 }, 1.5) : null;
        if (d4) { d4.vx = d4.vx * 0.5 - this.vx * 0.1; d4.vy = d4.vy * 0.5 - this.vy * 0.3; d4.noGravity = true; }
        const d6 = D ? D.spawn(this.x - 34, this.y + num20 - 16, 102, 32, 6,
          -this.vx * 0.5, this.vy * 0.5, 20, null, 1.5) : null;
        if (d6) { d6.vy -= 1; if (i % 2 === 0) d6.fadeIn = Math.random() * 2; }
      }
      const gy = this.y + this.h - 22;   // Bottom.Y − 22（:21148）
      for (let i = 0; i < 3; i++) {
        const gx = i === 0 ? this.x + this.w / 2 - 16 : i === 1 ? this.x - 36 : this.x + this.w + 4;
        const g = GorePiece.newGore(61 + Math.floor(Math.random() * 2), gx, gy, -this.vx, -this.vy);
        if (g) {
          const ca = Math.random() * Math.PI * 2, cr = Math.random() * 0.5;   // NextVector2Circular(1,1)×0.5
          g.vx = g.vx * 0.1 - this.vx * 0.1 + Math.cos(ca) * cr;
          g.vy = g.vy * 0.1 - this.vy * 0.05 + Math.sin(ca) * cr;
        }
      }
      return;
    }
    const type = opt === 'Unicorn' ? [176, 177, 179][Math.floor(Math.random() * 3)]!
      : opt === 'WallOfFleshGoat' ? 6 : 31;
    const phase = Math.random() * Math.PI * 2;   // num12/num14/num17 = 2π·NextFloat
    const mDyeVid = this.mountDyeVid();          // :21064/:21092/:21120 shader=cMount（环外取一次,零掷）
    for (let n = 0; n < 5; n++) {
      for (let k = 0; k < 14; k++) {
        const d = D ? D.spawn(this.cx, this.cy, 0, 0, type) : null;
        if (!d) continue;
        const ang = k * (Math.PI * 2) / 14 + phase;
        const dx = -Math.sin(ang) * 0.2 * n, dy = Math.cos(ang) * 0.2 * n;   // UnitY.RotatedBy ×(0.2n)
        d.x = this.cx + dx * 50; d.y = this.cy + dy * 20;                     // + dir·(50,20) 椭圆
        d.vx = dx; d.vy = dy + gd * 4;                                       // dir + (0, gravDir·4)
        d.noGravity = true;
        d.scale = 1 + Math.random() * 0.8;
        d.fadeIn = Math.random() * 2;
        d.dyeVid = mDyeVid;                     // ★BJ707-G29 :21064/:21092/:21120
      }
    }
  }

  /** Player.GrappleMovement（Player.cs:22338-22483）1:1。
   *  在移动积分（moveAndCollide）前调用——覆写 vx/vy 为锚点牵引速度；
   *  跳键沿释放全部钩爪（:22463-22478）；无锚（grappling[0] 空）整段早退（:22340-22342） */
  grappleMovement(game: GameHooks): void {
    const eqG = this.equipStats;   // ★IIIII250 快照(5 直读→1)
    if (!this.grappling[0]) {                              // :22340-22342
      this.goingDownWithGrapple = false;
      if (!this.inputJump) this.grappleReleaseJump = true; // :22479-22482 releaseJump 维护
      return;
    }
    // :22347-22347 坐骑挂不得（MountID.Sets.CanUseHooks）——本仓矿车无钩门，骑乘即否
    // :22351-22362 滑翔帧位（wingFrame/canCarpet/rocketFrame 复位 + RefreshMovementAbilities）
    if (eqG.wing) this.wingTime = eqG.wing.time;  // wingTime = wingTimeMax
    // SW-RB6b 2026-09-07：原版 RefreshMovementAbilities()（:22833）无 onGround 门——
    // 挂钩中每 tick 回满多段跳（RefreshDoubleJumps :23053 对每个 hasJumpOption 无条件置真，
    // 全原版仅 :20932 落地跳/:22914 收爪/:23049 本处/:26259 滑轮/:26682 滑轮 5 个调用点）。
    // 旧 onGround 门 ⇒ 半空挂钩收爪后多段跳不可用（云瓶挂墙释放跳后无法二段跳）。
    this.extraJumps = [...eqG.jumpOpts];                      // RefreshMovementAbilities→RefreshDoubleJumps
    this.canCarpet = true;
    this.fallStartY = null;                                // fallStart = position.Y/16 → 免摔伤
    // :22367-22373 轨道钩 403 贴轨上车（Minecart.GetOnTrack）——403 仅由右键轨道
    //   发射路径产生，物品族不产出，本仓等价空集（见 grappleHooks.ts 403 条注释）
    // :22353-22356 释放跳跃门（覆写速度【前】的原速度判定——顺序敏感）：
    //   flag = velocity.Length() < 2；flag2 = wet && |vy|<0.02（水面静止）
    const slow = Math.hypot(this.vx, this.vy) < 2;         // :22353-22354
    const wetStill = this.inWater && Math.abs(this.vy) < 0.02; // :22355-22356 flag2
    const [pvx, pvy, dir] = this.getGrapplingForces();
    if (pvy > 0) this.goingDownWithGrapple = true;         // :22381-22383
    else this.goingDownWithGrapple = false;
    const pullingDown = pvy > 0 && this.vy === 0;          // :22385 flag3
    this.vx = pvx;                                         // :22386-22387
    this.vy = pvy;
    // :22394-22434 轨道钩上车段（type 403）——同上空集
    // :22436-22445 ChangeDir（itemAnimation==0 时按牵引方向转身）
    if (this.itemAnimTicks <= 0 && this.useTime <= 0) {    // itemAnimation == 0（窗代理含 useTime）
      if (this.vx === 0 && dir !== 0) this.facing = dir;   // :22438-22441 preferredDirection
      if (this.vx > 0) this.facing = 1;                    // :22442-22445
      if (this.vx < 0) this.facing = -1;
    }
    // :22899-22926 跳键沿 → 释放全部钩爪；速度低（<2）/水面静止/非下拉时附带跳跃
    if (this.inputJump) {
      if (this.grappleReleaseJump) {
        let canJump = wetStill || slow;                    // :22903 flag4 = flag2 || flag
        if (this.inputDown) canJump = false;               // :22905-22907 controlDown 否决
        if (pullingDown && !this.inputUp) canJump = false; // :22908-22910 下拉贴地且未按上
        if (canJump) {
          this.vy = -PLAYER_JUMP_SPEED * this.gravDir;     // :22905 velocity.Y = -jumpSpeed
          // X2② oldStyleParkour 半跳（1457 :22906）：jump = (oldStyleParkour ?
          // jumpHeight/2 : jumpHeight)。jumpHeight 是 static int（:2495）⇒ C# 整除
          // 15/2=7（非浮点 7.5）——跑酷指南下抓钩释放跳只保一半悬停 tick，
          // 初速 -jumpSpeed 两档同值不减。
          this.jumpHold = eqG.oldStyleParkour === true
            ? Math.floor(PLAYER_JUMP_TICKS / 2)            // int 除法：(int)(15/2)=7
            : PLAYER_JUMP_TICKS;
          this.grappleReleaseJump = false;
        } else {
          this.vy += 0.01;                                 // :22911 velocity.Y += 0.01
          this.grappleReleaseJump = false;
        }
        // SW-RB6b 2026-09-07：原版 RefreshDoubleJumps()（:22914）在收爪 if/else 两支【外】
        // 无条件调用（canJump 上下皆回满）——旧 onGround 门=半空收爪丢二段跳。
        this.extraJumps = [...eqG.jumpOpts];   // RefreshDoubleJumps（:22914）
        this.removeAllGrapplingHooks();                    // :22915
      }
    } else {
      this.grappleReleaseJump = true;                      // :22924-22925
    }
    void game;
  }

  /** Player.GetGrapplingForces（Player.cs:22484-22577）1:1：
   *  返回 [速度X, 速度Y, 期望朝向(0=无)]。锚点质心 - 玩家中心 → 距离缩放到牵引上限 */
  private getGrapplingForces(): [number, number, number] {
    let sumX = 0;
    let sumY = 0;
    let preferredDir = 0;
    let n = 0;
    const gravDir = this.gravDir;
    for (let i = 0; i < this.grapCount; i++) {             // :22490
      const g = this.grappling[i]!;
      if (g.ai0 !== GRAPPLE_LATCH) continue;               // :22493 ai[0] != 2 跳过
      if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) continue; // :22494 HasNaNs
      sumX += g.cx;                                        // :22496-22497 锚点中心累加
      sumY += g.cy;
      n++;
      if (g.projType === 446) {
        // :22500-22512 反重力钩：目标 = 锚点 + normalize(玩家中心 - 锚点 + 输入×100) × 200
        let vx = (this.inputX || 0), vy = ((this.inputDown ? 1 : 0) - (this.inputUp ? 1 : 0)) * gravDir;
        const vl = Math.hypot(vx, vy);
        if (vl > 0) { vx /= vl; vy /= vl; }                // :22505-22507 归一
        vx *= 100; vy *= 100;
        let dx = this.cx - g.cx + vx, dy = this.cy - g.cy + vy;
        const dl = Math.hypot(dx, dy);
        dx = dl > 0 ? dx / dl : 0; dy = dl > 0 ? dy / dl : 0;
        if (dx === 0 && dy === 0) { dx = 0; dy = -1; }     // :22509-22511 NaN → -UnitY
        sumX += dx * 200;                                  // :22513-22515 num4 = 200
        sumY += dy * 200;
      } else if (g.projType === 652) {
        // :22517-22536 静态钩：目标 = 玩家中心 + 绳向×输入投影×6（不拉，只沿绳自由位移）
        let ix = (this.inputX || 0), iy = ((this.inputDown ? 1 : 0) - (this.inputUp ? 1 : 0)) * gravDir;
        const il = Math.hypot(ix, iy);
        if (il > 0) { ix /= il; iy /= il; }                // :22518 SafeNormalize
        const ax = g.cx - this.cx, ay = g.cy - this.cy;    // :22519 vector3 = 锚 - 玩家
        const al = Math.hypot(ax, ay);
        const ux = al > 0 ? ax / al : 0, uy = al > 0 ? ay / al : 0; // :22520 vector4
        let projX = 0, projY = 0;
        if (il > 0) {                                      // :22523-22525 value = vector4 × Dot(vector4, 输入)
          const d = ux * ix + uy * iy;
          projX = ux * d; projY = uy * d;
        }
        let mult = 6;                                      // :22527 num5 = 6
        if ((projX * ax + projY * ay) < 0 && al >= 600) mult = 0; // :22529-22531 背离且绳尽 → 0
        sumX += -ax + projX * mult;                        // :22533-22534
        sumY += -ay + projY * mult;
      } else if (g.projType === 865) {
        // :22538-22546 松鼠钩：目标 = 锚点 - 绳向×28（垂吊在锚下 28px，绳向按 90° 吸附）
        const a = g.rot - Math.PI / 2;
        let ux = Math.cos(a), uy = Math.sin(a);            // :22538 ToRotationVector2
        const ul = Math.hypot(ux, uy) || 1;
        ux /= ul; uy /= ul;
        sumX += -ux * 28;                                  // :22540-22541 vector6 = -vector5 × 28
        sumY += -uy * 28;
        if (ux !== 0) preferredDir = ux > 0 ? 1 : -1;      // :22543-22545 preferredPlayerDirection
      }
    }
    if (n === 0) return [this.vx, this.vy, 0];             // :22548-22552 num3==0 → 保留原速度
    const tx = sumX / n;                                   // :22554-22555 质心
    const ty = sumY / n;
    let pvx = tx - this.cx;                                // :22558-22560 vector7 = fromPosition
    let pvy = ty - this.cy;
    const len = Math.hypot(pvx, pvy);                      // :22561-22562 num8
    let maxSpeed = 11;                                     // :23016 num9 = 11
    const first = this.grappling[0]!;
    if (first.projType === 315) maxSpeed = 14;             // :23019-23021 蝙蝠钩
    if (first.projType === 73 || first.projType === 74) maxSpeed = 12.5; // 1457 :23022-23025
                                                                         //   双钩蓝/红(DualHook) 11 → 12.5
    if (first.projType === 487) maxSpeed = 12;             // :23026-23028 荆棘钩
    if (first.projType >= 646 && first.projType <= 649) maxSpeed = 16; // :23029-23034 月亮钩
    const k = len > maxSpeed ? maxSpeed / len : 1;         // :22572-22574 num10
    pvx *= k;
    pvy *= k;
    return [pvx, pvy, preferredDir];
  }

  /** Player.DoQueenSlimeHookTeleport（Player.cs:22486-22506;1457 :22924-22938）1:1：
   *  150 步 × 12px 朝目标步进（TileCollision 碰撞贴墙停），落点即传送。
   *  AI_007 挂墙回调（Projectile.cs:49876-49878 type==935;1457 :53704） */
  doQueenSlimeHookTeleport(targetX: number, targetY: number, game: GameHooks): void {
    const steps = 150;                                     // :22488 num = 150
    // ★BJ108 登记债①清偿（2026-09-17）：Teleport(vector,10)（:22499→:22505/:22937）→
    // StartCameraTransitionForPlayerTeleport(oldPos,0.1,0)（style10 走 :37747 全 style
    // 汇聚,delay=0;style10 仅免 RemoveAllGrapplingHooks :37702——钩保持挂墙,本仓
    // 不摘钩本就同相）。oldPos = 步进行走前 position（Teleport :37705 vector=position）
    const tpOldX = this.x, tpOldY = this.y;
    let px = this.x;
    let py = this.y;
    let sx = 0;
    let sy = 0;
    const body = {
      x: px, y: py, w: this.w, h: this.h, vx: 0, vy: 0,
      onGround: false, hitWall: false, hitHead: false,
    };
    for (let i = 0; i < steps; i++) {
      const dx = targetX - (px + this.w / 2);
      const dy = targetY - (py + this.h / 2);
      const dl = Math.hypot(dx, dy) || 1;
      sx = (dx / dl) * 12;                                 // :22494 DirectionTo × 12
      sy = (dy / dl) * 12;
      body.x = px; body.y = py; body.vx = sx; body.vy = sy;
      moveAndCollide(body, game.world, sx, sy);            // :22496 TileCollision
      px = body.x;
      py = body.y;
    }
    this.x = px;
    this.y = py;
    this.vx = 0;
    this.vy = 0;
    // ★BJ714-A（R16-P1 面1）:骑矿车随迁（Teleport style10 :22937→:37698-37780
    //  零 Dismount 同门——不随迁=下一拍被车「玩家坐骑位回写段」锁回=道具废）
    game.migrateMinecartOnTeleport?.();
    game.startCameraTransitionForPlayerTeleport?.(tpOldX, tpOldY);   // ★BJ108 债①（Teleport(vector,10)→:37747,delay=0）
    game.spawnBurst?.(this.cx, this.cy, '#58B8E8', 14, 3, -Math.PI / 2, Math.PI, { life: 24 });
  }

  /** 狂卷之舌 DoT 分块累加器（专家 50 HP/s，:18905-18910 lifeRegen-100；
   *  :19136-19148 -600 阈值 → 每 6t 弹 HurtLifeRegen(5)） */
  private tongueDotAcc = 0;

  /** Player.WOFTongue（Player.cs:21993-22056）1:1：
   *  gross=惊恐 37（见到墙）、tongued=狂卷之舌 38（高于地狱层/绕到墙后）。
   *  - 墙嘴前沿 140px 带且 gross → 每帧 Hurt(50×难度缩放)，强制击退（:22003-22007）
   *  - 未 gross 且身处地狱视野内 → 上 37 + 播 Zombie_10 尖啸（:22009-22012）
   *  - gross 且（高于地狱层 或 绕到墙背后 40px）→ 上 38（:22014-22027）
   *  - tongued：封道具/钩爪（:22032-22041）+ 专家 50 HP/s DoT（:18905-18910）+
   *    舌距中心 >3000px（:22044-22048）或墙抵世界边（:22049-22052）→ KillMe */
  private wofTongue(game: GameHooks, world: import('../world/World').World, dt: number): void {
    if (this.dead) return;
    // :21993-21997 Main.wofNPCIndex<0 / 墙 inactive → 直接返回
    //（enemies 可选调用：测试假宿主常缺该钩子）
    const wall = ((game.enemies?.() ?? []) as Enemy[]).find((n) => !n.dead && n.vanillaId === 113) ?? null;
    if (!wall) {
      // ★墙亡/离场：vanilla 立即摘 37（UpdateBuffs :11072-11076 DelBuff）与 38
      //   （tongued 段 flag22 :27687-27694 DelBuff）——曾自然到期（≤10t 残留），
      //   残留期 TheTongue 穿墙旁路仍生效=无墙仍相位穿行（2026-09-02 评审补）
      this.buffs.remove(BuffType.TheTongue);
      this.buffs.remove(BuffType.Horrified);
      return;
    }
    // UpdateBuffs :10578-10587：buff 37 在且墙在场 → gross + buffTime 钳 10（apply 续期）；
    // 墙不在场则不续期自然消散（原版 DelBuff）
    const gross = this.buffs.has(BuffType.Horrified);
    if (gross) this.buffs.apply(BuffType.Horrified, 10 / 60);
    const tongued = this.buffs.has(BuffType.TheTongue);
    // :22000-22002 墙嘴前沿 X（墙朝东再退 96px）
    let mouth = wall.x + 40;
    if (wall.facing > 0) mouth -= 96;
    // :22460-22465 墙嘴前沿 140px 带且 gross → 每帧 Hurt(50×难度缩放)。★F3（四轮
    // 蓝队）：原版此处即 !quiet Hurt 面（:22464 `Hurt(LegacyDefault(),
    // GetAttackDamage_ScaledByDifficulty(50f), npc.direction)`，:22462 先置
    // noKnockback=false 无视钴盾族免击退）→ 改走通用漏斗：防御/难度系数/endurance/
    // 黑带·腰布·克脑闪避族/msg117 全随漏斗生效；受击语音与本地飘字由漏斗单点承载
    // （删旧手补 playHurtVoice/addDamageNumber 双发源；飘字值=damagePreview 预演回填、
    // 颜色照旧）。归因照旧 'npc' 名（漏斗不传 attacker ⇒ banner/反射面不适用——
    // 本站不在 Update_NPCCollision 反射循环内，构造性边界同弹幕族）。
    // 固定推离（:37908-37912 击退段=velocity.X=4.5×direction/velocity.Y=-3.5）漏斗
    // 无从表达，保持受理后直写（noKnockback=false 语义天然成立）；fallStart 重置同段。
    if (this.x + this.w > mouth && this.x < mouth + 140 && gross) {
      const dmg = getAttackDamageScaledByDifficulty(50, wall.difficulty);
      this.lastDamageCause = { kind: 'npc', name: 'Wall of Flesh' };
      const dealt = this.envHurtThroughFunnel(game, dmg, wall.cx, wall.cy, -1,
        this.damagePreview(dmg), playerHurtFloatColor(false));
      if (dealt > 0) {
        // :22005 noKnockback=false——舌击无视钴盾族免击退，沿墙推进方向弹开。
        // 原版走 Hurt(hitDirection=墙 direction)（:22007）→ 击退段 = 固定
        // velocity.X = 4.5×direction / velocity.Y = -3.5（Player.cs:37910-37912）
        this.vx = (wall.facing >= 0 ? 1 : -1) * 4.5;
        this.vy = -3.5;
        this.fallStartY = this.y;   // fallStart 重置（:37912 同段）
      }
    }
    // :22009-22012 未 gross 且身处地狱带（>h-250 格）且在墙嘴 ±MaxWorldViewSize.X
    //  （Main.cs:736-740 = 1920）视野内 → 上 37 + Zombie_10 尖啸
    if (!gross && this.y > (world.h - 250) * TILE
      && this.x > mouth - 1920 && this.x < mouth + 1920) {
      this.buffs.apply(BuffType.Horrified, 10 / 60);
      // PlaySound(4,…,10)=NPC_Killed_10(case4 死音库;曾误 Zombie_10,终审修)
      game.playSfxWav?.('NPC_Killed_10', 1, wall.cx, wall.cy);
    }
    // :22014-22027 gross 且 高于地狱层 / 绕到墙背后（越过墙中心 40px）→ 上 38
    // ★地狱层 = UnderworldLayer(h-200)——曾用 world.lavaLine(生成参数岩浆线,
    // 比 h-200 浅 ~170 格)致玩家爬到洞穴层就被上舌(bossAI_wof 头注同款坑,终审修)
    if (gross) {
      if (this.y < (world.h - 200) * TILE) {
        this.buffs.apply(BuffType.TheTongue, 10 / 60);
      }
      if (wall.facing < 0) {
        if (this.cx > wall.cx + 40) this.buffs.apply(BuffType.TheTongue, 10 / 60);
      } else if (this.cx < wall.cx - 40) {
        this.buffs.apply(BuffType.TheTongue, 10 / 60);
      }
    }
    // :22032 以下 tongued 效果实装：
    //  ① controlUseItem/controlHook=false——道具门禁由 Game.updateUse 读本 buff（钩爪
    //    系统未实装，aiStyle 7 弹 Kill 段 :22036-22041 登记不适用）
    if (!tongued) return;
    //  ② 专家 DoT（:18905-18910 lifeRegen-100 = 50 HP/s，正回复清零 + 爬坡计时清零；
    //     :19136-19148 -600 阈值分块 HurtLifeRegen(5) → 每 0.1s 弹 5，无视无敌帧/防御）
    if (mainExpertMode(world)) {
      this.lifeRegenTime = 0;
      this.tongueDotAcc += 50 * dt;
      let chunk = 0;
      while (this.tongueDotAcc >= 5) { this.tongueDotAcc -= 5; chunk += 5; }
      if (chunk > 0) {
        this.hp = Math.max(0, this.hp - chunk);
        game.addDamageNumber(this.cx, this.y, chunk, false, '#FF3C46', true);
        // :19144-19149 statLife<=0 → KillMe(ByOther(12)) WasLicked
        if (this.hp <= 0) this.lastDamageCause = { kind: 'tongued' };
      }
    }
    //  ③ 舌距 >3000px（:22044-22048）/ 墙抵世界两侧（:22049-22052）→ KillMe(1000)
    if (Math.hypot(wall.cx - this.cx, wall.cy - this.cy) > 3000
      || wall.x < 608 || wall.x > (world.w - 38) * TILE) {
      // KillMe 绕无敌帧直死（原版 ByOther(11)/(12) 文案包未移植 → npc 归因）
      this.lastDamageCause = { kind: 'npc', name: 'Wall of Flesh' };
      this.iframes = 0;
      this.hp = 0;
    }
    //  ④ 拖拽（Player.cs:27623-27662，tongued 时速度全覆写,原版在 Update 移动段）：
    //     目标 = 墙 Center.X + direction×200（行进方向前缘 200px）、Y = 墙 Center.Y;
    //     速度 = (目标−玩家) 钳长 ≤ 11(经典)/lerp(11→22, 墙速/5)(专家);
    //     距离 ≤ 拖速 → 速度直取 + 解除舌头(gross 未消则下帧重新上舌,原版拔河语义)。
    //     ★速度的【消费端】在 fixedUpdate 运动段：tongued 分支 position += velocity
    //     穿墙（:28384-28388 绕过瓦片碰撞,2026-09-02 补）——速度覆写+无碰撞位移
    //     两半合起来才是原版拉回语义,缺一半=开放地带能拽回、遇地形卡死。
    //     ★曾整个缺失——绕到肉山背后只会持续吃伤害,不会被舌头拽回前面(2026-09-01)
    const front = wall.cx + (wall.facing >= 0 ? 1 : -1) * 200;
    const ddx = front - this.cx, ddy = wall.cy - this.cy;
    const dist = Math.hypot(ddx, ddy);
    let drag = 11;
    if (mainExpertMode(world)) {
      drag = 11 + (22 - 11) * Math.min(1, Math.hypot(wall.vx, wall.vy) / 5);
    }
    if (dist > drag) {
      this.vx = ddx * (drag / dist);
      this.vy = ddy * (drag / dist);
    } else {
      this.vx = ddx; this.vy = ddy;
      this.buffs.remove(BuffType.TheTongue);
    }
  }

  /** breathCDMax（Player.cs:3693-3710，属性每次读重算）：基础 7 tick；
   *  芦苇管（手持 186 且非挥舞中）×2；accDivingHelm ×6 → 7/14/42 */
  get breathCDMax(): number {
    let n = 7;
    if (this.hasBreathingReed && this.itemAnimTicks === 0) n *= 2;
    if (this.equipStats.divingHelm) n *= 6;
    return n;
  }
  /** hasBreathingReed（1458 Player.cs:4120-4134）：选中快捷栏格为 186 芦苇管；
   *  mount.Active 时查 MountID.Sets.DontHoldItems{55 Rat,56 Bat,61 Pixie}
   *  （MountID.cs:29,Factory.CreateBoolSet）——三个乘骑态宠物不认芦苇管换气。
   *  ★终零波批（2026-09-01）实装——旧注"本作无坐骑，省略"系陈位（Mounts 域
   *  已在轨,MOUNT_SETS.DontHoldItems 表随 vanilla-mounts.json 提供） */
  get hasBreathingReed(): boolean {
    const held = this.inv.heldItem();
    if (!held) return false;
    const d = ITEM_DEFS[held.id];
    const vid = d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
    if (vid !== 186) return false;
    if (this.ridingMount) {
      return !(MOUNT_SETS.DontHoldItems?.[this.mount.type] ?? false);
    }
    return true;
  }

  // 输入状态由 Game 每帧写入
  inputX = 0;
  inputJump = false;
  /** 独立左/右键电平（Game 输入合成段与 inputX 同源喂入）——inputX = 右−左
   *  合值丢"双按"信息,Wisp 211 控制键偏移按原版 if(controlLeft)/else if(
   *  controlRight) 序消费（Projectile.cs:60779-60782,同按左优先）→ 宠物 AI
   *  OwnerRef 经此读原键面。 spectator 冻结段同归零（Game 侧） */
  inputLeft = false;
  inputRight = false;
  /** Player.maxRunSpeed（常规跑速上限 stat，:25695 base 3 × moveSpeed 乘区；
   *  水中/蜂蜜等场景折扣不在此列——矿车撞击速比等按 stat 口径消费）。
   *  1457: moveSpeed 乘区含 strongestMoveSpeedDebuff（Update :26205 maxRunSpeed *=
   *  moveSpeed，debuff 已折入） */
  get maxRunSpeed(): number {
    return PLAYER_WALK_MAX * this.buffs.moveSpeedMult * this.equipStats.moveMult
      * Math.min(this.buffs.strongestMoveSpeedDebuff, this.shieldRaised ? 1 / 3 : 1);
  }

  /** Player.CCed（1457 Player.cs:6291/:21738 等消费；1456 为 frozen||webbed||stoned
   *  内联三元，1457 收敛为属性，语义同）——硬控三件套。
   *  ★SW-FX52（2026-09-16）：补 shimmering 腿——原版 buff 353 处理段同时置
   *  `shimmering = true; frozen = true`（Player.cs:11872-11876），即微光化态在原版
   *  经 frozen 字段恒入 CCed（:3361-3372）⇒ ItemCheck 早退（:42924-42930）、
   *  QuickGrapple 早退（:6292-6294）、controlUseItem/controlUseTile 清零（:25432-25442）
   *  全部生效=微光态不可用物品/不可发射钩爪。本仓 buff 353 只写 shimmering 字段
   *  （不挂 Frozen buff）,旧三件套缺微光腿 ⇒ 微光下沉中左键/E 键照发钩爪,牵引把
   *  穿落中的玩家拖进岩层（用户实报「卡进地里」）。 */
  get cced(): boolean {
    return this.buffs.has(BuffType.Frozen) || this.buffs.has(BuffType.Webbed)
      || this.buffs.has(BuffType.Stoned) || this.shimmering;
  }
  // ---- 钩爪（AI_007 + GrappleMovement 1:1）----
  /** 本 tick 锚点表（原版 player.grappling[10] + grapCount，Player.cs:2608/:2828）：
   *  GrappleProj 挂墙/锚定段每帧登记（Projectile.cs:49797-49801/:49954-49957），
   *  grappleMovement 消费后于本 tick 尾重建（原版 Player.cs:27991-27992 清表） */
  grappling: (GrappleProj | null)[] = new Array(10).fill(null);
  grapCount = 0;
  /** 本玩家全部在役钩爪弹体（= 原版扫 Main.projectile[owner].aiStyle==7，
   *  Player.cs:5984/:33113；发射登记 / Kill 反注册） */
  grappleProjs: GrappleProj[] = [];
  /** 跳键沿（原版 releaseJump，GrappleMovement :22463-22477 消费）——松跳置 true */
  grappleReleaseJump = true;
  /** 钩爪下垂中（原版 GoingDownWithGrapple :22381-22383，fall damage 门 :27778） */
  goingDownWithGrapple = false;
  /** 钩爪锚格黑名单（UpdateBlacklistedTilesForGrappling，Player.cs:2896-2926）：
   *  packed = x * 100000 + y */
  private grappleBlacklist = new Set<number>();
  /** 多段跳剩余段（原版 RefreshDoubleJumps：落地时重置为 equipStats.jumpOpts 拷贝） */
  extraJumps: string[] = [];
  /** 当前进行中的多段跳型（isPerformingJump_* 等价；落地清除——上升尾迹分支门） */
  performingJump: string | null = null;
  /** ★BJ704-G19：vanilla Player.sandStorm 字段等价（G16 债③窗口勘正后的完整门：
   *  沙暴瓶跳 ∧ 上升 ∧ 无翼无坐骑 ∧ 瓶在身 ∧ jump 窗口 ∧ 非挂爪/上绳）——
   *  Renderer 腿 0/身 6 视觉与 fixedUpdateBody 尾 4tick 自翻的消费位（每拍移动相头持久）。 */
  sandStormVisual = false;
  /** ★BJ534：isPerformingJump_DownDash（Player.cs:2643）——重锤符文 5465 下砸态机。
   *  触发 = JumpMovement :20895-20898 flag13 支（空中+按住↓+跳键沿+装备 5465+非骑乘），
   *  vy=16×gravDir（:20958-20961）；落地拍结算面见摔伤段 deadCellsGroundPound；
   *  复位 = RefreshDoubleJumps 落地段(:23053-23055)/骑乘(:24799-24801)/死亡(:17040)。 */
  isDownDashing = false;
  /** downDashTime（Player.cs:2645）：下砸态逐 tick 递增、非下砸清零（:24803-24810）——
   *  落地冲击波蓄力档判据 32×downDashTime>300（:29014 ⇔ ≥10t）。仓内递增位次 =
   *  跳跃面/碰撞之后、摔伤结算之前（原版 :24803 先于 :26945 触发、落地拍次拍结算；
   *  本仓单拍折叠后该位次使落地拍读数 ≡ 原版次拍读数,蓄力阈值零漂移）。 */
  downDashTime = 0;
  /** 跑靴脚步声冷却（hermesStepSound.IntendedCooldown=9 :35519） */
  runSoundDelay = 0;
  /** 火箭靴 1:1（Player.cs:2612/26548-26628）：rocketTime 剩余脉冲次数（max=7）/
   *  rocketDelay 推力脉冲倒计时（每次触发=10t 加速段）/ rocketDelay2 焰间隔
   *  （1 档 30 / 2+ 档 15）/ canRocket 门（vy>-jumpSpeed 才可启动）/ rocketRelease
   *  需松跳重触发 */
  rocketTime = 0;
  rocketDelay = 0;
  rocketDelay2 = 0;
  canRocket = false;
  rocketRelease = false;
  /** WingMovement（Player.cs:21746-21966）1:1：飞行中每 tick 垂直运动。
   *  wings==4（UFO 之翼）+TryingToHoverUp 独占分支（消耗 ×2）；
   *  其余按翼型参数表（num 恒减/num2 下落减速/num5 上升微推/num4 jumpSpeed 区间
   *  系数/num3 上升帽系数），上升帽 = -jumpSpeed×num3（1.5~4.5 按翼型）；
   *  hover 下落无左右移时 wingTime 消耗减半（×0.5） */
  /** 翅膀喷尘/喷射音（WingAirVisuals :30284-30547 + WingFrame 各分支尘 :29031+/
   *  :29337+/:29845+/:29730+/:30025+ + 滑翔段尘 :26914+/:26958+ + 47/49/50 三函数
   *  :30063-30270）。原版 Main.rand.Next(a,b)=[a,b)；本批 Dust 池缺省（无 Game）
   *  时静默跳过。 */
  /** SpawnFastRunParticles（:19935-20027 1:1）：跑靴快速奔跑尘+脚步声。
   *  门（:19697/:19731）：|vx| > (accRunSpeed+maxRunSpeed)/2 && vy==0 && 无坐骑。
   *  ★调用点必须嵌在爬坡分支（else-if B）内——分支入口门 |vx|<accRunSpeed 与尘门
   *  中点构成互斥带；裸装 accRun==maxRun → 带空永不触发（勿再提升为全局判定）。
   *  脚步声（:20357-20361,函数头先于尘分支=翅靴/五靴型全分支播放）：hermesStepSound
   *  三件套由 PlayerFrame 每帧重置（:36229-36231 默认 SoundType=17=Sounds/Run/
   *  Cooldown=9;legs==140 → :36243-36245 覆写 SoundType=2 Style=24=Item_24/Cooldown=6
   *  ——legs 贴图索引 140 全库唯一持有者=Djinn's Curse 3770,本仓 statOfInternal().ls
   *  ===140 同源判定）。分派:LegacySoundPlayer case17 :857=SoundRun(:236 Load
   *  "Sounds/Run")随机 pitch ±0.01 微抖不建模;case 2=Item 族 style=变体号。
   *  分支（按装备 vid 授予 :36285）：4874 泰拉闪耀=火尘6 / 3200·3990 航行靴=尘253×4 /
   *  1579 冰靴=雪尘76×2 / 4055 沙丘行者=沙尘32 / 3993 仙灵火花=仙尘61族×2 /
   *  其余跑靴（赫尔墨斯 54/闪电 405/幽灵 898/霜花 1862 等）=白尘16。
   *  ★2026-10-17 Run 翻案修刀:旧实现误键 'Item_17'+误嵌普通支（仅无 bootFx 靴型
   *  播声）——SoundType 17 是 Run 非 Item_17（两键同数字纯属巧合,sfx-wiring
   *  DEAD_SLOTS 曾据零 'Run' 键消费误判死素材,同日翻案）。鞋染料 shader 不建模。 */
  private spawnFastRunParticles(game: GameHooks, maxRun: number, accRun: number): void {
    if (this.ridingMount || this.vy !== 0) return;
    if (Math.abs(this.vx) <= (accRun + maxRun) / 2) return;
    // 脚步声（:20357-20361 头部位，先于尘分支）：runSoundDelay==0 ∧ vy==0（上双门已保）
    const legsArmorId = this.inv.displayArmor()[2];   // displayArmor() 返回内部 id 数组（dollEquipFromInv 同源）
    const legsSt = legsArmorId != null ? statOfInternal(legsArmorId) : null;
    const djinnLegs = legsSt != null && legsSt.s === 'l' && legsSt.ls === 140;
    if (this.runSoundDelay <= 0) {
      game.playSfxFiles?.(djinnLegs ? ['Item_24'] : ['Run'], 1, this.cx, this.cy);
      this.runSoundDelay = djinnLegs ? 6 : 9;
    }
    const gd = this.gravDir;
    const off = gd === -1 ? -this.h : 0;
    const feetY = this.y + this.h + off;
    const D = game.vanillaDust;
    const eq0 = this.equipStats;
    const fx = eq0.bootFx;
    // cShoe 鞋染料（:9355-9369）——尘带 dyeVid，渲染端跑 SM2 染料字节码（63 pass
    // 全技术 1:1：ArmorColored 主色族静态缓存，彩虹/凝胶/反射等动态族逐帧真跑）
    const shoeDye = eq0.bootDyeVid;
    // 翅靴分支（:19947 if 链首，优先于五靴型）：wings==3 或 时装槽 668（Red's
    // Leggings → vanityRocketBoots=6 :12667-12670）→ 尘186×2（翅膀染料色 cWings）
    const vanity668 = this.inv.armor.slice(10).some((it) => {
      if (!it) return false;
      const d = ITEM_DEFS[it.id];
      return d ? (d.vid ?? -1) === 668 : false;
    });
    if (eq0.wing?.logic === 3 || vanity668) {
      const wingDye = this.wingDyeVid();
      for (let n = 0; n < 2; n++) {
        const d = D ? D.spawn(this.x - 4, feetY, this.w + 8, 4, 186,
          -this.vx * 0.5, this.vy * 0.5, 50, null, 1.5) : null;
        if (d) { d.vx *= n === 0 ? 0.025 : 0.2; d.vy *= n === 0 ? 0.025 : 0.2; d.dyeVid = wingDye; }
      }
      return;
    }
    if (fx === 'hellfire') {
      const d = D ? D.spawn(this.x - 4, feetY, this.w + 8, 4, 6, -this.vx * 0.5, this.vy * 0.5, 50, null, 2) : null;
      if (d) { d.dyeVid = shoeDye; d.vx *= 0.2; d.vy = -1.5 - Math.random() * 0.5; d.fadeIn = 0.5; d.noGravity = true; }
    } else if (fx === 'sail') {
      for (let i = 0; i < 4; i++) {
        const d = D ? D.spawn(this.x - 4, this.y, this.w + 8, this.h, 253, -this.vx * 0.5, this.vy * 0.5, 100, null, 1.5) : null;
        if (!d) continue;
        d.dyeVid = shoeDye;
        d.noGravity = true;
        d.vx *= 0.2; d.vy *= 0.2;
        // ★O3 漏网核销(2026-09-02)：1457 Player.cs:20385 = Next(-5,3)（8 值域 [−5..2]）
        //   整型掷——曾 `rand*8-5|0` 向零截断（−5 端永不可取、负侧整桶上移），改 floor 形
        d.scale += (Math.floor(Math.random() * 8) - 5) * 0.1;
      }
    } else if (fx === 'desert') {
      const d = D ? D.spawn(this.x - 4, feetY, this.w + 8, 4, 32, -this.vx * 0.5, this.vy * 0.5, 0, null, 1) : null;
      if (d) { d.dyeVid = shoeDye; d.vx *= 0.2; d.vy = d.vy * 0.2 - gd * 2; }
    } else if (fx === 'cold') {
      for (let j = 0; j < 2; j++) {
        const d = D ? D.spawn(j === 0 ? this.x : this.x + this.w / 2, this.y + this.h,
          this.w / 2, 6, 76, 0, 0, 0, null, 1.35) : null;
        if (!d) continue;
        d.dyeVid = shoeDye;
        d.scale *= 1 + (20 + Math.random() * 20 | 0) * 0.01;
        d.noGravity = true; d.noLight = true;
        d.vx *= 0.001; d.vy = d.vy * 0.001 - 0.003;
      }
    } else if (fx === 'fairy') {
      const type = [61, 61, 61, 242, 64, 63][Math.random() * 6 | 0];   // NextFromList
      for (let k = 1; k < 3; k++) {
        const d = D ? D.spawn(this.x - 4, feetY, this.w + 8, 4, type, -this.vx * 0.5, this.vy * 0.5,
          0, null, k === 2 ? 1 : 1.5) : null;
        if (!d) continue;
        d.dyeVid = shoeDye;
        d.vx *= 1.5; d.vy *= 1.5;
        if (k === 2) { d.x += d.vx; d.y += d.vy; }
        d.noGravity = true; d.noLightEmittance = true;
      }
    } else {
      // 普通跑靴：尘16（脚步声已在函数头 :20357 全分支播放,勿在此重复）
      const d = D ? D.spawn(this.x - 4, feetY, this.w + 8, 4, 16, -this.vx * 0.5, this.vy * 0.5, 50, null, 1.5) : null;
      if (d) { d.dyeVid = shoeDye; d.vx *= 0.2; d.vy *= 0.2; }
    }
  }

  /** DoubleJumpVisuals（:21615-21745 1:1）：多段跳上升期持续尾迹——沙暴瓶 3×尘124/
   *  tick + 每 3t gore220-223 沙云（scale 随平台段剩余放大）、云瓶/屁瓶 脚底 1×尘16/188、
   *  暴雪瓶 三段 8×尘76、航行瓶 1-2×尘253。门=performingJump 置位 + 上升中
   *（vy*gravDir<0；航行瓶 <1 放宽）。Game 侧 Update :26445 每帧调用 */
  doubleJumpVisuals(game: GameHooks): void {
    const opt = this.performingJump;
    if (!opt) return;
    const gd = this.gravDir;
    const rising = gd === 1 ? this.vy < 0 : this.vy > 0;
    const D = game.vanillaDust;
    const mk = (x: number, y: number, w: number, h: number, type: number,
      alpha = 0, scale = 1, vx = 0, vy = 0) => D ? D.spawn(x, y, w, h, type, vx, vy, alpha, null, scale) : null;
    if (opt === 'Cloud' && rising) {
      // :21617-21626 尘16（脚底 w+8×4 条带）
      const cy = gd === 1 ? this.y + this.h : this.y - 6;
      const d = mk(this.x - 4, cy, this.w + 8, 4, 16, 100, 1.5, -this.vx * 0.5, this.vy * 0.5);
      if (d) { d.vx = d.vx * 0.5 - this.vx * 0.1; d.vy = d.vy * 0.5 - this.vy * 0.3; }
    } else if (opt === 'Sandstorm' && rising) {
      // :21628-21649 尘124×3 + gore220-223 每 miscCounter%3（沙云随平台段缩放）
      const cy = gd === 1 ? this.y + this.h : -6;
      const num4 = (this.jumpHold / 75 + 1) / 2;
      for (let i = 0; i < 3; i++) {
        const d = mk(this.x, this.y + (cy === -6 ? -3 : this.h / 2), this.w, 32, 124, 150, 1 * num4,
          this.vx * 0.3, this.vy * 0.3);
        if (d) { d.vx *= 0.5 * num4; d.vy *= 0.5 * num4; d.fadeIn = 1.5 * num4; }
      }
      if (this.miscCounter % 3 === 0) {
        // :21656 gore Y = position.Y + num3/2（num3=height→h/2；倒挂 num3=-6→-3——
        //  ★SW-FX34 矫正旧恒 h/2）
        const g = GorePiece.newGore(220 + (Math.random() * 3 | 0),
          this.x + this.w / 2 - 18, gd === 1 ? this.y + this.h / 2 : this.y - 3,
          -this.vx, -this.vy, num4, false);
        if (g) { g.vx = this.vx * 0.3 * num4; g.vy = this.vy * 0.3 * num4; g.alpha = 100; }
      }
    } else if (opt === 'Fart' && rising) {
      // :21651-21661 尘188（同云瓶式再 ×0.5）
      const cy = gd === 1 ? this.y + this.h : this.y - 6;
      const d = mk(this.x - 4, cy, this.w + 8, 4, 188, 100, 1.5, -this.vx * 0.5, this.vy * 0.5);
      if (d) { d.vx = d.vx * 0.5 - this.vx * 0.1; d.vy = d.vy * 0.5 - this.vy * 0.3; d.vx *= 0.5; d.vy *= 0.5; }
    } else if (opt === 'Unicorn' && rising) {
      // ★SW-FX34 补整支（:22119-22126 独角兽上升尾迹：全身盒尘 176/177/179 随机,
      //  velocity 清零 + noGravity + scale 0.5+NextFloat×0.8 + fadeIn 1+NextFloat×2；
      //  原文无 gravDir 分臂=gd 无关。仓 Dust 池无独立 fadeIn 面=备案。
      //  :22126 obj.shader=GetSecondaryShader(cMount)——★BJ707-G29 接线尘池 dyeVid）
      const type = [176, 177, 179][Math.random() * 3 | 0];
      const d = mk(this.x, this.y, this.w, this.h, type);
      if (d) { d.vx = 0; d.vy = 0; d.noGravity = true; d.scale = 0.5 + Math.random() * 0.8; d.fadeIn = 1 + Math.random() * 2; d.dyeVid = this.mountDyeVid(); }
    } else if (opt === 'Blizzard' && rising) {
      // :21701-21743 三段尘76：2 粒慢散 + 3 粒顺速 + 3 粒逆速（noGravity/noLight）
      const by = gd === 1 ? this.y + this.h - 6 : this.y + 6;
      for (let k = 0; k < 2; k++) {
        const d = mk(this.x, by, this.w, 12, 76, 0, 1, this.vx * 0.3, this.vy * 0.3);
        if (!d) continue;
                d.vx *= 0.1; d.vy *= 0.1;
        if (k === 0) { d.vx += this.vx * 0.03; d.vy += this.vy * 0.03; }
        else { d.vx -= this.vx * 0.03; d.vy -= this.vy * 0.03; }
        d.vx -= this.vx * 0.1; d.vy -= this.vy * 0.1;
        d.noGravity = true; d.noLight = true;
      }
      for (let l = 0; l < 3; l++) {
        const d = mk(this.x, by, this.w, 12, 76, 0, 1, this.vx * 0.3, this.vy * 0.3);
        if (!d) continue;
                d.fadeIn = 1.5; d.vx = d.vx * 0.6 + this.vx * 0.8; d.vy = d.vy * 0.6 + this.vy * 0.8;
        d.noGravity = true; d.noLight = true;
      }
      for (let m = 0; m < 3; m++) {
        const d = mk(this.x, by, this.w, 12, 76, 0, 1, this.vx * 0.3, this.vy * 0.3);
        if (!d) continue;
                d.fadeIn = 1.5; d.vx = d.vx * 0.6 - this.vx * 0.8; d.vy = d.vy * 0.6 - this.vy * 0.8;
        d.noGravity = true; d.noLight = true;
      }
    } else if (opt === 'Sail' && (gd === 1 ? this.vy < 1 : this.vy > 1)) {
      // :22128 门 `gd==1&&vy<1 || gd==-1&&vy>1`（★SW-FX34 矫正倒挂臂符号——旧 >-1
      //  系 gd=1 形的算术镜像误写,原文对倒挂同样比较 +1）
      // :21671-21700 尘253：平台段中 2 粒（顺速 −v/5）否则 1 粒（scale×0.8）
      const n = this.jumpHold > 0 ? 2 : 1;
      const by = gd === 1 ? this.y + this.h - 6 : this.y + 6;
      for (let j = 0; j < n; j++) {
        const d = mk(this.x, by, this.w, 12, 253, 100, 1.5, this.vx * 0.3, this.vy * 0.3);
        if (!d) continue;
                // ★O3 漏网核销(2026-09-02)：1457 Player.cs:22139 = Next(-5,3)（8 值域
                //   [−5..2]）——同 :5857 改 floor 形
                d.scale += (Math.floor(Math.random() * 8) - 5) * 0.1;
        if (this.jumpHold <= 0) d.scale *= 0.8;
        else { d.vx -= this.vx / 5; d.vy -= this.vy / 5; }
        d.noGravity = true;
      }
    }
  }

  private wingFx(game: GameHooks, wings: number, wingsLogic: number,
    flying: boolean, glide: boolean, justSwitched: boolean): void {
    const D = game.vanillaDust;
    const dir = this.facing;
    const cx = this.cx, top = this.y, half = this.h / 2;
    const cxOff = (back: number, front: number) => cx + (dir === 1 ? back : front);
    const Next = (a: number, b: number) => a + (Math.random() * (b - a) | 0);
    const dirF = () => Math.random() * 2 - 1;   // NextFloatDirection
    const airOk = this.vy !== 0 && !this.ridingMount
      && !this.grappleProjs.some((g) => g.latched)
      && !(this.inWater && !!this.equipStats.flipper);   // ShouldDrawWings :30271
    const mk = (x: number, y: number, w: number, h: number, type: number,
      alpha = 0, scale = 1, color: import('../fx/VanillaDust').DustColor | null = null,
      vx = 0, vy = 0) => D ? D.spawn(x, y, w, h, type, vx, vy, alpha, color, scale) : null;

    // ---- WingAirVisuals（flag19 时每 tick；:30284-30547）----
    if (flying) {
      if (wings === 10 && Next(0, 2) === 0) {
        const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 76, 50, 0.6);
        if (d) { d.fadeIn = 1.1; d.noGravity = true; d.noLight = true; d.vx *= 0.3; d.vy *= 0.3; }
      }
      if (wings === 34 && Next(0, 2) === 0) {
        const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 261, 50, 0.6);
        if (d) { d.fadeIn = 1.1; d.noGravity = true; d.noLight = true; d.noLightEmittance = wingsLogic !== wings; d.vx *= 0.3; d.vy *= 0.3; }
      }
      if (wings === 51 && Next(0, 2) === 0) {
        const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 261, 50, 0.6, { r: 230, g: 130, b: 55, a: 255 });
        if (d) { d.fadeIn = 1.1; d.noGravity = true; d.noLight = true; d.noLightEmittance = wingsLogic !== wings; d.vx *= 0.3; d.vy *= 0.3; }
      }
      if (wings === 9 && Next(0, 2) === 0) {
        const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 6, 200, 2);
        if (d) { d.noGravity = true; d.vx *= 0.3; d.vy *= 0.3; }
      }
      if (wings === 6 && Next(0, 4) === 0) {   // :30343-30351（落体尘）
        const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 55, 200);
        if (d) { d.vx *= 0.3; d.vy *= 0.3; }
      }
      if (wings === 5 && Next(0, 3) === 0) {   // :30364-30371
        const d = mk(cx + (dir === 1 ? -30 : 6), top, 18, this.h, 58, 255, 1.2);
        if (d) { d.vx *= 0.3; d.vy *= 0.3; }
      }
      if (wings === 26) {                       // :30374-30400（每 tick 主尘 + 1/2 副尘）
        let d = mk(cx + (dir === 1 ? -30 : 6), top, 18, this.h, 217, 100, 1.4);
        if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx; d.vy = d.vy / 4 - this.vy; }
        if (Next(0, 2) === 0) {
          d = mk(cx + (dir === 1 ? 12 : -24), top, 12, this.h / 2, 217, 100, 1.4);
          if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx; d.vy = d.vy / 4 - this.vy; }
        }
      }
      if (wings === 37) {                       // :30409-30452
        let d = mk(cx + (dir === 1 ? -30 : 6), top, 24, this.h, 31, 100);
        if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx / 2; d.vy = d.vy / 4 - this.vy / 2; }
        if (Next(0, 3) === 0) {
          d = mk(cx + (dir === 1 ? 12 : -24), top, 16, this.h / 2, 31, 100);
          if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx / 2; d.vy = d.vy / 4 - this.vy / 2; }
        }
      }
      if (wings === 29 && Next(0, 3) === 0) {   // :30454-30467
        const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 6, 100, 2.4);
        if (d) { d.noGravity = true; d.vx *= 0.3; d.vy *= 0.3; if (Next(0, 10) === 0) d.fadeIn = 2; }
      }
      if (wings === 31) {                       // :30469-30546（86/240 四门）
        if (Next(0, 6) === 0) {
          const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 86);
          if (d) { d.noGravity = true; d.fadeIn = 1.2; d.vx *= 0.2; d.vy *= 0.2; d.noLight = true; }
        }
        if (Next(0, 3) === 0) {
          const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 240, 200, 1.2);
          if (d) { d.noGravity = true; d.vx *= 0.2; d.vy *= 0.2; }
        }
        if (Next(0, 2) === 0) {
          if (Next(0, 6) === 0) {
            const d = mk(cx + (dir === 1 ? 12 : -24), top, 12, this.h / 2, 86);
            if (d) { d.noGravity = true; d.fadeIn = 1.2; d.vx *= 0.2; d.vy *= 0.2; d.noLight = true; }
          }
          if (Next(0, 3) === 0) {
            const d = mk(cx + (dir === 1 ? 12 : -24), top, 12, this.h / 2, 240, 200, 1.2);
            if (d) { d.noGravity = true; d.vx *= 0.2; d.vy *= 0.2; }
          }
        }
      }
    }

    // ---- Wings 4 妖精翅喷射（:29031-29086，分支内每 tick）----
    if (wings === 4 && (flying || this.jumpHold > 0)) {
      if (--this.rocketDelay2 <= 0) {
        game.playSfxAt?.('rocketJet', this.x, this.y);
        this.rocketDelay2 = 60;
      }
      const num = this.inputUp ? 4 : 2;         // TryingToHoverUp 档（:29037）
      for (let i = 0; i < num; i++) {
        let x = cx + (dir > 0 ? -26 : 16);      // :29046-29052
        let y = top + this.h - 18;
        if (i === 1 || i === 3) { x = cx + (dir > 0 ? -20 : 8); y += 6; }
        if (i > 1) y += this.vy;
        const d = mk(x, y, 8, 8, 6, 100, 1.75);
        if (d) {
          d.noGravity = true;
          d.vx *= 0.1;
          d.vy = d.vy * 1 + 2 - this.vy * 0.3;
          if (num === 4) d.vy += 6;
        }
      }
    }

    // ---- Wings 30 日耀喷射双环（:29337-29377，flag2 门）----
    const flag2 = flying || this.jumpHold > 0 || (this.vy !== 0 && this.inputJump);
    if (wings === 30 && flag2) {
      for (let j = 0; j < 4; j++) {
        if (Next(0, 4) === 0) {
          const a = -0.74539816 + Math.PI / 8 * j + 0.03 * j;
          const px = cx + Math.cos(a) * (-dir * 20), py = this.cy + Math.sin(a) * 20;
          const d = mk(cx, this.cy, 0, 0, 229, 100, 0.8);
          if (d) {
            const dx = px - cx, dy = py - this.cy, len = Math.hypot(dx, dy) || 1;
            d.x = px; d.y = py;
            d.vx = dx / len * 2; d.vy = dy / len * 2;
            d.noGravity = true; d.noLightEmittance = wingsLogic !== wings;
            if (Next(0, 10) !== 0) { d.followPlayer = true; d.followOnce = true; } else d.fadeIn = 0.5;
          }
        }
      }
      for (let k = 0; k < 4; k++) {
        if (Next(0, 8) === 0) {
          const a = -0.7053982 + Math.PI / 8 * k + 0.03 * k;
          let px = cx + Math.cos(a) * (dir * 20) - dir * 16;
          let py = this.cy + Math.sin(a) * 24;
          const d = mk(cx, this.cy, 0, 0, 229, 100, 0.5);
          if (d) {
            const dx = px - (cx - dir * 16), dy = py - this.cy, len = Math.hypot(dx, dy) || 1;
            d.vx = dx / len * 2; d.vy = dy / len * 2;
            px += d.vx * 5; py += d.vy * 5;
            d.x = px; d.y = py;
            d.noGravity = true; d.noLightEmittance = wingsLogic !== wings;
            if (Next(0, 10) !== 0) { d.followPlayer = true; d.followOnce = true; } else d.fadeIn = 0.5;
          }
        }
      }
    }

    // ---- Wings 33 星尘眼色尘（:29845-29904，flag9 门）----
    const flag9 = flag2;
    if (wings === 33 && flag9) {
      const eye = this.appearance?.eyeColor ?? { r: 105, g: 90, b: 75 };
      const mx = Math.max(eye.r, eye.g, eye.b), mn = Math.min(eye.r, eye.g, eye.b);
      let hue = 0;   // rgbToHsl(...).X
      if (mx !== mn) {
        const dlt = mx - mn;
        hue = mx === eye.r ? ((eye.g - eye.b) / dlt + (eye.g < eye.b ? 6 : 0))
          : mx === eye.g ? (eye.b - eye.r) / dlt + 2
            : (eye.r - eye.g) / dlt + 4;
        hue /= 6;
      }
      const [cr, cg, cb] = hslToRgb(hue, 1, 0.5);
      const num32 = dir !== 1 ? -4 : 0;
      for (let m = 0; m < 2; m++) {
        const d = mk(this.x + (m === 0 ? num32 : this.w + num32), this.y + this.h,
          this.w, this.h, 182, 127, 1, { r: cr, g: cg, b: cb, a: 255 }, this.vx, this.vy);
        if (!d) break;
        d.noGravity = true; d.fadeIn = 1; d.noLight = true; d.noLightEmittance = wingsLogic !== wings;
        d.followPlayer = true; d.followOnce = true;
        d.vx = d.vx + (m === 0 ? -2 : 2) - this.vx * 0.3;
        d.vy = d.vy + 2 - this.vy * 0.3;
        // CloneDust（:29889-29897）：scale/fadeIn ×0.65、白化
        const c = mk(d.x, d.y, 0, 0, 182, 127, d.scale * 0.65, { r: 255, g: 255, b: 255, a: 255 });
        if (c) {
          c.noGravity = true; c.noLight = true; c.noLightEmittance = wingsLogic !== wings;
          c.fadeIn = d.fadeIn * 0.65; c.vx = d.vx; c.vy = d.vy;
          c.followPlayer = true; c.followOnce = true;
        }
      }
    }

    // ---- Wings 45 星璇悬浮板（:29707-29740 门内：喷射音 + 星尘）----
    if (wings === 45 && airOk) {
      if (this.wingTime > 0 && --this.rocketDelay2 <= 0) {
        game.playSfxAt?.('starboardJet', this.x, this.y);
        this.rocketDelay2 = 30;
      }
      if (Next(0, 8) === 0) {
        // CenteredRectangle(Bottom−(0,10), 40×24)（:29735）
        const d = mk(cx - 20, this.y + this.h - 10 - 12, 40, 24, 43, 0, 0.2);
        if (d) { d.fadeIn = 0.4; d.vx = (d.vx + this.vx) * 0.35; d.vy = (d.vy + this.vy) * 0.35; }
      }
    }

    // ---- Wings 47/49/50 十一帧族三函数（:30063-30270）----
    if ((wings === 47 || wings === 49 || wings === 50) && this.wingFrame !== 0) {
      const numTbl: Record<number, number> = { 1: 0, 2: 0, 3: 0.5, 4: 1, 5: 1, 6: 0.5, 7: 0, 8: -0.5, 9: -1, 10: -0.5 };
      const num = numTbl[this.wingFrame] ?? 0;
      if (wings === 47) {   // ChickenBonesWingDust :30063-30141
        const col = { r: 50, g: 120, b: 255, a: 200 };
        if (justSwitched && this.wingFrame === 6 && this.inputJump) {
          for (let i = 0; i < 8; i++) {
            const vx0 = (i < 4 ? -25 : -5) * dir, vy0 = 20;
            const d = mk(cx - 5 + vx0, this.cy - 5 + vy0, 10, 10, 264, 0, 1.1 * (1 + 0.25 * dirF()), col);
            if (d) {
              const xo = d.x - cx - vx0;
              d.y += xo * 2;
              d.noGravity = true; d.noLight = true; d.noLightEmittance = wingsLogic !== wings;
              d.vx = xo * 0.5; d.vy = 3;
              d.followPlayer = true; d.followOnce = true;
            }
          }
        }
        if (Next(0, 6) === 0) {
          const d = mk(cx - 15 - 30 * dir, this.cy - 25, 30, 50, 264, 0, 1.1 * (1 + 0.25 * dirF()), col);
          if (d) {
            d.noGravity = true; d.noLight = true; d.noLightEmittance = wingsLogic !== wings;
            d.vx = d.vx * 0.1 + this.vx * 0.3 * Math.random();
            d.vy = d.vy * 0.1 + num * 2 + this.vy * 0.3 * Math.random();
            d.y += num * 2;
            d.followPlayer = true; d.followOnce = true;
          }
        }
      }
      if (wings === 49) {   // HeroicisWingDust :30143-30204（光照门 z=Remap(亮度,0.2,0.4,0,1)
        //                 :30166-30168——rgbToHsl(Lighting.GetColor).Z，亮度=(max+min)/2/255）
        const col = { r: 255, g: 255, b: 255, a: 200 };
        // z 门（:30166-30173）：暗处抑制尘爆/环境尘（z >= NextFloat 才放行）
        const lc = game.lightAt?.(cx, this.cy);
        const lightZ = lc
          ? (Math.max(lc[0], lc[1], lc[2]) + Math.min(lc[0], lc[1], lc[2])) / 2 / 255
          : 0;
        const z = Math.min(1, Math.max(0, (lightZ - 0.2) / 0.2));   // Utils.Remap
        if (justSwitched && this.wingFrame === 6 && this.inputJump) {
          for (let i = 0; i < 8; i++) {
            if (z < Math.random()) continue;            // :30175 !(z < NextFloat())
            const vx0 = (i < 4 ? -20 : -10) * dir, vy0 = 15;
            const d = mk(cx - 2.5 + vx0, this.cy - 2.5 + vy0, 5, 5, 264, 0, 0.6 * (1 + 0.45 * dirF()), col);
            if (d) {
              const xo = d.x - cx - vx0;
              d.y += xo * 2;
              d.noGravity = true; d.noLight = true; d.noLightEmittance = wingsLogic !== wings;
              d.vx = xo * 0.5; d.vy = 2;
              d.followPlayer = true; d.followOnce = true;
            }
          }
        }
        if (Next(0, 6) === 0 && z >= Math.random()) {   // :30192 z >= NextFloat()
          const d = mk(cx - 15 - 30 * dir, this.cy - 20, 30, 40, 264, 0, 0.6 * (1 + 0.45 * dirF()), col);
          if (d) {
            d.noGravity = true; d.noLight = true; d.noLightEmittance = wingsLogic !== wings;
            d.vx = d.vx * 0.1 + this.vx * 0.3 * Math.random();
            d.vy = d.vy * 0.1 + num * 1.5 + this.vy * 0.3 * Math.random();
            d.y += num * 2;
            d.followPlayer = true; d.followOnce = true;
          }
        }
      }
      if (wings === 50) {   // KazzymodusWingDust :30205-30270
        const col = { r: 50, g: 120, b: 255, a: 200 };
        if (justSwitched && this.wingFrame === 1) {
          const y0 = -20;
          for (let i = 0; i < 16; i++) {
            const nx = (i < 4 ? -25 : -5) * dir;
            const d = mk(cx + nx - 15, this.cy + y0 - 5, 30, 10, 6, 100, 1.2, col);
            if (d) { d.vx = dirF() * 5; d.vy = dirF() * 2; d.fadeIn = 1.2; d.noGravity = true; d.noLightEmittance = wingsLogic !== wings; }
          }
        }
        if (Next(0, 4) === 0) {
          const flag = Next(0, 2) === 0;
          const nx = dir * (flag ? -30 : 10);
          const y2 = this.wingFrame === 1 ? -25 : -5;
          const d = mk(cx + nx - 12.5, this.cy + y2 - 10, 25, 20, 6, 100, 1.2, col);
          if (d) { d.vx = dirF() * 2.5; d.vy = Math.random() * 3; d.fadeIn = 1.2; d.noGravity = true; d.noLightEmittance = wingsLogic !== wings; }
        }
      }
    }

    // ---- Wings 29 下落烟（generic 尾段 :30025-30040，!flap && vy≠0）----
    if (wings === 29 && !flying && this.jumpHold === 0 && this.vy !== 0 && Next(0, 5) === 0) {
      const d = mk(cxOff(-40, 4), top + half - 15, 30, 30, 6, 100, 2.4);
      if (d) { d.noGravity = true; d.vx *= 0.3; d.vy *= 0.3; if (Next(0, 10) === 0) d.fadeIn = 2; }
    }

    // ---- 滑翔段尘 26/37（:26914-26970，glide 门内）----
    if (glide) {
      if (wings === 26) {
        let d = mk(cx + (dir === 1 ? -30 : 6), top, 18, this.h, 217, 100, 1.4);
        if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx; d.vy = d.vy / 4 - this.vy; }
        if (Next(0, 2) === 0) {
          d = mk(cx + (dir === 1 ? 12 : -24), top, 12, this.h / 2, 217, 100, 1.4);
          if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx; d.vy = d.vy / 4 - this.vy; }
        }
      }
      if (wings === 37) {
        let d = mk(cx + (dir === 1 ? -30 : 6), top, 24, this.h, 31, 100);
        if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx / 2; d.vy = d.vy / 4 - this.vy / 2; }
        if (Next(0, 3) === 0) {
          d = mk(cx + (dir === 1 ? 12 : -24), top, 16, this.h / 2, 31, 100);
          if (d) { d.noGravity = true; d.noLight = true; d.vx = d.vx / 4 - this.vx / 2; d.vy = d.vy / 4 - this.vy / 2; }
        }
      }
    }

    // ---- Wings 28 空中微光（:29071-29076：Bottom AddLight(0.3,0.1,0.4)）----
    if (wings === 28 && airOk && wingsLogic === wings) {
      game.addLightAt?.(cx, this.y + this.h, 0.3, 0.1, 0.4);
    }
  }

  // ===================== 悬停锁存（★SW-FX14 2026-09-10 HoverControl 接线） =====================
  // 原版 Player.cs:1801/:1803 tryKeepingHoveringDown/Up——Click 档（设置
  // "悬停控制：点按"，Player.Settings.HoverControl :357 缺省 Hold）下按/松 ↑↓
  // 切换锁存，翅膀悬停免持续按键。本仓翼链此前按 Hold 语义直读 inputUp/Down
  // （:4967 旧注"保持态近似省略"登记债 + 贴墙靴 /10 档"无翼悬停升键建模"登记债
  // 同刀清偿）。

  /** tryKeepingHoveringDown（Player.cs:1801） */
  tryKeepingHoveringDown = false;
  /** tryKeepingHoveringUp（Player.cs:1803） */
  tryKeepingHoveringUp = false;
  /** 上/下键末拍快照（≙ releaseUp/releaseDown :1739/:1763——UpdateControlHolds
   *  :29312-29335 语义 releaseUp = !controlUp；press 边沿 = controlUp && releaseUp，
   *  即「本拍按住 ∧ 上拍末未按住」。输入在本方法前已定格（冻/惑清零与换位 quirk
   *  均在其上），快照即拍末值，语义与原版「Update 尾部结算」等价） */
  private prevTickUpHeld = false;
  private prevTickDownHeld = false;

  /** TryingToHoverUp（Player.cs:3908-3915）：controlUp || tryKeepingHoveringUp */
  get tryingToHoverUp(): boolean { return this.inputUp || this.tryKeepingHoveringUp; }
  /** TryingToHoverDown（Player.cs:3920-3927）：controlDown || tryKeepingHoveringDown */
  get tryingToHoverDown(): boolean { return this.inputDown || this.tryKeepingHoveringDown; }

  /** 锁存更新（Player.cs:25452-25484 1:1，调用点在移动积分前 = 原版 Update 中段
   *  同位——vy 为上一拍碰撞末速）：↓ press 边沿 = 关上锁存否则开下锁存（互斥档
   *  :25452-25461）；↑ press 边沿 = 关下锁存否则开上锁存（:25463-25472）；
   *  vy==0 双清（:25475-25478）；Hold 档双清（:25479-25484）= 缺省档锁存永不驻留，
   *  行为与接线前逐位相同（守恒保证）。主体=模块级纯函数 hoverLatchStep（测试直调） */
  private updateHoverLatch(): void {
    const next = hoverLatchStep(
      { up: this.tryKeepingHoveringUp, down: this.tryKeepingHoveringDown },
      this.inputUp, this.inputDown, this.prevTickUpHeld, this.prevTickDownHeld,
      this.vy === 0, options.data.hoverControl === 'hold',
    );
    this.tryKeepingHoveringUp = next.up;
    this.tryKeepingHoveringDown = next.down;
    this.prevTickDownHeld = this.inputDown;   // UpdateControlHolds :29312-29335 末拍快照
    this.prevTickUpHeld = this.inputUp;
  }

  private wingMovement(wings: number, hoverDown: boolean, JS: number, wingMax: number): void {
    // ★SW-FX34：补 WingMovement 反重力半边（Player.cs:22207-22380 每段 `* gravDir`
    //  + else 镜像臂,1457 逐值）。gd=1 臂数值逐位恒等（0.2*1===0.2 等）。
    const gd = this.gravDir === -1 ? -1 : 1;
    if (wings === 4 && this.tryingToHoverUp) {
      // wingsLogic 4 + TryingToHoverUp（:22205——★SW-FX14 换取值门：原版读
      //  TryingToHoverUp = controlUp ∨ tryKeepingHoveringUp（:3908-3915））
      this.vy -= 0.2 * gd;                                 // :22205
      if (gd === 1) {                                      // :22207-22219
        if (this.vy > 0) this.vy -= 1;
        else if (this.vy > -JS) this.vy -= 0.2;
        if (this.vy < -JS * 3) this.vy = -JS * 3;
      } else {                                             // :22220-22231
        if (this.vy < 0) this.vy += 1;
        else if (this.vy < JS) this.vy += 0.2;
        if (this.vy > JS * 3) this.vy = JS * 3;
      }
      this.wingTime -= 2;
    } else {
      // 参数表（:21785-21789 基准 + 翼型覆盖 :21790-21921）
      let num = 0.1, num2 = 0.5, num3 = 1.5, num4 = 0.5, num5 = 0.1;
      if (wings === 26) { num2 = 0.75; num5 = 0.15; num4 = 1; num3 = 2.5; num = 0.125; }
      if (wings === 8 || wings === 11 || wings === 24 || wings === 27 || wings === 22) num3 = 1.66;
      if (wings === 21 || wings === 12 || wings === 20 || wings === 23) num3 = 1.805;
      if (wings === 37) { num2 = 0.75; num5 = 0.15; num4 = 1; num3 = 2.5; num = 0.125; }
      if (wings === 44 || wings === 45) {
        // 星尘/星旋悬浮强化：±0.4 hover 推力（:21814-21904）
        if (wings === 44) { num2 = 0.85; num3 = 2.75; }
        else { num2 = 0.95; num3 = 4.5; }
        num5 = 0.15; num4 = 1; num = 0.125;
        if (this.tryingToHoverUp) {
          // TryingToHoverUp 附加推力（:22278/:22323——★SW-FX14 换取值门 :3908-3915）
          this.vy -= 0.4 * gd;                             // :22279/:22324
          if (gd === 1) {                                  // :22280-22292/:22325-22337
            if (this.vy > 0) this.vy -= 1;
            else if (this.vy > -JS) this.vy -= 0.2;
            if (this.vy < -JS * 3) this.vy = -JS * 3;
          } else {                                         // :22293-22304/:22338-22349
            if (this.vy < 0) this.vy += 1;
            else if (this.vy < JS) this.vy += 0.2;
            if (this.vy > JS * 3) this.vy = JS * 3;
          }
        }
        // （:22325/:22370 TryingToHoverDown && !controlJump 下沉分支在原版调用门
        //  flag19（要求 controlJump）下不可达——反编译证实为死分支，不移植）
      }
      if (wings === 29 || wings === 32) { num2 = 0.85; num5 = 0.15; num4 = 1; num3 = 3; num = 0.135; }
      if (wings === 30 || wings === 31) { num4 = 1; num3 = 2.45; if (!hoverDown) num = 0.15; }
      // 主体（:22339 `velocity.Y -= num * gravDir` + gd 分臂 :22340-22360）
      this.vy -= num * gd;
      if (gd === 1) {                                      // :22340-22348
        if (this.vy > 0) this.vy -= num2;
        else if (this.vy > -JS * num4) this.vy -= num5;
        if (this.vy < -JS * num3) this.vy = -JS * num3;
      } else {                                             // :22349-22360
        if (this.vy < 0) this.vy += num2;
        else if (this.vy < JS * num4) this.vy += num5;
        if (this.vy > JS * num3) this.vy = JS * num3;
      }
      // wingTime 消耗（:22361-22368）：hover 下落且无左右移 ×0.5
      const halfCost = (wings === 22 || wings === 28 || wings === 30 || wings === 31
        || wings === 37 || wings === 45) && hoverDown && this.inputX === 0;
      this.wingTime -= halfCost ? 0.5 : 1;
    }
    // ★BJ216 翱翔徽章无限飞行（WingMovement :22419-22422）：扇动消耗后
    //  `wingTime != 0f` 即回满 wingTimeMax——两支（喷气 -2 :22238 / hover ×0.5
    //  :22412 / 常规 -1 :22416）后同位,原版无湿态/悬浮/坐骑豁免。
    //  ★`!= 0f` 豁免quirk 1:1 保留：常规 -1 档从 0.5 半值下穿（→-0.5≠0）必回满,
    //  仅 hover ×0.5 档可精确触 0（装备切换期 wingTime 恰 0.5 时）——
    //  常驻飞行期每拍回满使下行走带不可达,护栏死支照抄。
    if (this.equipStats.empressBrooch && this.wingTime !== 0) this.wingTime = wingMax;
    this.fallStartY = null;
  }

  /** 恐慌项链受击加速计时（tick，原版 AddBuff(63,480)=8s，Hurt :38524） */
  panicTime = 0;
  /** 岩浆免疫剩余 tick（熔岩护身符族 lavaMax；离开岩浆回满） */
  lavaImmuneTicks = 0;
  /** 翅膀：剩余飞行 tick（float，hover 下落档 0.5/tick）+ 需松跳键重触发 */
  wingTime = 0;
  wingRelease = true;
  /** 飞毯触发门（CarpetMovement :21575：起跳后置 true，触发一次即 false） */
  canCarpet = true;
  /** 翅膀动画帧（WingFrame :29002-30045 逐款状态机；值域随款 0-13）+ 拍速计数 */
  wingFrame = 0;
  private wingFrameCounter = 0;
  /** 帧状态机 scratch（stepWingFrame 纯函数传参用，避免每 tick 分配） */
  private wingFrameScratch: WingFrameState = { frame: 0, counter: 0 };
  /** Main.miscCounter 近似（每 tick +1；翅膀 28 绘制帧 miscCounter/5%4 消费） */
  miscCounter = 0;
  /** miscCounterNormalized（Player.cs:3373 `miscCounter / 300f`;wrap :29529-29532
   *  → 定义域 [0,1),5s/60fps 一循环）。★BJ703-B D4 消费面=鞭彩虹相时钟
   *  （DrawWhip_RainbowWhip :37361 / 915 AI 尘 :48741——两处均读 theOwner 值）。
   *  本仓字段无 wrap（消费面全为 mod 式无感）——取模内联于此=域与原版逐值等价。 */
  get miscCounterNormalized(): number {
    return (this.miscCounter % 300) / 300;
  }
  /** 棉花糖烤串 968 烤制计时（player.miscTimer，Player.cs:1339，1456 :1244——
   *  仅 ItemCheck_ApplyHoldStyle 968 支 :50955-50994 消费；运行时态不入档，
   *  原版同；分支不进（换持/死亡/pulley）时冻结非清零） */
  miscTimer = 0;
  /** AdvancedShadows 位置历史环（≤31 项，翅膀 45 彩虹拖尾 :2901 消费；每 tick 尾插） */
  advancedShadows: Array<{ x: number; y: number }> = [];
  /** ★SW-FX36：社交残影 3 拍轮转（Player.cs:16699-16728 UpdateSocialShadow）——
   *  机械标尺网格淡出驱动（Main.cs:47152 `num = Distance(position, shadowPos[2])`,
   *  :47151 的 velocity.Length() 赋值被下一行覆盖 = 死码,真驱动是残影滞后距离）。
   *  shadowCount++ 后 1→[2]=[1] / 2→[1]=[0] / ≥3→[0]=position(+gfxOffY)+归零,
   *  稳态 shadowPos[2] 滞后 4~5 拍;原版调用相位 = Update 内重力段、本拍移动前
   *  （:24885,重力 ×num6 之后）⇒ 本仓 fixedUpdate 头（pre-movement）同相。
   *  传送/spawn 冲洗（ResetAdvancedShadows+:37768/:37929 3×UpdateSocialShadow）
   *  本仓传送链未建模 = 债 SW-FX36-D2。★SW-RB14d 勘误：冲洗只轮转写 [0]（count
   *  0→1→2→0）,[1]/[2] 保留冲洗前值 ⇒ 原版传送后 shadowPos[2] 仍是传送前采样,
   *  dist 巨大 → 网格钳 0.2 下档（"暗"即原版本相,旧注"原版即亮"系误判,无行为影响——
   *  本仓不冲洗的滞后窗与原版同量级,差 ≤1 拍）。 */
  shadowCount = 0;
  private spX = [0, 0, 0];
  private spY = [0, 0, 0];
  /** UpdateSocialShadow 一步（fixedUpdate 头每 tick 调,相位=原版 :24885） */
  updateSocialShadow(): void {
    this.shadowCount++;
    if (this.shadowCount === 1) {
      this.spX[2] = this.spX[1]; this.spY[2] = this.spY[1];
    } else if (this.shadowCount === 2) {
      this.spX[1] = this.spX[0]; this.spY[1] = this.spY[0];
    } else if (this.shadowCount >= 3) {
      this.shadowCount = 0;
      // ★BJ709-G34（G32-D3 清偿）:骑矿车时轨面 gfxOffY 并入采样——vanilla 单
      //  字段 gfxOffY 在 onTrack 拍被 TrackRotation 返回值整体覆写（Player.cs:
      //  28325）,仓内贴轨值存 cart.gfxOffY（Minecart fixedUpdate :485）→ 聚合=
      //  this.gfxOffY + cart.gfxOffY（三态互斥口径,PositionInWorld :10119 聚合
      //  同式;滚轴鞋贴轨仍写玩家字段=已含）。平轨 gfxOffY=0 零变化,坡面 Hell
      //  尾焰轨迹起点 Y 差（≤轨 gfxOffY）就此闭合。
      this.spX[0] = this.x;
      this.spY[0] = this.y + this.gfxOffY + (this.ridingCart && this.cart ? this.cart.gfxOffY : 0);
    }
  }
  /** 网格淡出驱动 = |position − shadowPos[2]|（Main.cs:47152 Vector2.Distance） */
  shadowLagDist(): number {
    return Math.hypot(this.x - this.spX[2], this.y - this.spY[2]);
  }
  /** shadowPos[2] 原值（顶左角系,采样含 gfxOffY——SW-FX36 域）。★BJ709-G32③ 消费=
   *  Hell 矿车尾焰轨迹起点（Mount.cs:5145 `value = shadowPos[2] - position +
   *  vector2`,Minecart.hellMinecartDust）;骑矿车时贴轨 gfxOffY 存 cart.gfxOffY
   *  → 采样已并入该轨面项（★BJ709-G34（G32-D3）窄修,见 updateSocialShadow 注） */
  socialShadowPos2(): { x: number; y: number } {
    return { x: this.spX[2], y: this.spY[2] };
  }
  /** itemFlame（LegacyPlayerRenderer :493-502：每 5t 重掷 7 组，仅翅膀 22 在用时更新；
   *  绘制端 :683-694 消费 (X, −Y)×0.5 偏移） */
  itemFlameCount = 5;
  itemFlamePos: Array<{ x: number; y: number }> = Array.from({ length: 7 }, () => ({ x: 0, y: 0 }));
  /** 上一 tick 左上角（原版 oldPosition；customData=Player 尘埃跟随差值用） */
  oldX = 0;
  oldY = 0;

  /** 飞毯滑翔剩余 tick（CarpetMovement carpetTime=300） */
  carpetTime = 0;
  /** ★BJ704-G5（R4-P2②）飞毯「本拍在展开」位（≙ 原版 carpetFrame >= 0，
   *  CarpetMovement :22027-22060 flag——飞毯带内（carpetTime>0∧按跳）置真,其余拍
   *  （松跳余油/空中卸毯/骑乘/挂钩）每拍先清（≙ :22062-22064 `if (!flag)
   *  carpetFrame = -1`）。毯姿门（Renderer 腿 0/身 6）的单一真源——旧渲染门
   *  `!onGround && carpetTime>0` 无按跳条件=松跳带余油/空中卸毯毯姿残留。 */
  carpetFlying = false;
  /** ★BJ717-A F2：上一拍毯展开位快照（≙ 原版横移加速消费位 :26813 读到的
   *  carpetFrame——run 参数链先于 CarpetMovement :26967=天然滞后一拍）。
   *  fixedUpdate 头部先于 carpetFlying 清零快照,运动参数链（横移 ×1.25/×1.5）
   *  读本字段；既有 carpetFlying 消费面（Renderer/毯姿门）不动。 */
  carpetFramePrev = false;
  /** 冲刺头部将撞墙探测（DashMovement :21132-21137）：身前 dir×半宽+2px 的
   *  头部点（gravDir 对应侧 h/2−2）与身体中点格任一 SolidOrSlopedTile → true
   *  （触发帧 velocity.X /= 2）。探测点恒在身体行内——对整砖随后必撞停（原版同），
   *  实际差异面 = 半砖/坡面（SolidOrSloped 含之） */
  dashWallAhead(dir: number): boolean {
    const st = this.lastStore;
    if (!st) return false;   // fixedUpdate 之前调用：无缓存世界视为不撞
    const wtx = Math.floor((this.cx + dir * (this.w / 2) + 2 * dir) / TILE);
    const hty = Math.floor((this.cy + this.gravDir * (-this.h / 2) + 2 * this.gravDir) / TILE);
    const solidOrSloped = (tx: number, ty: number): boolean =>
      st.inBounds(tx, ty) && !!st.flags[st.idx(tx, ty)] && st.isSolid(tx, ty);
    return solidOrSloped(wtx, hty) || solidOrSloped(wtx, Math.floor(this.cy / TILE));
  }
  /** 冲刺：双击窗口（dashTime ±15）/ 方向 / dashDelay 三态（0 就绪 / -1 滑行 / >0 冷却） */
  dashT = 0;
  dashDir = 1;
  dashDelay = 0;
  /** ★BJ705-G25 [g23-wing45-dash-friction] 清偿:自上一次冲刺发起起的 tick 数
   *  （Player.timeSinceLastDashStarted :1033——逐拍 +1 帽 300（Update :24794-98,
   *  位=miscCounter 邻位）;DoCommonDashHandle 两方向臂发起拍清 0（:21756/:21771,
   *  dash1-6 全档经此）。唯一消费者=WingAirLogicTweaks 尾段 :29557-59
   *  `wingsLogic==45 && >=60 → runSlowdown×6`（星盘掷后 1s 起空中摩擦 ×6）。 */
  timeSinceLastDashStarted = 0;
  /** 克苏鲁护盾冲撞判定窗（eocDash :20784，触发=15/命中=10）+ 已命中敌 id（eocHit） */
  eocDash = 0;
  eocHitId = -1;
  prevInputX = 0;
  /** ★MV3（2026-10-07）单键沿真值源——原版 releaseLeft/releaseRight（:27827-27845
   *  逐拍尾刷新 `releaseLeft = !controlLeft`，位次晚于 DashMovement 调用 :26691/
   *  :26958 ⇒ 消费面读到上一拍键态；死亡相 :17192-17193 同源刷新）≙ 上一拍
   *  control 电平。双击冲刺消费面 :21749 `controlRight && releaseRight` /
   *  :21764 `controlLeft && releaseLeft` = 单键按下沿——双键同按时另一键的按/放
   *  不产生本键沿（inputX 合值沿在该面丢真沿+发假沿=债⑤）。快照点与 prevInputX
   *  同址五站（死亡/坐睡/矿车×2/主尾拍），困惑轮换后快照（=原版轮换面）。 */
  prevInputLeft = false;
  prevInputRight = false;
  /** ★BJ-C8（R7-F1）绳键 8 拍再触发计时器（Player.cs:1823/:1825 leftTimer/rightTimer，
   *  尾写 :27847-27855）：松键拍置 7、持键逐拍递减、归 0 后持键回充 7——持键第 9 拍
   *  movement 相读到 0=再触发沿（flag12 侧挂 :26345-26354 / flag14 滑行 :26407 的
   *  `releaseLeft || leftTimer == 0` 后半支）。★字段初始化 7 而非原版 0：原版尾写
   *  首拍即置 7 ⇒ 一切可达态（存活≥1 拍）恒 7，0 只在「出生当拍即抓绳」不可达配置
   *  可见（R7-C8 登记差异）。死亡相不写计时器（UpdateDead :17195-17196 只刷
   *  releaseLeft/Right）——刷新站见 updateRopeKeyTimers。 */
  leftTimer = 7;
  rightTimer = 7;
  /** ★BJ508 Quick Dash 键电平（controlDash，TriggersSet.cs:825 `p.controlDash = Dash`
   *  ——PlayerInput KeyStatus["Dash"] 同源，Game 注入面写）。缺省无绑定 = 原版
   *  Keyboard 档（PlayerInput.cs:2069-2108 Redigit 预设无 Dash 条目），设置页自绑 */
  inputDash = false;
  /** releaseDash 闩（★BJ508）——置位臂 TriggersSet.cs:826 `p.releaseDash |=
   *  !p.controlDash`（Game 注入面逐拍同序执行）；清位臂 DoCommonDashHandle
   *  :21779-21782 `if (dashing && controlDash) releaseDash = false`。语义 = 冲刺
   *  发起后按住键不重触，任意一拍松键即重臂 */
  releaseDash = false;
  /** 水面行走状态（水上漂靴族：站在液面，按 ↓ 下潜） */
  onWaterSurface = false;
  /** 所在沙漠区（Game 每帧同步 scene.zoneDesert） */
  zoneDesert = false;
  /** 脚下是沙族地格（runningOnSand，FloorVisuals :23457——沙丘行者靴消费）。
   *  原版只在 vy==0 时刷新、离地不清零（ResetFloorFlags 仅重生/传送） */
  runningOnSand = false;
  /** 脚下地板 tile type（FloorCheck num3 :23450-23471，含坡面门；-1=无/坡面/空中）——
   *  slippy 冰面滑移消费（:26234-26255） */
  floorTileT = -1;
  /** 折叠凳使用中（PortableStoolUsage.IsInUse）：命中盒 +26px（脚锚定向上长，
   *  :28745-28747 ResizeHitbox）；起跳离凳 y-=26（:20504-20512）；渲染下移 26 */
  stoolInUse = false;
  /** 折叠凳常量（:14077 SetStats(26,26,26)：HeightBoost/VisualYOffset/MapYOffset） */
  static readonly STOOL_BOOST = 26;

  /** CanFitSpace（Collision.cs：命中盒向上抬 extra 像素后的新增带无实心格；
   *  fixedUpdate 传入当帧 store） */
  private canFitSpaceUp(extra: number, st: { isSolid(x: number, y: number): boolean } | null): boolean {
    if (!st) return true;   // 无 store 引用时保守放行（原版恒有 Main.tile）
    const x0 = Math.floor(this.x / 16), x1 = Math.floor((this.x + this.w - 0.01) / 16);
    const y0 = Math.floor((this.y - extra) / 16), y1 = Math.floor((this.y - 0.01) / 16);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (st.isSolid(x, y)) return false;
    return true;
  }

  // ===================== pulley 绳索悬挂（Player.cs:19355-19460 / :25801-26177） =====================

  /** 原版 Main.tileRope[type] 直判（不含 IsRope 的"绳穿平台"支——FindPulley 的
   *  孤立绳格检查 :19376 用的是裸 tileRope，非 IsRope；出界=非绳） */
  private rawRopeAt(st: TileStore, x: number, y: number): boolean {
    if (!st.inBounds(x, y)) return false;
    const k = st.idx(x, y);
    return (st.flags[k] & 1) !== 0 && !!TILE_DEFS[st.type[k]]?.rope;
  }

  /** WorldGen.IsRope(x,y)（1457 WorldGen.cs:70612-70634，rangeToCheck=5）：
   *  tileRope 族直判；314 矿轨/380 花盆箱/平台族格 → GetRopeEnds（:70556-70604）
   *  上下 5 格内均有绳才算（绳穿平台/矿轨可攀——扫描对 active 非绳格【穿行】,
   *  null/!active 才断,★BJ652 件2 勘正,见下方循环注）。pulley 抓绳门
   *  （FindPulley :19771;1456 伪锚 :19363 勘正）与维持退出门（:26465-26468;1456 伪锚 :25950 勘正）的判定源 */
  isRopeAt(st: TileStore, x: number, y: number): boolean {
    if (!st.inBounds(x, y)) return false;
    const k = st.idx(x, y);
    if (!(st.flags[k] & 1)) return false;              // !active
    const def = TILE_DEFS[st.type[k]];
    if (!def) return false;
    if (def.rope) return true;                         // Main.tileRope
    const sheet = def.vanilla?.sheet ?? -1;
    if (sheet !== 314 && sheet !== 380 && !VANILLA_PLATFORM_SHEETS.has(sheet)) return false;
    // GetRopeEnds（WorldGen.cs:70556-70603;1456 伪锚 :70069-70105 勘正，treatEmptyAsTheRopeEnd=false，range 5）
    // ★BJ652 件2（2026-10-12）扫描语义勘正：旧实现首格非绳即 break——原版对
    //  【active 非绳格】是继续穿行（null/!active 才 break,绳才置位破），
    //  绳藏在平台/矿轨后一格起即漏判（:70560-70580/:70582-70602 亲读;BJ661 复核行界）。
    let topRopeY = -1;
    for (let i = 1; i <= 5; i++) {
      const ty = y - i;
      if (!st.inBounds(x, ty)) break;                  // InWorld 出界即止（:70559）
      const k = st.idx(x, ty);
      if (!(st.flags[k] & 1)) break;                   // tile==null||!active → break（:70564）
      if (TILE_DEFS[st.type[k]]?.rope) { topRopeY = ty; break; }   // 绳→置位破;active 非绳→继续
    }
    let bottomRopeY = -1;
    for (let j = 1 + (y - topRopeY); j <= 6; j++) {
      const ty = topRopeY + j;
      if (!st.inBounds(x, ty)) break;
      const k = st.idx(x, ty);
      if (!(st.flags[k] & 1)) break;
      if (TILE_DEFS[st.type[k]]?.rope) { bottomRopeY = ty; break; }
    }
    return topRopeY !== -1 && bottomRopeY !== -1;
  }

  /** Collision.SolidCollision（Collision.cs:2713-2746）：盒与实心非平台格相交
   *  判定（扫描域 x∈[⌊px/16⌋−1, ⌊(px+w)/16⌋+2]、y 同构；halfBrick 只算下半
   *  8px；已致动格不计）。FindPulley 吸附位碰撞预检（:19829/:19846/:19863;1456 伪锚 :19413/:19430/:19447 勘正） */
  private solidCollision(st: TileStore, px: number, py: number): boolean {
    const x0 = Math.floor(px / TILE) - 1;
    const x1 = Math.floor((px + this.w) / TILE) + 2;
    const y0 = Math.floor(py / TILE) - 1;
    const y1 = Math.floor((py + this.h) / TILE) + 2;
    for (let i = x0; i <= x1; i++) {
      for (let j = y0; j <= y1; j++) {
        if (!st.inBounds(i, j)) continue;              // 原版钳世界边（近缘差异登记）
        const k = st.idx(i, j);
        const def = TILE_DEFS[st.type[k]];
        if (!def?.solid || def.platform) continue;     // tileSolid && !tileSolidTop（:2728）
        // ★幽灵保域（2026-09-02）：补原版 :2728 active() 门（`… && tile.active() && …`）
        // ——幽灵格（flags=0,type≠0）不计实心；此前靠 finalize 出口净化维持恒等式
        if (st.flags[k] === 0) continue;
        if (st.wire[k] & 32) continue;                 // !inActive()（致动缩入）
        let ty = j * TILE, th = TILE;
        if (st.half[k]) { ty += 8; th -= 8; }          // halfBrick：下半实心（:2734-2737）
        if (px + this.w > i * TILE && px < i * TILE + TILE
          && py + this.h > ty && py < ty + th) return true;
      }
    }
    return false;
  }

  /** FindPulley（Player.cs:19355-19460）：按上/下键且头顶格（(y−8)/16 行）为绳
   *  时抓绳——X 吸附绳列三档（中心/±6px 取最近），y 落 num3（孤立绳格=格顶+22，
   *  连续绳=原位），gfxOffY 记录 y 跳变的视觉补偿，stepSpeed=2.5、vx=0。
   *  调用门（:25805）：!pulley && !frozen && !webbed && !stoned && gravDir==1 &&
   *  ropeCount==0 && 无钩爪 && !tongued && !mount.Active。★终零波批注订正
   *  （2026-09-01）：旧注"!controlJump 门省略"退役——台账⑥已以 jumpOnlyHeld=
   *  inputJump&&!inputUp ≙ controlJump 等价谓词落位（fixedUpdate findPulley 调用点,
   *  Space 不再吸附进绳态;Space+↑ 组合语义钉死可抓=合并键面登记差异）。原版另调
   *  Main.cameraX 平滑（:19417/:19433/:19450）——本仓相机无对应载体，略 */
  findPulley(st: TileStore): void {
    if (this.stoolInUse || (!this.inputUp && !this.inputDown)) return;   // :19357
    const num = Math.floor((this.x + this.w / 2) / TILE);                // :19361 头心列
    const num2 = Math.floor((this.y - 8) / TILE);                        // :19362 头格行
    if (!this.isRopeAt(st, num, num2)) return;                           // :19363
    let num3 = this.y;                                                   // :19367 目标 y
    // :19368-19379 孤立绳格（上、下邻格均非 tileRope）→ 挂到格顶+22（挂绳下沿）
    if (!this.rawRopeAt(st, num, num2 - 1) && !this.rawRopeAt(st, num, num2 + 1)) {
      num3 = num2 * TILE + 22;
    }
    const num5 = num * TILE + 8 - this.w / 2 + 6;    // :19381 右贴档
    const num6 = num * TILE + 8 - this.w / 2;        // :19382 居中档
    const num7 = num * TILE + 8 - this.w / 2 - 6;    // :19383 左贴档
    let num8 = 1;                                    // :19384 最近档号
    let num9 = Math.abs(this.x - num5);              // :19385
    if (Math.abs(this.x - num6) < num9) { num8 = 2; num9 = Math.abs(this.x - num6); }
    if (Math.abs(this.x - num7) < num9) { num8 = 3; }
    let num4 = num5;                                 // :19380 初值（下三支覆写）
    if (num8 === 1) { num4 = num5; this.pulleyDir = 2; this.facing = 1; }   // :19396-19401
    if (num8 === 2) { num4 = num6; this.pulleyDir = 1; }                    // :19402-19406
    if (num8 === 3) { num4 = num7; this.pulleyDir = 2; this.facing = -1; }  // :19407-19412
    // 三连试位（:19413-19459）：选定档 → 右贴档 → 左贴档，首个无实心碰撞的落位
    if (!this.solidCollision(st, num4, this.y)) { this.pulleySnap(num4, num3); return; }
    num4 = num5; this.pulleyDir = 2; this.facing = 1;                       // :19427-19429
    if (!this.solidCollision(st, num4, this.y)) { this.pulleySnap(num4, num3); return; }
    num4 = num7; this.pulleyDir = 2; this.facing = -1;                      // :19444-19446
    if (!this.solidCollision(st, num4, this.y)) { this.pulleySnap(num4, num3); }
  }

  /** FindPulley 落位三连写（:19419-19425/:19436-19442/:19453-19459 同构段）：
   *  pulley 置位 + X 吸附 + gfxOffY 视觉补偿 + stepSpeed=2.5 + Y 落位 + vx 清零 */
  private pulleySnap(x: number, y: number): void {
    this.pulley = true;
    this.x = x;
    this.gfxOffY = this.y - y;     // 跳变差（渲染锚消费，每 tick 衰减回 0）
    this.stepSpeed = 2.5;
    this.y = y;
    this.vx = 0;
  }

  /** gfxOffY 衰减（Player.cs:27695-27719）：每 tick 向 0 收敛 num106×stepSpeed
   *  （num106=1+|vx|/3——跑动加速收敛），过零截断，钳 ±32 */
  decayGfxOffY(): void {
    const num106 = 1 + Math.abs(this.vx) / 3;
    if (this.gfxOffY > 0) {
      this.gfxOffY -= num106 * this.stepSpeed;
      if (this.gfxOffY < 0) this.gfxOffY = 0;
    } else if (this.gfxOffY < 0) {
      this.gfxOffY += num106 * this.stepSpeed;
      if (this.gfxOffY > 0) this.gfxOffY = 0;
    }
    if (this.gfxOffY > 32) this.gfxOffY = 32;
    if (this.gfxOffY < -32) this.gfxOffY = -32;
  }

  /** 绳上攀爬速度链（Player.cs:26016-26125）：上爬（W/Space 皆入攀爬键位模型）
   *  vy>0 阻尼×0.7 后 −0.2（>−3 档）/−0.02（≤−3 档），下限 −8；下滑镜像
   *  +0.2/+0.1 上限 maxFallSpeed；静止 ×0.7 且 |vy|<0.1 归 0（:26120-26124）。
   *  ★BJ-C8（R7-F2）flag15 形参（:26531 `controlUp & flag15`）：(y−16) 行非绳时
   *  攀爬臂不可达——原版该态落 idle 臂（:26633-26641 ×0.7 阻尼），非「无操作」 */
  ropeClimbVy(flag15 = true): void {
    if (this.inputJump && flag15) {
      if (this.vy > 0) this.vy *= 0.7;
      this.vy -= this.vy > -3 ? 0.2 : 0.02;
      if (this.vy < -8) this.vy = -8;
    } else if (this.inputDown) {
      if (this.vy < 0) this.vy *= 0.7;
      this.vy += this.vy < 3 ? 0.2 : 0.1;
      if (this.vy > PLAYER_MAX_FALL_SPEED) this.vy = PLAYER_MAX_FALL_SPEED;
    } else {
      this.vy *= 0.7;
      if (Math.abs(this.vy) < ROPE_IDLE_ZERO) this.vy = 0;
    }
  }

  /** 滑轮帧推进（Player.cs:26661-26681——pulley 垂直块（:26500）尾段：X 吸附
   *  （:26644-26660）之后、RefreshDoubleJumps/DashMovement（:26683/:26691）之前，
   *  块内无条件执行——含 inputDown 穿落离绳拍（该拍 pulley 已置假、vy=1 照推进）。
   *  公式：counter += |vy|·0.75，vy≠0 再 +0.75；counter>10 → pulleyFrame++ 并归零
   *  counter；pulleyFrame>1 归 0（PlayerPulley 26×72 两帧竖排循环）。
   *  本仓调用位 = 移动相两支（中段 branch1 门 this.pulley / 绳端 branch2 支尾
   *  无条件）的 dashMovement 之前——与原版「垂直链→X 吸附→帧推进→DashMovement」
   *  块序同相（本仓 X 吸附在移动相前置段 :5570-5578）。 */
  advancePulleyFrame(): void {
    this.pulleyFrameCounter += Math.abs(this.vy) * 0.75;   // :26661
    if (this.vy !== 0) this.pulleyFrameCounter += 0.75;    // :26663-26665
    if (this.pulleyFrameCounter > 10) {                    // :26667-26671
      this.pulleyFrame++;
      this.pulleyFrameCounter = 0;
    }
    if (this.pulleyFrame > 1) this.pulleyFrame = 0;        // :26673-26675
  }

  /** ★BJ-C8（R7-F1）绳键计时器尾写（Player.cs:27833-27855 无条件段 1:1）：松键拍
   *  置 7（releaseLeft/Right 置真由 prevInputLeft/Right 承载,MV3 同址同相）、持键
   *  递减至 0（movement 相次拍读 0=8 拍再触发沿）、归 0 后持键回充 7。调用站=
   *  prevInput 五站中的四个（坐睡/矿车×2/主尾——原版这些路径不早退 Update 直落
   *  :27833 尾）;死亡站除外（UpdateDead :17195-17196 只刷 release 不写 timer）。 */
  updateRopeKeyTimers(): void {
    if (!this.inputRight) this.rightTimer = 7;                       // :27832-27836
    if (!this.inputLeft) this.leftTimer = 7;                         // :27837-27845
    if (this.rightTimer > 0) this.rightTimer--;                      // :27847-27850
    else if (this.inputRight) this.rightTimer = 7;                   // :27851-27854
    if (this.leftTimer > 0) this.leftTimer--;                        // :27855-27858
    else if (this.inputLeft) this.leftTimer = 7;                     // :27859-27862
  }

  // ===================== 绳锚几何（RotatedRelativePoint / 坐骑持物偏移 / 线起点） =====================

  /** 原版 Player.fullRotation 的本仓聚合源：矿车 TrackRotation（:27805-27806）
   *  → Minecart.rotation；坐骑 Hover 机身倾斜（Mount.cs:3468-3521）→
   *  MountInstance.fullRotation；无骑乘 = 0（本仓玩家侧无独立 fullRotation 字段，
   *  睡床躺平角只在渲染层 sleepingTransformOps） */
  get anchorFullRotation(): number {
    if (this.ridingCart && this.cart) return this.cart.rotation;
    if (this.ridingMount) return this.mount.fullRotation;
    return 0;
  }

  /** 锚链用的 Mount.PlayerOffset（Mount.cs:409-423 = playerYOffsets[frame]）：
   *  矿车族数组由 SetAsMinecart 填 8×3（:2720-2726；51/53 屁股车档 -10/-8 → 10）
   *  ——vanilla-mounts.json 提取器未跑该帮助函数致缺数组，此处硬补
   *  （Minecart.ts:763 num2=8 同源）；非矿车坐骑走 MOUNT_DATA 原值 */
  private get anchorPlayerOffset(): number {
    if (!this.mount.active) return 0;
    if (this.mount.isCart) return this.mount.type === 51 || this.mount.type === 53 ? 10 : 8;
    return this.mount.playerOffset;
  }

  /** MountedCenter（Player.cs:3189-3199：(x+w/2, y+BaseHeight/2+HeightOffsetHitboxCenter)）。
   *  坐骑态经 Bottom−21−PlayerOffset 等价形（原版 h=42+heightBoost、BaseHeight=42
   *  → boost 项经 Bottom 自消；本仓坐骑不改玩家盒，Bottom 同锚一致）。折叠凳
   *  （SetStats(26,26,26) :14077 → HeightOffsetHitboxCenter=26−26=0）= 基础 42
   *  盒中心（本仓 h 已含 +26）。常规 = 盒中心 */
  get mountedCenter(): { x: number; y: number } {
    if (this.mount.active) {
      return { x: this.x + this.w / 2, y: this.y + this.h - 21 - this.anchorPlayerOffset };
    }
    const baseH = this.h - (this.stoolInUse ? Player.STOOL_BOOST : 0);
    return { x: this.x + this.w / 2, y: this.y + baseH / 2 };
  }

  /** RotatedRelativePoint（Player.cs:4063-4089）：pos 先 +gfxOffY（addGfxOffY），
   *  绕 pivot=Bottom+(0,gfxOffY) 旋 rot，再 + (0,−num2)+(0,num2).RotatedBy(rot)
   *  （num2=PlayerOffset/2+4，未骑乘 PlayerOffset=0→num2=4）。fullRotation=0 时
   *  mount 项自消 → 输出 = pos+(0,gfxOffY)。sleeping/sitting 偏移支未移植
   *  （两态 gfxOffY 恒 0 且与线锚消费互斥，登记） */
  rotatedRelativePoint(px: number, py: number,
    opts: { reverseRotation?: boolean; addGfxOffY?: boolean; rotation?: number } = {},
  ): { x: number; y: number } {
    const rotation = opts.rotation ?? this.anchorFullRotation;
    const rot = opts.reverseRotation ? -rotation : rotation;             // :4065
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const pivX = this.x + this.w / 2;                                    // Bottom.X
    const pivY = this.y + this.h + this.gfxOffY;                         // :4070
    // ★R2-09（蓝队二轮）：vanilla `int num2 = mount.PlayerOffset / 2 + 4;`（1457
    // Player.cs:4221，历史注释 :4071 为 1456 行段）——int/int 朝零截断，负偏移
    // （奇数）与 Math.floor 形分叉；统一 trunc 形（player/SwingPathMath 同站点同式）。
    const num2 = Math.trunc(this.anchorPlayerOffset / 2) + 4;            // int/int 截断
    let y = py;
    if (opts.addGfxOffY !== false) y += this.gfxOffY;                    // :4073-4076
    const dx = px - pivX, dy = y - pivY;
    return {
      // :4072 vector2 = (0,−num2)+(0,num2).RotatedBy(rot) = (−num2·sin, −num2+num2·cos)
      x: pivX + dx * cos - dy * sin - num2 * sin,
      y: pivY + dx * sin + dy * cos - num2 + num2 * cos,
    };
  }

  /** 手持物 vid（heldItem→ITEM_DEFS→vid；空手 −1） */
  heldVid(): number {
    const held = this.inv.heldItem();
    if (!held) return -1;
    const def = ITEM_DEFS[held.id];
    return def ? (def.vid ?? -1) : -1;
  }

  /** 手持物 useStyle：itemfunc.useStyle + 提取缺口补（悠悠球族 Item.cs:30018-30033
   *  goto case 链丢 useStyle → 全族 5；钓竿族 case 链同理 → 1；其余缺 → 1） */
  private heldUseStyleOf(vid: number): number {
    const us = vid >= 0 ? itemFuncOfVid(vid)?.useStyle : undefined;
    if (us) return us;
    if (YOYO_ITEM_VIDS.has(vid)) return 5;
    return 1;
  }

  /** ApplyItemPositionOffsetFromMount 的 bodyFrame 行（:50644 bodyFrame.Y/Height）。
   *  原版行由 Player.UpdateFrames 维护；本仓帧行渲染侧（Renderer.playerFrameRows），
   *  此处按原版链序重算可达分支。消费分支中只有"动画中"useStyle 5（悠悠球 flag9）
   *  需要行——aim 给全（n21=itemRotation·direction :35994，<−0.75→行2 / >0.6→行4，
   *  gravDir=−1 互换 :35996-36010；缺省 0=行 3 中档带）。相位族（1/6/7/11/13）
   *  本仓单计时器模型无 itemAnimationMax，取动画中点行（该族无钓竿/悠悠球消费，
   *  登记）；坐骑分支以下（抓钩/游泳/行走行）骑乘态不可达（:36056 先拦） */
  private mountOffsetBodyRow(itemAnimating: boolean, aim?: number): number {
    const vid = this.heldVid();
    const tf = vid >= 0 ? itemFuncOfVid(vid) : null;
    const useStyle = this.heldUseStyleOf(vid);
    const holdStyle = tf?.holdStyle ?? 0;
    const styleNotExcluded = useStyle !== 10 && useStyle !== 14 && useStyle !== 15;  // :35716 flag6
    if (itemAnimating && styleNotExcluded) {
      switch (useStyle) {
        case 1:
        case 13: return 2;          // 三相 3/2/1（:35882-35895/:35971-35985）→ 中点近似
        case 7: return 2;           // 两相 3/2（:35897-35907）→ 中点近似
        case 2:
        case 3:
        case 12: return 3;          // :35908/:35948/:35967
        case 11: return 3;          // 三相 4/3/2（:35912-35925）→ 中点近似
        case 9: return 0;           // :35927-35929
        case 6: return 3;           // 两相 3/2（:35931-35947）→ 后段近似
        case 4: return 2;           // :35959-35961
        case 8: return 0;           // :35963-35965
        case 5: {
          if (vid === 281 || vid === 986) return 2;                      // :35988-35991
          const n21 = aim ?? 0;                                          // :35994
          if (n21 < -0.75) return this.gravDir === -1 ? 4 : 2;           // :35996-36002
          if (n21 > 0.6) return this.gravDir === -1 ? 2 : 4;             // :36004-36010
          return 3;                                                      // :35995
        }
        default: break;               // 其余 style 无行写入（链下落）
      }
    }
    // pulley 行（:36015-36023）骑乘互斥不可达，省略
    if (holdStyle === 1 || holdStyle === 3 || holdStyle === 5) return 3; // :36026-36041
    if (holdStyle === 2) return 2;                                       // :36030-36033
    if (holdStyle === 7) return 11;                                      // :36042-36045
    if (holdStyle === 4 && this.vy === 0 && this.gravDir === 1) return 0; // :36046-36051
    if (this.shieldRaised) return 10;                                    // :36052-36055
    return this.mount.active ? this.mount.bodyFrame : 0;                 // :36056-36060
  }

  /** ApplyItemPositionOffsetFromMount（Player.cs:50638-50795）：坐骑上持物位置
   *  偏移。1456 唯一有表坐骑 = 54 迅猛龙（MountID.cs:142，IsTransformationMount/
   *  PlayerIsHidden——变身坐骑；其余 63 坐骑 zero 恒 0 直接返回加零）。opts：
   *  - itemAnimating：itemAnimation>0 代理（缺省 itemAnimTicks>0||useTime>0；
   *    悠悠球 channel 期原版 itemAnimation 持续刷新恒>0，本仓 useTime 单发模型
   *    由消费端传 channel 态补）
   *  - aim：mountOffsetBodyRow 的瞄准角原料 */
  applyItemPositionOffsetFromMount(px: number, py: number,
    opts: { itemAnimating?: boolean; aim?: number } = {},
  ): { x: number; y: number } {
    if (!this.mount.active) return { x: px, y: py };                     // :50640-50643
    const dir = this.facing, gd = this.gravDir;                          // Directions :3687
    const vid = this.heldVid();
    const tf = vid >= 0 ? itemFuncOfVid(vid) : null;
    const useStyle = this.heldUseStyleOf(vid);
    const holdStyle = tf?.holdStyle ?? 0;
    const flag = (opts.itemAnimating ?? false) || this.itemAnimTicks > 0 || this.useTime > 0;
    const num = this.mountOffsetBodyRow(flag, opts.aim);                 // :50644
    const flag2 = !flag && holdStyle > 0;                                // :50648
    if (!flag && !flag2) return { x: px, y: py };                        // :50649-50652
    const flag3 = useStyle === 5;                                        // :50653
    const flag4 = useStyle === 2;                                        // :50655
    const flag5 = useStyle === 9;                                        // :50656
    const flag6 = !!tf?.fishingPole;                                     // :50657
    const flag7 = useStyle === 14;                                       // :50658
    const flag8 = useStyle === 8;                                        // :50659
    const flag9 = vid > 0 && YOYO_ITEM_VIDS.has(vid);                    // :50660
    const flag10 = useStyle === 11;                                      // :50661
    const flag11 = vid === 3542;                                         // :50662 星云怒涛
    const flag12 = vid > 0 && KITE_ITEM_VIDS.has(vid);                   // :50663
    const flag13 = holdStyle === 1;                                      // :50664
    const flag14 = holdStyle === 2;                                      // :50665
    const flag15 = holdStyle === 5;                                      // :50666
    let zx = 0, zy = 0;
    const mul = (ox: number, oy: number) => { zx += ox * dir; zy += oy * gd; };
    if (this.mount.type === 54) {                                        // :50667
      if (flag4) {
        if (flag) mul(7, -4); else mul(3, 2);                            // :50669-50678
      } else if (flag6) {
        mul(-2, 0);                                                      // :50680-50683 钓竿
      } else if (flag5) {
        if (flag) mul(14, -10); else mul(3, 2);                          // :50684-50693
      } else if (flag10) {
        if (flag) mul(4, 0); else mul(1, 0);                             // :50695-50704
      } else if (flag8) {
        mul(6, 0);                                                       // :50706-50709
      } else if (flag7) {
        if (flag) mul(-6, 6); else mul(-10, 10);                         // :50710-50719
      } else if (flag12) {
        mul(4, -4);                                                      // :50721-50723 风筝
      } else if (flag15) {
        mul(6, 0);                                                       // :50725-50728
      } else if (flag13 && !flag) {
        mul(1, 4);                                                       // :50729-50732
      } else if (flag14) {
        if (flag && vid === 186) {
          // :50735-50737 芦苇管：(−4,0).RotatedBy((pos−Center).ToRotation())
          const a = Math.atan2(py - this.cy, px - this.cx);
          zx += -4 * Math.cos(a);
          zy += -4 * Math.sin(a);
        } else {
          mul(6, 0);                                                     // :50739-50742
        }
      } else if (flag9) {
        if (num === 2) mul(10, -10);                                     // :50746-50757 悠悠球
        else if (num === 3) mul(8, 0);
        else if (num === 4) mul(2, 2);
      } else if (flag11) {
        if (num === 2) mul(-10, 0);                                      // :50759-50772 星云怒涛
        else if (num === 3) mul(10, 0);
        else if (num === 4) mul(10, 0);
      } else if (flag3) {
        mul(4, 0);                                                       // :50774-50777
      } else {
        if (num === 1) mul(1, -1);                                       // :50778-50792
        else if (num === 2) mul(4, 2);
        else if (num === 3) mul(2, 0);
      }
    }
    return { x: px + zx, y: py + zy };                                   // :50794
  }

  /** 手持瞄准角 n21（=itemRotation·direction，行档阈值原料）：参照点 =
   *  RotatedRelativePoint(MountedCenter) − (0, 2·gravDir)（:46560 + :46640）；
   *  itemRotation = atan2(dy·dir, dx·dir) − fullRotation（:46730）；n21 = ×direction（:35994） */
  private itemAimRotDir(tx: number, ty: number): number {
    const mc = this.mountedCenter;
    const rp = this.rotatedRelativePoint(mc.x, mc.y);
    const dx = tx - rp.x;
    const dy = ty - (rp.y - 2 * this.gravDir);
    return (Math.atan2(dy * this.facing, dx * this.facing) - this.anchorFullRotation) * this.facing;
  }

  /** 悠悠球/配重球线起点（Main.cs:27794-27803 DrawProjDirect aiStyle99 段）：
   *  MountedCenter → mount52（狼人）修正 → +gfxOffY → ApplyItemPositionOffsetFromMount。
   *  target = 光标世界坐标（mount54 行档 aim）；channelActive = 悠悠球滞留态
   *  （itemAnimation>0 代理——原版 channel 期持续刷新） */
  yoyoStringAnchor(target?: { x: number; y: number }, channelActive?: boolean): { x: number; y: number } {
    const mc = this.mountedCenter;
    let x = mc.x, y = mc.y;
    if (this.mount.active && this.mount.type === 52) {                   // :27795-27798
      x += this.facing * 14;
      y += -10;
    }
    y += this.gfxOffY;                                                   // :27802
    const aim = target ? this.itemAimRotDir(target.x, target.y) : undefined;
    return this.applyItemPositionOffsetFromMount(x, y, { itemAnimating: channelActive, aim });
  }

  /** 钓线竿尖起点链前段（DrawProj_FishingLine Main.cs:34967-34982）：
   *  mountedCenter → [mount52 死支] → ApplyItemPositionOffsetFromMount → +gfxOffY。
   *  ★mount52 支（:34973-34976）写的是 polePos，紧接 :34979-34980 用偏移后的
   *  mountedCenter 覆写 polePos——该修正被丢弃（原版同款死代码，照抄保留） */
  fishingPoleAnchorBase(): { x: number; y: number } {
    const mc = this.mountedCenter;
    let x = mc.x, y = mc.y;
    if (this.mount.active) {
      if (this.mount.type === 52) { /* :34973-34976 死支（:34979 覆写） */ }
      ({ x, y } = this.applyItemPositionOffsetFromMount(x, y));          // :34978-34980
    }
    y += this.gfxOffY;                                                   // :34982
    return { x, y };
  }
  /** 上一 tick 的世界 store 引用（fixedUpdate 缓存；dashWallAhead 探测用） */
  private lastStore: import('../world/TileStore').TileStore | null = null;
  /** 坐骑探测用世界（MountedPlayerView.store：fixedUpdate 帧首刷新） */
  get store() { return this.lastStore; }
  /** 上一 tick 的跳跃输入（Mount.tryStartHover 的 releaseUp 边沿门 :26416） */
  prevInputJump = false;
  /** 跳键上一 tick 按住态（tick 尾快照；水中起跳边沿=releaseJump :20409 语义） */
  jumpEdgePrev = false;
  /** ★BJ704-G15（G13 登记债④）↑ 键上一 tick 电平（tick 尾快照,与 jumpEdgePrev 同址）
   *  ≙ 原版 releaseUp（UpdateControlHolds :29319-29327 移动段后刷新）——次拍
   *  Mount.tryStartHover :26939 读 = ↑ 键上升沿（W 独立键面,Space 只入 controlJump
   *  不入 controlUp——PlayerInput.cs:2072/2076 + TriggersSet CopyInto :786/:790）。
   *  与 jumpEdgePrev（Space∪Up 合成键）分立:持 Space 中按 W 的 vanilla 触发面。 */
  upEdgePrev = false;
  /** 鼠标世界坐标（Game 每帧注入；钻头坐骑瞄准 AimAbility / Scutlix 索敌回退用） */
  aimWX = 0;
  aimWY = 0;
  /** 左键（controlUseItem）/ 右键（controlUseTile）按住电平——钻头坐骑挖掘驱动 */
  inputUseItem = false;
  inputUseTile = false;
  /** 致动魔杖单摆向锁（★A-6 2026-09-04 移植 Player.cs:2599-2601 字段/:47296-47310
   *  置位/:18918-18921 清理）：成功翻转一格致动器后锁向——LockSetting=翻转后的
   *  inActive() 态;锁存期间（左键持续按住,:43160 releaseUseItem=!controlUseItem →
   *  松开即清）再施只翻同态格（SmartCursor Step_ActuationRod :1506-1512 同门） */
  actuationRodLock = false;
  actuationRodLockSetting = false;
  /** 上一 tick 的两键电平（ItemCheck_HandleMount :52074 的 releaseUseItem&&releaseUseTile
   *  按压边沿 = 上 tick 双松 + 本 tick 任一按下） */
  prevUseItem = false;
  prevUseTile = false;
  /** 重力方向（R7：1 普通 / -1 倒置——重力药水 buff 18 激活时按 Up 切换，Player.gravDir）
   *  倒置 = 重力/跳跃/落点起点全部取反；onGround 由 hitHead 近似（天花板当地板） */
  gravDir: 1 | -1 = 1;
  /** FTW 克脑重力倒置计数（Player.forcedGravity）：距脑<4000px 每 tick 置 10
   *  （Player.cs:26489-26493）、每 tick 衰减（:18496-18498）；>0 强制 gravDir=-1
   *  （:26494-26496）。Producer = bossAI.brainOfCthulhuAI 二阶段写 world.brainOfGravity；
   *  求值入口 = fixedUpdate 头部 consumeBrainOfGravity */
  forcedGravityT = 0;
  /** 世界边界钳制（原版 Player.BordersMovement，Player.cs:23771-23844；
   *  碰撞积分后调用，调用点对应原版 :27968）。
   *  边界 = 世界边缘内缩 640px（=40 格 = offLimitBorderTiles×16，Main.cs:433）：
   *  - 左/右越线 → 钳回 + vx=0（原版另置 cameraX=0 抗镜头抖动，本仓库无对应，略）
   *  - 顶越线 → 【remix/forcedGravity 分支：出界即死】KillMe 原因 19 伤害 10
   *    （:24264 + 成就 44 MY_PEOPLE_NEED_ME :24266-24268）+ 半幅钳位（num4=320，
   *    :24269-24276）；【普通世界：钳回】+ vy 下推至 ≥0.11 + gravDir 复位 1
   *    （else 支 :24277-24283）
   *  - 底越线 → ★SW-FX40（f）重锚（:24292-24317）：仅 skyblock 世界 KillMe 原因 21
   *    伤害 10（:24295-24297）；普通世界只钳 y（:24300-24301）+ 脚底钳 −height
   *    （:24308-24313,神模式或非 skyblock 生效）+ ROCK_BOTTOM 特殊事件 10
   *    （:24314-24317）——旧"恒杀"系 skyblock 门整缺,普通世界底界挖穿误判死 */
  bordersMovement(world: import('../world/World').World, game?: import('./types').GameHooks): void {
    const B = 640;                              // offLimitBorderTiles(40) × 16
    const wPx = world.store.w * TILE;           // Main.rightWorld
    const hPx = world.store.h * TILE;           // Main.bottomWorld（leftWorld/topWorld=0）
    // 最小世界门:边框两侧各 40 格,世界任一边 ≤80 格时钳制无意义(会把整张图框死)。
    // 原版最小世界 4200×1200 格,真实世界恒过此门;单测手搓小世界天然豁免
    if (wPx <= 2 * B || hPx <= 2 * B) return;
    if (this.x < B) { this.x = B; this.vx = 0; }
    if (this.x > wPx - B - this.w) { this.x = wPx - B - this.w; this.vx = 0; }
    if (this.y < B) {
      // ★MY_PEOPLE_NEED_ME 批（2026-09-04）：补 remix/forcedGravity 分支
      //  （1457 :24255-24272）——remix 世界（don't dig up）/克脑强制重力期间
      //  顶界出界即死（KillMe(ByOther(19),10) :24264）,非 remix 世界才钳位上推
      if (world.seedFlags?.remix || this.forcedGravityT > 0) {
        if (this.y < B - this.h && !this.dead) {
          // KillMe(ByOther(19) = Space_1..5,10.0)：creativeGodMode 门在原版
          // KillMe 头(:39096 早退)——直杀通道对应跳过,成就 44 通知在 KillMe 之外
          // 恒执行（:24266-24268 whoAmI==myPlayer,单人恒真;神模式照发=原版语义）
          if (!journeyGodmodeActive()) {
            this.hp = 0;
            this.lastDamageCause = { kind: 'space' };   // ByOther(19) Space_1..5
          }
          game?.achievements?.notifyProgressionEvent(44);   // MY_PEOPLE_NEED_ME
        }
        // 顶界内缩半幅钳位（:24269-24276 num4 = 640/2）——死亡线 = 640−height（上支），
        // 活体只可在 [640−height, 640) 带内存活；320 钳位仅对传送/尸体等
        // 单拍大幅越线生效（y<320 时上支已置死,此处只钳位摆尸）
        if (this.y < B / 2) {
          this.y = B / 2;
          if (this.vy < 0) this.vy = 0;
          this.gravDir = 1;
        }
      } else {
        this.y = B;
        if (this.vy < 0.11) this.vy = 0.11;
        this.gravDir = 1;
      }
      // ★SW-FX47（c）：INTO_ORBIT 特殊事件 11（:24290——顶界 if 块内、remix/普通
      //  两分支汇合后恒执行）→ INTO_ORBIT Reach 成就（AchievementsHelper.cs:328-330
      //  case 11;语义=抵达世界顶界带,非火箭/出世界事件）。原版在钳位【前】的同一
      //  块内判发——本仓 Game.ts achTick 曾有 y<640 中央核查位,但跑在 fixedUpdate
      //  （含顶界钳 y=B）之后,y==640 时 `y<640` 恒假=普通世界永哑（remix 半幅钳
      //  320 才偶发）——补内联位对齐原版越过拍触发;中央核查位保留（幂等+小世界
      //  豁免域兜底）。cameraY=0 复位（:24262/:24276/:24282）无承载位不接（镜头
      //  无 Main.cameraX/Y 平移通道,既登记）。whoAmI==myPlayer 门（Helper 头
      //  :283-285）单人恒真,本仓成就面即本地玩家。 */
      game?.achievements?.handleSpecialEvent(11,
        this as unknown as { statLifeMax: number; statManaMax: number });
    }
    // ---- 底界（:24292-24317）——★SW-FX40（f·gd 无关行为补齐）三刀：
    //  ① skyblock 门（:24292 skyblockWorld=:24295 `if (skyblockWorld && !dead)`
    //  才 KillMe——WorldGen.cs:11150 skyblockWorldGen=WorldSeedOption_Skyblock；
    //  旧"恒杀"把普通世界底界挖穿也判死=自造域）② -height 脚底钳（:24308-24313
    //  `flag = creativeGodMode || !skyblockWorld` → y > bottom−640−height 再钳脚底
    //  ——身体【整体】拉回界内,vy 清零）③ ROCK_BOTTOM（:24314-24317
    //  HandleSpecialEvent(10)=ROCK_BOTTOM Reach——y > bottom−640−118−height）。
    const skyblockWorld = world.seedFlags?.skyblock === true;   // Main.skyblockWorld
    if (this.y > hPx - B) {
      if (skyblockWorld && !this.dead) {
        // KillMe(ByOther 21, 10.0)（:24297）:直死——绕过防御/无敌帧(不走 damage()),
        // hp 归零后由 fixedUpdate 尾部统一结算(死亡音/墓碑),最迟次 tick 生效。
        // creativeGodMode 豁免在 KillMe 头(:39096 早退),本仓以 journeyGodmode 门近似
        if (!journeyGodmodeActive()) {
          this.hp = 0;
          this.lastDamageCause = { kind: 'underground' }; // ByOther(21) Underground_1..5
        }
      }
      this.y = hPx - B;
      this.vy = 0;
    }
    // 脚底钳（:24308-24313）：非 skyblock（或神模式）才生效——skyblock 活体停在
    // [bottom−640−height, bottom−640) 死亡带内由上支判死,本钳不救
    if ((journeyGodmodeActive() || !skyblockWorld) && this.y > hPx - B - this.h) {
      this.y = hPx - B - this.h;
      this.vy = 0;
    }
    // ROCK_BOTTOM 成就（:24314-24317 HandleSpecialEvent(10)→ROCK_BOTTOM Reach
    // AchievementsHelper.cs:328-330）——仅越线带触发,神模式不豁免（原文无门）
    if (this.y > hPx - B - 118 - this.h) {
      game?.achievements?.handleSpecialEvent(10, this as unknown as { statLifeMax: number; statManaMax: number });
    }
  }
  /** 贴墙缓降中（spikedBoots 攀壁） */
  wallCling = false;
  /** ★BJ704-G15（G13 登记债①）Player.slideDir（Player.cs:1067 int,缺省 0）——挂壁
   *  方向（±1,蹬墙跳反踢 :20950 `velocity.X = 3*-slideDir` 消费）。原版写位=碰撞相尾
   *  :28456-:28462（水平速度被墙截断→取截断前 vx 符号;每碰撞相头 :28294 清 0,故
   *  仅撞墙拍非零）;仓内承载=wallCling 三置位点（老鼠爬墙/钉鞋驻停/钉鞋缓降）同拍
   *  同向写——挂壁即知向（头门已要求按向=撞向）,与 wallCling 配对跨拍存活,读面
   *  （跳跃门）恒见同拍成对值;非挂壁拍陈值无消费者（读门 = wallCling 置位）。 */
  slideDir = 0;
  /** ★SW-FX40（d·gd 无关整支新增）：FloorVisuals 头段单源（:23901-23930）——
   *  num=(int)((position.X+width/2)/16)、num2=脚下一行（gd=-1 换身体顶行
   *  :23904-23908）、GetFloorTile（:23946-23974 中心→x−1→x+1 首 nactive+solid 格）
   *  + 坡面门（:23927-23930 脚下三格任一 slope → num3=-1）。地板旗块与
   *  MakeFloorDust 调用位共用；返回地板格 TS id 与其格列/行（-1=无地板）。
   *  ★SW-FX47（d）：实心门补平台行为族臂——原版 Main.tileSolid[19/239/380/
   *  427/435-439] 全 true（Main.cs:8031-8032/:9797-9800/:10118-10119/:10126-10136,
   *  平台=solid 双旗），GetFloorTile 的 tileSolid 门对站平台态命中平台格;
   *  本仓 solid 位拆出 platform 旗（solid 恒 false）→ 旧 isSolid 门对平台恒假
   *  =站平台无地板格（棕榈平台 style49 落地尘 16 的 face 整缺根因）。家族表
   *  用静态 TILE_SOLID_TOP_FAMILY（stats/TouchDamage.ts:38——setOf 已把 sheet
   *  字面 19/239/… 折算本仓内部 id,故直比 st.type 内部域）——勿用
   *  st.isPlatform（其含家具族,家具 tileSolid=false 原版 GetFloorTile 不认）。 */
  private readFloorTile(world: import('../world/World').World): { id: number; col: number; row: number; preSlopeId: number } {
    const st = world.store;
    const fx0 = Math.floor(this.cx / TILE);
    const fy0 = this.gravDir === -1
      ? Math.floor((this.y - 0.1) / TILE)
      : Math.floor((this.y + this.h) / TILE);
    let ft = -1, fcol = fx0;
    for (const d of [0, -1, 1]) {
      const xx = fx0 + d;
      if (!st.inBounds(xx, fy0)) continue;
      const ii = st.idx(xx, fy0);
      // GetFloorTile 门（:23962 `nactive() && Main.tileSolid[type]`）——solid 位
      // ∪ 平台行为族（原版 tileSolid 的平台九件,本仓 solid 拆分面）
      if (st.flags[ii] && (st.isSolid(xx, fy0) || TILE_SOLID_TOP_FAMILY.has(st.type[ii]))) {
        ft = st.type[ii]; fcol = xx; break;
      }
    }
    // ★SW-RB14a（F3）：preSlopeId = 坡面门置 -1【前】的地板型（FloorVisuals 原序：
    //  旗块/粪块 AddBuff(120,180) 都在 :23927 坡面 num3=-1 之前消费,尘才吃坡面门）
    const preSlopeId = ft;
    if (ft >= 0 && (st.slope[st.idx(fx0 - 1, fy0)] !== 0 || st.slope[st.idx(fx0, fy0)] !== 0
      || st.slope[st.idx(fx0 + 1, fy0)] !== 0)) ft = -1;
    return { id: ft, col: fcol, row: fy0, preSlopeId };
  }

  /** readFloorTile 的旗标面简版（地板旗块消费） */
  readFloorTileId(world: import('../world/World').World): number {
    return this.readFloorTile(world).id;
  }

  /** ★SW-FX40（g·gd 无关新增）：UpdateTouchingTiles（Player.cs:57734-57765）——
   *  本 tick 碰撞触碰格清单。两道 IsClearSpotTest 探针（position+velocity @16px、
   *  position @|vy|；:57739/:57743）失空时以 FindCollisionTile 竖向扫描
   *  （Direction=sign(vy)==1?2:3）收集触碰格。消费面：①GetHurtTile 兜底
   *  （:29189-29201——HurtTiles 盒扫落空时逐格 !Suffocate && CanTileHurt）；
   *  ②TryBouncingBlocks 弹跳块（:35102+,本仓弹跳块族未建模=登记债,清单先挂）。
   *  原版调用时序 = 碰撞积分后（:23755 DryCollision 亚像素环内 + :28432 Update 主环）
   *  ——本仓接 :28432 位（moveAndCollide 后）；GetHurtTile 在 fixedUpdate 早段消费
   *  上拍清单 = 原版 :27820 先于 :28432 的同拍滞后,时序逐位对齐。 */
  updateTouchingTiles(world: import('../world/World').World): void {
    this.touchedTiles.length = 0;
    const gd = this.gravDir === -1 ? -1 : 1;
    const dir: 2 | 3 = Math.sign(this.vy) === 1 ? 2 : 3;
    let list: Array<{ x: number; y: number }> | null = null;
    if (!isClearSpotTest(world, this.x + this.vx, this.y + this.vy, this.w, this.h, 16, gd, true)) {
      list = findCollisionTileVertical(world, dir, this.x + this.vx, this.y + this.vy,
        this.w, this.h, 16, gd, false);                      // :57741 checkSlopes 缺省 false
    }
    let list2: Array<{ x: number; y: number }> | null = null;
    if (!isClearSpotTest(world, this.x, this.y, this.w, this.h, Math.abs(this.vy), gd, true)) {
      list2 = findCollisionTileVertical(world, dir, this.x, this.y,
        this.w, this.h, Math.abs(this.vy), gd, true);
    }
    if (list && list2) {
      for (const p of list2) {
        if (!list.some((q) => q.x === p.x && q.y === p.y)) list.push(p);   // :57749-57755 去重并入
      }
    } else if (!list && list2) {
      list = list2;                                                        // :57757-57760
    }
    if (list) this.touchedTiles = list;                                    // :57761-57764
  }

  /** ★SW-FX47（e）：跳跃参数 base 段单源（UpdateJumpHeight :19714-19758 前半——
   *  jumpBoost 钳 / jumpSpeedBoost(jumpSpd) 累加 / 折叠凳·狼人 jumpHeight 项 /
   *  坐骑 additive(滚轴鞋 57-60)叠加或赋值覆盖臂）。消费位：①移动相头弹跳臂
   *  前置快照（原版 :26211 先于 :26889 HorizontalMovement 的调用序）；②物理相
   *  跳参链（原 base 内联式,数值逐位同源）。honey(sticky)/dazed 两尾削弱在
   *  UpdateJumpHeight 尾段（:19759-19766）,由各消费位自行施加（返回值未含）。
   *  ★BJ704-G5（G4-①）baseSpd/baseTicks 可选参数=液体档基（原版序 :24611/:24624
   *  覆写 jumpSpeed/jumpHeight 后整段过 UpdateJumpHeight → 液体基+boost 尾+
   *  坐骑臂全链）——骑乘叠加族（滚轴鞋）湿态水跳单源重算;缺省干档（旧行为）。 */
  private jumpBaseSnapshot(vx: number, baseSpd = PLAYER_JUMP_SPEED, baseTicks = PLAYER_JUMP_TICKS): { spd: number; ticks: number } {
    const eqJ = this.equipStats;
    let baseJumpSpd = baseSpd;
    let baseJumpTicks = baseTicks;
    if (eqJ.jumpBoost) {
      baseJumpTicks = Math.max(baseJumpTicks, 20);
      baseJumpSpd = Math.max(baseJumpSpd, 6.51);
    }
    // ★BJ216 注：翱翔徽章 jumpSpeedBoost+1.8（:19721-19724）不走此处手码——原版
    //  经 jumpSpeed 字段同样喂 WingMovement/火箭脉冲/起跳三消费端,本仓对应
    //  eqM.jumpSpd 聚合位（vanilla-accfx.json '4989'.jumpSpd 手补钉值,见该文件注）,
    //  在 jumpBaseSnapshot(:9368 baseJumpSpd+=eqJ.jumpSpd)与翼飞 JS(PLAYER_JUMP_SPEED
    //  +eqM.jumpSpd)两处同源生效。moonLordLegs 的 +1.8 曾仅此快照单点（BJ216 登记
    //  的同族缺口）,★BJ220 已同式迁 accfx '5001'.jumpSpd→甲件主属性环→eqM.jumpSpd。
    // 月亮领主腿（UpdateJumpHeight :19731-19734）：jumpSpeedBoost += 1.8 走聚合位
    // （上方 baseJumpSpd+=eqJ.jumpSpd 接）;extraFall += 10 走甲件旗位(:2522);
    // jumpHeight++ = 下方 baseJumpTicks+1。
    if (eqJ.moonLordLegs) baseJumpTicks += 1;
    if (this.buffs.has(BuffType.Werewolf)) baseJumpTicks += 2;   // :19738 jumpHeight += 2（速度 +0.2 已在 jumpSpd :19739）
    if (this.stoolInUse) baseJumpTicks += 5;                     // :19741-19744 折叠凳 +5
    baseJumpSpd += eqJ.jumpSpd;
    const mnt2 = this.ridingMount ? this.mount : null;
    const jumpAdditive = mnt2?.movementStatsAdditive === true;   // :19748-19757
    const spd = mnt2
      ? (jumpAdditive ? baseJumpSpd + mnt2.jumpSpeed(vx) : mnt2.jumpSpeed(vx))
      : baseJumpSpd;
    const ticks = mnt2
      ? (jumpAdditive ? baseJumpTicks + mnt2.jumpHeight(vx) : mnt2.jumpHeight(vx))
      : baseJumpTicks;
    return { spd, ticks };
  }

  /** ★SW-FX47（b·gd 无关整支新增）：TryBouncingBlocks（Player.cs:35102-35165）——
   *  弹跳块族落地反弹：门 `!wet && !shimmering && (vy≥5 || vy≤-5)`（:35104）→
   *  TouchedTiles 顺序扫首个 active∧nactive∧tileBouncy 格（:35113-35124,原版
   *  `(flag || tileBouncy)` 的 flag 恒 false=死旗,条件折叠为 tileBouncy）→
   *  vy×=-0.8（:35127）+ controlJump 钳 ±13（:35128-35130）→ 位钳到弹跳面
   *  （:35131 `position.Y = row*16 - (vy<0 ? height : -16)`——反弹向上=脚贴块顶,
   *  gd=-1 反弹向下=头顶贴块底）→ FloorVisuals(Falling)（:35134——旗块面+落地尘,
   *  本仓旗块相在移动相头 :4272 一拍内自愈,尘面经 makeFloorDust 带 !wet&&!Cart 闸
   *  :23931）→ vy 钳 ±20（:35161）→ 反弹向与重力反向时 fallStart 重置（:35162-35164
   *  `vy*gravDir<0 → fallStart=position.Y/16`,本仓 fallStartY 像素口径同源）。
   *  ★flag2/Keybrand 编排支（:35135-35158）不接——原版死支（`bool flag2=false`
   *  声明后全程无置位句,Keybrand 尘不可达;syncModules.ts module8 注同判）。
   *  ★双触发面（缺一不可,原版两路皆经 :35104 同一门）：
   *  ①【凌空拍】原版碰撞未截断（未及落面）时 velocity.Y=全速,探针窗
   *  （position+velocity 后 16px,FX40-g 同参）见弹跳格 → 意图脚（F+vy)入格行
   *  才报行（FindCollisionTile 行=探针盒前缘行 Collision.cs:2614）→ 反弹先于落地;
   *  ②【落地拍】原版碰撞截断后 velocity.Y=残量（Collision.cs:2401
   *  `result.Y=块顶−移前脚`）→ |vy|=残量过 ≥5 门=落地拍反弹（残量∈[5,vy) 带）。
   *  本仓 moveAxis 落地硬清零 vy（TileCollision.ts moveAxis b.vy=0,通用碰撞层
   *  语义不可动）→ 落地拍以本拍垂直位移 dy=y−preY 重建残量（=块顶−移前脚同值;
   *  gd=-1 天然反号）。落地拍标记=本拍轴碰撞位（hitDown/hitHead,moveAndCollide
   *  头逐拍复位）非 onGround——倒挂 onGround=hitHead 上拍值（:5948）滞一拍;
   *  界门 dy∈(0,impactVy]（gd=-1 镜像）——排除 StepDown 吸附
   *  （吸附距∈(7,17)>impactVy=重力值,Collision.cs:3632 gap 窗;吸附拍原版
   *  velocity.Y 不截断恒 0.4=不反弹;吸附不置 hitDown/hitHead 天然过门）与
   *  坡面贴合（slopeCollide 置 onGround 不置 hitDown=排除,贴合量≠残量=备案近似）。
   *  落地拍触碰行：原版意图盒（position+velocity=面下残量深处）入块行 →
   *  FindCollisionTile 报脚下行（Collision.cs:2614 前缘行）;本仓 vy=0 意图盒贴面,
   *  忠实探针（FX40-g）扫空 → 脚下行直扫同值集（行=意图盒行,逐列首弹跳格）。
   *  ★DryCollision 亚像素环第二调用位（:23756）不另接:本仓 moveAndCollide 统一
   *  分轴碰撞管线（无 DryCollision 亚像素环承载位）,:28433 主环位覆盖弹跳主路径。
   *  弹跳格族 TILE_BOUNCY_SHEETS={371,446,447,448}（Main.cs:9626-9629）。 */
  private tryBouncingBlocks(game: GameHooks, world: import('../world/World').World,
    falling: boolean, preY: number, impactVy: number): void {
    const gdSign = this.gravDir === -1 ? -1 : 1;
    const wet = this.inWater || this.inLava || this.inHoney || this.inShimmer;
    // :35104 门——vy 取原版碰撞后语义：凌空拍=全速（本仓同值）；落地拍=残量重建
    let vyGate = this.vy;
    let landedFloorRow = -1;
    const landedThisTick = gdSign === 1 ? this.hitDown : this.hitHead;   // 本拍轴碰撞标记
    if (landedThisTick && this.vy === 0) {
      const dy = this.y - preY;                        // 本拍垂直位移=块顶−移前脚（:2401 残量）
      const inResidualBand = gdSign === 1
        ? (dy > 0 && dy <= Math.abs(impactVy))
        : (dy < 0 && -dy <= Math.abs(impactVy));       // impactVy 带符号（倒挂为负）→ 取模
      if (inResidualBand) {
        vyGate = dy;                                   // 原版碰撞后 velocity.Y=±残量
        // 落地拍弹跳行=脚下行（正挂）/头顶行（倒挂,头顶贴块底）
        const floorRow = gdSign === 1
          ? Math.floor((this.y + this.h) / TILE)
          : Math.floor((this.y - 0.01) / TILE);
        const c0 = Math.floor(this.x / TILE);
        const c1 = Math.floor((this.x + this.w - 0.01) / TILE);
        for (let cx = c0; cx <= c1; cx++) {
          if (!world.store.inBounds(cx, floorRow)) continue;
          if (!world.store.hasTile(cx, floorRow)) continue;                 // active()∧nactive()
          const sheet = TILE_DEFS[world.store.type[world.store.idx(cx, floorRow)]]?.vanilla?.sheet ?? -1;
          if (TILE_BOUNCY_SHEETS.has(sheet)) { landedFloorRow = floorRow; break; }
        }
      }
    }
    if (wet || this.shimmering || !(vyGate >= 5 || vyGate <= -5)) return;   // :35104 门
    let row = landedFloorRow;                                                // num3
    if (row < 0) {                                                           // :35113-35124
      for (const t of this.touchedTiles) {
        if (!world.store.inBounds(t.x, t.y)) continue;
        if (!world.store.hasTile(t.x, t.y)) continue;                        // active()∧nactive()
        const sheet = TILE_DEFS[world.store.type[world.store.idx(t.x, t.y)]]?.vanilla?.sheet ?? -1;
        if (TILE_BOUNCY_SHEETS.has(sheet)) { row = t.y; break; }
      }
    }
    if (row < 0) return;                                                     // :35125-35127 !flag3
    this.vy = vyGate * -0.8;                                                 // :35127
    if (this.inputJump) this.vy = Math.max(-13, Math.min(13, this.vy));      // :35128-35130 Clamp
    this.y = row * TILE - (this.vy < 0 ? this.h : -TILE);                    // :35131 位钳
    // FloorVisuals(Falling)（:35134）——尘面（旗块面见方法注备案）。MakeFloorDust
    // 内门 `!wet && !mount.Cart`（:23931）：wet 已被外门排除,Cart 面照原文保留
    const cartFx = this.ridingMount && this.mount.isCart;
    if (!cartFx) this.makeFloorDust(game, falling, world);
    this.vy = Math.max(-20, Math.min(20, this.vy));                          // :35161 Clamp ±20
    if (this.vy * gdSign < 0) this.fallStartY = this.y;                      // :35162-35164
  }

  /** ★SW-FX40（d·gd 无关整支新增）：MakeFloorDust（:23981-24234）——行走/落地地板
   *  尘（踩草 76/沙 32/雪冰 16/便便 322-328/泥土 0/黏土 36…逐型映射表）+ 落地
   *  Falling 20 连发 + 便便族落地音 Item177。调用位 = 碰撞积分后 FloorVisuals
   *  （:28479-28482 `vy==0 && grappling[0]==-1`），内部再过 `!wet && !mount.Cart`
   *  （:23931）。canCarpet 语境无关=两 gravDir 同表（gd=-1 出尘位/速度镜像
   *  :24175-24177/:24229-24231 照原文）。659/667 微光块支（:23983-24009）粒子
   *  载体 = ParticleOrchestration ShimmerBlock 编排（★SW-FX47 清偿：Spawn_
   *  ShimmerBlock 本体已在 fx/orchestraFx.shimmerBlockFx 收编、Game.ts:31455
   *  派发在位,原 producer 空转——本方法补 RequestParticleSpawn 面;clientOnly:
   *  true 本地直驱不上网,syncModules.ts module8 注同口径）。flag2（tile19
   *  style49 棕榈木平台,frameY/18==49）★SW-FX47 清偿：frameY 材质行在
   *  st.frameY（TileStore,平台族 PlaceTile case19 `frameY=18*style` 同源）,
   *  且 readFloorTile 已扩平台行为族臂（见其注）——style49 面可判。 */
  private makeFloorDust(game: GameHooks, falling: boolean, world: import('../world/World').World): void {
    const fl = this.readFloorTile(world);
    const ft = fl.id;
    if (ft < 0) return;                                       // num3<=-1 早退（FloorVisuals :23913-23917）
    const st = world.store;
    const type = TILE_DEFS[ft]?.vanilla?.sheet ?? -1;         // 本仓 id → 原版 sheet id
    const paintColor = st.paint[st.idx(fl.col, fl.row)] ?? 0; // floorTile.color()（:23933 实参）
    const vd = game.vanillaDust;
    if (!vd) return;
    // 微光块 659/667 支（:23983-24009）：行走掷骰门 flag（!Falling → |vx|/3 概率
    //  减半计数）+ ShimmerBlock 编排粒子本地直驱。掷序照原文：位偏移 2 掷
    //  （width×NextFloat / 6×NextFloat）→ NextVector2Circular(0.8,0.8) 2 掷
    //  （Utils.cs:1301-1304 = NextVector2Unit 角掷 × NextFloat 半径掷,F6 口径）
    //  → Y>0 反号（:24006-24008）。UniqueInfo 缺省 0 → Spawn_ShimmerBlock
    //  scaleMul 兜底 1（ParticleOrchestrator.cs:2360-2364）。
    if (type === 659 || type === 667) {
      let shimmerOk = true;
      if (!falling) {
        const num = Math.abs(this.vx) / 3;
        if (Math.random() * 100 > num * 50) shimmerOk = false;
      }
      if (!shimmerOk) return;
      const sx = this.x + this.w * Math.random();                    // :24001 width×NextFloat
      const sy = this.y + this.h - 2 + 6 * Math.random();            // :24001 +6×NextFloat
      const ang = Math.random() * Math.PI * 2;                       // NextVector2Unit 角掷
      const rad = Math.random();                                     // ×NextFloat 半径掷
      let mvx = Math.cos(ang) * rad * 0.8;
      let mvy = Math.sin(ang) * rad * 0.8;
      if (mvy > 0) mvy *= -1;                                        // :24006-24008
      shimmerBlockFx(game, sx, sy, mvx, mvy);                        // :24002-24008 clientOnly:true
    }
    // flag2（:24010 `type == 19 && frameY / 18 == 49`）：19 木平台 style49=棕榈木
    // 平台材质行（frameY=18×49=882,整除域 [882,899] 同判）。frameY 读本仓
    // st.frameY（活格真帧;非活格哨兵 65535/18≠49 自然排除）
    const flag2 = type === 19
      && Math.floor((st.frameY[st.idx(fl.col, fl.row)] ?? 0) / 18) === 49;
    const inBig = (type === 147 || type === 25 || type === 53 || type === 189) || flag2;
    const smalls = [0, 123, 57, 112, 116, 196, 193, 195, 197, 199, 229, 234, 371, 460, 666, 712, 717, 718, 719];
    if (!inBig && !smalls.includes(type)) return;             // :24011-24013 允许集闸
    let count = 1;                                            // num2
    if (falling) {
      count = 20;
      if (type === 666 || type === 712) {
        game.playSfxFile?.('Item_177', 1, this.cx, this.y + this.h);   // :24021 SoundID.Item177
      }
    }
    for (let i = 0; i < count; i++) {
      let keep = true;                                        // flag3
      let num3 = 76;
      if (type === 666 || type === 712) {
        if (paintColor !== 0) break;                          // :24030-24033 涂色便便不出尘
        num3 = 322;
      }
      if (type === 53) num3 = 32;
      if ((type === 189) || flag2) num3 = 16;
      if (type === 717) num3 = 326;
      if (type === 718) num3 = 327;
      if (type === 719) num3 = 328;
      if (type === 0) num3 = 0;
      if (type === 123) num3 = 53;
      if (type === 57) num3 = 36;
      if (type === 112) num3 = 14;
      if (type === 234) num3 = 122;
      if (type === 116) num3 = 51;
      if (type === 196) num3 = 108;
      if (type === 193) num3 = 4;
      if (type === 195 || type === 199) num3 = 5;
      if (type === 197) num3 = 4;
      if (type === 229) num3 = 153;
      if (type === 371) num3 = 243;
      if (type === 460) num3 = 108;
      if (type === 25) num3 = 37;
      // 稀疏族掷骰（:24112-24135）
      if ((num3 === 32 || num3 === 14 || num3 === 51 || num3 === 36) && Math.random() < 0.5) keep = false;
      if ((num3 === 0 || num3 === 53) && Math.floor(Math.random() * 3) !== 0) keep = false;
      let color: import('../fx/VanillaDust').DustColor | null = null;   // newColor（:24136-24148）
      if (type === 193) color = { r: 30, g: 100, b: 255, a: 100 };
      if (type === 197) color = { r: 97, g: 200, b: 255, a: 100 };
      if (type === 460) color = { r: 100, g: 150, b: 130, a: 100 };
      if (!falling) {
        const num4 = Math.abs(this.vx) / 3;
        if (Math.random() * 100 > num4 * 100) keep = false;   // :24151-24155 行走概率=|vx|/3
      }
      if (!keep) continue;
      const num5 = Math.max(-6, Math.min(6, this.vx));        // :24161-24169
      if (!(Math.abs(this.vx) + Math.abs(this.vy) > 1) && !falling) continue;  // CanSpawnWalkingEffects :36034
      const d = vd.spawn(this.x, this.y + this.h - 2, this.w, 6, num3, 0, 0, 50, color, 1);  // :24174
      if (!d) continue;
      if (this.gravDir === -1) d.y -= this.h + 4;             // :24175-24177
      if (num3 === 76) { d.scale += Math.floor(Math.random() * 3) * 0.1; d.noLight = true; }
      if (num3 === 16 || num3 === 108 || num3 === 153 || num3 === 326 || num3 === 327 || num3 === 328) {
        d.scale += Math.floor(Math.random() * 6) * 0.1;
      }
      if (num3 === 37) { d.scale += 0.25; d.alpha = 50; }
      if (num3 === 5) d.scale += (2 + Math.floor(Math.random() * 6)) * 0.1;   // Next(2,8)
      d.noGravity = true;
      if (num3 === 322) {
        if (Math.floor(Math.random() * 4) === 0) { d.noGravity = false; d.scale *= 1.1; }
        else d.scale *= 1.2;
      }
      if (count > 1) {
        d.vx *= 1.2; d.vy *= 0.8; d.vy--; d.vx *= 0.8; d.vy *= 0.8;   // :24212-24215 依原序
        d.scale += Math.floor(Math.random() * 3) * 0.1;
        d.vx = (d.x - (this.x + this.w / 2)) * 0.2;
        if (d.vy > 0) d.vy *= -1;
        d.vx += num5 * 0.3;
      } else {
        d.vx *= 0.2; d.vy *= 0.2;
      }
      d.x -= num5;
      if (this.gravDir === -1) d.vy *= -1;                    // :24229-24231
    }
  }

  /** ★SW-FX1：WallslideMovement 尘 31（1457 :21961-21975 ≥2 ↓ 支 / :22002-22015
   *  tier1 恒出支 1:1）——出生盒 = (position.X+width/2+(width/2-4)*slideDir,
   *  position.Y+height/2+(height/2-4)*gravDir) 8×8;slideDir<0 时 position.X −10
   *  （:21966-21968,gravDir<0 的 −12 支本仓无倒挂域=不接）、vel×0.1、scale×1.2、
   *  noGravity。cShoe 染料 shader 面（:21975 GetSecondaryShader）染尘未建模=登记。 */
  spawnWallSlideDust(game: GameHooks, slideDir: number): void {
    const vd = game.vanillaDust;
    if (!vd) return;
    const px = this.x + this.w / 2 + (this.w / 2 - 4) * slideDir;
    // ★SW-FX19：py ×gravDir（:21967/:22006 `position.Y+height/2+(height/2-4)*gravDir`——
    //   倒挂时尘贴"脚侧"=身体上半侧;gravDir=1 数值恒等）
    const py = this.y + this.h / 2 + (this.h / 2 - 4) * this.gravDir;
    const d = vd.spawn(px, py, 8, 8, 31);
    if (!d) return;
    if (slideDir < 0) d.x -= 10;
    d.vx *= 0.1; d.vy *= 0.1;
    d.scale *= 1.2;
    d.noGravity = true;
  }
  /** 老鼠坐骑 55 爬墙钉速（WallClimbMovement :21329-21450 非 spiked 支：-2/4/0.5；null=未爬） */
  ratClimbVy: number | null = null;
  // ---- 拾取半径族（★⑧ 台账清偿 2026-08-31；P.cs GetItemGrabRange :35405-35455
  //      + Item.cs:43-49 常量真值：defaultItemGrabRange=42/coinGrabRange=350/
  //      manaGrabRange=300/lifeGrabRange=250/treasureGrabRange=150）----
  /** Player.GetItemGrabRange 逐物品【加成段】正解(不含 base=42,原版 base 由调用方
   *  预算;含全部物品条件项,双源可叠加):
   *   · treasureMagnet 全类 +150(:35429-35431)
   *   · goldRing 且 IsACoin{71-74}(Item.IsACoin :373) +350(:35412-35415)
   *   · manaMagnet 且星族{184,1735,1868} +300(:35417-35419)
   *   · 4143 法力斗篷之星恒 +300(:35421-35423——不走装备门)
   *   · lifeMagnet(buff105 拾心药水)且心族{58,1734,1867} +250(:35425-35427)
   *   · 3822 埃特尼亚魔力恒 +50(:35433-35434)
   *   · ItemID.Sets.NebulaPickup{3453,3454,3455}(ItemID.cs:1116)恒 +100(:35436-35438)
   *  (difficulty==3 远放置距离创意权限 +240 未建模=旅程支登记)
   *  ★消费面已接（终零波 GRAB_RANGE 一行改造,2026-09-01）：ItemDrop.ts 拉取半径
   *  复合式现按本方法逐 vid 读（帧扫描路径经 dropScanCtx.grabRangeBonusFor 等价
   *  展开,币/星/心/4143/3822/Nebula 六项全部生效——旧 grabRangeBonus(-1)+
   *  heart/star 两分类拼装 retired,但 getter 保留为快照兼容面）。 */
  getItemGrabRangeBonus(vanillaVid: number): number {
    const eq = this.equipStats;   // ★IIIII250 快照(2 直读→1;每掉落物每拍调用)
    let num = 0;
    if (eq.treasureMagnet) num += 150;
      // (★IIIII250 合并入函数级快照 eq)
    if (eq.goldRing && vanillaVid >= 71 && vanillaVid <= 74) num += 350;   // IsACoin(71..74)
    if (eq.manaMagnet
      && (vanillaVid === 184 || vanillaVid === 1735 || vanillaVid === 1868)) num += 300;
    if (vanillaVid === 4143) num += 300;   // 独立恒真门(:35421-35423)
    if ((this.buffs.has(BuffType.Heartreach))
      && (vanillaVid === 58 || vanillaVid === 1734 || vanillaVid === 1867)) num += 250;
    if (vanillaVid === 3822) num += 50;
    if (vanillaVid === 3453 || vanillaVid === 3454 || vanillaVid === 3455) num += 100;
    return num;
  }
  /** 全类磁石项（treasureMagnet,px）。★修正:旧 `magnet?94:(goldRing?12:0)` 三元把
   *  金戒指的币族专属 +350 做成全物品 +12 且与磁石互斥——原版两源叠加、金戒指只
   *  对币族生效(GetItemGrabRange :35409-35452)。金戒指 blanket 项退役,值改 1458
   *  真值 150；币族等逐物品档已迁 getItemGrabRangeBonus() 正解位 */
  get grabRangeBonus(): number {
    return this.getItemGrabRangeBonus(-1);
  }
  /** 红心拾取范围扩展（buff105 拾心药水 lifeMagnet；Item.cs:47 lifeGrabRange=250） */
  get heartGrabBonus(): number {
    return this.buffs.has(BuffType.Heartreach) ? 250 : 0;
  }
  /** 魔力星拾取范围扩展（魔力磁石族 manaMagnet；Item.cs:44 manaGrabRange=300；
   *  星族 vid 判定在消费侧 pickup==='star' 分支承载 = 原版 type∈{184,1735,1868} 门） */
  get manaMagnetBonus(): number {
    return this.equipStats.manaMagnet ? 300 : 0;   // ★IIIII250 回滚过冲替换:独立 getter 非快照作用域
  }
  /** 幸运度聚合态（src/stats/Luck.ts LuckState；环境因子由 Game 扫描写入，
   *  RecalculateLuck :28672-28697 各项见 LuckState 注释） */
  readonly luckState = new LuckState();
  /** 吸血预算（Player.cs:962 初始 99999 → 首帧 Update 钳到上限；本体语义 =
   *  每秒可吸血总量池）。Game 每 tick 回充：普通 +0.6 钳 80 / 专家 +0.5 钳 70
   *  （:24196-24216）。吸血命中扣全额浮点（Projectile.cs:11417/:11444） */
  lifeSteal = 80;
  /** 幽灵伤害头预算池（Player.cs:991 `public float ghostDmg`；Spectre Mask 套装
   *  magic 弹 on-hit 弹 356 的入账面，Projectile.cs:12034/:12038——cap 1500 检查+
   *  全额按弹基伤入账）。衰减在 fixedUpdate：Player.cs:24654-24660 每拍
   *  −6.6666665f 钳非负。读写统一走 SpectreSoulProj 三函数缝（bindGhostBudgetHost
   *  已钉本实例为真源） */
  ghostDmg = 0;
  /** 弩车恐慌旗（buff 205,Player.cs:38526 Hurt 内 `setSquireT2 → AddBuff(205,300)）——
   *  本仓以数值窗承载（无独立 BuffType 条目,免增 l10n 面）；消费端 =
   *  MinionProj.dd2SetFlags().ballistaPanic（GetBallistraShotDelay 60/30 档）。授予位
   *  在 damage()（=Hurt 闪避早退族之后、stealth 复位同段,与原文 :38526 位次同构） */
  ballistaPanicT = 0;
  /** 幸运值（RecalculateLuck Player.cs:29367-29394 1:1，2026-08-31 实锚重校——1456 旧注
   *  :28672-28697 已漂移+695；更早的 28694/28700 族行号一并作废）：
   *  luck = 瓢虫×0.2 + 火炬×0.2 + 药水档×0.1 + 风筝档×0.1/3 + 银河珍珠 0.03
   *        + 灯笼夜 0.3 + 地精 0.2 − 臭屁 0.25 + 装备 + 钱币 − 碎镜 0.25。
   *  不 clamp——luckMinimumCap=-0.7/luckMaximumCap=1（Player.cs:3071/3073）只喂 UI 计量
   *  （:4098-4103），聚合本体可超界（原版如此）。
   *  来源接线：药水 buff 257 三档 / 灯笼夜 / 地精+火炬（Game 15t 扫描）/ 装备（幸运币
   *  {855,3034,3035} +0.05、马掌族九件 +0.05、四叶草族 5574/5575/5576 +0.03/−0.1/−0.1
   *  ——luckEquipmentBonus，Player.cs:13148-13168；clover 判定置位 :12820/:12824）已接；
   *  瓢虫 604/605（击杀=坏运 NPC.cs:78861-78862 LadyBugKilled(:82403)；触碰=好运
   *  NPC.cs:78740 LadyBugLuck(:82437)——旧注 359/360 为误记，实为蜗牛）、
   *  buff 383 风筝三档、buff 120 臭屁、银河珍珠 5340、碎镜 1085、微光化币——均已接
   *  （来源状态权威见 src/stats/Luck.ts 头注） */
  get luck(): number {
    const l = this.luckState;
    let v = l.ladyBugLuck * 0.2 + l.torchLuck * 0.2;        // RecalculateLuck :29369
    v += this.luckPotionTier * 0.1;                          // :29370（buff 257 三档）
    v += this.kiteLuckTier * (0.1 / 3);                      // :29371（buff 383 三档）
    if (l.usedGalaxyPearl) v += 0.03;                        // :29372-29375
    if (l.lanternsUp) v += 0.3;                              // :29376-29379
    if (l.hasGardenGnomeNearby) v += 0.2;                    // :29380-29383
    if (l.stinky || this.buffs.has(BuffType.Stinky)) v -= 0.25; // :29384-29387（buff 120 → stinky；l.stinky 为环境外注入位）
    v += this.luckEquipmentBonus;                            // :29388
    v += l.coinLuckValue;                                    // :29389
    if (l.brokenMirrorBadLuck) v -= 0.25;                    // :29390-29392
    return v;
  }
  /** luckPotion（Player.cs:10372-10388 buff 257 分档）：0 无 / >600s=3 / >300s=2 / 其余 1 */
  get luckPotionTier(): number {
    const left = this.buffs.active.get(BuffType.Luck);
    if (left === undefined) return 0;
    return left > 600 ? 3 : left > 300 ? 2 : 1;
  }
  /** kiteLuckLevel（Player.cs:9618-9623 buff 383）：clamp(buffTime/10800, 0, 3)——
   *  active 存秒，10800t=180s 一档；无 buff = 0（luck += 档×0.1/3 :28675） */
  get kiteLuckTier(): number {
    return this.buffs.kiteLuckLevel;
  }
  /** equipmentBasedLuckBonus（Player.cs:12628-12646，UpdateEquips 尾段逐旗加和）：
   *  ★取值语义：五旗各是【bool】——每种类型只计一次（多槽同款不叠），旗间【加法】
   *    非取最大（四叶草+0.03 / 枯萎−0.1 / 乌鸦羽−0.1 / 马掌族+0.05 / 幸运币+0.05，
   *    Player.cs:12628-12646 五个独立 if）。
   *  ★作用域：四叶草三旗经 RefreshInfoAccsFromItemType（:12321-12332）置位——
   *    UpdateEquips :12494-12498 对【全背包 0-57 + 装备槽 armor[0-9]（经
   *    GrantArmorBenefits :12683-12685）】逐槽刷新 → 口袋里带着就生效（原版
   *    1.4 信息饰品同机制，非装备位限定）；马掌/幸运币旗在 ApplyEquipFunctional
   *    （:12540-12546 仅 armor[3-9] 功能配饰槽）——装备位限定。
   *  hasLuck_LuckyHorseshoe 物品全集（ApplyEquipFunctional 9 处赋值）：158/396/
   *  1250/1251/1252/3250/3251/3252/5331（= accfx noFallDmg 集合减 6146）；
   *  hasLuck_LuckyCoin：855/3034/3035（= accfx luckyCoin 集）。曾只判 158——
   *  马掌族运气+0.05 对 396 黑曜石马掌/气球族/翱翔徽章全漏（2026-08-20 修） */
  private static readonly LUCK_HORSESHOE_VIDS = new Set([158, 396, 1250, 1251, 1252, 3250, 3251, 3252, 5331]);
  /** 四叶草族（RefreshInfoAccsFromItemType :12321-12332：hasLuck_LuckyClover/
   *  WiltedClover/RavenFeather → :12628-12646 +0.03/−0.1/−0.1） */
  private static readonly LUCK_CLOVER_BONUS: Record<number, number> = { 5574: 0.03, 5575: -0.1, 5576: -0.1 };
  get luckEquipmentBonus(): number {
    let b = this.equipStats.luckyCoin ? 0.05 : 0;      // :12640-12646 hasLuck_LuckyCoin
    // hasLuck_LuckyHorseshoe = 精确九件集（ApplyEquipFunctional 赋值处），armor[3-9]
    let horseshoe = false;
    for (let i = ACC_ARMOR_START; i < 10 && !horseshoe; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // ★清偿刀 P :13044 门
      const s = this.inv.armor[i];
      if (!s) continue;
      // ★清偿刀 U：expertOnly 效益门（hasLuck_LuckyHorseshoe = ApplyEquipFunctional
      //   赋值族,:14475-14478 头门内;四叶草臂不同——RefreshInfoAccs :12722 由
      //   Main.cs:17548 帧路径调,原版不设门）
      if (ITEM_DEFS[s.id]?.expertOnly && !(this.inv.gateExpert || this.inv.gateMaster)) continue;
      if (Player.LUCK_HORSESHOE_VIDS.has(ITEM_DEFS[s.id]?.vid ?? -1)) horseshoe = true;
    }
    if (horseshoe) b += 0.05;                          // :12628-12631
    b += this.modLuckBonus;   // ★五百零三:mod 装备运气加算面(OldDie/MOAB 族)
    // 四叶草三旗：背包 0-57 + 装备槽 armor[0-9]（UpdateEquips :12494-12530 双扫描）
    let clover = 0, wilted = 0, raven = 0;
    const see = (vid: number) => {
      if (vid === 5574) clover = 1;
      else if (vid === 5575) wilted = 1;
      else if (vid === 5576) raven = 1;
    };
    for (let i = 0; i < this.inv.slots.length; i++) {
      const s = this.inv.slots[i];
      if (s) see(ITEM_DEFS[s.id]?.vid ?? -1);
    }
    for (let i = 0; i < 10; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // ★清偿刀 P：RefreshInfoAccs :12722 同门
      const s = this.inv.armor[i];
      if (s) see(ITEM_DEFS[s.id]?.vid ?? -1);
    }
    // 虚空透镜扫描（RefreshInfoAccs :12707-12728）：背包持有 4131 虚空透镜(VoidLens)时 bank4 逐槽
    // WorksInVoidBag(默认全真,SetFactory.cs:97-107 仅两只海螺除外)→ 袋内四叶草
    // 同样置旗——复审 R1 P2(曾漏,袋内 5574 少 +0.03)
    // ★B3 修(2026-08-30)：原写 banks[4] 恒 undefined → 循环静默零跑（本仓 bank4
    // =banks[3],Player.ts:467 注);修正后袋内四叶草才真正计幸运
    const hasVoidLens = this.inv.slots.some((s) => s && (ITEM_DEFS[s.id]?.vid ?? -1) === 4131);
    if (hasVoidLens && this.banks[3]) {
      for (const s of this.banks[3]) {
        if (s) see(ITEM_DEFS[s.id]?.vid ?? -1);
      }
    }
    if (clover) b += 0.03;                             // :12628 hasLuck_LuckyClover
    if (wilted) b -= 0.1;                              // :12632-12635 hasLuck_WiltedClover
    if (raven) b -= 0.1;                               // :12636-12639 hasLuck_RavenFeather
    return b;
  }
  inputDown = false;
  inputUp = false;
  /** controlTorch（TriggersSet.cs:794 火把键电平）：Game 输入合成段每帧写
   *  （SmartSelect 同源绑定）——AFK 计数门六键之一（Player.cs:25692）。 */
  inputTorch = false;
  onRope = false;

  /** afkCounter（Player.cs:969）：站立不动的连续 tick 计。消费面 =
   *  NPC.cs:412 `noGroundWorms = player.afkCounter >= 300`
   *  （AFKTimeNeededForNoWormSpawns :971）→ SetSpawnFlagsForChosenTile :1053
   *  `!skyMob && noGroundWorms` → noWorms=true（挂机玩家不再出蠕虫族）。
   *  计数链在 fixedUpdate 尾（IsConsideredStandingStill && 六输入皆空 &&
   *  (itemAnimation==0 || 风筝持械)）；Select 族换栏清零(:498-499)。 */
  afkCounter = 0;
  /** afkCounterForKiting（Player.cs:975）：与 afkCounter 同条件同拍步进
   *  （:25696-25702 同一 if/else），独有清零面=光标持物（:25702-25704）/
   *  petting·sitting·sleeping（:25705-25710）；消费=PickItemSelectionOverride
   *  （Player.cs:17537）——≥AFKTimeNeededForAutoKiting(3600) ∧ selectedKite≥0
   *  ∧ !noItems ∧ !isOperatingAnotherEntity ∧ spectating<0 → 自动选中风筝槽
   *  （holdStyle==0 再置 controlUseItem=releaseUseItem=true 自动使用）。
   *  ★Q4 刀 2026-09-30（BJ413 登记）建模；Select 族换栏同清（Game 键位段）。 */
  afkCounterForKiting = 0;
  /** selectedKite（Player.cs:1447）：背包内首个风筝物品槽（RefreshAutoKitingFrom-
   *  ItemTypeAndSlot :12939-12944 `selectedKite <= -1 && IsAKite[accType]` → slot）。
   *  每 tick 重算（ResetEffects :18548 清 -1 → UpdateEquips :12994 HeldItem 槽优先
   *  + :13001 0..57 顺序扫）——首个（含手持位）IsAKite 槽胜出,无风筝=恒 -1。
   *  消费=PickItemSelectionOverride AFK 臂（Game.updateSmartSelect 尾,本仓承载）。 */
  selectedKite = -1;
  /** pendingItemReuse（Player.cs:1443,ItemCheck :43148-43151 写真）：
   *  动画归零拍 autoReuse 持续按压（且无 reuseDelay 后摇）置真、下一 ItemCheck
   *  头复位（:42921）——UsingOrReusingItem(:4052) 的「复用间隙仍在用」窗，
   *  消费=SelectedItemState.CanChangeImmediately(:415) 与施法态判定。
   *  本仓生命周期：updateSwingHits 归零拍（autoReuse+mouseHeld 门）写真 →
   *  updateUse 头复位；Game.usingOrReusingItem() 聚合读。 */
  pendingItemReuse = false;

  /** 受击：防御减伤公式 max(1, dmg - defense*0.5)（移植自 Maples Player.OnAttacked）。
   *  knockback=false 用于窒息等环境伤害（只掉血不击退） */
  /** 受伤预览（与 damage() 同口径：难度防御系数 0.5/0.75/1.0 + endurance）——
   *  供调用方飘字使用，避免显示≠实扣（Main.cs:65646 CalculateDamagePlayersTake） */
  damagePreview(dmg: number): number {
    // ★R15-F9：与 damage() 拆步截断同步（甲虫自 endurance 和拆出=独立乘区各自
    //   (int);预演不消耗球,用当前 orbs 即实扣该拍值——damage 消耗亦在该拍结算后）。
    const endurance = (this.buffs.has(BuffType.Endurance) ? 0.1 : 0)
      + (this.equipStats.enduranceEq ?? 0)   // 日曜套 0.12（与 damage 同口径,2026-08-13 同步）
      + this.modEnduranceDyn   // ★五百七十九:mod 每帧动态面(PSC 夜相;与 damage 同口径)
      // 冰障 buff 62（:10127-10152）：半血以下 endurance += 0.25
      // 冰障 buff 62（:10127-10152）：半血以下 endurance += 0.25
      + (this.buffs.has(BuffType.IceBarrier) && this.hp <= this.maxHp / 2 ? 0.25 : 0);
    // 日曜护盾层预览不模拟消耗（取决于 damage 实际扣减序）,登记
    const diff = scaleStatsWorld().difficulty;
    const defF = diff >= GDL.MASTER ? 1 : diff >= GDL.EXPERT ? 0.75 : 0.5;
    // ★BJ585（2026-10-09）：与 damage() 结算同步 (int) 截断（floor）——预演=实扣口径
    //   （环境站 floatDealt 预演回填面随本刀自动与实扣对齐，不再现显示≠实扣）
    // ★R15-F9：拆步同步——防御步（double 下限 1）→ endurance (int) → 甲虫 (int)。
    let num2 = Math.max(1, dmg - this.defense * defF);
    num2 = Math.floor(num2 * (1 - endurance));
    if (this.equipStats.beetleDef && this.beetleOrbs > 0) {
      num2 = Math.floor(num2 * (1 - 0.15 * this.beetleOrbs));
    }
    return Math.max(1, num2);
  }

  /** pvp=true 走 Hurt 的 pvp 语义（Player.cs:37592 Hurt pvp 参）：减伤链与 PvE 完全
   *  相同（CalculateDamagePlayersTake 难度防系数 + endurance + 日曜——原版 PvP 实际
   *  扣血即此链；CalculateDamagePlayersTakeInPVP 的固定半防公式 Main.cs:65636 仅用于
   *  Hurt 返回值=吸血/近战反馈消费 :37953，不参与扣血）；差异点：①无敌帧 8t
   *  （:37769 num9 = pvp ? 8 : 40/80）——远短于 PvE，不同弹幕可高频命中（每弹另有
   *  playerImmune 40t 独立冷却，Projectile.cs:432 声明/:14758 置位，弹侧维护——
   *  曾误注 :214/:13618（二轮 FR5-F 勘正））②击杀置
   *  pvpDeath（KillMe :38208-38210）→ 不掉钱/300t 无敌满血复活/跳过 Boss 重生延迟 */
  /** 返回实际扣除的 HP（0=完全未受伤/被无敌帧吞掉——原版 Hurt 返回 0 语义;
   *  圣骑士盾转移/日曜反击消费此值。★pvp 时原版 Hurt 的【返回值】另有口径 =
   *  CalculateDamagePlayersTakeInPVP（dmg−def×0.5 下限 1,吸血/甲虫蓄能消费,
   *  :37953）——需要该口径的消费方自行计算,勿改本返回 */
  damage(dmg: number, srcX: number, srcY: number, knockback = true, pvp = false,
    cooldownCounter = -1): number {
    // 调试无敌（F2）：完全免伤——不扣血/不进无敌帧/不触发受击饰品（返回 0=未受伤）
    if (this.debugGod) return 0;
    // 旅程上帝模式（Player.cs:37595-37598 Hurt 首段 creativeGodMode → return 0
    // ——同样免伤不进无敌帧；NPC 接触碰撞侧 Player.cs:30863 整段跳过由本早退覆盖）
    if (journeyGodmodeActive()) return 0;
    // 微光化免伤（Player.cs:37591-37595 Hurt 前置：shimmering 且可闪避 → 直接返回 0；
    // 本仓 damage 以 false 表示完全免伤——Boss 专属弹幕 371 等不可闪避源未移植）
    if (this.shimmering) return 0;
    if (this.dead) return 0;
    // ★R2-02（蓝队二轮）免疫分桶门（Player.Hurt 入口 :38493）：
    //   `bool flag = ((cooldownCounter == ImmunityCooldownID.General) ? (!immune)
    //     : (hurtCooldowns[cooldownCounter] <= 0));` —— General(-1) 查 immune 位
    //   （本仓 iframes），WrongBugNet(3)/Lava(4) 等桶【各查各的计时】，与玩家
    //   immune 互不共享 ⇒ 木网捕熔岩饵料自伤在 General 无敌窗内照常受理。
    //   桶经 netCatchCritter 的瞬态通道 __swNextHitBucket 注入（桶表归 Game 级
    //   HurtCooldownBuckets 所有，player 不建第二份；缺省即 General 旧路不变）。
    // ★⑦ 台账清偿（2026-08-31）BossNoCheese 桶语义位：月总族接触（Update_NPCCollision
    //   :31576-31579，396/397/398/400/401·636）与月总敌弹族（Projectile.Damage_EVP
    //   :14847-14872，452/454/455/462·871-874/919/923/924）以 cooldownCounter=1 走
    //   Hurt——门=hurtCooldowns[1]<=0 独立计时（两个无敌域互不遮挡：General 帧
    //   内可再吃 NoCheese 命中,反之亦然），写面 :38674-38683 写回同桶。通道仍走
    //   全局登记表 getGlobalHurtBuckets() 单例（player 不建第二份）；无表的裸测
    //   面退 General 旧路（缺省不变形）。该入参由 NPC/boss 族调用方注入。
    let effBucketId = -1;
    let effBucketTable: import('../player/HurtCooldownBuckets').HurtCooldownBuckets | null = null;
    {
      const bkt = (this as unknown as { __swNextHitBucket?: { id: number; table: import('../player/HurtCooldownBuckets').HurtCooldownBuckets } }).__swNextHitBucket;
      if (bkt && bkt.id !== -1) {
        effBucketId = bkt.id;
        effBucketTable = bkt.table;
      } else if (cooldownCounter === ImmunityCooldownID.BossNoCheese) {
        const g = getGlobalHurtBuckets();
        if (g) { effBucketId = ImmunityCooldownID.BossNoCheese; effBucketTable = g; }
      }
      if (!effBucketTable) {
        if (this.iframes > 0) return 0;                 // General：immune 位门（原语义）
      } else if (effBucketTable.blocksHit(effBucketId)) {
        return 0;                                       // 非 General：hurtCooldowns[id] 门
      }
    }
    const eq = this.equipStats;
    // ★B/C 批:ModPlayer.PreHurt 值链(闪避族前;返 ≤0=拒伤;ctx.dmg 可变携带,值链=
    //  后钩吃前钩产物;非有限跳过)。
    //  ★红蓝自查修正:拒伤门 0→≤0(值链无钳位,mod 返负值穿透 ===0 精确门=
    //  hp -= 负值变相回血;负值语义上也是「伤害消解」=并入拒伤支)。
    //  ★红队 R-B-F1 勘位(2026-10-13):拒伤【不】走 dodgeFullFill——tML ModifyHurt
    //  Cancelled(:5885-5900)=return 0.0 于 Hurt 之前,immune/immuneTime 不执行=
    //  无任何无敌帧;只有原版闪避族(Ninja/BOC/幻影/黑带)才满填。旧形 mod 恒返 0=
    //  恒无敌(白送 40-120t 全桶帧),与 tML「mod 取消=自管冷却」语义相反→对齐。
    //  ★红队 R-B-P1 勘位:门仅在 preHurts.size > 0 时生效——零 mod 时 dmg=0 穿透
    //  复活了 orphan-b3 工单3 刚删的 dmg>0 门(测试实锤)。
    if (hasModPreHurts()) {
      dmg = runModPlayerPreHurt(this, (globalThis as { __swGame?: unknown }).__swGame, dmg);
      if (dmg <= 0) return 0;
    }
    // 神秘艺术腰布 6189（Player.Hurt :38501-38505 mysticSashDodge 分支——1457 新,
    // 排在黑带前）：10% 闪避 → SetImmuneTimeForAllTypes(longInvince?120:80)（:38342-38344;
    // DoMysticSashDodge 紫尘/碎布 gore 登记未接——本仓 damage() 无 game 钩子）。
    // ★F13（2026-08-31 蓝队三批）：setAll 全桶满填（原版 :38298-38306 无条件循环写
    // hurtCooldowns[i]，含 WrongBugNet/Lava 特殊桶）走全局登记表。
    if (eq.mysticSashDodge && Math.random() < 0.1) {
      this.dodgeFullFill(eq.longInvince ? 120 : 80);
      return 0;
    }
    // 黑带/忍者大师装备 10% 闪避（Player.Hurt :38506-38510 → NinjaDodge :38404
    // SetImmuneTimeForAllTypes 同上——旧漏无敌帧,补；★F13 同步桶表满填）
    if (eq.blackBelt && Math.random() < 0.1) {
      this.dodgeFullFill(eq.longInvince ? 120 : 80);
      return 0;
    }
    // ★593:mod 闪避掷门(灾厄 DodgeEffects 消费品闪避族——C# 消费品冷却=受伤量
    //  缩放 lerp 面=登记,本仓 mod 侧自管窗;fn=true=已闪避[效果+冷却自管])
    if (runModDodgeRoll(this, (globalThis as { __swGame?: unknown }).__swGame, dmg)) {
      this.dodgeFullFill(eq.longInvince ? 120 : 80);
      return 0;
    }
    // 混乱之脑 3223 完整闪避（Player.Hurt :38511-38515：1/6 且 buff 321 不在栏 →
    // BrainOfConfusionDodge :38331-38340 = SetImmuneTimeForAllTypes(80/120) +
    // brainOfConfusionDodgeAnimationCounter=300 + AddBuff(321,240)【return 0 不掉血】。
    // R5-F25：旧"受扣血后置 bocPulse"= 伤害照扣 + 无 buff321 禁再触发门,已修——
    // bocPulse 消费端（fixedUpdate）只负责挂 321,困惑反伤走 Game.damagePlayer 命中侧；
    // ★F13 同步桶表满填）
    if (eq.boc && Math.random() < 1 / 6 && !this.buffs.has(BuffType.BrainOfConfusionBuff)) {
      this.dodgeFullFill(eq.longInvince ? 120 : 80);
      this.bocPulse = 1;
      return 0;
    }
    // 第四闪避支：幻影闪避 buff 59（Player.Hurt :38516-38519 `if (shadowDodge)
    // { ShadowDodge(); return 0.0; }`）——shadowDodge 旗唯一来源 = UpdateBuffs
    // 效果循环 buffType==59 直判（:10159-10163）；而 59 的授予链仅神圣套装
    // on-hit 幻影闪避（ArmorSetBonuses.cs:228-236 Hallowed/HallowedSummoner →
    // onHitDodge → OnHit :6937-6940 `if (onHitDodge && shadowDodgeTimer==0)
    // AddBuff(59,1800)`）。★终零波批（2026-09-01）该链已实装：vanillaArmorSets
    // 收编 Hallowed/HallowedSummoner 全组合键 → equipStats.onHitDodge →
    // Enemy.hurt fromPlayer 段授予位（BuffType.ShadowDodge=vanilla 59）。
    // ShadowDodge()（:38306-38324）：SetImmuneTimeForAllTypes(longInvince?120:80) +
    // DelBuff(59) + PutHallowedArmorSetBonusOnCooldown(:38326 timer=1800)——免疫
    // 面走 dodgeFullFill 全桶满填（F13 同款），timer 由 shadowDodgeTimer 承载。
    if (this.hasVanillaBuff(59)) {
      this.dodgeFullFill(eq.longInvince ? 120 : 80);
      this.removeVanillaBuff(59);                       // 消费即剥离（:38314-38322）
      this.shadowDodgeTimer = 1800;                     // :38326 重整窗 30s
      return 0;
    }
    // ★619-R3F4/F5:mod 伤害闸挪闪避族早退后(幽灵命中不吃盾)——C# HasAnyEnergyShield
    //  同位(免疫/闪避门后、防御计算前);dmg<=0 早退=全吸盾可达成
    // ★BJ662（2026-10-12）吸收闸窄化：只对「mod 闸把正伤减到 ≤0」的【真吸收】面生效
    //  ——原版 Hurt 无 Damage<=0 门（:38482-38500 早退族仅上帝/微光/免疫/闪避四族,
    //  亲读）,CalculateDamagePlayersTake 对 0 伤输入钳 1（Main.cs:67146-67157 `if
    //  (num < 1.0) num = 1.0`）;零 mod 时 identity 闸透传 dmg=0 合成输入落此早退=
    //  原版偏离（orphan-b3 工单3「dmg>0 门已删」存量红根因——B3 波删的 vanilla 面
    //  门被 619 mod 面门在 dmg=0 输入档复活）。
    const dmgGateIn = dmg;
    dmg = runModDamageGate(this, dmg);
    if (dmg <= 0 && dmgGateIn > 0) { this.dodgeFullFill(eq.longInvince ? 120 : 80); return 0; }
    // 受击破潜行（Player.Hurt :38530 `stealth = 1f;`——闪避分支已全部早退,走到此处
    // 即伤害落地,无条件复位；潜行装下一帧由更新段自然回蓄。曾缺=潜行态挨打不破隐）
    this.stealth = 1;
    // ★GB3 弩车恐慌授予（Hurt :38526 `if (setSquireT2) AddBuff(205,300)`——位置在
    //  闪避族全部早退【后】、stealth 复位【前】= 原文同段；300t 恒值窗）
    if (eq.summonSet?.squireT2 === true) this.ballistaPanicT = 300;
    // 耐久药水(114)：endurance+0.1 → 受伤 ×0.9（Player.endurance 在 Hurt 结算）
    // ★R15-F9（2026-10-11 C15 清偿）：乘区序拆步截断——原版每步各 (int)
    //   （Hurt :38590 endurance → :38601 日曜护盾 → :38612 甲虫 orbs → :38651 圣骑士;
    //   防御步 CalculateDamagePlayersTake Main.cs:65646-65657 返 double 不截断,两道
    //   下限 1 各自独立 :65652/:38661）。旧单次 Math.floor 连乘=中段截断语义缺失
    //   （实分歧例:专家 51 防+耐久+日曜盾=原版 8 vs 本仓 9——floor(floor(A·0.78)·0.8)
    //   ≠floor(A·0.78·0.8)）。甲虫步自 endurance 和中拆出（原版独立乘区,与本步
    //   各自截断;拆出后球消耗位次亦与原文对齐=:38612 步内即减）。
    //   圣骑士 0.75 步（:38648-38651 defendedByPaladin 单人域）本仓未建模（MP bit5
    //   转移面 Game.ts:5043 走 damagePreview 近似,登记维持）。
    const endurance = (this.buffs.has(BuffType.Endurance) ? 0.1 : 0)
      + (eq.enduranceEq ?? 0)                           // 日曜套 0.12（:16224,2026-08-13 接）
      + this.modEnduranceDyn   // ★五百七十九:mod 每帧动态面(PSC 夜相 +0.05;同口径)
      // 冰障 buff 62（:10127-10152）：半血以下 endurance += 0.25（蠕虫围巾 0.17 走 enduranceEq）
      // 冰障 buff 62（:10127-10152）：半血以下 endurance += 0.25（蠕虫围巾 0.17 走 enduranceEq）
      + (this.buffs.has(BuffType.IceBarrier) && this.hp <= this.maxHp / 2 ? 0.25 : 0);
    // 玩家受伤防御难度系数（Main.cs:65646-65657 CalculateDamagePlayersTake：
    // 经典 0.5 / 专家 0.75 / 大师 1.0，Journey 同经典档；防御步返 double 不截断）
    const diff = scaleStatsWorld().difficulty;
    const defF = diff >= GDL.MASTER ? 1 : diff >= GDL.EXPERT ? 0.75 : 0.5;
    // 日曜护盾（:37699-37720:套装在场且有层 → 消耗 1 层,该次伤 ×0.2+solarCounter 清零;
    // 反击 608 弹/冲撞命中消耗登记未接）
    // 格挡盾反击（:30979 CanParryAgainst+:30910-30920 消费——shieldParryTimeLeft>0
    // 且面向来敌 → 免伤+反伤 2×(kb 5)。降盾后 15t 冷却 :31276）
    // ★⑩ 台账清偿（2026-08-31）盾反触发域转正：TryTogglingShield 的上游
    // ItemCheck_ManageRightClickFeatures_ShieldRaise（:31942-31958）——
    // `flag = 手持 3823 Brand of the Inferno ∪ 4760 Sergeant United Shield` &&
    // hasRaisableShield(:13222 armorPiece.shieldSlot>0 装备面 ≙ shieldItem) &&
    // !mount.Active && (itemAnimation==0 | mouseRight)。旧"按住 Down"触发域为
    // 2026-08-13 简化实现,与原版右键举盾键面不同→改右键电平 inputUseTile
    // （controlUseTile 本仓承载位;原版 theGeneralCheck 的 releaseUseItem/
    // tileInteractionHappened 等输入闸=输入层差异登记）。格挡中受击=反伤。
    const heldShieldVid = (() => {
      const d = ITEM_DEFS[this.inv.heldItem()?.id ?? -1];
      return d?.vid ?? -1;   // ★BJ283 parseInt 兜底退役(方案 A ⑥等价定谳)
    })();
    const shouldGuard = this.inputUseTile && !this.mount.active
      && !!eq.shieldItem && (heldShieldVid === 3823 || heldShieldVid === 4760);
    if (shouldGuard !== this.shieldRaised) {
      this.shieldRaised = shouldGuard;
      if (shouldGuard) {
        if (this.shieldParryCd === 0) this.shieldParryTimeLeft = 1;  // :31268
        this.useTime = 0;
      } else {
        this.shieldParryCd = 15;   // :31276
        this.shieldParryTimeLeft = 0;
      }
    }
    if (this.shieldParryTimeLeft > 0) {
      this.shieldParryTimeLeft++;
      if (this.shieldParryTimeLeft > 20) this.shieldParryTimeLeft = 0;  // :31250
    }
    if (this.shieldParryCd > 0) {
      this.shieldParryCd--;
      // 就绪拍（:31953-31963 shield_parry_cooldown 归零那一拍）：置位提示,
      // 声/尘由 fixedUpdate 消费（此处无 game 钩子）
      if (this.shieldParryCd === 0) this.parryReadyCue = true;
    }
    let solarConsumed = false;
    // 日曜护盾消耗门（Hurt :38589 `ImmunityCooldownID.Sets.Counter[cooldownCounter]`
    // && ConsumeSolarFlare() :57415：Counter 集 = CreateBoolSet(General,BossNoCheese)
    // （ImmunityCooldownID.cs:31）——R5-F23：岩浆(4)/触格伤(0)不耗盾,旧无门全消耗。
    // ★⑦ 台账清偿：BossNoCheese 桶已建模（上方 effBucket* 分道）→ counter==1 类
    // 命中经本门【照常】进 ConsumeSolarFlare 消耗（月总族攻击吃盾=原版反 cheese 面）
    // ★A2（清零批·受击域）：生效桶 id 取「瞬态通道 > 入参」——环境站改走 Game 漏斗后
    // p.damage 的 cooldownCounter 形参恒为缺省 -1，Lava(4)/TileContactDamage(0) 由
    // __swNextHitBucket 通道携带；不派生则岩浆/尖刺伤会误耗日曜盾层（违反 R5-F23 原意）。
    // 通道值已含 BossNoCheese(1) 分道（上方 effBucket*），两者都在 Counter 集内。
    const effSolarCd = effBucketId !== -1 ? effBucketId : cooldownCounter;
    const solarGateOk = effSolarCd === -1 || effSolarCd === 1;
    if (solarGateOk && eq.solarSet && this.solarShields > 0) {
      solarConsumed = true;
      this.solarShields--;
      this.solarCounter = 0;
    }
    // ★BJ585（2026-10-09）：取整改 (int) 截断语义（floor，正数域同构）——原版
    //   Player.Hurt :38590 `num2 = (int)((double)(1f - endurance) * num2)`、
    //   :38672 `statLife -= (int)num2`（CalculateDamagePlayersTake 返回 double 不含
    //   取整）。旧 Math.round 在半点档向上多扣 1（用户实测 51 防 22.75 → 实扣 23，
    //   原版 22；100 伤 → 62 vs 原版 61）。
    // ★R15-F9：拆步截断展开（逐段 (int)）——
    //   防御步（double,下限 1 :65652）→ endurance 步（(int) :38590）→ 日曜护盾步
    //   （(int)×0.8 :38601,num5=0.2f）→ 甲虫步（(int)×(1−0.15·orbs) :38612,球消耗
    //   在步内 :38613）→ 尾下限 1（:38661 `if (num2 < 1.0) num2 = 1.0`）→
    //   statLife −= (int)num2（:38672,num2 步后恒整数值）。圣骑士步未建模（见上）。
    let num2 = Math.max(1, dmg - this.defense * defF);       // CalculateDamagePlayersTake
    num2 = Math.floor(num2 * (1 - endurance));               // :38590 (int)
    if (solarConsumed) num2 = Math.floor(num2 * 0.8);        // :38601 (int)（num5=0.2f→×0.8）
    if (eq.beetleDef && this.beetleOrbs > 0) {               // :38605-38613 甲虫步
      num2 = Math.floor(num2 * (1 - 0.15 * this.beetleOrbs)); // :38612 (int)（orbs=消耗前值）
      this.beetleOrbs--;                                     // :38613 步内即减（原位次）
      (this as unknown as { __swBeetle?: { resetCounter(): void } }).__swBeetle?.resetCounter();
    }
    const reduction = Math.max(1, num2);                     // :38661 下限 1 + :38672 (int)
    this.hp -= reduction;
    // 受击闭眼 20t（Player.Hurt :37916 eyeHelper.BlinkBecausePlayerGotHurt——
    // 与无敌帧同步的全闭眼优先档，仅对真正造成伤害的命中）
    this.eyeBlinkHurt();
    // 无敌帧写面分道（★R2-02 蓝队二轮，Player.cs:38674-38683）：
    //   General → immune=true; immuneTime=num10（本仓 iframes 位）
    //   非 General 桶 → `else if ((hurtCooldowns[cc]==0)|flag2) hurtCooldowns[cc]=num10`
    //   （仅空位写入）。num10 = pvp ? 8 : (实扣!=1 ? longInvince?80:40 : longInvince?40:20)
    {
      const num10 = pvp ? 8
        : (reduction !== 1 ? (eq.longInvince ? 80 : 40) : (eq.longInvince ? 40 : 20));
      if (!effBucketTable) {                            // General 桶（含退路）
        this.iframes = num10;
      } else {
        effBucketTable.applyAfterHit(effBucketId, num10);   // 非 General：仅空位写
      }
    }
    // PvP 击杀（KillMe :38208-38210 if(pvp) pvpDeath=true）——重生端消费
    if (pvp && this.hp <= 0) this.lastPvpDeath = true;
    this.sinceHurt = 0; // 受击打断自然回血
    this.lifeRegenTime = 0; // 同源清零（Player.Hurt :37784 lifeRegenTime=0）
    // 甲虫防御壳受击掉一颗（Player.Hurt :38608-38625）——★R15-F9 迁位：球消耗
    //   原文在甲虫减伤步内（:38613,先于 statLife 写面 :38672），旧注置于 hp 写后
    //   =位次后置；现随拆步截断上移至乘区内（见上方 reduction 段）。仅 beetleDefense
    //   侧消费；掉球后蓄能计数清零（:38624 → BeetleMeter.resetCounter）。猛攻族不掉球
    // 隐身药水受击破隐（Hurt :38566-38575 `if (invis) DelBuff(10)`——buff 10 在栏
    // 即删。R5-F27：旧受击不破隐,已补）
    if (this.buffs.has(BuffType.Invisibility)) this.buffs.remove(BuffType.Invisibility);
    // 恐慌项链：受击触发移速爆发（Hurt :38522-38525 AddBuff(63, 480)——buff 63
    // Panic! moveSpeed++（:10218-10220）= +1.0,480t=8s。R5-F26：旧 300 且按 dt 秒
    // 递减（实际 300s）双错已修）
    if (eq.panic) this.panicTime = 480;
    // 魔力手铐（magicCuffs :37678）：受伤回蓝 = 原始伤害 1:1（防前数值）
    if (eq.magicCuffs) this.mana = Math.min(this.maxMana, this.mana + dmg);
    // 击退（钴护盾族 noKnockback 免疫；坐骑冲刺态免击退——UpdateEffects
    // :4962/:4968 |vx| > DashSpeed-RunSpeed/2 时 mountedPlayer.noKnockback=true）。
    // 原版 Player.Hurt 击退段（Player.cs:37908-37912）：固定 velocity.X = 4.5×hitDirection、
    // velocity.Y = -3.5——【不按攻击方武器 kb 缩放】（NPC.knockBack 只作用于敌怪端
    // StrikeNPC），hitDirection=0 的伤害（岩浆/窒息/摔落）整段跳过。同段
    // fallStart = position.Y/16（:37912）：击退弹起从受击高度重新累计摔伤。
    // 旧近似 dir*3.4/-3 已按原版数值修正（2026-08-13）
    if (knockback && !eq.noKnockback
      && !(this.ridingMount && this.mount.dashNoKnockback(this.vx))) {
      const dir = this.cx < srcX ? -1 : 1;
      this.deathHitDir = dir;   // KillMe :38291-38292 X 初速 +2×hitDirection 的方向源
      this.vx = dir * 4.5;   // Player.cs:37910
      this.vy = -3.5;        // Player.cs:37911
      this.fallStartY = this.y;  // fallStart = position.Y/16（:37912，像素口径同源）
    } else if (knockback) {
      // 钴护盾免击退：速度不弹但击退方向照记（KillMe hitDirection 用 Hurt 参——
      // noKnockback 只清 velocity 不改 hitDirection 口径）
      this.deathHitDir = this.cx < srcX ? -1 : 1;
    }
    // ★594:mod 受击钩(C# OnHurt face——rBrain 墨云/墨炸弹/百年魔典等受击响应面;
    //  伤害落地后派发[与 C# Hurt 尾同位];reduction=实扣伤)
    runModPlayerHurt(this, (globalThis as { __swGame?: unknown }).__swGame, reduction);
    // ★B/C 批:ModPlayer.PostHurt 通知链(伤害落地后;ctx.reduction=实扣)。
    //  ★红队 R-B-F3 勘位:tML PostHurt 在 statLife>0 存活支内(patch :6208)——
    //  致死拍(hp≤0,死亡管线在后)不派发=对齐
    if (this.hp > 0) {
      runModPlayerPostHurt(this, (globalThis as { __swGame?: unknown }).__swGame, reduction);
    }
    return reduction;
  }

  /** ShimmerUnstuck（Player.cs:28394-28428）：timeShimmering 清零，找最近无微光
   *  落点传送（TryFindingShimmerFreeSpot :28414-28440，落点 = ShimmerHelper 盒左上角
   *  再 +(0,-2)px、velocity=(0,0.0001)），清微光化态；找不到则保持原位等下一轮
   *  （原版同样仅 StartUnstuck 辅助）。传送附带短暂无敌帧（原版 Teleport style 12
   *  的 immune 语义近似——落点邻敌免秒杀） */
  private shimmerUnstuck(game: GameHooks, world: import('../world/World').World): void {
    this.timeShimmering = 0;
    const st = world.store;
    // 三层兜底（原版 :28442-28469）：玩家周围 → 出生点——保证封闭洞穴内也必脱困
    const spot = findShimmerFreeSpot(
      st, Math.floor(this.cx / TILE), Math.floor(this.y / TILE),
      world.spawnX, world.spawnY,
    );
    if (!spot) {
      // 原版无位支（Player.cs:29105-29116）：不传送、不解除 shimmering——仍浸微光则
      // StartUnstuck（indefinite+120t 保护,ShimmerUnstuckHelper.cs:47-51；:29107-29110）
      // + ClearBuff(353)（:29111）+ ShimmerTownNPC 广播（:29112-15,Bottom）。效果 =
      // 微光化态解除、实体化原地，且下一 tick 起 AddBuff(353) 被 ShouldUnstuck 门
      // 拦 120t（:27944 三因子）；红队 R1-F6 2026-09-03（旧实现直接 return 无支）
      const wr = wetCollision(world.store, this.x, this.y, this.w, this.h);
      if (wr.wet && wr.shimmer) {   // :29107 Collision.WetCollision(...) && Collision.shimmer
        this.startShimmerUnstuckHelper();
      }
      this.buffs.remove(BuffType.Shimmered);   // :29111 ClearBuff(353)
      // ShimmerTownNPC 到场音（Spawn_ShimmerTownNPC ParticleOrchestrator.cs:2321
      // SoundEngine.PlaySound(SoundID.Item29, PositionInWorld)——Broadcast 双生子
      // 本地也触发处理器;TownNPC shimmerRise 尾同款。2026-09-17 普查补）
      game.playSfx('manaCrystal', 1, this.cx, this.y + this.h);
      game.broadcastParticleOrchestra?.(ParticleOrchestraType.ShimmerTownNPC, this.cx, this.y + this.h);
      return;
    }
    const p = shimmerTeleportPos(spot, this.w, this.h);
    this.environmentBuffImmunityTimer = 4;        // Teleport :37701（环境 buff 免疫窗）
    // ★BJ108 登记债①清偿（2026-09-17）：Teleport(pos,12) :37747 全 style 汇聚 →
    // StartCameraTransitionForPlayerTeleport(oldPos,0.1,0)（style12 无 delay 特支,
    // 仅 Style==1 delay=10 :37744-37746）——近距滑行/远距黑幕由 BJ103-A1b 单源分道。
    // oldPos = 传送前 position（Teleport :37705 vector=position,位移前捕获）
    const tpOldX = this.x, tpOldY = this.y;
    this.x = p.x;
    this.y = p.y;
    game.startCameraTransitionForPlayerTeleport?.(tpOldX, tpOldY);   // ★BJ108 债①（:37747,delay=0）
    this.vx = 0;
    this.vy = 0.0001;
    // ★BJ714-A（R16-P1 面3）:骑/坠车入微光滞留脱困传送随迁（Teleport style12
    //  :29095 零 Dismount 同门——不随迁=脱困被拖回+timeShimmering 归零重累,
    //  每 3600t 空转一次）。镜像取速度终值 (0,0.0001),故列于 vy 写后。
    game.migrateMinecartOnTeleport?.();
    this.shimmering = false;
    this.inShimmer = false;
    this.buffs.remove(BuffType.Shimmered); // :28406 ClearBuff(353)——传送即解除微光化
    this.iframes = Math.max(this.iframes, PLAYER_IFRAME_TICKS);
    game.spawnParticles(this.cx, this.cy, '#BFE8FF', 14, 1.4, { life: 30, grav: -0.04 });
    // ShimmerTownNPC 到场音 = SoundID.Item29（Spawn_ShimmerTownNPC 处理器尾
    // ParticleOrchestrator.cs:2321——Broadcast 双生子本地也触发;旧 shimmerSplash
    // （Splash_4 微光液配对音）系错档,2026-09-17 普查对齐。TownNPC shimmerRise
    // 尾 manaCrystal 已接,同源）
    game.playSfx('manaCrystal', 1, this.cx, this.cy);
    // module8 广播（Player.cs:28402 BroadcastOrRequestParticleSpawn(ShimmerTownNPC,
    // PositionInWorld = Bottom)）——原版在 Teleport 之后取 base.Bottom（= 新位脚底）,
    // 此处 x/y 已更新,同语义照抄
    game.broadcastParticleOrchestra?.(ParticleOrchestraType.ShimmerTownNPC, this.cx, this.y + this.h);
  }

  /** ApplyTouchDamage（1457 Player.cs:29194-29240；1456 注 :28507 同物）1:1：
   *  直接伤害(DamageVar 后护甲结算)→灼烧/流血 buff→窒息延迟→荆棘族触碰毁块。
   *  伤害被完全抵消(含无敌帧)时跳过 buff 授予(原版 flag==true 分支 :29213-29215)。
   *  ★A2（清零批·受击域）：改走 Game.damagePlayer msg117 通用漏斗——原版
   *  `Hurt(ByOther(3), num, 0, quiet:false, cooldownCounter=TileContactDamage)`
   *  （:29212 字面）：hitDirection=0 ⇒ kb=false/hitDir=0；桶=独立 TileContactDamage
   *  桶（旧实现传参只关太阳门,免疫门仍走 General iframes 位——分桶门先于此修正,
   *  接触伤与敌怪接触无敌窗互不遮挡,同 :27889 岩浆门构型）；飘字=damagePreview
   *  预演回填、音由漏斗单点承载（本地双发源删除）。 blocked 判据保持原版
   *  「Hurt 返回 0.0」= 实扣为 0（闪避/免伤早退族全命中该语义）。 */
  private suffocateDelay = 0;
  private applyTouchDamage(game: GameHooks, ht: HurtTile): void {
    let blocked = false;
    const touchBase = TOUCH_IMMEDIATE.get(ht.type);
    // ★F4（四轮蓝队）：表值过 Main.DamageVar 单源——原文 `num = Main.DamageVar(num,
    // 0f - luck)`（Player.cs:29211 字面；luck 参数位 = −luck，负 luck 重掷取低带）。
    // ±15% 离散档 + 银行家舍入随 stats/DamageVar 单源（Enemy.ts:2411 接触面同式）。
    const dmg = touchBase !== undefined ? damageVarRoll(touchBase, -this.luck) : undefined;
    if (dmg !== undefined) {
      this.lastDamageCause = { kind: 'defaultWrap' }; // PlayerDeathReason.ByOther(3)
      const shown = this.damagePreview(dmg);
      if (this.envHurtThroughFunnel(game, dmg, this.cx, this.y - 10,
        ImmunityCooldownID.TileContactDamage, shown) === 0) {
        blocked = true;
      }
    }
    if (!blocked) {
      if (TOUCH_HOT.has(ht.type)) this.buffs.apply(BuffType.Burning, 20 / 60);   // AddBuff(67,20)
      if (TOUCH_BLEEDING.has(ht.type)) this.buffs.apply(BuffType.Bleeding, (600 + Math.random() * 600) / 60); // AddBuff(30,600-1200)
    }
    if (SUFFOCATE.has(ht.type)) {
      if (this.suffocateDelay < 5) this.suffocateDelay++;       // suffocateDelay<5 递增
      else this.buffs.apply(BuffType.Suffocation, 1 / 60);      // 满后每 tick AddBuff(68,1)
    } else {
      this.suffocateDelay = 0;
    }
    if (TOUCH_DESTROY.has(ht.type)) {
      game.world.breakTileAt(ht.x, ht.y); // TouchDamageDestroyTile → KillTile
    }
  }

  /** 清坠落起点(F10 调试瞬移用):瞬移不结算高空摔伤 */
  clearFall(): void {
    this.fallStartY = null;
  }

  draw() { /* 由 Renderer 统一绘制 */ }

  // ============ 死亡散飞 + 硬核幽灵（KillMe/UpdateDead/Ghost 1:1） ============

  /** KillMe 尾段（Player.cs:38287-38298）：头/身/腿三段散飞初速——
   *  Y = Next(-40,-10)×0.1（-4.0..-1.1 向上抛）、X = Next(-20,21)×0.1 + 2×hitDirection；
   *  stoned 时三段 Position 归零（初速照掷——原版门字面照抄） */
  private initDeathParts(game: GameHooks): void {
    const hitDir = this.deathHitDir;
    for (const seg of [this.deadParts.head, this.deadParts.body, this.deadParts.legs]) {
      seg.px = 0; seg.py = 0; seg.rot = 0;
      seg.vy = (Math.floor(Math.random() * 30) - 40) * 0.1;        // Next(-40,-10)×0.1
      seg.vx = (Math.floor(Math.random() * 41) - 20) * 0.1 + 2 * hitDir;  // Next(-20,21)×0.1 + 2×hitDir
    }
    // :38294-38298 stoned → 三段 Position 归零
    if (this.buffs.has(BuffType.Stoned)) {
      for (const seg of [this.deadParts.head, this.deadParts.body, this.deadParts.legs]) {
        seg.px = 0; seg.py = 0;
      }
    }
    // ★BJ595 死亡尘爆（KillMe_DustExplosion Player.cs:39330-39360，KillMe :39208 调）：
    // 100×盒内尘,逐参在 emitPlayerDeathDustExplosion 单源（tests/bj595 直测）。
    // 远端玩家死亡本仓不走本链=原版他端 KillMe 同相（登记）。
    emitPlayerDeathDustExplosion(game.vanillaDust, this, hitDir,
      this.buffs.has(BuffType.Stoned), this.equipStats.frostBurn === true,
      this.boneArmor, this.armorSetDyeVid());
  }

  /** UpdateDead（Player.cs:16878-16888）：三段 pos += vel / rot += vel.X×0.1（翻滚）/
   *  vel.Y += 0.1（重力）/ vel.X ×= 0.99（水平阻尼）。immuneAlpha 的 +2 钳 255 由
   *  Game 死亡分支执行（同一段逻辑，不重复）。★BJ400：ghost 态帧推进块迁入下方
   *  ghostFlight（原版该推进在 Ghost() :6802-6818 内,UpdateDead 无此链;ghost 相
   *  起 UpdateDead 整体停摆=本函数不再被调） */
  private updateDeathParts(game: GameHooks): void {
    for (const seg of [this.deadParts.head, this.deadParts.body, this.deadParts.legs]) {
      seg.px += seg.vx;
      seg.py += seg.vy;
      seg.rot += seg.vx * 0.1;
      seg.vy += 0.1;
      seg.vx *= 0.99;
    }
  }

  /** Ghost()（Player.cs:6714-6850）1:1——硬核幽灵自由飞行（Update :24938 ghost 分支
   *  先于 dead 分支接管,UpdateDead 停摆；BJ400 落刀）。
   *  移动语义：controlUp||controlJump 上升 / controlDown 下降 / controlLeft∧!Right、
   *  controlRight∧!Left 平移（独立左右电平,同按=阻尼臂——inputLeft/inputRight
   *  单源,Wisp 211 同款）；反向 0.9 阻尼、加速度 0.2、速度帽 7、死区 |v|纵≤0.1/
   *  横≤0.2 内归零。`position += velocity` 无 tile 碰撞（穿墙=原版本相）;
   *  UpdateNetOffset(fallThrough:true,ignorePlats:true)（:6849）=联机净位域不移植。
   *  世界界钳 640px（:6821-6847）：X 越界 vx=0；顶界 vy<−0.1 → −0.1（慢漂 quirk
   *  照抄,非归零）；底界 vy=0。ghostFrameCounter 每 8t 推进 ghostFrame %4
   *  （:6802-6818,自 updateDeathParts 迁入）。immune=false/immuneAlpha=0/
   *  ResetEffects/ResetVisibleAccessories（:6717-6720）=效果/绘制面,本仓死亡相
   *  已冻结等效;immuneAlpha 本仓另承载死亡 UI 淡入驱动,清零会盲死亡文字
   *  =登记偏离不照抄（Game 死亡分支 ramp 保持）。spectating=-1（:6716）清观战
   *  目标面★X4 清偿刀C（2026-09-29）已接：Game.fixedUpdate 观战控制站头
   *  `spectatingSlot>=0 ∧ isGhostPhase → spectatingSlot=-1`（直写字段,同 :6716
   *  裸赋值不走 SetOrRequestSpectating）——旧注「canDeathSpectate 排 ghost 相+
   *  handleSpectatingControls 收观战等效承载」不成立（spectatingSlot>=0 支独立
   *  存活,MP 硬核死亡观战中入幽灵相镜头仍跟代理）,该注作废。 */
  private ghostFlight(game: GameHooks): void {
    const num = 7, num2 = 0.2;   // 速度帽/加速度（:6731-6732）
    const up = this.inputUp || this.inputJump;
    const down = this.inputDown;
    const left = this.inputLeft, right = this.inputRight;
    if (up) {                                              // :6734-6745
      if (this.vy > 0) this.vy *= 0.9;
      this.vy -= num2;
      if (this.vy < -num) this.vy = -num;
    } else if (down) {                                     // :6746-6754
      if (this.vy < 0) this.vy *= 0.9;
      this.vy += num2;
      if (this.vy > num) this.vy = num;
    } else if (this.vy < -0.1 || this.vy > 0.1) {          // :6755-6758
      this.vy *= 0.9;
    } else {
      this.vy = 0;                                         // :6759-6761
    }
    if (left && !right) {                                  // :6762-6772
      if (this.vx > 0) this.vx *= 0.9;
      this.vx -= num2;
      if (this.vx < -num) this.vx = -num;
    } else if (right && !left) {                           // :6773-6782
      if (this.vx < 0) this.vx *= 0.9;
      this.vx += num2;
      if (this.vx > num) this.vx = num;
    } else if (this.vx < -num2 || this.vx > num2) {        // :6783-6786
      this.vx *= 0.9;
    } else {
      this.vx = 0;                                         // :6787-6789
    }
    this.x += this.vx;                                     // :6790 position += velocity（无碰撞）
    this.y += this.vy;
    if (this.vx < 0) this.facing = -1;                     // :6792-6797 direction
    else if (this.vx > 0) this.facing = 1;
    if (++this.ghostFrameCounter >= 8) {                   // :6802-6818
      this.ghostFrameCounter = 0;
      this.ghostFrame = (this.ghostFrame + 1) % 4;
    }
    // 世界界钳（:6821-6847；leftWorld/topWorld=0,rightWorld=store.w×16,bottomWorld
    // =store.h×16——bordersMovement 的最小世界豁免门 Ghost() 无,1:1 照抄）
    const B = 640;                                         // num3 = 640
    const wPx = game.world.store.w * TILE, hPx = game.world.store.h * TILE;
    if (this.x < B) { this.x = B; this.vx = 0; }
    if (this.x > wPx - B - this.w) { this.x = wPx - B - this.w; this.vx = 0; }
    if (this.y < B) { this.y = B; if (this.vy < -0.1) this.vy = -0.1; }
    if (this.y > hPx - B - this.h) { this.y = hPx - B - this.h; this.vy = 0; }
  }

  /** UpdateSunScorch（Player.cs:28144-28189 一比一）：暴露判定 → counter 推进 →
   *  120 档点火链。原版 whoAmI==Main.myPlayer 门 = 本仓 Player 仅主角实例跑
   *  fixedUpdate（联机代理不走本链）。非吸血鬼世界 vampireSeedSunlightExposure
   *  直出 → burning 恒 false → counter 恒 0，链尾整段死代码 */
  private updateSunScorch(game: GameHooks): void {
    // BuffState.vampireSeed（Main.vampireSeed，Main.cs:327）——OnFire -50HP/s 特档
    // （Player.cs:18798-18802）的开关；世界常量,每帧自 seedFlags 刷新
    this.buffs.vampireSeed = !!game.world.seedFlags?.vampireSeed;
    this.vampireSeedSunlightExposure(game);             // :28150
    const prev = this.sunScorchCounter;                 // :28151（点火沿探测用）
    this.updateSunScorchValues(game);                   // :28152
    if (!this.vampireBurningInSunlight || this.sunScorchCounter < 120) return;   // :28153-28156
    if (prev < 120) {                                   // :28157-28171 首越 120 档：
      // PlayerFrame() 探头 head==124 && body==85 && legs==72（怪物套装视觉槽——
      // 帧函数按 armor 槽序号重写 head/body/legs 后比对，本仓直接读等价的
      // hs/bs/ls）→ AchievementsHelper.NotifyProgressionEvent(33) = FEAR_THE_SUN
      const st0 = statOfInternal(this.inv.armor[0]?.id ?? -1);
      const st1 = statOfInternal(this.inv.armor[1]?.id ?? -1);
      const st2 = statOfInternal(this.inv.armor[2]?.id ?? -1);
      if (st0?.hs === 124 && st1?.bs === 85 && st2?.ls === 72) {
        game.achievements?.notifyProgressionEvent(33);
      }
    }
    // Array.Clear(buffImmune)（:28168）：点火帧清全部免疫——黑曜石头骨/十字章盾族
    //  当帧全部失效（原版下一帧 UpdateEquips 重建、再被本行清——本仓 immuneVanilla
    //  随 equipStats 键失效重建，等价；见 equipStatsKey 的 S/V 档）
    this.buffs.immuneVanilla.clear();
    if (!this.buffs.has(BuffType.OnFire)) {             // :28170-28178 !onFire 才发
      // ParticleOrchestrator VampireOnFire（:28178）= Spawn_VampireOnFire
      // （ParticleOrchestrator.cs:2352-2355）——仅播 SoundID.Item20，无粒子体。
      // module8 广播（RequestParticleSpawn !clientOnly, PositionInWorld=Center）：
      // 本地音已播,他端经 netApplyParticleOrchestra 同款落点复播
      game.playSfxWav?.('Item_20', 1, this.cx, this.y + this.h / 2);
      game.broadcastParticleOrchestra?.(ParticleOrchestraType.VampireOnFire,
        this.cx, this.y + this.h / 2);
    }
    // AddBuff 24/23/32 各 3【tick】= 0.05s（:28179-28181，AddBuff time 参为帧——
    // 每帧续期；24 OnFire/23 Cursed/32 Slow）
    this.buffs.apply(BuffType.OnFire, 3 / 60);
    this.buffs.apply(BuffType.Cursed, 3 / 60);
    this.buffs.apply(BuffType.Slow, 3 / 60);
    if (this.mount.active) this.mount.tryDismount(this);   // :28182-28185 mount.TryDismount
    // wingsLogic = 0; rocketBoots = 0（:28186-28187）——本仓 wing/rocketBoots 出自
    // equipStats（缓存键含炽灼档，见 computeEquipStats 尾部 S 档），本行无需直写
  }

  /** UpdateSunScorchValues（Player.cs:28094-28106 逐式 + :28107-28121 炽灼音环）：
   *  常态档 counter += burning ? 1 : −6；死亡档（UpdateDead :16928 调用）burning
   *  清 false、衰减放缓为 −2；一律钳 0-300。音环 = SoundID.VampireSizzle
   *  （CreateTrackable("sizzle").WithVolume(1)，SoundID.cs:1039——public/sounds/
   *  sizzle.wav 在库）：lerp = GetLerpValue(0,120,counter) 起轨并每帧跟随；
   *  loopingCondition（VampireSizzleTracker.IsActiveAndInGame = !gameMenu &&
   *  vampireSeed && counter>0）≈ counter 归零拆轨 */
  updateSunScorchValues(game?: GameHooks): void {
    let num = 6;                                        // :28100
    if (this.dead) {                                    // :28101-28105
      this.vampireBurningInSunlight = false;
      num = 2;
    }
    this.sunScorchCounter = Math.max(0, Math.min(300,   // :28106 Clamp(±, 0, 300)
      this.sunScorchCounter + (this.vampireBurningInSunlight ? 1 : -num)));
    // ---- :28107-28121 炽灼音环（SoundEngine.PlayTrackedLoopedSound + 每帧
    //      Volume/Position 更新；本仓常驻循环轨 playLoopFile + setVolume 同构） ----
    const lerpValue = Math.max(0, Math.min(1, this.sunScorchCounter / 120));   // GetLerpValue(0,120,·,true)
    if (!this._sizzleLoop && !this._sizzleFailed && lerpValue !== 0 && game?.startLoopSfx) {
      this._sizzleLoop = game.startLoopSfx('sizzle', lerpValue, 1);           // :28109-28115
      if (!this._sizzleLoop) this._sizzleFailed = true;   // 无钩子/无素材：本实例不再重试
    }
    if (this._sizzleLoop) {
      if (this._sizzleLoop.dead) {                       // 终态（stop/加载失败）拆轨
        if (!this._sizzleLoop.playing) this._sizzleFailed = true;  // 起振前死=加载失败，不再重建
        this._sizzleLoop.stop();
        this._sizzleLoop = null;
      } else if (this.sunScorchCounter <= 0) {           // counter 归零（条件出）拆轨
        this._sizzleLoop.stop();
        this._sizzleLoop = null;
      } else {
        this._sizzleLoop.setVolume(lerpValue);           // :28118 activeSound.Volume
      }
    }
  }

  /** 炽灼音环句柄（SfxLoop 同构面；Game.destroy/退世界拆轨用——防菜单残留） */
  private _sizzleLoop: {
    stop(): void; setVolume(v: number): void;
    readonly playing: boolean; readonly dead: boolean;
  } | null = null;
  private _sizzleFailed = false;
  /** 拆炽灼音环（Game.destroy → 本体调；Player 实例弃用前必经） */
  stopSizzleLoop(): void {
    this._sizzleLoop?.stop();
    this._sizzleLoop = null;
  }

  /** VampireSeedSunlightExposure（Player.cs:28191-28238 逐式）：吸血鬼种子世界
   *  的阳光暴露判定——地表 + 白天 + 无雨/日食/墓园/蘑菇地 + 月总天幕强度 ≤0.5 +
   *  不在水里 + 未持遮阳物（雨伞 946/悲剧之伞 4707）+ 非蝙蝠坐骑（56），则自脚下
   *  向上扫 ≤15 格找"透光墙"（无墙/玻璃 21/回声墙 318）→ vampireBurningInSunlight */
  private vampireSeedSunlightExposure(game: GameHooks): void {
    const w = game.world;
    const num = Math.floor(this.cx / 16);               // :28192 (int)Center.X/16
    let num2 = Math.floor((this.y + this.h - 1) / 16);  // :28193 (int)(Bottom.Y-1)/16
    // 帧首清位（ResetEffects :18549 vampireBurningInSunlight=false 的等价位——
    // 原版在 Player.Update 开头清、本链末尾置，本仓两步并到本函数首行）
    this.vampireBurningInSunlight = false;
    if (!w.seedFlags?.vampireSeed) return;              // :28195-28198 !Main.vampireSeed
    const num3 = 0.5;                                   // :28199
    // :28200 白天/露天六门（worldSurface 为 tile 行；ZoneGraveyard/ZoneGlowshroom
    // 来自 SceneMetrics——本仓 game.scene 每 15t 以玩家为中心刷新）
    const scene = game.scene;
    let flag = num2 < w.groundLevel && w.clock.isDay && !w.weather.raining
      && !w.clock.eclipse && !scene?.zoneGraveyard && !scene?.zoneGlowshroom;
    // :28201-28204 月总天幕（SceneMetrics.MoonLordSkyIntensity = 1−SmoothStep(3000,
    // 6000,距核)，SceneMetrics.cs:297-305；>0.5 → 距核<4500 → 天被月总遮黑不灼）
    if (flag) {
      let ml: { cx: number; cy: number } | null = null;
      for (const e of game.enemies()) {
        const en = e as { vanillaId?: number | null; cx?: number; cy?: number };
        if (en?.vanillaId === 398) { ml = { cx: en.cx ?? 0, cy: en.cy ?? 0 }; break; }
      }
      if (ml) {
        const d = Math.hypot(this.cx - ml.cx, this.cy - ml.cy);
        if (1 - Math.max(0, Math.min(1, (d - 3000) / 3000)) > num3) flag = false;
      }
    }
    if (!flag || this.inWater) return;                  // :28206-28209（wet 判定 = 水；
    //  原版 wet 不含岩浆/蜂蜜——本仓 inWater 同口径，见 :1673 注释）
    const heldVid = this.heldVid();                     // :28210 遮阳物二选一
    let flag2 = heldVid === 946 || heldVid === 4707;    // Umbrella/Tragic Umbrella
    if (this.mount.active && this.mount.type === 56) flag2 = false;   // :28211-28213 蝙蝠坐骑上伞失效
    if (flag2) return;                                  // :28214-28216 持伞免灼
    // ---- :28217-28238 自脚下向上 15 格透光墙扫描 ----
    const st = w.store;
    let num4 = 15;
    while (num4 > 0) {
      if (!st.inBounds(num, num2)) break;               // :28221 tile==null ≈ 出界
      const wi = st.idx(num, num2);
      const wall = st.wall[wi];
      const type = st.type[wi];
      const sheet = TILE_DEFS[type]?.vanilla?.sheet ?? -1;
      // 透光墙：无墙 0 / 玻璃 21 / 回声墙 318（回声涂层 invisibleWall 系统未建恒
      // false，:28225 末项化简掉——登记见 world/Paint.ts:129）
      if (wall === 0 || wall === 21 || wall === 318) {
        this.vampireBurningInSunlight = true;           // :28228
        break;
      }
      num4--;                                           // :28231
      num2--;                                           // :28232
      // :28233-28237 上方一格 SolidTile3 且本格非沙(54)/回声块(541) → 屋顶，停扫
      // （tile.* 读的是本格（自减前），SolidTile3 读的是上一格——照抄原版结构）
      // ★A-5 边带（2026-09-04）：SolidTile3(num,num2)（Player.cs:28935 坐标重载）
      // 首门 InWorld(·,1)（WorldGen.cs:71006-71008）——世界最外一圈恒无屋顶
      const above = st.inWorld1(num, num2)
        ? st.isActive(num, num2) && TileStoreRT.SOLID_LUT[st.type[st.idx(num, num2)]] === 1
        : false;
      if (above && sheet !== 54 && sheet !== 541) break;
    }
  }

  /** boss 存活在场（GetRespawnTime :38388-38398 扫描结果——Game 死亡分支每帧写入；
   *  +600t 复活延迟的开关，非 PvP 死亡才计） */
  bossNearOnDeath = false;
  /** 复活跳过可用（★1457 Main.cs:46104 AllowsRespawnTimerSkip 全门——Game 死亡
   *  分支每帧写入；死亡 UI 的"按SPACE跳过"提示淡入/滑移与此位联动，运行时态） */
  respawnSkipUi = false;
  /** 硬核幽灵态（Player.cs:16894-16901 difficulty==2 → respawn 计时到点 ghost=true；
   *  本仓 Game.respawnPlayer 对 hardcoreDead 拒绝重生 → 计时到期即幽灵相。
   *  满值 = GetRespawnTime（:38384-38422）：600t 基准 + boss 在场 600（:38398
   *  `if (flag) num += 600`）→ 【之后】专家 ×1.5（:38402-38404——boss 在场专家
   *  = (600+600)×1.5 = 1800，非 900+600）——死亡置值时刻在 Game 死亡分支 */
  isGhostPhase(world: import('../world/World').World): boolean {
    // ★倒计数语义（2026-08-25）：respawnTimer 已改死亡置满值递减（:38303/:16896），
    //  硬核幽灵相 = 计时到期（≤0）而非"越过阈值"。阈值判断已前移到死亡置值时刻
    // ★EXTRA_LIFE 批（2026-09-04）：补 :17161 完整门——原版 `difficulty == 2 &&
    //  (statLifeMax <= 0 || !Main.surviveHardcoreDeath)` 才 ghost 化（:17161），
    //  survive 组合世界（theConstant×tenthAnniversary 非 FTW,Main.cs:2723）扣 60 上限
    //  后仍有余额 → 走 :17170 else 支正常重生（Spawn(ReviveFromDeath)）不 ghost 化
    return this.dead && this.appearance?.difficulty === 2
      && (this.baseMaxHp <= 0 || !surviveHardcoreDeath(world.seedFlags))
      && this.respawnTimer <= 0;
  }

  // ============ 眼睑状态机（PlayerEyeHelper.cs 全文 1:1） ============

  /** PlayerEyeHelper.Update（:32-37）：SetStateByPlayerInfo → UpdateEyeFrameToShow →
   *  _timeInState++。逐 tick 由 fixedUpdate 驱动（原版 Player.Update :25812 调用点） */
  /** SpawnHallucination（Player.cs:13627-13656）1:1：Bone Helm（5100）在功能配饰槽
   *  （armor[0-9]——GrantArmorBenefits :12521 循环域）→ cooldown 递减 → 归零重掷
   *  Next(20,101) → 候选（CanBeChasedBy + 距离 ≤500 + CanHitLine）随机一只 →
   *  RandomizeInsanityShadowFor(isHostile:false) → 964 号弹（damage 18 / kb 0） */
  private updateInsanityShadow(game: GameHooks): void {
    this.insanityShadowCooldown = Math.max(0, Math.min(100, this.insanityShadowCooldown - 1));
    if (this.insanityShadowCooldown > 0) return;
    this.insanityShadowCooldown = 20 + Math.floor(Math.random() * 81);   // Next(20,101)
    // Bone Helm 检出（armor[0..9] 任一 vid 5100）
    let hasBoneHelm = false;
    for (let i = 0; i <= 9; i++) {
      const it = this.inv.armor[i];
      if (it && (ITEM_DEFS[it.id]?.vid ?? -1) === 5100) { hasBoneHelm = true; break; }
    }
    if (!hasBoneHelm) return;
    // 候选敌怪（:13641-13649：CanBeChasedBy + Distance ≤ 500 + CanHitLine）
    const store = game.world.store;
    const candidates: Array<{ cx: number; cy: number }> = [];
    for (const e of game.enemies() as unknown as Array<{ x: number; y: number; w: number; h: number; cx: number; cy: number; dead: boolean }>) {
      if (e.dead || !canBeChasedBy(e)) continue;
      if (Math.hypot(e.cx - this.cx, e.cy - this.cy) > 500) continue;
      if (!canHitLine(store, this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h)) continue;
      candidates.push(e);
    }
    if (candidates.length === 0) return;
    const t = candidates[Math.floor(Math.random() * candidates.length)];
    game.spawnInsanityShadow?.(randomizeFriendlyInsanityShadow(t.cx, t.cy));
  }

  /** 眼球伞（DoEyebrellaRainEffect Player.cs:13888-13919 + eyebrellaCloud :12661）与
   *  水晶鞋（DoGlassSlipperSparkles :13866-13887，ApplyEquipVanity :13821 门 =
   *  armor[13-19] 时装配饰槽）——饥荒联动小件，每 tick。 */
  private updateDontStarveCosmetics(game: GameHooks, world: import('../world/World').World): void {
    const headVid = (slot: number) => {
      const it = this.inv.armor[slot];
      return it ? (ITEM_DEFS[it.id]?.vid ?? -1) : 0;
    };
    // ---- 眼球伞：armor[0]（头盔）或 armor[10]（时装头）任一 = 5101（:12660-12664）----
    const eyebrella = headVid(0) === 5101 || headVid(10) === 5101;
    this.eyebrellaCloud = eyebrella;
    if (eyebrella && Math.random() * 4 < 1) {
      // 头顶出生点：MountedCenter − height×0.5 + x∈[−0.5,0.5)×(width+18) − 30
      // （坐骑 54 头顶偏移 −14×Directions 未建模——坐骑 54 = 月总头坐骑，登记）
      const vx = this.cx + (-0.5 + Math.random()) * (this.w + 18);
      const vy = this.cy - this.h * 0.5 - 30;
      const tx = Math.floor(vx / 16), ty = Math.floor(vy / 16);
      const st = world.store;
      if (st.inBounds(tx, ty)) {
        const i = st.idx(tx, ty);
        const dj = TILE_DEFS[st.type[i]];
        // WorldGen.SolidTile3 = nactive() && tileSolid && !tileSolidTop
        // （WorldGen.cs:71010-71014）+ tile.liquid <= 0（Player.cs:14432）——
        // nactive 门读 isActive（红蓝对抗 F9：曾用 type≠0 代读 active 位，
        // 幽灵残型头顶格误判实心 → 眼球伞不落雨）
        const solid3 = st.isActive(tx, ty)
          && !!dj?.solid && !dj?.platform;
        if (!solid3 && st.liquid[i] <= 0) {
          game.spawnRainForced?.(vx, vy, (world.weather?.windSpeedCurrent ?? 0) * 3, 9);
        }
      }
    }
    // ---- 水晶鞋：armor[13-19]（时装配饰槽）任一 = 5077（ApplyEquipVanity :13821）----
    let slipper = false;
    for (let i = 13; i <= 19; i++) {
      if (!this.inv.isItemSlotUnlockedAndUsable(i)) continue;   // ★清偿刀 P：ApplyEquipVanity :13110 同门
      const it = this.inv.armor[i];
      if (it && (ITEM_DEFS[it.id]?.vid ?? -1) === 5077) { slipper = true; break; }
    }
    if (slipper) {
      const D = game.vanillaDust;
      const shoeDye = this.inv.dye[2];
      const dyeVid = shoeDye ? (ITEM_DEFS[shoeDye.id]?.vid ?? -1) : -1;
      if (D && Math.random() * 60 < 1) {
        // 尘 204：CenteredRectangle(Center+(0,16×grav),20×8)、alpha 150、scale 0.3、
        // fadeIn 1、velocity×0.1、noLight、shader=cShoe（:13868-13877）
        const rx = this.cx - 10, ry = this.cy + 16 - 4;
        const d = D.spawn(rx, ry, 20, 8, 204, 0, 0, 150, null, 0.3);
        if (d) { d.fadeIn = 1; d.vx *= 0.1; d.vy *= 0.1; d.noLight = true; d.dyeVid = dyeVid; }
      }
      if (D && this.onGround && Math.abs(this.vx) + Math.abs(this.vy) > 1
        && Math.random() * 10 < 1) {
        // CanSpawnWalkingEffects 门（|vx|+|vy|>1）+ CenteredRectangle(Center+(−2×dir,16),6×8)
        const rx = this.cx + (-2 * this.facing) - 3, ry = this.cy + 16 - 4;
        const d = D.spawn(rx, ry, 6, 8, 204, 0, 0, 150, null, 0.3);
        if (d) { d.fadeIn = 1; d.vx *= 0.1; d.vy *= 0.1; d.noLight = true; d.dyeVid = dyeVid; }
      }
    }
  }

  /** 眼球伞云盖标记（Player.cs:1884 eyebrellaCloud——渲染层 DrawPlayer_38 消费） */
  eyebrellaCloud = false;

  /** CanAcceptItemIntoInventory（Player.cs:35172-35179）★F5① 消费端面：
   *  preventAllItemPickups（4346 拖累石——RefreshMechanicalAccsFromItemType
   *  :12917-12919 主背包/装备/虚空袋三路聚合）生效期，世界物品拾取/拉取两通道
   *  （GrabItems :35187 门 + CanPullItem :39453 门）只放行 IgnoresEncumberingStone
   *  白名单成员（心/星族,ItemID.cs:250 字面）。
   *  vanillaVid = 物品的原版 id（非原版物按不在白名单论=拒）。 */
  canAcceptItemIntoInventory(vanillaVid: number): boolean {
    if (!this.equipStats.preventAllItemPickups) return true;
    return IGNORES_ENCUMBERING_STONE_VIDS.has(vanillaVid);
  }

  // ---- 虫洞药水（item 2997 WormholePotion：HasUnityPotion/TakeUnityPotion
  //     Player.cs:41652-41697；消费链 = 观战键 B 传送 HandleSpectatingControls
  //     :16942-16947，CanWormholeToSpectating :17002-17009）----
  /** useVoidBag（Main.TryInteractingWithVoidLens 族）：背包 58 格任一 4131 虚空透镜 */
  useVoidBag(): boolean {
    for (let i = 0; i < 58; i++) {
      const s = this.inv.slots[i];
      if (s && s.stack > 0 && (ITEM_DEFS[s.id]?.vid ?? -1) === 4131) return true;
    }
    return false;
  }

  /** GetItem_VoidVault（孤儿武器 B3 波 工单1；Player.cs:39710-39731）：
   *  【满背包溢流入虚空保险库】——PickupItemFromWorld.CanGoIntoVoidVault=true 门下
   *  （GetItemSettings.cs:12；同旗通道还有 LootAllFromChest/RefundConsumedItem，
   *  LootAllFromChest 消费位 Terraria.UI/ChestUI.cs:391-412，RefundConsumedItem 消费位
   *  CraftingRequests.cs:339-341），背包 58 格接不住的余量进 bank4：占用堆叠先合并
   *  （CanStack=同 type【且同 prefix】,Player.cs:39749→Item.CanStack Item.cs:49870-49876;
   *  ★F2 词缀语义补齐）→ 空位整堆落格(:39835-39857,inv[i]=returnItem 整件随行含 prefix)。
   *  @param prefix 手头件的词缀（Item.prefix，缺省=无）——合并门与空位落格共用。
   *  CanVoidVaultAccept(:39733-39745)：questItem ∪ 3822(DD2EnergyCrystal 埃特尼亚魔力)
   *  拒——WorksInVoidBag 缺省全真(ItemID.cs:82 仅 4346/5095 两件例外)。
   *  ★终零波批注订正：旧注"例外未逐 id 建表"退役——WORKS_IN_VOID_BAG_FALSE 即逐
   *  id 真值表（模块常量区）。
   *  返回仍未入袋数量。
   *  ★F4 拒收门补挂（此前漏 CanVoidVaultAccept 半臂）：任务鱼 questFish 全表
   *  （QUEST_ITEM_VIDS = DefaultToQuestFish 调用面 [2450..2488]∪{4393,4394}，见常量注）
   *  与 3822 灌袋时原样返回——拒绝面=留在原地不掉入袋（vanilla GetItem 汇流门
   *  :39703 不过即 `return item;` 余量退回世界）。调用方 ItemDrop.ts 不改：
   *  dep==stack 自然走残余路径。
   *  ★原版语义澄清：虚袋不持续吸物,只在背包装不下时兜底（IsVoidVaultEnabled 空位判定
   *  支 Player.cs:39509-39525）；本方法即溢流通道唯一入口。 */
  depositIntoVoidVault(itemId: number, stack: number, prefix?: number): number {
    if (!this.useVoidBag() || stack <= 0) return stack;
    // ★F4 门序对齐原文：CanVoidVaultAccept 在 GetItem 收尾汇流门（Player.cs:39703）
    // 判一次,GetItem_VoidVault 函数体内再判一次（:39711-39714）——本仓单点等价
    if (!canVoidVaultAccept(ITEM_DEFS[itemId]?.vid ?? -1)) return stack;
    const vault = this.banks[3];
    let left = stack;
    const pfx = prefix ?? 0;   // Item.prefix 缺省=无;比对式对齐 QuickStacking.canStack 先例
    // 占用堆叠合并（GetItem_FillIntoOccupiedSlot_VoidBag :39747-39792——该支原文无
    // DoCoins,占用合并不触发换币）。★F2 受理门=Item.CanStack(returnItem, inv[i])
    // （Player.cs:39749 → Item.cs:49870-49876：同 type【且同 prefix】才可并堆）,
    // 异词缀互融=词缀堆污染(原版同词缀门,QuickStacking.canStack 同款判定先例)
    for (let i = 0; i < vault.length && left > 0; i++) {
      const s = vault[i];
      if (!s || s.stack <= 0 || (ITEM_DEFS[s.id]?.vid ?? -1) !== (ITEM_DEFS[itemId]?.vid ?? -1)) continue;
      if ((s.prefix ?? 0) !== pfx) continue;
      const max = ITEM_DEFS[s.id]?.maxStack ?? 999;
      const put = Math.min(max - s.stack, left);
      if (put <= 0) continue;
      s.stack += put;
      left -= put;
    }
    // 空位落格（GetItem_FillEmptyInventorySlot_VoidBag :39835-39857）——★F2 原文
    // `inv[i] = returnItem` 整件随行含 prefix（:39845),新建槽带词缀位
    for (let i = 0; i < vault.length && left > 0; i++) {
      if (vault[i]) continue;
      const put = Math.min(ITEM_DEFS[itemId]?.maxStack ?? left, left);
      vault[i] = pfx ? { id: itemId, stack: put, prefix: pfx } : { id: itemId, stack: put };
      left -= put;
      // ★DoCoins 币种兑换尾随（:39844-39847 PopText 之后逐槽 `if(!NoCoinMerge)
      //  DoCoins(i)`）——★反编译原文读的是 this.inventory（主背包）同下标位,【不是】
      // 形参 inv 数组（bank4 本体不换币）;PickupItemFromWorld/LootAllFromChest/
      // RefundConsumedItem 三通道 NoCoinMerge 均缺省 false=恒生效。槽位级原式
      // 见 Inventory.doCoinsAt。
      this.inv.doCoinsAt(i);
    }
    return left;
  }
  /** HasUnityPotion（:41652-41669）：背包 58 格任一 2997；持虚空透镜时 bank4（banks[3]）也计 */
  hasUnityPotion(): boolean {
    for (let i = 0; i < 58; i++) {
      const s = this.inv.slots[i];
      if (s && (ITEM_DEFS[s.id]?.vid ?? -1) === 2997 && s.stack > 0) return true;
    }
    if (this.useVoidBag()) {
      const b = this.banks[3];
      for (let j = 0; j < b.length; j++) {
        const s = b[j];
        if (s && (ITEM_DEFS[s.id]?.vid ?? -1) === 2997 && s.stack > 0) return true;
      }
    }
    return false;
  }
  /** TakeUnityPotion（:41672-41697）：扣 1 瓶（背包优先 → 空位 SetDefaults(0)；
   *  持虚空透镜时 bank4 兜底） */
  takeUnityPotion(): void {
    for (let i = 0; i < 58; i++) {
      const s = this.inv.slots[i];
      if (s && (ITEM_DEFS[s.id]?.vid ?? -1) === 2997 && s.stack > 0) {
        s.stack--;
        if (s.stack <= 0) this.inv.slots[i] = null;   // SetDefaults(0) = 清空
        return;
      }
    }
    if (!this.useVoidBag()) return;
    const b = this.banks[3];
    for (let j = 0; j < b.length; j++) {
      const s = b[j];
      if (s && (ITEM_DEFS[s.id]?.vid ?? -1) === 2997 && s.stack > 0) {
        s.stack--;
        if (s.stack <= 0) b[j] = null;
        return;
      }
    }
  }

  // ---- 抚摸宠物链（Player.cs:32881-32942 PetAnimal/PetMount + :33009-33033
  //     UpdatePettingAnimal + CanSnapToPosition :32945-32983；PlayerPettingInfo
  //     Terraria.GameContent/PlayerPettingInfo.cs）----
  /** 抚摸状态（Player.petting）。offsetFromPet = 目标 Bottom 的偏移（宠物在哪侧，
   *  玩家站对侧）；targetBottom = 快照（>2px 漂移即停，:33020） */
  readonly petting = {
    isPetting: false,
    isPetSmall: false,
    offsetX: 0, offsetY: 0,
    targetBottomX: 0, targetBottomY: 0,
    /** 坐骑抚摸支（PlayerPettingInfo.mount，Player.cs:33613 构造第三态）：
     *  骑乘 62-65 时右键坐骑 → PetMount（:33601-33620）——不 snap 站位（人已在坐骑上），
     *  UpdatePettingAnimal :33746-33752 mount 支 num=direction（无对侧站位语义） */
    mount: false,
    /** 宠物跟随体存活校验回调（Game 注入——目标死亡/换宠返回 false） */
    validTarget: null as null | (() => boolean),
  };
  /** 抚摸手臂动画档（ItemCheck_ApplyHoldStyle :49481-49508：miscCounter%14/7
   *  两档——0=ThreeQuarters / 1=Full；角度 = −2π×0.3×dir（小宠 0.2）。
   *  渲染侧无复合手臂层（引擎级缺口），仅暴露档位数据，登记） */
  get pettingArmPhase(): number { return Math.trunc(this.miscCounter % 14 / 7); }

  /** PetAnimal（:32901-32942）：snap 到宠物旁 → 置 petting 态。返回 false = 站位
   *  不可达（CanSnapToPosition / 地面非实心）。target 形参 = 宠物跟随体。 */
  petAnimal(game: GameHooks, target: {
    cx: number; bottomY: number; valid: () => boolean; isSmall: boolean; reach: number;
  }): boolean {
    // 站位点 = 目标 Bottom + offsetFromPet（取整，:32906 Floor）+ 要求脚下实心
    // （SolidTileAllowBottomSlope——斜坡底允许；本仓 solid 判定含半砖近似，登记）
    const num = Math.sign(target.cx - this.cx) || 1;       // num = 宠在玩家右侧?1:-1
    const ox = -num * target.reach;
    const vx = Math.floor(target.cx + ox);
    const vy = Math.floor(target.bottomY);
    const st = game.world.store;
    const gx = Math.floor(vx / 16), gy = Math.floor(vy / 16);
    if (!st.inBounds(gx, gy)) return false;
    if (!st.isSolid(gx, gy)) return false;   // SolidTileAllowBottomSlope 底面（实心底）
    // 已在抚摸同位 → 二次交互 = 停止（:32917-32921）
    if (this.petting.isPetting && Math.trunc(this.y + this.h) === vy
      && Math.abs(Math.trunc(this.x) - Math.trunc(vx - this.w / 2)) < 2) {
      this.stopPettingAnimal();
      return false;
    }
    // CanSnapToPosition（:32945-32965）：目标盒无实心碰撞 + 可视直线（薄柱回退）
    const nx = vx - this.w / 2, ny = vy - this.h;
    if (!this.canSnapToPosition(game, nx - this.x, ny - this.y)) return false;
    // StopVanityActions（:32923 坐/睡/抚摸互斥）+ RemoveAllGrapplingHooks（:32924）
    this.sitting = false;
    this.sleeping = false;
    this.removeAllGrapplingHooks();
    this.x = nx; this.y = ny;
    this.vx = 0; this.vy = 0;
    this.facing = num === 0 ? this.facing : -Math.sign(ox);   // 面向宠物（ChangeDir(sign(−offset))）
    this.petting.isPetting = true;
    this.petting.isPetSmall = target.isSmall;
    this.petting.offsetX = ox;
    this.petting.offsetY = 0;
    this.petting.targetBottomX = target.cx + ox;
    this.petting.targetBottomY = target.bottomY;
    this.petting.validTarget = target.valid;
    this.petting.mount = false;
    return true;
  }

  /** PetMount（Player.cs:33601-33620）：骑乘中右键坐骑的抚摸支——toggle 语义
   *  （抚摸中再点 = Stop，:33603-33606）；置 petting.mount 态（无站位 snap——
   *  PetAnimal 的 TryGetTarget 门 :33627-33629 对 mount 态恒 false，直接落状态位）。
   *  返回 = 是否进入抚摸态（true 时 Game 侧播 PalChilletJoy + 成就 21——
   *  :33614-33619 音效在 PetMount 内、HandleSpecialEvent(21) :33612） */
  petMount(): boolean {
    if (this.petting.isPetting) {
      this.stopPettingAnimal();
      return false;
    }
    this.stopPettingAnimal();
    this.petting.isPetting = true;
    this.petting.mount = true;
    this.petting.isPetSmall = false;          // isPetSmall: false（Mount.cs:6164）
    this.petting.validTarget = null;
    return true;
  }

  /** StopPettingAnimal（:33009-33012） */
  stopPettingAnimal(): void {
    this.petting.isPetting = false;
    this.petting.mount = false;
    this.petting.validTarget = null;
  }

  /** CanSnapToPosition（:32945-32983）：!SolidCollision(pos+offset) + CanHit 直线，
   *  失败回退宽 w−2 薄柱两向（TryAllowingSnappingToPosition :32986-33000）。
   *  第三回退（TileCollision 横向试走）以同距实心盒检查等价（登记） */
  private canSnapToPosition(game: GameHooks, offX: number, offY: number): boolean {
    const st = game.world.store;
    const tx = this.x + offX, ty = this.y + offY;
    if (!solidCollisionBox(st, tx, ty, this.w, this.h)) {
      return canHitLine(st, this.x, this.y, this.w, this.h, tx, ty, this.w, this.h);
    }
    // 薄柱回退（TryAllowingSnappingToPosition：w−2 宽两柱互见）
    const thin = this.w - 2;
    if (canHitLine(st, this.x + thin, this.y, 2, this.h, tx, ty, 2, this.h)) return true;
    if (canHitLine(st, this.x + thin, this.y, 2, this.h, tx + thin, ty, 2, this.h)) return true;
    return false;
  }

  /** UpdatePettingAnimal（:33015-33033）：目标失效/漂移 >2px/移动键/换向 → 停 */
  private updatePettingAnimal(): void {
    if (!this.petting.isPetting) return;
    // 坐骑抚摸支（:33746-33752）：TryGetTarget 对 mount 态恒 false → 跳过漂移门；
    // num = direction（:33748-33750 坐骑无对侧站位）→ `num != direction` 恒 false
    if (this.petting.mount) {
      // controlLeft/Right/Up/Down/Jump || pulley || (mount.Active && !petting.mount)
      // （:33751）——本仓 pulley 未跟踪（登记）；骑乘中抚摸的 mount.Active && !mount
      // 恒 false；下坐即停（Dismount :6228-6231 显式 Stop，Mounts/Game 下坐路径调）
      if (this.inputX !== 0 || this.inputUp || this.inputDown || this.inputJump) {
        this.stopPettingAnimal();
      }
      return;
    }
    const ok = this.petting.validTarget?.() ?? false;
    const drift = Math.hypot(
      this.petting.targetBottomX - (this.x + this.w / 2),
      this.petting.targetBottomY - (this.y + this.h));
    if (!ok || drift > 2) { this.stopPettingAnimal(); return; }
    const num = Math.sign(-this.petting.offsetX);
    // controlLeft/Right/Up/Down/Jump || pulley || (mount.Active && !petting.mount)
    // （:33030——inputX 覆盖左右、inputUp/Down 上下;pulley 骑绳与骑乘中两个停门
    //   由 ★⑩ 台账清偿批补齐）
    if (this.inputX !== 0 || this.inputUp || this.inputDown
      || this.inputJump || this.pulley || this.mount.active || num !== this.facing) {
      this.stopPettingAnimal();
    }
  }

  /** 换向沿备案（UpdatePettingAnimal :33752 `num != direction` 的坐骑支——
   *  num=direction 恒等,坐骑抚摸无换向停门；宠物支的换向停门见上） */

  private updateEyeState(game: GameHooks): void {
    // SetStateByPlayerInfo（:75-122）——优先级：致盲 > 受击锁存 > 床 > 中度伤 > 醉 >
    // 毒 > 风暴眯眼 > 正常眨眼
    if (this.buffs.has(BuffType.Blackout) || this.buffs.has(BuffType.Darkness)) {
      this.switchEyeState(EYE_BLIND);        // blackout/blind（:77-80）
    } else if (this.eyeState === EYE_HURT && this.eyeTimeInState < 20) {
      // 受击档锁存 20t（:83-86——期间更高优先级判定也让位）
    } else if (this.sleeping) {
      this.switchEyeState(EYE_BED, this.itemAnimTicks > 0);   // :87-91 reset=itemAnimation>0
    } else if (this.hp <= this.maxHp * 0.25) {
      this.switchEyeState(EYE_HURTDMG);      // :93-96 中度伤 = statLife ≤ statLifeMax2×0.25（:133-136）
    } else if (this.buffs.has(BuffType.Tipsy)) {
      this.switchEyeState(EYE_TIPSY);        // :98-101
    } else if (this.buffs.has(BuffType.Poisoned) || this.buffs.has(BuffType.Venom)
      || this.buffs.has(BuffType.Starving)) {
      this.switchEyeState(EYE_POISON);       // :103-106 poisoned||venom||starving（饥饿链 2026-08-20 补）
    } else {
      // :108-120 风暴眯眼 = ZoneSandstorm || (ZoneSnow && IsItRaining)；behindBackWall
      // 抑制位本仓无追踪（恒 false，登记偏离）
      const storm = !!game.scene?.zoneSandstorm
        || (!!game.scene?.zoneSnow && !!game.world.weather.raining);
      this.switchEyeState(storm ? EYE_STORM : EYE_BLINK);
    }
    // UpdateEyeFrameToShow（:39-73）——输出 0 睁 / 1 半闭 / 2 全闭
    const t = this.eyeTimeInState;
    let frame: number;
    switch (this.eyeState) {
      case EYE_BLINK: {
        // :46-47 正常眨眼：240t 周期末 6t——半闭 2t→闭 2t→半闭 2t
        const n = t % 240 - 234;
        frame = n >= 4 ? 1 : n < 2 ? (n >= 0 ? 1 : 0) : 2;
        break;
      }
      case EYE_STORM:
        frame = t % 120 - 114 < 0 ? 1 : 2;   // :51 眯眼 + 每 120t 末 6t 全闭
        break;
      case EYE_HURTDMG:
      case EYE_TIPSY:
      case EYE_POISON:
        frame = t % 120 - 100 < 0 ? 1 : 2;   // :56 耷拉眼 + 每 120t 末 20t 全闭
        break;
      case EYE_BED: {
        // :58-63 计时被 timeSleeping 覆写；<60 中度伤半闭/否则睁，60-119 半闭，≥120 全闭
        this.eyeTimeInState = this.timeSleeping;
        const base = this.hp <= this.maxHp * 0.25 ? 1 : 0;
        frame = this.timeSleeping >= 120 ? 2 : this.timeSleeping >= 60 ? 1 : base;
        break;
      }
      case EYE_BLIND:
      case EYE_HURT:
      default:
        frame = 2;                            // :65-70 致盲/受击恒全闭
        break;
    }
    this.eyeFrame = frame;
    this.eyeTimeInState++;                    // :36（EYE_BED 已被覆写为 timeSleeping）
  }

  /** SwitchToState（:124-131）：换态清零计时（同态不重置，除显式 reset） */
  private switchEyeState(state: number, reset = false): void {
    if (this.eyeState !== state || reset) {
      this.eyeState = state;
      this.eyeTimeInState = 0;
    }
  }

  /** ★F13（2026-08-31 蓝队三批）SetImmuneTimeForAllTypes 仓内形（Player.cs:38298-38306）：
   *  General 位 = iframes；全部特殊桶（WrongBugNet/Lava 等）经全局登记表【无条件】
   *  满填——原版循环直写无空位门。未登记（纯单元测桩）只落 iframes 面。 */
  /** SetImmuneTimeForAllTypes 全桶满填（★Notes② 四轮蓝队：Player.cs:38298-38306
   *  `immune=true; immuneTime=time; for(i..) hurtCooldowns[i]=time;`——**无条件覆写**
   *  非 max 合并;既有免疫窗可被直接缩短,与原文逐字。桶表 setAll 同为无条件形）。 */
  private dodgeFullFill(ticks: number): void {
    this.iframes = ticks;
    getGlobalHurtBuckets()?.setAll(ticks);
  }

  // ---- ★A2/A3（清零批·受击域）：环境伤族 msg117 漏斗路由 + Lava 独立桶门 ------------

  /** 岩浆站前置门（1457 Player.cs:27889 字面 `hurtCooldowns[ImmunityCooldownID.Lava]
   *  <= 0`）：Lava(4) 是【独立桶】，与 General immune/iframes 位互不查——General 无敌
   *  窗内照常吃岩浆、反之岩浆窗内敌怪接触照常受理（两表互斥判定，:38493 Hurt 入口
   *  分道）。全局桶表缺席（裸测桩）回退旧 iframes 门。 */
  private lavaBucketOpen(): boolean {
    const t = getGlobalHurtBuckets();
    return t ? !t.blocksHit(ImmunityCooldownID.Lava) : this.iframes <= 0;
  }

  /** 环境伤族统一出站器：Game.damagePlayer msg117 通用漏斗 + 冷却桶瞬态通道注入。
   *  · bucketId：原版 Hurt cooldownCounter 字面（Lava=4 / TileContactDamage=0 /
   *    General=-1 缺省不注入）——漏斗侧读通道派生 Counter/TeamDamageShare/Retaliate
   *    三集合与分桶免疫门；写面由 Player.damage 落 effBucket*（仅空位写入,如原文）。
   *  · knockback=false 恒定：环境站 hitDirection 全为 0 字面 ⇒ 不进 :37908 击退段；
   *  · opts.hitDir=0：FR3-F 钉语义（0=零击退）直发不重编码；
   *  · floatDealt/floatColor：本地飘字值由站点 damagePreview 预演回填（漏斗是唯一
   *    显示点——防双发且像素零漂移）；传 undefined 的站点（虚空坠落）原文本无飘字,
   *    以 noLocalFloat 抑制。
   *  返回 = 实扣 HP（>0 才授予着火/buff 等后续,对齐原版 num85>0.0 门 :27921/:29214）。 */
  private envHurtThroughFunnel(game: GameHooks, dmg: number, srcX: number, srcY: number,
    bucketId: number, floatDealt?: number, floatColor?: string): number {
    const chan = this as unknown as {
      __swNextHitBucket?: { id: number; table: import('../player/HurtCooldownBuckets').HurtCooldownBuckets };
    };
    const buckets = getGlobalHurtBuckets();
    const injected = !!(buckets && bucketId >= 0);
    if (injected) chan.__swNextHitBucket = { id: bucketId, table: buckets };
    try {
      return game.damagePlayer(dmg, srcX, srcY, undefined, false, false, false, {
        hitDir: 0,
        floatDealt,
        floatColor,
        noLocalFloat: floatDealt === undefined,
      }) ?? 0;
    } finally {
      if (injected) chan.__swNextHitBucket = undefined;
    }
  }


  /** BlinkBecausePlayerGotHurt（:138-141）：受击全闭 20t（Hurt :37916 调用） */
  eyeBlinkHurt(): void {
    this.switchEyeState(EYE_HURT, true);
  }

  /** 原版 buff id 直查（UpdateBuffs 效果循环 `buffType[j]==N` 等价形）：
   *  本仓 BuffType 为内部 id，原版 id 经 BUFF_DEFS[type].vanillaBuff 映射——
   *  仅覆盖已登记枚举成员，未建模 buff 恒 false。shadowDodge(buff59) 等直判位共用 */
  private hasVanillaBuff(vanillaBuffId: number): boolean {
    for (const t of this.buffs.active.keys()) {
      if (BUFF_DEFS[t]?.vanillaBuff === vanillaBuffId) return true;
    }
    return false;
  }

  /** 按【原版】id 剥离 buff（Player.DelBuff 在效果循环内的等价删除面）。
   *  只删首个命中槽——与原版 DelBuff(i) 循环内 break 后续帧再删同语义 */
  private removeVanillaBuff(vanillaBuffId: number): void {
    for (const t of this.buffs.active.keys()) {
      if (BUFF_DEFS[t]?.vanillaBuff === vanillaBuffId) { this.buffs.remove(t); return; }
    }
  }
}

/** PlayerEyeHelper.EyeState 枚举序（PlayerEyeHelper.cs:12-22） */
const EYE_BLINK = 0;    // NormalBlinking
const EYE_STORM = 1;    // InStorm
const EYE_BED = 2;      // InBed
const EYE_HURT = 3;     // JustTookDamage
const EYE_HURTDMG = 4;  // IsModeratelyDamaged
const EYE_BLIND = 5;    // IsBlind
const EYE_TIPSY = 6;    // IsTipsy
const EYE_POISON = 7;   // IsPoisoned

/** Collision.SolidCollision（Terraria/Collision.cs 同名方法 1:1）：盒内任一实心
 *  非站顶格相交（半砖下移 8/高 8；扫描域 ±1/-1..+2 padding 同原版）。
 *  抚摸链 CanSnapToPosition（Player.cs:32948）消费 */
export function solidCollisionBox(
  st: { inBounds(x: number, y: number): boolean; idx(x: number, y: number): number; type: unknown; isSolid(x: number, y: number): boolean },
  px: number, py: number, w: number, h: number,
): boolean {
  const store = st as unknown as {
    inBounds(x: number, y: number): boolean; idx(x: number, y: number): number;
    type: Uint16Array; half: Uint8Array; isSolid(x: number, y: number): boolean;
  };
  const x0 = Math.max(0, Math.floor(px / 16) - 1);
  const x1 = Math.floor((px + w) / 16) + 2;
  const y0 = Math.max(0, Math.floor(py / 16) - 1);
  const y1 = Math.floor((py + h) / 16) + 2;
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      if (!store.inBounds(i, j)) continue;
      if (!store.isSolid(i, j)) continue;   // active && !inActive && tileSolid（含致动门）
      const k = store.idx(i, j);
      if (TILE_DEFS[store.type[k]]?.platform) continue;   // !tileSolidTop
      let ty = j * 16, th = 16;
      if (store.half[k]) { ty += 8; th -= 8; }            // halfBrick
      if (px + w > i * 16 && px < i * 16 + 16 && py + h > ty && py < ty + th) return true;
    }
  }
  return false;
}

/** FTW 克脑重力倒置求值（NPC.brainOfGravity → Player.forcedGravity 消费端；
 *  从 fixedUpdate 抽出便于单测）：
 *  - Producer：克脑 266 二阶段每 tick 写 world.brainOfGravity=实体 id
 *    （NPC.cs:32650-32653，bossAI.brainOfCthulhuAI；仅 getGoodWorld 种子）。
 *  - 本端：锚有效且距脑 <4000px → forcedGravityT=10（Player.cs:26489-26493，
 *    Vector2.Distance 中心距）；计数 >0 强制 gravDir=-1（:26494-26496），每 tick
 *    衰减（:18496-18498）；计数尽时归位 gravDir=1——原版由 :26933 else 支每 tick
 *    复位（无重力药水时），此处等价在倒置结束 tick 复位；带重力药水（gravControl）
 *    时原版药水分支接管不复位,同款跳过。
 *  - 锚失效（死亡/非 266）→ 清 -1（Main.cs:18127 每帧校验）。
 *  普通世界 brainOfGravity 恒 -1 → 整段零行为。 */
export function consumeBrainOfGravity(p: Player, game: GameHooks): void {
  const bgId = game.world.brainOfGravity;
  if (bgId >= 0) {
    const bg = (game.enemies() as Array<{ id: number; dead: boolean; vanillaId?: number; cx: number; cy: number }>)
      .find((n) => !n.dead && n.id === bgId && n.vanillaId === 266);
    if (!bg) game.world.brainOfGravity = -1;
    else if (Math.hypot(bg.cx - p.cx, bg.cy - p.cy) < 4000) p.forcedGravityT = 10;
  }
  if (p.forcedGravityT > 0) {
    p.gravDir = -1;
    if (--p.forcedGravityT === 0 && !p.buffs.has(BuffType.Gravitation)) p.gravDir = 1;
  }
}

/** ★SW-FX19：重力倒置总闸（Player.cs:26893-26937,HorizontalMovement 后 1:1；从
 *  Game 输入段抽出便于单测）：
 *  - forcedGravity>0（FTW 克脑,forcedGravityT 消费端）→ gravDir=-1（:26894-26896）；
 *  - gravControl（重力药水 buff 18,Player.cs:10115）∨ gravControl2（重力地球仪
 *    1131,Player.cs:15184 装备位——RefreshMechanicalAccsFromItemType 同款槽扫）
 *    且 !mount.Active（flag18 :26892）→ controlUp 按下沿翻转 gravDir + fallStart
 *    重置 + jump=0 + 音效 8（SoundID.Item8=DoorOpen,LegacySoundPlayer.cs:731→
 *    本仓 'door_open'）（:26897-26912/:26917-26932 两支同形）；
 *  - 两者皆无 → 每 tick gravDir=1（:26936-26937 else 支——药水过期/卸下地球仪
 *    即回正；旧实现缺此支=倒挂后过期即永久死锁）。
 *  @param upEdge 本 tick Up 按下沿（≙ 原版 `controlUp && releaseUp`,releaseUp=
 *    !controlUp 上一帧 UpdateControlHolds 值 :29324-29331） */
export function updateGravityControls(
  p: Player,
  upEdge: boolean,
  playSfx?: (name: string, vol?: number, x?: number, y?: number) => void,
): void {
  const gravControl = p.buffs.has(BuffType.Gravitation);
  // ★清偿刀 P：配饰扫描逐槽解锁门（:13044 面,1131 重力地球仪）
  const gravControl2 = playerAccessoryVidEquipped(p.inv.armor, (k) => p.inv.isItemSlotUnlockedAndUsable(k), 1131);
  if (p.forcedGravityT > 0) {
    p.gravDir = -1;
  } else if ((gravControl || gravControl2) && !p.mount.active) {
    if (upEdge) {
      p.gravDir = p.gravDir === 1 ? -1 : 1;
      p.fallStartY = p.y;                 // fallStart = position.Y/16（:26901/:26907）
      p.jumpHold = 0;                     // jump = 0（:26902/:26908）
      playSfx?.('door_open', 1, p.cx, p.cy);
    }
  } else {
    p.gravDir = 1;                        // :26936-26937
  }
}
