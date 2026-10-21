// Celebration 双持械枪 1:1（1.4.5.6 反编译）：
//   喜庆弹射器MK2 3930 → 持械弹 714（AI_075 :64072-64195）：channel 驱动每 8t
//     一发；出生 ai[0]=5×Next(0,20) 相位偏移，弹道变体 = ⌊ai0/8⌋%7 **确定循环**
//     （715-718 烟花弹的 ai0 即此变体）；Item156 节奏音；枪口彩虹尘
//     hslToRgb(ai0/90%1)；变体 3 速 +1、变体 5 三连（±2π/80）、变体 4 附
//     ai1=1（蛇形相位跳）。
//   派对机枪 3475 → 持械弹 615（AI_075 :63959-64071）：每 5t 一发 Item36，
//     子弹供弹（PickAmmo 默认 14），每 7 轮（⌊ai0/5⌋%7==0）附赠 616 彩带弹
//     Damage+20 / kb×1.25 / 速 8。
//   烟花弹 715-718（AI_147 :49974-50188，extraUpdates=2=3 update/tick）：
//     变体 0-6 弹道（0：20u 后 g0.12+沿途每 20u 空爆；1：10u 上抛 vy−10 后
//     g0.25+scale 长大 2.5+尘环；2：60u 后 g0.15；3：20u 起追踪 lerp 1/8 保速；
//     4：蛇形（垂直向 ×cos(t·π/45)×3，ai1=1 时起步相位 +45）；5：40u 后
//     g0.08；6：30u 后 g0.1），终端 vy 16、rotation=atan2+π/2、
//     GetCeleb2Color 变体光。
// ★通用湿段定谳（2026-09-04 溅花缺口批）：本文件弹 id 豁免面逐 id 核对——
//   · 持械枪口 714 :7574-7585 `ignoreWater=true`@:7584 / 615 :6622-6633
//     true@:6632 → 【豁免】不接湿段（挂手位弹,velocity 亦非位移源）。
//   · 烟花弹 715/717 :7586-7597、716/718 :7598-7609 均无 ignoreWater 行 → 【受段】,
//     Celeb2Rocket 已接（位序=每子步 AI(switch) → 湿段(:16903) → 位移(:19973)，
//     extraUpdates=2 → 每拍 3 子步各跑一次,与原版子步环 :16781 同频）。
//   · "子爆"=Kill 内原位 Resize+Damage()+AI_147_Explosion（:75037-75049）,原版
//     【不 spawn 子弹实体】→ 无子爆弹 id 可枚举（本仓 explodeAt 直爆同构）;
//     派对机枪 616 彩带弹走 Arrow 载体（Arrow 湿段域,非本文件）。
//   · ★⑥杀拍口径核查（2026-09-06 湿段配方推广批,清白注不落刀）：本文件杀位全览——
//     ①枪口弹 714/615（Celeb2Muzzle）杀位 owner 亡/断 channel/无弹药（fixedUpdate
//     头 :89/:90/:138）：两 id SetDefaults ignoreWater=true（714 :7584/615 :6632）
//     → 原版本就不跑湿段,杀拍跳段=原版同态,零观测差;②烟花弹 715-718
//     （Celeb2Rocket）杀位=出界/撞块/命中（step 内 :321/:322/:340,全在湿段调用位
//     :312 之后）→ 湿段已先跑=原版同相位（Kill 位在位移/Damage 域,湿段之后）。
//     两支均无杀拍湿段缺口,无需补跑。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite, familyBodyStealthDim } from './Arrow';   // ★BJ704-G14 件3：族面减光求值器
import { tintedTex } from '../render/StringLine';   // ★BJ704-G14 件3：本体减光 rgb 烘焙
import { canBeChasedBy, playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { ProjGhostRing, drawCeleb2Chain } from './projGhostTrail';   // ★BJ235 烟花链残影
import { cutTilesBox } from './ProjCutTiles';   // ★BJ285 死亡段割面（BJ260 同款前置习语）
import { rollVanillaHitCrit } from './proj1457';   // ★BJ494 掷率单源（:12915-12927 owner 装配）

type EnemyLike = {
  x: number; y: number; w: number; h: number; id: number; dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
};

interface MuzzleOwner { cx: number; cy: number; facing: number; dead: boolean }

/** GetCeleb2Color（:49632-49645）：变体 0-6 色板 */
export const CELEB2_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 0, 0], [255, 140, 0], [255, 215, 0], [50, 205, 50],
  [65, 105, 225], [80, 20, 180], [255, 105, 180],
];

