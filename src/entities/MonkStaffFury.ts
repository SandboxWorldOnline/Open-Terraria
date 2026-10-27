// DD2 僧杖系 T1/T2 武器链（Sky Dragon's Fury 3858 之前的 T1/T2 档）：
//   睡章鱼 3835（Sleepy Octopod，Item.cs:33959-33977：useStyle5/useAnim30/useTime30/
//     shootSpeed24/kb7/damage50/channel/autoReuse/noMelee/noUseGraphic/melee，
//     UseSound=DD2_MonkStaffSwing SoundID.cs:1012）→ 弹 697（MonkStaffT1）
//   骸骨长戟 3836（Ghastly Glaive，Item.cs:33978-33995：useStyle5/useAnim27/useTime27/
//     shootSpeed42/kb7/damage45/channel【无 autoReuse】，UseSound=DD2_GhastlyGlaivePierce
//     SoundID.cs:1006）→ 弹 699（MonkStaffT2）→ 命中生成 700（MonkStaffT2Ghast 幽灵）
//   结构同源参照 SkyDragonFury.ts（707/708/709/1110 = 同族 T3）。
//
// 原版锚（Terarria1458/Terraria/Projectile.cs；1457 同段逐块核对一致）：
//   SetDefaults：697 :7368-7386（16×16 scale1.35 localNPCImmunity12）/698 :7387-7403
//     （75×200 alpha255 timeLeft5 localNPCImmunity −1=每敌一次）/699 :7404-7420（24×24
//     ID 静态免疫 idStaticNPCHitCooldown10）/700 :7421-7434（40×40 每敌一次）
//   AI_140_MonkStaffT1 :70493-70683——697 支 :70509-70584（★砸地 698 爆段+ground_impact
//     音 :70575-70583 在 697 支内；707 支自 :70586 起【无】此段——账本 B2"707 砸地
//     爆段缺"系误归因，天龙之怒不砸地，勿给 SkyDragonFury 补）；共享尾支 :70676-70682
//     （position=vector−Size/2+vector2 / timeLeft=2 / SetDummyItemTime(2)）
//   AI_141_MonkStaffT1Explosion :70685-70701（698 爆箱；CreateImpactExplosion_SleepyOctopod
//     :70763-70814 地表碎屑尘 + CreateImpactExplosion2_SleepyOctopod :70816-70853 绿环）
//   AI_142_MonkStaffT2And3 :70900-71053——699 支 :70914-70962（绕手椭圆弧），收势门
//     :71048-71053（itemAnimation<=2 → Kill/reuseDelay2）
//   AI_143_MonkStaffT2Ghast :71055-71120（700 追身渐隐幽灵）
//   SummonMonkGhast :15238-15265（699 命中侧调用 :14272-14274；索敌 800px CanBeChasedBy
//     随机一敌，反向 120px 出生、初速 ±4..6 + 朝目标 2；localAI[0]=1000 单次门 :15239-15242）
//   Colliding：697/707 :15992-16013（目标矩形最近点到玩家 MountedCenter 距离 ≤ 半径盘：
//     697 档 num38=65+8=73）/698 :15537-15551（盒 inflate(70,0)+velX×30 平移后取
//     Y−70/X+velX×20/inflate(−30,0) 子盒）/699 :16016-16028（Center 反向 95px 线段厚 23×scale）
//   CutTiles 697/707 :15326-15335（沿挥轴 ±40/±60 线宽 width×scale）
//   Damage 击退向 :13652-13661（697/699/707/708 = 远离【玩家】中心；698/700 用默认弹体向）
// ★通用湿段定谳（2026-09-06 武器弹簇批;SetDefaults P.cs 逐块）：四弹全【豁免】——
//   SetDefaults 显式 ignoreWater=true（697 :7381 / 698 :7394 / 699 :7416 / 700 :7432）
//   → Projectile.cs:16903 湿段整段门不开,溅花/湿旗/水阻尼全不适用,不接 projectileWetSection。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { cutTilesBox } from './ProjCutTiles';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite } from './Arrow';
import { hitTownNpcs, playerCanHitEnemy, canBeChasedBy, applyBannerDamageDealt } from './projTargets';
import { rollVanillaHitCrit } from './proj1457';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { applyMeleeImbue, applyFrostBurn, applyMagmaStoneProj } from './projStatus';
import { soundTrackFiles } from '../data/vanillaNpcs';

/** 玩家侧挂点（RotatedRelativePoint(MountedCenter) ≈ 中心；SkyDragonFury.DragonOwner 同口径） */
export interface MonkOwner {
  cx: number; cy: number; facing: number; dead: boolean;
  vx: number; vy: number;
}

const TAU = Math.PI * 2;

/** 命中冷却（localNPCHitCooldown 通道：Map<敌id,剩余t>，调用方每 tick 先递减；
 *  与 SkyDragonFury.HitCd 同构） */
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

