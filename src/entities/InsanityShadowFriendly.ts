// 骸骨头盔幻影（原版 Projectile 964 InsanityShadowFriendly，1.4.5.6 全链 1:1）：
//   - 授予链：Bone Helm（item 5100，faceSlot=19 accessory）穿在**功能配饰槽**
//     （armor[0-9]，GrantArmorBenefits :12823）→ SpawnHallucination（Player.cs:13627）：
//     insanityShadowCooldown 递减 → 归零时重掷 Next(20,101)；候选 = CanBeChasedBy 且
//     距离 ≤500px 且 CanHitLine 的 NPC，随机一只 → RandomizeInsanityShadowFor(
//     isHostile:false) → NewProjectile(964, damage 18, kb 0)。
//   - SetDefaults（Projectile.cs:8842-8855）：40×40、aiStyle 187、alpha 255、
//     penetrate 3、friendly、usesLocalNPCImmunity + localNPCHitCooldown -1（每敌一次）、
//     ignoreWater、tileCollide=false（穿墙）、extraUpdates 1、scale 0.7、
//     armorPenetration 20。
//   - AI_187_ShadowHand（:39798-39940）四变体段（ai[0] 0/180/300/390 起点，段长
//     180/120/90/90）+ 淡入 50/段尾淡出 255 + GhastlyGlaiveImpactGhost 起始音。
//   - 绘制（Main.cs:29934 origin.X = spriteDirection==1 ? W-20 : 20 / :30747-30759
//     4 只紫色残影绕 rotation 轨道 + GetAlpha :76448 White×Opacity）；oldPos 5 段
//     黑色拖尾（:30119/:30559）与敌对 965 同为登记偏差（TrailCache 未建模）。
import { Entity } from './Entity';
import { applyBannerDamageDealt } from './projTargets';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ285 死亡段割面（BJ260 同款前置习语）

/** Utils.Remap */
const remap = (v: number, a: number, b: number, c: number, d: number): number =>
  v <= a ? c : v >= b ? d : c + (d - c) * (v - a) / (b - a);

interface EnemyLike {
  cx: number; cy: number; x: number; y: number; w: number; h: number; id: number;
  dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
}

export interface InsanitySpawnParams {
  x: number; y: number;      // 出生位置（世界 px，左上角）
  vx: number; vy: number;
  ai0: number;               // 变体段直入值（0/180/300/390）
  ai1: number;
}

/** RandomizeInsanityShadowFor（Projectile.cs:39703-39796）isHostile=false 分支 1:1：
 *  num3=100 / num4=20 / num5=0；isHostile 才有的玩家重叠拒绝环（:39777-39792）
 *  跳过（flag 恒 true）。rand 注入便于测试定种子。 */
export function randomizeFriendlyInsanityShadow(
  targetCx: number, targetCy: number, rand: () => number = Math.random,
): InsanitySpawnParams {
  let num = (rand() < 0.5 ? 0 : 1) * 2 - 1;               // Main.rand.Next(2)*2-1 → ±1
  const num2 = Math.floor(rand() * 4);                    // Next(4) 变体
  const num3 = 100, num4 = 20;
  let sx = targetCx, sy = targetCy, vx = 0, vy = 0, ai0 = 0, ai1 = 0;
  if (num2 === 0) {
    const rot = (rand() * 2 - 1) * Math.PI * 0.125;       // NextFloatDirection×π/8
    const ox = -num * num3, oy = 0;
    sx = targetCx + ox * Math.cos(rot) - oy * Math.sin(rot);
    sy = targetCy + ox * Math.sin(rot) + oy * Math.cos(rot);
    const bx = (num * num3) / num4, by = 0;               // num4（非 hostile 不 +10）
    vx = bx * Math.cos(rot) - by * Math.sin(rot);
    vy = bx * Math.sin(rot) + by * Math.cos(rot);
    ai0 = 0; ai1 = 0;
  } else if (num2 === 1) {
    const a = Math.PI * 2 * rand();
    sx = targetCx - Math.cos(a) * num3 * 0.5;             // isHostile?100:50
    sy = targetCy - Math.sin(a) * num3 * 0.5;
    ai0 = 180;
    ai1 = a - Math.PI / 2;
    vx = Math.cos(a) * 2;
    vy = Math.sin(a) * 2;
  } else if (num2 === 2) {
    const a = Math.PI * 2 * rand();
    sx = targetCx - Math.cos(a) * num3;
    sy = targetCy - Math.sin(a) * num3;
    ai0 = 300;
    ai1 = a;
    vx = Math.cos(a) * 2;
    vy = Math.sin(a) * 2;
  } else {
    const f = Math.PI * 2 * rand();
    const num7 = 30;
    const num8 = (Math.PI / 2 / num7) * (rand() * 2 - 1);
    sx = targetCx; sy = targetCy;                         // + velocity×num5(0)
    let bx = Math.cos(f) * 3, by = Math.sin(f) * 3;
    for (let i = 0; i < num7; i++) {
      sx -= bx; sy -= by;
      const c = Math.cos(-num8), s = Math.sin(-num8);
      const nbx = bx * c - by * s, nby = bx * s + by * c;
      bx = nbx; by = nby;
    }
    vx = bx; vy = by;
    ai0 = 390;
    ai1 = num8;
  }
  void num;   // num2===0 分支已消费（方向基）
  return { x: sx - 20, y: sy - 20, vx, vy, ai0, ai1 };
}

