// Buff 系统（1.4.5.6 原版框架语义移植：Player.cs AddBuff / UpdateBuffs）
//  - AddBuff 合并规则（AddBuff_TryUpdatingExistingBuffTime L5138+）：同类 buff 时间
//    取 max——续期不缩短（蜂蜜浸入每 tick AddBuff(48,1800) 因此天然成立：浸着恒 30s，
//    离开后从 30s 倒计时自然消退）。
//  - 效果聚合按 UpdateBuffs L9640+ 逐 case，数值一律取 1456：
//      Regeneration(2): lifeRegen += 4（=2 HP/s）
//      Swiftness(3): moveSpeed += 0.25
//      Ironskin(5): statDefense += 8
//      Thorns(14): thorns = 1 → 反弹接触伤害全额（cap 1000，StrikeNPC 侧 L30940-30944）
//      PotionSickness(21): 封锁治疗药水
//      Honey(48): lifeRegenTime += 2、lifeRegen += 2（=1 HP/s）；lifeRegen<0 时 +4 对冲
//      （debuff 系统未移植，对冲分支暂缺）；授予来源 = 浸蜜（Player.cs:27436
//      AddBuff(48,1800)）/ 蜂蜜史莱姆接触（:30904）/ 蜂窝饰品受击（:37905 AddBuff(48,300)）
//      Campfire(87)：原版为 SceneMetrics.HasCampfire 光环 lifeRegen++（:18990）——
//      本仓库沿用 Game 每 20tick 扫描写入的持续小时长 buff 表达
// 名称/描述走原版 l10n：BuffName.<Internal> + 自有 Mods.SandboxWorld.Buff.* 描述
import { Lang } from '../i18n/Lang';
import { scaleStatsWorld, GDL } from './ScaleStats';

