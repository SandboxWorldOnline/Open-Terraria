// 天龙之怒 3858（Sky Dragon's Fury，DD2 僧兵 T3，Item.cs:34080-34094：
// useStyle5/channel/autoReuse/noUseGraphic，UseSound=DD2_SkyDragonsFurySwing）全链：
//   左键 弹 707（AI_140_MonkStaffT1 :66249-66337）：持械旋剑——50t 恒 2 整圈
//     （rot += 4π/50×dir/tick）、位置随圈从手心伸长到 20px（num14 方向 ×t/50×20）、
//     t=25 半程门（松手即 Kill/reuseDelay2；按住则按鼠标向重定方向 rot−=π）；
//     命中 = Center±num14 向 ±110px 线段厚 23（Colliding :14618-14635）、
//     localNPCHitCooldown=6、penetrate −1；CutTiles ±60（:14159-14167）；
//     尘 31（1/2）+ 四股尘 226（5/6，60-80px 处垂直抛洒）。
//   右键 alt（Player.cs:48127-48141 altFunctionUse==2）：弹 708（AI_142
//     :66562-66641）半伤 ×0.5 / kb+4 / 速 ×1.5=36——椭圆弧随 itemAnimation 旋转
//     （spinningpoint = RotBy(π+prog·2π) 分量 ×(36, ai0)，ai0=(0.3+0.7r)×24×1.75×dir
//     ∈[12.6,42]×dir），anim 2/6/10 各出一发 709（±0.3839725 扇形、速 10+Next(4)）。
//   709（:51809-51839 aiStyle1 + SetDefaults :7226-7238：7×7 盒（12×scale0.6）、
//     alpha 淡入 30/次、3 帧 3t、extraUpdates=1、寿命 30 AI 次）：亡于撞块/命中/
//     寿命 → Kill 链 :70218-70290——尘爆 + 消费 80×80 内旧 1110（ai1=1 渐隐）+
//     新 1110（timeLeft=30×Next(2,6)、DD2_SkyDragonsFuryCircle）。
//   1110（aiStyle 77 :29583-29700，SetDefaults :10058-10070：80×80 脉动
//     num641=max(0.75+0.25v, 0.8−0.2v)（v=−cosθ）∈[0.778,1] → 尺寸 [62,80]、
//     4 帧 3t、8t 免疫 penetrate −1）：滞留 AoE 圈，尘 226 环抛。
// ★通用湿段定谳（2026-09-06 武器弹簇批;SetDefaults P.cs 逐块）：四弹全【豁免】——
//   SetDefaults 显式 ignoreWater=true（707 :7488 / 708 :7505 / 709 :7518 / 1110 :10351）
//   → Projectile.cs:16903 湿段整段门不开,溅花/湿旗/水阻尼全不适用,不接 projectileWetSection。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { cutTilesBox } from './ProjCutTiles';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite } from './Arrow';
// ★BJ704-G2（2026-10-21,债① 709 员）：残影环接线——709 TrailingMode=0/CacheLen 10
//  （ProjectileID.cs:385/:387）,通用表 P(1,8,2,0.5)（Main.cs:31078-31087,num164=8/
//  num165=8/4=2 恒）,色=GetAlpha :81063-81066 (255,255,255,200) 恒 → GHOST_TINT[709]
//  白染 aMul 200/255（alpha 淡入无视觉面,GetAlpha 不读 α）。
import { ProjGhostRing, drawProjGhosts } from './projGhostTrail';
import { hitTownNpcs, playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { applyMeleeImbue, applyFrostBurn, applyMagmaStoneProj } from './projStatus';
import { soundTrackFiles } from '../data/vanillaNpcs';
import type { VDust } from '../fx/VanillaDust';
import { rollVanillaHitCrit } from './proj1457';   // ★BJ489 def-3 掷率单源（函数声明环=运行时调用安全）

/** 玩家侧挂点（RotatedRelativePoint(MountedCenter) ≈ 中心；ChainsawProj 同口径） */
export interface DragonOwner {
  cx: number; cy: number; facing: number; dead: boolean;
  vx: number; vy: number;
}

const TAU = Math.PI * 2;

/** 命中冷却（localNPCHitCooldown 通道：Map<敌id,剩余t>，调用方每 tick 先递减） */
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

/** 线段 vs AABB（Collision.CheckAABBvLineCollision 语义：胶囊最近点近似） */
function segHitsRect(x0: number, y0: number, x1: number, y1: number, thick: number,
  t: { x: number; y: number; w: number; h: number }): boolean {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let k = ((t.x + t.w / 2 - x0) * dx + (t.y + t.h / 2 - y0) * dy) / len2;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const px = x0 + dx * k, py = y0 + dy * k;
  const nx = px < t.x ? t.x : px > t.x + t.w ? t.x + t.w : px;
  const ny = py < t.y ? t.y : py > t.y + t.h ? t.y + t.h : py;
  return Math.hypot(px - nx, py - ny) < thick / 2;
}

type EnemyLike = {
  x: number; y: number; w: number; h: number; id: number; dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
};

/** 近战弹通用命中结算（音效 + hurt——四型号均无 StatusNPC 表项；浸剂三链仅
 *  707 持械主攻在调用点接，708/709/1110 原版同为 melee 但经 NewProjectile 链
 *  的 StatusNPC 走 Projectile.Damage 同门——此处统一接齐）
 *  ★F3 接线（蓝队四轮）：四型号（707/708/709/1110）数据面 melee → 焰爆石/拍击石
 *  双支（Projectile.cs:13439-13446）在本共享出口单点接线；加伤在 banner 外随暴击并入 */
function hurtEnemy(game: GameHooks, e: EnemyLike, dmg: number, crit: boolean,
  kb: number, kdir: number, pen: number,
  host?: { projId: number; x: number; y: number; w: number; h: number }): void {
  const snapBonusFury = projectileSnapStrikeBonus(game,
    { projId: host?.projId }, e.x + e.w / 2, e.y + e.h / 2, e.id,
    { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
      targeterBox: host ? { x: host.x, y: host.y, w: host.w, h: host.h } : undefined });
  e.hurt(applyBannerDamageDealt(game, e, dmg)
    + (snapBonusFury ? Math.trunc(snapBonusFury * (crit ? 2 : 1)) : 0),
    kdir * kb, 0, game, pen, crit, 0, true);   // ★F1 旗乘区;音/飘值=StrikeNPC 单点;fromPlayer=DPS 计
}

/** 尘 31 火花（NewDustDirect box 抖动 + DirectionTo 反溅——707/709 通用近似） */
function sparkDust(game: GameHooks, x: number, y: number, ownerVx: number, ownerVy: number): void {
  const pool = game.vanillaDust;
  if (!pool) {
    game.spawnParticles(x, y, '#E8C060', 1, 1.2, { life: 16 });
    return;
  }
  const d = pool.spawn(x - 5, y - 5, 10, 10, 31, 0, 0, 150);
  if (!d) return;
  const dl = Math.hypot(d.x - x, d.y - y) || 1;
  d.vx = (d.x - x) / dl * 0.1 + ownerVx * 0.1;
  d.vy = (d.y - y) / dl * 0.1 + ownerVy * 0.1;
}

/** 尘 226 抛洒（DD2 电尘：定点 + 定向初速，noGravity 3/4） */
function boltDust(game: GameHooks, d: VDust | null, px: number, py: number,
  vx: number, vy: number, scale: number, fadeIn: number): void {
  if (!d) return;
  d.x = px; d.y = py;
  d.vx = vx; d.vy = vy;
  d.scale = scale;
  d.fadeIn = fadeIn;
  d.noGravity = Math.random() < 0.75;
  d.noLight = true;
}

// ================= 707 左键：持械旋剑（AI_140_MonkStaffT1） =================

export class SkyDragonSpin extends Entity {
  readonly projId = 707;
  w = 16; h = 16;                                   // :7194-7195
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  /** 近战系（SetDefaults melee=true :7198——浸剂链） */
  meleeProj = true;
  dead = false;
  /** AddLight(player.Center, 0.75,0.9,1.15)（:66251）——弹体挂手 ≈ 玩家中心 */
  lightRGB: [number, number, number] | null = [0.75, 0.9, 1.15];

  /** ai[0]：0..50 旋转进度（num=50） */
  private t = 0;
  /** alpha 淡入（:66262-66266 −128/tick，SetDefaults 255） */
  private alphaI = 255;
  private rot = 0;
  /** num11 = sign(velocity.X)（冻结为朝向位） */
  private dir = 1;
  private owner: DragonOwner;
  /** controlUseItem 电平（channel） */
  private heldCb: () => boolean;
  private aimCb: () => { x: number; y: number };
  /** Kill → player.reuseDelay=2（本仓 useTime 钳 2） */
  private onEnd: () => void;
  private hitCd = new HitCd();

  constructor(owner: DragonOwner, vx: number, vy: number, damage: number, knockback: number,
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
    // Math.Sign(vx)（:66252）；恰好垂直瞄（vx=0）时 Math.Sign=0 的退化角原版同样
    // 存在——此处兜底 1 规避 NaN 姿态
    this.dir = Math.sign(vx) || 1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    const NUM = 50;                                  // num：总时长
    if (this.owner.dead) { this.kill(); return; }
    this.vx = this.dir; this.vy = 0;                 // :66252-66253
    if (this.t === 0) {                              // :66254-66261 初始角
      this.rot = Math.atan2(-1, this.dir) - Math.PI / 4 + Math.PI;
      if (this.dir < 0) this.rot -= Math.PI / 2;
    }
    this.alphaI = Math.max(0, this.alphaI - 128);
    this.t += 1;                                     // :66269（num12=1）
    this.rot += TAU * 2 / NUM * this.dir;            // :66270 2 整圈/50t
    const half = this.t === NUM / 2;                 // flag2 = ai[0]==25
    if (this.t >= NUM || (half && !this.heldCb())) { this.kill(); return; }  // :66272-66276
    if (half) {                                      // :66277-66288 半程重瞄
      const m = this.aimCb();
      const nd = m.x >= this.owner.cx ? 1 : -1;      // DirectionTo(mouse).X > 0
      if (nd !== this.dir) {
        this.owner.facing = nd;                      // player.ChangeDir(num13)
        this.dir = nd;
        this.rot -= Math.PI;
      }
    }
    const num14 = this.rot - Math.PI / 4 * this.dir; // :66294
    const flip = this.dir === -1 ? Math.PI : 0;
    // 尘（:66296-66336——注意锚在【上一 tick】Center，原版 AI 先尘后位移）：
    const ax = this.cx + Math.cos(num14 + flip) * 30, ay = this.cy + Math.sin(num14 + flip) * 30;
    if (Math.random() < 0.5) sparkDust(game, ax, ay, this.owner.vx, this.owner.vy);
    // vector6 = vector5 旋 π/2×spriteDirection（spriteDirection=direction=num11）
    const v5x = Math.cos(num14), v5y = Math.sin(num14);
    const qa = Math.PI / 2 * this.dir;
    const v6x = v5x * Math.cos(qa) - v5y * Math.sin(qa);
    const v6y = v5x * Math.sin(qa) + v5y * Math.cos(qa);
    const pool = game.vanillaDust;
    for (let j = 0; j < 4; j++) {
      // (num15,num16)：j0=(1,1) j1=(1,−1) j2=(0.5,1.25) j3=(0.5,−1.25)
      const n15 = j >= 2 ? 0.5 : 1;
      const n16 = (j === 1 || j === 3) ? -1 : j >= 2 ? 1.25 : 1;
      if (Math.random() >= 1 / 6) {
        const r = 60 + Math.random() * 20;
        const sp = (4 + 4 * Math.random()) * n16 * n15;
        boltDust(game, pool ? pool.spawn(this.cx, this.cy, 0, 0, 226, 0, 0, 100) : null,
          this.cx + v5x * r * n16, this.cy + v5y * r * n16, v6x * sp, v6y * sp, 0.5, 0);
      }
    }
    // 位移（:66338-66339）：手心 − size/2 + num14+flip 向 ×(t/50)×20
    const prog = this.t / NUM * 20;
    this.x = this.owner.cx - this.w / 2 + Math.cos(num14 + flip) * prog;
    this.y = this.owner.cy - this.h / 2 + Math.sin(num14 + flip) * prog;
    this.owner.facing = this.dir;                    // :66342 ChangeDir(direction)
    // ---- 命中：Center±num14±110 线段厚 23、6t 冷却（:14618-14635/:7204）----
    this.hitCd.tick();
    const hx0 = this.cx - v5x * 110, hy0 = this.cy - v5y * 110;
    const hx1 = this.cx + v5x * 110, hy1 = this.cy + v5y * 110;
    this.applyHits(game, hx0, hy0, hx1, hy1);
    // ---- CutTiles ±60（:14159-14167：PlotTileLine 宽 width×scale）----
    for (let s = -60; s <= 60; s += 12) {
      const tx = Math.floor((this.cx + v5x * s) / 16), ty = Math.floor((this.cy + v5y * s) / 16);
      if (game.world.store.inBounds(tx, ty)) game.cutTile(tx, ty);
    }
  }

  private applyHits(game: GameHooks, x0: number, y0: number, x1: number, y1: number): void {
    // 城镇 NPC 巫毒窄门（Damage_PVE_Inner :11970-11972——玩家弹族同门；线段
    // 判定近似为线段中点外扩 23px 盒，与敌判定同盒）
    {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const bw = Math.max(46, Math.abs(x1 - x0)), bh = Math.max(46, Math.abs(y1 - y0));
      hitTownNpcs({ x: mx - bw / 2, y: my - bh / 2, w: bw, h: bh }, game,
        this.damage, Math.sign(this.vx) * 2, 'playerProj', 0);
    }
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      if (e.dead || !this.hitCd.ready(e.id, 6)) continue;
      if (!segHitsRect(x0, y0, x1, y1, 23, e)) continue;
      // ★BJ489 def-3：707 掷率=rollVanillaHitCrit（melee 旗,命中拍 owner 装配+:25712
      //  持械折入动态,critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
      //  （★BJ492②：708/709/1110 右键三型已收编同式,swCrit 出生拍冻结载体退役）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = crit ? this.damage * 2 : this.damage;
      const kdir = Math.sign((e.x + e.w / 2) - this.cx) || this.dir;
      hurtEnemy(game, e, dmg, crit, this.knockback, kdir, this.armorPen, this);
      // 浸剂三链（netMode/测试态 player 可为 null——null 门跳过，原版单机恒有主）
      const pl = game.player as unknown as { buffs?: { has: (b: never) => boolean }; equipStats?: { frostBurn: boolean; magmaStone: boolean } } | null;
      if (pl?.buffs) applyMeleeImbue(pl.buffs, e as unknown as Record<string, number>,
        () => game.spawnParticles(e.x + e.w / 2, e.y + e.h / 2,
          ['#FF6090', '#60FF90', '#6090FF', '#FFD040'][Math.floor(Math.random() * 4)], 6, 2.4, { life: 40, damp: 0.96 }));
      if (pl?.equipStats) {
        applyFrostBurn(pl.equipStats.frostBurn, e as unknown as Record<string, number>);
        applyMagmaStoneProj(pl.equipStats.magmaStone, e as unknown as Record<string, number>);
      }
    }
  }

  private kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.onEnd();                                    // player.reuseDelay = 2（:66275）
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(707);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const a = (255 - this.alphaI) / 255;             // GetAlpha 707：white×(255−alpha)（:76224-76228）
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);                            // 贴图 0 态朝右（AI_140 旋转原样）
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ================= 708 右键：椭圆弧挥舞（AI_142_MonkStaffT2And3 :66562-66641） =================

