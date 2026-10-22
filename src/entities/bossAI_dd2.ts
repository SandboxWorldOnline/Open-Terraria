// DD2/旧日军团 + 沙漠族 AI 家族 1:1 移植（Terarria1456, 1.4.5.6）：
//   aiStyle 93  荷兰飞盗船 491            NPC.cs:39245-39355（★BJ-C6/F4 1457 值,1456 树
//                                          为 :40918-41028;首帧生成 4×荷兰大炮 492
//                                          （ai[0..3]=炮位,出生间隔 ai[3]=60*i）;炮全灭 →
//                                          StrikeNPCNoInteraction(9999) 自毁;1/300t 船口
//                                          跳海盗 212-215(vy-8.01);贴地巡航保持离地 350-450px;
//                                          SetDefaults dontTakeDamage=true :14581 → 炮在世恒无敌）
//   aiStyle 102 沙尘精 541                NPC.cs:42224-42620（walker 核 + ai[0] 攻击循环：
//                                          0→1 起手,54t 在玩家预测位（vx*30）±30 格放 ≤3 枚
//                                          沙暴标记 658（需 CanSpawnSandstormHostile 三列净空
//                                          ≥22 格,StrayMethods.cs:47;标记 damage 0 纯视觉,
//                                          Projectile.cs:6792 + aiStyle128 尘柱）;135t → -300
//                                          冷却;血 <50% knockBackResist=0）
//   aiStyle 103 沙鲨族 542-545            NPC.cs:42621-42805（沙/沙岩/硬化沙中巡游;碰撞走
//                                          Collision.AdvancedTileCollision(ForSandshark) :93812
//                                          ——沙族 tile 无视碰撞,其余照撞;玩家在上方且距 >150px
//                                          → 对准（目标-80px）12 速跃沙扑咬,30t 冷却（ai[2]）;
//                                          离沙 → 重力 0.3 落地爬行 ±1 速）
//   aiStyle 104 DD2AttackerTest 547       NPC.cs:42807-42809（active=false——出生即消,
//                                          原版内部测试残留物）
//   aiStyle 105 永恒水晶 548              NPC.cs:42810-43062（ai[1] 0: 首帧起 180t 倒计时 →
//                                          CheckArenaScore(StrayMethods.cs:83 SendWalker 双向
//                                          扫场)两端各送 1×神秘传送门 549（右门 ai[2]=1）;
//                                          1=败北演出（上浮渐隐 600t）/2=胜利演出（600t 尘涡）,
//                                          收场调 DD2Event.StopInvasion——事件依赖见下）
//   aiStyle 106 神秘传送门 549            NPC.cs:43063-43152（LaneSpawnRate 节拍出怪 →
//                                          DD2Event.SpawnMonsterFromGate;localAI[0] 满 180 且
//                                          水晶在世 → dontTakeDamage 驻守;水晶亡 → ai[1]=1,
//                                          500-600t scale 1→0.05 缩放消散,550t 自灭）
//   aiStyle 108 俯冲飞行族                NPC.cs:43157 → AI_108_DivingFlyer :65959
//          埃特尼亚飞龙 T1/T2/T3 558/559/560 + 小妖魔滑翔怪 T2/T3 574/575
//                                          （0 悬空逼近（LOS+下视野门,ai[3] 120t 宽限）→
//                                           1 瞄准 num5 t（v×0.95,小妖魔 vy-0.1 点火）→
//                                           2 俯冲追踪（超时/低于 6 速 → 0;小妖魔 flag2=
//                                           撞实心块/贴目标 64px → 3 自爆 192² 伤 80）→
//                                           4 回旋（ai[1]=45,每 tick -3）;出生 60t 渐显 +
//                                           同族 0.05/0.1 分离）
//   aiStyle 109 黑暗魔法师 564/565        NPC.cs:43161 → AI_109_DarkMage :66392
//                                          （walker 核（与 102 同构,参数漂移：重力 0.05/
//                                           落速 0.2）+ 三连招循环 ai[1]: 0 暗影矢 675（97t,
//                                           ai[0]==32 发,14 速 40 伤）/ 1 治疗（127t,ai[0]=40/
//                                           48/56 在 ±240 格地面各放 674 → 1000px 内友军
//                                           +500×3,Projectile.cs:35510）/ 2 召骷髅 673（183t,
//                                           ai[0]==64 发,DD2Event.RaiseGoblins 事件依赖）;
//                                           招式选择：±600×±200 内受伤友军 <2 → 强制 2）
//   aiStyle 110 双足翼龙 Betsy 551        NPC.cs:43165 → AI_110_Betsy :62266
//                                          （0 入场 10t → 1 悬停 30t 按 ai[3] 八槽轮换选招：
//                                           2 风压冲 23 速（30t）/ 3 火焰吐息（40t 接位 →
//                                           687 喷焰 80t 横冲 10→20 速）/ 4 空袭（60t 接位 →
//                                           686 火球 ×6 每 10t + 60t 贴地掠射）/ 5 翻转俯冲
//                                           （60t,32 速螺旋 +0.1 升降）/ 6 召唤（贴水晶 350px
//                                           或 180t → 90t 内 ai[1]=20/45/70 各召 560×(1+门数3));
//                                           ai[3]==5 且 1/3 概率 → 追加二次 5;选完 ai[3]+1
//                                           （≥8 回 0）;rotation 每态 AngleTowards 目标角）
//   aiStyle 111 埃特尼亚荧光虫 578        NPC.cs:43169 → AI_111_DD2LightningBug :66799
//                                          （0.96 阻尼悬停,LOS 内静止蓄电：localAI[0] 满 5 →
//                                           发 682 电弧（50 伤 10 速,±25px 抖动 + 双重
//                                           ±0.5%/±0.625% 速度扰动）,-30t 冷却;目标在上/
//                                           埋块 → vy-0.2 上浮;出生 60t 渐显 + 同族分离）
// 勘误（任务卡普查映射 vs 1456 原文逐一核实）：
//   - 574/575 小妖魔滑翔怪是 aiStyle 108（AI_108_DivingFlyer 的 KoboldFlyer 档,
//     flag2=true 撞块自爆）,不是 111;578 荧光虫才是 111。
//   - 547=104（DD2AttackerTest,出生即消）/548=105（永恒水晶）/549=106（神秘传送门）,
//     与普查一致;549 的"入场语义"= 105 水晶 180t 倒计时后由 CheckArenaScore 双端放置。
//   - 飞龙 T1-3（558-560）与普通飞龙族（aiStyle 6 蠕虫链）无共用——DD2 飞龙是单体
//     俯冲飞行族（AI_108）,不生成体段。
//   - 541 沙尘精/542-545 沙鲨未被沙尘暴或其它批覆盖（Enemy.ts 此前落 default zombieAI,
//     沙尘暴刷怪器 VanillaSpawner.ts:1449 已在出 541 → 本批补 AI）。
// aiStyle 107（552-557/561-563/566-573/576/577 地面 walker 族 + 620 地精鲨）：
//   ★2026-08-13 walker 族攻击状态机 1:1 落位本文件 ai107ImprovedWalkers
//   （Enemy.ts case 107 分发;620 地精鲨仍走 chargerAI 的 wet 档）;492 荷兰大炮
//   aiStyle 75 → Enemy.ts case 75 分发进 bossAI_martian.martianSaucerPartAI,其顶部
//   转发本文件 dutchmanCannonAI（cs:35889-35904 锚船偏移 + :36008-36070 240t 装填炮击）。
// 事件依赖（★已接线,Game.wireDD2Hooks 落到 world/OldOnesArmy.ts,见 DD2_EVENT_HOOKS）：
//   laneSpawnRate()/enemySpawningOnHold()/spawnMonsterFromGate()（106 出怪节拍）、
//   raiseGoblins()/canRaiseGoblinsHere()（109 召骷髅）、stopInvasion()（105 胜负收场）、
//   reportLoss()（105 败北）、findArenaHitbox()（105）、difficulty()（DD2 难度档,默认 1）。
//   DD2 敌怪索敌语义（NPCUtils.cs:261/:308）：场上有水晶 548 → 咬水晶;否则咬玩家。
// 弹幕贴图：Projectile_{240,662,671,675,676,681,682,683,685,686,687}.png 已入
//   sprites/vanilla 管线（见 shootD 上方注记）；658/673/674 三枚 0 伤效果弹无弹体
//   （粒子降级）,速度/伤害/节拍 1:1。
import { Entity } from './Entity';
import type { Enemy } from './Enemy';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { TILE } from '../core/constants';
import { moveAndCollide } from '../physics/TileCollision';
import { spawnPart, losClear } from './bossAI';
import { Arrow, projSprite } from './Arrow';
import { segHitsRect } from './bossAI_duke_moonlord';
import { statusPlayer } from './projTargets';
import { TILE_DEFS } from '../data/tiles';
import { soundTrackFiles } from '../data/vanillaNpcs';
import { GDL, getKnockbackMultiplierScaledByDifficulty, hostileProjectileDamage, mainDifficulty } from '../stats/ScaleStats';
import { GorePiece } from './GorePiece';
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import type { Renderer } from '../render/Renderer';
import type { Camera } from '../render/Camera';
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ330 GTW 单源

// 弹幕贴图:Projectile_{240,675,682,686,687}.png 已自 terraria-assets/Images 入
// sprites/vanilla 管线(scripts/vanilla-atlas.mjs MISC 表),Arrow 按 projId 懒加载真图——
// RENDER_PROXY 代渲登记退役。687 喷焰为 Main.cs:31282 自定义 15 层火舌程序化
// 绘制——2026-08-19 弹道批已按 BetsyBreath 类 1:1 落位(七帧行逐层取帧+定数 LCG);
// 682 电弧 4 帧竖条(projFrames=4,Main.cs:8482)仍按整条绘制。
/** 原版 localAI[0..3]（Enemy 只有 ai0-ai3 对应 ai[],localAI 独立 → WeakMap 落盘） */
const localAI = new WeakMap<Enemy, number[]>();
/** 491 渲染帧源（localAI[3] 0..63 循环，1457 :39287-39290;1456 树 :40971-40974）——渲染侧只读访问 */
export const dutchmanAnim = (e: Enemy): number => localAI.get(e)?.[3] ?? 0;
/** 568/569 枯萎兽渲染态只读（渲染侧不落 localAI 字段 → 同 dutchmanAnim 出口）：
 *  [0]=localAI[0] 灵气计数（死亡紫魂环驱动，Main.cs:26130 num322；
 *  AI_107 灵气态每 tick +1，cs:63882）/ [1]=localAI[3] 出生计数（出生紫雾门，
 *  Main.cs:25899，AI_107 出膛渐显 0→60） */
export const witherBeastLocal = (e: Enemy): [number, number] =>
  [localAI.get(e)?.[0] ?? 0, localAI.get(e)?.[3] ?? 0];

export const dd2LocalAI = (e: Enemy): number[] => {
  let a = localAI.get(e);
  if (!a) { a = [0, 0, 0, 0]; localAI.set(e, a); }
  return a;
};

// ---------------------------------------------------------------------------
// ★B1 接线批：549 神秘传送门常驻循环轨（DD2_EtherianPortalIdleLoop）
// 原版把 PlayTrackedSound 的 SlotId 存进 localAI[3]（NPC.cs:41403-41404），此后每帧
// GetActiveSound(SlotId.FromFloat(localAI[3])) 判空重建、收门态逐帧改 Volume
// （:41455-41465）、消散终帧 activeSound2?.Stop()（:43146）。本仓 SfxLoop 是对象
// 句柄（非数值槽），Enemy 类无本地字段落点 → 模块级 Map 承载；manage 语义对齐
// Game.updateWaterfallAmbience 的 wfAmbLoops（句柄终态 dead 即拆建）。
// ---------------------------------------------------------------------------
/** 循环轨句柄结构面（GameHooks.startTrackedLoop 返回值；setVolume=ActiveSound.Volume
 *  逐帧覆写档,NPC.cs:41464 收门段 Volume=scale 消费） */
interface DD2LoopHandle {
  stop(): void; setVolume?(v: number): void; setPos(px: number, py: number): void;
}
const portalLoops = new Map<Enemy, DD2LoopHandle>();
/** 缺省 vol 门内联（≤0 拆轨/不起轨）——旧 startLoopSfx 异步句柄时代的
 *  portalLoopDead 失败门随接口退役：startTrackedLoop 同步句柄/null(重试) 面 */
/** 循环轨 manage（vol≤0 视作拆轨）：先代扫已亡实例——AI 在实体死亡后即停摆，
 *  自拆只能靠存活门代劳（门恒成对出生 + 消散由胜负演出统一置 ai1=1 走受控停轨，
 *  清扫链不断）；实例级兜底见 lanePortalAI bInit 注入的 destroy()（Entity.compact
 *  剔除 dead 实体时回调，Entity.ts:69-76）。残余窗口仅 EntityManager.clear() 退世界
 *  不走 destroy（WeaponProj.ts:4145 同登记），单机影响=离世界后余音至重载。
 *
 *  ★屏距衰减(终清波)：原版 PlayTrackedSound(SoundID.DD2_EtherianPortalIdleLoop,
 *  Center)(NPC.cs:41409/:41458)=位置化跟踪轨——GetActiveSound 空才重建、其余仅
 *  收门段 Volume=scale。旧 startLoopSfx 全量不衰减接口退役 → startTrackedLoop
 *  (atten/pan 随 setPos 刷新,传送门本体不动=setPos 与出生位一致,volume 档接
 *  收门缩放)。 */
function portalLoopManage(e: Enemy, game: GameHooks, vol: number): void {
  for (const [k, h] of portalLoops) {
    if (k.dead) {
      h.stop();
      portalLoops.delete(k);
    }
  }
  let h = portalLoops.get(e);
  if (!h) {
    if (vol <= 0) return;
    // 缓冲未就绪(同步起振失败=null)本轮静默、下拍重试——GetActiveSound 空→
    // PlayTrackedSound 重建的原版语义;句柄命中后 setPos 对齐出生位
    const nh = game.startTrackedLoop?.('dd2_etherian_portal_idle_loop', Math.min(1, vol), e.cx, e.cy)
      ?? undefined;
    if (nh) { portalLoops.set(e, nh); nh.setPos?.(e.cx, e.cy); }
    return;
  }
  if (vol <= 0) { h.stop(); portalLoops.delete(e); return; }
  h.setPos?.(e.cx, e.cy);
  h.setVolume?.(Math.min(1, vol));
}

// ---------------------------------------------------------------------------
// ★台账⑩（2026-08-31）：小妖精族引信/冲锋跟踪循环轨
// 原版语义 = GetActiveSound(SlotId)==null → PlayTrackedSound + 每 tick
// activeSound.Position = Center 跟随：
//   · AI_107 地面小妖精（1458 NPC.cs:63957-64005）：点火窗（ai[0]>0 && ai[1]==0，
//     localAI[2]==30 拍）起 KoboldIgniteLoop + KoboldScreamChargeLoop 双轨；
//     冲锋窗（ai[0]==0 && ai[1]==1）两轨持续跟随重建。
//   · AI_108 俯冲小妖精滑翔怪（:66388-66406）：俯冲态 ai[1]>=20 起
//     KoboldIgniteLoop 单轨。
// 句柄 = GameHooks.startTrackedLoop（Sfx.startTrackedLoop：loop=true、atten/pan 随
// setPos 逐帧刷新）。停轨 = 状态退出/自爆/消亡——原版靠 PlayTrackedSound 的实体
// 追踪绑定在 NPC 失效后自然熄灭，本仓显式 stop 对齐听感。曾以"60t 一拍补播"
// 近似（档内注释备案）退役；俯冲滑翔怪的引信环此前整段缺失。
// ★终清波勘误:台账⑩接线时 wav 键未入 WAV_MAP→startTrackedLookup 恒 null=两轨
// 实际从未出声;dd2KoboldIgniteLoop/dd2KoboldChargeLoop 键已补(Sfx.ts),现真通。
// ---------------------------------------------------------------------------
interface TrackedLoopHandle { stop(): void; setPos(px: number, py: number): void }
const fuseLoops = new Map<Enemy, Map<string, TrackedLoopHandle>>();

/** 引信跟踪轨 manage：active=false 即全拆；缺基建（纯单测 mock）静默跳过。 */
function fuseLoopManage(
  e: Enemy, game: GameHooks,
  tracks: ReadonlyArray<readonly [string, string]>,    // [槽键, wav 名]
  active: boolean, x: number, y: number,
): void {
  if (!active) { fuseLoopStop(e); return; }
  if (!game.startTrackedLoop) return;
  let m = fuseLoops.get(e);
  if (!m) { m = new Map(); fuseLoops.set(e, m); }
  for (const [key, file] of tracks) {
    const h = m.get(key);
    if (!h) {
      const nh = game.startTrackedLoop(file, 1, x, y);
      if (nh) m.set(key, nh);
      continue;                                        // 建轨失败下拍重试（GetActiveSound null 同语义）
    }
    h.setPos(x, y);
  }
}

/** 全拆（状态退出/死亡兜底 destroy 注入共用）。 */
function fuseLoopStop(e: Enemy): void {
  const m = fuseLoops.get(e);
  if (!m) return;
  for (const h of m.values()) h.stop();
  fuseLoops.delete(e);
}

/** 原版 oldVelocity（碰撞前一帧速度,cs:93795 collideX/collideY 判定源）→ WeakMap */
const oldVel = new WeakMap<Enemy, { x: number; y: number }>();
/** 黑魔法师施法期瞄准快照（AI_109 头部 GetTargetData 一次取值,施法全程不重定向） */
const mageCastAim = new WeakMap<Enemy, { x: number; y: number }>();

const TAU = Math.PI * 2;
/** 12 拍星爆触发表(NPC.cs(1458):41255 —— 胜利演出整环白尘收束拍) */
const RING_BURST_TICKS: readonly number[] =
  [100, 160, 220, 280, 340, 370, 400, 430, 460, 500, 520, 540];
const rnd = (n: number): number => Math.floor(Math.random() * n);
const rndRange = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
/** Utils.GetLerpValue(clamped) */
const lerpValue = (a: number, b: number, v: number): number =>
  b === a ? (v < a ? 0 : 1) : clamp((v - a) / (b - a), 0, 1);
/** MathHelper.AngleTowards：最短弧步进 */
const angleTowards = (cur: number, tgt: number, maxStep: number): number => {
  let d = tgt - cur;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  if (Math.abs(d) <= maxStep) return tgt;
  return cur + sign(d) * maxStep;
};

// ---------------------------------------------------------------------------
// DD2Event 事件依赖（★2026-08-13 复核：九钩子已由 Game.wireDD2Hooks 全部接线——
// Game.ts afterWorldLoad :1869 调用，逐槽落到 world/OldOnesArmy.ts 的 1:1 状态机
// （StartInvasion/UpdateTime/CheckProgress/SpawnMonsterFromGate 三档分表/
// RaiseGoblins/StopInvasion/FindArenaHitbox）。事件进行中敌怪正常从门 549 出生；
// 触发链 = 永恒水晶座 466 右键（Game.useEterniaStand，Player.cs:31930-31977）。
// 下面的 null 缺省只在"Game 未构造（纯单测直调 AI）"时生效，语义 = 无事件：
// 门不出怪/魔法师不召骷髅/胜负演出不触发事件收场。
// ---------------------------------------------------------------------------
export const DD2_EVENT_HOOKS = {
  /** DD2Event.LaneSpawnRate（默认 60,:59） */
  laneSpawnRate: (): number => 60,
  /** DD2Event.EnemySpawningIsOnHold（波间间歇,:113） */
  enemySpawningOnHold: (): boolean => false,
  /** DD2Event.SpawnMonsterFromGate（:556,按 OngoingDifficulty 分表） */
  spawnMonsterFromGate: null as null | ((g: GameHooks, x: number, y: number, leftGate: boolean) => void),
  /** DD2Event.RaiseGoblins（:732,从 _deadGoblinSpots 复活骷髅） */
  raiseGoblins: null as null | ((g: GameHooks, x: number, y: number) => void),
  /** DD2Event.CanRaiseGoblinsHere（:715,800px 内 ≥3 处尸点才可召） */
  canRaiseGoblinsHere: (_g: GameHooks, _x: number, _y: number): boolean => false,
  /** DD2Event.StopInvasion（胜负收场） */
  stopInvasion: null as null | ((g: GameHooks, win: boolean) => void),
  /** DD2Event.ReportLoss */
  reportLoss: null as null | ((g: GameHooks) => void),
  /** DD2Event.FindArenaHitbox */
  findArenaHitbox: null as null | ((g: GameHooks) => void),
  /** DD2Event.OngoingDifficulty（1/2/3,T1/T2/T3） */
  difficulty: (): number => 1,
};

const DD2_EVENT_HOOKS_DEFAULTS = { ...DD2_EVENT_HOOKS };
/** ★BJ318（2026-09-24）：退世界复位——wireDD2Hooks 逐局覆写的闭包捕获 Game/World,
 *  模块单例不复位=死 Game 滞留。Game.destroy 调用,下局 wireDD2Hooks 重挂。 */
export function resetDD2Hooks(): void {
  Object.assign(DD2_EVENT_HOOKS, DD2_EVENT_HOOKS_DEFAULTS);
}

// ---------------------------------------------------------------------------
// 弹幕：ProjectileID.cs：240 CannonballHostile（荷兰大炮炮弹,14 速-5 上抛）/
// 658 SandnadoHostileMark（沙暴标记,damage 0 纯视觉尘柱）/ 673 DD2DarkMageRaise
//（召骷髅阵眼,0 伤）/ 674 DD2DarkMageHeal（治疗脉动,落地 40t 后 1000px 内友军
// +500,0 伤）/ 675 DD2DarkMageBolt（暗影矢 14 速 40 伤）/ 682 DD2LightningBugZap
//（电弧 10 速 50 伤）/ 686 DD2BetsyFireball（空袭火球,继承机速）/ 687
// DD2BetsyFlameBreath（喷焰——锚定嘴部的 78t 持续火舌,BetsyBreath 类,
// 2026-08-19 弹道批实装,不再走 Arrow 自由飞弹）。
// 伤害弹（240/675/682/686）走 Arrow 真图（RENDER_PROXY 已退役）;三枚 0 伤
// 效果弹（658/673）不生成弹体——Arrow 命中敌怪会 hurt(0)（假命中音+0 伤害数字）
// 且瞬间耗尽 pierce,与原版"纯视觉"语义相反 → 降级为粒子。674 治疗脉动已实体化
//（DD2HealPulse,独立于魔法师生死,40t 疗程节奏 1:1）。
// ---------------------------------------------------------------------------
/** Projectile 674 DD2DarkMageHeal（SetDefaults :6929-6939：10×10 aiStyle 133
 *  timeLeft 900;AI :35540-35574）：落地帧播音（ai[0]==0）→ 每 AI 步 ai[0]++ →
 *  第 40 步结算疗程后 Kill。疗程 = 弹体中心 1000px 内全部友军（active、damage≥1、
 *  lifeMax≥30、非 564/565）各 +min(500, lifeMax−life)（HealEffect 绿字）。
 *  ★治疗圆心 = 脉动落点（弹体 Center）,不是魔法师位置——魔法师 ai[1]==1 三连
 *  脉动（ai[0]=56/48/56 各出一枚,各数各的 40t）后落点在 direction×240 下探 50 格
 *  处,与魔法师本体的距离随地形拉开。 */
export class DD2HealPulse extends Entity {
  w = 10;
  h = 10;
  /** ai[0]（:35548 每 AI 步 +1;≥40 Kill） */
  private ai0 = 0;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：674 DD2DarkMageHeal SetDefaults P.cs:7210-7222（674||673 合块——10×10/
  //  aiStyle 133/alpha 255/tileCollide=false/ignoreWater=true【:7216】/timeLeft 900/
  //  hostile/penetrate −1/drawLayer 2）→ 豁免 id,段门恒闭（:16903）= 原版零行为
  //  （字段照加、段照调,豁免分流由 ignoreWater 参数自动承载）。
  //  阻尼不适用（三证）：①豁免;②tileCollide=false → 湿阻尼支 :17721-17764 不进;
  //  ③本弹零速定点（NewProjectile (0,0) 速,AI 不改速）,无位移宿主。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——674 豁免 id（P.cs:7216 ignoreWater=true）→ 段门
    //  恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      674, !!projectileData(674)?.ignoreWater);
    if (this.ai0 === 0) {
      // :35544-35547 首帧 DD2_DarkMageHealImpact（PlayTrackedSound 无音量覆写 → 1）
      game.playSfxFiles(soundTrackFiles('dd2_dark_mage_heal_impact'), 1, this.cx, this.cy);
      // 落地紫尘（原版为 Projectile_674 贴图绘制,素材未入管线 → 粒子降级）
      game.spawnParticles(this.cx, this.cy, '#FF7AE0', 8, 1.6, { life: 50 });
    }
    this.ai0++;
    if (this.ai0 < 40) {
      // 悬浮微光（同上视觉降级;低频防尘海）
      if (Math.random() < 0.3) {
        game.spawnParticles(this.cx + (Math.random() - 0.5) * 20,
          this.cy - Math.random() * 16, '#FF7AE0', 1, 0.4, { life: 26, grav: -0.02 });
      }
      return;
    }
    // ---- 疗程结算（:35553-35572）----
    // 原版遍历 Main.maxNPCs（敌怪+城镇 NPC 都算——伤害/生命门自然滤掉小动物）
    for (const list of [game.enemies(), game.npcs?.() ?? []]) {
      for (const ent of list) {
        const n = ent as unknown as {
          dead: boolean; vanillaId?: number | null; def?: { damage?: number };
          damage?: number; cx: number; cy: number; hp: number; maxHp: number;
        };
        if (!n || n.dead || n.vanillaId === 564 || n.vanillaId === 565) continue;
        // nPC20.damage >= 1：城镇 NPC 自卫伤害也过门（原版同式）;critter damage 0 被滤
        const dmg = n.def?.damage ?? n.damage ?? 0;
        if (dmg < 1 || n.maxHp < 30) continue;
        if (Math.hypot(n.cx - this.cx, n.cy - this.cy) > 1000) continue;
        const heal = Math.min(500, n.maxHp - n.hp);
        if (heal > 0) {
          n.hp += heal;
          game.addDamageNumber(n.cx, n.cy - 10, -heal, false, '#7CFF6A');   // HealEffect 绿字
        }
      }
    }
    this.dead = true;                                   // Kill()（:35573）
  }

  draw(): void {
    // 视觉由粒子承担（Projectile_674 贴图未入管线）
  }
}

function shootD(
  game: GameHooks, x: number, y: number, vx: number, vy: number,
  dmg: number, projId: number, life = 300, grav = 0, pierce = 1,
): void {
  // 出膛音（原版在弹幕 AI 首帧 localAI[0]==0 处 PlaySound，此处等效落在生成帧）：
  // 675 暗影矢 dd2_dark_mage_attack（:53602）/ 682 电弧 dd2_lightning_bug_zap（:52055）/
  // 686 火球 dd2_betsy_fireball_shot（:53645）——多变体组内随机（playSfxFiles 语义）
  const shot = PROJ_SHOT_SFX[projId];
  if (shot) game.playSfxFiles(soundTrackFiles(shot), 0.8, x, y);
  (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
    new Arrow(x, y, vx, vy, dmg, 0, projId, { grav, life, pierce, hostile: true }),
    'projectiles');
}
/** shootD 的 opts 直通变体（686 等需完整重力链的弹型;保留出膛音链） */
function shootD2(
  game: GameHooks, x: number, y: number, vx: number, vy: number,
  dmg: number, projId: number, life: number,
  opts: Partial<import('./Arrow').ArrowOpts>,
): void {
  const shot = PROJ_SHOT_SFX[projId];
  if (shot) game.playSfxFiles(soundTrackFiles(shot), 0.8, x, y);
  (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
    new Arrow(x, y, vx, vy, dmg, 0, projId, { life, hostile: true, ...opts }),
    'projectiles');
}

