// 星璇之音 Stellar Tune 演奏弹（弹 856 / 物品 4715）+ 无视线减伤乘区（2026-08-31 批④；
// 二轮蓝队批⑦修正 F1 触敌自杀+Kill 爆裂真结算、F2 减伤视线系别归位步行族）。
// 标杆 Terarria1457/Terraria/Projectile.cs + Player.cs/Item.cs（行号均指该树）：
//   SetDefaults 弹 856（:8208-8220）：32×32、aiStyle 167、friendly、alpha=255、magic、
//     tileCollide=false、ignoreWater=true（:8217——★湿段定谳 2026-09-06：豁免,P.cs
//     :16903 湿段整段门不开,不接 projectileWetSection）、extraUpdates=2、
//     usesLocalNPCImmunity=true + localNPCHitCooldown=-1（每敌一跳终生一次）。
//   AI_167_SparkleGuitar（:47427-47445）：寿命 num=90t——localAI[0] 计满 88 Kill
//     （`>= num-1f` 判定先于本轮位移,num2=t/90 曲线参数）;每拍 Center = CatmullRom 四控制点：
//       P0 = player.Center − v×2        （value :47433）
//       P1 = player.Center              （center）
//       P2 = (ai[0], ai[1])             出手时钦定的目标锚点（vector33,X/Y 存 ai）
//       P3 = (ai[0],ai[1]) − v ×(1−t×3) （value2 :47436）
//     t = localAI[0]/90;type==856 时 rotation = 2π×t + HotPink 光照（视觉位,本仓仅 rot）。
//     ⚠ velocity 全程不动（AI 无速度写回）——脚本化路径,-v 仅作形状控制。
//   减伤 ModifyStellarTuneDamage（:15267-15273）：type==856 且 owner 有效且
//     !Collision.CanHit(this→Main.player[owner]) ⇒ damage = (int)(damage×0.75)
//     （C# int 截断）。消费点 = Damage_PVE :13333-13339 与 Damage_PVP :14719-14723,
//     即【每次命中结算时】按当时无视线状态折算,非出生期定死。
//   Kill 爆裂（Kill 弹 856 段 :72803-72841，★F1 修正 2026-08-31 二轮蓝队——旧头注
//     「Resize 只改写死亡当帧盒、无再结算语义」系误判，已废）：尘 58×6 + 278 双环 +
//     gore16/ParticleOrchestraType.StellarTune 为视觉面之外，段尾有【真结算】：
//       position = Center; width = height = 128; Center = position;
//       maxPenetrate = penetrate = -1; Damage();        （:72831-72840）
//     ⇒ 以弹心居中的 128×128 盒对邻接未免疫敌各跑一轮完整 Damage_PVE_Inner 链
//     （DamageVar/crit/kb/hitDirection(:13652)/StrikeNPC；ModifyStellarTuneDamage
//     :13335 同在链内逐命中即时判——本轮判时弹盒已是 128 形）。penetrate 置 -1 的
//     意义 = 绕开单敌截断：爆裂轮 keepIterating 不再折断（对比 :14194 penetrate--
//     分支只在 >0 时触发），盒内全体可结算。免疫排除 = usesLocalNPCImmunity flag2
//     （:12598 array[i]==0 才受理）：localNPCHitCooldown=-1 在首轮命中即写 array=-1
//     （:14158-14163），故被触杀的那个敌天然不会被爆裂双扣。两条 Kill 路（AI_167 寿尽
//     :47429 自身 Kill / Update :17312 penetrate==0）都进本段——触杀当拍即爆。
//   ⚠ ★γ 案已收口（终局扫尾批 A6，2026-08-31）：原版 numUpdates 循环（Update
//     :16781-16782）把 AI() 与位移、Damage() 一并包进 ⇒ extraUpdates=2 时每 tick
//     跑 3 子步、localAI[0] 每 tick +3、寿尽 ≈88/3→30 tick。fixedUpdate 现按子步
//     循环重写：t++ → 寿门 → CatmullRom 以 t01=localAI[0]/90 **逐子步取样**（曲线
//     对拍同源,非只改计时）→ 本子步 Damage() 盒判。爆裂结算/contact 致死语义不变。
//     tests/spectre-stellar-procs 寿尽案已随此翻新（diedAt=30）。
//   联机通道（2026-08-31 二轮蓝队批）：msg27 kind=9 真类重建（Game.netProjBroadcast
//     分派序前置支/netMakeProj case9；旧端把 856 落进 kind1 武器族支曾被 melee 化——
//     收端视线门/melee crit 掷/浸剂 melee 位三重错位+缺结算侧 ×0.75,见 Game.netPuppetProjContact）。
//   出手侧（Player.cs:48448-48477）：见 computeStellarTuneShot 导出（GA 缝合点清单在批报告）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { canHit } from '../physics/LineOfSight';
import { playerCanHitEnemy, hitCritters, applyBannerDamageDealt, noteVanillaProjImmune } from './projTargets';
import { projectileSnapStrikeBonus } from '../stats/SnapStrike';
import { cutTilesBox } from './ProjCutTiles';
import { ghostHealProc, ghostHurtOnHit, playerHasGhostHurt, snapshotVanillaGate, vanillaGateRejected } from './SpectreSoulProj';   // ★BJ382 星璇之音 856 proc 单源（★清偿刀 T 门位快照单源;★BJ424-T3 补 ghostHurt 漏斗面）
import { nebulaBoosterOnHit } from './NebulaBooster';   // ★BJ424-T3 星云套装 on-hit 单源（自持命中环面收编）
import { stellarTuneFx } from '../fx/orchestraFx';   // ★2026-09-01 Spawn_StellarTune 本体（:3675-3705）
import { rollVanillaHitCrit } from './proj1457';   // ★BJ494 掷率单源（:12915-12927 owner 装配）
import { ParticleOrchestraType } from '../net/syncModules';

