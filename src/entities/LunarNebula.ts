// 月总双魔法武器 1:1（1.4.5.6 反编译全链）：
//   星云烈焰 3542 → 弹 634（普发）/635（20% 强发 Damage×3，else 速 −1——
//     Player.cs:46489-46498）；AI_001 :51577-51762：ai[1] 状态机（0 初始化
//     Item34 音 → 1 每 update 搜敌（634 半径 250 / 635 500 + CanHitLine 视线；
//     距敌 <20 即 Kill）→ 锁定 ai[1]=6、ai[0]=敌 → >5 追踪（vel = lerp(vel,
//     朝向×6, 1/30)；目标失效回 1）；无重力（:54638 排除 634/635）；40×40 盒、
//     extraUpdates 634=2（:6826 → 3 子步/拍）/ 635=3（:6837 → 4 子步/拍,子步环
//     :16780-16782 numUpdates 3→0 逐值 4 圈）、alpha 淡入 40/子步、4 帧（帧阀
//     num32 :55434 4×MaxUpdates=12 / :55443 635 专改 3×MaxUpdates=12——两档同
//     值 12,故 634 帧 4 拍/帧、635 帧 3 拍/帧）、
//     尘椭圆 (8,10)/(10,20) 旋转 π/24 + 4 组随机尘。Kill :68745-68807：盒扩
//     50×50 居中 + Damage()（penetrate −1 小 AoE）+ Item14 音 + 40+20 尘爆。
//   月耀 3570 → 弹 645×3 天降（Player.cs:47072-47097：X = 玩家中 + Next(201)
//     ×(−dir) + (鼠标−玩家) 再与玩家中点折叠 + Next(−200,201)、Y = 手心 −600
//     −100×i；速度 = 朝鼠标单位向（|dy| 钳 ≥20）× speed/2；ai[1] = 鼠标世界 Y 线）；
//     AI_001 :54077-54137：飞行相 alpha 恒 255（GetAlpha :76171 → 不可见，视觉
//     = 每 update 尘 229 尾迹）；Y 过线开 tileCollide；每 tick 首 update 搜敌
//     60px + 视线 → 爆炸相（ai[1]=−1：vel 0、盒 140×140、alpha −10/次、帧每
//     18 update、7×6×3=126 update 后 Kill）；NPC 命中同转爆炸（:16706-16710）；
//     Kill :68851-68866：4×尘 31 + 4×尘 229（×3 速）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite, projFrameCount } from './Arrow';
import { canBeChasedBy, playerCanHitEnemy, hitCritters, hitCrittersAll } from './projTargets';
import { ghostHealProc, ghostHurtOnHit, playerHasGhostHurt, snapshotVanillaGate, vanillaGateRejected } from './SpectreSoulProj';   // ★BJ380 ghostHeal proc 单源（★BJ382 提升至 SpectreSoulProj 域导出;★清偿刀 T 门位快照单源;★BJ424-T3 补 ghostHurt 漏斗面）
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424-T3 星云套装 on-hit 单源（自持命中环面收编）
import { canHit, canHitLine } from '../physics/LineOfSight';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ285 死亡段割面（BJ260 同款前置习语）
import { rollVanillaHitCrit } from './proj1457';   // ★BJ489 def-3 掷率单源（函数声明环=运行时调用安全）

type EnemyLike = {
  x: number; y: number; w: number; h: number; id: number; dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
};

const TAU = Math.PI * 2;

/** 通用命中（音效 + hurt + 飘字）。★X2-D1 勘误（2026-09-29）：Enemy.hurt 布尔返真=
 *  「本拍击杀/假人」（Enemy.ts:15033/:14184）【非】受理位——返假三族=门拒（dead:13971/
 *  iframes:13972/dontTakeDamage:13978）+血尽级联（:14369 族,伤害已实扣=原版受理）+
 *  普通未致命尾档（:15037）。受理面谓词=调用侧 !vanillaGated（读门位）,本返回值
 *  不再消费（BJ393 判据,击杀位契约退役） */
/** pierce：Enemy.hurt 免疫门选档（Enemy.ts:13988）——0=门照走+受理写 10t（通用缺省
 *  档 :14176-14182 尾档）/1=flag3 单发弹豁免（:12635 maxPenetrate==1 缺省链,三不写）/
 *  -2=门照走+三不写（★清偿刀 R:634/635 Kill AoE——门 :12636 照走〔Kill :73265-73269
 *  先置 maxPenetrate=-1,flag3 假〕,写支 :14294-14295 两档全不达,窗值由弹侧补写
 *  :14080-14082 专支 5t;与孢子云 567/568 IDStatic 三不写档同行为位）/
 *  -3=usesLocal 族清零档（★清偿刀 L:645 爆相——门 :12636 照走,受理写 immune[owner]=0
 *  :14175-14178,节流全归弹侧局部表,多星齐射不互饿） */
function strike(game: GameHooks, e: EnemyLike, dmg: number, crit: boolean, kb: number, kdir: number, pen: number, pierce = 0): boolean {
  return e.hurt(dmg, kdir * kb, 0, game, pen, crit, pierce, true);   // 音/飘值=单点;fromPlayer=DPS 计
}

// ================= 星云烈焰弹 634/635（AI_001 :51577-51762） =================

export class NebulaBlazeBolt extends Entity {
  readonly projId: number;                          // 634 普 / 635 强（20% Damage×3 档）
  w = 40; h = 40;                                   // :6539-6540
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  /** ★BJ380：PVE 受理命中计数（原版 Projectile.numHits——SetDefaults :706 起始 0;
   *  :14263 自增在 ghostHeal proc(:13877-79)【后】⇒ proc 读自增前值,首跳 0 档率 0.20;
   *  ★X2-D1 勘误：受理=非门拒（!vanillaGated,读门位）非 hurt 返真——门拒（iframes/
   *  dontTakeDamage）不计数,血尽级联/普通未致命返假照计数）。字段名对齐
   *  SpectreSoulProj.projPveNumHits 读口（PVP 反馈 BJ157-④ 单源） */
  pveNumHits = 0;
  /** 点光：634 (0.7,0.1,0.5) / 635 (0.4,0.6,0.9)（:51584/:51597） */
  lightRGB: [number, number, number] | null;

