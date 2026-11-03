// 治疗弹（原版 Projectile 298 GhostHeal / 305 VampireHeal，aiStyle 52）：
// 吸血/鬼疗命中敌怪后从命中点起飞，追踪目标玩家，抵达（距离<50 且盒相交）结算
// 回复 floor(ai[1]) 并消亡。Projectile.AI aiStyle 52（1457 :28929-28987；旧引 :27114-
// 27165 为 1456 行号）1:1：
//   - 速度 4（num390 :28932），速度插值 (v×15+dir)/16（:28957-28958——298/305 同档）；
//     每子步位移 extraUpdates+1 次（298=3 :3614 / 305=10 :3696）
//   - 命中门（:28938）：dist<50 且弹盒与目标矩形相交
//   - 结算门（:28940）：owner==本地 ∧ !moonLeech——月噬(145)在身只免结算不免死，
//     Kill(:28952) 在门外；主门在生成端 Game.applyLifeSteal（月噬全禁发射）
//   - 命中分支内无 return：消亡当拍仍执行速度混合 + 整批尾迹尘（:28954-28986）
// 弹体参数（SetDefaults :3610-3617 / :3692-3698）：6×6、alpha 255、tileCollide=false
// （穿墙）、298 magic=true（已由调用点魔法门保证）。
// 单人语义（★BJ746 A23 勘正）：原版鬼疗【生成时】跨玩家槽选最缺血者
// （ghostHeal :12097-12108：active∧!dead∧((!owner.hostile∧!cand.hostile)∨同队)∧
// 距命中点≤3000，取 statLifeMax2−statLife 严格更大者；全满血回落 owner）——目标经
// ai[0] 固化，AI_052 只追不动重选。本仓远端代理体系（candidatePlayers）已建，
// 选择面落 Game.applyLifeSteal（vampireHeal :12118-12119 恒 owner 自己不变）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { entityNet } from '../net/entitySyncHooks';   // ★BJ755-A T2：msg66 治疗上报（结算位单源）

export class HealProj extends Entity {
  w = 6; h = 6;
  /** 原版弹型（305 吸血 / 298 鬼疗）——决定 extraUpdates 与尾迹密度 */
  readonly projType: 298 | 305;
  /** ai[1] 回复量（float，结算时 (int) 取整 :27130） */
  readonly heal: number;
  /** 每子步次数（原版 extraUpdates+1） */
  private readonly extraUpdates: number;
  /** 目标玩家引用（原版 ai[0] 玩家下标；★BJ746 A23 起可为远端缺血队友代理） */
  private readonly target: { x: number; y: number; w: number; h: number;
    hp: number; maxHp: number };
  /** ★BJ746 A24（issue#35）：timeLeft=3600（SetDefaults 缺省复位 :789）——原版
   *  :17307 `timeLeft--` 在子步循环【内】（298 extraUpdates=3 → 4 次/tick、305=10
   *  → 11 次/tick）⇒ 自然寿命=3600 子步=900t(15s)/327t(≈5.5s)。旧每 tick 一次
   *  递减=60s（远离目标时四倍滞留）。 */
  private life = 3600;

  // ---- ★通用湿段（Projectile.cs:16895-17113 全体弹共用段;2026-09-06 杂项弹簇批）----
  //  豁免核对：298（P.cs:3885-3893）/305（:3967-3974）SetDefaults【均无 ignoreWater
  //  行】= 全受段（数据面同向）。本体 α=255 隐形（GetAlpha 无 298/305 特判）但原版
  //  照样溅 10 粒——可见观感=溅花尘面。
  //  ★子步口径：湿段在 numUpdates 子步循环【内】（:16781-17345）——298 extraUpdates=3
  //  (:3614)→每 tick 4 次 / 305=10(:3696)→11 次,本仓 extraUpdates 子步循环内调用。
  //  阻尼不适用：tileCollide=false（:3892/:3973）→ HandleMovement :17721 湿支不进。
  //  杀拍口径（Arrow.ts ⑥配方逐位核）：①命中消亡（:28952 Kill,命中分支内无 return
  //  ——当拍余段速度混合/尾迹尘照跑,湿段在其后=杀拍照跑,单调用点覆盖）;
  //  ②寿命杀（★BJ746 A24 改口径）——timeLeft-- 在子步尾（:17307,湿段/位移后）
  //  ⇒ 杀拍湿段随该子步 wetStep 自然已跑（旧头杀位「补跑」机器退役）。
  //  IsDestroyedByWater 域不含 298/305（{85,15,188,34,1097,1106}）→ hooks 不接。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐【子步】−1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价;共享体首调自做） */
  presetDone = false;

