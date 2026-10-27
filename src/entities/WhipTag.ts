// 鞭 tag/proc 共享状态与命中结算 —— 1457 TagEffectStack 框架 1:1：
//  - TagEffectStack（TagEffectStack.cs:1-139）：每玩家 MRU 栈,容量 5
//    （MaxEffects :8;门控 = Player.maxTagEffects :1187,默认 1）
//  - TagEffectState（TagEffectState.cs:1-120）：每 tag 型一份,per-NPC
//    TimeLeftOnNPC/ProcTimeLeftOnNPC 双表（本作敌无槽位复用,用 Map<enemyId,n>）
//  - TagDamageChanges（TagDamageChanges.cs:1-21）：ModifyHit 记账聚合结构体
//  - UniqueTagEffect/WhipTagEffect 族（表数据 = 1457 ItemID.cs:1313-1420 全表 18 条
//    + 9 子类;栈框架本体 = 1457 TagEffectStack.cs）
//  1456 的"单例 tag 挂敌实体"模型（whipTagT 单值字段）已退役：1457 多 tag 全值
//  叠加（Projectile.cs:12946-12962）+ proc 消费语义反转（OnProcHit 返 bool 才清,
//  TagEffectState.cs:113-118）。敌侧不再存 tag 态——查询一律走
//  owner.tagEffectStack（isNPCTagged/canProcOnNPC;★BJ514：anyTagged 聚合查询已
//  退役——原版无此消费面,随从索敌不吃 tag）。
//  tag/proc 时长 = TagDuration × Player.tagEffectDuration（:62-66/:68-71;
//  SilverBracer 6156 族 +2f → ×3）。
import { Arrow, projFrameImg } from './Arrow';
import { Entity } from './Entity';
import { GorePiece } from './GorePiece';
import { playerCanHitEnemy, applyBannerDamageDealt, canBeChasedBy, hitTownNpcs, townVoodooGateOpen } from './projTargets';   // ★BJ729-A（D1 B27）：1045 城镇 voodoo 靶（townVoodooGateOpen=collide 位窄门谓词）
import { trySnapStrike } from '../stats/SnapStrike';
import type { GameHooks } from './types';
import type { Player } from './Player';
// RainbowRodHit 编排本体（收编池;L5 批 2026-08-31——kaleidoscope 鞭 tag 命中
// 本地直生 + broadcast 上行同用此函数）
import { rainbowRodHitFx, blackLightningHitFx, blueLightningSmallLongFx, trueExcaliburFx } from '../fx/orchestraFx';
import { ParticleOrchestraType } from '../net/syncModules';

/** NPCID.Sets.DebuffImmunitySets.ImmuneToWhips（1457 NPCID.cs 全表解析,
 *  CanApplyTagToNPC 门 WhipTagEffect.cs:20-31）：11 种敌不吃鞭 tag */
export const TAG_IMMUNE_TO_WHIPS = new Set([68, 72, 392, 440, 491, 549, 583, 584, 585, 686, 687]);

/** UniqueTagEffect 子类行为档（Terraria.GameContent.Items/WhipTagEffect_*.cs） */
export type TagEffectKind =
  | 'base' | 'starcrash' | 'flower' | 'possession' | 'firecracker'
  | 'swordwhip' | 'eel' | 'darkharvest' | 'constellation' | 'kaleidoscope';

/** WhipTagEffect 单条（1457 ItemID.cs:1313-1420 UniqueTagEffects object[36] = 18 条全表）；
 *  TagDuration 缺省 240（WhipTagEffect.cs:17 generalWhipMarkDuration + ctor :19-22）,
 *  唯一覆写 = 5479 星鞭 480（1457 ItemID.cs:1402） */
export interface TagEffectDef {
  itemId: number;
  kind: TagEffectKind;
  tagDuration: number;
  tagDamage: number;
  critChance: number;
  /** PlayerBuffId/PlayerBuffTime（OnTagAppliedToNPC → AddTheBuff :53-60,时长 ×
   *  tagEffectDuration）；PlayerBuffAppliedManually=true 的 5473/4911 不走此链
   *  （由鞭命中分支 case 912/1028 授予,见 WHIP_HIT_BUFF） */
  playerBuffId: number;
  playerBuffTime: number;
  playerBuffAppliedManually: boolean;
}

const def = (itemId: number, tagDamage: number, extra: Partial<TagEffectDef> = {}): TagEffectDef => ({
  itemId, kind: 'base', tagDuration: 240, tagDamage, critChance: 0,
  playerBuffId: 0, playerBuffTime: 0, playerBuffAppliedManually: false, ...extra,
});

/** ItemID.Sets.UniqueTagEffects（1457 ItemID.cs:1313-1420,object[36] = 18 条） */
export const TAG_EFFECTS: Record<number, TagEffectDef> = {
  5688: def(5688, 3),                                                        // :1315-1318
  5473: def(5473, 3, { playerBuffId: 365, playerBuffTime: 180, playerBuffAppliedManually: true }), // :1319-1326
  4672: def(4672, 4),                                                        // :1327-1330
  5474: def(5474, 5),                                                        // :1331-1334
  5475: def(5475, 5),                                                        // :1335-1338
  5476: def(5476, 2, { kind: 'starcrash' }),                                 // :1339-1342
  4913: def(4913, 6, { playerBuffId: 314, playerBuffTime: 180 }),            // :1343-1348
  5074: def(5074, 7),                                                        // :1349-1352
  4911: def(4911, 6, { playerBuffId: 312, playerBuffTime: 180, playerBuffAppliedManually: true }), // :1353-1360
  // 4678 剑鞭 → WhipTagEffect_SwordWhip（:1368-1374）：ModifyProcHit → MegaSlash
  //  （+30 flat + TrueExcalibur 粒子,WhipTagEffect_SwordWhip.cs:17-27）、OnProcHit 恒 true
  4678: def(4678, 9, { kind: 'swordwhip', playerBuffId: 308, playerBuffTime: 180 }),
  5477: def(5477, 9, { kind: 'flower' }),                                    // :1375-1379
  4680: def(4680, 15, { kind: 'darkharvest', playerBuffId: 311, playerBuffTime: 180 }),  // :1380-1386
  4679: def(4679, 8, { critChance: 10 }),                                    // :1387-1392
  // 5478 电鳗鞭 → WhipTagEffect_ElectricEel（:1393-1397）：ModifyProcHit → 链电
  //  （+50 flat + 5 目标 ×20 直伤,WhipTagEffect_ElectricEel.cs:18-56）、OnProcHit 恒 true
  5478: def(5478, 12, { kind: 'eel', critChance: 5 }),
  // 5479 星鞭 → WhipTagEffect_Constellation（:1399-1405）：TagDuration=480 全表唯一覆写
  //  （:1402）;OnTaggedHit 启 proc 窗/OnProcHit 仅鞭本体 1034 消费,见 onHit 注
  5479: def(5479, 15, { kind: 'constellation', critChance: 15, tagDuration: 480 }),
  4914: def(4914, 20, { kind: 'kaleidoscope', critChance: 10 }),             // :1406-1411
  5480: def(5480, 25, { kind: 'possession', critChance: 10 }),               // :1412-1417
  4912: def(4912, 0, { kind: 'firecracker' }),                               // :1418-1419
};

// ---- 兼容导出（旧单值表 → 新框架派生；消费方 WhipProj/测试沿用） ----
/** 鞭 → TagDamage（派生自 TAG_EFFECTS） */
export const WHIP_TAG: Record<number, number> = Object.fromEntries(
  Object.values(TAG_EFFECTS).map((d) => [d.itemId, d.tagDamage]),
);
/** 鞭 Tag 暴击率%（派生） */
export const WHIP_TAG_CRIT: Record<number, number> = Object.fromEntries(
  Object.values(TAG_EFFECTS).filter((d) => d.critChance > 0).map((d) => [d.itemId, d.critChance]),
);
/** tag 命中授予的玩家 buff（非 manual 档；施加点 = TagEffectState.applyTagToNPC） */
export const WHIP_TAG_BUFF: Record<number, number> = Object.fromEntries(
  Object.values(TAG_EFFECTS).filter((d) => d.playerBuffId > 0 && !d.playerBuffAppliedManually)
    .map((d) => [d.itemId, d.playerBuffId]),
);
/** 鞭命中分支授予的玩家 buff（TryDoingOnHitEffects case 912 → 312/180、case 1028 →
 *  365/180,Projectile.cs:13979-13999——manual 档,不 × tagEffectDuration） */
