// 原版 NPC.Spawner 内嵌类 1:1 移植（Terarria1456/Terraria/NPC.cs:39-5934 =
// Terarria1457 :144-6010;红蓝-D 2026-09-18 锚勘误——原 :39-5952 陈旧且缺 1457 锚）。
// ★简化纪律:任何"未移植/近似/恒X"必须在 docs/spawn-parity-gaps.md 登记(含原版行号+
// 可见影响+依赖),否则视为未完成。先例:spawnFriendly 曾标"恒放行"导致兔鼠刷浮空岛。
// 结构：SetSpawnFlags(L276) → GetSpawnRate(L383-640) → FindSpawnTile(L879) →
//       SetSpawnFlagsForChosenTile(L950) → SpawnAnNPC(L1186-5144 巨型 if-else 链)。
// 权重语义：Main.rand.Next(N)==0（1/N 命中）；越靠前优先级越高。
// 困难模式分支保留并挂在 world.flags.hardMode（当前默认 false → 只走肉前）。
// 净 ID（负数）= SetDefaultsFromNetId(L7633)：基底类型 × scale + 属性/颜色覆盖。
// 原版 spawnTileType = NPC 落脚处上方格（GetProperGroundSpawnTileTypeAndWallType L5789）；
// 我们的等价 = 落脚格下方第一个实心格的 tile type。
import { TILE } from '../../core/constants';
import { WALL_HOUSE } from '../Housing';   // ★BJ204 单源：Main.wallHouse 全表（房内不刷怪/noWorms 门）
import { RNG } from '../../core/rng';
import type { World } from '../World';
import { TILE_DEFS, TILE_BY_KEY, SOLID_TOP_IDS } from '../../data/tiles';
import { Enemy } from '../../entities/Enemy';
import { debugPoolOverride } from '../../data/vanillaNpcs';
import { MOON_KIND_FROST, MOON_KIND_PUMPKIN } from '../MoonEvent';
import { TileStore, LIQUID_TYPE } from '../TileStore';
import { f32, mainExpertMode, netIdSpawnScale, netIdFlagTrueRescale, scaleStatsWorld } from '../../stats/ScaleStats';
import { applyModSpawnStats } from '../../mods/hooks';   // ★二百七十八刀:rev/death HP 乘表(自然刷怪漏斗)
import { spawnRateMultiplier } from '../JourneyPowers';
import { rollBadLuckExtreme, rollOnlyBadLuckExtreme, rollOnlyBadLuck, rollBadLuck, rollLuck } from '../../stats/Luck';
import { TILE_SOLID_TOP_FAMILY } from '../../stats/TouchDamage';   // SW-BJ37：平台九件套=原版 tileSolid 补臂
import { canHit } from '../../physics/LineOfSight';
import { chumSpots } from '../../entities/chumBucket';
import { scanChosenTileZones } from '../DungeonDualZones';
import { ParticleOrchestraType } from '../../net/syncModules';   // δB B12：双地牢刷生纸屑爆编排型

/** 星璇塔刷怪上下文（Game 每帧随 setPlayerFlags 传入；null=事件未开启/不在任何塔区） */
export interface LunarSpawnCtx {
  /** 玩家 4000px 内各塔是否在场（SceneMetrics.CloseEnoughTo*Tower = WithinRangeOfNPC(塔id, 4000)，
   *  SceneMetrics.cs:276-282 / NPCEventZoneRadius=4000） */
  zone: { solar: boolean; vortex: boolean; nebula: boolean; stardust: boolean };
  /** 场上存活 NPC 计数（选表 CountNPCS 用；与月事件共用 Game 统计的 counts 表） */
  counts: ReadonlyMap<number, number>;
}

/** 月事件刷怪上下文（Game 每帧随 setPlayerFlags 传入） */
export interface MoonEventSpawnCtx {
  /** 1=霜月 2=南瓜月（MoonEventState.kind） */
  kind: number;
  /** 当前波（MoonEventState.waveNumber） */
  wave: number;
  /** 场上存活 NPC 计数（id → 数量；选表 CountNPCS 用） */
  counts: ReadonlyMap<number, number>;
  /** Boss 族 npcSlots 总和（reachedInvasionBossCap 判定用，NPC.cs:159-183） */
  bossSlotSum: number;
}

/** Boss 族（npcSlots 计入 reachedInvasionBossCap 的集合，NPC.cs:166-180） */
const MOON_BOSS_IDS = new Set([315, 325, 327, 328, 344, 345, 346]);
export { MOON_BOSS_IDS };
/** 单人 maxSpawns 上限 = ⌊5×(2+0.3×1)⌋ = 11（NPC.cs:174 num2） */
const MOON_BOSS_CAP_SLOTS = Math.floor(5 * (2 + 0.3 * 1));

// ---- 原版 tile type 常量（TileID），我们通过 TILE_BY_KEY 反查内部 id ----
const T = (() => {
  const get = (k: string) => TILE_BY_KEY[k] ?? 0;
  return {
    DIRT: get('dirt'), GRASS: get('grass'), STONE: get('stone'),
    SAND: get('sand'), SNOW: get('snow'), ICE: get('ice'), MUD: get('mud'),
    JUNGLE_GRASS: get('v_60_jungle_grass_block'), CORRUPT_GRASS: get('v_23_corrupt_grass_block'),
    CRIMSON_GRASS: get('v_199_crimson_grass_block'), MUSHROOM_GRASS: get('v_70_mushroom_grass_block'),
    EBONSAND: get('v_112_ebonsand_block'), CRIMSAND: get('v_234_crimsand_block'),
    PEARLSAND: get('v_116_pearlsand_block'), HARDENED_SAND: get('hardened_sand'),
    SANDSTONE: get('sandstone'), FOSSIL: get('desert_fossil'),
    MARBLE: get('v_367_marble_block'), GRANITE: get('v_368_granite_block'),
    // 23 陨石（tiles.ts key 为 ore_meteorite，非 v_23_*）
    METEORITE: get('ore_meteorite'),
    // 恶地落脚门两矿石（NPC.cs:3973/4032 tile 门：猩红 =(204&&ZoneCrimson)||199||200||203||234||662，
    // 腐化 =(22&&ZoneCorrupt)||23||25||112||163||661）——204=猩红矿/22=魔矿（TileID.cs:477/841），
    // 旧注释把 22 误标为"黄沙"并以 T.SAND&&ZoneCorrupt 顶替，已按原版改判矿石
    CRIMTANE: get('ore_crimtane'), DEMONITE: get('ore_demonite'),
    // 232 木刺（NPC.cs:3821 神庙砖门 tile 226||232）
    WOODEN_SPIKE: get('v_232_wooden_spike'),
    CACTUS: get('v_80_cactus'), SNOW_BRICK: get('snow_brick'), CATTAIL: get('v_519_cattails'),
    CORRUPT_ICE: get('v_163_purple_ice_block'), CRIMSON_ICE: get('v_200_red_ice_block'),
    // 164 粉冰(=神圣冰)：key 实为 v_164_pink_ice_block（旧注"未注册→0"有误，已注册）
    HOLLOW_ICE: get('v_164_pink_ice_block'), DUNGEON_BLUE: get('v_41_blue_brick'),
    DUNGEON_GREEN: get('v_43_green_brick'), DUNGEON_PINK: get('v_44_pink_brick'),
    // 恶土系计数(SceneMetrics.cs:614-615 非 remix 的 _tileCounts 公式)
    EBONSTONE: get('v_25_ebonstone_block'), CORRUPT_PLANT: get('v_24_corruption_short_plants'),
    CORRUPT_THORN: get('v_32_corruption_thorns'), CORRUPT_HARDSAND: get('v_398_corrupt_hardened_sand_block'),
    CRIMSTONE: get('v_203_crimstone_block'), CRIMSON_PLANT: get('v_201_crimson_short_plants'),
    CRIMSAND_THORN: get('v_352_crimtane_thorns'), CRIMSON_HARDSAND: get('v_399_crimson_hardened_sand_block'),
    SUNFLOWER: get('v_27_sunflower'),
    // 墓碑 85（SceneMetrics.cs:622 GraveyardTileCount）：Tombstones 单 tile 覆盖全部
    // 6 种墓碑（GraveMarker/Cross/Headstone/Gravestone/Obelisk/Golden 均为 style 变体）
    TOMBSTONE: get('tombstone_v'),
    // 神圣族计数(SceneMetrics.cs:603)：109 神圣草/492 神圣修剪草/110 神圣矮草/
    // 113 神圣高草/117 珍珠岩/402 神圣硬化沙/403 神圣沙岩（116 珍珠沙/164 粉冰见上）
    HALLOW_GRASS: get('v_109_hallowed_grass_block'), HALLOW_MOWED_GRASS: get('v_492_hallowed_mowed_grass_block'),
    MOWED_GRASS: get('v_477_mowed_grass_block'),
    HALLOW_PLANT: get('v_110_hallow_short_plants'), HALLOW_TALL_PLANT: get('v_113_hallow_tall_plants'),
    PEARLSTONE_BLOCK: get('v_117_pearlstone_block'), HALLOW_HARDSAND: get('v_402_hallow_hardened_sand_block'),
    HALLOW_SANDSTONE: get('v_403_hallow_sandstone_block'),
    // 雪族计数(SceneMetrics.cs:604)：162 薄冰（147/148/161/163/200/164 见上/常量区）
    THIN_ICE: get('thin_ice'),
    // 丛林族计数(SceneMetrics.cs:613)：61 矮草/62 藤/74 高草/225 蜂巢块/226 神庙砖
    JUNGLE_PLANT: get('v_61_jungle_short_plants'), JUNGLE_VINE: get('v_62_jungle_vines'),
    JUNGLE_TALL_PLANT: get('v_74_jungle_tall_plants'), HIVE: get('v_225_hive_block'),
    LIHZAHRD_BRICK: get('v_226_lihzahrd_brick'),
    // 蘑菇族计数(SceneMetrics.cs:617)：71 植株/72 蘑菇树/528 藤（70 蘑菇草见上）
    MUSHROOM_PLANT: get('v_71_mushroom_plant'), MUSHROOM_TREE: get('v_72_mushroom_tree'),
    MUSHROOM_VINE: get('v_528_mushroom_vines'),
    // 190 发光蘑菇块（NPC.cs:5010/5109 glowshroom 出怪门 tile 70||190 之一）
    MUSHROOM_BLOCK: get('v_190_glowing_mushroom_block'),
    // Moss 族（TileID.Sets.Conversion.Moss，TileID.cs:38）：CheckToSpawnRockGolem 落脚门
    // 179 绿/180 黄/181 红/182 蓝/183 紫/381 熔岩/534 氪/536 氙/539 氩/625 氖/627 氦
    MOSS_GREEN: get('v_179_green_moss_block'), MOSS_YELLOW: get('v_180_yellow_moss_block'),
    MOSS_RED: get('v_181_red_moss_block'), MOSS_BLUE: get('v_182_blue_moss_block'),
    MOSS_PURPLE: get('v_183_purple_moss_block'), MOSS_LAVA: get('v_381_lava_moss'),
    MOSS_KRYPTON: get('v_534_krypton_moss_block'), MOSS_XENON: get('v_536_xenon_moss_block'),
    MOSS_ARGON: get('v_539_argon_moss_block'), MOSS_NEON: get('v_625_neon_moss_block'),
    MOSS_HELIUM: get('v_627_helium_moss_block'),
    // 恶地族补齐（SceneMetrics.cs:614-615）：661 腐化丛林草/400 腐化沙岩/662/401 猩红对位
    // （旧注释称引擎无 def——实际均已注册，按 0 计是漏）
    CORRUPT_JUNGLE_GRASS: get('v_661_corrupt_jungle_grass_block'),
    CORRUPT_SANDSTONE: get('v_400_corrupt_sandstone_block'),
    CRIMSON_JUNGLE_GRASS: get('v_662_crimson_jungle_grass_block'),
    CRIMSON_SANDSTONE: get('v_401_crimson_sandstone_block'),
    // ★IIIII228 remix 恶地落脚门两新块：195 血肉块（:4066） / 474 病变块（:4125）
    FLESH_BLOCK: get('v_195_flesh_block'), LESION_BLOCK: get('v_474_lesion_block'),
  };
})();
/** 房屋墙表（Main.cs wallHouse[N]=true 全提取，279 项）：可由玩家放置的墙。
 *  FindSpawnTile L886：落点格带房屋墙 → 弃选（房屋内不刷怪的主守卫）；
 *  SetSpawnFlags L321：玩家所站格带房屋墙 → noWorms（房屋内不出蠕虫）
 *  ★QFH 2026-09-20：补 Main.cs:10491-10493 循环 Gemspark 153-166 共 14 面（与 Housing.ts
 *  同根缺口——此副本消费面=FindSpawnTile/SetSpawnFlags 房内不刷怪抑制,缺面=宝石火花墙
 *  房内仍可刷怪）。
 *  ★BJ204（2026-09-20）本地副本拆除：表体单源 = world/Housing.ts（三副本逐值对拍全等后
 *  收编），消费点 600/1458/2193/2195/4010 走顶部 import。 */

/** EvilTileCount 计数表(SceneMetrics.cs:614):23/661/24/25/32/112/163/400/398 计 1,27 向日葵 −10 */
const EVIL_LOOKUP = (() => {
  const t = new Uint8Array(TILE_DEFS.length);
  for (const id of [T.CORRUPT_GRASS, T.CORRUPT_JUNGLE_GRASS, T.EBONSTONE, T.CORRUPT_PLANT,
    T.CORRUPT_THORN, T.EBONSAND, T.CORRUPT_ICE, T.CORRUPT_SANDSTONE, T.CORRUPT_HARDSAND]) if (id) t[id] = 1;
  return t;
})();
/** BloodTileCount 计数表(SceneMetrics.cs:615):199/662/201/203/200/401/399/234/352 计 1 */
const BLOOD_LOOKUP = (() => {
  const t = new Uint8Array(TILE_DEFS.length);
  for (const id of [T.CRIMSON_GRASS, T.CRIMSON_JUNGLE_GRASS, T.CRIMSTONE, T.CRIMSON_PLANT,
    T.CRIMSON_ICE, T.CRIMSON_SANDSTONE, T.CRIMSON_HARDSAND, T.CRIMSAND, T.CRIMSAND_THORN]) if (id) t[id] = 1;
  return t;
})();
/** HolyTileCount 计数表(SceneMetrics.cs:603):109/492/110/113/117/116/164/403/402 计 1 */
const HOLY_LOOKUP = (() => {
  const t = new Uint8Array(TILE_DEFS.length);
  for (const id of [T.HALLOW_GRASS, T.HALLOW_MOWED_GRASS, T.HALLOW_PLANT, T.HALLOW_TALL_PLANT,
    T.PEARLSTONE_BLOCK, T.PEARLSAND, T.HOLLOW_ICE, T.HALLOW_SANDSTONE, T.HALLOW_HARDSAND]) if (id) t[id] = 1;
  return t;
})();
/** SnowTileCount 计数表(SceneMetrics.cs:604):147/148/161/162/164/163/200 计 1
 *  （注意 164 粉冰/163 紫冰/200 红冰同时计入雪族——转化冰都算雪原） */
const SNOW_LOOKUP = (() => {
  const t = new Uint8Array(TILE_DEFS.length);
  for (const id of [T.SNOW, T.SNOW_BRICK, T.ICE, T.THIN_ICE, T.HOLLOW_ICE,
    T.CORRUPT_ICE, T.CRIMSON_ICE]) if (id) t[id] = 1;
  return t;
})();
/** JungleTileCount 计数表(SceneMetrics.cs:613 非 remix):60/61/62/74/226/225 计 1 */
const JUNGLE_LOOKUP = (() => {
  const t = new Uint8Array(TILE_DEFS.length);
  for (const id of [T.JUNGLE_GRASS, T.JUNGLE_PLANT, T.JUNGLE_VINE, T.JUNGLE_TALL_PLANT,
    T.LIHZAHRD_BRICK, T.HIVE]) if (id) t[id] = 1;
  return t;
})();
/** MushroomTileCount 计数表(SceneMetrics.cs:617):70/71/72/528 计 1 */
const MUSHROOM_LOOKUP = (() => {
  const t = new Uint8Array(TILE_DEFS.length);
  for (const id of [T.MUSHROOM_GRASS, T.MUSHROOM_PLANT, T.MUSHROOM_TREE, T.MUSHROOM_VINE]) if (id) t[id] = 1;
  return t;
})();
/** Main.tileSand 全表（Main.cs:7177-7180，1.4.5.6 仅 4 项）：
 *  isOcean 判定（NPC.cs L1104）用沙族集合而非只认 53 黄沙 */
const TILE_SAND = new Set([T.SAND, T.EBONSAND, T.PEARLSAND, T.CRIMSAND]);
/** Main.wallLight 全表（Main.cs:10717-10732）：skyBehindPlayer 判定源——
 *  玩家所站格墙是发光墙（0=无墙也算"亮背景"）|| 墙 73（灯笼）→ 允许探测器
 *  399 在高空/地表出（NPC.cs:413 SetSpawnFlags / :1387 flag5 消费）。
 *  地下天然暗墙都不在表内 = 探测器永不出于地底的主守卫 */
const WALL_LIGHT = new Set([0, 21, 106, 107, 138, 139, 140, 141, 145, 150, 152, 168, 245, 315, 317, 318]);
/** WallID.Sets.AllowsUndergroundDesertEnemiesToSpawn（WallID.cs:42 九种）：
 *  地下沙漠 Zone 触发墙集——setFlagsForChosenTile 邻域扫描与
 *  SpawnTileOrAboveHasAnyWallInSet 直接格判定共用 */
const DESERT_WALL_SET = new Set([187, 216, 217, 218, 219, 220, 221, 222, 223]);
const isDesertWall = (wall: number): boolean => DESERT_WALL_SET.has(wall);
/** TileID.Sets.Conversion.Moss（TileID.cs:38）全表：CheckToSpawnRockGolem 落脚 tile 门
 *  （NPC.cs:5715：spawnTileType==1 石 或 Moss 族） */
const TILE_MOSS = new Set([T.MOSS_GREEN, T.MOSS_YELLOW, T.MOSS_RED, T.MOSS_BLUE, T.MOSS_PURPLE,
  T.MOSS_LAVA, T.MOSS_KRYPTON, T.MOSS_XENON, T.MOSS_ARGON, T.MOSS_NEON, T.MOSS_HELIUM]);
/** Main.unlockedSlimePurpleSpawn（NPC.cs:1325 绑缚紫史莱姆门）：玩家解锁紫城镇史莱姆后
 *  置位。本仓无城镇史莱姆解锁链 → 恒 false（门恒开，与未解锁世界一致）。
 *  登记 docs/spawn-parity-gaps.md（解锁链依赖 TownNPC 686 管线） */
// ---- 洞穴主池 cavernMonsterType 表（NPC.cs:6498 + 世界生成时 18058-18064 填充） ----
export let cavernMonsterType: number[][] = [[49, 49, 49], [49, 49, 49]];
export function rollCavernMonsterType(rng: RNG): void {
  for (let i = 0; i < 2; i++) {
    // 原版 Next(494,496)/Next(496,498)/Next(498,507)（WorldGen L18058-18064）——
    // 本仓库 RNG.int 为闭区间，此前写 int(494,496) 会多出 496/498/507 三个越界 id
    cavernMonsterType[i][0] = rng.int(494, 495); // 洞穴蝾螈族 v_494/v_495
    cavernMonsterType[i][1] = rng.int(496, 497);
    cavernMonsterType[i][2] = rng.int(498, 506);
  }
}

// ---- 原版 netID（负数）→ SetDefaultsFromNetId（L7633-7820）：基底 id + scale + 属性覆盖 ----
// scale/color/alpha 一律取源数据（public/sprites/vanilla-npcnetid.json，extract-npccolors.mjs 提取）
import vanillaNetIdJson from '../../data/vanilla-npcnetid.json';
const NET_ID_OVERRIDE: Record<string, { scale?: number; color?: number[]; alpha?: number }> = vanillaNetIdJson;

export const NET_ID_MAP: Record<number, { base: number; scale: number; hp?: number; dmg?: number; def?: number;
  /** ★BJ344：dmg/life 双精度 ×1.1 链旗（case -14 :7830-7831 / case -15 dmg :7840——
   *  `(int)((double)((float)v×scale)×1.1)`：f32 乘 scale 后拓宽 f64 乘 1.1 再截断） */
  x11?: boolean;
  /** ★BJ720-A（issue #19 D12）：flag=true 族（-1..-10）case 体硬置 value
   *  （NPC.cs:7695/:7704/:7714/:7724/:7736/:7745/:7755/:7764/:7773/:7782——
   *  100/100/3/10000/10/20/10/8/10/500），入尾段 ScaleStats 吃钱币乘区 */
  value?: number;
  /** ★BJ720-A：case 体 knockBackResist 乘子（:7694/:7703/:7713/:7722/:7733/:7753——
   *  -1/-2/-3 ×1.2、-4 ×1.4、-5 ×0.95、-7 ×0.9；-6/-8/-9/-10 无此行=1） */
  kb?: number }> = {
  // ★BJ337(2026-09-24)：-1/-2 base 16（母史莱姆）系旧表误值——原版 FromNetId(-1/-2)
  //  → NetIdMap[0]/[1]=81 腐化史莱姆（NPCID.cs:10450/:12478-12484；SetDefaultsFromNetId
  //  case -1/-2 :7687-7702 只做 SetDefaults_ForNetId(81, scale)+硬置 life/damage/defense）。
  //  真刷出点在 Enemy.ts BJ263 死亡分裂链（base 81 已硬编码正确）——刷生侧无 D(-1/-2)
  //  掷点=纯潜伏数据,但值以原版为准。hp/dmg/def=case 硬置值（1:1）。
  //  ★BJ720-A D12：value/kb=case 体 value 硬置与 kbr 乘子（尾段 flag=true 重排消费）。
  '-1': { base: 81, scale: 0.6, hp: 90, dmg: 45, def: 10, value: 100, kb: 1.2 },   // Slimeling 小腐化史莱姆
  '-2': { base: 81, scale: 0.9, hp: 90, dmg: 45, def: 20, value: 100, kb: 1.2 },   // Slimer2 大腐化史莱姆
  '-3': { base: 1, scale: 0.9, hp: 14, dmg: 6, def: 0, value: 3, kb: 1.2 },   // 绿史莱姆
  '-4': { base: 1, scale: 0.6, hp: 150, dmg: 5, def: 5, value: 10000, kb: 1.4 },
  '-5': { base: 1, scale: 0.9, hp: 30, dmg: 13, def: 4, value: 10, kb: 0.95 },  // 黑史莱姆
  '-6': { base: 1, scale: 1.05, hp: 45, dmg: 15, def: 4, value: 20 },
  '-7': { base: 1, scale: 1.2, hp: 40, dmg: 12, def: 6, value: 10, kb: 0.9 },
  '-8': { base: 1, scale: 1.025, hp: 35, dmg: 12, def: 4, value: 8 }, // 红（母史莱姆子代）
  '-9': { base: 1, scale: 1.2, hp: 45, dmg: 15, def: 7, value: 10 },   // 黄
  '-10': { base: 1, scale: 1.1, hp: 60, dmg: 18, def: 6, value: 500 },  // 丛林
  '-11': { base: 6, scale: 0.85 },   // 小噬魂怪
  '-12': { base: 6, scale: 1.15 },   // 大噬魂怪
  // 黄蜂族大小变体（FromNetId NetIdMap[55..64]：两两一族 231-235；scale 取 netid 表）
  '-16': { base: 42, scale: 0.85 }, '-17': { base: 42, scale: 1.2 },    // Little/Big Stinger
  // ★BJ337(2026-09-24)：-18..-21 苔藓黄蜂大小变体整缺（NetIdMap[17..20]=176 基底,
  //  原版 SetDefaultsFromNetId case -18..-21 NPC.cs:7867-7900 scale 0.8/0.9/1.1/1.2）。
  //  缺行=spawnNPC 走 map?.base??netId → fromVanilla(-18..-21)=null（vanilla-npcs.json
  //  无负键）→ 静默丢刷。活性面：蜂巢块 225 与深层丛林草 60 两刷点 hard 1/10 四支
  //  D(-21..-18) 曾全空掷（原版 NPC.cs:3835-3860/:3893-3918 同构支）。stat×scale
  //  家族债同 -15（spawn-parity-gaps.md）。
  '-18': { base: 176, scale: 0.8 }, '-19': { base: 176, scale: 0.9 },   // Tiny/Little Moss Hornet
  '-20': { base: 176, scale: 1.1 }, '-21': { base: 176, scale: 1.2 },   // Big/Giant Moss Hornet
  '-56': { base: 231, scale: 0.85 }, '-57': { base: 231, scale: 1.25 },
  '-58': { base: 232, scale: 0.8 }, '-59': { base: 232, scale: 1.15 },   // ★BJ344 勘正（case -59=1.15f,旧 1.17）
  '-60': { base: 233, scale: 0.92 },   // ★BJ344 勘正（case -60=0.92f,旧 0.83）
  '-61': { base: 233, scale: 1.1 },    // ★BJ344 勘正（case -61=1.1f,旧 1.21）
  '-62': { base: 234, scale: 0.78 }, '-63': { base: 234, scale: 1.16 },
  '-64': { base: 235, scale: 0.87 }, '-65': { base: 235, scale: 1.21 },
  // 地牢骷髅变体（case -13/-14/-15 :7818-7846）——★BJ344：flag=false 族 stat×scale 转
  //  运行时派生（见 spawnNPC 派生块），预计算硬置退役（专家/master 档原版序=基底
  //  ScaleStats 终值上再 ×scale，硬置值只对经典档且 -14 dmg/def 曾差 1）。
  //  f32 逐拍定谳（Math.fround 逐级）：-13 = 72/23/7（与旧硬置同值）; -14 def
  //  (int)(fround(8×1.15f))=9（旧 10 系先四舍五入 9.2→9 再×1.1 的错链）、dmg
  //  (int)(fround(fround(26×1.15f))×1.1)=32（旧 33 同病）、life 101 两法同值。
  '-13': { base: 31, scale: 0.9 },    // Short Bones（基底 31:80/26/8/130 ×0.9）
  '-14': { base: 31, scale: 1.15, x11: true },   // Big Boned（dmg/life 双精度 ×1.1 链）
  // ★BJ337(2026-09-24)：-15 旧表 base:1（绿史莱姆!）系误值——原版 FromNetId(-15)
  //  → NetIdMap[14]=77 Heavy Skeleton（NPCID.cs:10453），且 case -15（NPC.cs:7836-7846）
  //  硬置 life=400。旧值非潜伏：硬模洞穴主池 L4959（原版 NPC.cs:5059 同构）实刷点
  //  hard&&(remix||深层)&&1/5 → D(-15) 曾刷出 1.15 倍绿史莱姆。★BJ344：dmg/def
  //  ×scale（dmg 走 x11 双精度链,基底 77:40/28 → 50/32）+ knockBackResist×(2−scale)
  //  (0.4→0.34) + height=44 硬置（:7845,盒后覆写）转运行时派生。
  '-15': { base: 77, scale: 1.15, hp: 400, x11: true },   // Heavy Skeleton（life=400 硬置）
  // -22..-25 猩红族大小变体（SetDefaultsFromNetId L7858-7911 + NPCID.NetIdMap idx21-24）：
  //  -22/-23 = 小/大 Crimera（基底 173，scale 0.85/1.15）；-24/-25 = 小/大 Crimslime
  //  （基底 183，scale 0.85/1.15）。旧表误写 base:223（雨僵尸）——猩红分支
  //  （L4000-4020）补齐后这些 netId 会真实刷出，基底错则贴图/属性全错
  '-22': { base: 173, scale: 0.85 }, '-23': { base: 173, scale: 1.15 },
  '-24': { base: 183, scale: 0.85 }, '-25': { base: 183, scale: 1.15 },
  // 僵尸/骷髅/眼变种 = 基底 + scale（贴图同基底，属性缩放）。
  // 基底一律以 NPCID.NetIdMap（NPCID.cs:12457-12465，index = -id-1）为准：
  // -26..-37 僵尸族基底 3/132/186/187/188/189；-38..-42 恶魔眼族基底 190-194
  // （旧表误写 base:3——贴图/属性全错）；-43 基底 2；-44/-45 基底 200
  '-26': { base: 3, scale: 0.9 }, '-27': { base: 3, scale: 1.1 },
  '-28': { base: 132, scale: 0.85 }, '-29': { base: 132, scale: 1.15 },
  '-30': { base: 186, scale: 0.93 }, '-31': { base: 186, scale: 1.13 },
  '-32': { base: 187, scale: 0.89 }, '-33': { base: 187, scale: 1.11 },
  '-34': { base: 188, scale: 0.87 }, '-35': { base: 188, scale: 1.13 },
  '-36': { base: 189, scale: 0.92 }, '-37': { base: 189, scale: 1.08 },
  '-38': { base: 190, scale: 1.15 }, '-39': { base: 191, scale: 1.1 },
  '-40': { base: 192, scale: 0.9 }, '-41': { base: 193, scale: 0.85 },
  '-42': { base: 194, scale: 1.1 },
  '-43': { base: 2, scale: 1.15 },  // 小恶魔眼（★BJ344 勘正:旧 0.85 系 -41 错抄,case -43 :8130-8131=1.15f）
  '-44': { base: 200, scale: 0.87 }, '-45': { base: 200, scale: 1.05 },
  '-46': { base: 21, scale: 0.9 }, '-47': { base: 21, scale: 1.1 },   // ★BJ344 勘正 scale（case -47 :8171=1.1f,旧 0.9 全族错抄）
  '-48': { base: 201, scale: 0.93 },   // ★BJ344 勘正（:8181=0.93f,旧 0.9 全族错抄）
  '-49': { base: 201, scale: 1.07 },   // ★BJ344 勘正（:8191=1.07f）
  '-50': { base: 202, scale: 0.87 },   // ★BJ344 勘正（:8201=0.87f）
  '-51': { base: 202, scale: 1.13 },   // ★BJ344 勘正（case -51=1.13f）
  '-52': { base: 203, scale: 0.85 },   // ★BJ344 勘正（case -52=0.85f）
  '-53': { base: 203, scale: 1.15 },   // ★BJ344 勘正（case -53=1.15f）
  '-54': { base: 223, scale: 0.9 }, '-55': { base: 223, scale: 1.1 },
};

/** 原版 tileSolid 静态表语义谓词（SW-BJ37 2026-09-08）：
 *  `nactive() && tileSolid[type]`（CanSpawnInTile NPC.cs:5433 / FindSpawnTile 落地面
 *  :991 / 候选起点 :977 同款）。tileSolid 是 Main.cs 的静态赋值表——平台行为族九件套
 *  （19/239/380/427/435-439）在原版 tileSolid+tileSolidTop 双 true（=solid,Main.cs
 *  :8031-8032 等）；本仓 TILE_DEFS 把九件拆 platform 旗/solid:false（物理拆旗，
 *  TouchDamage.ts TILE_SOLID_TOP_FAMILY 注）→ 裸 isSolid 漏九件。生成链所有
 *  tileSolid 消费位（净空窗/落地面扫描/旅行商站立柱/螺旋净空）统一走本谓词：
 *  isSolid（已带 flags+致动门）∪ isActive&&TILE_SOLID_TOP_FAMILY（致动平台
 *  nactive=false 原版放行 ✓）。 */
/** ★B7 一百零八刀:mod 自然生成行(npcId/zone 群系门/water 水门/mult 权重倍)。
 *  注册=mod 装载期 spawn-chances 数据;消费=Game.trySpawnModEnemy(vanilla 选怪前)。 */
/** ★一百二十三刀:maxCount=NPC.CountNPCS 同种存活上限闸(vanilla 选怪同形) */
/** ★两百四十九刀:requireFlags/blockFlags=world.flags 条件门((mod boss downed 旗/事件门) */
export interface ModSpawnRule { npcId: number; zone: string | null; water: boolean; mult: number; maxCount?: number; depth?: { min: number; max: number }; requireFlags?: string[]; blockFlags?: string[]; }
export const MOD_SPAWN_RULES: ModSpawnRule[] = [];
/** ★D11-M2(2026-10-14):mod 生成规则 teardown(热重载;旧=push 累积 N 倍生成率) */
export function _resetModSpawnRulesForTests(): void {
  MOD_SPAWN_RULES.length = 0;
}

export function spawnTileSolid(st: TileStore, x: number, y: number): boolean {
  if (st.isSolid(x, y)) return true;
  return st.isActive(x, y) && TILE_SOLID_TOP_FAMILY.has(st.type[st.idx(x, y)]);
}

/** Main.tileSolidTop 静态表 1:1（SW-BJ37 2026-09-08）——旅行商 SpawnTravelNPC 站立柱
 *  扫描（WorldGen.cs:5231/5236 `SolidTile||tileSolidTop`）与上 3 格自由门（:5231
 *  `!active||!tileSolid||tileSolidTop`）消费。内部 id 域（未注册 sheet 过滤）；
 *  静态表不带 active/致动门——原版字面。
 *  ★BJ187 收编 data/tiles.ts:SOLID_TOP_IDS 单源（84 sheet 全表;旧 .map(
 *  TILE_INTERNAL_BY_SHEET) 平移习语逐值全等已对拍——含 435-439 团队平台五色
 *  Main.cs:10125-10131 循环臂,运行时可遇=原副本本就全等,零值变）。 */
export const VANILLA_TILE_SOLID_TOP = SOLID_TOP_IDS;

/** Main.tileSolid[type] 纯表谓词（SW-BJ37 2026-09-08）= SOLID_LUT ∪ 平台九件套，
 *  【不带】active/致动门——原版 SpawnTravelNPC 上 3 格自由门（WorldGen.cs:5231
 *  `!active() || !tileSolid[type] || tileSolidTop[type]`）按此消费（致动实心格
 *  active() 纯位仍真 → 阻挡）。 */
export function vanillaTileSolidPure(type: number): boolean {
  return TileStore.SOLID_LUT[type] === 1 || TILE_SOLID_TOP_FAMILY.has(type);
}

/** Collision.SolidTiles(startX,endX,startY,endY) 逐格谓词 1:1（Collision.cs:3494,
 *  SW-BJ37 2026-09-08）：`active() && !inActive() && tileSolid && !tileSolidTop`
 *  ——平台九件套/家具等 solidTop 族【不算】实心（与 CanSpawnInTile NPC.cs:5433
 *  的 tileSolid 表语义相反!）；半砖/坡面不排除（SolidTiles 无 slope/halfBrick 项,
 *  与 WorldGen.SolidTile :70650 区分）。史莱姆雨净空窗（NPC.cs:5940）与旅行商
 *  螺旋搜索净空（WorldGen.cs:5286）消费。 */
export function solidTilesCell(st: TileStore, x: number, y: number): boolean {
  const type = st.type[st.idx(x, y)];
  return st.hasTile(x, y) && !st.isActuated(x, y)
    && vanillaTileSolidPure(type) && !VANILLA_TILE_SOLID_TOP.has(type);
}

/** WorldGen.SolidTile(i,j) 1:1（WorldGen.cs:70650,SW-BJ37 2026-09-08）：
 *  `active() && tileSolid && !tileSolidTop && !halfBrick && slope==0 && !inActive()`
 *  ——旅行商站立柱扫描（WorldGen.cs:5231/5236 SolidTile||tileSolidTop）的 SolidTile 半边。 */
export function worldSolidTile(st: TileStore, x: number, y: number): boolean {
  const type = st.type[st.idx(x, y)];
  return st.hasTile(x, y) && !st.isActuated(x, y)
    && vanillaTileSolidPure(type) && !VANILLA_TILE_SOLID_TOP.has(type)
    && st.half[st.idx(x, y)] === 0 && st.slope[st.idx(x, y)] === 0;
}

