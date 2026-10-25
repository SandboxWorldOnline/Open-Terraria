// 磁球（Magnet Sphere 1266）两件套：悬停球 254（aiStyle 47）+ 激光弹 255（aiStyle 48）。
// ★BJ345（2026-09-25 用户实报「磁球弹幕不会发射激光」定谳）：原 1266 走 magic 通用
//   尾支 = 254 落 Arrow 直飞弹，AI_047 悬停/去重/索敌/发弹整缺，弹 255 从未生成
//   ——激光链（球→弹→死亡铺束→d160 尘线）三级全缺。反编译锚（Terarria1457，行号均
//   指该树；1458 增量未触本域，SetDefaults 零变更）：
//   · 球 254 SetDefaults :3371-3379：38×38 / aiStyle 47 / magic / timeLeft 900 /
//     light 0.5——★无 friendly 行 = 本体零接触伤害，伤害全部经发弹转发到 255；
//     tileCollide 缺省 true，撞墙走 HandleMovement 弹性族 :18640-18648（254 档 =
//     velocity 对 lastVelocity 逐轴全速反转 ×-1 无阻尼，永不撞亡，900t 到期才散）
//   · AI_047_MagnetSphere :42145-42186（每 tick 一次,extraUpdates=0）：
//       ai[0]==0 → ai[0]/[1]=初速存档（无运行时消费面,备案）；rotation ±(|vy|+|vx|)×
//       0.001（vx>0 正转）；帧计数 >6 步进、frame>4 归 0（5 帧,Main.cs:8715
//       projFrames[254]=5,贴图 38×220 → 帧高 44）；|v|>2 → v×0.98 阻尼（shootSpeed
//       1.2 常态不触）；同主同型去重 :42168-42176（我 life>他 life 且他>30 → 他=30,
//       双球观感=旧球 30t 内加算白淡出）；尾调 TryAttacking
//   · AI_047_MagnetSphere_TryAttacking :42188-42243：owner==myPlayer 门；候选 =
//       CanBeChasedBy + 曼哈顿距离（球心→怪心）<300 + Collision.CanHit(球心1×1,
//       怪心1×1) 上限 20（满 20 后仍刷新 flag）；timeLeft<30 → flag=false 停发；
//       flag 时 Main.rand.Next(num) 掷目标（每 flag tick 恰一掷,掷在发弹门前）→
//       localAI[0]++ >8 → 清零发弹：出生位=球心+velocity×4、方向=目标心−出生位
//       归一 ×6、NewProjectile(255, ball.damage, ball.knockback, owner)——发射/
//       命中全静默（aiStyle48 唯一有声支 = 290 的 Item8 :28633-28636）
//   · 弹 255 SetDefaults :3380-3389：8×8 / aiStyle 48 / friendly / magic /
//     extraUpdates=100 / timeLeft 100；penetrate 缺省 1（单发）；tileCollide 缺省
//     true；aiStyle48 派发 :28622-28625 α=255 = 本体全隐形（视觉=粒子束）
//   · Update 子步循环 :16781（while numUpdates>=0 内 AI→湿段→HandleMovement→
//     Damage→timeLeft-- 逐子步）→ extraUpdates=100 = 每拍 101 子步,速度 6px/子步
//     ×100 拍寿命 → 全程单 tick、最大射程 ≈600px（timeLeft 逐子步 −1,:17307 在
//     循环内——100 子步后 timeLeft 0 → Kill,「伪光束」设计本体）
//   · aiStyle48 派发 :28608-28639：InWorld(越界 5 格) → Kill；localAI[0]==delay
//     （255→4,GetStartPositionSettingDelay :54934-54948）记束段锚 localAI[1]/[2]=
//     心（=出生后第 4 子步末位,球前 24px）;localAI[0]++ 每子步
//   · Kill 内铺束 :71825-71859（★宿主=Kill 非 AI）：门 = owner==myPlayer ∧
//     localAI[0]>=delay ∧ 锚点双正 → BroadcastOrRequestParticleSpawn(
//     MagnetSphereBolt, PositionInWorld=死亡心, MovementVector=锚点,
//     UniqueInfoPiece=|velocity|×1000);粒子 = Spawn_MagnetSphereBolt
//     （ParticleOrchestrator.cs:1965-1974 + SpawnHelper_SpawnInLine :2002-2034：
//     步距 max(4,|v|) 沿锚→死亡心,每步 4×d160 回拖 0/.25/.5/.75）——SW 消费面既有
//     （fx/orchestraFx.magnetSphereBoltTrailFx + Game.ts :34175 分发 + syncModules
//     枚举 56）,缺的只是发射方 = 本刀;联机双通道形（本地直生 + broadcast）沿
//     Dart.killBeam290 / Arrow 294 先例
//   · 命中链：Damage() 逐子步、首相交怪 hurt（单发 flag3 maxPenetrate==1 语义）→
//     penetrate-- ≤0 → Kill → 死亡位铺束;撞块同拍 Kill 铺束（HandleMovement 无
//     255/260 弹跳档）
//   · 湿段：254/255 均无 ignoreWater 行（SetDefaults 无该行,vanilla-projectiles
//     数据面同向）→ 受通用湿段 :16903-17113（溅花/旗维护/湿位移阻尼）,共享体
//     projectileWetSection 承载;弹为单 tick 生命,湿位移阻尼乘子步位移行
//   · GetAlpha :81277-81287（球）：timeLeft<30 → α=255−255·tL/30 → 返
//     (255−α,255−α,255−α,0) 纯加算白（XNA A=0 习语）强度 min(1,tL/30)——BJ236 的
//     Arrow GA case 254 + ADDITIVE_GLOW 登记在本地路径由本实体 draw 承接;Arrow
//     路径面仍活着 = 联机 kind0 傀儡位（netProjBroadcast 拦截支把 254 重建为
//     Arrow 254 静态傀儡,GA/PROJ_FRAMES 通道即远端绘制面）,勿摘
//   · 同族收编（aiStyle48 发束族普查,见 tests/magnet-sphere.test.ts 普查表）：
//     255 磁球弹（本刀）/ 260 炼狱叉弹（Inferno Fork 1295,同 aiStyle48,delay 3/
//     life 200/HeatRay 57——原走 Arrow 通用尾支 = 本体可见+束整缺,同刀收编）/
//     294 暗影束（Arrow 294 支既有）/ 433 UFO 激光（火星飞碟炮,敌域 Saucer 未
//     移植,无玩家发射源,消费面在位备而不动）
//   独立实体先例：ElectroSphereProj（驻场 AOE）/ proj1457（1457 批弹实体）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite } from './Arrow';
import { moveAndCollide } from '../physics/TileCollision';
import { projectileWetSection, projWaterDragFactor, type ProjWetFlags } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { canHitPoint } from '../physics/LineOfSight';
import { canBeChasedBy, playerCanHitEnemy, applyBannerDamageDealt, hitCritters } from './projTargets';
import { magnetSphereBoltTrailFx, heatRayTrailFx } from '../fx/orchestraFx';
import { ghostHealProc, ghostHurtOnHit, playerHasGhostHurt } from './SpectreSoulProj';   // ★BJ382 激光弹 255/260 proc 单源（★BJ424-T3 补 ghostHurt 漏斗面）
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424-T3 星云套装 on-hit 单源（自持命中环面收编）
import { rollVanillaHitCrit } from './proj1457';   // ★BJ489 def-3 掷率单源（函数声明环=运行时调用安全）
import { TILE } from '../core/constants';
import { runModModifyHitNpcByProj } from '../mods/hooks';   // ★D2:独立结算面补钩

