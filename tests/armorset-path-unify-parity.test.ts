// BJ147 组D：套装四路径统一「行为零变更」指纹（证据一：统一前后逐场景快照对拍）。
// 现状四条并行判定路径（vanillaArmorSets 槽序表 / Player.ts 内联 vid 三元组 /
// Player.ts turtle·cactus getter / vanillaSummonStats.SUMMON_SET）统一进
// vanillaArmorSets.ts 单表后，本文件的【通道投影快照】保持判定面回归网。
// ★组A/B 表批（2026-09-18）有意重采样：BJ149 移交的已知漂移面在本批修复并重录——
//   · Wizard 七袍全亮 + legs=0 空腿语义（原版 TryCounting :189-199,`*` 键空腿回退）；
//   · ShadowScale 混搭 6 组合亮 + name 面（l10n ArmorSetBonus.ShadowScale）；
//   · Wood/Pumpkin/Snow/Mining/MagicHat 五套落表亮;
//   · 钴/秘银/精金九套 + CrystalAssassin（dashType=5）落表亮;
//   · 新通道进投影:sb_manaCostOff/sb_dmgMinion/sb_ammoCost75/sb_buffImmune +
//     eq.pickSpeedOff/nightVision/moonLordLegs/slowFall（单件面同批接线）。
//   未变铁律：setBonus 通道对 vid 键套（Crimson/Meteor/…）与 summon 专属套恒 null。
// 通道投影语义：setBonus 面只投影 sb 消费块读取的字段族（Player.ts sb 块），
// summonSet 面只投影召唤通道读取的字段族——并键对象字面量多出的正交字段不得进入
// 投影（防假红）。
import { describe, it, expect } from 'vitest';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

function playerWith(head: number | null, body: number | null, legs: number | null): Player {
  const p = new Player(40 * 16, 54 * 16, new Inventory());
  if (head !== null) p.inv.armor[0] = { id: iid(head), stack: 1 };
  if (body !== null) p.inv.armor[1] = { id: iid(body), stack: 1 };
  if (legs !== null) p.inv.armor[2] = { id: iid(legs), stack: 1 };
  return p;
}