export class SkyDragonSwing extends Entity {
  readonly projId = 708;
  w = 24; h = 24;                                    // :7212-7213
  damage: number;                                    // = 武器 ×0.5（:48135）
  knockback: number;                                 // = 武器 kb+4（:48135）
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  lightRGB: [number, number, number] | null = [0.75, 0.9, 1.15];  // :66564

  private alphaI = 255;
  private rot = 0;
  /** 出膛向（velocity 冻结：num9 角 + num10 模长 36） */
  private aimAng: number;
  private aimLen: number;
  /** ai[0] 椭圆 y 半径（=(0.3+0.7r)×24×1.75×facing） */
  private ai0: number;
  private owner: DragonOwner;
  /** player.itemAnimation 剩余（swing.t 代理；itemAnimationMax=30） */
  private animT: () => number;
  private hitCd = new HitCd();
  /** 子弹 709 注入口（Game 注入 entities.add，防本文件循环依赖） */
  spawnShot: (x: number, y: number, vx: number, vy: number) => void = () => {};

  constructor(owner: DragonOwner, vx: number, vy: number, damage: number, knockback: number,
    animT: () => number, spawnShot: (x: number, y: number, vx: number, vy: number) => void) {
    super();
    this.owner = owner;
    this.x = owner.cx - this.w / 2;
    this.y = owner.cy - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.aimAng = Math.atan2(vy, vx);
    this.aimLen = Math.hypot(vx, vy) || 1;
    this.damage = damage;
    this.knockback = knockback;
    this.animT = animT;
    this.spawnShot = spawnShot;
    this.ai0 = (0.3 + 0.7 * Math.random()) * 24 * 1.75 * (owner.facing || 1);   // :48132
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (this.owner.dead) { this.dead = true; return; }
    const animMax = 30;                              // itemAnimationMax = useAnimation
    const at = this.animT();
    const facing = this.owner.facing;                // spriteDirection = direction = player.direction
    this.alphaI = Math.max(0, this.alphaI - 127);    // :66566-66570
    const prog = 1 - at / animMax;                   // num8 = 1 − itemAnimation/Max
    // spinningpoint2 = UnitX.RotBy(π+prog·2π) 分量 ×(num10=36, ai0)（:66576）
    const th = Math.PI + prog * TAU;
    const sx = Math.cos(th) * this.aimLen, sy = Math.sin(th) * this.ai0;
    const rotBy = (v: { x: number; y: number }, a: number) => ({
      x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a),
    });
    const sp = rotBy({ x: sx, y: sy }, this.aimAng);
    const fwd = rotBy({ x: this.aimLen + 22, y: 0 }, this.aimAng);        // num11=22 前伸
    this.x = this.owner.cx - this.w / 2 + sp.x + fwd.x;
    this.y = this.owner.cy - this.h / 2 + sp.y + fwd.y;
    cutTilesBox(game, this.x, this.y, this.w, this.h);                    // CutTiles（:12517/:15276;两门排除表均无 708）
    const tgt = rotBy({ x: this.aimLen + 22 + 40, y: 0 }, this.aimAng);   // 头前 40px 锚
    const txv = sp.x + tgt.x, tyv = sp.y + tgt.y;
    this.rot = Math.atan2(tyv, txv) + Math.PI / 4 * facing;               // :66579
    if (facing === -1) this.rot += Math.PI;                               // :66580-66583
    // anim 2/6/10 各一发 709（:66587-66605）：±0.3839725 扇形、速 10+Next(4)
    if (at === 2 || at === 6 || at === 10) {
      const off = at === 2 ? 0.3839724659919739 : at === 6 ? -0.3839724659919739 : 0;
      const a = this.aimAng + off;
      const spd = 10 + Math.floor(Math.random() * 4);
      this.spawnShot(this.cx, this.cy, Math.cos(a) * spd, Math.sin(a) * spd);
    }
    // 尘 k∈{0,2}（:66606-66640）：出生在弹盒 24×24 内（无定点覆写）、
    // 速度 = vector6(aim 向)×(4+4r)×num13×num12（1.2 / 0.5×1.5），scale 0.75 fadeIn 0.8
    const pool = game.vanillaDust;
    for (const k of [0, 2]) {
      const n12 = k === 2 ? 0.5 : 1;
      const n13 = (k === 2 ? 1.25 : 1) * 1.2;
      if (Math.random() < 1 / 6) continue;
      const sp2 = (4 + 4 * Math.random()) * n13 * n12;
      const ux = Math.cos(this.aimAng), uy = Math.sin(this.aimAng);
      const d = pool ? pool.spawn(this.x, this.y, this.w, this.h, 226, 0, 0, 100) : null;
      if (d) {
        d.vx = ux * sp2; d.vy = uy * sp2;
        d.scale = 0.75; d.fadeIn = 0.8;
        d.noGravity = Math.random() < 0.75;
        d.noLight = true;
      }
    }
    // ---- 命中（默认 24×24 AABB、6t 冷却、penetrate −1）----
    this.hitCd.tick();
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2, 'playerProj', 0);   // 巫毒窄门（无娃娃 no-op）
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      if (e.dead || !this.hitCd.ready(e.id, 6)) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ492②（2026-10-04）静态载体退役→rollVanillaHitCrit 单源（BJ491① 衔接判语
      //  兑现;BJ486② 惯例）——708 SetDefaults（:7493-7501 亲读）melee=true → 三类掷
      //  :12916 达=owner.meleeCrit（:25712-14 逐帧折入=基4+持械 item.crit+crt+装备/buff
      //  聚合,命中拍动态;与左键 707 面 BJ489 迁移同形,时序差收口）。critChance 字段
      //  保留=关断钉（critChance≤0 门,sun 站 skydragon.test.ts 同相）;伤害面不动。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = crit ? this.damage * 2 : this.damage;
      hurtEnemy(game, e, dmg, crit, this.knockback,
        Math.sign((e.x + e.w / 2) - this.cx) || this.owner.facing, this.armorPen, this);
    }
    if (at <= 2) { this.dead = true; }               // :66643-66647（anim≤2 Kill/reuseDelay2）
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(708);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
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

