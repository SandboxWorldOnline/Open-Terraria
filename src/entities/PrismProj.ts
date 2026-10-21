// 最后的棱镜（Last Prism 3541）弹链 1:1：
//   633 棱镜晶体（SetDefaults :6514）：14×18 aiStyle75 drawLayer7 magic，channel 主控。
//     AI_075（633 块 :63626-63717 [1456] = :67585-67683 [1457]）：ai[0]=charge
//     （魔耗节奏 30→90t 后 15→120t 后 5，:63628-63636 [1456] = :67587-67595 [1457]）；
//     damage=(int)(手持物 damage×player.magicDamage) 每拍刷新（:63630 [1456] =
//     :67596 [1457]；632 光棱 damage=projectile3.damage 逐拍同步 :30375）；
//     ai[1] 每 tick 置 0：aim=鼠标向 lerp(prev,0.92) 平滑 ×shootSpeed(30)；
//     晶体帧速 num40=ai0<120?4:1（:63686-63694 [1456] = :67637-67645 [1457]）；
//     充能音 Item15 每 20t 循环、首拍不播（:63693-63700 [1456] = :67647-67655 [1457]，
//     UseSound=null 故为 channel 期唯一音源）；
//     channel&&mana&&!noItems&&!CCed 存活（:63700-63717 [1456] = :67656-67682 [1457]），
//     charge==1 时生成 6×632 光棱（:63702-63710 [1456] = :67662-67673 [1457]）；
//     断 channel → Kill。
//   632 光棱（SetDefaults :6525）：18×18 aiStyle84 alpha255 tileCollide=false。
//     AI_084（:30326-30382）：charge 三段展开——<120t 散 20−4×(t/120)、透明
//     t/120×0.4；120-180t 散 16−10×((t−120)/60)、透明 0.4→1；≥180t 散 1.75
//     【伤害 ×3】；光棱绕 aim 旋转分布（UnitY.RotatedBy(orbit)×(4,num725)）；
//     friendly 门 charge>30t（前 0.5s 不伤敌）。
//     激光长度 = LaserScan 沿向 2400 截实心（:30498，localAI[1] Lerp 0.75 平滑）；
//     命中 = 线碰撞盒 厚 22×scale（:14669-14677）+ 同敌 5t 免疫（:13032）。
//     绘制（Main.cs:32018-32040）：Utils.DrawLaser×2（hue 色 0.75 透明 + 内白
//     半宽）；hue = GetLastPrismHue 默认 laserIndex/6（彩虹，:20692——玩家名
//     彩蛋分支不移植）。
import { Entity } from './Entity';
import { TILE } from '../core/constants';
import type { GameHooks } from './types';
import { projSprite, Arrow } from './Arrow';
import { playerCanHitEnemy, applyBannerDamageDealt, hitCrittersAll, noteVanillaProjImmune } from './projTargets';
import { tintedTex } from '../render/StringLine';
// ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-06 武器弹簇接入批）
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { ghostHealProc, ghostHurtOnHit, playerHasGhostHurt, snapshotVanillaGate, vanillaGateRejected } from './SpectreSoulProj';   // ★BJ382 光棱 632/光束 461 proc 单源（★清偿刀 T 门位快照单源;★BJ424-T3 补 ghostHurt 漏斗面）
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424-T3 星云套装 on-hit 单源（自持命中环面收编）
import { rollVanillaHitCrit } from './proj1457';   // ★BJ489 def-3 掷率单源（函数声明环=运行时调用安全）
import { runModModifyHitNpcByProj } from '../mods/hooks';   // ★D2:独立结算面补钩

// ---- ★通用湿段定谳（2026-09-06 武器弹簇批;SetDefaults P.cs 699-10676 逐块）----
//  受段：632 PrismProng（block :6807-6817 无 ignoreWater行）/ 461 BlasterBeam
//  （block :5319-5330 无 ignoreWater 行）——两者皆 aiStyle 84 锚定束：位置每拍自
//  父晶体锚直写（AI 直写位）+ tileCollide=false（:6816/:5328 → HandleMovement
//  :17581 阻尼块整跳）+ aiStyle 84 在 UpdatePosition :20549 早退表内 → 湿段只吃
//  旗/溅花,阻尼 N/A 留锚禁硬安。湿段插 AI 尾/命中环前 = 原版 AI(:16880)→湿段
//  (:16895)→Damage(:17184) 同序。
//  豁免：633 棱镜晶体（block :6795-6806 ignoreWater=true :6805）/ 460 充能晶体
//  （block :5306-5318 ignoreWater=true :5317）/ 459 小弹（block :5294-5305
//  ignoreWater=true :5303）——SetDefaults 显式 ignoreWater,湿段不跑。

