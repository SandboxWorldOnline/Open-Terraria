// 鞭投射物（原版 AI_165_Whip Projectile.cs:45006-45117 + FillWhipControlPoints
//  :45618-45681 + GetWhipSettings :45683-45761 1:1）：
//  生存期 ai[0] 0→timeToFlyOut（=itemAnimationMax×MaxUpdates :45685，每 tick 递增
//  MaxUpdates=extraUpdates+1；DefaultToWhip :10093-10105 宽高 18、localNPCHitCooldown=-1
//  →同敌每次挥动仅命中一次）。鞭形 = 固定锚点（玩家手部 GetPlayerArmPosition :37071）
//  出发的多段链：每段按 num4 相位角旋转累积（num5 伸展/收回包络 = 2/3 伸展 + 1/3 收回，
//  收回期整体绕锚点旋绕），命中 = 沿实际曲线每个控制点放 18×18 盒（Colliding
//  :14482-14494，getActualCollisionPoints 冻结随机相位 num13=1 :45654-45657）。
//  多目标伤害衰减 = 鞭自身 damage 字段在每次命中后 ×falloff（1457 Projectile.cs
//  :13453-13550 switch，第 n 个敌 ×falloff^(n-1)）；命中施加 tag（TagEffectState.
//  TryApplyTagToNPC TagEffectState.cs:87-93 + WhipTagEffect.cs:34-46）并启用 proc
//  （:13968-14013）。
// 渲染层（2026-08-23 重做,1457 Main.cs:36656-37670 DrawWhip 族 1:1）：鞭身 =
// FishingLine 染色线体沿控制点链逐段旋贴（:36756-36768,per-whip 色表 :36675-36748;
// 1028-1035 flag 末段少画 1 节 :36734-36736;1035 flag2 整条不画 :36726）,鞭尖 =
// 16 个专署 tip 函数（:36818-37669）竖向帧切片沿控制点排布（WHIP_TIPS 分发表）——
// 此前误用鞭贴图整条切片近似。光照色一律原色直画（实体层画在全屏光照合成前 =
// 合成自动乘光,StringLine 渔线段链既有口径）。
//
// ★通用湿段接入（2026-09-06 溅花缺口杂项批）：鞭族 18 型（841/847/848/849/912/913/
// 914/915/952/1028/1029/1030/1031/1032/1033/1034/1035/1104）SetDefaults 逐 id 核验
// 【均无 ignoreWater 行】——841 :8144-8146、847 :8157-8160(+extraUpdates 2)、
// 848 :8162-8164、849 :8166-8169(+extraUpdates 2)、952 :8987-8989、1028-1035
// :9738-9768、1104 :10293-10295（余 912-915 走 OR-链 DefaultToWhip 档亦无）,
// DefaultToWhip() :10706-10718 本身无 ignoreWater → 全员受段。
// ★位移模型定谳（AI_165_Whip :48539）：每【子步】AI 直写 Center =
// GetArmPosition() + velocity×(ai[0]−1)（:48550）→ 通用湿段(:16903,采样=该位)→
// UpdatePosition(:19973/:20561 `position += wetVelocity`)步进一拍。extraUpdates=1
// → MaxUpdates 2 子步/tick（847/849 extraUpdates=2 → 3 子步）,湿段随 Update 主体
// 在 numUpdates 子步循环内(:16781-17345)→【每子步各跑一次】。vel = 出膛向×shootSpeed
// 恒定 → 每子步采样盒 = arm + velocity×(ai0s−1)（ai0s=prevAi0+s）;tileCollide=false
// ⇒ wetVelocity 恒=velocity(:16870,阻尼算式仅在 HandleMovement tileCollide 支
// :17583/:17721)→ 阻尼 N/A。湿旗消费者：1104 火鞭 OnFire 中段窗 StatusNPC
// `!wet && ai[0]∈(t/3×2±1)`（:11262）——AI 先读【上一子步】段值、段后刷新（原文序),
// 旧 wetSnapshot 出生快照近似就此退役。
import { Entity } from './Entity';
import { applyProjStatus, applyBuffTicks, applyMeleeImbue, debuffWriteAllowed } from './projStatus';
import { hitTownNpcs, playerCanHitEnemy, applyBannerDamageDealt, noteVanillaProjImmune } from './projTargets';
import type { GameHooks } from './types';
import { BuffType } from '../stats/Buffs';
import { ConfettiBurstProj } from './meleeOnHitProjs';
import type { Player } from './Player';
import { projSprite } from './Arrow';
import { projectileWetSection } from './projWetSection';
import { projectileData } from '../data/vanillaProjectiles';
import { roundCSf32Mul, truncCSf32MulBias } from '../stats/ScaleStats';   // ★BJ640 词缀烘定（(int)Math.Round f32 银行家）+★BJ651 站④②GetWeaponDamage 截断
import { wetCollision, lavaCollision } from './npcLiquid';
import { meleeThirdOf, ZAPPING_JELLYFISH } from '../player/SwingPathMath';
import { MinionProj } from './MinionProj';
import { ghostHealProc } from './SpectreSoulProj';   // ★清偿刀 V2（2026-10-01）ghostHeal 白耗面（U2 家族债鞭域残留）;★S3b 快照判据退役（前置门 1:1 上位,见 tryHit）
import { Arrow } from './Arrow';
import { tintedTex } from '../render/StringLine';
import { prettyStarSparkle } from '../render/Renderer';
import { ITEM_DEFS } from '../data/items';
import { combatWeapon } from '../data/vanillaItemCombat';
// L5 长尾批：月主鞭命中编排（Spawn_MoonLordWhip :1653-1710 收编本体）
import { moonLordWhipHitFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';
import {
  WHIP_TAG, WHIP_HIT_BUFF, WHIP_HIT_SIDEKICK,
  WHIP_SEGMENTS, WHIP_RANGE, WHIP_FALLOFF, WHIP_PROC_ITEMS, WHIP_PROC_ONCE_ITEMS,
  WHIP_EXTRA_UPDATES,
} from './WhipTag';

export {
  WHIP_TAG, WHIP_TAG_CRIT, WHIP_TAG_BUFF, WHIP_HIT_BUFF, WHIP_HIT_SIDEKICK,
  WHIP_SEGMENTS, WHIP_RANGE, WHIP_FALLOFF, WHIP_PROC_ITEMS,
} from './WhipTag';
export { whipTagDamageOf, resolveWhipTagHit } from './WhipTag';
export type { WhipTagged } from './WhipTag';

/** ★BJ638 鞭攻速合流（原版 Player.cs:29253-29262 CapAttackSpeeds + :4461 鞭动画支）：
 *  用时倍率 = whipUseTimeMultiplier × 1/min(3, meleeSpeed + swb)。近战攻速速度面
 *  （attackSpeedMult 倒数还原 = min(3, meleeSpeed)）与鞭 buff 总和 swb（UpdateBuffs
 *  :10200-10208：311 +0.35 / 308 +0.25 / 314 +0.12）在取倒数【前】加算合流；黑曜套
 *  whipUseTimeMultiplier ×= 1/1.15（Terraria.DataStructures/ArmorSetBonuses.cs
 *  ObsidianOutlaw :120-127）——乘在【用时倍率】上,绝非 buff 和系数。封顶单调性保证
 *  「先还原后加算再封顶」与原版「先加算后封顶」同值。attackSpeedMult 入参 = 本仓
 *  Player.attackSpeedMult（CapAttackSpeeds 倒数档镜像,桩面可用 1=无加成）。
 *  消费位：Game.ts 鞭支 useTime/挥动窗 + 本文件 ctor anim（itemAnimationMax →
 *  timeToFlyOut,GetWhipSettings :49219-49221）。 */
export function whipUseTimeFold(attackSpeedMult: number, swb: number, whipSpd: number): number {
  const meleeSpeed = 1 / (attackSpeedMult || 1);   // CapAttackSpeeds 逆还原（=min(3,速度面)）
  return whipSpd / Math.min(3, meleeSpeed + swb);
}

/** 2D 向量最小形状 */
interface V2 { x: number; y: number }
const v2 = (x: number, y: number): V2 => ({ x, y });

/** Main.OffsetsPlayerOnhand 原表（1458 Main.cs:506-528，20 档按 bodyFrame.Y/56 行索引）
 *  ——GetArmPosition 的持械帧臂位基准；×2 后参与锚点合成（Player.cs:51211）。 */
export const OFFSETS_PLAYER_ONHAND: ReadonlyArray<readonly [number, number]> = [
  [6, 19], [5, 10], [12, 10], [13, 17], [12, 19], [5, 10], [7, 17], [6, 16],
  [6, 16], [6, 16], [6, 17], [7, 17], [7, 17], [7, 17], [8, 17], [9, 16],
  [9, 12], [8, 17], [7, 17], [7, 17],
];
/** Player 身架帧矩形（Player.cs bodyFrame 固定 40 宽/56 高——:4188/:4192 取值面） */
export const PLAYER_BODY_FRAME_W = 40;
export const PLAYER_BODY_FRAME_H = 56;
const lerpV = (a: V2, b: V2, t: number): V2 => v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const rotV = (ang: number): V2 => v2(Math.cos(ang), Math.sin(ang));
/** Vector2.RotatedBy(angle, origin) */
const rotAround = (p: V2, origin: V2, ang: number): V2 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = p.x - origin.x, dy = p.y - origin.y;
  return v2(origin.x + dx * c - dy * s, origin.y + dx * s + dy * c);
};
/** Utils.Remap（value∈[from1..to1] → 线性映射到 from2..to2，区间外截断） */
const remap = (value: number, from1: number, to1: number, from2: number, to2: number): number => {
  if (value <= from1) return from2;
  if (value >= to1) return to2;
  return from2 + (to2 - from2) * (value - from1) / (to1 - from1);
};

/** Projectile.ApplyWhipDebuffs 1:1（Projectile.cs:11067-11090,StatusNPC :10670 逐命中调用）：
 *  913 火鞭 Firecracker → OnFire3(323) 240t=4s（NPC -30 lifeRegen=15HP/s）；
 *  912 酷鞭 Cool Whip → Frostburn2(324) 240t=4s（-50=25HP/s）——两者此前误并入
 *  OnFire(24) 4s 近似（-8=4HP/s）,2026-08-14 对齐分档；914 荆棘鞭 Snapthorn →
 *  1/5 AddBuff(20,180)；1033 电鳗鞭 5478 → 362/240（1457 重做：362=markedByEelWhip
 *  从"链电标记"改 DOT 表平铺 Add(100,50)=50 HP/s,NPC.cs:92781——链式缩放/标记
 *  玩家数/链电粒子全删,ApplyEelWhipDoT 成死代码）；849 黑收成 Dark Harvest →
 *  310/240 = markedByScytheWhip 仅视觉粒子（:92188,无数值效果）——不落本仓字段 */
export function applyWhipDebuffs(projId: number, enemy: Record<string, number>): void {
  // ★ImmuneToAll 直写闸（2026-09-03,projStatus.debuffWriteAllowed）：原版各分支经
  //  NPC.AddBuff 过 buffImmune 门（NPC.cs:90968）——68 守卫/72 火轮/134-136 机械蠕虫
  //  等 37 键 ImmuneToAll 名单此前照写。闸在掷后零掷耗（914 的 1/5 掷在闸前=掷流
  //  不变）;362 是鞭 tag 本体（WHIP_NPC_DEBUFF{310,362}）→ 仅 +Whips 档（68/72/392…）
  //  免疫,非鞭档放行——逐 buff 谓词自持该差异。dontTakeDamage 环头门（tryHit 循环
  //  :501-503）已排靶,此处为 AddBuff 闸位补全（双保险）
  if (projId === 913 && debuffWriteAllowed(enemy, 323)) enemy.onFire3T = Math.max(enemy.onFire3T ?? 0, 4);        // AddBuff(323,240)
  else if (projId === 912 && debuffWriteAllowed(enemy, 324)) enemy.frostburn2T = Math.max(enemy.frostburn2T ?? 0, 4); // AddBuff(324,240)
  else if (projId === 914 && Math.random() < 0.2 && debuffWriteAllowed(enemy, 20)) enemy.poisonT = Math.max(enemy.poisonT ?? 0, 3); // 1/5 AddBuff(20,180)
  // 1457 重做（NPC.cs:92781-92784）：电鳗鞭 1033 → 362 markedByEelWhip = DOT 表平铺
  //  Add(100,50)=50 HP/s（链式缩放/标记玩家数前置/链电粒子全删，ApplyEelWhipDoT 成
  //  死代码）——1456 的"标记无 DoT 语义"登记作废，落 eelWhipT（Enemy DOTTally 段消费）
  else if (projId === 1033 && debuffWriteAllowed(enemy, 362)) enemy.eelWhipT = Math.max(enemy.eelWhipT ?? 0, 4);  // AddBuff(362,240)
  // 849→310：markedByScytheWhip 仅视觉粒子（:92188 BlackLightningSmall,无数值效果,
  //  两版 Next(3) 均不变）——本仓无粒子管线,不写字段（登记）
}

export class WhipProj extends Entity {
  w = 18; h = 18; // DefaultToWhip :10096-10097
  dead = false;
  /** 原版鞭投射物 id */
  projId: number;
  /** 鞭物品 id（tag 查表） */
  itemId: number;
  damage: number;
  knockback: number;
  /** 词缀 bonusTagDamage（I:567——Game 侧注入；1457 管线本为命中弹自带字段,
   *  本仓挂 tag 态随 applyTagToNPC 传递（登记偏差,见 WhipTag.applyTagToNPC 注） */
  bonusTagDmg = 0;
  /** useAnimation（鞭 JSON anim；SetItemAnimation 攻速 buff 后的有效值） */
  anim: number;
  /** shootSpeed（=velocity.Length()，曲线长度基数 :45643） */
  speed: number;
  /** ai[0]：update 计数（每 tick +MaxUpdates，:45014 每 update +1） */
  private ai0 = 0;
  /** ai[1]：每次挥动随机相位 -1..1（:45015；子鞭生成处重掷 :45047） */
  private ai1: number;
  /** ai[2]：月主鞭补鞭计数（≥10 = 补出的子鞭 :45025/:45047） */
  ai2 = 0;
  /** MaxUpdates = extraUpdates+1（:45685 timeToFlyOut 乘子；847/849 extraUpdates=2
   *  :7862-7885，其余 DefaultToWhip extraUpdates=1 :10103） */
  private maxUpdates: number;
  /** rotation = velocity.ToRotation()+PI/2（:45013，生存期内恒定） */
  private rotation: number;
  /** spriteDirection（:45018：velocity.X≥0 → 1） */
  private spriteDir: number;
  /** 鞭当前伤害（衰减链直接乘此字段 :12604-12678） */
  private dmgNow: number;
  /** 本挥动已命中敌（localNPCHitCooldown=-1 → 每敌一次 :10104） */
  private hitSet = new Set<number>();
  /** 受理命中数（Projectile.numHits 等位,:14263 受理拍自增;ghostHeal proc 读自增前值
   *  → 率 0.2−0.05n 衰减计数源,首跳 0 档 0.20——U2/V2 家族习语同式） */
  pveNumHits = 0;
  /** 星座星每挥动一次门（case 1034 localAI[0]==0 :14001-14007） */
  private localAI0 = 0;
  /** localAI[1]（AI_165 :48541-48543：1035 首次更新 1+Main.rand.Next(3)——月主鞭
   *  尾帧行号,消费点 DrawWhip_MoonLordWhip :37067;其余鞭恒 0。原版在首次 AI 更新
   *  掷,本仓提前到 ctor——纯视觉帧档,等价） */
  private lai1: number;
  /** 蛇环补挥标记（补挥不再级联补挥;原版经 withAudioVisualFeedback=false 分支无动画自然不触发） */
  isEcho = false;
  // ---- ★通用湿段旗（ProjWetFlags 同形;projectileWetSection 共享体逐子步维护）----
  wet = false;
  lavaWet = false;
  honeyWet = false;
  shimmerWet = false;
  /** 出水溅花冷却窗（Projectile.wetCount :16984 置 10 / :17109-17112 逐子步折减） */
  wetCount = 0;
  /** 出生预置已做（NewProjectile :10886-10892 等价——首子步 AI 读出生旗,故在首次
   *  tryHit 处预置而非段调用时;wetSnapshot 出生快照近似退役,见 tryHit 注） */
  presetDone = false;
  /** 鞭弹 velocity（AI_165 :48550 Center 式 + 1035 尾尘 弹向 消费）——出膛向×shootSpeed,
   *  生存期恒定（AI_165 不改写）;wet 段采样盒与阻尼定谳见文件头注 */
  private readonly wvx: number;
  private readonly wvy: number;
  /** proc 启用门（case 913/1031/1032 localAI[0]==0 :13970-13977；847/1033/1035 无门） */
  private procEnabled = false;
  private ownerRef: () => Player | null;
  /** 月主鞭补鞭瞄准（Game 注入鼠标方向；缺省沿用初始朝向 :45045-45046） */
  private aimAng: () => number;

  constructor(
    x: number, y: number, ang: number, projId: number, itemId: number,
    damage: number, knockback: number, anim: number, speed: number,
    owner: () => Player | null,
    aimAng?: () => number,
    /** ★BJ640（2026-10-11）词缀 spd 烘定（Item.Prefix :567 useAnimation=(int)Math.Round
     *  (useAnimation×spd)——鞭词缀池=PrefixesForSwords,Light/Rapid 等旧式整缺;
     *  Game.ts 鞭支传 heldPrefixStat().spd,缺省 1=BJ638 测试桩零漂移） */
    prefixSpd = 1,
  ) {
    super();
    this.x = x; this.y = y;
    this.projId = projId;
    this.itemId = itemId;
    this.knockback = knockback;
    this.speed = speed;
    this.wvx = Math.cos(ang) * speed;                 // velocity = 出膛向×shootSpeed（:48550 消费）
    this.wvy = Math.sin(ang) * speed;
    this.aimAng = aimAng ?? (() => ang);
    this.rotation = ang + Math.PI / 2; // :45013
    this.spriteDir = Math.cos(ang) >= 0 ? 1 : -1; // :45018
    this.ai1 = Math.random() * 2 - 1; // ai[1] = Main.rand.NextFloatDirection()
    this.lai1 = projId === 1035 ? 1 + Math.floor(Math.random() * 3) : 0; // :48541-48543
    this.maxUpdates = (WHIP_EXTRA_UPDATES.has(projId) ? 2 : 1) + 1;
    this.ownerRef = owner;
    // 鞭攻速（SetItemAnimation：summonerWeaponSpeedBonus × whipUseTimeMultiplier 封顶
    //  3×——buff 311/308/314 来源，与 Game.ts useTime 同式）
    const o = owner();
    // 邪恶臂镯族击退 +1（ItemCheck_Shoot :49159-49163：accWickedArmlet → KnockBack += 1;
    //  6159 本体/6163 TwilightGrasp/6179 ArmletOfRuin/6182 WickedClaws 经 SUMMON_GEAR
    //  旗聚合到 equipStats.accWickedArmlet——出鞭时刻定值,与原版 NewProjectile 前一致）
    if (o?.equipStats.accWickedArmlet) this.knockback += 1;
    const swb = o ? (o.whipBuffs[311] ? 0.35 : 0) + (o.whipBuffs[308] ? 0.25 : 0)
      + (o.whipBuffs[314] ? 0.12 : 0) : 0;
    // ★BJ638（2026-10-11）：anim = itemAnimationMax（SetItemAnimation :4461 鞭支 →
    //  GetWhipSettings :49220 timeToFlyOut = itemAnimationMax × MaxUpdates）——
    //  meleeSpeed + swb 加算合流、whipSpd 乘用时倍率,与 Game.ts useTime 同折
    //  （whipUseTimeFold 注）。旧式 1+swb×whipSpd 漏 meleeSpeed（鞭对攻速饰品全免疫
    //  =用户实报）且把 1/1.15 错乘进 buff 和；（int) 截断 =原版 SetItemAnimation
    //  :4445 val=(int)(base×mult),非 round
    //  ★BJ640（2026-10-11）：词缀 spd 先烘定（:567 (int)Math.Round f32 银行家）再乘
    //  fold——原版烘定序=词缀整数化在前、攻速乘区在后
    this.anim = Math.max(1, Math.floor(roundCSf32Mul(anim, prefixSpd) * whipUseTimeFold(
      (o?.attackSpeedMult as number | undefined) ?? 1, swb, o?.equipStats.whipSpd ?? 1)));
    this.damage = damage;
    // ★BJ651-R2 站④②（2026-10-12）：第二乘区=GetWeaponDamage（Player.cs:54066
    //  `(int)((float)damage × GetWeaponDamageMultiplier + 5E-06f)`,鞭 summon→
    //  minionDamage）——Game 鞭支 NewProjectile Damage 实参同位。第一乘区=词缀烘定
    //  （Game 鞭支 :19796 roundCSf32Mul,ctor 形参即烘定基）。旧 f64 Math.round 无偏置
    //  =中点档差 1（鞭 4678 裸词缀×summon 1.1: 55→60.5 原版 60/旧 61）
    this.dmgNow = Math.max(1, truncCSf32MulBias(o ? o.summonDamageMult : 1, damage)); // ⑥ pen 移 hurt 参
  }