  constructor(projType: 298 | 305, x: number, y: number, heal: number,
    target: { x: number; y: number; w: number; h: number; hp: number; maxHp: number }) {
    super();
    this.projType = projType;
    // ★BJ746 A25（issue#35）：NewProjectile :10878-79 `position = (X,Y) − size/2`
    // ——入参 (x,y)=出生【中心】（调用侧传命中敌心）,6×6 盒左上=中心−(3,3)。
    // 旧直收当左上 ⇒ 中心偏右下 3px（issue：传 (100,100) 网页左上 100/100,
    //  原 97/97）。305 同修（同 NewProjectile 通道）。
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.heal = heal;
    this.target = target;
    this.extraUpdates = projType === 305 ? 10 : 3;   // :3696 / :3614
  }

  /** 原版本体不可见：SetDefaults alpha=255（:3613/:3695）且 GetAlpha 对 298/305 无
   *  特判 ⇒ 缺省尾 Color(0,0,0,0) 全透明；盘上 Projectile_298/305.png 均为 1×1 占位
   *  stub。可见观感完全由 AI_052 尘拖尾承载（AI_052 :28960-29003）——平涂扫描批
   *  （2026-08-31）已把旧「尘 183/175 配色近似」fillStyle 圆点退役，改逐粒精确化。
   *  本方法保留为文档化空实现，禁止回填平涂圆点。 */
  draw(_r: Renderer, _cam: Camera): void {
    void _r;
    void _cam;
  }

