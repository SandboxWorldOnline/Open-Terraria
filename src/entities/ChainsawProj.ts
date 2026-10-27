// 链锯/钻头/插孔锤族持械弹（AI_020 :23837-23942 共用段，Projectile.cs）：
//   509 屠夫链锯 3098（22×22 scale1.2 :5516-5521，2 帧 2t/帧 :23853-23865）
//   252 叶绿插孔锤 1262（18×18 scale1.1 :3083-3089，4 帧 4t/帧 :23840-23852）
// channel 持械——挂玩家手（position = RotatedRelativePoint(MountedCenter) − size/2
// :23879/:23921-23922）、velocity = 瞄准向归一×(shootSpeed×scale)（每帧直写
// :23884-23902）、松链即 Kill（:23904-23907）；音效按持械物品 pick 分档
// （:23866-23878：>0 → Item190 每 15t，否则 Item189 每 20t）；rotation =
// atan2(vy,vx)+1.5700000524（:25889,1.57f≈π/2——★SW-FX4 勘误:旧注 :23923 系 1456 锚
// 残留,且旧 draw 曾把该 π/2 重复加了两次,见 draw 支注）；尘 31 火花（1/6、出生 = position+velocity×
// Next(6,10)×0.1 前向偏移、X−4、noGravity、vy = −Next(7,13)×0.15 向上反溅
// :23933-23941）；velocity.X 抖动 ×(1+Next(−3,4)×0.01)（:23932）。
// 命中 = 弹盒（SetDefaults 宽高）持续判定 + 同敌 10t 免疫（509
// usesIDStaticNPCImmunity+idStaticNPCHitCooldown 10 :5523-5524；252 走
// ownerHitCheck+immune[owner] 默认档 DefaultToDrillOrChainsaw :10148-10159——
// 同 10t 口径，1.4.5.6 ai20 无 -1 特判）。
// ★挖块交互登记：原版 aiStyle20 弹体本身不挖块——挖掘由持械物品经
// ItemCheck_UseMiningTools（:44967，channel 期 toolTime 按 useTime 循环
// :42891-42899 照常结算）并行完成，弹体只承载接触伤害。本仓同构承接：Game
// 工具分支 tryMine 并行挖掘（1262 tool.useTime=7 节奏 / 3098 axe30 经
// itemFuncTool 桥接），弹体侧无 CutTiles/KillTile 逻辑（原版同构，非债）。
// ★BJ431 登记债（2026-10-01）：509 屠夫链锯命中喷溅弹未接线——Damage_PVE_Inner
// type==509 支（Projectile.cs:13219-13231）每次命中敌怪掷 2..5 枚 504 Spark
// （伤=damage×0.5 (int)、kb×0.2、方向=随机圆盘 ±100 + 弹速×3 归一 ×rand(35,81)×0.1）。
// 本仓命中管线未挂该喷溅 → 504 在本仓暂无出生面（dormant）。504 弹体行为侧
// （AI 共支尘尾/恒隐/60t 计寿/命中快进）已随 BJ431 火花族支在 Arrow.ts 落位,
// 接线发射面时无需再动弹体侧。
// ★通用湿段接入（2026-09-06 溅花缺口杂项批）：509 屠夫链锯（SetDefaults :5790-5797）
// 与 252 叶绿插孔锤（:3354-3359）走 DefaultToDrillOrChainsaw()（:10734-10744：
// aiStyle20/friendly/penetrate −1/tileCollide=false/ownerHitCheck…）【无 ignoreWater
// 行】→ 受段;445 激光钻（:5165-5177）ignoreWater=true@:5175 → 豁免（共享体整段门
// 直跳）。★阻尼 N/A 定谳：AI_020 每帧直写 position=RotatedRelativePoint(MountedCenter)
// − size/2（:23879/:23921-23922）= 无 UpdatePosition 位移行;且 tileCollide=false
// ⇒ wetVelocity 恒=velocity（:16870,阻尼算式仅在 HandleMovement tileCollide 支）。
// AI_020/AI_075 无 wet 消费（:23837-23950/:67168-67330 grep 实证）→ 溅花+旗维护即
// 全部效果。断链 Kill 拍（AI_020 :25870-25873）原版湿段仍跑一子步——2026-09-06
// ⑥杀拍口径批已照配方清偿（杀位补跑湿段+挂点重钉,见 fixedUpdate 杀支注）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import { projSprite, projFrameCount } from './Arrow';
import { playerCanHitEnemy, applyBannerDamageDealt } from './projTargets';
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { damageVar } from '../stats/ScaleStats';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { rollVanillaHitCrit } from './proj1457';   // ★BJ494 掷率单源（:12915-12927 owner 装配）