  /** GetWhipSettings（:45683-45761） */
  get segments(): number { return WHIP_SEGMENTS[this.projId] ?? 20; }
  get rangeMultiplier(): number { return WHIP_RANGE[this.projId] ?? 1; }
  /** timeToFlyOut（GetWhipSettings :49219-49230）：itemAnimationMax × MaxUpdates
   *  （:45685；月主子鞭 ai2≥10 固定 30 :45755-45758）;ai2≥1000 通道 = 蛇环补挥
   *  （ItemCheck_Shoot !withAudioVisualFeedback :49171 ai6=1000+itemAnimationMax×2 →
   *  timeToFlyOut = ai2−1000,不再乘 MaxUpdates——蓝队 R7-40：847/849 补挥曾 ×3/2×
   *  于原版;该通道同时天然压制 1035 补鞭（ai2≥10 门）,与原版一致） */
  get timeToFlyOut(): number {
    if (this.ai2 >= 1000) return this.ai2 - 1000;
    return (this.ai2 >= 10 && this.projId === 1035 ? 30 : this.anim) * this.maxUpdates;
  }
  /** 锚点 = Player.GetArmPosition 1:1（1458 Player.cs:51206-51225；:4185-4198 同式
   *  ItemLocation 支）。台账批 B 档：曾取玩家中心近似 → 鞭形整体平移 ~8-10px；
   *  现按持械帧臂位偏移链落地：
   *    vector = Main.OffsetsPlayerOnhand[bodyFrame.Y/56] × 2（Main.cs:506-528）
   *    direction≠1 → vector.X = bodyFrame.Width−vector.X（40 宽镜像 :4186-4189）
   *    gravDir≠1   → vector.Y = bodyFrame.Height−vector.Y（56 高翻转 :4190-4193）
   *    pos = MountedCenter − (20,42)/2 + [onhand×2 − ((40−20)/2,(56−42)/2)]（:4195-4196）
   *    坐骑 52（狼形态）支：pos.Y −= mount.PlayerOffsetHitbox、pos += (12×dir,−12)
   *    （:51617-51620——offsetHitbox = −PlayerOffset+heightBoost,Mount.cs:427-433）；
   *    ApplyItemPositionOffsetFromMount 的 52/54 手持位偏移大表（:52017-52060+）未接,
   *    登记在案（骑乘态鞭锚的 ±14px 级微差）；RotatedRelativePoint 经 owner 同名
   *    方法走 fullRotation 旋转（本仓 Player.rotatedRelativePoint 1:1 已存）。
   *  持械帧行（bodyFrame 行）= useStyle1 三相 行1/2/3，与 Renderer.useStyleBodyRow
   *  共表 meleeThirdOf(:35882-35895/:36596)：itemAnimation 计数下行 =
   *  max − ai0/MaxUpdates；挥窗已尽（echo/补挥通道）退回行 3 收势档，登记。 */
  private armPos(): V2 {
    const o = this.ownerRef() as unknown as {
      x: number; y: number; w: number; h: number;
      facing: number; gravDir?: number; mountedCenter?: { x: number; y: number };
      rotatedRelativePoint?(px: number, py: number): { x: number; y: number };
      mount?: { active?: boolean; type?: number; playerOffset?: number;
        data?: { heightBoost?: number } | null } | null;
    } | null;
    if (!o) return v2(this.x, this.y);
    // bodyFrame 行：useStyle1 三相（Renderer 共表 meleeThirdOf；倒计时窗内换行）
    let row = 3;
    const maxAnim = Math.max(1, this.anim);                       // itemAnimationMax
    if (this.ai0 < this.timeToFlyOut) {
      const remain = Math.max(0, this.timeToFlyOut - this.ai0) / this.maxUpdates;
      row = meleeThirdOf(remain, maxAnim) === 'tail' ? 3
        : meleeThirdOf(remain, maxAnim) === 'mid' ? 2 : 1;
    }
    let vx = OFFSETS_PLAYER_ONHAND[row][0] * 2;
    let vy = OFFSETS_PLAYER_ONHAND[row][1] * 2;
    if (o.facing !== 1) vx = PLAYER_BODY_FRAME_W - vx;            // :4188
    if ((o.gravDir ?? 1) !== 1) vy = PLAYER_BODY_FRAME_H - vy;    // :4192
    vx -= (PLAYER_BODY_FRAME_W - o.w) / 2;                        // :4194 前半
    vy -= (PLAYER_BODY_FRAME_H - 42) / 2;                         // BaseHeight=42
    const mcx = o.x + o.w / 2;
    const mcy = o.mountedCenter?.y ?? o.y + o.h / 2;
    let px = mcx - o.w / 2 + vx;                                  // :4196 MC − (w,BH)/2 + vector
    let py = mcy - 42 / 2 + vy;
    const mnt = o.mount;
    if (mnt?.active && mnt.type === 52) {                          // :51617-51620
      // PlayerOffsetHitbox = −PlayerOffset + heightBoost（Mount.cs:427-433）→
      // pos.Y −= offsetHitbox ≡ pos.Y += PlayerOffset − heightBoost；再加 (12×dir,−12)
      py += (mnt.playerOffset ?? 0) - (mnt.data?.heightBoost ?? 0);
      px += 12 * o.facing;
      py += -12;
    }
    // ApplyItemPositionOffsetFromMount 表（:52017+）与 Wolf/Raptor 贴图层修正未接(登记)
    if (o.rotatedRelativePoint) {
      const rp = o.rotatedRelativePoint(px, py);
      return v2(rp.x, rp.y);
    }
    return v2(px, py);
  }
  /** owner.whipRangeMultiplier（:45642；提基/星尘/黑曜来源） */
  private get whipRangeMultiplier(): number {
    const o = this.ownerRef();
    return o ? 1 + (o.equipStats.whipRange ?? 0) : 1;   // ★BJ175 桩面 ?? 防御（缺省 0=加算池）
  }
  /** 当前挥动进度 ai[0]/timeToFlyOut（:45625） */
  get progress(): number { return this.ai0 / this.timeToFlyOut; }

  /**
   * FillWhipControlPoints 1:1（:45618-45681）：锚点出发 segments 段链。
   *  getActualCollisionPoints=true 时随机相位 ai[1] 冻结为 1（:45654-45657）——
   *  命中曲线与视觉曲线（带随机卷曲）分离，与原版一致。
   *  ai0Override 供逐 update 碰撞插值（原版每 update 跑一次 AI+Damage :15336-15340）。
   */
  pointsAt(ai0Override: number, getActualCollisionPoints: boolean): V2[] {
    const ai0 = ai0Override;
    const segments = this.segments;
    const rangeMul = this.rangeMultiplier;
    let num = ai0 / this.timeToFlyOut; // :45625
    if (this.projId === 1028) num = remap(num, 0, 1, 0.3, 0.95); // :45626-45629
    const num2 = 0.5;               // :45630
    const num3 = 1 + num2;          // :45631（Y 压扁系数 + 收回门）
    // :45632 每段相位角步进（伸展期正向、收回期反向卷绕）
    const num4 = Math.PI * 10 * (1 - num * num3) * -this.spriteDir / segments;
    let num5 = num * num3;          // :45633 伸展量
    let num6 = 0;                   // :45634 收回进度
    if (num5 > 1) {                 // :45635-45639（num>2/3 起收回）
      num6 = (num5 - 1) / num2;
      num5 = 1 - num6;
    }
    // :45640-45642 num7 = useAnimation×2 × num × whipRangeMultiplier
    const num7 = this.anim * 2 * num * this.whipRangeMultiplier;
    // :45643 每段步长（velocity.Length() = shootSpeed）
    const num8 = this.speed * num7 * num5 * rangeMul / segments;
    const arm = this.armPos();
    // :45647-45651 三条链尾初始角
    let num10 = -Math.PI / 2;
    let num12 = Math.PI / 2;
    let num11 = Math.PI / 2 + Math.PI / 2 * this.spriteDir;
    let vec = arm;      // vector（:45646）
    let vec3 = arm;     // vector3（:45650）
    let vec2 = arm;     // vector2（:45648）
    const pts: V2[] = [arm]; // :45652
    const num13 = getActualCollisionPoints ? 1 : this.ai1; // :45653-45657
    for (let i = 0; i < segments; i++) {
      const num14 = i / segments;   // :45660
      const num15 = num4 * num14 * 1 * num13; // :45661（num9 恒 1）
      const vector4 = v2(vec.x + rotV(num10).x * num8, vec.y + rotV(num10).y * num8);   // :45662
      const vector5 = v2(vec3.x + rotV(num12).x * num8 * 2, vec3.y + rotV(num12).y * num8 * 2); // :45663
      const vector6 = v2(vec2.x + rotV(num11).x * num8 * 2, vec2.y + rotV(num11).y * num8 * 2); // :45664
      const num16 = 1 - num5;       // :45665
      const num17 = 1 - num16 * num16; // :45666
      const value = lerpV(vector5, vector4, num17 * 0.9 + 0.1);  // :45667
      const vector7 = lerpV(vector6, value, num17 * 0.7 + 0.3);  // :45668
      // :45669 相对锚点缩放（Y×num3）
      const spin = v2(arm.x + (vector7.x - arm.x), arm.y + (vector7.y - arm.y) * num3);
      const num18 = num6 * num6;    // :45670-45671 收回旋绕量
      // :45672 收回期整体绕锚点旋绕（4.712389 = 3π/2）
      pts.push(rotAround(spin, arm, this.rotation + 4.712389 * num18 * this.spriteDir));
      num10 += num15; num12 += num15; num11 += num15; // :45674-45676
      vec = vector4; vec3 = vector5; vec2 = vector6;  // :45677-45679
    }
    return pts;
  }

  /** 当前控制点（命中曲线 / 视觉曲线） */
  controlPoints(getActualCollisionPoints: boolean): V2[] {
    return this.pointsAt(this.ai0, getActualCollisionPoints);
  }