/** 可观测判定面快照（统一前后必须逐字段同）——undefined 归一为 null 防键序噪声 */
function face(p: Player) {
  const eq = p.equipStats;
  const sb = eq.setBonus;
  const ss = eq.summonSet;
  const n = (v: number | boolean | undefined | null): number | boolean | null =>
    v === undefined ? null : v;
  return {
    // ---- setBonus 通道（sb 消费块字段族,:2434-2466）----
    setBonusName: sb?.name ?? null,
    sb_def: n(sb?.def), sb_mana: n(sb?.mana), sb_move: n(sb?.move),
    sb_meleeSpd: n(sb?.meleeSpd),
    sb_dmgMelee: n(sb?.dmgMelee), sb_dmgRanged: n(sb?.dmgRanged), sb_dmgMagic: n(sb?.dmgMagic),
    sb_critMelee: n(sb?.critMelee), sb_critRanged: n(sb?.critRanged), sb_critMagic: n(sb?.critMagic),
    sb_noKnockback: n(sb?.noKnockback),
    sb_runAccMul: n(sb?.runAccMul), sb_maxRunMul: n(sb?.maxRunMul), sb_runSlowMul: n(sb?.runSlowMul),
    sb_endurance: n(sb?.endurance), sb_solar: n(sb?.solar), sb_titaniumStorm: n(sb?.titaniumStorm),
    sb_crystalLeaf: n(sb?.crystalLeaf), sb_onHitRegen: n(sb?.onHitRegen),
    sb_onHitPetal: n(sb?.onHitPetal), sb_onHitDodge: n(sb?.onHitDodge),
    sb_ashWood: n(sb?.ashWood), sb_dashType: n(sb?.dashType), sb_fireWalk: n(sb?.fireWalk),
    sb_frostBurn: n(sb?.frostBurn), sb_anglerSet: n(sb?.anglerSet),
    sb_ammoCost80: n(sb?.ammoCost80), sb_manaCostMul: n(sb?.manaCostMul),
    // ---- 组A/B 表批新通道（2026-09-18）----
    sb_manaCostOff: n(sb?.manaCostOff), sb_dmgMinion: n(sb?.dmgMinion),
    sb_ammoCost75: n(sb?.ammoCost75), sb_buffImmune: sb?.buffImmune ?? null,
    sb_pickSpeed: n(sb?.pickSpeed),
    // ---- summonSet 通道（:2480-2485 + whipSpd/guardian/huntressT2/批②旗消费端）----
    summonSet: ss ? {
      slot: n(ss.slot), sentry: n(ss.sentry), dmg: n(ss.dmg), whipRange: n(ss.whipRange),
      whipSpd: n(ss.whipSpd), guardian: n(ss.guardian), huntressT2: n(ss.huntressT2),
      squireT2: n(ss.squireT2), apprenticeT2: n(ss.apprenticeT2), monkT2: n(ss.monkT2),
      squireT3: n(ss.squireT3), apprenticeT3: n(ss.apprenticeT3), monkT3: n(ss.monkT3),
      huntressT3: n(ss.huntressT3),
    } : null,
    // ---- 专用旗通道（原内联 vid 三元组/getter 携带面）----
    crimsonRegen: n(eq.crimsonRegen), spaceGun: n(eq.spaceGun),
    shroomiteSet: n(eq.shroomiteSet), shroomiteType: eq.shroomiteType ?? null,
    vortexSet: n(eq.vortexSet), nebulaSet: n(eq.nebulaSet),
    beetleOff: n(eq.beetleOff), beetleDef: n(eq.beetleDef),
    turtleSet: p.turtleSet, cactusSet: p.cactusSet,
    // ---- 汇总数值面（套装/单件聚合终值抽样）----
    def: n(eq.def), mana: n(eq.mana), critMagic: n(eq.critMagic),
    minionSlots: n(eq.minionSlots), sentrySlots: n(eq.sentrySlots),
    minionDmg: n(eq.minionDmg), whipRange: n(eq.whipRange), whipSpd: n(eq.whipSpd),
    manaCostMul: n(eq.manaCostMul), enduranceEq: n(eq.enduranceEq),
    aggroPiece: n(eq.aggroPiece), fishingSkill: n(eq.fishingSkill),
    moveMult: n(eq.moveMult), meleeSpeed: n(eq.meleeSpeed), dmgMagic: n(eq.dmgMagic),
    fireWalk: n(eq.fireWalk), noKnockback: n(eq.noKnockback), frostBurn: n(eq.frostBurn),
    solarSet: n(eq.solarSet), dash: n(eq.dash), crystalLeaf: n(eq.crystalLeaf),
    ashWood: n(eq.ashWood), titaniumStorm: n(eq.titaniumStorm),
    onHitRegen: n(eq.onHitRegen), onHitPetal: n(eq.onHitPetal), onHitDodge: n(eq.onHitDodge),
    anglerSetSpawnReduction: n(eq.anglerSetSpawnReduction), huntressT2: n(eq.huntressT2),
    ammoSaveCost80: n(eq.ammoSaveCost80), ammoSaveCost75: n(eq.ammoSaveCost75),
    ammoSaveHuntress: n(eq.ammoSaveHuntress), ammoSaveChloro: n(eq.ammoSaveChloro),
    // ---- 组A/B 单件面新通道（2026-09-18）----
    pickSpeedOff: n(eq.pickSpeedOff), nightVision: n(eq.nightVision),
    moonLordLegs: n(eq.moonLordLegs), slowFall: n(eq.slowFall),
    divingHelm: n(eq.divingHelm),
  };
}

