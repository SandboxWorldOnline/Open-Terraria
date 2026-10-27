// 弹幕命中目标:怪物桶之外还有小动物桶(critters)。
// 原版小动物是 NPC(NPCID.Squirrel 等),任何伤害即死——近战挥砍已覆盖
// (Game 挥砍段"小动物:任何挥击一击致死"),弹幕此前漏判,箭射松鼠无效果。
import type { GameHooks } from './types';
import { BuffType, buffTypeByVanilla, type BuffState } from '../stats/Buffs';
import { projectileData } from '../data/vanillaProjectiles';
import { hostileProjectileDamage, mainDifficulty, mainExpertMode, damageVar } from '../stats/ScaleStats';
import { bannerReceivedMult, bannerOfNpc, bannerItemId } from '../world/Banners';
import { projGlobalImmuneWriteTicks, PROJ_IMMUNE_SLOW_MAGIC_TIER } from '../data/vanillaProjImmuneTiers';
import { projImmuneFaceOf } from '../data/vanillaProjImmuneFaces';
import { petSlimeHitVoice } from '../data/vanillaNpcAmbience';
import { NPC_CATCHABLE } from '../data/critters';   // ★BJ704-R9 P1-2:npcCatchable 集（Main.cs:9469+）——friendly 投影分档判据
import statusPlayerJson from '../data/vanilla-statusplayer.json';
import {
  getGlobalHurtBuckets, ImmunityCooldownID,
} from '../player/HurtCooldownBuckets';
import { getProjScanCtx } from './projScanCtx';
import { runModModifyHitNpcByProj, runModModifyHitPlayerByProj } from '../mods/hooks';   // ★刀4-A:弹命中修正链两族
import { snapshotVanillaGate, vanillaGateRejected } from './SpectreSoulProj';   // ★清偿刀 P1 门位快照单源（C5 定谳#3——ESM 函数声明环安全:两侧均仅运行时调用）
import { rollVanillaHitCrit } from './proj1457';   // ★BJ488① critter 面三类掷（:12915-12927）——proj1457 彼侧 import 本模块（hitCritters 族）=函数声明环,两侧均运行时调用（P1 同习语）

/** ★IIIII248 弹幕命中扫描 equip 取用面（projScanCtx.ts 头注全证明）：
 *  projectiles 桶步进窗内 = tick 级快照（六布尔字段与 equipStats 同名同义）;
 *  窗外/单测/探针 = null ⇒ 回退逐次活读（行为与旧路径逐位相同）。 */
function projScanEq(game: GameHooks): { killGuide?: boolean; killClothier?: boolean;
  dontHurtCritters?: boolean; accPyroclast?: boolean; accSnappingStone?: boolean;
  accGolemSentryBackpack?: boolean } | undefined {
  return getProjScanCtx(game.player)
    ?? (game.player as unknown as { equipStats?: { killGuide?: boolean; killClothier?: boolean;
      dontHurtCritters?: boolean; accPyroclast?: boolean; accSnappingStone?: boolean;
      accGolemSentryBackpack?: boolean } } | null)?.equipStats;
}

export interface CritterLike {
  x: number; y: number; w: number; h: number;
  dead: boolean;
  /** 小动物受击:一击致死,返回是否生效(iframes 内 false)。
   *  ★SW-RB10d：实际实体=Enemy.hurt 全参（dmg/kbx/kby/game/armorPen/crit/pierce/
   *  fromPlayer）；单参 (game) 形=兼容旧 shim 调用点（Game 怪物碾压/Dart 陷阱）,
   *  经 Enemy.hurt 头部 object 重映射=dmg5/fromPlayer=false。 */
  hurt(game: GameHooks): boolean;
}

/** 弹幕与实体 AABB 重叠 */
export function projOverlap(ax: number, ay: number, aw: number, ah: number, e: { x: number; y: number; w: number; h: number }): boolean {
  return ax < e.x + e.w && ax + aw > e.x && ay < e.y + e.h && ay + ah > e.y;
}

/** ★清偿刀 Y2（2026-10-02）城镇命中逐靶结算面（hitTownNpcs settle 参载荷）——
 *  全字段可选;未提供的字段保持通道缺省（dmg=入参/penPercent=0/flatPen=0/crit=false/
 *  kb=自动方位 ×2）。 */
export interface TownHitSettle {
  dmg?: number;
  penPercent?: number;
  flatPen?: number;
  crit?: boolean;
  kb?: number;
}

/** 命中小动物:一击致死。返回是否命中(调用方按各自语义消耗穿透/销毁弹体) */
/** 城镇 NPC 受击判定(玩家弹幕/敌怪弹幕共用)。门禁照原版两分支:
 *  - 'playerProj'(friendly 弹):Projectile.Damage_PVE_Inner :11970-11976 巫毒窄门——
 *    仅向导 22(装备向导巫毒娃娃 267→player.killGuide)/裁缝师 54(裁缝娃 1307→
 *    killClothier)可被玩家弹幕/近战伤害;其余城镇 NPC 玩家武器一律无效
 *  - 'hostile'(敌怪弹/陷阱弹):原版 flag2 分支(hostile && victim.friendly)恒命中
 *  TownNPC.hurt 自带 8t 无敌帧去重;kbx=0 时按相对方位自动击退方向。 */
export function hitTownNpcs(
  self: { x: number; y: number; w: number; h: number },
  game: GameHooks,
  dmg: number,
  kbx = 0,
  source: 'playerProj' | 'hostile' = 'playerProj',
  projId = 0,
  /** 同 hitPlayer 的 Colliding 自定义判定通道（2026-08-31 双件批）——缺省 AABB */
  collide?: (n: { x: number; y: number; w: number; h: number }) => boolean,
  /** 击杀归因（NPCKillAttempt 语义——Projectile.cs:13702-13706 `attempt.DidNPCDie()`
   *  → Main.player[owner].OnKillNPC(ref attempt, this)）。本次 hurt 落地且该 NPC
   *  当场死亡（hurt 内 hp≤0 → dead=true 同步置位）时回调,消费端 = 墓碑弹杀镇民
   *  成就 36 GRAVE_MISTAKE（Player.OnKillNPC Player.cs:20623-20636） */
  onKill?: (n: { vanillaId?: number }) => void,
  /** ★清偿刀 W1（2026-10-01）S3b 姊妹刀——城镇侧鞭面两通道：
   *  ①skip = 命中前局部表门（Damage_PVE :12596 flag2 的 usesLocal 臂
   *    `array[i]==0` 等价——鞭 localNPCImmunity[victim]=-1 写后整挥每靶一次;
   *    城镇靶同面, whip 侧以 hitSet 承载）。门拒 = 整靶跳过（:12598 flag2 假）。
   *  ②onAccept = 受理拍回调（写梯位,:14031-14179 与 :14263/:14321-14327 家族——
   *    原文序 OnKillNPC :13703-06 之后）。城镇 NPC 受理面与敌怪同构：
   *    免疫窗写/局部表占位/tag/minionTarget/衰减/numHits 全在门后;调用方
   *    （WhipProj W1）在此做写梯对齐,TownNPC.hurt 通用档 iframes=10 不动
   *    （= 原版弹幕通用尾档 :14197-14199,非鞭弹照写）。 */
  skip?: (n: { id: number; vanillaId?: number }) => boolean,
  onAccept?: (n: { id: number; iframes?: number; vanillaId?: number }) => void,
  /** ★清偿刀 Y2（2026-10-02）逐靶结算扩展（X1 登记债「城镇命中 flat 穿甲/banner
   *  乘区未透传」清偿）——Damage_PVE_Inner 对城镇靶【同链同面】:banner :13387-13391
   *  （ownedBySomeone→GetBannerBuffEffect 乘区）/穿甲 :13686-87（ownedBySomeone &&
   *  !hostile → dmg += checkArmorPenetration(num6, pct)）均不因 friendly/townNPC
   *  短路。返回 {dmg?, penPercent?, flatPen?, crit?, kb?} 覆盖对应入参（逐靶依赖
   *  tag 态/靶位的随从环用;dmg 提供时覆盖 dmg 入参——banner 在通道内统一施加,
   *  调用方勿预套。crit 语义 = TownNPC.hurt 防后双精度 ×2（NPC.cs:82067 原序）,
   *  与 Enemy.hurt「调用侧预倍+参仅染色」约定不同——传 crit=true 时 dmg 勿预倍）。
   *  调用位 = 巫毒窄门后/hurt 前（vanilla flag(:12631)→…→:12947 ModifyHit→StrikeNPC
   *  同位;settle 内的 tag 结算含 OnHit 消费副作用=敌怪环既有同形,见 resolveWhipTagHit）。 */
  settle?: (n: { id: number; vanillaId?: number }) => TownHitSettle,
): boolean {
  const list = (game as unknown as { npcs?: () => unknown[] }).npcs?.() ?? [];
  // player 可为 null(测试 fakeHooks/导入早期帧)——加空守卫
  // ★IIIII248:projScanEq = 桶窗快照 ?? 旧活读(语义面不变)
  const eq = projScanEq(game);
  let any = false;
  for (const ent of list) {
    const n = ent as {
      x: number; y: number; w: number; h: number; dead: boolean;
      hurt: (d: number, kx: number, ky: number, g: GameHooks,
        penPercent?: number, flatPen?: number, crit?: boolean, force?: boolean,
        fromPlayer?: boolean, srcProjId?: number) => boolean;
      bound?: boolean; vanillaId?: number; id: number; iframes?: number;
    };
    if (n.dead || typeof n.hurt !== 'function') continue;
    if (n.bound) continue; // 被缚待救不可打(近似;原版 bound 型有独立受击语义)
    // ★W1：局部表门（:12596 flag2 usesLocal 臂 `array[i]==0`）——鞭 hitSet 占位靶
    //   整挥每靶一次,城镇靶同面;门拒在巫毒窄门/AABB 之前 = 原版 :12598 flag2 假
    //   整靶跳过序（Damage_PVE 循环头门先于 Inner 全链）
    if (skip?.(n)) continue;
    if (!(collide ? collide(n) : projOverlap(self.x, self.y, self.w, self.h, n))) continue;
    if (source === 'playerProj') {
      // 巫毒窄门(:11970-11972):22→killGuide / 54→killClothier,其余 false;
      // ★臭鸡蛋 318 无条件例外（:11971 `flag |= type == 318`——整蛊蛋专属,
      //  全游戏唯一可无条件砸 friendly NPC 的玩家弹）
      const vid = n.vanillaId ?? -1;
      const doll = vid === 22 ? eq?.killGuide : vid === 54 ? eq?.killClothier : false;
      if (!doll && projId !== 318) continue;
    }
    const kb = kbx !== 0 ? kbx : Math.sign(n.x + n.w / 2 - (self.x + self.w / 2)) * 2 || 1;
    // ★清偿刀 Y2：逐靶结算（巫毒窄门后/hurt 前=vanilla :12947 ModifyHit 位）——
    //   banner 攻端乘区 :13387-13391 于通道内统一施加（playerProj 面=ownedBySomeone 档;
    //   hostile 弹 owner=255 无此面）。城镇 NPC 无 banner 档（BannerSystem 无城镇族键）
    //   → applyBannerDamageDealt 结构恒等值,面位照原版占位（判据经 bannerOfNpc 空档早退）。
    const st = settle?.(n);
    // ★刀4-A(2026-10-13):弹命中城镇 NPC 伤害修正链(ModifyHitNPCWithProj 同面;
    //  位=settle 后/banner 前;空 mod=恒等。crit 语义注意:TownNPC.hurt 防后 ×2
    //  (:82067),此处 dmg 为未预倍基伤,ctx.crit 仅透传)。
    //  ★红队 R1-F5:免疫窗靶(TownNPC.hurt 体内门 :1451 iframes>0||shimmerRise
    //  拒收)不发钩=受理位对齐,防幻影
    const rawDmg0 = st?.dmg ?? dmg;
    const rawDmg = source === 'playerProj' && !((n.iframes ?? 0) > 0)
      ? runModModifyHitNpcByProj(game.player, game, projId, n.vanillaId ?? -1, rawDmg0, st?.crit ?? false)
      : rawDmg0;
    const outDmg = source === 'playerProj' ? applyBannerDamageDealt(game, n, rawDmg) : rawDmg;
    // ★BJ395（2026-09-28,BJ393 同族债五处清偿⑤）锚备案【原版同相,不落刀】：本站
    //   消费对象=TownNPC.hurt（非 Enemy.hurt）——其返值契约=受理（TownNPC.ts:1535
    //   单一受理返真点,普通命中与击杀同点;返假仅门拒两族 dead :1404/帧窗∧微光上升
    //   :1407）,不存在 Enemy.hurt 的「普通未致命命中尾档返假 :15037/血尽级联返假
    //   :14369 族」→ 布尔在此【就是】受理谓词,hurtOk 消费=原版同相（BJ393 五处
    //   清单唯一备案站）。消费面对照：any=受理聚合（调用方 pierce 经济,原版
    //   penetrate-- :14189-14196 在 Damage_PVE_Inner 受理面同理）;
    //   onKill 由 n.dead 复核=DidNPCDie()（Projectile.cs:13703）非受理面,同相。
    // ★清偿刀 X1（2026-10-01）face 2 管线位：fromPlayer（source==='playerProj' ≈
    //   Damage_PVE_Inner :13640 ownedBySomeone 臂——hostile 弹 owner=255 走不到
    //   TryDoingOnHitEffects）+ srcProjId（TryDoingOnHitEffects :15210-15220 来源
    //   排除表 {221,227,614,729,908,977}）透传 TownNPC.hurt 第 9/10 参。
    //   ★Y2：penPercent/flatPen/crit/kb 经 settle 逐靶透传（:13686-87 穿甲/crit
    //   :82067 对城镇靶同面）;缺省 0/0/false = X1 旧形态（W1 鞭面零回退,仅 banner
    //   新增=:13387-91 面位）。
    if (n.hurt(outDmg, st?.kb ?? kb, 0, game, st?.penPercent ?? 0, st?.flatPen ?? 0,
      st?.crit ?? false, false, source === 'playerProj', projId)) {
      if (onKill && n.dead) onKill(n);   // DidNPCDie() → OnKillNPC（见上注）
      // ★W1：受理拍回调 = 写梯位（:14031-14179 immune[owner]=0+局部表/:14263
      //   numHits/:14321-14327 minionTarget——原文序在 OnKillNPC 之后,同拍序保持）
      onAccept?.(n);
      any = true;
    }
  }
  return any;
}