  fixedUpdate(_dt: number, game: GameHooks) {
    const owner = this.ownerRef();
    const prevAi0 = this.ai0;
    // ★F5 定谳+回滚（2026-09-08 残差五件批⑤）：原台账「AI_165 :49309-49331 owner-flag
    //   五支=CCed/noItems/held.shoot!=type/pulley/dead」系【行段误锚】——1457 :49309-49333
    //   实为 AI_160_Kites（:49303 起风筝 AI,五支 :49309-49324+Kill :49329-49333;
    //   1456 :45769-45791 同构）的五支;AI_165_Whip（:48539-49152）全支【零】owner 态
    //   杀门（CCed/noItems/pulley/dead/shoot 逐支扫描零命中）,唯一 Kill=ai[0] ≥
    //   timeToFlyOut（:48552-48556;1456 :45019-45022）——玩家死亡/冻结鞭照常飞满程
    //   （锚点仍随玩家 arm :48550）。旁证：Projectile.IsInterruptible/Interrupt
    //   （:22370-22390）也只认 aiStyle==160,鞭不可被切栏打断。→ 旧 owner.dead→Kill
    //   早退门系同一误锚产物,本批回滚（原版=主人死后鞭飞满 timeToFlyOut 段）;五支
    //   不存在由 tests/proj-wet-residual5 结构锁钉死防回灌。
    this.ai0 += this.maxUpdates; // 每 update ai[0]+1（1457 :48547;1456 :45014）
    if (this.ai0 >= this.timeToFlyOut) {
      // :48552-48556 Kill（1456 :45019-45022）——原文湿段在该子步仍跑（AI 写位后
      // Kill,湿段无 active 门:16903;采样盒=本子步 AI 直写位）。本类再无任何 owner 态
      // 早退门（误锚产物已回滚）→ 不存在"早退拍跳湿段"路径
      const b = this.wetBoxAt(this.ai0);
      projectileWetSection(this, game, game.world.store, b.x, b.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
      this.dead = true; return;
    }
    // 锚点载体钉在玩家身上（锚点=手部位置，见 armPos；proj 本体随 velocity 前漂
    //  :45017 由曲线相对锚点表达）
    if (owner) { this.x = owner.cx; this.y = owner.cy; }
    // ---- 命中：每 update 沿实际曲线逐控制点放 18×18 盒（Colliding :14482-14494；
    //  Damage 每 update 跑一次 :15336-15340，此处按 MaxUpdates 插值等价）----
    for (let s = 1; s <= this.maxUpdates; s++) {
      const ai0s = prevAi0 + s;
      const pts = this.pointsAt(ai0s, true);
      this.cutTilesAlong(game, pts);   // CutTiles（:15292-15300,蓝队 R7-38 整缺）
      this.tryHit(game, owner, pts, ai0s);
      // ---- ★通用湿段（:16903-17113,共享体;溅花尘/音=wetSplashStepShared 弹面 10 粒）----
      // 每子步一次（Update 主体在 numUpdates 子步循环内 :16781-17345）;采样盒=
      // AI_165 直写 Center（:48550,arm+velocity×(ai0s−1),见文件头注/位移模型定谳）;
      // tryHit 先读上子步旗、本调用后刷新 = 原文 AI→湿段序
      const wb = this.wetBoxAt(ai0s);
      projectileWetSection(this, game, game.world.store, wb.x, wb.y, this.w, this.h,
        this.projId, !!projectileData(this.projId)?.ignoreWater);
    }
    // ---- 半程鞭尖音（AI_165 :45051-45070）：ai[0] 到达 (int)(timeToFlyOut/2f) 那一
    //  update,在鞭尖（FillWhipControlPoints 缺省视觉曲线 :45618 getActualCollisionPoints=
    //  false,控制点末位 = 鞭尖 :45052-45054）播音,按弹体 id 分档：1029→NPCDeath1
    //  （音量 ×0.6,PlaySound(style,pos,pitchOffset=0,volumeScale=0.6) :45057,Legacy
    //  形参序 SoundEngine.cs:88）、1030→NPCHit9（:45061）、1033→Item193（:45065）、
    //  其余全部→Item153（:45069）。本仓 ai0 每 tick 跳 maxUpdates（原版逐 update +1
    //  精确相等）→ 过半沿判定（与蛇环补挥同式 :267）;曲线取 half 时刻快照
    //  （原版 ai[0]==half 当拍求值,过沿 tick 最多滞后 maxUpdates-1 update）----
    const half = Math.floor(this.timeToFlyOut / 2); // (int)(timeToFlyOut/2f) :45051
    if (prevAi0 < half && this.ai0 >= half) {
      const pts = this.pointsAt(half, false);
      const tip = pts[pts.length - 1]; // :45054
      if (this.projId === 1029) game.playSfxFiles(['NPC_Killed_1'], 0.6, tip.x, tip.y);       // SoundID.NPCDeath1 :45057
      else if (this.projId === 1030) game.playSfxFiles(['NPC_Hit_9'], 1, tip.x, tip.y);       // SoundID.NPCHit9 :45061
      else if (this.projId === 1033) game.playSfxFiles(['Item_193'], 1, tip.x, tip.y);        // SoundID.Item193 :45065
      else game.playSfxFiles(['Item_153'], 1, tip.x, tip.y);                                  // SoundID.Item153 :45069
    }
    // ---- 月主鞭 1035 多重补鞭（:45038-45048：ai[2] < ai[0]/timeToFlyOut×3 时补一鞭
    //  并 ai[2]+1——全程累计补 3 鞭；子鞭 ai[2]≥10 不再补且固定 30t 寿命 :45755-45758）----
    if (this.projId === 1035 && this.ai2 < 10 && owner) {
      const num2 = this.progress * 3; // :45041
      if (this.ai2 < num2) {
        this.ai2 += 1; // :45044
        // 子鞭伤 = 母鞭当前 damage 字段（:48596-48610 NewProjectile 读现值——衰减链
        //  :13497-13540 直接改写弹体 damage,母鞭已命中 N 敌后补鞭 = 满伤×0.95^N）。
        //  蓝队 R7-39：曾传 this.damage（恒满伤）。本仓 ctor 会再乘召唤乘区,
        //  故先除回（dmgNow 已含乘区+衰减,还原出衰减后的"基伤"再进 ctor）
        const lashBase = this.dmgNow / (owner.summonDamageMult || 1);
        const lash = new WhipProj(owner.cx, owner.cy, this.aimAng(), this.projId, this.itemId,
          lashBase, this.knockback, 30, this.speed,
          () => owner, this.aimAng);
        lash.ai2 = 10 + this.ai2; // :45047（≥10 = 子鞭标记）
        (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(lash, 'projectiles');
      }
    }
    // ---- 蛇环补挥（accSnakeBand,ItemCheck_ManageUsage :43041-43063）：真挥计数
    //  repeatWhipSwings % 3 == 0 且物品动画过半（本仓代理 = 鞭 ai0 过 timeToFlyOut/2,
    //  同一时刻）→ 补挥一鞭：maxTagEffects>1 时从手持+1 起扫背包取下一把 IsAWhip,
    //  否则同件;伤 = GetWeaponDamage×0.3（min 3）/击退 ×0.25/朝向散布 ±0.314rad
    //  （ItemCheck_Shoot !withAudioVisualFeedback 分支 :49165-49182:num169=0.3 伤/
    //  num170=0.25 击退——蓝队 R2-09 勘误,曾误把击退系数抄给伤害）——无音效无动画。
    //  登记偏差：原版 GetWeaponDamage 含玩家伤害乘区+词缀,本仓取鞭表基伤
    //  （combatWeapon whip.dmg）×召唤乘区在 ctor 内,词缀不并入 ----
    if (owner?.equipStats.accSnakeBand && !this.isEcho && this.ai2 < 10
      && owner.repeatWhipSwings >= 0 && owner.repeatWhipSwings % 3 === 0
      && prevAi0 < this.timeToFlyOut / 2 && this.ai0 >= this.timeToFlyOut / 2) {
      let echoItem = this.itemId;
      let echoProj = this.projId;
      let echoDmg = this.damage;
      let echoKb = this.knockback;
      let echoAnim = this.anim;
      let echoSpeed = this.speed;
      if (owner.maxTagEffects > 1) {
        // ★SW-RB4a 2026-09-06 原版扫描窗 = selectedItem+1..49（Player.cs:43055）——
        // 光标持物伪选中（PickItemSelectionOverride→selectedItem==58）时窗口 59..49
        // 为空 = 不扫,sItem 保持本鞭（同鞭回声）。本仓伪选中以 inv.cursorMirror 表达、
        // 不写 selected,故须显式短路（曾用热栏 selected+1 扫描 = 镜像鞭打出异鞭回声）
        const from = owner.inv.cursorMirror ? 50 : owner.inv.selected + 1;
        for (let k = from; k < 50; k++) {
          const s = owner.inv.slots[k];
          if (!s) continue;
          const d = ITEM_DEFS[s.id];
          if (!d) continue;
          const cw2 = combatWeapon(d);
          if (cw2?.kind !== 'whip') continue;
          echoItem = cw2.itemId; echoProj = cw2.shoot;
          echoDmg = Math.max(1, Math.round(cw2.damage)); echoKb = cw2.knockback;
          echoAnim = cw2.useTime; echoSpeed = cw2.shootSpeed;
          break;
        }
      }
      const echo = new WhipProj(owner.cx, owner.cy,
        this.aimAng() + (Math.random() * 2 - 1) * 0.3141593, echoProj, echoItem,
        Math.max(3, Math.trunc(echoDmg * 0.3)), echoKb * 0.25, echoAnim, echoSpeed,
        () => owner, this.aimAng);
      echo.isEcho = true;
      echo.ai2 = 1000 + echoAnim * 2;   // ai6=1000+itemAnimationMax×2（Player.cs:49171）
      (game as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add(echo, 'projectiles');
    }
    // ---- AI_165 尾段逐鞭拖尾尘（WHIP_TRAIL_DUST 表,R31 §B② P1）——原版每 update
    // 跑一次（:48660 switch 在 AI_165 内）,此处随命中循环同拍逐 update 调用;
    // 曲线取该 update 快照（FillWhipControlPoints getActualCollisionPoints=false 视觉曲线）
    const fn = WHIP_TRAIL_DUST[this.projId];
    if (fn) {
      const facing = owner?.facing ?? this.spriteDir;
      for (let s = 1; s <= this.maxUpdates; s++) {
        const ai0s = prevAi0 + s;
        fn({
          game,
          pts: this.pointsAt(ai0s, false),
          env: whipSwingEnvelope(ai0s / this.timeToFlyOut),
          t: ai0s / this.timeToFlyOut,
          facing,
          hue: owner?.miscCounterNormalized ?? 0,   // ★BJ703-B D4（P.cs:48741 player.miscCounterNormalized）
          pvx: owner?.vx ?? 0, pvy: owner?.vy ?? 0,
          vx: this.wvx, vy: this.wvy,   // proj.velocity（:48853 支 1035 弹向消费;旧传空 vx/vy）
        });
      }
    }
  }

  /** CutTiles（Projectile.cs:15292-15300 `Sets.IsAWhip[type]` 支）：FillWhipControlPoints
   *  后逐控制点 `PlotTileLine(点−(w×scale/2,0), 点+(w×scale/2,0), h×scale, CutTiles)`
   *  ——鞭全程割草族/瓦罐/蛛网（Damage() 内旁路副作用,不拦命中）。蓝队 R7-38 整缺：
   *  召唤师用鞭清草/开罐手感缺失。PlotTileLine 直线光栅 ≈ 控制点盒域扫描
   *  （鞭 18×18、scale 1 → ±9px 半盒;同帧去重防重复 cutTile） */
  private cutTilesAlong(game: GameHooks, pts: V2[]): void {
    const hw = this.w / 2, hh = this.h / 2;
    const st = game.world.store;
    const seen = new Set<number>();
    for (const pt of pts) {
      const x0 = Math.floor((pt.x - hw) / 16), x1 = Math.floor((pt.x + hw) / 16);
      const y0 = Math.floor((pt.y - hh) / 16), y1 = Math.floor((pt.y + hh) / 16);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          if (!st.inBounds(tx, ty)) continue;
          const key = ty * 100000 + tx;
          if (seen.has(key)) continue;
          seen.add(key);
          game.cutTile(tx, ty);
        }
      }
    }
  }

  /** AI_165 每子步直写的弹体 Center（:48550 `Center = GetArmPosition() + velocity×
   *  (ai[0]−1)`）→ 通用湿段采样盒（湿段跑在 AI 与 UpdatePosition 之间 :16903/:19973）。
   *  盒=SetDefaults 18×18（DefaultToWhip :10707-10708,scale 1）左上角 */
  private wetBoxAt(ai0s: number): { x: number; y: number } {
    const arm = this.armPos();
    return { x: arm.x + this.wvx * (ai0s - 1) - this.w / 2,
             y: arm.y + this.wvy * (ai0s - 1) - this.h / 2 };
  }

  /** 单次曲线快照的命中结算（tag/proc/debuff/buff 语义见各段注释） */
  private tryHit(game: GameHooks, owner: Player | null, pts: V2[], ai0At?: number): void {
    // ★通用湿段·出生预置（NewProjectile :10886-10892：盒级 WetCollision/LavaCollision
    //  首测——原文 AI 首子步读出生旗,故预置在首次 tryHit 落位（首子步 ai0s=1 → 盒=
    //  arm+velocity×0 = 出膛位 ≡ NewProjectile 位）;共享体 presetDone 同款置位,
    //  段调用侧不再重复预置。旧 wetSnapshot 出生快照近似就此退役）
    if (!this.presetDone) {
      this.presetDone = true;
      const st = game.world.store;
      const b = this.wetBoxAt(ai0At ?? this.ai0);
      const rW = wetCollision(st, b.x, b.y, this.w, this.h);
      this.wet = rW.wet;                                   // :10887
      // :10888-10891 豁免反清(鞭族全非豁免,恒走 wet=WetCollision 值)
      this.honeyWet = rW.honey;                            // :10892 无条件赋值
      this.shimmerWet = rW.shimmer;                        // :10893 无条件赋值
      // ★lavaWet 预置不写(原文 NewProjectile 无此行)——首子步湿段 :16906-16911 并入
      //  (蓝队E 预置逐字面化同款;旧写系 :10888-10890 锚误标)
    }
    // 1104 火鞭 OnFire 窗口（蓝队 R7-41）：buff 24 仅当鞭身 !wet && ai[0] ∈
    // ((t/3)×2 ± 1) && 鞭尖 50×50 盒与敌盒相交（StatusNPC :11255-11272——中段
    // "溅火"专属;曾表驱动无条件每击必上）。
    // ★湿段批：wet 消费升级为【逐子步维护旗】——原文 StatusNPC 在 AI 内读上子步
    // 段值（AI :16880 → 湿段 :16903 位序;1104 非豁免 :10293-10295 无 ignoreWater 行）
    let spark1104 = false;
    let tipBox1104: { x: number; y: number; w: number; h: number } | null = null;
    if (this.projId === 1104) {
      const num2 = Math.trunc(this.timeToFlyOut / 3) * 2;      // :11259-11260
      const a0 = ai0At ?? this.ai0;
      if (!this.wet && a0 >= num2 - 1 && a0 <= num2 + 1) {   // :11262 中段 ±1（!wet=维护旗）
        const tip = pts[pts.length - 1];
        tipBox1104 = { x: tip.x - 25, y: tip.y - 25, w: 50, h: 50 };   // :11266 50×50 盒
        spark1104 = true;
      }
    }
    // 浸剂旗快照（每次 tryHit 调用读一次,同 WeaponProj.hitEnemies 口径）——★F2
    // 补接：真鞭伤害走本自有命中环,nano 乘区/party 彩带此前只在弹幕环
    // WeaponProj.hitEnemies 接过（grep 实证本文件原零引用）
    const whipImbuNano = ((game.player as unknown as {
      buffs?: { has?: (bt: BuffType) => boolean } } | null)?.buffs?.has?.(BuffType.ImbueNano)) === true;
    const whipImbuParty = ((game.player as unknown as {
      buffs?: { has?: (bt: BuffType) => boolean } } | null)?.buffs?.has?.(BuffType.ImbueParty)) === true;
    for (const p of pts) {
      // 城镇 NPC:巫毒窄门(原版鞭=friendly 弹,同 Damage_PVE_Inner :11970-11972——
      // 仅向导 22/裁缝师 54 装备对应巫毒娃娃时可伤;18×18 控制点盒同敌怪判定)
      // ★清偿刀 W1（2026-10-01）S3b 姊妹刀——城镇侧鞭面与敌怪环同构（定谳锚：
      //  Terarria1457/Terraria/Projectile.cs Damage_PVE_Inner 亲读）：
      //  ①免疫窗门 :12635-12639 对城镇靶【同面】——`immune[owner]==0` 严格门
      //    （鞭 flag3=false）,残窗（他弹 10t 档 :14197-14199 写入）整链跳过:
      //    不 tag(:13635 门后)/不写 minionTarget(:14321 门后)/不耗 falloff
      //    (:13453-13550 门后)/不占局部表(:14175-14179 门后)——TownNPC.hurt
      //    帧窗返假（BJ395⑤ 受理谓词契约）承载本门,门拒不进 onAccept。
      //  ②受理写梯 :14175-14179 usesLocal 主支 1:1——`immune[owner]=0`【清全局窗
      //    不开窗】（TownNPC.hurt :1445 通用档 iframes=10=原版通用尾档,鞭面须清零;
      //    旧形态鞭命中给城镇 NPC 开 10t 全局窗=他弹/第二鞭连携被自造窗拒,两向偏差）
      //    + hitSet 占位（immuneArray[victim]=-1,本挥每靶一次——同敌怪环;skip 门
      //    在巫毒窄门前整靶跳,写位在受理拍）。
      //  ③tag/minionTarget 面 :13635-13638/:14321-14327——两写位【无 friendly 门】
      //    （后者仅 targetNPC.active 门）,城镇受理照写;minionTarget 失效清除走
      //    Player.cs:57682-57685 CanBeChasedBy（城镇 friendly 恒假 → 次拍清,原版同相）。
      //  ④falloff/numHits :13453-13550/:14263 受理面无条件段,城镇靶同耗。
      //  登记债收编（★X1 2026-10-01 六面落刀,详注见下方 onAccept 内）：face 1 鞭
      //  debuff 载体（TownNPC 12 字段+tickDebuffs）/face 2 OnHit proc（TownNPC.hurt
      //  第 9/10 参+projTargets 透传）/face 3 nano·party/face 4 ghostHeal/face 5
      //  proc 窗启用。★face 6 勘误（W1 锚翻案）：GRAVE_MISTAKE=墓碑弹杀【城镇
      //  NPC】/队友玩家（Player.OnKillNPC :20623-20636 IsAGravestone∧townNPC /
      //  Player.KillMe :39133-39137 队友臂）,非"鞭杀向导"——原版 OnKillNPC(ref
      //  attempt, 鞭) 体仅 item 5096 自buff+墓碑两支,鞭杀向导零效果=零修刀;
      //  墓碑侧已在 Tombstone.applyDamage 接线（FTW 面+onKill→notifyProgression
      //  Event(36)）。残债（★清偿刀 Y2 2026-10-02 清偿）：随从/哨兵弹 vs 城镇 NPC
      //  通道整缺（:13711 OnHit 消费半面/:12947 ModifyHit tag 乘区对城镇不可达）——
      //  MinionProj.contactTown 等七环接 hitTownNpcs 闭环;WHIP_HIT_SIDEKICK（917/
      //  1036）与 WHIP_HIT_BUFF（312/365）:13988-13997 城镇臂本文件 onAccept 内接。
      // ★清偿刀 X1 face 3（:13687-96 nano 乘区,城镇靶同面）：`ownedBySomeone &&
      //  (melee||IsAWhip) && meleeEnchant==6 → dmg=(int)(dmg×1.05f)`——鞭 SetDefaults
      //  无 melee 类旗,IsAWhip 臂即为此设（同敌怪环 F2 位）。nano 浸剂在身时受理
      //  命中伤 ×1.05（(int) 截断同式;不写回 dmgNow——衰减链独立管 dmgNow）。
      // ★清偿刀 Y2：flat 穿甲透传（:13686-87 `ownedBySomeone && !hostile →
      //  dmg += checkArmorPenetration(num6, pct)`——城镇靶同面;鞭 num6 =
      //  GetArmorPenetration(melee=false)=玩家通用 armorPen,同敌怪环 :778 形）。
      //  banner 乘区（:13387-91）在 hitTownNpcs 通道内施加（城镇 NPC 无 banner 档,
      //  结构恒等值）。
      const townDmg = whipImbuNano ? Math.trunc(this.dmgNow * 1.05) : this.dmgNow;
      hitTownNpcs({ x: p.x - 9, y: p.y - 9, w: 18, h: 18 }, game, townDmg,
        Math.sign(p.x - this.x) * 2, 'playerProj', this.projId,
        undefined, undefined,
        (n) => this.hitSet.has(n.id)   // 局部表门（:12596 flag2 usesLocal 臂）
          // ★BJ475② :12636 免疫窗门前置（Damage_PVE_Inner `immune[owner]==0` 门——
          //  巫毒窄门(:12618-25)与窗门(:12636)在 AABB(:12668)前,两门合入 skip 谓词
          //  =整靶跳过同相;窗拒拍不达 settle/TimerCrit/tag/hurt（skip 在窄门前读窗
          //  态=纯谓词零观察差）。原版 :12636 对城镇靶同链（单 Main.npc 遍历）。
          || (((n as unknown as { iframes?: number }).iframes ?? 0) > 0),
        (n) => {
          const tn = n as unknown as { id: number; iframes: number; vanillaId?: number;
            x: number; y: number; w: number; h: number; vx?: number; vy?: number; dead?: boolean };
          tn.iframes = 0;               // 写梯 :14175-14178 usesLocal 主支=清全局窗
          // ★Z1/D1④ GC1 写方桥城镇臂（同敌怪环对称;原版单表 immune[owner] 读写域
          //  不分敌怪/城镇,受理拍清零即同拍清近战域表——town id 与敌 id 同 Entity
          //  全局序列不撞,Y2 敌怪环 :4361 同面）
          noteVanillaProjImmune(game, this.projId, tn.id, { penetrate: -1, localFace: true });
          this.hitSet.add(tn.id);       // 写梯 :14179 immuneArray[victim]=-1 占位
          const preHits = this.pveNumHits;
          this.pveNumHits++;            // :14263（proc 读自增前值,同敌怪环习语）
          // 衰减链（:13453-13550 switch）：受理拍鞭 damage 字段 ×falloff,城镇靶同耗
          this.dmgNow = Math.max(1, Math.round(this.dmgNow * (WHIP_FALLOFF[this.projId] ?? 1)));
          // ---- ★清偿刀 X1（2026-10-01）城镇受理面家族收编（六面落刀位）----
          //  原文 Damage_PVE_Inner 受理梯（逐行号）：:13633 SpawnHitVisuals →
          //  :13634 StatusNPC（内含 ApplyWhipDebuffs :11067 与浸剂/meleeEnchant
          //  :11197-11221）→ :13635-38 TryApplyTagToNPC → :13640-43
          //  TryDoingOnHitEffects（TownNPC.hurt 内 face 2 块,projTargets 透传
          //  fromPlayer/srcProjId）→ :13687-96 nano/party → :13698-13706
          //  NPCKillAttempt/StrikeNPC/OnKillNPC（hitTownNpcs 内,见上）→ :13711
          //  TagEffectStack.OnHit → :13712/:13869-77 flag10/ghostHeal → :13976/
          //  :14012 proc 窗。登记偏差两笔（零同拍观察面）：debuff/party 原文在
          //  StrikeNPC 前,本仓 onAccept 形态落在受理拍后——城镇 DoT 次拍才起,
          //  无同拍消费点;OnHit 消费半面（CanRunHitEffects=随从/哨兵弹限定,
          //  WhipTagEffect.cs:95-105）鞭自体命中恒假 → :13711 对鞭自体调用为空,
          //  消费侧随从弹 vs 城镇 NPC 通道（MinionProj 无 hitTownNpcs 环）登记新债。
          if (owner) {
            // face 1①：ApplyWhipDebuffs（:11067-11090 表,debuffWriteAllowed 闸内）
            applyWhipDebuffs(this.projId, tn as unknown as Record<string, number>);
            // face 1②：StatusNPC 鞭表（1104 → 137 Slimed 180t;24 表项抑制、按
            //  鞭尖窗直投 :11255-11272——spark1104/tipBox1104 为 tryHit 头共享快照）
            const bandCtx = { catalystBand: owner.equipStats.catalystBand === true };
            if (this.projId === 1104) {
              applyProjStatus(this.projId, tn as unknown as Record<string, number>,
                { suppressBuff: 24, ...bandCtx });
              if (spark1104 && tipBox1104
                && tipBox1104.x < tn.x + tn.w && tipBox1104.x + tipBox1104.w > tn.x
                && tipBox1104.y < tn.y + tn.h && tipBox1104.y + tipBox1104.h > tn.y) {
                applyBuffTicks(tn as unknown as Record<string, number>, 24,
                  60 * (3 + Math.floor(Math.random() * 3)));   // 60×Next(3,6)=180-300t
              }
            } else {
              applyProjStatus(this.projId, tn as unknown as Record<string, number>, bandCtx);
            }
            // face 1③：武器浸剂 meleeEnchant（:11197-11221——venom70+395/cursed39/
            //  fire24/gold72/ichor69/nano31[城镇免疫被闸]/poison20;party 彩尘）
            applyMeleeImbue(
              (owner as unknown as { buffs: { has: (b: never) => boolean } }).buffs,
              tn as unknown as Record<string, number>,
              () => game.spawnParticles(tn.x + tn.w / 2, tn.y + tn.h / 2,
                ['#FF6090', '#60FF90', '#6090FF', '#FFD040'][Math.floor(Math.random() * 4)], 6, 2.4, { life: 40, damp: 0.96 }));
            // tag（TryApplyTagToNPC :13635-13638）——ImmuneToWhips 门在栈内
            //  （城镇 NPC 不在表）;minionTarget（:14321-14327 aiStyle165 支,无 friendly 门）
            //  ★BJ512：:14322 `if (targetNPC.active)` 门同链（本击致死不写槽）
            owner.tagEffectStack.tryApplyTagToNPC(this.itemId, tn.id, tn.vanillaId ?? 0, this.bonusTagDmg);
            if (!tn.dead) owner.minionTargetId = tn.id;
          }
          // face 3②：party 彩带伴生（:13693-95 meleeEnchant==7 → NewProjectile 289
          //  于目标 Center、速=目标速度——门 `ownedBySomeone && (melee||IsAWhip)`,
          //  鞭走 IsAWhip 臂; whipImbuParty= tryHit 头快照）
          if (whipImbuParty) {
            game.spawnFriendlyProj?.(new ConfettiBurstProj(
              tn.x + tn.w / 2, tn.y + tn.h / 2, tn.vx ?? 0, tn.vy ?? 0));
          }
          // face 4：ghostHeal 白耗面（:13712 flag10 = num41>0∧lifeMax>5∧friendly∧
          //  !hostile∧aiStyle≠59——TownNPC.lastStrikeDealt=num41 等位,hurt 内 X1 落值;
          //  canGhostHeal 缺省 true（NPC.cs:6270,城镇族无 false 置位）;旗标/预算/白耗
          //  语义由 Game.applyLifeSteal 单源自证,V2 敌怪环同式）。:13711 OnHit 消费
          //  半面对鞭自体恒空（CanRunHitEffects 随从/哨兵限定,见上注）→ 无调用位。
          ghostHealProc(game, this.projId, preHits,
            tn as unknown as Parameters<typeof ghostHealProc>[3]);
          // face 5：proc 窗启用（:13976 {913,1031,1032} localAI[0]==0 首鞭门 /
          //  :14012 {847,1033,1035} 无条件——tag 消费机制半面,城镇靶同面;消费侧
          //  = 随从弹命中被 tag 城镇 NPC 时的 OnProcHit,★Y2 已闭环见 MinionProj）
          if (owner && WHIP_PROC_ITEMS.has(this.itemId)
            && (WHIP_PROC_ONCE_ITEMS.has(this.itemId) ? !this.procEnabled : true)) {
            this.procEnabled = true;
            owner.tagEffectStack.tryEnableProcOnNPC(this.itemId, tn.id);
          }
          // ---- ★清偿刀 Y2（2026-10-02）WHIP_HIT_* 城镇臂（X1 登记债清偿）----
          //  原文 TryDoingOnHitEffects switch（:13968-14013）对城镇靶【同 switch
          //  同面】,与敌怪环（下方 :842-:871 同族）逐支 1:1：
          //  · case 1034 星鞭星雨（:14001-14007）：localAI[0]==0 ∧ CanProcOnNPC
          //    （5479,靶）→ localAI0=1 + RemoveAllProcs + ConstellationWhip
          //    _SpawnConstellationStarsTowards（伤=(int)((int)(damage×2)×0.22)/颗,
          //    damage=衰减后鞭伤——城镇受理拍 dmgNow 衰减【后】值同敌怪环序）
          //  · case 912/1028 玩家 buff（:13987/:13997 AddBuff(312/365,180)——
          //    固定 180t 不 ×tagEffectDuration）
          //  · case 912/1028 附属召唤（:13984/:13995 NewProjectile 917 伤 15 /
          //    1036 伤 2 @ 靶 Center,速零 kb 零;coolWhipBuff/cobWhipBuff 在场
          //    期不重复——spawnSidekick 同类在场门承载）
          if (this.projId === 1034 && this.localAI0 === 0 && owner
            && owner.tagEffectStack.canProcOnNPC(5479, tn.id)) {
            this.localAI0 = 1;
            owner.tagEffectStack.removeAllProcs(5479);                          // :14006
            const starDmg = Math.max(1, Math.trunc(this.dmgNow * 2 * 0.22));    // :14005 + :15016-15017
            for (let i = 2; i < pts.length - 1; i += 3) {
              const a = pts[i], b = pts[i + 1];
              const dx = b.x - a.x, dy = b.y - a.y;
              const dd = Math.hypot(dx, dy) || 1;
              const f = owner.facing;
              const s = (1 + (Math.random() * 2 - 1) * 3) * (f >= 0 ? 1 : -1);
              game.spawnFriendlyProj?.(new Arrow(a.x, a.y, dy / dd * s, -dx / dd * s,
                starDmg, this.knockback, 1039, { grav: 0, life: 240 }));
            }
          }
          const hb = WHIP_HIT_BUFF[this.itemId];
          if (hb && owner) owner.whipBuffs[hb] = 180;    // :13987/:13997（固定 180t）
          if (WHIP_HIT_SIDEKICK[this.itemId] && owner) {
            this.spawnSidekick(game, owner, this.itemId,
              v2(tn.x + tn.w / 2, tn.y + tn.h / 2));     // :13984/:13995 靶 Center
          }
        },
        // ★Y2 settle：flat 穿甲透传（:13686-87——鞭 num6 = 玩家通用 armorPen,
        //  同敌怪环 :778;banner 在通道内施加,勿在此预套）
        // ★BJ475② 城镇臂 TimerCrit :12928 消费补位（BJ467① 敌臂同源）——原版
        //  Damage_PVE_Inner 单函数单遍历,crit 段(:12915-12943)无 friendly 门=
        //  巫毒窄门放行的城镇受害靶同链同达（BJ453 定谳复核位:窄门(:12618-25)→
        //  窗门(:12636)→AABB(:12668)→crit 段）;鞭 DefaultToWhip 无类旗=三类掷
        //  不达,TimerCrit 无条件消费为城镇面唯一 crit 源。位次=settle 回调
        //  （projTargets :134 巫毒窄门后/hurt 前=:12947 ModifyHit 原位）;窗前置门
        //  已上位 skip 谓词（窗拒拍整跳零消费=:12636 同相）。TownNPC.hurt crit 参
        //  =防后双精度 ×2+色一体（NPC.cs:82067 原序,BJ445② 城镇约定）→ 传
        //  crit=true 勿预倍（与敌怪环「调用侧预倍」约定异形,projTargets :96 注）。
        (n) => {
          const tn = n as unknown as { x: number; y: number; w: number; h: number };
          const timerCritTown = owner?.tryConsumingTimerCrit?.(game, tn.x, tn.y, tn.w, tn.h) ?? false;
          const flatPen = owner ? ((owner as unknown as { equipStats?: { armorPen?: number } })
            .equipStats?.armorPen ?? 0) : 0;
          return timerCritTown ? { flatPen, crit: true } : { flatPen };
        });
      // ★2026-10-21 用户实报「万花筒打不到小动物（猫头鹰等）」定谳修复:本扫只扫
      //  enemies 桶=小动物（EntityManager 独立 critters 桶）对鞭不可见。原版 Colliding
      //  扫 Main.npc 全槽（小动物可被玩家鞭抽,泰拉经典行为）;镇民桶被下方
      //  playerCanHitEnemy friendly 门滤（:11892 同语义）→ 正确域=enemies+critters
      //  （RollingBoulder:1931 三桶命中先例同族）。★其余 ~121 处 `game.enemies()`
      //  命中扫同病=系统性登记债（子弹/溅射族打不到小动物,原版全域可伤）——逐面
      //  按需扩,不一次性盲改（Enemy.ts AI 同族计数等非命中消费也读 enemies()）。
      for (const ent of [...(game.enemies() as unknown[]), ...(game.critters?.() ?? []) as unknown[]]) {
        // ★dontTakeDamage 目标排除（:12600 同款——applyWhipDebuffs/applyBuffTicks(24)
        //   直写在 hurt 前,曾绕门落账,终审补;鞭 tag 本体另有 TAG_IMMUNE_TO_WHIPS 门）
        // ★ZappingJellyfish 豁免（:12600 与 dontTakeDamage 并列,最终清零补）——鞭=
        //   IsAWhip 恒接触反噬资格,放行到下方水母块
        const jellyVid = (ent as unknown as { vanillaId?: number }).vanillaId;
        const zapJelly = jellyVid !== undefined && jellyVid > 0 && ZAPPING_JELLYFISH.has(jellyVid);
        const jellyDontTake = (ent as unknown as { dontTakeDamage?: boolean }).dontTakeDamage === true;
        if (jellyDontTake && !zapJelly) continue;
        if (!playerCanHitEnemy(ent, game, this.projId)) continue;   // friendly 门（Damage_PVE_Inner :11892——睡渔夫 376 等友好 NPC 玩家弹无效）
        const e = ent as unknown as { id: number; dead: boolean; x: number; y: number; w: number; h: number;
          hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean } & import('./WhipTag').WhipTagged;
        if (e.dead || this.hitSet.has(e.id)) continue; // localNPCHitCooldown=-1 每敌一次
        // myRect 置于控制点中心后与敌 AABB 求交（:14487-14493；18×18 → 半宽 9）
        if (p.x - 9 >= e.x + e.w || p.x + 9 <= e.x || p.y - 9 >= e.y + e.h || p.y + 9 <= e.y) continue;
        // ★清偿刀 S3b（2026-10-01）前置全局免疫窗门（Damage_PVE_Inner :12635-12639 1:1）：
        //  `flag3 = maxPenetrate==1 && !usesLocalNPCImmunity && !usesIDStaticNPCImmunity` 对鞭
        //  恒 false（DefaultToWhip :10706-10720 usesLocalNPCImmunity=true + penetrate=-1）→
        //  `targetNPC.immune[owner]==0` 门【严格生效】=本仓 e.iframes（Enemy.hurt :14235
        //  pierce!==1 臂同源共享窗）。门拒（他弹残窗）=原文 :12638 整跳 return——鞭链
        //  【全部】不跑：不 tag（TryApplyTagToNPC :13637 门后）/不 falloff（衰减链
        //  :13453-13550 门后）/不 proc（TryDoingOnHitEffects :13641 门后）/不 debuff
        //  （StatusNPC :13634 门后）/不出水母反噬（:12676 门后）/不写 minionTarget
        //  （:14321-14327 门后）/不占 hitSet（写梯 :14175-14179 门后=局部表留白,窗期满
        //  同拍照吃）。既有形态「hitSet.add 先于 hurt 且环无前置门」就此收口；V2 快照判据
        //  （门位读 strike 前态的等价替身）由本前置门 1:1 上位退役。读位在 AABB 求交后、
        //  水母块前=原文门(:12636)→几何(:12668)→水母(:12676) 序的纯谓词等价换位
        //  （AABB 无副作用,受理集=门过∧盒交,两序相同）。
        if (((e as unknown as { iframes?: number }).iframes ?? 0) > 0) continue;
        // ★水母块（Damage_PVE_Inner :12676-12688 1:1,免疫窗后同位）：充能态水母
        //  不受伤——鞭=IsAWhip 恒接触反噬资格 → TakeDamageFromJellyfish 电玩家 →
        //  `if (dontTakeDamage) return` 拦本次伤害（最终清零补,GAP 销账）
        if (zapJelly && jellyDontTake) {
          game.takeDamageFromJellyfish?.(ent);
          continue;
        }
        this.hitSet.add(e.id);
        // ★BJ467①（2026-10-03）TimerCrit :12928 独立无条件消费——鞭走 DefaultToWhip
        //  无类旗=三类掷（:12916-12927）不达,但 TryConsumingTimerCrit 对【一切】玩家弹
        //  无条件消费（Projectile.cs:12928,`if (ownedBySomeone)` 段内;BJ453 定谳:前掷已
        //  crit 照消费——鞭面恒无前掷,满蓄/负窗 → charge=−15+强制 crit）。位次=受理面
        //  三类掷位（本环无三类掷）/StatusNPC 浸剂(:13634)前;Enemy.hurt crit 参仅染色
        //  约定 → 数值预倍 ×2 交调用侧（BJ453 contact 敌臂 :4888 同式）。
        const timerCritWhip = owner?.tryConsumingTimerCrit?.(game, e.x, e.y, e.w, e.h) ?? false;
        // ★F2 浸剂命中环（Projectile.cs:13687-96 门 `ownedBySomeone&&(melee||IsAWhip)`
        //  ——鞭 SetDefaults 全走 DefaultToWhip【无 melee 类旗】(:8145/:8668/:9739+,
        //  DefaultToWhip :10706-10718 只设 aiStyle165/friendly/penetrate−1),IsAWhip 臂
        //  即为此设）。Position = StatusNPC（上方 applyMeleeImbue 的原版同位在
        //  StrikeNPC 前）→ nano/party → StrikeNPC：
        //   · nano（meleeEnchant==6）：dmg=(int)(dmg×GetNanoFlaskDamageBoost()=1.05f)
        //     —— DamageVar 后、StrikeNPC 前（Player.cs:44760-64 挥砍侧同位次）。
        //   · party（meleeEnchant==7）：出弹 289 彩带于目标 Center、速=目标速度、
        //     伤 0 kb 0（:13693-95 NewProjectile(GetProjectileSource_FromThis(),…)），
        //     经 GameHooks.spawnFriendlyProj 口（types.ts:61；Game 实现 = entities.add,
        //     与 WeaponProj 弹幕侧同通道,不造第二出口）。
        //   鞭无类旗 → 原版 crit 三连掷(:12906-12912)轮不到鞭（repo hurt 恒 crit=false
        //   同源,勿补掷）;parry ×5 门 = melee&&!DontApplyParry（:13631）鞭不在门内。
        const whipDmg = whipImbuNano ? Math.trunc(this.dmgNow * 1.05)   // (int)(dmg×1.05f)
          : this.dmgNow;                                                // 当前鞭伤（衰减链前）
        if (whipImbuParty) {
          game.spawnFriendlyProj?.(new ConfettiBurstProj(
            e.x + e.w / 2, e.y + e.h / 2,
            (e as unknown as { vx?: number }).vx ?? 0,
            (e as unknown as { vy?: number }).vy ?? 0));
        }
        const wpOwner = this.ownerRef();
        // ★清偿刀 V2（2026-10-01）：ghostHeal 白耗面（Projectile.cs:13877-79 通用 on-hit
        //  段,StrikeNPC 后/写梯 :14031 前=本位;U2 台账家族债鞭域残留补课）。鞭数据面定谳
        //  （SetDefaults 逐型亲读）：18 型全走 DefaultToWhip（:8144-8146/:8157-8169/
        //  :8668-8680/:8987-8989/:9738-9768/:10293-10295）无 magic 行 → 非 magic =
        //  ghostHeal 白耗单面（:12090 lifeSteal 先扣/:12091-93 !magic return 预算照扣
        //  不出治疗球=原版本相）+ ghostHurt 死码（:12022 `!magic` 早退零观察面,S2/R1-B
        //  定谳保形）→ 不接。isMagic 数据面由 ghostHealProc 经 projectileData 忠实直传
        //  （18 型 magic 缺省=false）;flag10 投弹侧段（:13712 num41>0∧lifeMax>5∧friendly∧
        //  !hostile∧aiStyle≠59——正常局 :12843 初值臂仅 DebugOptions 假人支可达,鞭面
        //  全由 :13712 段承载）由 ghostHealProc 数据门+applyLifeSteal num41>0 契约自证。
        //  门位（★S3b 2026-10-01 收口）：:12635-12639 前置免疫窗门已上位本环头（见上）
        //  ——V2 快照判据（门位读 strike 前态的等价替身,彼时「环无前置门」的既有形态
        //  约束下产物）就此退役;门过拍 ghostHealProc/pveNumHits++ 无条件达=原文受理面
        //  (:13877-79/:14263 均在门后无条件段)。pre-gate 与 hurt 之间无 iframes 写点
        //  （spawnFriendlyProj=entities.add 队列出生,非同步结算）→ 快照=pre-gate 同值,
        //  无信息增量。
        //  pveNumHits++=:14263 位（proc 读自增前值;localNPCHitCooldown=-1 每敌一次,
        //  多敌可叠跳）。
        //  ★S3b 写位对齐（写梯 :14175-14179 usesLocal 主支 1:1）：pierce 0→-3——鞭
        //  DefaultToWhip（:10706-10720）=usesLocalNPCImmunity+localNPCHitCooldown=-1 →
        //  受理命中写 `immune[owner]=0`【清全局窗不开窗】+ 局部表 -1（=hitSet,永续档
        //  :17380 仅 >0 递减）。旧 pierce=0 走 Enemy.hurt 缺省档写 iframes=10=原版无的
        //  全局窗（多鞭回声/蛇环补挥/后到他弹被自造窗拒 10t=鞭→随从连携核心机制反向
        //  砍伤）;pierce=-3 档（Enemy.ts :14427/:14541 BJ398 约定）=门照走（:14235
        //  pierce!==1 臂,flag3=false 同鞭）+命中写清零。局部节流已由 hitSet 承载。
        e.hurt(applyBannerDamageDealt(game, e, whipDmg) * (timerCritWhip ? 2 : 1), Math.sign(p.x - this.x) * this.knockback, 0, game, wpOwner ? (wpOwner.equipStats.armorPen ?? 0) : 0, timerCritWhip, -3, true); // kby=0 原版管线; ⑥ :12068; ★BJ184 桩面 ?? 防御族（缺省 0）; pierce=-3 写梯 usesLocal 主支（:14175-14179）; ★BJ467① TimerCrit 强制 ×2+crit 色位
        // ★Z1/D1④（2026-10-02）GC1 写方桥对称补接线（BJ436 在 MinionProj 接桥,鞭两面
        //  缺=近战域 immune 表单域记账不对称）。写梯真值=usesLocal 主支清零档
        //  （:14175-14179 `immune[owner]=0`;DefaultToWhip usesLocal+cd=-1 penetrate=-1
        //  → localFace）——桥消费面=Game.meleeNpcImmuneGateOf（近战三重门 immune 分量）,
        //  原版单表语义下鞭受理命中同样清近战域窗。前置门（:12636 上位本环头 :765）已
        //  拦拒收拍=此位恒受理拍（MinionProj contact `!mainGated` 同构）。正常流敌
        //  iframes 已由 hurt pierce=-3 清零,桥写 0=幂等 no-op;非幂等面=近战域表独立
        //  记账（鞭命中前若有近战武器窗,原版同拍清）——对称性即本刀目的。
        noteVanillaProjImmune(game, this.projId, e.id, { penetrate: -1, localFace: true });
        ghostHealProc(game, this.projId, this.pveNumHits,
          e as unknown as Parameters<typeof ghostHealProc>[3]);
        this.pveNumHits++;
        // ★L5 长尾批：月主鞭 1035 命中编排（Projectile.Damage case1035 :13025-13029——
        // settings.MovementVector=velocity.RotatedBy(±τ×0.1)、clientOnly:false → 本地直生
        // + module8 上行。PositionInWorld=目标盒内随机点（本仓以敌盒随机点近似）。
        // 补鞭子鞭同为 projId 1035 → 同款触发;1045 子鞭 proc 的 MoonLordWhipEye 由
        // SpawnMoonLordWhipProc 面在本文件补鞭出生位承担）
        if (this.projId === 1035) {
          const hjx = (Math.random() * 2 - 1) * Math.PI * 2 * 0.1;
          const baseA = Math.atan2(this.vy || 0.0001, this.vx || 0.0001);
          const mX = Math.cos(baseA + hjx), mY = Math.sin(baseA + hjx);
          const hxP = e.x + Math.random() * e.w, hyP = e.y + Math.random() * e.h;
          moonLordWhipHitFx(game, hxP, hyP, mX, mY);
          game.broadcastParticleOrchestra?.(ParticleOrchestraType.MoonLordWhipHit, hxP, hyP, mX, mY);
        }
        // 命中 debuff（StatusNPC:10555——鞭型按 projId 查表,1104 火鞭等）。
        //  1104：Slimed(137) 照表;OnFire(24) 表项抑制、按上方窗口直投（:11255-11272）
        // 催化指环 6185（StatusNPC :11192-11196 `!npcProj && catalystBand` → 398 300t 任意
        // 玩家弹命中,鞭亦在其列——IsAWhip 不设门）
        const bandCtx = { catalystBand: wpOwner?.equipStats.catalystBand === true };
        if (this.projId === 1104) {
          applyProjStatus(this.projId, e as unknown as Record<string, number>, { suppressBuff: 24, ...bandCtx });
          if (spark1104 && tipBox1104
            && tipBox1104.x < e.x + e.w && tipBox1104.x + tipBox1104.w > e.x
            && tipBox1104.y < e.y + e.h && tipBox1104.y + tipBox1104.h > e.y) {
            applyBuffTicks(e as unknown as Record<string, number>, 24,
              60 * (3 + Math.floor(Math.random() * 3)));   // 60×Next(3,6)=180-300t
          }
        } else {
          applyProjStatus(this.projId, e as unknown as Record<string, number>, bandCtx);
        }
        // 武器浸剂(StatusNPC:10559 门含 whip:IsAWhip)——鞭命中同享药剂 debuff
        applyMeleeImbue((game.player as unknown as { buffs: { has: (b: never) => boolean } }).buffs,
          e as unknown as Record<string, number>,
          () => game.spawnParticles(e.x + e.w / 2, e.y + e.h / 2,
            ['#FF6090', '#60FF90', '#6090FF', '#FFD040'][Math.floor(Math.random() * 4)], 6, 2.4, { life: 40, damp: 0.96 }));
        // 衰减链（:13453-13550）：每次命中后鞭 damage 字段 ×falloff
        this.dmgNow = Math.max(1, Math.round(this.dmgNow * (WHIP_FALLOFF[this.projId] ?? 1)));
        // tag（TryApplyTagToNPC :13635-13638 → TagEffectStack :80-87）：tag 态入玩家
        // MRU 栈（时长 = TagDuration × tagEffectDuration,1457 表 5479=480 其余 240;
        // ImmuneToWhips 11 种敌门内跳过）;自 buff（AddTheBuff :53-60）随 tag 施加,
        // 非 manual 档 ×时长
        const enVan = (e as unknown as { vanillaId?: number }).vanillaId ?? 0;
        owner?.tagEffectStack.tryApplyTagToNPC(this.itemId, e.id, enVan, this.bonusTagDmg);
        // ★SW-FX19：鞭命中写召唤集火槽（Projectile.cs:14321-14323 per-hit——
        //  `aiStyle==165 → MinionAttackTargetNPC = victimIndex`（单槽最新写胜出,
        //  approx-registry L5+④ 定谳:非"多 tag 争距",各随从消费自持距离/视线门
        //  :29043+:30314+:37836）。失效清除走 Player.cs:57682-57685 每 tick（Game 侧）
        //  ★BJ512：:14322 外门 `if (targetNPC.active)`——本击致死（dead）不写槽
        if (owner && !e.dead) owner.minionTargetId = e.id;
        // proc 启用（TryDoingOnHitEffects :13968-14013）：{913,1031,1032} 首鞭门
        //  localAI[0]==0（:13970-13977）；{847,1033,1035} 每鞭无条件（:14009-14013）
        if (WHIP_PROC_ITEMS.has(this.itemId) && (WHIP_PROC_ONCE_ITEMS.has(this.itemId) ? !this.procEnabled : true)) {
          this.procEnabled = true;
          owner?.tagEffectStack.tryEnableProcOnNPC(this.itemId, e.id);
        }
        // 5479（proj 1034）星座星雨——1457 语义（Projectile.cs:14001-14007 case 1034：
        //  localAI[0]==0 且 CanProcOnNPC(5479,敌) 才撒星 → localAI[0]=1 + RemoveAllProcs；
        //  proc 窗由随从命中经 WhipTagEffect_Constellation.OnTaggedHit :6-10 启用）。
        //  ConstellationWhip_SpawnConstellationStarsTowards（:15013-15036）伤 =
        //  (int)((int)(damage×2)×0.22)/颗（:14005 传 damage×2 → :15016-15017 num=0.22），
        //  damage = 衰减后的鞭伤（falloff :13453 先于 TryDoingOnHitEffects :13641）。
        //  沿鞭每 3 控制点一颗、垂直曲线方向飞出
        if (this.projId === 1034 && this.localAI0 === 0 && owner
          && owner.tagEffectStack.canProcOnNPC(5479, e.id)) {
          this.localAI0 = 1;
          owner.tagEffectStack.removeAllProcs(5479);                          // :14006
          const starDmg = Math.max(1, Math.trunc(this.dmgNow * 2 * 0.22));    // :14005 + :15016-15017
          const add = (el: unknown, b: string) =>
            (game as unknown as { entities: { add: (x: unknown, y: string) => void } }).entities.add(el, b);
          for (let i = 2; i < pts.length - 1; i += 3) {
            const a = pts[i], b = pts[i + 1];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            // 垂直方向（:15023-15025）：(dx,dy) 旋转 -π/2×player.direction×gravDir
            //  （gravDir 恒 1）——facing>0 → (dy,-dx)；facing<0 → (-dy,dx)，
            //  再乘 (1+NextFloatDirection×3) 随机速率（可负 → 反向）
            const f = owner ? owner.facing : 1;
            const s = (1 + (Math.random() * 2 - 1) * 3) * (f >= 0 ? 1 : -1);
            add(new Arrow(a.x, a.y, dy / d * s, -dx / d * s, starDmg, this.knockback, 1039,
              { grav: 0, life: 240 }), 'projectiles');
          }
        }
        // 鞭敌方直伤 debuff（ApplyWhipDebuffs :11067-11090 表驱动 1:1）
        applyWhipDebuffs(this.projId, e as unknown as Record<string, number>);
        // 玩家 buff——tag 链已随 applyTagToNPC 入栈（AddTheBuff ×tagEffectDuration）;
        // 命中链（case 912 起 :13979/case 1028 起 :13990;SW-AJ1 2026-09-05 校准,旧 :13981-13992）保持固定 180t 不缩放
        const hb = WHIP_HIT_BUFF[this.itemId];
        if (hb && owner) owner.whipBuffs[hb] = 180;
        // 伴生召唤出生点 = 被命中敌怪 Center（:13984/:13995 NewProjectile 位置参;★SW-AB1 2026-09-04 引注校准:旧 1456 锚 :12948/:12959 重锚 1457）
        if (WHIP_HIT_SIDEKICK[this.itemId] && owner) {
          this.spawnSidekick(game, owner, this.itemId, v2(e.x + e.w / 2, e.y + e.h / 2));
        }
      }
    }
  }

  /** 命中附属召唤（:13979-14000;SW-AB1 2026-09-04 重锚 1457,旧 1456 :12943-12963）：酷鞭 4911 → 雪花哨兵 917（伤 15，buff 312 维持）；
   *  麻线鞭 5473 → 小蜘蛛 1036（伤 2，buff 365 维持）——同类在场不重复生成
   *  （原版 coolWhipBuff/cobWhipBuff flag 在 buff 期内置位）。
   *  出生点 = 被命中敌怪 Center、速度零矢量、击退 0（NewProjectile(
   *  GetProjectileSource_FromThis(), targetNPC.Center, Vector2.Zero, 917, 15, 0f,
   *  owner) :13984 / 1036, 2, 0f :13995（SW-AB1 2026-09-04 重锚 1457）——此前误出生玩家旁 + kb 1.5） */
  private spawnSidekick(game: GameHooks, owner: Player, itemId: number, at: V2): void {
    const want = WHIP_HIT_SIDEKICK[itemId];
    if (!want) return;
    const projs = (game as unknown as { entities: { projectiles: MinionProj[]; add: (e: unknown, b: string) => void } }).entities;
    if (projs.projectiles.some((m) => m instanceof MinionProj && !m.dead && m.projId === want.proj)) return;
    const m = new MinionProj(at.x, at.y, want.proj, want.dmg, 0,
      false, 0, false, () => (owner.dead ? null : owner)); // kb=0f :13984/:13995（SW-AB1 2026-09-04 重锚 1457）
    m.noSlot = true;
    projs.add(m, 'projectiles');
  }

  draw(r: import('../render/Renderer').Renderer): void {
    const ctx = r.ctx;
    if (!ctx) return;
    // 视觉曲线（带随机相位卷曲 :45653）
    const pts = this.controlPoints(false);
    const img = projSprite(this.projId);
    const lineTex = r.atlas?.ensureVImage?.('vanilla/FishingLine.png') ?? null;
    if (!img && !lineTex) {
      // 双贴图未就绪（懒加载首帧）→ 折线兜底,下帧自愈
      ctx.strokeStyle = '#D8B060';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      return;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // ① 鞭身渔线（DrawWhip :36732-36756）;1034 flag3（:36747-36749 color2=color
    //    免逐段取光）→ 线体收集进 Renderer 全亮队列、compositeLight 后固定色直画
    if (lineTex && this.projId === 1034 && r.whipFullbrightQueue) {
      r.whipFullbrightQueue.push({
        pts: pts.map((p) => ({ x: p.x, y: p.y })),
        tex: lineTex as never,
        color: [...WHIP_1034_LINE] as [number, number, number, number],
      });
    } else if (lineTex) drawWhipLineBody(ctx, lineTex, this.projId, pts, r);
    // ② 鞭尖（DrawWhip switch :36759-36815 → WHIP_TIPS 分发表）
    const tip = WHIP_TIPS[this.projId];
    if (tip && img) {
      tip({
        ctx, tex: img, r,
        // GlowMask[358]（DrawWhip_EelWhip :37206-37207 加色辉光,仅电鳗鞭消费）
        glow: this.projId === 1033 ? r.atlas?.ensureVImage?.('vanilla/Glow_358.png') ?? null : null,
        pts, n: pts.length - 1, prog: this.progress, dir: this.spriteDir,
        // ★BJ703-B D4：hue=miscCounterNormalized（DrawWhip_RainbowWhip :37361 读
        //  theOwner.miscCounterNormalized=Player.cs:3373 miscCounter/300,wrap 300
        //  :29529-29532）——旧 performance.now()/5000 时钟近似（暂停/菜单相位漂移+
        //  与游戏 tick 解耦）退役。owner 缺席（理论不可达,鞭恒玩家发射）回退 0。
        lai1: this.lai1, hue: this.ownerRef()?.miscCounterNormalized ?? 0, opacity: 1, // proj.Opacity :542-547 = 1-alpha/255,鞭 alpha 恒 0
      });
    }
    ctx.restore();
  }
}

// ===================== AI_165 尾段逐鞭拖尾尘（1458 Projectile.cs:48660-49145,R31 §B② P1） =====================
// 挥鞭火花尘 switch 真值表——挥动包络门（whipSwingEnvelope）+ per-type 粒型/掷域/速度式。
// 掷域盒 = Utils.CenteredRectangle(控制点,(30,30)) → spawnDust(x-15,y-15,30,30,…);
// 段向 = DirectionTo(points[n-1],points[n]) 归一。命中瞬间原版无尘（正确不作为）。
// ★R31 报告对 1104 的描述（15×d6+6×d31 tip 爆）与源码 :49096 支不符——该支实为
// d4 蓝火花沿鞭撒布；其"中段溅火"在 StatusNPC 命中窗（:11255-11272,本仓 tryHit
// spark1104 已接）。按反编译源码实现（CLAUDE.md 纪律）。
interface WhipDustCtx {
  game: GameHooks;
  /** 视觉控制点（getActualCollisionPoints=false,首元素=锚点） */
  pts: V2[];
  /** 挥动包络 GetLerpValue(0.1,0.7,t)×GetLerpValue(0.9,0.7,t) */
  env: number;
  /** 原始进度 ai[0]/timeToFlyOut（849 用裸 t 门非 env） */
  t: number;
  /** player.direction */
  facing: number;
  /** ★BJ703-B D4：owner.miscCounterNormalized（Player.cs:3373）——915 AI 尘
   *  hue=miscCounterNorm×9%1（Projectile.cs:48741 读 player.miscCounterNormalized）。 */
  hue: number;
  /** 玩家速度（1030 血鞭掺入）与弹体速度（1104 掺入） */
  pvx: number; pvy: number; vx: number; vy: number;
}
/** DirectionTo 归一（a→b）;零距返零向量（SafeNormalize(Vector2.Zero) 同态） */
const whipSegDir = (a: V2, b: V2): V2 => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  return d > 0 ? v2(dx / d, dy / d) : v2(0, 0);
};
const whipRot90 = (s: V2, quarterTurns: number): V2 => {
  const ang = quarterTurns * Math.PI / 2;
  const c = Math.cos(ang), sn = Math.sin(ang);
  return v2(s.x * c - s.y * sn, s.x * sn + s.y * c);
};
const WHIP_TRAIL_DUST: Record<number, (c: WhipDustCtx) => void> = {
  // 848 晨星鞭（:48660-48677）：env>0.1 且 rand<env/2 → 鞭尖 30 盒 d172(alpha100,
  //    scale1.5,noGravity,v÷2)
  848: (c) => {
    if (!(c.env > 0.1) || Math.random() >= c.env / 2) return;
    const tip = c.pts[c.pts.length - 1];
    const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, 172, 0, 0, 100, null, 1.5);
    if (d) { d.noGravity = true; d.vx /= 2; d.vy /= 2; }
  },
  // 847 杜兰达尔剑鞭（:48678-48707）：env>0.5 且 Next(3)!=0 → 末 10 点随机段 30 盒,
  //    d57（1/3→d43）White,fadeIn0.3,noGravity,v=×0.5+段向.RotBy(dir×π/2) 再 ×0.5
  847: (c) => {
    if (!(c.env > 0.5) || Math.floor(Math.random() * 3) === 0) return;
    const n = c.pts.length;
    const idx = (n - 10) + Math.floor(Math.random() * 10);
    if (idx < 1 || idx >= n) return;
    const p = c.pts[idx];
    const type = Math.floor(Math.random() * 3) === 0 ? 43 : 57;
    const d = c.game.spawnDust?.(p.x - 15, p.y - 15, 30, 30, type, 0, 0, 100,
      { r: 255, g: 255, b: 255, a: 255 });
    if (!d) return;
    d.x = p.x; d.y = p.y;             // dust.position = points[idx]
    d.fadeIn = 0.3; d.noGravity = true;
    d.vx *= 0.5; d.vy *= 0.5;
    const s = whipRot90(whipSegDir(c.pts[idx - 1], p), c.facing);
    d.vx += s.x; d.vy += s.y;
    d.vx *= 0.5; d.vy *= 0.5;
  },
  // 849 黑收成（:48708-48740）：裸 t>0.4 且 Next(9)!=0 → 尖端 d191(scale1.3,noGr,
  //    v+=段向×2)+1/2 黑电编排粒子近似;AddLight(0.2,0,0.4)=R18 光照域登记不接
  849: (c) => {
    if (!(c.t > 0.4) || Math.floor(Math.random() * 9) === 0) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, 191, 0, 0, 0, null, 1.3);
    if (d) { d.noGravity = true; d.vx += dir.x * 2; d.vy += dir.y * 2; }
    if (Math.random() < 0.5) {
      c.game.spawnParticles(tip.x, tip.y, '#2A104A', 2, 2.2, { life: 20 }); // BlackLightningSmall 编排近似
    }
    // AddLight(r2.Center, 0.2, 0, 0.4)（:48721——r2=CenteredRectangle(尖端,(30,30)),
    // 尖端近似;经 Game.addLightAt 注入光照引擎,R18 备案域就此接通）
    c.game.addLightAt?.(tip.x, tip.y, 0.2, 0, 0.4);
  },
  // 915 万花筒（:48741-48776）：env>0.1 → 尖端 d267(hue=miscCounterNormalized×9%1——
  //    ★BJ703-B D4:owner tick 时钟,旧 whipHueClock wall-clock 档退役,scale0.9+r×0.9,
  //    fadeIn r×0.9,v×r×0.8+段向×2)+白影 CloneDust 全字段拷贝(scale÷2,fadeIn×0.85,
  //    color 白;含 noGravity=true)
  915: (c) => {
    if (!(c.env > 0.1)) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    const [r, g, b] = hslToRgb255((c.hue * 9) % 1, 1, 0.5, 255);
    const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, 267, 0, 0, 0,
      { r, g, b, a: 255 }, 1.3);
    if (!d) return;
    const m = Math.random() * 0.8;
    d.vx *= m; d.vy *= m;
    d.noGravity = true;
    d.scale = 0.9 + Math.random() * 0.9;
    d.fadeIn = Math.random() * 0.9;
    d.vx += dir.x * 2; d.vy += dir.y * 2;
    // ★BJ700-D（2026-10-20）白影改走 CloneDust 全字段拷贝（:48741-48744 → Dust.cs
    //    :265-288,含 noGravity :276——源尘已置 true）。曾手工 spawnDust 重掷克隆,
    //    noGravity 漏拷 → 链 B 兜底 −0.04 收缩（Dust.cs:2407-2413）不生效,267 尘净
    //    +0.01/t 无界生长至 scale>10 死门 ≈16s——用户实报「粒子慢慢变大过段时间才
    //    消失」;cloneDust 钩连位置/速度/帧三次级偏差（CloneDust 逐字段覆写 :273-284）
    //    一并消解（MinionProj:1012/:1062、NpcHitDust:346 同款范式）。
    const w = c.game.cloneDust?.(d);
    if (w) {
      w.scale /= 2;                                  // :48742 dust10.scale /= 2f
      w.fadeIn *= 0.85;                              // :48743 dust10.fadeIn *= 0.85f
      w.color = { r: 255, g: 255, b: 255, a: 255 };  // :48744 new Color(255,255,255,255)
    }
  },
  // 914 荆棘鞭（:48777-48800）：env>0.1 且 rand<env/2 → d39(scale1.2,noGr 1/3,v+=段向×2)
  914: (c) => {
    if (!(c.env > 0.1) || Math.random() >= c.env / 2) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, 39, 0, 0, 0, null, 1.2);
    if (d) { d.noGravity = Math.floor(Math.random() * 3) === 0; d.vx += dir.x * 2; d.vy += dir.y * 2; }
  },
  // 952 骨鞭（:48801-48823）：env>0.15 且 rand<env → d26(scale0.7,noGr 1/3 时 +0.4,
  //    v+=段向×2)
  952: (c) => {
    if (!(c.env > 0.15) || Math.random() >= c.env) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, 26, 0, 0, 0, null, 0.7);
    if (!d) return;
    d.noGravity = Math.floor(Math.random() * 3) === 0;
    if (d.noGravity) d.scale += 0.4;
    d.vx += dir.x * 2; d.vy += dir.y * 2;
  },
  // 1034 星座鞭（:48824-48852）：同 847 式,d135(White,alpha100,scale1.5);旋转符号
  //    ×Sign(value)(value=外层局部,取 spriteDir 符号近似,登记)
  1034: (c) => {
    if (!(c.env > 0.5) || Math.floor(Math.random() * 3) === 0) return;
    const n = c.pts.length;
    const idx = (n - 10) + Math.floor(Math.random() * 10);
    if (idx < 1 || idx >= n) return;
    const p = c.pts[idx];
    const d = c.game.spawnDust?.(p.x - 15, p.y - 15, 30, 30, 135, 0, 0, 100,
      { r: 255, g: 255, b: 255, a: 255 }, 1.5);
    if (!d) return;
    d.x = p.x; d.y = p.y;
    d.fadeIn = 0.3; d.noGravity = true;
    d.vx *= 0.5; d.vy *= 0.5;
    const s = whipRot90(whipSegDir(c.pts[idx - 1], p), c.facing);
    d.vx += s.x; d.vy += s.y;
    d.vx *= 0.5; d.vy *= 0.5;
  },
  // 1035 月主鞭（:48853-48893）：env>0.5 且 Next(3)!=0 → 末 8 点随机段 20 盒
  //    d306(Color(147,255,220),alpha100,scale1.6,半数 noGr 半数 scale×0.5,
  //    v=弹向归一×段长×0.5 再 RotBy(rand±0.2π))+d229 同点(v 继承,scale0.3-1.4 递减)
  1035: (c) => {
    if (!(c.env > 0.5) || Math.floor(Math.random() * 3) === 0) return;
    const n = c.pts.length;
    const idx = (n - 8) + Math.floor(Math.random() * 8);
    if (idx < 1 || idx >= n) return;
    const p = c.pts[idx];
    const segLen = Math.hypot(p.x - c.pts[idx - 1].x, p.y - c.pts[idx - 1].y);
    const d = c.game.spawnDust?.(p.x - 10, p.y - 10, 20, 20, 306, 0, 0, 100,
      { r: 147, g: 255, b: 220, a: 255 }, 1.6);
    if (!d) return;
    d.x = p.x; d.y = p.y;
    d.noGravity = Math.floor(Math.random() * 2) === 0;
    if (!d.noGravity) d.scale *= 0.5;
    const vl = Math.hypot(c.vx, c.vy) || 1;
    let dvx = c.vx / vl * segLen * 0.5, dvy = c.vy / vl * segLen * 0.5;
    const ra = (Math.random() * 2 - 1) * Math.PI * 2 * 0.1;
    const rc = Math.cos(ra), rs = Math.sin(ra);
    d.vx = dvx * rc - dvy * rs; d.vy = dvx * rs + dvy * rc;
    const d2 = c.game.spawnDust?.(p.x, p.y, 0, 0, 229, d.vx, d.vy, 0, null, 0.3 + 1.1 * Math.random());
    if (d2) { d2.noGravity = true; d2.vx *= d2.scale * Math.random(); d2.vy *= d2.scale * Math.random(); }
  },
  // 1028 麻花鞭（:48894-48917）：env>0.15 且 rand<env 且 1/2 → d30(scale0.7,noGr 1/3
  //    +0.3,v+=段向×2)
  1028: (c) => {
    if (!(c.env > 0.15) || Math.random() >= c.env || Math.floor(Math.random() * 2) !== 0) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, 30, 0, 0, 0, null, 0.7);
    if (!d) return;
    d.noGravity = Math.floor(Math.random() * 3) === 0;
    if (d.noGravity) d.scale += 0.3;
    d.vx += dir.x * 2; d.vy += dir.y * 2;
  },
  // 912 酷鞭（:48918-48960）：env>0.1 且 rand<env/2 → 3×d16(noGr)+1×d13(scale0.8)
  //    +3×(1/2)d261(透明,scale0.8,v×0.3,noGr) 均 v+=段向×2;AddLight 登记不接
  912: (c) => {
    if (!(c.env > 0.1) || Math.random() >= c.env / 2) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    const emit = (type: number, scale: number, col: { r: number; g: number; b: number; a: number } | null): void => {
      const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, type, 0, 0, 0, col, scale);
      if (!d) return;
      d.noGravity = true;
      d.vx += dir.x * 2; d.vy += dir.y * 2;
      return;
    };
    for (let i = 0; i < 3; i++) emit(16, 1.2, null);
    emit(13, 0.8, null);
    for (let i = 0; i < 3; i++) {
      if (Math.random() < 0.5) {
        const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, 261, 0, 0, 0,
          { r: 0, g: 0, b: 0, a: 0 }, 0.8);
        if (d) { d.vx = (d.vx + dir.x * 2) * 0.3; d.vy = (d.vy + dir.y * 2) * 0.3; d.noGravity = true; }
      }
    }
  },
  // 913 火鞭（:48961-48992）：env>0.1 且 rand<env → 3 循环（1/3 跳过）：
  //    1/7→d31 烟(fadeIn1-1.6,noGr,v=v÷2+段向×2) 否则 d6(scale1.2,v+=段向×2,
  //    2/3 档 fadeIn0.7-1.6/scale0.6/noGr)
  913: (c) => {
    if (!(c.env > 0.1) || Math.random() >= c.env) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    for (let i = 0; i < 3; i++) {
      if (Math.floor(Math.random() * 3) !== 0) continue;
      if (Math.floor(Math.random() * 7) === 0) {
        const d = c.game.spawnDust?.(tip.x - 10, tip.y - 10, 20, 20, 31);
        if (d) { d.vx = d.vx / 2 + dir.x * 2; d.vy = d.vy / 2 + dir.y * 2; d.fadeIn = 1 + Math.random() * 0.6; d.noGravity = true; }
      } else {
        const d = c.game.spawnDust?.(tip.x - 10, tip.y - 10, 20, 20, 6, 0, 0, 0, null, 1.2);
        if (!d) continue;
        d.vx += dir.x * 2; d.vy += dir.y * 2;
        if (Math.floor(Math.random() * 3) !== 0) {
          d.fadeIn = 0.7 + Math.random() * 0.9; d.scale = 0.6; d.noGravity = true;
        }
      }
    }
  },
  // 1033 电鳗鞭（:48993-49036）：沿第 10..末控制点每段 1/5 掷且 rand<t：
  //    1/3→d217(scale1.4,alpha100,noGr,noLight,v=±(π/2..π) 向×Next(3,8)×2 ÷4+段向×3)
  //    其余 1/4→d226(scale0.7,noGr 1/3+0.3,v+=段向±0.196rad×2)
  1033: (c) => {
    const n = c.pts.length;
    for (let k = 10; k < n - 1; k++) {
      if (Math.floor(Math.random() * 5) === 0 && Math.random() <= c.t) {
        const seg = whipSegDir(c.pts[k], c.pts[k + 1]);
        if (Math.floor(Math.random() * 3) === 0) {
          const ang = Math.random() * Math.PI - Math.PI / 2;
          const mag = (3 + Math.floor(Math.random() * 5)) * 2;   // Next(3,8)
          const d = c.game.spawnDust?.(c.pts[k + 1].x - 15, c.pts[k + 1].y - 15, 30, 30, 217,
            Math.cos(ang) * mag, Math.sin(ang) * mag, 100, null, 1.4);
          if (d) { d.noGravity = true; d.noLight = true; d.vx /= 4; d.vy /= 4; d.vx += seg.x * 3; d.vy += seg.y * 3; }
        } else {
          if (Math.floor(Math.random() * 4) !== 0) continue;
          const ra = (Math.random() * 2 - 1) * 0.19634954631328583;
          const rc = Math.cos(ra), rs = Math.sin(ra);
          const d = c.game.spawnDust?.(c.pts[k + 1].x - 15, c.pts[k + 1].y - 15, 30, 30, 226, 0, 0, 0, null, 0.7);
          if (!d) continue;
          d.noGravity = Math.floor(Math.random() * 3) === 0;
          if (d.noGravity) d.scale += 0.3;
          d.vx += (seg.x * rc - seg.y * rs) * 2;
          d.vy += (seg.x * rs + seg.y * rc) * 2;
        }
      }
    }
  },
  // 1029 恶魔鞭（:49037-49059）：env>0.6 且 1/2 → 2×(d18|d184 各半,scale0.7,
  //    noGr=184 或 1/3 时 +0.3,v+=段向×2)
  1029: (c) => {
    if (!(c.env > 0.6) || Math.floor(Math.random() * 2) !== 0) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    for (let k = 0; k < 2; k++) {
      const type = Math.random() < 0.5 ? 18 : 184;
      const d = c.game.spawnDust?.(tip.x - 15, tip.y - 15, 30, 30, type, 0, 0, 0, null, 0.7);
      if (!d) continue;
      d.noGravity = type === 184 || Math.floor(Math.random() * 3) === 0;
      if (d.noGravity) d.scale += 0.3;
      d.vx += dir.x * 2; d.vy += dir.y * 2;
    }
  },
  // 1030 血鞭（:49060-49094）：env>0.6 且 Next(4)!=0 → 后半控制点逐点 1/6(末点恒出):
  //    末点 4 枚否则 1;d115|d5 各半(scale0.3-0.6,v+=段向×3×r 再 ×0.5+vX×dir×2+
  //    玩家速×r,fadeIn=scale×1.1,次枚起 alpha=r(200))
  1030: (c) => {
    if (!(c.env > 0.6) || Math.floor(Math.random() * 4) === 0) return;
    const n = c.pts.length;
    for (let k = Math.floor(n / 2); k < n; k++) {
      if (Math.floor(Math.random() * 6) !== 0 && k !== n - 1) continue;
      const cnt = k === n - 1 ? 4 : 1;
      const seg = whipSegDir(c.pts[k - 1], c.pts[k]);
      for (let m = 0; m < cnt; m++) {
        const type = Math.random() < 0.5 ? 115 : 5;
        const sc = 0.3 + 0.3 * Math.random();
        const r01 = Math.random();
        const d = c.game.spawnDust?.(c.pts[k].x - 15, c.pts[k].y - 15, 30, 30, type, 0, 0, 0, null, sc);
        if (!d) continue;
        d.vx += seg.x * 3 * r01; d.vy += seg.y * 3 * r01;
        d.vx *= 0.5; d.vy *= 0.5;
        d.vx += c.facing * 2;
        d.vx += c.pvx * Math.random(); d.vy += c.pvy * Math.random();
        d.fadeIn = d.scale * 1.1;
        if (m > 0) d.alpha = Math.floor(Math.random() * 200);
      }
    }
  },
  // 1031（:49095-49121）：env>0.1 且 rand<env → 4 循环（1/3 跳过）d6(v+=段向×1.5;
  //    2/3 再 +段向,fadeIn0.7-1.6,scale0.7,noGr)
  1031: (c) => {
    if (!(c.env > 0.1) || Math.random() >= c.env) return;
    const n = c.pts.length;
    const tip = c.pts[n - 1];
    const dir = whipSegDir(c.pts[n - 2], tip);
    for (let i = 0; i < 4; i++) {
      if (Math.floor(Math.random() * 3) === 0) {
        const d = c.game.spawnDust?.(tip.x - 10, tip.y - 10, 20, 20, 6);
        if (!d) continue;
        d.vx += dir.x * 1.5; d.vy += dir.y * 1.5;
        if (Math.floor(Math.random() * 3) !== 0) {
          d.vx += dir.x; d.vy += dir.y;
          d.fadeIn = 0.7 + Math.random() * 0.9; d.scale = 0.7; d.noGravity = true;
        }
      }
    }
  },
  // 1032（:49122-49145）：env>0.6 且 rand<env 且 Next(3)!=0 → 偶数点 l(概率 (l/n)²):
  //    2×(d167|d166 半)+1×d166+1×d167(noGr 2/3 时 +0.2,v+=段向×2)
  1032: (c) => {
    if (!(c.env > 0.6) || Math.random() >= c.env || Math.floor(Math.random() * 3) === 0) return;
    const n = c.pts.length;
    for (let l = 0; l < n - 1; l += 2) {
      const prob = l / n;
      if (Math.random() >= prob * prob) continue;
      const seg = whipSegDir(c.pts[l], c.pts[l + 1]);
      const emit = (): void => {
        const type = Math.random() < 0.5 ? 167 : 166;
        const d = c.game.spawnDust?.(c.pts[l + 1].x - 15, c.pts[l + 1].y - 15, 30, 30, type);
        if (!d) return;
        d.noGravity = Math.floor(Math.random() * 3) !== 0;
        if (d.noGravity) d.scale += 0.2;
        d.vx += seg.x * 2; d.vy += seg.y * 2;
      };
      emit(); emit();
      emit();   // decompiled 三连：循环 2 次 + d166 + d167 各一（粒率等价）
      emit();
    }
  },
  // 1104 史莱姆鞭（:49146-49145 支）：env>0.15 且 rand<env 且 1/2 → 沿鞭每 3 点
  //    （末点恒出,余 1/20）d4 蓝(color(78,136,255,127),alpha84,scale1+r×0.3,
  //    v+=段向×r×5;3/4→noGr,否则 v×0.3+弹速×0.5,scale−0.4)
  1104: (c) => {
    if (!(c.env > 0.15) || Math.random() >= c.env || Math.floor(Math.random() * 2) !== 0) return;
    const n = c.pts.length;
    for (let k = n - 1; k >= 1; k -= 3) {
      if (k !== n - 1 && Math.floor(Math.random() * 20) !== 0) continue;
      const seg = whipSegDir(c.pts[k - 1], c.pts[k]);
      const d = c.game.spawnDust?.(c.pts[k].x - 15, c.pts[k].y - 15, 30, 30, 4, 0, 0, 84,
        { r: 78, g: 136, b: 255, a: 127 }, 1 + Math.random() * 0.3);
      if (!d) continue;
      d.vx += seg.x * Math.random() * 5; d.vy += seg.y * Math.random() * 5;
      if (Math.floor(Math.random() * 4) === 0) d.noGravity = true;
      else { d.vx = d.vx * 0.3 + c.vx * 0.5; d.vy = d.vy * 0.3 + c.vy * 0.5; d.scale -= 0.4; }
    }
  },
};