/** DD2 弹幕 → 声轨名（Projectile.cs 首帧 PlaySound 站点） */
const PROJ_SHOT_SFX: Record<number, string> = {
  675: 'dd2_dark_mage_attack',     // :53602 DD2_DarkMageAttack
  682: 'dd2_lightning_bug_zap',    // :52055 DD2_LightningBugZap
  686: 'dd2_betsy_fireball_shot',  // :53645 DD2_BetsyFireballShot（空袭火球出膛）
};

// ---------------------------------------------------------------------------
// tile 辅助
// ---------------------------------------------------------------------------
/** vanilla tile sheet id → 内部 tile id（TILE_DEFS 下标;同 SceneMetrics.SHEET_MAP 建法） */
const SHEET = new Map<number, number>();
for (let i = 0; i < TILE_DEFS.length; i++) {
  const d = TILE_DEFS[i];
  if (d?.vanilla && !SHEET.has(d.vanilla.sheet)) SHEET.set(d.vanilla.sheet, i);
}
const tileIds = (arr: number[]): Set<number> =>
  new Set(arr.map((n) => SHEET.get(n)).filter((v): v is number => v != null));
/** TileID.Sets.Conversion（TileID.cs:30-34）：Sand 53/112/116/234、HardenedSand
 *  397/398/402/399、Sandstone 396/400/403/401 */
const CONV_SAND = tileIds([53, 112, 116, 234]);
const CONV_HARDENED = tileIds([397, 398, 402, 399]);
const CONV_SANDSTONE = tileIds([396, 400, 403, 401]);
/** TileID.Sets.ForAdvancedCollision.ForSandshark（沙鲨碰撞豁免表,cs:93812） */
const SANDSHARK_PASS = tileIds([53, 112, 116, 234, 397, 398, 402, 399, 396, 400, 403, 401]);

const solidAt = (game: GameHooks, tx: number, ty: number): boolean => {
  const st = game.world.store;
  return st.inBounds(tx, ty) && st.isSolid(tx, ty);
};
const tileTypeAt = (game: GameHooks, tx: number, ty: number): number => {
  const st = game.world.store;
  return st.inBounds(tx, ty) ? st.type[st.idx(tx, ty)] : 0;
};
const liquidAt = (game: GameHooks, tx: number, ty: number): number => {
  const st = game.world.store;
  return st.inBounds(tx, ty) ? st.liquid[st.idx(tx, ty)] : 0;
};
/** 实心或有液体（原版 nactive()&&tileSolid || liquid>0 探测语义） */
const blockedAt = (game: GameHooks, tx: number, ty: number): boolean =>
  solidAt(game, tx, ty) || liquidAt(game, tx, ty) > 0;

/** Collision.ExpandVertically（Collision.cs:4403）：从 (x,y) 向上/下穿非实心格扩张 */
function expandVertically(
  game: GameHooks, x: number, y: number, maxUp: number, maxDown: number,
): [number, number] {
  let top = y, bottom = y;
  for (let i = 0; i < maxUp; i++) {
    if (top <= 0 || top < 10) break;
    if (solidAt(game, x, top)) break;
    top--;
  }
  const st = game.world.store;
  for (let j = 0; j < maxDown; j++) {
    if (bottom >= st.h - 10) break;
    if (solidAt(game, x, bottom)) break;
    bottom++;
  }
  return [top, bottom];
}

/** StrayMethods.CanSpawnSandstormHostile（StrayMethods.cs:47）：三列各 ±15 格净空,
 *  内缩后竖向跨度 ≥20 格 */
function canSpawnSandstormHostile(game: GameHooks, tx: number, ty: number): boolean {
  for (let i = -1; i <= 1; i++) {
    const [top, bottom] = expandVertically(game, tx + i, ty, 15, 15);
    if (bottom - 1 - (top + 1) < 20) return false;
  }
  return true;
}

/** StrayMethods.SendWalker（StrayMethods.cs:115）：沿地面走向 direction,返回最远落脚点 */
function sendWalker(
  game: GameHooks, start: { x: number; y: number }, height: number, dir: number, maxDist: number,
): { x: number; y: number } {
  let px = start.x, py = start.y - 1;
  let covered = 0;
  let last = { x: px, y: py };
  for (let i = 0; i < maxDist; i++) {
    for (let j = 0; j < 3; j++) {
      if (!solidAt(game, px, py)) break;
      py--;                                     // 最多上爬 3 格脱出实心
    }
    const [topY, bottomY] = expandVertically(game, px, py, height, 2);
    const top = topY + 1, bottom = bottomY - 1;
    if (!solidAt(game, px, bottom + 1)) {
      // 落脚跨度下无地面：再探 6 格,仍悬空 → 停
      const [, b2] = expandVertically(game, px, bottom, 0, 6);
      if (!solidAt(game, px, b2)) break;
    }
    if (bottom - top < height - 1) break;       // 净空不足（walker 高 10）
    covered += dir;
    px += dir;
    py = bottom;
    last = { x: px, y: py };
    if (Math.abs(covered) >= maxDist) break;
  }
  return last;
}

/** StrayMethods.CheckArenaScore（StrayMethods.cs:83）：水晶落点双向 walker 扫场端点 */
export function checkArenaScore(
  game: GameHooks, cx: number, cy: number,
): { left: { x: number; y: number }; right: { x: number; y: number } } {
  const maxDist = 100; // Main.MaxWorldViewSize.X/16 的常见档（SendWalker 默认 100）
  const ptx = Math.floor(cx / TILE), pty = Math.floor(cy / TILE);
  const [, floorY] = expandVertically(game, ptx, pty, 0, 4);
  const start = { x: ptx, y: floorY };
  const l = sendWalker(game, start, 10, -1, maxDist);
  const r = sendWalker(game, start, 10, 1, maxDist);
  return { left: { x: l.x + 1, y: l.y }, right: { x: r.x - 1, y: r.y } };
}

// ---------------------------------------------------------------------------
// DD2 索敌（NPCUtils.TargetClosestOldOnesInvasion :261 / TargetClosestBetsy :308）：
// 场上有水晶 548 → 咬水晶;否则咬玩家
// ---------------------------------------------------------------------------
/** hittableOnly=true → NPCUtils.SearchFilters.OnlyCrystal（:16-21）语义：水晶候选须
 *  !dontTakeDamageFromHostiles——胜/败演出期（:41170/:41280/:78896 置旗）水晶退出
 *  索敌候选,DD2 态改咬玩家。lanePortalAI 的水晶在世判定（AnyNPCs(548) :41440）【不】
 *  带此门（演出期门恒在世维持开门态）→ 分参。★BJ450 */
function findCrystal(game: GameHooks, hittableOnly = false): Enemy | null {
  for (const n of game.enemies() as Enemy[]) {
    if (!n.dead && n.vanillaId === 548
      && (!hittableOnly || !n.dontTakeDamageFromHostiles)) return n;
  }
  return null;
}
function dd2Target(
  game: GameHooks, e: Enemy, player: Player | null, noDistanceGate = false,
): { x: number; y: number } | null {
  // NPCUtils.SearchForTarget（NPCUtils.cs:196-259）+ TargetSearchResults 构造（:151-160）：
  // 候选 = 水晶 548（OnlyCrystal :16-21）与玩家（玩家距离按 aggro 折扣 num5 = dist − aggro，
  // :229-231）；**近者胜**（nearestNPCDistance < adjustedTankDistance → NPC，否则玩家）。
  // TargetClosestOldOnesInvasion（:261-273）玩家滤 200px 内；TargetClosestBetsy（:308-318）
  // 无距离门（noDistanceGate）。★BJ450:水晶候选过 OnlyCrystal 门（演出期改咬玩家）。
  const crystal = findCrystal(game, true);
  const pd = player && !player.dead ? Math.hypot(player.cx - e.cx, player.cy - e.cy) : Infinity;
  const aggro = player && !player.dead
    ? ((player as unknown as { aggro?: number }).aggro ?? 0) : 0;
  if (crystal) {
    const cd = Math.hypot(crystal.cx - e.cx, crystal.cy - e.cy);
    if ((noDistanceGate || pd <= 200) && pd - aggro < cd) {
      return { x: player!.cx, y: player!.cy };
    }
    return { x: crystal.cx, y: crystal.cy };
  }
  if (pd !== Infinity) return { x: player!.cx, y: player!.cy };
  void e;
  return null;
}

/** 原版 CS 直积分（noTileCollide 族） */
const fly = (e: Enemy): void => { e.x += e.vx; e.y += e.vy; };
/** 向目标方向单位向量（DirectionTo） */
function dirTo(e: Enemy, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - e.cx, dy = ty - e.cy;
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}
/** 定点方向单位向量（Vector2 方向语义,NaN 兜底 UnitY） */
function dirTo2(fx: number, fy: number, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - fx, dy = ty - fy;
  const d = Math.hypot(dx, dy);
  if (d === 0 || !Number.isFinite(d)) return { x: 0, y: 1 };
  return { x: dx / d, y: dy / d };
}
/** SimpleFlyMovement（NPC.cs:78100 原版逐轴步进,反向时双倍） */
function simpleFlyMove(e: Enemy, dvx: number, dvy: number, acc: number): void {
  if (e.vx < dvx) { e.vx += acc; if (e.vx < 0 && dvx > 0) e.vx += acc; }
  else if (e.vx > dvx) { e.vx -= acc; if (e.vx > 0 && dvx < 0) e.vx -= acc; }
  if (e.vy < dvy) { e.vy += acc; if (e.vy < 0 && dvy > 0) e.vy += acc; }
  else if (e.vy > dvy) { e.vy -= acc; if (e.vy > 0 && dvy < 0) e.vy -= acc; }
}

// ---------------------------------------------------------------------------
// AI_093 荷兰飞盗船 491（1457 NPC.cs:39245-39355；★BJ-C6/F4 勘正——曾锚 1456 树
// :40918-41028,1457 重排后整块前移 1673 行）
// ---------------------------------------------------------------------------
export function flyingDutchmanAI(e: Enemy, game: GameHooks, player: Player | null) {
  const x = dd2LocalAI(e);
  // ---- 首帧生成 4 炮（1457 :39247-39259）：ai[0..3]=炮位 ai[3]=60*i 出生错峰 ----
  if (!e.bInit) {
    e.bInit = true;
    e.ai0 = -1; e.ai1 = -1; e.ai2 = -1; e.ai3 = -1;
    for (let i = 0; i < 4; i++) {
      const c = spawnPart(game, e, 492);
      if (c) {
        c.master = e;
        c.ai0 = e.id;      // 原版 ai[0] = 船 whoAmI（锚定引用）
        c.ai1 = i;         // 槽位 0-3（决定船体偏移 -122+68*i）
        c.ai2 = 0;
        c.ai3 = 60 * i;    // 装填错峰（1457 :39252 60*num1355）
        c.despawnTimer = 600; // timeLeft = 600
        if (i === 0) e.ai0 = c.id;
        else if (i === 1) e.ai1 = c.id;
        else if (i === 2) e.ai2 = c.id;
        else e.ai3 = c.id;
      }
    }
  }
  e.despawnTimer = 750;    // netAlways：不入 CheckActive 消退（入侵旗舰）
  // ---- 炮位存活盘点（1457 :39260-39277,自毁 :39275 StrikeNPCNoInteraction(9999)）：全灭 → 自毁 ----
  const slots = [e.ai0, e.ai1, e.ai2, e.ai3];
  const enemies = game.enemies() as Enemy[];
  let anyAlive = false;
  for (let i = 0; i < 4; i++) {
    const id = slots[i];
    if (id >= 0) {
      const c = enemies.find((n) => n.id === id);
      if (!c || c.dead || c.vanillaId !== 492) {
        if (i === 0) e.ai0 = -1; else if (i === 1) e.ai1 = -1;
        else if (i === 2) e.ai2 = -1; else e.ai3 = -1;
      } else anyAlive = true;
    }
  }
  if (!anyAlive) {
    e.iframes = 0;
    e.dontTakeDamage = false;   // 先清无敌旗(StrikeNPCNoInteraction 走 hurt 管线)
    e.hp = 0;
    e.hurt(9999, 0, 0, game);   // StrikeNPCNoInteraction(9999) → 标准死亡管线
    return;
  }
  // ★R23b 系统性修:iframes=2 近似改真旗标(SetDefaults :14581→1458 :14676,
  // pierce===1 单发弹曾可直伤「恒无敌」船体)
  e.dontTakeDamage = true;   // 炮在世恒无敌
  // ---- 海盗跳舱（1457 :39278-39286）：1/300t 从船口弹射 212-215。
  //      出生位 = Center + ((rand−0.5)×(w−70), (rand−0.5)×20 − h/2 − 20) 随船 rotation 旋转
  //      （曾直接落船心 = 视觉瞬移）;速度 = ((rand−0.5)×5, −8.01) + 船速 ----
  if (rnd(300) === 0) {
    const p = spawnPart(game, e, [213, 215, 214, 212][rnd(4)]);
    if (p) {
      const r = e.visAngle;
      const offX = (Math.random() - 0.5) * (e.w - 70);
      const offY = (Math.random() - 0.5) * 20 - e.h / 2 - 20;
      const px = e.cx + offX * Math.cos(r) - offY * Math.sin(r);
      const py = e.cy + offX * Math.sin(r) + offY * Math.cos(r);
      p.x = px - p.w / 2;
      p.y = py - p.h / 2;
      p.vx = (Math.random() - 0.5) * 5 + e.vx;
      p.vy = -8.01 + e.vy;
      p.despawnTimer = 600;
    }
  }
  // ---- 动画计数（1457 :39287-39290 localAI[3] 64t 循环,渲染帧源） ----
  x[3] += 1;
  if (x[3] >= 64) x[3] = 0;
  // ---- 索敌（1457 :39291 TargetClosest） ----
  const tx = player && !player.dead ? player.cx : e.cx;
  const ty = player && !player.dead ? player.cy : e.cy;
  if (player && !player.dead) e.facing = tx > e.cx ? 1 : -1;
  // ---- 贴地巡航（1457 :39292-39333）：前方 10 格列扫描地面,保持离地 350-450px ----
  const st = game.world.store;
  const colX = clamp(Math.floor(e.cx / TILE) + sign(e.vx) * 10, 1, st.w - 2);
  const colY = Math.floor((e.y + e.h) / TILE);
  let n = 0;
  if (solidAt(game, colX, colY)) {
    n = 1;
  } else {
    for (; n < 150 && colY + n < st.h; n++) {
      if (solidAt(game, colX, colY + n)) { n--; break; }
    }
  }
  const gap = n * TILE;
  if (gap < 350) {
    let a = gap - 350;
    if (a < -4) a = -4;
    e.vy = lerp(e.vy, a, 0.05);
  } else if (gap > 450) {
    let a = gap - 350;
    if (a > 4) a = 4;
    e.vy = lerp(e.vy, a, 0.05);
  } else {
    e.vy *= 0.95;
  }
  // ---- 水平逼近（1457 :39334-39338）：距 ≥300px 且未达 6 速 → 朝向 +0.06 ----
  const dxp = tx - e.cx;
  if (Math.abs(dxp) >= 300 && (Math.abs(e.vx) < 6 || sign(e.vx) !== e.facing)) {
    e.vx += e.facing * 0.06;
  }
  e.visAngle = e.vx * 0.025;                    // rotation = vx*0.025（1457 :39339）
  e.facing = e.vx === 0 ? e.facing : -sign(e.vx); // spriteDirection = -sign(vx)（1457 :39340）
  // ---- 船底烟尘（:39343-39356 dust 228）:每 t 循环 2 次、各 50% 概率
  //      （期望 1/t;曾 1 次×50%=量减半,烟迹稀薄） ----
  for (let i = 0; i < 2; i++) {
    if (Math.random() < 0.5) {
      game.spawnParticles(
        e.cx + (Math.random() - 0.5) * (e.w - 70), e.y + e.h - 10,
        '#E06A24', 1, 0.4, { life: 40, grav: -0.02, damp: 0.94 });
    }
  }
  moveAndCollide(e, game.world, e.vx, e.vy);
  void ty;
}

// ---------------------------------------------------------------------------
// 荷兰大炮 492（aiStyle 75 分发 → 此处;NPC.cs:35889-35904 锚定 + :36008-36070 炮击）
// ai[0]=船 id（master 引用）,ai[1]=槽位,ai[2]=瞄准帧,ai[3]=装填计数（出生 60*i）
// ---------------------------------------------------------------------------
export function dutchmanCannonAI(e: Enemy, game: GameHooks, player: Player | null) {
  const ship = e.master;
  if (!ship || ship.dead || ship.vanillaId !== 491) { e.dead = true; return; }
  e.despawnTimer = Math.max(e.despawnTimer, Math.min(ship.despawnTimer, 600));
  // ---- 锚船偏移（:35889-35899）：(-122+68*slot)×朝向镜像,-6,随船 rotation 旋转 ----
  const sd = ship.facing === 1 ? 1 : -1;
  const ox = (-122 + 68 * e.ai1) * (sd !== 1 ? 1 : -1);
  const oy = -6;
  const rot = ship.visAngle;
  const rx = ox * Math.cos(rot) - oy * Math.sin(rot);
  const ry = ox * Math.sin(rot) + oy * Math.cos(rot);
  e.vx = ship.vx; e.vy = ship.vy;
  e.x = ship.cx - e.w / 2 + rx;
  e.y = ship.cy - e.h / 2 + ry;
  e.visAngle = rot;
  e.facing = sd;
  // ---- 装填（:36010-36016）：ai[3] 数到 240（出生错峰） ----
  if (e.ai3 < 240) e.ai3 += 1;
  // ---- 炮击（:36018-36052）：LOS 通 → 装满即朝玩家发 240 炮弹（14 速,-5 上抛） ----
  if (player && !player.dead && losClear(game, e.x, e.y, player.x, player.y)) {
    if (e.ai3 >= 240) {
      e.ai3 = 0;
      // :36027-36039 单趟归一：normalize(玩家中心−炮心) ×14,再整体 +(0,−5) 上抛
      // （NaN → UnitY 兜底）——曾二次归一（×14 → 重归一 → 再 −5,弹速与抛物线双失真）
      const d = dirTo(e, player.cx, player.cy);
      const vx = d.x * 14;
      const vy = d.y * 14 - 5;
      shootD(game, e.cx, e.cy, vx, vy, 30, 240, 300, 0.25);
    } else {
      // 瞄准帧（8 向索引,:36095-36124 的 ai[2] 语义;消费面=FindFrame case 492
      // frame.Y=num×ai[2](:71941) → 船代画 NPC_492 九向炮管姿态）。探测基 =
      // Vector2.UnitY.RotatedBy(-kπ/4)×50 = (sin,cos)×50（k=0 正下,顺时针 45° 步进;
      // spriteDirection==1 → 9-ai[2] 镜像）。★曾用 (cos,sin)×(-kπ/4)=UnitX 基,
      // 探测方位整体偏 2 八向(90°),炮管指向错档
      let best = 0, bestD = Infinity;
      for (let k = 0; k < 8; k++) {
        const ax = e.cx + Math.sin(k * (Math.PI / 4)) * 50;
        const ay = e.cy + Math.cos(k * (Math.PI / 4)) * 50;
        const d = Math.hypot(ax - player.cx, ay - player.cy);
        if (d < bestD) { bestD = d; best = k; }
      }
      e.ai2 = (sd === 1 ? 9 - (best + 1) : best + 1);
    }
  } else if (e.ai2 !== 0) {
    e.ai2 = 0;
  }
}

// ---------------------------------------------------------------------------
// walker 共享核（AI_102 尾段 cs:42406-42620 与 AI_109 尾段 cs:66577-66797 逐行同构）
// x[0..2]=卡位锚点（localAI[0..2]）;p=族参数;castDamp>0 时施法僵直（v*=damp 后返回）
// ---------------------------------------------------------------------------
interface WalkerP {
  frontDepth: number;   // 前方探测行数（num1568/num）
  headClear: number;    // 头顶净空行数（num1569/num2,headScan 才生效）
  bottomDepth: number;  // 底部探测行数（num1570/num3）
  grav: number;         // 悬空重力（num1571/num4）
  maxFall: number;      // 落速钳（num1572/num5）
  upAccel: number;      // 贴地升速（num1573/num6,负值）
  maxUp: number;        // 升速钳（num1574/num7,负值）
  headScan: boolean;    // 头顶净空扫描（flag113/flag5;541/564/565 均关）
  maxH: number;         // 水平极速（num1575/num8）
  accelH: number;       // 水平加速（num1576/num9）
  maxV: number;         // 垂直极速（num1577/num10）
  accelV: number;       // 垂直加速（num1578/num11）
}
function walkerKernel(
  e: Enemy, game: GameHooks, player: Player | null,
  x: number[], p: WalkerP, castDamp: number,
): void {
  // ---- 卡位/跳墙（cs:42391-42426 / :66557-66592） ----
  if (e.justHit) x[2] = 0;
  let jump = false;   // flag109：主动跳
  if (x[2] >= 0) {
    let range = 16;
    let fx = false, fy = false;
    if (e.x > x[0] - range && e.x < x[0] + range) fx = true;
    else if ((e.vx < 0 && e.facing > 0) || (e.vx > 0 && e.facing < 0)) { fx = true; range += 24; }
    if (e.y > x[1] - range && e.y < x[1] + range) fy = true;
    if (fx && fy) {
      x[2] += 1;
      if (x[2] >= 30 && range === 16) jump = true;
      if (x[2] >= 60) {
        x[2] = -180;
        e.facing *= -1;
        e.vx *= -1;
        e.hitWall = false;
      }
    } else {
      x[0] = e.x; x[1] = e.y; x[2] = 0;
    }
    // 施法期索敌冻结（AI_109 flag7 = !(ai[0]>0)，:66440 → :66614-66617 的
    // TargetClosestOldOnesInvasion 门）——casting 时保持既有朝向
    if (castDamp <= 0 && player && !player.dead) e.facing = e.seekDirX(player);
  } else {
    x[2] += 1;
    if (castDamp <= 0 && player && !player.dead) e.facing = e.seekDirX(player);
  }
  // ---- 施法僵直（cs:42387-42389 / :66554-66555）：AI 早退但碰撞步照跑 ----
  if (castDamp > 0) {
    e.vx *= castDamp;
    e.vy *= castDamp;
    oldVel.set(e, { x: e.vx, y: e.vy });
    moveAndCollide(e, game.world, e.vx, e.vy);
    if (e.hitWall) e.vx = 0;
    if (e.onGround || e.hitHead) e.vy = 0;
    return;
  }
  // ---- 前方/底部/头顶探测（cs:42428-42475 / :66594-66651） ----
  const frontX = Math.floor((e.x + e.w / 2) / TILE) + e.facing * 2;
  const frontY = Math.floor((e.y + e.h) / TILE);
  const bottomY = Math.floor((e.y + e.h) / TILE);
  const bottomX = Math.floor((e.x + e.w / 2) / TILE);
  let onSurface = true;   // flag111：悬空（无支撑）
  let nearFloor = false;  // flag112：贴地
  for (let ty = frontY; ty < frontY + p.frontDepth; ty++) {
    if (blockedAt(game, frontX, ty)) {
      if (ty <= frontY + 1) nearFloor = true;
      onSurface = false;
      break;
    }
  }
  for (let ty = bottomY; ty < bottomY + p.bottomDepth; ty++) {
    if (blockedAt(game, bottomX, ty)) {
      nearFloor = true;
      onSurface = false;
      break;
    }
  }
  if (p.headScan) {
    for (let ty = frontY - p.headClear; ty < frontY; ty++) {
      if (blockedAt(game, frontX, ty)) {
        nearFloor = false;
        jump = true;
        break;
      }
    }
  }
  if (jump) { nearFloor = false; onSurface = true; }
  // ---- 重力/升力（cs:42477-42495 / :66653-66671） ----
  if (onSurface) {
    e.vy += p.grav;
    if (e.vy > p.maxFall) e.vy = p.maxFall;
  } else {
    if ((e.dirY < 0 && e.vy > 0) || nearFloor) e.vy += p.upAccel;
    if (e.vy < p.maxUp) e.vy = p.maxUp;
  }
  // ---- 碰撞反弹（cs:42497-42519 / :66673-66695;oldVelocity=碰撞前速度） ----
  const ov = oldVel.get(e) ?? { x: e.vx, y: e.vy };
  if (e.hitWall) {
    e.vx = ov.x * -0.4;
    if (e.facing === -1 && e.vx > 0 && e.vx < 1) e.vx = 1;
    if (e.facing === 1 && e.vx < 0 && e.vx > -1) e.vx = -1;
  }
  if (e.onGround || e.hitHead) {
    e.vy = ov.y * -0.25;
    if (e.vy > 0 && e.vy < 1) e.vy = 1;
    if (e.vy < 0 && e.vy > -1) e.vy = -1;
  }
  // ---- 朝向加速（cs:42521-42559 / :66697-66735;方向档速度模型） ----
  if (e.facing === -1 && e.vx > -p.maxH) {
    e.vx -= p.accelH;
    if (e.vx > p.maxH) e.vx -= p.accelH;
    else if (e.vx > 0) e.vx += p.accelH / 2;
    if (e.vx < -p.maxH) e.vx = -p.maxH;
  } else if (e.facing === 1 && e.vx < p.maxH) {
    e.vx += p.accelH;
    if (e.vx < -p.maxH) e.vx += p.accelH;
    else if (e.vx < 0) e.vx -= p.accelH / 2;
    if (e.vx > p.maxH) e.vx = p.maxH;
  }
  if (e.dirY === -1 && e.vy > -p.maxV) {
    e.vy -= p.accelV;
    if (e.vy > p.maxV) e.vy -= p.accelV * 1.25;
    else if (e.vy > 0) e.vy += p.accelV * 0.75;
    if (e.vy < -p.maxV) e.vy = -p.maxH;
  } else if (e.dirY === 1 && e.vy < p.maxV) {
    e.vy += p.accelV;
    if (e.vy < -p.maxV) e.vy += p.accelV * 1.25;
    else if (e.vy < 0) e.vy -= p.accelV * 0.75;
    if (e.vy > p.maxV) e.vy = p.maxV;
  }
  // ---- 碰撞（原版 Collision_MoveNormal 零速语义:撞轴清零该轴速度） ----
  oldVel.set(e, { x: e.vx, y: e.vy });
  moveAndCollide(e, game.world, e.vx, e.vy);
  if (e.hitWall) e.vx = 0;
  if (e.onGround || e.hitHead) e.vy = 0;
}

