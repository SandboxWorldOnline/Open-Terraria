// 召唤物实体（R6）：随从（飞行/地面）与哨兵（定点炮台）。
// 原版各随从 aiStyle（62/66/26/121/156/164/197…）行为高度定制（数值=武器 combat 表；
// 上限/驱逐/召回语义取 Player.maxMinions 链）：
//   AI_062 五射手（373/375/407/423/613）+ 963：1:1 逐型速度曲线/归位门/随机射击冷却
//           （1457 Projectile.cs:66067-67166，见 ai62Step/abigailBody 注）
//   flying：其余飞行族悬停玩家侧后环形槽位 → 锁定最近敌俯冲突进（接触伤害+同敌冷却）
//           → >2000px 瞬移回玩家（原版 minion 回收语义）
//   ground ：地面步行族走原版步行链（蜘蛛 390-392 AI_026 flag7 / 吸血蛙 758
//           AI_067 flag2 两结算段见 ai067WalkChase/spiderStep/frogStep 注;
//           沙漠虎 833-835 与海盗 393-395 亦于 2026-08-31 台账批归入正轨——
//           台账批①②,approx-registry「镇民/宠物」⑬）
//           其余残余地面型暂无在册武器命中（通用重力+碰撞追击兜底保留）
//   sentry ：定点（施法点）。aiStyle 53 三族 1:1（初冷 120、射速 60/60/90、扇区炮口）；
//            OOA 四塔（AI_130/134/137/138）与 aiStyle 123（月门/彩虹水晶）各按原版
import { Entity } from './Entity';
import type { GameHooks } from './types';
import type { Player } from './Player';
import { GRAVITY, MAX_FALL_SPEED, TILE } from '../core/constants';
import { gameTickCount } from '../core/GameTime';   // ★BJ704-G1 债①：Main.GameUpdateCount 等价钟（GTW 钟源,BJ330）——idStatic 桶绝对到期
import { visEffectFrames } from './Enemy';   // ★BJ704-G1 债③：Main.timeForVisualEffects（虎 state5 cos 波相位钟;环安全判例=VanillaLiquidRenderer 同式——function 声明,函数体内调用）
import { moveAndCollide } from '../physics/TileCollision';
import { BuffType } from '../stats/Buffs';
import { truncCSf32MulBias } from '../stats/ScaleStats';   // ★BJ661 随从 live 伤两步式（Projectile.cs:16812 (int)((float)od×md+5E-06f)）
import { canHit, canHitLine, solidTileAt } from '../physics/LineOfSight';
import { Arrow, projFrameImg, projFrameCount, projSprite, projFrameSrcRect, empressHslRgb } from './Arrow';
import { dyeChannelsOf, getProjDesiredDyeVid, dyedProjCanvas, type DyeInvSource } from '../data/projDye';
import { auraGlowMaskOf, auraGlowTint, AURA_GLOW_ALPHA, FLAMEBURST_GLOW_MASK, TRAP_GLOW_MASK, flameburstGlowRadius, flameburstGlowTintAlpha, TRAP_GLOW_ALPHA } from '../data/vanillaProjGlow';   // ★BJ625件3 闪电光环哨兵 glow 叠画色式 + ★R15-F1/F2 哨兵辉光数据面
import { projectileWetSection, projWaterDragFactor } from './projWetSection';
import { resolveWhipTagHit, SUMMON_TAG_MUL, darkHarvestChain } from './WhipTag';
import { applyProjStatus } from './projStatus';
import { projDrawOffsetFor } from './WeaponProj';
import { ProjGhostRing, drawProjGhosts, projTrailingMode, xnaColorMulByte, onProjSpriteOverride } from './projGhostTrail';   // ★BJ235 随从残影（533/755/833-835）+★清偿 C1 量化单源/C2 失效钩
import { hslToRgb255 } from '../render/AuroraSky';   // ★BJ650件1：864 辉光色 Main.hslToRgb 直译（:80378,同 projGhostTrail 消费源）
import { ExplosiveTrapBlastProj } from './ExplosiveTrapBlast';   // ★BJ650件4：爆炸机关弹视觉实体（R15-F6 清偿）
import { setTemporaryBubble, clearTemporaryBubble } from '../render/EmoteBubble';
import { hitCritters, hitTownNpcs, townVoodooGateOpen, applyBannerDamageDealt, type TownHitSettle } from './projTargets';
import { damageVarRoll } from '../stats/DamageVar';   // ★BJ716-A（R18-F2，2026-10-25）：随从弹 PVE 面 DamageVar 首掷（Projectile.cs:12970）
import { projectileData } from '../data/vanillaProjectiles';
import { soundTrackFiles } from '../data/vanillaNpcs';
import { laserScan } from './ForbiddenSignProj';   // ★BJ639 批1：642 束长 LaserScan 单源（Collision.cs:4599-4614 1:1）
import { cutTilesBox } from './ProjCutTiles';      // ★BJ639 批1：642 沿束切割（CutTiles :15288 段）
import { segHitsRect } from './bossAI_duke_moonlord';   // ★BJ639 批1：642 线碰撞（Colliding :16029 AABBvLine 等价核）
import { tintedTex } from '../render/StringLine';  // ★BJ639 批1：644 hsl 染色烘焙（BJ-C9 F4 单源）
// DeadCellsMushroomBoiExplosion 编排（L5 批 2026-08-31——随从 owner 权威模拟侧广播补远端）
import { ParticleOrchestraType } from '../net/syncModules';
import { cattivaHitFx, stardustPunchFx } from '../fx/orchestraFx';   // δB B11：捣蛋猫命中六芒簇收编本体（Projectile.cs:14493）+ 星尘拳（:14331）
import { GuessedPlayerIntention } from '../player/IntentionGuesser';   // ★BJ433 帮工意图枚举（GuessedPlayerIntention.cs 1:1）
import { stepAxeCore, stepMineSolidsCore, heldSemantics, DEFAULT_SMART_CURSOR_SETTINGS, type SmartCursorEnv, type HeldSemantics, type Region } from '../player/SmartCursor';   // ★BJ433 帮工寻格（Step_Axe/Step_Pickaxe_MineSolids 导出核）
import { playerCanHitEnemy, canBeChasedBy, rollGolemSentryCrit, noteVanillaProjImmune } from './projTargets';
import { ghostHealProc } from './SpectreSoulProj';   // ★Z1/D1② 2026-10-02：随从域 ghostHeal 白耗/治疗单源补课（:13877-84 通用 on-hit 段）
import { rollVanillaHitCrit } from './proj1457';   // ★BJ492①（2026-10-04）掷率单源（函数声明环=运行时调用安全,BJ489 同惯例）
import { nextVector2Circular } from './SparkleGuitarProj';   // ★BJ517①⑥：Utils.cs:1301-1304 圆盘掷 1:1 单源（无环,SparkleGuitarProj 不引 MinionProj）
import { GorePiece } from './GorePiece';   // ★BJ517⑥：1025 HandleTileCollision gore 级联
import { MOUNT_SETS, playerFullRotationOf } from './Mounts';   // ★BJ518③⑥：fullRotation/PlayerIsHidden 单源（运行时消费,模块环安全——Mounts 不回流 MinionProj）
import { ITEM_DEFS } from '../data/items';
import { globalTimeWrappedHourly } from '../core/GameTime';   // ★BJ330 GTW 单源

import { MushroomBoiExplosionProj, requestMushroomBoiExplosion } from './DeadCellsMushroom';
// ★BJ635：Utils.GetChaseResults 消费面（AI_066_TryInterceptingTarget）——本文件已带
//  1:1 折算单源（台账批⑤ GetChaseResults/solveQuadratic 导出,见下方接口块）,零新增导入。

/** 爆炸烈焰塔三档（3818/3819/3820 → proj 663/665/667，AI_130）：帧 0 待机、
 *  开火动画、第 12t 出火球（弹型/速度/周期/冷却按 FLAMEBURST_TIERS 分层） */
const FLAMEBURST_TOWER = new Set([663, 665, 667]);

/** 通用湿段服务域=1.4.5 新随从八型（红队 R3 定谳）+ 旧受段族十三型（蓝队 K
 *  2026-09-07 移交批接入;逐 id SetDefaults 豁免核对见 MinionProj 字段块头注——
 *  廿一型均无 ignoreWater 行=受段,豁免分流由 projectileData(id).ignoreWater
 *  数据面自动承载）。其余主类 id 本批不接（域外核对面见同注）。 */
const MINION_WET_IDS = new Set([
  1022, 1093, 1094, 1098, 1112, 1113, 1118, 1123,           // R3 八型
  317, 390, 391, 392, 393, 394, 395, 758, 833, 834, 835, 917, 1036,   // 旧受段族
  951,   // 小雪怪（BJ435:8971-8986 SetDefaults 无 ignoreWater 行=受段——旧飞行近似时代漏注册）
  // ★BJ520②：AI_026 尾族受段补注册（SetDefaults 均无 ignoreWater 行=受段;原缺注册
  //  =191-194/266 的 wet/lavaWet 四旗全死面）——岩浆逃逸门 lavaWet 承载激活（:59170）,
  //  附带复活 266 湿浮支（wetAi 此前对该族恒假=死码）与湿阻尼/溅花面（干态零行为差）
  191, 192, 193, 194,   // 俾格米 flag6（SetDefaults :2793-2815）
  266,                  // 宝宝史莱姆（SetDefaults :3518-3528;flag10 外,逃逸门不涉）
]);
/** 弩车三档（AI_134 :65584/1457 :69584）：帧 0 待机、帧 1-5 开火（每 5t）、
 *  开火第 6t（ai[1]==5）出弩箭 680（速 16，T2 套装 21;num2=num6=5,num2 的初值 12 已被
 *  `num2 = num6` 覆写——旧"第12t"是初值误读,2026-08-31 批②修）、25t 结束、
 *  冷却 GetBallistraShotDelay */
const BALLISTA_TOWER = new Set([677, 678, 679]);
/** Utils.AngleLerp（Utils.cs:2154-2172）字面移植——分支结构保留，不做「最短路」化简。
 *  ★F2② 纠偏（2026-09-01）：旧式 `diff 归一化后 cur+diff×amt` 在平局向（两角恰差 π）
 *  与原文分叉——原文 target<cur 支的平局（num−cur == cur−target，严格 `>` 不成立）
 *  落 else 支 `Lerp(cur, target+2π, amt)` = 沿【正方向】经 target+2π 回摆
 *  （d=−π 时走正半周），而 diff 归一化式会取负半周（cur−π·amt）。target>cur 支的
 *  平局同理落 `Lerp(cur, target, amt)` = 正向。⇒ 平局恒正向，非对称语义只能靠
 *  原文分支结构保真。MathHelper.Lerp 展开 = value1+(value2−value1)×amount；
 *  WrapAngle 单次回卷（XNA/MonoGame/FNA 同式）。消费位：AI_134 弩车 rotation
 *  状态机（:69651 待机瞄准 0.08 / :69675 归位 0.05）。 */
function angleLerp134(cur: number, target: number, amt: number): number {
  let angle: number;
  if (target < cur) {
    const num = target + Math.PI * 2;                        // :2158
    angle = (num - cur > cur - target)                       // :2159
      ? cur + (target - cur) * amt
      : cur + (num - cur) * amt;
  } else if (target > cur) {                                 // :2164-2167 相等原样返回
    const num = target - Math.PI * 2;                        // :2168
    angle = (target - cur > cur - num)                       // :2169
      ? cur + (num - cur) * amt
      : cur + (target - cur) * amt;
  } else {
    return cur;
  }
  // MathHelper.WrapAngle：≤π 且 ≥−π 原样；否则单次 ±2π（XNA/MonoGame/FNA 共式）
  if (angle <= Math.PI && angle >= -Math.PI) return angle;
  return angle > Math.PI ? angle - Math.PI * 2 : angle + Math.PI * 2;
}
/** DD2 套装旗标消费位（2026-08-31 批②接线）。原版写入链 =
 *  ballistaPanic（buff 205,Player.cs:11933 读面——SquireT2 受击 AddBuff(205,300) :38526）：
 *  ★GB3（2026-08-31 清零批二波）：population 位补齐——Player.damage 授予端已落地，
 *  经 p.ballistaPanicT>0（Player.cs 300t 窗的字段承载,Player.fixedUpdate 逐拍衰减）
 *  与 p.ballistaPanic 显式位双读面。 */
export interface Dd2SetFlags {
  squireT2: boolean; apprenticeT2: boolean; monkT2: boolean;
  squireT3: boolean; apprenticeT3: boolean; monkT3: boolean; huntressT2: boolean;
  ballistaPanic: boolean;
}
export function dd2SetFlags(playerLike: unknown): Dd2SetFlags {
  const p = playerLike as {
    setSquireT2?: boolean; setApprenticeT2?: boolean; setMonkT2?: boolean;
    setSquireT3?: boolean; setApprenticeT3?: boolean; setMonkT3?: boolean;
    setHuntressT2?: boolean; ballistaPanic?: boolean; ballistaPanicT?: number;
    equipStats?: { summonSet?: { squireT2?: boolean; apprenticeT2?: boolean; monkT2?: boolean;
      squireT3?: boolean; apprenticeT3?: boolean; monkT3?: boolean; huntressT2?: boolean } };
  } | null | undefined;
  const ss = p?.equipStats?.summonSet ?? undefined;
  return {
    squireT2: ss?.squireT2 === true || p?.setSquireT2 === true,
    apprenticeT2: ss?.apprenticeT2 === true || p?.setApprenticeT2 === true,
    monkT2: ss?.monkT2 === true || p?.setMonkT2 === true,
    squireT3: ss?.squireT3 === true || p?.setSquireT3 === true,
    apprenticeT3: ss?.apprenticeT3 === true || p?.setApprenticeT3 === true,
    monkT3: ss?.monkT3 === true || p?.setMonkT3 === true,
    huntressT2: ss?.huntressT2 === true || p?.setHuntressT2 === true,
    // ★GB3 双读面：字段窗(授予端 Player.damage)∪ 显式直连位（测试/GW 直连后备）
    ballistaPanic: (p?.ballistaPanicT ?? 0) > 0 || p?.ballistaPanic === true,
  };
}

/** ★BJ453（2026-10-03）① 弹幕受理面 TryConsumingTimerCrit 消费位形
 *  （Projectile.cs:12928 1:1——`Main.player[owner].TryConsumingTimerCrit(
 *  targetNPC.Hitbox, ref crit)` 在 Damage_PVE_Inner `if (ownedBySomeone)` 段内,
 *  对【一切】玩家弹无条件消费:满蓄（≥1000）或负窗（<0）→ charge 置 −15 + 强制
 *  crit + NightsEdge 编排/尘 228×20;本体 = Player.tryConsumingTimerCrit,近战面
 *  Game.ts:34625/:34756 先例,弹幕面 F11 已接 WeaponProj.hitEnemies/
 *  proj1457.dealContacts/Arrow whipTagShot/VolcanoBlast/meleeOnHitProjs——
 *  随从/哨兵面（Damage_PVE_Inner 同链受理位）本批补齐）。返回 true=本次命中
 *  强制暴击。双 `?.` 形=测试桩无该方法时静默 false（house 弹幕面习语）。 */
function tryConsumeTimerCritOf(owner: Player | null | undefined, game: GameHooks,
  x: number, y: number, w: number, h: number): boolean {
  return (owner as unknown as
    { tryConsumingTimerCrit?: (g: GameHooks, x: number, y: number, w: number, h: number) => boolean }
    | null)?.tryConsumingTimerCrit?.(game, x, y, w, h) ?? false;
}

/** ★BJ453（2026-10-03）② 武僧 T2/T3 强制暴击掷（Projectile.cs:12929-12943 1:1）：
 *  `int num14 = type; if ((uint)(num14 - 688) <= 2u) { if (setMonkT3)
 *  { if (Main.rand.Next(4) == 0) crit = true; } else if (setMonkT2 &&
 *  Main.rand.Next(6) == 0) crit = true; }` —— 688/689/690 = AI_137 闪电光环塔弹
 *  （DD2 武僧杖 MonkStaffA/B/SetDefaults 无类别旗 → 三类掷 :12916-12927 轮不到,
 *  唯一暴击源 = TimerCrit :12928 + 本掷 + 6176 背包 :12962）。(uint) 撇距=负数
 *  回卷,JS 用 `(projId-688)>>>0` 复刻（projId<688 恒假）。装备门 = dd2SetFlags
 *  （vanillaArmorSets '206|203|148'=MonkTier2 / '213|207|156'=MonkTier3 投影;
 *  ArmorSetBonuses MonkTier3 同置 T3+T2(:115-116) → T3 分支先行,1/4 恒压 1/6）。
 *  掷序位次 = 三类掷后 / tag ModifyHit(:12947) 前 / 6176 背包(:12962) 前。 */
export function monkAuraForcedCrit(owner: Player | null | undefined, projId: number): boolean {
  if (((projId - 688) >>> 0) > 2) return false;
  const f = dd2SetFlags(owner);
  if (f.monkT3) return Math.floor(Math.random() * 4) === 0;   // Main.rand.Next(4) == 0
  if (f.monkT2) return Math.floor(Math.random() * 6) === 0;   // Main.rand.Next(6) == 0
  return false;
}

/** GetBallistraShotDelay 1:1（1457 :69720-69736；1456 :65707 同体）：
 *  基础 160 → 侍从 T3 套装 100 → 弩车恐慌（ballistaPanic）60 → 双真 30。
 *  setSquireT3/ballistaPanic 经 dd2SetFlags 读（未穿套装恒 160 档,旗标位 GW 批补） */
function ballistraShotDelayOf(player: object): number {
  const f = dd2SetFlags(player);
  let result = 160;
  if (f.squireT3) result = 100;
  if (f.ballistaPanic) result = 60;
  if (f.ballistaPanic && f.squireT3) result = 30;
  return result;
}
/** 闪电光环三档（AI_137 :65910）：非射击——光环场伤害（宽 ≤999 扫描增长，
 *  localNPCHitCooldown=3）；帧 6 张连续循环 */
const AURA_TOWER = new Set([688, 689, 690]);
/** 爆炸机关三档（AI_138 :66059）：帧 4 张每 12t 连续循环；触发检测每 3t——
 *  中心上方 48px 处 144×144 盒内有敌 → 原地爆炸（proj 694/695/696 等价 AoE），
 *  冷却 GetExplosiveTrapCooldown=90 */
const TRAP_TOWER = new Set([691, 692, 693]);
/** AI_130 三档弹/速度/周期分层（★F5,2026-08-30；case 链 Projectile.cs:69166-69398,
 *  1456 同构 :65194-65350）：
 *  - T1 663：shot 664 / speed num4=12 / 开火帧 num3=12 / cycle num6*num7=24 /
 *    cd num8=80 / 炮口 dy=40（:69171 基值 + :69182）
 *  - T2 665：num8=70(:69230) / num4+=3→15(:69231) / num6=8 / shot 666 / dy=44
 *    （:69233-69234）→ cycle=32
 *  - T3 667：num8=60(:69282) / num4+=6→18(:69283) / num6=8 / shot 668 / dy=46
 *    （:69285-69286）→ cycle=32
 *  （红队主张两处失准登记：dy 三档为 -40/-44/-【46】非 -48；num3=12 是开火帧位
 *   非基伤——弹伤害走 projectile.damage 本体档 NewProjectile(...,damage,...)，
 *   与 dmgOf() 数据源同源，无 tier 化伤害面）
 *  炮口 dy 此前恒 -46、shot 恒 668、speed 恒 9、cycle/cd 恒 T3 值——T1/T2 全错 */
export const FLAMEBURST_TIERS: Record<number, { shot: number; speed: number; cycle: number; cool: number; dy: number }> = {
  663: { shot: 664, speed: 12, cycle: 24, cool: 80, dy: 40 },
  665: { shot: 666, speed: 15, cycle: 32, cool: 70, dy: 44 },
  667: { shot: 668, speed: 18, cycle: 32, cool: 60, dy: 46 },
};

/** AI_137_LightningAura_CanHit（Projectile.cs:71574-71614）1:1：塔顶(+20) 到目标点
 *  的三试视线门——①直线 CanHitLine；②不过则走中点垂直偏移 |v|×0.2 的两段弧线
 *  （先 +π/2 绕行侧，再 −π/2），两段全通才算见着；③目标格本身实心直接 false。
 *  2026-08-30 实体侧对账批补（此前只有单段直线近似）。调用点：
 *  Colliding aiStyle==137 支（Projectile.cs:15888-15897 敌盒中心/敌盒上沿中两点）
 *  与 AI_137 尘/声采样（:70040/:70063）。 */
export function lightningAuraCanHitFrom(
  st: import('../world/TileStore').TileStore,
  fx: number, fy: number, tx: number, ty: number,
): boolean {
  const tIx = Math.floor(tx / TILE), tIy = Math.floor(ty / TILE);
  // ★F3 目标格快退谓词（2026-08-30 实体侧对账批）：原版 = WorldGen.SolidTile(i,j)
  //   （1457 WorldGen.cs:70642-70661 / 1456 :70155 同式）——active && tileSolid &&
  //   !tileSolidTop(平台) && !halfBrick && slope==0 && !inActive，【不含平台族】。
  //   TileStore.isSolid 含平台且出界返回 false（原版未加载 tile==null → true），
  //   平台上目标曾被错拒——改走 LineOfSight.solidTileAt 公共口（同 fullSolid 判定式）
  if (solidTileAt(st, tIx, tIy)) return false;                       // SolidTile(:71577)
  if (canHitLine(st, fx, fy, 0, 0, tx, ty, 0, 0)) return true;        // 直线支(:71581)
  // 弧线参数(:71584-71600)：v = 目标−起点；中点 M=Lerp(起,终,0.5)；
  // 弧点 = M ± SafeNormalize(v,UnitY).RotatedBy(±π/2) × |v| × 0.2
  const vx = tx - fx, vy = ty - fy;
  const vl = Math.hypot(vx, vy) || 1;
  let nx = vx / vl, ny = vy / vl;                                     // SafeNormalize 默认 UnitY
  if (vx === 0 && vy === 0) { nx = 0; ny = 1; }
  const mx = (fx + tx) / 2, my = (fy + ty) / 2;
  const off = vl * 0.2;
  for (const s of [1, -1]) {                                          // RotatedBy(±π/2)
    const px = mx - ny * s * off;                                     // (nx,ny) 转 ±90°
    const py = my + nx * s * off;
    if (!canHitLine(st, fx, fy, 0, 0, px, py, 0, 0)) continue;
    if (canHitLine(st, px, py, 0, 0, tx, ty, 0, 0)) return true;
  }
  return false;
}
/** AI_130/AI_134 FindTarget 的角度/朝向门族（2026-08-31 批①②「未接」账清偿）：
 *  - angleRatioMax（AI_130，Projectile.cs:69434/:69456 消费式逐字）
 *      `!(Math.Abs(v.X) < Math.Abs(v.Y) * ratio)` 不满足即拒——ratio=1 默认（:69166）,
 *      学徒 T2 套装置 0.1（:69332 垂直覆盖大幅放宽）
 *  - deadBottomAngle（AI_134，:69481/:69503）：`(|vX| < |vY|·dba) 且 vY>0` 的
 *      陡下锥内候选拒（0.75,:69580）;上方目标恒通过
 *  - directionLock：AI_130 第二调用点 canChangeDirection=false（:69391 实参;首轮 :69375 缺省——★F8 校准）——
 *      `(float)direction * v.X < 0f` 即正后方候选跳过（开火帧不再回头转向;
 *      门不过 → 调用侧回落 (direction,0) 直射）。第一调用点 :69376 可换向=无此门 */
export interface TowerAimGate {
  angleRatioMax?: number;
  deadBottomAngle?: number;
  /** 存现值 direction（±1）；undefined = canChangeDirection=true 无门 */
  directionLock?: number;
}

/**
 * SafeNormalize 兜底 UnitY 后的方向门判定（FindTarget 内联式 1:1）。
 * @param dxNorm 归一化 vX（零向量时传 0）
 * @param dyNorm 归一化 vY（零向量时传 1——SafeNormalize(fallback UnitY)）
 * @returns false = 该候选被门拒（等价原版 && 短路失败）
 * @pure 可独立测钉
 */
export function towerAimGate(dxNorm: number, dyNorm: number,
  gate: TowerAimGate | undefined): boolean {
  if (!gate) return true;
  if (gate.angleRatioMax !== undefined) {
    //（:69434/:69456）|vX| < |vY|*ratio → 拒
    if (Math.abs(dxNorm) < Math.abs(dyNorm) * gate.angleRatioMax) return false;
  }
  if (gate.deadBottomAngle !== undefined) {
    //（:69481/:69503）接受式 = (!(|vX|<|vY|·dba) || !(vY>0)) ⇒ 反之拒
    if (Math.abs(dxNorm) < Math.abs(dyNorm) * gate.deadBottomAngle && dyNorm > 0) return false;
  }
  if (gate.directionLock !== undefined) {
    //（:69456 经 :69391 实参展开）direction*vX < 0 → 拒
    if ((gate.directionLock as number) * dxNorm < 0) return false;
  }
  return true;
}

/** 随从帧循环表（源码提取，Projectile.cs 各 AI 内 frameCounter 规则）：
 *  [每帧 tick, 循环帧数, 攻击帧偏移]。375 小鬼攻击中 +4（ai[1]<24 → 真攻击帧）；
 *  未列入的家族（758 吸血蛙 24 帧/951 雪怪 12 帧/1022 蘑菇 16 帧/
 *  191 矮人 18 帧/393 海盗 15 帧/864 刃 2 帧/946 棱镜 1 帧）帧语义复杂或单帧，
 *  走 age/8 匀速循环兜底。★1093/1112/1118 猫族不在此表也不走兜底——
 *  palGroundStep 专属帧机直写（age/8 兜底会扫到 28 帧表的 14-27 白姿 hurt 带） */
const MINION_FRAMES: Record<number, [number, number, number]> = {
  373: [2, 3, 0],   // 黄蜂：fc>1 → frame++，cap 2
  375: [5, 4, 4],   // 小鬼：fc/5 帧 0-3，攻击中 +4
  407: [2, 6, 0],   // 蜘蛛：fc/2，6 帧循环
  423: [3, 4, 0],  613: [3, 4, 0], // 暴风雨/星尘细胞
  // ★BJ517③：266 移出（匀速 5t×8 帧循环近似退役）——原版分相帧机
  //  （AI_026 :65464-65500 空中 5t 循环 1-7/地面 8t 0·5·6·7 + 返程 :62434-62444
  //  6t 循环 8-11）由 ai026TailGround 内联直写 sl266Frame,draw 走 266 专支
  317: [5, 4, 0],   // 乌鸦：fc≥4 → frame++，frame>3 → 0
  387: [4, 3, 0],  388: [4, 3, 0], // 双子眼球：fc>3 → frame++，cap 2（:30587-30595;projFrames[387]=3
                                   //  Main.cs:8664——★BJ635：388 冲刺态 2t 快循环由 twFrame 通道覆写）
  // ★BJ635：533 移出（原 [2,3,0] 三帧近似与原版状态帧机相悖——AI_066 533 帧=
  //  ai[0] 三态分相（待机 4+fc/4·归位 14+fc/8·攻击闪 17+fc/3 wrap :30596-30620）/
  //  蓄力 num533 表（:30190-30215）/ 冲刺定帧 5/13/17（:30245-30262）;projFrames[533]=21
  //  Main.cs:8686）→ dFrame 通道直写（deadlySpherePhase 维护,draw 支消费）
  // ★BJ684（2026-10-15 用户实报「单只蝙蝠贴图不对」主凶定谳）：AI_156_BatOfLight
  //  755 支帧机（Projectile.cs:52431-52438）`if (++frameCounter >= 6) { fc=0;
  //  if (++frame >= Main.projFrames[type] - 1) frame = 0; }`——projFrames[755]=5
  //  （Main.cs:8644）→ 循环域 0-3【四帧】,帧 4 永不显示（贴图 Projectile_755.png
  //  44×160 实测：帧 0=240px 翅展全/1=124px 中拍/2=200px 下拍/3=124px（=帧 1 复制）
  //  /4=仅 76px 的 8×12 小团残片——旧 [6,5,0] 每周期 1/5 时间显示该小团帧=「蝙蝠
  //  缩成一团贴图不对」）。759 同形交叉验证（AI_158 :49646-49656 同 `++frame>=
  //  projFrames-1`,projFrames[759]=5 → [6,4,0] 表既有）。
  755: [6, 4, 0],   // 血红杖：fc≥6 循环 0-3（帧 4 小团残片永不显示）
  643: [3, 8, 0],   // ★BJ635：彩虹水晶塔 3t 帧循环（AI_123 :37787-37793 fc≥3 推帧
                    //  cap projFrames[643]=8 Main.cs:8615——BJ632 登记「643 3t 帧循环」
                    //  债清偿;641 月门 projFrames=1 静态不入表）
  759: [6, 4, 0],   // 雀杖：fc≥6，cap projFrames-1=4
  831: [4, 6, 0],   // 沙漠虎：fc≥4，frame≥6 → 0
  970: [4, 6, 0],   // 阿比盖尔：fc≥4，frame≥6 → 0
  // ★BJ516⑤：1025 移出（原「慢循环」与原版帧档相悖——AI_197 :41121-41130
  //  悬浮 3/吸顶 0-2 随机黏着,走 sAttach/sFrame 通道,见 draw 帧选支）
};

/** 朝向语义表（原版 spriteDirection/rotation 真值，2026-08-17 镜像修复批）：
 *  - AI62_LEFT_ART：AI_062（:62983-62990）velocity.X>0 → spriteDirection=-1
 *    ——贴图朝左、右行才翻转 → facing=-sign(vx)（曾误 facing=sign(vx) 全族镜像）
 *  - MINION_NO_FLIP：AI_026/AI_164 零 spriteDirection 赋值（俾格米191-194/
 *    宝宝史莱姆266/蜘蛛313·379·390·391/计数器831·970）恒不翻转。
 *    1094 Foxparks 已移出（2026-08-22）：flag8=1094 有专属赋值——喷火态
 *    Projectile.cs:56111-56120 spriteDirection=(velocity.X>0?1:-1) 再取反、
 *    跟随态 :57698 spriteDirection=player.direction——按 velocity 翻转
 *  - MINION_ROT_ONLY：旋转制不与翻转叠用（原版 dir 恒 None）——双子387/388
 *    （vel+π）、致命球533、雪花917、龙链625-628、同伴方块653。
 *    表外设 rot 的族（AI_062 :66827 / 乌鸦 :27542 / 蜘蛛爬墙 :65122）原版 rotation 与
 *    spriteDirection 【叠】用（XNA SpriteBatch 同 draw 调用,Main.cs:30529-30533 dir +
 *    rotation 复合=顶点先镜像再旋转）——draw 侧 rotate 后补 scale(-1,1)（2026-08-23） */
/** ★BJ515 债②：AI_156 blackListedTargets 1:1 载体（Projectile.cs:513-521
 *  `_ai156_blacklistedTargets` static 表等位）。定谳（三代亲读）：1457 填充函数
 *  AI_GetMyGroupIndexAndFillBlackList（:52809-52825）只算 index/totalIndexesInGroup,
 *  【零 .Add】——1405（:20333 同名函数）/1456（:48973）逐代同形,表自 1.4.0.5 起即
 *  结构性恒空;消费点 :52776（焦点 `!boss && Contains`）/ :52796（野生
 *  `boss || !Contains`）为死谓词。建模 = 每拍 Clear（:52473）+ 死谓词门原形在位,
 *  未来若反编译刷新出真实填充源,本表位即承接（变异面：填充即翻红）。 */
export const AI156_BLACKLIST: number[] = [];

/** ★BJ515 债⑤：AI_026 通用尾双轨索敌消费面（Projectile.cs AI_026 :59085）。
 *  TAIL=走尾面的 id（flag10 段 :62598-62766 = flag6 191-194 ∪ flag8 1094/1113;
 *  266 段 :62771-62850 = `(type == 266) | flag7 390-392`,390-392 已在 spiderStep
 *  1:1 不走本面）;LEAD=flag10 野生支速度前导 ×20（:62645-62646/:62651-62652
 *  num142——266 段无前导 :62830-62838 瞄准=敌心本值）。 */
const AI_026_TAIL_IDS = new Set([191, 192, 193, 194, 266, 1094, 1113]);
const AI_026_LEAD_IDS = new Set([191, 192, 193, 194, 1094, 1113]);

const AI62_LEFT_ART = new Set([373, 375, 407, 423, 613]);
/** AI_062 射手族（SetDefaults aiStyle=62 全表 :4295/:4319/:4610/:4692/:6324/:8829，
 *  963 阿比盖尔另档）——索敌射程/视线门分档用（1456 :62362-62375） */
const AI62_SHOOTERS = new Set([373, 375, 407, 423, 613]);
/** AI_062 索敌距门以【玩家中心】为基准的分支（1457 :66361-66402
 *  `Vector2 center = Main.player[owner].Center` + :66391/:66374 距离测该点——
 *  1456 :62416/:62433 同段；其余 373/375/963 走 :66431 `base.Center`=随从基准） */
const AI62_PLAYER_TARGETING = new Set([407, 423, 613]);
/** AI_026 零 spriteDirection 赋值族(2026-08-19 补漏;1094 移出:56111)。390-392 蜘蛛
 *  已移出（2026-08-23 撤退批）：AI_026 共享赋值 `if (type != 313)` 蜘蛛在列
 *  （:63316-63323 direction==-1→1/==1→-1）+ flag7 专属 :65166 `spriteDirection=-direction`
 *  ——走行按 direction 翻转;313 是唯一豁免（原版字面）维持不翻。
 *  ★BJ517⑤（2026-10-05）：191-194/266 摘出翻案——三代亲读定谳「零赋值」系误判
 *  （1457 :63319-63329 共享赋值 `if (type != 313)` 明列两族 sd=−direction,与蜘蛛
 *  2026-08-23 同谳;2026-08-19 批判据「零赋值」不成立于 1457 盘上源码）——绘制翻转
 *  走 a026SpriteDir（AI 侧 facing=direction 仍保持,:12437 探针/num143/144 dir 消费
 *  不反）。313（原版字面豁免）/379/831/970/112/959/1003/1004/1095/1096 维持 */
const MINION_NO_FLIP = new Set([313, 379, 831, 970,
  112, 959, 1003, 1004, 1095, 1096]);
const MINION_ROT_ONLY = new Set([387, 388, 533, 917, 625, 626, 627, 628, 653]);

/** ★SW-BJ13 2026-09-07：原版专绘支家族（Main.cs:34788 分支谓词投影到本仓实体域——
 *  398/450 原版同支但本仓无 MinionProj 实体域,余九型全接）。这些型的 draw 锚 =
 *  帧心@「盒心+(0,−num467)」、origin=(整图宽/2, 帧高/2+num151),【不走】通用
 *  num143/144 尾绘的盒左上锚（分支锚/origin 见 draw 支注 Main.cs:34788-34800）。
 *  WeaponProj.PROJ_DRAW_OFFSET 静态表的 1022/1036/423 三项已随本批退役（表值是
 *  :30077 switch 真值,但本支原版只消费 num151——经通用路消费即错锚）。 */
const CENTER_ANCHOR_34788 = new Set([393, 394, 395, 423, 1022, 1036, 1093, 1112, 1118]);

/** ★SW-BJ16 2026-09-07：Main.cs:33693 中心锚大支（本仓 MinionProj 域成员投影）。
 *  原版本支锚 = proj.Center + (0, gfxOffY)（:33694-33695 vector99）、帧矩形 =
 *  Frame(1, projFrames, 0, frame)（:33701）、origin = 帧尺寸/2（:33787 origin32）、
 *  主绘 :34212——即「帧心锚于盒心」。这些型不走通用 num143/144 尾绘
 *  （:34919 多帧/:35470 单帧 = 帧左上锚盒左上,本仓通用路语义）；本仓通用路对
 *  未登记型吃 [0,0] 缺省 = 帧左上锚盒左上 ⇒ 精灵整体偏右下（758 曾 +58/951 类）。
 *  支内改锚/改切片特例【不在集合表达内】,由 draw 支逐型消费（:33951 773 origin.Y=
 *  帧高−12 / :33959 759 origin=(帧宽/2±1, 帧高−2) / :33964 758 锚 Y+=盒高/2+
 *  origin=(帧宽/2, 帧高−4) / :33836 963 切片 Frame(4,13,0,frame)+锚 Y−2 /
 *  :33771 1098·1123 锚 Y−2 / :33942 951 锚=盒底−帧高/2+4 / :34169 623 ai0==2 抖动）。
 *  家族全表（含 WeaponProj 773 / BookProj 1092 域外成员与 A 支 641 债）=
 *  docs/audit/summon-draw-branch-registry-2026-09-07.md,提取器 =
 *  tools/extract-draw-branch-families.mjs（解析 Main.cs 分派条件→vid 集）。
 *  守卫测试 = tests/sw-bj16-draw-branch-guard.test.ts（新增召唤物未查分支表即爆红）。 */
const CENTER_ANCHOR_33703 = new Set([613, 623, 625, 626, 627, 628, 643, 758, 759, 831, 951, 963, 970, 1098, 1119, 1123]);

/** 接触击退【玩家锚】方向族（Projectile.cs:13652-13660 switch,StrikeNPC num40 消费
 *  :13683）：697/699/707/708/759 原版既有 + ★1458 新增 1118 Clay Bud——击退方向 =
 *  玩家→敌（"always knocks enemies away from the player"）,非随从→敌 */
const MINION_PLAYER_ANCHOR_KB = new Set([697, 699, 707, 708, 759, 1118]);

/** =====================================================================
 *  ★台账批③（2026-08-31,docs/audit/approx-registry「镇民/宠物」项③）：
 *  接触冷却家族化——原版 Projectile.localNPCHitCooldown 缺省 -2（Projectile.cs:466,
 *  SetDefaults 每次重置 :714），三类语义：
 *   · `-2`（缺省,未覆写型）：Damage_PVE_Inner :12636 immune[owner]==0 门生效 +
 *     命中尾 :14175 分支全跳过 → 尾支 :14182（penetrate≠1）写 targetNPC.immune[owner]
 *     =10 ——【吃玩家全局免工件窗】：同玩家全部来源共享该 NPC 的 10t 窗。
 *   · `local`：SetDefaults 显式 usesLocalNPCImmunity=true + localNPCHitCooldown=N ——
 *     每弹每敌私表 N t。
 *   · `idStatic`：usesIDStaticNPCImmunity=true + idStaticNPCHitCooldown=N（immunityIdentity
 *     =type :10682）——同型全体弹共享按敌的 N t 表。
 *  下表逐型取 Terarria1458 SetDefaults 实值（行号=块首）；未列入随从 = '-2' 全局窗支。
 * ===================================================================== */
export const CONTACT_PLAYER_WINDOW = -2;
/** number = 局部私表 t（CONTACT_PLAYER_WINDOW=-2 特指全局窗支）;对象 = idStatic 同型桶 */
export interface IdStaticContact { kind: 'idStatic'; cd: number }
export type ContactCd = number | IdStaticContact;

/** local/idStatic 逐型表（1458 SetDefaults 行号锚）：数值=local 私表 t；
 *  {kind:'idStatic'}=同型共享桶。'-2' 缺省族不入表。 */
const CONTACT_CD_TABLE: Record<number, ContactCd> = {
  266: { kind: 'idStatic', cd: 12 },   // 宝宝史莱姆（:3527 usesIDStatic）
  317: 10,                             // 乌鸦（:4110）
  387: { kind: 'idStatic', cd: 16 },   // 双子激光眼（:4714,曾专用恒 20 迁表）
  388: { kind: 'idStatic', cd: 12 },   // 痉挛眼（:4730）
  390: { kind: 'idStatic', cd: 15 },   // 蜘蛛三变体共块（:4754——旧统一 20t → 正轨）
  391: { kind: 'idStatic', cd: 15 },
  392: { kind: 'idStatic', cd: 15 },
  393: 18,                             // 海盗三变体共块（:4765-4770——扑击窗接触伤,local 私表）
  394: 18,
  395: 18,
  407: { kind: 'idStatic', cd: 10 },   // 暴风雨鲨卷（:4893,旧统一 20t → 正轨）
  533: 12,                             // 致命球（:6008,旧统一 20t → 正轨）
  623: 5,                              // 星尘守护者（:6713;专段内已用 5 表存照）
  625: 7,                              // 龙链四段共块（:6756——JS 侧以全链共用 hitCd 实例承载）
  626: 7,
  627: 7,
  628: 7,
  697: 12,                             // OOA 支线塔/伴生弹族（哨兵端在途消费）
  688: 3,                              // 闪电光环（:7339,AURA 直伤通道专用表同值）
  689: 3,
  690: 3,
  694: 30,                             // ★BJ445③ 爆炸机关爆炸弹三族（:7356-7367
  695: 30,                              //   usesLocalNPCImmunity+localNPCHitCooldown=30,
  696: 30,                              //   Y2 报告③误档核销——AI_138 城镇臂写梯归档）
  755: -1,                             // 血蝙蝠（:7792,localCD=-1=攻击轮次免疫,tHit/bHit 承载）
  758: { kind: 'idStatic', cd: 10 },   // 吸血蛙（:7825——旧误 30t → 正轨）
  759: 15,                             // ★BJ511 雀杖（:7843-7844 usesLocalNPCImmunity+
                                       //   localNPCHitCooldown=15）——表缺曾落 -2 全局窗族,
                                       //   攻击窗每命中开 10t 窗锁荆鞭/冰雪回旋镖（用户复报）
  833: 10,                             // 沙漠虎本体（:8095,A① 改链后仍传显式 10 存档）
  864: 10,                             // ★BJ511 刃杖（Smolstar :8286-8299 usesLocalNPCImmunity+
                                       //   localNPCHitCooldown=10;原版写梯更显式 864 支
                                       //   :14131-14140 immune[owner]=0 清窗）——表缺曾落 -2
                                       //   全局窗族,同 759 病形（普查第二发）
  834: 10,
  835: 10,
  946: -1,                             // 泰拉棱镜（:8941,同 755 轮次免疫语义）
  951: { kind: 'idStatic', cd: 10 },   // 雪原精怪 flinx（:8984,通用备用）
  963: 20,                             // 阿比盖尔（:9113 与既有显式 20 一致）
  1022: 18,                            // 蘑菇小伙伴（:9679 与显式一致）
  1036: 20,                            // 雾网蜘蛛（:9781 与显式一致）
  1093: 9,                             // 帕鲁猫（:10206,palGroundStep 显式同源）
  1112: 9,
  1118: 30,
  1119: 30,
};

/** ★BJ704-G1 债①（BJ703-A 登记债④）：同型共享 idStatic 免疫桶 —— 原版
 *  `static uint[,] perIDStaticNPCImmunity`（P.cs:296）是【绝对到期】表：命中写
 *  `GameUpdateCount + (uint)cd`（:14035-14037/:13822）,门读 `stored <= GameUpdateCount`
 *  （IsNPCIndexImmuneToProjectileType :606-608,Damage_PVE flag2 :12600 消费）——
 *  【无】任何逐 t 衰减通道,到期由全局 tick 计数器惰性判定。旧实现=MinionHitCd
 *  倒数桶且【零 tick 驱动】（BJ697 只接了私有 hitCd 的宿主 fixedUpdate tick——
 *  共享桶无「每 t 恰一减」宿主:N 实例同拍 N 减,不可驱动）⇒ 每敌一次命中后永拒
 *  =存量红 minionproj-ledger-aug31「758 idStatic 10」根因。修=以 gameTickCount()
 *  （GTW 钟源=Main.GameUpdateCount 等价,core/GameTime BJ330,Game.fixedUpdate 每 t
 *  恰一进,先于实体轮）为钟的绝对到期表：零驱动、同型共享、惰性过期,逐位对齐
 *  「写 count+cd / 读 ≤count」原文。cd=−1 → now−1 ≤ now 恒过（uint 回绕 count−1
 *  同相,644 彩虹爆碎面 C16a-F3①）;>512 项惰性清扫（Arrow.idStaticCheck 先例——
 *  过期项自愈,清扫只防敌 id 复用期残余;ResetNPCSlotData 面本仓无 NPC 槽回收
 *  语义=近似备案）。★Arrow.ts idStaticCheck（墙钟 Date.now 版,376/604/181 族）
 *  为同语义姊妹实现,墙钟 vs tick 钟差异系已登记近似,本刀不动（统一另立刀）。 */
class IdStaticBucket {
  private m = new Map<number, number>();
  /** 写 count+cd / 门 ≤count（:606-608 读形 + :14036 写形,过门即写） */
  ready(id: number, cd: number): boolean {
    const now = gameTickCount();
    if ((this.m.get(id) ?? 0) > now) return false;
    this.m.set(id, now + cd);
    if (this.m.size > 512) {
      for (const [k, v] of this.m) if (v <= now) this.m.delete(k);
    }
    return true;
  }
}

/** 同型共享 idStatic 免疫桶（immunityIdentity=type :10682——实例级 Map 单例承载
 *  `perIDStaticNPCImmunity[type, npc]` :13823/:14037 语义,绝对到期=类注） */
const IDSTATIC_BUCKETS = new Map<number, IdStaticBucket>();

/** 弹型接触冷却解析（-2 全局窗/私表/idStatic 三态）;CONTACT_CD_TABLE 缺项 = 全局窗 */
function contactResolve(projId: number): ContactCd {
  return CONTACT_CD_TABLE[projId] ?? CONTACT_PLAYER_WINDOW;
}

/** 远程射击随从表（Projectile.cs AI_062/AI_026/aiStyle66 射击分支提取）：
 *  shot=射出弹幕 speed=弹速 cd=冷却 t range=射击门距（两者仅余通用路径族消费——
 *  AI_062 五型 373/375/407/423/613 已归 ai62Step 原版链：冷却=ai[1] 随机计数器
 *  :66963-67044、射程门 423≤400 :67101/613≤500 :67116/其余无门,cd/range 两列已废,
 *  曾 373 cd:36 定值近似 → 2026-08-23 备案项③归随机域）
 *  dmgMul=伤害倍率 jitter=瞄准随机抖动 px precallY=抛物线 Y 预瞄（俾格米掷矛
 *  AI_026 :62713-62720 num155=|含抖动Δx|×0.1×Next(0,100)×0.001 抵消 Y）
 *  muzzleY=出生锚点相对本体中心的 Y 偏移（AI_026 vector15 = Center-8 :58764；
 *  Foxparks 分支再 -2 :58784）；life=出生 timeLeft 覆写（AI_062 全族 300 :67127/:67161，
 *  唯 423→433 分支不覆写→433 SetDefaults 100）。
 *  373 黄蜂→374 毒刺(:67051-67055 sp10)；375 小鬼→376 火球(sp11)；
 *  407 风暴(鲨鱼龙卷)→408(sp20)；423 Xeno UFO→433 光束(sp4)；
 *  613 星尘细胞→614(sp14)；
 *  191-194 俾格米→195 掷矛(AI_026 :62726,sp11,CD30,射程800,抖动±20)；
 *  387 双子激光眼→389(:28982 sp8 ×1.15 伤,CD~45,需视线)；
 *  1094 Foxparks→1097 火球(:58815 sp11 CD42 无抖动) */
const MINION_SHOOT: Record<number, { shot: number; speed: number; cd?: number; range?: number;
  dmgMul?: number; jitter?: number; jitterY?: number; grav?: number; life?: number; muzzleY?: number;
  burn?: 'fire' | 'hellfire'; search?: number; precallY?: boolean;
  /** 终清波批：AI_026 flag10 族射击门原式（:62691 num139<800+40×slot）——
   *  rangeSlot=40/slot（1113 再 +360 :62674-62675）。★BJ515 债⑤（2026-10-05）：
   *  metric/throwLos 两键随 ai026TailTarget 专用面退役（dist/aim/CanHit 全由
   *  尾面承载,本表只剩 range/rangeSlot 供给消费端门）。★BJ516④（2026-10-05）：
   *  尾族开火改 ai026TailGround 内联（num151 阈）;jitterY 键 = :62711-62713
   *  num156（flag8→0,X 抖 ±20 :62707 对全族恒真——1094/1113 补 jitter/precallY） */
  metric?: 'euclid' | 'manhattan'; rangeSlot?: number; throwLos?: boolean }> = {
  // 373-613：仅 shot/speed/life 三列被 ai62Step 消费（:67049-67075 弹表/:67127/:67161
  // timeLeft=300,423 不覆写→100）
  373: { shot: 374, speed: 10, life: 300 },
  375: { shot: 376, speed: 11, life: 300 },
  407: { shot: 408, speed: 20, life: 300 },
  423: { shot: 433, speed: 4, life: 100 },                        // 423 分支无覆写 → SetDefaults 100
  613: { shot: 614, speed: 14, life: 300 },
  // ★台账批⑭（2026-08-31）：search=索敌检索半径（Minion_FindTargetInRange 式家族
  // 门——AI_026 flag10 群 = 主周【曼哈顿】窗 num104=700+100=800 内首只（CanHit 盒,
  // :61424-61446）;search 缺省族回落 self 心距。俾格米缺 search 键曾吃 1000 兜底错档。
  // ★终清波批：射击门 +40×slot 归真（metric/rangeSlot/throwLos 三键,:62566-62753
  // flag10 段原式——num134=40×minionPos、1113 再 +=360;窗口 num139<800+num134、
  // 曼哈顿、仅 CanHit 候选可出手）
  191: { shot: 195, speed: 11, cd: 30, range: 800, jitter: 20, grav: 0.3, life: 300, muzzleY: -8, precallY: true,
    rangeSlot: 40 }, // 掷矛抛物线(aiStyle 1) 手部高度 :58764;★BJ515:search/metric/throwLos 随尾面退役
  192: { shot: 195, speed: 11, cd: 30, range: 800, jitter: 20, grav: 0.3, life: 300, muzzleY: -8, precallY: true,
    rangeSlot: 40 },
  193: { shot: 195, speed: 11, cd: 30, range: 800, jitter: 20, grav: 0.3, life: 300, muzzleY: -8, precallY: true,
    rangeSlot: 40 },
  194: { shot: 195, speed: 11, cd: 30, range: 800, jitter: 20, grav: 0.3, life: 300, muzzleY: -8, precallY: true,
    rangeSlot: 40 },
  // ★BJ635：387 激光条目退役（twinsStep :30594-30613 原版随机游走冷却+CanHitLine
  //  中心点门+389 dmg×1.15 1:1 承接;旧固定 cd45+盒 CanHit 近似面废弃）
  // Foxparks 族（AI_026 flag10 段 :62566-62753）：cd num135 42/30（1113 :62573）；
  // 射程门 num139<800+num134（1113 num134+=360 :62674-62675 → 1160）； muzzleY=-10
  // ★三轮蓝队 F5④ 核证：原版 vector14 = (pos.X+w/2, pos.Y+h/2−8)＝【Center−8】
  //   （:62706,h/2 在原式里即盒心项）→flag8 支 :62740 再 −2 ⇒ Center−10。本表
  //   muzzleY 消费端 = this.cy+muzzleY ⇒ 常数 -10 对任意 h 精确成立（非 h-派生缺位，
  //   是"Center 相对"语义本身——真盒扩容前后零视觉差,登记核证结论）。burn：
  //   1097 命中 ai[1]>0 → OnFire3(323)/否则 OnFire(24)（:11315-11318）——
  //   1094 ai[1]=0 恒火、1113 ai[1]=3/1 恒地狱火（:62744-62752）
  1094: { shot: 1097, speed: 11, cd: 42, range: 800, life: 300, muzzleY: -10, burn: 'fire',
    rangeSlot: 40, jitter: 20, jitterY: 0, precallY: true }, // Center−10 = :62706−8 & :62740−2;★BJ516④:jitter/precallY=:62707-62714（X ±20 全族,Y num156=0 flag8）
  // 1113 索敌检索 1160（:62674-62675 num134+=360 → num139<800+40slot+360 :62691；approach num151=450+180 :62672/:62674）
  1113: { shot: 1097, speed: 11, cd: 30, range: 1160, life: 300, muzzleY: -10, burn: 'hellfire',
    rangeSlot: 40, jitter: 20, jitterY: 0, precallY: true }, // 6149 可靠的火绒狐（1457 新）;★BJ516④ 同上
};

/** ★三轮 η 红队：闪电光环 armorPenetrationPercent 门单源（Projectile.cs:13266-13269）。
 *  `if ((type==688||689||690) && targetNPC.type!=68 && targetNPC.defense<999)
 *   ⇒ armorPenetrationPercent=1f`——受害者非 68（地牢守卫族）且防御<999 才给 100%
 *  护穿；守卫/≥999 防御高防位退款池按 0 折算。 */
export function lightningAuraPenPercent(
  vanillaId: number | null | undefined, defense: number | undefined,
): number {
  return vanillaId !== 68 && (defense ?? 0) < 999 ? 1 : 0;
}

/** ★三轮蓝队 F5②：MinionProj SetDefaults 真盒单源读口（尺寸初始化链同步本函数）。
 *  Game.spawnDigtoiseOnCursor（Game.ts:12818 调用点在并行 α 的 Game 属主作业区外沿,
 *  本批不改其行）消费形：NewProjectile(x*16+8, y*16−32, …)=「中心」语义（Player.cs:
 *  50043 :50044 与 Projectile.cs NewProjectile X/Y=中心链一致）——落位派生式为
 *  `new MinionProj(x*TILE + 8 - bx.w / 2, y*TILE - 32 - bx.h / 2, …)`；旧实现把中心点
 *  直接当盒左上 ⇒ 钻地龟(34×34)整体右下偏半盒 17px。放大前后视觉差：出场摆正后
 *  无差（vy=15 下坠+挖掘 AI 自纠),首帧入场动画与三列净空门(x±1×y-2..y-1)判定面
 *  对齐上移；16×16 旧假设弹（如随从通用路 spawnMinion 的 MouseWorld 点）不在本批域。
 *  本导出未接线前返回值仅供测试/调用方自取（先例：pickSentryLandingSpot 导出缝）。 */
export function minionTrueBox(projId: number): { w: number; h: number } {
  switch (projId) {
    case 1098: case 1123: return { w: 34, h: 34 };       // 钻地龟（:10245-10246/:10507-10508）
    case 1093: case 1112: case 1118: case 1119: return { w: 14, h: 22 };
    // ★BJ521①（2026-10-05,BJ520① 移交债）：AI_026 尾族补齐（与构造器 if 链单源同步,
    //   判据同 BJ13/BJ17）。1094 系漂移修复——构造器 2026-09-06 批已注册 1094||1113,
    //   本表漏 1094 ⇒ 真盒读口落 16×16 兜底（湿段采样盒/中心锚消费面窄 2px）。
    //   191/192/193=18×18（:2794-2795,scale 1.025/1.05 截断回 18）/194=19×19
    //   （18×1.075f=19.35,:10674-10675 尾式）/266=24×16（:3519-3520）
    case 1094: case 1113: return { w: 18, h: 18 };
    case 191: case 192: case 193: return { w: 18, h: 18 };
    case 194: return { w: 19, h: 19 };
    case 266: return { w: 24, h: 16 };
    case 1022: return { w: 20, h: 30 };                  // 蘑菇小伙伴（:9670-9671）
    case 393: case 394: case 395: return { w: 20, h: 30 };   // 海盗三变体（:4758-4759）★SW-BJ13
    case 423: return { w: 28, h: 28 };                   // 异星 UFO（:4964-4965）★SW-BJ13
    case 1036: return { w: 18, h: 10 };                  // 雾网蜘蛛（:9770-9771）★SW-BJ13
    // ★SW-BJ17 2026-09-07：仆从构造器 13 id 真盒收尾批（前批移交件;与构造器 if 链单源
    //   同步,判据同 BJ13/BJ16）。移交清单 13 id 中 393-395/758/1036 已由 BJ13/BJ16 注册
    //   （对反编译终值核对一致,不重刀）,本批补余下 8 id——乌鸦 317 28×28（:4104-4105）/
    //   蜘蛛三型 390-392 30×30（:4746-4747）/ 沙漠虎一档 833 26×20（:8086-8087）/
    //   二三档 834-835 20×30（:8100-8101/:8114-8115）/ 酷鞭雪花哨兵 917 30×30
    //   （:8705-8706）。各 SetDefaults 块无 scale 行（缺省 1）→ SetDefaults 尾
    //   width×scale（:10674-10675）恒等,字面即终值;数据面 vanilla-projectiles.json 同值
    case 317: return { w: 28, h: 28 };                   // 乌鸦 Raven（:4104-4105）★SW-BJ17
    case 390: case 391: case 392: return { w: 30, h: 30 };   // 蜘蛛三型（:4746-4747）★SW-BJ17
    case 833: return { w: 26, h: 20 };                   // 沙漠虎一档（:8086-8087）★SW-BJ17
    case 834: case 835: return { w: 20, h: 30 };         // 沙漠虎二三档（:8100-8101/:8114-8115）★SW-BJ17
    case 917: return { w: 30, h: 30 };                   // 酷鞭雪花哨兵（:8705-8706）★SW-BJ17
    // ★SW-BJ16 2026-09-07：33693 中心锚支家族真盒（与构造器 if 链单源同步,判据同 BJ13）
    case 613: return { w: 24, h: 24 };                   // 星尘细胞（:6600-6611 块内 width/height）
    case 623: return { w: 50, h: 80 };                   // 星尘守护者（:6713-6714）
    // 龙链四段 SetDefaults 初盒 24×24（:6741-6742——仅出生首拍前值;★G27② AI_121
    // 逐拍覆写 (int)(30×scale) :43773/:43867,真盒以运行时 w/h 为准）
    case 625: case 626: case 627: case 628: return { w: 24, h: 24 };
    case 758: return { w: 20, h: 30 };                   // 吸血蛙（:7817-7818）
    case 759: case 831: case 970: return { w: 10, h: 10 };   // 雀杖/虎宝石/阿比盖尔计数器（:7839/:8073/:9188）
    case 387: case 388: return { w: 40, h: 20 };         // ★BJ635 双子（:4714-4715/:4730-4731）
    case 533: return { w: 20, h: 20 };                   // ★BJ635 致命球（:6005-6006）
    case 951: return { w: 26, h: 26 };                   // 雪怪（:8972-8973）
    case 963: return { w: 30, h: 48 };                   // 阿比盖尔一阶体（:9106-9107）
    case 663: return { w: 30, h: 54 };                   // :7133-7134
    case 665: return { w: 28, h: 58 };                   // :7141-7144
    case 667: return { w: 28, h: 60 };                   // :7145-7148
    case 677: case 678: case 679: return { w: 26, h: 54 };   // :7244-7245
    case 308: return { w: 80, h: 74 };                   // 冰九头蛇（:4001-4002）
    case 377: return { w: 66, h: 50 };                   // 蜘蛛皇后（:4619-4620）
    case 641: case 643: return { w: 32, h: 32 };         // 月门/彩虹水晶（:6919/:6932）
    case 966: return { w: 18, h: 60 };                   // 猎犬底座（:9146-9147）
    case 1025: return { w: 42, h: 38 };                  // 悬空毒眼球（:9710-9711）
    default: return { w: 16, h: 16 };                    // MinionProj 缺省兜底（构造期字段）
  }
}

/** aiStyle 53 定点哨兵表（AI :27172-27382 1:1）：初冷 ai[0]=120（:27180），
 *  射速 ai[0] 归零重置 60（966 猎犬 90，:27282-27288），弹速 9/9/12.5。
 *  炮口按瞄准扇区偏移（:27289-27305，见 sentry53Fire）；射程门 1000
 *  （AI_053_HandleSentryNPCTargeting :37845 默认 maxDistance=1000，无视线门） */
const SENTRY53: Record<number, { shot: number; speed: number; cd: number }> = {
  308: { shot: 309, speed: 9, cd: 60 },   // 冰九头蛇 → 309 冰弹
  377: { shot: 378, speed: 9, cd: 60 },   // 蜘蛛皇后 → 378 蛛卵
  966: { shot: 967, speed: 12.5, cd: 90 }, // 猎犬（Houndius）→ 967
};
/** aiStyle 123 哨兵射击表（:33819-34020 提取；射程门 1000）：
 *  641 月门→642 传送门弹 CD30；643 彩虹水晶→644×3 目标区随机落点。
 *  ★643 真值节奏（1458 AI_123 :37726-34020,R31 §C③）：ai[0] −20→0 冷却 20t + 锁定 1t
 *  + num8=5t 计满 → **~26t 一轮**——旧值 50 = 射速减半（R31 P1 一行止血）
 */
export const SENTRY_SHOOT: Record<number, { shot: number; speed: number; cd: number; volley?: number }> = {
  641: { shot: 642, speed: 9, cd: 30 },
  643: { shot: 644, speed: 0, cd: 26, volley: 3 },
};

/** 悬浮哨兵两件（R31 §C①：原版放置即定桩,tileCollide=false 恒悬浮于放置点）：
 *  641 月门/643 彩虹水晶（AI_123 首行 velocity=Zero,:37726 区块）。
 *  ★BJ516⑤（2026-10-05）：1025 悬空毒眼球移出——AI_197 非 Zero 悬浮（顶格探/
 *  升空吸顶/衰减状态机 :41033-41145,见 1025 支）;放置速度 (0,0) 语义不变
 *  （Player.cs:48687-48689）。此前走通用哨兵重力段 vy+=0.2 落地的更早病根已除 */
const FLOATING_SENTRIES = new Set<number>([641, 643]);

// ===========================================================================
// ★BJ639 批 1（2026-10-11）：aiStyle 123 两哨兵的【弹面】1:1 落刀（BJ635 批 2
//  候选 642/644 定谳=真缺——此前 642 落「速度 9 直飞弹」通用承载、644 落「落点
//  即时 AoE」近似,弹实体本体不存在。原版：
//   · 642 = 月门连续激光（AI_084 642 支 :31964-31971 锁心+扫摆 / :32076-32085
//     寿命包络 / :32113-32186 LaserScan 束长 / :32195-32213 束端尘+PlotTileLine
//     光照 / Colliding :16029-16037 线碰撞 / CutTiles :15288 沿束切割 /
//     usesLocalNPCImmunity cd10 :6915-6916 / 50t Kill / Draw Main.cs:32841-32856
//     TurretLaserDraw 三段条带）。宿主 641 死 → 锁链尾支 Kill（:31993-31999,
//     537 A2 同语义）;641 Kill 亦全扫 642（:73328-73333）。
//   · 644 = 彩虹水晶爆裂弹（aiStyle 112 644 支 :34866-34998：渐显 α−8/拍、
//     hsl 色相=出生拍 Disco、自旋、scale=Opacity/2×localAI[0]、t=30 才 60×60
//     一次引爆（DoRainbowCrystalStaffExplosion :80316 + Damage 盒 :34972-34998）、
//     t=60 Kill 二段爆花（Kill :73416-73430——usesIDStaticNPCImmunity :6951 单发
//     语义=第二段伤害被免疫面吃掉,视觉爆花照放）;花瓣尘 1/10×4 站 + 亮星尘
//     （:34899-34947）;回门光线（Draw Main.cs:34184-34202,t≥30 起亮）。宿主 643
//     Kill 全扫 644（:73336-73347）。
//  判别锁 = tests/bj639-moongate-rainbow-ai.test.ts（真哨兵夹具+变异）。
// ===========================================================================

/** Main.rgbToHsl 的色相分量（Main.cs:48743-48779 1:1——644 出生 ai[0] 喂入 :37922）。 */
export function rgbToHslHue(r: number, g: number, b: number): number {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = max - min;
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return h / 6;
}

/** Main.DiscoR/G/B 六相循环取色相（DoUpdate_AnimateDiscoRGB Main.cs:19776-19825
 *  1:1 折算：初值 R=255/:1036、每拍 ±7、六相周期 = 6×⌈255/7⌉=219t。
 *  纯函数——tick 由调用方给（运行时 performance.now()×60/1000;测试注入钉值）。 */
export function discoHueAt(tick: number): number {
  let r = 255, g = 0, b = 0, style = 0;
  const steps = Math.floor(tick) % 219;
  for (let i = 0; i < steps; i++) {
    if (style === 0) { g += 7; if (g >= 255) { g = 255; style = 1; } }
    else if (style === 1) { r -= 7; if (r <= 0) { r = 0; style = 2; } }
    else if (style === 2) { b += 7; if (b >= 255) { b = 255; style = 3; } }
    else if (style === 3) { g -= 7; if (g <= 0) { g = 0; style = 4; } }
    else if (style === 4) { r += 7; if (r >= 255) { r = 255; style = 5; } }
    else { b -= 7; if (b <= 0) { b = 0; style = 0; } }
  }
  return rgbToHslHue(r, g, b);
}

/** 运行时全局 tick（Main.Disco 步进源）：performance.now 折 60t/s。 */
export function discoTickNow(): number {
  return (typeof performance !== 'undefined' ? performance.now() : 0) / (1000 / 60);
}

/** ★BJ639 批 1①：642 月门光束弹（aiStyle 84 642 支全式——见上方块注）。
 *  位移独占：AI 直写位置/束向（UpdatePosition aiStyle84 早退表 :20549 同族,
 *  velocity 只当束向单位向量）;盒 18×18（SetDefaults :6906-6916）。 */
export class MoonGateBeam extends Entity {
  readonly projId = 642;
  w = 18; h = 18;
  damage: number;
  knockback: number;
  armorPen = 0;
  /** ai[0] = 当前束向角（出生 = 目标角 + direction×π/6 :37910-37914） */
  ai0: number;
  /** proj.direction = 出生束向 X 符号（NewProjectile 速度符号链）——扫向系数 */
  direction: 1 | -1;
  /** localAI[0] 寿命计（≥50 Kill :32079-32083） */
  localAI0 = 0;
  /** localAI[1] LaserScan 束长（Lerp 0.5/拍 :32174-32177） */
  localAI1 = 0;
  /** proj.scale = min(sin(life×π/50)×10, 1)（:32080-32085） */
  scale = 0;
  /** rotation = 束向 − π/2（:32112-32113,draw 消费） */
  rot = 0;
  /** 归一束向（AI 每拍直写——命中/束长/光照共用） */
  vx = 0; vy = -1;
  dead = false;
  /** SentryShot（ProjectileID.cs:293 集合含 642,WhipTag.SENTRY_SHOT_SET 同表） */
  whipTagShot = true;
  /** 城镇臂可空（登记：461/537 光束先例同口径 enemies-only,642 城镇面零消费先例） */
  private hostRef: () => MinionProj | null;
  /** 受理面 crit/timer 消费 owner（spawn 拍捕获——vanilla NewProjectile owner 语义） */
  private ownerPlayer: Player | null;
  private hitCd = new Map<number, number>();

  constructor(x: number, y: number, ai0: number, direction: 1 | -1,
    damage: number, knockback: number, host: MinionProj | null, owner: Player | null) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;   // NewProjectile X/Y=Center :10878
    this.ai0 = ai0;
    this.direction = direction;
    this.damage = damage;
    this.knockback = knockback;
    this.hostRef = () => (host && !host.dead ? host : null);
    this.ownerPlayer = owner;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // 宿主失联 = 锁链尾支 Kill（:31993-31999——A2 537 同语义,先于一切束效果）
    const host = this.hostRef();
    if (!host) { this.dead = true; return; }
    // ①束心锁 = host.Center（:31965 base.Center = proj.Center——携行重定位随宿主自足）
    this.x = host.cx - this.w / 2;
    this.y = host.cy - this.h / 2;
    // ②扫摆（:31966-31970）：vector62 = ai0.RotatedBy(−direction×(π/3)/50);velocity=归一
    const sweep = -(this.direction as number) * (Math.PI / 3) / 50;
    const ca = Math.cos(sweep), sa = Math.sin(sweep);
    const ux = Math.cos(this.ai0), uy = Math.sin(this.ai0);
    const rx = ux * ca - uy * sa, ry = ux * sa + uy * ca;
    const rl = Math.hypot(rx, ry) || 1;
    this.ai0 = Math.atan2(ry, rx);
    this.vx = rx / rl; this.vy = ry / rl;
    // ③寿命包络（:32076-32085）
    this.localAI0++;
    if (this.localAI0 >= 50) { this.dead = true; return; }
    this.scale = Math.min(Math.sin(this.localAI0 * Math.PI / 50) * 10, 1);
    // ④rotation = 束向 − π/2（:32112-32113）;velocity=旋转向量归一（:32114 已单位）
    this.rot = Math.atan2(this.vy, this.vx) - Math.PI / 2;
    // ⑤束长（:32125-32177）：num702=2/num703=0 → LaserScan(Center,vel,0,2400,[2])
    //  → 均值 → localAI[1] = Lerp(localAI[1], avg, 0.5)
    const smp = [0, 0];
    laserScan(game.world.store, { x: this.cx, y: this.cy }, { x: this.vx, y: this.vy }, 0, 2400, smp);
    this.localAI1 += ((smp[0] + smp[1]) / 2 - this.localAI1) * 0.5;
    // ⑥束端尘（:32195-32213）：端点=Center+velocity×(localAI[1]−14);
    //  2×d229 锥形（束角±π/2 随机侧,速 rand×2+2,noGravity scale1.7）+1/5 d31
    //  （端点+侧偏×width,α100 scale1.5,vel×0.5、vy=−|vy| 上浮）
    const tipX = this.cx + this.vx * (this.localAI1 - 14);
    const tipY = this.cy + this.vy * (this.localAI1 - 14);
    for (let k = 0; k < 2; k++) {
      const da = Math.atan2(this.vy, this.vx) + (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2);
      const mag = Math.random() * 2 + 2;
      const d = game.spawnDust?.(tipX, tipY, 0, 0, 229, Math.cos(da) * mag, Math.sin(da) * mag);
      if (d) { d.noGravity = true; d.scale = 1.7; }
    }
    if (Math.floor(Math.random() * 5) === 0) {
      const px2 = -this.vy, py2 = this.vx;                       // RotatedBy(π/2)
      const side = (Math.random() - 0.5) * this.w;
      const d31 = game.spawnDust?.(tipX + px2 * side - 4, tipY + py2 * side - 4, 8, 8, 31, 0, 0, 100, null, 1.5);
      if (d31) { d31.vx *= 0.5; d31.vy *= 0.5; d31.vy = -Math.abs(d31.vy); }
    }
    // ⑦光照（:32212-32213 PlotTileLine CastLight (0.3,0.65,0.7)）——沿束步进三线带
    const half = (this.w * this.scale) / 2;
    for (let dd = 0; dd <= this.localAI1; dd += TILE) {
      game.addLightAt?.(this.cx + this.vx * dd, this.cy + this.vy * dd, 0.3, 0.65, 0.7);
      game.addLightAt?.(this.cx + this.vx * dd - this.vy * half, this.cy + this.vy * dd + this.vx * half, 0.3, 0.65, 0.7);
      game.addLightAt?.(this.cx + this.vx * dd + this.vy * half, this.cy + this.vy * dd - this.vx * half, 0.3, 0.65, 0.7);
    }
    // ⑧沿束切割（CutTiles :15288——PlotTileLine Center→Center+velocity×localAI[1],
    //  线宽 width×scale）：12px 步进盒近似（461 光束同族先例宽 22 直译面）
    if (this.localAI1 > 4) {
      for (let dd = 0; dd <= this.localAI1; dd += 12) {
        cutTilesBox(game, this.cx + this.vx * dd - this.w / 2, this.cy + this.vy * dd - this.h / 2,
          this.w, this.h, this.projId);
      }
    }
    // ⑨线碰撞命中（Colliding :16029-16037：AABB vs 线 Center→Center+velocity×
    //  localAI[1] 宽 30×scale;usesLocalNPCImmunity cd10 :6915-6916→本仓 hitCd 10t 表;
    //  受理面 tag/crit/横切面=694-696 爆弹臂同构,SentryShot 单源）
    for (const [k, v] of this.hitCd) {
      if (v <= 1) this.hitCd.delete(k); else this.hitCd.set(k, v - 1);
    }
    if (this.localAI1 < 4 || this.scale <= 0) return;
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, this.projId)) continue;
      const en = ent as unknown as {
        x: number; y: number; w: number; h: number; cx: number; cy: number; id: number; dead: boolean;
        dontTakeDamage?: boolean;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
          pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
      };
      if (en.dead || this.hitCd.has(en.id)) continue;
      if (!segHitsRect(this.cx, this.cy, this.vx * this.localAI1, this.vy * this.localAI1,
        30 * this.scale, en)) continue;
      if (en.dontTakeDamage === true) continue;                    // BJ467⑥ :12686 头门前置
      if (MinionProj.enemyImmune(en)) continue;                    // BJ452 N3① :12636
      const direct: number[] = [];
      (en as never as import('./WhipTag').WhipTagged).hurtFx = (d: number) => { direct.push(d); };
      const timerCrit = tryConsumeTimerCritOf(this.ownerPlayer, game, en.x, en.y, en.w, en.h);
      const monkCrit = monkAuraForcedCrit(this.ownerPlayer, this.projId);
      const res = resolveWhipTagHit(en as never as import('./WhipTag').WhipTagged,
        this.damage, game,
        (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
        SUMMON_TAG_MUL[this.projId] ?? 1, en.cx, en.cy, this.ownerPlayer, 0, this.projId);
      const gated = en.dead;                                       // dontTakeDamage 已被头门早退（窄化余项）
      const golemCrit = rollGolemSentryCrit(game, this.projId, false);   // 6176 SentryShot 10%
      const crit = res.crit || timerCrit || monkCrit || golemCrit;
      // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970 `Main.DamageVar(num15,
      //  Main.player[owner].luck)`）——原版序=tag(:12947)→golem(:12962-65)→DV;
      //  掷 res.dmg（tag 乘后基数;res.crit ×2 已嵌=边界舍入微差,登记债①）
      const dmgV867 = damageVarRoll(res.dmg, this.ownerPlayer?.luck ?? 0);
      en.hurt(applyBannerDamageDealt(game, en, crit && !res.crit ? dmgV867 * 2 : dmgV867),
        this.vx * this.knockback, this.vy * this.knockback, game, 0, crit, 1, true);
      if (!gated) {
        ghostHealProc(game, this.projId, 0,
          en as unknown as Parameters<typeof ghostHealProc>[3]);   // Z1/D1② :13877-84
      }
      applyProjStatus(this.projId, en as unknown as Record<string, number>, {});
      if (direct.length > 0 && !gated) {
        for (const d of direct) darkHarvestChain(game, d, en.cx, en.cy, en.id);
      }
      this.hitCd.set(en.id, 10);                                   // localNPCHitCooldown=10
    }
  }

  private ownerOf(game: GameHooks): Player | null {
    return this.ownerPlayer ?? game.player ?? null;
  }

  /** Draw（Main.cs:32841-32856 DrawLaser TurretLaserDraw 三段条带两过）：
   *  pass1 = 白 α127/255 全宽（无 Opacity 系）;pass2 = 白 α127/255×0.75×Opacity
   *  半宽——642 alpha 恒 255（aiStyle84 无减档,全支亲读）→ Opacity=0,pass2 恒零
   *  =原版仅半透白条带;仍照实现（数据面若未来接 α 链自动点亮）。束长预算 =
   *  localAI[1] − scale×10.5（:32845 num296）。条带 22px 宽×scale,段进 19px
   *  （frame.Height−1 :960）,体帧 y=22×(1..5) 五帧循环（i_1=54000−time/2 :32848）。 */
  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const ctx = r.ctx;
    if (!ctx || this.localAI1 < 8 || this.scale <= 0.02) return;
    const img = projSprite(this.projId);
    const budget = Math.max(0, this.localAI1 - this.scale * 10.5);
    if (budget < 1) return;
    const bodyNum = 54000 - Math.floor(discoTickNow() / 2);
    const bodyFrame = ((bodyNum % 5) + 5) % 5;                     // i_1%5（:32848 段内递进近似=全局相位）
    const passes: Array<{ a: number; wMul: number }> = [
      { a: 127 / 255, wMul: 1 },                                   // c_=white127（:32847）
      { a: (127 / 255) * 0.75 * 0, wMul: 0.5 },                    // ×0.75×Opacity（:32853）——α 恒 255 → Opacity=0 恒零过
    ];
    for (const p of passes) {
      if (p.a <= 0.002) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, p.a);
      ctx.imageSmoothingEnabled = false;
      ctx.translate(this.cx, this.cy);
      ctx.rotate(this.rot);
      const wid = this.scale * p.wMul;
      if (!img || img.width === 0) {
        ctx.fillStyle = `rgba(200,244,255,${p.a})`;
        ctx.fillRect(-11 * wid, 0, 22 * wid, budget);
        ctx.restore();
        continue;
      }
      const tw = 22;
      ctx.drawImage(img, 0, 0, tw, 20, (-11) * wid, -10 * wid, tw * wid, 20 * wid);   // stage0 炮口
      let y = 22 * wid;                                            // stage0 distCovered=32 − origin 偏 10
      let adv = 0;
      while (adv + 19 < budget - 32) {                             // stage1 体段 19px/段
        const fy = 22 * (bodyFrame + 1);
        ctx.drawImage(img, 0, fy, tw, 20, (-11) * wid, y, tw * wid, 20 * wid);
        adv += 19 * wid;
        y += 19 * wid;
      }
      const restH = Math.max(4, budget - 32 - adv);                // stage2 端帽（截余量）
      ctx.drawImage(img, 0, 154, tw, 30, (-11) * wid, y, tw * wid, Math.min(30, restH) * wid);
      ctx.restore();
    }
  }
}

/** ★BJ639 批 1②：644 彩虹水晶爆裂弹（aiStyle 112 644 支 :34866-34998 全式 +
 *  t=30 引爆/60 Kill 二段——见上方块注）。盒 14×14 tileCollide=false 零速悬浮
 *  （SetDefaults :6943-6953）。faces = 哨兵闭包注入的受理面（敌/城伤害臂内聚在
 *  MinionProj.rainbowBurstHitFace——townAcceptLadder 私有归属面）。 */
export interface RainbowBurstFaces {
  /** t=30 引爆受理面（敌怪 60×60 + 城镇 60×60 同链,注入点=643 哨兵） */
  hitAt: (game: GameHooks, x: number, y: number) => void;
}

export class RainbowCrystalBurst extends Entity {
  readonly projId = 644;
  w = 14; h = 14;
  /** ai[0] = 出生拍 Disco 色相（:37922 rgbToHsl(Disco).X——同一 volley 三发同相） */
  hue: number;
  /** localAI[0] = scale 随机档 0.8-1.6（:34878 NextFloat×0.8+0.8,首拍掷定） */
  localAI0 = 0;
  /** localAI[1] = 寿命计（==30 引爆 / ≥60 Kill :34954-34976） */
  localAI1 = 0;
  /** direction = ±1（:34879 旋转向） */
  direction: 1 | -1 = 1;
  /** proj.scale = Opacity/2×localAI[0]（:34953） */
  scale = 0;
  /** rotation = localAI[1]/40×2π×direction（:34883-34885） */
  rot = 0;
  alpha = 255;                                                     // SetDefaults :6950 −8/拍渐显
  dead = false;
  whipTagShot = true;                                              // SENTRY_SHOT_SET 含 644
  vx = 0; vy = 0;                                                  // velocity=Zero（:34953）
  private parentRef: () => MinionProj | null;
  private faces: RainbowBurstFaces;
  private boomed = false;

  constructor(x: number, y: number, hue: number, parent: MinionProj | null,
    faces: RainbowBurstFaces) {
    super();
    this.x = x - this.w / 2; this.y = y - this.h / 2;
    this.hue = hue;
    this.parentRef = () => (parent && !parent.dead ? parent : null);
    this.faces = faces;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // 宿主 643 死 = 全扫（Kill :73336-73347 同语义）
    if (!this.parentRef()) { this.dead = true; return; }
    if (this.localAI1 === 0) {                                     // 首拍掷定（:34877-34880）
      this.localAI0 = Math.random() * 0.8 + 0.8;
      this.direction = Math.random() < 0.5 ? 1 : -1;
    }
    this.localAI1++;
    // α −8/拍（:34887-34893）→ Opacity = 1−α/255
    if (this.alpha > 0) this.alpha = Math.max(0, this.alpha - 8);
    const opacity = 1 - this.alpha / 255;
    this.rot = (this.localAI1 / 40) * Math.PI * 2 * this.direction;
    this.scale = (opacity / 2) * this.localAI0;
    // 回门光线（:34868-34875 PlotTileLine CastLight ×0.5 hsl 色）——★C16a-F9：
    //  宿主活即每拍画（无 α 门;旧实现错挂 alpha==0 门=渐显期光线整缺）;
    //  α 门只属于 :34895-34899 的 AddLight(Center, 色×0.5) 单站点（两笔拆分）
    {
      const [hr, hg, hb] = empressHslRgb(this.hue);
      const p = this.parentRef()!;
      const dist = Math.hypot(p.cx - this.cx, p.cy - this.cy);
      for (let dd = 0; dd <= dist; dd += 16) {
        const t2 = dd / (dist || 1);
        game.addLightAt?.(this.cx + (p.cx - this.cx) * t2, this.cy + (p.cy - this.cy) * t2,
          hr / 255 * 0.5, hg / 255 * 0.5, hb / 255 * 0.5);
      }
      if (this.alpha === 0) {
        game.addLightAt?.(this.cx, this.cy, hr / 255 * 0.5, hg / 255 * 0.5, hb / 255 * 0.5);
      }
    }
    // 花瓣尘（:34899-34924 两环×2 每 1/10 掷,d267 色相染 noLight,scale=Opacity×
    //  localAI[0]）——★C16a-F8：环 1 = UnitY.RotatedBy(nπ).RotatedBy(rotation)
    //  （角合成 nπ+rot;UnitY.RotatedBy X=−sin 判例 → vx=−sin·2.5/vy=cos·2.5）;
    //  环 2 = 仅 UnitY.RotatedBy(nπ)（不随 rotation,= 垂直上下对 ±2.5）。
    //  旧实现两环同式且 +sin=镜像翻转。亮星尘 1/10（:34925-34948）见下
    const [dr, dg, db] = empressHslRgb(this.hue);
    for (let loop = 0; loop < 2; loop++) {
      for (let n = 0; n < 2; n++) {
        if (Math.floor(Math.random() * 10) !== 0) continue;
        const ang = loop === 0 ? Math.PI * n + this.rot : Math.PI * n;
        const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 267,
          -Math.sin(ang) * 2.5, Math.cos(ang) * 2.5, 225,
          { r: dr, g: dg, b: db, a: 255 }, 1.5, true, false, false);
        if (d) {
          d.noGravity = true;
          d.noLight = true;
          d.scale = opacity * this.localAI0;
          d.vx = -Math.sin(ang) * 2.5; d.vy = Math.cos(ang) * 2.5;
        }
      }
    }
    if (Math.floor(Math.random() * 10) === 0) {                    // 亮星尘（:34925-34948 单站折算）
      const mag = 1 + Math.random() * 2;
      const off = { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 };
      const ol = Math.hypot(off.x, off.y);
      if (ol > 0.001) {
        const ox = off.x / ol * (20 + Math.random() * 100);
        const oy = off.y / ol * (20 + Math.random() * 100);
        const ws = game.world.store;
        const tx = Math.floor((this.cx + ox) / TILE), ty = Math.floor((this.cy + oy) / TILE);
        if (ws.inBounds(tx, ty) && !ws.isSolid(tx, ty)) {
          const ds = game.spawnDust?.(this.cx + ox, this.cy + oy, 0, 0, 267, 0, 0, 127,
            { r: dr, g: dg, b: db, a: 255 }, 1, true, false, false);
          if (ds) {
            ds.noGravity = true;
            ds.vy = -mag * (Math.random() * 0.9 + 1.6);
            ds.fadeIn = 1 + Math.random();
            ds.scale = 1 + Math.random();
            ds.noLight = true;
            // ★C16a-F4 白克隆补（:34946-34949）：scale×0.65/fadeIn×0.65 + 白色
            const wc = game.cloneDust?.(ds);
            if (wc) {
              wc.scale *= 0.65;
              wc.fadeIn *= 0.65;
              wc.color = { r: 255, g: 255, b: 255, a: 255 };
            }
          }
        }
      }
    }
    // t=30 引爆（:34975-34998）+ t=60 Kill（:34955-34960 → Kill :73416-73430）
    // ★C16a-F3②（2026-10-12）破钉重产：Kill 二段 = 爆花尘 + friendly=true + 60×60
    //  盒 penetrate=-1/maxPenetrate=-1 再 Damage() 一轮（旧钉「单发语义/第二段只放
    //  视觉」= 误读判谳——IDStatic 表 cd=-1（:468 字段缺省）经 :14036 写
    //  count+(uint)(-1)=count-1（uint 回绕）,门 :606-608 `stored<=count` 恒真
    //  =免疫面零阻,R1-F1 纪律——第二段对盒内全体(含 t=30 已命中者)成立）
    if (this.localAI1 === 30 && !this.boomed) {
      this.boomed = true;
      this.rainbowExplosionDust(game);
      this.faces.hitAt(game, this.cx, this.cy);
    }
    if (this.localAI1 >= 60) {
      this.rainbowExplosionDust(game);
      this.faces.hitAt(game, this.cx, this.cy);   // :73421-73428 二段 Damage（吃同表）
      this.dead = true;
      return;
    }
  }

  /** DoRainbowCrystalStaffExplosion（:80316-80360 双环 d267 hsl 染 + 白克隆）。
   *  ★C16a-F4（2026-10-12）速度式勘正：spinningpoint=(0,−3).RotatedByRandom(π)
   *  → RotatedBy(2π·i/num) 角合成 (θ+φ) → ×vector(2.1,2) = (6.3·sin,−6·cos)
   *  → ×k（:80318-80322）。旧实现 x×0.33/y×0.5 模长漏乘且 x:y 比错（2.05:3 应
   *  6.3:6=1.05）。白克隆（:80337-80341 两环同式）：CloneDust → scale/2、fadeIn/2、
   *  纯白（255,255,255,255）——旧实现整缺。 */
  private rainbowExplosionDust(game: GameHooks): void {
    const [dr, dg, db] = empressHslRgb(this.hue);
    const num = 7 + Math.floor(Math.random() * 6);                 // Next(7,13)
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < num; i++) {
        const spinA = Math.random() * Math.PI * 2;                 // (0,−3).RotatedByRandom(π)
        const ang = spinA + Math.PI * 2 * i / num;
        const speedK = ring === 0 ? 0.8 + Math.random() * 0.4 : (0.8 + Math.random() * 0.4) * (Math.random() * 0.8);
        const d = game.spawnDust?.(this.cx, this.cy, 0, 0, 267,
          Math.sin(ang) * 6.3 * speedK, -Math.cos(ang) * 6 * speedK, 0,
          { r: dr, g: dg, b: db, a: 255 }, ring === 0 ? 2 : Math.random(), true, false, false);
        if (d) {
          d.noGravity = true;
          d.scale = ring === 0 ? 2 : Math.random();
          d.fadeIn = Math.random() * 2;
          const wc = game.cloneDust?.(d);                          // :80337-80341 白克隆
          if (wc) {
            wc.scale /= 2;
            wc.fadeIn /= 2;
            wc.color = { r: 255, g: 255, b: 255, a: 255 };
          }
        }
      }
    }
  }

  /** Draw（Main.cs:34184-34202 两过：体旋转（rotation）+体不旋转,均 ×Opacity×
   *  scale×2 hsl 染色;34445 glow 不旋转过=第三过折算半 α;t≥30 回门光线拉伸 pass
   *  =垂直拉伸体纹理沿向宿主（Main.cs :34190-34201,scaleY=dist/texH）。 */
  draw(r: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const opacity = 1 - this.alpha / 255;
    if (opacity <= 0.001) return;
    const img = projSprite(this.projId);
    if (!img || img.width === 0) return;
    const [tr, tg, tb] = empressHslRgb(this.hue);
    const tex = tintedTex(img as unknown as HTMLImageElement, [tr, tg, tb], false) ?? img;
    const sz = this.scale * 2;
    const passes: Array<{ rot: number; a: number }> = [
      { rot: this.rot, a: opacity },                               // 旋转体（:34187）
      { rot: 0, a: opacity },                                      // 不旋转体（:34188）
      { rot: 0, a: opacity * 0.45 },                               // glow 过折算（:34445 color106 半档）
    ];
    for (const pass of passes) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, pass.a);
      ctx.imageSmoothingEnabled = false;
      ctx.translate(this.cx, this.cy);
      ctx.rotate(pass.rot);
      const dw = this.w * sz, dh = this.h * sz;
      ctx.drawImage(tex, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    // 回门光线（:34190-34201 宿主活 + Opacity>0.3 + t≥30 起亮;拉伸 = texW×1 ×
    //  dist/texH,α 值115=clamp(|30−t|/20)）
    const parent = this.parentRef();
    if (parent && opacity > 0.3 && this.localAI1 > 30) {
      let v115 = Math.abs(30 - this.localAI1) / 20;
      v115 = Math.max(0, Math.min(1, v115));
      if (v115 > 0) {
        const dx = parent.cx - this.cx, dy = parent.cy - this.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const ang = Math.atan2(dy, dx) + Math.PI / 2;
        const sy = dist / (img as { height: number }).height;
        for (const pa of [{ a: v115, syMul: 1 }, { a: v115, syMul: 0.5 }]) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, pa.a);
          ctx.imageSmoothingEnabled = false;
          ctx.translate(this.cx, this.cy);
          ctx.rotate(ang);
          ctx.drawImage(tex, -(this.w * sz) / 2, 0, this.w * sz, (img as { height: number }).height * sy * pa.syMul);
          ctx.restore();
        }
      }
    }
  }
}

/** 哨兵放置落地扫描（PickSentryLandingSpot Player.cs:50043-50059 1:1 纯函数,
 *  R31 §C①——Game.ts case 'summon' 接线见落点清单;本导出先落可测实现）：
 *  非悬浮件从鼠标格向下扫到"本格及左右邻均非实心"终止的行 i,取 i−1;
 *  spawnX=鼠标世界 X、spawnY=i×16−24。悬浮三件(3571/3569/5463)免扫描直取鼠标格
 *  （5463 另在 Player.cs:48687 把 spawnY 覆写为裸 mouseY、vy=0）。
 *  ★BJ-C9-SP（2026-10-09）实报定谳：扫描谓词 = **WorldGen.SolidTile2**（:50057
 *  三列逐字;WorldGen.cs:70665-70680 = tileSolid【无 !tileSolidTop 排除,
 *  Main.cs:8032 `tileSolid[19]=true`】∧ slope==0 ∧ !halfBrick ∧ active ∧ 未致动）
 *  ——平台九件套（19/239/380/427/435-439,tileSolid∩tileSolidTop）【计入】实心:
 *  原版哨杖对准平台=落点即平台面（蜘蛛女王杖 2366 实报「哨兵只能落实体物块」根因
 *  =旧 isSolid 窄谓词漏平台）。承载=TileStore.isSolid2（SolidTile2 1:1,含
 *  slope/halfBrick 两排除——isSolid 宽谓词含坡/半砖,SolidTile2 不含,借道补齐）。
 *  gravDir==−1 的鼠标行翻转（:50052-50054）本仓未建模=登记（本仓无倒挂放置面）。 */
export function pickSentryLandingSpot(
  store: { inBounds(x: number, y: number): boolean; isSolid2(x: number, y: number): boolean },
  mouseWX: number, mouseWY: number, itemId: number, maxTilesY: number,
): { x: number; y: number } {
  const floating = itemId === 3571 || itemId === 3569 || itemId === 5463;
  const tx = Math.floor(mouseWX / 16);
  let ty = Math.floor(mouseWY / 16);
  if (!floating) {
    const solidRow = (row: number): boolean =>
      store.isSolid2(tx - 1, row) || store.isSolid2(tx, row) || store.isSolid2(tx + 1, row);
    for (; ty < maxTilesY - 10 && !solidRow(ty); ty++) { }
    ty--;
  }
  return { x: mouseWX, y: ty * 16 - 24 };
}

/** ★C16b-R17（2026-10-12）AI_137 场域光带带式发射（:69983-69985 1:1）：PlotTileLine(
 *  Center±UnitX×40, 80f, CastLightOpen) 的 tile 覆盖 = 列 floor((x−hw)/16)..floor(
 *  (x+hw)/16) × 行 floor((y−hh)/16)..floor((y+hh)/16)（Utils.cs:2479-2501 perp=
 *  (0,±width/2)，水平线逐列+每列垂直跨），CastLightOpen（DelegateMethods.cs:729-745）
 *  对【开放格】逐格 AddLight 满色——开放格谓词 !active∨inActive∨tileSolidTop∨!tileSolid
 *  ≡ repo !isSolid（SOLID_LUT≡tileSolid∧!tileSolidTop；平台 tileSolidTop=亮、实心砖=
 *  暗，坡/半砖属型级判定不入门）。消费=Game 实体光循环 band 通道（MinionProj.lightBand，
 *  688-690 闪电光环专用；判别测试直驱真 TileStore+Lighting 引擎） */
export function auraLightBandCast(
  st: { inBounds(x: number, y: number): boolean; isSolid(x: number, y: number): boolean },
  band: { x: number; y: number; hw: number; hh: number; rgb: readonly [number, number, number] },
  addLight: (tx: number, ty: number, r: number, g: number, b: number) => void,
): void {
  const x0 = Math.floor((band.x - band.hw) / 16), x1 = Math.floor((band.x + band.hw) / 16);
  const y0 = Math.floor((band.y - band.hh) / 16), y1 = Math.floor((band.y + band.hh) / 16);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (!st.inBounds(tx, ty) || st.isSolid(tx, ty)) continue;   // CastLightOpen 开放格门
      addLight(tx, ty, band.rgb[0], band.rgb[1], band.rgb[2]);
    }
  }
}

/** ★BJ630-R2（2026-10-12）哨兵出膛中心化（NewProjectile :10879-10880 verbatim：
 *  `position.X = X − width*0.5; position.Y = Y − height*0.5`——X/Y=【中心】）：
 *  pickSentryLandingSpot 返回值 = NewProjectile 中心点（spawnY=i×16−24 对 377=地表行顶
 *  −40）。此前 Game.SENTRY_WAND 支直喂 MinionProj top-left 构造 = 整盒低半高（377
 *  +25px → 出膛盒底已嵌地 10px → 实心下行承接门 oldBottom≤tileTop（Collision.cs:2394）
 *  只捕下一行顶 → 静驻嵌 16px、足=表面+19）= 用户实报「贴图陷 1 格」根因（F3 盒叠进
 *  地砖目测「正常贴地」；平台面靠 BJ-C9-SP embedPlatSnap 分支补偿故未显）。中心化后
 *  盒底=面上 15px → 承接门常规可达 → 静驻贴面（盒底=面顶）、足=表面+3、slice 缘+5
 *  = BJ612「微陷 5px」真值；「嵌 10px 驻留」系同根 top-left 误读的补偿面
 *  （embedPlatSnap spawn 输入随之消失=休眠保留,BJ608 收窄面零动）。 */
export function sentrySpawnBox(
  pid: number, center: { x: number; y: number },
): { x: number; y: number } {
  const b = minionTrueBox(pid);
  return { x: center.x - b.w / 2, y: center.y - b.h / 2 };
}

/** 随从/哨兵专属召唤音（生成后首帧起按 at 节拍各播一次）——原版来源：
 *  · 1093/1094/1112/1113 Pal 随从：弹幕 AI soundDelay 双声（Projectile.cs:350 初值 0，
 *    `--soundDelay == -20` 第 20 拍家族叫声 PalCattiva :50099-50102 / PalFoxparks
 *    :59119-59122，音量 0.35=SoundID.cs:1074/:1086；`== -1` 首拍 PalSummon
 *    :50103-50106/:59123-59126，音量 0.15=SoundID.cs:1072）——tick1=PalSummon、tick20=家族叫声
 *    （1093/1094 与 1112/1113 同序，曾登记相反已订正）
 *  ★R31 §A③ 双播收口（2026-08-25）：下列条目已删——物品 UseSound 由 Game.playUseSound
 *  经 vanilla-itemusesound.json 真值单播,本表再播即双声:
 *   · 970/1022：5114→AbigailSummon / 5456→DeadCellsMushroomSummon 两键已在表;
 *   · OOA 十二哨兵弹 663-693：3818-3834 → DD2_DefenseTowerSpawn 十二键已在表。
 *  其余随从族原版统一 UseSound=Item44（Game 侧 summon 通道已播，此处不重复） */
const MINION_SUMMON_SFX: Record<number, Array<{ track: string; vol: number; at: number }>> = {
  1093: [{ track: 'pal_summon', vol: 0.15, at: 1 }, { track: 'pal_cattiva', vol: 0.35, at: 20 }],
  1094: [{ track: 'pal_summon', vol: 0.15, at: 1 }, { track: 'pal_foxparks', vol: 0.35, at: 20 }],
  1112: [{ track: 'pal_summon', vol: 0.15, at: 1 }, { track: 'pal_cattiva', vol: 0.35, at: 20 }],
  1113: [{ track: 'pal_summon', vol: 0.15, at: 1 }, { track: 'pal_foxparks', vol: 0.35, at: 20 }],
  // 1098/1123 钻地龟出场双声（AI_204 :39222-39231：soundDelay-- ==-1 → PalSummon
  // 0.15（tick1）/ ==-20 → PalDigtoise 0.35（tick20）——SoundID.cs:1072/:1094 同族节拍；
  // 物品 5667/6174 无 UseSound 行,非双播）
  1098: [{ track: 'pal_summon', vol: 0.15, at: 1 }, { track: 'pal_digtoise', vol: 0.35, at: 20 }],
  1123: [{ track: 'pal_summon', vol: 0.15, at: 1 }, { track: 'pal_digtoise', vol: 0.35, at: 20 }],
};

/** 随从射弹出膛音（原版在弹幕 AI 首帧 localAI[0]==0 处 PlaySound，等效落射弹生成帧）：
 *  374 毒刺 Item_17（:52670）/ 376 小鬼火球 Item_20（:52684）/ 378 蛛卵 Item_17（:23398）/
 *  967 猎犬弹 Item_60（:24971）/ 195 矮人掷矛 Item_17（:56298-56302）/ 389 双子激光眼
 *  Item_12（:56263-56267）/ 408 迷你鲨鱼龙 NPC_Killed_19（:56201-56205 legacy
 *  PlaySound(4,x,y,19)=type4 NpcKilled 库 style19,★BJ692 勘误:旧译 Item_19 系
 *  legacy 编号域误读——Item 库=type 2,整数首参是声音库编号非物品号）
 *  ——随从本体的 AI_026/AI_062 不播,但射出弹均为 aiStyle 1,吃 Projectile.AI_001 出膛
 *  音链 ai[1]==0 首拍（2026-09-03 dormant 族审计翻案:旧注"408/433/614/195/389/642
 *  原版无出膛音"只核了随从 AI 本体——433/614/642 仍属实无声,408/195/389 属 aiStyle 1 有声）。
 *  408 原版 ai[1]=num13（AI_062 :67126 传目标槽位,缺省 −1）——仅目标=0 号槽时过
 *  ai[1]==0 门;本仓射弹无 ai1 通道恒 0 → 恒按有声面播（195 的 ai[1]=num159 对 191 族
 *  恒 0、389 无 ai 参,两型原版本就每发必播） */
const MINION_SHOT_SFX: Record<number, { track: string; vol: number }> = {
  374: { track: 'Item_17', vol: 0.7 },
  376: { track: 'Item_20', vol: 0.7 },
  378: { track: 'Item_17', vol: 0.7 },
  967: { track: 'Item_60', vol: 0.7 },
  195: { track: 'Item_17', vol: 0.7 },
  389: { track: 'Item_12', vol: 0.7 },
  // ★BJ692:408 原文 :56203 PlaySound(4,x,y,19)=legacy【type 4=NpcKilled 库 style 19】
  // （LegacySoundPlayer case 4 SoundNpcKilled[num]）——非 Item_19（Item 库=type 2）,
  // 旧译错库。NPC_Killed_19=Sfx.ts case4 表 rng('NPC_Killed_',1,68) 在册文件。
  408: { track: 'NPC_Killed_19', vol: 0.7 },
};

/** 敌人最小形状（鸭子类型，避免与 Enemy 循环依赖） */
interface EnemyLike {
  cx: number; cy: number; x: number; y: number; w: number; h: number; id: number;
  dead: boolean;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
}

/** ★清偿刀 Y2：城镇 NPC 命中靶最小形状（鸭子类型,TownNPC 满足）——
 *  hurt 十参形与 Enemy.hurt 语义错位（TownNPC.ts:1403 参数序警示）:
 *  (dmg,kbx,kby,game,penPercent,flatPen,crit,force,fromPlayer,srcProjId)。 */
interface TownNpcHitTarget {
  cx: number; cy: number; x: number; y: number; w: number; h: number; id: number;
  vanillaId?: number; iframes?: number; vx?: number; vy?: number; realLife?: number | null;
  hurt: (dmg: number, kbx: number, kby: number, g: GameHooks, penPercent?: number,
    flatPen?: number, crit?: boolean, force?: boolean, fromPlayer?: boolean,
    srcProjId?: number) => boolean;
  hurtFx?: (d: number) => void;
}

/** Utils.Remap（AI_120 :42222 用；value 截断映射 [from1..to1] → [from2..to2]） */
const remap01 = (value: number, from1: number, to1: number, from2: number, to2: number): number => {
  if (value <= from1) return from2;
  if (value >= to1) return to2;
  return from2 + (to2 - from2) * (value - from1) / (to1 - from1);
};

/** XNA Vector2.CatmullRom（AI_162 :44091 样条插值） */
const catmullRom = (
  v1: { x: number; y: number }, v2: { x: number; y: number },
  v3: { x: number; y: number }, v4: { x: number; y: number }, t: number,
): { x: number; y: number } => {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * v2.x + (-v1.x + v3.x) * t + (2 * v1.x - 5 * v2.x + 4 * v3.x - v4.x) * t2 + (-v1.x + 3 * v2.x - 3 * v3.x + v4.x) * t3),
    y: 0.5 * (2 * v2.y + (-v1.y + v3.y) * t + (2 * v1.y - 5 * v2.y + 4 * v3.y - v4.y) * t2 + (-v1.y + 3 * v2.y - 3 * v3.y + v4.y) * t3),
  };
};

/** Utils.GetLerpValue（Utils.cs:738-752）：clamped 时外值钳边界 */
export const getLerpValue = (from: number, to: number, t: number): number => {
  if (from < to) { if (t < from) return 0; if (t > to) return 1; }
  else { if (t < to) return 1; if (t > from) return 0; }
  return (t - from) / (to - from);
};

/** ★BJ635（2026-10-11）AI_158_GetHomeLocation（Projectile.cs:49854-49913）1:1 折算
 *  ——雀宝宝 759 归位锚（肩头/头顶栖息位栈）。入参 = RotatedRelativePoint(MountedCenter)
 *  展开位 + player.direction + 编队位 index（AI_GetMyGroupIndexAndFillBlackList 等位）。
 *  逐项：
 *  - `Vector2 pos = Main.OffsetsPlayerHeadgear[master.bodyFrame.Y / num]; pos.Y -= 2f`
 *    （:49856-49861,num=bodyFrame.Height=56）：头饰行偏移表（Main.cs:504-525,
 *    Renderer.ts:858 HEADGEAR_OFFSET_Y 同源——静立行 0=+2 → −2 后 (0,0)）。玩家实体侧
 *    无 bodyFrame 行（帧行归渲染域）→ 按静立行 0 折算,行族 ±2px=登记近似。
 *  - mount 52/54/55/56/61 四支（:49864-49884）：本仓 MOUNT_DATA 现役 62-65 代,
 *    四支不可达,省略（登记）。
 *  - stackedIndex % 6 五档偏移 + `(0, gravDir×−16)×(stackedIndex/6)` 栈高（:49886-49906）。
 *  - 终位 = RotatedRelativePoint(MountedCenter) + (0, gravDir×−21) + pos, Floor（:49908-49912）。
 *  @pure 可独立测钉（变异面：case 表逐档删支即红） */
export function babyBirdHomeLocation(
  mcx: number, mcy: number, direction: number, stackedIndex: number, gravDir = 1,
): { x: number; y: number } {
  let px = 0; let py = 0;                     // OffsetsPlayerHeadgear[行0]=(0,2),−2 → (0,0)
  switch (((stackedIndex % 6) + 6) % 6) {
    case 1: px += direction * 8; py += gravDir * -2; break;    // :49887-49889
    case 2: px += direction * -10; py += gravDir * -2; break;  // :49890-49892
    case 4: px += direction * 10; py += gravDir * -10; break;  // :49893-49895
    case 5: px += direction * -12; py += gravDir * -10; break; // :49896-49898
    case 3: py += gravDir * -10; break;                        // :49899-49904
  }
  py += gravDir * -16 * Math.floor(stackedIndex / 6);          // :49905
  return { x: Math.floor(mcx + px), y: Math.floor(mcy + gravDir * -21 + py) };   // :49907-49912
}

/** ★台账批⑤（2026-08-31）：Utils.SolveQuadratic（Utils.cs:721-737）+ GetChaseResults
 *  （Utils.cs:651-708）1:1 —— AI_067_TryJumpingToTarget 蘑菇支蓄跃拦截速度的真预测面。
 *  旧实现"直瞄归一 ×32"在目标横向移动时永不复现 InterceptTime<120 门内交点。 */
export interface ChaseResults {
  intercepts: boolean;
  time: number;
  positionX: number;
  positionY: number;
  vx: number;
  vy: number;
}
export function solveQuadratic(a: number, b: number, c: number): [number, number] | null {
  const num = b * b - 4 * a * c;
  if (num > 0) return [(-b + Math.sqrt(num)) / (2 * a), (-b - Math.sqrt(num)) / (2 * a)];
  if (num < 0) return null;
  return [(-b + Math.sqrt(num)) / (2 * a), (-b + Math.sqrt(num)) / (2 * a)];
}
export function getChaseResults(
  chaserX: number, chaserY: number, chaserSpeed: number,
  runnerX: number, runnerY: number, runnerVx: number, runnerVy: number,
): ChaseResults {
  if (chaserX === runnerX && chaserY === runnerY) {
    return { intercepts: true, time: 0, positionX: chaserX, positionY: chaserY, vx: 0, vy: 0 };
  }
  if (chaserSpeed <= 0) {
    return { intercepts: false, time: 0, positionX: 0, positionY: 0, vx: 0, vy: 0 };
  }
  const dx = chaserX - runnerX, dy = chaserY - runnerY;
  const dist = Math.hypot(dx, dy);
  const rs = Math.hypot(runnerVx, runnerVy);
  let time = 0, px = 0, py = 0;
  if (rs === 0) {
    time = dist / chaserSpeed;
    px = runnerX; py = runnerY;
  } else {
    const a = chaserSpeed * chaserSpeed - rs * rs;
    const b = 2 * (dx * runnerVx + dy * runnerVy);
    const c = -dist * dist;
    const roots = solveQuadratic(a, b, c);
    if (!roots || (roots[0] < 0 && roots[1] < 0)) {
      return { intercepts: false, time: 0, positionX: 0, positionY: 0, vx: 0, vy: 0 };
    }
    time = roots[0] > 0 && roots[1] > 0 ? Math.min(roots[0], roots[1]) : Math.max(roots[0], roots[1]);
    px = runnerX + runnerVx * time;
    py = runnerY + runnerVy * time;
  }
  return {
    intercepts: true, time, positionX: px, positionY: py,
    vx: (px - chaserX) / time, vy: (py - chaserY) / time,
  };
}

/** Collision.WetCollision（1458 Collision.cs:1575-1650）盒级 1:1 折算：
 *  内探针 = 盒中心 min(10,W)×min(⌊H/2⌋,H) 小盒；扫 盒左列−1..右下+2 外扩窗，
 *  液格水面 Y += (256−液量)/32×2（水面段高同步截短）；坡面格带上格带液同判湿。
 *  台账批⑥：旧实现仅中心单格 liquid>0——顶缘浸水浅滩漏判/半浸早判两向漂移
 *  ★V1（NB-D 遗留收口 2026-09-03）：坡面支补 tile.active() 在场门——原文
 *  `else if (!Main.tile[i,j].active() || …slope()==0 || j<=0 || …) continue;`
 *  （Collision.cs:1632-1634,active() 纯在场位）旧写裸 slope>0 靠"slope 只随活性
 *  写入"的写侧不变量成立,formally 收口为显式在场门：与 npcLiquid.wetCollision
 *  L1 勘误同款——本仓 isActive 是 nactive() 口径会漏致动斜坡,禁用。
 *  ★红蓝对抗 F8（2026-09-04）：幽灵保域后 type!==0 亦非纯在场位——残型格
 *  flags=0,type≠0（wld 导入/生成期 active(false) 留型）须判干,改读 flags bit0
 *  （=active() 位本体;四副本之 MinionProj 漏网,先例 npcLiquid/SmartSelect/
 *  WeaponProj 三副本 2026-09-03 A-F3 已改）；调用面全量传 TileStore（含
 *  type/flags 通道），零调用侧改写 */
export function wetCollisionProbe(
  st: { w: number; h: number; liquid: Uint8Array; slope: Uint8Array; type: Uint16Array; flags: Uint8Array; idx(x: number, y: number): number },
  x: number, y: number, width: number, height: number,
): boolean {
  const cxs = x + width / 2, cys = y + height / 2;
  const pw = Math.floor(Math.min(10, width));
  const ph = Math.min(Math.floor(height / 2), height);
  const bx = cxs - pw / 2, by = cys - ph / 2;
  const i0 = Math.max(0, Math.floor(x / 16) - 1);
  const i1 = Math.min(st.w - 1, Math.floor((x + width) / 16) + 2);
  const j0 = Math.max(0, Math.floor(y / 16) - 1);
  // 上界 = Main.maxTilesY−40（:15806/:15809 字面,Underworld 带扫描裁剪）——仅在
  // 真有该带的世界（h≥200;SW 实际生成图均 ≫ 此值,行为与原版逐字节一致）生效;
  // vitest 小桩（H≈120 等,无地狱带概念,水深常落在字面裁剪带内）回退整高,
  // 否则既定湿判契约（trusty-mounts ⑥ 浅池 ×2 等）被假阳性剪空
  const yCap = st.h >= 200 ? st.h - 40 : st.h - 1;
  const j1 = Math.min(yCap, Math.floor((y + height) / 16) + 2);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const idx = st.idx(i, j);
      if (st.liquid[idx] > 0) {
        const drop = ((256 - st.liquid[idx]) / 32) * 2;
        const top = j * 16 + drop;
        const segH = 16 - Math.trunc(drop);
        if (bx + pw > i * 16 && bx < i * 16 + 16 && by + ph > top && by < top + segH) return true;
      } else if (st.flags[idx] !== 0 && st.slope[idx] > 0 && j > 0) {   // :1632 !tile.active()——flags bit0（V1+F8：曾用 type≠0 代读,幽灵残型坡+上液误判湿）
        if (st.liquid[st.idx(i, j - 1)] > 0 && bx + pw > i * 16 && bx < i * 16 + 16
          && by + ph > j * 16 && by < j * 16 + 16) return true;
      }
    }
  }
  return false;
}

/** Projectile.CanHitWithOwnBody（1458 :12428-12462）本体四试视线 1:1 折算：
 *  CanHit(整盒→整盒) ∪ CanHitLine 三组端点对（朝向前沿中点 ±h/3 档）。
 *  ExtendedCanHitCheckRange 族随从型无登记（ProjectileID.Sets 空表）不折算；
 *  ownerHitCheckDistance=1000 门由调用方射程承载。台账批⑦⑧共用。 */
export function canHitWithOwnBodyBox(
  store: import('../world/TileStore').TileStore,
  sx: number, sy: number, sw: number, sh: number, facing: number,
  ex: number, ey: number, ew: number, eh: number,
): boolean {
  if (canHit(store, sx, sy, sw, sh, ex, ey, ew, eh)) return true;
  const ox = sx + sw / 2 + facing * sw / 2;
  if (canHitLine(store, ox, sy + sh / 2 - sh / 3, 0, 0, ex + ew / 2, ey + eh / 2 - eh / 3, 0, 0)) return true;
  if (canHitLine(store, ox, sy + sh / 2 - sh / 3, 0, 0, ex + ew / 2, ey + eh / 2, 0, 0)) return true;
  if (canHitLine(store, ox, sy + sh / 2, 0, 0, ex + ew / 2, ey + eh / 2 + eh / 3, 0, 0)) return true;
  return false;
}

/** Projectile.CanHitWithMeleeWeapon（1458 :12415-12426）：玩家四点版（gravDir 平地恒 1）。
 *  台账批⑦ IsInRangeOfMeOrMyOwner 主侧门。 */
export function canHitWithMeleeWeaponBox(
  store: import('../world/TileStore').TileStore,
  px: number, py: number, pw: number, ph: number, pFacing: number,
  ex: number, ey: number, ew: number, eh: number,
): boolean {
  if (canHit(store, px, py, pw, ph, ex, ey, ew, eh)) return true;
  const ox = px + pw / 2 + pFacing * pw / 2;
  if (canHitLine(store, ox, py + ph / 2 - ph / 3, 0, 0, ex + ew / 2, ey + eh / 2 - eh / 3, 0, 0)) return true;
  if (canHitLine(store, ox, py + ph / 2 - ph / 3, 0, 0, ex + ew / 2, ey + eh / 2, 0, 0)) return true;
  if (canHitLine(store, ox, py + ph / 2, 0, 0, ex + ew / 2, ey + eh / 2 + eh / 3, 0, 0)) return true;
  return false;
}

/** 接触伤害的每敌冷却（原版 localNPCImmunity 1:1）：
 *  - Projectile.Update :15330 每 update 先整体衰减（DecrementLocalImmuneTimeCounters
 *    :15926-15941），再跑碰撞（Damage_PVE :11878-11884 要求 array[i]==0）
 *  - 命中写入 immuneArray[victimIndex] = localNPCHitCooldown（:14179 分支，
 *    同时 targetNPC.immune[owner]=0 —— 不再吃玩家的全局受击免疫）
 *  ⇒ 命中后恰好 cd 个 tick 再命中（cd=3 → 每 3t 一跳）
 *  ★台账批③修正：此表只承载 localCD≥0 的显式族；localCD=-2 缺省族【不进本表】
 *  （原版两分支全跳过 → 尾支写 npc.immune[owner]=10 玩家全局窗），见 contact()
 *  的 CONTACT_PLAYER_WINDOW 支与 CONTACT_CD_TABLE。旧头注"不吃玩家免疫"对
 *  -2 缺省族恰相反——同玩家一切来源共享 NPC 单窗。 */
export class MinionHitCd {
  private map = new Map<number, number>();
  /** ★BJ697 债①（BJ696 登记）：逐 t 全表递减（原版 DecrementLocalImmuneTimeCounters
   *  Projectile.cs:17365-17385,Update 头 :15330 每 t 恰一次,先于一切 AI/伤害）。
   *  旧实现=「读位衰减」（ready 时才 −1）→ 离靶冻结：敌不在判定窗的拍不衰减,
   *  跨次冲刺烧表（BJ696 探针 63/77 拒帧=DPS 3-5× 损耗面）。修后 ready 纯读化
   *  （=原版 :12595 flag2 表读无副作用）,衰减由宿主 fixedUpdate 头驱动（龙链段
   *  与头共享实例,唯头 tick——见调用位注）。-1 永免标记不衰（LocalImmunityTable
   *  同语义形位;本表当前无 -1 写位）。 */
  tick(): void {
    for (const [k, v] of this.map) {
      if (v > 1) this.map.set(k, v - 1);
      else if (v === 1) this.map.delete(k);
    }
  }
  /** 纯读门+过门写（原版 :12595 读 / :14175-14179 写梯同位）。
   *  ★BJ703-F 真回归修正（2026-10-21）：阻断改【值门】>0——−1 永免标记在原版
   *  idStatic uint 表=回绕 MaxValue 免疫面零阻（P.cs:606-608/:14033-14036 亲读核;
   *  旧读位衰减实现 t>1 判同相=−1 从不阻断），且 rainbowBurstHitFace 有
   *  ready(en.id,−1) 现役写位（C16a-F3,MinionProj:7910）——BJ697 重写时的
   *  「本表当前无 -1 写位」为假信念，has() 阻断令彩虹爆碎同 tick 后续爆+Kill
   *  二段全拒（红=bj639 ②+bj452 N3f）。值门=cd>0 族零扰动,−1 条目过门重写
   *  自身（tick 不衰,与旧实现逐位同相）。 */
  ready(id: number, cd: number): boolean {
    if ((this.map.get(id) ?? 0) > 0) return false;
    this.map.set(id, cd);
    return true;
  }
}

/** ★BJ515 债①：AI_177 localNPCImmunity 1:1 表（Projectile.cs:368 全表数组 +
 *  :14175-14179 命中写 `immuneArray[victim]=localNPCHitCooldown`（917/1036 cd=20
 *  :8713-8714/:9777-9778）+ :17365-17385 DecrementLocalImmuneTimeCounters 逐 t
 *  全表递减（>0 才减,-1 永免标记不衰）。
 *  与 MinionHitCd（读位衰减=消费驱动节拍,离靶冻结）不同：本表由宿主 fixedUpdate
 *  族支头显式 tick()——vanilla Update 头先衰减后 AI（:45997 锁检查/:45925 扫描门
 *  读「衰减后」值）逐位同相。消费面（BJ515）：ai177FindTarget 锁失效门 + 扫描门。 */
export class LocalImmunityTable {
  private map = new Map<number, number>();
  /** :17378-17384（Update 头,逐 t） */
  tick(): void {
    for (const [k, v] of this.map) {
      if (v > 1) this.map.set(k, v - 1);
      else if (v === 1) this.map.delete(k);
    }
  }
  /** 当前剩余免疫 t（0=可锁/可命中）——:45925/:46000 读形 */
  peek(id: number): number { return this.map.get(id) ?? 0; }
  /** :14178 命中写形（窗内拒,窗满写 cd） */
  ready(id: number, cd: number): boolean {
    if ((this.map.get(id) ?? 0) > 0) return false;
    this.map.set(id, cd);
    return true;
  }
}

export class MinionProj extends Entity {
  w = 16; h = 16;
  dead = false;
  damage: number;
  knockback: number;
  projId: number;
  /** ★FX34c 弹幕域 hoik=true（Body.hoik 注:原版 Projectile 全路径 true——随从弹
   *  tileCollide 族同 HandleMovement 面,原版可穿 Hoik 单向墙） */
  hoik = true;

  // ---- ★通用湿段（Projectile.cs:16895-17113 全体弹共用段;2026-09-06 杂项弹簇批,
  //  红队 R3 定谳域=1.4.5 新随从八型;2026-09-07 蓝队 K 移交批扩=旧受段族十三型）----
  //  逐 id 豁免核对（SetDefaults P.cs 逐块,【均无 ignoreWater 行】= 全受段,
  //  projectileData 数据面同向）：R3 八型 1022(:9669-9681)/1093(:10197-10210)/
  //  1094(:10212-10222)/1098(:10243-10252)/1112(:10364-10377)/1113(:10379-10389)/
  //  1118(:10452-10464)/1123(:10506-10515);旧受段族（蓝队 K 批逐块复核同向）
  //  317(:4101-4111)/390-392(:4744-4756)/393-395(:4757-4769)/758(:7816-7829)/
  //  833-835(:8084-8125)/917(:8703-8714)/1036(:9769-9780)。
  //  · 本批不接的主类 id（红队域外,豁免面亦核对备查）：AI_062 五射手 373(:4565)/
  //    375(:4589)/407(:4880)/423(:4962)/613(:6600)/963(:9102)、533(:5999)/387(:4700)/
  //    388(:4716)/653(:7014)/627(:6737)/628(:6733)/831(:8069)/970(:9184)/946(:8924)/
  //    755(:7779)/1119(:10466) 均 ignoreWater=true=豁免。
  //  · 1106 狐火（MinionShot ∈ IsDestroyedByWater{85,15,188,34,1097,1106},
  //    ProjectileID.cs:287;SetDefaults :10305-10317 无 ignoreWater 行=受段）走
  //    Arrow 载体（foxChannel 支 spawn）——ARROW_DESTROYED_BY_WATER（Arrow.ts:546）
  //    已含 1106,水death 消亡面已接 killNow,本类湿段 hooks 不涉（域内 id 均不在
  //    IsDestroyedByWater 表,kill 钩恒空）。
  //  插位=tick 头（fixedUpdate 首）+★AI 湿旗读相=上拍快照 wetAi（2026-09-08 定谳批,
  //  Terarria1457/Terraria/Projectile.cs 逐读点核）：
  //  【①消费者定谳】原版 Update 子步序=AI(:16880) → 湿段(:16895-17113) → Shimmer
  //  (:17114) → HandleMovement(:17122) → AI 读【上一子步】段值。AI_067 湿旗消费全集：
  //  :51027 海盗俯扑门 !wet（flag=393-395 → pirateStep 消费）/ :51084 卡提瓦俯扑门
  //  !wet（flag8=1093/1112——★2026-09-08 续单两门补接:!wet（读相 wetAi）+ai[1]==0
  //  （=palA1,:50954 出扑归零）;湿中下落已由共享尾 :52114 支让位承接=原文两支以
  //  wet 互斥）/ :51616 贴地跳 ×2 共享核（`if (velocity.Y==0f)` 段
  //  flag 全族可达——flag6/8/9=1022/1093/1112/1118 亦消费,旧注「R3 八族 vanilla
  //  零消费」有误已纠;仓内消费位=tigerBody/pirateStep/frogStep/palGroundStep/
  //  mushBoiStep 全读 wetAi）/ :52114 TryJumpingToTarget wet∧vy>0∧!shouldFallThrough
  //  →视作贴地+共享尾 :52151-52164（★2026-09-08 续单 1:1 补接=
  //  ai67TryJumpingToTargetTail,五家族调用位随原文 :51024 时序置结算段/俯扑门前;
  //  :52119 系 vanilla `_=` 丢弃死码;shouldFallThrough 域内死码、ai[0]==3 档
  //  num4=16 与 :51212 栖点调用位未折算=登记,见 helper 注）。AI_026 :60716/:60734
  //  属 774/1046 帧 选支（域外）;AI_204/AI_062 零消费 ✔。
  //  【②相位差定谳】湿段采样位两序同位（=上拍位移后位）;差在 AI 读相:vanilla 读
  //  上拍段值,旧实现读当拍段值——稳态同值,分叉仅「运动中跨液面拍」（步行横移/
  //  坠落跨水面且当拍有 ×2/俯扑判定;×2=起跳速 2×,贴水跳 2 倍高,可感）→ 修。
  //  【③挪位不可达→快照刀】原版序须把湿段插到各族 AI 与位移之间,而本类家族 AI 与
  //  位移同函数体、ai0=1/2/4/5 早退 return 15+ 处会整跳湿段（溅花/wetCount/旗维护
  //  停摆,劣于相位差）→ 保留 tick 头插位,消费位改读 wetAi 上拍快照（=上拍段尾
  //  this.wet,与 vanilla AI 读上拍段值逐位同源;首拍=出生预置值——vanilla
  //  NewProjectile :10886-10893 时点先于首拍 AI,预置先行单跑=首拍当拍段同位）。
  //  probe 消费位（pal/mush）随批退役归一（wetCollisionProbe 本体保留=unit 钉测/
  //  台账批⑥面）。AI 中途瞬移拍（>2000 回收/虎扑链直写位）:AI 读值两序同为瞬移前
  //  采样（快照=上拍位,原版=上拍段采样位,同向）;湿段副作用（溅花）采样位仍取拍头
  //  位=瞬移前,较原版（AI 后=瞬移后位）晚 1 拍触发,登记近似（随原插位批）。
  //  阻尼=各族位移位乘 projWaterDragFactor（HandleMovement :17721-17764 湿支只对
  //  tileCollide=true 宿主跑——917 SetDefaults tileCollide=false(:8708) 与 317
  //  归位态 ai[0]==1（aiStyle 54 :29079 else 支;:29042 attack 态置真）不适用,各支留锚）。
  //  杀拍口径（Arrow.ts ⑥配方逐位核）：主类全部杀位=哨兵寿命(:4294)/携行失主
  //  (:4309)【哨兵八型不涉,且哨兵 id 全豁免（663/665/667:7137/677-679:7248/
  //  688-690:7332/308:4004/377:4622/966:9150/1025:9714/641:6923/643:6936）】/
  //  随从失主(:4910)/钻地龟四杀位(digtoiseStep :2143/:2144/:2168/:2176)——
  //  全部在 tick 头调用【后】→ 湿段杀拍恒跑,双调用点/防双跑机不适用
  //  （单调用点天然覆盖）;palGroundStep/mushBoiStep/foxChannel 零杀位。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐拍 −1） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10893 等价;共享体首调自做） */
  presetDone = false;
  /** ★AI 湿旗读相=上拍段值快照（2026-09-08 定谳批,消费者/相位差/挪位不可达三段
   *  定谳见类字段块头注①②③）：vanilla AI(:16880) 先于湿段(:16895) → AI_067 湿旗
   *  消费者读【上一子步】段值;本类家族 AI 与位移同函数体无法拆序 → tick 头湿段
   *  保留,家族消费位改读本快照（fixedUpdate 湿段块于每拍段体前赋值=上拍段尾
   *  this.wet,与 vanilla AI 读值逐位同源;首拍=出生预置值）。阻尼仍读 this.wet
   *  （HandleMovement :17721 本子步湿段后旗,原文同相）——勿把阻尼位改读本字段。 */
  private wetAi = false;
  /** ★BJ520②：lavaWet AI 读相快照（上子步段值——vanilla AI_026 岩浆逃逸门 :59170
   *  读 Projectile.lavaWet 的时点=AI(:16880) 先于湿段(:16895),2026-09-08 定谳批
   *  wetAi 同口径）。首拍=构造值 false（NewProjectile 预置 :10886-10893 不写
   *  lavaWet,projWetSection 注④）=vanilla 首拍 AI 读值同源;后续拍=上拍段尾值。
   *  粘滞位：湿段只置不清（:16906-16911）,!wet 三清（:17103-17108）。 */
  private lavaWetAi = false;

  /** true=哨兵（定点炮台，独立于随从上限） */
  sentry: boolean;
  /** 1457 哨兵携带态（原版 ai[2]==1f，IsSentryBeingCarried :80527-80530）：被
   *  accSentryBackpack 四件（6172/6175/6176/6177）拾起背在身上——随玩家移动、
   *  照常开火、仍占哨兵上限（WipableTurret :530-540 不豁免携带态）；拾起后无
   *  放下机制，直至消亡/被驱逐（UpdateMaxTurrets :53699-53727 同池） */
  carriedByBackpack = false;
  /** 哨兵剩余寿命（t；随从不耗） */
  life: number;
  /** 同列槽位序（多随从环形悬停错位） */
  slot: number;
  private ownerRef: () => Player | null;

  /** 弹幕染料通道 vid（清偿刀 N 2026-09-30）——GetProjectileDesiredShader 1:1：
   *  随从族（minion 旗取数据面 vanillaProjectiles.minion=SetDefaults 照录;哨兵
   *  663/677 族原版 minion=false=无通道）→ cMinion=唯一源 CritterShampoo(4762)
   *  配对染料（Player.cs:9832-9834 UpdateItemDye 链）;623 虽 minion=true 但 switch
   *  覆写 → cPet（Main.cs:22457-22459）;818 扑击弹同 switch → cMinion（TigerPounce
   *  同款）。owner 引用=本体 Player,窄接口读 inv;缺 → 0。 */
  private minionDyeVid(): number {
    const p = this.ownerRef();
    const inv = (p as unknown as { inv?: DyeInvSource } | null)?.inv;
    if (!inv) return 0;
    const ch = dyeChannelsOf(inv);
    if (!(ch.cPet > 0) && !(ch.cMinion > 0)) return 0;
    return getProjDesiredDyeVid(
      {
        vid: this.projId,
        minion: !!projectileData(this.projId)?.minion,
        damage: this.damage,
        aiStyle: projectileData(this.projId)?.aiStyle,
      },
      ch,
    );
  }
  hitCd = new MinionHitCd(); // dragon 全链共用实例
  /** ★BJ515 债①：AI_177 localNPCImmunity 专用表（LocalImmunityTable 注）——
   *  仅 917/1036 族支初始化（:6800 支头 ??=）;contact() 探到非空即改走本表写读。
   *  null = 其余全族 hitCd 读位衰减既有面零变化。 */
  ai177Immunity: LocalImmunityTable | null = null;
  /** ★BJ515 债①：AI_177 原版锁槽（ai[0]=目标+1,:45997-46020）——持锁跨拍,
   *  失效门 = !CanBeChasedBy ∨ localNPCImmunity>0（:46000）;失锁才重扫。仅 917
   *  消费（★BJ516①：1036 已重路由 AI_067 flag7 webStep——其索敌无锁无免疫门,
   *  免疫表载体仍共用:usesLocalNPCImmunity=true+cd=20 :9776-9778 系接触写位）。 */
  ai177Lock = -1;
  /** ★BJ516①（2026-10-05）：1036 flag7 帧通道（AI_067 :51670-51686——地面静 0/
   *  行走 fc>4 翻页循环全 20 帧/空中 1;draw 走 webFrame 支） */
  webFrame = 0;
  webFrameCd = 0;
  /** ★BJ516①：ai067WalkChase 重力前 velocity.Y 捕获（AI_067 帧段读相=碰撞后重力前
   *  :51670 段序,:52049 重力在帧段后——capturePreGravVy 承载,缺省 null 零开销）。
   *  ★BJ-C3/F1-F3（2026-10-06）消费面扩：海盗 393-395/flinx 951 帧机（:51805/:51767）+
   *  TryJumpingToTarget 跳尾 :52113（walkChase 四族全量 capturePreGravVy;独立形族
   *  pal/mush/frog 从不调 walkChase 恒 null=消费端 ?? 直读回落,原相不动） */
  lastWalkPreGravVy: number | null = null;
  /** ★BJ516④（2026-10-05）：AI_026 尾族（191-194/266/1094/1113）ai[0]/localAI[0]
   *  状态槽——0 地面态（num150/num151 转向-开火面 :62677-62707）/1 归位飞行
   *  （num92 门 :61292-61345 + num101/num112 逼近 :61395-61634）;localAI[0]=接敌
   *  记账 60（:62693）/归位门加程（:61295-61300） */
  a026A0 = 0;
  a026L0 = 0;
  /** ★BJ516④：266 friendly 翻转载体（:62977/:63016——接触伤只在接敌窗;191-194/
   *  1094/1113 SetDefaults friendly=true 恒开不经此槽） */
  a026Friendly = false;
  /** ★BJ517⑤（2026-10-05）：191-194/266 绘制域 spriteDirection 镜（原版值直存,
   *  与 AI 侧 facing=direction 分离——CanHitWithOwnBody 探针读 direction :12437,
   *  191-194 num143/144 动态项读 direction Main.cs:30490-30498,两消费面不得反）。
   *  原版：常驻相 sd=−direction（:63319-63329,313 唯一豁免）+266 地面 flag27
   *  朝玩家覆写（:65481-65487）+返程相速度规则（:61628-61638,vx>0.5→−1/vx<−0.5
   *  →+1 死区保旧）。draw 侧 drawFlipDir() 消费 */
  a026SpriteDir = 1;
  /** ★BJ517③（2026-10-05）：266 帧机分相槽（MINION_FRAMES[266] 匀速近似退役）——
   *  空中 vy≠0：fc>4 → frame++,frame==0∨≥8 → 1（循环 1-7,每 5t,:65466-65477）;
   *  地面 vy==0：fc>7 → frame++,frame==1 → 5,(1..4)∨≥8 → 0（0/5/6/7 每 8t,
   *  :65484-65500）+返程机 :62434-62444（fc>5,frame<8∨≥12 → 8,循环 8-11）。 */
  sl266Frame = 0;
  sl266Fc = 0;
  /** ★BJ517②：191-194 返程飞行帧（:61623-61627 frame<12 → rand(12,18)——掷后
   *  冻结：per-type 帧链无 flag6 项,无推进;地面态恢复 −1=不接管 draw 帧选） */
  a026RetFrame = -1;
  /** ★BJ518②（2026-10-05）：191-194 地面态帧机（AI_026 flag6 块 :64660-64726）——
   *  攻击 ai[1]>0（=shootCd 槽,BJ516④ 同账）：localAI[1](=a026Lai1) 0→1 钉 frame=1,
   *  fc>4 翻页,≥4 归 0 冻结;地面 vy==0：flag27 静立 0 / |vx|>0.8 计步 fc+=⌊|vx|⌋+1
   *  >6 翻页 5-10 循环 / 其余归 0;空中 vy≠0：帧 4。a026F6Frame=−1=未落（draw 兜底）。
   *  ★同域定谳（BJ518 括深 4 机械验证）：flag6/flag8 块尾各带 velocity.Y+=0.4 封 10
   *  （:64721-64726/:64826-64831）——旧「191-194/1094/1113 地面态零重力=悬停」系误读
   *  （重力在帧块内,非 266 式独立竖直段）;★BJ519①（2026-10-05）重力面已落
   *  （ai026TailGround 尾 else-if 支,与 266 重力同折相）。 */
  a026F6Frame = -1;
  a026F6Fc = 0;
  a026Lai1 = 0;
  /** ★BJ519①：AI_026 尾族「碰撞后、重力前」velocity.Y 快照（意图相读相载体）——
   *  原版 AI 意图段（flag8 flag26 攻击制动 :63014-63018 `velocity.Y==0` 等）读的
   *  velocity.Y=上拍块尾重力写入后经 post-AI 碰撞解算的值（落地恒 0）;本仓折相
   *  moveAndCollide 先行,重力在拍尾落 → pre-move 直读恒带 +0.4 残留 → 制动门死。
   *  快照捕获位：ground 态跳梯块后（:5310 对齐原版帧块读相=碰撞后重力前）;flight 态
   *  return 前（原版 flight tileCollide=false 无碰撞解算,velocity 直通=同相）。
   *  266 :5274 跳敌门 `vy===0` 同病=BJ516④ 既有面未动（登记债,ai026TailGround 注）。 */
  a026VyCollide = 0;
  /** ★BJ516⑤（2026-10-05）：1025 藤壶哨站 ai[0] 落位状态机（AI_197 :41033-41145+
   *  HandleTileCollision :40972-41031——0 悬浮/1 吸顶;sFrame=吸顶爬行帧 0-2 随机,
   *  悬浮帧 3） */
  sAttach = 0;
  sFrame = 0;
  /** ★BJ517⑧（2026-10-05）：aiStyle 53 哨兵帧机（AI_053_FrostHydra :37942-38110——
   *  308/377/966 SetDefaults aiStyle=53 :4003/:4621/:9149 全走本支）——birth 面：
   *  377 frame=4（:37963 仰射姿）/966 ai[1]=−1+frame=0（:37976-37977,ai[1] 目标槽
   *  仓内无消费位=零观测差,frame=0 恒冻结）;扇区帧机（:38053-38078）308=sector×2
   *  (+1 bonus sCool>40∧L1==0)/377=sector,fc=8（冷却尽 4）;无目标奇帧回落
   *  （:38098-38103）。s53Frame=−1 哨兵=birth 前;draw 消费后 age/8 兜底对三型退役。
   *  ★BJ518⑤（2026-10-05）966 ai[1] 写梯销案定谳：全 37942-38110 段 ai[1] 仅三处=
   *  birth −1（:37976）/966 变更写 targetSlot+netUpdate（:38032-38035）/无第三处;
   *  AI_053_HandleSentryNPCTargeting（:40920-40966）逐拍新搜【不读】ai[1]（无粘性
   *  记忆）,全仓亦无读点 → 原版该写梯=纯 netcode 脏标（联机同步位）,单机零观测差。
   *  本仓不建模（「自造无人消费字段」反模式,pylon 旗判例）——未来哨兵目标记忆/
   *  联机面接入时按本注落。 */
  s53Frame = -1;
  s53Fc = 0;
  s53L1 = 0;
  s53PrevSd = 1;
  /** ★Z1/D1②（2026-10-02）：Projectile.numHits 等位（Damage_PVE_Inner :14263 命中尾
   *  自增;ghostHeal 率 0.2−numHits×0.05 读自增前值 :12080/:13879）——随从本体接触面
   *  持续型计数（623 拳/688-690 光环/946 体触/contact 环共享;哨兵射击/扑击 818/
   *  爆炸弹 694 族/爆裂弹 644 在原版是逐发瞬态弹,各自 numHits=0 起算,调用位直传 0） */
  pveNumHits = 0;
  private shootCd = 0;
  /** 地面型重力 */
  private ground: boolean;
  onGround = false;
  /** 存活 tick（多帧贴图动画驱动） */
  age = 0;
  /** 哨兵开火状态机（AI_130）：0=待机 1=开火动画中 */
  sFire = 0;
  sFireT = 0;
  sCool = 0;
  /** aiStyle 53 一次性初始化门（localAI[0]==0 → ai[0]=120，:27176-27181） */
  sInit = 0;
  /** 闪电光环方形场边长（AI_137 :65972-65981 净空测量；0=未测）与场中心 Y（地面点） */
  auraSide = 0;
  auraCy = 0;
  /** AI_137 电弧声循环 ai[0] 镜像（30t/僧侣T2 25t 一轮,:69955-69979——台账批 C-3472） */
  private zapCycle = 0;
  /** ★R15-F1：火爆塔 663/665/667 localAI[0] 镜像（AI_130 每拍 ++ 后 ≥300 归零,
   *  Projectile.cs:69183/:69235/:69287 三档同式,300t 周期自由环）——辉光四向脉动
   *  num434=cos(localAI[0]/100·2π)+1 的驱动源（Main.cs:34430 绘制侧消费） */
  sPulseT = 0;
  /** 朝向（哨兵 spriteDirection / 随从渲染翻转） */
  facing = 1;
  /** 攻击闪光 tick（AI_062 小鬼攻击帧 +4 门：命中后 24t） */
  attackFlash = 0;
  /** ★BJ650件1 返工（2026-10-13 实报）：whoAmI 槽位快照——原版 = 出生拍占用的
   *  Main.projectile[1000] 首个空闲槽（NewProjectile :10873 起扫槽,活期稳定、
   *  复用循环）,GetFloatingDaggerMinionGlowColor（:80377）按 whoAmI%6 取六档
   *  蓝→品红。本仓 this.id = EntityManager 全实体递增计数器（Entity.ts:150,
   *  敌/掉落/NPC/弹共享）→ id%6 档位随会话总生成数漂移（长会话恒落高档 4/5
   *  =品红——用户实报「本体右上品红半透影子=不同颜色」真凶;辉光十字与残影
   *  环两消费位同染）。对映 = 出生拍 entities.projectiles 注册表插入位（紧凑
   *  数组槽语义, EntityManager.add push/压紧 ≈ 原版首空闲槽分布）——首拍懒
   *  快照一次,未入列（夹具直驱）回退 0 档。 −1 = 未快照哨兵。 */
  whoAmI = -1;
  /** 随从世界点光（Game 实体光通道读 lightRGB——原版各 AI 的 Lighting.AddLight）：
   *  755 血蝙蝠 = Crimson CastLightOpen（:48604 GetColor=Color.Crimson(220,20,60)）；
   *  613 星尘细胞 (0.2,0.6,0.7)（:62191）；623 守护者 (0.9,0.9,0.7)（:41997）；
   *  1094 Foxparks (0.5,0.3,0.1)（:55275）；533 致命球 ai0%3≠2 橙/≡2 青（:28542-
   *  28551，无态机取橙档）；653 同伴方块白光 0.5（:46598 档位近似）。
   *  ★SW-RB11e 2026-09-10：641 月门补 (0.3,0.9,0.7)（AI_123 flag 支 :37744
   *  `Lighting.AddLight(Center, (0.3,0.9,0.7)*Opacity)`,Opacity 增幅未建模=常数档,
   *  同 613/623 口径；643 彩虹水晶原版无 AddLight 不进表）。
   *  ★BJ245（2026-09-21）：833-835 沙漠虎白光补课（BJ235 登记债清偿;旧注把
   *  虎列入「零自发光」系矛盾,反编译亲读推翻）——AI_067 flag3 支 ai[0]!=4 门内
   *  逐型 Lighting.AddLight(Center,…)（1457 Projectile.cs:50164 门/:50174-50185
   *  三型;1458 :50175-50186 同文零变更）：833=One×0.5 / 834=One×0.8 /
   *  835=Lerp(OurFavoriteColor(255,231,69),White,0.8).ToVector3()×1 =
   *  (255,250.2,217.8)/255（暖白黄）。ai[0]==4=链发后等待态不发光（tigerA0）。
   *  387/388/373/375/407/423/266/蜘蛛/阿比盖尔/龙链原版零自发光（虎已出列）。 */
  get lightRGB(): [number, number, number] | null {
    switch (this.projId) {
      case 755: return [220 / 255, 20 / 255, 60 / 255];
      case 613: return [0.2, 0.6, 0.7];
      case 623: return [0.9, 0.9, 0.7];
      case 1094: return [0.5, 0.3, 0.1];
      // ★BJ635：533 状态分色（AI_066 :30150-30155 `(int)ai[0] % 3 != 2` → (0.8,0.3,0.1)
      //  else (0.3,0.5,0.7)——ai[0]∈{2,5,8} 相位档蓝光,余档暖橙;旧恒 (0.8,0.3,0.1)）
      case 533: return this.dA0 % 3 !== 2 ? [0.8, 0.3, 0.1] : [0.3, 0.5, 0.7];
      case 653: return [0.5, 0.5, 0.5];
      case 641: return [0.3, 0.9, 0.7];   // ★SW-RB11e：AI_123 :37744（月门青绿光）
      // ★BJ606-R2（2026-10-10 三返「隔空受伤看不到弹幕」定谳补）：AI_137 场域蓝光带
      //  （:69983 DelegateMethods.v3_1=(0.2,0.7,1) + :70000-70001 PlotTileLine(
      //  Center±UnitX×40, 80f, CastLightOpen)——开放格逐格 AddLight 满色,带宽 ±40px×
      //  高 80px 以场心为锚）——尘 226 全旗 noLight=true（:70045/:70054）,域内照明
      //  全靠本带;缺带=场域/球体/电弧尘全沉环境暗（夜间/阴影=「放电全盲」本相）。
      //  ★C16b-R17 终刀（2026-10-12 用户三返暗处攻击全盲）：旧「点光折算=带心单点
      //  （点光半径≈带半高；带形偏差=登记债）」运行时复核定谳=不足——用户世界 base
      //  位点（暗处）实测带心外 lightRim=[6,21,30]≈2% 光,场缘电弧尘 α 不可见=「隔空
      //  伤害无视觉」本相（白昼开阔地探针恒绿=运行时假绿根）。按原版带式清偿：
      //  688-690 改走 lightBand 带式通道（见下）,本点光通道摘除（带含中心格,点光
      //  并挂=中心超原版亮度;vanilla AI_137 全域仅此一带,无第二光源）。 */
      // case 688/689/690 → lightBand（C16b-R17 迁出）
      // ★BJ245：沙漠虎三档白光（AI_067 :50174-50185;ai[0]!=4 门=tigerA0 镜像）
      case 833: return this.tigerA0 !== 4 ? [0.5, 0.5, 0.5] : null;
      // ★R15-F3（2026-10-11 C15 清偿）：AI_138 爆炸机关 691-693 世界光（Projectile.cs
      //  :70414 `Lighting.AddLight(base.Center, 0.6f, 0.5f, 0.3f)`——无 ai[2] 门=携行
      //  也亮,与本 getter 无条件消费面同相;691-693 SetDefaults 无 light 字段,该点光
      //  是唯一照明源）。本仓点光通道=Game 实体光循环 projectiles 桶读 lightRGB。
      case 691: case 692: case 693: return [0.6, 0.5, 0.3];
      case 834: return this.tigerA0 !== 4 ? [0.8, 0.8, 0.8] : null;
      case 835: return this.tigerA0 !== 4 ? [1, 250.2 / 255, 217.8 / 255] : null;
      default: return null;
    }
  }
  /** ★C16b-R17（2026-10-12）AI_137 场域光带原版带式（:69983-69985）：PlotTileLine(
   *  Center±UnitX×40, 80f, CastLightOpen)——Utils.cs:2479-2501 perp=(0,±width/2)=
   *  (0,±40)：逐【tile 列】floor((cx−40)/16)..floor((cx+40)/16) 扫 floor((cy−40)/16)
   *  ..floor((cy+40)/16) 垂直跨,CastLightOpen（DelegateMethods.cs:729-745）对开放格
   *  （!active∨inActive∨tileSolidTop∨!tileSolid ≡ repo !isSolid——SOLID_LUT≡
   *  tileSolid∧!tileSolidTop 逐字同构,平台 tileSolidTop 亮/实心砖暗/坡面同型级判定）
   *  逐格 AddLight(0.2,0.7,1) 满色。锚=base.Center（与伤害域同锚：携行态=本体中心
   *  cy、落位态=auraCy;sizing 失败桩（side=0）vanilla 照扫——带段在 sizing 块后,
   *  失败支 return 只免当拍）→ auraCy≤0 未测时回退本体 cy 同相。消费=Game 实体光
   *  循环 band 通道（auraLightBandCast）。 */
  get lightBand(): { x: number; y: number; hw: number; hh: number; rgb: [number, number, number] } | null {
    if (!AURA_TOWER.has(this.projId)) return null;
    return {
      x: this.cx,
      y: this.carriedByBackpack || this.auraCy <= 0 ? this.cy : this.auraCy,
      hw: 40, hh: 40, rgb: [0.2, 0.7, 1],
    };
  }
  /** 不占随从槽位（沙漠虎/阿比盖尔本体、龙身体段、星尘守护者——原版 minionSlots=0/不统计） */
  noSlot = false;
  /** 龙链父段引用（626/627/628 跟随前段） */
  parentRef: (() => MinionProj | null) | null = null;
  /** 虎扑链状态（AI_067）：ai[0] 4=链发后等待 / ai[1]=剩余等待 tick（:46702-46718） */
  private tigerA0 = 0;
  private tigerA1 = 0;
  /** ★BJ634 刃杖 864 状态机（AI_169_Smolstars Projectile.cs:46559-46700）：
   *  a169St=ai[0]（0 闲置巡航 / -1 返航重整 / 60 攻击）、a169Tg=ai[1] 攻击态
   *  目标 id（:46604-46608 ai[1]=attackTarget）、a169Rt=返航态 ai[1] 计数
   *  （:46635-46643 ai[1]++ ≥9 回 0——返航时 :14129-14141 命中特支置 0）
   */
  private a169St = 0;
  private a169Tg = 0;
  private a169Rt = 0;
  /** ★BJ635 雀宝宝 759（AI_158_BabyBird :49643-49913）：bbFrame=栖息帧通道——
   *  归位瞬移（:49747-49756）/ 肩头栖息（:49814-49823）拍 frame=projFrames-1=4 逐一拍
   *  （下拍 AI 头清 -1,帧机 :49658-49664 回归 0-3 循环=MINION_FRAMES[759] 表）。 */
  private bbFrame = -1;
  /** ★BJ635 双子 387/388（AI_066 flag29 :30084-30645）：twA0=ai[0]（0 巡航/1 归位/
   *  388 冲刺=2）、twA1=ai[1]（387 激光冷却随机游走 +rand(1,3) 上限 90 :30568-30583/
   *  388 冲刺计时上限 40）、twFc=frameCounter、twFrame=388 冲刺快循环帧通道（2t/帧
   *  cap 2 :30159-30166,常态帧走 MINION_FRAMES 表）。 */
  private twA0 = 0;
  private twA1 = 0;
  private twFc = 0;
  private twFrame = -1;
  /** ★BJ235 通用 oldPos 残影环（Projectile.cs:17197-17300 UpdateTrails 表驱动;
   *  Main.cs:30609 通用表+逐型色/帧锚特支）。undefined=未初始化/null=该 id 无
   *  记录式（随从活动集内 533/755/833/834/835 有 TrailingMode,余 id 缺省 -1 → null）。
   *  533 ai0 态机=dA0（0-2 待机/3-5 蓄力/6-8 冲刺/9-11 归位——幽灵档 :31084-31098
   *  只吃 6/7/8 冲刺三态）;833-835 色特支吃速度染（GHOST_TINT vxLen 面）+帧门锚。 */
  private ghostRing?: ProjGhostRing | null;

  /** ★BJ235 每拍记录（UpdateTrails :17198=Damage 后同序——随从无 extraUpdates,
   *  1 子步/拍;调用位=fixedUpdate 尾 contact 后=原版 Damage→UpdateTrails 同位）。
   *  533 冲刺态 dA0∈[6,8] 才展开环（:31084-31098 幽灵档 resolveGhostLoop 门）。
   *  ★BJ703-B D1 dir 记录面（2026-10-21,projGhostTrail 头注登记①勘误收编）:
   *  oldSpriteDirection 只在「原版 AI 真写 spriteDirection 的成员」非 1——
   *  755（AI_156 :52446-52451=player.direction‖sign(vx),facing 同源）/833-835
   *  （AI_067 :50753-50970 多写位,facing 同源）;533/864 原版零写位恒 1
   *  （旧 facing 记录=幽灵假翻转,864 贴图 90% 非对称=可见偏差,本刀归位）。
   *  ★BJ704-G9（2026-10-21,R1-P1-2 销案复核）533/864/388 零写位亲证钉死——
   *  「aiStyle-66 块尾 :30712 spriteDirection=direction」系结构误植（实属
   *  aiStyle-68 块尾 :30654-30729,成员仅 399/669;aiStyle-66 块 :30084-30649
   *  零 spriteDirection 写）⇒ 387/388/533 幽灵/本体恒不翻=本表【勿】收编
   *  533/388/864/946（勿重开 R1-P1-2 假信念,详 projGhostTrail.ts mirror 注）。 */
  private static readonly GHOST_FLIP_DIR = new Set([755, 833, 834, 835]);
  private recordGhostTrail(): void {
    if (this.ghostRing === undefined) {
      this.ghostRing = projTrailingMode(this.projId) >= 0 ? new ProjGhostRing(this.projId) : null;
    }
    const dir = MinionProj.GHOST_FLIP_DIR.has(this.projId)
      ? (this.facing >= 0 ? 1 : -1) : 1;   // spriteDirection 语义（登记① BJ703-B 收编）
    this.ghostRing?.record(this.x, this.y, this.rot, dir, true);
  }
  /** 守护者 AI_120 状态（ai[0]/ai[1]/frameCounter/retarget 计数） */
  private gA0 = 0;
  private gA1 = -1;
  private gFc = 0;
  private gFrame = 0;
  private gRetarget = 0;
  /** Projectile.alpha 镜像（AI_120 :45482/:45718）——状态 3 飞行段 255=隐身；
   *  离场拍 top-of-AI（ai[0]!=3 ∧ alpha==255）复位 0+30 粒尘爆 */
  private gAlpha = 0;
  /** 乌鸦 AI_054 状态（ai[0] 归位态 / ai[1] 扑击计时 / 帧区 0=飞 1=扑） */
  private rA0 = 0;
  private rA1 = 0;
  /** 原版 Projectile.friendly 字段镜像（AI_054 内动态翻转：跟随期 :27474 true→
   *  :27519 false、扑击倒数 :27566 false、冲刺帧 :27547 true——下一 tick 的
   *  归位门 :27423 读上一 tick 末值） */
  private rFriendly = false;
  ravenZone = 0;
  /** 致命球 533 相位机（AI_066，ai[0]/ai[1]/localAI[0] 镜像）：
   *  ai[0] 0-2 待机 / 3-5 蓄力 / 6-8 冲刺 / 9-11 归位冲刺；自旋与待机帧动画只在
   *  ai[0]<3 || ≥9（:28874-28877/:28891-28893——3-8 冲刺段不自旋） */
  private dA0 = 0;
  private dA1 = 0;
  private dLai0 = 0;
  /** ★BJ635：dFc=frameCounter、dFrame=状态帧通道（AI_066 533 帧机直写,draw 支消费;
   *  dLai2=localAI[2] 撞墙计数（:30120 Clamp 逐拍 −1、:18314 撞墙 +30、:14618 消费
   *  击退 ×0.5 面≥40——消费面归 contact 签名域=登记债,计数面先落） */
  private dFc = 0;
  private dFrame = -1;
  private dLai2 = 0;
  /** AI_062 射手族态机（373/375/407/423/613，1457 Projectile.cs :66067-67166 镜像）：
   *  a62A0=ai[0]（0 交战 / 1 归位 / 2+ 攻击闪·423/613 冲刺）、a62A1=ai[1]（射击冷却
   *  随机计数器 + 423/613 冲刺时长）、a62Lai0=localAI[0]（423/613 冲刺冷却 60） */
  private a62A0 = 0;
  private a62A1 = 0;
  private a62Lai0 = 0;
  /** 423/613 冲刺 extraUpdates 镜像（Projectile.extraUpdates）：触发拍 = (int)ai[1]
   *  （:66559/:66597）→ 下一拍 Update 跑 ai[1]+1 次完整 AI 子步（Update :16780-16783
   *  numUpdates 循环）;归零子步重置回 0（:66178/:66236）。0=非冲刺 */
  private a62EU = 0;
  /** 蜘蛛 390-392 步行链状态（AI_026 flag7，:62771-63340/:65092-65230 镜像）：
   *  spLai0=localAI[0]（LOS 接敌续走计时 60）、spLai1=localAI[1]（撤退档计时——命中
   *  置 20 :14027-14030,每拍递减 :62958-62963,>0 撤退=不咬+沿速度向续走 :63003-63012）、
   *  spA0=ai[0]（0 地面作战 / 1 归位飞行）、spFrame=帧通道（0-2 走 / 3 空 / 4-7 爬墙）、
   *  spDir=direction 镜像（:63302-63315,渲染 spriteDirection=-direction :65166） */
  private spLai0 = 0;
  private spLai1 = 0;
  private spA0 = 0;
  private spDir = 1;
  /** ★BJ698：friendly 镜像（AI_026 蜘蛛块 :62963-63017——`num169>=0 ∧ num167<800+40×
   *  minionPos` 置真/否则置假/撤退 flag25 置假;ai[0]==1 归位段不重写=残留值承袭,
   *  与原版 Projectile.friendly 同生命周期）。接触窗判据（Damage_PVE_Inner :12630
   *  friendly 门）。 */
  private spFriendly = false;
  spFrame = 0;
  /** 吸血蛙 758 状态（AI_067 flag2，:50478-50482/:51161-51177/:51296-51619 镜像）：
   *  frA0=ai[0]（0 地面 / 1 归位飞行 / 2 扑击）、frA1=ai[1]（扑击倒数 num10=20）；
   *  frFc=frameCounter、frFrame=状态帧通道（★BJ635：flag6 帧机 :51718-51762——
   *  静立 0/飞行 1/步行带 2-9（fc+=|vx| 速度计频 >10）/攻击带 10-15/空中攻击 13;
   *  projFrames[758]=24 Main.cs:8770） */
  private frA0 = 0;
  private frA1 = 0;
  private frFc = 0;
  private frFrame = -1;
  /** ★BJ635：禁戒魂灵 1119 帧机（AI_206 :38293-38324——待机带 0-4 随机滞帧 +
   *  攻击带 5-8 出弹前 4t 起帧;projFrames[1119]=9 Main.cs:8700） */
  private fmFc = 0;
  private fmFrame = 0;
  /** 地面步行族 StepUp 坡步门（AI_026 :63261 / AI_067 :51508 同款 Collision.StepUp——
   *  spiderStep/frogStep 入口置位;palGroundStep/mushBoiStep 2026-09-07 嵌入定谳批
   *  补接（帕鲁扑击支显式复位 false,原版 StepUp 不入 ai[0]==2 块）,moveAndCollide 消费） */
  stepUp = false;
  /** Projectile.tileCollide 镜像（AI 逐态直写,moveAndCollide 消费=false 整段跳过碰撞）：
   *  蜘蛛归位飞行 :61410 false / 地面 :62843-62845 盒无实心回 true / :62852-62860
   *  LOS 目标在下方且脚踩平台 → false（穿平台下扑）;蛙归位飞行 :50648 false /
   *  地面 :51266 true */
  tileCollide = true;
  /** AI_120 当前状态（ai[0]：0 跟随 / 1 rest 驻守 / 2 冲刺拳击 / 3 rest 点飞行；诊断与回归用） */
  get ai120State(): number { return this.gA0; }
  /** AI_120 alpha 镜像（:45482/:45718）——255=隐身（状态 3 飞行段） */
  get ai120Alpha(): number { return this.gAlpha; }
  /** 家族一次性初始化（龙链生成） */
  private spawned = false;
  /** 阿比盖尔 970 升级音一次性门（Projectile.cs:43971 localAI[0]==0 语义） */
  private abigailUpgChecked = false;
  /** Foxparks 喷火弹 1106 出膛音三发一门（Projectile.cs:38956 whoAmI%3==0） */
  private foxFlameN = 0;
  /** 渲染旋转（龙链：段朝向 = 指向父段 +PI/2，同原版 rotation=velocity.ToRotation()+PI/2） */
  rot = 0;
  /** ★BJ518⑥（2026-10-05）：绘制 scale 通道（Projectile.scale 镜像）——现役唯一写位=
   *  1025 携带缩体支（AI_Sentries_HeavySlingReposition :70152 scale=1 头置/:70200 缩体
   *  0.5;AI_197 携带块 :41085-41090 else scale=1 被共享尾覆写同相）。BJ357 变身坐骑
   *  （55 Rat 14/56 Bat 18/61 Pixie 14 高）使 owner.h<DefaultSize.Y=42 可达,旧「缩体支
   *  不可达」判谳废止。draw 在 rotate/flip 合成后 ctx.scale 消费。 */
  drawScale = 1;
  /** Foxparks 5664 手持喷火通道（AI_026 ai[0]>=1000：每 4t 发 1106，Game 每帧置 true+瞄准）
   *  ★BJ521②：电平旗=玩家侧逐拍重置等价面（Player.cs:43686 ai[0]=1000f——持住期间
   *  恒真,不因岩浆中断清零=「持岩浆中持续压制」的玩家半面）;AI 侧门折算见喷火支。
   *  ★BJ523（2026-10-05）定谳维持电平面：原版出岩浆持住自动复燃（「须重按」前提证伪
   *  ——狐杖 5664/6149 autoReuse=true（Item.cs:44503/:47377）→ ItemCheck_AutoReuseLogic
   *  :53519 逐拍强制 releaseUseItem=true + :53524 fast-path 归零 itemAnimation →
   *  :43064 门重开重调 TryUsingFoxsparksAbility;BJ522 登记债①系漏读 autoReuse）,
   *  W0 调用面扩形（按下沿∪岩浆持住重臂环）见 Game 喷火通道 */
  foxChannel = false;
  foxAimX = 0; foxAimY = 0;
  /** ★BJ521②：本通道内喷火块已入过（:60014 ai[0]>=1000 门通过至少一拍）——Game
   *  释放臂据此折 :60093 localAI[0]=30（纯岩浆通道喷火块未入 → 原版不落 30 → 无锁） */
  foxFlameRan = false;
  /** ★BJ521②：lavaWetAi 只读口——Game 喷火通道在 AI 分派前调,读相=上拍湿段尾值,
   *  与本拍 AI 岩浆门（:5157/:59170）消费同源同值。岩浆拍 Game 不钉位/不刷瞄
   *  （原版 position 锚与 velocity 写都在喷火块 ai[0]>=1000 内 :60014-60051,
   *  门覆写拍 ai[0]=1 不入块=弹体自由归位飞行） */
  get foxLavaHold(): boolean { return this.lavaWetAi; }
  private foxT = 0;
  /** projectile.soundDelay 镜像（1094/1113）：初值 0 与原版 SetDefaults 同
   *  （Projectile.cs:350/:751），AI_026 首段每 tick --（:59119-59120——出场段
   *  -1 PalSummon/-20 PalFoxparks 两声已并入 MINION_SUMMON_SFX 表按 age 节拍,
   *  本槽只承载 TryUsingFoxsparksAbility 攻击叫声称的门/重置 :43691-43694,
   *  ★BJ523：消费点迁 Game 喷火通道按下沿∪岩浆持住重臂环（foxAttackSoundGate）——
   *  稳态喷火期 :43064 门被 AI 续期针闭（:60068 itemAnimation=2）=调用面外=静默 */
  private foxSoundCd = 0;
  /** 火绒狐 1094/1113 帧态机（AI_026 flag8 帧段 :64729-64826 折算,foxAnimTick 维护）：
   *  foxFrame 直映原版 frame——待机 18-25 / 行走 28-35 / 空中 27 / 攻击 36-41 往返 /
   *  抚摸 45-52（网格切片见 Arrow PROJ_GRID,帧域 = 列主序 6×9） */
  private foxFrame = 18;
  private foxFrameCd = 0;
  /** 上一拍 X（flag27 = position.X==oldPosition.X 横向零位移判定 :63334） */
  private foxPrevX = 0;
  private pounceCd = 0;
  /** 帕鲁出场淡入（DoPalAppearEffect :39509-39515：SetDefaults alpha=255 起每 tick
   *  -15，17t 全显——1093 :10211 / 1112 :10377 / 1113 :10400 / 1118 :10485；其余随从
   *  0=不淡入。★BJ517④（2026-10-05）：1094 补档——定谳=原版真有淡入：SetDefaults
   *  alpha=255（:10221）与 1113（:10389）同款，AI_026 头两支同调 DoPalAppearEffect
   *  （1094 :59197 / 1113 :59210,实参同 ai[0]!=1f）——旧「仅 1113 有通道」系漏登记,
   *  非 1094 原版无淡入。消费面：draw globalAlpha + :5053 flag22 门（alpha>0 抑制
   *  出手=淡入期不打,原版 :62584-62586 alpha 读位本即 1094/1113 双达）） */
  alphaFade = 0;
  // ---- 帕鲁地面随从 1093/1112/1118（AI_067 flag8/flag9 态机，ai[0]/ai[1] 镜像）----
  /** ai[0]：0 地面跟随/索敌 / 2 扑击 / 3 帮工采掘（★BJ433,Projectile.cs:52226-52250
   *  TryAssigningHelp 置态,1093/1112 专属;1 归位飞行与 5 Boss 追击见 palGroundStep 注） */
  private palA0 = 0;
  /** ai[1]：扑击剩余 tick（num10 初值 16/30，:50490/:50499）∧ ai[0]==3 时 = 栖点
   *  tile X（:52234/:52244——进扑击拍被 num10 覆写,原版同构） */
  private palA1 = 0;
  /** ai[2]：ai[0]==3 时 = 栖点 tile Y（:52235/:52245；其余态恒 0 清底） */
  private palA2 = 0;
  /** localAI[1]：帮工链死写槽（:52216/:52223/:52229 置 0——原文无读点,承载备案） */
  private palHelpLai1 = 0;
  /** 帧（AI_067 flag8/flag9 原版帧机驱动，draw 消费——2026-08-24 用户报捣蛋猫
   *  攻击白团、2026-08-25 复发实锤双根因：①此前 1093 根本没进本态机（走通用飞行
   *  近似 + age/8%28 全帧循环,把表内 14-27 白姿 hurt 带也播出来）；②1112 的
   *  步行帧机曾按"flag8 不写 frame"误读实现成冻结。1457 实文两型都有完整帧机
   *  （flag8 :51841-51877 立地 0/抚摸 13/走 7-12/空气 1-2；flag9 :51879-51930
   *  立地 0/抚摸 16/走 8-14/空气 1-2）+ 肩扛 0/1/2（Player.vy 阈 :50788-50800）
   *  + 扑击 3+(num10-ai1)/(num10/4)（:50880/:50912） */
  palFrame = 0;
  private palFrameCd = 0;
  /** 阿比盖尔一阶 963 帧机（AI_062 963 档 :66843-66868）：攻击态 fc/12 循环 0-6
   *  收于 5；跟随态 7t 循环 0-7——draw 消费（2026-08-24 同类审计补） */
  a963Frame = 0;
  private a963Fc = 0;
  // ---- 1457 帕鲁钻地龟 1098/1123（AI_204_Digtoise Projectile.cs:39169-39506 态机，
  //      2026-08-23 内容缺口批；物品 5667 PalworldDigtoise / 6174 PalworldTrustyDigtoise）----
  /** ai[0]：0 出场 / 1 向下挖 / 2 向右挖 / 3 向左挖 / 4 离场 / 5 抚摸（:39173-39178） */
  private digA0 = 0;
  /** ai[1]：态内计时（出场 180t 转挖 / 挖掘节拍 num4=40 蓄势 + 20/10t 间隔 / 离场 600t 灭） */
  private digA1 = 0;
  /** localAI[1]：挖掘帧加速计数（num7 = 4 - lai1/4，:39377-39380） */
  private digLai1 = 0;
  /** 挖掘帧（0-2 出场/待机，2-9 挖掘循环 :39237-39245/:39375-39390） */
  digFrame = 0;
  private digFrameCounter = 0;
  /** soundDelay 镜像：出场段 pal_summon(-1)/pal_digtoise(-20) 与挖掘段 Item199
   *  （≤0 → 置 10）共用槽（:39222-39231/:39395-39397）——出场两声已并入
   *  MINION_SUMMON_SFX 表（at 1/20 与原版节拍同构），本槽只承载挖掘声 */
  private digSoundCd = 0;
  /** 挖掘态读口（Game.commandDigtoises :48713-48726 指挥链） */
  get digtoiseA0(): number { return this.digA0; }
  set digtoiseA0(v: number) { this.digA0 = v; this.digA1 = 0; }
  /** 抚摸中（flag10 = player.petting.isPetting && petting.proj==whoAmI :50053/:59101
   *  的本仓等价——Game 抚摸白名单写入，petting 停止时统一清） */
  beingPetted = false;
  /** 抚摸 Joy 计时（localAI[0] :50106-50113 1093/1112/1118 镜像 / localAI[2]
   *  :59122-59131 1094/1113 镜像）：flag10 且归零 → 60t 重触发 Joy 音；
   *  `> (flag10?1:0)` 递减——抚摸中钉 1、停摸后放空到 0 */
  palJoyCd = 0;
  // ---- 蘑菇小伙伴 1022（Dead Cells 联动,5456；AI_067 flag6 :50023/:50140-50148 折算）----
  /** ai[0]：0 地面跟随/索敌 / 1 归位飞行（:50444 flag14=false+friendly=true、
   *  :50448-50450 检索档 0||1） */
  private mbA0 = 0;
  /** ai[2]：跃击/爆炸态（TryJumpingToTarget 1022 支 :52108-52152 置 30;爆点支
   *  :50599-50621 爆后置 -120 冷却;<0 逐拍 ++ 回零,>0 空中逐拍 −−贴地归零
   *  :50622-50630;Damage_CanDealDamage (1022&&ai[2]>0)=false :12463） */
  private mbA2 = 0;
  /** localAI[2]：跃击前摇计数（TargetFound 编排粒子首拍 + 15t 蓄势 :52127-52147;
   *  无目标清零 :51017-51019） */
  private mbLai2 = 0;
  /** 帧通道（AI_067 flag6 帧机 :51642-51681 直写,draw 消费）与帧计 */
  mushFrame = 0;
  private mushFrameCd = 0;
  // ---- 同伴方块 653（AI_067,Projectile.cs:46657/46804-46860/47055-47830）----
  private cubeA0 = 0;     // ai[0]：0 地面跟随 / 1 归位悬浮
  private cubeLai0 = 0;    // localAI[0]：岩浆尖叫计数 0..20（近主清零 :47088）
  private cubeLai1 = 0;    // localAI[1]：黑暗计数 -3600..120（阈值后捅人）
  private cubeRot = 0;     // rotation（+=vx/20 :46805；贴靠时 AngleTowards 0）
  /** _CompanionCubeScreamCooldown[owner]（静态 float[256]——单人取模块级等价） */
  private static cubeScreamCd = 0;

  // ---- 旗舰家族分支（行号见各方法注释；均在通用运动前 return）----

  /** 星尘龙头（aiStyle 121 :40138-40403）：加速追敌（acc 0.4/0.6/0.8 ×1.5=0.6/0.9/1.2
   *  限速 30，穿墙穿敌）/ 跟随玩家（限速 15，>2000px 传送）；伤害 ×(1+0.23×tier)
   *  （★G27① 勘误:真锚 :12873-12879 乘区读 scale=1+localAI[0]×0.01（头
   *  localAI[0]=段总数,旧注「:12097 localAI[0]=距尾段数」系误读——那是逐段镜像值,
   *  头恒=全段数））；首次生成 626→627→628 链（段距 16px），
   *  全链共用一张命中表（7t/敌）。★G27 ②④⑤⑥:逐拍盒 30×scale/淡入 −42+
   *  2×dust135/no-target 逐轴 Sign 加速+阻尼门 speed>2+上浮门 |vy|<1/旋转无条件。 */
  /** AI_121 索敌 1:1（1457 :43653-43695 / 1456 :40178-40219）——★专用择敌（不共用
   *  nearestEnemy）：原版野生支遍历 Main.maxNPCs 升序、过门即覆盖写 num6（:43690/
   *  :40216——无最近比较、无 break）＝【最后一个通过门的候选】胜,遍历序敏感;
   *  nearestEnemy 的"最近"语义是其余消费者的共性近似,龙专属覆盖语义在此承载
   *  （2026-09-08 收口裁断:共享助手不动,爆破半径最小）。
   *  · 集火支（OwnerMinionAttackTargetNPC→minionTargetId）:存在性+CanBeChasedBy
   *    （:43663-43664/:40189-40190）+距龙 num4×2<1400（:43667/:40193,无 num5 门、
   *    无视线门）;未过门 → num6 仍−1 → 野生支照跑（原文即如此,非互斥挡板）。
   *  · 野生支:CanBeChasedBy ∧ 距玩家 num5<1000（:43685/:40211）∧ 距龙
   *    num4<700（:43688/:40214）;本仓 enemies() 即槽位升序=遍历序同构。
   *  · 原文本支无鞭 tag 支（nearestEnemy 通用 tag 层不适用于 AI_121,不建模）。 */
  private dragonTarget(game: GameHooks, p: Player): EnemyLike | null {
    const focus = (p as unknown as { minionTargetId?: number }).minionTargetId ?? -1;
    if (focus >= 0) {
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean };
        if (!en || en.dead || en.id !== focus) continue;
        if (!canBeChasedBy(e)) break;                    // :43664/:40190 → num6=−1 → 野生支
        if (Math.hypot(en.cx - this.cx, en.cy - this.cy) < 1400) return en;  // :43667/:40193
        break;
      }
    }
    let num6: EnemyLike | null = null;
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean };
      if (!en || en.dead) continue;
      if (!canBeChasedBy(e)) continue;                   // :43685/:40211 前置
      if (Math.hypot(en.cx - p.cx, en.cy - p.cy) >= 1000) continue;        // num5
      if (Math.hypot(en.cx - this.cx, en.cy - this.cy) >= 700) continue;   // num4
      num6 = en;                                         // 覆盖写——末位通过者胜
    }
    return num6;
  }

  private dragonHead(game: GameHooks, p: Player, dmg0: number): void {
    const ents = (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities;
    if (!this.spawned) {
      this.spawned = true;
      let parent: MinionProj = this;
      for (const seg of [626, 627, 628]) {
        const m = new MinionProj(this.cx, this.cy, seg, this.damage, this.knockback,
          false, 0, false, this.ownerRef);
        // 基础链段 noSlot：原版 626/627 各 0.5 槽（:6737-6739）+ 头 0 槽 = 1 槽,
        // 本仓头 625 计 1 槽 + 段 0 = 总量等价（延伸段另计,见 extendDragon 注）
        m.noSlot = true;
        const par = parent;
        m.parentRef = () => (par.dead ? null : par);
        m.hitCd = this.hitCd; // 全链共用命中表（localNPCHitCooldown=7 语义）
        ents.add(m, 'projectiles');
        parent = m;
      }
    }
    // ★BJ709-G27（2026-10-24,BJ709-A 登记债②④⑤⑥清偿）——头支运动后段 1:1 对齐
    // 1457 AI_121 :43726-43888（1456 :40220-40341 同构）。
    // 伤害乘区（①同源,:12873-12879）：value=clamp((scale−1)×100,0,50) →
    // ×(1+value·0.23);头 scale=1+clamp(localAI[0],0,50)×0.01（:43770-43772,
    // localAI[0]=段总数=dragonLocalAI0 头支）⇒ 头乘区=1+0.23×tier。
    const tier = this.dragonLocalAI0(game);
    const scale = 1 + 0.23 * tier;
    // >2000 瞬移（:43656-43660 / :40182-40185）：索敌【前】无条件,base.Center =
    // player.Center——Center 写位用【当前盒】半宽（②后=上一拍 30×scale,首拍 24
    // :6741-6742）;原版不清速度（动量保留,AI 从新位续走）。曾错挂 no-target 支
    // +(−30,−30) 旧盒径残留（中心落 pcx−18）,双错一并清偿（2026-09-08）;
    // ★G27②再清偿:−12 硬编码系 24 盒时代残值 → this.w/2 动态半宽。
    if (Math.hypot(p.cx - this.cx, p.cy - this.cy) > 2000) {
      this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2;
    }
    // 索敌 1:1（AI_121,1457 :43653-43695 / 1456 :40178-40219）——dragonTarget
    // 原文字面（集火 num4×2<1400 + 野生双门 num5∧num4 + 末位覆盖语义）
    const tgt = this.dragonTarget(game, p);
    if (tgt) {
      const dx = tgt.cx - this.cx, dy = tgt.cy - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      // 1456 :40229-40236：acc 档 0.4/0.6/0.8 ×1.5 → 0.6/0.9/1.2
      const acc0 = d < 300 ? 0.8 : d < 600 ? 0.6 : 0.4;
      // :40237-40244 距敌 > 敌判定盒对角线×0.75 才推进；推进后 Dot(velocity,vector)<0.25
      // （vector 未归一）→ velocity×0.8 阻尼（横向/背向减速）
      if (d > Math.hypot(tgt.w, tgt.h) * 0.75) {
        this.vx += (dx / d) * acc0 * 1.5;
        this.vy += (dy / d) * acc0 * 1.5;
        if (this.vx * dx + this.vy * dy < 0.25) { this.vx *= 0.8; this.vy *= 0.8; }
      }
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 30) { this.vx *= 30 / sp; this.vy *= 30 / sp; }
    } else {
      // ★G27⑤ no-target 支 1:1（:43728-43761）——旧实现三偏差清偿:
      //  (a)归一化向量加速 → 原版【逐轴 Sign】加速 + 轴门（|Δx|>20 才加 X、
      //    |Δy|>10 才加 Y,:43740-43747）;
      //  (b)阻尼 ×0.96 无条件挂 d≤100 支 → 原版 else-if【speed>2 门】
      //    （:43749-43752）;
      //  (c)上浮 −0.1 只挂近距支 → 原版【|vy|<1 独立门】（:43753-43756）;
      //  限速 15 原版在 no-target 支尾【无条件】（:43757-43761,旧实现只挂
      //  d>100 分支 → 近距残留动量>15 不收）。
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      const d = Math.hypot(dx, dy);
      const num11 = d < 140 ? 0.06 : d < 200 ? 0.12 : 0.2;   // :43728-43737
      if (d > 100) {
        if (Math.abs(dx) > 20) this.vx += num11 * Math.sign(dx);   // :43740-43743
        if (Math.abs(dy) > 10) this.vy += num11 * Math.sign(dy);   // :43744-43747
      } else if (Math.hypot(this.vx, this.vy) > 2) {
        this.vx *= 0.96; this.vy *= 0.96;                     // :43749-43752
      }
      if (Math.abs(this.vy) < 1) this.vy -= 0.1;              // :43753-43756 上浮门
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 15) { this.vx *= 15 / sp; this.vy *= 15 / sp; }        // :43757-43761
    }
    // ★G27⑥ :43763-43765 运动后状态写【无条件】——旧 speed>0.5 旋转门撤除
    //  （vanilla 逐拍恒写 velocity.ToRotation()+π/2）;同块 direction/spriteDirection
    //  = velocity.X>0?1:−1 逐拍覆写（零消费者簿记——MINION_ROT_ONLY 族 draw 不翻,
    //  旧「有目标读目标向」为目标面误植,一并归位）。
    this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;
    this.facing = this.vx > 0 ? 1 : -1;
    // ★G27② :43770-43774 逐拍盒 30×scale（num2=30 :43626-43637,SetDefaults 24×24
    //  :6741-6742 仅出生首拍前值）——position=Center → resize → Center=position
    //  中心保持（(int) 截断 :43773）。头 localAI[0]=tier → scale=1+tier×0.01。
    const hcx = this.cx, hcy = this.cy;
    this.w = this.h = Math.trunc(30 * (1 + tier * 0.01));
    this.x = hcx - this.w / 2; this.y = hcy - this.h / 2;
    this.drawScale = 1 + tier * 0.01;        // proj.scale 镜像（③draw 消费,:43772）
    // ★G27④ :43775-43788 出场淡入尾段——alpha>0 → 2×dust135（盒内随机位,
    //  alpha=100/scale=2/noGravity/noLight）+ −42（clamp 0,≈7t 渐显;段支
    //  :43852 的无条件 −42 在 α=0 后为 no-op,观测等价）。
    if (this.alphaFade > 0) {
      for (let j = 0; j < 2; j++) {
        const d15 = game.spawnDust?.(this.x, this.y, this.w, this.h, 135, 0, 0, 100, null, 2, true);
        if (d15) d15.noLight = true;
      }
      this.alphaFade = Math.max(0, this.alphaFade - 42);
    }
    // ★G30⑨ :43875-43876 AI 尾世界边界钳——vanilla 位=AI_121 函数末位（头/段支汇
    //  流后）,先于 HandleMovement→UpdatePosition 的 position+=velocity 积分;本仓
    //  头支运动积分在 AI 体内 → 钳位=淡入块后/运动前同相（当拍可越界 ≤|velocity|,
    //  次拍 AI 尾钳回=原版逐拍同构）。
    this.dragonClampWorld(game);
    this.x += this.vx;
    this.y += this.vy;
    this.contact(game, dmg0 * scale, 7);
  }

  /** ★BJ522（2026-10-05,BJ521 登记债①清偿）：喷火后锁（Game 通道断开时调）——
   *  原版 :60093 循环尾 `localAI[0] = 30f` 落【a026L0 槽】（AI_026 localAI[0]），
   *  非 ai[1]/shootCd！四消费面：①flag22 射击抑制 :62590（flag8∧(alpha>0∨L0>0)
   *  →不射）②归位门 +500 :61295-61297 ③|Δy|>300 返程闸禁用 :61320 ④朝向同步
   *  冻结 :63026。误写 shootCd 会错触三 ai[1] 消费面（攻击帧 :64730 / 攻击制动
   *  vx×0.7 :63014-63018 / 转向意图双清 :63021-63024）=BJ521 债面本体。
   *  「每 4t 循环尾重写」与释放单写观测等价定谳：持住期循环尾 30 被下拍块头
   *  :60016 `localAI[0]=0f` 清零，且喷火块尾 return（:60101）先于全部消费面
   *  =零观测窗；释放本身恒经循环尾写（flag13 假 → ai[0]=0 与 localAI[0]=30
   *  同块 :60092-60093）——BJ521② foxFlameRan 门=「喷火块入过」判据，释放臂
   *  单写即原版形态（BJ521 债面「循环尾重置缺」半句据此销案） */
  lockAfterFoxChannel(): void { this.a026L0 = Math.max(this.a026L0, 30); }

  /** ★BJ522 W0（清面）+★BJ523 相位面：能力调用沿（PC:43686-43689
   *  TryUsingFoxsparksAbility——ai[0]=1000f + ai[1]=0f + localAI[0]=0f 同拍；
   *  ai[0]=1000 面=foxChannel 电平（能力态在位承载）+本法 foxT=0（循环相位归位——
   *  ai[0] 自 1000 重走 ⇒ 重按/重臂后首拍即出弹 :60045 ai[0]==1000f fire），
   *  本法清两槽+归位相位）——喷火自净零起算，残留射击冷却/接敌记账不带入释放锁
   *  （无此清则 1094 近射残留 L0=42 会把释放锁抬到 >30、shootCd 残留延长抑制）。
   *  调用位=:43064 起手门（controlUseItem∧releaseUseItem∧itemAnimation==0）。
   *  ★BJ523 调用集勘误：BJ522「按下沿非逐拍,按住恒假」系漏读 autoReuse——狐杖
   *  5664/6149 autoReuse=true（Item.cs:44503/:47377）→ ItemCheck_AutoReuseLogic
   *  :53519 逐拍强制 releaseUseItem=true + :53524 fast-path（itemAnimation==1→0）
   *  ⇒ 稳态喷火期门被 AI 续期针闭（:60068 SetDummyItemTime(2) 恒 itemAnimation=2）,
   *  岩浆持住期续停（:59174 杀 ai[0]=续期源断）→ 门重开=每拍重调（重臂环,Game 以
   *  foxLavaHold 折算）。localAI[1]=0f 面不折：flag8 帧段攻击帧读 ai[1]（:64730），
   *  localAI[1] 仅 flag6 帧段消费（:64762） */
  foxAbilityPress(): void { this.shootCd = 0; this.a026L0 = 0; this.foxT = 0; }

  /** ★BJ523：攻击叫声门（PC:43691-43694 TryUsingFoxsparksAbility 体内——
   *  soundDelay<=-320 开门 → soundDelay=-21 + PalFoxparksAttack（SoundID.cs:1092
   *  WithVolume 0.18）。返回 true=本拍应播（播放位/声源在调用侧=Game 喷火通道,
   *  base.Center=玩家中心 :43694）。调用面=按下沿∪岩浆持住重臂环;稳态喷火期
   *  :43064 门被 AI 续期针闭（:60068）→ 不调用=静默。递减位=AI 首段每拍
   *  --soundDelay（:59119），-21 起算第 299 拍回 -320 重开 */
  foxAttackSoundGate(): boolean {
    if (this.foxSoundCd > -320) return false;            // :43691
    this.foxSoundCd = -21;                               // :43693
    return true;
  }

  /** 召唤入口后置射击冷却（shootCd = 本仓 ai[0] 开火循环槽，1119 专用）：
   *  6164→1119 SpawnMinionOnCursor `case 6164: ai = 45f`（:50115-50116 → ai[0]，
   *  AI_206 首轮开火循环前置 45t :38272）。★BJ522 载体归真：6149→1113 的
   *  localAI[0]=30（:48944）属 a026L0 槽，改走 armLingerCooldown——本方法不再
   *  兼职（旧注「ai[0]/localAI[0] 射击槽等价」系两槽混写；旧锚 :56155 系
   *  type 325 尘段误引，1094/1113 无 :56155 锚） */
  armSpawnCooldown(t: number): void { this.shootCd = Math.max(this.shootCd, t); }

  /** ★BJ522：召唤入口 localAI[0]=30 槽（AI_026 linger/归位记账）：6149→1113
   *  `Main.projectile[num145].localAI[0] = 30f`（Player.cs:48944）——30t 内
   *  flag22 抑制 + 归位门 +500 + |Δy| 闸 + 朝向冻结（同 lockAfterFoxChannel
   *  四消费面）。1157→191-194 同族写（:48928）flag6 未接线=BJ521② 备查面维持
   *  （另欠 ai[1]=60 :50105 面，见 BJ522 报告登记） */
  armLingerCooldown(t: number): void { this.a026L0 = Math.max(this.a026L0, t); }

  /** 再召唤延伸：尾(628)前插入 2 段（626+627）（Player.cs:47906-47963）。延伸段
   *  minionSlots=0.5/段（:6737-6739,2 段=+1 槽）→ noSlot=false 计入槽位账;超限由
   *  每 tick 自裁链（Game 召唤上限缩水段,:16812-16845）摘链击杀——延伸不免费 */
  extendDragon(game: GameHooks): boolean {
    const projs = (game as unknown as { entities: { projectiles: unknown[]; add: (e: unknown, b: string) => void } }).entities;
    const tail = projs.projectiles.find((m) =>
      m instanceof MinionProj && !m.dead && m.projId === 628) as MinionProj | undefined;
    if (!tail || !tail.parentRef) return false;
    const oldParent = tail.parentRef;
    const a = new MinionProj(tail.cx, tail.cy, 626, this.damage, this.knockback, false, 0, false, this.ownerRef);
    const b = new MinionProj(tail.cx, tail.cy, 627, this.damage, this.knockback, false, 0, false, this.ownerRef);
    a.noSlot = b.noSlot = false;              // :6737-6739 minionSlots=0.5f×2
    a.parentRef = oldParent;
    b.parentRef = () => (a.dead ? null : a);
    tail.parentRef = () => (b.dead ? null : b);
    a.hitCd = b.hitCd = this.hitCd;
    projs.add(a, 'projectiles');
    projs.add(b, 'projectiles');
    return true;
  }

  /** 龙链段自裁摘链（Update :16816-16830 / FreeUpPetsAndMinions :52440-52452 同构）：
   *  626/627 被杀（超限自裁/驱逐）先把父段接到子段——链缩短不断裂（原版 proj.ai[0]/
   *  localAI[1] 互指改写;本仓 parentRef 闭链等价） */
  unlinkFromChain(projs: readonly unknown[]): void {
    const par = this.parentRef?.() ?? null;
    for (const e of projs) {
      const c = e as MinionProj;
      if (!(c instanceof MinionProj) || c === this || c.dead) continue;
      if (c.parentRef && c.parentRef() === this) {
        c.parentRef = () => (par && !par.dead ? par : null);
      }
    }
    this.parentRef = null;
  }

  /** 星尘龙 localAI[0] 等价（1456 Projectile.cs:40342 每段找父后 parent.localAI[0]=
   *  self+1——链自尾向头传播：尾 628=0、627=1、626=2、头 625=3（基础龙 3 段）；
   *  再召唤插段同式累加）。★BJ709-G27① 勘误（2026-10-24）：本值【不是】伤害档——
   *  原版乘区 :12873-12879 读 scale（段=继承头值=全链同档 1+0.23×段总数）,旧注
   *  「逐段各自档位,非全链同值」系把 value=(scale−1)×100 误读为逐段 localAI[0]
   *  的假信念（旧锚 :12097-12102 亦误,真锚 :12873-12879）。本方法保留为
   *  localAI[0] 状态镜像（头 scale 源=头支返回值;逐段值=weapon-summon-fix §248 锁）。 */
  private dragonLocalAI0(game: GameHooks): number {
    const total = this.peerCount(game, 626) + this.peerCount(game, 627) + this.peerCount(game, 628);
    if (this.projId === 625) return Math.min(50, total); // 头 = 全段数
    let k = 0;
    let cur: MinionProj | null = this;
    while (cur && cur.projId !== 625 && k <= total) { cur = cur.parentRef?.() ?? null; k++; }
    return Math.min(50, Math.max(0, total - k));        // 段 = 全段数 − 距头步数
  }

  /** 龙身/尾（626/627/628）：AI_121 段支 1:1（1457 :43790-43874 / 1456 :40347-40417）。
   *  无自主速度（:43857 velocity=Zero）,纯链式跟随:方向向量 vector4=父心−自心,经
   *  【父rot−自rot 差的 10%】预旋转（:43859-43863,鞭链摆动滞后——段朝向渐进跟父,
   *  非瞬时硬指）后:rotation=vector4.ToRotation()+π/2（:43864）,位置=父心−
   *  normalize(vector4)×16×scale（:43869-43871,保持自身方位、间距钳 16×scale;
   *  scale=1+localAI[0]×0.01 只在头写 :43772,段沿链逐拍继承父值 :43866 num18=
   *  clamp(父scale,0,50) → 全链同值=1+min(50,头localAI[0]=段总数)×0.01）。
   *  ★BJ709-A（2026-10-24,用户实报「星尘龙一直抽搐」定谳）:旧实现方向向量符号
   *  取反（dx=自−父 而 pos=父−unit(dx)·16）=每拍绕父段【镜像翻转】——探针
   *  _bj709a-dragon-twitch 实锤三段 flipRate=1.000/位移幅 32/64/96px 沿链放大/
   *  rot 每拍翻 π;且缺 10% 旋转平滑与 ×scale 间距。interp 开/关双跑指标全同
   *  =插值嫌疑证伪;帧机证伪（vanilla projFrames[625-628]=1 无帧循环）。
   *  ★BJ709-G27（2026-10-24,登记债①②④清偿+①假信念勘误）:①伤害乘区改读
   *  tier（=头 scale 继承值,:12873-12879 全链同档,旧逐段 dragonLocalAI0 误植）;
   *  ②逐拍盒 30×scale 中心保持 resize（:43865-43868）;④出场淡入 −42/拍+
   *  2×dust135（:43843-43856,构造 alphaFade=255 起）。③draw scale 在 draw 支
   *  清偿（CENTER_ANCHOR_33703 消费 drawScale+A/=2）。剩余登记债⑦⑧见
   *  memory/bj709g27-dragon-debts.md。 */
  private dragonSegment(game: GameHooks, p: Player, dmg0: number): void {
    void p;
    const par = this.parentRef?.();
    if (!par) { this.dead = true; return; } // 头亡链断
    // ★G27④ :43843-43856 淡入首段（父链解析后、几何写前）——尘位=上一拍盒
    // （resize/位移前的 position/width/height）;−42 无条件在 α=0 后为 no-op,
    // 与头支 alpha>0 门内减观测等价。
    if (this.alphaFade > 0) {
      for (let l = 0; l < 2; l++) {
        const d19 = game.spawnDust?.(this.x, this.y, this.w, this.h, 135, 0, 0, 100, null, 2, true);
        if (d19) d19.noLight = true;
      }
      this.alphaFade = Math.max(0, this.alphaFade - 42);
    }
    this.vx = 0; this.vy = 0;               // :43857 velocity = Vector2.Zero
    let v4x = par.cx - this.cx, v4y = par.cy - this.cy;   // :43858 vector4 = 父心−自心
    if (par.rot !== this.rot) {             // :43859-43863 旋转平滑（鞭链滞后）
      const a = wrapAngle(par.rot - this.rot) * 0.1;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = v4x * c - v4y * s, ny = v4x * s + v4y * c;
      v4x = nx; v4y = ny;
    }
    this.rot = Math.atan2(v4y, v4x) + Math.PI / 2;         // :43864
    // 头 scale=1+min(50,localAI[0])×0.01（:43770-43772,头 localAI[0]=段总数）,段逐拍
    // 继承父值（:43866;头先更（链序 625→628）→ 全链收敛同值,插段当拍 1t 滞后不建模）
    const tier = Math.min(50, this.peerCount(game, 626) + this.peerCount(game, 627) + this.peerCount(game, 628));
    // ★G27② :43865-43868 逐拍盒 30×scale 中心保持 resize——position=Center →
    // width=height=(int)(num2×scale)（num2=30 :43637）→ Center=position;d4=0 支
    // （与父心重合）保持原心（旧实现 24×24 静态,盒差 6px/档）。
    const scx = this.cx, scy = this.cy;
    this.w = this.h = Math.trunc(30 * (1 + tier * 0.01));
    this.x = scx - this.w / 2; this.y = scy - this.h / 2;
    this.drawScale = 1 + tier * 0.01;        // proj.scale 镜像（③draw 消费,:43866 继承值）
    const d4 = Math.hypot(v4x, v4y);
    if (d4 !== 0) {                         // :43869-43871 vector4≠Zero 才写位
      this.x = par.cx - (v4x / d4) * 16 * (1 + tier * 0.01) - this.w / 2;
      this.y = par.cy - (v4y / d4) * 16 * (1 + tier * 0.01) - this.h / 2;
    }
    this.facing = v4x > 0 ? 1 : -1;         // :43873 spriteDirection（MINION_ROT_ONLY 族 draw 不消费,簿记 1:1）
    // ★G30⑨ :43875-43876 世界边界钳（段支:velocity=Zero 纯终态钳,写位后无积分）
    this.dragonClampWorld(game);
    // ★G27① :12873-12879 伤害乘区读【scale】（=继承的头值）→ 全链同档
    //  1+0.23×tier（基础龙 3 段=×1.69）——旧 dragonLocalAI0(total−k) 逐段各自
    //  （626/627/628 ×1.46/1.23/1.0）系把「value=(scale−1)×100」误读为逐段
    //  localAI[0];dragonLocalAI0 保留为 localAI[0] 状态镜像（头=total/段=total−k,
    //  weapon-summon-fix §248 锁）,不再作伤害源。
    this.contact(game, dmg0 * (1 + 0.23 * tier), 7);
  }

  /** ★BJ709-G30⑨（2026-10-24,G27 登记债⑨清偿）：AI_121 尾世界边界钳
   *  （Projectile.cs:43875-43876,头/段共用——两支汇流后的函数末位无条件跑）:
   *  position 钳 [160, maxTiles×16−160]（X/Y 同式;世界缘 10 格安全网,边角低危面）。
   *  头支钳位=淡入块后/运动积分前（vanilla AI 内尾先于 UpdatePosition 同相）;
   *  段支 velocity=Zero → 纯终态钳。MathHelper.Clamp=min/max 钳（NaN 透传同 XNA）。 */
  private dragonClampWorld(game: GameHooks): void {
    const st = game.world.store;
    const mx = st.w * 16 - 160, my = st.h * 16 - 160;
    this.x = Math.min(Math.max(this.x, 160), mx);
    this.y = Math.min(Math.max(this.y, 160), my);
  }

  /** ★清偿 C7/R2-F3（2026-10-14）：970 计数器 originalDamage 聚合面——原版
   *  ResetProjectileCaches（Player.cs:12308-12309）每拍清零 + ownedProjectileCounts
   *  收集循环 `case 970: highestAbigailCounterOriginalDamage=max(highest,od)`
   *  （Player.cs:12296-12300,owner==whoAmI 域）,AI_062 963 档每拍
   *  `originalDamage = highestAbigailCounterOriginalDamage`（Projectile.cs:66083）
   *  ——本体伤害源=【最高伤害计数器】,非生成者快照。多计数器共存=原版可达面
   *  （AI_164 首帧 peerCount>1 播 AbigailUpgrade :47478 同证——★G10 锚勘误（R1-P2①）：旧 :43974 系 1456 行号,1457 AI_164_StormTigerGem 头 :47450;自由槽位重复使用
   *  5114 不驱逐——freeUpMinionsForSummon 仅超预算才逐）。963 自身（projId!==970）
   *  不入 max（原版 originalDamage 每拍由计数器侧重收,963 无活计数器时已被
   *  UpdateAbigailStatus/maintainMinions 清理,兜底回落 self.damage）。 */
  private abigailCounterOriginalDamage(game: GameHooks): number {
    const projs = (game as unknown as { entities: { projectiles: MinionProj[] } }).entities.projectiles;
    const own = this.ownerRef();
    let mx = this.projId === 970 ? this.damage : -1;
    for (const m of projs) {
      if (m instanceof MinionProj && !m.dead && m.projId === 970
        && m.ownerRef() === own && m.damage > mx) mx = m.damage;
    }
    return mx >= 0 ? mx : this.damage;
  }

  /** 计数器（831 虎宝石 / 970 阿比盖尔计数，AI_164 :47450——★G10 锚勘误（R1-P2①）：旧 :43946 系 1456 行号）：头顶环绕吸附、不攻击；
   *  派生唯一本体（档位随同类数），本体 noSlot 不占上限 */
  private counterHover(game: GameHooks, p: Player, dmg0: number): void {
    void dmg0;
    const projs = (game as unknown as { entities: { projectiles: MinionProj[] } }).entities.projectiles;
    // 升级音（:47478,旧 :43974 系 1456 行号——G10 勘误）：970 首帧且同类 >1 → AbigailUpgrade（音量 0.5，SoundID.cs:1052）
    if (this.projId === 970 && !this.abigailUpgChecked) {
      this.abigailUpgChecked = true;
      if (this.peerCount(game, 970) > 1) {
        game.playSfxFiles(soundTrackFiles('abigail_upgrade'), 0.5, this.cx, this.cy);
      }
    }
    if (this.projId === 831) {
      const gems = this.peerCount(game, 831);
      const want = gems <= 3 ? 833 : gems <= 6 ? 834 : 835; // GetDesiredStormTigerMinionRank
      const tigers = projs.filter((m) => m instanceof MinionProj && !m.dead && m.projId >= 833 && m.projId <= 835);
      if (!tigers.length) this.spawnBody(game, want, this.damage);
      else if (tigers[0].projId !== want) { tigers[0].dead = true; this.spawnBody(game, want, this.damage); }
    } else if (!projs.some((m) => m instanceof MinionProj && !m.dead && m.projId === 963)) {
      // ★清偿 C7/R2-F3：出生伤害面=最高计数器 originalDamage（:66083 链）——
      //  旧 this.damage=生成者快照,后入高伤计数器不生效
      this.spawnBody(game, 963, this.abigailCounterOriginalDamage(game));
    }
    // AI_164 环绕：每层 4 个、层高 +12px、中心头顶 -61px（MountedCenter-21-40）
    const peers = projs.filter((m) => m instanceof MinionProj && !m.dead && m.projId === this.projId);
    const idx = peers.indexOf(this);
    const layer = Math.floor(idx / 4), inLayer = idx % 4;
    const layerCount = Math.max(1, Math.min(4, peers.length - layer * 4));
    const ang = (this.age * 2 + layer / 8 + inLayer / layerCount) * Math.PI * 2;
    const r = 8 + 12 * layer;
    this.x = p.cx + Math.sin(ang) * r - this.w / 2;
    this.y = p.cy - 61 - Math.cos(ang) * r - this.h / 2;
    this.facing = p.facing;
  }

  /** 跟随锚接地扫描（AI_067 无目标向量通用块 :51213-51260 折算）：CenteredRectangle
   *  (锚,Size) 起 20 格逐格下探首实心（tile==null||active 即停）＋玩家→锚 5% 步进
   *  视线截断（遇实心回退上一采样点）——tiger/pirate 随用随调 */
  private groundAnchorScan(
    st: import('../world/TileStore').TileStore, p: Player, ax: number, ay: number,
  ): { x: number; y: number } {
    for (let k = 0; k < 20; k++) {
      if (st.isSolid(Math.floor(ax / 16), Math.floor(ay / 16))) break;
      ay += 16;
    }
    const dx = ax - p.cx, dy = ay - p.cy;
    let fx = p.cx, fy = p.cy;
    for (let t = 0.05; t <= 1.001; t += 0.05) {
      if (st.isSolid(Math.floor((p.cx + dx * t) / 16), Math.floor((p.cy + dy * t) / 16))) break;
      fx = p.cx + dx * t; fy = p.cy + dy * t;
    }
    return { x: fx, y: fy };
  }

  /** 台账批②共用列扫门（AI_067 :51438-51457 机制(b)）：意图方向前柱
   *  （中柱+意图+(int)vX 截断）自盒顶行向下 height/16+1 行逐格探测实心 */
  private ai67FrontWallScan(
    st: import('../world/TileStore').TileStore, intent: number,
  ): boolean {
    const col = Math.floor((this.x + this.w / 2) / 16) + intent + Math.round(this.vx);
    const top = Math.floor(this.y / 16);
    for (let r = top; r < top + Math.floor(this.h / 16) + 1; r++) {
      if (st.inBounds(col, r) && st.isSolid(col, r)) return true;
    }
    return false;
  }

  /** 跳梯三柱选档（AI_067 :51476-51524 逐字）：左/中/右三列底行支承探测
   *  （solid ∨ halfBrick ∨ slope>0 ∨ 平台承立）任一成立才结算；选档列 =
   *  中柱＋意图＋(int)velocity.X，行基准 = 底行、探测在中腰行向上 1/2/4/5 格——
   *  净空 -5.1 / -7.1，顶压 -9.1 / -10.1 / -11.1。拾例外档：越界视作实心（防御式，
   *  原版以 try/catch 回落 -9.1 同义） */
  private ai67JumpLadder(st: import('../world/TileStore').TileStore, intent: number): void {
    const botRow = Math.floor((this.y + this.h) / 16);
    const supportCols = [Math.floor(this.x / 16),
      Math.floor((this.x + this.w / 2) / 16), Math.floor((this.x + this.w) / 16)];
    let supported = false;
    for (const c of supportCols) {
      if (!st.inBounds(c, botRow)) continue;
      const idx = st.idx(c, botRow);
      if (st.isSolid(c, botRow) || st.half[idx] > 0 || st.slope[idx] > 0
        || st.isPlatform(c, botRow)) { supported = true; break; }
    }
    if (!supported) return;
    const pc = Math.floor((this.x + this.w / 2) / 16) + intent + Math.trunc(this.vx);
    const midRow = Math.floor((this.y + this.h / 2) / 16);
    const solid = (oy: number): boolean => {
      if (!st.inBounds(pc, midRow + oy)) return true;
      return st.isSolid(pc, midRow + oy);
    };
    if (!solid(-1) && !solid(-2)) this.vy = -5.1;
    else if (!solid(-2)) this.vy = -7.1;
    else if (solid(-5)) this.vy = -11.1;
    else if (solid(-4)) this.vy = -10.1;
    else this.vy = -9.1;
  }

  /** AI_067 跳跃意图两面合流（:51363-51457,1458 重锚——终清波批统一探测形用）：
   *  · (a) 墙意图档（flag19 直置,无几何前置）：家族 flag20 通过时随移动意图恒真。
   *    蛙 flag2=attackTarget!=-1 条件；虎 flag3=v15Y<-80 条件;猫/蘑菇/海盗族
   *    （flag8/6/…）直 false。policy.wallIntent=true|false|(数值 v15Y<val)
   *  · (b) 前墙列扫档：num55≠0（|Δx|>5 意图）∧ flag21（|Δx|≥64 ∨ Δy≤−48∧|Δx|≥8）
   *    ∧ 列扫命中——ai67FrontWallScan 承载
   *  返回值=落地结算消费的 flag19 */
  private ai67JumpFlags(st: import('../world/TileStore').TileStore,
    ax: number, ay: number,
    policy?: { wallIntent?: boolean | number }): boolean {
    const dxv = ax - this.cx;
    const num55 = Math.abs(dxv) > 5 ? (dxv < 0 ? -1 : 1) : 0;
    let f19 = false;                                    // (a)
    const wi = policy?.wallIntent;
    if (wi === true) f19 = true;
    else if (typeof wi === 'number' && ay - this.cy < wi) f19 = true;
    if (num55 !== 0) {                                  // (b)
      const dyv = ay - this.cy;
      const f21 = Math.abs(dxv) >= 64 || (dyv <= -48 && Math.abs(dxv) >= 8);
      if (f21 && this.ai67FrontWallScan(st, num55)) f19 = true;
    }
    return f19;
  }

  /** AI_067_TryJumpingToTarget 共享尾（1457 :52109-52167；2026-09-08 续单补接——此前
   *  整体未建模）。调用位：:51024（attackTarget>=0 ∧ IsInRangeOfMeOrMyOwner 段,本仓
   *  =findTargetInRangeDual 命中即等价）与 :51212（ai[0]==3 栖点段——本仓 ai[0]==3 态
   *  未折算=登记,仅接 :51024 面）。逐值：
   *  · :52112 shouldFallThrough = toTarget.Y > 盒底——★Z1/BJ433（2026-10-02）翻案
   *    修正（旧注「仅 379 置真→AI_067 全族域内死码」与 BJ435 亲数直接矛盾,毒源清）：
   *    vanilla decidesManualFallThrough=true 全集 = 12 处 SetDefaults（379 :4645/
   *    393-395 :4769/758 :7827/833 :8094/834 :8108/835 :8122/951 :8982/1022 :9681/
   *    1036 :9780/1093 :10209/1112 :10376/1118 :10464——【AI_067 全族均在列】）+
   *    1 处动态（aiStyle 5 宠物 :24101,type 723）= 13 处;HandleMovement :17692-17694
   *    `flag6 = shouldFallThrough` 平台下穿消费位对全族可达。本函数以局部量承载
   *    :52112 判别式供 :52114 湿门读;【字段面】由各族 step 物化为 Entity.dropThrough
   *    （:50454 玩家脚−12/:52112 目标盒底两写位,951 flinxStep BJ435 先落,余族随批补齐）;
   *  · :52113 flag = velocity.Y==0（AI 前段求值=上拍碰撞结果）;
   *  · :52114-52117 wet ∧ vy>0 ∧ !shouldFallThrough → flag=真（湿中下落视作贴地可跃）
   *    ——wet 读相=AI 先于湿段跑的【上子步段值】=wetAi 快照（2026-09-08 定谳批口径）;
   *  · :52119-52122 type 393-395 ∧ vy>2 ∧ !wet 支 = vanilla 死码（`_=` 丢弃,无动作）;
   *  · :52124-52150 1022 蘑菇蓄跃支 = mushBoiStep 既有独立实现（台账批⑤）,本函数以
   *    flag2 形参承接其"本拍已消费"语义（:52149 支体尾置真,leap 是否已发无关）;
   *  · :52151 num4=30；（1093|1112|1118）∧ ai[0]==3 → 16——★BJ433 以 num4 形参承接
   *    （帮工栖点支 :51209 传 16;1093|1112∧ai[0]==3 调用侧已按型档,1118 永不入
   *    state 3 = 该型 16 档域内死码同原版）;
   *  · :52154-52164 共享尾：toTarget.Y < Center.Y−num4 ∧ flag ∧ !flag2 →
   *    velocity.Y = −min(26, sqrt((Center.Y−toTarget.Y)×2×0.4))（无 +1 尾数,与
   *    :51084 flag8 干态专支相区别）。
   *  ★位序契约：调用位在俯扑/扑击/虚空扫描与步行结算段【前】→ 跃起后 vy≠0 使结算段
   *  （梯/表/×2）与干态俯扑门（vy>2/vy>1）整段让位——原版 wet 中下落跃起走本尾、
   *  干态下落跃起走 :51027/:51084 专支,两支以 wet 相互排斥=原文设计。 */
  private ai67TryJumpingToTargetTail(toTargetY: number, flag2: boolean, num4 = 30): void {
    const shouldFallThrough = toTargetY > this.y + this.h;             // :52112（判别式本体,字段面见各族 step）
    // ★BJ-C3/F3（2026-10-06）：:52113 读相=AI 前段=上拍 post-AI 碰撞解算值（vanilla
    //  Update :16880 AI() 先行、:17585 tileCollide 积分碰撞后行零化落地 vy → AI 相
    //  贴地恒 0;与 :51767/:51805 帧段同相,重力 :52051 在两段后）。BJ516④ 重力落
    //  walkChase 尾（:1835）后拍首直读带 +0.4 残留 → 贴地恒假=追高敌平地不跳。
    //  walkChase 四族（虎 833-835/海盗 393-395/flinx 951/雾网 1036）接
    //  lastWalkPreGravVy 快照（BJ519① 先例,调用侧 capturePreGravVy 随批补齐）;
    //  独立形族（pal/mush/frog）步内「先重力后碰撞」无残留、从不调 walkChase →
    //  快照恒 null 走 ?? 直读回落=原相不动（首拍同理,spawn vy=0 即原版相）。
    const vyRead = this.lastWalkPreGravVy ?? this.vy;                  // :52113（读相载体）
    let flag = vyRead === 0;                                           // :52113
    if (this.wetAi && vyRead > 0 && !shouldFallThrough) flag = true;   // :52114-52117
    if (((toTargetY < this.cy - num4) && flag) && !flag2) {            // :52154（num4 形参,:52151）
      const num5 = (toTargetY - this.cy) * -1;                         // :52155
      const num7 = Math.sqrt(num5 * 2 * 0.4);                          // :52156-52158
      this.vy = -(num7 > 26 ? 26 : num7);                              // :52159-52162
    }
  }

  /** ★台账批①（2026-08-31,L 级清偿）：AI_067 步行链【两结算段】1:1 共轨
   *  （1458 Projectile.cs:51273-52057；1457 :51296-51557 两结算段同体,偏移 +23 行——
   *  动值先 grep 符号勿信旧注）。参数 tiers=家族"attackTarget!=-1"速度档：
   *   段① 速度分层与横向积分（:51297-51345）：缺省 0.5/4/4 → 家族档 →
   *       catch-up（num52<|p.v| ⇒ num52=|p.v|、num50=0.7）→ |Δ|>5 加速
   *       （超 num51 改 num53=0.1 缓档）/ ±5 死区 vx×0.9 且 |vx|<2×num50 归零。
   *   段② 跳跃结算（:51363-51619/:52051-52056）：flag21 门（|v15X|≥64 ∨
   *       (v15Y≤−48∧|v15X|≥8)）→ 前墙列扫 flag19 → 落地（vy==0）跳梯三柱选档 +
   *       目标高出距离表（-6..-16 @ 60/80/100/120/140/160/190/210/270/310 阈）+
   *       wet∧num62==0 起跳 ×2；随后 vx 钳 ±num52（flag22 非跃击族恒行）、
   *       重力 += 0.4+num62·num63 封顶 10（num62=GetLerpValue(0,100,v15Y)×
   *       GetLerpValue(-2,-6,vy)，跃击中（蘑菇 flag22）免附加项）。跳跃结算顺序与
   *       原版同拍：settle 先于重力，故首帧积分量一致（-5.1+0.4=-4.7…）。
   *  @param wallIntent 家族 flag20 条件式（(a) 墙意图档）：number=v15Y<val 才置
   *          （虎 flag3=-80,:51428-51431）、true=无条件（无此族用例）、缺省=false
   *          （海盗 flag 等） */
  private ai067WalkChase(
    game: GameHooks, p: Player, ax: number, ay: number,
    tiers: [number, number, number] | null,
    opts?: { wet?: boolean; petting?: boolean; wallIntent?: boolean | number;
      /** ★BJ516①：重力前置捕 velocity.Y（AI_067 帧段读相=:52049 重力前的碰撞结果,
       *  1036 flag7 帧面消费;缺省不捕获零开销） */
      capturePreGravVy?: boolean },
  ): void {
    const st = game.world.store;
    const v15x = ax - this.cx, v15y = ay - this.cy;    // vector15 = 锚 − Center
    let n50 = 0.5, n51 = 4, n52 = 4;                   // :51274-51277 缺省档
    if (tiers) [n50, n51, n52] = tiers;                // attackTarget!=-1 档（:51296-51340）
    const pSpd = Math.abs(p.vx) + Math.abs(p.vy);
    if (n52 < pSpd) { n52 = pSpd; n50 = 0.7; }         // catch-up（:51342-51345）
    let intent = 0;
    if (Math.abs(v15x) > 5) {
      intent = v15x < 0 ? -1 : 1;
      if (v15x < 0) { if (this.vx > -n51) this.vx -= n50; else this.vx -= 0.1; }   // :51354-51359
      else { if (this.vx < n51) this.vx += n50; else this.vx += 0.1; }             // :51360-51365
    } else {                                            // ±5 死区（:51402-51411）
      this.vx *= 0.9;
      if (Math.abs(this.vx) < n50 * 2) this.vx = 0;
    }
    // 跳跃意图（:51363-51466 两面合流,终清波批订正）：
    //  (a) 家族墙意图档（无几何前置）——虎 flag3 条件式 v15Y<−80（wallIntent）,
    //      海盗 flag 直死;抚摸 num56 关闭。
    //  (b) 前墙列扫（家族无关!）——num55≠0 ∧ flag21 ∧ 列扫命中。旧实现曾把虎的
    //      (a) 条件误并入 (b) 扫描门（同高遇墙不跳与原文相悖,回归随批改判）
    const flag21 = Math.abs(v15x) >= 64 || (v15y <= -48 && Math.abs(v15x) >= 8);
    let jump = false;
    if (!opts?.petting) {
      const wi = opts?.wallIntent;
      if (intent !== 0 && (wi === true || (typeof wi === 'number' && v15y < wi))) jump = true;
      if (intent !== 0 && flag21 && this.ai67FrontWallScan(st, intent)) jump = true;
    }
    this.stepUp = true;                                 // Collision.StepUp（:51466）
    this.tileCollide = true;                            // :51273 每 tick 置真
    const num62 = getLerpValue(0, 100, v15y) * getLerpValue(-2, -6, this.vy);   // :51509
    // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗,
    //  速度场不减只削当拍位移——下方 wet 起跳 ×2 读 velocity 场=未阻尼,原文同相）。
    //  现役调用面=虎 833-835/海盗 393-395（旧受段族批,均受段）;域外未来调用者
    //  四旗恒 false → 档恒 1 数值不变。
    const dfWalk067 = projWaterDragFactor(this);
    moveAndCollide(this, game.world, this.vx * dfWalk067, this.vy * dfWalk067);
    if (this.vy === 0 && jump) {                        // 结算段（落地才生效）
      this.ai67JumpLadder(st, intent);
      if (v15y < -48) {                                 // 高出距离表（:51492-51527）
        const d = -v15y;
        this.vy = d < 60 ? -6 : d < 80 ? -7 : d < 100 ? -8 : d < 120 ? -9
          : d < 140 ? -10 : d < 160 ? -11 : d < 190 ? -12 : d < 210 ? -13
          : d < 270 ? -14 : d < 310 ? -15 : -16;
      }
      if ((opts?.wet ?? false) && num62 === 0) this.vy *= 2;                        // :51616-51619
    }
    this.vx = Math.max(-n52, Math.min(n52, this.vx));   // !flag22 钳速（:51625-51631）
    if (this.vx < 0) this.facing = -1;                  // direction（:52058-52071）
    else if (this.vx > 0) this.facing = 1;
    else this.facing = p.cx > this.cx ? 1 : -1;
    if (this.vx > n50 && intent === 1) this.facing = 1;
    if (this.vx < -n50 && intent === -1) this.facing = -1;
    if (opts?.capturePreGravVy) this.lastWalkPreGravVy = this.vy;   // ★BJ516①：帧段读相
    this.vy = Math.min(this.vy + 0.4 + num62, 10);      // 重力 num+num62·num63（:52051-52056）
  }

  /** 沙漠虎本体 833/834/835（aiStyle 67,AI_067 flag3）。★台账批①（2026-08-31,
   *  approx-registry「镇民/宠物」⑬ L 级清偿）：地面段两结算段（速度分层 0.7/6/6
   *  catch-up 系 + 跳梯/高出距离表）替换手写 ±0.12/clamp3.5/5% 小跳近似——
   *  实现在 ai067WalkChase（1458 Projectile.cs:51273-52057,1457 :51296-51557）。
   *  · 周期 818 多段扑击链（AI_067_TigerSpecialAttack :49758-49882/AI_067 内联引用；
   *    旧注 :46383-46479 为 1456 锚）链长 = 宝石数+1；冷却 localAI[0] 成功
   *    833→360/834→300/835→240、失败 10t 重试（:50855 附近本地计数语义不变）
   *  · 链发后瞬移末段入 ai[0]=4 等待（等待期无接触伤 Damage_CanDealDamage
   *    :12453 type∈{833,834,835}∧ai[0]==4 支）；834/835 等待帧 11/其余 9（:10303）
   *  · 锚：有目标 = nPC.Center（flag3 无侧翼点 :51009-51026）;无目标 = 跟随锚
   *    (15+p.w/2+40slot)×dir + 接地扫描（:50296-50300/:51213-51260）
   *  · 索敌 = Minion_FindTargetInRange(800, skipIfCannotHitWithOwnBody)（findTarget-
   *    InRangeDual 1:1,双距择近已归真）;盒相交∧下落 → vy=-4/vx=dir×10 兔跳
   *    蹭伤（:51181-51188）
   *  · 接触冷却 SetDefaults localNPCHitCooldown=10（:8095-8096）✔既有显式一致
   *  · ai[0]=5 追离态（★BJ704-G1 债③定谳改道）：唯一触发源 = 目标脚下 15 格虚空扫描
   *    （:51142-51156）;本体=flag3&flag15 早退拦截块 :50534-50603 cos 波爬高（帧
   *    8/10+rotation += 0.6×dir/滞回离态门 7 行/蹭头弹跳 vy=-8——orbit 核 :50954
   *    对虎不可达,旧 orbit 近似退役;详 tigerBody state5 支注）
   *  · ai[0]=1 归位飞行（★BJ703-D2,2026-10-21 建模——旧=走回家近似,归位态接触窗
   *    悬空=BJ698 登记债②）：无目标 ∧ >500 ∨ |dy|>300 入态（:51171-51199）;
   *    tileCollide=false 直积分/限速 max(10,|p.v|)/<60px 特攻冷却即刷（:50681-
   *    50688）;friendly=true ⇒ 飞行全拍接触伤（BJ698 判语=非 ai0==4 全态可伤）。
   *    落地拍/入态拍零积分=flinxStep 同形家族近似（原版 UpdatePosition 拍照积分）
   *  · 帧/旋转通道（★BJ704-G1 债③清偿,tigerFrame/tigerFrameCd 直写+draw 支消费）：
   *    飞行/爬高 8（834/835=10）+rotation += 0.6×dir（:50818-50826/:50590-50595）、
   *    坐等 9（11）（:50284-50288）、步行 立 0/走带 2-7（2-9）/空中 1（9）+
   *    rotation=0 逐拍复位（:52005-52048,tigerFrameTick）——旧 age/8 兜底退役;
   *    特攻冷却门=flag3 头 :50187-50207 全态递减（★BJ704-G1 债④,state4 坐等期
   *    照跑,成功同拍落 state4 块）
   *  · 未折算登记：flag3 静置尘 269（渲染层,C 类;AddLight 白光三型已由 lightRGB
   *    补课=BJ245 2026-09-21,见 getter 注）、追离中兔跳与
   *    蓄力跳重叠窗未建模——索敌"单距简化"登记于终清波批销账 */
  private tigerBody(game: GameHooks, p: Player, dmg0: number): void {
    // ★Z1/BJ433 平台下穿链（decidesManualFallThrough=true :8094-8122 三档 → 每拍写
    //  shouldFallThrough :50454「玩家脚−12 低于盒底」+ 有目标时 :52112 覆写 →
    //  HandleMovement :17692-17694 消费=Entity.dropThrough/moveAndCollide 承载）——
    //  本行=:50454 锚（AI_067 头位逐拍,覆盖 state4/5 早退拍;有目标拍由 :52112 锚覆写）
    this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    const gems = Math.max(1, this.peerCount(game, 831));
    const scale = 1 + 0.4 * (gems - 1);
    // ★BJ704-G1 债④（BJ703-A 登记债③）：特殊攻击冷却门【前置到 state4 支之前】——
    //  原版 flag3 头 :50187-50207 localAI[0] 递减/尝试在一切状态跑（state4 块
    //  :50281-50297 在其后 ⇒ 坐等期照走;冷却到期可自 state4 内再链发特攻,成功
    //  同拍落 state4 块）。旧置 state4 早退后=坐等期冻结（至多 num4≈40-160t 延迟）。
    //  成功不 return——同拍落入 state4 支（velocity=0/帧 9|11/ai[1]--）=原版同拍序。
    if (this.pounceCd > 0) this.pounceCd--;
    // ★BJ704-G21 R7-P2-2（:50194 damage != 0 门窄修）：原版 damage==0 → 不尝试且
    //  【不置】10t 重试冷却（localAI[0] 保持 ≤0 每拍重查——重查亦无事,虎特攻
    //  索敌/掷流全在 tigerSpecialAttack 内,门在调用前=零消耗）。旧无条件尝试+
    //  失败置 10t=0 伤期白吃冷却窗。虎仆从伤 0 实战不可达（法杖基伤 41 无归零
    //  路径）=边角面,窄修一刀顺带。
    else if (dmg0 !== 0) {
      const cd = this.projId === 834 ? 300 : this.projId === 835 ? 240 : 360;
      if (this.tigerSpecialAttack(game, p, dmg0)) this.pounceCd = cd;
      else this.pounceCd = 10;                          // 失败 10t 重试（:50200）
    }
    // ai[0]==4 等待态（:50281-50297）：velocity=0、帧 9（834/835=11,:50284-50288
    //  ★BJ704-G1 债③已接——旧「动画帧见 draw」注退役）、ai[1]-- 归零回 0
    if (this.tigerA0 === 4) {
      this.vx = this.vy = 0;
      this.tigerFrame = this.projId === 833 ? 9 : 11;   // :50284-50288
      if (--this.tigerA1 <= 0) { this.tigerA0 = 0; this.tigerA1 = 0; }
      return;
    }
    // 索敌先行（state5 与触发源都需要 attackTarget 双距域内的真值——
    // flag16 含 5 :50502-50504 flag15=ai[0]==5 → 虎在追离态每帧重检索）
    const tgtPre = this.findTargetInRangeDual(game, 800, { skipIfCannotHitOwnBody: true });   // ★BJ515 债④：skip=true（:50524）
    // ---- ai[0]==1 归位飞行（:50636-50712 共享段 + flag3 飞行帧块 :50818-50826）----
    // ★BJ703-D2（BJ698 登记债②）：旧=走回家近似（ai067WalkChase 无门直走）,归位态
    //  接触窗悬空。原版：无目标 ∧ >500 ∨ |dy|>300（num3/num4 缺省 :50032-50033,虎无
    //  覆写）→ ai[0]=1;tileCollide=false、加速 0.2/对向 0.3、限速 max(10,|p.v|)、
    //  >2000 瞬移、<200 ∧ 主落地 ∧ 虎底≤主底 ∧ 盒无实心 → 落地回 0（:50666-50674）;
    //  <60px（num22=60 :50681-50688）→ localAI[0]=0 特攻冷却即刷;friendly=true 恒开
    //  （:50485-50488）⇒ 归位飞行全拍接触伤（窗=非 ai0==4 全态,BJ698 判语）。
    //  ★登记债（帧/旋转通道,随 BJ703 红队登记）：飞行帧=8（834/835=10）+
    //  rotation += 0.6×spriteDirection 旋转未建模（虎体帧通道 age/8 兜底族）。
    if (this.tigerA0 === 1) {
      const stT = game.world.store;
      this.tileCollide = false;                      // :50648
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      const dl = Math.hypot(dx, dy);
      if (dl > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }   // :50662-50665
      else if (dl < 200 && p.vy === 0 && this.y + this.h <= p.y + p.h && !this.solidOverlap(stT)) {
        this.tigerA0 = 0;                            // :50666-50674 落地（ai[1] 不动=原版同相）
        if (this.vy < -6) this.vy = -6;
        if (dl < 60) this.pounceCd = 0;              // :50686-50688（num22=60,落地拍同达）
      } else if (dl < 60) {
        this.pounceCd = 0;                           // :50686-50688 localAI[0]=0（本拍无转向）
      } else {
        const sp = Math.max(10, Math.abs(p.vx) + Math.abs(p.vy));   // :50649-50659 num19
        const l = dl || 1;
        if (this.vx < dx / l * sp) { this.vx += 0.2; if (this.vx < 0) this.vx += 0.3; }
        if (this.vx > dx / l * sp) { this.vx -= 0.2; if (this.vx > 0) this.vx -= 0.3; }
        if (this.vy < dy / l * sp) { this.vy += 0.2; if (this.vy < 0) this.vy += 0.3; }
        if (this.vy > dy / l * sp) { this.vy -= 0.2; if (this.vy > 0) this.vy -= 0.3; }
        this.x += this.vx; this.y += this.vy;        // tileCollide=false 直积分（:50637 族）
      }
      if (this.vx !== 0) this.facing = this.vx > 0 ? 1 : -1;   // :50751-50754（无 else=原版同相）
      // ★BJ704-G1 债③（BJ703-A 登记债②）：飞行帧块 :50818-50826——帧 8（834/835=10）
      //  + rotation += 0.6×spriteDirection（facing 镜像;累计不回卷=原版同相,回地面
      //  拍由步行帧机 :52012 复位）
      this.tigerFrame = this.projId === 833 ? 8 : 10;
      this.rot += 0.6 * this.facing;
      this.contact(game, dmg0 * scale, 10);          // friendly=true 全态接触（:12463 仅拒 ai0==4）
      return;
    }
    // ---- ai[0]==5 追离态（★BJ704-G1 债③定谳改道）：原版 flag3&flag15 早退拦截块
    //      :50534-50603 cos 波爬高——整段 return ⇒ orbit 共享核 :50954-50994 对虎
    //      【不可达】（旧仓走 orbit 核系终零波近似:入扑转移/环绕点/180t 超时三面
    //      皆异——伤害窗两解同真、移动形状异;orbit 核唯余消费面=pirateStep）。
    //      唯一触发源=目标脚下 15 格虚空扫描（:51146-51156,见下方 walk 支）。
    //      ★BJ704-G9（G1 登记债①清偿,2026-10-21）入/离态拍接触——原版 Damage()
    //      在 AI 外每拍跑（Update :17136 后）,四个过渡拍（入态 :51147-51152 /
    //      离态×3 :50541-50546 出域 / :50561-50565 支承滞回 / :50597-50601 丢目标）
    //      均以静止盒照结触（Damage_CanDealDamage :12463 仅拒 833-835∧ai0==4,
    //      过渡拍 ai0=5 或 0=窗开）。旧仓四 return 早退=每幕 1 拍零 contact 缺窗
    //      （零位移部分=入态拍零积分家族近似,保留——本刀只清 contact 面）。----
    if (this.tigerA0 === 5) {
      const st5 = game.world.store;
      if (!tgtPre) {   // :50597-50601 丢目标清态
        this.tigerA0 = 0; this.tigerA1 = 0;
        this.contact(game, dmg0 * scale, 10);   // ★G9:过渡拍静止盒照结触
        return;
      }
      // IsInRangeOfMeOrMyOwner(nPC, num2=800)（:50538-50546——台账批⑦双距+CanHit 盒门
      //  真值 :52404-52422,mushBoiStep 爆点门同式;出域清态退段）
      let dMe5 = Math.hypot(tgtPre.cx - this.cx, tgtPre.cy - this.cy);
      if (dMe5 < 800 && !canHitWithOwnBodyBox(st5, this.x, this.y, this.w, this.h, this.facing,
        tgtPre.x, tgtPre.y, tgtPre.w, tgtPre.h)) dMe5 = Infinity;
      let dP5 = Math.hypot(tgtPre.cx - p.cx, tgtPre.cy - p.cy);
      if (dP5 < 800 && !canHitWithMeleeWeaponBox(st5, p.x, p.y, p.w, p.h, p.facing,
        tgtPre.x, tgtPre.y, tgtPre.w, tgtPre.h)) dP5 = Infinity;
      if ((dMe5 < dP5 ? dMe5 : dP5) > 800) {   // :50541-50546 出域清态
        this.tigerA0 = 0; this.tigerA1 = 0;
        this.contact(game, dmg0 * scale, 10);   // ★G9:过渡拍静止盒照结触
        return;
      }
      // 15 行支承扫描（:50547-50566）:num13=num5/2=7——【滞回】入态门=15 行全空,
      //  离态门=7 行内见支承（敌脚下被垫/落回地面即回 walk;越界=tile null 截停同入态扫）
      {
        const ttx5 = Math.floor((tgtPre.x + tgtPre.w / 2) / TILE);
        const tty5 = Math.floor(tgtPre.y / TILE);
        let rows5 = 0;
        for (; rows5 < 15; rows5++) {
          if (!st5.inBounds(ttx5, tty5 + rows5)) break;
          if (st5.flags[st5.idx(ttx5, tty5 + rows5)] & 1) break;   // tile.active()
        }
        if (rows5 < 7) {   // :50561-50565 支承滞回离态
          this.tigerA0 = 0; this.tigerA1 = 0;
          this.contact(game, dmg0 * scale, 10);   // ★G9:过渡拍静止盒照结触
          return;
        }
      }
      // 蹭头弹跳（:50567-50571）：盒交 ∧ vy>=0 → vy=-8 / vx=direction×10（direction
      //  =入态拍冻结值——本块零 direction/spriteDirection 写位=原版同相,不刷新）
      if (this.x < tgtPre.x + tgtPre.w && this.x + this.w > tgtPre.x
        && this.y < tgtPre.y + tgtPre.h && this.y + this.h > tgtPre.y && this.vy >= 0) {
        this.vy = -8;
        this.vx = this.facing * 10;
      }
      // cos 波爬高点（:50572-50589）：num17=cos(timeForVisualEffects/40×2π),>0 折负
      //  → ∈[-1,0],×40 幅 ⇒ top=敌顶+[−40,0] 悬浮带（nPC.Top=(CenterX,Y)）;
      //  Δ=top−Center 限长 20（num14）,velocity=MoveTowards(Δ,4)
      let num17 = Math.cos(visEffectFrames() / 40 * 6.2831854820251465);
      if (num17 > 0) num17 = -num17;
      const topY5 = tgtPre.y + num17 * 40;
      let v5x = tgtPre.cx - this.cx, v5y = topY5 - this.cy;
      const v5l = Math.hypot(v5x, v5y);
      if (v5l > 20) { v5x = v5x / v5l * 20; v5y = v5y / v5l * 20; }
      {
        const ddx5 = v5x - this.vx, ddy5 = v5y - this.vy;
        const dl5 = Math.hypot(ddx5, ddy5);
        if (dl5 <= 4 || dl5 === 0) { this.vx = v5x; this.vy = v5y; }
        else { this.vx += ddx5 / dl5 * 4; this.vy += ddy5 / dl5 * 4; }
      }
      // 帧 8（834/835=10）+ rotation += 0.6×dir（:50590-50595,飞行块同式）
      this.tigerFrame = this.projId === 833 ? 8 : 10;
      this.rot += 0.6 * this.facing;
      // 位移（tileCollide=true 撞墙滑移 + 湿阻尼档——HandleMovement 面,ai067StateFive
      //  同承载;833-835 ∈ MINION_WET_IDS 受段族）
      const dfClimb = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfClimb, this.vy * dfClimb);
      // ★BJ698：state5 追离拍接触伤——虎 flag3 friendly=true 恒开（AI_067 :50485-50488），
      //  projPet 门 833-835 carve-out（:12495）+ 首行仅拒 ai[0]==4（:12463）⇒ 窗=非 4
      //  全态（旧 return 早退=state5 拍零伤=缺窗;orbit 抵达转扑支随改道退役=原版虎
      //  不可达面）。
      this.contact(game, dmg0 * scale, 10);
      return;
    }
    const st = game.world.store;
    const tgt = tgtPre;
    // 湿旗=上拍段值快照 wetAi（vanilla AI_067 :51616 湿身 ×2 读 Projectile.wet=AI 先于
    // 湿段跑读上一子步段值;2026-09-08 定谳批,见类字段块头注①②③）
    const wet = this.wetAi;
    let ax: number, ay: number;
    if (tgt) {
      ax = tgt.cx; ay = tgt.cy;
      // TryJumpingToTarget 共享尾（:51024 调用位;toTarget=敌心）——跃起后 vy<0 使
      // 兔跳门（:51181 velocity.Y>=0）与步行结算段让位（原版同序）
      this.ai67TryJumpingToTargetTail(tgt.cy, false);
      this.dropThrough = tgt.cy > this.y + this.h;   // ★Z1/BJ433 :52112 锚（目标盒底低于盒底 → 下穿平台追敌）
      // 目标脚下 15 格虚空扫描（:51142-51156,flag3 支,IsInRangeOfMeOrMyOwner 域内
      // 每帧跑）：nPC3.Top（Entity.Top=CenterX :86-90）向下数 num5=15 行，遇
      // active() 或越界(null) 即截停；整窗无一格实心 → ai[0]=5 追离态+ai[1]=0
      // 整段退（state5 核见上）。★旧登记"未折算"于终零波清偿——扫描列取【中心列】,
      // 曾误用左缘列（ Entity.cs:86 Top=(X+w/2,Y) 终零波勘误））
      // ★BJ704-G9（G1 登记债①）入态拍接触——原版 :51147-51152 置 ai0=5 后整段
      //  return,Damage() 在 AI 外照跑（ai0=5 窗开）=静止盒结触;旧 return 早退缺窗。
      {
        const ttx = Math.floor((tgt.x + tgt.w / 2) / TILE);
        const tty = Math.floor(tgt.y / TILE);
        let rows = 0;
        for (; rows < 15; rows++) {
          if (!st.inBounds(ttx, tty + rows)) break;          // 越界=tile null → break
          if (st.flags[st.idx(ttx, tty + rows)] & 1) break;   // tile.active()
        }
        if (rows >= 15) {
          this.tigerA0 = 5; this.tigerA1 = 0;
          this.contact(game, dmg0 * scale, 10);   // ★G9:入态拍静止盒照结触
          return;
        }
      }
      // 接敌兔跳（:51181-51188：Hitbox 相交 ∧ velocity.Y>=0 → vy=-4/vx=direction*10）
      if (this.x < tgt.x + tgt.w && this.x + this.w > tgt.x
        && this.y < tgt.y + tgt.h && this.y + this.h > tgt.y && this.vy >= 0) {
        this.vy = -4;
        this.vx = (tgt.cx >= this.cx ? 1 : -1) * 10;
      }
    } else {
      // ---- 无目标归位门（:51171-51199 共享段;★BJ703-D2 建模）：>2000 瞬移 /
      //      >500 ∨ |dy|>300 → ai[0]=1（对向竖速清零 :51182-51189;入态拍零积分=
      //      flinxStep/frogStep 同形家族近似）----
      const dpxT = p.cx - this.cx, dpyT = p.cy - this.cy;
      const dPT = Math.hypot(dpxT, dpyT);
      if (dPT > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }
      else if (dPT > 500 || Math.abs(dpyT) > 300) {
        if (this.vy > 0 && dpyT < 0) this.vy = 0;    // :51182-51189
        if (this.vy < 0 && dpyT > 0) this.vy = 0;
        this.tigerA0 = 1;                            // :51193
        return;
      }
      ax = p.cx - (15 + p.w / 2) * p.facing - 40 * this.slot * p.facing;   // :50296-50298
      ay = p.cy;
      const g = this.groundAnchorScan(st, p, ax, ay);
      ax = g.x; ay = g.y;
    }
    // ★BJ-C3/F3：capturePreGravVy 补齐（跳尾 :52113 读相快照载体,四族同修）
    this.ai067WalkChase(game, p, ax, ay, tgt ? [1, 8, 8] : null,   // flag3 档 :51322-51325
      { wet, wallIntent: -80, capturePreGravVy: true });
    // ★BJ704-G1 债③：步行帧机（flag3 块 :52005-52048,读相=碰撞后重力前——
    //  lastWalkPreGravVy 快照承载）+ rotation=0 逐拍复位（:52012）
    this.tigerFrameTick();
    this.contact(game, dmg0 * scale, 10);
  }

  /** ★BJ704-G1 债③（BJ703-A 登记债②）：虎步行帧机（AI_067 flag3 块 :52005-52048
   *  1:1）——读相=碰撞后重力前（lastWalkPreGravVy=BJ516① 快照;vx=碰撞后速度场）。
   *  num74=8（834/835=10）：立帧 0 / 走带 2..num74−1（fc += trunc|vx|+1 速度计频,
   *  >10 推帧,越带（<2 或 ≥num74）回 2）/ 空中 1（834/835=9）;rotation 逐拍复位
   *  0（:52012——飞行/爬高态 +=0.6 累计只存活到回地面拍）。调用位=tigerBody
   *  walkChase 后（原版帧段在两结算段尾 :52005,同相位;入 state1/5 拍让位=原版
   *  大块门 ai[0]==0||3 同相,帧冻结在上一值）。 */
  private tigerFrameTick(): void {
    const num74 = this.projId === 833 ? 8 : 10;            // :52007-52011
    this.rot = 0;                                          // :52012
    if (this.lastWalkPreGravVy === 0) {                    // velocity.Y==0（:52013 读相）
      if (this.vx === 0) { this.tigerFrame = 0; this.tigerFrameCd = 0; }   // :52015-52019
      else if (Math.abs(this.vx) >= 0.5) {
        this.tigerFrameCd += Math.trunc(Math.abs(this.vx)) + 1;           // :52022-52023
        if (this.tigerFrameCd > 10) { this.tigerFrame++; this.tigerFrameCd = 0; }   // :52024-52028
        if (this.tigerFrame >= num74 || this.tigerFrame < 2) this.tigerFrame = 2;  // :52029-52032
      } else { this.tigerFrame = 0; this.tigerFrameCd = 0; }              // :52034-52038
    } else {
      this.tigerFrameCd = 0;                               // :52042
      this.tigerFrame = this.projId === 833 ? 1 : 9;       // :52043-52047
    }
  }

  /** AI_067_TigerSpecialAttack（:46383-46479）：多段 818 链 1:1。
   *  目标池 = 玩家周 1600×800 盒（:46389-46399）；nPC2 距玩家最近收尾、nPC3 距本体
   *  最近首发，其余随机带 4×序号速度前置补位（list2 ≤ 宝石数+1，:46401-46451）；
   *  末段落点实心则追加玩家中心（:46455-46459）；逐段 818（ai[0]=-累计t×4 延迟、
   *  ai[1]=段时长×4，段时长 = min(min(20,30/段数), 4+ceil(距离/50)) 下限 5，
   *  :46461-46472） */
  private tigerSpecialAttack(game: GameHooks, p: Player, dmg0: number): boolean {
    const ents = (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities;
    const gems = Math.max(1, this.peerCount(game, 831));
    const num = gems + 1; // :46388（ownedProjectileCounts[831]+1）
    const pool: (EnemyLike & { vx?: number; vy?: number })[] = [];
    for (const e of game.enemies()) {
      const en = e as EnemyLike & { vx?: number; vy?: number };
      if (!canBeChasedBy(e)) continue;   // CanBeChasedBy :91070/:91141——友好+immortal 族不入索敌（防追踪睡渔夫/假人）
      if (!en.dead && Math.abs(en.cx - p.cx) <= 800 && Math.abs(en.cy - p.cy) <= 400) pool.push(en);
    }
    if (!pool.length) return false;
    // nPC2：距玩家最近（:46402-46412）
    let n2 = pool[0];
    for (let j = 1; j < pool.length; j++) {
      if (Math.hypot(n2.cx - p.cx, n2.cy - p.cy) > Math.hypot(pool[j].cx - p.cx, pool[j].cy - p.cy)) n2 = pool[j];
    }
    pool.splice(pool.indexOf(n2), 1);
    // nPC3：距本体最近（:46414-46426）
    let n3: (EnemyLike & { vx?: number; vy?: number }) | null = null;
    if (pool.length) {
      n3 = pool[0];
      for (let k = 1; k < pool.length; k++) {
        if (Math.hypot(n3.cx - this.cx, n3.cy - this.cy) > Math.hypot(pool[k].cx - this.cx, pool[k].cy - this.cy)) n3 = pool[k];
      }
      pool.splice(pool.indexOf(n3), 1);
    }
    const hops: { x: number; y: number }[] = [];
    if (n3) hops.push({ x: n3.cx, y: n3.cy }); // :46428-46431
    let lead = 0;
    while (pool.length > 0 && hops.length < num - 1) { // :46433-46441（速度前置 4×(序号+1)）
      const idx = Math.floor(Math.random() * pool.length);
      const en = pool[idx];
      hops.push({ x: en.cx + (en.vx ?? 0) * 4 * (lead + 1), y: en.cy + (en.vy ?? 0) * 4 * (lead + 1) });
      pool.splice(idx, 1);
      lead++;
    }
    hops.push({ x: n2.cx, y: n2.cy }); // :46443-46447（收尾 = 距玩家最近）
    // 末段落点实心 → 追加玩家中心（:46448-46452）
    const st = game.world.store;
    const lastT = Math.floor(hops[hops.length - 1].x / TILE), lastY = Math.floor(hops[hops.length - 1].y / TILE);
    if (st.inBounds(lastT, lastY) && st.isSolid(lastT, lastY)) hops.push({ x: p.cx, y: p.cy });
    const num3 = Math.min(20, 30 / hops.length); // :46455-46457
    let cx0 = this.cx, cy0 = this.cy, num4 = 0;
    const add = (el: unknown) => ents.add(el, 'projectiles');
    for (const h of hops) {
      const hx = h.x + (cx0 < h.x ? 20 : -20); // :46459-46462（X 向前偏 20px）
      const dx = hx - cx0, dy = h.y - cy0;
      const dist = Math.hypot(dx, dy);
      let num6 = Math.min(num3, 4 + Math.ceil(dist / 50)); // :46463-46468
      if (num6 < 5) num6 = 5;
      add(new TigerPounce(cx0, cy0, dx, dy, dmg0, () => this.ownerRef(), -num4 * 4, num6 * 4)); // :46470
      cx0 = hx; cy0 = h.y;
      num4 += num6; // :46473-46474
    }
    this.x = cx0 - this.w / 2; this.y = cy0 - this.h / 2; // base.Center = vector2（:46475）
    this.vx = this.vy = 0;
    this.tigerA0 = 4; this.tigerA1 = num4; // ai[0]=4 / ai[1]=总时长（:46476-46477）
    return true;
  }

  /** ---- 海盗随从 393-395（2584 海盗法杖,AI_067 flag 分支,台账批② A 档清偿
   *  2026-08-31）---- 此前走通用飞行悬停近似（:10 头注"地面型判定省略"面）。
   *  原版专属段（1458 Projectile.cs：flag 定义 :50020/:50291 跟随锚/:50513 num2=800
   *  索敌/:51003-51007 扑击门/:51041-51097 高空俯扑+落地尘 gore/:51296-52057 两结算
   *  段/:50862-50869 扑击态 friendly 窗）：
   *   · 态机 pirA0=ai[0]（0 地面 / 1 归位飞行 / 2 扑击 / 5 追离 orbit）、pirA1=ai[1]
   *     （扑击倒数 num10=15；state5 兼作 180t 计数——原版同槽复用）
   *   · 归位飞行（:50636-50712 同族）：tileCollide=false、加速 0.2、限速 max(10,|p.v|)；
   *     >2000 瞬移；<200 ∧ 主落地 ∧ 头顶净空 → 落地回 0
   *   · 无目标：跟随锚 (15+p.w/2)+20slot×dir（:50291-50294）＋接地扫描；归位门
   *     500/300（num3/num4 缺省 :50031-50033）
   *   · 有目标：anchor=nPC.Center（flag 无侧翼点）;≤20px → ai[0]=2/ai[1]=15
   *     （num30=20/flag14 支 :51155-51177）；高空俯扑 vy>2∧!wet∧敌【中心】高于盒底
   *     250px+ → ★position.Y%1<0.5 整分叉 quirk(:51027) 入 ai[0]=5 追离态跳过本帧,
   *     否则 sqrt(2×0.4×h) 反向起跳封顶 26（h=我中心−敌中心 num31,X 抖 ±Next×5）
   *     → 与 boss>600 触发源（:51077,同一 `flag&&ai[1]==0` 块内【先俯扑后距离】的
   *     先后关系）共为终零波清偿;state5 共享核 = ai067StateFive（orbit 点 =
   *     敌心+rot(minionPos×2π/0.5862069)×min(w,h)/4,速 16,<32px 距离入扑,180t 超时）
   *   · 接触伤仅在扑击窗（走行 friendly=false :50476 缺省不复位——海盗不在置真名单,
   *     扑击支 :50862 置 true）：SetDefaults localNPCHitCooldown=18（:4765-4770）
   *   · 移动档 flag 档 = 目标在位 1/8/8（:51317-51321）、catch-up 同共轨两结算段
   *   · 帧（:51802-51835 走行 + :50866-50872 扑击）：立 0/走 0-3（fc+=⌊|vx|⌋+1>10
   *     翻页）/空中 14/扑击 4+(15-ai1)/5（空中 +3 → 7-9）；pirFrame 直写通道接 draw,
   *     旧 age/8 匀速兜底退役（终零波 M2 清偿）
   *   · 未折算登记：落地尘 216/gore 580-583·11-14 两象限与站立唠叨环（:52057
   *     localAI 900-1200 加尘,渲染 C 类）；state5 中蓄力跳重叠窗未建模 */
  private pirA0 = 0;
  private pirA1 = 0;
  /** 海盗帧机状态（AI_067 flag 帧段直写：走行 :51802-51835/扑击 :50866-50872；
   *  state1 归位飞行与 state5 追离【不写 frame】= 冻结上一帧,原版同语义） */
  private pirFrame = 0;
  private pirFrameCd = 0;
  /** localAI[0] 归位镜像（AI_067 state5 距离/16 写点 :50970；不与加尘计数共用以
   *  免交叉清零——原版同槽混用,该加尘环：52057 加尘近似本就 C 类未建模） */
  private pirLai0 = 0;
  /** 虎侧 state5 距离镜像（同上,虎的 localAI[0] 无其它消费者;★BJ704-G1 债③改道
   *  后 state5=cos 波爬高块零 localAI[0] 写位=恒 0,字段保留兼容私域访问测试） */
  private tigerLai0 = 0;
  /** ★BJ704-G1 债③：虎帧机状态（AI_067 flag3 帧段直写 :52005-52048 步行/
   *  :50818-50826 飞行/:50281-50297 坐等/:50590-50595 爬高;tigerFrameTick+各态
   *  直写,旧 age/8 匀速兜底扫遍 10/12 帧带退役） */
  private tigerFrame = 0;
  private tigerFrameCd = 0;
  /** 小雪怪 951 状态（AI_067 flag5,Projectile.cs:50014-52160）：ai[0] 仅两态——
   *  0=地面跟随+索敌 / 1=归位飞行。flag14=false（:50475-50477）关掉 :51102 扑击门
   *  （:51023 高空俯扑与 :51077 boss>600 追离亦为 flag 专支）⇒ 永不入 2/3/5 态。 */
  private flinA0 = 0;
  /** 小雪怪帧机状态（AI_067 flag5 帧段直写——地面 :51766-51790 立 0/走 2-11/空中 1;
   *  飞行 :50761-50772 每 4t 走 2-11 循环。与海盗【飞行冻结】不同相） */
  private flinFrame = 0;
  private flinFrameCd = 0;
  /** AI_067 ai[0]==5 追离态共享核（Projectile.cs :50955-51001，终零波清偿）：
   *  orbit 点 = 敌 Center + rot(minionPos×2π/0.5862069)×min(w,h)/2×0.5（:50961-50966）；
   *  velocity = Vector2.Zero.MoveTowards(orbit−Center, num29=16)（:50969）；
   *  localAI[0]=距离/16 → <2 即入扑击（vel×0.3 + 圆周缘4 抖、vy=-3——原版先 Abs 后
   *  覆写=恒 -3;Center 钉 orbit 点）;否则 ai[1]++ ≥180 超时回 0（num9=0 海盗/虎）。
   *  flag16 含 5（海盗 :50512/虎 :50502-50504）→ 调用前必须先重跑双距索敌刷新
   *  attackTarget；丢目标 → 清态回 0 并整段退（:50956-50963）。tileCollide=true
   *  正常 Move 撞墙滑移。调用方此后直接 return。
   *  ★BJ704-G1 债③：虎 833-835 已改道 :50534-50603 cos 波爬高块（flag3&flag15
   *  早退拦截 ⇒ 本 orbit 核对虎【不可达】,原版判谳）——现役唯余消费面=pirateStep;
   *  'tigerA0' 系键保留类型位（历史直驱测试兼容）,勿新增虎侧调用。 */
  private ai067StateFive(game: GameHooks, tgtF: EnemyLike | null,
    ai0Key: 'pirA0' | 'tigerA0', ai1Key: 'pirA1' | 'tigerA1',
    laiKey: 'pirLai0' | 'tigerLai0', pounceDur: number): void {
    if (!tgtF) {
      this[ai0Key] = 0;
      this[ai1Key] = 0;
      this[laiKey] = 0;
      return;                                       // :50956-50963 丢目标清态退段
    }
    const num28 = Math.min(tgtF.w, tgtF.h) / 2 * 0.5;
    const ang = this.slot * ((Math.PI * 2) / 0.5862069);
    const px = tgtF.cx + Math.cos(ang) * num28;
    const py = tgtF.cy + Math.sin(ang) * num28;
    const dx = px - this.cx, dy = py - this.cy;
    const dl = Math.hypot(dx, dy);
    const sp = Math.min(16, dl);
    this.vx = dl ? (dx / dl) * sp : 0;
    this.vy = dl ? (dy / dl) * sp : 0;
    this[laiKey] = dl / 16;                         // localAI[0]=距离/16（:50970）
    this.facing = this.vx >= 0 ? 1 : -1;            // direction=spriteDirection（:50971）
    moveAndCollide(this, game.world, this.vx, this.vy);   // tileCollide=true（:50454 缺省）
    if (this[laiKey] < 2) {                         // 抵达入扑（:50972-50980）
      this[ai1Key] = pounceDur;
      this[ai0Key] = 2;
      this.vx *= 0.3;
      const ra = Math.random() * Math.PI * 2;
      this.vx += Math.cos(ra) * 4;                  // NextVector2CircularEdge(4,4)
      this.vy += Math.sin(ra) * 4;
      this.vy = -3;                                 // 先 Abs 后覆写 = 净 -3（:50978）
      this.x = px - this.w / 2;                     // base.Center = orbit 点（:50979）
      this.y = py - this.h / 2;
      return;
    }
    if (++this[ai1Key] >= 180) {                    // 超时回 0（:50981-50990,num9=0）
      this[ai0Key] = 0;
      this[ai1Key] = 0;
      this[laiKey] = 0;
    }
  }
  private pirateStep(game: GameHooks, p: Player, dmg0: number): void {
    // ★Z1/BJ433 平台下穿链（decidesManualFallThrough=true :4769 → :50454 每拍写 +
    //  :52112 目标拍覆写 → :17692-17694 消费;承载=Entity.dropThrough,下同）
    this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    const st = game.world.store;
    // 湿旗=上拍段值快照 wetAi（vanilla AI_067 :51027 俯扑门读 Projectile.wet=AI 先于
    // 湿段跑读上一子步段值;2026-09-08 定谳批,见类字段块头注①②③）
    const wet = this.wetAi;
    // 终清波批：Minion_FindTargetInRange(800, skipOwnBody) 双距检索归真（单距近似退役）
    const tgtF = this.findTargetInRangeDual(game, 800, { skipIfCannotHitOwnBody: true });   // ★BJ515 债④：skip=true（:50524）
    // ---- ai[0]==1 归位飞行（:50636-50712 族档）----
    if (this.pirA0 === 1) {
      this.tileCollide = false;
      // 位移阻尼不适用（vanilla :50648 tileCollide=false → 湿阻尼块 :17721 不跑;
      //  直写位=velocity 场全量位移,本仓 x += vx 同相）
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      const dl = Math.hypot(dx, dy);
      if (dl > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }
      else if (dl < 200 && p.vy === 0 && this.y + this.h <= p.y + p.h && !this.solidOverlap(st)) {
        this.pirA0 = 0; this.pirA1 = 0;
        if (this.vy < -6) this.vy = -6;
      } else {
        const sp = Math.max(10, Math.abs(p.vx) + Math.abs(p.vy));
        const l = dl || 1;
        if (this.vx < dx / l * sp) { this.vx += 0.2; if (this.vx < 0) this.vx += 0.3; }
        if (this.vx > dx / l * sp) { this.vx -= 0.2; if (this.vx > 0) this.vx -= 0.3; }
        if (this.vy < dy / l * sp) { this.vy += 0.2; if (this.vy < 0) this.vy += 0.3; }
        if (this.vy > dy / l * sp) { this.vy -= 0.2; if (this.vy > 0) this.vy -= 0.3; }
        this.x += this.vx; this.y += this.vy;
      }
      this.facing = this.vx !== 0 ? (this.vx > 0 ? 1 : -1) : p.facing;
      return;
    }
    // ---- ai[0]==5 追离态（:50955-51001，终零波清偿）——触发源见下方目标支：
    //      :51032 俯扑前置 position.Y%1<0.5 整分叉 与 :51077 boss>600 距离门，
    //      先后关系 = 同一 `flag && ai[1]==0` 块内先俯扑后距离。orbit 接近核共享,
    //      索敌已在本函数头部刷新（海盗 flag16 = ai0∈{0,5}）。num10=15 缺省档 ----
    if (this.pirA0 === 5) {
      this.ai067StateFive(game, tgtF, 'pirA0', 'pirA1', 'pirLai0', 15);
      return;
    }
    // ---- 地面态 ----
    if (!tgtF) {
      const dP = Math.hypot(p.cx - this.cx, p.cy - this.cy);
      if (dP > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }
      else if (dP > 500 || Math.abs(p.cy - this.cy) > 300) { this.pirA0 = 1; return; }
    }
    if (this.pirA0 === 2) {                              // 扑击态（:50861-50927：friendly 置真+帧+重力+倒数,无速度改写）
      // 攻击帧机（:50866-50872 flag 支）：frame=4+(15−ai1)/5（0..2→4..6），
      // 空中(vy≠0) +3 → 7..9。ai1 尚未递减时求值 = 原版序
      this.pirFrame = Math.min(6, 4 + Math.floor((15 - this.pirA1) / 5))
        + (this.vy !== 0 ? 3 : 0);
      this.vy = Math.min(this.vy + 0.4, 10);
      // ★水中位移阻尼（:17721 湿支;扑击态 tileCollide 承地面拍 :51266 置真,湿支照跑）
      const dfPirPounce = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfPirPounce, this.vy * dfPirPounce);
      this.contact(game, dmg0, 18);                      // 扑击窗内才有接触伤（friendly=true 支）
      if (--this.pirA1 <= 0) { this.pirA0 = 0; this.pirA1 = 0; }     // num9=0 直回 0
      return;
    }
    // ---- 无目标归位门/有目标锚 ----
    let ax: number, ay: number;
    if (tgtF) {
      ax = tgtF.cx; ay = tgtF.cy;
      // TryJumpingToTarget 共享尾（:51024 调用位,:52109-52167;toTarget=敌心,flag 恒 false）
      // ——跃起后 vy<0 使下方俯扑门 vy>2 与步行结算段让位（原版同序;wet 中下落跃起走
      // 本尾 :52114 支,干态下落走 :51027 俯扑专支=原文两支以 wet 互斥）
      this.ai67TryJumpingToTargetTail(tgtF.cy, false);
      this.dropThrough = tgtF.cy > this.y + this.h;   // ★Z1/BJ433 :52112 锚
      // ---- flag && ai[1]==0 块（:51022-51082，终零波补全两触发源+先后关系）----
      // ① 高空俯扑（:51023-51076）：vy>2 ∧ !wet ∧ 敌 CenterY−我盒底 < −250 →
      //    ★position.Y%1<0.5 整分叉 quirk（:51027-51031）：满足即入 ai[0]=5（ai[1]=0）
      //    并整段退【跳过本帧蓄力跳】——否则 sqrt 蓄力反跳（h=敌中心距 :51033-51036,
      //    封顶 26）+ X 圆周缘抖 ±NextFloat×NextFloat×5。原版半数拍走追离态 =
      //    原文真态非笔误（Physics 整格落位后 y 为整值 → 恒进分支；空中滑移帧为
      //    小数才回落跳）;旧实现无该分叉=海盗空中恒自跳,本批对齐。
      if (this.pirA1 === 0
        && this.vy > 2 && !wet && tgtF.cy - (this.y + this.h) < -250) {
        if ((this.y % 1) < 0.5) {                     // :51025-51031 quirk 分叉
          this.pirA0 = 5; this.pirA1 = 0; return;
        }
        const h = this.cy - tgtF.cy;                  // num31=(vector7.Y−Center.Y)×−1=我中心−敌中心
        this.vy = -Math.min(26, Math.sqrt(Math.max(0, h) * 2 * 0.4));   // num32=0.4
        this.vx += (Math.random() * 2 - 1) * Math.random() * 5;   // NextFloatDirection×NextFloat×5
      }
      // ② boss>600 追离触发（:51077-51082,在俯扑块之后独立判——同块先后关系）:
      //    与敌心距离 >600 且目标是 boss → ai[0]=5 追离态（orbit 接近核另段）
      if (this.pirA1 === 0
        && Math.hypot(tgtF.cx - this.cx, tgtF.cy - this.cy) > 600
        && (((tgtF as unknown as { boss?: boolean }).boss === true)
          || ((tgtF as unknown as { def?: { boss?: boolean } }).def?.boss === true))) {
        this.pirA0 = 5; this.pirA1 = 0; return;
      }
      // 扑击门（:51155-51160）：距锚 <20 → 入扑
      if (Math.hypot(ax - this.cx, ay - this.cy) < 20) {
        this.pirA0 = 2; this.pirA1 = 15;                 // num10=15（缺省,num9=0 单轮）
        this.facing = tgtF.cx - this.cx >= 0 ? 1 : -1;   // direction 朝敌（:51175-51176）
        return;
      }
    } else {
      ax = p.cx - (15 + p.w / 2) * p.facing - 20 * this.slot * p.facing;   // :50291-50294
      ay = p.cy;
      const g = this.groundAnchorScan(st, p, ax, ay);
      ax = g.x; ay = g.y;
    }
    // ★BJ-C3/F1：capturePreGravVy 补齐（帧机 :51805 读相快照载体 + F3 跳尾同源）
    this.ai067WalkChase(game, p, ax, ay, tgtF ? [1, 8, 8] : null,
      { wet, capturePreGravVy: true });                  // flag 档 :51317
    // 走行帧机（:51802-51835 flag 支,移动段内逐帧）：立 0 / 空中(vy≠0) 14 /
    // 行走 fc+=⌊|vx|⌋+1>10 → frame++ 且 ≥4 回 0。仅 state0 走行段执行到此处
    // ★BJ-C3/F1（2026-10-06）：:51805 读相=AI 相=贴地 0（重力 :52051 在帧段后、
    //  post-AI 碰撞 :17585 再零化）——BJ516④ 重力落 walkChase 尾后直读恒 0.4 →
    //  pirFrame=14 空中帧恒挂;改读 lastWalkPreGravVy 快照（=碰撞后重力前,BJ519① 先例）。
    if ((this.lastWalkPreGravVy ?? this.vy) === 0) {
      if (this.vx === 0 || Math.abs(this.vx) < 0.5) {
        this.pirFrame = 0; this.pirFrameCd = 0;          // |vx|<0.5 静立档
      } else {
        this.pirFrameCd += Math.floor(Math.abs(this.vx)) + 1;
        if (this.pirFrameCd > 10) {
          this.pirFrame++;
          this.pirFrameCd = 0;
          if (this.pirFrame >= 4) this.pirFrame = 0;
        }
      }
    } else {
      this.pirFrameCd = 0;
      this.pirFrame = 14;
    }
  }

  /** 小雪怪随从 951（FlinxStaff 5069 → 弹 951、buff 325;aiStyle 67 = AI_067 flag5 支,
   *  Projectile.cs:50014-52160）。★BJ435 定谳刀（用户实报「召唤出来的小雪怪浮空,怀疑
   *  贴图没在碰撞盒」）：原版本体是【地面步行族】（num2=800 索敌 → 步行链两结算段 +
   *  重力 0.4 封顶 10 + 跳梯 + 平台下穿）,本仓曾无 951 分发 = 落通用飞行悬停（Game.
   *  spawnMinion ground 统一 false）→ 盒悬停玩家侧后 = 浮空根因——贴图锚（Main.cs:
   *  :33942-33946 盒底−帧高/2+4,本仓 CENTER_ANCHOR_33703 支既有 1:1）一直正确,
   *  错位在 AI 层（盒本身悬空）而非绘制层。
   *  · 两态机：ai[0] 0=地面跟随+索敌 / 1=归位飞行——flag14=false + friendly=true
   *    （:50475-50477）关掉 :51102 扑击门（:51023 高空俯扑与 :51077 boss>600 追离均为
   *    flag 专支）⇒ 永不入 2/3/5 态,接触伤全态有效（usesIDStaticNPCImmunity
   *    idStaticNPCHitCooldown=10 :8984-8986,CONTACT_CD_TABLE 既有同源条目）
   *  · 索敌：Minion_FindTargetInRange(800, skipOwnBody)（num2=800 :50134-50137,
   *    flag16=ai[0]==0 缺省 :50504-50505）;归位门 500/300（num3/num4 缺省 :50031-50033）
   *  · 跟随锚（:50295-50299）：玩家中心 −(45+p.w/2)×dir − minionPos×30×dir + 接地扫描
   *  · 移动档（:51274-51306）：无目标 0.5/4/4 缺省;有目标 flag5 档 0.65/5.5/5.5;
   *    catch-up 同共轨（ai067WalkChase 内）
   *  · 跳跃意图 flag20（:51438-51441,置于 |Δx|>5 意图门内）：attackTarget!=-1 ∧ 目标盒
   *    相交本体盒 → 落地起跳（踩脸弹跳）——wallIntent 策略位承接（ai067WalkChase 同门）
   *  · 平台下穿（SetDefaults decidesManualFallThrough=true :8982 → HandleMovement
   *    :17692-17694 shouldFallThrough → TileCollision(fallThrough,fall2)）：无目标 =
   *    :50454 玩家脚−12 低于盒底;有目标 = :51024→:52112 目标心低于盒底（本仓
   *    dropThrough 承载;★758/833-835/1022/1036/1093 跨族登记债随 Z1/BJ433
   *    （2026-10-02）清偿——tigerBody/pirateStep/frogStep/mushBoiStep/palGroundStep
   *    两写位实体化;1036 仓内未走 AI_067 步行链（悬停通道）不适用,登记在案）
   *  · 命中反跳（Damage_PVE_Inner :13115-13124）：对被击敌 vx=normalize(敌心−心).X
   *    + (rand−0.5)×13、vy=−5（SafeNormalize 零距=Zero → X=0）;锚定扫描首重叠敌
   *    （原版逐被击靶覆写取尾——idStatic cd=10 下多靶同拍罕见,净同相,登记近似）
   *  · 帧/旋转——地面段（:51766-51790）：立 0 / 走 2-11（fc+=⌊|vx|⌋+1>10 翻页,
   *    域外回 2）/ 空中 1 + rotation=min(4,vy)×−0.1（spriteDirection=-1 时 −2π 照录
   *    ≡同相）;落地 rotation AngleTowards(0,0.3)。飞行段（:50752-50772 共享尾 flag5
   *    子块）：spriteDirection=sign(vx)、帧每 4t 走 2-11 循环、rotation+=0.25×spriteDir */
  private flinxStep(game: GameHooks, p: Player, dmg0: number): void {
    const st = game.world.store;
    const wet = this.wetAi;
    const tgtF = this.findTargetInRangeDual(game, 800, { skipIfCannotHitOwnBody: true });   // num2=800（:50134-50137）;★BJ515 债④：skip=true（:50524）
    // ---- ai[0]==1 归位飞行（:50638-50735 共享段,flag5 无家族门 = pirateStep 同式;
    //      帧面 = :50752-50772 共享尾 flag5 子块——与海盗飞行【冻结帧】不同相）----
    if (this.flinA0 === 1) {
      this.tileCollide = false;
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      const dl = Math.hypot(dx, dy);
      if (dl > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }
      else if (dl < 200 && p.vy === 0 && this.y + this.h <= p.y + p.h && !this.solidOverlap(st)) {
        this.flinA0 = 0;
        if (this.vy < -6) this.vy = -6;
      } else {
        const sp = Math.max(10, Math.abs(p.vx) + Math.abs(p.vy));
        const l = dl || 1;
        if (this.vx < dx / l * sp) { this.vx += 0.2; if (this.vx < 0) this.vx += 0.3; }
        if (this.vx > dx / l * sp) { this.vx -= 0.2; if (this.vx > 0) this.vx -= 0.3; }
        if (this.vy < dy / l * sp) { this.vy += 0.2; if (this.vy < 0) this.vy += 0.3; }
        if (this.vy > dy / l * sp) { this.vy -= 0.2; if (this.vy > 0) this.vy -= 0.3; }
        this.x += this.vx; this.y += this.vy;
      }
      if (this.vx !== 0) this.facing = this.vx > 0 ? 1 : -1;   // :50752-50754
      this.flinFrameCd++;                                       // :50761-50769
      if (this.flinFrameCd > 3) { this.flinFrameCd = 0; this.flinFrame++; }
      if (this.flinFrame < 2 || this.flinFrame >= 12) this.flinFrame = 2;
      this.rot = angleTowards(this.rot, this.rot + 0.25 * this.facing, 0.25);   // :50770-50772
      // ★BJ698：951 归位飞行接触伤——flag5 friendly=true 恒开（AI_067 :50475-50477，
      //  逐拍顶置不随态翻转），projPet carve-out `type != 951`（:12495）⇒ 全态可伤
      //  （旧 return 早退=归位穿敌零伤=缺窗）。
      this.contact(game, dmg0);
      return;
    }
    // ---- state0 归位门（:51162-51180 共享段;transition 拍无移动/重力 = 原版同相）----
    if (!tgtF) {
      const dP = Math.hypot(p.cx - this.cx, p.cy - this.cy);
      if (dP > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }
      else if (dP > 500 || Math.abs(p.cy - this.cy) > 300) { this.flinA0 = 1; return; }
    }
    let ax: number, ay: number;
    if (tgtF) {
      ax = tgtF.cx; ay = tgtF.cy;
      // TryJumpingToTarget 共享尾（:51024 调用位;flag2 恒 false——跃起后 vy≠0 使
      // 结算段/flag20 落地起跳让位,原版同序）
      this.ai67TryJumpingToTargetTail(tgtF.cy, false);
      // :52112 shouldFallThrough 实体化（见方法注「平台下穿」）
      this.dropThrough = tgtF.cy > this.y + this.h;
    } else {
      ax = p.cx - (45 + p.w / 2) * p.facing - 30 * this.slot * p.facing;   // :50295-50299
      ay = p.cy;
      const g = this.groundAnchorScan(st, p, ax, ay);
      ax = g.x; ay = g.y;
      // :50454 无目标缺省（玩家脚−12 低于盒底 → 下穿平台归主）
      this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    }
    // flag20（:51438-51441）：有目标 ∧ 目标盒相交本体盒
    const jumpAtTarget = tgtF
      ? this.x < tgtF.x + tgtF.w && this.x + this.w > tgtF.x
        && this.y < tgtF.y + tgtF.h && this.y + this.h > tgtF.y
      : false;
    // ★BJ-C3/F2：capturePreGravVy 补齐（帧机 :51767 读相快照载体 + F3 跳尾同源）
    this.ai067WalkChase(game, p, ax, ay, tgtF ? [0.65, 5.5, 5.5] : null,   // flag5 档 :51302-51306
      { wet, wallIntent: jumpAtTarget, capturePreGravVy: true });
    // 帧/旋转（:51766-51790 flag5 地面段）——★BJ-C3/F2（2026-10-06）：:51767/:51776
    //  读相=AI 相=贴地 0（重力 :52051 在帧段后、post-AI 碰撞 :17585 再零化）,
    //  BJ516④ 重力落尾后直读恒 0.4 → rot 归零支死（AngleTowards 不跑）+ 空中帧 1
    //  恒挂;两支统一改读 lastWalkPreGravVy 快照（空中 rot 的 Math.min(4,vy) 同取
    //  快照=原版帧段读相,原直读带 +0.4 相偏）。
    const vyPhase = this.lastWalkPreGravVy ?? this.vy;
    if (vyPhase === 0) {
      this.rot = angleTowards(this.rot, 0, 0.3);              // :51767 AngleTowards(0,0.3)
      if (this.vx === 0 || Math.abs(this.vx) < 0.5) {         // :51769/:51780 两支同帧 0（合并）
        this.flinFrame = 0; this.flinFrameCd = 0;
      } else {
        this.flinFrameCd += Math.floor(Math.abs(this.vx)) + 1;   // :51773-51779
        if (this.flinFrameCd > 10) { this.flinFrame++; this.flinFrameCd = 0; }
        if (this.flinFrame < 2 || this.flinFrame >= 12) this.flinFrame = 2;
      }
    } else {
      this.rot = Math.min(4, vyPhase) * -0.1;                 // :51776-51779（★BJ-C3/F2 同相取快照）
      if (this.facing === -1) this.rot -= Math.PI * 2;        // :51780-51782 照录（≡同相）
      this.flinFrameCd = 0;
      this.flinFrame = 1;
    }
    // 接触伤（friendly=true 全态 :50476;cd=idStatic 10 → contactResolve(951) 既有条目）
    const hit = this.contact(game, dmg0);
    if (hit) {
      // 命中反跳（Damage_PVE_Inner :13115-13124）：锚定首个重叠敌
      for (const e of game.enemies()) {
        const en = e as EnemyLike;
        if (en.dead) continue;
        if (this.x < en.x + en.w && this.x + this.w > en.x
          && this.y < en.y + en.h && this.y + this.h > en.y) {
          const ddx = en.cx - this.cx, ddy = en.cy - this.cy;
          const dl2 = Math.hypot(ddx, ddy);
          this.vx = (dl2 > 0 ? ddx / dl2 : 0) + (-0.5 + Math.random()) * 13;   // :13116-13118
          this.vy = -5;                                        // :13119
          break;
        }
      }
    }
  }

  /** 帕鲁地面随从 1093 捣蛋猫 / 1112 可靠的捣蛋猫 / 1118 黏土蓓蕾（AI_067
   *  flag8/flag9 分支折算，Projectile.cs:50014-52160；flag8 = 1093||1112 :50024
   *  共用同一态机——1093（物品 5663 :44475）曾走通用飞行近似,默认帧扫描器
   *  Math.floor(age/8)%28 扫到贴图白帧 14-27（hurt 变体带,原版 AI 永不写）
   *  = 用户实报"寻敌攻击变白"根因,2026-08-25 并入态机）。
   *  判定盒 = 原版真值 14×22（:10199-10200/:10365-10366/:10453-10454,构造器置）。
   *  · 态机 ai[0]：0 地面跟随+索敌（num2=800/500 :50030/:50052，Minion_FindTargetInRange
   *    skipIfCannotHitWithOwnBody=true :50496-50504 → 视线门）→ 距敌侧翼点 <20px 入
   *    扑击 ai[0]=2（:51166-51177 num30=20）；2 扑击（friendly=true 才有接触伤
   *    :50444 置 false/:50904 置 true，帧 3-6 :50912，1112 追敌悬浮 PingPong
   *    :50920-50926，ai[1]==num10-1 减速 :50905-50910）；1 归位（flag8 特例=瞬移
   *    主肩硬锚 MountedCenter+(-8dir,-24) :50841-50853，主落地退出 :50686-50692；
   *    flag9 常规飞行 :50636-50712）；5 Boss>600px 追击（:51152-51158）——flag8/9
   *    无目标检索档（flag16 :50505-50508 仅 0/2）→ 次 tick 即自清（:50957-50962），
   *    净效果 0 tick，不折算
   *  · 跟随锚（:50285-50310）：主中心 -(30|24+w/2)×dir - 组序×20×dir；Y 落地扫描
   *    20 格 + 视线截断 + 距离钳（:51204-51260）；归位门 = 距主>500 或 |dy|>300
   *    （num3/num4 :50031-50033）
   *  · 移动档（:51296-51340）：无目标 0.5/4/4；有目标 flag8=0.3/6/6（1112=9/12/9
   *    :51310-51313）、flag9=0.2/3/3；主速更快 → 0.7/主速（:51342-51345）；重力
   *    0.4 封顶 10（:51553-51557）；跳梯 -5.1/-7.1/-9.1/-10.1/-11.1（:51470-51490）
   *    + 目标高出距离表 -6..-16（:51492-51527，TryJumpingToTarget flag8 段
   *    :51126-51151 高差>100 起跳 sqrt(2×0.4h)+1 封顶 26）
   *  · 帧（:51742-51840）：立 0（抚摸 13/16）/ 走 7-12|8-14（fc+=|vx|+1>10 翻页）/
   *    空中 1（下落 2）/ 扑击 3-6|3-7；接触伤冷却 9/30（localNPCHitCooldown
   *    :10375/:10483）
   *  · ai[0]=3 帮工采掘（★BJ433 2026-10-02 已折算）：TryAssigningHelp :52208
   *    （cattivaTryAssigningHelp——IntentionGuesser 陈值快照合成扫区直调
   *    stepAxeCore/stepMineSolidsCore）→ 栖点支 :51207-51221（side-switch 让位 +
   *    栖点覆写 + num4=16 跳尾 + <20px 入扑击）→ HitIntention :52167（pickPower=41
   *    经 petPickTile 采掘 + CattivaHit 编排 @栖点）。旧「IntentionGuesser 本仓无——
   *    勿造系统」登记随 src/player/SmartCursor.ts 步核导出失效,清偿。
   *    抚摸 Joy 音/湿身 vy×2 已随 2026-08-23 Trusty 批接通（palJoyTick /
   *    palGroundStep wet 支） */
  /** 抚摸 Joy 音计时（帕鲁随从族五件通用，每 tick 在 AI 分派前调）：
   *  flag10 = player.petting.isPetting && petting.proj == whoAmI（:50053 AI_067 /
   *  :59101 AI_026——本仓等价 = p.petting.isPetting && this.beingPetted，Game 侧
   *  白名单单目标写入）。计时器：flag10 且 localAI==0 → 置 60 + Joy 音（一声/次抚摸
   *  会话——`> (flag10?1:0)` 递减使抚摸中钉 1 不归零，不重触发；停摸放空 1→0）。
   *  60t 槽原版兼作 Draw 层心形气泡进度（Main.cs:34820-34825 localAI∈(1,60)）——
   *  本仓无世界锚定气泡，登记不建模。音：1093/1112 PalCattivaJoy（:50106-50112，
   *  AI_067 flag8 支）/ 1094/1113 PalFoxparksJoy（:59122-59131，AI_026 flag8 支，
   *  计时槽 localAI[2]）/ 1118 只走计时无音（AI_067 flag9 支 :50066-50070） */
  private palJoyTick(game: GameHooks, p: Player): void {
    if (this.projId !== 1093 && this.projId !== 1112 && this.projId !== 1118
      && this.projId !== 1094 && this.projId !== 1113) return;
    const flag10 = p.petting.isPetting && this.beingPetted;
    if (flag10 && this.palJoyCd === 0) {
      this.palJoyCd = 60;
      if (this.projId === 1093 || this.projId === 1112) {
        game.playSfxFiles(['pal_cattiva_joy'], 0.35, this.cx, this.cy);   // SoundID.cs:1078 0.35
      } else if (this.projId === 1094 || this.projId === 1113) {
        // ★SW-FX18 2026-09-10 回归修复：IIIII233 勘误删共享播放时把 1094/1113 的
        //  PalFoxparksJoy 一并删失——原版 Projectile.cs:59122-59131（AI_026 case
        //  1094/1113）flag9+localAI[2]==0 → PlaySound(PalFoxparksJoy)，专属两站
        //  （SoundID.cs:1090 音量 0.35）。trusts-mounts 域回归实锤,本刀只补音不触计时
        game.playSfxFiles(['pal_foxparks_joy'], 0.35, this.cx, this.cy);
      }
      // ★IIIII233（2026-09-09）勘误：1118 ClayPotMinion（AI_067 flag9 支
      //  Projectile.cs:50053-50070）只走 localAI[0] 计时、**无 Joy 音**——旧码误播
      //  pal_foxparks_joy（全仓 PalFoxparksJoy 站=AI_026 flag8 的 1094/1113 专属,
      //  Projectile.cs:59122-59131;grep 全量实证仅两站）。已删。
    }
    if (this.palJoyCd > (flag10 ? 1 : 0)) this.palJoyCd--;
    // ★IIIII233（2026-09-09）：抚摸心形气泡原版直绘补全——原版
    //  Main.cs:34799-34832（1093/1112/1118）与 :33755-33762（1094/1113,计时槽
    //  localAI[2]=本仓 palJoyCd 同窗）在 localAI∈(1,60) 窗画
    //  EmoteBubble.DrawTemporaryBubble(0,60,localAI)（emote 0=爱心）。旧粒子近似
    //  （台账批 C-920）退役。非抚摸支的 DrawNotificationIcon（:34828-34831）资产
    //  未入库,登记不建模。
    if (flag10 && this.palJoyCd > 1) {
      setTemporaryBubble(this, 0, 60, this.palJoyCd);
    } else if (!flag10) {
      clearTemporaryBubble(this);
    }
  }

  /** ★BJ518④（2026-10-05）：DoPalAppearEffect 1:1（Projectile.cs:39509-39543）——
   *  alpha≤0 早退;alpha −15（旧全局 −15/t 斜坡退役:原版减法只发生在被调拍,钻地龟
   *  挖掘态 1/2/3 无调用=淡入冻结）;num2/num3 = 减前/减后进度 ×2;num2<1 ∧ withParticles
   *  → Hermite 曲线尘 306：value=master.MountedCenter+(direction×10,0),双切线 (0,−100),
   *  端点=本体 Center,采样 num4∈{0..0.9}（f32 累计 0.1f×10≈1.0000001>1 → 10 粒非 11）,
   *  Lerp(vector,vector2,num4),速=(vector2−vector)×0.1,Color(100,227,255,127),
   *  scale=1+num3,noGravity。num3≥0.9（after≤140.25,即 prev∈{150,135} 尾两拍）→
   *  速=NextVector2Circular(3,3) 随机。调用位（withParticles 门 1:1）：
   *  1094/1113=AI_026 头 :59197/:59210（ai[0]!=1f）;1093/1112=AI_067 flag8 支 :50493
   *  （ai[0]!=1f）;1098/1123=AI_204 flag|flag5|flag6 支 :39245（恒 true）。 */
  private doPalAppearEffect(game: GameHooks, master: Player, withParticles: boolean): void {
    if (this.alphaFade <= 0) return;
    const prev = this.alphaFade;
    this.alphaFade = Math.max(0, this.alphaFade - 15);
    const num2 = (1 - prev / 255) * 2;
    const num3 = (1 - this.alphaFade / 255) * 2;
    if (!(num2 < 1 && withParticles)) return;
    const mc = master.mountedCenter;
    const valueX = mc.x + master.facing * 10;
    const valueY = mc.y;
    // XNA Vector2.Hermite(v1,t1,v2,t2,s)：(2s³−3s²+1)v1+(s³−2s²+s)t1+(−2s³+3s²)v2+(s³−s²)t2
    const herm = (v1: number, t1: number, v2: number, t2: number, s: number): number => {
      const s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * v1 + (s3 - 2 * s2 + s) * t1
        + (-2 * s3 + 3 * s2) * v2 + (s3 - s2) * t2;
    };
    const hx = (s: number): { x: number; y: number } => ({
      x: herm(valueX, 0, this.cx, 0, s),
      y: herm(valueY, -100, this.cy, -100, s),
    });
    const va = hx(num2), vb = hx(num3);
    for (let f = Math.fround(0); f <= Math.fround(1); f = Math.fround(f + Math.fround(0.1))) {
      const lx = va.x + (vb.x - va.x) * f;
      const ly = va.y + (vb.y - va.y) * f;
      const dvx = (vb.x - va.x) * 0.1, dvy = (vb.y - va.y) * 0.1;
      let sx = dvx, sy = dvy;
      if (num3 >= 0.9) {
        const c = nextVector2Circular(Math.random, 3, 3);
        sx = c.x; sy = c.y;
      }
      game.spawnDust?.(lx, ly, 0, 0, 306, sx, sy, 0,
        { r: 100, g: 227, b: 255, a: 127 }, 1 + num3, true, true);
    }
  }

  /** 火绒狐 1094/1113 帧态机（AI_026 flag8 帧段 Projectile.cs:64729-64826 1:1 折算）。
   *  分支序与帧域同原版：攻击(ai[1]>0) 36-41 往返（n=fc/3,n≥6 → 11-n,负钳 0）/
   *  贴地静止+抚摸 45-52 每 4fc / 贴地静止 18-25 每 4fc / 贴地行走 28-35
   *  （fc += ⌊|vx|⌋+1,≥10 翻页）/ 空中(vy≠0) 27。
   *  时序：每 tick 在 AI 分派前调（foxChannel 早退支也照走）——flag27 消费上一拍
   *  位移（原版帧段在移动后求值,此处滞后一拍,备案近似）;本仓 1094/1113 统一飞行
   *  （spawnMinion ground=false）→ 常态落空中帧 27,贴地各态留待地面型判定细分。 */
  private foxAnimTick(p: Player): void {
    if (this.projId !== 1094 && this.projId !== 1113) return;
    const stationary = this.x === this.foxPrevX;
    this.foxPrevX = this.x;
    const petted = p.petting.isPetting && this.beingPetted;
    if (this.shootCd > 0) {
      // 攻击段（:64731-64754）：入段钉 36;1094 fc 在 ai[1]==40（1113==30）拍清零
      if (this.foxFrame < 36 || this.foxFrame >= 42) { this.foxFrameCd = 0; this.foxFrame = 36; }
      if (this.shootCd === 40 || (this.projId === 1113 && this.shootCd === 30)) this.foxFrameCd = 0;
      this.foxFrameCd++;
      let n = Math.floor(this.foxFrameCd / 3);
      if (n >= 6) n = 11 - n;
      if (n < 0) n = 0;
      this.foxFrame = 36 + n;
    } else if (this.onGround) {
      if (stationary && petted) {
        // 抚摸段（:64756-64766）：45 起每 4fc 翻页,≥53 回 45
        if (this.foxFrame < 45 || this.foxFrame >= 53) this.foxFrame = 45;
        if (++this.foxFrameCd >= 4) { this.foxFrameCd = 0; if (++this.foxFrame >= 53) this.foxFrame = 45; }
      } else if (stationary) {
        // 待机段（:64767-64775）：18-25 循环
        if (this.foxFrame < 18 || this.foxFrame >= 26) this.foxFrame = 18;
        if (++this.foxFrameCd >= 4) { this.foxFrameCd = 0; if (++this.foxFrame >= 26) this.foxFrame = 18; }
      } else if (Math.abs(this.vx) > 0.8) {
        // 行走段（:64776-64790）：fc 按 |vx| 累进,≥10 翻页,28-35 循环
        this.foxFrameCd += Math.floor(Math.abs(this.vx));
        this.foxFrameCd++;
        if (this.foxFrame < 28 || this.foxFrame >= 36) this.foxFrame = 28;
        if (this.foxFrameCd >= 10) { this.foxFrameCd = 0; if (++this.foxFrame >= 36) this.foxFrame = 28; }
      } else {
        this.foxFrame = 18;
        this.foxFrameCd = 0;
      }
    } else {
      // 空中（:64791-64797 vy<0 / :64798-64801 vy>0 同帧 27）
      this.foxFrameCd = 0;
      this.foxFrame = 27;
    }
  }

  private palGroundStep(game: GameHooks, p: Player, dmg0: number): void {
    // ★Z1/BJ433 平台下穿链（decidesManualFallThrough=true :10209/:10376/:10464 三档 →
    //  每拍写 shouldFallThrough :50454「玩家脚−12 低于盒底」+ 有目标/栖点拍 :52112 覆写 →
    //  HandleMovement :17692-17694 消费=Entity.dropThrough/moveAndCollide 承载）——
    //  用户实报「猫站平台不下穿」根因（原版站平台猫在主低于自身时穿平台归主/追敌）。
    //  本行=:50454 锚（AI_067 头位逐拍,覆盖 state1/2 早退拍）
    this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    const flag8 = this.projId === 1093 || this.projId === 1112;   // :50024
    const num10 = flag8 ? 16 : 30;            // 扑击时长（:50490/:50499）
    const num2 = flag8 ? 800 : 500;           // 索敌射程（:50030/:50052）
    // ★BJ518④：DoPalAppearEffect（:50493 flag8 支——每拍同调,withParticles=ai[0]!=1f;
    // 原版位在 ai[0]==1 肩扛支 :50637 之前 → 本仓同位先于早退支）
    if (flag8) this.doPalAppearEffect(game, p, this.palA0 !== 1);
    // 湿旗=上拍段值快照 wetAi（2026-09-08 定谳批:vanilla :51616 ×2 消费 Projectile.wet
    // =AI 读上一子步段值——probe 现场盒测读当拍位=提前 1 拍,随批退役归一;
    // wetCollisionProbe 本体保留=unit 钉测/台账批⑥面,见类字段块头注①②③）
    const wet = this.wetAi;
    // ---- ai[0]==1 归位（:50636-50853；先于地面段——原版该态不索敌不行走）----
    if (this.palA0 === 1) {
      const dpx1 = p.cx - this.cx, dpy1 = p.cy - this.cy;
      const pSpd1 = Math.abs(p.vx) + Math.abs(p.vy);
      if (flag8) {
        // 主肩硬锚（:50841-50853）：Center=MountedCenter+(-8dir,-24)、速度清零；
        // 主落地退出（:50686-50692 num21<200 且 vy==0 → ai[0]=0）
        this.x = p.cx - p.facing * 8 - this.w / 2;
        this.y = p.cy - 24 - this.h / 2;   // MountedCenter = 玩家中心（p.cy）
        this.vx = 0; this.vy = 0;
        this.facing = p.facing;
        // 肩扛帧（:50788-50800）：frame=1 → vy≥-6 归 0 → vy≥6 归 2
        this.palFrame = p.vy >= 6 ? 2 : p.vy >= -6 ? 0 : 1;
        // ★BJ518⑤（同域补刀）：肩扛 alpha=255 重淡入（:50798-50806——fullRotation≠0 ∨
        //  mount-hidden,与 AI_026 flag8 rest 块 :61649-61652 同门同相;DoPal 本拍已先跑
        //  （:50493 在 ai[0]==1 支之前）→ 下拍起重淡入）
        {
          const fr = playerFullRotationOf(p, p.mount, p.cart);
          if ((fr !== null && fr.angle !== 0)
            || (p.ridingMount && !!MOUNT_SETS.PlayerIsHidden?.[p.mount.type])) {
            this.alphaFade = 255;
          }
        }
        // 退出（:50685-50691）：num21<200 且主落地——距离门缺了会在远处
        // 与 ai[0]=0 归位门（>500）间乒乓
        if (p.vy === 0 && Math.hypot(dpx1, dpy1) < 200) { this.palA0 = 0; this.palA1 = 0; }
        return;
      }
      // flag9 常规飞行（:50636-50712）：tileCollide=false、加速 0.2、限速 10/主速
      const sp = Math.max(10, pSpd1);
      const dl = Math.hypot(dpx1, dpy1) || 1;
      if (dl > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; } // :50660-50662
      else {
        this.vx += Math.max(-0.3, Math.min(0.3, dpx1 / dl * sp - this.vx)); // :50722-50752 acc 0.2（反向 ×1.5 补）
        this.vy += Math.max(-0.3, Math.min(0.3, dpy1 / dl * sp - this.vy));
        if (Math.abs(dpx1) < 60) this.vx *= 0.9;
        this.x += this.vx; this.y += this.vy;
      }
      this.facing = this.vx !== 0 ? (this.vx > 0 ? 1 : -1) : p.facing;   // :50754-50756
      const st1 = game.world.store;
      // 退出门第 4 连词（:50685-50692）= !Collision.SolidCollision(position,width,height)
      // 【全盒】判——2026-09-07 1118 嵌入定谳批：旧中心单格近似在盒缘/脚行压墙而
      // 中心落空气袋时放行退出 → 归位飞行（无碰撞直积分）穿墙后以嵌墙姿态落地进
      // 步行态;湿身（wet 域内）时 unembedPass 整段让位（TileCollision.ts wet 跳支,
      // 原文本无 unembed）→ 原版救援面（StepUp :51508/飞行态重入）接不上前持续卡
      // 地形。全盒判 = 蛙 :50686-50692 同句同构（solidOverlap 家族既有 SolidCollision
      // 等价,半砖窗差异登记于彼）
      if (Math.hypot(dpx1, dpy1) < 200 && p.vy === 0
        && this.y + this.h <= p.y + p.h
        && !this.solidOverlap(st1)) {
        this.palA0 = 0; this.palA1 = 0;                    // :50668-50676 落地净空退出
        if (this.vy < -6) this.vy = -6;
      }
      return;
    }
    // ---- ★BJ433 帮工分派（:50490-50494 flag8 支 num10=16 + DoPalAppearEffect +
    //      TryAssigningHelp 每拍；原位在检索前——TryAssigningHelp 只置态不检索,
    //      故 ai[0]==3 拍 flag16(=ai[0]==0||2 :50507-50509) 恒 false → 本拍 attackTarget
    //      恒 -1（attackTarget 为 AI_067 局部量 :50458,检索态外不续值）——原版 :50524
    //      `(flag8|flag9) && attackTarget>=0 && ai[0]==3` 重置支因此【死码】（检索门
    //      与 ai[0]==3 互斥）,登记勿折算。DoPalAppearEffect = 出场淡入（alphaFade
    //      既有承载,构造器 -15/t 同拍）----
    if (flag8) this.cattivaTryAssigningHelp(game, p);
    // ---- 索敌（:50496-50508：ai[0]==0||2 才检索）——终清波批：
    //      Minion_FindTargetInRange(num2, skipIfCannotHitWithOwnBody) 双距归真 ----
    const tgt = this.palA0 === 0 || this.palA0 === 2 ? this.findTargetInRangeDual(game, num2, { skipIfCannotHitOwnBody: true }) : null;   // ★BJ515 债④：skip=true（:50524）
    // ---- ai[0]==2 扑击（:50901-50956）----
    if (this.palA0 === 2) {
      // 扑击帧（flag9 :50909 / flag8 :50875 同式）：3 + (num10-ai1)/(num10/4)
      this.palFrame = Math.min(7,
        3 + Math.floor((num10 - this.palA1) / (num10 / 4)));
      // ★BJ433：flag8 扑击尘（:50888-50897——(int)ai[1]%4==0 拍 ×3 粒 Dust 16 Cloud,
      //  @Center+(direction·8,-4) 盒 8×8、vx=-direction·2、α=127；后置 velocity×0.5 /
      //  scale×0.8 / vy-0.2。帮工采掘与攻击扑击同态同尘=原版逐字）
      if (flag8 && this.palA1 % 4 === 0) {
        for (let i = 0; i < 3; i++) {
          const d = game.spawnDust?.(Math.floor(this.cx + this.facing * 8), Math.floor(this.cy - 4),
            8, 8, 16, -this.facing * 2, 0, 127);
          if (d) { d.vx *= 0.5; d.scale *= 0.8; d.vy -= 0.2; }
        }
      }
      this.palA1--;                           // :50953
      if (this.palA1 === num10 - 1) {
        if (this.onGround) this.vx *= 0.1;    // :50905-50907（velocity.Y==0=贴地语义，flag8/9 共有）
        if (this.projId === 1112) { this.vx *= 0.1; this.vy *= 0.1; } // :50875-50877（1112 专属双轴刹）
      }
      // 1112 扑击追踪（:50920-50926 `attackTarget != -1 && type == 1112`——1093 无追踪）：
      // 敌心 + PingPong(ai1/num10)×-10 悬浮，20 速趋近
      if (this.projId === 1112 && tgt) {
        const t = Math.max(0, Math.min(0.9999, this.palA1 / num10));
        const ping = t < 0.5 ? t * 2 : 2 - t * 2; // Utils.PingPongFrom01To010 :246-256
        const tx = tgt.cx, ty = tgt.cy - ping * 10;
        const dx = tx - this.cx, dy = ty - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        const step = Math.min(20, d);
        this.vx = dx / d * step; this.vy = dy / d * step;
        this.facing = tx >= this.cx ? 1 : -1;
      }
      this.vy = Math.min(this.vy + 0.4, 10);  // :50951-50953
      // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗,
      // 速度场不减只削位移——projWetSection 头注契约）
      // StepUp 关（原版 Collision.StepUp 只在 ai[0]==0||3 运动块 :51508,扑击块
      // :50901-50956 无此调用;步行拍置 true 会漏进扑击拍,此处显式复位）
      this.stepUp = false;
      const dfPounce = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfPounce, this.vy * dfPounce);
      this.contact(game, dmg0, flag8 ? 9 : 30); // friendly=true 段（:50904）；冷却 :10375/:10483
      if (this.palA1 <= 0) { this.palA0 = 0; this.palA1 = 0; } // num9=0 → 直回 0（:50954-50956）
      return;
    }
    // ---- ai[0]==0：目标侧翼点 / 跟随锚（:51003-51199 与 :50285-50310）----
    let ax: number, ay: number;
    if (tgt) {
      // 侧翼点（:51020-51024）：敌近侧外 10px（num30=20），Y 钳敌盒内
      const side = tgt.cx > this.cx ? tgt.cx + 10 : tgt.cx - 10;
      ax = side;
      ay = Math.max(tgt.y + this.h / 2, Math.min(this.cy, tgt.y + tgt.h - this.h / 2));
      // TryJumpingToTarget 共享尾（:51024 调用位;toTarget=侧翼点,Y 钳值同 :51019）
      // ——跃起后 vy<0 使下方俯扑门 vy>1 与结算段让位（原版同序;湿中下落跃起走
      // :52114 支,干态下落走 :51084 专支=原文两支以 wet 互斥）
      this.ai67TryJumpingToTargetTail(ay, false);
      this.dropThrough = ay > this.y + this.h;   // ★Z1/BJ433 :52112 锚（targetCenter=侧翼点）
      // 高差起跳（:51082-51101 flag8 专支,`flag8 && ai[1]==0` 块内——★2026-09-08
      // 续单两门补接：!wet 读相=wetAi（AI 先于湿段跑读上子步段值）;ai[1]==0=palA1
      // （扑击计时,:50954 出扑归零）——旧实现只接跳体漏两门。湿中下落已由共享尾
      // :52114 支承接（先于本门让位）→ 本门实际域=干态下落）
      if (flag8 && this.palA1 === 0 && this.vy > 1 && !wet
        && tgt.y + tgt.h - (this.y + this.h) < -100) {
        const h = (this.y + this.h) - (tgt.y + tgt.h);
        this.vy = -Math.min(26, Math.sqrt(Math.max(0, h) * 2 * 0.4) + 1);
        this.vx += (Math.random() * 2 - 1) * Math.random() * 5;
      }
      // 距敌 <20 → 入扑击（:51166-51177）
      if (Math.hypot(ax - this.cx, ay - this.cy) < 20) {
        this.palA0 = 2;
        this.palA1 = num10;
        this.facing = tgt.cx - this.cx > 0 ? 1 : -1; // :51175-51176
        return;
      }
    } else {
      // 跟随锚（:50285-50310 家族偏移；组序=同型在场序 minionPos 等价）
      const peers = (game as unknown as { entities: { projectiles: MinionProj[] } }).entities.projectiles
        .filter((m) => m instanceof MinionProj && !m.dead && m.projId === this.projId);
      const groupIdx = peers.indexOf(this);
      ax = p.cx - ((flag8 ? 30 : 24) + p.w / 2) * p.facing - groupIdx * 20 * p.facing;
      ay = p.cy;
      // ★BJ433 侧翼换边让位（:51203-51206,ai[0]==0||3 ∧ attackTarget<0 共用）：主在
      //  60px 外 ∧ 锚在 60px 外 ∧ 锚与自身异侧 → 锚=主心（防止猫横穿主人换边）
      if (Math.hypot(this.cx - p.cx, this.cy - p.cy) > 60
        && Math.hypot(this.cx - ax, this.cy - ay) > 60
        && Math.sign(ax - p.cx) !== Math.sign(this.cx - p.cx)) {
        ax = p.cx; ay = p.cy;
      }
      // ★BJ433 ai[0]==3 栖点支（:51207-51221）：锚覆写为 ai[1]/ai[2] 栖点格中心 →
      //  TryJumpingToTarget（num4=16 档 :52151-52153）→ 盒内最近点距栖点 <20 →
      //  速度钳 10 + 入扑击（ai[0]=2,ai[1]=num10）+ 朝向（>0?1:-1 原文极性）+
      //  HitIntention（帮工采掘击）。不走 return——原版该拍继续落锚扫描/钳制/
      //  运动积分（51201 块在置态前已入,扑击帧下拍由 state-2 支接管）
      if (this.palA0 === 3) {
        ax = this.palA1 * 16 + 8;
        ay = this.palA2 * 16 + 8;
        this.ai67TryJumpingToTargetTail(ay, false, 16);
        this.dropThrough = ay > this.y + this.h;   // ★Z1/BJ433 :52112 锚（:51212 栖点调用位,targetCenter=栖点）
        const nx = Math.max(this.x, Math.min(ax, this.x + this.w));
        const ny = Math.max(this.y, Math.min(ay, this.y + this.h));
        if (Math.hypot(ax - nx, ay - ny) < 20) {
          const vl = Math.hypot(this.vx, this.vy);
          if (vl > 10) { this.vx /= vl / 10; this.vy /= vl / 10; }   // :51215-51218
          this.palA0 = 2;
          this.palA1 = num10;
          this.facing = (ax - this.cx) > 0 ? 1 : -1;                 // :51227 原文极性（0 → -1）
          this.cattivaHitIntention(game, ax, ay);                    // :51228
        }
      }
      // 落地扫描（:51204-51212 最多 20 格）+ 视线截断（:51214-51224 5% 步进近似）
      const st = game.world.store;
      for (let k = 0; k < 20; k++) {
        if (st.isSolid(Math.floor(ax / 16), Math.floor(ay / 16))) break;
        ay += 16;
      }
      {
        const dx = ax - p.cx, dy = ay - p.cy;
        for (let t = 0.05; t <= 1.001; t += 0.05) {
          if (st.isSolid(Math.floor((p.cx + dx * t) / 16), Math.floor((p.cy + dy * t) / 16))) break;
          ax = p.cx + dx * t; ay = p.cy + dy * t;
        }
      }
    }
    // 归位门（:51199-51211）：距主 >500（num3）或 |dy|>300（num4）→ ai[0]=1
    // （★BJ433 勘补：原版门=ai[0]==0 专断（:51174 `ai[0]==0f && attackTarget<0` 头,
    //  >2000px 瞬移同门 :51176-51178）——帮工态(3)/扑击态(2)不吃此门,曾缺 palA0 闸
    //  （state 3 走猫会被远距拉去肩扛,原版无此路径））
    const dpx = p.cx - this.cx, dpy = p.cy - this.cy;
    if (this.palA0 === 0 && !tgt && (Math.hypot(dpx, dpy) > 500 || Math.abs(dpy) > 300)) {
      this.palA0 = 1;
      // ★BJ518⑤（同域补刀）：归位拍 flag8 alpha=255（:51191-51199 flag18 支——
      //  ai[0]=1 + netUpdate 后 flag8 即置,主远去扑回肩扛拍重淡入起爆）
      if (flag8) this.alphaFade = 255;
      return;
    }
    // ---- 地面移动（:51212-51557）----
    const withTgt = tgt !== null;
    let acc = 0.5, vmax = 4, clamp = 4;               // :51296-51300 缺省档
    if (withTgt) {
      if (flag8) { acc = this.projId === 1112 ? 9 : 0.3; vmax = this.projId === 1112 ? 12 : 6; clamp = this.projId === 1112 ? 9 : 6; }
      else { acc = 0.2; vmax = 3; clamp = 3; }        // :51330-51334 flag9
    }
    const pSpd = Math.abs(p.vx) + Math.abs(p.vy);
    if (clamp < pSpd) { clamp = pSpd; acc = 0.7; }    // :51342-51345 主速 catch-up
    const dx = ax - this.cx;
    if (Math.abs(dx) > 5) {
      if (dx < 0) { this.vx -= this.vx > -vmax ? acc : 0.1; }
      else { this.vx += this.vx < vmax ? acc : 0.1; } // :51348-51362（num53=0.1 超速缓档）
    } else {
      this.vx *= 0.9;                                 // :51406-51410
      if (Math.abs(this.vx) < acc * 2) this.vx = 0;
    }
    this.vx = Math.max(-clamp, Math.min(clamp, this.vx));
    // 跳梯两面合流（终清波批统一探测形）：flag20 档 flag8/9 直死（:51384-51387）→
    // 仅机制(b) 前墙列扫（ai67JumpFlags 内含 num55/flag21 门）;落地 =
    // ai67JumpLadder 三柱承立闸+五档（与虎共轨;旧内联扫描行界 off-by-one 与
    // Math.round(vx) 偏差一并修正）。探测行界自 :51438-51457 复核
    const dyA = ay - this.cy;
    const stJump = game.world.store;
    const jump = this.ai67JumpFlags(stJump, ax, ay);
    this.vy = Math.min(this.vy + 0.4, 10);                  // :51553-51556（num=0.4，先加后移=原版 AI 末重力+Update 积分序）
    // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗,
    // 速度场不减只削位移——下方 wet 起跳 ×2 读 velocity 场=未阻尼,原文同相）
    // StepUp（Collision.StepUp :51508,ai[0]==0||3 运动块逐拍直调,flag8/9 同受）——
    // 2026-09-07 1118 嵌入定谳批补接：这是原版随从"浅嵌入自救"唯一干道（前导列
    // 脚行沉入 ≤16.1px ∧ 上方净空 → 抬升上格,湿态无豁免支=水中同样生效）;曾只接
    // ai067WalkChase（虎/海盗）与 spiderStep/frogStep,帕鲁/蘑菇漏接 = 步行坡步缺失
    // + 浅嵌入（坡面三角/半砖缘）无救援。applyStepUp 是 :3641-3772 1:1 移植
    // （16.1px 门/flag3/flag4/半砖 ±8 全同）。连带 StepDown 同通（moveAndCollide
    // stepUp 门共用,原版 AI_067 无 StepDown）为家族既有口径（蛙/虎/蜘蛛同）,登记
    // 不另分叉
    this.stepUp = true;
    const dfWalk = projWaterDragFactor(this);
    moveAndCollide(this, game.world, this.vx * dfWalk, this.vy * dfWalk);
    if (this.onGround) {
      if (jump) this.ai67JumpLadder(stJump, Math.sign(dx) || 1);
      if (dyA < -48) {                                      // :51492-51527 目标高出距离表
        const d = -dyA;
        this.vy = d < 60 ? -6 : d < 80 ? -7 : d < 100 ? -8 : d < 120 ? -9
          : d < 140 ? -10 : d < 160 ? -11 : d < 190 ? -12 : d < 210 ? -13
          : d < 270 ? -14 : d < 310 ? -15 : -16;
      }
      // 湿身跳 ×2（1457 Projectile.cs:51616-51619，1456 :51545 同支——贴水起跳翻倍）：
      // `if (wet && num62 == 0f) velocity.Y *= 2f`。num62 = GetLerpValue(0,100,vector15.Y)
      // × GetLerpValue(-2,-6,velocity.Y)（:51509，vector15=目标锚-自身心 = 本仓 dyA），
      // 在本支（velocity.Y==0 贴地段）计算时 vy 恒 0 → 第二因子钳 0 → num62 恒 0，
      // 门恒真——净效果 = 贴地且 wet 时起跳速度翻倍（-5.1→-10.2 … -16→-32）
      if (wet) this.vy *= 2;
    }
    // 朝向（:51558-51568：vx 定向，静止朝主）
    if (this.vx < 0) this.facing = -1;
    else if (this.vx > 0) this.facing = 1;
    else this.facing = p.cx > this.cx ? 1 : -1;
    // 步行帧机（帧段整体在 ai[0]==0||3 门内 :51201——扑击帧由 ai[0]==2 支直写不在此；
    // flag8 :51841-51877 / flag9 :51879-51930 各自 1:1）：贴地静止 0（抚摸 flag8=13 /
    // flag9=16）/ 走行 |vx|≥0.5 计步循环 flag8 7-12、flag9 8-14 / 空中 1(升)2(降)。
    // ★flag8 有完整走行机（1457 实文），旧注"步行期不写 frame=冻结"系误读
    const petting = p.petting.isPetting && this.beingPetted;   // flag10 :50053
    if (flag8) {
      if (!this.onGround) {
        this.palFrameCd = 0;
        this.palFrame = this.vy > 0 ? 2 : 1;                 // :51870-51876
      } else if (Math.abs(this.vx) >= 0.5) {
        this.palFrameCd += Math.abs(this.vx);                // :51854-51866
        this.palFrameCd++;
        if (this.palFrame < 7) this.palFrame = 7;
        if (this.palFrameCd > 10) { this.palFrame++; this.palFrameCd = 0; }
        if (this.palFrame >= 13) this.palFrame = 7;
      } else {
        this.palFrame = petting ? 13 : 0;                    // :51848-51853
        this.palFrameCd = 0;
      }
    } else {
      if (!this.onGround) {
        this.palFrameCd = 0;
        this.palFrame = this.vy > 0 ? 2 : 1;                 // :51924-51930
      } else if (Math.abs(this.vx) >= 0.5) {
        this.palFrameCd += Math.abs(this.vx);                // :51892-51906
        this.palFrameCd++;
        if (this.palFrame < 8) this.palFrame = 8;
        if (this.palFrameCd > 10) { this.palFrame++; this.palFrameCd = 0; }
        if (this.palFrame >= 15) this.palFrame = 8;
      } else {
        this.palFrame = petting ? 16 : 0;                    // :51886-51891
        this.palFrameCd = 0;
      }
    }
  }

  // ===================== ★BJ433 捣蛋猫帮工链（AI_067 flag8 专属,1093/1112） =====================

  /** AI_067_FreakingPirates_TryAssigningHelp（Projectile.cs:52208-52268）1:1：
   *  每拍窥探玩家意图（IntentionGuesser——Track 由玩家挖掘击打喂入,见 Game.tryMine/
   *  petPickTile 接线），命中则入 ai[0]=3 帮工态寻格：
   *  · 门（:52209）：ai[0]==1（现身）/2（扑击）早退；owner != Main.myPlayer 门 =
   *    本仓随从 owner 权威模拟恒真,豁免。
   *  · 帮工态意图失效（:52211-52219）：ai[0]==3 ∧ Intention==None → 三 ai 清零 +
   *    localAI[0]/[1] 清（palJoyCd/palHelpLai1——localAI[1] 原文无读点=死写承载）。
   *  · 意图分派（:52226-52250）：
   *    - HarvestTrees → PrepareUsageProxy(player, 10 铁斧, 15, 5) → Step_Axe
   *      （stepAxeCore,扫区=陈值格 ±15×±5..+1,斧格→树干帧校正→沿 Y 下到根→
   *      离 LastMouse 最近）命中 → ai[0]=3,ai[1]=X,ai[2]=Y;
   *    - HarvestTreasure → PrepareUsageProxy(player, 1 铁镐, 15, 15) →
   *      Step_Pickaxe_MineSolids（stepMineSolidsCore,射线用陈值 position/Center/
   *      width/direction + 现役 height/gravDir;skip 表 _miningHelperPointsToSkip
   *      = Projectile.cs:522 声明后零写点恒空）命中 → 同上置态。
   *  · 未命中不清态（原版同构——帮工态持旧栖点走到 HitIntention 处由 inactive
   *    分支归零）;netUpdate 面（:52261-52268）本仓无联机差量,豁免。
   *  · 新分派拍（ai[0] 0→3）∧ 动作窗在 → localAI[0]=60（:52263-52265——抚摸 Joy
   *    计时槽复用,60t 内不重触发 Joy 音）+ localAI[1]=0。 */
  private cattivaTryAssigningHelp(game: GameHooks, p: Player): void {
    if (this.palA0 === 1 || this.palA0 === 2) return;                       // :52209
    const ig = game.intentionGuesser;
    if (!ig) return;
    const prevA0 = this.palA0;
    if (this.palA0 === 3 && ig.intention === GuessedPlayerIntention.None) { // :52211-52219
      this.palA0 = 0; this.palA1 = 0; this.palA2 = 0;
      this.palJoyCd = 0;          // localAI[0] = 0（:52215）
      this.palHelpLai1 = 0;       // localAI[1] = 0（:52216,死写承载）
      return;
    }
    const st = game.world.store;
    // 合成 SmartCursorEnv（UsageProxy 等价）：actor = 陈值快照 position/Center/
    // width/direction + 现役 player.height（:2363 height 取自现役）;mouse = LastMouse;
    // grappleAnchors = _miningHelperPointsToSkip 恒空表（Projectile.cs:522 注）
    const env: SmartCursorEnv = {
      st,
      mouse: { x: ig.lastMouse.x, y: ig.lastMouse.y },
      actor: {
        x: ig.lastPosition.x, y: ig.lastPosition.y, w: ig.lastWidth, h: p.h,
        cx: ig.lastCenter.x, cy: ig.lastCenter.y, facing: ig.lastDirection,
      },
      held: { def: null, tool: null },
      settings: DEFAULT_SMART_CURSOR_SETTINGS,
      tileBoost: 0,
      wireToolMode: 0,
      occupants: [],
      controlUseItem: false,
      grappleAnchors: [],
      gravDir: p.gravDir,
    };
    let fx = -1, fy = -1;
    const setFound = (x: number, y: number): void => { fx = x; fy = y; };
    const taken = (): boolean => fx !== -1;
    switch (ig.intention) {
      case GuessedPlayerIntention.HarvestTrees: {                        // :52226-52237
        const reach = ig.prepareUsageProxy(15, 5, st.w, st.h);
        const sem: HeldSemantics = heldSemantics({ def: null, tool: { type: 'axe', power: 40 } });   // 铁斧 10（>0 门）
        stepAxeCore(env, sem, reach, setFound, taken);
        break;
      }
      case GuessedPlayerIntention.HarvestTreasure: {                     // :52238-52250
        const reach = ig.prepareUsageProxy(15, 15, st.w, st.h);
        const sem: HeldSemantics = heldSemantics({ def: null, tool: { type: 'pick', power: 40 } });  // 铁镐 1（>0 门）
        stepMineSolidsCore(env, sem, reach, setFound, taken);
        break;
      }
      default:
        return;
    }
    if (fx !== -1 && fy !== -1) {                                        // :52233-52236/:52244-52248
      this.palA0 = 3;
      this.palA1 = fx;
      this.palA2 = fy;
    }
    if (prevA0 !== this.palA0 && ig.playerActiveActionTimeLeft > 0) {    // :52263-52265
      this.palJoyCd = 60;        // localAI[0] = 60
      this.palHelpLai1 = 0;      // localAI[1] = 0（死写承载）
    }
  }

  /** AI_067_FreakingPirates_HitIntention（Projectile.cs:52167-52206）1:1：帮工采掘击。
   *  · 栖点格 active 判定（:52171-52176 tileSafely.active()）——inactive → num=0 走
   *    归零支;越界原版 GetTileSafely null → 裸 return【不清态】（:52173-52175）,
   *    本仓 petPickTile 越界返回 false 会走归零支,域内不可达（栖点恒在界内）,备案。
   *  · 镐力钉值 41（:52181）——DetermineDamage(false) >0 才 PickTile（:52184-52189,
   *    dealDamageAsIfBaseNumberIs 缺省 -1 无比例钳 = petPickTile cap=pickPower 恒等式;
   *    PickTile 内破块 AllowTracking :54412 由 petPickTile 承载）。
   *  · CattivaHit 编排粒子 @栖点+Circular(4,4)/速度 CircularEdge(4,4)（:52193-52201,
   *    cattivaHitFx 六芒簇 + module8 广播,与 SpawnHitVisuals 的 Center 锚不同位）。
   *  · 无可伤格 → 三 ai 清零（:52202-52205,下拍 TryAssigningHelp 重寻格）。 */
  private cattivaHitIntention(game: GameHooks, idealX: number, idealY: number): void {
    const tx = Math.floor(idealX / 16);
    const ty = Math.floor(idealY / 16);
    const hit = game.petPickTile?.(tx, ty, 41, 41) ?? false;   // :52181-52189
    if (hit) {
      const px = idealX + (Math.random() * 2 - 1) * 4;         // +NextVector2Circular(4,4)
      const py = idealY + (Math.random() * 2 - 1) * 4;
      const ea = Math.random() * Math.PI * 2;                  // NextVector2CircularEdge(4,4)
      const mvX = Math.cos(ea) * 4, mvY = Math.sin(ea) * 4;
      cattivaHitFx(game, px, py, mvX, mvY);
      game.broadcastParticleOrchestra?.(ParticleOrchestraType.CattivaHit, px, py, mvX, mvY);
    } else {
      this.palA0 = 0; this.palA1 = 0; this.palA2 = 0;          // :52202-52205
    }
  }

  /** 蘑菇小伙伴 1022（Dead Cells 联动·蘑菇小伙伴杖 5456；AI_067 flag6 分支折算，
   *  Projectile.cs:50023 flag6 定义/:50140-50148 续命+射程 800/:50285-50310 跟随锚
   *  （主后 (45+w/2)+组序×30）/ :50444-50450 friendly=true+检索档 ai[0]∈{0,1}/
   *  :51003-51019 目标偏移点（敌心 +(27,0)×direction,:51022-51026 num30=20+7）/
   *  :51017-51019 无目标清 localAI[2]/ :52108-52152 TryJumpingToTarget 1022 支——
   *  目标高 160px 或归位态且 ai[2]==0 → TargetFound 编排粒子 @Top 前摇 15t → 蓄跃
   *  32 速朝拦截点（★台账批⑤ GetChaseResults 真拦截:getChaseResults Utils.cs:651）、
   *  ai[2]=30、贴图前摇 ShockIcon/爆点 :50598-50621：ai[2]>0 且 IsInRangeOfMeOrMyOwner
   *  (敌,60)（★台账批⑦ 双距+CanHitWithOwnBody/CanHitWithMeleeWeapon 盒门真值
   *  Projectile.cs:52404-52422）→ 弹 1044
   *  （伤×1.33/kb×3,DeadCellsMushroom.ts 承载 AI_117+AoE+爆炸编排粒子音）+
   *  Center=玩家中心+小随机速度;ai[2]<0 逐拍 ++ / >0 空中逐拍 −−贴地归零
   *  （:50622-50630）;Damage_CanDealDamage (1022&&ai[2]>0)=false :12463 → 跃击途中
   *  无接触伤。移动档（:51296-51302 有目标 0.8/6/6,缺省 0.5/4/4;:51342-51345 主速
   *  catch-up）/跳梯（:51424-51527 同帕鲁族——flag6 仅关 flag20 墙意图档 :51384,
   *  flag21 前柱探测仍生效 + 高出距离表 −6..−16）/重力 0.4 封顶 10（:51553-51556,
   *  num62×num63 附加项未折算备案）。帧机 :51642-51681：索敌中空中 13 / 地面 10-15
   *  每 4fc;无目标立地 0 / 走行 |vx|≥0.5 计步 2-9 / 空中 1;归位帧 1+rotation=vx×0.1
   *  （:50713-50716）。jump/land 两音为原版孤儿（deadcells_mushroom_jump/land 全树
   *  零调用,DEAD_SLOTS 备案）不接。 */
  private mushBoiStep(game: GameHooks, p: Player, dmg0: number): void {
    // ★Z1/BJ433 平台下穿链（decidesManualFallThrough=true :9681 → :50454/:52112 两写位
    //  + :17692-17694 消费;承载=Entity.dropThrough）
    this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    const st = game.world.store;
    // 湿旗=上拍段值快照 wetAi（2026-09-08 定谳批:vanilla :51616 ×2 消费 Projectile.wet
    // =AI 读上一子步段值——probe 现场盒测读当拍位=提前 1 拍,随批退役归一,见类字段
    // 块头注①②③）
    const wet = this.wetAi;
    // ---- 索敌（检索档 ai[0]==0||1 :50448-50450）——终清波批：双距检索归真 ----
    const tgt = this.mbA0 === 0 || this.mbA0 === 1 ? this.findTargetInRangeDual(game, 800, { skipIfCannotHitOwnBody: true }) : null;   // ★BJ515 债④：skip=true（:50524）
    // ---- 爆点判定（:50598-50621,先于移动块）。台账批⑦：IsInRangeOfMeOrMyOwner
    //      （Projectile.cs:52404-52422）双距真值——本体距 <60 且 !CanHitWithOwnBody → ∞、
    //      主距 <60 且 !CanHitWithMeleeWeapon → ∞（旧"min(直距)<60"无盒门,隔墙误爆面）----
    if (this.mbA2 > 0 && tgt) {
      let dMe = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
      if (dMe < 60 && !canHitWithOwnBodyBox(st, this.x, this.y, this.w, this.h, this.facing,
        tgt.x, tgt.y, tgt.w, tgt.h)) dMe = Infinity;
      let dP = Math.hypot(tgt.cx - p.cx, tgt.cy - p.cy);
      if (dP < 60 && !canHitWithMeleeWeaponBox(st, p.x, p.y, p.w, p.h, p.facing,
        tgt.x, tgt.y, tgt.w, tgt.h)) dP = Infinity;
      if (dMe <= 60 || dP <= 60) {                        // closerIsMe 择近 ≤60（:52420-52422）
        this.mbA2 = -120;                                 // :50604
        // 编排补远端：原版 RequestParticleSpawn(clientOnly:true)（P.cs:35277）各客户端
        // 自跑随从 AI 同刻直生;本仓随从仅 owner 权威模拟 → owner 广播 DeadCellsMushroom-
        // BoiExplosion 让访客侧 netApply 复放（偏差登记,module8 枚举注同口径）
        game.broadcastParticleOrchestra?.(ParticleOrchestraType.DeadCellsMushroomBoiExplosion,
          this.cx, this.cy);
        const boom = new MushroomBoiExplosionProj(this.cx, this.cy,
          Math.max(1, Math.round(dmg0 * 1.33)), this.knockback * 3,   // :50606-50607
          (bx, by) => { requestMushroomBoiExplosion(game, bx, by); });
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(boom, 'projectiles');
        this.x = p.cx - this.w / 2;                       // Center = player.Center（:50609-50611）
        this.y = p.cy - this.h / 2;
        this.vx = -2 + Math.random() * 4;                 // velocity=(rand(−2..2),rand(1..2))（:50612）
        this.vy = 1 + Math.random();
      }
    }
    // ---- ai[2] 衰减（:50622-50630；velocity.Y==0 ⟺ 贴地——碰撞落地清零语义）----
    if (this.mbA2 < 0) this.mbA2++;
    else if (this.vy === 0 && this.onGround) this.mbA2 = 0;
    else if (--this.mbA2 < 0) this.mbA2 = 0;
    // ---- TryJumpingToTarget 1022 支（:52108-52152;attackTarget>=0 段每拍调用）----
    //  ★2026-09-08 续单：支体尾置 flag2（:52149——门过即置真,leap 是否已发无关）,
    //  随后共享尾（:52154）以 !flag2 让位=与蘑菇蓄跃互斥（共享核原为同函数体）
    let jump1022Flag2 = false;
    if (tgt) {
      if ((tgt.cy < this.cy - 160 || this.mbA0 === 1) && this.mbA2 === 0) {
        if (this.mbLai2 === 0) {
          // DeadCellsMushroomBoiTargetFound @Top（:52129-52136）——ShockIcon 黄色惊叹
          game.spawnParticles(this.cx, this.y - 40, '#FFFF0A', 4, 1.5, { life: 15, grav: 0 });
        }
        if (++this.mbLai2 >= 15) {                        // :52139-52147
          // ★台账批⑤：Utils.GetChaseResults（Utils.cs:651-708）真拦截——
          //   InterceptionHappens ∧ time<120 → ChaserVelocity；否则
          //   targetCenter.SafeNormalize(-UnitY)×32（零距兜底 (0,-32) 竖直上跃）
          const chase = getChaseResults(this.cx, this.cy, 32,
            tgt.cx, tgt.cy, (tgt as { vx?: number }).vx ?? 0, (tgt as { vy?: number }).vy ?? 0);
          if (chase.intercepts && chase.time < 120) {
            this.vx = chase.vx; this.vy = chase.vy;
          } else {
            const dl = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
            if (dl > 0) {
              this.vx = (tgt.cx - this.cx) / dl * 32;
              this.vy = (tgt.cy - this.cy) / dl * 32;
            } else { this.vx = 0; this.vy = -32; }
          }
          this.mbA2 = 30;
          this.mbLai2 = 0;
        }
        jump1022Flag2 = true;                             // :52149（支体尾,无条件置真）
      }
      // 共享尾（:52154-52164）——toTarget.Y=敌心 Y（flag6 的 (num30+7)×dir 偏移为
      // X 轴 :51012,targetCenter.Y 同值）;跃起后 vy≠0 使结算段让位（原版同序）
      this.ai67TryJumpingToTargetTail(tgt.cy, jump1022Flag2);
      this.dropThrough = tgt.cy > this.y + this.h;   // ★Z1/BJ433 :52112 锚
    } else {
      this.mbLai2 = 0;                                    // :51017-51019
    }
    // ---- 归位飞行（ai[0]==1 :50636-50716;先于地面段——该态不行走）----
    if (this.mbA0 === 1) {
      this.tileCollide = false;                           // :50637 归位段穿墙
      const dpx = p.cx - this.cx, dpy = p.cy - this.cy;
      if (Math.hypot(dpx, dpy) > 2000) {                  // :50660-50662 瞬移
        this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2;
      } else {
        const sp = Math.max(10, Math.abs(p.vx) + Math.abs(p.vy));   // num19=10/主速 catch-up（:50644-50649）
        const dl = Math.hypot(dpx, dpy) || 1;
        this.vx += Math.max(-0.3, Math.min(0.3, dpx / dl * sp - this.vx));   // acc 0.2 反向 ×1.5 补（:50722-50752）
        this.vy += Math.max(-0.3, Math.min(0.3, dpy / dl * sp - this.vy));
        this.x += this.vx; this.y += this.vy;
      }
      // 退出门（:50685-50692 四连词 1:1）：<200 ∧ 主落地 ∧ 自身底不高过主底 ∧
      // 全盒无实心（Collision.SolidCollision）——2026-09-07 1118 嵌入定谳批同修：
      // 旧"中心列+脚行"双格近似漏盒缘/头行压墙（嵌入位退出,同 palGroundStep）,
      // 且缺 `position.Y+height <= player.position.Y+player.height` 第 3 连词
      // （低过主底也退出 = 主站高台时贴墙底退）。solidOverlap=家族 SolidCollision
      // 等价（蛙 :50686 同句同构）
      if (p.vy === 0 && Math.hypot(p.cx - this.cx, p.cy - this.cy) < 200
        && this.y + this.h <= p.y + p.h
        && !this.solidOverlap(st)) {
        this.mbA0 = 0;
        if (this.vy < -6) this.vy = -6;                   // :50689-50690
      }
      // 帧（:50713-50716）：frame=1、rotation=vx×0.1
      this.mushFrame = 1;
      this.rot = this.vx * 0.1;
      // ★BJ698：1022 归位飞行接触伤——flag6 friendly=true 恒开（AI_067 :50465-50467），
      //  projPet carve-out `type != 1022`（:12495）+ 首行仅拒 ai[2]>0（:12463 跃击段,
      //  与地面支 :3871 同门）⇒ 归位飞行可伤（旧 return 早退=缺窗）。
      if (this.mbA2 <= 0) this.contact(game, dmg0, 18);
      return;
    }
    this.rot = 0;                                         // flag6 rotation=0（:51643）
    // ---- 无目标归位门（:51199-51211）----
    if (!tgt) {
      const dpx = p.cx - this.cx, dpy = p.cy - this.cy;
      if (Math.hypot(dpx, dpy) > 2000) {                  // :51202-51204 瞬移
        this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2;
      } else if (Math.hypot(dpx, dpy) > 500 || Math.abs(dpy) > 300) {   // num3=500/num4=300（:50031-50033）
        this.mbA0 = 1;
        return;
      }
    }
    // ---- 行走目标点（:51003-51026 敌侧偏移 / :50285-50310 主后跟随锚）----
    let ax: number, ay: number;
    if (tgt) {
      ax = tgt.cx + 27 * (this.facing || 1);              // vector7 += (num30+7,0)*direction（:51022-51024）
      ay = tgt.cy;
    } else {
      const peers = (game as unknown as { entities: { projectiles: MinionProj[] } }).entities.projectiles
        .filter((m) => m instanceof MinionProj && !m.dead && m.projId === this.projId);
      const groupIdx = peers.indexOf(this);
      ax = p.cx - (45 + p.w / 2) * p.facing - groupIdx * 30 * p.facing;   // :50287-50289
      ay = p.cy;
      for (let k = 0; k < 20; k++) {                      // 落地扫描 ≤20 格（:51204-51212）
        if (st.isSolid(Math.floor(ax / 16), Math.floor(ay / 16))) break;
        ay += 16;
      }
      {
        const dx = ax - p.cx, dy = ay - p.cy;
        for (let t = 0.05; t <= 1.001; t += 0.05) {       // 视线截断（:51214-51260 5% 步进近似）
          if (st.isSolid(Math.floor((p.cx + dx * t) / 16), Math.floor((p.cy + dy * t) / 16))) break;
          ax = p.cx + dx * t; ay = p.cy + dy * t;
        }
      }
    }
    // ---- 地面移动（:51296-51568）----
    const withTgt = tgt !== null;
    let acc = 0.5, vmax = 4, clamp = 4;                   // 缺省档（:51297-51300）
    if (withTgt) { acc = 0.8; vmax = 6; clamp = 6; }      // flag6 有目标档（:51301-51305）
    const pSpd = Math.abs(p.vx) + Math.abs(p.vy);
    if (clamp < pSpd) { clamp = pSpd; acc = 0.7; }        // :51342-51345
    const dx = ax - this.cx;
    if (Math.abs(dx) > 5) {
      if (dx < 0) { this.vx -= this.vx > -vmax ? acc : 0.1; }
      else { this.vx += this.vx < vmax ? acc : 0.1; }     // :51348-51362（num53=0.1）
    } else {
      this.vx *= 0.9;                                     // :51406-51410
      if (Math.abs(this.vx) < acc * 2) this.vx = 0;
    }
    this.vx = Math.max(-clamp, Math.min(clamp, this.vx));
    // 跳梯两面合流（终清波批统一探测形）：flag6 关 flag20 墙意图档（:51384-51386）→
    // 仅机制(b) 前墙列扫（ai67JumpFlags）;落地 = ai67JumpLadder 三柱承立闸+五档
    // （虎先例共轨）。jump/land 两音为原版孤儿（deadcells_mushroom_jump/land 全树
    // 零调用）不接（既有登记）
    const dyA = ay - this.cy;
    const jump = this.ai67JumpFlags(st, ax, ay);
    this.vy = Math.min(this.vy + 0.4, 10);                // 重力 0.4 封顶 10（:51553-51556）
    this.tileCollide = true;                              // 地面段恒 true（:51266——先于移动）
    // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗）
    // StepUp（Collision.StepUp :51508——flag6 同受 ai[0]==0||3 运动块直调;跃击
    // mbA2 拍 ai[0] 仍 0 原文本就踏,单点置位即覆盖）——1118 嵌入定谳批同批补接
    this.stepUp = true;
    const dfMush = projWaterDragFactor(this);
    moveAndCollide(this, game.world, this.vx * dfMush, this.vy * dfMush);
    if (this.onGround) {
      if (jump) this.ai67JumpLadder(st, Math.sign(dx) || 1);
      if (dyA < -48) {                                    // :51492-51527 高出距离表
        const d = -dyA;
        this.vy = d < 60 ? -6 : d < 80 ? -7 : d < 100 ? -8 : d < 120 ? -9
          : d < 140 ? -10 : d < 160 ? -11 : d < 190 ? -12 : d < 210 ? -13
          : d < 270 ? -14 : d < 310 ? -15 : -16;
      }
      if (wet) this.vy *= 2;                              // :51616-51619 湿身起跳 ×2
    }
    // 朝向（:51558-51568）
    if (this.vx < 0) this.facing = -1;
    else if (this.vx > 0) this.facing = 1;
    else this.facing = p.cx > this.cx ? 1 : -1;
    // ---- 接触伤（friendly=true 段 :50444;Damage_CanDealDamage 跃击途中 false :12463;
    //      localNPCHitCooldown=18 SetDefaults :9679）----
    if (this.mbA2 <= 0) this.contact(game, dmg0, 18);
    // ---- 帧机（:51642-51681；velocity.Y 判据 = 本仓 onGround 落地清零同构）----
    if (tgt) {
      if (!this.onGround) {
        this.mushFrame = 13; this.mushFrameCd = 0;        // :51646-51649
      } else {
        if (++this.mushFrameCd > 3) { this.mushFrame++; this.mushFrameCd = 0; }   // :51650-51654
        if (this.mushFrame < 10 || this.mushFrame > 15) this.mushFrame = 10;       // :51655-51657
      }
    } else if (this.onGround) {
      if (this.vx === 0) { this.mushFrame = 0; this.mushFrameCd = 0; }            // :51659-51662
      else if (Math.abs(this.vx) >= 0.5) {
        this.mushFrameCd += Math.abs(this.vx);            // :51663-51672 计步翻页
        this.mushFrameCd++;
        if (this.mushFrame < 2) this.mushFrame = 2;
        if (this.mushFrameCd > 10) { this.mushFrame++; this.mushFrameCd = 0; }
        if (this.mushFrame < 2 || this.mushFrame > 9) this.mushFrame = 2;
      } else {
        this.mushFrame = 0; this.mushFrameCd = 0;         // :51673-51676
      }
    } else {
      this.mushFrame = 1; this.mushFrameCd = 0;           // :51677-51680 空中
    }
  }

  /** 帕鲁钻地龟 1098/1123（AI_204_Digtoise Projectile.cs:39169-39506 全式折算，
   *  2026-08-23 内容缺口批；物品 5667/6174，Item.cs:44534-44546/:47564-47576）。
   *  纯挖掘宠：无战斗伤（minionSlots=0、不在 MinionTargetingFeature/Sacrificable 表
   *  ProjectileID.cs:395/:401）、存活门 = 主手持对应物品（1123↔6174 :39240-39246）。
   *  态机 ai[0]（:39173-39178）：0 出场（180t → 1）/ 1 向下挖 / 2 向右挖 / 3 向左挖 /
   *  4 离场（600t → 灭）/ 5 抚摸。右键指挥（Game.commandDigtoises）改写 ai[0]；
   *  挖掘 = 锚格带（Bottom+(0,-15) 所在格 :39198）三格 PickTile——向下 (x-1..x+1,y+1)
   *  / 横向 (x+2dir,y-2..y)，镐力 26 / max(26,最佳镐)（:39473-39480）、每击伤钳
   *  26/36（:39475-39481）；探到块但全不可伤 → 转离场（:39500-39503）。 */
  private digtoiseStep(game: GameHooks, p: Player): void {
    const st = game.world.store;
    // ★BJ672：弹面 flag6=TRUE 缺省（1098/1123 aiStyle 204,SetDefaults 无 tileCollide=
    //  false 行=初值 true、非 pet、不在覆写 switch → 下落穿平台;三处 moveAndCollide
    //  共享本入口逐拍置位）。
    this.dropThrough = true;
    const trusty = this.projId === 1123;
    // ★IIIII233（2026-09-09）：演出气泡 = Main.cs:34250-34266 Draw 期直绘的 tick 等价
    //  （DrawTemporaryBubble(emote, maxLifetime, remaining, anchor)）——
    //  ai[0]==5 抚摸 → emote 0 爱心（ai[1]<60,remaining=60-ai[1]）；
    //  ai[0]==4 离场 → emote 17 音符（同窗）；挖掘态 1/2/3 → emote 3 惊叹
    //  （ai[1]<40,remaining=40-ai[1],每次换向重置）；出场态 0 无泡。
    //  入口处取上 tick 终值 = 原版 Draw 在 Update 后读 ai 的同值（滞后 0 拍）。
    {
      const a1 = this.digA1;
      if (this.digA0 === 5 && a1 < 60) setTemporaryBubble(this, 0, 60, 60 - a1);
      else if (this.digA0 === 4 && a1 < 60) setTemporaryBubble(this, 17, 60, 60 - a1);
      else if (this.digA0 !== 0 && a1 < 40) setTemporaryBubble(this, 3, 60, 40 - a1);
      else clearTemporaryBubble(this);
    }
    let flag = this.digA0 === 0;        // 出场
    const flag2 = this.digA0 === 1;     // 向下挖
    const flag3 = this.digA0 === 2;     // 向右挖
    const flag4 = this.digA0 === 3;     // 向左挖
    const flag5 = this.digA0 === 4;     // 离场
    let flag6 = this.digA0 === 5;       // 抚摸
    // 重力（:39182-39187）+ 出界/主亡灭（:39170-39176 InWorld(20)/:39190-39193
    // player.dead||player.noBuilding——noBuilding 为旅程模式权限位，本仓无此位）
    this.vy = Math.min(this.vy + 2 / 15, 16);
    const ctx = Math.floor(this.cx / 16), cty = Math.floor(this.cy / 16);
    if (!st.inBounds(ctx - 20, cty - 20) || !st.inBounds(ctx + 20, cty + 20)) { this.dead = true; return; }
    if (p.dead) { this.dead = true; return; }
    // 抚摸进入/退出（:39207-39220）：被摸且非 5 态 → 转 5（背向主 + Joy 音一声）；
    // 停摸 → 回出场态 0。★原版转场 tick 局部旗同步（flag=false/flag6=true、
    // 反向 flag=true/flag6=false）→ 共通段当 tick 即按新旗跑
    const petting = p.petting.isPetting && this.beingPetted;
    if (petting && !flag6) {
      this.facing = this.cx > p.cx ? -1 : 1;            // :39212 背向判定取反=面向主
      this.digA0 = 5; this.digA1 = 0;
      game.playSfxFiles(['pal_digtoise_joy'], 0.35, this.cx, this.cy);  // :39222 PalDigtoiseJoy
      flag = false; flag6 = true;                       // :39213-39216 局部旗
    } else if (!petting && flag6) {                     // :39214-39219
      this.digA0 = 0; this.digA1 = 0;
      flag = true; flag6 = false;
    }
    // 出场/离场/抚摸共用段（flag|flag5|flag6 :39233-39260）：
    //  · 持物品门（:39240-39246）——1123↔6174 / 1098↔5667，失配即灭（仅出场/离场/
    //    抚摸态查；挖掘态不查 = 切物品后仍挖完当前隧道）
    //  · 摩擦减速 + 出场帧回卷（frame>2 钳 2，fc≥(frame==1?60:4) 递减 :39253-39260）
    if (flag || flag5 || flag6) {
      // ★BJ518④：DoPalAppearEffect（:39245——ai[0]∈{0,4,5} 每拍同调,withParticles 恒
      // true;挖掘态 1/2/3 无调用=alpha 冻结,原版减法面随调用位走）。原版序=音效段
      // （:39236-39244）后、持物品灭门（:39248）前——本仓同位
      this.doPalAppearEffect(game, p, true);
      const heldSlot = p.inv.heldItem();
      const heldVid = heldSlot
        ? (ITEM_DEFS[heldSlot.id]?.vid ?? -1)
        : -1;
      const want = trusty ? 6174 : 5667;
      if (heldVid !== want) { this.dead = true; return; }
      this.vx *= 0.7;                                   // :39249
      if ((this.digA1 === 0) && flag) {
        // :39252 `(!(Center.X > player.Center.X)) ? 1 : -1`——龟在主右侧 → 朝左（面向主）
        this.facing = this.cx > p.cx ? -1 : 1;
      }
      this.digA1++;
      if (flag && this.digA1 >= 180) { this.digA0 = 1; this.digA1 = 0; return; } // :39255-39258
      if (flag5 && this.digA1 >= 600) { this.dead = true; return; }              // :39259-39260
      if (this.digFrame > 2) this.digFrame = 2;
      const fcGate = this.digFrame === 1 ? 60 : 4;
      if (++this.digFrameCounter >= fcGate) {
        this.digFrameCounter = 0;
        if (--this.digFrame < 0) this.digFrame = 0;
      }
      // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗）
      const dfSurf = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfSurf, this.vy * dfSurf);   // 重力+摩擦位移（引擎段等价）
      return;
    }
    const digging = flag2 || flag3 || flag4;            // flag8（:39262）
    if (!digging) return;
    // 挖掘态（:39263-39506）：alpha=0（全显）、锚格 = Bottom+(0,-15)（:39197-39198）
    const num3 = flag2 ? 1 : 0;                         // 向下
    const num2 = flag3 ? 1 : flag4 ? -1 : 0;            // 横向
    if (num2 !== 0) this.facing = num2;                 // :39272-39274 spriteDirection=direction
    const px = Math.floor((this.cx) / 16);              // point.X（Bottom-15 ≈ 盒心带）
    const py = Math.floor((this.y + this.h - 15) / 16);
    const num4 = 40;                                    // 蓄势档（:39277）
    if (this.digA1 > num4) {
      // 横向加速（:39279-39285）+ 前方悬空探针（:39287-39300：脚下三格全空 →
      // 转离场 ai[0]=4）
      this.vx += num2 * 8 / 60;
      if (Math.abs(this.vx) >= 8) this.vx = this.vx >= 0 ? 8 : -8;
      if (num2 !== 0) {
        // point2 = (Bottom + (w*dir/2 + 2dir, 2)) 所在格；point3/point4 = point2 右/同列
        // （原版 :39289-39291 两点同坐标——quirk 照抄）。三格全空 → 转离场
        const ax = Math.floor((this.cx + (this.w * num2) / 2 + num2 * 2) / 16);
        const ay = Math.floor((this.y + this.h + 2) / 16);
        const probe = (x: number, y: number): boolean => st.inBounds(x, y) && st.isSolid(x, y);
        if (!probe(ax, ay) && !probe(ax + num2, ay) && !probe(ax + num2, ay)) {
          this.digA0 = 4; this.digA1 = 0;
          this.vx *= 0.5;
          return;
        }
      }
      // 迎面墙钳速（:39302-39321）：前方 2 格列 y-2..y 有实心 → vx 钳到墙面
      if (num2 !== 0) {
        const wx = px + num2 * 2;
        let wall = false;
        for (let k = py - 2; k <= py; k++) if (st.inBounds(wx, k) && st.isSolid(wx, k)) wall = true;
        if (wall) {
          if (num2 > 0) this.vx = Math.min(this.vx, wx * 16 - (this.x + this.w));
          else this.vx = Math.max(this.vx, (wx * 16 + 16) - this.x);
        }
      }
      // 挖掘帧（:39375-39390）：入态钉帧 2 → fc≥(frame==2?5:4-lai1/4) 翻页，frame≥10 回 3
      if (this.digFrame < 2) { this.digFrame = 2; this.digLai1 = 0; this.digFrameCounter = 0; }
      let num7 = 4 - Math.trunc(this.digLai1 / 4);
      if (num7 < 1) num7 = 1;
      const num8 = this.digFrame === 2 ? 5 : num7;
      if (++this.digFrameCounter >= num8) {
        this.digLai1++;
        this.digFrameCounter = 0;
        if (++this.digFrame >= 10) this.digFrame = 3;
      }
      // 挖掘声（:39395-39397）+ 光（:39437 0.3/0.3/0.1）+ 接触尘（:39439-39452）
      if (this.digSoundCd <= 0) {
        this.digSoundCd = 10;
        game.playSfxFiles(soundTrackFiles('Item_199'), 0.5, this.cx, this.cy);
      } else this.digSoundCd--;
      game.addLightAt?.(this.cx, this.cy, 0.3, 0.3, 0.1);
      // 接触尘 flag10（:39439-39452）：挖掘带任一实心 → 尘 213 ×3（1/3 概率
      // scale2+fadeIn3，余 scale3；速度 -dir×3,-2）——本仓 vanillaDust 池直入，
      // 缺池回退定向粒子
      let digContact = false;
      if (num3 !== 0) {
        for (let x = px - 1; x <= px + 1; x++) if (st.isSolid(x, py + 1)) digContact = true;
      }
      if (num2 !== 0) {
        for (let y = py - 2; y <= py; y++) if (st.isSolid(px + num2 * 2, y)) digContact = true;
      }
      if (digContact) {
        for (let n = 0; n < 3; n++) {
          const big = Math.random() < 1 / 3;
          const d = game.spawnDust?.(this.x + num2 * 20, this.y + this.h / 2, this.w, this.h / 2,
            213, -num2 * 3, -2, 0, null, big ? 2 : 3);
          if (d && big) d.fadeIn = 3;
          if (!game.spawnDust) {
            game.spawnBurst?.(this.x + this.w / 2 + num2 * 20, this.y + this.h * 0.75,
              '#A08A5A', 1, 3, Math.atan2(-2, -num2 * 3), 0.4, { life: 20, grav: 0.1 });
          }
        }
      }
      // 位移（tileCollide=true + correctSlopeCollision——挖掘面前进，撞实心由
      // moveAndCollide 截停；向下态纯重力坠入挖开的井道）
      // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗）
      const dfDig = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfDig, this.vy * dfDig);
      // 挖节拍（:39455-39470）：ai[1]≥num4+30 → 采掘一轮，ai[1] 回 num4+10
      // （1123 回 num4+20 → 间隔 10t，1098 间隔 20t）
      this.digA1++;
      if (this.digA1 < num4 + 30) return;
      this.digA1 = trusty ? num4 + 20 : num4 + 10;
      // 镐力/每击伤钳（:39473-39481）：1098 = 26/26；1123 = max(26, 最佳镐)/36
      const best = game.bestPickaxePower?.() ?? null;
      const pickPower = trusty ? Math.max(26, best ?? 0) : 26;
      const cap = trusty ? 36 : 26;
      let probed = 0, damaged = 0;
      const digTile = (x: number, y: number): void => {
        // WorldGen.SolidTile3 门（:39466/:39485 坐标重载）——★A-5 边带（2026-09-04）：
        // 首门 InWorld(·,1)（WorldGen.cs:71006-71008）世界最外一圈不可采
        if (!st.inWorld1(x, y)) return;
        if (!st.isSolid(x, y)) return;
        probed++;
        if (game.petPickTile?.(x, y, pickPower, cap)) damaged++;
      };
      if (num3 !== 0) {
        const dy = py + 1;                              // :39464-39472 下方三格带
        for (let x = px - 1; x <= px + 1; x++) digTile(x, dy);
      }
      if (num2 !== 0) {
        const dx2 = px + num2 * 2;                      // :39485-39497 前方 2 格列 y-2..y
        for (let y = py - 2; y <= py; y++) digTile(dx2, y);
      }
      if (probed > 0 && damaged < probed) {             // :39500-39503 有块全不可伤 → 离场
        this.digA0 = 4; this.digA1 = 0;
      }
      return;
    }
    // 蓄势段（ai[1]≤num4 :39455-39459）：frame=0、ai[1]++
    this.digFrame = 0;
    this.digA1++;
    // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗）
    const dfCharge = projWaterDragFactor(this);
    moveAndCollide(this, game.world, this.vx * dfCharge, this.vy * dfCharge);
  }

  /** 阿比盖尔本体 963（AI_062 963 档 1:1，1457 Projectile.cs :66074-66090 计数档/
   *  :66446-66462 归位门/:66474-66528 攻击闪/:66529-66638 交战/:66679-66826 归位/
   *  :66955-66962 朝向；1456 :62118-62134/:62490-62530 同构,行差 +3958）：
   *  · 计数档（:66085-66089）:num2=970 计数器数-1;num=1.4;num3=Max(4,18-1.75num2);
   *    num4=Max(5,40-4num2);num5=Min(1,0.69+0.03num2)
   *  · 索敌 700 + CanHit 1×1（:66330-66333/:66435）,距门以随从为基准（:66431）
   *  · 归位门 num21=800→有目标 1000（:66447-66453）;tileCollide=false（:66337-66340,
   *    本仓 963 无碰撞通道=穿墙,登记）
   *  · 攻击闪（:66503-66528）:ai[0]>=2 → ai[0]++（无目标再+1）>num4 归零（归零时
   *    距敌<50 再入闪 :66522-66525）,期间速度×num5;入闪一拍 AbigailAttack（:66505-66508）
   *  · 交战（:66531-66637,仅 ai[0]==0）:>200 加速 num27=6+1.4num2 lerp /2num3+1;
   *    ≤200:<50 速度减半+入闪（:66626-66630）,否则 num29=4+1.4num2 lerp /num3+1
   *  · 归位（:66686-66765）:num32=6×0.8（:66695-66698）,>200 提至 9（:66727）;
   *    锚=玩家心+(-40dir,40)（:66705-66708）;lerp /21（<50 半速 :66754-66757）;
   *    ≤10 贴身 ×0.9;>2000 瞬移玩家心（:66744-66748）
   *  · 朝向（:66947-66962）:spriteDirection=sign(vx)（:66947-66954 取反后 :66955-66957
   *    再 ×-1）,静止朝玩家（:66958-66961）;哭声 1/1500 移动中（:66494-66497）
   *  · 伤害 ×(1+num9×num2)——:12116-12125 num9=0.55/hardMode 1.3
   *  · 未折算:localAI[1] 出场淡入淡出（:66475-66493 纯渲染 alpha）、攻击帧 8-12
   *    映射（:66841-66901,本仓 963 走 age 兜底循环）、原版 963 无射击弹型
   *    （num48=0 :67051,ai[1] 自增无复位=至多一次 type-0 空弹,净效果无弹,不建模） */
  // ---- 泰拉棱镜 946（AI_156_BatOfLight 946 支 :52425-52760 1:1）----
  // ai[0]:−1 归位 / 0 待机 / 41-79 跃空段 / 0-39 弧刀段（攻击倒计时;起手恒 80、
  // 链式 NextFromList(40,80)——起手处 rand 被 num3=80 覆写为死代码 :52570-52571）
  private tA0 = 0;
  private tA1 = 0;            // ai[1] 目标敌 id
  private tSX = 0; tSY = 0;   // localAI[0/1] 攻击起点（跃空段记录）
  private tHit = new Map<number, number>();   // localNPCHitImmunity（StartAttack 清=每轮每敌一次）
  private tInit = false;

  /** AI_GetMyGroupIndexAndFillBlackList（:52809-52825，仅计数——blacklist 实际
   *  不填,TryAttackingNPCs 的黑名单门为空操作）。★BJ634：pid 形参化——AI_169 864
   *  出生态同调（:46573 AI_GetMyGroupIndexAndFillBlackList(null,...)）。
   *  ★C16a-F6（2026-10-12）补两门（:52811-52813 原式）：①owner 门
   *  `projectile.owner == owner`（旧注「单玩家恒同构」=对主世界成立、夹具/模块
   *  注入不同 owner 弹时失真）;②759 栖息帧过滤 `type!=759 || frame==projFrames-1`
   *  （projFrames[759]=5 Main.cs:8645 → 只计 bbFrame==4 肩头栖息只——飞行中雀
   *  不占编队位）。原版遍历 Main.projectile 含自身（whoAmI 恒 active）→ total≥1
   *  恒成立;本仓遍历 entities.projectiles 在弹入列前调用（出生拍/夹具漏 push）
   *  会得 total=0 → AI_169 num3=0 → gtw%num3=NaN 全链污染 → 防御回退 total=1
   *  （自见=index0）。 */
  private tGroup(game: GameHooks, pid = 946): { index: number; total: number } {
    const own = this.ownerRef();
    let index = 0, total = 0;
    for (const e of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
      const m = e as MinionProj;
      if (m instanceof MinionProj && !m.dead && m.ownerRef() === own && m.projId === pid
        && (pid !== 759 || m.bbFrame === 4)) {
        if (this.id > m.id) index++;
        total++;
      }
    }
    return total > 0 ? { index, total } : { index: 0, total: 1 };
  }

  /** AI_156_TryAttackingNPCs（:52694-52725）：距玩家心 1000 内最近敌 + 视线。
   *  ★台账批⑧：CanHitWithOwnBody 本体四试视线真值（Projectile.cs:12428-12444,
   *  CanHit 整盒 ∪ 三组 CanHitLine 端点对）——旧 canHitLine 单形状近似退役
   *  （墙棱半贴/侧沿擦过场景差档,实机验收=弧刀段绕柱起手率一致） */
  private tTarget(game: GameHooks, pcx: number, pcy: number): EnemyLike | null {
    // ★BJ514：集火支补（AI_156_TryAttackingNPCs :52772-52793——
    //  OwnerMinionAttackTargetNPC 第一桶：CanBeChasedBy ∧ 距玩家心 ≤1000
    //  （:52780 Distance>1000 拒）∧ CanHitWithOwnBody（:52784）→ 即退 :52790。
    // ★BJ515 债②（BJ514 批①登记债清偿）：blackListedTargets 面建模——定谳=
    //  1457 填充函数 :52809-52825 零 .Add（1405 :20333/1456 :48973 三代同形）,
    //  表结构性恒空 → :52776/:52796 Contains 谓词为死谓词;本刀把载体
    //  （AI156_BLACKLIST,每拍 Clear :52473）与死谓词门原形落位（等价承载,
    //  变异面=未来真填充源接入即翻红）。
    AI156_BLACKLIST.length = 0;        // :52473（AI_156_BatOfLight 每 AI 入口 Clear）
    const pOwn = this.ownerRef();
    const focus = (pOwn as unknown as { minionTargetId?: number } | null)?.minionTargetId ?? -1;
    if (focus >= 0) {
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean } & { boss?: boolean };
        if (!en || en.dead || en.id !== focus) continue;
        if (canBeChasedBy(e)
          && Math.hypot(en.cx - pcx, en.cy - pcy) <= 1000
          && canHitWithOwnBodyBox(game.world.store, this.x, this.y, this.w, this.h, this.facing,
            en.x, en.y, en.w, en.h)
          // :52776 `!boss && blackListedTargets.Contains(...)`（恒空=恒假,原形在位）
          && !(!(en.boss === true || (e as unknown as { def?: { boss?: boolean } }).def?.boss === true)
            && AI156_BLACKLIST.includes(en.id))) {
          return en;
        }
        break;                     // 原版单槽直查非全表扫
      }
    }
    let best: EnemyLike | null = null;
    let bestD = 1000;
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean; boss?: boolean };
      if (!canBeChasedBy(e) || !en || en.dead) continue;
      const d = Math.hypot(en.cx - pcx, en.cy - pcy);
      if (d > 1000) continue;
      if (!canHitWithOwnBodyBox(game.world.store, this.x, this.y, this.w, this.h, this.facing,
        en.x, en.y, en.w, en.h)) continue;
      // :52796 `boss || !blackListedTargets.Contains(i)`（恒空=恒真,原形在位）
      const isBoss = en.boss === true || (e as unknown as { def?: { boss?: boolean } }).def?.boss === true;
      if (!(isBoss || !AI156_BLACKLIST.includes(en.id))) continue;
      if (best === null || d < bestD) { best = en; bestD = d; }
    }
    return best;
  }

  /** oldPos/oldRot 历史环（★SW-BJ56：TrailingMode[946]=2,ProjectileID.cs:385 →
   *  Projectile.cs:17237-17246 每拍整环移位、oldPos[0]/oldRot[0]=最新;长度=
   *  oldPos.Length=TrailCacheLength[946]=20（ProjectileID.cs:387 CreateIntSet 第 1 参
   *  缺省 10,946 显式覆写 20;SetDefaults :723 按 TrailCacheLength[Type] 重分配）,
   *  平铺 [x,y,rot]×20,consume 位 = 946 draw 拖尾/EmpressBladeDrawer。
   *  ★SW-RB11a（2026-09-10）：旧值 10 系把 CreateIntSet 缺省当覆写值——拖尾环
   *  少一半=尾迹视觉减半（EmpressBladeDrawer.PrepareStrip expectedPairs=
   *  proj.oldPos.Length=20,VertexStrip.cs:54-63 progressOnStrip=i/(pairs−1)）。 */
  private tHist: number[] = [];

  /** AI 后压栈（原版 TrailingMode=2 在 AI() 之后的 Update 段 oldPos[0]=position :17243） */
  private terraprismaBody(game: GameHooks, p: Player, dmg0: number): void {
    this.terraprismaAI(game, p, dmg0);
    this.tHist.unshift(this.cx, this.cy, this.rot);
    if (this.tHist.length > 60) this.tHist.length = 60;   // oldPos.Length=TrailCacheLength[946]=20（SW-RB11a）
  }

  /** ★BJ634（2026-10-11）：刃杖 864 专属 AI = AI_169_Smolstars（Projectile.cs:46559-46700）
   *  1:1 折算。此前 864 无专属分支落通用飞行路径 = 用户实报「打 boss 老不打/追不上」
   *  根因三面全偏：攻击速度 5（原版 16 :46666-46671 直写钳）/巡航 4（原版 10~40
   *  :46588-46600 GetLerpValue(200,600,dist) 梯）/索敌 nearestEnemy(700) 每拍重选
   *  （原版 800 + Minion_FindTargetInRange 焦点支/boss 豁免 viewRect :46601-46602 +
   *  ai[0]=60 锁敌态机 :46603-46608 + 命中受理转返航 :14129-14141）。
   *  态机 ai[0]：0 闲置巡航 / -1 返航重整 / 60 攻击（a169St/a169Tg/a169Rt 三槽）。
   *  命中盒 10×10（:8288-8289,构造器补注册）;接触冷却 localNPCHitCooldown=10
   *  （CONTACT_CD_TABLE 864:10,BJ511 已接）;imm[owner]=0 清窗由 local 档 pierce=-3
   *  承载（BJ436）。玩家死亡断供（:46566-46569 dead→smolstar=false→下帧 DelBuff 271
   *  →弹 60t 内灭）→ 本仓维护链（maintainMinionBuffs BJ405）同拍直杀=净语义同相。
   */
  private smolstarAI(game: GameHooks, p: Player, dmg0: number): void {
    // ---- 玩家死亡断供（:46566-46569）----
    if (p.dead) { this.dead = true; return; }
    // ---- ai[0]==0：闲置/巡航态（:46585-46616）----
    if (this.a169St === 0) {
      // 悬浮锚 = player.Top + (0,-30)（:46562）+ 编队椭圆偏移（:46573-46584）：
      // index/total=AI_GetMyGroupIndexAndFillBlackList（:46575）;num2=2π/total
      // （:46576）;num3=total×0.66（:46577）;vector2=(30,6)/5×(total-1)（:46578）;
      // vector3=UnitY.RotatedBy(num2×index + gtw%num3/num3×2π)（:46579——
      // GlobalTimeWrappedHourly 相位轮转）;vector+=vector3×vector2【组件乘】
      // （:46580,Vector2×Vector2=组件乘判例）;Y+=gfxOffY（本仓未建模恒 0）;Floor
      const g = this.tGroup(game, 864);
      const num2 = (Math.PI * 2) / g.total;
      const num3 = g.total * 0.66;
      const vec2x = (30 / 5) * (g.total - 1);
      const vec2y = (6 / 5) * (g.total - 1);
      const ang = num2 * g.index + (gtwSec() % num3) / num3 * (Math.PI * 2);
      let hx = p.cx;                                     // player.Top.X = Center.X
      let hy = p.y - 30;                                 // player.Top.Y + (0,-30)
      hx += -Math.sin(ang) * vec2x;                      // UnitY.RotatedBy(ang).X = −sin
      hy += Math.cos(ang) * vec2y;                       // UnitY.RotatedBy(ang).Y = cos
      hx = Math.floor(hx); hy = Math.floor(hy);          // vector.Floor()（:46582）
      const dx = hx - this.cx, dy = hy - this.cy;
      const dist = Math.hypot(dx, dy);
      // num4 = 10 + GetLerpValue(200,600,dist,true)×30（:46588-46590）——200px 内 10、
      // 600px 外 40（速度梯=巡航「追大部队」主升档）
      const num4 = 10 + clamp01((dist - 200) / 400) * 30;
      if (dist >= 3000) {                                // :46591-46593 瞬移锚点
        this.x = hx - this.w / 2; this.y = hy - this.h / 2;   // Center = vector
      }
      this.vx = dx; this.vy = dy;                        // velocity = vector4（:46594 直写）
      if (dist > num4) {                                 // :46595-46597 钳 num4
        this.vx = dx / dist * num4; this.vy = dy / dist * num4;
      }
      // 索敌（:46598-46602）：Minion_FindTargetInRange(800, skip=false)——
      // respectOwnerTarget 缺省 true（原版调用未传）→ findTargetInRangeDual 焦点支照吃
      const tgtF = this.findTargetInRangeDual(game, 800);
      if (tgtF) {                                        // :46603-46608 锁敌态机
        this.a169St = 60;
        this.a169Tg = tgtF.id;
      }
      // rotation（:46609-46613）：vel 向 +π/2;dist<40 → 恒 π（Vector2.UnitY.ToRotation()
      // +MathF.PI/2 = π/2+π/2 = π——★BJ637 复报定谳（用户截图 107.png「召唤物横着的」）：
      // 旧写 π/2 系转写漏加后项（把 UnitY.ToRotation() 当终值），竖刃贴图（帧 0 尖朝上）
      // 转 90° = 横置;π = 尖朝下竖直。旋转源=AI rotation 本体，本体绘制 ctx.rotate(this.rot)
      // 通用路消费（MinionProj.draw 尾）;辉光十字/残影（:31395/:30883）为同 rot 叠层不承载朝向。
      let tAng = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      if (dist < 40) tAng = Math.PI;
      this.rot = angleLerp(this.rot, tAng, 0.2);
      this.x += this.vx; this.y += this.vy;
      // 命中特支同巡航态成立（原版时序：AI 内索敌先置 ai[0]=60（:46603-46608）→
      // Damage 面 864 特支读 ai[0]>0（:14135）→ 同拍锁定命中也转返航）
      if (this.contact(game, dmg0) && this.a169St > 0) { this.a169St = -1; this.a169Rt = 0; }
      this.recordGhostTrail();   // ★BJ650件1：UpdateTrails（:17198,mode2=12 份白模残影
      return;                    //  :30888-30892——旧 smolstarAI 三出口零记录=环恒空,残影死支）
    }
    // ---- ai[0]==-1：返航重整态（:46617-46644）----
    if (this.a169St === -1) {
      if (this.a169Rt === 0) {
        // 首拍：PlaySound(0)=SoundDig rand 0-2（LegacySoundPlayer.cs:441-448）+ 尘 15×2
        // （:46622-46632,oldVelocity×0.2 初速/rand3≠0 → scale×1.3 vel×1.1/noGravity/
        // fadeIn 0）+ 圆缘随机冲量 4（:46633 NextVector2CircularEdge）
        // ★BJ683（2026-10-14 用户实报「SW 访问 sounds/dig.mp3 404」定谳）：PlaySound(0)
        //  =LegacySoundPlayer case 0 挖掘音=Dig_0/1/2 随机（Sfx.WAV_MAP.dig 键域）,
        //  原码 soundTrackFiles('dig') 走声轨表（vanilla-soundtracks.json,只载 snake
        //  轨名）——'dig' 不在表 → 兜底分支把裸名当文件名返回 ['dig'] → ensureBuffer
        //  fetch sounds/dig.opus/.mp3 双 404（盘上只有 Dig_0/1/2）→ 负缓存 15s →
        //  合成兜底近似音。改走 Game.playSfx('dig')（WAV_MAP 正确展开 Dig_0/1/2）。
        game.playSfx?.('dig', 1, this.cx, this.cy);
        for (let i = 0; i < 2; i++) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 15,
            this.vx * 0.2, this.vy * 0.2, 0, null, 1.4);
          if (d) {
            if (Math.floor(Math.random() * 3) !== 0) { d.scale *= 1.3; d.vx *= 1.1; d.vy *= 1.1; }
            d.noGravity = true;
            d.fadeIn = 0;
          }
        }
        const ea = Math.random() * Math.PI * 2;
        this.vx += Math.cos(ea) * 4; this.vy += Math.sin(ea) * 4;
      }
      this.a169Rt++;                                     // :46635
      this.rot += this.vx * 0.1 + this.vy * 0.05;        // :46636
      this.vx *= 0.92; this.vy *= 0.92;                  // :46637
      if (this.a169Rt >= 9) { this.a169St = 0; this.a169Rt = 0; }   // :46638-46643
      this.x += this.vx; this.y += this.vy;
      this.contact(game, dmg0);                          // -1 态命中不转返航（ai[0]>0 门）
      this.recordGhostTrail();                           // ★BJ650件1（同上,返航态出口）
      return;
    }
    // ---- ai[0]==60：攻击态（:46645-46674）----
    const tgt = this.a169Tg ? this.findEnemyById(game, this.a169Tg) : null;
    if (!tgt || !canBeChasedBy(tgt)) {                   // :46647-46650 CanBeChasedBy 校验
      this.a169St = -1; this.a169Rt = 0;                 // :46651-46656 → 返航（ai[1]=0）
    } else if (Math.hypot(tgt.cx - p.cx, tgt.cy - p.cy) >= 900) {   // :46657-46662
      this.a169St = 0; this.a169Tg = 0;                  // 玩家距目标 ≥900 → 放弃
    } else {
      const dx = tgt.cx - this.cx, dy = tgt.cy - this.cy;
      const dist = Math.hypot(dx, dy);
      this.vx = dx; this.vy = dy;                        // velocity = vector5（:46667 直写）
      if (dist > 16) {                                   // :46666/:46668-46671 钳 16
        this.vx = dx / dist * 16; this.vy = dy / dist * 16;
      }
      this.rot = angleLerp(this.rot, Math.atan2(this.vy, this.vx) + Math.PI / 2, 0.4);   // :46672-46673
    }
    // ---- 分离力（:46675-46698,攻击态拍尾恒跑——目标失效拍亦跑,if/else 链不 return）：
    // num8 = width×5 = 50（:46676）;同类同主曼哈顿 <50 → 双轴互推 ±0.1（:46677-46698,
    // position 序判向）。velocity 覆写后叠加 → 当拍位移即受影响（HandleMovement 积分）。
    {
      const num8 = this.w * 5;
      for (const ent of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
        const o = ent as MinionProj;
        if (!(o instanceof MinionProj) || o === this || o.dead || o.projId !== 864) continue;
        if (o.ownerRef() !== p) continue;                // owner == owner（:46679）
        if (Math.abs(this.x - o.x) + Math.abs(this.y - o.y) >= num8) continue;
        this.vx += this.x < o.x ? -0.1 : 0.1;            // :46681-46688
        this.vy += this.y < o.y ? -0.1 : 0.1;            // :46689-46696
      }
    }
    this.x += this.vx; this.y += this.vy;
    // 命中受理→返航（:14129-14141 Damage_PVE_Inner 864 特支）：ai[0]>0（=60 态）
    // 命中 → ai[0]=-1/ai[1]=0。私表写位（localNPCHitCooldown=10/imm[owner]=0 清窗）
    // 已由 contact() local 档承载（BJ511/BJ436）。
    if (this.contact(game, dmg0) && this.a169St > 0) {
      this.a169St = -1;
      this.a169Rt = 0;
    }
    this.recordGhostTrail();   // ★BJ650件1（同上,攻击态出口）
  }

  /** ★BJ635（2026-10-11）② 雀宝宝 759 专属 AI = AI_158_BabyBird（Projectile.cs:49643-49853
   *  + AI_158_GetHomeLocation :49854-49913）1:1 折算。普查定谳（BJ634 判例同形态）：
   *  759 此前无专属分支落通用飞行路径——追击恒速 5（原版三档：远档 Lerp(velocity,
   *  dir×6,0.15) :49690-49695 / 近身 sign±0.35 步进钳 8 :49696-49705 / 盒接触 ×1.1
   *  加速钳 8 :49679-49689）、锚位=通用环形槽（原版 = AI_158_GetHomeLocation 玩家
   *  头部栖息位栈 :49854）、零同类分离力（攻击档 ±0.025/width×3 :49706-49722、
   *  归位档 ±0.05/width :49775-49795）、零 2000px 归位瞬移（:49747-49756）。
   *  伴生面：tileCollide 逐态翻转（自由盒→true :49671-49673;盒接触/近身/归位 false）、
   *  栖息/瞬移拍 frame=4（bbFrame 通道逐一拍,帧循环 0-3 由 MINION_FRAMES[759] 表）。
   *  timeLeft=2 面（:49653 player.babyBird）=buff 216 维护链承载（maintainMinionBuffs
   *  BJ405）;玩家死亡断供（:49652-49655 dead→babyBird=false）同 864 判例。 */
  private babyBirdStep(game: GameHooks, p: Player, dmg0: number): void {
    if (p.dead) { this.dead = true; return; }        // :49652-49655（净语义同 864 判例）
    this.bbFrame = -1;                               // 栖息帧通道逐一拍（上拍置位已消费）
    const st = game.world.store;
    // ---- 索敌（:49666 Minion_FindTargetInRange(800, skip=false, respectOwnerTarget
    // 缺省 true) + :49670-49674 玩家心距 >800 → 攻击目标作废）----
    let tgt = this.findTargetInRangeDual(game, 800);
    if (tgt && Math.hypot(tgt.cx - p.cx, tgt.cy - p.cy) > 800) tgt = null;
    if (tgt) {
      if (!this.solidOverlap(st)) this.tileCollide = true;   // :49671-49673 自由盒→可碰块
      const num5 = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
      const intersects = this.x < tgt.x + tgt.w && this.x + this.w > tgt.x
        && this.y < tgt.y + tgt.h && this.y + this.h > tgt.y;   // Rectangle.Intersects :49678
      if (intersects) {                              // :49679-49689 盒接触：贴脸加速
        this.tileCollide = false;
        if (Math.abs(this.vx) + Math.abs(this.vy) < 8) { this.vx *= 1.1; this.vy *= 1.1; }
        const l = Math.hypot(this.vx, this.vy);
        if (l > 8) { this.vx *= 8 / l; this.vy *= 8 / l; }
      } else if (num5 > 150) {                       // :49690-49695 远档：Lerp 0.15 速 6
        const dx = (tgt.cx - this.cx) / num5, dy = (tgt.cy - this.cy) / num5;
        this.vx += (dx * 6 - this.vx) * 0.15;
        this.vy += (dy * 6 - this.vy) * 0.15;
      } else {                                       // :49696-49705 近身：sign 步进 0.35 钳 8
        this.tileCollide = false;
        const l = num5 || 1;
        this.vx += Math.sign((tgt.cx - this.cx) / l) * 0.35;
        this.vy += Math.sign((tgt.cy - this.cy) / l) * 0.35;
        const l2 = Math.hypot(this.vx, this.vy);
        if (l2 > 8) { this.vx *= 8 / l2; this.vy *= 8 / l2; }
      }
      // 分离力（:49706-49722,num6=0.025、num7=width×3=30——同主同型 position 曼哈顿）
      const num7 = this.w * 3;
      for (const ent of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
        const o = ent as MinionProj;
        if (!(o instanceof MinionProj) || o === this || o.dead || o.projId !== 759) continue;
        if (o.ownerRef() !== p) continue;
        if (Math.abs(this.x - o.x) + Math.abs(this.y - o.y) >= num7) continue;
        this.vx += this.x < o.x ? -0.025 : 0.025;    // :49709-49716
        this.vy += this.y < o.y ? -0.025 : 0.025;    // :49717-49721
      }
      this.rot = this.vx * 0.1;                      // :49723
      this.facing = this.vx > 0 ? 1 : -1;            // direction/spriteDirection :49724-49725
    } else {
      this.tileCollide = false;                      // :49728
      const g = this.tGroup(game, 759);              // AI_GetMyGroupIndexAndFillBlackList → localAI[0]=index（:49732-49735）
      const rrp = p.rotatedRelativePoint(p.mountedCenter.x, p.mountedCenter.y);
      const home = babyBirdHomeLocation(rrp.x, rrp.y, p.facing, g.index, p.gravDir ?? 1);
      const num8 = Math.hypot(home.x - this.cx, home.y - this.cy);
      // flag（:49741）= gravDir>0 ∧ fullRotation==0 ∧ headRotation==0（本仓后两位未建模=0）
      const flag = (p.gravDir ?? 1) > 0
        && ((p as unknown as { anchorFullRotation?: number }).anchorFullRotation ?? 0) === 0;
      if (num8 > 2000) {                             // :49747-49756 超远瞬移归位
        this.x = home.x - this.w / 2; this.y = home.y - this.h / 2;
        this.bbFrame = 4; this.vx = 0; this.vy = 0;
        this.facing = p.facing; this.rot = 0;
      } else if (num8 > 40) {                        // :49757-49799 归位飞行
        const num9 = 6 + num8 * 0.006;               // :49759
        const glv = getLerpValue(40, 800, num8);     // :49762 GetLerpValue(40,800,clamped)
        const mul = 1 + (5 - 1) * glv;               // Lerp(1,5,glv) :49763
        const dx = (home.x - this.cx) / num8, dy = (home.y - this.cy) / num8;
        this.vx += (dx * num9 * mul - this.vx) * 0.025;   // :49764 Lerp 0.025
        this.vy += (dy * num9 * mul - this.vy) * 0.025;
        const l = Math.hypot(this.vx, this.vy);
        if (l > num9) { this.vx *= num9 / l; this.vy *= num9 / l; }   // :49766-49768 钳 num9
        const num11 = this.w;                        // num10=0.05、num11=width（:49770-49771）
        for (const ent of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
          const o = ent as MinionProj;
          if (!(o instanceof MinionProj) || o === this || o.dead || o.projId !== 759) continue;
          if (o.ownerRef() !== p) continue;
          if (Math.abs(this.x - o.x) + Math.abs(this.y - o.y) >= num11) continue;
          this.vx += this.x < o.x ? -0.05 : 0.05;    // :49775-49790
          this.vy += this.y < o.y ? -0.05 : 0.05;
        }
        this.rot = this.vx * 0.04;                   // :49796
        this.facing = this.vx > 0 ? 1 : -1;          // :49797-49798
      } else if (num8 > 8 + Math.hypot(p.vx, p.vy)) {   // :49800-49813 近家步进（钳 num=6）
        const l = num8 || 1;
        this.vx += Math.sign((home.x - this.cx) / l) * 0.05;
        this.vy += Math.sign((home.y - this.cy) / l) * 0.05;
        const l2 = Math.hypot(this.vx, this.vy);
        if (l2 > 6) { this.vx *= 6 / l2; this.vy *= 6 / l2; }
        this.rot = this.vx * 0.1;                    // :49808
        this.facing = this.vx > 0 ? 1 : -1;          // :49809-49810
      } else if (flag) {                             // :49814-49823 肩头栖息
        this.x = home.x - this.w / 2; this.y = home.y - this.h / 2;
        this.bbFrame = 4; this.vx = 0; this.vy = 0;
        this.facing = p.facing; this.rot = 0;
      }
    }
    // ---- 位移（tileCollide 镜像;ignoreWater=true 无湿阻尼;碰墙=原版碰撞链缺省档
    // X×(−0.5)/Y×(−0.5)（:19826-19840 尾档）——本仓 moveAndCollide 停墙+速度反转折算）----
    // ★BJ672：弹面 flag6=TRUE（case 759 显式 :17693）→ 下落穿平台（原版雀宝宝
    //  穿平台归主;tileCollide 初值 true :4741 域无 false 行）。
    this.dropThrough = true;
    const lvx = this.vx, lvy = this.vy;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall && this.vx === lvx) this.vx = -lvx * 0.5;
    if (this.collideY && this.vy === lvy && lvy > 1) this.vy = -lvy * 0.5;
    // ★BJ698：759 伤害窗=飞行帧（0-3 循环,帧机 :49656-49663 `++frame>=projFrames-1→0`
    //  恒不停 4）；projPet 门 `(type != 759 || frame == Main.projFrames[type]-1)`
    //  （:12495,projFrames[759]=5 Main.cs:8645）⇒ 【唯栖息/瞬移拍 frame=4（:49753/:49823
    //  写位=bbFrame 通道）拒伤】,飞行/攻击/归位全放行（wiki 佐证：雀宝宝飞行撞敌造成
    //  接触伤害）。旧无条件=栖息拍多窗。
    if (this.bbFrame !== 4) this.contact(game, dmg0);   // localNPCHitCooldown=15（:7843-7844,CONTACT_CD_TABLE 759:15）
    this.recordGhostTrail();
  }

  /** ★BJ635（2026-10-11）③ 双子魔眼 387/388 专支 = AI_066 flag29 面（Projectile.cs
   *  :30084-30645）1:1 折算。普查定谳：此前无专支——追击=通用恒速 5（原版=距敌
   *  >200 阻尼逼近 (v×40+dir×spd)/41、387 速 6/388 速 14 :30351-30361;≤200 反推
   *  (v×40+dir×−4)/41 :30362-30368）;388 冲刺攻击态全缺（ai[0]=2 速 8+截击速度+
   *  40t 计时+2t 快帧循环 :30154-30178/:30495-30514）;387 激光=MINION_SHOOT 固定
   *  cd45（原版 ai[1] 随机游走 +rand(1,3)/t 上限 90 :30567-30583）;无 ai[0]=1 归位态
   *  leash（>800/交战 1200 → 归位速 15 阻尼 30、<150 落位回 0 :30374-30380/
   *  :30386-30400/:30403-30412）。常数（:30089-30092）：num526=2000/num527=800/
   *  num528=1200/num529=150。 */
  /** 分离环（AI_066 :30123-30146,num530=0.05）：双子 387/388 互对 ∪ 533 同型对,
   *  position 曼哈顿 < width 才推。★C16a-F5（2026-10-12）：原版此环位于 388 冲刺
   *  块（:30157-30178）【之前】,冲刺态每 AI 跑（extraUpdates=1→2 子步）照吃推离——
   *  冲刺 velocity 只在触发拍写死、态内不覆写,分离推力实时改写冲刺轨迹。旧实现
   *  冲刺早退在环前=双拉姆冲刺同轨互穿。 */
  private separationNudge(game: GameHooks, p: Player): void {
    for (const ent of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
      const o = ent as MinionProj;
      if (!(o instanceof MinionProj) || o === this || o.dead) continue;
      if (o.ownerRef() !== p) continue;
      const pair = this.projId === 387 || this.projId === 388
        ? o.projId === 387 || o.projId === 388
        : o.projId === this.projId;                  // flag30（:30128-30131）
      if (!pair) continue;
      if (Math.abs(this.x - o.x) + Math.abs(this.y - o.y) >= this.w) continue;
      this.vx += this.x < o.x ? -0.05 : 0.05;        // :30137-30144
      this.vy += this.y < o.y ? -0.05 : 0.05;
    }
  }

  private twinsStep(game: GameHooks, p: Player, tgt: EnemyLike | null, dmg0: number): void {
    const st = game.world.store;
    // ---- 388 冲刺态（:30154-30178,flag31——先于索敌/运动,态内不重扫）----
    if (this.projId === 388 && this.twA0 === 2) {
      // extraUpdates=1（:30156）→ 2 子步/拍;结束拍 numUpdates=0=余子步作废（break 即净语义）
      for (let sub = 0; sub < 2; sub++) {
        // ★C16a-F5：分离环先于冲刺块（原版位次 :30123-146 < :30157）——每 AI 跑
        //  （子步）照吃推离,rot 读分离后速度（:30158 在环后）
        this.separationNudge(game, p);
        this.twA1++;
        this.rot = Math.atan2(this.vy, this.vx) + Math.PI;   // :30158
        if (++this.twFc > 1) {                       // :30160-30166 2t 快帧循环 cap 2
          this.twFc = 0;
          this.twFrame = this.twFrame < 0 || this.twFrame > 2 ? 0 : this.twFrame + 1;
        }
        if (this.twA1 > 40) {                        // :30169-30174 40 子步结束回巡航
          this.twA1 = 1; this.twA0 = 0;
          break;
        }
        moveAndCollide(this, game.world, this.vx, this.vy);   // 子步位移（velocity 恒=触发拍截击速度）
        // ★BJ684（2026-10-15 用户实报「魔眼法杖的魔焰眼冲刺没有伤害」）：原版伤害
        //  走弹幕通用 Damage 面=UpdateProjectiles 每【子步】AI 后照跑（extraUpdates=1
        //  :30156 → 冲刺全程 40 子步持续接触结算;388 idStaticNPCHitCooldown=12 门控
        //  在 contactResolve 表内既有）——旧冲刺支循环尾 return 早退+零 contact 调用
        //  =冲刺全程零伤（巡航支尾 :4650 的 contact 到不了）。每子步一次=原版
        //  extraUpdates 双倍结算节奏。
        this.contact(game, dmg0);
      }
      return;   // flag31/numUpdates=0 → 本拍止于冲刺子步（常态帧通道下一拍清）
    }
    this.twFrame = -1;                               // 非冲刺拍清快帧通道（表帧接管）
    let num526 = 2000;                               // :30090（索敌检索半径,运行中=锁定距）
    let flag32 = false;
    let cx5 = 0, cy5 = 0, zx = 0, zy = 0;            // center5=锁定敌心;zero=敌速（:30286/:30288）
    if (tgt) {
      num526 = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
      cx5 = tgt.cx; cy5 = tgt.cy;
      flag32 = true;
      // 焦点支（:30328-30340）零速特典：focus 分支不写 zero（恒 (0,0)）——
      // 野生支 :30356 才写 nPC.velocity。focus 判定 = minionTargetId 同 id
      if ((p as unknown as { minionTargetId?: number }).minionTargetId !== tgt.id) {
        zx = (tgt as unknown as { vx?: number }).vx ?? 0;
        zy = (tgt as unknown as { vy?: number }).vy ?? 0;
      }
    }
    // ---- 分离力（:30117-30146,num530=0.05——双子对/533 对 position 曼哈顿 < width=40）----
    this.separationNudge(game, p);
    // ---- tileCollide 翻转（:30300-30310）+ 锁定/leash（:30363-30373）----
    if (this.twA0 !== 1) this.tileCollide = true;
    if (this.tileCollide && st.isSolid(Math.floor(this.cx / 16), Math.floor(this.cy / 16))) {
      this.tileCollide = false;                      // :30310-30313 中心格实心→免碰
    }
    // ★BJ671（2026-10-13 用户实报「激光眼不会自己下木平台」）：弹面 flag6 缺省
    //  true（Projectile.cs:17587 非宠物弹 fallThrough=true → TileCollision 调用
    //  (flag6,flag6) :17705-17721 = 平台永不承接）——387/388 不在覆写 switch
    //  :17670-17696（677-693/759/1020/500）且非 projPet → 交战态 tileCollide=true
    //  也照样【穿平台下落】。旧缺省=false=平台承接=卡平台。 WeaponProj 各支
    //  dropThrough:true 同先例（:1456 注 P.cs:17587 系）。
    this.dropThrough = true;
    const num542 = flag32 ? 1200 : 800;              // :30362-30364 num527/num528
    if (Math.hypot(p.cx - this.cx, p.cy - this.cy) > num542) {
      if (this.twA0 !== 1) this.twA0 = 1;            // :30366-30368 leash → 归位态
      this.tileCollide = false;
    }
    // ---- 逼近/悬停（:30374-30461）----
    if (flag32 && this.twA0 === 0) {                 // 交战逼近（:30374-30369）
      const dx = cx5 - this.cx, dy = cy5 - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      if (d > 200) {                                 // :30377-30385 速 6（388=14）阻尼 40
        const spd = this.projId === 388 ? 14 : 6;
        this.vx = (this.vx * 40 + nx * spd) / 41;
        this.vy = (this.vy * 40 + ny * spd) / 41;
      } else {                                       // :30386-30392 ≤200 反推 −4 同阻尼
        this.vx = (this.vx * 40 + nx * -4) / 41;
        this.vy = (this.vy * 40 + ny * -4) / 41;
      }
    } else {
      const flag33 = this.twA0 === 1;                // :30399-30401（387/388 归位态）
      let num546 = 6; let num547 = 40;
      if (flag33) num546 = 15;                       // :30407-30409
      const hx = p.cx - this.cx, hy = p.cy - this.cy - 60;   // vector42 = player.Center−Center+(0,−60)（:30403）
      const num548 = Math.hypot(hx, hy);
      if (num548 > 200 && num546 < 8) num546 = 8;    // :30420-30423
      const pv = Math.abs(p.vx) + Math.abs(p.vy);
      if (num546 < pv) {                             // :30424-30434 跟玩家速度链
        num547 = 30; num546 = pv;
        if (num548 > 200) { num547 = 20; num546 += 4; }
        else if (num548 > 100) { num546 += 3; }
      }
      if (flag33 && num548 > 300) { num546 += 6; num547 -= 10; }   // :30435-30438
      if (num548 < 150 && flag33 && !this.solidOverlap(st)) {
        this.twA0 = 0;                               // :30439-30446 落位回巡航
      }
      if (num548 > 2000) {                           // :30447-30451 瞬移回玩家
        this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2;
      }
      if (num548 > 70) {                             // :30452-30458 阻尼逼近
        const l = num548 || 1;
        this.vx = (this.vx * num547 + (hx / l) * num546) / (num547 + 1);
        this.vy = (this.vy * num547 + (hy / l) * num546) / (num547 + 1);
      } else if (this.vx === 0 && this.vy === 0) {   // :30459-30463 静置微漂
        this.vx = -0.15; this.vy = -0.05;
      }
      const vl = Math.hypot(this.vx, this.vy);
      if (vl > num546) { this.vx *= 0.95; this.vy *= 0.95; }   // :30464-30467
    }
    // ---- 旋转（:30468-30480）——MINION_ROT_ONLY 族（零 spriteDirection 写）----
    if (this.projId === 388) {
      this.rot = Math.atan2(this.vy, this.vx) + Math.PI;
    } else if (flag32 && this.twA0 !== 1) {
      this.rot = Math.atan2(cy5 - this.cy, cx5 - this.cx) + Math.PI;   // 387 交战朝敌
    } else {
      this.rot = Math.atan2(this.vy, this.vx) + Math.PI;
    }
    // ---- 冷却随机游走（:30568-30583）：ai[1]>0 → +rand(1,3);387>90/388>40 → 0 ----
    if (this.twA1 > 0) this.twA1 += 1 + Math.floor(Math.random() * 3);
    if (this.twA1 > 90 && this.projId === 387) this.twA1 = 0;
    if (this.twA1 > 40 && this.projId === 388) this.twA1 = 0;
    // ---- 攻击触发（:30587-30645,巡航态 ai[0]==0）----
    if (this.twA0 === 0) {
      if (this.projId === 387) {
        if (flag32 && this.twA1 === 0) {             // :30594-30613 激光眼 389
          this.twA1++;
          if (canHitLine(st, this.x, this.y, this.w, this.h, cx5, cy5, 0, 0)) {
            const dx = cx5 - this.cx, dy = cy5 - this.cy;
            const d = Math.hypot(dx, dy) || 1;
            // ★C16a-F1（2026-10-12）：出膛锚=NewProjectile 中心域（Projectile.cs:30601
            //  传 base.Center → :10880 position=Center−w/2）——389 盒 4×4（:4732-4743）
            //  → 左上=Center−2（旧 −5 写死=弹心偏 3px）
            const laser = new Arrow(this.cx - 2, this.cy - 2, dx / d * 8, dy / d * 8,
              Math.max(1, Math.trunc(dmg0 * 1.15)), 0, 389, { grav: 0, life: 300 });
            laser.whipTagShot = true;                // 389 ∈ MinionShot（ProjectileID.cs:291）
            (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(laser, 'projectiles');
          }
        }
      } else if (this.twA1 === 0 && flag32 && num526 < 500) {   // :30614-30630 388 冲刺触发
        this.twA1++;
        this.twA0 = 2;
        const dx = cx5 - this.cx, dy = cy5 - this.cy;
        let nx = dx, ny = dy;
        const dl = Math.hypot(dx, dy);
        if (dl > 0) { nx = dx / dl; ny = dy / dl; }
        else { const vl = Math.hypot(this.vx, this.vy) || 1; nx = this.vx / vl; ny = this.vy / vl; }   // SafeNormalize(velocity)
        this.vx = nx * 8; this.vy = ny * 8;
        this.ai066TryInterceptingTarget(cx5, cy5, zx, zy, 8, 388);   // :30625 截击速度覆写
      }
    }
    // ---- 帧机常态档由 MINION_FRAMES[387]/[388] 表（fc>3 → frame++ cap 2 :30587-30595）
    // ---- 位移 + 接触（tileCollide 翻转面同 759 注;idStatic 16/12 CONTACT_CD_TABLE 既有）----
    const lvx = this.vx, lvy = this.vy;
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (this.hitWall && this.vx === lvx) this.vx = -lvx * 0.5;
    if (this.collideY && this.vy === lvy && lvy > 1) this.vy = -lvy * 0.5;
    // ★BJ698：projPet 门逐型窗（:12495）——387 激光眼无 carve-out=【永不可伤】（本体
    //  仅 389 激光输出）;388 `(type != 388 || ai[0] != 2f)`=唯冲刺态可伤——本尾位仅在
    //  【触发拍】twA0 刚置 2 时放行（Damage() post-AI 读位同相,原版 :17184 子步内）,
    //  冲刺持续拍由上方子步环 :4533 承载,巡航/归位拍（twA0=0/1）拒。旧无条件=387 全态
    //  多窗+388 巡航/归位错窗。
    if (this.projId === 388 && this.twA0 === 2) this.contact(game, dmg0);
    this.recordGhostTrail();
  }

  /** AI_066_TryInterceptingTarget（Projectile.cs:43142-43180）1:1 折算——冲刺出膛的
   *  截击速度面：GetChaseResults(本体心, speed, 敌心, 敌速/num4) 交点时刻 ≤ num2+5
   *  → velocity = 截击速度（预判提前量）。num4=2（533/388 同档,num2 30/40）。
   *  原文 `for (num7=1; num7<=1.5; num7+=0.1)` 循环体内参数恒定 = 定点重试（首次
   *  命中即 break,等价单次）;`flag` 声明后零写位（:43150）→ ai[1] 补偿支 = 死码不落。 */
  private ai066TryInterceptingTarget(tpx: number, tpy: number, tvx: number, tvy: number,
    speed: number, kind: 533 | 388): void {
    const num2 = kind === 388 ? 40 : 30;             // :43144
    const num4 = 2;                                  // :43155-43161（533/388 同档）
    const num3 = num2 + 5;                           // :43145 window
    tvx /= num4; tvy /= num4;                        // :43163
    const chase = getChaseResults(this.cx, this.cy, speed, tpx, tpy, tvx, tvy);
    if (chase.intercepts && chase.time <= num3) {    // :43166-43168
      this.vx = chase.vx; this.vy = chase.vy;        // :43169 velocity = ChaserVelocity
    }
  }

  private terraprismaAI(game: GameHooks, p: Player, dmg0: number): void {
    // SetDefaults scale=0.75（:8932）→ 命中盒 (int)(10×0.75)=7（SetDefaults 尾段统一缩放）
    if (!this.tInit) { this.tInit = true; this.w = 7; this.h = 7; }
    const st = game.world.store;
    // >2000px 状态重置（:52516-52520 ai0=0/ai1=0——位置不瞬移,Idle SmoothStep 归位）
    if (Math.hypot(p.cx - this.cx, p.cy - this.cy) > 2000) { this.tA0 = 0; this.tA1 = 0; }
    const num = 40, num2 = 39, num3 = 80, num4 = 79, num5 = 41;
    const tgt = this.tA1 ? this.findEnemyById(game, this.tA1) : null;

    // ---- ai[0] == −1：归位（:52523-52534 MoveTowards 32 + AngleLerp 0.2）----
    if (this.tA0 === -1) {
      const g = this.tGroup(game);
      const [spot, irot] = this.tIdleSpot(game, p, g.index, g.total);
      this.vx = 0; this.vy = 0;
      const dx = spot.x - this.cx, dy = spot.y - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      const mv = Math.min(32, d);
      this.x += dx / d * mv;
      this.y += dy / d * mv;
      this.rot = angleLerp(this.rot, irot, 0.2);
      if (d < 2) this.tA0 = 0;
      this.tHitTick(game, p, dmg0);
      return;
    }
    // ---- ai[0] == 0：待机（:52535-52574 SmoothStep 0.45 + AngleLerp 0.45 + 1/20 起手）----
    if (this.tA0 === 0) {
      const g = this.tGroup(game);
      const [spot, irot] = this.tIdleSpot(game, p, g.index, g.total);
      this.vx = 0; this.vy = 0;
      const t = 0.45, s = t * t * (3 - 2 * t);   // Vector2.SmoothStep
      this.x += (spot.x - this.cx) * s;
      this.y += (spot.y - this.cy) * s;
      this.rot = angleLerp(this.rot, irot, 0.45);
      if (Math.floor(Math.random() * 20) === 0) {
        const en = this.tTarget(game, p.cx, p.cy);
        if (en) {
          this.tHit.clear();                       // AI_156_StartAttack = ResetLocalNPCHitImmunity
          this.tA0 = num3;                         // :52570-52571 rand 被 num3 覆写=恒 80
          this.tA1 = en.id;
        }
      }
      // ★BJ698：946 伤害窗=非待机——projPet 门 `(type != 946 || ai[0] == 0f)`（:12495）
      //  ⇒ 唯待机 ai[0]==0（AI_156_Think :52536）拒伤;攻击段（>0）/归位段（-1）放行
      //  （棱镜输出=挥砍期贴敌,待机悬停不伤）。旧待机拍 tHitTick=多窗。
      return;
    }
    // ---- 攻击（ai[0] > 0）：目标校验（:52648-52676）----
    if (!tgt || tgt.dead || !canBeChasedBy(tgt as never)) {
      const en = this.tTarget(game, p.cx, p.cy);
      if (en) {
        this.tA0 = Math.random() < 0.5 ? num : num3;   // 链式 NextFromList(40,80) :52666
        this.tA1 = en.id;
        this.tHit.clear();
      } else { this.tA0 = -1; this.tA1 = 0; }
      return;
    }
    // 相位判定（:52677-52687 预递减）：ai0≥41 → 跃空段(79→41);否则弧刀段(39→0)
    const preLeap = this.tA0 >= num5;
    const num15 = preLeap ? num4 : num2;
    const num16 = preLeap ? num5 : 0;
    this.tA0--;
    if (this.tA0 >= num15) {
      this.facing = this.cx < tgt.cx ? 1 : -1;         // :52682 direction
      if (this.tA0 === num15) { this.tSX = this.cx; this.tSY = this.cy; }  // :52684-52686 记起点
    }
    const lerp2 = clamp01((num15 - this.tA0) / (num15 - num16));   // GetLerpValue(num15,num16,ai0)
    if (!preLeap) {
      // ---- 弧刀段（:52689-52710 num14==0）：绕敌半圆弧 + 切向朝向 ----
      let vx0 = this.tSX, vy0 = this.tSY;
      if (lerp2 >= 0.5) {
        vx0 = tgt.cx + (p.cx - tgt.cx) * 0.5;          // 后半程枢轴=敌-玩家中点
        vy0 = tgt.cy + (p.cy - tgt.cy) * 0.5;
      }
      const num20 = Math.atan2(tgt.cy - vy0, tgt.cx - vx0);
      const num21 = this.facing === 1 ? -Math.PI : Math.PI;
      const num22 = num21 + (-num21) * lerp2 * 2;
      let spx = Math.cos(num22), spy = Math.sin(num22);
      spy *= 0.5;
      spy *= 0.8 + Math.sin(this.id * 2.3) * 0.2;      // IndexForVisuals 摆相(:52698-52699)
      const n20 = Math.atan2(spy, spx) + num20;        // .RotatedBy(num20)
      const rl = Math.hypot(spx, spy);
      spx = Math.cos(n20) * rl; spy = Math.sin(n20) * rl;
      const radius = Math.hypot(tgt.cx - vx0, tgt.cy - vy0) / 2;
      this.x = vx0 + (tgt.cx - vx0) * 0.5 + spx * radius - this.w / 2;
      this.y = vy0 + (tgt.cy - vy0) * 0.5 + spy * radius - this.h / 2;
      const num24 = wrapAngle(num20 + num22);
      this.rot = num24 + Math.PI / 2;
      this.vx = Math.cos(num24) * 10; this.vy = Math.sin(num24) * 10;
    } else {
      // ---- 跃空段（:52712-52727 num14==1）：升空→扑向敌并越过 ----
      let vx0 = this.tSX, vy0 = this.tSY;
      vx0 += 0;
      vy0 += clamp01(lerp2 / 0.4) * -100;              // GetLerpValue(0,0.4,lerp2)×−100
      const vx = tgt.cx - vx0, vy = tgt.cy - vy0;
      const vl = Math.hypot(vx, vy) || 1;
      const cl = Math.min(150, Math.max(60, vl));
      const ox = tgt.cx + vx / vl * cl, oy = tgt.cy + vy / vl * cl;
      const l3 = clamp01((lerp2 - 0.4) / 0.2);         // GetLerpValue(0.4,0.6,...)
      const l4 = clamp01((lerp2 - 0.6) / 0.4);         // GetLerpValue(0.6,1,...)
      const tRot = Math.atan2(vy, vx) + Math.PI / 2;
      this.rot = angleTowards(this.rot, tRot, Math.PI / 5);
      this.x = vx0 + (tgt.cx - vx0) * l3 - this.w / 2;
      this.y = vy0 + (tgt.cy - vy0) * l3 - this.h / 2;
      if (l4 > 0) { this.x = tgt.cx + (ox - tgt.cx) * l4 - this.w / 2; this.y = tgt.cy + (oy - tgt.cy) * l4 - this.h / 2; }
    }
    // ---- 体触伤害（Damage_PVE：10×10×0.75 盒,每轮每敌一次）----
    this.tHitTick(game, p, dmg0);
    // ---- 链式/收尾（:52729-52742 ai0==num16）----
    if (this.tA0 === num16) {
      const en = this.tTarget(game, p.cx, p.cy);
      if (en) {
        this.tA0 = Math.random() < 0.5 ? num : num3;
        this.tA1 = en.id;
        this.tHit.clear();
      } else { this.tA0 = -1; this.tA1 = 0; }
    }
  }

  /** 体触结算：攻击期盒相交 → hurt（每敌每轮一次,tHit 于 StartAttack 清） */
  private tHitTick(game: GameHooks, p: Player, dmg0: number): void {
    for (const [k, v] of this.tHit) {
      if (v <= 1) this.tHit.delete(k); else this.tHit.set(k, v - 1);
    }
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean; id: number };
      if (!en || en.dead || !canBeChasedBy(e)) continue;
      if (this.tHit.has(en.id)) continue;
      if (!(this.x < en.x + en.w && this.x + this.w > en.x && this.y < en.y + en.h && this.y + this.h > en.y)) continue;
      this.tHit.set(en.id, 60);
      // ★BJ684（2026-10-15）：结算体收编 ai156Strike（tag 链补课,见该函数注）
      this.ai156Strike(game, en, dmg0);
    }
    // ★清偿刀 Y2：城镇臂（946 体触走 Damage() 管线——CanDealDamage :12468 例外
    //  `(type!=946||ai[0]==0f)` → Damage_PVE_Inner 城镇同链;tHit 60t 每靶每轮一次,
    //  StartAttack 清）。★BJ703-D4（BJ684 登记债清偿,2026-10-21）：原版 voodoo 放行
    //  后 :12947 tag ModifyHit 城镇同跑——城镇臂 settle 收编 contactTown 同式全链
    //  （resolveWhipTagHit tag 乘区/TagCrit + 916 汇出 darkHarvestChain + kbDir/
    //  minionKB/穿甲两源 + crit 摘半防后重倍 + townAcceptLadder StatusNPC/命中视效/
    //  attackFlash）。暴露面=巫毒窄门（向导 267/裁缝 1307 装备态）放行拍,亲读
    //  :11970-11976/:12947 定谳非零——城镇 tag 面 1:1 补齐（敌怪臂已随 ai156Strike）。
    {
      const add946 = (e: unknown, b: string) =>
        (game as unknown as { entities: { add: (x: unknown, y: string) => void } }).entities.add(e, b);
      // ★黑收成 916 链电延迟汇出（同 contactTown :7681-7688 判例——OnHit :13711 在
      //  StrikeNPC 后,同步直调反序反噬主命中）
      let pendingDirect946: number[] | null = null;
      hitTownNpcs({ x: this.x, y: this.y, w: this.w, h: this.h }, game, dmg0, 0,
        'playerProj', this.projId, undefined, undefined,
        (n) => {
          if (!townVoodooGateOpen(game, n.vanillaId, this.projId)) return true;
          return this.tHit.has(n.id);   // 60t 局部表读门
        },
        (n) => {
          // ★Z1/D1② 城镇臂 ghostHeal 白耗/治疗面（:13877-84 城镇靶同面,946 体触）
          const preHits946 = this.pveNumHits;
          this.pveNumHits++;
          ghostHealProc(game, this.projId, preHits946,
            n as unknown as Parameters<typeof ghostHealProc>[3]);
          this.tHit.set(n.id, 60);   // 局部表占位（60t 每靶每轮一次;StartAttack 清）
          this.townAcceptLadder(game, n, true);   // usesLocal 清窗（:14175-14179）+StatusNPC+命中视效
          this.attackFlash = 24;
          if (pendingDirect946) {
            for (const d of pendingDirect946) {   // OnHit :13711 位（写梯后）——W5:916 链电
              darkHarvestChain(game, d, (n as TownNpcHitTarget).cx, (n as TownNpcHitTarget).cy, n.id);
            }
            pendingDirect946 = null;
          }
        },
        (n) => {
          const tn = n as TownNpcHitTarget;
          // ★BJ492①（2026-10-04）掷率收编单源（同敌怪臂;城镇靶 Damage_PVE_Inner 同链
          //  :12913-12943——类掷零 RNG+TimerCrit/武僧消费照达,消费位=巫毒窄门后/settle
          //  前=voodoo 门位同相,contactTown :5086-5087 同构）
          const direct946: number[] = [];
          tn.hurtFx = (d: number) => { direct946.push(d); };   // 916 汇出位
          const rollCrit = rollVanillaHitCrit(this.projId, game);
          const timerCrit = tryConsumeTimerCritOf(this.ownerRef(), game, tn.x, tn.y, tn.w, tn.h);
          const monkCrit = monkAuraForcedCrit(this.ownerRef(), this.projId);
          // ★BJ703-D4：tag 乘区+TagCrit+OnTaggedHit（:12947-12961 城镇同链;SUMMON_TAG_MUL
          //  无 946 表项=1,ProjectileID.cs:37 唯特例 864）
          const res = resolveWhipTagHit(tn as never as import('./WhipTag').WhipTagged, dmg0, game,
            (el) => add946(el, 'projectiles'), SUMMON_TAG_MUL[this.projId] ?? 1, tn.cx, tn.cy,
            this.ownerRef());
          pendingDirect946 = direct946;
          const golemCrit = rollGolemSentryCrit(game, this.projId, this.sentry);   // 946 非 sentry 恒假,形位对齐
          const owner0 = this.ownerRef() as unknown as
            { cx: number; equipStats?: { minionKB?: number; armorPen?: number }; buffs?: { minionKbBonus?: number } } | null;   // cx=Player 本有（kbDir :4970 读位,纯类型面窄化补声明）
          const mkb = (owner0?.equipStats?.minionKB ?? 0) + (owner0?.buffs?.minionKbBonus ?? 0);
          const pen0 = (owner0?.equipStats?.armorPen ?? 0)
            + (projectileData(this.projId)?.armorPenetration ?? 0);   // :13686-87 两源（同 ai156Strike）
          const kbDir = MINION_PLAYER_ANCHOR_KB.has(this.projId) && owner0
            ? (owner0.cx < tn.cx ? 1 : -1)
            : Math.sign(tn.cx - this.cx);   // 946 不在方向表族（:13652-13660）→ 随从→靶 sign
          const critTown = res.crit || rollCrit || timerCrit || monkCrit || golemCrit;
          return {
            // TownHitSettle crit=防后 ×2（NPC.cs:82067 原序,dmg 勿预倍）——res.crit 的
            // tag 掷率 ×2 已嵌 res.dmg → 摘半还原防后重倍（contactTown :7748-7753 同式）
            dmg: res.crit ? res.dmg / 2 : res.dmg,
            crit: critTown,
            flatPen: pen0,
            kb: kbDir * (this.knockback + mkb),   // 裸kb+minionKB（:52477-52482,同敌怪臂）
          };
        });
    }
  }

  /** AI_156_GetIdlePosition 946 支（:52551-52565）：肩上一字排开 + miscCounter 椭圆微摆 */
  private tIdleSpot(game: GameHooks, p: Player, index: number, total: number): [{ x: number; y: number }, number] {
    const num3 = index + 1;
    const dir = p.facing || 1;
    let irot = wrapAngle(num3 * Math.PI * 2 * (1 / 60) * dir + Math.PI / 2);
    const num4 = num3 % total;
    const misc = ((this.age % 3600) / 3600);
    const wob = Math.PI * 2 * (misc * (2 + num4) + num4 * 0.5 + dir * 1.3);
    // 微摆向量 = (0,0.5).RotatedBy(wob)×4 = (−sin(wob)×2, cos(wob)×2)
    const spot = {
      x: p.cx + Math.cos(irot) * 10 + dir * (num3 * -6 - 16) - Math.sin(wob) * 2,
      y: p.cy + Math.sin(irot) * 10 + p.gravDir * -15 + Math.cos(wob) * 2,
    };
    irot = wrapAngle(irot + Math.PI / 2);
    return [spot, irot];
  }

  private findEnemyById(game: GameHooks, id: number): EnemyLike | null {
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean; id: number };
      if (en && !en.dead && en.id === id) return en;
    }
    return null;
  }

  // ---- 血红蝙蝠杖 755（AI_156_BatOfLight 755 支 :52425-52647,与 946 同族）----
  // ★BJ684 常数勘误（反编译 :52494-52506 亲读）：AI_156_Think 头部 num=60/num2=59/
  //  num3=120/num4=119/num5=61 先算好,755 分支【只重赋 num=66 一行】——num2/num3/
  //  num4/num5 不变（946 分支才整组重算 40/39/80/79/41）。即 755：起手 ai[0]=66,
  //  减速门 ai[0]>=59（7 拍 vel×0.8）,弧冲程 lerp=GetLerpValue(59,0,ai[0])。旧注
  //  「num2=65/num3=126/num4=125/num5=67」系把 946 的「分支内重算」模式误植到 755
  //  （num3-5 在 755 攻击路径零消费,126/125/67 全为死值）。待机=头顶弧列
  //  (-UnitY.RotatedBy(4.398/total×(idx−mid))×40);攻击=减速段+绕敌半圆弧(枢轴后半程
  //  移玩家心,Y 摆相 Y×=sin(IndexForVisuals×2.3)×0.5 直接乘,无 946 的 0.8+0.2 底);
  //  链式失败回 ai0=0(无 −1 归位态,:52640-52647)
  private bA0 = 0;
  private bA1 = 0;
  private bSX = 0; bSY = 0;
  private bHit = new Map<number, number>();

  private batOfLightBody(game: GameHooks, p: Player, dmg0: number): void {
    // ★BJ684 常数对齐（:52494-52506,755 只重赋 num=66;num2 保持 59 非 65——
    //  减速段 66→59 共 7 拍,弧 lerp GetLerpValue(59,0,ai0)）
    const num = 66, num2 = 59;
    if (Math.hypot(p.cx - this.cx, p.cy - this.cy) > 2000) { this.bA0 = 0; this.bA1 = 0; }
    // ★BJ684（用户实报「贴图不对」副凶）：755 支每拍 spriteDirection =
    //  velocity.X≠0 ? sign(velocity.X) : player.direction（Projectile.cs:52446-52451,
    //  在帧推进后/AI_156_Think 前）——旧零写位=facing 恒 1 永朝右。MINION_NO_FLIP
    //  不含 755（draw 侧翻转面在位）,本位即唯一喂源。
    this.facing = this.vx !== 0 ? (this.vx > 0 ? 1 : -1) : p.facing;
    const tgt = this.bA1 ? this.findEnemyById(game, this.bA1) : null;
    // ★SW-BJ56 2026-09-10：755 顶格光照 = DelegateMethods.CastLightOpen（Projectile.cs:
    //  52440-52441 v3_1=AI_156_GetColor()=Crimson(220,20,60)→ToVector3 ≈(0.863,0.078,
    //  0.235);DelegateMethods.cs:729-747 开放格（非活动实心/无格）时 Lighting.AddLight
    //  单格施光）——本仓同族 946 支同调用但 v3_1=Transparent=零光（:52463-52465）,
    //  即棱镜原版无世界光照（其「光效」=不读格光的全亮绘制+拖尾,见 draw 946 专绘注）。
    //  开放格门以 !isSolid 近似（inActive/tileSolidTop 档本仓 store 侧无独立旗）。
    {
      const st = game.world.store;
      const tx = Math.floor(this.cx / 16), ty = Math.floor(this.cy / 16);
      if (tx >= 0 && ty >= 0 && tx < st.w && ty < st.h && !st.isSolid(tx, ty)) {
        game.addLightAt?.(this.cx, this.cy, 0.863, 0.078, 0.235);
      }
    }

    if (this.bA0 === 0) {
      // 待机（:52537-52548 flag 支）：头顶弧列 SmoothStep 0.45 + 1/20 起手
      // idleSpot = Center + (−UnitY).RotatedBy(θ)×40,θ=4.3982296/total×(idx−mid)
      // （(−UnitY).RotatedBy(θ) = (sinθ, −cosθ)——单只 θ=0 → 正上方 40px）
      const g = this.tGroup(game, 755);   // ★BJ684：pid=755（AI_GetMyGroupIndexAndFillBlackList 按型计数 :52538——旧缺省 946 恒空组 → fallback {0,1} → 全部蝙蝠 θ=0 叠同一待机点=用户实报「叠成一团」）
      const mid = (g.total - 1) / 2;
      const th = (4.3982296 / g.total) * (g.index - mid);
      const ix = p.cx + Math.sin(th) * 40;
      const iy = p.cy - Math.cos(th) * 40;
      this.vx = 0; this.vy = 0;
      const t = 0.45, s = t * t * (3 - 2 * t);
      this.x += (ix - this.cx) * s;
      this.y += (iy - this.cy) * s;
      // ★BJ684 注释勘误：原版 755 rotation 出生后【零写位】（待机/攻击段均不更新,
      //  :52556 AngleLerp 属 ai[0]==−1 归位分支,755 永不达）→ 恒 0。本行 rot 恒 0
      //  时为无操作,行为等价保留（若未来 rot 被外部扰动则按原版本相应为不回拉——
      //  此行即摘除面,现保留零差形）。
      this.rot = angleLerp(this.rot, 0, 0.2);
      if (Math.floor(Math.random() * 20) === 0) {
        const en = this.tTarget(game, p.cx, p.cy);
        if (en) { this.bHit.clear(); this.bA0 = num; this.bA1 = en.id; }
      }
      // ★BJ698：755 伤害窗=非待机——projPet 门 `(type != 755 || ai[0] == 0f)`（:12495）
      //  ⇒ 唯待机 ai[0]==0（AI_156_Think :52537）拒伤;攻击段（bA0>0）放行（血蝙蝠
      //  输出=扑咬轮,待机悬停不伤）。旧待机拍 bHitTick=多窗。946 同形（见上注）。
      return;
    }
    // 攻击（:52577-52647）
    if (!tgt || tgt.dead || !canBeChasedBy(tgt as never)) { this.bA0 = 0; this.bA1 = 0; return; }
    this.bA0--;
    if (this.bA0 >= num2) {
      // 减速段（:52590-52596）：velocity×0.8,至 59 记起点（66→59 共 7 拍）
      this.vx *= 0.8; this.vy *= 0.8;
      this.x += this.vx; this.y += this.vy;
      if (this.bA0 === num2) { this.bSX = this.cx; this.bSY = this.cy; }
      this.bHitTick(game, p, dmg0);
      return;
    }
    const lerpV = clamp01((num2 - this.bA0) / num2);   // GetLerpValue(59,0,ai0)（:52597 num2=59）
    let vx0 = this.bSX, vy0 = this.bSY;
    if (lerpV >= 0.5) { vx0 = p.cx; vy0 = p.cy; }      // 后半程枢轴=玩家心
    const num9 = Math.atan2(tgt.cy - vy0, tgt.cx - vx0);
    const num10 = tgt.cx > vx0 ? -Math.PI : Math.PI;
    const num11 = num10 + (-num10) * lerpV * 2;
    let spx = Math.cos(num11), spy = Math.sin(num11);
    spy *= Math.sin(this.id * 2.3) * 0.5;              // :52614 Y 摆相（无 0.8+0.2 底）
    const n20 = Math.atan2(spy, spx) + num9;
    const rl = Math.hypot(spx, spy);
    spx = Math.cos(n20) * rl; spy = Math.sin(n20) * rl;
    const radius = Math.hypot(tgt.cx - vx0, tgt.cy - vy0) / 2;
    this.x = vx0 + (tgt.cx - vx0) * 0.5 + spx * radius - this.w / 2;
    this.y = vy0 + (tgt.cy - vy0) * 0.5 + spy * radius - this.h / 2;
    const num24 = wrapAngle(num9 + num11);
    // ★755 攻击段不更新 rotation（:52615-52630 仅 Center/velocity——与 946 弧刀段
    //   rotation=num24+π/2 不同),rotation 保持待机值(0 附近)
    this.vx = Math.cos(num24) * 10; this.vy = Math.sin(num24) * 10;
    this.bHitTick(game, p, dmg0);
    if (this.bA0 === 0) {
      // 链式（:52640-52647）：有目标续攻,无则回待机（755 无 −1 归位态）
      const en = this.tTarget(game, p.cx, p.cy);
      if (en) { this.bA0 = num; this.bA1 = en.id; this.bHit.clear(); }
      else { this.bA1 = 0; }
    }
  }

  /** 755 体触结算（同 tHitTick,bHit 于起手/链式清;结算体=ai156Strike 共享） */
  private bHitTick(game: GameHooks, p: Player, dmg0: number): void {
    void p;
    for (const [k, v] of this.bHit) {
      if (v <= 1) this.bHit.delete(k); else this.bHit.set(k, v - 1);
    }
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean; id: number };
      if (!en || en.dead || !canBeChasedBy(e)) continue;
      if (this.bHit.has(en.id)) continue;
      if (!(this.x < en.x + en.w && this.x + this.w > en.x && this.y < en.y + en.h && this.y + this.h > en.y)) continue;
      this.bHit.set(en.id, 60);
      this.ai156Strike(game, en, dmg0);
    }
  }

  /** ★BJ684（2026-10-15 用户实报「血红法杖吃不到鞭标记的召唤标记伤害」）：
   *  AI_156 族（755 BatOfLight/946 EmpressBlade）体触单敌结算——旧 bHitTick/
   *  tHitTick 直 hurt【漏 tag 链】。原版 tag 伤在 Damage_PVE_Inner 集中施加
   *  （Projectile.cs:12947-12961 `num15 += (int)((num17+bonusTagDamage)×
   *  ProjectileID.Sets.SummonTagDamageMultiplier[type])`）对一切随从弹生效;
   *  本函数=contact() 通用链 :7370-7450 同式移植：
   *  · resolveWhipTagHit（tag 加伤/TagCrit 强制暴击/OnHit proc——黑收成 916 汇出
   *    hurtFx→darkHarvestChain 延迟落地,W5 反序判例同形）
   *  · 暴击源并链：rollVanillaHitCrit（BJ492① 收编,755/946 无三类旗恒假零 RNG）‖
   *    TimerCrit :12928‖武僧 :12929-43‖golemCrit 6176 背包（rollGolemSentryCrit,
   *    :12962-12965;755/946 非 sentry 恒假,形位对齐）——res.crit 的 ×2 已嵌
   *    res.dmg,他源强制时补一次 ×2（BJ453 并链归位式）
   *  · applyBannerDamageDealt（:13388-13390）/穿甲两源 pen0（玩家 AP+弹 AP
   *    :13686-87）/击退=裸 kb+minionKB（:52477-52482）方向=随从→敌 sign（755/946
   *    不在 MINION_PLAYER_ANCHOR_KB :13652-13660 switch 族）
   *  · 命中尾：ghostHeal（:13877-84）+pveNumHits（:14263）+noteVanillaProjImmune
   *    （localFace 观察面,localNPCHitCooldown=-1 写梯 :14175-14179 pierce=-3 清窗
   *    不开窗,BJ436 档）+applyProjStatus（StatusNPC :13634+6185）+
   *    emitSpawnHitVisuals（:13633 每靶一发）+attackFlash=24
   *  冷却域保持族私表（bHit/tHit 60t+StartAttack 清,=localNPCHitCooldown=-1 轮次
   *  免疫近似,既判例）,本函数只管单敌结算。
   *  SUMMON_TAG_MUL:755/946 均无表项=乘子 1（原版 CreateFloatSet(1f, 864f, 0.669f)
   *  唯一特例 864 Smolstar,ProjectileID.cs:37——亲读定谳,无漏表值）。 */
  private ai156Strike(game: GameHooks, en: EnemyLike & { dead: boolean; id: number }, dmg0: number): void {
    const add = (e: unknown, b: string) =>
      (game as unknown as { entities: { add: (x: unknown, y: string) => void } }).entities.add(e, b);
    const pendingDirect: number[] = [];
    (en as unknown as { hurtFx?: (d: number) => void }).hurtFx = (d: number) => { pendingDirect.push(d); };
    const rollCrit = rollVanillaHitCrit(this.projId, game);
    const timerCrit = tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);
    const monkCrit = monkAuraForcedCrit(this.ownerRef(), this.projId);
    const res = resolveWhipTagHit(en as never as import('./WhipTag').WhipTagged, dmg0, game,
      (el) => add(el, 'projectiles'), SUMMON_TAG_MUL[this.projId] ?? 1, en.cx, en.cy,
      this.ownerRef(), 0, this.projId);
    const golemCrit = rollGolemSentryCrit(game, this.projId, this.sentry);
    const owner0 = this.ownerRef();
    const o0 = owner0 as unknown as { equipStats?: { minionKB?: number; armorPen?: number }; buffs?: { minionKbBonus?: number } } | null;
    const mkb = (o0?.equipStats?.minionKB ?? 0) + (o0?.buffs?.minionKbBonus ?? 0);
    const pen0 = (o0?.equipStats?.armorPen ?? 0) + (projectileData(this.projId)?.armorPenetration ?? 0);
    const kbDir = MINION_PLAYER_ANCHOR_KB.has(this.projId) && owner0
      ? (owner0.cx < en.cx ? 1 : -1)
      : Math.sign(en.cx - this.cx);
    const mainGated = en.dead || (en as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true;
    const critHit = res.crit || rollCrit || timerCrit || monkCrit || golemCrit;
    // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970）——tag→golem→DV 原序;掷 res.dmg
    //  （tag 乘后基数;res.crit ×2 已嵌=边界舍入微差,登记债①）
    const dmgV156 = damageVarRoll(res.dmg, this.ownerRef()?.luck ?? 0);
    en.hurt?.(applyBannerDamageDealt(game, en, critHit && !res.crit ? dmgV156 * 2 : dmgV156),
      kbDir * (this.knockback + mkb), 0, game, pen0, critHit, -3, true);
    if (!mainGated) {
      ghostHealProc(game, this.projId, this.pveNumHits,
        en as unknown as Parameters<typeof ghostHealProc>[3]);
      this.pveNumHits++;   // :14263
      noteVanillaProjImmune(game, this.projId, en.id, { penetrate: -1, localFace: true });
      applyProjStatus(this.projId, en as unknown as Record<string, number>,
        { catalystBand: this.ownerRef()?.equipStats.catalystBand });
      this.emitSpawnHitVisuals(game);
      this.attackFlash = 24;
      // ★W5 :13711 位（主命中受理后落地,916 伤落其他敌/源敌永免 _DarkHarvest.cs:18）
      for (const d of pendingDirect) darkHarvestChain(game, d, en.cx, en.cy, en.id);
    }
  }

  private abigailBody(game: GameHooks, p: Player, dmg0: number): void {
    // ★清偿 C7/R2-F3（2026-10-14）：伤害源=highestAbigailCounterOriginalDamage——
    //  原版 AI_062 963 档 :66083 每拍 `originalDamage=玩家侧最高 970 计数器值`,
    //  live 伤 = (int)(originalDamage×minionDamage+5E-06f)（:16809-16813）。形参
    //  dmg0 由 963 自身 damage（=出生拍生成者快照）推导,后入高伤计数器不生效,
    //  退役——改每拍重收 max（abigailCounterOriginalDamage）。
    void dmg0;
    const dmgAbig = Math.max(1, truncCSf32MulBias(p.summonDamageMult, this.abigailCounterOriginalDamage(game)));
    const n = Math.max(1, this.peerCount(game, 970));
    const num2 = n - 1;
    // Main.hardMode（world.flags.hardMode；?. 防测试 mock 缺 flags）
    const num9 = game.world.flags?.hardMode === true ? 1.3 : 0.55; // :12119-12124
    const scale = 1 + num9 * num2;
    const num = 1.4;                                  // :66087
    const num3 = Math.max(4, 18 - num2 * 1.75);       // :66086
    const num4 = Math.max(5, 40 - num2 * 4);          // :66088
    const num5 = Math.min(1, 0.69 + num2 * 0.03);     // :66089
    // 索敌 700 + 视线门（:66330-66333 num12=700；:66435 963 走 Collision.CanHit 1×1）
    // ★BJ514：集火门距 = num12×3 = 2100（:66410 num18=num12×3,else 支 963 分档）
    const tgt = this.nearestEnemy(game, 700, 'point', 'self', 2100);
    // 归位门（:66446-66453）：num21=800 → 有目标 1000
    const num21 = tgt ? 1000 : 800;
    if (this.a62A0 !== 1 && Math.hypot(p.cx - this.cx, p.cy - this.cy) > num21) this.a62A0 = 1;
    if (this.a62A0 >= 2) {
      // 攻击闪（:66503-66528）
      if (this.a62A0 === 2) game.playSfxFiles(['abigail_attack'], 0.35, this.cx, this.cy); // :66505-66508
      this.a62A0++;
      if (!tgt) this.a62A0++;
      if (this.a62A0 > num4) {
        this.a62A0 = 0;
        if (tgt && Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy) < 50) this.a62A0 = 2; // :66522-66525
      }
      this.vx *= num5; this.vy *= num5;               // :66527
    } else if (tgt && this.a62A0 === 0) {
      // 交战（:66531-66637）
      const dx = tgt.cx - this.cx, dy = tgt.cy - this.cy;
      const num23 = Math.hypot(dx, dy) || 1;
      const nx = dx / num23, ny = dy / num23;
      if (num23 > 200) {
        const num27 = 6 + num2 * num;                 // :66618
        this.vx = (this.vx * (num3 * 2) + nx * num27) / (num3 * 2 + 1);   // :66620-66622
        this.vy = (this.vy * (num3 * 2) + ny * num27) / (num3 * 2 + 1);
      } else if (num23 < 50) {
        this.vx *= 0.5; this.vy *= 0.5;               // :66626-66630
        this.a62A0 = 2;
      } else {
        const num29 = 4 + num2 * num;                 // :66634
        this.vx = (this.vx * num3 + nx * num29) / (num3 + 1);             // :66636
        this.vy = (this.vy * num3 + ny * num29) / (num3 + 1);
      }
    } else {
      // 归位/跟随（:66679-66800 963 档：num32=6×0.8、锚=玩家心+(-40dir,40)）
      let num32 = 6 * 0.8;                            // :66686-66698
      const v2x = p.cx - this.cx - 40 * p.facing, v2y = p.cy - this.cy + 40; // :66705-66708
      const num35 = Math.hypot(v2x, v2y);
      if (num35 > 200 && num32 < 9) num32 = 9;        // :66727-66730
      if (num35 > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.w / 2; } // :66744-66748
      if (num35 > 10) {
        let eff = num32;
        if (num35 < 50) eff /= 2;                     // :66754-66757
        const l = num35 || 1;
        this.vx = (this.vx * 20 + (v2x / l) * eff) / 21;                  // :66759
        this.vy = (this.vy * 20 + (v2y / l) * eff) / 21;
      } else {
        this.vx *= 0.9; this.vy *= 0.9;               // :66763-66765
      }
    }
    // 朝向（:66947-66962）：vx 定向（:66947-66954 取反 + :66955-66957 ×-1 = sign(vx)），
    // 静止且无目标朝玩家（:66958-66961）
    if (this.vx > 0) this.facing = 1;
    else if (this.vx < 0) this.facing = -1;
    else if (!tgt) this.facing = p.cx > this.cx ? 1 : -1;
    // 哭声（:66494-66497 移动中 1/1500/t）
    if (Math.hypot(this.vx, this.vy) > 0.1 && Math.random() < 1 / 1500) {
      game.playSfxFiles(soundTrackFiles('abigail_cry'), 0.4, this.cx, this.cy);
    }
    this.x += this.vx;
    this.y += this.vy;
    this.contact(game, dmgAbig * scale, 20);
  }

  /** Collision.SolidCollision(position, width, height) 等价（盒覆盖格任一实心，
   *  Collision.cs SolidCollision） */
  private solidOverlap(st: { inBounds(x: number, y: number): boolean; isSolid(x: number, y: number): boolean }): boolean {
    const x0 = Math.floor(this.x / 16), x1 = Math.floor((this.x + this.w - 0.001) / 16);
    const y0 = Math.floor(this.y / 16), y1 = Math.floor((this.y + this.h - 0.001) / 16);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (st.inBounds(tx, ty) && st.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  /** AI_026 蜘蛛族专用跳梯（1458 Projectile.cs :63172-63290 终清波重锚）：
   *  · 前墙探测（flag5,:63172-63187）＝【单格】：中心列 ±intent + (int)vX、中心行，
   *    WorldGen.SolidTile ∧ !ClosedDoors（本仓门态无建模,登记）
   *  · 支承闸（:63208-63212）＝【单列底行】SolidTileAllowBottomSlope ∪ halfBrick ∪
   *    slope>0 ——此前实现整段缺席（onGround 直通梯档）
   *  · 梯档探测（try 块,:63222-63244）＝单列、行基准=【中腰行】num190=
   *    centerY/16 相对 −1/−2/−4/−5——旧实现误用脚下行作基准（h/2 系统差一格）
   *    且 Math.round(vx) 应为 (int) 截断。
   *  ★与 AI_067 三柱形【刻意不同构】：AI_026 原文即单柱（任务书"统一三柱"仅对
   *  AI_067 族成立,蜘蛛 390-392 归 AI_026 flag7 不入虎先例）。
   *  终零波 M6 复核（1458 :63178-63184/:63223-63244）：AI_026 的梯档在
   *  flag5 门下对【同一列】只做高度选择（−1/−2/−4/−5 行相对中腰）；三柱支承闸
   *  （num64 0..2 左缘/中心/右缘三点探测,:51526-51544）与家族墙意图档是 AI_067
   *  独有——蛙(758)/帕鲁(1093·1112·1118)/蘑菇(1022) 归 AI_067 故用三柱,维持现状。 */
  private walkerJumpIntent(st: import('../world/TileStore').TileStore,
    dirX: number): boolean {
    const col = Math.floor((this.x + this.w / 2) / 16) + dirX + Math.trunc(this.vx);
    const row = Math.floor((this.y + this.h / 2) / 16);
    return st.inBounds(col, row) && st.isSolid(col, row);
  }

  /** AI_026 落地梯档：支承闸单列底行 + 中腰行基准五档探测（见上注） */
  private walkerJumpLadder(st: import('../world/TileStore').TileStore, dirX: number): void {
    const supCol = Math.floor((this.x + this.w / 2) / 16);
    const botRow = Math.floor((this.y + this.h) / 16);
    if (st.inBounds(supCol, botRow)) {
      const idx = st.idx(supCol, botRow);
      const supported = st.isSolid(supCol, botRow)
        || st.half[idx] > 0 || st.slope[idx] > 0;
      if (!supported) return;                        // :63208-63212 支承闸不成立不跳
    }
    const col = Math.floor((this.x + this.w / 2) / 16) + dirX + Math.trunc(this.vx);
    const midRow = Math.floor((this.y + this.h / 2) / 16);
    const solid = (oy: number) => st.inBounds(col, midRow + oy) && st.isSolid(col, midRow + oy);
    if (!solid(-1) && !solid(-2)) this.vy = -5.1;
    else if (!solid(-2)) this.vy = -7.1;
    else if (solid(-5)) this.vy = -11.1;
    else if (solid(-4)) this.vy = -10.1;
    else this.vy = -9.1;
  }

  /** AI_062 射手族五型（373 黄蜂/375 小鬼/407 暴风雨/423 异星 UFO/613 星尘细胞）
   *  逐段 1:1（1457 Projectile.cs:66067-67166；1456 :62109-63206 同构,行差 +3958——
   *  2026-08-23 备案项①②③⑤，替代"悬停+5 速直冲"通用近似）：
   *  · 档位（:66069-66094）:num3=20/num4=40（423→5 :66091-66093）/num5=0.69
   *    （num/num2 计数档仅 963 非零,五型恒 0）
   *  · 423/613 冲刺期（:66155-66192/:66193-66281）＝extraUpdates 真子步循环
   *    （Update :16780-16783 `numUpdates = extraUpdates; while (numUpdates >= 0)`——
   *    每子步完整 AI/位移/命中）：触发拍 extraUpdates=(int)ai[1]（:66559/:66597）→
   *    次拍起 ai[1]+1 子步,每子步 ai[1]--/尘/tileCollide=false/位移 velocity(10px)/
   *    接触判定,ai[1] 归零子步重置（ai[1]=30/ai[0]=0/velocity/5/vy=0/extraUpdates=0
   *    :66174-66183/:66232-66247）并【继续】走完整 AI（原版不 return）;冲刺子步早退
   *    拍跳过索敌/分离/射击/姿态（:66170/:66208 return）。（曾折算 10px/t 摊 ai[1] 拍
   *    ——总位移同、峰值速/尘率/判定率不同,2026-08-23 退役）
   *  · 同类分离（:66290-66318）:±0.05/盒宽,407 加倍（:66292-66296 0.1/2×盒宽）
   *  · 归位门（:66446-66473）:num21=500→有目标 1000/423 1200/613 1350;距玩家超门 →
   *    ai[0]=1;407 tileCollide=false+实心 alpha（:66341-66360,本仓无通道,登记）
   *  · 攻击闪（:66503-66528）:ai[0]>=2 → ai[0]++（无目标再+1）>num4 归零,速度×num5
   *  · 交战运动（:66529-66678;flag5=407/423 恒入,余须 ai[0]==0）:
   *    423 冲刺门 :66534-66564（瞄准点=敌顶心-80px+实心下探,300<距≤800 且
   *    localAI[0]==0 → ai[0]=2/ai[1]=距/10/extraUpdates=ai[1]/velocity=向×10/
   *    localAI[0]=60 :66556-66562）
   *    613 冲刺门 :66565-66602（瞄准点=敌心+背向 60px+实心下探,400<距≤800 同式
   *    :66593-66600）
   *    407 :66603-66615（>400:向×3 lerp /21;≤400:×0.96——与下段叠用,远距实际 ×18）
   *    >200 通用加速 :66616-66623（向×6 lerp /41——num28=num3×2=40）
   *    ≤200 分型（:66624-66677）:423/613 70-130 悬停带（<100 反推 -3,|向x|>|向y|
   *    再 X /11 :66650-66653）、375 <150 反推（向×-4 lerp /41 :66660-66668）否则
   *    ×0.97、373（尾链,407 近距同达）vy>-1 → vy-=0.1 上浮（:66674-66677）
   *  · 归位运动（:66679-66826）:无视线到玩家 → ai[0]=1（:66681-66685）;
   *    num32=6→ai0=1 15/407 9（:66686-66694）;锚=玩家心+(0,-60)（407 再 +40 :66701）;
   *    375 编队位 :66709-66725（=玩家心-(10+40×群序)×dir,-10 且 ai[1]=80 压冷却）;
   *    提速 >200→9、423/407>300→12（:66727-66734）、375 ×0.75（:66735-66738）;
   *    <100 且 ai0=1 且悬空 → 脱困回 ai[0]=0（:66739-66743）;>2000 瞬移玩家心
   *    （:66744-66748,Y 同宽=原版字面）;375 lerp /21（<50 半速 :66749-66765）、
   *    407 ×(1.25,0.65) 椭圆趋近（:66767-66785）、余 lerp /21（:66786-66800）,
   *    近距漂移零速起转 ×1.01;423/407>250 玩家速度匹配 ±0.125/反向 ×0.95+钳 num32
   *    （:66801-66825）
   *  · 射击冷却 ai[1] 随机计数器（:66963-67044,备案项③）:373 +Next(1,4)=1..3/t
   *    阈 90（strongBees→70 旗标本仓无,登记）;375 +1（1/3 再+1）阈 90;
   *    407/423/613 +1（2/3 再+1）阈 50/45/60
   *  · 射击（:67045-67165）:!flag5 且 ai[0]≠0 不射（:67045-67048）;375 出手朝向按
   *    敌 X 反向（:67080-67090）;407 实心内不出手（:67091-67094）;423 扇区外先微调
   *    速度（:67097-67100）+门距≤400（:67101）;613 门距≤500+后坐 velocity-=向×速/3
   *    （:67116-67130）;373/375/407 无距门（:67152-67165）;出手 ai[1]++、
   *    timeLeft=300（433 不覆写→100）
   *  · 姿态（:66827 rotation=velocity.X×0.05 全型每拍终速写入;:66947-66954
   *    spriteDirection=-sign(vx)）——冲刺子步早退拍不更新=冻结在触发前值（触发拍
   *    :66562 return 同冻结）;渲染 rot+flip 复合见 draw（XNA 同 draw 调用）
   *  · 尘粒:423 冲刺每子步 ai[1]>3 → 1×dust 220/221（:66158-66166）;613 每子步
   *    ai[1]>3 → numUpdates<20 门 3×dust 229 + 2×环尘（:66198-66226）+归零拍 30×
   *    尘爆（:66249-66270）——本仓 spawnParticles 色彩近似、数量/节拍 1:1;
   *    375/407 待机尘 1/7、1/5 每拍（:66925-66932/:66934-66937）已接（R31 §A⑥,见
   *    ai62Step 尾部待机尘块）;
   *    407 alpha 渐变、帧表（MINION_FRAMES 已按 :66829-66946 表驱动）、
   *    375 攻击帧门改由 a62A1∈(0,24) 驱动（:66910-66913,见 draw） */
  private ai62Step(game: GameHooks, p: Player, dmg0: number, tgt: EnemyLike | null): void {
    const type = this.projId;
    const num4 = type === 423 ? 5 : 40;               // :66091-66093
    const num5 = 0.69;                                 // :66073
    const flag5 = type === 423 || type === 407;        // :66498-66502
    const st = game.world.store;
    // ---- 423/613 冲刺期（:66155-66192/:66193-66281）＝extraUpdates 真子步循环
    //      （Update :16780-16783 numUpdates 循环,每子步完整 AI/位移/命中）----
    let poseFrozen = false;   // 触发拍 return（:66562/:66600）——rotation/spriteDirection 冻结
    if (this.a62A0 === 2 && (type === 423 || type === 613)) {
      let dashEnd = false;
      // 子步数 = extraUpdates+1（:16780-16783）;归零子步把 extraUpdates/numUpdates
      // 清 0（:66178-66183/:66236-66247）→ 循环当拍终止（等价原版 while 出口）
      for (let u = 0; u <= this.a62EU; u++) {
        this.a62A1--;                                  // :66156/:66194
        // tileCollide=false（:66157/:66195）——本仓 AI_062 飞行族位移无 tile 碰撞,登记
        if (this.a62A1 > 3) {                          // :66158/:66198
          if (type === 423) {
            // 1×dust 220/221（:66159-66166）scale 0.5-0.8、velocity/2.5、noGravity/noLight
            game.spawnParticles(this.cx, this.cy, '#B080FF', 1, Math.hypot(this.vx, this.vy) / 2.5);
          } else {
            const numUpd = this.a62EU - u;             // numUpdates 镜像（环尘相位 :66213）
            if (numUpd < 20) {                         // :66199-66207 3×dust 229
              game.spawnParticles(this.cx, this.cy, '#7FE0FF', 3, 3);
            }
            // 2×环尘（:66208-66226）：UnitY.RotatedBy(numUpdates·π/30+whoAmI·π/4+π/2)
            // ×(height/2) − velocity·(j/2)
            for (let j = 0; j < 2; j++) {
              const ang = Math.PI / 2 + numUpd * (Math.PI / 30) + this.id * (Math.PI / 4);
              game.spawnParticles(this.cx - (this.vx * j) / 2,
                this.cy + Math.cos(ang) * (this.h / 2) - (this.vy * j) / 2, '#7FE0FF', 1, 1);
            }
          }
        }
        if (this.a62A1 !== 0) {
          this.x += this.vx; this.y += this.vy;        // 每子步位移（velocity=v×10 :66560/:66598）
          // ★BJ698：冲刺子步零接触——423/613 无 projPet carve-out（:12495）⇒ 本体
          //  永不可伤（613 另吃首行 :12463 双拒）;Damage() 子步内照跑（:17184）但门
          //  恒拒。旧每子步 contact=冲刺穿敌多窗（UFO 顶心-80 悬停/星尘细胞越敌 60px
          //  的位移面不变,仅摘伤害面）。
          continue;                                    // :66170/:66208 早退——跳过索敌/分离/射击/姿态
        }
        // 归零子步：重置（:66174-66183/:66232-66247）——原版不 return,继续走完整 AI
        this.a62A1 = 30; this.a62A0 = 0;
        this.vx /= 5; this.vy = 0;
        this.a62EU = 0;
        if (type === 613) {                            // :66249-66270 归零尘爆 15+15
          game.spawnParticles(this.cx - this.vx * 5, this.cy, '#7FE0FF', 15, 2);
          game.spawnParticles(this.cx, this.cy, '#7FE0FF', 15, 2);
        }
        dashEnd = true;
        break;
      }
      if (!dashEnd) return;   // 冲刺子步拍：AI 整段早退
      // 归零子步继续走下方完整 AI（分离/索敌/运动/射击/姿态——原版无 return）
    }
    {
      if (this.a62Lai0 > 0) this.a62Lai0--;            // :66282-66289 冲刺冷却
      // ---- 同类分离（:66290-66318）----
      {
        const sep = type === 407 ? 0.1 : 0.05;
        const sepR = type === 407 ? this.w * 2 : this.w;
        const pool = (game as unknown as { entities?: { projectiles?: unknown[] } }).entities?.projectiles;
        const projs = Array.isArray(pool) ? pool : [];
        for (const o of projs) {
          if (!(o instanceof MinionProj) || o === this || o.dead) continue;
          if (o.projId !== type || o.ownerRef() !== p) continue;
          if (Math.abs(this.x - o.x) + Math.abs(this.y - o.y) >= sepR) continue;
          this.vx += this.x < o.x ? -sep : sep;
          this.vy += this.y < o.y ? -sep : sep;
        }
      }
      // ---- 归位门（:66446-66473）----
      const num21 = !tgt ? 500 : type === 423 ? 1200 : type === 613 ? 1350 : 1000;
      if (this.a62A0 !== 1 && Math.hypot(p.cx - this.cx, p.cy - this.cy) > num21) this.a62A0 = 1;
      // ---- 攻击闪 / 交战 / 归位（:66503-66826）----
      if (this.a62A0 >= 2) {
        this.a62A0++;
        if (!tgt) this.a62A0++;
        if (this.a62A0 > num4) this.a62A0 = 0;         // :66518-66521
        this.vx *= num5; this.vy *= num5;              // :66527
      } else if (tgt && (flag5 || this.a62A0 === 0)) {
        // 交战（:66529-66678）。423 瞄准点 = 敌顶心（:66365-66368 vector2=(0.5,0)）
        let ax = tgt.cx, ay = type === 423 ? tgt.y : tgt.cy;
        let dx = ax - this.cx, dy = ay - this.cy;
        let num23 = Math.hypot(dx, dy);
        let nx = dx / (num23 || 1), ny = dy / (num23 || 1);
        if (type === 423 || type === 613) {
          // 冲刺瞄准点（:66534-66554/:66565-66592）：423=顶心-80px、613=敌心+背向 60px，
          // 落在实心则下探 +16/+32
          let tx: number, ty: number;
          if (type === 423) { tx = ax; ty = ay - 80; }
          else {
            let bx2 = this.cx - ax, by2 = this.cy - ay;
            const bl = Math.hypot(bx2, by2);
            if (bl === 0) { bx2 = 0; by2 = -1; } else { bx2 /= bl; by2 /= bl; }
            tx = ax + bx2 * 60; ty = ay + by2 * 60;
          }
          let row = Math.floor(ty / 16); if (row < 0) row = 0;
          if (st.inBounds(Math.floor(tx / 16), row) && st.isSolid(Math.floor(tx / 16), row)) {
            ty += 16;
            if (st.inBounds(Math.floor(tx / 16), Math.floor(ty / 16)) && st.isSolid(Math.floor(tx / 16), Math.floor(ty / 16))) ty += 16;
          }
          dx = tx - this.cx; dy = ty - this.cy;
          num23 = Math.hypot(dx, dy);
          nx = dx / (num23 || 1); ny = dy / (num23 || 1);
          const gateLo = type === 423 ? 300 : 400;     // :66555/:66593
          if (num23 > gateLo && num23 <= 800 && this.a62Lai0 === 0) {
            this.a62A0 = 2;
            this.a62A1 = Math.trunc(num23 / 10);       // :66558/:66596
            this.a62EU = this.a62A1;                   // extraUpdates=(int)ai[1]（:66559/:66597）
            this.vx = nx * 10; this.vy = ny * 10;      // :66560/:66598
            this.a62Lai0 = 60;                         // :66561/:66599
            poseFrozen = true;                         // :66562/:66600 return——姿态冻结
            tgt = null; // 冲刺拍不再走下方运动/射击（原版 return;位移在方法尾照走 1 次）
          }
        }
        if (tgt) {
          if (type === 407) {
            if (num23 > 400) {                         // :66603-66610
              // ★v 原地 ×3（num26=3 :66606-66607）——nx/ny 改写带入下方公共段,
              //  远距实际并入 ×18 向量（蓝队 R7-20：曾用 nx*3 做 lerp 未改 nx,
              //  公共段仍 ×6 → 远距咬合速度仅原版 1/3）
              nx *= 3; ny *= 3;
              this.vx = (this.vx * 20 + nx) / 21;
              this.vy = (this.vy * 20 + ny) / 21;
            } else {
              this.vx *= 0.96; this.vy *= 0.96;        // :66613
            }
          }
          if (num23 > 200) {
            // :66616-66623 通用加速（v 已被 407 ×3 → 407 远距实际 ×18）
            this.vx = (this.vx * 40 + nx * 6) / 41;
            this.vy = (this.vy * 40 + ny * 6) / 41;
          } else if (type === 423 || type === 613) {
            if (num23 > 70 && num23 < 130) {           // :66641-66654 悬停带
              const num30 = num23 < 100 ? -3 : 7;      // :66643-66647
              const vx8 = nx * num30, vy8 = ny * num30;
              this.vx = (this.vx * 20 + vx8) / 21;
              this.vy = (this.vy * 20 + vy8) / 21;
              if (Math.abs(vx8) > Math.abs(vy8)) this.vx = (this.vx * 10 + vx8) / 11; // :66650-66653
            } else {
              this.vx *= 0.97; this.vy *= 0.97;        // :66657
            }
          } else if (type === 375) {
            if (num23 < 150) {                         // :66662-66668 反推
              this.vx = (this.vx * 40 - nx * 4) / 41;
              this.vy = (this.vy * 40 - ny * 4) / 41;
            } else {
              this.vx *= 0.97; this.vy *= 0.97;        // :66671
            }
          } else if (this.vy > -1) {
            this.vy -= 0.1;                            // :66674-66677（373；407 近距同达）
          }
        }
      } else {
        // 归位/跟随（:66679-66826）
        if (this.a62A0 !== 1 && !canHit(st, this.cx, this.cy, 0, 0, p.cx, p.cy, 0, 0)) this.a62A0 = 1; // :66681-66685
        let num32 = 6;                                 // :66686
        if (this.a62A0 === 1) num32 = 15;              // :66687-66690
        if (type === 407) num32 = 9;                   // :66691-66694
        let v2x = p.cx - this.cx, v2y = p.cy - 60 - this.cy;   // :66700
        if (type === 407) v2y += 40;                   // :66701-66704
        if (type === 375) {
          this.a62A1 = 80;                             // :66710-66712 归位即压射击冷却
          v2x = p.cx - this.cx; v2y = p.cy - this.cy;
          const num33 = this.slot + 1;                 // :66714-66721 群序（slot≈minionPos,登记）
          v2x -= (10 + num33 * 40) * p.facing;
          v2y -= 10;
        }
        const num35 = Math.hypot(v2x, v2y);
        if (num35 > 200 && num32 < 9) num32 = 9;       // :66727-66730
        if (flag5 && num35 > 300 && num32 < 12) num32 = 12;   // :66731-66734
        if (type === 375) num32 = Math.trunc(num32 * 0.75);   // :66735-66738
        if (num35 < 100 && this.a62A0 === 1 && !this.solidOverlap(st)) this.a62A0 = 0;   // :66739-66743
        if (num35 > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.w / 2; }    // :66744-66748
        if (type === 375) {
          if (num35 > 10) {
            let eff = num32;
            if (num35 < 50) eff /= 2;                  // :66754-66757
            const l = num35 || 1;
            this.vx = (this.vx * 20 + (v2x / l) * eff) / 21;
            this.vy = (this.vy * 20 + (v2y / l) * eff) / 21;
          } else {
            // direction = player.direction（:66760 贴身档;下方姿态块 :66947 会在 vx≠0 时
            //  覆写 direction,故仅 vx==0 悬停肩上时可见——蓝队 R7-23 补）
            this.facing = p.facing;
            this.vx *= 0.9; this.vy *= 0.9;            // :66763-66765
          }
        } else if (type === 407) {
          if (Math.abs(v2x) > 40 || Math.abs(v2y) > 10) {     // :66769-66775
            const l = num35 || 1;
            this.vx = (this.vx * 20 + (v2x / l) * num32 * 1.25) / 21;
            this.vy = (this.vy * 20 + (v2y / l) * num32 * 0.65) / 21;
          } else {
            if (this.vx === 0 && this.vy === 0) { this.vx = -0.15; this.vy = -0.05; }  // :66778-66782
            this.vx *= 1.01; this.vy *= 1.01;          // :66783
          }
        } else if (num35 > 70) {                       // :66786-66791
          const l = num35 || 1;
          this.vx = (this.vx * 20 + (v2x / l) * num32) / 21;
          this.vy = (this.vy * 20 + (v2y / l) * num32) / 21;
        } else {
          if (this.vx === 0 && this.vy === 0) { this.vx = -0.15; this.vy = -0.05; }    // :66794-66798
          this.vx *= 1.01; this.vy *= 1.01;            // :66799
        }
        if (flag5 && num35 > 250) {
          // :66801-66825 玩家速度匹配
          const px = p.vx, py = p.vy;
          if ((this.vx < 0 && px >= 0) || (this.vx >= 0 && px < 0)) this.vx *= 0.95;
          else this.vx += px * 0.125;
          if ((this.vy < 0 && py >= 0) || (this.vy >= 0 && py < 0)) this.vy *= 0.95;
          else this.vy += py * 0.125;
          const sp = Math.hypot(this.vx, this.vy);
          if (sp > num32) { this.vx = this.vx / sp * num32; this.vy = this.vy / sp * num32; }  // :66821-66824
        }
      }
      // ---- 姿态（:66827 rotation=velocity.X×0.05 每拍终速写入 + :66947-66954
      //      velocity.X>0 → spriteDirection=-1,贴图朝左）——触发拍 return 冻结
      //      （poseFrozen）;渲染 rot+flip 复合见 draw（原版同 draw 调用叠用）----
      if (!poseFrozen) {
        this.rot = this.vx * 0.05;                   // :66827
        if (this.vx > 0) this.facing = -1;
        else if (this.vx < 0) this.facing = 1;
      }
      // ---- 射击冷却 ai[1] 随机计数器（:66963-67044）——触发拍 return 跳过
      //      （:66562,否则 423 档 ai[1]=距/10>45 会被本块立即清零=冲刺自灭）----
      if (!poseFrozen) {
      if (type === 373) {
        if (this.a62A1 > 0) this.a62A1 += 1 + Math.floor(Math.random() * 3);   // Next(1,4)=1..3
        if (this.a62A1 > 90) this.a62A1 = 0;         // :66969-66978（strongBees→70 未实装,登记）
      } else if (type === 375) {
        if (this.a62A1 > 0) {
          this.a62A1++;
          if (Math.floor(Math.random() * 3) === 0) this.a62A1++;             // :66985-66988
        }
        if (this.a62A1 > 90) this.a62A1 = 0;         // :66990-66994
      } else {
        const thr = type === 407 ? 50 : type === 423 ? 45 : 60;   // :67006/:67022/:67039
        if (this.a62A1 > 0) {
          this.a62A1++;
          if (Math.floor(Math.random() * 3) !== 0) this.a62A1++;             // :67001/:67017/:67034
        }
        if (this.a62A1 > thr) this.a62A1 = 0;
      }
      // ---- 射击（:67045-67165;!flag5 且 ai[0]≠0 不射 = :67045-67048）----
      if (tgt && (flag5 || this.a62A0 === 0)) {
        const shooter = MINION_SHOOT[type];
        if (shooter) {
          const ax = tgt.cx, ay = type === 423 ? tgt.y : tgt.cy;   // 423 瞄顶心（:66365-66368）
          if (type === 375) this.facing = ax - this.cx > 0 ? -1 : 1;   // :67080-67090 出手反向
          const dist = Math.hypot(ax - this.cx, ay - this.cy);
          let ok = true;
          if (type === 407 && this.solidOverlap(st)) ok = false;       // :67091-67094
          if (ok && type === 423) {
            // 扇区外微调（:67097-67100）+ 门距≤400（:67101）
            const rotTo = Math.atan2(ay - this.cy, ax - this.cx);
            if (Math.abs(rotTo - Math.PI / 2) > Math.PI / 4) {
              const vx9 = ax - this.cx, vy9 = ay - this.cy - 80;
              const l9 = Math.hypot(vx9, vy9) || 1;
              this.vx += vx9 / l9; this.vy += vy9 / l9;
            }
            if (dist > 400 || this.a62A1 !== 0) ok = false;
          } else if (ok && type === 613) {
            if (dist > 500 || this.a62A1 !== 0) ok = false;            // :67116
          } else if (ok && this.a62A1 !== 0) {
            ok = false;                                                // :67152
          }
          if (ok) {
            this.a62A1++;                                              // :67103/:67120/:67155
            const ps = projectileData(shooter.shot);
            const hw = (ps?.width ?? 10) / 2, hh = (ps?.height ?? 10) / 2;
            const dmg = Math.max(1, Math.round(dmg0));
            const l = dist || 1;
            const shot = new Arrow(this.cx - hw, this.cy - hh, (ax - this.cx) / l * shooter.speed,
              (ay - this.cy) / l * shooter.speed, dmg, this.knockback, shooter.shot,
              { grav: 0, life: shooter.life ?? 1200 });
            shot.whipTagShot = true;   // MinionShot 吃鞭 tag（ProjectileID.Sets.MinionShot）
            if (shooter.shot === 614) {
              // 614 星尘细胞弹 = aiStyle 113 TargetSticker（蓝队 R7-19）：NewProjectile
              // 第 11 参传目标索引 num13（:67122-67128）——硬追踪/失的即杀/183 buff 门
              shot.stickerTgt = tgt.id;
              shot.alpha = 255;        // SetDefaults alpha=255（:6619,AI −63/t 淡入 :41293）
            }
            if (type === 613) {        // :67129 后坐 velocity -= v4/3
              this.vx -= (ax - this.cx) / l * shooter.speed / 3;
              this.vy -= (ay - this.cy) / l * shooter.speed / 3;
            }
            (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(shot, 'projectiles');
            // 出膛音(MINION_SHOT_SFX 表:376→Item_20 等;ai62Step 接管后通用块不再走,
            //  曾漏接线=小鬼/黄蜂族出膛静音——sfx-wiring 抓出)
            const shotSfx = MINION_SHOT_SFX[shooter.shot];
            if (shotSfx) game.playSfxFiles?.(soundTrackFiles(shotSfx.track), shotSfx.vol, this.cx, this.cy);
          }
        }
      }
      } // !poseFrozen（冷却+射击段——触发拍 return 跳过 :66562）
      // ---- 待机尘（R31 §A⑥ P2,AI_062 :66903-66940——帧段每 update 跑,触发拍
      //  return 同样跳过）：375 小鬼 Next(7)==0 → d6 fire(scale2,v×0.3,noGravity,
      //  noLight);407 暴风雨 Next(5)==0 → d217(scale2,alpha100,v×0.3,noGravity,noLight)
      //  ——两杖的驻场识别色（MinionProj.ts:1328 旧登记"未折算"就此消账）----
      if (!poseFrozen) {
        if (type === 375 && Math.floor(Math.random() * 7) === 0) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 6, 0, 0, 0, null, 2);
          if (d) { d.vx *= 0.3; d.vy *= 0.3; d.noGravity = true; d.noLight = true; }
        } else if (type === 407 && Math.floor(Math.random() * 5) === 0) {
          const d = game.spawnDust?.(this.x, this.y, this.w, this.h, 217, 0, 0, 100, null, 2);
          if (d) { d.vx *= 0.3; d.vy *= 0.3; d.noGravity = true; d.noLight = true; }
        }
      }
    }
    this.x += this.vx;
    this.y += this.vy;
    // ★BJ698：AI_062 五射手接触窗逐型——373 黄蜂/375 小鬼/423 幡罗/613 星尘细胞均无
    //  projPet carve-out（:12495）⇒ 本体永不可伤（输出全在 374/376/433/614 弹上,
    //  613 另吃首行 :12463）;唯 407 暴风雨鲨卷 carve-out（`type != 407`）+ SetDefaults
    //  friendly=true（:4889）⇒ 尾位每拍接触。旧无条件=四型多窗。
    if (this.projId === 407) this.contact(game, dmg0);
  }

  /** 蜘蛛随从 390-392（AI_026 flag7 步行链 1:1，1457 Projectile.cs :61292-61344 归位门/
   *  :61389-61618 归位飞行/:62771-63020 索敌接敌/:63058-63340 步行物理/:65092-65261
   *  爬墙与帧；1456 :57334+ 同构,行差 +3958——2026-08-23 备案项②,替代"统一飞行"）：
   *  · 归位门（:61292-61330）:num92=500+40×slot（localAI[0]>0 再 +500+400 :61295-61306）;
   *    距玩家 >num92 或（|dy|>300 且 localAI[0]≤0）→ ai[0]=1;>2000 瞬移（:61315-61318）
   *  · 归位飞行（:61389-61618,ai[0]=1）:tileCollide=false（:61410,本仓 tileCollide 通道
   *    +直接位移等价）;加速 0.2/限速 10（:61390-61406 缺省档）;锚=玩家心-40dir（无目标
   *    再 -40slot×dir :61466-61490）;途中 700 曼哈顿内首只有视线敌 → 复战 ai[0]=0
   *    （:61418-61442）;<200 且主落地且悬空 → 落地 ai[0]=0（:61490-61497）
   *  · 索敌（:62784-62860）:曼哈顿距（随从基准）+盒 CanHit 视线;LOS 最近/无视线最近
   *    双轨;集火目标优先
   *  · tileCollide 动态门（:62843-62845/:62852-62860）:盒无实心 → true;LOS 目标在本体
   *    下方（敌 y > 本体底）且脚下行是平台 → false（穿平台下扑）——moveAndCollide 消费
   *  · 接敌（:62851-62952）:LOS 目标 → 敌盒外扩 10 相交 = 扑咬 velocity=(v×9+向14)/10
   *    +rotation 朝敌（:62900-62927）;同族 15px 内 ±0.5 分离（:62932-62952）
   *  · 撤退档（localAI[1],:62958-62963+:63003-63012）:命中置 20（StatusNPC :14027-14030）
   *    → 每拍递减;>0 拍 friendly=false（不咬,本仓=跳过 contact）+行走意图=当前速度向
   *    （vx<0 走左/vx>0 走右,穿过/脱离目标）
   *  · 行走意图（:62943-63018）:num180=500/地下 250（★台账批⑨ worldSurface 语义钉死:
   *    引擎 world.groundLevel = .wld 头段紧随 spawnX/spawnY 的第一个 f64 =
   *    Main.worldSurface 存档值,WorldFile.cs:2077 读序;Game.ts wiring.worldSurface =
   *    w.groundLevel 全仓恒等映射——两名字在此恒等互换,非近似）+40×slot;
   *    无视线最近 <num180 → 朝其 X 走（±5 死区 :62943-62957）;LOS 目标 <800+40×slot →
   *    接触窗+localAI[0]=60 续走（±10 死区 :62963-62975）+目标高出 100px 且 |dx|<50
   *    且贴地 → 跳 -10/-13/-15/-17/-18（:62968-62989）
   *  · 步行物理（:63058-63340）:加速度 0.4（:63096-63135 基 0.2,玩家更快 → 0.3,
   *    flag7 ×2 :63133-63135 → 0.4/0.6）;3.5 软顶（超出 ×0.25 档 :63137-63160）;
   *    遇障探测 → 落地跳梯（walkerJumpLadder）;重力 0.4 封顶 10（:65244-65247）;
   *    StepUp 坡步（:63261,moveAndCollide stepUp 通道）
   *  · 镜像（:63302-63323+:65162）:direction=sign(vx)（行走意图匹配且 |vx|>num184 →
   *    行走向精化 :63310-63315）→ spriteDirection=-direction（313 唯一豁免 :63316）
   *  · 爬墙态（:65091-65161）:中心竖列 3 格 ≥2 有墙 → 墙面爬行（速 9 lerp /10 朝
   *    玩家[锚 40×(slot+1)]/目标[锚 10],rotation=运动向+π/2,帧 4-7,无重力;
   *    远锚拍 spriteDirection=+direction :65135）
   *  · 帧通道 spFrame:0-2 走（fc+=|vx|>8 翻页 :65219-65230）/3 空（:65241-65243）/
   *    4-7 爬（:65136-65147）
   *  · 帧 dust:【查无】——flag7 帧/爬墙全段 :65091-65261 零 Dust.NewDust/Gore 调用
   *    （AI_026 行走尘块均属 268/269/956 等他型分支）,2026-08-23 登记撤销（补尘=造行为） */
  private spiderStep(game: GameHooks, p: Player, dmg0: number): void {
    const st = game.world.store;
    this.stepUp = true;   // Collision.StepUp（:63261）
    const minionPos = this.slot;
    // ---- 归位门（:61292-61330,每拍先于状态分流）----
    let num92 = 500 + 40 * minionPos;
    if (this.spLai0 > 0) num92 += 500 + 400;         // :61295-61306（flag7 +500+400）
    const dpx = p.cx - this.cx, dpy = p.cy - this.cy;
    const dP = Math.hypot(dpx, dpy);
    if (dP > 2000) {                                  // :61315-61318
      this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; this.vx = this.vy = 0;
    } else if (dP > num92 || (Math.abs(dpy) > 300 && this.spLai0 <= 0)) {
      if (dpy > 0 && this.vy < 0) this.vy = 0;        // :61322-61330
      if (dpy < 0 && this.vy > 0) this.vy = 0;
      this.spA0 = 1;
    }
    if (this.spLai0 > 0) this.spLai0--;               // :62775-62779
    if (this.spA0 === 1) {
      // ---- 归位飞行（:61389-61618）----
      this.tileCollide = false;                       // :61410
      // 途中复战扫描（:61418-61442）：700 曼哈顿内首只（非最近）——flag20=仅距离入
      // 池、num105=有视线才复战 ai[0]=0
      let any700 = false, los700 = false;
      for (const e of game.enemies()) {
        const en = e as EnemyLike;
        if (!canBeChasedBy(e)) continue;
        if (Math.abs(p.cx - en.cx) + Math.abs(p.cy - en.cy) >= 700) continue;
        if (canHit(st, this.x, this.y, this.w, this.h, en.x, en.y, en.w, en.h)) los700 = true;
        any700 = true;
        break;                                        // 原版首只即 break（:61437-61439）
      }
      if (los700) { this.spA0 = 0; }                  // :61442-61444
      else {
        let ax = p.cx - 40 * p.facing;                // :61466-61468
        if (!any700) ax -= 40 * minionPos * p.facing; // :61438-61440
        const ay = p.cy;
        let dx = ax - this.cx, dy = ay - this.cy;
        const num110 = Math.hypot(dx, dy);
        if (num110 < 200 && p.vy === 0 && this.y + this.h <= p.y + p.h && !this.solidOverlap(st)) {
          this.spA0 = 0;                              // :61490-61497 落地
          if (this.vy < -6) this.vy = -6;
        } else {
          if (num110 < 60) { dx = this.vx; dy = this.vy; }   // :61498-61500
          else {
            const k = 10 / (num110 || 1);             // :61503-61505 num112=10
            dx *= k; dy *= k;
          }
          // 加速 0.2 逼近（:61579-61618 缺省档 num101=0.2,越零 ×1.5 补）
          if (this.vx < dx) { this.vx += 0.2; if (this.vx < 0) this.vx += 0.3; }
          if (this.vx > dx) { this.vx -= 0.2; if (this.vx > 0) this.vx -= 0.3; }
          if (this.vy < dy) { this.vy += 0.2; if (this.vy < 0) this.vy += 0.3; }
          if (this.vy > dy) { this.vy -= 0.2; if (this.vy > 0) this.vy -= 0.3; }
          // 飞行朝向（:61626-61633）：|vx|>0.5 → spriteDirection=-sign(vx)
          if (this.vx > 0.5) this.facing = -1;
          else if (this.vx < -0.5) this.facing = 1;
          this.x += this.vx; this.y += this.vy;       // tileCollide=false（:61410）直写位移——
          //  位移阻尼不适用（tileCollide=false → 湿阻尼块 :17721 不跑,velocity 全量）
        }
      }
      // ★BJ698：归位飞行接触=残留 friendly 承袭（AI_026 蜘蛛块 :62963-63017 仅地面态
      //  写;ai[0]==1 段零写位=Projectile.friendly 保持上地面拍值——交战中离场飞回穿敌
      //  照伤;旧零 contact=缺窗）。
      if (this.spFriendly) this.contact(game, dmg0);
      return;
    }
    // ---- 地面作战（ai[0]=0）----
    // 撤退档计时（localAI[1],:62958-62963）：>0 → 本拍撤退（friendly=false+沿速度向续走）
    let retreat = false;
    if (this.spLai1 > 0) { retreat = true; this.spLai1--; }
    // 索敌（:62784-62860 曼哈顿 + 盒视线双轨；集火目标 :62792-62812 作种子先行）
    let losT: EnemyLike | null = null, losD = 100000;
    let anyT: EnemyLike | null = null, anyD = 100000;
    const focus = (p as unknown as { minionTargetId?: number }).minionTargetId ?? -1;
    if (focus >= 0) {
      for (const e of game.enemies()) {
        const en = e as EnemyLike;
        if (en.dead || en.id !== focus) continue;
        // CanBeChasedBy 门（:62793/:58832-58833 原文——门在距离求值前,ownerMinion
        //  AttackTargetNPC2.CanBeChasedBy(this)）——门败=种子整块跳过（anyT/losT
        //  不落种,num169=−1）→ 野生扫无种子照跑（2026-09-08 收口,同件 2 口径）
        if (!canBeChasedBy(e)) break;
        const d = Math.abs(this.cx - en.cx) + Math.abs(this.cy - en.cy);
        anyD = d; anyT = en;                          // :62797-62803 种子
        if (canHit(st, this.x, this.y, this.w, this.h, en.x, en.y, en.w, en.h)) { losD = d; losT = en; }
        break;
      }
    }
    for (const e of game.enemies()) {
      const en = e as EnemyLike;
      if (!canBeChasedBy(e)) continue;
      const d = Math.abs(this.cx - en.cx) + Math.abs(this.cy - en.cy);
      if (d < anyD) { anyD = d; anyT = en; }          // :62814-62860（LOS 候选可覆写种子）
      if (d < losD && canHit(st, this.x, this.y, this.w, this.h, en.x, en.y, en.w, en.h)) {
        losD = d; losT = en;
      }
    }
    // ★BJ698：friendly 镜像（原版 :62963-63017——`num169>=0 ∧ num167<800+num163` 置真,
    //  撤退 flag25 置假,无 LOS 目标置假;num163=40×minionPos=本仓 slot 既有近似）。
    //  归位段（上方 ai[0]==1 支）不重写=残留承袭。
    this.spFriendly = !retreat && losT !== null && losD < 800 + 40 * minionPos;
    // tileCollide 动态门（:62843-62845 盒无实心才回 true——嵌实心保持原值;
    // :62852-62860 LOS 目标在本体下方且脚下行是平台 → false 穿平台下扑）
    // ——moveAndCollide 消费
    if (!this.solidOverlap(st)) this.tileCollide = true;
    if (losT && losT.y > this.y + this.h) {
      const pcol = Math.floor(this.cx / 16), prow = Math.floor((this.y + this.h + 1) / 16);
      if (st.inBounds(pcol, prow) && st.isPlatform(pcol, prow)) this.tileCollide = false;
    }
    // 扑咬 + 同族分离（:62851-62952）
    if (losT) {
      const pad = 10;
      if (this.x < losT.x + losT.w + pad && this.x + this.w > losT.x - pad
        && this.y < losT.y + losT.h + pad && this.y + this.h > losT.y - pad) {
        let vx9 = losT.cx - this.cx, vy9 = losT.cy - this.cy;
        if (this.vy > 0 && vy9 < 0) this.vy *= 0.5;   // :62905-62912 相向减速
        if (this.vy < 0 && vy9 > 0) this.vy *= 0.5;
        if (this.vx > 0 && vx9 < 0) this.vx *= 0.5;
        if (this.vx < 0 && vx9 > 0) this.vx *= 0.5;
        const l9 = Math.hypot(vx9, vy9);
        if (l9 > 14) { vx9 = vx9 / l9 * 14; vy9 = vy9 / l9 * 14; }   // :62923-62925
        this.rot = (this.rot * 5 + Math.atan2(vy9, vx9) + Math.PI / 2) / 6;  // :62926
        this.vx = (this.vx * 9 + vx9) / 10;           // :62927
        this.vy = (this.vy * 9 + vy9) / 10;
        const pool = (game as unknown as { entities?: { projectiles?: unknown[] } }).entities?.projectiles;
        const projs = Array.isArray(pool) ? pool : [];
        for (const o of projs) {                       // :62932-62952 同族分离
          if (!(o instanceof MinionProj) || o === this || o.dead) continue;
          if (o.projId < 390 || o.projId > 392 || o.ownerRef() !== p) continue;
          if (Math.hypot(o.cx - this.cx, o.cy - this.cy) >= 15) continue;
          const push = 0.5;
          if (this.cy > o.cy) { o.vy -= push; this.vy += push; } else { o.vy += push; this.vy -= push; }
          if (this.cx > o.cx) { this.vx += push; o.vx -= push; } else { this.vx -= push; o.vx += push; }
        }
      }
    }
    // 行走意图（:62943-63018）
    let flag2 = false, flag3 = false;
    const walkT = losT ?? anyT;
    if (walkT) {
      // 台账批⑨：groundLevel ≡ 存档 Main.worldSurface（WorldFile.cs:2077 读序钉死,
      // Game wiring.worldSurface = w.groundLevel 恒等映射）——非近似,见类头注
      const underground = game.world.groundLevel > 0 && this.y > game.world.groundLevel * 16;  // :62931-62939
      const gate = losT ? 800 + 40 * minionPos : (underground ? 250 : 500) + 40 * minionPos;
      const distT = losT ? losD : anyD;
      if (distT < gate) {
        const dxT = walkT.cx - (this.x + this.w / 2);
        if (dxT < -(losT ? 10 : 5)) { flag2 = true; flag3 = false; }
        else if (dxT > (losT ? 10 : 5)) { flag3 = true; flag2 = false; }
        if (losT) {
          this.spLai0 = 60;                           // :62964 localAI[0]=num164
          // 目标高出 100px（num166=敌顶 < 心-100）且 |dx|<50 且贴地 → 跳距表（:62968-62989）
          if (walkT.y < this.cy - 100 && Math.abs(dxT) < 50 && this.vy === 0) {
            const h = Math.abs(walkT.y - this.cy);
            this.vy = h < 120 ? -10 : h < 210 ? -13 : h < 270 ? -15 : h < 310 ? -17 : h < 380 ? -18 : this.vy;
          }
          // 撤退档（:63003-63012）：friendly=false（本仓=跳过 contact,见尾）+
          // 行走意图 = 当前速度向（vx<0 走左/vx>0 走右——穿过/脱离目标）
          if (retreat) {
            if (this.vx < 0) { flag2 = true; flag3 = false; }
            else if (this.vx > 0) { flag3 = true; flag2 = false; }
          }
        }
      }
    } else {
      // 跟随玩家（:59931-59945 悬移偏移）
      const off = 40 * (minionPos + 1) * p.facing;
      if (p.cx < this.cx - 10 + off) { flag2 = true; flag3 = false; }
      else if (p.cx > this.cx + 10 + off) { flag3 = true; flag2 = false; }
    }
    // 爬墙态（:65092-65175）：中心竖列 3 格 ≥2 有墙 → 墙面爬行（无重力）
    const cc = Math.floor(this.cx / 16), cr = Math.floor(this.cy / 16);
    let walls = 0;
    for (let oy = -1; oy <= 1; oy++) {
      if (st.inBounds(cc, cr + oy) && st.wall[st.idx(cc, cr + oy)] > 0) walls++;
    }
    if (walls > 1) {
      const toT = losT ? Math.hypot(losT.cx - this.cx, losT.cy - this.cy) : 0;
      let vx10 = p.cx - this.cx, vy10 = p.cy - this.cy;
      let anchor = 40 * (minionPos + 1);
      if (losT && toT > 0) { vx10 = losT.cx - this.cx; vy10 = losT.cy - this.cy; anchor = 10; }  // :65107-65110
      const dl = Math.hypot(vx10, vy10) || 1;
      if (dl < anchor) {                              // :65112-65118
        this.vx *= 0.9;
        if (Math.abs(this.vx) + Math.abs(this.vy) < 0.1) { this.vx = 0; this.vy = 0; }
      } else if (dl < 800 || !losT) {
        this.vx = (this.vx * 9 + vx10 / dl * 9) / 10; // :65119 num233=9
        this.vy = (this.vy * 9 + vy10 / dl * 9) / 10;
      }
      // 镜像（:63302-63308 direction=sign(vx) 先行,爬墙段 :65135 远锚拍
      // spriteDirection=+direction;近锚拍保持前值）
      if (this.vx < 0) this.spDir = -1;
      else if (this.vx > 0) this.spDir = 1;
      if (dl >= anchor) {
        this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;   // :65136
        this.facing = this.spDir;                                // :65135（+direction,非取反）
      } else this.rot = Math.atan2(vy10, vx10) + Math.PI / 2;
      this.spFrame = 4 + Math.floor(this.age / 2) % 4;   // :65136-65147 帧 4-7
      // 原版爬墙段只写 velocity（:65112-65119）,位移走 HandleMovement（蜘蛛
      //  tileCollide=true 缺省,湿支照跑）→ 本仓直写位乘湿阻尼档,同相
      const dfSpiderWall = projWaterDragFactor(this);
      this.x += this.vx * dfSpiderWall; this.y += this.vy * dfSpiderWall;
      // 撤退拍 friendly=false（:63004）不咬;★BJ698 无 LOS 目标拍亦 friendly=false
      //  （:63015-63017）不咬——spFriendly 镜像承载;命中置撤退计时（StatusNPC :14027-14030）
      if (this.spFriendly && this.contact(game, dmg0)) this.spLai1 = 20;   // 台账批③：蜘蛛族 idStatic 15（CONTACT_CD_TABLE :4754）
      return;
    }
    // 步行物理（:63058-63340）
    this.rot = 0;                                     // :65160（!flag24 拍）
    let num184 = 0.2 * 2;                             // :63096-63132 基 0.2 ×flag7 双倍（:63133-63135）
    let num185 = 6;
    if (num185 < Math.abs(p.vx) + Math.abs(p.vy)) { num185 = Math.abs(p.vx) + Math.abs(p.vy); num184 = 0.3 * 2; }  // :63101-63104 → :63133 ×2=0.6
    let jump = false;
    if (flag2 || flag3) {
      const dirX = flag2 ? -1 : 1;
      if (dirX < 0) { this.vx = this.vx > -3.5 ? this.vx - num184 : this.vx - num184 * 0.25; }   // :63137-63146
      else { this.vx = this.vx < 3.5 ? this.vx + num184 : this.vx + num184 * 0.25; }
      jump = this.walkerJumpIntent(st, dirX);         // :63175-63198 遇障探测
    } else {
      this.vx *= 0.9;                                 // :63147-63156
      if (this.vx >= -num184 && this.vx <= num184) this.vx = 0;
    }
    this.vx = Math.max(-num185, Math.min(num185, this.vx));   // :63300-63304
    // 镜像（:63302-63323）：direction=sign(vx),行走意图匹配且 |vx|>num184 → 行走向
    // 精化;spriteDirection = -direction（:65162 flag7 专属赋值同式）
    if (this.vx < 0) this.spDir = -1;
    else if (this.vx > 0) this.spDir = 1;
    if (this.vx > num184 && flag3) this.spDir = 1;
    if (this.vx < -num184 && flag2) this.spDir = -1;
    this.facing = -this.spDir;
    this.vy = Math.min(this.vy + 0.4, 10);            // :65244-65247
    // ★BJ673 勘误（红蓝 R3-F#2 翻案 BJ672）：390-392 在 Main.projPet（Main.cs:8907-
    //  8909）→ 弹面 flag6=projPet −12 门（承接,玩家在下方才穿）;aiStyle 26 无后置
    //  覆写。原版蜘蛛=双机制：①projPet 面站平台行走;②flag7 专属「LOS 目标在本体
    //  下方且脚下行是平台→tileCollide=false 穿台下扑」（:62852-62863,本仓 :5570-
    //  5572 已 1:1）——恒穿使①永不成立、②冗余死效。
    this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    // ★水中位移阻尼（:17721 湿支;蜘蛛 tileCollide 动态门 :62843-62845,真拍走湿支）
    const dfSpiderWalk = projWaterDragFactor(this);
    moveAndCollide(this, game.world, this.vx * dfSpiderWalk, this.vy * dfSpiderWalk);
    if (this.onGround && jump && (flag2 || flag3)) {
      this.walkerJumpLadder(st, flag2 ? -1 : 1);      // :63220-63290
    }
    // 帧通道（:65199-65243）：空 3 / 走 0-2（fc+=|vx|>8 翻页）/ 立 0
    if (!this.onGround) this.spFrame = 3;
    else if (Math.abs(this.vx) > 0.8) this.spFrame = Math.floor(this.age / 2) % 3;
    else this.spFrame = 0;
    // 撤退拍 friendly=false（:63004）不咬;★BJ698 无 LOS 目标拍亦 friendly=false
    //  （:63015-63017）不咬——spFriendly 镜像承载;命中置撤退计时（StatusNPC :14027-14030
    // localAI[1]=20——次拍起 20t 撤退）
    // ★BJ704-G9（R1-P2②清偿,2026-10-21）步行支 cd 双制归一——vanilla 390-392 =
    // usesIDStaticNPCImmunity+idStaticNPCHitCooldown=15（SetDefaults :4754-4755,
    // 步行/爬墙【同机制同表】,perIDStaticNPCImmunity 跨实例共享）;旧步行支显式
    // 私表 20（cd 20≠15 且不跨实例共享——同型多蛛互不节流）。修=摘显式参回落
    // contactResolve(390-392)=idStatic 15 共享桶（与爬墙支 :6077 同制;R1 贴改行
    // 定谳,CONTACT_CD_TABLE :434-436 既有正轨条目直接消费）。
    if (this.spFriendly && this.contact(game, dmg0)) this.spLai1 = 20;
  }

  /** 吸血蛙 758（AI_067 flag2 步行链折算,1457 Projectile.cs :50209-50214 索敌档/
   *  :50478-50482 friendly 恒开/:50329-50334 跟随锚/:51004-51007 接敌锚距/
   *  :51155-51184 扑击门/:51296-51557 移动档与跳梯/:51616-51619 湿身跳;1456 :46330+
   *  同构——2026-08-23 备案项②,替代"统一飞行"）：
   *  · 索敌 num2=800（:50213）+视线（:50496-50504 Minion_FindTargetInRange
   *    skipIfCannotHitWithOwnBody）
   *  · 跟随锚 = 玩家心 -(35+w/2)×dir - 40×slot×dir（:50329-50334）;归位门 num3/num4
   *    缺省 500/300（:50031-50033,758 无覆写）;归位飞行（:50636-50712）tileCollide=
   *    false、加速 0.2/限速 10、<200 且主落地且悬空 → 落地（:50686-50692）
   *  · 接敌锚 = 敌心 + 远侧 20px 过冲（:51161-51168）;扑击门 = 距锚 <num30（flag2=50
   *    :51004-51007）→ ai[0]=2/ai[1]=num10=20（:50478-50482/:51155-51160）
   *  · 移动档（:51307-51311 有目标 0.7/6/6;:51296-51298 无目标 0.5/4/4;玩家更快 →
   *    0.7/玩家速 :51342-51345）;±5 死区（:51348-51362,越零 ×1.5 补/超速 0.1 缓档）
   *  · 跳梯 -5.1..-11.1（:51470-51490）+目标高出距离表 -6..-16（:51492-51527）;
   *    重力 0.4 封顶 10（:51553-51557）;湿身跳 ×2（:51616-51619,贴地 wet 门恒真
   *    同 palGroundStep 注）
   *  · 扑击态（ai[0]=2,:50901-50956）:贴地每拍 vx×0.8（:50931-50934,★BJ704-G1 债②
   *    已修——旧首拍一次 ×0.1 系 flag8/9 块误植）,ai[1]-- 归零
   *    → ai[1]=-num9=-60 过渡拍（★BJ703-D1 建模,唯 758 有）;friendly 恒 true
   *    （:50478-50482——接触伤不受扑击窗钳制,唯过渡拍 :50851 覆写 false）;
   *    spriteDirection=direction（:50885,扑击入场 direction 朝敌 :51139）。
   *  · 镜像（:51647-51671）:direction=sign(vx)、静止朝玩家（:51655-51657）、行走意图
   *    精化（|vx|>num50 且意图同向 :51658-51663）→ spriteDirection=+direction（蛙贴图
   *    朝右,与蜘蛛 -direction 反向）
   *  · tileCollide 动态门:归位飞行 :50648 false / 地面 :51266 true——moveAndCollide 消费
   *  · 帧 dust:【查无】——758 步行/跳跃段零 Dust.NewDust/Gore（AI_067 跳跃尘块均属
   *    flag=海盗 393-395 :51049-51097 / flag8=猫 :50911 / 1018 专属）,登记撤销
   *  · 帧通道（遗留债,非本批四项）:待机 14-17（fc/3 :50808-50820,rotation=vx×0.15）、
   *    扑击 18-20/21-23（num26 五格乒乓 :50911-50931）——draw 侧仍走 age/8 兜底 */
  private frogStep(game: GameHooks, p: Player, dmg0: number): void {
    // ★Z1/BJ433 平台下穿链（decidesManualFallThrough=true :7827 → :50454/:52112 两写位
    //  + :17692-17694 消费;承载=Entity.dropThrough）
    this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    const st = game.world.store;
    this.stepUp = true;
    // 湿旗=上拍段值快照 wetAi（vanilla AI_067 :51616 湿身 ×2 读 Projectile.wet=AI 先于
    // 湿段跑读上一子步段值;2026-09-08 定谳批,见类字段块头注①②③）
    const wet = this.wetAi;
    // 终清波批：Minion_FindTargetInRange(num2=800, skipOwnBody) 双距检索归真
    const tgt = this.findTargetInRangeDual(game, 800, { skipIfCannotHitOwnBody: true });   // ★BJ515 债④：skip=true（:50524）
    // ---- ai[0]=1 归位飞行（:50636-50712）----
    if (this.frA0 === 1) {
      this.tileCollide = false;                       // :50648
      // 位移阻尼不适用（tileCollide=false → 湿阻尼块 :17721 不跑;直写位=velocity 全量）
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      const dl = Math.hypot(dx, dy);
      if (dl > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }   // :50659-50662
      else if (dl < 200 && p.vy === 0 && this.y + this.h <= p.y + p.h && !this.solidOverlap(st)) {
        this.frA0 = 0; this.frA1 = 0;                 // :50686-50692 落地
        if (this.vy < -6) this.vy = -6;
      } else {
        const num19 = Math.max(10, Math.abs(p.vx) + Math.abs(p.vy));   // :50640-50648
        const l = dl || 1;
        if (this.vx < dx / l * num19) { this.vx += 0.2; if (this.vx < 0) this.vx += 0.3; }
        if (this.vx > dx / l * num19) { this.vx -= 0.2; if (this.vx > 0) this.vx -= 0.3; }
        if (this.vy < dy / l * num19) { this.vy += 0.2; if (this.vy < 0) this.vy += 0.3; }
        if (this.vy > dy / l * num19) { this.vy -= 0.2; if (this.vy > 0) this.vy -= 0.3; }
        this.x += this.vx; this.y += this.vy;         // tileCollide=false（:50637）
      }
      this.frogFrameTick(tgt);
      // ★BJ698：758 归位飞行接触伤——flag2 friendly=true 逐拍顶置（AI_067 :50470-50472），
      //  归位态无 friendly=false 覆写（唯 ai[0]==2∧ai[1]<0 扑后过渡拍 :50851 拒——
      //  ★BJ703-D1 已建模该过渡拍）；projPet carve-out `type != 758`（:12495）
      //  ⇒ 归位飞行可伤（旧 return 早退=缺窗）。
      this.contact(game, dmg0);
      return;
    }
    // ---- 扑击态（ai[0]=2,:50901-50956）----
    if (this.frA0 === 2) {
      // ★BJ703-D1（BJ698 登记债①）扑后 1-tick 过渡拍（:50849-50860）：ai[0]==2∧ai[1]<0 →
      //  friendly=false 覆写 :50480 顶置（Damage_PVE_Inner :12631 拒=本拍零接触伤）;
      //  ai[1]++ 后 num10(20)≥0 恒真支即复 ai[0]=0/ai[1]=0（:50855-50858）。num9=60
      //  （:50482）唯 758>0（393-395/951/1022 族 num9=0 → ai1 归零直复 0 无过渡拍）⇒
      //  过渡拍=758 专属;该拍零重力/零帧推/零 AI 位移指令,velocity 原样入 UpdatePosition
      //  （本仓承载=湿阻尼档 moveAndCollide;帧不推=frogFrameTick 跳过同相）。
      if (this.frA1 < 0) {
        this.frA1++;
        this.frA0 = 0; this.frA1 = 0;                 // :50855-50856（num10=20≥0 恒真支,ai[1]++ 即弃）
        const dfFrogTrans = projWaterDragFactor(this);   // UpdatePosition 湿阻尼面照达（tileCollide=true）
        moveAndCollide(this, game.world, this.vx * dfFrogTrans, this.vy * dfFrogTrans);
        return;                                       // 零帧推/零 contact（friendly=false 拍）
      }
      // ★BJ704-G1 债②（BJ703-A 登记债①）：贴地减速=每拍 vx×0.8（flag2 块
      //  :50931-50934 `if (velocity.Y == 0f) velocity.X *= 0.8f`——读相=重力前/位移前,
      //  vy===0 即碰撞落地清零的贴地语义）。旧「首拍一次 ×0.1」系 flag8(猫)/flag9(泥盆)
      //  落地刹（:50877-50884/:50905-50907,ai[1]==num10−1 门;palGroundStep 自有
      //  正确拷贝在位不动）误植蛙域,且 frA1-- 先于读=条件早一拍——随刀退役。
      if (this.vy === 0) this.vx *= 0.8;              // :50931-50934（每拍贴地阻尼）
      this.vy = Math.min(this.vy + 0.4, 10);          // :50936-50940 重力
      // ★水中位移阻尼（:17721 湿支;扑击态 tileCollide 承地面拍 :51266 置真,湿支照跑）
      const dfFrogPounce = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfFrogPounce, this.vy * dfFrogPounce);
      this.frA1--;                                    // :50941（原版序:族块→重力→ai[1]--）
      if (this.frA1 <= 0) { this.frA1 = -60; }        // :50942-50952（num9=60;ai0 保持 2 → 下拍过渡拍）
      this.frogFrameTick(tgt);
      this.contact(game, dmg0);                       // 台账批③：吸血蛙 idStatic 10（CONTACT_CD_TABLE :7825）
      return;
    }
    // ---- 地面态（ai[0]=0,:51186-51619）----
    this.tileCollide = true;                          // :51266
    // 无目标归位门（:51186-51201）：>2000 瞬移 / >500 或 |dy|>300 → ai[0]=1
    const dpx = p.cx - this.cx, dpy = p.cy - this.cy;
    const dP = Math.hypot(dpx, dpy);
    if (!tgt) {
      if (dP > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2; }
      else if (dP > 500 || Math.abs(dpy) > 300) { this.frA0 = 1; return; }
    }
    // 目标锚（:51003-51007 + :51161-51168）：敌心 + 远侧 20px 过冲
    let ax: number, ay: number;
    if (tgt) {
      const dirT = tgt.cx - this.cx < 0 ? -1 : 1;
      ax = tgt.cx - 20 * dirT;
      ay = tgt.cy;
      // TryJumpingToTarget 共享尾（:51024 调用位;toTarget.Y=敌心 Y——flag2 的 20px
      // 过冲是 :51167 X 轴另段,Y 同值）;跃起后 vy<0 使步行结算段让位（原版同序;
      // 湿中下落跃起走 :52114 支）。扑击门在原版 :51132 后于共享尾,照此位序
      this.ai67TryJumpingToTargetTail(tgt.cy, false);
      this.dropThrough = tgt.cy > this.y + this.h;   // ★Z1/BJ433 :52112 锚
      // 扑击门（:51155-51160）：距锚 <50 → ai[0]=2/ai[1]=num10=20
      if (Math.hypot(ax - this.cx, ay - this.cy) < 50) {
        this.frA0 = 2; this.frA1 = 20;
        this.facing = tgt.cx - this.cx > 0 ? 1 : -1;  // :51159-51160
        return;
      }
    } else {
      // 跟随锚（:50329-50334）
      ax = p.cx - (35 + p.w / 2) * p.facing - this.slot * 40 * p.facing;
      ay = p.cy;
    }
    // 移动档（:51296-51345）：无目标 0.5/4/4 → 有目标 0.7/6/6 → 玩家更快 0.7/玩家速
    let num50 = 0.5, num51 = 4, num52 = 4;
    if (tgt) { num50 = 0.7; num51 = 6; num52 = 6; }
    if (num52 < Math.abs(p.vx) + Math.abs(p.vy)) { num52 = Math.abs(p.vx) + Math.abs(p.vy); num50 = 0.7; }
    const dx = ax - this.cx;
    if (Math.abs(dx) > 5) {
      if (dx < 0) { this.vx -= this.vx > -num51 ? num50 : 0.1; if (dx < 0 && this.vx > 0) this.vx -= 0.1; }
      else { this.vx += this.vx < num51 ? num50 : 0.1; if (dx > 0 && this.vx < 0) this.vx += 0.1; }   // :51348-51362
    } else {
      this.vx *= 0.9;                                 // :51406-51410
      if (Math.abs(this.vx) < num50 * 2) this.vx = 0;
    }
    this.vx = Math.max(-num52, Math.min(num52, this.vx));
    // 镜像（:51647-51671）：direction=sign(vx)、静止朝玩家（:51655-51657）、行走意图
    // 精化（|vx|>num50 且意图同向 :51658-51663）→ spriteDirection=+direction（:51671）
    if (this.vx < 0) this.facing = -1;
    else if (this.vx > 0) this.facing = 1;
    else this.facing = p.cx > this.cx ? 1 : -1;
    if (this.vx > num50 && dx > 0) this.facing = 1;
    if (this.vx < -num50 && dx < 0) this.facing = -1;
    // 跳梯两面合流（终清波批,ai67JumpFlags——旧 walkerJump* 单柱形退役）：
    //  (a) 家族墙意图档 flag20：蛙=flag2 → attackTarget!=-1（无目标跟随期不恒跳）
    //  (b) 前墙列扫 num55≠0 ∧ flag21（|Δx|≥64 ∨ Δy≤−48∧|Δx|≥8）;落地后
    //      ai67JumpLadder 三柱承立闸 + 单柱中腰基准五档（虎先例共轨）
    const jump = this.ai67JumpFlags(st, ax, ay, { wallIntent: tgt !== null });
    this.vy = Math.min(this.vy + 0.4, 10);            // :51553-51557
    // ★水中位移阻尼（:17721 湿支;湿段 tick 头已刷新当拍旗,速度场不减只削当拍位移
    //  ——下方 wet 起跳 ×2 读 velocity 场=未阻尼,原文同相）
    const dfFrogWalk = projWaterDragFactor(this);
    moveAndCollide(this, game.world, this.vx * dfFrogWalk, this.vy * dfFrogWalk);
    if (this.onGround) {
      if (jump) this.ai67JumpLadder(st, Math.sign(dx) || 1);
      const dyA = ay - this.cy;
      if (dyA < -48) {                                // :51492-51527
        const d = -dyA;
        this.vy = d < 60 ? -6 : d < 80 ? -7 : d < 100 ? -8 : d < 120 ? -9
          : d < 140 ? -10 : d < 160 ? -11 : d < 190 ? -12 : d < 210 ? -13
          : d < 270 ? -14 : d < 310 ? -15 : -16;
      }
      if (wet) this.vy *= 2;                          // :51616-51619 湿身跳翻倍
    }
    this.frogFrameTick(tgt);
    this.contact(game, dmg0);                         // friendly 恒开（:50478-50482）;台账批③ idStatic 10（:7825,旧 20t/30t 私表退役）
  }

  /** ★BJ635：吸血蛙 758 状态帧机（AI_067 flag6 :51718-51762 1:1 折算）——BJ632 登记
   *  帧档债清偿（旧 age/8 匀速兜底扫遍全 24 帧带）。四带：静立 0 / 飞行 1 / 步行带
   *  2-9（fc += trunc|vx|+1 速度计频,>10 推帧）/攻击带 10-15（fc>3 推帧）/
   *  空中攻击 13。grounded 判定 = onGround（原版 velocity.Y==0 读相=碰撞后重力前,
   *  BJ516① 定谳;本仓 moveAndCollide 后 vy 恒含重力,onGround 等价承载）。
   *  调用位 = frogStep 三子步拍尾（home-fly/pounce/ground——原版帧块在 AI 尾全态共享）。 */
  private frogFrameTick(tgt: EnemyLike | null): void {
    if (tgt) {
      if (!this.onGround) { this.frFrame = 13; this.frFc = 0; }          // :51722-51726
      else if (++this.frFc > 3) {                                        // :51727-51734
        this.frFc = 0;
        this.frFrame++;
        if (this.frFrame < 10 || this.frFrame > 15) this.frFrame = 10;   // 攻击带 10-15
      }
    } else if (this.onGround) {
      if (this.vx === 0) { this.frFrame = 0; this.frFc = 0; }            // :51735-51739
      else if (Math.abs(this.vx) >= 0.5) {                               // :51740-51750
        this.frFc += Math.trunc(Math.abs(this.vx)); this.frFc++;
        if (this.frFc > 10) {
          this.frFc = 0;
          this.frFrame++;
          if (this.frFrame < 2 || this.frFrame > 9) this.frFrame = 2;    // 步行带 2-9
        }
      } else { this.frFrame = 0; this.frFc = 0; }
    } else {
      this.frFrame = 1; this.frFc = 0;                                   // :51751-51756
    }
  }

  /** 乌鸦 317（aiStyle 54，AI :27383-27590 1:1）：同类 28px 内互推 0.05
   *  （:27397-27416）；归位门（:27422-27430）：曼哈顿 >num440（500；ai[1]≠0 扑击态
   *  或 friendly（冲刺帧）→ 1400）→ ai[0]=1。
   *  攻击态索敌 900 曼哈顿 + 视线（:27433-27485）；无目标 → 跟随玩家上方 60px
   *  （速 8/12，317 距>100 提速 12/15，velocity=(v×20+dir)/21 :27499-27536，
   *  >2000 瞬移 :27519-27522，<70 漂移 ×1.01 :27537-27540）；有目标 → 扑击循环
   *  （ai[1]==-1→17 倒数，归零后以 16/10 速冲向目标 :27557-27580，帧 4-7）。
   *  仅扑击中有接触伤（friendly 门 :27568/:27581），localNPCHitCooldown=10（:3836）；
   *  命中重置 ai[1]=-1（case 317 :12777-12780） */
  private ravenBody(game: GameHooks, p: Player, dmg0: number): void {
    // vanilla aiStyle 54 每拍按【入拍 ai[0]】写 tileCollide（:29042 attack 真 /
    //  :29079 归位假;近身回攻 ai[0]=0 写在后,不回写本拍碰撞位）→ 湿阻尼门锚入拍态
    const rA0Entry = this.rA0;
    // 同类分离（:27397-27416）
    const projs = (game as unknown as { entities: { projectiles: MinionProj[] } }).entities.projectiles;
    for (const m of projs) {
      if (m === this || !(m instanceof MinionProj) || m.dead || m.projId !== 317) continue;
      if (Math.abs(this.x - m.x) + Math.abs(this.y - m.y) < this.w) {
        this.vx += this.x < m.x ? -0.05 : 0.05;
        this.vy += this.y < m.y ? -0.05 : 0.05;
      }
    }
    // 归位门（:27422-27430）：num440=500；ai[1]≠0（扑击倒数/命中重置态）或
    // friendly（上一 tick 冲刺帧置位 :27547）→ 1400
    const num440 = this.rA1 !== 0 || this.rFriendly ? 1400 : 500;
    if (Math.abs(this.cx - p.cx) + Math.abs(this.cy - p.cy) > num440) this.rA0 = 1;
    // 索敌（仅 ai[0]==0：num439=900 曼哈顿 + CanHit 视线，:27433-27485）
    let tgt: EnemyLike | null = null;
    if (this.rA0 === 0) {
      let best = 900;
      for (const e of game.enemies()) {
        const en = e as EnemyLike;
        if (!canBeChasedBy(e)) continue;   // CanBeChasedBy :91070/:91141——友好+immortal 族不入索敌（防追踪睡渔夫/假人）
        if (en.dead) continue;
        const d = Math.abs(this.cx - en.cx) + Math.abs(this.cy - en.cy);
        if (d < best && canHit(game.world.store, this.x, this.y, this.w, this.h, en.x, en.y, en.w, en.h)) {
          best = d; tgt = en;
        }
      }
    }
    if (!tgt) {
      // 跟随玩家上方 60px（:27501-27545）
      const dx = p.cx - this.cx, dy = p.cy - 60 - this.cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 100 && this.rA0 === 1) this.rA0 = 0; // :27512-27517（归位态近身回攻击态）
      if (dist > 2000) { this.x = p.cx - this.w / 2; this.y = p.cy - this.w / 2; } // :27519-27522
      let spd = this.rA0 === 1 ? 12 : 8;              // :27501-27503
      if (dist > 100) spd = this.rA0 === 1 ? 15 : 12; // :27524-27531（317 专属提速）
      if (dist > 70) {
        this.vx = (this.vx * 20 + (dx / dist) * spd) / 21; // :27533-27535
        this.vy = (this.vy * 20 + (dy / dist) * spd) / 21;
      } else {
        if (this.vx === 0 && this.vy === 0) { this.vx = -0.15; this.vy = -0.05; } // :27537-27539
        this.vx *= 1.01; this.vy *= 1.01;                                            // :27540
      }
      this.rot = this.vx * 0.05; // :27542
      this.ravenZone = 0;        // 帧 0-3（:27543-27549）
      if (Math.abs(this.vx) > 0.2) this.facing = -Math.sign(this.vx); // :27551-27553（spriteDirection=-direction）
      // ★水中位移阻尼（:17721 湿支只对 tileCollide=true 宿主跑——attack 态 :29042;
      //  归位态 :29079 false → 恒全速）
      const dfRavenFollow = rA0Entry === 0 ? projWaterDragFactor(this) : 1;
      this.x += this.vx * dfRavenFollow; this.y += this.vy * dfRavenFollow;
      this.rFriendly = false; // :27519（跟随期收尾 friendly=false——下一 tick 归位门读此值）
      return; // friendly=false（:27544）——跟随期无接触伤
    }
    // 扑击循环（:27557-27590）
    if (this.rA1 === -1) this.rA1 = 17; // :27557-27559
    if (this.rA1 > 0) this.rA1--;
    let charging = false;
    if (this.rA1 === 0) {
      // 冲刺（friendly=true :27547-27580）：速 16，距<100 → 10；velocity=(v×14+dir)/15
      const dx = tgt.cx - this.cx, dy = tgt.cy - this.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const spd = dist < 100 ? 10 : 16;
      this.vx = (this.vx * 14 + (dx / dist) * spd) / 15;
      this.vy = (this.vy * 14 + (dy / dist) * spd) / 15;
      charging = true;
      this.rFriendly = true; // :27547（冲刺帧 friendly=true）
    } else {
      this.rFriendly = false;           // :27566（倒数帧 friendly=false）
      if (Math.abs(this.vx) + Math.abs(this.vy) < 10) {
        this.vx *= 1.05; this.vy *= 1.05; // :27582-27585
      }
    }
    this.rot = this.vx * 0.05; // :27587
    this.ravenZone = 1;        // 帧 4-7（:27588-27594）
    if (Math.abs(this.vx) > 0.2) this.facing = -Math.sign(this.vx);
    // ★水中位移阻尼（扑击循环仅在 attack 态（:29042 tileCollide=true）可达,湿支照跑）
    const dfRavenPounce = projWaterDragFactor(this);
    this.x += this.vx * dfRavenPounce; this.y += this.vy * dfRavenPounce;
    if (charging && this.contact(game, dmg0, 10)) this.rA1 = -1; // 命中重置（:12777-12780）
  }

  /** 致命球 533 相位推进（AI_066 :28497-28689/:28741-28753/:28998-29039 1:1 折算）：
   *  0-2 待机 → 敌 <800 且冷却好 → 第 1-3 击入 6/7/8 冲刺（localAI[0]<3，:29029-29038）、
   *  每 3 击后入 4/5/3 蓄力（localAI[0]≥3 → ai[0]+=4（6→3）并清零，:29020-29028）；
   *  3-5 蓄力 ai[1]>16 → ai[0]-=3（:28624-28628）、6-8 冲刺 ai[1]>40/30/30 →
   *  ai[0]-=6 + localAI[0]++（:28658-28666）；距玩家 >1500 → ai[0]+=3×(3-⌊ai[0]/3⌋)
   *  入 9-11 归位（:28741-28753），<450 落位 ai[0]-=9（:28824-28834）；攻击间隔
   *  ai[1] 1→10 自增归零（:28958-28967） */
  /** ★BJ635（2026-10-11）④ 致命球 533 = AI_066 533 面全式重写（Projectile.cs:30084-30645,
   *  旧 deadlySpherePhase 只有相位机、运动面被通用飞行块逐拍覆写）。普查定谳四面全偏：
   *  ①蓄力段 ×0.81/拍（原版 velocity×0.9/子步、无 extraUpdates=每拍一子步 :30193）；
   *  ②冲刺段零速度写（原版触发拍 velocity=dir×10/12 :30640-30643 + 截击覆写 + 冲刺
   *  MaxUpdates=2 双子步积分 :30241）——旧=通用恒速 5 逐拍覆写,冲刺不冲；
   *  ③悬停=通用环形槽（原版 hover 锚 player.Center+(0,−60) 阻尼 (v×40+dir×12)/41
   *  :30402-30467）;④零 533 对分离力（原版 :30117-30146 flag30 双球 ±0.05）。
   *  态机 ai[0]：0-2 待机（2=攻击闪蓝光）/3-5 蓄力/6-8 冲刺/9-11 归位冲刺;
   *  ai[1]=冷却/段计时、localAI[0]=三连冲刺计数、localAI[2]=撞墙计数（击退 ×0.5 面
   *  :14618 消费=contact 签名域登记债,计数面 :30120/:18314 落位）。 */
  private deadlySpherePhase(game: GameHooks, p: Player, tgt: EnemyLike | null, dmg0: number): void {
    const st = game.world.store;
    // ---- localAI[2] 逐拍衰减钳（:30120 Clamp(−1, 0, 60)）----
    this.dLai2 = Math.max(0, Math.min(60, this.dLai2 - 1));
    // ---- 分离力（:30117-30146 flag30=同主同型 533 对,position 曼哈顿 < width=20）----
    for (const ent of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
      const o = ent as MinionProj;
      if (!(o instanceof MinionProj) || o === this || o.dead || o.projId !== 533) continue;
      if (o.ownerRef() !== p) continue;
      if (Math.abs(this.x - o.x) + Math.abs(this.y - o.y) >= this.w) continue;
      this.vx += this.x < o.x ? -0.05 : 0.05;        // :30137-30144
      this.vy += this.y < o.y ? -0.05 : 0.05;
    }
    // ---- 蓄力态（:30190-30215,flag31——态内不重索敌/不 hover）----
    if (this.dA0 >= 3 && this.dA0 <= 5) {
      this.vx *= 0.9; this.vy *= 0.9;                // :30193（每拍一子步,无 extraUpdates）
      this.dA1++;
      const num533 = Math.trunc(this.dA1 / 2) + (this.dA0 - 3) * 8;   // :30196 帧表游标
      if (num533 < 4) this.dFrame = 17 + num533;
      else if (num533 < 5) this.dFrame = 0;
      else if (num533 < 8) this.dFrame = 1 + num533 - 5;
      else if (num533 < 11) this.dFrame = 11 - num533;
      else if (num533 < 12) this.dFrame = 0;
      else if (num533 < 16) this.dFrame = num533 - 2;
      else if (num533 < 20) this.dFrame = 29 - num533;
      else if (num533 < 21) this.dFrame = 0;
      else this.dFrame = num533 - 4;
      if (this.dA1 > 16) { this.dA0 -= 3; this.dA1 = 0; }   // :30213-30216（num532×8）
      this.integrate533(game, st);
      return;
    }
    // ---- 冲刺态（:30239-30280,MaxUpdates=2 → 双子步;velocity 恒=触发拍出膛值）----
    if (this.dA0 >= 6 && this.dA0 <= 8) {
      for (let sub = 0; sub < 2; sub++) {            // MaxUpdates=2（:30241）
        this.dA1++;
        if (this.dA0 === 7) this.rot = Math.atan2(this.vy, this.vx) + Math.PI;   // :30244
        else this.rot += Math.PI / 6;                // :30246
        this.dFrame = this.dA0 === 6 ? 5 : this.dA0 === 7 ? 13 : 17;   // :30249-30262
        const num534 = this.dA0 === 6 ? 40 : 30;
        if (this.dA1 > num534) { this.dA1 = 1; this.dA0 -= 6; this.dLai0++; break; }   // :30264-30269
        if (this.dA0 === 8) {                        // :30283-30291 四向尘（每子步）
          for (let i = 0; i < 4; i++) {
            // ★C16a-F7：Vector2.One（模√2、45° 对角）.RotatedBy(i·π/2).RotatedBy(rot)
            //  = 45°+i·90°+rot 方向、√2 模；position=Center+vec×10、velocity=vec×1
            //  （:30287-30289。旧实现=i·90°+rot 单位模 + 零偏移,三错齐发）
            const ang = Math.PI / 4 + i * (Math.PI / 2) + this.rot;
            const ux = Math.SQRT2 * Math.cos(ang), uy = Math.SQRT2 * Math.sin(ang);
            const d = game.spawnDust?.(this.cx + ux * 10, this.cy + uy * 10, 0, 0,
              [226, 228, 75][Math.floor(Math.random() * 3)],
              ux, uy, 0, null, 0.6 + Math.random() * 0.5);
            if (d) d.noGravity = true;
          }
        }
        this.integrate533(game, st);
      }
      // ★BJ696（2026-10-20）冲刺持续拍伤害出口：原版 Damage() 全局每拍
      //  （Projectile.cs:17184）→ Damage_CanDealDamage projPet 门 :12495
      //  （projPet[533]=true Main.cs:8922 → `(type != 533 || !(ai[0] >= 6f) ||
      //  !(ai[0] <= 8f))` 汇出=唯 ai[0]∈[6,8] 放行）——门内 post-AI 读位：
      //  双子步 break 落 0-2 拍=不伤（原版同相）。
      this.contact533(game, dmg0);
      return;
    }
    // ---- 攻击间隔冷却（:30568-30577）----
    if (this.dA1 > 0 && ++this.dA1 > 10) this.dA1 = 0;
    // ---- tileCollide 翻转（:30306-30313）----
    if (this.dA0 < 9) this.tileCollide = true;
    if (this.tileCollide && st.isSolid(Math.floor(this.cx / 16), Math.floor(this.cy / 16))) {
      this.tileCollide = false;
    }
    // ---- leash（:30373-30380：距玩家 >1500（有敌）/900（无敌）→ 跳归位带;不 return——
    //      同拍照走 hover（旧实现 return=自造相）----
    const distP = Math.hypot(p.cx - this.cx, p.cy - this.cy);
    if (distP > (tgt ? 1500 : 900)) {
      if (this.dA0 < 9) this.dA0 += 3 * (3 - Math.trunc(this.dA0 / 3));
      this.tileCollide = false;
    }
    // ---- hover（:30386-30467,533 无 flag29 → 恒 else 支;flag33=归位带 dA0≥9）----
    {
      const flag33 = this.dA0 >= 9;
      let num546 = 12; let num547 = 40;              // :30395-30397 533 档（num526 档覆盖）
      const hx = p.cx - this.cx, hy = p.cy - this.cy - 60;   // vector42 = Center−me+(0,−60)
      const num548 = Math.hypot(hx, hy);
      const pv = Math.abs(p.vx) + Math.abs(p.vy);
      if (num546 < pv) {                             // :30424-30434 跟玩家速度链
        num547 = 30; num546 = pv;
        if (num548 > 200) { num547 = 20; num546 += 4; }
        else if (num548 > 100) { num546 += 3; }
      }
      if (flag33 && num548 > 300) { num546 += 6; num547 -= 10; }   // :30435-30438
      if (num548 < 450 && flag33 && !this.solidOverlap(st)) {
        this.dA0 -= 9;                               // :30439-30446 落位回待机（盒判,旧=中心格）
      }
      if (num548 > 2000) {                           // :30447-30451 瞬移回玩家
        this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2;
      }
      if (num548 > 70) {                             // :30452-30458 阻尼逼近
        const l = num548 || 1;
        this.vx = (this.vx * num547 + (hx / l) * num546) / (num547 + 1);
        this.vy = (this.vy * num547 + (hy / l) * num546) / (num547 + 1);
      } else if (this.vx === 0 && this.vy === 0) {   // :30459-30463
        this.vx = -0.15; this.vy = -0.05;
      }
      const vl = Math.hypot(this.vx, this.vy);
      if (vl > num546) { this.vx *= 0.95; this.vy *= 0.95; }   // :30464-30467
    }
    // ---- 旋转（:30471-30474：ai[0]<3∨≥9 才自旋——3-8 冲段不自旋）----
    if (this.dA0 < 3 || this.dA0 >= 9) this.rot += this.vx * 0.04;
    // ---- 帧机（:30596-30620,待机带三态分相）----
    if (this.dA0 < 3 || this.dA0 >= 9) {
      if (++this.dFc >= 24) this.dFc = 0;
      switch (this.dA0) {
        case 0: case 9: this.dFrame = 4 + Math.floor(this.dFc / 4); break;
        case 1: case 10: this.dFrame = 14 + Math.floor(this.dFc / 8); break;
        case 2: case 11: {
          let n = Math.floor(this.dFc / 3);
          if (n >= 4) n -= 4;
          this.dFrame = 17 + n;
          break;
        }
        default: this.dFrame = 4 + Math.floor(this.dFc / 4); break;
      }
      // 攻击闪尘（:30533-30550,ai[0]==2 ∧ 50% → 四向尘 noLight）——★C16a-F7 同
      //  :30283 式三错齐修（45° 对角基准/√2 模/位 Center+vec×10）
      if (this.dA0 === 2 && Math.floor(Math.random() * 2) === 0) {
        for (let i = 0; i < 4; i++) {
          if (Math.floor(Math.random() * 2) !== 0) continue;
          const ang = Math.PI / 4 + i * (Math.PI / 2) + this.rot;
          const ux = Math.SQRT2 * Math.cos(ang), uy = Math.SQRT2 * Math.sin(ang);
          const d = game.spawnDust?.(this.cx + ux * 10, this.cy + uy * 10, 0, 0,
            [226, 228, 75][Math.floor(Math.random() * 3)],
            ux, uy, 0, null, 0.3 + Math.random() * 0.5);
          if (d) { d.noGravity = true; d.noLight = true; }
        }
      }
    }
    // ---- 攻击触发（:30631-30645：ai[0]<9 ∧ 冷却好 ∧ 锁定 ∧ num526<800）----
    if (this.dA0 < 9 && this.dA1 === 0 && tgt) {
      const num526 = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
      if (num526 < 800) {
        this.dA1++;
        if (this.dLai0 >= 3) { this.dA0 += 4; if (this.dA0 === 6) this.dA0 = 3; this.dLai0 = 0; }
        else {
          this.dA0 += 6;
          const dx = tgt.cx - this.cx, dy = tgt.cy - this.cy;
          const dl = Math.hypot(dx, dy);
          const nx = dl > 0 ? dx / dl : 0, ny = dl > 0 ? dy / dl : 0;   // SafeNormalize(ZERO)
          const num560 = this.dA0 === 8 ? 12 : 10;   // :30639-30640
          this.vx = nx * num560; this.vy = ny * num560;
          // ★C16a-F11（2026-10-12）焦点零速特典（:30319-30323 focus 支不写 zero,
          //  恒 Vector2.Zero——野生支 :30357 才写 nPC.velocity;twinsStep 同判既案）：
          //  集火目标喂截击面的 targetVelocity 必须 (0,0),旧实现恒喂敌速
          const isFocus533 = (p as unknown as { minionTargetId?: number }).minionTargetId === tgt.id;
          this.ai066TryInterceptingTarget(tgt.cx, tgt.cy,
            isFocus533 ? 0 : (tgt as unknown as { vx?: number }).vx ?? 0,
            isFocus533 ? 0 : (tgt as unknown as { vy?: number }).vy ?? 0, num560, 533);
        }
      }
    }
    // ---- 位移（case 533 碰撞反弹 :18281-18320——X 全反/Y×0.5/模长归一/dLai2+30）----
    this.integrate533(game, st);
    // ★BJ650件2（2026-10-12,BJ635 登记债清偿）：localAI[2]≥40 → 本拍伤害 ×0.5
    //  （Damage_GetProjectileSpecificDamageMultiplier Projectile.cs:14618-14621
    //  `if (type == 533 && localAI[2] >= 40f) num *= 0.5f`——注意 :14618 是【伤害】
    //  乘区非击退（登记文案「击退 ×0.5」系误记,击退面 num5=knockBack 不经此函数;
    //  消费位 = Damage() PVE/PVP num7=(int)(damage×mul) :12873/:14718 截断,倍率
    //  先于 ModifyHit/OnHit tag 栈=本仓 dmg 入 contact 前乘同序）;蓄力档减伤联动=
    //  撞墙计数（:18314 每次 +30、:30120 逐拍 −1 钳 [0,60],两次反弹即达阈值）。
    // ★BJ696（2026-10-20）伤害面反相矫正（用户实报「致命球法杖无伤害」根因）：原版
    //  Damage() 全局每拍（Projectile.cs:17184）经 Damage_CanDealDamage projPet 门
    //  （:12495，projPet[533]=true Main.cs:8922）唯冲刺态 ai[0]∈[6,8] 放行；伤害盒
    //  =Damage_GetHitbox（:15037 无 533 支）恒 20×20——「冲刺盒+6」（GetCollisionParams
    //  :20102）系瓷砖碰撞/SwitchTiles 通道（:17697/:19976/:20581 三处使用位亲读），
    //  非伤害面=登记债不落。旧实现待机/归位/触发拍无条件发伤（尾位）、冲刺/蓄力
    //  分支提前 return 零伤=整段反相。现唯二出口：①冲刺分支尾（持续拍）②本尾位
    //  （触发拍 dA0 已入 6-8——原版 Damage() 读 post-AI ai[0] 同相），门聚 contact533。
    this.contact533(game, dmg0);
    this.recordGhostTrail();
  }

  /** ★BJ696 533 唯一伤害出口：Damage_CanDealDamage projPet 门（Projectile.cs:12495，
   *  projPet[533]=true Main.cs:8922）——待机 0-2/蓄力 3-5/归位 9-11 全 blocked，
   *  仅冲刺 6-8 放行；dLai2≥40 → ×0.5（★BJ650件2 :14618）+ num7 (int) 截断，
   *  读位=AI 后（原版 Damage() 时序），post-integrate dLai2 含本拍反弹 +30。 */
  private contact533(game: GameHooks, dmg0: number): void {
    if (this.dA0 < 6 || this.dA0 > 8) return;   // :12495 projPet 门
    this.contact(game, this.dLai2 >= 40 ? Math.trunc(dmg0 * 0.5) : dmg0);
  }

  /** 533 位移积分 + case 533 碰撞反弹（Projectile.cs:18281-18320）：moveAndCollide 停墙
   *  后按受阻轴反转——X 全量、Y ×0.5、模长归一回撞前值;dA0==7 段 vy<−0.1 修 0.1 上顶;
   *  冲刺带 HitTiles 尘=登记（视觉面）;dLai2 += 30（:18314,击退 ×0.5 消费面 :14618
   *  =contact 签名域登记债）。tileCollide=false 拍=直写位移（无碰撞）。 */
  private integrate533(game: GameHooks, st: { isSolid(x: number, y: number): boolean }): void {
    void st;
    // ★BJ671：弹面 flag6 缺省 true（Projectile.cs:17587 非宠物弹 → TileCollision
    //  (flag6,flag6)=平台永不承接;533 不在覆写 switch :17670-17696 → 穿平台下落,
    //  撞弹面判定只对实体墙成立=反弹链语义不变）。同 twinsStep 387/388 面。
    this.dropThrough = true;
    const lvx = this.vx, lvy = this.vy;
    const lastLen = Math.hypot(lvx, lvy);
    // ★BJ697 债②（BJ696 登记）：冲刺/归位冲刺态（dA0≥6）瓷砖碰撞盒 +6——原版
    //  GetCollisionParams（Projectile.cs:20102-20105）`type==533 && ai[0]>=6 →
    //  colWidth/Height=width/height+6`,resizeAnchor 缺省 (0.5,0.5)（:19983）→
    //  Center 锚两侧各 +3=26×26,仅 TileCollision 通道（:17697-17698 消费）;NPC
    //  伤害盒 Damage_GetHitbox :15037 无 533 支=恒 20×20（BJ696 反定谳,勿动）。
    //  moveAndCollide 写 x/y → 还原按【新中心】回 20×20（中心连续,反弹旗
    //  hitWall/collideY 已由 26 盒判定产出=原版同相）;裸盒消费面（hitTilesFx
    //  :18304 传 width/height 非 colWidth）在还原后=原盒 ✓。
    const dashBox6 = this.dA0 >= 6;
    const ow533 = this.w, oh533 = this.h;
    if (dashBox6) { this.w += 6; this.h += 6; this.x -= 3; this.y -= 3; }
    moveAndCollide(this, game.world, this.vx, this.vy);
    if (dashBox6) {
      const ncx533 = this.cx, ncy533 = this.cy;
      this.w = ow533; this.h = oh533;
      this.x = ncx533 - ow533 / 2; this.y = ncy533 - oh533 / 2;
    }
    let bounced = false;
    // ★BJ650 定谳补刀（2026-10-12,件2/件3 落刀撞出,BJ635 反义误植两面）：
    //  ①Y 支判据 :18289 `velocity.Y != lastVelocity.Y || velocity.Y == 0f`——原版
    //   判据读【撞后】速度（TileCollision 落地清零 vy → != 恒真;后者=撞后零速档）,
    //   旧码误植为撞前对（`vy===lvy‖lvy===0`）→ 本仓 moveAndCollide 落地清零 vy
    //   （slopeCollide stand 双清）下判据恒假=地面反弹死支（dLai2 撞墙计数/件3
    //   冲刺尘链同断）。X 支 hitWall+vx 位不变（moveAxis 不改写 vx）=受阻同相保留。
    //  ②归一式 :18294-18298 `velocity /= num20`（num20=lastLen/|velocity|）——
    //   旧码 `*= lastLen/nl` 除向反植（Y 档 ×2=回满速 vs 原版 ÷2=入速 1/4 出膛）。
    if (this.hitWall && this.vx === lvx) { this.vx = -lvx; bounced = true; }          // :18285-18288
    if (this.collideY && (this.vy !== lvy || this.vy === 0)) {
      this.vy = -lvy * 0.5; bounced = true;                                           // :18289-18292
    }
    if (bounced && lastLen > 0) {
      const nl = Math.hypot(this.vx, this.vy);
      const num20 = nl > 0 ? lastLen / nl : Number.POSITIVE_INFINITY;   // nl=0 → /=Inf 归零（vanilla float 同相）
      this.vx /= num20; this.vy /= num20;                                             // :18298 归一（除向）
      if (this.dA0 === 7 && this.vy < -0.1) this.vy += 0.1;                           // :18301-18304
      // ★BJ650件3（2026-10-12,BJ635 登记债清偿）：冲刺带撞块砖屑尘（:18304-18306
      //  `if (ai[0] >= 6f && ai[0] < 9f) Collision.HitTiles(position, lastVelocity,
      //  width, height)`——仅冲刺档 dA0∈[6,8] 反弹拍;velocity=lastVelocity（撞前速）
      //  语义=hitTilesFx 形参同源（下帧预测位=position+velocity 交叠面撒尘,
      //  Game.hitTilesFx 批 3 全量化 1:1——KillTile(fail:true,effectOnly) 尘面无音）
      if (this.dA0 >= 6 && this.dA0 <= 8) {
        game.hitTilesFx?.(this.x, this.y, this.w, this.h, lvx, lvy);
      }
      this.dLai2 += 30;                                                               // :18314
    }
  }

  /** 星尘守护者 623（套装奖励，AI_120_StardustGuardian :45453-45785 1:1）：
   *  ai[0] 状态机——0=贴身跟随（Lerp 0.05 至玩家侧后 -(5+w/2)×dir,-25，索敌 500
   *  （|Δx-锚|≤170 门 :45527-45530）， leash 步进 0.1 :45536-45556）→ 2=冲刺拳击
   *  （绕到目标背侧 npc-(dir×(w/2+70),-10)，velocity.MoveTowards(≤6×Remap(50..400,1..4),32)
   *  :45708-45713，每 4t 重锁 :45715-45726）→ 失去目标/超 500 回 0。
   *  1/3=rest 双态（★BJ157⑧ 补接 MinionRestTarget 消费面）：1=驻守 rest 点
   *  （:45562-45651——无点回 0 :45564-45570；索敌锚【玩家中心】 :45786-45788，
   *  漂移 |Δx|>190 / |Δy|>100 → 3 :45612-45640）；3=飞行 rest 点（:45707-45755——
   *  alpha=255 隐身+尘爆/尾迹，Lerp 0.2，<10px → 1 :45749-45752）。原版出生 ai[0]=0
   *  且状态 0 无 else 支（:45524-45560）→ rest 环 {1,3} 单机不可达（写点入口仅
   *  Forbidden 套 KeyDoubleTap :57449-57456;1456/1457/1458 三版同相）——1:1 照抄
   *  休眠支,测试经 ai[0] 直置驱动。
   *  命中仅状态 2：80×40 拳盒于 Center+direction×40（Colliding :14294-14300），
   *  localNPCHitCooldown=5（:6433）；伤害走 resolveWhipTagHit（623 是 minion） */
  /** AI_120_StardustGuardian_FindTarget 1:1（1457 Projectile.cs:45785-45800 /
   *  1456 :42301-42316）——★BJ514（2026-10-05,BJ512 登记债②清偿批①,锚例=星尘守卫者）：
   *  专用择敌,不共用 nearestEnemy（dragonTarget AI_121 判例同款）。
   *  原文本支【无】OwnerMinionAttackTargetNPC 集火桶——:45785 全函数只扫
   *  CanBeChasedBy ∧ 玩家心距,三处调用（状态 0 :45526/状态 1 :45581/状态 2 重锁
   *  :45716）同体;nearestEnemy 的集火支/鞭 tag 桶对 623 系先前批 eager 面,本刀摘除。
   *  · 距锚 = Main.player[owner].Center（:45786-45788）——状态 0/重锁两处曾错挂
   *    随从心（nearestEnemy 缺省 from:'self'）,一并归真;
   *  · 语义 = 玩家心 Euclid < lookupRange 收缩最近（:45792-45795 num<lookupRange）,
   *    lookupRange 初值 num2=500（:45466）;
   *  · 原文本支无鞭 tag 支（同 AI_121 判例：nearestEnemy 通用 tag 层不建模）。 */
  private ai120FindTarget(game: GameHooks, p: Player): EnemyLike | null {
    let best: EnemyLike | null = null;
    let bestD = 500;                                   // lookupRange=num2（:45466）
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean };
      if (!en || en.dead) continue;
      if (!canBeChasedBy(e)) continue;                 // :45790
      const d = Math.hypot(en.cx - p.cx, en.cy - p.cy);  // center=player.Center（:45786-45788）
      if (d < bestD) { bestD = d; best = en; }         // :45792-45795 收缩最近
    }
    return best;
  }

  /** AI_177（917 酷鞭雪花;★BJ-C3/F5 2026-10-06：1036 雾网蜘蛛已重路由 webStep=BJ516①,
   *  本函数唯一调用位=917 支,标题残留同步）择敌 1:1 = Projectile.FindTargetWithinRange
   *  （:45918-45931,实参 (400f, checkCanHit=false)——:46022/:46025,checkCanHit 唯
   *  969 置 true,两型不消费）——★BJ514：原文本支无集火桶/无鞭 tag 桶（AI_177 全
   *  函数不读 OwnerMinionAttackTargetNPC）,曾吃 nearestEnemy 通用集火(900)/tag 桶,
   *  本刀摘除改专扫。
   *  ★BJ515 债①（2026-10-05,BJ514 债③清偿）：localNPCImmunity[i]==0 门落刀——
   *  917 命中写 :14175-14179（localNPCHitCooldown=20 :8713-8714,DecrementLocal
   *  ImmuneTimeCounters :17365-17385 逐 t 衰减）,冷却窗内不重锁：锁失效门
   *  :46000 `(!CanBeChasedBy || localNPCImmunity[num2] > 0)` + 扫描门 :45925
   *  `localNPCImmunity[i] == 0`。原版锁结构 = ai[0] 持锁跨拍（:45997 num2=ai[0]-1,
   *  失锁才重扫 :46006-46013,扫中写回 :46016-46017）——旧实现逐拍重扫（近敌出现
   *  即换靶）一并归真。
   *  ★BJ516①（2026-10-05,BJ515 登记债清偿）：1036 已重路由 AI_067 flag7（webStep,
   *  :50023/:50520-50523 respectOwnerTarget=false、num2=450 :50048）——本函数仅 917
   *  消费,门/锁/免疫表扫描面 = AI_177 本相（1036 的免疫表载体共用见 webStep 注）。 */
  private ai177FindTarget(game: GameHooks): EnemyLike | null {
    const gated = this.projId === 917;                 // ★BJ515：门/锁=AI_177 本相,917 消费
    if (gated && this.ai177Lock >= 0) {
      const cur = this.enemyById(game, this.ai177Lock);
      // :46000 失效门（dead 并入 enemyById null 面=CanBeChasedBy 拒收同效）
      if (!cur || !canBeChasedBy(cur) || this.ai177Immunity!.peek(this.ai177Lock) > 0) {
        this.ai177Lock = -1;                           // :46001-46004（ai[0]=0）
      }
    }
    if (this.ai177Lock < 0) {   // ★BJ-C3/F5：!gated 死支摘除（gated≡true,唯一调用位=917 支）
      let best: EnemyLike | null = null;
      let bestD = 400;                                 // maxRange=400（:46022）
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean };
        if (!en || en.dead) continue;
        if (!canBeChasedBy(e)) continue;               // :45922
        if (gated && this.ai177Immunity!.peek(en.id) > 0) continue;  // :45925 门（★本刀）
        const d = Math.hypot(en.cx - this.cx, en.cy - this.cy);  // Distance(nPC.Center)=随从心
        // ★BJ-C3/F4（2026-10-06）：首敌豁免摘除——:45929 `!(num<=num2)` 严格小于且
        //  num 初值=maxRange=400 即域门（d≥400 恒拒,原版无「首敌直纳」支）;旧
        //  `best === null ||` 令域外首敌入桶=豁免偏差（域内近敌仍最者胜,序等价）。
        if (d < bestD) { bestD = d; best = en; }                 // :45926-45930 !(num<=num2)
      }
      if (best && gated) this.ai177Lock = best.id;     // :46016-46017（ai[0]=whoAmI+1 等位）
      return best;
    }
    return this.enemyById(game, this.ai177Lock);       // 持锁跨拍（:45997 num2 直用）
  }

  /** 雾网蜘蛛 1036（Cobweb Whip 哨兵弹,AI_067 flag7 :50023 折算）——★BJ516①
   *  （2026-10-05,BJ515 登记债清偿）：SetDefaults :9769-9780 aiStyle=67 →
   *  AI_067_FreakingPirates flag7 支,旧 AI_177 悬停通道整体退役。flag7 面亲读钉死：
   *  · 生命绑定 :50027-50041：!player.active∨dead → cobWhipBuff=false+Kill;
   *    cobWhipBuff → timeLeft=2（本仓 whipBuffs[365] 直断,同 917 支续命门形）;
   *  · 免疫表载体共用（usesLocalNPCImmunity=true :9776 + localNPCHitCooldown=20
   *    :9777）——contact 写位/逐 t 衰减与 917 同槽;【索敌不消费】（:50520
   *    respectOwnerTarget=false → Minion_FindTargetInRange 焦点支整段跳过 :49888-49896,
   *    无免疫门/无锁,BJ515 债①翻案本位）;
   *  · flag7 族档 :50461-50466：num10=5/num9=0/flag14=false/friendly=true——
   *    flag14=false 关 :51023 俯扑与 :51077 boss>600 追离门 ⇒ 永不入 2/3/5 态
   *    （flinxStep flag5 同谳）;
   *  · 索敌 :50516-50527：Minion_FindTargetInRange(num2=450 :50048, skip=true,
   *    AI_067_CustomEliminationCheck_Pirates=恒 true :49922-49925 不建模,
   *    respectOwnerTarget=false);flag16=ai[0]==0 缺省;
   *  · 归位门 :51171 `ai[0]==0 && attackTarget<0 && !flag7`——flag7 被【显式排除】
   *    ⇒ 永不入 ai[0]=1 归位飞行、无 >2000 瞬移;state0 恒走步行链走回家
   *    （:51260-51272 num3=500/num4=300 剪枝向量 + <32 贴身锚回自 :51245-51250）;
   *  · 锚：有目标 = 敌心（:51012,flag7 无家族偏移支）;无目标 = player.Center
   *    （:50308 else 链无 flag7 支）+ :51213-51260 接地扫描/TileCollision 剪枝
   *    （groundAnchorScan 折算既有面）;
   *  · 步行 :51273-51557：ai067WalkChase 缺省档 0.5/4/4（:51296-51340 无 flag7 档）
   *    + TryJumpingToTarget 共享尾（:51024 有目标调用位,num4=30）+ dropThrough
   *    :50454/:52112 两写位;
   *  · 方向/帧 :51664-51686：spriteDirection = −direction（与全族反向,贴图右向）+
   *    rotation=0 恒;帧（读相=碰撞后重力前,capturePreGravVy 承载）：
   *    vy==0 ∧ vx==0 → 0/fc=0;vy==0 行走 → fc++>4 翻页循环全 20 帧
   *    （projFrames[1036]=20）;空中 → 1/fc=0;
   *  · contact cd=20（:9777）+armorPen 30（:9779,contact 内 pen0 通道既有）。 */
  private webStep(game: GameHooks, p: Player, dmg0: number): void {
    this.ai177Immunity ??= new LocalImmunityTable();
    this.ai177Immunity.tick();
    const st = game.world.store;
    const wet = this.wetAi;
    const tgtF = this.findTargetInRangeDual(game, 450,
      { skipIfCannotHitOwnBody: true, respectOwnerTarget: false });   // :50048/:50520-50523
    let ax: number, ay: number;
    if (tgtF) {
      ax = tgtF.cx; ay = tgtF.cy;
      this.ai67TryJumpingToTargetTail(tgtF.cy, false);   // :51024（双距域命中即等价）
      this.dropThrough = tgtF.cy > this.y + this.h;      // :52112
    } else {
      ax = p.cx; ay = p.cy;                              // :50308（flag7 无家族横移支）
      const g = this.groundAnchorScan(st, p, ax, ay);
      ax = g.x; ay = g.y;
      // <32 贴身锚回自（:51245-51250）：随从距锚 <32 ∧ 随从距玩家 < 锚距玩家 → 锚=自身（驻停）
      if (Math.hypot(ax - this.cx, ay - this.cy) < 32
        && Math.hypot(p.cx - this.cx, p.cy - this.cy) < Math.hypot(ax - p.cx, ay - p.cy)) {
        ax = this.cx; ay = this.cy;
      }
      this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);   // :50454
    }
    this.ai067WalkChase(game, p, ax, ay, null, { wet, capturePreGravVy: true });   // 缺省 0.5/4/4
    // 方向/帧面（:51664-51686）——facing=repo 的 spriteDirection 载体,direction=walkChase 既有面
    this.facing = -this.facing;                          // spriteDirection = −direction（:51668）
    this.rot = 0;                                        // :51669
    const grounded = this.lastWalkPreGravVy === 0;
    if (grounded) {
      if (this.vx === 0) { this.webFrame = 0; this.webFrameCd = 0; }        // :51671-51674
      else {
        if (++this.webFrameCd > 4) { this.webFrameCd = 0; this.webFrame++; } // :51675-51682
        if (this.webFrame >= projFrameCount(1036)) this.webFrame = 0;
      }
    } else {
      this.webFrameCd = 0; this.webFrame = 1;              // :51683-51686
    }
    this.contact(game, dmg0, 20);                          // :9777 cd=20
  }

  /** AI_053_HandleSentryNPCTargeting（:40920-40969）1:1——★BJ515 债③（2026-10-05,
   *  BJ514 批①登记债清偿）：哨兵族（aiStyle 53 三塔 308/377/966 :38030 调用点 +
   *  1025 借道 :41175,实参 num8=1000+num3×16=1240（num3=15 :41052,flag=1025 档
   *  :41150-41154））专用移植。原版形态：
   *  · 距离 = 【曼哈顿】 |muzzle−敌心|（:40931/:40954,muzzle=Center+firingOffset
   *    ——966 (0,-16) :38025-38028;1025 (0,10)/携行 (0,0) :41164-41168）,旧实现
   *    Euclid 自本体心=双偏差;
   *  · 视线 = straightLine ? CanHitLine : CanHit（:40935/:40958,双调用点均
   *    straightLine=false → CanHit 点对 muzzle→敌心 0,0 盒）,旧实现无视线门
   *    （隔墙开火伪影）;
   *  · 集火支先行（:40927-40944）：OwnerMinionAttackTargetNPC chaseable ∧
   *    曼哈顿 <maxDistance ∧ CanHit → 即收（maxDistance 收缩）;失收落野生扫
   *    （:40945-40968,过门即收缩 `num2 < maxDistance`,等距不覆写=首只胜出序）。
   *  旧 nearestEnemy(1000/1240) 的 900 集火窗/欧氏/无视面全退役。 */
  private sentryFindTarget(game: GameHooks, offX: number, offY: number,
    straightLine: boolean, maxDistance: number): EnemyLike | null {
    const st = game.world.store;
    const mx0 = this.cx + offX, my0 = this.cy + offY;  // position = Center + firingOffset
    const sight = (en: EnemyLike): boolean => straightLine
      ? canHitLine(st, mx0, my0, 0, 0, en.cx, en.cy, 0, 0)
      : canHit(st, mx0, my0, 0, 0, en.cx, en.cy, 0, 0);   // :40935/:40958（0,0 点对）
    const pOwn = this.ownerRef();
    const focus = (pOwn as unknown as { minionTargetId?: number } | null)?.minionTargetId ?? -1;
    if (focus >= 0) {
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean };
        if (!en || en.dead || en.id !== focus) continue;
        // :40928 门在距离求值前（单槽直查非全表扫——tTarget/findTargetInRangeDual 同式）
        if (!canBeChasedBy(e)) break;
        const d = Math.abs(mx0 - en.cx) + Math.abs(my0 - en.cy);   // :40931 曼哈顿
        if (d < maxDistance && sight(en)) return en;               // :40932-40942
        break;
      }
    }
    let best: EnemyLike | null = null;
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean };
      if (!en || en.dead) continue;
      if (!canBeChasedBy(e)) continue;                             // :40949
      const d = Math.abs(mx0 - en.cx) + Math.abs(my0 - en.cy);     // :40954 曼哈顿
      if (d < maxDistance && sight(en)) {                          // :40955-40965
        maxDistance = d;                                           // 收缩门（更远者整跳）
        best = en;
      }
    }
    return best;
  }

  /** AI_026 通用尾双轨索敌 1:1（flag10 段 :62598-62661 / 266 段 :62786-62850）——
   *  ★BJ515 债⑤（BJ514 批①登记债清偿）：191-194/266/1094/1113 形态归真。
   *  原版形态（旧 nearestEnemy 欧氏+900 集火窗+800/1160 检索帽退役）：
   *  · 距离 = 【曼哈顿】自本体心 `|pos+w/2−敌心x| + |pos+h/2−敌心y|`（:62611/:62639）;
   *  · 双轨：num139（CanHit 轨,初值 100000）与 num140（fallback 轨,初值 100000）
   *    分账——过 Collision.CanHit 本体盒→敌盒（:62620/:62648）才落 num139 并置
   *    num141;未过门仅当 num141==-1 时落 num140（fallback 瞄准）,检索本身
   *    【无射程门】（100000 帽）,射程在消费端（:62677 转向窗 num150=400/地下 200
   *    +num134=40×slot;:62691 开火窗 800+num134）;
   *  · 集火种子先行（:62606-62628/:62791-62813）：OwnerMinionAttackTargetNPC
   *    chaseable → 同双轨;野生扫只在 num141==-1 时跑（:62629/:62814）;
   *  · 前导：flag10 野生支瞄准 = 敌心 + velocity×20（:62645-62652,num142）;266 段
   *    与两段焦点支均敌心本值;
   *  · 合流（:62658-62661/:62847-62850）：num141==-1 且 num140<num139 → num139=num140。
   *  返回 = { tgt: num141 面（null=无 CanHit 候选）, dist: num139 合流值,
   *          aimX/aimY: num137/num138 瞄准点 }。
   *  （:62662-62665 `num141 != -1 → flag9=false` 抚摸打断位与 :62671 num151=450
   *  转向窗为本族运动面,本刀不接=登记。） */
  private ai026TailTarget(game: GameHooks, lead: boolean):
    { tgt: EnemyLike | null; dist: number; aimX: number; aimY: number } {
    let dist = 100000;                                 // num139（CanHit 轨）
    let tgt: EnemyLike | null = null;                  // num141
    let aimX = this.x, aimY = this.y;                  // num137/138 初值=本体左上（原文形）
    const fbDist2 = { v: 100000 };                     // num140 跨支可写账
    const fbAim = { x: aimX, y: aimY };
    const scan = (en: EnemyLike, isFocus: boolean): void => {
      const d = Math.abs(this.cx - en.cx) + Math.abs(this.cy - en.cy);   // :62611/:62639
      if (d >= dist) return;                           // :62612/:62640 外层门
      const canHitOk = canHit(game.world.store, this.x, this.y, this.w, this.h,
        en.x, en.y, en.w, en.h);                       // :62620/:62648/:62805/:62833 本体盒
      if (tgt === null && d <= fbDist2.v) {            // fallback 轨（:62614/:62642）
        fbDist2.v = d;
        fbAim.x = en.cx; fbAim.y = en.cy;              // 焦点支无前导（:62617-62618）
        if (!isFocus && lead) {                        // flag10 野生支 ×20 前导（:62645-62646;266 段无）
          fbAim.x += (en as unknown as { vx?: number }).vx !== undefined
            ? (en as unknown as { vx: number }).vx * 20 : 0;
          fbAim.y += (en as unknown as { vy?: number }).vy !== undefined
            ? (en as unknown as { vy: number }).vy * 20 : 0;
        }
      }
      if (canHitOk) {                                  // CanHit 轨（:62620-62626）
        dist = d;
        aimX = en.cx; aimY = en.cy;
        if (!isFocus && lead) {                        // flag10 野生支前导（:62651-62652;266 段无）
          aimX += (en as unknown as { vx?: number }).vx !== undefined
            ? (en as unknown as { vx: number }).vx * 20 : 0;
          aimY += (en as unknown as { vy?: number }).vy !== undefined
            ? (en as unknown as { vy: number }).vy * 20 : 0;
        }
        tgt = en;
      }
    };
    const pOwn = this.ownerRef();
    const focus = (pOwn as unknown as { minionTargetId?: number } | null)?.minionTargetId ?? -1;
    if (focus >= 0) {
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean };
        if (!en || en.dead || en.id !== focus) continue;
        // :62607/:62792 门在距离求值前（单槽直查）
        if (!canBeChasedBy(e)) break;
        scan(en, true);
        break;
      }
    }
    if (tgt === null) {                                // :62629/:62814 野生扫门
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean };
        if (!en || en.dead) continue;
        if (!canBeChasedBy(e)) continue;               // :62633/:62818
        scan(en, false);
      }
    }
    if (tgt === null && fbDist2.v < dist) dist = fbDist2.v;   // :62658-62661/:62847-62850
    return { tgt, dist, aimX: tgt ? aimX : fbAim.x, aimY: tgt ? aimY : fbAim.y };
  }

  /** ★BJ516④：MINION_SHOOT 出弹共享体（2026-10-05 自 fixedUpdate 通用射击块抽离——
   *  现役两消费点 = ai026TailGround num151 else-支（:62701-62760）与 387 通用块）：
   *  · cd = shooter.cd（:62710 ai[1]=num135——191-194/1113=30、1094=42 :62569-62573）;
   *  · 瞄准锥：X 抖 ±20 全族（:62707 rand(−20,21),1456 :58765 同谳——旧 1094/1113
   *    「无抖动」系误锚退役）+ Y 抖 num156（:62711-62713,flag8→0）+ precallY
   *    num155（:62708-62709 |num154|×0.1×Next(0,100)×0.001 重力预瞄,全族）;
   *  · 出弹锚 = 本体 Center + muzzleY（:62706 vector14=(cx, cy−8);flag8 支 :62740
   *    再 −2 ⇒ −10）− 弹型判定盒/2;burn 分档（Projectile.cs:11315-11318）。 */
  private shootMinionShot(game: GameHooks, dmg0: number,
    shooter: { shot: number; speed: number; cd?: number; jitter?: number; jitterY?: number;
      grav?: number; life?: number; muzzleY?: number; precallY?: boolean; dmgMul?: number;
      burn?: 'fire' | 'hellfire' }, aimX0: number, aimY0: number, foxAi1?: number): void {
    this.shootCd = shooter.cd ?? 60;
    const j = shooter.jitter ?? 0;
    const jy = shooter.jitterY ?? j;
    const ax = aimX0 + (Math.random() * 2 - 1) * j - this.cx;
    let ay = aimY0 + (Math.random() * 2 - 1) * jy - this.cy;
    if (shooter.precallY) {
      // :62708-62709 num155 = |num154|×0.1×Next(0,100)×0.001（num154 含 X 抖动）
      ay -= Math.abs(ax) * 0.1 * Math.floor(Math.random() * 100) * 0.001;
    }
    const al = Math.hypot(ax, ay) || 1;
    const dmg = Math.max(1, Math.round(dmg0 * (shooter.dmgMul ?? 1)));
    const ps = projectileData(shooter.shot);
    const hw = (ps?.width ?? 10) / 2, hh = (ps?.height ?? 10) / 2;
    const ay0 = this.cy + (shooter.muzzleY ?? 0);
    const shot = new Arrow(this.cx - hw, ay0 - hh, (ax / al) * shooter.speed, (ay / al) * shooter.speed,
      dmg, this.knockback, shooter.shot, { grav: shooter.grav ?? 0, life: shooter.life ?? 1200 });
    shot.whipTagShot = true; // MinionShot 吃鞭 tag（WhipTagEffect.cs:73-84）
    if (foxAi1 !== undefined) shot.foxAi1 = foxAi1;   // ★BJ525(c)：NewProjectile Ai1 形参直传（:62753 num159——1113 3/1 循环,余型缺省 0 不写）
    if (shooter.burn === 'fire') shot.onFireHit = { buff: 24, minT: 300, maxT: 599 };   // ★R1:Next(300,600)=[300,599]
    else if (shooter.burn === 'hellfire') shot.onFireHit = { buff: 323, minT: 300, maxT: 599 };
    const shotSfx = MINION_SHOT_SFX[shooter.shot];
    if (shotSfx) game.playSfxFiles(soundTrackFiles(shotSfx.track), shotSfx.vol, this.cx, this.cy);
    (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(shot, 'projectiles');
  }

  /** AI_026 通用尾族运动面（191-194/266/1094/1113,ai[0]==0 地面态 + ai[0]==1 归位
   *  飞行 1:1 折算）——★BJ516④（2026-10-05,BJ514 批①登记「尾运动面」清偿）：
   *  · num134=40×slot（:62568;1113 再 +360 :62674-62675）/num163 同值（266 段 :62774）;
   *  · 【num150 转向窗】（:62677-62690）：num150=400（worldSurface 下 200 :62678-62680,
   *    本仓 world.groundLevel≡worldSurface 恒等映射,BJ 案既有账）——无 CanHit 目标 ∧
   *    num139<num150+num134 → fallback 瞄准（尾面 aimX）±5 死区转向（:62689-62700）;
   *  · 【num151 转向-开火阈】（:62694-62707）：num151=450（1113 +180 :62682-62686）——
   *    有 CanHit 目标 ∧ num139<800+num134 → localAI[0]=60（:62693）;|Δx|>num151 走近
   *    （±50 死区 :62697-62700）,【否则出手】（:62701 else-if——旧实现无阈恒射退役）;
   *  · 266 段同构面（:62928-63016）：num180=300/地下 150（:62928-62934）fallback 转向
   *    ±5;接敌阈 ±10（:62983-62988）+ 高出跳表五显式档 <380 无兜底（:62978-62999,
   *    |Δx|<50∧a026VyCollide==0——★BJ520① 快照读相+五档归真）
   *    + friendly 随接敌域翻转（:62977/:63016——接触伤只在接敌窗,266 无弹不开火）;
   *  · 【flag9 抚摸打断】（:62662-62665+:63021-63028）：flag9 = petting∧beingPetted
   *    （:59101 逐拍）→ 取得 CanHit 目标拍清零（:62662,有敌时抚摸不打断交战）;
   *    共同尾 (ai[1]≠0 ∨ flag9) → 转向意图双清（:63021-63024,冷却/抚摸中驻停）;
   *    else if flag10∧localAI[0]==0 → direction=player.direction（:63026-63028）;
   *  · 步行加速（:63099-63196）：num185=6/num184=0.2 → catch-up（|p.v|>6 →
   *    num185=|p.v|,num184=0.3）→ flag10 ×2（0.4/0.6,266 不翻倍）;flag2: vx>−3.5 →
   *    −num184 else −num184×0.25（flag3 镜像）;双清 vx×0.9,|vx|≤num184 → 0;
   *  · 跳跃（:63197-63281）：意图单格探（walkerJumpIntent,:63172-63187）→ 落地
   *    梯跳五档（walkerJumpLadder −5.1..−11.1,支承闸同构）;266 行走恒小跳 vy−=6
   *    （:63275-63278 else-if 支）;vx 钳 ±num185（:63285-63290）;
   *  · 方向（:63283-63298）：flag26=!(flag8∧冷却)——flag8 冷却拍 vx×0.7（vy==0,
   *    :63014-63018）+方向冻结;facing=vanilla direction（skip 门探针用 :12437）;
   *    spriteDirection 面（191-194/266 =−direction :63300-63304 / 1094·1113
   *    =direction :63305-63307）未折算=绘制域登记（MINION_NO_FLIP 既有判例位）;
   *  · 垂直：191-194/1094/1113 地面态【零重力】（★BJ518②判谳更正：旧注「原版帧链
   *    :63345-66066 无此四型段」系误读——flag6/flag8 块尾自带 velocity.Y+=0.4 封 10
   *    （:64721-64726/:64826-64831）,原版有重力;本仓重力面登记未落=悬停近似,
   *    跳梯仍为唯一竖直源）;266 重力 0.4 封顶 10 + 湿浮升支
   *    （:65464-65523——wet∧玩家在上∧localAI[0]==0 → vy>−4 每拍 −0.2/vy>0 ×0.95）;
   *  · 归位门（:61292-61345）：num92=500+40slot+（localAI[0]>0→+500;266 再 +100）
   *    ——num95>num92 ∨（|Δy|>300∧localAI[0]≤0）→ ai[0]=1（vy 与玩家向反向清零
   *    :61336-61342）+ >2000 瞬移（:61321-61324）;
   *  · 归位飞行（:61395-61634）：tileCollide=false（湿阻尼块不跑,直写位）;锚=
   *    player.Center−40×dir−（玩家 num104=700/flag10 800 曼哈顿内无 CanHit 敌时再
   *    −40×slot×dir :61399-61409）;num101=0.8（flag10）·0.2（266）/num112=12·10
   *    （:61410-61418,flag10 catch-up num112=|p.v|）;落地门 num102=100·200 ∧ 玩家
   *    vy==0 ∧ 盒底不高于玩家盒底 ∧ 无实心重叠 → ai[0]=0（vy<−6→−6 :61481-61487）;
   *    玩家 60px 内漂移（:61488-61491）,否则向锚 ×num112/num110 逼近 ±num101
   *    （×1.5 超速带 :61637-61662）;近敌 CanHit 即取消归位（:61407-61409）;
   *  · 接触伤 = 缺省 −2 全局窗（CONTACT_CD_TABLE 既有解析）。★BJ517（2026-10-05）
   *    四登记面清偿：flag6 返程飞行帧 rand(12,18)（:61623-61627,a026RetFrame）/
   *    266 帧机分相（:65464-65500 地/空 + :62434-62444 返程,sl266Frame——
   *    MINION_FRAMES[266] 匀速近似退役）/flag8 alpha 淡入 1094 补档（构造器
   *    alphaFade,:62584-62586 flag22 门随之双型同相）/191-194·266 绘制翻转
   *    （:63319-63329 sd=−direction + 266 静止朝玩家 :65481-65487,存
   *    a026SpriteDir——facing=direction 保持,:12437 探针不反）。 */
  private ai026TailGround(game: GameHooks, p: Player, dmg0: number,
    tail: { tgt: EnemyLike | null; dist: number; aimX: number; aimY: number }): void {
    const st = game.world.store;
    const is266 = this.projId === 266;
    const isF6 = this.projId >= 191 && this.projId <= 194;   // ★BJ517②⑤：俾格米 flag6
    const isF8 = this.projId === 1094 || this.projId === 1113;
    const isF10 = !is266;                                          // flag10 = 191-194∪flag8
    const slot = this.slot;
    let num134 = 40 * slot;                                        // :62568/:62774
    if (this.projId === 1113) num134 += 360;                       // :62674-62675
    const underground = game.world.groundLevel > 0 && this.y > game.world.groundLevel * 16;
    if (this.a026L0 > 0) this.a026L0--;                            // :62572-62575/:62777-62780
    if (this.shootCd > 0) this.shootCd--;                          // ai[1]--（:62587-62590/:62779-62781）
    const flag9Base = p.petting.isPetting && this.beingPetted;     // :59101 逐拍
    // ---- 归位门（:61292-61345）----
    // ★BJ520②（2026-10-05,BJ519① 登记债清偿）：flag10 岩浆逃逸门——AI_026 顶
    //  :59170-59178 `if (flag10) { if (lavaWet) { ai[0]=1f; ai[1]=0f; }
    //  num=60+30*minionPos; } else if (type==266) {...}`：逐拍无条件（lavaWet 粘滞
    //  位——入过岩浆即持续逃逸直至 !wet 三清）;flag10=flag6|flag8=191-194∪1094/1113,
    //  266 走 else-if 支不逃逸。读相=lavaWetAi 上拍快照（AI 先于湿段,wetAi 同批口径;
    //  湿段承载=MINION_WET_IDS 本批补注册 191-194/266）。★BJ521②（2026-10-05）：
    //  备案债清偿——foxChannel 喷火支已折本门序（AI 分派处 !lavaWetAi 先跳喷火支,
    //  fall-through 至此门=:59170 先于 :60011 喷火块同相;draw 侧同门）,旧「电平驱动
    //  未折算=近似」注销;归位门两处 pre-move vy 符号读 +0.4 残留维持
    //  BJ519① 原备案（|vy|∈(0,0.4] 窗符号差,飞行覆盖后零观测差）。
    if (isF10 && this.lavaWetAi) {
      this.a026A0 = 1;                                             // :59174 ai[0]=1f
      this.shootCd = 0;                                            // :59175 ai[1]=0f
    }
    const num92 = 500 + 40 * slot
      + (this.a026L0 > 0 ? 500 : 0)
      + (is266 && this.a026L0 > 0 ? 100 : 0);                      // :61292-61300
    const dxp = p.cx - this.cx, dyp = p.cy - this.cy;
    const num95 = Math.hypot(dxp, dyp);
    if (num95 > 2000) {                                            // :61321-61324 瞬移
      this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2;
    } else if (num95 > num92 || (Math.abs(dyp) > 300 && this.a026L0 <= 0)) {
      if (dyp > 0 && this.vy < 0) this.vy = 0;                     // :61336-61342
      if (dyp < 0 && this.vy > 0) this.vy = 0;
      this.a026A0 = 1;
    }
    // ---- ai[0]==1 归位飞行（:61395-61634）----
    if (this.a026A0 === 1) {
      this.tileCollide = false;
      const num101 = isF10 ? 0.8 : 0.2;                            // :61399→:61410→:61413 链
      const num102 = isF10 ? 100 : 200;                            // :61401/:61397
      let num112 = isF10 ? 12 : 10;                                // :61411/:61396
      const pv = Math.abs(p.vx) + Math.abs(p.vy);
      if (isF10 && num112 < pv) num112 = pv;                       // :61415-61417 catch-up
      // 锚（:61399-61409）：玩家心 −40×dir;玩家 num104 曼哈顿内有敌→不再 −40×slot×dir,
      // 且该敌 CanHit → 即取消归位（ai[0]=0,本拍仍走飞行积分,次拍落地面态=原版同相）
      let num103 = p.cx - this.cx - 40 * p.facing;
      const num109 = p.cy - this.cy;
      const num104 = isF10 ? 800 : 700;
      let flag20 = false;
      let num105 = -1;
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean };
        if (!en || en.dead || !canBeChasedBy(e)) continue;
        if (Math.abs(p.cx - en.cx) + Math.abs(p.cy - en.cy) < num104) {
          flag20 = true;
          if (canHit(st, this.x, this.y, this.w, this.h, en.x, en.y, en.w, en.h)) num105 = en.id;
          break;                                                   // 首只即断（原文 break 在 CanHit 外）
        }
      }
      if (!flag20) num103 -= 40 * slot * p.facing;
      if (flag20 && num105 >= 0) this.a026A0 = 0;                  // :61407-61409
      const num110 = Math.hypot(num103, num109);
      if (this.a026A0 === 1 && num110 < num102 && p.vy === 0
        && this.y + this.h <= p.y + p.h && !this.solidOverlap(st)) {
        this.a026A0 = 0;                                           // :61481-61487 落地
        if (this.vy < -6) this.vy = -6;
      }
      let tx = num103, ty = num109;
      if (num110 < 60) { tx = this.vx; ty = this.vy; }             // :61488-61491 漂移
      else { const k = num112 / num110; tx = num103 * k; ty = num109 * k; }
      // ±num101 逼近（:61637-61662,×1.5 超速带）
      if (this.vx < tx) { this.vx += num101; if (this.vx < 0) this.vx += num101 * 1.5; }
      if (this.vx > tx) { this.vx -= num101; if (this.vx > 0) this.vx -= num101 * 1.5; }
      if (this.vy < ty) { this.vy += num101; if (this.vy < 0) this.vy += num101 * 1.5; }
      if (this.vy > ty) { this.vy -= num101; if (this.vy > 0) this.vy -= num101 * 1.5; }
      // ★BJ517②⑤（返程相绘制域,Projectile.cs:61622-61638）：
      //  · flag6 飞行帧 :61623-61627——frame<12 → rand(12,18)（12-17 一达即停;
      //    per-type 帧链 :61880-62460 无 flag6 项=掷后冻结）——a026RetFrame<12 门
      //    =原版 frame 共享域 <12 重掷面（−1 初值恒 <12=入场首拍掷一次）
      //  · 266 返程帧机 :62434-62444——fc>5 → frame++,frame<8∨≥12 → 8（循环 8-11,
      //    projFrames[266]=12 Main.cs:8751）
      //  · 速度翻转 :61628-61638（313 豁免不含尾族）——vx>0.5→−1 / vx<−0.5→+1,
      //    死区 |vx|≤0.5 保旧值（sd 写 a026SpriteDir,facing=direction 不动 :12437）
      if (isF6 || is266) {
        if (this.vx > 0.5) this.a026SpriteDir = -1;
        else if (this.vx < -0.5) this.a026SpriteDir = 1;
      }
      if (isF6 && this.a026RetFrame < 12) {
        this.a026RetFrame = 12 + Math.floor(Math.random() * 6);
      }
      if (is266) {
        if (++this.sl266Fc > 5) { this.sl266Fc = 0; this.sl266Frame++; }
        if (this.sl266Frame < 8 || this.sl266Frame >= 12) this.sl266Frame = 8;
      }
      // ★BJ518①（2026-10-05）：返程相 rotation 写梯（绘制域 C 类）——266 专支
      //  :62225 rotation=velocity.X×0.1;191-194 返程链无专支 → 通用尾 :62462-62468
      //  （spriteDirection==−1 → atan2(vy,vx),否则 atan2+3.14f——f32 字面照录
      //  Math.fround(3.14)≠π）;1094/1113 flag8 头卧支 :61645 rotation=0（本仓 fox
      //  rot 恒 0 同相,不另写）。原版 rot 值读 sd 后 → 本写位在翻转/帧机之后同相
      if (is266) {
        this.rot = this.vx * 0.1;
      } else if (isF6) {
        this.rot = this.a026SpriteDir === -1
          ? Math.atan2(this.vy, this.vx)
          : Math.atan2(this.vy, this.vx) + Math.fround(3.14);
      }
      // ★BJ518③（2026-10-05）：flag8 rest 块 alpha=255 重淡入（:61649-61652——
      //  player.fullRotation≠0 ∨ (mount.Active ∧ PlayerIsHidden) → alpha=255,下拍
      //  DoPalAppearEffect −15 重淡入+尘）。载体备案：原版该写在 flag8 头卧支
      //  （ai[0]==1 时狐【骑头居停】Center=MountedCenter+(0,−10)/frame=0/velocity=
      //  (direction,0),本仓返程飞行近似未落——头卧支本体=登记债）;门条件 1:1
      //  （playerFullRotationOf 单源=Minecart 轨/滚轴鞋/Hover 7·8·23;43/49/55 未建模
      //  恒 0=Mounts.ts 既有备案）
      if (isF8) {
        const frRest = playerFullRotationOf(p, p.mount, p.cart);
        if ((frRest !== null && frRest.angle !== 0)
          || (p.ridingMount && !!MOUNT_SETS.PlayerIsHidden?.[p.mount.type])) {
          this.alphaFade = 255;
        }
      }
      this.x += this.vx; this.y += this.vy;                        // tileCollide=false 直写
      // ★BJ519①：flight 无碰撞直通快照（原版 flight 相 tileCollide=false → post-AI
      //  碰撞解算跳过,velocity.Y 直通到下拍意图相读=同相）
      this.a026VyCollide = this.vy;
      // ★BJ698：归位飞行接触=唯 266（残留 friendly 承袭——AI_026 蜘蛛/266 块
      //  :62963-63017 仅地面态写,ai[0]==1 段零写位=Projectile.friendly 保持上地面拍值）。
      //  191-194/1094/1113 永假（无任何写位+SetDefaults 无 friendly=true）→ 永不接触
      //  （另被 projPet 门 :12495 无 carve-out 双拒）。旧无条件=四族多窗。
      if (is266 && this.a026Friendly) this.contact(game, dmg0);
      return;
    }
    // ---- ai[0]==0 地面态（:62564-63340 折算）----
    let flag22 = this.shootCd <= 0;                                // :62583-62590
    if (isF8 && (this.alphaFade > 0 || this.a026L0 > 0)) flag22 = false;   // :62584-62586（alpha 通道登记见注）
    let flag2 = false, flag3 = false;
    let flag9 = flag9Base;
    if (flag22) {
      if (tail.tgt) flag9 = false;                                 // :62662-62665 抚摸打断
      if (!is266) {
        // flag10 段（:62677-62753）
        const num150 = underground ? 200 : 400;                    // :62677-62680
        const num151 = this.projId === 1113 ? 630 : 450;           // :62682-62686
        if (tail.tgt === null && tail.dist < num150 + num134) {
          const num152 = tail.aimX - this.cx;                      // :62690-62700
          if (num152 < -5) { flag2 = true; flag3 = false; }
          else if (num152 > 5) { flag3 = true; flag2 = false; }
        } else if (tail.tgt && tail.dist < 800 + num134) {
          this.a026L0 = 60;                                        // :62693 num136
          const num153 = tail.aimX - this.cx;                      // :62694-62700
          if (num153 > num151 || num153 < -num151) {
            if (num153 < -50) { flag2 = true; flag3 = false; }
            else if (num153 > 50) { flag3 = true; flag2 = false; }
          } else {
            // 开火（:62701-62760）：ai[1]=num135 + 瞄准锥（shootMinionShot 承载）;
            // flag8 fire 支再置 localAI[0]=num135（:62741——30/42,L0 门主导再射节拍,
            // 191-194 无此支:L0 门=flag8 专属 :62584-62586,cd=num135 独立主导）
            // ★BJ525(c)（2026-10-05,R4 F3 域旧账清偿）：1113 ai[1] 第 N 发循环归真
            //  （:62742-62751 逐字）——flag8 每发 localAI[2]--（:62742,1094/1113 双达,
            //  寄存器=本仓 palJoyCd 同窗判例:shot 循环负域 [-3,0] 与 joy 正域 (0,60]
            //  不交,原版同槽共享）;1113 恒 num159=3,L2<=-3 → 归 0+num159=1（拆弹
            //  自爆门 Arrow :5853 foxAi1===1&&age>=30→Kill + Kill 拆 8 弹 :4135 的
            //  激活注入面——R4 F3 预留 foxAi1 通道自此接通;旧注入误挂通道 1106 支=
            //  恒假死支已摘）。1094 无 1113 支:num159 恒 0（L2 负漂不止=原版同构,
            //  joy 门 :59107 ==0 随之闭锁=原版怪癖 1:1）。周期=自 0 起 -1/-2/-3 回卷
            //  → 每 3 发第 3 发为拆弹弹（旧注「每 4 连发第 4 发」系 R4 F3 误计）。
            const shooter = MINION_SHOOT[this.projId];
            if (shooter) {
              let foxAi1Val: number | undefined;
              if (isF8) {
                this.palJoyCd--;                                              // :62742
                if (this.projId === 1113) {                                   // :62743
                  foxAi1Val = 3;                                              // :62745
                  if (this.palJoyCd <= -3) { this.palJoyCd = 0; foxAi1Val = 1; }   // :62746-62750
                }
              }
              this.shootMinionShot(game, dmg0, shooter, tail.aimX, tail.aimY, foxAi1Val);
              if (isF8) this.a026L0 = shooter.cd ?? 30;   // :62741
            }
          }
        }
      } else {
        // 266 段（:62928-63016）
        const num180 = underground ? 150 : 300;                    // :62928-62934
        if (tail.tgt === null && tail.dist < num180 + num134) {
          const num181 = tail.aimX - this.cx;                      // :62965-62976
          if (num181 < -5) { flag2 = true; flag3 = false; }
          else if (num181 > 5) { flag3 = true; flag2 = false; }
        }
        if (tail.tgt && tail.dist < 800 + num134) {
          this.a026Friendly = true;                                // :62977
          this.a026L0 = 60;                                        // :62979 num164
          const num182 = tail.aimX - this.cx;                      // :62983-62988
          if (num182 < -10) { flag2 = true; flag3 = false; }
          else if (num182 > 10) { flag3 = true; flag2 = false; }
          // ★BJ520①（2026-10-05,BJ519① 登记债清偿）：本门 `velocity.Y == 0f`（:62978）
          //  为 AI 相读=上拍碰撞解算值——改读 a026VyCollide 快照（与 flag26 制动同病
          //  同法,BJ519① 先例;BJ516④ 重力落域后 pre-move 直读带 +0.4 残留 → 门死）。
          //  五档跳出表随批归真（:62979-62999）：原版五显式档无兜底——<120→-10/
          //  <210→-13/<270→-15/<310→-17/<380→-18,≥380 不写（旧 `: -18` 兜底误跳）。
          if (tail.aimY < this.cy - 100 && num182 > -50 && num182 < 50 && this.a026VyCollide === 0) {
            const num183 = Math.abs(tail.aimY - this.cy);          // :62979-62999 高出跳表
            if (num183 < 120) this.vy = -10;
            else if (num183 < 210) this.vy = -13;
            else if (num183 < 270) this.vy = -15;
            else if (num183 < 310) this.vy = -17;
            else if (num183 < 380) this.vy = -18;
          }
        } else {
          this.a026Friendly = false;                               // :63016
        }
      }
    }
    // 共同尾（:63021-63028）：冷却/抚摸 → 意图双清;flag10 且无记账 → 朝玩家转向
    if (this.shootCd > 0 || flag9) { flag2 = false; flag3 = false; }
    else if (isF10 && this.a026L0 === 0) this.facing = p.facing;   // :63026-63028
    // 步行加速（:63099-63196）
    let num184 = 0.2, num185 = 6;
    const pv2 = Math.abs(p.vx) + Math.abs(p.vy);
    if (num185 < pv2) { num185 = pv2; num184 = 0.3; }              // :63105-63108 catch-up
    if (isF10) num184 *= 2;                                        // :63109-63111
    // ★BJ519①：flag26 攻击制动读相=碰撞后（原版此处 velocity.Y==0 读上拍碰撞解算值,
    //  落地恒 0）——重力面落域后 pre-move 直读带 +0.4 残留 → 改读 a026VyCollide 快照
    if (isF8 && this.shootCd > 0 && this.a026VyCollide === 0) this.vx *= 0.7; // :63014-63018（flag26=false 支）
    if (flag2) {
      this.vx = this.vx > -3.5 ? this.vx - num184 : this.vx - num184 * 0.25;   // :63161-63168
    } else if (flag3) {
      this.vx = this.vx < 3.5 ? this.vx + num184 : this.vx + num184 * 0.25;    // :63169-63176
    } else {
      this.vx *= 0.9;                                              // :63177-63184
      if (this.vx >= -num184 && this.vx <= num184) this.vx = 0;
    }
    // 跳跃（:63197-63281）：意图单格探 → 落地梯跳五档;266 行走恒小跳
    const dirX = flag2 ? -1 : flag3 ? 1 : 0;
    const flag5 = (flag2 || flag3) && this.walkerJumpIntent(st, dirX);
    // ★BJ673 勘误（2026-10-14 红蓝 R3-F#1 翻案 BJ672）：AI_026_TAIL 7 vid
    //  （191-194/266/1094/1113）在 Main.projPet 全表（Main.cs:8878/:8886-8889/
    //  :8914/:8916——projPet=宠物∪随从全集,非 SetDefaults pet 字段!）→ 弹面
    //  flag6=:17589 projPet 门（false=承接,玩家脚低于弹底 12px 才穿）。aiStyle 26
    //  无后置覆写。BJ672 曾误判恒穿（提取器查错载体）=移除承接门=站平台行走机制
    //  被毁。恢复原版 −12 门（:2536/:6345 同式先例;旧 −8 系锚 AI_026 flag4 阈值,
    //  实为 :17591 −12）。
    this.dropThrough = (p.y + p.h - 12) > (this.y + this.h);
    this.tileCollide = true;                                       // :63098
    const dfA026 = projWaterDragFactor(this);
    const xPreMoveA026 = this.x;   // ★BJ517③/BJ518②：flag27 判据（本拍位移零=机器读相「最近位移」;266 与 191-194 帧机共用同一快照）
    moveAndCollide(this, game.world, this.vx * dfA026, this.vy * dfA026);
    if (this.vy === 0) {
      if (flag5) this.walkerJumpLadder(st, dirX);                  // :63217-63274 梯跳
      else if (is266 && (flag2 || flag3)) this.vy -= 6;            // :63275-63278 行走小跳
    }
    this.a026VyCollide = this.vy;   // ★BJ519①：碰撞后重力前快照（跳梯写入后,重力前=原版帧块读相）
    this.vx = Math.max(-num185, Math.min(num185, this.vx));        // :63285-63290
    // 方向（:63283-63298;flag8 冷却拍方向冻结=flag26 面）——facing=vanilla direction
    // （canHitWithOwnBodyBox skip 门用 direction 探针 :12437-12440,翻转面不得入此字段;
    //  spriteDirection 面（191-194/266 =−direction,1094/1113 =direction）已由
    //  ★BJ517⑤ 清偿=a026SpriteDir 绘制域直存,见下方翻转写）
    if (!(isF8 && this.shootCd > 0)) {
      if (this.vx < 0) this.facing = -1;
      else if (this.vx > 0) this.facing = 1;
      if (this.vx > num184 && flag3) this.facing = 1;
      if (this.vx < -num184 && flag2) this.facing = -1;
    }
    // ★BJ517⑤：常驻相 spriteDirection=−direction（:63319-63329——type!=313 全族,
    // 尾族 191-194/266 消费;1094/1113 同拍被 :63330-63333 覆写回 =direction,
    // 本仓 facing 即 direction 不另存）
    if (isF6 || is266) this.a026SpriteDir = -this.facing;
    // ★BJ517③：266 帧机分相（:65464-65500——原版机器内联帧链,读「最近一次位移+
    // 碰撞后」的 velocity.Y;本仓 moveAndCollide 已先行,读相=碰撞后重力前,flag27=
    // 本拍 moveAndCollide 前后 X 相等（原版 :63334 oldPosition 差,一拍相位差与
    // BJ516④ 运动面既有折相一致）。MINION_FRAMES[266] 匀速近似随此退役）
    if (is266) {
      const flag27A = this.x === xPreMoveA026;
      if (this.vy !== 0) {                             // 空中（:65466-65477,每 5t 循环 1-7）
        if (++this.sl266Fc > 4) { this.sl266Fc = 0; this.sl266Frame++; }
        if (this.sl266Frame === 0 || this.sl266Frame >= 8) this.sl266Frame = 1;
      } else {                                         // 地面（:65479-65500,每 8t 0/5/6/7）
        if (flag27A) {
          this.a026SpriteDir = -1;                     // :65481-65487 静止朝玩家
          if (p.cx < this.cx) this.a026SpriteDir = 1;
        }
        if (++this.sl266Fc > 7) {
          this.sl266Fc = 0; this.sl266Frame++;
          if (this.sl266Frame === 1) this.sl266Frame = 5;
        }
        if ((this.sl266Frame >= 1 && this.sl266Frame <= 4) || this.sl266Frame >= 8) this.sl266Frame = 0;
      }
    } else if (isF6) {
      this.a026RetFrame = -1;   // ★BJ517②：地面态帧域交还（返程冻结帧失效）
      // ★BJ518②：191-194 地面态帧机 1:1（:64660-64726——读相=碰撞后（moveAndCollide
      //  已先行,同 266 机 BJ517③ 折相）;ai[1]=shootCd 槽（BJ516④ 同账）;localAI[1]=
      //  a026Lai1。★BJ519①：重力面已落（下方 else-if 支）→ 空中帧 4 于离台/落坑/
      //  跳梯弧段均可达=原版同相）
      if (this.shootCd > 0) {                            // 攻击（ai[1] > 0 :64662-64682）
        if (this.a026Lai1 === 0) { this.a026Lai1 = 1; this.a026F6Frame = 1; }
        if (this.a026F6Frame !== 0) {
          if (++this.a026F6Fc > 4) { this.a026F6Frame++; this.a026F6Fc = 0; }
          if (this.a026F6Frame >= 4) this.a026F6Frame = 0;
        }
      } else if (this.vy === 0) {                        // 落地（:64683-64710）
        this.a026Lai1 = 0;
        if (this.x === xPreMoveA026) {                   // flag27 静立（:64685-64689）
          this.a026F6Frame = 0;
          this.a026F6Fc = 0;
        } else if (this.vx < -0.8 || this.vx > 0.8) {    // 步行（:64691-64699）
          this.a026F6Fc += Math.trunc(Math.abs(this.vx));   // (int)Math.Abs(velocity.X)
          this.a026F6Fc++;
          if (this.a026F6Fc > 6) { this.a026F6Frame++; this.a026F6Fc = 0; }
          if (this.a026F6Frame < 5 || this.a026F6Frame >= 11) this.a026F6Frame = 5;
        } else {
          this.a026F6Frame = 0;                          // 慢速归 0（:64700-64704）
          this.a026F6Fc = 0;
        }
      } else {                                           // 空中上下同帧 4（:64711-64720 两支同写）
        this.a026F6Fc = 0;
        this.a026F6Frame = 4;
      }
    }
    // 266 帧段垂直面（:65502-65523）：湿浮升与重力互斥（if/else 原文）。
    // ★BJ518②判谳更正（BJ519① 落域）：191-194/1094/1113 并非「零重力悬停」——
    //  flag6/flag8 块尾自带 velocity.Y+=0.4 封 10（:64721-64726/:64826-64831 括深 4
    //  实证）,登记债本批清偿（下方 else-if 支）。落地支语义：地面态=上拍碰撞解算后
    //  vy==0（帧块走地面帧）→ 本拍尾重力写入 0.4 → 下拍 moveAndCollide 落格归零,
    //  稳态 y 不漂;离台/落坑即 vy 累积（0.4 起,封顶 10）=原版下落同相
    if (is266) {
      if (this.wetAi && this.a026L0 === 0 && p.y + p.h < this.y + this.h) {
        if (this.vy > -4) this.vy -= 0.2;
        if (this.vy > 0) this.vy *= 0.95;
      } else {
        this.vy = Math.min(this.vy + 0.4, 10);
      }
    } else if (isF6 || isF8) {
      // ★BJ519①：flag6/flag8 块尾重力 1:1——无 266 式湿浮支（flag6/flag8 块内
      //  仅 帧3支+重力2行,原文无 wet 分支）,干湿同式;折相=266 既有重力同位
      //  （moveAndCollide 后、次拍积分）
      this.vy = Math.min(this.vy + 0.4, 10);
    }
    // 接触伤：★BJ698 定谳勘误——191-194/1094/1113 SetDefaults【无】friendly=true
    //  （Projectile.cs :2793-2815/:10212-10222/:10379-10389 亲读）且 AI_026 friendly
    //  写位仅 (266|flag7) 块 :62963-63017（俾格米 flag6/狐 flag8 均不达）+ projPet 门
    //  :12495 无 carve-out（191-194/1094/1113）⇒ 本体【永不可伤】（旧注「恒开」系
    //  伪锚,输出全在 195 掷矛/1097 火球上）。唯 266 carve-out（`type != 266`）+ friendly
    //  随接敌域翻转（:62977/:63016）——contact 无 friendly 通道,以 a026Friendly 门承载。
    if (is266 && this.a026Friendly) this.contact(game, dmg0);
    this.recordGhostTrail();
  }

  private guardianBody(game: GameHooks, p: Player, dmg0: number): void {
    const add = (e: unknown) =>
      (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(e, 'projectiles');
    // ★BJ157⑧ 显隐门（:45481-45499 top-of-AI,flag 块内）：ai[0]!=3 ∧ alpha==255 →
    //  显形 + 30 粒尘爆（状态 3 隐身飞行离场后的下一拍复位;出生 alpha=0 不触发）
    if (this.gA0 !== 3 && this.gAlpha === 255) {
      this.gAlpha = 0;
      this.guardianDustBurst(game, false);
    }
    const restX = p.cx - (5 + p.w / 2) * p.facing; // :45484（(5+player.width/2)×direction）
    const restY = p.cy - 25;                        // :45485
    if (this.gA0 === 2) {
      // ---- 状态 2：冲刺拳击 ----
      const tgt = this.enemyById(game, this.gA1);
      const inRange = tgt && Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy) <= 500; // :42203（Distance > num3=500 作废）
      const nearPlayer = Math.hypot(p.cx - this.cx, p.cy - this.cy) < 500;          // :42196（flag5）
      if (!tgt || !inRange || !nearPlayer) {
        this.gA0 = 0; this.gA1 = -1; // :42208-42212
        this.gFrame = 18;            // :42213-42216（收拳帧）
      } else {
        const dirX = tgt.cx - p.cx > 1 ? 1 : -1;    // :42220
        // :42221 目标位 = 敌心 + (-dirX×(敌宽/2+70), -10)
        const relX = tgt.cx - dirX * (tgt.w / 2 + 70) - this.cx;
        const relY = tgt.cy - 10 - this.cy;
        // :42222 maxAmount = 6×Remap(dist, 50→400, 1→4)
        const dist = Math.hypot(relX, relY);
        const maxAmt = 6 * remap01(dist, 50, 400, 1, 4);
        const dl = Math.hypot(relX, relY);
        const desX = dl <= maxAmt ? relX : relX / dl * maxAmt; // MoveTowards(Zero, rel, maxAmt)
        const desY = dl <= maxAmt ? relY : relY / dl * maxAmt;
        // :42224-42225 velocity.MoveTowards(desired, 32)
        const vl = Math.hypot(desX - this.vx, desY - this.vy);
        if (vl > 32) { this.vx += (desX - this.vx) / vl * 32; this.vy += (desY - this.vy) / vl * 32; }
        else { this.vx = desX; this.vy = desY; }
        this.facing = dirX; // :42226
        this.x += this.vx; this.y += this.vy;
        // 每 4t 重锁 500 内最近敌（1457 :45710-45720 localAI[0]++>=3 →
        //  AI_120_..._FindTarget(num2=500)——★BJ514：玩家心锚/无集火/无 tag 桶）
        if (++this.gRetarget >= 4) {
          this.gRetarget = 0;
          const nt = this.ai120FindTarget(game, p);
          if (nt) this.gA1 = nt.id;
        }
        // 攻击帧 12-19（12/13 快速、14 后保持 :42173-42191）
        if (this.gFrame < 12) this.gFrame = 12;
        const rate = this.gFrame === 12 || this.gFrame === 13 ? 8 : 3;
        if (++this.gFc >= rate) { this.gFc = 0; if (++this.gFrame >= 19) this.gFrame = 14; }
        // 拳盒命中（:14294-14300：状态 2 才有碰撞，80×40 @ Center+direction×40）
        for (const ent of game.enemies()) {
          if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
          const en = ent as never as EnemyLike & import('./WhipTag').WhipTagged;
          if (en.dead) continue;
          const bx = this.cx + this.facing * 40 - 40, by = this.cy - 20;
          if (en.x + en.w <= bx || en.x >= bx + 80 || en.y + en.h <= by || en.y >= by + 40) continue;
          // ★BJ467⑥ :12686 头门前置（Damage_PVE 循环门 `flag2 && (!dontTakeDamage ||
          //  ZappingJellyfish)` 先于 Inner 全链）——dontTakeDamage 靶不达 TimerCrit/tag
          //  ModifyHit,也不白吃 hitCd 私表（快照纪律,读 hurt 前状态）。623 aiStyle 120
          //  非接触反噬族（JELLY_ZAP_AI_STYLES={19,161,75,140}∪{972,982,984,997,1043}）
          //  → dontTakeDamage 水母亦无 zap 口,整跳=原版净语义。
          if ((en as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
          if (MinionProj.enemyImmune(en)) continue;   // ★BJ452 N5 :12636 三族共门（623 命中盒 Colliding :15611-15621 走 Damage_PVE_Inner 同链——窗拒拍不白吃私表 cd,contact() :4809 同构补）
          if (!this.hitCd.ready(en.id, 5)) continue; // localNPCHitCooldown=5（:6433）
          // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit 前）：
          //  TimerCrit :12928 + 武僧 688-690 强制掷 :12929-12943（623 恒假,形位保留）
          const timerCritFist = tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);
          const monkCritFist = monkAuraForcedCrit(this.ownerRef(), this.projId);
          const res = resolveWhipTagHit(en, dmg0, game, add, SUMMON_TAG_MUL[623] ?? 1, en.cx, en.cy,
            this.ownerRef());
          // ★BJ452 N2 crit 色位（res.crit=tag 掷率强制位 WhipTagEffect.cs:70-72——Enemy.hurt
          //  纯染色,数值预倍已在 res.dmg 内,零数值风险;contact() :4864 同式先例）
          //  ★BJ453 并链：crit 源 ‖ timerCritFist（:12928）‖ monkCritFist（:12929-12943）,
          //  新源强制时补一次 ×2（res.crit 的 ×2 已嵌 res.dmg——单一翻倍,原版序）
          const critFist = res.crit || timerCritFist || monkCritFist;
          // ★BJ455⑤ 受理前置快照（contact() :4852 mainGated 同式）——ghostHeal 门判据
          const guardGated = en.dead
            || (en as { dontTakeDamage?: boolean }).dontTakeDamage === true;
          // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970,owner luck）——tag→DV 原序
          const dmgVFist = damageVarRoll(res.dmg, this.ownerRef()?.luck ?? 0);
          en.hurt(applyBannerDamageDealt(game, en, critFist && !res.crit ? dmgVFist * 2 : dmgVFist), Math.sign(en.cx - this.cx) * this.knockback, -1, game, 0, critFist, 1, true); // 随从=单发弹语义(不设敌方帧);fromPlayer=DPS 计
          // ★Z1/D1② ghostHeal 白耗/治疗面（:13877-84 通用 on-hit 段,拳盒 623 同面;
          //  受理门=:12600/:12686 dontTakeDamage——拒收拍 num41=0 flag10 整段不可达）
          //  ★BJ455⑤ 门径统一（原版 :13712 `flag10 |= num41>0` 在 StrikeNPC :13702 后
          //  无死亡复查,BJ405 'proc/numHits++ 在受理面无死亡复查'——击杀拍照回血;旧
          //  post-hurt !en.dead 门=击杀拍断供,爆弹臂/光环臂同刀统一）
          if (!guardGated) {
            ghostHealProc(game, this.projId, this.pveNumHits,
              en as unknown as Parameters<typeof ghostHealProc>[3]);
            this.pveNumHits++;   // :14263
          }
          applyProjStatus(this.projId, en as unknown as Record<string, number>, { catalystBand: this.ownerRef()?.equipStats.catalystBand }); // StatusNPC(:10555)+6185 催化指环 398
          this.attackFlash = 24;
          // ★2026-09-01 StardustPunch(7) 出手面（Projectile.cs:14331-14337,type==623
          //  Damage 命中支,clientOnly:false → 本地直生 + module8 上行,原版即全网）：
          //  PositionInWorld = Lerp(Center, targetNPC.Hitbox.ClosestPointInRect(Center), .5)
          //  + (0, NextFloatDirection×10)；MovementVector = (direction, NextFloatDirection×.5)
          //  ×(3+3r)。星尘护手 623 星屑紫罗兰光点消费本体 stardustPunchFx（δB B11 同
          //  "命中拍逐靶一发"口径）。
          {
            const clx = Math.max(en.x, Math.min(this.cx, en.x + en.w));
            const cly = Math.max(en.y, Math.min(this.cy, en.y + en.h));
            const px623 = (this.cx + clx) * 0.5, py623 = (this.cy + cly) * 0.5
              + (Math.random() * 2 - 1) * 10;
            const mv623m = 3 + 3 * Math.random();              // 乘区共用一掷（:14334）
            const mv623x = this.facing * mv623m;
            const mv623y = (Math.random() * 2 - 1) * 0.5 * mv623m;
            stardustPunchFx(game, px623, py623, mv623x, mv623y);
            game.broadcastParticleOrchestra?.(ParticleOrchestraType.StardustPunch,
              px623, py623, mv623x, mv623y);
          }
        }
        // ★F4 召唤/哨兵弹伤害时刻的小动物恒拒门（CanNPCBeHitByPlayerOrPlayerProjectile
        // (npc, projectile)：flag = …∪(projectile.minion ∪ MinionShot ∪ sentry ∪
        // SentryShot) ⇒ 普通小动物不吃召唤伤（无需饰品）；黑化复权体在出口内放行。
        // 盒 = :14294-14300 状态2 拳盒（Center+direction×40，80×40））
        if ((game as unknown as { critters?: () => unknown[] }).critters?.().length) {
          // ★BJ490③（2026-10-04）projId 穿线（BJ488① settleCritterHit 单源同构）：掷面走
          //  rollVanillaHitCrit 口径——623 SetDefaults（Projectile.cs:6701-6718 亲读）无
          //  melee/ranged/magic 类旗 → 三类掷=零掷（kind=null 捷径返假,零 RNG,与 projId
          //  缺位时行为零差）,TimerCrit :12928 消费面照对;穿线=机制对齐单源（黑化
          //  critter+随从弹极窄边的掷/消费全链由 settleCritterHit 自洽承载）。
          hitCritters(
            { x: this.cx + this.facing * 40 - 40, y: this.cy - 20, w: 80, h: 40, projId: this.projId },
            game,
            { minion: true, sentry: this.sentry });
        }
        // ★清偿刀 Y2：城镇臂（Damage_CanDealDamage :12468 例外 `(type!=623||ai[0]!=2f)`
        // → Damage() → Damage_PVE_Inner 城镇同链;拳盒 Colliding :15611-15621
        // 80×40 @ Center+direction×40 对城镇靶同面）。cd=5（:6433）;巫毒窄门先置
        // 同 contactTown;usesLocal=私表族 → 受理拍清窗;916 直伤延迟汇出（contactTown
        // 同式,:13711 OnHit 位）。
        {
          let punchDirect: number[] | null = null;
          hitTownNpcs({ x: this.cx + this.facing * 40 - 40, y: this.cy - 20, w: 80, h: 40 },
            game, dmg0, 0, 'playerProj', this.projId, undefined, undefined,
            (n) => {
              if (!townVoodooGateOpen(game, n.vanillaId, this.projId)) return true;
              // ★BJ455⑦ :12636 三族共门（contactTown :4958 同式——窗拒拍整跳,先于
              //  ready() 消费=私表保持 0,窗清立即可命中;读 hurt 前状态=快照纪律）
              if (MinionProj.enemyImmune(n)) return true;
              return !this.hitCd.ready(n.id, 5);   // localNPCHitCooldown=5（:6433）
            },
            (n) => {
              // ★Z1/D1② 城镇臂 ghostHeal 白耗/治疗面（:13877-84 城镇靶同面,拳盒同源）
              const preHits623 = this.pveNumHits;
              this.pveNumHits++;
              ghostHealProc(game, this.projId, preHits623,
                n as unknown as Parameters<typeof ghostHealProc>[3]);
              this.townAcceptLadder(game, n, true);   // 私表族=usesLocal 主支清窗（:14175-14179）
              this.attackFlash = 24;
              const tn = n as TownNpcHitTarget;
              if (punchDirect) {
                for (const d of punchDirect) {   // OnHit :13711 位——★W5:916 链电
                  darkHarvestChain(game, d, tn.cx, tn.cy, tn.id);   // 链靶=CanBeChasedBy 敌,城镇 NPC 本体永免（:18）
                }
                punchDirect = null;
              }
            },
            (n) => {
              const tn = n as TownNpcHitTarget;
              const direct: number[] = [];
              tn.hurtFx = (d: number) => { direct.push(d); };
              const res = resolveWhipTagHit(tn, dmg0, game, add, SUMMON_TAG_MUL[623] ?? 1,
                tn.cx, tn.cy, this.ownerRef());
              punchDirect = direct;
              // ★BJ455① settle 归位（BJ445② 同构,contactTown :4996 同式）：res.dmg 已含
              //  tag-crit 预倍 ×2（resolveWhipTagHit 尾 WhipTag.ts:848 `if (crit) dmg *= 2`）
              //  → 仅 res.crit 摘半还原防前值,crit=res.crit 传参（TownNPC.hurt 防后×2+色
              //  一体,NPC.cs:82066;623=minion 非 sentry/SentryShot → 6176 golem 掷不达
              //  :12962 门,crit 单源）。旧形 dmg=res.dmg+crit 缺=暴击色省略+倍序偏离
              //  （(值×2−防)≠(值−防)×2）。
              return {
                dmg: res.crit ? res.dmg / 2 : res.dmg,
                crit: res.crit,
                kb: Math.sign(tn.cx - this.cx) * this.knockback,
                // 敌怪环 punch 面 armorPen=0（:4145 第五参）→ 城镇同形
              };
            });
        }
      }
      return;
    }
    if (this.gA0 === 1) {
      // ---- 状态 1：rest 驻守（:45562-45651）——消费 MinionRestTargetPoint ----
      let ax = restX, ay = restY;                    // vector（缺省肩锚）
      if (p.hasMinionRestTarget) {                   // :45563-45566
        ax = p.minionRestTargetX;
        ay = p.minionRestTargetY;
      } else {
        this.gA0 = 0;                                // :45567-45570（先置 0——本拍目标支仍可覆写 2,原版序）
      }
      // 索敌锚=玩家中心（AI_120_..._FindTarget :45786-45788 Main.player[owner].Center;
      // |Δx-锚|>170 跳过 :45572-45581）——★BJ514：ai120FindTarget 专用扫（无集火/tag）
      let tgt: EnemyLike | null = null;
      if (Math.abs(this.cx - ax) <= 170) tgt = this.ai120FindTarget(game, p);
      if (tgt) {
        const dirX = tgt.cx > this.cx ? 1 : -1;      // :45583
        this.facing = dirX;
        const num11 = Math.abs(ax - this.cx);
        const num12 = Math.abs(tgt.cx - this.cx);
        const num13 = Math.abs(ay - this.cy);
        const num14 = Math.abs(tgt.cy - (this.y + this.h));
        const dirY = tgt.cy > this.y + this.h ? 1 : -1;
        // X/Y leash（:45589-45604，num=150/num4=100——与状态 0 同式,锚=rest 点）
        if ((num11 < 150 || (ax - this.cx) * dirX < 0) && num12 > 20 && num12 < 150 - num11 + 100) {
          this.vx += 0.1 * dirX;
        } else this.vx *= 0.7;
        if ((num13 < 100 || (ay - (this.y + this.h)) * dirY < 0) && num14 > 10 && num14 < 100 - num13 + 10) {
          this.vy += 0.1 * dirY;
        } else this.vy *= 0.7;
        if (num12 < 500) { this.gA0 = 2; this.gA1 = tgt.id; }   // :45606-45610
      } else {
        // 漂移回收（:45612-45640）：|Δx|>190 → 状态 3；>20 步进 0.06；否则衰减+面向玩家
        if (Math.abs(ax - this.cx) > 190) {
          this.gA0 = 3;
        } else if (Math.abs(ax - this.cx) > 20) {
          this.facing = ax > this.cx ? 1 : -1;       // :45623
          this.vx += 0.06 * this.facing;
        } else {
          this.vx *= 0.8;
          this.facing = p.cx < this.cx ? 1 : -1;     // :45625（(player.Center.X < Center.X)）
        }
        if (Math.abs(ay - this.cy) > 100) {          // :45629-45632
          this.gA0 = 3;
        } else if (Math.abs(ay - this.cy) > 10) {
          this.vy += 0.06 * Math.sign(ay - this.cy);
        } else {
          this.vy *= 0.8;
        }
      }
      // 坐姿帧（:45642-45648）：9t 一翻,0..projFrames[623]-4（=19-4,0..14）
      if (++this.gFc >= 9) { this.gFc = 0; if (++this.gFrame >= 15) this.gFrame = 0; }
      // :45707 门——漂移转 3 落入本拍状态 3 续跑（原版落穿语义）；否则基础位移后返回
      if (this.gA0 !== 3) { this.x += this.vx; this.y += this.vy; return; }
    }
    // ---- 状态 0：贴身跟随 + 索敌（:45524-45560 if 链无 else 支——状态 0 不可达 3,跑完即返） ----
    if (this.gA0 === 0) {
      this.x += (restX - this.cx) * 0.05; // :42022 Lerp(Center, vector, 0.05)
      this.y += (restY - this.cy) * 0.05;
      this.vx *= 0.5; this.vy *= 0.5;     // :42023
      this.facing = p.facing;             // :42024
      if (++this.gFc >= 9) { this.gFc = 0; if (++this.gFrame >= 8) this.gFrame = 0; } // :42025-42032
      let tgt: EnemyLike | null = null;
      // ★BJ514：AI_120_..._FindTarget（:45526,num+20 门 :45520-45523/num2=500）
      //  距锚=玩家心（曾 nearestEnemy 缺省随从心=锚偏差）——ai120FindTarget 专用扫
      if (Math.abs(this.cx - restX) <= 170) tgt = this.ai120FindTarget(game, p);
      if (tgt) {
        const dirX = tgt.cx > this.cx ? 1 : -1; // :42047
        this.facing = dirX;
        const num6 = Math.abs(restX - this.cx);
        const num7 = Math.abs(tgt.cx - this.cx);
        const num8 = Math.abs(restY - this.cy);
        const num9 = Math.abs(tgt.cy - (this.y + this.h)); // npc.Y - Bottom
        const dirY = tgt.cy > this.y + this.h ? 1 : -1;
        // X leash（:42053-42056）：锚内或反向 且 20<|Δx|<150-锚偏+100 → 步进 0.1，否则衰减
        if ((num6 < 150 || (restX - this.cx) * dirX < 0) && num7 > 20 && num7 < 150 - num6 + 100) {
          this.vx += 0.1 * dirX;
        } else this.vx *= 0.7;
        // Y leash（:42061-42064，num4=100）
        if ((num8 < 100 || (restY - (this.y + this.h)) * dirY < 0) && num9 > 10 && num9 < 100 - num8 + 10) {
          this.vy += 0.1 * dirY;
        } else this.vy *= 0.7;
        if (num7 < 500) { this.gA0 = 2; this.gA1 = tgt.id; } // :42069-42073（num3=500 → 冲刺）
      }
      this.x += this.vx; this.y += this.vy; // 标准位移（velocity 持续衰减）
      return;   // 状态 0 不可达 3（原版无 else 支）
    }
    if (this.gA0 !== 3) return;   // 未知态：原版 if 链尾通配支为空（:45698-45701）,仅 3 落穿
    // ---- 状态 3：rest 点飞行段（:45707-45755）——隐身+尘爆,直插 MinionRestTargetPoint ----
    let tx3: number, ty3: number;
    if (p.hasMinionRestTarget) {                   // :45709-45711
      tx3 = p.minionRestTargetX;
      ty3 = p.minionRestTargetY;
    } else {
      this.gA0 = 0;                                // :45712-45715
      this.x += this.vx; this.y += this.vy;
      return;
    }
    if (this.gAlpha === 0) {                       // :45717-45734 入场：隐身 + 30 粒尘爆
      this.gAlpha = 255;
      this.guardianDustBurst(game, false);
    } else {
      this.guardianDustBurst(game, true);          // :45736-45746 2 粒/拍尾迹（noLight 变体）
    }
    this.vx *= 0.7; this.vy *= 0.7;                // :45747
    this.x += (tx3 - this.cx) * 0.2;               // :45748 Lerp(Center, vector, 0.2)
    this.y += (ty3 - this.cy) * 0.2;
    if (Math.hypot(tx3 - this.cx, ty3 - this.cy) < 10) this.gA0 = 1;   // :45749-45752 抵达转驻守
    this.x += this.vx; this.y += this.vy;          // 基础位移（position += velocity）
  }

  /** AI_120 守护者尘爆/尾迹（:45483-45499 30 粒 / :45719-45746 同体+noLight 变体）：
   *  135 尘双联——α200 scale1.7 初速 ×3 + α100 scale1 初速 ×2 fadeIn2.5（均 noGravity）；
   *  noLight 仅尾迹变体逐粒置位；cPet 次级着色器未建模（登记,与 top-of-AI 爆同缺） */
  private guardianDustBurst(game: GameHooks, trail: boolean): void {
    const n = trail ? 2 : 30;
    for (let i = 0; i < n; i++) {
      const d1 = game.spawnDust?.(this.x, this.y, this.w, this.h, 135, 0, 0, 200, null, 1.7, true);
      if (d1) { d1.vx *= 3; d1.vy *= 3; if (trail) d1.noLight = true; }
      const d2 = game.spawnDust?.(this.x, this.y, this.w, this.h, 135, 0, 0, 100, null, 1, true);
      if (d2) { d2.vx *= 2; d2.vy *= 2; d2.fadeIn = 2.5; if (trail) d2.noLight = true; }
    }
  }

  /** 同型 idStatic 免疫桶（immunityIdentity=type,perIDStaticNPCImmunity 全局数组：
   *  Projectile.cs:13823/:14037 写 / :606-608 读）——同型多实例共享按敌绝对到期
   *  （★BJ704-G1 债①：倒数桶→gameTickCount 绝对到期,零驱动,见 IdStaticBucket 注） */
  private idStaticBucket(projId: number): IdStaticBucket {
    let b = IDSTATIC_BUCKETS.get(projId);
    if (!b) { b = new IdStaticBucket(); IDSTATIC_BUCKETS.set(projId, b); }
    return b;
  }

  /** 敌方玩家键免疫窗余值（NPC.immune[owner] 等价——单 player 世界即 NPC 单窗；
   *  测试桩敌无该字段 → 恒视作 0 可打）。台账批③全局窗支的先验门。
   *  ★BJ436 起 TigerPounce（818 扑击弹） :12636 共门同消费 → 去私有。 */
  static enemyImmune(en: unknown): boolean {
    const iv = (en as { iframes?: number } | null)?.iframes;
    return typeof iv === 'number' && iv > 0;
  }

  /** SpawnHitVisuals 编排面（Projectile.cs:14466-14501，Damage 对每个实际受伤目标各调
   *  一次——:13633 NPC 支在免疫门之后)。type1093/1112 → CattivaHit 六芒簇
   *  （BroadcastOrRequest clientOnly:false = 本地直生 + module8 上行；δB B11 接线,
   *  2026-08-31——旧档"消费派发在位/接线在位"系声称失实,生产端从未接）：
   *   PositionInWorld = Center + (direction·8, 0) + Circular(4,4)；
   *   MovementVector = CircularEdge(4,4)（Utils.cs:1306 单位圆 × 半径,落在椭圆边上）。
   *  载荷只采样一次——本地 fx 与广播共用同参（原版 settings 对象同构）。
   *  ★镐力面 :52193（AI_067_FreakingPirates_HitIntention,ai[0]=3 帮工意图）★BJ433
   *  2026-10-02 已折算（cattivaHitIntention,锚=栖点非拳面——与本法 Center+(dir·8,0)
   *  锚不同位,勿混用）；抚摸 Joy 音槽（palJoyTick/心形气泡窗）与 CattivaHit 无关,
   *  勿在此误植。 */
  private emitSpawnHitVisuals(game: GameHooks): void {
    if (this.projId !== 1093 && this.projId !== 1112) return;
    const px = this.cx + this.facing * 8 + (Math.random() * 2 - 1) * 4;   // +Circular(4,4)
    const py = this.cy + (Math.random() * 2 - 1) * 4;
    const ea = Math.random() * Math.PI * 2;                              // NextVector2Unit
    const mvX = Math.cos(ea) * 4, mvY = Math.sin(ea) * 4;                // CircularEdge(4,4)
    cattivaHitFx(game, px, py, mvX, mvY);
    game.broadcastParticleOrchestra?.(ParticleOrchestraType.CattivaHit, px, py, mvX, mvY);
  }

  /** 接触伤害通用（pad=判定盒外扩）；鞭 tag + TagCrit + proc 统一走 resolveWhipTagHit
   *  （TagEffectState.ModifyHit :216-228 / OnHit :230-243，含黑收成 OnTaggedHit 与
   *  火鞭/星陨/花瓣/月主弹 proc 首跳）。返回是否命中过（乌鸦命中重置扑击计时）。
   *  ★台账批③：cd 支持 ContactCd 三态——number=局部私表 t；CONTACT_PLAYER_WINDOW(-2)
   *  =原版缺省族【吃玩家全局免工件窗】（免工件门 + Enemy.hurt(pierce=0) 命中后置
   *  10t——废统一 20t 私表）；{kind:'idStatic'}=同型共享桶 */
  private contact(game: GameHooks, dmg: number, cdIn?: ContactCd, pad = 0): boolean {
    const add = (e: unknown, b: string) =>
      (game as unknown as { entities: { add: (x: unknown, y: string) => void } }).entities.add(e, b);
    // ★F4 召唤/哨兵弹伤害时刻的小动物恒拒门（projectile 语境入统一出口）：
    // flag=true ⇒ 普通小动物免伤（饰品无关），唯一放行 = 黑化复权体（F2 运行时位）。
    // 命中返回值并入 anyHit（原版单数组遍历的仓内双桶拆分等价形）
    let anyHit = false;
    // ★F4 召唤/哨兵弹伤害时刻的小动物恒拒门（projectile 语境入统一出口）：
    // flag=true ⇒ 普通小动物免伤（饰品无关），唯一放行 = 黑化复权体（F2 运行时位）。
    // 命中返回值并入 anyHit（原版单数组遍历的仓内双桶拆分等价形）
    if ((game as unknown as { critters?: () => unknown[] }).critters?.().length) {
      // ★BJ491②（2026-10-04）projId 穿线（BJ490③ 623 拳盒/BJ488① settleCritterHit 单源
      //  同构）：projId 缺位 → settleCritterHit 掷面 `projId > 0` 门恒假=三类掷绕开单源
      //  =机制缺口。途经 id 类旗定谳表（SetDefaults 亲读,数据面对拍同值）：
      //  688/689/690（:7327-7339）=sentry 旗无三类旗;946（:8924-8939）=minion 旗无三类旗;
      //  1093（:10197-10210）/1112（:10364-10377）=minion 旗无三类旗——全系零掷
      //  （rollVanillaHitCrit kind=null 捷径返假,零 RNG,行为与缺 projId 零差）,
      //  TimerCrit :12928/武僧 688-690 强制掷 :12929-12943 消费面照达（settleCritterHit
      //  既有位承载）;全 MinionProj id 域（vanilla SetDefaults 逐支扫描）亦无三类旗,
      //  穿线纯机制对齐。tests/bj491-critroll-tail2-three.test.ts §2 定谳表落锁。
      const hitbox = pad
        ? { x: this.x - pad, y: this.y - pad, w: this.w + pad * 2, h: this.h + pad * 2, projId: this.projId }
        : { x: this.x, y: this.y, w: this.w, h: this.h, projId: this.projId };
      // 小动物亦属原版 Main.npc 全表 → Damage 每中兽同样走 SpawnHitVisuals（此处整桶
      // 合一近似——多兽同帧合并为一发;Enemy 桶为逐靶直译）
      const critterHit = hitCritters(hitbox, game, { minion: true, sentry: this.sentry });
      if (critterHit) {
        this.emitSpawnHitVisuals(game);
        anyHit = true;
      }
    }
    for (const e of game.enemies()) {
      if (!playerCanHitEnemy(e, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const en = e as never as EnemyLike & import('./WhipTag').WhipTagged & {
        hurtFx?: (d: number) => void;
      };
      if (en.dead) continue;
      if (!(this.x - pad < en.x + en.w && this.x + this.w + pad > en.x
        && this.y - pad < en.y + en.h && this.y + this.h + pad > en.y)) continue;
      // ★台账批③ 接触冷却三态门（原版 Damage_PVE flag2 :12595 + Damage_PVE_Inner
      //  immune[owner] 门 :12636 / localNPCHitCooldown 尾支 :14175-14186）
      // ★BJ436（2026-10-02）：immune[owner] 门 = 三族【共门】且先于私表消费——原版
      //  :12636 对 usesLocal/usesIDStatic 弹同样生效（flag3 只豁免单发非局部弹）,
      //  且窗拒拍早退不达 :14179 写位=私表保持 0。旧码 local/idStatic 族不查窗、
      //  先 ready() 消费私表再进 hurt 被窗拒 → 窗内空转白吃 cd,节拍漂移。
      const spec = cdIn === undefined ? contactResolve(this.projId) : cdIn;
      // ★BJ475① :12600 头门前置（Damage_PVE 循环门 `flag2 && (!dontTakeDamage ||
      //  ZappingJellyfish[nPC.type])` 先于 Inner 全链;BJ467⑥ 拳/光环/爆弹/爆裂四臂
      //  同构,contact 环与 818 扑击臂 BJ467⑥ 落刀时任务清单未含=同形漏网）——
      //  dontTakeDamage 靶不达 TimerCrit/tag ModifyHit/私表 cd 消费（快照纪律:读
      //  hurt 前状态）。随从弹非接触反噬族（:12680 zap 门=aiStyle 19/161/75/140 ∪
      //  IsAWhip ∪ AllowsContactDamageFromJellyfish,随从面恒假）→ dontTakeDamage
      //  水母亦无 zap 口,整跳=原版净语义（:12685 `if (dontTakeDamage) return` 拦伤）。
      if ((en as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      if (MinionProj.enemyImmune(en)) continue;   // ★BJ436 :12636 三族共门（原 -2 族独占）
      if (spec === CONTACT_PLAYER_WINDOW) {
        // -2 缺省族：吃玩家全局窗（命中尾 :14182 写 10=hurt pierce=0 承载）
      } else if (typeof spec === 'object') {
        if (!this.idStaticBucket(this.projId).ready(en.id, spec.cd)) continue;
      } else if (this.ai177Immunity
        ? !this.ai177Immunity.ready(en.id, spec as number)   // ★BJ515 债①：917/1036 localNPCImmunity 面（:14178 写/逐 t 衰减）
        : !this.hitCd.ready(en.id, spec)) continue;
      // ★清偿刀 W5（2026-10-02）黑收成 916 链电汇出位（:13711 OnHit 形态对齐）：
      //  resolveWhipTagHit 内 TagEffectStack.OnHit 触发 darkharvest hurtFx——旧形
      //  【同步直调】伤落被命中敌且先于主 hurt=反序反噬主命中（Y2 探针实证主伤整丢,
      //  登记债）;且 916 出膛即对被命中敌 localNPCImmunity=-1 永免（_DarkHarvest.cs
      //  :18,原版词条 "Dark energy jumps from enemies hit by summons" 同证）——旧
      //  直调源敌=目标面反记+tag 伤双记（主命中 ModifyHit :12954 已并 TagDamage 一
      //  次）。现形态=hurtFx 汇出收集,主命中受理+写梯后经 darkHarvestChain 落地
      //  链电（伤落【其他】敌,源敌永免）。
      const pendingDirect: number[] = [];
      en.hurtFx = (d: number) => { pendingDirect.push(d); };   // 鞭 tag 直伤汇出位
      // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit :12947 前）：
      //  ① TimerCrit :12928——6170 蓄能暴击对一切玩家弹无条件消费（满蓄/负窗→
      //     charge=-15+强制 crit;近战面 Game.ts:34625 先例）
      //  ② 武僧 688-690 强制掷 :12929-12943（随从接触面非 688 族恒假,形位保留）
      const timerCritContact = tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);
      const monkCritContact = monkAuraForcedCrit(this.ownerRef(), this.projId);
      const res = resolveWhipTagHit(en, dmg, game,
        (el) => add(el, 'projectiles'), SUMMON_TAG_MUL[this.projId] ?? 1, en.cx, en.cy,
        this.ownerRef());
      // 圣殿骑士背包 6176（accGolemSentryBackpack :12963-12967）：sentry/SentryShot
      // 命中 10% 强制暴击（×2,与 TagCrit 暴击同通道）
      let golemCrit = rollGolemSentryCrit(game, this.projId, this.sentry);   // 6176（:12962-12965 1:1,共享掷）
      // 击退 = 武器 kb×0.5（本作接触系数）+ minionKB 加算（GetWeaponKnockback :52477-52482：
      // 大力士甲虫/纸莎草 +2——首版聚合了 equipStats.minionKB 但漏消费，终审补接；
      // buff 段 = 醉酒 +1 :11520 / 饥饿 -0.5 / 极饿 -1 :11570/:11594，2026-08-20 饥饿链补）
      const owner0 = this.ownerRef();
      const o0 = owner0 as unknown as { equipStats?: { minionKB?: number }; buffs?: { minionKbBonus?: number } } | null;
      const mkb = (o0?.equipStats?.minionKB ?? 0) + (o0?.buffs?.minionKbBonus ?? 0);
      const pen0 = ((owner0 as unknown as { equipStats?: { armorPen?: number } } | null)?.equipStats?.armorPen ?? 0)
        + (projectileData(this.projId)?.armorPenetration ?? 0); // StrikeNPC :12068:玩家AP+弹幕AP 两源
      // 击退方向（StrikeNPC 第 3 参 num40,Projectile.cs:13648-13677）：缺省=随从→敌
      // sign;★方向表族（:13652-13660 switch 697/699/707/708/759 + ★1458 新增 1118
      // Clay Bud"always knocks enemies away from the player"）= 玩家→敌 sign
      // （owner.Center.X < target.Center.X ? 1 : -1,相等取 -1）。本仓 1457 曾全族
      // 随从锚（登记项）,借 1458 批补齐 switch 族;aiStyle 15/188-191 同段族登记
      const kbDir = MINION_PLAYER_ANCHOR_KB.has(this.projId) && owner0
        ? (owner0.cx < en.cx ? 1 : -1)
        : Math.sign(en.cx - this.cx);
      // 主命中受理预判（Enemy.hurt 头门残面 :14234 dead 已在环顶筛/:14241
      //  dontTakeDamage——拒收跳原版 :13711 不可达=无 916,链电不落地）
      const mainGated = en.dead
        || (en as { dontTakeDamage?: boolean }).dontTakeDamage === true;
      // ★BJ436（2026-10-02）写梯档位按族分流（原版命中尾 :14031-14186）：
      //  -2 缺省族 → pierce=0（尾支 :14182 写 10=开玩家全局窗,原版本相——373/375/
      //    423/613 本体接触本就压武器 10t）;local/idStatic 族 → pierce=-3
      //    （:14175-14179/:14031-14037 写 immune[owner]=0【清窗不开窗】,节流全归
      //    私表）。旧 pierce=0 把史莱姆 266/乌鸦 317/双子 387/388/蜘蛛 390-392/
      //    吸血蛙 758/雪原精怪 951/阿比盖尔 963 等全族每次命中都开 10t 窗,仆从
      //    连续攻击=窗口近全覆盖 ⇒ 玩家其他武器被 hurt 免疫门整段拒收=BJ436
      //    用户实报「仆从攻击时其他武器无法造成伤害」第一因。
      // ★BJ445② crit 色补齐（StrikeNPC :13702 第 4 参传 crit——染暴击色;防后 ×2 已由
      //  调用侧预倍承载,Enemy.hurt crit 参仅染色 :14583 登记偏差）。crit 源 = res.crit
      //  （tag 掷率强制位,WhipTagEffect.cs:70-72）‖ golemCrit（6176 背包 :12962-12965）
      //  ——旧恒 false=暴击色省略（Y2 报告②）。Arrow.ts:9490 whipTagShot 支同式先例。
      //  ★BJ453 并链：‖ timerCritContact（:12928）‖ monkCritContact（:12929-12943）——
      //  原版 crit=单布尔单翻倍,新源强制时补一次 ×2（res.crit 的 ×2 已嵌 res.dmg,
      //  不重倍;旧 res.crit∧golemCrit 同拍 ×4 并发归位 ×2=BJ452 N1a 城镇臂同判）。
      const critContact = res.crit || timerCritContact || monkCritContact || golemCrit;
      // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970,owner luck）——tag→golem→DV 原序;
      //  掷 res.dmg（tag 乘后基数;res.crit ×2 已嵌=边界舍入微差,登记债①）
      const dmgVContact = damageVarRoll(res.dmg, this.ownerRef()?.luck ?? 0);
      en.hurt(applyBannerDamageDealt(game, en, critContact && !res.crit ? dmgVContact * 2 : dmgVContact),
        kbDir * (this.knockback + mkb), 0, game, pen0, critContact,
        spec === CONTACT_PLAYER_WINDOW ? 0 : -3, true); // 裸kb+minionKB(:52477);fromPlayer=DPS 计
      // ★BJ436 GC1 写方桥接线（近战域 immune 表 npcImmuneByAttacker 同步,原版
      //  单表语义;ForbiddenSignProj 同式）：受理命中才写梯（!mainGated=dead/
      //  dontTakeDamage 已筛,iframes 窗已前置门）。local/idStatic=清零档（0）,
      //  -2 缺省族=数据面末档（penetrate=-1 → 10）。
      // ★Z1/D1②（2026-10-02）ghostHeal 白耗/治疗面（Projectile.cs:13877-84 通用 on-hit
      //  段——原版对【一切】可伤玩家弹照跑,调用点无类别门;原位=StrikeNPC(:13702)后/
      //  写梯(:14031)前,受理段=免疫门/ dontTakeDamage 门后）。num41 等位=
      //  Enemy.lastStrikeDealt（防后实扣）;numHits=自增前受理数（:14263 位 ++ 在后）;
      //  isMagic 由 ghostHealProc 经 projectileData 忠实直传（随从族数据面均非 magic=
      //  白耗面,:12090 lifeSteal 先扣/:12091-93 !magic return 预算照扣不出治疗球=原版
      //  本相;治疗面同源单数据门,与 WeaponProj/PrismProj/WhipProj 既有接线同式）。
      //  门拒拍（:12636 窗/私表 continue;dead/dontTakeDamage=mainGated）不达本位。
      if (!mainGated) {
        ghostHealProc(game, this.projId, this.pveNumHits,
          en as unknown as Parameters<typeof ghostHealProc>[3]);
        this.pveNumHits++;   // :14263（proc 读自增前值）
      }
      if (!mainGated) {
        noteVanillaProjImmune(game, this.projId, en.id,
          spec === CONTACT_PLAYER_WINDOW
            ? undefined
            : typeof spec === 'object' ? { penetrate: -1, idStaticFace: true }
              : { penetrate: -1, localFace: true });
      }
      applyProjStatus(this.projId, en as unknown as Record<string, number>, { catalystBand: this.ownerRef()?.equipStats.catalystBand }); // StatusNPC(:10555)+6185 催化指环 398
      this.emitSpawnHitVisuals(game);           // SpawnHitVisuals :13633（免疫门后每靶一发,B11）
      this.attackFlash = 24;
      // ★W5 :13711 位落地（主命中受理+写梯后）——916 链电伤落其他敌（源敌永免,
      //  :18 localNPCImmunity[npcHit]=-1）,源敌只吃主命中内的 tag 加伤
      if (pendingDirect.length > 0 && !mainGated) {
        for (const d of pendingDirect) {
          darkHarvestChain(game, d, en.cx, en.cy, en.id);
        }
      }
      anyHit = true;
    }
    anyHit = this.contactTown(game, dmg, cdIn, pad, add) || anyHit;
    return anyHit;
  }

  /** ★清偿刀 Y2（2026-10-02）随从/哨兵弹 vs 城镇 NPC 通道（X1 登记债清偿:
   *  face 5 消费真通道 + flat 穿甲/banner 透传 + WHIP_HIT_* 闭环的随从侧）。
   *  定谳锚（Terarria1457/Terraria/Projectile.cs 亲读）：Damage() →
   *  Damage_CanDealDamage projPet 例外族（:12468）放行的各随从本体 →
   *  Damage_PVE :12523 → Damage_PVE_Inner 对城镇靶【同链同面】——voodoo 窄门
   *  :12618-12625 flag 臂（22 killGuide/54 killClothier/318 例外）放行后,
   *  tag ModifyHit(:12947)/banner(:13387-91)/穿甲(:13686-87)/StrikeNPC(:13702)/
   *  TagEffectStack.OnHit(:13711) 全段照跑（原版单 Main.npc 数组遍历,本仓
   *  敌怪/城镇双桶拆分等价形——敌怪环见 contact() 主环）。
   *  门序：巫毒窄门先置（skip 内,vanilla flag(:12620-12631)→immune(:12636) 同序,
   *  防「无 doll 探针」污染接触冷却私表）→ 接触冷却三态门（敌怪环 :4361 同式:
   *  -2 缺省族=玩家全局窗 iframes 门;私表/idStatic 族=ready() 探针——写位在
   *  onAccept 受理拍,:14179 写梯同位）→ AABB（pad 外扩盒同 critter 环形）。
   *  settle = 逐靶结算（tag 乘区/crit/kb 逐靶依赖 tag 态与靶位;banner 在
   *  hitTownNpcs 通道内统一施加,勿在此预套;crit 语义=TownNPC.hurt 防后双精度
   *  ×2,与敌怪环「调用侧预倍」不同形——★BJ445②：res.crit 摘半+golemCrit 并入
   *  crit 参防后重倍,暴击色/倍序双归位）。onAccept = 受理拍写梯:usesLocal 主支
   *  （:14175-14179 私表/idStatic 族=immune[owner]=0 清全局窗不开窗,鞭 W1 同式;
   *  -2 缺省族=TownNPC.hurt 通用档 iframes=10 即 :14182 档,不动）+StatusNPC
   *  （:13634）/SpawnHitVisuals（:13633）/attackFlash。 */
  private contactTown(game: GameHooks, dmg: number, cdIn: ContactCd | undefined, pad: number,
    add: (e: unknown, b: string) => void): boolean {
    const townList = (game as unknown as { npcs?: () => unknown[] }).npcs?.() ?? [];
    if (!townList.length) return false;
    const owner0 = this.ownerRef();
    const o0 = owner0 as unknown as { equipStats?: { minionKB?: number; armorPen?: number }; buffs?: { minionKbBonus?: number } } | null;
    const mkb = (o0?.equipStats?.minionKB ?? 0) + (o0?.buffs?.minionKbBonus ?? 0);
    const pen0 = (o0?.equipStats?.armorPen ?? 0)
      + (projectileData(this.projId)?.armorPenetration ?? 0);   // :13686-87 num6 两源（同敌怪环 :4383）
    const spec = cdIn === undefined ? contactResolve(this.projId) : cdIn;
    const box = pad
      ? { x: this.x - pad, y: this.y - pad, w: this.w + pad * 2, h: this.h + pad * 2 }
      : { x: this.x, y: this.y, w: this.w, h: this.h };
    let anyHit = false;
    // ★黑收成 916 链电延迟汇出（原版序 :13711 OnHit 在 StrikeNPC :13702【后】——
    //  待主命中受理+写梯后落地;同步直调会自置 iframes=10 反噬主命中,敌怪环反序
    //  缺陷探针实证=主伤整丢,Y2 报告登记债）。★W5 定谳修正目标面：916 出膛即对
    //  被命中敌 localNPCImmunity=-1 永免（_DarkHarvest.cs:18）——伤【永不】落回被
    //  命中者,经 darkHarvestChain 链落【其他】敌（原版词条 "Dark energy jumps from
    //  enemies hit by summons" 同证）;城镇靶同面（:13711 对城镇靶照跑,链自城镇 NPC
    //  位寻 CanBeChasedBy 敌）。face 5 消费真通道主体在 settle（ModifyHit+OnHit 消费）。
    let pendingDirect: number[] | null = null;
    hitTownNpcs(box, game, dmg, 0, 'playerProj', this.projId, undefined, undefined,
      (n) => {
        // 巫毒窄门先置（:12618-12631 flag 臂;探针零污染）——318 臭鸡蛋例外在谓词内
        if (!townVoodooGateOpen(game, n.vanillaId, this.projId)) return true;
        // ★BJ452 N5 :12636 三族共门（immune[owner]>0 整跳,先于私表消费——窗拒拍早退
        //  不达 :14179 写位=私表保持 0;原 local/idStatic 分支不查窗=窗内白吃 cd 节拍漂移。
        //  BJ436 敌怪环 contact() 同构补,门读 hurt 前状态=vanillaGated 快照纪律）
        if (MinionProj.enemyImmune(n)) return true;
        // 接触冷却三态门（敌怪环 :4361-4367 同式;town id 与敌 id 同 Entity 全局序列不撞）
        if (spec === CONTACT_PLAYER_WINDOW) return false;   // -2 缺省族窗查已由 :12636 共门承载
        if (typeof spec === 'object') return !this.idStaticBucket(this.projId).ready(n.id, spec.cd);
        return !this.hitCd.ready(n.id, spec);
      },
      (n) => {
        // ★Z1/D1② 城镇臂 ghostHeal 白耗/治疗面（:13877-84 对城镇靶同面——原版单
        //  Main.npc 数组遍历,受理段无敌怪/城镇分叉;canGhostHeal 缺省 true 城镇族无
        //  false 置位。num41=TownNPC.lastStrikeDealt（hurt 内落值）;numHits=自增前值,
        //  敌怪环/城镇臂共用一本体计数器（vanilla :14263 同一 Damage() 内逐靶自增）。
        //  Y2 城镇受理拍=门过受理位,同 WhipProj face 4 城镇臂习语）
        const preHits = this.pveNumHits;
        this.pveNumHits++;
        ghostHealProc(game, this.projId, preHits,
          n as unknown as Parameters<typeof ghostHealProc>[3]);
        this.townAcceptLadder(game, n, spec !== CONTACT_PLAYER_WINDOW);
        this.attackFlash = 24;
        anyHit = true;
        const tn = n as TownNpcHitTarget;
        if (pendingDirect) {
          for (const d of pendingDirect) {   // OnHit :13711 位（写梯后）——W5:916 链电
            darkHarvestChain(game, d, tn.cx, tn.cy, tn.id);   // 链靶=CanBeChasedBy 敌,城镇 NPC 本体永免（:18）
          }
          pendingDirect = null;
        }
      },
      (n) => {
        const tn = n as TownNpcHitTarget;
        const direct: number[] = [];
        tn.hurtFx = (d: number) => { direct.push(d); };
        // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit 前;
        //  原版 crit 段在 Damage_PVE_Inner 敌/城共享段——城镇靶同链同消费）：
        //  TimerCrit :12928 + 武僧 688-690 强制掷 :12929-12943（非 688 族恒假）
        const timerCritTown = tryConsumeTimerCritOf(owner0, game, tn.x, tn.y, tn.w, tn.h);
        const monkCritTown = monkAuraForcedCrit(owner0, this.projId);
        const res = resolveWhipTagHit(tn, dmg, game, (el) => add(el, 'projectiles'),
          SUMMON_TAG_MUL[this.projId] ?? 1, tn.cx, tn.cy, owner0);   // face 5 消费真通道：tag 乘区 + OnHit proc 消费
        pendingDirect = direct;
        const golemCrit = rollGolemSentryCrit(game, this.projId, this.sentry);   // 6176（:12962-12965）
        const kbDir = MINION_PLAYER_ANCHOR_KB.has(this.projId) && owner0
          ? (owner0.cx < tn.cx ? 1 : -1)
          : Math.sign(tn.cx - this.cx);   // 方向表族同敌怪环 :4386-4392
        // ★BJ445② crit 色补齐 + 倍序归位：TownHitSettle.crit 语义=TownNPC.hurt 防后
        //  ×2（NPC.cs:82066 原序;hitTownNpcs 约定「传 crit=true 时 dmg 勿预倍」）。
        //  res.dmg 已含 tag 掷率暴击 ×2（resolveWhipTagHit 尾 :834,Enemy 环预倍习语）
        //  → 城镇站摘半还原防前值再交 crit 参防后重倍（偶整数,整除精确）。旧形
        //  golemCrit 防前预倍 + crit 参恒缺 = 暴击色省略 + 倍序偏离（(值×2−防)≠(值−防)×2,
        //  Y2 报告②）。爆弹臂 :5996 同形先例（raw+crit 参）。
        //  ★BJ453 并链：‖ timerCritTown（:12928）‖ monkCritTown（:12929-12943）——
        //  crit 参单布尔承载防后单次 ×2,dmg 摘半面只系 res.crit 不动（新源不落 dmg）。
        const critTown = res.crit || timerCritTown || monkCritTown || golemCrit;
        const settle: TownHitSettle = {
          dmg: res.crit ? res.dmg / 2 : res.dmg,   // 摘 tag-crit ×2 → 防后重倍（vanilla 序）
          crit: critTown,
          flatPen: pen0,
          kb: kbDir * (this.knockback + mkb),   // 裸kb+minionKB（:52477,同敌怪环）
        };
        return settle;
      });
    return anyHit;
  }

  /** ★清偿刀 Y2：城镇受理拍通用写梯 + StatusNPC + 命中编排。
   *  写梯（:14175-14179）：usesLocal 主支（私表/idStatic 族,鞭 W1 同式）=
   *  `immune[owner]=0`【清全局窗不开窗】;clearWindow=false（-2 缺省族）=
   *  TownNPC.hurt 通用档 iframes=10 即 :14182 `penetrate!=1` 档,原版同相不动。
   *  StatusNPC（:13634 门后无条件段,城镇靶同面;6185 催化指环 398）+
   *  SpawnHitVisuals（:13633 免疫门后每靶一发,B11——城镇靶同面）。 */
  private townAcceptLadder(game: GameHooks, n: { iframes?: number }, clearWindow: boolean): void {
    const tn = n as TownNpcHitTarget;
    if (clearWindow) tn.iframes = 0;
    applyProjStatus(this.projId, tn as unknown as Record<string, number>,
      { catalystBand: this.ownerRef()?.equipStats.catalystBand });
    this.emitSpawnHitVisuals(game);
  }

  /** ★BJ639 批 1②：644 引爆受理面（t=30 :34975-34998 + t=60 Kill :73416-73430 二段
   *  ——★C16a-F3 破钉重产：旧注「二段被 usesIDStaticNPCImmunity :6951 吃掉=单发
   *  伤害语义」系误读判谳。定谳（R1-F1 纪律,反编译机读）：644 idStaticNPCHitCooldown
   *  =−1（:468 字段缺省,:6951 只置 usesIDStaticNPCImmunity）→ :14036 写
   *  perIDStatic[644,npc]=GameUpdateCount+(uint)(−1)=count−1（uint 回绕）,
   *  门 :606-608 `stored<=GameUpdateCount` 恒真=免疫表零阻 → 二段 Damage 对盒内
   *  全体（含 t=30 已命中者）成立;:14035 命中尾 `targetNPC.immune[owner]=0` 清窗
   *  （IDStatic 支独占,不走 :14182 缺省 10t 窗写）。几何 = 60×60 盒 vs 靶盒 AABB
   *  （30+半宽/半高）;受理面 tag/crit/横切与旧爆弹臂同构（SentryShot 单源）。
   *  伤害/击退取 643 出生拍捕获值（faces.hitAt 闭包注入）。 */
  private rainbowBurstHitFace(game: GameHooks, bx: number, by: number, dmg: number): void {
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, 644)) continue;   // friendly 门（Damage_PVE_Inner :11892）
      const en = ent as EnemyLike & { dead: boolean };
      if (en.dead) continue;
      if (Math.abs(en.cx - bx) < 30 + en.w / 2 && Math.abs(en.cy - by) < 30 + en.h / 2) {
        // BJ467⑥ :12686 头门前置（dontTakeDamage 靶不达;644 aiStyle112 非反噬族）
        if ((en as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
        // ★C16a-F3① IDStatic 免疫表门（Damage_PVE flag2 :12595 → :606-608 读形）
        //  ——644 桶 cd=−1：MinionHitCd(−1) 不积档恒 ready=「stored<=count 恒真」
        //  同相（:14036 uint 回绕=count−1）。写位=ready() 内（pass 即写,与
        //  contact() idStatic 支同构）
        if (!this.idStaticBucket(644).ready(en.id, -1)) continue;
        // BJ452 N3① :12636 三族共门（immune[owner]>0 整跳,窗拒拍=写梯/tag 全不达）
        if (MinionProj.enemyImmune(en)) continue;
        // BJ452 N3② tag 面：644 ∈ SentryShot → 完整 WhipTagEffect 栈,挂单源
        const volleyDirect: number[] = [];
        (en as never as import('./WhipTag').WhipTagged).hurtFx = (d: number) => { volleyDirect.push(d); };
        // BJ453 受理面 crit 段补全（:12928-12943,载体=644 本体——timerCrit 消费
        // owner 态;武僧 688-690 掷以载体 644 判定=恒假,形位保留）
        const timerCrit = tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);
        const monkCrit = monkAuraForcedCrit(this.ownerRef(), 644);
        const res = resolveWhipTagHit(en as never as import('./WhipTag').WhipTagged,
          dmg, game,
          (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
          SUMMON_TAG_MUL[644] ?? 1, en.cx, en.cy, this.ownerRef(), 0, 644);
        const gated = en.dead || (en as { dontTakeDamage?: boolean }).dontTakeDamage === true;
        const golemCrit = rollGolemSentryCrit(game, 644, false);   // 6176 SentryShot 10%
        const crit = res.crit || timerCrit || monkCrit || golemCrit;
        // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970,owner luck）——tag→golem→DV 原序
        const dmgV644 = damageVarRoll(res.dmg, this.ownerRef()?.luck ?? 0);
        en.hurt(applyBannerDamageDealt(game, en, crit && !res.crit ? dmgV644 * 2 : dmgV644),
          Math.sign(en.cx - bx) * this.knockback, -2, game, 0, crit, 1, true);
        // ★C16a-F3① 命中尾 IDStatic 写梯（:14030-14036）：usesIDStatic ∧ penetrate≠1
        //  （引爆拍 =−1）→ immune[owner]=0 清窗（不走 :14182 缺省 10t 写）——敌侧
        //  清窗使 t=60 二段过 :12636 共门（城镇臂 townAcceptLadder clearWindow=true
        //  既案同构）。旧实现缺清窗=en.hurt pierce=0 尾写 10t 残留
        (en as { iframes?: number }).iframes = 0;
        // Z1/D1② ghostHeal 白耗/治疗面（:13877-84 通用 on-hit 段;载体=644,numHits=0）
        if (!gated) {
          ghostHealProc(game, 644, 0, en as unknown as Parameters<typeof ghostHealProc>[3]);
        }
        applyProjStatus(644, en as unknown as Record<string, number>,
          { catalystBand: this.ownerRef()?.equipStats.catalystBand });
        // BJ452 N3② W5 :13711 位落地（受理后）——916 链电伤落其他敌
        if (volleyDirect.length > 0 && !gated) {
          for (const d of volleyDirect) darkHarvestChain(game, d, en.cx, en.cy, en.id);
        }
      }
    }
    // 城镇臂（:34975 Damage() 管线同链——Y2 清偿刀既案;60×60 几何外置 skip）
    // ★BJ662（2026-10-12）N3f 定谳补缺：916 链电延迟汇出（原版序 :13711 OnHit 在
    //  StrikeNPC :13702【后】——写梯后落地,城镇靶同面=旧即时 AoE 面既有
    //  volleyTownDirect 通道）。BJ639 批1② volley 实体化重写本面时整缺
    //  （settle 收集 direct 后无发布+onAccept 无消费=链电永落,登记债
    //  bj452-N3f 存量红根因之二）;pendingDirect 习语=contact 面 :7449 同式。
    let pendingDirect: number[] | null = null;
    hitTownNpcs({ x: bx, y: by, w: 0, h: 0 }, game, dmg, 0, 'playerProj', 644,
      () => true, undefined,
      (n) => {
        const tn0 = n as TownNpcHitTarget;
        if (!townVoodooGateOpen(game, n.vanillaId, 644)) return true;
        // BJ445③ 三族共门（usesIDStatic → flag3 不豁免——窗内靶整跳）
        if ((n as { iframes?: number }).iframes !== undefined
          && (n as { iframes?: number }).iframes! > 0) return true;
        return !(Math.abs(tn0.cx - bx) < 30 + tn0.w / 2 && Math.abs(tn0.cy - by) < 30 + tn0.h / 2);
      },
      (n) => {
        ghostHealProc(game, 644, 0, n as unknown as Parameters<typeof ghostHealProc>[3]);
        // 写梯归档（★C16a-F3 注释勘正）：本面=引爆拍（penetrate=-1）→ 原版写梯
        //  usesIDStatic 支（:14030-14036）直达=immune[owner]=0 清窗（非「内支不达」
        //  ——那仅本体 penetrate=1 档）;clearWindow=true 即 :14035 折算（Y2 报告③既案）
        this.townAcceptLadder(game, n, true);
        // ★BJ662 补缺：W5 :13711 位落地（写梯后）——916 链电自城镇靶位寻
        //  CanBeChasedBy 敌,城镇 NPC 本体永免（_DarkHarvest.cs:18;链靶=tn 位）
        const tnL = n as TownNpcHitTarget;
        if (pendingDirect) {
          for (const d of pendingDirect) {
            darkHarvestChain(game, d, tnL.cx, tnL.cy, tnL.id);
          }
          pendingDirect = null;
        }
      },
      (n) => {
        const tn = n as TownNpcHitTarget;
        const direct: number[] = [];
        tn.hurtFx = (d: number) => { direct.push(d); };
        const timerCritT = tryConsumeTimerCritOf(this.ownerRef(), game, tn.x, tn.y, tn.w, tn.h);
        const monkCritT = monkAuraForcedCrit(this.ownerRef(), 644);
        const res = resolveWhipTagHit(tn, dmg, game,
          (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
          SUMMON_TAG_MUL[644] ?? 1, tn.cx, tn.cy, this.ownerRef(), 0, 644);
        pendingDirect = direct;                             // ★BJ662 补缺：汇出发布（settle 位=ModifyHit+OnHit 消费后）
        const golemCritT = rollGolemSentryCrit(game, 644, false);
        return {
          dmg: res.crit ? res.dmg / 2 : res.dmg,
          crit: res.crit || timerCritT || monkCritT || golemCritT,
          kb: Math.sign(tn.cx - bx) * this.knockback,
        };
      });
  }

  /** 同类计数（计数器/本体伤害档位用：831 宝石数 / 970 阿比盖尔数） */
  private peerCount(game: GameHooks, id: number): number {
    let n = 0;
    for (const e of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
      const m = e as MinionProj;
      if (m instanceof MinionProj && !m.dead && m.projId === id) n++;
    }
    return n;
  }

  /** 生成不占槽实体（计数器派生本体/守护者）。
   *  1457 UpdateAbigailStatus/UpdateStormTigerStatus（Player.cs:12380/:12421）：
   *  本体重生弹 knockBack 由 0f → 继承 projectile2.knockBack（计数器 kb）——
   *  本仓 spawnBody 恒传 this.knockback（计数器出生即持法杖 kb,Game 'summon'
   *  分支 spawnMinion 传 cw.knockback）→ 1457 语义已天然满足 */
  private spawnBody(game: GameHooks, projId: number, damage: number): MinionProj {
    const owner = this.ownerRef();
    const m = new MinionProj(this.cx, this.cy, projId, damage, this.knockback,
      false, 0, false, () => owner);
    m.noSlot = true;
    (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(m, 'projectiles');
    return m;
  }

  constructor(
    x: number, y: number, projId: number, damage: number, knockback: number,
    sentry: boolean, slot: number, ground: boolean,
    owner: () => Player | null,
  ) {
    super();
    this.x = x; this.y = y;
    this.projId = projId;
    this.damage = damage;
    this.knockback = knockback;
    this.sentry = sentry;
    // ★BJ608（2026-10-10）：哨兵=平台嵌入驻留承接 opt-in（TileCollision 越行块嵌入支
    //  消费旗,Entity.embedPlatSnap 注）——PickSentryLandingSpot spawnY=(首实心行−1)×16−24
    //  对 377 h=50 盒底嵌平台格 10px,出膛 vy15（Player.cs:48662-48684）需嵌入支拉回
    //  平台顶（BJ-C9-SP 用户基准）。非哨兵体恒 false=原版语义（嵌入盒永不承接）。
    if (sentry) this.embedPlatSnap = true;
    this.slot = slot;
    this.ground = ground;
    this.life = sentry ? 60 * 600 : Infinity; // 哨兵 10 分钟（哨兵类默认时限近似）
    this.ownerRef = owner;
    // 帕鲁出场淡入（SetDefaults alpha=255：1093 :10211/1112 :10377/1113 :10400/
    // 1094 :10222/1098 :10249/1123 :10512）★BJ517④：1094 补档（AI_026 :59197
    // DoPalAppearEffect——与 1113 :59210 同相）。★BJ518④（2026-10-05）：1118 摘出——
    // SetDefaults :10452-10464【无 alpha=255】（旧注「1118 :10485」系 1120 块 :10486
    // 误读;1118 亦无 DoPalAppearEffect 调用位,AI_067 flag8=:50489 仅 1093/1112）→
    // 原版 1118 出场即全显,旧 17t 淡入=自造面。
    this.alphaFade = projId === 1093 || projId === 1112 || projId === 1113
      || projId === 1094
      || projId === 1098 || projId === 1123
      // ★BJ709-G27 ④（2026-10-24）：龙链四段出场淡入——SetDefaults alpha=255
      //  （:6750）,AI_121 自减 −42/拍（:43783/:43852,头支 alpha>0 门内、段支
      //  无条件=0 后 no-op,观测等价 ≈7t 渐显）+淡入期 2×dust135（:43777-43782/
      //  :43845-43850）。非 DoPalAppearEffect（−15 档）——减法在 dragonHead/
      //  dragonSegment 体内承载。伤害无 α 门（Damage_CanDealDamage :12461-12510
      //  亲读无 625-628 α 条件）=淡入期照常接触伤。
      || (projId >= 625 && projId <= 628) ? 255 : 0;
    // 命中盒真值（SetDefaults width/height——MinionProj 缺省 16×16；与
    // vanilla-projectiles.json 对齐，绘制侧 1:1 贴图锚盒左上、与盒尺寸解耦）：
    //  钻地龟 1098/1123 34×34（:10245-10246/:10507-10508）
    //  帕鲁地面随从 1093/1112/1118 14×22（:10199-10200/:10365-10366/:10453-10454）
    //  禁戒魂灵 1119 14×22（:10467-10468）/ 火绒狐 1113 18×18（:10381-10382）
    if (projId === 1098 || projId === 1123) { this.w = 34; this.h = 34; }
    else if (projId === 1093 || projId === 1112 || projId === 1118 || projId === 1119) { this.w = 14; this.h = 22; }
    // 火绒狐 1094/1113 双型 18×18（1094 SetDefaults Projectile.cs:10215-10216——
    // ★2026-09-06 杂项簇批补：旧表只注册了 1113（:10382-10383）,1094 漏注册落
    // 16×16 缺省=判定盒/湿段采样盒窄 2px）
    else if (projId === 1094 || projId === 1113) { this.w = 18; this.h = 18; }
    // ★BJ521①（2026-10-05,BJ520① 移交债）：AI_026 尾族真盒补注册（SetDefaults 亲读;
    //  此前 191-194/266 落 16×16 缺省 ⇒ 判定盒/湿段采样盒差 2-8px）：
    //  俾格米 191-194 18×18（:2794-2795）——192/193/194 带 scale 1.025/1.05/1.075
    //  （:2804-2812;191 无 scale 行=字段缺省 1f :322）,SetDefaults 尾 width×scale
    //  截断（:10674-10675）→ 18×1.075f=19.35 → 194 终盒 19×19（192/193 仍 18,
    //  18.45/18.9 截断回 18）;266 宝宝史莱姆 24×16（:3519-3520,无 scale 行）。
    //  数据面 vanilla-projectiles.json 存 SetDefaults 字面+scale,按尾式折算与本链一致
    else if (projId === 191 || projId === 192 || projId === 193) { this.w = 18; this.h = 18; }
    else if (projId === 194) { this.w = 19; this.h = 19; }      // 18×1.075f=19.35 截断（:10675）
    else if (projId === 266) { this.w = 24; this.h = 16; }
    // 蘑菇小伙伴 1022（Dead Cells 联动,5456）：20×30（SetDefaults Projectile.cs:9670-9671）
    else if (projId === 1022) { this.w = 20; this.h = 30; }
    // ★SW-BJ13 2026-09-07：34788 专绘支家族 SetDefaults 真盒补注册（此前落 16×16
    //  缺省 ⇒ 判定盒/盒心锚与精灵错位——本支 draw 锚=盒心系,盒错即绘错）：
    //  海盗三变体 393-395 20×30（:4758-4759）/ 异星 UFO 423 28×28（:4964-4965）/
    //  雾网蜘蛛 1036 18×10（:9770-9771）
    else if (projId === 393 || projId === 394 || projId === 395) { this.w = 20; this.h = 30; }
    else if (projId === 423) { this.w = 28; this.h = 28; }
    else if (projId === 1036) { this.w = 18; this.h = 10; }
    // ★SW-BJ17 2026-09-07：仆从构造器 13 id 真盒收尾批（前批移交件;与 minionTrueBox
    //  单源同步,判据同 BJ13/BJ16）。移交清单中 393-395/758/1036 已由 BJ13/BJ16 注册
    //  （对反编译终值核对一致）,本批补余下 8 id——此前全落 16×16 缺省 ⇒ 判定盒/湿段
    //  采样盒窄:乌鸦 317 28×28（:4104-4105）/ 蜘蛛三型 390-392 30×30（:4746-4747）/
    //  沙漠虎一档 833 26×20（:8086-8087）/ 二三档 834-835 20×30（:8100-8101/:8114-8115）/
    //  酷鞭雪花哨兵 917 30×30（:8705-8706）。各块无 scale 行 → 字面=SetDefaults 终值
    //  （尾 width×scale :10674-10675 恒等）。
    //  ★出生位半盒偏差备案（调用侧域外,本批不落刀）：通用 spawnMinion（Game.ts:15688）
    //  把钳制后 MouseWorld、WhipProj.spawnSidekick 把敌怪 Center 直传盒左上,而原版
    //  NewProjectile :10878 X−w×0.5=中心语义 → 真盒中心的右下偏 = 半盒（16×16 时代
    //  8px 恒偏,本批后 317=14px、390-392=15px、833=(13,10)px、834-835=(10,15)px、
    //  917=15px——偏移随盒扩容增大,随从 AI 入场即自纠,瞬态视觉;先例=钻地龟调用点
    //  中心换算已修,spawnDigtoiseOnCursor。修复属 Game.ts/WhipProj.ts 调用侧）
    else if (projId === 317) { this.w = 28; this.h = 28; }
    else if (projId === 390 || projId === 391 || projId === 392) { this.w = 30; this.h = 30; }
    else if (projId === 833) { this.w = 26; this.h = 20; }
    else if (projId === 834 || projId === 835) { this.w = 20; this.h = 30; }
    else if (projId === 917) { this.w = 30; this.h = 30; }
    // ★SW-BJ16 2026-09-07：33693 中心锚支家族 SetDefaults 真盒补注册（同 BJ13 判据：
    //  本支 draw 锚=盒心系,盒错即绘错；此前除 643/1098/1123/1119 外全落 16×16 缺省）：
    //  星尘细胞 613 24×24（:6600-6611）/ 星尘守护者 623 50×80（:6713-6714）/
    //  龙链四段 625-628 24×24（:6741-6742 初盒;★G27② AI 逐拍 30×scale 覆写）/ 彩虹水晶 643 已注册 32×32（:6932-6933）/
    //  吸血蛙 758 20×30（:7817-7818）/ 雀杖 759 10×10（:7839-7840）/ 虎宝石 831 10×10
    //  （:8073-8074）/ 雪怪 951 26×26（:8972-8973）/ 阿比盖尔体 963 30×48（:9106-9107）/
    //  阿比盖尔计数器 970 10×10（:9188-9189）
    else if (projId === 613) { this.w = 24; this.h = 24; }
    else if (projId === 623) { this.w = 50; this.h = 80; }
    else if (projId === 625 || projId === 626 || projId === 627 || projId === 628) { this.w = 24; this.h = 24; }
    else if (projId === 758) { this.w = 20; this.h = 30; }
    else if (projId === 759 || projId === 831 || projId === 970) { this.w = 10; this.h = 10; }
    // ★BJ635：AI_066 三型真盒补注册（SetDefaults :4714-4715/:4730-4731/:6005-6006）——
    //  此前 387/388 落 16×16 缺省（原版 40×20,分离力判定盒 width=40 亦随真盒）、
    //  533 落 16×16（原版 20×20）
    else if (projId === 387 || projId === 388) { this.w = 40; this.h = 20; }
    else if (projId === 533) { this.w = 20; this.h = 20; }
    // ★BJ684（2026-10-15 连坐刀）：血红蝙蝠 755 真盒 10×10（SetDefaults :7781-7782
    //  亲读——netImportant/width=10/height=10）——此前落 16×16 缺省 = 判定盒/
    //  湿段采样盒偏大（bHitTick AABB 亦随盒偏大）。946 盒 7×7（scale 0.75×10 截 7）
    //  已在 terraprismaAI 首拍 tInit 设置,不在此注册。
    else if (projId === 755) { this.w = 10; this.h = 10; }
    // ★BJ634：刃杖 864 真盒 10×10（SetDefaults :8288-8289）——此前落 16×16 缺省
    //  = 判定盒/湿段采样盒偏大（编队悬浮锚命中面亦随盒偏移）
    else if (projId === 864) { this.w = 10; this.h = 10; }
    else if (projId === 951) { this.w = 26; this.h = 26; }
    else if (projId === 963) { this.w = 30; this.h = 48; }
    // ★GC 移交收口（终局扫尾批 A7，2026-08-31）：DD2 哨兵塔 SetDefaults 真盒注册——
    //   此前 663 族/弩车族落 16×16 兜底 ⇒ 判定盒/索敌锚与贴图错位。
    //   · 爆炸烈焰塔（AI_130）SetDefaults(:7132-7157)：663=30×54 → 665=28×58 →
    //     667=28×60（逐型覆写 switch 在主块内,终值以此为准）
    //   · 弩车三档（AI_134,:7243-7255）：677/678/679 恒 26×54
    //   锚仍成立性核对：F6 弩车瞄准基准 spotY134 = center.Y−(677?4:0)、火焰塔炮口
    //   Bottom+(dir*6,-Δ)=y+h−tier.dy——两者皆盒相对式,真盒扩容后语义不变；
    //   首帧放位由落地扫描 y 定格（moveAndCollide 收敛到地面),盒高变化不漂移锚点。
    else if (projId === 663) { this.w = 30; this.h = 54; }      // :7133-7134 主块
    else if (projId === 665) { this.w = 28; this.h = 58; }      // :7141-7144 覆写
    else if (projId === 667) { this.w = 28; this.h = 60; }      // :7145-7148 覆写
    else if (projId === 677 || projId === 678 || projId === 679) { this.w = 26; this.h = 54; }  // :7244-7245
    // ★三轮蓝队 F5③：法杖系哨兵 SetDefaults 真盒补注册（物品 1572/2366/3571/3569/
    //   5119/5463 → shoot 308/377/643/641/966/1025,vanilla-itemfunc.json）——此前落
    //   16×16 兜底 ⇒ 判定盒/索敌锚（AI_053 炮口 :27289-27305 为盒相对式）与贴图错位。
    //   真盒扩容前后视觉差说明：
    //   · 308 冰九头蛇 16→80×74（:4001-4002）：命中判定从芯点扩到塔身全影,
    //     索敌锥区随盒心右移；旧绘制因整图兜底锚无视觉漂移（贴图本按帧切片居中）
    //   · 377 蜘蛛皇后 16→66×50（:4619-4620）：贴图设计恰 66×50 ⇒ 绘制零变化、
    //     纯判定面扩容（打它更实了）
    //   · 641 月门 / 643 彩虹水晶 16→32×32（:6919-6920/:6932-6933）：传送门弹拾取/
    //     水面等盒判加宽;悬浮位不受影响（FLOATING_SENTRIES 免落地扫描）
    //   · 966 猎犬底座 16→18×60（:9146-9147）：盒高 60 贴合石桩立柱,炮口扇区
    //     （Bottom 锚带）对位上移 22px;弹落点可见更准
    //   · 1025 悬空毒眼球 16→42×38（:9710-9711）：悬浮盒≈贴图 46×62 帧体,
    //     命中判定追平眼柄轮廓
    else if (projId === 308) { this.w = 80; this.h = 74; }
    else if (projId === 377) { this.w = 66; this.h = 50; }
    else if (projId === 641 || projId === 643) { this.w = 32; this.h = 32; }
    else if (projId === 966) { this.w = 18; this.h = 60; }
    else if (projId === 1025) { this.w = 42; this.h = 38; }
  }

  /** 归属玩家（ownerRef 公开读——Game 抚摸白名单按 owner 过滤） */
  get ownerPlayer(): Player | null { return this.ownerRef(); }

  /** AI_Sentries_HeavySlingReposition（1457 Projectile.cs:70096-70470）1:1——被哨兵
   *  背包四件（accSentryBackpack 6172 重携/6175 侦察/6176 圣殿骑士/6177 皇家卫队,
   *  ApplyEquipFunctional :14612-14614/:14670-14677/:14678-14681/:14682-14685 全置旗）
   *  携带中的哨兵每拍重定位。分支序照原文：
   *    !accSentryBackpack → Kill（:70098-70102）→ 早退三支（aiStyle 123∪84
   *    :70108-70126 / aiStyle 137 :70127-70137 / type 966 :70138-70150）→ 通用路
   *    （scale=1 :70152 + vector=Size/2 :70157 + per-type 308/377 :70160-70182 +
   *    flag3=1025 :70184-70206 + flag4=aiStyle134 :70207-70213 + aiStyle130
   *    :70214-70227 + flag5=aiStyle138 :70228-70250）→ 坐骑 switch（default 支
   *    :70255-70265 + ★BJ519②：55 Rat :70266-70286 / 61 Pixie :70287-70306 /
   *    56 Bat :70307-70340 / 54 Velociraptor :70341-70353 / 52 Wolf :70354-70364
   *    专支 1:1 折算）→ 尾 if(flag) Y+=gfxOffY（:70466-70468,开旗可达）+ floor
   *    （:70469）。
   *  ★BJ519②（2026-10-05）：BJ518⑥ 登记债清偿——flag = IsTransformationMount
   *  （:70104;MountID.cs:23={52 Wolf,54 Velociraptor,55 Rat,56 Bat,61 Pixie}）
   *  开旗 + per-mount 几何 switch 折算（下方坐骑支）。flag 加成支（308/377 免 −20、
   *  1025 rot=π+vec2X+17、ballista +24、flameburst +(−14dir,25)、trap 免 vec2 赋值
   *  改 +5/rot=0）既有门条件由不可达转可达,零改码。mount 43 pushFromOriginHack
   *  （:70252-70254）与 43∉变身集互斥仍不可达（fullRotation 建模同账）。
   *  flag2 = mount.AnyTrackRider（Mount.cs:558-573 Minecart∪CanRideMinecartTracks）
   *  → 本仓等价位 = ridingCart（矿车轨道骑乘,Minecart.ts 接管）。
   *  OffsetsPlayerHeadgear（Main.cs:530-551）行 = bodyFrame.Y/Height——帧行状态机在
   *  渲染侧（Renderer.playerFrameRows）,实体侧无此状态;按行 0 落位（vector3.Y=
   *  2−2=0）,行∈{7,8,9,14,15,16}（跳/落帧）才产生 −2px 差,备案。
   *  RotatedRelativePoint 经 Player.rotatedRelativePoint（Player.cs:4209-4237 1:1,
   *  fullRotation 恒 0 → 恒等+gfxOffY;sleeping/sitting 偏移支见该处备案）。
   *  scale/pushFromOriginHack（:70152-70156/:70252-70254）:scale 通道 ★BJ518⑥ 已建
   *  （drawScale 镜像——1025 缩体支 0.5,BJ357 变身坐骑使 owner.h<42 可达,旧「不可达」
   *  判谳废止;folded-stool 态 h=68 更大不触发本支的旧论证仍真）;pushFromOriginHack 仅
   *  fullRotation≠0 消费,未建模恒 0（43 pogo/49 熔岩鲨旋同账,Mounts.ts 备案）。 */
  private heavySlingReposition(owner: Player): void {
    if (!owner.equipStats.accSentryBackpack) { this.dead = true; return; }   // :70098-70102
    // ★BJ519②：flag 开旗——IsTransformationMount（:70104）={52,54,55,56,61}
    //  （MountID.cs:23;vanilla-mounts.json sets 同值）,per-mount 几何见下方坐骑支。
    //  旧「变身坐骑未建,恒 false」判谳（BJ518⑥ 立债）随 BJ357 三骑（55/56/61）
    //  可骑乘 + 本批 switch 折算废止。
    const flag = owner.mount.active && owner.mount.type >= 0
      && !!MOUNT_SETS.IsTransformationMount?.[owner.mount.type];
    const flag2 = owner.ridingCart === true;               // AnyTrackRider（:70105）
    const num = Math.min(21, owner.h / 2);                 // :70106（h≥42 → 恒 21）
    const grav = owner.gravDir;
    const mc = owner.mountedCenter;
    const gfx = owner.gfxOffY;
    const pdir = owner.facing < 0 ? -1 : 1;                // player.direction
    // ★BJ518⑥：player.fullRotation 单源读值（Minecart 轨/滚轴鞋/Hover 7·8·23;
    // 43/49/55 未建模恒 0=Mounts.ts 既有备案）——1025 缩体支 num2 项与 :70205
    // rotation += fullRotation 消费;★G32① 勘正：trap（aiStyle 138 flag5 尾）原版
    // 亦有 :70251 读位（旧注「只 1025 支读」系漏读,本刀补接线）
    const fullRotBJ518 = playerFullRotationOf(owner, owner.mount, owner.cart)?.angle ?? 0;
    const floorPos = (): void => { this.x = Math.floor(this.x); this.y = Math.floor(this.y); };
    // ---- 早退支①：aiStyle 123（641 月门/643 彩虹水晶）∪ 84（642 激光随 641 携带,
    //      Projectile.cs:31963-31970 调本函数。★BJ639 批 1：642 连续激光已落
    //      MoonGateBeam（束心每拍锁 641 Center=随行自动成立,本早退支仅剩 641/643
    //      携行自身重定位面;642 弹本体不再入哨兵集合）----
    if (this.projId === 641 || this.projId === 643) {
      // :70110-70112 Center = MountedCenter + (0, gravDir * -(num + 20 + height/2))
      this.x = mc.x - this.w / 2;
      this.y = mc.y + grav * -(num + 20 + Math.trunc(this.h / 2)) - this.h / 2;
      this.y += gfx;                                       // :70113 position.Y += gfxOffY
      // aiStyle==84 支 position.Y += -6*gravDir（:70115-70117）——642 不在本仓哨兵集合
      if (flag2) {                                         // :70119-70122 Bottom = RotatedRelativePoint(Bottom)
        const b = owner.rotatedRelativePoint(this.cx, this.y + this.h);
        this.x = b.x - this.w / 2; this.y = b.y - this.h;
      }
      floorPos();                                          // :70124
      return;
    }
    // ---- 早退支②：aiStyle 137（688/689/690 闪电光环）(:70127-70137) ----
    if (AURA_TOWER.has(this.projId)) {
      this.x = mc.x - this.w / 2; this.y = mc.y - this.h / 2;   // :70129 Center = MountedCenter
      this.y += gfx;                                       // :70130
      if (flag2) {                                         // :70132-70135 Center = RotatedRelativePoint(Center)
        const c = owner.rotatedRelativePoint(this.cx, this.cy);
        this.x = c.x - this.w / 2; this.y = c.y - this.h / 2;
      }
      floorPos();
      return;
    }
    // ---- 早退支③：type 966 猎犬（:70138-70150）----
    if (this.projId === 966) {
      this.x = mc.x - this.w / 2;
      this.y = mc.y + grav * -num - this.h / 2;            // :70140-70142
      if (grav === -1) this.y += 32;                       // :70143-70145
      this.y += gfx;                                       // :70146
      if (flag2) {
        const b = owner.rotatedRelativePoint(this.cx, this.y + this.h);
        this.x = b.x - this.w / 2; this.y = b.y - this.h;
      }
      floorPos();
      return;
    }
    // ---- 通用路：scale=1（:70152,★BJ519②：变身骑 scale 支归位基准）+ vector2 起零、
    //      vector = Size/2（:70157-70158）----
    this.drawScale = 1;
    let vec2X = 0, vec2Y = 0;
    let vecX = this.w / 2, vecY = this.h / 2;
    if (this.projId === 308 || this.projId === 377) {      // :70160-70182 per-type
      if (this.projId === 308) {
        if (this.facing === 1) vec2X = -14;                // :70163-70166 spriteDirection==1
        vec2X += 10 * this.facing;                         // :70167
        if (!flag) vec2Y += -20;                           // :70168-70170
      } else {
        vec2X += this.facing;                              // :70173-70174
        if (!flag) vec2Y += -20;
        if (grav === -1) vec2Y += 10;                      // :70177-70179
      }
      vecX = this.w / 2; vecY = Math.fround(this.h * 0.9); // :70171/:70180（0.9f f32 敏感）
    }
    if (this.projId === 1025) {                            // flag3（:70184-70206）
      vec2X += pdir * -25; vec2Y += grav * 4;              // :70186
      this.rot = pdir === 1 ? Math.PI / 2 : -Math.PI / 2;  // :70187
      if (pdir === -1) vec2X += pdir * 4;                  // :70188-70190（=−4）
      if (grav === -1) vec2Y += 4;                         // :70191-70193
      if (flag) { this.rot = Math.PI; vec2X += pdir * 17; } // :70194-70197（变身坐骑,不可达照抄）
      if (owner.h < 42) {                                  // :70198-70205 height < DefaultSize.Y
        // ★BJ518⑥（2026-10-05）：缩体支补全——旧「owner.h<42 不可达」判谳废止：
        //  BJ357 变身坐骑 PlayerSize（55 Rat 14×14/56 Bat 20×18/61 Pixie 8×14,
        //  DelegateMethods.cs:166-189）使 height<42 可达。补 scale=0.5（:70200）+
        //  fullRotation 相位项（:70202-70203,num2=|fullRotation|/(π/2),偏移
        //  (direction×−4,gravDir×8)×num2）;drawScale 消费见 draw
        this.rot = Math.PI;
        this.drawScale = 0.5;
        vec2Y += 5;
        const num2Shrink = Math.abs(fullRotBJ518) / (Math.PI / 2);
        vec2X += pdir * -4 * num2Shrink;
        vec2Y += grav * 8 * num2Shrink;
      } else {
        this.drawScale = 1;                                // :70206 else scale = 1f（AI_197 携带块同款）
      }
      this.rot += fullRotBJ518;                            // :70205 rotation += player.fullRotation
    }
    if (BALLISTA_TOWER.has(this.projId)) {                 // flag4 = aiStyle 134（:70207-70213）
      vec2X = 0; vec2Y = grav * -14;                       // :70209（赋值覆写）
      if (flag) vec2Y += 24;                               // :70211-70212
    }
    if (FLAMEBURST_TOWER.has(this.projId)) {               // aiStyle 130（:70214-70227）
      vec2X = pdir * 10; vec2Y = grav * -11;               // :70215（赋值覆写）
      if (this.facing !== pdir) vec2X += this.facing * -2; // :70216-70219 direction != player.direction
      vecX = this.w / 2; vecY = this.h;                    // :70220
      if (flag) { vec2X += pdir * -14; vec2Y += 25; }      // :70222-70225
    }
    if (TRAP_TOWER.has(this.projId)) {                     // flag5 = aiStyle 138（:70230-70252）
      if (!flag) {
        vec2X = pdir * -9; vec2Y = 0;                      // :70235（赋值覆写）
        if (pdir === -1) vec2Y += 2;                       // :70236-70239
        if (grav === -1) vec2Y -= 2;                       // :70240-70243
      }
      this.rot = pdir === 1 ? Math.fround(4.712389) : Math.PI / 2;   // :70245
      if (flag) { vec2Y += 5; this.rot = 0; }              // :70246-70250
      // ★BJ709-G32①（G30 登记债⑩清偿,2026-10-24）：:70251 `rotation += player.
      //  fullRotation` —— 旧注「其余型原版亦只 1025 支读 fullRotation」系漏读 flag5
      //  尾行（:70152-70212 外）,本行随刀补齐;消费面=draw 支三处 ctx.rotate（同刀）。
      this.rot += fullRotBJ518;                            // :70251 rotation += player.fullRotation
    }
    // ---- 坐骑 switch（:70255-70464,★BJ519② 1:1 折算）----
    // MountedTop（Player.cs:3333-3346）：x=Center.X;y=pos.Y+HOC（grav=1）/Bottom.Y−HOC
    // （grav=−1）;HOC=PlayerOffsetHitbox（Mount.cs:427-436）=−PlayerOffset+heightBoost。
    // 五骑 heightBoost=0;PlayerOffset=playerYOffsets[frame]（52 Wolf 非零表,余全零——
    // vanilla-mounts.json）。坐骑态 vanilla pos.Y≡this.y−boost、Bottom.Y≡this.y+this.h
    // （Player.ts deadCellsBeheadedStep :7956-7965 既有换算;55/56/61 PlayerSize 缩盒
    // box=vanilla 盒,52/54 无委派 boost=0 → 同式归一）
    const mntBoost = owner.mount.active ? owner.mount.heightBoost : 0;
    const mntHoc = mntBoost - (owner.mount.active ? owner.mount.playerOffset : 0);
    const mntTopY = grav === 1
      ? (owner.y - mntBoost) + mntHoc
      : (owner.y + owner.h) - mntHoc;
    const mntType = owner.mount.active ? owner.mount.type : -1;   // switch (player.mount.Type)
    const isTrap5 = TRAP_TOWER.has(this.projId);                  // flag5 = aiStyle 138
    const isBall4 = BALLISTA_TOWER.has(this.projId);              // flag4 = aiStyle 134
    const is1025 = this.projId === 1025;                          // flag3
    if (mntType === 55) {
      // case 55 Rat（:70266-70286）：Bottom=Top;帧 0/11-12/15-16 → num9=2;
      // trap 缩半 num7=9/num8=2;ballista num8+=8;X −= num8·dir;尾 Bottom+=vector2
      this.x = owner.cx - this.w / 2; this.y = owner.y - this.h;  // Bottom = player.Top
      let num7 = 10, num8 = 0;
      const mf = owner.mount.frame;
      const num9 = (mf === 0 || (mf >= 11 && mf <= 12) || (mf >= 15 && mf <= 16)) ? 2 : 0;
      if (isTrap5) { this.drawScale = 0.5; num7 = 9; num8 = 2; }  // :70277-70281
      if (isBall4) num8 += 8;                                     // :70282-70284
      this.y += num7 + num9;                                      // :70285
      this.x += -num8 * pdir;                                     // :70286
      this.x += vec2X; this.y += vec2Y;                           // :70287 Bottom += vector2
    } else if (mntType === 61) {
      // case 61 Pixie（:70288-70307）：Bottom=Top;trap 缩半 20/4+rot+=dir·π/2;
      // 1025 16/10+rot−=dir·π/2;X −= num6·dir;尾 Bottom+=vector2
      this.x = owner.cx - this.w / 2; this.y = owner.y - this.h;
      let num5 = 10, num6 = 0;
      if (isTrap5) {                                              // :70292-70297
        this.drawScale = 0.5; num5 = 20; num6 = 4;
        this.rot += pdir * (Math.PI / 2);
      }
      if (is1025) { num6 = 10; num5 = 16; this.rot -= pdir * (Math.PI / 2); }   // :70298-70302
      this.y += num5;                                             // :70303
      this.x += -num6 * pdir;                                     // :70304
      this.x += vec2X; this.y += vec2Y;                           // :70305 Bottom += vector2
    } else if (mntType === 56) {
      // case 56 Bat（:70308-70341）：冲刺滑行 Bottom=Top+(4dir,3)+(0,−2);常态 dir>0
      // Left+(9,0)/否则 Right+(−10,0);trap 缩半 vec2(+dir·4,+8)+rot+=π;1025
      // vec2(+dir·12,−4);帧 3-5 → num3=0 余 2;Bottom+=vec2+(0,num3) → RRP(Bottom)
      // （dash>0 半支：仓内 dashDelay<0 仅由 dash 发起进入=隐含,Player.ts dash 面备案）
      if (owner.dashDelay < 0) {                                  // :70310-70315
        this.x = owner.cx + 4 * pdir - this.w / 2;
        this.y = owner.y + 3 - 2 - this.h;
      } else if (pdir > 0) {                                      // :70316-70320
        this.x = owner.x + 9 - this.w / 2; this.y = owner.cy - this.h;      // Left+(9,0)
      } else {
        this.x = owner.x + owner.w - 10 - this.w / 2; this.y = owner.cy - this.h; // Right+(−10,0)
      }
      if (isTrap5) {                                              // :70321-70326
        this.drawScale = 0.5; vec2Y += 8; vec2X += pdir * 4; this.rot += Math.PI;
      }
      if (is1025) { vec2Y -= 4; vec2X += pdir * 12; }             // :70327-70330
      const mf = owner.mount.frame;
      const num3 = (mf >= 3 && mf <= 5) ? 0 : 2;                  // :70331-70337 (uint)(num4-3)<=2
      this.x += vec2X; this.y += vec2Y + num3;                    // :70338 Bottom += vector2+(0,num3)
      const rb = owner.rotatedRelativePoint(this.cx, this.y + this.h);          // :70339 RRP(Bottom)
      this.x = rb.x - this.w / 2; this.y = rb.y - this.h;
    } else if (mntType === 54) {
      // case 54 Velociraptor（:70342-70354）：trap vec2Y++ 缩半;Bottom=MountedTop+
      // (−12dir,16) → +vector2 → RRP(Bottom)
      if (isTrap5) { vec2Y += 1; this.drawScale = 0.5; }          // :70343-70347
      this.x = owner.cx - 12 * pdir - this.w / 2;                 // :70348
      this.y = mntTopY + 16 - this.h;
      this.x += vec2X; this.y += vec2Y;                           // :70350 Bottom += vector2
      const rb = owner.rotatedRelativePoint(this.cx, this.y + this.h);          // :70352 RRP(Bottom)
      this.x = rb.x - this.w / 2; this.y = rb.y - this.h;
    } else if (mntType === 52) {
      // case 52 Wolf（:70355-70365）：Bottom=MountedTop+(−4dir,10);ballista Y+=4;
      // +vector2 → RRP(Bottom)
      this.x = owner.cx - 4 * pdir - this.w / 2;                  // :70356
      this.y = mntTopY + 10 - this.h;
      if (isBall4) this.y += 4;                                   // :70357-70359
      this.x += vec2X; this.y += vec2Y;                           // :70360 Bottom += vector2
      const rb = owner.rotatedRelativePoint(this.cx, this.y + this.h);          // :70362 RRP(Bottom)
      this.x = rb.x - this.w / 2; this.y = rb.y - this.h;
    } else {
      // default（:70255-70265）：Center = MountedCenter + vector2 → 头盔行偏移 →
      // RRP(position+vector) − vector
      this.x = mc.x + vec2X - this.w / 2;
      this.y = mc.y + vec2Y - this.h / 2;
      // :70261-70263 vector3 = OffsetsPlayerHeadgear[row] + (0,-2),position +=
      // vector3*(0,gravDir)——行 0 基准 = (2−2)*grav = 0（帧行备案见方法头）
      // :70264 position = RotatedRelativePoint(position + vector, addGfxOffY) - vector
      //（恒等旋 → position + (0, gfxOffY)）
      const rp = owner.rotatedRelativePoint(this.x + vecX, this.y + vecY);
      this.x = rp.x - vecX; this.y = rp.y - vecY;
    }
    if (flag) this.y += gfx;                               // :70466-70468 if(flag) Y += gfxOffY（★BJ519② 开旗可达;55/61 无 RRP 内加、56/54/52 RRP 内已加,原式两处并存照抄）
    floorPos();                                            // :70469
  }

  /** 按 id 取敌（AI_120 ai[1] 目标槽 :42198-42207 等价） */
  private enemyById(game: GameHooks, id: number): EnemyLike | null {
    if (id < 0) return null;
    for (const e of game.enemies()) {
      const en = e as EnemyLike;
      if (!en.dead && en.id === id) return en;
    }
    return null;
  }

  /** 最近敌人（无目标 null）。鞭 tag 优先（原版随从锁定被鞭标记目标：
   *  Projectile.ApplyTag → npc.whipSet/whipTime，随从 TargetSlot 优先取 tag 敌）。
   *  sight：AI_062 族视线门（1457 :66392/:66435 CanHitLine 盒线 / :66413/:66435 963 走
   *  Collision.CanHit 中心 1×1）——'none' 缺省无门（其余 AI 族各自语义）。
   *  from：距离门测点——'self'=随从中心（缺省）；'player'=玩家中心（AI_062 的
   *  407/613/423 分支 :66363/:66391/:66374 以 Main.player[owner].Center 计距,
   *  1456 :62416/:62433 同段;集火门 :66374 同测点。登记:门距测敌心,423 原版测
   *  顶心 vector2=(0.5,0)（:66365-66368）——差 ≤敌半高,不另开通道）。
   *  anchor（★F4 新增,2026-08-30）：显式覆盖距离测点与 'line' 视线起点——
   *  AI_130 炮塔的 shootingSpot=Bottom+(direction*6,-Δ)（FindTarget :69418 端点
   *  :69426-69456），本体盒中心口径错挂已翻修；缺省行为零变化。
   *  gate（★F6 新增,2026-08-31 批①②）：AI_130/AI_134 FindTarget 的
   *  angleRatioMax/deadBottomAngle/directionLock 三门族——原版候选判定与距离/视线
   *  同条 && 链（:69434-69436/:69481-69483），集火路(:27431 OwnerMinionAttackTargetNPC
   *  模板的第一桶)与全局扫同吃同一谓词且【过门即整段 return】(焦点短路,:69445)。
   *  缺省 undefined → 零变化 */
  private nearestEnemy(game: GameHooks, maxRange: number,
    sight: 'none' | 'line' | 'point' = 'none', from: 'self' | 'player' = 'self',
    focusRange = 900, anchor?: { x: number; y: number }, gate?: TowerAimGate): EnemyLike | null {
    const p = this.ownerRef();
    if (!p) return null;
    const bx = anchor?.x ?? (from === 'player' ? p.cx : this.cx);
    const by = anchor?.y ?? (from === 'player' ? p.cy : this.cy);
    // 门向量基点 = 距离测点同心（FindTarget 的 vector 自 shootingSpot 出发）
    let best: EnemyLike | null = null;
    let bestD = maxRange;
    // ★BJ514：tag 桶态（tagged/taggedD/stack）已摘除——1457 无 tag 扫描索敌（见下）
    // 'line' 形状分流（★F4 定案 2026-08-31 二轮蓝队）：锚定模式 = FindTarget 字面点对端
    //  ——CanHitLine(shootingSpot,0,0 → nPC.Center,0,0)（AI_130 :69434/:69456、AI_134
    //  :69481/:69503）；非锚定 AI_062 族 = 盒线——CanHitLine(position,width,height →
    //  npc.position,width,height)（:66392）。Center 用浮点半宽、盒左上提取走 int÷ 半宽
    //  （canHitLineStartTile），奇数尺寸盒在半格交界处端格可差一格 ⇒ 两形不可互换。
    const lx = anchor?.x ?? this.x, ly = anchor?.y ?? this.y;
    const lw = anchor ? 0 : this.w, lh = anchor ? 0 : this.h;
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean };
      if (!canBeChasedBy(e)) continue;   // CanBeChasedBy :91070/:91141——友好+immortal 族不入索敌（防追踪睡渔夫/假人）
      if (!en || en.dead) continue;
      const d = Math.hypot(en.cx - bx, en.cy - by);
      // ★F6 方向/角度门：SafeNormalize(shootingSpot→敌心,UnitY)，零距走兜底 (0,1)
      const dl = d > 0 ? 1 / d : 0;
      const gnx = d > 0 ? (en.cx - bx) * dl : 0;
      const gny = d > 0 ? (en.cy - by) * dl : 1;
      const gated = towerAimGate(gnx, gny, gate);
      if (gated && d < bestD) {
        // 视线门不过 = 非候选（:66392/:66435 CanHitLine/CanHit 内联于候选判定）
        if (sight === 'line' && !canHitLine(game.world.store, lx, ly, lw, lh,
          anchor ? en.cx : en.x, anchor ? en.cy : en.y, anchor ? 0 : en.w, anchor ? 0 : en.h)) continue;
        if (sight === 'point' && !canHit(game.world.store, this.cx, this.cy, 0, 0, en.cx, en.cy, 0, 0)) continue;
        bestD = d; best = en;
      }
      // ★BJ514（2026-10-05,BJ512 登记债①清偿）：鞭 tag 扫描桶摘除——1457 全站
      //  无「tag 扫描式」索敌（TagEffectStack=伤害加成/proc 面 TagEffectStack.cs:1-139,
      //  不参与择敌;鞭→随从优先完全走单槽 MinionAttackTargetNPC Projectile.cs:14321-14323
      //  写槽 + 各 AI 第一桶消费）。本桶系先前批 eager 面,现役消费面仅此一处
      //  （WhipTag.anyTagged 随刀退役,见该文件头注）。
    }
    // 右键集火优先（OwnerMinionAttackTargetNPC 模板 :27431：有效且距本随从 <900；
    //  AI_062 集火同样过视线门 :66375/:66413,门距 = num12×3——num12 已被 :66327
    //  无条件覆盖 2000（963=700）→ 6000/2100。蓝队 R7-21：曾硬编码 900（引 AI_026
    //  模板值）,远屏集火 >900px 失效回退最近目标,鞭 tag 拉远打时随从脱靶）
    const focus = (p as unknown as { minionTargetId?: number }).minionTargetId ?? -1;
    if (focus >= 0) {
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike;
        // CanBeChasedBy 门（AI_121 集火原文 :43664/:40190 字面;通用层清偿 2026-09-08:
        //  曾缺门=训练假人 488/伪装雕像 690 等 immortal/exclude 族被集火锁定——
        //  未过门 → 集火作废,tag/野生支照走,同原版 num6=−1 回退）
        if (!en.dead && en.id === focus && canBeChasedBy(e)
          && Math.hypot(en.cx - bx, en.cy - by) < focusRange) {
          // ★F6 焦点同吃角度/方向门（FindTarget 内 OwnerMinionAttackTargetNPC 桶
          //  与全局扫共用同一谓词链 :69426-69456——过门才被采纳）
          const df = Math.hypot(en.cx - bx, en.cy - by);
          const dfl = df > 0 ? 1 / df : 0;
          if (!towerAimGate(
            df > 0 ? (en.cx - bx) * dfl : 0,
            df > 0 ? (en.cy - by) * dfl : 1,
            gate,
          )) break;
          if (sight === 'line' && !canHitLine(game.world.store, lx, ly, lw, lh,
            anchor ? en.cx : en.x, anchor ? en.cy : en.y, anchor ? 0 : en.w, anchor ? 0 : en.h)) break;
          if (sight === 'point' && !canHit(game.world.store, this.cx, this.cy, 0, 0, en.cx, en.cy, 0, 0)) break;
          return en;
        }
      }
    }
    return best;   // ★BJ514：tag 桶摘除后恒返回野生最近（原版无 tag 优先级面）
  }

  /** Minion_FindTargetInRange 1:1（1458 Projectile.cs:49884-49921;1457 :50581 同体）。
   *  终清波批：AI_067 族"单距检索近似"退役——双距语义核实（IsInRangeOfMeOrMyOwner
   *  :52406-52424 两版同段）：
   *    myDistance = |敌心−随从心|，<maxDistance 且 !CanHitWithOwnBody(四试) → ∞；
   *    playerDistance = |敌心−主心|，<maxDistance 且 !CanHitWithMeleeWeapon(四试) → ∞；
   *    closerIsMe 择小者 ≤ maxDistance 才算在域。检索循环阈值 num 单调收缩为
   *    min(num2=我侧最小, num3=主侧最小)，门序原文逐条转写：
   *      CanBeChasedBy ∧ 双距在域 ∧ (!skip ∨ CanHitWithOwnBody) ∧
   *      (nPC.boss ∨ viewRect[玩家中心 ±960×600 = CenteredRectangle(Main.MaxWorldViewSize
   *      1920×1200 :758)] 相交) ∧ customEliminationCheck(AI_067 族恒 true 不建模)。
   *  · respectOwnerTarget 焦点支（:49889-49897）→ 本仓 minionTargetId；命中即早退。
   *  ownerHitCheckDistance 默认 1000（Projectile.cs:306）对 startRange≤800 恒不束,
   *  ExtendedCanHitCheckRange 随从型空表（既有登记）。 */
  private findTargetInRangeDual(game: GameHooks, startRange: number,
    opts?: { skipIfCannotHitOwnBody?: boolean; customEliminationCheck?: (e: EnemyLike) => boolean;
      respectOwnerTarget?: boolean }): EnemyLike | null {
    const p = this.ownerRef();
    if (!p) return null;
    const st = game.world.store;
    let num = startRange;
    const num2 = { v: startRange };
    const num3 = { v: startRange };
    const dualRange = (e: EnemyLike, maxD: number):
      { ok: boolean; md: number; pd: number } => {
      let md = Math.hypot(e.cx - this.cx, e.cy - this.cy);
      if (md < maxD && !canHitWithOwnBodyBox(st, this.x, this.y, this.w, this.h, this.facing,
        e.x, e.y, e.w, e.h)) md = Infinity;
      let pd = Math.hypot(e.cx - p.cx, e.cy - p.cy);
      if (pd < maxD && !canHitWithMeleeWeaponBox(st, p.x, p.y, p.w, p.h, p.facing,
        e.x, e.y, e.w, e.h)) pd = Infinity;
      const closerIsMe = md < pd;                        // :52418
      return { ok: (closerIsMe ? md : pd) <= maxD, md, pd };   // :52420-52423
    };
    // ★BJ515 债④：形参 1:1（:49883 五参形）——respectOwnerTarget=false 跳过焦点支
    //  （:49888;AI_067 内 flag7=1036 档置假 :50519-50523,本仓 1036 未重路由不接）;
    //  skipIfCannotHitOwnBody（:49905 `!skip || CanHitWithOwnBody`——AI_067 六站
    //  skip=true :50524,双距 ok 之外的独立本体盒门,IsInRangeOfMeOrMyOwner 内嵌
    //  myDistance 支不覆盖 playerDistance 通路）与 customEliminationCheck
    //  （:49905 尾位,AI_206 :38199 = CanHitLine 本体盒→敌盒）野生扫消费,焦点支
    //  两参皆不消费（:49888-49896 原文面）。
    // ---- focus 支（OwnerMinionAttackTargetNPC :49891;respectOwnerTarget 门 :49888）----
    const focus = (p as unknown as { minionTargetId?: number }).minionTargetId ?? -1;
    if (focus >= 0 && opts?.respectOwnerTarget !== false) {
      for (const e of game.enemies()) {
        const en = e as never as EnemyLike & { dead: boolean };
        if (!en || en.dead || en.id !== focus) continue;
        if (canBeChasedBy(e)) {
          const r = dualRange(en, num);
          if (r.ok) return en;                           // 命中即整段退回 :49895
        }
        break;                                           // 原版单槽直查非全表扫
      }
    }
    // ---- 全局扫（:49903-49920）----
    let best: EnemyLike | null = null;
    for (const e of game.enemies()) {
      const en = e as never as EnemyLike & { dead: boolean; boss?: boolean };
      if (!canBeChasedBy(e)) continue;
      if (!en || en.dead) continue;
      const r = dualRange(en, num);
      if (!r.ok) continue;
      // ★BJ515 债④：:49905 中段 `(!skipIfCannotHitWithOwnBody || CanHitWithOwnBody)`
      // ——双距面外独立门（AI_067 六站 skip=true）
      if (opts?.skipIfCannotHitOwnBody && !canHitWithOwnBodyBox(st, this.x, this.y, this.w,
        this.h, this.facing, en.x, en.y, en.w, en.h)) continue;
      const isBoss = en.boss === true
        || ((e as unknown as { def?: { boss?: boolean } }).def?.boss === true);
      // viewRect = Utils.CenteredRectangle(player.Center, MaxWorldViewSize)（:49898）
      const vx0 = p.cx - 960, vy0 = p.cy - 600;
      const inView = en.x + en.w > vx0 && en.x < vx0 + 1920
        && en.y + en.h > vy0 && en.y < vy0 + 1200;
      if (!(isBoss || inView)) continue;
      // ★BJ515 债④：:49905 尾位 customEliminationCheck（AI_206 = CanHitLine 盒;
      //  AI_067 = AI_067_CustomEliminationCheck_Pirates 恒 true :49922-49925 不建模）
      if (opts?.customEliminationCheck && !opts.customEliminationCheck(en)) continue;
      best = en;                                         // 过门即覆写 :49908
      if (num2.v > r.md) num2.v = r.md;                  // :49910-49917
      if (num3.v > r.pd) num3.v = r.pd;
      num = Math.min(num2.v, num3.v);                    // :49918 收缩阈值
    }
    return best;
  }


  fixedUpdate(dt: number, game: GameHooks) {
    void dt;
    // ---- ★BJ650件1 返工：whoAmI 槽位懒快照（首拍一次）——注册表插入位 =
    //  原版 Main.projectile 首空闲槽对映（语义详字段注）。 indexOf 一次 O(n) 可忽略。 ----
    if (this.whoAmI < 0) {
      this.whoAmI = Math.max(0,
        (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.indexOf(this));
    }
    // ---- ★通用湿段（:16895-17113,共享体;溅花尘/音=wetSplashStepShared 弹面 10 粒）----
    //  tick 头插位（杀拍覆盖/采样位/域论证见字段块头注）;阻尼=位移处乘档位
    //  （palGroundStep/mushBoiStep/digtoiseStep/ai067WalkChase/spiderStep/frogStep/
    //  ravenBody/whip 族 1036/通用飞行·地面各积分位——旧受段族批同口径）。
    //  ★AI 湿旗读相=上拍快照 wetAi（定谳①②③见字段块头注）：首拍预置先行单跑
    //  （=首拍当拍段:首拍未移动,采样位=出生盒=vanilla NewProjectile :10886-10893
    //  同位）→ 快照=预置值;后续拍先快照（=上拍段尾 this.wet,vanilla AI 读上拍段值
    //  同源）再跑当拍段。湿段副作用时序（溅花/wetCount/三清）与本插位批完全不变。
    const runWet = MINION_WET_IDS.has(this.projId);
    const presetFirst = runWet && !this.presetDone;
    // ★BJ520②：lavaWet 读相快照先于预置/当拍段（=上拍段尾值;wetAi 的「首拍预置后取」
    //  同位论证仅对 wet/honey/shimmer 成立——NewProjectile 不写 lavaWet,首拍 AI 读值
    //  应为构造值 false,故本快照位次在预置调用之前）
    this.lavaWetAi = this.lavaWet;
    if (presetFirst) {
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
    }
    this.wetAi = this.wet;
    if (runWet && !presetFirst) {
      projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
    }
    this.age++;
    if (this.attackFlash > 0) this.attackFlash--;
    // ★BJ697 债①：localNPCImmunity 全表逐 t 递减（原版 Update :15330 头 →
    //  DecrementLocalImmuneTimeCounters :17365-17385,先于一切 AI/伤害/早退支）。
    //  龙链段（parentRef≠null,626-628+延伸段）与头共享同一 hitCd 实例——唯头
    //  （parentRef null）tick,每 t 恰一减;段读已纯化（ready 无副作用）零多减。
    if (!this.parentRef) this.hitCd.tick();
    // ---- 族专属召唤音（生成后首帧起按 at 节拍各一次，见 MINION_SUMMON_SFX 注） ----
    const summonSfx = MINION_SUMMON_SFX[this.projId];
    if (summonSfx) {
      for (const st of summonSfx) {
        if (st.at === this.age) game.playSfxFiles(soundTrackFiles(st.track), st.vol, this.cx, this.cy);
      }
    }
    // ★BJ518④：旧全局「alpha −15/t」斜坡退役——原版 alpha 减法只在 DoPalAppearEffect
    // 被调拍发生（调用位=三家族 AI 段,见 doPalAppearEffect 注;钻地龟挖掘态 1/2/3 无调
    // 用=淡入冻结,全局斜坡会把淡入匀速跑完=自造相）。火绒狐调用位在下方（AI_026 头
    // :59197/:59210 同拍序——声音 switch 后）;1093/1112 在 palGroundStep 头（:50493）;
    // 1098/1123 在 digtoiseStep flag|flag5|flag6 支（:39245）。
    // 帕鲁随从族抚摸 Joy 计时（AI 首段，:50053-50113/:59101-59131——先于各家族分支,
    // foxChannel 等早退支也照走）
    {
      const owner0 = this.ownerRef();
      if (owner0) this.palJoyTick(game, owner0);
      // 火绒狐帧态机（AI_026 flag8 帧段折算）——同 palJoyTick 先于各家族早退支
      if (owner0 && (this.projId === 1094 || this.projId === 1113)) this.foxAnimTick(owner0);
      // 火绒狐 soundDelay 递减（AI_026 头 :59119-59120 --soundDelay——出场段
      // -1 PalSummon/-20 PalFoxparks 两声已并入 MINION_SUMMON_SFX 表按 age 节拍）。
      // ★BJ523（2026-10-05）：攻击叫声称自本处退役迁出——旧形 foxChannel 电平挂门
      // =稳态喷火期每 ~300t 重触发（-21→-320 递减窗回卷）=自造相。原版播点在
      // TryUsingFoxsparksAbility 体内（Player.cs:43694）,调用面=:43064 起手门开拍
      // =「按下沿 ∪ 岩浆持住重臂环」（autoReuse 强制 releaseUseItem :53519 + fast-path
      // :53524;稳态喷火期 AI 续期 :60068 针 itemAnimation=2 → 门闭=静默）——
      // 消费位=Game 喷火通道 foxAttackSoundGate（门+重置同源,声源=玩家中心 base.Center）
      if (this.projId === 1094 || this.projId === 1113) {
        this.foxSoundCd--;                                   // --soundDelay（:59119）
      }
      // ★BJ518④：火绒狐 DoPalAppearEffect（AI_026 头 :59197/:59210——每拍同调,
      // withParticles = ai[0]!=1f（返程态静默淡入））。原版序=声音 switch（:59119-59133）
      // 之后,与 foxSoundCd 段相对位同相
      if (owner0 && (this.projId === 1094 || this.projId === 1113)) {
        this.doPalAppearEffect(game, owner0, this.a026A0 !== 1);
      }
    }
    if (this.projId === 653) { this.companionCubeStep(game); return; }
    if (this.sentry) {
      if (--this.life <= 0) { this.dead = true; return; }
      const owner = this.ownerRef();
      // ---- 1457 哨兵携带（accSentryBackpack 四件 6172 重携/6175 侦察/6176 圣殿
      //      骑士/6177 皇家卫队——ApplyEquipFunctional :14612-14685 全四件置旗）----
      //  拾起门 CanGetPickedUpBySentryBackpack（Projectile.cs:80532-80552）：sentry +
      //  owner 本地 + 玩家挂背包且抓取冷却 0（:80543）+ 哨兵盒与玩家盒相交（:80547）
      //  → ai[2]=1（:37811-37815，各哨兵 AI 同款插入）。抓取冷却被携带者每拍续约 2
      //  （SetAsSelectedSentryBackpackTarget :80554-80557）→ 同时至多携带一门
      if (!this.carriedByBackpack && owner
        && owner.equipStats.accSentryBackpack && owner.accSentryBackpackGrabCooldown <= 0
        && this.x < owner.x + owner.w && this.x + this.w > owner.x
        && this.y < owner.y + owner.h && this.y + this.h > owner.y) {
        this.carriedByBackpack = true;
      }
      if (this.carriedByBackpack) {
        if (!owner) { this.dead = true; return; }
        // SetAsSelectedSentryBackpackTarget（:80554-80557）：各哨兵 AI 携带支每拍
        // 续约抓取冷却 2 → 同时至多携带一门（先续约后重定位 = 原版块内序）
        owner.accSentryBackpackGrabCooldown = 2;
        this.vx = 0; this.vy = 0;                          // 携带支 velocity = Zero（:37820/:38006/:69355/:69622/:69952/:70400）
        // AI_Sentries_HeavySlingReposition（Projectile.cs:70096-70470）1:1 重定位——
        // 内含 !accSentryBackpack → Kill 头支（:70098-70102,携带中卸下背包=当场消亡）
        // 与 per-aiStyle/per-type 落位几何;原版携带支同时 tileCollide=false（:37821
        // /:69411/:69985/:70411）——本仓携带态不走 moveAndCollide 同语义
        this.heavySlingReposition(owner);
        if (this.dead) return;
        // 哨兵背在身上随玩家移动,各塔族开火段照常跑（原版拾起块后 AI 继续 :37824+）
      } else if (FLOATING_SENTRIES.has(this.projId)) {
        // 悬浮哨兵（R31 §C① P1）：AI_123 首行 velocity=Zero（:37726 区块,641/643）。
        // ★BJ516⑤：1025 移出本档——AI_197 非 Zero 悬浮（吸顶状态机见 1025 支）。
        // 放置点本体（落地扫描+定速下坠）由 pickSentryLandingSpot 导出函数承载,
        // Game 接线见落点清单。
        this.vx = 0; this.vy = 0;
      } else if (AURA_TOWER.has(this.projId) && this.auraSide > 0) {
        // ★BJ606-R（2026-10-10 用户实报「放置时乱浮空」定谳）：688-690 场盒化后
        //  =锚定冻结——vanilla 事实链：①AI_137 首拍场盒 Center=地面接触点（嵌入,
        //  Projectile.cs:70016）;②HandleMovement aiStyle 137 专支=Y-ONLY 且 X 恒
        //  不动（:17764-17776/:17845-17857 vector.X 零写位）;③TileCollision 四向
        //  分类【无嵌入支】（Collision.cs:2409-2455 嵌入盒=零校正零旗）→ 嵌入场盒
        //  恒不触发碰撞=钉在探测锚;④:18097 flag 位只吃真碰撞拍（嵌入盒恒不触,
        //  position+=velocity 不达）。旧走通用重力段（vy+=0.2+moveAndCollide+
        //  unembedPass 嵌入抬升）=行走体管线——坡/台阶地形触发 unembed/步面抬升
        //  （EntityManager 探针实录:坡面 1 拍 +160px 瞬移 1440→1280）=乱浮空根因。
        //  探测失败（auraSide=0,无地面支 :65948 position.Y+=16 早退）不入本支=照
        //  通用重力下坠（vanilla 次拍起 tileCollide=true 同相）。
        this.vx = 0; this.vy = 0;
      } else if (this.projId !== 1025) {
        // 落地（AI_130 尾部 :65420：tileCollide=true + velocity.Y += 0.2）
        // ★BJ516⑤：1025 恒不入通用哨兵重力段——AI_197 自有垂直面（吸顶升/衰减）,
        // 见 1025 支内 moveAndCollide
        this.vy = Math.min(this.vy + 0.2, MAX_FALL_SPEED);
        moveAndCollide(this, game.world, 0, this.vy);
      }
      // 随从/哨兵伤害：originalDamage（=烘定武器基伤,BJ651-R2 站⑤ Game 召唤出口
      //  roundCSf32Mul）× summonDamageMult live 刷新（每拍重算,换装即时生效,
      //  Projectile.cs:16809-16813 语义;1456 伪锚 :15368 勘正）——★BJ661 两步式
      //  truncCSf32MulBias（:16812 `(int)((float)originalDamage×minionDamage+5E-06f)`,
      //  含偏置;旧 f64 Math.round 中点/边界档差 1）+ 护甲穿透（对随从弹幕生效 :12068）
      const dmgOf = () => Math.max(1, truncCSf32MulBias(owner ? owner.summonDamageMult : 1, this.damage)); // ⑥ pen 移 hit 时
      // 爆炸烈焰塔族（AI_130，Projectile.cs:69163-69464 1:1;1456 伪锚 :65194-65450 勘正）：
      // 待机帧 0 → 锁定目标(900px 内)转向 → 开火动画帧 1-6 每 4t（第 12t 从炮口
      // Bottom+(dir*6,-46) 发火球 668）→ 24t 结束回待机并冷却 60t（num8）
      if (FLAMEBURST_TOWER.has(this.projId)) {
        const tier = FLAMEBURST_TIERS[this.projId] ?? FLAMEBURST_TIERS[667];
        // ★R15-F1：localAI[0] 300t 周期自由环（Projectile.cs:69183 `if (++localAI[0]
        //  >= 300f) localAI[0] = 0f;`——663/665/667 三档 case 内同式 :69235/:69287,
        //  无 ai[2]/开火门=每拍必走）——辉光脉动相位源（draw 侧 flameburstGlowRadius）
        this.sPulseT = (this.sPulseT + 1) % 300;
        // ★台账批 C-4179（2026-08-31）：AI_130 每 update 双矩形环境尘 1:1
        //  （1458 Projectile.cs case 663 :69181-69225 / 665 :69229-69272 / 667
        //  :69276-69320）——①底盆白烟 d270：盒 = (pos.X+w/4, bottom−16,
        //  w/4×{663:3|665/667:2}, 6)，朝右再左移 w/4；1/2 帧、fadeIn .6-.1.2、
        //  scale .4、vel 归零后 X 漂移 −dir×rand×fadeIn、noGravity/noLight；
        //  ②炮口火舌 d6：盒 = Center.X 起 ±w/4 宽（左向左伸）且 +dir×4 偏移、
        //  Y = bottom−(height−10)，{663|665|667}=各 1/2/3 层每层 1/5 帧、
        //  fadeIn1/scale1/vel×2。此前整段"未建模"登记消账（spawnDust/addLightAt
        //  现有基建直映）；★哨兵背包携带面复核（2026-09-03）：原版仅【底盆白烟】
        //  被携带态关（flag = ai[2]!=1,:69181 门在 for 上限 `(flag ? 1 : 0)`
        //  :69194/:69243/:69292）；炮口火舌（:69203-69212/:69252-69261/:69301-69310）
        //  与 Lighting.AddLight（:69178-69180 等）无 ai[2] 门——携带中照喷照亮
        if (game.spawnDust) {
          const fw = Math.floor(this.w / 4);
          const emberX = this.x + fw - (this.facing === 1 ? fw : 0);
          const emberW = this.projId === 663 ? fw * 3 : fw * 2;
          if (!this.carriedByBackpack && Math.floor(Math.random() * 2) === 0) {
            const dE = game.spawnDust(emberX - 2, this.y + this.h - 16 - 2,
              emberW + 4, 10, 270, -this.facing * 2, -2, 200, null, 0.4);
            if (dE) {
              const fade = 0.6 + Math.random() * 0.6;
              dE.fadeIn = fade;
              dE.vx = 0; dE.vy = 0;
              dE.vx = -this.facing * Math.random() * fade;
              dE.noGravity = true; dE.noLight = true;
            }
          }
          const muzLoops = this.projId === 663 ? 1 : this.projId === 665 ? 2 : 3;
          for (let li = 0; li < muzLoops; li++) {
            if (Math.floor(Math.random() * 5) !== 0) continue;
            const mx = this.cx + (this.facing === -1 ? -fw : 0) + this.facing * 4;
            const my = this.y + this.h - (this.h - 10);
            const dF = game.spawnDust(mx, my, fw, 10, 6, 0, 0, 0, null, 1);
            if (dF) {
              dF.fadeIn = 1;
              dF.noGravity = true; dF.noLight = true;
              dF.vx *= 2; dF.vy *= 2;
            }
          }
          // Lighting.AddLight(Center) ∪ (Bottom+(0,-10))，强度倍率按档
          // （×1 / ×1.2 / ×1.5,:69178-69180/:69226-69228/:69273-69275）
          const lm = this.projId === 663 ? 1 : this.projId === 665 ? 1.2 : 1.5;
          game.addLightAt?.(this.cx, this.cy, 0.4 * lm, 0.2 * lm, 0.1 * lm);
          game.addLightAt?.(this.cx, this.y + this.h - 10, 0.4 * lm, 0.2 * lm, 0.1 * lm);
        }
        // ★F2③ 携行态朝向回写（AI_130 携带支 :69348-69357,先于 ai[0]==1 待机臂）：
        //   ai[2]==1（哨兵背包携行）&& ai[0]==1 && ai[1]==0 ⇒ direction=spriteDirection
        //   =player.direction 每拍回写——随玩家转向同步塔身朝向（无目标拍亦回写,
        //   原版选向只在索敌命中拍覆写 :69382,携带支同拍在后,序保留）。与弩车
        //   134 同款（:69615-69623,已接）
        if (this.carriedByBackpack && this.sFire === 0 && this.sCool <= 0) {
          const carrier = owner ?? game.player;
          if (carrier) this.facing = carrier.facing < 0 ? -1 : 1;
        }
        // ★F4 索敌/射击端点换 shootingSpot（2026-08-30 实体侧对账批）：AI_130 的
        //   FindTarget 全部 Distance/CanHitLine 以 vector=Bottom+(direction*6,-Δ)
        //   为端点（1457 Projectile.cs :69182/:69234/:69286 三档锚；FindTarget 定义
        //   :69418 端点消费 :69426-69456）——此前错挂随从盒中心。134/123 族用本体
        //   Center 口径成立，唯 130 错。direction 基于本体 Center DirectionTo.X
        //   （:69382），与选向一致。
        const spot = () => ({ x: this.cx + this.facing * 6, y: this.y + this.h - tier.dy });
        // ★F6 批①②（2026-08-31）：学徒 T2 套装三层修饰——case 链之后乘（:69331-69335
        //   的执行序）：shot_range num 900×1.5、angleRatioMax 1→0.1、弹速 num4×1.4。
        //   角度比门 + canChangeDirection 门由 nearestEnemy(gate) 承载。
        const f130 = dd2SetFlags(game.player);
        const range130 = f130.apprenticeT2 ? 1350 : 900;    // (:69165/:69333)
        const ratio130 = f130.apprenticeT2 ? 0.1 : 1;       // (:69166/:69332)
        const spdMul130 = f130.apprenticeT2 ? 1.4 : 1;      // (:69334 num4*=1.4——含 case 链加成后)
        if (this.sFire === 0) {
          // 索敌门 = AI_130_FlameBurstTower_FindTarget（1457 Projectile.cs:69418-69462，
          // 1456 :65365 同体）：
          // 候选须 `Collision.CanHitLine(shootingSpot→NPC.Center)`（:69434/:69456）
          // 且 |vX| ≥ |vY|·angleRatioMax（:69434 角度锥,批②接入）。调用点 :69376
          // （待机选向 canChangeDirection=true → 无 directionLock）。
          const s = spot();
          const tgt = this.nearestEnemy(game, range130, 'line', 'self', range130, s,
            { angleRatioMax: ratio130 });
          if (tgt && this.sCool <= 0) {
            this.facing = tgt.cx >= this.cx ? 1 : -1; // direction = Sign(DirectionTo.X)（:69382）
            this.sFire = 1; this.sFireT = 0;
          }
          if (this.sCool > 0) this.sCool--;
        } else {
          if (this.sFireT === 12) {
            // 开火帧重索敌（:69391，canChangeDirection=false → directionLock=现朝向；
            // 正后方候选被 :69456 `direction*vX<0` 拒）——门不过 → 沿入态朝向直射
            // （原版 num11==-1 支 vector2=(direction,0)）
            const s = spot();
            const tgt = this.nearestEnemy(game, range130, 'line', 'self', range130, s,
              { angleRatioMax: ratio130, directionLock: this.facing });
            game.playSfxFiles(soundTrackFiles('dd2_flameburst_tower_shot'), 0.9, this.cx, this.cy); // AI_131 :69526（弹幕首帧）
            // 弹速三档 num4=12/15/18（:69171 基值、case 665 +=3 :69231 / case 667 +=6
            //   :69283；学徒 T2 ×1.4 在 case 链【之后】乘 :69334）
            let vx = this.facing * tier.speed * spdMul130, vy = 0;
            if (tgt) {
              const d = Math.hypot(tgt.cx - s.x, tgt.cy - s.y) || 1;   // 归一自 shootingSpot(:69408)
              vx = ((tgt.cx - s.x) / d) * tier.speed * spdMul130;
              vy = ((tgt.cy - s.y) / d) * tier.speed * spdMul130;
            }
            // 664/666/668 弹 16×16（SetDefaults :7155-7163）→ 炮口 − 8（曾 -5 偏 3px）
            // ★F5 随收：AI_131 弹全程无重力无加速度（:69519-69559 只管声·尘·旋转,
            //   SetDefaults 无 gravity 覆盖）→ velocity=num4 恒速直线；旧 {grav:0.2}
            //   抛物线系误植，改显式 grav 0
            (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
              Object.assign(new Arrow(s.x - 8, s.y - 8, vx, vy, dmgOf(), this.knockback, tier.shot, { grav: 0 }),
                { whipTagShot: true }),
              'projectiles');
          }
          if (++this.sFireT >= tier.cycle) { this.sFire = 0; this.sCool = tier.cool; } // cycle=num6*num7=24/32/32、cd num8=80/70/60（:69228/:69281 分层）
        }
        return;
      }
      // 弩车族（AI_134）：帧 0 待机 → 帧表 1-5（每 5t）→ 开火第 6t 出弩箭 680
      // （ai[1]==num2=num6=5,:69656——旧"第12t"系把 num2 初值 12 当终值读错,
      //   num2 已在 :65592/:69593 被 num2=num6 无条件覆写=5）→ 25t 结束 → 冷却
      if (BALLISTA_TOWER.has(this.projId)) {
        // ★F6 批②（2026-08-31）：瞄准/出弹基准点 center.Y−4 仅 677（:65599-6601/
        //   :69597-69599 字面怪癖,-Δ 不随方向镜像）;deadBottomAngle=0.75 锥形门
        //   (:69481/:69503)+侍从 T2 弩速 16→21（:69591-69593 num3）
        const setf134 = dd2SetFlags(game.player);
        const spotY134 = () => this.cy - (this.projId === 677 ? 4 : 0);
        const shotSpeed134 = setf134.squireT2 ? 21 : 16;    // num3（:69587/:69592）
        // ★F2③ 携行态朝向回写（:69615-69623 num8 支,先于 ai[0]==1 待机臂执行）：
        //   ai[2]==1（哨兵背包携行）&& ai[0]==1 && ai[1]==0 ⇒ direction=spriteDirection
        //   =player.direction 每拍回写——随玩家转向同步塔身朝向（回写优先级高于待机臂
        //   的旋转半平面派生与转火覆写；ai[1]==0 = 冷却恰好走完的拍）
        if (this.carriedByBackpack && this.sFire === 0 && this.sCool === 0) {
          const carrier = owner ?? game.player;
          if (carrier) this.facing = carrier.facing < 0 ? -1 : 1;
        }
        // 恐慌冷却钳（:69631-69640 空闲态每次递减前先钳 60/T3 双真 30）
        const panicClamp = (): void => {
          if (setf134.ballistaPanic && this.sCool > 60) this.sCool = 60;
          if (setf134.ballistaPanic && setf134.squireT3 && this.sCool > 30) this.sCool = 30;
        };
        // 1457 :69599-69609（1456 :65607-65617 ai[1]=0→shotDelay）:落位首帧即满档装填——
        // 放置后不再立即射第一箭,先等一整段（160/100/60/30）
        if (this.sInit === 0) {
          this.sInit = 1;
          this.sCool = ballistraShotDelayOf(game.player);
          // ★T9 ai[0]==0 落位拍（:69599-69608）：direction=spriteDirection=
          //   owner.direction；朝左时 rotation=π（本体贴图朝右-authored,背面朝向
          //   的旋转基线由此起）——rotation 为 draw 侧 dir 组合的输入,见 draw 弩车支
          //   ★F2①：direction=spriteDirection=owner.direction 的【朝向写回】此前缺席
          //   （只设了 rotation）——朝左放置后 facing 停留缺省 1,待机期 draw 的
          //   FlipV 半边不触发（R(π)·FlipV 应为水平镜像,缺 FlipV 时 rot=π 单独
          //   生效=上下颠倒）
          this.facing = ((owner ?? game.player)?.facing ?? 1) < 0 ? -1 : 1;
          this.rot = this.facing < 0 ? Math.PI : 0;
        }
        if (this.sFire === 0) {
          // 索敌门 = AI_134_Ballista_FindTarget（Projectile.cs:69465-69507）：
          // 候选须 `Collision.CanHitLine(center→NPC.Center)`（:69481/:69503）且不出
          // deadBottomAngle 死锥（|vX|<|vY|×0.75 且目标在下）。调用点 :69647。
          panicClamp();
          const s134y = spotY134();
          const tgt = this.nearestEnemy(game, 900, 'line', 'self', 900,
            { x: this.cx, y: s134y }, { deadBottomAngle: 0.75 });
          // ★T9 ai[0]==1 待机臂（:69647-69676）：有标 → rotation=AngleLerp(rot,
          //   aim,0.08)(:69651) 后 direction 取旋转半平面(:69652-69659;|rot|>π/2 ⇒ −1,
          //   等价 cosθ<0 ⟺ v.X<0)；无标 → 向归位角（direction==−1?π:0,:69669-69675）
          //   0.05 速率回摆。
          //   rotation 只作 draw 输入,facing 派生序照原文（lerp→半平面→转火覆写）
          if (tgt) {
            this.rot = angleLerp134(this.rot,
              Math.atan2(tgt.cy - s134y, tgt.cx - this.cx), 0.08);
            this.facing = this.rot > Math.PI / 2 || this.rot < -Math.PI / 2 ? -1 : 1;
          } else {
            this.rot = angleLerp134(this.rot, this.facing < 0 ? Math.PI : 0, 0.05);
          }
          if (tgt && this.sCool <= 0) {
            // ★T9 :69660-69666 转火拍 direction=Sign(v.X) 覆写（仅此瞬拍；非转火
            // 拍方向恒=旋转半平面派生,lerp 滞后照原文）
            this.facing = tgt.cx >= this.cx ? 1 : -1;
            this.sFire = 1; this.sFireT = 0;
          }
          if (this.sCool > 0) this.sCool--;
        } else {
          if (this.sFireT === 5) {
            // 开火帧重索敌（:69685，ai[1]==num2=5）同样带 CanHitLine/deadBottomAngle 门
            // ——门不过沿 direction 直射（num10==-1 支 vector=(direction,0),:69688）
            const tgt = this.nearestEnemy(game, 900, 'line', 'self', 900,
              { x: this.cx, y: spotY134() }, { deadBottomAngle: 0.75 });
            game.playSfxFiles(soundTrackFiles('dd2_ballista_tower_shot'), 0.9, this.cx, this.cy); // AI_134 :69656 SoundEngine.PlayTrackedSound（开火帧同弩箭）
            // 瞄准与出弹都从 center（含 677 的 Y−4;:69597 取心 → :69673 NewProjectile）。
            // 680 弩箭 16×16 → 左上 = center−8
            let vx = this.facing * shotSpeed134, vy = 0;
            if (tgt) {
              const sy134 = spotY134();
              const d = Math.hypot(tgt.cx - this.cx, tgt.cy - sy134) || 1;
              vx = ((tgt.cx - this.cx) / d) * shotSpeed134;
              vy = ((tgt.cy - sy134) / d) * shotSpeed134;
            }
            // ★T9 ai[0]==2 出弹拍（:69687-69698）：rotation=vector.ToRotation()(:69690)
            //   精确钉角（fallback vector=(direction,0) ⇒ 0/π），direction 再取旋转
            //   半平面(:69691-69698)——先于出弹（速度=同 vector×num3 :69699）
            this.rot = Math.atan2(vy, vx);
            this.facing = this.rot > Math.PI / 2 || this.rot < -Math.PI / 2 ? -1 : 1;
            (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
              // 680 弩箭：AI_001 默认档（0.1@15 缓坠）——重力缺省走规格链（2026-08-14 对账）
              // ★穿透终值：SetDefaults penetrate=4，NewProjectile 内联覆写
              //   `Type==680 && player.setSquireT2 → penetrate=7`（Projectile.cs:11083-11086）
              //   = 侍从 T2 套装「弩车可穿透」——发射点覆写审计批（2026-09-03）补
              Object.assign(new Arrow(this.cx - 8, spotY134() - 8, vx, vy, dmgOf(), this.knockback, 680,
                setf134.squireT2 ? { pierce: 7 } : undefined),
                { whipTagShot: true }),
              'projectiles');
          }
          if (++this.sFireT >= 25) { this.sFire = 0; this.sCool = ballistraShotDelayOf(game.player); } // num5*num6=25（:69686）
        }
        return;
      }
      // 闪电光环族（AI_137_LightningAura :65910-66060 1:1）：非射击场伤——
      // 落地后一次性测净空：脚下找地面（下搜 500 格）、头顶找天花板（上搜 num=10 格），
      // 边长 = 净空px 截断 [num5×16=64, num×16=160] 再 ×2（:65953-65978，width=height
      // 封顶 999）——即以塔为中心的方形光环场（64~320px），不再是固定 4 格盒。
      // 每 tick 接触判定（Colliding :14537-14553：方形盒相交 + 距中心 < height/2-20 +
      // AI_137_CanHit 视线），localNPCHitCooldown=3（:7055）→ 每 3t 一跳
      if (AURA_TOWER.has(this.projId)) {
        if (this.sInit === 0) {
          this.sInit = 1;
          const st = game.world.store;
          const tx = Math.floor(this.cx / TILE), ty = Math.floor(this.cy / TILE);
          let groundY = -1;
          for (let y = ty; y < Math.min(st.h, ty + 500); y++) { // Searches.Down(500)
            if (st.inBounds(tx, y) && st.isSolid(tx, y)) { groundY = y; break; }
          }
          if (groundY < 0) { this.y += 16; return; } // 无地面（:65948-65952）
          // ★R15-F4（2026-10-11 C15 清偿）：搜索档参数化——原版 num/num5 是 T3 联动
          //  变量（Projectile.cs:69937-69938 `if (setMonkT3) { num = 14; num5 = 8; }`）,
          //  同一 num 同时驱动三站:①Up(num) 天花板搜索窗（:69952,旧硬编码 10=T2 形）
          //  ②height 上钳 num×16（:69974）③fallback origin.Y−num−1（:69956,旧硬编码
          //  ty−11）。T3 露天档 14×16×2=448px（旧 384 偏差=BJ467⑤ 钉值错标,钉已重产）。
          const monkT3Field = dd2SetFlags(this.ownerRef()).monkT3;
          const fieldNum = monkT3Field ? 14 : 10;        // num（:69926/:69937）
          const fieldNum5 = monkT3Field ? 8 : 4;         // num5（:69929/:69938）
          let ceilY = -1;
          for (let y = groundY - 1; y >= groundY - fieldNum; y--) { // Searches.Up(num)
            if (y >= 0 && st.inBounds(tx, y) && st.isSolid(tx, y)) { ceilY = y; break; }
          }
          if (ceilY < 0) ceilY = ty - fieldNum - 1; // :69955-69957（无天花板 → origin-num-1）
          const centerY = groundY * TILE; // result.ToWorldCoordinates(8f, num6)（半砖 +8 未实装）
          const topY = ceilY * TILE;      // result2.ToWorldCoordinates(8f, 0f)
          let side = centerY - topY;      // :69970 base.Size = (1, center.Y - top.Y)
          // ★BJ467⑤ AI_137 T3 场盒档（Projectile.cs:69924-69938 亲读）：`int num = 10;
          //  int num5 = 4; … if (setMonkT3) { num = 14; num5 = 8; }`（:69937-69938）→
          //  场盒钳 [num5×16, num×16]（:69972-69977）——T3 档 [128,224]（×2 后
          //  [256,448]），非 T3 恒 [64,160]（旧档=只落 T1/T2 形）。T2 臂只改 num3
          //  zapPeriod（:69935 -5→25,zapCycle 档已接 :6035）不动盒。档位读落位拍
          //  =localAI[0]==0 单次支（:69979）——vanilla 盒只算一次,落位后换装不变盒;
          //  读 setMonkT3 经 dd2SetFlags 单源（同 monkAuraForcedCrit :151 装备门）。
          //  ★R15-F4：钳值亦参数化（旧三目字面量与搜索窗割裂=同一 num 两处手写）。
          side = Math.max(fieldNum5 * 16, Math.min(fieldNum * 16, side));
          side *= 2;                      // :65978 height *= 2（width=height，封顶 999）
          this.auraSide = Math.min(999, side);
          this.auraCy = centerY; // base.Center = center（:65980）
          // ★BJ606（2026-10-10 用户复报 F3 物证：碰撞盒 16×16 挂贴图左上+贴图陷地）
          //  盒本体化（:65970-65980 直译,1457 :70003-70016 同式）：原版首拍把出生盒
          //  改写为场盒——base.Size=(1,clearance)→钳→height*=2→width=height（封顶
          //  999）→base.Center=center（地面点）⇒ 盒=square 场盒以地面接触点为心。
          //  旧只记虚场（auraSide/auraCy）不写盒 ⇒ 盒钉出生点 16×16,F3 盒与绘制锚
          //  双失。盒化后非携行态 auraSide≡w≡h、auraCy≡cy（伤害消费面语义不变;
          //  携行态 Center=MountedCenter 每拍既有支 :70129 承接,vanilla 同）。
          this.w = this.auraSide; this.h = this.auraSide;        // width = height（:65979）
          this.x = tx * TILE + 8 - this.w / 2;                   // Center=(tx*16+8, centerY)
          this.y = centerY - this.h / 2;                         // （:65980 base.Center=center）
        }
        const side = this.auraSide;
        // ★哨兵背包携带面（2026-09-03）：原版场盒 = Size(height×height) 以 base.Center
        //   为心（Colliding :14537-14553 / 扫描 :69966-69971）——被携带时 Center 每拍被
        //   AI_Sentries_HeavySlingReposition aiStyle 137 支（:70127-70137）钉到
        //   MountedCenter → 场随玩家移动。落位拍锚 auraCy（localAI[0] 首拍支 :65980
        //   base.Center = center）,携带拍锚本体 Center（=玩家心）。
        const fieldCy = this.carriedByBackpack ? this.cy : this.auraCy;
        if (side > 0) {
          let zapped = false;         // 直伤拍标记（供 zap 声窗判定兜底,见批 C-3472 注）
          let fieldEnemy = false;     // ★台账批 C-3472：原版声扫描面（场内有敌即可,不看 LOS/冷却）
          for (const ent of game.enemies()) {
            if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
            const en = ent as EnemyLike & { dead: boolean } & import('./WhipTag').WhipTagged;
            if (en.dead) continue;
            const ax = this.cx - side / 2, ay = fieldCy - side / 2;
            // myRect.Intersects(targetRect)（方形场盒）——vanilla 扫描的
            // Colliding(Hitbox,nPC.Hitbox) 同面（:69966-69971）
            if (en.x + en.w <= ax || en.x >= ax + side || en.y + en.h <= ay || en.y >= ay + side) continue;
            // targetRect.Distance(Center) < height/2-20（:14540，敌 AABB 到中心最近点距）
            const nx = Math.max(en.x, Math.min(en.x + en.w, this.cx));
            const ny = Math.max(en.y, Math.min(en.y + en.h, fieldCy));
            if (Math.hypot(this.cx - nx, fieldCy - ny) >= side / 2 - 20) continue;
            fieldEnemy = true;
            // AI_137_CanHit 视线门（Projectile.cs:71574-71614，2026-08-30 补弧线三试
            // +目标双点:15890/:15894 敌盒中心/敌盒上沿中任一通过即命中；目标格实心直接 false）。
            // ★起点基点核对（Entity.cs:86-96）：base.Top=(X+width/2, position.Y)=场盒顶沿中点，
            //   +UnitY×20 → 起点 = (Center.X, cy − 场盒半高 + 20)；本仓场盒高=auraSide、
            //   场盒竖中心=fieldCy → 起点为 (cx, fieldCy − side/2 + 20)。旧实现锚在
            //   (cx, auraCy−20) 无 side 归属——小盒(64~160)差 ≤60px 档位级偏移，已对齐。
            if (!lightningAuraCanHitFrom(game.world.store, this.cx, fieldCy - side / 2 + 20, en.cx, en.cy)
              && !lightningAuraCanHitFrom(game.world.store, this.cx, fieldCy - side / 2 + 20, en.x + en.w / 2, en.y)) {
              continue;
            }
            // ★BJ467⑥ :12686 头门前置（同拳盒臂——dontTakeDamage 靶不达 TimerCrit/
            //  武僧掷/tag ModifyHit/golem 掷,不白吃 hitCd 私表;688-690 aiStyle 137 非
            //  接触反噬族 → dontTakeDamage 水母亦无 zap 口,整跳=原版净语义）
            if ((en as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
            if (MinionProj.enemyImmune(en)) continue;   // ★BJ452 N5 :12636 三族共门（光环场伤=Damage() 管线 aiStyle137 :12468 → Inner 同门——窗拒拍不白吃私表 cd,contact() :4809 同构补）
            if (!this.hitCd.ready(en.id, 3)) continue; // localNPCHitCooldown=3（:7055）
            zapped = true;
            // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit :12947 前）
            //  ——光环塔 688/689/690 = 武僧强制暴击唯一可达弹面：
            //  ① TimerCrit :12928——6170 蓄能暴击对一切玩家弹无条件消费;
            //  ② 武僧 T2/T3 强制掷 :12929-12943——(uint)(type-688)<=2u ∧ setMonkT3 →
            //     Next(4)==0 / else setMonkT2 → Next(6)==0（monkAuraForcedCrit 单源）。
            const timerCritAura = tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);
            const monkCritAura = monkAuraForcedCrit(this.ownerRef(), this.projId);
            // 命中 armorPenetrationPercent 门（Projectile.cs:13266-13269）：
            //   `if ((type == 688||689||690) && targetNPC.type != 68 && targetNPC.defense < 999)`
            //   ⇒ 仅当受害者非 68（地牢守卫族）且防御 <999 才置 100% 护穿——高防/守卫豁免。
            //   ★三轮 η 红队：旧实现无条件传 penPercent=1（且锚写死 :12443 属死锚）
            //   ⇒ 防≥999 受害者的退款池计算随 penAdd 整体变形。tag 伤 ×0.5
            //   （ProjectileID.cs:31 SummonTagDamageMultiplier）
            const vAura = en as unknown as { vanillaId?: number | null; def?: { defense?: number } };
            const penPctAura = lightningAuraPenPercent(vAura.vanillaId, vAura.def?.defense);
            const res = resolveWhipTagHit(en, dmgOf(), game,
              (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
              SUMMON_TAG_MUL[this.projId] ?? 1, en.cx, en.cy, this.ownerRef());
            // 哨兵射击=单发弹语义;penPercent 门=:13266-69;fromPlayer=DPS 计。
            // ★6176 圣殿骑士背包（:12962-12965,2026-09-03 收口）：光环场伤=塔本体
            //   （sentry）直伤面 → 10% 强制暴击（此前仅接触面掷,场伤面漏掷）
            const golemCritAura = rollGolemSentryCrit(game, this.projId, true);
            // ★BJ452 N2 crit 色位（res.crit‖golemCritAura——Enemy.hurt 纯染色;
            //  旧恒 golemCritAura=仅 tag crit 时色缺,contact() :4864 同式先例）
            //  ★BJ453 并链：‖ timerCritAura ‖ monkCritAura——原版 crit=单布尔单翻倍,
            //  新源强制时补一次 ×2（res.crit 的 ×2 已嵌 res.dmg 不重倍;旧 res.crit∧
            //  golemCrit 同拍 ×4 并发归位 ×2=BJ452 N1a 城镇臂同判）。
            const critAura = res.crit || timerCritAura || monkCritAura || golemCritAura;
            // ★BJ455⑤ 受理前置快照（contact() :4852 mainGated 同式）——ghostHeal 门判据
            const auraGated = en.dead
              || (en as { dontTakeDamage?: boolean }).dontTakeDamage === true;
            // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970,owner luck）——光环场伤面
            const dmgVAura = damageVarRoll(res.dmg, this.ownerRef()?.luck ?? 0);
            en.hurt(applyBannerDamageDealt(game, en, critAura && !res.crit ? dmgVAura * 2 : dmgVAura),
              0, 0, game, 0, critAura, 1, true, penPctAura);
            // ★Z1/D1② ghostHeal 白耗/治疗面（:13877-84 通用 on-hit 段,光环场伤载体=
            //  塔本体 688/689/690 的 Damage()——numHits 累计在塔身 pveNumHits 上）
            //  ★BJ455⑤ 门径统一（:13712 flag10|=num41>0 在 StrikeNPC 后无死亡复查——
            //  击杀拍照回血;旧 post-hurt !en.dead 门=击杀拍断供,爆弹臂/拳盒臂同刀统一）
            if (!auraGated) {
              ghostHealProc(game, this.projId, this.pveNumHits,
                en as unknown as Parameters<typeof ghostHealProc>[3]);
              this.pveNumHits++;   // :14263
            }
            applyProjStatus(this.projId, en as unknown as Record<string, number>, { catalystBand: this.ownerRef()?.equipStats.catalystBand }); // StatusNPC(:10555)+6185 催化指环 398
          }
          // ★清偿刀 Y2：城镇臂（aura 场伤走 Damage() 管线 —CanDealDamage :12468
          //  `(aiStyle==137 && ai[0]!=0f)` 唯一闸 → Damage_PVE_Inner 城镇同链;
          //  场盒 Colliding :14537-14553 对城镇靶同面）。门序同敌怪环：场盒 AABB
          //  （hitTownNpcs 缺省几何）→ skip=距离+LOS+cd3 → 巫毒窄门（通道内）。
          //  penPercent :13266-69——城镇防御=VANILLA_NPCS 基值+进度加算（TownNPC.hurt
          //  :1475-1476 同式）结构 <999 且城镇族无 68 → 门恒放行（基值 15 代入谓词）。
          {
            let auraDirect: number[] | null = null;
            hitTownNpcs({ x: this.cx - side / 2, y: fieldCy - side / 2, w: side, h: side },
              game, dmgOf(), 0, 'playerProj', this.projId, undefined, undefined,
              (n) => {
                const tn = n as TownNpcHitTarget;
                if (!townVoodooGateOpen(game, n.vanillaId, this.projId)) return true;
                // ★BJ455⑦ :12636 三族共门（contactTown :4958 同式——窗拒拍整跳,先于
                //  距离/LOS/cd3 探测=私表保持 0,窗清立即可命中;读 hurt 前状态=快照纪律）
                if (MinionProj.enemyImmune(n)) return true;
                // targetRect.Distance(Center) < height/2-20（:14540,城镇 AABB 最近点距）
                const nx = Math.max(tn.x, Math.min(tn.x + tn.w, this.cx));
                const ny = Math.max(tn.y, Math.min(tn.y + tn.h, fieldCy));
                if (Math.hypot(this.cx - nx, fieldCy - ny) >= side / 2 - 20) return true;
                // AI_137_CanHit 视线门（同敌怪环 :5333-5335 双点任一）
                if (!lightningAuraCanHitFrom(game.world.store, this.cx, fieldCy - side / 2 + 20, tn.cx, tn.cy)
                  && !lightningAuraCanHitFrom(game.world.store, this.cx, fieldCy - side / 2 + 20, tn.x + tn.w / 2, tn.y)) return true;
                return !this.hitCd.ready(tn.id, 3);   // localNPCHitCooldown=3（:7055）
              },
              (n) => {
                // ★Z1/D1② 城镇臂 ghostHeal 白耗/治疗面（:13877-84 城镇靶同面,光环）
                const preHitsAura = this.pveNumHits;
                this.pveNumHits++;
                ghostHealProc(game, this.projId, preHitsAura,
                  n as unknown as Parameters<typeof ghostHealProc>[3]);
                this.townAcceptLadder(game, n, true);   // cd=3 私表族=usesLocal 主支清窗
                const tn = n as TownNpcHitTarget;
                if (auraDirect) {
                  for (const d of auraDirect) {   // OnHit :13711 位——★W5:916 链电
                    darkHarvestChain(game, d, tn.cx, tn.cy, tn.id);   // 链靶=CanBeChasedBy 敌,城镇 NPC 本体永免（:18）
                  }
                  auraDirect = null;
                }
              },
              (n) => {
                const tn = n as TownNpcHitTarget;
                const direct: number[] = [];
                tn.hurtFx = (d: number) => { direct.push(d); };
                // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit 前;
                //  原版 crit 段敌/城共享——城镇靶同消费）：TimerCrit :12928 + 武僧
                //  688-690 强制掷 :12929-12943（光环塔=唯一可达弹面）。
                const timerCritAuraT = tryConsumeTimerCritOf(this.ownerRef(), game, tn.x, tn.y, tn.w, tn.h);
                const monkCritAuraT = monkAuraForcedCrit(this.ownerRef(), this.projId);
                const res = resolveWhipTagHit(tn, dmgOf(), game,
                  (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
                  SUMMON_TAG_MUL[this.projId] ?? 1, tn.cx, tn.cy, this.ownerRef());
                auraDirect = direct;
                const golemCritAura = rollGolemSentryCrit(game, this.projId, true);   // 6176（:12962-12965）
                zapped = true;
                // ★BJ452 N1 倍序归位（×4→×2）+ 色位：res.dmg 已含 tag-crit 预倍 ×2
                //  （resolveWhipTagHit 尾 WhipTag.ts:848 `if (crit) dmg *= 2`）——旧形
                //  dmg=res.dmg + crit=golemCritAura,golem 掷中∧tag crit 同拍时 TownNPC.hurt
                //  防后再倍 = ×4;仅 tag crit 时 crit 参缺=色缺。BJ445② 同构（contactTown
                //  :4996-4999）：crit=res.crit‖golemCritAura 传参（TownNPC.hurt 防后×2+色
                //  一体,NPC.cs:82066）;dmg 仅在 res.crit 时摘半还原防前值——golem 预倍本
                //  就不经 dmg 承载,勿随 golemCritAura 摘（摘之则 golem-only 档腰斩）。
                //  ★BJ453 并链：‖ timerCritAuraT ‖ monkCritAuraT——crit 参单布尔承载
                //  防后单次 ×2,dmg 摘半面只系 res.crit 不动（新源不落 dmg）。
                const critAuraTown = res.crit || timerCritAuraT || monkCritAuraT || golemCritAura;
                return {
                  dmg: res.crit ? res.dmg / 2 : res.dmg,
                  crit: critAuraTown,
                  penPercent: lightningAuraPenPercent(tn.vanillaId, 15),
                  kb: 0,                    // 光环场伤零击退（同敌怪环 :5355 kx=ky=0）
                };
              });
          }
          // ★BJ606-R（2026-10-10 用户实报「攻击也不对」定谳补）：AI_137 放电视觉尘
          //  （★清偿 C4=R5-F5 注释重锚 2026-10-14:70030-70052 1:1;1456 :65945 区块
          //  同式）——①场缘电弧（每拍 4 试×1/6 掷）：
          //  随机单位向 |x|<0.12 跳过 → 目标点 = 场心 + 单位向×((H-40)/2)（=伤害域缘
          //  side/2-20 同径,:70040）→ 目标格非实心 ∧ AI_137_CanHit 通过 → 尘 226
          //  钉点（perfect=NewDustDirect 定点语义）,速度 = (塔锚-尘位).SafeNormalize
          //  （塔锚 vector2=(盒顶心X, 盒顶+40) :70029）,scale 0.7/fadeIn 1/
          //  noGravity/noLight。②塔柱火花（非携行 4 试×1/10 掷,活支=l 循环
          //  :70074-70085）：盒 (盒顶心X-8, 盒顶+40, 16, H/2-40) 内尘 226,速度
          //  ×0.6+(0,-2),scale 0.7。`:70053 for(k=0;k<0)` = 原版零迭代死循环
          //  （必死支不可达判谳,不移植;旧锚 :70047-70056/:70051 均错——:70047-70052
          //  是 j 循环尾,k 循环头在 :70053）。此前攻击面
          //  仅伤害+声（C-3472）无任何视觉=「放电无电弧」观感缺失。
          if (game.spawnDust) {
            const anchorX = this.cx, anchorY = this.y + 40;   // vector2（盒顶心, 盒顶+40）
            const arcR = (side - 40) / 2;                     // (height-num4)/2（:70040）
            for (let j = 0; j < 4; j++) {
              if (Math.random() >= 1 / 6) continue;           // Next(6)!=0 → skip（1/6 通过）
              const ang = Math.random() * Math.PI * 2;
              const ux = Math.cos(ang), uy = Math.sin(ang);
              if (Math.abs(ux) < 0.12) continue;              // :70042
              const tx2 = this.cx + ux * arcR;                // :70040 目标点（场缘同径）
              const ty2 = fieldCy + uy * arcR;
              const txc = Math.floor(tx2 / 16), tyc = Math.floor(ty2 / 16);
              if (game.world.store.isSolid(txc, tyc)) continue;   // :70040 SolidTile 门
              if (!lightningAuraCanHitFrom(game.world.store, this.cx, fieldCy - side / 2 + 20, tx2, ty2)) continue;
              // ★BJ669d（2026-10-13 用户实报「只有中间电弧没有外围」定谳）：首两参
              //  须传场缘点（原版 NewDustDirect(targetPosition,…) :70041——裁剪盒=
              //  (Position,10,10) 恒定,BJ466 裁剪在 spawn 头、后钉 d.x 无效）——旧
              //  传 (0,0)=世界原点恒屏外 → j 循环零产出（探针 3s 71 尘全中轴、外围 0）
              //  =「只有中间电弧没有外围半圆」根因。0 尺寸盒不构成豁免（BJ480 钉案）。
              const d = game.spawnDust(tx2, ty2, 0, 0, 226, 0, 0, 100, null, 0.7, true, true);
              if (d) {
                d.x = tx2; d.y = ty2;
                const vl = Math.hypot(anchorX - tx2, anchorY - ty2) || 1;
                d.vx = (anchorX - tx2) / vl; d.vy = (anchorY - ty2) / vl;   // SafeNormalize(Zero)
                d.fadeIn = 1; d.scale = 0.7;
                d.noGravity = true; d.noLight = true;
              }
            }
            if (!this.carriedByBackpack) {
              for (let l = 0; l < 4; l++) {
                if (Math.random() >= 1 / 10) continue;        // Next(10)==0 → 1/10 通过
                const d2 = game.spawnDust(this.cx - 8, this.y + 40, 16,
                  Math.max(1, Math.floor(this.auraSide / 2 - 40)), 226, 0, 0, 100, null, 0.7, true);
                if (d2) {
                  d2.vx = d2.vx * 0.6; d2.vy = d2.vy * 0.6 - 2;   // :70052-70053 ×0.6 + (0,-2)
                  d2.scale = 0.7;
                  d2.noGravity = true; d2.noLight = true;
                }
              }
            }
          }
          // ★台账批 C-3472（2026-08-31）：电弧声密度对齐原版 ai[0] 循环（AI_137
          //  :69955-69979：ai[0]++ %num3==0 时扫场，场内有敌才 PlayTrackedSound——
          //  num3=30/僧侣T2 -5→25、T3 不改字面）。旧"每直伤 tick 一声"密度 ×30。
          //  真值节拍：zapCycle==period-1 且本轮扫描见敌 → 一声。原版 PlayTrackedSound
          //  每次新开 ActiveSound 实例（旧实例未停=尾音自然重叠），本仓一次性 wav 同构
          //  ——「跨 tick 续播缓冲」仅指实例存活期内 Volume/Position 跟踪（Sfx.ts 音轨
          //  注记）；塔体静止时与 playSfxFiles 无可测差，startTrackedLoop 是 loop=true
          //  通道语义不同【不接】（终零波 M5 复核,C 类维持）。
          this.zapCycle++;
          const zapPeriod = dd2SetFlags(game.player).monkT2 ? 25 : 30;
          if (this.zapCycle >= zapPeriod) {
            this.zapCycle = 0;
            if (fieldEnemy || zapped) {
              game.playSfxFiles(soundTrackFiles('dd2_lightning_aura_zap'), 0.5, this.cx, fieldCy);   // PlayTrackedSound(base.Center)（:69968）——携带态随玩家
            }
          }
        }
        return;
      }
      // 爆炸机关族（AI_138）：每 3t 探测中心上方 48px 的 144×144 盒——有敌即
      // 原地爆炸 AoE（proj 694 等价）+ 粒子 + 冷却 90（GetExplosiveTrapCooldown）。
      // ★哨兵背包携带面（2026-09-03）：AI_138 携带支（:70397-70405）num3=20、
      //   num2=48−14=34 → 探测盒 = CenteredRectangle(Center+(0,-num2), num2*3)
      //   （:70407）后 Inflate(num3,num3)（:70411）→ 半宽 num2*3/2+num3：常规 48*3/2
      //   =72、携带 34*3/2+20=71（盒心 Y 也从 −48 抬到 −34）。探测循环带
      //   nPC.CanBeChasedBy(this) 门（:70430,NPC.cs:91141 索敌面,红队 F12 补）——
      //   不可瞄准目标（小动物 lifeMax≤5 / dontTakeDamage / CHASE_EXCLUDED_VIDS
      //   如训练假人 488）不触发爆炸机关（复用 projTargets.canBeChasedBy）
      if (TRAP_TOWER.has(this.projId)) {
        if (--this.sCool <= 0) {
          this.sCool = 3;
          const trapNum2 = this.carriedByBackpack ? 48 - 14 : 48;   // :70395 num2=48、携带支 num2 -= 14（:70402）
          const trapNum3 = this.carriedByBackpack ? 20 : 0;         // :70394 num3=0、携带支 num3 = 20（:70401）
          const ecx = this.cx, ecy = this.cy - trapNum2;
          const trapHalf = trapNum2 * 3 / 2 + trapNum3;
          const hit = (game.enemies() as EnemyLike[]).some((en) =>
            canBeChasedBy(en) && Math.abs(en.cx - ecx) < trapHalf + en.w / 2
            && Math.abs(en.cy - ecy) < trapHalf + en.h / 2);
          if (hit) {
            this.sCool = 90;
            game.playSfxFiles(soundTrackFiles('dd2_explosive_trap_explode'), 0.9); // AI_138 :66104（无位置参数）
            // 原版塔体 691/692/693 生成【爆炸弹】694/695/696（AI_138 :66063-66073）,
            // StatusNPC 走爆炸弹型号——Oiled 门在 694 族(:10786,setHuntressT2 套装门)
            // ★R15-F6 登记债（2026-10-11 C15）——★BJ650件4（2026-10-12）清偿：
            //  694-696 视觉面落地 = 爆炸弹实体（ExplosiveTrapBlastProj,AI_139 帧机
            //  alpha −25/拍渐显 + 3t/帧爆花 + :70488 PlotTileLine 光带(1.3,0.9,0.2)
            //  + Main.cs:32522-32546 Bottom 锚双笔本体绘）。生成位 = AI_138 :70440
            //  NewProjectile(base.Center+(0,−num2), Zero, num, ...)——ecx/ecy 即
            //  塔心+(0,−num2)（探测盒心同源）。伤害面仍由本直伤臂承载（BJ630 判例,
            //  弹体零伤害=离散链同相勿双伤）。访客侧不广播（塔臂 owner 权威既有
            //  口径,MP 爆花缺面登记）。
            const boomProj = 694 + (this.projId - 691);
            // ★BJ650件4：爆炸弹视觉实体生成（:70440;盒心=ecx/ecy,144×144 SetDefaults）
            (game as unknown as { entities: { add: (x: unknown, b: string) => void } })
              .entities.add(new ExplosiveTrapBlastProj(ecx, ecy, boomProj as 694 | 695 | 696), 'projectiles');
            const ownerH = (this.ownerRef() as unknown as { equipStats?: { huntressT2?: boolean } } | null)
              ?.equipStats?.huntressT2 ?? false;
            let boom = 0;
            for (const ent of game.enemies()) {
              if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
              const en = ent as EnemyLike & { dead: boolean };
              if (en.dead) continue;
              if (Math.abs(en.cx - ecx) < 72 + en.w / 2 && Math.abs(en.cy - ecy) < 72 + en.h / 2) {
                // ★BJ467⑥ :12686 头门前置（同拳盒臂——dontTakeDamage 靶不达 TimerCrit/
                //  tag ModifyHit/golem 掷;694-696 aiStyle 139 非接触反噬族 → 水母亦无
                //  zap 口,整跳=原版净语义）
                if ((en as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
                // ★BJ452 N3① :12636 三族共门（immune[owner]>0 整跳,先于 crit 掷/tag 消费
                //  ——窗拒拍=写梯/tag 全不达,掷序纪律=拒拍不耗 RNG;BJ445③ 城镇臂 :5994 同式）
                if (MinionProj.enemyImmune(en)) continue;
                // ★BJ452 N3② tag 面：694/695/696 ∈ SentryShot（ProjectileID.cs:293）→
                //  WhipTagEffect.CanRunHitEffects（:76-87）达 → Damage 管线 ModifyHit+OnHit
                //  照跑=完整 WhipTagEffect 栈（tag 加伤/TagCrit/proc 全生效）→ 挂单源
                //  resolveWhipTagHit;916 直伤汇出收集,受理后落地（W5 :13711 位次纪律）。
                const boomDirect: number[] = [];
                (en as never as import('./WhipTag').WhipTagged).hurtFx = (d: number) => { boomDirect.push(d); };
                // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit 前;
                //  伤害载体=爆炸弹 694/695/696 本体——timerCrit 消费 owner 态不变,
                //  武僧 688-690 掷以载体 projId 判定=恒假,形位保留）
                const timerCritBoom = tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);
                const monkCritBoom = monkAuraForcedCrit(this.ownerRef(), boomProj);
                const resBoom = resolveWhipTagHit(en as never as import('./WhipTag').WhipTagged,
                  dmgOf(), game,
                  (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
                  SUMMON_TAG_MUL[boomProj] ?? 1, en.cx, en.cy, this.ownerRef(), 0, boomProj);
                const boomGated = en.dead
                  || (en as { dontTakeDamage?: boolean }).dontTakeDamage === true;   // 受理预判（contact :4849 同式）
                // 单发弹语义;fromPlayer=DPS 计。★6176（:12962-12965,2026-09-03 收口）：
                //   原版伤害面=爆炸弹 694/695/696 本体（SentryShot）→ 10% 强制暴击
                const golemCritBoom = rollGolemSentryCrit(game, boomProj, false);
                // ★BJ453 并链：crit 源 ‖ timerCritBoom（:12928）‖ monkCritBoom（:12929-12943）,
                //  新源强制时补一次 ×2（res.crit 的 ×2 已嵌 res.dmg;res.crit∧golem 同拍
                //  ×4 并发归位 ×2=BJ452 N1a 城镇臂同判）
                const critBoom = resBoom.crit || timerCritBoom || monkCritBoom || golemCritBoom;
                // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970,owner luck）——爆弹 694-696 面
                const dmgVBoom = damageVarRoll(resBoom.dmg, this.ownerRef()?.luck ?? 0);
                en.hurt(applyBannerDamageDealt(game, en, critBoom && !resBoom.crit ? dmgVBoom * 2 : dmgVBoom),
                  Math.sign(en.cx - this.cx) * this.knockback, -2, game, 0, critBoom, 1, true);   // ★N2 同式 crit 色位（res.crit‖golem）
                // ★Z1/D1② ghostHeal 白耗/治疗面（:13877-84 通用 on-hit 段）——伤害载体=
                //  爆炸弹 694/695/696（AI_138 :66063-66073 生成的瞬态弹）→ projId 传
                //  boomProj、numHits=0（原版每颗爆炸弹 numHits 独立起算,非塔身累计）
                //  ★BJ455⑤ 门径统一（定谳:原版 :13712 `flag10 |= num41>0` 位次在
                //  StrikeNPC :13702 后、【无】死亡复查,BJ405 'proc/numHits++ 在受理面
                //  无死亡复查' → 击杀拍照回血;contact() mainGated=受理前置快照对,旧
                //  post-hurt !en.dead 门=击杀拍断供。818/拳盒/光环臂同刀统一）
                if (!boomGated) {
                  ghostHealProc(game, boomProj, 0,
                    en as unknown as Parameters<typeof ghostHealProc>[3]);
                }
                applyProjStatus(this.projId, en as unknown as Record<string, number>, { catalystBand: this.ownerRef()?.equipStats.catalystBand }); // StatusNPC(:10555)+6185 催化指环 398
                // 爆炸弹 694 族同属玩家弹——催化指环 6185 亦生效（StatusNPC :11192-11196）
                applyProjStatus(boomProj, en as unknown as Record<string, number>, { setHuntressT2: ownerH,
                  catalystBand: this.ownerRef()?.equipStats.catalystBand });
                // ★BJ452 N3② W5 :13711 位落地（主命中受理后）——916 链电伤落其他敌（源敌永免 :18）
                if (boomDirect.length > 0 && !boomGated) {
                  for (const d of boomDirect) {
                    darkHarvestChain(game, d, en.cx, en.cy, en.id);
                  }
                }
                boom++;
              }
            }
            // ★清偿刀 Y2：城镇臂——塔体 691/692/693 生成爆炸弹 694/695/696
            //  （AI_138 :66063-66073），其 Damage() 管线对城镇靶同链（CanDealDamage
            //  :12468 aiStyle==138 只闸塔体本体）。AoE 半径含靶半宽（非纯 AABB）
            //  → 几何外置 skip、collide 恒真（与敌怪环 :5448 同式）。
            //  ★BJ452 N3② tag 面（城镇靶同链:SentryShot → :12947 ModifyHit/:13711 OnHit
            //  照跑）——settle 挂单源 resolveWhipTagHit,916 汇出在受理拍（写梯后）落地。
            let boomTownDirect: number[] | null = null;
            hitTownNpcs({ x: ecx, y: ecy, w: 0, h: 0 }, game, dmgOf(), 0, 'playerProj', boomProj,
              () => true, undefined,
              (n) => {
                const tn = n as TownNpcHitTarget;
                if (!townVoodooGateOpen(game, n.vanillaId, this.projId)) return true;
                // ★BJ445③ :12636 三族共门（immune[owner]==0,flag3 不豁免——694 族
                //  maxPenetrate=-1）先于几何,窗内靶整跳（敌怪环 :4806 同式）
                if ((n as { iframes?: number }).iframes !== undefined
                  && (n as { iframes?: number }).iframes! > 0) return true;
                return !(Math.abs(tn.cx - ecx) < 72 + tn.w / 2 && Math.abs(tn.cy - ecy) < 72 + tn.h / 2);
              },
              (n) => {
                const tn = n as TownNpcHitTarget;
                // ★Z1/D1② 城镇臂 ghostHeal 白耗/治疗面（:13877-84 城镇靶同面;载体=
                //  爆炸弹 694 族瞬态弹,numHits=0 同敌怪环）
                ghostHealProc(game, boomProj, 0,
                  n as unknown as Parameters<typeof ghostHealProc>[3]);
                // ★BJ445③ 写梯归档（:14175-14179）：694/695/696 = usesLocalNPCImmunity
                //  +localNPCHitCooldown=30（Projectile.cs:7356-7367 SetDefaults 亲读）
                //  → 受理拍写 immune[owner]=0【清窗不开窗】——TownNPC.hurt 通用档写的
                //  10t 须清还原（旧「通用档 iframes=10 保留」系 :14182 档误档,Y2 报告③）。
                //  ladder 内含 StatusNPC 塔型源（:5454-5457 同敌怪环）;爆炸弹 694 族
                //  Oiled 门（:10786 setHuntressT2）单独保留。
                this.townAcceptLadder(game, n, contactResolve(boomProj) !== CONTACT_PLAYER_WINDOW);
                applyProjStatus(boomProj, tn as unknown as Record<string, number>,
                  { setHuntressT2: ownerH, catalystBand: this.ownerRef()?.equipStats.catalystBand });
                // ★BJ452 N3② W5 :13711 位落地（写梯后）——916 链电自城镇靶位寻
                //  CanBeChasedBy 敌,城镇 NPC 本体永免（_DarkHarvest.cs:18）
                if (boomTownDirect) {
                  for (const d of boomTownDirect) {
                    darkHarvestChain(game, d, tn.cx, tn.cy, tn.id);
                  }
                  boomTownDirect = null;
                }
              },
              (n) => {
                const tn = n as TownNpcHitTarget;
                const direct: number[] = [];
                tn.hurtFx = (d: number) => { direct.push(d); };
                // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit 前;
                //  原版 crit 段敌/城共享）：TimerCrit :12928 + 武僧 688-690 掷 :12929-12943
                //  （载体=694/695/696 恒假,形位保留）
                const timerCritBoomT = tryConsumeTimerCritOf(this.ownerRef(), game, tn.x, tn.y, tn.w, tn.h);
                const monkCritBoomT = monkAuraForcedCrit(this.ownerRef(), boomProj);
                const res = resolveWhipTagHit(tn, dmgOf(), game,
                  (el) => (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles'),
                  SUMMON_TAG_MUL[boomProj] ?? 1, tn.cx, tn.cy, this.ownerRef(), 0, boomProj);
                boomTownDirect = direct;
                const golemCritBoom = rollGolemSentryCrit(game, boomProj, false);   // 6176（:12962-12965,爆炸弹面）
                // ★BJ452 N3② BJ445② 同构 settle（crit 参=防后×2+色一体;dmg 仅 res.crit
                //  摘半——tag-crit 预倍在 res.dmg,golem 预倍不经 dmg 承载勿摘）
                //  ★BJ453 并链：crit 源 ‖ timerCritBoomT（:12928）‖ monkCritBoomT
                //  （:12929-12943）——crit 参单布尔防后单次 ×2,dmg 面不动。
                return {
                  dmg: res.crit ? res.dmg / 2 : res.dmg,
                  crit: res.crit || timerCritBoomT || monkCritBoomT || golemCritBoom,
                  kb: Math.sign(tn.cx - this.cx) * this.knockback,
                };
              });
            void boom;
            game.spawnParticles(ecx, ecy, '#FFB040', 18, 4, { life: 36 });
            game.playSfx('explosion', 1, this.cx, this.cy);
          }
        }
        return;
      }
      // aiStyle 53 定点哨兵三族（Projectile.cs:27172-27382 1:1）：
      // 初冷 ai[0]=120 → 锁定目标转向（瞄准扇区 num424 :27258-27279）→
      // ai[0]≤0 开火（射速 60/60/90，弹速 9/9/12.5，:27282-27311）→ ai[0] 每 tick 递减
      const s53 = SENTRY53[this.projId];
      if (s53) {
        if (this.sInit === 0) {
          this.sInit = 1; this.sCool = 120;   // localAI[0]==0 → ai[0]=120（:27176-27181）
          // ---- 出生尘爆 + Item46 音（R31 §C②/A⑥ P1,AI_053 首帧 Projectile.cs:37951-37990）：
          // 全体 PlaySound(Item46);308 冰霜九头蛇=80×d185(Y+16 盒,v×2,noGravity,scale×1.15);
          // 377 蜘蛛皇后=40×d171(scale=Next(1,10)×0.1,fadeIn1.5,v×0.75,alpha100);
          // 966 猎犬=30×d219(Center±(25,30) 盒,v×2,noGravity,scale×0.5)。
          // ★BJ517⑧：birth 帧面补（AI_053_FrostHydra :37942-37990）——377 frame=4
          //  （:37963,仰射姿,无目标期间奇帧回落不含 4=恒驻）/966 ai[1]=-1+frame=0
          //  （:37976-37977）/308 frame=0（原版无 birth 帧写=SetDefaults 0）;全体
          //  localAI[1]=1（:37948——308 帧 +1 bonus 的 L1 门,burn 后归零 :38082）。
          //  此前哨兵"啪一下静默出现"。
          game.playSfxFiles(soundTrackFiles('Item_46'), 1, this.cx, this.cy);
          this.s53L1 = 1;                                    // :37948
          this.s53Frame = this.projId === 377 ? 4 : 0;       // :37963/:37977/:308 缺省 0
          if (this.projId === 308) {
            for (let i = 0; i < 80; i++) {
              const d = game.spawnDust?.(this.x, this.y + 16, this.w, this.h - 16, 185, 0, 0, 0);
              if (d) { d.vx *= 2; d.vy *= 2; d.noGravity = true; d.scale *= 1.15; }
            }
          } else if (this.projId === 377) {
            for (let j = 0; j < 40; j++) {
              const d = game.spawnDust?.(this.x, this.y + 16, this.w, this.h - 16, 171, 0, 0, 100);
              if (d) {
                d.scale = (1 + Math.floor(Math.random() * 9)) * 0.1;   // Next(1,10)*0.1
                d.noGravity = true; d.fadeIn = 1.5; d.vx *= 0.75; d.vy *= 0.75;
              }
            }
          } else if (this.projId === 966) {
            for (let k = 0; k < 30; k++) {
              const d = game.spawnDust?.(this.cx - 25, this.cy - 30, 50, 60, 219, 0, 0, 0);
              if (d) { d.vx *= 2; d.vy *= 2; d.noGravity = true; d.scale *= 0.5; }
            }
          }
        }
        // ★F2③ 携行态朝向回写（AI_053 携带支 :37996-38002）：ai[2]==1 && ai[0]<=0
        //   （射击冷却走完）⇒ direction=spriteDirection=player.direction——随玩家转向
        //   同步（原版选向只在索敌命中段 frameCounter 过门时按目标方位覆写 :38052-38062,
        //   携带回写每拍在前）。★BJ517⑧：ai[0]==0 帧清零支（:38005-38007）接线
        if (this.carriedByBackpack && this.sCool <= 0) {
          const carrier = owner ?? game.player;
          if (carrier) this.facing = carrier.facing < 0 ? -1 : 1;
          if (this.s53Frame >= 0) this.s53Frame = 0;       // :38005-38007
        }
        // ★BJ515 债③：AI_053_HandleSentryNPCTargeting 1:1（:38030 调用点——
        //  firingOffset 966=(0,-16)/余 (0,0) :38024-38028,straightLine=false,
        //  maxDistance 缺省 1000）——旧 nearestEnemy 欧氏+无视面退役
        const tgt = this.sentryFindTarget(game, 0, this.projId === 966 ? -16 : 0, false, 1000);
        let sector = 2;
        if (tgt) {
          const dx = tgt.cx - this.cx, dy = tgt.cy - this.cy;
          if (dx < 0) this.facing = -1; else this.facing = 1; // :27264-27268
          // 瞄准扇区（:27269）：dy>0→0；|dy|>|dx|×3→4；×2→3；|dx|≤|dy|×3→（|dx|>|dy|×2→1，否则 2）；否则 0
          sector = dy > 0 ? 0
            : Math.abs(dy) > Math.abs(dx) * 3 ? 4
              : Math.abs(dy) > Math.abs(dx) * 2 ? 3
                : Math.abs(dx) > Math.abs(dy) * 3 ? 0
                  : Math.abs(dx) > Math.abs(dy) * 2 ? 1 : 2;
        }
        // ★BJ517⑧：扇区帧机（AI_053_FrostHydra :38053-38078——type!=966 消费；
        // 966 无帧写=frame 恒 0 :37977）。sd 面 :38055-38061 由 facing 承载
        // （PrevSd 记拍供「转向也重置 fc」判 :38071-38076）
        if (tgt) {
          if (this.s53Fc > 0) this.s53Fc--;
          if (this.s53Fc <= 0 && this.projId !== 966) {
            const sdNew = tgt.cx < this.cx ? -1 : 1;
            const n12 = this.s53Frame;
            if (this.projId === 308) this.s53Frame = sector * 2;        // :38063-38064
            else if (this.projId === 377) this.s53Frame = sector;       // :38065-38066
            if (this.sCool > 40 && this.s53L1 === 0 && this.projId === 308) this.s53Frame++;   // :38067-38069
            if (n12 !== this.s53Frame || this.s53PrevSd !== sdNew) {
              this.s53Fc = this.sCool <= 0 ? 4 : 8;                     // :38071-38076
            }
            this.s53PrevSd = sdNew;
          }
        } else if (this.projId !== 966 && this.sCool <= 60
          && (this.s53Frame === 1 || this.s53Frame === 3 || this.s53Frame === 5
            || this.s53Frame === 7 || this.s53Frame === 9)) {
          this.s53Frame--;                                              // :38098-38103 奇帧回落
        }
        if (tgt && this.sCool <= 0) {
          this.sCool = s53.cd; // :27282-27288（num427=60，966→90）
          this.s53L1 = 0;      // ★BJ517⑧：localAI[1]=0（:38082——308 帧 +1 bonus 门开）
          // 炮口偏移（:27290-27347）：966 flag24 分支 zero 保持 (0,0)=本体中心；
          // 308/377 按扇区，朝左再 +10X（!flag24 && spriteDirection<0 :27351-27354）
          let ox = 0, oy = 0;
          if (this.projId !== 966) {
            switch (sector) {
              case 0: ox = 24 * this.facing; oy = 12; break;
              case 1: ox = 24 * this.facing; oy = 0; break;
              case 2: ox = 24 * this.facing; oy = -2; break;
              case 3: ox = 14 * this.facing; oy = -6; break;
              default: ox = 2 * this.facing; oy = -14; break;
            }
            if (this.facing < 0) ox += 10;
          }
          const mx = this.cx + ox, my = this.cy + oy;
          const d = Math.hypot(tgt.cx - mx, tgt.cy - my) || 1;
          const shotSfx = MINION_SHOT_SFX[s53.shot];
          if (shotSfx) game.playSfxFiles(soundTrackFiles(shotSfx.track), shotSfx.vol, this.cx, this.cy);
          // 出弹锚点 = 炮口 − 弹型判定盒/2（:27357 vector34=Center+zero；
          // 309/967 = 14×14、378 = 16×16——曾写死 -5 偏 2-3px）
          const sp53 = projectileData(s53.shot);
          const s53hw = (sp53?.width ?? 10) / 2, s53hh = (sp53?.height ?? 10) / 2;
          const s53life = sp53?.timeLeft ?? 1200;
          (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
            Object.assign(new Arrow(mx - s53hw, my - s53hh, ((tgt.cx - mx) / d) * s53.speed, ((tgt.cy - my) / d) * s53.speed,
              dmgOf(), this.knockback, s53.shot, { grav: 0, life: s53life }), { whipTagShot: true }), // SentryShot 吃鞭 tag（ProjectileID.cs:199）
            'projectiles');
        }
        if (this.sCool > 0) this.sCool--; // :27377-27380（目标有无均递减）
        return;
      }
      // ★2026-09-01 AI_197_CeilingAndHoverTurret 出弹站（Projectile.cs:41041-41179）：
      // 藤壶哨站 1025（物品 5463）——此前仅 FLOATING_SENTRIES 悬浮档,零开火（producer
      // 锚缺登记消账面）。①localAI[1]==0 首拍：frame=3 + 40×d2 出生尘爆
      // （Center±(10,10)、α100、v×2、noGravity,:41045-41056）;②num3=15 顶格深扫
      // flag2;③localAI[0]++ 至 num4=50——无目标钳 50（目标出现当拍即发）,有目标归零
      // 并 NewProjectile 1026（muzzle=Center+(0,10),哨兵背包携带态 (0,0)
      // :41060-41064、vel=(敌心−muzzle).SafeNormalize×num7=12、伤=damage、kb=本体;
      // 索敌 AI_053_HandleSentryNPCTargeting maxDistance=num8=1000+num3×16=1240
      // （flag=1025 档 :41150-41154,无视线门）。弹 1026 全链（AI_28 衰减/拖尾/
      // 出膛编排/命中毒/Kill 音尘）在 Arrow.ts 1026 支。
      // ★BJ516⑤（2026-10-05,沿袭旧登记清偿）：ai[0] 落位状态机 1:1（AI_197
      // :41033-41145 + HandleTileCollision :40972-41031/:18752-18757）——
      // · flag2 = Top 起向下 15 格探实心（:41101-41120,num3=15——脚下 15 格内
      //   有立足面才升空）;
      // · flag3 = SolidCollision(position+velocity+(0,−2))（:41038-41039,顶面贴附判据）;
      // · ai[0]==1 ∧ !flag3 → ai[0]=0（:41100-41105 脱附）;
      // · 帧档（:41121-41130）：ai[0]==1 → frame 随机 0-2（出域重掷=吸顶后黏着）
      //   /else frame=3（悬浮）;
      // · 垂直面（:41131-41145）：flag2 ? (ai[0]==1 ? velocity=Zero : vy−=0.1 钳 −12)
      //   : (velocity×0.9,<0.01 归零——无立足面=原地悬停衰减);
      // · 碰撞 → ai[0]=1（:18752-18757 aiStyle 197 支——升空顶到天花板吸附;
      //   HandleTileCollision 音/尘/gore 面=Item167+30×d2 本位承接;★BJ517⑥ gore
      //   级联 9 件已折算,见 1025 支内注）;
      // · 开火全态照常（:41146+ 无 ai[0] 门,吸顶/悬浮均射击）。
      if (this.projId === 1025) {
        if (this.sInit === 0) {
          this.sInit = 1;
          for (let i = 0; i < 40; i++) {
            const d = game.spawnDust?.(this.cx - 10, this.cy - 10, 20, 20, 2, 0, 0, 100);
            if (d) { d.vx *= 2; d.vy *= 2; d.noGravity = true; }
          }
        }
        // ★F2③ 携行态朝向/旋转回写（AI_197 携带支 :41068-41097,先于顶格深扫）：
        //   ai[2]==1 ⇒ spriteDirection=direction=player.direction（:41076）+ rotation
        //   =±π/2（:41082-41084;重定位 flag3 支 :70187/:70205 同值再加 fullRotation=0）
        //   ——藤壶哨站被背包携带时横置在玩家侧身。scale/缩体支（:41085-41090）
        //   本仓未建模（玩家盒 ≥42 缩体支不可达,登记）
        if (this.carriedByBackpack) {
          const carrier = owner ?? game.player;
          if (carrier) {
            this.facing = carrier.facing < 0 ? -1 : 1;        // :41076
            this.rot = this.facing === 1 ? Math.PI / 2 : -Math.PI / 2;   // :41082-41083
          }
        } else {
          // ★BJ516⑤：ai[0] 落位状态机（非携带态;携带态 tileCollide=false 无落位面）
          const stA = game.world.store;
          // flag2：Top 起向下 15 格探实心（:41101-41114）。★BJ517⑦（2026-10-05）探针
          //  档核定：①谓词销案——vanilla SolidOrSlopedTile(tile)（WorldGen.cs:70515-
          //  70533）= active ∧ tileSolid ∧ !tileSolidTop ∧ !inActive ≡ 本仓 isSolid 全等
          //  （SOLID_LUT=defs.solid≡tileSolid∧!tileSolidTop;flags≠0≡active;WIRE_ACTUATED
          //  ≡inActive 门）——「斜坡档」本相=不排坡面（排坡的是 SolidTile/isSolidStrict,
          //  两谓词异名非异值）,平台排除同相;tile==null 臂=仓内 store 全载不可达。
          //  ②实差修正——探针 X 锚 = base.Top（:41103 盒心列）,旧 this.x（盒左）列
          //  对 42px 盒最右偏 2 格;③InWorld(2) 出界 break（:41104,原形照抄——旧
          //  continue 对 flag2 布尔同值,抄原形消歧）
          let flag2A = false;
          const tx0 = Math.floor(this.cx / 16), ty0 = Math.floor(this.y / 16);
          for (let j = 0; j < 15; j++) {
            if (tx0 < 2 || tx0 >= stA.w - 2 || ty0 + j < 2 || ty0 + j >= stA.h - 2) break;   // :41104 InWorld(x,y,2)
            if (stA.isSolid(tx0, ty0 + j)) { flag2A = true; break; }   // :41109 tile==null∨SolidOrSloped
          }
          // flag3：盒于 position+velocity+(0,−2) 处的实心重叠（:41038-41039）
          let flag3A = false;
          {
            const bx0 = Math.floor((this.x + this.vx) / 16), bx1 = Math.floor((this.x + this.vx + this.w - 0.001) / 16);
            const by0 = Math.floor((this.y + this.vy - 2) / 16), by1 = Math.floor((this.y + this.vy - 2 + this.h - 0.001) / 16);
            for (let ty = by0; ty <= by1 && !flag3A; ty++) {
              for (let tx = bx0; tx <= bx1; tx++) {
                if (stA.inBounds(tx, ty) && stA.isSolid(tx, ty)) { flag3A = true; break; }
              }
            }
          }
          if (this.sAttach === 1 && !flag3A) this.sAttach = 0;          // :41100-41105 脱附
          // 帧档（:41121-41130）：吸顶随机 0-2 黏着（出域才重掷）/悬浮 3
          if (this.sAttach === 1) {
            if (this.sFrame < 0 || this.sFrame >= 3) this.sFrame = Math.floor(Math.random() * 3);
          } else {
            this.sFrame = 0;                                            // draw 支 sAttach==0 → frame 3
          }
          // 垂直面（:41131-41145）
          if (flag2A) {
            if (this.sAttach === 1) { this.vx = 0; this.vy = 0; }
            else { this.vy = Math.max(this.vy - 0.1, -12); }            // 升空（钳 −12）
          } else {
            this.vx *= 0.9; this.vy *= 0.9;                             // :41146-41152 衰减
            if (Math.hypot(this.vx, this.vy) < 0.01) { this.vx = 0; this.vy = 0; }
          }
          // 位移+吸附（tileCollide=true 缺省 :9710-9716 无 tileCollide 行;
          // 碰撞即 HandleTileCollision=ai[0]=1 :18752-18757 + Item167 音/尘/gore）
          // ★BJ672：弹面 flag6=TRUE 缺省（1025 aiStyle 197 非覆写面）→ 恒穿平台
          //  不吸平台（吸附面只对实体物块成立=原版相;旧缺省承接=水晶可吸在平台上）。
          this.dropThrough = true;
          moveAndCollide(this, game.world, this.vx, this.vy);
          if ((this.collideY || this.hitWall) && this.sAttach === 0) {
            this.sAttach = 1;
            game.playSfxFiles?.(soundTrackFiles('Item_167'), 1, this.cx, this.cy);
            for (let i = 0; i < 30; i++) {
              const d = game.spawnDust?.(this.x, this.y - 22, this.w, 28, 2, this.vx, this.vy, 50);
              if (d) {
                d.fadeIn = 0.5;
                if (i % 3 === 0) d.scale *= 0.75; else d.noGravity = true;
                d.vx = (Math.random() * 2 - 1) * 5; d.vy = (Math.random() * 2 - 1) * 5 - 2;
              }
            }
            // ★BJ517⑥（2026-10-05）：gore 级联补（AI_197_HandleTileCollision
            //  :40999-41030）——基锚 = Top−(0,62)（盒心列,Y=盒顶−62）;三列
            //  j=0/1/2 = 1143/1137/1128 系（X −20/0/+20,Y +6 除中列）,每列 2 件
            //  系 id+Next(3)（第一件零偏移、第二件 (-4+Next(5), -4+Next(5)) 偏移）
            //  +1 件 1146（同偏移再 +10Y）=共 9 件;vel=circular(2,2) 后 vy−=NextFloat,
            //  系件 ×2、1146 ×0.5。NewGorePerfect → perfect=true（无内建扰掷）
            const goX = this.cx, goY = this.y - 62;            // :41000
            for (let j = 0; j < 3; j++) {
              const gid = j === 0 ? 1143 : j === 1 ? 1137 : 1128;
              const px5 = goX + (j === 0 ? -20 : j === 2 ? 20 : 0);   // vector3/vector4 :41001-41002
              const py5 = goY + (j === 1 ? 0 : 6);
              for (let n = 0; n < 2; n++) {
                const c56 = nextVector2Circular(Math.random, 2, 2);
                const ox56 = n === 0 ? 0 : -4 + Math.floor(Math.random() * 5);   // :41024
                const oy56 = n === 0 ? 0 : -4 + Math.floor(Math.random() * 5);
                const g56 = GorePiece.newGore(gid + Math.floor(Math.random() * 3),
                  px5 + ox56, py5 + oy56, c56.x, c56.y, 1, true);
                if (g56) {
                  g56.vy -= Math.random();                     // :41022/:41025 NextFloat
                  g56.vx *= 2; g56.vy *= 2;                    // :41023/:41026
                }
              }
              const c57 = nextVector2Circular(Math.random, 2, 2);
              const g57 = GorePiece.newGore(1146,
                px5 - 4 + Math.floor(Math.random() * 5),
                py5 - 4 + Math.floor(Math.random() * 5) + 10,   // :41027 +10Y
                c57.x, c57.y, 1, true);
              if (g57) {
                g57.vy -= Math.random();
                g57.vx *= 0.5; g57.vy *= 0.5;                  // :41029
              }
            }
          }
        }
        this.sCool = Math.min(this.sCool + 1, 50);            // localAI[0]++（:41156-41158）
        if (this.sCool >= 50) {
          // ★BJ515 债③：借道 AI_053_HandleSentryNPCTargeting（:41175——muzzle=
          //  (0,10)/携行 (0,0) :41164-41168,num8=1000+num3×16=1240 :41150-41154,
          //  straightLine=false）——旧 nearestEnemy 欧氏+无视面+900 集火窗退役
          const tgt = this.sentryFindTarget(game, 0, this.carriedByBackpack ? 0 : 10, false, 1240);
          if (!tgt) return;
          this.sCool = 0;                                     // localAI[0]=0（:41164）
          const oy = this.carriedByBackpack ? 0 : 10;         // vector3.Y（:41060-41064）
          const mx = this.cx, my = this.cy + oy;
          const d = Math.hypot(tgt.cx - mx, tgt.cy - my) || 1;
          const sp26 = projectileData(1026);
          const hw26 = (sp26?.width ?? 14) / 2, hh26 = (sp26?.height ?? 14) / 2;
          const life26 = sp26?.timeLeft ?? 3600;
          (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
            Object.assign(new Arrow(mx - hw26, my - hh26, ((tgt.cx - mx) / d) * 12, ((tgt.cy - my) / d) * 12,
              dmgOf(), this.knockback, 1026, { grav: 0, life: life26, extraUpdates: 2 }),
              { whipTagShot: true }),                         // SENTRY_SHOT_SET 吃鞭 tag
            'projectiles');
        }
        return;
      }
      // 其他哨兵（aiStyle 123：月门/彩虹水晶）
      const ss = SENTRY_SHOOT[this.projId];
      if (ss) {
        // 索敌门 = AI_123_FloatingTurrets（Projectile.cs:37840/:37854）：最近敌选择
        // 内联 `Collision.CanHitLine(base.Center→NPC.Center)`（浮动炮台不隔墙开火）；
        // 集火目标 OwnerMinionAttackTargetNPC 同门（:37840——本仓 focus 支 sight='line'
        // 同过 CanHitLine 门）;★BJ514：集火门距 = num=1000（:37731,:37839 num4=num,
        // 曾吃缺省 900）
        const tgt = this.nearestEnemy(game, 1000, 'line', 'self', 1000);
        if (tgt) this.facing = tgt.cx >= this.cx ? 1 : -1;
        if (tgt && this.sCool <= 0) {
          this.sCool = ss.cd;
          // 炮口（641 月门 = 本体 Center :33993；643 彩虹水晶走 volley 落点分支）
          const mx = this.cx;
          const my = this.cy;
          if (ss.volley) {
            // ★BJ639 批 1②（2026-10-11）：643 volley = 真 644 爆裂弹 ×3（AI_123
            //  :37918-37932 1:1 落点公式——j=0 = NPC 盒内随机点+宿速×30 前导;
            //  j>0 = RotatedByRandom(π/4)×(NextFloat×num11+0.5),num11 =
            //  Lerp(0.1,0.75,GetLerpValue(800,200,距心))。旧「落点即时 AoE」退役=
            //  弹实体本体补建（14×14 t=0 → 60×60 t=30+60t 演出面,见类注）。
            //  色相 = 出生拍 Disco（:37922 rgbToHsl(Disco).X——同 volley 三发同相）。
            const hue644 = discoHueAt(discoTickNow());
            const tgtE = tgt as unknown as { x: number; y: number; w: number; h: number; vx: number; vy: number };
            const dmg644 = dmgOf();
            const faces: RainbowBurstFaces = {
              hitAt: (g2: GameHooks, bx: number, by: number) =>
                this.rainbowBurstHitFace(g2, bx, by, dmg644),
            };
            for (let j = 0; j < ss.volley; j++) {
              const vx4 = tgtE.x + Math.random() * tgtE.w - this.cx;   // vector4=盒内随机点−心
              const vy4 = tgtE.y + Math.random() * tgtE.h - this.cy;
              let ox = vx4 + (tgtE.vx ?? 0) * 30;                       // vector5=宿速×30 前导
              let oy = vy4 + (tgtE.vy ?? 0) * 30;
              if (j > 0) {
                const dist = Math.hypot(ox, oy);
                const num11 = 0.1 + (0.75 - 0.1) * Math.max(0, Math.min(1, (dist - 800) / (200 - 800)));
                const ra = (Math.random() - Math.random()) * (Math.PI / 4);  // RotatedByRandom(π/4)
                const ca2 = Math.cos(ra), sa2 = Math.sin(ra);
                const sc = Math.random() * num11 + 0.5;                 // NextFloat×num11+0.5
                const rxx = (vx4 * ca2 - vy4 * sa2) * sc;
                const ryy = (vx4 * sa2 + vy4 * ca2) * sc;
                ox = rxx; oy = ryy;
              }
              const px = this.cx + ox, py = this.cy + oy;
              (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
                new RainbowCrystalBurst(px, py, hue644, this, faces), 'projectiles');
            }
          } else {
            // ★BJ639 批 1①（2026-10-11）：641 → 642 月门连续激光（aiStyle 84 642 支
            //  全式,见 MoonGateBeam 类注）。旧「速度 9 直飞 Arrow」退役=BJ635 批 2
            //  候选定谳真缺（原版=随门心 50t 扫摆 ±30° 束,LaserScan/线碰撞/切割/光照）。
            //  出生参数：ai[0]=目标角+direction×π/6（:37910-37914）、direction=
            //  DirectionTo(target).X 符号、Center=本体心（:33993）。
            const dirX0 = tgt.cx - this.cx, dirY0 = tgt.cy - this.cy;
            const dl0 = Math.hypot(dirX0, dirY0) || 1;
            const aimAng = Math.atan2(dirY0 / dl0, dirX0 / dl0);
            const gdir: 1 | -1 = dirX0 > 0 ? 1 : -1;                    // num10=sign(vector3.X)
            (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
              new MoonGateBeam(this.cx, this.cy, aimAng + gdir * (Math.PI / 6), gdir,
                dmgOf(), this.knockback, this, this.ownerRef()), 'projectiles');
          }
        }
        if (this.sCool > 0) this.sCool--;
        return;
      }
      // 其余哨兵兜底（当前武器表内无使用者——aiStyle 53/123/130/134/137/138 全覆盖；
      //  数值沿用 aiStyle 53 默认：初冷 120、射速 60，:27176-27181/:27286）
      const tgt = this.nearestEnemy(game, 600);
      if (tgt) {
        if (this.sInit === 0) { this.sInit = 1; this.shootCd = 120; }
        this.shootCd--;
        if (this.shootCd <= 0) {
          this.shootCd = 60;
          const ang = Math.atan2(tgt.cy - this.cy, tgt.cx - this.cx);
          (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(
            Object.assign(new Arrow(this.cx - 5, this.cy - 5, Math.cos(ang) * 6, Math.sin(ang) * 6, dmgOf(), this.knockback, this.projId), { whipTagShot: true }),
            'projectiles');
        }
      }
      return;
    }
    // 随从
    const p = this.ownerRef();
    if (!p) { this.dead = true; return; }
    // ---- 1457 帕鲁钻地龟 1098/1123（5667/6174，AI_204_Digtoise 折算）----
    if (this.projId === 1098 || this.projId === 1123) { this.digtoiseStep(game, p); return; }
    // 索敌射程分档（1457 AI_062 :66319-66333）：num12 缺省 400 → 无条件覆盖 2000
    // （=射手族档，423/613 的 300 覆盖同为死赋值）、963=700（:66330-66333）；
    // 致命球 533 走 AI_066 档 num526=2000（:30105-30111,备案项⑥——曾走通用 700 档）；
    // 其余 AI 族检索半径 = MINION_SHOOT[].search 键（★台账批⑭ 补表:俾格米 800 等,
    // 原版门 AI_026 主周曼哈顿 700+100）;缺键 shooter 型 1000 / 无弹型 700 兜底。
    // 射手族/963/533 加视线门（:66392/:66435/:30334 CanHitLine）。
    // 距门测点（备案项⑤）：407/613/423 分支以玩家中心为基准（:66361-66402
    // `Vector2 center = Main.player[owner].Center`;1456 :62416/:62433 同段），
    // 373/375（:66431 base.Center）与 533（:30333 base.Center）以随从为基准
    const ai62 = AI62_SHOOTERS.has(this.projId);
    // ★BJ515 债⑤：AI_026 通用尾族（191-194/266/1094/1113）改走 ai026TailTarget
    //  双轨面（曼哈顿+CanHit 本体盒+集火种子+flag10 ×20 前导）——旧 nearestEnemy
    //  欧氏+900 集火窗+search 帽对本族退役（ai026TailTarget 注）。
    //  1094/1113 喷火态（foxChannel）同吃尾面 tgt=null 面（:6941 支不消费 tgt,无扰）。
    const ai026Tail = AI_026_TAIL_IDS.has(this.projId)
      ? this.ai026TailTarget(game, AI_026_LEAD_IDS.has(this.projId))
      : null;
    const tgt = ai026Tail
      ? ai026Tail.tgt
      : ai62
      ? this.nearestEnemy(game, 2000, 'line', AI62_PLAYER_TARGETING.has(this.projId) ? 'player' : 'self',
        6000)   // 集火门距 = num12×3 = 6000（:66327 num12=2000 + :66374 ×3;蓝队 R7-21）
      : this.projId === 533 || this.projId === 387 || this.projId === 388
        // ★BJ514：aiStyle 66 三型（533 致命球/387/388 双子 :30089-30103）——
        //  集火门距 num526×3=6000（:30316 num539,:30105-30111 num526=2000;387/388
        //  曾落通用 1000 档=range/视线/集火三重偏差,与 533 同刀归真）
        ? this.nearestEnemy(game, 2000, 'line', 'self', 6000)
        : this.nearestEnemy(game, MINION_SHOOT[this.projId]?.search
          ?? (MINION_SHOOT[this.projId] ? 1000 : 700));
    // 基础伤害（每 tick 按当前装备 live 重算 = Projectile.cs:16809-16813
    //  `(int)((float)originalDamage × player.minionDamage + 5E-06f)`;1456 伪锚
    //  :15368 勘正;★BJ661 两步式=truncCSf32MulBias（含偏置）,+armorPen）
    const dmg0 = Math.max(1, truncCSf32MulBias(p.summonDamageMult, this.damage)); // ⑥ pen 移 hit 时
    // ---- 旗舰家族分发（源码行号见各方法注释；先于通用运动）----
    // ★BJ709-G30⑦（2026-10-24,G27 登记债⑦清偿）：AI_121 龙族环境微尘
    //  （Projectile.cs:43638-43648,flag 块=625-628 全族每拍掷,先于头/段支）——
    //  Main.rand.Next(30)==0 → Dust.NewDust(position,width,height,135,0,0,α=0,
    //  scale=2) + noGravity + fadeIn=2（VDust 生长目标语义 :2148-2171）;尘出生格
    //  实心（InWorld fluff5 ∧ SolidTile,solidTileAt=SolidTile 1:1 判定式）→ noLight
    //  （墙内尘不发光）。尘盒=AI 入口盒=上一拍 resize/位移前值（与 vanilla 同拍序,
    //  625 首拍=构造 24×24）。与 G27④ 淡入尘（α=100）同 type 135 双源并存。
    if (this.projId >= 625 && this.projId <= 628 && Math.floor(Math.random() * 30) === 0) {
      const dA = game.spawnDust?.(this.x, this.y, this.w, this.h, 135, 0, 0, 0, null, 2, true);
      if (dA) {
        dA.fadeIn = 2;                                    // :43642 fadeIn=2f
        const stA = game.world.store;
        const txA = Math.floor(dA.x / TILE), tyA = Math.floor(dA.y / TILE);   // ToTileCoordinates
        if (txA >= 5 && txA < stA.w - 5 && tyA >= 5 && tyA < stA.h - 5
          && solidTileAt(stA, txA, tyA)) dA.noLight = true;                   // :43644-43646
      }
    }
    if (this.projId >= 626 && this.projId <= 628) { this.dragonSegment(game, p, dmg0); return; }
    if (this.projId === 625) { this.dragonHead(game, p, dmg0); return; }
    if (this.projId === 831 || this.projId === 970) { this.counterHover(game, p, dmg0); return; }
    // ★BJ687（2026-10-16 用户实报「血红法杖蝙蝠效果不对,移植版=当前效果」定谳）：
    //  早退分发族的 TrailingMode 记录面普查——原版 UpdateTrails（:17197 块=AI 后
    //  每 update 无条件跑一次）在本仓由 fixedUpdate 尾 :9914 recordGhostTrail 承载,
    //  但早退族永远到不了那里,须各自体内补记录。mode≥0 全集核查（★BJ704 复核勘正）：
    //  533/388（twinsStep :4894/deadlySpherePhase :6616）✓、864（smolstarAI 三处
    //  :4510/:4544/:4584）✓、946（★非 ghostRing 族——terraprisma 专享 tHist 环+
    //  EmpressBladeDrawer 拖尾,:4441 每拍压栈承载）✓——唯 755 血蝙蝠与 833-835
    //  沙漠虎【零 record 调用】→ ghostRing
    //  恒 undefined → drawProjGhosts 的 at(i) 恒 null → 绯红残影链（Main.cs:31188
    //  AI_156_GetColor=Crimson / 833 族速度染 :31307-31314）整链从不渲染=用户截图
    //  130（原版横长绯红带,簇 90-130px）vs 本仓探针 _bj687 弧中程 crimsonPx=42
    //  （19×59,仅本体红晕）的主差面。探针/反编译双证;修=分发位 AI 后补一次
    //  recordGhostTrail（=原版 UpdateTrails 位序,AI 末态入环）。
    if (this.projId >= 833 && this.projId <= 835) { this.tigerBody(game, p, dmg0); this.recordGhostTrail(); return; }
    // ★BJ634：刃杖 864 = AI_169_Smolstars（:46559-46700 1:1,smolstarAI 注）——
    // 此前落通用飞行路径（追击恒速 5/索敌 700 每拍重选/无锁敌态机）= 用户实报
    // 「打 boss 老不打/追不上」根因
    if (this.projId === 864) { this.smolstarAI(game, p, dmg0); return; }
    // ★BJ635：雀宝宝 759 = AI_158_BabyBird 专支（自管索敌 800 双距+玩家距门,不消费
    //  通用 tgt 面——分派前置 tgt 块对该 id 空转一次,零副作用）
    if (this.projId === 759) { this.babyBirdStep(game, p, dmg0); return; }
    if (this.projId === 946) { this.terraprismaBody(game, p, dmg0); return; }
    if (this.projId === 755) { this.batOfLightBody(game, p, dmg0); this.recordGhostTrail(); return; }   // ★BJ687 记录位（同上族注）
    if (this.projId === 963) { this.abigailBody(game, p, dmg0); return; }
    // AI_062 五射手 1:1 速度曲线/随机冷却/射击门（:66067-67166,备案项①③）
    if (ai62) { this.ai62Step(game, p, dmg0, tgt); return; }
    // 地面步行族（备案项②）：蜘蛛 390-392（AI_026 flag7）/ 吸血蛙 758（AI_067 flag2）
    if (this.projId >= 390 && this.projId <= 392) { this.spiderStep(game, p, dmg0); return; }
    // 海盗三变体（台账批②）：AI_067 flag 步行链正轨（原"统一飞行"近似退役）
    if (this.projId >= 393 && this.projId <= 395) { this.pirateStep(game, p, dmg0); return; }
    if (this.projId === 758) { this.frogStep(game, p, dmg0); return; }
    // 小雪怪 951（BJ435 定谳刀）：AI_067 flag5 地面步行族正轨——原「统一飞行」近似
    // 落通用悬停 = 用户实报「召唤浮空」根因（flying 分发于 2026-10-02 退役）
    if (this.projId === 951) { this.flinxStep(game, p, dmg0); return; }
    if (this.projId === 623) { this.guardianBody(game, p, dmg0); return; }
    if (this.projId === 317) { this.ravenBody(game, p, dmg0); return; }
    // ★BJ635：AI_066 双子（387/388）专支——此前落通用飞行路径（追击恒速 5/无 388
    //  冲刺态/387 激光固定 cd）;533 同函数 533 面全式（旧=相位机+通用运动覆写）
    if (this.projId === 387 || this.projId === 388) { this.twinsStep(game, p, tgt, dmg0); return; }
    if (this.projId === 533) { this.deadlySpherePhase(game, p, tgt, dmg0); return; }   // AI_066 533 面全式（BJ635）
    // Cool Whip 雪花哨兵 917（buff 312 维持,AI_177 :45938）——独立索敌 400+Lerp 追逐,
    // 伤害吃 summonDamageMult;★BJ516①：1036 已重路由 webStep（AI_067 flag7）
    // Foxparks 1094/1113 喷火态（PR:56081-56159 / 1457 :60064-60135：ai[0] 1000-1003
    // 每 4t 一发 1106；伤 = dmg（1456 :56133 ×0.75 → 1457 :60068 全额）×命中 0.85
    // (SetDefaults case 1106 :13491-13496 (int) 截断)；OnFire 300t(:11002)；penetrate 4；
    // 寿命 72 子步（AI_193 :42084）/54 子步后不伤（Damage_CanDealDamage :12479）——
    // ★BJ642：×3/life÷3 补偿退役（Arrow 已消费 extraUpdates=2=3 子步/tick 逐子步
    // 消 life,出生改原版字面 velocity=num17/life=72,见下）;1113 弹速 num17=10.5
    // （:60074，1094=5）；idStaticNPCHitCooldown=10（:60100）两型同）
    // ★BJ521②（2026-10-05,BJ520② 备案债清偿）：岩浆门折算——原版门序=AI_026 顶
    //  flag10 岩浆逃逸门 :59170-59174（lavaWet → ai[0]=1/ai[1]=0）先于 flag8 喷火块
    //  :60011-60101（ai[0]>=1000 :60014;块尾 return :60101）——岩浆拍 ai[0] 被覆写为
    //  1 <1000 ⇒ 喷火块不入,落 ai[0]==1 归位态。玩家侧 TryUsingFoxsparksAbility
    //  （Player.cs:43679,ai[0]=1000f :43686）逐拍重置 ⇒ 压制非粘滞:lavaWet 清
    //  （!wet 三清 :17103-17108）后下拍玩家重置即复燃,无需重按。本仓 foxChannel=电平
    //  驱动（Game 通道=玩家侧重置等价面,持住期间恒真）⇒ AI 侧以 lavaWetAi 读相
    //  （上拍湿段尾值,与本拍门消费同源）折门序:岩浆拍跳过喷火支,fall-through 至
    //  ai026TailGround（:5157 门 → a026A0=1 归位飞行）。
    //  ★BJ523（2026-10-05）：复燃结论维持、机制勘误——「逐拍重置」实为 autoReuse
    //  重臂环（:53519 强制 releaseUseItem + :53524 fast-path + :43064 门重开,岩浆拍
    //  续期停 :60068 → 每拍重调 TryUsingFoxsparksAbility 重写 ai[0]=1000）⇒ 出岩浆
    //  首拍 ai[0]==1000 即 fire（本仓 foxLavaHold 持住拍重调 foxAbilityPress 归位
    //  foxT=同相）;BJ522 登记债①「须重按」前提证伪（详见 tests/bj523 头注）。
    if ((this.projId === 1094 || this.projId === 1113) && this.foxChannel && !this.lavaWetAi) {
      this.foxFlameRan = true;             // 喷火块已入=:60093 localAI[0]=30 通道成立（Game 释放臂锁门）
      // 1456 :56111-56120（flag8=1094 喷火态）：direction=spriteDirection=
      // (velocity.X>0?1:-1)（vx==0 → player.direction :56112-56115）→
      // :56120 spriteDirection=-direction——喷火朝向反向贴图
      this.facing = -(Math.sign(this.foxAimX) || p.facing);
      if (++this.foxT % 4 === 1) {
        // ★BJ525(c)（2026-10-05,R4 F3 域旧账清偿）：本块 1106 通道火原版【无 ai[1]
        //  机制】——:60085 通道支 NewProjectile 不传 Ai1（恒 0）。旧
        //  fourthShot 注入（foxT%4===0 位于 ++foxT%4===1 块内=恒假死支,且错域：
        //  ai[1] 循环属 idle 态 1097 支）摘除;真注入面=ai026TailGround→
        //  shootMinionShot（:62742-62751 localAI[2]<=-3 回卷,本批实装）。
        // ★BJ642（2026-10-11）：×3/life÷3 补偿退役——Arrow 已消费
        //  extraUpdates=2（vanilla-projectiles.json,pd0 载入）=3 子步/tick 逐子步
        //  消 life,补偿式变成双重折算（速度 15px/子步×3=45px/tick vs 原版 5×3=
        //  15px/tick 三倍速;life 24 子步=8tick vs 72 子步=24tick 三倍短）——
        //  foxHitInflate 速度门(:15079>10)与 BJ642 演出面 flag2(:35747)同被
        //  ×3 速度污染。现出生=原版字面（velocity=num17 向、life=72 子步），
        //  速度/寿命/命中盒/演出门四面同相。
        //  伤 = dmg×0.85（SetDefaults case 1106 :13491-13496 (int) 截断——旧 round
        //  差 1 伤登记清偿）
        const flameSpd = this.projId === 1113 ? 10.5 : 5;   // num17（:60072/:60074）原版字面
        const flame = new Arrow(this.cx - 3, this.cy - 3, this.foxAimX * flameSpd, this.foxAimY * flameSpd,
          Math.max(1, Math.trunc(dmg0 * 0.85)), 0, 1106,
          { grav: 0, life: 72, pierce: 4 });
        // 命中火 buff:速度门 StatusNPC :11665-11668——velocity.Length()>10 →
        // OnFire3(323) else OnFire(24),300t 定值。弹速=num17 字面（5/10.5）→
        // 1094 恒 OnFire(24)、1113 恒 OnFire3(323)（:60072-60074）
        const origSpd = flameSpd;
        flame.onFireHit = {
          buff: Math.hypot(this.foxAimX, this.foxAimY) * origSpd > 10 ? 323 : 24,
          minT: 300, maxT: 300,
        };
        // 喷火嘶声（Projectile.cs:38958）：1106 弹 whoAmI%3==0 才播——三发一门近似；
        // FoxparksFlame=Item_34 音量 0.15（SoundID.cs:1098）
        if ((this.foxFlameN = (this.foxFlameN + 1) % 3) === 1) {
          game.playSfxFiles(['Item_34'], 0.15, this.cx, this.cy);
        }
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(flame, 'projectiles');
      }
      return; // 喷火态跳过常规索敌/移动（position 锚玩家由 Game/悬停链处理近似）
    }
    // ★BJ516④（2026-10-05）：AI_026 尾族地面态运动面（191-194/266/1094/1113 非
    //  喷火拍）——num150/num151 转向-开火阈/flag9 抚摸打断 + 归位门/归位飞行
    //  1:1（ai026TailGround 注）;旧通用悬停+无阈开火对本族退役。喷火态已在
    //  foxChannel 支 return,不至此。
    if (ai026Tail) { this.ai026TailGround(game, p, dmg0, ai026Tail); return; }
    // ---- 1457 禁戒魂灵 1119（6164 Forbidden Minion,aiStyle 206）----
    // AI_206_ForbiddenMinion（Projectile.cs:38182-38395）1:1 折算：
    //  · 悬停锚 = player.Top+(−dir×16,−25) + 群体环形偏移（:38195-38220,本仓
    //    slot 槽位近似 index/total）；距玩家 >2000 瞬移（:38194）
    //  · 索敌 800px + CanHitLine 门（:38199 Minion_FindTargetInRange + :38177
    //    CustomEliminationCheck）；有敌 → 朝敌 MoveTowards(200) + rotation 朝敌
    //  · 开火循环 ai[0]：归零且索敌 → 150;倒数到 120 发 1120 ForbiddenMinionShot
    //    （GemStaffFeatures FastThenSlow 位,32 速朝敌）+ 反冲 velocity=−dir×0.3
    //    （:38258-38277）;>120 段移速 ×Remap(ai0,150,120,1,0) 渐停（:38282-38286）
    if (this.projId === 1119) {
      // ★BJ515 债④（BJ514 批①登记债清偿）：原版 = Minion_FindTargetInRange(800,
      //  skip=false, AI_206_CustomEliminationCheck_Forbidden, respectOwnerTarget 缺省
      //  true)（:38199+:38177-38180）——customEliminationCheck = CanHitLine(本体盒
      //  position,width,height → 敌盒 :38179),野生扫尾位门（焦点支不过此门 :49888）。
      //  双距/viewRect 在 findTargetInRangeDual 既有承载;旧 nearestEnemy(800)
      //  欧氏+900 集火窗+无消除门退役。
      const tgtF = this.findTargetInRangeDual(game, 800, {
        customEliminationCheck: (e) => canHitLine(game.world.store,
          this.x, this.y, this.w, this.h, e.x, e.y, e.w, e.h),
      });
      // 悬停锚（:38196 vec = player.Top + (−dir×16,−25) + 群体偏移）
      const orbA = this.age * 0.03 + this.slot * 1.7;
      let hx = p.cx - p.facing * 16;
      let hy = p.cy - p.h / 2 - 25 + Math.sin(orbA) * 10;
      if (tgtF) {
        // :38236-38244 朝敌 MoveTowards(200)+朝向/旋转
        const dx = tgtF.cx - this.cx, dy = tgtF.cy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        hx = tgtF.cx - dx / d * Math.max(0, d - 120);
        hy = tgtF.cy - dy / d * Math.max(0, d - 120);
        this.facing = tgtF.cx > this.cx ? 1 : -1;
        this.rot = Math.atan2(dy, dx) + (this.facing === -1 ? Math.PI : 0);
      } else {
        this.rot = 0;
        this.facing = p.facing;
      }
      // 开火循环（:38258-38286）：shootCd 复用 ai[0] 语义（150 归零→150;120 出弹）
      if (this.shootCd > 0) this.shootCd--;
      if (tgtF && this.shootCd === 0) this.shootCd = 150;
      if (tgtF && this.shootCd === 120) {
        const dx = tgtF.cx - this.cx, dy = tgtF.cy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        const shot = new Arrow(this.cx - 5, this.cy - 5, dx / d * 32, dy / d * 32,
          Math.max(1, Math.round(dmg0)), this.knockback, 1120,
          { grav: 0, life: 300, pierce: 2, gem: { fastThenSlow: true } });
        shot.whipTagShot = true;   // MinionShot（ProjectileID.Sets.MinionShot[1120] :291）
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(shot, 'projectiles');
        this.vx = -dx / d * 0.3 * 32;   // :38276 velocity = −vector5×0.3（vector5=32 速向）
        this.vy = -dy / d * 0.3 * 32;
      }
      // 移动（:38282-38289）：v MoveTowards(锚向×16, 2);开火后段渐停
      const mdx = hx - this.cx, mdy = hy - this.cy;
      const mdl = Math.hypot(mdx, mdy) || 1;
      const spd = 16 * (this.shootCd > 120
        ? Math.max(0, 1 - (this.shootCd - 120) / 30) : 1);
      const tvx = mdx / mdl * Math.min(spd, mdl), tvy = mdy / mdl * Math.min(spd, mdl);
      this.vx += Math.max(-2, Math.min(2, tvx - this.vx));
      this.vy += Math.max(-2, Math.min(2, tvy - this.vy));
      this.x += this.vx; this.y += this.vy;
      if (Math.hypot(this.cx - p.cx, this.cy - p.cy) > 2000) {   // :38194 瞬移门
        this.x = p.cx; this.y = p.cy - 40;
      }
      // ★BJ635：AI_206 状态帧机（:38293-38324,BJ632 登记「1119 状态帧」债清偿——
      //  旧 age/8 匀速兜底扫遍 9 帧含攻击带）。攻击带起帧 = 出弹前 4t
      //  （num5−num6+4=124 :38255,repo 出弹位=shootCd 120）;攻击带 5-8 fc≥4 推帧
      //  ≥9 回 0 + 失靶即断;待机带 0-4 fc≥4 推帧 + frame==0 ∧ rand(7)≠0 滞帧。
      if (tgtF && this.shootCd === 124) this.fmFrame = 5;        // :38296-38298
      if (this.fmFrame >= 5 && this.fmFrame <= 8) {              // :38299-38311
        if (++this.fmFc >= 4) { this.fmFc = 0; if (++this.fmFrame >= 9) this.fmFrame = 0; }
        if (!tgtF) { this.fmFc = 0; this.fmFrame = 0; }          // :38307-38310
      } else if (this.fmFrame <= 4) {                            // :38313-38324（>4 段冻结=idle 机不跑）
        if (this.fmFrame === 0 && Math.floor(Math.random() * 7) !== 0) this.fmFc = 0;   // 滞帧
        if (++this.fmFc >= 4) { this.fmFc = 0; if (++this.fmFrame >= 5) this.fmFrame = 0; }
      }
      // ★BJ698：1119 禁戒魂灵本体零接触——projPet[1119]（Main.cs:8918）无 carve-out
      //  （:12495）+ SetDefaults :10466-10479 无 friendly=true + AI_206（:38182-38395）
      //  零 friendly 写位 ⇒ Damage_PVE_Inner :12630 friendly 门恒拒——输出全在 1120
      //  出弹上。旧无条件 contact=多窗（localNPCHitCooldown=30 表条目保留=数据面存照）。
      return;
    }
    // ---- 1457 帕鲁地面随从 1093/1112/1118（5663/6148/6161，AI_067 flag8/flag9 折算）----
    if (this.projId === 1093 || this.projId === 1112 || this.projId === 1118) { this.palGroundStep(game, p, dmg0); return; }
    // ---- Dead Cells 蘑菇小伙伴 1022（5456，AI_067 flag6 折算；爆点→弹 1044）----
    if (this.projId === 1022) { this.mushBoiStep(game, p, dmg0); return; }
    if (this.projId === 917) {
      // 生命与玩家 buff 绑定（AI_177 :45941-45950：!active∨dead → Kill;coolWhipBuff → timeLeft=2）
      if (!p.whipBuffs[312]) { this.dead = true; return; }
      // ★BJ515 债①：localNPCImmunity 逐 t 衰减（Update 头先衰减 :17365-17385 →
      //  AI 后行 :45997 同相——ai177FindTarget 的锁门/扫描门读「衰减后」值）;
      //  写位 = contact()（:14178,cd=20 :8713-8714,本支 contact(…,20) 同值）
      this.ai177Immunity ??= new LocalImmunityTable();
      this.ai177Immunity.tick();
      // ★BJ514：FindTargetWithinRange(400f)（:45918/:46013）——无集火/tag 桶
      //  （AI_177 不读 OwnerMinionAttackTargetNPC;曾吃 nearestEnemy 通用面）
      const tgt = this.ai177FindTarget(game);
      if (tgt) {
        // ★BJ516③（2026-10-05）：追逐速度曲线 1:1（:46031-46043）——
        //  num5=Distance（:46031）→ num3=min(18,num5) 限距钳（:46033-46035,不越过目标）→
        //  velocity = Lerp(velocity, dir×num3, 0.1)（:46042,amount=0.1 :46019）;
        //  num4=0 门（:46041）恒过,num5==0 时 DirectionTo=NaN → HasNaNs 整支跳过
        //  （:46040,velocity 原样）。旧直写 5 速退役。
        const num5 = Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
        let num3 = 18;
        if (num3 > num5) num3 = num5;                    // :46033-46035
        if (num5 > 0) {
          const dxn = (tgt.cx - this.cx) / num5, dyn = (tgt.cy - this.cy) / num5;
          this.vx += (dxn * num3 - this.vx) * 0.1;       // :46042 Lerp
          this.vy += (dyn * num3 - this.vy) * 0.1;
        }
      } else {
        // ★BJ516②（2026-10-05）：无目标运动面 1:1 = 减速漂移 ×0.92（:46055 else 支）
        //  ——旧玩家环形悬停（沿袭形）退役。
        this.vx *= 0.92;
        this.vy *= 0.92;
      }
      // ★BJ516②同面 rider：917 旋转制归真（:46087 `rotation += 0.020943953+
      //  |vx|×0.2` 连续自旋;旧 rot=vx×0.0125 系 969 :46074 旋转面误锚——1456 :42601
      //  同谳,969 支体在 if(type==969) 门内）。AI_177 全函数无 direction/
      //  spriteDirection 写 = MINION_ROT_ONLY 既有面（旧 facing 追写一并摘除）。
      this.rot += 0.020943953 + Math.abs(this.vx) * 0.2;
      // ★BJ517①（2026-10-05）：C 类视觉尘补（AI_177 :46088-46094——969 else 支同段,
      // 917 消费）：Next(3)==0 每拍 1/3 → 尘 43（α254/白/scale0.5,初速=本速后被
      // 覆写）,位置=Center+circular(1,1)×10、速度=circular(1,1)——「雪花消融」微尘
      if (Math.random() * 3 < 1) {                       // Main.rand.Next(3) == 0
        const d43 = game.spawnDust?.(this.cx, this.cy, 0, 0, 43, this.vx, this.vy, 254,
          { r: 255, g: 255, b: 255, a: 255 }, 0.5);
        if (d43) {
          const c43 = nextVector2Circular(Math.random, 1, 1);   // :46091
          d43.x = this.cx + c43.x * 10;                  // :46092 position=Center+c×10
          d43.y = this.cy + c43.y * 10;
          d43.vx = c43.x; d43.vy = c43.y;                // :46093 velocity=vector3
        }
      }
      // 917 tileCollide=false（:8708）→ 湿阻尼块 :17721 不跑,恒全速直写（留锚）
      this.x += this.vx;
      this.y += this.vy;
      this.contact(game, dmg0, 20); // armorPen 30（:9494）由 contact 内 pen0 两源通道结算
      return;
    }
    if (this.projId === 1036) {
      // ★BJ516①：1036 雾网蜘蛛重路由 AI_067 flag7（webStep——SetDefaults :9773
      //  aiStyle=67,生命绑定 whipBuffs[365]/cobWhipBuff :50027-50041）
      if (!p.whipBuffs[365]) { this.dead = true; return; }
      this.webStep(game, p, dmg0);
      return;
    }
    if (!this.ground) {
      // 飞行：无目标 → 环形槽位悬停玩家侧后；有目标 → 俯冲
      if (tgt) {
        const dx = tgt.cx - this.cx, dy = tgt.cy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        this.vx = (dx / d) * 5;
        this.vy = (dy / d) * 5;
      } else if (this.projId === 387 || this.projId === 388) {
        // ★BJ635 退役亚支：双子已离场（twinsStep AI_066 专支 1:1——含本悬停面的
        //  原版阻尼形 (v×num547+dir×num546)/(num547+1),num547=40/30/20 玩家速链
        //  档位;旧 (v×15+dir×spd)/16 阻尼系数与原版 40 系分叉）
        const hx = p.cx, hy = p.cy - 60;
        const dx = hx - this.cx, dy = hy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        if (d > 70) {
          const spd = Math.max(15, Math.abs(p.vx) + Math.abs(p.vy));
          this.vx = (this.vx * 15 + (dx / d) * spd) / 16;
          this.vy = (this.vy * 15 + (dy / d) * spd) / 16;
        } else if (this.vx === 0 && this.vy === 0) {
          this.vx = -0.15; this.vy = -0.05;
        }
        if (Math.hypot(this.vx, this.vy) > 15) { this.vx *= 0.95; this.vy *= 0.95; }
      } else {
        const hoverAng = this.slot * Math.PI * 0.5;
        const hx = p.cx - p.facing * 36 + Math.cos(hoverAng) * 22;
        const hy = p.cy - 30 + Math.sin(hoverAng) * 18;
        const dx = hx - this.cx, dy = hy - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        const spd = Math.min(4, d * 0.08);
        this.vx = (dx / d) * spd;
        this.vy = (dy / d) * spd;
      }
      // ★BJ635：双子互斥块退役——387/388 已离场（twinsStep AI_066 专支 :30117-30146
      //  flag30 分离力 1:1 同主同型对 ±0.05/t）
      // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗,
      // 速度场不减只削位移;域外 id 无湿段 → 四旗恒 false → 档恒 1 数值不变）
      const dfFly = projWaterDragFactor(this);
      this.x += this.vx * dfFly;
      this.y += this.vy * dfFly;
      // 回收（1456 AI_062 :62786-62790：num35>2000 → 瞬移回玩家中心；曾写 >1300）
      if (Math.hypot(this.cx - p.cx, this.cy - p.cy) > 2000) {
        this.x = p.cx - p.facing * 30;
        this.y = p.cy - 30;
      }
    } else {
      // 地面：重力+碰撞追击
      if (tgt) {
        this.vx += Math.sign(tgt.cx - this.cx) * 0.12;
        this.vx = Math.max(-3.5, Math.min(3.5, this.vx));
        if (this.onGround && tgt.cy < this.cy - 24 && Math.random() < 0.03) this.vy = -5; // 小跳追高
      } else {
        this.vx *= 0.9;
        // 跟随玩家（距离大时小跑）
        const dx = p.cx - this.cx;
        if (Math.abs(dx) > 60) this.vx = Math.max(-2.5, Math.min(2.5, dx * 0.02));
      }
      this.vy = Math.min(this.vy + GRAVITY, MAX_FALL_SPEED);
      // ★BJ672：弹面 flag6=TRUE 缺省（AI_062 族 373-963 非 pet/非覆写面;375/963
      //  SetDefaults tileCollide=false 时弹面整段跳过、本块不达;423/613 初值 true
      //  弹面跑时恒穿平台）→ 地面态下落穿平台。
      this.dropThrough = true;
      // ★水中位移阻尼（HandleMovement :17721-17764 湿支;湿段 tick 头已刷新当拍旗;
      // 域外 id 无湿段 → 四旗恒 false → 档恒 1 数值不变）
      const dfGnd = projWaterDragFactor(this);
      moveAndCollide(this, game.world, this.vx * dfGnd, this.vy * dfGnd);
    }
    // 朝向（AI_062 :62983-62990：velocity.X>0 → spriteDirection=-1——贴图朝左，
    // 右行才翻转 = facing 取 -sign(vx)；963 阿比盖尔特判 ×-1 自带朝右贴图已在其
    // 专属分支）。原版在移动后的 FindFrame 取 velocity——故置于移动段之后。
    // AI_026/164 族（俾格米/宝宝史莱姆/蜘蛛/计数器/Foxparks）零 spriteDirection
    // 赋值恒不翻——渲染端 MINION_NO_FLIP 表承接
    {
      const dirX = Math.sign(this.vx);
      if (dirX !== 0) this.facing = AI62_LEFT_ART.has(this.projId) ? -dirX : dirX;
    }
    // ★BJ635：旋转制族块退役——双子 387/388（rotation=velocity.ToRotation()+π、
    //  387 交战朝敌）与 533（滚动 rot += vx*0.04）均已离场至 AI_066 专支
    //  （twinsStep :30468-30480 / deadlySpherePhase :30471-30474）
    // 远程射击（AI_062/aiStyle66 射击族：射程门内且冷却好 → 朝目标发射专属弹幕）。
    // ★BJ516④（2026-10-05）：AI_026 尾族（191-194/266→无弹,1094/1113）改走
    //  ai026TailGround 内联开火（num151 转向-开火阈 + num154/num155 瞄准锥
    //  :62701-62760）,不再达本块;★BJ635：387 激光消费面随 twinsStep 退役
    //  （388 无 MINION_SHOOT 键本就不射）——本块降为未移植型兜底。
    //  AI_062 五族不走本块（ai62Step 原版冷却/门距接管）
    const shooter = MINION_SHOOT[this.projId];
    if (tgt && shooter) {
      if (this.shootCd > 0) this.shootCd--;
      else {
        const d = shooter.metric === 'manhattan'
          ? Math.abs(tgt.cx - this.cx) + Math.abs(tgt.cy - this.cy)
          : Math.hypot(tgt.cx - this.cx, tgt.cy - this.cy);
        const range = (shooter.range ?? 700) + (shooter.rangeSlot ?? 0) * this.slot;
        // 门界比较（终零波 M4 对账）：曼哈顿族原文是【严格 <】,欧氏族维持既有面
        const inRange = shooter.metric === 'manhattan' ? d < range : d <= range;
        // ★BJ635：387 视线门随条目退役（twinsStep CanHitLine 中心点门 1:1 承接）
        if (inRange) this.shootMinionShot(game, dmg0, shooter, tgt.cx, tgt.cy);
      }
    }
    // 接触伤害（tag + TagCrit 语义见 contact()）。★台账批③：统一 20t 私表退役——
    // 冷却走 CONTACT_CD_TABLE 三态解析：双子 387/388 = idStatic 16/12（:4714/:4730）、
    // 致命球 533 = local 12（:6008）、其余（俾格米 191-194/Foxparks 1094·1113/
    // 乌鸦外通用飞行族等）= 原版缺省 -2 → 吃玩家全局免工件窗
    // （Projectile.cs:466 缺省 + Damage_PVE_Inner immune[owner] 门 :12636）
    this.contact(game, dmg0);
    // ★BJ235 残影记录（UpdateTrails :17198——Damage 后同序;无记录式 id 环=null 短路）
    this.recordGhostTrail();
    // 玩家死亡/过远不消失（原版随从持续到上限驱逐或卸装）——仅跟随
    void TILE;
  }

  /** 同伴方块 653（AI_067 的 light-pet 路径,Projectile.cs 1:1）：
   *  · 生命期（:46657-46662）：buff 191 活 → 续命；玩家死/无 buff → 消失
   *  · 特殊段（:46804-46860）：rot+=vx/20；岩浆内 lai0++（≥20 且尖叫冷却归零 →
   *    NPCDeath59/61 叫一声,冷却 3600t）；全黑（自身+玩家格光照 <0.15）lai1++ 否则
   *    递减（钳 -3600..120）；超过阈值 且玩家静止/无无敌 → 1/5 尖叫(Item16)否则
   *    捅人 Hurt(3, ByOther(6)) + 无敌帧清零（免疫穿透）——死因 DeathText.Stabbed
   *  · 跟随（:47407+/47055+）：vector=玩家中心；>300px 或 |dy|>300 → ai0=1 悬浮直飞
   *    （tileCollide=false,加速 0.2,近主 <200 且主落地且头顶净空 → 回地面态）；
   *    地面态：贴主（|dx|<150 摩停下,rot→0）否则水平加速 0.5/上限 4(玩家速钳制),
   *    |vx|>3 触发跳跃,目标高出 48px 按距离表起跳（-6..-16）,湿身 vy×2 */
  private companionCubeStep(game: import('./types').GameHooks): void {
    const owner = this.ownerRef();
    const w = game.world;
    const st = w.store;
    // ---- 生命期（:46657-46662 companionCube 旗= buff 191）----
    if (!owner || owner.dead || !owner.buffs.has(BuffType.CompanionCube)) { this.dead = true; return; }
    this.w = 30; this.h = 30; // SetDefaults（:6733-6741）

    // ---- 特殊段（:46804-46860）----
    this.cubeRot += this.vx / 20;
    if (MinionProj.cubeScreamCd > 0) MinionProj.cubeScreamCd--;
    // 岩浆计数（:46812-46827）
    const cti = st.idx(Math.floor(this.cx / 16), Math.floor(this.cy / 16));
    if (st.liquid[cti] > 0 && st.liquidType[cti] === 2) this.cubeLai0++;
    else this.cubeLai0--;
    this.cubeLai0 = Math.max(0, Math.min(20, this.cubeLai0));
    if (this.cubeLai0 >= 20 && MinionProj.cubeScreamCd === 0) {
      MinionProj.cubeScreamCd = 3600;
      game.playSfxFiles([Math.random() < 0.1 ? 'NPC_Killed_61' : 'NPC_Killed_59'], 1, this.cx, this.cy);
    }
    // 黑暗捅人（:46835-46860——仅本地玩家侧）----
    const lit: { c: number; p: number } = (() => {
      const lg = (game as unknown as { lighting?: { lightAt: (tx: number, ty: number) => [number, number, number] } | null }).lighting;
      if (!lg) return { c: 1, p: 1 }; // 无光照引擎(探针)视作亮,不触发
      const at = (wx: number, wy: number) => {
        const [r, g, b] = lg.lightAt(Math.floor(wx / 16), Math.floor(wy / 16));
        return Math.hypot(r, g, b) / 255; // Lighting.GetColor().ToVector3().Length()
      };
      return { c: at(this.cx, this.cy), p: at(owner.cx, owner.cy) };
    })();
    if (lit.c < 0.15 && lit.p < 0.15) this.cubeLai1++;
    else if (this.cubeLai1 > 0) this.cubeLai1--;
    this.cubeLai1 = Math.max(-3600, Math.min(120, this.cubeLai1));
    const pSpeed = Math.abs(owner.vx) + Math.abs(owner.vy);
    if (this.cubeLai1 > 30 + Math.floor(Math.random() * 90) && owner.iframes <= 0 && pSpeed === 0) {
      if (Math.random() < 0.2) {
        game.playSfxFiles(['Item_16'], 1, this.cx, this.cy);
        this.cubeLai1 = -600;
      } else {
        game.playSfxFiles(['Item_1'], 1, this.cx, this.cy);
        owner.lastDamageCause = { kind: 'stabbed' };
        owner.damage(3, this.cx, this.cy, false);
        owner.iframes = 0; // :46857-46858 immune=false/immuneTime=0（穿透无敌）
        this.cubeLai1 = -300 - Math.floor(Math.random() * 30) * 10;
      }
    }

    // ---- 跟随核心（light-pet 族,flag12=false 路径）----
    let vx = this.vx, vy = this.vy;
    const pcx = owner.cx, pcy = owner.cy;
    const dpx = pcx - this.cx, dpy = pcy - this.cy;
    const distP = Math.hypot(dpx, dpy);
    if (distP > 2000) { // :47414 超远直传
      this.x = pcx - this.w / 2; this.y = pcy - this.h / 2;
      vx = 0; vy = 0;
    }
    // 目标（:46718 vector=player.Center;653 仅覆写 X=player.Center.X=同值）
    let tx = pcx, ty = pcy;
    if (this.cubeA0 === 0) {
      if (distP > 300 || Math.abs(dpy) > 300) { this.cubeA0 = 1; } // :47413 num3/num4=300
    } else {
      // ---- 悬浮归位态 ai0=1（:47050-47160）----
      // tileCollide=false；加速 0.2 逼近;近主 <200 且主落地且自身净空 → 回地面态
      if (distP < 200 && owner.vy === 0 && this.y + this.h <= owner.y + owner.h
        && !st.isSolid(Math.floor(this.cx / 16), Math.floor(this.cy / 16))) {
        this.cubeA0 = 0;
        if (vy < -6) vy = -6;
      }
      if (distP >= 60) {
        const num19 = Math.max(10, pSpeed);
        const spx = (dpx / (distP || 1)) * num19, spy = (dpy / (distP || 1)) * num19;
        const acc = 0.2, acc15 = acc * 1.5;
        if (vx < spx) { vx += acc; if (vx < 0) vx += acc15; }
        else if (vx > spx) { vx -= acc; if (vx > 0) vx -= acc15; }
        if (vy < spy) { vy += acc; if (vy < 0) vy += acc15; }
        else if (vy > spy) { vy -= acc; if (vy > 0) vy -= acc15; }
      } else {
        this.cubeLai0 = 0; // :47088 近主清零（与岩浆计数共用槽）
      }
      if (vx !== 0) this.facing = vx > 0 ? 1 : -1;
      this.x += vx; this.y += vy;
      this.vx = vx; this.vy = vy;
      return;
    }
    // ---- 地面态 ai0=0（:47407+/47536+）----
    // 目标下探（:47458-47465 最多 20 格找地面）
    for (let k = 0; k < 20; k++) {
      if (st.isSolid(Math.floor(tx / 16), Math.floor(ty / 16))) break;
      ty += 16;
    }
    // 目标视线截断（:47468 TileCollision 5% 步进近似——遇实心停在墙前）
    {
      const dx = tx - pcx, dy2 = ty - pcy;
      let nx = pcx, ny = pcy;
      for (let t = 0.05; t <= 1.001; t += 0.05) {
        const sx = pcx + dx * t, sy = pcy + dy2 * t;
        if (st.isSolid(Math.floor(sx / 16), Math.floor(sy / 16))) break;
        nx = sx; ny = sy;
      }
      tx = nx; ty = ny;
    }
    const dtx = tx - this.cx, dty = ty - this.cy;
    const distT = Math.hypot(dtx, dty);
    // :47446 贴身且玩家更近 → 以自身为锚（防抖）
    if (distT < 32 && distP < distT) { tx = this.cx; ty = this.cy; }
    // 水平步进参数（:47496-47537 num34/35/36/37）
    let acc = 0.5, vmax = 4, clamp = 4, accSlow = 0.1;
    {
      const ps = Math.abs(owner.vx) + Math.abs(owner.vy);
      if (ps > 0 && ps < clamp) clamp = ps; // 653 特例（:47536-47543）
    }
    const num41 = tx - this.cx;
    let jumpGate = false;
    if (Math.abs(num41) < 150) { // 653 贴靠（:47589-47595）
      // rotation → 0（AngleTowards 0.2）
      this.cubeRot = angleTowards(this.cubeRot, 0, 0.2);
      vx *= 0.9;
      if (Math.abs(vx) < 0.1) vx = 0;
    } else if (Math.abs(num41) > 5) { // :47597-47610
      if (num41 < 0) { vx -= (vx > -vmax ? acc : accSlow); if (num41 < 0 && vx > 0) vx -= accSlow; }
      else { vx += (vx < vmax ? acc : accSlow); if (num41 > 0 && vx < 0) vx += accSlow; }
      if (Math.abs(vx) > 3) jumpGate = true; // :47695 653 跳跃门
    } else {
      vx *= 0.9;
      if (Math.abs(vx) < acc * 2) vx = 0;
    }
    vx = Math.max(-clamp, Math.min(clamp, vx));
    if (vx !== 0) this.facing = vx > 0 ? 1 : -1;
    // 重力 + 碰撞（tileCollide=true）
    // ★BJ673 勘误（红蓝 R3-F#3 翻案 BJ672）：653 有显式承接面——Projectile.cs:
    //  17605-17612 `if (type == 653 || 1018) { flag6=false; if (player.Bottom.Y >
    //  Bottom.Y + 4) flag6=true; }`（后置于 projPet 门）——默认承接平台,仅玩家底
    //  低于立方底 4px 时穿。BJ672 的「恒穿」判据两前提（非 pet/不在覆写面）皆假。
    this.dropThrough = owner ? (owner.y + owner.h) > (this.y + this.h) + 4 : false;
    vy = Math.min(vy + 0.3, MAX_FALL_SPEED);
    this.vx = vx; this.vy = vy;
    moveAndCollide(this, w, vx, vy);
    const onGround = this.onGround;
    if (onGround && vy === 0) {
      // 跳跃梯（:47751-47760 按 2/5 格上方障碍选 -5.1..-11.1）
      if (jumpGate) {
        const fx = Math.floor((this.x + this.w / 2) / 16) + this.facing + Math.round(vx);
        const fy = Math.floor((this.y + this.h / 2) / 16);
        const solid = (oy: number) => st.isSolid(fx, fy + oy);
        if (!solid(-1) && !solid(-2)) this.vy = -5.1;
        else if (!solid(-2)) this.vy = -7.1;
        else if (solid(-5)) this.vy = -11.1;
        else if (solid(-4)) this.vy = -10.1;
        else this.vy = -9.1;
      }
      // 目标高出 48px → 距离表起跳（:47765-47808）
      if (ty - this.cy < -48) {
        const d = -(ty - this.cy);
        this.vy = d < 60 ? -6 : d < 80 ? -7 : d < 100 ? -8 : d < 120 ? -9
          : d < 140 ? -10 : d < 160 ? -11 : d < 190 ? -12 : d < 210 ? -13
          : d < 270 ? -14 : d < 310 ? -15 : -16;
      }
    }
  }

  draw(r: import('../render/Renderer').Renderer): void {
    // 世界坐标绘制（Renderer 实体循环在世界变换内）——投射物贴图懒加载通道同 Arrow。
    // 原版投射物贴图是竖向多帧行（projFrames 表）：按帧高切片，1:1 像素尺寸。
    // 爆炸烈焰塔走 AI_130 帧状态机（待机帧 0 / 开火帧 1-6 每 4t），其余哨兵/随从
    // age/8 匀速循环；哨兵按 facing 翻转（原版 spriteDirection）
    const ctx = r.ctx;
    if (!ctx) return;
    // ★SW-FX6 2026-09-10 债⑥清偿：831 虎宝石/970 阿比盖尔计数器 = vanilla hide=true
    //  （Projectile.cs:8082/:9197,SetDefaults aiStyle=164 计数器弹）→ 主循环
    //  hide 门整支跳过（Main.cs:22404-22406 `if (!active || type<=0 || hide ||
    //  drawLayer!=0) continue`）=【隐形计数器】:AI_164 照跑（环绕/召唤本体
    //  838/963 等）,只是本体弹从不绘制。本仓旧刻意渲染 12×12 宝石+环绕 AI
    //  （语义分叉,BJ16 §4⑥ 留裁决）——本批按原版落 hide（裁决记录见
    //  docs/audit/summon-draw-branch-registry-2026-09-07.md 与 SW-FX6 报告）。
    //  行为锁 = tests/sw-fx6-draw-debt-closure.test.ts（摘本支应红）。
    if (this.projId === 831 || this.projId === 970) return;
    // ★清偿刀 N（2026-09-30）：弹幕染料（GetProjectileDesiredShader 1:1,通道解析见
    //  minionDyeVid 注）——EntitySpriteDraw×Armor.Apply 等价=逐贴图过 SM2 pass。
    //  dFrameImg=帧裁切面（t0Rect=原片内矩形,渐变族 T0 与 vanilla 同源）;
    //  dSheetSub=整片/子矩形面。残影 gimg 按整片染（渐变族 T0 相位近似,登记债）。
    const dyeVid = this.minionDyeVid();
    const dyeOpt = {
      facing: this.facing >= 0 ? 1 : -1,
      box: { x: this.x, y: this.y, w: this.w, h: this.h },
      lightAt: r.lighting?.lightAt?.bind(r.lighting) ?? null,
    };
    const dFrameImg = (id: number, fr: number): HTMLCanvasElement | null => {
      const base = projFrameImg(id, fr);
      if (!base || !(dyeVid > 0)) return base;
      const rect = projFrameSrcRect(id, fr);
      const sheet = rect ? projSprite(id) : null;
      const dyed = dyedProjCanvas(base, 0, 0, base.width, base.height, dyeVid,
        rect && sheet
          ? { ...dyeOpt, t0Rect: { sx: rect.sx, sy: rect.sy, sheetW: sheet.width, sheetH: sheet.height } }
          : dyeOpt);
      return dyed ?? base;
    };
    type ProjTex = NonNullable<ReturnType<typeof projSprite>>;
    type DrawTex = ProjTex | HTMLCanvasElement;
    const dSheetSub = (sheet: ProjTex, sx: number, sy: number, sw: number, sh: number): DrawTex => {
      if (!sheet || !(dyeVid > 0)) return sheet;
      return dyedProjCanvas(sheet, sx, sy, sw, sh, dyeVid, dyeOpt) ?? sheet;
    };
    const frames = projFrameCount(this.projId);
    let frame: number;
    if (this.projId === 623) {
      // AI_120 帧选（★BJ157⑧）：2=攻击 12-19 直引 / 1=rest 坐姿 0-14 直引（gFrame
      // 即原版 projectile.frame,9t 一翻 :45642-45648）/ 其余行走 0-7（%8 与直引同相）
      frame = this.gA0 === 2 || this.gA0 === 1 ? this.gFrame : this.gFrame % 8;
    } else if (this.projId === 317) {
      // AI_054：4fc 循环（0-3 飞 / 4-7 扑，:27543-27594）
      frame = (this.ravenZone === 1 ? 4 : 0) + (Math.floor(this.age / 4) % 4);
    } else if (this.sentry && FLAMEBURST_TOWER.has(this.projId)) {
      frame = this.sFire === 1 ? 1 + Math.floor(this.sFireT / 4) : 0;
    } else if (this.sentry && BALLISTA_TOWER.has(this.projId)) {
      frame = this.sFire === 1 ? 1 + Math.floor(this.sFireT / 5) : 0;
    } else if (this.sentry && TRAP_TOWER.has(this.projId)) {
      frame = Math.floor(this.age / 12) % frames; // AI_138 frameCounter 12t 连续循环
    } else if (this.projId === 1098 || this.projId === 1123) {
      // 钻地龟（AI_204）：帧由 digtoiseStep 直写（0-2 出场/待机、2-9 挖掘循环、
      // 10 停用——projFrames 11 帧表 Main.cs:8696-8700 段）
      frame = Math.min(this.digFrame, Math.max(0, frames - 1));
    } else if (this.projId >= 390 && this.projId <= 392) {
      // 蜘蛛步行链帧通道（AI_026 :65092-65220）：0-2 走 / 3 空 / 4-7 爬墙
      frame = Math.min(this.spFrame, Math.max(0, frames - 1));
    } else if (this.projId === 1093 || this.projId === 1112 || this.projId === 1118) {
      // 帕鲁地面随从（AI_067 flag8=1093||1112/flag9）：palGroundStep 原版帧机直写
      frame = Math.min(this.palFrame, Math.max(0, frames - 1));
    } else if (this.projId === 1022) {
      // 蘑菇小伙伴（AI_067 flag6 :51642-51681）：mushBoiStep 原版帧机直写
      frame = Math.min(this.mushFrame, Math.max(0, frames - 1));
    } else if (this.projId === 963) {
      // 阿比盖尔一阶（AI_062 963 档 :66843-66868）：abigailBody 帧机直写
      frame = Math.min(this.a963Frame, Math.max(0, frames - 1));
    } else if (this.projId === 1025) {
      // ★BJ516⑤：藤壶哨站帧档（AI_197 :41121-41130）——悬浮 3 / 吸顶 sFrame 0-2
      // （随机黏着,出域才重掷）。旧 MINION_FRAMES[1025] 匀速循环退役
      frame = this.sAttach === 1 ? this.sFrame : 3;
    } else if (this.projId === 1036) {
      // ★BJ516①：雾网蜘蛛 flag7 帧档（AI_067 :51670-51686）——webStep 帧机直写
      // （地面静 0/行走 fc>4 翻页循环全 20 帧/空中 1）。旧 age/8 兜底退役
      frame = Math.min(this.webFrame, Math.max(0, frames - 1));
    } else if (this.projId >= 393 && this.projId <= 395) {
      // 海盗随从（AI_067 flag 帧段直写 :50866/:51802）：走 0-3 / 立 0 / 空中 14 /
      // 扑击 4..6(+3 空中=7..9)；state1 归位飞行与 state5 追离不更新 = 冻结
      // （原版同语义——旧 age/8 匀速兜底扫遍 15 帧 = 扑击窗仍换跑图,M2 清偿）
      frame = Math.min(this.pirFrame, Math.max(0, frames - 1));
    } else if (this.projId >= 833 && this.projId <= 835) {
      // ★BJ704-G1 债③：沙漠虎状态帧通道（AI_067 flag3 帧机直写——飞行/爬高 8
      //  （834/835=10,:50818-50826/:50590-50595）/坐等 9（11）（:50284-50288）/
      //  步行 立 0·走带 2-7（2-9）·空中 1（9）（:52005-52048,tigerFrameTick）。
      //  旧 age/8 匀速兜底扫遍 10/12 帧带（含坐等/飞行专属帧）= BJ703-A 登记债②③,
      //  随帧机通道退役;projFrames 833=10/834=12/835=12（Main.cs:8789-8791））
      frame = Math.min(this.tigerFrame, Math.max(0, frames - 1));
    } else if (this.projId === 951) {
      // 小雪怪（AI_067 flag5 帧段直写,BJ435）：地面 :51766-51790 立 0/走 2-11/空中 1;
      // 飞行 :50761-50772 每 4t 走 2-11 循环（与海盗冻结不同相）。旧 age/8 匀速兜底
      // 扫遍 12 帧 = 空中仍换跑图,随 AI 正轨退役
      frame = Math.min(this.flinFrame, Math.max(0, frames - 1));
    } else if (this.projId === 266) {
      // ★BJ517③（2026-10-05）：266 分相帧机直写（AI_026 :65464-65500 空中 5t 循环
      //  1-7/地面 8t 0·5·6·7 + 返程 :62434-62444 6t 循环 8-11,projFrames=12
      //  Main.cs:8751——MINION_FRAMES[266] 匀速 5t×8 帧近似退役）
      frame = Math.min(this.sl266Frame, Math.max(0, frames - 1));
    } else if (this.projId >= 191 && this.projId <= 194 && this.a026RetFrame >= 0) {
      // ★BJ517②（2026-10-05）：俾格米返程飞行帧（:61623-61627 frame<12 →
      //  rand(12,18) 掷后冻结——per-type 帧链无 flag6 项无推进）。
      frame = Math.min(this.a026RetFrame, Math.max(0, frames - 1));
    } else if (this.projId >= 191 && this.projId <= 194 && this.a026F6Frame >= 0) {
      // ★BJ518②（2026-10-05）：俾格米地面态帧机直写（:64660-64726 攻击 1-3/静立 0/
      //  步行 5-10/空中 4）——a026RetFrame=−1（地面态交还）时消费;旧 age/8 匀速兜底
      //  对地面态退役
      frame = Math.min(this.a026F6Frame, Math.max(0, frames - 1));
    } else if (this.s53Frame >= 0
      && (this.projId === 308 || this.projId === 377 || this.projId === 966)) {
      // ★BJ517⑧（2026-10-05）：aiStyle 53 哨兵帧机直写（AI_053_FrostHydra——birth
      //  377=4/966=0 + 扇区机 :38053-38078 + 奇帧回落 :38098-38103;projFrames
      //  308=10 Main.cs:8711/377=9 :8760/966=3 :8843——旧 age/8 匀速兜底扫遍非姿帧
      //  对三型退役）
      frame = Math.min(this.s53Frame, Math.max(0, frames - 1));
    } else if (this.projId === 864) {
      // ★BJ632（2026-10-10）刃杖恒帧 0：AI_169_Smolstars 全函数零 frame 写
      //  （Projectile.cs:46559-46725 亲读扫描）→ proj.frame 出生后恒 0（projFrames[864]=2
      //  Main.cs:8804 只是贴图布局声明）——帧 1 = 纯白模（贴图 18×64 下半 340/340 全白,
      //  帧 0 = 暗刃 avgRGB(87,63,116)）仅作辉光层（Main.cs:31395-31403 value18.Y+=Height
      //  4 份旋转 A/4,GetFloatingDaggerMinionGlowColor 蓝紫循环色）。旧通用兜底
      //  age/8 % 2 令主精灵每 8t 切白帧 = 用户实报「一直闪白」（探针 BJ632-D 白块率
      //  0↔0.108 方波半周期≈8t 吻合）。辉光层本仓未实现 = 伴生登记债（见下注）。
      frame = 0;
    } else if (this.projId === 758 && this.frFrame >= 0) {
      // ★BJ635：吸血蛙状态帧通道（AI_067 flag6 四带机 :51718-51762——frogFrameTick
      //  每拍直写;旧 age/8 匀速兜底扫遍全 24 帧带=BJ632 债）
      frame = this.frFrame;
    } else if (this.projId === 1119) {
      // ★BJ635：禁戒魂灵状态帧通道（AI_206 :38293-38324 待机带随机滞帧+攻击带——
      //  fmFrame 每拍直写;旧 age/8 匀速兜底=BJ632「1119 状态帧」债）
      frame = this.fmFrame;
    } else if (this.projId === 759 && this.bbFrame >= 0) {
      // ★BJ635：雀宝宝栖息/瞬移拍 frame=4（AI_158 :49751/:49820 projFrames-1=4
      //  静止档,逐一拍——AI 头清 -1 后回归 MINION_FRAMES[759] 0-3 循环）
      frame = this.bbFrame;
    } else if ((this.projId === 387 || this.projId === 388) && this.twFrame >= 0) {
      // ★BJ635：388 冲刺快帧通道（AI_066 :30160-30166 2t/帧 cap 2——extraUpdates=1
      //  子步机直写;常态 4t 三帧循环由 MINION_FRAMES 表承接）
      frame = this.twFrame;
    } else if (this.projId === 533 && this.dFrame >= 0) {
      // ★BJ635：致命球状态帧通道（AI_066 :30190-30620 蓄力 num533 表/冲刺定帧
      //  5/13/17/待机三态分相——MINION_FRAMES 三帧近似退役,dFrame 全态直写）
      frame = this.dFrame;
    } else if (MINION_FRAMES[this.projId]) {
      // 帧表族（源码各 AI 提取）：每帧 tick 循环帧表；
      // 小鬼 375 攻击帧门 = ai[1]∈(0,24)（:66910-66913——a62A1 冷却计数器直读,
      // 曾用 attackFlash 接触闪近似）；余族 attackFlash（接触闪）
      const [tickPer, count, atkOff] = MINION_FRAMES[this.projId];
      frame = Math.floor(this.age / tickPer) % count;
      if (atkOff && (this.projId === 375
        ? (this.a62A1 > 0 && this.a62A1 < 24) : this.attackFlash > 0)) frame += atkOff;
    } else if (this.projId === 1094 || this.projId === 1113) {
      // 火绒狐帧态机（AI_026 flag8 帧段 :64729-64826 折算,foxAnimTick 每 tick 维护）。
      // 贴图 = 6 列×9 行网格（1457 Main.cs:33734-33737 X=(frame/9)*64、
      // Y=(frame%9)*46、62×44）——切片在 Arrow PROJ_GRID,projFrames 表无此二型
      frame = this.foxFrame;
    } else {
      frame = frames > 1 ? Math.floor(this.age / 8) % frames : 0;
    }
    const img = dFrameImg(this.projId, frame);
    // ---- ★BJ687 face③（2026-10-16 用户实报「血红法杖蝙蝠效果不对,移植版=当前效果」
    //      +原版截图 130 对拍三面定谳）755 光照域整支改道全亮队列：
    //      · 残影 :31188 = AI_156_GetColor()=Crimson(220,20,60) 硬编码【替换】光照色
    //        （不读格光）——旧画世界层被 compositeLight 全屏乘（含蝙蝠自身 Crimson
    //        CastLight :52441）→ 残影暗红;
    //      · 四向红晕 :31440-31450 = 同 Crimson A=120,原版层序在【本体前】（:31440
    //        属链首块、本体走链尾通用绘制）——旧仓叠本体后=红纱洗白本体+层序反双偏;
    //      · 本体 GetAlpha 专支（Projectile.cs:80790 `Lerp(newColor,White,0.75)`)=
    //        75% 增白,语义=抵消自体 Crimson 施光对自身像素的染红（无此支本体被
    //        自光乘成暗红团——探针 _bj687 弧中程实测本体最亮像素 L=45 RGB(102,13,60)
    //        vs 原版截图 130 本体 L≈248 近白,六簇白心恒在绯红带下缘=层序+增白双证）。
    //      修=755 整支（残影+红晕+本体）收编 queueProjFullbright（BJ-C1 F3/270/45/
    //      BJ682 630 判例,光照合成后主画布重放）：本体 tint=Lerp(lightAt,White,0.75)
    //      16 级量化烘焙（630 同式,满光/fullbright 跳过）;残影/红晕纯 Crimson 恒亮。
    //      无队列环境（测试/mock）回退通用路径（世界层乘光=旧行为,零回归）。
    //      层序登记债：全亮槽画在玩家/世界之上（270/45/BJ504 同槽惯例）。
    //      ★锚位注：原版本体=通用尾绘 num151/152=0 → 帧左上锚盒左上（内容心
    //      (18,10) → 盒心+(13,5)）;本仓未登记随从走盒心居中（else 支既有惯例,
    //      755 同槽）——按 (17,11) 锚差维持仓内惯例,原版精确锚另立登记债
    //      [bj687-755-anchor-topleft]（全域未登记随从普查面,非 755 独有）。
    if (this.projId === 755 && img) {
      const sinkB = (r as unknown as {
        queueProjFullbright?: (fn: (c: CanvasRenderingContext2D) => void) => void;
        lighting?: { lightAt(tx: number, ty: number): [number, number, number] } | null;
        fullbright?: boolean;
        tintSliceRGB?: (img2: ImageBitmap | HTMLImageElement | HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number,
          rgb: [number, number, number], alphaMul: number) => HTMLCanvasElement | null;
      });
      if (typeof sinkB.queueProjFullbright === 'function') {
        const cx0 = this.cx, cy0 = this.cy;
        const rot0 = this.rot;
        const face0 = this.facing < 0 ? -1 : 1;
        const w0 = this.w, h0 = this.h;
        const ring0 = this.ghostRing ?? null;
        const vxLen0 = Math.hypot(this.vx, this.vy);
        const who0 = Math.max(0, this.whoAmI);
        const gRaw755 = projSprite(755);
        const gimg755 = gRaw755 && dyeVid > 0
          ? (dyedProjCanvas(gRaw755, 0, 0, gRaw755.width, gRaw755.height, dyeVid, dyeOpt) ?? gRaw755)
          : gRaw755;
        const frames755 = projFrameCount(755);
        const bodyAlpha755 = this.alphaFade > 0 ? Math.max(0, (255 - this.alphaFade) / 255) : 1;
        const frame755 = frame;
        // 本体 tint = Lerp(lightAt, White, 0.75)（GetAlpha :80790 逐字;light 先 16 级
        // 量化再 lerp,630 同式;满光/fullbright → null=直画原帧）
        let bodyTint: [number, number, number] | null = null;
        if (!sinkB.fullbright && sinkB.lighting) {
          const lc = sinkB.lighting.lightAt(Math.floor(cx0 / 16), Math.floor(cy0 / 16));
          const q16 = (v: number) => Math.round(Math.min(255, v ?? 255) / 255 * 15) / 15;
          const tint = [0.75 + 0.25 * q16(lc[0]), 0.75 + 0.25 * q16(lc[1]), 0.75 + 0.25 * q16(lc[2])] as [number, number, number];
          if (tint[0] < 0.999 || tint[1] < 0.999 || tint[2] < 0.999) bodyTint = tint;
        }
        sinkB.queueProjFullbright((c: CanvasRenderingContext2D) => {
          // ① 残影（:31134 循环,纯 Crimson,先于红晕/本体——原版链首块序）
          if (ring0 && gimg755 && gimg755.width > 0) {
            drawProjGhosts(c, {
              ring: ring0, id: 755, tex: gimg755, frames: frames755, frame: frame755,
              bodyW: w0, bodyH: h0, bodyRot: rot0, bodyScale: 1, bodyAlpha: bodyAlpha755,
              ai0: 0, ai1: 0, timeLeft: 3600, opacity: 1, vxLen: vxLen0,
              spriteDirection: face0, whoAmI: who0,
              // ★BJ703-B D1：dir 基底=本体当前翻转（:31336-31344 dir ^ oldSpriteDir
              //  ——755 每拍写 spriteDirection,face0 即其值,拍间转向槽镜像随 XOR 翻）
              mirror: face0 < 0,
            });
          }
          c.save();
          c.imageSmoothingEnabled = false;
          // ② 四向红晕（:31440-31450,Crimson A=120,【本体前】=原版层序翻正）
          const halo755 = tintFrameCache(img, 'rgb(220,20,60)');
          if (halo755) {
            c.save();
            c.translate(cx0, cy0);
            if (rot0 !== 0) c.rotate(rot0);
            if (face0 < 0) c.scale(-1, 1);
            c.globalAlpha = (120 / 255) * bodyAlpha755;
            for (let k = 0; k < 4; k++) {
              const off = rot0 + (Math.PI / 2) * k;
              c.save();
              c.translate(Math.cos(off) * 2, Math.sin(off) * 2);
              c.drawImage(halo755, -halo755.width / 2, -halo755.height / 2);
              c.restore();
            }
            c.globalAlpha = 1;
            c.restore();
          }
          // ③ 本体（GetAlpha :80790 = Lerp(light,White,0.75) 量化烘焙;满光直画）
          {
            let src755: CanvasImageSource = img;
            if (bodyTint && sinkB.tintSliceRGB) {
              src755 = sinkB.tintSliceRGB(img, 0, 0, img.width, img.height, bodyTint, 1) ?? img;
            }
            c.translate(cx0, cy0);
            if (rot0 !== 0) c.rotate(rot0);
            if (face0 < 0) c.scale(-1, 1);
            if (bodyAlpha755 < 1) c.globalAlpha = bodyAlpha755;
            c.drawImage(src755, -img.width / 2, -img.height / 2);
          }
          c.restore();
        });
        return;
      }
      // 无队列 → 落通用路径（世界层,旧行为）
    }
    // ---- ★BJ235 随从通用残影（Main.cs:30609-31400 通用表;原版残影块先于本体绘制）——
    //      533 致命球（ai0 三态冲刺档 :31084-31098,dA0 直喂）/ 755 血蝙蝠（Crimson 特支
    //      :31190-31192）/ 833-835 沙漠虎（速度染+底心锚帧门 :30706-30721/:31307-31314）。
    //      ghostRing 非空才有记录式——其余随从 id mode=-1 短路零开销。 ----
    if (this.ghostRing) {
      const gRaw = projSprite(this.projId);
      const gimg = gRaw && dyeVid > 0
        ? (dyedProjCanvas(gRaw, 0, 0, gRaw.width, gRaw.height, dyeVid, dyeOpt) ?? gRaw)
        : gRaw;   // 残影整片染（渐变族 T0 相位近似,登记债）
      if (gimg && gimg.width > 0) {
        drawProjGhosts(ctx, {
          ring: this.ghostRing,
          id: this.projId,
          tex: gimg,
          frames: projFrameCount(this.projId),
          frame,
          bodyW: this.w, bodyH: this.h,
          bodyRot: this.rot,
          bodyScale: 1,
          bodyAlpha: this.alphaFade > 0 ? Math.max(0, (255 - this.alphaFade) / 255) : 1,
          ai0: this.projId === 533 ? this.dA0 : 0,
          ai1: 0,
          timeLeft: 3600,
          opacity: 1,
          vxLen: Math.hypot(this.vx, this.vy),
          spriteDirection: this.facing >= 0 ? 1 : -1,
          whoAmI: Math.max(0, this.whoAmI),   // ★BJ650件1 返工：槽位快照消费（:80377 whoAmI%6;余 id 不读）——旧 this.id=全实体计数器档位漂移（字段注）
          // ★BJ703-B D1：dir 基底（755 无队列回退路径与专属支同相;833-835 虎走本
          //  通用支——AI_067 spriteDirection 写位 facing 同源;533/864 原版零写位
          //  =无基底=恒不翻,原 facing 基底假翻已随记录面收编一并退役）
          mirror: MinionProj.GHOST_FLIP_DIR.has(this.projId) && this.facing < 0,
        });
      }
    }
    // ---- ★BJ669（2026-10-13 用户实报「影子在刃背后,不是刃前面+错位」定谳刀）：
    //      864 刃杖辉光 4 份白模旋转（Main.cs:31395-31403 亲读 1:1）——【层序翻正】：
    //      原版本支在【本体前】（:31395 → :31578 本体）= 影子画在刃背后、刃身不透明
    //      域全遮辉光（用户图 115 原版物证=刃后淡影）。旧 BJ650件1 走 pushGlowOps
    //      'over' 逃逸队列=合成后冲刷叠本体顶（层序反+「暗处保发光 vs 层序二取一」
    //      当时取前者）——用户拍板按原版层序。★BJ669b：免光的光地板伴生刀已回退
    //      （用户对照截图 117 炸出环境亮斑——弹覆盖格光抬满把背景墙一起照亮,而
    //      原版 GetAlpha 恒白=只免自身压暗、不照亮环境,AI_169 零 AddLight）——
    //      本体/辉光/残影回世界层乘光,暗处偏暗=登记债 [bj669-864-luminous-channel]。
    //      色式不变（GetFloatingDaggerMinionGlowColor :80377-80381:hue=0.66+0.33×
    //      (whoAmI%6)/6 六档蓝→品红、s=0.7/l=0.6、×0.7f 逐字节截断【★清偿 C1=R5-F1：
    //      实现=xnaColorMulByte Math.trunc 单源,旧 Math.round 中点档 +1 退役】、
    //      A=(byte)178/4=44）;
    //      源矩形 = value18（rectangle4.Y+=Height=帧 1 纯白模）;位 = Center+(0,gfxOffY)
    //      + rot 单位向 .RotatedBy(π/2·k)×2（世界系四向;dir 只翻贴图不翻位——
    //      XNA SpriteEffects 语义）;rotation/origin(帧心)/scale=1 同本体支。
    //      【XNA 预乘双笔分解】（drawProjGhosts 864 档同式,One/InvSrcAlpha）：
    //      dst' = tex.rgb×C.rgb + dst×(1−tex.a×C.a) —— C.rgb=hsl×0.7 档（A=44 不进
    //      rgb 面）→ cut 笔黑染 ga=44/255（A 衰减面）+ add 笔 rgb 染 'lighter' ga=1
    //      （rgb 贡献面,透明域贡献 0 保形）。染色对=whoAmI%6 六档惰性缓存
    //      （glow864TexPair,一次性烘 12 张 18×32 微画布）。 ----
    if (this.projId === 864) {
      const sheet864 = projSprite(864);
      if (sheet864 && sheet864.height >= 64) {
        const fh864 = Math.floor(sheet864.height / 2);        // projFrames[864]=2（Main.cs:8804）
        const hueK = Math.max(0, this.whoAmI) % 6;            // :80378（★BJ661 返工：槽位快照）
        const rgb864 = hslToRgb255(0.66 + 0.33 * (hueK / 6), 0.7, 0.6);
        const a864 = Math.trunc(Math.trunc(255 * 0.7) / 4);   // (byte)178 → /4=44（byte 整除）
        const pair864 = glow864TexPair(hueK, rgb864);
        if (pair864) {
          for (let k = 0; k < 4; k++) {
            const ang = this.rot + (Math.PI / 2) * k;         // rot 单位向 .RotatedBy(π/2·k)
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.translate(this.cx + Math.cos(ang) * 2, this.cy + Math.sin(ang) * 2);
            ctx.rotate(this.rot);                             // rotation 同本体支
            if (this.facing < 0) ctx.scale(-1, 1);            // dir 镜像（贴图空间）
            ctx.globalAlpha = a864 / 255;
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(pair864.cut, -sheet864.width / 2, -fh864 / 2);   // origin8=帧心
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(pair864.add, -sheet864.width / 2, -fh864 / 2);
            ctx.restore();
          }
        }
      }
    }
    // ---- ★三轮蓝队 F5①：爆炸烈焰塔 663/665/667 半帧专绘（Main.cs:34075-34086）----
    // 原版帧内是【左右两半镜像塔身】（rectangle23.Width/=2 后按 ai[2] 选半——ai[2]==1
    // 哨兵背包携行态取右半,已接,见下方 sx）；锚 = Bottom 系：
    // draw pos=BoxBottom、origin=(半宽/2, 半高−4) ⇒ 贴图底 4px 探出盒底。旧通用路径
    // 以整宽帧(74/96/92px)从盒顶左落锚=双影横排+整体偏下（放大前后视觉差最重一档）。
    if (this.sentry && FLAMEBURST_TOWER.has(this.projId)) {
      const sheet = projSprite(this.projId);
      if (sheet) {
        const framesN = Math.max(1, frames);
        const fh = sheet.height / framesN;
        const halfW = Math.floor(sheet.width / 2);
        // 帧内左右两半镜像塔身：ai[2]==0 取左半、==1（哨兵背包携行）源矩形 X 右移
        // 半宽取右半（Main.cs:34080-34083 `rectangle23.Width /= 2; if (ai[2]==1f)
        // rectangle23.X += rectangle23.Width;`——此前携行不建模恒取左半）
        const sx = this.carriedByBackpack ? halfW : 0;
        const sy = Math.round(frame * fh);   // 与 projFrameImg round 语义同源
        const dsub = dSheetSub(sheet, sx, sy, halfW, fh);
        ctx.save();
        if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
        // 炮向翻转：AI_130 首帧 direction=spriteDirection=player.direction（:69340）——
        // 原版由 SpriteEffects 镜像；本仓 scale(-1,1) 绕锚镜像,源半恒取左半
        ctx.translate(this.cx, this.cy + this.h / 2);
        if (this.facing < 0) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false;
        if (dsub !== sheet) ctx.drawImage(dsub as CanvasImageSource,
          0, 0, halfW, fh,
          -halfW / 2, -(fh - 4), halfW, fh);              // origin=(半宽/2, 半高−4)
        else ctx.drawImage(sheet as CanvasImageSource,
          sx, sy, halfW, fh,
          -halfW / 2, -(fh - 4), halfW, fh);              // origin=(半宽/2, 半高−4)
        ctx.restore();
        // ★R15-F1（2026-10-11 C15 清偿）：火爆塔辉光四向脉动叠层（Main.cs:34426-34445
        //  DrawProjDirect 663/665/667 支,BJ625件3 旧「663 零缺面」判谳翻正）。原版
        //  rectangle23 已在本支 :34077-34082 半宽化 → 辉光与本体同矩形（sx 同携行选半）;
        //  num434 = cos(localAI[0]/100·2π)+1 ∈ [0,2]（:34430,sPulseT 镜像）;色 =
        //  (140,100,40,0)×(num434/4+0.5)——A=0 纯加法（XNA α=0 习语,不取光照=自发光）
        //  → pushGlowOps 'add' 逃逸队列（BJ625件3 同判例）;4 份 offset=(k·π/2)×num434
        //  世界系（右/下/左/上,不随 dir 镜像——XNA SpriteEffects 只翻贴图不翻位置）;
        //  锚/origin/rotation/scale 同本体支（vector99=Bottom、origin32=(半宽/2,半高−4)、
        //  :34444 同矩形同参,facing<0 镜像沿本体同轴）。携行态照画（:34426 无 ai[2] 门）。
        const ga = flameburstGlowTintAlpha(this.sPulseT);
        const glowTexF = `vanilla/Glow_${FLAMEBURST_GLOW_MASK[this.projId]}.png`;
        const rad = flameburstGlowRadius(this.sPulseT);                   // num434 = cos(θ)+1
        const gaT = ga.tint;
        const fadeF = this.alphaFade > 0 ? Math.max(0, (255 - this.alphaFade) / 255) : 1;
        for (let k = 0; k < 4; k++) {
          const ang = k * (Math.PI / 2);
          const offX = Math.cos(ang) * rad, offY = Math.sin(ang) * rad;
          ctx.save();
          ctx.translate(this.cx + offX, (this.cy + this.h / 2) + offY);   // vector99+offset
          if (this.facing < 0) ctx.scale(-1, 1);                          // dir 镜像沿本体轴
          r.pushGlowOps?.([{
            tex: glowTexF,
            sx, sy, sw: halfW, sh: fh,                                    // 同矩形（携行选半）
            dx: -halfW / 2, dy: -(fh - 4),                                // origin 同本体
            blend: 'add', tint: gaT, alpha: ga.alpha * fadeF,
          }], ctx.getTransform());
          ctx.restore();
        }
        return;
      }
    }
    // ---- ★T9（2026-09-01）：弩车族 677/678/679 专绘（Main.cs:34097-34137 1:1，
    //      锚/origin 缺省 = :33695/:33787、dir 缺省 = :30529-30532、公共尾绘 :34212）----
    // 原版本族 = 塔座 Extra_83/84/85 + 本体帧两贴图叠绘；分支头 `dir ^=
    // FlipHorizontally | FlipVertically`（:34099-34103）即 B2γ 登记的「双轴镜像背面
    // 朝向」正身：
    //  · dir 组合：缺省 None；spriteDirection==-1 先 FlipHorizontally（:30531），
    //    分支头 XOR(FlipH|FlipV) ⇒ 净 FlipVertically（1^3=2）——XNA SpriteBatch 顶点
    //    序 world = T·R(θ)·F·(p−o)（镜像先于旋转），AI_134 朝左时 rotation≈π
    //    （落位 :69614 / 待机归位 :69645）⇒ R(π)·FlipV = 纯水平镜像 + 随瞄准角
    //    连续偏转 = 「背面朝向」。canvas 同序等价：translate(anchor) → rotate(rot)
    //    → scale(1,-1)（scale 施于旋转前局部系）。旧 scale(-1,1) 单轴式仅在
    //    rot==0 时恰同净效果；rot≠0 时镜像轴错（本仓 rot 已随 T9 接 AI_134 状态机）。
    //  · 塔座（:34105-34116）：position=proj.Bottom、origin=(w/2, h−2)、rotation=0、
    //    effects = dir&FlipH【两侧恒 None】⇒ 塔座永不镜像；ai[2]==1（哨兵背包
    //    携行）不画——本仓 carriedByBackpack 承接。
    //  · 本体帧（:34117-34126 + 公共尾 :34212）：anchor = center+(0,+3)
    //    （vector99.Y++、+=2；678 再 −4 / 679 再 −2）；origin = (fw/2 + ToDirectionInt(
    //    dir&FlipH≠0)=−1 恒 [, 679 再 ×4 同式 −4], fh/2 [仅 679：非翻转侧 +4 /
    //    翻转侧 −4，:34130-34134——垂直镜像绕 origin 翻转,±4 反补维持塔身贴地]),
    //    rotation=proj.rotation、effects=dir。proj.scale=1（SetDefaults 无改）。
    //  · F5① 折算表 [−29,−49]（PROJ_DRAW_OFFSET_DYN 677/678/679）系把本支锚误读为
    //    Bottom 系（663/691 支 :34082/:34091 才显式重置 vector99=proj.Bottom；本支
    //    继承 :33695 的 Center 缺省）⇒ 旧绘整体偏低 fh/2−bh−3=27px 且缺塔座,
    //    本专绘替代（三表项退役,WeaponProj 侧注同）。
    if (this.sentry && BALLISTA_TOWER.has(this.projId)) {
      const sheet = projSprite(this.projId);
      if (sheet) {
        const framesN = Math.max(1, frames);
        const fh = sheet.height / framesN;               // 56（projFrames[677/678/679]=6）
        const fw = sheet.width;                          // 124/140/142
        const flipV = this.facing < 0;                   // dir 净 FlipVertically（①）
        let ay = 3;                                      // vector99.Y++、+=2（:34119-34121）
        if (this.projId === 678) ay += -4;               // :34122-34123
        if (this.projId === 679) ay += -2;               // :34125
        let ox = fw / 2 - 1;                             // Size/2 + ToDirectionInt(恒假)=−1（:34127）
        let oy = fh / 2;
        if (this.projId === 679) {
          ox -= 4;                                       // :34136 同式 ×4
          oy += flipV ? -4 : 4;                          // :34130-34134
        }
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
        // ② 塔座（先画,本体叠其上）：Bottom 系底心锚（gfxOffY 恒 0,塔不入水）
        if (!this.carriedByBackpack) {
          const baseTex = r.atlas?.ensureVImage(
            `vanilla/Extra_${this.projId === 678 ? 84 : this.projId === 679 ? 85 : 83}.png`) ?? null;
          if (baseTex) {
            const by = this.y + this.h;                  // proj.Bottom
            ctx.translate(this.cx, by);
            ctx.drawImage(baseTex as CanvasImageSource, -baseTex.width / 2, -(baseTex.height - 2));
            ctx.translate(-this.cx, -by);
          }
        }
        // ③ 本体帧：anchor=center+(0,ay)、rotate(rot)、镜像=scale(1,−1)（FlipV）
        ctx.translate(this.cx, this.cy + ay);
        ctx.rotate(this.rot);
        if (flipV) ctx.scale(1, -1);
        const fimg = dFrameImg(this.projId, frame);
        if (fimg) ctx.drawImage(fimg as CanvasImageSource, -ox, -oy);
        else ctx.drawImage(sheet as CanvasImageSource, 0, Math.round(frame * fh), fw, fh,
          -ox, -oy, fw, fh);
        ctx.restore();
        return;
      }
    }
    // ---- ★BJ606（2026-10-10,用户 F3 复报定谳落刀）：688-690 闪电光环哨兵专绘
    //      （Main.cs:32481-32527 1:1;1456 :31680-31726 同式）----
    //  原版本支：本体帧 position=proj.Top（盒顶心）、origin=帧顶心（Size×(0.5,0),
    //  :32486/:32497）——「悬空球体」哨兵（球悬基地上空 H/2=4~10 格,wiki 同证）,
    //  非落地塔;底座 Extra_86/87/88 position=proj.Center（盒心=地面接触点）、
    //  origin=(宽/2,高−2)（:32516-32521 origin.Y-=2）,ai[2]==1（哨兵背包携行）不画。
    //  rotation 恒 0（AI_137 零写向）、spriteDirection 恒 +1（零赋值）=不翻转。
    //  projFrames 688/689=6、690=8（Main.cs:8603-8605）,帧机 8t 一翻（:70018-70024）
    //  =通用 age/8 循环既恰。glow 叠画（Glow_228/229/230 同矩形 A=127）★BJ625件3
    //  已接（上支,合成后逃逸+绘制侧取光）。★663/677/691 族逐型核【判谳订正】
    //  （R15-F1/F2 复核,2026-10-11 推翻 2026-10-10「三族零缺面」旧谳）：677（弩车）
    //  确系零缺面——本体+塔座两笔 plain 光同构等价,原版本支无 glow 层;但 663
    //  （火爆塔）与 691（爆炸机关）旧谳漏核 DrawProjDirect 后段专支——663 辉光
    //  四向脉动（:34426-34445,localAI[0] 300t 驱动）与 691 白 A=127 辉光（:34507-
    //  34521）均为字面色自发光叠层（不取光照、非 plain 光链）,旧「只改锚/origin
    //  +底座」核面只扫了 :34075-34137 锚段未扫 :34400+ 色段=定谳不完整。两缺面
    //  已于 C15 清偿（FLAMEBURST/TRAP 绘制支 pushGlowOps,见各支注）;本仓世界层
    //  合成乘光对 677 本体+塔座=同构等价维持（「同未接」记法指 per-proj 光照色
    //  通道,对 677=无歧义等价面,非债）。
    //  旧通用尾 off3=[0,0] 帧左上锚盒左上 ⇒ 盒挂贴图左上+球体陷地（用户实报）。
    if (this.sentry && AURA_TOWER.has(this.projId) && img) {
      // ★BJ630件1（2026-10-10）本体/底座光照色通道（BJ625 定谳残面收口）：原版本支
      //  三笔【同色】（Main.cs:32481-32527）——color73 = Color.Lerp(proj.GetAlpha(
      //  projectileColor), White, 0.5)（:32497 本体/:32524 底座同式）、color74 =
      //  color73 截 A=127（glow :32498-32499）;projectileColor = proj 中心 tile 光照
      //  （:30068）。本仓世界层合成乘光管线下本体/底座吃 plain 光 → 暗处比原版暗
      //  50%（暗处 net = light×1.0 vs vanilla light×0.5+0.5,BJ625 定谳;glow 半亮
      //  自发光已落 → 反差更显）。落刀 = 三笔全数 op 化进 itemGlowQueue 同槽（BJ621
      //  迁层习语：免世界层乘光目标进合成后逃逸队列;BJ625件3 glow 同槽判例）,绘制
      //  色显式 = auraGlowTint(lightAt(中心 tile)) 逐值 1:1。queue 序 = 原版笔序
      //  （本体 :32503 → glow :32505-32507 → 底座 :32522）;alphaFade 淡入淡出乘区
      //  三笔同乘（旧 world 层 globalAlpha 面迁 op alpha）。染料面：688-690 哨兵
      //  Shader 恒 0（BJ625件4 定谳）→ img 恒原片帧切片,op 直取 Projectile_N 平行
      //  表同矩形（sy=frame×fh）等价。灯未就绪回退 [255,255,255]=全光档（tint=白
      //  → flush needBake/needBoost 双免=直画）。仅 688-690 三型进通道（663/677/691
      //  已判零缺面 plain 光同构等价,勿扩——见上支注）。
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.translate(this.cx, this.y);                    // proj.Top（gfxOffY 恒 0 未建模）
      if (this.rot !== 0) ctx.rotate(this.rot);          // 守恒序（恒 0 不触发）
      const lt = r.lighting?.lightAt
        ? r.lighting.lightAt(Math.trunc(this.cx / 16), Math.trunc(this.cy / 16))
        : [255, 255, 255];
      const fade = this.alphaFade > 0 ? Math.max(0, (255 - this.alphaFade) / 255) : 1;
      const tint = auraGlowTint([lt[0], lt[1], lt[2]]);  // color73 RGB 面（三笔同式）
      const gm = auraGlowMaskOf(this.projId);
      const auraOps: Array<{
        tex: string; sx: number; sy: number; sw: number; sh: number;
        dx: number; dy: number; blend: 'add' | 'over'; tint: [number, number, number]; alpha: number;
      }> = [
        {
          tex: `vanilla/Projectile_${this.projId}.png`,  // ① 本体帧（:32503 color73 A=255）
          sx: 0, sy: frame * img.height, sw: img.width, sh: img.height,
          dx: -img.width / 2, dy: 0,                     // origin=(帧宽/2, 0) 同旧绘
          blend: 'over', tint, alpha: fade,
        },
      ];
      if (gm !== null) {                                 // ② glow（:32505-32507 color74 A=127）
        auraOps.push({
          tex: `vanilla/Glow_${gm}.png`,
          sx: 0, sy: frame * img.height, sw: img.width, sh: img.height,
          dx: -img.width / 2, dy: 0,                     // origin=(帧宽/2, 0) 同本体
          blend: 'over', tint, alpha: AURA_GLOW_ALPHA * fade,
        });
      }
      r.pushGlowOps?.(auraOps, ctx.getTransform());      // 矩阵捕获=translate/rotate 后（rot 恒 0）
      ctx.restore();
      // ★BJ625件4 翻案登记（2026-10-10,推翻 BJ606-R2「底座染料未接」登记）：原版
      //  GetProjectileDesiredShader（Main.cs:22429-22463）只吃 minion/projHook/
      //  projPet/LightPet+switch{623,1020,1105,818}——688-690 SetDefaults（Projectile.cs:
      //  7327-7339）只有 sentry=true 无 minion=true（全 21 处 minion=true 站点逐一对读,
      //  无一哨兵;projPet 表全量 90 id 无 688-690）⇒ 哨兵 Shader 恒 0=原版本就不染,
      //  本仓底座 Extra_86/87/88 原色直绘=vanilla 同相（染=偏离）。本仓
      //  minionDyeVid（minion=false 数据面）同构回 0=双面一致。
      if (!this.carriedByBackpack) {                     // ai[2]!=1f 门（:32514）
        const baseTex = r.atlas?.ensureVImage(
          `vanilla/Extra_${this.projId === 689 ? 87 : this.projId === 690 ? 88 : 86}.png`) ?? null;
        if (baseTex) {
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.translate(this.cx, this.cy);               // proj.Center（:32515）
          r.pushGlowOps?.([{                             // ③ 底座（:32522 color73 A=255）
            tex: `vanilla/Extra_${this.projId === 689 ? 87 : this.projId === 690 ? 88 : 86}.png`,
            sx: 0, sy: 0, sw: baseTex.width, sh: baseTex.height,
            dx: -baseTex.width / 2, dy: -(baseTex.height - 2),   // origin=(宽/2, 高−2)（:32521）
            blend: 'over', tint, alpha: fade,
          }], ctx.getTransform());
          ctx.restore();
        }
      }
      return;
    }
    // ---- ★BJ582②（2026-10-09,用户实报「原版的贴图还有三个气球」定谳落刀）----
    // 1025 藤堡专绘（Main.cs:34959-34999 1:1）——悬浮态（ai[0]==0 ⇔ sAttach==0
    // 且非携行;携行支首拍 AI_197_HandleTileCollision 置 ai[0]=1 :41093-41095）
    // 在本体上方绘【三气球】=NPC_594（WindyBalloon,Frame(8,1,·) 8 列×32px×76 高）：
    // 列 2/5/7（:34972 `1 + switch{1→4,0→1,_→6}`）、锚 = 盒心+(0,−10+bob)
    // （vector124 :34968）、origin=气球【底心】(16,76)（:34974,origin.Y=帧高+
    // (num151−22),num151=22 :30097 → 净 (w/2,h)）、初始摆角 +π/9/0/−π/9
    // （:34976-34978）+ 摆动 ±0.025rad（num484=misc%75/75 相位,中球 sin/侧球 cos
    // :34979-34983）。bob = sin(misc%100/100·2π)·2（num483 :34962-34967）——气球锚
    // 与本体同受（本体绘制位 Y +num483 :34996）。本体 = 帧切片全帧(0,y25,46,62)、
    // 绘制位=(pos.X+num153+num152, pos.Y+h/2+num483)、origin=(num153, h/2+22)
    // （:34996-34998;num153=(texW−w)/2+w/2=texW/2=23 :30303 与通用 num145 同值、
    // num151=22 :30097 与通用 offset 表 [22,0] 同值——旧通用尾无 bob,本专绘替代）。
    // rot/翻转/drawScale 变换序与通用尾同构（携行 rot=±π/2 :70190;悬浮恒 0）。
    // 登记债：气球层未接弹幕染料通道（原版 EntitySpriteDraw×Armor.Apply 对气球
    // 同染）——染料哨兵吹泡泡时气球保持原色,登记待哨兵染料消费面扩容时补。
    if (this.projId === 1025 && img) {
      const misc26 = this.ownerRef()?.miscCounter ?? 0;    // LocalPlayer.miscCounter
      const num484 = (misc26 % 75) / 75;                   // :34962（摆动相位,75t 周期）
      const num485 = (misc26 % 100) / 100;                 // :34963（bob 相位,100t 周期）
      const bob26 = Math.sin(num485 * Math.PI * 2) * 2;    // num483（:34964-34967）
      ctx.save();
      if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
      if (this.sAttach !== 1 && !this.carriedByBackpack) {   // ai[0]==0 悬浮态（:34961）
        const bal = r.atlas?.ensureVImage('vanilla/NPC_594.png') ?? null;
        if (bal) {
          const cols26 = [2, 5, 7];                          // :34972（Frame 前列号）
          for (let k = 0; k < 3; k++) {
            const rot0 = k === 1 ? 0 : k === 0 ? Math.PI / 9 : -Math.PI / 9;   // :34976-34978
            const wig26 = (k === 1 ? Math.sin(num484 * Math.PI * 2)
              : Math.cos(num484 * Math.PI * 2)) * 0.025;                       // :34979-34982
            ctx.save();
            ctx.translate(this.cx, this.cy - 10 + bob26);    // :34967-34968（gfxOffY 恒 0）
            ctx.rotate(rot0 + wig26);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(bal as CanvasImageSource, cols26[k] * 32, 0, 32, 76,
              -16, -76, 32, 76);                             // origin=(16,76)=底心
            ctx.restore();
          }
        }
      }
      // 本体（:34996-34998）：帧左上 = (盒左, 盒顶−22+bob)——与通用路 offset [22,0]
      //  同位,唯一差 = bob 随动;变换序对齐通用尾（rotate→flip→scale）
      ctx.translate(this.cx - this.w / 2 + img.width / 2, this.cy + bob26);
      if (this.rot !== 0) ctx.rotate(this.rot);
      if (this.facing < 0) ctx.scale(-1, 1);
      if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -img.width / 2, -(this.h / 2 + 22), img.width, img.height);
      ctx.restore();
      return;
    }
    // ---- ★SW-BJ13 2026-09-07：帕鲁地面家族∪原版同支专绘（Main.cs:34788-34800 1:1）----
    // 原版本族（393-395/398/423/450/1022/1036/1093/1112/1118）不走通用 num143/144
    // 尾绘（:35567 起 = 帧左上锚盒左上）,专用支：anchor = proj.Center + (0, gfxOffY −
    // num467)（num467 = 2 缺省 / 5=1093·1112 :34794 / 9=1118 :34798）、origin =
    // (整图宽/2, 帧高/2 + num151)（num151=1 仅 1022 num151++ :30079、−4 仅 1036
    // :30091；423 的 num152=−5 :30161 本支不消费=原版死值）。展开即「帧心锚于盒心
    // 上方 num467」——精灵横居盒、帧底 = 盒底 + 4px（步行族全支一致）。
    // 旧通用路把帧左上锚盒左上 ⇒ 精灵整体右下偏：1118 (+12,+22)（盒 14×22/帧 38×48）
    // = 用户 F3 实报「盒在左上、精灵画在右下、走一步陷一步」；1093/1112 (+10,+14)、
    // 393-395 (+16,+8)、1022 (+11,+10)、423 (0,+4)、1036 (+3,0)。
    if (CENTER_ANCHOR_34788.has(this.projId) && img) {
      const num467 = this.projId === 1118 ? 9
        : this.projId === 1093 || this.projId === 1112 ? 5 : 2;
      const num151 = this.projId === 1022 ? 1 : this.projId === 1036 ? -4 : 0;
      ctx.save();
      if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
      ctx.translate(this.cx, this.cy - num467);          // gfxOffY 未建模恒 0（通用路同）
      if (this.rot !== 0) ctx.rotate(this.rot);
      if (this.facing < 0 && !MINION_NO_FLIP.has(this.projId)) ctx.scale(-1, 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -img.width / 2, -(img.height / 2 + num151));
      ctx.restore();
      return;
    }
    // ---- ★SW-BJ16 2026-09-07：33693 中心锚大支专绘（Main.cs:33693-34290,主绘 :34212）----
    // 原版本支：锚 = proj.Center + (0, gfxOffY)（:33694-33695 vector99）、帧矩形 =
    // Frame(1, projFrames, 0, frame)【帧高全高,无通用路的 num482−1 shave】（:33701）、
    // origin = 帧尺寸/2（:33787 origin32）、rotation/dir 直传（:34212）。本仓成员见
    // CENTER_ANCHOR_33703 注；通用路（:34919/:35470 = 帧左上锚盒左上+num143/144 表）
    // 对未登记型吃 [0,0] 缺省 ⇒ 本族曾整体偏右下（如 758 (fw−bw)/2=+58、613 +4）。
    // 支内改锚/改切片特例逐型照录（BJ13 警告「折算式仅适用支内无改锚者」的核验产物；
    // 任务书预计算值 758 (+58,+12)/1098 (+24,+6) 系按「无特例」折算,与源码核对后
    // 修正式为 758 (+58,+20)、1098 (+24,+8)——特例项见下）：
    //  · 758 吸血蛙（:33964-33968）：锚 Y += 盒高/2（=盒底）、origin=(帧宽/2, 帧高−4)
    //    ⇒ 精灵底 = 盒底 + 4（同族「脚微陷」恒量）
    //  · 759 雀杖（:33959-33963）：origin.Y = 帧高−2、origin.X += 翻转?+1:−1
    //    ⇒ 精灵底 = 盒心+2、横移朝向 1px（折进锚 ax）
    //  · 951 雪怪（:33942-33946）：锚 Y += 盒高/2 − 帧高/2 + 4、origin=帧心
    //    ⇒ 精灵底 = 盒底 + 4（任务书 17 型外的同支同病成员,提取器 B_33693 交集中补清）
    //  · 963 阿比盖尔（:33704-33706 + :33836-33844）：切片 = Frame(4,13,0,frame)
    //    ——4 列×13 行网格取【第 0 列】,帧 44×64（整宽竖条切片=4 倍宽错位）;锚 Y
    //    += −2 + cos(mouseTextColor 脉冲)·4——静态 −2 照录,cos 摆系全局 UI 脉冲
    //    （Main.cs:18399 mouseTextColor 三角波）本仓无全局 tick 源=登记债。
    //    ★刻意不入 Arrow.PROJ_GRID：该表语义=列主序全格积（projFrameCount=cols×rows
    //    =52）会谎报 963 帧数（原版 projFrames[963]=13,帧域恒第 0 列 0-12 行）——
    //    帧计数被 AI 帧机/钳制消费,注册即污染;故本支内手工切片。
    //  · 1098/1123 钻地龟（:33771-33773）：锚 Y −= 2
    //  · 623 守护者（:34169-34177）：ai0==2 抖动 rand.NextVector2Circular(2,2)
    //    + CurrentDrawnEntityShader==0 时 A/=2——★SW-FX6 2026-09-10 债④清偿,
    //    见下方 draw 支内实现;625-628/643/613/831/970/1119 支内无改锚（逐型核验
    //    :33693-34290 全支扫描结论,见审计文档;831/970 另有 hide 门=SW-FX6 债⑥）
    //  · 域外成员：773（WeaponProj.draw 同式接入）/1092（BookProj 已合本支语义：
    //    projFrameImg 走 PROJ_GRID[1092] 6×9 列主序 + 盒心帧心锚）
    if (CENTER_ANCHOR_33703.has(this.projId) && img) {
      const ax = this.projId === 759 ? (this.facing < 0 ? -1 : 1) : 0;   // :33960-33962
      let ay = 0;
      if (this.projId === 758) ay += this.h / 2;                          // :33965 盒底锚
      else if (this.projId === 951) ay += this.h / 2 - img.height / 2 + 4; // :33943-33945
      else if (this.projId === 963 || this.projId === 1098 || this.projId === 1123) ay += -2; // :33836/:33771
      // ★SW-BN6 2026-09-08：BJ16 债⑤清偿——963 cos 摆接线（Main.cs:33836-33844 1:1）。
      //  原版 895/896/898/963 同支：num394=2（isAPreviewDummy=0.5,本仓无预览虚影档）,
      //  vector99.Y += −num394 + cos(mouseTextColor/255·2π·2)·num394·2 —— 静态 −2 即
      //  上一行;摆项 = cos((mt/255)·4π)·4（摆幅 ±4px,三角波全周期 130t≈2.17s）。
      //  mt = 全局脉冲钟 FlickerClock.mouseTextColor（SkyColor.ts:318,190↔255 步进
      //  1/帧 = Main.cs:18399-18406 同式;经 LightingEngine.compute 每帧 tick,
      //  Game.ts:10005）——BJ16 登记「本仓无全局 tick 源」前提已过时,Renderer.lighting
      //  在实体 draw 内可达（同 Renderer.ts:3440/:14217 消费口）。灯未就绪回退 255
      //  = 摆顶（静止偏置 +2,与原版 mt=255 帧同形）。
      if (this.projId === 963) {
        const mt = r.lighting?.clock?.mouseTextColor ?? 255;
        ay += Math.cos((mt / 255) * Math.PI * 2 * 2) * (2 * 2);
      }
      const oy = this.projId === 758 ? img.height - 4                     // :33966-33967
        : this.projId === 759 ? img.height - 2                            // :33960
        : img.height / 2;
      // ★SW-FX6 2026-09-10 债④清偿：623 守护者支内特例 1:1（Main.cs:34170-34177）——
      //  ① ai0==2（攻击态）且 !gamePaused：锚 += rand.NextVector2Circular(2,2)
      //  （Utils.cs:1301-1303 = 单位向量×(2,2)×NextFloat,逐 draw 掷流）。gamePaused 门
      //  本仓 draw 侧无暂停源（暂停仍渲染）=备案;rand = draw 侧流,本仓 Math.random
      //  直映（AI 掷流既有约定同源,不进播种流）。
      //  ② CurrentDrawnEntityShader==0（常态）时 color106.A /= 2（:34175-34177）——
      //  守护者本体半透明（灵体观感,A=127/255）;折进 globalAlpha。
      let jx = 0, jy = 0;
      if (this.projId === 623 && this.gA0 === 2) {                        // :34171-34173
        const ang = Math.random() * Math.PI * 2;                          // NextVector2Unit()
        const mag = Math.random();                                        // NextFloat()
        jx = Math.cos(ang) * 2 * mag;
        jy = Math.sin(ang) * 2 * mag;
      }
      ctx.save();
      {
        // alpha 组合：出场淡入（既有）×623 A/=2（:34175-34177）×625-628 A/=2
        // （★G27③ :34180-34183 无条件支——龙链本体恒半透明灵体观感）——本地标量合成,
        // 不回读 ctx.globalAlpha（测试记录型 ctx 无 getter）
        let bodyAlpha = this.alphaFade > 0 ? Math.max(0, (255 - this.alphaFade) / 255) : 1;
        // 623：GetAlpha ×(255-alpha)/255（:45482/:45718 gAlpha——状态 3 隐身窗=0）
        // × Main.cs:34175-34177 A/=2。gAlpha=0 时因子 1×0.5 与旧式逐字节同相
        if (this.projId === 623) bodyAlpha *= ((255 - this.gAlpha) / 255) * 0.5;
        // ★BJ709-G27③（2026-10-24,BJ709-A 登记债③+邻位偏差）：625-628 龙链
        //  color106.A /= 2（Main.cs:34180-34183,无 shader 门——与 623 的
        //  CurrentDrawnEntityShader==0 门不同族,原文无条件）
        if (this.projId >= 625 && this.projId <= 628) bodyAlpha *= 0.5;
        if (bodyAlpha < 1) ctx.globalAlpha = bodyAlpha;
      }
      ctx.translate(this.cx + ax + jx, this.cy + ay + jy); // gfxOffY 未建模恒 0（通用路同）
      if (this.rot !== 0 || MINION_ROT_ONLY.has(this.projId)) {
        ctx.rotate(this.rot);
        if (!MINION_ROT_ONLY.has(this.projId) && this.facing < 0 && !MINION_NO_FLIP.has(this.projId)) ctx.scale(-1, 1);
      } else if (this.facing < 0 && !MINION_NO_FLIP.has(this.projId)) ctx.scale(-1, 1);
      // ★BJ709-G27③：本支主绘=33693 通用尾 EntitySpriteDraw(...,proj.scale,dir)
      //  （Main.cs:34212）——proj.scale 镜像=drawScale（1025 先例;龙链 AI 逐拍写
      //  1+tier×0.01=长龙放大,基础龙 1.03）。本支其余成员 vanilla 恒 scale=1
      //  （SetDefaults 无 scale 行族）→ drawScale=1 缺省零变化。
      if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);
      ctx.imageSmoothingEnabled = false;
      if (this.projId === 963) {
        // 切片 = Frame(4,13,0,frame)（:33704-33706）：第 0 列 × 第 frame 行,帧 44×64
        const sheet = projSprite(963);
        if (sheet) {
          const fh = sheet.height / 13, fw = sheet.width / 4;
          const sy9 = Math.round(frame * fh);
          const dsub = dSheetSub(sheet, 0, sy9, fw, fh);
          if (dsub !== sheet) ctx.drawImage(dsub as CanvasImageSource, 0, 0, fw, fh,
            -fw / 2, -fh / 2, fw, fh);
          else ctx.drawImage(sheet as CanvasImageSource, 0, sy9, fw, fh,
            -fw / 2, -fh / 2, fw, fh);
        }
      } else {
        ctx.drawImage(img, -img.width / 2, -oy);
      }
      ctx.restore();
      return;
    }
    // ---- ★SW-FX6 2026-09-10 债①清偿：641 月门 A 支专绘（Main.cs:33161-33166 +
    //      :33444-33467 + 主绘 :33569-33572,578/579/641/813 同块 641 支）----
    // vanilla A 支：锚 = 盒心 + gfxOffY（:33162 vector81 = position+Size/2+UnitY·gfxOffY）、
    // origin = 【整图】尺寸/2（:33165 origin24,sourceRectangle2=null 无帧切片）——
    // 本仓旧走通用路（num143/144 未登记 [0,0]）= 帧左上锚盒左上：60×60 精灵/32×32 盒
    // → 整体偏 (+14,+14)（BJ16 §4①）。:33444-33467（641 flag40=true）叠绘序列：
    //   ①Extra_50 暗环（color95=Lerp(color87,Black,.5)×num360 → RGB 减半折进 alpha
    //     的既定近似）、rot=−num340+0.35、scale=scale11=0.6+0.6·num360、dir^FlipH
    //   ②Extra_50 亮环（color87）、rot=−num340、scale=proj.scale、dir^FlipH
    //   ③本体幽灵遍（color94=×0.8·A/2 → alpha 0.4）、rot=−num340×0.7、dir^FlipH
    //   ④Extra_50 三遍（color87×0.8 → alpha 0.8）、rot=num340×0.5、scale×0.9、dir
    //   随后 color87.A=0（:33464）→ 主绘 :33571 = α0 纯加法（XNA α=0 惯用法,
    //   canvas 'lighter',同 Arrow ADDITIVE_GLOW_PROJS 族）。
    //  num360 = 0.95 + (rot·0.75).ToRotationVector2().Y·0.1 = 0.95+sin(0.75·rot)·0.1
    //  （:33449）。dir：AI_123 全支零 spriteDirection 赋值（:37726-37945 扫描）+
    //  SetDefaults 复位 1（Projectile.cs:752）→ dir≡None → ①②③恒 FlipH、④⑤恒
    //  None（不吃 this.facing——月门原版不随目标翻转）。rot 消费 this.rot（AI 侧
    //  自旋 :37742 rotation−=direction·2π/120 与 scale=Opacity :37743 本批未建模=
    //  剩债登记,r=0 时全支退化为静态环）。gfxOffY 未建模恒 0（全仓约定）。
    if (this.projId === 641 && img) {
      const ringTex = r.atlas?.ensureVImage('vanilla/Extra_50.png') ?? null;
      const num360 = 0.95 + Math.sin(this.rot * 0.75) * 0.1;               // :33449
      const scale11 = 0.6 + 0.6 * num360;                                  // :33452
      const iw = img.width, ih = img.height;
      const passes: Array<{ tex: unknown; a: number; rot: number; s: number; mirror: boolean; additive?: boolean }> = [
        { tex: ringTex, a: 0.5 * num360, rot: -this.rot + 0.35, s: scale11, mirror: true },  // :33456
        { tex: ringTex, a: 1, rot: -this.rot, s: 1, mirror: true },                          // :33457
        { tex: img, a: 0.4, rot: -this.rot * 0.7, s: 1, mirror: true },                      // :33459-33460
        { tex: ringTex, a: 0.8, rot: this.rot * 0.5, s: 0.9, mirror: false },                // :33462
        { tex: img, a: 1, rot: this.rot, s: 1, mirror: false, additive: true },              // :33571(A=0 :33464)
      ];
      for (const p of passes) {
        if (!p.tex) continue;
        const tw = (p.tex as HTMLImageElement).width, th = (p.tex as HTMLImageElement).height;
        ctx.save();
        if (p.additive) ctx.globalCompositeOperation = 'lighter';
        if (p.a < 1) ctx.globalAlpha = p.a;
        ctx.translate(this.cx, this.cy);             // 锚=盒心（:33162,债①核心）
        ctx.rotate(p.rot);
        if (p.mirror) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(p.tex as CanvasImageSource, -tw * p.s / 2, -th * p.s / 2, tw * p.s, th * p.s);
        ctx.restore();
      }
      return;
    }
    // ---- ★SW-BJ56 2026-09-10：946 泰拉棱镜专绘（Main.cs:28677-28692 派发 +
    //      DrawProj_EmpressBlade :36562-36601 全层 1:1）----
    // 旧通用路只画 scale(0.75) 本体一帧（且 rot 未减 π/2、facing 翻转误吃）=
    // 用户实报「没有光效」根源。原版本体绘制链：
    //  · num = proj.rotation − π/2（:36572,DrawProj_EmpressBlade 消费角）——AI 侧
    //    rotation 含 +π/2 补偿（AI_156_GetIdlePosition :52855 idleRotation+=π/2 /
    //    弧刀段 :52707 rotation=num24+π/2）,draw 侧 −π/2 还原刃轴。dir=SpriteEffects.None
    //    恒不翻转（AI_156 全支无 spriteDirection 写,Main.cs:36591/:36597 :36600）。
    //  · num22 色相 = IndexForVisuals % max(1,maxMinions)/max(1,maxMinions)
    //    + GlobalTimeWrappedHourly%3/3（:28681-28682）——多剑各占相位、3s 一轮循环；
    //    IndexForVisuals=key.Index（Projectile.cs:554）,本仓实体 id 同位替代。
    //  · 层序（:36574-36600,全 AlphaBlend 非加算）：①幻影 6 层（沿 −num 向每 1/6
    //    步进偏移 −120×f×lerpValue、scale×1.5、色=女皇色(A=127→63)×num2×(1−f)×num3）
    //    仅 num3>0 时可见（lerpValue=GetLerpValue(60,50,ai0)、num3=GetLerpValue(70,50)×
    //    GetLerpValue(40,45)——跃空段 ai0≥60 双 0、弧刀前段 ai0≤40 为 0）；②环晕 4 层
    //    （(f5×2π+num) 向 ×4×scale、×num2）；③本体 White×Opacity,A×0.7（:36576-36577）
    //    ——不读格光色（CurrentDrawnEntityShader=-1 后硬编码色）=暗处全亮,光照面由
    //    Renderer.SELF_LUMINOUS_PROJS 946 条目承载；④女皇色罩 ×num2×0.5（:36600）。
    //    XNA Color×float 四通道同乘 → 本仓既定近似折进 globalAlpha（641/755 支同式）。
    //  · 拖尾 = EmpressBladeDrawer.Draw（Terraria.Graphics/EmpressBladeDrawer.cs:16-33,
    //    Main.cs:28688 前置）：VertexStrip.PrepareStrip(proj.oldPos,oldRot,
    //    StripColors,StripWidth=36,expectedPairs=oldPos.Length=TrailCacheLength[946]
    //    =20（ProjectileID.cs:387,SW-RB11a 订正）,includeBacksides) —
    //    TrailingMode[946]=2（ProjectileID.cs:385,Projectile.cs:17237-17246 每拍整环
    //    移位 oldPos[0]=最新）；StripColors=Lerp(ColorStart,ColorEnd,GetLerpValue(0,
    //    0.7,p))×(1−GetLerpValue(0,0.98,p)),A/=2（EmpressBladeDrawer.cs:35-42）;SSD=
    //    (1,0,0,0.6)（:18-26）。XNA 侧条带 = (One,One) 全量直加（GLSpriteLayer TRAIL_FS
    //    注,GIF 峰值复算钉死）→ 顶点 A=0（ColorStart/End alphaChannelMultiplier=0）
    //    仍可见;本仓顶点 a 写 0.5×(1−g2)（A/=2 语义折算,兼作 CPU 路写入门）。
    //    拖尾经 queueTrailShade 入全亮 flush（TrailShader 合成后直绘=脱离光照乘,
    //    同天顶剑/月牙管线）。
    if (this.projId === 946 && img) {
      const gl = (from: number, to: number, t: number): number =>
        Math.max(0, Math.min(1, (t - from) / (to - from)));            // Utils.GetLerpValue(clamped)
      const own = this.ownerRef();
      const op = 1;                                                     // Opacity=1−alpha/255,alpha 恒 0
      const num = this.rot - Math.PI / 2;                               // :36572
      const num2 = op * 0.3;                                            // :36573
      const num22 = empressHuePhase(this.id, own?.maxMinions ?? 1, gtwSec());
      const hueC = fairyHueRgb(((num22 + 0.5) % 1 + 1) % 1);            // :36566 num=(hueRaw+0.5)%1
      const tinted = tintFrameHue(img, hueC);                           // 女皇色剪影（每帧一染,全层共用）
      // ★变体①终扫（2026-09-27）:HUE_TINT_SCRATCH 全剑共用一染面——每剑 hue 相位
      //  异（num22=id%maxMinions+GTW 环）,shim 静态区域缓存下全部幻影/环晕层冻结
      //  在首帧内容。逐剑烘焙即刻上传（I类 bolt 判例 1:N 扩展:一次 bake 十层消费,
      //  bakedTexMulti 帧内粘滞）+环形键防同键原地改写先行剑纹理（shine 单键教训）。
      if (tinted) r.markWorldDynamicScratch?.(tinted, `empressTint:${empressTintSeq++ % 64}`);
      const num145a = (63 / 255);                                       // A=255×0.5 → /2 =63（:36568/:36575）
      // ①幻影 6 层（:36578-36586）
      const lerpValue = gl(60, 50, this.tA0);
      const num3 = gl(70, 50, this.tA0) * gl(40, 45, this.tA0);
      if (tinted) {
        // ①幻影 6 层（:36578-36586,门= num2>0f :36574——num3 因子进色乘,num3=0 时
        //   XNA 画 (0,0,0,0) 色无贡献,本仓 globalAlpha=0 同效）
        //   ★float 环界（C# float 6×(1/6f)=1.00000012>1 → 恰 6 圈 f∈{0,1/6..5/6};
        //   JS double 累加 0.999…9<1 会多出第 7 圈 f≈1）——Math.fround 逐拍钳 float32
        //   = C# `float num4` 累加同相（:22）
        for (let f = 0; f < 1; f = Math.fround(f + Math.fround(1 / 6))) {
          const a = num145a * num2 * (1 - f) * num3;
          const ox = Math.cos(num) * (-120 * f * lerpValue);
          const oy = Math.sin(num) * (-120 * f * lerpValue);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = a;
          ctx.translate(this.cx + ox, this.cy + oy);
          ctx.rotate(num);
          ctx.drawImage(tinted, -img.width / 2 * 1.125, -img.height / 2 * 1.125, img.width * 1.125, img.height * 1.125);
          ctx.restore();
        }
        // ②环晕 4 层（:36588-36591,色=女皇色×num2 无 num3 因子=恒可见）
        for (let f5 = 0; f5 < 1; f5 += 0.25) {
          const ox = Math.cos(f5 * Math.PI * 2 + num) * 4 * 0.75;
          const oy = Math.sin(f5 * Math.PI * 2 + num) * 4 * 0.75;
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.globalAlpha = num145a * num2;
          ctx.translate(this.cx + ox, this.cy + oy);
          ctx.rotate(num);
          ctx.drawImage(tinted, -img.width / 2 * 0.75, -img.height / 2 * 0.75, img.width * 0.75, img.height * 0.75);
          ctx.restore();
        }
      }
      // ③本体（White×Opacity,A×0.7 :36576-36577+:36592）④女皇色罩 ×num2×0.5（:36600）
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.7;
      ctx.translate(this.cx, this.cy);
      ctx.rotate(num);
      ctx.scale(0.75, 0.75);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      if (tinted) {
        ctx.globalAlpha = num145a * num2 * 0.5;
        ctx.drawImage(tinted, -img.width / 2, -img.height / 2);
      }
      ctx.restore();
      // ⑤拖尾（EmpressBladeDrawer :16-33）：oldPos 环 = tHist（terraprismaBody 每拍压栈）
      if (this.tHist.length >= 6 && typeof (r as unknown as { queueTrailShade?: unknown }).queueTrailShade === 'function') {
        const pts = buildEmpressTrailPts(this.tHist, num22);
        try {
          (r as unknown as { queueTrailShade?: (sp: unknown) => void }).queueTrailShade?.({
            set: 'EmpressBlade', pts, opacity: 1, expectedPairs: 20, time: gtwSec(),
          });
        } catch { /* 拖尾单帧失败不拖垮本体 */ }
      }
      return;
    }
    // ---- ★SW-FX6 2026-09-10 债②清偿：691-693 陷阱塔 B 支 Bottom 锚（Main.cs:34089-34097）----
    // ★R15-F5 登记债（2026-10-11 C15）：原版 691-693 SetDefaults drawLayer=2
    //  （Projectile.cs:7355——DrawProjDirect :18156 分层链,NPC 层之后绘制）——本仓
    //  无弹体 drawLayer 分层机制（全局单层实体序）→ 机制面登记不落：塔在 NPC 身后
    //  时的遮挡序差=视觉面（玩家弹/NPC 遮塔 1 档层序,无实害）;机制移植面单独立刀。
    // vanilla（非携行）：vector99 = proj.Bottom + UnitY·gfxOffY（:34092）、
    // origin32 = 帧尺寸×(0.5,1) 后 Y 连减 2×2 → (fw/2, fh−4)（:34093-34096）⇒
    // 精灵横居盒、底 = 盒底 + 4（758/951/663 族同款「脚微陷」恒量）。携行态
    // （ai[2]==1=IsSentryBeingCarried :80527-80529,本仓 carriedByBackpack）门反支
    // 不重锚 = B 支缺省（锚=盒心、origin=帧心）。dir：AI_138 首行
    // spriteDirection=(direction=1)（:70379）→ dir≡None 恒不翻转（本仓旧通用路
    // facing 翻转未触发但语义已正）；B 支全帧高无 −1 shave（:33701）。gfxOffY 恒 0。
    if (this.sentry && TRAP_TOWER.has(this.projId) && img) {
      ctx.save();
      if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
      ctx.imageSmoothingEnabled = false;
      if (!this.carriedByBackpack) {
        ctx.translate(this.cx, this.y + this.h);                       // proj.Bottom（:34092）
        // ★G30⑧（2026-10-24,G27 登记债⑧清偿）：本体主绘吃 proj.scale（Main.cs:34212
        //  通用尾 EntitySpriteDraw(...,proj.rotation,origin32,proj.scale,dir)）——
        //  proj.scale 镜像=drawScale（1025 先例;AI_138 携行+变身坐骑 54/55/56/61 写
        //  0.5=携行半尺,heavySlingReposition :8622/:8633/:8654/:8665）。缺省 1 零变化
        //  （放置态 scale 恒 1,SetDefaults 无 scale 行）——「值缺省零变化」无 id 门
        //  （G27 判例:自造门反而是 vanilla 没有的门）。
        if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);
        // ★BJ709-G32①（G30 登记债⑩清偿,2026-10-24）：:34212 主绘同传 proj.rotation
        //  ——AI_138 携行 heavySlingReposition 写 ±π/2（:70245;变身坐骑 0 :70249
        //  +fullRotation :70251;mount 61 +dir·π/2 :70303/56 +π :70332）=携行塔侧转
        //  随身;放置态 rot 恒 0 → 零变化（1025 先例 `if (rot!==0) ctx.rotate`）。
        if (this.rot !== 0) ctx.rotate(this.rot);
        ctx.drawImage(img as CanvasImageSource, -img.width / 2, -(img.height - 4)); // origin=(fw/2,fh−4)
      } else {
        ctx.translate(this.cx, this.cy);                               // 携行=B 支缺省盒心锚
        if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);   // ★G30⑧ 同上（携行半尺）
        if (this.rot !== 0) ctx.rotate(this.rot);      // ★G32① 同上（携行侧转,唯携行态 rot≠0）
        ctx.drawImage(img as CanvasImageSource, -img.width / 2, -img.height / 2);
      }
      // ★R15-F2（2026-10-11 C15 清偿）：爆炸机关辉光叠画（Main.cs:34507-34521
      //  DrawProjDirect 691/692/693 支,BJ625件3 旧「691 零缺面」判谳翻正）——
      //  Glow_235/236/237 与本体同布局平行表、同矩形（691 支无半宽化,全帧宽切片）、
      //  同锚同参（vector99/origin32 即本支重锚结果）。色 = Color(255,255,255,127)
      //  字面（A=127 source-over 半透白,非 A=0 加法;不取光照=自发光 → pushGlowOps
      //  'over' 逃逸队列,flushItemGlow over 支 bake/boost 分解承载 BJ604件3 判例）。
      //  携行态照画（:34507 无 ai[2] 门,锚随 :34089 反支缺省=本 translate 面）。
      ctx.restore();
      ctx.save();
      ctx.translate(this.cx, this.carriedByBackpack ? this.cy : this.y + this.h);
      // ★G30⑧：辉光叠画同吃 proj.scale（Main.cs:34519 EntitySpriteDraw(value124,
      //  vector99,rectangle23,Color(255,255,255,127),proj.rotation,origin32,
      //  proj.scale,dir)）——scale 进捕获矩阵（getTransform 于 translate 后同位,
      //  flushItemGlow setTransform 消费）,op 局部 dx/dy 不变=绕锚缩放同 XNA。
      if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);
      // ★G32①：辉光同传 proj.rotation（:34519 第五参）——rotate 进捕获矩阵与 scale
      //  同位（G30⑧ 判例:pushGlowOps getTransform 捕获,flushItemGlow setTransform
      //  消费,op 局部 dx/dy 不动）;均匀缩放与旋转交换律,合成位无序差。
      if (this.rot !== 0) ctx.rotate(this.rot);
      r.pushGlowOps?.([{
        tex: `vanilla/Glow_${TRAP_GLOW_MASK[this.projId]}.png`,
        sx: 0, sy: frame * img.height, sw: img.width, sh: img.height,
        dx: -img.width / 2, dy: this.carriedByBackpack ? -img.height / 2 : -(img.height - 4),
        blend: 'over', tint: [1, 1, 1], alpha: TRAP_GLOW_ALPHA,
      }], ctx.getTransform());
      ctx.restore();
      return;
    }
    // ---- ★SW-FX6 2026-09-10 债③清偿：308/377 哨兵塔通用路内半宽切片
    //      （Main.cs:34950-34957 + 主绘 :35047）----
    // ★BJ612（2026-10-10）贴图代际勘误（推翻 SW-FX6/BJ-C9-SP「帧内左右镜像对」旧论）：
    //  1457 起通用路支内特例 num481=W/2 的【W=1457 新贴图宽】——1.4.5.7 把两贴图
    //  重制为每帧【左右两姿并排】：377=132×450（左 66=部署姿/右 66=背包携行收腿姿）、
    //  308=188×780（左 94/右 94）,左右非镜像（α 差 13.5%）。实证=本机 1.4.5.8 正版
    //  XNB 解码（Projectile_377.xnb 解压 237777B−177 头=237600px=132×450×4;
    //  Projectile_308 同式 188×780;旧 66/94 宽贴图=新图左半逐像素全等）——num481/=2
    //  → 66/94 恰=一只完整蜘蛛,ai[2]==1（携行,:37813/:37992 ai[2]=0&&
    //  CanGetPickedUpBySentryBackpack→1）时 x15=num481 取右半姿。主绘 :35047：
    //  Rectangle(x15, y25, num481, num482−1)（y25=num482·frame:34944、num482=C#
    //  整除帧高:34943、底行 −1 shave）、锚 = (盒左+num153+num152, 盒上+盒高/2)、
    //  origin = (num153, 盒高/2+num151)（num153 初值 (W−bw)/2+bw/2:30303 → /=2 后
    //  =W/4=33/47;num151 仅 377=−6 :30190,num152=0）⇒ 精灵左缘=盒左、竖居盒高半
    //  （377 下移 6px,足部出盒底 5px=原版微陷地观感）。旧仓 66/94 宽贴图+本绘制块
    //  = 画 33/47px 断肢残躯（用户实报「只有一半贴图」病根,贴图已于 BJ612 换
    //  132/188 宽真身）。flip 沿用既有 facing 语义（AI_053 spriteDirection 按目标/
    //  携行方位覆写 :38002/:38052-38062,spriteDirection 可为 −1）。
    //  ★BJ625件5 翻案登记（2026-10-10,推翻 BJ612「377/308 染料通道未接线」登记）：
    //  BJ612 判例前提「原版 GetProjectileDesiredShader 对哨兵生效」不成立——
    //  GetProjectileDesiredShader（Main.cs:22429-22463）只吃 minion/projHook/projPet/
    //  LightPet+switch{623,1020,1105,818};308/377 SetDefaults（:4001-4010/:4619-4625）
    //  只有 sentry=true 无 minion=true（全 21 处 minion=true 站点逐一对读无一哨兵,
    //  projPet 表 90 id 亦无此二型）⇒ 哨兵 Shader 恒 0=原版本就不染。本仓
    //  minionDyeVid（数据面 minion=false）同构回 0 ⇒ 半宽切片直用 projSprite 原片
    //  =vanilla 同相,不接染料闭包（接=偏离）。BJ612 附记「接线时 projFrameSrcRect
    //  sw=img.width 须半宽化（T0 相位）」随前提一并失效——现状 projFrameSrcRect
    //  与 projFrameImg 同为竖条全宽切片式照录（二者自洽,零运行时消费差）;
    //  若未来真有逐帧染料面,须以本支矩形 (x15,y25,halfW,fh-1) 直喂 t0Rect。
    if ((this.projId === 308 || this.projId === 377)) {
      const sheet = projSprite(this.projId);
      if (sheet) {
        const framesN = Math.max(1, projFrameCount(this.projId));
        const fh = Math.floor(sheet.height / framesN);                 // num482（:34943 C# 整除）
        const halfW = Math.floor(sheet.width / 2);                     // num481（:34952）
        const num151 = this.projId === 377 ? -6 : 0;                   // :30190
        const x15 = this.carriedByBackpack ? halfW : 0;                // :34954-34956
        const y25 = Math.floor(frame * fh);                            // :34944
        ctx.save();
        if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
        ctx.imageSmoothingEnabled = false;
        ctx.translate(this.x + halfW / 2, this.y + this.h / 2);        // 锚（num153+num152,num152=0）
        if (this.facing < 0) ctx.scale(-1, 1);
        ctx.drawImage(sheet as CanvasImageSource, x15, y25, halfW, fh - 1,
          -halfW / 2, -(this.h / 2 + num151), halfW, fh - 1);          // :35047（shave −1）
        ctx.restore();
        return;
      }
    }
    ctx.save();
    // 帕鲁出场淡入（Projectile alpha 通道：绘制色 = 原色 × (255-α)/255——
    // DoPalAppearEffect 每 tick α-15，17t 全显 :39509-39515）
    if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
    // ---- 火绒狐喷火态本体替换（ai[0]>=1000，1457 Main.cs:33738-33741/:33790-33797）----
    // 本体贴图换 Extra_303 顶格（Frame(1,3)=60×36）：焰团心 = vector99(center+(0,-11))
    // − origin(30−10sd,12) + size/2 = (cx+10sd, cy−5)；dir ^= FlipHorizontally 镜像保真。
    // 焰流粒子锥（DrawProj_Flamethrower_Foxsparks :35719,采样本体图中带白剪影
    // Frame(1,7,0,3..5) 染色）本仓以 1106 弹幕流近似,不建模
    // ★BJ521②：原版焰体替换直读 ai[0]>=1000（Main.cs:33738/:33797）——岩浆拍
    //  ai[0] 被门（:59174）覆写为 1 ⇒ 画正常本体。lavaWetAi 读相与 AI 门同源同拍
    if ((this.projId === 1094 || this.projId === 1113) && this.foxChannel && !this.lavaWetAi) {
      const ex = r.atlas?.ensureVImage('vanilla/Extra_303.png') ?? null;
      if (ex) {
        ctx.translate(this.cx + 10 * this.facing, this.cy - 5);
        if (this.facing < 0) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(ex as CanvasImageSource, 0, 0, 60, 36, -30, -18, 60, 36);
      }
      ctx.restore();
      return;
    }
    // ---- ★BJ704-G9 插队刀（用户实报「致命球法杖召唤物自旋旋转原点不对」）：
    //      533 本体改道 :30609 glowmask 族支（Main.cs:31578——名单成员永不达 :34927
    //      通用路,else-if 链结构性隔离）。533 无 zero/origin8/num151 特判（:30635 zero
    //      =Zero、:30634 origin8=帧心缺省、num151 表 :30077-30528 无 533 项）⇒
    //      位=proj.Center（盒心）、origin=帧心、rotation=proj.rotation（num162=0,
    //      rotation24≡rotation）、scale=1、dir=None（533 aiStyle66 零 spriteDirection
    //      写=件2 销案同谳）。旧落通用尾（盒左+帧宽/2 锚、origin=(帧宽/2,盒半高)）⇒
    //      48px 帧对 20px 盒右悬 14px+纵向 origin=10≠24 ⇒ 自旋绕偏心点公转=用户所见。
    //      同名单 MinionProj 域普查：755=BJ687 专支盒心+帧心（恰与 :31578 缺省同相 ✓）;
    //      864=BJ669c 用户拍板同心锚（登记冲突 [bj669-864-anchor-conflict],不动）;
    //      833-835 沙漠虎=同病落通用尾——★BJ704-G11 件1 已清偿（见下方虎专支,
    //      [g9-tiger-body-anchor] 登记债销账）。----
    if (this.projId === 533 && img) {
      ctx.save();
      if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
      ctx.imageSmoothingEnabled = false;
      ctx.translate(this.cx, this.cy);                    // :31578 proj.Center（num151=0）
      ctx.rotate(this.rot);                               // rotation24=proj.rotation
      ctx.drawImage(img as CanvasImageSource, -img.width / 2, -img.height / 2);   // origin8=帧心
      // ★BJ663件1 Glow_128 本体罩（Main.cs:31588-31591）随刀迁入本支（旧位=通用尾
      //  变换系内=锚随旧病错位;本支矩阵=盒心+rot 修正后同 op 直推）：sourceRect=
      //  rectangle4 帧切片、rotation/origin/scale 同本体、dir=None;位 = Center+
      //  (0,gfxOffY)=与本体同位（gfxOffY 未建模恒 0）。色 = Color.White*0.3（XNA
      //  float→byte 截断 (byte)76.5=76 四通道）字面恒色不取光照=自发光 → pushGlowOps
      //  'over' 逃逸队列（864 刃杖辉光/BJ625件3 同通道判例）;层序登记：原版本体后
      //  同批绘制,本仓合成后冲刷=叠本体上（暗处保发光 vs 层序按 AURA 通道判例取前者,
      //  864 同款登记）;染料面未接=登记债（864 同款）。
      const glow533 = r.atlas?.ensureVImage('vanilla/Glow_128.png');
      if (glow533) {
        r.pushGlowOps?.([{                                // 矩阵捕获=translate/rotate 后（rot 随本体同参）
          tex: 'vanilla/Glow_128.png',
          sx: 0, sy: frame * img.height, sw: img.width, sh: img.height,   // rectangle4 同本体帧切片
          dx: -img.width / 2, dy: -img.height / 2,        // origin8=帧矩形心（:30634）
          blend: 'over',
          tint: [76 / 255, 76 / 255, 76 / 255], alpha: 76 / 255,          // White*0.3 → (byte)76
        }], ctx.getTransform());
      }
      ctx.restore();
      return;   // 533 专支出口（ghost 环已在上方通用段画过,层序 ghost→glow→本体同原版）
    }
    // ---- ★BJ704-G11（件1,[g9-tiger-body-anchor] 登记债清偿）沙漠虎 833-835 本体
    //      底锚专支（Main.cs:30706-30719 步态帧特支 + :31578 族绘位——G9 普查定谳
    //      仓落通用尾的精确值落模）：
    //  · 步态带（833 frame!=8 / 834-835 frame!=10——立 0/空中 1(9)/走 2-7(2-9)/
    //    坐等 9(11) 全员,帧号判=原文帧门,AI 态不掺混）:zero.Y+=h/2 → 绘位=
    //    proj.Center+(0,h/2)（gfxOffY 未建模恒 0=全仓既定近似;num151 表
    //    :30077-30528 无 833-835 项=0）;origin8=帧尺寸×(0.5,1) 后 Y−=4、X−=
    //    7|2×ToDirectionInt（Utils.cs:2131:flip?1:−1——右向 origin.X=W/2+7|2/
    //    左向=W/2−7|2）⇒ 贴图横跨 [cx−W/2−7|2, cx+W/2−7|2] 翻转两侧同屏矩形
    //    （XNA flip 镜像同 span,canvas translate→rotate→scale(−1,1)→drawImage(−ox,−oy)
    //    ≡ EntitySpriteDraw(position,origin,FlipH) 任意 origin 等价）;帧底=盒底+4px。
    //    旧通用尾（帧左上锚盒左上）偏 +21px 右+12px 下（833,帧 54×36/盒 26×20）/
    //    +24px 右+14px 下（834/835,帧 64×44/盒 20×30）。
    //  · 飞行帧 8|10（飞行/爬高态,rotation +=0.6 累计）:回 :31578 族支缺省=盒心
    //    锚+帧心 origin+rot+翻转（533 专支同形,无 glow/无 num151）——旧通用尾偏
    //    +14|24px 右。
    //  ghost 侧 GHOST_FRAME（zeroHalfH/originY/originX）同源值已在 BJ235 落模,
    //    originX 消费位乘数 0/1→±1（ToDirectionInt）随本刀在 projGhostTrail 勘正
    //    （ghost 与本体共用 origin8/zero,Main.cs:31383 ghost 绘制直传）。----
    if (this.projId >= 833 && this.projId <= 835 && img) {
      const flyGate833 = this.projId === 833 ? 8 : 10;          // :30706/:30713 帧门
      const kx833 = this.projId === 833 ? 7 : 2;                // origin8.X −= 7|2×flipDir
      ctx.save();
      if (this.alphaFade > 0) ctx.globalAlpha = Math.max(0, (255 - this.alphaFade) / 255);
      ctx.imageSmoothingEnabled = false;
      if (frame !== flyGate833) {
        // 步态带底锚（:30706-30719）
        ctx.translate(this.cx, this.cy + this.h / 2);           // proj.Center+zero(0,h/2)
        if (this.rot !== 0) ctx.rotate(this.rot);               // rotation24（步态帧机逐拍复位 0）
        if (this.facing < 0) ctx.scale(-1, 1);                  // dir（AI_067 spriteDirection 写位=facing 同源）
        const ox833 = img.width / 2 - kx833 * (this.facing < 0 ? 1 : -1);   // W/2−k×ToDirectionInt
        ctx.drawImage(img as CanvasImageSource, -ox833, -(img.height - 4)); // origin8=(ox,H−4)
      } else {
        // 飞行帧回族支缺省（:31578 无 833-835 特判=盒心+帧心）
        ctx.translate(this.cx, this.cy);
        if (this.rot !== 0) ctx.rotate(this.rot);
        if (this.facing < 0) ctx.scale(-1, 1);
        ctx.drawImage(img as CanvasImageSource, -img.width / 2, -img.height / 2);
      }
      ctx.restore();
      return;   // 虎专支出口（ghost 环已在上方通用段画过）
    }
    // ---- 原版偏移表消费（Main.cs:29375-29826 num143/144 + 通用绘制 :34040）----
    // 全型号统一走公式（2026-08-19 清零近似）：有表项用 num143/144,未登记 = 0/0
    // → 贴图左上角 = (盒左+num144, 盒上−num143) = 盒左上对齐（曾一律盒心居中近似,
    // 已废）。★F5b：动态项 dirX 此前恒传 −1（"AI_026 零赋值 ⇒ spriteDirection=−1"
    // 系误读——原版零赋值 = 缺省 +1,Entity/Projectile 双缺省 1,Projectile.cs:356）,
    // 现传真值：dirX = facing（spriteDirection 语义镜）;dir = 原版 direction
    // （蜘蛛 390-392 = spDir,:63302-63317;其余族用 facing 侧写——仅 191-194/
    // 390-392 三族读 direction,Main.cs:30490-30498。右行蜘蛛 num152 旧 −4 应 +4
    // =8px 差）。旋转族(rotation)绕 anchor 旋转 = 原版 spriteBatch(anchor,origin,
    // rotation) 同构
    const off3 = img
      ? (projDrawOffsetFor(this.projId, this.facing, this.h,
        this.projId >= 390 && this.projId <= 392 ? this.spDir : this.facing) ?? [0, 0, 0])
      : null;
    // num145 = (贴图宽−盒宽)/2 + 盒宽/2 = 贴图宽/2（Main.cs:29601 原式化简,1457
    // Main.cs 同式）——旋转枢=贴图水平中点;曾误写 (贴图宽+盒宽)/2 → 随从绕偏心点
    // 公转（2026-08-23 备案项⑦,同 WeaponProj.drawProj 修法）
    const num145 = off3 && img ? img.width / 2 : 0;
    if (off3) ctx.translate(this.cx - this.w / 2 + num145 + off3[1], this.cy);
    else ctx.translate(this.cx, this.cy);
    ctx.imageSmoothingEnabled = false;
    // 旋转制族（双子/致命球/雪花/龙链/方块，MINION_ROT_ONLY）：rotation 绘制、
    // 恒不水平翻转（原版 dir=SpriteEffects.None）；翻转制族 spriteDirection=-1
    // 才翻（AI_026/164 族零赋值恒不翻，MINION_NO_FLIP）。
    // 表外设 rot 的族（AI_062 :66827/乌鸦 :27542/蜘蛛爬墙 :65136）原版 rotation 与
    // spriteDirection 【同 draw 调用叠用】（Main.cs:30529-30533 dir + spriteBatch rotation）
    // ——XNA FlipHorizontally = 顶点绕 origin 先镜像再旋转 → canvas rotate 后 scale(-1,1)
    // ★BJ517⑤：flipDir = 绘制翻转判向（spriteDirection 语义镜）——尾族 191-194/266
    // 消费 AI 侧 a026SpriteDir（原版 sd=−direction :63319-63329+266 地面 flag27
    // 朝玩家 :65481-65487+返程速度规则 :61628-61638）,其余族 facing 侧写不变
    const flipDirBJ517 = (this.projId >= 191 && this.projId <= 194) || this.projId === 266
      ? this.a026SpriteDir
      : this.facing;
    if (this.rot !== 0 || MINION_ROT_ONLY.has(this.projId)) {
      ctx.rotate(this.rot);
      if (!MINION_ROT_ONLY.has(this.projId) && flipDirBJ517 < 0 && !MINION_NO_FLIP.has(this.projId)) {
        ctx.scale(-1, 1);
      }
    } else if (flipDirBJ517 < 0 && !MINION_NO_FLIP.has(this.projId)) ctx.scale(-1, 1);
    // ★BJ518⑥：scale 通道（Projectile.scale → spriteBatch 触发尺寸;现役唯一写位=
    //  1025 携带缩体支 0.5,:70152 头置 1 恒等不变换）——均匀正缩放与旋转/镜像交换律,
    //  合成位无序差
    if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);
    // 火绒狐翻转侧原点修正（1457 Main.cs:33814 origin32.X += Flip→−8：XNA 镜像绕
    // origin 使贴图整体左移 8px;本仓镜像绕 anchor 无原点修正 → 补画位偏移,
    // 翻转侧落位 [cx−39,cx+23] 与原版对齐,非翻转侧 [cx−31,cx+31] 不动）
    const foxFlipAdj = (this.projId === 1094 || this.projId === 1113)
      && this.facing < 0 && !MINION_NO_FLIP.has(this.projId) ? 8 : 0;
    if (this.projId === 653) {
      // 同伴方块：SetDefaults scale=0.8（:6740）+ rotation 独立累计（cubeRot,
      // rotation+=vx/20——不走龙链 rot,直接套用）;34×34 单帧
      if (this.cubeRot !== 0) ctx.rotate(this.cubeRot);
      ctx.scale(0.8, 0.8);
    }
    if (this.projId === 946) {
      ctx.scale(0.75, 0.75);   // 泰拉棱镜：SetDefaults scale=0.75（:8932）
    }
    if (img) {
      if (off3) ctx.drawImage(img, -num145 + foxFlipAdj, -(this.h / 2 + off3[0]), img.width, img.height);
      else ctx.drawImage(img, -img.width / 2, -img.height / 2);   // 贴图未就绪兜底(无偏移量可依)
    } else {
      // 兜底：召唤符记色块（哨兵紫 / 随从金）——贴图缺失或懒加载未就绪
      ctx.fillStyle = this.sentry ? '#B080FF' : '#FFD060';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.strokeStyle = '#000';
      ctx.strokeRect(-8, -8, 16, 16);
    }
    // 755 血蝙蝠红晕（Main.cs:31440-31448——★G10 锚勘误（R1-P2③）：旧注 :30669-
    // 30678 系该区 origin8 锚块残号,非 755 支）：AI_156_GetColor = Crimson(220,20,60)
    // A=120，offset = rotation.ToRotationVector2().RotatedBy(π/2×k)×2【世界系】+
    // 每层本体同 rotation 绘制。★双旋转休眠注（R1-P2③）：本块在已 rotate(this.rot)
    // 的变换系内以 `off=this.rot+π/2×k` 平移=偏移角被二次旋转（R(rot)·R(rot+…)）;
    // 755 AI_156 全程零 rotation 写（:52446-52451 只写 spriteDirection）⇒ rot≡0
    // 两式同值=现状零差休眠——若未来 755 接非零 rot,须改为 save/restore 外层世界系
    // 偏移（translate 前置 rotate 前）或 off=π/2×k。
    if (this.projId === 755 && img) {
      const halo = tintFrameCache(img, 'rgb(220,20,60)');
      if (halo) {
        ctx.globalAlpha = 120 / 255;
        for (let k = 0; k < 4; k++) {
          const off = this.rot + (Math.PI / 2) * k;
          ctx.save();
          ctx.translate(Math.cos(off) * 2, Math.sin(off) * 2);
          ctx.drawImage(halo, -halo.width / 2, -halo.height / 2);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    }
    // （★BJ663件1 533 Glow_128 本体罩已随 BJ704-G9 插队刀迁入 533 专支——本位在
    //  专支早退后对 533 不可达,旧块摘除防双记;op 参数逐字保留。）
    ctx.restore();
  }
}

/** 帧图整体染色缓存（755 红晕用：source-atop 填色剪影） */
const HALO_TINT = new Map<HTMLCanvasElement, HTMLCanvasElement>();
function tintFrameCache(src: HTMLCanvasElement, color: string): HTMLCanvasElement | null {
  let c = HALO_TINT.get(src);
  if (c) return c;
  if (typeof document === 'undefined') return null;
  c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const cx2 = c.getContext('2d');
  if (!cx2) return null;
  cx2.drawImage(src, 0, 0);
  cx2.globalCompositeOperation = 'source-atop';
  cx2.fillStyle = color;
  cx2.fillRect(0, 0, c.width, c.height);
  if (HALO_TINT.size > 64) HALO_TINT.clear();   // 帧图缓存换代会自然重建
  HALO_TINT.set(src, c);
  return c;
}

// ---- ★SW-BJ56 2026-09-10：泰拉棱镜 946 绘制辅助（三件,仅 946 消费）----

/** GlobalTimeWrappedHourly（Main.cs:17014——★BJ330 收编 GameTime 单源,暂停/失焦冻结;npcExtraParts.gtw 同源） */
function gtwSec(): number {
  return globalTimeWrappedHourly();
}

/** Main.hslToRgb(h,1,0.5) 逐式移植（Main.cs:48689-48717 + hue2rgb :48719-48734;
 *  s=1→t2=l+s−ls=1、t1=2l−t2=0）——女皇武器色 = GetFairyQueenWeaponsColorFull 缺省
 *  尾段 hslToRgb(num,saturation=1,luminance=0.5)（Projectile.cs:22062）。返回 [r,g,b] 0-1。 */
export function fairyHueRgb(hue: number): [number, number, number] {
  const hue2rgb = (c: number, t1: number, t2: number): number => {
    if (c < 0) c++;
    if (c > 1) c--;
    if (6 * c < 1) return t1 + (t2 - t1) * 6 * c;
    if (2 * c < 1) return t2;
    if (3 * c < 2) return t1 + (t2 - t1) * (2 / 3 - c) * 6;
    return t1;
  };
  const t2 = 0.5 + 1 - 0.5 * 1;          // l + s − l×s = 1（s=1）
  const t1 = 2 * 0.5 - t2;               // 2l − t2 = 0
  const r = Math.round(hue2rgb(hue + 1 / 3, t1, t2) * 255) / 255;
  const g = Math.round(hue2rgb(hue, t1, t2) * 255) / 255;
  const b = Math.round(hue2rgb(hue - 1 / 3, t1, t2) * 255) / 255;
  return [r, g, b];
}

/** 女皇色剪影（946 幻影/环晕/色罩层共用）：每帧一染（色相随 GlobalTime 循环,缓存无效）
 *  ——source-atop 保 silhouette α,与 tintFrameCache 同工艺;返回共享 scratch（调用即画,
 *  同帧内多次 drawImage 安全,跨实体下一帧重染）。 */
let HUE_TINT_SCRATCH: HTMLCanvasElement | null = null;
/** ★变体①终扫:女皇剑烘焙环形序号（家族独立计数;环形窗 64 ≥ 单帧烘焙剑数,
 *  窗内复用=先行剑 rec 纹理被原地改写——shine 单键回归教训） */
let empressTintSeq = 0;
/** ★BJ669：864 辉光 4 份染色对缓存（whoAmI%6 六档键,惰性烘焙幂等）——
 *  cut=帧 1 白模黑染（A 衰减面）、add=帧 1 白模 rgb×0.7 染（rgb 贡献面）。
 *  XNA 预乘 One/InvSrcAlpha 分解（drawProjGhosts 864 档同式）：
 *  dst' = tex.rgb×C.rgb + dst×(1−tex.a×C.a)。帧 1=纯白模（BJ632 探针 340/340 全白）
 *  → source-atop 染=同形纯色剪影。烘焙失败（无 sheet/headless）缓存 null 防重试抖动。
 *  ★清偿 C1/R5-F1（2026-10-14）：rgb 量化=xnaColorMulByte 截断（XNA Color*float
 *  逐字节 (byte) 截断,与 projGhostTrail GHOST_TINT[864] 同一函数——旧 Math.round
 *  中点档 +1,hue0 (57,61,157)≠XNA (57,60,156)）。
 *  ★清偿 C2/R5-F2：订阅 projGhostTrail 贴图覆盖通知——setProjSpriteOverride(864)
 *  （素材包就地换图,RemasterRuntime 无 reload）清本缓存,下次烘焙吃新剪影。 */
const GLOW864_CACHE = new Map<number, { cut: HTMLCanvasElement; add: HTMLCanvasElement } | null>();
onProjSpriteOverride((id) => { if (id === 864) GLOW864_CACHE.clear(); });
function glow864TexPair(k: number, rgb: readonly [number, number, number]): { cut: HTMLCanvasElement; add: HTMLCanvasElement } | null {
  if (GLOW864_CACHE.has(k)) return GLOW864_CACHE.get(k) ?? null;
  if (typeof document === 'undefined') return null;
  const sheet = projSprite(864);
  // 贴图未就绪（headless/异步首帧）→ 不缓存 null（每帧重查,就绪后下一拍即烘）
  if (!sheet || sheet.height < 64) return null;
  const fh = Math.floor(sheet.height / 2);
  const bake = (fill: string): HTMLCanvasElement | null => {
    try {
      const c = document.createElement('canvas');
      c.width = sheet.width; c.height = fh;
      const g = c.getContext('2d');
      if (!g) return null;
      g.drawImage(sheet as CanvasImageSource, 0, fh, sheet.width, fh, 0, 0, sheet.width, fh);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = fill;
      g.fillRect(0, 0, c.width, c.height);
      return c;
    } catch {
      return null;   // 贴图源不可绘（测试桩/解码中）→ 视同未就绪,不缓存
    }
  };
  const cut = bake('rgb(0,0,0)');
  const rgbQ = xnaColorMulByte(rgb, 0.7);   // ★清偿 C1：XNA (byte)(c×0.7f) 截断（旧 Math.round）
  const add = bake(`rgb(${rgbQ[0]},${rgbQ[1]},${rgbQ[2]})`);
  if (!cut || !add) return null;
  const pair = {
    cut: cut as HTMLCanvasElement,
    add: add as HTMLCanvasElement,
  };
  GLOW864_CACHE.set(k, pair);
  return pair;
}

function tintFrameHue(src: HTMLCanvasElement, rgb: readonly [number, number, number]): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  HUE_TINT_SCRATCH ??= document.createElement('canvas');
  if (!HUE_TINT_SCRATCH) return null;
  if (HUE_TINT_SCRATCH.width !== src.width || HUE_TINT_SCRATCH.height !== src.height) {
    HUE_TINT_SCRATCH.width = src.width;
    HUE_TINT_SCRATCH.height = src.height;
  }
  const cx2 = HUE_TINT_SCRATCH.getContext('2d');
  if (!cx2) return null;
  cx2.globalCompositeOperation = 'source-over';
  cx2.clearRect(0, 0, HUE_TINT_SCRATCH.width, HUE_TINT_SCRATCH.height);
  cx2.drawImage(src, 0, 0);
  cx2.globalCompositeOperation = 'source-atop';
  cx2.fillStyle = `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
  cx2.fillRect(0, 0, HUE_TINT_SCRATCH.width, HUE_TINT_SCRATCH.height);
  cx2.globalCompositeOperation = 'source-over';
  return HUE_TINT_SCRATCH;
}

/** ★SW-BJ56：女皇剑色相相位（Main.cs:28680-28682 1:1,Export 供测试）——
 *  num22 = IndexForVisuals % max(1,maxMinions)/max(1,maxMinions) + GlobalTimeWrappedHourly%3/3 */
export function empressHuePhase(id: number, maxMinions: number, gtw: number): number {
  const num20 = (gtw % 3) / 3;
  const num21 = Math.max(1, maxMinions);
  return ((id % num21) / num21) + num20;
}

export interface EmpressTrailPt { x: number; y: number; hw: number; rot: number; r: number; g: number; b: number; a: number }

/** ★SW-BJ56：EmpressBladeDrawer 条带顶点色列（Terraria.Graphics/EmpressBladeDrawer.cs
 *  :16-42 1:1,Export 供测试）。tHist = [x,y,rot]×N 平铺（[0..2]=最新,TrailingMode=2 压栈序
 *  Projectile.cs:17237-17246）;pairs=expectedPairs=oldPos.Length=TrailCacheLength[946]
 *  =20（ProjectileID.cs:387,SW-RB11a 订正;PrepareStrip 第 6 参,progressOnStrip =
 *  i/(pairs−1) VertexStrip.cs:55-63——与实际点数无关,短条带只摊到 (n−1)/19）。
 *  逐点色 = Lerp(ColorStart,ColorEnd,GetLerpValue(0,0.7,p))×(1−GetLerpValue(
 *  0,0.98,p))、A/=2(:35-42)——XNA 侧顶点 A 实为 0（alphaChannelMultiplier=0),(One,One)
 *  全量直加下 rgb 承载贡献（GLSpriteLayer TRAIL_FS 注）;本仓 a=0.5×(1−g2) 兼作 CPU 路门。
 *  hw=36=StripWidth 恒半宽（AddVertexPair ±(rot−π/2)×36,VertexStrip.cs:153-160）。 */
export function buildEmpressTrailPts(tHist: readonly number[], huePhase: number): EmpressTrailPt[] {
  const hueA = fairyHueRgb((((huePhase % 1) + 0.5) % 1 + 1) % 1);          // ColorStart(:28684)
  const hueB = fairyHueRgb(((((huePhase + 0.5) % 1) + 0.5) % 1 + 1) % 1);  // ColorEnd(:28685)
  const pairs = 20;                        // oldPos.Length=TrailCacheLength[946]（SW-RB11a）
  const n = Math.min(Math.floor(tHist.length / 3), pairs);
  const pts: EmpressTrailPt[] = [];
  for (let i = 0; i < n; i++) {
    const p = i / (pairs - 1);
    const g1 = Math.max(0, Math.min(1, p / 0.7));
    const g2 = Math.max(0, Math.min(1, p / 0.98));
    const fade = 1 - g2;
    pts.push({
      x: tHist[i * 3], y: tHist[i * 3 + 1],
      hw: 36,
      rot: tHist[i * 3 + 2],
      r: (hueA[0] + (hueB[0] - hueA[0]) * g1) * fade,
      g: (hueA[1] + (hueB[1] - hueA[1]) * g1) * fade,
      b: (hueA[2] + (hueB[2] - hueA[2]) * g1) * fade,
      a: 0.5 * fade,
    });
  }
  return pts;
}

/**
 * 沙漠虎扑击弹 818（AI_162_TigerPounce :44056-44123 1:1）：
 *  132×132 判定盒（:7725-7726）、ai[0]<0 延迟隐身（每 update +1，extraUpdates=3 →
 *  每 tick 4 update :44058-44063）、起始点→(起始+velocity) 的 CatmullRom 弧线
 *  （垂度 y=距离×1.5，端点外扩 ±0.1 :44073-44078）、ai[0] += 1/ai[1] 每 update
 *  （:44090，时长 = ai[1]/4 tick）→ ai[0]≥1 消亡（:44119-44122）。
 *  伤害 ×(1.5+0.4×(宝石数-1))（:12107-12111）、每敌一次（localNPCHitCooldown=-1
 *  :7733）、818 ∈ MinionShot（ProjectileID.cs:197）→ 吃鞭 tag。
 */
export class TigerPounce extends Entity {
  w = 132; h = 132;
  dead = false;
  rot = 0;
  private damage: number;
  private ivx: number;
  private ivy: number;
  /** ai[0]：负=延迟计数 / 正=进度（0..1）；ai[1]：时长（update 数） */
  private a0: number;
  private a1: number;
  /** 起始中心（localAI[0]/[1] :44069-44070） */
  private sx = 0;
  private sy = 0;
  private started = false;
  /** Opacity（:44079-44082 每 update +0.1） */
  private op = 0;
  private hitSet = new Set<number>();
  private ownerRef: () => Player | null;
  /** ★BJ704-G2（债① 818 员）：mode2 残影环（TrailingMode[818]=2/CacheLen 20,
   *  ProjectileID.cs:385/:387;MinionProj 755 接线式同构——记录面 fixedUpdate
   *  逐子步采样,见彼处 BJ704-G2 注） */
  private ghostRing = new ProjGhostRing(818);

  // ---- ★通用湿段（Projectile.cs:16903-17113 全体弹共用段;2026-09-04 溅花缺口
  //  清偿批,仆从弹类接入。四旗/wetCount/presetDone 形状=ProjWetFlags 共享体）----
  //  逐 id 豁免核对：818 ∈ MinionShot（ProjectileID.cs:291）——SetDefaults
  //  （P.cs:8007-8016：132×132/aiStyle 162/tileCollide=false）【ignoreWater=true
  //  :8013】→ 豁免 id,湿段整段门恒闭（:16903）= 原版零行为（字段照加、段照调,
  //  豁免分流由 ignoreWater 参数自动承载）。阻尼不适用定谳（双证）：①豁免;
  //  ②818 ∈ UpdatePosition 早退表（P.cs:20551-20553 `type == 818` → position
  //  不积分,位移全由 AI CatmullRom 曲线插值覆写 :44073-44078——非 velocity 积分
  //  宿主,wetVelocity 档位无消费位）。
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount 同名 :16984/:17109-17112） */
  wetCount = 0;
  /** 出生预置已做（一次;NewProjectile :10886-10892 等价） */
  presetDone = false;

  constructor(
    x: number, y: number, vx: number, vy: number, damage: number,
    owner: () => Player | null, ai0: number, ai1: number,
  ) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.ivx = vx;
    this.ivy = vy;
    this.damage = damage;
    this.ownerRef = owner;
    this.a0 = ai0;
    this.a1 = ai1;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    // ★通用湿段（:16903-17113,projWetSection 共享体 1:1）——818 豁免 id
    //  （P.cs:8013 ignoreWater=true）→ 段门恒闭零行为;插 tick 头与 AI/位移序无
    //  观察差（段内唯一可见面=溅花,豁免即恒无）。位移阻尼不适用（双证见字段块头）。
    projectileWetSection(this, game, game.world.store, this.x, this.y, this.w, this.h,
      818, !!projectileData(818)?.ignoreWater);
    // ★BJ704-G2（债① 818 员）：mode2 残影环逐子步采样（extraUpdates=3 → 4 子步/t;
    //  UpdateTrails :17234-17245 每 update 一记 pos+rot+dir）。延迟相（ai[0]<0）
    //  原版 AI 早退但 UpdateTrails 照跑 → 4 记同位（spawn 钉位,dir=初始 spriteDirection
    //  1——AI 首个活子步才写 :47589）;此时 ghost 色 num175=0 → 加法黑零贡献不可见。
    if (this.a0 < 0) {
      for (let k818 = 0; k818 < 4; k818++) this.ghostRing.record(this.x, this.y, this.rot, 1, true);
      this.a0 += 4; return; // 延迟隐身（:44058-44063，Opacity=0）
    }
    if (!this.started) { this.started = true; this.sx = this.cx; this.sy = this.cy; } // :44066-44072
    // CatmullRom 控制点（:44073-44078：端点 -0.1/+1.1 外扩，垂度 = 距离×1.5）
    const ex = this.sx + this.ivx, ey = this.sy + this.ivy;
    const sag = Math.hypot(this.ivx, this.ivy) * 1.5;
    const p1 = { x: this.sx + (ex - this.sx) * -0.1, y: this.sy + (ey - this.sy) * -0.1 + sag };
    const p4 = { x: this.sx + (ex - this.sx) * 1.1, y: this.sy + (ey - this.sy) * 1.1 + sag };
    const a0Pre = this.a0, rotPre = this.rot;   // 子步采样快照（端态折算不变）
    if (this.op < 1) this.op += 0.4; // :44079-44082（4 update/tick 折算）
    this.rot += Math.sign(this.ivx) * -0.8; // :44083-44085（-0.2×4 update）
    if (this.a1 < 1) this.a1 = 60; // :44086-44089
    this.a0 += 4 / this.a1;        // :44090（每 update 1/ai[1]，4 update/tick）
    const t = Math.max(0, Math.min(1, this.a0));
    const pos = catmullRom(p1, { x: this.sx, y: this.sy }, { x: ex, y: ey }, p4, t);
    this.x = pos.x - this.w / 2;
    this.y = pos.y - this.h / 2;
    // ★BJ704-G2：活相逐子步采样——原版子步 k：rot−0.2·k·sign → a0+k/a1 → Center
    // 写 → UpdateTrails 一记。压缩模型端态不动,中间子步位置/角同式重放（a0 顺序
    // 加 vs k×(1/a1) 单加的浮点差 ≤1e-16 不可见）;a0k≥1 起为 Kill 子步不记录
    // （AI 内 Kill → !active 门 :17132 同相）。
    {
      const sg818 = Math.sign(this.ivx) || 1;
      for (let k818 = 1; k818 <= 4; k818++) {
        const a0k = a0Pre + k818 / this.a1;
        if (a0k >= 1) break;
        const tk = Math.max(0, Math.min(1, a0k));
        const pk = catmullRom(p1, { x: this.sx, y: this.sy }, { x: ex, y: ey }, p4, tk);
        this.ghostRing.record(pk.x - this.w / 2, pk.y - this.h / 2,
          rotPre - 0.2 * k818 * sg818, sg818, true);
      }
    }
    if (this.a0 >= 1) { this.dead = true; return; } // :44119-44122
    // 接触（Damage 全程可伤：Damage_CanDealDamage 仅 ai[0]<1 拦截 :11782，此处已过门）
    const gems = countStormTigerGems(game);
    const mul = 1.5 + 0.4 * Math.max(0, gems - 1); // :12107-12111
    const add = (e: unknown) =>
      (game as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(e, 'projectiles');
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
      const en = ent as never as EnemyLike & import('./WhipTag').WhipTagged & { hurtFx?: (d: number) => void };
      if (en.dead || this.hitSet.has(en.id)) continue; // localNPCHitCooldown=-1 每敌一次
      if (this.x >= en.x + en.w || this.x + this.w <= en.x
        || this.y >= en.y + en.h || this.y + this.h <= en.y) continue;
      // ★BJ475① :12600 头门前置（contact 环同构,BJ467⑥ 同形;818 扑击臂 BJ467⑥
      //  落刀时任务清单未含=同形漏网）——dontTakeDamage 靶不达 hitSet 记账/TimerCrit
      //  /tag（快照纪律:读 hurt 前状态;随从弹非接触反噬族 → DTD 水母亦无 zap 口,
      //  整跳=原版净语义 :12685）。
      if ((en as { dontTakeDamage?: boolean }).dontTakeDamage === true) continue;
      // ★BJ436（2026-10-02）:12636 全局窗门在写梯前（usesLocal cd=-1 族同门）——
      //  窗拒拍 hitSet 保持未记（原版 localNPCImmunity 不达 :14179 写位,下拍重试）;
      //  旧码先记 hitSet 再进 hurt 被窗拒=该敌整轮扑击丢失。
      if (MinionProj.enemyImmune(en)) continue;
      this.hitSet.add(en.id);
      // ★W5（2026-10-02）916 链电汇出位（contact() :4580 同式）：旧形同步直调
      //  伤落被命中敌且先于主 hurt=反序反噬;916 出膛即对被命中敌永免（_DarkHarvest
      //  .cs:18）——汇出收集,主命中受理后 darkHarvestChain 落地链电（伤落其他敌）。
      const pounceDirect: number[] = [];
      en.hurtFx = (d: number) => { pounceDirect.push(d); };
      // ★BJ453 受理面 crit 段补全（Projectile.cs:12928-12943 同位,ModifyHit 前）：
      //  TimerCrit :12928 + 武僧 688-690 强制掷 :12929-12943（818 恒假,形位保留）
      const timerCritPounce = tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);
      const monkCritPounce = monkAuraForcedCrit(this.ownerRef(), 818);
      const res = resolveWhipTagHit(en, Math.max(1, Math.round(this.damage * mul)), game,
        add, SUMMON_TAG_MUL[818] ?? 1, en.cx, en.cy, this.ownerRef());
      // ★F10（2026-08-31 蓝队三批）：扑击弹 818 生成侧 knockBack=0（:46470
      //  NewProjectile 尾参 0f）→ 原版 StrikeNPC 的 `knockBack>0f && knockBackResist>0f`
      //  双门（NPC.cs:82144）整段不进——击退/冲量归零。旧 (0,-1) 冲量是自造位移，
      //  与 Enemy.hurt 武器支 :12366 的同式双门不一致，归零对齐。
      // 主命中受理预判（Enemy.hurt 头门残面 :14234 dead/:14241 dontTakeDamage——
      //  拒收跳原版 :13711 不可达=无 916）
      const pounceGated = en.dead
        || (en as { dontTakeDamage?: boolean }).dontTakeDamage === true;
      // ★BJ436（2026-10-02）写梯档位：818 = usesLocalNPCImmunity+cd=-1（:8016-8019）
      //  → 清窗档 pierce=-3（:14175-14179 immune[owner]=0）;旧 pierce=0 开 10t 窗
      //  =扑击每跳压武器 10t（同 BJ436 主病灶）。
      // ★BJ455③ banner 乘区包入（定谳:818=标准 Damage() 管线——SetDefaults friendly
      //  :8007-8019,AI_162 :44056-44123 无直伤旁路 → Damage_PVE :13387-91 banner 段
      //  对其照跑;他臂 contact()/光环/爆弹/拳盒均包,本臂漏包=旗下伤 ×1.5 整缺）。
      // ★BJ453 并链：crit 源 ‖ timerCritPounce（:12928）‖ monkCritPounce（:12929-12943）,
      //  新源强制时补一次 ×2（res.crit 的 ×2 已嵌 res.dmg——单一翻倍,原版序）
      const critPounce = res.crit || timerCritPounce || monkCritPounce;
      // ★BJ716-A（R18-F2）：DamageVar 首掷（:12970,owner luck）——扑击弹 818 面
      const dmgVPounce = damageVarRoll(res.dmg, this.ownerRef()?.luck ?? 0);
      en.hurt(applyBannerDamageDealt(game, en, critPounce && !res.crit ? dmgVPounce * 2 : dmgVPounce), 0, 0, game, 0, critPounce, -3, true); // ★BJ452 N2 crit 色位（tag 掷率强制位,Enemy.hurt 纯染色）;kb=0 ⇒ 原版双门不进;fromPlayer=DPS 计
      // ★Z1/D1② ghostHeal 白耗/治疗面（:13877-84 通用 on-hit 段）——818 为逐段瞬态弹
      //  （TigerSpecialAttack 每 hop NewProjectile）→ numHits=0 每轮独立
      if (!pounceGated) {
        ghostHealProc(game, 818, 0, en as unknown as Parameters<typeof ghostHealProc>[3]);
      }
      // ★BJ436 GC1 桥（usesLocal 清零档;受理才写,同 ForbiddenSignProj 式）
      if (!pounceGated) {
        noteVanillaProjImmune(game, 818, en.id, { penetrate: -1, localFace: true });
      }
      // ★W5 :13711 位落地（主命中受理+写梯后）——916 链电伤落其他敌（源敌永免）
      if (pounceDirect.length > 0 && !pounceGated) {
        for (const d of pounceDirect) {
          darkHarvestChain(game, d, en.cx, en.cy, en.id);
        }
      }
    }
    // ★清偿刀 Y2：城镇臂（扑击弹 818 Damage 全程可伤——CanDealDamage :12468 仅
    //  `(818 && ai[0]<1)` 闸 → Damage_PVE_Inner 城镇同链;localNPCHitCooldown=-1
    //  每靶一次,usesLocal 主支=受理拍清窗,hitSet 写位=受理拍 :14179 同位）。
    {
      let pounceDirect: number[] | null = null;
      hitTownNpcs({ x: this.x, y: this.y, w: this.w, h: this.h }, game,
        Math.max(1, Math.round(this.damage * mul)), 0, 'playerProj', 818, undefined, undefined,
        (n) => {
          if (!townVoodooGateOpen(game, n.vanillaId, 818)) return true;
          // ★BJ455⑦ :12636 三族共门（contactTown :4958 同式——窗拒拍整跳先于 settle,
          //  掷序纪律=拒拍不耗 RNG/不落 settle 副作用;读 hurt 前状态=快照纪律）
          if (MinionProj.enemyImmune(n)) return true;
          return this.hitSet.has(n.id);   // localNPCHitCooldown=-1 每靶一次（读门）
        },
        (n) => {
          this.hitSet.add(n.id);            // 局部表占位（:14179,受理拍）;usesLocal 主支清窗
          const tn = n as TownNpcHitTarget;
          tn.iframes = 0;
          // ★Z1/D1② 城镇臂 ghostHeal 白耗/治疗面（:13877-84 城镇靶同面;numHits=0 同敌怪环）
          ghostHealProc(game, 818, 0, n as unknown as Parameters<typeof ghostHealProc>[3]);
          if (pounceDirect) {
            for (const d of pounceDirect) {   // OnHit :13711 位——★W5:916 链电
              darkHarvestChain(game, d, tn.cx, tn.cy, tn.id);   // 链靶=CanBeChasedBy 敌,城镇 NPC 本体永免（:18）
            }
            pounceDirect = null;
          }
        },
        (n) => {
          const tn = n as TownNpcHitTarget;
          const direct: number[] = [];
          tn.hurtFx = (d: number) => { direct.push(d); };
          const res = resolveWhipTagHit(tn, Math.max(1, Math.round(this.damage * mul)), game,
            add, SUMMON_TAG_MUL[818] ?? 1, tn.cx, tn.cy, this.ownerRef());
          pounceDirect = direct;
          // ★BJ455② settle 归位（BJ445② 同构,contactTown :4996 同式）：res.dmg 已含
          //  tag-crit 预倍 ×2（WhipTag.ts:848）→ 仅 res.crit 摘半还原防前值,crit=res.crit
          //  传参（TownNPC.hurt 防后×2+色一体 NPC.cs:82066;818=MinionShot 非
          //  SentryShot → 6176 golem 掷不达 :12962 门,crit 单源）。旧形 crit 缺=色缺
          //  +倍序偏离。kb=0 ⇒ StrikeNPC 双门不进（:82144,同敌怪环 F10）。
          return {
            dmg: res.crit ? res.dmg / 2 : res.dmg,
            crit: res.crit,
            kb: 0,
          };
        });
    }
    void this.ownerRef;
  }

  draw(r: import('../render/Renderer').Renderer): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projFrameImg(818, 0);
    // ★清偿刀 N：switch 覆写 818 → cMinion（Main.cs:22463-22465 无 damage/minion 门,
    //  扑击弹染属主 CritterShampoo 配对染料）——EntitySpriteDraw×Armor.Apply 等价。
    let tex: HTMLCanvasElement | null = img;
    if (img) {
      const p = this.ownerRef();
      const inv = (p as unknown as { inv?: DyeInvSource } | null)?.inv;
      if (inv) {
        const ch = dyeChannelsOf(inv);
        if (ch.cMinion > 0) {
          const dv = getProjDesiredDyeVid({ vid: 818, minion: false, damage: this.damage, aiStyle: projectileData(818)?.aiStyle }, ch);
          if (dv > 0) {
            tex = dyedProjCanvas(img, 0, 0, img.width, img.height, dv,
              { facing: 1, box: { x: this.x, y: this.y, w: this.w, h: this.h },
                lightAt: r.lighting?.lightAt?.bind(r.lighting) ?? null }) ?? img;
          }
        }
      }
    }
    // ---- ★BJ704-G2（债① 818 员）：通用残影（P(18,0,-2,1),先于本体=原版层序
    //      Main.cs:30609 块→本体段）。色=GHOST_TINT[818] OurFavoriteColor(255,231,69)
    //      ×num175 纯加法（A=0,Main.cs:31279-31290）;mode2 → rot=槽 oldRot、
    //      flip=dir^槽 dir;ai0=当前 a0（k 因子,延迟相 0 → 黑加法零贡献）;
    //      bodyW/H=SetDefaults 132 盒;tex 用未染本体（原版残影块在染料 pass 前）。 ----
    if (img && this.ghostRing.filled > 0) {
      drawProjGhosts(ctx, {
        ring: this.ghostRing,
        id: 818,
        tex: img,
        frames: 1,
        frame: 0,
        bodyW: this.w, bodyH: this.h,
        bodyRot: this.rot,
        bodyScale: 1,
        bodyAlpha: 1,          // 818 支整色替换——GetAlpha/Opacity 均不进 ghost 色
        ai0: this.a0, ai1: 0,
        timeLeft: 0,
        opacity: 1,
        vxLen: Math.hypot(this.ivx, this.ivy),
        spriteDirection: (Math.sign(this.ivx) || 1),
        mirror: (Math.sign(this.ivx) || 1) < 0,
      });
    }
    ctx.save();
    ctx.globalAlpha = this.op;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.rot);
    // ★BJ704-G2（债① 818 员）：spriteDirection=sign(vx) 镜像（AI_162 :47589 每子步
    //  写,DrawProjDirect FlipHorizontally）——旧缺翻转（左飞扑击虎镜像缺失）。
    if ((Math.sign(this.ivx) || 1) < 0) ctx.scale(-1, 1);
    ctx.imageSmoothingEnabled = false;
    if (tex) ctx.drawImage(tex, -tex.width / 2, -tex.height / 2);
    else {
      ctx.fillStyle = '#E8C060';
      ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    }
    ctx.restore();
  }
}

/** 玩家持有沙漠虎宝石数（ownedProjectileCounts[831]，:12107/:46388 等价） */
function countStormTigerGems(game: GameHooks): number {
  let n = 0;
  for (const e of (game as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles) {
    const m = e as MinionProj;
    if (m instanceof MinionProj && !m.dead && m.projId === 831) n++;
  }
  return n;
}

/** MathHelper.AngleTowards（:47591 cubeRot 用）：向 target 步进 maxAngle（最短弧） */
function angleTowards(cur: number, target: number, maxAngle: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const step = Math.max(-maxAngle, Math.min(maxAngle, d));
  return cur + step;
}

/** MathHelper.AngleLerp（AI_156 归位转向 :52527/:52547 用）：最短弧插值 */
function angleLerp(cur: number, target: number, amount: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * amount;
}

/** MathHelper.WrapAngle：钳到 (−π, π] */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

const clamp01 = (v: number): number => v < 0 ? 0 : v > 1 ? 1 : v;