// ===================== 鞭渲染（1457 Main.cs:36656-37670 DrawWhip 族 1:1） =====================
// DrawWhip（:36656-36816）两层：
//  ① 鞭身 = TextureAssets.FishingLine（12×12）染色线体,沿控制点链逐段旋贴
//    （:36740-36756）：段色 = Lighting.GetColor(段位,per-whip 色表 :36669-36729)——
//    本仓实体层画在全屏光照合成【前】= 合成自动乘光（StringLine 渔线段链同口径,
//    逐像素乘光 ≈ 逐段取光）;scale=(1,(段长+2)/12)、origin=(W/2,2)（:36662/
//    :36746）。flag（1028-1035 :36694-36726）→ num-- 末段少画 1 节（:36734-36736,
//    鞭尖贴图占位）;flag2（仅 1035 false :36726）→ 整条不画线体;flag3（1034 :36721）
//    → 免逐段取光（本仓合成乘光近似,登记偏差）。
//  ② 鞭尖 = 16 个专署 tip 函数（:36818-37669）把 Projectile_*.png 竖向帧切片
//    （Texture2D.Frame(cols,rows) :36822 后 Height-=2 :36824、origin=Size/2 :36825 等）,
//    部分档 origin.Y-4/-8）沿控制点排布;段色 = Lighting.GetColor → 本仓 White 直画。
//  【累计位形等价】SlimeWhip/MeteorWhip/MoonLordWhip/EelWhip/BoneWhip/CoolWhip/
//  FireWhip/RainbowWhip/ThornWhip/WhipSword 的 vector2 从 controlPoints[0] 起每段
//  累加段矢量（:36826/:36861 等）——累计和 ≡ controlPoints[i],统一按 pts[i] 取位。
//  【预乘混合】XNA AlphaBlend = 预乘（One/InvSrcAlpha）：画色 C 实效 =
//  tex.rgb×C.rgb + 背景×(1−C.A) —— A=0 纯加色（'lighter'+保形染色,★BJ703-B D5）、
//  A≥255 纯替换（保形染色 source-over）、中间档两笔（StringLine.drawSegment 同款三档）。