export enum BuffType {
  Agility = 0,    // 敏捷：移速 +25% → Swiftness(3)
  Ironskin = 1,   // 铁皮：防御 +8 → Ironskin(5)
  Resistance = 2, // 耐药性：立即回 80 HP，期间禁用治疗药水（60s）→ PotionSickness(21)
  Thorns = 3,     // 荆棘：反弹接触伤害全额（cap 1000）→ Thorns(14)
  Regen = 4,      // 恢复：2 HP/s → Regeneration(2)
  Campfire = 5,   // 篝火：范围光环(由附近篝火/心灯实体驱动,Game 每帧续期) → Campfire(87)
  Honey = 6,      // 蜂蜜：1 HP/s（浸蜜授予，30s）→ Honey(48)
  OnFire = 7,     // 着火(24)：4 HP/s（lifeRegen-8,Player.cs:18793）；入水熄灭（:27426）
  Burning = 8,    // 燃烧(67)：30 HP/s（lifeRegen-60）+ 移速减半；站上陨石/狱石授予（ApplyTouchDamage）
  Bleeding = 9,   // 流血(30)：清自然恢复计时 lifeRegenTime=0（:18998,无直接 DoT）
  Suffocation = 10, // 窒息(68)：20 HP/s（lifeRegen-40）；埋入沙族持续 1 tick 授予
  // ---- 药水 buff 族（Item.cs case 288-304 buffType/buffTime;效果取 Player.cs UpdateBuffs）----
  ObsidianSkin = 11, // 黑曜石皮(1,360s)：lavaImmune+fireWalk+着火免疫（:9573）
  Gills = 12,        // 鱼鳃(4,240s)：gills 水下呼吸不耗（:9656）
  ManaRegen = 13,    // 魔力再生(6,480s)：manaRegenBuff 静止加成常开+满额倍率（:19238）
  MagicPower = 14,   // 魔法力量(7,240s)：magicDamage+0.2（:9667）
  Featherfall = 15,  // 羽落(8,600s)：slowFall 重力/3+fallStart 重置免摔（:9671/:21367）
  WaterWalking = 16, // 水上行走(15,600s)：waterWalk=true（:9706）
  Archery = 17,      // 射手(16,480s)：archery+arrowDamage×1.1（:9710）
  NightOwl = 18,     // 夜枭(12,600s)：nightVision→光衰减 ×1.03（:9636/184）——水下/洞穴更亮
  // ---- 环境光环 + 工作站 buff（SceneMetrics 扫描 / Player.cs:25235-25266 授予链）----
  Sunflower = 19,    // 向日葵(146,光环)：moveSpeed +0.1 再 ×1.1（两步复合 ≈×1.21,Player.cs:10598）
  CatBast = 20,      // 猫堡垒(215,光环)：statDefense +5（:9778）
  StarInBottle = 21, // 瓶中星(158,光环)：manaRegenBonus+10（:9629-9632;★1458 已删 delayBonus+0.5,Player.cs:10020）
  PeaceCandle = 22,  // 和平蜡烛(157,光环)：刷怪 spawnRate×1.3/max×0.7（NPC.cs:645）
  Clairvoyance = 23, // 预见(29,水晶球右键,1800s)：manaMax+20/magicDmg+5%/crit+2/manaCost-2%（:11481）
  Sharpened = 24,    // 磨刀石(159,右键)：近战穿甲 +12（:9625→Player.armorPenBase:1090）
  AmmoBox = 25,      // 弹药箱(93,右键)：20% 不耗弹（PickAmmo :52746）
  Bewitched = 26,    // 附魔台(150,右键)：maxMinions+1（:9857→Player.maxMinions:972）
  WarTable = 27,     // 战争桌(348,右键)：maxTurrets+1（:9863→Player.maxSentries:979）
  SugarRush = 28,    // 糖分冲刺(192,蛋糕右键,120s)：moveSpeed+0.2+镐速（:9634）
  SoulDrain = 107,  // 吸魂(vanilla 151,魂镰3006联动自持2s)：lifeRegenTime+2+回复(5+n)/2(:18939/:18977)
  // ---- R1 数值批（Player.cs UpdateBuffs 逐条对 1456）----
  Battle = 29,        // 战斗(13,420s)：spawnRate×0.5/max×2（NPC.cs:632）
  Calming = 30,       // 镇静(106,240s)：spawnRate×1.65/max×0.6（NPC.cs:617）
  Mining = 31,        // 挖矿(104,600s)：pickSpeed-0.25 → 挖掘冷却×0.75（:9818）
  Builder = 32,       // 建筑工(107,900s)：tileSpeed+0.25/wallSpeed+0.25/blockRange+1（:9841）
  Heartreach = 33,    // 拾心(105,180s)：lifeMagnet 心拾取范围扩大（:9822）
  FlipperPotion = 34, // 脚蹼药(109,180s)：ignoreWater 游泳自由（:9851）
  Titan = 35,         // 泰坦(108,180s)：kbBuff → 近战击退×1.5（:20812）
  AmmoReservation = 36, // 弹药储备(112,480s)：20% 不耗弹（PickAmmo :52751）
  Lifeforce = 37,     // 生命力(113,300s)：maxHp +20%（statLifeMax2 += max/5/20*20,:9883）
  Endurance = 38,     // 耐久(114,300s)：endurance+0.1 → 受伤×0.9（:9886）
  Wrath = 39,         // ★标签对调说明：本枚举名 Wrath 实挂 vanillaBuff 115=原版 Rage 药水(怒气)：
                      //   melee/ranged/magic 暴击+10（:9888-9893，召唤不吃——GetWeaponCrit summon=0）
  Rage = 40,          // ★本枚举名 Rage 实挂 vanillaBuff 117=原版 Wrath 药水(暴怒)：四系伤害+10%（:9947）
  Tipsy = 41,         // 醉酒(25,清酒)：def-4/近战暴击+2/近战伤+10%/近战速+10%（:11513）
  // ---- R2 武器浸剂（meleeEnchant 表 Player.cs:11604-11636 → 敌 debuff :6141-6171）----
  ImbueVenom = 42,    // 毒液药剂(71)→敌 Venom(70) 5-10s（30HP/s）
  ImbueCursed = 43,   // 诅咒焰药剂(73)→敌 Cursed Inferno(39) 3-7s（24HP/s）
  ImbueFire = 44,     // 烈火药剂(74)→敌 OnFire(24) 3-7s（4HP/s）
  ImbueGold = 45,     // 金药剂(75)→敌 Midas(72) 2s（掉钱 ×1.10-1.51）
  ImbueIchor = 46,    // 灵液药剂(76)→敌 Ichor(69) 10-20s（防御 -15）
  ImbueNano = 47,     // 纳米药剂(77)→敌 Confused(31) 1-4s（AI 反向近似）
  ImbueParty = 48,    // 派对药剂(78)→命中爆彩带（视觉）
  ImbuePoison = 49,   // 毒药剂(79)→敌 Poison(20) 5-10s（6HP/s）
  Inferno = 50,       // 狱火药水(116)：200px 光环烧敌 2s+20 伤/60t（:9896）
  // ---- R3 视觉批 ----
  Shine = 51,         // 光芒(11,1800s)：玩家中心格常亮 (0.8,0.95,1.0)（:9687-9690；旧注 1.3/:9872 为误值）
  Spelunker = 52,     // 洞穴探险(9)：矿物高亮（Renderer 叠层）
  Dangersense = 53,   // 危险感(111)：陷阱高亮
  Hunter = 54,        // 狩猎(17)：小动物高亮（detectCreature :9719）
  BiomeSight = 55,    // 群系视觉(343)：邪恶/神圣方块高亮
  Luck = 56,           // 幸运(257)：luckPotion 三档（buffTime>600s=3/>300s=2）×0.1（:9971/:28674）
  Summoning = 57,      // 召唤(110,480s)：maxMinions+1（:9855）
  // ---- R7 钓鱼三药水 ----
  Fishing = 58,        // 钓鱼(121,480s)：fishingSkill+15（:9831）
  Sonar = 59,          // 声呐(122,480s)：显示渔获名（sonar :9835）
  Crate = 60,          // 宝匣(123,300s)：渔获箱率 +10%（cratePotion :9839）
  Gravitation = 61,    // 重力(18,180s)：Up 键切换 gravDir（:9720）
  // ---- R8 敌弹状态批（Projectile.StatusPlayer :11450+ 授予链）----
  Rabies = 74,         // 狂犬病(148,★IIIII228 StatusFromNPC 蝙蝠族接触臂 :22650-22652
                       //   ——49/93/51/152/634 专家 1/10 Next(1800,5400))：vanilla
                       //   Rabies 生命再生 -4（Player.cs lifeRegen 消费面同 Webbed 族登记）
  Chilled = 62,        // 冰寒(46)：移速 ×0.75（1457 :26151-26153 折入 strongestMoveSpeedDebuff）——霜月冰弹
                       //   348 FrostWave / 349 FrostShard 命中授予（:11554-11576）
  Frozen = 63,         // 冰冻(47)：整帧封移动输入（player.frozen :9749，input 清零
                       //   同 :18474 重置段）——冰女王霜弹 348 概率授予
  // ---- 食物链（Item.cs:47653 SetFoodDefaults → DefaultToFood useStyle 2 咀嚼/9 仰饮；
  // ---- 三档数值 Player.cs:11523-11570 逐档）----
  WellFed = 64,   // 饱腹(26)：def+2/全系暴击+2/全系伤+5%/近战速+5%/移速+20%/镐速-5%（:11523）
  WellFed2 = 65,  // 很饱(206)：def+3/暴击+3/伤+7.5%/近战速+7.5%/移速+30%/镐速-10%（:11539）
  WellFed3 = 66,  // 饕餮(207)：def+4/暴击+4/伤+10%/近战速+10%/移速+40%/镐速-15%（:11555）
  // ---- 后期批（Player.cs UpdateBuffs 逐条对 1456）----
  MoonLeech = 67,  // 月噬(145)：吸血/幽灵/治疗弹回复全禁（moonLeech，:11454-11457）
                   //   ——由月总月噬弹 456 贴身 20px 授予（Projectile.cs:30722-30732，
                   //   840t/专家 960t）；消费点 Projectile.cs:12879/12885/27124。
                   //   本仓吸血/治疗弹链未实装，效果位 getter 备用；
                   //   载荷在 NPC 401 召唤门禁（bossAI_duke_moonlord）
  KiteBuff = 75,   // 风筝(383)：移速 +15% / 镐速 −10% / 放置速度 +15%（★1457 基准
                   //   Player.cs:10003-10006；旧 1456 钉 +25%/−15% 已随 2026-08-23
                   //   基准切换反转）+ kiteLuckLevel 三档 = clamp(buffTime/10800,0,3)
                   //   （:10008-10010，luck += 档×0.1/3）。授予物品（风筝族 4371 等）
                   //   未移植，登记
  Stinky = 76,     // 恶臭(120)：luck −0.25（:9958-9961 stinky / :28687-28690）。
                   //   授予 = 臭味药水 2353 投掷弹 371（Foul Potion）消亡 80px 内
                   //   ApplyBuffTo(120,1800t=30s)（Projectile.cs:75203-75228，玩家+NPC）
                   //   / 鸟粪弹 1080 命中 600t=10s（:72060-72065，PoopProj 已接）
  Werewolf = 71,     // 狼人(28,月亮符 485 夜间)：melee +5.1%伤/+2暴/+5.1%速（:11488-11498）
  BrainOfConfusionBuff = 72,
  Weak = 73,         // 虚弱(33,狼人 155 命中施加)：近战-5.1%伤/速、防-4、移速-10%（:11506-11511） // 混乱之脑触发(321,受击1/6 4s)：三系+10暴 + 召唤+10%伤（:9639）
  Slow = 81,        // 缓慢(32)：moveSpeed ÷2（1457 :26147-26149 折入 strongestMoveSpeedDebuff）——鹿角怪咆哮 800px 内
  Stoned = 82,      // 石化(156,美杜莎 480 蓄力直击 NPC.cs:56885-56888)：封全部输入
  ChaosState = 83,  // 混沌状态(88,混乱之杖 1326 :44913 AddBuff(88,360) 每次使用刷新)：
                    //   buff 期内再传送 → statLife-=max/7 可致死(:44904-44913,死因 13/14/15)
  CompanionCube = 84, // 同伴方块(191,item 3628 使用授予 3600t;BuffHandle :10634
                    //   SpawnPetIfNeeded 653):光宠物 buff——活则投影续命,玩家死清旗
                    //   （:24942 control* 清零,frozen 同段）+ 变身瞬间 Hurt(20×难度,ByOther(5))
                    //   （:24924-24931,死因=DeathText.Petrified 碎成渣）
                    //   AddBuff(32,720t) 授予（NPC.cs:44609-44616）
  Shimmered = 77,   // 微光化(353,浸微光每 tick 刷新)：frozen 封输入+免伤+穿墙下坠——
                    //   语义由 Player.shimmering 字段承载（:11381-11419），本条目仅作
                    //   BuffState 登记（左上角图标/名称/持续时间显示）
  ManaSickness = 69, // 魔力眩晕(94,喝蓝 AddBuff 300t)：magicDamage *= 1-0.25×(剩余/300)
                   //   （Player.cs:10000-10004 + :25616；满 debuff -25% 线性恢复。
                   //   ★33 是 Weak(近战-5.1%伤/速) 勿混）
  Obstructed = 68, // 遮挡(163)：headcovered + bleed（:11421-11425）——bleed 清自然恢复
                   //   计时（:18998 同流血 30）；headcovered → ScreenObstruction 遮屏
                   //   （目标 0.95/步进 0.3，ScreenObstruction.cs:27-31）。
                   //   由星云头蟹 421 头顶吸附每 tick AddBuff(163,59)（NPC.cs:39199）
  Poisoned = 78, // 中毒(20)：lifeRegen-4 → 2 HP/s DoT（Player.cs:18795 poisoned 分支）
                 //   授予链：世纪之花毒种子 276 命中（Projectile.cs:11527-11535
                 //   专家必中 120-540t / 经典 50% 180-420t）
  // ---- 血肉墙舌头两态（Player.WOFTongue :21993-22056 授予链）----
  Horrified = 79,   // 惊恐(37)：见到墙 → gross（Player.cs:10578-10587 buffType==37 且
                    //   wofNPCIndex 在场 → gross=true + buffTime 钳 10；墙不在 → DelBuff）
  TheTongue = 80,   // 狂卷之舌(38)：tongued=true（:10589-10593 buffTime 钳 10）——
                    //   禁用道具/钩爪 + 专家 50 HP/s DoT（:18905-18910）+ 舌距 3000px/
                    //   墙抵边即死（:22036-22052）
  // ---- PvP debuff 族（Projectile.StatusPvP / Player.StatusToPlayerPvP 授予；
  //      全部在 Main.pvpBuff 白名单 Main.cs:8872-8887 内）----
  Venom = 85,         // 毒液(70)：15 HP/s（lifeRegen-30 :18791；毒液浸剂/282/355 弹）
  CursedInferno = 86, // 诅咒焰(39)：12 HP/s（lifeRegen-24 :18850 onFire2 段）
  OnFire3 = 87,       // 地狱火(323)：4 HP/s（lifeRegen-8 :18824；熔岩石/地狱火链）
  Frostburn = 88,     // 霜燃(44)：8 HP/s（lifeRegen-16 :18837；172/253 冰系弹）
  Frostburn2 = 89,    // 霜燃2(324)：8 HP/s（lifeRegen-16 :18850；冰霜盔甲引擎）
  Confused = 90,      // 困惑(31)：控制反转（:24683-24690 四键轮换,含原版 Up←Right 怪癖）
  Ichor = 91,         // 灵液(69)：防御 -15（ResetEffects statDefense -= 15）
  BrokenArmor = 92,   // 破甲(36)：防御减半（:25704 statDefense /= 2；301 类弹 PvP）
  Electrified = 93,   // 感电(144)：DoT 4 HP/s（lifeRegen-8 :18899），按住左/右移动时
                      //   额外 16 HP/s（:18900-18903 lifeRegen-32）。授予链 =
                      //   火星炮塔弹 435（2/3 必中 300t，Projectile.cs:11542-11545）/
                      //   千兆电枪矛 437（240-480t，:11550-11553）。★144 非任务面
                      //   疑似的 146（146=向日葵光环）；Cursed 是另一 debuff 23（禁用
                      //   道具），勿与 CursedInferno 39 混淆
  Invisibility = 94,  // 隐身(10)：生成环 spawnRate×1.2/maxSpawns×0.8（NPC.cs:611-615）
                      //   ——授予链 = 隐身药水 297（10800t=3min）。敌怪索敌无视未移植
                      //   （stealth 子系统登记）
  Silenced = 70,      // 沉默(35)：mana>0 物品整支不可用（Player.cs:9737 silence=true →
                      //   :51383-51385 `sItem.mana > 0 && silence` CanUse=false）。
                      //   授予链 = 红药水 678 固定 11 减益（:42271-42283，2026-08-22
                      //   补 B 批）；专家/大师时长 ×2/×2.5（BuffID.cs:28 集内）
  // ---- R10 敌弹 StatusPlayer 全量批（Projectile.StatusPlayer :11450-11722 授予链，
  //      表驱动结算 = entities/projTargets.ts statusPlayer + data/vanilla-statusplayer.json）----
  Darkness = 95,      // 黑暗(22)：blind=true（Player.cs:11318-11321）→ 光衰减 air/solid
                      //   ×0.95（LightingEngine.cs:185-189）+ GlobalBrightness 1.2→1.0
                      //   （Lighting.cs:112-115）。授予 = 恶魔镰刀 44 命中 1/3 → 900t
                      //   （Projectile.cs:11606-11608）。光衰减消费点 lightTables.ts 未接
                      //   （blackout 参数已留位、blind 无参数），登记
  Cursed = 96,        // 诅咒(23)：noItems=true + cursed=true（:11326-11330）→ 封禁道具
                      //   使用（消费 :5757/:5964/:52017，含自动连发）。授予 = 暗影焰弹
                      //   299 直中 240t（:11614-11616）。道具门消费点在 Player 使用链，
                      //   未接（本条目先作 debuff 登记/护士可清），登记
  Blackout = 97,      // 熄灯(80)：blackout=true（:11322-11325）→ 光衰减 air/solid ×0.85
                      //   （LightingEngine.cs:190-194）。授予 = 迷失之魂 293 命中
                      //   60×Next(2,7)=120-360t（:11610-11612）。lightTables 的
                      //   blackoutOn 参数当前只接 Torch God 事件标志，buff 源未并入，登记
  Webbed = 98,        // 结网(149)：webbed=true + 本帧 velocity 清零（:11458-11476）+
                      //   jumpHeight/gravity/moveSpeed/dash 归零 + noKnockback + 摘钩。
                      //   授予 = 黑隐士吐网 472 命中 Next(30,150)=30-149t（:11492-11494）。
                      //   moveSpeed=0 已接 moveSpeedMult（:11471）；velocity/重力/跳跃/
                      //   冲刺/免击退侧需 Player 物理段消费，登记
  VortexDebuff = 99,  // 星旋减益(164)：vortexDebuff=true（:11426-11429）→ gravity=0
                      //   （:24161-24164）+ 每帧 vy=vy×0.8+cos(Center.X 模 120 相位)×1
                      //   （:27854-27857，竖向正弦漂浮）。授予 = 星旋酸弹 581（专家
                      //   Next(300,540)/经典 50% Next(360,720)，:11504-11514）。
                      //   玩家物理段无载体，登记
  WitheredArmor = 101,  // 枯萎护甲(195)：defense 终值减半（Player.cs:25708-25710，破甲同式）
  Wet = 102,            // 潮湿(103)：纯视觉登记——dripping（坐骑猪鲨崽增益消费，
                       //   Player.MountFishronSpecial :3886）+ buffImmune[24/323/67]
                       //   火系免疫（:11342-11346）；lavaWet 时即刻移除（:11335-11338）。
                       //   授予链 = 爆裂泡泡 371 接触（StatusFromNPC :22239-22242，
                       //   AddBuff(103, 60×Next(3,8)) = 3-7s）；103 不在时长随难度
                       //   延展表（BuffID.cs:28）也不入存档（Main.cs buffNoSave[103]）
  WitheredWeapon = 100, // 枯萎武器(196)：witheredWeapon=true（:11442-11445）→
                      //   melee/ranged/magic/minion/rangedMult 伤害全 ×0.5
                      //   （:25712-25719）。授予 = DD2 萤火虫电击 682 直中 300t
                      //   （:11546-11548）。伤害链消费点在 Player.damageMult，登记
  // ---- 日曜套护盾层视觉（Player.cs ApplySetBonus_Solar :16240 AddBuff(170+shields,5)；
  //      纯层位标记 buff——效果在 solarShields 主状态（dashType 3 冲撞吸收 :10044-10066） ----
  SolarShield1 = 103,  // 日耀烈焰 1 层
  SolarShield2 = 104,  // 日耀烈焰 2 层
  SolarShield3 = 105,  // 日耀烈焰 3 层
  // ---- 树妖祝福（NPC 20 施放 Dryad's Ward 弹 586，AI_111 半径内玩家
  //      AddBuff(165,120) Projectile.cs:38797-38802；效果 Player.cs:9985-9991）----
  DryadsWard = 106,    // 树妖祝福(165)：lifeRegen+6(3 HP/s)/防御+8/thorns<1 时+0.5
  // ---- The Constant 饥饿链（Player.cs:11636 UpdateHungerBuffs + :11743
  //      UpdateStarvingState；BuffID 332/333/334 均在 debuff 表 Main.cs:8856-8858（1457
  //      重排 :9059-9061），且都在护士不可移除排除表 BuffID.cs:32 → 入 DEBUFFS
  //      （★BJ405 补全批：右键门 `!debuff[b]` 需要分类位;护士面经 isNurseLockedBuff
  //      过滤依旧不计价不清除,旧「不进 DEBUFFS」决策随第三消费面退役）----
  NeutralHunger = 108, // 稍饿(332)：无敌数值效果——倒计时态（18000t=5min；
                       //   remix（don't dig up）×constant 组合 28800t=8min，:11701/:11760）
  Hunger = 109,        // 饥饿(333)：防-2/全系暴击-2/全系伤-5%/近战速-5%/召唤击退-0.5/
                       //   镐速+5%（:11561-11571）；到期 → 极饿 5t + 表情 148 + Hungry 音
  Starving = 110,      // 极饿(334)：防-4/暴击-4/伤-10%/近战速-10%/召唤击退-1/镐速+15%
                       //   （:11584-11595）+ 持续掉血（:18957-18981）+ 每 120t 直接伤害
                       //   statLifeMax2/50（沙漠/雪原 ×2，:19159-19176，死因 ByOther(18)）
  // ---- 1457 新增（diff-1456-1457 批 1）----
  ManaHeat = 111,      // 魔力过热(396,1457 新 buff)：magicDamage *= manaHeat——拾取魔力星
                       //   TryApplyManaHeat(0.2,2s)（Player.cs:35348-35351）；每帧
                       //   manaHeat += latestManaPotionDamageBonus×(buffTime/duration)
                       //   （:10416-10429 线性衰减），ResetEffects 每帧清 1f（:18709）。
                       //   药水 189/500/2209 的 ApplyManaPotionManaHeat 表(0.05/0.10/0.15
                       //   ×20s)在 1457 为死代码（无调用点），不接线
  Warmth = 112,        // 温暖(124)：resistCold=true（:9963-9965）——寒冷系敌怪/敌弹
                       //   受击 ×0.7（NPC 接触 :30961-30963 / 弹幕 :13764-13766，消费在
                       //   Game.damagePlayer + projTargets.hitPlayer）。★46/47 削时（÷4/÷2）
                       //   为 1.4.5.7 新增（wiki Desktop 1.4.5.7），1456 反编译无此逻辑
                       //   （AddBuff 全链 :5066-5203 无 Warmth 分支）——本仓按 1457 保留，
                       //   已备案。授予 = 暖冬药水 2359（vi_2359 桥接 900s）
  // ---- 1457 新敌怪 debuff 家族（diff 批 2；BuffID.cs:961-971。★BJ405-D2 勘误
  //      2026-09-30：旧注「仅 StatusNPC 侧，玩家不吃——不进 BuffState.DEBUFFS」
  //      已过时——395/397/398/399/400 五件全在 Main.debuff 表（Main.cs:9004-9079
  //      写位金标,判别锁 tests/buff-rightclick-bj405 ③全表对拍）,已按 BJ405 分类
  //      归位进 BuffState.DEBUFFS（右键不可取消/护士计价/驱逐三面共用分类位）,
  //      且凡 BUFF_DEFS 在册即出 buff 栏——施加源与分类位是两个正交轴。
  //      施加源 = 1457 Projectile.cs:11203 毒液
  //      浸剂伴发 395 / :11685 弹 282-283 / :11732 弹 1127 / :11195 催化腕带
  //      catalystBand 398 / :11233 弹 1117→399 / :11237 弹 1122→400 +
  //      Player.cs:6507/6537——新弹/新饰品未移植部分登记）----
  PotentAcid = 113,        // 强酸(395,1457 新)：90 HP/s DoT（DOTTally.AddPoison(180,60)，
                           //   NPC.cs:92751——可被 398 加速；中毒式染色 R×0.65 B×0.75）
  ChlorophyteSpore = 114,  // 叶绿孢子(397,1457 新)：玩家侧 DoT 15 HP/s（PL57:19082
                           //   lifeRegen-30;NPC 侧 DOTTally 90 HP/s :92755 不同轴）+
                           //   孢子云粒子 1/60/t（PL57:26178 玩家/NPC57:92878）+
                           //   叶尘 157 4/5（:92315）
  AcceleratePoisons = 115, // 毒素加速(398,1457 新)：毒/流血/火焰族"可加速"DoT ×2
                           //   （DOTTally.SupportAcceleration NPC.cs:127-131——只加成
                           //   AddPoison/AddBloodLoss/AddFlamable，不加成裸 Add）
  BlueLightning = 116,     // 蓝闪电(399,1457 新)：纯视觉——BlueLightningSmall 粒子 1/10
  RedLightning = 117,      // 红闪电(400,1457 新)：纯视觉——RedLightningSmall 粒子 1/10
  // ---- 1457 召唤物/坐骑伴生 buff 六件（389-394,批 B 数据层登记 2026-08-22）----
  // 授予侧 = 召唤弹 AI（批 C/D）：389→弹1112 / 390→弹1113 / 393→弹1118 / 394→弹1119
  // （BuffID.CachedProjectileCounterBuffTextHandler :133-149 四对——buff 栏"余量"文案链）；
  // 391/392 = 坐骑 buff,BuffID.Sets.MountType {391→64, 392→65}（Mounts.ts BUFF_TO_MOUNT
  // 表 1457 侧待批 C 随坐骑本体接入）。贴图 Buff_389-394.png 已随素材库到位。
  PalworldMinionTrustyCattiva = 118,     // 可靠的捣蛋猫(389,1457 新)
  PalworldMinionTrustyFoxsparks = 119,   // 可靠的火绒狐(390,1457 新)
  PalworldMountTrustyChillet = 120,      // 可靠的疾旋鼬(391,1457 新,坐骑 64)
  PalworldMountTrustyChilletIgnis = 121, // 可靠的疾旋火鼬(392,1457 新,坐骑 65)
  ClayPotMinion = 122,                   // 黏土蓓蕾(393,1457 新)
  ForbiddenMinion = 123,                 // 禁戒遗迹(394,1457 新)
  // ---- 58 缺口轻项批（2026-08-22 全道具审计：46 件——宠物/光宠/坐骑骑乘态/
  //      召唤物伴生/星云增益/事件标记。原版也仅在 Draw/标记层消费（UpdateBuffs
  //      无属性 case，或效果在 pet/mount/minion 本体状态位）→ 补 BUFF_DEFS 条目后
  //      Game.ts BUFF_BY_VANILLA 反查即可施加、UI buff 栏 Buff_N.png 图标即可显示，
  //      无需消费逻辑。★枚举值 200+ 起避让既有 0-123 段（74 空位留给后续小批）。
  //      名称一律取原版 BuffID 内部名（idNames.generated BUFF_NAME_BY_ID 同源）----
  ShadowOrb = 200,             // 暗影珠(19,←115 暗影珠)：光源宠
  FairyBlue = 201,             // 仙灵(27,←425 仙灵珠；QuickBuff 三选一 27/101/102)
  BabyEater = 202,             // 吞噬怪宝宝(45,←603)：宠物
  Pygmies = 203,               // 矮人(49,←1157 矮人项链)：召唤物伴生
  BabySkeletronHead = 204,     // 骷髅王头宝宝(50,←1169)：宠物
  BabyHornet = 205,            // 黄蜂宝宝(51,←1170)：宠物
  TikiSpirit = 206,            // 提基幽魂(52,←1171)：宠物
  PetLizard = 207,             // 宠物蜥蜴(53,←1172)：宠物
  PetParrot = 208,             // 宠物鹦鹉(54,←1180)：宠物
  BabyTruffle = 209,           // 松露人宝宝(55,←1181)：宠物
  PetSapling = 210,            // 宠物树苗(56,←1182)：宠物
  Wisp = 211,                  // 妖灵(57,←1183 僵尸手指)：光宠
  BabyDinosaur = 212,          // 恐龙宝宝(61,←1242)：宠物
  BabySlime = 213,             // 史莱姆宝宝(64,←1309 史莱姆杖)：宠物
  EyeballSpring = 214,         // 弹簧眼(65,←1311)：宠物
  BabySnowman = 215,           // 雪人宝宝(66,←1312)：宠物
  PetSpider = 216,             // 宠物蜘蛛(81,←1798)：宠物
  Squashling = 217,            // 南瓜娃娃(82,←1799)：宠物
  Ravens = 218,                // 乌鸦(83,←1802 乌鸦法杖)：召唤物伴生
  BlackCat = 219,              // 黑猫(84,←1810)：宠物
  CursedSapling = 220,         // 诅咒树苗(85,←1837)：宠物
  Puppy = 221,                 // 小狗(91,←1927)：宠物
  BabyGrinch = 222,            // 格林奇宝宝(92,←1959)：宠物
  SpiderMinion = 223,          // 蜘蛛(133,←2551 蜘蛛法杖)：召唤物伴生
  TwinEyesMinion = 224,        // 双子魔眼(134,←2535 双子魔眼法杖)：召唤物伴生
  PirateMinion = 225,          // 海盗(135,←2584 海盗法杖)：召唤物伴生
  MiniMinotaur = 226,          // 福恩(136,←2587)：宠物
  MagicLantern = 227,          // 魔法灯笼(152,←3043)：光宠（敌怪高亮标记层）
  BabyFaceMonster = 228,       // 脸怪宝宝(154,←3060)：宠物
  CrimsonHeart = 229,          // 猩红之心(155,←3062)：光宠
  DeadlySphere = 230,          // 致命球(161,←3249 致命球法杖)：召唤物伴生
  NebulaUpLife1 = 231,         // 生命星云(173,←3454)：星云塔增益标记（效果在
                               //   nebulaLeveler 主状态,原版 UpdateBuffs 亦无 case）
  NebulaUpMana1 = 232,         // 魔力星云(176,←3455)：同上
  NebulaUpDmg1 = 233,          // 伤害星云(179,←3453)：同上
  StardustMinion = 234,        // 星尘细胞(182,←3474 星尘细胞法杖)：召唤物伴生
  StardustDragonMinion = 235,  // 星尘之龙(188,←3531 星尘之龙法杖)：召唤物伴生
  SuspiciousTentacle = 236,    // 可疑眼球(190,←3577 月总掉落)：光宠（自动攻击标记层）
  PetDD2Gato = 237,            // 飞翔Gato(200,←3855 DD2 宠物 Item.cs:34017-34022 共享块缺省臂)：
                               //   宠物（★SW-FX2 勘误：←3857 系审计原文沿袭 itemfunc 提取器
                               //   内层 switch 漏——3855→200/703、3856→201/702、3857→202/701）
  PetDD2Ghost = 238,           // 闪烁灯芯(201,←3856 DD2 宠物)：宠物（lightPet[201] Main.cs:9435）
  BatOfLight = 239,            // 血红蝙蝠(213,←4269 吸血鬼小蝙蝠杖)：召唤物伴生
  VampireFrog = 240,           // 吸血鬼青蛙(214,←4273 吸血鬼青蛙法杖)：召唤物伴生
  BabyBird = 241,              // 雀宝宝(216,←4281)：宠物
  StormTiger = 242,            // 沙漠虎(263,←4607 沙漠虎法杖)：召唤物伴生
  Smolstar = 243,              // 附魔飞刀(271,←4758 附魔飞刀)：召唤物伴生
  AbigailMinion = 244,         // 阿比盖尔(335,←5114 深渊之歌)：召唤物伴生
  DeadCellsMushroomBoiMinion = 245, // 蘑菇小伙伴(355,←5456 DeadCells 站掉落)：召唤物伴生
  TorchGodPotion = 247,       // 火把祝福(376,←5573 火把神药水)：驱动 TorchGodsFlavor
                              //   群系火把自动转换（Player.cs:10594-10596/:39529——
                              //   转换弹 1084 事件系统未建,登记 #157）
  FairyRed = 248,             // 红仙灵(101,←425 仙灵铃三选一)：光宠标记
  FairyGreen = 249,           // 绿仙灵(102,←425 仙灵铃三选一)：光宠标记
  // ---- 随从杖伴生 buff 泛化批（2026-08-22 补 C「24 件随从杖伴生 buff 全缺施加链」：
  //      8 件缺 DEFS 的重项——ItemCheck_ApplyPetBuffs（Player.cs:52226-52440）点名
  //      的召唤杖 buffType。枚举名一律取原版 BuffID 内部名（58 缺口批同约定）；
  //      名称/描述走原版 BuffName/BuffDescription（zh-Hans/en-US 语料在键,含 385/386
  //      帕鲁两条——1456 语料已含帕鲁文案）。图标 Buff_N.png 已在盘 ----
  HornetMinion = 250,          // 黄蜂(125,←2364 黄蜂法杖,弹373)：召唤物伴生
  ImpMinion = 251,             // 小鬼(126,←2365 小鬼法杖,弹375)：召唤物伴生
  SharknadoMinion = 252,       // 鲨鱼旋风(139,←2621 鲨旋法杖,弹407)：召唤物伴生
  UFOMinion = 253,             // UFO(140,←2749 异星法杖,弹423)：召唤物伴生
  EmpressBlade = 254,          // 泰拉棱镜(322,←5005 女皇之剑,弹946)：召唤物伴生
  FlinxMinion = 255,           // 小雪怪(325,←5069 皮皮法杖,弹951)：召唤物伴生
  PalworldMinionCattiva = 256, // 捣蛋猫(385,←5663 可靠的捣蛋猫,弹1093)：召唤物伴生
  PalworldMinionFoxsparks = 257, // 火绒狐(386,←5664 可靠的火绒狐,弹1094)：召唤物伴生
  HeartyMeal = 258,              // 丰盛大餐(336,火腿棍 5096 击杀授予 AddBuff(336,420))：lifeRegen+6=3HP/s
  // ---- 配饰审计 P0 批（2026-08-22）：冰冻护盾族（Player.cs:14348-14351）----
  TitaniumStorm = 306,         // 钛金屏障(钛金全套 on-hit,Player.cs:6931 AddBuff(306,600))：
                               //   碎片 908 环绕存续旗标（AI_175 :46151 hasTitaniumStormBuff 门）
  IceBarrier = 246,    // 冰障(62,冰冻海龟壳 1253/冰冻护盾 3997 半血挂)：半血以下 endurance+0.25
                       //   （UpdateBuffs :10127-10152；超半血 DelBuff——施加/移除门在
                       //   Player.fixedUpdate 与装备 1253/3997 半血判定联动）
  // ---- 孤儿武器 B1 波投掷物光环 buff（2026-08-30，Projectile.Kill 圈支
  //      Projectile.cs:78937-78962 → src/entities/ThrowKillFx.ts）：三件均为
  //      UpdateBuffs 无属性 case 的视觉位——119 loveStruck 标志（:10359-10362，
  //      玩家头顶爱心展示）、120 = 既有 Stinky(luck −0.25 已接)、320 drippingSparkle
  //      Slime 滴落展示（:11843-11846）。120 在 BUFF_NO_SAVE 名单，119/320 同表
  //      （Main.cs buffNoSave 名单含两 id）不落盘。图标 Buff_119/320.png 已在盘；
  //      名称/描述走原版 BuffName/BuffDescription（12 语言现成）----
  Lovestruck = 259,            // 坠入爱河(119,爱情药水弹 370 消亡 80px 圈授予)
  GelBalloonBuff = 260,        // 微光史莱姆装扮(320,微光气球弹 936 消亡 80px 圈授予)：
                               //   drenchedGlow / SpawnShimmerSparkle 展示级
  // ---- ★治理批 B6①（2026-08-31）：盾反伤害 buff 建模销账（此前「枚举未建模以
  //      字段+倒计时承载」）——vanilla 198 ParryDamageBuff：格挡窗口内接触反噬成功
  //      → Player.cs:31668 AddBuff(198,300)；消费 = 近战乘区 ×5 + ClearBuff（:44662-
  //      44664，Projectile.cs:13627 门/:13629 dmg×5 弹幕面同式）。现役授予/消费载体仍为
  //      Player.parryDamageBuff/parryDamageBuffT（Game.ts 接触反伤区推进,战斗缝合面
  //      归属另线,不在本批触碰面）——本枚举位使 buffTypeByVanilla(198)/存档名单/
  //      图标直链贯通,BUFF_NO_SAVE 已含 198(Main.cs:8896-8990 名单)。图标 =
  //      public/sprites/vanilla/Buff_198.png（terraria-assets/Images 同名源,已入盘,
  //      无需 remaster 兜底）；名称/描述走原版键（zh-Hans.Games 分片已有
  //      BuffName.ParryDamageBuff=「惊人一刻」/ BuffDescription.ParryDamageBuff=
  //      「下次近战攻击伤害提高400%」,12 语言现成,零自造键 → 不走 l10n-custom 流程）
  Parry = 307,                 // 盾反(198,ParryDamageBuff)：下次近战伤害 ×5 的建模面
  // ---- 甲虫套装 buff 族（2026-08-31 实装；BuffID.BeetleEndurance1..3=95/96/97、
  //      BeetleMight1..3=98/99/100——内部名带档位后缀）。图标族:noTimeDisplay[95-100]
  //      (Main.cs:9232-9237)恒无字、buffNoSave(:9148-9152)不落盘由 BeetleMeter 每帧重算。
  //      档位编码:95-97 ↔ n=vanilla−94 球(壳族,:10433);98-100 ↔ n=vanilla−97 球
  //      (猛攻族,:10498)。维持=壳族效果循环直写 buffTime=5(:10432)+猛攻每帧
  //      AddBuff(...,5)(:16663-16675)→ 统一 5t=5/60 秒重钉 ----
  BeetleEndurance1 = 308,      // 甲虫耐力一档(95):减伤 15%（Hurt :38610 0.15×orbs 消费）
  BeetleEndurance2 = 309,      // 甲虫耐力二档(96):减伤 30%
  BeetleEndurance3 = 310,      // 甲虫耐力三档(97):减伤 45%
  BeetleMight1 = 311,          // 甲虫力量一档(98):近战伤/速 +10%（:10518-10520 直加）
  BeetleMight2 = 312,          // 甲虫力量二档(99):近战伤/速 +20%
  BeetleMight3 = 313,          // 甲虫力量三档(100):近战伤/速 +30%
  // ---- 环境光环五缺口补图（SceneMetrics 十族 :25723-25764 的后五位;效果侧已实装的
  //      四族只补 buff 图标,沙暴 194 风推效果另接移动积分）----
  WaterCandle = 314,           // 水蜡烛(86):敌刷率×0.75/上限×1.5 的镜像图标（效果在 VanillaSpawner）
  HeartLamp = 315,             // 心灯(89):生命再生 +2（1HP/s 效果在 lanternHeal 旁路）
  MonsterBanner = 316,         // 旗帜(147):对同型敌增伤/减伤（效果三链已在 BannerStrength 采样）
  WindPushed = 317,            // 强风(194):windPushed 风推（:11923-11926/:19922-19946）
  ShadowCandle = 318,          // 暗影蜡烛(350):刷怪旗覆写镜像（效果在 VanillaSpawner）
  // ---- 叶绿水晶叶套装（台账 L3 清偿批,2026-08-31）——BuffID.LeafCrystal=60：
  //      四头变体三件套（近战1001/召唤5524/头盔1002·头饰1003 × 胸1004×腿1005,
  //      ArmorSetBonuses.cs:128-146）每拍 Effect=AddBuff(60,5)+setChlorophyte;
  //      !setChlorophyte → ClearBuff(60)（Player.cs:16436/:16440）。buff 分支效果=
  //      crystalLeaf=true+buffTime 钉 18000(:11749-11752),消费位=锚体 226 存续门
  //      （Projectile.cs:28190 !crystalLeaf→Kill）。无免疫族/无难度缩放表项
  LeafCrystal = 319,
  // ---- 神圣套幻影闪避链（终零波 Player.ts 域批,2026-09-01）——BuffID.ShadowDodge=59：
  //      来源唯一 = 神圣/神圣召唤套装 onHitDodge → OnHit AddBuff(59,1800)
  //      （Player.cs:6937-6940,ArmorSetBonuses.cs:228-236）。效果循环直判
  //      shadowDodge=true（:10159-10163）→ Hurt 第四闪避支（:38516 ShadowDodge()
  //      :38306-38324 全桶满填+DelBuff+timer=1800 重整）
  ShadowDodge = 320,           // 幻影闪避(59)：神圣套 on-hit 授予的闪避旗标窗
  // BuffID.RapidHealing=58：帕拉钯全套 on-hit（OnHit :6942-6945 AddBuff(58,300)）；
  // 效果循环 palladiumRegen=true（:10169-10172）→ UpdateLifeRegen lifeRegenCount+=4/t
  // （:19385-19387——+2HP/s 额外再生,乘区外 flat）
  RapidHealing = 321,          // 快速再生(58)：帕拉钯套 on-hit 再生加速窗
  // ---- 玩家侧未建档 debuff 两条（终零波 护士经济簇批,2026-09-01）----
  // BuffID.Dazed=160（眩晕；Main.debuff[160]=true Main.cs:9005）。原版施加面 =
  // 另一玩家的美杜莎之首 537/弹幕 StatusPlayer 通用支（proj.buffType=160 →
  // player.AddBuff,Projectile.cs:12412）=PvP-only 生产位;NPC.cs 全文无对玩家
  // AddBuff(160)。效果=移动 ×1/3(:26138-26140)+跳高 ÷5/跳速 ÷2(:19762-19766,
  // UpdateJumpHeight)。Ogre AI 批落地敌侧后经通用 StatusPlayer 链自动上人。
  Dazed = 322,                 // 眩晕(160)：美杜莎之首 PvP 命中族
  OgreSpit = 323,              // 分泌物(197)：DD2 巨魔喷吐团 Death 近身施加(:74093)
  Merfolk = 324,               // 人鱼(34)：纯指示 buff——Player.AddBuff(34,2) 每帧续钉
                               //   （:25780），效果面全在 merman 字段（呼吸/物理/accFlipper）
  // ---- SW-FX2（2026-09-09）58 缺口重项收尾 + vanilla-pets 表对拍缺口 ----
  // 重 4 件 = 40/41/42/127：item-audit-2026-08-22「重 12 件另批」清单里最后未落批的
  // 残余（125/126/139/140/322/325/385/386 已随随从杖伴生泛化批、376 已随 TorchGodPotion
  // 批落位）。施加链 = ItemCheck_ApplyPetBuffs（1457 Player.cs:53729-53896）逐件
  // AddBuff(buffType, 3600)；消费面 = UpdatePet/UpdatePetLight（:17414-17445）装备槽
  // 每帧补挂（Game.updatePetSlot 同批接线）。
  // 202 = 审计四键①：itemfunc 3857 buffType 内层 switch（Item.cs:34018-34021）已修
  // 202 后 DEFS 缺收口位 → BUFF_BY_VANILLA.get(202) 反查落空。
  // 217/219/259/261/268 = vanilla-pets.json 在仓五件（4365/4425/4604/4551/4737）伴生
  // buff——UpdatePet 面接通后反查落空 = 装备宠物无图标，同债同修。
  // 原版 Main.cs vanityPet/lightPet 行号逐条锚定（buffNoSave 全名单不含以下任何 id）
  PetBunny = 325,        // 宠物兔兔(40,←603 胡萝卜：53731-53733 收藏版门 runningCollectorsEdition)：
                         //   vanityPet[40]（Main.cs:9353）
  BabyPenguin = 326,     // 企鹅宝宝(41,←669 鱼：53734-53736)：vanityPet[41]（Main.cs:9354）
  PetTurtle = 327,       // 宠物海龟(42,←753 海草：53813-53815)：vanityPet[42]（Main.cs:9355）
  ZephyrFish = 328,      // 和风鱼(127,←2420 卷心菜：53894-53896)：vanityPet[127]（Main.cs:9374）；
                         //   ★唯一不在 Main.buffNoTimeDisplay 表内的宠物 buff（40/41/42 在）
  PetDD2Dragon = 329,    // Hoardagron(202,←3857 龙蛋 Item.cs:34018-34021 内层 switch)：
                         //   vanityPet[202]（Main.cs:9377）
  UpbeatStar = 330,      // 埃斯蒂(217,←4365 CelestialWand)：vanityPet[217]（Main.cs:9381）
  SharkPup = 331,        // 小鲨鱼(219,←4425 SharkBait)：vanityPet[219]（Main.cs:9380）
  FennecFox = 332,       // 耳廓狐(259,←4604 ExoticEasternChewToy)：vanityPet[259]（Main.cs:9383）
  BabyImp = 333,         // 小鬼宝宝(261,←4551 HellCake)：vanityPet[261]（Main.cs:9385）
  ShadowMimic = 334,     // 暗影宝箱怪(268,←4737 OrnateShadowKey)：vanityPet[268]（Main.cs:9390）
  // ---- SW-FX2 续：vanilla-pets.json 全表反查零落空收尾（表内其余 25 行的伴生 buff;
  //      同为纯注册位,物品面多数未入仓——先行入档使「新宠物件入仓即图标可达」,
  //      表外仅余 1.4.5 boss 宠 284-304（无 pets 行,itemfunc 侧,剩债登记））----
  SugarGlider = 335,         // 蜜袋鼯(218,←4366)
  LilHarpy = 336,            // 小鸟妖(258,←4603)
  GlitteryButterfly = 337,   // 闪光蝴蝶(260,←4605)
  BabyRedPanda = 338,        // 小熊猫宝宝(262,←4550)
  Plantero = 339,            // 微型世纪之花(264,←4701)
  DynamiteKitten = 340,      // 雷管小猫(266,←4735)
  BabyWerewolf = 341,        // 狼人宝宝(267,←4736)
  VoltBunny = 342,           // 伏特兔(274,←4777)
  QueenSlimePet = 343,       // 史莱姆公主(317,←4960)
  BerniePet = 344,           // 伯尼(327,←5088)
  GlommerPet = 345,          // 咕噜咪(328,←5089)
  DeerclopsPet = 346,        // 小独眼巨鹿(329,←5090)
  PigPet = 347,              // 猪(330,←5091)
  ChesterPet = 348,          // 切斯特(331,←5098)
  DualSlimePet = 349,        // 皇家史莱姆(341,←5131)
  JunimoPet = 350,           // 祝尼魔(345,←5276)
  BlueChickenPet = 351,      // 蓝鸡(349,←5297)
  Spiffo = 352,              // Spiffo(351,←5332)
  CavelingGardener = 353,    // 洞穴园丁(352,←5333)
  DirtiestBlock = 354,       // 最土的块(354,←5400)
  DeadCellsSwarmBiter = 355, // 虫群啃噬者(356,←5466)
  Pufferfish = 356,          // 河豚(371,←5513)
  AxeFairyPet = 357,         // 塞纳克斯(372,←5517)
  BoulderPet = 358,          // 友好巨石(373,←5523)
  RainbowBoulderPet = 359,   // 友好彩虹巨石(382,←5654)
  // ---- SW-FX48（2026-09-12）1.4.5 boss 宠 21 件（FX2 豁免剩债收口）----
  // 物品 4797-4817（Item.cs:39417-39440 共享块 DefaultToVanitypet(881+type-4797,
  // 284+type-4797),1456 :39399-39422/1458 :39417-39438 同值）→ buff 284-304。
  // 施加链 = UpdatePet/UpdatePetLight（Player.cs:17414-17445）装备槽 60s 补挂
  // （Game.updatePetSlot）。vanityPet[284..293,295..297,300..304]（Main.cs:9392-9409）
  // / lightPet[294,298,299]（Main.cs:9436-9438——石巨人/光之女皇/南瓜王三只光宠）。
  // 枚举名一律 = 原版 BuffID 内部名（idNames.generated BUFF_NAME_BY_ID 同源）→
  // BuffName/BuffDescription 双键走原版 l10n 现成语料,零 l10n-custom 新增。
  KingSlimePet = 360,        // 史莱姆王子(284,←4797 Royal Delight)：vanityPet[284]（Main.cs:9392）
  EyeOfCthulhuPet = 361,     // 可疑眼睛(285,←4798)：vanityPet[285]（Main.cs:9393）
  EaterOfWorldsPet = 362,    // 蠕虫吞噬怪(286,←4799)：vanityPet[286]（Main.cs:9394）
  BrainOfCthulhuPet = 363,   // 蜘蛛脑(287,←4800)：vanityPet[287]（Main.cs:9395）
  SkeletronPet = 364,        // 小骷髅王(288,←4801)：vanityPet[288]（Main.cs:9396）
  QueenBeePet = 365,         // 宝贝蜜蜂(289,←4802)：vanityPet[289]（Main.cs:9397）
  DestroyerPet = 366,        // 微型毁灭者(290,←4803)：vanityPet[290]（Main.cs:9398）
  TwinsPet = 367,            // 激光眼和魔焰眼(291,←4804)：vanityPet[291]（Main.cs:9399）
  SkeletronPrimePet = 368,   // 小机械骷髅王(292,←4805)：vanityPet[292]（Main.cs:9400）
  PlanteraPet = 369,         // 世纪之花幼苗(293,←4806)：vanityPet[293]（Main.cs:9401）
  GolemPet = 370,            // 玩具石巨人(294,←4807)：lightPet[294]（Main.cs:9436）＝光宠
  DukeFishronPet = 371,      // 小猪龙鱼(295,←4808)：vanityPet[295]（Main.cs:9402）
  LunaticCultistPet = 372,   // 小幻影龙(296,←4809)：vanityPet[296]（Main.cs:9403）
  MoonLordPet = 373,         // 月精灵(297,←4810)：vanityPet[297]（Main.cs:9404）
  FairyQueenPet = 374,       // 仙灵公主(298,←4811)：lightPet[298]（Main.cs:9437）＝光宠
  PumpkingPet = 375,         // 杰克南瓜灯(299,←4812)：lightPet[299]（Main.cs:9438）＝光宠
  EverscreamPet = 376,       // 常绿尖叫怪树苗(300,←4813)：vanityPet[300]（Main.cs:9405）
  IceQueenPet = 377,         // 冰雪女王(301,←4814)：vanityPet[301]（Main.cs:9406）
  MartianPet = 378,          // 异星滑板小子(302,←4815)：vanityPet[302]（Main.cs:9407）
  DD2OgrePet = 379,          // 食人魔宝宝(303,←4816)：vanityPet[303]（Main.cs:9408）
  DD2BetsyPet = 380,         // 小双足翼龙(304,←4817)：vanityPet[304]（Main.cs:9409）
  // ★BJ250（2026-09-21）：Dead Cells 药水站 tile 699 右键授予（Player.cs:32857-32862
  //  AddBuff(366, 108000) + Item179）。原版纯标记 buff（全仓零消费——唯一相关机制
  //  deadCellsPotionStation 场景倍率 :5422-5423 ×1.2 走独立字段,不读此 buff）。
  //  枚举值避开原版 366（已被 DestroyerPet 占）按序续编；图标 Buff_366.png 在库。
  DeadCellsPotionStation = 381,
  // ★BJ357 变身坐骑伴生 buff（Mount.cs Initialize：55 buff=374 / 56 buff=377 /
  //  61 buff=384,SetMount :6291 AddBuff(_data.buff,3600) + Player.cs:9968-9971
  //  每 tick buffTime=10 重钉）。Main.cs:9344-9352 对全部 MountType buff 置
  //  buffNoTimeDisplay+buffNoSave（图标无倒计时字、不入档）
  RatMount = 382,     // 大鼠本性(374)：骑乘 55 变身鼠
  BatMount = 383,     // 蝙蝠诅咒(377)：骑乘 56 变身蝠
  PixieMount = 384,   // 法埃的形态(384)：骑乘 61 变身妖精——「附魔精灵尘」5662 召唤物
  // ★BJ739 B11（2026-10-31）：Slimed(137) 玩家侧建模——史莱姆枪 406 对射手外
  //  玩家 180t（Projectile.cs:29441-29498 flag25 玩家臂,非 PvP 门）/鞭 1104 对
  //  NPC（:11257）。效果 = drippingSlime 六火族 DoT 翻倍（UpdateLifeRegen
  //  :19102-19179,SLIME_DOUBLED_DOTS）+ 敌侧既有 slimedT 染色族。Main.debuff
  //  [137]=true（Main.cs:9040）→ DEBUFFS 在册;137 在 Main.buffNoSave（存档
  //  不落盘）与 PVP_BUFF_WHITELIST。★产源净债（BJ739 D-①）：本仓 victim-settles
  //  架构下 shooter→远端玩家的 buff 传播无通道（msg50 未实现+代理无 buff 同步）,
  //  SlimeGlob 玩家臂暂缓——消费面先就位（mods/未来产源/测试可达）
  Slimed = 385,
}

