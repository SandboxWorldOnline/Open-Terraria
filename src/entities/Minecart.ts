import { playerHurtFloatColor } from '../fx/CombatTextColors';
import { BuffType } from '../stats/Buffs';
// 矿车坐骑实体（原版语义 = Mount：坐骑位锁定 + Minecart.cs 轨道跟随运动学）。
// 原版矿车不是独立实体——玩家 mount 后玩家 hitbox 即车（20×(42+heightBoost)），
// 每帧走 Player.cs:27783-27850 的 TrackCollision 段 + 常规 DryCollision。本作以
// props 实体承载同一状态，fixedUpdate 跑 1:1 运动学，玩家位置每 tick 回写
//（Player.ridingCart 封常规移动）。
//
// ★通用湿段定谳（2026-09-06 溅花缺口杂项批）：矿车 = Mount 非 projectile（Projectile.cs
// 无矿车弹型;原版矿车湿态表现走 Player 湿段/NPC 液体域,不属 :16903 全体弹共用段）
// → 不接 projectileWetSection（N/A）。本文件唯二弹型载体：CartLaserBeam = 弹 591
// MinecartMechLaser 的【纯视觉数据结构】（SetDefaults :6400-6410,ignoreWater=true
// @:6409 → 本就豁免;且 damage 发射拍落账后归零,余下弹体纯视觉 aiStyle101 :31987-32029,
// 不跑实体 tick）→ 无湿段面。
// 坐骑参数按矿车族逐型取 Mount.cs mounts[n]（tools/extract-mounts.mjs 提取的
// vanilla-mounts.json）：
//   6  Minecart          13/13/0.04/15/5.15  heightBoost 10
//   11 MinecartMech      13/13/0.04/15/5.15  heightBoost 12
//   13 MinecartWood      10/10/0.03/12/5.15  heightBoost 10（默认矿车，无召唤物品）
//   39 DiggingMoleMinecart 6/6/0.02/15/5.15 heightBoost 10
//   其余 24 种 13/13/0.04/15/5.15 heightBoost 10
// 升级套件（5289 解锁 UsingSuperCart，Mount.cs:480-506/_shouldSuperCart）整体覆写：
//   runSpeed/dashSpeed 20、acceleration 0.1、jumpHeight 15、jumpSpeed 5.15
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { minecartNpcRampage } from './MountCombat';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import {
  canKillTileAt, checkTileBreakabilityAt, shouldTileSurviveAt,
  type KillTileCtx, type MountData,
} from './Mounts';
import { MOUNT_DATA } from '../data/mountData';   // ★叶子直读（红蓝对抗 R4-F5b TDZ 断环,顶层 CART_MOUNT_TEXTURES 块消费）
import { nextVector2Circular } from './SparkleGuitarProj';   // ★G32③ NextVector2Circular 单源（Utils.cs:1301-1304 角度×半径两掷）
import { canHitLine } from '../physics/LineOfSight';
import { applyBannerDamageDealt } from './projTargets';
import type { TileStore } from '../world/TileStore';
import { TILE_DEFS } from '../data/tiles';
import { ITEM_DEFS } from '../data/items';

import { playerCanHitEnemy } from './projTargets';
import {
  trackCollision, trackRotation, onTrack,
  FLAG_ON_TRACK, FLAG_BOUNCY_BUMPER, FLAG_USED_RAMP, FLAG_HIT_SWITCH,
  FLAG_BOOST_LEFT, FLAG_BOOST_RIGHT,
  CART_TEXTURE_WIDTH, PLAYER_DEFAULT_GRAVITY, TRACK_BOOST_DELTA,
  TRACK_TILE, placeTrack, frameTrackArea, areSidesMetForTrack, tryFittingTileOrientation,
  magnetPosition,
} from '../world/MinecartTrack';

/** 坐骑族贴图（CART_MOUNT_TEXTURES）由 Game.ts 经 mountIdOfTexture 消费 */
export const CART_MOUNT_TEXTURES: Record<number, string> = {};
{
  for (const id of Object.keys(MOUNT_DATA)) {
    const d: MountData = MOUNT_DATA[id];
    if (d.Minecart && d.frontTexture) {
      CART_MOUNT_TEXTURES[Number(id)] = `vanilla/${d.frontTexture}`;
    }
  }
}

/** 默认矿车 = Wooden Minecart（mount 13；Player.cs:22401 `int num4 = 13`——
 *  未装备矿车族物品时右键/QuickMinecart 上的是木质车，无需任何物品） */
export const WOOD_CART_MOUNT = 13;
export const DEFAULT_CART_TEXTURE = CART_MOUNT_TEXTURES[WOOD_CART_MOUNT]
  ?? 'vanilla/Mount_MinecartWood.png';

/** SuperCart 覆写常量（Mount.cs:371-379 SuperCart*） */
const SUPER_CART_RUN_SPEED = 20;
const SUPER_CART_DASH_SPEED = 20;
const SUPER_CART_ACCELERATION = 0.1;
const SUPER_CART_JUMP_HEIGHT = 15;
const SUPER_CART_JUMP_SPEED = 5.15;
/** Player.maxFallSpeed 默认 10f（Player.cs:27039-27043 落速钳） */
const MAX_FALL_SPEED = 10;
/** Player.cs:26349 脱轨落地（onWrongGround）时的 runSlowdown；贴轨时 = runAcceleration（:26357） */
const WRONG_GROUND_SLOWDOWN = 0.2;
/** 摔伤起步格数（Player.cs:25005-25010 num9 = 25 + extraFall；矿车 ExtraFall=0） */
const FALL_SAFE_TILES = 25;
/** 摔伤每格伤害（Player.cs:25074 num17 = (num10-num9) × 10） */
const FALL_DMG_PER_TILE = 10;

/** 鼠马车坐骑 id（MountID.DiggingMoleMinecart，MountID.cs:112） */
export const MOLE_CART_MOUNT = 39;
/** 普通轨道物品 vid（MinecartDiggerHelper.cs:81 `item.type == 2340`） */
export const TRACK_ITEM_VID = 2340;
/** SuperCart 机械激光伤害（Mount.cs:5212 `int damage = 60`） */
export const SUPER_CART_LASER_DMG = 60;
/** 激光锥半张角（Mount.cs:5218 `< MathF.PI / 4f`） */
const LASER_CONE = Math.PI / 4;

/** 轮火花尘型（DelegateMethods.Minecart.Sparks* 五实现，DelegateMethods.cs:224-420） */
export type CartDustKind = 'sparks' | 'sparksFart' | 'sparksTerraFart' | 'sparksMeow' | 'sparksMech';
/** 各坐骑的 MinecartDust 委派（Mount.cs mounts[n] 段）：
 *  33 MeowmereMinecart→SparksMeow(:988) / 51 FartMinecart→SparksFart(:1074) /
 *  53 TerraFartMinecart→SparksTerraFart(:1082) / 11 MinecartMech→SparksMech(:1462)；
 *  其余全部 → Sparks（6:891 / 16:1022 / 13:1570 / SetAsMinecart 默认 :2708） */
export const CART_DUST_KIND: Record<number, CartDustKind> = {
  33: 'sparksMeow', 51: 'sparksFart', 53: 'sparksTerraFart', 11: 'sparksMech',
};
/** 尘型分派（未登记坐骑 = 默认 Sparks） */
export function cartDustKindOf(id: number): CartDustKind {
  return CART_DUST_KIND[id] ?? 'sparks';
}

// ★BJ709-G32③（2026-10-24,G31 登记债④任务书落地——census 定谳注转实现锚）:
//  cMinecart 尘染料通道（miscDyes[2],Player.cs:9688 cMinecart=miscDyes[2].dye,
//  Player.minecartDyeVid() 同 mountDyeVid 径单源）+七尘面 1:1（下方
//  updateEffectsDust 派发,原 census 全量锚）:
//  · doGemMinecartEffect（Mount.cs:4742-4756,调用=UpdateEffects case 25-30
//    尘 86-91/case 31 Amber 尘 262——1/10 掷,NextVector2Square(-1,1)×(22,10)+
//    Directions(0,10) 旋 RotatedRelativePoint,noGravity/fadeIn 0.6/scale 0.4/
//    速×0.25）;
//  · doSteamMinecartEffect（:4759-4776,调用=case 36 Steampunk 尘 303——|vx|≥1
//    掷（<6 另需 _frame==0→animFrame）,位 Center+(-10,-4)·Directions+随机±3,
//    scale 1.8,速×0.25 后 vy−2）;
//  · doExhaustMinecartEffect（:4778-4812,调用=case 32 Beetle 尘 31——|v|<1 时
//    1/4 掷续,发 1+(int)|v|/6 粒,位 Center+(-18,20)·Directions+随机±3+速堆叠,
//    速×0.2,低速 vx−0.5·dir）;
//  · doConfettiMinecartEffect（:4814-4852,调用=case 34 Party——尘 139+Next(4)
//    纸屑,num3 首掷×2 复用（scale 0.5+num3/2）,低速 vx−0.5·dir）;
//  · mechTrailDust（case 11 MinecartMech 轨迹尘 182 :5072-5135 尘面,新老位距
//    >3px 按距离 Lerp 铺 1 粒/3px,customData=player 旧位一次性跟随,else 单粒
//    钉位;case 11 五点光 :5084-5094（G32-D1）已随 ★BJ709-G34 清偿=mechCartLights
//    纯函数+Renderer 车身块前置渲染帧注入,坐骑灯惯例）;
//  · hellMinecartDust（case 22 Hell 尘 65 :5136-5178 尘面,|v|/5 钳 0-1 概率铺
//    11 点轨迹【!(rand<num6) 门=越慢越密】,1/10 fadeIn 1.3+随机圆速;
//    case 22 lavaMax+=420 装备面（G32-D2）已随 ★BJ709-G34 清偿=fixedUpdate
//    装备面块逐拍写 p.cartLavaMaxBonus,Player 岩浆段聚合消费+:27930 无条件
//    钳;G32-D3 shadowPos 采样 gfxOffY 域差同刀窄修（Player.updateSocialShadow
//    采样并入 cart.gfxOffY 轨面项,见其 ★BJ709-G34 注）。
//  全七面 d.dyeVid=minecartDyeVid()（GetSecondaryShader(cMinecart) 镜像）;
//  SparksMeow 固定 shader（DelegateMethods.cs:401 GetShaderFromItemId(2870),
//  非 cMinecart）另案勿混（wheelSparkDust 注在案）。

/** SuperCart 防御加成（Mount.cs:4797-4798）：
 *  num = 1 + |vx|/RunSpeed × 2.5 → statDefense += (int)(2 × num)。
 *  RunSpeed 取 _shouldSuperCart 生效档（恒 20，Mount.cs:480-486） */