/** 单发开火指令（Game 注入：解析弹药 → 生成弹体 → 消耗 1；返回 false = 无弹药） */
export type CelebFireFn = (
  variant: number, x: number, y: number, vx: number, vy: number,
  opts: { bonusAi1: boolean; spreadRot: (ang: number) => { x: number; y: number } },
) => boolean;

// ================= 持械枪口 714（MK2）/ 615（派对机枪）（AI_075） =================

export class Celeb2Muzzle extends Entity {
  readonly projId: number;                          // 714 MK2 / 615 派对机枪
  w = 22; h = 22;
  dead = false;
  private owner: MuzzleOwner;
  /** ai[0]：tick 计（出生 5×Next(0,20) 相位偏移 :48376） */
  private ai0: number;
  /** ai[1]：volley 冷却（714: 8t / 615: 5t） */
  private ai1: number;
  private readonly volley: number;
  private frame = 0;
  private frameCtr = 0;
  private channelCb: () => boolean;
  private aimCb: () => { x: number; y: number };
  private fireCb: CelebFireFn;

  constructor(owner: MuzzleOwner, projId: 714 | 615,
    channelCb: () => boolean, aimCb: () => { x: number; y: number }, fireCb: CelebFireFn) {
    super();
    this.owner = owner;
    this.projId = projId;
    this.volley = projId === 714 ? 8 : 5;
    this.ai0 = 5 * Math.floor(Math.random() * 20);
    this.ai1 = 0;   // 出生 ai[1]=0（:48376 只传 ai0）→ 首 tick 即发第一发——
                    // 勿初始化成 volley 间隔（曾致 MK2 首发迟 8t，2026-08-14 review 修）
    this.channelCb = channelCb;
    this.aimCb = aimCb;
    this.fireCb = fireCb;
    this.vx = 8; this.vy = 0;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (this.owner.dead) { this.dead = true; return; }
    if (!this.channelCb()) { this.dead = true; return; }   // 断 channel（canShoot 门等价）
    this.ai0 += 1;
    this.ai1 -= 1;
    let variant = -1;
    if (this.ai1 <= 0) {
      this.ai1 = this.volley;
      const idx = Math.floor(this.ai0 / this.volley);
      variant = idx % 7;                                    // :64090-64095 num60
    }
    // 帧动画 4t（projFrames 714/615 = 7 帧）
    if (++this.frameCtr >= 4) {
      this.frameCtr = 0;
      this.frame = (this.frame + 1) % 7;
    }
    // 挂手（RotatedRelativePoint(MountedCenter)−size/2 + gravDir×2 :64437-64439）
    this.x = this.owner.cx - this.w / 2;
    this.y = this.owner.cy - this.h / 2 + 2;
    // 速度 = 瞄准向 × 基速（:64142-64153 的持械视觉速度；±0.0327 抖动）
    const aim = this.aimCb();
    let ax = aim.x - this.owner.cx, ay = aim.y - this.owner.cy;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al; ay /= al;
    const jit = (Math.random() * 0.1308997 - 0.06544985) * (this.projId === 714 ? 0.5 : 1);
    const c = Math.cos(jit), s = Math.sin(jit);
    this.vx = (ax * c - ay * s) * 8;
    this.vy = (ax * s + ay * c) * 8;
    // 枪口尘（714：彩虹 hsl(ai0/90%1) 267；615 同族彩色）
    if (Math.random() < 0.8) {
      const hue = (this.ai0 / 90) % 1;
      const col = hslToRgbCss(hue);
      game.spawnParticles(this.cx + ax * 40, this.cy + ay * 40, col, 1, 1.2, { life: 18 });
    }
    if (variant < 0) return;
    // ---- volley：开火（弹速 714: 8(+1 变体3) / 615: 14；散布 ±0.098）----
    // 首发跳音门仅 714（:64114 `if (ai[0] != 1f)`）；615 的 Item36 无此门（:64004-64008）
    if (this.projId === 714 ? this.ai0 !== 1 : true) {
      game.playSfxFiles([this.projId === 714 ? 'Item_156' : 'Item_36'], 1, this.cx, this.cy);
    }
    const spd = (this.projId === 714 ? 8 + (variant === 3 ? 1 : 0) : 14);
    const spread = 0.19634955 * Math.random() - 0.09817477;
    const fc = Math.cos(spread), fs = Math.sin(spread);
    const cvx = (ax * fc - ay * fs) * spd, cvy = (ax * fs + ay * fc) * spd;
    const spreadRot = (ang: number) => ({
      x: cvx * Math.cos(ang) - cvy * Math.sin(ang),
      y: cvx * Math.sin(ang) + cvy * Math.cos(ang),
    });
    const ok = this.fireCb(variant, this.owner.cx, this.owner.cy, cvx, cvy,
      { bonusAi1: variant === 4, spreadRot });
    if (!ok) this.dead = true;                              // 无弹药 → Kill（:64183）
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(this.projId);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || !ctx) return;
    const fh = img.height / 7;
    // ---- ★BJ704-G14（件3 [g11-family-body-stealth-dim]）：本体 stealth 减光
    //      （Main.cs:32623-32640 八型族——615 VortexBeater/714 Celeb2 手持件均
    //      ranged=true 门可达,owner=Main.player[proj.owner] :28334）。615 走默认
    //      GetAlpha（RGB×tint、A=255n → ga=n）;714 走 GetAlpha :80888-80894 专属档
    //      （Lerp(newColor,White,0.8)+A 保留再整色 ×a2/255）。
    //      ★BJ704-G19（G14 登记 [g14-714-getalpha-whitening] 暗光基面清偿,G16 评估
    //      两遍制坐标落地）：vanilla 逐通道 =(0.2·L·n+204)·a2f/255、ga=a2f²（n=族
    //      减光 rgb,a2=(int)(255n),L=光照）——白化抬升项 +204(→0.8) 不吃光。
    //      旧实现把 204 烘进 tintedTex 随实体层 compositeLight 乘光=暗处 muzzle
    //      ~黑（vs vanilla 0.2L+204≥80% 白;无 stealth 暗处亦然——G14 实报域）。
    //      两遍制（BJ668 lerp lift 同构算子,Arrow :3596-3603 先例）：
    //      基座 pass=tintedTex 烘 0.2·n_ch·a2f（ga=a2f²,受屏幕光;flatten=false
    //      保形——BJ371/BJ700-C 纪律）;抬升 pass=projFullbrightQueue 'lighter'
    //      光照后 globalAlpha=0.8·a2f³（不受光）;和=tex·a2f³·(0.2·n·L̂+0.8) ≙
    //      vanilla 逐位（含 vortex 逐通道 n）。无 stealth（dimCeleb=null）恒等档:
    //      n=1/a2f=1 → 0.2·L̂+0.8=80% 白底（修暗光面）,满光 0.2+0.8=1.0 恒等
    //      （旧满光带零漂移）。615 默认档维持 G14 原样（无抬升面）。 ----
    const dimCeleb = familyBodyStealthDim(this.owner);
    let srcCeleb: ImageBitmap | HTMLImageElement | HTMLCanvasElement = img;
    let gaCeleb = 1;
    let liftCeleb = -1;                         // ≥0 = 714 抬升 pass 的 globalAlpha
    if (this.projId === 714) {
      const a2f = dimCeleb ? Math.trunc(255 * dimCeleb.ga) / 255 : 1;   // a2=(int)(255n) 通道截断
      const nCh: [number, number, number] = dimCeleb
        ? [dimCeleb.rgb[0], dimCeleb.rgb[1], dimCeleb.rgb[2]] : [1, 1, 1];
      srcCeleb = tintedTex(img, [
        Math.trunc(255 * 0.2 * nCh[0] * a2f),
        Math.trunc(255 * 0.2 * nCh[1] * a2f),
        Math.trunc(255 * 0.2 * nCh[2] * a2f),
      ] as [number, number, number], false) ?? img;
      gaCeleb = a2f * a2f;                      // A=a2×a2/255 → /255=a2f²
      liftCeleb = 0.8 * a2f * a2f * a2f;        // 抬升 0.8·a2f³（'lighter' 加算）
    } else if (dimCeleb) {
      srcCeleb = tintedTex(img, [
        Math.trunc(255 * dimCeleb.rgb[0]), Math.trunc(255 * dimCeleb.rgb[1]), Math.trunc(255 * dimCeleb.rgb[2]),
      ] as [number, number, number], false) ?? img;
      gaCeleb = dimCeleb.ga;
    }
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(Math.atan2(this.vy, this.vx) + Math.PI / 2 + (this.owner.facing === -1 ? Math.PI : 0));
    if (this.owner.facing === -1) ctx.scale(1, -1);
    ctx.imageSmoothingEnabled = false;
    if (dimCeleb || this.projId === 714) ctx.globalAlpha = gaCeleb;
    ctx.drawImage(srcCeleb as CanvasImageSource, 0, this.frame * fh, img.width, fh,
      -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
    // 714 抬升 pass：光照后 'lighter' 加算（世界系闭包,projFullbrightQueue 冲刷
    // 同式相机变换;测试桩无队列时缺省跳过=只丢抬升面不炸）。
    if (liftCeleb >= 0) {
      const lift = liftCeleb, imgL = img, fhL = fh, frameL = this.frame;
      const rotL = Math.atan2(this.vy, this.vx) + Math.PI / 2 + (this.owner.facing === -1 ? Math.PI : 0);
      const flipL = this.owner.facing === -1;
      const cxL = this.cx, cyL = this.cy;
      (r as unknown as { projFullbrightQueue?: Array<(c: CanvasRenderingContext2D) => void> })
        .projFullbrightQueue?.push((c2) => {
          c2.save();
          c2.globalCompositeOperation = 'lighter';
          c2.translate(cxL, cyL);
          c2.rotate(rotL);
          if (flipL) c2.scale(1, -1);
          c2.imageSmoothingEnabled = false;
          c2.globalAlpha = lift;
          c2.drawImage(imgL as CanvasImageSource, 0, frameL * fhL, imgL.width, fhL,
            -imgL.width / 2, -fhL / 2, imgL.width, fhL);
          c2.restore();
        });
    }
  }
}

