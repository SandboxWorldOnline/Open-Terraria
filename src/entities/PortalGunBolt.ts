// 传送门枪物品链的 601 PortalGunBolt 弹体（ProjectileID.cs:1562）。
// 全链（item 3384 = Portal Gun，ItemID.cs:8307；★任务单曾写 1153——1153 是
// Lihzahrd Watcher Statue 旗帜，源码为唯一标杆取 3384）：
//   ① Item.cs:30926-30942 case 3384：useStyle5 / useAnimation=useTime=20 / shootSpeed 24f /
//     knockBack 2f / UseSound=null / shoot=600 / noMelee / noUseGraphic / channel / autoReuse
//   ② Player.cs:48053-48057：持有 3384 发 projToShoot(600)，ai1 = altFunctionUse==2 ? 1 : 0
//     （右键 = ManageRightClickFeatures :31161-31165 置 altFunctionUse=1 → ItemCheck
//      :42060-42063 升 2 → 蓝门；左键 0 = 橙门）
//   ③ Projectile.cs:63883-63911（600 首 AI 帧）：按鼠标重瞄准 ×24，发出 601
//     （速度 = normalize(瞄准)×3f，ai0 = form）——本类即该 601
//   ④ 601 SetDefaults（:6223-6231）：10×10 / aiStyle1 / alpha 255 / friendly / extraUpdates 30
//   ⑤ 601 AI（:51174-51228）：光尘 + alpha 每子步 -15 + 2 帧动画 + 拖尾尘
//   ⑥ 撞块（1457 :18195-18214;旧注 :16672-16691 系 1456 行号）：TryPlacingPortal(this, lastVelocity, velocity) → position += velocity → Kill
// extraUpdates 语义（Update :15331-15334 numUpdates=extraUpdates; while(numUpdates>=0)）：
// 每 tick "AI+移动+碰撞" 整轮跑 31 次 → 弹速 3px×31 = 93px/tick（近瞬时光束，撞块检测
// 逐子步进行不穿墙）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { TILE } from '../core/constants';
import { portalColor } from './Portal';
import { texId } from '../render/texId';
import { projectileWetSection, projWaterDragFactor, projShimmerStep,
  type ProjShimmerFace } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
// ★BJ704-G2（2026-10-21,债① 601 员）：残影环接线——601 TrailingMode=0/CacheLen 10
//  （ProjectileID.cs:385/:387）,通用表 P(1,8,1,0.3)（Main.cs:31101-31106）,
//  extraUpdates=30 → 31 子步/t 逐子步记录（UpdateTrails 位序=子步环内位移后）。
import { ProjGhostRing, drawProjGhosts } from './projGhostTrail';

/** 601 SetDefaults（:6225-6226）碰撞盒 */
const BOLT_W = 10;
const BOLT_H = 10;
/** :6230 extraUpdates = 30（每 tick 子步数 = extraUpdates+1 = 31） */
const EXTRA_UPDATES = 30;
/** :63904 num49 = 3f（600 发 601 的单子步速度） */
const BOLT_SPEED = 3;
/** SetDefaults 不写 timeLeft → 默认 3600 */
const BOLT_LIFE = 3600;

/** 601 PortalGunBolt（物品 3384 / 传送门炮共用弹型；物品链由此类承载） */
export class PortalGunBolt extends Entity {
  w = BOLT_W;
  h = BOLT_H;
  /** ai[0] = 门色 form（0 橙 / 1 蓝）。物品链：左键 0 / 右键 1（Player.cs:48055） */
  form: 0 | 1 = 0;
  /** alpha（:6228 初值 255，AI 每子步 -15 地板 0 → 约 9 子步后全显） */
  private alpha = 255;
  /** :51209-51214 frameCounter 4 子步一帧，Main.projFrames[601] = 2 */
  private frame = 0;
  private frameCounter = 0;
  /** timeLeft（每 tick 减 1，撞块/出界先死） */
  private life = BOLT_LIFE;
  private static frameCache = new Map<string, HTMLCanvasElement>();