export const WHIP_HIT_BUFF: Record<number, number> = Object.fromEntries(
  Object.values(TAG_EFFECTS).filter((d) => d.playerBuffId > 0 && d.playerBuffAppliedManually)
    .map((d) => [d.itemId, d.playerBuffId]),
);
/** 鞭命中附属召唤（case 912 → 雪花哨兵 917 伤 15 / case 1028 → 小蜘蛛 1036 伤 2,
 *  :13979-13999；coolWhipBuff/cobWhipBuff 在场期不重复） */
export const WHIP_HIT_SIDEKICK: Record<number, { proj: number; dmg: number }> = {
  4911: { proj: 917, dmg: 15 }, 5473: { proj: 1036, dmg: 2 },
};
/** GetWhipSettings segments（1457 Projectile.cs:49219-49300,默认 20） */
export const WHIP_SEGMENTS: Record<number, number> = {
  1104: 36, 1028: 12, 847: 20, 848: 40, 849: 30, 1033: 45, 915: 40, 1035: 30,
};
/** GetWhipSettings rangeMultiplier（:49227-49299）。晨星 848 是赋值 1.6 */
export const WHIP_RANGE: Record<number, number> = {
  1104: 0.75, 1028: 0.75, 841: 0.75, 1029: 0.95, 1030: 0.85, 914: 1.0,
  1031: 1.1, 952: 0.95, 913: 1.4, 912: 1.5, 847: 1.75, 1032: 1.8,
  848: 1.6, 849: 2.15, 1033: 2.0, 915: 2.2, 1034: 2.2, 1035: 2.2,
};
/** 多目标伤害衰减（1457 Projectile.cs:13453-13550 Damage_PVE_Inner 内 switch(type)：
 *  命中后鞭 damage 字段 ×此倍率,键=projId;1034 星鞭 0.90 在 :13545-13547） */
export const WHIP_FALLOFF: Record<number, number> = {
  1104: 0.40, 1028: 0.40, 841: 0.50, 1029: 0.60, 1030: 0.60, 914: 0.60,
  1031: 0.70, 952: 0.90, 913: 0.66, 912: 0.70, 847: 0.80, 1032: 0.85,
  848: 0.95, 849: 0.90, 1033: 0.95, 915: 0.80, 1034: 0.90, 1035: 0.95,
};
/** proc 启用鞭（1457 Projectile.cs:13968-14013 TryDoingOnHitEffects 尾 switch(type)）：
 *  {913,1031,1032} 首鞭门（localAI[0]==0 才 TryEnableProc :13970-13977）；
 *  {847,1033,1035} 每鞭无条件（:14009-14013）。849 无分支（黑收成 4680 的 916 走
 *  OnTaggedHit,WhipTagEffect_DarkHarvest.cs:9-12,无需 proc）;1034 星鞭独立 case
 *  （:14001-14007 CanProcOnNPC 门 + 撒星 + RemoveAllProcs,见 WhipProj 注）。
 *  键=物品 id（tagEffectType）,proj→item：913→4912（Item.cs:39836-39837）/
 *  1031→5476（:43172-43174）/1032→5477（:43176-43178）/847→4678（:38539-38540）/
 *  1033→5478（:43180-43182）/1035→5480（:43188-43190） */
export const WHIP_PROC_ITEMS = new Set([4912, 5476, 5477, 4678, 5478, 5480]);
/** 首鞭门组（case 913/1031/1032 :13970-13977 localAI[0]==0 才 TryEnableProc;
 *  847/1033/1035 无门） */
export const WHIP_PROC_ONCE_ITEMS = new Set([4912, 5476, 5477]);
/** extraUpdates 覆盖（SetDefaults :7862-7885：847/849 extraUpdates=2 → MaxUpdates=3；
 *  其余 DefaultToWhip extraUpdates=1 :10103 → MaxUpdates=2） */
export const WHIP_EXTRA_UPDATES = new Set([847, 849]);
/** ProjectileID.Sets.SummonTagDamageMultiplier（1457 ProjectileID.cs:37
 *  `CreateFloatSet(1f, 864f, 0.669f)`——864 Smolstar 唯一非 1 项;1456 的
 *  688/689/690=0.5 闪电光环条目 1457 已删） */
export const SUMMON_TAG_MUL: Record<number, number> = { 864: 0.669 };
/** ProjectileID.Sets.MinionShot（1457 ProjectileID.cs:291）——吃鞭 tag 的随从弹
 *  （1120 ForbiddenMinionShot 为 1457 新增,:2692） */
export const MINION_SHOT_SET = new Set([374, 376, 389, 195, 408, 433, 614, 818, 1044, 1097, 1106, 1120]);
/** ProjectileID.Sets.SentryShot（1457 ProjectileID.cs:293）——吃鞭 tag 的哨兵弹 */
export const SENTRY_SHOT_SET = new Set([680, 664, 666, 668, 694, 695, 696, 644, 642, 378, 379, 309, 967, 1026]);

export function whipTagDamageOf(itemId: number): number {
  return WHIP_TAG[itemId] ?? 0;
}

/** 敌侧命中通道（1457 起敌实体不再存 tag 态——只剩 OnTaggedHit 直伤回调挂载点
 *  916 黑闪电等价 + 敌 id 供栈查询） */
export interface WhipTagged {
  id: number;
  /** OnTaggedHit 汇出回调（黑收成 916 等价）：★W5 定谳改约——d = 916 黑闪电单跳
   *  伤值（TagDamage × SummonTagDamageMultiplier[触发弹],_DarkHarvest.cs:16）,
   *  受理方在主命中受理+写梯后调 darkHarvestChain 落地【链电】——916 出膛即对被
   *  命中敌 localNPCImmunity=-1 永免（_DarkHarvest.cs:18）,伤落【其他】敌
   *  （原版序 :13711 OnHit 在 StrikeNPC :13702 后,弹体伤再后） */
  hurtFx?: (d: number) => void;
}

/** TagDamageChanges（TagDamageChanges.cs:1-21）；None = TotalDamageMultiplier 1 */
export interface TagDamageChanges {
  addProjectileTagDamage: boolean;
  addedBaseDamage: number;
  addedFlatDamage: number;
  totalDamageMultiplier: number;
  /** bool?——null = 无强制暴击档 */
  crit: boolean | null;
  highestAddedBaseDamage: number;
}
export const tagDamageChangesNone = (): TagDamageChanges => ({
  addProjectileTagDamage: false, addedBaseDamage: 0, addedFlatDamage: 0,
  totalDamageMultiplier: 1, crit: null, highestAddedBaseDamage: 0,
});

/** 命中结算上下文（resolveWhipTagHit 注入;等价原版把 Projectile/NPC 指针传进
 *  ModifyHit/OnHit——本作以 id+坐标+回调表达） */
export interface WhipHitCtx {
  /** 命中弹 projId（CanProcOnNPC 消费门 1034/SummonTagDamageMultiplier 表键） */
  projId: number;
  /** Projectile.bonusTagDamage（词缀 I:567;WhipProj 命中侧注入,合成 :12955 只加一次） */
  bonusTagDamage: number;
  /** 命中点（特效生成锚） */
  hx: number;
  hy: number;
  /** OnTaggedHit 直伤通道（4680 黑闪电 916 等价） */
  hurtFx?: (d: number) => void;
  /** 特效弹注册器 */
  add: (e: unknown, bucket?: string) => void;
  /** 被命中敌 id（栈查询键;等价 npcHit.whoAmI） */
  hurtNpcId: number;
  /** 被命中敌 realLife（-1 = 无;电鳗链电同 realLife 跳过 :38） */
  realLife: number;
  /** 被命中敌宽高（花瓣速度 max(w,h)/8、月主弹外扩盒） */
  hurtEnemyWH: { w: number; h: number };
  /** 被命中敌左上角（月主弹 1045 出生盒 = Hitbox.Inflate(30,16).Y-8 :14985-14987） */
  hurtEnemyXY: { x: number; y: number };
  /** 被命中敌速度（月主弹出生点敌速 ×16 前置 :15008；缺省 0） */
  hurtEnemyVel: { x: number; y: number };
}

/** 单个 tag 型的激活态（TagEffectState.cs:1-120 1:1;int[maxNPCs] 双表 → Map） */
export class TagEffectState {
  type = 0;
  /** TimeLeftOnNPC[npcId]（:14） */
  private time = new Map<number, number>();
  /** ProcTimeLeftOnNPC[npcId]（:15） */
  private procTime = new Map<number, number>();
  /** 本 tag 型打 tag 时携带的鞭词缀 bonusTagDamage（本仓登记偏差,见 applyTagToNPC） */
  appliedBonus = 0;
  constructor(private owner: Player) {}

  get def(): TagEffectDef | undefined { return TAG_EFFECTS[this.type]; }

