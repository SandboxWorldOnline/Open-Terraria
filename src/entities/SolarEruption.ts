// 日耀喷发 3473 → 611 链鞭 + 612 爆焰（AI_075 共享壳下 611 专属段 :63918-63956 +
// 出生链 Player.cs:48059-48063 + 绘制 Main.cs:32061-32115 + AI_117 爆焰 :33299-33320）：
//   611：首帧 Item116；alpha −42/t 渐显；localAI[0]=初速角；ai[1]=出生抖动 ±π/8；
//     旋进 spinningpoint = (num50×(ai0/30×2π−π/2)).ToRotationVector2，Y×sin(ai[1])
//     （ai[1]≤0 翻两处），再旋 localAI[0]；ai[0]<30 每 tick velocity += 48×spin
//     （链鞭甩出）否则 Kill。命中 AddBuff 189(Daybreak) 300t + 每 4t 一发 612
//     （落点敌中心，ai[2]=0.85+rand×1.15 缩放）；免疫 4t。
//   611 绘制 = 链条拼装：帧头 (0,2,30,40) 旋转 vel+π、origin(15,16)−(0,4)；
//     身段 (0,68,30,18) 沿 vel 向平铺至 (|vel|+16−40)px；第二层 (0,46,30,18)
//     （本仓单层近似，双层视觉差异小备案）。
//   612（AI_117）：scale = ai[1]（0.85+rand×1.15 起，每 tick +0.01）；帧 3t/帧 ×5；
//     ai[0]≥15 消亡；命中 AddBuff 189。贴图 52×260 = 5 帧 52px。
// ★通用湿段定谳（2026-09-06 武器弹簇批）：611/612 SetDefaults（:6569-6584/:6586-6596）
//   ignoreWater=true（611 :6581 / 612 :6593）= 豁免——P.cs:16903 湿段整段门不开,
//   溅花/湿旗/水阻尼全不适用,不接 projectileWetSection。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { projSprite } from './Arrow';
import { playerCanHitEnemy, applyBannerDamageDealt, hitTownNpcs } from './projTargets';   // ★BJ729-A（D1 B19）：城镇 voodoo 靶
import { damageVarRoll } from '../stats/DamageVar';
import { rollVanillaHitCrit } from './proj1457';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { applyBuffTicks } from './projStatus';

/** Daybreak（BuffType 189）——611/612 命中授予 300t（:10703-10708）。
 *  ★BJ678（2026-10-14）：原版 611/612 两处 AddBuff(189,300)（Projectile.StatusNPC
 *  :11356-11361,与 636/953 表驱动路同款施加）全过 NPC.AddBuff buffImmune 拒绝门
 *  （NPC.cs:91037 `if (buffImmune[type]) return;` + DebuffImmunitySets 表）——
 *  316 Ghost/521/533 长表族 + ImmuneToAll 37 键档不吃破晓（原版免疫）。
 *  曾私有直写 daybreakT=300 双病灶：①绕免疫门（本债）②单位错——daybreakT 消费侧
 *  为秒（Enemy.fixedUpdate -=dt;636 表路 weapons-entities 锁 5s）,裸写 300=60 倍
 *  时长。收编 = 经 applyBuffTicks 单源注入器（免疫门 + 300t→5s 换算 + AddBuff
 *  max 合并,与 636/953 表驱动路同一注入点;直投零掷,chance 掷不存在）。 */
function applyDaybreak(e: Record<string, number>): void {
  applyBuffTicks(e, 189, 300);
}

export class SolarFlare extends Entity {
  w = 8; h = 8;
  damage: number;
  armorPen = 0;
  /** ai[1] 缩放基（出生 0.85+rand×1.15） */
  private sc: number;
  private ai0 = 0;
  private frame = 0;
  private frameCtr = 0;
  private hitCd = new Map<number, number>();
  dead = false;
  lightRGB: [number, number, number] | null = [0.6, 0.3, 0.05];

