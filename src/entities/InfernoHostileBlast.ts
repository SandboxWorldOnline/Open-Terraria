// 292 InfernoHostileBlast（地狱火叉爆区，敌侧；原版权威 Projectile.cs 1457）：
//   SetDefaults :3817-3826 —— 130×130、aiStyle50、hostile、magic、alpha=255、
//   tileCollide=false、penetrate=-1（无 timeLeft 行 → 默认 3600，AI 侧先杀）。
//   AI（aiStyle50 通用支 :28782-28823，type 291/295 早退后的落地段）：
//     · localAI[0]==0 → SoundID.Item74 一次 + localAI[0]++（:28782-28786）
//     · ai[0]++ 每拍（:28787；type296 的 +3 加成与 ×0.7 尘量折减对本型不适用）
//     · num361=25；`if (ai[0] > 540) num361 -= (ai[0]-180)/2`（:28792-28796）——
//       ai[0]=541 时 25-180.5<0 → Kill（:28797-28800）。故存续 = 541 拍 ≈9.0s
//       （原式 540/180 两常数不对称是原版本相，非笔误——按 1457 字节码逐行承载）
//     · 每拍 25×d174 火焰柱（:28806-28823）：方向 Next(-10,11)² + 步幅 Next(3,9)
//       归一外发、出生位 = Center+Next(-10,11)²、scale1.5、noGravity、alpha100
//   接触伤害：hostile 盒对玩家 Damage_EVP 常规链（player.immune 门内每拍重判，
//   穿透不消耗=持续灼烧区）；On Fire(24) 60×Next(8,16) 由 statusPlayer 表
//   （vanilla-statusplayer.json 292 键 ← Projectile.cs:12337-12340）承载。
//   Kill：无专属段（全 Kill 检索无 type==292 分支）→ 静默消亡。
// 生成源：291 InfernoHostileBolt Kill 原位 spawn（Projectile.cs:75802-75807，
//   同 damage/kb）→ 本类由 Dart.inferno291Kill 构造入 'projectiles' 桶。
import { Entity } from './Entity';
import { hitPlayer, statusPlayer } from './projTargets';
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';

/** 292 存续拍数：ai[0] 首个 >540 的值 = 541（:28793 门 + :28787 先增后判） */
export const INFERNO_BLAST_LIFETIME = 541;

export class InfernoHostileBlast extends Entity {
  w = 130; h = 130;                        // SetDefaults :3819-3820
  vx = 0; vy = 0;                          // NewProjectile 速度 (0,0)（:75806）
  damage: number;
  hostile = true;                          // SetDefaults :3822（伤玩家）
  /** ★BJ720-A（issue #19 B01，2026-10-25）：继承自父弹 291 的发射者旗（原版 291 Kill
   *  → NewProjectile(GetProjectileSource_FromThis()=EntitySource_Parent(291 弹), P.cs
   *  :75802-75807) → FindBannerToAssociateTo :11108-11113 `Entity is Projectile →
   *  bannerIdToRespondTo = projectile.bannerIdToRespondTo`——派生弹继承父弹旗，链回
   *  285/286 Diabolist（banner 105））。Dart.inferno291Kill/destroy 两生成口透传；
   *  hitPlayer 消费（applyBannerDamageReceivedOnProj 单源）。 */
  bannerNpcId: number | null = null;
  dead = false;
  /** ai[0] 年龄（:28787 每拍 +1；>540 → num361≤0 → Kill） */
  age = 0;
  /** localAI[0] 单次音门（Item74 :28782-28786） */
  private sounded = false;

