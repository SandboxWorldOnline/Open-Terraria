// 幽灵伤害头（Spectre Mask）on-hit 浮魂弹 + 弹 356 实体（2026-08-31 对齐批⑥）。
// 标杆 Terarria1457/Terraria/Projectile.cs（行号均指该树;1456 同构段 :12889 调用点/
// :11348 方法体）——本批把 vanillaArmorSets.ts:96 已登记的 `ghostHurt` 套装旗标
// 接通到命中管线：
//   触发链（Projectile.Damage → on-hit 段）：
//     Projectile.cs:13875  if (targetNPC.canGhostHeal | flag9)      —— flag9=调试假人项,
//                            DebugOptions.LetProjectilesAimAtTargetDummies 缺省 false;
//     Projectile.cs:13881    if (Main.player[owner].ghostHurt)
//     Projectile.cs:13883      ghostHurt(num41, targetNPC.Center, targetNPC);
//   方法体 Projectile.ghostHurt(dmg, Position, victim)（:12021-12070）：
//     !magic || damage<=0 早退 → 传参 dmg 只做 `dmg>1` 门（防后实扣 StrikeNPC 返回值）
//     → Main.player[myPlayer].ghostDmg 预算池（cap 1500,Player.cs:24654 每拍 −6.6666665）
//     → 候选敌收集（怪癖距离式 + CanHit 双桶选择,下详）→ NewProjectile(356,…)
//   ⚠ ghostHurt 是「魔法弹命中侧释放追踪浮魂弹」伤害系套装机制,非死亡/转移系
//     （wiki 的"Death Rattle"印象不成立——触发点在 Damage() 内于目标存活路径上,
//      与 NPC 死亡无关）。命中侧位置 = 受害者 Center。
//   弹 356（SetDefaults :4466-4475）：6×6、aiStyle 59、alpha 255、magic、tileCollide=false、
//     extraUpdates=3、【无 friendly】——AI_059 里 ai[1]≥60 才置 friendly=true（:29371;
//     ★三轮蓝队 F2：EU 子步语义修正后 ai[1] 每拍 +4 ⇒ 预热 60 计数≈15t,非旧注 60t）;
//     默认 timeLeft 3600（Projectile.cs:789 无覆写;timeLeft-- 在子步循环内 :17309
//     ⇒ 每拍 -4,寿命 900t 非旧注 3600t）。
//   AI_059（:29368-29431）：≥60t 后每拍校验锁 ai[0]（CanBeChasedBy 门）;失效重选 =
//     怪癖曼哈顿窗 <800 全候选【随机】取一（Main.rand）;全空 Kill。转向 (v×29+dir)/30
//     （num447=30,speed num442=4）。尘 175 ×5 后向拖尾（:29417-1457/:29385-1458,
//     v×0.2×i 反向排布）。
//   绘制保真（2026-08-31 平涂扫描批）：弹体本体在原版【不可见】——SetDefaults alpha=255
//     且 GetAlpha（Projectile.cs:80596 起）对 type356 无任何特判 → 走缺省尾
//     （:81509-81521）rgb×(255−255)/255=0、A=max(0,光色A−255)=0 ⇒ Color(0,0,0,0),
//     DrawProjDirect 通用支（Main.cs:35485）即使画出也全透明。盘上
//     public/sprites/vanilla/Projectile_356.png 为 1×1 占位 stub(素材缺家族,
//     Projectile_357/358 同),无贴图可转正——可见外观全部来自 AI_059 的尘 175 拖尾
//     （本文件已逐粒精确化,type175=原版 Spectre 尘,Dust.cs:869 scale−0.05/t）。
//     故 draw() 为文档化空实现（禁再加平涂圆点——台账 approx-registry C 档点名件）。
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { canHit } from '../physics/LineOfSight';
import { canBeChasedBy, playerCanHitEnemy, hitCritters, applyBannerDamageDealt, hitTownNpcs } from './projTargets';   // ★BJ729-A（D1 B29）：城镇 voodoo 靶
import { cutTilesBox } from './ProjCutTiles';
// ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-06 武器弹簇接入批）
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { runModModifyHitNpcByProj } from '../mods/hooks';   // ★D2:独立结算面补钩

/** NPC.canGhostHeal=false 族（NPC.cs SetDefaults 写点——NPC.cs:6270 字段缺省 true；
 *  false 站点 :13921(type384)/:13961(type387)/:13978(type388)/:15839(type523)）。
 *  除该族外全部可触发幽灵套 proc（SpectreHealing/Hurt 共用此门）。 */
export const SPECTRE_NO_GHOST_HEAL = new Set<number>([384, 387, 388, 523]);

/** victim.canGhostHeal | flag9 门（:13875）。flag9 = DebugOptions.LetProjectilesAimAtTargetDummies
 *  命中的训练假人豁免（该调试项缺省 false→假人 488 默认不可 heal/hurt proc）*/