/** 玩家侧挂点状态（RotatedRelativePoint 消费，Player.cs:4063-4089）：
 *  cx/cy = MountedCenter（:3189-3194；本仓不建模坐骑挂点偏移，恒等玩家中心）；
 *  h = 盒高（Bottom 推算用）；gfxOffY = 视觉纵向补偿（挂绳，Player.gfxOffY 已建模）；
 *  fullRotation 本仓不建模（重力旋转族未接，缺省 0 → 旋转项恒等，
 *  RotatedRelativePoint 退化为 MountedCenter+gfxOffY 竖移——与原版常规态一致） */
export interface SawOwner {
  cx: number; cy: number; facing: number; dead: boolean;
  h?: number; gfxOffY?: number; fullRotation?: number;
}

/** RotatedRelativePoint(MountedCenter)（P.cs:23879 调用 → Player.cs:4063-4089）：
 *  绕 Bottom+(0,gfxOffY) 旋 fullRotation，再叠加坐骑挂点竖移 vector2 =
 *  (0,−num2)+(0,num2).RotatedBy(num)，num2 = mount.PlayerOffset/2+4（本仓无坐骑
 *  建模 → PlayerOffset 0 → num2 = 4）。addGfxOffY 缺省 true → pos.Y 先 += gfxOffY */
export function rotatedRelativePoint(o: SawOwner): { x: number; y: number } {
  const rot = o.fullRotation ?? 0;
  const gfx = o.gfxOffY ?? 0;
  const num2 = 4;                                   // mount.PlayerOffset(0)/2 + 4
  const bx = o.cx, by = o.cy + (o.h ?? 42) / 2 + gfx;   // vector = Bottom + (0,gfxOffY)
  const px = o.cx, py = o.cy + gfx;                 // pos.Y += gfxOffY（addGfxOffY）
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const dx = px - bx, dy = py - by;
  const v2x = -sn * num2, v2y = num2 * cs - num2;   // (0,−num2)+(0,num2).RotatedBy(rot)
  return { x: bx + dx * cs - dy * sn + v2x, y: by + dx * sn + dy * cs + v2y };
}

export interface ChainsawOpts {
  /** 弹型（509 链锯 / 252 插孔锤；其余 aiStyle20 族同段共用） */
  projId: number;
  /** 持械物品镐力（音效分档 :23868——原版读 inventory[selectedItem].pick） */
  pick?: number;
  /** 持械物品 shootSpeed（:23884；509=48 / 252=46，Item.cs SetDefaults） */
  shootSpeed?: number;
  /** ai75 激光钻变体（projId=445，Item 2798）：音 Item132/23t+相位灯串，无 pick 分档
   *  （AI_075 :67285-67292；挂手/命中面与 AI_020 同构 :68404-68411） */
  laser?: boolean;
}

