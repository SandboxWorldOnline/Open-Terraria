// Dead Cells 联动·蘑菇小伙伴爆炸弹（随从 1022 爆点 → 弹 1044）+ 编排粒子音三槽轮换。
// 原版锚（Terarria1458）：
//   随从 1022（AI_067 flag6,Projectile.cs:50023）爆点 :50598-50617——ai[2]>0 且
//   IsInRangeOfMeOrMyOwner(敌,60) → ai[2]=-120 + NewProjectile(Center,Zero,1044,
//   (int)(damage×1.33),knockBack×3,owner,0f,2f) + Center=玩家中心 + 小随机速度;
//   Damage_CanDealDamage :12463 (type==1022 && ai[2]>0)=false（跃击途中无接触伤）
//   弹 1044 SetDefaults Projectile.cs:9877-9891：8×8 aiStyle117 friendly alpha255
//     penetrate=-1 extraUpdates=2 timeLeft60 tileCollide=false hide=true
//     usesLocalNPCImmunity localNPCHitCooldown=-1
//   AI_117 :35094-35281：ai[1]+=0.01→scale（NewProjectile ai1=2 → scale≈2）;ai[0]++
//     ≥3×projFrames Kill;ai[0]==1 拍 width=height=(int)(52×scale)≈104 后 Damage()
//     一次性 AoE + flag60(:35099 type==1044) RequestParticleSpawn(
//     DeadCellsMushroomBoiExplosion,PositionInWorld=Center,MovementVector=Zero)
//     （:35275-35281,clientOnly:true）。extraUpdates=2 → AI 子步×3/拍,全程 ≈1 实tick。
//   Spawn_DeadCellsMushroomBoiExplosion ParticleOrchestrator.cs:2426-2516：
//     · 音三槽轮换 :2430-2440——Main.rand.Next(2)==0（50% 触发掷）→ num=rand.Next(3)
//       取 _mushBoiExplosionSounds[num]（:50 SlotId[3]），GetActiveSound 在播则 Stop,
//       PlayTrackedSound DeadCellsMushroomExplode @PositionInWorld（SoundID.cs:1112
//       vol .15,wav 2s）→ 语义 = 【并发帽 3 的随机槽置换】,非顺序轮换;
//     · 视觉 :2442-2515 BloodyExplosionParticle 红 (255,10,10,50)×0.35 + Extra_269
//       三帧 FadingParticle 旋转扩散环（本仓 spawnParticles 近似,视觉从简）
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { playerCanHitEnemy, applyBannerDamageDealt, hitTownNpcsAoeBox } from './projTargets';
import { rollVanillaHitCrit } from './proj1457';   // ★BJ494 掷率单源（:12915-12927 owner 装配）

/** 敌怪桶最小形状（Enemy.hurt 单点结算） */
type EnemyLike = {
  x: number; y: number; w: number; h: number; id: number; dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
};

/** 三槽音占用到期时刻（ms 时间轴；≡ParticleOrchestrator._mushBoiExplosionSounds:50。
 *  本仓 Sfx 无"按句柄停一次性音"API → 用占用窗近似 IsPlaying：窗内槽被命中 = 原
 *  版 stop+replay 语义不可表达,取【跳过新播】保 ≤3 并发帽（响度轮廓近似,备案：
 *  爆炸间隔通常 ≫2s wav 长,窗口碰撞罕见） */
const mushBoiExplosionSlots: number[] = [0, 0, 0];
/** deadcells_mushroom_explode.wav 时长（afinfo 实测 2.000s） */
const MUSH_BOI_EXPLODE_MS = 2000;

/**
 * Spawn_DeadCellsMushroomBoiExplosion（:2426-2516）：50% 触发掷 + 随机槽置换音 +
 * 红爆视觉近似。rng 可注入（测试驱动槽序;生产缺省 Math.random）。
 * @returns 本拍是否实际播音（测试断言用）
 */
export function requestMushroomBoiExplosion(
  game: GameHooks, x: number, y: number,
  rng: () => number = Math.random,
): boolean {
  // ---- 音三槽轮换（:2430-2440）----
  let played = false;
  if (Math.floor(rng() * 2) === 0) {                // Main.rand.Next(2) == 0（:2431）
    const slot = Math.floor(rng() * 3);             // Main.rand.Next(_mushBoiExplosion.Length)（:2433）
    const now = Date.now();
    if (now >= mushBoiExplosionSlots[slot]) {       // GetActiveSound?.IsPlaying 反相（:2434-2438）
      mushBoiExplosionSlots[slot] = now + MUSH_BOI_EXPLODE_MS;
      game.playSfxFiles(['deadcells_mushroom_explode'], 0.15, x, y);   // SoundID.cs:1112 vol .15
      played = true;
    }
    // 占用中：原版 stop 旧声+立即重播;本仓无停播 API → 跳过（≤3 并发帽语义保住,见头注）
  }
  // ---- 视觉近似（:2442-2515 BloodyExplosion+Extra_269 环）----
  game.spawnParticles(x, y, '#FF0A0A', 10, 3.2, { life: 14, damp: 0.9 });
  return played;
}