/** 敌怪桶最小形状（Enemy.hurt 单点结算；SkyDragonFury.EnemyLike 同形） */
type EnemyLike = {
  x: number; y: number; w: number; h: number; id: number; dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
};

type RectLike = { x: number; y: number; w: number; h: number };

/** 近战弹通用命中结算（音/飘值=StrikeNPC 单点;fromPlayer=DPS 计）
 *  ★F3 接线（蓝队四轮）：四型号（697/698/699/700）数据面 melee → 焰爆石/拍击石双支
 *  （Projectile.cs:13439-13446）在本共享出口单点接线；加伤在 banner 外随暴击并入 */
function hurtEnemy(game: GameHooks, e: EnemyLike, dmg: number, crit: boolean,
  kb: number, kdir: number, pen: number,
  host?: { projId: number; x: number; y: number; w: number; h: number }): void {
  const snapBonusFury = projectileSnapStrikeBonus(game,
    { projId: host?.projId }, e.x + e.w / 2, e.y + e.h / 2, e.id,
    { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
      targeterBox: host ? { x: host.x, y: host.y, w: host.w, h: host.h } : undefined });
  e.hurt(applyBannerDamageDealt(game, e, dmg)
    + (snapBonusFury ? snapBonusFury : 0),
    kdir * kb, 0, game, pen, crit, 0, true);
}

/** 浸剂三链（melee 弹命中侧；SkyDragonFury.applyHits 同款——null 门跳过测试态） */
function applyImbue(game: GameHooks, e: EnemyLike): void {
  const pl = game.player as unknown as { buffs?: { has: (b: never) => boolean }; equipStats?: { frostBurn: boolean; magmaStone: boolean } } | null;
  if (pl?.buffs) {
    applyMeleeImbue(pl.buffs, e as unknown as Record<string, number>,
      () => game.spawnParticles(e.x + e.w / 2, e.y + e.h / 2,
        ['#FF6090', '#60FF90', '#6090FF', '#FFD040'][Math.floor(Math.random() * 4)], 6, 2.4, { life: 40, damp: 0.96 }));
  }
  if (pl?.equipStats) {
    applyFrostBurn(pl.equipStats.frostBurn, e as unknown as Record<string, number>);
    applyMagmaStoneProj(pl.equipStats.magmaStone, e as unknown as Record<string, number>);
  }
}

/** 绿色冲击尘 55（NewDustDirect 后置覆写：noGravity+色 (20,255,100,160)+DirectionTo 反溅；
 *  :70559-70562/:70822-70846） */
function greenDust(game: GameHooks, x: number, y: number, ownerVx: number, ownerVy: number,
  alpha: number, mulVel = 1): void {
  const pool = game.vanillaDust;
  if (!pool) {
    game.spawnParticles(x, y, '#14FF64', 1, 1.2, { life: 18 });
    return;
  }
  const d = pool.spawn(x - 5, y - 5, 10, 10, 55, ownerVx, ownerVy, alpha);
  if (!d) return;
  const dl = Math.hypot(d.x - x, d.y - y) || 1;
  d.vx = ((d.x - x) / dl * 0.1 + ownerVx * 0.1) * mulVel;
  d.vy = ((d.y - y) / dl * 0.1 + ownerVy * 0.1) * mulVel;
  d.noGravity = true;
  d.color = { r: 20, g: 255, b: 100, a: 160 };
}

/** 幽尘 228（699 绕手双臂螺旋 :70941-70951 / 拖尾 :70952-70962 / 700 追身螺旋 :71101-71116） */
function ghostDust(game: GameHooks, px: number, py: number, vx: number, vy: number,
  scale: number, fadeIn = 0): void {
  const pool = game.vanillaDust;
  if (!pool) return;
  const d = pool.spawn(px, py, 14, 14, 228, vx, vy, 110);
  if (!d) return;
  d.scale = scale;
  if (fadeIn) d.fadeIn = fadeIn;
  d.noGravity = true;
}

/** AABB vs AABB（Rect.Intersects 同构） */
function rectHits(r: RectLike, t: RectLike): boolean {
  return r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y;
}

/** 矩形最近点到点距离平方（ClosestPointInRect 距离盘判定用） */
function distPtRectSq(px: number, py: number, t: RectLike): number {
  const nx = px < t.x ? t.x : px > t.x + t.w ? t.x + t.w : px;
  const ny = py < t.y ? t.y : py > t.y + t.h ? t.y + t.h : py;
  const dx = px - nx, dy = py - ny;
  return dx * dx + dy * dy;
}

/** 线段 vs AABB（Collision.CheckAABBvLineCollision 语义：胶囊最近点近似；
 *  SkyDragonFury.segHitsRect 同构） */
function segHitsRect(x0: number, y0: number, x1: number, y1: number, thick: number,
  t: RectLike): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let k = ((t.x + t.w / 2 - x0) * dx + (t.y + t.h / 2 - y0) * dy) / len2;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const px = x0 + dx * k, py = y0 + dy * k;
  const nx = px < t.x ? t.x : px > t.x + t.w ? t.x + t.w : px;
  const ny = py < t.y ? t.y : py > t.y + t.h ? t.y + t.h : py;
  return Math.hypot(px - nx, py - ny) < thick / 2;
}