export class ChainsawProj extends Entity {
  /** SetDefaults 宽高（509 :5516-5521 / 252 :3083-3089）——构造按 projId 定 */
  w: number;
  h: number;
  readonly projId: number;
  damage: number;
  knockback: number;
  critChance = 0.04;
  armorPen = 0;
  private frame = 0;
  private frameCtr = 0;
  private sndT = 0;
  private hitCd = new Map<number, number>();
  private owner: SawOwner;
  /** 音效分档阈值数据：持械物品 pick（:23868） */
  private pick: number;
  /** 出膛速度模 = shootSpeed×scale（:23884；509 48×1.2 / 252 46×1.1） */
  private speed: number;
  channelCb: () => boolean;
  aimCb: () => { x: number; y: number };
  dead = false;
  // ---- ★通用湿段旗（ProjWetFlags 同形;projectileWetSection 共享体逐值维护）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐子步折减） */
  wetCount = 0;
  /** 出生预置已做（NewProjectile :10886-10892 等价;共享体首调自做） */
  presetDone = false;
  /** 绘制 scale（SetDefaults：509=1.2 :5522 / 252=1.1 :3088） */
  private drawScale: number;
  /** ai75 激光钻分支标记（Game.ts 调用点按 projectileData(shoot).aiStyle===75 置位） */
  private readonly laser: boolean;
  private phaseT = 0;
  /** 实体自报点光（AI_075 :67300-67320：localAI[0] 60t 相位,青(0,1,.7)→蓝(0,.7,1) lerp×0.5；
   *  Game 光照循环 projectiles 桶消费——BookProj 同通道先例）。PlotTileLine 光带
   *  （玩家→弹体线段播光 :67308-67313）未建模,以弹心点光近似（登记 blue-r33 §③） */
  lightRGB: [number, number, number] | null = null;
  lightRGBAt: { x: number; y: number } | null = null;

