// 坐骑系统（1.4.5.6 原版 1:1 移植：Terraria/Mount.cs + Terraria.ID/MountID.cs +
// Player.cs 骑乘接管段 :26310-26334/:26416/:26637-26700/:35734-35790）。
//
// 数据源 = tools/extract-mounts.mjs 从反编译源码提取的 src/data/vanilla-mounts.json
//（64 坐骑全量：参数/帧组/贴图表名/能力位/召唤物品/坐骑 buff）。
// ★1457 Trusty 坐骑 64/65（2026-08-23 Palworld 批）：提取器主源 1456 无此二条，
// 由 extract-mounts.mjs 的 MOUNTS_1457_TRUSTY overlay 并表（SetAsChillet hardmode 支
// 1457 Mount.cs:2682-2690 + 物品 6150/6151 Item.cs:47385-47410 + buff 391/392
// BuffID.cs:152 尾段；62-65 共用帧组/贴图 Extra_301/302.png）。
// 矿车族（MountID.Sets.Cart）走 src/entities/Minecart.ts 轨道运动学，本模块不回退
//（isCart 门：参数/帧状态仍可查询，物理由 Minecart 接管）。
//
// 三模物理接管（Player.fixedUpdate 挂钩）：
//   陆行族 —— Run 段参数覆写（Player.cs:26329-26331：maxRun=RunSpeed/accRun=DashSpeed/
//             runAcc=Acceleration），常规 moveAndCollide 碰撞照走；
//   飞行族 —— usesHover（UFO 7/蜜蜂 5/猪鲨崽 12/巫婆扫帚 23/熔岩鲨 49）走 Hover()
//             能量-疲劳双池 1:1；非 hover 的飞行坐骑（驯鹿 0/猪龙 2）走 Flight()
//             飞行时量 + 松键重力/3 衰减；
//   游泳族 —— 海龟 4/猪鲨崽 12/海盗船 44/熔岩鲨 49：buff 131/168/265 授予 ignoreWater
//             （Player.cs:9592-9608）→ 水下不降速不溺水物理，frameState==4 时
//             RunSpeed→swimSpeed、跳跃 +5 高 /+2.5 速（Mount.JumpHeight/JumpSpeed）。
// ★BJ206 2026-09-20 hoik 单向墙销案：骑乘体无独立碰撞承载——陆行/飞行/游泳全族
//   位移最终经玩家自身碰撞链（Player.hoik=true，SW-FX34b 已落），原版 Mount.cs 的
//   三处 TileCollision 探针（:3507/:4574/:4607）亦全部作用于 mountedPlayer 位置且
//   不传第 10 参吃 Collision.cs:2299 缺省 true——两半同相=骑乘态天然可穿单向墙，
//   无需任何落刀。
import mountJson from '../data/vanilla-mounts.json';
import { TILE_DEFS, FORBIDS_SLOPING_IDS } from '../data/tiles';
import { WALL_HOUSE } from '../world/Housing';
import { TownShot } from './TownShot';
import { TILE } from '../core/constants';
import { playerCanHitEnemy, projOverlap, applyBannerDamageDealt } from './projTargets';
import { projectileData } from '../data/vanillaProjectiles';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { canHitLine } from '../physics/LineOfSight';
import { damageVarRoll } from '../stats/DamageVar';   // ★SW-T1 2026-09-04 DV 单源接线
import { nextVector2Circular } from './SparkleGuitarProj';   // ★BJ707-G31 Utils.NextVector2Circular(4,4) 扫帚 spark 面（Utils.cs:1301-1304 单源）
// ★终清波批：930 圣坦爆散 gore 段（GorePiece.newGore 通道,旧"无 API 不接"退役）
import { GorePiece } from './GorePiece';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';

// ---- 原版 tile id（sheet）集 → 本仓内部 id 集（CanKillTile/CanPoundTile 子集用） ----
//  内部 id 与 sheet 非一一对应（同 sheet 变体共享判定）——按 TILE_DEFS.vanilla.sheet
//  全表扫描展开，与 Wiring.ts canKillTile 同源口径
const idsWithSheets = (...sheets: number[]): Set<number> => {
  const want = new Set(sheets);
  const out = new Set<number>();
  for (let i = 0; i < TILE_DEFS.length; i++) {
    if (want.has(TILE_DEFS[i].vanilla?.sheet ?? -1)) out.add(i);   // 数组下标 = 内部 id
  }
  return out;
};
/** TileID.Sets.IsATreeTrunk（TileID.cs:161）——CanKillTile 上方树干承载检查 */
const TREE_TRUNK_IDS = idsWithSheets(5, 72, 583, 584, 585, 586, 587, 588, 589, 596, 616, 634);
/** CanKillTile 上方承载族（WorldGen.cs:62289-62310：宝箱/祭坛/熔炉/倒木等）+ 棕榈 323 */
const SUPPORT_ABOVE_IDS = idsWithSheets(21, 26, 72, 77, 88, 467, 488);
const PALM_ABOVE_IDS = idsWithSheets(323);
const DRESSER_ABOVE_IDS = idsWithSheets(80);
// ★BJ158①（2026-09-18）：WorldGen.ForbidsSloping（:81484-81505）CanPoundTile 上格禁坡表
//  本地 idsWithSheets 平移副本拆除——收编 data/tiles.ts 单源 FORBIDS_SLOPING_IDS
//  （内部 id 域,与旧产物逐值全等已探针定谳）,消费面 canPoundTileAt 上格门改走单源。
/** CanPoundTile 类型黑名单（:81448-81459） */
const POUND_BLACKLIST_IDS = idsWithSheets(10, 48, 137, 232, 380, 387, 388, 476, 484);
/** TileID.Sets.Boulders（TileID.cs:195） */
const BOULDER_IDS = idsWithSheets(138, 484, 664, 665, 711, 712, 713, 714, 715, 716);
/** TileID.Sets.PreventsTileRemovalIfOnTopOfIt（TileID.cs:169）——CheckTileBreakability
 *  子项（WorldGen.cs:62496-62499） */
const PREVENTS_REMOVAL_ABOVE_IDS = idsWithSheets(5, 323, 72, 488, 26, 583, 584, 585, 586, 587, 588, 589, 596, 616, 470, 475, 634);
/** WorldGen.IsAContainer（WorldGen.cs:48832-48837：BasicDresser 88 ∪ {470 模特,475 帽架}
 *  ∪ BasicChest {21,467} ∪ BasicChestFake {441,468}） */
const CONTAINER_IDS = idsWithSheets(88, 470, 475, 21, 467, 441, 468);
/** TileID.Sets.BasicChest（TileID.cs:315）——CanKillTile case 21/467 锚点归一（%2） */
const BASIC_CHEST_IDS = idsWithSheets(21, 467);
/** 梳妆台 88（TileID.cs:319 BasicDresser）——CanKillTile case 88 锚点归一（%3） */
const DRESSER_CHEST_IDS = idsWithSheets(88);
/** 传送器 235（TileID.cs:903）——CanKillTile case 235 上方 3 格扫描 */
const TELEPORTER_IDS = idsWithSheets(235);
/** 关门表 10（TileID.cs ClosedDoor——内部 id 17；开门 11/内部 18 不参与锁判定） */
const DOOR_CLOSED_IDS = idsWithSheets(10);
/** 祭坛 77——CheckTileBreakability 的非困难模式保护（WorldGen.cs:62494-62495） */
const ALTAR_IDS = idsWithSheets(77);

// ★2026-09-03 MountData 接口与 MOUNT_DATA 表体抽出至 data/mountData.ts（叶子模块,
// TDZ 断环——Minecart 顶层面读 MOUNT_DATA 而本模块 import 子树回流 Minecart,红蓝
// 对抗 R4-F5b）。此处 re-export 兼容全部既有消费方。
import { MOUNT_DATA, type MountData } from '../data/mountData';
export { MOUNT_DATA, type MountData };

export const MOUNT_COUNT: number = mountJson.count;
/** ★第三批(2026-10-13):mod 坐骑段顶(66+N;registerModMountData 时递增)——
 *  setMount 门消费;原版域 0-65 零扰动 */
let _mountCountMax = MOUNT_COUNT;
export function mountCountMax(): number { return _mountCountMax; }
export function bumpMountCountMax(id: number): void {
  if (id >= _mountCountMax) _mountCountMax = id + 1;
}
/** ★D11(2026-10-14):mount countMax 顶重置(热重载 teardown;重装载时 bump 回来) */
export function resetMountCountMax(): void { _mountCountMax = MOUNT_COUNT; }
/** id → 内部名（MountID.cs const 表） */
export const MOUNT_NAMES: Record<string, string> = mountJson.names;
/** MountID.Sets 能力位（CreateBoolSet/CreateIntSet 展开） */
export const MOUNT_SETS: Record<string, boolean[]> = mountJson.sets;
/** 召唤物品 id → 坐骑 id（Item.cs SetDefaults `mountType = N` / DefaultToMinecart） */
export const ITEM_TO_MOUNT: Record<string, number> = mountJson.itemMount;
/** ★D11-M4(2026-10-14):mod 坐骑物品映射 teardown(热重载;键=vid 字串 ≥30000 段清) */
export function _resetModItemToMountForTests(): void {
  for (const k of Object.keys(ITEM_TO_MOUNT)) if (Number(k) >= 30000) delete ITEM_TO_MOUNT[k];
}
/** 坐骑 buff id → 坐骑 id（BuffID.Sets.MountType） */
export const BUFF_TO_MOUNT: Record<string, number> = mountJson.buffMount;
/** 主贴图可得性登记（terraria-assets 缺表的坐骑 → 色块近似渲染） */
export const MOUNT_TEXTURE_OK: Record<string, boolean> = mountJson.textureOk;

export const mountName = (id: number): string => MOUNT_NAMES[String(id)] ?? `Mount${id}`;
export const isCartMount = (id: number): boolean => !!MOUNT_SETS.Cart?.[id];

/** 贴图不可得坐骑的色块近似渲染色（按生物族群登记；其余默认棕） */
const MOUNT_FALLBACK_COLOR: Record<number, string> = {
  0: '#B03030', 1: '#E8E0D8', 2: '#C060C0', 3: '#4080FF', 4: '#406040', 5: '#E8B020',
  7: '#9098C0', 8: '#C0C8D0', 9: '#704030', 10: '#F0F0F0', 12: '#60A0E0', 14: '#C8B060',
  17: '#E0E0E0', 23: '#804020', 37: '#F090B0', 40: '#A06030', 41: '#D8D0C0', 42: '#403848',
  43: '#C05030', 44: '#805838', 45: '#705030', 46: '#38A848', 47: '#C04858', 48: '#5858C8',
  49: '#E05020', 50: '#6090FF', 52: '#A0A8B0', 54: '#C8A060', 55: '#909098', 56: '#584868',
  57: '#E8E8E8', 58: '#58C058', 59: '#F0F0F0', 60: '#F090C0', 61: '#F0D048', 62: '#68C8E8',
  63: '#F08040',
  // 1457 Trusty 族（64/1457 MountID.cs:162 / 65/:164）——与 62/63 同贴图（Extra_301/302）
  64: '#68C8E8', 65: '#F08040',
};
export const mountFallbackColor = (id: number): string => MOUNT_FALLBACK_COLOR[id] ?? '#8A6A4A';

/** ★BJ357 变身坐骑玩家盒覆写（MountData.delegations.PlayerSize → DelegateMethods.Mount.
 *  *PlayerSize,DelegateMethods.cs:166-189;挂点 Mount.cs:2371 Rat/:2426 Bat/:2489 Pixie）：
 *  SetMount :6309-6328 上坐即把 mountedPlayer.width/height 改写为该 size（底锚,x 重心
 *  对齐,无空间检查——盒只会变小恒可容）+ Player.ResizeHitbox :29447-29456 持保。
 *  1457 仅此三坐骑有委派（grep 全量）;其余坐骑零改盒。vanilla-mounts.json 未含该字段
 *  （提取器漏 DelegateMethods 委派面）→ 硬表登记,重产 json 前须反哺提取器。 */
export const MOUNT_PLAYER_SIZE: Record<number, [number, number]> = {
  55: [14, 14],   // RatPlayerSize（DelegateMethods.cs:186-189）
  56: [20, 18],   // BatPlayerSize（DelegateMethods.cs:166-169）
  61: [8, 14],    // PixiePlayerSize（DelegateMethods.cs:171-175）——附魔精灵尘 5662
};

/** ★BJ704-G13（G12 登记债2）：MountID.Sets.DontDismountWhenCCed（MountID.cs:29
 *  Factory.CreateBoolSet(55,56,61)）——CCed（frozen/webbed/stoned）中拒下坐的
 *  变身骑族（CanDismountWithResult :6686-6690 首闸,FailedCCed）。 */
const DONT_DISMOUNT_WHEN_CCED = new Set([55, 56, 61]);

/** 坐骑 buff 授予的 ignoreWater（Player.cs UpdateBuffs :9972-9999 MountType 支：
 *  131 海龟 / 168 猪鲨崽 / 279 海盗船 / 305 熔岩鲨（305 另授 lavaImmune+lavaVision+
 *  fireWalk）——只辖碰撞选档（:28398/:28402 DryCollision）与位移因子（num110
 *  :28309=1）;重力/maxFall/jumpSpeed 走液体档（G12 债3 湿门）。
 *  ★BJ704-G13（G12 登记债1 勘正）：265 火烈鸟【非】ignoreWater——:9982-9986 只授
 *  canFloatInWater+accFlipper（湿路由 WetCollision+liqFactor 0.5+TryFloatingInFluid
 *  液面漂,仓内 canFloatInWater 链既有承载）,旧表误含 265=干路由+免浮液,移出。 */
const BUFF_SWIM_FREE = new Set([131, 168, 279, 305]);
/** 授 accFlipper 的坐骑 buff（:9974-9998 ignoreWater 族四件并授 accFlipper ∪
 *  265 火烈鸟 :9982-9986——湿跳门 flag2=wet∧accFlipper :20795 消费：
 *  液中悬空泳跃（Player.flipperOn 的骑乘臂,BJ704-G13 债3）。
 *  注意 :13115 `wet∧ShouldFloatInWater → accFlipper` 只覆盖浮液面（!inputDown）,
 *  buff 授予无条件（按↓下潜仍有脚蹼）——故火烈鸟须入本表而非仅靠浮液臂。 */
const BUFF_FLIPPER = new Set([131, 168, 265, 279, 305]);

/** MountInstance 消费的玩家视图（结构性接口，避免与 Player 循环依赖） */
export interface MountedPlayerView {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  onGround: boolean;
  inWater: boolean;
  facing: number;
  inputX: number; inputJump: boolean; inputUp: boolean; inputDown: boolean;
  /** 上一 tick 是否按下跳跃（releaseJump 语义：松开后才可重触发飞行/起跳） */
  prevInputJump: boolean;
  /** 上一 tick 尾快照的跳跃键（Player.jumpEdgePrev——水中起跳 releaseJump :20409 等
   *  消费；prevInputJump 在 tick 头快照且输入已更新=恒等不可用）。
   *  可选：合成视图（单测桩）缺省 = 上一 tick 未按（边沿成立） */
  jumpEdgePrev?: boolean;
  /** ★BJ704-G15（G13 登记债④）上一 tick 尾快照的 ↑ 键电平（Player.upEdgePrev ≙
   *  原版 releaseUp——UpdateControlHolds :29319-29327 移动段后刷新,次拍 :26939
   *  tryStartHover 读 = ↑ 键上升沿配对位）。★与 jumpEdgePrev（Space∪Up 合成键）
   *  分立：原版 controlUp=W 独立键面（PlayerInput.cs:2072/2076 默认绑定 + TriggersSet
   *  CopyInto :786/:790 分立拷贝,Space 只入 Jump 不入 Up）——悬浮起飞边沿须读 ↑
   *  专属沿（持 Space 中按 W 亦触发=vanilla 语义,旧读合成跳键沿=漏触发）。
   *  缺省 false（合成视图旧义 = 边沿成立） */
  upEdgePrev?: boolean;
  /** 盾冲滑行态（Player.dashDelay：<0 = 滑行中；62-65 冲刺帧门 Mount.cs:4541-4545） */
  dashDelay?: number;
  /** ★BJ704-G13（债2）Player.CCed（:3361-3372 frozen∨webbed∨stoned;仓承载含
   *  shimmering=buff353 置 frozen 的等价腿）——canDismount 的 DontDismountWhenCCed
   *  {55,56,61} 豁免门（Mount.cs:6686）消费。缺省 false（合成视图旧义）。 */
  cced?: boolean;
  /** ★BJ704-G13（债4）Player.sliding（贴墙滑——仓承载位 wallCling）——UpdateFrame
   *  帧计数复位抑制的 55 臂 `state==2 && sliding`（Mount.cs:3633）消费。缺省 false。 */
  sliding?: boolean;
  /** ★BJ704-G13（债4）Player.dash 字段（仓镜像 dashLatched）——UpdateFrame 56 臂
   *  冲刺沿复位 `dash>0 ∧ dashDelay<0`（Mount.cs:3615）消费。缺省 0。 */
  dash?: number;
  /** ★BJ704-G5（G4-③）任意液体湿位（Collision.cs:1608 wet=水∪蜜∪岩浆∪微光）——
   *  帧态分派 :36485 `else if (wet)` 判据（熔岩鲨骑岩浆/蜜中帧态 4）。缺省回退
   *  inWater（合成视图旧义）。 */
  wet?: boolean;
  /** ★BJ704-G5（G4-③/R4-P2③）剩余跳预算（原版 jump 字段）——分派飞行帧门
   *  :36446 `jump == 0`（起跳上升段误选扇翼帧=54 装翼新达面）。缺省 0=门开（旧义）。 */
  jumpHold?: number;
  /** ★BJ704-G5（G4-②）当拍重力场（Player.gravity 字段等价 :24884 终值）——Hover
   *  疲劳率 num2=gravity/defaultGravity（:3378-3386）/非飞行帧臂 :3502/tryStartHover
   *  起飞冲量 :26941 消费。缺省 DEFAULT_GRAVITY。 */
  gravityField?: number;
  /** ★BJ704-G13（债5）无符号新鲜重力场——原版 :26941 读【当拍 Update 头 :24559-:24884
   *  链值】（每拍从头重算,不掺 :27228/:27232 慢Fall 尾部签名改写）;仓内等价=干/湿支
   *  终值并行快照（Player.gFieldUnsigned）,tryStartHover 跨拍读此通道。缺省回退
   *  gravityField（合成视图旧义）。 */
  gravityFieldFresh?: number;
  /** ★BJ704-G5（G4-②）slowFall 并集（Hover num2 ÷3 档 :3379-3381）。缺省 false。 */
  slowFall?: boolean;
  /** ★BJ703-D1 Player.wingTimeMax 等价（GetWingStats().FlyTime :15568——装备功能翼的
   *  最大飞行时量,无翼 0）。坐骑 54 resetFlightTime/updateAfterEquips 消费;
   *  合成视图缺省 = 0（无翼）。 */
  wingTimeMax?: number;
  /** ★BJ703-D1 grappling[0] >= 0（钩爪挂中）——迅猛龙帧态门存活性（见 updateFrame
   *  case 54 注;54 在 MountID.Sets.CanUseHooks 表内=骑乘可挂钩）。缺省 false。 */
  grapplingHooked?: boolean;
  gravDir: number;
  /** 缓存世界（fixedUpdate 每帧刷新；Hover/TryBeginningFlight 的 tile 探针用） */
  store: {
    inBounds(tx: number, ty: number): boolean;
    idx(tx: number, ty: number): number;
    flags: Uint8Array | number[];
    isSolid(tx: number, ty: number): boolean;
  } | null;
}

/** ★BJ704-G18（G17 登记债2/3）：DoSpawnDust/DoFailedDismountDust 的 game 视图——
 *  spawnDust = typed 尘直入（Dust.NewDust 同构,返回入池尘供原版式后置字段覆写）;
 *  cloneDust = 52/62-65 特殊支的 1/3 白化克隆回声（Dust.CloneDust）;缺席环境
 *  （测试桩）回退 spawnParticles 程序化圆近似（SantankShellProj.explode 的
 *  pool-else-fallback 同款惯例）。GameHooks/Game 结构性满足本视图。 */
export interface MountDustGame {
  spawnDust?(x: number, y: number, w: number, h: number, type: number,
    speedX?: number, speedY?: number, alpha?: number,
    color?: { r: number; g: number; b: number; a: number } | null, scale?: number,
    noGravity?: boolean): import('../fx/VanillaDust').VDust | null;
  cloneDust?(d: import('../fx/VanillaDust').VDust): import('../fx/VanillaDust').VDust | null;
  spawnParticles?(x: number, y: number, color: string, n: number, spd?: number): void;
  /** 62-65 上骑叫（SetMount :6349-6352 PalChillet）——setMount 既有消费面并入本视图 */
  playSfxFiles?(files: string[], vol?: number, x?: number, y?: number): void;
}

/** 帧状态（Mount.cs FrameStanding..FrameDashing 常量） */
export const FRAME_STANDING = 0;
export const FRAME_RUNNING = 1;
export const FRAME_IN_AIR = 2;
export const FRAME_FLYING = 3;
export const FRAME_SWIMMING = 4;
export const FRAME_DASHING = 5;

const DEFAULT_GRAVITY = 0.4;

// ============================================================================
// 滚轴鞋（MountID.Sets.IsRollerSkates = {57,58,59,60}，MountID.cs:19）
// ============================================================================

/** Player.originalRunSpeed（Player.cs:2491 = 3f）——空中门 flag2 的收敛上限 */
export const ORIGINAL_RUN_SPEED = 3;
/** MovementStatsAreAdditive 坐骑集（Mount.cs SetAsRollerSkate :2580 全四坐骑置真；
 *  全表唯一 additive 族——Player.cs:26836-26853 走 `+=` 叠加支而非赋值/取大）。 */
const ROLLER_SKATE_IDS = new Set([57, 58, 59, 60]);

/** Player.RollerSkateMovement 的无输入阻尼带 + runSlowdown 尾钳（1458
 *  Player.cs:28736-28778；1456 :28037-28062 的两处变更按 1457 终值落地：
 *  · 减速带 num2 = accRunSpeed − 1f（:28743——随装备/难度缩放,旧字面 6.5f 已废）；
 *  · 空中门 flag2 = vy==0 || |vx| ≤ originalRunSpeed(3f)（:28752——空中不再向巡航速
 *    收敛,只在地面或低速段滑行衰减）。
 *  调用时序：骑乘 stats 叠加/覆盖之后、地面材质链与 HorizontalMovement 摩擦之前——
 *  尾钳 runSlowdown 由 HM 无输入摩擦照常消费（vanilla 两链叠加语义不变）。
 *
 *  参数:
 *   vx/vy            本 tick 开始时玩家速度；
 *   inputZero        controlLeft−controlRight==0（本仓 inputX===0）；
 *   grappling        grappling[0]>=0——抓钩中整段阻尼跳过（:28738-28739）；
 *   accRun/maxRun    已含坐骑叠加上限与本 tick 减速 debuff 后的最终值；
 *   runSlow          地面材质链乘区后的 friction 备选值（clamp 上界）；
 *   glideCap         巡航挡 num6 = max(1.5, 16/(num3×tileSpeed))（:28747-28751——
 *                    手持可放置物时以其 useTime 缩放；未建模物品面恒用基准 10 → 1.6，
 *                    登记于调用侧）；
 *   powerrun         沥青跑道位（:28767-28772 maxRunSpeed×2.25/runSlowdown×1.6——
 *                    与场地链 ×3.5/×2 是两条独立乘区，按 vanilla 时序先后叠加）。
 *  返回: dampedVx 仅在 (inputZero&&!grappling) 且带内改写时给出；runSlow 为本 tick
 *        生效的减速带值（HM 摩擦步长），恒返回。 */
export interface RollerSkateStepResult {
  dampedVx?: number;
  runSlow: number;
}
export function mountRollerSkateStep(
  vx: number, vy: number, inputZero: boolean, grappling: boolean,
  accRun: number, maxRunIn: number, runSlowIn: number,
  glideCap: number, powerrun: boolean,
): RollerSkateStepResult {
  let mr = maxRunIn;
  let slow = runSlowIn;
  if (powerrun) {                     // :28767-28772
    mr *= 2.25;
    slow *= 1.6;
  }
  let outVx = vx;
  if (inputZero && !grappling) {      // :28739（flag = 未挂抓钩才进阻尼带）
    const amount = 0.3;               // :28741
    const minSpeed = 1.5;             // :28742（num）
    const bandTop = accRun - 1;       // :28743 ★1457 终值（accRunSpeed−1f）
    const airGate = vy === 0 || Math.abs(vx) <= ORIGINAL_RUN_SPEED; // :28752 ★1457
    const dampBand = Math.abs(vx) < bandTop && airGate;
    if (Math.abs(vx) < minSpeed) {
      // 低速收尾 lerp→0（:28753-28759）
      outVx += (0 - vx) * amount;
      if (Math.abs(outVx) < 0.03) outVx = 0;
    } else if (dampBand) {
      // 减速带：lerp 向 ±巡航挡（:28761-28764）
      const target = Math.sign(vx) * glideCap;
      outVx += (target - vx) * amount;
    }
  }
  const runSlow = clamp01band(Math.abs(outVx) - Math.max(mr, accRun), 0, slow); // :28774 Utils.Clamp
  return inputZero && !grappling ? { dampedVx: outVx, runSlow } : { runSlow };
}

/** Utils.Clamp(float,float,float) 直译（负差位返回下界） */
function clamp01band(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ============================================================================
// 钻头坐骑（mount 8 Drill Mounted Containment）常量（Mount.cs :303-319）
// ============================================================================

/** :313 drillPickPower——PickTile/PickWall 的镐力 */
export const DRILL_PICK_POWER = 210;
/** :315 drillPickTime——每束命中后再装填 tick（beam.cooldown 初值，1 = 每帧可再射） */
export const DRILL_PICK_TIME = 1;
/** :317 amountOfBeamsAtOnce——同 tick 最多齐射的光束数 */
export const DRILL_BEAMS = 2;
/** :319 maxDrillLength——光束延伸 = min(鼠标距,224)+32（块）/ 再 +16（墙） */
export const DRILL_MAX_LENGTH = 224;
/** DrillSmartCursor_Blocks 的 PlotTileLine 带宽（:3164 65.6 ≈ 4 格扫掠带） */
export const DRILL_BLOCK_BAND = 65.6;
/** DrillSmartCursor_Walls 的带宽（:3197 97.6）与额外 16px 延伸（:3192） */
export const DRILL_WALL_BAND = 97.6;
export const DRILL_WALL_EXTRA = 16;
/** :303/:305 二极管发射点（相对坐骑贴图原点，随 diodeRotation 旋转；Draw :6032） */
export const DRILL_DIODE_1 = { x: 36, y: -6 };
export const DRILL_DIODE_2 = { x: 36, y: 8 };
/** :1308 drillTextureSize（80×80，ClampToDeadZone 死区半径） */
export const DRILL_TEXTURE_SIZE = { x: 80, y: 80 };

// ============================================================================
// Scutlix Gunner（mount 9）常量（Mount.cs :297-303/:1374-1397）
// ============================================================================

/** :301 scutlixBaseDamage——两束眼激光的单发伤害（UseAbility :3247 damage3 = 150） */
export const SCUTLIX_SHOT_DAMAGE = 150;
/** :1374-1383 scutlixEyePositions 原表（:1395 已统一减贴图中心 45,54 → 原点=坐骑锚点） */
export const SCUTLIX_EYE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [60 - 45, 2 - 54], [70 - 45, 6 - 54], [68 - 45, 6 - 54], [76 - 45, 12 - 54], [80 - 45, 10 - 54],
  [84 - 45, 18 - 54], [74 - 45, 20 - 54], [76 - 45, 24 - 54], [70 - 45, 34 - 54], [76 - 45, 34 - 54],
];
/** :1397 scutlixTextureSize（45,54）——ClampToDeadZone 死区半径 */
export const SCUTLIX_TEXTURE_SIZE = { x: 45, y: 54 };
/** UpdateEffects :4885/:4886——索敌半径 num3=850 / 上限 num2=1500 */
export const SCUTLIX_SEEK_RANGE = 850;
export const SCUTLIX_SEEK_MAX = 1500;
/** 眼部瞄准帧区间（AimAbility :5384-5399：frameExtra 6..10 对应 ±112.5° 分档） */
export const SCUTLIX_EYE_FRAME_MIN = 6;
export const SCUTLIX_EYE_FRAME_MAX = 10;

/** 猪鲨崽（mount 12）MountFishronSpecial 计数器档位（Mount.cs UpdateEffects :4998/:5003） */
export const FISHRON_COUNTER_LOW_HP = 60;
export const FISHRON_COUNTER_WET = 420;
/** Mount.Draw case 12 drawType 0（:5780-5787）背层液色渐变的计数器满格值：
 *  num8 = clamp(MountFishronSpecialCounter/60, 0, 1)——离水/离雨后 60t 内渐隐 */
export const FISHRON_WASH_TICKS = 60;

/** 背层液色渐变因子（Mount.Draw case 12 :5780-5787）：
 *  `color = CurrentLiquidColor(透明则 White); color.A = 127; color *= num8`——
 *  渲染层以本因子同时乘 RGB 与 alpha（等价 `color *= num8` 的整色缩放） */
export function fishronWashFactor(counter: number): number {
  return Math.max(0, Math.min(1, counter / FISHRON_WASH_TICKS));
}