const CASES: Array<[string, number | null, number | null, number | null]> = [
  // ---- 基线：空装 ----
  ['empty', null, null, null],
  // ---- 金属一/二档 + 铂金（MetalTier1/2、Platinum——四/五三元组全键）----
  ['metal1-copper-89|80|76', 89, 80, 76],
  ['metal1-iron-90|81|77', 90, 81, 77],
  ['metal1-lead-687|688|689', 687, 688, 689],
  ['metal1-ancientiron-954|81|77', 954, 81, 77],
  ['metal2-tin-91|82|78', 91, 82, 78],
  ['metal2-silver-92|83|79', 92, 83, 79],
  ['metal2-ancientsilver-955|83|79', 955, 83, 79],
  ['metal2-tungsten-690|691|692', 690, 691, 692],
  ['metal2-gold-693|694|695', 693, 694, 695],
  ['platinum-696|697|698', 696, 697, 698],
  // ---- 角斗士/忍者/化石/死灵（含 959 远古死灵头）----
  ['gladiator-3187|3188|3189', 3187, 3188, 3189],
  ['ninja-256|257|258', 256, 257, 258],
  ['fossil-3374|3375|3376', 3374, 3375, 3376],
  ['bone-151|152|153', 151, 152, 153],
  ['bone-ancient-959|152|153', 959, 152, 153],
  // ---- 巫师帽（组A 表批已修：七袍全亮 + legs=0 空腿回退 `*` 键）----
  ['wizard-238|1282|92', 238, 1282, 92],
  ['wizard-robe1283-lights', 238, 1283, 92],
  ['wizard-mysticrobe2279-lights', 238, 2279, 92],
  ['wizard-emptylegs-lights-legs0', 238, 1282, null],
  ['wizard-amber4256-emptylegs', 238, 4256, null],
  ['magichat-2275-lights', 2275, 1282, 92],
  ['magichat-emptylegs-legs0', 2275, 1283, null],
  // ---- 暗影/远古暗影（组A 表批已修：混搭 8 组合全亮 + name 面）----
  ['shadow-102|101|100', 102, 101, 100],
  ['shadow-ancient-956|957|958', 956, 957, 958],
  ['shadow-mixed-102|957|958-lights', 102, 957, 958],
  ['shadow-mixed-956|101|100-lights', 956, 101, 100],
  ['shadow-mixed-102|101|958-lights', 102, 101, 958],
  ['shadow-mixed-956|957|100-lights', 956, 957, 100],
  // ---- 陨石/猩红/蘑菇矿（vid 键套——setBonus 通道恒 null=通道分离钉死）----
  ['meteor-123|124|125', 123, 124, 125],
  ['crimson-792|793|794', 792, 793, 794],
  ['shroomite-1546|1549|1550', 1546, 1549, 1550],
  ['shroomite-1547|1549|1550', 1547, 1549, 1550],
  ['shroomite-1548|1549|1550', 1548, 1549, 1550],
  // ---- 星旋/星云/甲虫双档（vid 键套）----
  ['vortex-2757|2758|2759', 2757, 2758, 2759],
  ['nebula-2760|2761|2762', 2760, 2761, 2762],
  ['beetle-off-2199|2200|2202', 2199, 2200, 2202],
  ['beetle-def-2199|2201|2202', 2199, 2201, 2202],
  // ---- 幽灵双头/丛林（含 960-962 远古混搭）/熔岩/霜寒 ----
  ['spectre-heal-1503|1504|1505', 1503, 1504, 1505],
  ['spectre-dmg-2189|1504|1505', 2189, 1504, 1505],
  ['jungle-228|229|230', 228, 229, 230],
  ['jungle-ancient-960|961|962', 960, 961, 962],
  ['jungle-mixed-228|961|962', 228, 961, 962],
  ['molten-231|232|233', 231, 232, 233],
  ['frost-684|685|686', 684, 685, 686],
  // ---- 渔夫/海龟/仙人掌（getter 通道）----
  ['angler-2367|2368|2369', 2367, 2368, 2369],
  ['angler2-5591|5592|5593', 5591, 5592, 5593],   // 渔夫二型（BJ163 槽位补后点亮）
  ['turtle-1316|1317|1318', 1316, 1317, 1318],
  ['cactus-894|895|896', 894, 895, 896],
  ['turtle-missing-legs', 1316, 1317, null],
  // ---- 叶绿四头/帕拉钯/山铜/钛金三头/神圣/神圣召唤 ----
  ['chloro-melee-1001|1004|1005', 1001, 1004, 1005],
  ['chloro-summon-5524|1004|1005', 5524, 1004, 1005],
  ['chloro-helmet-1002|1004|1005', 1002, 1004, 1005],
  ['chloro-headgear-1003|1004|1005', 1003, 1004, 1005],
  ['palladium-1205|1208|1209', 1205, 1208, 1209],
  ['palladium-1206|1208|1209', 1206, 1208, 1209],
  ['orichalcum-1210|1213|1214', 1210, 1213, 1214],
  ['titanium-1215|1218|1219', 1215, 1218, 1219],
  ['titanium-1216|1218|1219', 1216, 1218, 1219],
  ['titanium-1217|1218|1219', 1217, 1218, 1219],
  ['hallowed-553|551|552', 553, 551, 552],
  ['hallowed-mask-558|4900|4901', 558, 4900, 4901],
  ['hallowed-ancient-4896|4900|4901', 4896, 4900, 4901],
  ['hallowed-summoner-4873|551|552', 4873, 551, 552],
  ['hallowed-summoner-ancient-4899|551|552', 4899, 551, 552],
  // ---- 召唤专属套（setBonus 通道恒 null=通道分离钉死）----
  ['tiki-1159|1160|1161', 1159, 1160, 1161],
  ['spooky-1832|1833|1834', 1832, 1833, 1834],
  ['bee-2361|2362|2363', 2361, 2362, 2363],
  ['spider-2370|2371|2372', 2370, 2371, 2372],
  ['obsidian-3266|3267|3268', 3266, 3267, 3268],
  ['stardust-3381|3382|3383', 3381, 3382, 3383],
  ['squireT2-3800|3801|3802', 3800, 3801, 3802],
  ['apprenticeT2-3797|3798|3799', 3797, 3798, 3799],
  ['huntressT2-3803|3804|3805', 3803, 3804, 3805],
  ['monkT2-3806|3807|3808', 3806, 3807, 3808],
  ['squireT3-3871|3872|3873', 3871, 3872, 3873],
  ['apprenticeT3-3874|3875|3876', 3874, 3875, 3876],
  ['huntressT3-3877|3878|3879', 3877, 3878, 3879],
  ['monkT3-3880|3881|3882', 3880, 3881, 3882],
  // ---- 日曜/灰烬木/水晶刺客（组B 表批落表）----
  ['solar-2763|2764|2765', 2763, 2764, 2765],
  ['ashwood-5279|5280|5281', 5279, 5280, 5281],
  ['crystalninja-4982|4983|4984-dash5', 4982, 4983, 4984],
  ['wood-727|728|729-lights', 727, 728, 729],
  ['wood-boreal-2509|2510|2511', 2509, 2510, 2511],
  ['wood-palm-2512|2513|2514', 2512, 2513, 2514],
  ['cobaltcaster-371|374|375-lights', 371, 374, 375],
  // ---- 组A/B 表批新套（2026-09-18）----
  ['snow-803|804|805', 803, 804, 805],
  ['snow-pink-978|979|980', 978, 979, 980],
  ['snow-mixed-978|804|980', 978, 804, 980],
  ['mining-88|410|411', 88, 410, 411],
  ['mining-upgraded-5588|5589|5590', 5588, 5589, 5590],
  ['mining-ultrabright-4008|5589|5590', 4008, 5589, 5590],
  ['pumpkin-1731|1732|1733', 1731, 1732, 1733],
  ['cobaltmelee-372|374|375', 372, 374, 375],
  ['cobaltranged-373|374|375', 373, 374, 375],
  ['mythrilcaster-376|379|380', 376, 379, 380],
  ['mythrilranged-378|379|380', 378, 379, 380],
  ['adamantitemelee-401|403|404', 401, 403, 404],
  ['adamantiteranged-402|403|404', 402, 403, 404],
  // ---- 组A 单件面旗（单件穿戴——旗/池通道快照）----
  ['piece-divinghelm-268', 268, null, null],
  ['piece-nightvision-3109', 3109, null, null],
  ['piece-nightvision-4008', 4008, null, null],
  ['piece-moonlordlegs-5001', null, null, 5001],
  ['piece-slowfall-3770', null, null, 3770],
  ['piece-pickspeed-410', null, 410, null],
  ['piece-pickspeed-5590', null, null, 5590],
  ['piece-crits-1209', null, null, 1209],
  ['piece-gi-2277-minion', null, 2277, null],
  ['piece-crystalninja-4983-minion', null, 4983, null],
  // ---- 负对照：跨套混搭/缺件 ----
  ['neg-crimson-head+molten-body', 792, 232, 233],
  ['neg-titanium-head+palladium-body', 1215, 1208, 1209],
  ['neg-chloro-head+hallowed-body', 1001, 551, 552],
];