// ---------------------------------------------------------------------------
// AI_102 沙尘精 541（NPC.cs:42224-42620）
// ---------------------------------------------------------------------------
export function sandElementalAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; }
  const x = dd2LocalAI(e);
  // ---- 族参数（:42225-42243 默认档 → :42246-42252 的 541 覆盖） ----
  const p: WalkerP = {
    frontDepth: 4, headClear: 3, bottomDepth: 3,
    grav: 0.1, maxFall: 2, upAccel: -0.1, maxUp: -4,
    headScan: false,
    maxH: 2, accelH: 0.1, maxV: 1, accelV: 0.04,
  };
  e.visAngle = e.vx * 0.04;                       // rotation = vx*0.04（:42249）
  // 血量越低越快（:42255-42257 num1575/num1576 随亏血加成）+ 半血免击退（:42258-42261）
  const ratio = e.hp / e.maxHp;
  p.maxH += (1 - ratio) * 2;
  p.accelH += (1 - ratio) * 0.02;
  e.def.knockbackResist = ratio < 0.5 ? 0 : e.def.knockbackResist; // def 存承受比例：0=免疫
  // ---- 攻击循环（:42263-42389） ----
  let castDamp = 0;
  if (e.ai0 < 0) e.ai0 = Math.min(e.ai0 + 1, 0);   // 冷却回摆（:42267-42269）
  if (e.ai0 > 0) {
    castDamp = 0.96;                                // flag114 → 施法僵直 ×0.96
    e.ai0 += 1;
    if (e.ai0 >= 135) { e.ai0 = -300; }             // 135t → -300 冷却（:42273-42276）
    if (e.ai0 === 54 && player && !player.dead) {
      // 玩家预测位 ±30 格找 ≤3 个落点放沙暴标记 658（:42300-42342）
      const px = player.cx + player.vx * 30;
      const py = player.cy;
      if (Math.hypot(px - e.cx, py - e.cy) < 2000) {
        const ptx = Math.floor(px / TILE), pty = Math.floor(py / TILE);
        const picks: Array<{ x: number; y: number }> = [];
        for (let t = 0; t < 1000 && picks.length < 3; t++) {
          const col = rndRange(ptx - 30, ptx + 31);
          if (picks.some((q) => Math.abs(q.x - col) < 10)) continue;
          const startY = pty - 20;
          const [, bottomY] = expandVertically(game, col, startY, 1, 51);
          const my = bottomY - 15;
          if (canSpawnSandstormHostile(game, col, my)) picks.push({ x: col, y: my });
        }
        for (const q of picks) {
          // 658 沙暴标记：原版 damage 0 纯视觉（尘柱 900t）——粒子代,不生成弹体
          game.spawnParticles(q.x * TILE + 8, q.y * TILE + 8, '#E0A050', 8, 1.4, { life: 60, grav: -0.06 });
        }
      } else {
        e.ai0 = -200;                               // 太远 → 缩短冷却（:42344-42347）
      }
    }
  }
  if (e.ai0 === 0) e.ai0 = 1;                       // 起手（:42387-42389）
  walkerKernel(e, game, player, x, p, castDamp);
}

// ---------------------------------------------------------------------------
// 沙鲨碰撞（Collision.AdvancedTileCollision + ForSandshark,cs:93808-93814）：
// 沙族 tile 无视碰撞,其余照撞;撞轴清零该轴速度并置 collideX/collideY 旗标。
// 湿身另按 UpdateCollision 的 Collision_MoveWhileWet 缩位移（:93762 waterMovementSpeed
// =0.5,542-545 不在 DD2/612/613 全速豁免表）——视水为可穿沙介质但移动仍半速
// ---------------------------------------------------------------------------
function moveSandShark(e: Enemy, game: GameHooks, vx: number, vy: number): void {
  const st = game.world.store;
  // NPC.Collision_MoveWhileWet（:93986）：velocity 不变,只缩位移
  const lf = e.liqFactor;
  if (lf !== undefined && lf !== 1) { vx *= lf; vy *= lf; }
  const passable = (tx: number, ty: number): boolean => {
    if (!st.inBounds(tx, ty)) return false;
    return st.isSolid(tx, ty) && !SANDSHARK_PASS.has(st.type[st.idx(tx, ty)]);
  };
  e.hitWall = false; e.onGround = false; e.hitHead = false;
  // X 轴
  const nx = e.x + vx;
  if (vx !== 0) {
    const d = sign(vx);
    const edge = d > 0 ? nx + e.w : nx;
    const tx = Math.floor(edge / TILE);
    const y0 = Math.floor(e.y / TILE);
    const y1 = Math.floor((e.y + e.h - 0.01) / TILE);
    let hit = false;
    for (let ty = y0; ty <= y1; ty++) {
      if (passable(tx, ty)) { hit = true; break; }
    }
    if (hit) { e.hitWall = true; e.vx = 0; } else e.x = nx;
  }
  // Y 轴
  const ny = e.y + vy;
  if (vy !== 0) {
    const d = sign(vy);
    const edge = d > 0 ? ny + e.h : ny;
    const ty = Math.floor(edge / TILE);
    const x0 = Math.floor(e.x / TILE);
    const x1 = Math.floor((e.x + e.w - 0.01) / TILE);
    let hit = false;
    for (let tx = x0; tx <= x1; tx++) {
      if (passable(tx, ty)) { hit = true; break; }
    }
    if (hit) {
      if (d > 0) e.onGround = true; else e.hitHead = true;
      e.vy = 0;
    } else {
      e.y = ny;
    }
  }
}

// ---------------------------------------------------------------------------
// AI_103 沙鲨族 542-545（NPC.cs:42621-42805）
// ---------------------------------------------------------------------------
export function sandSharkAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; e.dirY = 1; }
  const x = dd2LocalAI(e);
  if (e.facing === 0) e.facing = player ? e.seekDirX(player) : -1;   // :42625-42627
  // ---- 在沙判定（:42629-42634）：中心格是沙族 tile（须 nactive）或湿 ----
  // flag119 |= wet：沙鲨视水为沙——水中同样进入巡游/扑咬态（水豁免,原版 :42634）
  const ctx = Math.floor(e.cx / TILE), cty = Math.floor(e.cy / TILE);
  const st0 = game.world.store;
  const sandMedium = (t: number, tx: number, ty: number): boolean =>
    (CONV_SAND.has(t) || CONV_SANDSTONE.has(t) || CONV_HARDENED.has(t))
    && st0.inBounds(tx, ty) && st0.isActive(tx, ty);    // 原文 tileSafely7.nactive()
  const isSandTile = sandMedium(tileTypeAt(game, ctx, cty), ctx, cty);
  const inSand = isSandTile || e.inWater;
  // ---- 扑咬门（:42637-42642 flag120）：玩家在上方（vy 不上升）且距 >150px ----
  const tgt = player && !player.dead ? { x: player.cx, y: player.cy } : null;
  const canLunge = !!tgt
    && player!.vy > -0.1
    && Math.hypot(tgt!.x - e.cx, tgt!.y - e.cy) > 150;
  if (x[0] === -1 && !inSand) x[0] = 20;           // 跃出后落回非沙 → 短冷却（:42643-42645）
  if (x[0] > 0) x[0] -= 1;
  // 游弋周期音（:42652-42663）：soundDelay==0 时播 (15,Center,4)——case15 style4
  //   映射 num=1+num18=0.25 → Roar_1 ×0.25(音量是调用点参数非文件档,FILE_CASE_VOL
  //   不登记,2026-08-18 修正),delay = 玩家距/40 钳 10..20——与蠕虫掘地音同构
  if (inSand && e.digSndDelay <= 0) {
    const dd = tgt ? Math.hypot(tgt.x - e.cx, tgt.y - e.cy) : 400;
    e.digSndDelay = Math.round(Math.min(20, Math.max(10, dd / 40)));
    game.playSfxWav?.('Roar_1', 0.25, e.cx, e.cy);
  } else if (e.digSndDelay > 0) {
    e.digSndDelay--;
  }
  if (inSand) {
    // ---- 沙中巡游（:42652-42745） ----
    e.ai2 = Math.min(e.ai2 + 1, 30);               // 扑咬回充（:42660-42662）
    if (canLunge) {
      e.facing = tgt!.x > e.cx ? 1 : -1;            // TargetClosest
      e.vx += e.facing * 0.15;
      e.vy += e.dirY * 0.15;
      e.vx = clamp(e.vx, -5, 5);
      e.vy = clamp(e.vy, -3, 3);
      // 前方是否仍是沙（:42677-42689）：中心+速度方向×体半径+速度
      const vv = Math.hypot(e.vx, e.vy);
      const ax = e.cx + (vv > 0 ? e.vx / vv : 0) * Math.hypot(e.w, e.h) / 2 + e.vx;
      const ay = e.cy + (vv > 0 ? e.vy / vv : 0) * Math.hypot(e.w, e.h) / 2 + e.vy;
      const at = tileTypeAt(game, Math.floor(ax / TILE), Math.floor(ay / TILE));
      let aheadSand = sandMedium(at, Math.floor(ax / TILE), Math.floor(ay / TILE));
      // 水豁免（:42696-42699）：前方非沙且自身湿 → 前方有液体即视为仍在介质中
      if (!aheadSand && e.inWater) aheadSand = liquidAt(game, Math.floor(ax / TILE), Math.floor(ay / TILE)) > 0;
      const range = 400;
      if (!aheadSand && sign(e.vx) === e.facing
        && Math.hypot(tgt!.x - e.cx, tgt!.y - e.cy) < range
        && (e.ai2 >= 30 || e.ai2 < 0)) {
        // vol 0.4 = case14 style542 档（:803 ×0.4）——原 FILE_CASE_VOL.Zombie_7 文件级档
        //   与吸血鬼闲话(case29 style7 满响)冲突,2026-08-26 移交调用点显式传
        if (x[0] === 0) { x[0] = -1; game.playSfxWav?.('Zombie_7', 0.4, e.cx, e.cy); }  // :42713 (14,542) 出沙扑咬音
        e.ai2 = -30;
        const d = dirTo(e, tgt!.x, tgt!.y - 80);   // 跃沙扑咬 12 速（:42708-42711）
        e.vx = d.x * 12;
        e.vy = d.y * 12;
      }
    } else {
      // 沙下巡航（:42713-42745）：撞轴反弹 + 蛇形升降
      if (e.hitWall) { e.vx *= -1; e.facing *= -1; }
      if (e.onGround || e.hitHead) {
        e.vy *= -1;
        e.dirY = sign(e.vy) || 1;
        e.ai0 = e.dirY;
      }
      e.vx += e.facing * 0.1;
      if (e.vx < -6 || e.vx > 6) e.vx *= 0.95;
      // 贴沙探测（flag121,:42655-42659）：采样 = (Center+(0,24)).ToTileCoordinates().Y − 2
      // ——即中心行或其上一行（反编译表达式原样,非"下方 24px"）;水中巡游时该处非沙 →
      // ai[0]=1 下潜回沙
      const bt = tileTypeAt(game, ctx, Math.floor((e.cy + 24) / TILE) - 2);
      const floorNear = sandMedium(bt, ctx, Math.floor((e.cy + 24) / TILE) - 2);
      e.ai0 = floorNear ? -1 : 1;
      const osc = 0.06, step = 0.01;
      if (e.ai0 === -1) {
        e.vy -= step;
        if (e.vy < -osc) e.ai0 = 1;
      } else {
        e.vy += step;
        if (e.vy > osc) e.ai0 = -1;
      }
      if (e.vy > 0.4 || e.vy < -0.4) e.vy *= 0.95;
    }
  } else {
    // ---- 离沙（:42747-42763）：重力下落 + 贴地爬行 ----
    if (e.vy === 0 && canLunge) e.facing = tgt!.x > e.cx ? 1 : -1;
    if (e.vy === 0) {
      e.vx += e.facing * 0.1;
      if (e.vx < -1 || e.vx > 1) e.vx *= 0.95;
    }
    e.vy += 0.3;
    if (e.vy > 10) e.vy = 10;
    e.ai0 = 1;
  }
  // ---- 俯仰角（:42765-42772 rotation=vy*dir*0.1 钳 ±0.2） ----
  e.visAngle = clamp(e.vy * e.facing * 0.1, -0.2, 0.2);
  moveSandShark(e, game, e.vx, e.vy);
}

// ---------------------------------------------------------------------------
// AI_104 DD2AttackerTest 547（NPC.cs:42807-42809）——原版即 active=false
// ---------------------------------------------------------------------------
export function dd2AttackerTestAI(e: Enemy, game: GameHooks): void {
  void game;
  e.dead = true;
}

// ---------------------------------------------------------------------------
// AI_105 永恒水晶 548（NPC.cs:42810-43062）
// ai[1] 0=倒计时+放门 / 1=败北演出 / 2=胜利演出（后两者依赖 DD2Event 触发）
// ---------------------------------------------------------------------------
export function eterniaCrystalAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; }
  const x = dd2LocalAI(e);
  e.despawnTimer = 750;   // netAlways：不参与离屏消退
  if (e.spawnAlpha === 0) e.lightRGB = [1.3, 0.5, 1.5];   // :42813-42816
  void player;
  if (e.ai1 === 0) {
    // ---- 倒计时 + 双端放门（:42818-42845） ----
    if (e.ai0 > 0) e.ai0 -= 1;
    if (e.ai0 !== 0) return;
    e.ai0 = 180;
    if (x[0] === 0) {
      x[0] = 1;
      const ends = checkArenaScore(game, e.cx, e.y + e.h);
      ends.left.x += 2; ends.right.x -= 2;        // :42832-42833
      for (const [end, gate] of [[ends.left, 0], [ends.right, 1]] as const) {
        const portal = spawnPart(game, e, 549);
        if (portal) {
          portal.ai0 = 0; portal.ai1 = 0;
          portal.ai2 = gate;                      // 右门 ai[2]=1（leftGate 判定源）
          portal.x = end.x * TILE + 8 - portal.w / 2;
          portal.y = end.y * TILE + 16 - portal.h; // Bottom = 端点 ToWorldCoordinates(8,16)
        }
      }
      DD2_EVENT_HOOKS.findArenaHitbox?.(game);    // DD2Event.FindArenaHitbox（:42841）
    }
  } else if (e.ai1 === 2) {
    // ---- 胜利演出（:42846-42958,依赖 DD2Event 置 ai[1]=2） ----
    // ★R23b 系统性修:iframes=2 近似改真旗标(pierce===1 单发弹绕过 iframes 免疫门)
    // ★BJ450:改真名旗——原版 :41170 置的是 dontTakeDamageFromHostiles（仅敌意来源
    // 免伤;水晶 friendly=true → 玩家通道本就不入,敌意残部经互伤门 :93557/弹幕
    // flag2 :12626 拒）,每拍重写维持
    e.dontTakeDamageFromHostiles = true;           // :41170 + 满血（每拍重写）
    e.hp = e.maxHp;
    if (e.ai0 === 3) {
      // :42851 胜利演出音（DD2_WinScene）——曾缺
      game.playSfxFiles(soundTrackFiles('dd2_win_scene'), 1, e.cx, e.cy);
      for (const n of game.enemies() as Enemy[]) {
        if (!n.dead && n.vanillaId === 549) { n.ai1 = 1; n.ai0 = 0; }
      }
      game.spawnParticles(e.cx, e.cy - 40, '#B0FFD0', 24, 3, { life: 60 });
    }
    e.ai0 += 1;
    if (e.ai0 <= 120) {
      // 升空小回旋（:42866-42873）
      e.vy = Math.cos((e.ai0 / 120) * TAU) * 0.25 - 0.25;
    } else {
      e.vy = 0;
    }
    // ---- 胜利尘涡(NPC.cs(1458):41214-41253 精确式,终清波实装):num1499 密度相位
    //      0.99→(≥60).79→(≥120).58→(≥180).43→(≥240).33;≥540 →1(全滚不出尘);
    //      每 tick 9 掷,num1499=【不出的概率】——roll≥num1499 才出一粒 264 号
    //      NewDustPerfect(位置=center+(0,-20)+向×(110+600·r)、速=反向×(14+8·r)、
    //      scale .9/fadeIn 1.15+.3r/color A=num1499·(1−num1499)/noGravity/noLight)
    //      ——密度随演出爬升的"沙暴漏斗"。旧"<540 且 roll<0.6 单粒 spawnParticles"
    //      近似(恒密度+无径向速度)退役 ----
    if (e.ai0 >= 0 && e.ai0 < 540) {
      const n1499 = e.ai0 >= 240 ? 0.33
        : e.ai0 >= 180 ? 0.43
        : e.ai0 >= 120 ? 0.58
        : e.ai0 >= 60 ? 0.79 : 0.99;
      for (let k = 0; k < 9; k++) {
        if (Math.random() < n1499) continue;                 // !(NextFloat<num1499)
        const ang = Math.random() * TAU;                     // num1501
        const r = Math.random();                             // num1502
        const px = e.cx + Math.cos(ang) * (110 + 600 * r);
        const py = e.cy - 20 + Math.sin(ang) * (110 + 600 * r);
        const d = game.spawnDust?.(px, py, 0, 0, 264,
          -Math.cos(ang) * (14 + 8 * r), -Math.sin(ang) * (14 + 8 * r), 0,
          null, 1, true, true);
        if (!d) break;
        d.scale = 0.9;
        d.fadeIn = 1.15 + r * 0.3;
        d.color = { r: 255, g: 255, b: 255, a: Math.round(255 * n1499 * (1 - n1499)) };
        d.noGravity = true;
        d.noLight = true;
      }
    }
    // ---- 12 拍星爆(:41255-41271):ai0∈{100,160,...,540} 时整环 120 粒 264 号
    //      perfect(半径=810−ai0 收束、速=反向×(14+5·ai0/600+8·rand)、color A=0=
    //      预乘纯加性白)——原版整缺面补齐 ----
    if ((e.ai0 | 0) === e.ai0 && RING_BURST_TICKS.includes(e.ai0)) {
      const radius = 810 - e.ai0;
      for (let i = 0; i < 120; i++) {
        const ang = (i / 120) * TAU;
        const r = Math.random();
        const spd = 14 + 5 * (e.ai0 / 600) + 8 * r;
        const px = e.cx + Math.cos(ang) * radius;
        const py = e.cy - 20 + Math.sin(ang) * radius;
        const d = game.spawnDust?.(px, py, 0, 0, 264,
          -Math.cos(ang) * spd, -Math.sin(ang) * spd, 0, null, 1, true, true);
        if (!d) break;
        d.scale = 0.9;
        d.fadeIn = 1.15 + r * 0.3;
        d.color = { r: 255, g: 255, b: 255, a: 0 };
        d.noGravity = true;
        d.noLight = true;
      }
    }
    if (e.ai0 >= 600) {
      DD2_EVENT_HOOKS.stopInvasion?.(game, true);  // DD2Event.StopInvasion(win:true)
      e.iframes = 0;
      e.dontTakeDamage = false;                    // 先清旗再走 hurt 死亡管线
      e.hp = 0;
      e.hurt(9999, 0, 0, game);
    }
  } else if (e.ai1 === 1) {
    // ---- 败北演出（:42959-43061,依赖 DD2Event.ReportLoss） ----
    // ★BJ450:真名旗（原版 :41280 每拍重写 dontTakeDamageFromHostiles;血尽转换
    // checkDead :78896 同旗——入口已在 Enemy.ts hurt 级联 548 支接通,本支由死码
    // 转可达）
    e.dontTakeDamageFromHostiles = true;
    e.hp = e.maxHp;
    if (e.ai0 === 0) {
      // ★B1 接线批：败北演出音。原版首帧在水晶同拍生成效果弹 672（NPC.cs:41299，
      // Center−UnitY×40）→ 弹 t=0（localAI[0]==0）播 DD2_DefeatScene
      //（Projectile.cs:36991-36992 aiStyle132；SoundID.cs:992 单变体无音量覆写 → 1）
      // ——本仓演出折叠在水晶本体，音挂同一拍（胜利音 dd2_win_scene 同构，:42851）
      game.playSfxFiles(soundTrackFiles('dd2_defeat_scene'), 1, e.cx, e.cy);
      for (const n of game.enemies() as Enemy[]) {
        if (!n.dead && n.vanillaId === 549) { n.ai1 = 1; n.ai0 = 0; }
      }
      DD2_EVENT_HOOKS.reportLoss?.(game);
      game.spawnParticles(e.cx, e.cy - 40, '#FF6A6A', 24, 3, { life: 60 });
    }
    if (e.ai0 === 105) {
      // ★B1 接线批：水晶喷溅 gore（Projectile.cs:37001-37012 效果弹 t=105 段）：
      // 20 枚 SelectRandom{1027..1030}，速度向量=(rand×10,0) 旋(i/20·−π+rand·0.1−0.05)、
      // 出生位=弹心(Center−40y)+向×3；vy>0 反折 ×−0.5、vy<−5 再 ×0.8、尾乘
      // vy×1.1/vx×0.88（NewGoreDirect 标准扰动由 GorePiece.newGore 缺省档承载）
      const ax = e.cx, ay = e.cy - 40;
      for (let i = 0; i < 20; i++) {
        const th = (i / 20) * -Math.PI + Math.random() * 0.1 - 0.05;
        const spd = Math.random() * 10;
        let gx = Math.cos(th) * spd, gy = Math.sin(th) * spd;
        if (gy > 0) { gx *= -0.5; gy *= -0.5; }
        if (gy < -5) gy *= 0.8;
        gy *= 1.1; gx *= 0.88;
        GorePiece.newGore(1027 + rnd(4), ax + gx * 3, ay + gy * 3, gx, gy);
      }
    }
    e.ai0 += 1;
    if (e.ai0 < 96) e.vy = lerp(0, -1, e.ai0 / 96);   // :42993-42997 上浮
    if (e.ai0 >= 96) e.spawnAlpha = Math.min(255, e.spawnAlpha + 50);  // 渐隐
    if (Math.random() < 0.6) {
      const a = Math.random() * TAU;
      game.spawnParticles(
        e.cx + Math.cos(a) * (70 + Math.random() * 600),
        e.cy - lerp(0, 70, lerpValue(0, 300, e.ai0)) + Math.sin(a) * 40,
        '#FFB0B0', 1, 0.5, { life: 40 });
    }
    if (e.ai0 >= 600) {
      DD2_EVENT_HOOKS.stopInvasion?.(game, false);
      e.iframes = 0;
      e.dontTakeDamage = false;                    // 先清旗再走 hurt 死亡管线
      e.hp = 0;
      e.hurt(9999, 0, 0, game);
    }
  }
}

// ---------------------------------------------------------------------------
// AI_106 神秘传送门 549（NPC.cs:43063-43152）
// ai[2]=0 左门/1 右门;ai[1] 0=开门出怪（事件依赖）→ 1=缩放消散
// ---------------------------------------------------------------------------
export function lanePortalAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) {
    e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = e.ai2 === 1 ? 1 : 0;
    // ★B1 接线批：实例级 destroy 注入——循环轨随实体剔除拆轨（Entity.compact 对
    // dead 实体回调 destroy，Entity.ts:69-76；GrenadeProj 引信音同款兜底通道）
    (e as { destroy?: () => void }).destroy = () => {
      portalLoops.get(e)?.stop();
      portalLoops.delete(e);
    };
  }
  const x = dd2LocalAI(e);
  const leftGate = e.ai2 === 0;
  e.despawnTimer = 750;   // netAlways
  if (e.spawnAlpha === 0) e.lightRGB = [0.5, 0.1, 0.3];   // :43066-43068
  void player;
  const crystal = findCrystal(game);
  // SetDefaults dontTakeDamage=true（1458 :16068-16085）：开门期水晶在世恒无敌（:43119）;
  // 水晶亡转消散态时**继续无敌**（:43124 dontTakeDamage=true 进 ai[1]=1）直至
  // 550t 才解除（:43145）——消散全程可被玩家打的窗口不存在。
  // ★R23b 系统性修:iframes=2 近似改真旗标(pierce===1 单发弹绕过 iframes 免疫门)
  e.dontTakeDamage = true;
  if (e.ai1 === 0) {
    // ---- 开门出怪（:43071-43116） ----
    if (x[0] === 0) {
      // F2 2026-08-26:vol 0.7→1.0——SoundID.cs:986 DD2_EtherianPortalOpen=
      // CreateTrackable("dd2_etherian_portal_open") 无 WithVolume,NPC.cs:41400
      // 调用点亦无 override → 满响×PlayTrackedSound 距离衰减（曾私改 0.7）
      game.playSfxFiles(['dd2_etherian_portal_open'], 1.0, e.cx, e.cy);  // DD2_EtherianPortalOpen（:43075→41400）
    }
    if (x[0] > 150) portalLoopManage(e, game, 1);   // ★B1：循环轨起轨（NPC.cs:41403-41413 localAI[0]>150 判 GetActiveSound 空 → PlayTrackedSound;SoundID.cs:984 无 WithVolume → 基音量 1。★终清波:startTrackedLoop 位置化跟踪——atten/pan 随 setPos 距离衰减,屏距衰减登记闭合）
    if (!DD2_EVENT_HOOKS.enemySpawningOnHold()) e.ai0 += 1;
    const rate = DD2_EVENT_HOOKS.laneSpawnRate();
    // 出怪拍（:43094-43108 1:1）：ai[0] 数到 LaneSpawnRate 才进门——首拍在第
    // rate tick（不是 0）,此后每 rate tick 一拍,3 拍归零
    if (e.ai0 >= rate) {
      if (e.ai0 >= rate * 3) e.ai0 = 0;
      if (e.ai0 % rate === 0) {
        DD2_EVENT_HOOKS.spawnMonsterFromGate?.(game, e.cx, e.y + e.h, leftGate);
      }
    }
    x[0] += 1;
    if (x[0] > 180) x[0] = 180;
    if (x[0] >= 180) {
      if (crystal) return;                        // 水晶在世 → 驻守（:43109-43113）
      e.ai1 = 1;                                  // 水晶亡 → 开始消散
      e.ai0 = 0;
    }
  } else if (e.ai1 === 1) {
    // ---- 缩放消散（:43118-43146） ----
    e.ai0 += 1;
    e.vanillaScale = lerp(1, 0.05, lerpValue(500, 600, e.ai0));
    // ★B1：收门态循环轨跟随——GetActiveSound 空则重建 + Volume=scale 逐帧降音
    //（NPC.cs:41455-41465；scale 下限 0.05 不归零,轨随终帧显式拆）
    portalLoopManage(e, game, e.vanillaScale);
    if (e.ai0 >= 550) {
      portalLoopManage(e, game, 0);                // :43146 activeSound2?.Stop()
      e.iframes = 0;
      e.dontTakeDamage = false;                    // :43145 解除无敌 → 自杀走 hurt 管线
      e.hp = 0;
      e.hurt(9999, 0, 0, game);
    }
  }
}