/** updateMountEffects 的每 tick 上下文（Player 侧组装：敌怪盒/视线/天气/发射桶） */
export interface MountEffectsCtx {
  /** Scutlix/Santank 索敌候选（已按 NPC.CanBeChasedBy 口径过滤的敌怪命中盒） */
  scutlixTargets: ScutlixTarget[];
  /** Collision.CanHitLine（Mount.cs :4922 视线门） */
  los(cx: number, cy: number, t: ScutlixTarget): boolean;
  /** 眼激光发射（UseAbility case 9：弹型 606/伤 150/速 14） */
  fireScutlixShot?(x: number, y: number, vx: number, vy: number): void;
  /** Santank 开火（UseAbility case 46：'cannon' = 弹 930 伤 120 上抛 / 'bullet' = 弹 14 伤 100） */
  fireSantankShot?(kind: 'cannon' | 'bullet', x: number, y: number, vx: number, vy: number): void;
  /** 冲刺尘（UpdateFrame case 10/47 :3855-3873：14 粒环向尘——原版为 176/177/179（独角兽）
   *  或 6（山羊）dust + shader 着色；本仓以原版 dust 池/程序粒子近似） */
  dashDust?(x: number, y: number, n: number, spreadPx: number, type: 6 | 176 | 177 | 179): void;
  /** 独角兽追尾尘（UpdateFrame case 10 :3924-3932）：dashing 每 tick 玩家盒内
   *  1 粒 d176/177/179——velocity=0、noGravity、scale 0.5+r×0.8、fadeIn 1+r×2。
   *  与 dashBurst 的环形爆发独立两条链 */
  dashDustBody?(type: 6 | 176 | 177 | 179): void;
  /** 山羊火焰粒子（:3888-3896 ParticleOrchestrator.WallOfFleshGoatMountFlames，
   *  Spawn_WallOfFleshGoatMountFlames ParticleOrchestrator.cs:3259-3306——地面冲刺
   *  且落脚格 SolidTileAllowBottomSlope+无液时）。入参 = PositionInWorld
   *  (tx×16+8, ty×16+16)；编排器模式 = 3 束 FlameParticle（x 偏移 ±5.33px）+
   *  每束 1/8 概率 dust 6（alpha100、velocity×0.6 后 vy-1.2、y-4、noLight）
   *  ——FlameParticle 层已由 src/fx/FlameParticles.ts 实装（TTL50/收缩/淡出
   *  0.3/canvas 预乘两 pass），dust 段原样；消费方 = Player.ts goatFlames 回调 */
  goatFlames?(x: number, y: number): void;
  /** ★SW-FX18 高尔夫球车轮尘（UpdateFrame_GolfCart :4661-4662 → EmitGolfCartWheelDust
   *  :4710-4742）：每轮位 1/5 掷（:4712 Next(5)!=0 早退）命中后回调。入参 =
   *  轮位世界坐标（Bottom ± 20px，Bottom.X=Center.X Entity.cs:122-128）与踢向
   *  = −direction（:4727 向量 (−direction, −gravDir)）；实心地面门（:4720）与
   *  KillTile_MakeTileDust 发粒面在消费侧（mapColor 粒子制,同 breakTile 登记口径） */
  wheelDust?(x: number, y: number, kickDir: number): void;
  /** 每 tick 视效钟（Main.timeForVisualEffects 的本仓对应,拖尾尘偶数拍门用） */
  miscCounter?: number;
  /** ★BJ357 仙灵武库 61 拖尾辉尘（Mount.cs UpdateEffects case 61 :5203-5224）——
   *  掷门/色算/速度式在 Mounts.updateMountEffects,此处承接落池：
   *  NewDustDirect(Center,0,0,278,0,0,α200,color,0.65) 后 position/velocity/noGravity/
   *  noLight 字段覆写。入参 x/y = 终位、mul = 出尘抖动速度乘数（flag?0.4:0.04×|v|）、
   *  pvx/pvy = 玩家速度（velocity += v×0.3） */
  pixieTrailDust?(args: {
    x: number; y: number; mul: number; pvx: number; pvy: number;
    color: { r: number; g: number; b: number; a: number };
  }): void;
  /** ★BJ707-G31（G29 登记债②清偿）:cMount 尘发射面落池通道——海盗船 44（尘 228
   *  环爆发+steady 两面,Mount.cs :3961-4007）/惊魂木 45（d6 环+d6/d31 steady,
   *  :4022-4071）/扫帚 23（星尘 43 spark+swirl,UpdateEffects :4870-4915）/蜥蜴 14
   *  （d31×2 底盒+蓄能 d6 环,:4129-4169）的发射几何在本模块 updateMountEffects
   *  （沿闩/速度门旗由 updateFrame 写）,经本 typed 尘池 NewDust 同构入池（后置
   *  字段调用侧覆写）。缺席（测试桩）=该四族尘面静默跳过（goatFlames 同惯例） */
  vanillaDust?: import('../fx/VanillaDust').VanillaDust;
  /** cMount 染料 vid 单源（Player.mountDyeVid=miscDyes[3] 直读零掷——G29 通道,
   *  勿重建）;缺省 -1（=GetSecondaryShader(0)=null 零漂移,ArmorShaderDataSet.cs:63-70） */
  mountDyeVid?(): number;
  /** 扫帚挂件风摆（Main.WindForVisuals=windSpeedCurrent;GetWitchBroomTrinketRotation
   *  :3591-3604——与 mountLights case 23 同式共享）;缺省 0=无风 */
  wind?: number;
  /** 扫帚挂件露天档（Player.mountWindExposed=InAPlaceWithWind 中心格）;缺省室内档 */
  windExposed?: boolean;
  /** 蜥蜴 14 面 1 的 cMount==0 地板尘（:4140-4148 position ±num2×24 移位
   *  FloorVisuals(Falling:true)——MakeFloorDust 落地 20 连发面）;入参 = X 移位量
   *  （num2×24,num2=sign(vx)）;Player 闭包承载移位+makeFloorDust */
  basiliskFloorDust?(shiftX: number): void;
  fishron: FishronView;
}

/** fishronSpecial/updateFishron 的玩家视图 */
export interface FishronView {
  hp: number; maxHp: number;
  /** Player.wet（水）——岩浆/蜂蜜湿另有标记，湿水才触发 */
  inWater: boolean; inLava: boolean; inHoney: boolean;
  /** Player.dripping（buff 103 Wet 激活——UpdateBuffs :11342 置位）。与 wet 是两个
   *  量：湿身在 MountFishronSpecial 与 420t 计数器两处都生效，dripping 只进
   *  增益判定（:3886）不设计数器（Mount.cs :4996-5003 计数器仅 wet|雨天） */
  dripping: boolean;
  /** Main.raining */
  raining: boolean;
  /** WorldGen.InAPlaceWithWind（露天迎风：地表以上、无液体、无挡风墙） */
  windExposed: boolean;
}

/** WallID.Sets.AllowsWind（WallID.cs:54）= wall 0（无墙）+ 围栏族 12 型；
 *  InAPlaceWithWind 的挡风墙白名单——白名单外墙体即挡风（cs:88158） */
const WALL_ALLOWS_WIND: ReadonlySet<number>
  = new Set([0, 150, 138, 145, 107, 152, 140, 139, 141, 106, 245, 315, 317]);

/** WorldGen.InAPlaceWithWind int 重载（WorldGen.cs:88141-88163）1:1：tile 坐标域，
 *  width/height = 格数（TileDrawing.cs:4562-4564 有同名私有二次封装供贴图风门消费）。
 *  ① DoesWindBlowAtThisHeight（:88131-88139）= tileY < worldSurface，remixWorld 取反；
 *  ② (x..x+width-1, y..y+height-1) 逐格：!InWorld 跳过；liquid > 0 → false；
 *     wall > 0 且 !WallID.Sets.AllowsWind[wall] → false（cs:88158-88159）。
 *  remix 参缺省 false = 既有调用方零回归（remix 世界由调用侧传入接通翻转）。
 *  单源消费位：TileDrawing 贴图风门（489 风铃 2×3/:4802、490 风向标 2×2/:4817、
 *  493 旗 1×1/:5312——VanillaTiler 收敛）、Player 扫帚挂件/鱼龙风位、
 *  Enemy 624 侏儒石化（NPC.cs:56421）、LeashedKite 风场（LeashedKite.cs:149）、
 *  Mount.cs:3597 扫帚挂件中心格 */
export function inAPlaceWithWindTiles(
  st: Pick<DrillStore, 'inBounds' | 'idx' | 'wall'> & { liquid?: ArrayLike<number> },
  x: number, y: number, w: number, h: number, worldSurface: number,
  remix = false,
): boolean {
  // DoesWindBlowAtThisHeight：tileY < worldSurface（remixWorld 取反,cs:88132-88138）
  if ((y < worldSurface) === remix) return false;
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      if (!st.inBounds(x + i, y + j)) continue;   // 越界格原版 InWorld 门外跳过
      const k = st.idx(x + i, y + j);
      if ((st.liquid?.[k] ?? 0) > 0) return false;   // tile.liquid > 0（cs:88158）
      if (st.wall[k] !== 0 && !WALL_ALLOWS_WIND.has(st.wall[k])) return false;
    }
  }
  return true;
}

/** WorldGen.InAPlaceWithWind Vector2 重载（WorldGen.cs:88124-88129）：position/
 *  width/height 像素域——两角 ToTileCoordinates（截断）得闭区间后转调 int 重载
 *  （width = 1 + point2.X - point.X,cs:88128）。NPC/Player/Mount/LeashedKite 四处
 *  调用全部取本形态（position, width, height） */
export function inAPlaceWithWind(
  st: Pick<DrillStore, 'inBounds' | 'idx' | 'wall'> & { liquid?: ArrayLike<number> },
  x: number, y: number, w: number, h: number, worldSurface: number,
  remix = false,
): boolean {
  const x0 = Math.floor(x / 16), y0 = Math.floor(y / 16);
  const x1 = Math.floor((x + w) / 16), y1 = Math.floor((y + h) / 16);
  return inAPlaceWithWindTiles(st, x0, y0, 1 + x1 - x0, 1 + y1 - y0, worldSurface, remix);
}

/** 激光弹型（ProjectileID.ScutlixEye = 606；UseAbility :3227 type2） */
export const SCUTLIX_PROJ_ID = 606;

/** Utils.PlotLine（Utils.cs:2327）1:1：谓词返回 false 即中断并返回 false。
 *  主循环 `for (i = x0; i != x1; i += step)` 不含终点格——原版同款语义，勿改。 */
function plotLine(x0: number, y0: number, x1: number, y1: number,
  plot: (x: number, y: number) => boolean, jump: boolean): boolean {
  if (x0 === x1 && y0 === y1) return plot(x0, y0);
  const flag = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  if (flag) { const t = x0; x0 = y0; y0 = t; const t2 = x1; x1 = y1; y1 = t2; }
  const num = Math.abs(x1 - x0);
  const num2 = Math.abs(y1 - y0);
  let num3 = Math.trunc(num / 2);
  let num4 = y0;
  const num5 = x0 < x1 ? 1 : -1;
  const num6 = y0 < y1 ? 1 : -1;
  for (let i = x0; i !== x1; i += num5) {
    if (!plot(flag ? num4 : i, flag ? i : num4)) return false;
    num3 -= num2;
    if (num3 >= 0) continue;
    num4 += num6;
    if (!jump && !plot(flag ? num4 : i, flag ? i : num4)) return false;
    num3 += num;
  }
  return true;
}

/** Utils.PlotTileLine（Utils.cs:2428）1:1：主轴逐格步进，每步扫一条垂直带（jump=false）。
 *  start/end 为世界像素坐标；带宽 width 换算成法向半宽后取整格偏移。 */
function plotTileLineBand(startX: number, startY: number, endX: number, endY: number,
  width: number, plot: (x: number, y: number) => boolean): boolean {
  const half = width / 2;
  let dx = endX - startX, dy = endY - startY;
  const len = Math.hypot(dx, dy);
  if (len > 0) { dx /= len; dy /= len; }
  // 法向 × 半宽（Vector2D(-dir.Y, dir.X) * num）
  const nx = -dy * half, ny = dx * half;
  const toTile = (v: number) => Math.trunc(v / 16);
  const baseX = toTile(startX), baseY = toTile(startY);
  const offMinX = toTile(startX - nx) - baseX, offMinY = toTile(startY - ny) - baseY;
  const offMaxX = toTile(startX + nx) - baseX, offMaxY = toTile(startY + ny) - baseY;
  return plotLine(baseX, baseY, toTile(endX), toTile(endY), (x, y) =>
    plotLine(x + offMinX, y + offMinY, x + offMaxX, y + offMaxY, plot, false), true);
}

/** 钻头光束判定的世界视图（TileStore 结构子集） */
export interface DrillStore {
  w: number; h: number;
  type: ArrayLike<number>;
  wall: ArrayLike<number>;
  /** framed 帧位（树干分支/棕榈承载豁免判定用；缺省按 0 处理） */
  frameX?: ArrayLike<number>;
  frameY?: ArrayLike<number>;
  /** SW-L1 2026-09-03 F10：裸 active 位（bit0;TileStore.flags 同布局）——
   *  CanKillTile 用 tile.active() 不含致动位。缺省回落 isActive（测试桩兼容） */
  flags?: ArrayLike<number>;
  inBounds(x: number, y: number): boolean;
  idx(x: number, y: number): number;
  isActive(x: number, y: number): boolean;
}

/** 单束激光状态（Mount.cs DrillBeam :20-27） */
export interface DrillBeam {
  /** curTileTarget（-1,-1 = 空闲） */
  tx: number; ty: number;
  cooldown: number;
  /** lastPurpose：0 = 挖块 / 1 = 拆墙 */
  purpose: number;
}

/** useDrill 的实效回调（Game 侧接线：HitTile 挖掘管线 / 粒子 / 坡面平滑） */
export interface DrillHooks {
  /** controlUseItem（左键按住） */
  useItem: boolean;
  /** controlUseTile（右键按住） */
  useTile: boolean;
  /** Player.PickTile（:52839：镐力 210 走 HitTile 积累） */
  pickTile?(tx: number, ty: number): void;
  /** Player.PickWall（:45328：墙 HitTile type-2 积累 ≥100 即毁） */
  pickWall?(tx: number, ty: number): void;
  /** 命中尘（:3072-3080/:3131-3137）：dust 230，两粒，方向 = 目标→玩家中心的
   *  朝向角 ±90°（垂直喷溅），速度 2-4，noGravity。rot = 该基础朝向角 */
  dust?(x: number, y: number, n: number, rot: number): void;
  /** Tile.SmoothSlope（:3083：命中后 applyToNeighbors 平滑，见 smoothSlopeAt） */
  smoothSlope?(tx: number, ty: number): void;
  /** CanKillTile 追加子项上下文（锁门/巨石承载/传送器 235/容器内容）——
   *  缺省 = 最宽近似（无锁门与宝箱表保护） */
  killTileCtx?: KillTileCtx;
}

/** 运行期坡面平滑的世界视图（TileStore 结构子集：可写 half/slope） */
export interface SlopeStore extends DrillStore {
  half: ArrayLike<number>;
  slope: ArrayLike<number>;
  setHalfBrick(x: number, y: number, on: boolean): void;
  setSlope(x: number, y: number, s: number): void;
}

/** 运行期 WorldGen.CanPoundTile（WorldGen.cs:81434-81482）子集：类型黑名单 +
 *  Boulders + 上格 ForbidsSloping + CanKillTile（:81480）。生成期专属的 190/30
 *  追加（isGeneratingOrLoadingWorld 门）运行期不适用；solid/solidTop 门由
 *  smoothSlopeAt 的 SolidOrSlopedTile 承担（原版 SmoothSlope :832 同序）。
 *  SW-R3 2026-09-03（蓝队 L-2）：①删自格 active 门——原版 CanPoundTile
 *  （:81972-82020）无自格 active 检查（仅 null 守卫+类型 switch,存活性与
 *  CanKillTile :62729 裸 active 收口一致）;②上格 :82014 `tile.active()` 裸位。
 *  曾用 isActive(nactive)=自格误拦已致动格 */
function canPoundTileAt(st: SlopeStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const t = st.type[st.idx(x, y)];
  if (POUND_BLACKLIST_IDS.has(t) || BOULDER_IDS.has(t)) return false;
  if (st.inBounds(x, y - 1)) {
    const up = st.idx(x, y - 1);
    if (tileActiveBare(st, x, y - 1) && FORBIDS_SLOPING_IDS.has(st.type[up])) return false;
  }
  return canKillTileAt(st, x, y);
}

/** 运行期 WorldGen.SolidOrSlopedTile（:70046）：active && tileSolid && !tileSolidTop
 *  ——tileSolid 走运行期 TILE_DEFS.solid 表（区别于生成期 GenSolid 翻转表）。
 *  SW-R3 2026-09-03（蓝队 L-2）：原版 :70515-70519 `tile.active()` 裸位（不含
 *  致动位）→ 改 tileActiveBare;曾用 isActive(nactive) 误判已致动格非实心 */
function solidOrSlopedTileAt(st: SlopeStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y) || !tileActiveBare(st, x, y)) return false;
  const d = TILE_DEFS[st.type[st.idx(x, y)]];
  return !!d && d.solid && !d.platform;
}

/** Tile.SmoothSlope（Tile.cs:822-895）1:1（applyToNeighbors=true，sync 段联机略）：
 *  先对四邻（右/左/下/上 序）做单格平滑，再平滑自身；按四邻实心位形推导
 *  整砖/半砖/坡面 1-4（num 位序：上<<3 下<<2 左<<1 右） */
export function smoothSlopeAt(st: SlopeStore, x: number, y: number): void {
  smoothSlopeOne(st, x + 1, y);
  smoothSlopeOne(st, x - 1, y);
  smoothSlopeOne(st, x, y + 1);
  smoothSlopeOne(st, x, y - 1);
  smoothSlopeOne(st, x, y);
}

function smoothSlopeOne(st: SlopeStore, x: number, y: number): void {
  if (!st.inBounds(x, y)) return;
  if (!canPoundTileAt(st, x, y) || !solidOrSlopedTileAt(st, x, y)) return;
  const flag = st.inBounds(x, y - 1) && st.isActive(x, y - 1);               // 上方有物（!TileEmpty）
  const flag2 = !solidOrSlopedTileAt(st, x, y - 1) && flag;                  // 上方非实心
  const flag3 = solidOrSlopedTileAt(st, x, y + 1);                           // 下方实心
  const flag4 = solidOrSlopedTileAt(st, x - 1, y);                           // 左实心
  const flag5 = solidOrSlopedTileAt(st, x + 1, y);                           // 右实心
  const num = ((flag ? 1 : 0) << 3) | ((flag3 ? 1 : 0) << 2) | ((flag4 ? 1 : 0) << 1) | (flag5 ? 1 : 0);
  switch (num) {
    case 10: if (!flag2) { st.setHalfBrick(x, y, false); st.setSlope(x, y, 3); } break;
    case 9:  if (!flag2) { st.setHalfBrick(x, y, false); st.setSlope(x, y, 4); } break;
    case 6:  st.setHalfBrick(x, y, false); st.setSlope(x, y, 1); break;
    case 5:  st.setHalfBrick(x, y, false); st.setSlope(x, y, 2); break;
    case 4:  st.setSlope(x, y, 0); st.setHalfBrick(x, y, true); break;
    default: st.setHalfBrick(x, y, false); st.setSlope(x, y, 0); break;
  }
}

export const drillBeamIdle = (): DrillBeam => ({ tx: -1, ty: -1, cooldown: 0, purpose: 0 });

/** WorldGen.SolidTile 系列的最小世界视图（MountedPlayerView.store 结构化超集——
 *  声明类型只有 inBounds/idx/flags/isSolid，type/half/slope/frameX 经结构化 cast
 *  读取，缺省字段按 0 处理） */
export interface SolidTileView {
  inBounds(x: number, y: number): boolean;
  idx(x: number, y: number): number;
  flags: ArrayLike<number>;
  type: ArrayLike<number>;
  isSolid(x: number, y: number): boolean;
  half?: ArrayLike<number>;
  slope?: ArrayLike<number>;
  frameX?: ArrayLike<number>;
}

/** WorldGen.SolidTile(int,int)（WorldGen.cs:70155-70176）1:1：
 *  active && tileSolid && !tileSolidTop(平台) && !halfBrick && slope==0 && !inActive
 *  ——半砖/坡面/平台都【不算】实心（猪鲨崽点光落点门 Mount.cs:4984 消费）。
 *  store.isSolid 已含 solid+致动双查，此处复用作 active/solid/inActive 门，
 *  再补 platform/half/slope 三项排除 */
export function solidTileAt(st: SolidTileView, x: number, y: number): boolean {
  if (!st.inBounds(x, y) || !st.flags[st.idx(x, y)]) return false;   // 越界 / !active
  if (!st.isSolid(x, y)) return false;                               // !inActive（含 solid 复查）
  const i = st.idx(x, y);
  const d = TILE_DEFS[st.type[i]];
  if (!d || d.platform) return false;                                // !tileSolidTop
  if ((st.half?.[i] ?? 0) !== 0) return false;                       // !halfBrick
  if ((st.slope?.[i] ?? 0) !== 0) return false;                      // slope() == 0
  return true;
}

/** WorldGen.SolidTileAllowBottomSlope(int,int)（WorldGen.cs:70172-70194）1:1：
 *  active && (tileSolid || tileSolidTop) && (!topSlope || 平台且帧合法)
 *  && !halfBrick && !inActive——平台/顶坡放行（山羊火焰落脚门 Mount.cs:3893 消费）。
 *  ★InWorld 门外返回 true（原版怪癖，照抄） */
export function solidTileAllowBottomSlopeAt(st: SolidTileView, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return true;                               // :70177-70180 InWorld 门外 true
  const i = st.idx(x, y);
  if (!st.flags[i]) return false;                                    // !active
  const d = TILE_DEFS[st.type[i]];
  if (!d || !(d.solid || d.platform)) return false;                  // tileSolid || tileSolidTop
  if (!st.isSolid(x, y)) return false;                               // !inActive
  if ((st.half?.[i] ?? 0) !== 0) return false;                       // !halfBrick
  const slope = st.slope?.[i] ?? 0;
  const topSlope = slope === 1 || slope === 2;                       // Tile.topSlope()（Tile.cs:320-328）
  if (topSlope && !(d.platform && platformProperTopFrame(st.frameX?.[i] ?? 0))) return false;
  return true;
}

/** WorldGen.PlatformProperTopFrame（WorldGen.cs:70197-70209）：列号 =
 *  frameX/PlatformFrameWidth()，合法 = 0-7 / 12-16 / 25-26。★除数是 18 非 16
 *  （PlatformFrameWidth = _data[19].CoordinateFullWidth = (16+2)×1，Tiles_19.png
 *  486px=27 帧×18px 实证——同 world/gen/vanilla/GemPasses.ts 同名实现） */
function platformProperTopFrame(frameX: number): boolean {
  const n = Math.trunc(frameX / 18);
  return (n >= 0 && n <= 7) || (n >= 12 && n <= 16) || (n >= 25 && n <= 26);
}

/** CanKillTile 追加子项（WorldGen.cs:62316-62358）的运行期上下文。
 *  由钻头智能光标链（Game.updateDrillMountUse → useDrill → drillBlockTarget）注入；
 *  缺省 undefined 时按最宽近似：无宝箱表（容器恒可毁）+ 非困难模式。
 *  ★坡面平滑链（canPoundTileAt → canKillTileAt）不传 ctx——四处子项全部要求
 *  目标本体是非实心件（锁门 10/容器 21·467·88/传送器 235）或巨石，而前两者在
 *  CanPoundTile 内已被 POUND_BLACKLIST/BOULDER_IDS 拦截、后者过不了
 *  solidOrSlopedTile 的 solid 门——子项在砸坡路径上不可达，等价 */
export interface KillTileCtx {
  /** Main.hardMode——祭坛 77 的 CheckTileBreakability 门（WorldGen.cs:62494） */
  hardMode: boolean;
  /** Chest.CanDestroyChest（Chest.cs:590-606）：锚格有宝箱且含非空物品 → false */
  chestDestroyable(x: number, y: number): boolean;
}

/** WorldGen.IsLockedDoor（WorldGen.cs:69248-69255）：关门表 10 且 frameY∈[594,646]
 *  （神庙锁门段）且 frameX<54（关闭态）。与 world/Door.ts isLockedDoor 同源 1:1
 *  （此处保持自包含，避免共享文件耦合；两处锚同一行号） */
function isLockedDoorAt(st: DrillStore, x: number, y: number): boolean {
  const i = st.idx(x, y);
  return DOOR_CLOSED_IDS.has(st.type[i])
    && (st.frameY?.[i] ?? 0) >= 594 && (st.frameY?.[i] ?? 0) <= 646
    && (st.frameX?.[i] ?? 0) < 54;
}

/** CheckTileBreakability_HasReasonToReturnEarly（WorldGen.cs:62491-62507）1:1：
 *  异种时祭坛 77 非困难模式 / PreventsTileRemovalIfOnTopOfIt → 早退；锁门恒拦；
 *  scanForContainer 时容器族恒拦。未激活格 type=0 不命中任何集合（原版同语义） */
function hasReasonToReturnEarly(st: DrillStore, ignoreType: number, tx: number, ty: number,
  scanForContainer: boolean, ctx?: KillTileCtx): boolean {
  if (!st.inBounds(tx, ty)) return false;
  const t = st.type[st.idx(tx, ty)];
  if (t !== ignoreType) {
    if (ALTAR_IDS.has(t) && !ctx?.hardMode) return true;          // :62494-62495
    if (PREVENTS_REMOVAL_ABOVE_IDS.has(t)) return true;           // :62496-62499
  }
  if (isLockedDoorAt(st, tx, ty)) return true;                    // :62500-62503
  if (scanForContainer && CONTAINER_IDS.has(t)) return true;      // :62504-62506
  return false;
}

/** WorldGen.CanKillTile 全量（WorldGen.cs:62716-62832；钻头智能光标/坡面平滑共用）。
 *  1:1 覆盖：越界/未激活/自身墙 350 → false；上方异种树干（分支/树顶帧豁免 + frameY<198）、
 *  棕榈 323 枝帧、宝箱/祭坛族承载位（21/26/72/77/88/467/488）、梳妆台 80 两侧帧 → false；
 *  追加四子项（:62316-62356）：巨石上方容器保护、上锁门、传送器 235 上方 3 格扫描、
 *  容器内容非空（CanDestroyChest）。
 *  ★不查 pick 力——原版该判定与镐力无关（光束会锁树/装饰，挖掘实效仍走 PickTile 主链）。
 *  ★active 判据=裸 active 位（本格 :62729/上格 :62735/传送器扫格 :62798,SW-L1
 *  2026-09-03 F10——曾用 isActive(nactive) 误拦已致动格,原版 tile.active() 不含
 *  致动位,致动块仍可被钻头杀）。
 *  ★out blockDamaged（SW-AP1 2026-09-05 消费定谳）：1457 WorldGen.cs:62716 出参,
 *  三置位支 = 巨石+CheckBoulderChest（:62780-62783）/锁门 case 10（:62787-62792）/
 *  传送器 235 上方 3 格（:62794-62804）。全仓读点 grep：1457 反编译 blockDamaged
 *  仅 WorldGen.cs 自身（wrapper :62712 声明、定义 :62716/:62718、三置位）——全部
 *  调用面（Player.cs:46058/:46104/:52946/:54474、Mount.cs:3217、Wiring.cs:1428/
 *  :3227,Player.cs:20507 走 SpecialKillTileContext 重载→二参 wrapper）无一传 out,
 *  1458 同（置位 :62790/:62798/:62810,调用面同）⇒ 出参仅传递性、无独立 UI 消费
 *  （无红字/裂纹/专音）；挖掘被拒的原版反馈 = 返回 false → num2/damage=0 →
 *  KillTile(fail:true) 每击音尘,本仓 Game.tryMine 已接。本 API 以 blockDamagedOut
 *  盒暴露三置位支（缺省不收集,返回面与原版对齐）,消费端按上 verdict 备案收口 */
/** 裸 active 位（原版 tile.active(),Tile.cs:591-593 header 0x20 位——不含 0x40
 *  致动位）。SW-L1 2026-09-03 F10：CanKillTile 三处判格全用裸 active
 *  （本格 :62729/上格 :62735/传送器扫格 :62798）——已致动格仍可被钻头杀。
 *  曾用 isActive(nactive) 误拦致动格。TileStore.flags bit0=active;测试桩缺
 *  flags 时回落 isActive（桩的 isActive 本就是 type!=0 裸口径）。
 *  SW-R3 2026-09-03（F-7c）：判位改 `(flags & 1) !== 0`——TileStore.flags
 *  bit0=active、bit1=framedDecor 预留位,`!==0` 会把预留位误读成 active */
function tileActiveBare(st: DrillStore, x: number, y: number): boolean {
  if (st.flags) return (st.flags[st.idx(x, y)] & 1) !== 0;
  return st.isActive(x, y);
}