/** BuffID.Sets.BuffTimeIsExtendedWithGameDifficulty（BuffID.cs:28——专家×2/大师×2.5 时长） */
const BUFF_TIME_EXTENDED_BY_DEAD_CELLS = new Set([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,104,105,106,107,108,109,110,111,112,113,114,115,116,117,121,122,123,124,257,343]);

/** ★BJ739 B01/B02（2026-10-31）：BuffID.Sets.TimeLeftDoesNotDecrease（1457
 *  Terraria.ID/BuffID.cs:22 `Factory.CreateBoolSet(28, 334, 29, 159, 150, 93,
 *  348, 366)`——1458 diff 零差异）。成员 = 工位六站 {29 水晶球预见/159 磨刀石/
 *  150 附魔台/93 弹药箱/348 战争桌/366 炼金药瓶} + 334 极饿 + 28 狼人：
 *  UpdateBuffs 递减循环（1457 Player.cs:9958 `whoAmI==Main.myPlayer &&
 *  !TimeLeftDoesNotDecrease[buffType[j]]` 才 buffTime--）对表内 id 不倒数——
 *  108000t 授予后保持到死亡（UpdateDead 清非持久）/右键取消/昼夜门（狼人白天
 *  DelBuff :11993-11996）/食物重置（334 走 TryToResetHungerToNeutral）。
 *  旧通用递减 = 工位 1800s 自删（B01）+ 极饿 5t 自灭再被 updateStarvingState
 *  重授 332 的循环重启（B02，issue#29）。 */
const TIME_LEFT_DOES_NOT_DECREASE = new Set<number>([28, 334, 29, 159, 150, 93, 348, 366]);

/** ★BJ739 B06：Main.meleeBuff 表（1457 Main.cs:9100-9107 逐字面量）——八武器浸剂
 *  {71 毒液/73 诅咒焰/74 烈火/75 黄金/76 灵液/77 纳米/78 派对/79 剧毒}。同刻仅容
 *  一种在栏（AddBuff_RemoveOldMeleeBuffsOfMatchingType Player.cs:5352-5365）。
 *  72 Midas（敌 debuff）不在表内——勿混。 */
const MELEE_BUFF_VANILLA = new Set<number>([71, 73, 74, 75, 76, 77, 78, 79]);

const BUFF_TIME_EXTENDED_BY_DIFFICULTY = new Set([20, 22, 23, 24, 323, 30, 31, 32, 33, 35, 36, 39, 44, 324, 46, 47, 69, 70, 80]);

/** Main.buffNoTimeDisplay 静态表（1457 Main.cs:9213-9336，共 124 项，原版 id）：
 *  TryGetBuffTime(:44029-44040) 拒答 → DrawBuffIcon(:44058) 不画剩余时长。
 *  含工位五件套（预见 29/磨刀石 159/魅惑 150/弹药箱 93/战争桌 348——磨刀石等
 *  右键授予 108000t 后全程无倒计时字样）、狼人 28、甲虫 95-100、宠物/随从族等。
 *  ★环境光环十族（87/146/157/158/215/86/89/147/194/350）【不在本表】——它们的
 *  唯一隐字防线=每帧 2t 重钉+>2t 门（成对设计，Game.ts 场景光环块）；曾误注
 *  "表内双保险"（红队 A3），后人勿据该误注往表里补光环 id。坐骑族另经
 *  MountType 循环(:9345-9352)全标——本仓坐骑不进 buff 栏，故不含 */
export const BUFF_NO_TIME_DISPLAY = new Set<number>([19, 27, 28, 29, 34, 37, 38, 40, 41, 42, 43, 45, 49, 60, 62, 64, 68, 81, 82, 83, 93, 95, 96, 97, 98, 99, 100, 101, 102, 125, 126, 133, 134, 135, 136, 139, 140, 150, 159, 161, 163, 165, 170, 171, 172, 182, 186, 187, 188, 199, 200, 201, 202, 213, 214, 216, 217, 219, 258, 259, 260, 261, 262, 263, 264, 266, 267, 268, 271, 274, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 312, 317, 322, 325, 327, 328, 329, 330, 331, 334, 335, 341, 345, 348, 349, 351, 352, 353, 354, 355, 356, 365, 366, 371, 372, 373,
 374, 377, 384, 391, 392,   // ★BJ357 变身坐骑伴生 + ★BJ405-D1 补收可靠疾旋鼬族
                            //  （Main.cs:9342-9349 循环段对【全部】MountType buff 置
                            //  buffNoTimeDisplay——坐骑图标无时长字;五件=本仓唯一
                            //  入 BuffState 的坐骑伴生,余 61 件不出栏无消费面）
 382, 385, 386, 389, 390, 393, 394]);

/** Main.persistentBuff 持久表（★X4-债3 2026-09-29 亲读 1457 Main.cs:9337-9344——
 *  全表仅此 8 项置真，其余 600+ 项默认 false）：武器浸剂八族 {71 Venom/73 CursedFlames/
 *  74 Fire/75 Gold/76 Ichor/77 Nanites/78 Confetti/79 Poison}。72 Midas 【不】在内
 *  ——死亡清 buff 时黄金浸剂不留（BuffID.cs:295-311 实名核对）。唯一消费点 =
 *  UpdateDead 清 buff 门（Player.cs:17113） */
export const PERSISTENT_BUFFS = new Set<number>([71, 73, 74, 75, 76, 77, 78, 79]);

/** BuffID.Sets.BuffTextHandlers（1457 Terraria.ID/BuffID.cs:36-145，共 28 项）：
 *  随从族 buff 图标下方的文字不是时长而是**在册随从计数**——CachedProjectileCounterBuffTextHandler
 *  (Terraria.DataStructures) 对 ownedProjectileCounts 按弹型求和，>0 → `"x"+n`（如"x3"），
 *  =0 → null 回落时长路径（随即被 buffNoTimeDisplay 表拒答 → 无字）。键=原版 buff id，
 *  值=原版 projectile id 集。表内 28 buff 全部同时也在 BUFF_NO_TIME_DISPLAY 中 */
export const BUFF_TEXT_PROJECTILE_COUNTER: Record<number, number[]> = {
  64: [266], 125: [373], 49: [191, 192, 193, 194], 83: [317], 126: [375], 134: [387],
  133: [390, 391, 392], 135: [393, 394, 395], 139: [407], 140: [423], 161: [533],
  182: [613], 188: [626], 213: [755], 214: [758], 216: [759], 263: [831], 271: [864],
  322: [946], 325: [951], 335: [970], 355: [1022], 385: [1093], 386: [1094],
  389: [1112], 390: [1113], 393: [1118], 394: [1119],
};

/** 爆裂泡泡 371 接触授予的 Wet 时长（秒）（Player.cs:22239-22242 StatusFromNPC：
 *  `AddBuff(103, 60 * Main.rand.Next(3, 8))`——Next 上界不含 → 60×{3..7}t
 *  = 3-7 秒。★非"180+rand(300)"——以源码为准） */
export function wetFromBubbleContact(rand: () => number = Math.random): number {
  return 3 + Math.floor(rand() * 5);
}