// ================= 709：天龙弹（aiStyle1 直飞 + Kill→1110 星圈） =================

export class SkyDragonShot extends Entity {
  readonly projId = 709;
  w = 7; h = 7;                                      // (12×scale0.6)（:7229-7231/:10076）
  damage: number;
  knockback = 0;                                     // NewProjectile kb=0（:66604）
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;
  lightRGB: [number, number, number] | null = [0.4, 0.85, 0.9];  // :51828

  /** ai[1]：AI 次计数（30 次寿命 :51833-51838；extraUpdates=1 → 每 tick 2 次） */
  private upd = 0;
  private alphaI = 255;
  private frame = 0;
  private frameCtr = 0;
  private drawScale = 0.6;
  /** 1110 注入口（Game 注入） */
  spawnCircle: (x: number, y: number, dmg: number) => void = () => {};
  /** 同主在场 1110 消费口（亡爆 :70256-70264） */
  consumeCircles: (x: number, y: number) => void = () => {};

  // ---- ★BJ704-G2（债① 709 员）：oldPos 残影环（mode0;extraUpdates=1 → 2 子步/t
  //      逐子步记录,UpdateTrails :17198 位移后位序;MinionProj 755 接线式同构）。 ----
  private ghostRing = new ProjGhostRing(709);
  private recordGhostTrail(): void {
    this.ghostRing.record(this.x, this.y, 0, 1, true);   // mode0 只记 oldPos
  }