  /** ★通用湿段单点（:16895-17113,共享体;调用位=杀拍①②两处,见字段块头注）。
   *  mock hooks 可缺 world（a-batch1 治疗弹桩同 player 缺面口径）——无世界=无液态
   *  采样域,湿段跳过（生产恒有 world,非行为旁路）。 */
  private wetStep(game: GameHooks): void {
    const st = (game as Partial<GameHooks>).world?.store;
    if (!st) return;
    projectileWetSection(this, game, st, this.x, this.y, this.w, this.h,
      this.projType, !!projectileData(this.projType)?.ignoreWater);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // 原版 extraUpdates：每 tick AI+位移共 extraUpdates+1 次；消亡后 active=false
    // ⇒ 残余子步 AI 不再进（Projectile.Update :16878-16881）——当拍子步走完后止
    // ★BJ746 A24：timeLeft-- 移入子步尾（:17307 位=AI/湿段/位移之后）——杀拍
    //  湿段随本子步 wetStep 自然已跑（旧头杀位「补跑」机器随刀退役,口径②注作废）。
    for (let u = 0; u <= this.extraUpdates && !this.dead; u++) {
      const vcx = this.x + this.w / 2, vcy = this.y + this.h / 2;
      const dx = this.target.x + this.target.w / 2 - vcx;
      const dy = this.target.y + this.target.h / 2 - vcy;
      const dist = Math.hypot(dx, dy);
      // 命中门（:27122-27128 / 1457 :28938）：dist<50 且盒相交 → 结算+消亡。
      // ★原版命中分支内【无 return】（1457 :28952-28986）：Kill 只停后续子步的
      // AI（Projectile.Update :16878-16881 if(active) 门），当拍余段——速度混合与
      // 整批尾迹尘——照常执行，故此处不提前退出。
      if (dist < 50 && this.x < this.target.x + this.target.w && this.x + this.w > this.target.x
        && this.y < this.target.y + this.target.h && this.y + this.h > this.target.y) {
        // 结算门（1458 :28941 = 1457 :28940 = 1456 :27124）：owner==Main.myPlayer
        // ∧ !moonLeech。月噬(145)在身时不回复也不飘字；★Kill 在此【门外】——
        // 弹照常消亡、尾迹尘照常出（1456 :27136 / 1457 :28952 / 1458 :28953 三基线
        // 一致）。单人 owner 恒本地玩家（头注），仅余本地 buff 一项；生成端主门
        // 在 Game.applyLifeSteal（月噬全禁发射），此为弹已在中飞时 debuff 上身的兜底。
        const pl = (game as Partial<GameHooks>).player;   // mock hooks 可缺 player
        if (!pl?.buffs?.moonLeech) {
          const n = Math.floor(this.heal);             // (int)ai[1] :27130 / :28942
          this.target.hp = Math.min(this.target.maxHp, this.target.hp + n);
          if (n > 0) game.addDamageNumber(this.target.x + this.target.w / 2, this.target.y, n, false, '#40E080');
          // ★BJ755-A T2（bj746a D4 清偿,2026-11-02）：msg66 HealPlayer 上报——
          //  原版同位（Projectile.cs:28943-28950）：结算门内 SendData(66,..,目标槽,
          //  (int)ai[1]),目标=本地玩家或远端代理【双臂同发】（服务器侧 statLife+=
          //  钳 max2 后中继:远端目标经中继收款,自身治疗保服务器权威 hp 账与
          //  msg16 广播一致——旧债病灶=只写本地代理 hp,下一次 msg16 覆盖回退）。
          //  n>0 负控（vanilla ai[1] 构造恒正;reader :3034 同门）;钩子单机恒
          //  null 零开销（entitySyncHooks 注入模式）;mock hooks 缺 net 注入=跳过。
          if (n > 0) entityNet.reportHeal?.(this.target, n);
        }
        this.dead = true;                              // Kill() :28952 无条件
      }
      // 速度 4 归一方向 + (v×15+dir)/16 插值趋近（:27138-27145）
      const nx = dx / dist * 4, ny = dy / dist * 4;
      this.vx = (this.vx * 15 + nx) / 16;
      this.vy = (this.vy * 15 + ny) / 16;
      // ---- AI_052 尾段尘拖尾（原式 1457 :28959-28986；每【子步】一批）----
      // 305：d183 ×3、scale1.1、后移距 v×0.334×i；298（else 支）：d175 ×5、
      // scale1.3、v×0.2×i。公共态 noGravity=true(第 11 参=NewDust 后置等价位)、
      // velocity*=0（清 NewDust 抖动）、α 参数 100、盒=弹盒 6×6。
      // 同位序=AI 内出尘,先于本子步位移 ----
      if (this.projType === 305) {
        for (let i = 0; i < 3; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h,
            183, 0, 0, 100, null, 1.1, true);
          if (!d) continue;
          d.vx = 0; d.vy = 0;                        // dust.velocity *= 0f（:28968）
          d.x -= this.vx * 0.334 * i;                // :28969 position.X -= num397
          d.y -= -(this.vy * 0.334) * i;             // :28970 position.Y -= num398
        }
      } else {
        for (let i = 0; i < 5; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h,
            175, 0, 0, 100, null, 1.3, true);
          if (!d) continue;
          d.vx = 0; d.vy = 0;                        // :28982
          d.x -= this.vx * 0.2 * i;                  // :28983
          d.y -= -(this.vy * 0.2) * i;               // :28984
        }
      }
      // ---- ★通用湿段（:16895-17113,共享体;每【子步】一次 :16781 子步循环内）----
      //  位序 = AI(速度混合/尾迹尘)后 → 湿段 → 位移 = 原版 Update 子步同序;
      //  消亡拍（命中 dead=true 分支无 return）湿段照跑 = 杀拍口径①（见字段块头注）。
      //  tileCollide=false → 阻尼不适用,位移行保持全速。
      this.wetStep(game);
      this.x += this.vx;   // tileCollide=false——穿墙不检碰撞（:3615/:3696）
      this.y += this.vy;
      // ★BJ746 A24：timeLeft--（:17307 子步循环内,位移后）→ 3600 子步自然亡
      if (--this.life <= 0) { this.dead = true; return; }
    }
  }
}