describe('BJ147 组D 套装判定面指纹（统一前后零变更对拍）', () => {
  it.each(CASES)('%s', (_name, head, body, legs) => {
    const p = playerWith(head, body, legs);
    expect(face(p)).toMatchSnapshot();
  });

  it('神圣召唤兜帽 = onHitDodge(setBonus 通道) + maxMinions+3（散件1+套装2,双链合计面）', () => {
    const bare = playerWith(null, null, null);
    const p = playerWith(4873, 551, 552);
    expect(p.equipStats.setBonus?.name).toBe('HallowedSummoner');
    expect(p.maxMinions).toBe(bare.maxMinions + 3);
    expect(p.equipStats.summonSet?.slot).toBe(2);
  });

  it('通道分离铁律：vid 键套与召唤专属套的 setBonus 恒 null（tooltip 文本面不亮;★BJ745 A02 勘正：Turtle 移出——其 endurance 0.15 已入槽键 sb 面,原版 ArmorSetBonus.Turtle 文本亮）', () => {
    for (const [h, b, l] of [[792, 793, 794], [123, 124, 125], [2757, 2758, 2759],
      [2760, 2761, 2762], [2199, 2200, 2202], [2199, 2201, 2202],
      [894, 895, 896], [1159, 1160, 1161], [1832, 1833, 1834], [3381, 3382, 3383],
      [3800, 3801, 3802], [3877, 3878, 3879]]) {
      const p = playerWith(h, b, l);
      expect(p.equipStats.setBonus, `${h}|${b}|${l}`).toBeNull();
    }
  });
});

