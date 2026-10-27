// 美杜莎之首 3269 → 弹 535（挂首）/ 536（凝视束）整套模型。
// 原版链：Item.cs:30314-30331（channel=true/autoReuse/reuseDelay10/UseSound=null/
//   mana15）+ ItemCheck_PayMana_ShouldSkipManaUse Player.cs:53329-53331
//   （type==3269 直接 return true =【使用时不扣魔】——魔在 AI 每 volley 经
//   CheckMana(pay:true) 扣）+ AI_100_Medusa Projectile.cs:45296-45454：
//   · 挂首：zero 偏移 (dir×6, −14×gravDir)、timeLeft=3 维持、帧 0-7 待机 /
//     ai[0]>0 转 8-11 发射组帧@5t、direction 跟鼠标、Center 吸附玩家手持位、
//     player.heldProj=whoAmI、SetDummyItemTime(2)、!player.channel → Kill；
//   · volley 门：!flag2(冷却完) 或 ai[0]%num==0，num=(int)(60×GetSlowMagicScalar)/4
//     ——蓝空削弱(slowMagicUse → ×2.5)直接拉长喷吐间隔（:45301/:47444-47451）；
//   · 320px 内 CanHitLine 敌取最近 ≤3 目标 → 每目标生成 536 束（NewProjectile 于
//     头位、Center 直写敌心、Damage() 立即结算后 damage=0 = 束为纯视觉载体，
//     伤害在生成瞬间落账）+ 4 条随机向散逸 536；ai[0]=60 重臂；无目标不扣魔；
//   · Lighting(0.9,0.75,0.1)（R18 光照域,登记不实施）。
// ★文件边界：发射链挂点/扣魔点在 Game.ts case 'magic'（R26 蓝队分区）——本类由
//   Arrow 出生自校正把通用 Arrow-535 首子步转换为本实体；上游误扣魔以"首轮已预付"
//   +重复施法退款两机制在实体侧收敛到原版经济（见 MEDUSA_REFUND_LEGACY_CHARGE）。
// ★通用湿段定谳（2026-09-06 溅花缺口杂项批）：535 MedusaHead【豁免】——SetDefaults
//   :6097-6108（18×18/aiStyle100/tileCollide=false/drawLayer 8/usesOwnerLight）尾
//   ignoreWater=true@:6107 → :16901 整段门直跳、wet 恒 false,不接
//   projectileWetSection（N/A）。凝视束 536（本类 beams=纯视觉载体,伤害生成拍落账）
//   原文本就是即时 Damage 形态,无独立弹体湿段面。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import type { Player } from './Player';
import { projSprite, projFrameCount } from './Arrow';
import { canBeChasedBy, applyBannerDamageDealt } from './projTargets';
import { rollVanillaHitCrit } from './proj1457';
import { canHitLine } from '../physics/LineOfSight';
import { ghostHealProc, ghostHurtOnHit, playerHasGhostHurt, snapshotVanillaGate, vanillaGateRejected } from './SpectreSoulProj';   // ★BJ382 凝视束 proc 单源（★清偿刀 T 门位快照单源;★BJ424-T3 补 ghostHurt 漏斗面）
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424-T3 星云套装 on-hit 单源（自持命中环面收编）
import { itemCombat } from '../data/vanillaItemCombat';
import { prefixStat } from '../data/vanillaPrefixes';
import { damageVarRoll } from '../stats/DamageVar';   // ★BJ723-C M02：535/536 凝视束 DV 首掷（:12970）

type MedusaEnemy = {
  x: number; y: number; w: number; h: number; id: number; dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
};

/** 凝视束存续（localAI[0] 20t：alpha Lerp(0,255,t/20) 渐显、≥20 Kill :33783-33790） */
const BEAM_LIFE = 20;

/** 在场唯一挂首（Game autoReuse 持按每 useTime 重发一枚通用 Arrow-535——转换时
 *  已有活首则新弹让位自杀，并把该笔重复上游扣魔退还，等价原版 channel 单例语义）*/
let activeMedusa: MedusaHeadProj | null = null;