/** hsl(0..1, 1, 0.5) → css（Main.hslToRgb 近似） */
function hslToRgbCss(h: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    const v = 1 - Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(255 * v);
  };
  return `rgb(${f(5)},${f(3)},${f(1)})`;
}

// ================= 烟花弹 715-718（AI_147） =================

export class Celeb2Rocket extends Entity {
  readonly projId: number;                          // 715-718（弹药档）
  w = 14; h = 14;                                   // SetDefaults（aiStyle147 E=2）
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  dead = false;
  /** 变体光（GetCeleb2Color ×0.5） */
  lightRGB: [number, number, number] | null;
  /** 变体 ai[0]（muzzle 的 ⌊ai0/8⌋%7） */
  private variant: number;
  /** localAI[0]：update 计 */
  private t = 0;
  /** case3 保速（localAI[1] = 初速模长） */
  private spd0 = 0;
  /** case3 追踪目标（ai[1]=敌id+1） */
  private ai1 = 0;
  /** case4 附带 ai1=1（蛇形起步相位 +45） */
  private ai1Flag: boolean;
  /** case1 scale 长大 */
  private drawScale = 1;
  private rot = 0;
  /** ★BJ235 烟花链 oldPos 环（TrailingMode[715-718]=2/cap 20 表驱动,Projectile.cs:
   *  17197-17300 每子步后移;extraUpdates=2 → 3 子步/拍）。绘制面=Main.cs:33997-34083
   *  三帧横条第 2 帧沿段链（drawCeleb2Chain,本体前）;715-718 在 Arrow.GHOST_RECORD_
   *  EXCLUDE 仍保留（本类自管环,防未来同载体双记）。ctor 体初始化（projId 后）。 */
  private ghostRing: ProjGhostRing | null = null;
  private onExplode: (x: number, y: number, damage: number, oldVx?: number) => void;

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段,2026-09-04 溅花缺口批
  //  → projWetSection 共享体接入;豁免核对：715/717 :7586-7597、716/718 :7598-7609
  //  均【无】ignoreWater 行 → 受段）----
  //  位序口径：原版每【子步】（extraUpdates=2 → 3 子步/拍,子步环 :16781）跑
  //  AI()(:16880) → 湿段(:16903) → HandleMovement(:17120)/UpdatePosition(:19973)
  //  → 本类 wet 段置 step() 内 switch（AI_147）后、位移行前;wetCount 冷却窗亦逐
  //  子步 −1（:17109-17112 在子步环内）,与原版同频。湿阻尼 :17721-17764 读【本
  //  子步刷新后】旗;aiStyle 147 不在 UpdatePosition 跳过表（:20551）→ 阻尼适用。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（NewProjectile :10886-10892 等价;共享体首调用执行——首子步
   *  同位=出生盒,原版 NewProjectile 时点等价） */
  presetDone = false;