export class InsanityShadowFriendly extends Entity {
  w = 40; h = 40;
  life = 3600;            // NewProjectile 默认 timeLeft（AI 段尾自灭兜底）
  alpha = 255;            // 255=全透明（SetDefaults）→ 淡入至 50
  private ai0: number;
  private readonly ai1: number;
  private rotation = 0;
  /** 命中过的敌人（usesLocalNPCImmunity + localNPCHitCooldown -1：每敌整生仅一次） */
  private hitEnemies = new Set<number>();
  /** penetrate 3：总命中 3 次即灭 */
  private pierceLeft = 3;

  constructor(p: InsanitySpawnParams, private readonly dmg: number) {
    super();
    this.x = p.x; this.y = p.y;
    this.vx = p.vx; this.vy = p.vy;
    this.ai0 = p.ai0;
    this.ai1 = p.ai1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // extraUpdates 1（SetDefaults :8853）——AI/位移每 tick 两次
    for (let u = 0; u < 2; u++) {
      if (this.dead) return;
      this.step(game);
    }
    if (--this.life <= 0) this.dead = true;
  }

  private step(game: GameHooks): void {
    this.ai0 += 1;
    // 变体段（AI_187_ShadowHand_GetVariation :39903-39940）
    let variation = 0, start = 0, len = 180;
    if (this.ai0 >= 390) { variation = 3; start = 390; len = 90; }
    else if (this.ai0 >= 300) { variation = 2; start = 300; len = 90; }
    else if (this.ai0 >= 180) { variation = 1; start = 180; len = 120; }
    const fc = this.ai0 - start;
    // alpha（:39825-39841）：段尾 15 步淡出至 255，否则淡入至 50
    if (fc > len - 15) this.alpha = Math.min(255, this.alpha + 25);
    else this.alpha = Math.max(50, this.alpha - 25);
    if (fc >= len - 1) { this.dead = true; game.onProjectileDeath?.(964, this.x, this.y); return; }
    if (variation === 0) {                       // :39847-39856 减速滑行
      this.vx *= 0.98; this.vy *= 0.98;
      this.rotation = Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0);
    } else if (variation === 1) {                // :39857-39874 绕轴摆荡
      const t = fc / len;
      if (Math.hypot(this.vx, this.vy) > 0.1) { this.vx *= 0.95; this.vy *= 0.95; }
      const dir = this.vx >= 0 ? 1 : -1;
      const pivotD = 70 * dir;
      const a1 = remap(t, 0.3, 0.5, 0, 1) * remap(t, 0.45, 0.5, 1, 0);
      const a2 = remap(t, 0.5, 0.55, 0, 1) * remap(t, 0.5, 1, 1, 0);
      this.rotation += (a1 * (Math.PI / 60) + a2 * (-Math.PI * 8 / 60)) * -dir;
      const px = this.cx - Math.cos(this.rotation) * pivotD;
      const py = this.cy - Math.sin(this.rotation) * pivotD;
      this.x = px + Math.cos(this.rotation) * pivotD - this.w / 2;
      this.y = py + Math.sin(this.rotation) * pivotD - this.h / 2;
    } else if (variation === 2) {                // :39875-39888 俯冲（0.4 处峰值速）
      const t = fc / len;
      const v1 = remap(t, 0, 0.4, 1, 0);
      const v2 = remap(t, 0.3, 0.4, 0, 1) * remap(t, 0.4, 1, 1, 0);
      const spd = v1 * 2 + v2 * 8 + 0.01;
      this.vx = Math.cos(this.ai1) * spd;
      this.vy = Math.sin(this.ai1) * spd;
      this.rotation = Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0);
    } else {                                     // :39889-39899 旋进
      const c = Math.cos(this.ai1), s = Math.sin(this.ai1);
      const nvx = this.vx * c - this.vy * s;
      const nvy = this.vx * s + this.vy * c;
      this.vx = nvx; this.vy = nvy;
      this.rotation = Math.atan2(this.vy, this.vx) + (this.vx < 0 ? Math.PI : 0);
    }
    this.x += this.vx;
    this.y += this.vy;
    // friendly 命中（StrikeNPC：dmg 18 / kb 0 / armorPenetration 20 / 无暴击掷）——
    // localNPCHitCooldown -1：同一敌人仅首击；penetrate 3 次总命中后消亡
    if (this.alpha >= 250) return;   // 淡入完成前不可见亦不判定（近原版 alpha 门近似）
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（P.cs:12517）先于 Damage_PVE
    //  （:12523）——964 骸骨头盔幻影 penetrate=3 耗尽即亡拍【照割】（SetDefaults
    //  :9129-9143,aiStyle 187/friendly 非 minion）;中央割 !e.dead 门=死亡拍整缺 →
    //  BJ260 前置习语。964 过两道门（CanCutTiles :15407 两表均无;CanDealDamage :12461 无）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    for (const e of game.enemies() as unknown as EnemyLike[]) {
      if (e.dead || this.hitEnemies.has(e.id)) continue;   // 外环 flag2 等价（:12596 局部表）
      // ★BJ475④ :12600 头门 + :12636 免疫窗门前置（原版 964=标准 Damage_PVE 管线:
      //  拒收拍 Inner 整跳 return——不达 :14175-14179 写梯（局部表 -1）/不达
      //  :14189-14201 penetrate 递减,窗期满同拍重试照吃）。记账面定谳（BJ467②
      //  报告遗留复核项）:旧形态 hitEnemies.add+pierceLeft-- 无条件跑=外源残窗
      //  敌怪被永记（localNPCHitCooldown=-1 局部表永续）+弹提前亡=真债,本刀落门。
      //  964 非接触反噬族 → DTD 水母亦无 zap 口,整跳=原版净语义（BJ467⑥ 同构）。
      //  AABB 在两门后=原版序（门 :12600/:12636 → Colliding :12668）。
      if (((e as { dontTakeDamage?: boolean }).dontTakeDamage === true)) continue;   // :12600
      if (((e as { iframes?: number }).iframes ?? 0) > 0) continue;                  // :12636
      if (this.x < e.x + e.w && this.x + this.w > e.x
        && this.y < e.y + e.h && this.y + this.h > e.y) {
        this.hitEnemies.add(e.id);
        // ★BJ467②（2026-10-03）TimerCrit :12928 消费补位——964 幻影受理面为自建直调
        //  e.hurt（非 proj1457.dealContacts 通道,四件套 ChloroLeaf/SporeSac/OrichalcumPetal
        //  三件走 dealContacts F11 既有接位,唯本件缺）。三类掷不达（SetDefaults
        //  :8842-8855 无类旗）,蓄能暴击为唯一 crit 源;Enemy.hurt crit 参仅染色 → 数值
        //  预倍 ×2 交调用侧（banner 乘区后、crit 翻倍前=原版序）。
        //  ★BJ475④ 旧 shadowGate964 快照判据（dead/iframes/DTD 三态前置假门）退役=
        //  两前置门上位承载（V2/S3b 习语:快照替身在真前置门落位后同值恒假,留之
        //  即死码）;受理拍=唯一消费位（:12928 对受理面同达,原版同相）。
        const crit964 = (((game.player as unknown as
          { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
          | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h)) ?? false);
        // ★BJ482①（2026-10-03）pierce 0→-3=usesLocal 族写梯【清窗档】（Projectile.cs
        //  :14175-14179 usesLocal 主支：immune[owner]=0 + 局部表行=cd）——964 SetDefaults
        //  :9129-9143 usesLocalNPCImmunity+localNPCHitCooldown=-1 → 受理写梯落清窗支,
        //  节流全归 hitEnemies 局部表（-1 每敌整生一次,BJ475④ 前置门上位承载）。
        //  旧 pierce=0=Enemy.hurt 通用尾档开 10t 自造全局窗（964 命中后 10t 内玩家
        //  他武器全被拒——BJ436 主病灶同形,原版无此窗）。修复式=BJ452/455 家族
        //  （656/856）+WhipProj S3b（WhipProj.ts:844 0→-3 同式）+BJ398 梯。
        e.hurt(applyBannerDamageDealt(game, e, this.dmg), 0, 0, game, 20, crit964, -3, true);   // fromPlayer=DPS 计;★BJ467② crit 色位;★S02 ×2=Enemy.hurt 防后;★BJ482① pierce=-3 清窗档
        if (--this.pierceLeft <= 0) {
          this.dead = true;
          game.onProjectileDeath?.(964, this.x, this.y);
          return;
        }
      }
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = r.atlas?.ensureVImage('vanilla/Projectile_964.png');
    const opacity = 1 - this.alpha / 255;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rotation);
    if (this.vx < 0) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    // 本体：origin.X = spriteDirection==1 ? W-20 : 20（Main.cs:29934-29937）、
    // Y=H/2、scale 0.7（SetDefaults）
    const ox = this.vx >= 0 ? (img ? img.width - 20 : 0) : 20;
    const oy = (img?.height ?? 0) / 2;
    if (img) {
      ctx.globalAlpha = opacity;
      ctx.drawImage(img, -ox * 0.7, -oy * 0.7, img.width * 0.7, img.height * 0.7);
    } else {
      ctx.globalAlpha = opacity;
      ctx.fillStyle = '#9060E0';
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // 4 只紫色残影（Main.cs:30747-30759，964=Violet）：绕 rotation 方向的
    // RotatedBy(ai[0]/60×2π + π/2×i) × 6px 轨道，Violet×0.5×Opacity——本体贴图
    // 的 Violet 整体调制（离屏 tint 缓存，逐图一次）
    if (img) {
      const tinted = violetTint(img);
      if (tinted) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        const num179 = 60;                        // 964 段（965=30）
        for (let i = 0; i < 4; i++) {
          const ang = this.rotation + (this.ai0 / num179) * Math.PI * 2 + Math.PI / 2 * i;
          const gx = this.cx + Math.cos(ang) * 6;
          const gy = this.cy + Math.sin(ang) * 6;
          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate(this.rotation);
          if (this.vx < 0) ctx.scale(-1, 1);
          ctx.globalAlpha = 0.5 * opacity;
          const tox = this.vx >= 0 ? img.width - 20 : 20;
          const toy = img.height / 2;
          ctx.drawImage(tinted, -tox * 0.7, -toy * 0.7, img.width * 0.7, img.height * 0.7);
          ctx.restore();
        }
        ctx.restore();
      }
    }
  }
}

/** XNA Color.Violet=(138,43,226) 整体调制（EntitySpriteDraw color 乘色）：
 *  离屏画一次后 source-in 填色缓存；图未就绪返回 null */
const violetCache = new WeakMap<object, HTMLCanvasElement | null>();
function violetTint(img: ImageBitmap | HTMLImageElement): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  let c = violetCache.get(img);
  if (c !== undefined) return c;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx2 = cv.getContext('2d');
  if (!cx2) { violetCache.set(img, null); return null; }
  cx2.drawImage(img, 0, 0);
  cx2.globalCompositeOperation = 'source-in';
  cx2.fillStyle = 'rgb(138,43,226)';
  cx2.fillRect(0, 0, cv.width, cv.height);
  violetCache.set(img, cv);
  return cv;
}
