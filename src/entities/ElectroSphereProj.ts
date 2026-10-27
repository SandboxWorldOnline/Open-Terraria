// 电圈发射器电球 443（aiStyle 77）：SetDefaults Projectile.cs:5139-5149（80×80、
// friendly、ranged、alpha 255、penetrate −1、tileCollide false、ignoreWater）/
// timeLeft 钳 300（NewProjectile :11067-11070 = 5s）/ AI :31192-31285 / 绘制
// Main.cs:33006-33027（双层反向旋转）/ GetAlpha :81099 (255,255,255,128)×(1−α/255)。
// 电圈发射器 2796 导弹 442 Kill（:74919-74945）owner 本机 → 80×80 盒内旧 443 置
// 替换态（ai[1]=1 + velocity=(新心−旧心)/5）+ 心部生成 443（伤 = 导弹伤、kb 0）。
// AI 语义：α −50/t 渐显（:31205-31213）；替换态 friendly=false + α +51/t 至 255
// Kill（:31196-31204）；ai[0] 120t 循环脉冲（:31215-31227，判定盒 80×max(scale5,
// scale6) = 60..80）；帧 3t/帧 4 帧循环（:31228-31236）；每帧 226 尘环 1+1/2+1/4
// 枚（:31237-31284）。命中：Damage_PVE 通用 + immune[owner]=8 档（:14072-14074）
// ——本仓 e.iframes 全局通道直写 8（Enemy.hurt 通用档 10 后覆写）。
// aiStyle 77 头部 ActiveSound 段（:31194-31204）管理的 localAI[0] 音槽在 1457 全
// 库无启动点（PlayTrackedLoopedSound 五处均非 443）→ 原版本体无声，不接。
// 独立实体先例：XenoBubbleProj/HealProj（驻场 AOE 不走 Arrow 命中管线——
// penetrate −1 持续多跳 + 脉冲判定盒逐拍缩放，通用弹语义不适配）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projSprite } from './Arrow';
import { playerCanHitEnemy, applyBannerDamageDealt, hitTownNpcs, hitCrittersAll } from './projTargets';   // ★BJ729-A（D1 B17）：城镇 voodoo 靶 + critter 臂
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { rollVanillaHitCrit } from './proj1457';   // ★BJ497② 掷率单源（443 ranged 旗命中拍动态）

export const ELECTROSPHERE_PROJ = 443;
/** timeLeft（NewProjectile :11067-11070 钳 300 = 5s） */
export const ELECTROSPHERE_LIFE = 300;
/** 命中免疫帧（Damage_NPC per-type 档 :14072-14074 immune[owner]=8） */
export const ELECTROSPHERE_IFRAMES = 8;
/** 替换态淡出速率（:31199 alpha += 51） */
export const ELECTROSPHERE_FADEOUT = 51;

export class ElectroSphereProj extends Entity {
  w = 80; h = 80;                       // SetDefaults :5140-5141
  damage = 0;
  /** ★BJ497②（2026-10-04）旧 critBonus 孤儿字段摘除（全库无写者=恒 0 死值）。0.04=
   *  掷率路由门（>0）非掷率,≤0 关断钉载体（测试置 0 习语,BeamBoltProj BJ489 同形）
   *  ——443 数据面 ranged（SetDefaults :5146）,掷率=rollVanillaHitCrit 命中拍动态。 */
  critChance = 0.04;
  armorPen = 0;
  /** ai[0]：脉冲/自旋相位（120t 循环 :31215-31219） */
  private ai0 = 0;
  /** ai[1]=1 替换态（:74935 邻近新球置位）→ friendly=false 淡出 */
  replaced = false;
  /** ★BJ294（件 2）中央割门运行时覆写口：替换态原版 `friendly = false`
   *  （aiStyle77 P.cs:31213-31226）→ CutTiles 门（:12515）不进=拒割。
   *  U3 旧锚 :29128/:29156 系行段漂移（那两行在 aiStyle54 块）。 */
  get noVanillaCut(): boolean { return this.replaced === true; }
  /** alpha（SetDefaults 255 起；渐显 −50/t / 替换态 +51/t） */
  alpha = 255;
  private frame = 0;
  private frameCnt = 0;
  /** timeLeft（:11067 钳 300） */
  private life = ELECTROSPHERE_LIFE;