export const BUFF_DEFS: Record<BuffType, { vanillaBuff: number; descKey: string; fallbackName: string }> = {
  [BuffType.Rabies]: { vanillaBuff: 148, descKey: 'BuffDescription.Rabies', fallbackName: '狂犬病' },
  [BuffType.TitaniumStorm]: { vanillaBuff: 306, descKey: 'BuffDescription.TitaniumStorm', fallbackName: '钛金屏障' },
  [BuffType.Campfire]: { vanillaBuff: 87, descKey: 'Mods.SandboxWorld.Buff.Campfire.Desc', fallbackName: '篝火' },
  [BuffType.Agility]: { vanillaBuff: 3, descKey: 'Mods.SandboxWorld.Buff.Agility.Desc', fallbackName: '敏捷' },
  [BuffType.Ironskin]: { vanillaBuff: 5, descKey: 'Mods.SandboxWorld.Buff.Ironskin.Desc', fallbackName: '铁皮' },
  [BuffType.Resistance]: { vanillaBuff: 21, descKey: 'Mods.SandboxWorld.Buff.Resistance.Desc', fallbackName: '耐药性' },
  [BuffType.Thorns]: { vanillaBuff: 14, descKey: 'Mods.SandboxWorld.Buff.Thorns.Desc', fallbackName: '荆棘' },
  [BuffType.Regen]: { vanillaBuff: 2, descKey: 'Mods.SandboxWorld.Buff.Regen.Desc', fallbackName: '恢复' },
  // 蜂蜜描述直接用原版 BuffDescription.Honey（12 语言现成，语义一致）
  [BuffType.Honey]: { vanillaBuff: 48, descKey: 'BuffDescription.Honey', fallbackName: '蜂蜜' },
  // 环境伤害 debuff:名称走原版 BuffName,描述用自有键
  [BuffType.OnFire]: { vanillaBuff: 24, descKey: 'Mods.SandboxWorld.Buff.OnFire.Desc', fallbackName: '着火！' },
  [BuffType.Burning]: { vanillaBuff: 67, descKey: 'Mods.SandboxWorld.Buff.Burning.Desc', fallbackName: '燃烧！' },
  [BuffType.Bleeding]: { vanillaBuff: 30, descKey: 'Mods.SandboxWorld.Buff.Bleeding.Desc', fallbackName: '流血' },
  [BuffType.Suffocation]: { vanillaBuff: 68, descKey: 'Mods.SandboxWorld.Buff.Suffocation.Desc', fallbackName: '窒息' },
  // 药水族
  [BuffType.ObsidianSkin]: { vanillaBuff: 1, descKey: 'Mods.SandboxWorld.Buff.ObsidianSkin.Desc', fallbackName: '黑曜石皮' },
  [BuffType.Gills]: { vanillaBuff: 4, descKey: 'Mods.SandboxWorld.Buff.Gills.Desc', fallbackName: '鱼鳃' },
  [BuffType.ManaRegen]: { vanillaBuff: 6, descKey: 'Mods.SandboxWorld.Buff.ManaRegen.Desc', fallbackName: '魔力再生' },
  [BuffType.MagicPower]: { vanillaBuff: 7, descKey: 'Mods.SandboxWorld.Buff.MagicPower.Desc', fallbackName: '魔法力量' },
  [BuffType.Featherfall]: { vanillaBuff: 8, descKey: 'Mods.SandboxWorld.Buff.Featherfall.Desc', fallbackName: '羽落' },
  [BuffType.WaterWalking]: { vanillaBuff: 15, descKey: 'Mods.SandboxWorld.Buff.WaterWalking.Desc', fallbackName: '水上行走' },
  [BuffType.Archery]: { vanillaBuff: 16, descKey: 'Mods.SandboxWorld.Buff.Archery.Desc', fallbackName: '射手' },
  [BuffType.NightOwl]: { vanillaBuff: 12, descKey: 'Mods.SandboxWorld.Buff.NightOwl.Desc', fallbackName: '夜枭' },
  [BuffType.Sunflower]: { vanillaBuff: 146, descKey: 'Mods.SandboxWorld.Buff.Sunflower.Desc', fallbackName: '向日葵' },
  [BuffType.CatBast]: { vanillaBuff: 215, descKey: 'Mods.SandboxWorld.Buff.CatBast.Desc', fallbackName: '猫堡垒' },
  [BuffType.StarInBottle]: { vanillaBuff: 158, descKey: 'Mods.SandboxWorld.Buff.StarInBottle.Desc', fallbackName: '瓶中星' },
  [BuffType.PeaceCandle]: { vanillaBuff: 157, descKey: 'Mods.SandboxWorld.Buff.PeaceCandle.Desc', fallbackName: '和平蜡烛' },
  [BuffType.Clairvoyance]: { vanillaBuff: 29, descKey: 'Mods.SandboxWorld.Buff.Clairvoyance.Desc', fallbackName: '预见' },
  [BuffType.Sharpened]: { vanillaBuff: 159, descKey: 'Mods.SandboxWorld.Buff.Sharpened.Desc', fallbackName: '磨刀石' },
  [BuffType.AmmoBox]: { vanillaBuff: 93, descKey: 'Mods.SandboxWorld.Buff.AmmoBox.Desc', fallbackName: '弹药箱' },
  [BuffType.Bewitched]: { vanillaBuff: 150, descKey: 'Mods.SandboxWorld.Buff.Bewitched.Desc', fallbackName: '魅惑' },
  [BuffType.WarTable]: { vanillaBuff: 348, descKey: 'Mods.SandboxWorld.Buff.WarTable.Desc', fallbackName: '战争桌' },
  [BuffType.SoulDrain]: { vanillaBuff: 151, descKey: 'Mods.SandboxWorld.Buff.SoulDrain.Desc', fallbackName: '吸魂' },
  [BuffType.SugarRush]: { vanillaBuff: 192, descKey: 'Mods.SandboxWorld.Buff.SugarRush.Desc', fallbackName: '糖分冲刺' },
  // ★BJ250：药水站 buff（vanillaBuff 366，图标 Buff_366.png 在库；原版 l10n 语料
  //  缺 BuffName.366 → 走 fallbackName「炼金药瓶」= tile 699 官方名 Alchemy Flask 直译；
  //  原版无机械效果，desc 标记纯增益来源）
  [BuffType.DeadCellsPotionStation]: { vanillaBuff: 366, descKey: 'Mods.SandboxWorld.Buff.DeadCellsPotionStation.Desc', fallbackName: '炼金药瓶' },
  // ★BJ357 变身坐骑伴生 buff（374/377/384）——名称/描述走原版 l10n 键
  //  （BuffName.RatMount=大鼠本性/BatMount=蝙蝠诅咒/PixieMount=法埃的形态）
  [BuffType.RatMount]: { vanillaBuff: 374, descKey: 'BuffDescription.RatMount', fallbackName: '大鼠本性' },
  [BuffType.BatMount]: { vanillaBuff: 377, descKey: 'BuffDescription.BatMount', fallbackName: '蝙蝠诅咒' },
  [BuffType.PixieMount]: { vanillaBuff: 384, descKey: 'BuffDescription.PixieMount', fallbackName: '法埃的形态' },
  [BuffType.Battle]: { vanillaBuff: 13, descKey: 'Mods.SandboxWorld.Buff.Battle.Desc', fallbackName: '战斗' },
  [BuffType.Calming]: { vanillaBuff: 106, descKey: 'Mods.SandboxWorld.Buff.Calming.Desc', fallbackName: '镇静' },
  [BuffType.Mining]: { vanillaBuff: 104, descKey: 'Mods.SandboxWorld.Buff.Mining.Desc', fallbackName: '挖矿' },
  [BuffType.Builder]: { vanillaBuff: 107, descKey: 'Mods.SandboxWorld.Buff.Builder.Desc', fallbackName: '建筑工' },
  [BuffType.Heartreach]: { vanillaBuff: 105, descKey: 'Mods.SandboxWorld.Buff.Heartreach.Desc', fallbackName: '拾心' },
  [BuffType.FlipperPotion]: { vanillaBuff: 109, descKey: 'Mods.SandboxWorld.Buff.FlipperPotion.Desc', fallbackName: '脚蹼' },
  [BuffType.Merfolk]: { vanillaBuff: 34, descKey: 'Mods.SandboxWorld.Buff.Merfolk.Desc', fallbackName: '人鱼' },
  [BuffType.Titan]: { vanillaBuff: 108, descKey: 'Mods.SandboxWorld.Buff.Titan.Desc', fallbackName: '泰坦' },
  [BuffType.AmmoReservation]: { vanillaBuff: 112, descKey: 'Mods.SandboxWorld.Buff.AmmoReservation.Desc', fallbackName: '弹药储备' },
  [BuffType.Lifeforce]: { vanillaBuff: 113, descKey: 'Mods.SandboxWorld.Buff.Lifeforce.Desc', fallbackName: '生命力' },
  [BuffType.Endurance]: { vanillaBuff: 114, descKey: 'Mods.SandboxWorld.Buff.Endurance.Desc', fallbackName: '耐久' },
  [BuffType.Wrath]: { vanillaBuff: 115, descKey: 'Mods.SandboxWorld.Buff.Wrath.Desc', fallbackName: '怒气' },  // 原版 Rage 药水
  [BuffType.Rage]: { vanillaBuff: 117, descKey: 'Mods.SandboxWorld.Buff.Rage.Desc', fallbackName: '暴怒' },  // 原版 Wrath 药水
  [BuffType.Tipsy]: { vanillaBuff: 25, descKey: 'Mods.SandboxWorld.Buff.Tipsy.Desc', fallbackName: '醉酒' },
  [BuffType.ManaSickness]: { vanillaBuff: 94, descKey: 'Mods.SandboxWorld.Buff.ManaSickness.Desc', fallbackName: '魔力眩晕' },
  [BuffType.Werewolf]: { vanillaBuff: 28, descKey: 'Mods.SandboxWorld.Buff.Werewolf.Desc', fallbackName: '狼人' },
  [BuffType.BrainOfConfusionBuff]: { vanillaBuff: 321, descKey: 'Mods.SandboxWorld.Buff.BrainOfConfusionBuff.Desc', fallbackName: '混乱之脑' },
  [BuffType.Weak]: { vanillaBuff: 33, descKey: 'Mods.SandboxWorld.Buff.Weak.Desc', fallbackName: '虚弱' },
  [BuffType.Shimmered]: { vanillaBuff: 353, descKey: 'Mods.SandboxWorld.Buff.Shimmered.Desc', fallbackName: '微光化' },
  [BuffType.ImbueVenom]: { vanillaBuff: 71, descKey: 'Mods.SandboxWorld.Buff.ImbueVenom.Desc', fallbackName: '武器浸剂：毒液' },
  [BuffType.ImbueCursed]: { vanillaBuff: 73, descKey: 'Mods.SandboxWorld.Buff.ImbueCursed.Desc', fallbackName: '武器浸剂：诅咒焰' },
  [BuffType.ImbueFire]: { vanillaBuff: 74, descKey: 'Mods.SandboxWorld.Buff.ImbueFire.Desc', fallbackName: '武器浸剂：烈火' },
  [BuffType.ImbueGold]: { vanillaBuff: 75, descKey: 'Mods.SandboxWorld.Buff.ImbueGold.Desc', fallbackName: '武器浸剂：黄金' },
  [BuffType.ImbueIchor]: { vanillaBuff: 76, descKey: 'Mods.SandboxWorld.Buff.ImbueIchor.Desc', fallbackName: '武器浸剂：灵液' },
  [BuffType.ImbueNano]: { vanillaBuff: 77, descKey: 'Mods.SandboxWorld.Buff.ImbueNano.Desc', fallbackName: '武器浸剂：纳米' },
  [BuffType.ImbueParty]: { vanillaBuff: 78, descKey: 'Mods.SandboxWorld.Buff.ImbueParty.Desc', fallbackName: '武器浸剂：派对' },
  [BuffType.ImbuePoison]: { vanillaBuff: 79, descKey: 'Mods.SandboxWorld.Buff.ImbuePoison.Desc', fallbackName: '武器浸剂：剧毒' },
  [BuffType.Inferno]: { vanillaBuff: 116, descKey: 'Mods.SandboxWorld.Buff.Inferno.Desc', fallbackName: '狱火' },
  [BuffType.Shine]: { vanillaBuff: 11, descKey: 'Mods.SandboxWorld.Buff.Shine.Desc', fallbackName: '光芒' },
  [BuffType.Spelunker]: { vanillaBuff: 9, descKey: 'Mods.SandboxWorld.Buff.Spelunker.Desc', fallbackName: '洞穴探险' },
  [BuffType.Dangersense]: { vanillaBuff: 111, descKey: 'Mods.SandboxWorld.Buff.Dangersense.Desc', fallbackName: '危险感' },
  [BuffType.Hunter]: { vanillaBuff: 17, descKey: 'Mods.SandboxWorld.Buff.Hunter.Desc', fallbackName: '狩猎' },
  [BuffType.BiomeSight]: { vanillaBuff: 343, descKey: 'Mods.SandboxWorld.Buff.BiomeSight.Desc', fallbackName: '生物群系视觉' },
  [BuffType.Luck]: { vanillaBuff: 257, descKey: 'Mods.SandboxWorld.Buff.Luck.Desc', fallbackName: '幸运' },
  [BuffType.Summoning]: { vanillaBuff: 110, descKey: 'Mods.SandboxWorld.Buff.Summoning.Desc', fallbackName: '召唤' },
  [BuffType.Fishing]: { vanillaBuff: 121, descKey: 'Mods.SandboxWorld.Buff.Fishing.Desc', fallbackName: '钓鱼' },
  [BuffType.Sonar]: { vanillaBuff: 122, descKey: 'Mods.SandboxWorld.Buff.Sonar.Desc', fallbackName: '声呐' },
  [BuffType.Crate]: { vanillaBuff: 123, descKey: 'Mods.SandboxWorld.Buff.Crate.Desc', fallbackName: '宝匣' },
  [BuffType.Gravitation]: { vanillaBuff: 18, descKey: 'Mods.SandboxWorld.Buff.Gravitation.Desc', fallbackName: '重力' },
  // 描述直接用原版 BuffDescription（12 语言现成，语义一致，同 Honey 先例）
  [BuffType.Chilled]: { vanillaBuff: 46, descKey: 'BuffDescription.Chilled', fallbackName: '冰寒' },
  [BuffType.Frozen]: { vanillaBuff: 47, descKey: 'BuffDescription.Frozen', fallbackName: '冰冻' },
  [BuffType.Stoned]: { vanillaBuff: 156, descKey: 'BuffDescription.Stoned', fallbackName: '石化' },
  [BuffType.ChaosState]: { vanillaBuff: 88, descKey: 'BuffDescription.ChaosState', fallbackName: '混沌状态' },
  [BuffType.CompanionCube]: { vanillaBuff: 191, descKey: 'BuffDescription.CompanionCube', fallbackName: '同伴方块' },
  // 食物三档：描述用原版 BuffDescription.WellFed*（"全面提升属性"语义一致，12 语言现成）
  [BuffType.WellFed]: { vanillaBuff: 26, descKey: 'BuffDescription.WellFed', fallbackName: '饱腹' },
  [BuffType.WellFed2]: { vanillaBuff: 206, descKey: 'BuffDescription.WellFed2', fallbackName: '很饱' },
  [BuffType.WellFed3]: { vanillaBuff: 207, descKey: 'BuffDescription.WellFed3', fallbackName: '饕餮' },
  // 后期批：描述直接用原版 BuffDescription（12 语言现成，语义一致，同 Chilled/Honey 先例）
  [BuffType.MoonLeech]: { vanillaBuff: 145, descKey: 'BuffDescription.MoonLeech', fallbackName: '月噬' },
  [BuffType.Obstructed]: { vanillaBuff: 163, descKey: 'BuffDescription.Obstructed', fallbackName: '遮挡' },
  // 幸运来源批（RecalculateLuck :28675/:28687-28690 消费）：风筝 383 / 恶臭 120。
  // ★120 在 BUFF_NO_SAVE 名单内（环境类，不落盘）
  [BuffType.KiteBuff]: { vanillaBuff: 383, descKey: 'BuffDescription.Kite', fallbackName: '腾灵' },
  [BuffType.Stinky]: { vanillaBuff: 120, descKey: 'BuffDescription.Stinky', fallbackName: '恶臭' },
  [BuffType.Slow]: { vanillaBuff: 32, descKey: 'BuffDescription.Slow', fallbackName: '缓慢' },
  [BuffType.Silenced]: { vanillaBuff: 35, descKey: 'BuffDescription.Silenced', fallbackName: '沉默' },
  // 世纪之花批：毒种子 276 命中授予（Projectile.cs:11527-11535），描述用原版键
  [BuffType.Poisoned]: { vanillaBuff: 20, descKey: 'BuffDescription.Poisoned', fallbackName: '中毒' },
  // 血肉墙舌头两态（描述走原版 BuffDescription 现成键，同 Honey/MoonLeech 先例）
  [BuffType.Horrified]: { vanillaBuff: 37, descKey: 'BuffDescription.Horrified', fallbackName: '惊恐' },
  [BuffType.TheTongue]: { vanillaBuff: 38, descKey: 'BuffDescription.TheTongue', fallbackName: '狂卷之舌' },
  // PvP debuff 族（描述全部走原版 BuffDescription 键）
  [BuffType.Venom]: { vanillaBuff: 70, descKey: 'BuffDescription.Venom', fallbackName: '毒液' },
  [BuffType.CursedInferno]: { vanillaBuff: 39, descKey: 'BuffDescription.CursedInferno', fallbackName: '诅咒焰' },
  [BuffType.OnFire3]: { vanillaBuff: 323, descKey: 'BuffDescription.OnFire3', fallbackName: '地狱火' },
  [BuffType.Frostburn]: { vanillaBuff: 44, descKey: 'BuffDescription.Frostburn', fallbackName: '霜燃' },
  [BuffType.Frostburn2]: { vanillaBuff: 324, descKey: 'BuffDescription.Frostburn2', fallbackName: '霜燃II' },
  [BuffType.Confused]: { vanillaBuff: 31, descKey: 'BuffDescription.Confused', fallbackName: '困惑' },
  [BuffType.Ichor]: { vanillaBuff: 69, descKey: 'BuffDescription.Ichor', fallbackName: '灵液' },
  [BuffType.BrokenArmor]: { vanillaBuff: 36, descKey: 'BuffDescription.BrokenArmor', fallbackName: '破甲' },
  [BuffType.Electrified]: { vanillaBuff: 144, descKey: 'BuffDescription.Electrified', fallbackName: '感电' },
  [BuffType.Invisibility]: { vanillaBuff: 10, descKey: 'BuffDescription.Invisibility', fallbackName: '隐身' },
  // 敌弹 StatusPlayer 批（描述全走原版 BuffDescription 键，同 Chilled/Venom 先例）
  [BuffType.Darkness]: { vanillaBuff: 22, descKey: 'BuffDescription.Darkness', fallbackName: '黑暗' },
  [BuffType.Cursed]: { vanillaBuff: 23, descKey: 'BuffDescription.Cursed', fallbackName: '诅咒' },
  [BuffType.Blackout]: { vanillaBuff: 80, descKey: 'BuffDescription.Blackout', fallbackName: '熄灯' },
  [BuffType.Webbed]: { vanillaBuff: 149, descKey: 'BuffDescription.Webbed', fallbackName: '结网' },
  [BuffType.VortexDebuff]: { vanillaBuff: 164, descKey: 'BuffDescription.VortexDebuff', fallbackName: '星旋减益' },
  [BuffType.WitheredArmor]: { vanillaBuff: 195, descKey: 'BuffDescription.WitheredArmor', fallbackName: '枯萎护甲' },
  [BuffType.WitheredWeapon]: { vanillaBuff: 196, descKey: 'BuffDescription.WitheredWeapon', fallbackName: '枯萎武器' },
  // 潮湿：描述走原版 BuffDescription.Wet（"你在滴水"，12 语言现成，同 Chilled 先例）
  [BuffType.Wet]: { vanillaBuff: 103, descKey: 'BuffDescription.Wet', fallbackName: '潮湿' },
  // ★BJ739 B11：Slimed(137)——名称/描述走原版 BuffName/BuffDescription.Slimed
  //  （zh-Hans「黏液」/「你黏糊糊的」,12 语言现成零自造键）;图标 Buff_137.png 在库
  [BuffType.Slimed]: { vanillaBuff: 137, descKey: 'BuffDescription.Slimed', fallbackName: '黏液' },
  // 日耀护盾三档（170-172）：名称 BuffName.SolarShieldN（日耀烈焰）+ 原版描述
  [BuffType.SolarShield1]: { vanillaBuff: 170, descKey: 'BuffDescription.SolarShield1', fallbackName: '日耀烈焰' },
  [BuffType.SolarShield2]: { vanillaBuff: 171, descKey: 'BuffDescription.SolarShield2', fallbackName: '日耀烈焰' },
  [BuffType.SolarShield3]: { vanillaBuff: 172, descKey: 'BuffDescription.SolarShield3', fallbackName: '日耀烈焰' },
  // 树妖祝福：名称/描述走原版键（zh-Hans"树妖祝福"/"自然的力量保护你"，12 语言现成）
  [BuffType.DryadsWard]: { vanillaBuff: 165, descKey: 'BuffDescription.DryadsWard', fallbackName: '树妖祝福' },
  // 饥饿链三态（名称/描述 = 原版 BuffName/BuffDescription.{NeutralHunger,Hunger,Starving}）
  [BuffType.NeutralHunger]: { vanillaBuff: 332, descKey: 'BuffDescription.NeutralHunger', fallbackName: '稍饿' },
  [BuffType.Hunger]: { vanillaBuff: 333, descKey: 'BuffDescription.Hunger', fallbackName: '饥饿' },
  [BuffType.Starving]: { vanillaBuff: 334, descKey: 'BuffDescription.Starving', fallbackName: '极饿' },
  // 1457 新增：魔力过热 396（描述自有键——机制数值是本仓实现；原版 BuffName 走
  // 1457 l10n，本仓 1456 语料无此键 → fallback 兜底）。贴图 Buff_396.png 已随
  // 1457 素材批（scripts/atlas-append-1457.mjs）入仓且与源库 MD5 同源，UI 直链
  // 正常显示；buffIconItem 药水图标仅作 onerror 兜底保留
  [BuffType.ManaHeat]: { vanillaBuff: 396, descKey: 'Mods.SandboxWorld.Buff.ManaHeat.Desc', fallbackName: '魔力过热' },
  // 1457 强化：温暖 124（描述用原版 BuffDescription.Warmth 现成键）
  [BuffType.Warmth]: { vanillaBuff: 124, descKey: 'BuffDescription.Warmth', fallbackName: '温暖' },
  // 1457 新敌怪 debuff 五件（名称/描述均自有键——1456 语料无 BuffName.395-400；
  //  键在 tools/l10n-custom 两语补齐。敌怪侧 buff，无图标/UI 链）
  [BuffType.PotentAcid]: { vanillaBuff: 395, descKey: 'Mods.SandboxWorld.Buff.PotentAcid.Desc', fallbackName: '强酸' },
  [BuffType.ChlorophyteSpore]: { vanillaBuff: 397, descKey: 'Mods.SandboxWorld.Buff.ChlorophyteSpore.Desc', fallbackName: '叶绿孢子' },
  [BuffType.AcceleratePoisons]: { vanillaBuff: 398, descKey: 'Mods.SandboxWorld.Buff.AcceleratePoisons.Desc', fallbackName: '毒素加速' },
  [BuffType.BlueLightning]: { vanillaBuff: 399, descKey: 'Mods.SandboxWorld.Buff.BlueLightning.Desc', fallbackName: '蓝色闪电' },
  [BuffType.RedLightning]: { vanillaBuff: 400, descKey: 'Mods.SandboxWorld.Buff.RedLightning.Desc', fallbackName: '红色闪电' },
  // 1457 召唤物/坐骑伴生 buff 六件（389-394,名字/描述取 1457 官方 l10n 语料,
  //  键在 tools/l10n-custom 两语补齐;图标 Buff_389-394.png 已到位）
  [BuffType.PalworldMinionTrustyCattiva]: { vanillaBuff: 389, descKey: 'Mods.SandboxWorld.Buff.PalworldMinionTrustyCattiva.Desc', fallbackName: '可靠的捣蛋猫' },
  [BuffType.PalworldMinionTrustyFoxsparks]: { vanillaBuff: 390, descKey: 'Mods.SandboxWorld.Buff.PalworldMinionTrustyFoxsparks.Desc', fallbackName: '可靠的火绒狐' },
  [BuffType.PalworldMountTrustyChillet]: { vanillaBuff: 391, descKey: 'Mods.SandboxWorld.Buff.PalworldMountTrustyChillet.Desc', fallbackName: '可靠的疾旋鼬' },
  [BuffType.PalworldMountTrustyChilletIgnis]: { vanillaBuff: 392, descKey: 'Mods.SandboxWorld.Buff.PalworldMountTrustyChilletIgnis.Desc', fallbackName: '可靠的疾旋火鼬' },
  [BuffType.ClayPotMinion]: { vanillaBuff: 393, descKey: 'Mods.SandboxWorld.Buff.ClayPotMinion.Desc', fallbackName: '黏土蓓蕾' },
  [BuffType.ForbiddenMinion]: { vanillaBuff: 394, descKey: 'Mods.SandboxWorld.Buff.ForbiddenMinion.Desc', fallbackName: '禁戒遗迹' },
  // 火把祝福 376（火把神药水 5573）：描述走原版 BuffDescription.TorchGodPotion
  //（zh/en 语料现成,与 Honey/Chilled 先例同构）；zh 名也在 BuffDescription 分片,
  // BuffName 键缺 → 走 fallbackName（zh-Hans.Game.json:968"火把祝福"）
  [BuffType.TorchGodPotion]: { vanillaBuff: 376, descKey: 'BuffDescription.TorchGodPotion', fallbackName: '火把祝福' },
  // ---- 58 缺口轻项批（2026-08-22）：46 件宠物/光宠/召唤物伴生/星云增益/事件标记。
  //  描述全部走原版 BuffDescription.<Internal>（46 键在 12 语语料全存在,与
  //  Honey/Chilled 先例同构,无需自造键）；fallbackName 取 zh-Hans 官方 BuffName。
  //  原版也仅在 Draw/标记层消费——条目即终点,无消费逻辑（见枚举段注释）----
  [BuffType.ShadowOrb]: { vanillaBuff: 19, descKey: 'BuffDescription.ShadowOrb', fallbackName: '暗影珠' },
  [BuffType.FairyBlue]: { vanillaBuff: 27, descKey: 'BuffDescription.FairyBlue', fallbackName: '仙灵' },
  [BuffType.HeartyMeal]: { vanillaBuff: 336, descKey: 'BuffDescription.HeartyMeal', fallbackName: '丰盛大餐' },
  // 仙灵铃 425 三选一其余两色（Player.cs:52256-52272 Next(3)→27/101/102）——
  // 101/102 缺条目时 BUFF_BY_VANILLA 反查落空 → 三掷只蓝档生效（QuickBuff 同门）。
  // 2026-08-22 补 C 审计 ⚠️425 修复批补全（Buff_101/102.png 已在盘）
  [BuffType.FairyRed]: { vanillaBuff: 101, descKey: 'BuffDescription.FairyRed', fallbackName: '仙灵' },
  [BuffType.FairyGreen]: { vanillaBuff: 102, descKey: 'BuffDescription.FairyGreen', fallbackName: '仙灵' },
  [BuffType.BabyEater]: { vanillaBuff: 45, descKey: 'BuffDescription.BabyEater', fallbackName: '吞噬怪宝宝' },
  [BuffType.Pygmies]: { vanillaBuff: 49, descKey: 'BuffDescription.Pygmies', fallbackName: '矮人' },
  [BuffType.BabySkeletronHead]: { vanillaBuff: 50, descKey: 'BuffDescription.BabySkeletronHead', fallbackName: '骷髅王头宝宝' },
  [BuffType.BabyHornet]: { vanillaBuff: 51, descKey: 'BuffDescription.BabyHornet', fallbackName: '黄蜂宝宝' },
  [BuffType.TikiSpirit]: { vanillaBuff: 52, descKey: 'BuffDescription.TikiSpirit', fallbackName: '提基幽魂' },
  [BuffType.PetLizard]: { vanillaBuff: 53, descKey: 'BuffDescription.PetLizard', fallbackName: '宠物蜥蜴' },
  [BuffType.PetParrot]: { vanillaBuff: 54, descKey: 'BuffDescription.PetParrot', fallbackName: '宠物鹦鹉' },
  [BuffType.BabyTruffle]: { vanillaBuff: 55, descKey: 'BuffDescription.BabyTruffle', fallbackName: '松露人宝宝' },
  [BuffType.PetSapling]: { vanillaBuff: 56, descKey: 'BuffDescription.PetSapling', fallbackName: '宠物树苗' },
  [BuffType.Wisp]: { vanillaBuff: 57, descKey: 'BuffDescription.Wisp', fallbackName: '妖灵' },
  [BuffType.BabyDinosaur]: { vanillaBuff: 61, descKey: 'BuffDescription.BabyDinosaur', fallbackName: '恐龙宝宝' },
  [BuffType.BabySlime]: { vanillaBuff: 64, descKey: 'BuffDescription.BabySlime', fallbackName: '史莱姆宝宝' },
  [BuffType.EyeballSpring]: { vanillaBuff: 65, descKey: 'BuffDescription.EyeballSpring', fallbackName: '弹簧眼' },
  [BuffType.BabySnowman]: { vanillaBuff: 66, descKey: 'BuffDescription.BabySnowman', fallbackName: '雪人宝宝' },
  [BuffType.PetSpider]: { vanillaBuff: 81, descKey: 'BuffDescription.PetSpider', fallbackName: '宠物蜘蛛' },
  [BuffType.Squashling]: { vanillaBuff: 82, descKey: 'BuffDescription.Squashling', fallbackName: '南瓜娃娃' },
  [BuffType.Ravens]: { vanillaBuff: 83, descKey: 'BuffDescription.Ravens', fallbackName: '乌鸦' },
  [BuffType.BlackCat]: { vanillaBuff: 84, descKey: 'BuffDescription.BlackCat', fallbackName: '黑猫' },
  [BuffType.CursedSapling]: { vanillaBuff: 85, descKey: 'BuffDescription.CursedSapling', fallbackName: '诅咒树苗' },
  [BuffType.Puppy]: { vanillaBuff: 91, descKey: 'BuffDescription.Puppy', fallbackName: '小狗' },
  [BuffType.BabyGrinch]: { vanillaBuff: 92, descKey: 'BuffDescription.BabyGrinch', fallbackName: '格林奇宝宝' },
  [BuffType.SpiderMinion]: { vanillaBuff: 133, descKey: 'BuffDescription.SpiderMinion', fallbackName: '蜘蛛' },
  [BuffType.TwinEyesMinion]: { vanillaBuff: 134, descKey: 'BuffDescription.TwinEyesMinion', fallbackName: '双子魔眼' },
  [BuffType.PirateMinion]: { vanillaBuff: 135, descKey: 'BuffDescription.PirateMinion', fallbackName: '海盗' },
  [BuffType.MiniMinotaur]: { vanillaBuff: 136, descKey: 'BuffDescription.MiniMinotaur', fallbackName: '福恩' },
  [BuffType.MagicLantern]: { vanillaBuff: 152, descKey: 'BuffDescription.MagicLantern', fallbackName: '魔法灯笼' },
  [BuffType.BabyFaceMonster]: { vanillaBuff: 154, descKey: 'BuffDescription.BabyFaceMonster', fallbackName: '脸怪宝宝' },
  [BuffType.CrimsonHeart]: { vanillaBuff: 155, descKey: 'BuffDescription.CrimsonHeart', fallbackName: '猩红之心' },
  [BuffType.DeadlySphere]: { vanillaBuff: 161, descKey: 'BuffDescription.DeadlySphere', fallbackName: '致命球' },
  [BuffType.NebulaUpLife1]: { vanillaBuff: 173, descKey: 'BuffDescription.NebulaUpLife1', fallbackName: '生命星云' },
  [BuffType.NebulaUpMana1]: { vanillaBuff: 176, descKey: 'BuffDescription.NebulaUpMana1', fallbackName: '魔力星云' },
  [BuffType.NebulaUpDmg1]: { vanillaBuff: 179, descKey: 'BuffDescription.NebulaUpDmg1', fallbackName: '伤害星云' },
  [BuffType.StardustMinion]: { vanillaBuff: 182, descKey: 'BuffDescription.StardustMinion', fallbackName: '星尘细胞' },
  [BuffType.StardustDragonMinion]: { vanillaBuff: 188, descKey: 'BuffDescription.StardustDragonMinion', fallbackName: '星尘之龙' },
  [BuffType.SuspiciousTentacle]: { vanillaBuff: 190, descKey: 'BuffDescription.SuspiciousTentacle', fallbackName: '可疑眼球' },
  [BuffType.PetDD2Gato]: { vanillaBuff: 200, descKey: 'BuffDescription.PetDD2Gato', fallbackName: '飞翔Gato' },
  [BuffType.PetDD2Ghost]: { vanillaBuff: 201, descKey: 'BuffDescription.PetDD2Ghost', fallbackName: '闪烁灯芯' },
  [BuffType.BatOfLight]: { vanillaBuff: 213, descKey: 'BuffDescription.BatOfLight', fallbackName: '血红蝙蝠' },
  [BuffType.VampireFrog]: { vanillaBuff: 214, descKey: 'BuffDescription.VampireFrog', fallbackName: '吸血鬼青蛙' },
  [BuffType.BabyBird]: { vanillaBuff: 216, descKey: 'BuffDescription.BabyBird', fallbackName: '雀宝宝' },
  [BuffType.StormTiger]: { vanillaBuff: 263, descKey: 'BuffDescription.StormTiger', fallbackName: '沙漠虎' },
  [BuffType.Smolstar]: { vanillaBuff: 271, descKey: 'BuffDescription.Smolstar', fallbackName: '附魔飞刀' },
  [BuffType.AbigailMinion]: { vanillaBuff: 335, descKey: 'BuffDescription.AbigailMinion', fallbackName: '阿比盖尔' },
  [BuffType.DeadCellsMushroomBoiMinion]: { vanillaBuff: 355, descKey: 'BuffDescription.DeadCellsMushroomBoiMinion', fallbackName: '蘑菇小伙伴！' },
  // 冰障 62（冰冻护盾族）：名称/描述走原版 BuffDescription.IceBarrier（12 语言现成），
  // 图标 Buff_62.png 已入库——buff 栏直显
  [BuffType.IceBarrier]: { vanillaBuff: 62, descKey: 'BuffDescription.IceBarrier', fallbackName: '冰障' },
  // ---- 随从杖伴生 buff 泛化批 8 件（2026-08-22 补 C 重项；描述走原版
  //  BuffDescription.<Internal>——zh-Hans/en-US 语料在键含 385/386 帕鲁两条，
  //  同 58 缺口批先例,无需自造键）----
  [BuffType.HornetMinion]: { vanillaBuff: 125, descKey: 'BuffDescription.HornetMinion', fallbackName: '黄蜂' },
  [BuffType.ImpMinion]: { vanillaBuff: 126, descKey: 'BuffDescription.ImpMinion', fallbackName: '小鬼' },
  [BuffType.SharknadoMinion]: { vanillaBuff: 139, descKey: 'BuffDescription.SharknadoMinion', fallbackName: '鲨鱼旋风' },
  [BuffType.UFOMinion]: { vanillaBuff: 140, descKey: 'BuffDescription.UFOMinion', fallbackName: 'UFO' },
  [BuffType.EmpressBlade]: { vanillaBuff: 322, descKey: 'BuffDescription.EmpressBlade', fallbackName: '泰拉棱镜' },
  [BuffType.FlinxMinion]: { vanillaBuff: 325, descKey: 'BuffDescription.FlinxMinion', fallbackName: '小雪怪' },
  [BuffType.PalworldMinionCattiva]: { vanillaBuff: 385, descKey: 'BuffDescription.PalworldMinionCattiva', fallbackName: '捣蛋猫' },
  [BuffType.PalworldMinionFoxsparks]: { vanillaBuff: 386, descKey: 'BuffDescription.PalworldMinionFoxsparks', fallbackName: '火绒狐' },
  // ---- B1 投掷物光环 buff（描述走原版 BuffDescription 键——zh-Hans/en-US 语料在键,
  //      同 IceBarrier 先例;名称 BuffName.Lovestruck/GelBalloonBuff 由 icon/名字管线
  //      的同源 key 解析）----
  [BuffType.Lovestruck]: { vanillaBuff: 119, descKey: 'BuffDescription.Lovestruck', fallbackName: '坠入爱河' },
  [BuffType.GelBalloonBuff]: { vanillaBuff: 320, descKey: 'BuffDescription.GelBalloonBuff', fallbackName: '微光史莱姆装扮' },
  // ★治理批 B6①：盾反 buff198 建模（枚举位 Parry=307 见枚举尾注）——
  //   名称/描述均走原版键，零自造 l10n 键
  [BuffType.Parry]: { vanillaBuff: 198, descKey: 'BuffDescription.ParryDamageBuff', fallbackName: '惊人一刻' },
  // 甲虫套装族（名称/描述走原版键 BuffDescription.BeetleEndurance1..3/BeetleMight1..3，
  // l10n 语料 12 语言现成零自造；fallbackName 对齐 zh-Hans「甲虫耐力/甲虫力量」三档同名）
  [BuffType.BeetleEndurance1]: { vanillaBuff: 95, descKey: 'BuffDescription.BeetleEndurance1', fallbackName: '甲虫耐力' },
  [BuffType.BeetleEndurance2]: { vanillaBuff: 96, descKey: 'BuffDescription.BeetleEndurance2', fallbackName: '甲虫耐力' },
  [BuffType.BeetleEndurance3]: { vanillaBuff: 97, descKey: 'BuffDescription.BeetleEndurance3', fallbackName: '甲虫耐力' },
  [BuffType.BeetleMight1]: { vanillaBuff: 98, descKey: 'BuffDescription.BeetleMight1', fallbackName: '甲虫力量' },
  [BuffType.BeetleMight2]: { vanillaBuff: 99, descKey: 'BuffDescription.BeetleMight2', fallbackName: '甲虫力量' },
  [BuffType.BeetleMight3]: { vanillaBuff: 100, descKey: 'BuffDescription.BeetleMight3', fallbackName: '甲虫力量' },
  // 环境光环五缺口（同走原版键零自造；86/350 原版不在 buffNoSave(:9124-9175 无)——
  // 表保持如实不追加）
  [BuffType.WaterCandle]: { vanillaBuff: 86, descKey: 'BuffDescription.WaterCandle', fallbackName: '水蜡烛' },
  [BuffType.HeartLamp]: { vanillaBuff: 89, descKey: 'BuffDescription.HeartLamp', fallbackName: '心灯' },
  [BuffType.MonsterBanner]: { vanillaBuff: 147, descKey: 'BuffDescription.MonsterBanner', fallbackName: '旗帜' },
  [BuffType.WindPushed]: { vanillaBuff: 194, descKey: 'BuffDescription.WindPushed', fallbackName: '强风' },
  [BuffType.ShadowCandle]: { vanillaBuff: 350, descKey: 'BuffDescription.ShadowCandle', fallbackName: '暗影蜡烛' },
  // 叶绿水晶叶（LeafCrystal 60,套装标志位 buff,无独立 DoT）——名称/描述走原版键
  // （en-US.Game.json :701/:1055,BuffDescription.LeafCrystal 12 语言现成零自造键）；
  // 图标 Buff_60.png 已在盘;vanilla id 60 在 BUFF_NO_TIME_DISPLAY（不显剩余时长）
  [BuffType.LeafCrystal]: { vanillaBuff: 60, descKey: 'BuffDescription.LeafCrystal', fallbackName: '水晶叶' },
  // 终零波批（2026-09-01）：descKey 走原版 BuffDescription.* 命名空间（vanilla l10n
  // dump 未含 → UI 回落 fallbackName,TitaniumStorm/LeafCrystal 同款先例,零自造键）
  [BuffType.ShadowDodge]: { vanillaBuff: 59, descKey: 'BuffDescription.ShadowDodge', fallbackName: '幻影闪避' },
  [BuffType.RapidHealing]: { vanillaBuff: 58, descKey: 'BuffDescription.RapidHealing', fallbackName: '快速再生' },
  // 终零波·护士经济簇（2026-09-01）：descKey 走原版键（en-US.Game.json:807/:815
  // ——名称 Dazed/`OgreSpit`=Oozed）
  [BuffType.Dazed]: { vanillaBuff: 160, descKey: 'BuffDescription.Dazed', fallbackName: '眩晕' },
  [BuffType.OgreSpit]: { vanillaBuff: 197, descKey: 'BuffDescription.OgreSpit', fallbackName: '分泌物' },
  // ---- SW-FX2：58 缺口重项 40/41/42/127 + 四键① 202 + pets 表对拍 217/219/259/261/268
  //      （枚举尾注即总账;名称/描述走原版 BuffName/BuffDescription 键,12 语言现成,
  //      图标 Buff_N.png 全在盘）----
  [BuffType.PetBunny]: { vanillaBuff: 40, descKey: 'BuffDescription.PetBunny', fallbackName: '宠物兔兔' },
  [BuffType.BabyPenguin]: { vanillaBuff: 41, descKey: 'BuffDescription.BabyPenguin', fallbackName: '企鹅宝宝' },
  [BuffType.PetTurtle]: { vanillaBuff: 42, descKey: 'BuffDescription.PetTurtle', fallbackName: '宠物海龟' },
  [BuffType.ZephyrFish]: { vanillaBuff: 127, descKey: 'BuffDescription.ZephyrFish', fallbackName: '和风鱼' },
  [BuffType.PetDD2Dragon]: { vanillaBuff: 202, descKey: 'BuffDescription.PetDD2Dragon', fallbackName: 'Hoardagron' },
  [BuffType.UpbeatStar]: { vanillaBuff: 217, descKey: 'BuffDescription.UpbeatStar', fallbackName: '埃斯蒂' },
  [BuffType.SharkPup]: { vanillaBuff: 219, descKey: 'BuffDescription.SharkPup', fallbackName: '小鲨鱼' },
  [BuffType.FennecFox]: { vanillaBuff: 259, descKey: 'BuffDescription.FennecFox', fallbackName: '耳廓狐' },
  [BuffType.BabyImp]: { vanillaBuff: 261, descKey: 'BuffDescription.BabyImp', fallbackName: '小鬼宝宝' },
  [BuffType.ShadowMimic]: { vanillaBuff: 268, descKey: 'BuffDescription.ShadowMimic', fallbackName: '暗影宝箱怪' },
  // ---- SW-FX2 续：vanilla-pets.json 全表收尾 25 件（枚举尾注即总账;图标/l10n 全在位）----
  [BuffType.SugarGlider]: { vanillaBuff: 218, descKey: 'BuffDescription.SugarGlider', fallbackName: '蜜袋鼯' },
  [BuffType.LilHarpy]: { vanillaBuff: 258, descKey: 'BuffDescription.LilHarpy', fallbackName: '小鸟妖' },
  [BuffType.GlitteryButterfly]: { vanillaBuff: 260, descKey: 'BuffDescription.GlitteryButterfly', fallbackName: '闪光蝴蝶' },
  [BuffType.BabyRedPanda]: { vanillaBuff: 262, descKey: 'BuffDescription.BabyRedPanda', fallbackName: '小熊猫宝宝' },
  [BuffType.Plantero]: { vanillaBuff: 264, descKey: 'BuffDescription.Plantero', fallbackName: '微型世纪之花' },
  [BuffType.DynamiteKitten]: { vanillaBuff: 266, descKey: 'BuffDescription.DynamiteKitten', fallbackName: '雷管小猫' },
  [BuffType.BabyWerewolf]: { vanillaBuff: 267, descKey: 'BuffDescription.BabyWerewolf', fallbackName: '狼人宝宝' },
  [BuffType.VoltBunny]: { vanillaBuff: 274, descKey: 'BuffDescription.VoltBunny', fallbackName: '伏特兔' },
  [BuffType.QueenSlimePet]: { vanillaBuff: 317, descKey: 'BuffDescription.QueenSlimePet', fallbackName: '史莱姆公主' },
  [BuffType.BerniePet]: { vanillaBuff: 327, descKey: 'BuffDescription.BerniePet', fallbackName: '伯尼' },
  [BuffType.GlommerPet]: { vanillaBuff: 328, descKey: 'BuffDescription.GlommerPet', fallbackName: '咕噜咪' },
  [BuffType.DeerclopsPet]: { vanillaBuff: 329, descKey: 'BuffDescription.DeerclopsPet', fallbackName: '小独眼巨鹿' },
  [BuffType.PigPet]: { vanillaBuff: 330, descKey: 'BuffDescription.PigPet', fallbackName: '猪' },
  [BuffType.ChesterPet]: { vanillaBuff: 331, descKey: 'BuffDescription.ChesterPet', fallbackName: '切斯特' },
  [BuffType.DualSlimePet]: { vanillaBuff: 341, descKey: 'BuffDescription.DualSlimePet', fallbackName: '皇家史莱姆' },
  [BuffType.JunimoPet]: { vanillaBuff: 345, descKey: 'BuffDescription.JunimoPet', fallbackName: '祝尼魔' },
  [BuffType.BlueChickenPet]: { vanillaBuff: 349, descKey: 'BuffDescription.BlueChickenPet', fallbackName: '蓝鸡' },
  [BuffType.Spiffo]: { vanillaBuff: 351, descKey: 'BuffDescription.Spiffo', fallbackName: 'Spiffo' },
  [BuffType.CavelingGardener]: { vanillaBuff: 352, descKey: 'BuffDescription.CavelingGardener', fallbackName: '洞穴园丁' },
  [BuffType.DirtiestBlock]: { vanillaBuff: 354, descKey: 'BuffDescription.DirtiestBlock', fallbackName: '最土的块' },
  [BuffType.DeadCellsSwarmBiter]: { vanillaBuff: 356, descKey: 'BuffDescription.DeadCellsSwarmBiter', fallbackName: '虫群啃噬者' },
  [BuffType.Pufferfish]: { vanillaBuff: 371, descKey: 'BuffDescription.Pufferfish', fallbackName: '河豚' },
  [BuffType.AxeFairyPet]: { vanillaBuff: 372, descKey: 'BuffDescription.AxeFairyPet', fallbackName: '塞纳克斯' },
  [BuffType.BoulderPet]: { vanillaBuff: 373, descKey: 'BuffDescription.BoulderPet', fallbackName: '友好巨石' },
  [BuffType.RainbowBoulderPet]: { vanillaBuff: 382, descKey: 'BuffDescription.RainbowBoulderPet', fallbackName: '友好彩虹巨石' },
  // ---- SW-FX48（2026-09-12）：1.4.5 boss 宠 21 件（4797-4817 → 284-304,
  //      Item.cs:39417-39440 DefaultToVanitypet(881+type-4797, 284+type-4797)）。
  //      枚举名 = 原版 BuffID 内部名 → descKey 走原版 l10n BuffDescription.<Internal>
  //      现成语料（zh/en 全 12 语言在盘,零 l10n-custom 新增）;图标 Buff_284-304.png 全在盘。
  //      消费面 = Game.petBuffKinds light/vanity 双集 + updatePetSlot 补挂面（SW-FX2 已建）。
  //      buffNoSave 全名单不含以下任何 id（Main.cs:9108-9199 无 284-304,原版同）----
  [BuffType.KingSlimePet]: { vanillaBuff: 284, descKey: 'BuffDescription.KingSlimePet', fallbackName: '史莱姆王子' },
  [BuffType.EyeOfCthulhuPet]: { vanillaBuff: 285, descKey: 'BuffDescription.EyeOfCthulhuPet', fallbackName: '可疑眼睛' },
  [BuffType.EaterOfWorldsPet]: { vanillaBuff: 286, descKey: 'BuffDescription.EaterOfWorldsPet', fallbackName: '蠕虫吞噬怪' },
  [BuffType.BrainOfCthulhuPet]: { vanillaBuff: 287, descKey: 'BuffDescription.BrainOfCthulhuPet', fallbackName: '蜘蛛脑' },
  [BuffType.SkeletronPet]: { vanillaBuff: 288, descKey: 'BuffDescription.SkeletronPet', fallbackName: '小骷髅王' },
  [BuffType.QueenBeePet]: { vanillaBuff: 289, descKey: 'BuffDescription.QueenBeePet', fallbackName: '宝贝蜜蜂' },
  [BuffType.DestroyerPet]: { vanillaBuff: 290, descKey: 'BuffDescription.DestroyerPet', fallbackName: '微型毁灭者' },
  [BuffType.TwinsPet]: { vanillaBuff: 291, descKey: 'BuffDescription.TwinsPet', fallbackName: '激光眼和魔焰眼' },
  [BuffType.SkeletronPrimePet]: { vanillaBuff: 292, descKey: 'BuffDescription.SkeletronPrimePet', fallbackName: '小机械骷髅王' },
  [BuffType.PlanteraPet]: { vanillaBuff: 293, descKey: 'BuffDescription.PlanteraPet', fallbackName: '世纪之花幼苗' },
  [BuffType.GolemPet]: { vanillaBuff: 294, descKey: 'BuffDescription.GolemPet', fallbackName: '玩具石巨人' },
  [BuffType.DukeFishronPet]: { vanillaBuff: 295, descKey: 'BuffDescription.DukeFishronPet', fallbackName: '小猪龙鱼' },
  [BuffType.LunaticCultistPet]: { vanillaBuff: 296, descKey: 'BuffDescription.LunaticCultistPet', fallbackName: '小幻影龙' },
  [BuffType.MoonLordPet]: { vanillaBuff: 297, descKey: 'BuffDescription.MoonLordPet', fallbackName: '月精灵' },
  [BuffType.FairyQueenPet]: { vanillaBuff: 298, descKey: 'BuffDescription.FairyQueenPet', fallbackName: '仙灵公主' },
  [BuffType.PumpkingPet]: { vanillaBuff: 299, descKey: 'BuffDescription.PumpkingPet', fallbackName: '杰克南瓜灯' },
  [BuffType.EverscreamPet]: { vanillaBuff: 300, descKey: 'BuffDescription.EverscreamPet', fallbackName: '常绿尖叫怪树苗' },
  [BuffType.IceQueenPet]: { vanillaBuff: 301, descKey: 'BuffDescription.IceQueenPet', fallbackName: '冰雪女王' },
  [BuffType.MartianPet]: { vanillaBuff: 302, descKey: 'BuffDescription.MartianPet', fallbackName: '异星滑板小子' },
  [BuffType.DD2OgrePet]: { vanillaBuff: 303, descKey: 'BuffDescription.DD2OgrePet', fallbackName: '食人魔宝宝' },
  [BuffType.DD2BetsyPet]: { vanillaBuff: 304, descKey: 'BuffDescription.DD2BetsyPet', fallbackName: '小双足翼龙' },
};