export function superCartDefenseBonus(absVx: number, runSpeed: number): number {
  return Math.trunc(2 * (1 + (absVx / runSpeed) * 2.5));
}

/** ★BJ709-G34（G32-D1 清偿）:case 11 机械矿车五点光（Mount.cs:5072-5094
 *  UpdateEffects case 11 头段）。num8=1+|vx|/RunSpeed×2.5（RunSpeed=Mount 实例
 *  getter :453-486:SuperCart 档 20 / 常档 MountData.runSpeed=13）;vector5=
 *  (0.4,0.12,0.15)×num8（:5074/:5085）;五点=mountedPlayer 的 Center/Top/Bottom/
 *  Left/Right（骑乘盒=车盒 20×(42+heightBoost),SetMount PlayerSize 委派改盒
 *  :6309-6320）各过 Lighting.AddLight(Vector2)=世界坐标 tile 下取整
 *  （Lighting.cs:144-148）。netMode==2 服务器早退门（:5081-5084）=单机域不适用。
 *  渲染帧采样=坐骑灯惯例（Mounts.ts mountLights 族注:状态派生量 tick/渲染域
 *  同值,刷新拍位差 ≤1 帧）;消费面=Renderer 矿车车身绘制块前置注入。 */
export function mechCartLights(x: number, y: number, w: number, h: number,
  absVx: number, runSpeed: number): Array<{ tx: number; ty: number; r: number; g: number; b: number }> {
  const num8 = 1 + (absVx / runSpeed) * 2.5;                    // :5075
  const r = 0.4 * num8, g = 0.12 * num8, b = 0.15 * num8;       // :5074 ×:5085
  const cx = x + w / 2, cy = y + h / 2;
  return [
    { tx: Math.floor(cx / 16), ty: Math.floor(cy / 16), r, g, b },        // :5086 Center
    { tx: Math.floor(cx / 16), ty: Math.floor(y / 16), r, g, b },         // :5087 Top
    { tx: Math.floor(cx / 16), ty: Math.floor((y + h) / 16), r, g, b },   // :5088 Bottom
    { tx: Math.floor(x / 16), ty: Math.floor(cy / 16), r, g, b },         // :5089 Left
    { tx: Math.floor((x + w) / 16), ty: Math.floor(cy / 16), r, g, b },   // :5090 Right
  ];
}

/** 轮火花速度档（Player.cs:19585-19596 / 19643-19654）：
 *  |vx| > 0.66×maxRunSpeed → 档 2（0.66/0.33/0 三个 Next(2) 掷位）；
 *  |vx| > 0.33×maxRunSpeed → 档 1（0.5/0 两个 Next(3) 掷位）；
 *  否则档 0（原位恒一发） */
export function wheelSparkTier(absVx: number, maxRunSpeed: number): 0 | 1 | 2 {
  if (Math.abs(absVx) > maxRunSpeed * 0.66) return 2;
  if (Math.abs(absVx) > maxRunSpeed * 0.33) return 1;
  return 0;
}

