// 配饰/盔甲数值效果运行时（tools/extract-equip-prefix.mjs → vanilla-accfx.json）。
// 来源 = Player.ApplyEquipFunctional switch + GrantArmorBenefits/ApplyEquipFunctional 的
// if-chain 数值段（meleeDamage += 0.15f 等纯数值模式；行为型效果不在表内）。
import fxJson from './vanilla-accfx.json';
import { ITEM_DEFS } from './items';

export interface AccFx {
  life?: number;      // lifeRegen += N（每半秒 N/2 HP）
  mana?: number;      // statManaMax2 += N
  def?: number;       // statDefense += N
  move?: number;      // moveSpeed += X
  fish?: number;      // fishingSkill += X（钓具族 :12549-12556/:14115-14140）
  // ★BJ740-A ACC10：shield?: boolean 死键退役——全 json 零源,旧消费恒 false;
  //   举盾资格改走 accDrawSlotsOf(vid).shield（Item.shieldSlot 单源,Player.ts 装备环）
  meleeSpd?: number;  // meleeSpeed += X
  runSpeed?: number;  // accRunSpeed = X（基础 maxRunSpeed=3）
  dmgMelee?: number;
  dmgRanged?: number;
  dmgMagic?: number;
  dmgAll?: number;
  critMelee?: number;
  critRanged?: number;
  critMagic?: number;
  // ---- 行为型（二轮）----
  extraFall?: number;    // 摔伤豁免高度
  lavaMax?: number;      // 岩浆免疫 tick（420=7s）
  armorPen?: number;     // 护甲穿透
  rocketBoots?: number;  // 飞行档 1-5（1=基础火箭靴 30t/格，2+=15t/格）
  autoJump?: number;     // bool（值=1/undefined，JSON 序列化 null→parseFloat→NaN? 见提取器）
  fireWalk?: number;     // 陨石/狱岩灼伤免疫
  noKnockback?: number;  // 击退免疫（钴护盾族）
  noFallDmg?: number;    // 摔伤免疫（幸运马掌族）
  desertBoots?: number;
  waterWalk?: number;    // 水面行走
  waterWalk2?: number;
  jumpBoost?: number;    // 气球跳跃增强
  panic?: number;        // 受击移速爆发（恐慌项链）
  starCloak?: number;    // 受击落星（星星斗篷）
  carpet?: number;       // 飞毯（水平滑翔，待滑翔系统）
  jumpOpts?: string[];   // 多段跳选项（Cloud/Blizzard/Sandstorm/Fart/Tsunami/…）
  // ---- 三轮（冲刺/闪避/蜜蜂）----
  dashType?: number;     // 1=忍者足具/水晶刺客 2=克苏鲁护盾（冲撞带伤害）
  blackBelt?: number;    // 10% 闪避（Player.Hurt :9772）
  bees?: number;         // 蜂窝/蜂巢背带：受击放蜂
  spikedBoots?: number;  // 攀壁钉鞋（贴墙滑降）
  // ---- 五轮（残余全量）----
  flipper?: number;      // 脚蹼：游泳提速
  jumpSpd?: number;      // jumpSpeedBoost（蛙腿族 +1.6）
  longInvince?: number;  // 无敌帧翻倍（十字项链/星星面纱）
  treasureMagnet?: number; // 宝藏磁石：拾取范围 +
  magmaStone?: number;     // 岩浆石 1322/火焰护手 1343：近战命中点燃（:14764/:14787-14790）
  iceSkate?: number;       // 冰刀族 950/1861/1862/5000：冰面不滑+加速 ×3.25/上限 ×1.25（:26237-26255）
  goldRing?: number;     // 金戒指族：钱币拾取范围
  luckyCoin?: number;    // 幸运币：近战命中掉钱
  discount?: number;     // 折扣卡：商店/重铸 8 折
  quiver?: number;       // 魔法箭袋族
  moltenQuiver?: number; // 熔箭袋 4002：木箭→火矢 +2 伤（:52700）
  arrowDmg?: number;     // 箭伤加成（+0.1/件）
  ammoSave?: number;     // 20% 概率不耗弹
  huntressSave?: number; // 10% 概率不耗弹
  kbGlove?: number;      // 力量手套族：近战击退翻倍
  autoReuseGlove?: number; // 力量手套族：近战武器自动连挥（Player.TryAllowingItemReuse :52040-52042）
  meleeScaleGlove?: number; // 手套族近战放大：GetAdjustedItemScale ×1.1（★F 锚校正：1457 Player.cs:42891,旧 41919 为 1456 行段）
  flowerBoots?: number;    // 花靴 3017/仙灵靴 3993（GrantArmorBenefits :12682-12688 行走生花）
  yoyoString?: number;   // 悠悠球线：射程 +
  tileSpeed?: number;    // 放置加速（砌砖刀族;手持可放置非火把时 tileSpeed+0.5，:12604-12610）
  wallSpeed?: number;    // 铺墙加速（水泥机族 wallSpeed+0.5 无手持门，:12614-12617）
  tileRange?: number;    // 工具/放置射程 +
  autoPaint?: number;    // 喷漆器族：放置后自动上漆（:14720/:39935 消费）
  chiselSpeed?: number;  // 古凿 4056/创造之手：pickSpeed-0.25 挖掘提速（:12610-12612）
  toolbelt?: number;     // 工具腰带 407：装备生效 blockRange+1（:14873）
  skyStone?: number;     // 天界石族：全属性复合（:12558）
  counterWeight?: number; // 配重球（悠悠球命中触发）
  manaMagnet?: number;   // 魔力磁石：魔力星吸附范围 +
  pStone?: number;       // 贤者之石（药水 CD -25%）
  magicCuffs?: number;   // 魔力手铐：受伤回蓝（raw damage 1:1）
  nightWolf?: number;    // 月亮符：夜晚 Werewolf buff(28)（melee+5.1%伤/+2暴/+5.1%速）
  brainOfConfusion?: number; // 混乱之脑：受击 1/6 → buff321（三系+10暴+召唤+10%伤）
  manaFlower?: number;   // 魔力花族：耗魔 -8% + 魔力不足自动喝蓝
  // ---- 魔力回复直值（Player.ApplyEquipFunctional :14379-14383，仅魔力斗篷 982）----
  manaRegenBonus?: number;       // manaRegenBonus += N（每帧产额加成）
  manaRegenDelayBonus?: number;  // manaRegenDelayBonus += X（惩罚期额外衰减/tick）
  // ---- 呼吸族（行为型，见 BEHAVIOR_FX）----
  divingHelm?: number;  // accDivingHelm：breathCDMax ×6（潜水头盔/三件潜水装备）
  merman?: number;      // accMerman：水中不耗气并人鱼化（月亮/天界/海神贝壳）
  arcticDivingGear?: number; // 1861 极地潜水装备：专家雪原冷水 Chilled 免疫（:27692）
  jellyfishGlow?: number;    // 1860 水母潜水装备：浸水发光 1.8/0.4/1.2（:14682-14688）
  // ---- 配饰审计 P0 批（2026-08-22 审计 docs/audit/item-audit-2026-08-22.md）----
  fishingTackle?: number;   // accTackleBox（2375/3721/5064 :14123-14140）：鱼饵消耗分母 +1（:51645）
  fishingLine?: number;     // accFishingLine（2373/3721/5064 :14759/:14779/:14785）：1/7 断线免疫（:53076）
  lavaFishing?: number;     // accLavaFishing（4881/5064 :14127-14140）：岩浆钓门（:19230）
  dmgMinion?: number;       // minionDamage += X（召唤伤加算乘区；935/1301/3015 :14900/:14431/:14105）
  endurance?: number;       // endurance += X（受伤减免加算；蠕虫围巾 3224 :14532-14535）
  manaCostOff?: number;     // manaCost -= X（耗魔【加算】折扣；大自然的恩赐 223 :14561-14563）
  royalGel?: number;        // 皇家凝胶 3090：23 类史莱姆 npcTypeNoAggro（:14144-14168）
  toolboxRange?: number;    // 工具箱 1923：tileRangeX/Y +1（:14405-14408；与 2215 族 +3/+2 叠加）
  mechShowWires?: number;   // 机械透镜 3619：InfoAccMechShowWires 装备即显电线（:12400-12402）
  autoActuator?: number;    // 加压器 3624：放置实心瓦自动上致动器（:14746-14748/:39977-40010）
  magiluminescence?: number; // 荧光体 5107：地面 acc×1.75/maxRun×1.15/accRun×1.15/slow×1.75（:26188-26194）
  iceBarrier?: number;      // 冰龟壳 1253/冰冻盾 3997：半血挂 buff 62 IceBarrier（:14348-14351）
  lavaRose?: number;        // 玫瑰族（1323/908/4003/4004/5000）：岩浆伤 80-45/OnFire 420-210（:27384-27387）
  // ---- 组A/B 单件面批（2026-09-18）----
  pickSpeed?: number;       // pickSpeed -= X（挖矿提速【加算】折扣池;矿工件 410/411/5589/
                            // 5590 :13944-13947——甲件环 face('pickSpeed') → equipStats.pickSpeedOff）
  nightVision?: number;     // nightVision 旗（夜视头盔 3109/超亮头盔 4008 :13408-13411;
                            // BEHAVIOR_FX 通道——光照衰减 ×1.03,消费端 Game.updateLightDecay）
}

