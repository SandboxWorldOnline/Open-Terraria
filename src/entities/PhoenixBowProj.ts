// 幻影凤凰 3854（Phantom Phoenix，DD2 巨龙入侵 T3 最终波奖励弓）三件套移植：
//   · 物品 3854（Item.cs:34049-34070）：useStyle5/useTime=useAnimation=18/shootSpeed20/
//     damage32/kb2/UseSound=Item5/shoot=705/rare5/noMelee/noUseGraphic/ranged/channel/
//     useAmmo=AmmoID.Arrow/autoReuse——数值面在 vanilla-itemcombat.json（提取器已收），
//     use→705 载体出生在 Game 远程分派支（Player.cs:49524-49527 `sItem.type == 3854`
//     专支 NewProjectile(…,705,…)，本体不出普通箭）。
//   · 弹 705 蓄力载体（SetDefaults Projectile.cs:6769-6780：22×22/aiStyle75/penetrate−1/
//     tileCollide false/drawLayer7/usesOwnerLight/ranged/ignoreWater；★无 friendly=
//     不与敌怪做命中结算——纯持械视觉+射击节拍器）。AI_075 type==705 支
//     （Projectile.cs:68287-68400）：ai[0] 计龄、ai[1] 自 itemAnimationMax(18) 递减归零
//     触发拍点 → PickAmmo 射 2 箭（速基 12、±1.5 方块散布、出生点=载体中心、
//     noDropItem）；player.phantomPhoneixCounter（Player.cs:1171，★原版无任何复位点=
//     跨蓄力会话持续）计到 3 的下一拍改射【单发 706 凤凰弹】：伤 ×2 / 速 16 /
//     散布 0 / ai[1]×1.5 拉长节拍；木箭弹型 1 就地换燃烧箭 2（:68330-68332）。
//     拍点 canShoot4 = player.channel && HasAmmo && !noItems && !CCed 不成立 → Kill
//     （:68394-68396）；音节拍器 soundDelay=interval 内 Item_5、首拍 ai[0]==1 豁免
//     （:68299-68306）。AI_075 尾公共段（:68401-68407）：position=RotatedRelativePoint
//     (MountedCenter)−Size/2 跟手、rotation=velocity.ToRotation()+num（spriteDirection
//     ==−1 时 num=π）、timeLeft=2、SetDummyItemTime(2)=手持动画钉满。
//   · 弹 706 凤凰弹（SetDefaults Projectile.cs:7462-7473：66×66/aiStyle1/friendly/
//     alpha255/timeLeft300→NewProjectile :11077-11081 钳 120/ranged/usesLocalNPCImmunity/
//     penetrate−1/localNPCHitCooldown=10；命中盒缩 10×10 GetCollisionParams :20062-20065）：
//     AI_001 type==706 支（:56740-56860）湿灭（:56743-56746）；首拍 localAI[1]==0 播
//     DD2_PhantomPhoenixShot 三变体（SoundID.cs:1014 CreateTrackable("dd2_phantom_
//     phoenix_shot",3)；:56750-56753 PlayTrackedSound——本仓近似为出生点位播）+
//     15 粒尘 6|31 爆（1/4 缺席、v×2.3、fadeIn1.5、noLight）；alpha −55/t 渐显，归零
//     一次性 16 粒尘 6 环爆（:56830-56857）；羽尘双生拖尾（cos 相位绕转 ±velocity 偏移
//     :56786-56824）；frameCounter 40 循环 frame=/5（Main.projFrames[706]=8 Main.cs:8595，
//     贴图 72×608=8 帧×72×76）；光 PlotTileLine CastLightOpen v3_1=(1,0.6,0.2)
//     （:56858-56860 → addLightAt 近似）；移动走 aiStyle1 默认重力支 ai0≥15 后
//     vy+=0.1（:58554-58565），旋转组 270|585|601|706|837 = atan2(vy,vx) 无 π/2 偏移
//     （:58600-58612）；每次命中伤 ×0.95 截断（Damage_PVE_Inner :14275-14278）、
//     OnFire3 480t（StatusNPC :11376-11379 → vanilla-projstatus.json "706" 表驱动）。
import { Entity } from './Entity';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import type { GameHooks } from './types';
import { projSprite, familyBodyStealthDim } from './Arrow';   // ★BJ704-G14 件3：族面减光求值器
import { tintedTex } from '../render/StringLine';   // ★BJ704-G14 件3：本体减光 rgb 烘焙
import { playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { rollVanillaHitCrit } from './proj1457';
// ★BJ704-G2（2026-10-21,债① 706 员）：残影环接线——706 TrailingMode=0/CacheLen 10
//  （ProjectileID.cs:385/:387）,通用表 P(9,0,-2,0.5)（Main.cs:31055-31061）+B,G,A/=i
//  色支（:31273-31278;GetAlpha :80830-80833 afade 面已随本刀入 GHOST_TINT[706]）。
import { ProjGhostRing, drawProjGhosts } from './projGhostTrail';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { applyProjStatus } from './projStatus';
import { soundTrackFiles } from '../data/vanillaNpcs';
import { TILE } from '../core/constants';
// ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-06 武器弹簇接入批）
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { wetCollision } from './npcLiquid';
import { projectileData } from '../data/vanillaProjectiles';
import { PROJ_ALPHA_MOD } from '../data/vanillaProjAlpha';   // ★G21 R7-P2-3：706 afade 档（本体 A 面）
import type { TileStore } from '../world/TileStore';

/** 玩家侧挂点（RotatedRelativePoint(MountedCenter) ≈ 中心；SkyDragonFury.DragonOwner 同口径）
 *  ppPhoenixCounter = Player.phantomPhoneixCounter（Player.cs:1171）宿主字段——挂在玩家
 *  实例上即得原版「跨蓄力会话持续、永不复位」语义 */
export interface PhoenixOwnerLike {
  cx: number; cy: number; facing: number; dead: boolean;
  ppPhoenixCounter?: number;
}

const TAU = Math.PI * 2;
/** 武器 shootSpeed 表值（Item.cs:34052 shootSpeed=20f）——AI_075 重瞄 num75 用 */
const WEAPON_SHOOT_SPEED = 20;

/** 同敌命中冷却（localNPCHitCooldown 通道；调用方每 tick 先递减——SkyDragonFury.HitCd 同构） */
class HitCd {
  private map = new Map<number, number>();
  tick(): void {
    for (const [k, v] of this.map) {
      if (v <= 1) this.map.delete(k); else this.map.set(k, v - 1);
    }
  }
  ready(id: number, cd: number): boolean {
    if (this.map.has(id)) return false;
    this.map.set(id, cd);
    return true;
  }
}

/** 尘 6 火 | 31 烟 随机档（Utils.SelectRandom<int>(Main.rand, 6, 31, 31)：31 权重 ×2） */
function fireOrSmoke(): number {
  return Math.random() < 1 / 3 ? 6 : 31;
}

/** 尘爆粒（NewDustDirect(Center−Size/4, w/2, h/2, type) 后置覆写：v×2.3/fadeIn1.5/
 *  noGravity/noLight——:56755-56761 与 :56786-56792 两处同式） */
function burstDust(game: GameHooks, cx: number, cy: number): void {
  const pool = game.vanillaDust;
  if (!pool) {
    game.spawnParticles(cx, cy, '#E88C3C', 1, 1.2, { life: 14 });
    return;
  }
  const d = pool.spawn(cx - 8, cy - 8, 16, 16, fireOrSmoke(), 0, 0, 150);
  if (!d) return;
  d.vx *= 2.3;
  d.vy *= 2.3;
  d.fadeIn = 1.5;
  d.noGravity = true;
  d.noLight = true;
}

/** alpha 归零一次性环爆（:56836-56856：16 粒尘 6，椭圆 (1,4) 半径按 velocity 向旋开，
 *  scale1.5、v=v*4+vel*0.3） */
function ringBurst(game: GameHooks, cx: number, cy: number, vx: number, vy: number): void {
  const pool = game.vanillaDust;
  if (!pool) {
    game.spawnBurst?.(cx, cy, '#FF9440', 16, 2.4, Math.atan2(vy, vx), Math.PI);
    return;
  }
  const rot = Math.atan2(vy, vx);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i < 16; i++) {
    // spinningpoint9 = -UnitY.RotatedBy(i·2π/16)·(1,4) 再 RotatedBy(velocity 向)
    const a = i * (TAU / 16);
    const ux = Math.sin(a), uy = -Math.cos(a) * 4;
    const d = pool.spawn(cx, cy, 0, 0, 6, 0, 0, 0);
    if (!d) continue;
    d.scale = 1.5;
    d.noLight = true;
    d.noGravity = true;
    d.x = cx + ux * cr - uy * sr;
    d.y = cy + ux * sr + uy * cr;
    d.vx = d.vx * 4 + vx * 0.3;
    d.vy = d.vy * 4 + vy * 0.3;
  }
}