  isNPCTagged(npcId: number): boolean { return (this.time.get(npcId) ?? 0) > 0; }        // :26-28
  canProcOnNPC(npcId: number): boolean { return (this.procTime.get(npcId) ?? 0) > 0; }   // :30-32
  clearProcOnNPC(npcId: number): void { this.procTime.set(npcId, 0); }                    // :34-36
  removeAllProcs(): void { this.procTime.clear(); }                                       // :38-41
  resetNPCSlotData(npcId: number): void { this.time.delete(npcId); this.procTime.delete(npcId); } // :43-47

  /** Activate（:49-54）：_effect = UniqueTagEffects[type] + OnSetToPlayer（基类空） */
  activate(tagType: number): void { this.type = tagType; }
  /** Deactivate（:56-60）：OnRemovedFromPlayer（WhipTagEffect :33-39 清玩家 buff）+ Clear */
  deactivate(): void {
    const d = this.def;
    if (d?.playerBuffId) delete this.owner.whipBuffs[d.playerBuffId]; // ClearBuff(PlayerBuffId)
    this.time.clear();
    this.procTime.clear();
    this.appliedBonus = 0;
  }

  /** ApplyTagToNPC（:62-66）：TimeLeft = (int)(TagDuration × tagEffectDuration) +
   *  OnTagAppliedToNPC → AddTheBuff（:53-60,非 manual 档,时长同缩放）。
   *  bonusTagDamage 形参 = 本仓登记偏差：1457 管线的 Projectile.bonusTagDamage 是
   *  【命中弹】自带（ApplyStatsFromSource :11129/:11140 按物品词缀继承,鞭本体不吃
   *  tag 故其词缀无消费点）;本仓延续 1456 近似——把鞭词缀 I:567 tagdmg 挂到 tag 态,
   *  随从命中被 tag 敌时并入（保词缀面板"召唤伤害 +N"可观察） */
  applyTagToNPC(npcId: number, bonusTagDamage = 0): void {
    const d = this.def;
    if (!d) return;
    this.time.set(npcId, Math.trunc(d.tagDuration * this.owner.tagEffectDuration));
    if (bonusTagDamage > this.appliedBonus) this.appliedBonus = bonusTagDamage;
    if (d.playerBuffId > 0 && !d.playerBuffAppliedManually) {
      this.owner.whipBuffs[d.playerBuffId] =
        Math.max(this.owner.whipBuffs[d.playerBuffId] ?? 0,
          Math.trunc(d.playerBuffTime * this.owner.tagEffectDuration));
    }
  }

  /** EnableProcOnNPC（:68-71）：ProcTimeLeft = (int)(TagDuration × tagEffectDuration) */
  enableProcOnNPC(npcId: number): void {
    const d = this.def;
    if (!d) return;
    this.procTime.set(npcId, Math.trunc(d.tagDuration * this.owner.tagEffectDuration));
  }

  /** Update（:100-112）：双表逐项递减（0 项摘除防 Map 无界生长——原版数组原地清零等价） */
  update(): void {
    for (const [k, v] of this.time) { if (v <= 1) this.time.delete(k); else this.time.set(k, v - 1); }
    for (const [k, v] of this.procTime) { if (v <= 1) this.procTime.delete(k); else this.procTime.set(k, v - 1); }
  }

  /** ModifyHit（:97-107）：IsNPCTagged && CanRunHitEffects（调用侧已门）→
   *  ModifyTaggedHit 记账 + CanProc → ModifyProcHit */
  modifyHit(ctx: WhipHitCtx, changes: TagDamageChanges, game: GameHooks): void {
    const d = this.def;
    if (!d || !this.isNPCTagged(ctx.hurtNpcId)) return;
    // WhipTagEffect.ModifyTaggedHit（:62-74）：AddProjectileTagDamage=true;
    // AddedBaseDamage += TagDamage;Highest 取 max;crit 掷 Next(100)<CritChance
    changes.addProjectileTagDamage = true;
    changes.addedBaseDamage += d.tagDamage;
    if (changes.highestAddedBaseDamage < d.tagDamage) changes.highestAddedBaseDamage = d.tagDamage;
    if (d.critChance > 0 && Math.random() * 100 < d.critChance) changes.crit = true;
    // 子类 ModifyProcHit（proc 窗口内一次性——消费在 onHit 侧,窗口判定此处）。
    // 1457 表 firecracker/swordwhip/eel 三档有 ModifyProcHit（TagEffectState.ModifyHit
    //  :87-95 CanProcOnNPC 门内调 _effect.ModifyProcHit）
    if (this.canProcOnNPC(ctx.hurtNpcId)) {
      switch (d.kind) {
        case 'firecracker':
          // WhipTagEffect_Firecracker.cs:9-12：TotalDamageMultiplier *= 2.75
          //（1456 是 1.75 加算——1457 改乘区且乘在含 tag 总伤上）
          changes.totalDamageMultiplier *= 2.75;
          break;
        case 'swordwhip':
          // WhipTagEffect_SwordWhip.MegaSlash :17-27：+30 固定伤 + TrueExcalibur 粒子
          //（:22 RequestParticleSpawn(clientOnly:false)——L5 长尾批收编真值本体
          //  fx/orchestraFx.trueExcaliburFx（红粉前置带+Excalibur 金双带+d242/d169 门掷）
          //  + module8 上行；旧 916 弹视觉占位退役）
          changes.addedFlatDamage += 30;
          trueExcaliburFx(game, ctx.hx, ctx.hy);
          game.broadcastParticleOrchestra?.(ParticleOrchestraType.TrueExcalibur, ctx.hx, ctx.hy);
          break;
        case 'eel':
          // WhipTagEffect_ElectricEel.CreateLightningBlast :20-57：链电 5 目标 ×20 直伤
          // + AddedFlatDamage += 50 + 命中数×50（死代码 if(0==1) 勿照抄 :28-31）
          changes.addedFlatDamage += this.eelChainBlast(ctx, game);
          break;
        default:
          break;
      }
    }
  }

  /** ElectricEel 链电（WhipTagEffect_ElectricEel.cs:20-56）：命中盒 450px 内最近
   *  5 个 CanBeChasedBy 目标,各吃 20 直伤（TryHittingNPC 5478 tag 源）,返回 flat
   *  加成 50+50×n;NPCHit34 音在循环外无条件播（:54） */
  private eelChainBlast(ctx: WhipHitCtx, g: GameHooks): number {
    let hits = 0;
    for (const ent of g.enemies()) {
      if (hits >= 5) break;                                   // num2 = 5
      const en2 = ent as unknown as {
        id: number; dead: boolean; x: number; y: number; w: number; h: number; realLife?: number | null;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
      };
      if (en2.dead || en2.id === ctx.hurtNpcId) continue;      // i != npcHit.whoAmI
      if (ctx.realLife !== -1 && ctx.realLife === (en2.realLife ?? -1)) continue; // 同 realLife 跳过
      // npcHit.Distance(nPC.Hitbox.ClosestPointInRect(npcHit.Center)) > 450 → skip
      const px = Math.max(en2.x, Math.min(en2.x + en2.w, ctx.hx));
      const py = Math.max(en2.y, Math.min(en2.y + en2.h, ctx.hy));
      if (Math.hypot(px - ctx.hx, py - ctx.hy) > 450) continue;
      if (!canBeChasedBy(ent)) continue;   // :41 CanBeChasedBy（索敌门;★BJ449 勘误:
        //  旧读 playerCanHitEnemy 命中门系注释自称 CanBeChasedBy 而实现错挂——
        //  immortal 488/690、chaseable=false {379,380,399,437,438,440,523}、
        //  dontTakeDamage、lifeMax≤5 族在原版不耗链位;城镇 NPC 经 !friendly 同门排除）
      hits++;
      en2.hurt(applyBannerDamageDealt(g, en2, 20), 0, 0, g, 0, false, 0, true);               // TryHittingNPC(nPC, 20, 0, null, 5478);fromPlayer=DPS 计
      // BlueLightningSmallLong 链电（WhipTagEffect_ElectricEel.cs:46 RequestParticleSpawn
      // clientOnly:false——PositionInWorld=链电目标盒内随机点(vector2)、MovementVector=
      // 命中盒内随机点−目标点(vector−vector2)。L5 长尾批收编真值本体（25px 步进复播
      // LightningSmall）;旧 '#60C8FF' 粒子占位退役。命中盒内随机点以命中锚点近似。
      const mvEx = ctx.hx + (Math.random() - 0.5) * (ctx.hurtEnemyWH.w ?? 0) - px;
      const mvEy = ctx.hy + (Math.random() - 0.5) * (ctx.hurtEnemyWH.h ?? 0) - py;
      blueLightningSmallLongFx(g, px, py, mvEx, mvEy);
      g.broadcastParticleOrchestra?.(ParticleOrchestraType.BlueLightningSmallLong, px, py, mvEx, mvEy);
    }
    g.playSfxFiles?.(['npc_hit34'], 0.6, ctx.hx, ctx.hy);     // SoundID.NPCHit34 :54（循环外无条件）
    return 50 + hits * 50;                                    // :55 AddedFlatDamage += 50+hits×50
  }