/** ★BJ727-A（C-D4 族刀,2026-10-27）：Kill 爆 AoE 城镇臂单源（盒几何投影）。
 *  原版 Projectile.Kill 的 Resize(N×N)+penetrate=-1+Damage() 重跑（41/246/312/514/
 *  617/659/661/1023/79·16·34/167-170/281·162/1044/930 等）victim 循环 = Main.maxNPCs
 *  全表（:12592），城镇 voodoo 靶（Damage_PVE_Inner :12618-12631 flag 门=22 killGuide/
 *  54 killClothier/318）同链同掷（DV :12970/crit :12915-27/banner :13388）;本仓 Kill
 *  爆箱族此前只扫 enemies 桶 = 城镇靶系统性缺面（BJ723-C D4 族登记,BJ725-A 判族另刀）。
 *  形制 = hitTownNpcs 原语 + 盒心/半宽参数翻译：self = (cx−half, cy−half, 2half, 2half)
 *  居中方盒，缺省 AABB collide 与中心距 < half+半宽数学恒等（explodeAt 城镇臂
 *  `Math.abs(tn.cx−cx) < hb+tn.w/2` 同式）。巫毒窄门/TownNPC.hurt 8t 无敌帧/mod 修正
 *  链/banner/防后 crit ×2（:82067）全走原语既有链。settle 逐靶镜像各面【敌怪臂】
 *  （DV/crit/kb/penPercent——面内一致优先,敌怪臂缺 DV/crit 的面见 BJ727-A 登记债,
 *  勿在此单侧补齐）。返回受理布尔（Kill 重跑 penetrate=-1 无穿透经济,消费方仅日志）。 */
export function hitTownNpcsAoeBox(
  cx: number, cy: number, half: number,
  game: GameHooks, dmg: number, projId: number,
  source: 'playerProj' | 'hostile' = 'playerProj',
  settle?: (n: { id: number; vanillaId?: number }) => TownHitSettle,
): boolean {
  return hitTownNpcs(
    { x: cx - half, y: cy - half, w: half * 2, h: half * 2 },
    game, dmg, 0, source, projId,
    undefined, undefined, undefined, undefined, settle,
  );
}

/** ★清偿刀 Y2（2026-10-02）巫毒窄门谓词（hitTownNpcs 内部门的调用方可读形）——
 *  Damage_PVE_Inner :12618-12625 flag 臂 1:1：`type==22 && owner<255 && killGuide`
 *  （向导）/ `type==54 && … && killClothier`（裁缝师）/ 318 臭鸡蛋无条件例外（:12619）。
 *  MinionProj 城镇环 skip 门先置位用：vanilla 门序 = flag(:12620-12631) 先于
 *  immune[owner](:12636)——窄门先闭可防「无 doll 探针」污染随从接触冷却私表
 *  （读源 = projScanEq 桶窗快照 ?? equipStats 活读,与 hitTownNpcs 内部门同源）。 */
export function townVoodooGateOpen(
  game: GameHooks,
  vanillaId: number | null | undefined,
  projId: number,
): boolean {
  if (projId === 318) return true;
  const vid = vanillaId ?? -1;
  const eq = projScanEq(game);
  return vid === 22 ? eq?.killGuide === true
    : vid === 54 ? eq?.killClothier === true : false;
}

// ================= ★α-H1/H3 projClass 类别通道（终局扫尾·战斗缝合批） =================
// 数据面唯一标杆 = 原版 SetDefaults 逐弹型直写的 Projectile.melee/magic/ranged/minion
// 字段（Terarria1457/Terraria/Projectile.cs）——投影到四类：melee/ranged/magic/summon。
// 消费面（Projectile.Damage :12898 起）：①crit 轮**按类各掷各的**——`if (melee &&
// Next(1,101)<=owner.meleeCrit)` 三连，**SetDefaults 无类别旗且 spawn 位未覆写的弹
// 不掷 crit**（★Z-F1 勘误，2026-08-31：蜂 181/566 在 SetDefaults 确实零旗，但原版
// 发蜂位在 NewProjectile 后显式 `.melee=true`（Player.cs:43977/:44479/:44873 +
// Projectile.cs:13759）→ 运行时近战弹照掷；仓内对应 = Arrow.projClass 实例字段，
// 本数据查表仍保持 SetDefaults 直写真值）；②浸剂族门 `(melee||IsAWhip)`
// （Projectile.StatusNPC :11197 / nano·confetti :13687）；③parryDamageBuff ×5 门
// `melee && !DontApplyParryDamageBuff[type]`。summon 类不参与 crit 掷。

export type ProjClass = 'melee' | 'ranged' | 'magic' | 'summon';

/** 弹 id → 类别通道（projectileData 类旗投影；缺数据/无类 → null）。实体侧显式
 *  projClass 字段优先于本表（resolveProjClass），本函数是纯数据面查表。 */
export function projClassOfProjId(projId: number | undefined | null): ProjClass | null {
  if (!projId || projId <= 0) return null;
  const pd = projectileData(projId);
  if (!pd) return null;
  // 投影序 = 原版三连掷书写序（melee → ranged → magic；minion 即 summon）
  if (pd.minion === true) return 'summon';
  if (pd.melee === true) return 'melee';
  if (pd.ranged === true) return 'ranged';
  if (pd.magic === true) return 'magic';
  return null;
}

/** 实体侧统一解析：显式 projClass（个别无 projId 的自研弹声明面）→ 弹 id 数据面
 *  → 旧 meleeProj 旗兜底（历史类字段,新代码勿再散写）。 */
export function resolveProjClass(
  p: { projClass?: ProjClass; projId?: number; meleeProj?: boolean } | null | undefined,
): ProjClass | null {
  if (!p) return null;
  if (p.projClass) return p.projClass;
  const byId = projClassOfProjId(p.projId);
  if (byId) return byId;
  return p.meleeProj === true ? 'melee' : null;
}

// ================= ★焰爆石 6178 / 拍击石 6167 弹幕侧触发门（单源，2026-08-31） =================
// 唯一标杆：Projectile.Damage_PVE_Inner（Terarria1457/Terraria/Projectile.cs:13439-13446）
// 两连支共用的节拍门骨架。消费位分工（F3 接线台账见 stats/SnapStrike.ts 头注）：
//   · kind1 焰爆石 6178 = pyroclastProjectileGate
//     （:13439-42 `((melee||ranged) & ownedBySomeone) && accPyroclast`）；
//   · kind0 拍击石 6167 = snappingStoneProjectileGate
//     （:13443-45 `(ranged & ownedBySomeone) && accSnappingStone`——★蓝队四轮 F2/F3：
//      原 Arrow.dealContacts 内联手搓口径撤销收编本单源,与 kind1 同骨架同门序）；
//   · kind2 毁灭臂镗 6179（:13447-50 tag 面 changes.AddProjectileTagDamage）
//     已接 WhipTag.resolveWhipTagHit。
// 门序本仓单源三段：
//   ①ownedBySomeone ≈ !hostile（hostile 弹 owner≠本地玩家/Damage_PVE 整段拦截 :11902-05）
//   ②类位——走 resolveProjClass 单源（显式 projClass 字段 → 弹 id SetDefaults 类旗
//     投影 → meleeProj 兜底），禁止散抄 projectileData 表；
//   ③饰品在身（equipStats 聚合 Player.ts:1442 段）。
// 冷却/去重 = Player.accSnappingStoneCooldown 360t（:14382-83）三 kind 共用、由
// stats/SnapStrike.trySnapStrike 在扫描前先置——同帧多弹连击被冷却门天然去重，
// 与原版 Damage() 每次有效命中的节拍一致。
/** 门共用骨架：hostile ∪ 类位（melee|ranged 或纯 ranged）∪ 饰品读面 */
function snapStoneFamilyGate(
  game: GameHooks,
  proj: { hostile?: boolean; projClass?: ProjClass; projId?: number;
    meleeProj?: boolean } | null | undefined,
  classes: readonly ProjClass[],
  accessoryKey: 'accPyroclast' | 'accSnappingStone',
): boolean {
  if (!proj || proj.hostile === true) return false;           // ownedBySomeone 档
  const cls = resolveProjClass(proj);
  if (!classes.includes(cls as ProjClass)) return false;      // 类位门
  return ((projScanEq(game) as Record<string, boolean> | undefined)?.[accessoryKey]) === true;
}

export function pyroclastProjectileGate(
  game: GameHooks,
  proj: { hostile?: boolean; projClass?: ProjClass; projId?: number;
    meleeProj?: boolean } | null | undefined,
): boolean {
  return snapStoneFamilyGate(game, proj, ['melee', 'ranged'], 'accPyroclast');
}

/** ★kind0 拍击石 6167 门（Projectile.Damage_PVE_Inner :13443-13445）——纯 ranged 位
 *  （melee 弹过不了此门,kind0 的 30×远程伤只吃远程弹触发）；随从/哨兵/魔法弹自然排除。 */
export function snappingStoneProjectileGate(
  game: GameHooks,
  proj: { hostile?: boolean; projClass?: ProjClass; projId?: number;
    meleeProj?: boolean } | null | undefined,
): boolean {
  return snapStoneFamilyGate(game, proj, ['ranged'], 'accSnappingStone');
}

/** ProjectileID.Sets.IsAWhip（Terarria1457/Terraria.ID/ProjectileID.cs:35 全 18 型，
 *  一行全量含 1104 火鞭——tests/whip-set-alignment.test.ts 钉长度防漂移）：
 *  浸剂/nano/confetti 门的 whip 并集臂（`melee||IsAWhip[type]`,:11197/:13687）。 */
export const IS_A_WHIP_PROJS: ReadonlySet<number> = new Set(
  [847, 841, 848, 849, 912, 913, 914, 915, 952, 1028, 1029, 1030, 1031, 1032, 1033, 1034, 1035, 1104]);

/** ProjectileID.Sets.DontApplyParryDamageBuff（ProjectileID.cs:23）：盾反 ×5 排除族
 *  （Bladetongue 血舌 524 / 血 butcherer 标枪 321 / 蜂两型 181·566——buff 链自带
 *  proc 的弹不吃盾反乘区）。 */
export const DONT_APPLY_PARRY_DAMAGE_BUFF_PROJS: ReadonlySet<number> = new Set([524, 321, 181, 566]);

/** ProjectileID.Sets.MinionShot（ProjectileID.cs MinionShot = Factory.CreateBoolSet
 *  行全 12 型）：随从弹家族。Player.CanNPCBeHitByPlayerOrPlayerProjectile :20675 的
 *  flag 组装位 `projectile.minion || MinionShot[type] || sentry || SentryShot[type]`
 *  ——hitCritters gate 接本表（ζ#3/#4 出口收口：即便当前无可达路径也建表防未来陷阱）。 */
export const MINION_SHOT_PROJS: ReadonlySet<number> = new Set(
  [374, 376, 389, 195, 408, 433, 614, 818, 1044, 1097, 1106, 1120]);

/** ProjectileID.Sets.SentryShot（同文件相邻行全 14 型）：哨兵弹家族。语义同上。 */
export const SENTRY_SHOT_PROJS: ReadonlySet<number> = new Set(
  [680, 664, 666, 668, 694, 695, 696, 644, 642, 378, 379, 309, 967, 1026]);

/** 圣殿骑士哨兵背包 6176 强制暴击掷（Projectile.cs:12962-12965 1:1，2026-09-03
 *  哨兵携带批收口）：
 *  `if (ownedBySomeone && (sentry || (type >= 0 && ProjectileID.Sets.SentryShot[type]))
 *  && Main.player[owner].accGolemSentryBackpack && Main.rand.Next(10) == 0) crit = true;`
 *  ——Damage_PVE 每次命中掷一遍,先于伤害结算（ whip tag 暴击修正之后,仍可强制）。
 *  isSentry = 弹本体 sentry 位（MinionProj 塔/光环场伤直伤面）;飞弹（塔射出弹）传
 *  projId 走 SENTRY_SHOT_PROJS 表。原版 1130 暴击豁免支（:12966-12968）紧随其后
 *  ——本仓无 1130 伤害面,不设。 */