/** 弹药解析返回（Game.phantasmPickAmmo 结果：PickAmmo 终值链 pid/dmg/kb/speed） */
export interface PhoenixVolleyResult { pid: number; dmg: number; kb: number; speed: number }

// ================= 705：蓄力通道载体（aiStyle 75 / AI_075 type==705 支） =================

export class PhoenixChannel extends Entity {
  readonly projId = 705;
  w = 22; h = 22;                                    // SetDefaults :6771-6772
  damage: number;
  knockback: number;
  /** 载体本体不参与命中（SetDefaults 无 friendly）。armorPen 仅供 Game 注入存档；
   *  critChance 注入位已退役（★BJ486②：critTotal 百分点口径写入分数域载体=单位
   *  错位死写,且无读者——凤凰弹掷率在 PhoenixBolt 面走 rollVanillaHitCrit(706)） */
  critChance = 0;
  armorPen = 0;
  dead = false;
  /** ai[0] 计龄（:68292） */
  private age = 0;
  /** ai[1] 拍点倒计时（初值 0 → 首 tick -- 后 ≤0 即发，同原版首拍即射 :68293-68299） */
  private volleyCd = 1;
  /** soundDelay 音节拍器（:68299-68306） */
  private sndCd = 0;
  /** player.itemAnimationMax（=useAnimation 18×词缀 spd，Game 侧换算传入） */
  private readonly interval: number;