type Tex = ImageBitmap | HTMLImageElement;
type RGBA = readonly [number, number, number, number];
/** 不透明白（各 tip 的 Lighting.GetColor 档——本仓合成乘光,原色直画） */
const TIP_WHITE: RGBA = [255, 255, 255, 255];
const scalarLerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** ★BJ703-B D4（2026-10-21）退役：旧 whipHueClock=performance.now()/5000 时钟近似
 *  （同率同域但【与游戏 tick 解耦】——暂停/菜单/探针 freezeClock 下相位漂移,且
 *  原版 5s 循环锚在 Player.miscCounter 的 tick 计数上）。两消费位（WhipTipCtx.hue
 *  尾绘 + 915 AI 尘 hue）均改读 owner.miscCounterNormalized（Player.cs:3373
 *  =miscCounter/300,wrap 300 :29529-29532 → 5s/60fps 一循环,域 [0,1) 逐值等价）。 */

/** Main.hslToRgb（:48689-48728,hue2rgb :48730-48748）——Math.Round 后 (byte) */
function hue2rgb(c: number, t1: number, t2: number): number {
  if (c < 0) c++;
  if (c > 1) c--;
  if (6 * c < 1) return t1 + (t2 - t1) * 6 * c;
  if (2 * c < 1) return t2;
  if (3 * c < 2) return t1 + (t2 - t1) * (2 / 3 - c) * 6;
  return t1;
}
function hslToRgb255(h: number, s: number, l: number, a: number): RGBA {
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = Math.round(l * 255); }
  else {
    const t2 = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const t1 = 2 * l - t2;
    r = Math.round(hue2rgb(h + 1 / 3, t1, t2) * 255);
    g = Math.round(hue2rgb(h, t1, t2) * 255);
    b = Math.round(hue2rgb(h - 1 / 3, t1, t2) * 255);
  }
  return [(r & 0xff), (g & 0xff), (b & 0xff), (a & 0xff)];
}