  constructor(x: number, y: number, damage: number, sc: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.damage = damage;
    this.sc = sc;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.ai0++;
    this.sc += 0.01;                                   // scale = ai[1]+0.01/t（:33302-33304）
    if (this.ai0 >= 15) { this.dead = true; return; }  // 3×5 帧（:33306-33309）
    if (++this.frameCtr >= 3) { this.frameCtr = 0; if (++this.frame >= 5) this.frame = 0; }
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      // ★dontTakeDamage 目标排除（:12600 同款——applyDaybreak 直写 daybreakT 在 hurt 前,终审补）
      if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || this.hitCd.has(e.id)) continue;
      const reach = 40 * this.sc;                      // 爆焰视觉半径命中盒近似
      if (!(this.cx - reach < e.x + e.w && this.cx + reach > e.x && this.cy - reach < e.y + e.h && this.cy + reach > e.y)) continue;
      // ★BJ488②（2026-10-04）612 零掷定谳（1091 零掷判例族）：SetDefaults :6586-6596
      //  对 612 【不写】melee/ranged/magic 类旗（611 才有 melee :6575）→ 三类掷 :12915-27
      //  逐臂 `if (melee && …)` 全不达=零掷零 RNG;旧 `Math.random() < critChance` 固定
      //  4% 档=幻影掷（BJ482② 同族病,自造伤害膨胀+掷流污染,摘除）。TimerCrit 到达性
      //  亲读：:12928 TryConsumingTimerCrit 在 `if (ownedBySomeone)` 块【内】、三类掷臂
      //  【外】=无条件消费段——612 无类旗只关三类掷,消费照达（player proj ⇒ !trap ⇒
      //  ownedBySomeone=true）。crit=消费返值单源（无前掷可并）。
      const crit = ((game.player as unknown as
        { tryConsumingTimerCrit?: (g: unknown, x: number, y: number, w: number, h: number) => boolean } | null)
        ?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false);
      // ★W03（BJ723-B 2026-10-26）：日耀喷发/爆焰两站补结算链三件——①DamageVar
      //  （:12970 逐靶掷,owner luck 正向;612 无类旗=零 crit 掷,DV 为唯一掷面）
      //  ②攻端旗乘区（:13388 bannerNpcKeyOf→bannerDamageDealtSample,与 BJ716-A
      //  R15-P1-2 三消费位同链=第 4 攻端消费位）③crit ×2 由 Enemy.hurt 防后承载
      //  （S02）——旧=直 hurt 无旗无浮动无翻倍（旗 1/1.5/2 实得 100 应 150/200）。
      const dmg = damageVarRoll(this.damage,
        ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
      // ★F3 接线（蓝队四轮）：爆焰 612 ——vanilla SetDefaults :6586-96 对其【不写】
      // 类旗（611 才有 melee :6575）⇒ 双类门对其恒拒 = 原版同真值；本站仍统一走
      // 单源入口（未来 612 若随版本翻旗自动生效），当前为无行为站位。
      const snapBonusFlare612 = projectileSnapStrikeBonus(game,
        { projId: 612 }, e.x + e.w / 2, e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg) + (snapBonusFlare612 ? snapBonusFlare612 : 0),
        0, 0, game, this.armorPen, crit, 0, true);   // ★S02 crit ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      applyDaybreak(e as unknown as Record<string, number>);
      this.hitCd.set(e.id, 4);
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(612);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const fw = 52, fh = img.height / 5;
    const dw = fw * this.sc, dh = fh * this.sc;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(this.cx, this.cy);
    ctx.drawImage(img, 0, this.frame * fh, fw, fh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
}

export class SolarEruptionWhip extends Entity {
  w = 16; h = 16;
  damage: number;
  /** ★BJ486③ vanilla 弹 id（SetDefaults 611 :6569 melee=true）——rollVanillaHitCrit 锚 */
  readonly projId = 611;
  critChance = 0.04;
  armorPen = 0;
  /** ai[1] 出生抖动（(rand−0.5)×π/4，Player.cs:48060） */
  private ai1: number;
  /** localAI[0] 初速角 */
  private aimAng: number;
  /** ai[0] 计数（30 Kill） */
  private ai0 = 0;
  /** localAI[1] 612 节流（4t） */
  private lai1 = 0;
  private alpha = 255;
  private hitCd = new Map<number, number>();
  dead = false;
  lightRGB: [number, number, number] | null = [0.5, 0.25, 0.05];