// ================= 697：睡章鱼持械旋棍（AI_140 type697 支 :70509-70584） =================

export class MonkStaffSpin extends Entity {
  readonly projId = 697;
  w = 16; h = 16;                                   // SetDefaults :7369-7370
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  /** 近战系（SetDefaults melee=true :7373——浸剂链） */
  meleeProj = true;
  dead = false;
  /** usesOwnerLight=true（:7378）为引擎旗、反编译树零消费面；AI_140 的 697 支无
   *  AddLight 行（AddLight 只在 707 支 :70587）→ 弹体自身不带光源 */
  lightRGB: [number, number, number] | null = null;

  /** ai[0]：0..50 旋转进度（num=50）；旋进加速 num8=1+(ai0/num)×0.5（:70526-70528，
   *  全程 1.0→1.25 → 实际约 40t 走完 50 进度） */
  private ai0 = 0;
  private rot = 0;
  /** num6 = sign(velocity.X)（:70512-70513 冻结为朝向位） */
  private dir = 1;
  /** alpha 淡入（:70519-70523 −128/tick，SetDefaults 255） */
  private alphaI = 255;
  private owner: MonkOwner;
  /** controlUseItem 电平（channel） */
  private heldCb: () => boolean;
  private aimCb: () => { x: number; y: number };
  /** Kill → player.reuseDelay=10（:70572；本仓 useTime 钳 10） */
  private onEnd: () => void;
  /** 砸地爆箱注入口（Game 注入 entities.add，防循环依赖；缺省 no-op=纯实体测试态） */
  spawnSlam: (x: number, y: number, vx: number, vy: number, dmg: number) => void = () => {};
  private hitCd = new HitCd();