export function rollGolemSentryCrit(
  game: GameHooks,
  projId: number,
  isSentry: boolean,
): boolean {
  if (!isSentry && !SENTRY_SHOT_PROJS.has(projId)) return false;
  // ★IIIII248:projScanEq = 桶窗快照 ?? 旧活读(语义面不变)
  if (!projScanEq(game)?.accGolemSentryBackpack) return false;
  return Math.floor(Math.random() * 10) === 0;   // Main.rand.Next(10) == 0
}

// ---- ★A-F1 OnHit 来源排除表（蓝队三批，2026-08-31） ----------------------------
// Projectile.TryDoingOnHitEffects（Terarria1457/Terraria/Projectile.cs:15210-15220）：
//   `switch (type) { case 221: case 227: case 614: case 729: case 908: case 977: return; }`
// ——六型弹命中【不触发】Player.OnHit 族效果（钛金风暴自续/影闪 buff59 等全被
// 断链：这批弹本身就是 on-hit 效果产出的伴生弹）。消费点 = Enemy.hurt 钛金 proc 门
// （srcProjId 尾参携带），单测两案在 blue-r2-redteam2 套。
export const ON_HIT_EXCLUDED_PROJS: ReadonlySet<number> = new Set([221, 227, 614, 729, 908, 977]);

// ---- ★F1 攻端旗乘区单源（蓝队三批，2026-08-31） -------------------------------
// ★R2-07(a) ItemID.BannerEffect.DamageDealt 攻端乘区采样
// （Terarria1457/Terraria.ID/ItemID.cs:11-40 BannerEffect 构造 + ItemID.cs:1072
// BannerStrength 表 + GameDifficultyData.LinearCurve.Sample）：
// · 普通旗 strength=1f → keys{Classic(1):1.5, Expert(2):2.0}；
// · DD2 族 itemId 3837-3846 → BannerStrength=BannerEffect(0.2f) → keys{1.1,1.2}；
// · Sample(Main.Difficulty) = 分段线性 + 【双端钳界】（★BJ716-A 2026-10-25 勘误：
//   越尾时循环尾 key←key2=末键 → num=0 早退返末键值，【非】同斜率外推——旧头注
//   「越尾键同斜率外推」系误读（GameDifficultyData.cs:35-55 循环体逐行定谳，
//   R15 判例1「读 LinearCurve.Sample 看 key=key2 末态」；ScaleStats.sampleCurve
//   单源本就钳界=多副本漂移，BJ712-B 判例1 同族）。大师(3)/传奇(4) 恒 ×2.0/
//   DD2 ×1.2（旧外推式 2.5/1.3 = 大师每击 +25% 过量）；旅程 0.5 ≤ 首键 → 取
//   首键值。闭合式：x≤1 取 k1；x≥2 取 k2；段内 k1+(difficulty−1)·(k2−k1)。
// （原 Game.ts 局部实现整体迁入本模块——applyBannerDamageDealt 单源消费，F1 收口）
export function bannerDamageDealtSample(itemId: number, difficulty: number): number {
  const dd2 = itemId >= 3837 && itemId <= 3846;
  const k1 = dd2 ? 1.1 : 1.5;
  const k2 = dd2 ? 1.2 : 2;
  if (difficulty <= 1) return k1;
  if (difficulty >= 2) return k2;   // ★BJ716-A：越尾钳界（Sample 末键 num=0 早退语义）
  return Math.fround(k1 + Math.fround(k2 - k1) * (difficulty - 1));
}

/** 玩家攻端旗加伤统一出口（GetBannerBuffEffect DamageDealt 面）——原版三个消费位：
 *  · ApplyDamageToNPC 内置段 Player.cs:20599（狱火光环/矿车冲撞/荆棘反伤/
 *    TryHittingNPC 家族——凡走该函数的直伤通道都吃一次）；
 *  · ProcessHitAgainstNPC :44658-61（近战挥击链，Game.ts 挥击段直接调 sampler）；
 *  · Projectile.Damage_PVE :13388-90（全部玩家弹幕结算面）。
 *  StrikeNPC 本体无旗逻辑 ⇒ 攻端各站【恰好一次】，语义 = `(int)((float)dmg×sample)`
 *  截断；banner 未激活 / 弹 id 无旗档 → 原值返回。靶点判据 = bannerNpcKeyOf 键域
 *  （★BJ716-A 2026-10-25 R15-P1-2：原版攻端 GetBannerBuffEffect(npc) →
 *  NPCtoBanner(npc.BannerID())=netID≥-10 域——旧裸读 target.vanillaId（type 域）：
 *  变体史莱姆 -1..-10 双向错（放蓝史莱姆旗对全部变体过量吃旗/放变体自有旗反不
 *  生效）；G35 判例2「banner 域一律走单源」第 4 消费域归队——受端/击杀/
 *  lastCreatureHit 三域 BJ710-C/G35 已收编，攻端本刀补齐）。 */
export function applyBannerDamageDealt(
  game: GameHooks,
  target: unknown,
  dmg: number,
): number {
  const key = bannerNpcKeyOf(target as Parameters<typeof bannerNpcKeyOf>[0]);
  if (key == null || key === 0) return dmg;
  const g = game as unknown as { bannerNpcActive?: (id: number) => boolean };
  if (!g.bannerNpcActive?.(key)) return dmg;
  const bItem = bannerItemId(bannerOfNpc(key));
  if (!(bItem > 0)) return dmg;
  const world = (game as unknown as { world?: Parameters<typeof mainDifficulty>[0] }).world;
  return Math.trunc(dmg * bannerDamageDealtSample(bItem, mainDifficulty(world)));
}

/** SW-R3 2026-09-03（蓝队 M-1 位次翻案）：banner 乘区【采样值】出口（不含截断）——
 *  原式 :13388-13390 `dmg = (int)((float)dmg * effect.DamageDealt.Sample(Main.Difficulty))`
 *  的 int 截断发生在链内 1002/trap 两次减伤【后】,故乘区值与截断必须分离
 *  （applyBannerDamageDealt 保持自截断,继续服务旧位次消费面:近战 :22610/
 *  scarabBombExplode 等 DV→banner 相邻无减伤夹层的面）。返回 1 = 不乘。 */
export function bannerDamageDealtMultOf(game: GameHooks, target: unknown): number {
  const key = bannerNpcKeyOf(target as Parameters<typeof bannerNpcKeyOf>[0]);   // ★BJ716-A：键域归队（同 applyBannerDamageDealt）
  if (key == null || key === 0) return 1;
  const g = game as unknown as { bannerNpcActive?: (id: number) => boolean };
  if (!g.bannerNpcActive?.(key)) return 1;
  const bItem = bannerItemId(bannerOfNpc(key));
  if (!(bItem > 0)) return 1;
  const world = (game as unknown as { world?: Parameters<typeof mainDifficulty>[0] }).world;
  return bannerDamageDealtSample(bItem, mainDifficulty(world));
}

/** ★BJ710-C（2026-10-25）：敌弹发射者旗追踪键——原版 NPC.BannerID()（NPC.cs:7671-7678
 *  `netID >= -10 ? netID : type`）的仓内投影：vanillaNetId≠0（变体）用 netId，否则
 *  vanillaId（类型域；击杀链 bannerOfNpc 同式 Enemy.ts:15649）。null（无实体引用：
 *  世界机关/探针桥）= 无旗面。
 *  ★BJ710-G35 D3b（2026-10-25）：补 `netID >= -10` 上界——-11..-19 变体（如 getGood
 *  僵尸 -12,SetDefaultsFromNetId :7801-7818 恒型 type=6）原版 BannerID() 回落【type】
 *  （吃僵尸旗 27）;旧投影裸回 netId=-12 → bannerOfNpc(-12)=0 旗面全丢（接触减伤/
 *  击杀计账同错）。击杀链/图鉴消费 netId 裸读另有其面（bestiary netID 域正确,勿改）。 */
export function bannerNpcKeyOf(e: { vanillaId?: number | null; vanillaNetId?: number } | null | undefined): number | null {
  if (!e) return null;
  const netId = e.vanillaNetId ?? 0;
  return netId !== 0 && netId >= -10 ? netId : (e.vanillaId ?? 0);
}

/** ★BJ710-C：敌弹旗减伤消费单源（原版 Damage_EVP :14905-14908 `GetBannerBuffEffect(
 *  bannerIdToRespondTo)` 段——DamageVar 后、resistCold/难度缩放前；bannerIdToRespondTo
 *  由 FindBannerToAssociateTo（:11106-11119）在弹构造期自 EntitySource_Parent 发射
 *  NPC（NPC.GetSpawnSource_ForProjectile NPC.cs:91865）冻结，宿主死后仍保留）。
 *  键域 = NPC 类型/变体 id（bannerNpcActive/_bannerNpcs 同键，接触面 Game.damagePlayer
 *  :44717 同域）。itemId 档区分 DD2 旗（3837-3846 → 0.917/0.833，普通旗 0.75/0.5）。
 *  trunc 截断（(int) 语义——接触面 :44714 Notes① 判例，round 会抬 .5 中点；旧门
 *  Math.round 系域错死码期错档，随本刀勘正）。
 *  ★D6 销案（BJ710-G35 2026-10-25）：max(1) 下限=仓内自创、保留为已知分歧——
 *  原版 (int) 无下限（1 伤弹 ×0.5 归 0），但触发面=敌弹 base dmg=1 且发射者有旗
 *  （仓内敌弹最小伤面=蒲公英籽 836 的 7,远高于 1）→ 分歧不可达，销案锁死勿再登记
 *  （接触面 :44718 同形 floor 同判例）。bannerNpcId 空/无旗/未放旗 = 原值直返；
 *  PvP 调用面不进本函数（Damage_PVP 无此段）。 */
export function applyBannerDamageReceivedOnProj(
  game: GameHooks, dmg: number, bannerNpcId: number | null | undefined,
): number {
  const vid = bannerNpcId ?? null;
  if (vid == null || vid === 0) return dmg;
  const g = game as unknown as { bannerNpcActive?: (id: number) => boolean };
  if (!g.bannerNpcActive?.(vid)) return dmg;
  const bItem = bannerItemId(bannerOfNpc(vid));
  if (!(bItem > 0)) return dmg;
  const world = (game as unknown as { world?: Parameters<typeof mainDifficulty>[0] }).world;
  // ★BJ716-A（R15-P2-4）：mainExpertMode 布尔档 → mainDifficulty 曲线式——旅程滑杆
  //  分数难度∈(1,2) 原版连续插值（R15 判例3「布尔档只在整数难度轴等价」），
  //  非旅程整数值两式逐值相同（bannerReceivedMult 体内钳界保证）
  return Math.max(1, Math.trunc(dmg * bannerReceivedMult(mainDifficulty(world), bItem)));
}

/** ★BJ710-C：bossAI 弹域直调站（game.damagePlayer+projDomain 14 站，BJ704-R3 P1①
 *  锁面）统一伤害出口——原版 Damage_EVP :14905-14918 门序投影：**banner 减伤 →
 *  难度缩放 → 恒 ×2**。banner 必须在缩放【前】：trunc 边界序不可交换
 *  （trunc(trunc(13×0.75)×2)=36 ≠ trunc(trunc(13×2)×0.75)=38）。直调站均为非反射
 *  载体（死光/爆盒/跺地波/龙卷列等不可反射实体），无 reflected 门（反射门只在
 *  hitPlayer——可反射 Arrow/Dart 载体域）。bannerNpcId=null（世界机关面
 *  MeteorChunk/FallingBlock/探针桥）= 旧行为逐位不变。
 *  ★BJ710-G35 D7b（2026-10-25）：trap 弹加 sweater 面（:14919-14922 `deadMansSweater
 *  && trap → ×0.5 截断再 min 300`,在 ×2 【后】——cap 吃终值）——直调站现役 trap 弹
 *  唯 1078 MeteorOre（MeteorChunk,TRAP_PROJ_VIDS 同源）;其余站不传 = 逐位不变。
 *  sweater 旗读 game.player.equipStats.deadMansSweater（SW-AC1 单源,GrantArmorBenefits
 *  case 5007）。 */