/** BuffType → vanilla buff id 反查（BUFF_DEFS 驱动；新入档 buff 自动可见） */
export function vanillaIdOfBuff(bt: BuffType): number {
  return (BUFF_DEFS as Record<BuffType, { vanillaBuff: number }>)[bt]?.vanillaBuff ?? -1;
}

/** BuffID.Sets.NurseCannotRemoveDebuff（Terraria.ID/BuffID.cs:32 全表）——护士治疗
 *  计价与清除双面的排除集（Main.cs:40758 计数门 / :40832 清除门同式读取）。
 *  表内成员实为「护士动不得」全家桶：正面伪 debuff（狼人 28/人鱼 34/圣骑盾 43）、
 *  每帧重钉的短光环（篝火 87/水蜡烛 86/心灯 89/和平 157/暗影 350/树妖 165 等）、
 *  常驻效用 buff（药水病 21/蜂蜜 48/旗帜 147/猫堡垒 215/混乱脑 321）、饥饿链
 *  （332-334，非 dontStarve 世界即时清零故无意义）与 DD2 场地 NoBuilding 199。 */
export const NURSE_CANNOT_REMOVE_VANILLA = new Set<number>([
  28, 34, 87, 89, 21, 86, 199, 332, 333, 334, 165, 146, 48, 158, 157, 350, 215, 147, 321, 43,
]);

/** 排除表命中判定（护士计价/清除两侧共用门） */
export function isNurseLockedBuff(vanillaId: number): boolean {
  return vanillaId > 0 && NURSE_CANNOT_REMOVE_VANILLA.has(vanillaId);
}

/** BuffID.Sets.IsFedState（BuffID.cs:16 = {26,206,207,332,333,334}——含饥饿链三态：
 *  AddBuff 授予任一 fed-state 前先删栏内全部其它 fed-state，Player.cs:5080-5089。
 *  吃食物（26/206/207）即清饥饿链——饥饿重置的真正机制（另有 TryToResetHungerToNeutral
 *  :11672 走蘑菇 5/蛋奶酒 1912 直清） */
const FED_STATE_VANILLA: ReadonlySet<number> = new Set([
  BUFF_DEFS[BuffType.WellFed].vanillaBuff,    // 26
  BUFF_DEFS[BuffType.WellFed2].vanillaBuff,   // 206
  BUFF_DEFS[BuffType.WellFed3].vanillaBuff,   // 207
  BUFF_DEFS[BuffType.NeutralHunger].vanillaBuff,  // 332
  BUFF_DEFS[BuffType.Hunger].vanillaBuff,         // 333
  BUFF_DEFS[BuffType.Starving].vanillaBuff,       // 334
]);
/** 全部 fed-state BuffType（apply 换档删旧用——Player.cs:5082-5088 DelBuff 循环） */
const FED_STATE_TYPES: ReadonlySet<BuffType> = new Set([
  BuffType.WellFed, BuffType.WellFed2, BuffType.WellFed3,
  BuffType.NeutralHunger, BuffType.Hunger, BuffType.Starving,
]);

/** Main.buffNoSave 全名单（Main.cs:8896-8990：不写入玩家存档的 buff;
 *  含 173-181 整段 for 循环）——本仓仅存 BUFF_DEFS 已映射项,交集生效 */
export const BUFF_NO_SAVE = new Set([
  20, 22, 23, 24, 28, 29, 30, 31, 34, 35, 37, 38, 39, 43, 44, 46, 47, 48,
  58, 59, 60, 62, 63, 64, 67, 68, 69, 70, 72, 80, 87, 88, 89, 93, 94, 95,
  96, 97, 98, 99, 100, 103, 119, 120, 125, 126, 133, 134, 135, 137, 139,
  140, 144, 146, 147, 150, 158, 159, 161, 163, 164, 170, 171, 172, 173, 174,
  175, 176, 177, 178, 179, 180, 181, 182, 187, 188, 194, 195, 196, 197, 198,
  199, 205, 213, 214, 215, 263, 271, 320, 321, 322, 325, 335, 348, 353, 355,
  // ★BJ742-A R21-④（2026-10-31）：补 7 员——156 Stoned（Main.cs:9124）/149 Webbed
  //   （:9125）/395 PotentAcid（:9137）/397-400 ChlorophyteSpore·AcceleratePoisons·
  //   Blue/RedLightning（:9205-9208,1457 新 DoT/视觉族）——旧缺=石化/结网/强酸等
  //   状态跨存档落盘,读档幻影 debuff（原版不写）。七员 BuffType 全已映射（本表
  //   交集生效）。173-181 非多收：原版 :9209-9212 for 循环整段置位（R21 审计
  //   「存量多收」系对显式赋值清单比对所得,循环段在案——备案勿动照留）。
  149, 156, 395, 397, 398, 399, 400,
  366, 385, 386, 389, 390, 393, 394,   // 1457 Palworld 随从伴生（Main.cs:9199-9204）
  374, 377, 384, 391, 392,   // ★BJ357 变身坐骑伴生 + ★清偿刀 P4（2026-09-30）补收
                             //  391/392 疾旋鼬族——Main.cs:9345-9352 for 循环对【全部】
                             //  MountType buff（BuffID.cs:152 全 66 对,391→64/392→65）
                             //  置 buffNoTimeDisplay+buffNoSave。★勘误：旧注「391/392
                             //  本仓未映射不落库」失实——BuffType 120/121 已映射（:721-722）,
                             //  BJ357 重钉面（Game.useMountItem apply 60s + Player.fixedUpdate
                             //  ridingMount 每 tick 重钉 10t≈0.167s）使骑乘态 391/392 恒
                             //  活在 BuffState,toSave 的 0.05s 阈（:1341）拦不住——不补=
                             //  骑乘存档落 391/392+读档幻影 buff（原版 buffNoSave 拦截）
]);
/** vanilla buff id → 本仓 BuffType 反查（存档恢复 + statusPlayer 授予链共用）。
 *  ★Object.keys 恒返回【字符串】——必须 Number() 还原枚举数值键，否则
 *  BuffState.active 的 Map 以 '93' 存键，has(BuffType.X)/get(BuffType.X) 的
 *  数值键查找全部落空（感电授予/读档恢复 buff 一律失效）。2026-08-13 修复 */
const BUFF_TYPE_BY_VANILLA = new Map<number, BuffType>(
  (Object.keys(BUFF_DEFS) as unknown as BuffType[]).map((t) => [BUFF_DEFS[t].vanillaBuff, Number(t)]),
);

/** ★mod buff 反查注册面（2026-10-04 P4 红蓝修正 A-m2）：mod buff 落伪 vanillaBuff
 *  9000+ 段,注册期直写反查 Map——存档 toSave 写伪 id / 读档 applySaved 反解闭环
 *  （旧实现反查 Map 载入期快照,mod buff 存档后读档静默消失）。缺 mod 读档=反查
 *  miss 静默丢弃（与原版未知 id 同款占位语义）。 */
export function registerBuffVanillaReverse(vanillaBuffId: number, type: number): void {
  BUFF_TYPE_BY_VANILLA.set(vanillaBuffId, type as BuffType);
}

/** ★R-A-Me3(2026-10-14):mod buff 反查 teardown(热重载;旧=停用 mod 带 buff
 *  角色读档恢复幽灵 buff[行为钩已清、buff 栏显示残名]) */
export function _resetModBuffReverseForTests(): void {
  for (const [vanillaId, bt] of BUFF_TYPE_BY_VANILLA) {
    if (vanillaId >= 9000) BUFF_TYPE_BY_VANILLA.delete(vanillaId);
    void bt;
  }
}
/** vanilla buff id → BuffType 反查（导出版）。消费方 = 按原版 buff id 表驱动的授予链：
 *  敌弹 StatusPlayer（projTargets.statusPlayer，data/vanilla-statusplayer.json 的 b 字段）。
 *  未实装 buff 返回 undefined，调用方静默跳过 */
export function buffTypeByVanilla(v: number): BuffType | undefined {
  return BUFF_TYPE_BY_VANILLA.get(v);
}

/** ★BJ755-A T1（2026-11-02,bj739a D-① 清偿）：msg50 远端 buff 栏 → 代理镜像
 *  裸写（MessageBuffer.cs:2462-2469 `buffType[n]=type; buffTime[n]=60` + 尾段
 *  Array.Clear 的 BuffState 等价）。
 *  · 裸写不走 apply（AddBuff 逻辑：免疫门/fed-state 换档/难度时长缩放/44 槽
 *    驱逐——原版 reader 即裸数组写,apply 族会破坏镜像（如专家难度 ×2 时长
 *    污染、免疫门丢条目））;
 *  · 时长=1s（60t 镜像;代理不跑 fixedUpdate 无 tick 递减=原版远端 60t 重置
 *    语义近似面,备案勿自造递减——任务书条款）;
 *  · 未映射 id（本仓 BUFF_DEFS 无档）跳过但不出错（原版 int 数组可存任意 id,
 *    本仓 BuffType 键域限已映射集——原始值仍留 RemotePlayerState.buffTypes,
 *    未来消费面（头顶图标）直读该数组不受此限）;
 *  · 消费=Game.simulateRemotePlayers（proxy.buffs 注入）;渲染消费面（头顶
 *    buff 图标/debuffTint）按任务书分期不在本刀。
 *  ★单机零扰动证：唯一调用点在 simulateRemotePlayers（net?.active 门内,
 *    单机不可达）;联机下 proxy.buffs 本无写入方（代理不走 buff 链）,
 *    镜像后集合=对端 msg50 集。 */
export function applyRemoteBuffMirror(buffs: BuffState, vanillaIds: readonly number[]): void {
  const want = new Set<BuffType>();
  for (const v of vanillaIds) {
    if (v <= 0) continue;
    const bt = BUFF_TYPE_BY_VANILLA.get(v);
    if (bt !== undefined) want.add(bt);
  }
  for (const t of [...buffs.active.keys()]) {
    if (!want.has(t)) buffs.active.delete(t);   // Array.Clear 尾段等价（缺席即清）
  }
  for (const t of want) buffs.active.set(t, 1); // buffTime=60t 镜像（1s）
}

/** Buff 名:原版 BuffName.<Internal>(Lang 未就绪回退中文兜底) */
export function buffName(t: BuffType): string {
  return Lang.buffName(BUFF_DEFS[t].vanillaBuff) ?? BUFF_DEFS[t].fallbackName;
}

/** Buff 描述:自有键(机制数值是本仓库实现,不用原版通用描述) */
export function buffDesc(t: BuffType): string {
  return Lang.text(BUFF_DEFS[t].descKey);
}

/** 旗帜 buff 描述附加名单（Main.cs:21558-21612 MouseText_DrawBuffTooltip 的
 *  bannerMouseOver 第二循环 1:1：按 BannerSystem 旗种枚举,BannerSystem.BannerToNPC(i)
 *  每面旗取一个代表 NPC → 一旗一行名；ids 须传【旗种代表集】（Game.bannerRepIds）,
 *  传全覆盖集会逐变体重名罗列。'\n' 分行由 DOM 气泡渲染端天然换行）。
 *  缺名 id 剔除（原版 GetNPCNameValue 恒有名；NPC_NAME_BY_ID 缺口防御）。 */
export function bannerBuffNames(ids: number[], nameOf: (id: number) => string | null): string {
  return ids.slice().sort((a, b) => a - b).map(nameOf).filter((s): s is string => !!s).join('\n');
}

/** HP/s 汇总表（UpdateBuffs lifeRegen 项换算：lifeRegen N = N/2 HP/s） */
const HP_PER_SEC: Partial<Record<BuffType, number>> = {
  [BuffType.Regen]: 2,   // lifeRegen+4
  [BuffType.Honey]: 1,   // lifeRegen+2
};

