// ★R2-06⑤（蓝队二轮）甲虫套装蓄能实扣模型（替代时间蓄能近似）。
//
// vanilla 计数域（Terarria1457/Terraria/Player.cs）：
//  · 命中加账【PVE 近战挥击】ApplyNPCOnHitEffects :44840-44
//      if (beetleOffense & !npc.immortal) { beetleCounter += dmgDone; beetleCountdown = 0; }
//    dmgDone = StrikeNPC 返回值 = 本拍实扣 HP（仓内对应 Enemy.lastStrikeDealt）。
//  · 命中加账【PVE 近战弹幕】Damage_PVE :13918-13933（★BJ745 A15,issue#35 补齐）
//      if (melee && beetleOffense && (!targetNPC.immortal | flag9)) {
//        orbs==0 → counter += num41×3; orbs==1 → ×2; else ×1; countdown = 0; }
//    num41 = StrikeNPC 返回实扣;弹幕比挥击多按当前球数折算（0/1/≥2 球 = ×3/×2/×1
//    ——0 球蓄得快、3 球维持慢）;whip 非 melee 旗不吃本面（:13688 (melee||IsAWhip)
//    是浸剂/彩纸块 ≠ 本面裸 melee 门）。
//  · 命中加账【PvP】ItemCheck_MeleeHitPVP :44456-44460
//      if (beetleOffense) { beetleCounter += num2; beetleCountdown = 0; }
//  · 逐 tick 消费 ApplySetBonus_BeetleDamage :16619-16691（进攻套在身每 tick）：
//      beetleCounter -= 3f;
//      beetleCounter -= beetleCountdown / 20;     // int/int 截断
//      beetleCountdown++;
//      if (<0) = 0;
//      clamp ≤ 400+1200+3600+1200 = 6400;
//      num = counter>5200?3 : >1600?2 : >400?1 : 0   （AddBuff 100/99/98 层）
//      if (num < beetleOrbs) beetleCountdown = 0;
//      else if (num > beetleOrbs) beetleCounter += 200f;
//      （AddBuff(97+num,5)/DelBuff 清层为 buff 面的维持管道，可观察结果 = 球数）
//  · 防御套独立臂 ApplySetBonus_BeetleDefense :16596-16617：
//      beetleCounter++；≥180 且 orbs<3 → AddBuff(95+orbs)、counter=0（满 3 钉 180）
//  · 受击减球 Player.Hurt :38608-38623：beetleDefense && orbs>0 → endurance += .15n、
//      orbs--、DelBuff 95-97、orbs>0 再 AddBuff(95+orbs-1)、beetleCounter=0f。
//  · 套离身：UpdateArmorSets_Always_Beetle :16556-16562 counter=0 + UpdateBuffs 双族
//      守卫同帧 DelBuff/orbs=0（无断供衰减窗——首版"5t 维持窗"模型系误建，已拆）。
//
// ★BJ745 A16（issue#35,2026-11-01）buff 单源重构——原版 beetleOrbs 的真源是【buff 栏】
//  而非持久字段：每拍 ResetEffects(:18617) orbs=0 → UpdateBuffs(:10430-59/:10494-10526)
//  从 95-100 档 buff 重派生 orbs（族守卫读【上拍】族旗——:25815-16 清位在 UpdateBuffs
//  之后）→ :25815-16 清族旗 → UpdateArmorSets 梯子 AddBuff 钉【下拍】档（梯子从不
//  直写 orbs）。换壳胸甲（满 Might 3 → 防御壳）逐拍相（原版实测锚）：拍1=3（buff 在
//  栏+上拍旗 offense ✓,防御梯子 orbs=3 满 3 只钉 counter=180）/拍2=0（族旗已 defense
//  →守卫剥 Might3+orbs=0;防御梯子 AddBuff(95)）/拍3=1（UpdateBuffs 从 95 派生）。
//  旧实现 orbs 持久字段直写 = 拍1 起恒 3 且钉防御 3 层（减伤过高）。
//  连带：Hurt 受击减球（Player.ts 甲虫步）改走 onHurtConsumeOrb 同步维护 buff 栏
//  （旧只 orbs-- 不动 buff → 下拍 Phase1 从陈旧档派生回涨）。
//  壳族 95-97 由 UpdateBuffs :10432 每拍 buffTime=5 重钉（无套也存活到守卫剥）;
//  猛攻族 98-100 无重钉位,靠进攻梯子每拍 AddBuff 维持。