/** 1034 线色 = hslToRgb(0.6,1,0.5,20)×0.6（:36720,XNA Color*float 截断）
 *  = (0,102,255,20)×0.6 → (0,61,153,12)——A=12 中间档（近纯加色） */
const WHIP_1034_LINE: RGBA = (() => {
  const c = hslToRgb255(0.6, 1, 0.5, 20);
  const t = (v: number) => Math.trunc(v * 0.6) & 0xff;
  return [t(c[0]), t(c[1]), t(c[2]), t(c[3])];
})();

/** 鞭身线色表（DrawWhip switch :36669-36729;表外 = 缺省 White :36663） */
export const WHIP_LINE_COLORS: Record<number, RGBA> = {
  847: [255, 69, 0, 255],      // OrangeRed :36669-36670
  849: [0, 0, 0, 255],         // SlateBlue→Black（:36672-36674 死赋值,落终态 Black）
  848: [0, 0, 139, 255],       // DarkBlue :36676-36677
  912: [173, 216, 230, 255],   // LightBlue :36679-36680
  913: [178, 34, 34, 255],     // Firebrick :36682-36683
  914: [34, 139, 34, 255],     // ForestGreen :36685-36686
  915: [255, 255, 255, 255],   // White :36688-36689
  952: [210, 180, 140, 255],   // Tan :36691-36692
  1028: [128, 128, 128, 255],  // Gray :36694-36696
  1029: [128, 0, 128, 255],    // Purple :36698-36700
  1030: [255, 0, 0, 255],      // Red :36702-36704
  1031: [88, 85, 155, 255],    // new Color(88,85,155) :36706-36708
  1032: [143, 215, 29, 255],   // new Color(143,215,29) :36710-36712
  1033: [0, 0, 255, 255],      // Blue :36714-36716
  1034: WHIP_1034_LINE,        // hslToRgb(0.6,1,0.5,20)×0.6 :36718-36721
  1035: [0, 255, 0, 255],      // Lime :36723-36725
  1104: [78, 136, 255, 255],   // new Color(78,136,255) :36728-36729（画时再 ×0.5 :36751-36753）
};

/** flag（:36694-36726 置位的 1028-1035）→ 鞭身末段少画 1 节（:36734-36736） */
const WHIP_TAIL_SHORT = new Set([1028, 1029, 1030, 1031, 1032, 1033, 1034, 1035]);

/** 鞭身线体段数（:36732-36740）：num = list.Count-1（= segments）,flag 再 -1;
 *  1035 flag2=false 整条不画（:36726/:36738）。测试/调试用纯函数 */
export function whipLineSegmentCount(projId: number, segments: number): number {
  if (projId === 1035) return 0;
  return WHIP_TAIL_SHORT.has(projId) ? segments - 1 : segments;
}

/** 预乘三档染色帧绘制（XNA spriteBatch.Draw 等价;StringLine.drawSegment 同款语义
 *  泛化到任意源/宿矩形+翻转）：pos=落点、ang=旋转、origin=(ox,oy) 贴图内锚点、
 *  sc=(sx,sy) 缩放。白 A=255 免染色直画（node 测试无 canvas 也走此档）。 */