export function evpDirectDmg(
  game: GameHooks, dmg: number, bannerNpcId: number | null | undefined, trap = false,
  /** ★BJ716-A（R15-P2-3≈BJ712-C D1，2026-10-25）：弹型 id——resistCold 门
   *  （Projectile.cs:14909-14912 `if (Main.player[myPlayer].resistCold &&
   *  coldDamage) num3 = (int)(num3 * 0.7f)`，Damage_EVP 链内 banner 后、
   *  hostileDamageScaling 前）查 COLD_DAMAGE_PROJS（hitPlayer :866 同表同门
   *  +BuffType.Warmth）。唯一直调站冷弹面 = 961/962（Deerclops 冰锥/冰浪，
   *  P.cs:9089/:9100 coldDamage=true 亲证;965 非冷余站全非 COLD 表）。
   *  缺省 undefined = 非冷弹旧行为逐位不变（温暖药水下鹿角怪冰伤曾 ~1.43×） */
  projVid?: number,
): number {
  let mid = applyBannerDamageReceivedOnProj(game, dmg, bannerNpcId);

  if (projVid !== undefined && COLD_DAMAGE_PROJS.has(projVid)
    && (game.player as unknown as { buffs?: { has?: (b: BuffType) => boolean } } | null)
      ?.buffs?.has?.(BuffType.Warmth) === true) {
    mid = Math.trunc(mid * 0.7);   // :14909-14912（(int) 截断）
  }
  let out = hostileProjectileDamage(mid, mainDifficulty(game.world)) * 2;
  if (trap) {
    out = (game.player as unknown as { equipStats?: { deadMansSweater?: boolean } } | null)
      ?.equipStats?.deadMansSweater === true
      ? Math.min(Math.trunc(out * 0.5), 300) : out;
  }
  return out;
}

/** ★BJ716-A（R18-F1，2026-10-25）：expert EoW 虫段 /5 的 20 弹型表——
 *  Projectile.cs:13392-13398 条件行 :13394 逐项照抄（原表曾落 Game.ts
 *  explodeNpcDamageChain 专面,本刀提为弹域单源,Game 侧静态字段转发——多副本
 *  漂移收敛,BJ712-B 判例1 同族）。181/183/281/566 不走爆炸 face（explodeAt 无
 *  投掷点,Game.ts:33318 自注）,全表收录=1:1。 */
export const EXPERT_EOW_FIFTH_PROJS: ReadonlySet<number> = new Set([30, 397, 517, 28, 37, 516, 29, 470, 637,
  1086, 1087, 108, 281, 588, 519, 773, 183, 181, 566, 1002]);

/** ★BJ716-A（R18-F1）：`Main.expertMode && 表含弹型 && targetNPC.type 13-15 →
 *  dmg /= 5`（int 截断）。位次 = banner(:13388-13390) 后、crit 翻倍（StrikeNPC
 *  :13702 内）前——dealContacts/projTargets 三消费链按此序接。目标键域 =
 *  vanillaId（type 域——原文读 targetNPC.type;EoW 头/身/尾 13/14/15 无 netID
 *  变体,勿走 bannerNpcKeyOf）。专家门 = mainExpertMode（GDL Difficulty≥2,
 *  旅程滑杆/FTW+1 感知——R14 判例3）。 */
export function expertEowFifthDmg(
  dmg: number, projId: number,
  targetVid: number | null | undefined,
  world: Parameters<typeof mainExpertMode>[0],
): number {
  if (!mainExpertMode(world)) return dmg;
  if (!EXPERT_EOW_FIFTH_PROJS.has(projId)) return dmg;
  const t = targetVid ?? -1;
  if (t < 13 || t > 15) return dmg;
  return Math.trunc(dmg / 5);
}

// ---- ★α-H4 OnHit 域出口谓词（HittableForOnHitRewards 统一收口） ----------------
// 原版 NPC.cs:91152 `!(CountsAsACritter(target) || target.immortal)`——OnHit 奖励域
// （蝙蝠棒吸血 BatBat_TryLifeLeeching :44544-51、火之大剑火山窗消耗 Volcano
// _spawnVolcanoExplosion 消费门等）对【小动物∪不朽体】一律不放行。
// ★禁再散抄 `!e.def.critter && immortal!==true` 裸读——Game.ts 两处曾各写一份,
// countsAsCritterOf 还覆盖小动物桶落点成员（def.critter 提取表之外的第二源）。 */
export function hittableForOnHitRewards(e: unknown): boolean {
  const t = e as { immortal?: boolean } | null;
  if (t?.immortal === true) return false;
  return !countsAsCritterOf(e, false);
}

/** 弹幕命中小动物。★蓝队二轮 F3 门禁补齐（清零批二波，2026-08-31）：
 *  原版门 = Player.CanNPCBeHitByPlayerOrPlayerProjectile（Player.cs:20673-20689，
 *  Damage_PVE_Inner :12622-12625 对每发【友好】弹以 projectile!=null 调用——
 *  flag = dontHurtCritters ∪ (projectile.minion || MinionShot || sentry || SentryShot)，
 *  trap 弹复位为可打（:20676-20679，镖陷阱照杀小动物），敌方小动物强制放行
 *  （:20680-20683）；CountsAsCritter ∧ flag → 拒收）。
 *  来源分类取数据面自证：SetDefaults hostile=true 且无 friendly 的纯敌对弹
 *  （教徒冰雾 464/闪电球 465/雷球 466·580 等）按 :12631 `!(hostile & flag2)` 支
 *  ——小动物非 friendly NPC ⇒ 敌对投射物对其恒无伤（死亡通道只有敌怪接触伤害
 *  循环），统一在本出口拦死、调用点零改动即达成各站正确语义。
 *  ★F4（2026-08-31）：projectile 语境显式参 ctx——flag = dontHurtCritters ∪
 *  (minion ∪ MinionShot ∪ sentry ∪ SentryShot)（:20675）。数据列（vanilla-projectiles.
 *  json minion 位）兜底之外，MinionProj 各伤害环以自身召唤/哨兵身份传 {minion,sentry}
 *  强制进入恒拒域：无饰品也照拒普通小动物，唯一放行 = 黑化复权体；玩家直射族
 *  （Arrow/MagicProj/WeaponProj…）不带 ctx ⇒ 仅受饰品门。trap 复位支持同参。 */
export interface HitCritterCtx {
  minion?: boolean;
  sentry?: boolean;
  trap?: boolean;
}

/** ★BJ384：敌对弹面单源（Damage_PVE_Inner :12631 受理式推导）——hostile-only 弹
 *  恒不结小动物伤害（含黑化复权体:原版 Damage_PVE 受理式整段不达）。双出口共用。 */
function critterHostileOnly(self: { projId?: number }): boolean {
  const projId = self.projId ?? 0;
  const pd = projId > 0 ? projectileData(projId) : null;
  return pd?.hostile === true && pd?.friendly !== true;
}

/** ★BJ384：CanNPCBeHitByPlayerOrPlayerProjectile 拒收旗单源（Player.cs:20673-20689
 *  组装式——hitCritters / hitCrittersAll 双出口共用）。返回 true = 普通小动物拒收
 *  （黑化复权体 :20680-20688 仍放行）。 */
function critterRejectFlag(
  self: { projId?: number },
  game: GameHooks,
  ctx?: HitCritterCtx,
): boolean {
  const projId = self.projId ?? 0;
  const pd = projId > 0 ? projectileData(projId) : null;
  // 玩家/环境双面弹（friendly 或无登记）→ :20675 flag 组装 + :20676 trap 复位
  // ★IIIII248:projScanEq = 桶窗快照 ?? 旧活读(语义面不变)
  const eq = projScanEq(game);
  // ★ζ#3/#4（终局扫尾批）：MinionShot/SentryShot 两张 id 表接进 flag 组装——原版
  // :20675 组装式含 `MinionShot[type] || SentryShot[type]` 两臂，此前只有 minion 旗
  // 数据列+ctx 显式位。表见上方（ProjectileID.cs 提取）。
  let flag = eq?.dontHurtCritters === true || pd?.minion === true
    || ctx?.minion === true || ctx?.sentry === true
    || MINION_SHOT_PROJS.has(projId) || SENTRY_SHOT_PROJS.has(projId);
  if (ctx?.trap === true) flag = false;   // :20676-20679 镖陷阱族复位=可杀小动物
  return flag;
}

/** 单靶受理结算（dead/几何/复权三门 + hurt 落地）。★SW-RB10d（F-BJ47-D,2026-09-10）
 *  的 fromPlayer 语义注释随实现收进本单源：trap 弹 ownedBySomeone=false。
 *  ★清偿刀 P1（C5 红蓝定谳#3,2026-09-29）：返真=hurt 已调【且受理】——原版 victim
 *  循环（Projectile.cs:12618）对 critter 与敌怪同链,免疫门 :12598（dontTakeDamage 侧
 *  由 :13978 同面承载）与 :12635-12637（immune[owner]==0,pierce=0 → flag3 假门照走）
 *  拒收 = 整体跳过：不 StrikeNPC、不耗 keepIterating、不 numHits++（:14263）——弹侧
 *  消费面（爆/亡/穿透/入账）全在受理面后。旧档无条件返真=残窗小动物被计入
 *  pveNumHits/hitCritters 布尔（弹因此爆/亡）。修=hurt 返假且快照门拒（T 刀单源
 *  判据=「进 hurt 前状态」,Enemy.hurt 头门 :14040/:14046 同式）→ 返假+不计数（与
 *  敌怪同面）;hurt 返假非门拒族（血尽级联 :14369 族/普通未致命尾档 :15037——黑化
 *  critter lifeMax 25 吃 5 伤存活即此形态）照返真=原版受理（numHits++ 无死亡复查）。 */