  /** cx/cy = 电球心（Kill 442 :74944 NewProjectile(Center)）；dmg = 导弹伤透传 */
  constructor(cx: number, cy: number, dmg: number) {
    super();
    this.x = cx - this.w / 2;
    this.y = cy - this.h / 2;
    this.damage = dmg;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.replaced) {
      //（:31196-31204）friendly=false + α +51/t → 255 Kill
      this.alpha += ELECTROSPHERE_FADEOUT;
      if (this.alpha >= 255) { this.alpha = 255; this.kill(game); return; }
    } else if (this.alpha > 0) {
      this.alpha = Math.max(0, this.alpha - 50);         //（:31205-31213）
    }
    // 脉冲相位 + 判定盒缩放（:31215-31227）：vector52 = −UnitY.Rot(2π·ai0/30)，
    // scale5 = 0.75 + y·0.25 / scale6 = 0.8 − y·0.2，盒 = 80×max（60..80）。
    // 位移（Update 通用段）：tileCollide=false 自由漂移——替换态 velocity =
    // (新球心−旧心)/5（:74937）即"旧球被新球吸拢合并"的观感
    this.x += this.vx;
    this.y += this.vy;
    this.ai0 = (this.ai0 + 1) % 120;
    const vy52 = -Math.cos((Math.PI * 2 * this.ai0) / 30);
    const scale5 = 0.75 + vy52 * 0.25;
    const scale6 = 0.8 - vy52 * 0.2;
    const size = Math.max(1, Math.round(80 * Math.max(scale5, scale6)));
    const cx = this.cx, cy = this.cy;
    this.w = size; this.h = size;
    this.x = cx - size / 2;
    this.y = cy - size / 2;
    // 帧 3t/帧 4 帧循环（:31228-31236）
    if (++this.frameCnt >= 3) {
      this.frameCnt = 0;
      this.frame = (this.frame + 1) % 4;
    }
    // 226 尘环（:31237-31284，不设 ai[1] 门——替换态淡出期仍发）：每帧 1 枚
    // scale 0.5（+1/2 概率 scale 0.9、+1/4 概率再 scale 0.7）；出生盒随机位 →
    // 拉到环半径 11..66×pulse、速度 = 径向单位向
    {
      const ring = 55 * (size / 80), inner = 11 * (size / 80);
      const spawnRingDust = (scale: number, velMul: number): void => {
        const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 226, 0, 0, 100, null, scale, true);
        if (!d) return;
        d.vx *= velMul; d.vy *= velMul;
        const a = Math.random() * Math.PI * 2;
        const r = inner + 0.5 * Math.random() * ring;
        d.x = cx + Math.cos(a) * r;
        d.y = cy + Math.sin(a) * r;
        const dl = Math.hypot(d.x - cx, d.y - cy) || 1;
        d.vx = d.vx / 2 + (d.x - cx) / dl;
        d.vy = d.vy / 2 + (d.y - cy) / dl;
      };
      spawnRingDust(0.5, 2);
      if (Math.random() < 0.5) spawnRingDust(0.9, 1.2);
      if (Math.random() < 0.25) spawnRingDust(0.7, 1.2);
    }
    // timeLeft（:15861 逐 tick）→ 300t 消散（443 Kill 无特效——全库无 443 Kill 分支）
    if (--this.life <= 0) { this.kill(game); return; }
    if (this.replaced) return;                           // friendly=false 不再结算伤害
    // 命中（Damage_PVE :11850 迭代 + per-type immune[owner]=8 :14072-14074）
    for (const ent of game.enemies()) {
      const e = ent as unknown as {
        id: number; dead: boolean; x: number; y: number; w: number; h: number;
        iframes?: number; hurt: (d: number, kx: number, ky: number, g: GameHooks,
          pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
      };
      if (e.dead) continue;
      if (!playerCanHitEnemy(e, game, ELECTROSPHERE_PROJ)) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x
        && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      if ((e.iframes ?? 0) > 0) continue;                // immune[owner] 门（:11869）
      // ★BJ497②（2026-10-04）掷率收编：旧面 `Math.random() < (4 + this.critBonus)/100`
      //  =critBonus 无写者的孤儿 4% 平率（owner 聚合/:25712 持械折入整缺）——443 数据面
      //  ranged（SetDefaults :5146,亲读）→ rollVanillaHitCrit 命中拍动态（critChance>0
      //  路由门,类缺省 0.04;442 导弹 Kill 出生位 Game.ts :42957 无写位=类缺省同门）。
      const crit = this.critChance > 0 && rollVanillaHitCrit(ELECTROSPHERE_PROJ, game);
      // ★F3 接线（蓝队四轮）：电球 443 数据面 ranged（SetDefaults :5139-5149）→
      // 焰爆石/拍击石双支（Projectile.cs:13439-13446）随 Damage() 生效；加伤在 banner
      // 采样外、随暴击并入实伤参（序注见 stats/SnapStrike.ts F1 迁移）
      const snapBonusSphere = projectileSnapStrikeBonus(game,
        { projId: ELECTROSPHERE_PROJ }, e.x + e.w / 2, e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      // ★BJ497② 翻倍归位（BJ496③ 同族缺口）+★S02(BJ723-B):crit ×2 统一移
      //  Enemy.hurt 防后(NPC.cs:82067)——旧面染 crit 色零翻倍,后随「调用侧预倍」
      //  惯例,现单布尔承载。
      e.hurt(applyBannerDamageDealt(game, e, Math.max(1, Math.trunc(this.damage)))
        + (snapBonusSphere ? snapBonusSphere : 0),
        0, 0, game, this.armorPen, crit, 2, true);
      e.iframes = ELECTROSPHERE_IFRAMES;                 //（:14072-14074，覆写通用档 10）
    }
    // ★BJ729-A（D1 B17,2026-10-27）：critter 臂——原版 Damage_PVE victim 循环
    //  （:12592）对小动物同链（443 非 minion/sentry → CanNPCBeHit :20675 放行）;
    //  penetrate=-1 持续脉冲多靶 → hitCrittersAll（受理数走 numHits 账 :14263）。
    hitCrittersAll({ x: this.x, y: this.y, w: this.w, h: this.h, projId: ELECTROSPHERE_PROJ }, game);
    // ★BJ729-A（D1 B17）：城镇 voodoo 靶——friendly 弹走 flag 巫毒窄门（:12618-
    //  12631,22 killGuide/54 killClothier）;settle 镜像敌怪臂链（crit 掷 :12915-27
    //  ranged 旗;穿甲 armorPen;DV=敌怪臂面级既有形态不单侧补齐[D6 族登记]）。
    //  immune[owner]=8 档对城镇靶由 TownNPC.hurt iframes 近似承载（D3 族口径）。
    hitTownNpcs(this, game, Math.max(1, Math.trunc(this.damage)), 0, 'playerProj',
      ELECTROSPHERE_PROJ, undefined, undefined, undefined, undefined,
      () => ({ crit: this.critChance > 0 && rollVanillaHitCrit(ELECTROSPHERE_PROJ, game),
        penPercent: this.armorPen }));
  }

  /** 消亡口（无 Kill 特效——vanilla 443 Kill 无专属分支；dead 旗交 EntityManager 剔除） */
  private kill(_game: GameHooks): void {
    this.dead = true;
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(ELECTROSPHERE_PROJ);
    if (!img || img.width <= 0) return;
    // Main.cs:33006-33027：双层同帧反向旋转（±2π·ai0/120）、scale5/scale6 各自缩放；
    // GetAlpha (255,255,255,128)×(1−α/255) → 不透明度 0.5×fade（白 tint 对亮青环≈无偏）
    const num313 = (Math.PI * 2 * this.ai0) / 120;
    const fade = Math.max(0, Math.min(1, 1 - this.alpha / 255));
    const ga = fade * (128 / 255);
    const fh = img.height / 4;
    const fy = fh * this.frame;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = ga;
    ctx.rotate(num313);
    ctx.drawImage(img as CanvasImageSource, 0, fy, img.width, fh,
      -img.width / 2, -fh / 2, img.width, fh);
    ctx.rotate(Math.PI * 2 - num313 * 2);
    ctx.drawImage(img as CanvasImageSource, 0, fy, img.width, fh,
      -img.width / 2, -fh / 2, img.width, fh);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