export function canKillTileAt(st: DrillStore, x: number, y: number, ctx?: KillTileCtx,
  blockDamagedOut?: { value: boolean }): boolean {
  if (!st.inBounds(x, y) || !tileActiveBare(st, x, y)) return false;    // !tile.active()（:62729）
  const i = st.idx(x, y);
  if (st.wall[i] === 350) return false;
  const mine = st.type[i];
  if (y >= 1 && st.inBounds(x, y - 1)) {
    const a = st.idx(x, y - 1);
    if (tileActiveBare(st, x, y - 1)) {                                 // tile2.active()（:62735）
      const above = st.type[a];
      if (above !== mine) {
        // IsATreeTrunk：分支（frameX 66 行 0-44 / 88 行 66-110）与树顶（frameY≥198）豁免
        if (TREE_TRUNK_IDS.has(above)) {
          const fx = st.frameX?.[a] ?? 0, fy = st.frameY?.[a] ?? 0;
          const exempt = (fx === 66 && fy >= 0 && fy <= 44) || (fx === 88 && fy >= 66 && fy <= 110);
          if (!exempt && fy < 198) return false;
        }
        // 棕榈 323：左右枝帧不可杀（:62284-62288）
        if (PALM_ABOVE_IDS.has(above)) {
          const fx = st.frameX?.[a] ?? 0;
          if (fx === 66 || fx === 220) return false;
        }
        // 宝箱/祭坛/熔炉/倒木承载位（:62289-62300）
        if (SUPPORT_ABOVE_IDS.has(above)) return false;
        // 梳妆台 80：两侧 2 格宽段不可杀（:62301-62310）
        if (DRESSER_ABOVE_IDS.has(above)) {
          const col = (st.frameX?.[a] ?? 0) / 18;
          if (col <= 1 || (col >= 4 && col <= 5)) return false;
        }
      }
    }
  }
  // ---- 巨石-承载保护（:62316-62321 Boulders + CheckBoulderChest :48810-48831）：
  //      锚点归一到巨石左上格（frameX/18 取负、<-1 补 2；frameY 循环减 36），
  //      查其正上方两格是否有"不可移除"物 ----
  if (BOULDER_IDS.has(mine)) {
    let left = -Math.trunc((st.frameX?.[i] ?? 0) / 18);
    if (left < -1) left += 2;
    left += x;
    let fy = st.frameY?.[i] ?? 0;
    while (fy >= 36) fy -= 36;
    const top = y - Math.trunc(fy / 18);
    if (hasReasonToReturnEarly(st, mine, left, top - 1, true, ctx)
      || hasReasonToReturnEarly(st, mine, left + 1, top - 1, true, ctx)) {
      if (blockDamagedOut) blockDamagedOut.value = true;               // SW-AP1（:62782）
      return false;
    }
  }
  // ---- 上锁门（:62323-62330 case 10）----
  if (isLockedDoorAt(st, x, y)) {
    if (blockDamagedOut) blockDamagedOut.value = true;                 // SW-AP1（:62790）
    return false;
  }
  // ---- 传送器 235（:62788-62800 case 235）：锚点列起上方 3 格扫描（裸 active）----
  if (TELEPORTER_IDS.has(mine)) {
    const baseX = x - Math.trunc(((st.frameX?.[i] ?? 0) % 54) / 18);
    for (let k = 0; k < 3; k++) {
      const bx = baseX + k;
      if (st.inBounds(bx, y - 1) && tileActiveBare(st, bx, y - 1)   // tile3.active()（:62798）
        && hasReasonToReturnEarly(st, mine, bx, y - 1, true, ctx)) {
        if (blockDamagedOut) blockDamagedOut.value = true;           // SW-AP1（:62802）
        return false;
      }
    }
  }
  // ---- 容器内容门（:62345-62356 case 21/467/88）：CanDestroyChest——
  //      锚点 = i-(frameX/18)%2（88 为 %3）、j-frameY/18；有非空内容不可杀。
  //      ctx 缺省（坡面平滑链）按可毁近似 ----
  if (BASIC_CHEST_IDS.has(mine) || DRESSER_CHEST_IDS.has(mine)) {
    const mod = DRESSER_CHEST_IDS.has(mine) ? 3 : 2;
    const ax = x - (Math.trunc((st.frameX?.[i] ?? 0) / 18) % mod);
    const ay = y - Math.trunc((st.frameY?.[i] ?? 0) / 18);
    if (ctx && !ctx.chestDestroyable(ax, ay)) return false;
  }
  return true;
}

/** WorldGen.CheckTileBreakability（WorldGen.cs:62403-62489）1:1——
 *  鼠马车挖掘链（MinecartDiggerHelper.CanGetPastTile :172-188）的破坏性分级：
 *  返回 0=可破坏 / 1=条件保护（巨石压箱等，挖者语义上"别动"） / 2=结构保护
 *  （下方锁门 / 上方承载 / 树干 / 梳妆台宽段 / 传送器顶物件）。
 *  ★非实心且非 SolidTop 的格恒 0（:62426-62429）——轨道 314 等穿行件天然放行。
 *  ctx 缺省 = 非困难模式 + 无宝箱表（与 canKillTileAt 同口径） */
export function checkTileBreakabilityAt(st: DrillStore, x: number, y: number, ctx?: KillTileCtx): 0 | 1 | 2 {
  if (!st.inBounds(x, y)) return 0;
  const i = st.idx(x, y);
  const mine = st.type[i];
  if (y >= 1 && y <= st.h - 1) {                                    // :62410 边界带
    // SW-R3 2026-09-03（F-7a）：下邻/上邻/传送器扫格三处改裸 active（原版
    //  CheckTileBreakability :62898 tile3.active() / :62909 tile2.active() /
    //  :62956 tile4.active() 均不含致动位;曾用 isActive(nactive) 误拦已致动格）
    if (st.inBounds(x, y + 1) && tileActiveBare(st, x, y + 1)
      && isLockedDoorAt(st, x, y + 1)) return 2;                    // :62422-62425 下方锁门
    const d = TILE_DEFS[mine];
    if (!d || !(d.solid || d.platform)) return 0;                   // :62426-62429 !tileSolid&&!tileSolidTop
    if (tileActiveBare(st, x, y - 1)) {
      const a = st.idx(x, y - 1);
      const above = st.type[a];
      const flag = CONTAINER_IDS.has(mine);                         // IsAContainer(tile)
      if (hasReasonToReturnEarly(st, mine, x, y - 1, !flag, ctx)) { // :62433
        if (TREE_TRUNK_IDS.has(above)) {                            // :62435-62442 分支/树顶帧豁免
          const fx = st.frameX?.[a] ?? 0, fy = st.frameY?.[a] ?? 0;
          const exempt = (fx === 66 && fy >= 0 && fy <= 44) || (fx === 88 && fy >= 66 && fy <= 110) || fy >= 198;
          return exempt ? 0 : 2;
        }
        if (PALM_ABOVE_IDS.has(above)) {                            // :62443-62450 棕榈枝帧
          const fx = st.frameX?.[a] ?? 0;
          return (fx === 66 || fx === 220) ? 2 : 0;
        }
        return 2;
      }
      if (above !== mine && DRESSER_ABOVE_IDS.has(above)) {         // :62453-62460 梳妆台宽段
        const col = Math.trunc((st.frameX?.[a] ?? 0) / 18);
        if (col <= 1 || (col >= 4 && col <= 5)) return 2;
      }
      if (DOOR_CLOSED_IDS.has(mine) && isLockedDoorAt(st, x, y)) return 1;  // :62461-62464
      if (BOULDER_IDS.has(mine)) {                                  // :62465-62472 CheckBoulderChest
        let left = -Math.trunc((st.frameX?.[i] ?? 0) / 18);
        if (left < -1) left += 2;
        left += x;
        let fy2 = st.frameY?.[i] ?? 0;
        while (fy2 >= 36) fy2 -= 36;
        const top = y - Math.trunc(fy2 / 18);
        const hit = hasReasonToReturnEarly(st, mine, left, top - 1, true, ctx)
          || hasReasonToReturnEarly(st, mine, left + 1, top - 1, true, ctx);
        return hit ? 1 : 0;
      }
    }
    if (TELEPORTER_IDS.has(mine)) {                                 // :62474-62486 传送器顶 3 格
      const baseX = x - Math.trunc(((st.frameX?.[i] ?? 0) % 54) / 18);
      for (let k = 0; k < 3; k++) {
        const bx = baseX + k;
        if (st.inBounds(bx, y - 1) && tileActiveBare(st, bx, y - 1)
          && hasReasonToReturnEarly(st, mine, bx, y - 1, true, ctx)) return 2;
      }
    }
  }
  return 0;
}

/** WorldGen.CheckTileBreakability2_ShouldTileSurvive（WorldGen.cs:62515-62559）1:1：
 *  非空容器（BasicChest 21/467 %2、梳妆台 88 %3、模特 470、帽架 475）应存活。
 *  470/475 的 TEDisplayDoll/TEHatRack.IsBreakable ≈ 空内容可拆——复用
 *  ctx.chestDestroyable 语义（缺省按可拆） */
export function shouldTileSurviveAt(st: DrillStore, x: number, y: number, ctx?: KillTileCtx): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  const mine = st.type[i];
  if (BASIC_CHEST_IDS.has(mine) || DRESSER_CHEST_IDS.has(mine)) {   // :62526-62550
    const mod = DRESSER_CHEST_IDS.has(mine) ? 3 : 2;
    let num = Math.trunc((st.frameX?.[i] ?? 0) / 18) % mod;
    const ax = x - num, ay = y - Math.trunc((st.frameY?.[i] ?? 0) / 18);
    if (ctx && !ctx.chestDestroyable(ax, ay)) return true;          // !DestroyChest → survive
  }
  if (CONTAINER_IDS.has(mine)) {                                    // :62551-62558 470/475
    // 模特/帽架锚点 %2 归一后按空内容近似（无 TE 表时）
    if (ctx) {
      const ax = x - (Math.trunc((st.frameX?.[i] ?? 0) / 18) % 2);
      const ay = y - Math.trunc((st.frameY?.[i] ?? 0) / 18);
      if (!ctx.chestDestroyable(ax, ay)) return true;
    }
  }
  return false;
}

/** Player.CanPlayerSmashWall（Player.cs:45303-45326）1:1：wall 350 不可拆；
 *  房墙（Main.wallHouse 表）直接可拆，天然墙需 3×3 内曝露一格（空/房墙）才可拆 */
export function canPlayerSmashWallAt(st: DrillStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const wall = st.wall[st.idx(x, y)];
  if (wall === 350) return false;
  if (WALL_HOUSE.has(wall)) return true;
  for (let i = x - 1; i <= x + 1; i++) {
    for (let j = y - 1; j <= y + 1; j++) {
      if (!st.inBounds(i, j)) continue;
      const w = st.wall[st.idx(i, j)];
      if (w === 0 || WALL_HOUSE.has(w)) return true;
    }
  }
  return false;
}

/** DrillSmartCursor_Blocks（Mount.cs :3145-3179）1:1：
 *  从玩家中心朝鼠标方向扫带（65.6px 宽），途中第一块 CanKillTile 可杀格即目标
 *  （:3169-3173——不查镐力，挖掘实效走 PickTile 主链）；已被其他束以挖块目的
 *  锁定的格跳过（两束分工）。无目标返回 null。
 *  killCtx = CanKillTile 追加子项的运行期上下文（锁门/巨石/传送器/容器内容） */
export function drillBlockTarget(
  st: DrillStore, centerX: number, centerY: number,
  aimX: number, aimY: number, beams: readonly DrillBeam[], killCtx?: KillTileCtx,
): { x: number; y: number } | null {
  const rawX = aimX - centerX, rawY = aimY - centerY;
  const dist = Math.hypot(rawX, rawY);
  let len = dist > DRILL_MAX_LENGTH ? DRILL_MAX_LENGTH : dist;
  len += 32;
  const inv = dist > 0 ? len / dist : 0;
  const endX = centerX + rawX * inv, endY = centerY + rawY * inv;
  let target: { x: number; y: number } | null = null;
  const hit = !plotTileLineBand(centerX, centerY, endX, endY, DRILL_BLOCK_BAND, (x, y) => {
    target = { x, y };
    for (const b of beams) {
      if (b.tx === x && b.ty === y && b.purpose === 0) return true;   // 已锁定 → 跳过
    }
    if (!canKillTileAt(st, x, y, killCtx)) return true;               // CanKillTile 不可杀 → 跳过
    return false;                                                     // 命中目标
  });
  return hit ? target : null;
}

/** DrillSmartCursor_Walls（Mount.cs :3181-3218）1:1：
 *  同向扫带（97.6px 宽 + 16px 延伸），第一格"有可拆背景墙"即目标。
 *  CanPlayerSmashWall（Player.cs:45303-45326）全量 1:1：wall 350 不可拆；
 *  房墙直接可拆、天然墙需 3×3 曝露（本仓手持锤墙路径不查此规则——登记偏差，钻头侧已对齐）。 */
export function drillWallTarget(
  st: DrillStore, centerX: number, centerY: number,
  aimX: number, aimY: number, beams: readonly DrillBeam[],
): { x: number; y: number } | null {
  const rawX = aimX - centerX, rawY = aimY - centerY;
  const dist = Math.hypot(rawX, rawY);
  let len = dist > DRILL_MAX_LENGTH ? DRILL_MAX_LENGTH : dist;
  len += 32 + DRILL_WALL_EXTRA;
  const inv = dist > 0 ? len / dist : 0;
  const endX = centerX + rawX * inv, endY = centerY + rawY * inv;
  let target: { x: number; y: number } | null = null;
  const hit = !plotTileLineBand(centerX, centerY, endX, endY, DRILL_WALL_BAND, (x, y) => {
    target = { x, y };
    for (const b of beams) {
      if (b.tx === x && b.ty === y && b.purpose === 1) return true;
    }
    if (!st.inBounds(x, y)) return false;            // 原版 tile==null → return false（即目标）
    const wall = st.wall[st.idx(x, y)];
    return !(wall > 0 && canPlayerSmashWallAt(st, x, y));  // 有可拆墙 → false（目标）
  });
  return hit ? target : null;
}

/** ClampToDeadZone（Mount.cs :5294-5332）——瞄准点贴着玩家时外推到死区边缘，
 *  避免零向量方向抖动。deadX/deadY = 各坐骑贴图半尺寸（9: 45×54 / 8: 80×80） */
export function clampToDeadZone(
  centerX: number, centerY: number, x: number, y: number, deadX: number, deadY: number,
): { x: number; y: number } {
  let dx = x - centerX, dy = y - centerY;
  if (dx > -deadX && dx < deadX && dy > -deadY && dy < deadY) {
    const sx = deadX / Math.abs(dx);
    const sy = deadY / Math.abs(dy);
    const s = sx > sy ? sy : sx;
    if (Number.isFinite(s)) { dx *= s; dy *= s; }
  }
  return { x: dx + centerX, y: dy + centerY };
}

/** Hover 贴地探针（Mount.cs:3443-3448 Collision.TileCollision(position, UnitY*gravDir,…)
 *  的本仓等价）：重力方向下一行任一列实心 = 有地面（探针残量=0 → 免疲劳坐骑不起落）。
 *  原版 fallThrough:false 平台亦拦——isSolid 含平台档（TileStore.isSolid 语义）。
 *  无世界缓存（探针合成视图）按有地面=不起落 */
export function groundBelowProbe(p: MountedPlayerView): boolean {
  const st = p.store;
  if (!st) return true;
  const ty = p.gravDir === -1 ? Math.floor((p.y - 1) / 16) : Math.floor((p.y + p.h + 1) / 16);
  const x0 = Math.floor(p.x / 16), x1 = Math.floor((p.x + p.w - 0.01) / 16);
  for (let tx = x0; tx <= x1; tx++) {
    if (st.inBounds(tx, ty) && st.flags[st.idx(tx, ty)] && st.isSolid(tx, ty)) return true;
  }
  return false;
}

/** Mount.cs Hover 尾段（:3468-3521）机身倾斜角 1:1（player.fullRotation）：
 *  - UFO 7 / 钻头 8：π/4 × clamp(vx/dashSpeed, ±0.95) / 2（随水平速度倾斜）
 *  - 巫婆扫帚 23：-π/16 × clamp(-vy/dash) × dir + π/16 × clamp(vx/dash)
 *    （origin = 玩家底心 :3520——渲染层绕底部锚点旋转）
 *  其余坐骑 0（55 爬墙族走 UpdateAfterEquips :2967-2997，未实装登记） */
export function bodyRotationFor(type: number, vx: number, vy: number, facing: number, dashSpeed: number): number {
  // ★BJ704-G5（G4-③）熔岩鲨 49（UpdateFrame case 49 :3741-3744）：
  // num5 = vy×0.05,朝向左取反（velocity.Length() 伴生行为无副作用,略）
  if (type === 49) return vy * 0.05 * (facing < 0 ? -1 : 1);
  if (type !== 7 && type !== 8 && type !== 23) return 0;
  const d = dashSpeed > 0 ? dashSpeed : 1;
  if (type === 7 || type === 8) {
    let n = vx / d;
    if (n > 0.95) n = 0.95;
    else if (n < -0.95) n = -0.95;
    return Math.PI / 4 * n / 2;
  }
  // 23：双轴
  const v = Math.max(-1, Math.min(1, -vy / d));
  const v2 = Math.max(-1, Math.min(1, vx / d));
  return -Math.PI / 16 * v * facing + Math.PI / 16 * v2;
}

/** player.fullRotation 读值 + fullRotationOrigin（Player 侧非渲染消费位：
 *  DoDeadCellsBeheadedParticles :24497-24500 枭首者头部载荷旋位）。与渲染层
 *  playerMountRotation（Renderer.ts）同源同式——fullRotation 写面两支：
 *  ①矿车轨面：Minecart.TrackRotation（Player.cs:28325 `ref fullRotation`=atan2 坡度、
 *    :28326 origin=(w/2,h)——本仓镜像 = Minecart.rotation,onTrack 写/脱轨归零
 *    （Minecart.ts:446-455）,cart.h = 42+heightBoost = 原版 mounted 盒高）;
 *  ②坐骑 Hover 机身倾斜（Mount.cs:3519-3568,1456 :3468-3521——UFO 7/钻头 8/扫帚 23;
 *    origin = SetMount 7/8 (w/2,h/2)（:6346）或扫帚 Hover 每帧 (w/2,h)（:3568））。
 *  ③熔岩鲨 49 vy 倾斜（UpdateFrame case 49 :3741-3745,origin=(w/2,h/2) 盒心——
 *    ★BJ704-G20 消费门扩员转正,见下方 playerFullRotationOf 体内注）。
 *  43 pogo 旋（:3748-3761）/55 爬墙旋（:3015-3018）
 *  写面本仓未建模 → 恒 0（登记建模边界,不发明近似）。本仓玩家盒恒 42 高,mounted
 *  盒中心按 42+heightBoost 换算（渲染层同式）;矿车支 pivotY = p.y+cart.h（玩家位被
 *  锁车盒顶 Minecart.ts:530-531 → vanilla position+(w/2,h) 直形）。cart = Player.cart
 *  结构视图（本模块禁 import Minecart——TDZ 断环,见文件头 :77）。返回 null = 无旋位。 */
export function playerFullRotationOf(
  p: { x: number; y: number; w: number; h: number },
  m: MountInstance,
  cart?: { rotation: number; h: number } | null,
): { angle: number; pivotX: number; pivotY: number } | null {
  if (cart && cart.rotation !== 0) {
    // 矿车轨面支（Player.cs:28325-28326）：fullRotation=TrackRotation atan2、
    // fullRotationOrigin=(width/2,height) → pivot = position+(w/2, cart.h)
    return { angle: cart.rotation, pivotX: p.x + p.w / 2, pivotY: p.y + cart.h };
  }
  // ★SW-BJ59 滚轴鞋轨面支（Player.cs:28325-28326 同式）：贴轨倾角存
  // mount.fullRotation（57-60 无 Hover 倾斜占用）、origin=(width/2,height)
  if (m.active && MOUNT_SETS.IsRollerSkates?.[m.type] && m.fullRotation !== 0) {
    return { angle: m.fullRotation, pivotX: p.x + p.w / 2, pivotY: p.y + p.h };
  }
  // ★BJ704-G20（R10-P2 case49-tilt 消费面扩员）：门 {7,8,23} 补 49——熔岩鲨
  //   fullRotation 写面早经 bodyRotationFor（G5 :1058 vy×0.05×朝向,UpdateFrame
  //   case 49 :3741-3744）逐拍维护,消费门漏员=死写（G5 半截）。origin 同 7/8
  //   =(width/2,height/2)（:3745）=mounted 盒心支（非 23 底锚支）。
  if (!m.active || m.fullRotation === 0
    || (m.type !== 7 && m.type !== 8 && m.type !== 23 && m.type !== 49)) return null;
  const mh = 42 + (m.heightBoost || 0);
  return {
    angle: m.fullRotation,
    pivotX: p.x + p.w / 2,
    pivotY: m.type === 23 ? p.y + p.h : p.y + p.h - mh / 2,
  };
}

/** Vector2.RotatedBy(rotation, center)（Vector2.cs）1:1——绕 center 旋 rotation。
 *  center 缺省 Zero = 纯向量旋转（DoDeadCellsBeheadedParticles :24504-24506
 *  骑乘速度旋转支写法）。纯函数供测试锁定。 */
export function rotatedBy(x: number, y: number, rot: number, cx = 0, cy = 0): { x: number; y: number } {
  const dx = x - cx, dy = y - cy;
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** Scutlix 索敌目标的实体视图（NPC.CanBeChasedBy 过滤后的候选，Player 侧组装） */
export interface ScutlixTarget { x: number; y: number; w: number; h: number }

/** UpdateEffects case 9/46 索敌段（Mount.cs :4884-4930）1:1：
 *  850px 内、朝向锥 ±60° 内、视线可达的最近敌怪（1500px 上限内取更近者） */
export function scutlixFindTarget(
  p: { x: number; y: number; w: number; h: number; facing: number },
  npcs: readonly ScutlixTarget[],
  los: (cx: number, cy: number, t: ScutlixTarget) => boolean,
): ScutlixTarget | null {
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  let best: ScutlixTarget | null = null;
  let found = false;
  let bestD = SCUTLIX_SEEK_MAX;
  for (const n of npcs) {
    const vx = n.x + n.w / 2 - cx, vy = n.y + n.h / 2 - cy;
    const d = Math.hypot(vx, vy);
    if (d >= SCUTLIX_SEEK_RANGE) continue;
    const bestDist = best ? Math.hypot(best.x + best.w / 2 - cx, best.y + best.h / 2 - cy) : 0;
    if (!((bestDist > d && d < SCUTLIX_SEEK_MAX) || !found)) continue;
    // 朝向锥（:4909-4918）：面右限 |角| ≤ π/3；面左限 |角| ≥ 2π/3
    const ang = Math.abs(Math.atan2(vy, vx));
    let cone = true;
    if (p.facing === 1 && ang > 1.047197594907988) cone = false;
    else if (p.facing === -1 && ang < 2.0943951461045853) cone = false;
    if (cone && los(cx, cy, n)) {
      bestD = d; best = n; found = true;
    }
  }
  return found ? best : null;
}

// ============================================================================
// ★BJ357 变身坐骑回盒（Mount.cs Dismount :6240-6257 / CanDismountWithResult :6670-6681）
// ============================================================================

/** 盒-实心重叠探针（Collision.SolidCollision 近似）：active && isSolid && 非平台、
 *  halfBrick 顶面 +8；坡面按满格近似（TryChangingSizeFromBottomCenter 的
 *  TileCollisionInStepsOf16 :2462-2488 含 slope 精算与 1px 内缩探针——平台/半砖
 *  已对齐,坡面与亚像素残量登记近似）。 */
function mountBoxSolid(st: SolidTileView, px: number, py: number, w: number, h: number): boolean {
  const x0 = Math.floor(px / 16), x1 = Math.floor((px + w - 1) / 16);
  const y0 = Math.floor(py / 16), y1 = Math.floor((py + h - 1) / 16);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!st.inBounds(tx, ty) || !st.isSolid(tx, ty)) continue;
      const k = st.idx(tx, ty);
      if (TILE_DEFS[st.type[k]]?.platform) continue;    // tileSolidTop（平台）不算实心
      let tyPx = ty * 16, thPx = 16;
      if (st.half?.[k]) { tyPx += 8; thPx -= 8; }       // halfBrick 下半
      if (px + w > tx * 16 && px < tx * 16 + 16 && py + h > tyPx && py < tyPx + thPx) return true;
    }
  }
  return false;
}

/** Collision.TryChangingSizeFromBottomCenter（Collision.cs:2495-2543）1:1：底中心
 *  锚定把盒改为 (tw×th)——先纵向（上探 num3 slack 优先、余量向下伸 num5）后横向
 *  （num10 左档先对半、余量左补,再右补 num9,各吃自身 slack）;任一轴总 slack 不足
 *  → null。缩支（目标≤现盒）零探针：Y 底锚、X 居中（Offset(0,-num)/Offset(num6/2)）。
 *  步进探针原版 16px 步长+碰撞残量，此处逐像素精化（平台不算实心,同 mountBoxSolid）。
 *  消费位 = MountInstance.canDismount / dismount 回盒。 */
export function tryChangingSizeFromBottomCenter(
  st: SolidTileView, x: number, y: number, w: number, h: number,
  tw: number, th: number,
): { x: number; y: number; w: number; h: number } | null {
  const slack = (bx: number, by: number, bw: number, bh: number,
    dx: number, dy: number, dist: number): number => {
    let moved = 0;
    while (moved < dist) {
      if (mountBoxSolid(st, bx + dx * (moved + 1), by + dy * (moved + 1), bw, bh)) break;
      moved++;
    }
    return moved;
  };
  const out = { x, y, w, h };
  const num = th - h;
  if (num > 0) {
    const num2 = slack(out.x, out.y, out.w, out.h, 0, 1, num);    // +Y 下探（:2501）
    const num3 = slack(out.x, out.y, out.w, out.h, 0, -1, num);   // −Y 上探（:2502）
    if (num3 + num2 < num) return null;                            // :2504
    const num4 = Math.min(num, num3);                              // :2507（上伸优先）
    let num5 = 0;
    num5 += Math.min(num - num4 - num5, num2 - num5);              // :2510-2511 余量下伸
    out.y -= num4;                                                 // :2512 Offset(0,-num4)
    out.h += num4 + num5;                                          // :2513
  } else {
    out.y -= num;                                                  // :2516 底锚
    out.h = th;
  }
  const num6 = tw - out.w;
  if (num6 > 0) {
    const num7 = slack(out.x, out.y, out.w, out.h, 1, 0, num6);   // +X 右探（:2524）
    const num8 = slack(out.x, out.y, out.w, out.h, -1, 0, num6);  // −X 左探（:2525）
    if (num8 + num7 < num6) return null;                           // :2526
    let num9 = Math.min(Math.trunc(num6 / 2), Math.min(num8, num7));  // :2528 左右对半
    let num10 = num9;
    num10 += Math.min(num6 - num10 - num9, num8 - num10);          // :2529-2530 余量左补
    const val2 = num6 - num10 - num9;
    num9 += Math.min(val2, num7 - num9);                           // :2531-2532 剩余右补
    out.x -= num10;                                                // :2533 Offset(-num10)
    out.w += num10 + num9;                                         // :2534
  } else {
    out.x += Math.trunc(num6 / 2);                                 // :2537 居中
    out.w = tw;
  }
  return out;
}

/**
 * 单坐骑实例状态机（Mount.cs 实例字段 + 行为 1:1）。
 * 玩家持有恒一个实例（player.mount），active 即骑乘中。
 */
export class MountInstance {
  active = false;
  type = -1;
  /** 当前帧索引（竖排帧条第 frame 行） */
  frame = 0;
  private frameCounter = 0;
  frameExtra = 0;
  private frameExtraCounter = 0;
  /** 帧状态机态（FRAME_*） */
  frameState = FRAME_STANDING;
  /** 飞行剩余 tick（flightTimeMax；ResetFlightTime 重置） */
  flyTime = 0;
  /** ★BJ703-D1 迅猛龙 54 选择性飞行闩（Mount.cs SelectiveFlyingMountData.allowedToFly
   *  :74/:76——UpdateAfterEquips :3001-3004 每拍以【坐骑清翼(:26834)前】的 wingsLogic
   *  置位,CanFly :2871 直读。同结构 showFlyingFrames(:72)全反编译树零消费=原版死字段,
   *  不建模（登记）。SetMount :6360-6363 每次上骑 new SelectiveFlyingMountData =
   *  闩随 reset 清零承载。 */
  allowedToFly = false;
  /** 飞行疲劳（hover 族用尽 flyTime 后累积，疲劳越高爬升越弱） */
  fatigue = 0;
  /** 疲劳池上限（Mount._fatigueMax；公开供测试与 runSpeed 的疲劳比直读） */
  fatigueMax = 0;
  abilityCharging = false;
  abilityCharge = 0;
  abilityCooldown = 0;
  abilityDuration = 0;
  /** 钻头激光激活态（Mount.cs _abilityActive :357；UseAbility case 8 开合） */
  abilityActive = false;
  /** Scutlix/Santank 瞄准中（_aiming :359——眼部帧与朝向锁定门 AllowDirectionChange） */
  aiming = false;
  /** Scutlix 背向移动时动画倒放（_flipDraw :327；UpdateFrame :4247/:4455 消费） */
  flipDraw = false;
  /** 猪鲨崽 MountFishronSpecial 计数器（Player.MountFishronSpecialCounter :2868） */
  fishronCounter = 0;
  /** 猪鲨崽增益本 tick 生效缓存（UpdateEffects case 12 先算后消费） */
  fishronBoost = false;
  /** 坐骑特殊跳（hasJumpOption_*）空中段是否已消费（Player.canJumpAgain_* 语义） */
  mountJumpReady = false;
  /** 坐骑特殊跳进行中（isPerformingJump_*——蜥蜴/山羊两版源码均无复位，骑乘期内常驻） */
  mountJumpPerforming = false;
  // ---- 钻头坐骑（mount 8）专属态（DrillMountData :36-50） ----
  private drillBeams: DrillBeam[] = [drillBeamIdle(), drillBeamIdle()];
  private drillBeamCooldown = 0;
  /** 二极管当前角（AimAbility 目标角的 0.85/0.15 lerp，UpdateDrill :3011） */
  diodeRotation = 0;
  diodeRotationTarget = 0;
  /** 外环旋转（Hover case 8 :3497-3508：随 vx/80 累积，供背层贴图旋转） */
  outerRingRotation = 0;
  /** 机身倾斜角（Mount.cs Hover 尾段 :3468-3521：UFO 7/钻头 8 随 vx、巫婆扫帚 23
   *  随 vx+vy——写 player.fullRotation；渲染层消费见 drawMountLayer） */
  fullRotation = 0;
  /** 蜥蜴 14 冲刺蓄能（UpdateFrame case 14 :4075：每 tick +1/180，钳 0-1） */
  basiliskCharge = 0;
  /** 本 tick 冲刺帧组切入（flag7 :3838：frameExtra<6 时的首拍——冲刺尘触发沿）。
   *  ★BJ707-G31 扩义:海盗船 44（flag2 :3951）/惊魂木 45（flag4 :4012）的
   *  _mountSpecificData 沿闩 rising edge 同置本旗（updateFrame case 44/45 臂,
   *  updateMountEffects 消费;10/40-47/44/45 四族互斥分派=无串扰） */
  dashBurst = false;
  /** ★BJ707-G31:44/45 速度闩（Mount._mountSpecificData bool 位 :3954/:4015——
   *  上升沿发环爆发,下降沿清;setMount/reset 归零=vanilla null→false 同相） */
  dashBurstLatched = false;
  /** ★SW-FX18 本 tick 高尔夫球车跑动态（UpdateFrame case 17 :4650-4662 的车轮尘窗
   *  ——state ∉ {0,2,3,4}）；updateMountEffects 消费后即弃 */
  wheelDust = false;
  /** 本 tick 处于冲刺速度门内（flag6 :3831——独角兽尘/山羊火焰的速度门） */
  dashing = false;
  /** 光标世界位（crosshairPosition :48——本地玩家=鼠标世界坐标） */
  crosshairX = 0;
  crosshairY = 0;
  /** 离地行走宽限（UpdateFrame :3599：vy!=0 起每帧 -1，归零才切空中帧） */
  walkingGraceTime = 0;
  private idleTime = 0;
  private idleTimeNext = -1;
  /** 待机随机数种子（UpdateFrame state0 idle 触发 rand(900,1500) 的本仓等价） */
  private idleRand = Math.random();