/** MathHelper.WrapAngle（XNA）：折回 (-π, π] */
function wrapAngle(x: number): number {
  x = (x + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
}

/** SuperCart 机械激光束（Projectile 591 MinecartMechLaser）。原版发射即
 *  Projectile.NewProjectile + damage=60 + Damage() 后 damage=0（Mount.cs:5224-5228）
 *  ——伤害当场结算，余下的弹体纯视觉（aiStyle 101，Projectile.cs:6117-6126 /
 *  :31987-32029：20t 淡出 + 尾随玩家 + 玩家反向即灭）。591 无 melee/ranged/
 *  magic 旗（SetDefaults 未置，Projectile.cs:490-492 默认全 false）→ 永不暴击。
 *  束源 = (-20,-39) 档 mech 点；束向 = 源→目标盒内随机点（:5221 RandomVector2） */
export interface CartLaserBeam {
  /** 相对车位的束源偏移（每 tick 重锚 = position += playerΔ，aiStyle101 :32016） */
  dx: number; dy: number;
  /** 束向量（源→目标，长度即束长） */
  vx: number; vy: number;
  /** 发射向水平符号（玩家反向即灭门 :32020-32024） */
  dirX: number;
  /** localAI[0]（:31988 起 20t） */
  age: number;
}

export class Minecart extends Entity {
  /** 矿车坐骑 id（MountID.Sets.Cart 族；默认 6，Game.ts 按物品/木质车覆写） */
  mountId = 6;
  /** 车身宽度（Player.width 恒 20，坐骑不改宽） */
  w = 20;
  /** 车身高度 = 42 + mounts[mountId].heightBoost（Mount.cs 每型 heightBoost） */
  h = 52;
  mounted = false;          // 玩家骑乘中
  dead = false;
  /** 坐骑贴图（Mount.frontTexture 文件名，atlas.ensureVImage 懒加载） */
  texture = DEFAULT_CART_TEXTURE;
  /** 坐骑发光层（Mount.frontTextureGlow——Mount.Draw :5523 case 2 同帧二次 Draw，
   *  加色管线；机械矿车 11 = MinecartMechGlow，Mount.cs:1506。null = 无发光层） */
  textureGlow: string | null = null;
  /** 升级套件已解锁（Player.UsingSuperCart → SuperCart* 常量） */
  superCart = false;
  /** 车身朝向翻转（撞弹性挡板时随输入翻；Player.cartFlip） */
  cartFlip = false;
  /** 车身倾角（Player.fullRotation = TrackRotation 的 atan2） */
  rotation = 0;
  /** 纵向贴轨绘制偏移（TrackRotation 返回值 = Player.gfxOffY） */
  gfxOffY = 0;
  /** 本 tick 是否在轨（Player.onTrack） */
  onTrackNow = false;
  /** 脱轨落地（Player.onWrongGround：vy==0 且磁石位无轨，:26344-26360） */
  onWrongGround = false;
  /** 跳跃剩余 tick（Player.jump = Mount.JumpHeight；每 tick vy=-jumpSpeed） */
  jump = 0;
  jumpSpeed = 5.15;
  /** 加速轨道累积（Player.trackBoost：下帧并入 vx，钳 ±maxRunSpeed） */
  trackBoost = 0;
  /** 斜坡起飞动画计时（Player.cartRampTime = min(1,|vx|/RunSpeed)*20；
   *  >0 期间重力停摆只递减，Player.cs:27031-27037） */
  cartRampTime = 0;
  /** 轮组动画 tick（Mount runningFrame 3 帧 × delay 12） */
  animTick = 0;
  /** TrackCollision 的 lastBoost（加速轨去重：同格不重复给速） */
  lastBoostX = 0;
  lastBoostY = 0;
  /** 摔伤追踪（Player.fallStart：开始下落的 tile Y） */
  fallStart = 0;
  /** SuperCart 机械激光余辉（Projectile 591 视觉束，见 CartLaserBeam 注释） */
  laserBeams: CartLaserBeam[] = [];

  private prevJump = false;
  private prevInputX = 0;
  /** 上 tick 落地标记（onWrongGround 判定的 vy==0 取上 tick 碰撞后态） */
  private wasGrounded = false;

  private get mdata(): MountData | null {
    return MOUNT_DATA[String(this.mountId)] ?? null;
  }

  /** 应用坐骑型参数（构造/上车时一次）：h = 42 + heightBoost（Mount.GetHeightBoost） */
  applyMountStats(): void {
    const hb = this.mdata?.heightBoost ?? 10;
    this.h = 42 + hb;
    // 贴图/发光层随坐骑档取（机械矿车 11 → MinecartMech/Glow，Mount.cs:1505-1506；
    // 其余矿车族 frontTextureGlow 恒 Empty → null）。与 Game.mountMinecartAt 的
    // cart.texture 赋值同式（CART_MOUNT_TEXTURES[mountId] ?? DEFAULT）——实体自洽
    this.texture = CART_MOUNT_TEXTURES[this.mountId] ?? DEFAULT_CART_TEXTURE;
    this.textureGlow = this.mdata?.frontTextureGlow ?? null;
  }

  // ---- 坐骑参数（Mount.cs RunSpeed/DashSpeed/Acceleration getter :480-506 +
  //      JumpHeight/JumpSpeed :2786-2816：_shouldSuperCart 优先整体覆写） ----
  get runSpeed(): number {
    return this.superCart ? SUPER_CART_RUN_SPEED : this.mdata?.runSpeed ?? 13;
  }
  get dashSpeed(): number {
    return this.superCart ? SUPER_CART_DASH_SPEED : this.mdata?.dashSpeed ?? this.mdata?.runSpeed ?? 13;
  }
  get acceleration(): number {
    return this.superCart ? SUPER_CART_ACCELERATION : this.mdata?.acceleration ?? 0.04;
  }
  get jumpHeight(): number {
    return this.superCart ? SUPER_CART_JUMP_HEIGHT : this.mdata?.jumpHeight ?? 15;
  }
  /** 本型基础跳跃速度（SuperCart 覆写后 SuperCartJumpSpeed 5.15，Mount.cs:279-2812） */
  get baseJumpSpeed(): number {
    return this.superCart ? SUPER_CART_JUMP_SPEED : this.mdata?.jumpSpeed ?? 5.15;
  }
  /** 摔伤系数（mounts[n].fallDamage，矿车族恒 1） */
  get fallDamageFactor(): number { return this.mdata?.fallDamage ?? 1; }

  draw(r: Renderer, _cam: Camera): void {
    // ---- SuperCart 机械激光余辉（Projectile 591，aiStyle 101 的视觉段）----
    // GetAlpha（Projectile.cs:76276-76279）：alpha = Lerp(0,255,age/20) →
    // RGB = 255-alpha、通道 α = 63-alpha/4（即随龄淡出）；束沿发射向量画到
    // 目标点（束长 = |v|，束端 = 目标盒内随机点）；每 tick 束源重锚车位
    if (this.laserBeams.length) {
      const ctx = r.ctx;
      if (ctx) {
        ctx.save();
        ctx.lineCap = 'round';
        for (const b of this.laserBeams) {
          const a = Math.min(255, 255 * (b.age / 20));
          const alpha = Math.max(0, (63 - a / 4) / 255);
          ctx.strokeStyle = `rgba(${255 - a | 0},${255 - a | 0},${255 - a | 0},${alpha})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(this.x + b.dx, this.y + b.dy);
          ctx.lineTo(this.x + b.dx + b.vx, this.y + b.dy + b.vy);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    // 骑乘中由 Renderer.drawPlayer 叠画（原版 frontTexture 在玩家之前层）；
    // 未骑乘的矿车原版不存在（坐骑 buff 结束即消失）——保留贴图绘制仅作调试残留态
    if (this.mounted) return;
    const img = r.atlas?.ensureVImage(this.texture);
    const ctx = r.ctx;
    if (!ctx || !img) return;
    const fh = Math.floor(img.height / 3);
    ctx.drawImage(img, 0, 0, img.width, fh,
      this.x + this.w / 2 - CART_TEXTURE_WIDTH / 2, this.y + this.h / 2 - fh / 2,
      img.width, fh);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (!this.mounted) { this.dead = true; return; }   // 坐骑语义：无骑乘即消亡
    const p = game.player;
    // ★G32③：oldPosition 快照（Player.cs:28281 语义=上一拍末位,本拍位移段前）——
    //  Mech 轨迹尘 182 新老位距 Lerp 锚（Mount.cs:5109-5111）消费。复用 Entity
    //  .oldX/oldY 同名字段（弹幕 switchTilesScan 路由只扫 entities.projectiles,
    //  矿车在 props 桶=零耦合,见 Game.ts:32326）。
    this.oldX = this.x; this.oldY = this.y;
    const st = game.world.store;
    const maxRun = this.runSpeed;

    // ★骑乘者被肉山舌头拖拽时本 tick 让位（vanilla :28384 tongued 积分为顶层分支,
    //   覆盖矿车运动=位置权威在玩家,车随人锚定;Player.fixedUpdate 骑乘分支
    //   tongued 时已位移玩家——此处锁车到玩家并跳过贴轨运动学,拖回释放后按
    //   onWrongGround 语义重判脱轨/下车。2026-09-02 评审补）
    if (p.buffs.has(BuffType.TheTongue)) {
      this.x = p.x;
      this.y = p.y;
      this.vx = 0; this.vy = 0;
      return;
    }

    // ---- 贴轨/脱轨态（Player.cs:26344-26360：mount.Cart && velocity.Y==0 时判）----
    //  vy==0 取上一 tick 碰撞后态（原版该段在 HorizontalMovement 之前，读的就是
    //  上帧碰撞结果）；贴轨判定原版直调 Minecart.OnTrack 磁石位探针（非 onTrack 旗标）。
    //  脱轨落地 → fullRotation=0 + onWrongGround + runSlowdown 0.2；
    //  此时按方向键（release 边沿）→ TryDismount 下车
    const groundedNow = this.vy === 0;
    const onTrackProbe = onTrack(st, this.x, this.y, this.w, this.h);
    this.onWrongGround = groundedNow && !onTrackProbe;
    if (this.onWrongGround) {
      this.rotation = 0;
      if ((p.inputX < 0 && this.prevInputX >= 0) || (p.inputX > 0 && this.prevInputX <= 0)) {
        // Mount.TryDismount（:26353-26355）：下车保持车位与车速（Mount.Dismount 不清速度）
        this.mounted = false;
        this.dead = true;
        p.x = this.x;
        p.y = this.y;
        p.vx = this.vx;
        p.vy = this.vy;
        p.ridingCart = false;
        p.cart = null;
        p.cartDefenseBonus = 0;   // 坐骑防御加成随下车解除（UpdateEffects 停跑）
        p.cartLavaMaxBonus = 0;   // ★BJ709-G34：Hell 车 lavaMax 提帽同拍解除
        return;
      }
    }
    // runSlowdown（:26312 默认 0.2；:26349 脱轨落地 0.2；:26357 贴轨 = runAcceleration）
    const slow = groundedNow && onTrackProbe ? this.acceleration : WRONG_GROUND_SLOWDOWN;

    // ---- trackBoost 并入（Player.cs:19530-19544：钳 ±maxRunSpeed）----
    if (this.trackBoost !== 0) {
      this.vx += this.trackBoost;
      this.trackBoost = 0;
      if (this.vx < -maxRun) this.vx = -maxRun;
      else if (this.vx > maxRun) this.vx = maxRun;
    }

    // ---- 水平输入（Player.cs:19546-19791 HorizontalMovement Carts 段 1:1）----
    // 车只在贴轨（vy==0）时响应加速/反推；runSlowdown+runAcceleration 同帧叠加
    const controlLeft = p.inputX < 0, controlRight = p.inputX > 0;
    if (controlLeft && this.vx > -maxRun) {
      if (this.vy === 0) {
        if (this.vx > slow) this.vx -= slow;
        this.vx -= this.acceleration;
      }
      // onWrongGround 刹车（:19577-19586）：脱轨后方向推力被对冲，车无法自走
      if (this.onWrongGround) {
        if (this.vx < -slow) this.vx += slow;
        else this.vx = 0;
      }
      // ---- 车轮火花+滚动声（Player.cs:19573-19615 左推分支）----
      // 门：AnyTrackRider && !onWrongGround && onTrack（上 tick 碰撞后态，同上方
      // onWrongGround 取态口径）&& itemAnimation==0 && vy==0 && vx>=0（反向推动）
      if (this.onTrackNow && !this.onWrongGround && p.itemAnimTicks === 0
        && this.vy === 0 && this.vx >= 0) {
        this.emitWheelSparks(game);
      }
    } else if (controlRight && this.vx < maxRun) {
      if (this.vy === 0) {
        if (this.vx < -slow) this.vx += slow;
        this.vx += this.acceleration;
      }
      if (this.onWrongGround) {
        if (this.vx > slow) this.vx -= slow;
        else this.vx = 0;
      }
      // ---- 车轮火花+滚动声（Player.cs:19631-19673 右推分支；门 vx<=0）----
      if (this.onTrackNow && !this.onWrongGround && p.itemAnimTicks === 0
        && this.vy === 0 && this.vx <= 0) {
        this.emitWheelSparks(game);
      }
    } else if (Math.abs(this.vx) >= 1) {
      // :19731-19762 无输入矿车（|vx|≥1）：脱轨落地按 runSlowdown 刹车；
      //  贴轨不减速，只钳 ±maxRunSpeed
      if (this.onWrongGround) {
        if (this.vx > 0) {
          if (this.vx > slow) this.vx -= slow;
          else this.vx = 0;
        } else if (this.vx < 0) {
          if (this.vx < -slow) this.vx += slow;
          else this.vx = 0;
        }
      }
      if (this.vx > maxRun) this.vx = maxRun;
      if (this.vx < -maxRun) this.vx = -maxRun;
    } else if (this.vy === 0) {
      // :19764-19777 落地无输入摩擦：|vx|<1 的慢车被刹停（原版语义）
      if (this.vx > slow) this.vx -= slow;
      else if (this.vx < -slow) this.vx += slow;
      else this.vx = 0;
    } else {
      // :19778-19791 空中无输入摩擦 ×0.5
      const s = slow * 0.5;
      if (this.vx > s) this.vx -= s;
      else if (this.vx < -s) this.vx += s;
      else this.vx = 0;
    }
    // 朝向：仅输入方向与速度同号才转（Player.cs:19553-19561 mount.Cart 门）
    if (p.inputX !== 0 && Math.sign(this.vx) === p.inputX) p.facing = p.inputX;
    this.prevInputX = p.inputX;

    // ---- 跳跃（Player.JumpMovement :20402-20418 + Mount.JumpSpeed/JumpHeight）----
    // 起跳需松键重按（releaseJump；autoJump 默认关），续跳按住即可（jump>0 段）。
    // 起跳门 = velocity.Y==0（贴轨或脱轨落地皆可，:20404 括号链），非"必须在轨"
    this.jumpSpeed = this.baseJumpSpeed;
    if (p.inputJump) {
      if (this.jump > 0) {
        if (this.vy === 0) this.jump = 0;
        else { this.vy = -this.jumpSpeed; this.jump--; }
      } else if (!this.prevJump && this.vy === 0) {
        // MountID.Sets.Cart 起跳：位置微抬防立即重贴轨（:20406 position.Y -= 0.001）
        this.y -= 0.001;
        this.jump = this.jumpHeight;
        this.vy = -this.jumpSpeed;
      }
    } else {
      this.jump = 0;
    }
    this.prevJump = !!p.inputJump;

    // ---- 重力（Player.cs:26499 cartRampTime 归零 + :27031-27037 斜坡窗口停摆）----
    if (this.vy === 0) {
      this.cartRampTime = 0;                      // :26499
      this.fallStart = Math.trunc(this.y / 16);   // fallStart = position.Y/16
    }
    if (this.cartRampTime <= 0) this.vy += PLAYER_DEFAULT_GRAVITY;
    else this.cartRampTime--;                     // :27036：起飞窗口内不加重力
    if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;   // :27039-27043

    // ---- 矿车撞怪（Player.cs:27748-27831 [1456 :27225 起]）——★调用位次对齐原文：
    //      1457 Player.Update 内撞怪块先于 Minecart.TrackCollision 调用点（:28315，
    //      同函数体顺序推进），本帧读的是轨驱段之前的车速——端点急停/斜坡起飞/
    //      脱轨抛出等同一 tick 的速度改写【不进】本帧伤害档位与 >4f 门。旧版在本
    //      方法尾部（轨驱+位移积分之后）读 velocity.Length()，时序晚一拍，2026-08-30
    //      R5 复核修正。实现在 MountCombat.minecartNpcRampage（原内联版已收编：
    //      TryConsumingTimerCrit OR 进 + 暴击掷骰整数分布 + GetMinecartDamage 数值表
    //      /难度乘区/kb-抗性预除/iframes=30/event9 全链同前；2026-08-30 起 DamageVar
    //      改为循环内逐 NPC 重抽+SuperCart 双掷，见 MountCombat 函数注释）----
    minecartNpcRampage(this, game);

    // ---- TrackCollision（Player.cs:27795-27850 1:1）----
    // 液体减速（:27802-27806 num108）：湿 0.5 / 蜂蜜·微光 0.25，速度整体缩放后
    // 进碰撞再还原（原版 velocity *= num108 → TrackCollision → velocity /= num108）
    const wet = p.inWater, honey = p.inHoney, shimmer = p.inShimmer;
    const liq = p.merman ? 1 : shimmer ? 0.25 : honey ? 0.25 : !wet ? 1 : 0.5;
    const prevVy = this.vy;
    const rider = {
      x: this.x, y: this.y,
      vx: this.vx * liq, vy: this.vy * liq,
      lastBoostX: this.lastBoostX, lastBoostY: this.lastBoostY,
    };
    const bits = trackCollision(
      st, rider, this.w, this.h,
      !!p.inputDown, !!p.inputUp, this.fallStart, false,
      {
        landing: (lx, ly) => {
          // MinecartLandingSound（DelegateMethods.Minecart.LandingSound → SoundID.Item53）+ 轮花
          game.playSfxFile?.('Item_53', 0.7, lx, ly);
          game.spawnParticles(lx, ly + this.h - 4, '#C8B08A', 6, 1.2, { life: 24 });
        },
      },
    );
    this.vx = rider.vx / liq;
    this.vy = rider.vy / liq;
    this.x = rider.x; this.y = rider.y;
    this.lastBoostX = rider.lastBoostX; this.lastBoostY = rider.lastBoostY;

    this.onTrackNow = !!(bits & (1 << FLAG_ON_TRACK));
    if (this.onTrackNow) {
      // 倾角 + gfxOffY（Player.cs:27804-27806：位置前探一步取两轮轨面）
      const rot = { v: this.rotation };
      this.gfxOffY = trackRotation(st, this.x + this.vx, this.y + this.vy, this.w, this.h,
        !!p.inputDown, !!p.inputUp, rot);
      this.rotation = rot.v;
      if (prevVy > PLAYER_DEFAULT_GRAVITY && this.vy === 0) this.fallStart = Math.trunc(this.y / 16);
    } else {
      this.rotation = 0;
      this.gfxOffY = 0;
      // JumpingSound 委托原版为空实现（DelegateMethods.cs:246-248）——离轨不发声
    }
    if (bits & (1 << FLAG_BOUNCY_BUMPER)) {
      if (controlLeft || controlRight) this.cartFlip = !this.cartFlip;
      if (this.vx > 0) p.facing = 1;
      else if (this.vx < 0) p.facing = -1;
      // BumperSound（DelegateMethods.Minecart.BumperSound → SoundID.Item56）
      game.playSfxFile?.('Item_56', 0.8, this.x, this.y);
    }
    if (bits & (1 << FLAG_USED_RAMP)) {
      this.cartRampTime = Math.trunc(Math.min(1, Math.abs(this.vx) / this.dashSpeed) * 20);
    }
    if (bits & (1 << FLAG_HIT_SWITCH)) {
      // Player.cs:27927-27931 → Minecart.HitTrackSwitch → Wiring.HitSwitch(磁石位)
      const mx = Math.trunc((this.x + this.w / 2 - CART_TEXTURE_WIDTH / 2 + 25) / 16);
      const my = Math.trunc((this.y + this.h / 2 + 26) / 16);
      game.hitTrackSwitch?.(mx, my);
    }
    if (bits & (1 << FLAG_BOOST_LEFT)) this.trackBoost -= TRACK_BOOST_DELTA;   // :27845（Minecart.BoosterSpeed=4）
    if (bits & (1 << FLAG_BOOST_RIGHT)) this.trackBoost += TRACK_BOOST_DELTA;  // :27849

    // ---- 位置积分（原版在 TrackCollision 后由 DryCollision 完成）----
    //  贴轨：轨道非实心，常规碰撞只处理横向撞墙；
    //  脱轨：走完整实体碰撞（实心落面/墙面）——坐骑恒 fallThrough=true
    //  （:27787-27790 mount.Cart 分支），平台一律穿过
    if (this.onTrackNow) {
      this.x += this.vx;
      this.y += this.vy;
      if (this.vx !== 0) {
        const headX = Math.floor((this.x + this.w / 2 + Math.sign(this.vx) * this.w / 2) / 16);
        const feetY = Math.floor((this.y + this.h - 4) / 16);
        // ★转角爬阶豁免(2026-08-25 用户实报"特殊转角正常速度上不去,极高冲劲才行,
        //  下坡顺畅"):上台阶转角处,上排轨的正下方格(feetY 行)是台阶实心块——矿车
        //  爬到角格中段时 feet 探针格=该实心块 → vx 每帧清零 → 永久卡死(真实世界
        //  复现:x=2603 角格 vx 归零;行走 trace 证明 trackCollision 本身能爬上)。
        //  豁免 = 前方格或其上一格是轨道(正在爬的台阶轨)→ 放行;纯墙(无轨)仍急停。
        const headTrack =
          st.inBounds(headX, feetY) && st.get(headX, feetY) === TRACK_TILE
          ? true
          : st.inBounds(headX, feetY - 1) && st.get(headX, feetY - 1) === TRACK_TILE;
        // ★SW-BJ30 2026-09-08：坡面通行门（45°坡轨"这种角度开不过去"第二案）——
        //  原版横向碰撞对坡形块从迎坡面侧【不算墙】，矿车贴轨上坡时探针格=坡形
        //  山体块是常态,原版车随坡面爬升。曾把 slope≠0 当整块实心墙 → 相位落点
        //  踩中探针即 vx 清零+回退 x,而 trackCollision 的 Y 已随坡面抬升（x 回退
        //  与 y 抬升错位）→ 车被抛离轨面 2-3 格后落在坡体上,onWrongGround 刹车链
        //  把车永久楔死（用户实报）。
        // ★SW-RB8b 2026-09-09：放行判据改 Collision.cs:2361-2382 flag3 精确几何
        //  （与 physics/TileCollision.ts slopePass 同式同源；BJ30 曾用 vx 符号近似
        //  slope1∧vx>0/slope2∧vx<0/3·4 恒放行——三偏差：① 原版判据全用【移动前】
        //  位置 vector3(ox/oy)+|Velocity.X|+Height,与速度方向无关；真实地形右上行
        //  坡=坡2（smoothSlope case5 down+right→2,TrackPass.smoothSlope 同款;
        //  坡1=左高右低、右缘整高=右行墙面）,符号规则 slope2∧vx<0 ⇒ 右行爬真实
        //  坡仍被楔死,而 slope1∧vx>0 反放行整高左脸=穿山；② 坡3/4 原版同样有几何
        //  门（顶缘 |vx| 容差+横向单侧,:2363/:2367）,恒放行=天花板坡可穿；③ 半砖
        //  num7=8 支不适用本近似（TileCollision 同款 half 直接不放行）。
        //  外层再加原版推离前置（:2406/:2428 两支都要求移动前盒【完全】在格一侧）：
        //  贴面跨格态原版本就不推离（交 Y 面/坡面解析）——本探针只拦"本帧才探入"
        //  的穿透,爬升中段跨格态不再被逐帧急停。坡 1 行进判据 ox≥格左=前缘格内
        //  蕴含成立（左行）,坡 2 对称 ox+w≤格右（右行）——与 TileCollision 引擎
        //  全域同语义。
        const pi = st.inBounds(headX, feetY) ? st.idx(headX, feetY) : -1;
        const preX = this.x - this.vx, preY = this.y - this.vy;
        const avx = Math.abs(this.vx);
        const slopePassable = pi < 0 || st.half[pi]
          ? false
          : st.slope[pi] === 1 ? preY + this.h - avx <= feetY * 16 + 16 && preX >= headX * 16
            : st.slope[pi] === 2 ? preY + this.h - avx <= feetY * 16 + 16 && preX + this.w <= headX * 16 + 16
              : st.slope[pi] === 3 ? preY + avx >= feetY * 16 && preX >= headX * 16
                : st.slope[pi] === 4 && preY + avx >= feetY * 16 && preX + this.w <= headX * 16 + 16;
        const preFullySided = pi < 0 ? false
          : preX + this.w <= headX * 16 || preX >= headX * 16 + 16;
        if (!headTrack && pi >= 0 && st.isSolid(headX, feetY) && !slopePassable && preFullySided) {
          this.x -= this.vx;
          this.vx = 0;
        }
      }
    } else {
      const wasFalling = this.vy > 0;
      this.dryCollide(st);
      if (wasFalling && this.vy === 0) {
        // ---- 脱轨落地摔伤（Player.cs:25005-25091：num10 = tileY - fallStart，
        //  num9 = 25 + ExtraFall；矿车族 ExtraFall=0、FallDamage=1。
        //  落在轨上 num10=0（:25018-25021）——本分支只在脱轨落地时结算）----
        const num10 = Math.trunc(this.y / 16) - this.fallStart;
        this.fallStart = Math.trunc(this.y / 16);
        if (num10 > FALL_SAFE_TILES
          && !(p.equipStats.wing || p.hasHorseshoe || p.equipStats.noFallDmg)) {
          const dmg = Math.max(1, Math.round((num10 - FALL_SAFE_TILES) * FALL_DMG_PER_TILE
            * this.fallDamageFactor));
          p.lastDamageCause = { kind: 'fell' };
          p.damage(dmg, this.cx, this.y - 10);
          game.playSfx?.('hurt');
          game.addDamageNumber?.(this.cx, this.y, dmg, false, playerHurtFloatColor(false));   // ★附带④单源
          // 成就：摔落幸存（:25078-25082）
          if (!p.dead && p.hp > 0 && p.hp <= p.maxHp / 10) {
            game.achievements?.handleSpecialEvent(8,
              { statLifeMax: p.maxHp, statManaMax: p.maxMana });
          }
        }
      }
    }
    this.wasGrounded = this.onTrackNow || this.vy === 0;

    if (Math.abs(this.vx) > 0.1) this.animTick++;
    else this.animTick = 0;

    // ---- 玩家坐骑位回写（原版玩家 hitbox 即车；此处锁玩家到车位）----
    p.x = this.x;
    p.y = this.y;
    p.vx = this.vx;
    p.vy = 0;
    p.onGround = this.onTrackNow || this.wasGrounded;
    p.fallStartY = null;   // 常规摔伤链由本实体 fallStart 接管（脱轨落地段结算）

    // ---- SuperCart 防御+激光（Mount.cs:4793-4799 UpdateEffects）----
    // _shouldSuperCart = Cart 族 && UsingSuperCart（本实体 superCart 即该旗）；
    // num = 1 + |vx|/RunSpeed×2.5（RunSpeed 走 SuperCart 档 20）→ statDefense += (int)(2×num)
    p.cartDefenseBonus = this.superCart
      ? superCartDefenseBonus(Math.abs(this.vx), this.runSpeed) : 0;
    // ★BJ709-G34（G32-D2 清偿）:case 22 Hell 矿车 UpdateEffects 装备面首行
    //  `mountedPlayer.lavaMax += 420`（Mount.cs:5138）——提帽非回填（vanilla
    //  lavaTime 只在离浆/免疫态 +1/tick 恢复,Player.cs:27926-27932 消费）。
    //  仓内动态坐骑面=逐拍写 p.cartLavaMaxBonus（cartDefenseBonus 同模式;
    //  下车清零随行:脱轨下车/坠界/dismountMinecart 三位+本拍覆写自愈）,
    //  Player 岩浆段以 eqM.lavaMax+bonus 聚合消费。
    p.cartLavaMaxBonus = this.mountId === 22 ? 420 : 0;
    if (this.superCart) this.castSuperCartLaser(p, game);
    // 激光余辉推进（Projectile.cs:31987-32029：20t 寿 + 尾随车位 + 反向即灭）
    for (let i = this.laserBeams.length - 1; i >= 0; i--) {
      const b = this.laserBeams[i];
      b.age++;
      if (b.age >= 20                                                       // :31993 localAI[0] >= 20
        || (Math.sign(this.vx) !== b.dirX && this.vx !== 0)) {              // :32020-32024
        this.laserBeams.splice(i, 1);
      }
    }

    // ---- 鼠马车挖掘（Player.cs:19905 TryUsingDiggerCart：撞怪结算后同段）----
    this.tryUsingDiggerCart(p, game);

    // ---- ★BJ709-G32③：Mount.UpdateEffects 尘支（Mount.cs:4848 switch 的七尘面;
    //      vanilla 调用位=Player.Update :25854-25857,本仓锚在车位回写后=车末态
    //      （速度/倾角本拍现值）。case 62-65 伤害加成/12 Fishron 光/22 lavaMax/
    //      case 11 五点光等装备·光域未接=登记（见文件头 census 注 G32-D1/D2）----
    this.updateEffectsDust(p, game);

    // 完全脱轨坠出世界底（误用兜底）：消亡防穿地（正常脱轨由 dryCollide 落地）
    if (!this.onTrackNow && !this.wasGrounded
      && this.y > st.h * 16 - 64) {
      this.dead = true;
      this.mounted = false;
      p.cartDefenseBonus = 0;
      p.cartLavaMaxBonus = 0;   // ★BJ709-G34：Hell 车 lavaMax 提帽同拍解除
    }
  }

  /** 轮组动画帧（Mount runningFrameCount 3 / runningFrameDelay 12；静止 standingFrame 0） */
  get animFrame(): number {
    return Math.abs(this.vx) > 0.1 ? Math.floor(this.animTick / 12) % 3 : 0;
  }

  // ---------------------------------------------------------------------------
  // 车轮火花（Player.cs:19573-19615 + Minecart.cs:1629-1638 + DelegateMethods.cs:224-413）
  // ---------------------------------------------------------------------------

  /** 加速/反推时的车轮火花 + 滚动声。调用点已过门（贴轨/反向推动/itemAnim==0）；
   *  此处只做 Item55 声 + 三档速度掷位 → WheelSparks 磁石位 → 尘型委派
   *  （DelegateMethods.Minecart.rotation = fullRotation → this.rotation 直读） */
  private emitWheelSparks(game: GameHooks): void {
    // SoundID.Item55 矿车滚动声（Player.cs:19574，盒中心；FILE_CASE_VOL 无专属修正）
    game.playSfxFile?.('Item_55', 1, this.x + this.w / 2, this.y + this.h / 2);
    // 掷位（Player.cs:19585-19614）：|vx| 对 maxRunSpeed（骑乘态 = mount.RunSpeed）
    // 档2 → 0.66/0.33/0 三位各 50%；档1 → 0.5/0 两位各 2/3；档0 → 原位恒一发
    const maxRun = this.runSpeed;
    const trySpark = (mul: number, chance: number): void => {
      if (Math.random() >= chance) return;
      // Minecart.WheelSparks（:1629-1638）：Position(=车位置+velocity×mul) +
      // (Width/2-textureWidth/2, Height/2) + MagnetOffset —— magnetPosition 同式
      const mp = magnetPosition(this.x + this.vx * mul, this.y + this.vy * mul, this.w, this.h);
      this.wheelSparkDust(game, mp.x, mp.y);
    };
    switch (wheelSparkTier(this.vx, maxRun)) {
      case 2:
        trySpark(0.66, 0.5); trySpark(0.33, 0.5); trySpark(0, 0.5);
        break;
      case 1:
        trySpark(0.5, 2 / 3); trySpark(0, 2 / 3);
        break;
      default:
        trySpark(0, 1);
        break;
    }
  }

  /** 单粒轮火花（DelegateMethods.Minecart.Sparks 族，DelegateMethods.cs:224-413）。
   *  尘型按坐骑委派分派（cartDustKindOf）；NewDust 后逐字段后置与原版同序 */
  private wheelSparkDust(game: GameHooks, x: number, y: number): void {
    const rand = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo));
    // :226 dustPosition += (Next(2)==0 ? 13 : -13, 0).RotatedBy(rotation)
    const off = rand(0, 2) === 0 ? 13 : -13;
    const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
    const px = x + off * cos, py = y + off * sin;
    // NewDust(dustPosition, 1, 1, type, Next(-2,3), Next(-2,3)) 的初速
    const vx0 = rand(-2, 3), vy0 = rand(-2, 3);
    const kind = cartDustKindOf(this.mountId);
    if (kind === 'sparksFart' || (kind === 'sparksTerraFart' && rand(0, 2) === 0)) {
      // SparksFart（:329-347，dust 211）——TerraFart 的 fart 半支（:349-354）
      const d = game.spawnDust?.(px, py, 1, 1, 211, vx0, vy0, 50, null, 0.8);
      if (!d) return;
      if (rand(0, 2) === 0) d.alpha += 25;      // :331-337
      if (rand(0, 2) === 0) d.alpha += 25;
      d.noLight = true;                          // :338
      d.noGravity = rand(0, 3) === 0;            // :339
      d.vx *= rand(15, 51) * 0.01;               // :340-344
      d.vx *= rand(25, 101) * 0.01;
      d.vy *= rand(15, 51) * 0.01;
      d.vy -= rand(15, 31) * 0.1;
      d.y -= 4;                                  // :345
      return;
    }
    if (kind === 'sparksTerraFart') {
      // SparksTerraFart 的另一半（:355-373，dust 107 绿色妖精尘）
      const t = Math.random() * 0.3;
      const color = {
        r: Math.round(64 + (255 - 64) * t), g: Math.round(220 + (255 - 220) * t),
        b: Math.round(96 + (255 - 96) * t), a: 255,
      };
      const d = game.spawnDust?.(px, py, 1, 1, 107, vx0, vy0, 100, color, 0.8);
      if (!d) return;
      if (rand(0, 2) === 0) d.alpha += 25;      // :360-366
      if (rand(0, 2) === 0) d.alpha += 25;
      d.noLightEmittance = true;                 // :367
      d.noGravity = rand(0, 3) === 0;            // :368
      d.vx *= rand(15, 51) * 0.01;               // :369-371
      d.vx *= rand(25, 101) * 0.01;
      d.vy *= rand(15, 51) * 0.01;
      d.vy -= rand(15, 31) * 0.1;
      d.y -= 4;                                  // :372
      return;
    }
    // Sparks（:224-246 dust 213）/ SparksMech（:374-393 dust 260）/ SparksMeow
    // （:395-413 dust 213 + 染料 shader——shader 系统无对应，dust 本体同 Sparks，登记近似）
    const type = kind === 'sparksMech' ? 260 : 213;
    const fadeInExtra = kind === 'sparksMech' ? 0.5 : 1;   // :230 vs :378
    const d = game.spawnDust?.(px, py, 1, 1, type, vx0, vy0);
    if (!d) return;
    d.noGravity = true;                          // :228
    d.fadeIn = d.scale + fadeInExtra + 0.01 * rand(0, 51);
    d.vx *= rand(15, 51) * 0.01;                 // :233-235
    d.vx *= rand(25, 101) * 0.01;
    d.vy *= rand(15, 51) * 0.01;
    d.vy -= rand(15, 31) * 0.1;
    d.y -= 4;                                    // :236
    if (rand(0, 3) !== 0) d.noGravity = false;   // :237-241
    else d.scale *= 0.6;
  }

  // ---------------------------------------------------------------------------
  // ★BJ709-G32③：Mount.UpdateEffects 尘发射面（Mount.cs:4742-4852 四委派 +
  // case 11/22 直发,updateEffectsDust 派发见文件头 census 注）
  // ---------------------------------------------------------------------------

  /** 坐标基注（七面共通）：mountedPlayer ≡ 本车（玩家锁车,Player.cs 玩家盒即车
   *  20×(42+heightBoost)）——Center=盒心、Bottom=(cx,y+h)、velocity=本车 (vx,vy)
   *  （p.vy=0 系本仓锁位建模差,取车速;vanilla 骑车玩家速度即车速）、direction=
   *  p.facing、Directions=(direction,gravDir)=(facing,1)（gravDir 翻转坐骑本仓
   *  未实装恒 1,Minecart.ts:839 既有备案）、RotatedRelativePoint=私有
   *  rotatedRelativePoint（PlayerOffset 8 同式）、fullRotation=this.rotation
   *  （轨面倾角）。尘通道=game.spawnDust（perfect=NewDustPerfect）+后置覆写族序
   *  （wheelSparkDust 同模式）;RNG=Math.random 直映（AI 侧既有约定,不进播种流）。 */
  private updateEffectsDust(p: Player, game: GameHooks): void {
    switch (this.mountId) {
      case 25: this.doGemMinecartEffect(p, game, 86); break;   // :4914-4915
      case 26: this.doGemMinecartEffect(p, game, 87); break;
      case 27: this.doGemMinecartEffect(p, game, 88); break;
      case 28: this.doGemMinecartEffect(p, game, 89); break;
      case 29: this.doGemMinecartEffect(p, game, 90); break;
      case 30: this.doGemMinecartEffect(p, game, 91); break;
      case 31: this.doGemMinecartEffect(p, game, 262); break;  // :4932-4933 Amber
      case 36: this.doSteamMinecartEffect(p, game, 303); break;   // :5180-5181
      case 32: this.doExhaustMinecartEffect(p, game, 31); break;  // :5183-5184 Beetle
      case 34: this.doConfettiMinecartEffect(p, game); break;     // :5186-5187 Party
      case 11: this.mechTrailDust(p, game); break;                 // :5072 尘面
      case 22: this.hellMinecartDust(p, game); break;              // :5136 尘面
    }
  }

  /** DoGemMinecartEffect（Mount.cs:4742-4756）——1/10 掷;NextVector2Square(-1,1)
   *  ×(22,10) 偏移 + (0,10)·Directions 锚 Center → RotatedRelativePoint;尘
   *  perfect（velocity 缺省 0,×0.25 无效掷=保持 0）;shader=cMinecart。 */
  private doGemMinecartEffect(p: Player, game: GameHooks, dustType: number): void {
    if (!(Math.random() < 0.1)) return;                    // :4744 Next(10)==0
    const sqx = -1 + 2 * Math.random(), sqy = -1 + 2 * Math.random();   // NextVector2Square(-1,1) 逐轴 2 掷
    const rp = this.rotatedRelativePoint(
      this.cx + 0 * p.facing + sqx * 22,                   // Center+(0,10)*Directions+square*(22,10)
      this.cy + 10 + sqy * 10);
    const d = game.spawnDust?.(rp.x, rp.y, 0, 0, dustType, 0, 0, 0, null, 1, false, true);
    if (!d) return;
    d.noGravity = true;                                    // :4750
    d.fadeIn = 0.6;                                        // :4751
    d.scale = 0.4;                                         // :4752
    d.vx *= 0.25; d.vy *= 0.25;                            // :4753（perfect 初速 0 → 0）
    d.dyeVid = p.minecartDyeVid();                         // :4754 shader=cMinecart
  }

  /** DoSteamMinecartEffect（:4759-4776）——|vx|≥1 掷（<6 另需 _frame==0→animFrame
   *  同源,runningFrameDelay 12 三帧循环）;位 Center+(−10,−4)·Directions+square(3,3);
   *  perfect: noGravity/fadeIn 0.6/scale 1.8/velocity ×0.25 后 vy−2;shader。 */
  private doSteamMinecartEffect(p: Player, game: GameHooks, dustType: number): void {
    const num = Math.abs(this.vx);                         // :4761
    if (!(num >= 1 && (num >= 6 || this.animFrame === 0))) return;   // :4762-4763
    const sqx = -1 + 2 * Math.random(), sqy = -1 + 2 * Math.random();
    const rp = this.rotatedRelativePoint(
      this.cx - 10 * p.facing + sqx * 3,                   // Center+(-10,-4)*Directions+square*(3,3)
      this.cy - 4 + sqy * 3);
    const d = game.spawnDust?.(rp.x, rp.y, 0, 0, dustType, 0, 0, 0, null, 1, false, true);
    if (!d) return;
    d.noGravity = true;                                    // :4767
    d.fadeIn = 0.6;                                        // :4768
    d.scale = 1.8;                                         // :4769
    d.vx *= 0.25; d.vy *= 0.25;                            // :4770
    d.vy -= 2;                                             // :4771
    d.dyeVid = p.minecartDyeVid();                         // :4772
  }

  /** DoExhaustMinecartEffect（:4778-4812）——|v|<1 时 1/4 掷续（≥1 无掷直入）;
   *  粒数 = 1+(int)|v|/6（num2 先减再入体=体见值 N−1..0）;(−18,20)·Directions 偏移
   *  （|v|>6 → X+4·dir;num2>0 → +velocity×(num2/3 int 除）)+square(3,3);perfect:
   *  noGravity/fadeIn 0.6/scale 1.2/velocity ×0.2（低速 vx−0.5·dir）;shader。 */
  private doExhaustMinecartEffect(p: Player, game: GameHooks, dustType: number): void {
    const num = Math.hypot(this.vx, this.vy);              // :4780 velocity.Length()
    if (num < 1 && Math.floor(Math.random() * 4) !== 0) return;   // :4781-4784 Next(4)
    let num2 = 1 + Math.floor(num / 6);                    // :4785 1+(int)num/6
    while (num2 > 0) {
      num2--;                                              // :4787 先减
      const sqx = -1 + 2 * Math.random(), sqy = -1 + 2 * Math.random();
      let ox = -18 * p.facing, oy = 20;                    // (−18,20)*Directions
      if (num > 6) ox += 4 * p.facing;                     // :4789-4791
      if (num2 > 0) {                                      // :4792-4794
        const k = Math.trunc(num2 / 3);                    // int 除
        ox += this.vx * k; oy += this.vy * k;
      }
      const rp = this.rotatedRelativePoint(this.cx + ox + sqx * 3, this.cy + oy + sqy * 3);
      const d = game.spawnDust?.(rp.x, rp.y, 0, 0, dustType, 0, 0, 0, null, 1, false, true);
      if (!d) continue;
      d.noGravity = true;                                  // :4797
      d.fadeIn = 0.6;                                      // :4798
      d.scale = 1.2;                                       // :4799
      d.vx *= 0.2; d.vy *= 0.2;                            // :4800
      if (num < 1) d.vx -= 0.5 * p.facing;                 // :4801-4804
      d.dyeVid = p.minecartDyeVid();                       // :4805
    }
  }

  /** DoConfettiMinecartEffect（:4814-4852）——双掷门（短路序:(num<1 ∧ Next(6)≠0)
   *  ∨ (num<3 ∧ Next(3)≠0) → 弃,速度档决定掷不掷）;粒数=1+(int)num/6;num3=
   *  NextFloat×2 首掷复用（scale 0.5+num3/2 与 X 堆叠 (dir·num2)·num3）;
   *  (−18,4)·Directions+square(3,8) 偏移;尘 139+Next(4) 纸屑 perfect: noGravity/
   *  fadeIn 0.6/velocity ×0.2（低速 vx−0.5·dir）;shader。 */
  private doConfettiMinecartEffect(p: Player, game: GameHooks): void {
    const num = Math.hypot(this.vx, this.vy);              // :4815
    if ((num < 1 && Math.floor(Math.random() * 6) !== 0)   // :4818-4820
      || (num < 3 && Math.floor(Math.random() * 3) !== 0)) return;
    let num2 = 1 + Math.floor(num / 6);                    // :4821
    while (num2 > 0) {
      num2--;                                              // :4823 先减
      const num3 = Math.random() * 2;                      // :4824 NextFloat()*2f
      const sqx = -1 + 2 * Math.random(), sqy = -1 + 2 * Math.random();
      let ox = -18 * p.facing, oy = 4;                     // (−18,4)*Directions
      ox += num * p.facing * 0.5 + p.facing * num2 * num3; // :4827
      if (num2 > 0) {                                      // :4828-4830
        const k = Math.trunc(num2 / 3);
        ox += this.vx * k; oy += this.vy * k;
      }
      const rp = this.rotatedRelativePoint(this.cx + ox + sqx * 3, this.cy + oy + sqy * 8);
      const d = game.spawnDust?.(rp.x, rp.y, 0, 0,
        139 + Math.floor(Math.random() * 4),               // :4832 139+Next(4)
        0, 0, 0, null, 1, false, true);
      if (!d) continue;
      d.noGravity = true;                                  // :4834
      d.fadeIn = 0.6;                                      // :4835
      d.scale = 0.5 + num3 / 2;                            // :4836
      d.vx *= 0.2; d.vy *= 0.2;                            // :4837
      if (num < 1) d.vx -= 0.5 * p.facing;                 // :4838-4841
      d.dyeVid = p.minecartDyeVid();                       // :4842
    }
  }

  /** case 11 MinecartMech 轨迹尘 182（:5072-5135 尘面;netMode==2 门单机不达,
   *  五点光 :5084-5094 未接=登记债 G32-D1）。num9=sign(vx)∥direction;num10=−24
   *  （direction≠num9 → −22;num9==−1 → ++）;vector6=(num10·num9,−19)·RotatedBy(
   *  fullRotation);vector7=(Lerp(0,−8,fr/(π/4)),Lerp(0,2,|fr/(π/4)|))·RotatedBy(fr)
   *  （num9==sign(fr) 时 ×Lerp(1,0.6,|fr/(π/4)|)）;vector8=Bottom+…、vector9=
   *  oldPosition+Size·(0.5,1)+…;距>3px → (int)距/3（余数进位）粒 Lerp 铺 1 粒/3px,
   *  else 单粒钉位。尘 NewDust 后 position/velocity 双覆写=noGravity/零速/
   *  followPlayer 一次性（182 :705-706 customData=Player 先随一拍再清）;
   *  shader。 */
  private mechTrailDust(p: Player, game: GameHooks): void {
    let num9 = Math.sign(this.vx);                         // :5077-5080
    if (num9 === 0) num9 = p.facing;
    let num10 = -24;                                       // :5095
    if (p.facing !== num9) num10 = -22;                    // :5096-5099
    if (num9 === -1) num10++;                              // :5100-5102
    const fr = this.rotation;                              // player.fullRotation（轨面）
    const cos = Math.cos(fr), sin = Math.sin(fr);
    const v6x = num10 * num9 * cos - -19 * sin;
    const v6y = num10 * num9 * sin + -19 * cos;            // :5103 (num10*num9,-19) 旋
    const q = fr / (Math.PI / 4);
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const w2x = lerp(0, -8, q), w2y = lerp(0, 2, Math.abs(q));   // :5104-5105
    let v7x = w2x * cos - w2y * sin, v7y = w2x * sin + w2y * cos; // :5105 RotatedBy
    if (num9 === Math.sign(fr)) {                          // :5106-5108
      const m = lerp(1, 0.6, Math.abs(q));
      v7x *= m; v7y *= m;
    }
    const v8x = this.cx + v6x + v7x;                       // :5109 Bottom+vector6+vector7
    const v8y = this.y + this.h + v6y + v7y;
    const v9x = (this.oldX ?? this.x) + this.w / 2 + v6x + v7x;   // :5110 oldPosition+Size*(0.5,1)+…
    const v9y = (this.oldY ?? this.y) + this.h + v6y + v7y;
    const dist = Math.hypot(v8x - v9x, v8y - v9y);
    const dye = p.minecartDyeVid();
    const emit = (px: number, py: number): void => {
      const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 182, 0, 0);   // :5112/:5124 NewDust(Center,0,0,182)
      if (!d) return;
      d.x = px; d.y = py;                                  // position 覆写（Lerp/钉位）
      d.noGravity = true;                                  // :5114/:5126
      d.vx = 0; d.vy = 0;                                  // :5115/:5127 velocity 覆写
      d.followPlayer = true; d.followOnce = true;          // :5116/:5128 customData=Player
      d.dyeVid = dye;                                      // :5117/:5129 shader
    };
    if (dist > 3) {                                        // :5111-5122
      let num11 = Math.trunc(Math.trunc(dist) / 3);        // (int)dist/3（整除）
      if (dist % 3 !== 0) num11++;                         // 余数进位
      for (let num12 = 1; num12 <= num11; num12++) {
        emit(v9x + (v8x - v9x) * (num12 / num11), v9y + (v8y - v9y) * (num12 / num11));   // :5118
      }
    } else {
      emit(v8x, v8y);                                      // :5123-5130 单粒钉位
    }
  }

  /** case 22 HellMinecart 尘 65（:5136-5178 尘面;lavaMax+=420 :5138 装备面已随
   *  ★BJ709-G34（G32-D2）清偿——fixedUpdate 装备面块逐拍写 p.cartLavaMaxBonus）。
   *  锚 vector2=Center+(20,10)·Directions、pos=锚+velocity、pos2=
   *  锚+(−1,−0.5)·Directions（三者各过 RRP）;value=shadowPos[2]−position+锚（社交
   *  残影 3 拍轮转单源 Player.socialShadowPos2——SW-FX36 稳态滞后 4~6 拍的轨迹
   *  起点;采样 gfxOffY 轨面项已并入=★BJ709-G34（G32-D3）窄修）;+vector3(=pos−锚)
   *  前探一步;vector4=pos−pos2
   *  反漂;num6=clamp(|v|/5,0,1);11 点 Lerp(value,锚,t)【!(rand<num6) 门=越慢越密
   *  （:5149 原文取反,静止恒发/极速恒不发）】;尘 65 perfect 初速=
   *  NextVector2Circular(0.5,0.5)×num6:scale 0.6/fadeIn 0/velocity ×−1−vector4/
   *  noGravity;1/10 → fadeIn 1.3+速度重掷 NextVector2Circular(3,3)×num6;
   *  customData=Player 对 65 型 vanilla 惰性（Dust.cs 无 65 消费位）=不接
   *  followPlayer;shader。 */
  private hellMinecartDust(p: Player, game: GameHooks): void {
    const ax = this.cx + 20 * p.facing, ay = this.cy + 10; // :5139 vector2=Center+(20,10)*Directions
    const posx0 = ax + this.vx, posy0 = ay + this.vy;      // :5140 pos=vector2+velocity
    const p2x = ax - p.facing, p2y = ay - 0.5;             // :5141 pos2=vector2+(-1,-0.5)*Directions
    const r2 = this.rotatedRelativePoint(ax, ay);          // :5142-5144 三 RRP
    const rp = this.rotatedRelativePoint(posx0, posy0);
    const rp2 = this.rotatedRelativePoint(p2x, p2y);
    const sh = p.socialShadowPos2();                       // :5145 shadowPos[2]
    const v3x = rp.x - r2.x, v3y = rp.y - r2.y;            // :5146 vector3=pos-vector2
    const anchorx = r2.x + v3x, anchory = r2.y + v3y;      // :5147-5148 vector2+=vector3
    const valuex = sh.x - this.x + r2.x + v3x;             // :5145+5148 value=shadowPos[2]-position+vector2(+vector3)
    const valuey = sh.y - this.y + r2.y + v3y;             //（position=玩家位=锁车位 this.x/y）
    const v4x = rp.x - rp2.x, v4y = rp.y - rp2.y;          // :5149 vector4=pos-pos2
    const num6 = Math.max(0, Math.min(1, Math.hypot(this.vx, this.vy) / 5));   // :5150
    const dye = p.minecartDyeVid();
    for (let t = 0; t <= 1; t += 0.1) {                    // :5151 11 点（浮点累积同 C# 11 迭代）
      if (!(Math.random() < num6)) {                       // :5153 !(NextFloat()<num6)
        const bx = valuex + (anchorx - valuex) * t;        // Vector2.Lerp(value,vector2,t)
        const by = valuey + (anchory - valuey) * t;
        const cv = nextVector2Circular(Math.random, 0.5, 0.5);   // :5154
        const d = game.spawnDust?.(bx, by, 0, 0, 65, cv.x * num6, cv.y * num6,
          0, null, 1, false, true);
        if (!d) continue;
        d.scale = 0.6;                                     // :5155
        d.fadeIn = 0;                                      // :5156
        d.vx *= -1; d.vy *= -1;                            // :5158 velocity*=-1
        d.noGravity = true;                                // :5159
        d.vx -= v4x; d.vy -= v4y;                          // :5160
        d.dyeVid = dye;                                    // :5161
        if (Math.floor(Math.random() * 10) === 0) {        // :5162 Next(10)==0
          d.fadeIn = 1.3;                                  // :5163
          const c3 = nextVector2Circular(Math.random, 3, 3);   // :5164
          d.vx = c3.x * num6; d.vy = c3.y * num6;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SuperCart 机械激光（Mount.cs:5200-5258）
  // ---------------------------------------------------------------------------

  /** GetMinecartMechPoint（Mount.cs:5234-5258）：车身 mech 参考点
   *  = Bottom + (±offX 旋) + (斜坡 Lerp 补偿旋) */
  private minecartMechPoint(p: Player, offX: number, offY: number): { x: number; y: number } {
    const num = Math.sign(this.vx) || p.facing;         // :5236-5240
    const num3 = Math.sign(offX);                        // :5242（调用档 ±20 非 0）
    let ox = offX;
    if (p.facing !== num) ox -= num3;                    // :5243-5246
    if (num === -1) ox -= num3;                          // :5247-5250
    const rot = this.rotation;                           // fullRotation
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const v0x = ox * num, v0y = offY;
    const vx = v0x * cos - v0y * sin, vy = v0x * sin + v0y * cos;
    // :5252 vector2 = (Lerp(0,-8,rot/(π/4)), Lerp(0,2,|rot/(π/4)|)).RotatedBy(rot)
    const q = rot / (Math.PI / 4);
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const w2x = lerp(0, -8, q), w2y = lerp(0, 2, Math.abs(q));
    let wx = w2x * cos - w2y * sin, wy = w2x * sin + w2y * cos;
    if (num === Math.sign(rot)) {                        // :5253-5256
      const m = lerp(1, 0.6, Math.abs(q));
      wx *= m; wy *= m;
    }
    return { x: this.x + vx + wx, y: this.y + this.h + vy + wy };   // Bottom + ...
  }

  /** CastSuperCartLaser（Mount.cs:5200-5232）：发射即结算（591 弹 Damage 后
   *  damage=0——见 CartLaserBeam 注释），60 伤无暴击无击退 */
  private castSuperCartLaser(p: Player, game: GameHooks): void {
    if (this.vx === 0) return;                            // :5207 静止不发
    const num = Math.sign(this.vx) || p.facing;           // :5202-5206
    const mech = this.minecartMechPoint(p, 20, -19);      // :5211 索敌档
    const st = game.world.store;
    for (const ent of game.enemies()) {
      const e = ent as unknown as {
        x: number; y: number; w: number; h: number; dead: boolean;
        iframes: number; dontTakeDamage?: boolean; friendly?: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, ap: number, c: boolean, pi: number, fp?: boolean) => boolean;
      };
      // CanBeChasedBy 口径（城镇/友好排除，同撞怪段 :27253）+ 玩家免疫门（:5218）
      if (e.dead || e.dontTakeDamage || !playerCanHitEnemy(e, game)) continue;   // friendly 门（同上，CanHit 门修空字段）
      if (e.iframes > 0) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      if (Math.hypot(ecx - mech.x, ecy - mech.y) >= 300) continue;   // Distance < 300
      // Collision.CanHitLine(npc盒, mech点 0×0)
      if (!canHitLine(st, e.x, e.y, e.w, e.h, mech.x, mech.y, 0, 0)) continue;
      // 前向 ±π/4 锥（:5218）：AngleFrom = atan2(目标-源)，朝向角 = rot + (num==-1 ? π : 0)
      const angleFrom = Math.atan2(ecy - mech.y, ecx - mech.x);      // Entity.cs:190-193
      const facing = this.rotation + (num === -1 ? Math.PI : 0);
      if (Math.abs(wrapAngle(wrapAngle(angleFrom) - wrapAngle(facing))) >= LASER_CONE) continue;
      // :5220-5229：束源切 (-20,-39) 档；束端 = 目标盒内随机点（RandomVector2(0,1)）
      const src = this.minecartMechPoint(p, -20, -39);
      const rx = e.x + e.w * Math.random(), ry = e.y + e.h * Math.random();
      this.laserBeams.push({
        dx: src.x - this.x, dy: src.y - this.y,
        vx: rx - src.x, vy: ry - src.y,
        dirX: Math.sign(this.vx), age: 0,
      });
      // damage=60 → Damage()（无 melee/ranged/magic 旗 → 三类掷不达；kb 0）
      // ★F1：Damage 面 → 攻端旗乘区（ApplyBannerDamageDealt 单源）
      // ★BJ467③（2026-10-03）TimerCrit :12928 补位——原版 CastSuperCartLaser（Mount.cs
      //  :5264-5290）对每靶 NewProjectile(591) 直调 `Damage()`（:5282）= Damage_PVE_Inner
      //  全管线,TryConsumingTimerCrit 对一切玩家弹无条件消费（三类掷不达但蓄能暴击照
      //  强制,charge→−15）。快照纪律:门读 hurt 前状态——:12636 immune 门已由上方
      //  `e.iframes > 0 continue` 承载、:12686 dontTakeDamage 门在 :745 承载,此处即受理位。
      const cartTimerCrit = ((game.player as unknown as
        { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
        | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h)) ?? false;
      //  ★BJ729-A（2026-10-27）:S02(BJ723-B) 全仓预倍清偿漏站——BJ467③ 期预倍形
      //  `* (cartTimerCrit ? 2 : 1)` + crit 同传=×4 双倍;Enemy.hurt 防后单次 ×2
      //  （NPC.cs:82067,Mount.cs:5282 Damage()→StrikeNPC 单次乘区）承载,预倍摘除。
      e.hurt(applyBannerDamageDealt(game, e, SUPER_CART_LASER_DMG), 0, 0, game, 0, cartTimerCrit, 0, true);   // 玩家矿车激光=DPS 计;★BJ467③ crit 位;★BJ729-A 预倍摘除
    }
  }

  // ---------------------------------------------------------------------------
  // 鼠马车挖掘（Player.cs:19912-19933 TryUsingDiggerCart + MinecartDiggerHelper.cs）
  // ---------------------------------------------------------------------------

  /** Player.RotatedRelativePoint（Player.cs:4063-4077）矿车态：
   *  pivot = Bottom+(0,gfxOffY)；pos.Y += gfxOffY 后绕 pivot 旋 fullRotation，
   *  再 + (0,-num2) + (0,num2).RotatedBy（num2 = PlayerOffset/2+4 = 8，
   *  矿车 playerYOffsets 恒 8，SetAsMinecart :2720-2726） */
  private rotatedRelativePoint(px: number, py: number): { x: number; y: number } {
    const rot = this.rotation;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const pivX = this.x + this.w / 2;
    const pivY = this.y + this.h + this.gfxOffY;
    // pos.Y += gfxOffY（:4075）与 pivot 内的 gfxOffY 相消（同加一次）
    const vx0 = px - this.x - this.w / 2;
    const vy0 = py - (this.y + this.h);
    const rx = vx0 * cos - vy0 * sin, ry = vx0 * sin + vy0 * cos;
    const num2 = 4 + 4;                                   // PlayerOffset(8)/2 + 4
    return {
      x: pivX + rx + -num2 * sin,
      y: pivY + ry - num2 + num2 * cos,
    };
  }

  /** TryUsingDiggerCart（Player.cs:19912-19933）：鼠马车在轨且落地时，
   *  按住任一方向键 → 朝 facing 挖穿前方并延轨 */
  private tryUsingDiggerCart(p: Player, game: GameHooks): void {
    if (this.mountId !== MOLE_CART_MOUNT || this.vy !== 0) return;   // :19914
    const num = 12, num2 = 20;
    const st = game.world.store;
    const isTrackAt = (wx: number, wy: number): boolean => {
      if (!st.inBounds(Math.trunc(wx / 16), Math.trunc(wy / 16))) return false;
      const k = st.idx(Math.trunc(wx / 16), Math.trunc(wy / 16));
      return !!(st.flags[k] & 1) && st.type[k] === TRACK_TILE;
    };
    // :19918-19920 前探点（Center + (12·direction, gravDir·20)）再 + (0, gravDir·10)
    const gravDir = 1;   // 矿车无重力翻转（本仓未实装 gravDir 翻转坐骑）
    let tp = this.rotatedRelativePoint(
      this.x + this.w / 2 + num * p.facing, this.y + this.h / 2 + gravDir * num2);
    tp = { x: tp.x, y: tp.y + gravDir * 10 };
    if (!isTrackAt(tp.x, tp.y)) {                        // :19922 非轨道 → 半档 X 再试
      tp = this.rotatedRelativePoint(
        this.x + this.w / 2 + num * p.facing * 0.5, this.y + this.h / 2 + gravDir * num2);
      tp = { x: tp.x, y: tp.y + gravDir * 10 };
    }
    const digY = (p.inputDown ? 1 : 0) - (p.inputUp ? 1 : 0);   // :19927
    if (p.inputUp || p.inputDown || p.inputX !== 0) {           // :19928 任一方向键
      this.moleTryDigging(p, game, Math.trunc(tp.x / 16), Math.trunc(tp.y / 16),
        p.facing, digY);
    }
  }

  /** MinecartDiggerHelper.TryDigging（MinecartDiggerHelper.cs:10-56） */
  private moleTryDigging(p: Player, game: GameHooks, px: number, py: number,
    digX: number, digYArg: number): void {
    const digY = 0;   // :12 digDirectionY 强制归零（竖挖分支不可达，原版同款死代码）
    const st = game.world.store;
    // :14 站位非轨道 || 地表以上 → 不挖（worldSurface = Main.worldSurface）
    const worldSurface = (game.world as unknown as { groundLevel?: number }).groundLevel ?? 0;
    if (!st.inBounds(px, py) || st.type[st.idx(px, py)] !== TRACK_TILE
      || !st.inBounds(px, py + digY) || py < worldSurface) return;
    const point2 = { x: px + digX, y: py + digY };
    // :21 已连通（含 ±1 竖差绕行）→ 不重挖
    if (this.alreadyLeadsIntoWantedTrack(st, px, py, point2.x, point2.y)
      || (digY === 0 && (this.alreadyLeadsIntoWantedTrack(st, px, py, point2.x, point2.y - 1)
        || this.alreadyLeadsIntoWantedTrack(st, px, py, point2.x, point2.y + 1)))) return;
    const num = 5;   // :25-29 挖穿列高（竖挖同为 5）
    const y0 = point2.y - (num - 1);
    // :33-40 前方 5 格逐格预检（可通行 + 镐力足）
    for (let y = y0; y <= point2.y; y++) {
      if (!this.canGetPastTile(game, point2.x, y)) return;
      if (!game.pickPowerEnough?.(point2.x, y)) return;
    }
    // :41-48 有轨道物品 → 挖穿 5 格 + 消耗 1 轨道 + 放新轨
    const slot = this.findMinecartTrackItem(p);
    if (slot < 0) return;
    for (let y = y0; y <= point2.y; y++) this.mineTheTileIfNecessary(game, point2.x, y);
    p.inv.removeAt(slot, 1);
    placeTrack(st, point2.x, point2.y, 0);   // PlaceATrack :190-198（style 0 普通轨）
    frameTrackArea(st, point2.x, point2.y);  // WorldGen.PlaceTile case 314 的 framing 链
    this.vx = Math.max(-1, Math.min(1, this.vx));   // :50 挖穿瞬间限速
    // :51-54 连接不完整 → 双端帧修正
    if (!this.alreadyLeadsIntoWantedTrack(st, px, py, point2.x, point2.y)) {
      this.correctTrackConnections(st, px, py, point2.x, point2.y);
    }
  }

  /** AlreadyLeadsIntoWantedTrack（MinecartDiggerHelper.cs:99-121）+
   *  GetExpectedDirections（:123-141）：两端皆为轨道且连接方向互恰 */
  private alreadyLeadsIntoWantedTrack(st: TileStore, sx: number, sy: number,
    ex: number, ey: number): boolean {
    const isTrack = (x: number, y: number): boolean =>
      st.inBounds(x, y) && !!(st.flags[st.idx(x, y)] & 1) && st.type[st.idx(x, y)] === TRACK_TILE;
    if (!isTrack(sx, sy) || !isTrack(ex, ey)) return false;
    // GetExpectedDirections：dy = ey-sy、dx = ex-sx；
    // dx==-1 → startLeft=dy/endRight=-dy；dx==1 → startRight=dy/endLeft=-dy
    const dy = ey - sy, dx = ex - sx;
    let expStartLeft: number | null = null, expStartRight: number | null = null;
    let expEndLeft: number | null = null, expEndRight: number | null = null;
    if (dx === -1) { expStartLeft = dy; expEndRight = -dy; }
    if (dx === 1) { expStartRight = dy; expEndLeft = -dy; }
    if (!areSidesMetForTrack(st, sx, sy, expStartLeft, expStartRight)) return false;
    if (!areSidesMetForTrack(st, ex, ey, expEndLeft, expEndRight)) return false;
    return true;
  }

  /** CorrectTrackConnections（MinecartDiggerHelper.cs:148-161）：双端按期望连接
   *  重定型（TryFittingTileOrientation，Minecart.cs:1564-1607） */
  private correctTrackConnections(st: TileStore, sx: number, sy: number,
    ex: number, ey: number): void {
    const dy = ey - sy, dx = ex - sx;
    let expStartLeft: number | null = null, expStartRight: number | null = null;
    let expEndLeft: number | null = null, expEndRight: number | null = null;
    if (dx === -1) { expStartLeft = dy; expEndRight = -dy; }
    if (dx === 1) { expStartRight = dy; expEndLeft = -dy; }
    tryFittingTileOrientation(st, sx, sy, expStartLeft, expStartRight);
    tryFittingTileOrientation(st, ex, ey, expEndLeft, expEndRight);
  }

  /** CanGetPastTile（MinecartDiggerHelper.cs:172-188）：CheckTileBreakability==0 +
   *  ShouldTileSurvive==false + （活性时）非困难祭坛/CanKillTile 双门 */
  private canGetPastTile(game: GameHooks, x: number, y: number): boolean {
    const st = game.world.store;
    const ctx: KillTileCtx = {
      hardMode: !!(game.world.flags as Record<string, boolean> | undefined)?.hardMode,
      // chestDestroyable 缺省：无宝箱内容表时按可毁近似（Mounts.ts 同口径注释）
      chestDestroyable: () => true,
    };
    if (checkTileBreakabilityAt(st, x, y, ctx) !== 0) return false;
    if (shouldTileSurviveAt(st, x, y, ctx)) return false;
    const k = st.idx(x, y);
    if (st.flags[k] & 1) {
      // :183 tile 26（DemonAltar）非困难模式不可破（sheet 26 = 该原版型的素材表）
      const def = TILE_DEFS[st.type[k]];
      if (def?.vanilla?.sheet === 26 && !ctx.hardMode) return false;
      if (!canKillTileAt(st, x, y, ctx)) return false;
    }
    return true;
  }

  /** FindMinecartTrackItem（MinecartDiggerHelper.cs:73-89）：0-57 格内首个
   *  2340 轨道物品；正被使用的选中格跳过（:78 selectedItem==i 且使用窗内） */
  private findMinecartTrackItem(p: Player): number {
    for (let i = 0; i < 58; i++) {
      const s = p.inv.slots[i];
      if (!s) continue;
      if (p.inv.selected === i && p.itemAnimTicks > 0) continue;   // :78
      const def = ITEM_DEFS[s.id];
      const vid = def?.vid ?? (def ? (def.vid ?? -1) : -1);
      if (vid === TRACK_ITEM_VID && s.stack > 0) return i;
    }
    return -1;
  }

  /** MineTheTileIfNecessary（MinecartDiggerHelper.cs:200-209）：活性格 KillTile
   *  （掉落+音效+帧刷新——breakTile 即 WorldGen.KillTile 语义） */
  private mineTheTileIfNecessary(game: GameHooks, x: number, y: number): void {
    const st = game.world.store;
    if (st.inBounds(x, y) && st.flags[st.idx(x, y)] & 1) {
      game.breakTile?.(x, y);
    }
  }

  /** 脱轨后的常规碰撞（DryCollision 的矿车路径：轴向分离、仅实心格——
   *  坐骑恒 fallThrough=true（Player.cs:27787-27790 mount.Cart），平台穿过）。
   *  落地 = 下行被挡（vy 清零），由调用方按 vy 是否归零结算摔伤/贴地态 */
  private dryCollide(st: TileStore): void {
    // X 轴（像素步进防隧穿）
    const stepX = Math.sign(this.vx);
    let remainX = Math.abs(this.vx);
    while (remainX > 0) {
      const s = Math.min(1, remainX);
      remainX -= s;
      const nx = this.x + stepX * s;
      if (this.boxSolid(st, nx, this.y)) { this.vx = 0; break; }
      this.x = nx;
    }
    // Y 轴
    const stepY = Math.sign(this.vy);
    let remainY = Math.abs(this.vy);
    while (remainY > 0) {
      const s = Math.min(1, remainY);
      remainY -= s;
      const ny = this.y + stepY * s;
      if (this.boxSolid(st, this.x, ny)) {
        this.vy = 0;
        break;
      }
      this.y = ny;
    }
  }

  /** 盒内是否有实心格（TileStore.isSolid：active+tileSolid；平台不挡车） */
  private boxSolid(st: TileStore, x: number, y: number): boolean {
    const x0 = Math.floor(x / 16), x1 = Math.floor((x + this.w - 0.01) / 16);
    const y0 = Math.floor(y / 16), y1 = Math.floor((y + this.h - 0.01) / 16);
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }
}