/** 测试钩：清三槽占用（跨用例隔离） */
export function resetMushroomBoiExplosionSlots(): void {
  mushBoiExplosionSlots[0] = mushBoiExplosionSlots[1] = mushBoiExplosionSlots[2] = 0;
}

// ================= 1044：蘑菇爆炸 AoE（AI_117 :35094-35281） =================

export class MushroomBoiExplosionProj extends Entity {
  readonly projId = 1044;
  w = 8; h = 8;                                       // SetDefaults :9878-9879（ai[0]==1 拍扩到 52×scale）
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  /** SetDefaults 无 melee/ranged/magic/m summon 旗——中性弹;浸剂链不适用 */
  dead = false;
  lightRGB: [number, number, number] | null = null;

  /** ai[0]（extraUpdates=2 子步折叠:首 tick 即 ai0==1 伤害拍,次拍达 Kill 门） */
  private ai0 = 0;
  /** localNPCHitCooldown=-1 ＝每敌至多一次 */
  private hitDone = new Set<number>();

  constructor(x: number, y: number, damage: number, knockback: number,
    private boom: (x: number, y: number) => void = () => {}) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.damage = damage;
    this.knockback = knockback;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.ai0++;
    if (this.ai0 === 1) {
      // ai[0]==1 拍（:35130-35281）：判定盒扩到 52×scale（scale=ai[1]=2 → 104×104）
      const box = 104;
      this.boom(this.cx, this.cy);                  // DeadCellsMushroomBoiExplosion 编排粒子+音
      for (const ent of game.enemies()) {
        const e = ent as unknown as EnemyLike;
        if (!playerCanHitEnemy(ent, game, this.projId)) continue;
        if (e.dead || this.hitDone.has(e.id)) continue;
        if (!(this.cx - box / 2 < e.x + e.w && this.cx + box / 2 > e.x
          && this.cy - box / 2 < e.y + e.h && this.cy + box / 2 > e.y)) continue;
        this.hitDone.add(e.id);
        // ★BJ494（2026-10-04）掷率收编 rollVanillaHitCrit 单源（定谳=原站 Math.random()<0.04
        //  静态掷=幻影）：1044 SetDefaults（P.cs:9877-9891 亲读）无 melee/ranged/magic 类旗
        //  → Damage_PVE_Inner :12916-12927 三类掷整段不存在=原版零掷（crit 恒假）; ownedBy-
        //  Someone=非 trap=true（:580-589）→ TimerCrit :12928 无条件消费照达（零掷≠跳消费,
        //  BJ492① 946/755 同谳）。critChance 字段保留=关断钉（deadcells-flint 测试置 0 禁掷,
        //  对 flagless 掷臂本就恒假,门=既有语义显式化）。
        const rollCrit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        const timerCrit = (game.player as unknown as
          { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
          | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false;
        const crit = rollCrit || timerCrit;
        const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
        const kdir = Math.sign(e.x + e.w / 2 - this.cx) || 1;   // 默认弹体相对向（1044 不在 num40 特列）
        e.hurt(applyBannerDamageDealt(game, e, dmg), kdir * this.knockback, 0, game, this.armorPen, crit, 0, true);
      }
      // ★BJ727-A（C-D4 族刀,2026-10-27）：1044 爆城镇臂——原版 ai[0]==1 拍判定盒
      //  （52×scale=104）+Damage() victim 循环（:12592）含城镇 voodoo 靶（:12618-12631）;
      //  单源 hitTownNpcsAoeBox,敌怪臂链镜像（critChance>0 门+TimerCrit 消费;1044
      //  flagless 数据面=三类掷臂零掷,TimerCrit :12928 消费照达——与敌怪臂同式）。
      //  localNPCHitCooldown=-1（每敌至多一次）→TownNPC.hurt 8t iframes 近似承载。
      // ★BJ729-A（D4 销案,2026-10-27）：critter 臂【不接】——1044 ∈ ProjectileID.
      //  Sets.MinionShot（ProjectileID.cs:291 亲读 `Factory.CreateBoolSet(...,1044,
      //  ...)`）→ CanNPCBeHitByPlayerOrPlayerProjectile :20675 `MinionShot[type]||
      //  SentryShot[type]` 对普通小动物恒拒收=原版 1044 爆对小动物零受击,销案锁死
      //  防再登记（勿接 hitCrittersAll——critterRejectFlag 同表恒拒,接=死码）。
      hitTownNpcsAoeBox(this.cx, this.cy, box / 2, game, this.damage, this.projId, 'playerProj',
        () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game),
          penPercent: this.armorPen,
        }));
    }
    if (this.ai0 >= 3) this.dead = true;            // 3×projFrames(=1) Kill 门（:35105-35108）
  }

  /** hide=true（SetDefaults :9889）——本体从不渲染 */
  draw(_r: Renderer, _cam: Camera): void { /* 不绘制 */ }
}
