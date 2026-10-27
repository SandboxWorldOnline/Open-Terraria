// 坐骑战斗通道（运输域两个缺失伤害面）：
//
// ①矿车高速撞击 NPC——原版 Player.Update_bfi 矿车段（1457 Player.cs:27748-27831 /
//   1456 :27225 起）：mount.Cart && velocity.Length()>4f 时以车身盒按速度逐轴扩张
//   扫敌怪桶，无 LOS 门是原版设计（矿车本就贴轨碾过、隔半块砖照样撞），勿补。
//   伤害表 GetMinecartDamage（1457 :29474-29518 / 1456 :28776-28820）：
//     默认/绝大多数矿车型        25 + 55×速比
//     mount 13 木质矿车          15 + 30×速比（唯一特例 case）
//     UsingSuperCart             50 + 100×速比（整体覆写并【重新掷】DamageVar）
//     击退 = 10 + 40×速比（无波动）；hardMode ×1.5 再 expertMode ×1.5（各 (int) 截断）
//   命中 → ApplyDamageToNPC(sourceItemId=2343 轨道物品，仅 DPS 记账用，无独立音效)
//   → StrikeNPC 族音效=敌怪自带 HitSound 链；npc.immune[whoAmI]=30。
//
// ②史莱姆坐骑弹跳踩踏——JumpMovement 头部三个垂直踩踏循环（1457 Player.cs:20693-
//   20801 / 1456 :20254-20362；★锚取循环首语句，方法声明行 = :20691 / :20252——
//   2026-08-30 蓝队复核勘误驳回存档：按体例 20254 正确），第四个相似循环是水平侧撞族
//   CollideWithNPCs
//   （1457 :20238-20320 独角兽10/山羊47/马40-42、海盗船44、暗影木45、蜥蜴14、
//   高尔夫球车17 横向）——不属 JumpMovement，横向侧撞族已另立 mountHorizontalCharges
//   （★D1 批）并在本文件内维护；dash==6（Chillet 坐骑 62-65）冲撞面见文件尾注（F5①）：
//     A 史莱姆坐骑弹跳：IsConsideredASlimeMount(type 3|50) && wetSlime==0 && vy>0
//       盒 = 身体 rect.Offset(0,height-1).Height=2.Inflate(12,6)（脚底 ±(12,6) 横带）
//       damage=(int)(40×minionDamage) kb=5 npc.immune=10 **velocity.Y=-10 弹跳**
//       GiveImmuneTimeForCollisionAttack(6) sourceItemId=2430(SlimySaddle)
//     B 死亡细胞冲撞符文下砸：isPerformingJump_DownDash && vy>0（同盒同数值，
//       无弹跳位移，immune=10 GiveImmune(6)，sourceItemId=5465 DeadCellsRamRune）
//       ——★BJ534（2026-10-06）已接线：下砸态机落位（Player.isDownDashing），玩家
//       fixedUpdate 踩踏段在 A/C 支后显式调用（三支坐骑门互斥=位序等价原文）。
//     C 高尔夫球车（type 17）下压：vy>0 同盒，damage=40（**无 minionDamage 乘区**）
//       kb=5 npc.immune=12 GiveImmune(12) sourceItemId=4264(GolfCart)、无弹跳。
//   ★三循环 ApplyDamageToNPC 一律字面 crit:false（1457 :20722/:20760/:20797）——
//   与任务书"crit 三择大"说法不符时以反编译源码为准，此处照抄无暴击掷骰。
//   命中门 = 敌怪 (noTileCollide || Collision.CanHit(position,w,h,nPC...)) 直判短式
//   CanHit（非四射线长链）→ 本仓 LineOfSight.canHit 等价形复用；
//   CanNPCBeHitByPlayerOrPlayerProjectile（1457 :20673 / 1456 :20234）：命中否决条件是
//     `NPCID.Sets.CountsAsCritter[type] && flag`，flag = dontHurtCritters ∪ projectile 小兵/
//     哨兵语境（:20677），且 IsCritterThatIsHostileToPlayers 强制放行（:20681）。本通道两端
//     均为玩家实体直击（projectile==null）⇒ flag = dontHurtCritters。
//     ★E（2026-08-31 清零批二波）饰品面已实装：4767/5323 → equipStats.dontHurtCritters
//     （Player.ts RefreshMechanicalAccs 扫描段），全部扫掠面经 canMountHitTarget →
//     projTargets.playerProjectileCanHitNpcGate 统一出口挂接（CountsAsCritter 成员源 =
//     def.critter 提取旗 ∪ critters 桶成员；敌对小动物 IsCritterThatIsHostileToPlayers
//     复权同在出口内）——矿车碾/坐骑踩/横向冲撞三通道一致生效。
//
// ③撞怪块时点：1457 Player.Update 内撞怪块（:27748）先于 Minecart.TrackCollision 调用
//   （:28315，同一函数体顺序推进）——本 tick 的轨驱增量/端点急停/斜坡起飞不进本帧伤害读数；
//   Minecart.fixedUpdate 的调用点已对齐到轨驱段之前（2026-08-30 R5 复核修正）。
//
// 免疫冷却位映射说明：原版 npc.immune[whoAmI] 是 per-玩家槽（255 格 byte 数组），
// 本仓单机语境塌缩为 Enemy.iframes 单计数器——命中前 gate 读 iframes==0（等价
// immune[i]==0）、命中后直写 iframes=30/10/12（等价 immune[i]=N）。若未来多人
// 需要 per-slot 语义再升级为 Map<playerSlot,n>（现 swingHitSet 族同为单计数器近似，
// 一致性优先）。玩家侧 GiveImmuneTimeForCollisionAttack（1457 :20654-20667）的
// _immuneStrikes 3 连击豁免规则以 WeakMap 计数器建模（见函数注释）。
import type { GameHooks } from './types';
import { damageVar } from '../stats/ScaleStats';
import { canHit } from '../physics/LineOfSight';
import { playerCanHitEnemy as _playerCanHitEnemy, playerProjectileCanHitNpcGate, applyBannerDamageDealt } from './projTargets';
import type { TileStore } from '../world/TileStore';
import { heldItemCritBonus } from './proj1457';   // ★BJ-C2/F12 持械折入单源（proj1457 无反向依赖,无环）

/** IsConsideredASlimeMount（Mount.cs:522-533）：type==3 SlimySaddle ∪ type==50 QueenSlime */
export function isConsideredASlimeMount(mountType: number): boolean {
  return mountType === 3 || mountType === 50;
}