  /** ★BJ643② 火鞭 proc 爆炸 918 出生爆花演出面（AI_178_FireExplosion
   *  Projectile.cs:46098-46148 localAI[0]==0 支 1:1;2026-10-11——BJ639 判
   *  「出生 10t 尘/gore 爆花缺」本刀补齐,伤害面（96×96 全 NPC 环+城镇窄门）零改动）。
   *  918 本体不可见（SetDefaults :8691-8703 alpha=255 无专属绘制面）+寿命 10t
   *  （:46143-46147 localAI≥10 Kill,期间唯一行为=伤害盒）——仓内无载体弹（伤害面
   *  折算即爆）,出生即爆=观感面等价。Center=命中锚（CreateExplosion :21-26
   *  NewProjectile(npcHit.Center, Vector2.Zero) 居中语义 P.cs:10878-10880;
   *  width/height=96）。velocity 恒零 → ToRotation()=0（:46123/:46130 方向环纯横向）。
   *  · 音 :46102 SoundID.Item14（爆炸）
   *  · A 组 4×d31 烟（:46103-46107）：α100 scale1.5、重力置位（无 noGravity 行）,
   *    位=Center+UnitY.RotatedByRandom(π)×NextDouble()×width/2（RotatedByRandom=
   *    三角掷 (rng−rng)×max,Utils.cs:1785-1788/F6 判例;UnitY 旋 θ→(−sinθ,cosθ)）
   *  · B 组 30×(2×d6 火)（:46108-46119）：d6 α200 scale3.7 noGr 速×3 / d6 α100
   *    scale1.5 noGr fadeIn2.5 速×2——位式同 A
   *  · C 组 10×d6（:46120-46126）α0 scale2.7 noGr 速×3 / D 组 10×d31（:46127-46133）
   *    α0 scale1.5 noGr 速×3——位=Center+UnitX.RotatedByRandom(π).RotatedBy(
   *    velocity.ToRotation())×width/2（UnitX 旋 θ→(cosθ,sinθ);再旋 0 = 纯横向）
   *  · gore 2×（:46134-46141）：Next(61,64) 烟团,NewGore 传入位=盒内随机量化位
   *    （width×Next(100)/100）−One×10 → 即刻覆写位式同 A;速链=NewGore 内扰动
   *    （Gore.cs:1347-1348,GorePiece.newGore 同式）→×0.3 → X/Y+=Next(-10,11)×0.05
   */
  private firecracker918Burst(g: GameHooks, hx: number, hy: number): void {
    g.playSfxFiles?.(['Item_14'], 1, hx, hy);                       // :46102
    const w2 = 48;                                                  // width/2（SetDefaults 96×96 :8702-8703）
    const posY = (): [number, number] => {                          // :46106/:46111/:46115 位式（UnitY 半圆）
      const t = (Math.random() - Math.random()) * Math.PI;          // RotatedByRandom(π) 三角掷
      const r = Math.random();                                      // NextDouble()
      return [hx - Math.sin(t) * r * w2, hy + Math.cos(t) * r * w2];
    };
    const posX = (): [number, number] => {                          // :46123/:46130 位式（UnitX,再旋 ToRotation()=0）
      const t = (Math.random() - Math.random()) * Math.PI;
      const r = Math.random();
      return [hx + Math.cos(t) * r * w2, hy + Math.sin(t) * r * w2];
    };
    const dust = (type: number, alpha: number, scale: number,
      pos: [number, number]): { vx: number; vy: number; noGravity: boolean; fadeIn: number } | null => {
      const d = g.spawnDust?.(hx - w2, hy - w2, w2 * 2, w2 * 2, type, 0, 0, alpha, null, scale);
      if (d) { d.x = pos[0]; d.y = pos[1]; }
      return d ?? null;
    };
    // A 组（:46103-46107）
    for (let i = 0; i < 4; i++) dust(31, 100, 1.5, posY());
    // B 组（:46108-46119）
    for (let j = 0; j < 30; j++) {
      const b1 = dust(6, 200, 3.7, posY());
      if (b1) { b1.noGravity = true; b1.vx *= 3; b1.vy *= 3; }      // :46112-46113
      const b2 = dust(6, 100, 1.5, posY());
      if (b2) { b2.vx *= 2; b2.vy *= 2; b2.noGravity = true; b2.fadeIn = 2.5; }   // :46116-46118
    }
    // C 组（:46120-46126）/ D 组（:46127-46133）
    for (let k = 0; k < 10; k++) {
      const c = dust(6, 0, 2.7, posX());
      if (c) { c.noGravity = true; c.vx *= 3; c.vy *= 3; }          // :46124-46125
      const d4 = dust(31, 0, 1.5, posX());
      if (d4) { d4.noGravity = true; d4.vx *= 3; d4.vy *= 3; }      // :46131-46132
    }
    // gore 2×（:46134-46141）
    for (let m = 0; m < 2; m++) {
      const p0: [number, number] = [                                 // :46136 NewGore 传入位（盒内量化位）−One×10
        hx - w2 + (w2 * 2 * Math.floor(Math.random() * 100)) / 100 - 10,
        hy - w2 + (w2 * 2 * Math.floor(Math.random() * 100)) / 100 - 10,
      ];
      const go = GorePiece.newGore(61 + Math.floor(Math.random() * 3), p0[0], p0[1], 0, 0);   // Next(61,64)
      if (go) {
        const pos = posY();                                          // :46137 即刻覆写位（式同 A）
        go.x = pos[0]; go.y = pos[1];
        go.vx *= 0.3; go.vy *= 0.3;                                  // :46138
        go.vx += (Math.floor(Math.random() * 21) - 10) * 0.05;       // :46139 Next(-10,11) 右开
        go.vy += (Math.floor(Math.random() * 21) - 10) * 0.05;       // :46140
      }
    }
  }