// buff 图标维持：壳族=UpdateBuffs 效果循环直写 buffTime[j]=5（Player.cs:10432）
// + 换档立删旧档（:10434-10452）；猛攻族=ApplySetBonus 每帧 AddBuff(97+num,5)
// （:16663-16675）+ 清非当档（:16686-16696）。noTimeDisplay[95-100]（Main.cs:9232-9237）
// 恒无字、buffNoSave（:9148-9152）不落盘，图标/数值由本 meter 单一来源驱动。

import { BuffType } from '../stats/Buffs';

/** 档位↔buff 映射（:16636 AddBuff(95+beetleOrbs,5) 壳族 / :16678 AddBuff(97+num,5) 猛攻族） */
const BEETLE_ENDURANCE_TIERS = [BuffType.BeetleEndurance1, BuffType.BeetleEndurance2, BuffType.BeetleEndurance3] as const;
const BEETLE_MIGHT_TIERS = [BuffType.BeetleMight1, BuffType.BeetleMight2, BuffType.BeetleMight3] as const;

/** 单实例状态（挂在玩家对象上；本模块无 DOM/引擎依赖）。 */
export class BeetleMeter {
  /** beetleCounter（float 字段 :881） */
  private counter = 0;
  /** beetleCountdown（int 字段 :883） */
  private countdown = 0;
  /** 上拍族旗（Player.beetleOffense/beetleDefense——UpdateArmorSets 末置位,
   *  下拍 UpdateBuffs 族守卫消费;none=双旗皆清（卸装/无套拍） */
  private lastFamily: 'offense' | 'defense' | 'none' = 'none';

  private readOrbs(p: BeetleHost): number {
    return p.beetleOrbs ?? 0;
  }
  private writeOrbs(p: BeetleHost, v: number): void {
    if ((p.beetleOrbs ?? 0) !== v) p.beetleOrbs = v;
  }

  /** PVE 挥击/PvP 命中加账（:44840-44/:44456-60——×1 无球数折算）。immortal 门由
   *  调用方按 !npc.immortal 传入 pass=true 才记账。 */
  registerHit(dmgDone: number, offenseSet: boolean): void {
    if (!offenseSet) return;
    this.counter += dmgDone;
    this.countdown = 0;
  }

  /** ★BJ745 A15：PVE 近战弹幕命中加账（Projectile.cs:13918-13933）——orbs 0/1/≥2
   *  → ×3/×2/×1（弹幕面专属折算,挥击面 ×1 不变）。immortal 门调用方传入。 */
  registerProjHit(dmgDone: number, offenseSet: boolean, orbs: number): void {
    if (!offenseSet) return;
    this.counter += dmgDone * (orbs === 0 ? 3 : orbs === 1 ? 2 : 1);
    this.countdown = 0;
  }

  /** ★BJ745 A16：Hurt 受击减球（Player.cs:38608-38623 调用侧桥）——orbs-- 同步
   *  剥 95-97 族再按余量钉档（orbs>0 → AddBuff(95+orbs-1)）,counter=0。 */
  onHurtConsumeOrb(p: BeetleHost): void {
    const o = this.readOrbs(p);
    if (o <= 0) return;
    this.writeOrbs(p, o - 1);
    this.counter = 0;
    const buffs = (p as unknown as { buffs?: BuffsLike }).buffs;
    if (!buffs) return;
    for (const t of BEETLE_ENDURANCE_TIERS) buffs.remove(t);
    if (o - 1 > 0) buffs.apply(BEETLE_ENDURANCE_TIERS[o - 1 - 1], 5 / 60);
  }