export class MedusaHeadProj extends Entity {
  readonly projId = 535;
  w = 18; h = 18;                                    // SetDefaults :6096-6108
  damage: number;
  knockback: number;
  critChance: number;
  armorPen: number;
  // ★BJ497③（2026-10-04）ctor critBonus 死形参摘除（BJ496① 登记清偿,BJ494⑥ 钉死面）
  //  ——volley 掷面已迁 rollVanillaHitCrit（:211）,形参/字段/`void critBonus` 三层全摘。
  dead = false;
  /** ★BJ382：PVE 受理命中计数形状（projPveNumHits PVP 读口对齐）。volley 的原版
   *  结算载体是逐目标独立生成的 536 凝视束（每弹 numHits SetDefaults :706 起始 0
   *  ⇒ proc 恒 0 档率 0.20,逐弹独立）——本实体级字段不承载 536 逐弹账,PVP 读口
   *  形状完备即可。
   *  ★BJ385 勘误（BJ382 登记债注销,亲读反编译定谳）："535 本体有 penetrate=-1
   *  接触伤害面"不成立——Damage() 总闸 Damage_CanDealDamage 的排除表
   *  【显式列出 type == 535】（Terarria1457/Projectile.cs:12463;1456 :11782 同位）,
   *  Damage_PVE/PVP/EVP 三通道整跳 ⇒ 本体零接触伤害面,SetDefaults penetrate=-1
   *  （:6100）是惰性数据位。原版伤害唯一载体 = AI_100 volley 逐目标 NewProjectile(536)
   *  后【立即 Damage()】再 damage=0（:45413-45415）= 本仓 volley hurt 即时落账同相;
   *  本体接触 proc 无此物,无 proc 可言。零修刀（★指纹全等=零修刀判据同族） */
  pveNumHits = 0;

  /** ★R28 接线开关：Game.ts case 'magic' 的 3269 ShouldSkipManaUse 分流已落地
   *  （:11310 medusaFree——上游不再扣蓝）→ 置 false,退款/预付两机制全部旁路 */
  static MEDUSA_REFUND_LEGACY_CHARGE = false;

  private readonly owner: Player;
  /** 冷却计数 ai[0]（volley 后 60；>0 = flag2 发射组帧 + soundDelay 循环 :45304） */
  private ai0 = 0;
  private frame = 0;
  private frameCtr = 0;
  private direction = 1;
  /** timeLeft=3 维持（!player.dead 直写 :45310；channel 断/死亡 3t 后消亡） */
  private life = 3;
  /** 首轮 volley 视为已付（上游 Game.ts 通用链已扣本次施法魔——ShouldSkipManaUse
   *  :53329 缺位的等价补偿；R26 分流落地后构造传 false） */
  private prepaidFirstVolley = true;
  /** 536 凝视束视觉态（头→目标端点；伤害已在生成拍经 hurt 即时落账） */
  private beams: Array<{ x2: number; y2: number; age: number; mag: number }> = [];

  constructor(owner: Player, damage: number, knockback: number,
    critChance: number, armorPen: number) {
    super();
    this.owner = owner;
    this.damage = damage;
    this.knockback = knockback;
    this.critChance = critChance;
    this.armorPen = armorPen;
    if (activeMedusa && activeMedusa.owner !== owner) {
      activeMedusa = null;                           // 旧世界/旧主人残留 → 失效清位
    }
    if (activeMedusa && !activeMedusa.dead) {
      // 重复转换：退还本次 autoReuse 重扣的上游魔（同公式），自身让位
      if (MedusaHeadProj.MEDUSA_REFUND_LEGACY_CHARGE) {
        activeMedusa.refundLegacyCharge();
      }
      this.dead = true;                              // 不接管，旧首继续 channel
      return;
    }
    activeMedusa = this;
    this.prepaidFirstVolley = MedusaHeadProj.MEDUSA_REFUND_LEGACY_CHARGE;
  }