/** ★三轮蓝队 F6：immune[owner] 读门（:12636-12641）。原版 flag3 单发族
 *  （maxPenetrate==1 ∧ 无两旗）豁免此窗——但 856 usesLocalNPCImmunity=true ⇒ flag3
 *  恒假 ⇒ 【完整吃】该窗：immune[owner]!=0 的受害者在命中轮【整个被跳过】（localNPCImmunity
 *  表也不写——拒收发生在任何写尾之前）。
 *  ★清偿刀 W（X4-债13③,2026-09-29）：写半面已归桥——弹幕域 iframes 由 stellarStrike
 *  pierce=-3 在 Enemy.ts 写梯清零（:14297）,近战域表由受理面 noteVanillaProjImmune
 *  （856 face=usesLocal→0 出表）承载;旧 sparkImmuneWindowClear(id,0) 裸写+无条件跑
 *  （门拒跳也清=over-clear）退役。
 *  ★清偿刀 P1（C5 红蓝定谳#2,2026-09-29）：门位读域勘误——原版该门读【弹幕域】
 *  targetNPC.immune[owner]（Projectile.cs:12635-12641）=本仓 Enemy.iframes 共享窗,
 *  旧档 duck-call Game.meleeNpcImmuneGateOf（近战三重门 :44598 immune 分量的仓内
 *  独立簿）系错域投影：①弹幕域有窗（他弹残窗 iframes>0）而近战域簿空的敌被误放行
 *  → 落 hitOnce.add+killStellarTune（触敌即亡）,原版=门拒 return 不落标、弹体存活
 *  可后继命中;②近战域簿有窗而弹幕域无窗的敌被误拒。读口归 T 刀单源快照
 *  （snapshotVanillaGate+vanillaGateRejected,读「进 hurt 前状态」）,旧 duck-call
 *  退役（meleeNpcImmuneGateOf 仍服务近战自身三重门,与本弹无涉）。 */
/** XNA Vector2.CatmullRom（同 MinionProj 内私有实现;此处独立避免跨类内联依赖） */

/** XNA Vector2.CatmullRom（同 MinionProj 内私有实现;此处独立避免跨类内联依赖） */
export function catmullRom(
  v1: { x: number; y: number }, v2: { x: number; y: number },
  v3: { x: number; y: number }, v4: { x: number; y: number }, t: number,
): { x: number; y: number } {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * v2.x + (-v1.x + v3.x) * t + (2 * v1.x - 5 * v2.x + 4 * v3.x - v4.x) * t2
      + (-v1.x + 3 * v2.x - 3 * v3.x + v4.x) * t3),
    y: 0.5 * (2 * v2.y + (-v1.y + v3.y) * t + (2 * v1.y - 5 * v2.y + 4 * v3.y - v4.y) * t2
      + (-v1.y + 3 * v2.y - 3 * v3.y + v4.y) * t3),
  };
}

/** ModifyStellarTuneDamage 1:1（Projectile.cs:15268-15273）：losBlocked 传「当前弹心到
 *  主玩家 Center 的 Collision.CanHit 已断」布尔（两调用点均为即时结算）。
 *  C# `(int)((double)dmg * 0.75)` = 截断向零。 */
export function modifyStellarTuneDamage(damage: number, losBlocked: boolean): number {
  if (!losBlocked) return damage;
  return Math.trunc(damage * 0.75);
}

/** Damage_PVE_Inner 命中方向 num40（:13652 `int num40 = direction`）：856 无类型特化支
 *  （switch/aiStyle 特化表皆不含 167），而 aiStyle167 走 AutomaticallyChangesDirection
 *  （:17387 豁免表无 167 ⇒ true）——每子步按 velocity.X 符号写回 direction；AI_167 从不
 *  写速度 ⇒ 全程锚定出手水平符号（vx<0 → -1，否则 +1，Entity.cs:20 默认值兜底）。 */
function stellarHitDir(vx: number): number {
  return vx < 0 ? -1 : 1;
}

/** 命中结算共用形参包（直击与 Kill 爆裂同链，区别只在弹盒尺寸与免疫排除面）。
 *  proj = 出手弹体（焰爆石 kind1 类门用；两调用点传 this）。 */
