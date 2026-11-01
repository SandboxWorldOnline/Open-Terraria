// armorset-recon-golden —— 套装单表金标钉死（BJ147 组D 第三道闸）。
// 钉死对象 = vanillaArmorSets.ts 统一单表（ARMOR_SET_BONUSES 161 槽键 = 101 既有 +
// 组A/B 表批 59 + 组C Forbidden 1;ARMOR_SET_BONUSES_VID 11 vid 键）的【全量冻结快照】
// + 反编译锚点抽查。任何摘套/改三元组/改特效值/改 summonSetOnly 通道标记都会爆红——
// 有意变更（组A 接手扩键/修漂移）必须：先跑 node tools/recon-armorset-1457.mjs
// 过闸 → 再有意重采样金标（注明变更行号锚）。
// 锚点真值 = Terarria1457/Terraria.DataStructures/ArmorSetBonuses.cs（Initialize :392-484）
// + Terraria/Item.cs SetDefaults DefaultTo*（5591-5593 槽补漏 :44009-21）。
import { describe, it, expect } from 'vitest';
import { ARMOR_SET_BONUSES, ARMOR_SET_BONUSES_VID } from '../src/data/vanillaArmorSets';

// 冻结金标 fixture（由统一后单表一次采样生成,2026-09-17;重生成须过 recon-armorset-1457 闸门）
const GOLDEN_SLOT: Record<string, unknown> = {
// 金标 fixture 组A/B 表批重采样（2026-09-18）——变更锚：ArmorSetBonuses.cs
// Initialize :396-441（Wood 七三元组/Pumpkin/MagicHat legs=0×8/Snow 笛卡尔/Mining 笛卡尔）、
// :418-426 Wizard 七袍 legs=0、:468-470 ShadowScale 笛卡尔、:448-456 钴·秘银·精金九套、
// :465 CrystalNinja（dashType=5）；含并行组C 已落 Forbidden '200|198|142'（ BJ157 lane）。
// 重采样前 recon-armorset-1457 闸门过（DRIFT=0）。
// ★BJ742-A R20-② 有意重采样（2026-10-31）：Jungle 8 键 manaCostMul 0.84 → manaCostOff
//   0.16（ArmorSetBonuses.cs:278-281 manaCost-=0.16f 加算归位;工具译层同批校正）。
// ★BJ745 A02 有意重采样（2026-11-01,issue#35）：+Turtle 槽键 '99|65|54'
//   {endurance:0.15}（ArmorSetBonuses.cs:159-164 Benefits.Turtle sb 面;闸门
//   recon-armorset-1457 同批扩 slotFx 双 lane 译层,DRIFT=0 复核在案）。
//   闸门先行复跑 DRIFT=0。
    "278|246|234": {"ashWood":true,"name":"AshWood"},
    "89|56|51": {"titaniumStorm":true,"name":"Titanium"},
    "90|56|51": {"titaniumStorm":true,"name":"Titanium"},
    "91|56|51": {"titaniumStorm":true,"name":"Titanium"},
    "1|1|1": {"def":2,"name":"MetalTier1"},
    "72|2|2": {"def":2,"name":"MetalTier1"},
    "2|2|2": {"def":2,"name":"MetalTier1"},
    "47|28|27": {"def":2,"name":"MetalTier1"},
    "3|3|3": {"def":3,"name":"MetalTier2"},
    "73|4|4": {"def":3,"name":"MetalTier2"},
    "4|4|4": {"def":3,"name":"MetalTier2"},
    "48|29|28": {"def":3,"name":"MetalTier2"},
    "49|30|29": {"def":3,"name":"MetalTier2"},
    "50|31|30": {"def":4,"name":"Platinum"},
    "180|182|122": {"noKnockback":true,"name":"Gladiator"},
    "22|14|14": {"move":0.2,"name":"Ninja"},
    "188|189|129": {"ammoCost80":true,"name":"Fossil"},
    "75|7|7": {"critRanged":10,"name":"Bone"},
    "7|7|7": {"critRanged":10,"name":"Bone"},
    "14|58|*": {"critMagic":10,"name":"Wizard"},
    "14|59|*": {"critMagic":10,"name":"Wizard"},
    "14|60|*": {"critMagic":10,"name":"Wizard"},
    "14|61|*": {"critMagic":10,"name":"Wizard"},
    "14|62|*": {"critMagic":10,"name":"Wizard"},
    "14|63|*": {"critMagic":10,"name":"Wizard"},
    "14|167|*": {"critMagic":10,"name":"Wizard"},
    "14|213|*": {"critMagic":10,"name":"Wizard"},
    "159|58|*": {"mana":60,"name":"MagicHat"},
    "159|59|*": {"mana":60,"name":"MagicHat"},
    "159|60|*": {"mana":60,"name":"MagicHat"},
    "159|61|*": {"mana":60,"name":"MagicHat"},
    "159|62|*": {"mana":60,"name":"MagicHat"},
    "159|63|*": {"mana":60,"name":"MagicHat"},
    "159|167|*": {"mana":60,"name":"MagicHat"},
    "159|213|*": {"mana":60,"name":"MagicHat"},
    "5|5|5": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "74|48|44": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "5|5|44": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "5|48|5": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "5|48|44": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "74|5|5": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "74|5|44": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "74|48|5": {"runAccMul":1.75,"maxRunMul":1.15,"runSlowMul":1.75,"name":"ShadowScale"},
    "52|32|31": {"def":1,"name":"Wood"},
    "53|33|32": {"def":1,"name":"Wood"},
    "54|34|33": {"def":1,"name":"Wood"},
    "55|35|34": {"def":1,"name":"Wood"},
    "71|47|43": {"def":1,"name":"Wood"},
    "166|173|108": {"def":1,"name":"Wood"},
    "167|174|109": {"def":1,"name":"Wood"},
    "112|75|64": {"dmgMelee":0.1,"dmgRanged":0.1,"dmgMagic":0.1,"dmgMinion":0.1,"name":"Pumpkin"},
    "58|38|36": {"buffImmune":[46,47],"name":"Snow"},
    "58|38|46": {"buffImmune":[46,47],"name":"Snow"},
    "58|50|36": {"buffImmune":[46,47],"name":"Snow"},
    "58|50|46": {"buffImmune":[46,47],"name":"Snow"},
    "77|38|36": {"buffImmune":[46,47],"name":"Snow"},
    "77|38|46": {"buffImmune":[46,47],"name":"Snow"},
    "77|50|36": {"buffImmune":[46,47],"name":"Snow"},
    "77|50|46": {"buffImmune":[46,47],"name":"Snow"},
    "11|20|19": {"pickSpeed":0.1,"name":"Mining"},
    "11|20|240": {"pickSpeed":0.1,"name":"Mining"},
    "11|252|19": {"pickSpeed":0.1,"name":"Mining"},
    "11|252|240": {"pickSpeed":0.1,"name":"Mining"},
    "285|20|19": {"pickSpeed":0.1,"name":"Mining"},
    "285|20|240": {"pickSpeed":0.1,"name":"Mining"},
    "285|252|19": {"pickSpeed":0.1,"name":"Mining"},
    "285|252|240": {"pickSpeed":0.1,"name":"Mining"},
    "216|20|19": {"pickSpeed":0.1,"name":"Mining"},
    "216|20|240": {"pickSpeed":0.1,"name":"Mining"},
    "216|252|19": {"pickSpeed":0.1,"name":"Mining"},
    "216|252|240": {"pickSpeed":0.1,"name":"Mining"},
    "171|177|112": {"endurance":0.12,"solar":true,"dashType":3},
    "8|8|8": {"manaCostOff":0.16,"name":"Jungle"},
    "76|8|8": {"manaCostOff":0.16,"name":"Jungle"},
    "76|49|45": {"manaCostOff":0.16,"name":"Jungle"},
    "8|49|45": {"manaCostOff":0.16,"name":"Jungle"},
    "76|49|8": {"manaCostOff":0.16,"name":"Jungle"},
    "76|8|45": {"manaCostOff":0.16,"name":"Jungle"},
    "8|49|8": {"manaCostOff":0.16,"name":"Jungle"},
    "8|8|45": {"manaCostOff":0.16,"name":"Jungle"},
    "9|9|9": {"dmgMelee":0.1,"fireWalk":true,"name":"Molten"},
    "46|27|26": {"dmgMelee":0.1,"dmgRanged":0.1,"frostBurn":true,"name":"Frost"},
    "99|65|54": {"endurance":0.15,"name":"Turtle"},   // ★BJ745 A02（2026-11-01）新增（ArmorSetBonuses.cs:160 endurance+=0.15f）
    "101|66|55": {"ghostHeal":true,"dmgMagic":-0.4,"name":"SpectreHealing"},
    "156|66|55": {"ghostHurt":true,"name":"SpectreDamage"},
    "200|198|142": {"forbidden":true,"name":"Forbidden"},
    "161|169|104": {"anglerSet":true,"name":"Angler"},
    "161|169|241": {"anglerSet":true,"name":"Angler"},
    "161|253|104": {"anglerSet":true,"name":"Angler"},
    "161|253|241": {"anglerSet":true,"name":"Angler"},
    "286|169|104": {"anglerSet":true,"name":"Angler"},
    "286|169|241": {"anglerSet":true,"name":"Angler"},
    "286|253|104": {"anglerSet":true,"name":"Angler"},
    "286|253|241": {"anglerSet":true,"name":"Angler"},
    "78|51|47": {"crystalLeaf":true,"endurance":0.05,"name":"ChlorophyteMelee"},
    "79|51|47": {"crystalLeaf":true,"name":"ChlorophyteHelmet"},
    "80|51|47": {"crystalLeaf":true,"name":"ChlorophyteHeadgear"},
    "283|51|47": {"crystalLeaf":true,"slot":2,"name":"ChlorophyteSummon"},
    "29|17|16": {"manaCostOff":0.14,"name":"CobaltCaster"},
    "30|17|16": {"meleeSpd":0.15,"name":"CobaltMelee"},
    "31|17|16": {"ammoCost80":true,"name":"CobaltRanged"},
    "32|18|17": {"manaCostOff":0.17,"name":"MythrilCaster"},
    "33|18|17": {"critMelee":10,"name":"MythrilMelee"},
    "34|18|17": {"ammoCost80":true,"name":"MythrilRanged"},
    "35|19|18": {"manaCostOff":0.19,"name":"AdamantiteCaster"},
    "36|19|18": {"meleeSpd":0.2,"move":0.2,"name":"AdamantiteMelee"},
    "37|19|18": {"ammoCost75":true,"name":"AdamantiteRanged"},
    "261|230|213": {"dmgMelee":0.1,"dmgRanged":0.1,"dmgMagic":0.1,"dmgMinion":0.1,"critMelee":10,"critRanged":10,"critMagic":10,"dashType":5,"name":"CrystalNinja"},
    "83|54|49": {"onHitRegen":true,"name":"Palladium"},
    "84|54|49": {"onHitRegen":true,"name":"Palladium"},
    "85|54|49": {"onHitRegen":true,"name":"Palladium"},
    "86|55|50": {"onHitPetal":true,"name":"Orichalcum"},
    "87|55|50": {"onHitPetal":true,"name":"Orichalcum"},
    "88|55|50": {"onHitPetal":true,"name":"Orichalcum"},
    "254|24|23": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "254|24|212": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "254|229|23": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "254|229|212": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "258|24|23": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "258|24|212": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "258|229|23": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "258|229|212": {"onHitDodge":true,"slot":2,"name":"HallowedSummoner"},
    "41|24|23": {"onHitDodge":true,"name":"Hallowed"},
    "41|24|212": {"onHitDodge":true,"name":"Hallowed"},
    "41|229|23": {"onHitDodge":true,"name":"Hallowed"},
    "41|229|212": {"onHitDodge":true,"name":"Hallowed"},
    "42|24|23": {"onHitDodge":true,"name":"Hallowed"},
    "42|24|212": {"onHitDodge":true,"name":"Hallowed"},
    "42|229|23": {"onHitDodge":true,"name":"Hallowed"},
    "42|229|212": {"onHitDodge":true,"name":"Hallowed"},
    "43|24|23": {"onHitDodge":true,"name":"Hallowed"},
    "43|24|212": {"onHitDodge":true,"name":"Hallowed"},
    "43|229|23": {"onHitDodge":true,"name":"Hallowed"},
    "43|229|212": {"onHitDodge":true,"name":"Hallowed"},
    "255|24|23": {"onHitDodge":true,"name":"Hallowed"},
    "255|24|212": {"onHitDodge":true,"name":"Hallowed"},
    "255|229|23": {"onHitDodge":true,"name":"Hallowed"},
    "255|229|212": {"onHitDodge":true,"name":"Hallowed"},
    "256|24|23": {"onHitDodge":true,"name":"Hallowed"},
    "256|24|212": {"onHitDodge":true,"name":"Hallowed"},
    "256|229|23": {"onHitDodge":true,"name":"Hallowed"},
    "256|229|212": {"onHitDodge":true,"name":"Hallowed"},
    "257|24|23": {"onHitDodge":true,"name":"Hallowed"},
    "257|24|212": {"onHitDodge":true,"name":"Hallowed"},
    "257|229|23": {"onHitDodge":true,"name":"Hallowed"},
    "257|229|212": {"onHitDodge":true,"name":"Hallowed"},
    "82|53|48": {"slot":1,"whipRange":0.2,"summonSetOnly":true,"name":"Tiki"},
    "134|95|79": {"dmg":0.25,"summonSetOnly":true,"name":"Spooky"},
    "160|168|103": {"dmg":0.1,"summonSetOnly":true,"name":"Bee"},
    "162|170|105": {"dmg":0.12,"summonSetOnly":true,"name":"Spider"},
    "185|187|127": {"dmg":0.15,"whipRange":0.3,"whipSpd":0.8695652173913044,"summonSetOnly":true,"name":"ObsidianOutlaw"},
    "204|201|145": {"sentry":1,"squireT2":true,"summonSetOnly":true,"name":"SquireTier2"},
    "203|200|144": {"sentry":1,"apprenticeT2":true,"summonSetOnly":true,"name":"ApprenticeTier2"},
    "205|202|146": {"sentry":1,"huntressT2":true,"summonSetOnly":true,"name":"HuntressTier2"},
    "205|202|147": {"sentry":1,"huntressT2":true,"summonSetOnly":true,"name":"HuntressTier2"},
    "206|203|148": {"sentry":1,"monkT2":true,"summonSetOnly":true,"name":"MonkTier2"},
    "210|204|152": {"sentry":1,"squireT3":true,"squireT2":true,"summonSetOnly":true,"name":"SquireTier3"},
    "211|205|153": {"sentry":1,"apprenticeT3":true,"apprenticeT2":true,"summonSetOnly":true,"name":"ApprenticeTier3"},
    "212|206|154": {"sentry":1,"huntressT3":true,"huntressT2":true,"summonSetOnly":true,"name":"HuntressTier3"},
    "212|206|155": {"sentry":1,"huntressT3":true,"huntressT2":true,"summonSetOnly":true,"name":"HuntressTier3"},
    "213|207|156": {"sentry":1,"monkT3":true,"monkT2":true,"summonSetOnly":true,"name":"MonkTier3"},
    "189|190|130": {"guardian":true,"summonSetOnly":true,"name":"Stardust"},
};
const GOLDEN_VID: Record<string, unknown> = {
    "792|793|794": {"crimsonRegen":true,"name":"Crimson"},
    "123|124|125": {"spaceGun":true,"name":"Meteor"},
    "1546|1549|1550": {"shroomiteSet":true,"name":"Shroomite"},
    "1547|1549|1550": {"shroomiteSet":true,"name":"Shroomite"},
    "1548|1549|1550": {"shroomiteSet":true,"name":"Shroomite"},
    "2757|2758|2759": {"vortexSet":true,"name":"Vortex"},
    "2760|2761|2762": {"nebulaSet":true,"name":"Nebula"},
    "2199|2200|2202": {"beetleOff":true,"name":"BeetleDamage"},
    "2199|2201|2202": {"beetleDef":true,"name":"BeetleDefense"},
    "1316|1317|1318": {"turtleThorns":true,"name":"Turtle"},
    "894|895|896": {"cactusThorns":true,"name":"Cactus"},
};