export class VanillaSpawner {
  // ---- SpawnFlags（Spawner 字段 L39-137） ----
  private pX = 0; private pY = 0;
  /** 本轮半屏格数（spawn() 注入）——书怪 693/694 的书屏外门（CheckNotSpawningOnScreen
   *  对【书位】而非落点求值，NPC.cs:26275 AI_FindNearbyBook checkPlayerScreenRanges） */
  private viewHalfW = 0; private viewHalfH = 0;
  /** 本地玩家中心 px（spawn() 注入）——书屏外门用（原版 player.Center px，:5356） */
  private playerPx = 0; private playerPy = 0;
  private dayTime = true;
  /** 上下文雨旗（原版 Spawner.raining 字段,SetSpawnFlags L1106 `raining = Main.raining`
   *  → :1215-1218 remix 块按落点伪造 false）——spawn() 每轮自 world.weather.raining
   *  灌入,remix 重定义块可覆写;spawnAnNPC 消费点全部改读本字段（旧直读 world 侧
   *  无 remix 伪造通道） */
  private ctxRaining = false;
  private hardMode = false;
  private expert = false;
  private waterTile = false;
  private noWorms = false;
  /** noGroundWorms（NPC.cs:172/:412 `player.afkCounter >= 300`）——Game 每周期注入
   *  player.afkCounter（Player.fixedUpdate 计数链），setFlagsForChosenTile 头
   *  `!skyMob && noGroundWorms → noWorms=true`（NPC.cs:1052-1055，挂机不出蠕虫族）。
   *  ★影子蜡烛覆写(:420-425)清的就是本旗+noWorms+townNPCs 三连。终零波接入，
   *  旧「AFK 计数链未建模」登记销核 */
  noGroundWorms = false;
  /** ZoneShadowCandle（NPC.cs:328-333 tile 646 扫描 → noWorms/noGroundWorms=false + townNPCs=0；
   *  影子蜡烛覆写同步清 noGroundWorms） */
  private shadowCandle = false;         // 原版 wallHouse（房屋内不出蠕虫）
  /** GetSpawnRate 城镇段置位（NPC.cs:717/:734/:750/:767/:792/:814）：城镇 NPC ≥1 时
   *  蠕虫抑制。原版与 wallHouse 同字段（GetSpawnRate 在 SetSpawnFlags 之后调用,
   *  直接覆写 noWorms）;本仓 getSpawnRate/spawn 拆两次调用 → 先闩锁,spawn() 合成 */
  private townNoWorms = false;
  /** 原 ignoreSafeWalls（:73/:318）：仅星璇四塔 Zone 置位——FindSpawnTile :886 的
   *  房屋墙拒选豁免（塔战允许穿房屋墙刷怪;普通入侵不置位） */
  private ignoreSafeWalls = false;
  private skyMob = false;
  private surfaceSpawn = false;
  /** 本轮 spawnFriendly（NPC.cs:711-832 掷骰）：true = 本轮只走友好小动物链
   *  （SpawnAnNPC `else if (spawnFriendly)` :2006 段）;false = 小动物/宝石鼠兔/水黾段全跳过 */
  private spawnFriendlyCycle = false;
  /** Game 每轮尝试前置入(原版在 GetSpawnRate 同一例程内掷,本仓拆到 Game 侧以便
   *  同步 spawnRate/maxSpawns 修正;语义同序:掷骰失败时的 spawnRate 罚倍由 Game 应用) */
  setFriendlyCycle(v: boolean): void {
    this.spawnFriendlyCycle = v;
  }
  /** 原 underGround（L1043 非 remix）= spawnTileY <= rockLayer——**含地表**（见
   *  setFlagsForChosenTile 注释：旧实现误写成 groundLevel<y<rockLayer 带状） */
  private underGround = false;
  private deeperThanRockLayer = false;
  private isOcean = false;
  private isBeach = false;
  private nearMarble = false;
  private nearGranite = false;
  private spawnUndergroundDesert = false;
  /** 蜘蛛巢旗标（L1066/L1074）：落点邻域 ±5..15 格内有墙 62（1/3 概率扫描），
   *  或玩家所站格墙 62（2/3 概率查玩家位）——蜘蛛巢内/附近必出蜘蛛的真正触发器 */
  private spawnSpider = false;
  private ZoneSnow = false; private ZoneCorrupt = false; private ZoneCrimson = false;
  private ZoneHallow = false; private ZoneJungle = false; private ZoneGlowshroom = false;
  /** 陨石带（SceneMetrics.cs:56/685：窗口内陨石 tile ≥ MeteorTileThreshold=75） */
  private ZoneMeteor = false;
  private ZoneDungeon = false; private ZoneGraveyard = false; private ZoneBeach = false;
  /** 原版 downedBoss3（杀过骷髅王）：地牢分支切换 守卫→常规怪池 */
  private downedBoss3 = false;
  /** GetZombieSettings :5596：spawnArmedZombies（skyblock 低格未杀前 Boss 时 false） */
  private spawnArmedZombies = true;
  /** NPC.DownedAnyPreHardmodeBoss（NPC.cs:5588-5600）：史莱姆王/EoC/EoW/骷髅王/
   *  蜂王/鹿角怪 任一已败即 true；全无时返回 Main.hardMode（困难世界视为已过肉前段） */
  private downedAnyPreHardmodeBoss(): boolean {
    const f = this.world.flags as Record<string, boolean>;
    if (f.downedSlimeKing || f.downed_50 || f['downed_4'] || f.downedEyeOfCthulhu
      || f['downed_13'] || f['downed_266'] || f['downed_35'] || f.downedSkeletron
      || f['downed_222'] || f['downed_657']) return true;
    return !!f.hardMode;
  }
  private spawnTileX = 0; private spawnTileY = 0;
  /** FindSpawnTile 的 xRange 输出（L911：落脚点横向在 safeArea 内，传给 SpawnAnNPC） */
  private xRange = false;
  private spawnTileType = 0;
  /** 落脚点（Game 放置用） */
  currentSpawnX = 0;
  currentSpawnY = 0;
  /** GetZombieSettings（L5495）的地表夜僵尸 style（SpawnAnNPC 入口 Next(7) roll，L1193） */
  private zombieStyle = 0;
  /** GetZombieSettings（L5499-5514）：火把僵尸 590/591 的概率门分母。
   *  基础 12；playerHasStartingHealth（statLifeMax≤100，L327）→ 5 − 活跃玩家数/2（下限 2） */
  private torchZombieChance = 12;
  /** 玩家 statLifeMax（playerHasStartingHealth 判定用；未传入视为非初始血量 → 概率门 12） */
  private playerLifeMax = 0;
  /** 玩家幸运度（Spawner 各 Roll*Luck 掷骰的 luck 参，NPC.cs:5260-5275 委托
   *  Luck.Roll*(luck, range)；未传入 0 = 中性掷骰 Next(range)）。来源 Player.luck
   *  （RecalculateLuck :28672-28697 聚合，Game 每帧 setPlayerFlags 下发） */
  private playerLuck = 0;
  /** 玩家 ZoneWaterCandle（SetSpawnFlags L308 = player.ZoneWaterCandle =
   *  SceneMetrics.WaterCandleCount>0）。本仓取 getSpawnRate 的 waterCandle 入参
   *  （Game 传 手持||邻近，略宽于原版 SceneMetrics 单源）——SpawnAnNPC 的
   *  399/87/86 水蜡烛加重支消费 */
  private zoneWaterCandle = false;

  /** module8 编排出站钩（δB B12 接线,2026-08-31；Game.makeVanillaSpawner 注入）：
   *  两半边 = 本地直生（netApplyParticleOrchestra 同款复放）+ module8 上行（排除发送者
   *  广播），合起来即原版 BroadcastOrRequestParticleSpawn 客户端语义。缺省 = 钩未注入
   *  （测试/单机域）零调用面。当前唯一生产点 = spawnNPC 尾部 InScreenDungeonSpawn 门。 */
  spawnOrchestra?: (type: number, x: number, y: number,
    moveX: number, moveY: number, uniqueInfo: number) => void;

  constructor(private world: World) {}

  /** 玩家级 Zone 旗标（原版 Spawner.SetSpawnFlags L300：ZoneDungeon = player.ZoneDungeon——
   *  SceneMetrics 按玩家中心窗口判定，与落脚点无关）。Game 每帧刷怪前调用。
   *  invaders = ShouldSpawnInvasionEnemies(NPC.cs:352，入侵前线 3000px 内的地表玩家)；
   *  activeIds = 场上存活 NPC 的 vanillaId 集（选表 AnyNPCs 去重用）；
   *  moonEvent = 月事件上下文（事件开启时 Game 传入；null=无事件） */
  invaders = false;
  activeIds: Set<number> = new Set();
  /** 月事件上下文（null=无事件）+ 当帧 Boss 上限旗标（Spawner.ctor NPC.cs:159-183） */
  moonEvent: MoonEventSpawnCtx | null = null;
  moonBossCap = false;
  /** 星璇塔 Zone 上下文（null=不在塔区）；invaders 语义（SetSpawnFlags :315-318）由此驱动 */
  lunar: LunarSpawnCtx | null = null;
  /** tresspassingDualDungeon（NPC.cs:313）：getfixedboi 玩家置身双地牢不可破墙内
   *  （Player.insideUnbreakableWalls）且 DangerousDungeonCurse 进度档 < 所在区档——
   *  Game 侧比较后传入（Player.updateUnbreakableWallScan 维护扫描态） */
  trespassDual = false;
  /** BirthdayParty.PartyIsUp（Game 的 partyState 求值后传入——微光小动物链消费） */
  partyUp = false;
  /** Star.starfallBoost（每夜 NightSetup 重掷，Game 注入——流星夜附魔夜爬虫支消费） */
  starfallBoost = 1.0;
  /** NPC.AnyDanger（NPC.cs:81040-81108）快照（Game 每周期 npcAnyDanger() 喂入）：
   *  月总倒计时/入侵/月事件/旧军/Boss 族 ∪ DangerThatPreventsOtherDangers——
   *  火星探测器 399 的 flag5/flag17 "无危险"压制门消费（:1388/:4171） */
  anyDangerCtx = false;
  /** 目标玩家是否持有 Pal 联动收集物 5663/5664（Player.HasItem；Game 经
   *  invIndexOfVanilla+inv.countOf 每周期喂入）——695/696 遇袭双宠池强制档 */
  palHas5663 = false;
  palHas5664 = false;
  /** NearSpikeBall 锚点表（1456:90933-90948=1457:91002-91016）：场上 aiStyle 20
   *  （刺球 70）的 ai[1]/ai[2] 像素锚快照——Game 每周期在 activeIds 同循环采集喂入
   *  （spawner 无实体桶访问；未注入（测试/单机域）= 空数组 → 门恒 false） */
  spikeBallAnchors: Array<{ x: number; y: number }> = [];
  setPlayerFlags(zoneDungeon: boolean, downedSkeletron: boolean,
    invaders = false, activeIds: Set<number> = new Set(),
    moonEvent: MoonEventSpawnCtx | null = null,
    lunar: LunarSpawnCtx | null = null,
    playerLifeMax = 0,
    playerLuck = 0,
    trespassDual = false,
    partyUp = false,
    anyDanger = false,
    palHas5663 = false,
    palHas5664 = false,
    offensiveToTim = false): void {
    this.offensiveToTim = offensiveToTim;
    this.ZoneDungeon = zoneDungeon;
    this.downedBoss3 = downedSkeletron;
    this.invaders = invaders;
    this.activeIds = activeIds;
    this.moonEvent = moonEvent;
    this.lunar = lunar;
    this.playerLifeMax = playerLifeMax;
    this.playerLuck = playerLuck;
    this.trespassDual = trespassDual;
    this.partyUp = partyUp;
    this.anyDangerCtx = anyDanger;
    this.palHas5663 = palHas5663;
    this.palHas5664 = palHas5664;
    // SetSpawnFlags :315-319：任一塔 Zone → invaders=true && ignoreSafeWalls=true
    // （Game 侧 lunar 仅在任一塔 Zone 时非 null → 直接等价）
    this.ignoreSafeWalls = lunar != null;
    // reachedInvasionBossCap（Spawner 构造器 NPC.cs:159-183）：Boss 族 npcSlots 总和
    // ≥ 玩家数 × maxSpawns 上限（单人 ⌊5×2.3⌋=11）时当帧不刷 Boss
    this.moonBossCap = moonEvent != null && moonEvent.bossSlotSum >= 1 * MOON_BOSS_CAP_SLOTS;
  }

  /** 天气注入（Game 每 15 tick 下发）：cloudAlpha（雨强度，雪原刷怪修正）与沙尘暴态（怪池）。
   *
   *  ★雨旗语义警示（2026-08-13 审计定案；IIIII228 更新消费通道,语义不变）：本文件
   *  十余处雨门读 `this.ctxRaining`（spawn() 每轮自 `this.world.weather.raining` =
   *  原版 Main.raining 全局旗灌入）——NPC.Spawner.SetSpawnFlags（NPC.cs:282）
   *  `raining = Main.raining` 落 Spawner 字段,刷怪链全部雨门
   *  （:1865/:1939/:2289/:2381-2445/:4094/:4099…）读的都是该字段；
   *  ★IIIII228：remix 重定义块（:1215-1218）按落点伪造 false → 消费通道由直读
   *  world 侧改为本字段（等价 + remix 伪造可达）。
   *  ★不读 player.ZoneRain。SceneMetrics.ZoneRain（= Main.raining &&
   *  SurfaceAtmospherics，SceneMetrics.cs:700）带地表深度门，只供天气渲染/
   *  环境音/流星（WorldGen.cs:71934）消费——把刷怪雨门改读 zoneRain 会让地下
   *  玩家在雨天丢雨限定怪（冰雪高仑 243/雨云怪 250 等），属对原版的偏离。
   *
   *  反之 zoneSandstorm 必须走 SceneMetrics 派生位：NPC.cs:302
   *  `ZoneSandstorm = player.ZoneSandstorm`（= ZoneDesert && SurfaceAtmospherics &&
   *  Sandstorm.Happening，SceneMetrics.cs:701）——接线侧应传 scene.zoneSandstorm
   *  （勿再用 zoneDesert && 浅于地表+30 的近似） */
  rainCloudAlpha = 0;
  sandstormHappening = false;
  zoneSandstorm = false;
  setWeather(cloudAlpha: number, sandstormHappening: boolean, zoneSandstorm: boolean): void {
    this.rainCloudAlpha = cloudAlpha;
    this.sandstormHappening = sandstormHappening;
    this.zoneSandstorm = zoneSandstorm;
  }

  /** SlimeRainSpawns（NPC.cs:5829-5898 1:1）：史莱姆雨天空落怪。
   *  独立于常规 spawnRate 概率门（原版每玩家每帧先调本函数再 TrySpawnAnNPC）。
   *  nearbySlots>15 / 玩家过深直接拒绝；num3=45+450×(nearby/15)（专家 ×0.85）。
   *  落点：x=玩家±viewW、y=玩家上方 (1.5~0.75)×viewH 带 → 格门：
   *  x∈[10,w+10]、y∈[surface×0.3, surface]、周围 7×8 无实心、落点无房屋墙。
   *  选怪：1/200 蓝(-4)；专家 1/7 大(-7)、1/3 绿(-3)；普通 1/10 大、2/5 绿；默认蓝(1) */
  /** NPC.Spawner.SpawnFaelings（NPC.cs:5895-5932 1:1；触发端 = 玩家入微光区
   *  上升沿，Player.cs:16636 TrySpawningFaelings——Game.fixedUpdate 挂钩）：
   *  场上无 677 时 Next(2,6)=2-5 只微光之灵；每只 ≤1000 次采样——spawnArea
   *  （GetSpawnArea :841-877，0.7×全屏格 + 狙击镜扩圈）随机格须为微光液
   *  （liquid>0 && shimmer），沿液柱上溯至液面格（y<50 即【整函数】中止
   *  :5918-5922）；落点须 safeArea（0.52×全屏）外且屏外（CheckNotSpawningOnScreen）。
   *  spawnAt 收到原版 NewNPC 的 (X, BottomY) 底锚像素坐标（677 由 Game 侧经
   *  spawnNpcByVanilla 落 critters 桶）。 */
  spawnFaelings(
    px: number, py: number, viewHalfW: number, viewHalfH: number, rng: RNG,
    anyFaeling: () => boolean, spawnAt: (x: number, y: number) => void,
  ): void {
    if (anyFaeling()) return;                                    // AnyNPCs(677) :5898-5901
    const num = rng.int(2, 5);                                   // Main.rand.Next(2, 6)
    const st = this.world.store;
    // GetSpawnArea：0.7×全屏半轴 = viewHalf×1.4；safe 0.52×全屏 = ×1.04；
    // 狙击镜扩圈（scopeNum3 由 Game 每帧写入；1254 双持/1299/scope 三档）
    this.pX = Math.floor(px / TILE); this.pY = Math.floor(py / TILE);
    this.viewHalfW = viewHalfW; this.viewHalfH = viewHalfH;
    const sc = this.scopeNum3 > 0 ? Math.floor(viewHalfW / this.scopeNum3) : 0;
    const scY = this.scopeNum3 > 0 ? Math.floor(viewHalfH / this.scopeNum3) : 0;
    const rangeX = Math.max(1, Math.floor(viewHalfW * 1.4)) + sc;
    const rangeY = Math.max(1, Math.floor(viewHalfH * 1.4)) + scY;
    const safeX = Math.max(1, Math.floor(viewHalfW * 1.04)) + sc;
    const safeY = Math.max(1, Math.floor(viewHalfH * 1.04)) + scY;
    // WorldUtils.ClampToWorld（:875）
    const areaL = Math.max(2, this.pX - rangeX), areaR = Math.min(st.w - 3, this.pX + rangeX);
    const areaT = Math.max(2, this.pY - rangeY), areaB = Math.min(st.h - 3, this.pY + rangeY);
    for (let i = 0; i < num; i++) {
      for (let j = 0; j < 1000; j++) {                           // num2 = 1000
        const x = rng.int(areaL, areaR - 1);                     // Next(Left, Right)
        let y = rng.int(areaT, areaB - 1);
        if (!st.inBounds(x, y)) continue;
        const i0 = st.idx(x, y);
        if (st.liquid[i0] <= 0 || st.liquidType[i0] !== LIQUID_TYPE.SHIMMER) continue;  // :5914
        while (y >= 0 && st.liquid[st.idx(x, y)] > 0) {
          // :5917-5922：当前格仍有液 → y<50 即整函数中止，再上移一格
          //（循环出口 = 液面上方首个干格——落点即液面干格）
          if (y < 50) return;
          y--;
        }
        if (y < 50) return;
        // !safeArea.Contains && CheckNotSpawningOnScreen（:5923）
        if (!(Math.abs(x - this.pX) < safeX && Math.abs(y - this.pY) < safeY)
          && this.tileClearOfPlayerScreens(x, y, px, py)) {
          spawnAt(x * TILE + 8, y * TILE);                       // NewNPC :5924-5926
          break;                                                 // :5927 本只落定
        }
      }
    }
  }