export function spectreVictimEligible(victimVanillaId?: number | null): boolean {
  return !(victimVanillaId !== undefined && victimVanillaId !== null
    && SPECTRE_NO_GHOST_HEAL.has(victimVanillaId));
}

/** ★BJ157-④：PVE 受理命中计数读取（PVP ghostHeal 的 numHits 实参单源）。原版
 *  Damage_PVP【不】自增 numHits（numHits++ 仅 Damage_PVE_Inner :14263）——
 *  :14741-44 ghostHeal 读弹幕当前计数（=该弹 PVE 累计受理命中数,PVP 命中不入账），
 *  新弹 0 档率 0.20（SetDefaults :706 numHits=0;旧硬编 1 = 首跳 0.15 off-by-one）。
 *  未跟踪类/脏值（非有限正数）按 0 档 */
export function projPveNumHits(pr: unknown): number {
  const n = (pr as { pveNumHits?: number } | null)?.pveNumHits;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** ★BJ382（2026-09-28）ghostHeal proc 单源习语——BJ380 定谳于 LunarNebula.ts（私有），
 *  per-class 补课批（239/245/255/260/461/632/535/656/856）提升为本域导出，逐弹类
 *  接线沿同式（proc 先于 numHits++；拒收不 proc 不计数）。
 *  定谳（Terarria1457/Terraria/Projectile.cs）：原版吸血链在 Projectile.Damage()
 *  通用 on-hit 段【无弹号白名单】——
 *    :13712 flag10 = num41>0 ∧ targetNPC.lifeMax>5 ∧ friendly ∧ !hostile ∧ aiStyle≠59
 *    :13875 if (targetNPC.canGhostHeal | flag9)
 *    :13877 if (Main.player[owner].ghostHeal && !moonLeech) ghostHeal(num41, victimCenter)
 *  实参口径（BJ157-① MagicProj 习语 + BJ167-②③④ 实参）：
 *    dmg = num41 等位（Enemy.lastStrikeDealt,防后实扣,入口清零 Enemy.ts:13959）
 *    numHits = 自增前受理命中数（:14263 numHits++ 在 proc 块【后】⇒ 首跳 0 档率 0.20）
 *    出生点 = 受害者 Center（:13879 new Vector2(targetNPC.Center.X,.Y)）
 *  victim 门 = spectreVictimEligible（canGhostHeal=false 族 384/387/388/523,
 *  NPC.cs:6270 缺省 true）;flag10 的 lifeMax>5 段按 maxHp/def.lifeMax 容缺核对;
 *  旗标门（setBonus.ghostHeal/月噬/预算池 70|80/非魔法扣预算不回复 :12090-12093）
 *  由 Game.applyLifeSteal 单源自证。 */
export interface GhostHealVictimLike {
  x: number; y: number; w: number; h: number;
  vanillaId?: number | null;
  lastStrikeDealt?: number;
  maxHp?: number;
  def?: { lifeMax?: number };
}
/** ★BJ385 flag10 lifeMax>5 段单源门（Terarria1457/Projectile.cs:13712）：
 *  flag10 = num41>0 ∧ targetNPC.lifeMax>5 ∧ friendly ∧ !hostile ∧ aiStyle≠59 ——
 *  304 吸血鬼飞刀 vampireHeal（:13877-78）与 ghostHeal（:13879）同在 flag10 块内。
 *  本仓 num41>0 由 applyLifeSteal floor 后拒承载;friendly/!hostile/aiStyle≠59 段
 *  ★S2-债1（2026-10-01）起由 ghostHealProc 数据门自证（旧注「调用方路径承载」随
 *  magic 预门撤销作废——1091 hostile 面曾靠预门双职过滤）;本门补 lifeMax>5 段
 *  （critter 一击致死小血量族不 proc）。
 *  maxHp/def.lifeMax 均缺 = 容缺放行（mock 桩面零漂移;实体 Enemy 恒有 maxHp）。
 *  BJ380 定谳于 LunarNebula.ts 私有式,BJ385 提升为域导出供三老站
 *  （MagicProj BJ157-① / Arrow BJ167 / MissileProj BJ167）统一补门 */
export function vanillaFlag10LifeMaxOk(e: { maxHp?: number; def?: { lifeMax?: number } }): boolean {
  const lifeMax = e.maxHp ?? e.def?.lifeMax;
  return lifeMax === undefined || lifeMax > 5;
}

// ---- vanillaGated 门位读前置快照（★清偿刀 T,2026-09-29,X4-债12 族级残差）----
// 病灶（清偿刀 R 定谳,本刀推广全族）：受理面谓词的门位判据必须是「进入 hurt 之前的
// 状态」——原版免疫门 Projectile.cs:12634-12637（`targetNPC.immune[owner]==0`）与
// :12686（`targetNPC.dontTakeDamage`）都读【StrikeNPC 之前】的受害者态;proc
// （:13877-79）与 numHits++（:14263）在受理面无死亡复查。仓内后置读站（hurt 返值后
// 读 e.iframes/dontTakeDamage）会被 hurt 内写支污染,两源：
//   ① 受理写支（Enemy.ts:14297-14298 通用尾档 pierce≠-3/-2/1 写 10t）——pierce=0 站
//      （251/632/461/536/856）受理拍读恒真 → proc/numHits 恒跳（吸血域断供,同刀 R
//      「旧 pierce=0 受理写 10t」判谳;刀 R/L 以写支档位 -2/-3 治标,本刀以读前置治本）;
//   ② 死亡转换写支（Enemy.ts:14421,星璇四塔 517/422/507/493 血尽转演出写 iframes=2
//      ——原版形态 PrepareForDeathAnimation（NPC.cs:78835-78841）写 dontTakeDamage=true,
//      写支本身 1:1 禁改）——任何 pierce 档的致死命中撞上转换族都污染后置读。
// 处方：strike 调用【前】快照,返回后用快照判 vanillaGated。判别测试
// tests/debt-t-gate-snapshot.test.ts（塔转换致死命中 proc/入账照达+门拒面零回归）。
export interface VanillaGateSnapshot {
  iframes: number;
  dontTakeDamage: boolean;
}
/** strike 前置快照：读受害者门位字段（iframes/dontTakeDamage）冻结进判据。
 *  入参 duck-typed（unknown——各站弱型敌视图 EnemyLike/MedusaEnemy/内联桩无门位
 *  字段声明,缺字段=0/假（mock 桩同面）,与原后置读的 `?? 0`/`=== true` 容缺同构）。 */
export function snapshotVanillaGate(e: unknown): VanillaGateSnapshot {
  const t = e as { iframes?: number; dontTakeDamage?: boolean } | null | undefined;
  return { iframes: t?.iframes ?? 0, dontTakeDamage: t?.dontTakeDamage === true };
}
/** 受理面谓词（快照判据）：vanillaGated=门拒（iframes>0 / dontTakeDamage）。
 *  exemptIframes = flag3 臂（:12635 maxPenetrate==1 单发弹免疫门豁免——pierce==1
 *  调用方传 true,iframes 不再构成门拒,dontTakeDamage 照拦 :12686）。 */
export function vanillaGateRejected(s: VanillaGateSnapshot, exemptIframes = false): boolean {
  return (!exemptIframes && s.iframes > 0) || s.dontTakeDamage;
}

export function ghostHealProc(game: GameHooks, projId: number, numHits: number,
  e: GhostHealVictimLike): void {
  // ★S2-债1（2026-10-01,家族级清偿——R1-B 定谳存档 meleeOnHitProjs.ts:552-570 台账
  //  兑现）：旧 magic 预门（BJ382 习语）撤销。原版语义（Projectile.cs 亲读定谳）：
  //    :12090 `lifeSteal -= num2` 在 :12091-93 `if (!magic) return`【之前】,调用点
  //    :13877-79（Damage() 通用 on-hit 段）无类别门 ⇒ 非 magic PVE 命中在幽灵兜帽
  //    在身时【白扣治疗预算不出治疗球】=原版本相（「白耗」,非本仓建模差）。
  //  承载分工：扣不扣/治不治 = Game.applyLifeSteal（:43432 先扣/:43433 非魔法拒回复）
  //    ——isMagic 数据面忠实直传（PVP 中央面 FR6-F 同式）;flag10 投弹侧段（:13712
  //    friendly/!hostile/aiStyle≠59）数据门自证——1091 雷暴闪电（hostile=true,
  //    proc 站唯一非 magic 成员）旧靠 magic 预门双职过滤,摘门后显式承接（bj383
  //    1091 零行为锁保形）;aiStyle 59（浮魂弹 356/357/358 自身）同段防自噬。
  //    num41>0 段 = applyLifeSteal floor 后拒（既有契约）;lifeMax>5/victim 门照旧。
  const pd = projId > 0 ? projectileData(projId) : undefined;
  if (pd?.hostile === true) return;                      //（flag10 !hostile 段 :13712）
  if (pd?.aiStyle === 59) return;                        //（flag10 aiStyle≠59 段 :13712）
  if (!vanillaFlag10LifeMaxOk(e)) return;                //（:13712 flag10 lifeMax>5 段）
  if (!spectreVictimEligible(e.vanillaId)) return;
  game.applyLifeSteal?.('ghost', e.lastStrikeDealt ?? 0, numHits,
    e.x + e.w / 2, e.y + e.h / 2, pd?.magic === true);
}

// ---- 预算池（Player.ghostDmg,Player.cs:991/:24652-24660 1:1）----
// ★GB2 平移（GC 契约，2026-08-31）：唯一真源 = 本地玩家实例字段 player.ghostDmg
// （Player.fixedUpdate 每拍 −6.6666665，原版 Player.Update :24654 同位）。本模块
// 三函数接口作为读写缝保留：decayGhostBudget/_resetGhostBudgetForTest/
// ghostBudgetPeek 全部路由到 bindGhostBudgetHost 注入的宿主；未绑定（测试/工具
// 裸调面）回退模块级池 + 时间轴惰性衰减。生产链 Game 构造玩家时 bindGhostBudgetHost
// （幽灵域只涉及 Main.myPlayer 单人位——原版读写全部 Main.player[Main.myPlayer]，
//  Projectile.cs:12034/:12038）。
const GHOST_TICK_MS = 1000 / 60;              // Terraria 固定 60fps ⇒ 16.667ms/拍
const GHOST_DECAY_PER_TICK = 6.6666665;       //（:24655）
export const GHOST_BUDGET_CAP = 1500;         //（:12031 num3）

/** 预算池宿主形状：player 面字段 ghostDmg（float 域，可为负中间态由消费端钳 0） */
export interface GhostBudgetHost { ghostDmg: number }

/** 未绑定时的时间惰性回退池（仅测试/工具面；生产恒有 host） */
interface GhostLegacyPool {
  pool: number;
  lastMs: number;                             // -1 = 未初始化（首拍只锚不衰减）
}
const LEGACY_POOL: GhostLegacyPool = { pool: 0, lastMs: -1 };
export const GHOST_BUDGET: GhostLegacyPool = LEGACY_POOL;

let HOST: GhostBudgetHost | null = null;

/** 生产接线：把预算池真源钉到本地玩家（Game 创建/换玩家时调用）。传 null 回退模块池 */
export function bindGhostBudgetHost(host: GhostBudgetHost | null): void {
  HOST = host;
}

/** 解析当前池面 */
function budgetFace(player?: GhostBudgetHost | null): GhostLegacyPool | GhostBudgetHost {
  if (player && typeof (player as GhostBudgetHost).ghostDmg === 'number') return player;
  return HOST ?? LEGACY_POOL;
}

/** 读面前推进。player 面：衰减由 Player.fixedUpdate 按拍跑（原版 Update 内位置），
 *  此处只读钳负。legacy 面：时间轴惰性衰减（tests 工具面）。nowMs 可注入做确定性测试 */
export function decayGhostBudget(nowMs: number, player?: GhostBudgetHost): number {
  const f = budgetFace(player);
  if (f !== LEGACY_POOL) {
    // host 由 Player.fixedUpdate 推进 —— 时间戳参数无用武之地，保持读语义纯净化
    void nowMs;
    const v = (f as GhostBudgetHost).ghostDmg;
    return Math.max(0, v);
  }
  const b = LEGACY_POOL;
  if (b.lastMs < 0) { b.lastMs = nowMs; return b.pool; }
  const ticks = Math.floor((nowMs - b.lastMs) / GHOST_TICK_MS);
  if (ticks > 0) {
    b.pool = Math.max(0, b.pool - ticks * GHOST_DECAY_PER_TICK);
    b.lastMs += ticks * GHOST_TICK_MS;
  }
  return b.pool;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 入账（:12038 `Main.player[Main.myPlayer].ghostDmg += num`）。
 *  player 为可注入宿主（缺省走已绑定面） */
function addGhostBudget(amount: number, player?: GhostBudgetHost): void {
  const f = budgetFace(player);
  if (f !== LEGACY_POOL) {
    (f as GhostBudgetHost).ghostDmg = Math.max(0, (f as GhostBudgetHost).ghostDmg) + amount;
    return;
  }
  LEGACY_POOL.pool = Math.max(0, LEGACY_POOL.pool) + amount;
}

/** 测试专用：重置预算池并锚定时间轴（生产代码禁用）。pool 按原版语义代表
 *  ghostDmg 当前值；lastMs 置 -1 表示下一拍只锚不衰减 */
export function _resetGhostBudgetForTest(pool = 0): void {
  if (HOST) { HOST.ghostDmg = pool; return; }
  LEGACY_POOL.pool = pool;
  LEGACY_POOL.lastMs = -1;
}

/** 当前预算池读数（测试/调试用） */
export function ghostBudgetPeek(): number {
  return HOST ? HOST.ghostDmg : LEGACY_POOL.pool;
}

/** 玩家形状（鸭子类型：equipStats.setBonus 由 Player.computeEquipStats 直挂
 *  ARMOR_SET_BONUSES 条目,'156|66|55' 键位 ghostHurt=true） */
interface GhostPlayerLike {
  equipStats?: { setBonus?: { ghostHurt?: boolean } };
  dead?: boolean;
}
export function playerHasGhostHurt(player: unknown): boolean {
  const p = player as GhostPlayerLike | undefined | null;
  return !!(p && !(p.dead) && p.equipStats?.setBonus?.ghostHurt === true);
}

export interface GhostSrcCtx {
  /** Projectile.magic（Projectile.cs SetDefaults magic 位;vanilla-projectiles.json 列） */
  magic: boolean;
  /** dmgHooked_659（弹基伤——ghostHurt 内 `int num = damage` 用它当浮魂弹伤,:12025）*/
  projDamage: number;
  /** this.position/width/height（候选窗与 CanHit 原点是弹盒自身几何,:12040-12047） */
  projX: number; projY: number; projW: number; projH: number;
  ownerCx: number; ownerCy: number;             // 占位（原版直接用 Main.player[owner];单人同）
}
export interface GhostVictimCtx {
  x: number; y: number; w: number; h: number;   // 受害盒
  cx: number; cy: number;                       // Center（浮魂出生点 Position 参数,:13883）
  vanillaId?: number | null;                    // canGhostHeal 门源（SPECTRE_NO_GHOST_HEAL）
  /** NPC.lifeMax（flag10 的 `targetNPC.lifeMax > 5` 段,:13712）——缺省视为通过 */
  lifeMax?: number;
  dealt: number;                                // StrikeNPC 返回值 num41（:13712,:13881 传参）
}

/**
 * Projectile.ghostHurt 1:1 移植（12021-12070）。调用契约见文首注释;由 Arrow/MagicProj
 * 命中环在 e.hurt 之后走（对应原版 Damage() 内 :13875-13886 于 StrikeNPC(:13712)后）。
 */
export function ghostHurtOnHit(game: GameHooks, src: GhostSrcCtx, victim: GhostVictimCtx): void {
  // 前置门（:13875 / :12022-12026 / flag10 段 :13712）：victim 门 + magic 位 +
  // 弹基伤 > 0 + 受害 lifeMax>5 + 防后实扣 > 1
  if (!spectreVictimEligible(victim.vanillaId)) return;
  if (!src.magic || src.projDamage <= 0) return;
  if (victim.lifeMax !== undefined && !(victim.lifeMax > 5)) return;   //（:13712 flag10）
  if (victim.dealt <= 1) return;
  // 预算池（:12029-12033，★GB2 平移后真源=player.ghostDmg）：>1500 直接弃号;
  // 否则本次全额入账（按弹基伤计!）。宿主面由 game.player 直传——生产链所有
  // 调用方都持 game 钩子（本地玩家唯一,≡原版 Main.player[Main.myPlayer] 读写域），
  // 未绑定的裸调用面（测试/工具）自动回退 legacy 池
  const playerFace = (game as unknown as { player?: GhostBudgetHost }).player ?? undefined;
  const poolNow = decayGhostBudget(now(), playerFace);
  if (poolNow > GHOST_BUDGET_CAP) return;
  addGhostBudget(src.projDamage, playerFace);

  // ---- 候选收集（:12036-12053）——⚠逐字保留原版桶结构：单数组双计数器，
  //  「直连命中」(CanHit && dist>50) 入口后接于已写备胎之后;备胎仅在直连空集时写;
  //  选人 = 直连数>0 时取【前 directCount 个槽】(可能与已写备胎重叠!) 否则取前备份槽。
  //  该顺序依赖正是原版行为（decompile 所示即 x86 执行面）,勿"修好它"。
  const ents = game.enemies();
  const MAX_NPCS = ents.length;                 // 槽容对齐调用端世界规模
  const arr = new Array<number>(MAX_NPCS).fill(-1);
  let nBackup = 0;                              // num4
  let nDirect = 0;                              // num5
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i] as never as {
      x: number; y: number; w: number; h: number; dead: boolean; vanillaId?: number | null;
    };
    if (!e || e.dead) continue;
    if (!canBeChasedBy(ents[i])) continue;                          // CanBeChasedBy(this)（:12039）
    // ★怪癖式 verbatim（:12041-12042）：Abs(npc.posX + npc.w/2 − proj.x + proj.w/2)
    //   ——减号只作用于 proj.position.X,两个 width/2 都是【加】。
    const d = Math.abs(e.x + e.w / 2 - src.projX + src.projW / 2)
      + Math.abs(e.y + e.h / 2 - src.projY + src.projH / 2);
    if (!(d < 800)) continue;
    const okLos = canHit(game.world.store, src.projX, src.projY, 1, 1,
      e.x, e.y, e.w ?? 0, e.h ?? 0);
    if (okLos && d > 50) {                       //（:12046 直连支）
      arr[nDirect + 0] = i;
      nDirect++;
    } else if (nDirect === 0) {                  //（:12048 备胎支——仅在尚无直连时写入）
      arr[nBackup] = i;
      nBackup++;
    }
  }
  if (nDirect <= 0 && nBackup <= 0) return;      //（num4!=0||num5!=0 门取反,:12056）
  // 选人（:12058）：直连数>0 → array[rand(direct)]（前 directCount 槽）;否则前 backupNum 槽
  const span = nDirect > 0 ? nDirect : nBackup;
  const victimIndex = arr[Math.floor(Math.random() * span)];
  if (victimIndex < 0) return;

  // 出速（:12059-12067）：±100 内两掷归一后 ×4。双零掷 len=0 → C# 4f/0f=Infinity
  // → 原版本就产出 NaN 速度并瞬飞出界消亡——保持等价不加护栏。
  const r1 = Math.random() * 201 - 100;          // Next(-100,101)
  const r2 = Math.random() * 201 - 100;
  const l = Math.hypot(r1, r2);
  const k = l === 0 ? Infinity : 4 / l;

  // NewProjectile(GetProjectileSource_OnHit(victim,16), Position, v, 356, num, 0f, owner,
  //   ai[0]=pickedNpcIndex)（:12068-12069）——damage 传的是弹基伤 num,非实扣 dealt。
  const orb = new SpectreSoulProj(
    victim.cx, victim.cy,                        // Position = victim.Center（:13883 实参）
    r1 * k, r2 * k,
    src.projDamage,
    victimIndex >= 0 ? ents[victimIndex] as never as { id: number } : null,
  );
  (game as unknown as { entities?: { add?: (e: unknown, bucket?: string) => void } })
    .entities?.add?.(orb, 'projectiles');
}