  // ---- ★BJ704-G2（债① 601 员）：oldPos 残影环（mode0,31 子步/t;MinionProj 755
  //      接线式同构——单 id 域内 ghostRing 恒建,余型不达本类）。 ----
  private ghostRing = new ProjGhostRing(601);
  private recordGhostTrail(): void {
    // mode0 只记 oldPos（UpdateTrails :17197-17204）;ghost 角/翻转=本体当前态
    this.ghostRing.record(this.x, this.y, 0, 1, true);
  }

  // ---- ★通用湿段（Projectile.cs:16895-17113 共享体;2026-09-08 红队接入面 F3 清偿）----
  //  域 id = {601}（SetDefaults :6504-6512：10×10 aiStyle1 alpha255 friendly
  //  extraUpdates=30,无 ignoreWater 行=缺省 false（:763）→ 受段;tileCollide 缺省
  //  true）。同 id 装置弹变体（TrapShot,Dart.ts trapWetProjId→601）已接=双载体对称。
  //  插位=子步环内 AI 后/位移前——Update 子步循环（:16781 while numUpdates≥0）内
  //  湿段 :16895 逐子步,EU=30 → 每 tick 31 次（本类子步环同构）。AI_001 601 支
  //  （:55023-55060 逐行核对）零湿旗消费零速度写 → 采样位/位移消费等价。
  //  601 ∉ IsDestroyedByWater（{85,15,188,34,1097,1106}）→ 无水death kill 钩;aiStyle1 ∈
  //  Shimmer() 弹反族 A（:22606 深浸 Kill/vy>0 弹反+旗清+timeLeft 面）——★⑧已接
  //  （2026-09-08 残差五件批,湿段中央清单同步销号）：wetSectionStep 壳经 hooks.shimmer
  //  组装 ProjShimmerFace（范本=Boomerang WeaponProj.ts:767;面适配注见彼方法头）。
  //  ★杀拍口径（同批②）：寿命头 Kill 早退曾整体跳过湿段——原版 timeLeft--/Kill 在
  //  子步环【尾】（:17307-17311）,本子步湿段（:16895,无 active 门）照跑=杀拍溅花/
  //  旗面缺口;照 Arrow.ts wetSectionStep 双调用点+wetSectionRan 防双跑闩配方补杀拍
  //  调用（杀拍采样盒=本子步 AI 直写位——AI_001 601 零位写 → 采样=头顶位;死拍位移
  //  仍跳过=Kill 尘已结死零观感,Arrow 同案登记）。
  //  阻尼：tileCollide=true → HandleMovement :17721-17764 湿支生效,乘进逐子步
  //  位移行（速度场不减;AI 不写速度 → wetVelocity 快照 :16870 恒等,pre/post 等价）;
  //  撞块落门支 `position += velocity` 全速直写（Kill 拍原文字面）不受阻尼。
  //  溅花尘/音 = wetSplashStepShared（逐子步门 wetCount==0 ∧ !wet,与原版同拍频）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价;共享体首调自做=首子步出生盒;
   *  寿命头杀拍首调时=杀拍同位（AI_001 零位写）,预置位仍=出生盒） */
  presetDone = false;

  /** x/y = 弹心（600.Center，Projectile.cs:63905-63911）；内部存左上锚（碰撞盒 10×10，
   *  placePortal 消费的正是左上 + 5 的中心语义，同 TrapShot） */
  constructor(x: number, y: number, vx: number, vy: number, form: 0 | 1) {
    super();
    this.x = x - BOLT_W / 2;
    this.y = y - BOLT_H / 2;
    this.vx = vx;
    this.vy = vy;
    this.form = form;
  }