  /** 上游扣魔精确复算并退还（Game.ts :11243 同式：词缀 mcst(I:562 round) +
   *  饰品加算折扣 + 乘区；base= itemCombat(3269).mana=15） */
  private refundLegacyCharge(): void {
    const base = itemCombat(3269)?.mana ?? 15;
    const held = this.owner.inv.heldItem();
    const mcst = held?.prefix ? prefixStat(held.prefix).mcst : 1;
    const eq = this.owner.equipStats as { manaCostOff?: number; manaCostMul?: number };
    const cost = Math.max(0, Math.trunc(Math.round(base * mcst)
      * (1 - (eq?.manaCostOff ?? 0)) * (eq?.manaCostMul ?? 1)));
    this.owner.mana += cost;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.dead) return;
    const p = this.owner;
    // ---- 消亡门（:45310 timeLeft=3 维持 / :45417 !player.channel → Kill）----
    // channel 代理双信号：inputUseItem（Game :5026 注入的左键电平——★实测为边沿量,
    // 首击消费后即回落）OR useTime>0（autoReuse 持按期每周期重置、松手后归 0 恒定
    // ——持按时零档 ≤1 tick < timeLeft 3 不累积；松手后恒零 → 3t 消亡,近似原版
    // 松手即断）
    const channelAlive = !p.dead
      && (p.inputUseItem === true || ((p as unknown as { useTime?: number }).useTime ?? 0) > 0);
    if (channelAlive) {
      this.life = 3;
      p.onChannelManaHold?.();                       // channel 期回蓝惩罚窗钉住（:1895）
    } else if (--this.life <= 0) {
      this.retire();
      return;
    }
    // ---- 凝视束老化（localAI[0]++ ≥20 Kill :33783-33790）----
    for (let i = this.beams.length - 1; i >= 0; i--) {
      if (++this.beams[i].age >= BEAM_LIFE) this.beams.splice(i, 1);
    }
    // ---- 冷却计数 + 帧（:45312-45340）----
    const flag2 = this.ai0 > 0;                      // flag2 取自减前态（:45303）
    if (this.ai0 > 0) this.ai0--;
    if (flag2) {
      if (this.frame < 8) this.frame = 8;
      if (++this.frameCtr >= 5) { this.frameCtr = 0; if (++this.frame > 11) this.frame = 8; }
    } else if (++this.frameCtr >= 5) {
      this.frameCtr = 0;
      if (++this.frame > 7) this.frame = 0;
    }
    // ---- 挂首吸附（:45443 Center=RotatedRelativePoint(...)−velocity；body-frame
    //      全式依赖 OffsetsPlayerOnhand,本仓以 MountedCenter+zero 偏移近似,登记）----
    this.direction = Math.abs(p.aimWX - p.cx) > 2 ? Math.sign(p.aimWX - p.cx)
      : (p.facing ?? 1);                             //（:45343-45348 direction 跟鼠标）
    const gd = (p.gravDir ?? 1);
    this.x = p.cx + this.direction * 6 - this.w / 2;
    this.y = p.cy - 14 * gd - this.h / 2;
    // ---- volley 门（:45399 `!flag2 || ai[0] % num == 0`）----
    // num = (int)(60×GetSlowMagicScalar)/4（:45301）——slowMagicUse 时 ×2.5 =
    // 37t 间隔（蓝空削弱直接拉长喷吐节奏）;可选链容忍 R26 重构中的通道
    const scalar = (p as { getSlowMagicScalar?: () => number }).getSlowMagicScalar?.() ?? 1;
    const num = Math.max(1, Math.floor((60 * scalar) / 4));
    if (!(this.ai0 === 0 || this.ai0 % num === 0)) return;
    // ---- 目标搜集（:45387-45397 门 + :45408-45419 列表排序取近 ≤3）----
    const hx = this.cx, hy = this.cy;
    const cands: Array<{ e: MedusaEnemy; d: number }> = [];
    for (const ent of game.enemies()) {
      const e = ent as unknown as MedusaEnemy;
      if (e.dead) continue;
      const d = Math.hypot(e.x + e.w / 2 - hx, e.y + e.h / 2 - hy);
      if (d >= 320) continue;                        // Distance(nPC.Center) < 320f
      if (!canBeChasedBy(ent)) continue;   // CanBeChasedBy
      if (!canHitLine(game.world.store, e.x, e.y, e.w, e.h, hx, hy, 0, 0)) continue;
      cands.push({ e, d });
    }
    if (cands.length === 0) return;                  // 无目标不进计费段（:45393 flag3）
    cands.sort((a, b) => a.d - b.d);                 // _medusaTargetComparer 距离序
    // ---- 计费（:45391 CheckMana(mana, pay:true)）----
    // ManaV2 语义走 Player.checkMana 端口：蓝够扣魔;不足 statMana=0+slowMagicUse=true
    // （下一拍 GetSlowMagicScalar ×2.5 → 间隔拉长 = 原版蓝空削弱闭环）
    if (this.prepaidFirstVolley) this.prepaidFirstVolley = false;
    else {
      const base = itemCombat(3269)?.mana ?? 15;
      const held = p.inv.heldItem();
      const mcst = held?.prefix ? prefixStat(held.prefix).mcst : 1;
      const eq = p.equipStats as { manaCostOff?: number; manaCostMul?: number };
      const cost = Math.max(0, Math.trunc(Math.round(base * mcst)
        * (1 - (eq?.manaCostOff ?? 0)) * (eq?.manaCostMul ?? 1)));
      p.checkMana(cost);
    }
    // ---- 凝视束 + 即时伤害落账（:45420-45435：Damage() 立即结算后 damage=0）----
    let angSum = 0;
    for (let k = 0; k < cands.length && k < 3; k++) {
      const t = cands[k].e;
      const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
      angSum += Math.atan2(tcy - hy, tcx - hx);
      // ★BJ496①（2026-10-04）爆面掷率收编（BJ493③ 661 先例,箭域 617/659 同批）：旧
      //  `||` 面把 0.04 路由门误当 4% 平率消费——volley 伤害载体=逐目标独立 536 凝视束
      //  出生即 Damage()（:45420-45435）⇒ 掷=Damage_PVE :12915-12927 magic 臂（536 数
      //  据面 magic;本实体 projId=535 同 magic 旗同掷面,同值形）,rollVanillaHitCrit
      //  命中拍动态（owner 装配+:25712 持械折入）;critChance≤0 关断钉保留。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // ★BJ382：幽灵兜帽吸血 proc（Projectile.cs:13877-79）——原版 volley 结算载体 =
      //  逐目标 NewProjectile(536) 后立即 Damage()（AI_100 :45420-45435,束为纯视觉
      //  载体 damage=0）;536 数据面 magic（vanilla-projectiles.json）⇒ 原版本就吸血,
      //  本仓漏接。每目标一发独立 536 ⇒ numHits 前值恒 0（逐弹 SetDefaults :706 起始 0,
      //  同拍三跳全 0 档）;proc 在 :14263 numHits++ 前、拒收不 proc 不计数
      //  ★X2-D1（2026-09-29,BJ393 判据推广）：受理面谓词 !vanillaGated——Enemy.hurt
      //  返真=「本拍击杀」（Enemy.ts:15033）,返假三族=门拒（dead:13971/iframes:13972/
      //  dontTakeDamage:13978）+血尽级联（:14369 族）+普通未致命尾档（:15037）;
      //  原版 proc/numHits++ 在受理面无死亡复查 → 门拒不 proc 不计数,非门拒照 proc。
      //  旧「hurt 返真」=击杀位判据对非致死命中整面不 proc（吸血 under-fire）,退役。
      // ★清偿刀 T（X4-债12,2026-09-29）：门位读【前置快照】（读侧单源,判据=「进
      //  hurt 前状态」）。旧后置读两源污染：①受理写支（Enemy.ts:14297 pierce=0 写
      //  10t;536 vanilla 写梯尾档 10t 同值,写面 1:1）→ 受理拍读恒真 → proc 真机恒跳
      //  （mock hurt 无写支故测试绿;同刀 R「旧 pierce=0 受理写 10」判谳）；②死亡转换
      //  写支（Enemy.ts:14421 四塔血尽转演出写 iframes=2）→ 致死命中拍误判门拒。
      const gate = snapshotVanillaGate(t);
      // ★BJ723-C M02（2026-10-26）：DamageVar 首掷（Projectile.cs:12970——535/536 美
      //  杜莎凝视束逐目标独立掷 ±15% 31 档离散+luck 重掷,原版载体=逐目标出生即
      //  Damage() 的 536 束（每目标一发 ⇒ 每发各自 DV）;BJ716-A Arrow 主环同式,
      //  crit ×2 后置=StrikeNPC 内序）
      const dmgMed = damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
      // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)——dmgMed 未翻倍直传
      t.hurt(applyBannerDamageDealt(game, t, dmgMed), 0, 0, game, this.armorPen, crit, 0, true);   // fromPlayer=DPS 计
      const vanillaGated = vanillaGateRejected(gate);
      if (!vanillaGated) {
        ghostHealProc(game, 536, 0, t);
        // ★BJ424-T3 魔法命中漏斗面收编：ghostHurt :13881 / nebula :13885 与 ghostHeal
        //  :13877 同块同受理面（结算载体 536 数据面 magic ⇒ 凡走本面两引擎都该触发）。
        //  原版形态（AI_100 :45424-45431）：536 出生即 Center=受害者 Center + damage=num3
        //  → Damage() 当拍结算 ⇒ ghostHurt 候选窗锚 = 536 盒（10×10,SetDefaults :5360）
        //  钉在受害者 Center;projDamage = 弹基伤 num3（crit 在 Damage() 内掷,不改 damage 字段）;
        //  nebula projDirX = v.X（束向 = 受害者心−持弹心）。
        if (playerHasGhostHurt(game.player)) {
          const v424 = t as never as { vanillaId?: number | null; lastStrikeDealt?: number;
            maxHp?: number; def?: { lifeMax?: number } };
          ghostHurtOnHit(game,
            { magic: true, projDamage: this.damage,
              projX: tcx - 5, projY: tcy - 5, projW: 10, projH: 10,
              ownerCx: game.player.cx, ownerCy: game.player.cy },
            { x: t.x, y: t.y, w: t.w, h: t.h,
              cx: tcx, cy: tcy,
              vanillaId: v424.vanillaId,
              lifeMax: v424.maxHp ?? v424.def?.lifeMax,
              dealt: v424.lastStrikeDealt ?? 0 });
        }
        nebulaBoosterOnHit(game,
          { projId: 536, projDirX: tcx - hx },
          { x: t.x, y: t.y, w: t.w, h: t.h,
            cx: tcx, cy: tcy,
            vanillaId: (t as never as { vanillaId?: number | null }).vanillaId,
            lifeMax: (t as never as { maxHp?: number; def?: { lifeMax?: number } }).maxHp
              ?? (t as never as { def?: { lifeMax?: number } }).def?.lifeMax,
            dealt: (t as never as { lastStrikeDealt?: number }).lastStrikeDealt ?? 0 });
      }
      this.beams.push({ x2: tcx, y2: tcy, age: 0, mag: 1 });
    }
    // ---- 4 条随机向散逸束（:45439-45446：1/4 全圆随机,其余 UnitX.RotatedByRandom(π)
    //      再旋 avgAngle;×(200,50) 椭圆 ×(0.3..1)) ----
    const avgAng = angSum > 0 || cands.length > 0 ? angSum / Math.min(3, cands.length)
      : (this.direction === 1 ? 0 : Math.PI);
    for (let l = 0; l < 4; l++) {
      let ax: number, ay: number;
      if (Math.random() < 0.25) {
        const full = Math.random() * Math.PI * 2;
        ax = Math.cos(full); ay = Math.sin(full);
      } else {
        const half = (Math.random() * 2 - 1) * Math.PI;
        const bx = Math.cos(half), by = Math.sin(half);       // UnitX.RotatedByRandom(π)
        const ca = Math.cos(avgAng), sa = Math.sin(avgAng);
        ax = bx * ca - by * sa; ay = bx * sa + by * ca;
      }
      const m = 0.3 + Math.random() * 0.7;
      this.beams.push({ x2: hx + ax * 200 * m, y2: hy + ay * 50 * m, age: 0, mag: 0.55 });
    }
    this.ai0 = 60;                                   //（:45434 尾重臂,180 覆盖语义同值）
  }

  private retire(): void {
    this.dead = true;
    if (activeMedusa === this) activeMedusa = null;
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    // ---- 536 凝视束（DrawProj :32444-32462：贴图沿速度向拉伸 |v| 长,alpha 渐显;
    //      ★反编译几何字面上把条带画在 head−v 侧,游戏实感为头→目标连线——按实感
    //      实现,登记两说）----
    if (this.beams.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(150, 230, 120, 0.85)';
      ctx.lineWidth = 3;
      for (const b of this.beams) {
        const fadeIn = Math.min(1, b.age / 5);                 // alpha Lerp(0,255,t/20) 近似
        const fadeOut = Math.max(0, 1 - Math.max(0, b.age - BEAM_LIFE + 8) / 8);
        ctx.globalAlpha = 0.75 * fadeIn * fadeOut * (b.mag < 1 ? 0.6 : 1);
        ctx.beginPath();
        ctx.moveTo(this.cx, this.cy);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(230, 255, 200, 0.9)';
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(150, 230, 120, 0.85)';
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // ---- 535 挂首本体（frame 0-7 待机 / 8-11 发射组,spriteDirection ±direction）----
    const img = projSprite(this.projId);
    if (!img || !(img.width > 0)) return;
    const frames = projFrameCount(this.projId);
    const fh = img.height / Math.max(1, frames);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    if ((this.owner.gravDir ?? 1) < 0) ctx.rotate(Math.PI);     //（:45444-45446）
    if (this.direction < 0) ctx.scale(-1, 1);                   // spriteDirection 镜像
    ctx.drawImage(img, 0, this.frame * fh, img.width, fh,
      -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
  }
}