  /** OnHit（:109-119）：OnTaggedHit + CanProc → OnProcHit 返 true 才 ClearProc
   *  （1457 消费语义反转——基类默认 false 不消耗 :41-44） */
  onHit(ctx: WhipHitCtx, calcDamage: number, game: GameHooks): void {
    const d = this.def;
    if (!d || !this.isNPCTagged(ctx.hurtNpcId)) return;
    const npcId = ctx.hurtNpcId;
    switch (d.kind) {
      case 'darkharvest':
        // WhipTagEffect_DarkHarvest :11-22（每次被 tag 敌被吃鞭 tag 的命中都触发）：
        // 916 黑闪电,伤 = TagDamage × SummonTagDamageMultiplier[projType]（:16）;
        // 命中粒子 = EmitBlackLightningParticles(:22 RequestParticleSpawn(clientOnly:false,
        // BlackLightningHit))——L5 长尾批收编真值本体 blackLightningHitFx(7 环帧条)
        // + module8 上行;旧 Arrow 916 视觉占位退役。
        // ★W5 定谳（Terarria1457 亲读三证）：①:18 `localNPCImmunity[npcHit]=-1`
        // 出膛永免被命中敌（Damage_PVE :12595 usesLocal array[i]==0 门 + 减表
        // :17380 只递减 >0 → -1 恒存;AI_176 索敌 :45881/:45925 同门排除）——916
        // 伤【永不】落回被命中敌,原版物品词条 "Dark energy jumps from enemies hit
        // by summons"（Items.json:8299）同证;②真正伤面 = 916 弹 AI_176 逐跳链电
        // （darkHarvestChain 折算）,经 hurtFx 汇出到受理方【延迟】落地（:13711 OnHit
        // 在 StrikeNPC :13702 后,弹体伤再后）——旧 hurtFx 直调被命中敌=目标面
        // 反记+tag 伤双记（主命中 ModifyHit :12954 已并 TagDamage 一次）,一并纠正。
        ctx.hurtFx?.(Math.max(1, Math.trunc(d.tagDamage * (SUMMON_TAG_MUL[ctx.projId] ?? 1))));
        blackLightningHitFx(game, ctx.hx, ctx.hy);
        game.broadcastParticleOrchestra?.(ParticleOrchestraType.BlackLightningHit, ctx.hx, ctx.hy);
        break;
      case 'constellation':
        // WhipTagEffect_Constellation.OnTaggedHit :6-10：吃 tag 的随从/哨兵弹命中
        //  → TryEnableProcOnNPC(5479, npcHit) 开 proc 窗;星雨本体撒星在鞭 1034 自身
        //  命中侧（Projectile.cs:14001-14007 CanProcOnNPC 门,见 WhipProj 注——鞭本体
        //  CanRunHitEffects=false 不走本通道,WhipTagEffect.cs:76-87）
        this.enableProcOnNPC(npcId);
        break;
      case 'kaleidoscope':
        // WhipTagEffect_Kaleidoscope.cs:9-15：OnTaggedHit → ParticleOrchestrator
        //  RequestParticleSpawn(clientOnly:false, RainbowRodHit, PositionInWorld=
        //  optionalProjectile.Center)。L5 批（2026-08-31）：Spawn_RainbowRodHit
        //  收编真值本体（fx/orchestraFx.rainbowRodHitFx,六掷虹彩簇+12×d267）+
        //  module8 上行——此前彩虹径向占位 burst 退役。
        rainbowRodHitFx(game, ctx.hx, ctx.hy);
        game.broadcastParticleOrchestra?.(ParticleOrchestraType.RainbowRodHit,
          ctx.hx, ctx.hy);
        break;
      default:
        break;
    }
    if (!this.canProcOnNPC(npcId)) return;
    let consumed = false;
    switch (d.kind) {
      case 'firecracker': {
        // OnProcHit :14-18 → CreateExplosion :20-24：原版 = NewProjectile(918)
        //  （friendly 96×96 居中盒、kb=0f、usesLocalNPCImmunity+cd=-1 每靶一次）→
        //  Damage_PVE 全 NPC 环结算（非直调 StrikeNPC）。★BJ449（2026-10-03 proc AoE
        //  城镇面定谳）两刀：①源敌永免——:23 `localNPCImmunity[npcHit.whoAmI]=-1`,
        //  被 proc 命中敌不吃本爆炸（曾漏=源敌双吃 主伤×2.75+爆伤×2.75）;
        //  ②城镇靶面 = Damage_PVE_Inner :12618-12631 巫毒窄门（22+killGuide/54+
        //  killClothier;918≠318 例外不达）→ 走 hitTownNpcs('playerProj') 单源同门;
        //  kb=0f（:22 第 5 参）→ settle 压 0（敌怪侧 ×2/-2 冲量与盒锚 hx/hy≈
        //  npcHit.Center 的差异=「AoE 直结」登记偏差面,本刀不动）。
        consumed = true;
        const boom = Math.max(1, Math.trunc(calcDamage * 2.75));
        const g = game;
        {
          for (const ent of g.enemies()) {
            const en2 = ent as unknown as {
              id: number; dead: boolean; cx: number; cy: number; w: number; h: number;
              hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
            };
            if (en2.dead || en2.id === ctx.hurtNpcId) continue;   // ★BJ449① :23 源敌 -1 永免
            if (!playerCanHitEnemy(ent, g, 918)) continue;
            if (Math.abs(en2.cx - ctx.hx) > 48 + en2.w / 2 || Math.abs(en2.cy - ctx.hy) > 48 + en2.h / 2) continue;
            en2.hurt(applyBannerDamageDealt(g, en2, boom), Math.sign(en2.cx - ctx.hx) * 2, -2, g, 0, false, 0, true);   // fromPlayer=DPS 计
          }
          // ★BJ449②：城镇巫毒窄门面（918 全 NPC 环的 friendly 靶支;盒=96×96 心=命中锚）
          hitTownNpcs({ x: ctx.hx - 48, y: ctx.hy - 48, w: 96, h: 96 }, g, boom, 0,
            'playerProj', 918, undefined, undefined, undefined, undefined, () => ({ kb: 0 }));
          // ★BJ643②：918 出生爆花演出面（AI_178_FireExplosion :46098-46148
          //  localAI[0]==0 支 1:1——伤害面上方零改动;旧 '#FF7A28' 粒子占位退役）
          this.firecracker918Burst(g, ctx.hx, ctx.hy);
        }
        break;
      }
      case 'starcrash': {
        // WhipTagEffect_Starcrash :8-13 → SpawnMeteorWhipMeteorOn :15-31：
        // 目标上方 280px 落陨石 1037,伤 = calcDamage×1.33,速 8
        consumed = true;
        ctx.add(new Arrow(ctx.hx - 6, ctx.hy - 280, 0.4, 8,
          Math.max(1, Math.trunc(calcDamage * 1.33)), 2, 1037, { grav: 0 }));
        break;
      }
      case 'flower': {
        // WhipTagEffect_ViolentDisplayOfFlower（1457 :12-33,ItemID.cs:1375-1379 表条目
        //  TagDamage=9 是 tag 伤）：OnProcHit → SpawnFlowerExplosionOn（:12-16）——
        //  瓣数 = 3+Next(0,4)（:21-22 num3=3/num4=3 → 3-6 瓣）、瓣伤 =
        //  ceil((int)((calc+bonusTagDamage)×2.25)/瓣数)（:17 num 合成 + :23 均分）、
        //  均布角速 = max(w,h)/8（:26-27 RotatedByRandom(0.3927) 抖动）、ai[0] =
        //  NextFloat×-20（:28）、出生点 = 目标 Center（:28）+ 预置
        //  localNPCImmunity[target]=30（:29——花瓣自目标体内出生,30t 内不得命中
        //  目标本体,经 Arrow localImmuneSeed 通道）
        consumed = true;
        const base = Math.random() * Math.PI * 2;                                  // :18 num2
        const enwh = ctx.hurtEnemyWH;
        const spd = Math.max(1, Math.max(enwh.w, enwh.h) / 8);                     // :26-27 num7
        const count = 3 + Math.floor(Math.random() * 4);                           // :21-22 num3 += Next(0,4)
        const petalDmg = Math.max(1, Math.ceil(Math.trunc((calcDamage + ctx.bonusTagDamage) * 2.25) / count)); // :17/:23
        const sx = ctx.hurtEnemyXY.x + enwh.w / 2, sy = ctx.hurtEnemyXY.y + enwh.h / 2; // :28 targetNPC.Center
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + base + (Math.random() * 2 - 1) * 0.39269909262657166;
          ctx.add(new Arrow(sx, sy, Math.cos(a) * spd, Math.sin(a) * spd, petalDmg, 0, 1038, { grav: 0, life: 120, pierce: 1,
              localImmuneSeed: { npcId: ctx.hurtNpcId, t: 30 } }));                // :29 = 30t
        }
        break;
      }
      case 'possession': {
        // WhipTagEffect_Possession.OnProcHit（1457 WhipTagEffect_Possession.cs:5-9）：
        // SpawnMoonLordWhipProc(proj, npc, 20, 0)（Projectile.cs:14977-15011——循环
        //  上限 num = Next(1,4) 后被 `num = 1` 覆写 = 单发,Next(1,4) 为死掷）——
        //  单发 1045 固定伤 20,弧线出生点+旋转弹道;命中链式补发（:14015-14018
        //  ai[1]<2 → 代数+1,全程 ≤3）
        consumed = true;
        MoonLordWhipProc.spawn(game, ctx.add,
          { x: ctx.hurtEnemyXY.x, y: ctx.hurtEnemyXY.y, w: ctx.hurtEnemyWH.w, h: ctx.hurtEnemyWH.h },
          ctx.hurtEnemyVel, 0);
        break;
      }
      case 'constellation':
        // WhipTagEffect_Constellation.OnProcHit :12-19：return optionalProjectile.type == 1034
        //  ——仅鞭本体 1034 消费（撒星在 WhipProj 命中侧）;随从命中开窗不消费
        consumed = ctx.projId === 1034;
        break;
      case 'eel':
      case 'swordwhip':
        // OnProcHit 恒 true（_ElectricEel.cs:16-19 / _SwordWhip.cs:21-24）——
        // 直伤部分已在 ModifyProcHit 记账,此处仅消费 proc 窗口
        consumed = true;
        break;
      default:
        break; // 基类/kaleidoscope/darkharvest：OnProcHit 默认 false 不消耗
    }
    if (consumed) this.clearProcOnNPC(npcId);   // :113-118 消费语义反转
  }
}