  get data(): MountData | null {
    return this.active ? MOUNT_DATA[String(this.type)] ?? null : null;
  }

  /** 矿车族：物理由 Minecart.ts 接管（Player.ridingCart 分支），本实例只保留参数查询 */
  get isCart(): boolean {
    return this.active && isCartMount(this.type);
  }

  get buff(): number { return this.data?.buff ?? -1; }
  get bodyFrame(): number { return this.data?.bodyFrame ?? 3; }
  get heightBoost(): number { return this.data?.heightBoost ?? 0; }
  get blockExtraJumps(): boolean { return !!this.data?.blockExtraJumps; }
  get autoJump(): boolean { return !!this.data?.constantJump; }
  get fallDamageFactor(): number { return this.data?.fallDamage ?? 1; }
  get extraFall(): number { return this.data?.extraFall ?? 0; }
  /** 游泳族门：坐骑 buff 在 ignoreWater 集内（Player.cs :9972-9999——131/168/279/305;
   *  ★G13：265 火烈鸟移出（canFloatInWater 非 ignoreWater,见 BUFF_SWIM_FREE 注）） */
  get swimFree(): boolean { return this.active && BUFF_SWIM_FREE.has(this.buff); }
  /** ★BJ704-G13（债3）：骑乘期授 accFlipper 的坐骑 buff（:9974-9998 ∪ 265 :9982-86）
   *  ——湿跳门 flag2 :20795 的骑乘臂（液中悬空泳跃） */
  get flipperMount(): boolean { return this.active && BUFF_FLIPPER.has(this.buff); }

  // ---- Mount.cs RunSpeed getter :451-486（每坐骑特例 1:1） ----
  runSpeed(): number {
    const d = this.data;
    if (!d) return 0;
    // 海龟/猪鲨崽/海盗船/熔岩鲨：游泳帧态下取 swimSpeed
    if (this.type === 4 && this.frameState === FRAME_SWIMMING) return d.swimSpeed ?? d.runSpeed;
    if ((this.type === 12 || this.type === 44 || this.type === 49) && this.frameState === FRAME_SWIMMING) {
      return d.swimSpeed ?? d.runSpeed;
    }
    if (this.type === 12 && this.frameState === FRAME_IN_AIR) return d.runSpeed + 13.5;
    if (this.type === 44 && this.frameState === FRAME_IN_AIR) return d.runSpeed + 4;
    if (this.type === 5 && this.frameState === FRAME_IN_AIR) {
      const t = this.fatigueMax > 0 ? this.fatigue / this.fatigueMax : 0;
      return d.runSpeed + 4 * (1 - t);
    }
    if (this.type === 50 && this.frameState === FRAME_IN_AIR) return d.runSpeed + 2;
    return d.runSpeed;
  }

  get dashSpeed(): number { return this.data?.dashSpeed ?? this.data?.runSpeed ?? 0; }
  get acceleration(): number { return this.data?.acceleration ?? 0.1; }
  /** MountData.dashSpeed 裸值（C# 字段默认 0——14/17/37/43/52 五坐骑未设）。
   *  上方 dashSpeed 的 runSpeed 回退是旧接入的近似（accRunSpeed 用途下与 0 等价），
   *  冲刺门（免击退/冲刺帧）按原版取裸值 */
  get dashSpeedRaw(): number { return this.data?.dashSpeed ?? 0; }
  /** MovementStatsAreAdditive（Mount.cs :2580 SetAsRollerSkate 全四坐骑置真——
   *  Player.cs:26836-26853 上限/跳跃参数走 `+=` 叠加支而非赋值） */
  get movementStatsAdditive(): boolean { return ROLLER_SKATE_IDS.has(this.type); }

  /** UpdateEffects :4933/:4877/:4956/:4963 授予的空中再跳（hasJumpOption_*）。
   *  独角兽 10 / 圣诞坦克 46 / 山羊 47 / 蜥蜴 14——JumpMovement :20435-20688 链消费 */
  get jumpOption(): 'Unicorn' | 'Santank' | 'WallOfFleshGoat' | 'Basilisk' | null {
    if (!this.active) return null;
    switch (this.type) {
      case 10: return 'Unicorn';
      case 46: return 'Santank';
      case 47: return 'WallOfFleshGoat';
      case 14: return 'Basilisk';
      default: return null;
    }
  }

  /** 特殊跳跳跃保持时长（JumpMovement :20603/:20631/:20659：
   *  独角兽/山羊 = jumpHeight×2；蜥蜴 = trunc(jumpHeight×0.75)） */
  mountJumpTicks(): number {
    const jh = this.data?.jumpHeight ?? 0;
    return this.type === 14 ? Math.trunc(jh * 0.75) : jh * 2;
  }

  /** 冲刺态免击退门（UpdateEffects :4962/:4968：|vx| > DashSpeed - RunSpeed/2）。
   *  蜥蜴未设 dashSpeed（裸值 0）→ 门恒过——原版同款数值怪癖，照抄 */
  dashNoKnockback(vx: number): boolean {
    if (!this.active) return false;
    return Math.abs(vx) > this.dashSpeedRaw - this.runSpeed() / 2;
  }

  /** 冲刺帧触发门（UpdateFrame case 10/40/41/42/47 :3827）——与免击退同式 */
  isDashingSpeed(vx: number): boolean {
    return Math.abs(vx) > this.dashSpeedRaw - this.runSpeed() / 2;
  }

  /** Mount.AllowDirectionChange（:604-614）1:1：Scutlix 冷却过半（<10）才许改向；
   *  Santank 恒许（旧实现按"瞄准中"锁两族——Scutlix 侧偏差已对齐） */
  get allowDirectionChange(): boolean {
    if (this.type !== 9) return true;
    return this.abilityCooldown < (this.data?.abilityCooldown ?? 20) / 2;
  }

  /** Hover 尾段机身倾斜维护（:3468-3521，每 tick）：7/8 随 vx、23 随 vx+vy；
   *  钻头外环角同步累积（:3497-3508 += vx/80，±π 卷绕） */
  updateBodyRotation(p: MountedPlayerView): void {
    this.fullRotation = bodyRotationFor(this.type, p.vx, p.vy, p.facing, this.dashSpeedRaw || this.dashSpeed);
    if (this.type === 8) {
      let ring = this.outerRingRotation + p.vx / 80;
      if (ring > Math.PI) ring -= Math.PI * 2;
      else if (ring < -Math.PI) ring += Math.PI * 2;
      this.outerRingRotation = ring;
    }
  }

  /** 猪鲨崽增益判定（Player.cs:3882-3896 MountFishronSpecial 1:1）：
   *  半血以下 / 水湿（岩浆蜂蜜不算）/ 滴水 buff 103 / 计数器 > 0 / 雨中露天
   *  任一成立即全额（hover ×1、移速不减半、四系伤害 +15%）。
   *  dripping = buff 103 Wet 激活（:3886 `!dripping`——仅增益判定消费，
   *  不写入计数器：Mount.cs :4996-5003 的 420t 只由 wet|雨中露天驱动） */
  fishronSpecial(p: FishronView): boolean {
    const half = Math.floor(p.maxHp / 2);   // C# int 除法
    if (p.hp >= half && (!p.inWater || p.inLava || p.inHoney) && !p.dripping
      && !(this.fishronCounter > 0)) {
      if (p.raining) return p.windExposed;
      return false;
    }
    return true;
  }

  /** 猪鲨崽计数器维护（UpdateEffects case 12 :4996-5003）：
   *  先衰减（Player.cs:25340 UpdateBuffs 段）再判增益；
   *  半血以下 → 60；湿身或雨中露天 → 420（离开后的余效时长） */
  updateFishron(p: FishronView): boolean {
    if (this.fishronCounter > 0) this.fishronCounter -= 1;
    this.fishronBoost = this.fishronSpecial(p);
    const half = Math.floor(p.maxHp / 2);
    if (p.hp <= half) this.fishronCounter = FISHRON_COUNTER_LOW_HP;
    if (p.inWater || (p.raining && p.windExposed)) this.fishronCounter = FISHRON_COUNTER_WET;
    return this.fishronBoost;
  }

  // ---- Mount.cs JumpHeight/JumpSpeed :2767-2816 ----
  jumpHeight(xVelocity: number): number {
    const d = this.data;
    if (!d) return 0;
    let n = d.jumpHeight;
    if (this.type === 0) n += Math.trunc(Math.abs(xVelocity) / 4);
    else if (this.type === 1) n += Math.trunc(Math.abs(xVelocity) / 2.5);
    else if ((this.type === 4 || this.type === 49) && this.frameState === FRAME_SWIMMING) n += 5;
    return n;
  }

  jumpSpeed(xVelocity: number): number {
    const d = this.data;
    if (!d) return 0;
    let n = d.jumpSpeed;
    if (this.type === 0 || this.type === 1) n += Math.abs(xVelocity) / 7;
    else if ((this.type === 4 || this.type === 49) && this.frameState === FRAME_SWIMMING) n += 2.5;
    return n;
  }

  // ---- Mount.cs CanFly/CanHover :2865-2881 ----
  canFly(p: MountedPlayerView): boolean {
    if (!this.active) return false;
    // ★BJ703-D1 迅猛龙选择性飞行门（:2871 `if (_type == 54 && ((SelectiveFlyingMountData)
    //   _mountSpecificData).allowedToFly) return true`——在 flightTimeMax==0 拒绝【前】,
    //   无翼 54 沿 0 恒假原路返回（与 48 同走 false 面）。
    if (this.type === 54 && this.allowedToFly) return true;
    const d = this.data;
    if (!d) return false;
    if ((d.flightTimeMax ?? 0) === 0) return false;
    if (this.type === 48) return false;    // DarkMageBook 永不飞行
    void p;
    return true;
  }

  canHover(p: MountedPlayerView): boolean {
    if (!this.active) return false;
    const d = this.data;
    if (!d || !d.usesHover) return false;
    if (this.type === 49) return this.frameState === FRAME_SWIMMING;   // 熔岩鲨只在水中悬停
    void p;
    return true;
  }

  /** hover 是否豁免疲劳池——DoesHoverIgnoresFatigue（Mount.cs:3534-3542）是【固定
   *  类型表】{7,8,12,23,44,49,56,61}：这些坐骑永不耗能；只有蜜蜂 5 与暗黑魔法书
   *  48 真正吃能量池（曾误判为 fatigueMax<=0，致 UFO/钻头/猪鲨崽等全部误耗能坠落） */
  private static readonly HOVER_IGNORES_FATIGUE = new Set([7, 8, 12, 23, 44, 49, 56, 61]);
  private hoverIgnoresFatigue(): boolean {
    return MountInstance.HOVER_IGNORES_FATIGUE.has(this.type);
  }

  // ---- 能量/疲劳恢复（Mount.cs :2897-2945） ----
  abilityRecovery(): void {
    if (this.abilityCharging) {
      if (this.abilityCharge < (this.data?.abilityChargeMax ?? 0)) this.abilityCharge++;
    } else if (this.abilityCharge > 0) this.abilityCharge--;
    if (this.abilityCooldown > 0) this.abilityCooldown--;
    if (this.abilityDuration > 0) this.abilityDuration--;
  }

  fatigueRecovery(): void {
    if (this.fatigue > 2) this.fatigue -= 2;
    else this.fatigue = 0;
  }

  // ---- 钻头坐骑（mount 8）能力链（Mount.cs UpdateDrill/UseDrill/UseAbility/AimAbility） ----

  get isDrill(): boolean { return this.active && this.type === 8; }

  /** UpdateDrill（:3000-3021）每 tick 维护：光束冷却衰减（==1 档清目标）、
   *  二极管角向目标角 lerp、全局 beamCooldown 递减 */
  updateDrill(): void {
    for (const b of this.drillBeams) {
      if (b.cooldown > 1) b.cooldown--;
      else if (b.cooldown === 1) { b.cooldown = 0; b.tx = -1; b.ty = -1; }
    }
    this.diodeRotation = this.diodeRotation * 0.85 + 0.15 * this.diodeRotationTarget;
    if (this.drillBeamCooldown > 0) this.drillBeamCooldown--;
  }

  /** AimAbility case 8（:5465-5498）：光标死区外推 → 二极管目标角（取最短旋转路径）。
   *  aimX/aimY = 鼠标世界坐标（本地玩家） */
  aimDrill(centerX: number, centerY: number, aimX: number, aimY: number): boolean {
    const c = clampToDeadZone(centerX, centerY, aimX, aimY,
      DRILL_TEXTURE_SIZE.x, DRILL_TEXTURE_SIZE.y);
    let target = Math.atan2(c.y - centerY, c.x - centerX);
    if (target < 0) target += Math.PI * 2;
    this.diodeRotationTarget = target;
    let cur = this.diodeRotation % (Math.PI * 2);
    if (cur < 0) cur += Math.PI * 2;
    if (cur < target) {
      if (target - cur > Math.PI) cur += Math.PI * 2;
    } else if (cur - target > Math.PI) {
      cur -= Math.PI * 2;
    }
    this.diodeRotation = cur;
    this.crosshairX = aimX;
    this.crosshairY = aimY;
    return true;
  }

  /** UseAbility case 8（:3282-3303）：toggleOn 边沿开激光（原版伴生光标投射物 453，
   *  本仓以 abilityActive 单一真源表达——释放按键即关，见 driveDrill） */
  setDrillActive(on: boolean): void {
    if (!on) {
      this.abilityActive = false;
    } else if (!this.abilityActive) {
      this.abilityActive = true;
    }
  }

  /** UseDrill（:3023-3143）1:1：激光激活 + 按住左键挖块 / 按住右键拆墙。
   *  每 tick 最多 DRILL_BEAMS 束齐射（各自找首个未被锁定的目标格）；
   *  挖掘实效经 hooks 回调（Game 侧接 HitTile 管线） */
  useDrill(p: MountedPlayerView, h: DrillHooks): void {
    if (this.type !== 8 || !this.abilityActive) return;
    const st = p.store as DrillStore | null;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    if (h.useItem && st) {
      for (let i = 0; i < DRILL_BEAMS; i++) {
        if (this.drillBeamCooldown !== 0) break;
        for (const beam of this.drillBeams) {
          if (beam.cooldown !== 0) continue;
          const t = drillBlockTarget(st, cx, cy, this.crosshairX, this.crosshairY, this.drillBeams, h.killTileCtx);
          if (!t) continue;
          beam.tx = t.x; beam.ty = t.y;
          h.pickTile?.(t.x, t.y);
          h.dust?.(t.x * 16 + 8, t.y * 16 + 8, 2, Math.atan2(t.y * 16 + 8 - cy, t.x * 16 + 8 - cx));
          h.smoothSlope?.(t.x, t.y);
          beam.cooldown = DRILL_PICK_TIME;
          beam.purpose = 0;
          break;
        }
      }
    }
    if (!h.useTile || !st) return;
    for (let i = 0; i < DRILL_BEAMS; i++) {
      if (this.drillBeamCooldown !== 0) break;
      for (const beam of this.drillBeams) {
        if (beam.cooldown !== 0) continue;
        const t = drillWallTarget(st, cx, cy, this.crosshairX, this.crosshairY, this.drillBeams);
        if (!t) continue;
        beam.tx = t.x; beam.ty = t.y;
        h.pickWall?.(t.x, t.y);
        h.dust?.(t.x * 16 + 8, t.y * 16 + 8, 2, Math.atan2(t.y * 16 + 8 - cy, t.x * 16 + 8 - cx));
        beam.cooldown = DRILL_PICK_TIME;
        beam.purpose = 1;
        break;
      }
    }
  }

  /** 当前光束目标（渲染层消费：两束激光的终点格） */
  get beams(): readonly DrillBeam[] { return this.drillBeams; }

  // ---- Scutlix Gunner（mount 9）能力链（AimAbility/UseAbility/UpdateEffects case 9） ----

  /** ResetHeadPosition（:5281-5292）：失瞄后眼部帧复位、朝向解锁 */
  resetHeadPosition(): void {
    if (this.aiming) {
      this.aiming = false;
      this.frameExtra = 0;
      this.flipDraw = false;
    }
  }

  /** AimAbility case 9/46（:5338-5418/:5420-5464）1:1：目标点死区外推 → 朝向翻转
   *  （±90° 外换向）+ 背向移动倒放标记。眼部瞄准帧分档（6..10）仅 case 9——
   *  ★case 46 不写 frameExtra（Santank 的 frameExtra 是腿部帧 24-26，由 UpdateFrame
   *  case 46 自驱，此处覆写会破坏瞄准跑姿）。返回帧/朝向是否变化（原版仅联网同步用） */
  aimScutlix(p: MountedPlayerView, aimX: number, aimY: number): boolean {
    this.aiming = true;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const c = clampToDeadZone(cx, cy, aimX, aimY, SCUTLIX_TEXTURE_SIZE.x, SCUTLIX_TEXTURE_SIZE.y);
    const beforeFrame = this.frameExtra;
    const beforeDir = p.facing;
    let deg = Math.atan2(c.y - cy, c.x - cx) * 180 / Math.PI;
    if (deg > 90) { p.facing = -1; deg = 180 - deg; }
    else if (deg < -90) { p.facing = -1; deg = -180 - deg; }
    else { p.facing = 1; }
    this.flipDraw = (p.facing > 0 && p.vx < 0) || (p.facing < 0 && p.vx > 0);
    if (this.type === 9) {
      if (deg >= 0) {
        if (deg < 22.5) this.frameExtra = 8;
        else if (deg < 67.5) this.frameExtra = 9;
        else if (deg < 112.5) this.frameExtra = 10;
      } else if (deg > -22.5) {
        this.frameExtra = 8;
      } else if (deg > -67.5) {
        this.frameExtra = 7;
      } else if (deg > -112.5) {
        this.frameExtra = 6;
      }
    }
    return this.frameExtra !== beforeFrame || p.facing !== beforeDir;
  }

  /** UseAbility case 9（:3223-3254）1:1：眼部双激光。
   *  出生点 = 玩家底心 + 眼偏移（frameExtra 档对应 2 连号）+ 朝向翻转 + 一帧初速前移；
   *  弹速 = 朝目标单位向量 ×14，伤害 150。fire 回调由 Player 侧接投射物桶 */
  fireScutlix(p: MountedPlayerView, aimX: number, aimY: number,
    fire: (x: number, y: number, vx: number, vy: number) => void): void {
    const c = clampToDeadZone(p.x + p.w / 2, p.y + p.h / 2, aimX, aimY,
      SCUTLIX_TEXTURE_SIZE.x, SCUTLIX_TEXTURE_SIZE.y);
    const bottomX = p.x + p.w / 2;
    const bottomY = p.y + p.h;
    const base = (this.frameExtra - SCUTLIX_EYE_FRAME_MIN) * 2;
    const xOff = this.data?.xOffset ?? 0;
    const yOff = this.data?.yOffset ?? 0;
    for (let i = 0; i < 2; i++) {
      const eye = SCUTLIX_EYE_OFFSETS[base + i];
      if (!eye) continue;
      const ex = p.facing === -1 ? bottomX - eye[0] - xOff : bottomX + eye[0] + xOff;
      const ey = bottomY + eye[1] + yOff;
      let dx = c.x - ex, dy = c.y - ey;
      const len = Math.hypot(dx, dy);
      if (len > 0) { dx = dx / len * 14; dy = dy / len * 14; }
      fire(ex + dx, ey + dy, dx, dy);
    }
  }

  /** UpdateEffects case 9/46 索敌-充能-开火主循环（:4875-4954）：
   *  type 9：冷却归零 → 瞄准+停充+双激光（冷却重置 20）；
   *  type 46：冷却 %10==0 节拍开火（:4919-4921）——归零拍先停充（冷却重置 40），
   *           每拍双弹（冷却 ≤10 伴生 930 炮击 + 恒发 14 子弹，见 fireSantank）。
   *  有目标冷却中 → 瞄准+持续充能；无目标 → 停充+头部复位。返回本 tick 是否开火 */
  updateScutlix(p: MountedPlayerView, target: ScutlixTarget | null,
    fire: (x: number, y: number, vx: number, vy: number) => void,
    fireSantank?: (kind: 'cannon' | 'bullet', x: number, y: number, vx: number, vy: number) => void): boolean {
    if (this.type !== 9 && this.type !== 46) return false;
    if (!target) {
      this.abilityCharging = false;
      this.resetHeadPosition();
      return false;
    }
    const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
    const fireTick = this.type === 46 ? this.abilityCooldown % 10 === 0 : this.abilityCooldown === 0;
    if (fireTick) {
      this.aimScutlix(p, tx, ty);
      if (this.abilityCooldown === 0) this.stopAbilityCharge();
      if (this.type === 9) this.fireScutlix(p, tx, ty, fire);
      else this.fireSantank(p, tx, ty, fireSantank);
      return true;
    }
    this.aimScutlix(p, tx, ty);
    this.abilityCharging = true;
    return false;
  }

