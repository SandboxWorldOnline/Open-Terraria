// 召唤师专属数值链（原版 Player.ApplyEquipFunctional 按装备 type 的 if-chain 1:1 抄录；
// 原版该循环覆盖 armor[0-9]——盔甲三件+配饰同判，本表由 Player.equipStats 对两类槽位各扫一遍）。
// vanilla-accfx.json 提取器未覆盖 maxMinions/minionDamage/whipRange 模式 → 独立表补齐。
// 行号（★1457 GrantArmorBenefits/ApplyEquipFunctional 实读，2026-09-03 重锚）：
// 13231-13332（DD2 头盔散件）、13368-13384（禁戒）、13702-13706（神圣兜帽）、
// 13757-13761（绿藻召唤头）、13913-13917（Flinx）、13918-13931（蜂）、13932-13943（黑曜）、
// 13948-13959（Tiki）、13960-13969（蜘蛛）、13970-13981（星尘）、14035-14050（诡异）、
// 14480-14483+13103-13107（OOA 配饰四件 dd2Accessory 写/消费）、14766-14781（配饰四件）
export interface SummonFx {
  slot?: number;      // maxMinions += N
  sentry?: number;    // maxTurrets += N
  dmg?: number;       // minionDamage += X（加算乘区）
  kb?: number;        // minionKB += N
  whipRange?: number; // whipRangeMultiplier += X
  // ---- 主属性面（2026-09-03 接线,退役旧注"armorStat 大批,登记未接"——数值全部
  //  GrantArmorBenefits case 实读（Terraria/Player.cs 1457）,聚合语义与 accfx 链同名同式：
  //  耗魔=【加算】折扣池（原版 Player.manaCost 单浮点逐项 -=,消费端 (1-manaCostOff)×manaCostMul,
  //  禁用乘区——乘 0.9×0.85=0.765 ≠ 原版加算 1-0.1-0.15=0.75）；
  //  lifeRegen 走原版 120 单位/tick 累计 1HP 语义（:19383-19407 → N/2 HP/s,equipStats.hpPerSec）----
  manaCostOff?: number;  // manaCost -= X（3797 :13233 / 3875 :13306）
  lifeRegen?: number;    // lifeRegen += N（3800 :13247 / 3872 :13291）
  dmgMagic?: number;     // magicDamage += X（3797 :13234 / 3776 :13370 / 3778 :13382 / 3874 :13300 / 3875 :13305）
  dmgMelee?: number;     // meleeDamage += X（3871 :13286 / 3880 :13331 / 3801 :13250 / 3807 :13263）
  critRanged?: number;   // rangedCrit += N（3803 :13273 / 3877 :13316）
  meleeSpeed?: number;   // meleeSpeed += X（3806 :13260）
  move?: number;         // moveSpeed += X（1834 :14047）
  mana?: number;         // statManaMax2 += N（3777 :13375 / 3778 :13381）
  /** 1457 鞭 tag 栈族（ApplyEquipFunctional 置位 :14616-14629/:14690-14715 +
   *  UpdateEquips 消费 :13068-13083——★BJ740-A ACC02 改布尔族单计,数值在
   *  Player.computeEquipStats 循环后统一消费,本表不再携带 tagDur/maxTag 逐件值） */
  silverBracer?: boolean;   // accSilverBracer（6156/6163/6183——tagEffectDuration+2/maxTag+1）
  mobiusStrip?: boolean;    // accMobiusStrip（6158/6162——maxTag+1/whipRange+0.1）
  /** accSnakeBand（6157/6162/6186——每 3 挥中段补挥背包下一把鞭,需 maxTagEffects>1） */
  snakeBand?: boolean;
  /** accWickedArmlet（6159/6163/6179/6182——出鞭击退 +1,ItemCheck_Shoot :49159-49163） */
  wickedArmlet?: boolean;
  /** OOA 配饰族（3809-3812）：dd2Accessory 布尔——全部佩戴只计一次（Player.cs:14480-14483 写,全戴只计一次消费 :13103-13107） */
  dd2?: boolean;
}