/** 月主鞭 proc 弹 1045（MoonLordWhipProc,AI_152）：
 *  SetDefaults（1457 Projectile.cs:9892-9910）：20×20、friendly、
 *  tileCollide=false、melee、penetrate=1（首敌即逝）、localNPCHitCooldown=-1、
 *  extraUpdates=1（每 tick 2 update）→ timeLeft=24×2=48 update、armorPenetration=50、
 *  scale 1+rand(30)×0.01。
 *  AI_152：alpha 每 update -50 淡入、velocity 每 update 旋转
 *  ai[0]/(24×MaxUpdates)=ai[0]/48（num4=24 为 1045 专属）再 ×0.96、首帧 Item1 音。
 *  命中（:14015-14018 case 1045）：ai[1]<2 → SpawnMoonLordWhipProc(self, npc,
 *  damage=20, ai[1]+1) 链式补发,全程 ≤3 发。
 *  1045 ∉ MinionShot/SentryShot（1457 ProjectileID.cs:291/:293）→ CanRunHitEffects=false
 *  （WhipTagEffect.cs:76-87）不吃鞭 tag——纯直伤通道。
 *  出生点/弹道 = SpawnMoonLordWhipProc（:14977-15011）1:1：命中盒 Inflate(30,16)
 *  再 Y-8 内随机点、朝盒心速 7-15、弧度 ai[0]=±(π/5+4π/5×rand)×0.5、初旋 π/4、
 *  从盒心沿弧倒推 24 步得出生点、敌速 ×16 前置;循环上限 num = Next(1,4) 后被
 *  `num = 1` 覆写（:14980-14981,死掷）= 每次调用恒单发。 */
export class MoonLordWhipProc extends Entity {
  w = 20; h = 20;
  /** 固定伤 20（procDamage 形参,链式各代同值 :14017/:15010） */
  readonly damage = 20;
  /** ai[0]：每 update 旋转量（弧度,测试断言用） */
  readonly arc: number;
  /** ai[1]：代数（0=proc 首发链,1/2=补发链;≥2 不再补 :14016） */
  readonly gen: number;
  private ticks = 0;
  private readonly hitSet = new Set<number>();

  private constructor(x: number, y: number, vx: number, vy: number, arc: number, gen: number) {
    super();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.vx = vx; this.vy = vy;
    this.arc = arc; this.gen = gen;
  }

  /** SpawnMoonLordWhipProc（1457 :14977-15011）1:1。rect = 敌 Hitbox（盒 Inflate(30,16)+Y-8
   *  在此内做 :14985-14987）,vel = 敌速度（×16 前置 :15008）,gen = ai[1] 代数 */
  static spawn(game: GameHooks, add: (e: unknown, b?: string) => void,
    rect: { x: number; y: number; w: number; h: number }, vel: { x: number; y: number },
    gen: number): void {
    const bx = rect.x - 30, by = rect.y - 24, bw = rect.w + 60, bh = rect.h + 32; // :14985-14987
    const sx = bx + Math.random() * bw, sy = by + Math.random() * bh;             // :14988 盒内随机点
    const cx = bx + bw / 2, cy = by + bh / 2;                                     // :14989 盒心
    let dx = cx - sx, dy = cy - sy;
    const dl = Math.hypot(dx, dy);
    if (dl > 0) { dx /= dl; dy /= dl; } else { dx = 0; dy = -1; }                 // SafeNormalize 回退 -UnitY
    const spd = 7 + Math.random() * 8;                                            // :14990
    // :14993-14995 弧度 = ±(π/5 + 4π/5×rand) × 0.5
    const arc = (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 5 + Math.PI * 4 / 5 * Math.random()) * 0.5;
    // :14997 初旋 π/4 → :15001-15007 从盒心沿弧倒推 24 步
    const a0 = Math.PI / 4;
    let vx = (dx * Math.cos(a0) - dy * Math.sin(a0)) * spd;
    let vy = (dx * Math.sin(a0) + dy * Math.cos(a0)) * spd;
    let px = cx, py = cy;
    for (let j = 0; j < 24; j++) {
      px -= vx; py -= vy;
      const da = -arc / 24;
      const tvx = vx * Math.cos(da) - vy * Math.sin(da);
      vy = vx * Math.sin(da) + vy * Math.cos(da);
      vx = tvx;
    }
    px += vel.x * 16; py += vel.y * 16;                                           // :15008
    add(new MoonLordWhipProc(px, py, vx, vy, arc, gen));
    void game;
  }

  fixedUpdate(_dt: number, game: GameHooks): void {
    if (this.dead) return;
    // 每 tick 2 update（extraUpdates=1 :9908）：旋转 ai[0]/48（:22486-22490 num4=24）+ ×0.96（:22505）
    for (let u = 0; u < 2; u++) {
      const da = this.arc / 48;
      const c = Math.cos(da), s = Math.sin(da);
      const tvx = this.vx * c - this.vy * s;
      this.vy = this.vx * s + this.vy * c;
      this.vx = tvx;
      this.vx *= 0.96; this.vy *= 0.96;
      this.x += this.vx; this.y += this.vy;
    }
    if (++this.ticks >= 24) { this.dead = true; return; } // timeLeft=24×MaxUpdates=48 update :9909
    // 命中（penetrate=1 首敌即逝 :9903;armorPenetration=50 :9910;kb=0 :15010）
    for (const ent of game.enemies()) {
      if (!playerCanHitEnemy(ent, game, 1045)) continue;
      const en = ent as unknown as {
        id: number; dead: boolean; x: number; y: number; w: number; h: number; vx?: number; vy?: number;
        hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean, pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
      };
      if (en.dead || this.hitSet.has(en.id)) continue;
      if (this.x >= en.x + en.w || this.x + this.w <= en.x
        || this.y >= en.y + en.h || this.y + this.h <= en.y) continue;
      en.hurt(applyBannerDamageDealt(game, en, this.damage), 0, 0, game, 50, false, 0, true);   // fromPlayer=DPS 计
      // 链式补发（:14015-14018：ai[1]<2 → SpawnMoonLordWhipProc(damage, ai[1]+1)）
      if (this.gen < 2) {
        MoonLordWhipProc.spawn(game,
          (el) => (game as unknown as { entities: { add: (x: unknown, b?: string) => void } }).entities.add(el, 'projectiles'),
          { x: en.x, y: en.y, w: en.w, h: en.h }, { x: en.vx ?? 0, y: en.vy ?? 0 }, this.gen + 1);
      }
      this.dead = true;
      return;
    }
    // ★BJ729-A（D1 B27a,2026-10-27）：城镇 voodoo 靶——1045 friendly 鞭 proc 巫毒
    //  窄门（:12618-12631,22 killGuide/54 killClothier）;AABB 自盒;settle 镜像敌怪
    //  臂链（kb=0/armorPenetration=50 :9910/DV=面级既有形态[D6 族登记]）;collide 位
    //  窄门谓词=受害体捕获（链式补发 :14015-14018 victim 无关,城镇靶同发）;
    //  penetrate=1 受理即亡。★darkHarvestChain 链电城镇臂销案：原版
    //  FindTargetWithinRange :45925 走 CanBeChasedBy（NPC.cs:91141 `!friendly` 硬门）
    //  =城镇 NPC 永不入链,仓内 canBeChasedBy 同门 1:1（census B27 链电半句误登）。
    let townVictim1045: { x: number; y: number; w: number; h: number; vx?: number; vy?: number } | null = null;
    if (hitTownNpcs(this, game, this.damage, 0, 'playerProj', 1045,
      (tn) => {
        const t2 = tn as unknown as { vanillaId?: number; vx?: number; vy?: number };
        if (!townVoodooGateOpen(game, t2.vanillaId, 1045)) return false;
        if (!(this.x < tn.x + tn.w && this.x + this.w > tn.x
          && this.y < tn.y + tn.h && this.y + this.h > tn.y)) return false;
        townVictim1045 = { x: tn.x, y: tn.y, w: tn.w, h: tn.h, vx: t2.vx, vy: t2.vy };
        return true;
      }, undefined, undefined, undefined,
      () => ({ penPercent: 50 }))) {
      const tv1045 = townVictim1045 as { x: number; y: number; w: number; h: number; vx?: number; vy?: number } | null;
      if (this.gen < 2 && tv1045) {
        MoonLordWhipProc.spawn(game,
          (el) => (game as unknown as { entities: { add: (x: unknown, b?: string) => void } }).entities.add(el, 'projectiles'),
          tv1045, { x: tv1045.vx ?? 0, y: tv1045.vy ?? 0 }, this.gen + 1);
      }
      this.dead = true;
      return;
    }
  }