/** DoT 分块大小（Player.cs:19136-19204 结算 + HurtLifeRegen:19207）：burned/
 *  suffocating 走 -600 阈值分支 → 每 600 life-regen 点弹 HurtLifeRegen(5)；
 *  其余（OnFire 等）走通用 -120 分支 → 每 120 点弹 1。换算到时间：
 *  Burning(−60/t)=每 10t 弹 5（≈3 次/秒飘字）、Suffocation(−40/t)=每 15t 弹 5、
 *  OnFire(−8/t)=每 15t 弹 1。掉血须整块弹出并伴随 LifeRegen 色(255,60,70)
 *  dot 飘字（CombatText.cs:24 / NewText dot:true），非每帧静默 1 HP 滴流 */
const DOT_CHUNK: Partial<Record<BuffType, number>> = {
  [BuffType.Burning]: 5,
  [BuffType.Suffocation]: 5,
};

/** 环境 DoT 表（NaturalLifeRegen 原版求值顺序 1:1：poisoned→venom→onFire→
 *  onFire3→onFrostBurn→onFrostBurn2→onFire2→burned→suffocating→electrified；
 *  速率 = lifeRegen 负项 / 2 = HP/s）。★R21-⑥/BJ743-A（2026-10-31）行号双标注：
 *  1456 Player.cs:18775-18904 ↔ 1457 :19065-19202（diff 亲读仅两漂——①1457 于
 *  venom 后插叶绿孢子块 :19083-19091,1456 无此块（故该条锚 1457）;②1456 Burning
 *  段 moveSpeed*=0.5 :18881 在 1457 移入 strongestMoveSpeedDebuff,moveSpeedMult
 *  已注）。本注与表内条目行号锚缺省均为 1456 行号。每个 DoT 结算前先清零正
 *  lifeRegen——恢复类 buff 不能抵消 DoT（tick 内消费）。
 *  ★每段另伴 lifeRegenTime=0（爬坡计时清零）与 drippingSlime 翻倍（:18782 等）——
 *  前者=Player.ts lifeRegenTime 模型同门（受击 :37784/DoT :18781/流血 :19000 三源
 *  清零,Player.ts:1206-1230,旧"sinceHurt 近似"已废）;后者=Slimed(137) 翻倍,
 *  ★R21-⑦/BJ743-A 改判（原「未移植,登记 GAP」注退役）：BJ739 B11（2026-10-31）
 *  已实装（SLIME_DOUBLED_DOTS 六火族表）;OnFire 的 vampireSeed 翻番 slime 分支
 *  同支覆盖（1456 :18803-18805,见 VAMPIRE_ON_FIRE_HP_S 注） */
const ENV_DOTS: ReadonlyArray<readonly [BuffType, number]> = [
  [BuffType.Poisoned, -2],    // lifeRegen-4（:18782）
  [BuffType.Venom, -15],      // lifeRegen-30（:18791）
  [BuffType.OnFire, -4],      // lifeRegen-8（:18811；vampireSeed 世界 → -100=50HP/s,
  //  见 tick() VAMPIRE_ON_FIRE 分支 Player.cs:18798-18813——仅 buff 24,323 不吃）
  [BuffType.OnFire3, -4],     // lifeRegen-8（:18824）
  [BuffType.Frostburn, -8],   // lifeRegen-16（:18837）
  [BuffType.Frostburn2, -8],  // lifeRegen-16（:18850）
  [BuffType.CursedInferno, -12], // lifeRegen-24（:18862 onFire2 段）
  [BuffType.Burning, -30],    // lifeRegen-60（:18875，另 moveSpeed×0.5 在 strongestMoveSpeedDebuff）
  [BuffType.Suffocation, -20], // lifeRegen-40（:18889）
  [BuffType.Electrified, -4], // lifeRegen-8（:18899）；移动加成见 ELECTRIFIED_MOVE_EXTRA
  // 叶绿孢子 397 玩家侧 DoT（★2026-08-24 r15 R15-19：PL57:19082-19090
  //  lifeRegen -= 30 = 15 HP/s——与 NPC 侧 DOTTally 90 HP/s（:92755）不同轴,
  //  勿互搬；孢子云 1/60 发射器在 Player.fixedUpdate（需 game 钩子,不入本表）
  [BuffType.ChlorophyteSpore, -15],
  // ★G36-A D-⑥（BJ739 登记债清偿,2026-10-31）：狂卷之舌 38 专家档（UpdateLifeRegen
  //  :19203-19211 `if (tongued && Main.expertMode)` lifeRegen -= 100 = 50 HP/s;
  //  非专家无 DoT——tick 内 expertMode 门 skip）。曾独立账 Player.tongueDotAcc
  //  直扣 hp,专家舌+灼烧共享 -600 块的合并面偏差（量级守恒/节拍与蜂蜜对冲/星云
  //  免/闪亮石减半不入账）随本刀收口：入 ENV_DOTS 单账后 -600 块门
  //  `burned || suffocating || (tongued && expert)`（:19434）1:1。
  [BuffType.TheTongue, -50],
];
/** Electrified 移动惩罚（Player.cs:18900-18903：controlLeft||controlRight 时
 *  lifeRegen 额外 -32 → +16 HP/s）——tick 前由 Player.fixedUpdate 写入开关 */
const ELECTRIFIED_MOVE_EXTRA = -16;

/** ★BJ739 B11（2026-10-31）：drippingSlime（Slimed 137 在栏）翻倍的六火族 DoT
 *  （UpdateLifeRegen 各 DoT 段的第二 `if (drippingSlime) lifeRegen -= 同额` 项：
 *  onFire(24) :19110-19113（vampireSeed 段 :19102-19105 同）/onFire3(323)
 *  :19124-19127/onFrostBurn(44) :19137-19140/onFrostBurn2(324) :19150-19153/
 *  onFire2(39 诅咒焰) :19163-19166/burned(67) :19176-19179。窒息 :19188/感电
 *  :19197/中毒 :19172/毒液 :19181/叶绿孢子 :19190 无 slime 支——中毒/毒液不翻倍
 *  （issue#29 B11 边界）。 */
const SLIME_DOUBLED_DOTS: ReadonlySet<BuffType> = new Set([
  BuffType.OnFire, BuffType.OnFire3, BuffType.Frostburn, BuffType.Frostburn2,
  BuffType.CursedInferno, BuffType.Burning,
]);
/** vampireSeed 世界 OnFire 特档（Player.cs:18798-18802）：lifeRegen -100 = 50 HP/s
 *  （常规世界 -8 = 4 HP/s；slime 翻倍分支 :18803-18805——★R21-⑦/BJ743-A 改判：
 *  BJ739 B11 已实装,OnFire∈SLIME_DOUBLED_DOTS ⇒ vampireSeed+Slimed rate×2 =
 *  -100 HP/s（1456 :18803-18805 再 -100 = lifeRegen -200 同值）;原「依赖 Slimed
 *  未移植」注退役） */
const VAMPIRE_ON_FIRE_HP_S = -50;

export class BuffState {
  active = new Map<BuffType, number>(); // 剩余秒（≈buffTime/60）
  campfireAccum = 0;
  /** 本仓已实装的 debuff 集 = Main.debuff 全表 ∩ 已实装（Main.cs:9004-9079 写位
   *  76 项;环境伤害/控速/DoT/正面伪 debuff/光环短钉族全按原表归位——魔力眩晕 94
   *  亦在原版 debuff 表，护士可清）。
   *  消费面三处：① debuffCount（护士计价）② clearDebuffs（护士清除）
   *  ③ buffRightClickRemovable（★BJ405 右键取消门 ≡ TryRemovingBuff `!debuff[b]`
   *  Main.cs:44109——Main.debuff 全表机械对拍锁 tests/buff-rightclick-bj405）。
   *  ★ NurseCannotRemoveDebuff 排除表（BuffID.cs:32 = {28,34,87,89,21,86,199,332,
   *  333,334,165,146,48,158,157,350,215,147,321,43}）消费面已接：
   *  debuffCount/clearDebuffs 经 NURSE_CANNOT_REMOVE_VANILLA 反查 vanilla id 过滤
   *  （护士不计价也不清除该表成员——狼人 28/人鱼 34 等正面伪 debuff、篝火/水蜡烛等
   *  短钉光环、药水病 21、DD2 巨魔唾液期内 NoBuilding 199 等）；该表成员已按原表
   *  入集（右键面需要分类位）,护士面过滤在先零扰动。 */
  static readonly DEBUFFS = new Set<BuffType>([
    BuffType.OnFire, BuffType.Burning, BuffType.Bleeding, BuffType.Suffocation,
    BuffType.Chilled, BuffType.Weak, BuffType.Slow, BuffType.ManaSickness, BuffType.Poisoned,
    BuffType.Stoned,    // Main.debuff[156]=true（Main.cs:8842）；156 不在
                        // NurseCannotRemoveDebuff 排除表 → 石化可被护士计价清除
    // PvP debuff 族（原版 Main.debuff 表成员,护士可清）
    BuffType.Venom, BuffType.CursedInferno, BuffType.OnFire3, BuffType.Frostburn,
    BuffType.Frostburn2, BuffType.Confused, BuffType.Ichor, BuffType.BrokenArmor,
    BuffType.Electrified,  // Main.debuff[144]=true（Main.cs:8847）——感电可被护士清除
    // 敌弹 StatusPlayer 批（Main.debuff 全员 true：22/23=Main.cs:8805-8806、
    // 80=:8827、149=:8841、164=:8846、196=:8850；均不在护士排除表）
    BuffType.Darkness, BuffType.Cursed, BuffType.Blackout, BuffType.Webbed,
    BuffType.VortexDebuff, BuffType.WitheredWeapon,
    BuffType.Silenced,   // Main.debuff[35]=true（Main.cs:8815）；不在护士排除表
                         //（BuffID.cs:32）——红药水 678 减益族（2026-08-22 补 B 批）
    BuffType.Wet,      // Main.debuff[103]=true（Main.cs:8833）——潮湿可被护士计价清除；
                       // 103 不在 NurseCannotRemoveDebuff 排除表（BuffID.cs:30）
    BuffType.Slimed,   // ★BJ739 B11：Main.debuff[137]=true（1457 Main.cs:9040）——
                       // 右键不可解/护士可清;不在护士排除表
    // 终零波补档两条（2026-09-01；均不在护士排除表 → 可计价/可清除）
    BuffType.Dazed,      // 眩晕(160)——美杜莎之首 PvP 命中族（Main.cs:9005）
    BuffType.OgreSpit,   // 分泌物(197)——DD2 巨魔喷吐团消亡近身 900t(:74097)
    // ---- ★BJ405 补全批（2026-09-29）：Main.debuff 全表 1:1 对拍补档（1457
    //  Main.cs:9004-9079 写位 76 项 × 已实装 35 项缺档,机械对拍见
    //  tests/buff-rightclick-bj405「表审计」）。动机 = 本集新增第三消费面：右键
    //  取消门 buffRightClickRemovable ≡ TryRemovingBuff `!debuff[b]`（Main.cs:44109）。
    //  护士面零扰动：debuffCount/clearDebuffs 的 isNurseLockedBuff 过滤在先,
    //  排除表成员（{28,34,87,89,21,86,199,332,333,334,165,146,48,158,157,350,215,
    //  147,321,43} BuffID.cs:32）入集后依旧不计价不清除。槽位驱逐面更贴原版：
    //  AddBuff_ActuallyTryToAddTheBuff 驱逐首选 `!Main.debuff` 槽（:5317-5351）,
    //  debuff 标记成员本就不该被驱逐。
    //  A 组｜正面伪 debuff/光环短钉族（全在护士排除表 → 护士双滤不变）：
    BuffType.Werewolf,          // 狼人(28)——月相变身,变形态右键不可解（原版同）
    BuffType.Merfolk,           // 人鱼(34)——入水变身,同上
    BuffType.Resistance,        // 药水病(21)——喝药冷却,原版标记 debuff 禁右键
    BuffType.Campfire,          // 篝火(87)——篝火光环短钉（AddBuff(id,2)/t 族）
    BuffType.WaterCandle,       // 水蜡烛(86)——刷怪光环
    BuffType.HeartLamp,         // 心灯(89)——回血光环
    BuffType.Sunflower,         // 向日葵(146)——心情光环
    BuffType.PeaceCandle,       // 和平蜡烛(157)——减刷怪光环
    BuffType.StarInBottle,      // 瓶中星(158)——落星光环
    BuffType.ShadowCandle,      // 暗影蜡烛(350)——1457 刷怪光环
    BuffType.CatBast,           // 猫堡垒(215)——摆件光环
    BuffType.BrainOfConfusionBuff, // 混乱之脑(321)——大师伪反伤 buff（护士排除表内）
    BuffType.MonsterBanner,     // 旗帜(147)——战旗增益,右键不可解（原版同,旗杆光环每帧重挂）
    BuffType.NeutralHunger,     // 稍饿(332)——The Constant 饥饿链（右键/护士均不可解）
    BuffType.Hunger,            // 饥饿(333)——同上
    BuffType.Starving,          // 极饿(334)——同上
    //  B 组｜控制/减益缺档（不在护士排除表 → 护士可计价可清除 = 原版语义）：
    BuffType.Frozen,            // 冻结(47)——控制系（Warmth 在场时长÷2 的另一端）
    BuffType.Tipsy,             // 醉酒(25)——麦酒
    BuffType.ChaosState,        // 混沌态(88)——传送勺冷却惩罚
    BuffType.MoonLeech,         // 月蛭(145)
    BuffType.Obstructed,        // 阻碍(163)——石巨人拳头
    BuffType.WindPushed,        // 强风吹(194)——大风天推挤
    BuffType.WitheredArmor,     // 枯萎护甲(195)——DD2
    BuffType.Horrified,         // 恐惧(37)——肉山逃战
    BuffType.TheTongue,         // 血舌(38)——肉山拖拽
    BuffType.Rabies,            // 狂犬病(148)
    BuffType.Stinky,            // 恶臭(120)——臭屁瓶
    BuffType.Lovestruck,        // 热恋(119)——热恋药水
    BuffType.Shimmered,         // 微光浸没(353)——微光池（Player.ts:4670 每帧续钉）
    BuffType.GelBalloonBuff,    // 凝胶气球(320)
    //  C 组｜1457 敌弹 debuff 家族（enum 注「仅 StatusNPC 侧」已过时——凡在
    //  BUFF_DEFS 在册即可入 BuffState 出栏,分类按 Main.debuff 全表归位）：
    BuffType.PotentAcid,        // 强酸(395)
    BuffType.ChlorophyteSpore,  // 叶绿孢子(397)——玩家侧 DoT（ENV_DOTS 在册）
    BuffType.AcceleratePoisons, // 促毒(398)——催化腕带
    BuffType.BlueLightning,     // 蓝电(399)
    BuffType.RedLightning,      // 红电(400)
  ]);
  /** 活跃 debuff 计数（Main.GetNurseHealCost Main.cs:40752-40762 的 +100/个 段：
   *  `debuff[t] && buffTime>60 && !BuffID.Sets.NurseCannotRemoveDebuff[t]`） */
  debuffCount(minSeconds = 0): number {
    let n = 0;
    for (const [bt, sec] of this.active) {
      if (BuffState.DEBUFFS.has(bt) && sec > minSeconds
        && !isNurseLockedBuff(vanillaIdOfBuff(bt))) n++;
    }
    return n;
  }
  /** 清全部 debuff（NPCChatText_DoNurseHeal Main.cs:40822-40838 语义：
   *  排除表成员同门保留——DelBuff 只走 `!NurseCannotRemoveDebuff` 支） */
  clearDebuffs(): void {
    for (const bt of [...this.active.keys()]) {
      if (BuffState.DEBUFFS.has(bt) && !isNurseLockedBuff(vanillaIdOfBuff(bt))) this.active.delete(bt);
    }
  }
  /** 狼人回复独立累加器（:11496 lifeRegen++ 恒 0.5 HP/s，与篝火强度/节拍无关） */
  werewolfAccum = 0;
  /** 感电移动加成开关（Player.cs:18900 controlLeft||controlRight → lifeRegen 额外
   *  -32）：Player.fixedUpdate 在 buffs.tick 前按本帧 inputX!==0 写入（inputX 由
   *  Game.ts:2890 先于 :2931 fixedUpdate 注入，即原版 Update 时序的当帧输入） */
  electrifiedMoving = false;
  /** Main.vampireSeed（Main.cs:327；秘密种子世界位，NetMessage :363 同步）：
   *  On Fire!(24) 对玩家从 -8 提到 -100 lifeRegen（50 HP/s，Player.cs:18798-18802；
   *  drippingSlime 再翻到 -200 :18803-18805——★R21-⑦/BJ743-A 改判：Slimed(137)
   *  已随 BJ739 B11 实装,该翻番支经 OnFire∈SLIME_DOUBLED_DOTS 覆盖,原「未移植,
   *  登记」注退役）。
   *  接线 = Player.updateSunScorch 每帧自 world.seedFlags.vampireSeed 刷新
   *  （SeedEasterEggs "what a horrible night to have a curse"）。另 Main.cs:42715
   *  buff 图标 <10t 不显示秒数（buff 24/23/32）已接 UI.refreshBuffs */
  vampireSeed = false;
  /** ★G36-A D-⑦：闪亮石静止档门（UpdateLifeRegen :19060-19064 flag =
   *  shinyStone && IsConsideredStandingStill(:3307 |vx|<0.05&&|vy|<0.05) &&
   *  itemAnimation==0）——Player.fixedUpdate buffs.tick 前喂入;消费 = DoT 流量
   *  折半门（:19224-19227）。自然回复 boost 段（:19241-19249/:19333-19345）
   *  在 Player.ts shinyStill 同谓词,两消费位同拍喂值 */
  shinyStillGate = false;
  /** ★G36-A D-⑥：Main.expertMode（狂卷之舌 DoT 专家门 :19203 / -600 块门 :19434）
   *  ——Player.fixedUpdate buffs.tick 前喂入（mainExpertMode(world)） */
  expertMode = false;
  lanternAccum = 0;
  /** 当前篝火光环强度(Game 每 20tick 扫描写入:篝火+1,心灯额外+1) */
  campfireHeal = 1;
  /** 心灯(lifeRegen+2 = 1 HP/s,Player.cs:12247):Game 扫描写入 0/1 */
  lanternHeal = 0;
  /** AddBuff 语义（Player.cs:5138-5150）：同类取 max 不缩短——浸入类 buff 可每帧无脑续期 */
  /** Player.buffImmune（Player.cs:1398 数组语义子集）：vanilla buff id 集合。
   *  装备扫描（十字章族 885-904/1612/1613/1921/3781/5354）与 buff 驱动
   *  （黑曜石皮 1 → 免 24）每帧刷新；apply 门 = AddBuff :5052/:5068 */
  immuneVanilla = new Set<number>();
  /** ★三百六十四刀:mod buff 免疫(active t=mod 伪 vanilla id 直查;
   *  mod accEffect 通道 sw.playerImmune 每帧 add) */
  immuneMod = new Set<number>();
  /** DeadCellsPotionStation 在场(:5206 buff 时长×1.2)。★BJ250 收口为 buff 驱动：
   *  原版唯一置位源 = buff 366 在栏（UpdateBuffs :10273-10276 else-if 读 buffType[j]，
   *  :18478 每帧先清）——此前由 699 tile 邻域扫描代供，右键 buff 落地后改读 buff 栏
   *  （getter,无可写面；tile 扫描写点已随本刀摘除） */
  get deadCells(): boolean { return this.active.has(BuffType.DeadCellsPotionStation); }
  // ---- The Constant 饥饿链上下文（Player.fixedUpdate 每帧写入；BuffID 332/333/334）----
  /** Main.dontStarveWorld（"the constant" 种子）——饥饿链总开关（UpdateBuffs :9559 */
  dontStarveWorld = false;
  /** 玩家存活门（原版 UpdateDead 不跑 UpdateBuffs——死亡期饥饿链【冻结】而非剥离；
   *  Player.fixedUpdate 每帧写 !dead） */
  hungerPlayerAlive = true;
  /** Main.remixWorld && Main.dontStarveWorld（"don't dig up"+constant 组合）——
   *  332/333 时长 28800t（8min）替代 18000t（5min，:11701/:11760） */
  remixHunger = false;
  /** statLifeMax2（极饿掉血公式的分母基准，:18968/:19161）——Player 每帧写 */
  starvingMaxHp = 100;
  /** ZoneDesert || ZoneSnow（极饿周期直伤 ×2，:19166）——Player 每帧写 */
  starvingZoneBoost = false;
  /** 饥饿链事件回调（Player 注入：表情 146/147/148 + SoundID.Hungry）——
   *  UpdateHungerBuffs :11705/:11726 的 EmoteBubble.MakeLocalPlayerEmote + :11728 PlaySound */
  onHungerEvent: ((kind: 'neutral' | 'hungry' | 'starving') => void) | null = null;
  /** 极饿流干账——★BJ739 B09：随共享账重构退役（极饿流量直入 dotLifeRegenCount） */
  // private starvingHitAccum（退役字段,2026-10-31）
  /** 本 tick ENV_DOTS 是否有 DoT 流量在账（含被星云免掉的——原版 DoT 段照写
   *  lifeRegenTime=0,星云只免伤害不清爬坡;Player 消费于 lifeRegenTime 复位门） */
  dotActiveTick = false;
  /** ★BJ739 B09（2026-10-31）：DoT 共享整数账（vanilla Player.lifeRegenCount,
   *  Player.cs:1921 int / :19384 `lifeRegenCount += lifeRegen` 全流量单账 /
   *  :19434/:19458/:19478 三分块环）——单位=原版 lifeRegen/tick,120 单位=1HP。
   *  全 ENV_DOTS + 极饿覆写流量单账累积,余数跨 buff 组合/空档结转（断流拍清账,
   *  见 tick 注）。正流量面（自然回复/装备回复）在 Player 独立账,不入本账。 */
  private dotLifeRegenCount = 0;
  /** 星云生命套层数（buff 174-175 级数,Player 每帧写;UpdateLifeRegen :19220 消费）
   *  ★BJ747 A18（2026-10-31,issue#35）：双消费面 = ①负值钳 0（tick 内 :19220 位）
   *  ②正项 3 HP/s/级（UpdateBuffs :10538-39 `lifeRegen += 6×级`——DoT 清零面内,
   *  中毒期被清,原版中毒+星云净 0）;旧独立直写 hp 已拆除（Player 侧） */
  nebulaLifeLevel = 0;
  /** ★BJ747 A18：星云生命正项累加器（heal 账 HP 整数域,3 HP/s/级——分数余数跨拍
   *  结转 = 原版 lifeRegenCount 114/120 型残账同构） */
  private nebulaLifeHealAccum = 0;
  /** ★五百四十二:mod DoT 减免乘区(Reaver defense=DoT×0.5;【赋值】语义=每 tick
   *  mod 侧重写,缺省 1=无减免;ENV_DOTS 结算尾乘区——负 dot 减额回流 heal 对冲池) */
  modDotMult = 1;

  /** UpdateStarvingState（Player.cs:11743-11768）：无任何 fed-state（26/206/207/332/
   *  333/334）在栏 → 授予 332（remix 组合 28800t 否则 18000t）。原版在 UpdateBuffs
   *  顶部逐 tick 调（withEmote=true——表情 146）。调用方保证 !dead。 */
  updateStarvingState(withEmote: boolean): void {
    if (!this.dontStarveWorld || !this.hungerPlayerAlive) return;
    let fed = false;
    for (const t of FED_STATE_TYPES) {
      if ((this.active.get(t) ?? 0) > 0) { fed = true; break; }
    }
    if (!fed) {
      this.apply(BuffType.NeutralHunger, (this.remixHunger ? 28800 : 18000) / 60);
      if (withEmote) this.onHungerEvent?.('neutral');
    }
  }

  /** UpdateHungerBuffs（Player.cs:11686-11741）：链尾转移。原版在 UpdateBuffs 效果
   *  循环之后调（本实现挂在 tick 的递减循环后）：332 剩 ≤2t → 333；333 剩 ≤2t →
   *  334（5t）+ Hungry 音；非 constant 世界三态一律即刻剥离（:11711/:11731/:11736）。 */
  private updateHungerBuffs(): void {
    const twoTicks = 2 / 60 + 1e-9;
    const chainDur = (this.remixHunger ? 28800 : 18000) / 60;
    for (const t of [BuffType.NeutralHunger, BuffType.Hunger, BuffType.Starving] as const) {
      const left = this.active.get(t);
      if (left === undefined || left <= 0) continue;
      if (!this.dontStarveWorld) { this.active.delete(t); continue; }   // 非饥饿世界三态无意义
      if (!this.hungerPlayerAlive) continue;                            // 死亡冻结（不剥离不转移）
      if (t === BuffType.NeutralHunger && left <= twoTicks) {
        this.apply(BuffType.Hunger, chainDur);
        this.onHungerEvent?.('hungry');                                  // 表情 147（:11706）
      } else if (t === BuffType.Hunger && left <= twoTicks) {
        this.apply(BuffType.Starving, 5 / 60);                           // 334 恒 5t（:11722/:11725）
        this.onHungerEvent?.('starving');                                // 表情 148 + Hungry 音
      }
    }
  }