// ---- 组A/B 表批行为面（2026-09-18）——消费链端到端断言（快照之外的行为锁）----
describe('组A/B 表批行为面（legs=0 空腿/Snow 免疫链/pickSpeedOff 池/moonLordLegs/CrystalNinja dash5）', () => {
  const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

  it('Wizard legs=0 空腿语义：无腿件也亮（原版 TryCounting :189-199 needed=0 不计数）', () => {
    const p = playerWith(238, 1283, null);
    expect(p.equipStats.setBonus?.name).toBe('Wizard');
    expect(p.equipStats.setBonus?.critMagic).toBe(10);
    // 有腿件时具体键优先命中同一套（等价 GetCompleteSet 单键首命中）
    const p2 = playerWith(238, 1287, 92);
    expect(p2.equipStats.setBonus?.name).toBe('Wizard');
  });

  it('MagicHat legs=0 同构：法师帽 + 空腿亮 + mana+60（套装）+20（紫晶袍件面 accfx）', () => {
    const p = playerWith(2275, 1282, null);
    expect(p.equipStats.setBonus?.name).toBe('MagicHat');
    expect(p.equipStats.mana).toBe(new Player(40 * 16, 54 * 16, new Inventory()).equipStats.mana + 80);
  });

  it('Snow 套 buffImmune 46/47 → buffs.immuneVanilla（冷冻/冰冻 apply 门 :1148 源）', () => {
    const p = playerWith(803, 804, 805);
    void p.equipStats;   // 触发 computeEquipStats → immuneBuffs 重建
    expect(p.buffs.immuneVanilla.has(46)).toBe(true);
    expect(p.buffs.immuneVanilla.has(47)).toBe(true);
    // 粉雪混搭同亮
    const p2 = playerWith(978, 979, 980);
    void p2.equipStats;
    expect(p2.buffs.immuneVanilla.has(46)).toBe(true);
  });

  it('Mining 套 + 矿工件 pickSpeedOff 折扣池聚合（套装 0.1 + 单件各 0.1）', () => {
    const base = new Player(40 * 16, 54 * 16, new Inventory()).equipStats.pickSpeedOff;
    expect(playerWith(88, 410, 411).equipStats.pickSpeedOff).toBeCloseTo(base + 0.3);
    // 换 1.4.5 勘探者/超亮档同池（BJ163 槽位补后整套点亮：套 0.1 + 5589/5590 各 0.1）
    expect(playerWith(4008, 5589, 5590).equipStats.pickSpeedOff).toBeCloseTo(base + 0.3);
  });

  it('Moon Lord Legs 旗面：extraFall+10（:19732）+ moveSpeed 0.25（accfx 件面）', () => {
    const base = new Player(40 * 16, 54 * 16, new Inventory()).equipStats;
    const s = playerWith(null, null, 5001).equipStats;
    expect(s.moonLordLegs).toBe(true);
    expect(s.extraFall).toBe(base.extraFall + 10);
    expect(s.moveMult).toBeCloseTo(base.moveMult + 0.25);
  });

  it('Djinns Curse 3770 → equipStats.slowFall（羽落同字段并集源）', () => {
    expect(playerWith(null, null, 3770).equipStats.slowFall).toBe(true);
    expect(playerWith(null, null, null).equipStats.slowFall).toBe(false);
  });

  it('CrystalNinja dashType=5 进 dash 聚合链（Math.max 与配饰/日曜同链 :2468）', () => {
    const p = playerWith(4982, 4983, 4984);
    expect(p.equipStats.dash).toBe(5);
    expect(p.equipStats.setBonus?.name).toBe('CrystalNinja');
  });

  it('夜视/潜水头盔甲面旗：3109 nightVision、268 divingHelm（呼吸族同通道）', () => {
    expect(playerWith(3109, null, null).equipStats.nightVision).toBe(true);
    expect(playerWith(4008, null, null).equipStats.nightVision).toBe(true);
    expect(playerWith(268, null, null).equipStats.divingHelm).toBe(true);
  });

  it('AdamantiteRanged ammoCost75 → ammoSaveCost75（省弹 1/4 第四掷档）', () => {
    expect(playerWith(402, 403, 404).equipStats.ammoSaveCost75).toBe(true);
  });

  it('BJ163 移交七件可装备链：勘探者 Mining 套 + 渔夫二型 Angler +15 渔力（槽位补后全链通）', () => {
    const s = playerWith(5588, 5589, 5590).equipStats;
    expect(s.setBonus?.name).toBe('Mining');
    expect(s.pickSpeedOff).toBeCloseTo(0.3);   // 套 0.1 + 5589/5590 各 0.1
    const a2 = playerWith(5591, 5592, 5593).equipStats;
    expect(a2.setBonus?.name).toBe('Angler');
    expect(a2.anglerSetSpawnReduction).toBe(true);
    expect(a2.fishingSkill).toBe(15);          // 5591-93 各 +5（此前死面,槽位补后通）
  });
});