function stellarStrike(
  e: { id: number; x: number; y: number; w: number; h: number;
    hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
      pierce?: number, fromPlayer?: boolean) => boolean },
  damage: number, kx: number, game: GameHooks, armorPen: number, critChance: number,
  proj?: { hostile?: boolean; projId?: number },
): boolean {
  // ★焰爆石+拍击石弹幕双支位（Projectile.cs:13439-13446；F3/F1 收编升级 2026-08-31
  //   蓝队四轮）：直击与 Kill 爆裂共用的唯一结算口——弹 856 数据面 magic
  //   （resolveProjClass 单源）→ 原版同样不触发，接线为站位补齐（kind1 门 melee|ranged
  //   过滤/kind0 门 ranged 过滤,未来分流时自动生效）。返回 num14 加伤随暴击并入实伤参。
  //   ★BJ382 返回值改为受理位（Enemy.hurt 返真）——调用点按 :14263 受理面挂
  //   ghostHeal proc / numHits++。
  //   ★X2-D1 勘误（2026-09-29,BJ393 判据推广）：上注「返真=受理位」系陈旧语——
  //   Enemy.hurt 布尔返真=「本拍击杀/假人」（Enemy.ts:15033/:14184）,返假三族中
  //   血尽级联（:14369 族）/普通未致命尾档（:15037）原版仍受理（proc/numHits++ 无
  //   死亡复查）→ 受理面谓词=调用侧 !vanillaGated（读门位 iframes/dontTakeDamage）,
  //   本返回值不再消费（击杀位契约退役）。
  // ★BJ494（2026-10-04）掷率收编 rollVanillaHitCrit 单源（旧 `Math.random()<critChance`
  //  静态掷退役;Game.ts 出生位 stellarTuneCritChance=(4+装备链+武器crit+词缀crt)/100 冻结
  //  载体随之摘除——组件面同值,时序差=原版 :25712-14 逐帧折入命中拍现值）：856 SetDefaults
  //  （P.cs:8208-8220 magic=true 亲读）→ 三类掷 :12924 magic 臂达=owner.magicCrit（含持械
  //  item.crit+crt 折入）。ownedBySomeone=非 trap=true → TimerCrit :12928 无条件消费照达
  //  （直击+Kill 爆裂两站共用本口=原版两轮 Damage() 各自掷）。critChance 形参=关断钉
  //  （≤0 掷门关死,类缺省 0.04=路由门;spectre-stellar 测试置 0 禁掷）。武僧 688-690 强制
  //  掷 :12929-43 形位=856 非 688 族恒假,不设。
  const rollCrit = critChance > 0 && rollVanillaHitCrit(proj?.projId ?? 856, game);
  const timerCrit = (game.player as unknown as
    { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
    | null)?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false;
  const critGuitar = rollCrit || timerCrit;
  const snapBonusGuitar = projectileSnapStrikeBonus(game, proj ?? null,
    e.x + e.w / 2, e.y + e.h / 2, e.id,
    { victimBox: { w: e.w, h: e.h, cx: e.x + e.w / 2, cy: e.y + e.h / 2 } });
  // ★清偿刀 W（X4-债13③,2026-09-29）：pierce 0→-3（usesLocal 族清零档,Enemy.ts
  //  :14297——门 :13991 照走,受理写 immune[owner]=0 ≡ :14175-14178 usesLocal 支）。
  //  旧 pierce=0 通用尾档写 10t=背靠背二奏 10t 内被头门整拒（写面偏差;节流本就
  //  由 hitOnce〔localNPCHitCooldown=-1 每敌终生一跳〕承载,10t 全局窗纯多余）。
  // ★BJ494（2026-10-04）crit ×2 预倍补位（同站相邻面,定谳=Enemy.hurt 零内倍（:14665
  //  「仓内调用侧预倍」习语）+原版 StrikeNPC crit ×2（:81990）——旧 stellar crit 掷中
  //  仅翻 kb（:82179 ×1.4）伤值恒 ×1=真缺口,本刀随掷率收编一并落位;BJ492① MinionProj
  //  预倍同形）。snap 加伤随暴击并入（既有）。
  // ★S02(BJ723-B):crit ×2 摘除——Enemy.hurt 防后承载(NPC.cs:82067,旧预倍习语退役)
  return e.hurt(applyBannerDamageDealt(game, e, Math.max(1, damage))
    + (snapBonusGuitar ? snapBonusGuitar : 0),
    kx, 0, game, armorPen,
    critGuitar, -3, true);          // StrikeNPC 单点（Enemy.hurt 同构）
}

/** 出手暴击率单源（★二轮蓝队 FR2-F：词缀位曾漏——Game case4715 只吃 stTune.crit）。
 *  原版链 = Item.Prefix（Item.cs:585 `crit += crt`）先把词缀位折进物品 crit 字段 →
 *  Player.Update 每帧 `magicCrit += inventory[selectedItem].crit`（Player.cs:25712-714，
 *  三系同行加算）→ GetWeaponCrit(:54009-54024) 直返累计表。基础 4 = 字段初值
 *  （:2415 magicCrit = 4）。本仓 base(itemCombat)/prefix(prefixStat.crt) 分账存放，
 *  此处求和还原原字段终值口径（同族近战链形制参照 Game.ts arcCritZ `+ (ps?.crt ?? 0)`）。 */
export function stellarTuneCritChance(
  equipChainCritPct: number, itemBaseCrit: number | undefined, prefixCrt: number | undefined,
): number {
  return Math.min(1, (4 + equipChainCritPct + (itemBaseCrit ?? 0) + (prefixCrt ?? 0)) / 100);
}

export interface StellarShotInput {
  playerCx: number; playerCy: number;
  /** Main.MouseWorld（原始鼠标世界点——原版此处不做 reach 钳,:48449 直取） */
  mouseWorldX: number; mouseWorldY: number;
  /** GetSparkleGuitarTarget 结果集（:47030-47051：1000×800 居中矩形 ∩ CanBeChasedBy）；
   *  空表 ⇒ 落未锁定支。注入端由 GA 缝合（实体循环） */
  targets: Array<{ cx: number; cy: number; vx?: number; vy?: number }> | null;
  targetRoll: () => number;                       // Main.rand.Next(validTargets.Count)（:48454）
  /** NextVector2Circular(24f,24f) 抖动样本（:48459——★三轮蓝队 F1①：Utils.cs:1301-04
   *  NextVector2Unit()×(w,h)×NextFloat()，半径【线性均匀】非 √ 盘均匀;注入端单角+单乘子） */
  nextJitter: () => { x: number; y: number };
  /** NextVector2CircularEdge(1f,1f) 单位向量（:48465 方向形参） */
  nextEdgeUnit: () => { x: number; y: number };
  /** Main.rand.NextFloat() [0,1)（:48475 上扬保底用） */
  nextFloat01: () => number;
}
export interface StellarShotOutput {
  spawnX: number; spawnY: number;                 // pointPosition = RotatedRelativePoint(mountedCenter)
  vx: number; vy: number;                         // vector35（AI_167 曲线方向形参,量值=dist×2）
  aimX: number; aimY: number;                     // vector33 → NewProjectile ai[0]/ai[1]（:48477）
}

/**
 * Player.cs:48448-48477 出手向量 1:1。随机量全部注入以便确定性测试与联机一致化。
 * GetSparkleGuitarTarget 矩形门见 sparkleGuitarTargetRect——候选收集在调用端。
 */
export function computeStellarTuneShot(inp: StellarShotInput): StellarShotOutput {
  // 锚点：目标有效 → nPC.Center + nPC.velocity×20f（:48453-48455）;否则鼠标点±24 抖动
  let aimX = inp.mouseWorldX, aimY = inp.mouseWorldY;
  let locked = false;
  if (inp.targets && inp.targets.length > 0) {
    const t = inp.targets[Math.floor(inp.targetRoll() * inp.targets.length)];
    if (t) {
      aimX = t.cx + (t.vx ?? 0) * 20;
      aimY = t.cy + (t.vy ?? 0) * 20;
      locked = true;
    }
  }
  // vector34 = 未抖动前距离向量（:48456）——700 钳比较用它,勿搬进抖动后
  let dxa = aimX - inp.playerCx, dya = aimY - inp.playerCy;
  if (!locked) {
    const j = inp.nextJitter();
    aimX += j.x; aimY += j.y;
    const dl = Math.hypot(dxa, dya);
    if (dl > 700) {
      dxa *= 700 / dl; dya *= 700 / dl;
      aimX = inp.playerCx + dxa; aimY = inp.playerCy + dya;   //（:48461-48463）
    }
  }
  // 方向形参：单位向量,Y>0 取反压上半平面,|Y|<0.5 再给上扬保底（:48463-48470）。
  // ★三轮蓝队 F1②：|y|<0.5 改写 Y 后【不归一化】——原版 vector35 = Unit×(1,1) 全程
  //   只做取反/Y 覆写两步线性变换,vector35*=-1f(:48467) 与 vector35.Y=…(:48469) 之后
  //   直接 `vector35 *= vector34.Length()*2f`(:48471)。此处曾自加 /=norm 还原单位向量
  //   ⇒ 曲线形参量值系统性偏小（|v| 由 (1,√2] 波段压回 1）,CatmullRom P0/P3 张距随之
  //   收窄——删除多余归一化,|v| 恢复 ∈(1,√2]（|Y₀|<0.5 支的 |X|>√3/4、新 |Y|∈[0.5,1)）。
  const e0 = inp.nextEdgeUnit();
  let ux = e0.x, uy = e0.y;
  if (uy > 0) { ux = -ux; uy = -uy; }            // :48467 `vector35 *= -1f`=整向量取反（曾只翻 Y）
  if (Math.abs(uy) < 0.5) uy = -inp.nextFloat01() * 0.5 - 0.5;
  const dist = Math.hypot(dxa, dya);              // vector34.Length()（钳后终值,:48476）
  return { spawnX: inp.playerCx, spawnY: inp.playerCy,
    vx: ux * dist * 2, vy: uy * dist * 2, aimX, aimY };
}

/** GetSparkleGuitarTarget（Player.cs:47030-47051）判定用矩形：CenteredRectangle(Center,1000×800) */
export function sparkleGuitarTargetRect(pcx: number, pcy: number): {
  left: number; right: number; top: number; bottom: number;
} {
  return { left: pcx - 500, right: pcx + 500, top: pcy - 400, bottom: pcy + 400 };
}

/** ★三轮蓝队 F1①：Utils.NextVector2Circular 唯一实现（Utils.cs:1301-1304）——
 *  NextVector2Unit()×(w,h)×NextFloat() = 单角均匀 × 半径【线性】乘子。
 *  Game case4715 注入端经此单源（曾内联 √rand 面积盘=自加近似,且双角双乘子
 *  连盘形都不是——x/y 各掷各的角,已废）。半径分布 R=r×max：P(R<t)=t/max 线性,
 *  E[R]=max/2——面积均匀样本(√rand)均值 max/3、半盘命中 1/4,统计判别式见 tests。 */
export function nextVector2Circular(rng: () => number, hw: number, hh: number):
  { x: number; y: number } {
  const a = rng() * Math.PI * 2;
  const r = rng();
  return { x: Math.cos(a) * r * hw, y: Math.sin(a) * r * hh };
}

/** GetSparkleGuitarTarget 候选收集（Game.case4715 调用侧抽取为可测纯函数）。
 *  rect = sparkleGuitarTargetRect；chase = canBeChasedBy（projTargets）。 */
export interface StellarCandidate { cx: number; cy: number; vx?: number; vy?: number }
export function collectStellarTargets(
  ents: Array<{ x: number; y: number; w: number; h: number; vx?: number; vy?: number }>,
  rect: { left: number; right: number; top: number; bottom: number },
  chase: (e: unknown) => boolean,
): StellarCandidate[] {
  const out: StellarCandidate[] = [];
  for (const e of ents) {
    if (!chase(e)) continue;
    if (e.x + e.w <= rect.left || e.x >= rect.right
      || e.y + e.h <= rect.top || e.y >= rect.bottom) continue;   // Hitbox.Intersects(value)
    // ★F1③：velocity×20 提前量随行（Player.cs:48453 nPC.Center+nPC.velocity*20f）
    out.push({ cx: e.x + e.w / 2, cy: e.y + e.h / 2, vx: e.vx ?? 0, vy: e.vy ?? 0 });
  }
  return out;
}

/**
 * 弹 856 实体：SetDefaults(:8208)/AI_167(:47427)/命中管线(Damage_PVE ×localNPCImmunity
 * -1 + ModifyStellarTuneDamage :13333)全按原文。spawn/aim 由 computeStellarTuneShot
 * 产出后 GA 接线（Game.ts 10338 登记的"攻击面未实装"清偿由此闭合）。
 */
export class SparkleGuitarProj extends Entity {
  readonly projId = 856;
  w = 32; h = 32;
  friendly = true;
  magic = true;
  tileCollide = false;
  ignoreWater = true;
  // ★BJ494（2026-10-04）缺省 0 保留=关断钉（直构测试确定性依赖,掷臂对 ≤0 关死;
  //  TimerCrit :12928 臂无条件不受门限=原版 ownedBySomeone 语义）。生产出生位
  //  Game.ts 写 0.04=路由门（写位仅开门,掷率本体=rollVanillaHitCrit 命中拍动态;
  //  旧 stellarTuneCritChance 冻结率载体已退役）。
  critChance = 0;
  armorPen = 0;
  knockback = 0;
  /** ai[0]/ai[1] = 出手时 vector33（目标锚点世界坐标） */
  private aimX: number; private aimY: number;
  /** localAI[0]（float 语义,整数推进） */
  private t = 0;
  private life = 90;                               // AI num=90（:47428）
  private hitOnce = new Set<number>();             // localNPCHitCooldown=-1 ⇒ 终生每敌一次
  /** ★BJ382：PVE 受理命中计数（原版 Projectile.numHits——SetDefaults :706 起始 0;
   *  :14263 受理后自增 ⇒ proc（:13877-79）读自增前值。直击受理 1 跳（0 档）→ Kill
   *  爆裂轮 =【同一弹对象】的 Damage() :72840,numHits 累积 ⇒ 爆裂首跳 1 档率 0.15
   *  （直击已受理时）;寿尽爆裂（未直击）首跳仍 0 档。PVP 读口 projPveNumHits 形状 */
  pveNumHits = 0;
  /** 上一帧锚定的玩家引用快照（原版直读 Main.player[owner].Center——每拍现查） */
  constructor(x: number, y: number, vx: number, vy: number, public damage: number,
    aimX: number, aimY: number) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;                    // 原版 velocity 保持出手值,AI 不写回
    this.aimX = aimX; this.aimY = aimY;
  }

  /** ★FR5-F（三轮蓝队）：傀儡旋转相位通道（msg27 kind9 aux 千分位量化 t01——
   *  每快照重锚 + 本地等速自推进，见 Game.netProjBroadcast/netApplyProjSnaps 注）。
   *  phase01 取 mod-90：rotation=2π×t/90 以 90 为周期，wrap 视觉精确等价。 */
  get phase01(): number {
    return (((this.t % 90) + 90) % 90) / 90;
  }
  /** 收端到包重锚（发端真值，千分位量化误差 ≤0.045/t01 → 视觉不可辨） */
  netPhaseApply(t01: number): void {
    if (!Number.isFinite(t01)) return;
    this.t = Math.max(0, Math.round(Math.min(1, Math.max(0, t01)) * 90));
  }

  /** AI_167 脚本位置推导（测试友好:playerCenter 可注入覆盖默认 game.player 中心） */
  private splineAt(t01: number, pcx: number, pcy: number): { x: number; y: number } {
    const nvx = -this.vx, nvy = -this.vy;          // vector2 = -velocity（:47434）
    const p0 = { x: pcx + nvx * 2, y: pcy + nvy * 2 };
    const p1 = { x: pcx, y: pcy };
    const p2 = { x: this.aimX, y: this.aimY };
    const p3 = { x: this.aimX + nvx * (1 - t01 * 3), y: this.aimY + nvy * (1 - t01 * 3) };
    return catmullRom(p0, p1, p2, p3, t01);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // 联机傀儡（v8 msg27 kind=9，远端弹幕快照驱动）：对敌判定归拥有者客户端；
    // 对玩家（PvP bit6）由收端本地结算 Damage_PVP 族（Game.netPuppetProjContact——
    // 含 ModifyStellarTuneDamage ×0.75 折算与 crit 掷点缺席判定,见彼处注释）。
    // AI_167 spline 锚「发射者 Center」是发送端权威路径,收端不重放（netPuppetStep 插值跟随）
    if (this.netPuppet) { this.netPuppetStep(); this.t += 3; return; }
    const p = game.player as { cx: number; cy: number; x: number; y: number; w: number; h: number };
    // ---- ★γ 移交硬伤收口（终局扫尾批 A6）：numUpdates 循环 1:1 —— 原版
    //      Projectile.Update(:16781-16782) `numUpdates = extraUpdates; while(numUpdates>=0)`
    //      把 AI()【与位移、Damage()】一并包进子步循环，extraUpdates=2 ⇒ 每拍 3 子步。
    //      此前本仓每 fixedUpdate 只 t+1（寿命 ×3=89t 案），命中面虽已跑 3 遍但曲线
    //      推进没跟上 ⇒ 触杀窗/爆裂位置系统性滞后。现 AI 与位移同步 EU 化：每个子步
    //      ++localAI[0]（t++）→ 寿门(>= num-1=89)→ CatmullRom 曲线以 t01=localAI[0]/90
    //      **逐步取样**（num2=localAI[0]/num 精确复刻,float 语义务必保留）→ 再跑本子步
    //      的 Damage() 盒判。寿尽 = 首个 ++t≥89 的子步（tick 30 内第 88/89 步,
    //      ceil((num-1)/3)=30 tick）。
    for (let u = 0; u <= 2 && !this.dead; u++) {     // numUpdates=extraUpdates 循环体 ×3
      this.t++;                                      // AI_167 ++localAI[0]（:47429）
      if (this.t >= 89) {                            //（:47429-47432 `>= num-1` → Kill()）
        this.killStellarTune(game);                  // 寿尽同样走 Kill 弹 856 段（爆裂真结算）
        return;
      }
      const t01 = this.t / 90;                       // num2（float 除法语义）——每子步重取样
      const pos = this.splineAt(t01, p.cx, p.cy);
      this.x = pos.x - this.w / 2;
      this.y = pos.y - this.h / 2;

      // ---- Damage() 子步内旁路（:12513-12518）：CutTiles 先于全部受害循环。
      //      ★三轮蓝队 F3：856 friendly∧owner 本地∧¬npcProj∧¬minion∧type≠1054 全过,
      //      CanCutTiles(:15407) aiStyle167/type856 不在排除表 → 每子步按本盒(右/下
      //      +1=循环排除界,P.cs:15377——★SW-BJ88 债4②勘误,旧注"+1 外沿"系含端旧语义)
      //      砍 tileCut 物（瓦罐/杂草）。此前缺席=跨类旧账清偿（ProjCutTiles 单点）----
      cutTilesBox(game, this.x, this.y, this.w, this.h);
      // 小动物（Damage_PVE 同一 victim 循环）：一击致死并消耗弹体（MagicProj 形态同构,
      // 先于怪物桶——既定桶序）→ 死亡走 Kill 弹 856 段=带爆裂真结算
      if (hitCritters(this, game)) { this.killStellarTune(game); return; }

      // ---- 命中（Damage():17184 每 update 跑 extraUpdates+1=3 次；PVE 梯 :12572/:12615。
      //      penetrate 默认 1（:366）且 SetDefaults 不重设 ⇒ 首个有效敌 :14194 penetrate--
      //      →0 → Update :17312 同拍 Kill()——弹 856 是单发：触敌即亡+死亡爆裂。
      //      usesLocalNPCImmunity/-1 只承担免疫标记语义（首轮命中写 array=-1），非"多敌多跳"）----
      for (const ent of game.enemies()) {
        const e = ent as never as {
          id: number; x: number; y: number; w: number; h: number; dead: boolean;
          hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
            pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
        };
        if (!e || e.dead) continue;
        if (!(this.x < e.x + e.w && this.x + this.w > e.x
          && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
        if (!playerCanHitEnemy(ent, game, this.projId)) continue;
        // ★三轮蓝队 F6：immune[owner]!=0 拒收门（:12635-12641）——先于 localNPCImmunity
        //   写面，被拒受害者连 hitOnce 标记都不落（原版拒收 return 在任何写尾之前）
        //   ★清偿刀 P1（C5 定谳#2）：读口归【弹幕域】快照判据（T 刀单源,读进 hurt 前
        //   状态;快照同时供 strike 后受理面判 vanillaGated——两读之间零写面,单快照双消费）。
        //   门拒不落 hitOnce 标+弹体存活（penetrate-- :14189 与 Kill :17312 全在受理面后）。
        const gate = snapshotVanillaGate(e);
        if (vanillaGateRejected(gate)) continue;
        if (this.hitOnce.has(e.id)) continue;
        this.hitOnce.add(e.id);                    // array[victimIndex] = -1（:14158-14163）
        // ★ModifyStellarTuneDamage（:13333-13339 命中结算点）：每轮即时判 LOS——
        //   Entity 重载 CanHit(this, Main.player[owner]) = 步行族整盒对整盒（Collision.cs
        //   :373 → Vector2 重载 :383 → Point 纯整型链 :388；F2 归位,canHitLine 系系别错挂已废）
        const blocked = !canHit(game.world.store, this.x, this.y, this.w, this.h,
          p.x, p.y, p.w, p.h);
        // ★BJ382：幽灵兜帽吸血 proc（Projectile.cs:13877-79 Damage() 通用 on-hit 段;
        //  856 数据面 magic ⇒ 原版星璇之音本就吸血,本仓漏接）——受理位挂接,proc 先于
        //  :14263 numHits++（读自增前值）;拒收不 proc 不计数
        //  ★X2-D1（2026-09-29,BJ393 判据推广）：受理面谓词 !vanillaGated——Enemy.hurt
        //  返真=「本拍击杀」（Enemy.ts:15033）,返假三族=门拒（dead:13971 前置已滤/
        //  iframes:13972/dontTakeDamage:13978）+血尽级联（:14369 族,伤害已实扣=原版
        //  受理）+普通未致命尾档（:15037）;原版 proc/numHits++ 在受理面无死亡复查 →
        //  门拒不 proc 不计数,非门拒照 proc 照计数。旧「hurt 返真」=击杀位判据对非
        //  致死命中整面不 proc（吸血 under-fire）,退役。
        // ★清偿刀 T（X4-债12,2026-09-29）：门位读【前置快照】（读侧单源,判据=「进
        //  hurt 前状态」）。旧后置读两源污染：①受理写支（stellarStrike pierce=0 →
        //  Enemy.ts:14297 写 10t;856 vanilla 写梯 =usesLocal 支清零 immune[owner]=0
        //  :14175-14178——写面偏差 10≠0 登记债）→ 受理拍读恒真 → proc/numHits 真机
        //  恒跳;②死亡转换写支（Enemy.ts:14421 四塔血尽转演出写 iframes=2）→ 致死
        //  命中拍误判门拒。快照双源同治。★清偿刀 P1：快照上提到前置拒收门（上方）
        //  单快照双消费。
        stellarStrike(e, modifyStellarTuneDamage(this.damage, blocked),
          stellarHitDir(this.vx) * this.knockback, game, this.armorPen, this.critChance,
          { hostile: false, projId: this.projId });   // ★焰爆石 kind1 类门入参
        const vanillaGated = vanillaGateRejected(gate);
        if (!vanillaGated) {
          ghostHealProc(game, this.projId, this.pveNumHits, e);
          // ★BJ424-T3 魔法命中漏斗面收编：ghostHurt :13881 / nebula :13885 与 ghostHeal
          //  :13877 同块同受理面（856 数据面 magic ⇒ 凡走本面两引擎都该触发）。
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
          // ★清偿刀 W（X4-债13③）：近战域半面随受理面（桥 856 face=usesLocal→0
          //   出表）——原版 :14175-14178 单写 immune[owner]=0 一笔覆盖全域,仓内
          //   两域分体各落半面;旧 sparkImmuneWindowClear 无条件跑=门拒跳也清
          //   （over-clear）,现归受理面=拒收不落任何写尾（原版门拒 return 在梯前）。
          noteVanillaProjImmune(game, this.projId, e.id);
        }
        this.killStellarTune(game);                // penetrate==0 → 同拍 Kill（含爆裂结算）
        break;                                     // keepIterating=false 单敌截断（:12603/:14203）
      }
    }
  }

  /** Projectile.Kill() 弹 856 段 1:1（:72803-72841）：视觉尘后真结算——Resize 128×128 居中
   *  + maxPenetrate=penetrate=-1 + Damage()。爆裂轮与普通命中同链（stellarStrike/减伤折算
   *  一致）；唯一差别：免疫排除面（hitOnce 成员=本轮前已被本弹标免疫者——恰为触杀的敌）
   *  与 penetrate=-1 ⇒ 全体盒内未免疫敌各吃一轮、不再单发截断。active 守卫/幂等 =
   *  :71761-71764 同构。 */
  private killStellarTune(game: GameHooks): void {
    if (this.dead) return;
    this.dead = true;
    for (let i = 0; i < 6; i++) {                  // dust58 ×6 于本体盒（:72807-72809）
      game.spawnDust?.(this.x, this.y, this.w, this.h, 58, 0, 0, 150, null, 0.8);
    }
    // ★2026-09-01 StellarTune(2) 编排接线（Projectile.Kill 856 段 :72825-72831,
    //  clientOnly:true,invoker=owner）：5 粒 Gold/HotPink/Violet 星屑——producer 锚
    //  缺登记消账（旧注"编排不建模"订正）。原版 clientOnly:true → 本仓 owner 权威
    //  模拟广播补远端（34 型偏差口径,module8 枚举注同）。gore16 仍不在建模面。
    stellarTuneFx(game, this.cx, this.cy);
    game.broadcastParticleOrchestra?.(ParticleOrchestraType.StellarTune, this.cx, this.cy);
    const bw = 128, bh = 128;
    this.x = this.cx - bw / 2;                     // position = Center → 盒左上随 128 展开
    this.y = this.cy - bh / 2;
    this.w = bw; this.h = bh;
    // ★三轮蓝队 F3/F6：Kill 段尾的 Damage()（:72840）同样走 :12515 CutTiles 门——
    //   856 全门通过 ⇒ 以【爆裂后的 128×128 盒】再砍一轮（放大前后视觉差=爆裂圈内的
    //   草/瓦罐也会被清）;小动物亦在 PVE victim 循环受理面内（本弹已 dead,无自毁语义）
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    hitCritters(this, game);
    const p = game.player as { x: number; y: number; w: number; h: number };
    // ModifyStellarTuneDamage 本轮逐命中评估(:13335),但本轮内弹盒恒 128、玩家盒不变
    // ⇒ 判值全体一致,评一次即等价（避免 per-victim 重复世界查询）
    const blocked = !canHit(game.world.store, this.x, this.y, this.w, this.h,
      p.x, p.y, p.w, p.h);
    for (const ent of game.enemies()) {
      const e = ent as never as {
        id: number; x: number; y: number; w: number; h: number; dead: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
          pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
      };
      if (!e || e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x
        && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      // ★F6：拒收门同样罩住爆裂轮逐受害者（flag3 恒假,窗关闭者跳过且不落标）；
      //   命中尾清窗已归受理面（★清偿刀 W——弹幕域 pierce=-3+近战域桥写,见直击站注）
      //   ★清偿刀 P1（C5 定谳#2）：读口归【弹幕域】快照判据（T 刀单源,同直击站注）。
      const gate = snapshotVanillaGate(e);
      if (vanillaGateRejected(gate)) continue;
      if (this.hitOnce.has(e.id)) continue;        // flag2（:12598 usesLocalNPCImmunity array[i]==0）
      this.hitOnce.add(e.id);
      // ★BJ382：爆裂轮同链 proc（:72840 Damage() 同一弹对象,numHits 累积读自增前值）
      //  ★X2-D1（同直击站注）：受理面谓词 !vanillaGated——门拒不 proc 不计数,
      //  血尽级联/普通未致命返假照 proc 照计数
      //  ★清偿刀 T（X4-债12,同直击站注）：门位读前置快照（读侧单源;P1 快照上提前置门）。
      stellarStrike(e, modifyStellarTuneDamage(this.damage, blocked),
        stellarHitDir(this.vx) * this.knockback, game, this.armorPen, this.critChance,
        { hostile: false, projId: this.projId });   // ★焰爆石 kind1 类门入参
      const vanillaGated = vanillaGateRejected(gate);
      if (!vanillaGated) {
        ghostHealProc(game, this.projId, this.pveNumHits, e);
        // ★BJ424-T3 魔法命中漏斗面收编：爆裂轮同块同 face（Kill 内 Damage() :72840 同一
        //  弹对象;爆盒 128×128 已展开 → ghostHurt 候选窗 = this 盒几何）。
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
        // ★清偿刀 W（X4-债13③）：爆裂轮同款受理面近战域清窗（:14175-14178 同支,
        //   Kill 内 Damage() :72840 同链同梯）——旧无条件清=门拒跳也 over-clear。
        noteVanillaProjImmune(game, this.projId, e.id);
      }
    }
  }

  draw(r: Renderer, _cam: Camera): void {
    void _cam;
    const ctx = r.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate((Math.PI * 2) * (this.t / 90));     // rotation = 2π×num2（:47440）
    ctx.fillStyle = '#FF78C0';                     // HotPink 光照族配色兜底（贴图就绪时被遮盖）
    ctx.beginPath();
    ctx.arc(0, 0, this.w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