  /** TryToResetHungerToNeutral（Player.cs:11619-11634）：饥饿链三态（332/333/334）
   *  buffTime 全部清零——原版置 0 后 flag 分支再调 UpdateHungerBuffs（零时长槽在
   *  其循环头 buffTime>0 门被跳过,无链转移）；等价 = 删三键。下拍 UpdateStarvingState
   *  见栏空重新授 332（链从头计时）。消费面（IIIII219）：蘑菇 5（ApplyPotionDelay
   *  :52513 + ItemCheck_UsePotionStuff :5516 双调用点）/蛋奶酒 1912（:52507）——
   *  吃「无 fed buff 的疗药」把饥饿链拉回「稍饿」起点而非直接喂饱 */
  tryToResetHungerToNeutral(): void {
    let flag = false;
    for (const t of [BuffType.NeutralHunger, BuffType.Hunger, BuffType.Starving]) {
      if (this.active.delete(t)) flag = true;
    }
    if (flag) this.updateHungerBuffs();
  }

  apply(type: BuffType, durationSec: number) {
    // buffImmune 门（AddBuff :5052——免疫则直接 return，不掉已有同类 buff）
    const vb = BUFF_DEFS[type]?.vanillaBuff;
    if (vb !== undefined && this.immuneVanilla.has(vb)) return;
    // IsFedState 换档删旧（Player.cs:5080-5089：授予 26/206/207 任一档前先删
    // 已在栏的其它档——吃高档后低档即刻被顶掉；仅饱腹三档互换，不碰 max 合并
    // 通用语义）。循环内 DelBuff 逆序问题原版用正序逐槽 DelBuff，本仓 Map 删键无碍
    if (vb !== undefined && FED_STATE_VANILLA.has(vb)) {
      for (const t of FED_STATE_TYPES) {
        if (t !== type) this.active.delete(t);
      }
    }
    // DeadCellsPotionStation(:5206-5209——buff 1-18,104-117,121-124,257,343 时长 ×1.2)
    if (vb !== undefined && BUFF_TIME_EXTENDED_BY_DEAD_CELLS.has(vb) && durationSec > 0 && this.deadCells) {
      durationSec *= 1.2;
    }
    // D2 专家/大师 debuff 时长缩放（Player.cs:5211-5215+GameDifficultyData.cs:71:
    // BuffTimeIsExtendedWithGameDifficulty {20,22,23,24,323,30,31,32,33,35,36,39,44,324,46,47,69,70,80}
    // → Expert ×2 / Master ×2.5——仅时长,DoT 伤害不缩。2026-08-13）
    if (vb !== undefined && BUFF_TIME_EXTENDED_BY_DIFFICULTY.has(vb) && durationSec > 0) {
      const diff = scaleStatsWorld().difficulty;
      if (diff >= GDL.MASTER) durationSec *= 2.5;
      else if (diff >= GDL.EXPERT) durationSec *= 2;
    }
    // ★1.4.5.7 新增（1456 反编译 AddBuff 全链 :5066-5203 无 Warmth 分支；wiki
    // "Desktop 1.4.5.7" 条目）：resistCold（Warmth 124 在场）时施加 Chilled(46)/
    // Frozen(47) 时长 ÷4/÷2。本仓按 1457 保留（与 1456 标杆的偏差已备案）
    if (vb === 46 || vb === 47) {
      if (this.active.has(BuffType.Warmth)) durationSec /= (vb === 46 ? 4 : 2);
    }
    // ★同上 1.4.5.7：新获得 Warmth 时立即把已有 Chilled ÷4、Frozen ÷2（下限 5t）。
    // 原版只在"未续期已有 Warmth"分支调（AddBuff_TryUpdatingExistingBuffTime
    // 为真时不调）→ 已有 Warmth 时重复喝不重复削
    if (vb === 124 && !this.active.has(BuffType.Warmth)) {
      for (const [t, left] of this.active) {
        const v = BUFF_DEFS[t]?.vanillaBuff;
        if (v !== 46 && v !== 47) continue;
        if (left <= 5 / 60) continue;                      // num2 > 5 才削（:5304/:5306）
        this.active.set(t, Math.max(5 / 60, left / (v === 46 ? 4 : 2)));
      }
    }
    // ★BJ739 B06（2026-10-31）：浸剂互斥——AddBuff_RemoveOldMeleeBuffsOfMatchingType
    //  （1457 Player.cs:5352-5365：新浸剂入栏前删栏内【其它】meleeBuff 成员；Main.cs
    //  9100-9107 meleeBuff 表 = {71,73,74,75,76,77,78,79} 八浸剂）——调用位 :5284-89
    //  仅在 TryUpdatingExistingBuffTime 落空（=新授予，非续期）后执行。旧通用 apply
    //  无互斥 → 灵液+毒浸剂可同栏并存、命中链双施（issue#29 B06）。金浸剂 75 亦在
    //  表内（meleeBuff 全八员，互斥按原表）
    const cur = this.active.get(type);
    if (cur === undefined && vb !== undefined && MELEE_BUFF_VANILLA.has(vb)) {
      for (const [t] of [...this.active]) {
        const v2 = BUFF_DEFS[t]?.vanillaBuff;
        if (v2 !== undefined && v2 !== vb && MELEE_BUFF_VANILLA.has(v2)) this.active.delete(t);
      }
    }
    // R5-F20：槽位 44 上限（maxBuffs :1491）+ 满时驱逐第一个非 debuff 槽、
    // 全 debuff 则拒绝（AddBuff_ActuallyTryToAddTheBuff :5317-5351）——旧无上限。
    // 本仓 Map 无空槽概念,等价实现 = size≥44 时删首个非 debuff 键
    if (cur === undefined && this.active.size >= 44) {
      let evicted = false;
      for (const [t] of this.active) {
        if (!BuffState.DEBUFFS.has(t)) { this.active.delete(t); evicted = true; break; }
      }
      if (!evicted) return;
    }
    // R5-F18：AddBuffTimeAdditivelyToCap（BuffID.cs:34 + :5402-5410）——buff 94
    // 魔力眩晕加法叠至上限 600t、buff 383 腾灵 43200t;其余 max 合并不缩短
    //（:5411-5414）。旧一律 max 合并,魔瓶连喝眩晕时长不叠
    const addCapTicks = vb === 94 ? 600 : vb === 383 ? 43200 : 0;
    if (addCapTicks > 0) {
      this.active.set(type, Math.min(addCapTicks / 60, (cur ?? 0) + durationSec));
    } else if (cur === undefined || cur < durationSec) {
      this.active.set(type, durationSec);
    }
  }
  has(type: BuffType): boolean {
    return this.active.has(type);
  }
  remove(type: BuffType) {
    this.active.delete(type);
  }
  /** 死亡相清非持久 buff（★X4-债3 清偿 2026-09-29；UpdateDead Player.cs:17112-17117
   *  `for i<maxBuffs: if (buffType[i]<=0 || !Main.persistentBuff[buffType[i]])
   *  { buffTime[i]=0; buffType[i]=0; }`——裸字段写零，无音效/尘/飘字等视觉伴随，
   *  表现面=仅图标下帧消失。Main.persistentBuff（Main.cs:9337-9344）全程仅 8 项
   *  置真 = 武器浸剂八族 {71,73-79}（72 Midas 不在内——死亡连黄金浸剂也清），
   *  其余全表默认 false。本仓 PERSISTENT_BUFFS 按该表挂 vanillaBuff 判；表外
   *  （含无 vanilla 映射的自造 buff）一律按非持久清（原版无表项=persistentBuff
   *  数组默认 false=同判）。调用点：Player.fixedUpdate 死亡分支每 tick（原版
   *  UpdateDead 每帧跑同幂等）；幽灵相不走此路（buff 在死亡相已清空） */
  clearNonPersistent(): void {
    for (const [t] of [...this.active]) {
      const v = BUFF_DEFS[t]?.vanillaBuff;
      if (v === undefined || !PERSISTENT_BUFFS.has(v)) this.active.delete(t);
    }
  }
  /** 直写剩余秒（原版 `buffTime[i] = n` 赋值语义，可缩短——区别于 apply 的
   *  AddBuff max 合并）。消费方：玩家微光穿落 buffTime=6t 刷新（Player.cs:11416） */
  set(type: BuffType, durationSec: number) {
    this.active.set(type, durationSec);
  }
  /** 存档序列化（Player.cs:55518-55530 写 / :56243-56252 读——buffType Int32 +
   *  buffTime Int32【tick 域】,往返逐位无损）:
   *  存 vanilla id + 剩余秒（JSON 浮点域,1/60 整数倍）;Main.buffNoSave 名单
   *  (Main.cs:8896-8990)过滤不落盘的 buff。
   *  ★BJ742-A R21-⑥（2026-10-31）：保 tick 精度——旧 Math.round(sec) 整秒化,
   *  存档往返每 buff 至多 +0.5s 膨胀（药水病 21 等 ApplyPotionDelay
   *  Player.cs:52487-52516 的 2400-4200 随机 tick 档经往返系统性偏移;报告锚
   *  :52487 即该生产端）。现 Math.round(sec*60)/60 重钉 1/60 网格=原版 tick 语义;
   *  下限 1t（0.05s 过滤后恒 ≥3t,防御位）。读侧 applySaved 直收浮点,旧档整秒
   *  值兼容。★同病登记（D-BJ742-⑥）：PlrImport.ts:303 .plr 导入
   *  `Math.max(1, Math.round(time/60))` 同整秒化 + :627 导出 round 回 tick——
   *  tick→秒→tick 双掷漂移 ≤30t,导入面另刀。 */
  toSave(): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const [t, sec] of this.active) {
      const v = BUFF_DEFS[t]?.vanillaBuff;
      if (v === undefined || BUFF_NO_SAVE.has(v)) continue;
      // 亚 0.05s 残余 = 每帧续钉型环境光环稳态（Player.cs:25723-25764 AddBuff(id,2)
      // → 2t=1/30s;原版存原始 2t,读档即刻消散）。本仓序列化强制 ≥1s 会造读档后
      // ~1 秒的"1 秒/0 秒"幻影倒计时——亚 50ms 一律不落盘
      if (sec < 0.05) continue;
      out.push([v, Math.max(1 / 60, Math.round(sec * 60) / 60)]);
    }
    return out;
  }
  /** 读档恢复（旧档/导入缺省=无 buff;未知 vanilla id 静默丢弃——后续接入的 buff 不丢档） */
  applySaved(list: Array<[number, number]> | undefined): void {
    if (!list) return;
    for (const [v, sec] of list) {
      if (BUFF_NO_SAVE.has(v)) continue;
      const t = BUFF_TYPE_BY_VANILLA.get(v);
      if (t !== undefined) this.active.set(t, sec);
    }
  }
  /** 本帧弹出的 DoT 分块伤害合计（HurtLifeRegen 语义,Player 消费后弹出飘字并清零） */
  private dotChunkOut = 0;
  consumeDotChunk(): number {
    const c = this.dotChunkOut;
    this.dotChunkOut = 0;
    return c;
  }
  /** 每逻辑帧（dt 秒）。返回本帧生命净变化（正=回复,负=持续伤害/DoT,无视无敌帧与防御） */
  tick(dt: number): number {
    let heal = 0;
    // ---- 饥饿链（UpdateBuffs :9559-9561 顶部 UpdateStarvingState → 递减 → :11636
    //      UpdateHungerBuffs；死亡态整体冻结（UpdateDead 无该链）----
    this.updateStarvingState(true);
    for (const [t, time] of [...this.active]) {
      // ★BJ739 B01/B02：不递减表门（Player.cs:9958）——工位六站/极饿 334/狼人 28
      //  的 buffTime 不随 tick 减少（详表注 TIME_LEFT_DOES_NOT_DECREASE）
      const vbTick = BUFF_DEFS[t]?.vanillaBuff;
      if (vbTick !== undefined && TIME_LEFT_DOES_NOT_DECREASE.has(vbTick)) continue;
      const left = time - dt;
      if (left <= 0) this.active.delete(t);
      else this.active.set(t, left);
    }
    // 链尾转移（UpdateHungerBuffs :11636——在递减之后、效果聚合之前） */
    this.updateHungerBuffs();
    // ---- 免疫即除已有（Player.Update :26213-26218：每帧扫 buffImmune[type] →
    //      DelBuff）——R5-F19：旧 immuneVanilla 只挡新增（apply 门 :5057）,已挂
    //      OnFire 时装黑曜石头骨原版下帧熄火,我方烧满时长。递减后执行同原版序 ----
    if (this.immuneVanilla.size > 0 || this.immuneMod.size > 0) {
      for (const [t] of [...this.active]) {
        const v = BUFF_DEFS[t]?.vanillaBuff;
        if ((v !== undefined && this.immuneVanilla.has(v)) || this.immuneMod.has(t)) this.active.delete(t);
      }
    }
    // ---- UpdateBuffs 正项（Player.cs:9640+）：Regeneration lifeRegen+=4（2 HP/s,
    //      :10036-10039）、狼人 :11496 lifeRegen+=1（0.5 HP/s）。
    //      注意原版这些都在 NaturalLifeRegen 的 DoT 段（:19065+）**之前**求值——
    //      DoT 的 if(lifeRegen>0) lifeRegen=0 会把它们整池清零（见下）。
    //      ★Honey(48) 的 UpdateBuffs case（:10158-10161）只置 honey 旗——其 lifeRegen
    //      贡献全在 UpdateLifeRegen 内（:19212 对冲档 + :19250-19254 flat +2）,位于
    //      DoT 段【之后】不被清零。R5 蓝队勘误：旧把 1HP/s 正项放在 DoT 前被清零,
    //      DoT+蜂蜜期间少回 1HP/s,已移到 DoT 后（见下方 honeyFlat）----
    // ★BJ739 B07（2026-10-31）：狂犬病 148 随机短减益（1457 Player.cs:11412-437
    //  UpdateBuffs buffType==148 支——每帧 Next(1200)==0 掷,Next(6) 六选一 +
    //  num18=Next(60,100)×0.01 系数：22 黑暗×3 / 23 诅咒×0.75 / 31 困惑×1.5 /
    //  32 缓慢×3.5 / 33 虚弱×5 / 35 沉默×1（t = (int)(60×num18×因子),AddBuff 经
    //  apply 含专家/大师时长延展表——22/23/31/32/33/35 全在 BuffID.cs:28 集内）。
    //  位次 = 免疫摘除后、正项聚合前（原版在 buff 槽循环效果段头部）。随机源 =
    //  Math.random（战斗掷族先例：Enemy 脑臂同式）
    if (this.active.has(BuffType.Rabies) && Math.floor(Math.random() * 1200) === 0) {
      const num17 = Math.floor(Math.random() * 6);
      const num18 = (60 + Math.floor(Math.random() * 40)) * 0.01;   // Next(60,100)×0.01 ∈ [0.6,0.99]
      const dur = (mul: number) => Math.max(1, Math.trunc(60 * num18 * mul) / 60);
      switch (num17) {
        case 0: this.apply(BuffType.Darkness, dur(3)); break;
        case 1: this.apply(BuffType.Cursed, dur(0.75)); break;
        case 2: this.apply(BuffType.Confused, dur(1.5)); break;
        case 3: this.apply(BuffType.Slow, dur(3.5)); break;
        case 4: this.apply(BuffType.Weak, dur(5)); break;
        case 5: this.apply(BuffType.Silenced, dur(1)); break;
      }
    }
    heal += this.rateAccum(BuffType.Regen, 2, dt);
    // 树妖祝福 165（:9986 lifeRegen += 6 = 3 HP/s）——同在 UpdateBuffs 正项段，
    // NaturalLifeRegen 求值于其后（与 Regen 同批，可被 DoT 清零）
    heal += this.rateAccum(BuffType.DryadsWard, 3, dt);
    if (this.active.has(BuffType.Werewolf)) {
      // 狼人 lifeRegen++（:11496）= 0.5 HP/s → 每 2 秒恒 1 HP（独立累加器，勿与篝火
      // 共用 campfireAccum/campfireHeal——曾误挂致篝火不在时狼人回复随强度归零/错峰）
      this.werewolfAccum += dt;
      if (this.werewolfAccum >= 2) { this.werewolfAccum -= 2; heal += 1; }
    }
    // ★BJ747 A18（2026-10-31,issue#35）：星云生命 173-175 正项入公共 heal 账
    //   （1457 Player.cs:10538-10539 UpdateBuffs `lifeRegen += 6 * nebulaLevelLife`
    //   = 3 HP/s/级）。层位 = UpdateBuffs 正项段（Regen/树妖/狼人同段）——在下方
    //   DoT 段 `if (heal > 0) heal = 0` 清零面【内】：原版 UpdateBuffs 先于
    //   UpdateLifeRegen,中毒期星云正项先被清（净 0,星云只钳负值 0 见 :19220 位
    //   flow 钳）；旧实现 = Player 独立直写 hp 绕过清零 → 中毒期间仍 +3HP/s/级
    //   （issue#35 A18）。
    if (this.nebulaLifeLevel > 0) {
      this.nebulaLifeHealAccum += 3 * this.nebulaLifeLevel * dt;
      if (this.nebulaLifeHealAccum >= 1) {
        const n = Math.floor(this.nebulaLifeHealAccum);
        this.nebulaLifeHealAccum -= n;
        heal += n;
      }
    }
    // ---- DoT 段（NaturalLifeRegen :18779-18911 + UpdateLifeRegen 共享计数
    //      :19384/:19434-19478）★BJ739 B09（2026-10-31）：全 DoT 单账 lifeRegenCount
    //      （单位=原版 lifeRegen/tick，120 单位=1HP）——多 DoT 余数合并、节拍按
    //      原版 -600/-120 分块规则。旧 per-buff rateLeft 各存计数 → 组合 DoT 节拍
    //      错（OnFire+Poisoned 10/20/30 帧 0/-1/-3，应 -1/-2/-3）+ buff 空档残余
    //      负量保留（ENV_DOTS 循环 continue 跳过 rateAccum 清账分支,毒 15t→空档
    //      →再毒首块提前，issue#29 B09）。每个 DoT 仍先 if(lifeRegen>0) lifeRegen=0
    //      ——恢复类 buff 不能抵消 DoT。分块规则 1:1：
    //      burned/suffocating → 每 -600 弹 5（:19434-4456）；极饿 → 每 -num13 弹
    //      num12×(沙/雪?2)（:19458-4476）；其余 → 每 -120 弹 min(count/-120,4)
    //      爆发（:19478-4506）。净伤害记入 dotChunkOut 供 HurtLifeRegen 飘字消费 ----
    let dots = 0;       // 本 tick 弹出的 DoT 分块合计（HP 口径,负）
    let flow = 0;       // 本 tick lifeRegen 单位流量（负;极饿=覆写值）——120×HP/s×dt
    let dotFlow = false;   // DoT 流量在账（非块发射瞬间——对冲门/再生复位用流量口径）
    for (const [t, hpPerSec] of ENV_DOTS) {
      if (!this.active.has(t)) continue;
      if (heal > 0) heal = 0;                       // :18781 等 if (lifeRegen > 0) lifeRegen = 0
      // Electrified 移动惩罚（Player.cs:18900-18903：controlLeft||controlRight 时
      // lifeRegen 额外 -32 = 16 HP/s）——仅感电段专属，逐 tick 生效
      let rate = hpPerSec;
      if (t === BuffType.Electrified && this.electrifiedMoving) rate += ELECTRIFIED_MOVE_EXTRA;
      // vampireSeed OnFire 特档（Player.cs:18798-18802）：-8 → -100 lifeRegen
      // （4 → 50 HP/s）。仅 buff 24——onFire3(323) 恒 -8（:18819-18827 无该分支）
      if (t === BuffType.OnFire && this.vampireSeed) rate = VAMPIRE_ON_FIRE_HP_S;
      // ★BJ739 B11：Slimed(137) drippingSlime 火族 DoT 翻倍（:19102-19113 onFire
      //  含 vampireSeed 双段各再 -100/:19124-27 onFire3/:19137-40 onFrostBurn/
      //  :19150-53 onFrostBurn2/:19163-66 onFire2/:19176-79 burned——六火族各
      //  「lifeRegen -= 同额」二次项;窒息/感电/中毒/毒液无此支）。vampireSeed 特档
      //  rate 已是 -100 单位口径,翻倍 = -200 = :19101+:19104 两段之和 ✓
      if (this.active.has(BuffType.Slimed) && SLIME_DOUBLED_DOTS.has(t)) rate *= 2;
      // ★G36-A D-⑥：狂卷之舌仅专家档计流（:19203 `tongued && Main.expertMode`——
      //  非专家无 DoT 段,skip 即零贡献;expertMode 由 Player.fixedUpdate 喂入）
      if (t === BuffType.TheTongue && !this.expertMode) continue;
      flow += rate * 120 * dt;                      // HP/s → lifeRegen 单位流量
      dotFlow = true;
    }
    this.dotActiveTick = dotFlow;
    // ---- 蜂蜜对冲（:19212-19219 flow 域：lifeRegen<0 → +4/tick 钳 ≤0）★BJ739 B09：
    //      BJ447 的「块兑付账 honeyOffsetUnits」随共享账重构退役——原版对冲作用在
    //      【流量】上（每 tick -56 而非 -60 的 Burning），弹出块恒原额（5）只是
    //      节拍放缓;BJ447 块抵减模型（5,5,4 节拍）系分块架构时期的等价近似,净流率
    //      两模型一致,本刀回归原版逐拍形态（bj447 ④/bj443 对冲断言随刀改判）。
    //      极饿期不生效：原版 :19255 覆写在 :19212 之后,对冲与 flat 全被抹掉 ----
    if (flow < 0 && this.active.has(BuffType.Honey) && !this.active.has(BuffType.Starving)) {
      flow = Math.min(0, flow + 240 * dt);          // :19214 +4 单位/tick = +2 HP/s
    }
    // ---- 星云生命套 DoT 全免（UpdateLifeRegen :19220-19223：`lifeRegen < 0 &&
    //      nebulaLevelLife > 0 → lifeRegen = 0`——位于 ENV_DOTS 之后、极饿段之前,
    //      故【极饿不掉免】（极饿 :19275 覆写在其后,星云免不掉极饿流）。R5-F1：
    //      旧只做 +3HP/s/级正项,负项照扣,已补）----
    if (flow < 0 && this.nebulaLifeLevel > 0) flow = 0;
    // ★G36-A D-⑦（BJ739 登记债清偿,2026-10-31）：闪亮石静止档 DoT 减半
    //  （UpdateLifeRegen :19224-19227 `if (flag && lifeRegen < 0) lifeRegen /= 2`——
    //  flag=shinyStone&&IsConsideredStandingStill&&itemAnimation==0,:19061-19064。
    //  位序=星云免（:19220）之后、极饿覆写（:19255）之前：蜂蜜对冲（:19212）先加
    //  后折半、极饿整值覆写不吃折半。lifeRegen 为 C# int（/2 截断）——本仓 flow
    //  连续域折半,标准 60Hz 拍 DoT 流量恒偶单位=逐位等价）
    if (flow < 0 && this.shinyStillGate) flow /= 2;
    // ★五百四十二:mod DoT 减免乘区(C# CalamityPlayerLifeRegen :285-287 Reaver
    //  defense helm=totalNegativeLifeRegen ×(1−0.5)——减额口径=乘后余量;
    //  【赋值】语义=每 tick mod 侧重写,缺省 1=无减免)
    if (flow < 0 && this.modDotMult < 1) flow *= this.modDotMult;
    // ---- 极饿 334 覆写（Player.cs :19255-19276）：lifeRegen = -num2 整值覆写
    //      （num2=max(4,⌊120×maxLife/3000⌋)——C# int 除法;DoT/蜂蜜流量全部丢弃）,
    //      逐 tick 入共享账,每 -num13（=120×num12,num12=max(2,⌊maxLife/50⌋)）结算
    //      一次 num12 伤（ZoneDesert/ZoneSnow → dmg×2,流速不变 :19465）----
    if (this.active.has(BuffType.Starving)) {
      if (heal > 0) heal = 0;                      // :19257-19260 清正项
      const num2 = Math.max(4, Math.floor(120 * this.starvingMaxHp / 3000));   // C# int 除
      flow = -num2 * 60 * dt;                      // :19275 覆写（U/tick × 60t/s × dt）
    }
    // ---- 共享账入账 + 分块结算（:19384 → :19434/:19458/:19478）----
    this.dotLifeRegenCount += flow;
    if (!dotFlow && !this.active.has(BuffType.Starving) && this.dotLifeRegenCount < 0) {
      // ★BJ739 B09：负流量断流拍残账回收——原版 lifeRegenCount 单账由自然回复正
      //  流量逐 tick 对冲回收（:19384 无条件累加 + :19407 正兑付环）;本仓正流量
      //  在 Player 独立账（regenAccum）,等价近似 = 断流拍清残账（净额守恒:残账
      //  <120 单位=亚 HP 尘埃;不清 = 毒 15t→空档→再毒的首块假提前,issue#29 B09
      //  第二观测面。IIIII219 极饿毛刺清账同判并入）
      this.dotLifeRegenCount = 0;
    }
    {
      const burnedOrSuffocating = this.active.has(BuffType.Burning)
        || this.active.has(BuffType.Suffocation)
        // ★G36-A D-⑥：-600 共享块门三源（:19434 `burned || suffocating ||
        //  (tongued && Main.expertMode)`——专家舌与灼烧同块结算/同节拍,量级与
        //  原版合并账一致;死亡文案链 tongued 优先级见 Player 消费位注）
        || (this.active.has(BuffType.TheTongue) && this.expertMode);
      if (burnedOrSuffocating) {
        // :19434-4456（含 return 语义:跳过极饿/通用环——本块 if/else-if 同构）
        while (this.dotLifeRegenCount <= -600 + 1e-9) {
          this.dotLifeRegenCount += 600;
          dots -= 5; heal -= 5;                     // HurtLifeRegen(5)
        }
      } else if (this.active.has(BuffType.Starving)) {
        const num12 = Math.max(2, Math.floor(this.starvingMaxHp / 50));
        const num13 = 120 * num12;                  // :19466
        while (this.dotLifeRegenCount <= -num13 + 1e-9) {
          this.dotLifeRegenCount += num13;
          const hit = num12 * (this.starvingZoneBoost ? 2 : 1);  // :19465 沙漠/雪原 dmg×2
          dots -= hit; heal -= hit;
        }
      } else {
        // :19478-4506：num14 = min(⌊count/-120⌋,4) 追赶爆发
        while (this.dotLifeRegenCount <= -120 + 1e-9) {
          const n = Math.min(Math.floor(-this.dotLifeRegenCount / 120), 4);
          this.dotLifeRegenCount += 120 * n;
          dots -= n; heal -= n;                     // HurtLifeRegen(num14)
        }
      }
      if (dots < 0) this.dotChunkOut += -dots;
    }
    // 蜂蜜 flat 正项（UpdateLifeRegen :19250-19254：honey → lifeRegenTime+=2、
    // lifeRegen+=2 = 1 HP/s——位于 DoT/对冲段后不被清零,R5 蓝队勘误移出正项池）。
    // ★极饿期不生效：原版 :19255 极饿 lifeRegen = -num2 是【整值覆写】,把
    //   :19212 对冲与 :19252 flat 两笔蜂蜜全部抹掉（蓝队勘误补的门）
    if (this.active.has(BuffType.Honey) && !this.active.has(BuffType.Starving)) {
      heal += this.rateAccum(BuffType.Honey, 1, dt);
    }
    // ---- 光环正项（NaturalLifeRegen :18988-18993，位于 DoT 段之后——篝火/心灯
    //      的 lifeRegen 按原版可对冲 DoT）----
    if (this.active.has(BuffType.Campfire)) {
      // 原版 lifeRegen+1 = 0.5 HP/s(Player.cs:18990/12244-12245)→ 每 2 秒 1 HP
      this.campfireAccum += dt;
      if (this.campfireAccum >= 2) {
        this.campfireAccum -= 2;
        heal += this.campfireHeal;
      }
    }
    if (this.lanternHeal > 0) {
      this.lanternAccum += dt;
      if (this.lanternAccum >= 1) {
        this.lanternAccum -= 1;
        heal += this.lanternHeal;
      }
    }
    return heal;
  }
  /** 定额回复/伤害 buff 的独立累加器（Map 存每 buff 的秒余数;负速率=DoT）。
   *  separate=true 用独立累加器键(蜂蜜对冲与常规蜂蜜回复分账,避免共用余数)。
   *  负速率按 DOT_CHUNK 整块弹出（≈原版 lifeRegenCount 阈值分块）。已知偏差:
   *  原版 lifeRegenCount 是全局共享计数器,buff 到期后负余量仍残留(由后续
   *  DoT/自然回复对冲);本实现 per-buff 累加器到期即弃余数(<1 块,≤4 HP,一次性) */
  private rateLeft = new Map<string, number>();
  private rateAccum(t: BuffType, hpPerSec: number, dt: number, separate = false): number {
    if (!this.active.has(t)) { this.rateLeft.delete(`${t}:${separate}`); return 0; }
    const key = `${t}:${separate}`;
    let left = (this.rateLeft.get(key) ?? 0) + hpPerSec * dt;
    let heal = 0;
    if (hpPerSec >= 0) {
      while (left >= 1) { left -= 1; heal += 1; }
    } else {
      const chunk = DOT_CHUNK[t] ?? 1;
      // 原版 lifeRegenCount 是整数累加（-600/-120 阈值精确）;此处 dt 浮点积分
      // 在块边界会差 ~1e-15（如 1/3×15=4.999…）,补 epsilon 保证阈值时点对齐
      while (left <= -chunk + 1e-9) { left += chunk; heal -= chunk; }
    }
    this.rateLeft.set(key, left);
    return heal;
  }
  // ---- 属性聚合（幂等读取，不做副作用写入）----
  /** ★BJ739 B03（2026-10-31）：加法池重构——原版 moveSpeed 是单加算字段（ResetEffects
   *  :25688 清 1f → UpdateBuffs :25763 逐 buff += → UpdateEquips :25830 装备 += →
   *  Update 尾才乘 strongestMoveSpeedDebuff/特殊乘区）。蛋糕/狼人/虚弱曾被拆成乘区
   *  （×1.2/×1.05/×0.9）与迅捷基乘 1.25 复合 → 组合面系统性偏快（迅捷+蛋糕 1.50
   *  应 1.45、迅捷+10% 配饰 1.375 应 1.35，issue#29 B03）。本 getter = 1+Σ buff
   *  加算项（向日葵第一步 +0.1 同入池；第二步 ×1.1 单列 sunflowerMoveMult，消费端
   *  在【buff 加算池之后、装备加算之前】施加——终值=(1+B)×1.1+E（Player.
   *  moveSpeedPool；=原版 UpdateBuffs 两步→UpdateEquips 装备 += 在后序））。装备
   *  加算由 Player 侧 moveSpeedMult+(equipStats.moveMult-1) 同池合成。
   *  ★R21-⑧/BJ743-A（2026-10-31）向日葵槽位序约定补注（Webbed 同款「以本序为约」）：
   *  原版两步同槽相邻（:11089 +=0.1 → :11090 ×=1.1）——严格槽序下仅先于该槽的
   *  buff（kite :10003/糖分 :10026/迅捷 :10042）吃 ×1.1,其后槽位（webbed :11964/
   *  狼人 :11991/虚弱 :12004/食物 :12032+）不吃;本池以【全 buff 先加后乘】为约
   *  （既定解读,与 Webbed 序注同款钉法,勿按槽序重拆）。Webbed = 赋值清池
   *  （:11964 moveSpeed=0f，其后 kite/食物 += 档照加——既有序解读保持，原版槽序
   *  依赖以本序为约）。 */
  get moveSpeedMult(): number {
    // 1457: Burning/Slow/Chilled 三项从 moveSpeed 乘法链移除（Update :26132-26165
    // 改折入 strongestMoveSpeedDebuff 取最强不叠加；1456 为 else-if 乘法链）
    let m = 1;
    if (this.active.has(BuffType.Agility)) m += 0.25;        // Swiftness moveSpeed += 0.25（:10042）
    if (this.active.has(BuffType.Sunflower)) m += 0.1;       // 向日葵第一步 moveSpeed += 0.1（:11089）
    if (this.active.has(BuffType.Weak)) m -= 0.1;            // 虚弱 moveSpeed -= 0.1（:12004）
    if (this.active.has(BuffType.Werewolf)) m += 0.05;       // 狼人 moveSpeed += 0.05（:11991）
    if (this.active.has(BuffType.SugarRush)) m += 0.2;       // 糖分冲刺 moveSpeed += 0.2（:10026）
    if (this.active.has(BuffType.Webbed)) m = 0;             // Webbed moveSpeed = 0（:11964 赋值非乘算）
    if (this.active.has(BuffType.KiteBuff)) m += 0.15;       // 风筝 moveSpeed += 0.15（★1457 :10003；旧 1456 钉 0.25 已反转）
    m += [0, 0.2, 0.3, 0.4][this.wellFedTier];               // 食物 moveSpeed += 0.2/0.3/0.4（:12032/:12048/:12064）
    return m;
  }
  /** ★BJ739 B03：向日葵第二步 moveSpeed *= 1.1（:11090）——独立乘区；原版 Update 序
   *  （UpdateBuffs 两步 → UpdateEquips 装备 += 在后）⇒ 终值 = (1+buff 加算)×1.1+装备
   *  加算。消费端 Player 移速四处合成位 */
  get sunflowerMoveMult(): number {
    return this.active.has(BuffType.Sunflower) ? 1.1 : 1;
  }
  /** 1457 新机制 strongestMoveSpeedDebuff（Player.cs:26132-26165）：移动减速 debuff
   *  全部折算 min 只取最强单项不叠加——OgreSpit(197) 1/3、Dazed(160) 1/3、
   *  Burning 0.5、Slow 0.5、Chilled 0.75、盾举(shieldRaised,Player 侧) 1/3。
   *  197/160 玩家侧已入档（终零波 护士经济簇批,2026-09-01）——生产位登记见
   *  BuffType.Dazed/OgreSpit 注。消费：Update 尾 moveSpeed *= 本值；accRunSpeed
   *  *= 本值（oldStyleParkour 豁免臂已接——Player.ts Run 段 parkourBook 门,
   *  equipStats.oldStyleParkour 由 6190 旧世界跑酷指南全物品栏在场授予） */
  get strongestMoveSpeedDebuff(): number {
    let s = 1;
    if (this.active.has(BuffType.Burning)) s = Math.min(s, 0.5);   // :26144-26146
    if (this.active.has(BuffType.Slow)) s = Math.min(s, 0.5);      // :26147-26149
    if (this.active.has(BuffType.Chilled)) s = Math.min(s, 0.75);  // :26150-26152
    // 终零波补档两条（Player.Update 尾折算段同位点）：巨魔唾液 197（:26129-26132）/
    // 眩晕 160 dazed（:26138-26140）均 ×1/3 最强单取 min 不叠加
    if (this.active.has(BuffType.Dazed)) s = Math.min(s, 1 / 3);
    if (this.active.has(BuffType.OgreSpit)) s = Math.min(s, 1 / 3);
    return s;
  }
  get defenseBonus(): number {
    let d = this.active.has(BuffType.Ironskin) ? 8 : 0;     // Ironskin statDefense += 8（1456）
    if (this.active.has(BuffType.CatBast)) d += 5;          // 猫堡垒 statDefense += 5（:9778）
    if (this.active.has(BuffType.Tipsy)) d -= 4;            // 醉酒 statDefense -= 4（:11514）
    if (this.active.has(BuffType.Weak)) d -= 4;              // 虚弱 statDefense -= 4（:11509）
    if (this.active.has(BuffType.Ichor)) d -= 15;           // 灵液 statDefense -= 15（ResetEffects）
    if (this.active.has(BuffType.Werewolf)) d += 3;         // 狼人 statDefense += 3（:11497）
    if (this.active.has(BuffType.DryadsWard)) d += 8;       // 树妖祝福 statDefense += 8（:9987）
    d += [0, 2, 3, 4][this.wellFedTier];                    // 食物 statDefense += 2/3/4（:11524+）
    d += [0, -2, -4][this.hungerTier];                      // 饥饿 -2 / 极饿 -4（:11563/:11586）
    return d;
  }
  /** 饥饿档位：0 无 / 1 饥饿(333) / 2 极饿(334)（332 稍饿无属性效果） */
  get hungerTier(): 0 | 1 | 2 {
    if (this.active.has(BuffType.Starving)) return 2;
    if (this.active.has(BuffType.Hunger)) return 1;
    return 0;
  }
  /** 饥饿/极饿全系伤害 -5%/-10%（meleeDamage 等 += -0.05/-0.1，:11564+/:11587+） */
  get hungerDamage(): number {
    return [0, -0.05, -0.1][this.hungerTier];
  }
  /** 饥饿/极饿全系暴击 -2/-4（:11562+/:11585+） */
  get hungerCrit(): number {
    return [0, -2, -4][this.hungerTier];
  }
  /** 饥饿/极饿近战速度 -5%/-10%（meleeSpeed += -0.05/-0.1，:11566+/:11589+） */
  get hungerMeleeSpeed(): number {
    return [0, -0.05, -0.1][this.hungerTier];
  }
  /** 饥饿/极饿镐速 +5%/+15%（pickSpeed += 0.05/0.15，:11571/:11595——变慢挖掘） */
  get hungerPickSpeed(): number {
    return [0, 0.05, 0.15][this.hungerTier];
  }
  /** 召唤击退 buff 加算（MinionProj 裸 kb 之上加）。★BJ739 B14/B15（2026-10-31）
   *  改判：三档食物 +0.5/+0.75/+1（1457 Player.cs:12031/12047/12063 `minionKB +=
   *  0.5f/0.75f/minionKB++`——旧面整缺,issue#29 B14）；醉酒 25 **无** minionKB 项
   *  （:12006-12017 全支无——旧注「醉酒 +1（:11520）」锚漂进宠物段=错锚,issue#29
   *  B15 摘除）;饥饿 -0.5（:12079）/极饿 -1（:12094）保持。fed-state 互斥（apply
   *  换档删旧）⇒ 食物档与饥饿档不并存,直加安全 */
  get minionKbBonus(): number {
    return [0, 0.5, 0.75, 1][this.wellFedTier] + [0, -0.5, -1][this.hungerTier];
  }
  /** 魔力上限加成：水晶球预见 statManaMax2 += 20（:11481） */
  get manaMaxBonus(): number {
    return this.active.has(BuffType.Clairvoyance) ? 20 : 0;
  }
  /** 水晶球预见魔法伤 +5%（magicDamage += 0.05f，Player.cs:11483）——与 MagicPower
   *  (+0.2,:9669) 同为 magicDamage 加算项，并入 magicDmgBonus 供 damageMult('magic') 消费 */
  get clairvoyanceMagicDamage(): number {
    return this.active.has(BuffType.Clairvoyance) ? 0.05 : 0;
  }
  /** 水晶球预见魔法暴击 +2（magicCrit += 2，Player.cs:11482） */
  get clairvoyanceMagicCrit(): number {
    return this.active.has(BuffType.Clairvoyance) ? 2 : 0;
  }
  /** 水晶球预见耗魔 -2%（manaCost -= 0.02f，Player.cs:11485）——原版 manaCost 是
   *  1f 起的加算聚合（饰品/药水同池），消费端 (int)(item.mana × manaCost)；
   *  本仓折成乘法因子并入 equipStats.manaCostMul（Player.computeEquipStats） */
  /** ★BJ739 B05（2026-10-31）：耗魔 -2% 改【加算】入 manaCostOff 池——1457
   *  Player.cs:11979 `manaCost -= 0.02f`：原版 manaCost 是 1f 起单加算浮点池
   *  （:1859 ResetEffects 复位），与大自然恩赐 -0.06（:13061）/魔力花 -0.08
   *  （:14040）同池；消费单点截断 `(int)(item.mana × manaCost)`（:5875/:5878）。
   *  旧折乘 0.98 并入 manaCostMul = 合法配装每发多扣 1 蓝（Inept 爬藤杖 44 蓝：
   *  trunc(44×0.86×0.98)=37 应 trunc(44×0.84)=36，issue#29 B05）。消费端 =
   *  Player.computeEquipStats manaCostOff 位（buffs.active 在 equipStatsTailKey
   *  缓存键内，失效面已覆盖）。旧名 clairvoyanceManaCostMult 随刀退役。 */
  get clairvoyanceManaCostOff(): number {
    return this.active.has(BuffType.Clairvoyance) ? 0.02 : 0;
  }
  /** 弹药箱 20% 不耗弹（PickAmmo :52746 rand.Next(5)==0） */
  get hasAmmoBox(): boolean {
    return this.active.has(BuffType.AmmoBox);
  }
  // ---- 食物三档属性（Player.cs:11523-11570；同时多档激活时取最高档，与原版逐条累加
  // 等价——原版吃高档后低档不可能并存低于高档单独存在的情况）----
  /** 当前生效的食物档位：0 无 / 1 WellFed(26) / 2 WellFed2(206) / 3 WellFed3(207) */
  get wellFedTier(): 0 | 1 | 2 | 3 {
    if (this.active.has(BuffType.WellFed3)) return 3;
    if (this.active.has(BuffType.WellFed2)) return 2;
    if (this.active.has(BuffType.WellFed)) return 1;
    return 0;
  }
  /** 全系伤害 +5/7.5/10%（meleeDamage/magicDamage/rangedDamage/minionDamage 同值,:11527+） */
  get wellFedDamage(): number {
    return [0, 0.05, 0.075, 0.1][this.wellFedTier];
  }
  /** 全系暴击 +2/3/4（melee/magic/rangedCrit 同值,:11525+） */
  get wellFedCrit(): number {
    return [0, 2, 3, 4][this.wellFedTier];
  }
  /** 近战速度 +5/7.5/10%（meleeSpeed += ,:11528+） */
  get wellFedMeleeSpeed(): number {
    return [0, 0.05, 0.075, 0.1][this.wellFedTier];
  }
  /** 镐速 +5/10/15%（pickSpeed -= ,:11534+）→ 挖掘倍率 */
  get wellFedPickMult(): number {
    return [1, 0.95, 0.9, 0.85][this.wellFedTier];
  }
  // ---- 风筝 buff 383（Player.cs:9612-9623）----
  /** kiteLuckLevel（:9618-9623）：clamp(buffTime/10800, 0, 3)。active 存秒，
   *  10800 tick = 180s 一档；无 buff = 0（luck += 档×0.1/3，RecalculateLuck :28675） */
  get kiteLuckLevel(): number {
    const left = this.active.get(BuffType.KiteBuff);
    if (left === undefined) return 0;
    return Math.max(0, Math.min(3, Math.floor(left / 180)));
  }
  /** 挖掘冷却倍率（pickSpeed 语义，越小越快）——★已退役:原版是加法减量
   *  （食物档 -5/10/15% :11534+ / 风筝 -0.15 :9614），乘法近似在高叠档偏差。
   *  消费已并入 Game.ts 挖掘冷却的 pickSpeed 加法链（Mining/ambrosia/食物/风筝/
   *  chiselSpeed 全源一处聚合）。tileSpeed/wallSpeed 放置速度位在
   *  Game.placeSpeedTileRaw/placeSpeedWallRaw（:9616-9617） */
  get pickSpeedMult(): number {
    return 1
      - (1 - this.wellFedPickMult)
      - (this.active.has(BuffType.KiteBuff) ? 0.1 : 0);   // ★1457 :10004 pickSpeed -= 0.1f（旧 1456 钉 0.15 已反转）
  }
  /** 原版 buff 21（PotionSickness）无任何属性——只禁治疗（healBlocked）。
   *  旧实现 +80 maxHp 非原版（2026-08-13 对齐移除，喝药回血走 healLife 数据驱动） */
  get healthBonus(): number {
    return 0;
  }
  get hasThorns(): boolean {
    return this.active.has(BuffType.Thorns);
  }
  /** 荆棘反伤乘数 thorns（Player.cs:18228 每帧清零后 UpdateBuffs 逐 buff 赋值：
   *  buff 14 → thorns = 1（:9703）；buff 165 → thorns<1 时 += 0.5（:9988-9990——
   *  药水在场已为 1，树妖 0.5 不再叠）。海龟套 turtleThorns 是消费端覆写 2 非叠加
   *  （:30912-30914），不在此 getter） */
  get thornsAmount(): number {
    if (this.active.has(BuffType.Thorns)) return 1;
    if (this.active.has(BuffType.DryadsWard)) return 0.5;
    return 0;
  }
  // ---- 树妖祝福 165（Player.cs:9985-9991）----
  get dryadWard(): boolean {
    return this.active.has(BuffType.DryadsWard);
  }
  get healBlocked(): boolean {
    return this.active.has(BuffType.Resistance);
  }
  // ---- 月噬 145（Player.cs:11454-11457 moonLeech = true）----
  // 消费点（Projectile.cs）：12879 吸血弹 304 vampireHeal / 12885 ghostHeal /
  // 27124 aiStyle 52 治疗弹拾取——三处均在 !moonLeech 门内。本仓吸血/治疗弹链
  // 未实装，效果位在此备用；实际载荷 = NPC 401 月噬怪召唤门禁（原版以
  // FindBuffIndex(145) 判，见 bossAI_duke_moonlord.spawnMoonLeech）
  get moonLeech(): boolean {
    return this.active.has(BuffType.MoonLeech);
  }
  // ---- 遮挡 163（Player.cs:11421-11425 headcovered + bleed）----
  /** bleed 语义（:18998）：清 lifeRegenTime → 自然恢复计时归零阻断（同流血 30）。
   *  Player.ts 自然回血段与 Bleeding 同门消费 */
  get obstructed(): boolean {
    return this.active.has(BuffType.Obstructed);
  }
  // ---- 药水族效果聚合（Player.cs UpdateBuffs 各 case 1:1）----
  /** 黑曜石皮:lavaImmune + fireWalk + 着火免疫（:9573-9577） */
  get obsidianSkin(): boolean {
    return this.active.has(BuffType.ObsidianSkin);
  }
  get gills(): boolean {
    return this.active.has(BuffType.Gills);
  }
  get slowFall(): boolean {
    return this.active.has(BuffType.Featherfall);
  }
  get canWaterWalk(): boolean {
    return this.active.has(BuffType.WaterWalking);
  }
  get manaRegenBuff(): boolean {
    return this.active.has(BuffType.ManaRegen);
  }
  /** 魔法伤害 +20%（:9669）+ 水晶球预见 +5%（:11483，同池加算） */
  get magicDmgBonus(): number {
    return (this.active.has(BuffType.MagicPower) ? 0.2 : 0)
      + this.clairvoyanceMagicDamage;
  }
  /** 箭伤 ×1.1（:9712;本仓库 ranged 管道统一消费,乘 ranged 全系——近义注明） */
  /** 魔力眩晕 magic 减伤（Player.cs:10003：0.25×剩余/300；apply 用秒，300t=5s） */
  get manaSickMagicMult(): number {
    const left = this.active.get(BuffType.ManaSickness);
    if (left === undefined) return 1;
    // ★BJ739 B04：摘 25% 钳——1457 Player.cs:10412-14 `manaSickReduction = 0.25f ×
    //  (buffTime / manaSickTime)` 原式无钳（manaSickTime=300t=5s 静态 :955；喝蓝
    //  AddBuff(94,300) :52576；BuffID.cs:34 AddBuffTimeAdditivelyToCap 94→600t 叠加
    //  上限）。满叠 10s 剩余期 reduction=0.5 → magicDamage ×0.5（消费 :26098-26100
    //  `*= 1f - manaSickReduction`）。旧 Math.min(0.25,·) 把叠层 5-10s 段钳回 25%
    //  （issue#29 B04：两瓶蓝后剩 10s 乘数应 0.50 旧 0.75）
    return 1 - 0.25 * (left / 5);
  }
  /** 射手 buff 箭速 ×1.2（Player.cs:52717-52722） */
  get arrowSpeedMult(): number {
    return this.active.has(BuffType.Archery) ? 1.2 : 1;
  }
  get arrowDmgMult(): number {
    return this.active.has(BuffType.Archery) ? 1.1 : 1;
  }
}