  constructor(owner: MonkOwner, vx: number, vy: number, damage: number, knockback: number,
    heldCb: () => boolean, aimCb: () => { x: number; y: number }, onEnd: () => void) {
    super();
    this.owner = owner;
    this.x = owner.cx - this.w / 2;
    this.y = owner.cy - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.heldCb = heldCb;
    this.aimCb = aimCb;
    this.onEnd = onEnd;
    // Math.Sign(vx)（:70512）；垂直瞄退化角兜底 1（同 SkyDragonSpin 口径）
    this.dir = Math.sign(vx) || 1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const NUM = 50;                                  // num：进度总长（:70494）
    if (this.owner.dead) { this.kill(); return; }    // :70503-70505
    this.vx = this.dir; this.vy = 0;                 // :70512-70513 velocity=(num6,0)
    if (this.ai0 === 0) {                            // :70514-70518 初始角（gravDir=1）
      this.rot = Math.atan2(-1, this.dir) - Math.PI / 4 + Math.PI;
      if (this.dir < 0) this.rot -= Math.PI / 2;
    }
    this.alphaI = Math.max(0, this.alphaI - 128);
    const prevAi = this.ai0;
    const speedup = 1 + (this.ai0 / NUM) * 0.5;      // num8 = 1 + ai0/num×0.5
    let crossedHalf = this.ai0 < NUM / 2;            // flag = ai[0]<25（:70529）
    this.ai0 += speedup;                             // :70530
    this.rot += TAU * 2 / NUM * this.dir * speedup;  // :70531（num2=2 整圈）
    crossedHalf = crossedHalf && this.ai0 >= NUM / 2;  // flag &= ai[0]>=25（越半程恰一帧 :70532）
    if (this.ai0 >= NUM || (crossedHalf && !this.heldCb())) {
      this.kill();                                   // :70533-70536（reuseDelay=10）
      return;
    }
    if (crossedHalf) {                               // :70537-70548 半程重瞄
      const m = this.aimCb();
      const nd = m.x >= this.owner.cx ? 1 : -1;      // DirectionTo(mouse).X > 0 ? 1 : −1
      if (nd !== this.dir) {
        this.owner.facing = nd;                      // player.ChangeDir(num9)
        this.dir = nd;
        this.rot -= Math.PI;
      }
    }
    // 挥轴角 num10 = rotation − π/4×dir；左向 +π 翻转（:70550-70552）
    const swingAng = this.rot - Math.PI / 4 * this.dir;
    const flipAng = swingAng + (this.dir === -1 ? Math.PI : 0);
    const ux = Math.cos(flipAng), uy = Math.sin(flipAng);
    // 尘锚在【上一 tick】Center（原版 AI 先尘后位移 :70676 才写 position）
    const ax = this.cx + ux * 30, ay = this.cy + uy * 30;
    if (Math.random() < 0.5) {                       // 尘 31（1/2 掷,:70554-70557）
      const pool = game.vanillaDust;
      const d = pool ? pool.spawn(ax - 5, ay - 5, 10, 10, 31, this.owner.vx, this.owner.vy, 150) : null;
      if (d) {
        const dl = Math.hypot(d.x - ax, d.y - ay) || 1;
        d.vx = (d.x - ax) / dl * 0.1 + this.owner.vx * 0.1;
        d.vy = (d.y - ay) / dl * 0.1 + this.owner.vy * 0.1;
      }
    }
    const prevProg = prevAi / NUM;
    if (prevProg >= 0.85) {                          // :70558-70563 绿尘 55 单粒
      greenDust(game, ax, ay, this.owner.vx, this.owner.vy, 50);
    }
    if (this.ai0 >= NUM - 8 && this.ai0 < NUM - 2) {                   // :70565-70574 ×5 加速绿尘
      for (let i = 0; i < 5; i++) greenDust(game, ax, ay, this.owner.vx, this.owner.vy, 50, 1.2);
    }
    // ---- 砸地：ai[0] 越过 num−3=47 恰一帧 → 弹 698（伤×3）+ ground_impact 跟身音
    //      （:70575-70583；出生点 vector3+(−dir×15,−60)，vector3=Center+挥轴向×30）----
    if (this.ai0 >= NUM - 3 && prevAi < NUM - 3) {
      this.spawnSlam(this.cx + ux * 30 - this.dir * 15, this.cy + uy * 30 - 60,
        this.dir, 0, this.damage * 3);               // num5=damage*3（:70511）、vel=(num6,0)
      game.playSfxFiles(soundTrackFiles('dd2_monk_staff_ground_impact'), 1, this.cx, this.cy);   // PlayTrackedSound（:70583；SoundID.cs:1008）
    }
    // 位移（共享尾支 :70676-70677）：手心 − size/2 + 挥轴向 ×(ai0/num)×20（num3=20）
    const reach = this.ai0 / NUM * 20;
    this.x = this.owner.cx - this.w / 2 + ux * reach;
    this.y = this.owner.cy - this.h / 2 + uy * reach;
    this.owner.facing = this.dir;                    // 尾支 ChangeDir(direction)（:70679）
    // ---- 命中（Colliding :15992-16013）：目标矩形最近点到玩家中心距离 ≤73（num38=65+8；
    //      rotation/线宽 num39 仅调试可视化用）+ localNPCHitCooldown=12（:7383）----
    this.hitCd.tick();
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2, 'playerProj', 0);
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      if (e.dead || !this.hitCd.ready(e.id, 12)) continue;
      const d2 = distPtRectSq(this.owner.cx, this.owner.cy, e);
      if (d2 > 73 * 73) continue;
      // ★BJ489 def-3：697 掷率=rollVanillaHitCrit（melee 旗,命中拍 owner 装配+:25712
      //  持械折入动态,critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // 击退向远离【玩家】中心（Damage num40 特列 :13652-13661）
      const kdir = Math.sign((e.x + e.w / 2) - this.owner.cx) || this.dir;
      hurtEnemy(game, e, dmg, crit, this.knockback, kdir, this.armorPen, this);
      applyImbue(game, e);
    }
    // ---- CutTiles 沿挥轴 ±40（:15326-15334，宽 width×scale≈21.6 → 12px 步进采样）----
    for (let s = -40; s <= 40; s += 12) {
      const tx = Math.floor((this.cx + ux * s) / 16), ty = Math.floor((this.cy + uy * s) / 16);
      if (game.world.store.inBounds(tx, ty)) game.cutTile(tx, ty);
    }
  }

  private kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.onEnd();                                    // player.reuseDelay = 10（:70572）
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(697);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || !ctx) return;
    const a = (255 - this.alphaI) / 255;             // GetAlpha 白×(255−alpha)
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    const sc = 1.35;                                 // SetDefaults scale（:7374）
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -img.width * sc / 2, -img.height * sc / 2, img.width * sc, img.height * sc);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ================= 698：睡章鱼砸地爆箱（AI_141_MonkStaffT1Explosion :70685-70701） =================

export class MonkSlam extends Entity {
  readonly projId = 698;
  w = 75; h = 200;                                   // SetDefaults :7388-7389
  damage: number;
  knockback = 0;                                     // NewProjectile kb 实参 0（:70580）
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  /** timeLeft=5（SetDefaults :7393）——寿命闸（先于 ai0>20 到期） */
  private timeLeft = 5;
  /** ai[0]（:70690） */
  private ai0 = 0;
  private vxSign: number;
  /** localNPCHitCooldown=−1（SetDefaults :7396-7397）＝每敌至多一次 */
  private hitDone = new Set<number>();