function drawWhipFrame(
  ctx: CanvasRenderingContext2D, tex: Tex,
  sx: number, sy: number, sw: number, sh: number,
  px: number, py: number, ang: number,
  ox: number, oy: number, scx: number, scy: number,
  color: RGBA, flip = false,
): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ang);
  if (flip) ctx.scale(-1, 1);   // XNA FlipHorizontally（origin 恒水平中点,翻转等价）
  ctx.imageSmoothingEnabled = false;
  const dx = -ox * scx, dy = -oy * scy;
  const dw = sw * scx, dh = sh * scy;
  const [r, g, b, a] = color;
  if (r === 255 && g === 255 && b === 255 && a === 255) {
    ctx.drawImage(tex, sx, sy, sw, sh, dx, dy, dw, dh);
  } else if (a === 0) {
    // 纯加色：保形染色 + 'lighter'（A=0 预乘 = 背景零衰减;贡献=tex.rgb×染色×tex.a）
    // ★BJ703-B D5（2026-10-21,BJ371/BJ700-C flatten 判例收编）：旧 flatten=true 把
    //  透明域 multiply 填成不透明染色底（αb=0 域 Co=Cs）→ 'lighter' 全幅加染色=
    //  染色大方片（鞭贴图透明域 67-86%:915 81%/1034 75%/1104 67%/Glow_358 86%/
    //  FishingLine 83%,逐张像素实测）——保形（flatten=false）后透明域贡献 0=XNA
    //  预乘逐项相等。消费面=915 彩虹鞭 ②笔（col×0.1）/1033 电鳗鞭 GlowMask[358]
    //  白辉光（旧=整帧白方片）。
    const t = tintedTex(tex, [r, g, b], false);
    if (t) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(t, sx, sy, sw, sh, dx, dy, dw, dh); }
  } else if (a >= 255) {
    // 纯替换：保形染色 source-over
    const t = tintedTex(tex, [r, g, b], false);
    if (t) ctx.drawImage(t, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    // 中间档两笔：黑形压暗背景(×(1−A/255)) + 保形染色 'lighter' 补贡献
    //  （★BJ703-B D5 同刀:add 笔 flatten=true→false——旧透明域全额加染色=染色带;
    //  保形后贡献=染色×tex.a=XNA 单笔逐项分解。消费面=915 ①③笔（A=127·lerpValue）/
    //  1034 星座鞭中段 (255,255,255,50)（旧=整帧白方片）/1104 史莱姆鞭段 (127,127,127,127)
    //  /1034·1104 渔线线体（A=12/127,FishingLine 仅中 2 列不透明→旧=宽染色带））
    const black = tintedTex(tex, [0, 0, 0], false);
    const t = tintedTex(tex, [r, g, b], false);
    if (black && t) {
      ctx.globalAlpha = a / 255;
      ctx.drawImage(black, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(t, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }
  ctx.restore();
}

/** 竖向帧切片（Texture2D.Frame(cols,rows)[row] 再 Height-=2,各 DrawWhip_* 同款：
 *  :36822-36825/:36869-36872/:37356-37359 等;MoonLordWhip :37058-37060 为 4×7） */
function whipFrameRect(tex: Tex, cols: number, rows: number, row: number): {
  sx: number; sy: number; sw: number; sh: number;
} {
  const fw = tex.width / cols, fh = tex.height / rows;
  return { sx: 0, sy: row * fh, sw: fw, sh: fh - 2 };
}

/** DrawWhip_* 共享上下文（proj 字段 + 视觉控制点） */
export interface WhipTipCtx {
  ctx: CanvasRenderingContext2D;
  /** TextureAssets.Projectile[proj.type]（各 tip 的帧切片源） */
  tex: Tex;
  /** ★鞭尖白笔批透传（2026-10-21 二段;whipSeg 消费——shim 活跃时 White 段收批） */
  r?: import('../render/Renderer').Renderer;
  /** TextureAssets.GlowMask[358]（仅 DrawWhip_EelWhip :37206-37207 加色辉光） */
  glow: Tex | null;
  /** FillWhipControlPoints 视觉曲线（:36658） */
  pts: V2[];
  /** controlPoints.Count - 1（各函数 num3/num4 = 段数） */
  n: number;
  /** GetWhipAnimationPercent（:45763-45768）= ai[0]/timeToFlyOut */
  prog: number;
  /** spriteDirection（:45018） */
  dir: number;
  /** localAI[1]（1035 尾帧行,AI_165 :48541-48543） */
  lai1: number;
  /** miscCounterNormalized（Player.cs:3373;DrawWhip_RainbowWhip :37361） */
  hue: number;
  /** proj.Opacity（Projectile.cs:542-547 = 1-alpha/255,鞭恒 1） */
  opacity: number;
}


/** ★鞭尖批顶点发射（whipSeg 批支与 whipTipRainbow 直调三笔共用——三段刀）:
 *  源矩形 fr、dst 几何（a=锚点/ang/ox/oy/sx/sy/flip）与 whipSeg 同式;color 映射:
 *  White/A=255 → (rgb,1) SO;0<A<255 → (rgb,A) SO 单笔（XNA 预乘单笔=GL 单笔逐项等价,
 *  2D 的黑形+染色两笔是 canvas 无预乘通道时的近似展开——GL 有,单笔还省一笔）;A=0 →
 *  (rgb,0) ADD 桶。返回 true=已入批。 */
function emitWhipQuad(
  c: WhipTipCtx,
  a: V2, ang: number,
  fr: { sx: number; sy: number; sw: number; sh: number },
  ox: number, oy: number, sx: number, sy: number, flip: boolean,
  color: RGBA,
  replayFn: () => void,
): boolean {
  const r = (c as WhipTipCtx & { r?: import('../render/Renderer').Renderer | null }).r ?? null;
  const cam = (r as unknown as { frameCam?: { worldToScreen(wx: number, wy: number): [number, number]; zoom: number } | null } | null)?.frameCam ?? null;
  if (!r || !cam
    || !(r as unknown as { constructor: { whipbatch: boolean } }).constructor.whipbatch
    || !(r as unknown as { bglEntShim?: { active: boolean } }).bglEntShim?.active) return false;
  const W = fr.sw, H = fr.sh;
  const cr = Math.cos(ang), sr = Math.sin(ang);
  const l0 = -ox * sx, l1 = (W - ox) * sx;
  const t0 = -oy * sy, t1 = (H - oy) * sy;
  const eps = -1 / 4096;
  const u0 = (fr.sx + eps) / c.tex.width, u1 = (fr.sx + W + eps) / c.tex.width;
  const w0 = (fr.sy + eps) / c.tex.height, w1 = (fr.sy + H + eps) / c.tex.height;
  // ★坐标域修（2026-10-21 bug 定谳:顶点曾推世界坐标→全屏外消失）:批顶点=屏幕域
  //  （尘批 px/py 同款;2D 路径由 ctx 世界层矩阵转换,批路径绕过 ctx 必须自转）。
  //  W2S=均匀 zoom 缩放+平移 → 旋转角不变、局部偏移×zoom:
  //  屏幕位 = W2S(a) + R(ang)·local×zoom（worldToScreen 数学恒等式）。
  const [ax0, ay0] = cam.worldToScreen(a.x, a.y);
  const zk = cam.zoom;
  const cfun = (lx: number, ly: number): [number, number] =>
    [ax0 + (lx * cr - ly * sr) * zk, ay0 + (lx * sr + ly * cr) * zk];
  const x0f = flip ? l1 : l0, x1f = flip ? l0 : l1;
  const p0 = cfun(x0f, t0), p1 = cfun(x1f, t0), p2 = cfun(x1f, t1), p3 = cfun(x0f, t1);
  const [cr0, cg0, cb0, ca0] = color;
  const addSeg = ca0 === 0;
  const vcr = cr0 / 255, vcg = cg0 / 255, vcb = cb0 / 255, vca = addSeg ? 0 : ca0 / 255;
  const q = (r as unknown as {
    whipLineBatch: Array<{ v: number[]; tex: Tex; key: string; segs: Array<{
      ax: number; ay: number; ang: number; len: number; w: number; h: number; replay?: () => void;
    }> }>;
    whipLineAddBatch: Array<{ v: number[]; tex: Tex; key: string; segs: Array<{
      ax: number; ay: number; ang: number; len: number; w: number; h: number; replay?: () => void;
    }> }>;
  });
  const arr = addSeg ? q.whipLineAddBatch : q.whipLineBatch;
  const wantKey = addSeg ? `whipline:tip:add:${c.tex.width}x${c.tex.height}` : 'whipline:tip';
  let b = arr[arr.length - 1];
  if (!b || b.tex !== c.tex || b.key !== wantKey) {
    b = { v: [], tex: c.tex, key: wantKey, segs: [] } as typeof b;
    arr.push(b);
  }
  b.v.push(p0[0], p0[1], u0, w0, vcr, vcg, vcb, vca, p1[0], p1[1], u1, w0, vcr, vcg, vcb, vca,
    p2[0], p2[1], u1, w1, vcr, vcg, vcb, vca, p0[0], p0[1], u0, w0, vcr, vcg, vcb, vca,
    p2[0], p2[1], u1, w1, vcr, vcg, vcb, vca, p3[0], p3[1], u0, w1, vcr, vcg, vcb, vca);
  b.segs.push({ ax: a.x, ay: a.y, ang, len: -1, w: W, h: H, replay: replayFn });
  return true;
}

/** 段绘制共用（各 tip 循环体同构）：第 i 段 = pts[i]→pts[i+1] 切向,帧 row
 *  （竖向 rows 行、cols 列）,oyShift = origin.Y 偏移（-4/-8 档）,sc=(sx,sy)。
 *  ★三段刀批支=emitWhipQuad（色档映射/replay 闭包统一在那——此处只组装几何+replay）。 */
function whipSeg(
  c: WhipTipCtx, i: number, rows: number, cols: number, row: number,
  oyShift: number, sx: number, sy: number, flip: boolean, color: RGBA = TIP_WHITE,
): void {
  const a = c.pts[i], b = c.pts[i + 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const fr = whipFrameRect(c.tex, cols, rows, row);
  const cc0 = { ...c, r: undefined } as WhipTipCtx;
  if (emitWhipQuad(c, a, Math.atan2(dy, dx) - Math.PI / 2, fr,
    fr.sw / 2, fr.sh / 2 - oyShift, sx, sy, flip, color,
    () => whipSeg(cc0, i, rows, cols, row, oyShift, sx, sy, flip, color))) return;
  drawWhipFrame(c.ctx, c.tex, fr.sx, fr.sy, fr.sw, fr.sh,
    a.x, a.y, Math.atan2(dy, dx) - Math.PI / 2,
    fr.sw / 2, fr.sh / 2 - oyShift, sx, sy, color, flip);
}

/** Utils.GetLerpValue(from,to,t,clamped:true)（Utils.cs:315-334,含 from>to 反向档） */
function getLerpValue(from: number, to: number, t: number): number {
  if (from < to) { if (t < from) return 0; if (t > to) return 1; }
  else { if (t < to) return 1; if (t > from) return 0; }
  return (t - from) / (to - from);
}

/** 挥动包络（:37541-37542/:37601-37602/:37661-37662 同式）：
 *  GetLerpValue(0.1,0.7,t)×GetLerpValue(0.9,0.7,t) —— 伸展期升、0.7 峰值、收回期降 */
function whipSwingEnvelope(t: number): number {
  return getLerpValue(0.1, 0.7, t) * getLerpValue(0.9, 0.7, t);
}

/** Utils.MultiLerp(percent,0,1,0)（Utils.cs:279-290）——电鳗鞭 i==1 段 X 抖动包络
 *  （:37183） */
function multiLerp010(p: number): number {
  const f = [0, 1, 0];
  const step = 1 / (f.length - 1);
  let acc = step, idx = 0;
  while (p / acc > 1 && idx < f.length - 2) { acc += step; idx++; }
  return f[idx] + (f[idx + 1] - f[idx]) * ((p - step * idx) / step);
}

// -------------------- 16 个专署鞭尖函数（:36818-37669 全量 1:1） --------------------

/** DrawWhip_WhipSword（:37446-37495,847 剑鞭）：帧档 switch :37458-37482——
 *  {0}→0(Y-4)/{3,5,7}→1/{9,11,13}→2/{15,17}→3/{19}→4,其余跳笔（:37480-37482）;
 *  scale 1、无翻转 */
function whipTipSword(c: WhipTipCtx): V2 {
  for (let i = 0; i < c.n; i++) {
    let row = -1, oy = 0;
    if (i === 0) { oy = 4; row = 0; }
    else if (i === 3 || i === 5 || i === 7) row = 1;        // switch :37458-37482
    else if (i === 9 || i === 11 || i === 13) row = 2;
    else if (i === 15 || i === 17) row = 3;
    else if (i === 19) row = 4;
    if (row < 0) continue;                                   // default flag=false :37480-37482
    whipSeg(c, i, 5, 1, row, oy, 1, 1, false);
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_WhipBland（:37617-37669,841 皮鞭）：每段都画,行 = 1/2/3 按 i>10/i>20
 *  分档（:37643-37652）,尾段 row4 + scale=lerp(0.5,1.5,包络)（:37654-37662——
 *  先赋 1.3 再被覆写,净效果只余 lerp）;spriteDirection==1 水平翻转 */
function whipTipBland(c: WhipTipCtx): V2 {
  const flip = c.dir === 1;                                  // :37619-37622
  for (let i = 0; i < c.n; i++) {
    let row = 0, oy = 0, sc = 1;
    if (i === 0) oy = 4;                                     // :37637
    else row = i > 20 ? 3 : i > 10 ? 2 : 1;                  // :37643-37652
    if (i === c.n - 1) {                                     // i == Count-2 :37654-37662
      row = 4;
      sc = scalarLerp(0.5, 1.5, whipSwingEnvelope(c.prog));
    }
    whipSeg(c, i, 5, 1, row, oy, sc, sc, flip);              // float scale → 双轴
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_WhipMace（:37497-37555,848 晨星鞭）：偶数段画（i%2==0,行 1/2/3 按
 *  i>10/i>20 分档 :37520-37532）,尾段 row4 + scale=lerp(0.5,2,包络)（:37534-37542） */
function whipTipMace(c: WhipTipCtx): V2 {
  const flip = c.dir === 1;                                  // :37499-37502
  for (let i = 0; i < c.n; i++) {
    let draw = false, row = 0, oy = 0, sc = 1;
    if (i === 0) { oy = 4; draw = true; }                    // :37517-37518
    else if (i % 2 === 0) { draw = true; row = i > 20 ? 3 : i > 10 ? 2 : 1; }
    if (i === c.n - 1) {                                     // i == Count-2 :37534-37542
      draw = true; row = 4;
      sc = scalarLerp(0.5, 2, whipSwingEnvelope(c.prog));
    }
    if (!draw) continue;
    whipSeg(c, i, 5, 1, row, oy, sc, sc, flip);              // float scale → 双轴
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_WhipScythe（:37557-37615,849 黑收成）：与 Mace 全同,尾段 scale 改
 *  lerp(0.5,1.5,包络)（:37594-37602） */
function whipTipScythe(c: WhipTipCtx): V2 {
  const flip = c.dir === 1;                                  // :37559-37562
  for (let i = 0; i < c.n; i++) {
    let draw = false, row = 0, oy = 0, sc = 1;
    if (i === 0) { oy = 4; draw = true; }
    else if (i % 2 === 0) { draw = true; row = i > 20 ? 3 : i > 10 ? 2 : 1; }
    if (i === c.n - 1) {                                     // i == Count-2 :37594-37602
      draw = true; row = 4;
      sc = scalarLerp(0.5, 1.5, whipSwingEnvelope(c.prog));
    }
    if (!draw) continue;
    whipSeg(c, i, 5, 1, row, oy, sc, sc, flip);              // float scale → 双轴
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_CoolWhip（:37251-37300,912 酷鞭）≡ DrawWhip_FireWhip（:37302-37351,
 *  913 火鞭）——帧表/色/缩放逐行相同,同体共享。帧档 {0}→0(Y-4)/{3,5,7}→1/
 *  {9,11,13}→2/{15,17}→3/{19}→4,其余跳笔;色 = GetAlpha(Lighting)（alpha=0 → 原色） */
function whipTipCoolWhip(c: WhipTipCtx): V2 {
  for (let i = 0; i < c.n; i++) {
    let row = -1, oy = 0;
    if (i === 0) { oy = 4; row = 0; }
    else if (i === 3 || i === 5 || i === 7) row = 1;        // switch :37263-37286
    else if (i === 9 || i === 11 || i === 13) row = 2;
    else if (i === 15 || i === 17) row = 3;
    else if (i === 19) row = 4;
    if (row < 0) continue;
    whipSeg(c, i, 5, 1, row, oy, 1, 1, false);
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_ThornWhip（:37406-37444,914 荆棘鞭）：每段都画,尾段 row4 scale1.1、
 *  其余 row=1+i%3 scale0.8（switch :37419-37430） */
function whipTipThorn(c: WhipTipCtx): V2 {
  for (let i = 0; i < c.n; i++) {
    let row = 0, oy = 0, sc = 1;
    if (i === 0) oy = 4;
    else if (i === 19) { row = 4; sc = 1.1; }
    else { row = 1 + (i % 3); sc = 0.8; }
    whipSeg(c, i, 5, 1, row, oy, sc, sc, false);            // float scale → 双轴 :37433
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_RainbowWhip（:37353-37404,915 晨星）：彩虹相 hue=(miscCounterNorm×5+
 *  i×0.05)%1（:37383）;i==0(Y-4)/i==39(row4) 恒画,其余 i%2==0 才画（:37369-37377）。
 *  三笔：①Lerp(光色,彩虹色×A127×lerpValue,0.5)（:37391） ②彩虹×0.1 加色 ×1.2
 *  （:37392-37393） ③i==39 彩虹×0.3(A127) ×1.4（:37396-37398） */
function whipTipRainbow(c: WhipTipCtx): V2 {
  for (let i = 0; i < c.n; i++) {
    let draw = true, row = 0, oy = 0;
    if (i === 0) { oy = 4; row = 0; }
    else if (i === 39) row = 4;
    else { draw = i % 2 === 0; row = 1 + (i % 3); }           // :37371-37376
    if (!draw) continue;
    const hue = (((c.hue * 5 + i * 0.05) % 1) + 1) % 1;      // :37383
    const col = hslToRgb255(hue, 1, 0.5, 255);
    const lv = getLerpValue(c.n - 10, c.n - 2, i);            // :37385
    const a1 = Math.trunc(127 * lv) & 0xff;                   // A/=2 再 ×lv（:37387-37388）
    const a = c.pts[i], b = c.pts[i + 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
    const fr = whipFrameRect(c.tex, 1, 5, row);
    const ox = fr.sw / 2, oy2 = fr.sh / 2 - oy;
    // ①Lerp(Lighting, color2, 0.5)（:37391）——光色本仓取 White（合成乘光）
    const c1: RGBA = [
      Math.trunc(255 + (col[0] - 255) * 0.5) & 0xff,
      Math.trunc(255 + (col[1] - 255) * 0.5) & 0xff,
      Math.trunc(255 + (col[2] - 255) * 0.5) & 0xff, a1,
    ];
    // ★三段刀:三笔经 emitWhipQuad（①中间档 SO 单笔/②A=0 ADD/③中间档）——hue 烘焙链
    //  （tintedTex 每帧全 miss 的万花筒烘焙风暴）在 GL 批下整链退役;批不可用回原式。
    const cR = c;
    const d1 = c1, colR = col;
    if (!emitWhipQuad(cR, a, ang, fr, ox, oy2, 1, 1, false, d1,
      () => drawWhipFrame(cR.ctx, cR.tex, fr.sx, fr.sy, fr.sw, fr.sh, a.x, a.y, ang, ox, oy2, 1, 1, d1))) {
      drawWhipFrame(c.ctx, c.tex, fr.sx, fr.sy, fr.sw, fr.sh, a.x, a.y, ang, ox, oy2, 1, 1, c1);
    }
    // ②color2.A=0 → ×0.1,scale ×1.2（:37392-37393,加色）
    const c2r: RGBA = [Math.trunc(col[0] * 0.1) & 0xff, Math.trunc(col[1] * 0.1) & 0xff, Math.trunc(col[2] * 0.1) & 0xff, 0];
    if (!emitWhipQuad(cR, a, ang, fr, ox, oy2, 1.2, 1.2, false, c2r,
      () => drawWhipFrame(cR.ctx, cR.tex, fr.sx, fr.sy, fr.sw, fr.sh, a.x, a.y, ang, ox, oy2, 1.2, 1.2, c2r))) {
      drawWhipFrame(c.ctx, c.tex, fr.sx, fr.sy, fr.sw, fr.sh, a.x, a.y, ang, ox, oy2, 1.2, 1.2, c2r);
    }
    if (i === 39) {
      // ③color2=color,A=127 → ×0.3,scale ×1.4（:37396-37398）
      const c3r: RGBA = [Math.trunc(colR[0] * 0.3) & 0xff, Math.trunc(colR[1] * 0.3) & 0xff, Math.trunc(colR[2] * 0.3) & 0xff, 127];
      if (!emitWhipQuad(cR, a, ang, fr, ox, oy2, 1.4, 1.4, false, c3r,
        () => drawWhipFrame(cR.ctx, cR.tex, fr.sx, fr.sy, fr.sw, fr.sh, a.x, a.y, ang, ox, oy2, 1.4, 1.4, c3r))) {
        drawWhipFrame(c.ctx, c.tex, fr.sx, fr.sy, fr.sw, fr.sh, a.x, a.y, ang, ox, oy2, 1.4, 1.4, c3r);
      }
    }
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_BoneWhip（:37214-37249,952 骨鞭）：每段都画,i==0(Y-4)/i==19(row4)/
 *  其余 row=1+i%3（switch :37226-37236） */
function whipTipBone(c: WhipTipCtx): V2 {
  for (let i = 0; i < c.n; i++) {
    let row = 0, oy = 0;
    if (i === 0) oy = 4;
    else if (i === 19) row = 4;
    else row = 1 + (i % 3);
    whipSeg(c, i, 5, 1, row, oy, 1, 1, false);
  }
  return c.pts[c.n - 1];
}

/** DrawWhip_SlimeWhip（:36818-36864,1104 史莱姆鞭）：i==0(row0 :36836)/尾段
 *  (row4 :36840)/其中 row=round(lerp(1,3,(i-1)/(n-2)))（:36845-36846）且仅 i%3==0
 *  画（:36847）;色 = Lighting×0.5 → White×0.5 = (127,127,127,127) 截断（:36858） */
function whipTipSlime(c: WhipTipCtx): V2 {
  for (let i = 0; i < c.n; i++) {
    let row: number, draw = true;
    if (i === 0) row = 0;
    else if (i === c.n - 1) row = 4;                            // i == num4-1 :36840
    else {
      row = Math.round(scalarLerp(1, 3, (i - 1) / (c.n - 2)));  // num3 = max(1, num-2) = 3 :36828
      if (i % 3 !== 0) draw = false;                            // :36847-36849
    }
    if (!draw) continue;
    whipSeg(c, i, 5, 1, row, 0, 1, 1, false, [127, 127, 127, 127]);
  }
  return c.pts[c.n];   // 累计位形走完 = 末控制点（:36863）
}

/** DrawWhip_GenericWhip（:36866-36921,1028 麻线鞭 seg6 w1 / 1029 恶魔鞭 1030 血鞭
 *  seg6 w0.5）：跳 i==1（:36882）,i==0(Y-4 :36893-36895)/尾段(row=segmentCount-1
 *  :36897-36899)/其余 row=1+num4%(segmentCount-2)（:36903-36904）;
 *  sx=Remap(num4,5,n×0.75,startW,endW)（:36912-36915,num4==0 → 1） */
function whipTipGeneric(c: WhipTipCtx, segmentCount: number, startWidth: number, endWidth: number): V2 {
  const num2 = Math.max(1, segmentCount - 1);                 // :36874
  const num3 = c.n;                                            // controlPoints.Count-1 :36875
  for (let i = 0; i < num3; i++) {
    if (i === 1) continue;                                      // :36882
    let row: number, oy = 0;
    if (i === 0) { oy = 4; row = 0; }                           // :36893-36895
    else if (i === num3 - 1) row = segmentCount - 1;           // :36897-36899
    else row = 1 + (i % (num2 - 1));                           // num5 = num4 % (num2-num) :36903-36904
    let sx = remap(i, 5, num3 * 0.75, startWidth, endWidth);   // :36912
    if (i === 0) sx = 1;                                        // :36913-36915
    whipSeg(c, i, segmentCount, 1, row, oy, sx, 1, false);
  }
  return c.pts[num3 - 1];
}

/** DrawWhip_FlowerWhip（:36923-36980,1032 花鞭 seg5 w0.5）：同 GenericWhip,但
 *  中段仅 i%2==0 画（:36962）,尾段 origin.Y-8（:36951-36954） */
function whipTipFlower(c: WhipTipCtx, segmentCount: number, startWidth: number, endWidth: number): V2 {
  const num2 = Math.max(1, segmentCount - 1);                 // :36931
  const num3 = c.n;                                              // :36932
  for (let i = 0; i < num3; i++) {
    let row: number, oy = 0;
    if (i === 0) { oy = 4; row = 0; }                           // :36947-36949
    else if (i === num3 - 1) { row = segmentCount - 1; oy = 8; } // :36951-36954
    else {
      row = 1 + (i % (num2 - 1));                               // :36958-36959
      if (i % 2 !== 0) continue;                                // :36962
    }
    let sx = remap(i, 5, num3 * 0.75, startWidth, endWidth);   // :36971
    if (i === 0) sx = 1;                                        // :36972-36974
    whipSeg(c, i, segmentCount, 1, row, oy, sx, 1, false);
  }
  return c.pts[num3 - 1];
}

/** DrawWhip_Constellation（:36982-37054,1034 星座鞭 seg6）：GenericWhip 同构 + 星芒
 *  ——跳 i==1（:37000）;i==0(Y-4,fatness0 :37012-37015)/尾段(row5,fatness×2
 *  :37017-37020);中段色 (255,255,255,50) 且 sx×0.5（:37040-37043）;
 *  fatness×=1+i×0.03（:37033）;(i+1)%3==0 → DrawPrettyStarSparkle（:37047-37049,
 *  shine=hsl(0.6,1,0.5) :37034、draw=White×0.5、flare=挥动进度 :36992、rot=π/2、
 *  scale=(Remap(p,0,1,2,0),Remap(p,0,1,4,0))） */
function whipTipConstellation(c: WhipTipCtx, segmentCount: number): V2 {
  const num2 = Math.max(1, segmentCount - 1);                 // :36990
  const num4 = c.n;                                              // :36993
  for (let i = 0; i < num4; i++) {
    if (i === 1) continue;                                      // :37000
    let fat = 1;                                                // fatness = Vector2.One :37002
    let row: number, oy = 0;
    if (i === 0) { oy = 4; row = 0; fat = 0; }                 // :37012-37015
    else if (i === num4 - 1) { row = segmentCount - 1; fat = 2; } // :37017-37020
    else row = 1 + (i % (num2 - 1));                           // num6 = num5 % (num2-num) :37024-37025
    let sx = remap(i, 5, num4 * 0.75, 1, 1);                   // :37035
    if (i === 0) sx = 1;                                        // :37036-37038
    fat *= 1 + i * 0.03;                                        // :37033
    let color: RGBA = TIP_WHITE;
    if (i !== 0 && i !== num4 - 1) { color = [255, 255, 255, 50]; sx *= 0.5; } // :37040-37043
    whipSeg(c, i, segmentCount, 1, row, oy, sx, 1, false, color);
    if ((i + 1) % 3 === 0) {                                    // :37047
      const p = c.pts[i];
      const shine = hslToRgb255(0.6, 1, 0.5, 255);              // hslToRgb(0.6,1,0.5) = (0,102,255)
      prettyStarSparkle(c.ctx, c.opacity, p.x, p.y,
        [255, 255, 255], [shine[0], shine[1], shine[2]],
        c.prog, 0, 0.5, 0.5, 1, Math.PI / 2,
        [remap(c.prog, 0, 1, 2, 0), remap(c.prog, 0, 1, 4, 0)], [fat, fat],
        0.5, 1);                                                // drawColor=White×0.5 → drawDim 0.5
    }
  }
  return c.pts[num4 - 1];
}

/** DrawWhip_MoonLordWhip（:37056-37106,1035 月主鞭）：Frame(4,7)（:37060）列 0、
 *  scale (1,1.25)（:37091）,尾帧行 = 4+(localAI[1]-1)（:37067,lai1∈1..3 → row4..6）;
 *  i==0(Y-4 :37075)/尾段（:37079）/其余 row=1+i%3（:37083）。1457 的尾彩
 *  rectangle2/color2（:37093-37098）算后未画 = 死代码,不录（1456 曾有第二笔彩虹
 *  描,1457 终态已删）;子鞭 flag=ai[2]>=10（:37068）在 1457 无视觉差 */
function whipTipMoonLord(c: WhipTipCtx): V2 {
  const tailRow = 4 + (c.lai1 - 1);                            // :37067
  for (let i = 0; i < c.n; i++) {
    let row: number, oy = 0;
    if (i === 0) { oy = 4; row = 0; }
    else if (i === c.n - 1) row = tailRow;                      // i == num4-1 :37079
    else row = 1 + (i % 3);                                     // num5 = i % (num2-num) = i%3 :37083
    whipSeg(c, i, 7, 4, row, oy, 1, 1.25, false);
  }
  return c.pts[c.n];
}

/** DrawWhip_MeteorWhip（:37108-37153,1031 星陨鞭 seg6）：i==0(row0)/尾段(row5)/
 *  其余 row=round(lerp(1,4,(i-1)/(n-2)))（:37135-37136）且仅 i%3==0 画（:37137）;
 *  色 = 恒 White 不取光（:37147,本仓同直画） */
function whipTipMeteor(c: WhipTipCtx): V2 {
  for (let i = 0; i < c.n; i++) {
    let row: number, draw = true;
    if (i === 0) row = 0;
    else if (i === c.n - 1) row = 5;                            // i == num4-1 :37130
    else {
      row = Math.round(scalarLerp(1, 4, (i - 1) / (c.n - 2)));  // num3 = max(1, num-2) = 4 :37118
      if (i % 3 !== 0) draw = false;                            // :37137-37139
    }
    if (!draw) continue;
    whipSeg(c, i, 6, 1, row, 0, 1, 1, false, TIP_WHITE);
  }
  return c.pts[c.n];
}

/** DrawWhip_EelWhip（:37155-37212,1033 电鳗鞭 seg5）：i==0 跳笔（:37178-37179）;
 *  i==1(row0,X 抖动 = -6×MultiLerp(prog,0,1,0) 随段角旋转 :37181-37183);尾段
 *  row4（:37189）;其余 row 按 i<25/i<35 分 1/2/3（:37192-37193）;
 *  sx=Remap(i,2,n-5,0.5,1)（:37203）;本体（:37205）+ GlowMask[358] 同矩形加色辉光
 *  （:37206-37207,A=0 纯加色）;dir==1 水平翻转（:37158-37161） */
function whipTipEel(c: WhipTipCtx): V2 {
  const flip = c.dir === 1;                                     // :37158-37161
  for (let i = 0; i < c.n; i++) {
    let draw = true, row = 0, spX = 0;
    if (i === 0) draw = false;                                  // :37178-37179
    else if (i === 1) { row = 0; spX = -6 * multiLerp010(c.prog); } // :37181-37183
    else if (i === c.n - 1) row = 4;                            // i == num2-1 :37189
    else row = i < 25 ? 1 : i < 35 ? 2 : 3;                     // :37192-37193
    if (!draw) continue;
    const a = c.pts[i], b = c.pts[i + 1];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);               // num4 原始角（未 -π/2）
    const px = a.x + Math.cos(ang) * spX, py = a.y + Math.sin(ang) * spX; // spinningpoint.RotatedBy :37205
    const fr = whipFrameRect(c.tex, 1, 5, row);
    const sx = remap(i, 2, c.n - 5, 0.5, 1);                    // :37203 ×proj.scale(=1)
    drawWhipFrame(c.ctx, c.tex, fr.sx, fr.sy, fr.sw, fr.sh,
      px, py, ang - Math.PI / 2, fr.sw / 2, fr.sh / 2, sx, 1, TIP_WHITE, flip);
    if (c.glow) {
      drawWhipFrame(c.ctx, c.glow, fr.sx, fr.sy, fr.sw, fr.sh,
        px, py, ang - Math.PI / 2, fr.sw / 2, fr.sh / 2, sx, 1, [255, 255, 255, 0], flip);
    }
  }
  return c.pts[c.n];
}

/** GenericWhip 1029/1030 共用包装（原版两 case 同函数同参 :36791-36795） */
const whipTipGeneric6Half = (c: WhipTipCtx): V2 => whipTipGeneric(c, 6, 0.5, 0.5);

/** 鞭尖分发表（DrawWhip switch :36759-36815 全 18 条 → 16 个专署函数;
 *  913≡912 同体、1029/1030 同体） */
export const WHIP_TIPS: Record<number, (c: WhipTipCtx) => V2> = {
  847: whipTipSword,                                          // case :36761-36762
  841: whipTipBland,                                          // case :36764-36765
  848: whipTipMace,                                           // case :36767-36768
  849: whipTipScythe,                                         // case :36770-36771
  912: whipTipCoolWhip,                                       // case :36773-36774
  913: whipTipCoolWhip,                                       // case :36776-36777（FireWhip 全同体）
  914: whipTipThorn,                                          // case :36779-36780
  915: whipTipRainbow,                                        // case :36782-36783
  952: whipTipBone,                                           // case :36785-36786
  1028: (c) => whipTipGeneric(c, 6, 1, 1),                    // case :36788-36789
  1029: whipTipGeneric6Half,                                  // case :36791-36792
  1030: whipTipGeneric6Half,                                  // case :36794-36795
  1031: whipTipMeteor,                                        // case :36797-36798
  1032: (c) => whipTipFlower(c, 5, 0.5, 0.5),                 // case :36800-36801
  1033: whipTipEel,                                           // case :36803-36804
  1034: (c) => whipTipConstellation(c, 6),                    // case :36806-36807
  1035: whipTipMoonLord,                                      // case :36809-36810
  1104: whipTipSlime,                                         // case :36812-36813
};

/** 鞭身渔线体（DrawWhip :36732-36756）：FishingLine 染色线体沿控制点链逐段旋贴——
 *  scale=(1,(段长+2)/12)、origin=(W/2,2)（:36662-36663/:36743）;段数见
 *  whipLineSegmentCount（flag 末段少 1 节/1035 整条不画）;1034 flag3 免取光、
 *  1104 色 ×0.5（:36750-36752）——色表落终态后直画 */
function drawWhipLineBody(
  ctx: CanvasRenderingContext2D, tex: Tex, projId: number, pts: V2[],
  r?: import('../render/Renderer').Renderer,
): void {
  if (projId === 1035) return;                                  // flag2=false :36726/:36738
  const color0 = WHIP_LINE_COLORS[projId] ?? TIP_WHITE;         // 缺省 White :36668
  let color = color0;
  if (projId === 1104) {                                        // :36751-36753 color2 ×= 0.5f
    color = [
      Math.trunc(color0[0] * 0.5) & 0xff, Math.trunc(color0[1] * 0.5) & 0xff,
      Math.trunc(color0[2] * 0.5) & 0xff, Math.trunc(color0[3] * 0.5) & 0xff,
    ];
  }
  // 1034 flag3（:36721/:36747-36749）= 免逐段取光——本仓光照由合成统一乘,无分支
  const num = whipLineSegmentCount(projId, pts.length - 1);     // :36733-36736
  // ★鞭线体白笔批（2026-10-21 万花筒掉帧刀;见 Renderer.whipLineBatch 注）:White 档
  //  （r=g=b=a=255 免染色直绘——drawWhipFrame 白快路径）+shim 活跃+批可用 → 顶点
  //  收集（四角=translate·rotate·scale 同式,uv 全贴图+quadSprite −1/4096 tie 补正,
  //  col 恒 1）;每 whip 一条 rec 材料,WhipProj.draw 尾冲（保序=调用序单 rec 原位）。
  //  非 White 档/tinted 批外（染色缓存面批化复杂,登记后续）。
  const canBatch = !!r && (r as unknown as { constructor: { whipbatch: boolean } }).constructor.whipbatch
    && color[0] === 255 && color[1] === 255 && color[2] === 255 && color[3] === 255
    && !!(r as unknown as { bglEntShim?: { active: boolean; batchAvail(): boolean } }).bglEntShim?.active
    && !!(r as unknown as { bglEntShim?: { active: boolean; batchAvail(): boolean } }).bglEntShim?.batchAvail?.();
  let bv: number[] | null = null;
  const segs: Array<{ ax: number; ay: number; ang: number; len: number; w: number; h: number }> = [];
  if (canBatch) bv = [];
  for (let i = 0; i < num; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) - Math.PI / 2;
    if (bv) {
      // 顶点:origin(W/2,2)·scale(1,(len+2)/h) ≙ 2D translate·rotate·drawImage(-ox, -oy, w, h)
      //  四角=(−W/2,−2)..(W/2,len) 局部域经 rotate(ang) 后 + 屏幕锚（★坐标域修:
      //  W2S(a)+R·local×zoom——emitWhipQuad 同款,批顶点=屏幕域）。
      //  ★t0 修正:原式 dy=-oy*scy（2×(len+2)/H 非 2）——一段刀此处有 ~1.7px 平移偏差。
      const W = tex.width, H = tex.height;
      const sc = (len + 2) / H;
      const cam = (r as unknown as { frameCam?: { worldToScreen(wx: number, wy: number): [number, number]; zoom: number } | null }).frameCam;
      if (!cam) { bv = null; segs.length = 0; break; }
      const [ax0, ay0] = cam.worldToScreen(a.x, a.y);
      const zk = cam.zoom;
      const cr = Math.cos(ang), sr = Math.sin(ang);
      const l0 = -W / 2, l1 = W / 2, t0 = -2 * sc, t1 = (len + 2) - 2 * sc;
      const eps = -1 / 4096;
      const u0 = (0 + eps) / W, u1 = (W + eps) / W;
      const w0 = (0 + eps) / H, w1 = (H + eps) / H;
      const c = (lx: number, ly: number): [number, number] =>
        [ax0 + (lx * cr - ly * sr) * zk, ay0 + (lx * sr + ly * cr) * zk];
      const p0 = c(l0, t0), p1 = c(l1, t0), p2 = c(l1, t1), p3 = c(l0, t1);
      void sc;
      bv.push(p0[0], p0[1], u0, w0, 1, 1, 1, 1, p1[0], p1[1], u1, w0, 1, 1, 1, 1,
        p2[0], p2[1], u1, w1, 1, 1, 1, 1, p0[0], p0[1], u0, w0, 1, 1, 1, 1,
        p2[0], p2[1], u1, w1, 1, 1, 1, 1, p3[0], p3[1], u0, w1, 1, 1, 1, 1);
      segs.push({ ax: a.x, ay: a.y, ang, len, w: W, h: H });
      continue;
    }
    // value2 = value.Frame() 整图（:36661,无 Height-=2——与鞭尖帧切片不同档）
    drawWhipFrame(ctx, tex, 0, 0, tex.width, tex.height,
      a.x, a.y, ang,
      tex.width / 2, 2, 1, (len + 2) / tex.height, color);      // origin(W/2,2)/scale(:36662/:36746)
  }
  if (bv && segs.length) {
    (r as unknown as { whipLineBatch: Array<{ v: number[]; tex: Tex; key: string; segs: typeof segs }> })
      .whipLineBatch.push({ v: bv, tex, key: `whipline:${projId}`, segs });
  }
}