// ---------------------------------------------------------------------------
// AI_108 俯冲飞行族（NPC.cs:43157 → AI_108_DivingFlyer :65959）
// 558/559/560 埃特尼亚飞龙 T1/T2/T3 + 574/575 小妖魔滑翔怪 T2/T3
// ---------------------------------------------------------------------------
interface FlyerP {
  kbMult: number; hoverUp: number; range: number; approach: number; aimT: number;
  damp: number; jitter: number; diveSpeed: number; recoverLerp: number; diveDist: number;
  steerLerp: number; speedAdd: number; minSpeed: number; explode: boolean; fade: boolean;
  grav: number; sep: number;
}
function flyerParams(id: number): FlyerP {
  // 默认档（:65986-66002,本族无默认成员,保留作基线）
  const base: FlyerP = {
    kbMult: 0.4, hoverUp: 200, range: 750, approach: 30, aimT: 30, damp: 0.95,
    jitter: 50, diveSpeed: 14, recoverLerp: 30, diveDist: 100, steerLerp: 20,
    speedAdd: 0, minSpeed: 7, explode: false, fade: false, grav: 0, sep: 0.05,
  };
  if (id === 558 || id === 559 || id === 560) {
    // 飞龙档（:66004-66022）
    return {
      ...base,
      kbMult: id === 558 ? 0.7 : id === 559 ? 0.5 : 0.2,
      hoverUp: 400, range: 500, approach: 90, aimT: 20,
      jitter: 0, diveSpeed: 8, diveDist: 150, steerLerp: 60,
      speedAdd: 0.05, minSpeed: 6, explode: false, fade: true, grav: 0,
    };
  }
  // 小妖魔滑翔怪档（:66024-66042）
  return {
    ...base,
    kbMult: id === 575 ? 0.4 : 0.6,
    hoverUp: 400, range: 500, approach: 90, aimT: 30,
    jitter: 3, diveSpeed: 8, diveDist: 150, steerLerp: 10,
    speedAdd: 0.05, minSpeed: 0, explode: true, fade: true, grav: -0.1, sep: 0.05,
  };
}

export function divingFlyerAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) {
    e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    // ★台账⑩：循环轨随实体剔除拆轨（Entity.compact 对 dead 实体回调）
    (e as { destroy?: () => void }).destroy = () => fuseLoopStop(e);
  }
  const x = dd2LocalAI(e);
  const p = flyerParams(e.vanillaId ?? 0);
  const LOS_GRACE = 120;   // num14（:66003）
  // ---- 出生渐显（:66062-66092 flag5） ----
  if (p.fade) {
    if (x[0] === 0) e.spawnAlpha = 255;
    if (x[0] === 30) game.playSfxFiles(soundTrackFiles('dd2_etherian_portal_spawn_enemy'), 0.4, e.cx, e.cy); // DD2_EtherianPortalSpawnEnemy（:64270 PlayTrackedSound）
    if (x[0] < 60) {
      x[0] += 1;
      e.spawnAlpha = Math.max(0, e.spawnAlpha - 5);
      e.alphaFade = false;   // 接管 fromVanilla 的通用渐显（原版由本 AI 驱动）
    }
  }
  // ---- 索敌（:66044 NPCUtils.TargetClosestOldOnesInvasion） ----
  const tgt = dd2Target(game, e, player);
  // ---- 同族分离（:66094-66116 flag4） ----
  for (const n of game.enemies() as Enemy[]) {
    if (n === e || n.dead || n.vanillaId !== e.vanillaId) continue;
    if (Math.abs(e.x - n.x) + Math.abs(e.y - n.y) < e.w) {
      if (e.x < n.x) e.vx -= p.sep; else e.vx += p.sep;
      if (e.y < n.y) e.vy -= p.sep; else e.vy += p.sep;
    }
  }
  // ---- 朝向与俯仰（:66118-66130） ----
  e.visAngle = Math.atan2(e.vy, e.vx);
  if (sign(e.vx) !== 0) e.facing = -sign(e.vx);
  if (e.visAngle < -Math.PI / 2) e.visAngle += Math.PI;
  if (e.visAngle > Math.PI / 2) e.visAngle -= Math.PI;
  if (!tgt) { fly(e); return; }
  const txc = tgt.x, tyc = tgt.y;
  const LOS = losClear(game, e.cx, e.cy, txc, tyc);
  const speedAdd = p.speedAdd * p.steerLerp;   // num12 *= num11（:66136）
  if (e.ai0 === 0) {
    // ---- 悬空逼近（:66138-66186）;悬空态击退 = 族档（:66140） ----
    e.kbResistOverride = getKnockbackMultiplierScaledByDifficulty(p.kbMult, e.difficulty);
    // 原版：vector = normalize(Δ)*num（逼近速:飞龙 3/小妖魔 4）;vector2 = normalize(Δ-(0,num2))*num
    // ★BJ706-A 定谳：num2 上抬偏移在【原差域 Δ】上施加（cs:66296-66300 vector2 =
    //   vector − UnitY×num2 先于 Normalize）——曾错写成 normalize(Δ)*num − UnitY×num2
    //   （单位向量域减 400）→ 任意目标距 >4px 时悬空向量恒近垂直（400≫水平分量）
    //   = 小妖魔滑翔怪出传送门后直上不下（用户实报,574/575 与 558-560 飞龙同链）。
    const num = e.vanillaId === 574 || e.vanillaId === 575 ? 4 : 3;
    const dx = txc - e.cx, dy = tyc - e.cy;
    const dist = Math.hypot(dx, dy);
    const ux = dist > 0 ? dx / dist : 0, uy = dist > 0 ? dy / dist : 0;
    const vx1 = ux * num, vy1 = uy * num;
    let hvx = dx, hvy = dy - p.hoverUp;           // Δ − UnitY×num2（:66297 原差域）
    const hl = Math.hypot(hvx, hvy) || 1;
    hvx = (hvx / hl) * num;
    hvy = (hvy / hl) * num;
    let los = LOS;
    if (e.ai3 >= LOS_GRACE) los = true;            // 120t 视线宽限（:66152-66154）
    const ang = Math.atan2(uy, ux);
    los = los && ang > Math.PI / 8 && ang < Math.PI - Math.PI / 8;  // 下视野门（:66156-66158）
    if (dist > p.range || !los) {
      e.vx = (e.vx * (p.approach - 1) + hvx) / p.approach;
      e.vy = (e.vy * (p.approach - 1) + hvy) / p.approach;
      if (tyc < e.cy) {
        e.vy -= 0.2;
        if (e.vy < -10) e.vy = -10;
      }
      if (!los) {
        e.ai3 += 1;                                 // 视线中断计数（:66170-66179）
      } else {
        e.ai3 = 0;
      }
    } else {
      e.ai0 = 1;                                    // 进入瞄准（:66181-66186）
      e.ai2 = vx1;
      e.ai3 = vy1;
    }
  } else if (e.ai0 === 1) {
    // ---- 瞄准（:66188-66225）;瞄准/俯冲两态击退门 = 0（:66190/:66243） ----
    e.kbResistOverride = 0;
    e.vx *= p.damp;
    e.vy *= p.damp;
    e.vy += p.grav;                                 // 小妖魔下沉点火（num16）
    e.ai1 += 1;
    if (e.ai1 === p.aimT) {
      // 俯冲音（:66202-66222）：飞龙 558-560 DD2_WyvernDiveDown（1/5 追加 Scream）；
      // 小妖魔滑翔怪 574/575 DD2_KoboldFlyerChargeScream + DD2_KoboldIgnite
      if (e.vanillaId === 574 || e.vanillaId === 575) {
        game.playSfxFiles(soundTrackFiles('dd2_kobold_flyer_charge_scream'), 0.7, e.cx, e.cy);
        game.playSfxFiles(['dd2_kobold_ignite'], 0.6, e.cx, e.cy);
      } else {
        game.playSfxFiles(soundTrackFiles('dd2_wyvern_dive_down'), 0.7, e.cx, e.cy);
        if (Math.random() < 0.2) game.playSfxFiles(soundTrackFiles('dd2_wyvern_scream'), 0.6, e.cx, e.cy);
      }
    }
    if (e.ai1 >= p.aimT) {
      e.ai0 = 2;
      e.ai1 = 0;
      let jx = e.ai2 + rndRange(-p.jitter, p.jitter + 1) * 0.04;
      let jy = e.ai3 + rndRange(-p.jitter, p.jitter + 1) * 0.04;
      const jl = Math.hypot(jx, jy) || 1;
      jx = (jx / jl) * p.diveSpeed;
      jy = (jy / jl) * p.diveSpeed;
      e.vx = jx; e.vy = jy;
    }
  } else if (e.ai0 === 2) {
    // ---- 俯冲追踪（:66227-66295）;俯冲态击退门 = 0（:66243） ----
    e.kbResistOverride = 0;
    e.ai1 += 1;
    const dist = Math.hypot(txc - e.cx, tyc - e.cy);
    let past = dist > p.diveDist && e.cy > tyc;     // 冲过目标下方（flag7）
    if (p.explode) past = false;                    // flag3：小妖魔不提前收（:66248）
    if ((e.ai1 >= p.recoverLerp && past) || Math.hypot(e.vx, e.vy) < p.minSpeed) {
      e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
      e.vx /= 2; e.vy /= 2;
      e.ai1 = 45;                                   // flag=true：回旋态（:66260-66264）
      e.ai0 = 4;
    } else {
      const dx = txc - e.cx, dy = tyc - e.cy;
      const d = Math.hypot(dx, dy) || 1;
      const spd = Math.hypot(e.vx, e.vy);
      e.vx = (e.vx * (p.steerLerp - 1) + (dx / d) * (spd + speedAdd)) / p.steerLerp;
      e.vy = (e.vy * (p.steerLerp - 1) + (dy / d) * (spd + speedAdd)) / p.steerLerp;
    }
    // 撞实心块 → 自爆（:66288-66294,flag2 仅小妖魔）
    if (p.explode && solidBody(game, e)) { e.ai0 = 3; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
  } else if (e.ai0 === 4) {
    // ---- 回旋（:66298-66308） ----
    e.ai1 -= 3;
    if (e.ai1 <= 0) { e.ai0 = 0; e.ai1 = 0; }
    e.vx *= 0.95;
    e.vy *= 0.95;
  }
  // ---- 贴身自爆（:66316-66324,flag2 仅小妖魔,距目标 <64px） ----
  if (p.explode && e.ai0 !== 3 && Math.hypot(txc - e.cx, tyc - e.cy) < 64) {
    e.ai0 = 3; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
  }
  // ★台账⑩：俯冲小妖精滑翔怪引信循环音（AI_108,1458 NPC.cs:66388-66406）——
  // 俯冲态 ai[1]>=20 起 KoboldIgniteLoop 单轨跟随重建,其余态拆轨;曾整段缺失
  if (p.explode) {
    fuseLoopManage(e, game, [['ignite', 'dd2KoboldIgniteLoop']],
      e.ai0 === 2 && e.ai1 >= 20, e.cx, e.cy);
  }
  if (e.ai0 === 3) {
    fuseLoopStop(e);                    // 自爆即拆轨（原版实体失效连带熄灭）
    // ---- 自爆（:66326-66380）：扩盒 192²、伤 80、3t 后消散 ----
    e.x = e.cx; e.y = e.cy;
    e.w = 192; e.h = 192;
    e.x -= e.w / 2; e.y -= e.h / 2;
    e.vx = 0; e.vy = 0;
    e.def.damage = 80;                              // GetAttackDamage_ScaledByDifficulty(80)
    e.spawnAlpha = 255;
    if (e.ai1 === 0) {
      game.spawnParticles(e.cx, e.cy, '#FFD24A', 20, 4, { life: 30, grav: -0.05 });
      game.spawnParticles(e.cx, e.cy, '#FF9A3C', 12, 3, { life: 40 });
    }
    e.ai1 += 1;
    if (e.ai1 >= 3) {
      game.playSfx('explosion', 1, e.cx, e.cy);     // SoundID.Item14
      game.spawnParticles(e.cx, e.cy, '#FFB060', 30, 5, { life: 36 });
      e.dead = true;                                // 原版 life=0 + active=false（不走掉落管线）
    }
    return;
  }
  fly(e);
}

/** 身体埋实心块判定（原版 Collision.SolidCollision(position,width,height) 全盒 any 等价件
 *  ★台账⑨(2026-08-31)：曾按五点采样（四角+中心）近似——半砖骑线/边缘外扩一格的
 *  小妖魔贴墙角落在采样点间穿透,自爆门漏爆。现按盒覆盖的全部 tile 列行扫描,
 *  任一实心即真（与 bossAI_duke_moonlord.inSolid 同款修法）。
 *  导出面：tests/boss-dd-ledger-clean.test.ts 消费（回归锚）。 */
export function solidBody(game: GameHooks, e: Enemy): boolean {
  const st = game.world.store;
  const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.001) / TILE);
  const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// AI_109 黑暗魔法师 564/565（NPC.cs:43161 → AI_109_DarkMage :66392）
// ---------------------------------------------------------------------------
export function darkMageAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; }
  const x = dd2LocalAI(e);
  const p: WalkerP = {
    frontDepth: 4, headClear: 3, bottomDepth: 2,
    grav: 0.05, maxFall: 0.2, upAccel: -0.05, maxUp: -0.4,
    headScan: false,
    maxH: 0.5, accelH: 0.1, maxV: 0.5, accelV: 0.02,
  };
  const tgt = dd2Target(game, e, player);
  const txc = tgt ? tgt.x : e.cx, tyc = tgt ? tgt.y : e.cy;
  // ---- 出生渐显（:66478-66508 localAI[3]） ----
  if (x[3] === 0) e.spawnAlpha = 255;
  if (x[3] === 30) game.playSfxFiles(soundTrackFiles('dd2_etherian_portal_spawn_enemy'), 0.4, e.cx, e.cy);
  if (x[3] < 60) {
    x[3] += 1;
    e.spawnAlpha = Math.max(0, e.spawnAlpha - 5);
    e.alphaFade = false;
    if (Math.random() < 0.2) {
      game.spawnParticles(e.cx, e.cy, '#B080FF', 1, 0.6, { life: 30 });
    }
  }
  e.visAngle = e.vx * 0.04;                        // rotation = vx*0.04（:66415）
  let castDamp = 0;
  if (e.ai0 < 0) e.ai0 = Math.min(e.ai0 + 1, 0);   // 招间冷却（:66421-66423）
  if (e.ai0 > 0) {
    castDamp = 0.9;                                 // num12=0.9 施法僵直（:66427）
    e.ai0 -= 1;                                     // 注：109 是递减（102 递增）
    // 召骷髅施法音（:66445）：ai[0]==80 且 ai[1]==2 → DD2_DarkMageSummonSkeleton
    if (e.ai1 === 2 && e.ai0 === 80) {
      game.playSfxFiles(soundTrackFiles('dd2_dark_mage_summon_skeleton'), 0.7, e.cx, e.cy);
    }
    // 召骷髅（:66431-66435）：ai[1]==2 且 ai[0]==64 → 673 阵眼 + RaiseGoblins
    if (e.ai1 === 2 && e.ai0 === 64) {
      DD2_EVENT_HOOKS.raiseGoblins?.(game, e.cx, e.cy);
      game.spawnParticles(e.cx + e.facing * 24, e.cy - 40, '#C060FF', 10, 2, { life: 40 });
      // 673 阵眼在原版弹幕 ai[0]==70 帧播音（Projectile.cs:35516 DD2_SkeletonSummoned），
      // 本仓 673 降级为粒子 → 等效落在阵眼生成帧
      game.playSfxFiles(['dd2_skeleton_summoned'], 0.7, e.cx, e.cy);
    }
    // 暗影矢（:66453-66460）：ai[1]==0 且 ai[0]==32 → 675（14 速 40 伤）。
    // 弹道按【出手前】缓存的 targetData（施法期不重定向,:66416 GetTargetData 一次取值）;
    // 炮口 = Center+(direction*10,-16),direction 先按弹向翻转、**再**以新向取炮口
    // （:66455-66459 原序：vector 先算,facing 后翻,NewProjectile 用翻后 direction）
    if (e.ai1 === 0 && e.ai0 === 32) {
      const aim = mageCastAim.get(e) ?? { x: txc, y: tyc };
      const ox0 = e.cx + e.facing * 10, oy0 = e.cy - 16;
      const d = dirTo2(ox0, oy0, aim.x, aim.y);
      e.facing = d.x > 0 ? 1 : -1;
      const ox = e.cx + e.facing * 10;
      shootD(game, ox, oy0, d.x * 14, d.y * 14, 40, 675, 300);
    }
    // 治疗施法音（:66461）：ai[0]==126 且 ai[1]==1 → DD2_DarkMageCastHeal（起手一拍）
    if (e.ai1 === 1 && e.ai0 === 126) {
      game.playSfxFiles(soundTrackFiles('dd2_dark_mage_cast_heal'), 0.7, e.cx, e.cy);
    }
    // 治疗（:66453-66461）：ai[1]==1 且 ai[0]=40/48/56 → direction×240 下探 50 格找
    // 实心面（Searches.Down(50)+IsSolid,含起点格——expandVertically 同式）;找到 →
    // 生成 674 落地脉动（ToWorldCoordinates(8,0) = (tx*16+8, ty*16)）;找不到
    //（NOT_FOUND）→ 本拍不出弹（原版 WorldUtils.Find 失败直接跳过 NewProjectile）。
    // 脉动自身再数 40 AI 步才结算疗程（DD2HealPulse = Projectile.cs:35540-35574）：
    // 三连拍三枚脉动各自独立计时,落地音/治疗圆心均在脉动处（非魔法师位置）,
    // 且魔法师死亡不影响已出脉动（原版弹幕独立存活语义）。
    if (e.ai1 === 1 && (e.ai0 === 40 || e.ai0 === 48 || e.ai0 === 56)) {
      const gx = Math.floor((e.cx + e.facing * 240) / TILE);
      const gy = Math.floor(e.cy / TILE);
      const [, bottom] = expandVertically(game, gx, gy, 0, 50);
      if (solidAt(game, gx, bottom)) {
        (game as unknown as { entities: { add: (en: unknown, b: string) => void } }).entities.add(
          new DD2HealPulse(gx * TILE + 8, bottom * TILE), 'projectiles');
      }
    }
    if (e.ai0 <= 0) {
      // 招式轮换（:66463-66474）：0→1→2→0;非 0 招后冷却 -120,0 招后 -20
      const prev = e.ai1;
      e.ai1 += 1;
      if (e.ai1 >= 3) e.ai1 = 0;
      e.ai0 = prev === 0 ? -20 : -120;
    }
  }
  // ---- 招式选择（1458 :66651-66684,ai[0]==0 且出生 60t 后） ----
  if (e.ai0 === 0 && x[3] >= 60) {
    // ★R23b-G1 修：曾 `let next = 0` 硬编码——把 ai[1] 的轮换值整个丢弃，next 永
    // ∈{0,2} → ai[1]==1（治疗 127/40/48/56 三连出 674 幽灵）成死内容，战斗中
    // （受伤友军≥2 常态）每招退化为暗影矢。原版仅「±600×±200 内受伤友军<2」才
    // 覆盖 ai[1]=2（:66654-66656），否则沿施法后推进的轮换值（0 矢→1 治疗→2 骷髅）
    // 自然出招。
    let next = e.ai1;
    // ±600×±200 内受伤友军 <2 → 强制召骷髅（1458 :66653-66656）——原版扫 Main.npc
    // 全体（城镇 NPC 受伤同样触发召骷髅），本仓补 entities.npcs（R6-B 5-10）
    let hurt = 0;
    for (const n of game.enemies() as Enemy[]) {
      if (n.dead || n.hp >= n.maxHp) continue;
      if (Math.abs(n.cx - e.cx) <= 600 && Math.abs(n.cy - e.cy) <= 200) hurt++;
    }
    const townNpcs = (game as unknown as { entities?: { npcs?: Array<{ dead: boolean; hp: number; maxHp: number; cx: number; cy: number }> } }).entities?.npcs;
    if (townNpcs) {
      for (const n of townNpcs) {
        if (n.dead || n.hp >= n.maxHp) continue;
        if (Math.abs(n.cx - e.cx) <= 600 && Math.abs(n.cy - e.cy) <= 200) hurt++;
      }
    }
    if (hurt < 2) next = 2;
    if (next === 2 && !DD2_EVENT_HOOKS.canRaiseGoblinsHere(game, e.cx, e.cy)) next = 0;
    let ok = true;                                   // flag9（:66494-66498）
    if (next === 0
      && (Math.hypot(txc - e.cx, tyc - e.cy) >= 1000
        || !losClear(game, e.cx, e.cy, txc, tyc))) ok = false;
    if (ok) {
      e.ai1 = next;
      e.ai0 = next === 0 ? 97 : next === 1 ? 127 : 183;   // :66500-66510
      // 施法锁向（:66416 targetData 起手快照,全程不重定向——水晶↔玩家不换靶）
      mageCastAim.set(e, { x: txc, y: tyc });
    }
  }
  walkerKernel(e, game, tgt ? { cx: txc, cy: tyc, dead: false } as unknown as Player : null, x, p, castDamp);
}

// ---------------------------------------------------------------------------
// 686 双足翼龙空袭火球（ProjectileID.cs:1724；SetDefaults :7307-7315：30×30
// aiStyle1/hostile/penetrate -1/alpha255）——★台账⑧(2026-08-31)回归,曾走 Arrow
// 单盒单测命中：
// · 运动 = AI_001 两段式（1458 P.cs:58513-58529 / 1456 :54640-54659）：vx*=0.99 每
//   update 恒定；ai[0]>=10 起 vy+=0.1、>=20 再 +0.1（合计 0.2/t），计数钳 20、vy 上限 32。
// · 命中 = Colliding oldPos 全轨迹扫掠（:16156-16172；TrailCacheLength[686]=20,
//   ProjectileID.cs:387）——当前盒 + 移动前逐 tick 尾迹盒任一相交皆可伤，高速掠射
//   不再漏检身后走廊（原版玩家体感"Betsy 火球判定极肥"即此尾迹面）。
// · 伤害走 Damage_EVP（General 槽——686 不在 BossNoCheese 分槽表）难度乘区×2；
//   实扣>0 才授 StatusPlayer debuff 链。
// · ★BJ454 水晶面：hostile 弹经 Damage_PVE_Inner flag2 门伤 friendly 水晶 548
//   （:12626-12632;immune[255]=10 免疫窗 :14182,尾迹扫掠同生效）——681/683 同族
//   先例,BJ450 548 收端联动（演出期旗置位照拒）。
// · Kill 视觉(:74101-74126 oldPos 环 d6/55/158)与飞行尘(:57485-57512)粒子近似承担。
// 联机：不带 netProjMeta——快照链按 projId 桶落 kind1(tag='686')傀儡重建为 Arrow
// 直飞档（两段重力经 projGravSpec 保持；oldPos 扫掠仅在权威端实装，登记）。
export class DD2BetsyFireball extends Entity {
  readonly projId = 686;
  w = 30;
  h = 30;
  dead = false;
  /** NewProjectile 伤害参数（DMG_FIREBALL=35 经典；公共字段名对齐 dd2 弹族
   *  DD2GoblinBomb.damage——bossAI-dd2.test.ts 的 projectiles 桶断言面） */
  readonly damage: number;
  /** timeLeft 默认 3600（SetDefaults 未覆写；实际由撞块终结） */
  private life = 3600;
  private t = 0;                                    // ai[0]（flag3 表：686 每拍自增）
  /** 移动前位置尾迹盒（unshift 头插,length 钳 20=TrailCacheLength[686]） */
  private trail: Array<{ x: number; y: number }> = [];

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1;溅花
  //  尘/音由共享体 wetSplashStepShared 承载,本类不自写）----
  //  豁免核对：686 DD2BetsyFireball SetDefaults P.cs:7307-7316（30×30/aiStyle 1/
  //  alpha 255/penetrate −1/friendly=false/hostile=true）【无】ignoreWater 行 →
  //  受段（数据面 PROJ_IGNORE_WATER 亦无 686）。686 ∉ IsDestroyedByWater 六型、
  //  非 2/34/80/155 → 各特支钩缺省。
  //  阻尼适用：tileCollide 缺省 true（无覆写行）→ HandleMovement 湿支
  //  :17721-17764 跑（wetVelocity = velocity×档,UpdatePosition :20557 消费）;
  //  aiStyle 1 不在 UpdatePosition 早退表（:20551）。速度场（vx/vy——含 AI 重力
  //  加算）不减,只削当拍位移（干态档=1 数值恒等）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍同位测值） */
  presetDone = false;