function settleCritterHit(
  game: GameHooks,
  ctx: HitCritterCtx | undefined,
  flag: boolean,
  projId: number,
  c: CritterLike,
  hitTest: (c: CritterLike) => boolean,
): boolean {
  if (c.dead) return false;
  if (!hitTest(c)) return false;
  // :20680-20688（isCritterThatIsHostileToPlayers 复权 + CountsAsCritter∧flag 拒收）
  if (flag && !isCritterThatIsHostileToPlayers(c)) return false;
  const victim = c as unknown as { iframes?: number; dontTakeDamage?: boolean };
  const gate = snapshotVanillaGate(victim);
  // ★BJ488①（2026-10-04）critter 面 crit 掷 + TimerCrit 消费（Damage_PVE_Inner :12911-12928
  //  亲读定谳：critter 【无特支】——victim 循环对 critter 与普通敌同链,三类掷 :12915-12927
  //  与 TryConsumingTimerCrit :12928 照达;唯二差异门都在本函数既有位=①CanNPCBeHitBy
  //  PlayerOrPlayerProjectile 拒收（:12622-12625→gate 处 return,上方 flag 支承载——拒收拍
  //  掷/消费全不可达）②免疫窗门 :12635-37 在 crit 段【前】→ 门拒不掷不消费。ownedBySomeone
  //  =!trap（Projectile.cs:580-589）→ trap 弹整 crit 块跳过=零掷零消费（1091 同判例）。
  //  可观测面：critter 一击即死使 crit 伤面不可观测,但 TimerCrit 蓄能节拍（charge→−15
  //  :28568-71）+NightsEdge 编排照发=消费实证;crit 位进飘字色/击退 ×1.4+防后 ×2
  //  （Enemy.hurt 消费位——★S02 BJ723-B:crit ×2 已随 Enemy.hurt 防后翻倍自动接通,
  //  RB10d-D1 登记「债清偿时再接 crit ×2 面」就此清偿;dmg 固定 5 shim 面保持）。 */
  const rejected = vanillaGateRejected(gate);
  let crit = false;
  if (!rejected && ctx?.trap !== true) {
    const rollCrit = projId > 0 && rollVanillaHitCrit(projId, game);
    crit = rollCrit || ((game.player as unknown as
      { tryConsumingTimerCrit?: (g: unknown, x: number, y: number, w: number, h: number) => boolean } | null)
      ?.tryConsumingTimerCrit?.(game, c.x, c.y, c.w, c.h) ?? false);
  }
  const landed = (c as unknown as {
    hurt: (d: number, kx: number, ky: number, g: GameHooks,
      armorPen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
  }).hurt(5, 0, 0, game, 0, crit, 0, ctx?.trap !== true);
  if (!landed && rejected) return false;   // 门拒（iframes 残窗/dontTakeDamage）=整体跳过
  return true;
}

export function hitCritters(
  self: { x: number; y: number; w: number; h: number; projId?: number },
  game: GameHooks,
  ctx?: HitCritterCtx,
): boolean {
  const list = (game as unknown as { critters?: () => unknown[] }).critters?.() ?? [];
  if (critterHostileOnly(self as { projId?: number })) return false;
  const flag = critterRejectFlag(self as { projId?: number }, game, ctx);
  for (const ent of list) {
    if (settleCritterHit(game, ctx, flag, self.projId ?? 0, ent as CritterLike,
      (c) => projOverlap(self.x, self.y, self.w, self.h, c))) return true;
  }
  return false;
}

/** ★BJ384（2026-09-28）：hitCritters 的「全结算 + 几何覆写」变体——原版 Damage()
 *  单趟 victim 循环（:12592 `i < maxNPCs & keepIterating`）对全部命中靶各结算一次
 *  （numHits++ :14263 无条件）。bolt 多点面（StormLightning.damageAlongBolt）等
 *  一次性复合命中面消费：hitTest 传逐靶谓词（Colliding 全口径——AABB 交叠是缺省
 *  等价面），返回受理命中【数】（:14263 账;布尔出口 hitCritters 保持原签名零回退）。
 *  首靶即返语义（keepIterating=false 截断族:penetrate=1 单发）仍走 hitCritters。 */
export function hitCrittersAll(
  self: { x: number; y: number; w: number; h: number; projId?: number },
  game: GameHooks,
  ctx?: HitCritterCtx,
  hitTest?: (c: CritterLike) => boolean,
): number {
  const list = (game as unknown as { critters?: () => unknown[] }).critters?.() ?? [];
  if (critterHostileOnly(self as { projId?: number })) return 0;
  const flag = critterRejectFlag(self as { projId?: number }, game, ctx);
  const test = hitTest ?? ((c: CritterLike) => projOverlap(self.x, self.y, self.w, self.h, c));
  let n = 0;
  for (const ent of list) {
    if (settleCritterHit(game, ctx, flag, self.projId ?? 0, ent as CritterLike, test)) n++;
  }
  return n;
}

/** 弹幕命中怪物:播受击音效(原版 NPC.StrikeNPC 语义——任意伤害来源都响,
 *  近战挥砍早已如此;弹幕此前漏了)。
 *  实例级 HitSound 优先（原版 NPC.HitSound 本就是实例字段,AI 可运行时改写——
 *  488 训练假人 AI_092 每 tick Next(20)==0 在 {NPCHit15,16,17} 重卷,NPC.cs:39196-39212）:
 *  e.hitSoundOverride 非空 → 用之,勿回写 def.hitSound(按型共享档会串所有实例)。
 *  宠物史莱姆语音表优先（StrikeNPC :82255-82302）：type==1 且 ai[1]=语音
 *  饰品物品 id → 按表替换（鸡 1/5 稀有变体在 petSlimeHitVoice 内掷） */
export function playEnemyHitSound(
  game: GameHooks,
  e: { def?: { hitSound?: string[] }; hitSoundOverride?: string[] | null; vanillaId?: number | null; ai1?: number; cx?: number; cy?: number },
): void {
  if (e.vanillaId === 1 && e.ai1 != null) {
    const v = petSlimeHitVoice(e.ai1);
    if (v) {
      // WithPitchVariance(0.4)（SoundID.cs:1115-1147 全表）——±0.4 音高抖动
      game.playSfxWav?.(v.file, v.vol, e.cx, e.cy, Math.random() * 0.8 - 0.4);
      return;
    }
  }
  const files = (e.hitSoundOverride && e.hitSoundOverride.length) ? e.hitSoundOverride : e.def?.hitSound;
  if (files && files.length) game.playSfxFiles(files, 0.9);
}

/** 玩家攻击能否命中敌怪桶实体（原版 Projectile.Damage_PVE_Inner :11892-11896 的
 *  flag 门 + Player.ApplyItemToNPC :43605 friendly 门同式）：敌怪桶里的 friendly NPC
 *  （睡渔夫 376、被缚救援族残留）对玩家近战/弹幕/爆炸一律无效——命中循环须在
 *  音效/伤害数字/穿透消耗/debuff 施加【之前】跳过（原版 return 在全部结算之前）。
 *  例外：臭鸡蛋 318（:11971 全游戏唯一可无条件命中 friendly NPC 的玩家弹）；
 *  voodoo（向导 22 装娃娃 killGuide / 裁缝师 54 killClothier——敌怪桶实际不含
 *  这两型，门对称保留）。小动物不入 enemies 桶（critters 桶独立），无 critter 分支。 */
export function playerCanHitEnemy(
  e: unknown,
  game: GameHooks,
  projId = 0,
): boolean {
  const t = e as { vanillaId?: number | null; def?: { friendly?: boolean }; catchFriendly?: boolean } | null | undefined;
  // ★本函数只做【命中校验】（Damage_PVE_Inner :11892-11896 flag 门 + ApplyItemToNPC
  //  :43605 friendly 门同式）——原版 immortal/chaseable 剔除属 CanBeChasedBy（:91141）
  //  索敌门，仅目标选取使用；曾误入此处致训练假人被一切玩家攻击免伤
  //  （2026-08-25 用户报"假人无法被击中"）——索敌侧请用 canBeChasedBy()。
  // ★BJ704-G3 D10（2026-10-21）：NPC.friendly 运行时窗位（Enemy.catchFriendly——
  //   SubAI :91649-91670 对 npcCatchable 型每拍强写：自然出生首 90t true=玩家
  //   免伤,释放/雕像出生首拍即 false=可打;静态 def.friendly 为城商/蚱蜢位）。
  //   免伤窗与静态 friendly 同走下方豁免链（318 巫毒/杀向导/杀裁缝——critter
  //   域不可达,零行为差）。
  const vid = t?.vanillaId;
  // ★BJ704-R9 P1-2：原版 SubAI（NPC.cs:91649-91670）对【全部】npcCatchable 型每拍
  //   强写 friendly=(窗>0)——else 支显式 false,静态 def.friendly 被完全覆写 ⇒
  //   真投影 = catchable ? 窗 : 静态。旧「静态 ∪ 窗」对静态 true 捕获型
  //   （蚯蚓 357/448/484/485/486/487/606 等九型,aiStyle 66 无自清位）恒免伤
  //   = 玩家永不可打（原版窗外可打:近战 :9630 双桶/弹幕 :32571/爆炸 critters 臂
  //   全吃此门）。蚱蜢 377/446（AI_001 自清同构）与逃逸档/互殴面无观测差。
  const friendlyEff = vid !== undefined && vid !== null && NPC_CATCHABLE.has(vid)
    ? t?.catchFriendly === true
    : !!t?.def?.friendly;
  if (!friendlyEff) return true;
  if (projId === 318) return true;
  // ★IIIII248:projScanEq = 桶窗快照 ?? 旧活读(语义面不变)
  const eq = projScanEq(game);
  if (vid === 22 && eq?.killGuide) return true;
  if (vid === 54 && eq?.killClothier) return true;
  return false;
}

/** NPC.cs SetDefaults immortal/chaseable=false 全表（1457 逐支机械提取,golden 测试
 *  tests/npc-flags-golden.test.ts 与反编译逐行对账防复发）：
 *  immortal=true：{488 训练假人 :14630, 690 伪装雕像 :17715}（全表仅此两支;
 *    运行时支唯 infectedSeed type20 :53687,不入静态表）；
 *  chaseable=false：{379,380 教徒弓手 :13882, 399 火星探测 :14106, 437 :14221,
 *    438 :14238, 440 :14273, 523 :15837}（运行期唯 DukeFishron AI :50086/:50203
 *    相位暂关）。★2026-09-02 纠偏：曾误列 133(游荡眼球怪)/416(日耀钻背骑士)——
 *    两型 SetDefaults/AI 均无此三门,原版叶绿弹对游荡眼球正常索敌（用户实报失效）。 */
export const CHASE_EXCLUDED_VIDS: ReadonlySet<number> = new Set(
  [488, 690, 379, 380, 399, 437, 438, 440, 523]);

/** 原版 NPC.CanBeChasedBy（NPC.cs:91141-91147）索敌门——仅供【目标选取】使用：
 *  immortal/chaseable=false 族（=CHASE_EXCLUDED_VIDS,golden 对账）不入索敌；
 *  friendly 同拒。玩家直接命中不受此限——命中校验用 playerCanHitEnemy。
 *  （2026-08-24 "召唤宠物追打假人"修复的正解层；当时误改 playerCanHitEnemy 致次日
 *  回归） */
export function canBeChasedBy(e: unknown): boolean {
  const t = e as { dead?: boolean; vanillaId?: number | null; def?: { friendly?: boolean; hp?: number };
    dontTakeDamage?: boolean; maxHp?: number } | null | undefined;
  if (!t || t.dead) return false;
  // ★BJ89 幻影字段定谳（bj73-radar-count-phantom-field 姊妹病灶）：EnemyDef 只有
  //  `hp`（enemies.ts `hp: number`，无 lifeMax 字段）——旧读 def 上的幻影 lifeMax
  //  恒 undefined，`!== undefined` 守卫降级跳过 = lifeMax>5 门（:91141）整缺，兔/鸟/
  //  蚱蜢等小生命 critter（原版 lifeMax=5 族）可被随从索敌。修 = 运行时 maxHp
  //  （≡ 原版 NPC.lifeMax——ScaleStats 后终值，Enemy.ts fromVanilla e.maxHp=ss.lifeMax；
  //  ScaleStats 对 lifeMax≤5 族不进门 → critter 恒原值）?? def.hp（构造
  //  this.maxHp=this.def.hp 同源）兜底纯对象夹具。
  const lm = t.maxHp ?? t.def?.hp;
  if (lm !== undefined && lm <= 5) return false;          // lifeMax > 5(:91141 小生命 critter 族不入索敌）
  if (t.dontTakeDamage) return false;                    // !dontTakeDamage（克脑一阶 266/伪装 690/起飞飞碟 395 等）
  const vid = t.vanillaId;
  if (vid !== undefined && vid !== null && CHASE_EXCLUDED_VIDS.has(vid)) return false;
  // 运行期相位暂关（红蓝对抗 R2-F6 补）：AI_069 猪鲨 npc.chaseable 字段（:6268 缺省
  // true）——态10 头置假(:50086)/态11 头复真(:50173)/态12 头置假(:50203),态13 继承
  // 假 ⇒ 假窗 {10,12,13}。隐身悬浮/瞬移期随从不可索敌（Projectile.cs:36283 消费;
  // 原版逐 tick ResetEffects 复真+AI 重写=按 ai0 门等价）。曾静态表外零运行时门=
  // 隐身猪鲨被随从锁定
  if (vid === 370) {
    const a0 = (e as { ai0?: number }).ai0;
    if (a0 === 10 || a0 === 12 || a0 === 13) return false;
  }
  return !t.def?.friendly;
}

/** 敌对弹幕命中玩家(原版 Projectile.Damage_EVP,Projectile.cs:13706-13830):
 *  - 门禁 hostile + damage>0(:13708)——调用方用 hostile 标志控制,本函数只做判定;
 *  - 玩家 dead / 无敌即跳过(:13732 player.immune)——Player.damage 自带 iframes,
 *    与原版 immune 同义去重,无需调用方另记冷却;
 *  - 相交判定 = AABB 重叠(Colliding :13749,Rect.Intersects 同构);
 *  - 伤害结算走 GameHooks.damagePlayer(= Player.Hurt 入口,含防御减算/击退/
 *    受击音/伤害数字/饰品触发)。
 *  原版敌弹命中【不消耗穿透】(:13811-13829 仅 435/436/437/681/682 特判递减),
 *  弹体照常飞行——调用方不得据此销毁弹体。
 *  返回是否【实际造成伤害】(iframes/闪避吞掉时 false,对应原版 Hurt 返回 0;
 *  StatusPlayer 的 debuff 授予以此为准,:13798-13800)。 */
/** ProjectileID.Sets.SkipDamage_EVP（1457 :275 新表,1456 无）={108,164,1002}——
 *  爆炸物/地雷/TNT 桶类敌对弹不再走 EVP 打主人（自伤语义移交 Kill→SelfHurtPlayers
 *  的 FixedSelfDamageForPlayers 定伤链） */
export const SKIP_DAMAGE_EVP: ReadonlySet<number> = new Set([108, 164, 1002]);

/** ★Boss 面⑥（2026-08-31 台账清偿）Damage_EVP 免工件分槽表——bossAI 双件批。
 *  原版 Projectile.Damage_EVP（1458 :14847-14858 / 1456 :13704-13720）在命中玩家
 *  门禁前按弹型选冷却槽：下列弹型走 ImmunityCooldownID.BossNoCheese 独立桶，
 *  其余走 General（player.immune 位）。月总幻影族（452 幻影之眼 / 454 幻影能量球 /
 *  455 死亡之光 / 462 幻影矢）+ 灾厄柱族 871-874 / 天界雾 919 / 光束 923-924。
 *  语义双面（玩家 Player.Hurt :38493 桶门）：
 *   ①原版 flag = active && !dead && (!immune || num != General) ⇒ BossNoCheese 弹
 *     【不吃通用无敌帧】——旧档"单桶引擎差异备案"（死光被敌弹无敌窗吸收/反之
 *     只按通用 iframes 节流）就此闭合；
 *   ②命中后写独立 hurtCooldowns[id] 槽，num10 常规公式（40/80）=「独立 40t 槽」。 */
export const DAMAGE_EVP_NO_CHEESE_PROJS: ReadonlySet<number> = new Set([
  452, 454, 455, 462, 871, 872, 873, 874, 919, 923, 924,
]);

/** 弹型是否走 BossNoCheese 桶（hitPlayer 门/MoonLord 类直伤共用）。 */
export const evpNoCheeseSlot = (projId: number | undefined): boolean =>
  projId !== undefined && DAMAGE_EVP_NO_CHEESE_PROJS.has(projId);

/** ★Boss 面⑥：把一次敌弹伤害经「免疫分桶」瞬态通道送达 Player.damage
 *  （Player.Hurt(…, cooldownCounter) 的仓内投影）。桶表 = getGlobalHurtBuckets()
 *  （Game 构造期登记，HurtCooldownBuckets.ts F13）；缺表（纯单元测/极早期）
 *  回退直连 damagePlayer（= General 旧行为，本函数不引入新失败路径）。
 *  通道注入后 Player.damage 的门面（:6520-6527 blocksHit 早退）与写面
 *  （:6619-6626 applyAfterHit num10）自动接管——调用方零重复。 */
export function damageEvPNoCheese(
  game: GameHooks, dmg: number, sx: number, sy: number, attacker?: import('./Enemy').Enemy,
  /** ★BJ710-G35 D4（2026-10-25）：opts 透传——BossNoCheese 直调站的弹域双旗
   *  （projDomain+projVid,Game.damagePlayer :44690 mod 修正链门）此前缺失=静默
   *  no-op（BJ704-R3 P1 同款病）。现役唯一消费 = MLDeathray 455。 */
  opts?: { projDomain?: boolean; projVid?: number },
): number {
  const buckets = getGlobalHurtBuckets();
  const p = game.player;
  if (!buckets || !p) return game.damagePlayer(dmg, sx, sy, attacker, undefined, undefined, undefined, opts);
  const chan = p as unknown as {
    __swNextHitBucket?: { id: number; table: ReturnType<typeof getGlobalHurtBuckets> } | undefined;
  };
  chan.__swNextHitBucket = { id: ImmunityCooldownID.BossNoCheese, table: buckets };
  try {
    return game.damagePlayer(dmg, sx, sy, attacker, undefined, undefined, undefined, opts);
  } finally {
    chan.__swNextHitBucket = undefined;
  }
}

/** NPC.coldDamage 寒冷系敌弹表（Projectile.cs SetDefaults 逐型 coldDamage = true，
 *  1.4.5.6 全 29 型——冰雪族弹幕：冰块 80/敌雪球 109/冰回力镖 113/冰霜弹 118-120/
 *  霜燃箭 172/冰锥 174/霜弹 253/霜光束 257/冰镰 263/北地长矛族 342-344/霜波 348 等）
 *  ——消费 = 温暖(124) resistCold 受击 ×0.7（Projectile.cs:13764-13766 Damage_EVP
 *  段：banner 后、难度乘区前） */
export const COLD_DAMAGE_PROJS: ReadonlySet<number> = new Set([
  80, 109, 113, 118, 119, 120, 128, 166, 172, 174, 177, 253, 257, 263,
  308, 309, 337, 342, 343, 344, 348, 349, 359, 520, 912, 917, 961, 962, 979,
]);

/** NPC.coldDamage 寒冷系敌怪表（NPC.cs SetDefaults 逐型 coldDamage = true，
 *  1.4.5.6 全 16 型）——消费 = 温暖(124) resistCold 接触伤 ×0.7
 *  （Player.cs:30961-30963 NPC 接触循环：thorns 后、Hurt 前） */
export const COLD_DAMAGE_NPCS: ReadonlySet<number> = new Set([
  143, // Snowman Gangsta
  144, // Mister Stabby
  145, // Snow Balla
  147, // Ice Slime
  150, // Ice Bat
  154, // Ice Tortoise
  169, // Ice Elemental
  184, // Spiked Ice Slime
  185, // Snow Flinx
  206, // Icy Merman
  243, // Ice Golem
  343, // Yeti
  345, // Ice Queen
  352, // Flocko
  629, // Ice Mimic
  668, // Deerclops
]);

export function hitPlayer(
  self: { x: number; y: number; w: number; h: number },
  game: GameHooks,
  dmg: number,
  trap = false,
  pvp = false,
  /** ★2026-08-31 bossAI 双件批（Projectile.Colliding 自定义判定通道）：
   *  非 AABB 判定盒的弹（919 光枪线段/923 扫束三段锥）传本谓词替代默认
   *  projOverlap——原版 Damage_EVP 同样以 Colliding(myRect,targetRect) 为受理门
   *  （Projectile.cs:15421 起），其余管线（immune 门/DamageVar/banner/cold/
   *  难度乘区）与本函数完全一致。缺省 undefined = 保持旧 AABB 重叠语义 */
  collide?: (p: { x: number; y: number; w: number; h: number }) => boolean,
): boolean {
  if (dmg <= 0) return false;
  // 1457 :14846-14850（1456 :13706-13710 无此门）:SkipDamage_EVP 表早退。
  // （1457 同段还删了受击路径的 TryDoingOnHitEffects——本仓 hitPlayer 本就无
  //   owner OnHit 侧道,无需删;1091+双闪电种子 Heal(80) 依赖 1457 新种子旗标
  //   noLightningSeed/moreLightningSeed,本仓 SeedFlags 未登记——不实装,随种子批）
  const evpId = (self as { projId?: number }).projId;
  if (evpId !== undefined && SKIP_DAMAGE_EVP.has(evpId)) return false;
  const noCheese = evpNoCheeseSlot(evpId);
  const p = game.player;
  if (!p || p.dead) return false;
  // 原版门禁（Damage_EVP 段）：`flag = active && !dead && (!player.immune || num != General)`
  // （1458 P.cs:14965-14967）——General 弹查 player.immune 位；BossNoCheese 弹不吃通用
  // 无敌帧、改由独立桶计时拦（桶写面在 Player.damage 内经 __swNextHitBucket 通道完成，
  // 见下方 game.damagePlayer 调用的 noCheese 分支）。★Boss 面⑥分槽接线。
  if (!noCheese && p.iframes > 0) return false;
  else if (noCheese && getGlobalHurtBuckets()?.blocksHit(ImmunityCooldownID.BossNoCheese)) return false;
  if (!(collide ? collide(p) : projOverlap(self.x, self.y, self.w, self.h, p))) return false;
  // R5-F21：DamageVar ±15% 掷骰（Projectile.cs:13762 `num3 = Main.DamageVar(damage,
  // -Main.player[owner].luck)`——Damage_EVP 首段,先掷后吃 banner/resistCold/缩放）。
  // ★附带⑤（2026-08-31 二轮蓝队）：PvP 弹【不在此再掷】——Damage_PVP 族在弹被击端
  //   收口单掷一次（Projectile.cs:14718 `int num = Main.DamageVar(...)`，856 的
  //   ModifyStellarTuneDamage :14720-14723 在掷后消费），仓内唯一 pvp 调用点
  //   Game.netPuppetProjContact 已按原文次序预掷+856 修正后再进本函数；此处再掷 =
  //   双重 ±15% 复合（实测偏移可达 ±0.28σ 面）。keep single-roll：caller 面为唯一掷点
  if (!pvp) dmg = damageVar(dmg, -p.luck);
  // R5-F22（★BJ710-C 2026-10-25 域勘正+全链接线）：旗 buff 减伤对敌弹生效（1457
  //  Projectile.cs:14905-14908 `GetBannerBuffEffect(bannerIdToRespondTo)`——
  //  bannerIdToRespondTo = 发射 NPC 的旗（:11106-11119 FindBannerToAssociateTo，
  //  EntitySource_Parent(NPC.cs:91865) 恒注入）。★域勘误：旧门读 Dart.ownerNpcId
  //  ——那是【实体 id】（whoAmI/G3 宿主绑定域，Dart.hostOf 按 e.id 查找消费），而
  //  bannerNpcActive 键域 = NPC 类型/变体 id（_bannerNpcs=scanBannerNpcs 产物，
  //  接触面 :44717 同域）→ 旧门域错=死码（实体 id 撞上有效旗类型 id 时反会误减伤）。
  //  修 = 发射侧统一写 bannerNpcId（类型域，Enemy.spawnHostileProj/shootDart +
  //  bossAI 14 直调站实体），消费走 applyBannerDamageReceivedOnProj 单源（itemId
  //  档区分 DD2 旗 0.917/0.833 + trunc 截断——旧 Math.round 系 .5 中点抬升错档）。
  //  无 bannerNpcId（世界机关/探针桥/未接线余量族）恒跳过——余量发射站点登记债。
  if (!pvp) {
    dmg = applyBannerDamageReceivedOnProj(game, dmg, (self as { bannerNpcId?: number | null }).bannerNpcId);
  }
  // 温暖(124) resistCold：寒冷系敌弹 ×0.7（Projectile.cs:13766-13768——banner 段后、
  // hostileDamageScaling 前；(int) 截断）。PvP 弹走 Damage_PVP 无此段,不乘
  if (!pvp && evpId !== undefined && COLD_DAMAGE_PROJS.has(evpId)
    && p.buffs.has(BuffType.Warmth)) {
    dmg = Math.trunc(dmg * 0.7);
  }
  // ★刀4-A(2026-10-13):敌弹命中玩家伤害修正链(ModifyHitByProjectile 形;倍率连乘;
  //  位=resistCold 后/hostileDifficulty 缩放前——纯倍率与缩放可交换;空 mod=恒等;
  //  pvp=Damage_PVP 族/trap=陷阱弹经 ctx 透传供分支)
  dmg = runModModifyHitPlayerByProj(p, game, evpId ?? -1, dmg, trap, pvp);
  const ifr = p.iframes;
  // ★ 玩家受伤难度乘区 + 全局 ×2（1457 Projectile.cs:14913-14918，Damage_EVP 段）：
  //   `if (!reflected) num3 = (int)(num3 * hostileDamageScaling.Sample(Main.Difficulty));`
  //   随后 `int num4 = 2; num3 *= num4;`——敌弹对玩家恒 ×2（对所有难度，含经典）。
  //   hostileDamageScaling = GameDifficultyData.HostileProjectileDamageMultiplier
  //   （Projectile.cs:480/806：旅程 0.5 / 经典 1 / 专家 2 / 大师 3；type 1091 特化
  //   LightningPlayerDamageScaling 在 proj1457 落雷家自管，不经本口）。
  //   NPC 接触伤害不走这里——其难度缩放在生成时由 NPC.ScaleStats 完成
  //   （Enemy.def.damage 已是缩放值），在此再乘会双重缩放；
  //   但接触伤害同样吃这 ×2？否——×2 只在 Projectile.Damage_EVP（弹幕侧），
  //   接触侧是 Player.Hurt 直入（Enemy.def.damage 已是 ScaleStats 终值）。
  //   ★BJ710-C 件1（2026-10-25 用户转报核验）：!reflected 门此前缺失——反射弹
  //   （reflectProjectile :937 置 reflected=true+hostile=true 后确实走本函数敌面）
  //   曾在专家被 ×2(缩放)×2=×4、大师 ×6，原版反射弹跳过缩放只吃末尾恒 ×2。
  //   门序=原文亲读：banner/resistCold 段【无】reflected 门（:14905-14912——
  //   反射弹照吃旗减伤/寒冷减伤），唯缩放段有门。旧注「本函数调用方均为 hostile
  //   弹幕，无 reflected 路径」系陈旧错注（反射弹 hostile=true 即达），随刀勘正。
  const evpDmg = pvp
    ? dmg
    : ((self as { reflected?: boolean }).reflected
      ? dmg
      : hostileProjectileDamage(dmg, mainDifficulty(game.world))) * 2;
  // ★BJ710-G35 D7a（2026-10-25）：Dead Man's Sweater && trap 减半 + 300 帽
  //  （:14919-14922 `if (Main.player[myPlayer].deadMansSweater && trap) { num3 =
  //  (int)(num3 * 0.5f); num3 = Math.Min(num3, 300); }`——在 ×2 【后】、Hurt 前）。
  //  sweater 旗 = equipStats.deadMansSweater（SW-AC1 单源,胸甲 vi_5007）;trap 形参
  //  由 TrapShot 族/1049 冰雹传 true。★pvp=Damage_PVP 无此段（:14637-14845 区间
  //  无 sweater 面）;reflected 无门（原文无——反射陷阱弹照吃,仓内 TrapShot 传
  //  !reflected 系既有分歧行为,登记勿在本刀改）。12 落星/108·1002 自伤/1091 雷
  //  三面各有已建模消费点（FallingStar 内联/selfHurtSweaterCap/lightningEvpFinalDamage）。
  const sweaterDmg = !pvp && trap
    && (p as unknown as { equipStats?: { deadMansSweater?: boolean } }).equipStats
      ?.deadMansSweater === true
    ? Math.min(Math.trunc(evpDmg * 0.5), 300)
    : evpDmg;
  let dealt = 0;
  if (noCheese) {
    // ★Boss 面⑥：452/454/455/462 等走独立 BossNoCheese 槽（damageEvPNoCheese 内部
    // 经 __swNextHitBucket 注入——门/写两面都在 Player.damage 原位发生）。该路径下
    // iframes 不动，落地判定改读实扣值（= 原版 Hurt 返回 num>0 语义）。
    dealt = damageEvPNoCheese(game, sweaterDmg, self.x + self.w / 2, self.y + self.h / 2);
  } else {
    // pvp=true 不乘敌弹难度缩放与 ×2——那是 Damage_EVP（NPC 敌弹）专属（:14912-14917）；
    // 玩家 PvP 弹走 Damage_PVP 的 Main.DamageVar 直传
    game.damagePlayer(sweaterDmg, self.x + self.w / 2, self.y + self.h / 2, undefined, false, pvp);
  }
  // 成就：陷阱弹致死（Projectile.cs:13804-13808 trap→trapDebuffSource，死则
  // HandleSpecialEvent(4) WATCH_YOUR_STEP；仅 trap 类、非反射弹）
  if (trap && (p.dead || p.hp <= 0)) {
    game.achievements?.handleSpecialEvent(4,
      { statLifeMax: p.maxHp, statManaMax: p.maxMana });
  }
  // damage 落地才置无敌帧（闪避不置，对应 Hurt 返回 0）；BossNoCheese 弹不吃
  // iframes 位（无 "ifr>0 早退"），落地判定 = 实扣值 dealt>0
  return noCheese ? dealt > 0 : p.iframes > ifr;
}

// ================= 弹幕反射管线（原版 Projectile.cs:12781-12791 + NPC.cs:67156-67212；1456 行号 :12050-12060/:67003-67059——BJ710-C 勘正 1457 锚） =================

/** 可反射 aiStyle 白名单（Projectile.CanBeReflected，Projectile.cs:20224）：
 *  1 箭/子弹直飞弹、2 抛物线投掷物、8/21/24/28/29/131 各特化直线弹。
 *  另有 type 728（超级星星）/955（坠落星）无条件可反射（:20220）。 */
const REFLECTABLE_AI_STYLES = new Set([1, 2, 8, 21, 24, 28, 29, 131]);

/** 可反射弹体（调用方自报运动学字段；hostile/reflected/damage 参与门禁） */
export interface ReflectableProj {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  damage: number;
  hostile?: boolean;
  /** 已反射标记（本仓显式防重复；原版靠 friendly→hostile 翻转天然拦截二次反射） */
  reflected?: boolean;
}

/** 原版 Projectile.CanBeReflected（Projectile.cs:20216-20230）：
 *  active && friendly && !hostile && damage>0，且 type∈{728,955} 或
 *  aiStyle∈{1,2,8,21,24,28,29,131}。本仓 friendly 无字段——非 hostile 即友方。 */
export function projCanBeReflected(
  projId: number,
  proj: Pick<ReflectableProj, 'hostile' | 'damage'>,
): boolean {
  if (proj.hostile || !(proj.damage > 0)) return false;
  if (projId === 728 || projId === 955) return true;
  return REFLECTABLE_AI_STYLES.has(projectileData(projId)?.aiStyle ?? -1);
}

/** 原版 NPC.ReflectProjectile（1457 NPC.cs:67189-67212；1456 :67036-67059——
 *  BJ710-C 勘正 1457 锚）：
 *  - 音效 Item150 + 尘 31×3（velocity×0.3，:67191-67196）；
 *  - reflected=true、friendly=false、hostile=true（owner 不变——"朝发射者"
 *    方向读 Main.player[owner]，本仓单主角恒为 game.player；hostile 翻转后
 *    反射弹走 hitPlayer 敌面——:966 早退门放行、Damage_EVP 全链照走）；
 *  - 速度 = normalize(归一随机方向×原速 + 朝发射者×(原速×20)) × 原速（:67200-67208
 *    ——vector=unit(朝发射者)×oldVelocity.Length,偏置=vector×20;随机项先
 *    Normalize 再×原速,故锥角恒 ≤2.9°(atan(1/20))、终速恒 |oldVelocity|。
 *    ★BJ716-A 2026-10-25 勘误（R15-P2-5）：旧式 unit×20 裸值+随机项未归一×speed
 *    ——速 ≥10 锥宽暴涨、速 >~28 随机项主导可反向飞离玩家;原速取
 *    oldVelocity.Length,此处用当前速度近似（既有登记近似保持））；
 *  - damage ÷2 两次（int 语义 ≈ ÷4）+ penetrate=1（:67209-67211，穿透归一，
 *    穿透字段的清理由调用方按各自存储执行）。 */
export function reflectProjectile(proj: ReflectableProj, game: GameHooks): void {
  const cx = proj.x + proj.w / 2, cy = proj.y + proj.h / 2;
  // Item_150 未入音效提取库（public/sounds 无此 wav）：playSfxFile 未命中静默，
  // 回退 tink（Tink_0/1 金属弹开近似）——素材补齐后自动切真声
  if (!game.playSfxFile?.('Item_150', 1, cx, cy)) game.playSfx('tink', 0.9, cx, cy);
  game.spawnParticles(cx, cy, '#D8D8E0', 3, 0.6, { life: 24, damp: 0.9 });
  proj.reflected = true;
  proj.hostile = true;
  // 反射向量（1457 NPC.cs:67200-67208；1456 :67047-67055）
  const p = game.player;
  const speed = Math.hypot(proj.vx, proj.vy);
  let ox = p.cx - cx, oy = p.cy - cy;
  const od = Math.hypot(ox, oy);
  if (od > 0.001) { ox /= od; oy /= od; }
  else if (speed > 0.001) { ox = -proj.vx / speed; oy = -proj.vy / speed; } // 重合退化:原路弹回
  else { ox = 0; oy = -1; }
  // 随机方向 = Main.rand.Next(-100,101) 双轴采样后【Normalize】（:67202-67204——
  //  归一随机单位向量×|v|）;偏置 = unit(朝发射者)×(|v|×20)（:67200/:67205-67206
  //  vector 先乘 oldVelocity.Length 再 ×20——★BJ716-A 勘误:旧式 unit×20 裸值+
  //  随机项未归一×speed,速>20 随机项主导=锥宽爆表/可反向飞离;修后锥恒 ≤2.9°
  //  (atan(1/20)),终速恒 |oldVelocity|）
  const rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1;
  const rl = Math.hypot(rx, ry);
  const ux = rl > 0 ? rx / rl : 0, uy = rl > 0 ? ry / rl : 0;
  let dx = ux * speed + ox * speed * 20, dy = uy * speed + oy * speed * 20;
  const dl = Math.hypot(dx, dy);
  if (dl > 0.001) { proj.vx = (dx / dl) * speed; proj.vy = (dy / dl) * speed; }
  else { proj.vx = ox * 6; proj.vy = oy * 6; } // 零速退化:低速直飞回发射者
  // 伤害衰减（int 连除两次）+ penetrate=1（:67209-67211；1456 :67056-67058）
  proj.damage = Math.floor(Math.floor(proj.damage / 2) / 2);
}

/** 弹体命中敌怪分支的反射门禁 + 执行（原版 1457 Projectile.cs:12781-12791（1456 :12050-12060）：
 *  flag6 = targetNPC.reflectsProjectiles（getGoodWorld 星弹特例未接入——运行时
 *  无 FTW 标志），命中重叠本身即 NPC.CanReflectProjectile 的 Hitbox 相交）。
 *  返回 true = 已反射，调用方跳过本次伤害结算并结束本帧命中迭代
 *  （对应原版 keepIterating=false; return）。 */
export function tryReflectProjectile(
  proj: ReflectableProj,
  projId: number,
  e: { reflectsProjectiles?: boolean },
  game: GameHooks,
): boolean {
  if (!e.reflectsProjectiles) return false;
  if (proj.reflected) return false; // 显式防重复（原版由 hostile 翻转天然拦截）
  if (!projCanBeReflected(projId, proj)) return false;
  reflectProjectile(proj, game);
  return true;
}

/** ★SW-BJ62（2026-09-11）：微光史莱姆 676 命中后反射支（原版 Damage_PVE_Inner 尾部
 *  Projectile.cs:13721-13725，1456 :12830-12834 / 1458 :13722-13726 三基线同值）：
 *  `if (flag8 && active && timeLeft > 10 && targetNPC.active && targetNPC.type == 676
 *  && CanBeReflected()) { targetNPC.ReflectProjectile(this); penetrate++; }`
 *  ★与 tryReflectProjectile（1457 :12781-12791 事前支）不同域——676 全 SetDefaults/AI
 *  【零】置 reflectsProjectiles（1457 NPC.cs grep 全量核），故事前支对 676 恒不触发；
 *  本支位于 StrikeNPC（:13706）【之后】、穿透外层递减之前 ⇒ 原版语义 = 微光史莱姆
 *  吃弹掉血【同时】把弹打回玩家（伤害 ÷4、hostile 翻转、速度=|原速| 向玩家偏置 20 权重），
 *  penetrate++ 补偿本次命中穿透消耗（弹以剩余 1 穿透存续弹回）。
 *  门禁逐值：flag8 = !targetNPC.immortal（:12740 一带声明）；timeLeft > 10（弹将
 *  到期不救）；targetNPC.active = 命中已发生即真（原版杀死击仍反射——StrikeNPC 不
 *  立即失活，本仓 hurt 后不读 dead 同语义）；CanBeReflected = projCanBeReflected。
 *  调用点 = 各命中管线 hurt() 之后（Arrow :8130 递减前 / WeaponProj hurt 后 /
 *  Dart hurt 后）；返回 true 时调用方须自补穿透（Arrow pierce=1+pierce++，原版
 *  penetrate=1（NPC.cs:67212）+penetrate++（:13724）→ 外层递减后剩 1 同拍）。 */
export function tryReflectShimmerSlimeHit(
  proj: ReflectableProj,
  projId: number,
  e: { vanillaId?: number | null; immortal?: boolean },
  game: GameHooks,
  timeLeft?: number,
): boolean {
  if ((e.vanillaId ?? null) !== 676) return false;
  if (e.immortal === true) return false;              // flag8 = !targetNPC.immortal
  if (timeLeft !== undefined && timeLeft <= 10) return false;   // Projectile.cs:13721 timeLeft>10
  if (proj.reflected) return false;                   // hostile 翻转天然拦二反（本仓显式）
  if (!projCanBeReflected(projId, proj)) return false;
  reflectProjectile(proj, game);
  return true;
}

/** 敌弹命中玩家的状态授予(原版 Projectile.StatusPlayer :11450-11722 **全量**,
 *  仅在 hitPlayer 返回 true 即 Hurt>0 且未死后调用——调用点 Game.ts 敌弹命中段)。
 *  数值表 = tools/extract-statusplayer.mjs 从 1457 源码提取的 AST
 *  (src/data/vanilla-statusplayer.json,51 弹型/44 块/零跳过+StatusPvP 1127 重放,提取带护栏;
 *   ★BJ183 2026-09-20 基准 1456→1457):
 *   1078 陨石碎块 → OnFire(24) 300-599t（:11456-11458）
 *   285 纳米弹 → Confused(31) 1/3→180t 否则 60t,双块(!hostile 块 :11622-11631)
 *   1048 配重球 → Poisoned(20)+Stinky(120) 各 600t（:11471-11474）
 *   669 麦酒 → Confused(31) 1/20 → 120-300t（:11476-11478）
 *   119/359 冰晶刃/冰晶杖 → Frostburn2(324) 240/420t（:11480-11486）
 *   188 火焰陷阱 → OnFire3(323) 1200t（:11488-11490）
 *   472 黑隐士吐网 → Webbed(149) 30-149t（:11492-11494）
 *   961 鹿角怪冰锥 → Frozen(47) 20t（:11496-11498）
 *   467 异教徒火球 → OnFire(24) 30-149t（:11500-11502）
 *   581 星旋酸弹 → VortexDebuff(164) 专家 300-539t/经典 50% 360-719t（:11504-11514）
 *   687 贝蒂吐息 → OnFire(24) 420-600t（:11515-11517）
 *   258 火球 → OnFire(24) 50% → 300-420t（:11519-11521）
 *   572 蝾螈喷毒 → Poisoned(20) 2/3 → 120-239t（:11523-11525）
 *   276 世纪之花毒种子 → Poisoned(20) 专家必中/经典 50%（:11527-11535）
 *   436 脑部干扰弹 → Confused(31) Next(5)>=2 → 300t（:11538-11540）
 *   435 火星炮塔弹 → Electrified(144) 2/3 → 300t（:11542-11544）
 *   682 DD2 萤火虫电击 → WitheredWeapon(196) 300t（:11546-11548）
 *   437 千兆电枪矛 → Electrified(144) 240-480t（:11550-11552）
 *   348 霜涛 → Chilled(46) 1/2→600/300t + Frozen(47) 三级顺序掷骰（:11554-11576）
 *   349 霜晶 → Chilled(46) 1/3→600t、否则 1/2→300t（:11580-11588）
 *   399-402 燃烧瓶族(!hostile 自伤) → OnFire(24) 180-360t（:11591-11593）
 *   55 刺球 / 719 蜂后刺针 → Poisoned(20) 1/3→600t 否则专家 60-299t（:11595-11604）
 *   44 恶魔镰刀 → Darkness(22) 1/3 → 900t（:11606-11608）
 *   293 迷失之魂 → Blackout(80) 120-360t（:11610-11612）
 *   299 暗影焰 → Cursed(23) 240t（:11614-11616）
 *   82 燃烧箭 → OnFire(24) 1/3 → 420t（:11618-11620）
 *   96 诅咒焰/101 恶魔眼火 → CursedInferno(39) 三级顺序掷骰（:11633-11647）
 *   288 金浴 → Ichor(69) 900t（:11648-11650）
 *   253 霜球(!hostile) → Frostburn2(324) 600t（:11652-11654）
 *   291/292 地狱火 → OnFire(24) 480-900t（:11656-11658）
 *   98 毒镖/1073 史莱姆毒镖 → Poisoned(20) 600t（:11660-11662）
 *   1053 熔岩巨砾 → OnFire(24) 300t（:11664-11666）
 *   184 毒镖陷阱 → Poisoned(20) 900t（:11668-11670）
 *   980 毒液镖陷阱 → Venom(70) 300t（:11672-11674）
 *   290 暗影光束 → Slow(32) 300-900t（:11676-11678）
 *   174 冰锥 → Chilled(46) 1200t + !frozen 门 Frozen 两级（:11680-11690）
 *   257 霜束 → Chilled(46) 2700t + !frozen 门 Frozen 1/5→60t（:11692-11698）
 *   177 冰水喷吐 → Chilled(46) 1500t + !frozen 门 Frozen 30-119t（:11700-11706）
 *   128 冰爆 → Frostburn(44) 1/3 → 360t（:11708-11710）
 *   176 丛林尖刺 → Poisoned(20) 1/4→1200t 否则 1/2→300t（:11712-11720）
 *  GAP：ApplyBuffTo 的 trap&&deadMansSweater 减半(:11729-11733)——"死人毛衣"
 *  配件未移植；creativeGodMode 入口门(:11452-11454)——创意上帝模式字段未建模。
 *  玩家侧 buff 免疫链(buffImmune,黑曜石皮防火等)在 BuffState.apply 无门,
 *  独立缺口登记(Player.AddBuff :5088-5092 buffImmune 早退)。 */

/** AST 条件原子：{r:[K,cmp,阈值?]} = Main.rand.Next(K) 与阈值比较(eq/ne/ge)；
 *  {expert:1} = Main.expertMode；{hostile:0} = !hostile；{frozen:0} = !player.frozen */
interface SPCond { r?: [number, 'eq' | 'ne' | 'ge', number?]; expert?: 1; hostile?: 0; frozen?: 0 }
/** AST 门/链节点：g=外层门(全 atom 成立进 t/i,否则进 e) / t=then 体 / i=else-if 链
 *  (首全成 arm,全落空进 e) / a=顺序全执行 */
interface SPNode {
  g?: SPCond[];
  t?: SPElem;
  i?: Array<{ g?: SPCond[]; t: SPElem }>;
  a?: SPElem[];
  e?: SPElem;
}
/** AST 叶子：ApplyBuffTo(player, b, d)（b 为原版 buff id，d 见 spDurTicks） */
interface SPLeaf {
  g?: SPCond[];
  b: number;
  d: number | { n: [number, number]; m?: number };
}
type SPElem = SPNode | SPLeaf;
const SP_TABLE = statusPlayerJson as unknown as Record<string, SPElem>;

/** Main.rand.Next(K)：含头不含尾的整数掷骰（Math.random()×K 取整精确等价） */
const spNext = (k: number): number => Math.floor(Math.random() * k);

/** 求值上下文：hostile=弹体敌对标志(Damage_EVP 路径恒 true,爆炸自伤路径 false)；
 *  expert=专家难度；frozen=player.frozen 两源(buff 47 :9749 / 微光化 353 :11382) */
interface SPCtx { hostile: boolean; expert: boolean; frozen: boolean }

/** 条件门求值：原子逐个判,任一不成立即 false */
function spGateOk(atoms: SPCond[] | undefined, ctx: SPCtx): boolean {
  if (!atoms || !atoms.length) return true;
  for (const at of atoms) {
    if (at.r) {
      const [k, cmp, thr = 0] = at.r;
      const v = spNext(k);
      if (cmp === 'eq' ? v !== thr : cmp === 'ne' ? v === thr : v < (thr ?? 0)) return false;
    } else if (at.expert) {
      if (!ctx.expert) return false;
    } else if (at.hostile === 0) {
      if (ctx.hostile) return false;
    } else if (at.frozen === 0) {
      if (ctx.frozen) return false;
    }
  }
  return true;
}

/** 时长求值：常量=tick 数；{n:[a,b]}=Next(a,b)；{n,m:60}=60×Next(a,b)（含头不含尾） */
function spDurTicks(d: SPLeaf['d']): number {
  if (typeof d === 'number') return d;
  const v = d.n[0] + Math.floor(Math.random() * (d.n[1] - d.n[0]));
  return d.m ? d.m * v : v;
}

/** AST 求值：命中后按原版逐块顺序掷骰并 AddBuff(max 合并由 BuffState.apply 保证)。
 *  未实装 buff（buffTypeByVanilla 查无）静默跳过——登记见 Buffs.ts 枚举注释 */
function spEval(node: SPElem, ctx: SPCtx, buffs: BuffState): void {
  if ('b' in node) {
    // 叶子可带外层门(如 436 的 Next(5)>=2),门不过即整叶跳过
    if (node.g && !spGateOk(node.g, ctx)) return;
    const t = buffTypeByVanilla(node.b);
    if (t === undefined) return;
    buffs.apply(t, spDurTicks(node.d) / 60);
    return;
  }
  if (node.g && !spGateOk(node.g, ctx)) {
    if (node.e) spEval(node.e, ctx, buffs);
    return;
  }
  if (node.i) {
    for (const arm of node.i) {
      if (spGateOk(arm.g, ctx)) { spEval(arm.t, ctx, buffs); return; }
    }
    if (node.e) spEval(node.e, ctx, buffs);
    return;
  }
  if (node.a) {
    for (const child of node.a) spEval(child, ctx, buffs);
    return;
  }
  // 纯 then 节点（{g, t[, e]}）：门已过/无门 → 执行 t
  if (node.t) spEval(node.t, ctx, buffs);
}

/** 敌弹命中玩家 → debuff 结算（Projectile.StatusPlayer :11450-11722 全量,表驱动）。
 *  hostile 缺省 true = Damage_EVP 调用点语义（:13708 门禁 hostile 弹才走到这里）；
 *  爆炸/自伤路径（BombsHurtPlayers :13944-13983,无 hostile 门）应显式传弹体
 *  实际 hostile 标志（如燃烧瓶族 399-402 的 !hostile 分支 :11591-11593）。 */
export function statusPlayer(game: GameHooks, projId: number, hostile = true): void {
  const p = game.player;
  const node = SP_TABLE[String(projId)];
  if (!node) return;
  spEval(node, {
    hostile,
    expert: mainExpertMode(game.world),
    frozen: p.buffs.has(BuffType.Frozen) || p.shimmering, // :9749 / :11382 双源
  }, p.buffs);
}

// ================= ★GC1 弹幕域 immune[owner] 写方桥（清零批二波，2026-08-31；
//                     蓝队二轮 F1/F5：face 补表自动解析，2026-08-31） =================

/** Projectile.Damage 命中尾免疫档 → Game.noteNpcPlayerImmune 统一写出口。
 *  档位纯表见 data/vanillaProjImmuneTiers.ts（1457 Projectile.cs:14031-14183 亲读
 *  提取）；三旗 face 纯代码补表见 data/vanillaProjImmuneFaces.ts（F5——json 无三
 *  布尔列，SetDefaults :699-10676 全量抓取）。face 解析序：
 *   调用点显参 true 恒覆盖 > 补表值 > 全缺省（走末档数据面判定）。
 *  game.noteNpcPlayerImmune 缺位（测试桩/工具调用面）静默跳过。
 *  penetrate 入参约定 = 写段时刻未递减现存值（Projectile.cs:14189 在梯子后）；
 *  缺省回落数据面 penetrate ?? 1（单发 flag3 族缺省 → 无写）。 */
export function noteVanillaProjImmune(
  game: { noteNpcPlayerImmune?: (npcId: number, ticks: number) => void;
    player?: unknown } | null | undefined,
  type: number,
  npcId: number,
  opts?: { penetrate?: number | null; localFace?: boolean; idStaticFace?: boolean },
): void {
  if (!game || type <= 0 || !(npcId >= 0)) return;
  // F5：SetDefaults 三旗补表（显参不遮蔽——false 视为「未传」，true 权威）
  const f = projImmuneFaceOf(type);
  const cdCol = projectileData(type)?.localNPCHitCooldown;
  const localOk = f?.usesLocal === true && cdCol !== -2;      // （梯子 :14175 的 cd!=-2 门）
  const localFace = opts?.localFace === true || localOk;
  const idStaticFace = opts?.idStaticFace === true || f?.idStatic === true;
  const appliesSingleHit = f?.applies === true;               // 登记源仅补表（167-170/286/1134）
  const pen = opts?.penetrate ?? projectileData(type)?.penetrate ?? 1;
  let ticks = projGlobalImmuneWriteTicks(type, {
    ...opts, penetrate: pen, localFace, idStaticFace, appliesSingleHit,
  });
  if (ticks === PROJ_IMMUNE_SLOW_MAGIC_TIER) {
    // 632：GetSlowMagicUseTime(5)（Projectile.cs:14056——慢施蓝空过载放大窗）
    const pl = game.player as { getSlowMagicUseTime?: (t: number) => number } | undefined;
    ticks = pl?.getSlowMagicUseTime ? Math.max(5, Math.trunc(pl.getSlowMagicUseTime(5))) : 5;
  }
  if (ticks < 0) return;                          // 无写档（单发 flag3/标枪族等）
  game.noteNpcPlayerImmune?.(npcId, ticks);
}

// ================= ★E dontHurtCritters 统一谓词出口（清零批二波，2026-08-31） =================
// 唯一标杆：Player.CanNPCBeHitByPlayerOrPlayerProjectile（1457 Player.cs:20673-20689）
// + NPC.IsCritterThatIsHostileToPlayers（NPC.cs:19849-19856）+
// NPCID.Sets.CritterThatCanTurnOnPlayers（Terarria1457/Terraria.ID/NPCID.cs:4781）。
// 禁止各消费面散抄本判定——近战三重门 / 坐骑矿车·踩踏·横向 / 弹幕族一律经本出口。

/** CritterThatCanTurnOnPlayers 成员（NPCID.cs:4781）：敌对小动物群系变体十型。
 *  IsCritterThatIsHostileToPlayers = 成员 ∧ aiStyle==3（行走 AI 才会翻身咬人） */
export const CRITTER_TURN_ON_PLAYERS_TYPES = new Set<number>([645, 639, 644, 642, 643, 641, 640, 299, 539, 538]);

export function isCritterThatIsHostileToPlayers(e: unknown): boolean {
  // ★F2（2026-08-31）运行时位兼读：松鼠系 SetDefaults 恒 aiStyle=7（NPC.cs:12892-96
  //  type==299 块），黑化是 AI_007 运行时变异（NPC.cs:53958-53974 CritterThatCanTurnOnPlayers
  //  ∧ ai[3]!=0 → lifeMax 25/damage 20/defense+6/**aiStyle=3**，运行时翻转不走 def）——
  //  静态 def.aiStyle 判据恒假。真实源 = Enemy 升级路径写入的 blackenedCritter 位；
  //  def.aiStyle===3 臂保留给"数据面就是行走 AI"的形态（原版 IsCritterThatIsHostileToPlayers
  //  读的是 NPC 实例 aiStyle,两侧同真值域）
  const t = e as { vanillaId?: number | null; def?: { aiStyle?: number };
    blackenedCritter?: boolean } | null | undefined;
  return t?.vanillaId != null && CRITTER_TURN_ON_PLAYERS_TYPES.has(t.vanillaId)
    && (t.blackenedCritter === true || t.def?.aiStyle === 3);
}

/** CountsAsCritter 成员源：def.critter 提取表旗（vanillaNpcs.ts:84,
 *  tools/extract-critters.mjs）∪ 小动物桶标记（spawnNpcByVanilla 落 critters 桶的
 *  Enemy 实例——原版同一 CountsAsCritter 数组域）。fromCritterBucket 由扫掠面注入 */
export function countsAsCritterOf(e: unknown, fromCritterBucket: boolean): boolean {
  const t = e as { def?: { critter?: boolean } } | null | undefined;
  return fromCritterBucket || t?.def?.critter === true;
}

/** CanNPCBeHitByPlayerOrPlayerProjectile 完整形（Player.cs:20673-20689）。
 *  玩家实体面（projectile=null）：flag=dontHurtCritters。弹幕面（SW-R3 2026-09-03
 *  蓝队 M-3 扩展,proj 传 {projId,trap,minion?,sentry?}）：flag=dontHurtCritters ∪
 *  (minion|MinionShot[projId]|sentry|SentryShot[projId])（:20675,爆炸族非仆从/哨塔
 *  = 不进或）；随后 trap 弹复位可打（:20677-20678）。敌对小动物复权与
 *  CountsAsCritter∧flag 拒收两面共享。返回 false = 该实体对本玩家【不可命中】。 */
export function playerProjectileCanHitNpcGate(
  game: { player?: unknown },
  e: unknown,
  fromCritterBucket = false,
  proj?: { projId?: number; trap?: boolean; minion?: boolean; sentry?: boolean },
): boolean {
  // ★IIIII248:projScanEq(game.player) = 桶窗快照 ?? 旧活读(game.player 直传面兼容)
  const eq = getProjScanCtx(game.player)
    ?? (game.player as { equipStats?: { dontHurtCritters?: boolean } } | null)?.equipStats;
  let flag = eq?.dontHurtCritters === true              // （:20675 玩家面）
    || (!!proj && (proj.minion === true || proj.sentry === true
      || (proj.projId !== undefined
        && (MINION_SHOT_PROJS.has(proj.projId) || SENTRY_SHOT_PROJS.has(proj.projId)))));
  if (proj?.trap === true) flag = false;                 // （:20677-20678 trap 复位）
  if (isCritterThatIsHostileToPlayers(e)) flag = false;   // （:20679 敌对生物复权）
  if (countsAsCritterOf(e, fromCritterBucket) && flag) return false;   //（:20683 拒收）
  return true;
}