const snap = (rec: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(rec));

describe('BJ147 套装单表金标（ArmorSetBonuses.cs 重放面冻结）', () => {
  it('槽键表全量冻结快照（162 键 = 101 既有 + 组A/B 批 59 + 组C Forbidden + ★BJ745 A02 Turtle sb 面 1;含 summonSetOnly 召唤并键 16）', () => {
    expect(Object.keys(ARMOR_SET_BONUSES).length).toBe(162);
    expect(snap(ARMOR_SET_BONUSES)).toEqual(GOLDEN_SLOT);
  });

  it('vid 键表全量冻结快照（11 键=硬编 6 套+getter 2 套收编面）', () => {
    expect(Object.keys(ARMOR_SET_BONUSES_VID).length).toBe(11);
    expect(snap(ARMOR_SET_BONUSES_VID)).toEqual(GOLDEN_VID);
  });

  // ---- 反编译锚点抽查（防 fixture 盲目重采样——金标本体必须挂源码行号）----
  it.each([
    ['vid 792|793|794 Crimson regen（Initialize :433）', '792|793|794', { crimsonRegen: true, name: 'Crimson' }],
    ['vid 2199|2201|2202 BeetleDefense（:417 ApplySetBonus_BeetleDefense）', '2199|2201|2202', { beetleDef: true, name: 'BeetleDefense' }],
    ['vid 894|895|896 Cactus（:446 cactusThorns）', '894|895|896', { cactusThorns: true, name: 'Cactus' }],
  ])('%s', (_n, key, want) => {
    expect(snap(ARMOR_SET_BONUSES_VID)[key]).toEqual(want);
  });

  it.each([
    ['89|56|51 Titanium onHitTitaniumStorm（:461 三头盔变体首键）', '89|56|51', { titaniumStorm: true, name: 'Titanium' }],
    ['14|58|* Wizard legs=0 通配（:418 Set(238,1282,0) robe1282 首行）', '14|58|*', { critMagic: 10, name: 'Wizard' }],
    ['9|9|9 Molten（:439 melee+fireWalk;buffImmune[24] 走 name 特支）', '9|9|9', { dmgMelee: 0.1, fireWalk: true, name: 'Molten' }],
    ['205|202|146 HuntressTier2 summonOnly（:477 sentry+T2 旗）', '205|202|146', { sentry: 1, huntressT2: true, summonSetOnly: true, name: 'HuntressTier2' }],
    ['185|187|127 ObsidianOutlaw 鞭速 1/1.15（:483）', '185|187|127', { dmg: 0.15, whipRange: 0.3, whipSpd: 1 / 1.15, summonSetOnly: true, name: 'ObsidianOutlaw' }],
    ['283|51|47 ChlorophyteSummon 并键（:443 crystalLeaf+slot:2）', '283|51|47', { crystalLeaf: true, slot: 2, name: 'ChlorophyteSummon' }],
    // ---- 组A/B 表批锚点（2026-09-18 重采样新增;行号 = 1458 ArmorSetBonuses.cs）----
    ['14|59|* Wizard 黄玉袍 legs=0（:419 Set(238,1283,0)——空腿语义）', '14|59|*', { critMagic: 10, name: 'Wizard' }],
    ['159|58|* MagicHat statManaMax2+60（:427 Set(2275,1282,0) 首行）', '159|58|*', { mana: 60, name: 'MagicHat' }],
    ['52|32|31 Wood 防御+1（:396 首三元组 727/728/729）', '52|32|31', { def: 1, name: 'Wood' }],
    ['112|75|64 Pumpkin 四伤+10%（:411 Add 1731/1732/1733）', '112|75|64', { dmgMelee: 0.1, dmgRanged: 0.1, dmgMagic: 0.1, dmgMinion: 0.1, name: 'Pumpkin' }],
    ['58|38|36 Snow buffImmune 46/47（:440 笛卡尔 803/804/805 首键）', '58|38|36', { buffImmune: [46, 47], name: 'Snow' }],
    ['77|50|46 Snow 粉雪变体（:440 笛卡尔 978/979/980 尾键）', '77|50|46', { buffImmune: [46, 47], name: 'Snow' }],
    ['11|20|19 Mining pickSpeed-0.1（:441 笛卡尔 88/410/411 首键）', '11|20|19', { pickSpeed: 0.1, name: 'Mining' }],
    ['216|252|240 Mining 超亮/勘探者变体（:441 4008/5589/5590 尾键）', '216|252|240', { pickSpeed: 0.1, name: 'Mining' }],
    ['5|48|44 ShadowScale 暗影头+远古身腿混搭（:468-470 笛卡尔）', '5|48|44', { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75, name: 'ShadowScale' }],
    ['30|17|16 CobaltMelee meleeSpeed+0.15（:449 Add 372/374/375）', '30|17|16', { meleeSpd: 0.15, name: 'CobaltMelee' }],
    ['29|17|16 CobaltCaster manaCost-0.14（:448）', '29|17|16', { manaCostOff: 0.14, name: 'CobaltCaster' }],
    ['33|18|17 MythrilMelee meleeCrit+10（:452 Add 377/379/380）', '33|18|17', { critMelee: 10, name: 'MythrilMelee' }],
    ['36|19|18 AdamantiteMelee 双速+0.2（:455 Add 401/403/404）', '36|19|18', { meleeSpd: 0.2, move: 0.2, name: 'AdamantiteMelee' }],
    ['37|19|18 AdamantiteRanged ammoCost75（:456 Add 402/403/404）', '37|19|18', { ammoCost75: true, name: 'AdamantiteRanged' }],
    ['261|230|213 CrystalNinja dashType=5 四伤三暴（:465 Add 4982/4983/4984）', '261|230|213', { dmgMelee: 0.1, dmgRanged: 0.1, dmgMagic: 0.1, dmgMinion: 0.1, critMelee: 10, critRanged: 10, critMagic: 10, dashType: 5, name: 'CrystalNinja' }],
  ])('%s', (_n, key, want) => {
    expect(snap(ARMOR_SET_BONUSES)[key]).toEqual(want);
  });

  it('通道分离铁律：召唤专属条目 summonSetOnly 全标;sb 通道键（85 既有面）零召唤专属标', () => {
    const summonOnly = Object.entries(ARMOR_SET_BONUSES).filter(([, v]) => v.summonSetOnly === true);
    expect(summonOnly.length).toBe(16);
    for (const [key, v] of summonOnly) {
      expect(v.slot !== undefined || v.sentry !== undefined || v.dmg !== undefined
        || v.whipRange !== undefined || v.guardian === true || v.huntressT2 === true
        || v.squireT2 === true || v.squireT3 === true || v.apprenticeT2 === true
        || v.apprenticeT3 === true || v.monkT2 === true || v.monkT3 === true
        || v.huntressT3 === true, key).toBe(true);
    }
  });
});