  constructor(x: number, y: number, vx: number, vy: number, damage: number) {
    super();
    this.x = x; this.y = y;                          // ★入参=NewProjectile【中心】语义（:70578 直传 vector3+(dir×−15,−60),:10878-10879 position=X−w/2——旧注「左上角直传」系误读,已勘;调用侧 Game.ts spin.spawnSlam 以 placeAtShootSpawn 回正盒左上）
    this.vx = vx; this.vy = vy;
    this.vxSign = Math.sign(vx) || 1;
    this.damage = damage;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.ai0++;
    if (this.ai0 > 20) { this.dead = true; return; }             // :70691-70693
    if (--this.timeLeft <= 0) { this.dead = true; return; }      // timeLeft=5（:7393）
    cutTilesBox(game, this.x, this.y, this.w, this.h);           // CutTiles（:12517/:15276;两门排除表均无 698）
    if (this.ai0 === 1) this.impactFx(game);                     // :70694-70700（ai0==1 帧）
    // ---- 命中（Colliding :15537-15551）：盒 inflate(70,0)+X 平移 velX×30；再取
    //      Y−70 / X+velX×20 / inflate(−30,0) 子盒判交。每敌一次（:7396-7397）----
    const bx = this.x - 70 + this.vxSign * 30;
    const bw = this.w + 140;
    const ax = bx + this.vxSign * 20 + 30, ay = this.y - 70;
    const aw = bw - 60, ah = this.h;
    hitTownNpcs({ x: ax, y: ay, w: aw, h: ah }, game, this.damage, this.vxSign * 2, 'playerProj', 0);
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      if (e.dead || this.hitDone.has(e.id)) continue;
      if (!rectHits({ x: ax, y: ay, w: aw, h: ah }, e)) continue;
      this.hitDone.add(e.id);
      // ★BJ486④（2026-10-03）掷率=owner 装配 + bonusCritChance=25 形参化（:12912-12914
      //  num13 + :70581-70582 `Main.projectile[num11].bonusCritChance = 25`——697 砸地
      //  震波 698 逐发硬写 25,melee 旗（SetDefaults 698 :7387-7400）→ 掷 = 基 4+
      //  meleeCrit 聚合+:25712 持械折入 + 25。旧 critTotal+0.25 静态冻结载体建模退役,
      //  写位已摘）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game, 25);
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      // 击退向 = 默认弹体相对向（698 不在 Damage num40 特列 :13652-13661）
      const kdir = Math.sign((e.x + e.w / 2) - this.cx) || this.vxSign;
      hurtEnemy(game, e, dmg, crit, this.knockback, kdir, this.armorPen, this);
      applyImbue(game, e);
    }
  }

  /** CreateImpactExplosion_SleepyOctopod(:70763-70814)+2(:70816-70853)：绿环 55 双组 +
   *  地表碎屑。★碎屑组成近似——原版 KillTile_GetTileDustAmount(fail:true)×8 按 tile
   *  出对应色尘；此处按同门采样（实心非上盖格、距 Bottom≤explosionRange=width=75），
   *  每合格格出 2 粒通用碎屑（几何/门 1:1，配色不逐 tile 展开） */
  private impactFx(game: GameHooks): void {
    const botX = this.cx, botY = this.y + this.h;                // base.Bottom（:70700）
    // 绿环（:70816-70853）：椭圆 (7,0.7) 25 点；次组仅在 causedShockwaves=false 时出
    // （原版由碎屑掷决定 shockwaves——此处恒按主组+弱化次组近似，量级对齐）
    for (let pass = 0; pass < 2; pass++) {
      const second = pass === 1;
      for (let i = 0; i < 25; i++) {
        const a = i * TAU / 25;
        const pool = game.vanillaDust;
        const d = pool ? pool.spawn(this.x, this.y, this.w, this.h, 55, 0, second ? -5 : -3, second ? 100 : 0) : null;
        if (!d) break;
        d.x = botX - this.vxSign * 10 + Math.cos(a) * 7;
        d.y = botY + Math.sin(a) * 4.9;
        d.color = { r: 20, g: 255, b: 100, a: 200 };
        d.fadeIn = 0.5 + Math.random() * 0.5;
        d.noLight = true;
        d.vx *= second ? 0.8 : 0.5;
        d.vx += this.vxSign * 3 * (0.3 + 0.7 * Math.random());
      }
    }
    // 地表碎屑扫描（scanArea=TopLeft..BottomRight 瓦片 +1 行,:70686-70689）
    const st = game.world.store;
    const tx0 = Math.floor(this.x / 16), ty0 = Math.floor(this.y / 16);
    const tx1 = Math.floor((this.x + this.w) / 16), ty1 = Math.floor((this.y + this.h) / 16) + 1;
    for (let ti = tx0; ti <= tx1; ti++) {
      for (let tj = ty0; tj <= ty1; tj++) {
        if (!st.inBounds(ti, tj)) continue;
        if (!st.isSolid(ti, tj)) continue;
        if (Math.hypot(ti * 16 + 8 - botX, tj * 16 + 8 - botY) > 75) continue;
        if (st.inBounds(ti, tj - 1) && st.isSolid(ti, tj - 1)) continue;   // 上格实心跳过（:70776-70779）
        for (let k = 0; k < 2; k++) {
          game.spawnParticles(ti * 16 + Math.random() * 16, tj * 16 + Math.random() * 16,
            '#9A7B52', 1, 1.5, { life: 22, vy: -(3 + Math.random() * 6), vx: this.vxSign * 3 * (0.3 + 0.7 * Math.random()) });
        }
      }
    }
  }

  /** alpha=255（SetDefaults :7390）→ GetAlpha 全透，本体从不渲染（纯判定+尘实体） */
  draw(_r: Renderer, _cam: Camera): void { /* 本体不绘制 */ }
}