  constructor(game: GameHooks, x: number, y: number, vx: number, vy: number, dmg: number) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.vx = vx;
    this.vy = vy;
    this.damage = dmg;
    // 出膛音（AI_001 type686 支 localAI[0]==0 首帧 PlayTrackedSound,Projectile.cs
    // :57487-57490;shootD 时代同源承接）
    const shot = PROJ_SHOT_SFX[686];
    if (shot) game.playSfxFiles(soundTrackFiles(shot), 0.8, this.cx, this.cy);
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (--this.life <= 0) { this.dead = true; return; }
    // 尾迹记录先于运动（原版 oldPos 存【移动前】快照,Colliding 全数组回看）
    this.trail.unshift({ x: this.x, y: this.y });
    if (this.trail.length > 20) this.trail.length = 20;
    // ---- AI_001 两段式重力 + 恒定 X 衰减 + vy 上限 32 ----
    this.t++;
    const tA = Math.min(this.t, 20);               // ai[0]>20 → 钳 20(:58521-58523)
    if (tA >= 10) this.vy += 0.1;                  // :58514-58516
    if (tA >= 20) this.vy += 0.1;                  // :58517-58519（两段并存=0.2/t）
    this.vx *= 0.99;                               // :58524
    if (this.vy > 32) this.vy = 32;                // :58525-58527
    // 飞行尘近似（:57495-58497 新尘 d55 ×1/4 + trail 旧位 ×1/3 择一采样降频）
    if (Math.random() < 0.25) game.spawnParticles?.(this.cx, this.cy, '#D08840', 1, 1.2, { life: 22 });
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_001（重力/衰减完）→ 本段 → HandleMovement（阻尼在下方
    // 位移行）。溅花尘/音由共享体 wetSplashStepShared 承载,本类不自写。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      686, !!projectileData(686)?.ignoreWater);
    // ---- 位移 + tileCollide 撞块即亡（aiStyle1 缺省档,方形直检同 Arrow 精神）----
    // 水中位移阻尼（HandleMovement :17721-17764 + UpdatePosition :20557-20562）
    // ——速度场（vx/vy）不减只削当拍位移,干态档=1 恒等
    const df686 = projWaterDragFactor(this);
    const nx = this.x + this.vx * df686, ny = this.y + this.vy * df686;
    if (this.hitsSolid(game, nx, ny)) { this.killNow(game); return; }
    this.x = nx;
    this.y = ny;
    const stx = Math.floor(this.cx / TILE), sty = Math.floor(this.cy / TILE);
    if (!game.world.store.inBounds(stx, sty)) { this.dead = true; return; }
    // ---- ★BJ454 永恒水晶 548 命中面（Damage_PVE_Inner Projectile.cs:12626-12632
    //      1:1）：hostile 弹伤 friendly NPC 门 = flag2（targetNPC.friendly ∧
    //      !dontTakeDamageFromHostiles——演出期/血尽转换窗旗置位照拒,BJ450 链）；
    //      非 friendly NPC（敌怪）不吃敌对弹（hostile & flag2 恒假）。
    //      Colliding 尾迹扫掠（:16156-16172）对水晶同样生效 → 当前盒∪尾迹盒。
    //      命中后 immune[255]=10（:14180-14183 owner=255 槽,penetrate=-1 不减不
    //      Kill=火球穿过续飞）——与 NPC 互殴通道共用 immune[255] 槽（原版同槽）。
    //      伤害 = Main.DamageVar(damage)（ownedBySomeone=false 无 luck 面）直用
    //      damage;kb=num5=knockBack 缺省而 548 knockBackResist=0 → 0 等价
    //      （681/683 水晶面同式）。玩家不在/已亡不早退水晶面（原版两通道独立）----
    for (const n of game.enemies() as Enemy[]) {
      if (n.dead || n.vanillaId !== 548 || n.dontTakeDamageFromHostiles) continue;
      if (n.npcImmune255 > 0) continue;              // immune[255] 窗内拒再吃
      let cHit = projTargetsOverlap(this.x, this.y, this.w, this.h, n);
      for (const tr of this.trail) {
        if ((tr.x !== 0 || tr.y !== 0) && projTargetsOverlap(tr.x, tr.y, this.w, this.h, n)) { cHit = true; break; }
      }
      if (!cHit) continue;
      n.hurt(this.damage, 0, 0, game);
      n.npcImmune255 = 10;                            // :14182 immune[255]=10
    }
    // ---- Damage_EVP 命中面（player 盒 vs 当前盒∪尾迹盒;General 免疫帧内部去重）----
    // ★victim-settles：恒本地玩家（damagePlayer 只结算本地血）
    const p = game.player as { x: number; y: number; w: number; h: number; dead?: boolean } | null;
    if (!p || p.dead) return;
    let hit = projTargetsOverlap(this.x, this.y, this.w, this.h, p);
    for (const tr of this.trail) {
      if ((tr.x !== 0 || tr.y !== 0) && projTargetsOverlap(tr.x, tr.y, this.w, this.h, p)) { hit = true; break; }
    }
    if (hit) {
      // 弹幕命中：attacker 缺省仅做死亡归因（contactOnly=false 不触发荆棘反伤）
      const dealt = game.damagePlayer(
        hostileProjectileDamage(this.damage, mainDifficulty(game.world)) * 2,   // :14912-14917
        this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: 686 });   // ★R-B-F10(第4=knockback 位,opts 第5)
      if (dealt > 0) statusPlayer(game, 686);        // 实扣落地才走 statusPlayer 链
    }
  }

  /** tileCollide 探测：目标位弹盒覆盖格任一实心即真 */
  private hitsSolid(game: GameHooks, nx: number, ny: number): boolean {
    const st = game.world.store;
    const x0 = Math.floor(nx / TILE), x1 = Math.floor((nx + this.w - 0.001) / TILE);
    const y0 = Math.floor(ny / TILE), y1 = Math.floor((ny + this.h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  /** 撞块消亡（tileCollide kill）——烟尘 + 音效缺失面登记为 C 近似 */
  private killNow(game: GameHooks): void {
    this.dead = true;
    game.onProjectileDeath?.(686, this.x, this.y, this.w, this.h);
    game.spawnParticles?.(this.cx, this.cy, '#806040', 6, 2.2, { life: 26 });
  }

  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projSprite(686);
    ctx.save();
    if (img && img.width > 0) {
      // 贴图朝上、旋转 = velocity.ToRotation() + π/2（AI_001 rotation 链 :58641-58644）
      ctx.translate(this.cx, this.cy);
      ctx.rotate(Math.atan2(this.vy, this.vx) + Math.PI / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
    } else {
      ctx.fillStyle = '#FF9A3C';
      ctx.beginPath();
      ctx.arc(this.cx, this.cy, this.w / 2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** AABB 相交（projTargets.projOverlap 同式的本地投影,避免导出面依赖反转） */
function projTargetsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;
}

// ---------------------------------------------------------------------------
// Projectile 687 DD2BetsyFlameBreath（SetDefaults :7036-7045：30×30 aiStyle 136 /
// penetrate −1 / hostile / alpha 255；AI_136 :65843-65914）
// ---------------------------------------------------------------------------
/** Betsy 喷焰——锚定嘴部的持续 78t 火舌（原版非自由飞弹）：
 *  - 焰心 = 主心 + (102·spriteDir, 30).RotatedBy(主 rotation)（:65848-65851，
 *    num=−8 → 110−8=102）；指向 = 主→焰心向量角（DirectionTo）——每帧跟随嘴部。
 *  - 寿命：ai[0] 逐 t +1，≥78 Kill（:65911-65914）。
 *  - 判定（Colliding :14712-14733）：线段 焰心+dir·400·num3 → 焰心+dir·400·num2，
 *    num2 = min(t/25,1)（焰头 25t 推满）、num3 = clamp((t−38)/40)（焰尾 38-78t
 *    追上），线宽 40——命中走 Damage_EVP，OnFire 420-600t 由 statusPlayer 687 表授予。
 *  - 绘制 = Main.cs:31287-31319 十五层火舌（98×686 七帧行 + seed=1 定数 LCG 抖动角，
 *    alpha 渐层白→红(180,30,30,200)→暗(0,0,0,30)，色乘近似为 alpha 档）。 */
// ---- 火舌乘色烘焙(帧子矩形 multiply+destination-in;色键量化 8,上限护栏,
//      半载窗拒烘不缓存——天体渲染双修/平色毒缓存教训同源) ----
const betsyTintCache = new Map<string, HTMLCanvasElement>();

function betsyTint(
  img: CanvasImageSource | null | undefined,
  sx: number, sy: number, sw: number, sh: number,
  rgb: readonly [number, number, number],
): HTMLCanvasElement | null {
  if (!img || typeof document === 'undefined') return null;
  const iw = (img as { width?: number }).width ?? 0;
  const ih = (img as { height?: number }).height ?? 0;
  if (!(iw > 0) || !(ih > 0)) return null;
  const w = Math.max(1, Math.ceil(sw)), h = Math.max(1, Math.ceil(sh));
  const q = (v: number) => Math.round(v) & ~7;
  const key = `b687|${sx},${sy},${sw},${sh}|${q(rgb[0])},${q(rgb[1])},${q(rgb[2])}`;
  const hit = betsyTintCache.get(key);
  if (hit) return hit;
  if (betsyTintCache.size > 512) { const k0 = betsyTintCache.keys().next().value; if (k0 !== undefined) betsyTintCache.delete(k0); }   // ★逐条淘汰最旧(勿整表clear=重分配雪崩,2026-09-07 canvas哨兵案)
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  cx.globalCompositeOperation = 'multiply';
  cx.fillStyle = `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
  cx.fillRect(0, 0, w, h);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  cx.globalCompositeOperation = 'source-over';
  betsyTintCache.set(key, c);
  return c;
}

export class BetsyBreath extends Entity {
  w = 30;
  h = 30;
  /** 锚定 Betsy（ai[1]=whoAmI 语义 → 本地 id 引用） */
  private srcId: number;
  /** ai[0]（:65911 ≥78 Kill） */
  private t = 0;
  /** frameCounter（绘制推进分母 :65898） */
  private frameT = 0;
  dmg: number;   // public:测试/联机快照断言喷焰伤害档
  /** 焰心指向角（主→焰心向量角） */
  private ang = 0;
  /** 主死亡后的冻结锚（原版 npc 槽位数据残留——焰心停驻直到 78t 走完） */
  private anchor: { x: number; y: number } | null = null;
  dead = false;
  /** ★BJ294 敌射侧拒割位：687 BetsyFlameBreath SetDefaults friendly=false+hostile
   *  （P.cs:7324）→ 原版 CutTiles 调用点 friendly 门（:12515）整支不进。
   *  详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1;溅花
  //  尘/音由共享体 wetSplashStepShared 承载,本类不自写）----
  //  豁免核对：687 DD2BetsyFlameBreath SetDefaults P.cs:7317-7326（30×30/aiStyle 136/
  //  alpha 255/penetrate −1/friendly=false/hostile=true）【无】ignoreWater 行 →
  //  受段（数据面 PROJ_IGNORE_WATER 亦无 687）。687 ∉ IsDestroyedByWater 六型、
  //  非 2/34/80/155 → 各特支钩缺省。
  //  阻尼不适用（原版形态锚）：AI_136 每 tick 直写 position（焰心 = 主心 + 嘴部
  //  偏移 RotBy(rotation),:65848-65851 同式）,velocity 不积分（aiStyle 136 不在
  //  UpdatePosition 早退表 :20551,但本类无 velocity 位移宿主可乘）;湿段只承载
  //  溅花/湿旗面。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(src: Enemy, dmg: number) {
    super();
    this.srcId = src.id;
    this.dmg = dmg;
    this.x = src.cx - this.w / 2;
    this.y = src.cy - this.h / 2;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    const src = (game.enemies() as Enemy[]).find((n) => n.id === this.srcId);
    // 锚点：嘴部 = 主心 + (102·spriteDir,30).RotatedBy(rotation)（visAngle≈npc.rotation）
    let mx: number, my: number;
    if (src && !src.dead) {
      const spr = src.facing >= 0 ? 1 : -1;                  // spriteDirection
      const rot = src.visAngle || 0;
      const ox = 102 * spr, oy = 30;
      const c = Math.cos(rot), s = Math.sin(rot);
      mx = src.cx + ox * c - oy * s;
      my = src.cy + ox * s + oy * c;
      this.anchor = { x: mx, y: my };
      // 指向 = 主→焰心向量（:65852 DirectionTo(base.Center)）
      this.ang = Math.atan2(my - src.cy, mx - src.cx);
    } else if (this.anchor) {
      mx = this.anchor.x;
      my = this.anchor.y;
    } else {
      this.dead = true;
      return;
    }
    this.x = mx - this.w / 2;
    this.y = my - this.h / 2;
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_136（锚定写位）→ 本段 → HandleMovement（无位移面）。
    // 测位 = 本拍锚定位（段后位置不再变,与 post-AI 同位）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      687, !!projectileData(687)?.ignoreWater);
    this.t++;
    if (this.t >= 78) { this.dead = true; return; }          // :65911-65914
    this.frameT++;
    // 判定线段（:14712-14733）：焰尾→焰头，宽 40（687 覆写 Colliding 为线段判定，
    // 非 30×30 弹体盒——伤害走 MLDeathray 同款直连 damagePlayer，iframes 门手写）
    // ★victim-settles：命中/灼烧恒查本地玩家（damagePlayer/statusPlayer 只结算
    // 本地——Projectile.Damage 逐玩家结算的本地半边）——非索敌残留,勿改 targetRef
    const headF = Math.min(1, this.t / 25);
    const tailF = Math.max(0, (this.t - 38) / 40);
    const dx = Math.cos(this.ang), dy = Math.sin(this.ang);
    const segLen = 400 * (headF - tailF);
    const p = game.player as { x: number; y: number; w: number; h: number; dead: boolean; iframes?: number } | null;
    if (segLen > 1 && p && !p.dead && (p.iframes ?? 0) <= 0
      && segHitsRect(this.cx + dx * 400 * tailF, this.cy + dy * 400 * tailF,
        dx * segLen, dy * segLen, 40, p)) {
      // Damage_EVP：命中不消耗弹体；OnFire 420-600t（:11515-11517 statusPlayer 687 表）
      // Damage_EVP：687 基础 35（:62449 段生成值）
      game.damagePlayer(hostileProjectileDamage(this.dmg, mainDifficulty(game.world)) * 2, this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: 687 });   // ★R-B-F10(第4=knockback 位,opts 第5)(2026-10-14):弹域双旗点亮(Game.ts damagePlayer :44480 门=projDomain&&projVid;★BJ704-R3 P1:旧单旗=静默 no-op)
      statusPlayer(game, 687);
    }
    // 尘（:65874-65896）：渐显期焰头 3 尘 6 + 每 t 焰体 1 尘 31（沿焰体随机分布）
    if (tailF === 0 && headF > 0.1) {
      const hx = this.cx + dx * 400 * headF, hy = this.cy + dy * 400 * headF;
      game.spawnBurst?.(hx, hy, '#FF9030', 3, 3, this.ang, Math.PI / 12, { life: 22 });
    }
    {
      const f = Math.random();
      const fx = this.cx + dx * 400 * (tailF + (headF - tailF) * f);
      const fy = this.cy + dy * 400 * (tailF + (headF - tailF) * f);
      game.spawnParticles(fx, fy, '#FFC060', 1, 0.6, { life: 18 });
    }
  }

  /** 十五层火舌逐式直译(Main.cs 1458 :32080-32116 终清波):
   *  · 可见窗修正——原版 DRAW 条件=¬(v>frac∧fc<40)∧¬(v<frac∧fc≥40)(前置段
   *    [0..frac] 先现、尾段随 fc≥40 只画前缘);旧实现恰反相(hue 白画近似退役时未及),
   *    本批按原文取反。
   *  · 色层四通道全真值(:32104-32105 三锚点 Transparent/(255,255,255,0)/(180,30,30,
   *    200)/(0,0,0,30) 四段线性);XNA 预乘管线 AlphaBlend(One,InvSrcAlpha) 双半边
   *    = canvas 两步:destination-out(mask=texα×Cα 背景遮蔽)+lighter(tinted 加色,
   *    rgb=C.rgb 乘)——白层 A=0 自动退化纯加性,"色乘以 alpha 档近似"退役。
   *  · 其余公式(±0.125 rad 定数 LCG 抖动、SmoothStep 位置、(0.9+0.8v)²·0.8 缩放、
   *    GlobalTimeWrappedHourly 旋转、Frame(1,7,(int)(v·7)))已对齐维持。 */
  draw(r: Renderer, _cam: Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const sheet = projSprite(687);
    if (!sheet || !(sheet as HTMLImageElement).complete || sheet.width === 0) return;
    const fw = sheet.width, fh = sheet.height / 7;
    // seed=1 定数 LCG（Utils.RandomFloat(ref seed)：s=(s·25214903917+11) mod 2^48，
    // 取高 24 位）——每帧层布局稳定（原版火舌不闪烁换位）
    let seed: number = 1;
    const num240 = 40, num241 = 80;
    const num229 = this.frameT / num240;                      // num242：焰面前沿（0..~1.95）
    const frac = num229 % 1;
    const gt = globalTimeWrappedHourly();                     // GlobalTimeWrappedHourly(:17014)——★BJ330 GTW 单源（原 performance.now 墙钟）
    for (let layer = 0; layer < 15; layer++) {
      seed = (seed * 25214903917 + 11) % 281474976710656;
      const rfSeed = Math.floor(seed / 16777216) / 16777216;
      const jitter = rfSeed * 0.25 - 0.125;                   // ±0.125 rad
      const la = this.ang + jitter;
      const tipX = this.cx + Math.cos(la) * 400;
      const tipY = this.cy + Math.sin(la) * 400;
      let v = num229 + layer * (1 / 15);
      const seg = Math.floor(v / (1 / 15));
      v %= 1;
      // 可见窗(:32101 —— ¬(v>frac∧fc<40) ∧ ¬(v<frac∧fc≥40))
      if ((v > frac && this.frameT < num240)
        || (v < frac && this.frameT >= num241 - num240)) continue;
      // 色层四通道(:32104-32106 五段链)
      let rgb: [number, number, number];
      let ca: number;
      if (v < 0.1) {                                          // Transparent → White(A 恒 0)
        const t = clamp(v / 0.1, 0, 1);
        rgb = [255 * t, 255 * t, 255 * t]; ca = 0;
      } else if (v < 0.35) {                                  // color66=(255,255,255,0)
        rgb = [255, 255, 255]; ca = 0;
      } else if (v < 0.7) {                                   // → color67=(180,30,30,200)
        const t = clamp((v - 0.35) / 0.35, 0, 1);
        rgb = [255 + (180 - 255) * t, 255 + (30 - 255) * t, 255 + (30 - 255) * t];
        ca = 200 * t;
      } else if (v < 0.9) {                                   // → color68=(0,0,0,30)
        const t = clamp((v - 0.7) / 0.2, 0, 1);
        rgb = [180 * (1 - t), 30 * (1 - t), 30 * (1 - t)];
        ca = 200 + (30 - 200) * t;
      } else {                                                // → Transparent(渐隐)
        const t = clamp((v - 0.9) / 0.1, 0, 1);
        rgb = [0, 0, 0];
        ca = 30 * (1 - t);
      }
      // 缩放（:32107-32109）: (0.9+v·0.8)²×0.8
      let sc2 = 0.9 + v * 0.8;
      sc2 = sc2 * sc2 * 0.8;
      // 位置 = SmoothStep(center, tip, v)
      const sm = v * v * (3 - 2 * v);
      const px = this.cx + (tipX - this.cx) * sm;
      const py = this.cy + (tipY - this.cy) * sm;
      const frame = Math.min(6, Math.floor(v * 7));           // Frame(1,7,0,(int)(v·7))
      const rot = this.ang + TAU * (v + gt * 1.2) * 0.2 + seg * TAU / 5;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.imageSmoothingEnabled = false;
      const sxr = 0, syr = Math.round(frame * fh), sfw = fw, sfh = Math.round(fh);
      const dw = fw * sc2, dh = sfh * sc2;
      // ① 遮蔽半边:OutWeight = texα·Cα(Ca=0 → 无遮蔽,纯加性直落 ②)
      if (ca > 0) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = ca / 255;
        ctx.drawImage(sheet, sxr, syr, sfw, sfh, -dw / 2, -dh / 2, dw, dh);
      }
      // ② 加色半边:tex.rgb×C.rgb(lighter;烘焙 multiply+destination-in 保形)
      if (rgb[0] > 0 || rgb[1] > 0 || rgb[2] > 0) {
        const tinted = betsyTint(sheet, sxr, syr, sfw, sfh, rgb);
        if (tinted) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 1;
          ctx.drawImage(tinted, -dw / 2, -dh / 2, dw, dh);
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ---------------------------------------------------------------------------
// AI_110 双足翼龙 Betsy 551（NPC.cs:43165 → AI_110_Betsy :62266）
// ---------------------------------------------------------------------------
export function betsyAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; }
  const x = dd2LocalAI(e);
  e.despawnTimer = 750;   // netAlways：不入 CheckActive 消退
  // 常量（:62277-62318）
  const DMG_BREATH = 35, DMG_FIREBALL = 35;
  const INTRO_T = 10, FLY_ACC = 0.45, FLY_SPD = 7.5;
  const HOVER_T = 30, WIND_T = 30, DIVE_SPD = 23;
  const FLAME_OFF = 600, FLAME_APPR = 12, FLAME_T0 = 40, FLAME_T1 = 80;
  // num18=13 空袭接位 / num19=12 俯冲突进(★R23b-D8:两段曾共用 12=接位慢 1/t)
  const BOMB_OFF = 1500, BOMB_APR_T = 60, BOMB_ACC = 1 / 30, BOMB_SPD = 12, POSN_SPD = 13;
  const FIREBALL_EVERY = 10, FIREBALL_N = 6 * FIREBALL_EVERY, TAIL_T = 60;
  const BOMB_TOTAL = BOMB_APR_T + FIREBALL_N + TAIL_T;
  const SPIN_T = 60, SPIN_RATE = TAU / SPIN_T, SPIN_RISE = 0.1, SKYDIVE_SPD = 32;
  const SUMMON_T = 90, SUMMON_AT = 20;
  // ---- 索敌（:62276 NPCUtils.TargetClosestBetsy）：水晶/玩家近者胜,无 200px 门 ----
  const tgt = dd2Target(game, e, player, true);
  if (!tgt) {
    e.vy -= 0.05;
    fly(e);
    return;
  }
  const txc = tgt.x, tyc = tgt.y;
  let timeScale = 1;   // num2：各态动画步进倍率
  if (e.ai0 === 0) {
    // ---- 入场（:62321-62330） ----
    e.ai1 += 1;
    if (e.ai1 >= INTRO_T) { e.ai1 = 0; e.ai0 = 1; e.ai2 = 0; }
  } else if (e.ai0 === 1) {
    // ---- 悬停选招（:62332-62416） ----
    if (e.ai2 === 0) e.ai2 = e.cx < txc ? 1 : -1;
    const destX = txc - e.ai2 * 300, destY = tyc - 200;
    const d = dirTo(e, destX, destY);
    simpleFlyMove(e, d.x * FLY_SPD, d.y * FLY_SPD, FLY_ACC);
    e.facing = e.cx < txc ? 1 : -1;
    e.ai1 += 1;
    if (e.ai1 >= HOVER_T) {
      // ai[3]==5 且 1/3 概率 → 追加一轮（:62344-62347）
      if (e.ai3 === 5 && rnd(3) === 0) e.ai3 += 1;
      let next = 1;                                  // :62349-62370 八槽表
      const s = e.ai3 | 0;
      if (s === 0 || s === 1 || s === 3) next = 2;
      else if (s === 2) next = 3;
      else if (s === 4) next = 4;
      else if (s === 5) next = 5;
      else if (s === 6) next = 3;
      else if (s === 7) next = 6;
      e.ai0 = next;
      e.ai1 = 0; e.ai2 = 0;
      e.ai3 += 1;
      if (e.ai3 >= 8) e.ai3 = 0;
      if (next === 2 || next === 5) {
        // 直冲起手（:62373-62400）：朝目标 23/32 速,rotation 对准
        const v = dirTo(e, txc, tyc);
        e.facing = v.x > 0 ? 1 : -1;
        e.visAngle = Math.atan2(v.y, v.x) + (e.facing === -1 ? Math.PI : 0);
        e.vx = v.x * (next === 2 ? DIVE_SPD : SKYDIVE_SPD);
        e.vy = v.y * (next === 2 ? DIVE_SPD : SKYDIVE_SPD);
      } else if (next === 3) {
        // 火焰吐息起手（:62402-62408）：反向 2 速退位
        const d3 = txc > e.cx ? 1 : -1;
        e.facing = d3;
        e.vx = -2 * d3;
        e.vy = 0;
      }
    }
  } else if (e.ai0 === 2) {
    // ---- 风压冲（:62418-62427） ----
    if (e.ai1 === 0) game.playSfxFiles(soundTrackFiles('dd2_betsy_wind_attack'), 0.7, e.cx, e.cy); // DD2_BetsyWindAttack（:62415）
    e.ai1 += 1;
    if (e.ai1 >= WIND_T) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; }
  } else if (e.ai0 === 3) {
    // ---- 火焰吐息（:62429-62487） ----
    e.ai1 += 1;
    e.ai2 = e.cx < txc ? 1 : -1;
    if (e.ai1 < FLAME_T0) {
      // 接位：目标反向 600px 上空（:62435-62447）
      const dx = txc - e.ai2 * FLAME_OFF, dy = tyc - 250;
      const d = dirTo(e, dx, dy);
      if (Math.hypot(dx - e.cx, dy - e.cy) < FLAME_APPR) {
        e.x = dx - e.w / 2; e.y = dy - e.h / 2;   // 原版 base.Center = vector4 直接贴位
      } else {
        e.x += d.x * FLAME_APPR;
        e.y += d.y * FLAME_APPR;
      }
      if (Math.hypot(dx - e.cx, dy - e.cy) < 16) e.ai1 = FLAME_T0 - 1;
      timeScale = 1.5;
    }
    if (e.ai1 === FLAME_T0) {
      // 喷焰起手（:62449-62461）：10 速横冲 + 687 喷焰——锚定嘴部的 78t 持续
      // 火舌（AI_136 :65843-65914，实体每帧跟随嘴部；曾当 30×30 自由飞弹近似）
      const d3 = txc > e.cx ? 1 : -1;
      e.vx = d3 * 10;
      e.vy = 0;
      e.facing = d3;
      (game as unknown as { entities: { add: (en: unknown, b: string) => void } }).entities.add(
        new BetsyBreath(e, DMG_BREATH), 'projectiles');
      game.playSfxFiles(['dd2_betsy_flame_breath'], 0.7, e.cx, e.cy);   // DD2_BetsyFlameBreath（:62462）
    }
    if (e.ai1 >= FLAME_T0) {
      timeScale = 1.5;
      if (Math.abs(txc - e.cx) > 550 && Math.abs(e.vx) < 20) {
        e.vx += sign(e.vx) * 0.5;                  // 远距提速（:62465-62469）
      }
    }
    if (e.ai1 >= FLAME_T0 + FLAME_T1) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; }
  } else if (e.ai0 === 4) {
    // ---- 空袭（:62489-62583） ----
    e.ai2 = e.cx < txc ? 1 : -1;
    if (e.ai1 < BOMB_APR_T) {
      // 高位接位（:62493-62509）：反向 1500px、-350 上空
      const dx = txc - e.ai2 * BOMB_OFF, dy = tyc - 350;
      const d = dirTo(e, dx, dy);
      // DirectionTo(vector6) * num18（:62504,num18=13）——接位段与突进段(num19=12)分速
      e.vx = lerp(e.vx, d.x * POSN_SPD, BOMB_ACC);
      e.vy = lerp(e.vy, d.y * POSN_SPD, BOMB_ACC);
      e.facing = e.cx < txc ? 1 : -1;
      if (Math.hypot(dx - e.cx, dy - e.cy) < 16) e.ai1 = BOMB_APR_T - 1;
      timeScale = 1.5;
    } else if (e.ai1 === BOMB_APR_T) {
      // 俯冲突进（:62511-62521）：12 速贴地掠射
      let v = dirTo(e, txc, tyc);
      v = { x: v.x, y: v.y * 0.25 };
      const vl = Math.hypot(v.x, v.y) || 1;
      v = { x: v.x / vl, y: v.y / vl };
      e.facing = v.x > 0 ? 1 : -1;
      e.visAngle = Math.atan2(v.y, v.x) + (e.facing === -1 ? Math.PI : 0);
      e.vx = v.x * BOMB_SPD;
      e.vy = v.y * BOMB_SPD;
    } else {
      // 掠射（:62523-62543）：水平 7/t、垂直 6/t 贴地,每 10t 投 686 火球 ×6
      const dTo = dirTo(e, txc, tyc);
      e.x += dTo.x * 7;
      e.y += dirTo(e, txc, tyc - 400).y * 6;
      if (e.ai1 <= BOMB_TOTAL - TAIL_T) timeScale = 1.5;
      const ox = (110 + 30) * e.facing, oy = 20;
      const rx = e.cx + ox * Math.cos(e.visAngle) - oy * Math.sin(e.visAngle);
      const ry = e.cy + ox * Math.sin(e.visAngle) + oy * Math.cos(e.visAngle);
      const n = Math.floor(e.ai1 - BOMB_APR_T + 1);
      if (n <= FIREBALL_N && n % FIREBALL_EVERY === 0) {
        // ★台账⑧(2026-08-31)：686 空袭火球改专用实体——NewProjectile 继承机速
        // （base.velocity 同源 :62551-62554）+ AI_001 两段式运动 + Colliding
        // oldPos 全轨迹扫掠命中（见 DD2BetsyFireball 头注）；曾走 Arrow 单盒
        // 单测命中=高速掠射漏检尾迹走廊
        (game as unknown as { entities: { add: (en: unknown, b: string) => void } })
          .entities.add(new DD2BetsyFireball(game, rx, ry, e.vx, e.vy, DMG_FIREBALL), 'projectiles');
      }
    }
    if (e.ai1 > BOMB_TOTAL - TAIL_T) e.vy -= 0.1;   // 尾段拉起（:62545-62547）
    e.ai1 += 1;
    if (e.ai1 >= BOMB_TOTAL) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; }
  } else if (e.ai0 === 5) {
    // ---- 翻转俯冲（:62585-62604） ----
    const rot = -SPIN_RATE * e.facing;
    const c = Math.cos(rot), s = Math.sin(rot);
    const nvx = e.vx * c - e.vy * s;
    const nvy = e.vx * s + e.vy * c;
    e.vx = nvx; e.vy = nvy;
    e.y -= SPIN_RISE;
    const d = dirTo(e, txc, tyc);
    e.x += d.x * 10;
    e.y += d.y * 10;
    e.visAngle -= SPIN_RATE * e.facing;
    timeScale *= 0.7;
    if (e.ai1 === 1) game.playSfxFiles(['dd2_betsy_flying_circle_attack'], 0.7, e.cx, e.cy); // DD2_BetsyFlyingCircleAttack（:62547）
    e.ai1 += 1;
    if (e.ai1 >= SPIN_T) {
      e.ai0 = 1; e.ai1 = 0; e.ai2 = 0;
      e.vx /= 2; e.vy /= 2;
    }
  } else if (e.ai0 === 6) {
    // ---- 召唤（:62606-62655） ----
    if (e.ai1 === 0) {
      // 贴水晶上空（:62608-62620）
      const d = dirTo(e, txc, tyc - 200);
      simpleFlyMove(e, d.x * FLY_SPD * 2, d.y * FLY_SPD * 2, FLY_ACC * 2);
      e.facing = e.cx < txc ? 1 : -1;
      e.ai2 += 1;
      if (Math.hypot(txc - e.cx, tyc - e.cy) < 350 || e.ai2 >= 180) e.ai1 = 1;
    } else {
      if (e.ai1 === 1) game.playSfxFiles(['dd2_betsy_scream'], 0.8, e.cx, e.cy);  // DD2_BetsyScream（:62577）
      if (e.ai1 < SUMMON_AT) { e.vx *= 0.95; e.vy *= 0.95; }
      else { e.vx *= 0.98; e.vy *= 0.98; }
      if (e.ai1 === SUMMON_AT) {
        if (e.vy > 0) e.vy /= 3;
        e.vy -= 3;                                   // 跃起（:62630-62634）
        game.spawnParticles(e.cx, e.cy + e.h / 2, '#C8A060', 26, 4, { life: 40 });
      }
      timeScale *= 0.85;
      // 召唤窗口（:62657-62696）：场上 560 ≤4 才召;自周 300px 环 + 传送门各出 560
      if (e.ai1 === SUMMON_AT || e.ai1 === 45 || e.ai1 === 70) {
        const wyverns = (game.enemies() as Enemy[])
          .filter((n) => !n.dead && n.vanillaId === 560).length;
        if (wyverns <= 4) {
          const a = Math.random() * TAU;
          const sx = e.cx + Math.cos(a) * 2 * 300 * (0.6 + Math.random() * 0.4);
          const sy = e.cy + Math.sin(a) * 1 * 300 * (0.6 + Math.random() * 0.4);
          if (Math.hypot(sx - txc, sy - tyc) > 100) {
            const w = spawnPart(game, e, 560);
            if (w) { w.x = sx - w.w / 2; w.y = sy - w.h / 2; }
          }
          const portals = (game.enemies() as Enemy[])
            .filter((n) => !n.dead && n.vanillaId === 549);
          for (let k = 0; k < 3 && portals.length > 0; k++) {
            const portal = portals[rnd(portals.length)];
            const w = spawnPart(game, e, 560);
            if (w) { w.x = portal.cx - w.w / 2; w.y = portal.cy - w.h / 2; }
          }
          game.playSfxFiles(soundTrackFiles('dd2_betsy_summon'), 0.7, e.cx, e.cy);  // DD2_BetsySummon（:62652/:62671 每召一只一声）
        }
      }
      e.ai1 += 1;
    }
    if (e.ai1 >= SUMMON_T) { e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; }
  }
  // ---- 拍翼帧计数（:62657-62666 localAI[0]/[1]） ----
  x[0] += timeScale;
  if (x[0] >= 36) x[0] = 0;
  x[1] += 1;
  if (x[1] >= 60) x[1] = 0;
  // ---- rotation 收敛（:62668-62716） ----
  const dTo = dirTo(e, txc, tyc);
  let tgtAng = Math.atan2(dTo.y, dTo.x);
  let step = 0.04;
  const s0 = e.ai0 | 0;
  if (s0 === 2 || s0 === 5) step = 0;
  else if (s0 === 3) {
    step = 0.01;
    tgtAng = e.facing === -1 ? -Math.PI : 0;
    if (e.ai1 >= FLAME_T0) { tgtAng += e.facing * Math.PI / 12; step = 0.05; }
  } else if (s0 === 4) {
    step = 0.01;
    tgtAng = e.facing === 1 ? Math.PI * 2 : Math.PI;
  } else if (s0 === 6) {
    step = 0.02;
    tgtAng = e.facing === -1 ? -Math.PI : 0;
  }
  if (e.facing === -1) tgtAng += Math.PI;
  if (step !== 0) e.visAngle = angleTowards(e.visAngle, tgtAng, step);
  fly(e);
}

// ---------------------------------------------------------------------------
// AI_111 埃特尼亚荧光虫 578（NPC.cs:43169 → AI_111_DD2LightningBug :66799）
// ---------------------------------------------------------------------------
export function dd2LightningBugAI(e: Enemy, game: GameHooks, player: Player | null) {
  if (!e.bInit) { e.bInit = true; }
  const x = dd2LocalAI(e);
  // 族参数（:66803-66813 默认档 → :66828-66844 的 578 覆盖）
  const SPEED = 4;            // num
  const LERP_FAR = 20;        // num2
  const LERP_NEAR = 20;       // num3
  const MIN_SPD = 1;          // num4
  const DAMP = 0.96;          // num5
  const SHOOT_T = 5;          // num6
  const COOLDOWN = 30;        // num7
  const RANGE = 200;          // num8
  const ZAP_DMG = 50;         // num9
  const ZAP_PROJ = 682;       // num10
  const ZAP_SPD = 10;         // num11
  const HEIGHT_GATE = 50;     // num12
  const SEP = 0.1;            // num13
  // ---- 出生渐显（:66846-66876 flag3,:67018-67054 消费）----
  if (x[1] === 0) e.spawnAlpha = 255;
  if (x[1] === 30) game.playSfxFiles(soundTrackFiles('dd2_etherian_portal_spawn_enemy'), 0.3, e.cx, e.cy);
  if (x[1] < 60) {
    x[1] += 1;
    e.spawnAlpha = Math.max(0, e.spawnAlpha - 5);
    e.alphaFade = false;
    // 出场烟(NPC.cs:67036-67053 精确式):num15=localAI[1]/10,i<num15 且 Next(5)==0
    // 才出一粒 NewDustDirect(整盒 27 号,vel.x=自身 vx、scale .55、fadeIn .7、v×0.1·num16
    // 后 += 自身速度;num16=Size.Length()/40;maxValue 门 5/578 不进 {576,577} 特例)
    const num15 = Math.floor(x[1] / 10);
    const num16 = Math.hypot(e.w, e.h) / 2 / 20;
    for (let i = 0; i < num15; i++) {
      if (Math.random() >= 1 / 5) continue;               // Next(5)==0
      const d = game.spawnDust?.(e.x, e.y, e.w, e.h, 27, e.vx * 1, 0, 100);
      if (!d) break;
      d.scale = 0.55;
      d.fadeIn = 0.7;
      d.vx *= 0.1 * num16;
      d.vy *= 0.1 * num16;
      d.vx += e.vx;
      d.vy += e.vy;
    }
  }
  // ---- 索敌（:66816 TargetClosestOldOnesInvasion） ----
  const tgt = dd2Target(game, e, player);
  // ---- 同族分离（:66878-66900 flag2,cs:66878-66900） ----
  for (const n of game.enemies() as Enemy[]) {
    if (n === e || n.dead || n.vanillaId !== e.vanillaId) continue;
    if (Math.abs(e.x - n.x) + Math.abs(e.y - n.y) < e.w) {
      if (e.x < n.x) e.vx -= SEP; else e.vx += SEP;
      if (e.y < n.y) e.vy -= SEP; else e.vy += SEP;
    }
  }
  e.visAngle = Math.abs(e.vx) * e.facing * 0.1;    // rotation（:66902）
  // ---- 电光尘双支(NPC.cs(1458):66985-67014 精确式,type==578 每 tick 恒掷)----
  // 支① Next(15)==0:NewDustDirect(半宽×整高盒,272,scale .65,vy−=.8;direction 同向
  //     的 vx 翻负 = 向身后甩、vy>0 → v×−0.5);direction==-1 时盒右移 halfW(贴咬口侧)
  if (Math.random() < 1 / 15) {
    const bx = e.facing === -1 ? e.x + e.w / 2 : e.x;
    const d = game.spawnDust?.(bx, e.y, e.w / 2, e.h, 272);
    if (d) {
      d.scale = 0.65;
      d.vy -= 0.8;
      if (d.vx * e.facing > 0) d.vx *= -1;
      if (d.vy > 0) { d.vx *= -0.5; d.vy *= -0.5; }
    }
  }
  // 支② Next(80)==0:Center 双粒 272/NewDustPerfect,速=随机单位向×{1.1,1.5}、
  //     noGravity(customData=自身 的 Player 跟随消费不适用 NPC 型,登记)——
  //     原"1/80 spawnParticles 两粒白点"近似退役 —— 终清波实装
  if (Math.random() < 1 / 80) {
    const ang = Math.random() * TAU;
    const ux2 = Math.cos(ang), uy2 = Math.sin(ang);
    const dA = game.spawnDust?.(e.cx, e.cy, 0, 0, 272, ux2 * 1.1, uy2 * 1.1, 0, null, 1, true, true);
    if (dA) dA.noGravity = true;
    const dB = game.spawnDust?.(e.cx, e.cy, 0, 0, 272, ux2 * 1.5, uy2 * 1.5, 0, null, 1, true, true);
    if (dB) dB.noGravity = true;
  }
  if (!tgt) { fly(e); return; }
  const txc = tgt.x, tyc = tgt.y;
  const muzzleX = e.cx - e.facing * 20, muzzleY = e.cy + 10;   // center 偏移（:66841）
  const dx = txc - muzzleX, dy = tyc - muzzleY;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const los = losClear(game, e.cx, e.cy, txc, tyc);
  if (x[0] < 0) x[0] += 1;                          // 冷却回摆（:66911-66912）
  if (dist > RANGE || !los) {
    // ---- 远距/断视：逼近（:66916-66918） ----
    e.vx = (e.vx * (LERP_FAR - 1) + ux * SPEED) / LERP_FAR;
    e.vy = (e.vy * (LERP_FAR - 1) + uy * SPEED) / LERP_FAR;
  } else if (dy < HEIGHT_GATE) {
    // ---- 目标高位差小：微升（:66920-66922） ----
    e.vy -= 0.03;
  } else if (x[0] >= 0) {
    // ---- 静止蓄电（:66924-66946） ----
    e.vx *= DAMP;
    e.vy *= DAMP;
    if (Math.hypot(e.vx, e.vy) < MIN_SPD) {
      x[0] += 1;
      if (x[0] >= SHOOT_T) {
        x[0] = -COOLDOWN;
        e.facing = ux > 0 ? 1 : -1;                 // direction = spriteDirection
        // 速度扰动（:66934-66944）：±25px 抖动 + 两级 ±0.5%/±0.625% 缩放
        let sx = dx + rndRange(-25, 26), sy = dy + rndRange(-25, 26);
        sx *= 1 + rndRange(-20, 21) * 0.005;
        sy *= 1 + rndRange(-20, 21) * 0.005;
        const sl = Math.hypot(sx, sy) || 1;
        sx = (sx / sl) * ZAP_SPD;
        sy = (sy / sl) * ZAP_SPD;
        sx *= 1 + rndRange(-20, 21) * (1 / 160);
        sy *= 1 + rndRange(-20, 21) * (1 / 160);
        // 682 电弧：timeLeft=30 / 无重力（SetDefaults :7281-7285 timeLeft=30+aiStyle1
        // 但 flag3 表豁免 ai[0] 自增=无重力支；数据列 tl:30）——旧 life300/pierce3
        // 近似退役（台账⑦同批）；scale 1.2 视觉档未接（C 面，登记）
        shootD2(game, muzzleX, muzzleY, sx, sy, ZAP_DMG, ZAP_PROJ, 3600, {});
      }
    }
  }
  // ---- 上浮（:66950-66970）：目标在上或自身埋块 → vy-0.2 钳 -10 ----
  let rise = tyc < e.cy;
  if (!rise) {
    const etx = Math.floor(e.cx / TILE), ety = Math.floor(e.cy / TILE);
    if (solidAt(game, etx, ety)) rise = true;
  }
  if (rise) {
    e.vy -= 0.2;
    if (e.vy < -10) e.vy = -10;
  }
  fly(e);
}

// ---------------------------------------------------------------------------
// AI_107 ImprovedWalkers（NPC.cs:63372-64919）——旧日军团地面 walker 族 1:1。
//   552/553/554 埃特尼亚哥布林 T1/T2/T3   近战前摇（flag5,纯接触伤害）
//   555/556/557 哥布林投弹手 T1/T2/T3     投 681 炸弹（flag12,42t 循环出手 18t）
//   561/562/563 标枪手 T1/T2/T3           掷 662（T3→685）标枪（flag12,90t/出手 82t）
//   566/567    旧日骷髅                   黑暗魔法师 RaiseGoblins 复活产物,120t 落地渐显
//   568/569    枯萎兽                     灵气态（削甲 debuff+60t 自疗+脉冲音）
//   570/571    德拉肯                     喷 671（60t 循环,出手 40t+多连拍）
//   572/573    小妖精（地面）             自爆冲锋（700px 点火→64px 起爆 192² 伤 80）
//   576/577    食人魔 T2/T3               三态（近挥/吐 676/跺地 683）按距离选招
//   620         地精鲨                     不在本档（Enemy.ts case 107 留 chargerAI wet 路径）
// 索敌（NPCUtils.TargetClosestOldOnesInvasion :261-273）：水晶 548（可击态）恒为候选,
//   200px 内玩家按近者夺标（SearchFilters.OnlyPlayersInCertainDistance :23-26）。
// 穿墙飞行（flag2,:63487-63507 + :64846-64918）：FighterUsesDD2PortalAppearEffect 族
//   （NPCID.cs:4793=552-557/561-563/564-565/568-573/576-577）无视线且朝向目标时
//   noGravity+noTileCollide 直飞——walker 翻山越壑奔水晶的原版机制。
// ---------------------------------------------------------------------------

/** GetAttackDamage_ForProjectiles（NPC.cs:7031-7034）：npc.difficulty 在
 *  Classic(1)→Expert(2) 区间的 Utils.Remap（GameDifficultyLevel.cs:7-9;不钳界,
 *  Master=3 外推照录）。Enemy.difficulty 即原版 npc.difficulty（ScaleStats 投影）。 */
function projDmgOf(e: Enemy, normal: number, expert: number): number {
  const t = e.difficulty - GDL.CLASSIC;   // 区间归零:Classic 0 / Expert 1 / Master 2
  return Math.round(normal + (expert - normal) * t);
}

/** SW-Q1 2026-09-03：681 专支尾焰尘锚点纯函数（AI_016 :48324-48330 逐参）。
 *  position = Center + (6×sign(vx), −h/2−6).RotBy(rot)×1.1（炸弹尾焰位,随滚转
 *  自转）;scale = 1+Next(5)×0.1（scaleStep=Next(5) 掷值,调用方掷）。每 tick 恰
 *  1 粒尘 6（681 被 :48285 通支排除表挡下后落到专属支,无概率门）。 */
export function goblinBombTrailDustAnchor(cx: number, cy: number, vx: number, rot: number,
  halfH: number, scaleStep: number): { x: number; y: number; scale: number } {
  const a = 6 * Math.sign(vx), b = -halfH - 6;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  return { x: cx + (a * cs - b * sn) * 1.1, y: cy + (a * sn + b * cs) * 1.1, scale: 1 + scaleStep * 0.1 };
}

/** AI_107 族参数（cs:63415-63475 默认档 → 各 case 覆写;行号逐项标注） */
interface Walker107P {
  scream: string | null;        // style + num22：每 tick 1/num22 概率嘶叫（:64494）
  screamOneIn: number;
  melee: boolean;               // flag5 近战/喷吐前摇（:64356-64386）
  triggerRange: number;         // num4 触发距（:63419）
  windup: number;               // num5 前摇帧数（:63420）
  cooldown: number;             // num6 前摇结束 → ai[0]=-num6（:63421）
  windupDampOn: boolean;        // flag7（食人魔 true）
  windupDamp: number;           // num7 前摇期 vx 阻尼（:63424）
  shooter: boolean;             // flag12 远程循环（:64551-64679）
  timer: number;                // num8 起手计时（:63433）
  fireAt: number;               // num9 出手帧（:63434;德拉肯按 ai[1] 现值改写）
  proj: number;                 // num12 弹型（:63438）
  projDmg: number;              // num11（GetAttackDamage_ForProjectiles）
  muzzleDx: number;             // vector.X（direction 倍率,cs:63436）
  muzzleDy: number;             // vector.Y（绝对像素）
  muzzleAtBottom: boolean;      // 食人魔跺地:vector.Y = height/2-1（:63581）
  spawnOffset: number;          // num18 出膛位移倍率（cs:63445,德拉肯 0）
  arc: number;                  // num15 弧线补偿 v.Y-=|v.X|*num15（:63441）
  jitter: number;               // num16 出膛扰动（:63443）
  shots: number;                // num17 连发数（:63437）
  speed: number;                // num10 弹速（:63435）
  startRange: number;           // num13 起手距（:63439）
  fireOnWindup: boolean;        // flag3 前摇倒数中 ai[0]==num9 出弹（:64387-64419）
  jump: boolean;                // flag4 前摇倒数中 ai[0]==num 起跳（:64420-64430）
  jumpT: number;                // num（:63415）
  jumpMinT: number;             // num2（:63416）
  jumpVy: number;               // num3（:63417）
  maxSpd: number;               // num23（:63460）
  accel: number;                // num24（:63461）
  damp: number;                 // num25（:63462）
  noWalkAccel: boolean;         // flag24 远程族:走路加速改挂攻击块尾（:63632/:63950）
  noRetarget: boolean;          // flag20 骷髅档:跳过嘶叫/重定向/静止折返块（:64264）
  aimAbove: number;             // flag15 阈值:ai[1] > 此值时持续重定向（各族字面量）
}

/** FighterUsesDD2PortalAppearEffect（NPCID.cs:4793）：出生 60t 渐显 + 30t 出世音。
 *  ★BJ542 导出仅供判别测试对账原版 19 键全集（NPCID.cs:4797 Factory.BoolSet 字面集） */
export const W107_PORTAL_FADE = new Set([552, 553, 554, 555, 556, 557, 561, 562, 563,
  564, 565, 568, 569, 570, 571, 572, 573, 576, 577]);

/** 穿墙相位标记（原版 noGravity+noTileCollide 静态位 → WeakSet 落盘;flag2 滞回） */
const w107Phasing = new WeakSet<Enemy>();
/** 上一拍水平零位移（原版 position.X == oldPosition.X,:64437 的卡位计数源） */
const w107NoMove = new WeakSet<Enemy>();

function walker107Params(e: Enemy, x: number[]): Walker107P {
  const id = e.vanillaId ?? 0;
  const p: Walker107P = {
    scream: null, screamOneIn: 0,
    melee: false, triggerRange: 40, windup: 30, cooldown: 0,
    // flag7 默认【真】+ num7=0.9（:63423-63424）——近战前摇刹车族全适用（哥布林/
    // 枯萎兽/小妖精/食人魔）；食人魔覆写 0.7（:63523）。刹车附带：跳过走路加速
    // （flag24,:64374）+ 跳过重定向嘶叫块（flag20,:64375）+ ai[3] 清零（:64376）
    windupDampOn: true, windupDamp: 0.9,
    shooter: false, timer: 70, fireAt: 35, proj: 81, projDmg: 1,
    muzzleDx: 0, muzzleDy: 0, muzzleAtBottom: false, spawnOffset: 1,
    arc: 0.1, jitter: 0.5, shots: 1, speed: 11, startRange: 700,
    fireOnWindup: false, jump: false, jumpT: 32, jumpMinT: 15, jumpVy: 9,
    maxSpd: 1, accel: 0.07, damp: 0.8,
    noWalkAccel: false, noRetarget: false, aimAbove: 0,
  };
  // 出生 60t 内移速爬坡（各族共通,cs:63624-63627/:63674-63678/:63842-63845/:63964-63967）
  const rampAccel = (): boolean => {
    if (x[3] >= 60) return false;
    p.accel = 0.01 + (x[3] / 60) * 0.05;
    return true;
  };
  switch (id) {
    case 552: case 553: case 554: {        // 埃特尼亚哥布林（cs:63607-63628）
      p.scream = 'dd2_goblin_scream'; p.screamOneIn = 1000;   // DD2_GoblinScream
      p.melee = true;                                        // flag5 近战前摇
      if (id === 553) { p.accel += 0.01; p.maxSpd += 0.2; }
      if (id === 554) { p.accel += 0.02; p.maxSpd += 0.4; }
      rampAccel();
      break;
    }
    case 555: case 556: case 557: {        // 哥布林投弹手（cs:63993-64041）
      p.scream = 'dd2_goblin_bomber_scream'; p.screamOneIn = 800;   // DD2_GoblinBomberScream
      p.shooter = true; p.noWalkAccel = true;
      p.timer = 42; p.fireAt = 18; p.proj = 681;                    // DD2GoblinBomb
      p.muzzleDy = -14; p.arc = 0.4; p.speed = 6; p.startRange = 280;
      p.aimAbove = 18;                     // flag15 = ai[1] > 18（:64003）
      if (id === 555) { p.maxSpd = 0.88; p.jitter = 0.6; p.projDmg = projDmgOf(e, 20, 15); }
      if (id === 556) { p.maxSpd = 0.88; p.jitter = 0.6; p.projDmg = projDmgOf(e, 30, 25); }
      if (id === 557) { p.maxSpd = 1.12; p.jitter = 0.4; p.projDmg = projDmgOf(e, 40, 35); }
      rampAccel();
      if (x[3] < 60) p.startRange = 1;     // 出生爬坡期不起手（num13=1,:64013-64017）
      break;
    }
    case 561: case 562: case 563: {        // 埃特尼亚标枪手（cs:63937-63992）
      p.shooter = true; p.noWalkAccel = true;
      p.timer = 90; p.fireAt = 82;
      p.proj = id === 563 ? 685 : 662;     // DD2JavelinHostile[T3]（:63954-63958）
      p.muzzleDy = -14; p.arc = 0; p.speed = 13; p.startRange = 600;
      p.aimAbove = 82;                     // flag15 = ai[1] > 82（:63951）
      if (id === 561) { p.maxSpd = 0.88; p.jitter = 0.6; p.speed = 11.5; p.startRange = 500; p.projDmg = projDmgOf(e, 15, 10); }
      if (id === 562) { p.maxSpd = 0.94; p.jitter = 0.5; p.speed = 12.2; p.startRange = 550; p.projDmg = projDmgOf(e, 30, 20); }
      if (id === 563) { p.maxSpd = 1; p.jitter = 0.4; p.projDmg = projDmgOf(e, 45, 30); }
      // 出手帧嘶吼（:63942-63947）：DD2_JavelinThrowersAttack + 之后 1/7 概率 Taunt
      if (e.ai1 === 82) {
        p.scream = 'dd2_javelin_throwers_taunt'; p.screamOneIn = 7;
      }
      rampAccel();
      if (x[3] < 60) p.startRange = 1;     // :63964-63968
      break;
    }
    case 566: case 567:                    // 旧日骷髅（cs:64042-64117）——无攻击,落地渐显
      // ★BJ542 型别锚（cs:64263-64264）：flag24=true（不吃走路加速——落地后原地驻立）
      // + flag20=true（跳过嘶叫/重定向/静止折返块——面朝出生向,卡位传送沿原向瞬移）。
      // 曾缺两旗 → 骷髅落地后自行走向晶体 + 每拍重定向（型别面偏离原版）。
      p.noWalkAccel = true; p.noRetarget = true;
      break;
    case 568: case 569: {                  // 枯萎兽（cs:63847-63936）——灵气态
      p.windup = 110; p.accel = 0.16; p.damp = 0.7; p.maxSpd = 1.4;
      p.melee = true; p.triggerRange = 600;
      rampAccel();
      break;
    }
    case 570: case 571: {                  // 德拉肯（cs:63629-63679）
      p.shooter = true; p.noWalkAccel = true;
      p.timer = 60; p.fireAt = 40; p.proj = 671;                    // DD2DrakinShot
      p.muzzleDx = 22; p.arc = 0.15; p.speed = 13; p.startRange = 600;
      p.spawnOffset = 0;                   // num18=0（:63652）
      p.maxSpd = 0.77; p.jitter = 1.5;
      p.projDmg = id === 571 ? projDmgOf(e, 60, 45) : projDmgOf(e, 35, 25);
      if (id === 570) p.jitter = 2.5;      // :63653-63656
      // 多连拍改写出手帧（:63637-63644:ai[1]∈(10,40] 且整除 6/9 → num9=ai[1]-1）
      if (e.ai1 > 10 && e.ai1 <= 40 && e.ai1 % (id === 571 ? 6 : 9) === 0) {
        p.fireAt = e.ai1 - 1;
      }
      p.aimAbove = 40;                     // flag15 = ai[1] > 40（:63634）
      rampAccel();
      if (x[3] < 60) p.startRange = 1;     // :63674-63678
      break;
    }
    case 572: case 573:                    // 小妖精地面型（cs:63680-63846）——自爆冲锋
      p.maxSpd = 0.88;
      break;
    case 576: case 577:                    // 食人魔（cs:63513-63606）——三态
      p.scream = 'dd2_ogre_roar'; p.screamOneIn = 700;              // DD2_OgreRoar
      p.melee = true; p.windupDampOn = true; p.windupDamp = 0.7;
      p.cooldown = 60; p.triggerRange = 130; p.windup = 44;
      // 选招在主函数 ogre 状态块（先于本 builder 跑,见 ai107ImprovedWalkers 头部）:
      // ≤430 跺地(ai[1]=2) / >160 吐息(=1) / 否则近挥(=0)
      if (e.ai1 === 2) {                   // 跺地（:63569-63586）
        p.windup = 90; p.triggerRange = 250;
        p.fireOnWindup = true; p.jump = true;
        p.jumpT = 56; p.jumpMinT = 41; p.jumpVy = 13;
        p.fireAt = 36; p.proj = 683;       // DD2OgreSmash
        p.projDmg = projDmgOf(e, 60, 40);
        p.aimAbove = 0;                   // flag15=false（:63580）
        p.muzzleDx = -20; p.muzzleAtBottom = true;   // vector=(-direction*20,height/2-1)
      } else if (e.ai1 === 1) {            // 吐息（:63587-63600）
        p.windup = 90; p.triggerRange = 1000;
        p.cooldown = 240;                  // num6=240（:63591——曾沿用默认 60）
        p.fireOnWindup = true;
        p.fireAt = 35; p.proj = 676;       // DD2OgreSpit（num9=默认 num8/2=35）
        p.projDmg = projDmgOf(e, 40, 30);
        p.aimAbove = 0;                   // flag15=false（:63587）
        p.muzzleDx = 30; p.muzzleDy = -70;            // vector=(direction*30,-70)
      }
      // 近挥（ai[1]==0）:默认参数（num5=44,无弹）
      break;
    default:
      break;
  }
  return p;
}

/** AI_107 出膛（cs:64394-64417 flag3 / :64575-64615 flag12 共用弹道） */
function fireWalkerProj(
  game: GameHooks, e: Enemy, p: Walker107P, tx: number, ty: number,
): void {
  const mx = e.cx + p.muzzleDx * e.facing;
  const my = e.cy + (p.muzzleAtBottom ? e.h / 2 - 1 : p.muzzleDy);
  let vx = tx - mx, vy = ty - my;
  vy -= Math.abs(vx) * p.arc;              // 弧线补偿
  const len = Math.hypot(vx, vy) || 1;
  vx = (vx / len) * p.speed;
  vy = (vy / len) * p.speed;
  const sx = mx + vx * p.spawnOffset, sy = my + vy * p.spawnOffset;
  for (let i = 0; i < p.shots; i++) {
    const jx = vx + (Math.random() * 2 - 1) * p.jitter;   // Utils.RandomVector2(±num16)
    const jy = vy + (Math.random() * 2 - 1) * p.jitter;
    if (p.proj === 681) {
      // 681 哥布林炸弹（aiStyle 16,SetDefaults :6984-6991）——引信/反弹/80² 爆盒
      (game as unknown as { entities: { add: (en: unknown, b: string) => void } })
        .entities.add(new DD2GoblinBomb(sx, sy, jx, jy, p.projDmg), 'projectiles');
    } else if (p.proj === 683) {
      // 683 食人魔跺地波（aiStyle 135,SetDefaults :7003+）——原地 80→640 扩盒
      (game as unknown as { entities: { add: (en: unknown, b: string) => void } })
        .entities.add(new DD2OgreSmash(sx, sy, p.projDmg), 'projectiles');
    } else {
      // 662/685 标枪、671 德拉肯弹、676 食人魔涎（均 aiStyle 1）——★台账⑦(2026-08-31)
      // 重力日程逐型回归：显式 grav/life/pierce 覆盖全部退役，改由 projGravSpec +
      // vanilla-projectiles.json 列驱动（Arrow ctor :1397-1406 缺省回退路径）：
      // · 662/685（1458 P.cs:58454-58460 / 1456 :54589-54594）：ai[0]>60 才弧化——
      //   此后 vy+=0.3/t 且 vx*=0.98/t 同拍组合（Arrow 的 drag 恒在重力门内生效）；
      //   曾显式 grav .3 覆盖 spec = 标枪前 60t 直飞相缺失 + 全程重弧化。
      // · 671/676（1458 P.cs:58653-58666 / 1456 :54686-54699 AI_001 兜底支）：
      //   ai[0]>=15 才 +0.1/t（计数钳 15）——"德拉肯两式"斜率即此。
      // · timeLeft=3600 / penetrate=-1 均取数据列（SetDefaults :7124-7132/:7188-7201/
      //   :7233-7244 未覆写；-1=无限穿透按通用 immune 冷却再命中，旧 pierce 999 近似退役）
      const javelin = p.proj === 662 || p.proj === 685;
      shootD2(game, sx, sy, jx, jy, p.projDmg, p.proj, 3600,
        javelin ? { drag: 0.98 } : {});
    }
  }
}

/** AI_107 目标（NPCUtils.TargetClosestOldOnesInvasion :261-273 + SearchForTarget
 *  :196-259）：水晶 548（!dontTakeDamageFromHostiles）恒候选;玩家**恒**受 200px
 *  距离滤（OnlyPlayersInCertainDistance :24-28 `player.Distance(position) <= maxDistance`
 *  ——★BJ356 勘误:原滤与水晶在场无关,曾写成"无水晶时全图咬玩家"=事件收场后
 *  DD2 怪跨图追杀/相位穿墙的放大器）;候选间比较按 aggro 折扣（SearchForTarget
 *  :229-231 num5 = dist − aggro） */
interface W107Target { x: number; y: number; w: number; h: number; cx: number; cy: number; }

function w107Target(game: GameHooks, e: Enemy, player: Player | null): W107Target | null {
  // TargetClosestOldOnesInvasion（NPCUtils.cs:261-273）：水晶候选 + 200px 内玩家
  let crystal: Enemy | null = null;
  for (const n of game.enemies() as Enemy[]) {
    // OnlyCrystal（NPCUtils.cs:16-21）：!dontTakeDamageFromHostiles（★BJ450 真名旗——
    // 旧档映射 dontTakeDamage,演出期水晶照旧被咬=索敌面偏离）
    if (!n.dead && n.vanillaId === 548 && !n.dontTakeDamageFromHostiles) { crystal = n; break; }
  }
  const pd = player && !player.dead
    ? Math.hypot(player.cx - e.cx, player.cy - e.cy) : Infinity;
  const aggro = player && !player.dead
    ? ((player as unknown as { aggro?: number }).aggro ?? 0) : 0;
  if (crystal) {
    const cd = Math.hypot(crystal.cx - e.cx, crystal.cy - e.cy);
    if (pd <= 200 && pd - aggro < cd) {
      return { x: player!.x, y: player!.y, w: player!.w, h: player!.h, cx: player!.cx, cy: player!.cy };
    }
    return { x: crystal.x, y: crystal.y, w: crystal.w, h: crystal.h, cx: crystal.cx, cy: crystal.cy };
  }
  // 无水晶：玩家仍限 200px（OnlyPlayersInCertainDistance 恒参与,与水晶无关）
  if (pd <= 200) {
    return { x: player!.x, y: player!.y, w: player!.w, h: player!.h, cx: player!.cx, cy: player!.cy };
  }
  return null;
}

/** AI_107 走路加速核（:64537-64550 / :64660-64678 同式） */
function w107WalkAccel(e: Enemy, p: Walker107P): void {
  if (e.vx < -p.maxSpd || e.vx > p.maxSpd) {
    if (e.vy === 0) { e.vx *= p.damp; e.vy *= p.damp; }    // velocity *= num25
  } else if ((e.vx < p.maxSpd && e.facing === 1) || (e.vx > -p.maxSpd && e.facing === -1)) {
    e.vx = clamp(e.vx + p.accel * e.facing, -p.maxSpd, p.maxSpd);
  }
}

/** AI_107 主入口（NPC.cs:63372-64919） */
export function ai107ImprovedWalkers(e: Enemy, game: GameHooks, player: Player | null): void {
  if (!e.bInit) {
    e.bInit = true; e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    // ★台账⑩：小妖精引信跟踪轨随实体剔除拆轨（Entity.compact 对 dead 回调 destroy）
    (e as { destroy?: () => void }).destroy = () => fuseLoopStop(e);
  }
  const x = dd2LocalAI(e);
  const id = e.vanillaId ?? 0;
  // flag（:63614）：tick 初 vx==vy==0 且未受击——卡死小跳（:65030）消费
  const flag107Stuck = e.vx === 0 && e.vy === 0 && !e.justHit;
  // ---- 目标（先取,各族 case 内的音效/选招都读它） ----
  let tgt = w107Target(game, e, player);
  // ---- 食人魔距离选招（cs:63528-63555）：ai[0]<=0 且出生 60t 后,按目标距定 ai[1] ----
  if (id === 576 || id === 577) {
    if (x[0] > 0) x[0] -= 1;               // localAI[0] 跺地冷却（:63524-63527）
    if (e.ai0 <= 0 && x[3] >= 60 && tgt) {
      const prev = e.ai1;
      const dist = Math.hypot(tgt.cx - e.cx, tgt.cy - e.cy);
      if (x[3] >= 60) {
        if (dist <= 130 + 300 && x[0] <= 0) e.ai1 = 2;       // 跺地（:63534-63537）
        else if (dist > 130 + 30) e.ai1 = 1;                 // 吐息（:63538-63540）
        else if (!(dist > 130)) {
          e.ai1 = 0;                                         // 近挥（:63541-63549）
          if (prev === 1) e.ai0 = 0;
        }
      }
    }
    if (e.ai0 > 0 && e.ai1 === 2) x[0] = 300;                // 跺地后冷却（:63556-63559）
  }
  const p = walker107Params(e, x);
  // ---- 旧日骷髅落地渐显（cs:64042-64117）：120t 不可击/悬停,之后正常 walker ----
  if (id === 566 || id === 567) {
    if (x[3] < 120) {
      e.iframes = 2;                       // dontTakeDamage=true（:64058）
      e.vx = 0;
      e.ai3 = 0;
      if (x[3] === 0) e.spawnAlpha = 255;
      x[3] += 1;
      if (x[3] >= 110) e.spawnAlpha = Math.max(0, e.spawnAlpha - 26);   // :64069-64076
      e.alphaFade = false;                 // 本 AI 自管渐显
      e.vy = Math.min(e.vy + 0.3, 10);     // 悬停期仍受重力（noGravity 未置位）
      moveAndCollide(e, game.world, e.vx, e.vy);
      return;
    }
  }
  // ---- 出生渐显（flag29,cs:64262-64300）：60t,30t 出世音,尘带 ----
  if (W107_PORTAL_FADE.has(id)) {
    if (x[3] === 0) e.spawnAlpha = 255;
    if (x[3] === 30) {
      game.playSfxFiles(soundTrackFiles('dd2_etherian_portal_spawn_enemy'), 0.4, e.cx, e.cy);
    }
    if (x[3] < 60) {
      x[3] += 1;
      e.spawnAlpha = Math.max(0, e.spawnAlpha - 5);
      e.alphaFade = false;
    }
  } else if (x[3] < 60) {
    x[3] += 1;                             // 非渐显族也推进（各族出生爬坡读 x[3]）
  }
  // ---- 枯萎兽灵气态（cs:63861-63935）:ai[0]==1 进入,此后 1↔2 振荡驻留 ----
  if (id === 568 || id === 569) {
    if (e.ai0 === 0) x[1] = 0;
    if (e.ai0 === 1) {
      e.def.hitSound = soundTrackFiles('dd2_wither_beast_crystal_impact');  // HitSound（:63871）
      e.ai0 += 1;                          // →2,由下方 flag5 块减回 1 形成驻留
      x[0] += 1;
      if (x[1] === 0) {
        x[1] = 1;
        game.playSfxFiles(soundTrackFiles('dd2_wither_beast_aura_pulse'), 0.5, e.cx, e.cy);
      }
      // 400px 内玩家削甲 debuff（buff 195 WitheredArmor 3t，Player.cs:11436 施加链；
      //   本仓 BuffType.WitheredArmor=101 已建模，defense 终值减半）—— aura 期间每 tick 续期
      {
        const pl = (game as unknown as { player: { buffs: { apply: (t: number, secs: number) => void } | null; cx: number; cy: number } }).player;
        if (pl?.buffs && Math.abs(pl.cx - e.cx) <= 400 && Math.abs(pl.cy - e.cy) <= 400) {
          pl.buffs.apply(101 /* BuffType.WitheredArmor */, 0.06);   // 3t ≈ 0.05s
        }
      }
      // 60t 自疗 lifeMax/20（:63912-63934）
      if (e.ai1 > 0) e.ai1 -= 1;
      if (e.ai1 <= 0) {
        e.ai1 = 60;
        const heal = Math.min(Math.floor(e.maxHp / 20), e.maxHp - e.hp);
        if (heal > 0) {
          e.hp += heal;
          game.addDamageNumber(e.cx, e.cy - 10, -heal, false, '#7CFF6A');
        }
      }
      // 目标在 400px 内 → 灵气脉动尘
      if (tgt && Math.hypot(tgt.cx - e.cx, tgt.cy - e.cy) < 400
        && Math.random() < 0.1) {
        game.spawnParticles(e.cx + (Math.random() - 0.5) * 40, e.cy - 20, '#C060FF', 1, 0.8, { life: 30 });
      }
    }
  }
  // ---- 小妖精地面型自爆链（cs:63680-63846,1458 段 :63881-64047） ----
  if (id === 572 || id === 573) {
    if (e.ai1 === 2) {
      fuseLoopStop(e);                     // 起爆即拆轨
      // 起爆（:63692-63749）：192² 盒、伤 80、3t 消散（不走掉落管线）
      e.x = e.cx; e.y = e.cy;
      e.w = 192; e.h = 192;
      e.x -= e.w / 2; e.y -= e.h / 2;
      e.vx = 0; e.vy = 0;
      e.def.damage = 80;                   // GetAttackDamage_ScaledByDifficulty(80)
      e.spawnAlpha = 255;
      if (e.ai0 === 0) {
        game.spawnParticles(e.cx, e.cy, '#FFD24A', 20, 4, { life: 30, grav: -0.05 });
        game.spawnParticles(e.cx, e.cy, '#FF9A3C', 12, 3, { life: 40 });
      }
      e.ai0 += 1;
      if (e.ai0 >= 3) {
        game.playSfxFiles(soundTrackFiles('dd2_kobold_explosion'), 1, e.cx, e.cy);  // DD2_KoboldExplosion（:63744）
        game.spawnParticles(e.cx, e.cy, '#FFB060', 30, 5, { life: 36 });
        e.dead = true;                     // life=0 + active=false（:63745-63747）
      }
      return;
    }
    if (e.ai0 > 0 && e.ai1 === 0) {
      // 点火（1458 :63957-63969）：one-shot DD2_KoboldIgnite（localAI[0] 槽空才播,
      // 以 x[2]==0 门近似）+ localAI[2]==30 拍起 引信/冲锋双循环轨——★台账⑩:
      // 60t 补播近似退役,改 startTrackedLoop 跟踪轨（manage 在下方统一驱动,
      // active 面 = 本窗 x[2]>=30 ∪ 冲锋窗）
      if (x[2] === 0) game.playSfxFiles(soundTrackFiles('dd2_kobold_ignite'), 0.6, e.cx, e.cy);
      x[2] += 1;
    }
    if (e.ai0 > 0 && e.ai1 === 1) {
      e.ai0 = 0; e.ai1 = 2;                // 冲锋中再触发 → 起爆（:63962-63967）
      fuseLoopStop(e);                     // 拆轨再进起爆态
      return;
    }
    if (e.ai0 === 1) e.ai1 = 1;            // 前摇倒数到 1 → 冲锋态（:63969-63971）
    if (e.ai1 > 0 && e.ai0 === 0) {
      // 冲锋档（:63979-64005）：触发距 64、4 速直冲;引信/冲锋循环音由下方 manage
      // 驱动（GetActiveSound==null → PlayTrackedSound + Position 跟随,台账⑩）
      if (Math.random() < 1 / 6) {
        game.spawnParticles(e.cx + e.facing * 12, e.cy, '#FFD0A0', 1, 0.8, { life: 30 });
      }
      p.melee = true; p.windup = 40; p.triggerRange = 64;
      p.accel = 0.3; p.maxSpd = 4;
    } else {
      // 接近档（:63836-63841）：700px 内点火
      p.melee = true; p.windup = 40; p.triggerRange = 700;
    }
    // ★台账⑩：引信跟踪轨统一驱动——点火窗 localAI[2]>=30 起双轨、冲锋窗持续,
    // 其余态拆轨（原版 :63957-64005 的 GetActiveSound-null→重播 + Position 跟随）
    fuseLoopManage(
      e, game,
      [['ignite', 'dd2KoboldIgniteLoop'], ['scream', 'dd2KoboldChargeLoop']],
      (e.ai1 === 1 && e.ai0 === 0) || (e.ai1 === 0 && e.ai0 > 0 && x[2] >= 30),
      e.cx, e.cy);
  }
  // ---- 食人魔招式音（cs:63562-63600）:ai[0]==40 近挥/跺地,==80 吐息 ----
  if ((id === 576 || id === 577) && e.ai0 === 40) {
    if (e.ai1 === 0) game.playSfxFiles(soundTrackFiles('dd2_ogre_attack'), 0.8, e.cx, e.cy);
    else if (e.ai1 === 2) game.playSfxFiles(soundTrackFiles('dd2_ogre_ground_pound'), 0.8, e.cx, e.cy);
  }
  if ((id === 576 || id === 577) && e.ai0 === 80 && e.ai1 === 1) {
    game.playSfxFiles(soundTrackFiles('dd2_ogre_spit'), 0.8, e.cx, e.cy);
  }
  // ---- 远程族招式音（cs:63663-63673/:63942-63947/:64036-64039,均读减数前 ai[1]） ----
  if (p.shooter && e.ai0 > 0) {
    if (id === 570 || id === 571) {
      if (e.ai1 === 40) game.playSfxFiles(soundTrackFiles('dd2_drakin_shot'), 0.7, e.cx, e.cy);
      else if (e.ai1 === 60) game.playSfxFiles(soundTrackFiles('dd2_drakin_breath_in'), 0.6, e.cx, e.cy);
    }
    if ((id === 561 || id === 562 || id === 563) && e.ai1 === 82) {
      game.playSfxFiles(soundTrackFiles('dd2_javelin_throwers_attack'), 0.7, e.cx, e.cy);
    }
    if ((id === 555 || id === 556 || id === 557) && e.ai1 === p.fireAt) {
      game.playSfxFiles(soundTrackFiles('dd2_goblin_bomber_throw'), 0.7, e.cx, e.cy);
    }
  }
  // ---- 穿墙相位判定（flag2,cs:63487-63507）----
  // ★BJ356 对拍勘误三件（cs:63490-63503 亲读）：
  //   ① 目标无效 → flag2 保持初值 false → 每拍 noGravity/noTileCollide 双清
  //     （:63705-63710 else 支）——曾用 WeakSet 滞回让"目标消失仍粘相位"=事件
  //     收场后无目标怪飘行穿地不止的放大器;
  //   ② 闩锁门（:63700-63704）：flag2 真但【未】处于相位时,须 vy==0（落地）或
  //     |ΔY|>800 才置 noGravity/noTileCollide;已相位则 flag2 维持即可（门只门
  //     「置位」不清位）;
  //   ③ 滞回第二析取项读的是当前 noGravity 位（:63491）= 上一拍相位态,语义同 WeakSet。
  let phase = false;
  if (W107_PORTAL_FADE.has(id)) {
    const prevPhase = w107Phasing.has(e);   // noGravity 滞回（:63491 第二析取项）
    phase = prevPhase;
    if (tgt) {
      const noLos = !losClear(game, e.cx, e.cy, tgt.cx, tgt.cy);
      const dist = Math.hypot(tgt.cx - e.cx, tgt.cy - e.cy);
      if (noLos && (e.facing === sign(tgt.cx - e.cx) || (prevPhase && dist > 50 && e.cy > tgt.cy))) {
        phase = e.ai0 <= 0;                // flag2 &= ai[0] <= 0（攻击中不穿墙）
        // 闩锁门（:63700-63704）：仅「新进相位」须落地或目标极远;已相位维持
        if (phase && !prevPhase && !(e.vy === 0 || Math.abs(tgt.cy - e.cy) > 800)) phase = false;
      } else {
        phase = false;                     // :63705-63710 else 支=双清
      }
    } else {
      phase = false;                       // 目标无效 → flag2=false（:63490 无赋值=初值）
    }
    if (phase) w107Phasing.add(e); else w107Phasing.delete(e);
  }
  const attacking = (p.melee || p.shooter) && e.ai0 > 0;    // (flag12||flag5)&&ai[0]>0 → flag18=false（:64344）
  const busy = attacking || (p.shooter && e.ai1 > 0) || (p.melee && e.ai0 > 0);   // flag22
  // ---- 近战/喷吐前摇（flag5,cs:64356-64386）——先于卡位/重定向/走加速跑（原序）,
  //      刹车三连：vx×num7 + 跳走加速（flag24）+ 跳重定向（flag20）+ ai[3] 清零 ----
  let windupBraking = false;
  if (p.melee) {
    if (e.ai0 < 0) e.ai0 += 1;             // 冷却回摆（:64358-64362）
    if (e.ai0 === 0 && e.vy === 0 && tgt
      && losClear(game, e.cx, e.cy, tgt.cx, tgt.cy)
      && Math.hypot(tgt.cx - e.cx, tgt.cy - e.cy) < p.triggerRange) {
      e.ai0 = p.windup;                    // 起手（:64363-64367）
    }
    if (e.ai0 > 0) {
      if (p.windupDampOn) {                // flag7（:64371-64378,默认 0.9/食人魔 0.7）
        e.vx *= p.windupDamp;
        windupBraking = true;              // flag24+flag20
        e.ai3 = 0;
      }
      e.ai0 -= 1;
      if (e.ai0 === 0) e.ai0 = -p.cooldown;
    }
    if (id === 576 || id === 577) {
      if (e.ai0 < -p.cooldown) e.ai0 = -p.cooldown;   // 钳界（:63602-63605）
    }
  }
  // ---- 前摇倒数中出弹（flag3,cs:64387-64419:食人魔吐息/跺地） ----
  if (p.fireOnWindup && e.ai0 > 0) {
    if (tgt && e.ai0 === p.fireAt) fireWalkerProj(game, e, p, tgt.cx, tgt.cy);
  }
  // ---- 前摇倒数中起跳（flag4,cs:64420-64430:跺地 ai[0]==56 → vy=-13） ----
  if (p.jump && e.ai0 > 0) {
    if (e.vy !== 0 && e.ai0 < p.jumpMinT) e.ai0 = p.jumpMinT;
    if (e.ai0 === p.jumpT) e.vy = -p.jumpVy;
  }
  // ---- 卡位/转向计数（1457 :64636-64659,flag18=true 时推进） ----
  let teleported = false;
  if (!attacking) {
    // position.X == oldPosition.X（:64641）= 上一拍水平位移为零 → w107NoMove 落盘
    const flag19 = e.vy === 0 && e.vx * e.facing < 0;
    if (w107NoMove.has(e) || flag19 || e.ai3 >= 30) e.ai3 += 1;
    else if (Math.abs(e.vx) > 0.9 && e.ai3 > 0) e.ai3 -= 1;
    if (e.ai3 > 300) e.ai3 = 0;            // num21*10
    if (e.justHit && id === 620) e.ai3 = 0;   // justHit && !flag30（:64648-64652；flag30=除 620 恒真）
    if (tgt && e.x < tgt.x + tgt.w && e.x + e.w > tgt.x
      && e.y < tgt.y + tgt.h && e.y + e.h > tgt.y) e.ai3 = 0;
    // ---- 卡位传送（R6-B 5-1，:64660-64691）：ai[3]==num21(30) 且 flag30（除 620
    // 全体）→ noGravity/noTileCollide + position.X += direction×width×2 + 20 尘 27
    // + 本 tick 跳过余段——DD2 walker 卡墙 30t 穿墙瞬移（曾只计数无传送=永久滞留）。
    // flag30 型下一 tick flag2 重估：仍失视且（同向‖已 noGravity 且距>50 在上方）
    // → 保持相位；非 fade 型（flag29=false）下一 tick flag2=false 立即退出相位 ----
    if (e.ai3 === 30 && id !== 620) {
      teleported = true;
      e.x += e.facing * e.w * 2;           // :64667
      game.spawnParticles(e.cx, e.cy, '#C8B8D8', 8, 1.2, { life: 30, damp: 0.9, grav: 0 });
      if (W107_PORTAL_FADE.has(id)) w107Phasing.add(e);   // noGravity/noTileCollide（:64665-64666）
    }
  }
  // ---- 嘶叫 + 重定向 / 静止折返（1457 :64790-64836;flag20 刹车期整块跳过;
  //      骷髅 566/567 flag20 恒真（:64264）→ 整块跳过;传送 tick 跳过余段 = 原版 :64689 return） ----
  if (!windupBraking && !teleported && !p.noRetarget) {
    if (e.ai3 < 30) {
      // flag21 = DD2Event.EnemiesShouldChasePlayers（DD2Event.cs:115-123 恒真）
      if (p.scream && p.screamOneIn > 0 && rnd(p.screamOneIn) === 0) {
        game.playSfxFiles(soundTrackFiles(p.scream), 0.6, e.cx, e.cy);
      }
      tgt = w107Target(game, e, player);   // TargetClosestOldOnesInvasion
      if (tgt) e.facing = tgt.cx > e.cx ? 1 : -1;
    } else if (!busy) {
      if (e.vx === 0) {
        if (e.vy === 0) {
          e.ai2 += 1;
          if (e.ai2 >= 2) {                // 静止 2t 折返（:64516-64523）
            e.facing *= -1;
            e.ai2 = 0;
          }
        }
      } else if (e.ai2 !== 0) {
        e.ai2 = 0;
      }
      if (e.facing === 0) e.facing = 1;
    }
  }
  // ---- 走路加速（flag24=false 族;刹车期/传送 tick 跳过,1457 :64837-64850） ----
  if (!p.noWalkAccel && !windupBraking && !teleported) w107WalkAccel(e, p);
  // ---- 远程循环（flag12,cs:64851-64979） ----
  if (p.shooter && !teleported) {
    if (e.ai1 > 0) e.ai1 -= 1;             // 先减后比（德拉肯多连拍依赖此序）
    if (e.justHit) { e.ai1 = 30; e.ai0 = 0; }   // num19=30（:64563-64567）
    const aimRetarget = e.ai1 > p.aimAbove;   // flag15（各族字面阈值,德拉肯不随连拍改写）
    if (e.ai0 > 0) {
      if (aimRetarget && tgt) e.facing = tgt.cx > e.cx ? 1 : -1;
      if (tgt && e.ai1 === p.fireAt) {
        fireWalkerProj(game, e, p, tgt.cx, tgt.cy);
        // 姿态角 ai[0]=1..5（渲染语义,cs:64599-64614——按弹道主轴选向,仅保状态）
        const dx = tgt.cx - e.cx, dy = tgt.cy - e.cy;
        e.ai0 = Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? 1 : 5)
          : Math.abs(dx) > Math.abs(dy) * 2 ? 3 : (dy > 0 ? 2 : 4);
        e.facing = dx > 0 ? 1 : -1;
      }
      if (e.vy !== 0 || e.ai1 <= 0) {      // flag14=false:腾空/计时尽 → 收招
        e.ai0 = 0;
        e.ai1 = 0;
      } else {
        e.vx *= 0.9;                       // 瞄准减速（:64629）
      }
    }
    // 起手（:64633-64658）：站桩 + 视线 + num13 内 → 半速 + ai[0]=3/ai[1]=num8
    if (e.ai0 <= 0 && e.vy === 0 && e.ai1 <= 0 && tgt
      && losClear(game, e.cx, e.cy, tgt.cx, tgt.cy)) {
      const d = Math.hypot(tgt.cx - e.cx, tgt.cy - e.cy);
      if (d < p.startRange) {
        e.vx *= 0.5;
        const dx = tgt.cx - e.cx, dy = tgt.cy - e.cy;
        e.ai0 = Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? 1 : 5)
          : Math.abs(dx) > Math.abs(dy) * 2 ? 3 : (dy > 0 ? 2 : 4);
        e.ai1 = p.timer;
        e.facing = dx > 0 ? 1 : -1;
      }
    }
    if (e.ai0 <= 0) w107WalkAccel(e, p);   // 收招后走路加速（:64660-64678）
  }
  // ---- 位移（原版由公共碰撞步承载;此处按引擎惯例自理）。teleported → 本 tick
  //      穿墙位移（:64689 return 后公共步以 noTileCollide 移动）----
  if (phase || teleported) {
    // ★BJ-C10 F2（BJ542 残债）：传送 tick 原版 :64689 return——AI 余段（相位飞行
    // 伺服/α 爬升/localAI[3] 钉值/wet 清位）整段跳过,仅公共步以 noTileCollide 穿墙
    // 位移。fade 型下一 tick flag2 重估（:63491 noTileCollide 滞回位）才进相位飞行
    // ——曾 fade 型传送 tick 即跑伺服+spawnAlpha+=20 = 相位早启动一拍
    if (teleported) {
      fly(e);
      return;
    }
    // ★BJ-C10 F3：相位支清湿（原版 :65053 wet=false,门 :65049-65052 之后）——AI 先于
    // 液体碰撞步跑,浸水相位时同 tick WetCollision 重置湿位 → 每湿出入水去抖周期
    // 重播溅花（原版本相）;曾漏写 = 相位中湿位钉死
    e.wet = false;
    // 穿墙飞行（原版 :65049 门后 :65062-65168）：水平 Lerp 朝目标 + 三档垂直伺服
    if (W107_PORTAL_FADE.has(id) && e.spawnAlpha < 60) e.spawnAlpha += 20;   // :65054-65059
    if (phase) x[3] = 40;   // ★BJ542 :65060 localAI[3]=40f 钉值——相位期间把出生爬坡计数
                            // 钉回 40，出生渐显块（x[3]<60 门）保持活臂 → 相位结束后 α 以
                            // 5/t 回落归零（原版相位幽灵态=暂态）；曾缺钉 → x[3] 爬过 60 后
                            // 渐显块永久失活，首相位后 α 恒 60 微透明不复原（判别 tests/bj542）
    const wasGrounded = e.vy === 0;
    if (tgt && Math.abs(tgt.cx - e.cx) > 200) {
      e.facing = sign(tgt.cx - e.cx);
      e.vx = lerp(e.vx, e.facing, 0.05);   // :64860-64864
    }
    const below = tgt ? e.y + e.h < tgt.y + tgt.h - 16 : false;
    if (below) {
      e.vy += 0.5;                         // 目标在下方 → 直坠（:64869-64876）
    } else {
      // ★BJ356 勘误：上升探针 = Collision.SolidCollision((Center.X−40, position.Y), 80,
      //  height)（:64880-64881 vector14/num71/num72）= 80×h 【体盒整扫】——曾只探
      //  左上一格 (cx−40, top),埋身而顶格悬空时永不判实心 → 伺服失稳持续下坠
      let bodySolid = false;
      {
        const st = game.world.store;
        const bx0 = Math.floor((e.cx - 40) / TILE), bx1 = Math.floor((e.cx + 40 - 0.01) / TILE);
        const by0 = Math.floor(e.y / TILE), by1 = Math.floor((e.y + e.h - 0.01) / TILE);
        outer: for (let tx = bx0; tx <= bx1; tx++) {
          for (let ty = by0; ty <= by1; ty++) {
            if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) { bodySolid = true; break outer; }
          }
        }
      }
      const probeSolid = bodySolid
        || (tgt && (tgt.cy - e.cy < -100
          || (tgt.cy - e.cy < 10 && Math.abs(tgt.cx - e.cx) < 60)));
      if (tgt && probeSolid) {
        if (e.vy > 0) e.vy = 0;
        e.vy -= e.vy > -0.2 ? 0.025 : 0.2; // 贴地/悬停伺服（:64877-64894）
        if (e.vy < -4) e.vy = -4;
      } else {
        if (e.vy < 0) e.vy = 0;
        e.vy += e.vy < 0.1 ? 0.025 : 0.5;  // 落回伺服（:64896-64909）
      }
    }
    if (e.vy > 10) e.vy = 10;
    if (wasGrounded) e.vy = 0;             // :64915-64918
    fly(e);
    return;
  }
  // ---- 常规:台阶 + 跳梯（StepUp/跳梯 :64703-64832）——★先于公共重力：原版跳梯
  //      在 AI 内以 velocity.Y==0（上一拍碰撞后）判贴地，公共重力 :91519-91525 在
  //      AI 之后才加——曾把重力提到梯前（vy=0.3 → 贴地扫描恒假）= 跳梯/卡死跳
  //      全灭死代码（R6-B 5-2 修）----
  {
    const st = game.world.store;
    const solidAtT = (tx: number, ty: number): boolean =>
      st.inBounds(tx, ty) && st.isSolid(tx, ty);
    const dirX = e.facing;
    // 台阶步升（Collision.StepUp 近似,同 chargerAI:前方高差 ≤16.1 直接抬升）
    const vxSign = sign(e.vx);
    if (e.vy >= 0 && vxSign !== 0) {
      const ax = Math.floor((e.x + e.vx + e.w / 2 + (e.w / 2 + 1) * vxSign) / TILE);
      const fr = Math.floor((e.y + e.h - 1) / TILE);
      if (ax >= 0 && fr >= 2 && ax < st.w && fr < st.h
        && solidAtT(ax, fr) && !st.half[st.idx(ax, fr)]
        && !solidAtT(ax, fr - 1) && !solidAtT(ax, fr - 2) && !solidAtT(ax, fr - 3)) {
        const rise = e.y + e.h - fr * TILE;
        if (rise > 0 && rise <= 16.1) e.y = fr * TILE - e.h;
      }
    }
    // 跳梯（cs:64711-64832,flag32 = 落地且脚下实心;num26 = width/2+6 探针）
    let grounded = false;
    if (e.vy === 0) {
      const row = Math.floor((e.y + e.h + 7) / TILE);
      const l = Math.floor(e.x / TILE), r = Math.floor((e.x + e.w) / TILE);
      for (let tx = l; tx <= r && !grounded; tx++) {
        if (solidAtT(clamp(tx, 0, st.w - 1), clamp(row, 0, st.h - 1))) grounded = true;
      }
    }
    if (grounded && e.vx * e.facing > 0) {
      const num26 = e.w / 2 + 6;                       // :63463（食人魔 -32,:63517 已按体宽体现）
      const px = Math.floor((e.cx + num26 * dirX) / TILE);
      const py = Math.floor((e.y + e.h - 15) / TILE);
      const flag36 = e.y + e.h - py * TILE > 20;
      const t1 = solidAtT(px + dirX, py + 1), t2 = solidAtT(px, py + 1);
      const t3 = solidAtT(px, py), t4 = solidAtT(px, py - 1);
      const t5 = solidAtT(px, py - 2), t6 = solidAtT(px, py - 3);
      if (e.h >= 32 && t5) {                          // 3 格墙大跳（:64797-64805）
        e.vy = t6 ? -8 : -7;
      } else if (t4) {                                // 1 格台阶小跳（:64806-64810）
        e.vy = -6;
      } else if (flag36 && t3) {                      // 坡/半格（:64811-64815）
        e.vy = -5;
      } else if (e.dirY < 0 && !t2 && !t1) {          // 悬崖前跃（flag25,:64816-64821）
        e.vx *= 1.5;
        e.vy = -8;
      }
      // 卡死小跳（R6-B 5-2，:65030-65034）：flag（tick 初 vx==vy==0 且未受击，
      // :63614）+ 卡死计数恰 1 → vy=-5——与 AI_003 同款时序差活分支（flag 在 tick
      // 初取零速、本段在走路加速后评估）
      if (e.vy === 0 && flag107Stuck && e.ai3 === 1) e.vy = -5;
    }
  }
  e.vy = Math.min(e.vy + 0.3, 10);          // 公共重力（:91519-91525，AI 后）
  const preX = e.x;
  oldVel.set(e, { x: e.vx, y: e.vy });
  moveAndCollide(e, game.world, e.vx, e.vy);
  if (e.hitWall) e.vx = 0;
  if (e.onGround || e.hitHead) e.vy = 0;
  if (Math.abs(e.x - preX) < 0.01) w107NoMove.add(e); else w107NoMove.delete(e);
}

// ---------------------------------------------------------------------------
// 681 哥布林炸弹（ProjectileID.cs:1722;SetDefaults 1457 :7265-7273 aiStyle 16/
//   14×14/hostile/penetrate -1/ranged;引信 600=:11071 NewProjectile 后置表,SW-Q1）。
//   AI_016 引信族物理同 WeaponProj.GrenadeProj（重力门 5 拍 + 0.2、撞墙 ×-0.4 反弹、
//   落地摩擦 0.97、接触熔断 3t）;专支尾焰尘 6 每 tick（:48324-48330,SW-Q1）;
//   Kill :73136-73216 = 80² 伤害盒 + DD2_GoblinBomb 音 + 尘爆（旧注 :68638-68696
//   系 1456 行号）。敌对弹:爆盒伤玩家与永恒水晶 548。
// ---------------------------------------------------------------------------
export class DD2GoblinBomb extends Entity {
  w = 14; h = 14;
  vx: number;
  vy: number;
  damage: number;
  dead = false;
  private fuse: number;
  private rot = 0;
  private cxPx = 0; private cyPx = 0;
  /** SW-Q1 2026-09-03：ai[0]（AI_016 :48332 每 tick +1）——重力门节拍轴 */
  private ai0 = 0;
  /** ★BJ294 敌射侧拒割位：681 DD2GoblinBomb SetDefaults hostile（P.cs:7265-73）→
   *  原版 CutTiles 调用点 friendly 门（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;
  /** 引信嘶声循环句柄（:47780 PlayTrackedLoopedSound;Kill Stop——同 GrenadeProj） */
  private fuseSnd: { stop(): void; setPos(px: number, py: number): void } | null | undefined;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1;溅花
  //  尘/音由共享体 wetSplashStepShared 承载,本类不自写）----
  //  豁免核对：681 DD2GoblinBomb SetDefaults P.cs:7265-7273（14×14/aiStyle 16/
  //  hostile/penetrate −1/ranged）【无】ignoreWater 行 → 受段（数据面
  //  PROJ_IGNORE_WATER 亦无 681——姊妹 683 跺地波 :7291 才豁免）。681 ∉
  //  IsDestroyedByWater 六型、非 2/34/80/155 → 各特支钩缺省（IsABombWithFuse[681]
  //  是引信面非湿段面,不相干）。
  //  阻尼适用：tileCollide 缺省 true → HandleMovement 湿支 :17721-17764 跑
  //  （wetVelocity = velocity×档,UpdatePosition :20557 消费）;aiStyle 16 不在
  //  UpdatePosition 早退表（:20551）。速度场（vx/vy,含重力加算/落地摩擦）不减,
  //  只削当拍位移;撞墙/落地反弹式（×−0.4/驻停）读未阻尼速度场 = 原版 lastVelocity
  //  :17696 同构（GrenadeProj 同批同口径）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112 逐子步 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价——首拍同位测值） */
  presetDone = false;

  constructor(x: number, y: number, vx: number, vy: number, dmg: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.damage = dmg;
    // SW-Q1 2026-09-03：引信终值 600——NewProjectile 后置表（P.cs:11071-11074
    //   `if (Type == 681) timeLeft = 600`）,非 aiStyle16 缺省 180（旧注误,炸药师
    //   投弹手 42t 循环出手,600 引信=落地后长时间待爆的原版节奏）
    this.fuse = 600;
  }
  fixedUpdate(_dt: number, game: GameHooks): void {
    const st = game.world.store;
    // 接触熔断（Projectile.Damage :12330-12340:碰玩家/NPC → timeLeft 钳 3）
    // ★victim-settles：接触判定恒本地玩家（本端玩家碰弹才熔断自己端的引信）
    const pl = game.player;
    if (pl && !pl.dead
      && this.x < pl.x + pl.w && this.x + this.w > pl.x
      && this.y < pl.y + pl.h && this.y + this.h > pl.y && this.fuse > 3) this.fuse = 3;
    // SW-Q1 2026-09-03：爆点对齐原版 AI 头 timeLeft≤3 Kill（P.cs:48034）→ Update 尾
    //   dec（:17307）——post-dec ≤2 ≡ pre-dec ≤3（与 GrenadeProj SW-L1 同式;旧
    //   `<=0` 在接触钳 3 后多滚 2 拍才爆）。引信嘶声循环（AI_016 :47780
    //   IsABombWithFuse[681]=true,timeLeft>1;ProjectileID.cs:277 集）
    if (this.fuse > 1) {
      if (!this.fuseSnd) this.fuseSnd = game.startTrackedLoop?.('bombFuse', 0.2, this.cx, this.cy) ?? null;
      else this.fuseSnd.setPos(this.cx, this.cy);
    }
    if (--this.fuse <= 2) { this.explode(game); return; }
    // 专支尘（AI_016 :48324-48330 逐参 1:1,锚点/尺度纯函数见
    //   goblinBombTrailDustAnchor）：每 tick 恰 1 粒尘 6（681 被通支 :48285 排除
    //   表挡下后落到本支,无概率门）——NewDustDirect(position,w,h,6,0,0,100) 后
    //   scale 绝对赋值 / noGravity / position 整体覆写
    {
      const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 100, null, 1);
      if (d) {
        const a = goblinBombTrailDustAnchor(this.cx, this.cy, this.vx, this.rot, this.h / 2,
          Math.floor(Math.random() * 5));
        d.scale = a.scale;
        d.noGravity = true;
        d.x = a.x;
        d.y = a.y;
      }
    }
    this.rot += this.vx * 0.1;             // 滚动（AI_016 :48404——681 不在滚转排除表）
    // 重力门（:48377 双析取支）：681 列第一析取支名单（ai[0]>10）但第二析取支
    //   排除表漏列 → OR 语义下 ai[0]>5 实际开门（WeaponProj.bombGravityGateOf 同
    //   判,按反编译逐字保留勿"修"）;开门拍起 vy+0.2,落地帧（vy==0&&vx≠0）另
    //   vx×0.97、|vx|<0.01 归零（:48379-48385 唯一摩擦点,自旧落地支迁来防双乘）
    this.ai0 += 1;
    if (this.ai0 > 5) {
      if (this.vy === 0 && this.vx !== 0) {
        this.vx *= 0.97;
        if (this.vx > -0.01 && this.vx < 0.01) this.vx = 0;
      }
      this.vy += 0.2;   // SW-R3 2026-09-03：SW-N1 同案——:48394 恒 +0.2 无终端钳
                        // （仅 911 有 Clamp :48396-48399）;钳 16 为旧近似,随 F-9 顺手清偿
    }
    // ---- ★通用湿段（:16903-17113,projWetSection 共享体 1:1）----
    // 位序 = 原版 Update:AI_016（引信/尘/重力门/滚转完）→ 本段 → HandleMovement
    // （阻尼在下方位移行;反弹式读未阻尼速度场 = lastVelocity :17696 同构）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      681, !!projectileData(681)?.ignoreWater);
    // 水中位移阻尼（HandleMovement :17721-17764 + UpdatePosition :20557-20562）
    // ——速度场（vx/vy）不减只削当拍位移,干态档=1 恒等
    const df681 = projWaterDragFactor(this);
    let nx = this.x + this.vx * df681, ny = this.y + this.vy * df681;
    const solidAtP = (px: number, py: number): boolean => {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      return st.inBounds(tx, ty) && st.isSolid(tx, ty);
    };
    if (solidAtP(nx + this.w / 2, this.y + this.h / 2)
      || solidAtP(nx + this.w / 2, this.y + this.h - 1)) {
      // ★BJ252 撞块引信钳（HandleMovement :18625-18628 `type == 681 → timeLeft=4`
      //  型别支——先于 aiStyle 16 通用反弹（:19872 区）截走,1456:17102/1458:18626
      //  同文；曾误走 ×−0.4 反弹档=锚到 aiStyle16 支的 1456 行号,681 从不可达）：
      //  轴停（TileCollision 截断面,弹反支不可达=无反弹）+ timeLeft=4 → 尾 dec
      //  (:17307)→3 → 下拍 AI 头 Kill 门（:48033 `timeLeft <= 3`,owner=myPlayer）
      //  ——本仓 fuse 语义（dec 后 ≤2 爆,接触钳 3 同式）→ fuse=3 ≙ 下拍爆。
      this.vx = 0; nx = this.x;
      if (this.fuse > 3) this.fuse = 3;
    }
    if (solidAtP(nx + this.w / 2, ny + this.h - 1)) {
      // 落地同支（:18625 同一撞块事件,竖撞臂——轴停 + 引信钳,无反弹）
      this.vy = 0;
      ny = this.y;
      if (this.fuse > 3) this.fuse = 3;
    }
    this.x = nx; this.y = ny;
    if (!st.inBounds(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE))) this.dead = true;
  }
  destroy(): void {
    this.fuseSnd?.stop();                  // Kill :67373-67377 GetActiveSound?.Stop()
    this.fuseSnd = null;
  }
  /** Kill :68638-68696：80² 爆盒 + 尘爆 + 音效 */
  private explode(game: GameHooks): void {
    this.dead = true;
    this.destroy();
    game.onProjectileDeath?.(681, this.x, this.y, this.w, this.h);
    // SW-S1 2026-09-04（清偿②）：Kill :73139 音 = SoundID.DD2_GoblinBomb——
    //  SoundID.cs:840 `new LegacySoundStyle(2, 14).WithVolume(0.5f)` = 与 Item14
    //  （:442 `new LegacySoundStyle(2, 14)`）【同一 legacy 银行 cue 14】,差异仅在
    //  音量 0.5（无独立 xnb/wav 素材,863 wav 全集亦无 dd2_goblinbomb 条目）→
    //  本仓 'explosion' 通道（Item_14.wav）即正确音源,补 0.5 音量即 1:1
    game.playSfx('explosion', 0.5, this.cx, this.cy);
    // SW-R3 2026-09-03（F-9）：Kill :73136-73216 原版尘引擎逐参（替换 spawnParticles
    //  合成粒——旧 14+10 粒画在光照合成前被压暗,且无 fadeIn/gore 面）：
    //  先盒 80² 收心 → Resize(22,22) 视觉盒（:73137-73144,盒左上角=Center−(11,11)）：
    //   · 尘 31×10 scale1.5 alpha100 vel×1.4（:73147-73151）
    //   · 尘 6×10 scale1.5 alpha100 noGravity fadeIn2 vel×1.4（:73152-73157）
    //   · 尘 6×10 scale2.5 alpha100 noGravity vel×5（:73158-73163）
    //   · 尘 6×10 scale1.5 alpha100 vel×3（:73164-73169）——计 40 粒
    //   · gore 61-63 ×4 恒出（:73170-73196）：vel×0.4 后四向对角 ±1（原序 ++/−+/+−/−−）
    //  音=DD2_GoblinBomb（:73139）——本仓 'explosion' 通道承载（F-9 仅视觉,音面不动）
    {
      const vd = game.vanillaDust;
      if (vd) {
        const vx0 = this.cx - 11, vy0 = this.cy - 11, bs = 22;
        for (let i = 0; i < 10; i++) {
          const d1 = vd.spawn(vx0, vy0, bs, bs, 31, 0, 0, 100, null, 1.5);
          if (d1) { d1.vx *= 1.4; d1.vy *= 1.4; }
          const d2 = vd.spawn(vx0, vy0, bs, bs, 6, 0, 0, 100, null, 1.5);
          if (d2) { d2.noGravity = true; d2.fadeIn = 2; d2.vx *= 1.4; d2.vy *= 1.4; }
        }
        for (let i = 0; i < 10; i++) {
          const d1 = vd.spawn(vx0, vy0, bs, bs, 6, 0, 0, 100, null, 2.5);
          if (d1) { d1.noGravity = true; d1.vx *= 5; d1.vy *= 5; }
          const d2 = vd.spawn(vx0, vy0, bs, bs, 6, 0, 0, 100, null, 1.5);
          if (d2) { d2.vx *= 3; d2.vy *= 3; }
        }
      }
      for (let gi = 0; gi < 4; gi++) {
        const sgnX = gi % 2 === 0 ? 1 : -1, sgnY = gi < 2 ? 1 : -1;   // (+,+) (−,+) (+,−) (−,−)
        const g = GorePiece.newGore(61 + (Math.random() * 3 | 0), this.cx - 11, this.cy - 11, 0, 0, 1);
        if (g) { g.vx = g.vx * 0.4 + sgnX; g.vy = g.vy * 0.4 + sgnY; }
      }
    }
    const bx = this.cx - 40, by = this.cy - 40;   // 80×80（:68689-68695）
    // ★victim-settles：爆盒命中恒本地玩家（damagePlayer 只结算本地血）
    const pl = game.player;
    if (pl && !pl.dead
      && pl.x < bx + 80 && pl.x + pl.w > bx && pl.y < by + 80 && pl.y + pl.h > by) {
      // Damage_EVP：projDmg=GetAttackDamage 生成基础值，命中再过乘区×2
      game.damagePlayer(hostileProjectileDamage(this.damage, mainDifficulty(game.world)) * 2, this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: 681 });   // ★R-B-F10(第4=knockback 位,opts 第5)(2026-10-14):弹域双旗点亮(Game.ts damagePlayer :44480 门=projDomain&&projVid;★BJ704-R3 P1:旧单旗=静默 no-op)
    }
    for (const n of game.enemies() as Enemy[]) {
      // 永恒水晶 548 吃敌对爆伤（DD2 敌怪对水晶的伤害通道）
      // ★BJ450:flag2 门（Projectile.cs:12626 friendly && !dontTakeDamageFromHostiles）
      // ——演出期（旗置位）敌对爆伤照拒
      if (n.dead || n.vanillaId !== 548 || n.dontTakeDamageFromHostiles) continue;
      if (n.x < bx + 80 && n.x + n.w > bx && n.y < by + 80 && n.y + n.h > by) {
        n.hurt(this.damage, 0, 0, game);
      }
    }
  }
  draw(r: import('../render/Renderer').Renderer, cam: import('../render/Camera').Camera): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = r.atlas?.ensureVImage('vanilla/Projectile_681.png');
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    ctx.imageSmoothingEnabled = false;
    if (img) {
      // 原生 14×20（SetDefaults 681 仅 14×14 判定盒，scale=1；曾压成 14×14 竖向掐短）。
      // Main.cs:29811 type 681 velocity.X>0 时 ^= FlipHorizontally（贴图默认朝左）;
      // origin (7,13) = (texW/2, h/2+num143=6)（Main.cs:29805 num143=6 + :29856 num145）
      if (this.vx > 0) ctx.scale(-1, 1);
      ctx.drawImage(img, -7, -13, img.width, img.height);
    } else { ctx.fillStyle = '#3A3A3A'; ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h); }
    ctx.restore();
    void cam;
  }
}

// ---------------------------------------------------------------------------
// 683 食人魔跺地波（ProjectileID.cs:1726;SetDefaults :7003+ aiStyle 135/30²/
//   tileCollide=false/ignoreWater）。AI_135_OgreStomp（Projectile.cs:65725-65830）：
//   原地 9t,盒从 16×5=80² 扩到 16×40=640²,每 3t 一波尘爆;伤害走 hostile 盒。
// ---------------------------------------------------------------------------
export class DD2OgreSmash extends Entity {
  w = 80; h = 80;
  dead = false;
  private ai0 = 0;
  private dmg: number;
  private readonly hitIds = new Set<number>();
  /** ★BJ294 敌射侧拒割位：683 DD2OgreSmash SetDefaults hostile（P.cs:7284-95）→
   *  原版 CutTiles 调用点 friendly 门（:12515）整支不进。详 Entity.ts 中央门 BJ294 注。 */
  noVanillaCut = true;

  // ---- ★通用湿段（Projectile.cs:16903-17113,projWetSection.ts 共享体 1:1）----
  //  豁免核对：683 DD2OgreSmash SetDefaults P.cs:7284-7295（30×30/aiStyle 135/
  //  alpha 255/tileCollide=false/ignoreWater=true【:7291】/timeLeft 120/hostile/
  //  penetrate −1）→ 豁免 id,段门恒闭（:16903）= 原版零行为（字段照加、段照调,
  //  豁免分流由 ignoreWater 参数自动承载）。
  //  阻尼不适用（双证）：①豁免;②原地扩盒（AI 每 tick 以 Center 重排盒）,无
  //  velocity 位移宿主。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(x: number, y: number, dmg: number) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.dmg = dmg;
  }
  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113）——683 豁免 id（P.cs:7291 ignoreWater=true）→ 段门
    //  恒闭零行为;插 tick 头与 AI/位移序无观察差（段内唯一可见面=溅花,豁免即恒无）
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      683, !!projectileData(683)?.ignoreWater);
    this.ai0 += 1;
    if (this.ai0 > 9) { this.dead = true; game.onProjectileDeath?.(683, this.x, this.y, this.w, this.h); return; }
    // 扩盒（:65740 Size = 16×lerp(5,40,ai0/9)）
    const size = Math.round(16 * lerp(5, 40, this.ai0 / 9));
    const ncx = this.cx, ncy = this.cy;    // base.Center 保持（:65738-65741 先取心再扩盒）
    this.w = size; this.h = size;
    this.x = ncx - size / 2; this.y = ncy - size / 2;
    // 伤害（hostile 盒:玩家 + 永恒水晶,同弹 id 免疫帧防连击）
    // ★victim-settles：玩家侧恒本地玩家（damagePlayer 只结算本地血）
    const pl = game.player;
    if (pl && !pl.dead
      && pl.x < this.x + this.w && pl.x + pl.w > this.x
      && pl.y < this.y + this.h && pl.y + pl.h > this.y) {
      // Damage_EVP：projDmg 生成基础值
      game.damagePlayer(hostileProjectileDamage(this.dmg, mainDifficulty(game.world)) * 2, this.cx, this.cy, undefined, undefined, undefined, undefined, { projDomain: true, projVid: 683 });   // ★R-B-F10(第4=knockback 位,opts 第5)(2026-10-14):弹域双旗点亮(Game.ts damagePlayer :44480 门=projDomain&&projVid;★BJ704-R3 P1:旧单旗=静默 no-op)
    }
    for (const n of game.enemies() as Enemy[]) {
      // ★BJ450:flag2 门（Projectile.cs:12626）——演出期（旗置位）照拒
      if (n.dead || n.vanillaId !== 548 || n.dontTakeDamageFromHostiles) continue;
      if (this.hitIds.has(n.id)) continue;
      if (n.x < this.x + this.w && n.x + n.w > this.x
        && n.y < this.y + this.h && n.y + n.h > this.y) {
        this.hitIds.add(n.id);
        n.hurt(this.dmg, 0, 0, game);
      }
    }
    if (this.ai0 % 3 === 0) {              // 每 3t 尘爆（:65746-65750）
      game.spawnParticles(this.cx + (Math.random() - 0.5) * this.w,
        this.y + this.h - 8, '#B09060', 4, 2.4, { life: 30 });
    }
  }
  draw(r: import('../render/Renderer').Renderer, cam: import('../render/Camera').Camera): void {
    // 原版 683 不绘制本体:SetDefaults alpha=255（Projectile.cs:7003-7012）且 AI_135
    // （:65725-65830）全程不调 alpha → Opacity 恒 0,贴图从不显示;视觉效果只靠
    // 每 3t 的 KillTile 尘爆 + 溅射 gore（:65787-65820）。曾画成随盒扩张的贴图
    // （盒扩到 640² → 巨型方块,双重失真）——移除本体绘制（G11 对账）
    void r;
    void cam;
  }
}