  constructor(owner: SawOwner, damage: number, knockback: number,
    channelCb: () => boolean, aimCb: () => { x: number; y: number },
    opts?: Partial<ChainsawOpts>) {
    super();
    this.owner = owner;
    this.damage = damage;
    this.knockback = knockback;
    this.channelCb = channelCb;
    this.aimCb = aimCb;
    const pid = opts?.projId ?? 509;
    this.projId = pid;
    this.pick = opts?.pick ?? 0;
    this.laser = opts?.laser ?? false;
    // ★判定盒吃 proj.scale（r33-②）：SetDefaults 尾 `width = (int)(width * scale)`（1458
    // Projectile.cs:10673-10674，全弹体公共尾）——509=22×1.2→26、252=18×1.1→19；月主竖长盒
    // 427:22×56 / 430·432·609:30×54 / 431·610:28×64 不缩。此前硬编码 252=18/其余=22 且
    // 不乘 scale：屠夫锯盒虚小 28%、金属钻类（59 等 22×0.9→19）反向虚大。
    // vanillaProjectiles.ts "scale 非判定盒宽"系误注——源码即乘，随批勘误登记（blue-r33）。
    const pd = projectileData(pid);
    // 弹表无 scale 键 = 原版 ResetDefaults 缺省 1（509=1.2/252=1.1 为显式值在册）
    const sc = pd?.scale ?? 1;
    this.drawScale = sc;
    this.w = Math.max(1, Math.trunc((pd?.width ?? 20) * sc));
    this.h = Math.max(1, Math.trunc((pd?.height ?? 20) * sc));
    // 出膛速度模 = shootSpeed×proj.scale（AI_020 :23852 num157=item.shootSpeed*scale；
    // 五档 0.9~1.2——proj59 类曾按 1.2 算 +33% 偏快）
    this.speed = (opts?.shootSpeed ?? (pid === 252 ? 46 : pid === 509 ? 48 : 40)) * sc;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.netPuppet) { this.netPuppetStep(); return; }
    // channel 门（AI_020 :25848-25873）：断链即 Kill
    if (!this.channelCb()) {
      // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版断链 Kill（AI_020 :25870-25873）
      //  【不从 AI 返回】——后续 :25887-25888 position 钉挂点照跑,Update 里湿段
      //  (:16895 `if (!ignoreWater)`)【无 active 门】照跑（AI(:16880 `if (active)`)
      //  内 Kill 只置 active=false;`!active` 门在 HandleMovement(:17120)后 :17132
      //  才生效、只拦 Damage/尾尘）→ 杀拍溅花/旗维护/wetCount 折减照走。本仓杀位
      //  早退曾整体跳过湿段（头注"登记有界偏差"随批清偿）。
      //  · 杀拍测位=钉挂点重算（rotatedRelativePoint 纯函数;本仓 player.fixedUpdate
      //    先于实体轮 Game.ts:7548/:8102 → owner cx/cy 已是本拍值,与原版杀拍
      //    :25887 同位）;尾位活拍调用点与本支同拍互斥（早退不达尾）→ 无需
      //    wetSectionRan 防双跑旗;段内水death/80 补 Kill 借 hooks 缺省不接
      //    （509/252/445 ∉ IsDestroyedByWater 六型、非 80）。
      //  · 445 激光钻 ignoreWater=true(:5175) → 段门恒闭,本调用零行为（与其杀拍
      //    尾段续跑差异面一致,死弹位不可观测）。
      const anchor = rotatedRelativePoint(this.owner);
      this.x = anchor.x - this.w / 2;
      this.y = anchor.y - this.h / 2;
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      this.dead = true;
      return;
    }
    // 帧动画（:25807-25829）：AI_020 仅 252（4 帧 4t/帧）与 509（2 帧 2t/帧）有帧推进，
    // 其余 aiStyle20 族无支=恒 frame0——扩族防多帧贴图误动（r33-④P2）
    const ft = this.projId === 252 ? 4 : this.projId === 509 ? 2 : 0;
    if (ft > 0 && ++this.frameCtr >= ft) { this.frameCtr = 0; this.frame = (this.frame + 1) % ft; }
    // 链锯音分档（:23866-23878）：ai75 激光钻走 Item132 每 23t（AI_075 :67285-67292，
    // 无 pick 分档）；ai20 持械物品 pick>0 → Item190 每 15t（钻族）；否则 Item189 每
    // 20t（链锯/插孔锤——509 axe30/pick0、252 hammer90/pick0 均此档）
    if (--this.sndT <= 0) {
      if (this.laser) {
        this.sndT = 23;
        game.playSfxFiles(['Item_132'], 1, this.cx, this.cy);
      } else if (this.pick > 0) {
        this.sndT = 15;
        game.playSfxFiles(['Item_190'], 1, this.cx, this.cy);
      } else {
        this.sndT = 20;
        game.playSfxFiles(['Item_189'], 1, this.cx, this.cy);
      }
    }
    // 挂手（:23879 vector18 = RotatedRelativePoint(MountedCenter)；:23921-23922
    // position = vector18 − size/2）——含持械旋转偏移/挂绳 gfxOffY
    const anchor = rotatedRelativePoint(this.owner);
    // 瞄准直写（:23884-23902）：vel = (鼠标世界位 − anchor) 归一 ×(shootSpeed×scale)
    const aim = this.aimCb();
    const avx = aim.x - anchor.x, avy = aim.y - anchor.y;
    const al = Math.hypot(avx, avy) || 1;
    this.vx = avx / al * this.speed;
    this.vy = avy / al * this.speed;
    // 面向（:23909-23916）：velocity.X 符号 ChangeDir
    if (this.vx > 0) this.owner.facing = 1;
    else if (this.vx < 0) this.owner.facing = -1;
    this.x = anchor.x - this.w / 2;
    this.y = anchor.y - this.h / 2;
    // velocity.X 抖动（:23932）：×(1+Next(−3,4)×0.01)——原版在旋转/尘之前，
    // 每帧被 channel 直写覆盖，实际只影响下方尘的前向偏移。
    // ★ai75 无此段（AI_075 共用尾 :68404-68411 前无抖动行）——laser 分支跳过
    // ★SW-RB11b F3：Next(−3,4)∈[−3,3] 七值（Projectile.cs:23932）——旧 *8 产 [−3,4]
    //  八值,+4 端 1.04 超原版上限 1.03
    if (!this.laser) this.vx *= 1 + (Math.floor(Math.random() * 7) - 3) * 0.01;
    // ai75 相位灯串（:67300-67320）：localAI[0]++ ≥60 归零；num12=phase/60 三角折返
    // （>0.5 取 1−num12）；vector5=Lerp(青(0,1,.7),蓝(0,.7,1),1−num12×2)×0.5——
    // 弹心点光经 lightRGB 通道结算（PlotTileLine 线光带未建模，登记）
    if (this.laser) {
      this.phaseT = (this.phaseT + 1) % 60;
      let num12 = this.phaseT / 60;
      if (num12 > 0.5) num12 = 1 - num12;
      const t = 1 - num12 * 2;
      this.lightRGB = [0 * 0.5, (1 + (0.7 - 1) * t) * 0.5, (0.7 + (1 - 0.7) * t) * 0.5];
      this.lightRGBAt = { x: this.cx, y: this.cy };
    }
    // 尘 31 火花（:23933-23941）：1/6、出生 = position+velocity×Next(6,10)×0.1
    // （单掷同乘双轴 → 前向偏移 0.6-0.9）、position.X−4、noGravity、
    // velocity×0.2 后 vy = −Next(7,13)×0.15（向上反溅）
    if (!this.laser && Math.floor(Math.random() * 6) === 0) {   // ai75 无火花尘段
      const k = (6 + Math.floor(Math.random() * 4)) * 0.1;   // Next(6,10) ∈ [6,9]
      const dx = this.x + this.vx * k, dy = this.y + this.vy * k;
      const d = game.spawnDust?.(dx, dy, this.w, this.h, 31, 0, 0, 80, null, 1.4);
      if (d) {
        d.x -= 4;                                            // :23936
        d.noGravity = true;                                  // :23937
        d.vx *= 0.2;                                         // :23939
        d.vy = -(7 + Math.floor(Math.random() * 6)) * 0.15;  // :23940 −Next(7,13)×0.15
      } else {
        // 无尘池兜底：反弹速度只落 grav 参数（spawnParticles 无初速参）
        game.spawnParticles(dx + this.w / 2 - 4, dy + this.h / 2, '#D8B878', 1, 1.4,
          { life: 18, grav: -0.15 });
      }
    }
    // 命中（弹盒持续 + 10t 冷却）
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const e = ent as unknown as { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean; def?: { hitSound?: string[] } };
      if (e.dead || (this.hitCd.get(e.id) ?? 0) > 0) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      // ★BJ494（2026-10-04）掷率收编 rollVanillaHitCrit 单源（旧 `Math.random()<critChance`
      //  静态掷退役;Game.ts 出生位 `0.04+meleeCrit/100+词缀crt/100` 冻结载体随之摘除）：
      //  509/252 DefaultToDrillOrChainsaw（P.cs:10734-10744 melee=true 亲读）/445 激光钻
      //  （:5165-5177 melee=true）→ 三类掷 :12916 melee 臂达=owner.meleeCrit（:25712-14
      //  逐帧折入持械 item.crit+crt,命中拍动态）。ownedBySomeone=非 trap=true → TimerCrit
      //  :12928 无条件消费照达。critChance 字段保留=关断钉（≤0 掷门关死,dealContacts :482
      //  同族习语）。武僧 688-690 强制掷 :12929-43 形位=本族非 688 恒假,不设。
      const rollCrit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);
      const timerCrit = (game.player as unknown as
        { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
        | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false;
      const crit = rollCrit || timerCrit;
      // ★W02（BJ723-B 2026-10-26 幸运符号勘误）：玩家弹幕→NPC 面 luck 取【正】——
      // 原版 Damage_PVE_Inner :12970 `Main.DamageVar(num15, Main.player[owner].luck)`
      // （luck>0 重掷取大）。旧 `-(luck)` 系从敌弹打玩家族（Projectile.cs:14904
      // `0f - Main.player[owner].luck`/自伤 :15118 `0f - localPlayer.luck`——受端
      // 负幸运域）错族移植,链锯/钻头为玩家工具弹全走攻端 :12970 正向。幸运+1 旧
      // 掷低带（100→85）勘正为高带（→115）。PvP/自伤入口定谳：本类无 hitPlayer/
      // damagePlayer 面（drill/chainsaw=玩家专属工具弹,原版无受端路径）,零改动面。
      // ★S02：crit ×2 移 Enemy.hurt 防后（NPC.cs:82067）——DV 掷基伤、翻倍在后,
      // 与挥击侧 Game.ts 同序。
      const owner = game as unknown as { player?: { luck?: number } };
      const dmg = damageVar(this.damage, owner.player?.luck ?? 0);
      // ★F3 接线（蓝队四轮）：链锯/钻头持械弹（509 屠夫链锯/252 叶绿插孔锤，
      // 数据面 melee）→ 焰爆石/拍击石双支（Projectile.cs:13439-13446）；加伤随暴击并入
      const snapBonusSaw = projectileSnapStrikeBonus(game,
        { projId: this.projId }, e.x + e.w / 2, e.y + e.h / 2, e.id,
        { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 },
          targeterBox: { x: this.x, y: this.y, w: this.w, h: this.h } });
      e.hurt(applyBannerDamageDealt(game, e, dmg)
        + (snapBonusSaw ? snapBonusSaw : 0),
        Math.sign(this.vx) * this.knockback, 0, game, this.armorPen, crit, 0, true);   // 音/飘值=单点;★S02 crit ×2=Enemy.hurt 防后;fromPlayer=DPS 计
      this.hitCd.set(e.id, 10);
    }
    // ---- ★通用湿段（:16903-17113,共享体;溅花尘/音=wetSplashStepShared 弹面 10 粒）----
    // AI 尾采样（position 由本 tick AI 直写挂点位 = 原文湿段同位;445 豁免直跳,
    // 阻尼 N/A 见头注）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      this.projId, !!projectileData(this.projId)?.ignoreWater);
  }

  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const img = projSprite(this.projId);
    const ctx = r.ctx;
    if (!img || !(img.width > 0) || img.width === 0 || !ctx) return;
    // ★SW-FX4 帧切片改权威表（Main.projFrames；Main.cs:8620 projFrames[509]=2 /
    //  :8750 projFrames[252]=4,余 19 型无赋值恒 1——draw 支取数同 Arrow.projFrameCount）：
    //  原版通用 draw 源矩形 = (0, 帧高×frame, 图宽, 图高/projFrames)、origin=帧心
    //  （Main.cs:30625-30631 num161=Height()/projFrames + y11=num161×frame +
    //  rectangle4/origin8=Size()/2）。旧式 Math.round(图高/图宽) 对本族 21 型全错：
    //  竖长单帧条（57=14×54 等）被切成 3-4 份只画顶部 13-18px 小块、252(22×240)
    //  切成 11 份（应 4×60）、509(28×140) 切成 5 份（应 2×70）——持械钻/锯画成碎屑。
    const frames = projFrameCount(this.projId);
    const fh = img.height / frames;
    const idx = Math.min(frames - 1, this.frame % frames);
    // 姿态角（Projectile.cs:25889 AI_020 尾 `rotation = Atan2(velocity.Y, velocity.X)
    // + 1.5700000524f`）——单一 +π/2,贴图钻头朝上旋向瞄准向。旧式再 +1.57（=又转
    // π/2,合计 +π）把钻头转离瞄准向 180°,且 vx<0 时画布纵向翻转（原版无此臂——
    // DrawProjDirect 的 dir 翻转仅 ownerHitCheck && gravDir==-1 倒重力支 Main.cs:35447-35456,
    // 常规重力 dir=SpriteEffects.None）——两处均本仓自创,随 SW-FX4 勘误撤除。
    const rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;   // :25889（1.5700000524f 即 π/2）
    // ★BJ603 弹幕 glowMask（Main.cs DrawProjDirect 通用支 :35498-35518——427:2/
    //   428:3/429:7/430:8/609:180/610:179 六型,Projectile.cs:4990-5037）：源矩形=
    //   弹幕贴图全幅（projFrames 恒 1,Glow_N≡Projectile_N 同尺寸对拍）,dest=本体
    //   同框同变换;色 (250,250,250,alpha) 自发光 → itemGlowQueue 合成后冲刷。
    //   m 捕获 = translate 前（dest 取本体局部坐标 −dw/2/−dh/2）。
    const rGlow = r as unknown as {
      pushProjGlow?: (id: number, m: DOMMatrix, dx: number, dy: number, sw: number, sh: number, alpha: number) => void;
    };
    const mBefore = rGlow.pushProjGlow ? ctx.getTransform() : null;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(rot);
    ctx.imageSmoothingEnabled = false;
    const dw = img.width * this.drawScale, dh = fh * this.drawScale;
    ctx.drawImage(img, 0, idx * fh, img.width, fh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    if (mBefore && frames === 1) {
      rGlow.pushProjGlow?.(this.projId, mBefore, -dw / 2, -dh / 2, img.width, img.height, 0);
    }
  }
}