  constructor(
    private owner: PhoenixOwnerLike,
    vx: number, vy: number,
    damage: number, knockback: number,
    intervalTicks: number,
    private ctl: {
      /** player.channel && HasAmmo && !noItems && !CCed 门近似（持械中+未死亡） */
      channel(): boolean;
      /** Main.MouseWorld */
      aim(): { x: number; y: number };
      /** PickAmmo 等价（每拍现解析弹药+耗弹；null = 无弹药） */
      volley(): PhoenixVolleyResult | null;
      /** 出膛（706 → PhoenixBolt / 其余 → Arrow；出生点=载体中心、noDropItem） */
      fire(pid: number, x: number, y: number, vx: number, vy: number, dmg: number, kb: number): void;
    },
  ) {
    super();
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.interval = Math.max(1, intervalTicks);
  }

  override fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.age++;                                       // ai[0]++（:68292）

    // ---- 持械跟随（AI_075 尾公共段 :68401 position = RotatedRelativePoint
    //      (MountedCenter) − Size/2 ≈ 玩家中心；本仓先于出膛刷新供出生点取位）----
    this.x = this.owner.cx - this.w / 2;
    this.y = this.owner.cy - this.h / 2;
    // SetDummyItemTime(2)（:68405）= channel 手持动画钉满不脱落（PrismProj 同钩子）
    game.refreshChannelItem?.(Math.atan2(this.vy, this.vx));

    // ---- 拍点判定（ai[1]-- 归零触发 :68293-68299）----
    let fired = false;
    if (--this.volleyCd <= 0) {
      this.volleyCd = this.interval;
      fired = true;
    }
    const canShoot = this.ctl.channel();
    // ---- 音节拍器（:68299-68306，先于出膛）：canShoot 门内 Item_5、首拍豁免 ----
    if (--this.sndCd <= 0) {
      this.sndCd = this.interval;
      if (canShoot && this.age !== 1) {
        game.playSfxFile?.('Item_5', 1, this.cx, this.cy);   // SoundID.Item5（:68303）
      }
    }
    if (!fired) return;

