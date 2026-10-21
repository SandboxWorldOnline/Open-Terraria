/** 坐骑数据表（Mount.cs Initialize() 提取,vanilla-mounts.json 投影）+ MountData 结构类型。
 *  ★2026-09-03 自 entities/Mounts.ts 抽出为叶子数据模块（红蓝对抗 R4-F5b：Minecart.ts
 *  顶层裸块读 MOUNT_DATA 建 CART_MOUNT_TEXTURES,而 Mounts 的 import 子树经
 *  Renderer 回流 Minecart——Mounts 触达序一旦提前即 TDZ,与已除师的 items→devices/
 *  Wiring 同型）。纯数据无依赖叶子;Mounts.ts re-export 兼容全部既有消费方。 */
import mountJson from './vanilla-mounts.json';


export interface MountData {
  buff: number;
  /** 变身坐骑（52/54-56/61）与滚轴鞋（57-60）原版未设 = 0 */
  heightBoost?: number;
  flightTimeMax?: number;
  fatigueMax?: number;
  fallDamage?: number;
  extraFall?: number;
  runSpeed: number;
  dashSpeed?: number;
  swimSpeed?: number;
  acceleration: number;
  jumpHeight: number;
  jumpSpeed: number;
  usesHover?: boolean;
  constantJump?: boolean;
  blockExtraJumps?: boolean;
  abilityChargeMax?: number;
  abilityDuration?: number;
  abilityCooldown?: number;
  walkingGraceTimeMax?: number;
  totalFrames: number;
  playerYOffsets?: number[];
  xOffset?: number;
  yOffset?: number;
  playerHeadOffset?: number;
  bodyFrame?: number;
  spawnDust?: number;
  /** ★BJ704-G18（G17 债2/3）Mount.cs:203 spawnDustNoGravity——出生/下坐失败尘的
   *  noGravity 直置腿（DoSpawnDust :6593/DoFailedDismountDust :6423 消费;vanilla-
   *  mounts.json 已提取:7/23/61 true,余 false 缺省） */
  spawnDustNoGravity?: boolean;
  Minecart?: boolean;
  CanRideMinecartTracks?: boolean;
  CanUseWings?: boolean;
  emitsLight?: boolean;
  lightColor?: number[];
  standingFrameStart?: number; standingFrameCount?: number; standingFrameDelay?: number;
  runningFrameStart?: number; runningFrameCount?: number; runningFrameDelay?: number;
  flyingFrameStart?: number; flyingFrameCount?: number; flyingFrameDelay?: number;
  inAirFrameStart?: number; inAirFrameCount?: number; inAirFrameDelay?: number;
  idleFrameStart?: number; idleFrameCount?: number; idleFrameDelay?: number;
  idleFrameLoop?: boolean;
  swimFrameStart?: number; swimFrameCount?: number; swimFrameDelay?: number;
  dashingFrameStart?: number; dashingFrameCount?: number; dashingFrameDelay?: number;
  backTexture?: string; frontTexture?: string;
  backTextureExtra?: string; frontTextureExtra?: string;
  backTextureGlow?: string; frontTextureGlow?: string;
  /** Mount.Draw drawType 3 发光层（:5534 frontTextureExtraGlow——钻头二极管
   *  DrillMount[5]→Mount_Glow_DrillDiode；提取器 slot 表曾漏此键，钻头 8 已手补） */
  frontTextureExtraGlow?: string;
}

/** id → 数据（Mount.cs Initialize() 提取） */
export const MOUNT_DATA: Record<string, MountData> = mountJson.mounts;