  constructor(projId: number, variant: number, x: number, y: number, vx: number, vy: number,
    damage: number, knockback: number, ai1Flag: boolean,
    onExplode: (x: number, y: number, damage: number, oldVx?: number) => void) {
    super();
    this.projId = projId;
    this.variant = variant;
    this.ghostRing = new ProjGhostRing(projId);   // ★BJ235（TrailingMode 2/cap 20）
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.knockback = knockback;
    this.ai1Flag = ai1Flag;
    this.onExplode = onExplode;
    this.rot = Math.atan2(vy, vx) + Math.PI / 2;
    const c = CELEB2_COLORS[Math.min(6, Math.max(0, variant))];
    this.lightRGB = [c[0] / 255 / 2, c[1] / 255 / 2, c[2] / 255 / 2];
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    for (let i = 0; i < 3 && !this.dead; i++) this.step(game);   // extraUpdates=2
  }

  private step(game: GameHooks): void {
    this.t += 1;
    this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;       // :49981
    switch (this.variant) {
      case 0:
        if (this.t >= 20) { this.vy = Math.min(this.vy + 0.12, 16); }
        if (this.t > 20 && this.t % 20 === 0) this.trailBurst(game);   // 沿途空爆（:49996-49999）
        break;
      case 1:
        if (this.t === 10) this.vy -= 10;                        // 上抛（:50003-50006）
        if (this.t >= 10) {
          this.vy = Math.min(this.vy + 0.25, 16);
          this.drawScale = Math.min(2.5, this.drawScale + 0.015);
          if (this.t % 10 === 0) this.ringDust(game);
        }
        break;
      case 2:
        if (this.t >= 60) this.vy = Math.min(this.vy + 0.15, 16);
        break;
      case 3: {
        if (this.spd0 === 0) this.spd0 = Math.hypot(this.vx, this.vy);   // localAI[1] 保速
        if (this.t >= 25 && this.ai1 === 0 && this.t >= 20) this.vy = Math.min(this.vy + 0.15, 16);
        if (this.t >= 20) {                                       // 追踪（:50088-50145）
          let tx = 0, ty = 0, found = false;
          if (this.ai1 === 0) {
            let bd = 800;
            for (const ent of game.enemies()) {
              const e = ent as unknown as EnemyLike & { cx: number; cy: number };
              if (!canBeChasedBy(e)) continue;   // CanBeChasedBy :91070——友好 NPC 不入索敌（防追踪睡渔夫）
              if (e.dead) continue;
              const d = Math.abs(e.cx - this.cx) + Math.abs(e.cy - this.cy);
              if (d < bd) { bd = d; tx = e.x + e.w / 2; ty = e.y + e.h / 2; found = true; this.ai1 = e.id + 1; }
            }
            if (!found) this.ai1 = 0;
          } else {
            for (const ent of game.enemies()) {
              const e = ent as unknown as EnemyLike & { cx: number; cy: number };
              if (!e.dead && e.id === this.ai1 - 1) {
                tx = e.x + e.w / 2; ty = e.y + e.h / 2; found = true; break;
              }
            }
          }
          if (found) {
            const dx = tx - this.cx, dy = ty - this.cy;
            const dl = Math.hypot(dx, dy) || 1;
            const W = 8;
            this.vx = (this.vx * (W - 1) + dx / dl * this.spd0) / W;
            this.vy = (this.vy * (W - 1) + dy / dl * this.spd0) / W;
          }
        }
        break;
      }
      case 4: {
        if (this.t === 1 && this.ai1Flag) this.t += 45;           // 相位跳（:50150-50153）
        const a = Math.atan2(this.vy, this.vx);
        const ux = Math.cos(a), uy = Math.sin(a);
        const px = -uy, py = ux;                                  // 垂直向
        // 原式（:50154-50156）：x = normalize(v).RotatedBy(t·π/45).X；
        //                        position += normalize(v).RotatedBy(π/2) × x × 3
        const rx = ux * Math.cos(this.t * (Math.PI / 45)) - uy * Math.sin(this.t * (Math.PI / 45));
        this.x += px * rx * 3;
        this.y += py * rx * 3;
        this.drawScale = 2;
        if (this.t >= 10) this.vy = Math.min(this.vy + 0.04, 16);
        break;
      }
      case 5:
        if (this.t >= 40) this.vy = Math.min(this.vy + 0.08, 16);
        break;
      case 6:
        if (this.t >= 30) this.vy = Math.min(this.vy + 0.1, 16);
        break;
      default:
        break;
    }
    // ---- ★通用湿段（:16903-17113,共享体;每子步一次,溅花尘/音=wetSplashStepShared
    //      弹面 10 粒）---- case4 蛇形侧移（:50154-50156 position 直改）属 AI 相位
    //      置位,原版阻尼只作用于 UpdatePosition 的 velocity 积分 → 侧移【不】吃阻尼
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
    // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）——速度【场】不减只削
    // 位移（UpdatePosition :20557 position += wetVelocity,直积分乘进位移行）
    const df = projWaterDragFactor(this);
    this.x += this.vx * df;
    this.y += this.vy * df;
    const st = game.world.store;
    const tx = Math.floor(this.cx / 16), ty = Math.floor(this.cy / 16);
    if (!st.inBounds(tx, ty)) { this.dead = true; return; }
    if (st.get(tx, ty) !== 0 && st.isSolid(tx, ty)) { this.explode(game); return; }
    // ★BJ235 残影记录（UpdateTrails :17198=Damage 前同位序——原版撞块杀 :17132 早退
    //  不记录,命中杀 Damage 后仍记录一子步:置于命中环前=两门同相）
    this.ghostRing?.record(this.x, this.y, this.rot, this.vx < 0 ? -1 : 1, true);
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（P.cs:12517）先于 Damage_PVE
    //  （:12523）——715-718 penetrate=1 首中即亡拍【照割】（SetDefaults :7586-7611,
    //  aiStyle 147/friendly/ranged）;中央割 !e.dead 门=死亡拍整缺 → BJ260 前置习语。
    //  四型均过两道门（CanCutTiles :15407 两表均无;Damage_CanDealDamage :12461 无）。
    //  （登记债：原版 Kill 链 :75034-75049 Resize 128/240 后再 Damage()——死亡拍
    //  爆炸盒 128/240px 的割面本仓整缺,本刀只补弹盒位,爆炸盒位另案。）
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as EnemyLike;
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ494（2026-10-04）掷率收编 rollVanillaHitCrit 单源（旧 `Math.random()<critChance`
      //  静态掷退役;Game.ts 出生位 `(rangedCrit+武器crit+弹药crit)/100` 小数冻结载体随之
      //  摘除——BJ492「疑有意小数阈值档」假说证伪：714/615 出生位 P.cs:49500/:49505 亲读
      //  =裸 NewProjectile 无任何 crit 特设,Projectile 亦无 crit 字段;小数档实为冻结载体
      //  的单位约定非原版形态,且旧注入漏基 4）：715-718 SetDefaults（:7586-7611 ranged=true
      //  亲读）→ 三类掷 :12920 ranged 臂达=owner.rangedCrit（:25712-14 逐帧折入,命中拍
      //  动态）。ownedBySomeone=非 trap=true → TimerCrit :12928 无条件消费照达。
      //  critChance 字段保留=关断钉（celeb2-mk2 测试置 0 禁掷）。
      const rollCrit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const timerCrit = (game.player as unknown as
        { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
        | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false;
      const crit = rollCrit || timerCrit;
      const dmg = crit ? this.damage * 2 : this.damage;
      // ★F3 接线（蓝队四轮）：庆祝弹射器 MK2 族（714/615/715-718）数据面 ranged
      // → 焰爆石/拍击石双支（Projectile.cs:13439-13446）随 Damage() 生效；加伤在
      // banner 采样外、随暴击并入实伤参（序注见 stats/SnapStrike.ts F1 迁移）
      const snapBonusCeleb2 = projectileSnapStrikeBonus(game,
        { projId: this.projId ?? 714 }, e.x + e.w / 2, e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusCeleb2 ? Math.trunc(snapBonusCeleb2 * (crit ? 2 : 1)) : 0),
        Math.sign(this.vx) * this.knockback, 0, game, this.armorPen, crit, 0, true);   // 音/飘值=StrikeNPC 单点;fromPlayer=DPS 计
      this.explode(game);                              // penetrate 1 → 命中即 Kill
      return;
    }
  }