/** 悬停球 254（ProjectileID.MagnetSphereBall） */
export const MAGNET_SPHERE_BALL = 254;
/** 激光弹 255（ProjectileID.MagnetSphereBolt） */
export const MAGNET_SPHERE_BOLT = 255;
/** 炼狱叉弹 260（ProjectileID.HeatRay,Inferno Fork 1295 直射,同 aiStyle48 族） */
export const HEAT_RAY_BOLT = 260;

// ParticleOrchestraType.MagnetSphereBolt=56 / HeatRay=57（syncModules 枚举同值面）
const ORCHESTRA_BOLT_TYPE: Record<number, number> = {
  [MAGNET_SPHERE_BOLT]: 56,   // MagnetSphereBolt（P.cs:71849-71851 255 档）
  [HEAT_RAY_BOLT]: 57,        // HeatRay（P.cs:71852-71854 260 档）
};
/** 束段锚记录延迟（AI_048_GetStartPositionSettingDelay :54934-54948） */
const START_DELAY: Record<number, number> = {
  [MAGNET_SPHERE_BOLT]: 4,
  [HEAT_RAY_BOLT]: 3,
};

interface HurtTarget {
  id?: number;
  dead?: boolean;
  x: number; y: number; w: number; h: number;
  dontTakeDamage?: boolean;
  hurt?: (dmg: number, kbx: number, kby: number, game: GameHooks,
    armorPen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
}

/**
 * aiStyle48 激光弹（255 磁球弹 / 260 炼狱叉弹）：隐形本体 + 死亡拍锚→死亡位铺束。
 * 逐子步语义 1:1（extraUpdates=100 → 每拍 100 子步,AI/湿段/撞块/命中/寿命逐子步;
 * 单 tick 生命,最大射程 = speed×timeLeft）。由磁球 AI_047 发射（255）或 1295
 * 直射（260）——发射侧传速度/伤/kb,暴击链 spawn 期注入（House 惯例）。
 */
export class BeamBoltProj extends Entity {
  w = 8; h = 8;                          // SetDefaults :3382-3383（260 同 8×8）
  vx: number;
  vy: number;
  damage: number;
  knockback: number;
  /** ★BJ489 def-3：值不作掷率消费（掷率=rollVanillaHitCrit 动态掷——255/260 magic 旗
   *  命中拍动态;磁球/充能爆破炮传播链类缺省 0.04=路由门,HeatRay 直出生同门）,仅作
   *  >0 路由门+关断钉载体（测试置 0 习语）。旧 `critChance||critBonus 缺省` 面退役 */
  critChance = 0.04;
  armorPen = 0;
  /** 本机拥有（owner==myPlayer 门：发束广播/伤害结算仅拥有者端） */
  local = true;
  readonly projId: number;
  /** ★BJ382：PVE 受理命中计数（原版 Projectile.numHits——SetDefaults :706 起始 0;
   *  :14263 受理后自增 ⇒ proc（:13877-79）读自增前值;255/260 单发 flag3 首跳恒 0 档。
   *  字段名对齐 SpectreSoulProj.projPveNumHits 读口（PVP 反馈 BJ157-④ 单源） */
  pveNumHits = 0;
  /** timeLeft（SetDefaults :3388 255→100 / 260→200;逐子步 −1） */
  private tl: number;
  /** 子步龄（vanilla localAI[0],跨子步累计;锚记录/发束门读数） */
  private l0 = 0;
  /** 束段锚（localAI[1]/[2];未记录 = 负数哨兵,vanilla 双正门） */
  private ax = -1;
  private ay = -1;
  /** 通用湿段旗组（:16903-17113;ProjWetFlags 直挂式,proj1457 同构） */
  wet = false; lavaWet = false; honeyWet = false; shimmerWet = false;
  wetCount = 0; presetDone = false;