  slimeRainSpawns(px: number, py: number, nearbySlots: number, viewW: number, viewH: number, rng: RNG, expert: boolean): Enemy | null {
    const w = this.world;
    const worldSurface = w.groundLevel;
    if (py > worldSurface * 16 + viewH / 2 || nearbySlots > 15) return null;
    const num2 = nearbySlots / 15;
    let num3 = 45 + Math.floor(450 * num2);
    if (expert) num3 = Math.floor(num3 * 0.85);
    if (num3 < 1) num3 = 1;
    if (rng.int(0, num3 - 1) !== 0) return null;
    const x0 = Math.floor(px - viewW), x1 = x0 + viewW * 2;
    const y0 = Math.floor(py - viewH * 1.5), y1 = Math.floor(py - viewH * 0.75);
    const tx = Math.floor(rng.int(x0, x1 - 1) / 16);
    const ty = Math.floor(rng.int(y0, y1 - 1) / 16);
    const st = w.store;
    if (tx < 10 || tx > st.w + 10 || ty < worldSurface * 0.3 || ty > worldSurface) return null;
    if (!st.inBounds(tx, ty)) return null;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -5; dy <= 2; dy++) {
        // Collision.SolidTiles(num5-3,num5+3,num6-5,num6+2)（NPC.cs:5940）逐格谓词
        //  = solidTilesCell（active&&!inActive&&tileSolid&&!tileSolidTop——平台/solidTop
        //  族【不算】实心,与 CanSpawnInTile 的 tileSolid 表语义相反,SW-BJ37 定谳）
        if (st.inBounds(tx + dx, ty + dy) && solidTilesCell(st, tx + dx, ty + dy)) return null;
      }
    }
    if (WALL_HOUSE.has(st.wall[st.idx(tx, ty)])) return null;
    let netId = 1;
    if (rng.int(0, 199) === 0) netId = -4;
    else if (expert) {
      if (rng.int(0, 6) === 0) netId = -7;
      else if (rng.int(0, 2) === 0) netId = -3;
    } else {
      if (rng.int(0, 9) === 0) netId = -7;
      else if (rng.int(0, 4) < 2) netId = -3;
    }
    return this.spawnNPC(tx * 16 + 8, ty * 16, netId, rng);
  }

  /** 造怪入口：netId 可为负（SetDefaultsFromNetId 映射）；
   *  ai0/ai1 = 原版 SpawnNPC 第 6/7 参（如攀爬者 101 的锚点格，NPC.cs:4040） */
  /** 萤火虫四向附加（dx,dy ∈ {(-16,0),(16,0),(0,-16),(0,16)}，各独立掷
   *  1/fireFlyMultiple；fireFlyMultiple 999999 绝迹哨兵经 1/999999 天然关闭）。
   *  ax/ay（绝对像素）非空时 Game 侧按绝对位落（香蒲蜻蜓附加落 cattail 顶±16，
   *  相对主怪 spawn 位无意义——review 批补） */
  private queueFireflyExtras(rng: RNG, npc: number): void {
    const m = Math.max(1, this.world.fireFlyMultiple);
    for (const [dx, dy] of [[-16, 0], [16, 0], [0, -16], [0, 16]] as const) {
      if (rng.next() < 1 / m) this.pendingCritterExtras.push({ npc, dx, dy });
    }
  }

  /** CheckToSpawnUndergroundFairy（NPC.cs:5730-5757 1:1）：fairyLog 门 +
   *  RollLuck(500[十周年 250]·hardMode ×1.66) + 深度窗 [(ws+rl)/2, h-300) +
   *  AnyHelpfulFairies 拒 */
  private checkToSpawnUndergroundFairy(rng: RNG): boolean {
    if (!this.world.fairyLog) return false;
    let num = 500;
    if (this.world.seedFlags?.tenthAnniversary && !this.world.seedFlags?.getGoodWorld) num = 250;
    if (this.hardMode) num = Math.floor(num * 1.66);
    if (rollLuck(this.playerLuck, num, () => rng.next()) !== 0) return false;
    if (this.spawnTileY < (this.world.groundLevel + this.world.rockLevel) / 2
      || this.spawnTileY >= this.world.store.h - 300) return false;
    return !this.fairyHelpfulActive;
  }

  private spawnNPC(x: number, y: number, netId: number, rng: RNG, ai0?: number, ai1?: number): Enemy | null {
    const map = NET_ID_MAP[netId];
    let baseId = map?.base ?? netId;
    // ★IIIII228 :5252-5261 SpawnNPC 包装位金史莱姆两掷（基底=蓝史莱姆 1 时）：
    //  RollLuck(180)==0 → -4 Pinky（NPC.luck 刷生槽缺省 0 = 裸 1/180）；十周年世界
    //  再 RollLuck(180)==0 → 667 金史莱姆（GoldenSlime,NPCID.cs:12405;SW-FX26 纠注:原注误标派对类）。
    //  雕像/召唤不走本包装（原版 Wiring→NewNPC 直出,无此掷）
    if (baseId === 1 && netId === 1) {
      if (rng.next() < 1 / 180) baseId = -4;
      if (this.world.seedFlags?.tenthAnniversary && rng.next() < 1 / 180) baseId = 667;
    }
    // IIII225：NewNPC FTW 野生交换（NPC.cs:81576-81586）——getGoodWorld 且
    // Next(3)!=0（2/3）→ 兔 46→爆破兔 614、恶魔 62→巫毒恶魔 66（两 if 共享一次掷）。
    // 原版门在 NewNPC 入口对一切运行时刷生路径生效；本仓只在【会刷出 46/62 的
    // 调用】掷骰——cs 对每次 NewNPC 都掷一次 Main.rand（全局流副作用），本仓刷生
    // 链各自独立流（Math.random/实体惯例），无条件加掷会漂移既有 spawn 决策序，
    // 故按「可交换类型才掷」收窄（行为面=交换概率 2/3,与原版逐次等价）。
    // 读档/联机傀儡不经本函数=不重掷（原版同——持久实体不重过 NewNPC）。
    if ((baseId === 46 || baseId === 62) && this.world.seedFlags?.getGoodWorld
      && rng.int(0, 2) !== 0) {
      if (baseId === 46) baseId = 614;
      else baseId = 66;
    }
    const e = Enemy.fromVanilla(baseId, x, y);
    if (!e) return null;
    applyModSpawnStats(baseId, e);   // ★二百七十八刀:rev/death HP 乘表(fromVanilla 后覆写即同序)
    // 非默认落位（≠spawn 位 spawnTileX*16+8 / spawnTileY*16）：Game 侧放置段
    // （critters 找地面/water 水下扫描）不得覆写——香蒲顶蜻蜓/海滩干隙线水表等
    // 自定义坐标会被挪到玩家落点（review 批补）
    if (x !== this.spawnTileX * TILE + 8 || y !== this.spawnTileY * TILE) {
      (e as unknown as { customSpawnPos?: boolean }).customSpawnPos = true;
    }
    const ov = NET_ID_OVERRIDE[String(netId)];
    e.vanillaNetId = netId;
    // ---- sizeScaleOverride 消费链（批次B 落地，ScaleStats.netIdSpawnScale 1:1）----
    // SetDefaultsFromNetId case → SetDefaults_ForNetId(num, spawnparams, scale)
    // → SetDefaults(base, WithScale(o))（NPC.cs:8328-8330）：
    //  ① FTW 入口膨胀 o'=(o+o²)/2（:8362-8366，图鉴假人豁免）
    //  ② 首盒【替换】类型 scale：w1=(int)(rawW×o')、h1==16||32→+1（:17733-17739）
    //  ③ 种子档调整在 o' 上再乘 + 命中分支二次盒（:18025-18026/:17861-17862）——
    //    十周年无 else-return 恒二盒：netID 基类型与两列表零交集 ⇒ 未列族
    //    盒 = rawW×o'×o' 二次乘（原版怪癖，照抄）。旧实现只改渲染乘区不改盒，
    //    判定区恒基底尺寸（批次B 修复）。
    let oScale = ov?.scale ?? map?.scale;
    // ★IIIII228 SetDefaultsFromNetId 四 remix/getGood 锚：case -11（:7787）/-22（:7909）
    //  /-23（:7926）remix ×1.3、case -12（:7804）(remix||getGood) ×1.3——乘在
    //  SetDefaults_ForNetId 入口 override 上（先于 :8456 FTW 膨胀 o'=(o+o²)/2）。
    //  图鉴假人豁免（!IsABestiaryIconDummy）——本仓刷生路径恒非假人
    if (oScale != null) {
      const sf = this.world.seedFlags;
      if ((netId === -11 || netId === -22 || netId === -23) && sf?.remix) {
        oScale = f32(oScale * f32(1.3));
      } else if (netId === -12 && (sf?.remix || sf?.getGoodWorld)) {
        oScale = f32(oScale * f32(1.3));
      }
    }
    let netScale: number | null = null;
    if (oScale != null) {
      const v = e.vanilla!;
      const box = netIdSpawnScale(baseId, oScale, v.width, v.height, scaleStatsWorld());
      e.w = e.def.width = box.width;
      e.h = e.def.height = box.height;
      e.vanillaScale = box.scale / (v.scale ?? 1);   // 渲染（v.scale × vanillaScale）= npc.scale
      if (box.canDisplayBuffs === false) e.canDisplayBuffs = false;
      netScale = box.scale;   // ★BJ344：终值 scale（含 FTW/种子档链）——stat 派生同源
    }
    // 原版 NewNPC 锚点(NPC.cs:46596-46597):X-width/2, Y-height(底部贴格顶)——
    // 盒定后再锚（此前 fromVanilla 中心锚 y-h/2 埋进落脚实心格半格高）
    e.y = y - e.h;
    if (map) {
      // flag=true 族硬置属性（SetDefaultsFromNetId case 块 :7643+，跑在完整
      // SetDefaults（含 ScaleStats）之后——fromVanilla 数值链后再覆写即同序）
      if (map.hp != null) e.hp = e.maxHp = map.hp;
      if (map.dmg != null) e.def.damage = map.dmg;
      if (map.def != null) e.def.defense = map.def;
      // ★BJ720-A（issue #19 D12，2026-10-25）：flag=true 族（-1..-10 三值全硬置）尾段
      //  重排（NPC.cs:8363-8372 `if (flag) { ScaleStats(...); life = lifeMax; }`）——
      //  case 体的 kbr ×乘子/value 硬置与尾段完整难度链（专家/大师乘区 + 肉后
      //  ForExpertHardmode 兜底（世花后 80→100 阈值）+ lifeMax<6 下限）此前全缺=
      //  三档停经典硬编码（实测 -1..-10 三档同值）。单源=netIdFlagTrueRescale
      //  （分裂幼体/风气球 594 携带变体同源消费）。
      if (map.hp != null && map.dmg != null && map.def != null) {
        const vBase = e.vanilla!;
        const fin = netIdFlagTrueRescale(
          { type: baseId, boss: !!e.def.boss, friendly: !!vBase.friendly, townNPC: !!vBase.townNPC,
            scale: netScale ?? (vBase.scale ?? 1) },   // npc.scale 终态（盒链后）
          { life: map.hp, damage: map.dmg, defense: map.def,
            value: map.value ?? e.def.value ?? 0, kbMul: map.kb },
          e.def.knockbackResist ?? 1, scaleStatsWorld());
        e.hp = e.maxHp = fin.lifeMax;
        e.def.damage = fin.damage;
        e.def.defense = fin.defense;
        e.def.value = fin.value;
        e.def.knockbackResist = fin.knockbackResist;
      }
    }
    // ★BJ344（spawn-parity-gaps「flag=false netID 族 case 体 stat×scale」清偿）：
    //  SetDefaultsFromNetId 各 case 体（NPC.cs:7784-8360）在基底完整 SetDefaults
    //  【含尾段 ScaleStats :17888 与种子档调整 :17873-17881】之后跑：
    //  def/dmg/life/value = (int)((float)v×scale)（-14 dmg/life 与 -15 dmg 另走
    //  (int)((double)((float)v×scale)×1.1) 双精度链 :7830-7831/:7840）+
    //  knockBackResist ×= 2f−scale。flag=false ⇒ :8368-8372 的 ScaleStats 门不达
    //  （flag=true 硬置族才补）——本仓 fromVanilla 产出=ScaleStats 终值（基底
    //  SetDefaults 尾 :17888 同序），此位 ×scale 截断即原版序。f32 逐拍：scale 先
    //  fround、乘积 fround（= C# (float) 单精度乘）后 trunc；×1.1 链乘在 f32 积的
    //  f64 拓宽上。flag=true 硬置族（-1..-10,三值全硬置）不动=其硬置后 ScaleStats
    //  重排另案登记；npcSlots 仓库无运行时承载=登记 residual。
    if (map && netScale != null && !(map.hp != null && map.dmg != null && map.def != null)) {
      const s = f32(netScale);
      const sMul = (x: number): number => f32(x * s);
      const tr = (x: number): number => Math.trunc(x);
      if (map.hp != null) e.hp = e.maxHp = map.hp;   // -15 life=400 硬置（无 ×1.1 链）
      else e.hp = e.maxHp = tr(map.x11 ? sMul(e.maxHp) * 1.1 : sMul(e.maxHp));
      if (map.dmg != null) e.def.damage = map.dmg;
      else e.def.damage = tr(map.x11 ? sMul(e.def.damage ?? 0) * 1.1 : sMul(e.def.damage ?? 0));
      if (map.def != null) e.def.defense = map.def;
      else e.def.defense = tr(sMul(e.def.defense ?? 0));
      // knockBackResist ×= 2f−scale（:7798 等——C# 2f−scale f32 减 + f32 乘）
      e.def.knockbackResist = f32((e.def.knockbackResist ?? 1) * f32(2 - s));
      if (e.def.value != null) e.def.value = tr(sMul(e.def.value));
      // -15 height=44 硬置（case -15 :7845,盒链后覆写,仅高不宽）+ 底锚随盒重算
      if (netId === -15) { e.def.height = 44; e.h = 44; e.y = y - e.h; }
    }
    // SetDefaultsFromNetId 覆盖 color/alpha（L7633+：color = new Color(...) / alpha = N）
    if (ov?.color) e.colorRGBA = [ov.color[0], ov.color[1], ov.color[2], ov.color[3] ?? 255];
    if (ov?.alpha != null) e.spawnAlpha = ov.alpha;
    // 植物族锚点（aiStyle 13：锚点格存 ai0/ai1）
    if (ai0 !== undefined && ai1 !== undefined) { e.ai0 = ai0; e.ai1 = ai1; }
    // InScreenDungeonSpawn（NPC.SpawnNPC :5265-5273——原版所有自然刷生链共用本包装位,
    //   史莱姆雨 SlimeRainSpawns 同走此口；δB B12 接线,2026-08-31。微光之灵 SpawnFaelings
    //   走裸 NewNPC :5924 不经此包装,故不出纸屑——本仓 faelings 回调路径同构）：
    //   门 = dualDungeonsSeed && Y > worldSurface×16 && Y < UnderworldLayer×16
    //   （Y 为像素坐标、严格不等;UnderworldLayer=本仓 world.lavaLine=maxTilesY−200）；
    //   PositionInWorld=(X,Y)、MovementVector=(width,height)、UniqueInfoPiece=Type(netId 原值)。
    const w_ = this.world;
    if (w_.seedFlags?.dualDungeons && y > w_.groundLevel * TILE && y < w_.lavaLine * TILE) {
      this.spawnOrchestra?.(ParticleOrchestraType.InScreenDungeonSpawn,
        x, y, e.w, e.h, netId);
    }
    e.id = this.world.store.w; // 占位，Game 侧会重编
    return e;
  }

  /** 绑缚救援族占位造怪（105/106/685/589 四链）：在本仓的产出是 bound TownNPC——
   *  Game.trySpawnEnemy 只读 vanillaId 转 bound TownNPC（trySpawnBoundTownNpc；
   *  123/354 走真体 D() 链同转换），占位体随即弃置。不走 spawnNPC/fromVanilla 系
   *  链路决策（★BJ117-③ 勘误：vanilla-npcs.json 现已含 685/589 真条目——旧注
   *  "缺 685 条目、fromVanilla null 静默丢弃（同 686 先例）"已过时） */
  private spawnBound(id: number): Enemy {
    const e = new Enemy(`v_${id}`, this.spawnTileX * TILE + 8, this.spawnTileY * TILE);
    e.vanillaId = id;
    e.id = this.world.store.w; // 占位，Game 侧会重编
    return e;
  }

  // ---- SetSpawnFlagsForChosenTile（L950-1185） ----
  private setFlagsForChosenTile(spawnTileX: number, spawnTileY: number, spawnTileType: number, rng: RNG): void {
    const st = this.world.store;
    this.spawnTileX = spawnTileX; this.spawnTileY = spawnTileY; this.spawnTileType = spawnTileType;
    // noGroundWorms → noWorms 顶针（NPC.cs:1052-1053 SetSpawnFlagsForChosenTile 头部
    // `if (!skyMob && noGroundWorms) { noWorms = true; }`）——AFK ≥300 的玩家周围
    // 选点一律按房屋门关闭（影子蜡烛覆写在 getSpawnRate 侧同拍清三旗，原版序一致）
    if (!this.skyMob && this.noGroundWorms) this.noWorms = true;
    // waterTile（L957）：落脚格上方两格都是液体且为水
    const above1 = st.idx(spawnTileX, spawnTileY - 1), above2 = st.idx(spawnTileX, spawnTileY - 2);
    this.waterTile = st.liquid[above1] > 0 && st.liquid[above2] > 0 && st.liquidType[above1] === 1;
    // nearMarble/nearGranite（L960-1046）：落点 tile → 玩家 tile → 两轮邻近扫描
    // (落点 ±Next(20,30) 步长 Next(1,4) + 玩家 ±Next(30,60) 步长 Next(3,7) 抽样)。
    // 只查落点/玩家两格会让小体量大理石/花岗岩洞几乎永远探测不到
    if (spawnTileType === T.MARBLE) this.nearMarble = true;
    else if (spawnTileType === T.GRANITE) this.nearGranite = true;
    else if (st.type[st.idx(this.pX, this.pY)] === T.MARBLE) this.nearMarble = true;
    else if (st.type[st.idx(this.pX, this.pY)] === T.GRANITE) this.nearGranite = true;
    else {
      const scanType = (cx0: number, cy0: number, r: number, stepI: number, stepJ: number) => {
        const x0 = Math.max(0, cx0 - r), x1 = Math.min(st.w - 1, cx0 + r);
        const y0 = Math.max(0, cy0 - r), y1 = Math.min(st.h - 1, cy0 + r);
        for (let i = x0; i <= x1; i += stepI) {
          for (let j = y0; j <= y1; j += stepJ) {
            const tt = st.type[st.idx(i, j)];
            if (tt === T.MARBLE) this.nearMarble = true;
            else if (tt === T.GRANITE) this.nearGranite = true;
          }
        }
      };
      scanType(spawnTileX, spawnTileY, rng.int(20, 30), rng.int(1, 3), 1 + (rng.next() * 3 | 0));
      scanType(this.pX, this.pY, rng.int(30, 60), rng.int(3, 6), 3 + (rng.next() * 4 | 0));
    }
    // 地下沙漠（L1078-1100）：同蜘蛛巢的双路触发——1/3 扫落点 ±Next(5,15) 墙集，2/3 查玩家所站格墙。
    // 墙表 = WallID.Sets.AllowsUndergroundDesertEnemiesToSpawn 全表（WallID.cs:42：
    // 187,216,217,218,219,220,221,222,223 九种——此前只取 {216,217,187} 三分之一，
    // 沙岩/硬化沙变体墙区域漏判）；门带 !invaders（原版 L1077/L1053 同款）
    if (spawnTileY < this.world.rockLevel && spawnTileY > 200 && !this.ZoneDungeon && !this.invaders) {
      if (rng.next() < 1 / 3) {
        const r = rng.int(5, 14);
        const x0 = Math.max(0, spawnTileX - r), x1 = Math.min(st.w - 1, spawnTileX + r - 1);
        const y0 = Math.max(0, spawnTileY - r), y1 = Math.min(st.h - 1, spawnTileY + r - 1);
        for (let sx = x0; sx <= x1 && !this.spawnUndergroundDesert; sx++) {
          for (let sy = y0; sy <= y1; sy++) {
            if (isDesertWall(st.wall[st.idx(sx, sy)])) { this.spawnUndergroundDesert = true; break; }
          }
        }
      } else if (isDesertWall(st.wall[st.idx(this.pX, this.pY)])) {
        this.spawnUndergroundDesert = true;
      }
    }
    this.surfaceSpawn = spawnTileY <= this.world.groundLevel;
    this.deeperThanRockLayer = spawnTileY >= this.world.rockLevel;
    // L1043（非 remix）：underGround = spawnTileY <= rockLayer——**含地表**！消费点有二：
    //  ① 神圣段 :3946 门 (hardMode && underGround)（内部 661 支自带 surfaceSpawn 条件
    //   即是"本段可从地表进入"的原文佐证）→ 地表神圣落脚夜间同样出 122/86/75 池;
    //  ② 地下层刷怪段 :4718——位于 surfaceSpawn 段之后,可达时恒 worldSurface < y <= rockLayer
    //   （与旧带状写法等价,行为不变）。
    //  旧实现误写成 groundLevel<y<rockLayer 带状 → 地表神圣被该段漏判
    // L1145-1149（★IIIII228）：underGround remix 重定义——remix 世界"地下"=
    //  岩石层以下、maxTilesY-190（地狱池带上界）为止；地表（≤rockLayer）不算地下
    this.underGround = this.world.seedFlags?.remix
      ? (spawnTileY > this.world.rockLevel && spawnTileY <= st.h - 190)
      : spawnTileY <= this.world.rockLevel;
    // isOcean（L1104 1:1）：(边缘 && Main.tileSand[spawnTileType] && 岩石层上)
    //  || (spawnTileType==53 && oceanDepths)。沙族 = Main.cs:7177-7180 全表（53/112/116/234），
    //  只认 53 会漏黑檀沙/珍珠沙/猩红沙海床。
    // oceanDepths（WorldGen.cs:10978-10988 1:1）：y ≤ oceanLevel（=（worldSurface+rockLayer)/2+40，
    //  WorldGen.cs:4393）&& x < beachDistance。oceanDistance/beachDistance 是
    //  **不随图宽缩放**的常量（WorldGen.cs:4100/4102 = 250/380）——BeachPass 的
    //  oceanWater 220~260 / beachSandRandomCenter+20=340 是另一套生成期随机值，
    //  与本判定的 250/380 无对应关系，此前借它近似（260/340）属错位：
    //  第二项 beachX 340→380 会漏判 40 格沙滩海床。本仓世界恒 4200 宽（van=1），
    //  直接取原版常量。
    const oceanX = 250;    // WorldGen.oceanDistance
    const beachX = 380;    // WorldGen.beachDistance
    this.isOcean = ((spawnTileX < oceanX || spawnTileX > st.w - oceanX)
      && TILE_SAND.has(spawnTileType) && spawnTileY < this.world.rockLevel)
      || (spawnTileType === T.SAND
        && spawnTileY <= (this.world.groundLevel + this.world.rockLevel) / 2 + 40
        && (spawnTileX < beachX || spawnTileX > st.w - beachX));
    this.isBeach = spawnTileY <= this.world.groundLevel && (spawnTileX < beachX || spawnTileX > st.w - beachX);
    // Zone 判定（SceneMetrics.cs:24-64/648-697）：全部六族走玩家中心 169×123 窗口计数，
    // 阈值 Snow 1500 / Corrupt·Crimson 300 / Hallow 125 / Jungle 140 / Mushroom 100。
    // 旧实现只有恶地走窗口计数，其余只看落脚单格 → 雪原/神圣/丛林/蘑菇地常漏判
    this.refreshZoneCounts(this.pX, this.pY);
    this.ZoneSnow = this.zoneCounts.snow >= 1500;
    this.ZoneCorrupt = this.zoneCounts.evil >= 300;
    this.ZoneCrimson = this.zoneCounts.blood >= 300;
    this.ZoneHallow = this.zoneCounts.holy >= 125;
    this.ZoneJungle = this.zoneCounts.jungle >= 140;
    this.ZoneGlowshroom = this.zoneCounts.mushroom >= 100;
    this.ZoneMeteor = this.zoneCounts.meteor >= 75;
    // ZoneGraveyard（SceneMetrics.cs:622-623/686）：墓碑 85 计数 − 向日葵/2（下取整、钳 ≥0）
    //  ≥ GraveyardTileThreshold 28——向日葵每 2 株抵 1 块墓碑
    this.ZoneGraveyard = this.zoneCounts.graveyard >= 28;
    // ★IIIII228 :1207-1255 remix 上下文重定义块（原版序=isOcean/isBeach 初值之后、
    //  蜘蛛带/双地牢尾之前;JS 侧 Zone 旗在上方现取后引用——与原版 SetSpawnFlags
    //  先取 Zone 再进本块同序）。五组语义：
    //  ① deeperThanRockLayer 重定义：remix"深于岩石层"=浅地下带 (ws, rockLayer) 开区间——
    //   下游消费（蜘蛛 flag7/蠕虫池/神圣池等）自动吃到重定义值（原版同字段语义）
    //  ② 上下文雨/昼伪造：落点在地表+5 之上或地狱层之下 → raining=false；
    //   地表+5 之上 → dayTime=false（remix 地下"永恒黑夜"的刷怪语义——
    //   消费点=spawnAnNPC 昼夜池门与雨天门,走 this.dayTime/this.ctxRaining）
    //  ③ 恶地清海洋/沙滩上下文（腐化/猩红落脚不出渔夫/海鸥链）
    //  ④ 带外(0.43w~0.57w 之外)浅岩下带两次独立 1/2 掷：伪装海洋/海滩上下文
    //   （remix 地下"海"出渔夫/海鸥——两次掷各自独立,均落在 Y∈(rock-200, h-200)）
    //  ⑤ 岩石层-20 之下：2/3 地表化+昼夜重掷（1/2）；否则血月（或日食昼）中带
    //   （0.38w+50, 0.62w）地表化——★原血月中带支曾无条件化（非 remix 世界泄漏）,
    //   本批按原文收进 remix 门内（掷流序:④两掷→⑤Next(3)→Next(2),在蜘蛛带 1/3 掷前;
    //   原版蜘蛛带先于本块,既有 JS 序=沙漠带→蜘蛛带与本块的相对序沿用现状,登记）
    if (this.world.seedFlags?.remix) {
      this.deeperThanRockLayer = spawnTileY > this.world.groundLevel && spawnTileY < this.world.rockLevel;
      const nearSky = spawnTileY < this.world.groundLevel + 5;
      const belowHell = spawnTileY > st.h - 200;
      if (nearSky || belowHell) this.ctxRaining = false;
      if (nearSky) this.dayTime = false;
      if (this.ZoneCorrupt || this.ZoneCrimson) {
        this.isOcean = false;
        this.isBeach = false;
      }
      if (spawnTileX < st.w * 0.43 || spawnTileX > st.w * 0.57) {
        if (spawnTileY > this.world.rockLevel - 200 && spawnTileY < st.h - 200 && rng.int(0, 1) === 0) {
          this.isOcean = true;
        }
        if (spawnTileY > this.world.rockLevel - 200 && spawnTileY < st.h - 200 && rng.int(0, 1) === 0) {
          this.isBeach = true;
        }
      }
      if (spawnTileY > this.world.rockLevel - 20) {
        if (spawnTileY <= st.h - 190 && rng.int(0, 2) !== 0) {
          this.surfaceSpawn = true;
          this.dayTime = rng.int(0, 1) === 0;
        } else if ((this.world.clock?.bloodMoon
          || (this.world.clock?.eclipse && this.dayTime))
          && spawnTileX > st.w * 0.38 + 50 && spawnTileX < st.w * 0.62) {
          this.surfaceSpawn = true;
        }
      }
    }
    // ZoneDungeon 不在此设置：原版取玩家 SceneMetrics（SetSpawnFlags L300），见 setPlayerFlags
    // ---- 蜘蛛巢旗标（L1045-1079）:岩石层~地狱层 && 非地牢 && 非入侵时 ----
    // 1/3 概率扫落点 ±Next(5,15) 立方盒内任意墙 62;否则查玩家所站格墙 62。
    // 此前只查落点一格,玩家站巢里时屏幕外环带点几乎全在巢外 → 蜘蛛永不触发
    // ★IIIII228 :1150-1153 theConstant 臂：dontStarve 世界带门去掉岩石层下界
    // （flag = spawnTileY < UnderworldLayer）——地表墙 62 也可触发蜘蛛带
    const spiderBandOK = this.world.seedFlags?.theConstant
      ? spawnTileY < st.h - 200
      : (spawnTileY > this.world.rockLevel && spawnTileY < st.h - 200);
    if (spiderBandOK && !this.ZoneDungeon && !this.invaders) {
      if (rng.next() < 1 / 3) {
        const r = rng.int(5, 14);
        const x0 = Math.max(0, spawnTileX - r), x1 = Math.min(st.w - 1, spawnTileX + r - 1);
        const y0 = Math.max(0, spawnTileY - r), y1 = Math.min(st.h - 1, spawnTileY + r - 1);
        for (let sx = x0; sx <= x1 && !this.spawnSpider; sx++) {
          for (let sy = y0; sy <= y1; sy++) {
            if (st.wall[st.idx(sx, sy)] === 62) { this.spawnSpider = true; break; }
          }
        }
      } else if (st.wall[st.idx(this.pX, this.pY)] === 62) {
        this.spawnSpider = true;
      }
    }
    // ★IIIII22b：双地牢 chosen-tile 尾部支（NPC.cs:1256-1281 → :428-441，本批主接面）。
    // 门 = dualDungeonsSeed && 世界表面以下 && 地狱层以上；rand(7) 重掷三层带（0/1 地表化/
    // 2 地下/3-6 深岩层）+ NPCSpawningFlagsForDualDungeons 按落脚格九位重写玩家 Zone*。
    // 原版是 SetSpawnFlagsForChosenTile 的**最后一段**——JS 折叠的窗口计数值（上方
    // ZoneSnow..ZoneGlowshroom）按 vanilla 序在这里被扫描值覆盖。非双地牢世界零掷零写。
    if (this.world.seedFlags?.dualDungeons
      && spawnTileY > this.world.groundLevel && spawnTileY < st.h - 200) {
      switch (rng.int(0, 6)) {                          // Main.rand.Next(7)
        case 0: case 1:
          this.surfaceSpawn = true;
          this.underGround = false;
          this.deeperThanRockLayer = false;
          break;
        case 2:
          this.surfaceSpawn = false;
          this.underGround = true;
          this.deeperThanRockLayer = false;
          break;
        default:
          this.surfaceSpawn = false;
          this.underGround = false;
          this.deeperThanRockLayer = true;
          break;
      }
      const scan = scanChosenTileZones(st, spawnTileX, spawnTileY, this.world.rockLevel);
      // NPC.cs:432-440 覆盖序 1:1：dungeon/desert 取与（&=），其余六位直接重写
      this.ZoneDungeon = this.ZoneDungeon && scan.ZoneDungeon;
      this.ZoneSnow = scan.ZoneSnow;
      this.ZoneGlowshroom = scan.ZoneGlowshroom;
      this.ZoneCorrupt = scan.ZoneCorrupt;
      this.ZoneCrimson = scan.ZoneCrimson;
      this.ZoneJungle = scan.ZoneJungle;
      this.ZoneHallow = scan.ZoneHallow;
      this.ddLihzhardLatch = scan.ZoneLihzhardTemple;   // ZoneLihzhardTemple = scan
      this.spawnUndergroundDesert = this.spawnUndergroundDesert && scan.ZoneUndergroundDesert;
    } else {
      this.ddLihzhardLatch = null;                      // 非门路径复位闩（vanilla 每次重建等价）
    }
  }

  /** tileDungeon 集（Main.cs:7941-7946）：41/43/44 主砖（677-679 安全变体未注册缺席=0）。
   *  PostCheckChosenSpawnTile L922-927：ZoneDungeon 时落脚点必须踩地牢砖且
   *  spawnWallType（=落脚格上方一格的墙，GetProperGroundSpawnTileTypeAndWallType L5792）非 0。
   *  查落脚格自身的墙会因地板砖 wall=0 恒拒 → 地牢几乎不刷怪 */
  /** IsThisAGoodPlaceForAStatueMimic（NPC.cs:43751-43761 1:1）：落脚 x/x+1 两格
   *  SolidTile2（活跃+实心+无坡+非半砖+非致动），上方 3 格两列全净空。
   *  与附近是否存在雕像无关（函数名历史遗留）——纯落点预检 */
  private isGoodPlaceForAStatueMimic(): boolean {
    const st = this.world.store;
    const x = this.spawnTileX, y = this.spawnTileY;
    const solid2 = (tx: number, ty: number): boolean => {
      if (!st.inBounds(tx, ty)) return false;
      const i = st.idx(tx, ty);
      if (!st.flags[i]) return false;                    // active()
      if (st.wire[i] & TileStore.WIRE_ACTUATED) return false;   // inActive()（致动位）
      if (st.half[i]) return false;                      // halfBrick()
      if (st.slope[i] !== 0) return false;               // slope()==0
      return !!TILE_DEFS[st.type[i]]?.solid;             // Main.tileSolid
    };
    if (!solid2(x, y) || !solid2(x + 1, y)) return false;
    for (let dy = 1; dy <= 3; dy++) {
      if (st.inBounds(x, y - dy) && st.flags[st.idx(x, y - dy)]) return false;
      if (st.inBounds(x + 1, y - dy) && st.flags[st.idx(x + 1, y - dy)]) return false;
    }
    return true;
  }

  private isDungeonTile(t: number): boolean {
    return t === T.DUNGEON_BLUE || t === T.DUNGEON_GREEN || t === T.DUNGEON_PINK;
  }

  /** SceneMetrics.ScanTiles 近似：玩家中心 169×123 窗口(zoneScanSize=1920/16+49 × 1200/16+49)
   *  一次扫描同时产出全部六族计数，setFlagsForChosenTile 与 getSpawnRate 共用。
   *  原版 SceneMetrics 每帧增量维护；本类无帧钩子 → 0.5s 或玩家移动 ≥32 格才重算（近似） */
  private zoneStamp = -1;
  private zoneCX = -99999; private zoneCY = -99999;
  private zoneCounts = { evil: 0, blood: 0, holy: 0, snow: 0, jungle: 0, mushroom: 0, meteor: 0, graveyard: 0 };

  private refreshZoneCounts(cx: number, cy: number): void {
    const now = performance.now();
    if (this.zoneStamp >= 0 && now - this.zoneStamp < 500
      && Math.abs(cx - this.zoneCX) < 32 && Math.abs(cy - this.zoneCY) < 32) return;
    this.zoneStamp = now; this.zoneCX = cx; this.zoneCY = cy;
    const st = this.world.store;
    const x0 = Math.max(2, cx - 84), x1 = Math.min(st.w - 3, cx + 84);
    const y0 = Math.max(2, cy - 61), y1 = Math.min(st.h - 3, cy + 61);
    let evil = 0, blood = 0, holy = 0, snow = 0, jungle = 0, mushroom = 0, sunflower = 0, meteor = 0, tomb = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * st.w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        if (!st.flags[i]) continue;   // 仅活跃格（SceneMetrics.ScanTiles 同语义）
        const t = st.type[i];
        if (EVIL_LOOKUP[t]) evil++;
        else if (BLOOD_LOOKUP[t]) blood++;
        else if (HOLY_LOOKUP[t]) holy++;
        else if (SNOW_LOOKUP[t]) snow++;
        else if (JUNGLE_LOOKUP[t]) jungle++;
        else if (MUSHROOM_LOOKUP[t]) mushroom++;
        else if (t === T.METEORITE) meteor++;
        else if (t === T.TOMBSTONE) tomb++;
        else if (t === T.SUNFLOWER) sunflower++;
      }
    }
    // SceneMetrics.cs:588-592/608-615：向日葵每株 −10 计入恶/血两族。
    //  num = −10，infectedSeed 种子（10xx 醉酒世界）时 num ×3 → 每株 −30——
    //  本仓无种子系统（恒非 infectedSeed）→ 恒 ×1
    evil += sunflower * -10; blood += sunflower * -10;
    // SceneMetrics.cs:648-662：神圣/邪恶/猩红两两互减后钳 ≥0
    const holyRaw = holy;
    holy -= evil; holy -= blood;
    evil -= holyRaw; blood -= holyRaw;
    this.zoneCounts = {
      evil: Math.max(0, evil), blood: Math.max(0, blood), holy: Math.max(0, holy),
      snow, jungle, mushroom, meteor,
      // GraveyardTileCount（SceneMetrics.cs:622-623/632-634）：85 计数 − 向日葵/2，钳 ≥0
      graveyard: Math.max(0, tomb - (sunflower >> 1)),
    };
  }

  // ---- FindSpawnTile（L879-920）----
  /** GetSpawnRate（L383-668，单机非 remix 分支）：
   *  defaultSpawnRate=600 / defaultMaxSpawns=5（L6108/6110）。
   *  深度带/昼夜/附近怪分层/水蜡烛修正 + clamp（L655-662）。
   *  血月/日食/南瓜月（月事件覆盖见函数首分支）/和平蜡烛/向日葵/calmed 均已实现（:581-642）；
   *  隐身（buff 10，药水 297）×1.2/×0.8 已接（:611-615）；渔夫套 ×1.3/×0.7 已接（:627-630）。
   *  仙女 isNearFairy 倍率已接（:745-749，×1.2/×0.8——本文件下方 isNearFairy 注入位，
   *  2026-09-03 清偿;旧"未实现"登记过期删除）。clamp（:750-757）先于 getGoodWorld
   *  （:758-761）——次序颠倒曾使 FTW 终值被 clamp 回夹（rate 60/max 15,原版可 48/18）。
   *  UnderworldLayer = maxTilesY-200(Main.cs:2863 属性表达式,精确非近似) */
  getSpawnRate(playerYpx: number, nearbySlots: number, waterCandle: boolean, sHeightPx: number,
    playerXpx = this.pX * TILE, peaceCandle = false, sunflower = false, calmed = false, battle = false,
    townNPCs = 0, dayTime = true, zoneEvil = false, bloodMoon = false,
    shadowCandle = false,
    invis = false, anglerSet = false): { spawnRate: number; maxSpawns: number } {
    // ZoneWaterCandle 先落字段（SetSpawnFlags L308 语义）：同一值既改刷怪率（:637/:650）
    // 也供 SpawnAnNPC 的 399/87/86 水蜡烛加重支——Game 每帧先 getSpawnRate 后 spawn
    this.zoneWaterCandle = waterCandle;
    this.shadowCandle = shadowCandle;
    // 月事件覆盖（L772-778，★IIIII228 原位化+remix 臂）：南瓜月/霜月且
    // （remix || 玩家在地表 Y<worldSurface*16）→ rate=20、max=⌊5×(2+0.3n)⌋（单人 11）。
    // ★原版该覆盖在 clamp/getGood/旅程滑杆【之后】、地牢 rate=10 与 skyblock ÷2
    // 【之前】赋值（非 return）——地牢/空岛低格世界的月事件同样吃后续臂
    // （rate 10）。旧实现提前 return=地牢月事件漏 rate 10 且 spawnFriendlyCycle
    // 停留上帧残值（月事件夜 spawnFriendly 门恒 false,原版照算）——本批按原文
    // 语句序原位化（覆盖见下方"月事件覆盖"块）；invaders 早退保持（原版 invaders
    // 覆盖在月事件覆盖之后,两者赋值同值,早退等价;DD2 复位臂并存月事件场景未见）。
    // 入侵覆盖（L783-786）：rate=20（每帧 1/20 尝试），上限 5*(2+0.3n)（单人 11）。
    // 星璇塔 Zone 同走 invaders 语义（SetSpawnFlags :315-318 任一塔 Zone → invaders=true）
    if (this.invaders || this.lunar) {
      return { spawnRate: 20, maxSpawns: Math.floor(5 * (2 + 0.3 * 1)) };
    }
    let spawnRate = 600;
    let maxSpawns = 5;
    const w = this.world;
    // L389-392：困难模式 spawnRate×0.9 / maxSpawns+1——最先施加，后续修正全部叠在其上。
    // 直接读 world.flags（this.hardMode 要等 spawn() 才刷新，首帧会漏乘）
    if (w.flags.hardMode) {
      spawnRate = Math.floor(spawnRate * 0.9);
      maxSpawns += 1;
    }
    const underworldY = (w.store.h - 200) * 16;
    if (playerYpx > underworldY) {
      // L393-396：地狱 maxSpawns×2。（L668-673 肉山战 ×3/×0.3 压制不移植：
      // 我方 trySpawnEnemy 在 Boss 在场时整体 return,压制强度已覆盖）
      maxSpawns = Math.floor(maxSpawns * 2);
    } else if (playerYpx > w.rockLevel * 16 + sHeightPx) {
      // L489-508（★IIIII228 remix 臂）：深岩层——remix hard?×0.45/×1.8:×0.5/×1.7、
      // 经典恒 ×0.4/×1.9（原版经典支无 hardMode 分支）
      if (w.seedFlags?.remix) {
        if (w.flags.hardMode) {
          spawnRate = Math.floor(spawnRate * 0.45);
          maxSpawns = Math.floor(maxSpawns * 1.8);
        } else {
          spawnRate = Math.floor(spawnRate * 0.5);
          maxSpawns = Math.floor(maxSpawns * 1.7);
        }
      } else {
        spawnRate = Math.floor(spawnRate * 0.4);
        maxSpawns = Math.floor(maxSpawns * 1.9);
      }
    } else if (playerYpx > w.groundLevel * 16 + sHeightPx) {
      // L510-525（★IIIII228）：地下层——remix ×0.4/×1.9；经典 hard?×0.45/×1.8:
      // ×0.5/×1.7（旧实现把经典 hardMode 支漏成恒 0.5/1.7,一并按原文修正）
      if (w.seedFlags?.remix) {
        spawnRate = Math.floor(spawnRate * 0.4);
        maxSpawns = Math.floor(maxSpawns * 1.9);
      } else if (w.flags.hardMode) {
        spawnRate = Math.floor(spawnRate * 0.45);
        maxSpawns = Math.floor(maxSpawns * 1.8);
      } else {
        spawnRate = Math.floor(spawnRate * 0.5);
        maxSpawns = Math.floor(maxSpawns * 1.7);
      }
    } else if (w.seedFlags?.remix) {
      // L526-535（★IIIII228）：remix 地表带吞掉经典夜支——只有 ×0.6/×1.3,
      // 血月/月事件移到 :554 独立后置块（含深岩层 ×0.6 软化）；日食白天同样
      // 由后置块承载（链在此截断）
      if (!w.clock.isDay) {
        spawnRate = Math.floor(spawnRate * 0.6);
        maxSpawns = Math.floor(maxSpawns * 1.3);
      }
    } else if (!w.clock.isDay) {
      // L455-459：夜晚 spawnRate×0.6 / max×1.3；血月再 ×0.3/×1.8（L447-450）
      // （昼/夜直接读 clock，同 hardMode——this.dayTime 要等 spawn() 才刷新，首帧会漏判）
      spawnRate = Math.floor(spawnRate * 0.6);
      maxSpawns = Math.floor(maxSpawns * 1.3);
      if (w.clock.bloodMoon) {
        spawnRate = Math.floor(spawnRate * 0.3);
        maxSpawns = Math.floor(maxSpawns * 1.8);
      }
    } else if (w.clock.isDay && w.clock.eclipse) {
      // L458-461：日食白天 spawnRate×0.2 / max×1.9（血月同层级的 else-if 支）
      spawnRate = Math.floor(spawnRate * 0.2);
      maxSpawns = Math.floor(maxSpawns * 1.9);
    }
    // ★IIIII228 :554-576 remix 后置块（独立 if——remix 的血月/月事件/日食夜带修正：
    //  夜+血月 ×0.3/×1.8 且深岩层带 rate 再 ×0.6 软化；夜+月事件 ×0.2、max×2 且
    //  深岩层带同软化（原版无经典支的 Y<worldSurface 门）；昼+日食 ×0.2/×1.9）
    if (w.seedFlags?.remix) {
      if (!w.clock.isDay) {
        if (w.clock.bloodMoon) {
          spawnRate = Math.floor(spawnRate * 0.3);
          maxSpawns = Math.floor(maxSpawns * 1.8);
          if (playerYpx > w.rockLevel * 16 + sHeightPx) spawnRate = Math.floor(spawnRate * 0.6);
        }
        if (this.moonEvent) {
          spawnRate = Math.floor(spawnRate * 0.2);
          maxSpawns *= 2;
          if (playerYpx > w.rockLevel * 16 + sHeightPx) spawnRate = Math.floor(spawnRate * 0.6);
        }
      } else if (w.clock.isDay && w.clock.eclipse) {
        spawnRate = Math.floor(spawnRate * 0.2);
        maxSpawns = Math.floor(maxSpawns * 1.9);
      }
    }
    // Zone 判定现取（原版每次从玩家 SceneMetrics 取，非上次生成残留 flag）：
    // 玩家中心窗口计数（0.5s 缓存近似，见 refreshZoneCounts），本函数每帧被调
    this.refreshZoneCounts(Math.floor(playerXpx / TILE), Math.floor(playerYpx / TILE));
    const zoneCorrupt = this.zoneCounts.evil >= 300;
    const zoneCrimson = this.zoneCounts.blood >= 300;
    const zoneSnow = this.zoneCounts.snow >= 1500;
    // 雨天雪原（L493-496，深度修正之后、地牢倍率之前）：ZoneSnow 且玩家在地表 →
    // max×(1+cloudAlpha) / rate×(1-cloudAlpha+1)/2（cloudAlpha=0 时为恒等变换）
    if (zoneSnow && playerYpx / TILE < w.groundLevel) {
      maxSpawns = Math.floor(maxSpawns * (1 + this.rainCloudAlpha));
      spawnRate = Math.floor(spawnRate * (1 - this.rainCloudAlpha + 1) / 2);
    }
    // IIII225：drunk 世界蜂巢墙修正（NPC.cs:588-592，1457 行号；L499-503）——
    // `Main.drunkWorld && Main.tile[pX,pY].wall == 86`（86=HiveUnsafe,WallID.cs:241,
    // drunk 生成期两邪恶域埋的蜂巢墙）→ spawnRate×0.3 / maxSpawns×1.8。序位=雪原云量
    // 臂之后、地牢 else-if 链之前（独立 if 不参与互斥）。pX/pY=玩家所站格。
    if (w.seedFlags?.drunkWorld) {
      const stRate = this.world.store;
      if (stRate.wall[stRate.idx(this.pX, this.pY)] === 86) {
        spawnRate = Math.floor(spawnRate * 0.3);
        maxSpawns = Math.floor(maxSpawns * 1.8);
      }
    }
    // 地牢→沙尘暴→地下沙漠→丛林→恶地→陨石 else-if 链（NPC.cs:504-544 1:1——
    // 互斥链，命中前支后支不再叠加；此前只移植了地牢一支）：
    //  地牢 ×0.3/×1.8（L504-505）——必须发生在 clamp（L661-664）之前，否则可产出
    //  max>15（旧实现放 clamp 后漏判）。
    //  沙尘暴（L507-511）hard?×0.4:×0.9 / hard?×1.5:×1.2。
    //  地下沙漠（L512-515）×0.2/×3（player.ZoneUndergroundDesert = SceneMetrics.cs:694，
    //  取 Game 每帧写入的 world.scene；测试直调无 scene 时按 false 处理）。
    //  丛林城镇阶梯（L516-538）townNPCs 0/1/2/≥3 → ×0.4/0.55/0.7/0.85 与
    //  ×1.5/1.4/1.3/1.2（城镇越大丛林越温和——镇住丛林刷怪的原版机制）。
    //  腐化/猩红（L539-542）×0.65/×1.3。陨石（L543-544）×0.4/×1.1
    const zoneJungle = this.zoneCounts.jungle >= 140;   // 与 setFlagsForChosenTile 同源计数
    const zoneMeteor = this.zoneCounts.meteor >= 75;
    const zoneUndergroundDesert = !!this.world.scene?.zoneUndergroundDesert;
    if (this.ZoneDungeon) {
      spawnRate = Math.floor(spawnRate * 0.3);
      maxSpawns = Math.floor(maxSpawns * 1.8);
    } else if (this.zoneSandstorm) {
      spawnRate = Math.floor(spawnRate * (w.flags.hardMode ? 0.4 : 0.9));
      maxSpawns = Math.floor(maxSpawns * (w.flags.hardMode ? 1.5 : 1.2));
    } else if (zoneUndergroundDesert) {
      spawnRate = Math.floor(spawnRate * 0.2);
      maxSpawns = Math.floor(maxSpawns * 3);
    } else if (zoneJungle) {
      // 影子蜡烛覆写（NPC.cs:420-425 三连写 noWorms/noGroundWorms=false + townNPCs=0；
      // noGroundWorms 已建模——AFK 链 Game 注入,终零波接入）
      if (shadowCandle) { townNPCs = 0; this.noWorms = false; this.noGroundWorms = false; }
      else if (townNPCs === 0) {
        spawnRate = Math.floor(spawnRate * 0.4);
        maxSpawns = Math.floor(maxSpawns * 1.5);
      } else if (townNPCs === 1) {
        spawnRate = Math.floor(spawnRate * 0.55);
        maxSpawns = Math.floor(maxSpawns * 1.4);
      } else if (townNPCs === 2) {
        spawnRate = Math.floor(spawnRate * 0.7);
        maxSpawns = Math.floor(maxSpawns * 1.3);
      } else {
        spawnRate = Math.floor(spawnRate * 0.85);
        maxSpawns = Math.floor(maxSpawns * 1.2);
      }
    } else if (zoneCorrupt || zoneCrimson) {
      spawnRate = Math.floor(spawnRate * 0.65);
      maxSpawns = Math.floor(maxSpawns * 1.3);
    } else if (zoneMeteor) {
      spawnRate = Math.floor(spawnRate * 0.4);
      maxSpawns = Math.floor(maxSpawns * 1.1);
    }
    // 神庙（L545-551 独立 if，不参与 else-if 互斥）：×0.8/×1.2（★IIIII228 :645-649
    //  remix 臂再 ×0.4/×1.5）。ZoneLihzhardTemple = 玩家所站格墙 87（SceneMetrics.cs:688）
    if (this.zoneLihzardTemple(Math.floor(playerXpx / TILE), Math.floor(playerYpx / TILE))) {
      spawnRate = Math.floor(spawnRate * 0.8);
      maxSpawns = Math.floor(maxSpawns * 1.2);
      if (w.seedFlags?.remix) {
        spawnRate = Math.floor(spawnRate * 0.4);
        maxSpawns = Math.floor(maxSpawns * 1.5);
      }
    }
    // ★IIIII228 :651-655 remix 恶地地表臂：remix && (腐化||猩红) && 玩家 Y/16<worldSurface
    //  → rate×0.5、max×2（独立 if,先于神圣深层臂）
    if (w.seedFlags?.remix && (zoneCorrupt || zoneCrimson) && playerYpx / TILE < w.groundLevel) {
      spawnRate = Math.floor(spawnRate * 0.5);
      maxSpawns *= 2;
    }
    // 神圣深层（L556-559 独立 if）：ZoneHallow && 玩家深于 rockLayer×16+sHeight → ×0.65/×1.3
    if (this.zoneCounts.holy >= 125 && playerYpx > w.rockLevel * 16 + sHeightPx) {
      spawnRate = Math.floor(spawnRate * 0.65);
      maxSpawns = Math.floor(maxSpawns * 1.3);
    }
    // L583-591（无条件）：附近怪 <20%/40%/60%/80% 上限时 ×0.6/×0.7/×0.8/×0.9
    if (nearbySlots < maxSpawns * 0.2) spawnRate = Math.floor(spawnRate * 0.6);
    else if (nearbySlots < maxSpawns * 0.4) spawnRate = Math.floor(spawnRate * 0.7);
    else if (nearbySlots < maxSpawns * 0.6) spawnRate = Math.floor(spawnRate * 0.8);
    else if (nearbySlots < maxSpawns * 0.8) spawnRate = Math.floor(spawnRate * 0.9);
    // L592-604：地下中点以下/腐化/猩红再叠加（Zone 用上面现取值）
    if (playerYpx / TILE > (w.groundLevel + w.rockLevel) / 2 || zoneCorrupt || zoneCrimson) {
      if (nearbySlots < maxSpawns * 0.2) spawnRate = Math.floor(spawnRate * 0.7);
      else if (nearbySlots < maxSpawns * 0.4) spawnRate = Math.floor(spawnRate * 0.9);
    }
    // ★IIIII228 :698-702 remix 恶地地表后置臂（近镇修正块之后、隐身药水之前）：
    //  remix && Y/16<worldSurface && (腐化||猩红) → rate×0.8、max×2
    if (w.seedFlags?.remix && playerYpx / TILE < w.groundLevel && (zoneCorrupt || zoneCrimson)) {
      spawnRate = Math.floor(spawnRate * 0.8);
      maxSpawns *= 2;
    }
    // L611-615：隐身药水（buff 10）×1.2 / ×0.8
    if (invis) {
      spawnRate = Math.floor(spawnRate * 1.2);
      maxSpawns = Math.floor(maxSpawns * 0.8);
    }
    // L617-620：镇静药水（calmed）×1.65 / ×0.6
    if (calmed) {
      spawnRate = Math.floor(spawnRate * 1.65);
      maxSpawns = Math.floor(maxSpawns * 0.6);
    }
    // L624-628：向日葵（buff 146 标志）×1.2 / ×0.8
    if (sunflower) {
      spawnRate = Math.floor(spawnRate * 1.2);
      maxSpawns = Math.floor(maxSpawns * 0.8);
    }
    // L627-630：渔夫套装（anglerSetSpawnReduction）×1.3 / ×0.7
    if (anglerSet) {
      spawnRate = Math.floor(spawnRate * 1.3);
      maxSpawns = Math.floor(maxSpawns * 0.7);
    }
    // L632-635：战斗药水（enemySpawns）×0.5 / ×2
    if (battle) {
      spawnRate = Math.floor(spawnRate * 0.5);
      maxSpawns = Math.floor(maxSpawns * 2);
    }
    // L640-646：水蜡烛 spawnRate×0.75 / max×1.5；天空层再 ×0.5
    if (waterCandle) {
      spawnRate = Math.floor(spawnRate * 0.75);
      maxSpawns = Math.floor(maxSpawns * 1.5);
      if (playerYpx / TILE < w.groundLevel * 0.35) spawnRate = Math.floor(spawnRate * 0.5);
    } else if (peaceCandle) {
      // L645-648：和平蜡烛 ×1.3 / ×0.7（与水蜡烛互斥——原版 else if）
      spawnRate = Math.floor(spawnRate * 1.3);
      maxSpawns = Math.floor(maxSpawns * 0.7);
    }
    // L745-749（水蜡烛段之后、clamp 之前）：player.isNearFairy() ×1.2 / ×0.8——任一
    //  active 仙女（583/584/585，【无】ai[2] 条件）距玩家 Center < NPC.sWidth（=1920
    //  常量，Player.cs:54494-54506 + NPC.cs:6791）。距离窗判定在 Game 侧每周期喂入
    //  isNearFairy（与 AnyHelpfulFairies 的跟随态门是两个不同谓词，勿合并）
    if (this.isNearFairy) {
      spawnRate = Math.floor(spawnRate * 1.2);
      maxSpawns = Math.floor(maxSpawns * 0.8);
    }
    // L750-757：clamp 先行——下限 spawnRate≥defaultSpawnRate×0.1（=600×0.1=60）、
    //  上限 maxSpawns≤defaultMaxSpawns×3（=5×3=15）
    if (spawnRate < 60) spawnRate = 60;
    if (maxSpawns > 15) maxSpawns = 15;
    // L758-761：getGoodWorld（FTW 种子）rate×0.8 / max×1.2——在 clamp【之后】
    //  （原版 :750 clamp → :758 getGood 次序;曾乘臂在前被 clamp 回夹成 60/15,
    //  FTW 终值可越出 clamp 档:rate 60→48、max 15→18）
    if (w.seedFlags?.getGoodWorld) {
      spawnRate = Math.floor(spawnRate * 0.8);
      maxSpawns = Math.floor(maxSpawns * 1.2);
    }
    // L671-678（clamp 与 getGood 之后、地牢 rate=10 之前）：旅程刷怪率滑杆——
    // SpawnRateSliderPerPlayerPower.GetRemappedSliderValueFor（CreativePowers.cs:1612-1619
    // 0.1×~10×）。value<1 → spawnRate 变大（更慢出怪）/ maxSpawns 变小；>1 反之。
    // (int) 截断；maxSpawns 可越过 15 上限（原版同——clamp 在滑杆之前不回夹）
    if (w.isJourney) {
      const value = spawnRateMultiplier(w.journeyPowers.spawnRateSlider);
      spawnRate = Math.trunc(spawnRate / value);
      maxSpawns = Math.trunc(maxSpawns * value);
    }
    // 月事件覆盖（★IIIII228 :772-778 原位化,见函数头注）：(remix || 玩家在地表
    //  Y<worldSurface*16) && 月事件 → rate=20、max=⌊5×(2+0.3n)⌋。赋值非 return——
    //  地牢 rate=10 / skyblock ÷2 臂在其后仍生效（原版语句序）
    if (this.moonEvent && (w.seedFlags?.remix || playerYpx < this.world.groundLevel * 16)) {
      spawnRate = 20;
      maxSpawns = Math.floor(5 * (2 + 0.3 * 1));
    }
    // ★BJ356 DD2 复位臂（NPC.cs:777-780）：事件进行中且扫描玩家在旧军 Zone →
    //  rate/max 复位缺省 600/5（defaultSpawnRate/defaultMaxSpawns L6108/6110）——
    //  覆盖月事件等先前修正;原版 invaders 覆盖在其后（本仓 invaders 早退于函数头,
    //  终值等价）;地牢 rate=10 / skyblock ÷2 在本臂之后仍生效（原序）。
    //  ★曾整臂缺席=事件期竞技场周边刷怪率被血月等修正放大
    if (this.dd2Ongoing && this.zoneDD2) {
      spawnRate = 600;
      maxSpawns = 5;
    }
    // L787-790：未杀骷髅王 rate=10（旅程滑杆之后、skyblock 整除之前——
    //  地牢守卫(68) 快速轮换主守卫；杀过骷髅王保持常规地牢修正 ×0.3/×1.8）。
    //  ★并行会话曾在本轮把该 arm 意外挤丢（只剩注释），dg.spawnRate 由 10 漂成
    //  常规链终值——测试门 dungeon-spawn/progression 已锁回
    if (this.ZoneDungeon && !this.downedBoss3) {
      spawnRate = 10;
    }
    // L791-794：WorldGen.Skyblock.lowTiles 空岛低格世界 spawnRate ÷2
    //  ——原版紧跟地牢 arm 之后顺序执行（地牢 rate=10 同样被整除为 5）
    if (this.world.skyblockLowTiles) {
      spawnRate = Math.floor(spawnRate / 2);
    }
    // ---- spawnFriendly 掷骰（NPC.cs:711-832;原版在 SetSpawnFlags 与 rate 同例程内）----
    // 外层门 :709 1:1：!invaders && ((!血月 && !南瓜月 && !霜月) || 白天) && 非日食白天
    //  && !腐化 && !猩红 && !陨石 && !旧军（旧军系统缺席恒 false;infectedSeed 变体省略;
    //  ZoneMeteor 与上面速率链同源的 zoneCounts 现取）。★此前漏 南瓜/霜月/日食/陨石 四门
    //  （事件/日食期小动物轮照跑）。
    // ★此前未移植:小动物链（SpawnAnNPC :2006 `else if (spawnFriendly)`）恒放行 →
    //  无城镇 NPC 也会满地兔鼠(甚至刷到浮空岛——原版岛边 townNPCs=0 永不出小动物)
    this.spawnFriendlyCycle = false;
    this.townNoWorms = false;
    // ★BJ356 补 !ZoneOldOneArmy 臂（NPC.cs:800 尾项,字面无条件——门 549 活体距离旗,
    //  事件收场 WipeEntities 撤门后自然归 false;旧注"旧军系统缺席恒 false"已废）
    if (!this.invaders && ((!bloodMoon && !this.moonEvent) || dayTime)
      && !(w.clock.eclipse && dayTime) && !zoneEvil && !(this.zoneCounts.meteor >= 75)
      && !this.zoneDD2) {
      const deep = playerYpx / TILE > w.h - 200;   // :711 player.Center.Y/16 > UnderworldLayer
      if (deep) {
        // 地狱侧(:713-763)：友好概率低；命中时 maxSpawns×0.5（:724/:741/:757——
        // 削减只在 friendly 命中分支内，未命中只放宽 spawnRate）。
        // 城镇 noWorms 掷骰（:717/:734/:750）在友好掷骰**之前**（原版同序）
        if (townNPCs === 1) {
          // ★IIIII61 WorldGen.Skyblock.lowTiles（NPC.cs:806-821）：空岛低格世界
          //   地狱侧城镇=1 的两掷（noWorms/friendly）整体跳过——零掷流、零速率修正
          if (!this.world.skyblockLowTiles) {
            if (this.rateRng() < 1 / 2) this.townNoWorms = true;              // :717-720
            if (this.rateRng() < 1 / 10) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.5); } // :722-727
            else spawnRate = Math.floor(spawnRate * 1.25);
          }
        } else if (townNPCs === 2) {
          if (this.rateRng() >= 1 / 4) this.townNoWorms = true;             // :734-737 Next(4)!=0
          if (this.rateRng() < 1 / 5) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.5); } // :736-743
          else spawnRate = Math.floor(spawnRate * 1.5);
        } else if (townNPCs >= 3) {
          if (this.rateRng() >= 1 / 10) this.townNoWorms = true;            // :750-753 Next(10)!=0
          if (this.rateRng() < 1 / 3) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.5); } // :753-759
          else spawnRate = Math.floor(spawnRate * 2);
        }
      } else {
        // 地表/洞穴侧(:765-832)：高友好率；命中时 maxSpawns×0.6（:782/:805/:821）；
        // townNPCs==0 → 永不友好(不出小动物)。
        // 城镇 noWorms 无条件置位（:767/:792/:814——地表侧城镇 ≥1 恒不出蠕虫）
        // 墓地段（:770-778/:793-800/:815-822）：ZoneGraveyard && (!ZonePeaceCandle || 1/3)
        //  → spawnRate 放宽（×1.66/×2.33/×3）且友好掷骰概率骤降（1/9 / 1/6 / 1/3）——
        //  墓地有城镇 NPC 也会高密度刷怪（墓地小动物只有蛆/鼠，:2008-2014）。
        //  gy 旗掷骰 RNG 消费序（:772 原文 Next(3)==0）：和平蜡烛在场时 || 短路不掷
        //  （恒走非墓地支），不在场才消费一掷；else-if 链每次调用只进一段，gy 每
        //  次 getSpawnRate 至多一掷
        const gy = this.ZoneGraveyard && (!peaceCandle || this.rateRng() < 1 / 3);
        if (townNPCs === 1) {
          this.townNoWorms = true;                                          // :767
          if (gy) {
            spawnRate = Math.floor(spawnRate * 1.66);                       // :771
            if (this.rateRng() < 1 / 9) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.6); } // :773-775
          } else if (this.rateRng() < 1 / 3) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.6); } // :779-783
          else spawnRate = Math.floor(spawnRate * 2);
        } else if (townNPCs === 2) {
          this.townNoWorms = true;                                          // :792
          if (gy) {
            spawnRate = Math.floor(spawnRate * 2.33);                       // :794
            if (this.rateRng() < 1 / 6) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.6); } // :796-798
          } else if (this.rateRng() < 2 / 3) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.6); } // :802-806
          else spawnRate = Math.floor(spawnRate * 3);
        } else if (townNPCs >= 3) {
          this.townNoWorms = true;                                          // :814
          if (gy) {
            spawnRate = Math.floor(spawnRate * 3);                          // :816
            if (this.rateRng() < 1 / 3) { this.friendlyHit(); maxSpawns = Math.floor(maxSpawns * 0.6); } // :818-820
          } else {
            this.friendlyHit();   // :826-828 非 ftw 恒友好(专家 1/30 例外未实装)
            maxSpawns = Math.floor(maxSpawns * 0.6); // :830 无条件削减（专家例外轮也削）
          }
        }
      }
    }
    // L834-838（友好块之后、return 之前）：非友好轮 && RollOnlyBadLuckExtreme(50)==0
    //  → spawnRate×0.85 / maxSpawns×1.15（"厄运轮"怪更密）。走 Luck.RollOnlyBadLuckExtreme
    //  （Luck.ts,luck 0 中性时即 Next(50)==0;正运无加成、负运收窄——与原版同式）
    if (!this.spawnFriendlyCycle && rollOnlyBadLuckExtreme(this.playerLuck, 50, () => this.rateRng()) === 0) {
      spawnRate = Math.floor(spawnRate * 0.85);
      maxSpawns = Math.floor(maxSpawns * 1.15);
    }
    return { spawnRate, maxSpawns };
  }
  /** friendly 命中（:723/:740/:756/:804/:828）：只置 spawnFriendlyCycle；
   *  maxSpawns 削减（地狱 ×0.5 / 地表 ×0.6，且 town≥3 地表无条件）在分支就地执行 */
  private friendlyHit(): void {
    this.spawnFriendlyCycle = true;
  }
  private rateRng(): number {
    return Math.random();
  }

  /** 狙击镜扩圈系数（0=关；1.25/1.5/2.0——Game 每帧求值写入） */
  scopeNum3 = 0;

  /** FindSpawnTile（L879-927）+ GetSpawnArea（L841-877）1:1：
   *  spawnArea = 玩家 ±(0.7×全屏格)（均匀取点，不是环带外扩！），
   *  safeArea = 玩家 ±(0.52×全屏格)——生成点必须落在画面外（!safeArea.Contains）。
   *  viewHalfW/H = 半屏格数 → 0.7×全屏 = ×1.4 半屏；0.52×全屏 = ×1.04 半屏 */
  private findSpawnTile(rng: RNG, viewHalfW: number, viewHalfH: number): boolean {
    const st = this.world.store;
    const px = this.pX, py = this.pY;
    // 狙击镜扩圈（GetSpawnArea :846-862）：手持 1254 狙击枪/1299 步枪镜 或装备 scope
    //  → 生成区与 safe 区各加 viewHalf/num3（num3=1.25 双持/1.5 单件/2.0 纯装备）
    const sc = this.scopeNum3 > 0 ? Math.floor(viewHalfW / this.scopeNum3) : 0;
    const scY = this.scopeNum3 > 0 ? Math.floor(viewHalfH / this.scopeNum3) : 0;
    const rangeX = Math.max(1, Math.floor(viewHalfW * 1.4)) + sc;
    const rangeY = Math.max(1, Math.floor(viewHalfH * 1.4)) + scY;
    let safeX = Math.max(1, Math.floor(viewHalfW * 1.04)) + sc;
    let safeY = Math.max(1, Math.floor(viewHalfH * 1.04)) + scY;
    // ★IIIII22b：双地牢 safeArea 半化（NPC.cs:964-966 GetSpawnArea 尾支）——
    // dualDungeonsSeed && 玩家不在地表高度带（!ZoneOverworldHeight && !ZoneSkyHeight
    // ≡ tileY > worldSurface）时 safe 区矩形尺寸从 ×2 改为原值（NPC.cs:966），即半宽÷2 →
    // 敌怪允许刷得更近。vanilla 在狙击镜扩圈之后替换矩形。
    if (this.world.seedFlags?.dualDungeons && py > this.world.groundLevel) {
      safeX = Math.max(1, Math.floor(safeX / 2));
      safeY = Math.max(1, Math.floor(safeY / 2));
    }
    // WorldUtils.ClampToWorld
    const areaL = Math.max(2, px - rangeX), areaR = Math.min(st.w - 3, px + rangeX);
    const areaT = Math.max(2, py - rangeY), areaB = Math.min(st.h - 3, py + rangeY);
    for (let attempt = 0; attempt < 50; attempt++) {
      const tx = rng.int(areaL, areaR);
      let ty = rng.int(areaT, areaB);
      // L886-888：点在实心格 或 (非 ignoreSafeWalls 且带房屋墙) → 重试
      //  （房屋内不刷怪的主守卫;ignoreSafeWalls :315-319 仅星璇四塔 Zone 置位——
      //   塔战期间允许穿房屋墙刷怪,普通入侵不置位）
      //  ★SW-BJ37：tileSolid 静态表语义（含平台九件套）= spawnTileSolid,裸 isSolid
      //  漏九件（原版平台格 tileSolid[19]=true 拒作候选起点）
      if (spawnTileSolid(st, tx, ty)) continue;
      if (!this.ignoreSafeWalls && WALL_HOUSE.has(st.wall[st.idx(tx, ty)])) continue;
      this.skyMob = false;
      // L890-897：天空怪选点门——!invaders && y<worldSurface×0.35 && !spawnFriendly &&
      //  (x<0.45w || x>0.55w || hardMode)；L898-903 第二支：!invaders && y<worldSurface×0.45
      //  && !spawnFriendly && hardMode && 1/10（困难模式加宽的第二天空层，此前缺失）。
      //  原版"两侧 45% 带外"隐含不变量 = 浮空岛只在两侧、中央带无高空地面；此处沿用
      //  本仓既定的"落脚面上方两格无墙"露天判据（兼容含中央浮空岛的存量世界，否则
      //  中央岛会被当地表刷僵尸/水母），并补齐 !invaders/!spawnFriendly/困难第二带三门
      const openAir = st.wall[st.idx(tx, ty - 1)] === 0 && st.wall[st.idx(tx, ty - 2)] === 0;
      if (!this.invaders && !this.spawnFriendlyCycle && ty < this.world.groundLevel * 0.35 && openAir
        && (tx < st.w * 0.45 || tx > st.w * 0.55 || this.world.flags.hardMode)) {
        this.skyMob = true;
      } else if (!this.invaders && !this.spawnFriendlyCycle && openAir
        && ty < this.world.groundLevel * 0.45 && this.world.flags.hardMode && rng.next() < 0.1) {
        this.skyMob = true;
      } else {
        // L900-906：向下找第一个实心格 = 落脚面（扫描上限 = spawnArea.Bottom，非世界底）
        //  ★SW-BJ37：`!nactive() || !tileSolid` 语义 = spawnTileSolid——原版平台格
        //  tileSolid[19]=true 会【终止】扫描（怪站平台顶）;裸 isSolid 穿平台 →
        //  落到平台下方地面（平台房地板下出生偏差）
        let j = ty;
        while (j < areaB && !spawnTileSolid(st, tx, j)) j++;
        if (j >= areaB) continue;
        ty = j;
      }
      // L910：safeArea 内（画面内）一律拒绝 + HasTileSpawnSpace 落点空间校验
      if (Math.abs(tx - px) < safeX && Math.abs(ty - py) < safeY) continue;
      if (!this.hasTileSpawnSpace(tx, ty)) continue;
      // L911：xRange = 落脚点在 safeArea 横向范围内（原版传给 SpawnAnNPC 的水生成判定）
      this.xRange = tx >= px - safeX && tx < px + safeX;
      this.spawnTileX = tx; this.spawnTileY = ty;
      return true;
    }
    return false;
  }

  /** HasTileSpawnSpace（NPC.cs:5406-5414）+ CanSpawnInTiles/CanSpawnInTile（:5416-5442）
   *  1:1（SW-BJ37 2026-09-08）：净空窗 = Bottom=(tx*16+8, ty*16) 的默认 32×48 身体空间
   *  = 列 [tx-1,tx] × 行 [ty-3,ty-1]（spawnSpaceX=2/spawnSpaceY=3 静态常量 NPC.cs:146/148,
   *  全树无改写,1458 同值；NewNPC :81594 `Bottom=(X,Y)` 锚定）。逐格 CanSpawnInTile(:5431)：
   *  nactive()&&tileSolid → 拒（tileSolid 静态表含平台九件套 = spawnTileSolid）、
   *  anyLava()（Tile.cs:412 `liquid>0 && lava()`）→ 拒；墙/水/蜂蜜/装饰不查。
   *  世界边界 = WorldGen.InWorld(Rectangle)（WorldGen.cs:9651-9662,fluff=0）逐字：
   *  X<0 || X+W>=w || Y<0 || Y+H>=h 拒（X=tx-1/W=2/Y=ty-3/H=3）。
   *  ★SW-BJ37 旧版两偏差：①isSolid 裸判漏平台九件套（原版 tileSolid[19]=true 等,
   *  Main.cs:8031-8032）→ 可刷进平台格；②右/下边界差 1 格（tx=w-1 原版拒、旧版放）。 */
  private hasTileSpawnSpace(tx: number, ty: number): boolean {
    const st = this.world.store;
    if (tx - 1 < 0 || tx + 1 >= st.w || ty - 3 < 0 || ty >= st.h) return false;
    for (let dx = -1; dx <= 0; dx++) {
      for (let dy = -3; dy <= -1; dy++) {
        const x = tx + dx, y = ty + dy;
        const i = st.idx(x, y);
        if (spawnTileSolid(st, x, y)) return false;
        if (st.liquid[i] > 0 && st.liquidType[i] === LIQUID_TYPE.LAVA) return false;
      }
    }
    return true;
  }

  /** 联机远端玩家位置注入（px，玩家碰撞盒中心）：Game.trySpawnEnemy 每帧赋值一行。
   *  原版 CheckNotSpawningOnScreen（L5344-5366）遍历全部 255 名玩家——与任一活跃玩家
   *  的扩展屏相交即拒，不是只查本地玩家；否则分屏/异地队友眼前会凭空刷怪 */
  static remotePlayers: Array<{ x: number; y: number }> = [];

  /** CheckNotSpawningOnScreen（L5344-5366）像素级双保险：
   *  落脚格 16×16 与"玩家屏幕 ±safeRange"矩形相交 → 拒绝。
   *  注意原版单位混用（L5354）：safeRangeX/Y 是格数但直接当像素偏移加——实际外扩仅 ~2 格 */
  private checkNotSpawningOnScreen(px: number, py: number, viewHalfW: number, viewHalfH: number): boolean {
    this.viewHalfW = viewHalfW; this.viewHalfH = viewHalfH;
    return this.tileClearOfPlayerScreens(this.spawnTileX, this.spawnTileY, px, py);
  }

  /** CheckNotSpawningOnScreen 的格坐标版：tx/ty 的 16×16 盒与任一活跃玩家
   *  "屏幕 ±safeRange"矩形相交 → false（本地 + remotePlayers 全查，:5350-5365） */
  private tileClearOfPlayerScreens(tx: number, ty: number, px: number, py: number): boolean {
    const viewHalfW = this.viewHalfW, viewHalfH = this.viewHalfH;
    const sW = viewHalfW * 2 * TILE, sH = viewHalfH * 2 * TILE;
    const safePxX = viewHalfW * 1.04, safePxY = viewHalfH * 1.04; // 格数直接当像素（原版 L5354 原样）
    const tX = tx * TILE, tY = ty * TILE;
    const clear = (cx: number, cy: number): boolean => {
      const rectX = cx - sW / 2 - safePxX, rectY = cy - sH / 2 - safePxY;
      const rectW = sW + safePxX * 2, rectH = sH + safePxY * 2;
      return !(tX < rectX + rectW && tX + TILE > rectX && tY < rectY + rectH && tY + TILE > rectY);
    };
    if (!clear(px, py)) return false;
    for (const rp of VanillaSpawner.remotePlayers) {
      if (!clear(rp.x, rp.y)) return false;
    }
    return true;
  }

  /** 向上 50 格找“干格 + 下两格非实心”的洞隙线（海洋段 L1711-1718 / L1737-1752、
   *  水池段 L1844-1852 四处共用的扫描体）：命中返回干格 y+2 并按 L1719-1722 /
   *  L1853-1856 钳到 spawnTileY，找不到返回 -1 */
  private findDryGapY(spawnTileY: number): number {
    const st = this.world.store;
    for (let y = spawnTileY - 1; y > spawnTileY - 50 && y >= 0; y--) {
      if (st.liquid[st.idx(this.spawnTileX, y)] === 0
        && !st.isSolid(this.spawnTileX, y) && !st.isSolid(this.spawnTileX, y + 1)
        && !st.isSolid(this.spawnTileX, y + 2)) {
        return Math.min(y + 2, spawnTileY);
      }
    }
    return -1;
  }

  /** SpawnHornet（NPC.cs:5189-5255 1:1）：Next(8) 选族——
   *  case0-4 黄蜂族 231-235（各 1/4 小 -2k/大 -2k+1 变体）；default(case5-7) 蜂刺族 42 */
  private spawnHornet(x: number, y: number, rng: RNG): Enemy | null {
    const v = rng.int(0, 8);
    const table: Array<[number, number, number]> = [
      [-56, -57, 231], [-58, -59, 232], [-60, -61, 233],
      [-62, -63, 234], [-64, -65, 235],
      [-16, -17, 42],
    ];
    const row = table[Math.min(v, 5)];
    if (rng.next() < 0.25) return this.spawnNPC(x, y, row[0], rng);
    if (rng.next() < 0.25) return this.spawnNPC(x, y, row[1], rng);
    return this.spawnNPC(x, y, row[2], rng);
  }

  // ---- 月事件选怪（霜月 NPC.cs:2714-3132 / 南瓜月 :3134-3455，1:1） ----
  /** CountNPCS（场内存活数）：activeIds 只去重，计数走 Game 传入的 counts 表 */
  private moonCount(id: number): number {
    return this.moonEvent?.counts.get(id) ?? 0;
  }

  /** 霜月选怪：返回 netId；0 = 本帧不刷（原版空过，勿加兜底——14 波三 Boss 唯一门
   *  全被占时不刷是原版行为）。任意波先掷 1/30 && CountNPCS(341)<4 → 礼物窃贼 341。 */
  private pickFrostMoonSpawn(wave: number, rng: RNG): number {
    const N = (n: number) => rng.next() < 1 / n;
    const C = (id: number) => this.moonCount(id);
    if (N(30) && C(341) < 4) return 341;
    if (wave >= 20) {
      const num45 = rng.int(0, 2);   // 原版在 bossCap 检查前先掷（RNG 流对齐）
      if (!this.moonBossCap) {
        if (num45 === 0) return 345;   // 冰雪女王
        if (num45 === 1) return 346;   // 圣诞坦克
        return 344;                    // 常世吼
      }
      return 0;
    }
    if (wave >= 19) {
      if (N(10) && C(345) < 4) return 345;
      if (N(10) && C(346) < 5) return 346;
      if (N(10) && C(344) < 7) return 344;
      return 343;                      // 雪怪兜底
    }
    if (wave >= 18) {
      if (N(10) && C(345) < 3) return 345;
      if (N(10) && C(346) < 4) return 346;
      if (N(10) && C(344) < 6) return 344;
      if (N(3)) return 348;            // 胡桃夹子
      if (N(3)) return 351;            // 坎卜斯
      return 343;
    }
    if (wave >= 17) {
      if (N(10) && C(345) < 2) return 345;
      if (N(10) && C(346) < 3) return 346;
      if (N(10) && C(344) < 5) return 344;
      if (N(4)) return 347;            // 玩具直升机
      if (N(2)) return 351;
      return 343;
    }
    if (wave >= 16) {
      if (N(10) && C(345) < 2) return 345;
      if (N(10) && C(346) < 2) return 346;
      if (N(10) && C(344) < 4) return 344;
      if (N(2)) return 352;            // 弗洛科
      return 343;
    }
    if (wave >= 15) {
      if (N(10) && C(345) < 1) return 345;
      if (N(10) && C(346) < 2) return 346;
      if (N(10) && C(344) < 3) return 344;
      if (N(3)) return 347;
      return 343;
    }
    switch (wave) {
      case 14:
        if (N(10) && C(345) < 1) return 345;
        if (N(10) && C(346) < 1) return 346;
        if (N(10) && C(344) < 1) return 344;
        if (N(3)) return 343;
        return 0;   // 原版 case 14 无 else 兜底：全落空即空刷（勿修）
      case 13:
        if (N(10) && C(345) < 1) return 345;
        if (N(10) && C(346) < 1) return 346;
        if (N(3)) return 352;
        if (N(6)) return 343;
        if (N(3)) return 342;
        return 347;
      case 12:
        if (N(10) && C(345) < 1) return 345;
        if (N(10) && C(344) < 1) return 344;
        if (N(8)) return 343;
        if (N(3)) return 342;
        return rng.int(338, 340);       // Main.rand.Next(338,341)
      case 11:
        if (N(10) && C(345) < 1) return 345;
        if (N(6)) return 352;
        if (N(2)) return 342;
        return rng.int(338, 340);
      case 10:
        if (N(10) && C(346) < 1) return 346;
        if (N(10) && C(344) < 2) return 344;
        if (N(6)) return 351;
        if (N(3)) return 348;
        if (N(3)) return 347;
        return rng.int(338, 340);
      case 9:
        if (N(10) && C(346) < 1) return 346;
        if (N(10) && C(344) < 1) return 344;
        if (N(2)) return 348;
        if (N(3)) return 347;
        return 342;
      case 8:
        if (N(10) && C(346) < 1) return 346;
        if (N(8)) return 351;
        if (N(3)) return 348;
        if (N(3)) return 347;
        return 350;                     // 精灵弓手
      case 7:
        if (N(10) && C(346) < 1) return 346;
        if (N(3)) return 342;
        if (N(4)) return 350;
        return rng.int(338, 340);
      case 6:
        if (N(10) && C(344) < 2) return 344;
        if (N(4)) return 347;
        if (N(2)) return 348;
        return 350;
      case 5:
        if (N(10) && C(344) < 1) return 344;
        if (N(4)) return 350;
        if (N(8)) return 348;
        return rng.int(338, 340);
      case 4:
        if (N(10) && C(344) < 1) return 344;
        if (N(4)) return 350;
        if (N(3)) return 342;
        return rng.int(338, 340);
      case 3:
        if (N(8)) return 348;
        if (N(4)) return 350;
        if (N(3)) return 342;
        return rng.int(338, 340);
      case 2:
        if (N(3)) return 350;
        return rng.int(338, 340);
      default:                           // wave 1
        if (N(3)) return 342;            // 姜饼人
        return rng.int(338, 340);        // 精灵僵尸
    }
  }

  /** 南瓜月选怪：返回 netId；0 = 本帧不刷（19 波 bossCap 占满后可能空刷，原版行为勿修）。
   *  注意 wave 15-18 首支是独立 if（原版命中后仍会落入后续 else-if 链再判一次；
   *  单返回值实现取首个命中即返回，语义等价） */
  private pickPumpkinMoonSpawn(wave: number, rng: RNG): number {
    const N = (n: number) => rng.next() < 1 / n;
    const C = (id: number) => this.moonCount(id);
    if (wave >= 20) {
      if (!this.moonBossCap) {
        if (N(2) && C(327) < 2) return 327;                 // 南瓜王
        if (rng.next() >= 1 / 3 && C(325) < 2) return 325;  // Next(3)!=0 → 悲木
        if (C(315) < 3) return 315;                          // 无头骑士
      }
      return 0;
    }
    switch (wave) {
      case 19:
        if (N(5) && C(327) < 2) return 327;
        if (N(5) && C(325) < 2) return 325;
        if (!this.moonBossCap && C(315) < 5) return 315;
        return 0;   // 原版 case 19 无 else：三支全落空即空刷（勿修）
      case 18:
        if (N(7) && C(327) < 2) return 327;
        if (N(7) && C(325) < 2) return 325;
        if (N(7) && C(315) < 3) return 315;
        return 330;                      // 胡闹鬼
      case 17:
        if (N(7) && C(327) < 2) return 327;
        if (N(7) && C(325) < 2) return 325;
        if (N(7) && C(315) < 2) return 315;
        if (N(3)) return 330;
        return 329;                      // 地狱犬
      case 16:
        if (N(10) && C(327) < 2) return 327;
        if (N(10) && C(315) < 2) return 315;
        if (N(6)) return 330;
        if (N(3)) return 329;
        return 326;                      // 树怪
      case 15:
        if (N(10) && C(327) < 1) return 327;
        if (N(7) && C(325) < 2) return 325;
        if (N(5)) return 330;
        if (N(3)) return 326;
        return rng.int(305, 314);        // 稻草人 Next(305,315)
      case 14:
        if (N(10) && C(327) < 1) return 327;
        if (N(7) && C(325) < 2) return 325;
        if (N(10) && C(315) < 1) return 315;
        if (N(10)) return 330;
        if (N(7)) return 329;
        if (N(3)) return 326;
        return rng.int(305, 314);
      case 13:
        if (N(7) && C(325) < 2) return 325;
        if (N(10) && C(315) < 2) return 315;
        if (N(6)) return 330;
        if (N(3)) return 329;
        return 326;
      case 12:
        if (N(5) && C(327) < 1) return 327;
        return 330;
      case 11:
        if (N(7) && C(325) < 2) return 325;
        if (N(3)) return 330;
        return 326;
      case 10:
        if (N(10) && C(327) < 1) return 327;
        if (N(3)) return 329;
        return rng.int(305, 314);
      case 9:
        if (N(10) && C(325) < 2) return 325;
        if (N(8)) return 330;
        if (N(5)) return 329;
        if (N(2)) return 326;
        return rng.int(305, 314);
      case 8:
        if (N(8) && C(315) < 2) return 315;
        if (N(4)) return 330;
        return 329;
      case 7:
        if (N(7) && C(325) < 2) return 325;
        if (N(4)) return 330;
        return 329;
      case 6:
        if (N(7) && C(325) < 2) return 325;
        if (N(2)) return 326;
        return rng.int(305, 314);
      case 5:
        if (N(10) && C(315) < 1) return 315;
        return 329;
      case 4:
        // 原版怪癖（NPC.cs:3421）：判定是 !AnyNPCs(325)（悲木唯一）却刷 330（胡闹鬼）
        // ——疑似复制粘贴笔误，照抄源码不"修"
        if (N(8) && C(325) < 1) return 330;
        if (N(2)) return 326;
        return rng.int(305, 314);
      case 3:
        if (N(3)) return 329;
        return 326;
      case 2:
        if (N(3)) return 326;
        return rng.int(305, 314);
      default:                           // wave 1
        return rng.int(305, 314);        // 稻草人
    }
  }

  // ---- SpawnAnNPC（L1186-5144）——肉前分支 1:1，hardMode 分支保留 ----
  private spawnAnNPC(rng: RNG): Enemy | null {
    const st = this.world.store;
    const x = this.spawnTileX * TILE + 8;
    const y = this.spawnTileY * TILE;
    const N = (n: number) => rng.next() < 1 / n;  // Main.rand.Next(n)==0
    const hardMode = this.hardMode;
    // Main.expertMode（Main.cs:2762：Difficulty>=Expert；getGoodWorld 抬档同样成立）——
    // 专家持械僵尸变体（:4565/:4624/:4644）与各 AI 专家分支的门
    const expert = mainExpertMode(this.world);
    const t = this.spawnTileType;
    // SetSpawnFlags L709：日食白天关闭小动物段（(!eclipse || !dayTime) 门）——
    // 小动物块（下方 gem 支 + 地表森林块）须跳过
    const friendlyBlocked = this.world.clock.eclipse && this.dayTime;
    const D = (id: number) => this.spawnNPC(x, y, id, rng);
    const any = (id: number) => this.activeIds.has(id);
    // GetZombieSettings（L1193 调用，L5501：Next(7)）——地表夜最终僵尸 style，
    // 原版在函数入口 roll（此处同位置，保持后续 RNG 流顺序一致）
    this.zombieStyle = rng.int(0, 6);
    // ★IIIII61 WorldGen.Skyblock.lowTiles 两臂（GetZombieSettings :5602/:5615）：
    //   ① 未杀任何困难模式前 Boss 且 style∉{4,5} → 1/3 重掷为 style 4/5（swamp 域）
    //   ② spawnArmedZombies=false（本仓先前恒真——持械僵尸系全部禁刷）
    const sbDownedPreHM = this.downedAnyPreHardmodeBoss();
    if (this.world.skyblockLowTiles && !sbDownedPreHM
      && this.zombieStyle !== 4 && this.zombieStyle !== 5 && rng.int(0, 3) === 0) {
      this.zombieStyle = rng.int(0, 3) === 0 ? 4 : 5;
    }
    this.spawnArmedZombies = !(this.world.skyblockLowTiles && !sbDownedPreHM);
    // GetZombieSettings L5499-5514：torchZombieChance 基础 12；
    //  playerHasStartingHealth（L327：statLifeMax ≤ 100）→ 5 − numberOfActivePlayers/2
    //  （下限 2；活跃玩家数未跟踪 → 单人取 1）。skyblock 的 spawnArmedZombies=false
    //  只影响 591 持械变体，不影响本概率门
    this.torchZombieChance = this.playerLifeMax > 0 && this.playerLifeMax <= 100
      ? Math.max(2, 5 - Math.floor(1 / 2)) : 12;

    // ---- 星璇塔 Zone（NPC.cs:1204-1289：SpawnAnNPC 链**第一**分支——原版先于
    //  天空怪/入侵/月事件段；逐塔 SelectRandom 权重表 + CountNPCS 上限重掷，1:1）----
    if (this.lunar) {
      const z = this.lunar.zone;
      const C = (id: number) => this.lunar!.counts.get(id) ?? 0;
      const pick = (arr: number[]) => arr[rng.int(0, arr.length - 1)];   // Utils.SelectRandom
      if (z.nebula) {
        // 星云（L1204-1229）：424×3/423×3/421×3/420×2；上限 424<3、423<3、420<3（421 无上限）
        let id = 0;
        for (;;) {
          id = pick([424, 424, 424, 423, 423, 423, 421, 421, 421, 420, 420]);
          if (id === 424 && C(424) >= 3) continue;
          if (id === 423 && C(423) >= 3) continue;
          if (id === 420 && C(420) >= 3) continue;
          break;
        }
        if (id !== 0) return D(id);
      } else if (z.vortex) {
        // 星旋（L1230-1255）：429×4/427×2/425×2/426×1；上限 425<3、426<3、429<4
        let id = 0;
        for (;;) {
          id = pick([429, 429, 429, 429, 427, 427, 425, 425, 426]);
          if (id === 425 && C(425) >= 3) continue;
          if (id === 426 && C(426) >= 3) continue;
          if (id === 429 && C(429) >= 4) continue;
          break;
        }
        if (id !== 0) return D(id);
      } else if (z.stardust) {
        // 星尘（L1256-1263）：411×3/409×2/407/402/405 各 1，无上限
        return D(pick([411, 411, 411, 409, 409, 407, 402, 405]));
      } else if (z.solar) {
        // 日耀（L1264-1289）：518/419/418/412/417/416/415 各 1；掷中 418 再 1/2 重选
        //  {415,416,419,417}；上限 518<2、412<1（千足蜈蚣场内唯一）
        let id = 0;
        for (;;) {
          id = pick([518, 419, 418, 412, 417, 416, 415]);
          if (id === 418 && rng.int(0, 1) === 0) id = pick([415, 416, 419, 417]);
          if (id === 518 && C(518) >= 2) continue;
          if (id === 412 && C(412) >= 1) continue;
          break;
        }
        if (id !== 0) return D(id);
      }
    }

    // ---- 天空怪（原版 NPC.cs:1383-1425：else-if 链最前、invaders 之前——
    //  skyMob 优先于入侵分支；肉前 = 兜底鸟妖 48，困难 = 1/10 飞龙 87（场内唯一））----
    if (this.skyMob) {
      const stw = st.w;
      // flag5（NPC.cs:1387-1391）：带外距离>1/3 && skyBehindPlayer（SetSpawnFlags :413 =
      //  玩家所站格墙 ∈ Main.wallLight ∪{73}——地下暗墙背景直接关门）&& 无危险态
      //  （AnyDanger=月总倒计时/入侵/月事件/旧军/Boss 族/DangerThatPreventsOtherDangers，
      //  Game 每周期喂入 anyDangerCtx）。★此前只近似了带外距离，四项上下文门全缺
      let flag5 = Math.abs(this.spawnTileX - stw / 2) / (stw / 2) > 0.33
        && (st.wall[st.idx(this.pX, this.pY)] === 73
          || WALL_LIGHT.has(st.wall[st.idx(this.pX, this.pY)]));
      if (flag5 && this.anyDangerCtx) flag5 = false;
      // 水蜡烛加重档（:1392-1396）：maxValue2 8→3、maxValue3 30→10——探测器掷骰分母
      const mv2 = this.zoneWaterCandle ? 3 : 8;
      const mv3 = this.zoneWaterCandle ? 10 : 30;
      // 探测器掷（:1401）：(!downedMartians && Next(mv2)==0) || Next(mv3)==0——
      // ★旧实现把语义写反成 Next(downedMartians?30:8) 单掷；已败火星后 vanilla 只剩
      //   单独 1/mv3 一掷（短路），按原文短路序还原
      const probeRoll = (): boolean =>
        (!this.world.flags['downedMartians'] && rng.next() < 1 / mv2) || rng.next() < 1 / mv3;
      // 火星入侵期间天空怪位出无人机（L1397-1400：invaders && invasionType==4 → 388）
      if (this.invaders && this.world.invasionType === 4) return D(388);
      // L1401-1408 探测器 399（困难+已败石巨人+场上唯一）；第二个 else-if 是原版
      //  "水蜡烛重复支"怪癖（同条件再附 ZoneWaterCandle——烛亮时给第二次独立掷）
      if (hardMode && this.world.flags['downed_245'] && flag5 && probeRoll() && !any(399)) {
        return D(399);
      }
      if (hardMode && this.world.flags['downed_245'] && flag5 && probeRoll()
        && !any(399) && this.zoneWaterCandle) {
        return D(399);
      }
      // L1409-1416 飞龙 87：hard && 场上唯一 && !noWorms（房屋内不出蠕虫门）&& 1/10
      // + 水蜡烛重复支（同上怪癖，烛亮双 1/10）
      if (hardMode && !any(87) && !this.noWorms && N(10)) return D(87);
      if (hardMode && !any(87) && !this.noWorms && N(10) && this.zoneWaterCandle) return D(87);
      // L1417-1420 绑缚紫史莱姆 686——!unlockedSlimePurpleSpawn && RollLuck(25) && 场上唯一。
      //  unlockedSlimePurpleSpawn 本仓挂 world.flags（freeBoundNpc 置位，随存档持久化）；
      //  686 json 条目已手补（extract-npcs 正则漏块），Game 侧转 bound TownNPC
      if (!this.world.flags.unlockedSlimePurpleSpawn
        && rollLuck(this.playerLuck, 25, () => rng.next()) === 0 && !any(686)) return D(686);
      return D(48);
    }
    // ---- 入侵分支（L1333-1401：else if (invaders)，与普通链互斥）----
    if (this.invaders) {
      const it = this.world.invasionType;
      if (it === 1) {
        // 哥布林（L1335-1360）：召唤师(1/30,困难,唯一)→法师→小兵→弓手→盗贼→兜底战士
        if (hardMode && !any(471) && N(30)) return D(471);
        if (N(9)) return D(29);
        if (N(5)) return D(26);
        if (N(3)) return D(111);
        if (N(3)) return D(27);
        return D(28);
      }
      if (it === 2) {
        // 雪人军团（L1362-1372）：雪球怪 1/7 → 黑帮雪人 1/3 → 兜底 刺客雪人
        if (N(7)) return D(145);
        if (N(3)) return D(143);
        return D(144);
      }
      if (it === 3) {
        // 海盗（L1377-1401）：
        // 491 荷兰飞盗船（L1379-1382）：进度>50%（size<start/2）&& 1/20 && 场上无 491 &&
        //   净空（spawnTileX±20 × spawnTileY-40..-10 无实心，越界即实心）→
        //   落点 (spawnTileX*16+8, (spawnTileY-10)*16)（Bottom 锚，比地面怪高 10 格）
        // 船长(1/30,唯一)→弩手→鹦鹉→神枪手→海盗→兜底 甲板水手
        if (this.world.invasionSize < this.world.invasionSizeStart / 2 && N(20) && !any(491)) {
          let clear = true;
          for (let cx0 = this.spawnTileX - 20; cx0 <= this.spawnTileX + 20 && clear; cx0++) {
            for (let cy0 = this.spawnTileY - 40; cy0 <= this.spawnTileY - 10; cy0++) {
              if (cx0 < 0 || cx0 >= st.w || cy0 < 0 || cy0 >= st.h - 40 || st.isSolid(cx0, cy0)) {
                clear = false; break;
              }
            }
          }
          if (clear) return this.spawnNPC(x, (this.spawnTileY - 10) * TILE, 491, rng);
        }
        if (N(30) && !any(216)) return D(216);
        if (N(11)) return D(215);
        if (N(9)) return D(252);
        if (N(7)) return D(214);
        if (N(3)) return D(213);
        return D(212);
      }
      if (it === 4) {
        // 火星疯狂（L1408-1463）。flag6 = 进度≥30% 且场上无飞碟（1/45 或高档位 1/20 出 395）;
        // num7=Next(7): ≥6 → 骑手 390/工程师 386 二选;≥4 → 炮手 382×2/无人机 388/扰脑者 381;
        // <4 → 灰兵 385/电侠 389/军官 383,3/4 概率出火星行者 520（场上唯一,否则重掷）
        const prog = (this.world.invasionSizeStart - this.world.invasionSize)
          / (this.world.invasionSizeStart || 1);
        const saucerOk = prog >= 0.3 && !any(395);
        const num7 = rng.int(0, 6);
        if (N(45) && saucerOk) return D(395);
        if (num7 >= 6) {
          if (N(20) && saucerOk) return D(395);
          return D(rng.int(0, 1) === 0 ? 390 : 386);
        }
        if (num7 >= 4) {
          const r9 = rng.int(0, 4);
          return D(r9 < 2 ? 382 : r9 >= 4 ? 388 : 381);
        }
        let r10 = rng.int(0, 3);
        if (r10 === 3) {
          if (!any(520)) return D(520);
          r10 = rng.int(0, 2);
        }
        return D(r10 === 0 ? 385 : r10 === 1 ? 389 : 383);
      }
    }

    // ---- 墓地雕像宝箱怪（NPC.cs:1478，原版链位在入侵段之后、水池段之前）----
    //  downedBoss3 && ZoneGraveyard && !noWorms && RollBadLuckExtreme(25)==0 && 场上无 690
    //  && IsThisAGoodPlaceForAStatueMimic（:43751 = 落脚 2 格实心 + 上方 3 格净空，与
    //  邻近是否有雕像无关——名字只是历史）。该支不受 spawnFriendly 门（同链更早的
    //  兄弟分支），友好轮也可命中。690 immortal+aiStyle126（伪装雕像待敌靠近）。
    //  RollBadLuckExtreme = Luck.RollBadLuckExtreme(player.luck, 25)（NPC.cs:5271-5273，
    //  Luck.cs:40-51）：正运改掷 Next(250)（命中 1/250）、负运改掷 Next(25/10=2)（命中
    //  1/2）、否则 Next(25)（1/25）——曾裸 N(25) 无幸运度调制
    if (this.downedBoss3 && this.ZoneGraveyard && !this.noWorms
      && rollBadLuckExtreme(this.playerLuck, 25, () => rng.next()) === 0 && !any(690)
      && this.isGoodPlaceForAStatueMimic()) {
      return D(690);
    }
    // ---- 双地牢越界（NPC.cs:1482-1494）：tresspassingDualDungeon &&
    //      RollBadLuck(15)==0 → hardMode 82（地牢骷髅）：316（诅咒骷髅头）。
    //      tresspassing = getfixedboi 玩家置身不可破墙内（Player.insideUnbreakableWalls，
    //      UpdateUnbreakableWallScan 维护）且 DangerousDungeonCurse 进度档 < 所在区档
    //      （DangerousDungeonCurse.cs 双表：needs=区档 Temple5/Hallow4/Dungeon3/
    //      Jungle2/Evil1；can=进度档 downedMechAny|QueenSlime5/downedBoss3|hardMode4/
    //      QueenBee3/downedBoss2 2/SlimeKing|Boss1 1）——Game 侧比较后传入 ----
    if (this.trespassDual && rollBadLuck(this.playerLuck, 15, () => rng.next()) === 0) {
      return D(this.hardMode ? 82 : 316);
    }
    // ---- 微光墙落脚小动物链（NPC.cs:1495-1560）：num=落脚上格墙；墙 244（Shimmer）
    //      或 落脚格/上二格任一为 244 时走微光区小动物表。!remixWorld 门（:1495）。
    //      goldCritterChance=400（NPC.cs:5976）；侏儒档 GetGnomeChance 基档 10
    //      （:5281-5303；skyblock lowTiles 子档未建模备案，remix/2 被链首门短路） ----
    if ((st.wall[st.idx(this.spawnTileX, this.spawnTileY - 1)] === 244
      || st.wall[st.idx(this.spawnTileX, this.spawnTileY - 2)] === 244
      || st.wall[st.idx(this.spawnTileX, this.spawnTileY)] === 244)
      && !this.world.seedFlags?.remix) {
      const gold = () => rollLuck(this.playerLuck, 400, () => rng.next()) === 0;
      if (this.waterTile) return D(gold() ? 592 : 55);      // 金金鱼 / 金鱼
      if (this.spawnTileY > this.world.groundLevel) {        // Main.worldSurface（地下）
        if (N(3)) return D(gold() ? 447 : 300);              // 金蛙 / 蛙（Next(3)==0）
        if (N(2)) return D(359);                             // 359（Next(2)==0）
        if (gold()) return D(448);                           // 金鼠
        if (!N(3)) return D(357);                            // 鼠（Next(3)!=0；1/3 轮落空）
        return null;                                         // 原版地下链可无产出落出
      }
      if (rollLuck(this.playerLuck, 1 + 10 / 10, () => rng.next()) === 0) {
        const g = D(624);                                    // 侏儒：timeLeft×10（:1533）
        if (g) g.despawnTimer *= 10;
        return g;
      }
      if (gold()) return D(443);                             // 金鸟
      if (gold()) return D(539);                             // 金松鼠
      if (this.world.clock.halloween && !N(3)) return D(303); // 史莱姆兔（BunnySlimed,NPCID.cs:11677;SW-FX26 纠注:原注误标黑猫——原版万圣档 NPC.cs:1639 同掷 303,黑猫类 HoppinJack=304 不在此槽）
      if (this.world.clock.xMas && !N(3)) return D(337);     // 圣诞节日小动物
      if (this.partyUp && !N(3)) return D(540);              // 派对小动物
      if (N(3)) return D(rng.next() < 0.5 ? 299 : 538);      // 鸟/松鼠 SelectRandom
      return D(46);                                          // 兔
    }
    // ---- 酒保（L1565-1568）：!savedBartender && DD2Event.ReadyToFindBartender
    //      （= NPC.downedBoss2，DD2Event.cs:87——世吞/克脑已败）&& !AnyNPCs(579) &&
    //      1/80 && !waterTile → 579 BartenderUnconscious（触碰 → Transform 550，
    //      NPC.cs:19806-19809；savedBartender 由解救置位）。2026-08-13 前整链缺失
    //      = 酒馆老板不可达（除 debug），补齐 ----
    // （NPC.downedBoss2 = 世吞 13 / 克脑 266 任一已败——双旗判，同 dryad 门惯例）
    if (!this.world.flags['savedBartender']
      && !!(this.world.flags['downed_13'] || this.world.flags['downed_266'])
      && !any(579) && N(80) && !this.waterTile) {
      return D(579);
    }

    // ---- 蜘蛛巢（L1568-1587）：(墙 62 || spawnSpider) && CheckToSpawnSpider ----
    const wall = st.wall[st.idx(this.spawnTileX, this.spawnTileY)];
    // IIII225：CheckToSpawnSpider（NPC.cs:5790-5800）——NTB×FTW×非十周年世界：
    // 地狱层（≥UnderworldLayer=maxTilesY-200）1/5 才放行、其余层恒真；函数 vanilla
    // 尾支恒 true,故仅这类世界有实义（此前整函数缺席=NTB×FTW 地狱蜘蛛超刷）。
    const spiderGateOk = !(
      !!this.world.seedFlags?.notTheBees && !!this.world.seedFlags?.getGoodWorld
      && !this.world.seedFlags?.tenthAnniversary
      && this.spawnTileY >= this.world.lavaLine && !N(5));
    if ((wall === 62 || this.spawnSpider) && spiderGateOk) {
      // flag7（L1574-1578）= deeperThanRockLayer && y<h-210（★IIIII228 :1665-1667
      //  theConstant 变体 = 仅 y<h-210,去 deeperThanRockLayer 门——remix 重定义的
      //  deeperThanRockLayer 已随字段语义自然生效）
      const flag7 = this.world.seedFlags?.theConstant
        ? this.spawnTileY < st.h - 210
        : (this.deeperThanRockLayer && this.spawnTileY < st.h - 210);
      // 造型师 354（L1579-1581）：墙 62 专属门 + 1/8 + !water + flag7 +
      // !savedStylist + 场内唯一——曾因生成期 placeBoundRescueNpcs 近似而"注释保留"
      // 跳过；2026-08-13 移除生成期放置后按原版补齐（D 真条目，Game 侧转 bound TownNPC）
      if (wall === 62 && N(8) && !this.waterTile && flag7
        && !this.world.flags['savedStylist'] && !any(354)) return D(354);
      if (this.hardMode && !N(10)) return D(163);  // hardMode 9/10 黑寡妇(L1583)
      return D(164);                               // 爬墙者
    }
    // ---- 地下沙漠（L1589-1672 1:1）----
    //  门：落点/上格带沙漠墙（AllowsUndergroundDesertEnemiesToSpawn≈spawnUndergroundDesert
    //  邻域扫描已覆盖）&& WorldGen.checkUnderground（L1589 第二合取项，此前缺失——
    //  浅层沙洞误判地下沙漠）
    // L1682（1:1）：门 = SpawnTileOrAboveHasAnyWallInSet(落点格/上格 ∈ 沙漠墙集)
    //  || spawnUndergroundDesert 邻域扫描旗——直接踩沙漠墙的落点每次尝试都受理
    //  （邻域扫描是 1/3 概率抽样，此前漏了这条恒真支 → 正中墙心的落点常落空）
    if ((this.spawnUndergroundDesert || this.tileOrAboveWallInDesertSet())
      && this.checkUnderground(this.spawnTileX, this.spawnTileY)) {
      // num11 深度系数（L1591-1599）：岩石层下再深(>(rockLayer*2+h)/3)×0.5、
      // 岩石层下 ×0.85，用于下方两支蠕虫的 1/(50*num11) 概率门
      let num11 = 1.3;
      if (this.spawnTileY > (this.world.rockLevel * 2 + st.h) / 3) num11 *= 0.5;
      else if (this.spawnTileY > this.world.rockLevel) num11 *= 0.85;
      // L1600：高尔夫球手 589（1/20，非水域，!savedGolfer，场内唯一）——
      //  spawnBound 占位体（同三人组），Game 侧转 bound TownNPC（json 已有 589
      //  条目，占位走法系转桶单源决策非缺条目；BJ117-③ 勘误）。
      //  savedGolfer 由 freeBoundNpc 解救时写（"未跟踪恒 false"注释已过时）
      if (N(20) && !this.waterTile && !this.world.flags['savedGolfer'] && !any(589)) {
        return this.spawnBound(589);
      }
      // L1605：沙虫 510（hard，1/(50·num11)，非蠕虫禁置，落脚深于 worldSurface+100）
      if (hardMode && N(Math.floor(50 * num11)) && !this.noWorms
        && this.spawnTileY > this.world.groundLevel + 100) return D(510);
      // L1610：墓穴爬虫 513（同概率门，场内唯一）
      if (N(Math.floor(50 * num11)) && !this.noWorms
        && this.spawnTileY > this.world.groundLevel + 100 && this.countNpc(513) === 0) return D(513);
      // L1615：hard 4/5 加权池（SelectRandom：恶地双份 525/526/527、中立双份 524、
      //  恶地补 533/529 否则 530/528、恒补 532）
      if (hardMode && !N(5)) {
        const ghoulPool: number[] = [];
        if (this.ZoneCorrupt) ghoulPool.push(525, 525);
        if (this.ZoneCrimson) ghoulPool.push(526, 526);
        if (this.ZoneHallow) ghoulPool.push(527, 527);
        if (ghoulPool.length === 0) ghoulPool.push(524, 524);
        if (this.ZoneCorrupt || this.ZoneCrimson) ghoulPool.push(533, 529);
        else ghoulPool.push(530, 528);
        ghoulPool.push(532);
        return D(ghoulPool[rng.int(0, ghoulPool.length - 1)]);
      }
      // L1654：基础池 = SelectRandom(69,580,580,580,581)（蚁狮 20%/步行蚁狮×3 60%/飞行蚁狮 20%），
      //  再 1/15 覆盖沙史莱姆 537、1/10 升级巨型变体 508/509（顺序不可反——原版先选后改）
      let num12 = [69, 580, 580, 580, 581][rng.int(0, 4)];
      if (N(15)) num12 = 537;
      else if (N(10)) {
        if (num12 === 580) num12 = 508;
        else if (num12 === 581) num12 = 509;
      }
      return D(num12);
    }
    // ---- 硬模式群系水面（:1673-1683,地下沙漠块尾 else-if 链;pre-hardmode 恒跳过）----
    //  丛林水 2/3 → 巨骨舌鱼 157(Arapaima);猩红水 2/3 → 242/241(毒骨鱼/血浆渗透者)
    //  ★此前未移植:困难模式丛林湖泊只有食人鱼/垂钓者兜底,原版主体是巨骨舌鱼
    if (hardMode && this.waterTile && this.ZoneJungle && !N(3)) return D(157);
    if (hardMode && this.waterTile && this.ZoneCrimson) {
      if (!N(3)) return D(242);
      if (!N(3)) return D(241);
    }
    // ---- 海洋（L1705-1834）----
    // 门（L1705）：(!spawnFriendly || (!savedAngler && !AnyNPCs(376))) && waterTile && isOcean。
    //  spawnFriendly（Spawner 字段 L71）：SetSpawnFlags L714-828 内**概率 roll** 的
    //  "友好刷怪位"——该帧只刷小动物。门语义：友好轮**只**被"渔夫未救且场上无 376"
    //  拦截（此时渔夫优先占位），敌怪轮恒放行——此前写成 !any(376) 整体封门，
    //  睡渔夫在场时海洋敌怪（鲨鱼/水母/鱿鱼）全部断供。
    //  savedAngler（NPC.savedAngler 静态）：渔夫救援链在 Game 侧闭环（placeSleepingAngler
    //  放 bound 渔夫 → 右键 freeBoundNpc 置 savedAngler，Game:3008）——放置走确定性
    //  补放非本段掷出（何时放差异已登记）。AnyNPCs(376) 用 activeIds 现查
    //  SW-BJ31 2026-09-08：补 L1705/L1708 的 !savedAngler 两处门（友好半臂+渔夫掷）——
    //  解救后原版绝不再掷 376,旧缺门=解救后海洋仍可再出睡渔夫
    if ((!this.spawnFriendlyCycle || (!this.world.flags['savedAngler'] && !any(376)))
      && this.waterTile && this.isOcean) {
      // 渔夫 376（L1708-1728）：表层水（spawnTileY < worldSurface-10）→ 向上 50 格
      //  找干隙线 num15 → 抬到该线落点；!xRange 才出（L1723）
      let angler: Enemy | null = null;
      if (!this.world.flags['savedAngler'] && !any(376)
        && (this.spawnTileY < this.world.groundLevel - 10 || this.world.seedFlags?.remix)) {  // ★IIIII228 :1801 remix 或支
        const num15 = this.findDryGapY(this.spawnTileY);
        if (num15 > 0 && !this.xRange) angler = this.spawnNPC(x, num15 * TILE, 376, rng);
      }
      // L1729-1732：出了渔夫或落点在玩家横向 safe 范围内 → 直接返回
      if (angler || this.xRange) return angler;
      // 水面线 num17 / 岸上净空位 num18（L1733-1761，仅 spawnTileY<worldSurface 且 >50）
      let num17 = -1, num18 = -1;
      // ★IIIII228 :1828 remix 或支（地下海同样出水面线小动物）
      if ((this.spawnTileY < this.world.groundLevel || this.world.seedFlags?.remix) && this.spawnTileY > 50) {
        for (let y2 = this.spawnTileY - 1; y2 > this.spawnTileY - 50; y2--) {
          if (st.liquid[st.idx(this.spawnTileX, y2)] === 0
            && !st.isSolid(this.spawnTileX, y2) && !st.isSolid(this.spawnTileX, y2 + 1)
            && !st.isSolid(this.spawnTileX, y2 + 2)) {
            num17 = y2 + 2;
            // L1742-1745：num17 下两格净空且 num17+2 墙非房屋墙 → 岸上落点 num18
            if (!st.isSolid(this.spawnTileX, num17 + 1) && !st.isSolid(this.spawnTileX, num17 + 2)
              && !WALL_HOUSE.has(st.wall[st.idx(this.spawnTileX, num17 + 2)])) num18 = num17 + 2;
            // L1746-1749：num17 自身在房屋墙内 → 作废水面线
            if (WALL_HOUSE.has(st.wall[st.idx(this.spawnTileX, num17)])) num17 = -1;
            break;
          }
        }
        if (num17 > this.spawnTileY) num17 = this.spawnTileY;   // L1753-1756
        if (num18 > this.spawnTileY) num18 = this.spawnTileY;   // L1757-1760
      }
      // 海鸥 602（L1762-1765）：干隙线存在 + !xRange + 1/10 → 落在水面线 num17
      if (num17 > 0 && !this.xRange && N(10)) return this.spawnNPC(x, num17 * TILE, 602, rng);
      // 鲨鱼 65（L1766-1769）：1/SharkSpawnChance。SharkSpawnChance（NPC1458.cs:5558-5576）
      //  基础 10；从落点上一格向上走水柱至水面（y-- while !SolidTile3 && liquid>0,y++），
      //  水面点 Collision.CanHit(活体弹体 820 矩形) 命中 → 2。本仓 820 走 chumBucket
      //  注册面（实体未实装,现恒空表 → 恒 10,与 vanilla 无 chum 投掷时同态;R25-E10 接线）
      let sharkChance = 10;
      {
        let syw = this.spawnTileY - 1;
        while (st.inBounds(this.spawnTileX, syw) && !st.isSolid(this.spawnTileX, syw)
          && st.liquid[st.idx(this.spawnTileX, syw)] > 0) syw--;
        syw++;
        if (st.inBounds(this.spawnTileX, syw)) {
          const px1 = this.spawnTileX * TILE + 8, py1 = syw * TILE;   // :5569 CanHit 起点(x*16+8,y*16) 1×1
          for (const s of chumSpots()) {
            if (canHit(st, px1, py1, 1, 1, s.x, s.y, s.w, s.h)) { sharkChance = 2; break; }
          }
        }
      }
      if (N(sharkChance)) return D(65);
      // 鲨鱼龙 692（L1770-1773，困难）：json 已有条目（1:1 虎鲸属性，aiStyle 16 游泳族）
      if (hardMode && N(sharkChance)) return D(692);
      // 海洋小动物（L1774-1817）：1/10 门 → Next(4) 四选
      if (N(10)) {
        const num20 = rng.int(0, 3);   // Main.rand.Next(4)
        if (num20 === 0 && num17 > 0) return this.spawnNPC(x, num17 * TILE, 625, rng);  // 海龟
        if (num20 === 1 && num18 > 0) return this.spawnNPC(x, num18 * TILE, 615, rng);  // 海豚
        if (num20 === 2) {   // 海马（L1789-1805）：金 1/goldCritterChance(400, NPC.cs:5976)
          const num22 = num18 > 0 ? num18 : this.spawnTileY;
          return this.spawnNPC(x, num22 * TILE, N(400) ? 627 : 626, rng);
        }
        if (num20 === 3) {   // 河豚（L1806-1815）
          const num21 = num18 > 0 ? num18 : this.spawnTileY;
          return this.spawnNPC(x, num21 * TILE, 688, rng);
        }
        return null;   // case0/1 落点条件不满足 → 原版 switch 空过不生成
      }
      if (N(40)) return D(220);   // 海蜗牛（L1818-1821）
      if (N(18)) return D(221);   // 鱿鱼（L1822-1825）
      if (N(3)) return D(67);     // 螃蟹（L1826-1829）
      return D(64);               // 粉水母兜底（L1830-1833）
    }
    // SW-BJ31 2026-09-08【同族缺支补齐】沙滩干沙睡渔夫（NPC.cs:1928-1931,1458 同文）：
    //  !waterTile && !savedAngler && !AnyNPCs(376) && (x<WorldGen.beachDistance(380)
    //  || x>maxTilesX-380) && Main.tileSand[tileType] && y<worldSurface → 376。
    //  门全确定性零 RNG；链位=海洋支（恒 return→本 if 等价 else-if）与水池段门 A 之间,
    //  与原版 else-if 序一致。★IIIII228 :1928 remix 或支实装（旧"Remix 支裁决
    //  不实现"裁决由 IIIII228 交办书清偿取代）。产出真 Enemy 376
    // （同 placeSleepingAnglerAt 实体路径,解救走 ENEMY_BOUND_TOWN_KEY 376→'angler'）
    if (!this.waterTile && !this.world.flags['savedAngler'] && !any(376)
      && (this.spawnTileX < 380 || this.spawnTileX > st.w - 380)
      && TILE_SAND.has(t)
      && (this.spawnTileY < this.world.groundLevel || this.world.seedFlags?.remix)) {
      return this.spawnNPC(x, y, 376, rng);
    }
    // ---- 水池段（L1839-1905）----
    //  两支 else-if（原版 L1839 / L1895,均带 !spawnFriendly 门）;友好轮落 SpawnAnNPC
    //  :2006 的 spawnFriendly 段(水中小动物 :2136+),本仓该段走水中小动物近似于 A 段内
    if (this.waterTile && !this.isOcean && !this.spawnFriendlyCycle) {
      // 门 A（L1839）：!spawnFriendly && waterTile && ((deeperThanRockLayer && 1/2) || 丛林草 60)
      if ((this.deeperThanRockLayer && N(2)) || t === T.JUNGLE_GRASS) {
        let flag9 = false;
        // L1842：丛林草 + 表层 + y>50 + 1/3 + 白天 → 水面线小动物
        if (t === T.JUNGLE_GRASS && this.surfaceSpawn && this.spawnTileY > 50 && N(3) && this.dayTime) {
          const num23 = this.findDryGapY(this.spawnTileY);
          if (num23 > 0 && !this.xRange) {   // L1857
            flag9 = true;
            // 丛林龟 617（L1860-1864）：1/4
            if (N(4)) return this.spawnNPC(x, num23 * TILE, 617, rng);
            // 水黾群（L1865-1880）：无风（flag = |windSpeedTarget|>0.45, L1201）且非雨天
            //  → Next(1,4) 只、x 抖 ±16px、落 num23 上一格；金水黾 1/400
            //  spawner 单返回值 API 只能交付 1 只，其余丢弃（原版成群 1-3 只）
            const windy = Math.abs(this.world.weather.windSpeedTarget) > 0.45;
            const raining = this.ctxRaining;
            if (!windy && !raining) {
              flag9 = true;
              const num25 = rng.int(1, 3);   // Main.rand.Next(1,4)
              const jx = x + rng.int(-16, 16);
              return this.spawnNPC(jx, num23 * TILE - TILE, N(400) ? 613 : 612, rng);
            }
          }
        }
        if (!flag9) {
          // L1883-1893：琵琶鱼（困难 Next(3)>0 = 2/3）/ 食人鱼兜底
          if (hardMode && rng.next() < 2 / 3) return D(102);
          return D(58);
        }
        return null;   // flag9 已置但雨天/有风未生成（L1883 守卫）→ 原版本帧不出怪
      }
      // 门 B（L1895）：!spawnFriendly && waterTile && spawnTileY>worldSurface && 1/3
      //  → 绿水母（困难 2/3）/ 蓝水母 63
      if (this.spawnTileY > this.world.groundLevel && N(3)) {
        if (hardMode && rng.next() < 2 / 3) return D(103);
        return D(63);
      }
    }
    // ---- 水池第三支（L1906-1993 1:1，**无** !spawnFriendly 门——友好轮也可命中；
    //  A/B 两支带 !spawnFriendly,本仓外层 if 只包 A/B,故此支独立成块）----
    //  门：waterTile && 1/4 && (x 在两片海洋带之间 || y > worldSurface+50)：
    //  腐化→57 腐化金鱼 / 猩红→465 邪恶金鱼；否则白天地表水（y<ws && >50 && 2/3）
    //  → 水面线小动物（草地 1/5 水黾 616 / 沙地 1/2 水黾群或鸊鷉 608 / 其余鸭 362/364）；
    //  深水或夜间 → 内带沙 607 鳉 / 金金鱼 592(1/400) / 兜底金鱼 55
    if (this.waterTile && N(4) && ((this.spawnTileX > 250 && this.spawnTileX < st.w - 250)
      || this.spawnTileY > this.world.groundLevel + 50)) {
      if (this.ZoneCorrupt) return D(57);
      if (this.ZoneCrimson) return D(465);
      if (this.spawnTileY < this.world.groundLevel && this.spawnTileY > 50 && !N(3) && this.dayTime) {
        // 地表白日水面线（:1918-1930 复用 findDryGapY）
        const num26 = this.findDryGapY(this.spawnTileY);
        if (num26 > 0 && !this.xRange) {
          // :1933(1457 NPC.cs:2027-2029) 草族(2/477) && 1/5 → 616=海龟 Turtle
          //（R4 勘误:616 非水黾——水黾=612/金 613 走下方沙地支,本支行为与原版一致仅注释错名）
          if (N(5) && (t === T.GRASS || t === T.MOWED_GRASS)) return this.spawnNPC(x, num26 * TILE, 616, rng);
          // :1937 沙地：1/2 无风无雨 → 水黾群 613 金/612（原版 1-3 只,单返回值交付 1 只）;
          //  否则鸊鷉 608
          if (t === T.SAND) {
            const windyC = Math.abs(this.world.weather.windSpeedTarget) > 0.45;   // :1201 flag
            if (N(2) && !windyC && !this.ctxRaining) {
              return this.spawnNPC(x + rng.int(-16, 16), num26 * TILE - TILE, N(400) ? 613 : 612, rng);
            }
            return this.spawnNPC(x, num26 * TILE, 608, rng);
          }
          // :1959 其余 1/2 → 鸭 362 / 364
          return this.spawnNPC(x, num26 * TILE, N(2) ? 362 : 364, rng);
        }
        // 水面线不成立（num26<=0 或 xRange 内）→ :1968 沙地内带鳉鱼 607（原版落在
        //  num26*16——num26 为 -1 时即负 y,照抄）/ 金金鱼 592(1/400) / 金鱼 55
        if (t === T.SAND && this.spawnTileX > 380 && this.spawnTileX < st.w - 380) {
          return this.spawnNPC(x, num26 * TILE, 607, rng);
        }
        if (N(400)) return D(592);
        return D(55);
      }
      // :1981 深水/夜间：内带沙 607 / 金金鱼 592(1/400) / 兜底金鱼 55
      if (t === T.SAND && this.spawnTileX > 380 && this.spawnTileX < st.w - 380) return D(607);
      if (N(400)) return D(592);
      return D(55);
    }
    // ---- 绑缚三人组（1456 NPC.cs:1994-2005 = 1457 :2087-2096，1458 同行同文：水池
    //      第三支之后、spawnFriendly 段之前的三支 else-if；友好轮同样可命中——原版
    //      无 spawnFriendly 门。★106 巫师前置旗=Main.hardMode（:2091），肉前恒不刷
    //      ——与 105 downedGoblins/685 downedBoss3 各异，用户实报"巫师不刷"首选核此）----
    //  公共门：RollLuck(20)==0 && !waterTile && deeperThanRockLayer &&
    //  spawnTileY < maxTilesY-210 && 前置旗 && !savedXxx && 场上唯一（AnyNPCs）。
    //  ★&& 求值序与原版一致（前置旗在 RollLuck 之前短路）——RNG 消费流不变。
    //  产出为占位 Enemy（spawnBound——Game.trySpawnEnemy 按 vanillaId 转 bound
    //  TownNPC，占位体随即弃置；json 现已含 685 真条目，旧注"缺条目 fromVanilla
    //  会 null"过时——占位系转桶单源决策，BJ117-③ 勘误）：
    //    105 BoundGoblin  ← downedGoblins && !savedGoblin
    //    106 BoundWizard  ← hardMode && !savedWizard
    //    685 BoundTownSlimeOld ← downedBoss3 && !unlockedSlimeOldSpawn
    //    （解救记账见 Game.freeBoundNpc；685 解救置 flags.unlockedSlimeOldSpawn）
    {
      const f = this.world.flags;
      // ★原版三支均为 RollLuck(20)（运气缩放，1456 门 :1994/1998/2002 三行分写 =
      //   1457 :2087/2091/2095;红蓝-D 2026-09-18 锚勘误——原「1456 :1996-2008」非连续块）
      //  ——曾平掷 N(20)，已 1:1
      const luck20 = () => rollLuck(this.playerLuck, 20, () => rng.next()) === 0;
      if (f['downedGoblins'] && luck20() && !this.waterTile && this.deeperThanRockLayer
        && this.spawnTileY < st.h - 210 && !f['savedGoblin'] && !any(105)) {
        return this.spawnBound(105);
      }
      if (hardMode && luck20() && !this.waterTile && this.deeperThanRockLayer
        && this.spawnTileY < st.h - 210 && !f['savedWizard'] && !any(106)) {
        return this.spawnBound(106);
      }
      if (this.downedBoss3 && luck20() && !this.waterTile && this.deeperThanRockLayer
        && this.spawnTileY < st.h - 210 && !f['unlockedSlimeOldSpawn'] && !any(685)) {
        return this.spawnBound(685);
      }
    }
    // ---- 墓地友好轮（SpawnAnNPC :2008-2014，spawnFriendly 段首支）----
    //  ZoneGraveyard 时友好轮恒走本支：非水域 50/50 蛆 606 / 鼠 610，水域直接空过——
    //  不受昼夜门限制（原版本支无 dayTime 条件），也不落后续小动物链
    if (this.spawnFriendlyCycle && this.ZoneGraveyard) {
      if (!this.waterTile) return D(N(2) ? 610 : 606);
      return null;
    }
    // ---- 友好轮海滩支（NPC.cs:2021-2097：!xRange && isBeach[y≤ws 且海岸带]，
    //      整支 return——命中后不再落后续小动物链。★原版在 spawnFriendly 段内
    //      （:2006 else-if 链），敌怪轮不进——曾漏外层门致敌怪轮被 602 截胡）----
    //  水落点：干隙扫描（同 :4297 敌怪轮版）→ Next(2)==0 才掷 Next(4) 表
    //  （625 低线/615 高线/金 627|626 高线/688 高线）；else 低线有效 → 602。
    //  干落点：直接 602 海鸥
    if (this.spawnFriendlyCycle && !this.xRange && this.isBeach) {
      if (this.waterTile) {
        let fLow = -1, fHigh = -1;
        // ★IIIII228 :2122 remix 或支
        if ((this.spawnTileY <= this.world.groundLevel || this.world.seedFlags?.remix) && this.spawnTileY > 50) {
          const solidAt = (xxx: number, yyy: number): boolean => {
            if (!st.inBounds(xxx, yyy)) return false;
            const ii = st.idx(xxx, yyy);
            const d = TILE_DEFS[st.type[ii]];
            return !!st.flags[ii] && !!d?.solid && !d?.platform
              && !st.half[ii] && st.slope[ii] === 0
              && !(st.wire[ii] & TileStore.WIRE_ACTUATED);
          };
          for (let yy = this.spawnTileY - 1; yy > this.spawnTileY - 50; yy--) {
            const i1 = st.idx(this.spawnTileX, yy);
            if (st.liquid[i1] === 0 && !solidAt(this.spawnTileX, yy)
              && !solidAt(this.spawnTileX, yy + 1) && !solidAt(this.spawnTileX, yy + 2)) {
              fLow = yy + 2;
              if (!solidAt(this.spawnTileX, fLow + 1) && !solidAt(this.spawnTileX, fLow + 2)) {
                fHigh = fLow + 2;
              }
              break;
            }
          }
          if (fLow > this.spawnTileY) fLow = this.spawnTileY;
          if (fHigh > this.spawnTileY) fHigh = this.spawnTileY;
        }
        if (N(2)) {
          const r = rng.int(0, 3);
          if (r === 0) { if (fLow > 0) return this.spawnNPC(x, fLow * TILE, 625, rng); return null; }
          if (r === 1) { if (fHigh > 0) return this.spawnNPC(x, fHigh * TILE, 615, rng); return null; }
          if (r === 2) {
            const yy2 = fHigh > 0 ? fHigh : this.spawnTileY;
            return this.spawnNPC(x, yy2 * TILE,
              rollLuck(this.playerLuck, 400, () => rng.next()) === 0 ? 627 : 626, rng);
          }
          const yy3 = fHigh > 0 ? fHigh : this.spawnTileY;
          return this.spawnNPC(x, yy3 * TILE, 688, rng);
        }
        if (fLow > 0 && !this.xRange) return this.spawnNPC(x, fLow * TILE, 602, rng);
        return null;
      }
      return D(602);
    }
    // ---- 友好轮雨天香蒲蜻蜓（NPC.cs:2105-2123：草沙{2,477,53} && !tooWindy &&
    //      raining && day && Next(2)==0 && y≤ws && FindCattailTop → 金 601 else
    //      RollDragonflyType + 1/3 左右附加；整支 return。spawnFriendly 段内
    //      （:2006 链，敌怪轮不进））----
    if (this.spawnFriendlyCycle
      && (t === T.GRASS || t === T.MOWED_GRASS || t === T.SAND)
      && Math.abs(this.world.weather.windSpeedTarget) < 0.4 && this.ctxRaining && this.dayTime
      && N(2) && (this.spawnTileY <= this.world.groundLevel || this.world.seedFlags?.remix)) {  // ★IIIII228 :2200
      const ct = this.findCattailTop(this.spawnTileX, this.spawnTileY, rng);
      if (ct) {
        const main = rollLuck(this.playerLuck, 400, () => rng.next()) === 0
          ? 601 : this.rollDragonflyType(t, rng);
        const b = this.spawnNPC(ct.x * TILE + 8, ct.y * TILE, main, rng);
        if (N(3)) this.pendingCritterExtras.push({ npc: this.rollDragonflyType(t, rng), dx: 0, dy: 0, ax: ct.x * TILE + 8 - 16, ay: ct.y * TILE });
        if (N(3)) this.pendingCritterExtras.push({ npc: this.rollDragonflyType(t, rng), dx: 0, dy: 0, ax: ct.x * TILE + 8 + 16, ay: ct.y * TILE });
        return b;
      }
    }
    // ---- 友好轮通用水域段（NPC.cs:2220-2325）：雨天香蒲支之后、switch 落脚族之前。
    //  敌怪轮 A/B 水池有 !spawnFriendly 门、友好轮的水面小动物主源是本段
    //  （★此前整段缺失 = 友好轮水域几乎空过，仅走上方无友好门的第三水支 1/4 金鱼档）：
    //  白天地表水面线 dry-gap 扫描 → case 60 丛林草: 无风无雨 1-3 水黾群(金613) else 龟617 /
    //  case 53 沙地: 水黾群 else 鸊鷉608 / default 草: 1/5 海龟616 else Next(2) 鸭362|364；
    //  未达线 → 内带沙鳉607 / RollLuck(400) 金金鱼592 / 兜底金鱼55。整支 return ----
    if (this.spawnFriendlyCycle && this.waterTile) {
      if (this.surfaceSpawn && this.spawnTileY > 50 && !N(3) && this.dayTime) {
        const num34 = this.findDryGapY(this.spawnTileY);
        if (num34 > 0 && !this.xRange) {
          const windyWater = Math.abs(this.world.weather.windSpeedTarget) > 0.45;
          if (t === T.JUNGLE_GRASS || t === T.SAND) {
            // case 60/53 同构：Next(3)!=0 且无风无雨 → 水黾群（成组数张量同敌怪轮：
            // 单返回值 API 只交付首只），else 陆生档 617/608
            if (!N(3) && !windyWater && !this.ctxRaining) {
              const goldStrider = rollLuck(this.playerLuck, 400, () => rng.next()) === 0;
              return this.spawnNPC(x + rng.int(-16, 16), num34 * TILE - TILE,
                goldStrider ? 613 : 612, rng);
            }
            return this.spawnNPC(x, num34 * TILE, t === T.JUNGLE_GRASS ? 617 : 608, rng);
          }
          if (N(5) && (t === T.GRASS || t === T.MOWED_GRASS)) {
            return this.spawnNPC(x, num34 * TILE, 616, rng);
          }
          return this.spawnNPC(x, num34 * TILE, N(2) ? 362 : 364, rng);
        }
      }
      // 内带沙底鳉鱼 / 金金鱼 / 金鱼（:2299-2324）
      if (t === T.SAND && this.spawnTileX > 380 && this.spawnTileX < st.w - 380) {
        return this.spawnNPC(x, this.spawnTileY * TILE, 607, rng);
      }
      if (rollLuck(this.playerLuck, 400, () => rng.next()) === 0) return D(592);
      return D(55);
    }
    // ---- 友好轮雨天链尾（NPC.cs:2380-2407 全段，case 2/109/477/492 + default 地下）----
    //  门：raining && spawnTileY ≤ UnderworldLayer——进入本支后【恒产出一物并 break】，
    //  不再落后续昼夜链（★旧实现只移植深层两支宝石掷且未命中直接放行，
    //  致雨天草面出鸟表二/尾部兔等原版雨天绝迹的组合）：
    //  深层 1/5 宝石松鼠 → 1/5 宝石兔 → RollLuck(400) 金蚯蚓 448 → Next(3)!=0 蚯蚓 357
    //  → RollLuck(400) 金上岸金鱼 593 → 兜底 上岸金鱼 230（GoldfishWalker）
    //  tile 门 = 四草族或地下任意；147/161/60/53 走各自 switch case（须排除）
    const gemTileOK = !(t === T.JUNGLE_GRASS || t === T.SNOW || t === T.ICE || t === T.SAND);
    if (this.spawnFriendlyCycle && !this.waterTile && this.ctxRaining && gemTileOK
      && !friendlyBlocked
      && this.spawnTileY <= st.h - 200) {
      if (this.deeperThanRockLayer && N(5)) return D(this.getGemSquirrelToSpawn(rng));
      if (this.deeperThanRockLayer && N(5)) return D(this.getGemBunnyToSpawn(rng));
      if (rollLuck(this.playerLuck, 400, () => rng.next()) === 0) return D(448);
      if (!N(3)) return D(357);
      if (rollLuck(this.playerLuck, 400, () => rng.next()) === 0) return D(593);
      return D(230);
    }
    // ---- 小动物（spawnFriendly 段 L2006-2535，switch case 147/161/60/53/2 链）----
    //  日食白天小动物段整体关闭（L709 门，friendlyBlocked）。
    //  ★case 147/161/53（企鹅/蝎）原版【无 flag10/深度门】——地下雪原/沙漠同样
    //  出（review 修正:曾误并入 surfaceSpawn 门）;case 2 草族链各支才带 flag10。
    //  蝎的水下支已在上方水面线段先行 return。
    if (this.spawnFriendlyCycle && !this.waterTile && !friendlyBlocked &&
      (t === T.SNOW || t === T.SNOW_BRICK)) {
      if (N(2)) return D(148);
      return D(149);
    }
    if (this.spawnFriendlyCycle && !this.waterTile && !friendlyBlocked && t === T.SAND) {
      return D(rng.next() < 0.5 ? 366 : 367);   // case 53：Next(366,368) 黑/普各半
    }
    // （2026-08-17 重构为原版 case 2 链真序：昼夜门下放到各支——链本身无 dayTime
    //  门，兔/松鼠/鸟夜间照出；旧"N(15) 包裹 + 森林概率表(蚯蚓/蚱蜢/鼠混编)"
    //  为自创近似已废——蚯蚓/蚱蜢的正源是割草 DropBait（Game breakTile 掷），
    //  鼠走墓地 610/地下链 300。tile 门 = case 2/109/477/492 四草族——★DIRT 不在
    //  原版 case 2（地表泥土落 default 空过，review 摘除旧超集））
    if (this.spawnFriendlyCycle && !this.waterTile && this.surfaceSpawn && !friendlyBlocked &&
      (t === T.GRASS || t === T.MOWED_GRASS || t === T.HALLOW_GRASS || t === T.HALLOW_MOWED_GRASS)) {
      const grassFam = true;   // 外门即草族四 tile
      const tooWindyFF = Math.abs(this.world.weather.windSpeedTarget) >= 0.4;
      // ---- 流星夜附魔夜爬虫（NPC.cs:2316-2319，case 2 链雨支之后萤火虫支之前）：
      //  !dayTime && numClouds≤55 && cloudBGActive==0（天气机器未强制雨背景）&&
      //  Star.starfallBoost>3 && flag10（地表，外门已含）&& RollLuck(2)==0 → 484。
      //  ★曾在 Game 侧每 tick 50% 于 player.y-200 天上直刷、无上限无频率无瓦片门
      //  = 星流夜"粉虫雨"洪水（用户实抓 535 只，2026-08-21）；归位本链继承生成
      //  上限/频率/草地瓦片扫描门控（2026-08-22 修） ----
      if (!this.dayTime && (this.world.weather.numClouds ?? 200) <= 55
        && !this.world.weather.cloudBGActive && this.starfallBoost > 3
        && rollLuck(this.playerLuck, 2, () => rng.next()) === 0) {
        return D(484);
      }
      // ---- 夜萤火虫（NPC.cs:2414-2438，友好轮专属槽：!tooWindy && 夜 &&
      //      Next(fireFlyFriendly)==0 && flag10）——概率源与敌怪轮的 fireFlyChance
      //      是同夜独立两掷（setFireFlyChance :94503-94516：高发夜 friendly∈[1,3] /
      //      绝迹夜 999999 / 常态 [2,15)），主只后四向各 1/fireFlyMultiple 附加 ----
      if (!tooWindyFF && !this.dayTime && grassFam
        && N(Math.max(1, this.world.fireFlyFriendly))) {
        const ffId = t === T.HALLOW_GRASS ? 358 : 355;
        this.queueFireflyExtras(rng, ffId);
        return D(ffId);
      }
      // ---- 夜间猫头鹰（NPC.cs:2345-2354：!rain && 夜 && Next(5)==0 && flag10）：
      //      RollBadLuckExtreme(100)==0 → 689 金猫头鹰（1/100 近似），else 611 ----
      if (!this.dayTime && !this.ctxRaining && grassFam && N(5)) {
        return D(rng.next() < 1 / 100 ? 689 : 611);
      }
      // ---- 晨间鸟表（NPC.cs:2358-2380：dayTime && Main.time<18000(<9:30) &&
      //      Next(3)!=0）：金鸟 442 1/400 else Next(4) 蓝松鸦 297/红雀 298/鸟 74 ----
      if (this.dayTime && this.world.clock.hourFloat < 9.5 && grassFam && !N(3)) {
        return D(N(400) ? 442 : [297, 298, 74, 74][Math.floor(rng.next() * 4)]);
      }
      // ---- 椿象/蝴蝶（cs:2381-2410）----
      //  门：白昼草族 tile（case 2/109/477/492）+ !TooWindyForButterflies（|windSpeedTarget|
      //  ≥0.4，NPC.cs:6801）+ 无雨 + Next(每夜概率)==0。概率源 = setFireFlyChance
      //  （NPC.cs:94557-94610，每夜 StartNight 掷：4/5 的夜该族为 999999 绝迹哨兵；
      //  世界字段随存档，旧档缺省=代表值 10/绝迹）——原版另有 1/4 概率左右 ±16px
      //  附加只，单返回值 API 只交付 1 只（蜻蜓段同先例）
      if (grassFam) {
        const tooWindyFB = Math.abs(this.world.weather.windSpeedTarget) >= 0.4;
        const dryDay = !this.ctxRaining;
        // 椿象 669（cs:2381-2392）
        if (this.dayTime && !tooWindyFB && dryDay && N(Math.max(1, this.world.stinkBugChance))) return D(669);
        // 蝴蝶 356 / 金蝴蝶 444（cs:2394-2410，金 = RollLuck(goldCritterChance)=1/400）
        if (this.dayTime && !tooWindyFB && dryDay && N(Math.max(1, this.world.butterflyChance))) {
          return D(N(400) ? 444 : 356);
        }
        // 瓢虫 604/605（cs:2413-2445，起风替换支：Next(butterflyChance/2) 取期望 1/5）
        if (this.dayTime && tooWindyFB && dryDay && N(5)) {
          return D(N(400) ? 605 : 604);
        }
        // ---- 鸟表二（NPC.cs:2442-2467：Next(2)==0 无昼夜门——夜间也出鸟）：
        //      金鸟 1/400 else Next(4) 297/298/74/74 ----
        if (N(2)) {
          return D(N(400) ? 442 : [297, 298, 74, 74][Math.floor(rng.next() * 4)]);
        }
        // ---- 尾部表（NPC.cs:2489-2534，无昼夜门）：金兔 443 → 金松鼠 539（各
        //      1/400）→ 万圣 303 / 圣诞 337 / 派对 540（各 2/3）→ 1/3 松鼠
        //      299|538 → 兜底兔 46 ----
        if (N(400)) return D(443);
        if (N(400)) return D(539);
        if (this.world.clock.halloween && !N(3)) return D(303); // 史莱姆兔（BunnySlimed,SW-FX26 补名）
        if (this.world.clock.xMas && !N(3)) return D(337);
        if (this.partyUp && !N(3)) return D(540);
        if (N(3)) return D(rng.next() < 0.5 ? 299 : 538);   // SelectRandom
        return D(46);
      }
    }
    // ---- 地下层友好尾段（NPC.cs:2580-2625 case 2 尾段 else 块；!surfaceSpawn 落点）----
    //  原版按三带分裂：①金兔 443（RL400 无门）；②festival 三支带 !flag11 门——仅
    //  【浅地下】(ws<y<rockLayer) 出 303/337/540，真洞穴层不进；③Next(3) 分派：
    //  浅地下 → 松鼠 SelectRandom(299|538)，洞穴层(flag11) → 1/5 宝石松鼠；
    //  Next(3)!=0 时：浅地下 → 兜底兔 46，洞穴层 → 1/5 宝石兔（掷空则整轮静默空过）。
    //  ★旧实现把浅地下带整个漏掉（只覆盖 ≥rockLayer 的洞穴层半段）
    if (this.spawnFriendlyCycle && !this.waterTile && !this.surfaceSpawn && gemTileOK && !friendlyBlocked) {
      // ★IIIII228 :2555-2560 flag11（宝石带）：经典= [rockLayer, UnderworldLayer]；
      //  remix = (worldSurface, rockLayer) 开区间（remix 宝石小动物整体上移浅地下）
      const deepCaveBand = this.world.seedFlags?.remix
        ? (this.spawnTileY > this.world.groundLevel && this.spawnTileY < this.world.rockLevel)
        : this.spawnTileY >= this.world.rockLevel;
      // ★IIIII228 :2560-2578 地狱带（Y > UnderworldLayer）：remix 起始区
      //  （玩家 X∈(0.39w+50, 0.61w)）1/2 → 宝石松鼠/兔再 1/2 二选；否则
      //  SpawnLavaBaitCritters（653 昼/654 夜+附加/655——原版友好轮地狱臂,
      //  旧实现整带被 h-200 门吞掉,一并按原文补齐）
      if (this.spawnTileY > st.h - 200) {
        const remixStart = this.world.seedFlags?.remix
          && this.playerPx / 16 > st.w * 0.39 + 50 && this.playerPx / 16 < st.w * 0.61;
        if (remixStart && rng.int(0, 1) === 0) {
          return D(rng.int(0, 1) === 0 ? this.getGemSquirrelToSpawn(rng) : this.getGemBunnyToSpawn(rng));
        }
        if (rng.next() < 2 / 3) {
          if (this.dayTime) return D(653);
          this.queueFireflyExtras(rng, 654);
          return D(654);
        }
        return D(655);
      }
      if (N(400)) return D(443);
      if (!deepCaveBand) {
        if (this.world.clock.halloween && !N(3)) return D(303); // 史莱姆兔（BunnySlimed,SW-FX26 补名）
        if (this.world.clock.xMas && !N(3)) return D(337);
        if (this.partyUp && !N(3)) return D(540);
      }
      if (N(3)) {
        if (deepCaveBand) {
          if (N(5)) return D(this.getGemSquirrelToSpawn(rng));
        } else {
          return D(rng.next() < 0.5 ? 299 : 538);
        }
      } else if (deepCaveBand) {
        if (N(5)) return D(this.getGemBunnyToSpawn(rng));
      } else {
        return D(46);
      }
    }
    // 友好轮守卫（SpawnAnNPC :2006 else-if 链语义）：friendly 轮只可能出小动物,
    // 前面各友好分支未命中(落点 tile 不合) → 本轮空过,绝不落入后续敌怪链
    if (this.spawnFriendlyCycle) return null;
    // ---- 地牢（L2536-2706：CheckToSpawnDungeonEnemies :5690-5697 1:1）----
    //  原版 result = inTheDungeon;仅 (drunkWorld || !isThereAWorldSurface) 世界才有
    //  "playerY < dungeonY+40 → false" 的限深门（醉酒/无地表的 remix 类世界）。
    //  本仓恒有 worldSurface 且无 drunkWorld → 门恒开。旧实现把限深门无条件挂上,
    //  玩家在地牢浅层（入口/地表段,dungeonY+40 之上）时整个地牢池不刷怪——错位
    if (this.ZoneDungeon) {
        // 墙变体（L2540-2552）：94/96/98→1、95/97/99→2；RollLuck(7) 重掷（0.9 尺度下 1/7≈1/7）
        const wallA = st.wall[st.idx(this.spawnTileX, this.spawnTileY)];
        const wallB = st.wall[st.idx(this.spawnTileX, this.spawnTileY - 1)];
        let variant = 0;
        if (wallA === 94 || wallA === 96 || wallA === 98 || wallB === 94 || wallB === 96 || wallB === 98) variant = 1;
        if (wallA === 95 || wallA === 97 || wallA === 99 || wallB === 95 || wallB === 97 || wallB === 99) variant = 2;
        // RollLuck(7)==0 → Next(3)∈{0,1,2}（L2551；曾 rng.int(0,3)=Next(4) 多出档 3 →
        // 蓝砖权重虚高 ½）
        if (rollLuck(this.playerLuck, 7, () => rng.next()) === 0) variant = rng.int(0, 2);
        // 未杀骷髅王（flag12）→ 地牢守卫 68（9999 伤，1:1 原版劝退机制）
        if (!this.downedBoss3) return D(68);
        // L2562 机械师(123)：1/5，未救出(!savedMech)+场内唯一+深层门（(ws*4+rl)/5）
        //  ★BJ117-① 门序对齐（1457=1458 NPC.cs:2656 `downedBoss3 && !savedMech &&
        //  Main.rand.Next(5)==0 && ...`）：!savedMech 先于 N(5) 短路——savedMech=true
        //  时本门零掷；旧序 N(5) 先掷 → 同链后续 RNG 消费与原版错一位（产出面等价）
        const hardDungeon = this.hardMode && !!this.world.flags['downed_262']; // downedPlantBoss（世花 262，Game 击杀通用置位链 downed_{id}）
        if (this.downedBoss3 && !this.world.flags['savedMech'] && N(5) && !this.waterTile
          && !any(123)
          && this.spawnTileY > (this.world.groundLevel * 4 + this.world.rockLevel) / 5) {
          return D(123);
        }
        // L2570-2585（1456）=1457:2661-2680 hardDungeon（hardMode && downedPlantBoss）：
        //  1/30 骷髅李 287（BoneLee，NPCID.cs:11643）+ 各墙变体 1/15
        if (hardDungeon && N(30)) return D(287);
        if (hardDungeon && variant === 0 && N(15)) return D(293);
        if (hardDungeon && variant === 1 && N(15)) return D(291);
        if (hardDungeon && variant === 2 && N(15)) return D(292);
        // L2588（1456）=1457:2681：圣骑士 290（Paladin，NPCID.cs:11651；aiStyle 3 射击族）
        //  ——墙变体 0（蓝）专属，场上唯一，1/35（旧注误写"骷髅神枪手"——狙击手=291,
        //  官方 zh-Hans:291 骷髅狙击手/292 骷髅特警/293 骷髅突击手）
        if (hardDungeon && !any(290) && variant === 0 && N(35)) return D(290);
        // L2593（1456）=1457:2686：巨型诅咒头骨 289（Giant Cursed Skull，NPCID.cs:11647）
        //  ——墙变体 1/2（绿/粉），1/30（旧注误写"骷髅突击队长"——突击队长=293，在上方 variant 0 档）
        if (hardDungeon && (variant === 1 || variant === 2) && N(30)) return D(289);
        // L2598：死灵法师族 281-286——1/20 → 281+2(蓝变体)+4(粉变体)+Next(2)，
        //  场上已有该 id 则空过（原版 return，不落后续支）
        if (hardDungeon && N(20)) {
          const necro = 281 + (variant === 0 ? 2 : 0) + (variant === 2 ? 4 : 0) + rng.int(0, 1);
          if (!any(necro)) return D(necro);
          return null;
        }
        // L2616：破布施法者族 269-280——2/3 → 269+4(蓝变体)+8(粉变体)+Next(4)
        if (hardDungeon && !N(3)) {
          return D(269 + (variant === 0 ? 4 : 0) + (variant === 2 ? 8 : 0) + rng.int(0, 3));
        }
        if (N(35)) return D(71);   // 地牢史莱姆
        // :2635（1456）=1457:2728 刺球 70（Spike Ball，NPCID.cs:11205，aiStyle 20）——
        //  绿变体 1/3 且 !NearSpikeBall（1456:90933-90948=1457:91002-91016，落点 ±300px
        //  盒内已有 aiStyle==20 锚点则不出,防堆积；先掷后查序 1:1 勿改）
        if (variant === 1 && N(3) && !this.nearSpikeBall(this.spawnTileX, this.spawnTileY)) return D(70);
        // :2640 火轮 72（Blazing Wheel，NPCID.cs:11209，aiStyle 21）——粉变体 1/5
        //  （旧注释把 70/72 名字写反,已按 NPCID.cs 勘误）
        if (variant === 2 && N(5)) return D(72);
        if (variant === 0 && N(7)) return D(34);   // 诅咒头骨
        if (N(7)) return D(32);    // 黑魔法师
        // ---- 书怪 693/694（NPC.cs:2655-2677）：Next(8)==0 → 694 水书宝箱怪（ai[3]=3
        //      伪装态出生），else Next(10)==0 → 693 图书管理员骷髅；两者都在【书位】出生
        //      （AI_FindNearbyBook :62751：spawnTile−16 起 32×32 窗 closestBook +
        //      屏外门）。掷中但无书（flag13 false）→ 空过落下方 num44 掷（1:1）。
        //      书 = 玩家放置的 tile 50 书（v_50_books，放书架 101 破坏掉书物再放置）。
        if (N(8)) {
          const book = this.findNearestBookForSpawn();
          if (book) {
            const m = this.spawnNPC(book.x * TILE + 8, book.y * TILE, 694, rng);
            if (m) { m.ai3 = 3; return m; }   // SpawnNPC(...,694,0,0,0,0,3f)——伪装态
          }
        } else if (N(10)) {
          const book = this.findNearestBookForSpawn();
          if (book) {
            const m = this.spawnNPC(book.x * TILE + 8, book.y * TILE, 693, rng);
            if (m) return m;
          }
        }
        // L2674：num44 = Next(5) → 0..4（本仓 rng.int 闭区间——此前误写 int(0,5) 多出
        //  第 6 档 undefined id，已改 int(0,4)；case 3/4 落空走下方大小变体支）
        const av = rng.int(0, 4);
        if (av === 0) return D(294);
        if (av === 1) return D(295);
        if (av === 2) return D(296);
        if (N(4)) return D(-14);   // Big Boned
        if (N(5)) return D(-13);   // Short Bones
        return D(31);              // 愤怒骨怪
    }
    // ---- 陨石带（L2704：else if (ZoneMeteor)）----
    //  ZoneMeteor = 玩家窗口内陨石 tile ≥75（SceneMetrics.cs:56 MeteorTileThreshold）→ 陨石头 23
    if (this.ZoneMeteor) return D(23);
    // ---- 月事件（NPC.cs:2714-3455：霜月在先、南瓜月在后，均位于陨石段之后、日食段之前）----
    //  门 = (spawnTileY <= worldSurface || remix) && !dayTime && 事件开启
    //  （★IIIII228 :2807/:3227 remix 或支——remix 全深度月事件）
    if (this.moonEvent && (this.spawnTileY <= this.world.groundLevel || this.world.seedFlags?.remix)
      && !this.dayTime) {
      const pick = this.moonEvent.kind === MOON_KIND_FROST
        ? this.pickFrostMoonSpawn(this.moonEvent.wave, rng)
        : this.pickPumpkinMoonSpawn(this.moonEvent.wave, rng);
      if (pick !== 0) return D(pick);
      return null;   // 波内全部分支落空（霜月 14 波 / 南瓜 19 波 bossCap 后）= 原版空过
    }
    // ---- 日食（NPC.cs:3552-3614：地表 && dayTime && eclipse——1.4.5.6 重做后的全表;BJ591 行号重锚+93）----
    //  门 = spawnTileY <= worldSurface || (remix && Y > rockLayer)（★IIIII228 :3552
    //  remix 深岩层或支——remix 岩石层以下的日食池）；白天 && eclipse；
    //  flag14 = 三机械全杀（downedMechBoss1/2/3 = 134 / 125|126 / 127）
    if ((this.spawnTileY <= this.world.groundLevel
        || (this.world.seedFlags?.remix && this.spawnTileY > this.world.rockLevel))
      && this.dayTime && this.world.clock.eclipse) {
      const f = this.world.flags;
      const downedPlant = !!f['downed_262'];   // downedPlantBoss（世花 262）
      const flag14 = !!(f['downed_134'] && (f['downed_125'] || f['downed_126']) && f['downed_127']);
      // ★SW-FX7（2026-09-10）：原为 activeIds（Set）迭代计数=恒 0/1——原版
      //  CountNPCS(467)<2（NPC.cs:3575）是真计数，2 只在场仍会再放行第 3 只。
      //  改走 Game 注入计数通道（countNpc）。
      const cnt467 = this.countNpc(467);
      if (downedPlant && N(80) && !any(477)) return D(477);    // 飞蛾魔 Mothron（唯一）
      if (N(50) && !any(251)) return D(251);                   // 独眼怪 Eyezor（唯一）
      if (downedPlant && N(5) && !any(466)) return D(466);     // 精神病人 Psycho（唯一）
      if (downedPlant && N(20) && !any(463)) return D(463);    // 钉头 Nailhead（唯一）
      if (downedPlant && N(20) && cnt467 < 2) return D(467);   // 致命球 Deadly Sphere（≤2）
      if (N(15)) return D(159);                                // 吸血鬼 Vampire
      if (flag14 && N(13)) return D(253);                      // 死神 Reaper（需三机械全杀）
      if (N(8)) return D(469);                                 // 被附身者 The Possessed
      if (downedPlant && N(7)) return D(468);                  // 蝇博士 Dr. Man Fly
      if (downedPlant && N(5)) return D(460);                  // 屠夫 Butcher
      if (N(4)) return D(162);                                 // 科学怪人 Frankenstein
      if (N(3)) return D(461);                                 // 深海怪形 Creature from the Deep
      if (N(2)) return D(462);                                 // 弗里茨 Fritz
      return D(166);                                           // 沼泽怪 Swamp Thing（兜底）
    }
    // ---- 地下仙女（NPC.cs:3524-3532 else-if，日食支之后的下一支）：fairyLog 门 +
    //      RollLuck(500[十周年 250]·hardMode×1.66) + 深度窗 + 无跟随仙女 →
    //      Next(583,586) 随机三色（十周年 3/4 固定 583），ai2=2（跟玩家初始态）
    //      ——2026-08-13 前整支缺失 = 倒木只影响地表夜仙女，地下随机仙女永不触发 ----
    if (this.checkToSpawnUndergroundFairy(rng)) {
      const t10 = this.world.seedFlags?.tenthAnniversary && !this.world.seedFlags?.getGoodWorld;
      let fType = 583 + Math.floor(rng.next() * 3);          // Next(583, 586)
      if (t10 && Math.floor(rng.next() * 4) !== 0) fType = 583;
      const fe = this.spawnNPC(this.spawnTileX * TILE + 8, this.spawnTileY * TILE, fType, rng);
      if (fe) fe.ai2 = 2;   // SpawnNPC(..., 2f) 第 9 参 = ai[2]（跟随态基线）
      return fe;
    }
    // ---- 侏儒 624 两支（NPC.cs:3532-3538，仙女段之后蘑菇段之前；gnomeChance=
    //      GetGnomeChance 基档 10[:5281]）----
    //  ★IIIII61 lowTiles 档接入（GetGnomeChance :5383-5405）：空岛低格世界——
    //    remix → 20；否则 ×20（200），场上已有侏儒 624 再 ×20（4000）；remix 尾除 2。
    //    （本支序：lowTiles 臂先于 remix 尾除,掷流同 vanilla 语句序）
    const gnomeDenom = (() => {
      let num = 10;
      if (this.world.skyblockLowTiles) {
        if (this.world.seedFlags?.remix) {
          num = 20;
        } else {
          num *= 20;
          if (this.countNpc(624) > 0) num *= 20;   // AnyNPCs(624)
        }
      }
      if (this.world.seedFlags?.remix) num = Math.floor(num / 2);
      return num;
    })();
    //  ① livingTree 支：非 remix && !waterTile && (夜 || 落脚格有墙) && 玩家所站格
    //    墙 244（SetSpawnFlags :324 livingTree）&& !日食 && !血月 &&
    //    RollLuck(10×3)==0 && CountNPCS(624) <= Next(3)（上限 0-2 只随机）
    //  ② 地下侏儒支（CheckToSpawnUndergroundGnomes :5647-5686）：!ZoneCorrupt &&
    //    !ZoneCrimson && !waterTile && !日食 && !血月 && RollLuck(10)==0 &&
    //    y∈[ws×0.8, ws×1.1] && CountNPCS(624)<=Next(3) && (夜||落脚格墙>0) &&
    //    落脚格墙∈{2,63,196,197,198,199}
    const gnWall = st.wall[st.idx(this.spawnTileX, this.spawnTileY)];
    const gnNightOrWall = !this.dayTime || gnWall > 0;
    const gnEvOK = !this.world.clock.eclipse && !this.world.clock.bloodMoon;
    const gnCap = () => this.countNpc(624) <= rng.int(0, 2);   // Next(3)
    if (!this.world.seedFlags?.remix && !this.waterTile && gnNightOrWall
      && st.wall[st.idx(this.pX, this.pY)] === 244 && gnEvOK
      && rollLuck(this.playerLuck, gnomeDenom * 3, () => rng.next()) === 0 && gnCap()) {
      return D(624);
    }
    // 地下侏儒带（★IIIII228 :5763-5770 remix 重定义）：经典 [ws×0.8, ws×1.1]；
    // remix [maxTilesY×0.6×0.95, maxTilesY-350]——侏儒带整体下沉到深岩层
    const gnBandLow = this.world.seedFlags?.remix
      ? st.h * 0.6 * 0.949999988079071
      : this.world.groundLevel * 0.800000011920929;
    const gnBandHigh = this.world.seedFlags?.remix
      ? st.h - 350
      : this.world.groundLevel * 1.100000023841858;
    if (!this.ZoneCorrupt && !this.ZoneCrimson && !this.waterTile && gnEvOK
      && rollLuck(this.playerLuck, gnomeDenom, () => rng.next()) === 0
      && this.spawnTileY >= gnBandLow && this.spawnTileY <= gnBandHigh
      && gnCap() && gnNightOrWall
      && (gnWall === 2 || gnWall === 63 || (gnWall >= 196 && gnWall <= 199))) {
      return D(624);
    }
    // ---- 蘑菇地（L3540-3610，tile 70；三支 else-if 1:1）----
    if (t === T.MUSHROOM_GRASS) {
      // :3540 水支：hard && tile 70 && waterTile → 真菌鱼 256（在水池段之后才可达）
      if (hardMode && this.waterTile) return D(256);
      // :3544 地表支：tile 70 && y<=worldSurface && Next(3)!=0（2/3 通过——
      //  旧实现外层门写成 N(3) 恰好取反,且内层五支只剩两支）
      if (this.spawnTileY <= this.world.groundLevel && !N(3)) {
        // 发光蜗牛 360（critter）：肉前 1/6 || 困难 1/12（同层双门,原版即如此）
        if ((!hardMode && N(6)) || N(12)) return D(360);
        if (N(3)) {
          // :2552 真菌球茎族（锚点格随 spawn 传 ai0/ai1）：1/4 命中后 hard 2/3 出大 260
          if (N(4)) {
            return this.spawnNPC(x, y, hardMode && !N(3) ? 260 : 259, rng, this.spawnTileX, this.spawnTileY);
          }
          return D(N(2) ? 257 : 258);   // 异腹真菌蟹 257 / 蘑菇瓢虫 258
        }
        // :2572 僵尸蘑菇 254 / 僵尸蘑菇帽 255（255 无 json 条目 → null,登记台账）
        return D(N(2) ? 254 : 255);
      }
      // :3581 洞穴支：tile 70 && hard && y>=worldSurface && Next(3)!=0（2/3;
      //  ★IIIII228 :3674 第三合取项 !remix||getGood||y<h-360——remix 深度 360 格
      //  以内不出困难蘑菇池,掷序在 Next(3) 之后与原文 && 链一致）。
      if (hardMode && this.spawnTileY >= this.world.groundLevel && !N(3)
        && (!this.world.seedFlags?.remix || this.world.seedFlags?.getGoodWorld
          || this.spawnTileY < st.h - 360)) {
        //  肉前穿透本段落入洞穴主池/兜底段,由 L5010/5109 的 ZoneGlowshroom 门出 635/634
        // :3583 松露虫 374（hard 门内即 RollLuck(5)≈1/5,渔夫任务诱饵 critter）
        if (N(5)) return D(374);
        // :3587 发光蜗牛 360：肉前 1/4 支在 hard 门内是死码 → 实际 1/8
        if (N(8)) return D(360);
        if (N(4)) {
          return this.spawnNPC(x, y, hardMode && !N(3) ? 260 : 259, rng, this.spawnTileX, this.spawnTileY);
        }
        return D(N(2) ? 257 : 258);
      }
    }
    // ---- Devourer（NPC.cs:3611-3621，蘑菇地段之后、稀有元素段之前）----
    //  门：ZoneCorrupt && Next(maxValue)==0 && !noWorms && CanSpawnDevourer(spawnTileX)。
    //  maxValue=65（L1193；remixWorld+地表恶地时 25——★IIIII228 已实装,见下）。
    //  CanSpawnDevourer（L5478-5492）：!infectedSeed → 恒 true；本仓无种子系统
    //  （恒非 infectedSeed）→ 恒 true（teamBasedSpawnsSeed/距出生点 0.08w 两分支不可达）。
    //  出怪：hardMode && Next(4)!=0（3/4）→ 98 探求者头；else 7 吞噬怪头
    // maxValue（L1193，★IIIII228 :1289）：65；remix && 玩家格 <worldSurface && 恶地 → 25
    const maxValue = this.world.seedFlags?.remix && this.pY < this.world.groundLevel
      && (this.ZoneCorrupt || this.ZoneCrimson) ? 25 : 65;
    if (this.ZoneCorrupt && N(maxValue) && !this.noWorms && this.canSpawnDevourer()) {
      if (hardMode && !N(4)) return D(98);
      return D(7);
    }
    // ---- 洞穴稀有怪/小动物（L3644-3719；原版位于蘑菇地之后、丛林草之前）----
    //  RollLuck(n)（Luck.RollLuck(player.luck, n)——luck 0 中性=Next(n)，正运收窄
    //  1/(n-luck·n)、负运放宽；rollLuck 已导入）；goldCritterChance=400
    // ★IIIII228 :3715-3725 remix 肉前地下稀有怪臂（skyblock 臂的 remix 镜像——
    //  remix && !hard && Y>worldSurface && RollLuck(100)==0 → ZoneSnow?629:85）
    if (this.world.seedFlags?.remix && !hardMode
      && this.spawnTileY > this.world.groundLevel
      && rollLuck(this.playerLuck, 100, () => rng.next()) === 0) {
      return this.ZoneSnow ? D(629) : D(85);
    }
    // L3726：★空岛低格世界肉前稀有怪臂：lowTiles && !remix && !hard &&
    //  y>rockLayer && RollLuck(100)==0 && 场上无 85/629 → ZoneSnow?629:85——
    //  困难前的 lowTiles 世界唯二"地下稀有怪"来源，此前整支缺失
    if (this.world.skyblockLowTiles && !this.world.seedFlags?.remix && !hardMode
      && this.spawnTileY > this.world.rockLevel
      && rollLuck(this.playerLuck, 100, () => rng.next()) === 0
      && !any(85) && !any(629)) {
      return this.ZoneSnow ? D(629) : D(85);
    }
    // L3644：hard && y>worldSurface && RollLuck(十周年?50:75) → 群系稀有元素怪。
    //  473/474/475 与 629 若 json 缺条目则 fromVanilla→null 静默丢弃，
    //  实际可达的只有兜底 85（hellstone turtle）；分支按原版顺序保留
    const rareRoll = rollLuck(this.playerLuck, this.world.seedFlags?.tenthAnniversary ? 50 : 75, () => rng.next());
    if (hardMode && this.spawnTileY > this.world.groundLevel && rareRoll === 0) {
      if (N(2) && this.ZoneCorrupt && !any(473)) return D(473);
      if (N(2) && this.ZoneCrimson && !any(474)) return D(474);
      if (N(2) && this.ZoneHallow && !any(475)) return D(475);
      // 476 仅十周年世界（L3657 `Main.tenthAnniversaryWorld && Next(2)`——曾缺此门，
      // 普通世界丛林也出 476）
      if (this.world.seedFlags?.tenthAnniversary && N(2) && this.ZoneJungle && !any(476)) return D(476);
      if (this.ZoneSnow) return D(629);
      return D(85);
    }
    // L3671：hard && 落脚墙 2（天然泥土墙）&& 1/20 → 85
    if (hardMode && wall === 2 && N(20)) return D(85);
    // L3676：hard && 地表 && 夜 && (1/20 或 满月 1/5) → 狼人 82
    if (hardMode && this.surfaceSpawn && !this.dayTime
      && (N(20) || (N(5) && this.world.clock.moonPhase === 4))) return D(82);
    // L3681：丛林草 && RollLuck(500) && 夜 → 骨头博士 52(稀有,jungle 金表前置)
    if (t === T.JUNGLE_GRASS && N(500) && !this.dayTime) return D(52);
    // L3688：丛林草 && y>worldSurface && 1/60 → 龟甲虫 219
    if (t === T.JUNGLE_GRASS && this.spawnTileY > this.world.groundLevel && N(60)) return D(219);
    // L3690-3719：洞穴白天小动物（earthworm/mouse/grasshopper 族），条件排除群系旗标。
    //  原版只看 Zone 旗标；直接调用 spawnAnNPC 的场景（测试/探针）旗标未刷新恒 false，
    //  丛林草等群系 tile 会误漏小动物 → 补 tile 级守卫（现实世界群系 tile 必在对应
    //  Zone 窗口内，行为与原版等价）
    const neutralCave = t !== T.JUNGLE_GRASS;
    const critGates = this.spawnTileY > this.world.groundLevel
      && !this.ZoneSnow && !this.ZoneCrimson && !this.ZoneCorrupt && !this.ZoneJungle && !this.ZoneHallow
      && neutralCave;
    if (critGates && this.spawnTileY < st.h - 210 && N(8)) return D(N(400) ? 448 : 357);
    if (critGates && this.spawnTileY < st.h - 210 && N(13)) return D(N(400) ? 447 : 300);
    if (neutralCave && this.spawnTileY > this.world.groundLevel
      && this.spawnTileY < (this.world.rockLevel + st.h) / 2
      && !this.ZoneSnow && !this.ZoneCrimson && !this.ZoneCorrupt && !this.ZoneHallow && N(13)) return D(359);
    // ---- 丛林四支（NPC.cs:3713-3830，原版序：地表小动物→蜂巢块→困难草池→神庙砖→蜂巢墙）----
    // L3713 地表丛林小动物：surfaceSpawn && ZoneJungle && !ZoneCrimson && !ZoneCorrupt && 1/7 →
    //  白天前半（dayTime && Main.time<43200 = 4:30-16:30）且 2/3 → Next(5) 金刚鹦鹉族 671-675；
    //  其余 SpawnFrog（蛙 361 / 金蛙 445 1/400 / 绑缚黄史莱姆 687 1/30 未解锁门）
    if (this.surfaceSpawn && this.ZoneJungle && !this.ZoneCrimson && !this.ZoneCorrupt && N(7)) {
      if (this.dayTime && this.world.clock.hourFloat < 16.5 && !N(3)) {
        return D([671, 672, 673, 674, 675][rng.int(0, 4)]);
      }
      return this.spawnFrog(rng);
    }
    // case 60 落脚开关（NPC.cs:2249-2270 友好轮丛林草落脚）：白天 2/3 鹦鹉族 /
    // 其余 SpawnFrog——补 ZoneJungle 旗外的丛林草落脚覆盖（zone 边缘带）
    if (this.spawnFriendlyCycle && this.surfaceSpawn && t === T.JUNGLE_GRASS) {
      if (this.dayTime && !N(3)) return D([671, 672, 673, 674, 675][rng.int(0, 4)]);
      return this.spawnFrog(rng);
    }
    // L3741 蜂巢块 225 落脚（tile 门，区别于 L3832 蜂巢墙 86）：1/2 →
    //  hard 3/4 苔藓黄蜂族（-21/-20/-19/-18 各 1/10，兜底 176），else SpawnHornet
    if (t === T.HIVE && N(2)) {
      if (hardMode && !N(4)) {
        if (N(10)) return D(-21);
        if (N(10)) return D(-20);
        if (N(10)) return D(-19);
        if (N(10)) return D(-18);
        return D(176);
      }
      return this.spawnHornet(x, y, rng);
    }
    // L3771 困难丛林草 60 主池（tile 60 && hard && 2/3）：地表夜 1/3→152 巨型飞狐 /
    //  地表昼 3/4→177 蹦蹦兽 / 深层 1/100→205 飞蛾 / 深层 1/5→236 丛林爬行者 /
    //  深层 3/4→苔藓黄蜂族 / 1/3→175 愤怒捕兽草(锚点) / else 153 巨龟
    if (t === T.JUNGLE_GRASS && hardMode && !N(3)) {
      if (this.surfaceSpawn && !this.dayTime && N(3)) return D(152);
      if (this.surfaceSpawn && this.dayTime && !N(4)) return D(177);
      if (this.spawnTileY > this.world.groundLevel && N(100)) return D(205);
      if (this.spawnTileY > this.world.groundLevel && N(5)) return D(236);
      if (this.spawnTileY > this.world.groundLevel && !N(4)) {
        if (N(10)) return D(-21);
        if (N(10)) return D(-20);
        if (N(10)) return D(-19);
        if (N(10)) return D(-18);
        return D(176);
      }
      if (N(3)) return this.spawnNPC(x, y, 175, rng, this.spawnTileX, this.spawnTileY);
      return D(153);
    }
    // L3821 神庙砖 226/232 && ZoneLihzhardTemple（玩家所站格墙 87，SceneMetrics.cs:688）
    //  ★IIIII228 :3914 remix 或支：remix 世界神庙 Zone 内任意落脚出蜥蜴人池
    //  → 1/3 飞蛇 226 / else 蜥蜴人 198
    if (((t === T.LIHZAHRD_BRICK || t === T.WOODEN_SPIKE) || this.world.seedFlags?.remix)
      && this.zoneLihzardTemple()) {
      return D(N(3) ? 226 : 198);
    }
    // ---- 蜂巢墙 86（NPC.cs:3833-3835）：7/8 SpawnHornet ----
    if (wall === 86 && !N(8)) return this.spawnHornet(x, y, rng);
    // ---- 丛林草 tile 60（NPC.cs:3839-3856；旧实现误在肉前出 158 巨型蝙蝠，原版无此分支）----
    //  ★IIIII228 :3929 remix 或支：remix 门 = Y<rockLayer（全浅带）|| Next(2)==0
    //  （深岩层带 1/2）——Next(2) 只在 Y>=rockLayer 时消费（&& 短路序 1:1）
    if (t === T.JUNGLE_GRASS) {
      const midY = (this.world.groundLevel + this.world.rockLevel) / 2;
      const remixDeepGate = this.world.seedFlags?.remix
        ? (this.spawnTileY < this.world.rockLevel || rng.int(0, 1) === 0)
        : false;
      if ((!this.world.seedFlags?.remix && this.spawnTileY > midY) || remixDeepGate) {
        // 深层丛林：1/4 棘刺丛林史莱姆 / 1/4 食人怪(锚点) / else 黄蜂族
        if (N(4)) return D(204);
        if (N(4)) return this.spawnNPC(x, y, 43, rng, this.spawnTileX, this.spawnTileY);
        return this.spawnHornet(x, y, rng);
      }
      // 浅层：1/4 丛林蝙蝠 / 1/8 魔腾怪(锚点)
      if (N(4)) return D(51);
      if (N(8)) return this.spawnNPC(x, y, 56, rng, this.spawnTileX, this.spawnTileY);
    }
    // ---- 沙尘暴怪池（NPC.cs:3859-3928 1:1）----
    //  门（:3859 四合取）：Happening && ZoneSandstorm && TileID.Sets.Conversion.Sand
    //  （TileID.cs:30 = 53/112/116/234 四沙——旧 tile 集误混入 397 硬化沙/396 沙岩
    //   且漏 112/116/234 三色沙）&& Spawning_SandstoneCheck（成片沙面计数 ≥40——
    //   孤沙/零星沙不刷,此前缺失致误刷）
    if (this.sandstormHappening && this.zoneSandstorm && TILE_SAND.has(t)
      && this.spawningSandstoneCheck(this.spawnTileX, this.spawnTileY)) {
      // :3861 肉前支带 !downedBoss1（克眼）——杀过克眼但未入困难时落到下方 hard 池的
      //  肉前可达段（mummy/shark 门全 false → 走 546/580/581 兜底）
      const downedBoss1 = !!this.world.flags['downed_4'] || !!this.world.flags.downedEyeOfCthulhu;
      if (!downedBoss1 && !hardMode) {
        if (N(2)) return D(546);      // 怒滚虫 546
        if (N(2)) return D(61);       // 秃鹫
        return D(69);                 // 蚁狮
      }
      // :3876 沙尘元素 541：hard && 1/20 && 场上唯一
      if (hardMode && N(20) && !any(541)) return D(541);
      // :3880 沙丘穿刺者 510：hard && !noWorms && 1/3 && CountNPCS(510)<4,
      //  落点在落脚格**下方 10 格**（(spawnTileY+10)*16——钻地虫从沙下钻出）
      if (hardMode && !this.noWorms && N(3) && this.countNpc(510) < 4) {
        return this.spawnNPC(x, (this.spawnTileY + 10) * TILE, 510, rng);
      }
      // :3884 沙鲨族：hard && !noWorms && 1/2 → 按落脚沙换色（门内 tile 恒在四沙集,
      //  直接判 id：542 沙/543 腐化/544 猩红/545 神圣）
      if (hardMode && !this.noWorms && N(2)) {
        if (t === T.EBONSAND) return D(543);
        if (t === T.CRIMSAND) return D(544);
        if (t === T.PEARLSAND) return D(545);
        return D(542);
      }
      // :3901 沙尘内木乃伊四支（各 1/3——与主链 :3930 的 53→1/3 其余 1/2 不同）
      if (hardMode && t === T.SAND && N(3)) return D(78);
      if (hardMode && t === T.EBONSAND && N(3)) return D(79);
      if (hardMode && t === T.CRIMSAND && N(3)) return D(630);
      if (hardMode && t === T.PEARLSAND && N(3)) return D(80);
      // :3917 兜底池：1/2 怒滚虫 546 → 1/2 步行蚁狮 580 → 飞行蚁狮 581
      if (N(2)) return D(546);
      if (N(2)) return D(580);
      return D(581);
    }
    // ---- 沙漠地表木乃伊（NPC.cs:3930-3944，主链层——位于昼夜池之前，昼夜皆可出）----
    //  蚁狮/秃鹫不在此段：原版在昼池（L4374-4381），夜间沙地走僵尸族（见下方 surfaceSpawn 段）
    if (hardMode && t === T.SAND && N(3)) return D(78);       // 木乃伊（黄沙 1/3）
    if (hardMode && t === T.EBONSAND && N(2)) return D(79);   // 黑暗木乃伊（黑檀沙 1/2）
    if (hardMode && t === T.CRIMSAND && N(2)) return D(630);  // 血腥木乃伊（猩红沙 1/2；json 缺 630 → null，登记台账）
    if (hardMode && t === T.PEARLSAND && N(2)) return D(80);  // 光明木乃伊（珍珠沙 1/2）
    // ---- 神圣 tiles（L3946-3971，tile 116 珍珠沙/117 珍珠石/109 神圣草/164 粉冰）----
    //  旧"hard && 珍珠沙 && 1/2 → 80"独立支系误标 L3940——原版唯一的 116→80 门就在
    //  上方木乃伊块 L3942，此处保留即重复出怪，已删
    const hallowFloor = t === T.PEARLSAND || t === T.PEARLSTONE_BLOCK
      || t === T.HALLOW_GRASS || t === T.HOLLOW_ICE;
    // L3946：hard && underGround && !waterTile && 神圣 tile → 段内顺序 1:1（原版 661 首支）
    //  ①月神蝶 661：downedPlantBoss && 夜前半(!dayTime && Main.time<16200 = 19:30-24:00)
    //    && surfaceSpawn && RollLuck(10) && 场上无 661——与外层 underGround 门交集即
    //    血月/日食强制地表化（L1146-1153）时段（原版即此怪癖，照抄）
    //  ②雨天彩虹史莱姆 244（唯一，RollLuck(10)；NPCID.cs:11553 RainbowSlime——旧注
    //    误标"附魔夜爬虫"）③夜毒气鼻涕虫 122（1/2）
    //  ④独角兽 86：1/10，ZoneWaterCandle 再给一次独立 1/10（:3960 双掷 || 短路）
    //  ⑤兜底妖精 75
    // ★IIIII228 :4039 remix 或支：remix 世界 1/2 掷进入本池（Next(2) 先于
    //  !waterTile 消费,与原文 && 链一致——(hard&&underGround) || (remix&&Next(2)==0)）
    const hallowGate = (hardMode && this.underGround)
      || (!!(this.world.seedFlags?.remix) && rng.int(0, 1) === 0);
    if (hallowGate && !this.waterTile && hallowFloor) {
      const downedPlant = !!this.world.flags['downed_262'];
      // ★夜前半上界：Main.time<16200 = 午夜 24:00（夜晚独立时间轴，Midnight 命令
      //  实证 time=16200）→ hourFloat ∈ [19.5, 24)。曾缺上界整夜可出。
      //  RollLuck(10) 非 Next(10)（luck 收窄/放宽）
      // ★IIIII228 :4041 remix 或支：remix 豁免夜前半时段门（保留 surfaceSpawn/RollLuck/唯一门）
      if (downedPlant && (this.world.seedFlags?.remix
        || (!this.dayTime && this.world.clock.hourFloat >= 19.5 && this.world.clock.hourFloat < 24))
        && this.surfaceSpawn && rollLuck(this.playerLuck, 10, () => rng.next()) === 0 && !any(661)) return D(661);
      if (this.ctxRaining && !any(244) && rollLuck(this.playerLuck, 10, () => rng.next()) === 0) return D(244);
      if (!this.dayTime && N(2)) return D(122);
      // :3960 Next(10)==0 || (ZoneWaterCandle && Next(10)==0)：水蜡烛下独角兽双掷
      if (N(10) || (this.zoneWaterCandle && N(10))) return D(86);
      return D(75);
    }
    // L3962：hard && 1/50 && !waterTile && 岩石层下 && 神圣 tile → 神圣噬魂怪 84
    if (!this.noWorms && hardMode && N(50) && !this.waterTile && this.deeperThanRockLayer && hallowFloor) {
      return D(84);
    }
    // ---- 猩红（L3973-4031 1:1）----
    //  落脚 tile 门：=(204 猩红矿 && ZoneCrimson) || 199 猩红草 || 200 红冰 || 203 猩红石
    //  || 234 猩红沙 || 662 猩红丛林草（remix 195 省略）——原版是 tile 门不是 Zone 门，
    //  旧实现 ZoneCrimson 整段拦截会把腐化边界/猩红矿脉外的怪全劫持进猩红池
    const crimsonFloor = (t === T.CRIMTANE && this.ZoneCrimson) || t === T.CRIMSON_GRASS
      || t === T.CRIMSON_ICE || t === T.CRIMSTONE || t === T.CRIMSAND || t === T.CRIMSON_JUNGLE_GRASS
      // ★IIIII228 :4066 remix 或支：195 血肉块（TileID.FleshBlock,TileID.cs:692）
      || (!!this.world.seedFlags?.remix && t === T.FLESH_BLOCK);
    if (crimsonFloor) {
      // flag15 = 落脚深于岩石层（★IIIII228 :4069 remix 反转 = Y <= rockLayer）
      const flag15 = this.world.seedFlags?.remix
        ? this.spawnTileY <= this.world.rockLevel
        : this.spawnTileY >= this.world.rockLevel;
      // 分层（前四支是 hard+深层专属，肉前不可达）：
      //  ①hard && flag15 && 1/40 && !noWorms → 179 猩红斧（墙挂怪）
      //  ②hard && flag15 && 1/5 && !noWorms → 182 浮空恶臭
      //  ③hard && flag15 && 1/2 → 268 弱金史莱姆（旧实现无 hard/深层门，肉前误出）
      //  ④hard && 1/3 → 小/大 Crimslime(-24/-25 各 1/3) / 183 Crimslime
      //  ⑤hard && (1/2 || 深于地表) → 174 跳跳兽
      //  ⑥(落脚墙>0 && 3/4) || 1/8 → 239 血爬虫（旧实现缺失）
      //  ⑦1/2 → 181 脸怪  ⑧/⑨各 1/3 → -22/-23 小/大 Crimera  ⑩兜底 173 Crimera
      if (hardMode && flag15 && N(40) && !this.noWorms) return D(179);
      if (hardMode && flag15 && N(5) && !this.noWorms) return D(182);
      if (hardMode && flag15 && N(2)) return D(268);
      if (hardMode && N(3)) {
        if (N(3)) return D(-24);
        if (N(3)) return D(-25);
        return D(183);
      }
      // ★IIIII224（NPC.cs:4100）：174 臂第二析取支带 !remixWorld 门——remix 世界
      //  只走 1/2 掷（否则 remix 地表带 174 过密）
      if (hardMode && (N(2) || (this.spawnTileY > this.world.groundLevel && !this.world.seedFlags?.remix))) return D(174);
      if ((wall > 0 && !N(4)) || N(8)) return D(239);
      if (N(2)) return D(181);
      if (N(3)) return D(-22);
      if (N(3)) return D(-23);
      return D(173);
    }
    // ---- 腐化(NPC.cs:4032-4074 一比一)----
    // 门禁 = 落脚面 tile:(22 魔矿 && ZoneCorrupt) || 腐化草 23 || 黑檀石 25 || 黑沙 112
    // || 腐化冰 163 || 腐化丛林草 661（旧实现的 T.SAND&&ZoneCorrupt 是 22 的误标，661 漏列）。
    // 攀爬者 101 仅困难模式+岩石层下 1/3,锚点格随 spawn 传入
    const corruptFloor = (t === T.DEMONITE && this.ZoneCorrupt) || t === T.CORRUPT_GRASS
      || t === T.EBONSTONE || t === T.EBONSAND || t === T.CORRUPT_ICE || t === T.CORRUPT_JUNGLE_GRASS
      // ★IIIII228 :4125 remix 或支：474 病变块（TileID.LesionBlock,TileID.cs:4778）
      || (!!this.world.seedFlags?.remix && t === T.LESION_BLOCK);
    // flag16（★IIIII228 :4128 remix 反转 = Y <= rockLayer）
    const ugRock = this.world.seedFlags?.remix
      ? this.spawnTileY <= this.world.rockLevel
      : this.spawnTileY >= this.world.rockLevel;
    if (corruptFloor) {
      // 83 = Cursed Hammer 诅咒锤（NPCID.cs:11231；旧注"World Feeder"有误——1.4.4 起
      //  World Feeder 头是 98，在上方 Devourer 段）。门带 !noWorms（L4039，此前漏）
      if (hardMode && ugRock && N(40) && !this.noWorms) return D(83);
      if (hardMode && ugRock && N(3)) {
        return this.spawnNPC(x, y, 101, rng, this.spawnTileX, this.spawnTileY); // 攀爬者(锚点格)
      }
      if (hardMode && N(3)) return D(N(3) ? 121 : 81);     // 史莱姆法师/腐化史莱姆
      if (hardMode && (N(2) || ugRock)) return D(94);      // 腐化史莱姆
      if (N(3)) return D(-11);   // 小噬魂怪
      if (N(3)) return D(-12);   // 大噬魂怪
      return D(6);               // 默认 Eater of Souls
    }
    // ---- ★BJ356 DD2 生成抑制门（NPC.cs:2803-2805）----
    //  原版在缺省 else 链头：`if (DD2Event.Ongoing && ZoneOldOneArmy) return;`——
    //  事件进行中且扫描玩家距任一门 549 ≤4000px（250 格）→ 本轮**零自然生成**。
    //  群系专属分支（丛林/地牢/猩红/腐化/陨石等）在其上不受门限=原版同序（门只护
    //  缺省地表/地下选择面）。★曾整门缺席=事件期竞技场周边混刷普通怪 → 普通怪
    //  接触伤水晶（水晶受击通道 vanilla 合法,但原版靠本门+Zone 抑制把接触面压到近零）
    if (this.dd2Ongoing && this.zoneDD2) return null;
    // ---- 地表（L4075-4717）----
    //  群系判定：雪原不走 ZoneSnow 旗标兜底段——原版白昼走小动物/基础史莱姆，
    //  夜晚走 IcesSnow 落脚 tile 段（L4555），此前的 ZoneSnow 拦截段为误植已移除
    if (this.surfaceSpawn) {
      const clock = this.world.clock;
      const raining = this.ctxRaining;
      const moonPhase = clock.moonPhase;
      // TileID.Sets.IcesSnow（TileID.cs:297：161/200/163/164/147）+ 162
      const iceTile = t === T.ICE || t === T.CRIMSON_ICE || t === T.CORRUPT_ICE
        || t === T.HOLLOW_ICE || t === T.SNOW || t === T.THIN_ICE;
      // ---- 墓地蛆/鼠（L4082-4091，surfaceSpawn 段首、昼池之前）----
      //  ZoneGraveyard && !waterTile && 草族落脚（2/477）&& 1/10 → 50/50 蛆 606 / 鼠 610
      if (this.ZoneGraveyard && !this.waterTile && (t === T.GRASS || t === T.MOWED_GRASS) && N(10)) {
        return D(N(2) ? 610 : 606);
      }
      // ---- L4094-4108：雨雪高仑/雨云怪/火星探测器（surfaceSpawn 段首、昼池之前，昼夜皆可出）----
      //  L4094 冰雪高仑 243：ZoneSnow && hard && raining && 场上无 243 && RollLuck(20)
      if (this.ZoneSnow && hardMode && raining && !any(243) && N(20)) return D(243);
      //  L4099 雨云怪 250：!ZoneSnow && hard && raining && CountNPCS(250)<2 && 1/10
      if (!this.ZoneSnow && hardMode && raining && this.countNpc(250) < 2 && N(10)) return D(250);
      //  L4170-4201 火星探测器 399 地表支（区别于天空支）：远离世界中央（flag17）&&
      //  无危险态（AnyDanger→flag17=false，:4171-4174，Game 喂入 anyDangerCtx）&& hard
      //  && downedGolemBoss && ((未败火星 && 1/100) || 1/400) && 场上无 399
      let flag17 = Math.abs(this.spawnTileX - st.w / 2) / (st.w / 2) > 0.33;
      if (flag17 && this.anyDangerCtx) flag17 = false;
      if (flag17 && hardMode && this.world.flags['downed_245']
        && ((!this.world.flags['downedMartians'] && N(100)) || N(400)) && !any(399)) {
        return D(399);
      }
      // ---- 白昼（L4109-4435：!ZoneGraveyard && dayTime 大昼池）----
      //  ★墓地白天整体跳过昼池（原版门即 !ZoneGraveyard && Main.dayTime）→ 白天也落入
      //  夜间怪池（僵尸/眼球等）——"墓地白天刷夜怪"的本体语义；昼池兜底基础史莱姆同理不刷
      if (this.dayTime && !this.ZoneGraveyard) {
        // num46 = |落脚 x - 世界出生点 x|（L4108）
        const num46 = Math.abs(this.spawnTileX - this.world.spawnX);
        // ---- 昼池 critter 链（NPC.cs:4110-4266，敌怪轮版——友好轮 case 2 链的
        //      姊妹分支；门 = !waterTile && num46<图宽/2 && Next(15)==0 &&
        //      落脚∈{2,477,109,492,147,161}）----
        const dayGrassTiles = t === T.GRASS || t === T.MOWED_GRASS || t === T.HALLOW_GRASS
          || t === T.HALLOW_MOWED_GRASS || t === T.SNOW || t === T.ICE;
        const gold = () => rollLuck(this.playerLuck, 400, () => rng.next()) === 0;
        if (!this.waterTile && num46 < st.w / 2 && N(15) && dayGrassTiles) {
          // 雪/冰落脚（:4117）：50/50 企鹅 148/149
          if (t === T.SNOW || t === T.ICE) {
            return D(N(2) ? 148 : 149);
          }
          const tooWindyFB = Math.abs(this.world.weather.windSpeedTarget) >= 0.4;
          const dryDay = !raining;
          // 椿象 669（:4125）：!tooWindy&&!rain&&Next(stinkBugChance)==0&&surfaceSpawn
          //  + 1/4 左/右 ±16px 附加只
          if (!tooWindyFB && dryDay && N(Math.max(1, this.world.stinkBugChance)) && this.surfaceSpawn) {
            const b = D(669);
            if (N(4)) this.pendingCritterExtras.push({ npc: 669, dx: -16, dy: 0 });
            if (N(4)) this.pendingCritterExtras.push({ npc: 669, dx: 16, dy: 0 });
            return b;
          }
          // 蝴蝶 356/金 444（:4136）：RollLuck(400) 金 else 356 + 1/4 左右附加 356
          if (!tooWindyFB && dryDay && N(Math.max(1, this.world.butterflyChance)) && this.surfaceSpawn) {
            const b = D(gold() ? 444 : 356);
            if (N(4)) this.pendingCritterExtras.push({ npc: 356, dx: -16, dy: 0 });
            if (N(4)) this.pendingCritterExtras.push({ npc: 356, dx: 16, dy: 0 });
            return b;
          }
          // 起风瓢虫 604/金 605（:4153-4185）：Next(butterflyChance/2)==0（review 批
          //  修正：随每日掷的 butterflyChance 收敛——曾写死 1/5，仅 butterfly=10 日等价）+
          //  四段附加（2/3+1/2+1/3+1/4 逐只 604）
          if (tooWindyFB && dryDay && N(Math.max(1, Math.floor(this.world.butterflyChance / 2)))
            && this.surfaceSpawn) {
            const b = D(gold() ? 605 : 604);
            if (!N(3)) this.pendingCritterExtras.push({ npc: 604, dx: 0, dy: 0 });
            if (N(2)) this.pendingCritterExtras.push({ npc: 604, dx: 0, dy: 0 });
            if (N(3)) this.pendingCritterExtras.push({ npc: 604, dx: 0, dy: 0 });
            if (N(4)) this.pendingCritterExtras.push({ npc: 604, dx: 0, dy: 0 });
            return b;
          }
          // 金兔 443 / 金松鼠 539（:4186-4192）
          if (gold()) return D(443);
          if (gold() && this.spawnTileY <= this.world.groundLevel) return D(539);
          // 节日档（:4193-4204）：万圣 303 史莱姆兔 / 圣诞 337 / 派对 540（各 Next(3)!=0）
          if (this.world.clock.halloween && !N(3)) return D(303); // 史莱姆兔（BunnySlimed,SW-FX26 补名）
          if (this.world.clock.xMas && !N(3)) return D(337);
          if (this.partyUp && !N(3)) return D(540);
          // 1/3 松鼠（SelectRandom 299|538）/ else 兔 46（:4205-4210）
          if (N(3)) return D(rng.next() < 0.5 ? 299 : 538);
          return D(46);
        }
        // ---- 海滩内带蝎（:4215）：!waterTile && beachX<x<w-beachX（内带,不含
        //      海岸线）&& Next(12)==0 && 落脚=黄沙 → Next(366,368)=366|367 ----
        if (!this.waterTile && this.spawnTileX > 380 && this.spawnTileX < st.w - 380
          && N(12) && t === T.SAND) {
          return D(rng.next() < 0.5 ? 366 : 367);
        }
        // ---- 香蒲蜻蜓（:4221-4233）：草沙落脚{2,477,53} && !tooWindy && !rain &&
        //      Next(3)!=0 && y<=worldSurface && FindCattailTop（±30×±20 加权采样）
        //      → 金 601 else RollDragonflyType + 1/3 左右附加 ----
        if ((t === T.GRASS || t === T.MOWED_GRASS || t === T.SAND)
          && Math.abs(this.world.weather.windSpeedTarget) < 0.4 && !raining
          && !N(3) && (this.spawnTileY <= this.world.groundLevel || this.world.seedFlags?.remix)) {  // ★IIIII228 :4309
          const ct = this.findCattailTop(this.spawnTileX, this.spawnTileY, rng);
          if (ct) {
            const main = gold() ? 601 : this.rollDragonflyType(t, rng);
            const b = this.spawnNPC(ct.x * TILE + 8, ct.y * TILE, main, rng);
            if (N(3)) this.pendingCritterExtras.push({ npc: this.rollDragonflyType(t, rng), dx: 0, dy: 0, ax: ct.x * TILE + 8 - 16, ay: ct.y * TILE });
            if (N(3)) this.pendingCritterExtras.push({ npc: this.rollDragonflyType(t, rng), dx: 0, dy: 0, ax: ct.x * TILE + 8 + 16, ay: ct.y * TILE });
            return b;
          }
        }
        // ---- 晨间鸟两支（:4243/:4251；num46<图宽/3 近出生点）----
        //  A：day && time<18000(<9:30) && 草{2,477,109,492} && Next(4)==0 &&
        //     y<=ws && CountNPCS(74+297+298)<6（场上鸟上限）
        //  B：草{2,477,109,492,147} && Next(15)==0（无时段/上限门——夜间也出）
        //  两支同表：金 442 return else Next(4)：0→297 / 1→298 / 2|3→74
        const birdRoll = (): number => {
          if (gold()) return 442;
          const r = rng.int(0, 3);
          return r === 0 ? 297 : r === 1 ? 298 : 74;
        };
        const birdTilesA = t === T.GRASS || t === T.MOWED_GRASS || t === T.HALLOW_GRASS
          || t === T.HALLOW_MOWED_GRASS;
        // A：晨间时段门 Main.time<18000（day 轴 0=4:30 → 18000=9:30）——曾漏,
        //  全天出晨表鸟（review 批补，原版 :4244）
        if (!this.waterTile && num46 < st.w / 3 && birdTilesA && N(4)
          && this.world.clock.hourFloat < 9.5
          && this.spawnTileY <= this.world.groundLevel
          && this.countNpc(74) + this.countNpc(297) + this.countNpc(298) < 6) {
          return D(birdRoll());
        }
        if (!this.waterTile && num46 < st.w / 3
          && (birdTilesA || t === T.SNOW) && N(15)) {
          return D(birdRoll());
        }
        // L4277-4280：自然刷史莱姆王——!waterTile && num46>maxTilesX/3 && 落脚=草(2)
        //  && 1/300 && 场上无 50 → SpawnOnPlayer(target, 50)（刷在玩家身上而非落脚点）。
        //  SpawnOnPlayer（NPC.cs:81273+，500 次玩家 spawnArea 内选点）未移植，以
        //  "currentSpawnX/Y 钉到玩家格 + Game 侧常规落位"近似（登记台账）
        if (!this.waterTile && num46 > st.w / 3 && t === T.GRASS && N(300) && !any(50)) {
          this.currentSpawnX = this.pX;
          this.currentSpawnY = this.pY;
          return D(50);
        }
        // ---- Palworld 遇袭双宠 695/696（:4374-4389，曾误注 Town Slime）：!waterTile
        //      && num46>图宽/8（离出生点）&& 落脚∈{2 草,147 雪,60 丛林草,161 冰}
        //      && Next(160)==0 && 场上无 695/696。选档：flag20=RollLuck(100)<40 →
        //      696；玩家持 5663 无 5664 强制 true、反之强制 false（HasItem 门，Game
        //      每周期喂入 palHas5663/palHas5664——本仓物品池未注册两物时恒 false
        //      = 纯幸运档）。生成后 AI_127 双僵尸威慑待援 ----
        if (!this.waterTile && num46 > st.w / 8
          && (t === T.GRASS || t === T.SNOW || t === T.JUNGLE_GRASS || t === T.ICE)
          && N(160) && !any(696) && !any(695)) {
          let type20 = rollLuck(this.playerLuck, 100, () => rng.next()) < 40;
          if (!this.palHas5664 && this.palHas5663) type20 = true;
          if (!this.palHas5663 && this.palHas5664) type20 = false;
          const type5 = type20 ? 696 : 695;
          return D(type5);
        }
        // ---- 海滩边缘支（:4290-4366）：!xRange && 落脚=黄沙 && 落点在海岸带
        //      （x<beachX || x>w-beachX，无 y 门）。干落点 1/10 海鸥 602；水落点：
        //      上扫 50 格干隙线（连续 3 格非实心锚 anchor+2，再 2 格非实心 → 高线
        //      +2，均钳 ≤spawnTileY）→ 9/10 空过 else Next(4)：0→625 海豚鼠（低线）
        //      /1→615 海鸥?（高线）/2→金 627 else 626 蜻蜓（高线）/3→688 蝴蝶（高线）----
        if (!this.xRange && t === T.SAND
          && (this.spawnTileX < 380 || this.spawnTileX > st.w - 380)) {
          if (!this.waterTile && N(10)) return D(602);
          if (!this.waterTile) {
            return null;    // 原版干落点非 1/10 直接 return（不出后续怪）
          }
          let low = -1, high = -1;
          if (this.spawnTileY < this.world.groundLevel && this.spawnTileY > 50) {
            // WorldGen.SolidTile（:70155）：active && tileSolid && !tileSolidTop &&
            // !halfBrick && slope==0 && !inActive
            const solidAt = (xxx: number, yyy: number): boolean => {
              if (!st.inBounds(xxx, yyy)) return false;
              const ii = st.idx(xxx, yyy);
              const d = TILE_DEFS[st.type[ii]];
              return !!st.flags[ii] && !!d?.solid && !d?.platform
                && !st.half[ii] && st.slope[ii] === 0
                && !(st.wire[ii] & TileStore.WIRE_ACTUATED);
            };
            for (let yy = this.spawnTileY - 1; yy > this.spawnTileY - 50; yy--) {
              const i1 = st.idx(this.spawnTileX, yy);
              if (st.liquid[i1] === 0 && !solidAt(this.spawnTileX, yy)
                && !solidAt(this.spawnTileX, yy + 1) && !solidAt(this.spawnTileX, yy + 2)) {
                low = yy + 2;
                if (!solidAt(this.spawnTileX, low + 1) && !solidAt(this.spawnTileX, low + 2)) {
                  high = low + 2;
                }
                break;
              }
            }
            if (low > this.spawnTileY) low = this.spawnTileY;
            if (high > this.spawnTileY) high = this.spawnTileY;
          }
          if (!N(10)) return null;  // 原版 Next(10)!=0 → return（9/10 空过；曾写反成 1/10）
          const r = rng.int(0, 3);
          // r=0/1 无有效线 → switch 空过 = 本轮空过（原版海滩支内 return 语义）
          if (r === 0) return low > 0 ? this.spawnNPC(x, low * TILE, 625, rng) : null;
          if (r === 1) return high > 0 ? this.spawnNPC(x, high * TILE, 615, rng) : null;
          if (r === 2) {
            const yy2 = high > 0 ? high : this.spawnTileY;
            return this.spawnNPC(x, yy2 * TILE, gold() ? 627 : 626, rng);
          }
          const yy3 = high > 0 ? high : this.spawnTileY;
          return this.spawnNPC(x, yy3 * TILE, 688, rng);
        }
        // L4374-4381：蚁狮/秃鹫（昼池内——原版在海滩海鸥支之后、哥布林侦察兵之前；
        //  夜间沙地不出蚁狮/秃鹫，走僵尸族）。蚁狮门 = !waterTile && 黄沙 53 && 1/5 &&
        //  Spawning_SandstoneCheck（成片沙面计数 ≥40）；秃鹫门 = 黄沙 53 && !waterTile。
        //  旧实现放在主链且 tile 集含硬化沙/沙岩/化石 → 昼夜皆出、tile 集过宽，均错位
        if (!this.waterTile && t === T.SAND && N(5)
          && this.spawningSandstoneCheck(this.spawnTileX, this.spawnTileY)) return D(69);
        if (t === T.SAND && !this.waterTile) return D(61);
        // L4412：哥布林侦察兵 73——距出生点 >1/3 图宽，1/15
        //  （或未破哥布林入侵 && 砸过暗影珠 → 1/7）
        // ★IIIII228 :4482 remix 或支：带外距离门（num46>图宽/3）remix 恒真——
        //  地下"哥布林侦察兵"半域豁免
        if (!this.waterTile && (num46 > st.w / 3 || this.world.seedFlags?.remix)
          && (N(15) || (!this.world.flags['downedGoblins'] && this.world.flags['shadowOrbSmashed'] && N(7)))) {
          return D(73);
        }
        // L4417：雨天飞行怪 224（1/4，无 waterTile 门）
        if (raining && N(4)) return D(224);
        // L4421：雨伞史莱姆 225（!waterTile 1/2）
        if (!this.waterTile && raining && N(2)) return D(225);
        // L4426/4431：大风天 594 风气球（2/3）→ 628 蒲公英（草地 9/10）。
        //  门：!waterTile && num==0（落点上格无墙，L1188 num=wall）&& IsItAHappyWindyDay
        //  （=_shouldUseWindyDayMusic）&& isSpawningInWindDirection（L1101
        //  (pX-spawnTileX)*windSpeedTarget>0，生成点在玩家下风侧）
        const windyDay = this.world.weather.shouldUseWindyDayMusic;
        const spawnWallEmpty = st.wall[st.idx(this.spawnTileX, this.spawnTileY - 1)] === 0;
        const downwind = (this.pX - this.spawnTileX) * this.world.weather.windSpeedTarget > 0;
        if (!this.waterTile && spawnWallEmpty && windyDay && downwind) {
          if (!N(3)) return D(594);
          // :4398 蒲公英门 = tile∈{2 草, 477 修剪草}（仅此两 tile——曾扩到神圣草/
          // 雪原/冰族,注释误引 :4112[昼池 critter 门草族全集]）
          if ((t === T.GRASS || t === T.MOWED_GRASS) && !N(10)) return D(628);
        }
        // L4435：池底基础史莱姆
        if (!this.waterTile) return D(this.getBasicSlimeToSpawn(true, t, rng));
        return null;
      }
      // ---- 夜晚（L4437-4716；墓地白天亦落入本池——见上方昼池的 !ZoneGraveyard 门）----
      // L4409 `if (ZoneGraveyard) defaultTarget = target`（:4411→:5161 Target 兜底）——
      //  显式把刷出怪的目标设为玩家；本仓敌怪走最近玩家索敌，单人语义等价，不另设
      // L4410：萤火虫（原版带 !ZoneGraveyard 门 :4413）——草族 tile + 无风 + 无雨 +
      //  1/fireFlyChance。概率源 = setFireFlyChance（NPC.cs:94557-94610，每夜 StartNight
      //  掷：1/9 高发夜 5-9 / 1/3 绝迹夜 999999 / 其余 10-59；世界字段随存档，
      //  旧档缺省=代表值 30）——旧实现恒 30，台账登记已核销
      const tooWindy = Math.abs(this.world.weather.windSpeedTarget) >= 0.4;
      if (!this.ZoneGraveyard && !tooWindy && !raining
        && (t === T.GRASS || t === T.MOWED_GRASS || t === T.HALLOW_GRASS || t === T.HALLOW_MOWED_GRASS)
        && N(Math.max(1, this.world.fireFlyChance)) && this.spawnTileY <= this.world.groundLevel) {
        // :4419-4433 主只后四向各 1/fireFlyMultiple 附加（此前恒单只，备案已核销）
        const ffId = t === T.HALLOW_GRASS ? 358 : 355;
        this.queueFireflyExtras(rng, ffId);
        return D(ffId);
      }
      // L4439：乌鸦 Raven 301——(万圣节 || 墓地) && 1/12
      if ((this.world.clock.halloween || this.ZoneGraveyard) && N(12)) return D(301);
      // L4444：幽灵 Ghost 316——墓地专属 1/30
      if (this.ZoneGraveyard && N(30)) return D(316);
      // L4449：南瓜跳跳 Hoppin' Jack 304——(万圣节 || 墓地) && hardMode && 1/10
      //  （★旧实现漏了 halloween 单边门——halloween 未杀骷髅王也照出）
      if ((this.world.clock.halloween || this.ZoneGraveyard) && hardMode && N(10)) return D(304);
      // L4454：Next(6) 或 满月（moonPhase==4）1/2 门
      if (N(6) || (moonPhase === 4 && N(2))) {
        // L4456：hard 1/3 → Wandering Eye 133
        if (hardMode && N(3)) return D(133);
        // L4561：万圣节眼球变异 Next(317,319)=317|318（★旧注"节日未接"已接——季节旗建模后补）
        if (this.world.clock.halloween && N(2)) return D(rng.int(0, 1) + 317);
        // L4464：1/2 → 恶魔眼族（1/4 小眼 -43）
        if (N(2)) return D(N(4) ? -43 : 2);
        // L4471-4516：switch(Next(5)) 僵尸族 190-194；各 1/3 小变体与本体【同帧同出】
        //  （原版先 SpawnNPC 小变体再 SpawnNPC 本体；单返回值 API 只能交付本体，
        //   小变体另调一次 spawnNPC 后丢弃）。Next(5)=0..4——本仓 rng.int 闭区间，
        //  此前误写 int(0,5) 多出第 6 档 undefined id，已改 int(0,4)
        const zv = rng.int(0, 4);
        if (N(3)) this.spawnNPC(x, y, [-38, -39, -40, -41, -42][zv], rng);
        return D([190, 191, 192, 193, 194][zv]);
      }
      // L4518：hard 1/50 血月 && 场上无小丑 109 → Clown
      if (hardMode && N(50) && clock.bloodMoon && !any(109)) return D(109);
      // L4623/4628：(血月 || 墓地) && RollOnlyBadLuck(300)==0 → The Groom 53 / The
      //  Bride 536。★原文掷骰在条件首位（不论血月/墓地每轮先掷再判 zone——RNG 流）；
      //  旧实现写成 zone 先行 + 裸 N(300)，负运态 [150,300) 收窄带丢失，已按
      //  Luck.RollOnlyBadLuck（Luck.cs:31-38）1:1 还原
      if (rollOnlyBadLuck(this.playerLuck, 300, () => rng.next()) === 0
        && (clock.bloodMoon || this.ZoneGraveyard)) return D(53);
      if (rollOnlyBadLuck(this.playerLuck, 300, () => rng.next()) === 0
        && (clock.bloodMoon || this.ZoneGraveyard)) return D(536);
      // L4533：新月（moonPhase==0）hard 2/3 → Werewolf 104
      if (!this.dayTime && moonPhase === 0 && hardMode && !N(3)) return D(104);
      // L4538：hard 1/3 → Werewolf 140
      if (!this.dayTime && hardMode && N(3)) return D(140);
      // L4543：血月 2/5 → Blood Zombie 489 / Drippler 490
      if (clock.bloodMoon && rng.int(0, 5) < 2) return D(N(2) ? 490 : 489);
      // L4555：冰系落脚 tile → hard 1/4 Ice Elemental 169 / hard 1/3 Wolf 155 /
      //  专家 1/2 Armed Zombie 431 / else Frozen Zombie 161
      //  （两支 hard 概率均带 !ZoneGraveyard 门 :4557/:4561——墓地里冰面上冰元素/狼不出，
      //   兜底 161 照刷；:4565 spawnArmedZombies（无 skyblock 恒真）&& expertMode && 1/2 → 431。
      //   Main.expertMode 经 mainExpertMode 求值——getGoodWorld(FTW) 抬档同样成立）
      if (iceTile) {
        if (!this.ZoneGraveyard && hardMode && N(4)) return D(169);
        if (!this.ZoneGraveyard && hardMode && N(3)) return D(155);
        if (this.spawnArmedZombies && expert && N(2)) return D(431);
        return D(161);
      }
      // L4577：雨夜 1/2 → Raincoat Zombie 223（1/3 小变体 -54/-55）
      if (raining && N(2)) {
        if (!N(3)) return D(223);
        return D(N(2) ? -55 : -54);
      }
      // ★IIIII61 WorldGen.Skyblock.lowTiles 火把僵尸前插臂（NPC.cs:4691-4713）：
      //   !墓园 && 非水 && lowTiles && 未杀任何困难模式前 Boss → 1/3：
      //   二选一=火把僵尸段（spawnArmedZombies&&expert&&Next(2) → 持械 591 / else 590）
      //   或 GetBasicSlimeToSpawn(surface:true) 基础史莱姆
      if (!this.ZoneGraveyard && !this.waterTile && this.world.skyblockLowTiles
        && !sbDownedPreHM && N(3)) {
        if (N(2)) {
          return D(this.spawnArmedZombies && expert && N(2) ? 591 : 590);
        }
        return D(this.getBasicSlimeToSpawn(true, this.spawnTileType, rng));
      }
      // L4612：苔藓僵尸 Moss Zombie 691——墓地专属 RollOnlyBadLuckExtreme(200)
      if (this.ZoneGraveyard && N(200)) return D(691);
      // L4617：蛆僵尸 Maggot Zombie 632——墓地专属 1/maggotZombieChance（GetZombieSettings
      //  L5500 恒 20；skyblock/初始血量只调 torch 门，不改本值）
      if (this.ZoneGraveyard && N(20)) return D(632);
      // L4622：火把僵尸 590/591——Next(torchZombieChance)。原版条件**仅此一个概率门**，
      //  与"点燃的火把/营火邻近"无关（590 贴图手持火把故俗名火把僵尸；
      //  GetZombieSettings L5495-5523 全文无火把/营火邻接扫描）。:4624 持械变体 591 需
      //  spawnArmedZombies && expertMode && Next(2)==0（掷骰仅在专家档发生，短路同原版）
      if (N(this.torchZombieChance)) {
        return D(this.spawnArmedZombies && expert && N(2) ? 591 : 590);
      }
      // L4634/L4639：万圣僵尸 319|320|321（Next(319,322)，1/2 门）/ 圣诞僵尸
      //  331|332（Next(331,333)，1/2 门）——★旧注"节日未接"已接（季节旗建模后补）
      if (this.world.clock.halloween && N(2)) return D(rng.int(0, 2) + 319);
      if (this.world.clock.xMas && N(2)) return D(rng.int(0, 1) + 331);
      // L4644：专家持械僵尸 430-436——spawnArmedZombies && zombieStyle!=1 &&
      //   expertMode && Next(3)==0，按 zombieStyle 选型（0→430/2→432/3→433/4→434/
      //   5→435/6→436；style 1 无持械变体；switch 缺省 430）
      if (this.spawnArmedZombies && expert && this.zombieStyle !== 1 && N(3)) {
        const armed = [430, 430, 432, 433, 434, 435, 436][this.zombieStyle] ?? 430;
        return D(armed);
      }
      // ---- 最终僵尸 style 表（L4671-4716 + GetZombieSettings L5495）----
      //  zombieStyle = Next(7)（在 SpawnAnNPC 入口即 roll，L1193）；各 style 配大小变体
      const zrow = [
        [3, -26, -27], [132, -28, -29], [186, -30, -31], [187, -32, -33],
        [188, -34, -35], [189, -36, -37], [200, -44, -45],
      ][this.zombieStyle] ?? [3, -26, -27];
      let zid = zrow[0];
      if (N(3)) zid = rng.next() < 0.5 ? zrow[1] : zrow[2];
      return D(zid);
    }
    // ---- 地下层（L4718-4770，worldSurface < y < rockLayer）----
    if (this.underGround) {
      if (!this.noWorms && N(50) && !this.ZoneSnow) {
        // L4722：hard → 2/3 Digger 95 / 1/3 Giant Worm 10；肉前恒 10
        if (hardMode) return D(N(3) ? 10 : 95);
        return D(10);
      }
      // L4734/4738：hard 1/3→140（Possessed Armor）/ 1/2→141（Toxic Sludge）
      if (hardMode && N(3)) return D(140);
      if (hardMode && N(2)) return D(141);
      // ★IIIII228 :4846-4859 remix 臂（困难 140/141 支之后、经典 147 支之前）：
      //  落脚 147/161/163/164/162 或 ZoneSnow → 冰史莱姆 147；否则 1/3 → -9（黄）/
      //  else -8（红）——remix 地下"基础史莱姆"以 -8/-9 主宰
      if (this.world.seedFlags?.remix) {
        if (t === T.SNOW || t === T.ICE || t === T.CORRUPT_ICE || t === T.HOLLOW_ICE
          || t === T.THIN_ICE || this.ZoneSnow) return D(147);
        if (N(3)) return D(-9);
        return D(-8);
      }
      // L4748：落脚 147/161 或 ZoneSnow → 冰史莱姆 147
      if (t === T.SNOW || t === T.ICE || this.ZoneSnow) return D(147);
      return D(this.getBasicSlimeToSpawn(false, t, rng));
    }
    // ---- 地狱（L4771-4820，y > maxTilesY-190）----
    //  mechAny = downedMechBossAny（Main 旗标；我们取 flags.downed_125/126/127/134 任一，
    //  与 Game.ts flag 求值同源）
    if (this.spawnTileY > st.h - 190) {
      const mechAny = !!(this.world.flags['downed_125'] || this.world.flags['downed_126']
        || this.world.flags['downed_127'] || this.world.flags['downed_134']);
      // ★IIIII228 :4873-4876 remix 地狱起点域臂（池首支）：落点 X∈(0.38w+50, 0.62w)
      //  → 骷髅 59（remix 起始区地狱面出骷髅,零掷门）
      if (this.world.seedFlags?.remix
        && this.spawnTileX > st.w * 0.38 + 50 && this.spawnTileX < st.w * 0.62) {
        return D(59);
      }
      // L4777：hard && 未救出税务官 && 1/20 && 场上无 534 → Tortured Soul 534
      if (hardMode && !this.world.flags['savedTaxCollector'] && N(20) && !any(534)) return D(534);
      // L4781：熔岩小动物 1/8（先于骨蛇——原版段序）。
      //  SpawnLavaBaitCritters（L5760）：2/3 → 白天 Hell Butterfly 653 / 夜 Lavafly 654
      //  （原版夜间成群 1-5 只，单返回值只交付 1 只）；else Magma Snail 655
      if (N(8)) {
        if (!N(3)) {
          if (this.dayTime) return D(653);   // Hell Butterfly（昼，单只）
          // :5767-5782 夜间 Lavafly 654 主只 + 四向 1/fireFlyMultiple 附加
          this.queueFireflyExtras(rng, 654);
          return D(654);
        }
        return D(655);
      }
      // L4787：Bone Serpent 1/40（场上唯一）
      if (N(40) && !any(39)) return D(39);
      // L4794：Fire Imp 1/14
      if (N(14)) return D(24);
      if (N(7)) {
        // L4799：Voodoo Demon 1/10；hard+mechAny 4/5 → Red Devil 156；else Demon
        if (N(10)) return D(66);
        if (hardMode && mechAny && !N(5)) return D(156);
        return D(62);
      }
      // L4810：Lava Slime 1/3
      if (N(3)) return D(59);
      // L4812：hard+mechAny 4/5 → Lava Bat 151；else Hellbat
      if (hardMode && mechAny && !N(5)) return D(151);
      return D(60);
    }
    // CheckToSpawnRockGolem（L4821/L5713 1:1）→ 岩石高仑 631：
    //  hard && (落脚=石 或 Moss 族) && !ZoneSnow && 1/50
    //  && 落点上方 4 格三连（x−1/x/x+1）净空（体型 36×48 的头部空间预检）
    if (this.checkToSpawnRockGolem(rng)) return D(631);
    // ---- 洞穴通用池（L4825-5142）----
    // 冰系 tile 分档（原版各段用不同子集）：
    //  iceAll=147/161/162/163/164/200（蠕虫段 L4842）、iceCave=147/161/162（L4981/5117/5128）
    const iceAll = t === T.SNOW || t === T.ICE || t === T.THIN_ICE
      || t === T.CORRUPT_ICE || t === T.HOLLOW_ICE || t === T.CRIMSON_ICE;
    const iceCave = t === T.SNOW || t === T.ICE || t === T.THIN_ICE;
    if (N(60)) {
      if (this.ZoneSnow) return D(218);
      return D(217);
    }
    // L4836：hard && 珍珠沙/珍珠石/粉冰 && 1/8 → Chaos Elemental 120
    if ((t === T.PEARLSAND || t === T.PEARLSTONE_BLOCK || t === T.HOLLOW_ICE)
      && hardMode && !this.noWorms && N(8)) return D(120);
    // L4842-4850：hard && 冰系 tile && 群系旗标 → Pigron 变体 170(腐化)/171(神圣)/180(猩红)
    if (iceAll && !this.noWorms && hardMode) {
      if (this.ZoneCorrupt && N(30)) return D(170);
      if (this.ZoneHallow && N(30)) return D(171);
      if (this.ZoneCrimson && N(30)) return D(180);
    }
    // L4852：hard && ZoneSnow && 1/10 → Ice Tortoise 154
    if (hardMode && this.ZoneSnow && N(10)) return D(154);
    // L4855：1/100 蠕虫——hard→Digger 95；肉前 ZoneSnow→Snow Flinx 185 / else Giant Worm 10
    if (!this.noWorms && N(100) && !this.ZoneHallow) {
      if (hardMode) return D(95);
      if (this.ZoneSnow) return D(185);
      return D(10);
    }
    // L4867：ZoneSnow && 1/20 → Snow Flinx 185
    if (this.ZoneSnow && N(20)) return D(185);
    // L4871：1/10(肉前)/1/20(hard) 母史莱姆族——雪/冰落脚 184，否则 1/3 黑 -6 / 母 16
    if ((!hardMode && N(10)) || (hardMode && N(20))) {
      if (this.ZoneSnow || t === T.ICE || t === T.SNOW) return D(184);
      if (N(3)) return D(-6);
      return D(16);
    }
    // L4990：(!hard || skyblock 低格) && 1/4 史莱姆段——丛林→-10；雪/冰落脚→184；else -6
    //  （★1458 门为 OR：lowTiles 困难世界同样保留肉前 1/4 史莱姆臂，旧写 AND 漏）
    if ((!hardMode || this.world.skyblockLowTiles) && N(4)) {
      if (this.ZoneJungle) return D(-10);
      if (this.ZoneSnow || t === T.ICE || t === T.SNOW) return D(184);
      return D(-6);
    }
    if (N(2)) {
      // 洞穴主池（L4896-5099）
      // 骷髅商 453（L5007-5010）：1/35，!ZoneShadowCandle（影烛熄灭商队）&& 非水域 &&
      // 场内唯一（CountNPCS==0，NPC.cs:5007 终值逐位）—— Game.trySpawnEnemy 把 453
      // 转成 TownNPC 放 npcs 桶。★SW-FX52（2026-09-13）：唯一门改走 countNpc 通道
      // （CountNPCS=Main.npc 全表遍历 :90941-90951，城镇 NPC一体可见）——旧 !any(453)
      // 读 enemies 桶 activeIds，453 从不入其内 ⇒ 商人在场时门恒开 = 掷流分叉
      // （本支吞 Next(35) 即返，vanilla 应落空续掷 Next(80) 仙女支，RB12c 定谳）。
      // 453 入表面 = Game.trySpawnEnemy 计数注入（vanillaId===453 臂）
      if (N(35) && !this.waterTile && !this.shadowCandle && this.countNpc(453) === 0) return D(453);
      // L4911：Lost Girl 195（Nymph）1/80
      if (N(80)) return D(195);
      // 深层半段 = y > (rockLayer + maxTilesY)/2（L4913/4917 共用门）
      const deepCave = this.spawnTileY > (this.world.rockLevel + st.h) / 2;
      // L4913（★IIIII228 :5017）：hard && (remix || 深层半段) && 1/200 → Rune Wizard 172
      if (hardMode && (this.world.seedFlags?.remix || deepCave) && N(200)) return D(172);
      // L4917（★IIIII228 :5022）：(remix || 深层半段) && (1/200 || offensiveToTim 1/50)
      //  → Bound Goblin 45。offensiveToTim（NPC.cs:419）= 胸甲 ∈ {4256, 1282..1287}
      //  && 头盔 != 238 法师帽（"对 Tim 敌对"的着装语义,Game 每周期喂入）
      if (this.world.seedFlags?.remix || deepCave) {
        if (N(200) || (this.offensiveToTim && N(50))) return D(45);
      }
      // L4929/4941：Next(4)!=0（3/4）→ 大理石房：Next(6)!=0（5/6）且场内无 480
      //  且 hard → Medusa 480，else Hoplite 481（花岗岩同构 483/482）
      if (this.nearMarble && !N(4)) {
        if (!N(6) && !any(480) && hardMode) return D(480);
        return D(481);
      }
      if (this.nearGranite && !N(5)) {
        if (!N(6) && !any(483)) return D(483);
        return D(482);
      }
      // L4951：hard && Next(10)!=0（9/10）→ 洞穴主池：
      //  1/2 → ZoneSnow?197 : (深层半段 1/5→-15 Heavy Skeleton / else 77 Armored Skeleton)
      //  else → ZoneSnow?206 : 110 Skeleton Archer
      if (hardMode && !N(10)) {
        if (N(2)) {
          if (this.ZoneSnow) return D(197);
          // L4959（★IIIII228 :5059）：(remix || 深层半段) && 1/5 → -15 Heavy Skeleton
          if ((this.world.seedFlags?.remix || deepCave) && N(5)) return D(-15);
          return D(77);
        }
        return D(this.ZoneSnow ? 206 : 110);
      }
      // L4961（★SW-BJ55 补 halloween 臂,1457 NPC.cs:5078）：幽灵 Ghost 316——
      //  !noWorms && (Main.halloween || ZoneGraveyard) && Next(30)==0（洞穴主池内）。
      //  注释本已写「万圣节 || 墓地」但代码漏 halloween 单边门（地表 4539/4549 支
      //  与 cave 骷髅 5115 支的节日臂均已接,唯此支漏）
      if (!this.noWorms && (this.world.clock.halloween || this.ZoneGraveyard) && N(30)) return D(316);
      // L4969：Undead Miner 44（1/20）
      if (N(20)) return D(44);
      // L4979：冰洞池——落脚 147/161/162：1/15 Snow Flinx 185 / else Undead Viking 167
      if (iceCave) return D(N(15) ? 185 : 167);
      // L4993：ZoneSnow → Snow Flinx 185
      if (this.ZoneSnow) return D(185);
      // L5000：1/3 → cavernMonsterType[Next(2)][Next(3)]（洞穴蝾螈族，世界生成时 roll）
      if (N(3)) return D(cavernMonsterType[rng.int(0, 1)][rng.int(0, 2)]);
      // L5010：ZoneGlowshroom && tile 70/190 → 孢子骷髅 635（蘑菇草/发光蘑菇块落脚）
      if (this.ZoneGlowshroom && (t === T.MUSHROOM_GRASS || t === T.MUSHROOM_BLOCK)) return D(635);
      // L5115：万圣洞穴幽魂 Next(322,325)=322|323|324（1/2 门——★旧注"节日未接"已接）
      if (this.world.clock.halloween && N(2)) return D(rng.int(0, 2) + 322);
      // L5120-5139：专家模式骨堆小动物——原版怪癖：`num56=Next(4)` 后三个 `==0`
      // 判定连写（1456 同款 :5031-5055），450/451 死码，实际分布 = 449×1/4、452×3/4。
      // 按反编译照抄（勿"修"成均匀四选）
      if (this.world.isExpert && N(3)) {
        const n456 = rng.int(0, 3);
        return D(n456 === 0 ? 449 : 452);
      }
      // switch(Next(4)) 骷髅系（L5050-5099）：2/3 本体，1/3 大小变体二选一
      const sv = rng.int(0, 3);
      const sm = [21, 201, 202, 203][sv] ?? 21;
      if (!N(3)) return D(sm);
      const small = [[-46, -47], [-48, -49], [-50, -51], [-52, -53]][sv] ?? [-46, -47];
      return D(rng.next() < 0.5 ? small[0] : small[1]);
    }
    // 洞穴兜底（L5101-5142，按原版段序）
    // L5101：hard && ZoneHallow && 1/2 → Illuminant Slime 138
    if (hardMode && this.ZoneHallow && N(2)) return D(138);
    // L5105：ZoneJungle → Jungle Bat 51
    if (this.ZoneJungle) return D(51);
    // L5109：ZoneGlowshroom && tile 70/190 → 孢子蝙蝠 634（洞穴兜底段的蘑菇地支，
    //  与 L5010 的 635 分居两支——命中本支说明洞穴主池 Next(2) 已先行掷空）
    if (this.ZoneGlowshroom && (t === T.MUSHROOM_GRASS || t === T.MUSHROOM_BLOCK)) return D(634);
    // L5113：hard && ZoneHallow → Illuminant Bat 137
    if (hardMode && this.ZoneHallow) return D(137);
    // L5117：hard && Next(6)>0（5/6）→ 冰落脚 1/3 Ice Bat 150 / else Giant Bat 93
    if (hardMode && !N(6)) {
      if (N(3) && iceCave) return D(150);
      return D(93);
    }
    // L5128：冰落脚 tile（147/161/162，非 ZoneSnow 旗标）→ hard?169 Ice Elemental : 150
    if (iceCave) return D(hardMode ? 169 : 150);
    return D(49);  // Cave Bat
  }

  /** NearSpikeBall（1456:90933-90948 = 1457:91002-91016，字面 1:1）：落点盒
   *  (x*16-300, y*16-300, 600, 600)（x/y=落点格坐标）与场上每个 active && aiStyle==20
   *  （刺球 70，SetDefaults :9713 全表唯一 aiStyle 20）的锚盒
   *  ((int)ai[1], (int)ai[2], 20, 20) 相交 → true。锚点=像素世界坐标（AI_020 首 tick
   *  中心快照 :24672-24673），盒左上角恰为 (ai1,ai2)（非中心±10 对称）。
   *  XNA Rectangle.Intersects = 严格 <（边线相触不算）。零 RNG 消耗。锚点表由 Game
   *  每周期注入 spikeBallAnchors（aiInit=false 未初始化个体已在上游剔除——原版该态
   *  锚在 (0,0)，与地牢落点盒实际永不相交=等价）。地牢 :2635/:2728 出刺球前的防堆积门 */
  private nearSpikeBall(x: number, y: number): boolean {
    const bx = x * 16 - 300, by = y * 16 - 300;
    for (const a of this.spikeBallAnchors) {
      if (bx < a.x + 20 && a.x < bx + 600 && by < a.y + 20 && a.y < by + 600) return true;
    }
    return false;
  }

  /** AI_FindNearbyBook（NPC.cs:2656/2667 调用档：spawnTile−16 起 32×32 窗，
   *  closestBook=true + checkPlayerScreenRanges=true，:62751-62804）：
   *  扫玩家放置的书（tile 50），屏内书跳过，返回距窗角最近的书格；无书 → null */
  private findNearestBookForSpawn(): { x: number; y: number } | null {
    const st = this.world.store;
    const x0 = Math.max(0, this.spawnTileX - 16), x1 = Math.min(st.w, this.spawnTileX + 16);
    const y0 = Math.max(0, this.spawnTileY - 16), y1 = Math.min(st.h, this.spawnTileY + 16);
    // vector2 = 窗角（spawnTile−16,−16）——closestBook 距离基准（:62769-62770）
    const refX = this.spawnTileX - 16, refY = this.spawnTileY - 16;
    let best = Infinity, bx = -1, by = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const t = st.get(x, y);
        if (!t || TILE_DEFS[t]?.vanilla?.sheet !== 50) continue;
        if (!this.tileClearOfPlayerScreens(x, y, this.playerPx, this.playerPy)) continue;  // :62782-62786
        const d = (x - refX) * (x - refX) + (y - refY) * (y - refY);
        if (d < best) { best = d; bx = x; by = y; }
      }
    }
    return bx >= 0 ? { x: bx, y: by } : null;
  }

  /** CanSpawnDevourer（NPC.cs:5478-5492 1:1）：!infectedSeed → 恒 true；
   *  infectedSeed && teamBasedSpawnsSeed → false；|X-spawnTileX|>maxTilesX×0.08 → true。
   *  本仓无种子系统（恒非 infectedSeed）→ 恒 true（后两分支不可达，保留签名对齐原文） */
  private canSpawnDevourer(_x = 0): boolean {
    const INFECTED_SEED = false;   // Main.infectedSeed：本仓恒 false
    if (!INFECTED_SEED) return true;
    return Math.abs(_x - this.world.spawnX) > this.world.store.w * 0.08;
  }

  /** SpawnTileOrAboveHasAnyWallInSet（NPC.cs:5535-5556 1:1，墙集收窄为地下沙漠表）：
   *  落点格或其上格的墙命中 AllowsUndergroundDesertEnemiesToSpawn → true */
  private tileOrAboveWallInDesertSet(): boolean {
    const st = this.world.store;
    return isDesertWall(st.wall[st.idx(this.spawnTileX, this.spawnTileY)])
      || isDesertWall(st.wall[st.idx(this.spawnTileX, this.spawnTileY - 1)]);
  }

  /** WorldGen.checkUnderground（WorldGen.cs:10083-10129 1:1）：
   *  y>worldSurface+80 → true；y<worldSurface/2 → false；其余扫 (x±60)×(y-80 起 3 行)
   *  的 120×3 带——SolidTile 或 (x,y) 带墙（原版即用常数坐标查墙）计数 ≥288（80%）→ true。
   *  地下沙漠分支门（NPC.cs:1589）的第二合取项 */
  private checkUnderground(x: number, y: number): boolean {
    const st = this.world.store;
    if (y > this.world.groundLevel + 80) return true;
    if (y < this.world.groundLevel / 2) return false;
    let x0 = x - 60;
    if (x0 < 0) x0 = 0;
    if (x0 >= st.w - 120) x0 = st.w - 121;
    const y0 = y - 80;
    const walled = st.inBounds(x, y) && st.wall[st.idx(x, y)] > 0;
    let count = 0;
    for (let i = x0; i < x0 + 120; i++) {
      for (let j = y0; j < y0 + 3; j++) {
        if (!st.inBounds(i, j)) continue;
        if (st.isSolid(i, j) || walled) count++;
      }
    }
    return count >= 120 * 3 * 0.8;
  }

  /** CountNPCS（NPC.cs CountNPCS 遍历 Main.npc 全表）：Game 每周期注入的全量
   *  vanilla id→存活数表（SW-FX7 2026-09-10 补齐——此前无事件时退化为 activeIds
   *  的 0/1 检测，N 阈值门失真：250 雨云怪 <2（:4192）/ 467 致命球 <2（:3575）/
   *  510 沙幽灵 <4（:3973）/ 74+297+298 晨鸟 <6（:4328）在 ≥2 只在场时仍放行）。
   *  ★==0 型唯一门分域：513 墓穴爬虫（:1703）走 enemies 桶 → 旧 activeIds Set 语义
   *  与计数对 ==0 等价（旧退化下也正确）；453 骷髅商（:5007）走 TownNPC npcs 桶 →
   *  从不入 activeIds，旧 !any(453) 恒真 ⇒ 唯一门整缺（SW-FX52 2026-09-13 修：
   *  Game 侧 vanillaId===453 入表 + 本侧唯一门改 countNpc(453)==0） */
  npcCounts: Map<number, number> = new Map();
  private countNpc(id: number): number {
    const injected = this.npcCounts.get(id);
    if (injected != null) return injected;
    // 兼容回退（测试/未注入域）：月事件/星璇塔 ctx 计数表 → activeIds 0/1 检测
    const c = this.moonEvent?.counts.get(id) ?? this.lunar?.counts.get(id);
    if (c != null) return c;
    return this.activeIds.has(id) ? 1 : 0;
  }

  /** SpawnFrog（NPC.cs:5521-5535 1456 / 1457 :5621-5637 1:1）：!unlockedSlimeYellowSpawn
   *  && RollLuck(30) 且场上无 687 → 神秘青蛙 687（Enemy 直出——vanilla-npcs.json/
   *  NPC_687.png 在位，aiStyle 7 行走族 AI 走 townCritterWalkAI；旧
   *  pendingCritterKey→Critter 侧信道已退役）；RollLuck(goldCritterChance=400,
   *  NPC.cs:6054) → 金蛙 445；else 蛙 361。★幸运消费面七类⑤（2026-09-03）：金蛙掷
   *  曾 `rng.next()<1/400` 均匀近似——原版 RollLuck 三态（正运 ≈1.39/400、负运
   *  ≈0.69/400、0 基线 1/400 逐位等价），luck=playerLuck（SetSpawnFlags NPC.cs:370
   *  spawn 周期玩家 luck,非事件位置最近玩家——与文件其余 rollLuck 消费同口径） */
  /** 萤火虫成群附加队列（原版 :2327-2344/:4419-4433/:5767-5782 主只后四向各
   *  1/fireFlyMultiple 独立掷 SpawnNPC）——spawn() 单返回值只交付主只，附加以
   *  像素偏移入队，Game.trySpawnEnemy 落位段消费（消费后清空） */
  pendingCritterExtras: Array<{ npc: number; dx: number; dy: number; ax?: number; ay?: number }> = [];
  /** NPC.AnyHelpfulFairies（NPC.cs:90954-90964）：场上存在 ai[2]>1 的跟随态仙女
   *  583/584/585——Game 每周期喂入（spawner 无实体桶访问）。消费点 =
   *  CheckToSpawnUndergroundFairy（NPC.cs:5843，本仓 :556 checkToSpawnUndergroundFairy） */
  fairyHelpfulActive = false;
  /** Player.offensiveToTim（NPC.cs:419）：胸甲 ∈ {4256 AmberRobe? robe 族 1282-1287}
   *  && 头盔 != 238 法师帽 → "对 Tim 敌对"着装语义；消费 = :5022 Tim 1/50 加掷臂
   *  （★IIIII228 remix 臂同支）。Game 每周期随 setPlayerFlags 喂入 */
  offensiveToTim = false;
  /** Player.isNearFairy（Player.cs:54494-54506）：任一 active 仙女 583/584/585 距玩家
   *  Center < NPC.sWidth（NPC.cs:6791 = 常量 1920，非实际屏宽；无 ai 态条件——野生
   *  绕圈仙女同样算）——SpawnNPC :745-749 刷怪率窗（×1.2/×0.8）消费。Game 每周期喂入
   *  （窗口判定在 Game 侧做：spawner 无实体桶访问；isNearFairyWindow 下方共用谓词） */
  isNearFairy = false;
  /** ★BJ356 DD2 事件双旗（Game 每周期喂入,spawner 无事件态/实体桶访问）：
   *  dd2Ongoing = DD2Event.Ongoing（DD2Event.cs:67）;zoneDD2 = ZoneOldOneArmy
   *  （SetSpawnFlags NPC.cs:397 自 Player.ZoneOldOneArmy;Player.cs:16836 =
   *  SceneMetrics.CloseEnoughToDD2LanePortal = WithinRangeOfNPC(549,4000)，
   *  SceneMetrics.cs:284——任一活门 549 距玩家中心 ≤4000px,DistanceSquared ≤ range²）。
   *  消费点：getSpawnRate 复位臂（NPC.cs:777-780）+ spawnAnNPC 抑制门（NPC.cs:2803-2805） */
  dd2Ongoing = false;
  zoneDD2 = false;
  private spawnFrog(rng: RNG): Enemy | null {
    const x = this.spawnTileX * TILE + 8;
    const y = this.spawnTileY * TILE;
    // rollLuck 第三参是**函数**——裸传 rng.next 会与实例分离(this.ur undefined 崩溃,
    // 进丛林必炸);全文件其余三处均为 () => rng.next(),此处笔误(2026-08-13 用户报告)
    if (!this.world.flags.unlockedSlimeYellowSpawn && rollLuck(this.playerLuck, 30, () => rng.next()) === 0
      && !this.activeIds.has(687)) {
      return this.spawnNPC(x, y, 687, rng);
    }
    if (rollLuck(this.playerLuck, 400, () => rng.next()) === 0) return this.spawnNPC(x, y, 445, rng);
    return this.spawnNPC(x, y, 361, rng);
  }

  /** ZoneLihzhardTemple（SceneMetrics.cs:688）：玩家所站格墙 == 87（蜥蜴人砖墙）。
   *  神庙砖怪池门（NPC.cs:3821）与 GetSpawnRate 神庙倍率共用；缺省取本帧玩家格 */
  private zoneLihzardTemple(tx = this.pX, ty = this.pY): boolean {
    // ★IIIII22b：双地牢世界 SetSpawnFlagsForChosenTile 尾部重写玩家 Zone 位后
    // （NPC.cs:439 ZoneLihzhardTemple = scan），神庙门走扫描值而非中心墙直读——
    // latch 由 dual 区块每次选格刷新（非双地牢世界恒 null → 原路径零改动）。
    if (this.ddLihzhardLatch !== null) return this.ddLihzhardLatch;
    const st = this.world.store;
    return st.inBounds(tx, ty) && st.wall[st.idx(tx, ty)] === 87;
  }

  /** 双地牢 chosen-tile 扫描的 ZoneLihzhardTemple 覆写闩（NPCSpawningFlagsForDualDungeons
   *  九位之一；null=未覆写，保持 SceneMetrics 玩家中心墙派生） */
  private ddLihzhardLatch: boolean | null = null;

  /** GetGemBunnyToSpawn（NPC.cs:5587-5615 1:1）：Next(100) 分档——琥珀 5%/钻石 8%/
   *  红玉 10%/翠玉 12%/蓝玉 16%/黄玉 21%/紫晶 28%（越稀有权重越低） */
  private getGemBunnyToSpawn(rng: RNG): number {
    const n = Math.floor(rng.next() * 100);
    if (n < 5) return 651;      // Amber Bunny
    if (n < 13) return 652;     // Diamond Bunny
    if (n < 23) return 650;     // Ruby Bunny
    if (n < 35) return 649;     // Emerald Bunny
    if (n < 51) return 648;     // Sapphire Bunny
    if (n < 72) return 647;     // Topaz Bunny
    return 646;                 // Amethyst Bunny
  }

  /** GetGemSquirrelToSpawn（NPC.cs:5617-5645 1:1）：权重表同上（639-645 松鼠族） */
  private getGemSquirrelToSpawn(rng: RNG): number {
    const n = Math.floor(rng.next() * 100);
    if (n < 5) return 644;      // Amber Squirrel
    if (n < 13) return 645;     // Diamond Squirrel
    if (n < 23) return 643;     // Ruby Squirrel
    if (n < 35) return 642;     // Emerald Squirrel
    if (n < 51) return 641;     // Sapphire Squirrel
    if (n < 72) return 640;     // Topaz Squirrel
    return 639;                 // Amethyst Squirrel
  }

  /** CheckToSpawnRockGolem（NPC.cs:5713-5728 1:1）：
   *  !hardMode / (落脚≠石 且 非 Moss 族) / ZoneSnow 任一 → false；
   *  Next(50)≠0 → false；落点上方 4 格三连任一实心（WorldGen.SolidTile）→ false */
  private checkToSpawnRockGolem(rng: RNG): boolean {
    if (!this.hardMode) return false;
    if (this.spawnTileType !== T.STONE && !TILE_MOSS.has(this.spawnTileType)) return false;
    if (this.ZoneSnow) return false;
    if (rng.next() >= 1 / 50) return false;   // Main.rand.Next(50)==0
    const st = this.world.store;
    const y4 = this.spawnTileY - 4;
    if (st.isSolid(this.spawnTileX - 1, y4) || st.isSolid(this.spawnTileX, y4)
      || st.isSolid(this.spawnTileX + 1, y4)) return false;
    return true;
  }

  /** Spawning_SandstoneCheck（NPC.cs:5364-5403 1:1）：沙漠地表蚁狮门。
   *  WorldGen.InWorld(x,y,10) 外 → false；自落脚格向下 ≤8 行逐行计数——本行须为
   *  沙族 tile（中断止），并向两侧各延伸 ≤4 格（遇非沙族中断）；
   *  计数 ≥40 通过（remixWorld 阈值 10 未接——本仓无 remix 世界恒 40） */
  /** FindCattailTop（NPC.cs:80978-81001）：落脚 ±30×±20 窗扫香蒲顶格
   *  （tile 519 && frameX≥180——水上/水下株顶帧段），`Next(num)==0` 加权
   *  reservoir 均匀取一（每匹配格一掷，掷序=扫描序）。null=窗口内无香蒲 */
  private findCattailTop(landX: number, landY: number, rng: RNG): { x: number; y: number } | null {
    const st = this.world.store;
    let cx = landX, cy = landY, num = 1;
    for (let i = landX - 30; i <= landX + 30; i++) {
      for (let j = landY - 20; j <= landY + 20; j++) {
        if (!st.inBounds(i, j)) continue;
        const ti = st.idx(i, j);
        if (st.flags[ti] && st.type[ti] === T.CATTAIL && st.frameX[ti] >= 180
          && rng.int(0, num - 1) === 0) {
          cx = i; cy = j;
          num++;
        }
      }
    }
    return cx !== landX || cy !== landY ? { x: cx, y: cy } : null;
  }

  /** RollDragonflyType（NPC.cs:5426）：沙地 53 → SelectRandom(595,598,600)；
   *  其余（草 2/477）→ SelectRandom(596,597,599)（均匀三选） */
  private rollDragonflyType(tileType: number, rng: RNG): number {
    const pool = tileType === T.SAND ? [595, 598, 600] : [596, 597, 599];
    return pool[Math.floor(rng.next() * 3)]!;
  }

  private spawningSandstoneCheck(x: number, y: number): boolean {
    const st = this.world.store;
    if (x < 10 || y < 10 || x > st.w - 10 || y > st.h - 10) return false;
    // ★IIIII228 :5498-5502 remix 阈值 10（经典 40）——remix 地下沙体同样出蚁狮/沙尘怪
    const threshold = this.world.seedFlags?.remix ? 10 : 40;
    let num = 0;
    outer: for (let i = 0; i < 8; i++) {
      let t = st.type[st.idx(x, y + i)];
      if (!st.flags[st.idx(x, y + i)] || !TILE_SAND.has(t)) break;
      num++;
      for (let j = 1; j <= 4; j++) {
        t = st.type[st.idx(x + j, y + i)];
        if (!st.flags[st.idx(x + j, y + i)] || !TILE_SAND.has(t)) break;
        num++;
      }
      for (let k = 1; k <= 4; k++) {
        t = st.type[st.idx(x - k, y + i)];
        if (!st.flags[st.idx(x - k, y + i)] || !TILE_SAND.has(t)) break;
        num++;
      }
      if (num >= threshold) break outer;
    }
    return num >= threshold;
  }

  /** GetBasicSlimeToSpawn（L5637-5676） */
  /** GetBasicSlimeToSpawn（NPC.cs:5637-5656）1:1。spawnDist = |spawnTileX − 世界出生点X|
   *  （:4420/:4706），地下恒 -1。
   *  L5656-5663：节日史莱姆优先档——万圣 → 302 / 圣诞 → Next(333,337)=333..336，
   *  受 GetBasicSlimeToSpawn_ChanceToBeHolidaySlime（:5678-5685）独立掷：
   *  lowTiles 世界 1/4、普通世界 2/3（Next(3)!=0）。★节日旗已建模此前漏接 ---- */
  private rollHolidaySlimeChance(rng: RNG): boolean {
    return this.world.skyblockLowTiles ? rng.nextInt(4) === 0 : rng.nextInt(3) !== 0;
  }

  private getBasicSlimeToSpawn(surface: boolean, tileType: number, rng: RNG): number {
    if (!surface) {
      // 地下：Next(5)==0→-9（黄），否则 Next(2)==0→1（蓝）/-8（红）
      if (rng.nextInt(5) === 0) return -9;
      return rng.nextInt(2) === 0 ? 1 : -8;
    }
    switch (tileType) {
      // case 60 = 丛林【草】(原版 :5648)——曾误绑 T.MUD(59 泥,2026-08-13 对齐)
      case T.JUNGLE_GRASS: return -10;
      // case 147/161 = 雪块/【冰块】(:5651-5653)——曾误绑雪砖(148)
      case T.SNOW: case T.ICE: return 147;
      default: {
        // 节日档（:5656-5663）：万圣/圣诞史莱姆替换基础史莱姆，位于绿/紫掷之前
        if (this.world.clock.halloween && this.rollHolidaySlimeChance(rng)) return 302;
        if (this.world.clock.xMas && this.rollHolidaySlimeChance(rng)) {
          return 333 + rng.int(0, 3);      // Main.rand.Next(333,337)=333/334/335/336
        }
        // spawnDist 语义:远离出生点(>400)才出紫史莱姆、近出生点(<200)经典档易出绿(:5664-5671)
        const spawnDist = Math.abs(this.spawnTileX - this.world.spawnX);
        if (rng.nextInt(3) === 0 || (spawnDist < 200 && !this.expert)) return -3;
        if (rng.nextInt(10) === 0 && (spawnDist > 400 || this.expert)) return -7;
        return 1;
      }
    }
  }

  /** 主入口：Game.trySpawnEnemy 调用 */
  spawn(playerX: number, playerY: number, rng: RNG, viewHalfW: number, viewHalfH: number): Enemy | null {
    this.pX = Math.floor(playerX / TILE);
    this.pY = Math.floor(playerY / TILE);
    this.viewHalfW = viewHalfW; this.viewHalfH = viewHalfH;
    this.playerPx = playerX; this.playerPy = playerY;
    this.dayTime = this.world.clock.isDay;
    this.ctxRaining = this.world.weather.raining;   // ★IIIII228：Spawner.raining 字段（remix 可伪造）
    this.hardMode = !!this.world.flags.hardMode;
    this.expert = mainExpertMode(this.world);          // Main.expertMode（GetBasicSlimeToSpawn 绿/紫门用）
    // SetSpawnFlags L321：noWorms = 玩家所站格带房屋墙（房屋内不出蠕虫）；
    // ∪= getSpawnRate 城镇段闩锁的 townNoWorms（原版同一字段,分支只写真值 →
    // OR 合并即原版终态;此前 townNoWorms 闩后从未被读 = 城镇旁蠕虫抑制失效）
    this.noWorms = (this.world.store.inBounds(this.pX, this.pY)
      && WALL_HOUSE.has(this.world.store.wall[this.world.store.idx(this.pX, this.pY)]))
      || this.townNoWorms;
    this.skyMob = false;
    this.spawnSpider = false;
    // 邻近旗标每尝试复位(原版每次 TrySpawnAnNPC 全新置旗;
    // 泄漏会导致碰过大理石后全图永远出蛇发女妖)
    this.nearMarble = false;
    this.nearGranite = false;
    this.spawnUndergroundDesert = false;
    if (!this.findSpawnTile(rng, viewHalfW, viewHalfH)) return null;
    // TrySpawnAnNPC L220：CheckNotSpawningOnScreen 像素级二次校验（画面内/贴屏拒绝）
    if (!this.checkNotSpawningOnScreen(playerX, playerY, viewHalfW, viewHalfH)) return null;
    // GetProperGroundSpawnTileTypeAndWallType（L5789-5792）：tile = 落脚格自身 type，
    // wall = 落脚格【上方一格】的墙（skyMob 天空怪落点无实心面 → tile=0）
    const st = this.world.store;
    const groundType = this.skyMob ? 0 : st.type[st.idx(this.spawnTileX, this.spawnTileY)];
    const spawnWallType = this.spawnTileY > 0
      ? st.wall[st.idx(this.spawnTileX, this.spawnTileY - 1)] : 0;
    // PostCheckChosenSpawnTile（L922-927）：地牢内刷怪点必须踩地牢砖且上方格有墙。
    // 原版失败 = TrySpawnAnNPC return false（L227-230）——整帧放弃，不回选点循环换点重试
    if (this.ZoneDungeon && (!this.isDungeonTile(groundType) || spawnWallType === 0)) return null;
    // :931-940 落脚上方两格均有液体且非岩浆 → 微光/蜂蜜面拒绝（水走 waterTile 水生成链）
    if (this.spawnTileY > 1) {
      const iUp1 = st.idx(this.spawnTileX, this.spawnTileY - 1), iUp2 = st.idx(this.spawnTileX, this.spawnTileY - 2);
      if (st.liquid[iUp1] > 0 && st.liquid[iUp2] > 0 && st.liquidType[iUp1] !== 2
        && (st.liquidType[iUp1] === 3 || st.liquidType[iUp1] === 4)) return null;
    }
    // :943-947 高尔夫草地（477 修剪/492 神圣修剪）：非事件态 1/10 整帧拒绝
    // （invasionType<=0 用 invaders 近前线代理——高尔夫球场+入侵的交集极罕见）
    if ((groundType === T.MOWED_GRASS || groundType === T.HALLOW_MOWED_GRASS)
      && !this.world.clock.bloodMoon && !this.world.clock.eclipse && !this.invaders
      && (!this.moonEvent || this.moonEvent.kind === 0) && !this.world.weather.slimeRain
      && Math.random() * 100 < 10) return null;
    this.setFlagsForChosenTile(this.spawnTileX, this.spawnTileY, groundType, rng);
    this.currentSpawnX = this.spawnTileX;
    this.currentSpawnY = this.spawnTileY;
    // 探针调试覆盖：debugPoolOverride 非空时绕过原版链直接从池选（确定性验证）
    if (debugPoolOverride && debugPoolOverride.length) {
      return this.spawnNPC(this.spawnTileX * 16 + 8, this.spawnTileY * 16,
        debugPoolOverride[rng.int(0, debugPoolOverride.length - 1)], rng);
    }
    return this.spawnAnNPC(rng);
  }
}

