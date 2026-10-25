// 书弹 1092（Projectile.cs:23742-23809，aiStyle 18 专支）：693 图书管理员骷髅 volley。
// 三态：0 出生小跳 → 1 悬停瞄准（vy 衰减/旋转朝向玩家+π/2 每步 0.25 贴近；ai1 45t
// 倒数尽 → 冲撞态）→ 2 直线冲撞（速 9 朝玩家；旋转滚转 |v|×sign(vx)×0.03）+
// 纸屑 gore 拖尾（1/5 每步：1007/1008/1008 选择随机，出生 TopLeft+随机方格内点，
// 初速 (vx×1.5, −NextFloat×16)，后置 gore.vx += projVx（合计 2.5×），timeLeft 60 alpha 50）。
// 常驻：光 (0.3,0.25,0.1)（:23744）；1/15 每步尘 269（Left 盒 w×4，vel (vx×0.5,
// 0.5+vy×0.25)，scale 1.2 noLight，:23799-23806）。
// 规格（SetDefaults 提取）：16×16 / penetrate -1 / timeLeft 420 / hostile。
// 伤害 13 由发射侧原值传入（NPC.cs:21215 无 GetAttackDamage 包装）；命中玩家的难度
// 乘区在 projTargets.hitPlayer（:13770）统一施加。
// 渲染：projFrames[1092]=54（Main.cs:8663）竖向行带——AI 维护的 frame 值直入
// projFrameImg 行切片（出生 Next(6)*9+Next(3) / 冲撞 floor(f/9)*9+3+Next(6)）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { hitPlayer } from './projTargets';
import { GorePiece } from './GorePiece';
import { projFrameImg, projSprite } from './Arrow';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { TILE } from '../core/constants';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';

export class BookProj extends Entity {
  readonly projId = 1092;
  w = 16; h = 16;
  damage: number;
  /** ★BJ720-A（issue #19 B01，2026-10-25）：发射者旗追踪键（原版 bannerIdToRespondTo
   *  投影——NewNPC→GetSpawnSource_ForProjectile（NPC.cs:91865）恒 EntitySource_Parent
   *  → FindBannerToAssociateTo P.cs:11106-11119 注入 693 的 BannerID()）。发射站
   *  Enemy.ts 693 分支冻结；hitPlayer 消费（applyBannerDamageReceivedOnProj 单源）。 */
  bannerNpcId: number | null = null;
  /** timeLeft（SetDefaults 420） */
  life = 420;
  /** 点光（:23744 每帧 AddLight(Center, 0.3, 0.25, 0.1)）——Game 实体光扫描消费 */
  lightRGB: [number, number, number] | null = [0.3, 0.25, 0.1];
  lightRGBAt: { x: number; y: number } | null = null;
  /** ai[0]：0 出生 / 1 悬停瞄准 / 2 冲撞 */
  private ai0 = 0;
  /** ai[1]：45 起倒数（NewProjectile ai1=45，NPC.cs:21215） */
  private ai1 = 45;
  /** rotation（rad）——瞄准态 AngleTowards 目标 = angleTo(player)+π/2 */
  private rot = 0;
  /** 原版 frame（出生掷/冲撞重掷，帧域语义见文件头） */
  private frame = 0;
  /** 目标玩家（ai[2]=target 索引，单人恒本地玩家） */
  private target: { cx: number; cy: number; dead: boolean } | null;

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-04 溅花缺口
  //  清偿批,BookProj 接入。四旗/wetCount/presetDone 形状=ProjWetFlags 共享体）----
  //  逐 id 豁免核对：1092 图书管理员骷髅 volley——SetDefaults（P.cs:10188-10196：
  //  16×16/aiStyle 18/hostile/penetrate -1/timeLeft 420）【无 ignoreWater 行】→
  //  不豁免受段（hostile 弹同吃 :16903 通段,门只认 ignoreWater 不认 friendly）。
  //  1092 ∉ IsDestroyedByWater {85,15,188,34,1097,1106}（ProjectileID.cs:287/
  //  :16921-16926）→ 无消亡钩;∉ {242,302,638}（:16894 强制 wet=false 特支）;
  //  aiStyle 18 ∉ UpdatePosition 早退表（P.cs:20551-20553）→ 湿阻尼适用。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍同位同液态首测） */
  presetDone = false;

