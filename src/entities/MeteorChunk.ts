// 流星雨陨石碎块(Projectile 1078 "MeteorOre",WorldGen.UpdateWorld :71771-71810
// 消耗 meteorShowerCount 的产物)。与夜间坠星(FallingStar,弹幕 12)是两个东西:
// 1078 无重力恒速直线(★2026-09-06 翻案:AI_199(:40743-40761)与 Projectile 通用
// 路径均无 velocity 写行,初速即终速——WorldGen.cs:72305 num11=12 置值+
// :72321-72326 归一注入(★F3 勘误:旧 :72326-72335 系 1456 行号),
// 直到 tileCollide 撞块消亡;旧"带重力抛物线 vy+=0.3"系既有近似,已退役)、
// 伤害 50(专家40/大师35)+ 击退 5、命中玩家施加 OnFire(24)
// 300-600t(Projectile.cs:11456-11459)、撞地消亡但带掉落(Kill :76509-76511:
// netMode!=1 门内 1/16 × item116 陨石矿 ×Next(2,7)=2..6)——★头注旧"撞地无掉落"
// 系审计误读(F2 2026-08-26 勘误):把 1078 与坠星弹幕 12 的掉落语义混记了。两者
// 区分:1078=概率小量陨石矿;弹幕 12 自然星(damage>500)落地必掉 item75×1
// (Kill_ExplodeTiles :79349-79351,FallingStar natural 支已对齐)。
// · SetDefaults(:10069-10078,★F1 勘误:旧 :9783-9793 系 1456 行号):w=h=14, hostile+friendly, penetrate=-1
// · AI_199(:40743-40761):frame=rand(3) 视觉;尘 31(无门)+尘 6(!wet 门);红光(1,0,0);
//   rotation += vx*0.06 + direction*0.06;运动=无重力恒速直线(无 velocity 写行)
import { Entity } from './Entity';
import { TILE } from '../core/constants';
import type { GameHooks } from './types';
import { BuffType } from '../stats/Buffs';
import { hitCritters, hitTownNpcs, playerCanHitEnemy } from './projTargets';
import { hostileProjectileDamage, mainDifficulty } from '../stats/ScaleStats';
import { VANILLA_ITEM_KEY_BY_ID } from '../data/items';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';