  /** 每 tick 梯子（原版 Update 三段合并调度：UpdateBuffs 派生 → 族旗翻转 →
   *  ApplySetBonus 梯子;player 宿主须暴露 beetleOrbs 数值面 + buffs（可缺省）。 */
  tick(p: BeetleHost, offenseSet: boolean, defenseSet: boolean): void {
    const buffs = (p as unknown as { buffs?: BuffsLike }).buffs;
    // —— Phase 1：UpdateBuffs 派生（ResetEffects :18617 orbs=0 → 95-100 档位派生 →
    //    族守卫读上拍族旗 :10430-59/:10494-10526,两族独立逐槽剥）——壳族 95-97
    //    在栏即重钉 5t（:10432,无套也存活到守卫剥/5t 自尽）——
    let mightOrbs = 0;
    let endurOrbs = 0;
    if (buffs) {
      if (buffs.has(BEETLE_MIGHT_TIERS[2])) mightOrbs = 3;
      else if (buffs.has(BEETLE_MIGHT_TIERS[1])) mightOrbs = 2;
      else if (buffs.has(BEETLE_MIGHT_TIERS[0])) mightOrbs = 1;
      if (mightOrbs > 0 && this.lastFamily !== 'offense') {
        buffs.remove(BEETLE_MIGHT_TIERS[mightOrbs - 1]);   // :10521-26 守卫剥
        mightOrbs = 0;
      }
      if (buffs.has(BEETLE_ENDURANCE_TIERS[2])) endurOrbs = 3;
      else if (buffs.has(BEETLE_ENDURANCE_TIERS[1])) endurOrbs = 2;
      else if (buffs.has(BEETLE_ENDURANCE_TIERS[0])) endurOrbs = 1;
      if (endurOrbs > 0) {
        buffs.apply(BEETLE_ENDURANCE_TIERS[endurOrbs - 1], 5 / 60);   // :10432 重钉
        if (this.lastFamily !== 'defense') {
          buffs.remove(BEETLE_ENDURANCE_TIERS[endurOrbs - 1]);        // :10454-59 守卫剥
          endurOrbs = 0;
        }
      }
    }
    // 双族同栏=退化态（原版槽序未定,本仓单族不变量下不可达）——might 优先
    const orbs = mightOrbs > 0 ? mightOrbs : endurOrbs;
    this.writeOrbs(p, orbs);
    // —— Phase 2：族旗翻转（:25815-16 清位 → UpdateArmorSets ApplySetBonus 置位）——
    this.lastFamily = offenseSet ? 'offense' : defenseSet ? 'defense' : 'none';
    // —— Phase 3：梯子（ApplySetBonus_Beetle*——AddBuff=钉档,orbs 不直写）——
    if (offenseSet) {
      // ApplySetBonus_BeetleDamage :16622-16691
      this.counter -= 3;
      this.counter -= Math.trunc(this.countdown / 20);
      this.countdown++;
      if (this.counter < 0) this.counter = 0;
      const CAP_TOTAL = 400 + 1200 + 3600 + 1200;
      if (this.counter > CAP_TOTAL) this.counter = CAP_TOTAL;
      let num = 0;
      if (this.counter > 400 + 1200 + 3600) num = 3;
      else if (this.counter > 400 + 1200) num = 2;
      else if (this.counter > 400) num = 1;
      if (num < orbs) this.countdown = 0;          // :16678-16680 掉层重置消散计数
      else if (num > orbs) this.counter += 200;    // :16682-16684 升层补贴
      // AddBuff(97+num,5) + 清非当档（:16666-75/:16686-96）
      if (buffs && num > 0) {
        for (const t of BEETLE_MIGHT_TIERS) if (t !== BEETLE_MIGHT_TIERS[num - 1]) buffs.remove(t);
        buffs.apply(BEETLE_MIGHT_TIERS[num - 1], 5 / 60);
      } else if (buffs && num === 0) {
        for (const t of BEETLE_MIGHT_TIERS) buffs.remove(t);   // num=0 无当档（:16686 守卫 num==orbs≤0 早退前清）
      }
    } else if (defenseSet) {
      // ApplySetBonus_BeetleDefense :16596-16617：counter<180 无 AddBuff（壳族靠
      // Phase1 的 :10432 重钉存活,原版同构——buff 不因梯子歇拍而过期）
      this.counter++;
      const T = 180;
      if (this.counter >= T) {
        if (orbs > 0 && orbs < 3 && buffs) {
          for (const t of BEETLE_ENDURANCE_TIERS) buffs.remove(t);   // DelBuff 95-96 低档族（:16605-09）
        }
        if (orbs < 3) {
          if (buffs) buffs.apply(BEETLE_ENDURANCE_TIERS[orbs], 5 / 60);   // AddBuff(95+orbs,5)（:16611）
          this.counter = 0;
        } else {
          this.counter = T;                        // 满 3 钉住（不累计溢出）
        }
      }
    } else {
      // 双套不在身：UpdateArmorSets_Always_Beetle :16556-16562 只清 counter——
      // buff 栏不剥（下拍 Phase1 族守卫删,原版一拍滞后面同构）
      this.counter = 0;
    }
  }

  stateForTest(): { counter: number; countdown: number; lastFamily: 'offense' | 'defense' | 'none' } {
    return { counter: this.counter, countdown: this.countdown, lastFamily: this.lastFamily };
  }
}

interface BuffsLike {
  has(t: number): boolean;
  apply(t: number, durationSec: number): void;
  remove(t: number): void;
}

export interface BeetleHost {
  beetleOrbs?: number;
}
