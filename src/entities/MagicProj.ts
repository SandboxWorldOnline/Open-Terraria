// 魔法投射物(直飞发光弹兜底实体;G9 贴图化):
// 行为 = 直线飞行、撞块消失、命中伤害、寿命短(spark 30tick 语义)。
// 渲染 = projId 有效时走原版 Projectile_N.png 贴图(Main.DrawProj 通用分支
//   Main.cs:32360-32371:中心锚 + proj.rotation + proj.scale),复用 Arrow.ts
//   导出的 projSprite/projFrameImg/projFrameCount(竖向多帧行切片)与
//   PROJ_ROT_RIGHT 旋转模式表;projId 缺省(0)或表未就绪 → 圆点兜底。
// ★可控导弹族(aiStyle 9/20/28,16/34/79 等)已分流 MissileProj(MagicMissileProj),
//   其 Main.cs:32420-32442 的 lerp 缩放/拖尾专属分支【不在此实现】——本类只做
//   通用贴图绘制,勿把那族特例搬进来。
import { Entity } from './Entity';
import { ghostHurtOnHit, playerHasGhostHurt, spectreVictimEligible, vanillaFlag10LifeMaxOk } from './SpectreSoulProj';
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424 星云套装 on-hit 单源
import { hitCritters, hitTownNpcs, noteVanillaProjImmune, playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { projSprite, projFrameImg, projFrameCount, PROJ_ROT_RIGHT } from './Arrow';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { cutTilesBox } from './ProjCutTiles';   // ★BJ285 死亡段割面（BJ260 同款前置习语）
import { TILE } from '../core/constants';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';

export class MagicProj extends Entity {
  /** GetWeaponCrit 合并值（Game 注入；缺省 4% 基础） */
  critChance = 0.04;
  w = 6; h = 6;
  vx: number;
  vy: number;
  damage: number;
  life: number;
  dead = false;
  color: string;
  grav = 0;
  /** 原版弹型 id（= item.shoot）：贴图/帧数/旋转模式/绘制 scale 的数据源。
   *  0 = 未指定 → 圆点兜底（联机 kind 4 重建路径与旧 spawn 调用兼容）。
   *  ★联机分类陷阱：netSnapProj（Game.ts:836-857）的分支序是
   *    `p instanceof Arrow` → `instanceof Dart` → `p.projId !== undefined`（:849）
   *    → `instanceof TrapShot` → `p.color !== undefined`（:857）。
   *  本字段一旦赋值，MagicProj 会被 :849 抢先分类成 kind 1（WeaponProj 族），
   *  访客端重建 new Boomerang(...)——sprite 与朝向全错。主会话接线 spawn 点传
   *  projId 时【必须同步】在 :849 之前加 `else if (p instanceof MagicProj)`
   *  分支（kind 4，tag 载 projId 或颜色），见报告单点清单。 */
  projId = 0;
  /** SetDefaults scale（vanilla-projectiles.json scale 列；绘制尺寸 = 贴图原生 × scale，
   *  与判定盒 w/h 解耦——同 Arrow.drawScale 注释） */
  drawScale = 1;
  /** 出生态 tick（多帧行帧推进用；联机傀儡不推进 = 帧冻结，同 Arrow.age 语义） */
  private age = 0;

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-04 溅花缺口
  //  清偿批,MagicProj 接入。四旗/wetCount/presetDone 形状=ProjWetFlags 共享体）----
  //  本类服务 id 全集：现役 = {0}（兜底圆点;唯一活构造点 Game.ts:3485 net kind4
  //  重建,projId 走缺省 0——旧 heldDef.magic 直射支 :14342 已成"扣蓝无弹"空壳不再
  //  出生本类）;构造器第 8 参可携任意 magic id（未来接线自动生效）。豁免 =
  //  PROJ_IGNORE_WATER 逐 id 自动分流（projectileData 缺行=不豁免=原版缺省 false）。
  //  魔法多族逐 id 抽验（SetDefaults P.cs:699-10676）：
  //    · 27 水涛【不】豁免（P.cs:1097-1107 无 ignoreWater 行）→ 入水溅花+湿阻尼
  //    · 150/151/152 豁免（P.cs:2398-2409 ignoreWater=true）
  //    · 0 兜底 id：vanilla 无 type 0 出生面,按非豁免通段处理（与"缺行=不豁免"
  //      口径同向）
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍同位同液态首测） */
  presetDone = false;

  /** 第 8 参 projId 为可选尾参（缺省 0=圆点）：既有调用点
   *  Game.ts:1024（联机 kind 4 重建）/ :5992（旧 heldDef.magic 直射）零改动兼容。
   *  主会话接线时在 :5992 尾部补 `itemCombat(heldDef.vid ?? -1)?.shoot ?? 0`。 */
  constructor(x: number, y: number, vx: number, vy: number, damage: number, life: number, color: string, projId = 0) {
    super();
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.life = life;
    this.color = color;
    this.projId = Math.max(0, Math.trunc(projId || 0));
    if (this.projId > 0) {
      const pd = projectileData(this.projId);
      // 判定盒/绘制 scale 按弹型取 SetDefaults（同 Arrow.ts 构造器：width/height/scale）
      if (pd?.width) this.w = pd.width;
      if (pd?.height) this.h = pd.height;
      this.drawScale = pd?.scale ?? 1;
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    // 世界坐标绘制(Renderer 实体循环运行在世界变换内,勿再自算屏幕坐标)
    const ctx = r.ctx;
    if (!ctx) return;
    if (this.projId > 0 && this.drawProjTexture(ctx)) return;
    // 兜底圆点(projId 未指定 或 贴图未就绪)
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x + this.w / 2, this.y + this.h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 贴图绘制（Main.DrawProj 通用分支 Main.cs:32360-32371 1:1）：
   *  位置 = Center、origin = 帧中心、rotation = proj.rotation、scale = proj.scale。
   *  rotation 取值同 Arrow.draw（PROJ_ROT_RIGHT 注释：朝右族 atan2(vy,vx) +
   *  向左运动水平镜像；默认朝上族 atan2+π/2，AI_001 尾部 Projectile.cs:54877）。
   *  多帧行切片：帧号按 age/5 档推进（Arrow 同款近似；原版逐型 frameCounter 在
   *  AI 内推进，Projectile.cs:20963 起散布，兜底实体不做逐型直译）。
   *  @returns false = 贴图未就绪，调用方走圆点兜底 */
  private drawProjTexture(ctx: CanvasRenderingContext2D): boolean {
    const frames = projFrameCount(this.projId);
    const sliced = frames > 1 ? projFrameImg(this.projId, Math.floor(this.age / 5) % frames) : null;
    const img = sliced ?? projSprite(this.projId);
    if (!img) return false;
    // 就绪判定同 Arrow.draw：HTMLImageElement 未 complete / 零宽 = 未就绪
    const asImg = img as HTMLImageElement;
    if ((asImg.width > 0) === false) return false;
    const iw = (img as HTMLCanvasElement).width || asImg.width;
    const ih = (img as HTMLCanvasElement).height || asImg.height;
    if (!iw || !ih) return false;
    const ang = Math.atan2(this.vy, this.vx);
    const rightArt = PROJ_ROT_RIGHT.has(this.projId);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(this.cx, this.cy);
    if (rightArt && this.vx < 0) {
      // 先镜像再旋转（Arrow.draw 同式：R(π−ang)∘M ≡ 原版 spriteDirection 翻转）
      ctx.scale(-1, 1);
      ctx.rotate(Math.PI - ang);
    } else {
      ctx.rotate(rightArt ? ang : ang + Math.PI / 2);
    }
    const s = this.drawScale;
    ctx.drawImage(img as CanvasImageSource, -iw * s / 2, -ih * s / 2, iw * s, ih * s);
    ctx.restore();
    return true;
  }

  /** ★通用湿段（:16903-17113——projWetSection.ts 共享体 1:1;段内特支/位序注见
   *  共享体文件头与本类字段块头。溅花尘/音由共享体调 wetSplashStepShared,不自写） */
  private wetSection(game: GameHooks): void {
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    // 联机傀儡（远端弹幕快照驱动）：纯位移外推，不跑命中/碰撞（伤害归拥有者客户端结算）
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // ★通用湿段（:16903-17113,2026-09-04 溅花缺口清偿批）——原版 Update 位序
    //   AI(:16880) → 湿段(:16903) → HandleMovement(:17120)。本类 AI 退化=寿命/帧计
    //   （无湿旗消费者）→ 段插寿命判后/位移前 = 原版同序;湿段测位 = 上拍位移末位
    //   （原版"AI 后未移动位"同构）。寿命判在头的既有类近似保持不动 → 末拍无位移
    //   亦无溅花（末拍位不变,溅花无从跃迁——既有位移面近似的一部分,登记不扩）。
    this.wetSection(game);
    if (--this.life <= 0) { this.dead = true; return; }
    this.age++;
    // 水中位移阻尼（HandleMovement :17721-17764 + UpdatePosition :20557-20562
    //   `if (wet) position += wetVelocity`）——直积分宿主：速度场不减只削当拍位移
    //   （wetVelocity = velocity×档,velocity 字段本身不被水阻改写）;干态档=1 数值恒等
    const drag = projWaterDragFactor(this);
    this.x += this.vx * drag;
    this.y += this.vy * drag;
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    const ty = Math.floor((this.y + this.h / 2) / TILE);
    if (game.world.store.isSolid(tx, ty)) { this.dead = true; return; }
    // 小动物:一击致死并消耗弹体(近战挥砍同语义)
    // ★BJ285（BJ232 死亡段割面族,2026-09-22）：CutTiles（P.cs:12517）先于 Damage_PVE
    //  （:12523）——本类命中即亡（:226 penetrate 缺省 1 语义）死亡拍【照割】;中央割
    //  !e.dead 门=死亡拍整缺 → BJ260 前置习语。现役活构造点仅联机 kind4 重建
    //  （Game.ts:4176,projId 缺省 0=傀儡不结算）——本刀为未来接线预置,vid 缺省 0
    //  在 Game.cutTile 收口内按格型筛,零行为风险。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    if (hitCritters(this, game)) { this.dead = true; return; }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean; dead: boolean; def?: { hitSound?: string[] } };
      if (e.dead) continue;
      if (this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y) {
        // ★BJ494（2026-10-04）定谳 C=死面（判据三锚,勿收编勿摘除）：①本类现役唯一活构造
        //  点=net kind4 傀儡重建（Game.netMakeProj case4→netProjPuppets,netPuppet=true）
        //  → fixedUpdate :147 netPuppet 早退,本命中环生产拓扑不可达;②projId 缺省 0=vanilla
        //  无 type 0 出生面（projectileData(0) 缺行）→ rollVanillaHitCrit kind=null 捷径零掷,
        //  即便未来接活线也零 RNG;③phantom 登记 hurt 第 6 参硬编码 false（crit 只折伤害
        //  倍率不进 crit 旗=暴击飘字/:14876 face 双缺）——死面内不动刀,接活线时按
        //  rollVanillaHitCrit+TimerCrit 口径整体收编（BJ494 报告登记）。静态掷=旧 GetWeaponCrit
        //  合并值注入时代的残留（P:52512 注=历史锚）,生产无读者。
        const crit = Math.random() < this.critChance; // 暴击链（P:52512——曾恒 false）
        // ★S02(BJ723-B) 死面豁免注：BJ494 定谳本命中环生产不可达（net 傀儡早退/
        //  projId=0 零掷），crit 预倍形按死面不动刀保留（hurt 传 false 字面=行为零变）；
        //  接活线时随 BJ494 登记口径整体收编（rollVanillaHitCrit+TimerCrit+去预倍）。
        // 法力斗篷星雨(魔法武器命中触发,Projectile.cs:13892-13914):manaCloak 装备
        // + 冷却 300t → 法力星 723(ai2=1)落地掉 4143 法力斗篷之星
        (game as unknown as { tryManaCloakStarOnMagicHit?: (x: number, y: number) => void })
          .tryManaCloakStarOnMagicHit?.(e.x, e.y);
        // ★焰爆石/拍击石弹幕双支位（Projectile.cs:13439-13446；F3/F1 收编升级
        // 2026-08-31 蓝队四轮）：本类现役弹型均 magic 数据面（resolveProjClass 单源）
        // → 原版同样不触发，接线为站位补齐（类门自带 melee|ranged/ranged 过滤，
        // 未来分流时自动生效）。返回 num14 加伤随暴击并入实伤参。
        const snapBonusMagic = projectileSnapStrikeBonus(game, this, e.x + e.w / 2, e.y + e.h / 2,
          (e as unknown as { id?: number }).id ?? -1,
          { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 } });
        e.hurt(applyBannerDamageDealt(game, e, crit ? this.damage * 2 : this.damage)
          + (snapBonusMagic ? Math.trunc(snapBonusMagic * (crit ? 2 : 1)) : 0),
          Math.sign(this.vx) * 2, 0, game, 0, false, 0, true);   // 音/飘值=单点
        // ★GC1 写方桥（Projectile.Damage :14031-14183 命中尾梯,StrikeNPC 后原位）：
        // 本类承载一碰即碎魔法弹（穿透数缺省 1）——无三旗 face 时末档
        // `penetrate != 1 || applies` 判定为假 ⇒ 无写（:14180-14183 单发 flag3 族既绕
        // :12636 免疫门也不回写窗口）。蓝队二轮 F5 起 bridge 自动读
        // data/vanillaProjImmuneFaces.ts 三旗补表：带 usesLocal/idStatic 面的弹 id
        // （如 gem-staff bolts 121-126/597 usesLocal cd60）在此处自动落「写 0 清窗」
        // 档,调用点无需硬编码。
        noteVanillaProjImmune(game, this.projId, (e as unknown as { id?: number }).id ?? -1);
        // ★BJ157-①（2026-09-18）幽灵治疗头 ghostHeal proc 补缺（Projectile.cs:13875-84：
        //  canGhostHeal|flag9 块内 ghostHeal 在先(:13877-79)、ghostHurt 在后(:13881-83)，
        //  本仓此前只接 ghostHurt）。调用点门 player.ghostHeal && !moonLeech 由
        //  Game.applyLifeSteal 单源自证（298 治疗弹经 HealProj 飞向本地玩家）;victim 门
        //  = spectreVictimEligible（canGhostHeal=false 族 384/387/388/523,NPC.cs:6270
        //  缺省 true）。dmg = num41 等位（Enemy.lastStrikeDealt,防后实扣;≤0 门在
        //  applyLifeSteal 内 floor 后拒）;numHits 实参 0 = 单发弹首跳（:14263 numHits++
        //  在 proc 块后 ⇒ 首跳读 0,率 0.20）;出生点 = 受害者 Center（vanilla Vector2 实参）
        // ★批⑥（2026-08-31）幽灵伤害头 ghostHurt（Projectile.cs:13881 / :12021,
        // SpectreSoulProj.ts 承载）：magic 弹 + Spectre Mask 套装 → 受害者 Center
        // 放浮魂弹 356。dealt 读 Enemy.lastStrikeDealt（ StrikeNPC num41 等价位）
        {
          const v156 = ent as unknown as { vanillaId?: number | null; lastStrikeDealt?: number;
            maxHp?: number; def?: { lifeMax?: number } };
          if (this.projId > 0 && projectileData(this.projId)?.magic) {
            // ★BJ385 flag10 lifeMax>5 段补门（:13712）——BJ157-① 老站缺段（critter
            // lifeMax≤5 一击致死族原版不 proc）,门单源 vanillaFlag10LifeMaxOk
            if (vanillaFlag10LifeMaxOk(v156) && spectreVictimEligible(v156.vanillaId)) {
              game.applyLifeSteal?.('ghost', v156.lastStrikeDealt ?? 0, 0,
                e.x + e.w / 2, e.y + e.h / 2, true);
            }
            if (playerHasGhostHurt(game.player)) {
              ghostHurtOnHit(game,
                { magic: true, projDamage: this.damage,
                  projX: this.x, projY: this.y, projW: this.w, projH: this.h,
                  ownerCx: game.player.cx, ownerCy: game.player.cy },
                { x: e.x, y: e.y, w: e.w, h: e.h,
                  cx: e.x + e.w / 2, cy: e.y + e.h / 2,
                  vanillaId: v156.vanillaId,
                  lifeMax: v156.maxHp ?? v156.def?.lifeMax,
                  dealt: v156.lastStrikeDealt ?? 0 });   // 本拍结算面（蓝队 F2② 修订）
            }
            // ★BJ424 星云套装 proc（:13885-13891,ghostHurt 同块同门面）——触发单源
            nebulaBoosterOnHit(game,
              { projId: this.projId, projDirX: this.vx },
              { x: e.x, y: e.y, w: e.w, h: e.h,
                cx: e.x + e.w / 2, cy: e.y + e.h / 2,
                vanillaId: v156.vanillaId,
                lifeMax: v156.maxHp ?? v156.def?.lifeMax,
                dealt: v156.lastStrikeDealt ?? 0 });
          }
        }
        this.dead = true;
        return;
      }
    }
    // 城镇 NPC 受击(原版 friendly 弹对 NPC 同效;一碰即碎同敌怪)——窄门 =
    // 巫毒(22/54) ∪ 臭鸡蛋 318（Damage_PVE_Inner :11970-11972，projId 传入）
    if (hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2, 'playerProj', this.projId)) { this.dead = true; return; }
  }
}