/**
 * 弹 356 浮魂实体（AI_059 :29368-29431 / SetDefaults :4466-4475）。
 * 出生态 friendly=false ⇒ 预热期不可伤 NPC;ai[1] 计满 60 才转正并开始锁追。
 */
export class SpectreSoulProj extends Entity {
  readonly projId = 356;
  w = 6; h = 6;
  /** this.velocity（出生随机向,AI 不改大小仅平滑方向） */
  private ai1 = 0;                // 原 ai[1]:预热计数（→ 等价 friendly 开关）
  private lockId = -1;            // 原 ai[0] 敌实体号
  private life = 3600;            // timeLeft 默认档（:789）
  friendly = false;
  alpha = 255;
  tileCollide = false;            // 穿墙
  // ---- ★通用湿段（:16903-17113;ProjWetFlags 共享体;2026-09-06 武器弹簇批）----
  //  356 SetDefaults（:4466-4475）【无】ignoreWater 行 = 受段——旧字段
  //  `ignoreWater = true` 系误标（SetDefaults 无此行,数据面 PROJ_IGNORE_WATER
  //  亦缺 356）,本批撤除改接湿段。溅花湿段随 EU 子步逐跑（extraUpdates=3 → 4 子步,
  //  原版 Update 子步循环 :16781 内 :16895 同序;wetCount 逐子步 −1 :17109-17112）;
  //  阻尼 N/A：tileCollide=false :4473 → HandleMovement :17581 `if (tileCollide)`
  //  阻尼块整跳（wetVelocity≡velocity,UpdatePosition :20551 无水减）——禁硬安。
  //  356 不在 IsDestroyedByWater 六型（:287={85,15,188,34,1097,1106}）→ 无 kill 钩。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984 置 10 / :17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首子步 AI 后/位移前同位） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, public damage: number,
    lock: { id: number } | null) {
    super();
    this.x = x - this.w / 2;                    // 出生点=Center 口径（NewProjectile(center)）
    this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.lockId = lock ? lock.id : -1;
  }

  /** ai[0] 现锁敌号（测试/调试读数） */
  get aiLock(): number { return this.lockId; }
  /** ai[1] 预热计数（测试/调试读数） */
  get warmup(): number { return this.ai1; }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★三轮蓝队 F2（EU 半套化修正,2026-08-31）：原版 numUpdates 循环
    //   （Projectile.cs:16780-16782 `numUpdates = extraUpdates; while(numUpdates>=0)`）
    //   把 AI()【与位移、Damage、timeLeft--】全部包进子步循环——AI 在 :16880、位移
    //   :17121 HandleMovement、Damage :17188、timeLeft--/判死 :17309-17315，四位一体。
    //   extraUpdates=3 ⇒ 每拍 4 个完整子步；此前本仓只把「位移+接触」×4 而把 AI 面
    //   （ai[1]++/重锁/(v×29+dir×4)/30 混合）留在拍级执行＝半套化：预热被拉长 4 倍
    //   （60 计数→60t，原版 15t）、寿命错走 3600t（原版 900t=3600÷4）、追踪混合速率
    //   ÷4（每子步都该向目标推进 1/30+4px 合成）。现整面并入子步循环，
    //   现位移接触 ×4 语义不动。子步内序 = AI→位移→命中→timeLeft/penetrate 判死
    //   （触敌即亡链保序：Damage 先于 timeLeft/pene 检查,双杀面同拍出,状态一致）。
    for (let u = 0; u <= 3 && !this.dead; u++) {       // numUpdates 循环体 ×4（EU=3）
      this.ai1++;                                      //（:29370 每【子步】自增）
      // 曼哈顿怪癖窗（与 ghostHurt 收集同构但作用对象是弹自身盒,:29384-29385）
      const quirkDist = (e: { x: number; y: number; w: number; h: number }): number =>
        Math.abs(e.x + e.w / 2 - this.x + this.w / 2)
        + Math.abs(e.y + e.h / 2 - this.y + this.h / 2);

      if (this.ai1 >= 60) {                            //（:29371 预热完成≈tick 15）
        this.friendly = true;
        const ents = game.enemies();
        const byId = (id: number): unknown => ents.find((e) => (e as { id: number }).id === id);
        // num438：现锁 ai[0]；仅当「无效锁/无锁」且 owner 本地时重选（:29374）
        let num438 = -1;
        let lockEnt: unknown = null;
        if (this.lockId >= 0) {
          const cur = byId(this.lockId);
          if (cur && canBeChasedBy(cur)) { num438 = this.lockId; lockEnt = cur; }
        }
        //（:29374 失效或无锁 → 掷新目标。原版主门 = Main.myPlayer == owner——单人恒真；
        //  开联机后此处须按 owner 过门,备案 GW 缝合点）
        if (num438 === -1) {
          const cand: unknown[] = [];
          for (let i = 0; i < ents.length; i++) {
            if (!ents[i] || (ents[i] as { dead: boolean }).dead) continue;
            if (!canBeChasedBy(ents[i])) continue;
            const q = quirkDist(ents[i] as never as { x: number; y: number; w: number; h: number });
            if (q < 800) cand.push(ents[i]);
          }
          if (cand.length === 0) {
            // ★⑥杀拍口径（2026-09-06 湿段配方推广）：原版 AI_059 无锁敌 Kill+return
            //  （:29392-29396 `if (num439 == 0) { Kill(); return; }`）——AI 早退跳过
            //  尘循环（本仓上方短路同态）,但 Update 湿段(:16895)【无 active 门】照跑
            //  （`!active` 门 :17132 只拦 Damage/尾尘）→ 杀拍溅花照走。本仓杀位曾
            //  整体跳过湿段;现补跑,测位=存储位（AI_059 不写 position,原版死拍湿段
            //  同位,逐值等价）。该子步的活拍湿段调用点（尘尾后）因 return 不达 →
            //  同拍互斥,无需 wetSectionRan 旗;356 ∉ IsDestroyedByWater 六型/非 80
            //  → 段内无补 Kill 面。
            projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
              this.projId, !!projectileData(this.projId)?.ignoreWater);
            this.dead = true;
            return;                                                    //（:29399-29401 Kill）
          }
          const pick = cand[Math.floor(Math.random() * cand.length)]; //（:29403 Main.rand.Next）
          num438 = (pick as { id: number }).id;
          this.lockId = num438;                    //（:29404 ai[0] 回写 + netUpdate）
          lockEnt = pick;
        }
        if (num438 !== -1 && lockEnt) {             //（:29405）
          const e = lockEnt as { x: number; y: number; w: number; h: number };
          const tx = e.x + e.w / 2, ty = e.y + e.h / 2;
          const dx = tx - this.cx, dy = ty - this.cy;
          const dl = Math.hypot(dx, dy) || 1;
          const wantX = dx / dl * 4, wantY = dy / dl * 4;              // num442=4（:29407）
          //（:29414-29415 num447=30）velocity = (v×29 + dir×4)/30 ——每【子步】应用
          this.vx = (this.vx * 29 + wantX) / 30;
          this.vy = (this.vy * 29 + wantY) / 30;
        }
      }

      // ---- 尘尾（AI_059 尾段 :29417-29430/:29385-1458）：每【子步】×5,与预热门
      // 无关——for num448 在 ai[1]≥60 块外。链序同原版 AI 尾段：先出尘后位移。
      // 原 Kill 支(cand 空)return 已在上方短路 ⇒ 该子步不出尘,与原版 AI() 提前
      // return 跳过尘循环同态 ----
      this.spawnTrailDust(game);
      // ---- ★通用湿段（:16903-17113）随子步逐跑（AI 后/位移前 = 原版 Update 同序;
      // 溅花尘/音由共享体 wetSplashStepShared 承载,不自写;阻尼 N/A 见字段块注）----
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      // ---- 位移 + 接触（HandleMovement :17121 → Damage :17188）----
      this.x += this.vx;
      this.y += this.vy;
      this.runContactHits(game);
      // ---- timeLeft-- 与 penetrate 判死（:17309-17315,均在 Damage 之后逐子步消费）
      if (--this.life <= 0) { this.dead = true; break; }   // timeLeft 3600 计数÷4子步 ⇒ 寿命 900t
      if (this.penetrate === 0) { this.dead = true; break; }   // （:17312 penetrate-- → 0 ⇒ Kill）
    }
  }

  /** friendly=true 才有 PVE 命中（Damage_PVE friendly 位;预热期零伤）。
   *  ★红2γ 核证改判：SetDefaults（Projectile.cs:4466-4475）【未】写 usesLocalNPCImmunity/
   *  localNPCHitCooldown/friendly —— penetrate 吃字段缺省 1（Projectile.cs 字段声明）、
   *  maxPenetrate==1 ∧ 无局部面 ⇒ flag3 单发弹语义（:12635）：既绕 immune[owner] 门、
   *  命中也不设敌帧。friendly 仅在 AI_059 ai[1]≥60 时置位（:29371）。因此每次命中
   *  经 Damage 尾 penetrate--（:14189）归零即 Kill——「触敌即亡」单次结算,
   *  无 10t 每敌冷却可谈（旧 hitCd 表整套删除,勿留闲置机器）;Kill 无专属结算段
   *  （全树仅 :4466 一处 type==356）⇒ 不搭 856 式爆裂。 */
  private penetrate = 1;

  private runContactHits(game: GameHooks): void {
    if (!this.friendly || this.damage <= 0 || this.penetrate <= 0) return;
    // ★三轮蓝队 F3（Damage() 内旁路 :12513-12518）：356 friendly∧owner 本地∧¬minion∧
    //   type≠1054 全过,CanCutTiles(:15407) aiStyle59/type356 不在排除表 → 每子步本盒
    //   (+1 外沿) 砍 tileCut 物（预热期 friendly=false 早退=原版同态不砍）。
    cutTilesBox(game, this.x, this.y, this.w, this.h);
    // 小动物（PVE victim 循环受理面）：一击致死并耗穿自毁（MagicProj 形态同构,桶序先小动物）
    if (hitCritters(this, game)) { this.penetrate--; return; }
    // ★三轮蓝队 F6 定域注：356 不吃 immune[owner] 拒收窗也不写清——原版 :12635-12641 的
    //   flag3 = maxPenetrate==1 ∧ ¬usesLocalNPCImmunity ∧ ¬usesIDStaticNPCImmunity 对
    //   356 恒真（SetDefaults :4466 三项全缺省）⇒ `(owner<0 || immune[owner]==0) | flag3`
    //   恒放行；写尾 :14168-14173 usesLocal 支与 :14175 penetrate!=1 支皆不入 ⇒ 无写面。
    //   （856 是反向判例——usesLocal=true 破 flag3，见 SparkleGuitarProj 同批门。）
    for (const ent of game.enemies()) {
      const e = ent as never as {
        id: number; x: number; y: number; w: number; h: number; dead: boolean; maxHp?: number;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
          pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
      };
      if (!e || e.dead) continue;
      if (!(this.x < e.x + e.w && this.x + this.w > e.x
        && this.y < e.y + e.h && this.y + this.h > e.y)) continue;
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      // flag3 单发族：pierce 入参 1 = Enemy.hurt 的免疫豁免+不设帧面（:13152 对应位）
      const dmgHooked_659 = runModModifyHitNpcByProj(game.player, game, this.projId,
        (e as unknown as { vanillaId?: number }).vanillaId ?? -1, this.damage, false);   // ★D2
            e.hurt(applyBannerDamageDealt(game, e, this.damage), 0, 0, game, 0, false, 1, true);
      this.penetrate--;                            // （:14189 命中尾递减,写段判定用写前值）
      return;                                      // keepIterating=false（单发结算终了）
    }
    // ★BJ729-A（D1 B29,2026-10-27）：城镇 voodoo 靶——356 AI_059 ai[1]>=60 置
    //  friendly=true（:29371 亲读）后巫毒窄门可达（:12618-12631）;AABB 自盒;
    //  settle 镜像敌怪臂链（mod 修正链=hitTownNpcs 原语内置/DV=面级既有形态
    //  [D6 族登记]/kb=0）;flag3 单发族受理即 penetrate-- 终了（:14189 同相）。
    if (hitTownNpcs(this, game, this.damage, 0, 'playerProj', this.projId)) {
      this.penetrate--;
      return;
    }
  }

  /** AI_059 尘尾逐粒精确化（:29417-29430/1458 同段 :29385-29398）：
   *  for num448=0..4：num449=v.X×0.2×i、num450=(−v.Y×0.2)×i；
   *  Dust.NewDust(position,6,6,175,0,0,100,default(Color),1.3f)。noGravity=true
   *  走 GameHooks.spawnDust 第 11 参(=原版 NewDust 后置 dust.noGravity=true 的
   *  等价入参位)；velocity*=0（清 NewDust 内建 ±2 抖动）、position −= (num449,num450)
   *  经返回句柄后置覆写（矿车轮火花 DelegateMethods 同款缝）。i=0 贴弹,i↑ 反向拖尾;
   *  池满 null = 原版 dustIndex==maxDustToDraw 旧尘被顶的兜底语义 */
  private spawnTrailDust(game: GameHooks): void {
    for (let i = 0; i < 5; i++) {
      const num449 = this.vx * 0.2 * i;
      const num450 = -(this.vy * 0.2) * i;
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h,
        175, 0, 0, 100, null, 1.3, true);
      if (!d) continue;                          // 池满兜底（:267 档）
      d.vx = 0; d.vy = 0;                        // dust.velocity *= 0f（:29424）
      d.x -= num449;                             // :29425 position.X -= num449
      d.y -= num450;                             // :29426 position.Y -= num450
    }
  }

  /** 原版本体不可见：alpha=255 + GetAlpha 无 356 特判 ⇒ 全透明（文首"绘制保真"段）。
   *  盘上 Projectile_356.png 为 1×1 占位 stub——可见观感完全由 spawnTrailDust 的
   *  尘 175 拖尾承载。本方法保留为文档化空实现,禁止回填平涂圆点。 */
  draw(_r: Renderer, _cam: Camera): void {
    void _r;
    void _cam;
  }
}