// ================= 699：骸骨长戟绕手弧（AI_142 type699 支 :70914-70962） =================

export class GhastlyGlaiveProj extends Entity {
  readonly projId = 699;
  w = 24; h = 24;                                    // SetDefaults :7405-7406
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  lightRGB: [number, number, number] | null = null;  // usesOwnerLight（:7411）引擎旗无消费面

  private alphaI = 255;
  private rot = 0;
  /** ai[0]：椭圆 y 半径（Player.cs:49230-49234 出手掷 rand×speed×0.75×direction） */
  private readonly ai0: number;
  /** 出膛向（velocity 冻结；NoMeleeSpeedVelocityScaling 成员 ProjectileID.cs:429——初速不随 meleeSpeed 缩放） */
  private readonly aimAng: number;
  private readonly aimLen: number;
  /** SummonMonkGhast 的 localAI[0]=1000 冷却门（:15239-15242 + AI 内逐 tick 递减 :70922-70924）
   *  ——单次出手寿命内等效"只召唤一次" */
  private ghastSummoned = false;
  private owner: MonkOwner;
  /** player.itemAnimation 代理（swing.t 递减）与 useAnimation 总时长 */
  private animT: () => number;
  private readonly animMax: number;
  /** 幽灵注入口（Game 注入 entities.add；缺省 no-op=纯实体测试态） */
  spawnGhast: (x: number, y: number, vx: number, vy: number, dmg: number) => void = () => {};
  /** Kill → player.reuseDelay=2（:71052） */
  private onEnd: () => void;
  private hitCd = new HitCd();

