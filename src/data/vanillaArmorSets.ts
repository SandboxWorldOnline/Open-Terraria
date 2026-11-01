// 盔甲套装加成——★套装判定唯一事实源（BJ147 组D 四路径统一单表,2026-09-17）。
// 原版真值 = Terraria.DataStructures/ArmorSetBonuses.cs（Initialize :392-484 = 64 套
// 170 三元组;TryCounting :189-199 非零位计数 → legs=0=「腿位不计」;GetCompleteSet
// :512-531 首命中——本仓单键 flat 模型等价性由 recon-armorset-1457 闸门键集互斥证）。
// 对账闸门：node tools/recon-armorset-1457.mjs（DRIFT 必须=0;--fix 重放 vid 标记块）
// 金标：tests/armorset-recon-golden.test.ts + 行为零变更指纹 tests/armorset-path-unify-parity.test.ts。
// 两条键 lane：
//   · ARMOR_SET_BONUSES 槽序键 `${hs}|${bs}|${ls}`（`*` = 腿位不计,原版 legs=0
//     语义——空腿也亮;85 既有键 + 召唤并键 16 + 组A/B 表批 59 = 160）——
//     sb（setBonus 文本/数值）通道 + summonSet 通道（召唤字段族
//     条目;summonSetOnly 标记 = 只走召唤通道）；
//   · ARMOR_SET_BONUSES_VID vid 键 `${h|b|l 物品 id}`（原版 QueryContext 语义）——
//     原 Player.ts 内联 vid 三元组硬编 6 套 + getter 2 套的收编承载。
// 每条 = 原版同 if 块内的纯数值/旗标效果；行为型（召唤骷髅/幽灵治疗等）标注 engine。
// ★组A/B 表批（2026-09-18）：Wizard 七袍(legs=0 空腿语义)/Shadow 混搭 6/UNPORTED 9 套
// （Wood/Pumpkin/Snow/Mining/MagicHat）/组B 九套（钴·秘银·精金三族）+ CrystalAssassin
// dashType=5 落表——单件面缺口与消费链接线见 vanilla-accfx.json/Player.ts 同批注。
// 余下未移植：Forbidden（BJ157 并行 lane）。
export interface ArmorSetBonus {
  def?: number;              // statDefense +=
  mana?: number;             // statManaMax2 +=
  move?: number;             // moveSpeed +=
  meleeSpd?: number;         // meleeSpeed +=
  dmgMelee?: number;
  dmgRanged?: number;
  dmgMagic?: number;
  critMelee?: number;
  critRanged?: number;
  critMagic?: number;
  noKnockback?: boolean;
  /** lifeRegen += N（原版 :19383-19407 120 单位/tick 累计 1HP → N/2 HP/s;
   *  Player.ts DD2_PIECE_FX 环消费 → equipStats.hpPerSec） */
  lifeRegen?: number;
  /** manaCost -= X（【加算】折扣池——原版 Player.manaCost 单浮点逐项减,
   *  消费端 (1-manaCostOff)×manaCostMul;★BJ742-A R20-②：全树 manaCost 零乘区
   *  （ArmorSetBonuses.cs:278-281 Jungle -=0.16 与 223/钴秘银精金同池加算）——
   *  manaCostMul 乘区键自此无原版套装使用者（模组面通道保留）） */
  manaCostOff?: number;
  titaniumStorm?: boolean;   // 钛金全套 on-hit（ArmorSetBonuses.cs:222-225 Titanium→onHitTitaniumStorm）
  ashWood?: boolean;         // ★Notes④ 灰烬木全套（1456 Player.cs:15772-15775 赋位;
                             // 1457 消费位 :27885/:27904——remix 岩浆档 145+半减/OnFire−210/
                             // 与玫瑰并持完全免疫岩浆）
                             // 与玫瑰并持完全免疫岩浆）
  crystalLeaf?: boolean;     // 叶绿水晶叶套装（台账 L3 清偿批 2026-08-31,ArmorSetBonuses.cs
                             // :128-146 四头变体 AddBuff(60,5)+setChlorophyte）——引擎=
                             // entities/ChloroLeafCrystalProj.ts（锚体 226/叶弹 227+on-hit 引援）
  runAccMul?: number;      // runAcceleration *=（暗影套 1.75,:26195-26201）
  endurance?: number;
  dmgMinion?: number;   // minionDamage +=
  solar?: boolean;         // 日曜护盾 3 层引擎（每层该次受伤 ×0.2,:37699;每 3s 回 1,:16227）
  dashType?: number;       // 冲撞档（日曜 3,:16288-16294）
  maxRunMul?: number;      // maxRunSpeed *=（暗影套 1.15）
  runSlowMul?: number;     // runSlowdown *=（暗影套 1.75）
  fireWalk?: boolean;
  frostBurn?: boolean;     // 冰霜盔甲引擎（StatusNPC :93712:近/远程命中 → Frostburn2）
  ammoCost80?: boolean;
  ammoCost75?: boolean;      // 省弹 1/4（:205-209 AdamantiteRanged——消费端 ammoSaveCost75,
                             // 与星旋胸 2758 单件同档;组B 表批 2026-09-18）
  huntressAmmoCost90?: boolean;  // 省弹 1/10（:13278 case 3804 女猎手护甲——件门在
                                  // Player.ts ARMOR_AMMO_SAVE_VID 表承载，此键为表回填预留）
  /** Snow 套 buffImmune（:293-297 buffImmune[46]Chilled/[47]Frozen——消费端
   *  Player.ts immuneBuffs→buffs.immuneVanilla（apply 门 :1148 + 已挂清除 :1265）） */
  buffImmune?: number[];
  /** Mining 套 pickSpeed -= 0.1（:299-303——折扣池【加算】,消费端 Game.pickSpeedMult;
   *  单件面 410/411/5589/5590 同字段走 accfx json+armorStat 环,组A 表批 2026-09-18） */
  pickSpeed?: number;
  manaCostMul?: number;      // 【模组面保留】魔耗乘区——原版套装零使用者（BJ742-A R20-② Jungle 迁加算池后）
  onHitRegen?: boolean;      // 帕拉钯全套（ArmorSetBonuses.cs:217-220 Palladium→onHitRegen;
                             // Player.cs:6942-6945 AddBuff(58,300)——快速再生 58 RapidHealing）
  onHitPetal?: boolean;      // 山铜（奥利哈刚）全套（:215-221 Orichalcum→onHitPetal;
                             // Player.cs:6963-6985 OnHit 花瓣弹 221,petalTimer=20 共享窗）
  onHitDodge?: boolean;      // 神圣套/神圣召唤套（:228-236 Hallowed·HallowedSummoner→
  /** ★四百八十二刀:mod 套装面扩展——dmgAll/critAll(C# GenericDamageClass 全系
   *  同值) + modFlags(旗名集→Player.__swSetFlags 整集重设,main.js postUpdate 消费) */
  dmgAll?: number;
  critAll?: number;
  modFlags?: string[];
                             // onHitDodge;Player.cs:6937-6940 shadowDodgeTimer==0 门 →
                             // AddBuff(59,1800) 幻影闪避——Hurt 第四闪避支来源链）
  ghostHeal?: boolean;       // 幽灵治疗头（Spectre Hood :15850-15855，魔法命中吸血 engine）
  ghostHurt?: boolean;       // 幽灵伤害头（Spectre Mask :15856-15860，on-hit 浮魂弹 356——
                             // ★2026-08-31 对齐批⑥已接：entities/SpectreSoulProj.ts）
  forbidden?: boolean;       // ★组C 终盘（2026-09-18）禁戒全套（Benefits.Forbidden
                             // ArmorSetBonuses.cs:61-65——setForbidden 置位 + 每拍
                             // UpdateForbiddenSetLock + 光照(0.8,0.7,0.2);行为型 engine =
                             // Player.ts setForbidden 挂点 + entities/ForbiddenSignProj.ts）
  anglerSet?: boolean;       // 渔夫套装：生成环 spawnRate×1.3/maxSpawns×0.7（NPC.cs:627-630）
  // ---- BJ147 组D 收编字段族（原 Player.ts 内联 vid 三元组/getter 携带面——四路径
  //      统一单表后由 vid 键表承载,消费位equipStats 专用旗通道语义不变）----
  crimsonRegen?: boolean;    // 老猩红甲套（Benefits.Crimson :250-253 →再生三面）
  spaceGun?: boolean;        // 陨石套（:266-269 spaceGun——Space Gun/Zapinator 无限蓝）
  shroomiteSet?: boolean;    // 蘑菇矿套（:372-375 shroomiteStealth 潜行引擎）
  vortexSet?: boolean;       // 星旋套（:42-45 setVortex——隐身引擎）
  nebulaSet?: boolean;       // 星云套（:47-54 setNebula——气泡拾取引擎）
  beetleOff?: boolean;       // 甲虫进攻（:324-327 ApplySetBonus_BeetleDamage）
  beetleDef?: boolean;       // 甲虫防御（:319-322 ApplySetBonus_BeetleDefense）
  turtleThorns?: boolean;    // 海龟套（:159-164 turtleThorns——反伤 ×2 覆写 :39102）
  cactusThorns?: boolean;    // 仙人掌套（:154-157 cactusThorns——独立定值反伤 :31644）
  // ---- SUMMON_SET 并入字段族（原 vanillaSummonStats.SummonSetFx——召唤通道读取面,
  //      Player.ts summonSet 投影消费;T2/T3 旗消费 = MinionProj dd2SetFlags）----
  slot?: number;             // maxMinions += N
  sentry?: number;           // maxTurrets += N
  dmg?: number;              // minionDamage += X（加算乘区）
  whipRange?: number;        // whipRangeMultiplier += X
  whipSpd?: number;          // 鞭 useTime ×1/N（黑曜套 1/1.15,ApplyEquipFunctional :13107）
  guardian?: boolean;        // 星尘守护者（套装在身 → buff 187 + 常驻 proj 623）
  huntressT2?: boolean; huntressT3?: boolean;
  squireT2?: boolean; apprenticeT2?: boolean; monkT2?: boolean;
  squireT3?: boolean; apprenticeT3?: boolean; monkT3?: boolean;
  /** 召唤专属套标记：条目只走 summonSet 通道,setBonus 文本通道不亮。
   *  ★组A 裁决（2026-09-18）：【维持暗面】——原版亮（l10n ArmorSetBonus.* 67 键已备,
   *  Tiki/Spooky/DD2 等文本齐全）,但 recon-armorset-1457 §3 召唤键环硬约束
   *  summonSetOnly=true（未标=fail,闸门红）与文本亮面互斥;收编须先放宽该工具约束
   *  （工具冻结,登记债——解锁路径：工具 §3 isSummonOnly fail 行移除 → 本标记摘除 →
   *  指纹/金标重采样,三步一批）。 */
  summonSetOnly?: boolean;
  name?: string;             // ArmorSetBonus.*（调试/后续 UI 展示）
}