export class MeteorChunk extends Entity {
  w = 14; h = 14;
  rot = 0;
  /** 帧变体(:37673 Main.rand.Next(3),帧不自增) */
  frame: number;
  life = 5400;
  /** ★BJ294 敌射/环境侧拒割位：1078 SetDefaults friendly+hostile 双旗
   *  （P.cs:10069-10078 型录同,★F1 勘误:旧 :9783-93 系 1456 行号）但 vanilla 出生
   *  = WorldGen 陨石雨 NewProjectile 8 参
   *  【owner 缺省】→ NewProjectile Owner=-1→255（P.cs:10866-69;W.cs:72337 无
   *  owner 实参,★F3 勘误:旧 :72335 系误记）≠ Main.myPlayer → :12515 CutTiles 门
   *  不进。详 Entity.ts 中央门
   *  BJ294 注（对照：813 血云出生显式 owner=myPlayer 故照割不标）。 */
  noVanillaCut = true;
  private hitPlayer = false;
  private hitCd = new Map<number, number>();

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段,2026-09-04 溅花缺口批
  //  → projWetSection 共享体接入;豁免核对：1078 SetDefaults :10069-10078 无
  //  ignoreWater 行 → 受段）----
  //  位序口径：原版 AI_199(:40743-40761) → 湿段(:16903) → UpdatePosition(:19973)。
  //  AI_199 有湿旗消费者（尘 6 !wet 门 :40752,读上拍旗）→ 湿段【必须】在 AI 段后、
  //  位移前拆位调用（勿上移 tick 头,否则门读当拍旗差一拍）。湿阻尼 :17721-17764
  //  读【本拍刷新后】旗;1078 非 UpdatePosition 跳过表成员（:20551）→ 阻尼适用。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐 update −1） */
  wetCount = 0;
  /** 出生预置已做（NewProjectile :10886-10892 等价;共享体首调用执行） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, frame = Math.floor(Math.random() * 3)) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.frame = frame;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    if (--this.life <= 0) {
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 timeLeft--/Kill 在子步【末尾】
      //  （:17307-17311,AI(:16880)→湿段(:16895)→位移→Damage 之后）→ 寿命尽当拍湿段
      //  照跑（`!active` 门 :17132 只拦 Damage/尾尘）。本仓递减杀在拍头曾整体跳过
      //  湿段;现补跑,测位=存储位：AI_199（:40743-40761）只写帧/尘/rotation 不写
      //  position → 原版杀拍湿段测位=上拍位移末位=存储位,逐值等价。杀支与 AI 尾
      //  活拍调用点同拍互斥（早退）→ 无需 wetSectionRan 旗;1078 ∉ IsDestroyedByWater
      //  六型/非 80 → 段内无补 Kill 面（杀拍时点=原版 Kill 前相位,段先死后）。
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        1078, !!projectileData(1078)?.ignoreWater);
      this.dead = true;
      return;
    }
    const st = game.world.store;
    // ---- AI_199 视觉段（1457 :40743-40761 / 1456 :37668-37691,两版同文;原版 AI
    //      :16880 先于湿段 :16903——挪到湿段前,尘位=pre-move 同原版 NewDust(position)) ----
    this.rot += this.vx * 0.06 + (this.vx >= 0 ? 0.06 : -0.06);   // 1457 :40759-40760
    // 尘 31（1457 :40745-40749,无门每拍 1 粒）：NewDust(盒 14×14, 31, 0,0, α100) +
    // scale=0.1+Next(5)×0.1（绝对覆写,消解 NewDust ±0.2 抖）+ fadeIn=1.5+Next(5)×0.1
    // + noGravity。★2026-09-06 残差翻案清偿：既有"0.5 降采样 spawnParticles 单粒子"
    // 近似 conflates 两尘——尘 31 整条缺面（原版无门恒发）,尘 6 的 !wet 门只对受控
    // 半生效;现按原文两尘分立逐值补齐（spawnDust 直入原版尘池,颜色/贴图由尘型承载）
    const d31 = game.spawnDust?.(this.x, this.y, this.w, this.h, 31, 0, 0, 100);
    if (d31) {
      d31.scale = 0.1 + Math.floor(Math.random() * 5) * 0.1;    // :40746
      d31.fadeIn = 1.5 + Math.floor(Math.random() * 5) * 0.1;   // :40747
      d31.noGravity = true;                                     // :40748
    }
    // 尘 6 !wet 门（1457 :40751-40757,读【上拍】湿旗——本链在湿段调用前=上拍值）：
    // NewDustDirect(盒 14×14, 6, 0,0, α100) + scale=1+Next(5)×0.1（绝对覆写——
    // NewDust ±0.2 抖与 6 号烟族型内 ×0.7 一并消解,与原版赋值序同构）+ 盒内随机位
    // ±Next(-40,41)×0.1 + noGravity。烟族型内初速预处理（Dust.cs:221-226: vx×0.3/
    // vy=Next(-10,6)×0.1）VanillaDust.spawn 已植且【不被】本支覆写（原版调用侧只动
    // scale/position/noGravity）→ 速度面逐位保留
    if (!this.wet) {
      const d6 = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100);
      if (d6) {
        d6.scale = 1 + Math.floor(Math.random() * 5) * 0.1;     // :40754
        d6.x += (Math.floor(Math.random() * 81) - 40) * 0.1;    // :40755 Next(-40,41)×0.1
        d6.y += (Math.floor(Math.random() * 81) - 40) * 0.1;    // :40756
        d6.noGravity = true;                                    // :40757
      }
    }
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    // ---- ★通用湿段（:16903-17113,共享体;溅花尘/音=wetSplashStepShared 弹面 10 粒）----
    projectileWetSection(this, game, st, this.x, this.y, this.w, this.h,
      1078, !!projectileData(1078)?.ignoreWater);
    // ★运动=纯直线（2026-09-06 翻案清偿,旧 vy+=0.3 抛物线近似退役）：AI_199
    // （:40743-40761）无任何 velocity 写行、Projectile 通用路径亦无跨型重力——
    // 1078 初速即终速恒 12px/t 直线（WorldGen.cs:72305 num11=12 置值+:72321-72326 归一注入,
    // 本仓 Game.ts 生成位同式 k0=12/hypot）,直至 tileCollide 撞块消亡（:76509）。
    // ★水中位移阻尼（HandleMovement :17721-17764,湿段批）：速度【场】不减只削
    // 位移（UpdatePosition :20557 position += wetVelocity,直积分乘进位移行）
    const df = projWaterDragFactor(this);
    this.x += this.vx * df;
    this.y += this.vy * df;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (!st.inBounds(tx, ty)) { this.dead = true; return; }
    // 伤害(:71801-71806):50 / 专家 40 / 大师 35,击退 5
    const diff = (game.world as unknown as { difficulty?: number }).difficulty ?? 0;
    const dmg = diff >= 2 ? 35 : diff === 1 ? 40 : 50;
    const p = game.player;
    if (!this.hitPlayer && p && !p.dead && this.aabbOverlaps(p)) {
      this.hitPlayer = true;                              // penetrate -1:穿过不消亡
      // Damage_EVP：1078 生成值 50/40/35 是基础（WorldGen.cs:71798-71806），命中再过乘区×2
      game.damagePlayer(hostileProjectileDamage(dmg, mainDifficulty(game.world)) * 2, this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: 1078 });   // ★R-B-F10(第4=knockback 位,opts 第5)(2026-10-14):弹域双旗点亮(Game.ts damagePlayer :44480 门=projDomain&&projVid;★BJ704-R3 P1:旧单旗=静默 no-op)
      p.buffs.apply(BuffType.OnFire, (300 + Math.floor(Math.random() * 301)) / 60);  // :11456
    }
    hitTownNpcs(this, game, dmg, Math.sign(this.vx) * 5);
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      const cd = this.hitCd.get(e.id) ?? 0;
      if (cd > 0) continue;
      this.hitCd.set(e.id, 20);
      e.hurt(dmg, Math.sign(this.vx) * 5, 0, game, 0, false, 0, true);   // fromPlayer=DPS 计
    }
    hitCritters(this, game);
    // 撞地消亡(tileCollide 默认)
    if (st.isSolid(tx, ty)) {
      // Kill 掉落（Projectile.cs:76509-76511,netMode!=1 门=纯客户端不掷）：
      // Main.rand.Next(16)==0 → Item.NewItem(Center,116 陨石矿,Next(2,7)=2..6)。
      // vid→key 走 VANILLA_ITEM_KEY_BY_ID 反查（CoinPortalProj 同惯例）
      if (Math.random() < 1 / 16) {
        const oreKey = VANILLA_ITEM_KEY_BY_ID[116];
        if (oreKey) game.spawnDrop(this.cx, this.cy, oreKey, 2 + Math.floor(Math.random() * 5));
      }
      game.spawnParticles(this.cx, this.cy, '#FF9060', 6, 2, { life: 24 });
      // Kill 音(:76511-76518):type 1078 掷 Next(1,4) 次 MeteorShower 跟踪音——
      // CreateTrackable("meteor_shower",6) vol×0.8 pitchVariance±0.3(SoundID.cs:1120)
      // ★pitch 抖动 = SoundStyle.GetRandomPitch = rand×PV−PV/2 ∈ ±PV/2（±0.15）,
      //   非全幅 ±PV——曾 ×2 过宽（2026-08-26 review 修）
      const hits = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < hits; i++) {
        game.playSfxWav?.(`meteor_shower_${Math.floor(Math.random() * 6)}`, 0.8, this.cx, this.cy,
          (Math.random() - 0.5) * 0.3);
      }
      this.dead = true;
    }
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; atlas?: { vimages: Map<string, ImageBitmap | HTMLImageElement>; ensureVImage?: (f: string) => ImageBitmap | HTMLImageElement | null } | null }): void {
    // Projectile_1078.png 16×54 = 3 帧 16×18
    const ctx = r.ctx;
    if (!ctx || !r.atlas) return;
    // ensureVImage 触发懒加载(此前直取且无人预载该表 = 永久隐形,2026-08-13 排雷)
    const img = r.atlas.ensureVImage ? r.atlas.ensureVImage('vanilla/Projectile_1078.png') : r.atlas.vimages.get('vanilla/Projectile_1078.png');
    if (!img || !img.width) return;
    const fw = 16, fh = 18;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.drawImage(img, 0, this.frame * fh, fw, fh, -fw / 2, -fh / 2, fw, fh);
    ctx.restore();
  }
}