/** 右键取消门 ≡ Main.TryRemovingBuff（Main.cs:44093-44117）首行
 *  `if (!debuff[b] && b != 60 && b != 151)`——debuff 表成员与 60 水晶叶
 *  （LeafCrystal,套装标志位钉 18000t）/151 吸魂（SoulDrain,魂镰自持）右键
 *  零反应（不删、不响、无任何视觉伴随）;其余（含全部随从伴生 buff——64/125/126/
 *  133/134/135/139/140/182/188/216/325/335/355 等全族不在 Main.debuff 表
 *  Main.cs:9004-9079）DelBuff + SoundID 12 → 随从族消散链见 Game.maintainMinionBuffs
 *  BJ405 注（buff 槽 = 召唤活体凭证,删除即取消召唤）。原版坐骑支（:44100-44103
 *  mount.CheckBuff→TryDismount 顶替 DelBuff）★BJ405-D1 落刀后可达——坐骑 buff
 *  出栏走 UI 坐骑通道（mount.active 单一真源派生,Mounts.ts setMount 注）,右键 =
 *  UI.dismountFromBuffBar（不经本门,坐骑支先于 DelBuff 判定=DelBuff 被顶替语义）。
 *  宠物支 = CheckBuffHideMisc hideMisc 翻转（UI 宠物通道块 t===null 分支承接,
 *  togglePetSlot 内自带 Sound 12）。无 vanillaBuff 映射的自造 buff 按非 debuff
 *  可右键（=原版"表外默认 false"同判）。判别锁：tests/buff-rightclick-bj405 */
export function buffRightClickRemovable(t: BuffType): boolean {
  if (BuffState.DEBUFFS.has(t)) return false;
  const vb = BUFF_DEFS[t]?.vanillaBuff;
  return vb !== 60 && vb !== 151;
}