    // ---- 出膛（flag14 && owner 本地 :68314-68396）----
    const res = canShoot ? this.ctl.volley() : null;
    if (!res) { this.dead = true; return; }           // else Kill()（:68394-68396）

    // 重瞄 velocity = 归一(mouse−position)×shootSpeed(20)×scale(1)×0.55
    //（num75=held.shootSpeed×scale :68352-68371；NaN 兜 −UnitY 同款）
    const aim = this.ctl.aim();
    let dx = aim.x - this.cx, dy = aim.y - this.cy;
    const dl = Math.hypot(dx, dy);
    if (dl > 0) { dx /= dl; dy /= dl; } else { dx = 0; dy = -1; }
    this.vx = dx * WEAPON_SHOOT_SPEED * 0.55;
    this.vy = dy * WEAPON_SHOOT_SPEED * 0.55;

    // 木箭 1 → 燃烧箭 2（:68330-68332——凤凰弓自带点火）
    let pid = res.pid === 1 ? 2 : res.pid;
    let shots = 2;                                    // num73=2（:68321）
    let spread = 1.5;                                 // num74=1.5（:68322）
    let dmg = res.dmg;
    let spd = res.speed;
    // 三连计数转凤凰弹（++phantomPhoneixCounter>=3 :68333-68341）：单发/伤×2/
    // 散布 0/ai[1]×1.5/弹 706/速 16
    const ctr = (this.owner.ppPhoenixCounter ?? 0) + 1;
    if (ctr >= 3) {
      this.owner.ppPhoenixCounter = 0;
      shots = 1;
      dmg *= 2;
      spread = 0;
      this.volleyCd *= 1.5;                           // ai[1] × 1.5（浮点节拍拉长）
      pid = 706;
      spd = 16;
    } else {
      this.owner.ppPhoenixCounter = ctr;
    }
    // 出膛（:68372-68389）：速度 = 归一(velocity)×speed + randSquare(±spread)；
    // 出生点 = vector34（载体中心≈玩家挂点）；noDropItem=true（:68371 逐矢原版置位,
    // ★SW-FX9 2026-09-10 勘误:旧"Arrow dropKey=null 承载"注退役=回收链已摘,
    // 原版弓系本就恒消耗）
    const vl = Math.hypot(this.vx, this.vy) || 1;
    for (let i = 0; i < shots; i++) {
      const fx = (this.vx / vl) * spd + (Math.random() * 2 - 1) * spread;
      const fy = (this.vy / vl) * spd + (Math.random() * 2 - 1) * spread;
      this.ctl.fire(pid, this.cx, this.cy, fx, fy, dmg, res.kb);
    }
  }

  override draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(705);
    const ctx = r.ctx;
    if (!img || img.width <= 0 || !ctx) return;
    // ---- ★BJ704-G14（件3 [g11-family-body-stealth-dim]）：705 DD2PhoenixBow 本体
    //      stealth 减光（Main.cs:32623-32640 八型族;3854 手持件 ranged=true 门可达,
    //      705 默认 GetAlpha → RGB×tint + A=255n → ga=n,族面求值器 familyBodyStealthDim
    //      单源——Arrow 630/Celeb2Muzzle 615·714 同源）----
    let src705: ImageBitmap | HTMLImageElement | HTMLCanvasElement = img;
    let ga705 = 1;
    const dim705 = familyBodyStealthDim(this.owner);
    if (dim705) {
      src705 = tintedTex(img, [
        Math.trunc(255 * dim705.rgb[0]), Math.trunc(255 * dim705.rgb[1]), Math.trunc(255 * dim705.rgb[2]),
      ] as [number, number, number], false) ?? img;
      ga705 = dim705.ga;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    // rotation = velocity.ToRotation() + num（spriteDirection==−1 → num=π :68288-68291/
    // :68402-68403）+ FlipHorizontally（spriteDirection 门）——rotate(θ+π)+scale(-1,1)
    ctx.rotate(Math.atan2(this.vy, this.vx));
    if (this.owner.facing < 0) { ctx.rotate(Math.PI); ctx.scale(-1, 1); }
    if (dim705) ctx.globalAlpha = ga705;
    ctx.drawImage(src705 as CanvasImageSource, -img.width / 2, -img.height / 2);
    ctx.restore();
  }
}