/** JumpMovement 触发的 sourceItemId（NPCDamageTracker 击杀记账用，无独立音效面） */
export const STOMP_SOURCE_ITEMS = {
  slimySaddle: 2430,      // ItemID.SlimySaddle（A 支）
  ramRune: 5465,          // ItemID.DeadCellsRamRune（B 支）
  golfCart: 4264,         // ItemID.GolfCart（C 支）
} as const;

/** 矿车碾压伤害的 sourceItemId = 轨道物品 2343（Player.cs:27816） */
export const MINECART_HIT_SOURCE_ITEM = 2343;

// ---------------------------------------------------------------------------
// ①矿车高速撞击 NPC
// ---------------------------------------------------------------------------

export interface Rect {
  x: number; y: number; w: number; h: number;
}

/** 矿车冲撞盒扩张（1457 Player.cs:27751-27768 / 1456 :27228-27245）：基盒 =
 *  position/width/height 整值化（骑乘态玩家 hitbox 即车盒），逐轴按速度扩张：
 *  vx<-1 x-=15 / vx>1 w+=15 / vx<-10 x 再-=10 / vx>10 w 再+=10 / vy<-1 y-=10 / vy>1 h+=10 */
export function minecartRampageBox(x: number, y: number, w: number,
  h: number, vx: number, vy: number): Rect {
  const r: Rect = { x: Math.trunc(x), y: Math.trunc(y), w, h };
  if (vx < -1) r.x -= 15;
  if (vx > 1) r.w += 15;
  if (vx < -10) r.x -= 10;
  if (vx > 10) r.w += 10;
  if (vy < -1) r.y -= 10;
  if (vy > 1) r.h += 10;
  return r;
}

export interface MinecartDamageCtx {
  /** Mount.Type（默认档含除 13 外全部矿车型；13 木质矿车单独低配档） */
  mountType: number;
  /** Player.UsingSuperCart（unlockedSuperCart && enabledSuperCart，Player.cs:3950-3957） */
  superCart: boolean;
  hardMode: boolean;
  expertMode: boolean;
}

/** GetMinecartDamage 的基础面（未过 DamageVar 波动）（1457 :29474-29518）：
 *  默认 25+55s / mount 13 为 15+30s / SuperCart 整体覆写 50+100s；
 *  knockback = 10+40s。s = velocity.Length()/maxRunSpeed（骑乘态 maxRunSpeed=
 *  mount.RunSpeed，SuperCart 生效期被 Mount.cs:480-486 整体覆写为 20——由调用方
 *  传入 effectiveRunSpeed 时统一口径） */
export function minecartDamageBase(currentSpeed: number,
  ctx: MinecartDamageCtx): { base: number; knockback: number } {
  let base = ctx.mountType === 13 ? 15 + 30 * currentSpeed : 25 + 55 * currentSpeed;
  if (ctx.superCart) base = 50 + 100 * currentSpeed;              // :29512-29515
  return { base, knockback: 10 + 40 * currentSpeed };             // :29516-29517
}

/** GetMinecartDamage 全链（DamageVar ±15%/luck 波动 + hardMode ×1.5 与 expertMode ×1.5
 *  两个独立 (int) 截断乘区；kb 不吃波动不吃难度乘区）。
 *  rnd 可注入确定性随机（测试/deterministic 复放用，缺省 Math.random）。
 *  ★掷骰次数对齐原文：1457 GetMinecartDamage 的 switch 各支（含 default）都先掷一次
 *  DamageVar(:29479-29511)，UsingSuperCart 支 :29512-29515 再掷第二次整体覆写——即
 *  SuperCart 生效期【消耗两次】DamageVar、终值取第二次（2026-08-30 R1 复核时顺带修复：
 *  旧版 SuperCart 只掷一次，随机流长度与原版差 1）。半点舍入登记：damageVar 自
 *  ★F9 蓝队三批起迁入 stats/DamageVar.ts 单源并改 C# ToEven 银行家形（52.5→52，
 *  与 Main.DamageVar 的 (int)Math.Round 默认一致；旧"项目统一 Math.round half-up
 *  52.5→53"全局口径选择已被该批废止）——精确 .5 中点不再有仓内自造偏差。 */
export function getMinecartDamage(currentSpeed: number, ctx: MinecartDamageCtx,
  luck = 0, rnd: () => number = Math.random): { damage: number; knockback: number } {
  const base = minecartDamageBase(currentSpeed, ctx);
  // :29479-29511 switch 先按车型分档掷一次（default 与枚举支同为 25+55s，13 为低配档）
  let dmg = damageVar(ctx.mountType === 13 ? 15 + 30 * currentSpeed : 25 + 55 * currentSpeed,
    luck, rnd);
  if (ctx.superCart) dmg = damageVar(50 + 100 * currentSpeed, luck, rnd);   // :29512-29515 第二掷覆写
  if (ctx.hardMode) dmg = Math.trunc(dmg * 1.5);                  // :29518-29520 (int)(double*1.5)
  if (ctx.expertMode) dmg = Math.trunc(dmg * 1.5);                // :29521-29523（expert 在 hardmode 上叠——JS 主机专家必含 hardmode 标志，两支幂等）
  return { damage: dmg, knockback: base.knockback };
}

/** 冲撞目标的窄结构视图（Enemy/FakeFish 等 hurt 四参形制一致即可） */
interface RampageTarget {
  x: number; y: number; w: number; h: number;
  dead?: boolean; iframes?: number; dontTakeDamage?: boolean;
  def?: { friendly?: boolean; knockBackResist?: number };
  hurt(dmg: number, kbx: number, kby: number, g: GameHooks, armorPen?: number,
    crit?: boolean, pierce?: number, fromPlayer?: boolean): boolean;
}

/** 撞怪/踩踏共用扫掠集：enemies ∪ critters（原版 Main.npc 单数组槽遍历的仓内拆分，
 *  正例 ThrowKillFx 光环段三桶并扫）。critter 支 = Enemy 实例（spawnNpcByVanilla 落桶），
 *  hurt 同 Enemy.hurt 四参形制直用——命中否决面见文件头注③的 flag 语义说明 */
function npcHitTargets(game: GameHooks): unknown[] {
  return [...(game.enemies() ?? []), ...(game.critters?.() ?? [])];
}