const FX = fxJson as Record<string, AccFx>;

// 呼吸族行为表：原版 if-chain 行为型效果，提取器不进 json，代码层补齐（生成数据勿手改）。
// 268 走 GrantArmorBenefits（Player.cs:12829-12831）；394/1860/1861 走
// ApplyEquipFunctional（:14652/:14689/:14701，divingHelm 与 flipper 并存）；
// 497/861/3110 → accMerman（:15019/:14587/:14855）。
const BEHAVIOR_FX: Record<string, AccFx> = {
  // 力量手套族 autoReuseGlove（Player.ApplyEquipFunctional if-chain：
  // 211 猛爪手套 :14559-14562 / 897 强力手套 :14753-14756 / 1343 机械手套 :14761-14764 /
  // 936 烈火手套 :14823-14826 / 3992 泰坦手套 :13995-13999——各只置旗 + meleeSpeed += 0.12，
  // 数值段在 vanilla-accfx.json 已有，此处补布尔行为）
  // ★meleeScaleGlove 仅 5 件置位（211 猛爪手套【不】置——:14559-14562 无此行）：
  // 536 泰坦手套 :15029-15033 / 897 :14754 / 936 :14824 / 1343 :14761 / 3992 :13997
  '211': { autoReuseGlove: 1 },
  '897': { autoReuseGlove: 1, meleeScaleGlove: 1 },
  '1343': { autoReuseGlove: 1, meleeScaleGlove: 1 },
  '936': { autoReuseGlove: 1, meleeScaleGlove: 1 },
  '3992': { autoReuseGlove: 1, meleeScaleGlove: 1 },
  '536': { meleeScaleGlove: 1 },   // 泰坦手套（:15029-15033：kbGlove 走 json 数值段）
  '268': { divingHelm: 1 },
  // ★组A 单件面批（2026-09-18）：夜视旗（GrantArmorBenefits :13408-13411
  //  3109/4008 nightVision=true——呼吸族同款甲件旗通道;消费端 Player.ts 三件
  //  扫描环 → equipStats.nightVision → Game.updateLightDecay 衰减 ×1.03）
  '3109': { nightVision: 1 },
  '4008': { nightVision: 1 },
  '394': { divingHelm: 1 },
  '1860': { divingHelm: 1, jellyfishGlow: 1 },   // 浸水 AddLight(1.8,0.4,1.2)（:14682-14688）
  '1861': { divingHelm: 1, arcticDivingGear: 1, iceSkate: 1 }, // +arcticDivingGear（:14701）+iceSkate（:14703）
  '497': { merman: 1 },
  '861': { merman: 1, nightWolf: 1 },   // Moon Shell：accMerman + wolfAcc（:14585-14591）
  '3110': { merman: 1, nightWolf: 1 },  // Celestial Shell：同（:14853-14859；json 的 skyStone 保留）
  '485': { nightWolf: 1 },              // Moon Charm 裸月光护身符：wolfAcc（:14633-14640；夜间门在消费端 Player.ts）
  // 花靴/仙灵靴 flowerBoots（GrantArmorBenefits :12682-12688：行走生花）
  '3017': { flowerBoots: 1 },
  '3993': { flowerBoots: 1 },
  // ---- 1457 新配饰主属性（vanilla-accfx.json 提取器未覆盖 6147-6195 族,手补——
  //      行为旗走 Player.ts/SUMMON_GEAR 链,此处只收 accfx 形状的主数值）----
  //  （6188 复原之盾的 def1 曾此处硬补；2026-09-02 起 item.defense 面整体走
  //   statOfInternal itemstats 通道=GrantArmorBenefits :13220,硬补会双计故删——
  //   life2 同理走 itemLife 通道）
};

const FX_BY_IID = (() => {
  const m = new Map<number, AccFx>();
  for (let i = 0; i < ITEM_DEFS.length; i++) {
    const d = ITEM_DEFS[i];
    if (!d) continue;
    // ★BJ283：键前缀 parseInt 兜底退役（BJ268 登记,方案 A ⑥回填后恒短路=items.ts:2414 等价定谳）
    const vid = d.vid ?? -1;
    if (vid < 0) continue;
    const json = FX[String(vid)];
    const extra = BEHAVIOR_FX[String(vid)];
    const fx = json || extra ? { ...json, ...extra } : null;
    if (fx) m.set(i, fx);
  }
  return m;
})();

export function accFxOfInternal(id: number): AccFx | null {
  return FX_BY_IID.get(id) ?? null;
}

/** vid 直查（json 数值面,不含 BEHAVIOR_FX 行为旗）——甲件主属性环用
 *  （Player.ts armorStat:盔甲三件 GrantArmorBenefits if-chain 逐件消费;
 *  2026-09-04 死键批收偿,此前 accfx 消费环只扫配饰槽 3+,甲件面全死键） */
export function accFxJsonOfVid(vid: number): AccFx | null {
  return vid >= 0 ? FX[String(vid)] ?? null : null;
}