  /** ★通用湿段步进壳（活拍/杀拍双调用点共用;闩=Arrow.ts wetSectionStep 同名配方）。
   *  ★⑧Shimmer() 接面（2026-09-08 残差五件批①）：601 aiStyle1 → 弹反族 A
   *  （P.cs:22606-22625 逐字——深浸判定列=CenterX/16 行=positionY/16 满格微光+上格
   *  微光 → Kill;否则 vy>0 → vy×-1 + timeLeft>600→600 且 −60 + shimmerWet/wet 双清）。
   *  面适配：ai0≡form（601 生成只写 ai[0]=form,:63911）、ai1≡0（601 全链不写 ai[1]
   *  =原版 float 缺省,撞块音门 :18199-18206 读它恒 0 同此）、hostile=false
   *  （SetDefaults :6229 friendly）、timeLeft≡life（本类每 tick 递减模型——弹反
   *  600 钳/−60 减按原值并入该计数器,寿命模型差异=既案登记）、kill=dead 置位
   *  （深浸支 :22608-22610 消亡面）。rainbowSlimeUnlocked 惰性 getter（601 非 936,
   *  支零消费=死码;惰性防测试桩 world 无 flags 炸——Arrow 同式）。 */
  private wetSectionRan = false;

  private wetSectionStep(game: GameHooks): void {
    if (this.wetSectionRan) return;
    this.wetSectionRan = true;
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      601, !!projectileData(601)?.ignoreWater, {
        shimmer: (st, x, y, _w, _h) => {
          const sf: ProjShimmerFace = {
            projId: 601,
            aiStyle: projectileData(601)?.aiStyle ?? -1,
            hostile: false,
            vx: this.vx, vy: this.vy,
            timeLeft: this.life,
            ai0: this.form, ai1: 0,
            wet: this.wet, shimmerWet: this.shimmerWet,
            get rainbowSlimeUnlocked() {
              return (game.world as unknown as { flags?: Record<string, boolean> })
                .flags?.['unlockedSlimeRainbowSpawn'] === true;
            },
            kill: () => { this.dead = true; },
          };
          projShimmerStep(sf, st, x, y, this.cx);
          this.vx = sf.vx; this.vy = sf.vy;
          this.life = sf.timeLeft;
          this.wet = sf.wet; this.shimmerWet = sf.shimmerWet;
        },
      });
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    this.wetSectionRan = false;                     // 杀拍闩复位（杀拍位先于全部子步）
    if (--this.life <= 0) {
      // ★寿命头杀拍湿段补跑（2026-09-08 残差五件批②）：原版 timeLeft--/Kill 在子步环
      //  【尾】（Update :17307-17311）,本子步湿段（:16895,无 active 门）照跑——本仓
      //  头杀早退曾整体跳过=杀拍溅花/旗面缺口。采样盒=本子步 AI 直写位（AI_001 601
      //  零位写 → =头顶位）;死拍位移仍跳过（Arrow 同案:Kill 尘已结死,零观感登记）。
      this.wetSectionStep(game);
      this.dead = true;
      return;
    }
    const [pr, pg, pb] = portalColor(this.form);
    const trailColor = this.form === 0 ? '#FFAA28' : '#3CE0FF'; // 与 TrapShot 拖尾同色表（门色近似）
    let updates = EXTRA_UPDATES;                                  // :15331 numUpdates = extraUpdates
    while (updates >= 0 && !this.dead) {
      this.wetSectionRan = false;                                 // 逐子步闩复位（Arrow subStep 同式）
      updates--;                                                  // :15332-15334
      // ---- AI（:51174-51228，每子步一次）----
      // :51176-51179 门色×0.5 点光（center + velocity×3）
      game.addLightAt?.(this.cx + this.vx * 3, this.cy + this.vy * 3,
        (pr * 0.5) / 255, (pg * 0.5) / 255, (pb * 0.5) / 255);
      if (this.alpha > 0 && this.alpha <= 15) {                   // :51180-51203：4 尘(264) + 音
        // 尘速 = velocity×2 + RandomVector2(-1,1) → 定向爆发近似（speed 6 ± 散布）
        game.spawnBurst?.(this.cx, this.cy, trailColor, 4, 6,
          Math.atan2(this.vy, this.vx), 0.35, { life: 14, damp: 0.94 });
        // :51195-51202 按 ai[0] 选音（form 1 → Item_114 蓝 / form 0 → Item_115 橙）
        game.playSfx(this.form === 0 ? 'portalOrange' : 'portalBlue', 1, this.x, this.y);
      }
      this.alpha -= 15;                                           // :51204-51208
      if (this.alpha < 0) this.alpha = 0;
      if (++this.frameCounter >= 4) {                             // :51209-51214
        this.frameCounter = 0;
        this.frame = (this.frame + 1) % 2;
      }
      // :51217-51227 alpha==0 期拖尾尘（263，velocity/4，每子步 1 粒）——
      // 本仓粒子池上限 600（Game.spawnParticles），按 TrapShot 同款惯例折半（每 2 子步 1 粒）
      if (this.alpha === 0 && (updates & 1) === 0) {
        game.spawnBurst?.(this.cx, this.cy, trailColor, 1, 0.75,
          Math.atan2(this.vy, this.vx), 0.1, { life: 10, damp: 0.94 });
      }
      // ---- ★通用湿段（:16895-17113 共享体,子步环内 AI 后/位移前——域/位序注见字段块;
      //      经 wetSectionStep 壳=活拍①,杀拍②在 fixedUpdate 头）----
      this.wetSectionStep(game);
      // ---- 移动 + 撞块（Update 主体序：AI 后 position += velocity，再碰撞响应）----
      // 水中位移阻尼（HandleMovement :17721-17764 湿支,tileCollide=true 消费）——
      // 只乘进当子步位移行,速度场 vx/vy 不减（lastVelocity :17696 系语义保真;1456 :16676）
      const df = projWaterDragFactor(this);
      const lvx = this.vx;
      const lvy = this.vy;
      this.x += this.vx * df;
      this.y += this.vy * df;
      const tx = Math.floor(this.cx / TILE);
      const ty = Math.floor(this.cy / TILE);
      if (!game.world.store.inBounds(tx, ty)) {
        this.dead = true;                                          // 出界消亡（原版 timeLeft 兜底）
        break;
      }
      if (game.world.store.isSolid(tx, ty)) {
        // :18195-18214 撞块落门（旧注 :16672-16691 系 1456 行号）
        if (this.alpha > 0) {                                      // :18197 音门（alpha>0 才播）
          // :18199-18206 按 ai[1] 选音——601 生成只写 ai0（:63911 尾参），
          // ai[1] 恒 0 → 此分支恒 Item_115（原版实况，非笔误；AI 侧 :51195 才按 form 分音）
          game.playSfx('portalOrange', 1, this.x, this.y);
        }
        game.placePortal?.(this.x, this.y, lvx, lvy, this.form);   // :18208-18211 TryPlacingPortal(this, lastVelocity, velocity)
        this.x += this.vx;                                         // :18212 position += velocity
        this.y += this.vy;
        this.dead = true;                                          // :18213 Kill()
        break;
      }
      // ★BJ704-G2：UpdateTrails 位序（:17198 子步环内位移后一记;cap10×3px/子步=30px 短轨）
      this.recordGhostTrail();
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = r.atlas?.ensureVImage('vanilla/Projectile_601.png');
    const [pr, pg, pb] = portalColor(this.form);
    // ---- ★BJ704-G2（债① 601 员）：通用残影（P(1,8,1,0.3),先于本体）。色=
    //      GetAlpha :80870-80873 整支替换 PortalHelper.GetPortalColor(owner,ai[0])
    //  （PortalHelper.cs:380-394——单机门色 hsl(0.12/0.52)、A=66）→ tintOverride
    //  门色+aMul 66/255（调用位持 form 单源直取）;帧锚=当前帧行（2 帧循环）。
    //  本体姿态勘误（同刀）：270 族分派 :58579-58589 `spriteDirection=direction;
    //  rotation = direction<0 ? atan2(−vy,−vx) : atan2(vy,vx)`——旧「速度角 rotOff 0
    //  TrapShot 同款」缺左飞 +π 与镜像（601 贴图 79-93% 非对称,D2 像素普查）。 ----
    const mvAng = Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0);
    if (img && (img.width > 0) && this.ghostRing.filled > 0) {
      drawProjGhosts(ctx, {
        ring: this.ghostRing,
        id: 601,
        tex: img,
        frames: 2,
        frame: this.frame,
        bodyW: this.w, bodyH: this.h,
        bodyRot: mvAng,
        bodyScale: 1,
        bodyAlpha: 1,
        ai0: 0, ai1: 0,
        timeLeft: this.life,
        opacity: 1,
        vxLen: Math.hypot(this.vx, this.vy),
        spriteDirection: this.vx < 0 ? -1 : 1,
        mirror: this.vx < 0,
        tintOverride: { rgb: [pr, pg, pb], aMul: 66 / 255 },   // GetAlpha 门色 A=66
      });
    }
    ctx.save();
    ctx.translate(this.cx, this.cy);
    // 270 族（:58579-58589）：direction<0 → atan2(−vy,−vx)≡速度角+π,spriteDirection=direction 镜像
    ctx.rotate(mvAng);
    if (this.vx < 0) ctx.scale(-1, 1);
    // ★BJ704-G10（件10,G2 登记债清偿）：本体 A 面=GetAlpha :80870-80873 整支替换
    //  PortalHelper.GetPortalColor（PortalHelper.cs:380-394——单机门色 hsl(0.12/0.52)
    //  【A=66 恒】）→ ga=66/255 常量。旧 `1−α/255` 淡入系误读（α 场仍由 AI 维护
    //  :51204-51208——尘爆发窗/撞块音门行为面消费,视觉面零参与;ghost 侧 tintOverride
    //  aMul=66/255 G2 已落同源）。α=255 出膛拍旧 ga=0 隐形 vs 原版恒 26% 可见。
    ctx.globalAlpha = 66 / 255;
    if (img && (img.width > 0) && img.width > 0) {
      // GetAlpha（:76199-76202）：601 整体贴图染门色——multiply + destination-in 保形
      const f = PortalGunBolt.tintedFrame(img, this.frame, pr, pg, pb);
      ctx.drawImage(f, -10, -10);
    } else {
      // 贴图未就绪回退：门色速度向短线（TrapShot 同款兜底形态）
      ctx.strokeStyle = `rgb(${pr},${pg},${pb})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-this.vx * 2, -this.vy * 2);
      ctx.lineTo(0, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 帧染门色缓存（20×19 帧 × 2 帧 × 2 色；手法同 Portal.tintedFrame） */
  private static tintedFrame(tex: ImageBitmap | HTMLImageElement, frame: number, r: number, g: number, b: number): HTMLCanvasElement {
    const key = `${texId(tex)}|${frame}|${r},${g},${b}`;
    const hit = PortalGunBolt.frameCache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = 20;
    c.height = 19;
    const cx = c.getContext('2d')!;
    cx.drawImage(tex, 0, frame * 19, 20, 19, 0, 0, 20, 19);
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = `rgb(${r},${g},${b})`;
    cx.fillRect(0, 0, 20, 19);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(tex, 0, frame * 19, 20, 19, 0, 0, 20, 19);
    PortalGunBolt.frameCache.set(key, c);
    return c;
  }
}

/** 物品 3384 使用入口（Game.updateUse 接线用）：
 *  form = 0 左键（橙门）/ 1 右键（蓝门）——altFunctionUse 语义见 Player.cs:48055。
 *  aimAngle = 屏幕中心→鼠标的瞄准角（Game 侧 atan2(mouseY-canvasH/2, mouseX-canvasW/2) 同款）。
 *  弹速链 1:1：方向 = aimAngle（:63887-63897 按鼠标重瞄准），单子步速 3（:63904 num49=3f），
 *  extraUpdates 30 → PortalGunBolt 内部自跑 31 子步。返回弹体（调用方入 'projectiles' 桶） */
export function firePortalGun(
  player: { cx: number; cy: number },
  aimAngle: number,
  form: 0 | 1,
): PortalGunBolt {
  const mx = player.cx + Math.cos(aimAngle) * 14;   // 出膛位（Game 枪族同款 14px 前置）
  const my = player.cy - 4 + Math.sin(aimAngle) * 14;
  let vx = Math.cos(aimAngle) * BOLT_SPEED;          // :63906-63910 normalize(瞄准)×3
  let vy = Math.sin(aimAngle) * BOLT_SPEED;
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
    vx = 0;                                          // :63907-63910 NaN → -UnitY
    vy = -BOLT_SPEED;
  }
  const bolt = new PortalGunBolt(mx, my, vx, vy, form);
  return bolt;
}