  constructor(vx: number, vy: number, damage: number) {
    super();
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.ai1 = (Math.random() - 0.5) * Math.PI / 4;
    this.aimAng = Math.atan2(vy, vx);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (this.ai0 === 0) game.playSfxFiles(['Item_116'], 1, this.cx, this.cy);
    if (this.lai1 > 0) this.lai1--;
    this.alpha = Math.max(0, this.alpha - 42);
    // 旋进（:63932-63945）
    let num50 = Math.cos(this.aimAng) >= 0 ? 1 : -1;
    if (this.ai1 <= 0) num50 *= -1;
    const ang = num50 * (this.ai0 / 30 * Math.PI * 2 - Math.PI / 2);
    let sx = Math.cos(ang), sy = Math.sin(ang);
    sy *= Math.sin(this.ai1);
    if (this.ai1 <= 0) sy *= -1;
    const ca = Math.cos(this.aimAng), sa = Math.sin(this.aimAng);
    const spx = sx * ca - sy * sa, spy = sx * sa + sy * ca;
    this.ai0++;
    if (this.ai0 < 30) {
      this.vx += 48 * spx;
      this.vy += 48 * spy;
    } else {
      this.dead = true; return;
    }
    this.x += this.vx;
    this.y += this.vy;
    // 命中：16×16 盒 + Daybreak + 4t 节流出 612
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      // ★dontTakeDamage 目标排除（:12600 同款,终审补——同上环）
      if ((ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; cx: number; cy: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || this.hitCd.has(e.id)) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,611 melee 旗）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // ★W03 同 SolarFlare 面（上注）——611 melee 旗=crit 掷+DV+旗,crit ×2 防后（S02）
      const dmg = damageVarRoll(this.damage,
        ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0);
      // ★F3 接线（蓝队四轮）：链鞭 611 数据面 melee（SetDefaults :6399-6415）→
      // 焰爆石/拍击石双支（13439-46）；加伤随暴击并入实伤参
      const snapBonusWhip611 = projectileSnapStrikeBonus(game,
        { projId: 611 }, e.cx ?? e.x + e.w / 2, e.cy ?? e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.cx ?? e.x + e.w / 2,
          cy: e.cy ?? e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg) + (snapBonusWhip611 ? snapBonusWhip611 : 0),
        Math.sign(this.vx) * 2, 0, game, this.armorPen, crit, 0, true);   // ★S02 crit ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      applyDaybreak(e as unknown as Record<string, number>);
      this.hitCd.set(e.id, 4);
      if (this.lai1 <= 0) {                            // 612 节流（:13229-13236）
        this.lai1 = 4;
        const flare = new SolarFlare(e.cx, e.cy, this.damage, 0.85 + Math.random() * 1.15);
        // ★BJ488② flare.critChance 写位随 612 零掷摘除（612 无类旗,掷面不存在;
        //   TimerCrit 由 SolarFlare 命中位动态消费,无需出生拍载体）
        flare.armorPen = this.armorPen;
        (game as unknown as { entities: { add: (en: unknown, b: string) => void } }).entities.add(flare, 'projectiles');
      }
    // ★BJ729-A（D1 B19,2026-10-27）：城镇 voodoo 靶——friendly 鞭弹 flag 巫毒窄门
    //  （:12618-12631,22 killGuide/54 killClothier）;settle 镜像敌怪臂链（DV :12970+
    //  crit 掷 melee :12915-27;Daybreak debuff 城镇面不接=近似登记[D8]）;4t 节流窗
    //  由 TownNPC.hurt iframes 承载（D3 族口径）。hitTownNpcs 单源。
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2, 'playerProj', this.projId,
      undefined, undefined, undefined, undefined,
      () => ({ dmg: damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0),
        crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
        penPercent: this.armorPen }));
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(611);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    if (this.vx === 0 && this.vy === 0) return;
    const op = Math.max(0, 1 - this.alpha / 255);
    if (op <= 0.02) return;
    const spd = Math.hypot(this.vx, this.vy);
    const vlen = spd || 1;
    const ux = this.vx / vlen, uy = this.vy / vlen;
    const rot = Math.atan2(this.vy, this.vx) + Math.PI;   // rotation = vel 角 + π
    // 帧头 (0,2,30,40)：origin(15,16)−(0,4)
    ctx.save();
    ctx.globalAlpha = op;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(rot);
    ctx.drawImage(img, 0, 2, 30, 40, -15, -12, 30, 40);
    ctx.restore();
    // 身段 (0,68,30,18) 沿 vel 平铺至 (|vel|+16−40)px（:32073-32091）
    let remain = spd + 16 - 40;
    if (remain > 0) {
      let px = this.cx + ux * 24, py = this.cy + uy * 24;
      while (remain > 0) {
        const seg = Math.min(18, remain);
        ctx.save();
        ctx.globalAlpha = op;
        ctx.translate(px, py);
        ctx.rotate(Math.atan2(this.vy, this.vx) + Math.PI);
        ctx.drawImage(img, 0, 68, 30, Math.round(seg), -15, 0, 30, Math.max(1, seg));
        ctx.restore();
        px += ux * seg; py += uy * seg;
        remain -= seg;
      }
    }
    ctx.globalAlpha = 1;
  }
}