  /** UseAbility case 46（:3256-3280）1:1：圣诞坦克双炮。
   *  炮击 930（伤 120）：冷却 ≤10 时从身后上方以 (0,-4)±0.1rad 上抛（音 Item_89）；
   *  子弹 14（伤 100）：炮口 = 底心 + (width×dir, -12)，朝死区外推目标 ×12 再 ±0.2rad
   *  扩散（音 Item_11）。音效由 Player 侧 fireSantankShot 接线 */
  fireSantank(p: MountedPlayerView, aimX: number, aimY: number,
    fire?: (kind: 'cannon' | 'bullet', x: number, y: number, vx: number, vy: number) => void): void {
    if (!fire) return;
    if (this.abilityCooldown <= 10) {
      const cx = p.x + p.w / 2 + p.w * -p.facing, cy = p.y + p.h / 2 + 26;
      const ang = -Math.PI / 2 + (Math.random() * 0.2 - 0.1);   // (0,-4) ±0.1 rad
      const spd = 4;
      fire('cannon', cx, cy, Math.cos(ang) * spd, Math.sin(ang) * spd);
    }
    const c = clampToDeadZone(p.x + p.w / 2, p.y + p.h / 2, aimX, aimY,
      SCUTLIX_TEXTURE_SIZE.x, SCUTLIX_TEXTURE_SIZE.y);
    const mx = p.x + p.w / 2 + p.w * p.facing, my = p.y + p.h - 12;
    let dx = c.x - mx, dy = c.y - my;
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx = dx / len * 12; dy = dy / len * 12; }
    const ang2 = Math.atan2(dy, dx) + (Math.random() * 0.4 - 0.2);   // ±0.2 rad 扩散
    const spd2 = Math.hypot(dx, dy);
    fire('bullet', mx, my, Math.cos(ang2) * spd2, Math.sin(ang2) * spd2);
  }

  /** StopAbilityCharge（:2886-2895）：9/46 停充并重置冷却/持续时长 */
  stopAbilityCharge(): void {
    if (this.type === 9 || this.type === 46) {
      this.abilityCharging = false;
      this.abilityCooldown = this.data?.abilityCooldown ?? 0;
      this.abilityDuration = this.data?.abilityDuration ?? 0;
    }
  }

  /** 每 tick 能力维护（Player.fixedUpdate 挂点，对应 Player.cs:25373 UpdateEffects
   *  的能力相关子集）：猪鲨崽计数器/增益旗 + Scutlix/Santank 索敌-充能-开火 +
   *  冲刺族尘/火焰（updateFrame 写入的 dashBurst/dashing 在本 tick 内新鲜）。
   *  在 mount.upkeep 之后调用——hover() 消费的 fishronBoost 在本 tick 内即新鲜 */
  updateMountEffects(p: MountedPlayerView, ctx: MountEffectsCtx): void {
    if (!this.active || this.isCart) return;
    if (this.type === 12) {
      this.updateFishron(ctx.fishron);
    } else {
      this.fishronBoost = false;
    }
    if (this.type === 9 || this.type === 46) {
      const target = scutlixFindTarget(p, ctx.scutlixTargets, ctx.los);
      this.updateScutlix(p, target, ctx.fireScutlixShot ?? (() => { /* 无投射物桶：静默 */ }),
        ctx.fireSantankShot);
    }
    // 冲刺尘（UpdateFrame case 10/47 flag7 :3896-3922）：独角兽 = 176/177/179 任选，
    // 山羊 = 6；山羊地面冲刺另发火焰粒子（下方块）。独角兽追尾尘 = dashing 每
    // tick 盒内 1 粒（:3924-3932，与 burst 环独立链）。★BJ707-G31：蜥蜴 14 移出
    // 本族（旧近似=借 dashDust 发 6 型环,三面全偏）→ 下方 G31 段 1:1 两面
    if ((this.type === 10 || this.type === 47) && (this.dashing || this.dashBurst)) {
      const t: 6 | 176 | 177 | 179 = this.type !== 10
        ? 6
        : ([176, 177, 179] as const)[Math.floor(Math.random() * 3)];
      if (this.dashBurst && ctx.dashDust) {
        ctx.dashDust(p.x + p.w / 2 + p.w * p.facing, p.y + p.h / 2, 14, this.frameExtra, t);
      }
      if (this.type === 10 && this.dashing && ctx.dashDustBody) ctx.dashDustBody(t);
    }
    // ★BJ707-G31（G29 登记债②清偿）:cMount 尘发射面四族 1:1——海盗船 44/惊魂木
    //  45/扫帚 23/蜥蜴 14（发射几何 1457 亲读;ctx.vanillaDust 缺席=测试桩整段
    //  静默跳过;dyeVid=ctx.mountDyeVid()（miscDyes[3] 单源,G29 通道）零掷,
    //  -1=空槽零漂移）。蜥蜴的地板尘回调（cMount==0）不依赖尘池=池外独立门。
    const pool = ctx.vanillaDust;
    const dyeVid = ctx.mountDyeVid?.() ?? -1;
    if (pool) {
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      if (this.type === 44) {
        // 海盗船（UpdateFrame case 44）:环爆发（:3961-3987——20×尘 228,锚=Center+
        //  (width·direction,0),UnitY 旋 i·2π/20+首拍相位 ×0.8,半径 (40,30),速度=
        //  环向量+RunSpeed−sign(|v|),vx>0 翻 X,1/2 半速;rising edge 沿闩触发）+
        //  steady（:3988-4007——num8=(int)RunSpeed−(int)|vx| 钳 ≥1 的 1/num8 掷,
        //  Bottom−(w/2+10,16) 盒 (w+20,22),零速,noLight）。
        if (this.dashBurst) {
          const ax = cx + p.w * p.facing, ay = cy;                     // :3963
          const phase = Math.random() * Math.PI * 2;                    // :3965 num6
          for (let i = 0; i < 20; i++) {                                // :3966
            const ang = i * (Math.PI * 2) / 20 + phase;                 // :3968
            const ux = -Math.sin(ang) * 0.8, uy = Math.cos(ang) * 0.8;  // :3969-3970 UnitY.RotatedBy×0.8
            const du = pool.spawn(ax, ay, 0, 0, 228);                   // :3967（position 后置覆写）
            if (!du) continue;
            du.x = ax + ux * 40; du.y = ay + uy * 30;                   // :3971 ×(40,30)
            du.vx = ux + this.runSpeed() - Math.sign(Math.hypot(p.vx, p.vy));  // :3972
            du.vy = uy;
            if (p.vx > 0) du.vx *= -1;                                  // :3973
            if (Math.random() < 0.5) { du.vx *= 0.5; du.vy *= 0.5; }    // :3974-3975
            du.noGravity = true;                                        // :3976
            du.scale = 1.5 + Math.random() * 0.8;                       // :3977
            du.fadeIn = 0;                                              // :3978
            du.dyeVid = dyeVid;                                         // :3985 shader=cMount
          }
        }
        let num8 = Math.trunc(this.runSpeed()) - Math.trunc(Math.abs(p.vx));  // :3988
        if (num8 <= 0) num8 = 1;                                        // :3990-3991
        if (Math.random() * num8 < 1) {                                 // :3992 Next(num8)==0
          const num10 = Math.trunc(p.w / 2) + 10;                       // :3994
          const du = pool.spawn(cx - num10, p.y + p.h - 16, num10 * 2, 22, 228);  // :3996-3999
          if (du) {
            du.vx = 0; du.vy = 0;                                       // :4000
            du.noGravity = true; du.noLight = true;                     // :4001-4002
            du.scale = 0.25 + Math.random() * 0.8;                      // :4003
            du.fadeIn = 0.5 + Math.random() * 2;                        // :4004
            du.dyeVid = dyeVid;                                         // :4006
          }
        }
      } else if (this.type === 45) {
        // 惊魂木（UpdateFrame case 45）:环爆发（:4022-4054——20×尘 6,与 44 环同构）
        //  + steady（:4055-4071——flag4 每 tick 1 粒,型 SelectRandom(6,6,31)=2/3
        //  尘 6/1/3 尘 31;Center−(6,−6) 盒 12×12,速度=v×0.1;31 支 noGravity+
        //  scale×1.5+fadeIn 0.2 覆写）。
        if (this.dashBurst) {
          const ax = cx + p.w * p.facing, ay = cy;
          const phase = Math.random() * Math.PI * 2;
          for (let i = 0; i < 20; i++) {
            const ang = i * (Math.PI * 2) / 20 + phase;
            const ux = -Math.sin(ang) * 0.8, uy = Math.cos(ang) * 0.8;
            const du = pool.spawn(ax, ay, 0, 0, 6);
            if (!du) continue;
            du.x = ax + ux * 40; du.y = ay + uy * 30;
            du.vx = ux + this.runSpeed() - Math.sign(Math.hypot(p.vx, p.vy));
            du.vy = uy;
            if (p.vx > 0) du.vx *= -1;
            if (Math.random() < 0.5) { du.vx *= 0.5; du.vy *= 0.5; }
            du.noGravity = true;
            du.scale = 1.5 + Math.random() * 0.8;
            du.fadeIn = 0;
            du.dyeVid = dyeVid;                                         // :4046
          }
        }
        if (this.dashing) {                                             // flag4（:4055）
          const t31 = Math.random() < 1 / 3;                            // :4056 SelectRandom(6,6,31)
          const du = pool.spawn(cx - 6, cy + 6, 12, 12, t31 ? 31 : 6);  // :4057-4058
          if (du) {
            du.vx = p.vx * 0.1; du.vy = p.vy * 0.1;                     // :4059
            if (Math.random() < 0.5) du.noGravity = true;               // :4060
            du.scale = 0.7 + Math.random() * 0.8;                       // :4061
            if (Math.random() < 1 / 3) du.fadeIn = 0.1;                 // :4062
            if (t31) { du.noGravity = true; du.scale *= 1.5; du.fadeIn = 0.2; }  // :4063-4066
            du.dyeVid = dyeVid;                                         // :4070
          }
        }
      } else if (this.type === 23) {
        // 扫帚（UpdateEffects case 23 :4870-4915）:挂件星尘两面。挂件位/摆角与
        //  mountLights case 23 同式（GetWitchBroomTrinketOriginOffset/Rotation
        //  :3591-3610——RotatedRelativePoint≈恒等=扫帚族既有口径,登记）。
        const num = Math.max(-1, Math.min(1, p.vx / 10));               // :3592
        const wind = ctx.wind ?? 0;
        const mc = ctx.miscCounter ?? 0;
        let num2 = Math.sin(mc / 300 * Math.PI * 6) * (Math.PI / 4) * Math.abs(wind) * 0.5
          + Math.PI / 4 * -wind * 0.5;                                  // :3600
        num2 *= ctx.windExposed === true ? 1 : 0.5;                     // :3596-3599
        const rot = num * Math.sin(mc / 150 * Math.PI * 6) * (Math.PI / 4) * 0.5
          + num * (Math.PI / 4) * 0.5 + num2;                           // :3603
        const trx = cx + 29 * p.facing + Math.cos(rot + Math.PI / 2) * 11;  // :4871+(3607)×11
        const try_ = cy - 4 + Math.sin(rot + Math.PI / 2) * 11;
        // spark 面（:4877-4889）:1/45 掷;NextVector2Circular(4,4) 偏移 + 尘 43
        //  perfect（α254/黄(255,255,0)/0.3）;非零偏移→径向外向 0.2;
        //  customData=mountedPlayer → followPlayer（dust43 :1513-1517 旧位跟随）
        if (Math.random() < 1 / 45) {                                   // :4877 Next(45)==0
          const v12 = nextVector2Circular(Math.random, 4, 4);           // :4878
          const du = pool.spawn(trx + v12.x, try_ + v12.y, 0, 0, 43, 0, 0, 254,
            { r: 255, g: 255, b: 0, a: 255 }, 0.3, { perfect: true });  // :4879
          if (du) {
            if (v12.x !== 0 || v12.y !== 0) {                           // :4880-4883
              const dl = Math.hypot(v12.x, v12.y);                      // DirectionTo=偏移向量归一
              du.vx = v12.x / dl * 0.2;
              du.vy = v12.y / dl * 0.2;
            }
            du.fadeIn = 0.3;                                            // :4884
            du.noLightEmittance = true;                                 // :4885
            du.followPlayer = true;                                     // :4886 customData=mountedPlayer
            du.dyeVid = dyeVid;                                         // :4888 shader=cMount
          }
        }
        // swirl 面（:4890-4915）:num13=0.1+|v|/30 掷门（pos4 抖动掷先于门=原序）
        //  → 环 8 点（num15∈{0,0.125..0.875}）各 1/15 掷;椭圆 (0.5,1)×4 旋
        //  fullRotation,尘 43 perfect;速度 = 环向量×0.025 + pos5 指向×0.5
        //  （pos4=Center+(18−20·r·dir,12) 掷点;pos5=Center+(52·dir,−6)）。
        const num13 = 0.1 + Math.hypot(p.vx, p.vy) / 30;                // :4890-4891
        const p4x = cx + 18 - 20 * Math.random() * p.facing;            // :4892
        const p5x = cx + 52 * p.facing, p5y = cy - 6;                   // :4893
        if (Math.random() <= num13) {                                   // :4897 NextFloat()<=num13
          const num14 = Math.random();                                  // :4899
          for (let num15 = 0; num15 < 1; num15 += 0.125) {              // :4900
            if (Math.random() >= 1 / 15) continue;                      // :4901 Next(15)==0
            const a = Math.PI * 2 * num15 + num14;                      // :4903
            const sx = Math.cos(a) * 0.5 * 4, sy = Math.sin(a) * 1 * 4; // :4903-4904 ×(0.5,1)×4
            const fr = this.fullRotation;                               // :4905 RotatedBy(fullRotation)
            const rx = sx * Math.cos(fr) - sy * Math.sin(fr);
            const ry = sx * Math.sin(fr) + sy * Math.cos(fr);
            const dx = p4x + rx, dy = (cy + 12) + ry;                   // pos4+spinning
            const du = pool.spawn(dx, dy, 0, 0, 43, 0, 0, 254,
              { r: 255, g: 255, b: 0, a: 255 }, 0.3, { perfect: true });  // :4906
            if (!du) continue;
            const ddx = dx - p5x, ddy = dy - p5y;                       // :4907 pos5.DirectionTo
            const dl2 = Math.hypot(ddx, ddy) || 1;                      // SafeNormalize(Zero)
            du.vx = rx * 0.025 + ddx / dl2 * 0.5;
            du.vy = ry * 0.025 + ddy / dl2 * 0.5;
            du.fadeIn = 0.3;                                            // :4908
            du.noLightEmittance = true;                                 // :4909
            du.dyeVid = dyeVid;                                         // :4912 shader=cMount
          }
        }
      } else if (this.type === 14) {
        // 蜥蜴（UpdateFrame case 14）:面 1（:4129-4149——num(=dashing) ∧ vy==0）=
        //  2×尘 31 底盒（BottomLeft (w,6) 盒,速度=(vx×0.15, r×−2),noLight）+
        //  cMount==0 时 ±24 移位 FloorVisuals(Falling)（地板尘 20 连发,
        //  ctx.basiliskFloorDust 承载——池外独立门,makeFloorDust 自查尘池）;
        //  面 2（:4150-4169——sign(vx)==facing,0≠±1=静止/背向都不发）=
        //  floor(3×charge)×尘 6 蓄能环:位=Center+(dir×38, 6+r×12),速度=向锚
        //  (dir×40,12) 归一 ×(3.5+r×0.5) → vy<0 再 ×(1+2r) → +v×0.55 →
        //  ×|v|/RunSpeed → ×charge;noGravity/noLight。
        //  ★旧近似（借 dashDust 发 6 型 14 粒环,spread=0——尘型/计数/几何三面
        //  全偏）本刀退役。
        const num2 = Math.sign(p.vx);                                   // :4113
        if (this.dashing && p.vy === 0) {                               // :4129
          for (let i = 0; i < 2; i++) {                                 // :4131
            const du = pool.spawn(p.x, p.y + p.h, p.w, 6, 31);          // :4132 BottomLeft(w,6)
            if (!du) continue;
            du.vx = p.vx * 0.15;                                        // :4133
            du.vy = Math.random() * -2;                                 // :4134
            du.noLight = true;                                          // :4135
            du.scale = 0.5 + Math.random() * 0.8;                       // :4136
            du.fadeIn = 0.5 + Math.random() * 1;                        // :4137
            du.dyeVid = dyeVid;                                         // :4138 shader=cMount
          }
          if (dyeVid <= 0) ctx.basiliskFloorDust?.(num2 * 24);          // :4140-4148 cMount==0
        }
        if (num2 === p.facing) {                                        // :4150
          const n = Math.trunc(3 * this.basiliskCharge);                // :4151 (int)(3f×charge)
          const aX = cx + num2 * 40, aY = cy + 12;                      // :4153 锚(num3=12,num4=40)
          for (let j = 0; j < n; j++) {
            const du = pool.spawn(p.x, p.y + p.h, p.w, 6, 6);           // :4152（position 后置覆写）
            if (!du) continue;
            const dx = cx + num2 * 38, dy = cy + 12 - 6 + Math.random() * 12;  // :4154
            du.x = dx; du.y = dy;
            let dvx = dx - aX, dvy = dy - aY;                           // :4155 (pos−锚)归一×速
            const dl = Math.hypot(dvx, dvy) || 1;                       // SafeNormalize(Zero)
            const spd = 3.5 + Math.random() * 0.5;                      // :4155
            dvx = dvx / dl * spd; dvy = dvy / dl * spd;
            if (dvy < 0) dvy *= 1 + 2 * Math.random();                  // :4156-4157
            dvx += p.vx * 0.55; dvy += p.vy * 0.55;                     // :4158
            const vr = Math.hypot(p.vx, p.vy) / this.runSpeed();        // :4159 ×|v|/RunSpeed
            dvx *= vr * this.basiliskCharge; dvy *= vr * this.basiliskCharge;  // :4160 ×charge
            du.vx = dvx; du.vy = dvy;
            du.noGravity = true;                                        // :4161
            du.noLight = true;                                          // :4162
            du.scale = 0.5 + Math.random() * 0.8;                       // :4163
            du.fadeIn = 0.5 + Math.random() * 1;                        // :4164
            du.dyeVid = dyeVid;                                         // :4168 shader=cMount
          }
        }
      }
    }
    if (this.type === 47 && this.dashing && p.vy === 0 && ctx.goatFlames && p.store) {
      // :3885-3896：落脚格 = (Center.X/16, (Y+H-1)/16)+1 须 active 且无液体且
      // SolidTileAllowBottomSlope（平台/顶坡放行，半砖/致动不放行）才发火焰编排器。
      // 火焰出生点 = (tx×16+8, ty×16+16)——旧实现漏 +16 纵向偏移（已对齐）
      const tx = Math.trunc((p.x + p.w / 2) / TILE);
      const ty = Math.trunc((p.y + p.h - 1) / TILE) + 1;
      const st = p.store;
      if (st.inBounds(tx, ty) && st.flags[st.idx(tx, ty)]
        && !(st as unknown as { liquid?: ArrayLike<number> }).liquid?.[st.idx(tx, ty)]
        && solidTileAllowBottomSlopeAt(st as unknown as SolidTileView, tx, ty)) {
        ctx.goatFlames(tx * TILE + 8, ty * TILE + TILE);
      }
    }
    if (this.type === 17 && this.wheelDust && ctx.wheelDust) {
      // ★SW-FX18 高尔夫球车轮尘（UpdateFrame_GolfCart :4661-4662）：两轮位 =
      // Bottom ± 20px（direction*∓20 两支并集,Entity.Bottom = (x+w/2, y+h)），
      // 每轮 1/5 掷（EmitGolfCartWheelDust :4712 Next(5)!=0 早退）。踢向 = −direction
      // （:4727 velocity += (−direction, −gravDir)）；实心地面门（:4720 SolidTile）
      // 与发粒面在消费侧——KillTile_MakeTileDust 尘族按 breakTile 惯例走 mapColor
      // 粒子制（登记,本仓 dust 表无 per-tile 破坏尘）
      for (const off of [-20, 20]) {
        if (Math.random() >= 1 / 5) continue;      // :4712 Next(5)!=0 → return
        ctx.wheelDust(p.x + p.w / 2 + off, p.y + p.h, -p.facing);
      }
    }
    if (this.type === 61 && ctx.pixieTrailDust) {
      // ★BJ357 仙灵武库拖尾辉尘（Mount.cs UpdateEffects case 61 :5203-5224 1:1）：
      // 偶数视效拍（:5205 timeForVisualEffects%2==0）且（1/15 旗 :5204 或
      // Next(6)+1<|v| :5206）才发；色 = hsl(0.91,1,0.7) 基色二档 lerpToWhite 0.45/0
      // 后 Color.Lerp 随机插值（:5207-5209,通名支=dev 名分色表不建模,同 mountLights
      // 登记）;位 = Center+(0,-2)+v×0.7+随机圆×r×2（:5209-5221）;速度 = 出尘抖动
      // ×(flag?0.4:0.04|v|)+v×0.3（:5213-5219）;尘 278 α200 scale0.65 noGravity noLight
      if (((ctx.miscCounter ?? 0) % 2 + 2) % 2 !== 0) return;
      const flag = Math.floor(Math.random() * 15) === 0;            // :5204 Next(15)==0
      const spd = Math.hypot(p.vx, p.vy);
      if (!flag && Math.floor(Math.random() * 6) + 1 >= spd) return; // :5206
      const base = fairyQueenHslToRgb((0.41 + 0.5) % 1);            // hueRaw 0.41（:5207）
      const lum07 = base.map((c) => c + (255 - c) * 0.4);           // luminance 0.7 = lerp(base,white,0.4)
      const c1 = lum07.map((c) => c + (255 - c) * 0.45);            // lerpToWhite 0.45（:5207）
      const t = Math.random();                                      // :5209 Lerp 随机插值
      const mix = (i: number): number => Math.round(c1[i] + (lum07[i] - c1[i]) * t);
      const ang = Math.random() * Math.PI * 2;                      // :5220 随机圆
      const rad = Math.random() * 2;                                // :5221 ×r×2
      ctx.pixieTrailDust({
        x: p.x + p.w / 2 + p.vx * 0.7 + Math.cos(ang) * rad,        // :5209/:5221/:5222
        y: p.y + p.h / 2 - 2 + p.vy * 0.7 + Math.sin(ang) * rad,    // :5210 Center+(0,-2)
        mul: flag ? 0.4 : 0.04 * spd,                               // :5214/:5217-5218
        pvx: p.vx, pvy: p.vy,                                       // :5219 += v×0.3
        color: { r: mix(0), g: mix(1), b: mix(2), a: 255 },
      });
    }
  }

  /** 非悬停飞行坐骑的能量消费（Flight :2937：flyTime 递减，耗尽返回 false） */
  flight(): boolean {
    if (this.flyTime <= 0) return false;
    this.flyTime--;
    return true;
  }

  resetFlightTime(p: MountedPlayerView): void {
    const d = this.data;
    this.flyTime = this.active ? d?.flightTimeMax ?? 0 : 0;
    // 驯鹿：落地瞬间按水平速度续飞（:5267 flyTime += |vx|*20）
    if (this.type === 0) this.flyTime += Math.trunc(Math.abs(p.vx) * 20);
    // ★BJ703-D1 迅猛龙（ResetFlightTime :5328-5331）：_flyTime = 玩家 wingTimeMax
    //  （读 live 字段——无翼 0 → 地面回充亦 0 = 永不飞,闩 allowedToFly 亦假）。
    if (this.type === 54) this.flyTime = p.wingTimeMax ?? 0;
  }

  /** ★BJ703-D1 Mount.UpdateAfterEquips（:2995-3009）的 54 臂 1:1（55 爬墙族臂未实装
   *  =既有登记债,见「55 爬墙族走 UpdateAfterEquips 未实装」注）。调用位=
   *  Player.UpdateEquips 尾（:13198）→ 本仓挂 Player.fixedUpdate 坐骑维护段 upkeep
   *  前（同拍先于 resetFlightTime/帧态机）。
   *  · allowedToFly = wingsLogic>0——原版读的是【坐骑清翼（Player.cs:26834 骑
   *    !CanUseWings 族清零,54 属之）之前】的 wingsLogic,故第一参传功能翼槽原值
   *    （本仓 eq.wing.logic,勿传清零后的飞行链局部量）;
   *  · 翱翔徽章 4989（empressBrooch）∧ 闩真 → flyTime 回满 wingTimeMax（:3006-3008
   *    ——空中每拍回满 = 无限飞,与翼链 :22419-22422 回满同源语义）。 */
  updateAfterEquips(wingsLogic: number, wingTimeMax: number, empressBrooch: boolean): void {
    if (!this.active || this.type !== 54) return;
    this.allowedToFly = wingsLogic > 0;
    if (this.allowedToFly && empressBrooch) this.flyTime = wingTimeMax;
  }

  // ---- 悬停物理（Mount.cs Hover :3310-3466 主体 1:1） ----
  /** ★BJ704-G5（G4-②）gravityField=当拍重力场（Player.gravity :24884 终值）：疲劳
   *  累积率 num2=gravity/defaultGravity（:3378-3386,slowFall ÷3/下钳 0.25）、非飞行
   *  帧态臂 :3502 `vy += gravity*gravDir` 消费——旧常数 1/DEFAULT_GRAVITY 干湿同盲
   *  （湿 0.2 档疲劳率应为 0.5、太空带下钳 0.25）。调用位（Player 干/湿坐骑链）传
   *  当拍 fresh 值；缺省 DEFAULT_GRAVITY（合成视图=地表干档,旧行为）。 */
  hover(p: MountedPlayerView, gravityField = DEFAULT_GRAVITY): boolean {
    const d = this.data;
    if (!d) return false;
    const noFatigue = this.hoverIgnoresFatigue();
    // 悬停生效帧态（:3313-3332）：默认空中/游泳；熔岩鲨限游泳；56/61 蝙蝠/精灵族含飞行
    let flyingState = this.frameState === FRAME_IN_AIR || this.frameState === FRAME_SWIMMING;
    if (this.type === 49) flyingState = this.frameState === FRAME_SWIMMING;
    if (this.type === 56) {
      // 蝙蝠仅空中/飞行帧态（:3366-3369 `_type == 56 → 2||3`——游泳 4 不入;56 湿拍
      // 即下坐,水下臂本就一拍性）
      flyingState = this.frameState === FRAME_IN_AIR || this.frameState === FRAME_FLYING;
    } else if (this.type === 61) {
      // ★BJ704-G4（BJ703-D2b 清偿）：仙灵武库 61 【含游泳帧态 4】（Hover :3370-3373
      //   `_type == 61 → flag2 = state==2||3||4`——与 56 分立,旧 56∨61 合写漏 4 →
      //   水下帧态=SWIMMING 不入悬停面,坐骑湿支 vy 链（Player.ts 湿段）形同虚设）
      flyingState = this.frameState === FRAME_IN_AIR || this.frameState === FRAME_FLYING
        || this.frameState === FRAME_SWIMMING;
    }
    if (flyingState) {
      let canLift = true;
      let mult = 1;
      // 猪鲨崽非增益态减半（:3354 `if (_type == 12 && !mountedPlayer.MountFishronSpecial) num = 0.5f`）——
      // 增益态 = 湿身/半血以下/雨中露天（见 fishronSpecial），湿身是【全额】而非减半
      if (this.type === 12 && !this.fishronBoost) mult = 0.5;
      // ★BJ704-G5（G4-②）疲劳累积率 num2（:3377-3386）：gravity/defaultGravity，
      //   slowFall ÷3（:3379-3381——vy 链的重力 /3 尚未跑,Hover 内显式折算）、下钳
      //   0.25（:3383-3385）。旧常数 1=干档地表值,湿 0.2/太空带 0.25/蜜 0.1 档全偏。
      let fatigueRate = gravityField / DEFAULT_GRAVITY;
      if (p.slowFall) fatigueRate /= 3;
      if (fatigueRate < 0.25) fatigueRate = 0.25;
      const fatigueRatio = noFatigue ? 0 : this.fatigueMax > 0 ? this.fatigue / this.fatigueMax : 0;
      // 能量池：先吃 flyTime，尽后累积疲劳，疲劳满则失去升力（:3322-3342）
      if (!noFatigue) {
        if (this.flyTime > 0) this.flyTime--;
        else if (this.fatigue < this.fatigueMax) this.fatigue += fatigueRate;
        else canLift = false;
      }
      let vMin = 4 * fatigueRatio;
      let vMax = 4 * fatigueRatio;
      // ★BJ704-G12（G5 登记债6）：48 黑魔书特例臂（:3411-3431）——vanilla 48
      //   fatigueMax=0（mounts[48] 无赋值）⇒ num3=_fatigue/_fatigueMax=0/0=NaN,
      //   48 臂显式归零 num4/num5 再走下方 -0.001 替换;flag4=false（升力输入门
      //   输入无关禁用——(controlUp||controlJump) 臂 48 恒不可达,仓旧 canLift 门
      //   反向=能量窗 320t 内 inputUp/inputJump 可爬升,vanilla 恒静置带）;
      //   耗尽拍（!flag3=canLift 假）flag5=true → 重力驱动臂（else-if 链第三支
      //   :3463-3468 `vy += gravity×gravDir; num5=4`——48 fatigueMax 0=首个空中拍
      //   即耗尽（flyTime 320 尽后 canLift 恒假）,重力 0.4>acceleration 0.2 净
      //   +0.2/t 无界加速坠落,vanilla 同构）;controlDown → num5=8（特例臂内置,
      //   与 else-if 降臂同值双写）。
      let gravFall = false;   // flag5（仅 48 置位）
      if (this.type === 48) {
        vMin = 0;
        vMax = 0;
        if (!canLift) gravFall = true;
        if (p.inputDown) vMax = 8;
      }
      if (vMin === 0) vMin = -0.001;
      if (vMax === 0) vMax = -0.001;
      let vy = p.vy;
      // 升降输入（:3396-3424——48 flag4=false：升力臂恒不可达,仅 ↓/重力臂可达）
      if (this.type !== 48 && (p.inputUp || p.inputJump) && canLift) {
        vMin = -2 - 6 * (1 - fatigueRatio);
        if (this.type === 56 || this.type === 61) vMin = -d.dashSpeed!;
        vy -= d.acceleration * mult;
      } else if (p.inputDown) {
        vMax = 8;
        if (this.type === 56 || this.type === 61) vMax = d.dashSpeed!;
        vy += d.acceleration * mult;
      } else if (gravFall) {
        // :3463-3468 48 耗尽重力臂（vy += gravity×gravDir + 带 4）——重力场感知
        // 同 G4-②（当拍 gravityField 参,湿/太空带档同步）。
        vy += gravityField * p.gravDir;
        vMax = 4;
      }
      // 钳位带（:3426-3436：超带按 acceleration 回拉）
      if (vy < vMin) {
        vy = (vMin - vy < d.acceleration) ? vMin : vy + d.acceleration * mult;
      } else if (vy > vMax) {
        vy = (vy - vMax < d.acceleration) ? vMax : vy - d.acceleration * mult;
      }
      if (this.type === 56 || this.type === 61) {
        if (vMin !== -0.001) vy = Math.max(vy, vMin);
        if (vMax !== -0.001) vy = Math.min(vy, vMax);
      }
      p.vy = vy;
      // 悬停静置防漂（:3446-3450）：三值全 -0.001（无升降输入的免疲劳静置）时
      // position.Y -= -0.001（下移 0.001 抵消 vy=-0.001 的上漂）；随后的
      // TryStabilizingSmallMountPositionBetweenSlopes（坡面静置贴合）由本仓
      // slopeCollide 常规贴合承担（登记）
      if (vMin === -0.001 && vMax === -0.001 && vy === -0.001) p.y += 0.001;
    } else if (!noFatigue) {
      // 非悬停帧态：正常重力（:3502 `vy += gravity * gravDir`——★BJ704-G5（G4-②）
      //   重力场感知：旧 DEFAULT_GRAVITY 常数,湿/太空带档偏重 2-4×）
      p.vy += gravityField * p.gravDir;
    } else if (p.vy === 0) {
      // 免疲劳档贴地段（:3440-3451，UFO 7/钻头 8/猪鲨崽 12 等静置在地面时）：
      // TileCollision(UnitY×gravDir) 探针残量≠0 = 下方悬空（或按下）→ vy=0.001
      // 起落——下一 tick vy≠0 → frameState 切 IN_AIR → 悬停控制接管。★此分支
      // 曾整段缺失：贴地 vy 恒 0 → 永不失稳入空中态 → 跳跃门(onGround 由落地
      // 碰撞置位，vy=0 无 Y 位移恒不置)全灭 = 钻头地底无法升/降只能横移（用户实报）
      if (!groundBelowProbe(p) || p.inputDown) p.vy = 0.001;
    } else if (p.vy === -0.001) {
      p.vy -= -0.001;   // :3452-3456 字面（-0.001 - (-0.001) = 0）
    }
    return true;
  }

  /** 起跳瞬间向上的 hover 触发（Player.cs:26939：vy==0 且 CanHover 且 controlUp
   *  且 releaseUp 边沿）。★BJ704-G15（G13 登记债④,本刀修）：边沿通道换 ↑ 键
   *  专属沿（upEdgePrev）——原版 releaseUp 由 UpdateControlHolds :29319-29327
   *  （`controlUp ? false : true`,移动段【后】刷新）承载,:26939 读的是上拍尾值
   *  ⇒ 语义 = ↑ 键（W）上升沿。旧读 `!jumpEdgePrev`（Space∪Up 合成跳键的上拍
   *  电平——仓内 inputJump=Space∪Up,Game.ts 输入合成）：持 Space 中按 W 时合成
   *  键上拍已真=不触发（vanilla 触发）——键面分叉面。CCed 清输入 (:25432-42 →
   *  仓 :6107) 在尾快照【前】=冻结拍 upEdgePrev=false,解冻持 W 即沿（vanilla
   *  同相:冻结拍 controlUp 清零 → releaseUp 刷新真）。
   *  ★BJ704-G5（G4-②）冲量 :26941 `-(Acceleration + gravity + 0.001)` 读 gravity
   *  字段（原版 Update 头已算,本拍 fresh）——本调用位（upkeep,物理相前）仓内字段
   *  尚未写,p.gravityField=上拍链尾值;旧 DEFAULT_GRAVITY 常数同族偏重。
   *  ★BJ704-G12（G5 登记债8 复核=销案）：「跨 num6 带迁移拍一拍滞后」结构性
   *  不可达——触发门 vy==0 ⇒ 上拍末碰撞清零=y 稳定 ⇒ num6 带不变 ⇒ 上拍 gField
   *  ≙ 当拍 fresh 值（G5 判语成立,不修）。
   *  ★BJ704-G13（G12 残余窄面定谳=真债,前刀修）：慢Fall 签名改写（干支尾部
   *  gField/3|/10×gravDir,vanilla :27228/:27232 在 :26941【之后】跑=原版读不到）
   *  的复合边例【可达】——Game.fixedUpdate 序=player.fixedUpdate(:10541) 先于
   *  updateUse(:11181):上拍未骑乘∧slowFall∧干支贴地（改写落 gField=/3×gd）→
   *  同拍 updateUse 召唤悬停坐骑 → 次拍 upkeep 本触发（canHover 无帧态门,新召唤
   *  即真）读带符号 /3 陈值（冲量差 0.4×num6×2/3 px/t）。修=无符号并行快照
   *  gravityFieldFresh（Player.gFieldUnsigned,干/湿支终值同拍写,不掺尾部改写）
   *  ——≙ 原版次拍 :24559 头部重算链值。 */
  tryStartHover(p: MountedPlayerView): void {
    if (p.vy === 0 && this.canHover(p) && p.inputUp && !p.upEdgePrev) {
      p.vy = -(this.acceleration + (p.gravityFieldFresh ?? p.gravityField ?? DEFAULT_GRAVITY) + 0.001);
    }
  }

  /** 退出飞行帧态探测（Mount.cs TryBeginningFlight :4509-4528） */
  tryBeginningFlight(p: MountedPlayerView, state: number): void {
    if (this.frameState === state || (state !== FRAME_IN_AIR && state !== FRAME_FLYING)
      || !this.canHover(p) || p.inputUp || p.inputDown || p.inputJump) return;
    const st = p.store;
    if (!st) return;
    const ty = Math.floor((p.y + p.h + 1) / 16);
    let blocked = false;
    for (let tx = Math.floor(p.x / 16); tx <= Math.floor((p.x + p.w - 1) / 16); tx++) {
      if (st.inBounds(tx, ty) && st.flags[st.idx(tx, ty)] && st.isSolid(tx, ty)) { blocked = true; break; }
    }
    if (blocked && this.hoverIgnoresFatigue()) p.y -= 0.001;
  }

  /** 落地帧态探测（Mount.cs TryLanding :4602-4611：无升降输入且下方 4px 内有地面
   *  → 切地面帧。★条件曾写反（无地面才切）——悬停静置在空中被误切地面帧态,
   *  hover() 的 flyingState 门随之隔 tick 失效（悬停控制断续） */
  tryLanding(p: MountedPlayerView): void {
    if ((this.frameState === FRAME_FLYING || this.frameState === FRAME_IN_AIR)
      && !p.inputUp && !p.inputDown && !p.inputJump) {
      const st = p.store;
      if (!st) return;
      const ty = Math.floor((p.y + p.h + 4) / 16);
      let grounded = false;
      for (let tx = Math.floor(p.x / 16); tx <= Math.floor((p.x + p.w - 1) / 16); tx++) {
        if (st.inBounds(tx, ty) && st.flags[st.idx(tx, ty)] && st.isSolid(tx, ty)) { grounded = true; break; }
      }
      if (grounded) this.updateFrame(p, this.intendedGroundedFrame(p), p.vx, p.vy);
    }
  }

  /** 地面帧态意图（Mount.cs GetIntendedGroundedFrame :4529-4543） */
  intendedGroundedFrame(p: MountedPlayerView): number {
    const still = p.vx === 0;
    if (still) return FRAME_STANDING;
    return FRAME_RUNNING;
  }

  // ---- 帧状态机（Mount.cs UpdateFrame :3563-4490 的通用路径 + 常用族特例） ----
  updateFrame(p: MountedPlayerView, state: number, vx: number, vy: number): void {
    const d = this.data;
    if (!d) return;
    // ★BJ704-G13（G12 登记债4）：帧态切换的计数复位策略 1:1（Mount.cs:3613-3640）——
    //   ① 56 蝙蝠冲刺沿复位（:3615-3618）：进出 dash 态（frameState==5 与
    //   `dash>0∧dashDelay<0` 真值不一致）时清 _frameCounter;
    //   ② 复位抑制（:3620-3640）：48 暗黑魔法书入 1/2、56 入 1/4/2、61 入 1/4/2、
    //   55 入 1/5/4（∧state==2 须 sliding）不清 _frameCounter=地面↔空中切换动画
    //   相位连续（旧无条件清零=变身骑族态切换动画跳回组首帧）。判据读【分派态】
    //   （:3613 先于 :3667 switch(_type) 的组覆写——48 的 state=1 强改在抑制判定后）。
    if (this.frameState !== state) {
      const dashing56 = (p.dash ?? 0) > 0 && (p.dashDelay ?? 0) < 0;
      if (this.type === 56 && ((this.frameState === FRAME_DASHING && !dashing56)
        || (this.frameState !== FRAME_DASHING && dashing56))) {
        this.frameCounter = 0;                          // :3615-3618
      }
      this.frameState = state;
      let resetCounter = true;
      if (this.type === 48 && (state === FRAME_RUNNING || state === FRAME_IN_AIR)) resetCounter = false;
      if (this.type === 56 && (state === FRAME_RUNNING || state === FRAME_SWIMMING || state === FRAME_IN_AIR)) resetCounter = false;
      if (this.type === 61 && (state === FRAME_RUNNING || state === FRAME_SWIMMING || state === FRAME_IN_AIR)) resetCounter = false;
      if (this.type === 55 && (state === FRAME_RUNNING || state === FRAME_DASHING || state === FRAME_SWIMMING
        || (state === FRAME_IN_AIR && (p.sliding ?? false)))) resetCounter = false;
      if (resetCounter) this.frameCounter = 0;          // :3637-3640
    }
    if (state !== FRAME_STANDING) this.idleTime = 0;
    // 离地行走宽限（:3599-3607）
    if (vy === 0) this.walkingGraceTime = d.walkingGraceTimeMax ?? 0;
    else if (this.walkingGraceTime > 0) this.walkingGraceTime--;
    if (p.inputDown && p.vy > 0) this.walkingGraceTime = 0;

    // ---- 每坐骑特例段（Mount.cs UpdateFrame 首个 switch(_type) :3619-4130） ----
    switch (this.type) {
      case 7:
        // UFO 帧组恒取空中组（:3688 case 7: state = 2）——frameState 本身不变
        state = FRAME_IN_AIR;
        break;
      case 48:
        // ★BJ704-G13（G12 登记债4）：暗黑魔法书（:4073-4075 case 48: `state = 1`）
        //  ——动画组【恒走跑动组】（分派态 0/2/4 一律覆写为 1,纯动画面:帧态字段
        //  不受扰（vanilla 只改局部 state）,canHover 飞行门 :3361 消费 frameState
        //  照旧;与 case 7 同款「组覆写不改 frameState」形状）。跑动组速率 48 特例
        //  Max(0.5,|v|×0.125)（下方 FRAME_RUNNING 臂既有,:4310-4312）——静止也以
        //  0.5/t 半速循环（原版同构,书页翻动动画）。
        state = FRAME_RUNNING;
        break;
      case 49: {
        // ★BJ704-G5（G4-③）熔岩鲨（UpdateFrame case 49 :3732-3746）：wet（任意液体,
        //   含岩浆/蜜/微光）时无论分派态强切游泳帧 4——贴地/起跳拍也悬停（canHover
        //   49=帧态==4）;倾转 fullRotation=vy×0.05×朝向（:3742-3744,updateBodyRotation
        //   bodyRotationFor 承接）。vanilla `_frameState = (state = 4)` 直赋不重置帧计数。
        if (state !== FRAME_SWIMMING && (p.wet ?? p.inWater)) {
          state = FRAME_SWIMMING;
          this.frameState = FRAME_SWIMMING;
        }
        break;
      }
      case 61:
        // ★BJ704-G15（G13 登记债⑤）：仙灵武库帧态强切臂（Mount.cs:3669-3678 case 61——
        //   61 的 AddLight :3670-3673 已在 mountLights case 61 承载,此处仅帧态面）：
        //   分派态 4（游泳）→ frameState/state=2（空中）。★写 frameState 字段（非 case
        //   7/48 的纯组覆写）——但 61 悬停门 2/3/4 全域内=悬停零行为差,纯帧态归一
        //   （消费面=tryBeginningFlight/tryLanding 的 FLYING/IN_AIR 判据从「4 不匹配」
        //   归位「2 匹配」）。61 帧 0-3 全组同段（swim/inAir 同 start/delay）=动画零差,
        //   与 G13 落地的「61 入 4 不清计数」抑制协同（次拍分派 4 再入,抑制照常不清）。
        if (state === FRAME_SWIMMING) { this.frameState = FRAME_IN_AIR; state = FRAME_IN_AIR; }
        break;
      case 55:
        // ★BJ704-G15（G13 登记债⑤）：老鼠坐骑帧态强切臂（Mount.cs:3680-3697）：
        //   ①sliding（=wallCling 爬墙中,view 承载）→ 1 跑动组（爬墙显跑动帧）;
        //   ②分派 4（游泳）→ 2;③分派 1/5 且 |vx|>4 → 5 冲刺组（分派域无 5=case 5
        //   死支同形保留,1 支即全效）。写 frameState 字段——55 非 usesHover,消费面
        //   仅动画组选择+复位抑制判定。p.sliding 读上拍值（upkeep 先于移动相,与 G13
        //   抑制臂同承载=1 tick 滞后等价登记）。
        if (p.sliding) { this.frameState = FRAME_RUNNING; state = FRAME_RUNNING; break; }
        if (state === FRAME_SWIMMING) { this.frameState = FRAME_IN_AIR; state = FRAME_IN_AIR; }
        else if ((state === FRAME_RUNNING || state === FRAME_DASHING) && Math.abs(vx) > 4) {
          this.frameState = FRAME_DASHING; state = FRAME_DASHING;
        }
        break;
      case 56:
        // ★BJ704-G15（G13 登记债⑤）：蝙蝠坐骑帧态强切臂（Mount.cs:3698-3706）：
        //   dash>0∧dashDelay<0 → 5（冲刺帧组 9-14）;其余分派非 0/1（2/3/4）→ 2。
        //   悬停门 56 臂 2/3——3→2 域内迁移零行为差;56 帧 1-8 全组同段=动画零差,
        //   归一面=tryBeginningFlight/tryLanding 判据（同 61 注）。与 G13 的 56 冲刺沿
        //   复位（:3615-3618 抑制块）协同：dash 沿进出 5 清计数,本臂归一不清。
        if ((p.dash ?? 0) > 0 && (p.dashDelay ?? 0) < 0) { this.frameState = FRAME_DASHING; state = FRAME_DASHING; }
        else if (state !== FRAME_STANDING && state !== FRAME_RUNNING) { this.frameState = FRAME_IN_AIR; state = FRAME_IN_AIR; }
        break;
      case 52:
        // ★BJ704-G16（G15 登记债②）：狼坐骑局部态改写（Mount.cs:3710-3712 case 52
        //   `if (state == 4) state = 2`——纯组覆写,不写 _frameState,与 case 7/48 同形）。
        //   分派态 4（湿/游泳,Player.cs:36487）→ 帧组取空中组。狼的 swim/inAir 组
        //   同段（vanilla-mounts.json 52: start 12/count 3/delay 12 全等）=帧域零差,
        //   唯一行为面=推进速率:游泳组 trunc((|vx|+|vy|)/2)（慢速泳姿冻结）vs 空中组
        //   恒 1/tick——液体中狼显空中组推进节律。frameState 留 4（原版字面;狼非
        //   usesHover/无 runSpeed 游泳特例=无行为消费面）。
        if (state === FRAME_SWIMMING) state = FRAME_IN_AIR;
        break;
      case 9:
        // Scutlix 眼部待机动画（:3715-3730）：非瞄准时 0-5 帧 @12 循环；瞄准中由
        // aimScutlix 直接驱动 frameExtra（6-10 档），此处跳过
        if (this.aiming) break;
        this.frameExtraCounter += 1;
        if (this.frameExtraCounter >= 12) {
          this.frameExtraCounter = 0;
          this.frameExtra++;
          if (this.frameExtra >= SCUTLIX_EYE_FRAME_MIN) this.frameExtra = 0;
        }
        break;
      case 46:
        // 圣诞坦克腿部副帧（:3731-3774）：非站立态一律按跑动；待机 12 / 行走 12-23
        // 随 |vx| @8 / 瞄准中 24-26 @3
        if (state !== FRAME_STANDING) state = FRAME_RUNNING;
        if (!this.aiming) {
          if (state === FRAME_STANDING) { this.frameExtra = 12; this.frameExtraCounter = 0; break; }
          if (this.frameExtra < 12) this.frameExtra = 12;
          this.frameExtraCounter += Math.abs(vx);
          if (this.frameExtraCounter >= 8) {
            this.frameExtraCounter = 0;
            this.frameExtra++;
            if (this.frameExtra >= 24) this.frameExtra = 12;
          }
          break;
        }
        if (this.frameExtra < 24) this.frameExtra = 24;
        this.frameExtraCounter += 1;
        if (this.frameExtraCounter >= 3) {
          this.frameExtraCounter = 0;
          this.frameExtra++;
          if (this.frameExtra >= 27) this.frameExtra = 24;
        }
        break;
      case 50:
        // 史后坐骑（皇后史莱姆）挤压副帧（:4041-4061）：落地恒 3；空中 0-3 @7 循环
        //（flyTime 有余时双倍速）。该副帧驱动 Extra_206/207 眼翼层（见 Renderer）
        if (vy === 0) {
          this.frameExtraCounter = 0;
          this.frameExtra = 3;
          break;
        }
        this.frameExtraCounter += 1;
        if (this.flyTime > 0) this.frameExtraCounter += 1;
        if (this.frameExtraCounter > 7) {
          this.frameExtraCounter = 0;
          this.frameExtra++;
          if (this.frameExtra > 3) this.frameExtra = 0;
        }
        break;
      case 44: {
        // ★BJ707-G31（G29 登记债②清偿）海盗船（UpdateFrame case 44 :3948-4008）:
        //  ① :3950 `state = 1` 强制跑动组（纯组覆写不写 frameState,case 7/48 同形
        //  ——旧缺=静止船帧组冻结,与下方 FRAME_RUNNING 的 44 跑动速率特例
        //  （max(1,|vx|×0.25),:4228-4230）失配,帆动画停摆）;
        //  ② :3951 flag2=|vx| > DashSpeed−RunSpeed/4 的沿闩（_mountSpecificData
        //  :3954-3960）——rising edge 置 dashBurst（20 粒尘 228 环爆发旗,发射面在
        //  updateMountEffects）;
        //  ③ steady 面（1/num8 掷,:3988-4007）也在 updateMountEffects（每 tick
        //  单掷——落地拍 vanilla TryLanding 二次进 UpdateFrame 双掷,仓内单掷=
        //  10/47 族既有口径,登记）。
        state = FRAME_RUNNING;
        const flag2 = Math.abs(vx) > this.dashSpeed - this.runSpeed() / 4;
        this.dashBurst = false;              // 每拍重算（10/47 族同形）
        if (this.dashBurstLatched && !flag2) this.dashBurstLatched = false;
        else if (!this.dashBurstLatched && flag2) {
          this.dashBurstLatched = true;
          this.dashBurst = true;
        }
        break;
      }
      case 45: {
        // ★BJ707-G31 惊魂木（case 45 :4010-4072）:flag4=|vx| > DashSpeed×0.9 的沿闩
        //  （:4015-4021 rising edge 置 dashBurst=20 粒尘 6 环爆发旗）;dashing 承载
        //  flag4 本身（steady 面门,发射面在 updateMountEffects）。
        const flag4 = Math.abs(vx) > this.dashSpeed * 0.9;
        this.dashBurst = false;              // 每拍重算（10/47 族同形）
        if (this.dashBurstLatched && !flag4) this.dashBurstLatched = false;
        else if (!this.dashBurstLatched && flag4) {
          this.dashBurstLatched = true;
          this.dashBurst = true;
        }
        this.dashing = flag4;
        break;
      }
      case 10:
      case 40:
      case 41:
      case 42:
      case 47: {
        // 冲刺帧门（:3831-3847）：跑动中 |vx| > DashSpeed-RunSpeed/2 → 切冲刺帧组；
        // flag7 = 切入拍且 frameExtra<6（冲刺尘触发沿，尘效经 updateMountEffects 消费）
        const flag6 = this.isDashingSpeed(vx);
        this.dashing = flag6;
        this.dashBurst = false;               // flag7 每拍重算（:3834 局部量）
        if (state === FRAME_RUNNING) {
          if (flag6) {
            state = FRAME_DASHING;
            this.dashBurst = this.frameExtra < 6;
            this.frameExtra++;      // 原版无上限自增（:3842），离开冲刺态即归零
          } else {
            this.frameExtra = 0;
          }
        }
        break;
      }
      case 14: {
        // 蜥蜴冲刺蓄能（case 14 :4111-4127）：|vx| > RunSpeed/2 每拍 +1/180（钳
        //  0-1），否则清零;dashing 承载 num（两发射面门——★BJ707-G31:发射面
        //  updateMountEffects 1:1 落地,旧 `dashBurst = fast && vy===0` 借
        //  dashDust 发 6 型环的近似旗退役）
        const fast = Math.abs(vx) > (d.runSpeed ?? 0) / 2;
        if (!fast) this.basiliskCharge = 0;
        else this.basiliskCharge = Math.min(1, this.basiliskCharge + 1 / 180);
        this.dashing = fast;
        break;
      }
      case 54: {
        // ★BJ703-D1 UpdateFrame_Velociraptor（Mount.cs:4549-4564 1:1）——选择性飞行
        //  帧态：state4(游泳) → allowedToFly ? 3 : 2;空中(2/3) 且 allowedToFly 且
        //  无钩爪 → 3（扇翼帧 16-20）,否则 3 → 2。原式三条件在【骑乘域内】恒定消解:
        //  ① `velocity.Y != 0f`——分派门（Player.cs:36444）保证 UpdateFrame 只在
        //    vy≠0 时收到 2/3/4,恒真;
        //  ② `(!wet || !ShouldFloatInWater)`——ShouldFloatInWater（:3856-3868）骑乘
        //    中 `mount.Type == 37` 之外恒假 → 析取恒真;
        //  ③ `num2 = wings>0 ? wings : wingsLogic`——骑 !CanUseWings 族（54 属之）
        //    两字段被 :26833-26835 每拍清零 → num2 恒 0 → 首析取项恒假。
        //  唯一存活项 = `grappling[0] <= -1`（54 在 CanUseHooks 表 MountID.cs:9,
        //  骑乘可挂钩 = 挂钩中不显扇翼帧）。
        if (state === FRAME_SWIMMING) state = this.allowedToFly ? FRAME_FLYING : FRAME_IN_AIR;
        if ((state === FRAME_IN_AIR || state === FRAME_FLYING) && this.allowedToFly
          && !p.grapplingHooked) {
          state = FRAME_FLYING;
        } else if (state === FRAME_FLYING) {
          state = FRAME_IN_AIR;
        }
        break;
      }
      case 17: {
        // ★SW-FX18 2026-09-10 高尔夫球车前倾副帧（UpdateFrame_GolfCart :4614-4647
        // 1:1）：空中(state==2)且下落(vy>=0)每 6 拍升 1 档至 2（到 2 即挂 -1 衰减闩）；
        // 非空中每 6 拍降 1 档回 0（-1 闩拍先回 1 再起 6 拍衰减）。驱动 Extra_96 副层
        // 行（Mount.Draw case 17 drawType 1 → _frameExtra :5656-5670，num4=4）。
        // state==2 且 vy<0（上升段）两支都不进 = 计数器冻结（原版同构）
        if (state !== FRAME_IN_AIR) {
          if (this.frameExtraCounter !== 0 || this.frameExtra !== 0) {
            if (this.frameExtraCounter === -1) {
              this.frameExtraCounter = 0;
              this.frameExtra = 1;
            }
            this.frameExtraCounter++;
            if (this.frameExtraCounter >= 6) {
              this.frameExtraCounter = 0;
              if (this.frameExtra > 0) this.frameExtra--;
            }
          } else {
            this.frameExtra = 0;
            this.frameExtraCounter = 0;
          }
        } else if (vy >= 0) {
          if (this.frameExtra < 1) this.frameExtra = 1;
          if (this.frameExtra === 2) {
            this.frameExtraCounter = -1;
          } else {
            this.frameExtraCounter++;
            if (this.frameExtraCounter >= 6) {
              this.frameExtraCounter = 0;
              if (this.frameExtra < 2) this.frameExtra++;
            }
          }
        }
        // 车轮尘触发窗（:4650-4662 `state != 2 && state != 0 && state != 3 && state != 4`
        // ——本分派域内即 state==1 跑动）：本 tick 标记，updateMountEffects 消费
        // （两轮位/1/5 掷/实心地面门在消费侧对齐 EmitGolfCartWheelDust :4710-4742）
        this.wheelDust = state === FRAME_RUNNING;
        break;
      }
      default:
        break;
    }

    switch (state) {
      case FRAME_STANDING: {
        // 待机帧（:4139-4226）：站立 delay 计数 + idle 段（rand(900,1500) 后播 idle 动画）
        if ((d.idleFrameCount ?? 0) !== 0) {
          if (this.idleTime === 0) {
            this.idleTimeNext = 900 + Math.trunc(this.idleRand * 600);
            if (this.type === 2) this.idleTimeNext = 600 + Math.trunc(this.idleRand * 300);
            this.idleRand = Math.random();
          }
          this.idleTime++;
        }
        this.frameCounter += 1;
        if ((d.idleFrameCount ?? 0) !== 0 && this.idleTime >= this.idleTimeNext) {
          const delay = d.idleFrameDelay ?? 12;
          const step = Math.trunc((this.idleTime - this.idleTimeNext) / delay);
          if (step >= (d.idleFrameCount ?? 0)) {
            if (d.idleFrameLoop) {
              this.idleTime = this.idleTimeNext; this.frame = d.idleFrameStart ?? 0;
              // 62-65（1457 Mount.cs:4246-4251）：idle 循环回卷时 1/20 直接打断回
              // 站立首帧（待机动画提前收尾；idleTimeNext 对 62-65 = 缺省 rand(900,1500)
              // ——:4208-4210 显式分支与缺省 :4195 同值，无差异）
              if (this.type >= 62 && this.type <= 65 && Math.random() < 0.05) {
                this.frameCounter = 0;
                this.frame = d.standingFrameStart ?? 0;
                this.idleTime = 0;
              }
            } else { this.frameCounter = 0; this.frame = d.standingFrameStart ?? 0; this.idleTime = 0; }
          } else {
            this.frame = (d.idleFrameStart ?? 0) + step;
          }
        } else if (this.frameCounter > (d.standingFrameDelay ?? 12)) {
          this.frameCounter -= d.standingFrameDelay ?? 12;
          this.frame++;
        }
        if (this.frame < (d.standingFrameStart ?? 0)
          || this.frame >= (d.standingFrameStart ?? 0) + Math.max(1, d.standingFrameCount ?? 1)) {
          this.frame = d.standingFrameStart ?? 0;
        }
        break;
      }
      case FRAME_RUNNING: {
        // 跑动帧速率 = 水平速度（:4228-4292）；海盗船/暗黑魔法书族取速度比例；
        // Scutlix/圣诞坦克背向移动（flipDraw）时速率取负——帧倒放（:4245-4291）
        let rate = Math.abs(vx);
        if (this.type === 44) rate = Math.max(1, Math.abs(vx) * 0.25);
        if (this.type === 48) rate = Math.max(0.5, Math.hypot(vx, vy) * 0.125);
        if (this.type === 50) rate = Math.abs(vx) * 0.5;
        if ((this.type === 9 || this.type === 46) && this.flipDraw) rate = -Math.abs(vx);
        this.frameCounter += rate;
        if (rate >= 0) {
          if (this.frameCounter > (d.runningFrameDelay ?? 12)) {
            this.frameCounter -= d.runningFrameDelay ?? 12;
            this.frame++;
          }
          if (this.frame < (d.runningFrameStart ?? 0)
            || this.frame >= (d.runningFrameStart ?? 0) + Math.max(1, d.runningFrameCount ?? 1)) {
            this.frame = d.runningFrameStart ?? 0;
          }
        } else {
          // 倒放（:4281-4291）：计数为负才回退帧，出界钳到组尾
          if (this.frameCounter < 0) {
            this.frameCounter += d.runningFrameDelay ?? 12;
            this.frame--;
          }
          if (this.frame < (d.runningFrameStart ?? 0)
            || this.frame >= (d.runningFrameStart ?? 0) + Math.max(1, d.runningFrameCount ?? 1)) {
            this.frame = (d.runningFrameStart ?? 0) + Math.max(1, d.runningFrameCount ?? 1) - 1;
          }
        }
        break;
      }
      case FRAME_FLYING: {
        // ★BJ703-D1 迅猛龙燃料期扇翼加速（UpdateFrame case 3 :4361-4364
        //  `if (Type == 54 && _flyTime > 0) num33 -= 2`——54 帧延迟 6-2=4;
        //  56/61 的速度倍乘器 num32 在原版分派域不可达（usesHover=true 恒走
        //  CanHover 短路,同 BJ701 对 Flight 支 /1.5 的死码判谳）,不建模）。
        let flyDelay = d.flyingFrameDelay ?? 12;
        if (this.type === 54 && this.flyTime > 0) flyDelay -= 2;
        this.frameCounter += 1;
        if (this.frameCounter > flyDelay) {
          this.frameCounter -= flyDelay;
          this.frame++;
        }
        if (this.frame < (d.flyingFrameStart ?? 0)
          || this.frame >= (d.flyingFrameStart ?? 0) + Math.max(1, d.flyingFrameCount ?? 1)) {
          this.frame = d.flyingFrameStart ?? 0;
        }
        break;
      }
      case FRAME_IN_AIR: {
        const preAirFrame = this.frame;   // :4385 `int frame = _frame`（62-65 扇翼门用前置帧）
        this.frameCounter += 1;
        if (this.frameCounter > (d.inAirFrameDelay ?? 12)) {
          this.frameCounter -= d.inAirFrameDelay ?? 12;
          this.frame++;
        }
        if (this.frame < (d.inAirFrameStart ?? 0)
          || this.frame >= (d.inAirFrameStart ?? 0) + Math.max(1, d.inAirFrameCount ?? 1)) {
          this.frame = d.inAirFrameStart ?? 0;
        }
        // 62-65 扇翼保持（1457 Mount.cs:4395-4411）：入空中时前置帧 <4（站立组）→
        // 计数器钉在 inAirFrameDelay-1（下拍不推进）；计数 <6 → 帧 5（扇翼），否则
        // 计数器钉 6（净效果：空中恒 inAirFrameStart=4 滑翔帧，扇翼支仅状态抖动沿可见）
        if (this.type >= 62 && this.type <= 65) {
          if (preAirFrame < 4) this.frameCounter = (d.inAirFrameDelay ?? 12) - 1;
          if (this.frameCounter < 6) this.frame = 5;
          else this.frameCounter = 6;
        }
        // 蜜蜂悬停副帧（翅膀层 :4412-4425：疲劳越低拍越快）
        if (this.type === 5 && (d.fatigueMax ?? 0) > 0) {
          const t = this.fatigue / this.fatigueMax;
          this.frameExtraCounter += 6 - 4 * t;
          if (this.frameExtraCounter > (d.flyingFrameDelay ?? 12)) {
            this.frameExtra++;
            this.frameExtraCounter -= d.flyingFrameDelay ?? 12;
          }
          if (this.frameExtra < (d.flyingFrameStart ?? 0)
            || this.frameExtra >= (d.flyingFrameStart ?? 0) + Math.max(1, d.flyingFrameCount ?? 1)) {
            this.frameExtra = d.flyingFrameStart ?? 0;
          }
        }
        break;
      }
      case FRAME_SWIMMING: {
        // 游泳帧速率 = 平均速度（:4427-4446）
        const rate = Math.trunc((Math.abs(vx) + Math.abs(vy)) / 2);
        this.frameCounter += rate;
        if (this.frameCounter > (d.swimFrameDelay ?? 12)) {
          this.frameCounter -= d.swimFrameDelay ?? 12;
          this.frame++;
        }
        if (this.frame < (d.swimFrameStart ?? 0)
          || this.frame >= (d.swimFrameStart ?? 0) + Math.max(1, d.swimFrameCount ?? 1)) {
          this.frame = d.swimFrameStart ?? 0;
        }
        break;
      }
      case FRAME_DASHING: {
        // 冲刺帧速率（:4452-4480）：Scutlix 背向移动倒放，其余按 |vx|
        const rate = this.type === 9 && this.flipDraw ? -Math.abs(vx) : Math.abs(vx);
        this.frameCounter += rate;
        if (rate >= 0) {
          if (this.frameCounter > (d.dashingFrameDelay ?? 40)) {
            this.frameCounter -= d.dashingFrameDelay ?? 40;
            this.frame++;
          }
          if (this.frame < (d.dashingFrameStart ?? 0)
            || this.frame >= (d.dashingFrameStart ?? 0) + Math.max(1, d.dashingFrameCount ?? 1)) {
            this.frame = d.dashingFrameStart ?? 0;
          }
        } else {
          if (this.frameCounter < 0) {
            this.frameCounter += d.dashingFrameDelay ?? 40;
            this.frame--;
          }
          if (this.frame < (d.dashingFrameStart ?? 0)
            || this.frame >= (d.dashingFrameStart ?? 0) + Math.max(1, d.dashingFrameCount ?? 1)) {
            this.frame = (d.dashingFrameStart ?? 0) + Math.max(1, d.dashingFrameCount ?? 1) - 1;
          }
        }
        break;
      }
    }
    // 62-65 盾冲帧（1457 Mount.cs:4541-4545）：dashDelay ∈ [-5,-1]（滑行段）整段
    // 钉帧 5（冲刺帧组 dashingFrameStart）——骑乘中发起的盾冲（MountID.Sets.CanDash
    // 62-65 在表,MountID.cs:11）以本帧表达
    if (this.type >= 62 && this.type <= 65
      && p.dashDelay !== undefined && p.dashDelay < 0 && p.dashDelay >= -5) {
      this.frame = 5;
    }
  }

  /** 每帧帧态调度（Player.cs:36430-36499 的 mount.UpdateFrame 分派 1:1）。
   *  飞行帧态门 = FlyTime>0 && jump==0 && controlJump && !CanHover（:36446）。
   *  ★BJ704-G5（G4-③）：①飞行门补 `jump == 0`（:36446——起跳上升段（jumpHold>0
   *  平台钉期）不得选扇翼帧 3,54 装翼后新达面;原版序=钉期帧 2）;②游泳臂判据
   *  inWater → wet（:36485 `else if (wet)`——任意液体含岩浆/蜜/微光：熔岩鲨 49
   *  骑岩浆帧态=4 → canHover 成立=岩浆中悬停;旧 inWater 只水）。 */
  updateFrameDispatch(p: MountedPlayerView): void {
    if (p.vy !== 0 && this.walkingGraceTime <= 0) {
      if (this.flyTime > 0 && (p.jumpHold ?? 0) === 0 && p.inputJump && !this.canHover(p)) {
        this.tryBeginningFlight(p, FRAME_FLYING);
        this.updateFrame(p, FRAME_FLYING, p.vx, p.vy);
        this.tryLanding(p);
      } else if (p.wet ?? p.inWater) {
        this.updateFrame(p, FRAME_SWIMMING, p.vx, p.vy);
      } else {
        this.tryBeginningFlight(p, FRAME_IN_AIR);
        this.updateFrame(p, FRAME_IN_AIR, p.vx, p.vy);
        this.tryLanding(p);
      }
    } else {
      this.updateFrame(p, this.intendedGroundedFrame(p), p.vx, p.vy);
    }
  }

  // ---- 上下坐骑 ----

  /** 上坐骑（Mount.cs SetMount :6184-6296）：同型/无效 id/蜜蜂浸水 拒绝；
   *  换骑先复位旧实例。坐骑 buff（AddBuff(buff,3600) :6291）不入 BuffState——原版该
   *  buff 是 TimeLeftDoesNotDecrease 的占位（UpdateBuffs MountType 分支 :9968-9971
   *  每 tick `SetMount+buffTime=10` 续期，掉 buff 即下坐），本仓以 mount.active 单一
   *  真源表达（391→64/392→65 的映射在 BUFF_TO_MOUNT，续期语义由 active 常驻承载，
   *  下坐即无 buff——与 Dismount :6214 ClearBuff 等价），buff 附带效果（131/168/265
   *  的 ignoreWater 等）由 swimFree/免淹门直接消费；出生尘（DoSpawnDust :6363）与
   *  62-65 上骑音（PalChillet :6349-6352）经 game 回调。★BJ405-D1：buff 栏图标由
   *  UI 坐骑通道按 mount.active 派生渲染（无时长字 Main.cs:9345-9352 全 MountType
   *  buffNoTimeDisplay+buffNoSave;★P4 锚勘误:旧引 :9342-9349 漂移），右键图标 =
   *  下马（TryRemovingBuff 坐骑支 :44100-44103）*/
  setMount(m: number, p: MountedPlayerView & { buffs?: { remove(t: unknown): void }; stoolInUse?: boolean }, game?: MountDustGame): boolean {
    if (this.type === m || m < 0 || m >= _mountCountMax) return false;
    if (m === 5 && p.inWater) return false;              // 蜜蜂座骑浸水不可上（:6190）
    // ★BJ357 蝙蝠诅咒 56 湿身拒上（CanMount :6662 `m == 56 && (wet || dripping ||
    //  WetCollision(...))`——本仓视图仅 inWater 一量,dripping/WetCollision 探针未建模,
    //  以 inWater 近似（登记）;变身骑族同批的 55/61 无此门）
    if (m === 56 && p.inWater) return false;
    if (this.active) {
      this.reset();
    }
    this.active = true;
    this.flyTime = 0;
    this.type = m;
    const d = this.data;
    this.fatigueMax = d?.fatigueMax ?? 0;
    // 眼炮族冷却下限（SetMount :6224-6231：Scutlix 上坐即预热 20 / 圣诞坦克 40）
    if (m === 9 && this.abilityCooldown < 20) this.abilityCooldown = 20;
    if (m === 46 && this.abilityCooldown < 40) this.abilityCooldown = 40;
    // ★BJ357 变身坐骑缩盒（SetMount :6309-6328 1:1）：PlayerSize 委派坐骑上坐即改写
    //  玩家碰撞盒——先记 Bottom，后按 size 重置 w/h，再底锚回放（x 重心对齐）。
    //  原版无空间检查（盒只会变小恒可容）;shadowPos 重锚（:6313-6315/:6321-6323）
    //  本仓视图无该字段，拖影由 Player.fixedUpdate 采样自然跟随（登记）。
    //  位次=出生尘（:6363 DoSpawnDust 在缩盒后——尘以新盒中心为锚）之前。
    //  非委派坐骑（表外）零改盒（原版委派 null 同相）。
    const psz = MOUNT_PLAYER_SIZE[m];
    // ★BJ704-G20（R10-P2 setMount-box-restore）：折叠凳位不随骑继承——先清
    //   stoolInUse（vanilla IsInUse 跨骑粘滞经 ResizeHitbox 逐拍常态化,HeightOffsetBoost
    //   mount 分支先行=无效果;本仓偏移凳模型（fixedUpdate 头 :6019 y+=26/h-=26 出口）
    //   无逐拍回盒,凳位残留 + 缩盒 → 出口双扣 h=-12（鼠 14−26）/h=16（普通 42−26）
    //   =盒腐化【直调/换骑通道实报面】）。
    // ★BJ704-G22（g20-stool-memory-quirk ★销案,防再登记）：vanilla 凳位跨骑「记忆」
    //   经亲读定谳=自中和零净效怪癖——①HeightOffsetBoost（Player.cs:3265-3279）
    //   mount.Active 分支【优先于】stool 分支 → 粘滞 IsInUse 对骑乘盒无贡献;
    //   ②SetMount else 支（Mount.cs:6331-6337）底锚回放 position.Y±height,坐凳
    //   （顶上移 26）与上坐重锚相消 → 盒位与正常上坐逐位相同;③次拍 ResetEffects
    //   :18899 IsInUse 逐拍清。本仓清位 ≙ vanilla 净效等价（G20 判语「无效果」
    //   补齐三重源锚）。勿再按「vanilla 凳位记忆 SW 未复刻」登记。
    if (p.stoolInUse === true) p.stoolInUse = false;
    if (psz) {
      const bx = p.x + p.w / 2, by = p.y + p.h;
      p.w = psz[0];
      p.h = psz[1];
      p.x = bx - p.w / 2;
      p.y = by - p.h;
    } else {
      // ★BJ704-G20（R10-P2 setMount-box-restore-latent 窄修）：vanilla SetMount
      //   else 支（Mount.cs:6329-6342）非委派坐骑上坐即回放 height=42+heightBoost
      //   （底锚;width 不动,次拍 ResizeHitbox :29439-29451 复 20——HeightOffsetBoost
      //   mount 分支=mount.HeightBoost,逐拍持保）。本仓玩家盒架构恒 42（mounted
      //   42+boost=全仓预先存在近似,R10 邻面注:驯鹿 0 boost20 → vanilla 盒 20×62/
      //   仓恒 20×42）——窄修=直调 setMount 换骑（mod/未来通道;当前玩法不可达,
      //   DontHoldItems{55,56,61} 拦物品换骑=R10 N1c 证）时回 SW 稳态 20×42,
      //   堵变身骑残余盒（R10 探针 N1:骑鼠 14×14 直调 setMount(3) 后盒残留）。
      //   正常物品通道上坐=已是 20×42,零位差;凳位（h=68）随上方清位一并缩回
      //   （底锚等价 :6019 出口净效）。
      if (p.w !== 20 || p.h !== 42) {
        const bx = p.x + p.w / 2, by = p.y + p.h;
        p.w = 20;
        p.h = 42;
        p.x = bx - p.w / 2;
        p.y = by - p.h;
      }
    }
    // 出生尘（DoSpawnDust :6363→:6366 isDismounting:false——★BJ704-G18（G17 债3
    //  同函数双面）随本刀转正 typed 尘;旧 10 粒程序化圆近似退役为 spawnDust 缺席
    //  环境的回退档（位序=缩盒后,尘以新盒为锚——原版 :6366 在 PlayerSize 之后）
    this.doSpawnDust(p, game, false);
    // 62-65 上骑叫（SetMount :6349-6352 `(uint)(type - 62) <= 3u` → PalChillet
    // 0.35，SoundID.cs:1080——疾旋鼬/疾旋火鼬及其 Trusty 版四坐骑同支）
    if (game?.playSfxFiles && m >= 62 && m <= 65) {
      game.playSfxFiles(['pal_chillet'], 0.35, p.x + p.w / 2, p.y + p.h / 2);
    }
    return true;
  }

  /** 下坐空间检查（★BJ357 重锚 Mount.cs CanDismountWithResult :6682-6696：
   *  `!TryChangingSizeFromBottomCenter(Hitbox,20,42)` → FailedNoSpace——与当前骑乘盒
   *  大小无关恒按 20×42 目标盒判。同尺寸盒（非变身坐骑 20×42）缩支零探针=恒可下
   *  （原版同相,旧「头顶 42px 列扫」近似编码了更严语义,随 BJ357 退役）;
   *  变身盒（8×14/14×14/20×18）回长 20×42 才走探针。
   *  ★BJ704-G13（G12 登记债2）：补 DontDismountWhenCCed 首闸（:6686-6690
   *  `MountID.Sets.DontDismountWhenCCed[Type] ∧ CCed` → FailedCCed——MountID.cs:29
   *  CreateBoolSet(55,56,61)：老鼠/蝙蝠/仙灵 CCed 中拒下坐;CCed 判据序在空间探针
   *  【前】=变身骑族 CCed 恒 FailedCCed 不落空间探针）。 */
  canDismount(p: MountedPlayerView): boolean {
    return this.canDismountWithResult(p) === 'ok';
  }

  /** CanDismountWithResult :6682-6696 的分道变体（'ok' | 'cced' | 'nospace'）——
   *  QuickMount 3 连失败链（Player.cs:6043 只对 FailedNoSpace 计数,FailedCCed
   *  静默返回）须分道消费;Game.ts tryDismountMount 现按 boolean 合流（FailedCCed
   *  误入 3 连强制链=域外登记债,Game.ts 禁触批另刀）。 */
  canDismountWithResult(p: MountedPlayerView): 'ok' | 'cced' | 'nospace' {
    if (DONT_DISMOUNT_WHEN_CCED.has(this.type) && (p.cced ?? false)) return 'cced';
    const st = p.store;
    if (!st) return 'ok';
    return tryChangingSizeFromBottomCenter(
      st as unknown as SolidTileView, p.x, p.y, p.w, p.h, 20, 42,
    ) !== null ? 'ok' : 'nospace';
  }

  /** @param game 透传 dismount 的出生尘回调（★BJ405-D1：右键下马
   *  Main.cs:44100-44103 TryDismount → Dismount :6234 DoSpawnDust(isDismounting)
   *  1:1——buff 栏右键路径带尘；既有调用方不传=零变化） */
  tryDismount(p: MountedPlayerView, game?: MountDustGame): boolean {
    if (!this.canDismount(p)) return false;
    this.dismount(p, game);
    return true;
  }

  dismount(p?: MountedPlayerView, game?: MountDustGame): void {
    if (!this.active) return;
    // ★BJ704-G18（G17 登记债3）：Dismount :6232-6235 `!ignoreEffect → DoSpawnDust(
    //  isDismounting:true)`——R 键成功拍/buff 栏右键/CCed 强制链全部经本口出生尘
    //  （位序=Reset/回盒【前】,尘以骑乘盒为锚——原版同序）。三连败第 3 拍
    //  ignoreEffect=true 调用方不传 game=免尘（Game.tryDismountMount 强制支）。
    //  旧 10 粒程序化圆近似随本刀转正 typed 尘（DoSpawnDust :6440-6635 1:1）。
    if (p) this.doSpawnDust(p, game, true);
    this.reset();
    // ★BJ357 回盒（Dismount :6240-6257 1:1）：TryChangingSizeFromBottomCenter(20×42)
    //  成功 → 贴 fit 位（TopLeft 平移,盒内 shadowPos 补偿原版 :6245-6253 本仓无该
    //  字段,拖影采样自然跟随,登记）;失败 → 底锚强改（原版 :6254-6258 else 支,可嵌墙
    //  ——上闸 canDismount 已按同式判,此处为强制下坐链兜底）。原版缩放前盒=骑乘盒
    //  （非变身骑无位差,tryChanging 缩支零探针恒成功,位不变=同相）。
    if (p && (p.w !== 20 || p.h !== 42)) {
      const st = p.store;
      const fit = st
        ? tryChangingSizeFromBottomCenter(st as unknown as SolidTileView, p.x, p.y, p.w, p.h, 20, 42)
        : null;
      if (fit) {
        p.x = fit.x;
        p.y = fit.y;
      } else {
        p.y += p.h;
      }
      p.w = 20;
      p.h = 42;
      if (!fit) p.y -= p.h;
    }
  }

  /** ★BJ704-G18（G17 登记债2）DoFailedDismountDust（Mount.cs:6386-6437）1:1：
   *  下坐失败反馈尘——QuickMount :6052 `DoFailedDismountDust(this, FailedNoSpaceCount*20)`
   *  唯一消费位（Game.tryDismountMount 失败 1/2 拍）。尘型 = _data.spawnDust
   *  （vanilla-mounts.json 66/66 全量）;56=黑（Color.Black）、61=仙灵彩
   *  （GetFairyQueenWeaponsColorFull(0.27,1,0.15,1,0.7) 通名支——dev 名分色表不建模,
   *  同 mountLights/pixieTrail 登记）;盒 = Hitbox.Inflate(10,10)。typed 尘经
   *  game.spawnDust（NewDust 同构 + 调用侧后置覆写——原版 DelegateMethods 式）;
   *  缺席环境（测试桩）回退 spawnParticles 程序化圆（数量=尘公式,旧近似形态）。 */
  doFailedDismountDust(p: MountedPlayerView, game: MountDustGame | undefined, dustAmount: number): void {
    const pool = game?.spawnDust?.bind(game);
    if (!pool) {
      // 回退档（旧程序化圆近似;数量随公式订正 = count×20 非 10+count×20）
      game?.spawnParticles?.(p.x + p.w / 2, p.y + p.h / 2, '#C8C8C8', dustAmount, 1.2);
      return;
    }
    const d = this.data;
    if (!d?.spawnDust) return;
    const t = this.type;
    let color: { r: number; g: number; b: number; a: number } | null = null;   // Color.Transparent=NewDust 缺省
    if (t === 56) color = { r: 0, g: 0, b: 0, a: 255 };                        // Color.Black（:6393-6395）
    if (t === 61) color = fairyQueenDustColor();                               // 仙灵彩（:6397-6399）
    const rx = p.x - 10, ry = p.y - 10, rw = p.w + 20, rh = p.h + 20;          // Inflate(10,10)（:6401-6402）
    for (let i = 0; i < dustAmount; i++) {
      const du = pool(rx, ry, rw, rh, d.spawnDust, 0, 0, 0, color, 1);         // :6408（scale1/α0）
      if (!du) continue;                        // 池满/屏裁拒——原版 Main.dust[6000] 哨兵同相
      du.scale += (Math.floor(Math.random() * 31) - 10) * 0.01;               // :6409 Next(-10,21)×0.01
      if (t === 56) {                           // :6410-6415 蝙蝠：定值 0.7+重坠
        du.scale = 0.7;
        du.vx *= 0.4; du.vy *= 0.4;
        du.vy += p.gravDir * 0.5;
      }
      if (t === 61) {                           // :6417-6421 仙灵：随机胀缩+速度掺玩家速度
        du.scale *= 1 + 0.3 * Math.random();
        const f = Math.random();                // 单次 NextFloat 缩整向量（:6421）
        du.vx += p.vx * f; du.vy += p.vy * f;
      }
      if (d.spawnDustNoGravity) du.noGravity = true;                            // :6423-6425
      else if (Math.random() < 0.5) { du.scale *= 1.3; du.noGravity = true; }   // :6427-6430（Next(2)==0）
      else { du.vx *= 0.5; du.vy *= 0.5; }                                      // :6432-6434
      du.vx += p.vx * 0.8; du.vy += p.vy * 0.8;                                 // :6436
    }
  }

  /** ★BJ704-G18（G17 登记债3）DoSpawnDust（Mount.cs:6440-6635）1:1：上下坐出生尘。
   *  消费位 = Dismount :6232-6235（!ignoreEffect → isDismounting:true）与 SetMount
   *  :6366（isDismounting:false）——本仓由 dismount/setMount 内联;三连败第 3 拍
   *  Dismount(ignoreEffect:true) 不经此面。特型支：52 狼（100×尘267 紫微光+1/3 白
   *  克隆回声）/62-65 帕鲁（100×尘306 青光×2 同克隆）/矿车（只出 gore 每 10 拍 1 片）
   *  /40-42 马（尘 16/31 混 α50 + 尾 5 gore）/23 扫帚（黄 + 尾 4 gore）/56/61 变身
   *  骑（下坐=底锚 DefaultSize 盒,上坐=Hitbox,皆 Inflate10）/57-60 滚轴鞋（40 尘+
   *  脚底带盒+专用减速）。typed 尘经 game.spawnDust;缺席回退 spawnParticles
   *  （旧 10 粒圆近似形态,数量保持）。 */
  doSpawnDust(p: MountedPlayerView, game: MountDustGame | undefined, isDismounting: boolean): void {
    const pool = game?.spawnDust?.bind(game);
    if (!pool) {
      game?.spawnParticles?.(p.x + p.w / 2, p.y + p.h / 2, '#C8C8C8', 10, 1.5);   // 回退档（旧近似）
      return;
    }
    const d = this.data;
    const t = this.type;
    const clone = game?.cloneDust?.bind(game);
    // ---- 特型支 52（:6446-6466）：100×尘 267 紫微光 + 1/3 白克隆回声 ----
    if (t === 52) {
      for (let i = 0; i < 100; i++) {
        const du = pool(p.x - 20, p.y, p.w + 40, p.h, 267, 0, 0, 60, { r: 130, g: 60, b: 255, a: 70 }, 1);
        if (!du) continue;
        du.scale += (Math.floor(Math.random() * 31) - 10) * 0.01;
        du.noGravity = true;
        du.vx += p.vx * 0.8; du.vy += p.vy * 0.8;
        const f = Math.random();                                   // velocity *= NextFloat（:6455）
        du.vx *= f; du.vy *= f;
        du.vy += 2 * (Math.random() * 2 - 1);                      // 2×NextFloatDirection（:6456）
        du.noLight = true;
        if (Math.random() < 1 / 3 && clone) {                      // Next(3)==0 → CloneDust 白化（:6458-6464）
          const c2 = clone(du);
          if (c2) { c2.color = { r: 255, g: 255, b: 255, a: 255 }; c2.scale *= 0.5; c2.alpha = 0; }
        }
      }
      return;
    }
    // ---- 特型支 62-65（:6468-6488）：100×尘 306 青光 scale2 + 同款克隆回声 ----
    if (t >= 62 && t <= 65) {
      for (let i = 0; i < 100; i++) {
        const du = pool(p.x - 20, p.y, p.w + 40, p.h, 306, 0, 0, 60, { r: 100, g: 227, b: 255, a: 127 }, 2);
        if (!du) continue;
        du.scale += (Math.floor(Math.random() * 31) - 10) * 0.01;
        du.noGravity = true;
        du.vx += p.vx * 0.8; du.vy += p.vy * 0.8;
        const f = Math.random();
        du.vx *= f; du.vy *= f;
        du.vy += 4 * (Math.random() * 2 - 1);
        du.noLight = true;
        if (Math.random() < 1 / 3 && clone) {
          const c2 = clone(du);
          if (c2) { c2.color = { r: 255, g: 255, b: 255, a: 255 }; c2.scale *= 0.5; c2.alpha = 0; }
        }
      }
      return;
    }
    // ---- 通用支（:6490-6635） ----
    let color: { r: number; g: number; b: number; a: number } | null = null;
    if (t === 23) color = { r: 255, g: 255, b: 0, a: 255 };         // :6491-6493 扫帚黄
    if (t === 56) color = { r: 0, g: 0, b: 0, a: 255 };             // :6495-6497 蝙蝠黑
    if (t === 61) color = fairyQueenDustColor();                    // :6499-6501 仙灵彩
    const skates = t > 0 && !!MOUNT_SETS.IsRollerSkates?.[t];
    const num = skates ? 40 : 100;                                  // :6503-6507
    let rx = Math.trunc(p.x) - 20, ry = Math.trunc(p.y);            // :6508
    let rw = p.w + 40, rh = p.h;
    if (t === 56 || t === 61) {                                     // :6509-6521 变身骑族专用盒
      if (isDismounting) {
        const bx = p.x + p.w / 2, by = p.y + p.h;                   // Bottom（回 20×42 目标位锚）
        rx = Math.trunc(bx) - 10; ry = Math.trunc(by) - 42; rw = 20; rh = 42;
      } else {
        rx = p.x; ry = p.y; rw = p.w; rh = p.h;                     // Hitbox
      }
      rx -= 10; ry -= 10; rw += 20; rh += 20;                       // Inflate(10,10)
    }
    if (skates) {                                                   // :6522-6528 滚轴鞋脚底带
      const halfW = Math.trunc(p.w / 2);
      rx = Math.trunc(p.x + p.w / 2) - halfW - 10;
      ry = Math.trunc(p.y + p.h) - 10;
      rw = Math.max(1, halfW + 20); rh = 10;
    }
    for (let k = 0; k < num; k++) {
      if (MOUNT_SETS.Cart?.[t]) {                                   // :6531-6540 矿车：只出 gore
        if (k % 10 === 0) {
          const ang = Math.random() * Math.PI * 2;
          const g = GorePiece.newGore(61 + Math.floor(Math.random() * 3), p.x - 20, p.y, 0, 0);
          if (g) { g.alpha = 100; g.vx = Math.cos(ang); g.vy = Math.sin(ang); }
        }
        continue;
      }
      let type2 = d?.spawnDust ?? 16;
      let scale = 1, alpha = 0;
      if (t === 40 || t === 41 || t === 42) {                       // :6545-6557 马族：16/31 混
        type2 = Math.floor(Math.random() * 2) !== 0 ? 16 : 31;
        scale = 0.9; alpha = 50;
        if (t === 42) type2 = 31;
        if (t === 41) type2 = 16;
      }
      if (t === 61 && Math.floor(Math.random() * (isDismounting ? 2 : 5)) !== 0) {
        continue;                                                    // :6559-6561 仙灵抽稀
      }
      const du = pool(rx, ry, rw, rh, type2, 0, 0, alpha, color, scale);   // :6563
      if (!du) continue;
      du.scale += (Math.floor(Math.random() * 31) - 10) * 0.01;     // :6564
      if (skates) {                                                  // :6565-6573 滚轴鞋专用减速
        du.vx *= 0.8; du.vy *= 0.8;
        du.vy *= 0.75;
        du.vy += p.gravDir * 0.25;
        du.noLightEmittance = true;
        du.noGravity = true;
      }
      if (t === 56) {                                                // :6574-6580
        du.scale = 0.7;
        du.vx *= 0.4; du.vy *= 0.4;
        du.vy += p.gravDir * 0.5;
      }
      if (t === 61) {                                                // :6581-6592
        du.scale *= 1 + 0.3 * Math.random();
        if (!isDismounting) {
          const cxr = rx + rw / 2, cyr = ry + rh / 2;                // r.Center 吸聚（:6587）
          du.x += (cxr - du.x) * 0.7;
          du.y += (cyr - du.y) * 0.7;
          du.vx *= -2; du.vy *= -2;
          du.vy -= 1;
        }
        const f = Math.random();
        du.vx += p.vx * f; du.vy += p.vy * f;
      }
      if (d?.spawnDustNoGravity) du.noGravity = true;                // :6593-6595
      else if (Math.random() < 0.5) { du.scale *= 1.3; du.noGravity = true; }   // :6597-6600
      else { du.vx *= 0.5; du.vy *= 0.5; }                           // :6602-6604
      du.vx += p.vx * 0.8; du.vy += p.vy * 0.8;                      // :6606
      if (t === 40 || t === 41 || t === 42) {                        // :6607-6609
        const f = Math.random();
        du.vx *= f; du.vy *= f;
      }
    }
    if (t === 40 || t === 41 || t === 42) {                          // :6612-6624 马族尾 5 gore
      for (let l = 0; l < 5; l++) {
        let type3 = 61 + Math.floor(Math.random() * 3);
        if (t === 41 || (t === 40 && Math.random() < 0.5)) type3 = 11 + Math.floor(Math.random() * 3);
        const ang = Math.random() * Math.PI * 2;
        const g = GorePiece.newGore(type3, p.x + p.facing * 8, p.y + 20, 0, 0);
        if (g) { g.alpha = 100; g.vx = Math.cos(ang) * 1.4; g.vy = Math.sin(ang) * 1.4; }
      }
    }
    if (t === 23) {                                                  // :6626-6634 扫帚尾 4 gore
      for (let m = 0; m < 4; m++) {
        const ang = Math.random() * Math.PI * 2;
        const g = GorePiece.newGore(61 + Math.floor(Math.random() * 3), p.x - 20, p.y, 0, 0);
        if (g) { g.alpha = 100; g.vx = Math.cos(ang); g.vy = Math.sin(ang); }
      }
    }
  }

  reset(): void {
    this.active = false;
    this.type = -1;
    this.frame = 0;
    this.frameCounter = 0;
    this.frameExtra = 0;
    this.frameExtraCounter = 0;
    this.frameState = FRAME_STANDING;
    this.flyTime = 0;
    this.allowedToFly = false;
    this.fatigue = 0;
    this.fatigueMax = 0;
    this.idleTime = 0;
    this.idleTimeNext = -1;
    this.abilityCharging = false;
    this.abilityCharge = 0;
    this.abilityCooldown = 0;
    this.abilityDuration = 0;
    this.abilityActive = false;
    this.aiming = false;
    this.flipDraw = false;
    this.fishronCounter = 0;
    this.fishronBoost = false;
    this.mountJumpReady = false;
    this.mountJumpPerforming = false;
    this.drillBeams = [drillBeamIdle(), drillBeamIdle()];
    this.drillBeamCooldown = 0;
    this.diodeRotation = 0;
    this.diodeRotationTarget = 0;
    this.outerRingRotation = 0;
    this.crosshairX = 0;
    this.crosshairY = 0;
    this.walkingGraceTime = 0;
    this.fullRotation = 0;
    this.basiliskCharge = 0;
    this.dashBurst = false;
    this.dashBurstLatched = false;
    this.dashing = false;
    this.wheelDust = false;
  }

  /** 每 tick 维护（Player.fixedUpdate 挂点）：能量恢复 + 地面飞行时量回充 + 帧态机。
   *  ★BJ704-G5（R4-P2④）54 面回充补 releaseJump 门：原版 :26978-26982
   *  `((vy==0||sliding) && releaseJump) || (autoJump && justJumped)` →
   *  ResetFlightTime（54 → flyTime=wingTimeMax）——持跳跨跳落地拍 releaseJump 假
   *  ⇒ 不回充（每飞行周期须松跳;旧无门=持跳无限迅猛龙飞行,探针实证落地+1 拍回满
   *  80）。releaseJump ≙ !inputJump（Player.ts 回满公共段 :7978 同承载）。★只辖 54
   *  面：mount 0/2/50 族维持仓内既有回充语义（探针已验面=登记偏差,勿动——BJ701
   *  判例"勿动 mount50 族语义"）;FatigueRecovery 门（:24955 vy==0 无 releaseJump）
   *  亦不受本门连坐。 */
  upkeep(p: MountedPlayerView): void {
    if (!this.active || this.isCart) return;
    this.abilityRecovery();
    if (p.onGround || p.vy === 0) {
      if (this.type !== 54 || !p.inputJump) this.resetFlightTime(p);
      this.fatigueRecovery();
    }
    this.tryStartHover(p);
    this.updateFrameDispatch(p);
    this.updateBodyRotation(p);
  }

  // ---- 渲染信息 ----

  /** 玩家绘制纵向偏移（Mount.PlayerOffset :409-423：playerYOffsets[当前帧]） */
  get playerOffset(): number {
    const d = this.data;
    if (!d || !d.playerYOffsets?.length) return 0;
    if (this.frame >= d.totalFrames) return 0;
    return d.playerYOffsets[this.frame] ?? 0;
  }

  get textures(): { back?: string; front?: string; backExtra?: string; frontExtra?: string } {
    const d = this.data;
    if (!d) return {};
    const f = (n?: string) => (n ? `vanilla/${n}` : undefined);
    return { back: f(d.backTexture), front: f(d.frontTexture), backExtra: f(d.backTextureExtra), frontExtra: f(d.frontTextureExtra) };
  }
}