  constructor(x: number, y: number, vx: number, vy: number, damage: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    for (let i = 0; i < 2 && !this.dead; i++) this.step(game);   // extraUpdates=1（MaxUpdates2）
  }

  private step(game: GameHooks): void {
    this.alphaI = Math.max(0, this.alphaI - 30);     // :51811-51816
    if (++this.frameCtr >= 3) {                      // 3 帧 3t（:51817-51826）
      this.frameCtr = 0;
      this.frame = (this.frame + 1) % 3;
    }
    if (this.upd === 0) {                            // :51829-51832 首帧音
      game.playSfxFiles(soundTrackFiles('dd2_sky_dragons_fury_shot'), 1, this.cx, this.cy);
    }
    this.upd += 1;
    if (this.upd >= 30) { this.explode(game); return; }
    this.vy += 0.3;                                  // aiStyle1 箭重力
    this.x += this.vx;
    this.y += this.vy;
    cutTilesBox(game, this.x, this.y, this.w, this.h);          // CutTiles（:12517/:15276;两门排除表均无 709）
    const st = game.world.store;
    const tx = Math.floor(this.cx / 16), ty = Math.floor(this.cy / 16);
    if (!st.inBounds(tx, ty) || st.get(tx, ty) !== 0 && st.isSolid(tx, ty)) { this.explode(game); return; }
    // ★BJ704-G2：UpdateTrails 位序（:17198 位移后,每子步一记——step() 每.tick 跑 2 次）
    this.recordGhostTrail();
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2, 'playerProj', 0);   // 巫毒窄门
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ492②（2026-10-04）静态载体退役→rollVanillaHitCrit 单源（709 SetDefaults
      //  :7510-7518 亲读 melee=true → 三类掷 :12916 达,命中拍动态;关断钉保留,伤害面不动）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = crit ? this.damage * 2 : this.damage;
      hurtEnemy(game, e, dmg, crit, this.knockback, Math.sign(this.vx) || 1, this.armorPen, this);
      this.explode(game);                            // penetrate 1 → 命中即 Kill
      return;
    }
  }

  /** Kill 链（:70218-70290 scale<1 档）：尘爆 + 消费旧圈 + 新 1110 */
  private explode(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
    const pool = game.vanillaDust;
    for (let i = 0; i < 3; i++) {                    // num366=3 尘 31
      const a = Math.random() * TAU, rr = Math.random() * (this.w / 2);
      sparkDust(game, this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr, 0, 0);
    }
    for (let i = 0; i < 10; i++) {                   // num367=10 尘 226 环
      const a = Math.random() * TAU, rr = Math.random() * (this.w / 2);
      const d = pool ? pool.spawn(this.x, this.y, this.w, this.h, 226, 0, 0, 0) : null;
      boltDust(game, d, this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr, 0, 0, 1.5, 0);
    }
    game.spawnParticles(this.cx, this.cy, '#8FE8FF', 6, 1.6, { life: 18 });   // 近似补底
    this.consumeCircles(this.cx, this.cy);           // 80×80 内旧圈 ai1=1（:70255-70264）
    this.spawnCircle(this.cx, this.cy, this.damage); // 新 1110（:70265-70270）
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(709);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const fh = img.height / 3;                // 36×102 = 3 帧
    // :58624-58631 旋转组 435|459|682|709：rotation=ToRotation()+(direction==-1?π:0)
    // + AI_001 709 块 :55666 spriteDirection=direction 镜像。★BJ704-G2 勘误：旧式
    // 有 +π 缺镜像（左飞水平翻转缺失,709 贴图 73-80% 非对称 D2 普查可见;角注释
    // :54760-54766 系错锚=鱼漂域）。★A 面：GetAlpha :81063-81066 (255,255,255,200)
    // 恒——α−30 淡入无视觉面（旧 (255−α)/255 渐显系误读;vanillaProjAlpha[709]
    // fixed 200 档本类消费,SKIP 位解除）。
    const rot = Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0);
    const a = 200 / 255;
    // ---- ★BJ704-G2（债① 709 员）：通用残影（P(1,8,2,0.5),先于本体）。色=
    //      GHOST_TINT[709] 白染 aMul 200/255;bodyW/H=SetDefaults 盒 12（判定盒
    //      7×7=(12×0.6) 绘制解耦,ghost 锚=Size/2）;bodyScale=0.6（SetDefaults scale,
    //      ghost 比例 Lerp(0.6,0.5,i/15)）;帧锚=当前帧行（3 帧循环）。 ----
    if (this.ghostRing.filled > 0) {
      drawProjGhosts(ctx, {
        ring: this.ghostRing,
        id: 709,
        tex: img,
        frames: 3,
        frame: this.frame,
        bodyW: 12, bodyH: 12,
        bodyRot: rot,
        bodyScale: this.drawScale,
        bodyAlpha: 1,          // GetAlpha 恒 (255,255,255,200)——A 面在 aMul,α 不读
        ai0: 0, ai1: 0,
        timeLeft: 30 - this.upd,
        opacity: 1,
        vxLen: Math.hypot(this.vx, this.vy),
        spriteDirection: this.vx < 0 ? -1 : 1,
        mirror: this.vx < 0,
      });
    }
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(rot);
    if (this.vx < 0) ctx.scale(-1, 1);   // spriteDirection=direction（:55666）
    ctx.imageSmoothingEnabled = false;
    const dw = img.width * this.drawScale, dh = fh * this.drawScale;
    ctx.drawImage(img, 0, this.frame * fh, img.width, fh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ================= 1110：滞留星圈（aiStyle 77 :29583-29700） =================

export class SkyDragonCircle extends Entity {
  readonly projId = 1110;
  w = 80; h = 80;                                    // :10059-10060（脉动 [62,80]，floor）
  damage: number;
  knockback = 0;
  critChance = 0.04;
  armorPen = 0;
  meleeProj = true;
  dead = false;

  /** ai[0] 脉动相位（>120 回 0） */
  private ai0 = 0;
  /** ai[1]：0 滞留 / 1 被消费（渐隐退场） */
  private ai1 = 0;
  private alphaI = 255;
  private frame = 0;
  private frameCtr = 0;
  private timeLeft: number;
  /** friendly 旗（消费后退场不再判定 :29604-29606） */
  private friendlyT = true;
  /** ★BJ294（件 2）中央割门运行时覆写口：渐隐退场相（consume 后 ai[1]==1）原版
   *  `friendly = false`（aiStyle77 P.cs:31213-31226）→ CutTiles 门（:12515）不进。
   *  U3 旧锚 :29128/:29156 系行段漂移（那两行在 aiStyle54 块）。 */
  get noVanillaCut(): boolean { return !this.friendlyT; }
  private hitCd = new HitCd();
  private cx0 = 0; private cy0 = 0;

  constructor(x: number, y: number, damage: number, timeLeft: number) {
    super();
    this.cx0 = x; this.cy0 = y;
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.damage = damage;
    this.timeLeft = timeLeft;                        // 30×Next(2,6)（:70271-70272）
  }

  /** 709 亡爆消费（ai[1]=1 → friendly=false 渐隐 :29604-29616） */
  consume(): void { this.ai1 = 1; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (--this.timeLeft <= 0) { this.dead = true; return; }
    if (this.ai1 === 1) {                            // 渐隐退场（alpha+51 → ≥255 Kill）
      this.friendlyT = false;
      this.alphaI = Math.min(255, this.alphaI + 51);
      if (this.alphaI >= 255) { this.dead = true; return; }
    } else {
      this.alphaI = Math.max(0, this.alphaI - 50);   // 渐入（:29620-29627）
    }
    this.ai0 += 1;                                   // :29631-29635
    if (this.ai0 > 120) this.ai0 = 0;
    // 脉动尺寸（:29636-29642）：vector52.Y=−cos(2π·ai0/30)
    const v52y = -Math.cos(TAU * this.ai0 / 30);
    const n641 = Math.max(0.75 + v52y * 0.25, 0.8 - v52y * 0.2);
    const size = Math.floor(80 * n641);
    this.x = this.cx0 - size / 2;
    this.y = this.cy0 - size / 2;
    this.w = size; this.h = size;
    // ★BJ294（件 2）回收期拒割：CutTiles 在原版 Damage() 内 `friendly && …`（:12515）
    //  门下——渐隐退场相 friendly=false（:31215）不割;旧自砍面无此门=渐隐相照割
    //  （多割相位差）——补 friendlyT 门,与中央门 noVanillaCut 覆写口同相。
    if (this.friendlyT) cutTilesBox(game, this.x, this.y, this.w, this.h);   // CutTiles（:12517/:15276;两门排除表均无 1110）
    if (++this.frameCtr >= 3) {                      // 4 帧 3t（:29643-29652）
      this.frameCtr = 0;
      this.frame = (this.frame + 1) % 4;
    }
    // 尘 226 环（:29653-29680：半径 11·n641 + rand·55·n641）
    const pool = game.vanillaDust;
    {
      const rr = 11 * n641 + Math.random() * 0.5 * 55 * n641;
      const a = Math.random() * TAU;
      const px = this.cx0 + Math.cos(a) * rr, py = this.cy0 + Math.sin(a) * rr;
      const d = pool ? pool.spawn(this.x, this.y, this.w, this.h, 226, 0, 0, 100) : null;
      if (d) {
        d.x = px; d.y = py;
        d.scale = Math.random() < 0.5 ? 0.5 : 0.9;
        d.noGravity = true; d.noLight = true;
        const dl = Math.hypot(px - this.cx0, py - this.cy0) || 1;
        d.vx = d.vx / 2 + (px - this.cx0) / dl;
        d.vy = d.vy / 2 + (py - this.cy0) / dl;
      }
    }
    // ---- 判定（friendly 门 + 8t 免疫 + penetrate −1 :13052-13054）----
    if (!this.friendlyT) return;
    this.hitCd.tick();
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2, 'playerProj', 0);   // 巫毒窄门（无娃娃 no-op）
    for (const ent of game.enemies()) {
      const e = ent as unknown as EnemyLike;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      if (e.dead || !this.hitCd.ready(e.id, 8)) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ492②（2026-10-04）静态载体退役→rollVanillaHitCrit 单源（1110 SetDefaults
      //  :10342-10351 亲读 melee=true → 三类掷 :12916 达,命中拍动态;旧 :13670
      //  `circle.critChance=shot.critChance` 沿载体写位随刀摘除——圈面自掷同单源;
      //  关断钉保留,伤害面不动）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = crit ? this.damage * 2 : this.damage;
      hurtEnemy(game, e, dmg, crit, this.knockback,
        Math.sign((e.x + e.w / 2) - this.cx0) || 1, this.armorPen, this);
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(1110);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const a = (255 - this.alphaI) / 255;
    if (a <= 0.02) return;
    const fh = img.height / 4;                // 102×408 = 4 帧
    ctx.save();
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, this.frame * fh, img.width, fh,
      this.cx0 - img.width / 2, this.cy0 - img.height / 2,
      img.width, fh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