// ================= 706：凤凰弹（aiStyle 1 / AI_001 type==706 支） =================

type EnemyLike = {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  hurt: (dmg: number, kbx: number, kby: number, game: GameHooks,
    armorPen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
};

interface SolidProbe {
  inBounds(x: number, y: number): boolean;
  get(x: number, y: number): number;
  isSolid(x: number, y: number): boolean;
}

export class PhoenixBolt extends Entity {
  readonly projId = 706;
  /** SetDefaults 视觉盒（贴图按帧原尺寸绘制，盒值仅作锚 :7464-7465） */
  static readonly DRAW_SIZE = 66;
  /** 命中盒 = 66 盒经 GetCollisionParams 缩 10×10（:20062-20065） */
  w = 10; h = 10;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  /** alpha=255 出生渐显（SetDefaults :7467 + AI −55/t :56830） */
  private alphaI = 255;
  private frameCtr = 0;
  private frame = 0;
  /** timeLeft：表值 300 被 NewProjectile 覆盖钳 120（:11077-11081） */
  private life = 120;
  /** ai[0] 重力计时（默认支 ai0≥15 后 vy+=0.1 :58554-58565） */
  private gravT = 0;
  /** localAI[1]==0 首拍音门（:56748） */
  private playedSnd = false;
  /** usesLocalNPCImmunity + localNPCHitCooldown=10（:7471-7472） */
  private hitCd = new HitCd();
  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-06 武器弹簇批）----
  //  706 SetDefaults（:7463-7475）【无】ignoreWater 行 = 受段（豁免对照：载体 705
  //  block :6769-6781 `type == 630 || type == 705` ignoreWater=true :6781 = 不受段）。
  //  段位序 = AI(:16880) → 湿段(:16895) → HandleMovement(:17120)。AI_001 706 支湿灭
  //  （:56743-56746 `if (wet) { Kill(); return; }`）消费【上拍】湿段终值旗 → 出生预置
  //  （NewProjectile :10886-10892）必须先于首拍 AI（spawnPresetWet,BallProjs/ChumBucket
  //  同约定）;旧"弹心单格 liquid"近似退役（wet=盒级 WetCollision 静态旗）。湿段无
  //  active 门 → 湿灭拍仍跑旗/溅花;HandleMovement 亦跑（tileCollide 缺省 true → 水中
  //  位移阻尼 ×0.5/蜂蜜 0.25/微光 0.375 :17721-17764 速度场不减只削位移）,`!active`
  //  早退 :17157 才断尾段/寿命/命中。706 不在 IsDestroyedByWater 六型 → 无 kill 钩。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  // ---- ★BJ704-G2（债① 706 员）：oldPos 残影环（mode0;706 无 extraUpdates →
  //      每拍一记,UpdateTrails :17198 位移后位序;MinionProj 755 接线式同构）。 ----
  private ghostRing = new ProjGhostRing(706);
  private recordGhostTrail(): void {
    this.ghostRing.record(this.x, this.y, 0, 1, true);   // mode0 只记 oldPos
  }

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
  }

  private die(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h,
      this.vx, this.vy, this.damage, {});
  }

  /** NewProjectile 出生预置（Projectile.cs:10886-10892 逐值 1:1）：出生盒 WetCollision
   *  首测 + honey/shimmer 静态旗;时点 = 首拍 AI【前】（AI_001 706 支 :56743 首拍即消费
   *  wet 旗——出生入水当拍即灭）;出生位 = 构造位（首拍位移前同位 ✔）。 */
  private spawnPresetWet(st: TileStore): void {
    if (this.presetDone) return;
    this.presetDone = true;
    const r = wetCollision(st, this.x, this.y, this.w, this.h);
    this.wet = !!projectileData(this.projId)?.ignoreWater ? false : r.wet;   // :10887-10890
    this.honeyWet = r.honey;                                                 // :10891
    this.shimmerWet = r.shimmer;                                             // :10892
  }

  override fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.spawnPresetWet(game.world.store);

    // ---- 湿灭（AI_001 706 支 :56743-56746 `if (wet) { Kill(); return; }`）：wet =
    //      【上拍】湿段终值/出生预置旗（盒级 Collision.WetCollision :1575-1652 对任意
    //      液体返回 true——水/岩浆/蜂蜜/微光全档,无 469 式豁免）。AI 即返 → 首拍音尘/
    //      重力/尾迹本拍全跳;湿段与 HandleMovement 无 active 门仍跑（下两段）。
    //      ★2026-09-06 湿段批：旧"弹心单格 liquid"近似退役 ----
    if (this.wet) this.die(game);
    else {
      // ---- 首拍音 + 尘爆（localAI[1]==0 :56748-56763）----
      if (!this.playedSnd) {
        this.playedSnd = true;
        // SoundEngine.PlayTrackedSound(SoundID.DD2_PhantomPhoenixShot, Center)——3 变体
        // 随机组（SoundID.cs:1014 CreateTrackable(...,3)）；跟踪位播近似为出生点位播
        game.playSfxFiles(soundTrackFiles('dd2_phantom_phoenix_shot'), 1, this.cx, this.cy);
        for (let i = 0; i < 15; i++) {
          if (Math.floor(Math.random() * 4) !== 0) {       // Main.rand.Next(4) != 0
            burstDust(game, this.cx, this.cy);
          }
        }
      }

      // ---- 默认重力支（aiStyle1 兜底 :58554-58565）ai0≥15 后 vy+=0.1 ----
      if (++this.gravT >= 15) this.vy += 0.1;
    }

    // ---- ★通用湿段（:16903-17113）——AI 后/位移前 = 原版 Update 同序;段无 active 门
    // （湿灭拍仍跑旗/溅花;706 非 waterdeath 型 → 无 kill 钩）。溅花尘/音由共享体
    // wetSplashStepShared 承载,不自写 ----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);

    // ---- 移动：水中位移阻尼（HandleMovement :17721-17764 wetVelocity=velocity×档,
    //      速度场不减只削位移;干态档=1 恒等）;子步推进防 16px/t 穿墙（撞实心块亡 =
    //      aiStyle1 tileCollide 默认真）。★移动无 active 门——AI 湿灭（:56745 Kill）
    //      拍仍走满两半步（原版 HandleMovement 在 AI Kill 后照跑,!active 早退在其后
    //      :17157）,hitsSolid 判亡只在未死时受理（die 幂等）----
    {
      const drag = projWaterDragFactor(this);
      const st = game.world.store as unknown as SolidProbe;
      for (let s = 0; s < 2; s++) {
        this.x += this.vx / 2 * drag;
        this.y += this.vy / 2 * drag;
        if (!this.dead && PhoenixBolt.hitsSolid(st, this.x, this.y, this.w, this.h)) {
          this.die(game);
          break;
        }
      }
    }
    if (this.dead) return;   // !active 早退（:17157）——尾段/寿命/命中不跑（原版同构）
    // ★BJ704-G2：UpdateTrails 位序（:17198 位移后一记;命中环在记录后=位置无涉等价）
    this.recordGhostTrail();

    // ---- alpha<=0 段尾迹（:56779-56824）：2 粒烟|火（1/4 缺席）+ 羽尘双生 ----
    if (this.alphaI <= 0) {
      for (let i = 0; i < 2; i++) {
        if (Math.floor(Math.random() * 4) !== 0) burstDust(game, this.cx, this.cy);
      }
      const vl = Math.hypot(this.vx, this.vy);
      const nx = vl > 0 ? this.vx / vl : 0;
      const ny = vl > 0 ? this.vy / vl : 0;
      // spinningpoint8 = (0, cos(frameCtr·2π/40 − π/2))·16 RotatedBy(rotation)（:56790-56792）
      const rot = Math.atan2(this.vy, this.vx);
      const ph = Math.cos(this.frameCtr * (TAU / 40) - Math.PI / 2) * 16;
      const ox = -Math.sin(rot) * ph, oy = Math.cos(rot) * ph;
      const pool = game.vanillaDust;
      if (pool) {
        for (const velK of [1.2, 1.7]) {               // dust11 += v*1.2 / dust12 += v*0.5+1.2
          const d = pool.spawn(this.cx - 6, this.cy - 6, 12, 12, 6, 0, 0, 150);
          if (!d) break;
          d.noGravity = true;
          d.fadeIn = 1.4;
          d.scale = 1.15;
          d.noLight = true;
          d.x = this.cx + ox + this.vx * velK;         // position = Center+spin8 += velocity×k
          d.y = this.cy + oy + this.vy * velK;
          d.vx = nx * 2;                               // velocity *= 0 后 += normalize(velocity)*2
          d.vy = ny * 2;
        }
      }
    }

    // ---- 帧动画（:56825-56829）：counter 40 循环、frame = counter/5（8 帧）----
    if (++this.frameCtr >= 40) this.frameCtr = 0;
    this.frame = Math.floor(this.frameCtr / 5);

    // ---- 渐显 + 归零环爆（:56830-56857）----
    if (this.alphaI > 0) {
      this.alphaI -= 55;
      if (this.alphaI < 0) {
        this.alphaI = 0;
        ringBurst(game, this.cx, this.cy, this.vx, this.vy);
      }
    }

    // ---- 光（PlotTileLine CastLightOpen v3_1=(1,0.6,0.2) :56858-56860 → 点光近似）----
    game.addLightAt?.(this.cx, this.cy, 1, 0.6, 0.2);

    // ---- 寿命（timeLeft 120 :11077-11081）----
    if (--this.life <= 0) { this.die(game); return; }

    // ---- 命中（friendly + 10×10 盒 + per-NPC 10t 免疫 :7466-7473）----
    this.hitCd.tick();
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门
      if (e.dead || !this.hitCd.ready(e.id, 10)) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x
        && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ486②普查件（2026-10-03）单位错位修复：旧写位 `bolt.critChance = critTotal`
      //  （Game.ts Phoenix fire 支）喂的是 critTotal 【百分点】口径（rangedCrit 聚合
      //  + bow.crit + ammo.crit + ps.crt,17132 定义）,本面 `random() < critChance`
      //  分数域读 → random()<14 恒真 = 100% 暴击病。改 owner 装配口径（706 ranged 旗,
      //  rollVanillaHitCrit:12915-12927——基 4+rangedCrit 聚合+:25712 持械折入
      //  （命中拍动态;静态冻结载体退役）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = crit ? Math.round(this.damage) * 2 : Math.round(this.damage);
      // ★F3 接线（蓝队四轮）：凤凰弹 706 数据面 ranged（SetDefaults :7462-7473）→
      // 焰爆石/拍击石双支（Projectile.cs:13439-13446）随 Damage() 生效；加伤在 banner
      // 采样外、随暴击并入实伤参（序注见 stats/SnapStrike.ts F1 迁移）
      const snapBonusPhoenix = projectileSnapStrikeBonus(game, this,
        e.x + e.w / 2, e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusPhoenix ? Math.trunc(snapBonusPhoenix * (crit ? 2 : 1)) : 0),
        Math.sign(this.vx) * this.knockback, 0, game, this.armorPen, crit, 0, true);
      // OnFire3 480t（StatusNPC :11376-11379 → vanilla-projstatus.json "706" 表驱动）
      applyProjStatus(this.projId, e as unknown as Record<string, number | undefined>);
      // 每次命中伤 ×0.95 截断（Damage_PVE_Inner :14275-14278——穿透衰减）
      this.damage = Math.trunc(this.damage * 0.95);
    }
  }

  /** 盒 vs 实心块（Collision.TileCollision 近似：盒覆盖格任一实心即撞） */
  private static hitsSolid(
    st: SolidProbe, x: number, y: number, w: number, h: number,
  ): boolean {
    const x0 = Math.floor(x / TILE), y0 = Math.floor(y / TILE);
    const x1 = Math.floor((x + w - 0.001) / TILE);
    const y1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!st.inBounds(tx, ty)) return true;
        if (st.get(tx, ty) !== 0 && st.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  override draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(706);
    const ctx = r.ctx;
    if (!img || img.width <= 0 || !ctx) return;
    // ★BJ704-G21 R7-P2-3（本体 A 面清偿,G2 只修了 ghost 面）：GetAlpha :80830-80833
    //  `673||706 → (255−α,255−α,255−α,180−⌊α/2⌋−⌊α/4⌋)`——A 通道=180−¾α（负值
    //  byte 钳 0,GHOST_TINT[706] 同式）,稳态 α=0 本体 70.6% 背景衰减;旧 ga=
    //  (255−α)/255 只折 RGB 面=衰减 100%（本体比原版实 ~30%,全程非仅淡入）。
    //  消费 vanillaProjAlpha[706] afade 档（rgba.a=180/slope=0.75/inv=1——旧为
    //  死条目:afade 消费者=Arrow.drawTableAlpha,自绘类不查表）×inv 折面=RGB
    //  (255−α)/255 与 A 双重衰减（表约定「RGB 乘子统一折进 globalAlpha」）。
    //  charm 分流（aiStyle1 ∧ PhoenixQuivered :80605-80611 White×Opacity）对 706
    //  不可达——HarpyCharmEffect 只选中 arrow 弹（Player.cs:28683 projectile.arrow）,
    //  706 SetDefaults 无 arrow 行（:7464-7475）。
    const op = (255 - this.alphaI) / 255;                // RGB 面 (255−α)/255（ghost opacity 同源）
    if (op <= 0.02) return;
    const mod706 = PROJ_ALPHA_MOD[706]!;
    const gaBody = Math.max(0, ((mod706.rgba?.[3] ?? 255) - this.alphaI * (mod706.slope ?? 1)) / 255) * op;
    const frames = 8;                                   // Main.projFrames[706]=8（Main.cs:8595）
    const fh = img.height / frames;
    // ---- ★BJ704-G2（债① 706 员）：通用残影（P(9,0,-2,0.5),先于本体）。色=
    //      GHOST_TINT[706]（GetAlpha aface (255−α,·,·,180−¾α)+B,G,A/=i 全式）;
    //      bodyW/H=SetDefaults 盒 66（绘制盒与命中盒 10×10 解耦,ghost 锚=Size/2）;
    //      帧锚=当前帧行（8 帧循环）。 ----
    if (this.ghostRing.filled > 0) {
      drawProjGhosts(ctx, {
        ring: this.ghostRing,
        id: 706,
        tex: img,
        frames,
        frame: this.frame,
        bodyW: PhoenixBolt.DRAW_SIZE, bodyH: PhoenixBolt.DRAW_SIZE,
        bodyRot: Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0),
        bodyScale: 1,
        bodyAlpha: 1,          // GetAlpha 面全式在 GHOST_TINT[706]（opacity 消费）
        ai0: 0, ai1: 0,
        timeLeft: this.life,
        opacity: op,
        vxLen: Math.hypot(this.vx, this.vy),
        spriteDirection: this.vx < 0 ? -1 : 1,
        mirror: this.vx < 0,
      });
    }
    ctx.save();
    ctx.globalAlpha = gaBody;   // R7-P2-3：afade 折面（A=180−¾α × inv (255−α)/255）
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    // 旋转组 270|585|601|706|837（:58579-58589）：spriteDirection=direction;
    //  rotation = direction<0 ? atan2(−vy,−vx) : atan2(vy,vx) ≡ 速度角+（vx<0?π:0）
    //  +spriteDirection 镜像。★BJ704-G2 勘误：旧式缺左飞 +π（镜像后 180° 横转=
    //  倒置凤凰,706 贴图 78-92% 非对称 D2 普查可见）。
    ctx.rotate(Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0));
    if ((Math.sign(this.vx) || 1) < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, 0, this.frame * fh, img.width, fh,
      -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