// ============================================================================
// 坐骑点光（Mount.cs 各 AddLight 段汇总）——纯函数，渲染层每帧收集后注入光照引擎
// ============================================================================

export interface MountLight {
  /** 目标格（AddLight(int,int,..) 口径） */
  tx: number; ty: number;
  /** RGB（0-1，AddLight 语义） */
  r: number; g: number; b: number;
}

export interface MountLightCtx {
  /** Colors.CurrentLiquidColor 近似（0-255 RGB；猪鲨崽光/背层渐染用）。
   *  ★透明档已接：CurrentLiquidColor 首帧起自 Color.Transparent，11 层
   *  liquidAlpha 全 0 时【原样返回 Transparent】（Colors.cs:97-120）→ 猪鲨崽
   *  无可见液层时点光=零贡献。null = 无液（调用方按浸入态给值）。
   *  背层液色渐变（Mount.Draw case 12 drawType 0 :5780-5787）仍由渲染层
   *  drawMountLayer 以 mnt.fishronCounter 直读实现 */
  liquidColor: [number, number, number] | null;
  /** worldSurface 格线（蜥蜴地下红光门 :4077 position.Y > worldSurface*16+160） */
  worldSurface: number;
  /** miscCounter（扫帚挂件摆动相位 :3553；缺省 0） */
  miscCounter?: number;
  /** WindForVisuals（Main.cs:2896 = windSpeedCurrent，±0.8——扫帚挂件风摆项
   *  :3553；由渲染层传 weather.windSpeedCurrent，缺省 0 = 无风近似） */
  wind?: number;
  /** 扫帚挂件露天档（Mount.cs GetWitchBroomTrinketRotation :3591-3604——
   *  WorldGen.InAPlaceWithWind(中心格) 命中 → num3=1f，否则 0.5f）。旧实现恒
   *  ×0.5（室内档），露天位风摆幅度低估一半 */
  windExposed?: boolean;
}