  /** ai[1]：0 初始化 / 1 搜敌 / 6+ 追踪（num28=5） */
  private ai1 = 0;
  /** ai[0]：目标敌 id（634/635 在 flag3 排除表 :53152 → ai[0] 不自增） */
  private ai0 = 0;
  /** localAI[0]：尘椭圆相位（−Next(48) 起步，48 回绕） */
  private lai0: number;
  /** ★R28 出手散射补掷门（首帧一次,见 fixedUpdate 注） */
  private birthSpreadDone = false;
  private alphaI = 255;
  private frame = 0;
  private frameCtr = 0;
  private rot = 0;
  /** 参数档：[搜索半径, 尘椭圆(x,y), 尘 scale, 光色, 尘基色表, 尘底色] */
  private cfg: { seek: number; ex: number; ey: number; scale: number; rgb: [number, number, number]; palette: number[]; base: number };

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1;溅花
  //  尘/音由共享体 wetSplashStepShared 承载,本类不自写）——原版逐子步跑
  //  （extraUpdates 环 :16779,AI → 湿段 :16903 → HandleMovement :17120）,故接入
  //  点在 step() 内（每子步）而非 fixedUpdate 头）----
  //  豁免核对（双 variant 合类）：634 NebulaBlaze1 SetDefaults P.cs:6818-6828
  //  （40×40/aiStyle 1/friendly/alpha 255/ignoreWater=true【:6825】/extraUpdates 2/
  //  magic）→ 豁免 id 段门恒闭（:16903）;635 NebulaBlaze2 P.cs:6829-6839（40×40/
  //  aiStyle 1/friendly/alpha 255/friendly/extraUpdates 3/magic）【无】ignoreWater 行
  //  → 受段（数据面 PROJ_IGNORE_WATER 含 634 不含 635）。两 id ∉ IsDestroyedByWater
  //  六型、非 2/34/80/155。
  //  阻尼：635 tileCollide 缺省 true → 湿阻尼支 :17721-17764 跑,速度积分行乘档
  //  （速度场不减只削当拍位移;追踪 Lerp 速度编辑照常）;634 豁免旗恒 false → 档=1
  //  数值恒等。aiStyle 1 不在 UpdatePosition 早退表（:20551）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首子步同位测值） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number, variant: 634 | 635) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.projId = variant;
    this.rot = Math.atan2(vy, vx);
    this.lai0 = -Math.floor(Math.random() * 48);
    if (variant === 635) {
      this.cfg = { seek: 500, ex: 10, ey: 20, scale: 1, rgb: [0.4, 0.6, 0.9], palette: [242, 59, 88], base: 88 };
    } else {
      this.cfg = { seek: 250, ex: 8, ey: 10, scale: 1.2, rgb: [0.7, 0.1, 0.5], palette: [242, 73, 72, 71, 255], base: 255 };
    }
    this.lightRGB = this.cfg.rgb;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // ★R28 §5 出手散射（Player.cs:49282-49296,3542 专支）：num179 =
    //   (rand−0.5)×(π/4)×0.7 ≈ ±15.75°,CanHit 失败重掷至多 10 次;vector56 =
    //   基准向.RotatedBy(num179)×(0.95+rand×0.3)。发射挂点在 Game.ts（R26 蓝队
    //   分区）→ 首帧在此对出膛向量补掷（本弹即原版该发）
    if (!this.birthSpreadDone) {
      this.birthSpreadDone = true;
      const spd0 = Math.hypot(this.vx, this.vy);
      if (spd0 > 0.01) {
        let rot = (Math.random() - 0.5) * (Math.PI / 4) * 0.7;
        for (let t = 0; t < 10; t++) {
          const ux = Math.cos(rot), uy = Math.sin(rot);
          if (canHitLine(game.world.store, this.x, this.y, 0, 0,
            this.x + ux * 100, this.y + uy * 100, 0, 0)) break;
          rot = (Math.random() - 0.5) * (Math.PI / 4) * 0.7;       // 重掷
        }
        const c = Math.cos(rot), s = Math.sin(rot);
        const nvx = (this.vx * c - this.vy * s) * (0.95 + Math.random() * 0.3);
        const nvy = (this.vx * s + this.vy * c) * (0.95 + Math.random() * 0.3);
        this.vx = nvx; this.vy = nvy;
        this.rot = Math.atan2(nvy, nvx);
      }
    }
    // 子步数 = extraUpdates+1（Update :16780-16782 `numUpdates = extraUpdates;
    // while (numUpdates >= 0) { numUpdates--; 体内全跑 }` → 634 extraUpdates=2
    // （:6826）3 圈 / 635 extraUpdates=3（:6837）4 圈）。step() 内逐子步面 =
    // 原版子步环内逐面（AI_001 状态机/视觉/全尘 :55426-55609 → 湿段 :16892 →
    // HandleMovement :17120/UpdatePosition :20551 → Damage :17158）,勿上提。
    // 634 同族核对：同分支共享全部 AI 面(:55426 起双 id 合一),豁免面仅湿段
    // （ignoreWater=true :6825 + 数据面）与阻尼（豁免旗 false → 档恒 1）,无遗漏。
    for (let i = 0; i < (this.projId === 635 ? 4 : 3) && !this.dead; i++) this.step(game);
  }

  private step(game: GameHooks): void {
    const NUM28 = 5;                                 // 搜敌宽限
    // ---- ai[1] 状态机（:51600-51658）----
    if (this.ai1 === 0) {
      this.ai1 = 1;
      this.lai0 = -Math.floor(Math.random() * 48);
      game.playSfxFiles(['Item_34'], 1, this.x, this.y);   // :51604-51605
    } else if (this.ai1 === 1) {
      let target: EnemyLike | null = null;
      let bd = this.cfg.seek;
      for (const ent of game.enemies()) {
        const e = ent as unknown as EnemyLike;
        if (!canBeChasedBy(e)) continue;   // CanBeChasedBy :91070——友好 NPC 不入索敌（防追踪睡渔夫）
        if (e.dead) continue;
        const d = Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy);
        if (d < bd && canHit(game.world.store, this.cx, this.cy, 0, 0, e.x + e.w / 2, e.y + e.h / 2, 0, 0)) {
          bd = d; target = e;
        }
      }
      if (bd < 20) { this.burst(game); return; }     // :51624-51627 贴脸即爆
      if (target) { this.ai1 = NUM28 + 1; this.ai0 = target.id; }
    } else if (this.ai1 > NUM28) {
      this.ai1 += 1;
      let target: EnemyLike | null = null;
      for (const ent of game.enemies()) {
        const e = ent as unknown as EnemyLike;
        if (!e.dead && e.id === this.ai0) { target = e; break; }
      }
      if (!target) { this.ai1 = 1; this.ai0 = 0; }   // :51640-51646
      else {
        const dx = target.x + target.w / 2 - this.cx, dy = target.y + target.h / 2 - this.cy;
        const d = Math.hypot(dx, dy);
        if (d < 20) { this.burst(game); return; }    // :51652-51654
        const NUM30 = 6, NUM40 = 30;
        this.vx = (this.vx * (NUM40 - 1) + dx / d * NUM30) / NUM40;
        this.vy = (this.vy * (NUM40 - 1) + dy / d * NUM30) / NUM40;
      }
    }
    if (this.ai1 >= 1 && this.ai1 < NUM28) {         // :51659-51666（过渡带）
      this.ai1 += 1;
      if (this.ai1 === NUM28) this.ai1 = 1;
    }
    // ---- 视觉（:51667-51703）----
    this.alphaI = Math.max(0, this.alphaI - 40);
    if (++this.frameCtr >= 12) {                     // num32：634 4×MaxUpdates(:55434)=12 / 635 3×MaxUpdates(:55443)=12——原版两式同值,帧阀恒 12
      this.frameCtr = 0;
      this.frame = (this.frame + 1) % 4;
    }
    this.rot = Math.atan2(this.vy, this.vx);
    this.lai0 += 1;
    const pool = game.vanillaDust;
    if (this.lai0 === 48) this.lai0 = 0;
    else if (this.alphaI === 0 && pool) {
      for (let i = 0; i < 2; i++) {                  // 尘椭圆双螺旋
        const a = -Math.PI / 2 + this.lai0 * (Math.PI / 24) + i * Math.PI;
        const d = pool.spawn(this.cx, this.cy, 0, 0, this.cfg.base, 0, 0, 160);
        if (!d) break;
        d.scale = this.cfg.scale;
        d.noGravity = true;
        d.x = this.cx + Math.cos(a) * this.cfg.ex - Math.cos(this.rot) * 10 + this.vx * 2;
        d.y = this.cy + Math.sin(a) * this.cfg.ey - Math.sin(this.rot) * 10 + this.vy * 2;
        const tdx = this.cx + this.vx * 16 - d.x, tdy = this.cy + this.vy * 16 - d.y;
        const tl = Math.hypot(tdx, tdy) || 1;
        d.vx = tdx / tl * 2 + this.vx * 2;
        d.vy = tdy / tl * 2 + this.vy * 2;
      }
    }
    if (pool) {
      const back = (spread: number) => Math.PI + (Math.random() * 2 - 1) * spread + this.rot;
      const half = this.w / 2;
      if (Math.random() < 1 / 12) {                  // 尘 31 拖尾（:51745-51753）
        const d = pool.spawn(this.x, this.y, this.w, this.h, 31, 0, 0, 100);
        if (d) {
          d.vx *= 0.1; d.vy *= 0.1;
          d.x = this.cx + Math.cos(back(0.19635)) * half + this.vx * 2;
          d.y = this.cy + Math.sin(back(0.19635)) * half + this.vy * 2;
          d.fadeIn = 0.9; d.noGravity = true;
        }
      }
      if (Math.random() < 1 / 64) {                  // 尘 31 微光（:51763-51775）
        const d = pool.spawn(this.x, this.y, this.w, this.h, 31, 0, 0, 155, null, 0.8);
        if (d) {
          d.vx *= 0.3; d.vy *= 0.3;
          d.x = this.cx + Math.cos(back(0.3927)) * half;
          d.y = this.cy + Math.sin(back(0.3927)) * half;
          if (Math.random() < 0.5) d.fadeIn = 1.4;
        }
      }
      if (Math.random() < 1 / 4) {                   // 尘彩色族 ×2（:51776-51788）
        for (let i = 0; i < 2; i++) {
          const d = pool.spawn(this.x, this.y, this.w, this.h,
            this.cfg.palette[Math.floor(Math.random() * this.cfg.palette.length)], 0, 0, 0, null, 1.2);
          if (!d) break;
          d.vx *= 0.3; d.vy *= 0.3;
          d.noGravity = true;
          d.x = this.cx + Math.cos(back(0.7854)) * half;
          d.y = this.cy + Math.sin(back(0.7854)) * half;
          if (Math.random() < 0.5) d.fadeIn = 1.4;
        }
      }
      if (this.projId === 634 && Math.random() < 1 / 12) {   // 634 尾焰（:51745 前段）
        const d = pool.spawn(this.x, this.y, this.w, this.h, 255, 0, 0, 100);
        if (d) {
          d.vx *= 0.3; d.vy *= 0.3;
          d.x = this.cx + Math.cos(back(0.19635)) * half;
          d.y = this.cy + Math.sin(back(0.19635)) * half;
          d.fadeIn = 0.9; d.noGravity = true;
        }
      }
      if (this.projId === 635 && Math.random() < 1 / 3) {    // 635 尾焰（:51754-51762）
        const d = pool.spawn(this.x, this.y, this.w, this.h, 88, 0, 0, 100, null, 1.5);
        if (d) {
          d.vx *= 0.3; d.vy *= 0.3;
          d.x = this.cx + Math.cos(back(0.19635)) * half;
          d.y = this.cy + Math.sin(back(0.19635)) * half;
          d.fadeIn = 1.2; d.noGravity = true;
        }
      }
    }
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1,逐子步）----
    // 位序 = 原版 Update 逐子步:AI_001（追踪态机/视觉完）→ 本段 → HandleMovement
    // （阻尼在下方位移行）。projId 634 豁免 → 段门恒闭;635 受段。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // ---- 位移 + 撞块（aiStyle1 直飞无重力 + tileCollide）----
    // 水中位移阻尼（HandleMovement :17721-17764 + UpdatePosition :20557-20562）——
    // 635 tileCollide=true 宿主:速度场不减只削当拍位移（634 豁免旗恒 false → 档=1 恒等）
    const dfNeb = projWaterDragFactor(this);
    this.x += this.vx * dfNeb;
    this.y += this.vy * dfNeb;
    const st = game.world.store;
    const tx = Math.floor(this.cx / 16), ty = Math.floor(this.cy / 16);
    if (!st.inBounds(tx, ty) || st.get(tx, ty) !== 0 && st.isSolid(tx, ty)) { this.burst(game); return; }
    // ---- 命中（40×40 盒 penetrate 1 → Kill 爆）----
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（P.cs:12517）先于 Damage_PVE
    //  （:12523）——634/635 penetrate 缺省 1 首中即亡拍【照割】（SetDefaults :6818-6841,
    //  aiStyle 1/friendly/magic）;中央割 !e.dead 门=死亡拍整缺 → BJ260 前置习语。
    //  两型均过两道门（CanCutTiles :15407 两表均无;Damage_CanDealDamage :12461 无）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    // ★X2-D3（2026-09-29）小动物命中面：原版 Damage() 单趟 victim 循环
    //  （Projectile.cs:12618）对 Main.npc 全体——critter 恒在内,本仓独立桶不被扫到
    //  =飞行盒对小动物零受击。penetrate 缺省 1（SetDefaults :6818-6841 无 penetrate
    //  行,:366 字段缺省）→ :14189-14196 递减归零 → :17312 Kill = burst 同相（敌怪
    //  首中即爆同款）。桶序先小动物（BJ383 桶序登记近似）;critter lifeMax≤5 经
    //  flag10 lifeMax>5 段（:13712）恒不吸血 → 只入账不 proc（BJ383 判例）;
    //  :14263 numHits++ 对 critter 受理命中同达 → 入账（1115 先例同式）。
    if (hitCritters(this, game)) { this.pveNumHits++; this.burst(game); return; }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as EnemyLike;
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ489 def-3：掷率=rollVanillaHitCrit（634/635 magic 旗,命中拍 owner 装配+
      //  :25712 持械折入动态,critTotal 出生拍冻结载体退役）;critChance≤0 关断钉保留
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // ★X2-D1（2026-09-29,BJ393 判据推广）：受理面谓词=读门位非 hurt 返真——返假
      //  三族=门拒（dead:13971/iframes:13972/dontTakeDamage:13978）+血尽级联（:14369
      //  族,伤害已实扣=原版受理）+普通未致命尾档（:15037）。原版 proc（:13877-79）/
      //  numHits++（:14263）在受理面无死亡复查 → 门拒不 proc 不计数,非门拒照 proc
      //  照计数。旧「strike 返真」=击杀位判据对非致死命中整面不 proc,退役。
      //  ★清偿刀 F（2026-09-29,清偿刀 B 新立债#1）：飞行盒 flag3 豁免定谳——
      //  maxPenetrate 缺省链 :366（字段缺省 1;SetDefaults :6818-6839 无 penetrate/
      //  usesLocalNPCImmunity 行）→ :10675 `maxPenetrate = penetrate` → :12635
      //  flag3=真 → :12636 免疫门不拦=iframes 残窗内第二发飞行盒照打（旧 strike 传
      //  pierce=0 → Enemy.ts:13988 门拒整跳=假红窗,原版本相照打）。受理残门仅
      //  dontTakeDamage（:12600;dead 已前置;flag4 immortal&&npcProj/trap 对玩家弹恒假）。
      //  命中写支：:14080-14082 634/635 专支无条件写 immune[owner]=5（残窗余值同被
      //  覆写）——Enemy.hurt pierce=1 档三不写（BJ340 F-A 判谳面向「无类型写支」的
      //  泛 flag3 弹,405 泡泡等）→ 该写支在弹侧受理面补写。窗的消费者=后续非 flag3
      //  弹（本弹 penetrate 1→0 :14196 → Kill :17312;Kill AoE :73267 先置
      //  maxPenetrate=-1 → flag3 假 → 被 skipId+此窗双重挡=原版同相）。
      // ★清偿刀 T（X4-债12,2026-09-29）：门位读前置快照（读侧单源 snapshotVanillaGate
      //  ——判据=「进 hurt 前状态」,原版免疫门 :12634-12637/:12686 全读 StrikeNPC 前）。
      //  pierce=1 flag3 臂 iframes 不构成门拒（:12635）→ exemptIframes=true,可达门拒
      //  仅 dontTakeDamage（:12686;本站原后置读与快照等位——hurt 无 dontTakeDamage
      //  写支,唯四塔转换写 iframes 不写旗=本就无污染;转快照为全族单源同形）。
      const gate = snapshotVanillaGate(e);
      strike(game, e, this.damage, crit, this.knockback,   // ★S02:crit ×2=Enemy.hurt 防后
        Math.sign((e.x + e.w / 2) - this.cx) || 1, this.armorPen, 1);
      const accepted = !vanillaGateRejected(gate, true);
      if (accepted) {
        (e as { iframes?: number }).iframes = 5;                // :14080-14082 专支写 5t
        ghostHealProc(game, this.projId, this.pveNumHits, e);   // :13877-79（读自增前值）
        // ★BJ424-T3 魔法命中漏斗面收编：ghostHurt :13881 / nebula :13885 与 ghostHeal
        //  :13877 同块同受理面（634/635 数据面 magic ⇒ 凡走本面两引擎都该触发）。
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
        this.pveNumHits++;                                      //（:14263 受理后自增）
      }
      this.burst(game, e.id);
      return;
    }
  }

  /** Kill 链（:68745-68807）：50×50 居中 AoE + Item14 + 尘爆。
   *  skipId = 刚被飞行盒命中的敌（原版由飞行盒写支 npc.immune[owner]=5t 专支窗
   *  挡住 Kill 内 Damage() 的二次结算——本仓 hurt iframe 等价，但免同帧双记显式
   *  跳过；★清偿刀 R 后 AoE 面免疫门照走，该敌即使不 skip 也被 ：12636 拦） */
  private burst(game: GameHooks, skipId = -1): void {
    if (this.dead) return;
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
    game.playSfxFiles(['Item_14'], 1, this.x, this.y);
    const ex = this.cx, ey = this.cy;
    // ★X2-D3（2026-09-29）Kill 内 Damage() critter 面（:73242-73251 maxPenetrate=
    //  penetrate=-1 → :14194 不递减/:17312 不亡不截断）——critter 与敌怪同一 victim
    //  循环,爆盒 50×50 居中全结算入账（hitCrittersAll 全结算变体;刚被飞行盒命中的
    //  小动物已死,单源 dead 门跳过;不 skipId——敌怪 skipId 只护敌桶）。
    this.pveNumHits += hitCrittersAll(this, game, undefined,
      (c) => ex - 25 < c.x + c.w && ex + 25 > c.x && ey - 25 < c.y + c.h && ey + 25 > c.y);
    // Damage()：盒 50×50、penetrate −1——对全Overlap敌各结算一次
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as EnemyLike;
      if (e.dead || e.id === skipId) continue;
      if (!(ex - 25 < e.x + e.w && ex + 25 > e.x && ey - 25 < e.y + e.h && ey + 25 > e.y)) continue;
      // ★BJ489 def-3：Kill 内 Damage()（:73251）同链掷率=rollVanillaHitCrit（命中拍动态）
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      // ★X2-D1（同飞行盒站注）：受理面谓词 !vanillaGated——Kill 内 Damage()（:73251）
      //  同链,门拒不 proc 不计数,血尽级联/普通未致命返假照 proc 照计数
      //  ★清偿刀 R（2026-09-29,X4-债11）：AoE 写支档位归正——Kill :73265-73269 先置
      //  maxPenetrate=penetrate=-1 → :12635 flag3=假 → :12636 免疫门照走（残窗敌不
      //  受理）≠飞行盒 flag3 豁免档。旧 pierce=0 受理写 10t 双重偏差：①窗值 10≠原版
      //  专支 5t（:14080-14082 type 634/635 显型定档——写支梯 else-if 链先于尾档
      //  :14176-14182,飞行盒/AoE 两面同梯同值 5,桥表 vanillaProjImmuneTiers:80 同钉）；
      //  ②受理写支（Enemy.ts:14295,血尽级联 :14369 在其后=致死/非致死均写）污染下方
      //  vanillaGated 门位读（hurt 内 iframes 0→10 ⇒ 读恒真）→ AoE 受理命中 proc/
      //  numHits 恒跳,吸血域断供。-2 档（Enemy.ts 现役,零改动复用）=门照走+三不写
      //  → 门位读复原=残窗照拒/受理照达;窗值由弹侧补写 5t（同刀 F 飞行盒形态;
      //  原版写位 :14080 在 proc :13877 后,ghostHeal 不读窗,序等价）。
      // ★清偿刀 T（X4-债12,2026-09-29）：门位读前置快照（读侧单源）——-2 档三不写后
      //  后置读在普通面已等位,唯死亡转换写支（Enemy.ts:14421 四塔血尽转演出写
      //  iframes=2,写支 1:1 禁改）仍污染致死命中拍（原版 proc :13877-79/numHits++:
      //  14263 受理面无死亡复查,照达）。快照判据=「进 hurt 前状态」=原版门位语义。
      const gate = snapshotVanillaGate(e);
      strike(game, e, this.damage, crit, this.knockback,   // ★S02:crit ×2=Enemy.hurt 防后
        Math.sign((e.x + e.w / 2) - ex) || 1, this.armorPen, -2);
      const vanillaGated = vanillaGateRejected(gate);
      if (!vanillaGated) {
        (e as { iframes?: number }).iframes = 5;                // :14080-14082 专支写 5t
        ghostHealProc(game, this.projId, this.pveNumHits, e);   // Kill 内 Damage()（:73251）同链
        // ★BJ424-T3 魔法命中漏斗面收编：Kill AoE 面同块同 face——原版 Kill 先把弹盒
        //  Resize 50×50 再跑 Damage()（:73267-73269）⇒ ghostHurt 候选窗锚 = 爆盒几何。
        if (playerHasGhostHurt(game.player)) {
          const v424 = e as never as { vanillaId?: number | null; lastStrikeDealt?: number;
            maxHp?: number; def?: { lifeMax?: number } };
          ghostHurtOnHit(game,
            { magic: true, projDamage: this.damage,
              projX: ex - 25, projY: ey - 25, projW: 50, projH: 50,
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
        this.pveNumHits++;                                      //（:14263 受理后自增）
      }
    }
    // 尘爆（40 彩 + 20 底）——vector30 = (rot−π/2)向 ×|vel|×3
    const pool = game.vanillaDust;
    const spd = Math.hypot(this.vx, this.vy) * 3;
    const bx = Math.cos(this.rot - Math.PI / 2) * spd, by = Math.sin(this.rot - Math.PI / 2) * spd;
    if (pool) {
      for (let i = 0; i < 40; i++) {
        const d = pool.spawn(ex - 25, ey - 25, 50, 50,
          this.cfg.palette[Math.floor(Math.random() * this.cfg.palette.length)], 0, 0, 200, null,
          this.projId === 635 ? 3.7 : 1.7);
        if (!d) break;
        const a = Math.random() * TAU, rr = Math.random() * 25;
        d.x = ex + Math.cos(a) * rr; d.y = ey + Math.sin(a) * rr;
        d.noGravity = true;
        d.vx = d.vx * 3 + bx * Math.random();
        d.vy = d.vy * 3 + by * Math.random();
      }
      for (let i = 0; i < 20; i++) {
        const d = pool.spawn(ex - 25, ey - 25, 50, 50, this.cfg.base, 0, 0, 0, null,
          this.projId === 635 ? 2.2 : 2);
        if (!d) break;
        const a = (Math.random() * 2 - 1) * Math.PI + this.rot;
        d.x = ex + Math.cos(a) * 25 / 3;
        d.y = ey + Math.sin(a) * 25 / 3;
        d.noGravity = true;
        d.vx = d.vx * 0.5 + bx * (0.6 + 0.6 * Math.random());
        d.vy = d.vy * 0.5 + by * (0.6 + 0.6 * Math.random());
      }
    }
    game.spawnParticles(ex, ey, this.projId === 635 ? '#8FB8FF' : '#E878E8', 8, 2, { life: 20 });
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(this.projId);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const a = (255 - this.alphaI) / 255;            // GetAlpha :76359（白 × Opacity）
    if (a <= 0.02) return;
    const fh = img.height / Math.max(1, projFrameCount(this.projId));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, this.frame * fh, img.width, fh,
      -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ================= 月耀星 645（AI_001 :54077-54137） =================

export class LunarFlareStar extends Entity {
  readonly projId = 645;
  w = 10; h = 10;                                    // :6676-6677
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  /** ★BJ380：PVE 受理命中计数（Projectile.numHits 同相——:14263 受理后自增,proc 读
   *  自增前值;645 接触转爆在原版 Damage 内 :14255-14259 ⇒ 转爆拍已计一次。字段名
   *  对齐 SpectreSoulProj.projPveNumHits PVP 读口） */
  pveNumHits = 0;

  /** ai[1]：鼠标世界 Y 线（过线开 tileCollide）/ −1 = 爆炸相 */
  private ai1: number;
  /** ai[0]：爆炸相 update 计数（126 Kill） */
  private ai0 = 0;
  private alphaI = 255;
  private frame = 0;
  private frameCtr = 0;
  private exploded = false;
  /** 爆炸锚（盒 140×140 居中不动） */
  private ecx = 0; private ecy = 0;
  /** 每 update 序（tick 首 update 才搜敌） */
  private updInTick = 0;
  /** 爆炸相每敌一次（localNPCHitCooldown=−1）。★清偿刀 P1（C5 定谳#1,2026-09-29）：
   *  局部表写=受理支内——原版 immuneArray[victim]=cd 写位 :14175-14178 在免疫门
   *  :12635-12637【后】,门拒敌（他源 10t 残窗,如近战刚命中）不落标 → 窗期满后
   *  照吃爆伤;旧档无条件 add=首次重叠即永久标记,残窗敌全程零爆伤（原版 10t
   *  期满后下一子步照结算） */
  private hitSet = new Set<number>();
  /** ★R28 §7 命中线重估门：原版 ai[2] = num5+pointPosition.Y = 出生 Y + 钳后
   *  |dy|(|dy|≥20) 恒在出生点【下】方;Game.ts :11466 曾用原始 dy(可负) → 高打低
   *  lineY 为负过线门永不触发。首帧按 player.aimWY 重估（发射挂点在 Game.ts,
   *  R26 分区）——同帧 aimWY 即发射时鼠标世界坐标 */
  private lineYFixed = false;
  private startY = 0;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1;溅花
  //  尘/音由共享体 wetSplashStepShared 承载,本类不自写）——原版逐子步跑
  //  （extraUpdates 环 :16779,AI → 湿段 :16903 → HandleMovement :17120）,故接入
  //  点在 step() 内（每子步）而非 fixedUpdate 头）----
  //  豁免核对：645 LunarFlare SetDefaults P.cs:6955-6967（10×10/aiStyle 1/friendly/
  //  magic/tileCollide=false【:6962,出生档——AI 过线支 :57939-57942 置 true】/
  //  extraUpdates 5/penetrate −1/usesLocalNPCImmunity）【无】ignoreWater 行 →
  //  受段（数据面 PROJ_IGNORE_WATER 亦无 645）。645 ∉ IsDestroyedByWater 六型、
  //  非 2/34/80/155。
  //  阻尼（分相,aiStyle 1 不在 UpdatePosition 早退表 :20551）：飞行相 tileCollide
  //  出生 false → 湿阻尼支 :17721-17764 不进（wet 位移本应走 :16870 AI 前快照——
  //  本相 AI 不改速,快照≡当前速,quirk 无观察差 → 直积分恒等式）;过线后 AI 置
  //  tileCollide=true【:57940】→ 阻尼支跑,速度积分乘档。爆炸相（ai[1]=−1）AI 置
  //  velocity=0 + 直写锚定盒（:57957-57964）→ 无位移宿主,阻尼不适用。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首子步同位测值） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, damage: number, knockback: number, lineY: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    // 兜底钳门：lineY < 出生 Y+20（原版恒 ≥）时先钳到最小值,首帧再按 aimWY 精确重估
    this.ai1 = Math.max(lineY, y + 20);
    this.startY = y;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    this.updInTick = 0;
    for (let i = 0; i < 6 && !this.dead; i++) { this.step(game); this.updInTick++; }   // extraUpdates=5
  }

  private step(game: GameHooks): void {
    const st = game.world.store;
    // ★R28 §7：首帧按鼠标世界 Y 精确重估目标线（原版 ai[2]=出生Y+max(20,|dy|)）
    if (!this.lineYFixed) {
      this.lineYFixed = true;
      const aimY = (game.player as { aimWY?: number } | null | undefined)?.aimWY
        ?? (this.startY + 20);
      this.ai1 = Math.max(this.ai1, this.startY + Math.max(20, Math.abs(aimY - this.startY)));
    }
    const collide = this.ai1 !== -1 && this.y > this.ai1;   // :54079-54082 过线开碰撞
    // 尘 229 尾（每 update；体内实心时 noLight）:54089-54096
    const pool = game.vanillaDust;
    const solidHere = st.inBounds(Math.floor(this.cx / 16), Math.floor(this.cy / 16))
      && st.isSolid(Math.floor(this.cx / 16), Math.floor(this.cy / 16));
    if (pool) {
      const d = pool.spawn(this.x, this.y, this.w, this.h, 229);
      if (d) {
        d.x = this.cx; d.y = this.cy;
        d.vx = 0; d.vy = 0;
        d.noGravity = true;
        if (solidHere) d.noLight = true;
      }
    }
    if (this.ai1 === -1) {
      // ---- 爆炸相（:54104-54125）：140×140、alpha−10、7 帧×18 update、126 Kill ----
      this.ai0 += 1;
      this.vx = 0; this.vy = 0;
      this.w = 140; this.h = 140;
      this.x = this.ecx - 70; this.y = this.ecy - 70;
      // ★通用湿段（:16903-17113,逐子步）——爆炸相 AI 置速 0 + 直写锚定盒 → 无位移
      //  宿主,湿段只承载溅花/湿旗面（爆区盒被水漫过首拍溅一次）。位序 = AI（写位）
      //  → 本段 → HandleMovement（无位移面）。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        645, !!projectileData(645)?.ignoreWater);
      this.alphaI = Math.max(0, this.alphaI - 10);
      if (++this.frameCtr >= 18) { this.frameCtr = 0; this.frame++; }
      // ★X2-D3（2026-09-29）爆炸相 critter 面：盒 140×140（SetDefaults :6955-6967
      //  penetrate=-1+usesLocalNPCImmunity+cd-1）——critter 同 victim 循环逐靶一次
      //  （localNPCHitCooldown=-1 ⇒ immuneArray 写 -1;critter 一击即死,单源 dead 门
      //  承载同相去重）。盒已回写锚定（this.w/h=140,this.x/y=锚−70）→ 默认几何重叠。
      //  critter lifeMax≤5 → flag10 lifeMax>5 段（:13712）恒不吸血 → 只入账不 proc。
      this.pveNumHits += hitCrittersAll(this, game);
      for (const ent of game.enemies()) {
        if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
        const e = ent as unknown as EnemyLike;
        if (e.dead || this.hitSet.has(e.id)) continue;
        if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
        // ★BJ489 def-3：645 掷率=rollVanillaHitCrit（magic 旗,命中拍动态;冻结载体退役）
        const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
        // ★X2-D1（同 634 飞行盒站注）：受理面谓词 !vanillaGated——门拒不 proc 不计数,
        //  血尽级联（:14369 族）/普通未致命尾档（:15037）返假照 proc 照计数
        //  ★清偿刀 L（2026-09-29）：pierce=-3（usesLocal 族清零档,BJ398 现役梯）——
        //  原版爆相受理写支 :14175-14178 = immune[owner]=0 + local[victim]=
        //  localNPCHitCooldown=-1（局部节流,弹侧 hitSet 承载）;旧 pierce=0 写 10t
        //  全局窗 → 多星齐射首星后其余星被 :12636 门拒整饿死（原版 N 星=N 独立命中）
        //  且受理写支污染 vanillaGated 门位读（proc/numHits 恒跳,原版受理照 proc
        //  :13877-79 照计数 :14263）。-3 档写 0（受理面 immune[owner] 已为 0=无操作
        //  等位）→ 门位读复原=齐射不饿+proc/入账照达。
        // ★清偿刀 T（X4-债12,同 AoE 站注）：门位读前置快照（读侧单源）——-3 档写 0
        //  后后置读在普通面已等位,唯死亡转换写支（Enemy.ts:14421 写 iframes=2,与
        //  pierce 档无关）仍污染致死命中拍;快照判据=「进 hurt 前状态」。
        const gate = snapshotVanillaGate(e);
        strike(game, e, this.damage, crit, this.knockback,   // ★S02:crit ×2=Enemy.hurt 防后
          Math.sign((e.x + e.w / 2) - this.ecx) || 1, this.armorPen, -3);
        const vanillaGated = vanillaGateRejected(gate);
        if (!vanillaGated) {
          ghostHealProc(game, this.projId, this.pveNumHits, e);   // :13877-79（爆炸相首敌 0 档率 0.20）
          // ★BJ424-T3 魔法命中漏斗面收编：爆相面同块同 face（645 数据面 magic;爆盒
          //  140×140 已回写锚定 → ghostHurt 候选窗 = this 盒几何）。
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
          // ★清偿刀 P1（C5 定谳#1）：局部表写 :14175-14178（immuneArray[victim]=cd=-1）
          //  在受理支内——门拒敌（残窗快照）不落标,窗期满后下一子步照吃爆伤。
          this.hitSet.add(e.id);
        }
      }
      if (this.ai0 >= 126) {                         // 7×MaxUpdates(6)×3
        this.dead = true;
        game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
      }
      return;
    }
    this.alphaI = 255;                               // :54126 飞行相恒隐（视觉=尘尾）
    // 每 tick 首 update 搜敌 60px + 视线 → 爆炸（:54127-54136）
    if (this.updInTick === 0) {
      for (const ent of game.enemies()) {
        if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
        const e = ent as unknown as EnemyLike;
        if (e.dead) continue;
        if (Math.hypot(e.x + e.w / 2 - this.cx, e.y + e.h / 2 - this.cy) >= 60) continue;
        if (!canHit(game.world.store, this.cx, this.cy, 0, 0, e.x + e.w / 2, e.y + e.h / 2, 0, 0)) continue;
        this.explodeNow();
        return;
      }
    }
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1,逐子步）----
    // 位序 = 原版 Update 逐子步:AI_001 飞行相（过线 tileCollide=true 写位/尘/索敌完）
    // → 本段 → HandleMovement（阻尼在下方位移行）。explodeNow 早退的子步湿段跳一
    // 子步（原版 Kill 后湿段仍跑,同 substep 边界差,登记）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      645, !!projectileData(645)?.ignoreWater);
    // 位移（直飞无重力）+ 撞块（过线后）——水中位移阻尼（HandleMovement
    // :17721-17764 + UpdatePosition :20557-20562）：过线后 tileCollide=true
    // （:57940,AI 每子步 Y>线 即置真,vy 恒向下单调 → 与一次置真等价）→ 乘档;
    // 过线前 tileCollide=false 湿阻尼支不进（AI 不改速 → :16870 快照≡当前速,
    // 直积分恒等式）。速度场不减只削当拍位移。
    const df645 = collide ? projWaterDragFactor(this) : 1;
    this.x += this.vx * df645;
    this.y += this.vy * df645;
    const tx = Math.floor(this.cx / 16), ty = Math.floor(this.cy / 16);
    if (collide && st.inBounds(tx, ty) && st.get(tx, ty) !== 0 && st.isSolid(tx, ty)) {
      this.killDust(game);
      return;
    }
    if (!st.inBounds(tx, ty)) { this.killDust(game); return; }
    // ★X2-D3（2026-09-29）飞行盒（10×10）critter 接触 → 转爆炸：:14255-14259
    //  `type == 645 && ai[1] != -1f` 转爆相支对全体受理 victim 生效（critter 恒在
    //  victim 循环 :12618）;与敌怪面同构=本仓飞行相零伤转爆承载,伤害面在爆炸相。
    if (hitCritters(this, game)) { this.explodeNow(); return; }
    // 命中敌 → 转爆炸（:16706-16710，非 Kill）
    // ★清偿刀 L（2026-09-29）：飞行盒受理门补全——原版转爆支 :14257-14262 在
    //  Damage_PVE_Inner 受理面【后】,门链 = :12593 局部表（弹侧 hitSet 承载,已在
    //  上行）+ :12598 dontTakeDamage + :12635-12637 immune[owner]==0（645 flag3=假：
    //  penetrate=-1+usesLocalNPCImmunity :6955-6965,免疫门照走）→ 残窗/免伤敌
    //  【不】触发转爆相,星照常下坠（60px AI 索敌支 :57987-58006 无免疫门=原版本相,
    //  不受此门——近敌径由该支转爆,爆伤受 :12636 门拒=零伤,两支合流与原版同相）。
    //  受理面零伤转爆承载不变（爆相 pierce=-3 承伤,BJ398 清窗档→齐射不饿）。
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as EnemyLike;
      if (e.dead || this.hitSet.has(e.id)) continue;
      if ((e as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;   // :12598 外门（免伤敌不受理不转爆）
      if (((e as { iframes?: number }).iframes ?? 0) > 0) continue;   // :12635-12637 免疫门（flag3=假照走——残窗敌不触发 :14257 转爆相）
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      this.explodeNow();
      return;
    }
  }

  /** 进入爆炸相（ai[0]=0、ai[1]=−1、锚=当前中心） */
  private explodeNow(): void {
    this.exploded = true;
    this.ecx = this.cx; this.ecy = this.cy;
    this.ai0 = 0;
    this.ai1 = -1;
    this.frameCtr = 0;
  }

  /** Kill 链（:68851-68866）：4×尘 31 + 4×尘 229 ×3 速（体内实心 → 尘 noLight） */
  private killDust(game: GameHooks): void {
    this.dead = true;
    game.onProjectileDeath?.(this.projId, this.x, this.y, this.w, this.h);
    const st = game.world.store;
    const tx = Math.floor(this.cx / 16), ty = Math.floor(this.cy / 16);
    const solidHere = st.inBounds(tx, ty) && st.isSolid(tx, ty);   // flag5（:68853）
    const pool = game.vanillaDust;
    if (pool) {
      for (let i = 0; i < 4; i++) {
        pool.spawn(this.x, this.y, this.w, this.h, 31, 0, 0, 100, null, 1.5);
      }
      for (let i = 0; i < 4; i++) {
        const d = pool.spawn(this.x, this.y, this.w, this.h, 229, 0, 0, 0, null, 2.5);
        if (d) { d.noGravity = true; d.vx *= 3; d.vy *= 3; d.noLight = solidHere; }
      }
    }
    game.spawnParticles(this.cx, this.cy, '#FF9AE8', 6, 1.8, { life: 18 });
  }

  draw(r: Renderer, _cam: Camera): void {
    if (!this.exploded) return;                      // 飞行相 alpha=255 → GetAlpha≈0 不画
    const img = projSprite(645);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    const a = (255 - this.alphaI) / 255;
    if (a <= 0.02) return;
    const fh = img.height / 7;                // 7 帧（98×686）
    const fr = Math.min(6, this.frame);
    ctx.save();
    ctx.globalAlpha = a * 0.5;                       // GetAlpha :76171 A=127−alpha/2 ≈ 半透
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, fr * fh, img.width, fh,
      this.ecx - img.width / 2, this.ecy - fh / 2, img.width, fh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