  constructor(x: number, y: number, damage: number,
    target: { cx: number; cy: number; dead: boolean } | null) {
    super();
    this.x = x; this.y = y;
    this.damage = damage;
    this.target = target;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    this.lightRGBAt = { x: this.cx, y: this.cy };
    if (this.ai0 === 0) {
      // :23747-23756 出生：帧掷 + vy=-3 小跳 + 6×尘 269（Bottom 1×1 盒，±10 整掷，
      // scale 1.5，noLight+noGravity）
      this.frame = Math.floor(Math.random() * 6) * 9 + Math.floor(Math.random() * 3);
      this.vy = -3;
      this.ai0 = 1;
      for (let i = 0; i < 6; i++) {
        const d = game.spawnDust?.(this.x + this.w, this.y + this.h, 1, 1, 269,
          Math.floor(Math.random() * 21) - 10, Math.floor(Math.random() * 21) - 10, 100);
        if (d) { d.noLight = true; d.noGravity = true; d.scale = 1.5; }
      }
    } else if (this.ai0 === 1) {
      // :23757-23780 悬停瞄准：vy×0.95；ai1<20 才转朝向（每步最大 0.25 渐近）
      this.vy *= 0.95;
      const p = this.target;
      if (this.ai1 < 20 && p && !p.dead) {
        const targetAngle = Math.atan2(p.cy - this.cy, p.cx - this.cx) + Math.PI / 2;
        let delta = targetAngle - this.rot;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.rot += Math.max(-0.25, Math.min(0.25, delta));
      }
      if (this.ai1-- <= 0) {
        // :23769-23780 冲撞转化：目标失效即 Kill；速 9 直指玩家；帧重掷
        if (!p || p.dead) {
          // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版目标失效 Kill（aiStyle18
          //  :25741-25744 `if (!player3.active) Kill();`）【不从 AI 返回】——后续
          //  速度/帧重掷照跑（死弹不可观测,不在本刀域）,Update 湿段(:16895)无
          //  active 门照跑（`!active` 门 :17132 只拦 Damage/尾尘）→ 杀拍溅花照走。
          //  本仓杀位早退曾跳过湿段;现补跑,测位=存储位（AI 不写 position,原版
          //  死拍湿段同位,逐值等价）。杀支与 AI 尾活拍调用点同拍互斥（早退）→
          //  无需 wetSectionRan 旗;1092 ∉ IsDestroyedByWater 六型/非 80 → 无补 Kill。
          this.wetSection(game);
          this.dead = true;
          game.onProjectileDeath?.(1092, this.x, this.y, this.w, this.h, this.vx, this.vy);
          return;
        }
        const dx = p.cx - this.cx, dy = p.cy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        this.vx = (dx / d) * 9;
        this.vy = (dy / d) * 9;
        this.frame = Math.floor(this.frame / 9) * 9 + 3 + Math.floor(Math.random() * 6);
        this.ai0 = 2;
      }
    } else {
      // :23781-23798 冲撞：滚转 |v|×sign(vx||1)×0.03；1/5 每步纸屑 gore
      const sgn = Math.sign(this.vx) || 1;
      this.rot += Math.hypot(this.vx, this.vy) * sgn * 0.03;
      if (Math.random() * 5 < 1) {
        // SelectRandom(1007,1008,1008)：1007 权 1 / 1008 权 2
        const g = GorePiece.newGore(Math.random() * 3 < 1 ? 1007 : 1008,
          this.x + Math.random() * this.w, this.y + Math.random() * this.h,
          this.vx * 1.5, -Math.random() * 16);
        if (g) { g.timeLeft = 60; g.alpha = 50; g.vx += this.vx; }
      }
    }
    // :23799-23806 1/15 每步尘 269（Left 盒 w×4，vel 后置合成）
    if (Math.random() * 15 < 1) {
      const d = game.spawnDust?.(this.x, this.y, this.w, 4, 269);
      if (d) { d.vx = this.vx * 0.5; d.vy = 0.5 + this.vy * 0.25; d.noLight = true; d.scale = 1.2; }
    }

    // ★通用湿段（:16903-17113,2026-09-04 溅花缺口清偿批）——原版 Update 位序
    //   AI(:16880) → 湿段(:16903) → HandleMovement(:17120)。本类 AI 段无湿旗消费者
    //   → 段插 AI 尾/位移前 = 原版同序,湿段测位 = 上拍位移末位（原版"AI 后未移动
    //   位"同构）。溅花尘/音由共享体调 wetSplashStepShared,不自写。
    this.wetSection(game);

    // 位移（Projectile 通用）+ 撞墙/越界消亡（tileCollide 缺省 → Kill）
    // ★水中位移阻尼（HandleMovement :17721-17764 + UpdatePosition :20557-20562
    //   `if (wet) position += wetVelocity`）——直积分宿主：速度场不减只削当拍位移
    //   （wetVelocity = velocity×档,velocity 字段本身不被水阻改写）;干态档=1 恒等
    const drag = projWaterDragFactor(this);
    this.x += this.vx * drag;
    this.y += this.vy * drag;
    const st = game.world.store;
    const tx = Math.floor((this.x + this.w / 2) / TILE), ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!st.inBounds(tx, ty) || st.isSolid(tx, ty)) {
      this.dead = true;
      game.onProjectileDeath?.(1092, this.x, this.y, this.w, this.h, this.vx, this.vy);
      return;
    }
    if (--this.life <= 0) { this.dead = true; return; }
    // 敌对命中（hostile：难度乘区在 hitPlayer 内，:13770）
    if (hitPlayer(this, game, this.damage, true)) {
      this.dead = true;
      game.onProjectileDeath?.(1092, this.x, this.y, this.w, this.h, this.vx, this.vy);
    }
  }

  /** ★通用湿段（:16903-17113——projWetSection.ts 共享体 1:1;1092 豁免核对/位序注
   *  见本类字段块头。溅花尘/音由共享体调 wetSplashStepShared,不自写） */
  private wetSection(game: GameHooks): void {
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      1092, false);   // 1092 不豁免（P.cs:10188-10196 无 ignoreWater 行,核对见字段块头）
  }

  draw(r: Renderer, _cam: Camera): void {
    // 世界坐标绘制（Renderer 实体循环运行在世界变换内）。rotation 直用 AI 维护的
    // rot（书页朝向语义：angleTo(player)+π/2 锚定，冲撞后滚转）
    const ctx = r.ctx;
    if (!ctx) return;
    const sliced = projFrameImg(1092, this.frame);
    const img = sliced ?? projSprite(1092);
    if (!img) return;
    const asImg = img as HTMLImageElement;
    if (!(asImg.width > 0) && !(img as HTMLCanvasElement).width) return;
    const iw = (img as HTMLCanvasElement).width || asImg.width;
    const ih = (img as HTMLCanvasElement).height || asImg.height;
    if (!iw || !ih) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.drawImage(img as CanvasImageSource, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }
}