/** 装备散件/配饰（type 直查）——含配饰 1158/1167/1845/1864 与 OOA 四配饰 3809-3812 */
export const SUMMON_GEAR: Record<number, SummonFx> = {
  // 配饰（14766-14781 + OOA 写位 14480-14483/消费位 13103-13107）
  1158: { slot: 1 },                    // 俾格米项链
  1167: { dmg: 0.15, kb: 2 },           // 大力士甲虫（不加槽）
  1845: { slot: 1, dmg: 0.10 },         // 死灵卷轴
  1864: { slot: 1, dmg: 0.15, kb: 2 },  // 纸莎草圣甲虫
  2998: { dmg: 0.15 },                  // 召唤师徽章（:14891-14894 minionDamage += 0.15——审计 P0 漏件）
  3809: { dd2: true },              // 学徒围巾（OOA 布尔:全族只计一次 +1哨兵/+10%召唤伤,:14480/:13103——旧每件累加+4/+40%）
  // （3878 女猎手 T3 胸件旧条目 {dmg:0.25} 已退役——件属 HuntressTier3=3877/3878/3879
  //  （ArmorSetBonuses.cs:481）,胸甲非配饰;同值曾与 vanillaArmorSets.DD2_PIECE_FX[3878]
  //  .dmgMinion 在盔甲扫描位双记（+0.25×2）,全量（含 dmgRanged 0.25 :13320/ammoCost80）
  //  收编到 DD2_PIECE_FX 单源）
  3810: { dd2: true },              // 侍从盾（OOA 布尔:全族只计一次 +1哨兵/+10%召唤伤,:14480/:13103——旧每件累加+4/+40%）
  3811: { dd2: true },              // 女猎手扣盾（OOA 布尔:全族只计一次 +1哨兵/+10%召唤伤,:14480/:13103——旧每件累加+4/+40%）
  3812: { dd2: true },              // 武僧腰带（OOA 布尔:全族只计一次 +1哨兵/+10%召唤伤,:14480/:13103——旧每件累加+4/+40%）

  // ---- 1457 召唤师鞭 tag 配饰九件（ApplyEquipFunctional case 6156-6163/:14615-14632
  //      + 组合件 6179/6182/6183 :14690-14715;消费段 :13068-13083）----
  //  ★BJ740-A ACC02（issue #30）：逐件 tagDur/maxTag/whipRange 数值改三布尔族
  //    （Silver∈{6156,6163,6183} Mobius∈{6158,6162} Wicked∈{6159,6163,6179,6182}
  //    Snake∈{6157,6162,6186}）——族内多件只计一次（原版 accSilverBracer 等布尔
  //    字段置位语义,消费在 Player.computeEquipStats 循环后单计）：
  //    6156+6163 应 tagDur 3/maxTag 3（旧逐件叠加 5/4）;6158+6162 应 maxTag 2/
  //    鞭程 0.1（旧 0.2）
  //  6156 SilverBracer:tagEffectDuration += 2（时长 ×3!）+ maxTagEffects++（:13068-13074,
  //    minionDamage += 0f 死代码勿抄）;6157 SnakeBand:accSnakeBand;6158 MobiusStrip:
  //    maxTagEffects++ + whipRangeMultiplier += 0.1;6159 WickedArmlet:maxTagEffects++;
  //  组合件=旗标并集:6162 OuroborosRing = MobiusStrip+SnakeBand（:14624-14627）;
  //  6163 TwilightGrasp = SilverBracer+WickedArmlet（:14628-14630 → 时长+2+双 +1）;
  //  6179 ArmletOfRuin = WickedArmlet+accArmletOfRuin（:14690-14693）;6182 WickedClaws
  //  = WickedArmlet+autoReuseGlove+meleeSpeed+0.12（:14705-14709）;6183 SilverShield
  //  = SilverBracer+noKnockback+fireWalk（:14711-14715）
  6156: { silverBracer: true },                   // 银护腕（上锁盒 1/4,OpenLockBox :9452-9454）
  6157: { snakeBand: true },                      // 蛇环
  6158: { mobiusStrip: true },                    // 莫比乌斯带（石巨人袋 1/6,OpenBossBag :7516-7518）
  6159: { wickedArmlet: true },                   // 邪恶臂镯
  6162: { mobiusStrip: true, snakeBand: true },   // 衔尾蛇环 = 6158+6157
  6163: { silverBracer: true, wickedArmlet: true },   // 暮光之握 = 6156+6159
  6179: { wickedArmlet: true },                   // 毁灭臂镯 = 6159+accArmletOfRuin（旗在 Player 侧）
  6182: { wickedArmlet: true },                   // 邪恶之爪 = 6159+autoReuseGlove+近战速+12%（Player 侧）
  6183: { silverBracer: true },                   // 白银之盾 = 6156+免击退+火焰块（Player 侧）
  6186: { snakeBand: true },                      // 德鲁伊蛇斗篷 = 6157+星星斗篷（:14726-14729,星斗篷旗 Player 侧）

  // ---- DD2 头盔散件（GrantArmorBenefits case 3797-3880 :13231-13332 实读,2026-09-03
  //  主属性接线,旧注"主属性走 armorStat 大批,登记未接"退役。哨兵位 2026-08-13 补——
  //  旧缺 8 件致哨兵上限卡 ~3。T2 头 3797/3800/3803/3806 各 maxTurrets++;T3 头
  //  3871/3874/3877/3880 各 maxTurrets += 2;T3 头另带 minionDamage（3871 +0.1/
  //  3874 +0.15/3877 +0.1/3880 +0.2）。主属性面走上方扩展字段,sumFx（Player.ts
  //  盔甲三件+配饰两扫）消费。
  //  ★世代勘误:3797-3808=T2 族（T1 无头盔散件 maxTurrets）;套键 = itemstats hs——
  //  3871 hs210='210|204|152' squireT3 ⇒ 3871=侍从巨盔、3874 hs211=学徒战斗帽
  //  （旧注两名互换已正,与原版伤系自洽:侍从近战/学徒魔法）----
  3797: { sentry: 1, manaCostOff: 0.1, dmgMagic: 0.1 },   // 学徒帽 T2（:13231 maxTurrets++/manaCost−0.1/magicDamage+0.1）
  3800: { sentry: 1, lifeRegen: 4 },                       // 侍从头盔 T2（:13245 maxTurrets++/lifeRegen+4=2HP/s）
  3803: { sentry: 1, critRanged: 10 },                     // 女猎手头巾 T2（:13271 maxTurrets++/rangedCrit+10）
  3806: { sentry: 1, meleeSpeed: 0.2 },                    // 武僧头带 T2（:13258 maxTurrets++/meleeSpeed+0.2）
  3871: { sentry: 2, dmg: 0.10, dmgMelee: 0.10 },          // 侍从巨盔 T3（:13284 maxTurrets+=2/meleeDamage+0.1/minionDamage+0.1——近战与召唤同值）
  3874: { sentry: 2, dmg: 0.15, dmgMagic: 0.15 },          // 学徒战斗帽 T3（:13298 maxTurrets+=2/magicDamage+0.15/minionDamage+0.15）
  3877: { sentry: 2, dmg: 0.10, critRanged: 10 },          // 女猎手服 T3（:13313 maxTurrets+=2/minionDamage+0.1/rangedCrit+10）
  3880: { sentry: 2, dmg: 0.20, dmgMelee: 0.20 },          // 武僧束发 T3（:13328 maxTurrets+=2/minionDamage+0.2/meleeDamage+0.2）
  2361: { slot: 1, dmg: 0.04 },         // 蜂头饰（:13918 maxMinions++/minionDamage+0.04——原版仅召唤面,核实无散件主属性）
  2362: { slot: 1, dmg: 0.04 },         // 蜂胸甲（:13923 同上）
  2363: { dmg: 0.05 },                  // 蜂护胫（无槽;:13928 minionDamage+0.05 仅召唤面）
  2370: { slot: 1, dmg: 0.05 },         // 蜘蛛面具（:13960 maxMinions++/minionDamage+0.05 仅召唤面）
  2371: { slot: 1, dmg: 0.05 },         // 蜘蛛胸甲（:13960 同上）
  2372: { slot: 1, dmg: 0.06 },         // 蜘蛛护胫（:13965 maxMinions++/minionDamage+0.06 仅召唤面）
  3266: { dmg: 0.08 },                  // 黑曜头（:13932 minionDamage+0.08 仅召唤面）
  3267: { slot: 1 },                    // 黑曜衫（:13936 maxMinions++ 仅此一项）
  3268: { dmg: 0.08 },                  // 黑曜裤（:13940 minionDamage+0.08 仅召唤面）
  3381: { slot: 1, sentry: 1, dmg: 0.22 },            // 星尘头盔（同加两链！）
  3382: { slot: 2, dmg: 0.22, whipRange: 0.15 },      // 星尘胸甲
  3383: { slot: 2, dmg: 0.22, whipRange: 0.15 },      // 星尘护腿
  1159: { slot: 1, dmg: 0.10, whipRange: 0.10 },      // 提基面具
  1160: { slot: 1, dmg: 0.10 },         // 提基衫
  1161: { slot: 1, dmg: 0.10 },         // 提基裤
  1832: { slot: 1, dmg: 0.11 },         // 诡异头盔
  1833: { slot: 2, dmg: 0.11 },         // 诡异胸甲
  1834: { slot: 1, dmg: 0.11, move: 0.2 },  // 诡异护腿（:14045 moveSpeed+0.2——accfx '1834' 同值条目为盔甲面死键,由本表承载）
  3776: { dmg: 0.15, dmgMagic: 0.15 },  // 禁戒面具（:13368 magicDamage+0.15——旧注"accfx 主链管"系死链:accfx 消费环只扫配饰槽 3+,盔甲面由本表扩展字段承载）
  3777: { slot: 1, dmg: 0.10, mana: 40 },     // 禁戒长袍（:13373 statManaMax2+40）
  3778: { slot: 1, mana: 40, dmgMagic: 0.10 }, // 禁戒裤（:13379 statManaMax2+40/magicDamage+0.1）
  4873: { slot: 1, dmg: 0.10 },         // 神圣兜帽
  4899: { slot: 1, dmg: 0.10 },         // 神圣面具(远古)
  5524: { slot: 1, dmg: 0.16 },         // 绿藻头饰
  5068: { slot: 1, dmg: 0.05 },         // Flinx 皮大衣

  // ---- ★armorStat 甲件 minionDamage 面（2026-09-04 死键批收偿）——vanilla-accfx.json
  //  提取器不覆盖 minionDamage 模式（本表头注）,这些常规甲件的召唤伤加算面此前无处
  //  承载=缺;非召唤面（伤/暴/速/移速）仍走 accfx 甲件环（Player.ts armorStat,若本表
  //  与 accfx 行同 vid 需字段互斥——1834 move 为先例）。行号全 1457 GrantArmorBenefits
  //  if-chain 实读,件名 = ItemID.cs 常量: ----
  403:  { dmg: 0.08 },                  // 精金胸甲 AdamantiteBreastplate（:13567 case,minionDamage+0.08）
  552:  { dmg: 0.07 },                  // 神圣护腿 HallowedGreaves（:13713 case 同 4901,minionDamage+0.07）
  4901: { dmg: 0.07 },                  // 神圣护腿·远古 AncientHallowedGreaves（:13713 同行）
  1004: { dmg: 0.05 },                  // 叶绿板甲胸 ChlorophytePlateMail（:13762 case,minionDamage+0.05 @13767）
  1208: { dmg: 0.03 },                  // 钯金胸甲 PalladiumBreastplate（:13597 case,minionDamage+0.03）
  1209: { dmg: 0.02 },                  // 钯金护腿 PalladiumLeggings（:13607 case,minionDamage+0.02）
  1214: { dmg: 0.08 },                  // 山铜护腿 OrichalcumLeggings（:13639 case,minionDamage+0.08）
  1218: { dmg: 0.04 },                  // 钛金胸甲 TitaniumBreastplate（:13664 case,minionDamage+0.04）
  1219: { dmg: 0.03 },                  // 钛金护腿 TitaniumLeggings（:13674 case,minionDamage+0.03）
  792:  { dmg: 0.03 },                  // 猩红头盔 CrimtaneHelmet（:13470 case 三件共支,minionDamage+0.03 @13475）
  793:  { dmg: 0.03 },                  // 猩红胸甲（:13470 同支）
  794:  { dmg: 0.03 },                  // 猩红护腿（:13470 同支）
  375:  { dmg: 0.03 },                  // 钴护腿 CobaltLeggings（:13511 case,minionDamage+0.03 @13516）
  379:  { dmg: 0.07 },                  // 秘银链甲 MythrilChainmail（:13534 case,minionDamage+0.07 @13539）
  2277: { dmg: 0.05 },                  // 稽古衣 Gi（:13390 case,minionDamage+0.05——组A 单件面批 2026-09-18 补;非召唤面仍走 accfx 甲件环）
  4983: { dmg: 0.05 },                  // 水晶刺客上衣 CrystalNinjaChestplate（:13728 case,minionDamage+0.05,同批补;huntressAmmoCost90 走 ARMOR_AMMO_SAVE_VID 单源）
};

/** ★BJ147 组D（2026-09-17）：SUMMON_SET / SummonSetFx 已并入 vanillaArmorSets.ts
 *  单表（ARMOR_SET_BONUSES 召唤字段族条目 + summonSetOnly 通道标记）——套装判定
 *  唯一事实源 = 单表;本文件只保留散件/配饰面 SUMMON_GEAR（含 SummonFx 基础字段）。
 *  对账：node tools/recon-armorset-1457.mjs（键集/数值/特效旗对拍,DRIFT 必须=0）。 */