/** hslToRgb（原版 Main.hslToRgb 近似——S=1 L=0.5 时的纯色环） */
function hueToRgb(h: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const c = 1, x = c * (1 - Math.abs((h * 6) % 2 - 1));
  let r = 0, g = 0, b = 0;
  const seg = Math.floor(h * 6);
  if (seg === 0) { r = c; g = x; } else if (seg === 1) { r = x; g = c; }
  else if (seg === 2) { g = c; b = x; } else if (seg === 3) { g = x; b = c; }
  else if (seg === 4) { r = x; b = c; } else { r = c; b = x; }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** rgb→hue（Main.rgbToHsl 的 .X 分量——1456 :30632 disco 扰动色相用） */
function rgbToHue([r, g, b]: [number, number, number]): number {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  if (mx === mn) return 0;
  const d = mx - mn;
  let h: number;
  if (mx === R) h = ((G - B) / d) % 6;
  else if (mx === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
}

export class PrismProng extends Entity {
  w = 18; h = 18;
  /** 原版弹 id（SetDefaults :6807-6817——湿段/数据面消费;类此前未载 id,本批补） */
  readonly projId = 632;
  /** ai[0] 棱序 0-5 */
  idx: number;
  parent: PrismProj | null = null;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  /** 光束方向（velocity） */
  vx = 0; vy = -1;
  /** localAI[1] 激光长度（Lerp 平滑） */
  beamLen = 0;
  /** 充能透明度（0..1） */
  opacity = 0;
  /** 光棱 scale（charge 展开 1.4×(1−num724)，满充 1.4） */
  prongScale = 1;
  /** 同敌免疫窗（Damage_PVE_Inner :14058：immune[owner]=GetSlowMagicUseTime(5)——
   *  常态 5t/蓝空过载 12t） */
  private hitCd = new Map<number, number>();
  dead = false;
  lightRGB: [number, number, number] | null = null;
  /** ★BJ382：PVE 受理命中计数（原版 Projectile.numHits——SetDefaults :706 起始 0;
   *  :14263 受理后自增 ⇒ proc（:13877-79）读自增前值,首跳 0 档率 0.20;拒收不计数。
   *  字段名对齐 SpectreSoulProj.projPveNumHits 读口（PVP 反馈 BJ157-④ 单源） */
  pveNumHits = 0;
  /** ★1458 蓝空过载淡出快照（Main.cs:32832-32838 消费,draw 侧无 game 句柄故
   *  fixedUpdate 每 tick 采样 owner slowMagicUse） */
  private slowFade = false;
  // ---- ★通用湿段（:16903-17113;ProjWetFlags 共享体——632 block :6807-6817 无
  //  ignoreWater 行 = 受段;阻尼 N/A 见文件头定谳注：aiStyle 84 锚定束,AI 直写位 +
  //  tileCollide=false :6816 + UpdatePosition :20549 早退表内）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 后/命中前同位） */
  presetDone = false;

  constructor(idx: number, damage: number, knockback: number) {
    super();
    this.idx = idx;
    this.damage = damage;
    this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.slowFade = (game.player as unknown as { slowMagicUse?: boolean }).slowMagicUse === true;
    const p = this.parent;
    if (!p || p.dead) {
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 AI_084 锚失联 Kill+return
      //  （:31977-31981 `if (type != 632 || !TryGetActive(633)) { Kill(); return; }`）
      //  【先于本支锚位写】→ 死拍 position=上拍钉位,Update 湿段(:16895)无 active 门
      //  照跑（`!active` 门在 :17132 只拦 Damage/尾尘）→ 杀拍溅花照走。本仓杀位
      //  早退曾跳过湿段;现补跑,测位=存储位（原版死拍同位,逐值等价）。杀支与
      //  AI 尾活拍调用点同拍互斥（早退）→ 无需 wetSectionRan 旗;632 ∉
      //  IsDestroyedByWater 六型/非 80 → 段内无补 Kill,幂等面不涉。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      this.dead = true;
      return;
    }
    const charge = p.charge;
    // ---- 充能三段展开（:30338-30366）----
    let num723 = 20, num725 = 15, num726 = -2, num724 = 1;
    if (charge < 180) {
      num724 = 1 - charge / 180;
      num725 = 20 - charge / 180 * 14;
      if (charge < 120) {
        num723 = 20 - 4 * (charge / 120);
        this.opacity = charge / 120 * 0.4;
      } else {
        num723 = 16 - 10 * ((charge - 120) / 60);
        this.opacity = 0.4 + (charge - 120) / 60 * 0.6;
      }
      num726 = -22 + charge / 180 * 20;
    } else {
      num724 = 0; num723 = 1.75; num725 = 6;
      this.opacity = 1; num726 = -2;
    }
    // ---- 光棱轨道分布（:30368-30376）----
    const aim = Math.atan2(p.dirY, p.dirX);
    const off = this.idx - 2.5;
    const orbit = (charge + off * num723) / (num723 * 6) * Math.PI * 2;
    // UnitY.RotatedBy(θ) = (−sinθ, cosθ)（XNA 旋转阵）；num722 取其 .Y=cosθ
    const spreadRot = Math.cos(orbit) * (Math.PI / 6) * num724;   // :30376
    // 预旋转分量（:30374：(−sinθ,cosθ)×(4,num725)——曾写 sin(θ+π/2) 相位错，修正）
    const pxPre = -4 * Math.sin(orbit);
    const pyPre = num725 * Math.cos(orbit);
    // 轨道偏移旋转到 aim 系（.RotatedBy(aim)）
    const ca = Math.cos(aim), sa = Math.sin(aim);
    this.x = p.cx - this.w / 2 + ca * 16 + ca * num726 + (ca * pxPre - sa * pyPre);
    this.y = p.cy - this.h / 2 + sa * 16 + sa * num726 + (sa * pxPre + ca * pyPre);
    // 光束方向 = aim 旋转 spreadRot
    const rot = aim + spreadRot;
    this.vx = Math.cos(rot);
    this.vy = Math.sin(rot);
    this.prongScale = 1.4 * (1 - num724);
    // ---- 激光长度：LaserScan 沿向 2400 截实心（:30498，2 样本均值→单线近似）----
    const st = game.world.store;
    let scanLen = 2400;
    for (let d = 0; d <= 2400; d += 8) {
      const tx = Math.floor((this.cx + this.vx * d) / TILE);
      const ty = Math.floor((this.cy + this.vy * d) / TILE);
      if (!st.inBounds(tx, ty)) { scanLen = d; break; }
      if (st.isSolid(tx, ty)) { scanLen = d; break; }
    }
    this.beamLen = this.beamLen + (scanLen - this.beamLen) * 0.75;   // Lerp 0.75（:30518-30521）
    // ---- ★通用湿段（:16903-17113）——AI（锚位/束向/束长）后/命中环前 = 原版 Update
    // AI(:16880)→湿段(:16895)→Damage(:17184) 同序;溅花尘/音由共享体
    // wetSplashStepShared 承载,不自写;阻尼 N/A 见字段块注（aiStyle 84 锚定束）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // ---- 命中：线碰撞盒 厚 22×scale（:14669-14677），friendly=charge>30 ----
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    if (charge > 30) {
      const thick = 22 * this.prongScale;
      const steps = Math.max(1, Math.floor(this.beamLen / 12));
      // ★X2-D3（2026-09-29）critter 束线面：原版 Damage() victim 循环（:12618）critter
      //  恒在内,束线 Colliding 几何（厚 22×scale 步进盒）对 critter 与敌怪同一支——
      //  本仓逐字同构敌怪面。penetrate=-1（SetDefaults :6807-6815）→ 不耗穿不亡;
      //  同敌 5t 免疫窗（:14056-14058 GetSlowMagicUseTime(5) 写档）对 critter 由一击
      //  即死承载（life=5）;critter lifeMax≤5 → flag10 lifeMax>5 段（:13712）恒不吸血
      //  → 只入账不 proc（BJ383 判例）。单源 settleCritterHit 语义=hurt 调用即受理
      //  （critter 残存 iframes 内重扫重复入账边角=BJ383/384 各站同面,登记）。
      this.pveNumHits += hitCrittersAll(this, game, undefined, (c) => {
        for (let s2 = 1; s2 <= steps; s2++) {
          const d = s2 * 12;
          if (d > this.beamLen) break;
          const bx = this.cx + this.vx * d - thick / 2, by = this.cy + this.vy * d - thick / 2;
          if (bx < c.x + c.w && bx + thick > c.x && by < c.y + c.h && by + thick > c.y) return true;
        }
        return false;
      });
      for (const ent of game.enemies()) {
        if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
        const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; iframes?: number; dontTakeDamage?: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
        if (e.dead || this.hitCd.has(e.id)) continue;
        for (let s2 = 1; s2 <= steps; s2++) {
          const d = s2 * 12;
          if (d > this.beamLen) break;
          const bx = this.cx + this.vx * d - thick / 2, by = this.cy + this.vy * d - thick / 2;
          if (!(bx < e.x + e.w && bx + thick > e.x && by < e.y + e.h && by + thick > e.y)) continue;
          // ★BJ489 def-3：632 光棱掷率=rollVanillaHitCrit（magic 旗,命中拍 owner 装配+
          //  :25712 持械折入动态;critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
          const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
          let dmg = crit ? this.damage * 2 : this.damage;
          if (charge >= 180) dmg *= 3;                     // 满充 ×3（:30379-30381）
          // ★BJ382：幽灵兜帽吸血 proc（Projectile.cs:13877-79 Damage() 通用 on-hit 段;
          //  632 数据面 magic ⇒ 原版棱镜光棱本就吸血,本仓漏接）——受理位挂接,
          //  proc 先于 :14263 numHits++（读自增前值）;拒收不 proc 不计数
          //  ★X2-D1（2026-09-29,BJ393 判据推广）：受理面谓词 !vanillaGated——Enemy.hurt
          //  返真=「本拍击杀」（Enemy.ts:15033）,返假三族=门拒（dead:13971/iframes:13972/
          //  dontTakeDamage:13978）+血尽级联（:14369 族）+普通未致命尾档（:15037）;
          //  原版 proc/numHits++ 在受理面无死亡复查 → 门拒（iframes>0,dontTakeDamage
          //  ——pierce=0 承载,dead 已上方前置）不 proc 不计数,非门拒照 proc 照计数。
          //  旧「hurt 返真」=击杀位判据对非致死命中整面不 proc（吸血 under-fire）,退役。
          // ★清偿刀 T（X4-债12,2026-09-29）：门位读【前置快照】（读侧单源,判据=
          //  「进 hurt 前状态」）。旧后置读两源污染：①受理写支（Enemy.ts:14297
          //  pierce=0 写 10t）→ 受理拍读恒真 → proc/numHits 恒跳（真机吸血域断供,
          //  mock hurt 无写支故测试绿;同刀 R「旧 pierce=0 受理写 10」判谳）；②死亡
          //  转换写支（Enemy.ts:14421 四塔血尽转演出写 iframes=2）→ 致死命中拍误判。
          const gate = snapshotVanillaGate(e);
          dmg = runModModifyHitNpcByProj(game.player, game, this.projId,
            (e as unknown as { vanillaId?: number }).vanillaId ?? -1, dmg, crit);   // ★D2:独立结算面补钩
                    e.hurt(applyBannerDamageDealt(game, e, dmg), this.vx * this.knockback, this.vy * this.knockback, game, this.armorPen, crit, 0, true);   // fromPlayer=DPS 计
          const vanillaGated = vanillaGateRejected(gate);
          // 同敌免疫窗（Damage_PVE_Inner :14058 `type==632 → immune[owner]=
          // GetSlowMagicUseTime(5)`）：常态 5t,蓝空过载（slowMagicUse）×2.5=12t
          // （缺省 5——旧桩 player 无此方法时行为不变）
          const win = (game.player as unknown as {
            getSlowMagicUseTime?: (n: number) => number;
          }).getSlowMagicUseTime?.(5) ?? 5;
          this.hitCd.set(e.id, win);
          if (!vanillaGated) {
            // ★清偿刀 W（X4-债13②,2026-09-29）：写面对齐 :14056-14058 632 专支——
            //  受理尾 immune[owner]=GetSlowMagicUseTime(5)。旧 pierce=0 通用尾档写
            //  10t → hitCd 5t 期满后 5..10t 段再命中被 Enemy.hurt 头门 :13991 整拒,
            //  真机节拍 10t vs 原版 5t。受理面双域同写（R 刀范式）：弹幕域 iframes=
            //  win + 近战域表（桥 632→PROJ_IMMUNE_SLOW_MAGIC_TIER 自换算）。正窗
            //  覆写不触四塔/371 血尽转换写支的 kill-tick 护窗（>0 恒拦）。
            (e as unknown as { iframes?: number }).iframes = win;
            noteVanillaProjImmune(game, this.projId, e.id);
            ghostHealProc(game, this.projId, this.pveNumHits, e as never as Parameters<typeof ghostHealProc>[3]);
            // ★BJ424-T3 魔法命中漏斗面收编：ghostHurt :13881 / nebula :13885 与 ghostHeal
            //  :13877 同块同受理面（632 数据面 magic ⇒ 凡走本面两引擎都该触发）。
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
          break;
        }
      }
    }
    // ---- 光棱点光 + 光束末端彩色尘 ----
    const [lr, lg, lb] = hueToRgb(this.idx / 6);
    this.lightRGB = [lr / 255 * 0.5, lg / 255 * 0.5, lb / 255 * 0.5];
    // 彩虹激光尘（1456 :30622-30660 1:1）。★1457 已删此段（AI_084 只剩
    // 455/642/461/537 的束端尘,632 无）——1458 增量面亦无 632 变更；按用户要求
    // "光束打到的位置才冒粒子"以 1456 公式恢复,备案 docs/weapon-audit-2026-08-22。
    // 门（:30622）：|localAI[1]−num734|<100（平滑束长贴近原始扫描=束稳定期,
    // 出生展开瞬间不撒）&& scale>0.15（充能初期不撒）
    if (Math.abs(this.beamLen - scanLen) < 100 && this.prongScale > 0.15) {
      // vector76 = Center + velocity×(localAI[1] − 14.5×scale)（:30631）= 光束命中点
      const ex = this.cx + this.vx * (this.beamLen - 14.5 * this.prongScale);
      const ey = this.cy + this.vy * (this.beamLen - 14.5 * this.prongScale);
      const vr = Math.atan2(this.vy, this.vx);
      // 终色 = Lerp(hue 色, disco 扰动色(hue+rand×0.4,1,0.75), scale/1.4)（:30655）
      // ——满充(scale 1.4)全 disco 化;disco 时钟缺省回退激光自身色相
      const disco = (game as unknown as {
        lighting?: { clock?: { discoColor?: () => [number, number, number] } };
      }).lighting?.clock?.discoColor?.();
      const discoHue = disco ? rgbToHue(disco) : this.idx / 6;
      const t = Math.min(1, this.prongScale / 1.4);
      const [mr, mg, mb] = hueToRgb((discoHue + Math.random() * 0.4) % 1);
      const cr = Math.round(lr + (mr - lr) * t);
      const cg = Math.round(lg + (mg - lg) * t);
      const cb = Math.round(lb + (mb - lb) * t);
      for (let i = 0; i < 2; i++) {
        // 2× 267 号彩虹尘：垂直束向 ±π/2 随机侧、速 1..1.8（:30634-30638）
        const ang = vr + (Math.random() < 0.5 ? -1 : 1) * Math.PI / 2;
        const spd = Math.random() * 0.8 + 1;
        let dvx = Math.cos(ang) * spd, dvy = Math.sin(ang) * spd;
        let dscale = 1.2;
        if (this.prongScale > 1) { dvx *= this.prongScale; dvy *= this.prongScale; dscale *= this.prongScale; }   // :30641-30644
        game.spawnDust?.(ex, ey, 0, 0, 267, dvx, dvy, 0,
          { r: cr, g: cg, b: cb, a: 255 }, dscale, true);
        // CloneDust 白色半尺（:30646-30651,scale≠1.4 充能期才出;6000 池满守卫略）
        if (this.prongScale !== 1.4) {
          game.spawnDust?.(ex, ey, 0, 0, 267, dvx, dvy, 0,
            { r: 255, g: 255, b: 255, a: 255 }, dscale / 2, true);
        }
      }
      // 1/5 烟尘 31：垂直偏移 (rand−0.5)×width(18) −(4,4)、8×8、scale 1.5;
      // 原版速度 0,0 → ×0.5/vy=−|vy| 均为恒零无操作（:30656-30663）
      if (Math.floor(Math.random() * 5) === 0) {
        const off = (Math.random() - 0.5) * 18;
        game.spawnDust?.(ex - Math.sin(vr) * off - 4, ey + Math.cos(vr) * off - 4,
          8, 8, 31, 0, 0, 100, null, 1.5);
      }
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const ctx = r.ctx;
    if (!ctx || this.beamLen < 8) return;
    // ★1458 蓝空过载淡出指示（Main.cs:32832-32838）：slowMagicUse → 束厚
    // vector66.X×0.7 + 透明度 num296×0.25——"fades out to indicate its slow usage"
    const th = this.slowFade ? 0.7 : 1;
    const opacity = Math.max(0, Math.min(1, this.opacity * (this.slowFade ? 0.25 : 1)));
    if (opacity <= 0.02) return;
    const img = projSprite(632);
    // ---- 贴图激光（Utils.DrawLaser Utils.cs:2797 + Main.cs:32827-32838 1:1）----
    // 起点 = Center + vel×scale×10.5、长 = localAI[1] − 14.5×scale²（:32828-32833）
    // ——起点帽三角画在光棱环上(原版可见"棱镜"即此帽,非 633 晶体;2026-08-24 用户报
    // "半径错了"根因:旧线条近似无帽=可见三角只剩盒心晶体)。双 pass:hue 全宽+
    // 白(127)半宽,各 ×0.75×Opacity
    if (img && (img.width > 0) && img.width > 0 && typeof document !== 'undefined') {
      const sx = this.cx + this.vx * this.prongScale * 10.5;
      const sy = this.cy + this.vy * this.prongScale * 10.5;
      const len = this.beamLen - 14.5 * this.prongScale * this.prongScale;
      if (len > 4) {
        const [rr, gg, bb] = hueToRgb(this.idx / 6);
        const rotAdj = Math.atan2(this.vy, this.vx) - Math.PI / 2;   // 贴图纵向→束向(Utils.cs:2804)
        ctx.save();
        // ★XNA 预乘混合语义（AlphaBlend 对预乘贴图 out = tex.rgb×C.rgb + dest×(1−tex.a×C.a)
        // ——RGB 贡献【不吃 C.alpha】）:hue pass A×=0(:32826) → 纯加法不衰减背景
        // ='lighter' 等价;白 pass RGB 贡献=255×0.75×op 全额(A=127 只衰减 dest)。
        // 曾 source-over(遮暗背景=显粗/色调闷)与白芯 ×127/255(亮度减半)皆误,均废
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = false;
        // ★BJ703-F（BJ700-C 同族 flatten 债清偿）：双 pass 烘焙改保形（flatten=false）
        //  ——632 图 26×78 二值 α、43.4% 透明（帧 0/1/2 分别 43.4%/46.2%/29.4%）,
        //  摊平把透明域填成不透明染色底 → 'lighter' 全幅加色 = 光束比原版锥形辉光
        //  更宽更实（cosmetic 未实报,BJ700-C 登记债②）。保形后贡献=tex.rgb×tex.a×
        //  C.rgb×ga 逐 texel 精确=XNA One 因子（透明域贡献 0）。
        const hueTex = tintedTex(img, [rr, gg, bb], false);
        const whiteTex = tintedTex(img, [255, 255, 255], false);
        if (hueTex) this.drawLaserTex(ctx, hueTex, sx, sy, rotAdj, len, this.prongScale * th, 0.75 * opacity);
        if (whiteTex) this.drawLaserTex(ctx, whiteTex, sx, sy, rotAdj, len, this.prongScale * 0.5 * th, 0.75 * opacity);
        ctx.restore();
        return;
      }
    }
    // 回退：贴图未就绪/非 DOM 环境——旧线条近似（同 AlphaBlend）
    const [rr, gg, bb] = hueToRgb(this.idx / 6);
    const a = opacity * 0.75;
    const x2 = this.cx + this.vx * this.beamLen, y2 = this.cy + this.vy * this.beamLen;
    ctx.save();
    ctx.strokeStyle = `rgba(${rr},${gg},${bb},${a})`;
    ctx.lineWidth = 26 * this.prongScale * 0.75 * th;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(this.cx, this.cy); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${a * 0.75})`;
    ctx.lineWidth = 13 * this.prongScale * 0.75 * th;
    ctx.beginPath(); ctx.moveTo(this.cx, this.cy); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  /** Utils.DrawLaser（Utils.cs:2797-2833）1:1：stage0 起点帽帧(0,0,26,22)
   *  origin=帧心(13,11)、distCovered 33（消耗 33×sc 但只前进 (22−11)×sc——帽 art
   *  与身重叠）；stage1 身帧(0,25,26,28) origin(13,0) 平铺、末段截高；
   *  stage2 尾帽帧(0,56,26,22) origin(13,1)。rotAdj 已含 −π/2（贴图纵向=束向） */
  private drawLaserTex(ctx: CanvasRenderingContext2D, tex: CanvasImageSource & { width: number; height: number },
    sx: number, sy: number, rotAdj: number, len: number, sc: number, alpha: number): void {
    const advX = Math.cos(rotAdj + Math.PI / 2), advY = Math.sin(rotAdj + Math.PI / 2);
    let px = sx, py = sy;
    let remain = len;
    // stage 0 起点帽
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rotAdj);
    ctx.globalAlpha = alpha;
    ctx.drawImage(tex, 0, 0, 26, 22, -13 * sc, -11 * sc, 26 * sc, 22 * sc);
    ctx.restore();
    remain -= 33 * sc;
    px += advX * 11 * sc;
    py += advY * 11 * sc;
    // stage 1 身（平铺,末段截高——推进量随截断,尾帽精确落在束端）
    let travelled = 0;
    while (travelled + 1 < remain) {
      // Utils.cs:2818 段距×scale<2px 即停铺（低充能 scale→0 防万段刷屏）
      if (28 * sc < 2) break;
      let fh = 28;
      if (remain - travelled < 28) fh = remain - travelled;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rotAdj);
      ctx.globalAlpha = alpha;
      ctx.drawImage(tex, 0, 25, 26, fh, -13 * sc, 0, 26 * sc, fh * sc);
      ctx.restore();
      const adv = fh * sc;
      travelled += adv;
      px += advX * adv;
      py += advY * adv;
    }
    // stage 2 尾帽
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rotAdj);
    ctx.globalAlpha = alpha;
    ctx.drawImage(tex, 0, 56, 26, 22, -13 * sc, -1 * sc, 26 * sc, 22 * sc);
    ctx.restore();
  }
}

export class PrismProj extends Entity {
  w = 14; h = 18;
  /** ai[0] 充能计数 */
  charge = 0;
  /** 平滑瞄准方向（velocity，模长=shootSpeed 30） */
  dirX: number; dirY: number;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  /** channel 电平 / 瞄准点 / 每拍魔耗（失败=false） */
  channelCb: () => boolean;
  aimCb: () => { x: number; y: number };
  payMana: () => boolean;
  /** 每拍伤害刷新（:63630 [1456] / :67596 [1457] damage=(int)(手持物 damage×player.magicDamage)）——Game 注入
   *  trunc(手持物面板(含词缀)×player.damageMult('magic'))；缺省 = 出生定死（旧路径/测试） */
  dmgCb?: () => number;
  prongs: PrismProng[] = [];
  dead = false;
  /** 帧计数器/当前帧（原版 frameCounter/frame，:63686-63694 [1456] / :67637-67645 [1457]） */
  private frameCounter = 0;
  private crystalFrame = 0;
  /** 充能音 soundDelay（:63693-63700 [1456] / :67647-67655 [1457]：num38=10×2=20t 循环） */
  private sndT = 0;
  private spawnGuard = false;

  constructor(dirX: number, dirY: number, damage: number, knockback: number,
    channelCb: () => boolean, aimCb: () => { x: number; y: number }, payMana: () => boolean,
    dmgCb?: () => number) {
    super();
    const n = Math.hypot(dirX, dirY) || 1;
    this.dirX = dirX / n * 30; this.dirY = dirY / n * 30;   // shootSpeed 30
    this.damage = damage;
    this.knockback = knockback;
    this.channelCb = channelCb;
    this.aimCb = aimCb;
    this.payMana = payMana;
    this.dmgCb = dmgCb;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // 魔耗节奏（:63628-63636 [1456] / :67587-67595 [1457]：>90t 15 拍、>120t 5 拍，否则 30 拍）
    this.charge++;
    const cadence = this.charge > 120 ? 5 : this.charge > 90 ? 15 : 30;
    // 伤害动态刷新（:63630 [1456] / :67596 [1457]）：damage=(int)(手持物 damage×player.magicDamage) 每拍重算
    // ——MagicPower/魔力眩晕/魔力过热等乘区变动即时生效（曾出生定死）；632 光棱逐拍
    // 同步 damage=projectile3.damage（:30375；满充 ×3 :30376-30378 在 PrismProng 命中侧另乘）
    if (this.dmgCb) {
      this.damage = this.dmgCb();
      for (const q of this.prongs) q.damage = this.damage;
    }
    if (this.charge % cadence === 0 && !this.payMana()) { this.dead = true; this.killProngs(); return; }
    // aim 平滑（:63662-63676 [1456] / :67616-67634 [1457]）：value7=Normalize(瞄准向) 先归一，再
    // Lerp(value7, Normalize(velocity), 0.92)（曾漏归一直接 0.08×原始差——鼠标
    // 距离越远偏差越大，2026-08-13 复查修正）
    const aim = this.aimCb();
    const pd = Math.hypot(this.dirX, this.dirY) || 1;
    let ax = aim.x - this.cx, ay = aim.y - this.cy;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al; ay /= al;
    let mx = ax * 0.08 + (this.dirX / pd) * 0.92;
    let my = ay * 0.08 + (this.dirY / pd) * 0.92;
    const ml = Math.hypot(mx, my) || 1;
    this.dirX = mx / ml * 30; this.dirY = my / ml * 30;
    // 晶体帧速（:63686-63694 [1456] / :67637-67645 [1457]）：frameCounter++，num40 = ai0<120 ? 4 : 1（充能期
    // 4t/帧、≥120t 后 1t/帧——曾恒 3t/帧）；≥num40 归零并 ++frame（≥5 回 0）
    this.frameCounter++;
    const num40 = this.charge < 120 ? 4 : 1;
    if (this.frameCounter >= num40) {
      this.frameCounter = 0;
      if (++this.crystalFrame >= 5) this.crystalFrame = 0;
    }
    // 充能嗡鸣（:63693-63700 [1456] / :67647-67655 [1457]）：soundDelay=num38(10)×2=20t 循环，ai0==1 首拍不播
    // （633 UseSound=null，channel 期唯一音源；播放接法同 460 :63504-63512 [1456] / :67464-67472 [1457] 先例）
    if (this.sndT <= 0) {
      this.sndT = 10 * 2;
      if (this.charge !== 1) game.playSfxFiles(['Item_15'], 1, this.cx, this.cy);
    }
    this.sndT--;
    // channel 门（:63700-63717 [1456] / :67656-67682 [1457]）：断 channel/noItems/CCed → Kill
    if (!this.channelCb()) { this.dead = true; this.killProngs(); return; }
    // channel 期用魔动画续期（Player.cs:43143-43146 itemAnimation 持续>0 每帧
    // ItemCheck_ApplyManaRegenDelay → delay 钉 4 = 全程 5% 滴流回蓝；2026-08-22
    // 审计 ❌ 修复——棱镜充能 120t+ 远超 useTime 10t,不续期则白嫖魔力）
    game.player.onChannelManaHold?.();
    game.refreshChannelItem?.(Math.atan2(this.dirY, this.dirX));   // 蓄力期手持棱镜跟鼠标+不脱落（channel itemAnimation 钉满）
    // 挂玩家手（heldProj 语义：parent.Center 即光棱轨道圆心）
    const pl = game.player as unknown as { cx: number; cy: number } | null;
    if (!pl) { this.dead = true; this.killProngs(); return; }
    this.x = pl.cx - this.w / 2;
    this.y = pl.cy - this.h / 2;
    // 首帧生成 6 光棱（:63702-63710 [1456] / :67662-67673 [1457]）
    if (!this.spawnGuard) {
      this.spawnGuard = true;
      const nd = Math.hypot(this.dirX, this.dirY) || 1;
      for (let i = 0; i < 6; i++) {
        const prong = new PrismProng(i, this.damage, this.knockback);
        prong.parent = this;
        prong.vx = this.dirX / nd; prong.vy = this.dirY / nd;
        prong.critChance = this.critChance;
        prong.armorPen = this.armorPen;
        this.prongs.push(prong);
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(prong, 'projectiles');
      }
    }
  }

  private killProngs(): void {
    for (const q of this.prongs) q.dead = true;
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    // 晶体本体（Projectile_633.png 26×120 = 5 帧；帧速 :63686-63694 [1456] / :67637-67645 [1457]——充能 4t/帧、
    // ≥120t 后 1t/帧，由 fixedUpdate 推进 crystalFrame）
    // ★drawLayer=7（SetDefaults :6800）= 原版在【玩家绘制层组内】画（PlayerDrawLayers.cs:3154
    //   DrawPlayer_27_HeldItem 记 projectileDrawPosition → :4318 RenderAllLayers 在持物层
    //   位置插入 DrawHeldProj）= 身体【前】。实体循环先于 drawPlayer，直画会被纸娃娃
    //   盖住（2026-08-24 用户报"身上没棱镜"）→ 登记 Renderer.prismCrystalQueue，
    //   drawPlayer 后冲刷（世界变换仍活，闭包世界坐标直画）；无队列环境（测试）直画
    const paint = (ctxOverride?: CanvasRenderingContext2D) => {
      const img = projSprite(633);
      const ctx = ctxOverride ?? r.ctx;
      if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
      const fh = img.height / 5;
      const f = this.crystalFrame;
      // rotation = velocity.ToRotation() + num（:68379；num=π/2 AI_075 头 :67172——
      // 633 块无覆写,595/735 才置 0）。贴图锥尖朝上(−y),+π/2 后锥尖=瞄准向;
      // 曾漏 +π/2 = 锥尖偏 90°
      const rot = Math.atan2(this.dirY, this.dirX) + Math.PI / 2;
      // ★持握半径（2026-08-24 用户实机对照两次报）：晶体【绘制位】=角色中心+
      // 瞄准向×16——瞄准扫动时晶体沿角色圆周走(用户:"持握位置围绕角色的一个
      // 圆周走,不是贴在中心点转朝向");满充时与汇聚起点帽重叠=实机只见一个三角。
      // 逻辑中心(碰撞盒/632 光棱锚定 projectile2.Center)不动,仅绘制偏移
      const al = Math.hypot(this.dirX, this.dirY) || 1;
      const dx = this.cx + this.dirX / al * 16;
      const dy = this.cy + this.dirY / al * 16;
      ctx.save();
      // ★BJ-C1 F3：α 面=GetAlpha :80834-80837 `603||633 → Color(255,255,255,200)`
      //  恒 A=200（PROJ_ALPHA_MOD[633] fixed 档同源）→ ga=200/255（旧直画无 α 面
      //  =满显偏差,随刀对齐）;RGB 恒白不读格光=光照无关复绘域。
      ctx.globalAlpha = 200 / 255;
      ctx.translate(dx, dy);
      ctx.rotate(rot);
      ctx.drawImage(img, 0, Math.round(f * fh), img.width, Math.round(fh),
        -img.width / 2, -fh / 2, img.width, fh);
      ctx.restore();
    };
    // ★BJ-C1 F3（2026-10-06,代表判别站）：633 晶体 GetAlpha :80834-80837
    //  `603||633 → new Color(255,255,255,200)`（PROJ_ALPHA_MOD[633] fixed 档）——
    //  RGB 恒白【不读格光色】=光照无关。旧位 prismCrystalQueue 冲刷在 drawPlayer 后/
    //  compositeLight（Renderer.ts :6587）【前】=晶体被全屏乘光压暗（暗腔同病,
    //  BJ529 探针 k=0.325 域）→ 改道 projFullbrightQueue（7f 光照合成后主画布
    //  source-over 复绘=原版逐字）。层序=玩家之上（270/45/BJ504 同槽惯例,登记;
    //  持物层"身体前"语义由先于 7f 的 drawPlayer 保序）。无全亮队列环境
    //  （测试/旧宿主）回退 prismCrystalQueue→直画原路径。
    const fbSink = (r as unknown as {
      queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
    }).queueProjFullbright;
    if (typeof fbSink === 'function') { fbSink((c) => paint(c)); return; }
    const queue = (r as unknown as { prismCrystalQueue?: Array<() => void> }).prismCrystalQueue;
    if (queue) { queue.push(() => paint()); return; }
    paint();
  }
}

/** 充能爆破炮 2882 → 460/461/459（AI_075 460 分支 :63442-63620 [1456] =
 *  :67402-67584 [1457] + AI_84 461 锚定）：
 *  460 晶体：channel 主控；ai[0] += GetSlowMagicUseRate()（:67404,1457 slowMagic 六消费
 *  点之一——常态 1/t、蓝空过载 0.4/f,蓄压档 80/180 拉长 2.5×）；每 5t 重瞄
 *  （vel=归一瞄准向,瞄准拍兼 flag5 发射拍 :67439）；音 Item15 按 (5−档)×2 间隔；
 *  魔耗节点 = (int)ai0==80/==180/满蓄后 %20（:63454-63459 flag3 + :63562-63563 flag6
 *  [1456] = :67414-67424 + :67522-67523 [1457]）；
 *  459 小弹发射点 = ai0==1、≤50 每 (int)ai0%10、80-180 每 (int)ai0%30（速度 10；
 *  二段 num35=0.7+num20×0.3≥1 → 伤害×2.5 :63610-63611 [1456] = :67573-67574 [1457]）；
 *  (int)ai0==180 发 461 光束（伤害×1.5）后光束灭即亡（flag5 拍才查 :63580-63587 [1456]
 *  = :67540-67546 [1457]）。
 *  命中 461 = 线碰撞 22×scale（:14612-14620）+ LaserScan 2400。 */
export class BlasterBeam extends Entity {
  w = 18; h = 18;
  /** 原版弹 id（SetDefaults :5319-5330——湿段/数据面消费;类此前未载 id,本批补） */
  readonly projId = 461;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  parent: ChargedBlaster | null = null;
  vx = 0; vy = -1;
  beamLen = 0;
  private hitCd = new Map<number, number>();
  dead = false;
  lightRGB: [number, number, number] | null = [0.5, 0.2, 0.5];
  /** ★BJ382：PVE 受理命中计数（原版 Projectile.numHits——SetDefaults :706 起始 0;
   *  :14263 受理后自增 ⇒ proc（:13877-79）读自增前值;拒收不计数。
   *  字段名对齐 SpectreSoulProj.projPveNumHits 读口（PVP 反馈 BJ157-④ 单源） */
  pveNumHits = 0;
  // ---- ★通用湿段（:16903-17113;ProjWetFlags 共享体——461 block :5319-5330 无
  //  ignoreWater 行 = 受段;阻尼 N/A 见文件头定谳注：aiStyle 84 锚定束,AI 直写位 +
  //  tileCollide=false :5328 + UpdatePosition :20549 早退表内）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍 AI 后/命中前同位） */
  presetDone = false;

  constructor(damage: number, knockback: number) {
    super();
    this.damage = damage;
    this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const p = this.parent;
    if (!p || p.dead) {
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 AI_084 461 锚失联 Kill+return
      //  （:31958-31963 TryGetActive(460) 失败 → else 支 :31977-31981 同门）先于锚位
      //  写 :31961 → 死拍 position=上拍钉位,Update 湿段(:16895)无 active 门照跑
      //  （`!active` 门 :17132 只拦 Damage/尾尘）→ 杀拍溅花照走。补跑测位=存储位
      //  （原版死拍同位,逐值等价）;杀支与 AI 尾活拍调用点同拍互斥 → 无需
      //  wetSectionRan 旗;461 ∉ IsDestroyedByWater 六型/非 80 → 无补 Kill 面。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      this.dead = true;
      return;
    }
    // 锚定（AI_84 :30313-30319：Center = 父.Center + 归一vel×16）
    this.x = p.cx + p.dirX * 16 - this.w / 2;
    this.y = p.cy + p.dirY * 16 - this.h / 2;
    this.vx = p.dirX; this.vy = p.dirY;
    // 激光长度（LaserScan 2400 截实心）
    const st = game.world.store;
    let scanLen = 2400;
    for (let d = 0; d <= 2400; d += 8) {
      const tx = Math.floor((this.cx + this.vx * d) / TILE);
      const ty = Math.floor((this.cy + this.vy * d) / TILE);
      if (!st.inBounds(tx, ty)) { scanLen = d; break; }
      if (st.isSolid(tx, ty)) { scanLen = d; break; }
    }
    this.beamLen = this.beamLen + (scanLen - this.beamLen) * 0.75;
    // ---- ★通用湿段（:16903-17113）——AI（锚位/束向/束长）后/命中环前 = 原版 Update
    // AI(:16880)→湿段(:16895)→Damage(:17184) 同序;溅花尘/音由共享体
    // wetSplashStepShared 承载,不自写;阻尼 N/A 见字段块注（aiStyle 84 锚定束）----
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // 线碰撞命中（厚 22）
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    const thick = 22;
    const steps = Math.max(1, Math.floor(this.beamLen / 12));
    // ★X2-D3（2026-09-29）critter 束线面（同 632 站注）：penetrate=-1（SetDefaults
    //  :5319-5328）→ 不耗穿不亡;几何与敌怪面逐字同构（厚 22 步进盒）。
    this.pveNumHits += hitCrittersAll(this, game, undefined, (c) => {
      for (let s2 = 1; s2 <= steps; s2++) {
        const d = s2 * 12;
        if (d > this.beamLen) break;
        const bx = this.cx + this.vx * d - thick / 2, by = this.cy + this.vy * d - thick / 2;
        if (bx < c.x + c.w && bx + thick > c.x && by < c.y + c.h && by + thick > c.y) return true;
      }
      return false;
    });
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; iframes?: number; dontTakeDamage?: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || this.hitCd.has(e.id)) continue;
      for (let s2 = 1; s2 <= steps; s2++) {
        const d = s2 * 12;
        if (d > this.beamLen) break;
        const bx = this.cx + this.vx * d - thick / 2, by = this.cy + this.vy * d - thick / 2;
        if (!(bx < e.x + e.w && bx + thick > e.x && by < e.y + e.h && by + thick > e.y)) continue;
        // ★BJ489 def-3：461 光束掷率=rollVanillaHitCrit（magic 旗,命中拍动态;冻结载体退役）
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const dmg = crit ? this.damage * 2 : this.damage;
        // ★BJ382：幽灵兜帽吸血 proc（Projectile.cs:13877-79 Damage() 通用 on-hit 段;
        //  461 数据面 magic ⇒ 原版充能爆破炮光束本就吸血,本仓漏接）——受理位挂接,
        //  proc 先于 :14263 numHits++（读自增前值）;拒收不 proc 不计数
        //  ★X2-D1（同 632 站注）：受理面谓词 !vanillaGated——门拒（iframes>0/
        //  dontTakeDamage）不 proc 不计数,血尽级联/普通未致命返假照 proc 照计数
        // ★清偿刀 T（X4-债12,同 632 站注）：门位读【前置快照】——旧后置读被受理写支
        //  （Enemy.ts:14297 pierce=0 写 10t;461 vanilla 写梯尾档 10t :14176-14182 同值,
        //  写面 1:1）与死亡转换写支（Enemy.ts:14421 四塔写 2）双源污染,受理拍读恒真
        //  → proc/numHits 真机恒跳。快照判据=「进 hurt 前状态」。
        const gate = snapshotVanillaGate(e);
        e.hurt(applyBannerDamageDealt(game, e, dmg), this.vx * this.knockback, this.vy * this.knockback, game, this.armorPen, crit, 0, true);   // fromPlayer=DPS 计
        const vanillaGated = vanillaGateRejected(gate);
        if (!vanillaGated) {
          ghostHealProc(game, this.projId, this.pveNumHits, e as never as Parameters<typeof ghostHealProc>[3]);
          // ★BJ424-T3 魔法命中漏斗面收编：ghostHurt :13881 / nebula :13885 同块同 face（461）。
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
        this.hitCd.set(e.id, 5);
        break;
      }
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const ctx = r.ctx;
    if (!ctx || this.beamLen < 8) return;
    const x2 = this.cx + this.vx * this.beamLen, y2 = this.cy + this.vy * this.beamLen;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(230,140,255,0.85)';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(this.cx, this.cy); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(this.cx, this.cy); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }
}

export class ChargedBlaster extends Entity {
  w = 14; h = 18;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dirX: number; dirY: number;
  channelCb: () => boolean;
  aimCb: () => { x: number; y: number };
  payMana: () => boolean;
  beam: BlasterBeam | null = null;
  dead = false;
  private charge = 0;
  private aimCd = 0;
  private sndT = 0;

  constructor(dirX: number, dirY: number, damage: number, knockback: number,
    channelCb: () => boolean, aimCb: () => { x: number; y: number }, payMana: () => boolean) {
    super();
    const n = Math.hypot(dirX, dirY) || 1;
    this.dirX = dirX / n; this.dirY = dirY / n;
    this.damage = damage;
    this.knockback = knockback;
    this.channelCb = channelCb;
    this.aimCb = aimCb;
    this.payMana = payMana;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // ai[0] += GetSlowMagicUseRate()（:67404——1457 slowMagic 六消费点之一）：常态 1/t、
    // 蓝空过载 0.4/t（蓄压全档 80/180 拉长 2.5×）。★Math.fround = C# float 累积语义：
    // 0.4f 双精/单精累积都永不落整 20 倍数（下 flag5 直通条件实证零命中），floor 档
    // 80/180 到达拍一致（单精 200/451,452）。缺省 1（旧桩 player 无此方法时行为不变）
    const rate = (game.player as unknown as { getSlowMagicUseRate?: () => number })
      .getSlowMagicUseRate?.() ?? 1;
    this.charge = Math.fround(this.charge + rate);
    const full = this.charge >= 180;                                        // flag4（:63460 [1456] / :67420 [1457]）
    const stage = (this.charge >= 180 ? 2 : this.charge >= 80 ? 1 : 0);     // num20（:63445-63453 [1456] / :67405-67413 [1457]）
    const ai0 = Math.trunc(this.charge);                                    // (int)ai[0] 截断
    // 重瞄（:63476-63496 [1456] / :67435-67441 [1457]：满蓄前 ai1≥5 门、满蓄 ai0%5）
    if (!full) this.aimCd++;
    const aimTick = (!full && this.aimCd >= 5) || (full && ai0 % 5 === 0);
    if (aimTick) {
      if (!full) this.aimCd = 0;
      const aim = this.aimCb();
      let ax = aim.x - this.cx, ay = aim.y - this.cy;
      const al = Math.hypot(ax, ay) || 1;
      this.dirX = ax / al; this.dirY = ay / al;
    }
    // 音（Item15 按 (5−档)×2 间隔，非首帧）
    if (this.sndT <= 0 && !full) {
      this.sndT = (5 - stage) * 2;
      if (this.charge !== 1) game.playSfxFiles(['Item_15'], 1, this.cx, this.cy);
    }
    this.sndT--;
    // channel 门（:63562-63565 [1456] / :67522-67525 [1457]）——断链即亡
    if (!this.channelCb()) { this.dead = true; if (this.beam) this.beam.dead = true; return; }
    // channel 期用魔动画续期（Player.cs:43143-43146 itemAnimation 持续>0 每帧
    // ItemCheck_ApplyManaRegenDelay → delay 钉 4 = 全程 5% 滴流回蓝；2026-08-22
    // 审计 ❌ 修复——蓄力 180t+ 远超 useTime,不续期则白嫖魔力）
    game.player.onChannelManaHold?.();
    game.refreshChannelItem?.(Math.atan2(this.dirY, this.dirX));   // 蓄力期手持棱镜跟鼠标+不脱落（channel itemAnimation 钉满）
    // 挂手
    const pl = game.player as unknown as { cx: number; cy: number } | null;
    if (!pl) { this.dead = true; return; }
    this.x = pl.cx - this.w / 2;
    this.y = pl.cy - this.h / 2;
    // ---- 蓄力尘（BJ372 2026-09-27 补;:67473-67493 [1457] = :63513-63535 [1456]
    //  ——曾整缺=用户实报"没有蓄力效果"的唯一视觉面）：ai0>10 严格门且未满蓄;
    //  每 tick num20+1 粒 226 电尘（k 奇偶 scale 0.4/0.65）在枪口前 18px 点
    //  （vector11 = Center + UnitX×18 RotatedBy(rotation−π/2) = aim 向）周围半径
    //  (12−num20×2) 圆环随机出生（NewDust 盒 16×16 @ vector12−(8,8)）;初速
    //  velocity/2 随即被覆写（传 0 同效）= Normalize(vector11−vector12)×1.5×
    //  (10−num20×2)/10（档 0/1/2 → 1.5/1.2/0.9,汇向枪口）;noGravity+customData
    //  =player → 226 支 Dust.cs:2337-2341 position += 主角本拍位移（VanillaDust
    //  226 followPlayer 通道,BJ372 同批补消费面）
    if (this.charge > 10 && !full) {
      const fx = this.cx + this.dirX * 18, fy = this.cy + this.dirY * 18;
      for (let k = 0; k < stage + 1; k++) {
        const scl = k % 2 === 1 ? 0.65 : 0.4;
        const ang = Math.random() * Math.PI * 2;
        const px = fx + Math.cos(ang) * (12 - stage * 2);
        const py = fy + Math.sin(ang) * (12 - stage * 2);
        const d = game.spawnDust?.(px - 8, py - 8, 16, 16, 226, 0, 0, 0, null, scl);
        if (d) {
          const dx = fx - px, dy = fy - py;
          const len = Math.hypot(dx, dy) || 1;
          const spd = 1.5 * (10 - stage * 2) / 10;
          d.vx = dx / len * spd; d.vy = dy / len * spd;
          d.noGravity = true;
          d.followPlayer = true;
        }
      }
    }
    // ---- 满蓄喷焰（:67495-67518 [1457] = :63537-63560 [1456]）：每 tick 2 粒
    //  （scale 0.35/0.45）自枪口前 14px 点（vector13）沿 ±0.2π² 锥
    //  （rotation + num28×(π/4)×0.8 −π/2,num28 = NextFloatDirection (−π,π]）6px 处
    //  出生（NewDust 盒 24×24 @ vector14−(12,12)）;速度 = 锥向单位向 × Lerp(1.5,9,
    //  GetLerpValue(1,0,|num28|,clamped))（|num28|=0 中轴 9 → |num28|≥1 封底 1.5）;
    //  fadeIn=0.5（生长目标:0.35/0.45 +0.03/t 至越 0.5 转衰）;followPlayer 同上
    if (full) {
      const fx = this.cx + this.dirX * 14, fy = this.cy + this.dirY * 14;
      const base = Math.atan2(this.dirY, this.dirX);
      for (let l = 0; l < 2; l++) {
        const scl = l % 2 === 1 ? 0.45 : 0.35;
        const num28 = Math.random() * Math.PI * 2 - Math.PI;
        const dAng = base + num28 * (Math.PI / 4) * 0.8;
        const px = fx + Math.cos(dAng) * 6, py = fy + Math.sin(dAng) * 6;
        const d = game.spawnDust?.(px - 12, py - 12, 24, 24, 226, 0, 0, 0, null, scl);
        if (d) {
          const t = Math.min(1, Math.max(0, 1 - Math.abs(num28)));
          const spd = 1.5 + (9 - 1.5) * t;
          d.vx = Math.cos(dAng) * spd; d.vy = Math.sin(dAng) * spd;
          d.noGravity = true;
          d.fadeIn = 0.5;
          d.followPlayer = true;
        }
      }
    }
    // flag5 发射拍（:67430-67440）：ai0==1（0.4 步进永不成立,原版同款哑档）‖
    // 满蓄 ai[0]%20f==0（0.4 累积恒非整 20 倍数——fround/双精都零命中,哑档）‖
    // 瞄准拍（重瞄门内 flag5=true :67439）。★发射/魔耗/光束存活检查全挂此拍
    // （:67442 flag5 门）——常态 1/t 下所有 %10/%30 发射拍均为 5 的倍数 = 瞄准拍,
    // 行为不变;过载 0.4/t 下 459 只在 floor∈{10,20,...,50,80,110,140,170} 的瞄准拍出
    const flag5 = this.charge === 1 || (full && this.charge % 20 === 0) || aimTick;
    if (!flag5) return;
    // 魔耗节点（:63454-63459 [1456] / :67414-67424 [1457] flag3 = (int)ai0==80 / ==180 /
    // 满蓄后 (int)ai0%20==0；结算式 :63562-63563 [1456] / :67522-67523 [1457] flag6 =
    // !flag3 || CheckMana(mana, pay:true)——只在 flag3 拍
    // 扣魔（flag3 拍必落在 flag5 发射拍内：80=ai1 满 5、180 与 %20 均 %5==0），
    // 曾错成每发 459 小弹扣。扣魔失败 → Kill（:63564-63565 [1456] / :67524-67527 [1457]
    // else 分支；1457 ManaV2 payMana 恒放行）。★(int) 截断门——过载 0.4 步进下 floor 80 停 2-3 拍,
    // 但 flag5 门只放瞄准拍 → 扣魔一次（原版同款）
    const flag3 = ai0 === 80 || ai0 === 180
      || (this.charge > 180 && ai0 % 20 === 0);
    if (flag3 && !this.payMana()) {
      this.dead = true; if (this.beam) this.beam.dead = true; return;
    }
    if (!full) {
      // 459 小弹（:63590-63612 [1456] / :67550-67575 [1457] flag7：ai0==1 / ≤50 且
      // (int)ai0%10==0 / 80-180 且 (int)ai0%30==0；速度 10）
      const fire = this.charge === 1
        || (this.charge <= 50 && ai0 % 10 === 0)
        || (this.charge >= 80 && this.charge < 180 && ai0 % 30 === 0);
      if (fire) {
        // 二段伤害（:63610-63611 [1456] / :67573-67574 [1457]）：num35 = 0.7 + num20×0.3（num20=0/1/2 → 0.7/1.0/1.3），
        // num35<1 ? damage : (int)(damage×2.5)。C# float 0.7f+0.3f 恰 = 1.0f（80t 起即
        // ×2.5）；JS 双精 0.7+0.3=0.9999999999999999 不可直接比，按 num20 判门；(int)=截断
        const num36 = stage === 0 ? this.damage : Math.trunc(this.damage * 2.5);
        // ★BJ704-G10（件10）：num35（NewProjectile 尾参 ai[1] :67574）三档蓄压注入
        //  ——Arrow 459 AI 块（scale=(int)(22×scale) 判定盒/ghost 环 end/尘 226/
        //  ≥0.85 档 penetrate=−1/点光）随档消费,零档注入=旧「恒 1 档」债根因。
        const num35 = 0.7 + stage * 0.3;
        const bolt = new Arrow(this.cx, this.cy, this.dirX * 10, this.dirY * 10,
          num36, this.knockback, 459,
          { grav: 0, life: 600, pierce: 1, ai1: num35 });
        bolt.critChance = this.critChance;
        bolt.armorPen = this.armorPen;
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(bolt, 'projectiles');
      }
    } else if (ai0 === 180) {
      // 满蓄发 461 光束（:63566-63578 [1456] / :67526-67538 [1457]，(int)(damage×1.5) 截断）——魔耗已由 flag3@180 支付。
      // ★原版无"已发"守卫：(int)ai0==180 在 0.4 步进下停 2 拍（fround 实证 451/452）
      // 且两拍均瞄准拍 → 过载首蓄会连发 2 根（ai[1] 被后根覆写,前根成孤儿——原版如此,
      // 照录）；本槽 this.beam 只留后根引用
      const beam = new BlasterBeam(Math.trunc(this.damage * 1.5), this.knockback);
      beam.parent = this;
      beam.critChance = this.critChance;
      beam.armorPen = this.armorPen;
      this.beam = beam;
      (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(beam, 'projectiles');
    } else if (this.beam?.dead) {
      this.dead = true; return;      // 光束灭即亡（:63580-63587 [1456] / :67540-67546 [1457]，flag5 拍才查）
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(460);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(Math.atan2(this.dirY, this.dirX));
    if (this.dirX < 0) ctx.scale(1, -1);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }
}