/** 头变体全组合展开（1458 Terraria.DataStructures/ArmorSetBonus.cs Builder.Set
 *  (int[] headOptions, int[] bodyOptions, int[] legsOptions) :81-107——选项数组笛卡尔
 *  积逐 Set(head,body,legs).Add() 落进 All 表；PartType 枚举仅 tooltip 文案语义
 *  （"由头部决定"），匹配面 = QueryCount(:164-186) 三件俱全 Complete ⇒ 本表键照样
 *  是 `${hs}|${bs}|${ls}` 精确三元组。GetCompleteSet(ArmorSetBonuses.cs:512-531)
 *  只回首个命中 ⇒ 单套装键模型等价。 */
function expandHeadVariants(name: string, heads: number[], body: number[], legs: number[],
  bonus: ArmorSetBonus): Record<string, ArmorSetBonus> {
  const out: Record<string, ArmorSetBonus> = {};
  for (const h of heads) {
    for (const b of body) {
      for (const l of legs) out[`${h}|${b}|${l}`] = { ...bonus, name };
    }
  }
  return out;
}

export const ARMOR_SET_BONUSES: Record<string, ArmorSetBonus> = {
  // 钛金 (1215|1216|1217 头 ×1218 胸 ×1219 腿,ArmorSetBonuses.cs:461-463)：
  // on-hit 钛金屏障（Player.cs:6927-6936 cooldown10+buff306 600t+碎片908≤7）
  // 灰烬木 5279|5280|5281 = 槽序 278|246|234（itemstats hs/bs/ls；1456 Player.cs
  // :15772-15775 `ArmorSetBonus.AshWood` → ashWoodBonus=true。1457 反编译树缺
  // UpdateArmorSetsOld 函数体,消费位 Player.cs:27885/:27904 原样保留——本表按
  // 1456 赋值语义+1457 消费字面重建,REMIX 世界可获取,见 vanillaItemVariants.ts:107）
  '278|246|234': { ashWood: true, name: 'AshWood' },
  '89|56|51': { titaniumStorm: true, name: 'Titanium' },    // Mask(headSlot 89)
  '90|56|51': { titaniumStorm: true, name: 'Titanium' },    // Helmet(90)
  '91|56|51': { titaniumStorm: true, name: 'Titanium' },    // Headgear(91)
  // （键=armorSlot 值:headSlot 89/90/91|bodySlot 56|legSlot 51——Item.cs case 1215-1219）
  // 金属一档（铜 1 / 远古铁 72(954) / 铁 2 / 锡 47(687)——木套 1.4.5 无加成）：防 +2
  //   ★键注勘误 2026-09-18：原注"铁(72|2)/铅 47"错位——72=AncientIronHelmet、
  //   47=TinHelmet（ItemID.cs 实名/idNames 逐 id 核对）
  '1|1|1': { def: 2, name: 'MetalTier1' },
  '72|2|2': { def: 2, name: 'MetalTier1' },
  '2|2|2': { def: 2, name: 'MetalTier1' },
  '47|28|27': { def: 2, name: 'MetalTier1' },
  // 金属二档（银 3(91) / 远古金 73(955) / 金 4(92) / 铅 48(690) / 钨 49(693)）：防 +3
  //   ★键注勘误 2026-09-18：原注"铜 3/银(73|4)/钨 48/金 49"错位——91=Silver、
  //   955=AncientGold、92=Gold、690=Lead、693=Tungsten（同上逐 id 核对）
  '3|3|3': { def: 3, name: 'MetalTier2' },
  '73|4|4': { def: 3, name: 'MetalTier2' },
  '4|4|4': { def: 3, name: 'MetalTier2' },
  '48|29|28': { def: 3, name: 'MetalTier2' },
  '49|30|29': { def: 3, name: 'MetalTier2' },
  // 铂金 50：防 +4
  '50|31|30': { def: 4, name: 'Platinum' },
  // 角斗士 180：击退免疫
  '180|182|122': { noKnockback: true, name: 'Gladiator' },
  // 忍者 22：移速 +20%
  '22|14|14': { move: 0.2, name: 'Ninja' },
  // 化石 188：弹药 20% 不耗
  '188|189|129': { ammoCost80: true, name: 'Fossil' },
  // 死灵 (75|7)：远程暴 +10
  '75|7|7': { critRanged: 10, name: 'Bone' },
  '7|7|7': { critRanged: 10, name: 'Bone' },
  // 巫师帽 14 + 七宝石袍（组A 表批 2026-09-18;1458 ArmorSetBonuses.Initialize
  //   :418-426 Wizard 8 三元组 Set(238,袍,0)——袍 1282 紫晶/1283 黄玉/1284 蓝玉/
  //   1285 翡翠/1286 红玉/1287 钻石/2279 吉普赛/4256 琥珀）：
  //   legs=0 =「腿位不计」（ArmorSetBonus.cs TryCounting :189-199 needed=0 不计数,
  //   空腿/任意腿均亮）→ `*` 键;消费端 activeArmorSetMatch 空腿回退 `*`
  //   （本批对齐——原 `*` 需腿件在场=BJ149 登记债清偿）。魔法暴 +10（:304-307）
  '14|58|*': { critMagic: 10, name: 'Wizard' },
  '14|59|*': { critMagic: 10, name: 'Wizard' },
  '14|60|*': { critMagic: 10, name: 'Wizard' },
  '14|61|*': { critMagic: 10, name: 'Wizard' },
  '14|62|*': { critMagic: 10, name: 'Wizard' },
  '14|63|*': { critMagic: 10, name: 'Wizard' },
  '14|167|*': { critMagic: 10, name: 'Wizard' },
  '14|213|*': { critMagic: 10, name: 'Wizard' },
  // 法师帽 2275(159) × 七宝石袍（1458 :427-435 MagicHat 同构笛卡尔——注意与 Wizard
  //   同袍族不同头,GetCompleteSet 按头集先扫无歧义）。statManaMax2 += 60（:309-312）
  '159|58|*': { mana: 60, name: 'MagicHat' },
  '159|59|*': { mana: 60, name: 'MagicHat' },
  '159|60|*': { mana: 60, name: 'MagicHat' },
  '159|61|*': { mana: 60, name: 'MagicHat' },
  '159|62|*': { mana: 60, name: 'MagicHat' },
  '159|63|*': { mana: 60, name: 'MagicHat' },
  '159|167|*': { mana: 60, name: 'MagicHat' },
  '159|213|*': { mana: 60, name: 'MagicHat' },
  // 暗影 (5|74)：shadowArmor 旗标（:15842）→ 移动四参数加成（:26195-26201,
  // 2026-08-13 接入移动模型:runAcc×1.75/maxRun×1.15/accRun×1.15/runSlow×1.75）
  // ★组A 表批（2026-09-18）：混搭 8 组合全配（1458 :468-470 ShadowScale
  //   Set(new int[2]{102,956}, new int[2]{101,957}, new int[2]{100,958}) 笛卡尔积;
  //   暗影 102/101/100、远古暗影 956/957/958）+ name 面补齐（l10n
  //   ArmorSetBonus.ShadowScale 已备,原版亮 tooltip 文本;原 2 键 name 缺=同批清偿）
  '5|5|5': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  '74|48|44': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  '5|5|44': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  '5|48|5': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  '5|48|44': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  '74|5|5': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  '74|5|44': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  '74|48|5': { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' },
  // ---- 组A UNPORTED 表批（2026-09-18;1458 :396-441 重放,金标随批重采样）----
  // 木七族（1458 :396-404 Wood 7 三元组——木/乌木/红木/珍珠木/暗影木/针叶木/棕榈木）：
  // statDefense++（:377-380）——1.4.5 木套防 +1
  '52|32|31': { def: 1, name: 'Wood' },
  '53|33|32': { def: 1, name: 'Wood' },
  '54|34|33': { def: 1, name: 'Wood' },
  '55|35|34': { def: 1, name: 'Wood' },
  '71|47|43': { def: 1, name: 'Wood' },
  '166|173|108': { def: 1, name: 'Wood' },
  '167|174|109': { def: 1, name: 'Wood' },
  // 南瓜 (1731/1732/1733=112|75|64,1458 :411 Add)：近/魔/远/召唤伤各 +10%（:349-358）
  '112|75|64': { dmgMelee: 0.1, dmgRanged: 0.1, dmgMagic: 0.1, dmgMinion: 0.1, name: 'Pumpkin' },
  // 雪原（爱斯基摩）双染色变体（1458 :440 Snow 笛卡尔 2×2×2——头 803/978、
  //   胸 804/979、腿 805/980）：buffImmune 46 冷冻/47 冰冻（:293-297）
  ...expandHeadVariants('Snow', [58, 77], [38, 50], [36, 46], { buffImmune: [46, 47] }),
  // 矿工三型头 × 双胸 × 双腿（1458 :441 Mining 笛卡尔 3×2×2——头 88 挖矿头盔(11)/
  //   5588 勘探者头盔(285)/4008 超亮头盔(216)、胸 410 挖矿衣(20)/5589 勘探者上衣(252)、
  //   腿 411 挖矿裤(19)/5590 勘探者裤装(240)）：pickSpeed -= 0.1（:299-303,消费端
  //   Game.pickSpeedMult——单件同字段面在 accfx json+armorStat 环）
  ...expandHeadVariants('Mining', [11, 285, 216], [20, 252], [19, 240], { pickSpeed: 0.1 }),
  // 日曜耀斑（2763/2764/2765=171|177|112,Player.cs:16224-16295 setSolar):
  // 受伤 ×0.88 + 护盾 3 层（每层该次受伤 ×0.2 + 反击 608 弹;每 3s 回 1 层;dashType=3 冲撞登记）
  '171|177|112': { endurance: 0.12, solar: true, dashType: 3 },
  // 丛林 (76|8)(49|45) 2×2×2=8 种组合全配（ArmorSetBonuses.cs:278-281 Jungle →
  //   player.manaCost -= 0.16f【加算】）。★BJ742-A R20-②（2026-10-31）：旧乘区
  //   manaCostMul 0.84 = 自造形——原版全树 manaCost 零乘区（单浮点逐项 -=,
  //   Player.cs:1859/:18450 ResetEffects 归 1 后 :11979-:15227 二十余站全加算）,
  //   与大自然恩赐 223(-0.06)/钴·秘银·精金牌(-0.14/0.17/0.19) 并戴时旧式
  //   (1-0.06)×0.84=0.7896 ≠ 原版 1-0.06-0.16=0.78——随刀归位加算池。
  '8|8|8': { manaCostOff: 0.16, name: 'Jungle' },
  '76|8|8': { manaCostOff: 0.16, name: 'Jungle' },
  '76|49|45': { manaCostOff: 0.16, name: 'Jungle' },
  '8|49|45': { manaCostOff: 0.16, name: 'Jungle' },
  '76|49|8': { manaCostOff: 0.16, name: 'Jungle' },
  '76|8|45': { manaCostOff: 0.16, name: 'Jungle' },
  '8|49|8': { manaCostOff: 0.16, name: 'Jungle' },
  '8|8|45': { manaCostOff: 0.16, name: 'Jungle' },
  // 熔岩 9：近战伤 +10% + fireWalk
  '9|9|9': { dmgMelee: 0.1, fireWalk: true, name: 'Molten' },
  // 霜寒 46：近远程伤 +10% + frostBurn engine（StatusNPC :93712-93716：
  //   melee||ranged 命中 → Frostburn2(324) 60×Next(5,15)t = 5-14s）
  '46|27|26': { dmgMelee: 0.1, dmgRanged: 0.1, frostBurn: true, name: 'Frost' },
  // 海龟 1316/1317/1318 = 槽 99|65|54（★BJ745 A02,issue#35：Benefits.Turtle
  //   ArmorSetBonuses.cs:159-164 = endurance+=0.15 + thorns=1f + turtleThorns。
  //   endurance 0.15 走 sb 槽键通道（activeArmorSetMatch=GetEffectiveArmor 语义,
  //   ArmorSetBonus.QueryContext :20-24 直读 effective ✓）→ equipStats.enduranceEq
  //   → damage() ×(1−endurance) 截断（防后 100 伤应 85）;thorns=1f 被消费端
  //   turtleThorns?2:thorns 覆写（Game :39102）=死值不承载;turtleThorns 行为旗
  //   走 vid 键表 getter（Player.ts turtleSet）,与本槽键条目分道不双计。
  //   反伤共享配装面（A07）随 getter 改读 effective 一并修复）
  '99|65|54': { endurance: 0.15, name: 'Turtle' },
  // 幽灵套（Spectre Robe 66 / Pants 55；Player.cs:15850-15860）：
  // 头 101 兜帽 → ghostHeal（魔法命中回血，魔法伤 −40%）；
  // 头 156 面具 → ghostHurt（on-hit 浮魂弹 356——★批⑥已接 SpectreSoulProj.ts；
  //   物品 id 域同登记 :411 triples [[2189,1504,1505]]，两域同义）
  '101|66|55': { ghostHeal: true, dmgMagic: -0.4, name: 'SpectreHealing' },
  '156|66|55': { ghostHurt: true, name: 'SpectreDamage' },
  // ★BEGIN FORBIDDEN-SET 组C 终盘（2026-09-18,只加本键勿动它键——并行扩表隔离块）
  // 禁戒套（Forbidden Mask 3776/Robes 3777/Treads 3778 = 槽 200|198|142,Item.cs
  // SetDefaults case 3776-3778 :33432-33450;注册 ArmorSetBonuses.cs:474）。
  // Benefits.Forbidden :61-65 = setForbidden+UpdateForbiddenSetLock+光照——纯行为型,
  // 件面数值（3776 魔法/召唤+15% :13368 / 3777 蓝+40 召唤+10% +1 随从 :13373 /
  // 3778 蓝+40 魔法+10% +1 随从 :13379）走 itemstats/装备功能面（本表不承载）。
  // engine = Player.ts setForbidden 挂点 + entities/ForbiddenSignProj.ts（弹 656）
  '200|198|142': { forbidden: true, name: 'Forbidden' },
  // ★END FORBIDDEN-SET
  // 渔夫套（Player.cs:15916-15921：head∈{161,286} && body∈{169,253} && legs∈{104,241}
  // → anglerSetSpawnReduction → NPC.cs:627-630 生成环 ×1.3/×0.7；2×2×2=8 组合）
  '161|169|104': { anglerSet: true, name: 'Angler' },
  '161|169|241': { anglerSet: true, name: 'Angler' },
  '161|253|104': { anglerSet: true, name: 'Angler' },
  '161|253|241': { anglerSet: true, name: 'Angler' },
  '286|169|104': { anglerSet: true, name: 'Angler' },
  '286|169|241': { anglerSet: true, name: 'Angler' },
  '286|253|104': { anglerSet: true, name: 'Angler' },
  '286|253|241': { anglerSet: true, name: 'Angler' },
  // ---- 叶绿三件套族（台账 L3 清偿批 2026-08-31;1458 ArmorSetBonuses.Initialize
  //      :430-432+Add :447-449——AddBuff(60,5)+setChlorophyte 四头变体，共享胸
  //      ChlorophytePlateMail(bs51)×腿 Greaves(ls47)）：
  //   · 近战头 Mask 1001(hs78) → ChlorophyteMelee：额外 endurance += 0.05（:131）
  //   · 召唤头 Visor 5524(hs283) → ChlorophyteSummon：maxMinions += 2 —— 随从面由
  //     本表键 '283|51|47' slot:2 承载（原 SUMMON_SET 面,BJ147 组D 并键至此条目）
  //   · 头盔 Helmet 1002(hs79)/头饰 Headgear 1003(hs80) → Chlorophyte 基础档
  //   引擎本体 = entities/ChloroLeafCrystalProj.ts + Player.fixedUpdate buff 段 +
  //   Game.updateChloroCrystalAnchor/spawnChloroLeafShot/chloroOnHitLeafStrike ----
  '78|51|47': { crystalLeaf: true, endurance: 0.05, name: 'ChlorophyteMelee' },
  '79|51|47': { crystalLeaf: true, name: 'ChlorophyteHelmet' },
  '80|51|47': { crystalLeaf: true, name: 'ChlorophyteHeadgear' },
  // 召唤头变体：SUMMON_SET 并键（BJ147 组D）——maxMinions+2 由本条目 slot 承载
  '283|51|47': { crystalLeaf: true, slot: 2, name: 'ChlorophyteSummon' },
  // ---- 组B 硬模式矿族九套（2026-09-18;1458 :448-456 Add 注册,槽序=Item.cs）----
  //   钴 371/372/373=hs29/30/31×胸 374=bs17×腿 375=ls16；
  //   秘银 376/377/378=hs32/33/34×胸 379=bs18×腿 380=ls17；
  //   精金 400/401/402=hs35/36/37×胸 403=bs19×腿 404=ls18。
  //   Benefits：CobaltCaster manaCost−0.14（:166-169）/CobaltMelee meleeSpeed+0.15
  //   （:171-174）/CobaltRanged ammoCost80（:176-179）；MythrilCaster −0.17（:181-184）/
  //   MythrilMelee meleeCrit+10（:186-189）/MythrilRanged ammoCost80（:191-194）；
  //   AdamantiteCaster −0.19（:196-199）/AdamantiteMelee meleeSpeed+0.2+moveSpeed+0.2
  //   （:201-205）/AdamantiteRanged ammoCost75（:207-209）
  '29|17|16': { manaCostOff: 0.14, name: 'CobaltCaster' },
  '30|17|16': { meleeSpd: 0.15, name: 'CobaltMelee' },
  '31|17|16': { ammoCost80: true, name: 'CobaltRanged' },
  '32|18|17': { manaCostOff: 0.17, name: 'MythrilCaster' },
  '33|18|17': { critMelee: 10, name: 'MythrilMelee' },
  '34|18|17': { ammoCost80: true, name: 'MythrilRanged' },
  '35|19|18': { manaCostOff: 0.19, name: 'AdamantiteCaster' },
  '36|19|18': { meleeSpd: 0.2, move: 0.2, name: 'AdamantiteMelee' },
  '37|19|18': { ammoCost75: true, name: 'AdamantiteRanged' },
  // 水晶刺客（1458 :465 CrystalNinja 4982/4983/4984=261|230|213——组B 行为面
  //   2026-09-18）：近/远/魔/召唤伤各 +10% + 三系暴 +10（:238-247）+
  //   dashType=5 水晶冲刺（:248——速度/阻尼/冷却档与 dash1 忍者足具同档 16.9,
  //   无冲撞伤害,起手/滑行水晶尘 68/69/70 :21503-21520/21664-21682;
  //   触发/尾段与既有 dash 链同构,仓内泛化分支天然承载）
  '261|230|213': { dmgMelee: 0.1, dmgRanged: 0.1, dmgMagic: 0.1, dmgMinion: 0.1,
    critMelee: 10, critRanged: 10, critMagic: 10, dashType: 5, name: 'CrystalNinja' },
  // ---- 硬模式矿族三件套（1458 ArmorSetBonuses.Initialize :455-464——Builder 全
  //      组合展开见 expandHeadVariants 注；槽序 = Item.cs SetDefaults 提取：
  //      帕拉钯头 1205/1206/1207=hs83/84/85×胸 1208=bs54×腿 1209=ls49；
  //      山铜头 1210/1211/1212=hs86/87/88×胸 1213=bs55×腿 1214=ls50）----
  // 帕拉钯 (:216-221)：onHitRegen → OnHit AddBuff(58,300) 快速再生（:6942-6945）
  ...expandHeadVariants('Palladium', [83, 84, 85], [54], [49], { onHitRegen: true }),
  // 山铜/奥利哈刚 (:222-227)：onHitPetal → OnHit 花瓣弹 221（dmg36/kb0,petalTimer=20）
  ...expandHeadVariants('Orichalcum', [86, 87, 88], [55], [50], { onHitPetal: true }),
  // ---- 神圣套两变体（1458 :462-464 头选项数组族——PartType.Head 仅文案语义；
  //      槽序：神圣近战/远程/魔法头 558(面具)/553(头盔)/559(头饰)=hs42/41/43、
  //      远古版 4896/4897/4898=hs255/256/257；召唤头 4873(神圣兜帽)/4899(远古
  //      兜帽)=hs254/258。共享胸 551(bs24)/4900(bs229)×腿 552(ls23)/4901(ls212)。
  //      HallowedSummoner 额外 maxMinions+=2（ArmorSetBonuses.cs:228-231）——
  //      ★本表条目 slot:2 承载（原 vanillaSummonStats.SUMMON_SET
  //      '254|*|*'/'258|*|*' 键群,2026-08-13 批,BJ147 组D 并键至本表同键条目）
  //      + 兜帽散件 SUMMON_GEAR 4873/4899 {slot:1,dmg:.10}（vanilla
  //      ApplyEquipFunctional :16023 头件固有 maxMinions++）分道承载 ----
  // 召唤变体在先：表序无关，GetCompleteSet 按头部项所在集合优先扫描
  // （SetsContaining[head] 先于 body），兜帽只属本集合 ⇒ 无歧义。
  // HallowedSummoner 额外 maxMinions+2——SUMMON_SET 并键（BJ147 组D）由本条目 slot 承载
  ...expandHeadVariants('HallowedSummoner', [254, 258], [24, 229], [23, 212],
    { onHitDodge: true, slot: 2 }),
  ...expandHeadVariants('Hallowed', [41, 42, 43, 255, 256, 257], [24, 229], [23, 212],
    { onHitDodge: true }),
  // ---- 召唤专属套（BJ147 组D：vanillaSummonStats.SUMMON_SET 并入单表——键集/数值
  //      1:1 平移,全部标 summonSetOnly（只走 summonSet 通道,setBonus 文本通道不亮=
  //      既有正确面）。行号锚 = ArmorSetBonuses.cs Benefits + 原表注 ----
  '82|53|48': { slot: 1, whipRange: 0.2, summonSetOnly: true, name: 'Tiki' },             // :12-16(:466)
  '134|95|79': { dmg: 0.25, summonSetOnly: true, name: 'Spooky' },                        // :18-21(:467)
  '160|168|103': { dmg: 0.1, summonSetOnly: true, name: 'Bee' },                          // :23-30(:468)
  '162|170|105': { dmg: 0.12, summonSetOnly: true, name: 'Spider' },                      // :32-35(:469)
  '185|187|127': { dmg: 0.15, whipRange: 0.3, whipSpd: 1 / 1.15, summonSetOnly: true, name: 'ObsidianOutlaw' },  // :120-127(:483)
  // ---- DD2 八组（:68-118 Benefits,:475-482 注册——T3 方法同置 T2 旗;双腿变体键
  //      '205|202|147'/'212|206|155' = 1.4.4 双腿遗键（1457 注册表腿单值 146/154,
  //      ls 无物件=运行时死键,recon-armorset 孤儿 census 登记,1:1 保留）----
  '204|201|145': { sentry: 1, squireT2: true, summonSetOnly: true, name: 'SquireTier2' },            // :475
  '203|200|144': { sentry: 1, apprenticeT2: true, summonSetOnly: true, name: 'ApprenticeTier2' },    // :476
  '205|202|146': { sentry: 1, huntressT2: true, summonSetOnly: true, name: 'HuntressTier2' },        // :477
  '205|202|147': { sentry: 1, huntressT2: true, summonSetOnly: true, name: 'HuntressTier2' },        // 遗键（死）
  '206|203|148': { sentry: 1, monkT2: true, summonSetOnly: true, name: 'MonkTier2' },                // :479
  '210|204|152': { sentry: 1, squireT3: true, squireT2: true, summonSetOnly: true, name: 'SquireTier3' },          // :481
  '211|205|153': { sentry: 1, apprenticeT3: true, apprenticeT2: true, summonSetOnly: true, name: 'ApprenticeTier3' },  // :482
  '212|206|154': { sentry: 1, huntressT3: true, huntressT2: true, summonSetOnly: true, name: 'HuntressTier3' },    // :481 组
  '212|206|155': { sentry: 1, huntressT3: true, huntressT2: true, summonSetOnly: true, name: 'HuntressTier3' },    // 遗键（死）
  '213|207|156': { sentry: 1, monkT3: true, monkT2: true, summonSetOnly: true, name: 'MonkTier3' },                // :482 组
  '189|190|130': { guardian: true, summonSetOnly: true, name: 'Stardust' },               // :56-59(:473,守护者行为型)
};

// vid 键表 = `${head|body|legs 物品 id}`（原版 ArmorSetBonus.QueryContext 语义=逐件 type
// 直比;与槽键表的槽序键分属两 lane——组A 收敛统一）。承载面 = 原 Player.ts 内联 vid
// 三元组判定（硬编 6 套）+ getter 2 套（turtle/cactus——槽检→vid 等价性已由闸门
// 全三元组碰撞普查证明）。行号锚 = ArmorSetBonuses.cs Initialize。
// ★BEGIN RECON-ARMORSET-VID
// 由 tools/recon-armorset-1457.mjs --fix 从 ArmorSetBonuses.cs Initialize 重放生成（勿手改）
export const ARMOR_SET_BONUSES_VID: Record<string, ArmorSetBonus> = {
  '1548|1549|1550': { shroomiteSet: true, name: 'Shroomite' },   // Shroomite（Initialize :394）
  '1546|1549|1550': { shroomiteSet: true, name: 'Shroomite' },   // Shroomite（Initialize :394）
  '1547|1549|1550': { shroomiteSet: true, name: 'Shroomite' },   // Shroomite（Initialize :394）
  '2199|2200|2202': { beetleOff: true, name: 'BeetleDamage' },   // BeetleDamage（Initialize :416）
  '2199|2201|2202': { beetleDef: true, name: 'BeetleDefense' },   // BeetleDefense（Initialize :417）
  '792|793|794': { crimsonRegen: true, name: 'Crimson' },   // Crimson（Initialize :433）
  '123|124|125': { spaceGun: true, name: 'Meteor' },   // Meteor（Initialize :436）
  '894|895|896': { cactusThorns: true, name: 'Cactus' },   // Cactus（Initialize :446）
  '1316|1317|1318': { turtleThorns: true, name: 'Turtle' },   // Turtle（Initialize :447）
  '2757|2758|2759': { vortexSet: true, name: 'Vortex' },   // Vortex（Initialize :471）
  '2760|2761|2762': { nebulaSet: true, name: 'Nebula' },   // Nebula（Initialize :472）
};
// ★END RECON-ARMORSET-VID

/** vid 三元组套装查找（单表唯一入口——原内联 `hVid === A && bVid === B && lVid === C`
 *  直比的收编形态;键不存在/缺件返回 null,与原直比语义逐态等价） */
export function matchArmorSetBonusVid(hVid: number, bVid: number, lVid: number): ArmorSetBonus | null {
  return ARMOR_SET_BONUSES_VID[`${hVid}|${bVid}|${lVid}`] ?? null;
}

// ---- BJ224 套装奖励 tooltip lane（2026-09-21 实报定谳「凡可装备全贴当前生效套装
//      奖励」——旧 tooltip 面全局贴 player.setBonus,穿神圣套时贝壳发夹(2417,非任何
//      套成员)等一切可装备件全带神圣套奖励行）----
// 原版锚 = Main.cs:21473-21517（1456:21097-21141 / 1458:21473-21517 三基线同相）：
// 行门 = ArmorSetBonuses.SetsContaining[item.type] 非空（BuildLookup :486-510 按
// Head/Body/Legs vid 分组,组内序=注册序;SetsContaining[0] 显式清零 :509）——非
// 「玩家当前生效套装」。本 lane = Initialize（ArmorSetBonuses.cs :392-484）全量
// 64 套 170 三元组重放:vid 域 + 注册序 + PartType 主件位（GetTooltipForSinglePiece
// /GetTooltipForWornArmor 的 DecidedBy* 文案判据,ArmorSetBonus.cs :201-227）。
// 仅 tooltip 显示消费（行为面仍在上方两条键 lane;recon-armorset-1457 闸门不覆盖本
// lane——金标 = tests/bj224-setbonus-tooltip.test.ts 反编译直读逐套对拍）。
export interface ArmorSetTooltipSet { name: string; primary: 0 | 1 | 2; triples: [number, number, number][]; /** ★四百九十八:mod 套描述直挂(l10n 键缺域——原版套走 ArmorSetBonus.<name> 键) */ desc?: string }
export const ARMOR_SET_TOOLTIP_SETS: ArmorSetTooltipSet[] = [
  { name: 'Shroomite', primary: 0, triples: [[1548, 1549, 1550], [1546, 1549, 1550], [1547, 1549, 1550]], },
  { name: 'Wood', primary: 0, triples: [[727, 728, 729], [733, 734, 735], [730, 731, 732], [736, 737, 738], [924, 925, 926], [2509, 2510, 2511], [2512, 2513, 2514]], },
  { name: 'AshWood', primary: 0, triples: [[5279, 5280, 5281]], },
  { name: 'MetalTier1', primary: 0, triples: [[89, 80, 76], [687, 688, 689], [90, 81, 77], [954, 81, 77]], },
  { name: 'MetalTier2', primary: 0, triples: [[91, 82, 78], [92, 83, 79], [955, 83, 79], [690, 691, 692], [693, 694, 695]], },
  { name: 'Platinum', primary: 0, triples: [[696, 697, 698]], },
  { name: 'Pumpkin', primary: 0, triples: [[1731, 1732, 1733]], },
  { name: 'Gladiator', primary: 0, triples: [[3187, 3188, 3189]], },
  { name: 'Ninja', primary: 0, triples: [[256, 257, 258]], },
  { name: 'Fossil', primary: 0, triples: [[3374, 3375, 3376]], },
  { name: 'Bone', primary: 0, triples: [[151, 152, 153], [959, 152, 153]], },
  { name: 'BeetleDamage', primary: 2, triples: [[2199, 2200, 2202]], },
  { name: 'BeetleDefense', primary: 2, triples: [[2199, 2201, 2202]], },
  { name: 'Wizard', primary: 1, triples: [[238, 1282, 0], [238, 1283, 0], [238, 1284, 0], [238, 1285, 0], [238, 1286, 0], [238, 1287, 0], [238, 2279, 0], [238, 4256, 0]], },
  { name: 'MagicHat', primary: 1, triples: [[2275, 1282, 0], [2275, 1283, 0], [2275, 1284, 0], [2275, 1285, 0], [2275, 1286, 0], [2275, 1287, 0], [2275, 2279, 0], [2275, 4256, 0]], },
  { name: 'ShadowScale', primary: 0, triples: [[102, 101, 100], [102, 101, 958], [102, 957, 100], [102, 957, 958], [956, 101, 100], [956, 101, 958], [956, 957, 100], [956, 957, 958]], },
  { name: 'Crimson', primary: 0, triples: [[792, 793, 794]], },
  { name: 'SpectreHealing', primary: 1, triples: [[1503, 1504, 1505]], },
  { name: 'SpectreDamage', primary: 1, triples: [[2189, 1504, 1505]], },
  { name: 'Meteor', primary: 0, triples: [[123, 124, 125]], },
  { name: 'Frost', primary: 0, triples: [[684, 685, 686]], },
  { name: 'Jungle', primary: 0, triples: [[228, 229, 230], [228, 229, 962], [228, 961, 230], [228, 961, 962], [960, 229, 230], [960, 229, 962], [960, 961, 230], [960, 961, 962]], },
  { name: 'Molten', primary: 0, triples: [[231, 232, 233]], },
  { name: 'Snow', primary: 0, triples: [[803, 804, 805], [803, 804, 980], [803, 979, 805], [803, 979, 980], [978, 804, 805], [978, 804, 980], [978, 979, 805], [978, 979, 980]], },
  { name: 'Mining', primary: 0, triples: [[88, 410, 411], [88, 410, 5590], [88, 5589, 411], [88, 5589, 5590], [5588, 410, 411], [5588, 410, 5590], [5588, 5589, 411], [5588, 5589, 5590], [4008, 410, 411], [4008, 410, 5590], [4008, 5589, 411], [4008, 5589, 5590]], },
  { name: 'ChlorophyteMelee', primary: 1, triples: [[1001, 1004, 1005]], },
  { name: 'ChlorophyteSummon', primary: 1, triples: [[5524, 1004, 1005]], },
  { name: 'Chlorophyte', primary: 1, triples: [[1003, 1004, 1005], [1002, 1004, 1005]], },
  { name: 'Angler', primary: 0, triples: [[2367, 2368, 2369], [2367, 2368, 5593], [2367, 5592, 2369], [2367, 5592, 5593], [5591, 2368, 2369], [5591, 2368, 5593], [5591, 5592, 2369], [5591, 5592, 5593]], },
  { name: 'Cactus', primary: 0, triples: [[894, 895, 896]], },
  { name: 'Turtle', primary: 0, triples: [[1316, 1317, 1318]], },
  { name: 'CobaltCaster', primary: 1, triples: [[371, 374, 375]], },
  { name: 'CobaltMelee', primary: 1, triples: [[372, 374, 375]], },
  { name: 'CobaltRanged', primary: 1, triples: [[373, 374, 375]], },
  { name: 'MythrilCaster', primary: 1, triples: [[376, 379, 380]], },
  { name: 'MythrilMelee', primary: 1, triples: [[377, 379, 380]], },
  { name: 'MythrilRanged', primary: 1, triples: [[378, 379, 380]], },
  { name: 'AdamantiteCaster', primary: 1, triples: [[400, 403, 404]], },
  { name: 'AdamantiteMelee', primary: 1, triples: [[401, 403, 404]], },
  { name: 'AdamantiteRanged', primary: 1, triples: [[402, 403, 404]], },
  { name: 'Palladium', primary: 0, triples: [[1205, 1208, 1209], [1206, 1208, 1209], [1207, 1208, 1209]], },
  { name: 'Orichalcum', primary: 0, triples: [[1210, 1213, 1214], [1211, 1213, 1214], [1212, 1213, 1214]], },
  { name: 'Titanium', primary: 0, triples: [[1215, 1218, 1219], [1216, 1218, 1219], [1217, 1218, 1219]], },
  { name: 'HallowedSummoner', primary: 1, triples: [[4873, 551, 552], [4873, 551, 4901], [4873, 4900, 552], [4873, 4900, 4901], [4899, 551, 552], [4899, 551, 4901], [4899, 4900, 552], [4899, 4900, 4901]], },
  { name: 'Hallowed', primary: 1, triples: [[558, 551, 552], [558, 551, 4901], [558, 4900, 552], [558, 4900, 4901], [553, 551, 552], [553, 551, 4901], [553, 4900, 552], [553, 4900, 4901], [559, 551, 552], [559, 551, 4901], [559, 4900, 552], [559, 4900, 4901], [4898, 551, 552], [4898, 551, 4901], [4898, 4900, 552], [4898, 4900, 4901], [4897, 551, 552], [4897, 551, 4901], [4897, 4900, 552], [4897, 4900, 4901], [4896, 551, 552], [4896, 551, 4901], [4896, 4900, 552], [4896, 4900, 4901]], },
  { name: 'CrystalNinja', primary: 0, triples: [[4982, 4983, 4984]], },
  { name: 'Tiki', primary: 0, triples: [[1159, 1160, 1161]], },
  { name: 'Spooky', primary: 0, triples: [[1832, 1833, 1834]], },
  { name: 'Bee', primary: 0, triples: [[2361, 2362, 2363]], },
  { name: 'Spider', primary: 0, triples: [[2370, 2371, 2372]], },
  { name: 'Solar', primary: 0, triples: [[2763, 2764, 2765]], },
  { name: 'Vortex', primary: 0, triples: [[2757, 2758, 2759]], },
  { name: 'Nebula', primary: 0, triples: [[2760, 2761, 2762]], },
  { name: 'Stardust', primary: 0, triples: [[3381, 3382, 3383]], },
  { name: 'Forbidden', primary: 0, triples: [[3776, 3777, 3778]], },
  { name: 'SquireTier2', primary: 0, triples: [[3800, 3801, 3802]], },
  { name: 'ApprenticeTier2', primary: 0, triples: [[3797, 3798, 3799]], },
  { name: 'HuntressTier2', primary: 0, triples: [[3803, 3804, 3805]], },
  { name: 'MonkTier2', primary: 0, triples: [[3806, 3807, 3808]], },
  { name: 'SquireTier3', primary: 0, triples: [[3871, 3872, 3873]], },
  { name: 'ApprenticeTier3', primary: 0, triples: [[3874, 3875, 3876]], },
  { name: 'HuntressTier3', primary: 0, triples: [[3877, 3878, 3879]], },
  { name: 'MonkTier3', primary: 0, triples: [[3880, 3881, 3882]], },
  { name: 'ObsidianOutlaw', primary: 0, triples: [[3266, 3267, 3268]], },
];

/** 注册套实例（展开三元组后的单条） */
export interface ArmorSetTooltipMember { name: string; primary: 0 | 1 | 2; h: number; b: number; l: number; desc?: string }
let TOOLTIP_SETS_BY_VID: Map<number, ArmorSetTooltipMember[]> | null = null;
/** 含 vid 的注册套实例（注册序）——SetsContaining[vid] 等价（三元组 0 位 =「该位
 *  不计」占位（TryCounting :189-199 needed=0 不计数）,不产生成员关系,同 BuildLookup
 *  :509 SetsContaining[0] 显式清零）;非成员/vid≤0 返回空表） */
export function armorSetTooltipContaining(vid: number): readonly ArmorSetTooltipMember[] {
  if (!TOOLTIP_SETS_BY_VID) {
    const m = new Map<number, ArmorSetTooltipMember[]>();
    for (const set of ARMOR_SET_TOOLTIP_SETS) {
      for (const [h, b, l] of set.triples) {
        for (const part of [h, b, l]) {
          if (part === 0) continue;
          let arr = m.get(part);
          if (!arr) { arr = []; m.set(part, arr); }
          arr.push({ name: set.name, primary: set.primary, h, b, l, ...(set.desc ? { desc: set.desc } : {}) });
        }
      }
    }
    TOOLTIP_SETS_BY_VID = m;
  }
  return TOOLTIP_SETS_BY_VID.get(vid) ?? [];
}

// ---- DD2 盔甲散件主属性（GrantArmorBenefits case 3798-3882 :13236-13342 逐件实读,
//      2026-08-13 建表;2026-09-03 对账批——①补齐 3801 近战伤+0.15/:13250、3804 远程伤
//      +0.2/:13276、3807 近战伤+0.2/:13263、3872 lifeRegen+8/:13291、3878 远程伤+0.25/
//      :13320 ②3878 女猎手 T3 胸件旧 SUMMON_GEAR 条目退役收编至此（件属 HuntressTier3
//      =3877/3878/3879,ArmorSetBonuses.cs:481;同值 dmgMinion 曾在
//      盔甲扫描位双记 +0.25×2）③3875 魔耗改原版加算池 manaCostOff 0.15（:13306
//      manaCost -= 0.15f;旧 manaCostMul 0.85 乘区与 3797 并戴时 0.9×0.85=0.765 ≠
//      原版 1−0.1−0.15=0.75）。头盔面走 vanillaSummonStats.SUMMON_GEAR 扩展字段 ----
export const DD2_PIECE_FX: Record<number, Partial<ArmorSetBonus>> = {
  3798: { dmgMagic: 0.1, dmgMinion: 0.2 },                      // :13236 magic+0.1/minion+0.2
  3799: { dmgMinion: 0.1, critMagic: 20, move: 0.2 },           // :13240
  3801: { dmgMelee: 0.15, dmgMinion: 0.15 },                    // :13249 melee+0.15/minion+0.15
  3802: { dmgMinion: 0.15, critMelee: 15, move: 0.15 },         // :13253
  3804: { dmgRanged: 0.2, dmgMinion: 0.2 },                     // :13275 ranged+0.2/minion+0.2（省弹 1/10 走 ARMOR_AMMO_SAVE_VID）
  3805: { dmgMinion: 0.1, move: 0.2 },                          // :13280
  3807: { dmgMelee: 0.2, dmgMinion: 0.2 },                      // :13262 melee+0.2/minion+0.2
  3808: { dmgMinion: 0.1, critMelee: 15, move: 0.2 },           // :13266
  3872: { dmgMinion: 0.3, lifeRegen: 8 },                       // :13289 minion+0.3/lifeRegen+8=4HP/s
  3873: { dmgMinion: 0.2, critMelee: 20, move: 0.2 },           // :13293
  3875: { dmgMinion: 0.25, dmgMagic: 0.1, manaCostOff: 0.15 },  // :13303（manaCost−0.15 加算）
  3876: { dmgMinion: 0.2, critMagic: 25, move: 0.2 },           // :13308
  3878: { dmgMinion: 0.25, dmgRanged: 0.25, ammoCost80: true }, // :13318 minion+0.25/ranged+0.25/ammoCost80（旧 SUMMON_GEAR 条目已并）
  3879: { dmgMinion: 0.25, critRanged: 10, move: 0.2 },         // :13323
  3881: { meleeSpd: 0.2, critMelee: 5, dmgMinion: 0.2 },        // :13333
  3882: { dmgMinion: 0.2, critMelee: 20, move: 0.3 },           // :13338
};

/** ★四百八十二刀:mod 套装注册面(sw.armorSet;键=内部物品 id 三元组,
 *  与 ARMOR_SET_BONUSES 既有 lane 同消费面——activeArmorSetMatch/sb 投影)。
 *  全零字段条目照写(modFlags-only 套=sb 投影为 null 但 setMatch 命中面仍挂旗)。 */
export function registerModArmorSet(hInternal: number, bInternal: number, lInternal: number, bonus: ArmorSetBonus,
  tip?: { name: string; desc: string }): void {
  ARMOR_SET_BONUSES[`${hInternal}|${bInternal}|${lInternal}`] = bonus;
  // ★四百九十八:tooltip 套注册(desc 直挂=mod 文本 l10n 键缺域;查表缓存失效)
  if (tip) {
    ARMOR_SET_TOOLTIP_SETS.push({ name: tip.name, primary: 0, triples: [[hInternal, bInternal, lInternal]], desc: tip.desc });
    TOOLTIP_SETS_BY_VID = null;
  }
}

/** ★D11-M2(2026-10-14):mod 套装 teardown(热重载;旧=push 累积 N 份 tooltip 行 +
 *  停用后幽灵 bonus;tipName 'Mods.' 前缀判段) */
export function _resetModArmorSetsForTests(): void {
  for (let i = ARMOR_SET_TOOLTIP_SETS.length - 1; i >= 0; i--) {
    const set = ARMOR_SET_TOOLTIP_SETS[i] as { name?: string };
    if (set.name?.startsWith('Mods.')) ARMOR_SET_TOOLTIP_SETS.splice(i, 1);
  }
  // ★R-A-Low(2026-10-14):ARMOR_SET_BONUSES mod 段清(键='h|b|l' internal 拼;
  //  mod 物品 internal≡stable≥30000——任一分量≥30000 即 mod 键;旧=停用后幽灵
  //  bonus 段残留[套装奖励照生效])
  for (const k of Object.keys(ARMOR_SET_BONUSES)) {
    if (k.split('|').some((seg) => Number(seg) >= 30000)) delete ARMOR_SET_BONUSES[k];
  }
  TOOLTIP_SETS_BY_VID = null;
}