  constructor(owner: MonkOwner, vx: number, vy: number, damage: number, knockback: number,
    ai0: number, animT: () => number, animMax: number, onEnd: () => void) {
    super();
    this.owner = owner;
    this.x = owner.cx - this.w / 2;
    this.y = owner.cy - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.ai0 = ai0;
    this.aimAng = Math.atan2(vy, vx);
    this.aimLen = Math.hypot(vx, vy) || 1;
    this.damage = damage;
    this.knockback = knockback;
    this.animT = animT;
    this.animMax = Math.max(1, animMax);
    this.onEnd = onEnd;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (this.owner.dead) { this.kill(); return; }                  // :70906-70908
    const facing = this.owner.facing;               // spriteDirection = direction = player.direction（:70915）
    this.alphaI = Math.max(0, this.alphaI - 127);                  // :70917-70921
    const at = this.animT();
    const elapsed = 1 - at / this.animMax;          // num2 = 1 − itemAnimation/max（:70925-70926）
    // spinningpoint = UnitX.RotBy(π+elapsed·2π) 分量 ×(|v|, ai0)，再 RotBy(aimAng)（:70927-70929）
    const th = Math.PI + elapsed * TAU;
    const spx = Math.cos(th) * this.aimLen, spy = Math.sin(th) * this.ai0;
    const cosA = Math.cos(this.aimAng), sinA = Math.sin(this.aimAng);
    const spx2 = spx * cosA - spy * sinA, spy2 = spx * sinA + spy * cosA;
    const fwdX = (this.aimLen + 22) * cosA, fwdY = (this.aimLen + 22) * sinA;    // num5=22 前伸（:70930）
    this.x = this.owner.cx - this.w / 2 + spx2 + fwdX;               // Center 钉手心（:70912）后 position += …（:70931）
    this.y = this.owner.cy - this.h / 2 + spy2 + fwdY;
    cutTilesBox(game, this.x, this.y, this.w, this.h);               // CutTiles（:12517/:15276;两门排除表均无 699）
    // rotation：原版 target = vector2(手心) + spinningpoint.Rot + Vector2(len+22+40,0).Rot
    // （:70932）→ AngleTo(target) 即 target 相对手心的角（:70933）
    this.rot = Math.atan2(spy2 + (this.aimLen + 22 + 40) * sinA, spx2 + (this.aimLen + 22 + 40) * cosA)
      + Math.PI / 4 * facing;
    if (facing === -1) this.rot += Math.PI;                         // :70934-70936
    // 双臂幽尘 228 半径 10（:70941-70951）+ 拖尾大尘（1/3,:70952-70962）
    for (let i = 0; i < 2; i++) {
      const ang2 = elapsed * TAU * 2 + (i / 2) * TAU;
      const rx = cosA * Math.cos(ang2) - sinA * Math.sin(ang2);
      const ry = cosA * Math.sin(ang2) + sinA * Math.cos(ang2);
      ghostDust(game, this.cx + rx * 10, this.cy + ry * 10, rx * 2 + cosA * 3, ry * 2 + sinA * 3,
        1 + 0.6 * Math.random());
    }
    if (Math.random() < 1 / 3) {
      ghostDust(game, this.cx - cosA * 110, this.cy - sinA * 110, cosA * 2, sinA * 2,
        0.45 + 0.4 * Math.random(), 0.7 + 0.4 * Math.random());     // vector3(aim 向)×−110 定点
    }
    // ---- 命中（Colliding :16016-16028）：Center 反向 95px 线段厚 23×scale(1)。
    //      f5 = rotation − π/4×sign(velocity.X) (+π 若 spriteDirection==−1) ----
    this.hitCd.tick();
    const f5 = this.rot - Math.PI / 4 * (Math.sign(this.vx) || 1) + (facing === -1 ? Math.PI : 0);
    const hx = this.cx + Math.cos(f5) * -95, hy = this.cy + Math.sin(f5) * -95;
    hitTownNpcs({ x: Math.min(this.cx, hx) - 12, y: Math.min(this.cy, hy) - 12,
      w: Math.abs(hx - this.cx) + 24, h: Math.abs(hy - this.cy) + 24 },
      game, this.damage, Math.sign(this.vx) * 2, 'playerProj', 0);
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      if (e.dead || !this.hitCd.ready(e.id, 10)) continue;   // idStaticNPCHitCooldown=10（:7415；★原版为 ID 静态共享表，此处实例级近似）
      if (!segHitsRect(this.cx, this.cy, hx, hy, 23, e)) continue;
      // ★BJ489 def-3：699 掷率=rollVanillaHitCrit（melee 旗,命中拍动态;冻结载体退役）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      const kdir = Math.sign((e.x + e.w / 2) - this.owner.cx) || facing;   // 远离玩家（:13652-13661）
      hurtEnemy(game, e, dmg, crit, this.knockback, kdir, this.armorPen, this);
      applyImbue(game, e);
      // SummonMonkGhast（Damage :14272-14274 → :15238-15265；localAI[0]=1000 单次门）
      if (!this.ghastSummoned) this.summonGhast(game);
    }
    if (at <= 2) { this.kill(); }                    // :71048-71053（anim≤2 Kill/reuseDelay2）
  }

  /** SummonMonkGhast（:15238-15265）：800px 内 CanBeChasedBy 随机一敌；出生位 =
   *  目标中心反向侧 120px（targetCenter + (−num×120,0)，num=±1 与初速同号），初速 =
   *  (±(4+rand(3)),0) + normalize(目标中心+目标速×15 − 出生位)×2。无敌可索 → 目标=
   *  自体中心、zero 目标速（:15248-15256）。伤 = 699 当前伤害（NewProjectile 实参 :15257） */
  private summonGhast(game: GameHooks): void {
    this.ghastSummoned = true;
    interface Cand { cx: number; cy: number; vx: number; vy: number }
    const cands: Cand[] = [];
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike & { vanillaId?: number | null; vx?: number; vy?: number };
      // CanBeChasedBy(this) && Distance(nPC.Center) < 800（:15245-15247）——索敌专用门
      // projTargets.canBeChasedBy（immortal/chaseable/friendly/lifeMax≤5 剔除），命中门勿混用
      if (!canBeChasedBy(ent)) continue;
      const ecx = e.x + e.w / 2, ecy = e.y + e.h / 2;
      if (Math.hypot(ecx - this.cx, ecy - this.cy) >= 800) continue;
      cands.push({ cx: ecx, cy: ecy, vx: e.vx ?? 0, vy: e.vy ?? 0 });
    }
    let tcx = this.cx, tcy = this.cy, tvx = 0, tvy = 0;
    if (cands.length > 0) {
      const pick = cands[Math.floor(Math.random() * cands.length)];   // list[Main.rand.Next(list.Count)]
      tcx = pick.cx; tcy = pick.cy; tvx = pick.vx; tvy = pick.vy;
    }
    const num = Math.floor(Math.random() * 2) * 2 - 1;                  // Main.rand.Next(2)*2−1（:15252）
    const gvxBase = num * (4 + Math.floor(Math.random() * 3));          // (4+Next(3)) ×num（:15253）
    const sx = tcx + (-num * 120), sy = tcy;                            // 出生位（:15254）
    const dl = Math.hypot(tcx + tvx * 15 - sx, tcy + tvy * 15 - sy) || 1;
    const gvx = gvxBase + (tcx + tvx * 15 - sx) / dl * 2;               // SafeNormalize×2 追加（:15255）
    const gvy = (tcy + tvy * 15 - sy) / dl * 2;
    this.spawnGhast(sx, sy, gvx, gvy, this.damage);
  }

  private kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.onEnd();                                    // player.reuseDelay = 2（:71052）
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(699);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || !ctx) return;
    const a = (255 - this.alphaI) / 255;
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ================= 700：骸骨幽灵（AI_143_MonkStaffT2Ghast :71055-71120） =================