  draw(r: import('../render/Renderer').Renderer): void {
    const ctx = r.ctx;
    if (!ctx) return;
    const img = projFrameImg(1045, 0);
    ctx.save();
    ctx.globalAlpha = Math.min(1, ((this.ticks * 2 + 1) * 50) / 255); // alpha 每 update -50 → 0（:22439-22447）
    ctx.translate(this.cx, this.cy);
    ctx.rotate(Math.atan2(this.vy, this.vx));
    ctx.imageSmoothingEnabled = false;
    if (img) ctx.drawImage(img, -img.width / 2, -img.height / 2);
    else {
      ctx.fillStyle = '#C8B0FF';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** 每玩家鞭 tag 栈（TagEffectStack.cs:1-139 1:1） */
export class TagEffectStack {
  /** MaxEffects = 5（:8） */
  static readonly MAX_EFFECTS = 5;
  private states: (TagEffectState | null)[] = [null, null, null, null, null];
  private count = 0;

  constructor(private owner: Player) {}

  get activeCount(): number { return this.count; }

  /** 活跃 tag 型列表（MRU 序,调试/测试用） */
  activeTypes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.states[i]!.type);
    return out;
  }

  private indexOf(tagType: number): number {                       // :18-27
    for (let i = 0; i < this.count; i++) if (this.states[i]!.type === tagType) return i;
    return -1;
  }

  /** LimitActiveEffects（:29-36）：超限从栈尾淘汰（最久未用先驱逐）→ Deactivate */
  private limitActiveEffects(limit: number): void {
    limit = Math.min(limit, TagEffectStack.MAX_EFFECTS);
    while (this.count > limit) this.states[--this.count]!.deactivate();
  }

  /** TrySetActiveEffect（:42-58）：不存在 → 先 Limit(maxTagEffects-1) 腾位再激活;
   *  已存在仅提到栈顶（MRU swap 环） */
  private trySetActiveEffect(tagType: number): void {
    let i = this.indexOf(tagType);
    if (i < 0) {
      this.limitActiveEffects(this.owner.maxTagEffects - 1);
      i = this.count;
      const st = this.states[i] ?? new TagEffectState(this.owner);
      this.states[i] = st;
      this.count++;
      st.activate(tagType);
    }
    while (i > 0) {
      const tmp = this.states[i]!;
      this.states[i] = this.states[i - 1]!;
      this.states[i - 1] = tmp;
      i--;
    }
  }

  isNPCTagged(tagType: number, npcId: number): boolean {           // :60-67
    const i = this.indexOf(tagType);
    return i >= 0 && this.states[i]!.isNPCTagged(npcId);
  }

  // ★BJ514（2026-10-05）：anyTagged（任一活跃 tag 查询）已退役——原版 TagEffectStack
  //  无此聚合查询,且随从索敌不吃 tag（1457 无「tag 扫描式」索敌;鞭→随从优先完全走
  //  单槽 MinionAttackTargetNPC,Projectile.cs:14321-14323 写槽 + 各 AI 第一桶消费）。
  //  旧 MinionProj.nearestEnemy 的 anyTagged 扫描桶系先前批 eager 面,已同刀摘除。

  canProcOnNPC(tagType: number, npcId: number): boolean {          // :69-76
    const i = this.indexOf(tagType);
    return i >= 0 && this.states[i]!.canProcOnNPC(npcId);
  }

  /** TryApplyTagToNPC（:80-87）：CanApplyTagToNPC（ImmuneToWhips 门）+ 激活 +
   *  对栈顶 [0] 打 tag。bonusTagDamage = 鞭词缀 tagdmg（本仓登记偏差,见 state 注） */
  tryApplyTagToNPC(tagType: number, npcId: number, npcVanillaId = 0, bonusTagDamage = 0): void {
    if (TAG_EFFECTS[tagType] === undefined) return;
    if (npcVanillaId > 0 && TAG_IMMUNE_TO_WHIPS.has(npcVanillaId)) return; // CanApplyTagToNPC
    this.trySetActiveEffect(tagType);
    this.states[0]!.applyTagToNPC(npcId, bonusTagDamage);
  }

  /** 栈上已标记该敌的各 tag 态携带的最大鞭词缀 tagdmg（管线 bonusTagDamage 单次
   *  合成 :12954——本仓把命中弹自带值与此取 max） */
  maxTagBonus(npcId: number): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.states[i]!;
      if (s.isNPCTagged(npcId) && s.appliedBonus > m) m = s.appliedBonus;
    }
    return m;
  }

  tryEnableProcOnNPC(tagType: number, npcId: number): void {       // :89-95
    const i = this.indexOf(tagType);
    if (i >= 0) this.states[i]!.enableProcOnNPC(npcId);
  }

  removeAllProcs(tagType: number): void {                          // :77-82
    const i = this.indexOf(tagType);
    if (i >= 0) this.states[i]!.removeAllProcs();
  }

  resetNPCSlotData(npcId: number): void {                          // :124-128
    for (let i = 0; i < this.count; i++) this.states[i]!.resetNPCSlotData(npcId);
  }

  /** ModifyHit（:107-121）：遍历栈上全部活跃 tag 依次记账——多 tag 全值叠加的基础 */
  modifyHit(ctx: WhipHitCtx, changes: TagDamageChanges, game: GameHooks): void {
    for (let i = 0; i < this.count; i++) this.states[i]!.modifyHit(ctx, changes, game);
  }

  /** OnHit（:107-121）：同遍历;proc 消费由各 effect 返回值决定 */
  onHit(ctx: WhipHitCtx, calcDamage: number, game: GameHooks): void {
    for (let i = 0; i < this.count; i++) this.states[i]!.onHit(ctx, calcDamage, game);
  }

  /** Update（:131-138）：每帧 Limit(maxTagEffects) + 各 state 双表递减 */
  update(): void {
    this.limitActiveEffects(this.owner.maxTagEffects);
    for (let i = 0; i < this.count; i++) this.states[i]!.update();
  }
}

/** 黑收成 916 黑闪电链（★W5,2026-10-02 定谳折算面）。
 *  原版全链（Terarria1457 亲读）：WhipTagEffect_DarkHarvest.SpawnBlackLightning
 *  （:14-20）= NewProjectile(916, dmg=TagDamage×SummonTagDamageMultiplier[触发弹],
 *  kb=0f) @ npcHit.Center + 【:18 localNPCImmunity[npcHit]=-1 源敌永免】→ 弹体
 *  AI_176_EdgyLightning（Projectile.cs:45878-45916）逐跳追击：
 *  · 索敌 = FindTargetWithinRange(400)（:45918-45936）：NPC.CanBeChasedBy +
 *    localNPCImmunity[i]==0（源敌/已跳敌永免）,最近者胜、同距先到先得（:45928
 *    `!(num <= num2)` 严格小于）;无目标即 Kill（:45914）。
 *  · 命中 = Damage_PVE 受理门（:11892 friendly 门 / :12600 dontTakeDamage /
 *    :12636 immune[owner] 全局窗）→ StrikeNPC → 写梯 immuneArray[victim]=-1
 *    （localNPCHitCooldown=-1 :8685 = 同敌至多一跳,减表 :17380 只递减 >0）+
 *    immune[owner]=0（:14177 usesLocal 主支清窗）→ penetrate 3（:8684）耗尽即亡
 *    = 至多 3 跳。
 *  · 单跳伤面：伤值 d（出膛已含 SummonTagDamageMultiplier,:16）→ DamageVar luck
 *    掷（:12970,仓内直伤通道平价免掷=登记,eel/火鞭同式）;crit 恒 false（916 无
 *    类旗,P.cs:12870-12928 类三连掷不达）;kb=0（:17 第 5 参 0f）;
 *    armorPenetration=50（:8686）;banner 乘区照跑（:13388-90）。
 *  · 916 非 minion/MinionShot/SentryShot → CanRunHitEffects=false
 *    （WhipTagEffect.cs:76-87）→ 自身不吃 tag 不递归。
 *  仓内模型=瞬时三跳链（原版 10 速弹体飞行相位差=登记债,视觉面已在
 *  blackLightningHitFx 命中拍粒子覆 EmitBlackLightningParticles）;链靶窗口门取
 *  【跳时窗态】（seek 即筛 iframes>0——原版弹体会悬停候窗,瞬时模型跳过=登记偏差）。
 *  受理方（MinionProj contact()/contactTown/拳盒城镇臂/闪电光环场城镇臂/扑击弹
 *  818 双臂、Arrow whipTagShot 区）在主命中受理+写梯后调本函数落地（:13711 位次）。 */