/** Player.isNearFairy 距离窗（Player.cs:54494-54506）：任一 active 仙女（原版 type
 *  583/584/585——本仓 vanillaId/critterVid 同域）满足
 *  `Vector2.Distance(npc.Center, player.Center) < NPC.sWidth` 即真。
 *  NPC.sWidth = 1920 是【常量】（NPC.cs:6791 `public static int sWidth => 1920`），
 *  非实际屏宽；比较严格小于；无 ai[2] 条件（与 AnyHelpfulFairies :90954 的跟随态门
 *  是两个谓词）。原版 npcsFoundForCheckActive[583..585] 前置门只是同表跳空优化，
 *  谓词语义由本函数完整承载。Game 每周期对 enemies/critters 两桶各调一次后 OR。
 *  vid 抽取参数化：enemies 桶读 vanillaId、critters 桶读 Game.critterVid（vanillaId
 *  ?? def.npc）。行为锁定：tests/spawn-fairy-near-window.test.ts */
export const FAIRY_NEAR_RADIUS = 1920;

export function isNearFairyWindow(
  entries: Iterable<{ dead?: boolean; cx: number; cy: number }>,
  px: number, py: number,
  vid: (e: { dead?: boolean; cx: number; cy: number }) => number,
): boolean {
  for (const e of entries) {
    if (e.dead) continue;
    const v = vid(e);
    if (v !== 583 && v !== 584 && v !== 585) continue;
    if (Math.hypot(e.cx - px, e.cy - py) < FAIRY_NEAR_RADIUS) return true;
  }
  return false;
}
