// 初代分形剑 4722 → 弹 857（AI_168_FirstFractal :43886-43920 + 出生链
// Player.cs:47400-47447）：channel（useTime=anim/5 每挥 5 发）。出生：
//   目标=GetSparkleGuitarTarget 随机可追敌（+预测 20t 速度）或鼠标位（±24px 散布、
//   距离钳 700、方向混入玩家速度 ×0.8）；弹速 12+rand×2；ai[0]=±π/120 曲率；
//   出生点=目标−∫30 步旋转弧（vector40，从弧尾入场的飞刀感）。
//   AI：60t 消亡；帧=rand(15)；vel.RotatedBy(ai0)；Opacity 淡入 12t/末 12t；
//   rotation=π/4×spriteDir+vel 角（左向 +π）；尘 278 尾（1/15，>7t）。
//   绘制：Projectile_857 帧条（贴图尺寸待运行期取），×Opacity。
// ★通用湿段定谳（2026-09-06 武器弹簇批）：857 SetDefaults（:8222-8232）
//   ignoreWater=true（:8231）= 豁免——P.cs:16903 湿段整段门不开,溅花/湿旗/水阻尼
//   全不适用,不接 projectileWetSection。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { projFrameImg } from './Arrow';
import { hitTownNpcs, playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { rollVanillaHitCrit } from './proj1457';

export class FirstFractalSlash extends Entity {
  w = 32; h = 32;
  damage: number;
  /** ★BJ486③ vanilla 弹 id（SetDefaults 857 :8222 melee=true）——rollVanillaHitCrit 锚 */
  readonly projId = 857;
  critChance = 0.04;
  armorPen = 0;
  /** ai[0] 每 tick 曲率（±π/120） */
  private ai0: number;
  /** localAI[0] 计数（60 消亡） */
  private t = 0;
  private frame: number;
  private opacity = 0;
  private rot = 0;
  private hitSet = new Set<number>();
  dead = false;
  lightRGB: [number, number, number] | null = [0.5, 0.7, 1];

  constructor(x: number, y: number, vx: number, vy: number, damage: number, ai0: number) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.ai0 = ai0;
    this.frame = Math.floor(Math.random() * 15);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (++this.t >= 59) { this.dead = true; return; }
    // vel 旋转（:43901）
    const c = Math.cos(this.ai0), s = Math.sin(this.ai0);
    const nvx = this.vx * c - this.vy * s, nvy = this.vx * s + this.vy * c;
    this.vx = nvx; this.vy = nvy;
    // Opacity 淡入 12t/末 12t（:43903）
    const LIFE = 60;
    const in01 = Math.min(1, this.t / 12);
    const out01 = this.t <= LIFE - 12 ? 1 : Math.max(0, (LIFE - this.t) / 12);
    this.opacity = in01 * out01;
    const sd = this.vx > 0 ? 1 : -1;
    this.rot = Math.PI / 4 * sd + Math.atan2(this.vy, this.vx) + (sd === -1 ? Math.PI : 0);
    this.x += this.vx;
    this.y += this.vy;
    // 尘 278 尾（1/15，>7t）
    if (this.t > 7 && Math.random() < 1 / 15) {
      game.spawnParticles(this.cx, this.cy, Math.random() < 0.7 ? '#7CB8FF' : '#FFFFFF', 1, 1.2, { life: 20 });
    }
    // 命中（穿透 -1；localNPCHitCooldown=10）
    // 城镇 NPC 巫毒窄门（Damage_PVE_Inner :11970-11972——玩家弹族同门；无娃娃 no-op）
    hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 6.5, 'playerProj', 0);
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || this.hitSet.has(e.id)) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ486③ 掷率=owner 装配（rollVanillaHitCrit:12915-12927,857 melee 旗）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const dmg = this.damage;     // ★S02(BJ723-B):crit ×2 移 Enemy.hurt 防后(NPC.cs:82067)
      e.hurt(applyBannerDamageDealt(game, e, dmg), Math.sign(this.vx) * 6.5, 0, game, this.armorPen, crit, 0, true);   // 音/飘值=单点;fromPlayer=DPS 计
      this.hitSet.add(e.id);
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    // ★S2/BJ415（2026-09-30）切片轴修正：原文 DrawProj 专支 Main.cs:33934
    //  `texture2D4.Frame(15, 1, proj.frame)` = 15 列横切（帧 90×84,贴图 1350×84 横条;
    //  frame=AI_168 :43897 出生 Next(15) 掷定恒定）。旧式以 height/width 推帧数
    //  （84/1350→0 钳 1）= 整幅 1350×84 画出（15 剑一排,660 天界碎裂剑同病）。
    //  单源 = Arrow.PROJ_GRID[857]（projFrameImg 列主序横切,越界钳末帧）。
    const fr = projFrameImg(857, this.frame);
    const ctx = r.ctx;
    if (!fr || !(fr.width > 0) || !ctx) return;
    if (this.opacity <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    if (this.vx < 0) ctx.scale(1, -1);
    ctx.drawImage(fr, -fr.width / 2, -fr.height / 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