  // ★刻意不设 projId 字段：联机快照收集器按 `projId !== undefined` 归 kind1（武器族
  //  弹幕）→ 访客端会重建成回旋镖伪弹；无 projId → kind<0 → 不同步（渲染缺类），
  //  与"未知弹幕类不同步"通道一致（Game.broadcast/快照双面）。292 的生成权分流：
  //  房主/单机 = Dart.inferno291Kill（291 Kill 链内）；访客 = Dart.destroy 傀儡消亡口
  //  镜像重建本地 292（2026-09-02 访客缺口清偿,旧"访客缺口登记"就此撤销）——本类
  //  维持不上线、各端本地自算（hostile 盒对本地玩家 Damage_EVP,victim-settles 同构）；
  //  下方 netPuppet 早退保留为防御位（镜像本体永不入快照,该分支实际不可达）。
  // ★BJ294（2026-09-23）：借位 `minion = true` 退役（其注「若未来收口补 friendly 门
  //  可摘除」的兑现）——BJ293 中央收口已补 vanilla friendly 投影门,但 vid=0（本类
  //  刻意不设 projId,见上注）分支缺省照报,292 仍会越权上报;现按 BJ294 敌射侧
  //  正一位收口：292 SetDefaults hostile（P.cs:3822）→ 原版 CutTiles 调用点
  //  `friendly && owner==myPlayer…`（:12515）整支不进 → noVanillaCut=true 拒割。
  //  minion 旗摘除经核零消费面（召唤计数按类 instanceof;projTargets.ts:988 门
  //  对本敌射弹不在路径）。
  noVanillaCut = true;

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段,projWetSection.ts 共享体
  //  1:1;溅花尘/音由共享体 wetSplashStepShared 承载,本类不自写）----
  //  豁免核对：292 InfernoHostileBlast SetDefaults P.cs:3817-3827（130×130/aiStyle 50/
  //  hostile/alpha 255/magic/tileCollide=false【:3825】/penetrate −1）【无】ignoreWater
  //  行 → 受段（数据面 PROJ_IGNORE_WATER 亦无 292;地狱火叉玩家侧 296 同参数但非本
  //  类域）。292 ∉ IsDestroyedByWater 六型、非 2/34/80/155 → 各特支钩缺省。
  //  阻尼不适用（原版形态锚）：tileCollide=false【:3825】→ HandleMovement 湿阻尼支
  //  :17721-17764 整支不进（wet 位移本应走 :16870 AI 前快照 quirk）;且本弹 NewProjectile
  //  (0,0) 速（:75806）、AI_050 不改速 → 快照恒 (0,0),UpdatePosition :20557-20562
  //  两支位移均为 0,阻尼无消费位（出生即钉死原位爆区）。湿段只承载溅花/湿旗面——
  //  岩浆/水漫入爆区盒时首拍各溅一次。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(cx: number, cy: number, damage: number) {
    super();
    this.x = cx - this.w / 2;              // Center 锚定（:75806 传 Center.X/Y）
    this.y = cy - this.h / 2;
    this.damage = damage;                  // 291 原 damage 直传（:75806）
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }   // 傀儡不本地模拟（未同步面）
    // Item74 单次（:28782-28786）
    if (!this.sounded) {
      this.sounded = true;
      game.playSfxFiles?.(['Item_74'], 1, this.cx, this.cy);
    }
    this.age++;                                             // ai[0]++（:28787）
    if (this.age >= INFERNO_BLAST_LIFETIME) {
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 aiStyle50 寿限 Kill（:28793-28801
      //  `if (num361 <= 0f) { num361 = 0f; Kill(); }`）【不 return】——尘柱循环以
      //  num361=0 自然空转（本仓早退跳过尘柱同态）,Update 湿段(:16895)无 active 门
      //  照跑（`!active` 门 :17132 只拦 Damage/尾尘）→ 杀拍溅花照走。本仓杀位曾
      //  跳过湿段;现补跑,测位=存储位（aiStyle50 不写 position,原版死拍湿段同位,
      //  逐值等价）。杀支与 AI 尾活拍调用点同拍互斥（早退）→ 无需 wetSectionRan 旗;
      //  292 ∉ IsDestroyedByWater 六型/非 80 → 段内无补 Kill 面。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        292, !!projectileData(292)?.ignoreWater);
      this.dead = true;
      return;
    }
    // ---- 25×d174 火焰柱（:28806-28823）----
    //  原式：NewDust(盒,174,0,0,100,default,1.5) 后逐尘覆写 position=Center+Next(-10,11)
    //  与 velocity=归一向——本仓 spawnDust 同式出生后覆写（掠过 NewDust 随机 ±2 掺速）
    const cx = this.cx, cy = this.cy;
    for (let i = 0; i < 25; i++) {
      let dx = Math.floor(Math.random() * 21) - 10;         // Next(-10,11)
      let dy = Math.floor(Math.random() * 21) - 10;
      const spd = 3 + Math.floor(Math.random() * 6);        // Next(3,9)=3..8
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= 0) continue;                               // 双零掷=原版 NaN 尘（1/441）→ 跳过登记
      const k = spd / len;
      dx *= k; dy *= k;
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 174, 0, 0, 100, null, 1.5, true);
      if (d) {
        d.x = cx + Math.floor(Math.random() * 21) - 10;     // 出生位独立双掷（:28817-28820）
        d.y = cy + Math.floor(Math.random() * 21) - 10;
        d.vx = dx; d.vy = dy;                               // velocity 直写（:28821-28822）
      }
    }
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI（aiStyle50 落地段音/ai0++/尘柱完）→ 本段 → HandleMovement
    // （零速无位移面）→ Damage。溅花尘/音由共享体调 wetSplashStepShared,本类不自写。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      292, !!projectileData(292)?.ignoreWater);
    // ---- 接触伤害（Damage_EVP 常规链；player.immune 门在 hitPlayer 内，命中不
    //      消耗穿透=灼烧区持续重判）+ On Fire 表（:12337-12340）----
    if (!game.player.dead && hitPlayer(this, game, this.damage)) {
      statusPlayer(game, 292);
    }
  }

  /** 本体恒隐：alpha=255（SetDefaults :3823）→ GetAlpha A=0；贴图 Projectile_292
   *  为官方空桩（68B 全零），可视面全在 d174 尘（fixedUpdate 直生） */
  draw(_r: Renderer, _cam: Camera): void {}
}