export class MonkGhast extends Entity {
  readonly projId = 700;
  w = 40; h = 40;                                    // SetDefaults :7422-7423
  damage: number;
  knockback = 0;                                     // NewProjectile kb 实参 0（:15257）
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;

  /** ai[0] 寿命计（Kill @≥60,:71086-71089） */
  private ai0 = 0;
  /** alpha：SetDefaults 255 → −25/t 钳底 100（:71074-71081），ai0>50 转 +25/t 渐隐 */
  private alphaI = 255;
  private frame = 0;
  private frameCtr = 0;
  /** 音槽语义（vanilla :71058-71068）：首帧 PlayTrackedSound 存 SlotId 于 localAI[1]，
   *  之后每 tick GetActiveSound(slot)?.Position = Center（一次性声跟身移动）。
   *  本仓无"一次性声位置跟随"通道（startTrackedLoop 是循环轨语义不匹配 1s 短音）→
   *  取【出生一次性 playSfxFiles】：ghost 寿命 60t≈1s、初速 ≤~8px/t 的漂移对衰减
   *  尾段听感影响可忽略——选择一次性而非短循环轨（避免循环接缝噪声） */
  private soundPlayed = false;
  /** localNPCHitCooldown=−1（SetDefaults :7429-7430）＝每敌至多一次 */
  private hitDone = new Set<number>();

  constructor(x: number, y: number, vx: number, vy: number, damage: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (this.ai0 === 0 && !this.soundPlayed) {       // 首帧跟身音（:71058-71061；SoundID.cs:1004）
      this.soundPlayed = true;
      game.playSfxFiles(soundTrackFiles('dd2_ghastly_glaive_impact_ghost'), 1, this.cx, this.cy);
    }
    this.ai0++;
    if (this.ai0 > 50) {                             // :71071-71081 渐隐段
      this.alphaI = Math.min(255, this.alphaI + 25);
    } else {
      this.alphaI = Math.max(100, this.alphaI - 25); // 渐入钳底 100（半透常态）
    }
    this.vx *= 0.98; this.vy *= 0.98;                // :71082
    if (++this.frameCtr >= 5) {                      // 4 帧 5t（:71083-71089）
      this.frameCtr = 0;
      this.frame = (this.frame + 1) % 4;
    }
    if (this.ai0 >= 60) { this.dead = true; return; }
    // direction/spriteDirection 按 velocity.X；rotation=速度向（左向 +π 翻转贴图）:71091-71097
    const sgn = this.vx > 0 ? 1 : -1;
    this.rotBase = Math.atan2(this.vy, this.vx) + (sgn === -1 ? Math.PI : 0);
    // 追身螺旋尘（ai0∈[10,34)，双臂半径 7,:71099-71119）
    if (this.ai0 >= 10 && this.ai0 < 34) {
      const vl = Math.hypot(this.vx, this.vy) || 1;
      const ux = this.vx / vl, uy = this.vy / vl;
      const prog = this.ai0 / 60;
      for (let i = 0; i < 2; i++) {
        const ang2 = prog * TAU * 2 + (i / 2) * TAU;
        const rx = ux * Math.cos(ang2) - uy * Math.sin(ang2);
        const ry = ux * Math.sin(ang2) + uy * Math.cos(ang2);
        ghostDust(game, this.cx + rx * 7, this.cy + ry * 7, rx * 2 + ux * 3, ry * 2 + uy * 3,
          1 + 0.6 * Math.random());
      }
    }
    this.x += this.vx; this.y += this.vy;
    cutTilesBox(game, this.x, this.y, this.w, this.h);          // CutTiles（:12517/:15276;两门排除表均无 700）
    // ---- 命中：默认 AABB 判定（700 无 Colliding 特支）+ 每敌一次 ----
    hitTownNpcs(this, game, this.damage, sgn * 2, 'playerProj', 0);
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      if (e.dead || this.hitDone.has(e.id)) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      this.hitDone.add(e.id);
      // ★BJ489 def-3：700 掷率=rollVanillaHitCrit（melee 旗,命中拍动态;冻结载体退役）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      const kdir = Math.sign(this.vx) || 1;          // 默认弹体方向（700 不在 num40 特列）
      hurtEnemy(game, e, dmg, crit, this.knockback, kdir, this.armorPen, this);
      applyImbue(game, e);
    }
  }

  /** 绘制旋转角（draw 时读；独立字段避免与 Entity.rot 无关命名冲突） */
  private rotBase = 0;

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(700);
    const ctx = r.ctx;
    if (!img || !(img.height > 0) || !ctx) return;
    const a = Math.max(0, Math.min(1, (255 - this.alphaI) / 255));
    if (a <= 0.02) return;
    const fh = img.height / 4;                       // 82×200 = 4 帧（projFrames[700]=4 Main.cs:8612）
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rotBase);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, this.frame * fh, img.width, fh, -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