  /** 变体 0 沿途空爆视觉（AI_147_Explosion case0 近似：尘 31×4 + 130×20） */
  private trailBurst(game: GameHooks): void {
    game.spawnParticles(this.cx, this.cy, '#E8C060', 4, 1.6, { life: 20 });
    const col = `rgb(${CELEB2_COLORS[this.variant].join(',')})`;
    game.spawnParticles(this.cx, this.cy, col, 10, 1.2, { life: 26 });
  }

  /** 变体 1 尘环（:50030-50046 近似） */
  private ringDust(game: GameHooks): void {
    const col = `rgb(${CELEB2_COLORS[this.variant].join(',')})`;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      game.spawnParticles(this.cx + Math.cos(a) * 4, this.cy + Math.sin(a) * 8, col, 1, 1, { life: 18 });
    }
  }

  /** Kill：爆（716/718 毁地形由 EXPLODE_RADIUS 表管；视觉=变体色爆） */
  private explode(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    const col = `rgb(${CELEB2_COLORS[Math.min(6, this.variant)].join(',')})`;
    game.spawnParticles(this.cx, this.cy, col, 14, 2.2, { life: 24 });
    game.spawnParticles(this.cx, this.cy, '#E8C060', 6, 1.8, { life: 20 });
    // SW-AC1 2026-09-04：尾参 oldVx=Kill 态弹末 vx——Game 侧换算 kbDir 弹体朝向
    //  （Projectile.direction,Update :17121-17132 sign(velocity.X) 自动面;
    //  715-718 aiStyle147 不在排除表,X 分量 AI 不改 → Kill 态=本 vx 符号,0→+1）
    this.onExplode(this.cx, this.cy, this.damage, this.vx);
  }

  draw(r: Renderer, _cam: Camera): void {
    const img = projSprite(this.projId);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || !ctx) return;
    // ---- ★BJ235 烟花链（Main.cs:33997-34083 1:1;锚链内先画=垫底,本体后画压顶）——
    //      三帧横条第 2 帧沿段链:色=GetCeleb2Color×0.8 A=127×0.8×(1−i/20)、rot=oldRot、
    //      scale=(段长/帧宽,1);变体2 摆动表 ±w×4px+scale×0.6、变体5 scale×0.5。 ----
    if (this.ghostRing && this.ghostRing.filled > 1) {
      const c0 = CELEB2_COLORS[Math.min(6, Math.max(0, this.variant))];
      drawCeleb2Chain(ctx, this.ghostRing, img, [c0[0], c0[1], c0[2]], this.variant,
        1080 - this.t, this.w, this.h, img.width / 3, img.height);
    }
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    const dw = img.width * this.drawScale, dh = img.height * this.drawScale;
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
}