export function darkHarvestChain(
  game: GameHooks, d: number, sx: number, sy: number, sourceId: number,
): void {
  const immune = new Set<number>([sourceId]);            // :18 源敌永免
  let hx = sx, hy = sy;
  for (let hop = 0; hop < 3; hop++) {                    // penetrate=3（:8684）
    let best: {
      id: number; cx: number; cy: number; iframes?: number;
      hurt?: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
        pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
    } | null = null;
    let bestD = 400;                                     // FindTargetWithinRange(400f)
    for (const ent of game.enemies()) {
      const en2 = ent as unknown as {
        id: number; dead: boolean; cx: number; cy: number; x?: number; y?: number;
        w?: number; h?: number; iframes?: number; maxHp?: number; vanillaId?: number | null;
        def?: { friendly?: boolean; hp?: number }; dontTakeDamage?: boolean;
        hurt?: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
          pierce?: number, fromPlayer?: boolean, penPercent?: number) => boolean;
      };
      if (en2.dead || immune.has(en2.id)) continue;      // :45925 localNPCImmunity==0
      if (!canBeChasedBy(ent)) continue;                 // :45925 CanBeChasedBy（索敌门）
      if ((en2.iframes ?? 0) > 0) continue;              // :12636 immune[owner] 窗（瞬时模型跳时筛）
      if (!playerCanHitEnemy(ent, game, 916)) continue;  // :11892 friendly 门（命中面）
      const dist = Math.hypot(en2.cx - hx, en2.cy - hy);
      if (dist < bestD) { bestD = dist; best = en2; }    // 最近者胜,同距先到（:45928 严格小于）
    }
    if (!best || !best.hurt) return;                     // :45914 Kill()
    immune.add(best.id);                                 // :14179 immuneArray[victim]=-1 同敌一跳
    best.hurt(applyBannerDamageDealt(game, best, d), 0, 0, game, 50, false, -3, true);   // kb=0/ap50/pierce=-3=usesLocal 主支清窗（:14177）;fromPlayer=DPS 计
    hx = best.cx; hy = best.cy;                          // 逐跳自命中位重寻（:45899-45903）
  }
}

/**
 * 随从/哨兵命中侧统一结算鞭 tag + proc（TagEffectStack.ModifyHit/OnHit +
 * Projectile 伤害管线 :12946-12962;调用方须满足 WhipTagEffect.CanRunHitEffects
 * :76-87——随从本体 / MinionShot（MINION_SHOT_SET）/ 哨兵 / SentryShot）。
 * 管线（:12947-12962）：num15 = base;
 *   changes 聚合 → num15 += (int)((Σtag + bonusTagDamage) × SummonTagDamageMultiplier)
 *   → += AddedFlatDamage → num15 = (int)(num15 × TotalDamageMultiplier)
 *   → changes.Crit 有值即强制 crit;★S02(BJ723-B):暴击 ×2 全链不在此——在
 *   StrikeNPC_Inner 防后(NPC.cs:82067,Enemy.hurt/TownNPC.hurt 承载)。
 * OnHit 阶段（:13711 → TagEffectState.OnHit）：黑收成 916 / 星鞭 proc 启用 /
 * proc 首跳（火鞭 918 爆炸 ×2.75 / 星陨 1037 ×1.33 / 花瓣 1038 / 月主 1045 三连 /
 * 剑鞭 +30 / 电鳗链电）——伤害基数 = calcDamage（原版传 num7 = tag 前基础伤）。
 * 返回最终伤害（未含暴击 ×2——★S02 后由受击 hurt 防后统一翻倍）与是否暴击。
 * 兼容签名：前 7 参与旧版一致（Arrow.ts whipTagShot 路径未迁移仍走此形态,
 * owner 缺省 game.player——单机语义;MP 远端随从按本端玩家栈近似,与旧版一致）。
 */
export function resolveWhipTagHit(
  en: WhipTagged & { w?: number; h?: number; x?: number; y?: number;
    vx?: number; vy?: number; realLife?: number | null },
  baseDmg: number,
  game: GameHooks,
  add: (e: unknown) => void,
  tagMul = 1,
  hx = 0,
  hy = 0,
  owner?: Player | null,
  bonusTagDamage = 0,
  projId = 0,
): { dmg: number; crit: boolean } {
  const stack = (owner ?? (game as unknown as { player?: Player | null }).player)?.tagEffectStack;
  if (!stack || stack.activeCount === 0) return { dmg: Math.max(1, Math.round(baseDmg)), crit: false };
  const ctx: WhipHitCtx = {
    projId,
    bonusTagDamage,
    hx, hy,
    hurtFx: en.hurtFx,
    add: add as (e: unknown, b?: string) => void,
    hurtNpcId: en.id,
    realLife: en.realLife ?? -1,
    hurtEnemyWH: { w: en.w ?? 16, h: en.h ?? 16 },
    hurtEnemyXY: { x: en.x ?? hx - (en.w ?? 16) / 2, y: en.y ?? hy - (en.h ?? 16) / 2 },
    hurtEnemyVel: { x: en.vx ?? 0, y: en.vy ?? 0 },
  };
  const changes = tagDamageChangesNone();
  stack.modifyHit(ctx, changes, game);                             // :12947
  let dmg = baseDmg;
  let crit = false;
  if (changes.addProjectileTagDamage) {                            // :12949-12961
    const highest = changes.highestAddedBaseDamage;
    const rest = changes.addedBaseDamage - highest;
    const tagSum = highest + rest;                                 // num17 恒 1（:12952）
    const bonus = Math.max(ctx.bonusTagDamage, stack.maxTagBonus(en.id)); // 词缀 tagdmg 单次合成（本仓挂 tag 态,见 state 注）
    dmg += Math.trunc((tagSum + bonus) * tagMul);                  // SummonTagDamageMultiplier 只乘一次
    dmg += changes.addedFlatDamage;
    dmg = Math.trunc(dmg * changes.totalDamageMultiplier);
    if (changes.crit !== null) crit = changes.crit;
  }
  stack.onHit(ctx, baseDmg, game);                                 // :13711（calcDamage = num7）
  // 毁灭臂镗 6179（Damage :13447-13450）：tag 伤害成立的命中 → kind2 脉冲
  //（150×minionDamage/400px/2 目标,共用 360t 冷却）。★F1（蓝队四轮）：原版 num14
  // 加伤在 tag 栈(:12947)/DamageVar(:12970)/banner(:13388-13390)【之后】并入 → 不吃
  // tag/banner 乘区、随暴击翻倍（StrikeNPC 防后 ×2 :82067）——返回值移到 crit 倍率处并入
  let snapBonusKind2 = 0;
  if (changes.addProjectileTagDamage && owner?.equipStats.accArmletOfRuin) {
    const vw = en.w ?? 16, vh = en.h ?? 16, vx0 = en.x ?? hx, vy0 = en.y ?? hy;
    snapBonusKind2 = trySnapStrike(game, owner, 2, hx, hy, en.id,
      { victimBox: { w: vw, h: vh, cx: vx0 + vw / 2, cy: vy0 + vh / 2 } });   // R4-33 victim 自脉冲
  }
  // ★S02（BJ723-B 2026-10-26）：tag-crit 预倍 ×2 摘除——原版 crit 翻倍在
  // StrikeNPC_Inner 防后（NPC.cs:82067,Enemy.hurt 承载），Damage 管线内（含
  // tag 并入位 :12946-12962/DamageVar :12970）一律不翻倍。消费者改传 res.dmg
  // 原值+crit 参（敌怪面 Enemy.hurt 防后 ×2；城镇面 TownNPC.hurt 同式——旧
  // 「res.crit 摘半还原」档随之退役）。snapBonusKind2 同摘 crit 倍（原版
  // num14 加伤随 dmg 整体进 StrikeNPC 吃防后 ×2）。DV 掷基数复位未翻倍值
  // =BJ716-A 登记债①（tag-crit 拍 DV 掷已翻倍基数）就此清偿。
  if (snapBonusKind2 > 0) dmg += snapBonusKind2;
  return { dmg: Math.max(1, Math.round(dmg)), crit };
}

/** hue(0..1) → css 颜色（万花筒彩虹粒子占位用;满饱和半亮度同 Main.hslToRgb(h,1,0.5)） */
function whipHslCss(h: number): string {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * Math.min(1, Math.max(0, Math.min(k - 3, 9 - k, 1)) * 0.5 + 0.5 * (1 - Math.abs(2 * 0.5 - 1)))) ;
  };
  // 简式：l=0.5、s=1 → rgb = hue2rgb 标准式
  const q = h < 1 / 3 ? h * 6 : h < 0.5 ? 1 : h < 2 / 3 ? 4 - h * 6 : 0;
  const seg = (off: number): number => {
    let t = off + 1 / 3;
    if (t > 1) t -= 1;
    if (t < 0) t += 1;
    if (6 * t < 1) return q;
    if (2 * t < 1) return 1;
    if (3 * t < 2) return 4 - 6 * t;
    return 0;
  };
  void f;
  return `rgb(${Math.round(seg(0) * 255)},${Math.round(seg(-1 / 3) * 255)},${Math.round(seg(1 / 3) * 255)})`;
}