/** ★E 坐骑通道命中门（CanNPCBeHitByPlayerOrPlayerProjectile 统一出口）：
 *  扫掠集并扫了 critters 桶 → 桶成员显式作为 CountsAsCritter 成员源传入
 *  （projTargets.countsAsCritterOf 的第二来源位）。此前"仓库无该饰品面 ⇒
 *  小动物可被矿车碾/坐骑踩"的头注语义自本批起被 dontHurtCritters 实装取代。 */
function canMountHitTarget(game: GameHooks, e: unknown, ent: unknown): boolean {
  const bucket = game.critters?.() ?? [];
  const fromCritterBucket = bucket.includes(ent);
  return playerProjectileCanHitNpcGate(game, e, fromCritterBucket);
}

/** 矿车撞怪主入口（1457 Player.cs:27748-27831 / 1456 :27225 起）——
 *  Minecart.fixedUpdate 每 tick 调一次（速度>4f 才进循环）。cart 取结构窄视图
 *  （runSpeed = 生效档 RunSpeed 值，Minecart 的 superCart-aware getter 取值即可）。
 *  rnd 可注入确定性随机（暴击掷+DamageVar 掷骰；缺省 Math.random=原版 Main.rand 口径）。
 *  返回命中数（测试断言用）。 */
export function minecartNpcRampage(cart: {
  x: number; y: number; w: number; h: number; vx: number; vy: number;
  mountId: number; superCart: boolean; runSpeed: number;
}, game: GameHooks, rnd: () => number = Math.random): number {
  const p = game.player as unknown as {
    cx: number; cy: number; luck: number;
    critChance(k: 'melee' | 'ranged' | 'magic'): number;
    inv?: { heldItem?: () => { id: number; prefix?: number } | null | undefined };
    tryConsumingTimerCrit?(g: GameHooks, rx: number, ry: number, rw: number, rh: number): boolean;
    dead?: boolean;
  } | null;
  if (!p || p.dead) return 0;
  const spd = Math.hypot(cart.vx, cart.vy);
  if (spd <= 4) return 0;                                         // :27748 门
  // 速比分母 = maxRunSpeed = 骑乘态整体覆写后的 mount.RunSpeed（:26329；
  // SuperCart 生效 = 20——Minecart.runSpeed getter 取值已含 SuperCart 覆写）
  const box = minecartRampageBox(cart.x, cart.y, cart.w, cart.h, cart.vx, cart.vy);
  const dir = cart.vx < 0 ? -1 : 1;                               // :27802-27806
  // 暴击 = max(melee,ranged,magic) 三择大掷骰（:27777-27792：rand.Next(1,101)<=crit
  // ⇔ floor(rand*100)+1<=crit 整数均匀分布）；后接 TryConsumingTimerCrit 强暴 OR 进。
  // ★BJ-C2/F12（2026-10-06）：原版 num80 起点 = meleeCrit 字段值——含基 4
  //  （Player.cs:2413/:18458 字段初值）与 :25712-14 逐帧链入的持械 item.crit+crt
  //  （三系同值,对 max 可外提）；p.critChance(kind) 只载装备/buff 面 ⇒ 补
  //  4+heldItemCritBonus（proj1457 单源,rollVanillaHitCrit 同式）。
  const critChanceMax = 4
    + Math.max(p.critChance('melee'), p.critChance('ranged'), p.critChance('magic'))
    + heldItemCritBonus(p.inv?.heldItem?.() ?? null);
  const ctx: MinecartDamageCtx = {
    mountType: cart.mountId,
    superCart: cart.superCart,
    hardMode: !!game.world.flags?.hardMode,
    expertMode: game.world.isExpert,
  };
  let hits = 0;
  for (const ent of npcHitTargets(game)) {
    const e = ent as RampageTarget;
    // 门串（:27772-27773）active && !dontTakeDamage && !friendly && immune[whoAmI]==0 &&
    // CanNPCBeHitByPlayerOrPlayerProjectile && 盒相交——immune==0 ↔ 本仓 e.iframes==0。
    // playerCanHitEnemy 是 friendly 门的超集（多 voodoo 臭蛋例外，矿车本无可触发物品）；
    // ★E：CountsAsCritter∧dontHurtCritters 拒收经统一出口接入（下二行）；
    // ★无 LOS 门为原版设计，勿加。
    if (e.dead || e.dontTakeDamage) continue;
    if (!canMountHitTarget(game, e, ent)) continue;   // ★E（:20542 同一门族）
    if (!_playerCanHitEnemy(e, game)) continue;
    if (e.iframes !== undefined && e.iframes !== 0) continue;
    if (!(box.x < e.x + e.w && box.x + box.w > e.x && box.y < e.y + e.h && box.y + box.h > e.y)) continue;
    // ★逐 NPC 掷序 = 原文位次（:27785-27792 全在循环体内）：暴击掷 →
    //   TryConsumingTimerCrit → GetMinecartDamage ——2026-08-30 R1 复核修正：旧版在循环外
    //   求值一次共享 DamageVar 掷骰，同 tick 多目标吃同一波动（原版各自重抽 ±15%/luck）。
    let crit = (Math.floor(rnd() * 100) + 1) <= critChanceMax;     // :27785 rand.Next(1,101)
    // TryConsumingTimerCrit(Rectangle.Intersect(value3, nPC.Hitbox), ref crit)（:27793）
    const ix = Math.max(box.x, e.x), iy = Math.max(box.y, e.y);
    const iw = Math.min(box.x + box.w, e.x + e.w) - ix, ih = Math.min(box.y + box.h, e.y + e.h) - iy;
    const forced = p.tryConsumingTimerCrit?.(game, ix, iy, iw, ih) ?? false;
    crit = crit || forced;
    const ratio = spd / cart.runSpeed;                            // :27790 循环内读 velocity.Length()
    const { damage, knockback } = getMinecartDamage(ratio, ctx, p.luck, rnd);   // :27791
    // ★S02(BJ723-B):暴击 ×2 统一由 Enemy.hurt 防后承载（原版 StrikeNPC_Inner
    //   :82067——旧「调用侧预倍」惯例全域退役;矿车 dmgOut 直传未翻倍值）
    const dmgOut = damage;
    // 0<knockBackResist<1 预除抗性（:27807-27810——hurt 管线内部再乘回，净效果击退
    // 不随抗性衰减；resist>=1 或 ==0 不动）
    const resist = e.def?.knockBackResist ?? 1;
    const kb = resist > 0 && resist < 1 ? knockback / resist : knockback;
    // ApplyDamageToNPC(...,sourceItemId=2343)（:27816）——StrikeNPC 族受击音/飘值/
    // 掉物走 Enemy.hurt 单点管线；fromPlayer=true 计入 DPS。
    // ★附带②：armorPen 参改走玩家 GetArmorPenetration(melee:false) 同源链
    // （ApplyDamageToNPC :20597 `damage += npc.checkArmorPenetration(GetArmorPenetration(
    // melee:false))`——仓内单桶 equipStats.armorPen；旧直传 0=漏穿甲）
    // ★F1（2026-08-31 蓝队三批）：原版矿车冲撞/踩踏/召唤冲撞三循环都走
    //   ApplyDamageToNPC——旗加伤（GetBannerBuffEffect DamageDealt）是 :20599
    //   内置段，凡该通道必吃一次；此前弹幕/坐骑各站全族缺位。
    e.hurt(applyBannerDamageDealt(game, e, dmgOut), dir * kb, 0, game, playerArmorPenOf(game), crit, 0, true);
    hits++;
    e.iframes = 30;                                               // :27819 immune[i]=30
    if (e.dead) {
      // :27821-27823 AchievementsHelper.HandleSpecialEvent(this,9) VEHICULAR_MANSLAUGHTER
      // （critter 击杀同样成立——判定只看该 NPC 是否失效）
      game.achievements?.handleSpecialEvent(9,
        { statLifeMax: (game.player as unknown as { maxHp: number }).maxHp,
          statManaMax: (game.player as unknown as { maxMana: number }).maxMana });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// ②史莱姆坐骑弹跳踩踏（JumpMovement 头部三循环）
// ---------------------------------------------------------------------------

/** 踩踏循环公共参数（四循环差异只在盒/数值/免疫时长/是否弹跳——统一一个扫掠核心） */
interface StompCfg {
  /** 盒 = 玩家 rect.Offset(0,height-1).Height=2.Inflate(12,6)（脚底横带，恒同式） */
  damage(p: PlayerLike): number;
  knockback: number;
  npcImmune: number;
  playerImmune: number;
  /** A 支 true：命中后 velocity.Y=-10 反向弹跳 */
  bounce: boolean;
  sourceItem: number;
}

interface PlayerLike {
  x: number; y: number; w: number; h: number; vx: number; vy: number;
  facing: number;
  mount: { active: boolean; type: number };
  wetSlime?: number;
  iframes?: number;
  summonDamageMult: number;   // minionDamage 链终值（Player.summonDamageMult getter）
}

/** A 支史莱姆踩踏参数（:20693-20726）/ B 支死亡细胞下砸（:20731-20765）共用面 */
const SLIME_STOMP: StompCfg = {
  damage: (p) => Math.trunc(40 * p.summonDamageMult),   // float num = 40f*minionDamage;(int) 截断
  knockback: 5,
  npcImmune: 10,
  playerImmune: 6,
  bounce: true,
  sourceItem: STOMP_SOURCE_ITEMS.slimySaddle,
};

/** B 支（伤害/kb/免疫与 A 完全同构，仅无弹跳位移且不经坐骑门） */
const RAM_RUNE_STOMP: StompCfg = {
  damage: (p) => Math.trunc(40 * p.summonDamageMult),
  knockback: 5,
  npcImmune: 10,
  playerImmune: 6,
  bounce: false,
  sourceItem: STOMP_SOURCE_ITEMS.ramRune,
};

/** C 支高尔夫球车下压（:20768-20801）——damage 40 无 minionDamage 乘区 */
const GOLF_CART_STOMP: StompCfg = {
  damage: () => 40,
  knockback: 5,
  npcImmune: 12,
  playerImmune: 12,
  bounce: false,
  sourceItem: STOMP_SOURCE_ITEMS.golfCart,
};

/** 踩踏扇区公共扫掠核心（★D1 轴参数化改造：横竖两族共用一条门串/hurt 单点/
 *  break 语义——vanilla CollideWithNPCs(:20536-20577) 与三个踩踏循环 (:20693-20801)
 *  的命中段同构：盒相交 → (noTileCollide||CanHit) → ApplyDamageToNPC(int 截断一次)
 *  → nPC.immune[whoAmI]=N → GiveImmuneTimeForCollisionAttack(playerImmune) →
 *  num++/break。盒由调用方按轴构造后传入，本函数零复制扩展 */
function collisionAttackSweep(
  p: PlayerLike, game: GameHooks,
  cfg: { damage(p: PlayerLike): number; knockback: number; npcImmune: number;
    playerImmune: number; bounce?: boolean },
  box: Rect, st: TileStore | undefined,
): number {
  for (const ent of npcHitTargets(game)) {
    const e = ent as unknown as StompTarget2;
    if (!e || e.dead || e.dontTakeDamage) continue;
    if (!canMountHitTarget(game, e, ent)) continue;   // ★E：CountsAsCritter∧dontHurtCritters 统一出口
    if (!_playerCanHitEnemy(e, game)) continue;
    if (e.iframes !== undefined && e.iframes !== 0) continue;    // nPC.immune[whoAmI]!=0
    if (!(box.x < e.x + e.w && box.x + box.w > e.x && box.y < e.y + e.h && box.y + box.h > e.y)) continue;
    // 直判短式 LOS（nPC.noTileCollide || Collision.CanHit(position,w,h,nPC.position,...)）
    if (!(e.noTileCollide || (st ? canHit(st, p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h) : true))) continue;
    const dmg = cfg.damage(p);
    // 方向：num2=direction，vx<0→-1 / vx>0→1（:20546-20551 与踩踏 :20711-20717 同式，
    // 静止时取朝向）
    let dir = p.facing;
    if (p.vx < 0) dir = -1;
    else if (p.vx > 0) dir = 1;
    e.hurt(applyBannerDamageDealt(game, e, dmg), dir * cfg.knockback, 0, game, playerArmorPenOf(game), false, 0, true);   // crit:false 字面（见文件头注）;★附带② AP 同源链;★F1 ApplyDamageToNPC :20599 旗乘区
    e.iframes = cfg.npcImmune;                                     // nPC.immune[whoAmI]=N
    // ★GC1/D3 统一时钟桥写（NPC.immune[whoAmI] 的第二承载面）：nPC.immune[whoAmI]
    // 原文即 per-player 槽（本仓双轨制：实体级 iframes 弹幕域直用 + 共享表供近战门）
    (game as unknown as { noteNpcPlayerImmune?: (id: number, t: number) => void })
      .noteNpcPlayerImmune?.((e as unknown as { id?: number }).id ?? -1, cfg.npcImmune);
    if (cfg.bounce) p.vy = -10;                                    // velocity.Y=-10f（仅史莱姆 A 支）
    giveImmuneTimeForCollisionAttackImpl(p, cfg.playerImmune);
    return 1;
  }
  return 0;
}

/** 踩踏扇区公共扫掠（竖轴封装——脚底横带盒，vanilla 三循环同式） */
function stompSweep(p: PlayerLike, game: GameHooks,
  cfg: StompCfg, st: TileStore | undefined): number {
  // rect = getRect().Offset(0,height-1).Height=2.Inflate(12,6)
  const bx = p.x - 12, by = p.y + p.h - 1 - 6, bw = p.w + 24, bh = 2 + 12;
  return collisionAttackSweep(p, game, cfg, { x: bx, y: by, w: bw, h: bh }, st);
}

interface StompTarget2 {
  x: number; y: number; w: number; h: number;
  dead?: boolean; iframes?: number; dontTakeDamage?: boolean;
  noTileCollide?: boolean;
  def?: { friendly?: boolean };
  hurt(dmg: number, kbx: number, kby: number, g: GameHooks, armorPen?: number,
    crit?: boolean, pierce?: number, fromPlayer?: boolean): boolean;
}

/** GiveImmuneTimeForCollisionAttack（1457 Player.cs:20654-20667）建模：
 *  _timeSinceLastImmuneGet<=20t 内连续获取则 _immuneStrikes++ 否则归 1（计数器自增点
 *  :24857、ResetTo0 在授予侧 :20664）；授予门 = _immuneStrikes<3 && (!immune ||
 *  immuneTime <= time)，immune/immuneTime 是玩家通用无敌帧池——immuneTime 逐帧递减
 *  （UpdateImmunity :18972-18980，调用点 Update :25653）⇔ 本仓 p.iframes（Player.ts
 *  每 tick `if (this.iframes > 0) this.iframes--`），故 immune⇔iframes>0、剩余量⇔iframes。
 *  2026-08-30 R4 复核修正：旧版用"上次授予时长 lastGrant<=time"冒充剩余量比较，先授长档
 *  （如高尔夫球车 12t）再衰减至 ≤6 时对短档(6)授予被误拒——现已直用 p.iframes 当
 *  immuneTime（授予在门内等价 `immuneTime = time` 直写：gate 已保证 iframes<=time）。
 *  连击时钟由 mountJumpStomps 每帧推进（stompClock 差 ↔ _timeSinceLastImmuneGet；
 *  玩家侧碰撞攻击仅在 JumpMovement 族内使用，其它调用点——日耀盾滑行 :21349 等——
 *  仍走各自旧近似，不并入）。 */
const IMMUNE_STRIKES = new WeakMap<object, { lastClock: number; strikes: number }>();
let stompClock = 0;

function giveImmuneTimeForCollisionAttackImpl(p: { iframes?: number }, time: number): void {
  let s = IMMUNE_STRIKES.get(p);
  if (!s) { s = { lastClock: -999, strikes: 0 }; IMMUNE_STRIKES.set(p, s); }
  s.strikes = stompClock - s.lastClock <= 20 ? s.strikes + 1 : 1;
  s.lastClock = stompClock;
  if (s.strikes < 3 && (p.iframes ?? 0) <= time) {              // !immune || immuneTime<=time
    p.iframes = Math.max(p.iframes ?? 0, time);                 // immune=true; immuneTime=time
  }
}

/** ★D3 玩家侧碰撞攻击免疫统一时钟出口（GiveImmuneTimeForCollisionAttack 全调用点收敛：
 *  vanilla :20654 方法本体单座——调用点 CollideWithNPCs 核心 ：20563 / 踩踏三支
 *  :20726/:20763/:20800（本文件 sweeper 内建）/ 日耀盾滑行 :21349 / 克盾冲撞 :21277 /
 *  dash==6 冲撞 :21404（F5①）/ 盾反 buff198 支 :31667。
 *  ★F5② 勘误：旧注"tabi 冲撞 :21404"系引错——dash==1（忍者足具/黑腰带）在
 *  DashMovement 全段无 NPC 命中面（:21585-21611 纯位移+尘），:21404 实为 dash==6
 *  GiveImmune 调用行；tabi 从本清单剔除，勿再回填 */
export function grantCollisionAttackImmunity(p: { iframes?: number }, time: number): void {
  stompClock++;
  giveImmuneTimeForCollisionAttackImpl(p, time);
}

/** JumpMovement 头部踩踏段总入口（A+C 支；B 支无引擎触发源走显式入口）——
 *  Player.fixedUpdate 每 tick 调一次（vanilla :26945 移动尾无条件调 JumpMovement；
 *  ★F2/Note① 批起与 mountHorizontalCharges 同位上提到跳跃门前,清湿在踩踏【后】）。
 *  返回命中数。同时推进免疫连击时钟（见上）。 */
export function mountJumpStomps(p: {
  x: number; y: number; w: number; h: number; vx: number; vy: number;
  facing: number; iframes?: number; wetSlime?: number;
  summonDamageMult: number;
  mount: { active: boolean; type: number };
}, game: GameHooks): number {
  stompClock++;
  const st: TileStore | undefined = game.world?.store;
  let hits = 0;
  // A 支：mount.Active && IsConsideredASlimeMount && wetSlime==0 && velocity.Y>0（:20693）
  if (p.mount.active && isConsideredASlimeMount(p.mount.type) && (p.wetSlime ?? 0) === 0
    && p.vy > 0) {
    hits += stompSweep(p, game, SLIME_STOMP, st);
  }
  // C 支：mount.Active && mount.Type==17（GolfCart）&& velocity.Y>0（:20768）
  if (p.mount.active && p.mount.type === 17 && p.vy > 0) {
    hits += stompSweep(p, game, GOLF_CART_STOMP, st);
  }
  return hits;
}

/** B 支死亡细胞冲撞符文下砸（isPerformingJump_DownDash && vy>0，:20731-20765）。
 *  ★BJ534（2026-10-06）已接线：Player.fixedUpdate 踩踏段按 isDownDashing && vy>0
 *  调用（触发腿/态机/落地冲击波见 Player.ts BJ534 注）。 */
export function ramRuneDownDashStomp(p: Parameters<typeof mountJumpStomps>[0],
  game: GameHooks): number {
  if (p.vy <= 0) return 0;
  return stompSweep(p, game, RAM_RUNE_STOMP, game.world?.store);
}

// ---------------------------------------------------------------------------
// ★D1 水平侧撞族（CollideWithNPCs 四循环，1457 Player.cs:20238-20320；
//   公共核心 :20536-20577——同 GiveImmuneTimeForCollisionAttack(:20563)/
//   ApplyDamageToNPC(int 截断一次,:20548)）
// ---------------------------------------------------------------------------

/** 横向侧撞盒（:20245-20252 / :20259 等，五支同式）：
 *  rect = getRect(); direction==1 → Offset(width-1,0); Width=2; Inflate(6,12)
 *  ——朝向一侧的 14×(h+24) 竖条（贴面前沿 ±6px 容差、竖向 ±12px）。左右两个
 *  facing 各自成条 = 双面向双收。整数化：x/y 已是 int 域。 */
export function mountChargeBox(x: number, y: number, w: number, h: number,
  facing: number): Rect {
  const bx = facing === 1 ? x + (w - 1) : x;
  return { x: bx - 6, y: y - 12, w: 2 + 12, h: h + 24 };
}

/** 阈值参数面（Mount.DashSpeed/RunSpeed 生效值 getter——含 SuperCart/疲劳覆写口径，
 *  由调用方传实例值） */
interface ChargePlayerLike extends PlayerLike {
  summonDamageMult: number;
  mount: { active: boolean; type: number };
}

/** 五个水平循环的逐型差异表（对照 :20238-20320 分块顺序）：
 *  flag4 = type∈{40,41,42}（马三件）；10 独角兽 /47 山羊 与其共用阈值与源物品 */
const CHARGE_HORSE_TYPES = new Set([40, 41, 42]);

function chargeConfigs(mountType: number): Array<{
  threshold(dashSpeed: number, runSpeed: number): number;
  damage(p: ChargePlayerLike): number;
  knockback: number;
  npcImmune: number;
  playerImmune: number;
  sourceItem: number;
}> | null {
  if (mountType === 10 || mountType === 47 || CHARGE_HORSE_TYPES.has(mountType)) {
    // （:20238-20258）：threshold DashSpeed−RunSpeed/2；dmg 60（flag4→30）×minionDamage；
    // kb 10（flag4→7）；immune30/6；sourceItem=4787 全族
    const horse = CHARGE_HORSE_TYPES.has(mountType);
    return [{
      threshold: (ds, rs) => ds - rs / 2,
      damage: (p) => Math.trunc((horse ? 30 : 60) * p.summonDamageMult),
      knockback: horse ? 7 : 10,
      npcImmune: 30, playerImmune: 6, sourceItem: 4787,
    }];
  }
  if (mountType === 44) {
    // 海盗船（:20261-20275）：threshold DashSpeed−RunSpeed/4；100×minionDamage；kb12
    return [{
      threshold: (ds, rs) => ds - rs / 4,
      damage: (p) => Math.trunc(100 * p.summonDamageMult),
      knockback: 12, npcImmune: 30, playerImmune: 6, sourceItem: 4792,
    }];
  }
  if (mountType === 45) {
    // 暗影木/暗影之骑（:20277-292 蛊）：threshold DashSpeed×0.9；120×minionDamage；kb12
    return [{
      threshold: (ds) => ds * 0.9,
      damage: (p) => Math.trunc(120 * p.summonDamageMult),
      knockback: 12, npcImmune: 30, playerImmune: 6, sourceItem: 4793,
    }];
  }
  if (mountType === 14) {
    // 蜥蜴/恐龙坐骑（:20301? 实为 ：20293-20307 段）：threshold RunSpeed/2；
    // 90×minionDamage；kb10；immune30/6
    return [{
      threshold: (_ds, rs) => rs / 2,
      damage: (p) => Math.trunc(90 * p.summonDamageMult),
      knockback: 10, npcImmune: 30, playerImmune: 6, sourceItem: 3771,
    }];
  }
  if (mountType === 17) {
    // 高尔夫球车横撞（:20309-20322）：threshold RunSpeed/2；40×minionDamage；kb10；
    // immune30/**12**（GiveImmune 12 与竖轴 C 支同档）
    return [{
      threshold: (_ds, rs) => rs / 2,
      damage: (p) => Math.trunc(40 * p.summonDamageMult),
      knockback: 10, npcImmune: 30, playerImmune: 12, sourceItem: 4264,
    }];
  }
  return null;
}

/** 横向侧撞族总入口（★F2/Note① 批：Player.fixedUpdate 跳跃门位次,先于清湿/
 *  跳跃/DashMovement 面——vanilla CollideWithNPCs 五分块随 HorizontalMovement :26889
 *  跑,JumpMovement 三踩踏循环在其后。此前挂移动相尾(摔伤段后)已上提归位）。
 *  返回命中数（≤cfg 数,每 cfg 至多一个目标） */
export function mountHorizontalCharges(p: {
  x: number; y: number; w: number; h: number; vx: number; vy: number;
  facing: number; iframes?: number; wetSlime?: number;
  summonDamageMult: number;
  mount: { active: boolean; type: number; runSpeed(): number; dashSpeed: number };
}, game: GameHooks): number {
  if (!p.mount.active || !p.mount.runSpeed) return 0;
  const cfgs = chargeConfigs(p.mount.type);
  if (!cfgs) return 0;
  const runSpeed = p.mount.runSpeed();
  const dashSpeed = p.mount.dashSpeed ?? runSpeed;
  let hits = 0;
  for (const c of cfgs) {
    // 门：|velocity.X| > threshold（:20243/:20261/:20277/:20293/:20309）
    if (!(Math.abs(p.vx) > c.threshold(dashSpeed, runSpeed))) continue;
    hits += collisionAttackSweep(p as PlayerLike, game,
      { damage: c.damage, knockback: c.knockback, npcImmune: c.npcImmune,
        playerImmune: c.playerImmune },
      mountChargeBox(p.x, p.y, p.w, p.h, p.facing), game.world?.store);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// ★F5① dash==6 冲撞面（1457 Player.cs:21354-21405，DashMovement 内 dash 支四；
//   2026-08-31 蓝队二轮实装——此前头注登记"未移植"，本批补齐）
//
// 触发链（原文）：
//   DashMovement 头 `if (mount.Active && (mount.Type == 62|63|64|65)) dashType = 6`
//   （:21211-21213）；`if (dashDelay == 0) dash = dashType`（:21215-21217）；骑乘
//   CanDash 表放行双击冲刺（MountID.Sets.CanDash = {56..65}，MountID.cs:11——仓内旧
//   近似"CanDash 全假骑乘恒禁冲"对 62-65 为假阴性，触发面在 Player.ts 冲刺段；
//   ★治理批 B6②：56-61 六型也已放开——骑乘期走配饰档 dash1/2/3 原速,见
//   MOUNT_CAN_DASH_TYPES 注）。
//   就绪段 DoCommonDashHandle 分支 :21710-21731：dashing → velocity.Y==0?=-4 →
//   vx=16×dir5 → vy>0 减半 → 头部撞墙 vx/=2 → dashDelay=-1。
//   滑行段 ：21521-21527：`Math.Sign(velocity.X) != direction || dashType != 6` →
//   num17=(dashDelay)=30、vx×0.3、dashTime=0（同向继续滑行+尘/光照，未建模视觉面）。
//   阻尼档 = 基础 num13=12/num14=0.992/num16=0.96/出口 num17=20（dash6 无覆写）。
// 命中面（:21354-21405，每 tick dashDelay<0 && myPlayer）：
//   盒 = (position + velocity×0.5 −(4,4), width+8, height+8)；Width += 60 且
//   direction==-1 时 X -=60（朝向前沿 60px 带状外扩,运动前视半身投影）；门 =
//   !active/dontTakeDamage/friendly/immune[whoAmI]>0/(aiStyle112∧ai2>1)/
//   CanNPCBeHitByPlayerOrPlayerProjectile(→小动物统一出口) ；相交∧(noTileCollide∨
//   CanHit) → ApplyDamageToNPC(dmg=(150|32)×minionDamage,kb=6,kbGlove×2/kbBuff×1.5,
//   crit:false 恒字面,sourceItemId=5665 TrustyChilletWhistle 弹源记账) →
//   npc.immune[whoAmI]=20 → GiveImmuneTimeForCollisionAttack(10)。多目标【不】break。
// ---------------------------------------------------------------------------

/** MountID.Sets.CanDash（MountID.cs:11 字面 = {56..65}）：蝙蝠 56/滚轴鞋四色
 *  57-60（IsRollerSkates 集）/仙灵 61/Chillet 四型 62-65。★治理批 B6②：骑乘期
 *  双击冲刺的门面在此——56-61 走配饰档（dash1/2/3 原速），62-65 走 dash==6 冲撞；
 *  消费点 Player.ts 双击窗（:21579 门式）。dashSpeed 数值由 vanilla-mounts.json
 *  承载（提取器已含 56=4.5/57-60=7.5/61=4.5 与 sets.CanDash 全表），冲刺速度本身
 *  取装备档原值非坐骑值 */
export const MOUNT_CAN_DASH_TYPES = new Set<number>([56, 57, 58, 59, 60, 61, 62, 63, 64, 65]);
/** dashType=6 的坐骑族（Player.cs:21211-21213；62 Chillet/63 ChilletIgnis/
 *  64 TrustyChillet/65 TrustyChilletIgnis——64/65 特例伤害档 150） */
export const MOUNT_DASH6_TYPES = new Set<number>([62, 63, 64, 65]);
/** dash==6 冲撞 sourceItemId（ApplyDamageToNPC 第 7 参,仅 DPS 记账面） */
export const CHILLET_DASH_SOURCE_ITEM = 5665;

/** dash==6 冲撞盒（:21356-21364）：前视半身投影 ×4 抖动均值 −(4,4)，尺寸 ±(8,8)，
 *  宽再 +60px 朝向带；direction==-1 时整体左移 60 保持带覆盖面前 */
export function mountDash6Box(x: number, y: number, w: number, h: number,
  vx: number, vy: number, facing: number): Rect {
  const bx = Math.trunc(x + vx * 0.5 - 4) - 0;
  const by = Math.trunc(y + vy * 0.5 - 4);
  let rx = bx;
  if (facing === -1) rx -= 60;                    // direction==-1 → X -= num9
  return { x: rx, y: by, w: w + 8 + 60, h: h + 8 };
}

/** dash==6 冲撞命中扫掠（滑行期每 tick 一次；调用方保证 dashDelay<0 ∧ myPlayer 语
 *  境）。返回命中数。flag=mount.Type∈{64,65} → 150 否则 32（:21355/:21391）。 */
export function chilletDashCharge(
  p: Parameters<typeof mountJumpStomps>[0] & { equipStats?: { kbGlove?: boolean } },
  game: GameHooks,
  titanKbBuff: boolean,
): number {
  if (!p.mount.active || !MOUNT_DASH6_TYPES.has(p.mount.type)) return 0;
  const box = mountDash6Box(p.x, p.y, p.w, p.h, p.vx, p.vy, p.facing);
  const bonus150 = p.mount.type === 64 || p.mount.type === 65;
  const st: TileStore | undefined = game.world?.store;
  let hits = 0;
  for (const ent of npcHitTargets(game)) {
    const e = ent as unknown as StompTarget2;
    if (!e || e.dead || e.dontTakeDamage) continue;
    // AI_112 仙灵免疫门（:21368 `nPC.aiStyle == 112 && !(nPC.ai[2] <= 1f)` → continue）：
    // ★治理批 B6③（2026-08-31）由哨兵注释升级为落地实装——该支【现役可达】：本仓
    // 仙灵 583/584/585 走 Enemy.fairyAI（AI_112_FairyCritter cs:48605 移植,ai[2] 即
    // 状态载体,虫网释放 ReleaseNPC 进态 2 → 宝箱引导链 3-7 在册）。SetDefaults
    // （NPC.cs:16608 `type == 583 || type == 584 || type == 585`）下 aiStyle=112 全集
    // 恰为仙灵三型,故按 vanillaId 判定与原式等价；ai[2] ≤ 1（漂游/逃逸两引导前态）
    // 照常可被打。同一门在 ：21275（dash==2 克盾）/ solar / 本支三处 dash 命中面
    // 出现——Player.ts 克盾冲撞(:3953)与日曜冲撞(:4099)两循环属战斗缝合面归属
    // 另线,本批不触碰,残余缺门已挂账（见批记 leftover）。
    const es = e as unknown as { vanillaId?: number; ai2?: number };
    if ((es.vanillaId === 583 || es.vanillaId === 584 || es.vanillaId === 585)
      && (es.ai2 ?? 0) > 1) continue;
    if (!canMountHitTarget(game, e, ent)) continue;
    if (!_playerCanHitEnemy(e, game)) continue;
    if (e.iframes !== undefined && e.iframes !== 0) continue;      // immune[whoAmI]>0
    if (!(box.x < e.x + e.w && box.x + box.w > e.x && box.y < e.y + e.h && box.y + box.h > e.y)) continue;
    if (!(e.noTileCollide || (st ? canHit(st, p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h) : true))) continue;
    const dmg = Math.trunc((bonus150 ? 150 : 32) * p.summonDamageMult);   // float→(int)
    let kbx = 6;
    if ((p as unknown as { equipStats?: { kbGlove?: boolean } }).equipStats?.kbGlove) kbx *= 2;   // :21393-21395
    if (titanKbBuff) kbx *= 1.5;                                   // kbBuff 泰坦（:21396-21398）
    let dir = p.facing;
    if (p.vx < 0) dir = -1;
    else if (p.vx > 0) dir = 1;
    e.hurt(applyBannerDamageDealt(game, e, dmg), dir * kbx, 0, game, playerArmorPenOf(game), false, 0, true);   // crit:false 字面(:21402);★F1 ApplyDamageToNPC :20599 旗乘区
    e.iframes = 20;                                                // nPC.immune[whoAmI]=20（:21403）
    (game as unknown as { noteNpcPlayerImmune?: (id: number, t: number) => void })
      .noteNpcPlayerImmune?.((e as unknown as { id?: number }).id ?? -1, 20);
    grantCollisionAttackImmunity(p, 10);                           // GiveImmuneTimeForCollisionAttack(10)（:21404）
    hits++;                                                        // ★无 break：逐帧全目标结算
  }
  return hits;
}

/** 玩家 GetArmorPenetration(melee:false) 的仓内唯一桶（equipStats.armorPen——
 *  vanilla 双字段 armorPenetration/meleeArmorPenetration 中 melee:false 只取前者） */
export function playerArmorPenOf(game: GameHooks): number {
  return ((game.player as unknown as { equipStats?: { armorPen?: number } } | null)
    ?.equipStats?.armorPen ?? 0);
}

// ---------------------------------------------------------------------------
// wetSlime（史莱姆坐骑液体态，1457 :28160-28207 / 1456 :27653-27689）
// ---------------------------------------------------------------------------

/** 史莱姆坐骑液体态滴答：wetSlime--（:28173-28175）；浸液（原版 wet 不分液体种类）
 *  且骑史莱姆族时 wetSlime=30 + 浮力档（:28195-28207：vy>2 ×0.9 缓降、vy-=0.5
 *  浮升、vy<-4 钳回 —— 从史莱姆座上入水会缓缓下沉不被冻住）。
 *  ★SW-RB20a F6③（2026-09-15）：探针基面由 inWater∪inLava∪inHoney 三桶并集 →
 *  wetSticky（≙ vanilla wet 粘滞位,Player.cs:28192 `if (wet)`——原版该读点在
 *  :28060/:28073 分支【后】,wet 已被本拍 num86 刷新≡num86;本仓调用位 Player.ts
 *  湿流程后,wetSticky 后值≡wetNow 同构）。三桶并集混入全盒 LavaCollision 幻影
 *  =BJ89 定谳家族（探针干+全盒岩浆擦过时原版 wet 假→坐骑不入浮力档,并集真→幻影档）。
 *  ★C5-B1（2026-10-06）补 wet switch 下坐臂（Player.cs:28177-28207）：
 *    ① :28181-28185 `dripping && mount.Type==56` → TryDismount——Wet(103) buff 位
 *      【wet 外门】（上岸残湿期坐可爱飞鱼照样逼下）;② :28188-28191 wet switch
 *      `case 5/7/56`（蜜蜂/飞碟/可爱飞鱼）→ TryDismount（不落 wetSlime 档）。
 *    返回 true = 原版本拍会调 Mount.TryDismount；执行（空间门+伴生 buff 清偿+
 *    petting 终止,同 :5389 冻结下坐惯例）在调用方 Player.ts 湿流程——本函数保持
 *    纯查询面（无 buffs/dismount 视图;dripping=Wet(103) buff 位由调用方显式传入,
 *    Player 无实例级 dripping 字段——buffs.has(BuffType.Wet) 直读）。重复判定幂等
 *    （dripping×56 湿拍两臂同真 ≡ 原版 TryDismount 调两次,第二次 CanDismount 空转）。 */
export function tickSlimeWetState(p: {
  wetSticky?: boolean; vy: number; wetSlime?: number;
  mount: { active: boolean; type: number };
}, dripping = false): boolean {
  if ((p.wetSlime ?? 0) > 0) p.wetSlime = (p.wetSlime ?? 0) - 1;   // :28173-28175
  if (!p.mount.active) return false;
  let dismount = false;
  if (dripping && p.mount.type === 56) dismount = true;            // ★C5-B1 :28181-28185
  if (!p.wetSticky) return dismount;
  if (p.mount.type === 5 || p.mount.type === 7 || p.mount.type === 56) {
    return true;                                                   // ★C5-B1 :28188-28191
  }
  if (!isConsideredASlimeMount(p.mount.type)) return dismount;
  p.wetSlime = 30;                                                // :28196-28197
  if (p.vy > 2) p.vy *= 0.9;                                      // :28198-28200
  p.vy -= 0.5;                                                    // :28202
  if (p.vy < -4) p.vy = -4;                                       // :28203-28205
  return dismount;
}

/** JumpMovement controlJump 头部的湿清除（1457 :20805-20818——门 :20815-20817 /
 *  1456 :20366-20379）：按住跳键瞬间清湿史莱姆（wetSlime=0 + flag 让后续起跳门放行
 *  水下起跳）。★无液体位置要求——gate 只读 mount.Active/IsConsideredASlimeMount/
 *  wetSlime，controlJump 块内直接置 0：陆上残余同样按跳即清（2026-08-30 R3 复核修正，
 *  调用方不得把本消费点嵌进水中分支）。返回 true = 本帧有清湿发生。 */
export function consumeWetSlimeOnJumpControl(p: {
  inputJump?: boolean; wetSlime?: number;
  mount: { active: boolean; type: number };
}): boolean {
  if (p.inputJump && p.mount.active && isConsideredASlimeMount(p.mount.type)
    && (p.wetSlime ?? 0) > 0) {
    p.wetSlime = 0;
    return true;
  }
  return false;
}