/** 坐骑点光清单（UpdateFrame :3614/:4079 + Hover :3481 + UpdateEffects
 *  :4811/:4981-4991 + AimAbility :5411/:5456 汇总）：
 *  - emitsLight 族（8/45/49）：lightColor 于中心格（:3614-3617）
 *  - UFO 7：(0.4, 0.2×|2-帧/2|/2, 0) 帧脉冲（:3468-3483）
 *  - 巫婆扫帚 23：挂件火光 (1,0.75,0.5)×0.85（:4811-4814，挂件位随速度/风摆动）
 *  - Scutlix 9：瞄准+充能中 → 眼部红光 ×充能比（:5392-5412）
 *  - Santank 46：瞄准+充能中 → 炮口 (0.7,0.4,0.4)×2（:5447-5457 双点累加）
 *  - 猪鲨崽 12：增益态 → CurrentLiquidColor×0.4 于身前点（落点实心则退回身侧
 *    :5038-5056；无可见液层透明档已接,ctx.liquidColor=null）
 *  - 仙灵武库 61：GetFairyQueenWeaponsColorFull 通名支 hslToRgb ×0.55（:3670-3673）
 *  - 蜥蜴 14：worldSurface 以下 → 身中心红光 (0.5,0.1,0.1)（:4077-4080）
 *  - ★SW-FX18 高尔夫球车 17：车头灯 5 束锥光（EmitGolfCartlight :4685-4703） */
/** Main.hslToRgb 直译（Main.cs:48695-48747 + hue2rgb :48724）——仙灵武库色光的
 *  色相轮基准；输入 [0,1) 相位，输出 0-255 RGB。dev 名 easter-egg 分支不在此表 */
export function fairyQueenHslToRgb(hue: number): [number, number, number] {
  const sat = 1, lum = 0.5;
  const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;   // :48709
  const p = 2 * lum - q;                                            // :48710
  const hue2rgb = (c: number): number => {
    let cc = c;
    if (cc < 0) cc += 1;
    if (cc > 1) cc -= 1;
    if (6 * cc < 1) return p + (q - p) * 6 * cc;
    if (2 * cc < 1) return q;
    if (3 * cc < 2) return p + (q - p) * (2 / 3 - cc) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(hue + 1 / 3) * 255),
    Math.round(hue2rgb(hue) * 255),
    Math.round(hue2rgb(hue - 1 / 3) * 255),
  ];
}

/** ★BJ704-G18（G17 登记债2/3）：DoSpawnDust/DoFailedDismountDust 的 56/61 尘色——
 *  Projectile.GetFairyQueenWeaponsColorFull(whoAmI, Center, 0.27, 1, 0.15, 1, 0.7)
 *  （Mount.cs:6399/:6501）通名支：hueRaw 0.27 → num=(0.27+0.5)%1=0.77,
 *  hslToRgb(0.77,1,0.7)（sat=1 时 lum0.7 ≡ 基色 lerp 白 0.4,同 pixieTrail :1769 式）
 *  → lerpToWhite 0.15 → A×1（Opacity 1/α乘 1 无改,恒 255）。dev 名分色表不建模
 *  （同 mountLights/pixieTrailDust 登记）。 */