  constructor(cx: number, cy: number, vx: number, vy: number,
    damage: number, knockback: number, projId: number = MAGNET_SPHERE_BOLT) {
    super();
    this.projId = projId;
    this.tl = projectileData(projId)?.timeLeft
      ?? (projId === HEAT_RAY_BOLT ? 200 : 100);
    this.x = cx - this.w / 2;              // NewProjectile 盒心落点（:10878-10879）
    this.y = cy - this.h / 2;
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
  }

  /** 死亡铺束（Kill :71825-71859 aiStyle48 组）：门 = local ∧ l0>=delay ∧ 锚双正。
   *  本地直生 trailFx + broadcast 上行（Dart.killBeam290 本地+广播双通道形） */
  private killBeam(game: GameHooks): void {
    if (this.dead) return;
    if (this.local && this.l0 >= (START_DELAY[this.projId] ?? 0)
      && this.ax > 0 && this.ay > 0) {
      const kind = ORCHESTRA_BOLT_TYPE[this.projId];
      if (kind !== undefined) {
        const info = Math.round(Math.hypot(this.vx, this.vy) * 1000);
        // 参数序 = (type, posX=死亡心, posY, moveX=锚, moveY, uniqueInfo=|v|×1000)
        // ——orchestraLineWalk 消费 (move→pos) 铺撒,SpawnHelper_SpawnInLine 同构
        game.broadcastParticleOrchestra?.(kind, this.cx, this.cy, this.ax, this.ay, info);
        // 本地直生：Game 分发面（:34175）只在收到广播时跑,单机/拥有者端直呼同体
        if (kind === 56) magnetSphereBoltTrailFx(game, this.ax, this.ay, this.cx, this.cy, info);
        else heatRayTrailFx(game, this.ax, this.ay, this.cx, this.cy, info);
      }
    }
    this.dead = true;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }   // 远端快照驱动,不本地结算
    const st = game.world.store;
    const delay = START_DELAY[this.projId] ?? 0;
    // —— 逐子步（Update :16781 while numUpdates>=0;extraUpdates=100 → 每拍 101 次
    //    循环检查;AI→湿段→位移→命中→寿命全在循环内,AI :16880/HandleMovement :17120/Damage :17184/timeLeft :17307）——
    const subSteps = (projectileData(this.projId)?.extraUpdates ?? 100) + 1;
    for (let s = 0; s < subSteps && !this.dead; s++) {
      // ①AI_048 派发 :28608-28639：InWorld 越界 Kill = WorldGen.InWorld(center,5)
      //   （:28610-28614;WorldGen.cs:9642-9649 = tile∈[5,max−5)）。★BJ708-G28 勘正:
      //   旧 ±(−5/+5) 四界双侧外扩 10 格（BJ345 自带偏差,世界缘 5 格内行为差,
      //   低危）——对齐原版四界（Arrow 433 支 :8257-8260 BJ708-A 同式）。
      const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
      if (tx < 5 || ty < 5 || tx >= st.w - 5 || ty >= st.h - 5) {
        this.killBeam(game);
        break;
      }
      // ②锚记录（localAI[0]==delay 精确等值,:28615-28617）
      if (this.l0 === delay) { this.ax = this.cx; this.ay = this.cy; }
      this.l0++;
      // ③湿段（:16895-17113 逐子步;溅花/旗由共享体承载,ignoreWater 缺省 false）
      projectileWetSection(this, game, st, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      // ④位移（HandleMovement :17120;tileCollide 缺省 true,255/260 无弹跳档 →
      //   撞块 Kill;湿位移阻尼乘子步位移行,速度场不减——WeaponProj 共享口径）
      const drag = projWaterDragFactor(this);
      const body = {
        x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy,
        onGround: false, hitWall: false, hitHead: false, collideY: false,
        hoik: true,            // ★FX34c 弹幕域 hoik=true（原版 Projectile 全路径）
        dropThrough: true,     // 原版弹体 flag6 fallThrough 缺省 true（:17587）
        tileCollide: true,
      };
      moveAndCollide(body, game.world, this.vx * drag, this.vy * drag);
      this.x = body.x; this.y = body.y;
      if (body.hitWall || body.hitHead || body.onGround || body.collideY) {
        this.killBeam(game);   // 撞块亡 → 死亡位铺束
        break;
      }
      // ⑤Damage()（:17184 逐子步;首相交怪 → 单发 flag3 → Kill 铺束）
      // ★X2-D3（2026-09-29）critter 面：255 penetrate 缺省 1（SetDefaults :3380-3389
      //  无行,:366 字段缺省）/260 penetrate=1（:3443-3452）→ critter 受击 :14189-14196
      //  递减归零 → :17312 Kill = 铺束同相（敌怪首中即亡同款）;桶序先小动物（BJ383
      //  桶序登记近似）;:14263 numHits++ 对 critter 受理命中同达 → 入账。原版
      //  Damage() victim 循环（:12618）critter 恒在内,本仓独立桶不被扫到=激光弹对
      //  小动物零受击。
      if (hitCritters(this, game)) { this.pveNumHits++; this.killBeam(game); break; }
      for (const ent of game.enemies()) {
        const e = ent as HurtTarget;
        if (e.dead || !e.hurt) continue;
        if (!playerCanHitEnemy(ent, game, this.projId)) continue;
        if (!(this.x < e.x + e.w && this.x + this.w > e.x
          && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
        // ★BJ489 def-3：掷率=rollVanillaHitCrit（255/260 magic 旗,命中拍 owner 装配+
        //  :25712 持械折入动态;critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        // ★BJ395（2026-09-28,BJ393 同族债五处清偿④）：受理面谓词 vanillaGated。
        //   pierce=1 单发 flag3（:12635）免疫门豁免 → hurt 内 iframes 拒收不可达;
        //   dead 已 :206 前置 → 可达门拒仅 dontTakeDamage（:13978;原版外层
        //   :12600 dontTakeDamage 门同面,本环无前置检）。Enemy.hurt 返真=「本拍
        //   击杀/假人」（Enemy.ts:15033/:14184）,普通未致命命中尾档 :15037/血尽
        //   级联 :14369 族返假但伤害已实扣=原版受理 → 旧布尔闸下 ghostHeal/numHits
        //   对非致死命中整面不达（激光弹主导形态=under-fire）。
        const vanillaGated = e.dontTakeDamage === true;
        // ★D2:独立结算面补钩(this.damage 值域→新变量承接)
        const dmgHooked = runModModifyHitNpcByProj(game.player, game, (this as unknown as { projId?: number }).projId ?? -1,
          (e as unknown as { vanillaId?: number }).vanillaId ?? -1, this.damage, false);
                e.hurt(applyBannerDamageDealt(game, ent, Math.max(1, Math.trunc(dmgHooked))),
          Math.sign(e.x + e.w / 2 - this.cx) * this.knockback, 0, game,
          this.armorPen, crit, 1, true);     // pierce=1 单发 flag3（:11904 语义）
        if (!vanillaGated) {
          // ★BJ382：幽灵兜帽吸血 proc（Projectile.cs:13877-79 Damage() 通用 on-hit 段;
          //  255/260 数据面 magic ⇒ 原版磁球激光/炼狱叉光束本就吸血,本仓漏接）——
          //  proc 先于 :14263 numHits++（读自增前值）;拒收不 proc 不计数
          ghostHealProc(game, this.projId, this.pveNumHits, e);
          // ★BJ424-T3（2026-10-01 魔法命中漏斗面收编）：原版同一 if 块三引擎同 face——
          //  ghostHeal :13877-79 → ghostHurt :13881-83 → nebula :13885-91。凡走本受理面
          //  的命中（255/260 数据面 magic）两引擎都该触发,此前同缺。
          if (playerHasGhostHurt(game.player)) {
            const v424 = e as never as { vanillaId?: number | null; lastStrikeDealt?: number;
              maxHp?: number; def?: { lifeMax?: number } };
            ghostHurtOnHit(game,
              { magic: true, projDamage: this.damage,
                projX: this.x, projY: this.y, projW: this.w, projH: this.h,
                ownerCx: game.player.cx, ownerCy: game.player.cy },
              { x: e.x, y: e.y, w: e.w, h: e.h,
                cx: e.x + e.w / 2, cy: e.y + e.h / 2,
                vanillaId: v424.vanillaId,
                lifeMax: v424.maxHp ?? v424.def?.lifeMax,
                dealt: v424.lastStrikeDealt ?? 0 });
          }
          nebulaBoosterOnHit(game,
            { projId: this.projId, projDirX: this.vx },
            { x: e.x, y: e.y, w: e.w, h: e.h,
              cx: e.x + e.w / 2, cy: e.y + e.h / 2,
              vanillaId: (e as never as { vanillaId?: number | null }).vanillaId,
              lifeMax: (e as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
                ?? (e as never as { def?: { lifeMax?: number } }).def?.lifeMax,
              dealt: (e as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
          this.pveNumHits++;
        }
        this.killBeam(game);
        break;
      }
      if (this.dead) break;
      // ⑥timeLeft--（:17307 循环内;≤0 → Kill）
      if (--this.tl <= 0) { this.killBeam(game); break; }
    }
  }

  draw(_r: Renderer, _cam: Camera): void {
    // 本体全隐形（α=255 + GetAlpha 缺省路径 → 透明;视觉=粒子束,零绘制）
  }
}

/**
 * 磁球悬停球 254（aiStyle 47）：慢速漂移 + 撞墙全弹返 + 5 帧自旋 + 同型去重 +
 * 周期性向 300px 内可视敌怪发激光弹 255。本体零伤害（SetDefaults 无 friendly 行）,
 * 伤害面全在 255 弹（AI_047 发弹时透传 damage/knockback）。
 */
export class MagnetSphereProj extends Entity {
  w = 38; h = 38;                        // SetDefaults :3372-3373
  vx: number;
  vy: number;
  damage: number;
  knockback: number;
  /** ★BJ489 def-3：值不作掷率消费（本体无伤面;掷率=255 弹 BeamBoltProj 面
   *  rollVanillaHitCrit 命中拍动态）,0.04=透传路由门（>0）+关断钉载体。
   *  ★BJ497②（2026-10-04）critBonus 死值位摘除：spawn 位无写者（Game.ts :19587
   *  BJ489 载体退役）→ 恒 0;:400 传播写位与 BeamBoltProj 读位全无=链上三层全死。
   *  critChance 透传保留（magnet-sphere.test :228 契约）。 */
  critChance = 0.04;
  armorPen = 0;
  /** 本机拥有（owner==myPlayer 门 = TryAttacking 发弹权;远端傀儡/同步球不发） */
  local = true;
  /** timeLeft（SetDefaults :3377 = 900） */
  life = 900;
  /** 旋转（AI_047 :42151-42158） */
  rotation = 0;
  private frame = 0;
  private frameCnt = 0;
  /** 发弹节拍（localAI[0];>8 清零发弹 = 每 9 tick 1 发） */
  private fireClock = 0;
  /** ai[0]/[1] 初速存档（:42147-42150;无运行时消费,备案字段） */
  ai0 = 0; ai1 = 0;
  /** 通用湿段旗组（无 ignoreWater 行 → 受段） */
  wet = false; lavaWet = false; honeyWet = false; shimmerWet = false;
  wetCount = 0; presetDone = false;
  /** 弹体点光（SetDefaults light 0.5f :3378 → 白光 0.5;Game 实体光扫读） */
  lightRGB: [number, number, number] = [0.5, 0.5, 0.5];

  constructor(cx: number, cy: number, vx: number, vy: number,
    damage: number, knockback: number) {
    super();
    this.x = cx - this.w / 2;
    this.y = cy - this.h / 2;
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.ai0 = vx; this.ai1 = vy;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const st = game.world.store;
    // ①rotation（:42151-42158）：vx>0 → +=(|vy|+|vx|)×0.001,否则 −=
    const spin = (Math.abs(this.vy) + Math.abs(this.vx)) * 0.001;
    this.rotation += this.vx > 0 ? spin : -spin;
    // ②帧动画（:42160-42168）：计数 >6 步进,frame>4 归 0（5 帧）
    if (++this.frameCnt > 6) {
      this.frameCnt = 0;
      if (++this.frame > 4) this.frame = 0;
    }
    // ③速度阻尼（:42169-42172）：|v|>2 → ×0.98（shootSpeed 1.2 常态不触）
    if (Math.hypot(this.vx, this.vy) > 2) {
      this.vx *= 0.98; this.vy *= 0.98;
    }
    // ④同主同型去重（:42168-42176）：我 life > 他.life 且他.life > 30 → 他 = 30
    for (const p of game.projectiles?.() ?? []) {
      const q = p as MagnetSphereProj;
      if (q === this || q.dead || !(q instanceof MagnetSphereProj)) continue;
      if (this.life > q.life && q.life > 30) q.life = 30;
    }
    // ⑤湿段（AI 后/位移前,proj1457 共享体同序;无 ignoreWater 行 → 受段）
    projectileWetSection(this, game, st, this.x, this.y, this.w, this.h,
      MAGNET_SPHERE_BALL, !!projectileData(MAGNET_SPHERE_BALL)?.ignoreWater);
    // ⑥位移 + 撞墙全速反转（HandleMovement 弹性族 :18640-18648 254 档：
    //   lastVelocity 逐轴 ×-1,无阻尼系数;湿位移阻尼乘位移行不碰速度场）
    const lvx = this.vx, lvy = this.vy;
    const drag = projWaterDragFactor(this);
    const body = {
      x: this.x, y: this.y, w: this.w, h: this.h, vx: this.vx, vy: this.vy,
      onGround: false, hitWall: false, hitHead: false, collideY: false,
      hoik: true, dropThrough: true, tileCollide: true,
    };
    moveAndCollide(body, game.world, this.vx * drag, this.vy * drag);
    this.x = body.x; this.y = body.y;
    if (body.hitWall) this.vx = -lvx;
    if (body.hitHead || body.onGround || body.collideY) this.vy = -lvy;
    // ⑦寿命（:17307 逐 tick;≤0 Kill——无专属 Kill 特效,GetAlpha 淡出面在 draw）
    if (--this.life <= 0) { this.dead = true; return; }
    // ⑧TryAttacking（:42188-42243;owner==myPlayer 门）
    if (!this.local) return;
    const cand: Array<{ cx: number; cy: number }> = [];
    let seen = false;
    for (const ent of game.enemies()) {
      const e = ent as HurtTarget;
      if (e.dead || !canBeChasedBy(ent)) continue;
      const ncx = e.x + e.w / 2, ncy = e.y + e.h / 2;
      if (Math.abs(this.cx - ncx) + Math.abs(this.cy - ncy) < 300
        && canHitPoint(st, this.cx, this.cy, ncx, ncy)) {
        if (cand.length < 20) cand.push({ cx: ncx, cy: ncy });
        seen = true;
      }
    }
    // timeLeft<30 停发（:42228-42230,散场前 0.5s 静默）
    if (!seen || this.life < 30) return;
    // 掷目标（每 flag tick 恰一掷,掷序在发弹门【前】= :42232 Main.rand.Next(num)）
    const pick = cand[Math.floor(Math.random() * cand.length)];
    if (pick === undefined) return;
    if (++this.fireClock > 8) {
      this.fireClock = 0;
      // 出生位 = 球心 + velocity×4（:42239-42241）;方向归一 ×6（:42242-42247）
      const sx = this.cx + this.vx * 4;
      const sy = this.cy + this.vy * 4;
      const dx = pick.cx - sx, dy = pick.cy - sy;
      const dl = Math.hypot(dx, dy);
      if (dl > 0) {
        const spd = 6 / dl;
        const bolt = new BeamBoltProj(sx, sy, dx * spd, dy * spd,
          this.damage, this.knockback, MAGNET_SPHERE_BOLT);
        bolt.local = true;
        bolt.critChance = this.critChance;
        // ★BJ497②：bolt.critBonus 传播写位摘除（链上死值,255 读位 BJ489 已迁 rollVanillaHitCrit）
        bolt.armorPen = this.armorPen;
        // NewProjectile 内联 SendData(27) 短命弹即时上线（Z-F4 通道）
        game.spawnFriendlyProj?.(bolt, { netSync: true });
      }
    }
  }

  /** 加算白绘制（GetAlpha :81277-81287）：timeLeft<30 → 强度 min(1,tL/30) 线性淡出,
   *  满寿期恒 1;A=0 → dst += tex.rgb（XNA 习语）= 'lighter' 全强度白。5 帧竖条
   *  （38×220 → 帧高 44）绕盒心旋转。 */
  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(MAGNET_SPHERE_BALL);
    if (!img || img.width <= 0) return;
    const fh = img.height / 5;               // projFrames[254]=5（Main.cs:8715）
    const sy = this.frame * fh;
    const strength = Math.min(1, this.life / 30);
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rotation);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = strength;
    ctx.drawImage(img as CanvasImageSource, 0, sy, img.width, fh,
      -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