function fairyQueenDustColor(): { r: number; g: number; b: number; a: number } {
  const base = fairyQueenHslToRgb((0.27 + 0.5) % 1);
  const lum07 = base.map((c) => c + (255 - c) * 0.4);            // luminance 0.7
  return {
    r: Math.round(lum07[0] + (255 - lum07[0]) * 0.15),           // lerpToWhite 0.15
    g: Math.round(lum07[1] + (255 - lum07[1]) * 0.15),
    b: Math.round(lum07[2] + (255 - lum07[2]) * 0.15),
    a: 255,
  };
}
/** ★BJ707-G29（BJ707-A 债③定谳）渲染帧采样口径族注——vanilla 坐骑光为 UpdateFrame/
 *  UpdateEffects 逐 tick Lighting.AddLight（Mount.cs :3481/:4077/:4811/:5392/:5447/
 *  Player.cs :21530 等）;本仓统一=渲染帧 drawMountLayer 背层逐帧 addLight
 *  （Renderer「坐骑灯惯例:次帧生效」）。值全为坐骑状态派生量（frame/charge/dash
 *  门/液色）→ tick 域与渲染域采样值恒同,仅刷新拍位差 ≤1 帧;LightingEngine
 *  perFrame 点光每周期消费后清空=任意刷新率无累积漂移。与 7/23/9/46 既有口径
 *  同族统一维持（62-65 见 case 注）——迁移 tick 域须动光照引擎累积通道,零可
 *  感知收益,备案不迁。新 case 沿本口径即免再登记。 */
export function mountLights(m: MountInstance, p: MountedPlayerView, ctx: MountLightCtx): MountLight[] {
  const out: MountLight[] = [];
  const d = m.data;
  if (!m.active || !d) return out;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const ctxTile = Math.trunc(cx / 16), ctyTile = Math.trunc(cy / 16);
  const lc = ctx.liquidColor;
  if (d.emitsLight && d.lightColor) {
    out.push({ tx: ctxTile, ty: ctyTile, r: d.lightColor[0], g: d.lightColor[1], b: d.lightColor[2] });
  }
  switch (m.type) {
    case 7: {
      // UFO 帧脉冲橙光（:3481）
      const num9 = Math.abs(2 - m.frame / 2) / 2;
      out.push({ tx: Math.trunc((p.x + p.w / 2) / 16), ty: Math.trunc((p.y + p.h / 2) / 16),
        r: 0.4, g: 0.2 * num9, b: 0 });
      break;
    }
    case 23: {
      // 扫帚挂件火光（:4811-4814）：挂件位 = 中心 + (29×dir,-4) + (摆角+π/2)×11
      const num = Math.max(-1, Math.min(1, p.vx / 10));
      const wind = ctx.wind ?? 0;
      const mc = ctx.miscCounter ?? 0;
      // 露天档（GetWitchBroomTrinketRotation :3596-3602）：InAPlaceWithWind → ×1，
      // 否则 ×0.5——摆角乘区与挂件火光共用同一旋转量
      let num2 = Math.sin(mc / 300 * Math.PI * 6) * (Math.PI / 4) * Math.abs(wind) * 0.5
        + Math.PI / 4 * -wind * 0.5;
      num2 *= ctx.windExposed === true ? 1 : 0.5;
      const rot = num * Math.sin(mc / 150 * Math.PI * 6) * (Math.PI / 4) * 0.5
        + num * (Math.PI / 4) * 0.5 + num2;
      const px = cx + 29 * p.facing + Math.cos(rot + Math.PI / 2) * 11;
      const py = cy - 4 + Math.sin(rot + Math.PI / 2) * 11;
      out.push({ tx: Math.trunc(px / 16), ty: Math.trunc(py / 16),
        r: 1 * 0.85, g: 0.75 * 0.85, b: 0.5 * 0.85 });
      break;
    }
    case 9: {
      // 眼部红光 ×充能比（:5392-5412）——瞄准中且充能 >0
      const chargeMax = d.abilityChargeMax ?? 0;
      const charge = chargeMax > 0 ? m.abilityCharge / chargeMax : 0;
      if (m.aiming && charge > 0) {
        const base = (m.frameExtra - SCUTLIX_EYE_FRAME_MIN) * 2;
        const xOff = d.xOffset ?? 0, yOff = d.yOffset ?? 0;
        for (let i = 0; i < 2; i++) {
          const eye = SCUTLIX_EYE_OFFSETS[base + i];
          if (!eye) continue;
          const ex = p.facing === -1 ? p.x + p.w / 2 - eye[0] - xOff : p.x + p.w / 2 + eye[0] + xOff;
          const ey = p.y + p.h + eye[1] + yOff;
          out.push({ tx: Math.trunc(ex / 16), ty: Math.trunc(ey / 16), r: 1 * charge, g: 0, b: 0 });
        }
      }
      break;
    }
    case 46: {
      // 炮口暖光 ×2 双点累加（:5447-5457）
      const chargeMax = d.abilityChargeMax ?? 0;
      const charge = chargeMax > 0 ? m.abilityCharge / chargeMax : 0;
      if (m.aiming && charge > 0) {
        const px = p.x + p.w / 2 + p.w * p.facing, py = p.y + p.h - 12;
        out.push({ tx: Math.trunc(px / 16), ty: Math.trunc(py / 16), r: 0.7, g: 0.4, b: 0.4 });
        out.push({ tx: Math.trunc(px / 16), ty: Math.trunc(py / 16), r: 0.7, g: 0.4, b: 0.4 });
      }
      break;
    }
    case 62: case 63: case 64: case 65: {
      // ★BJ707-A dash6 滑行光晕（Player.cs:21529-21530 DashMovement 同向滑行支逐拍
      //  AddLight(Center,rgb)——62/64 紫晕 (0.5,0.1,0.6) / 63/65 Ignis 橙晕 (0.6,0.3,0.1)）。
      //  门=p.dash>0∧p.dashDelay<0（同向滑行拍——收敛拍 dashDelay 已落 30 自然排除,
      //  ≙原文 dash==6 else 臂;渲染帧采样与 7/23/9/46 同口径）。尾尘在 Player.
      //  dashMovement m6 块（emitDashSlideDust dash6 支 8×d306/拍）。
      if ((p.dash ?? 0) > 0 && (p.dashDelay ?? 0) < 0) {
        const ignis = m.type === 63 || m.type === 65;
        out.push({ tx: ctxTile, ty: ctyTile,
          r: ignis ? 0.6 : 0.5, g: ignis ? 0.3 : 0.1, b: ignis ? 0.1 : 0.6 });
      }
      break;
    }
    case 12: {
      // 增益态液色光（:5038-5056）：Colors.CurrentLiquidColor 透明档——11 层
      // liquidAlpha 全 0 → Color.Transparent → 光贡献归零（ctx.liquidColor=null
      // 由调用方按"无可见液层"给出）。身前点（速度外推 10 帧），实心则退回身侧；
      // 落点门 = WorldGen.SolidTile（:5044）
      if (m.fishronBoost && lc) {
        const [lr, lg, lb] = [lc[0] / 255 * 0.4, lc[1] / 255 * 0.4, lc[2] / 255 * 0.4];
        const fx = cx + p.facing * 20 + p.vx * 10, fy = cy + p.vy * 10;
        const tx = Math.trunc(fx / 16), ty = Math.trunc(fy / 16);
        const solid = !!p.store && solidTileAt(p.store as unknown as SolidTileView, tx, ty);
        if (!solid) out.push({ tx, ty, r: lr, g: lg, b: lb });
        else out.push({ tx: Math.trunc((cx + p.facing * 20) / 16), ty: Math.trunc(cy / 16),
          r: lr, g: lg, b: lb });
      }
      break;
    }
    case 61: {
      // 仙灵武库 AddLight（Mount.cs UpdateFrame case 61 :3670-3673）：
      // GetFairyQueenWeaponsColorFull(playerIndex, Center, hueRaw=0.41, alphaMult=1,
      // lerpToWhite=0.1)（Projectile.cs:21791-22060 通名支：num=(hue+0.5)%1、sat=1、
      // lum=0.5 → hslToRgb(0.91,1,0.5)，lerpToWhite 0.1 向白插值）×0.55 于中心格。
      // dev 名 easter-egg 分色表（Cenx/Crowno/… switch :21800-22042）本仓无玩家名
      // 消费面，通名支即全量（登记）
      const num = (0.41 + 0.5) % 1;                                  // (hueRaw+0.5)%1
      const base = fairyQueenHslToRgb(num);                          // hslToRgb(num,1,0.5)
      const white = (c: number) => c * 0.9 + 255 * 0.1;              // Lerp(color,White,0.1)
      out.push({
        tx: ctxTile, ty: ctyTile,
        r: white(base[0]) * 0.55 / 255,
        g: white(base[1]) * 0.55 / 255,
        b: white(base[2]) * 0.55 / 255,
      });
      break;
    }
    case 14: {
      // 地下红光（:4077-4080）
      if (p.y > ctx.worldSurface * 16 + 160) {
        out.push({ tx: ctxTile, ty: ctyTile, r: 0.5, g: 0.1, b: 0.1 });
      }
      break;
    }
    case 17: {
      // ★SW-FX18 车头灯（EmitGolfCartlight :4685-4703，每帧无条件）：光源点 =
      // Bottom + (direction×40, −20)（:4664）；5 束光线，基准角 = direction==-1 ?
      // π : 0、间隔 π/32（num2）、单束长 200px = 12.5 格（num4/f_1）。沿线开放格
      // AddLight((0.7,0.7,0.7)×Lerp(0.65,1, dist/12.5))（DelegateMethods.cs:764-779
      // CastLightOpen_StopForSolids_ScaleWithDistance——越远越亮，首实心格截断
      // :772-775 → PlotTileLine 停线）。本仓按 1 格步长离散走线（×5 束）等价；
      // 束间重叠格逐束独立 AddLight = 原版加法语义。ShouldGolfCartEmitLight 恒
      // true（:4705-4707）无门。EmitGolfCartSmoke（:4667-4684）反编译零调用者
      // = 原版死码，不移植（登记）
      const hx = p.x + p.w / 2 + p.facing * 40;
      const hy = p.y + p.h - 20;
      const htx = Math.trunc(hx / 16), hty = Math.trunc(hy / 16);
      const base = p.facing === -1 ? Math.PI : 0;         // :4688-4692
      const st = p.store ? (p.store as unknown as SolidTileView) : null;
      const rays = 5, spread = Math.PI / 32, len = 200 / 16;   // num3/num2/num4÷16
      for (let k = 0; k < rays; k++) {
        const ang = base + spread * (k - (rays - 1) / 2); // :4696 num5-(num3/2)
        const ca = Math.cos(ang), sa = Math.sin(ang);
        // PlotTileLine 离散：0.5 格步进、格变更加光一次（vanilla 每线逐格一次），
        // 距离 = 格心到光源的沿线参数 t（1:1 喂 Lerp）；实心格截断（:772-775）
        let lastTx = NaN, lastTy = NaN;
        const steps = Math.ceil(len * 2);
        for (let s = 0; s <= steps; s++) {
          const t = (s / steps) * len;
          const tx = Math.trunc(htx + ca * t);
          const ty = Math.trunc(hty + sa * t);
          if (tx === lastTx && ty === lastTy) continue;
          if ((tx !== htx || ty !== hty) && st && solidTileAt(st, tx, ty)) break;
          lastTx = tx; lastTy = ty;
          const mul = 0.65 + (1 - 0.65) * Math.min(1, t / len);   // Lerp(0.65,1,d/f_1)
          out.push({ tx, ty, r: 0.7 * mul, g: 0.7 * mul, b: 0.7 * mul });
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** 物品 id（vanilla）→ 坐骑 id；非召唤物返回 -1 */
export function mountOfItem(vanillaItemId: number): number {
  const m = ITEM_TO_MOUNT[String(vanillaItemId)];
  return m === undefined ? -1 : m;
}

/** 坐骑 buff id → 坐骑 id（BuffID.Sets.MountType） */
export function mountOfBuff(buffId: number): number {
  const m = BUFF_TO_MOUNT[String(buffId)];
  return m === undefined ? -1 : m;
}

// ============================================================================
// 坐骑开火弹实体（Scutlix 眼激光 606 / Santank 炮击 930 / 子弹 14）
// ============================================================================
// ★通用湿段定谳（2026-09-06 溅花缺口杂项批）：
//   · 606 ScutlixLaser（SetDefaults :6533-6543）ignoreWater=true@:6542 → 豁免
//     （共享体整段门直跳）;14 Bullet（:953-965,4×4/aiStyle1/penetrate 1/extraUpdates 1）
//     无 ignoreWater 行 → 受段;930 SantankMountRocket（:8820-8827,14×14/aiStyle16/
//     penetrate −1/ranged）无 ignoreWater 行 → 受段（vanilla-projectiles.json 同向）。
//   · Update 全体（AI+湿段+HandleMovement）在 numUpdates 子步循环内
//     （:16781-17345）→ 湿段【每子步】各跑一次、采样位=本子步位移前;
//   · 湿阻尼（:17721-17764,湿支 wetVelocity=velocity×0.5）只进 UpdatePosition
//     :20561 位移行,velocity 场不减 → 乘进每子步位移（tileCollide 缺省 true）。
//   · AI 侧湿旗消费：AI_001 仅 type 469（:54969）、AI_016 仅 799/800/801/810/906/
//     784-807/903-905/1077 → 14/930 均无 → 溅花+旗维护即全部效果。

/** MountShot——坐骑能力弹（Projectile.NewProjectile 最小实体化，替代 TownShot 载体）：
 *  - extraUpdates 1:1（Projectile.extraUpdates+1 个子步/tick：606=3 子步 ×14 速 =
 *    42px/tick 与原版一致——TownShot 单步/tick 会使激光慢三倍）；
 *  - timeLeft 每tick 递减 1（子步不额外扣——原版 AI 多跑但 timeLeft 单调）；
 *  - 直线（noGravity）/ 抛物线两型；命中敌怪或实心 tile 即消散。
 *  ★930 圣坦炮击已拆出本类 → SantankShellProj（penetrate −1/归航/爆散全量）。 */
export class MountShot extends TownShot {
  /** 每 tick 子步数（extraUpdates + 1） */
  private substeps = 1;
  /** 重力加速度/tick（0 = 直线；TownShot 的 GRAV 常量不适用于 extraUpdates 子步） */
  gravity = 0.3;
  /** 落格标记（诊断用） */
  bounced = false;
  // ---- ★通用湿段旗（ProjWetFlags 同形;projectileWetSection 共享体逐子步维护）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐子步折减） */
  wetCount = 0;
  /** 出生预置已做（NewProjectile :10886-10892 等价;共享体首调自做） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number,
    projId: number, opts?: { noGravity?: boolean; gravity?: number; life?: number; extraUpdates?: number }) {
    super(x, y, vx, vy, damage, knockback, projId, { noGravity: true, life: opts?.life });
    const def = projectileData(projId);
    this.substeps = Math.max(1, (opts?.extraUpdates ?? def?.extraUpdates ?? 0) + 1);
    this.gravity = opts?.gravity ?? (opts?.noGravity === false ? 0.3 : 0);
    if (opts?.life !== undefined) this.life = opts.life;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (--this.life <= 0) {
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 timeLeft--/Kill 在子步【末尾】
      //  （:17307-17311,AI(:16880)→湿段(:16895)→位移→Damage 之后,且在 numUpdates
      //  子步环内）→ 寿命尽当拍湿段照跑（`!active` 门 :17132 只拦 Damage/尾尘）。
      //  本仓 life 拍头单减（子步不折减=既有登记口径）杀在湿段前曾整体跳过;现补跑
      //  一次,测位=存储位：AI 只写 velocity（重力）/帧/尘不写 position → 原版杀拍
      //  首子步湿段测位=上拍位移末位=存储位（余子步测位随死拍位移推进,死拍不可
      //  观测,登记有界）。杀支与子步内活拍调用点同拍互斥（早退）→ 无需
      //  wetSectionRan 旗;14 ∉ IsDestroyedByWater 六型/非 80,606 ignoreWater=true
      //  (:6542) → 段门恒闭,补跑零行为。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      this.dead = true;
      return;
    }
    for (let s = 0; s < this.substeps; s++) {
      this.vy += this.gravity;
      // ---- ★通用湿段（:16903-17113,共享体）——子步内 AI→湿段→位移位序（Update
      // 主体在 numUpdates 子步循环内 :16781-17345）;606 豁免直跳/14 受段（头注定谳）
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      // ★水中位移阻尼：速度【场】不减只削当拍位移（:17755→:20561）
      const df = projWaterDragFactor(this);
      this.x += this.vx * df;
      this.y += this.vy * df;
      const tx = Math.floor((this.x + this.w / 2) / TILE);
      const ty = Math.floor((this.y + this.h / 2) / TILE);
      if (game.world.store.isSolid(tx, ty)) { this.dead = true; this.bounced = true; return; }
      for (const ent of game.enemies()) {
        if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
        const e = ent as unknown as { x: number; y: number; w: number; h: number; dead: boolean;
          hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
            pierce?: number, fromPlayer?: boolean) => boolean; def?: { hitSound?: string[] } };
        if (e.dead || !projOverlap(this.x, this.y, this.w, this.h, e)) continue;
        e.hurt(applyBannerDamageDealt(game, e, this.damage), Math.sign(this.vx) * this.knockback, 0, game, 0, false, 0, true);   // 音/飘值=单点
        this.dead = true;   // penetrate 1 近似
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 圣坦炮击弹 930（SetDefaults Projectile.cs:8819-8827：14×14/aiStyle16/friendly/
// penetrate −1/ranged/timeLeft 继承 ResetDefaults 3600）——从 MountShot 的
// "penetrate 1 命中即消散"近似拆出为完整 aiStyle16 弹：
//   · AI_016 归航段（:48067-48180）：ai[0]++ 钳 30，>30 后索敌
//     NPC.CanBeChasedBy ∪ Collision.CanHit 中曼哈顿最近 <650px（:48143-48146），
//     目标向量 SafeNormalize(−UnitY)×12（:48175-48178 type==930 num23=12f）、
//     velocity=Lerp(velocity,value,1/12f)（:48180）；无目标外推 vel×100 直飞（:48169-48173）；
//   · 无限穿敌（penetrate=−1）命中不结算生死、只 localNPCImmunity 不设——vanilla 同名
//     连击由每 update 重复 Damage 判定（同帧内靠 invulnWindow 天然限频）；
//   · 触 tile（Damage() 管道 bounce：velocity.X!=lastVelocity.X 反射分支 :19863-19894）
//     → velocity×0/alpha=255/timeLeft=3 引信拍（lingering），timeLeft 尽 → Kill：
//     PrepareBombToBlow Resize(128×128)/kb8（:47680-47684）→ Damage()（重盒结算，
//     SelfHurtPlayers 对主人真伤 :15104 族）→ Kill_Bombs_DoUsualKillCode case133-930
//     Item_14 音 + d31×30/d6×20+20 爆尘（:79828-79856；视觉锚=弹心 22×22 收缩盒
//     :79837-79842——终清波批订正）+ gore 两轮四对角 Next(61,64)（:79861-79885,
//     GorePiece.newGore 通道,终清波批转正）。
// ---------------------------------------------------------------------------

export class SantankShellProj extends TownShot {
  /** 索敌半径（650f，:48143-48145 type==930 专属档；族基档 600 未用） */
  static SEEK_RANGE = 650;
  /** 收敛速度（12f，:48174-48178 type==930 档；族基档 16 未用） */
  static HOME_SPEED = 12;
  /** 巡航重力（弹以抛物线上抛出生,UseAbility case 46 :3304-3314） */
  gravity = 0.25;
  /** AI_016 不施加重力族（338-341/803-810/930 完全悬浮收敛——AI 无 velY 加项） */
  private ai0 = 0;
  /** 敌怪免工件窗（Damage 管道 per-target 门近似：被命中后 20t 内不再结算同目标） */
  private hitCd = new Map<number, number>();
  /** 已触 tile 的引信相（timeLeft=3 lingering） */
  private fuse = -1;
  /** 弹体透明度消费旗（诊断/渲染） */
  explodedAlpha = false;
  bounced = false;
  // ---- ★通用湿段旗（ProjWetFlags 同形;projectileWetSection 共享体逐子步维护）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐子步折减） */
  wetCount = 0;
  /** 出生预置已做（NewProjectile :10886-10892 等价;共享体首调自做） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number,
    projId: number, opts?: { gravity?: number; life?: number }) {
    super(x, y, vx, vy, damage, knockback, projId, { noGravity: false, life: opts?.life });
    this.gravity = opts?.gravity ?? 0.25;
  }

  /** AI_016 索敌：曼哈顿距 <seek、CanHit 视线、取最小（:48152-48168） */
  private findTarget(game: GameHooks): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bd = SantankShellProj.SEEK_RANGE;
    const px = this.cx, py = this.cy;
    const st = game.world.store;
    for (const ent of game.enemies()) {
      const n = ent as unknown as { x?: number; y?: number; w?: number; h?: number; maxHp?: number;
        dead?: boolean; def?: { friendly?: boolean; critter?: boolean } };
      if (!n || !n.def || n.dead || n.maxHp === undefined || (n.maxHp ?? 0) <= 5 || n.def.friendly || n.def.critter) continue;
      if (n.x === undefined || n.w === undefined) continue;
      const nx = (n.x ?? 0) + (n.w ?? 0) / 2, ny = (n.y ?? 0) + (n.h ?? 0) / 2;
      const dist = Math.abs(px - nx) + Math.abs(py - ny);      // 曼哈顿（:48158）
      if (dist >= bd) continue;
      // Collision.CanHit（:48159）——弹盒 → 敌整盒视线
      if (!canHitLine(st, this.x, this.y, this.w, this.h,
        n.x ?? 0, n.y ?? 0, n.w ?? 0, n.h ?? 0)) continue;
      bd = dist;
      best = { x: nx, y: ny };
    }
    return best;
  }

  /** 爆散（Kill 管线）：128×128 重结算盒 Damage + 主人自伤 + 爆尘音（注释同上） */
  private explode(game: GameHooks): void {
    this.explodedAlpha = true;
    const R = 64;                                  // Resize(128,128) 半径
    const bx = this.cx - R, by = this.cy - R;
    const box = { x: bx, y: by, w: R * 2, h: R * 2 };
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id?: number; dead: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
          pierce?: number, fromPlayer?: boolean) => boolean };
      if (e.dead) continue;
      if (box.x >= e.x + e.w || box.x + box.w <= e.x || box.y >= e.y + e.h || box.y + box.h <= e.y) continue;
      // DamageVar ±15%——★SW-T1 2026-09-04：单源 damageVarRoll（31 档离散+float32 域
      //  +ToEven+luck 重掷;原连续因子内联式退役）。消费面=爆散 NPC 面走 PrepareBombToBlow
      //  后标准 Damage() → Damage_PVE_Inner :12970 `Main.DamageVar(num15, owner.luck)`
      //  【luck 正向】（圣坦炮弹=玩家施放,owner=本地玩家）
      const dmg = Math.max(1, damageVarRoll(this.damage, game.player?.luck ?? 0));
      e.hurt(applyBannerDamageDealt(game, e, dmg), Math.sign(e.x + e.w / 2 - this.cx) * 8, 0, game, 0, false, 0, true); // kb=8(PrepareBombToBlow :47683)
    }
    // SelfHurtPlayers（Kill→friendly&&owner==myPlayer 分支 :71788-71795）：重盒相交伤主人
    const p = game.player;
    if (p && !p.dead && !(p as unknown as { immune?: boolean }).immune
      && box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) {
      p.lastDamageCause = { kind: 'projectile', name: 'Santank Cannon' };
      // ★SW-T1：自伤面=SelfHurtPlayers :15118 `Main.DamageVar(value, 0f - localPlayer.luck)`
      //  【luck 取负:厄运→重掷取 min 伤更大】——与 NPC 面 :12970 正向相反,两 face 勿混
      //  （SW-X1 2026-09-04 引注勘误,曾 :15122）
      p.damage(Math.max(1, damageVarRoll(this.damage, -p.luck)),
        Math.sign(p.cx - this.cx) || 1, 0, game as never);
    }
    game.playSfxFile?.('Item_14', 0.9, this.cx, this.cy);
    // ★终清波批：视觉锚订正——vanilla Kill 前把盒收缩回 22×22 中心（position±w/2,
    // :79838-79842），d31/d6/gore 全部以【弹心 ±11】为生成窗;旧实现误用 128×128
    // 爆炸结算盒左上角作锚(伤害盒仅 PrepareBombToBlow 用,视觉不入)
    const gx = this.cx - 11, gy = this.cy - 11;
    // gore 段转正（GorePiece.newGore 可用——旧"无 API 不接"登记退役）：
    // 两轮 num61=0.4/0.8 × 四对角 NewGore(Next(61,64))、vel×k 后 X/Y 各 ±1（:79861-79885）
    for (let round = 0; round < 2; round++) {
      const k = round === 0 ? 0.4 : 0.8;
      const dirs: Array<[number, number]> = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
      for (const [sx2, sy2] of dirs) {
        const g = GorePiece.newGore(61 + Math.floor(Math.random() * 3), gx, gy, 0, 0);
        if (!g) continue;
        g.vx *= k; g.vy *= k;
        g.vx += sx2;
        g.vy += sy2;
      }
    }
    // ★BJ306（2026-09-23 BJ303 姊妹崩点普查刀）：spawnDust 同 spawnBurst 家族——
    // detach 裸调用 this=undefined，Game.spawnDust 首句 this.vanillaDust
    // （Game.ts:44036）抛 TypeError → 圣坦炮弹爆散拍崩。bind 保下方 pool(...)
    // 调用点不变；if (pool) 守卫语义不变（缺省=走 spawnBurst 兜底臂）。
    const pool = game.spawnDust?.bind(game);
    if (pool) {
      for (let i = 0; i < 30; i++) {
        const d = pool(gx, gy, 22, 22, 31, 0, 0, 100, null, 1.5);   // d31 ×30（:79843-79848）
        if (d) { d.vx *= 1.4; d.vy *= 1.4; }
      }
      for (let i = 0; i < 20; i++) {                                // d6 大烟 ×20（noGravity,scale3.5,×7）
        const d = pool(gx, gy, 22, 22, 6, 0, 0, 100, null, 3.5, true);
        if (d) { d.vx *= 7; d.vy *= 7; }
      }
      for (let i = 0; i < 20; i++) {                                // d6 小烟 ×20（scale1.5,×3）
        const d = pool(gx, gy, 22, 22, 6, 0, 0, 100, null, 1.5);
        if (d) { d.vx *= 3; d.vy *= 3; }
      }
    } else {
      game.spawnBurst?.(this.cx, this.cy, '#E8A24A', 24, 5, 0, Math.PI * 2, { life: 26 });
    }
    this.dead = true;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    for (const [k, v] of this.hitCd) { if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1); }
    // ---- 引信相（触 tile 后 timeLeft=3 lingering：定格+隐身+重盒 Damage 一拍） ----
    if (this.fuse >= 0) {
      // ★湿段照跑（原版引信相弹仍 active,Update 子步不跳湿段;静止位只可能入水
      // 溅花一次——搁水炮弹溅花=原版面）;AI 杀拍（引信爆）段后即死,原文序一致
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      if (--this.fuse <= 0) this.explode(game);
      return;
    }
    // ---- AI_016 主段：先位移子步（重力）再归航 lerp ----
    const substeps = 2;                            // extraUpdates=1（vanillaProjectiles 930）→ 2 子步
    for (let s = 0; s < substeps; s++) {
      this.vy += this.gravity / substeps;          // AI_016 本型族无重力项——悬浮收敛前保留出膛抛线手感
      this.ai0++;
      // 归航门 ai[0]>30（:48149——ai[0] 每 update 递增,extraUpdates=1 → 本仓子步计数
      // 同口径;cap 钳 30 后恒索敌）
      const seek = this.ai0 > 30 ? this.findTarget(game) : null;
      let tx: number, ty: number;
      if (seek) { tx = seek.x; ty = seek.y; }
      else {
        tx = this.cx + this.vx * 100;              // :48171-48172 无目标外推
        ty = this.cy + this.vy * 100;
      }
      let dx = tx - this.cx, dy = ty - this.cy;
      const len = Math.hypot(dx, dy);
      if (len > 0.0001) { dx /= len; dy /= len; } else { dx = 0; dy = -1; }  // SafeNormalize(-UnitY)
      dx *= SantankShellProj.HOME_SPEED; dy *= SantankShellProj.HOME_SPEED;
      // Vector2.Lerp(velocity, value, 1/12f) 子步口径各半
      const t = 1 / 12 / substeps;
      this.vx += (dx - this.vx) * t;
      this.vy += (dy - this.vy) * t;
      // ---- ★通用湿段（:16903-17113,共享体）——AI→湿段→位移位序;930 受段（头注）
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      // ★水中位移阻尼：速度【场】不减只削当拍位移（:17755→:20561）
      const df = projWaterDragFactor(this);
      this.x += this.vx * df; this.y += this.vy * df;
      // 触 tile（tileCollide=true 默认）→ 入引信相
      const sttx = Math.floor(this.cx / 16), stty = Math.floor(this.cy / 16);
      if (sttx >= 0 && stty >= 0 && sttx < game.world.store.w && stty < game.world.store.h
        && game.world.store.isSolid(sttx, stty)) {
        this.vx = 0; this.vy = 0;                  // :19891 velocity *= 0
        this.explodedAlpha = true;                 // alpha = 255（:19892,渲染侧隐身）
        this.bounced = true;
        this.fuse = 3;                             // timeLeft = 3（:19893）
        break;
      }
      // 无限穿敌（penetrate=-1）：命中结算但不死；per-target 免工件窗防连帧连击
      for (const ent of game.enemies()) {
        if (!playerCanHitEnemy(ent, game)) continue;
        const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean;
          hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
            pierce?: number, fromPlayer?: boolean) => boolean };
        if (e.dead || !projOverlap(this.x, this.y, this.w, this.h, e)) continue;
        if ((this.hitCd.get(e.id) ?? 0) > 0) continue;
        // ★SW-T1：飞行命中面=Damage_PVE_Inner :12970 `Main.DamageVar(num15, owner.luck)`
        //  【luck 正向】,DV 在旗乘区（applyBannerDamageDealt）前——原版同序
        const dmg = Math.max(1, damageVarRoll(this.damage, game.player?.luck ?? 0));
        e.hurt(applyBannerDamageDealt(game, e, dmg), Math.sign(this.vx) * this.knockback, 0, game, 0, false, 0, true);
        this.hitCd.set(e.id, 10);
      }
    }
    if (--this.life <= 0) { this.explode(game); }  // timeLeft 尽 → Kill 爆散（3600s 档罕至）
  }

  draw(r: Renderer, cam: Camera): void {
    if (this.explodedAlpha && this.fuse >= 0) return;   // 引信相 alpha=255 不可见（:19892）
    super.draw(r, cam);
  }
}
