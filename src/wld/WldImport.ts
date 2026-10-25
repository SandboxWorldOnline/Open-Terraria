// .wld → 自有存档格式转换（导入后即可进入游戏）
// tile/wall/item 的 id 映射基于 Terraria 1.4 的事实数据；未映射内容做可玩性降级。
import { parseWld, WldWorld } from './WldParser';
import type { WldTeItem, WldTileEntity } from './WldParser';
import { furnitureSlotCount, type FurnitureKind } from '../world/FurnitureItems';
import { TOWN_NPC_IDS } from '../data/vanillaNpcs';
import { SaveData, rleTiles, rlePairs, bytesToB64 } from '../save/SaveFile';
import { CHEST_MAX_ITEMS } from '../world/World';
import { TILE_BY_KEY, T, TILE_DEFS, TILE_STABLE_OF_INTERNAL, PLATFORMS_SHEETS, IS_A_CONTAINER_SHEETS, NON_SOLID_SAVE_SLOPES_SHEETS } from '../data/tiles';
import { ITEM_BY_KEY, ITEM_STABLE_OF_INTERNAL, VANILLA_ITEM_KEY_BY_ID } from '../data/items';
import { translateSeed } from '../core/rng';
// ★IIIIIII18 F-1：导入路径统一走与新创建世界相同的 seed 解析层——
// parseSeedChain（WorldGen.CheckInputForSecretSeed 等价层 + '|' 多段协议）
import { parseSeedChain } from '../world/gen/SeedEasterEggs';

/** wld NPC spriteId → 存档 key（正常态反查 TOWN_NPC_IDS；bound 型单独映射，id-maps 核实：
 *  105 BoundGoblin→goblin_tinkerer、106 BoundWizard→wizard、123 BoundMechanic→mechanic、
 *  354 WebbedStylist→stylist、589 GolferRescue→golfer；534 DemonTaxCollector→tax_collector） */
const BOUND_ID_MAP: Record<number, { key: string; bound: boolean }> = {
  105: { key: 'goblin_tinkerer', bound: true },
  106: { key: 'wizard', bound: true },
  123: { key: 'mechanic', bound: true },
  354: { key: 'stylist', bound: true },
  589: { key: 'golfer', bound: true },
  534: { key: 'tax_collector', bound: true },
};
export const TOWN_NPC_KEY_BY_ID: Record<number, { key: string; bound: boolean }> = {
  ...BOUND_ID_MAP,
  ...Object.fromEntries(Object.entries(TOWN_NPC_IDS).map(([k, v]) => [v.id, { key: k, bound: false }])),
};

// wld tile id → 内部 tile key（null = 清空丢弃；copyFrame = 原版 framed 家具，18px 帧直拷）
type MapEntry = string | { key: string; copyFrame?: boolean } | null;

/** sheet 兜底索引：TILE_MAP 未显式登记的 wld tile id → 注册表中首个同 sheet 的 def。
 *  2026-08-12 tile 全量补齐后 753 个 sheet 全部有注册——任意原版存档不再降级石块。
 *  显式 TILE_MAP 优先（null 清空/特判语义不被兜底覆盖） */
const SHEET_FALLBACK: Array<{ sheet: number; id: number; framed: boolean }> = [];
{
  const seen = new Set<number>();
  for (let i = 0; i < TILE_DEFS.length; i++) {
    const sh = TILE_DEFS[i].vanilla?.sheet;
    if (sh === undefined || seen.has(sh)) continue;
    seen.add(sh);
    SHEET_FALLBACK.push({ sheet: sh, id: i, framed: !!TILE_DEFS[i].framed });
  }
}
const SHEET_SLOT = new Map<number, number>();
SHEET_FALLBACK.forEach((f, slot) => SHEET_SLOT.set(f.sheet, slot));
function sheetFallback(wt: number): { id: number; copyFrame: boolean } | null {
  const slot = SHEET_SLOT.get(wt);
  if (slot === undefined) return null;
  const f = SHEET_FALLBACK[slot];
  return { id: f.id, copyFrame: f.framed };
}

/** ★vanilla interop 导出单点（net/vanilla/sections.ts 段流解码共用）：原版 tile id →
 *  内部 id。映射语义与 parseWldToSave 逐字同源（TILE_MAP 显式表 → sheet 兜底 →
 *  未映射 null→clear；映射目标 framed 时 copyFrame=true 需直拷帧）。 */
export function mapVanillaTile(wt: number): { id: number; copyFrame: boolean } | null {
  const mapped = (TILE_MAP as Record<number, MapEntry>)[wt];
  if (mapped === undefined) return sheetFallback(wt);
  if (mapped === null) return null; // 显式映射为「清除」（占位/杂波族）
  if (typeof mapped === 'string') {
    const id = TILE_BY_KEY[mapped] ?? 0;
    return { id, copyFrame: !!TILE_DEFS[id]?.framed };
  }
  const id = TILE_BY_KEY[mapped.key] ?? 0;
  return { id, copyFrame: mapped.copyFrame ?? false };
}

const TILE_MAP: Record<number, MapEntry> = {
  594: { key: 'v_594_volcanolarge', copyFrame: true },
  593: { key: 'v_593_volcanosmall', copyFrame: true },
  565: { key: 'v_565_fogmachine', copyFrame: true },
  564: { key: 'v_564_plasmalamp', copyFrame: true },
  557: { key: 'v_557_grateclosed', copyFrame: true },
  546: { key: 'v_546_grate', copyFrame: true },
  531: { key: 'v_531_boulderstatue', copyFrame: true },
  509: { key: 'v_509_voidmonolith', copyFrame: true },
  497: { key: 'v_497_toilets', copyFrame: true },
  480: { key: 'v_480_bloodmoonmonolith', copyFrame: true },
  476: { key: 'v_476_golfhole', copyFrame: true },
  468: { key: 'v_468_fakecontainers2', copyFrame: true },
  455: { key: 'v_455_partymonolith', copyFrame: true },
  452: { key: 'v_452_sillyballoonmachine', copyFrame: true },
  445: { key: 'v_445_pixelbox', copyFrame: true },
  442: { key: 'v_442_projectilepressurepad', copyFrame: true },
  441: { key: 'v_441_fakecontainers', copyFrame: true },
  440: { key: 'v_440_gemlocks', copyFrame: true },
  429: { key: 'v_429_wirebulb', copyFrame: true },
  428: { key: 'v_428_weightedpressureplate', copyFrame: true },
  425: { key: 'v_425_announcementbox', copyFrame: true },
  424: { key: 'v_424_wirepipe', copyFrame: true },
  423: { key: 'v_423_logicsensor', copyFrame: true },
  421: { key: 'v_421_conveyorbeltleft', copyFrame: true },
  420: { key: 'v_420_logicgate', copyFrame: true },
  419: { key: 'v_419_logicgatelamp', copyFrame: true },
  410: { key: 'v_410_lunarmonolith', copyFrame: true },
  389: { key: 'v_389_tall_gate_open', copyFrame: true }, /* Tall Gate (Open) */
  386: { key: 'v_386_trapdooropen', copyFrame: true },
  372: { key: 'v_372_peacecandle', copyFrame: true },
  338: { key: 'v_338_fireworkfountain', copyFrame: true },
  335: { key: 'v_335_fireworksbox', copyFrame: true },
  268: { key: 'v_268_ambergemspark', copyFrame: true },
  267: { key: 'v_267_diamondgemspark', copyFrame: true },
  266: { key: 'v_266_rubygemspark', copyFrame: true },
  265: { key: 'v_265_emeraldgemspark', copyFrame: true },
  264: { key: 'v_264_sapphiregemspark', copyFrame: true },
  263: { key: 'v_263_topazgemspark', copyFrame: true },
  262: { key: 'v_262_amethystgemspark', copyFrame: true },
  261: { key: 'v_261_ambergemsparkoff', copyFrame: true },
  260: { key: 'v_260_diamondgemsparkoff', copyFrame: true },
  259: { key: 'v_259_rubygemsparkoff', copyFrame: true },
  258: { key: 'v_258_emeraldgemsparkoff', copyFrame: true },
  257: { key: 'v_257_sapphiregemsparkoff', copyFrame: true },
  256: { key: 'v_256_topazgemsparkoff', copyFrame: true },
  255: { key: 'v_255_amethystgemsparkoff', copyFrame: true },
  244: { key: 'v_244_bubblemachine', copyFrame: true },
  216: { key: 'v_216_firework', copyFrame: true },
  212: { key: 'v_212_snowballlauncher', copyFrame: true },
  210: { key: 'v_210_landmine', copyFrame: true },
  209: { key: 'v_209_cannon', copyFrame: true },
  174: { key: 'v_174_platinumcandle', copyFrame: true },
  173: { key: 'v_173_platinumcandelabra', copyFrame: true },
  149: { key: 'v_149_holidaylights', copyFrame: true },
  143: { key: 'v_143_outletpump', copyFrame: true },
  142: { key: 'v_142_inletpump', copyFrame: true },
  139: { key: 'v_139_musicboxes', copyFrame: true },
  131: { key: 'v_131_inactivestoneblock', copyFrame: true },
  126: { key: 'v_126_discoball', copyFrame: true },
  92: { key: 'v_92_lampposts', copyFrame: true },
  35: { key: 'v_35_jackolanterns', copyFrame: true },
  0: 'dirt',          // Dirt
  1: 'stone',         // Stone
  2: 'grass',         // Grass
  3: { key: 'v_3_forest_short_plants', copyFrame: true },  // Plants（花草杂草变体帧直拷）
  4: { key: 'torch', copyFrame: true },  // Torch（保留原版墙面/熄灭变体帧）
  5: { key: 'v_5_trees', copyFrame: true },  // Tree（原版 Tiles_5，22px 步长样式帧直拷）
  6: 'ore_iron',      // Iron
  7: 'ore_copper',    // Copper
  8: 'ore_gold',      // Gold
  9: 'ore_silver',    // Silver
  10: { key: 'door_closed', copyFrame: true },  // Closed Door（原版变体帧）
  16: 'anvil',        // Anvil(2×1,铁/铅两款 style)
  17: 'furnace',      // Furnace(3×2!曾误映射 anvil——导入的熔炉渲染成半格铁砧/拆除波及邻砧)
  18: 'workbench',    // Work Bench
  19: { key: 'platform', copyFrame: true },  // Wood Platform（原版帧直拷）
  21: 'chest',  // Chest（帧按格距重建，不直拷——wld 存的是格偏移 0/1 不是像素）
  53: 'sand',         // Sand
  59: 'mud',          // Mud
  73: { key: 'v_73_forest_tall_plants', copyFrame: true },  // Plants 2（高草，16×32 帧）
  147: 'snow',        // Snow
  // ---- 原版素材批次（Tiles_N 表 + TEdit framing） ----
  57: 'ash', 123: 'silt', 40: 'clay', 54: 'glass', 56: 'obsidian',
  38: 'gray_brick', 39: 'red_brick',
  161: 'ice', 162: 'thin_ice', 206: 'ice_brick', 148: 'snow_brick',
  396: 'sandstone', 397: 'hardened_sand', 404: 'desert_fossil',
  166: 'ore_tin', 167: 'ore_lead', 168: 'ore_tungsten', 169: 'ore_platinum',
  22: 'ore_demonite', 37: 'ore_meteorite', 58: 'ore_hellstone', 204: 'ore_crimtane',
  107: 'ore_cobalt', 108: 'ore_mythril', 111: 'ore_adamantite',
  221: 'ore_palladium', 222: 'ore_orichalcum', 223: 'ore_titanium', 211: 'ore_chlorophyte',
  63: 'gem_sapphire', 64: 'gem_ruby', 65: 'gem_emerald',
  66: 'gem_topaz', 67: 'gem_amethyst', 68: 'gem_diamond',
  // 家具（framed：18px 帧/样式直拷，渲染端原样使用）
  14: { key: 'table', copyFrame: true },
  15: { key: 'chair', copyFrame: true },
  79: { key: 'bed', copyFrame: true },
  33: { key: 'candle', copyFrame: true },
  34: { key: 'chandelier', copyFrame: true },
  42: { key: 'lantern', copyFrame: true },
  100: { key: 'candelabra', copyFrame: true },
  101: { key: 'bookcase', copyFrame: true },
  104: { key: 'grandfather_clock', copyFrame: true },
  87: { key: 'piano', copyFrame: true },
  88: { key: 'dresser', copyFrame: true },
  89: { key: 'bench', copyFrame: true },
  90: { key: 'bathtub', copyFrame: true },
  94: { key: 'keg', copyFrame: true },
  95: { key: 'chinese_lantern', copyFrame: true },
  96: { key: 'cooking_pot', copyFrame: true },
  98: { key: 'skull_lantern', copyFrame: true },
  78: { key: 'clay_pot', copyFrame: true },
  85: { key: 'tombstone_v', copyFrame: true },
  12: { key: 'crystal_heart', copyFrame: true },
  49: { key: 'water_candle', copyFrame: true },
  // 降级为 stone 的常见方块
  // ---- 全量补全（compat-report 驱动，187 种）----
  165: { key: 'v_165_cave_decos', copyFrame: true },  // Cave Decos
  51: 'v_51_cobweb',  // Cobweb
  368: 'v_368_granite_block',  // Granite Block
  226: 'v_226_lihzahrd_brick',  // Lihzahrd Brick
  367: 'v_367_marble_block',  // Marble Block
  184: { key: 'v_184_moss_plants', copyFrame: true },  // Moss Plants
  633: 'v_633_ash_grass_block',  // Ash Grass Block
  181: 'v_181_red_moss_block',  // Red Moss Block
  189: 'v_189_cloud_block',  // Cloud Block
  183: 'v_183_purple_moss_block',  // Purple Moss Block
  536: 'v_536_xenon_moss_block',  // Xenon Moss Block
  225: 'v_225_hive_block',  // Hive Block
  483: 'v_483_cracked_pink_brick',  // Cracked Pink Brick
  638: 'v_638_ash_vines',  // Ash Vines
  224: 'v_224_slush_block',  // Slush Block
  383: 'v_383_living_mahogany_block',  // Living Mahogany Block
  179: 'v_179_green_moss_block',  // Green Moss Block
  314: { key: 'v_314_minecart_track', copyFrame: true },  // Minecart Track
  384: 'v_384_living_mahogany_leaves_block',  // Living Mahogany Leaves Block
  185: { key: 'v_185_small_decos', copyFrame: true },  // Small Decos
  373: { key: 'v_373_water_drip', copyFrame: true },  // Water Drip
  273: 'v_273_stone_slab',  // Stone Slab
  187: { key: 'v_187_decos_3x2_group_2', copyFrame: true },  // Decos (3x2) (Group 2)
  484: { key: 'v_484_rolling_cactus', copyFrame: true },  // Rolling Cactus
  374: { key: 'v_374_lava_drip', copyFrame: true },  // Lava Drip
  381: 'v_381_lava_moss',  // Lava Moss
  48: 'v_48_spike',  // Spike
  192: 'v_192_living_leaf_block',  // Living Leaf Block
  191: 'v_191_living_wood_block',  // Living Wood Block
  233: { key: 'v_233_jungle_large_plants', copyFrame: true },  // Jungle Large Plants
  528: 'v_528_mushroom_vines',  // Mushroom Vines
  105: { key: 'v_105_statue', copyFrame: true },  // Statue
  186: { key: 'v_186_decos_3x2', copyFrame: true },  // Decos (3x2)
  196: 'v_196_rain_cloud_block',  // Rain Cloud Block
  461: { key: 'v_461_sand_drip', copyFrame: true },  // Sand Drip
  382: 'v_382_flower_vines',  // Flower Vines
  178: { key: 'v_178_gems', copyFrame: true },  // Gems
  118: 'v_118_pearlstone_brick',  // Pearlstone Brick
  485: { key: 'v_485_antlion_larva', copyFrame: true },  // Antlion Larva
  321: 'v_321_boreal_wood',  // Boreal Wood
  637: { key: 'v_637_ash_short_plants', copyFrame: true },  // Ash Short Plants
  444: { key: 'v_444_bee_hive', copyFrame: true },  // Bee Hive
  240: { key: 'v_240_wall_hangings_3x3', copyFrame: true },  // Wall Hangings 3x3
  152: 'v_152_ebonstone_brick',  // Ebonstone Brick
  124: 'v_124_wooden_beam',  // Wooden Beam
  158: 'v_158_rich_mahogany',  // Rich Mahogany
  519: { key: 'v_519_cattails', copyFrame: true },  // Cattails
  357: 'v_357_smooth_marble_block',  // Smooth Marble Block
  272: 'v_272_cog_block',  // Cog Block
  229: 'v_229_honey_block',  // Honey Block
  138: { key: 'v_138_boulder', copyFrame: true },  // Boulder
  634: { key: 'v_634_ash_tree', copyFrame: true },  // Ash Tree
  575: 'v_575_rich_mahogany_beam',  // Rich Mahogany Beam
  26: { key: 'v_26_altars', copyFrame: true },  // Altars
  311: 'v_311_dynasty_wood',  // Dynasty Wood
  130: 'v_130_active_stone_block',  // Active Stone Block
  82: { key: 'v_82_herbs_sprout', copyFrame: true },  // Herbs (Sprout)
  193: 'v_193_slime_block',  // Slime Block
  323: { key: 'v_323_palm_trees', copyFrame: true },  // Palm Trees
  190: 'v_190_glowing_mushroom_block',  // Glowing Mushroom Block
  350: 'v_350_martian_conduit_plating',  // Martian Conduit Plating
  369: 'v_369_smooth_granite_block',  // Smooth Granite Block
  135: { key: 'v_135_pressure_plates', copyFrame: true },  // Pressure Plates
  91: { key: 'v_91_banners', copyFrame: true },  // Banners
  242: { key: 'v_242_paintings_6x4', copyFrame: true },  // Paintings 6x4
  50: { key: 'v_50_books', copyFrame: true },  // Books
  93: { key: 'v_93_lamps', copyFrame: true },  // Lamps
  549: { key: 'v_549_seaweed', copyFrame: true },  // Seaweed
  137: { key: 'v_137_traps', copyFrame: true },  // Traps
  117: 'v_117_pearlstone_block',  // Pearlstone Block
  112: 'v_112_ebonsand_block',  // Ebonsand Block
  254: { key: 'v_254_pumpkin_plant', copyFrame: true },  // Pumpkin Plant
  571: { key: 'v_571_bamboo', copyFrame: true },  // Bamboo
  232: 'v_232_wooden_spike',  // Wooden Spike
  274: 'v_274_sandstone_slab',  // Sandstone Slab
  246: { key: 'v_246_paintings_3x2', copyFrame: true },  // Paintings 3x2
  213: 'v_213_rope',  // Rope
  245: { key: 'v_245_paintings_2x3', copyFrame: true },  // Paintings 2x3
  322: 'v_322_palm_wood',  // Palm Wood
  586: { key: 'v_586_emerald_tree', copyFrame: true },  // Emerald Tree
  596: { key: 'v_596_vanity_tree_sakura', copyFrame: true },  // Vanity Tree Sakura
  636: 'v_636_corrupt_vines',  // Corrupt Vines
  574: 'v_574_boreal_beam',  // Boreal Beam
  467: { key: 'v_467_chests_group_2', copyFrame: true },  // Chests (Group 2)
  109: 'v_109_hallowed_grass_block',  // Hallowed Grass Block
  443: { key: 'v_443_geyser', copyFrame: true },  // Geyser
  312: 'v_312_red_dynasty_shingles',  // Red Dynasty Shingles
  589: { key: 'v_589_amber_tree', copyFrame: true },  // Amber Tree
  411: { key: 'v_411_detonator', copyFrame: true },  // Detonator
  518: { key: 'v_518_lily_pads', copyFrame: true },  // Lily Pads
  588: { key: 'v_588_diamond_tree', copyFrame: true },  // Diamond Tree
  422: 'v_422_conveyor_belt_ccw',  // Conveyor Belt (CCW)
  585: { key: 'v_585_sapphire_tree', copyFrame: true },  // Sapphire Tree
  583: { key: 'v_583_topaz_tree', copyFrame: true },  // Topaz Tree
  13: { key: 'v_13_placed_bottles', copyFrame: true },  // Placed Bottles
  530: { key: 'v_530_oasis_plants', copyFrame: true },  // Oasis Plants
  495: 'v_495_shell_pile_block',  // Shell Pile Block
  479: 'v_479_smooth_sandstone_block',  // Smooth Sandstone Block
  616: { key: 'v_616_vanity_tree_yellow_willow', copyFrame: true },  // Vanity Tree Yellow Willow
  215: { key: 'v_215_campfires', copyFrame: true },  // Campfires
  141: { key: 'v_141_explosives', copyFrame: true },  // Explosives
  333: 'v_333_platinum_coin_pile',  // Platinum Coin Pile
  597: { key: 'v_597_pylons', copyFrame: true },  // Pylons
  592: { key: 'v_592_hanging_brazier', copyFrame: true },  // Hanging Brazier
  375: { key: 'v_375_honey_drip', copyFrame: true },  // Honey Drip
  227: { key: 'v_227_dye_plants', copyFrame: true },  // Dye Plants
  353: 'v_353_vine_rope',  // Vine Rope
  584: { key: 'v_584_amethyst_tree', copyFrame: true },  // Amethyst Tree
  231: { key: 'v_231_larva', copyFrame: true },  // Larva
  332: 'v_332_gold_coin_pile',  // Gold Coin Pile
  395: { key: 'v_395_item_frame', copyFrame: true },  // Item Frame
  241: { key: 'v_241_catacombs', copyFrame: true },  // Catacombs
  587: { key: 'v_587_ruby_tree', copyFrame: true },  // Ruby Tree
  86: { key: 'v_86_loom', copyFrame: true },  // Loom
  477: 'v_477_mowed_grass_block',  // Mowed Grass Block
  376: { key: 'v_376_fishing_crates', copyFrame: true },  // Fishing Crates
  470: { key: 'v_470_mannequins', copyFrame: true },  // Mannequins
  577: 'v_577_sandstone_column',  // Sandstone Column
  561: 'v_561_marble_column',  // Marble Column
  324: { key: 'v_324_seashells', copyFrame: true },  // Seashells
  81: { key: 'v_81_coral', copyFrame: true },  // Coral
  576: 'v_576_granite_column',  // Granite Column
  214: 'v_214_chain',  // Chain
  380: { key: 'v_380_planter_boxes', copyFrame: true },  // Planter Boxes
  136: { key: 'v_136_switch', copyFrame: true },  // Switch
  355: { key: 'v_355_alchemy_table', copyFrame: true },  // Alchemy Table
  354: { key: 'v_354_bewitching_table', copyFrame: true },  // Bewitching Table
  103: { key: 'v_103_bowls', copyFrame: true },  // Bowls
  529: { key: 'v_529_sea_oats', copyFrame: true },  // Sea Oats
  506: { key: 'v_506_bast_statue', copyFrame: true },  // Bast Statue
  349: { key: 'v_349_mushroom_statue', copyFrame: true },  // Mushroom Statue
  377: { key: 'v_377_sharpening_station', copyFrame: true },  // Sharpening Station
  613: { key: 'v_613_potted_lava_plants', copyFrame: true },  // Potted Lava Plants
  230: 'v_230_crispy_honey_block',  // Crispy Honey Block
  219: { key: 'v_219_extractinator', copyFrame: true },  // Extractinator
  388: { key: 'v_388_tall_gate_closed', copyFrame: true },  // Tall Gate (Closed)
  129: { key: 'v_129_crystal_shard', copyFrame: true },  // Crystal Shard
  466: { key: 'v_466_elder_cystal_stand', copyFrame: true },  // Elder Cystal Stand
  562: 'v_562_bamboo_block',  // Bamboo Block
  220: { key: 'v_220_solidifier', copyFrame: true },  // Solidifier
  303: { key: 'v_303_lihzahrd_furnace', copyFrame: true },  // Lihzahrd Furnace
  469: { key: 'v_469_tables_group_2', copyFrame: true },  // Tables (Group 2)
  304: { key: 'v_304_living_loom', copyFrame: true },  // Living Loom
  488: { key: 'v_488_fallen_log', copyFrame: true },  // Fallen Log
  548: { key: 'v_548_potted_trees_group_2', copyFrame: true },  // Potted Trees (Group 2)
  614: { key: 'v_614_potted_ember_tendrils', copyFrame: true },  // Potted Ember Tendrils
  598: { key: 'v_598_lava_serpent_bowl', copyFrame: true },  // Lava Serpent Bowl
  371: 'v_371_pink_slime_block',  // Pink Slime Block
  406: { key: 'v_406_chimney', copyFrame: true },  // Chimney
  305: { key: 'v_305_sky_mill', copyFrame: true },  // Sky Mill
  300: { key: 'v_300_bone_welder', copyFrame: true },  // Bone Welder
  302: { key: 'v_302_glass_kiln', copyFrame: true },  // Glass Kiln
  306: { key: 'v_306_ice_machine', copyFrame: true },  // Ice Machine
  247: { key: 'v_247_autohammer', copyFrame: true },  // Autohammer
  491: { key: 'v_491_void_vault', copyFrame: true },  // Void Vault
  463: { key: 'v_463_defenders_forge', copyFrame: true },  // Defender's Forge（bank3 储物）
  106: { key: 'v_106_sawmill', copyFrame: true },  // Sawmill
  642: { key: 'v_642_chlorophyte_extractinator', copyFrame: true },  // Chlorophyte Extractinator
  319: { key: 'v_319_ship_in_a_bottle', copyFrame: true },  // Ship in a Bottle
  487: { key: 'v_487_picnic_tables', copyFrame: true },  // Picnic Tables
  97: { key: 'v_97_safe', copyFrame: true },  // Safe
  668: 'v_668_the_dirtiest_block',  // The Dirtiest Block
  320: { key: 'v_320_seaweed_planter', copyFrame: true },  // Seaweed Planter
  405: { key: 'v_405_fireplace', copyFrame: true },  // Fireplace
  378: { key: 'v_378_target_dummy', copyFrame: true },  // Target Dummy
  218: { key: 'v_218_meat_grinder', copyFrame: true },  // Meat Grinder
  356: { key: 'v_356_enchanted_sundial', copyFrame: true },  // Enchanted Sundial
  114: { key: 'v_114_tinkerer_s_workshop', copyFrame: true },  // Tinkerer's Workshop
  578: 'v_578_mushroom_beam',  // Mushroom Beam
  237: { key: 'v_237_lihzahrd_altar', copyFrame: true },  // Lihzahrd Altar
  110: { key: 'v_110_hallow_short_plants', copyFrame: true },  // Hallow Short Plants
  621: { key: 'v_621_slice_of_cake', copyFrame: true },  // Slice of Cake
  387: { key: 'v_387_trap_door_closed', copyFrame: true },  // Trap Door (Closed)
  316: { key: 'v_316_blue_jellyfish_jar', copyFrame: true },  // Blue Jellyfish Jar
  125: { key: 'v_125_crystal_ball', copyFrame: true },  // Crystal Ball
  287: { key: 'v_287_ammo_box', copyFrame: true },  // Ammo Box
  294: { key: 'v_294_zebra_swallowtail_butterfly_jar', copyFrame: true },  // Zebra Swallowtail Butterfly Jar
  291: { key: 'v_291_ulysses_butterfly_jar', copyFrame: true },  // Ulysses Butterfly Jar
  292: { key: 'v_292_sulphur_butterfly_jar', copyFrame: true },  // Sulphur Butterfly Jar
  289: { key: 'v_289_purple_emperor_butterfly_jar', copyFrame: true },  // Purple Emperor Butterfly Jar
  172: { key: 'v_172_sinks', copyFrame: true },  // Sinks
  656: { key: 'v_656_glow_tulip', copyFrame: true },  // Glow Tulip
  113: { key: 'v_113_hallow_tall_plants', copyFrame: true },  // Hallow Tall Plants
  235: { key: 'v_235_teleporter', copyFrame: true },  // Teleporter
  567: { key: 'v_567_garden_gnome', copyFrame: true },  // Garden Gnome
  398: 'v_398_corrupt_hardened_sand_block',  // Corrupt Hardened Sand Block
  379: 'v_379_bubble',  // Bubble
  618: 'v_618_stone_accent_slab',  // Stone Accent Slab
  // 清空的装饰/不可表示物
  11: { key: 'door_open', copyFrame: true },  // Open Door（原版变体帧）
  28: { key: 'pot', copyFrame: true }, 29: { key: 'v_29_piggy_bank', copyFrame: true }, 30: 'wood',  // Pots(原版) / Piggy Bank(2×1 framed) / Wood→木材
  52: 'v_52_vines',
  // ★R16-2（2026-08-24）：55=Signs（TileID.cs:547）非"乐器架"——显式 null 曾把导入图的
  //  每一块牌物理删除（不是丢文本是丢 tile）；引擎侧 v_55_signs 注册齐全（tiles.ts:529
  //  framed 2×2 drop 171）且 Game.ts:16839 有完整牌编辑器。文本随 signs 段回填 save.signs
  55: { key: 'v_55_signs', copyFrame: true },
  62: 'v_62_jungle_vines', 69: 'v_69_jungle_thorns', // 丛林藤蔓/荆棘（61/74 丛林草在下行）
  61: 'v_61_jungle_short_plants', 74: 'v_74_jungle_tall_plants', 76: 'v_76_hellstone_brick', 77: { key: 'v_77_hellforge', copyFrame: true }, 80: 'v_80_cactus', // plants2→草 / 76=狱石砖 / 77=地狱熔炉(专属表) / 仙人掌
  83: { key: 'v_83_herbs_mature', copyFrame: true },  // Herbs (Mature)
  84: { key: 'v_84_herbs_bloom', copyFrame: true },  // Herbs (Bloom)
  // ---- FTW_V2 补全 ----
  625: 'v_625_neon_moss_block',  // Neon Moss Block
  151: 'v_151_sandstone_brick',  // Sandstone Brick
  234: 'v_234_crimsand_block',  // Crimsand Block
  182: 'v_182_blue_moss_block',  // Blue Moss Block
  205: 'v_205_crimson_vines',  // Crimson Vines
  45: 'v_45_gold_brick',  // Gold Brick
  399: 'v_399_crimson_hardened_sand_block',  // Crimson Hardened Sand Block
  352: 'v_352_crimtane_thorns',  // Crimtane Thorns
  248: 'v_248_palladium_column',  // Palladium Column
  340: 'v_340_living_cursed_fire_block',  // Living Cursed Fire Block
  207: { key: 'v_207_water_fountains', copyFrame: true },  // Water Fountains
  144: { key: 'v_144_timers', copyFrame: true },  // Timers
  475: { key: 'v_475_hat_rack', copyFrame: true },  // Hat Rack
  175: 'v_175_tin_brick',  // Tin Brick
  132: { key: 'v_132_lever', copyFrame: true },  // Lever
  // ---- 不负责任的女妖啤酒厂 补全 ----
  539: 'v_539_argon_moss_block',  // Argon Moss Block
  481: 'v_481_cracked_blue_brick',  // Cracked Blue Brick
  120: 'v_120_mudstone_brick',  // Mudstone Brick
  714: { key: 'v_714_spider_boulder', copyFrame: true },  // Spider Boulder
  752: { key: 'v_752_chillet_egg', copyFrame: true },  // Chillet Egg
  751: { key: 'v_751_sleeping_digtoise', copyFrame: true },  // Sleeping Digtoise
  664: { key: 'v_664_bouncy_boulder', copyFrame: true },  // Bouncy Boulder
  711: { key: 'v_711_rainbow_boulder', copyFrame: true },  // Rainbow Boulder
  715: { key: 'v_715_ghoulder', copyFrame: true },  // Ghoulder
  716: { key: 'v_716_friendly_boulder', copyFrame: true },  // Friendly Boulder
  713: { key: 'v_713_lava_boulder', copyFrame: true },  // Lava Boulder
  23: 'v_23_corrupt_grass_block',
  31: { key: 'v_31_orb_heart', copyFrame: true },  // Orb Heart（2×2 style 帧直拷）
  41: 'v_41_blue_brick', 43: 'v_43_green_brick',
  60: 'v_60_jungle_grass_block',
  70: 'v_70_mushroom_grass_block',
  25: 'v_25_ebonstone_block',  // Ebonstone Block
  202: 'v_202_sunplate_block', // Sunplate Block
  71: { key: 'v_71_mushroom_plant', copyFrame: true }, // Mushroom Plant
  72: { key: 'v_72_mushroom_tree', copyFrame: true },  // Mushroom Tree（U≥36 标记帧走 ShroomTop）
  24: { key: 'v_24_corruption_short_plants', copyFrame: true }, // Corruption Short Plants
  32: { key: 'v_32_corruption_thorns', copyFrame: true }, // Corruption Thorns
  27: { key: 'v_27_sunflower', copyFrame: true }, // Sunflower (2x4)
  44: 'v_44_pink_brick',  // Pink Brick
  203: 'v_203_crimstone_block',  // Crimstone Block
  201: { key: 'v_201_crimson_short_plants', copyFrame: true }, // Crimson Short Plants
  75: 'v_75_obsidian_brick',
  199: 'v_199_crimson_grass_block',
};

// 墙 id 直用原版 wld 墙 id（WALL_DEFS 已按 TEdit walls.json 全量注册 367 种）

/** TileID.Sets.SaveSlopes 门禁的非 solid 例外（TileID.cs:179/425-428：
 *  SaveSlopes = tileSolid ∪ {131,351,336,340,342,341,343,344}）。
 *  WorldFile.cs:2623 加载端只对 SaveSlopes 内的类型应用 half/slope——
 *  其余类型的 bits 4-6 直接丢弃（防止家具/装饰类杂波帧被切条/裁剪）
 *  ★BJ221 收编单源 data/tiles.ts:NON_SOLID_SAVE_SLOPES_SHEETS（sheet 域,§6k） */
const NON_SOLID_SAVE_SLOPES = NON_SOLID_SAVE_SLOPES_SHEETS;

/** 原版 Main.tileSolid 为 true 的平台族（Main.cs:8032 / 10117-10120 / 10123-10127：
 *  19 平台 + 427 竞技场平台 + 435-439 五色队伍平台）——vanilla SaveSlopes
 *  （TileID.cs:429-432 = tileSolid ∪ NonSolidSaveSlopes）因此**含平台**，wld
 *  平台坡度照存照载。★门禁不可用本仓 TILE_DEFS[].solid 近似：本仓碰撞域平台
 *  solid=false（tileSolidTop 语义）——曾致导入世界平台楼梯坡度全丢，残成
 *  「楼梯帧+slope=0」嵌合态（一档 576 格实证：渲染出孤立楼梯碎片、碰撞变平）。 */
// ★BJ182b 收编单源 data/tiles.ts:PLATFORMS_SHEETS(sheet 域;逐值对拍全等,tests/tile-domain-sentinel §6d)
const VANILLA_SOLID_PLATFORM_SHEETS = PLATFORMS_SHEETS;

// wld item id → 内部 item key:原 ITEM_MAP 覆盖表已整体移除——本地键段随本地物品退役,
// vi_ 段与 VANILLA_ITEM_KEY_BY_ID 完全冗余;且旧表曾把 71-74 钱币全折 coin_copper(面额缩水 bug)。
// 战利品解析一律走 VANILLA_ITEM_KEY_BY_ID(:918)。

export interface CompatEntry { id: number; name: string | null; count: number; action: string }
export interface CompatReport {
  worldName: string; wldVersion: number; size: [number, number];
  tilesDegraded: CompatEntry[];  // 未映射 tile → 降级石块
  tilesCleared: CompatEntry[];   // 映射为 null → 清空丢弃
  itemsSkipped: CompatEntry[];   // 宝箱内未映射物品 → 跳过
}
export interface ImportResult { save: SaveData; warnings: string[]; report: CompatReport; seedText: string; gameMode: number }

/** ★七批备案④-c（2026-09-02）/★SW-FX35（2026-09-11）扩八类：TileEntities 段挂物
 *  家具还原规格表——TE type byte（TileEntitiesManager.RegisterAll 序,
 *  TileEntitiesManager.cs:26-39）→ 本仓 kind。
 *  band = 各 TE ValidTile 的锚帧判据带宽（frameX%band==0 且 frameY==0；band=1=无
 *  frameX 条件）：
 *   471/475 → 54（TEWeaponsRack.cs:36 / TEHatRack.cs:409）
 *   395/470 → 36（TEItemFrame.cs:33 / TEDisplayDoll.cs:858）
 *   698     → 18（TEDeadCellsDisplayJar.cs:31-35 frameY==0 && frameX%18==0）
 *   520/723/724 → 1（TEFoodPlatter.cs:32-36 仅 frameY==0；锚桩 TEKiteAnchor.cs:21-27 /
 *   TECritterAnchor.cs:23-29 仅 type 判定,1×1 无帧条件） */
const TE_KIND_SPECS: ReadonlyArray<{ te: 1 | 3 | 4 | 5 | 6 | 8 | 9 | 10; key: string; kind: FurnitureKind; band: number }> = [
  { te: 4, key: 'v_471_weapon_rack', kind: 'weapon_rack', band: 54 },
  { te: 1, key: 'v_395_item_frame', kind: 'item_frame', band: 36 },
  { te: 3, key: 'v_470_mannequins', kind: 'display_doll', band: 36 },
  { te: 5, key: 'v_475_hat_rack', kind: 'hat_rack', band: 54 },
  // ★SW-FX35：运行时已有 kind 的四类补还原（此前 6/8 读位即弃=盘上食物/罐中物丢失,
  //  9/10 锚桩整类跳过且流错位——TELeashedEntityAnchorWithItem 短 itemType 勘误）
  { te: 6, key: 'v_520_plate', kind: 'food_platter', band: 1 },
  { te: 8, key: 'v_698_item_flask', kind: 'display_jar', band: 18 },
  { te: 9, key: 'v_723_kite_anchor', kind: 'kite_anchor', band: 1 },
  { te: 10, key: 'v_724_critter_anchor', kind: 'critter_anchor', band: 1 },
];

/** Chest.IsLocked（Chest.cs:295-310）帧区间判定：tile21 六段锁定带 + tile467
 *  style13（沙漠锁箱）。导入侧按锚帧推导 locked 旗——QuickStacking/vanillaRecipes/
 *  Extractinator 三处把 c.locked 当门（R21-chest §5 偏差②的导入面）。
 *  ★BJ377：正典位平移至 world/repairIndexFrames（存量锚修复与导入必须同源,
 *  防两份帧带漂移）;此处再导出保持既有 API（redblue-r21 等消费面不动）。 */
export { vanillaChestIsLocked } from '../world/repairIndexFrames';
import { vanillaChestIsLocked } from '../world/repairIndexFrames';

export function parseWldToSave(buf: Uint8Array): ImportResult {
  const wld: WldWorld = parseWld(buf);
  const warnings: string[] = [];
  const tileNames = vanillaTileNames;
  const itemNames = vanillaItemNames;
  const deg = new Map<number, number>(), clr = new Map<number, number>(), itm = new Map<number, number>();
  const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) ?? 0) + 1);

  const w = wld.tilesWide, h = wld.tilesHigh;
  const n = w * h;
  const type = new Uint16Array(n);
  const frameX = new Uint16Array(n);
  const frameY = new Uint16Array(n);
  const wall = new Uint16Array(n); // 原版墙 id 直存（0-366）
  const liquidArr = new Uint8Array(n);
  const liquidTypeArr = new Uint8Array(n);
  const wireArr = new Uint8Array(n);
  const halfArr = new Uint8Array(n);
  const slopeArr = new Uint8Array(n);
  const paintArr = new Uint8Array(n);
  const paintWallArr = new Uint8Array(n);
  const coatArr = new Uint8Array(n);

  const chestAt = new Map<string, { x: number; y: number }>();
  for (const c of wld.chests) chestAt.set(`${c.x},${c.y}`, c);

  let unmapped = 0;
  for (let i = 0; i < n; i++) {
    const wt = wld.tiles.type[i];
    if (wld.tiles.active[i]) {
      const mapped = TILE_MAP[wt];
      if (mapped === undefined) {
        // 未显式登记 → sheet 兜底（全量补齐后 753 sheet 全覆盖，正常不再走到降级）
        const fb = sheetFallback(wt);
        if (fb) {
          type[i] = fb.id;
          if (fb.copyFrame) { frameX[i] = wld.tiles.frameX[i]; frameY[i] = wld.tiles.frameY[i]; }
        } else {
          unmapped++;
          bump(deg, wt);
          type[i] = T.STONE;
        }
      } else if (mapped === null) {
        bump(clr, wt);
        type[i] = 0;
      } else if (typeof mapped === 'string') {
        type[i] = TILE_BY_KEY[mapped] ?? 0;
        // ★framed 图块(铁砧/工作台/火把/v_ 家具)同样要直拷原版帧——
        // 纯字符串映射此前不拷帧,2×1 铁砧右半格 (18,0) 丢失,每格都画左半边
        // ("只有一半的铁砧");火把墙挂变体/家具 style 帧也全丢。非 framed 方块帧无意义
        if (TILE_DEFS[type[i]]?.framed) {
          frameX[i] = wld.tiles.frameX[i];
          frameY[i] = wld.tiles.frameY[i];
        }
      } else {
        // 原版 framed 家具：18px 帧/样式偏移直拷（与 .wld 原生一致，渲染端零换算）
        type[i] = TILE_BY_KEY[mapped.key] ?? 0;
        if (mapped.copyFrame) {
          frameX[i] = wld.tiles.frameX[i];
          frameY[i] = wld.tiles.frameY[i];
        }
      }
    }
    // ★R-A-F4(2026-10-14):tML era mod 墙域(367+)钳零——.wld 内 mod 墙 id

    //  是【对方 load order】的槽位号,与本会话分配无对应=不可映射;透传

    //  会别名成本会话 mod 墙(SW↔SW 回环走自有 json 档)

    wall[i] = wld.tiles.wall[i] >= 367 ? 0 : wld.tiles.wall[i];; // 直拷原版墙 id
    const lq = wld.tiles.liquid[i];
    if (lq > 0) liquidArr[i] = lq;
    // 液体类型：parser 已按内部编码输出（1水 2岩浆 3蜂蜜），直拷
    if (lq > 0) liquidTypeArr[i] = wld.tiles.liquidType[i] || 1;
    // 电路位直拷（parser 已从 header2 提取 bit0-5）
    wireArr[i] = wld.tiles.wire[i];
    // half/slope 只对 SaveSlopes 类型应用（WorldFile.cs:2623/2637：tileSolid ∪ 非固体
    // 例外表；其余类型——家具/装饰/植物——bits 4-6 是杂波,不落地,防切条裁剪）。
    // ★tileSolid 以原版域判（平台族补集见 VANILLA_SOLID_PLATFORM_SHEETS 注）
    if (wld.tiles.half[i] || wld.tiles.slope[i]) {
      if (TILE_DEFS[type[i]]?.solid || VANILLA_SOLID_PLATFORM_SHEETS.has(wt)
        || NON_SOLID_SAVE_SLOPES.has(wt)) {
        halfArr[i] = wld.tiles.half[i];
        slopeArr[i] = wld.tiles.slope[i];
      }
    }
    // 油漆双通道直拷（WorldFile.cs:2571-2586 parser 已按 5bit 域解码；0=无漆）
    paintArr[i] = wld.tiles.paint[i];
    paintWallArr[i] = wld.tiles.paintWall[i];
    coatArr[i] = wld.tiles.coat[i];   // 涂层四位（WF:2659-2677 header4）
    // 废弃荧光漆迁移（ConvertIlluminantPaintToNewField，WorldFile.cs:2806-2825）
    // ★R16-11：迁移门 = wldVersion < 258（WF57:1864-1866）——1457 里 31 仍是现行
    //  IlluminantPaint（PaintID.cs:67/69）,v258+ 档合法持有 31 曾被无条件改写
    if (wld.version < 258) {
      if (paintArr[i] === 31) { paintArr[i] = 0; coatArr[i] |= 8; }
      if (paintWallArr[i] === 31) { paintWallArr[i] = 0; coatArr[i] |= 16; }
    }
  }
  if (unmapped > 0) warnings.push(`${unmapped} 个未知 tile 已降级为石块`);

  // ★七批备案④收尾（2026-09-02）：334 legacy 武器架持武还原。
  //  原版 334（TileID.cs:1105 WeaponsRack；现行 471=WeaponsRack2 :1379）把架上武器
  //  直接嵌在帧里（TE 出现前的 1.2 存物通道，1.4.5.7 仍可交互）：
  //  写入 = Player.PlaceWeapon（Player.cs:54721-54813）：命中格归一到标记行
  //  （:54723-54734 frameY/18==1）后写同行两格帧标记——
  //    锚格（col0）frameX = itemType + num5 + 100（:54797，num5=5000）；
  //    朝向 alternate（PlaceRight，裸架 base=54）改用二带 num5=20000（:54789-54794）
  //    前缀格（col1）frameX = prefix + num6（:54798，num6=10000 / 二带 25000）。
  //  读取 = KillTile_DropItems（WorldGen.cs:64122-64164）：剥 5000 系定列
  //  （:64126-64136）、itemType=锚 frameX%5000-100（:64145-64146）、
  //  prefix=右邻 frameX-10000/25000 两带式（:64147-64149），掉武器后帧还原裸架
  //  （:64155-64162 base=(n5000-1)*18、前缀格=base+18）。TEdit 独立同式解码
  //  （WorldRenderXna.xaml.cs:4669-4675 weapon=(U%5000)-100）。
  //  导入侧：解码 → materialize furnitureItems 的 weapon_rack 单槽记录（本仓 TE
  //  等价物，FURNITURE_TILE_KIND 已收 334 → 破坏弹物/右键取放/渲染叠画全链生效），
  //  同时把两格帧还原裸架态（此后渲染/锚点归一/支撑检全走裸帧；Game wallhang 支
  //  m-4 的 5000 系剥离退居历史档兜底）。 itemType≥4900 时锚帧 ≥10000 会被剥系
  //  误判成 col1（vanilla 同款歧义：其解码 :64146 恒出负 id 不掉）——按「左邻无标记
  //  且右邻有标记」的帧对签名救回。解码失败/未知物品 → 保守清标记并计数登记
  //  （itemsSkipped/warnings），不造幽灵物品。
  const RACK334 = TILE_BY_KEY['v_334_weapon_rack_legacy_do_not_use'];
  const furnitureSave: NonNullable<SaveData['furniture']> = [];
  let rackDecodeFail = 0;
  if (RACK334 !== undefined) {
    for (let i = 0; i < n; i++) {
      if (type[i] !== RACK334) continue;
      const fx = frameX[i];
      if (fx < 5000) continue;               // 无标记裸架：帧原样保留，不物化
      const row = frameY[i];
      if (row % 18 !== 0 || row > 36) continue;   // 非 18px 行带帧=杂波
      const x = i % w;
      // 列分类（WorldGen.cs:64126-64136 同式剥 5000 系）：col0=锚格 col1=前缀格
      let v = fx, cnt = 0;
      while (v >= 5000) { v -= 5000; cnt++; }
      if (cnt !== 0) v = (cnt - 1) * 18;
      const col = Math.floor((v % 54) / 18);
      if (col === 2) continue;
      if (col === 1) {
        // 前缀格不独立成件。仅当「左邻无标记 且 右邻(col1 带标记)」时本格才是被
        // 剥系误判的高段锚格；其余（左邻有标记=正常前缀格 / 右邻无标记=孤儿标记）
        // 不物化，孤儿帧归位裸架后计数。
        const leftMarked = x > 0 && type[i - 1] === RACK334 && frameY[i - 1] === row
          && frameX[i - 1] >= 5000;
        const rightMarked = x + 1 < w && type[i + 1] === RACK334 && frameY[i + 1] === row
          && frameX[i + 1] >= 10000;
        if (leftMarked || !rightMarked) {
          if (!leftMarked && !rightMarked) {   // 孤儿前缀标记（外部工具产物）
            frameX[i] = fx >= 25000 ? 72 : 18;
            rackDecodeFail++;
          }
          continue;
        }
      }
      // 解码：band 按帧值定——锚帧 = itemType + num5 + 100（num5=5000/20000，
      // Player.cs:54789-54797）⇒ vid = fx-5100 / fx-20100；不用 %5000 余数式
      // （WorldGen.cs:64146 的等价式）规避 ≥4900 段回绕歧义
      const vid = fx < 20000 ? fx - 5100 : fx - 20100;
      let prefix: number | undefined;
      if (x + 1 < w) {
        const fx2 = frameX[i + 1];
        const p = fx2 >= 25000 ? fx2 - 25000 : fx2 >= 10000 ? fx2 - 10000 : -1;
        if (p >= 0 && p <= 255) prefix = p;    // 非 byte 域=损坏 → 保武器弃词缀
      }
      const key = vid > 0 ? VANILLA_ITEM_KEY_BY_ID[vid] : undefined;
      const iid = key !== undefined ? ITEM_BY_KEY[key] : undefined;
      const topY = Math.floor(i / w) - row / 18;   // 记录锚=物件左上格（中行标记 → 上一行）
      if (iid === undefined) {
        if (vid > 0) bump(itm, vid); else rackDecodeFail++;
      } else if (topY >= 0) {
        furnitureSave.push({
          x, y: topY, kind: 'weapon_rack',
          slots: [{ id: iid, stack: 1, ...(prefix !== undefined && prefix > 0 ? { prefix } : {}) }],
        });
      }
      // 帧还原裸架态（WorldGen.cs:64155-64162；base=朝向带 0/54，前缀格=base+18）
      const base = fx < 20000 ? 0 : 54;
      frameX[i] = base;
      if (x + 1 < w && type[i + 1] === RACK334) frameX[i + 1] = base + 18;
    }
    if (rackDecodeFail > 0) warnings.push(`${rackDecodeFail} 个武器架持武帧标记损坏已清除`);
  }

  // ★七批备案④-c（2026-09-02）：TileEntities 段挂物家具还原（471 武器架/395 物品框/
  //  470 模特/475 帽架）。原版链（WorldFile.cs:3330-3372 LoadTileEntities）：读段 →
  //  同位去重（:3339-3342 后写覆盖前者）→ InWorld/CheckValidTile 淘汰（:3349-3356）。
  //  各 TE 的 ValidTile 保证 Position 即物件左上锚（帧锚判据见 TE_KIND_SPECS 注）。
  //  导入侧镜像同判据（tile 映射后内部 id 一致 + frameY==0 + frameX%band==0）→
  //  物化 furnitureSave 记录（kind 槽位模型与 serialize furniture 段同构；vid→key→
  //  内部 id 映射同上 334 链）。槽位对表（FurnitureItems.ts 头注布局）：
  //    模特 19 槽 = equip[9]→0..8 + misc[1]→9 + dyes[9]→10..18（TEDisplayDoll.cs:157-278）
  //    帽架 4 槽 = hat[2]→0..1 + dye[2]→2..3（TEHatRack.cs:56-111）
  //    框/架 1 槽 = item→0
  //  脱节/未映射物品 → 跳过计数（原版淘汰面同源），不造幽灵物品。
  //  ★SW-FX35：另收 0/2/7 三类透传快照 teSnap（假人/传感器/晶塔本仓不建模）
  const teSnap: NonNullable<SaveData['teSnap']> = [];
  if (wld.tileEntities.length) {
    const teByPos = new Map<number, WldTileEntity>();
    for (const te of wld.tileEntities) teByPos.set(te.y * w + te.x, te);   // 同位后者覆盖（WF:3339-3342）
    const mapTeItem = (it: WldTeItem | null | undefined): { id: number; stack: number; prefix?: number } | null => {
      if (!it || it.vid <= 0) return null;
      const key = VANILLA_ITEM_KEY_BY_ID[it.vid];
      const iid = key !== undefined ? ITEM_BY_KEY[key] : undefined;
      if (iid === undefined) {
        bump(itm, it.vid);          // 未收录物品：与 chests/334 同口径登记（itemsSkipped）
        return null;
      }
      // TE 槽位 stack 恒为放置单件（TryPlacing stack=1）；钳制防御脏档
      return { id: iid, stack: Math.max(1, Math.min(999, it.stack)), ...(it.prefix > 0 ? { prefix: it.prefix } : {}) };
    };
    let teInvalid = 0;
    // ★SW-FX35：本仓不建模的三类（0 训练假人/2 逻辑传感器/7 晶塔）透传存底，
    //  导出回写零漂移（TE 位置域以同位覆盖后的 teByPos 为准,WF:3339-3342 同源）
    for (const te of teByPos.values()) {
      const spec = TE_KIND_SPECS.find((s) => s.te === te.type);
      if (!spec) {
        if (te.type === 0 || te.type === 2 || te.type === 7) {
          teSnap.push(te.type === 0 ? { type: 0, x: te.x, y: te.y, npc: te.dummy?.npc ?? -1 }
            : te.type === 2 ? { type: 2, x: te.x, y: te.y, logicCheck: te.sensor?.logicCheck ?? 0, on: te.sensor?.on ?? false }
            : { type: 7, x: te.x, y: te.y });
        }
        continue;
      }
      const tid = TILE_BY_KEY[spec.key];
      const ai = te.y * w + te.x;
      if (tid === undefined || type[ai] !== tid || frameY[ai] !== 0 || frameX[ai] % spec.band !== 0) {
        teInvalid++;
        continue;
      }
      const slots: NonNullable<SaveData['furniture']>[number]['slots'] = new Array(furnitureSlotCount(spec.kind)).fill(null);
      const put = (i: number, it: WldTeItem | null | undefined) => {
        const m = mapTeItem(it);
        if (m) slots[i] = m;
      };
      if (te.item) put(0, te.item);
      // ★SW-BO1 2026-09-07（SW-BL1 P1）：模特姿态 _pose 入库（原版 WriteExtraData
      //  v307+ byte,TEDisplayDoll.cs:184；此前解析后即弃,导入世界姿态归零）
      if (te.doll) {
        te.doll.equip.forEach((it, i) => put(i, it));
        put(9, te.doll.misc);
        te.doll.dyes.forEach((it, i) => put(10 + i, it));
      }
      if (te.hat) {
        te.hat.hats.forEach((it, i) => put(i, it));
        te.hat.dyes.forEach((it, i) => put(2 + i, it));
      }
      // 记录准入：有存物或【模特带非零姿态】（空模特姿态件原版同样落 TE,丢弃=姿态丢）
      if (slots.some(Boolean) || (te.doll != null && te.doll.pose > 0)) {
        furnitureSave.push({ x: te.x, y: te.y, kind: spec.kind, slots, ...(te.doll ? { pose: te.doll.pose } : {}) });
      }
    }
    if (teInvalid > 0) warnings.push(`${teInvalid} 个挂物家具 TE 与地形脱节已跳过`);
  }

  // 宝箱：转内部格式（锚点 + 战利品）。
  // ★R21（2026-08-24）：帧【保留原样】——tile 循环(:486-489 framed 直拷)已按原版
  //  像素帧写入（wld 存的就是 style*36 带 + 0/18 格偏移,parser :590 直拷）,
  //  此段曾强写 style0 木箱四格帧 → 金箱/暗影箱/群系锁箱/神庙箱全变无锁木箱:
  //  IsLocked 帧区间、破坏掉落表(vanillaStyleDrops.Doors 同款 Chests 表)、渲染三链
  //  同错(tile467 却 copyFrame:true 同族两种待遇,R21-chest §9)。仅当登记箱坐标处
  //  tile 循环没产出 chest 时兜底补 type(帧不动)。锁态按锚帧推导(Chest.IsLocked
  //  cs:295-310 六段帧区间+467 style13)——QuickStacking/vanillaRecipes/Extractinator
  //  三处消费 c.locked 当门,导入锁箱不再白给。
  const CHEST_TILE = TILE_BY_KEY['chest'];
  // ★合法容器族(2026-09-07 蓝队门1):箱锚兜底原判定 `type!==CHEST_TILE` 把合法
  //  箱变体(467 群系箱族/88 梳妆台族——原版 Container 三族,帧带 144/486 各自成带)
  //  强改成木箱 21(33 格实测,外来帧值落 21 的 locked 带)。兜底只该补「真脱节」
  //  (锚格是空气/降级石),合法容器一律不动。
  // ★BJ203 收编单源 data/tiles.ts:IS_A_CONTAINER_SHEETS（TileID.cs:409;逐值对拍全等,§6h）
  const CONTAINER_SHEETS = IS_A_CONTAINER_SHEETS;
  const isContainerTile = (id: number): boolean => {
    const sh = TILE_DEFS[id]?.vanilla?.sheet;
    return sh !== undefined && CONTAINER_SHEETS.has(sh);
  };
  const chests: SaveData['chests'] = [];

  for (const c of wld.chests) {
    const anchor = c.y * w + c.x;
    if (!isContainerTile(type[anchor])) {
      // 兜底：登记箱与图格脱节（罕见——tile 被降级/清空）才补 type，不覆写帧
      type[anchor] = CHEST_TILE;
      if (c.x + 1 < w && type[c.y * w + c.x + 1] === 0) type[c.y * w + c.x + 1] = CHEST_TILE;
      if (c.y + 1 < h && type[(c.y + 1) * w + c.x] === 0) type[(c.y + 1) * w + c.x] = CHEST_TILE;
      if (c.x + 1 < w && c.y + 1 < h && type[(c.y + 1) * w + c.x + 1] === 0) type[(c.y + 1) * w + c.x + 1] = CHEST_TILE;
    }
    const items: Array<{ id: number; stack: number } | null> = [];
    // ★R21 续 R16-6：原版箱 maxItems=40（Chest.cs:58/:185-188）——内部箱模型本批已扩到
    //  40 槽（CHEST_MAX_ITEMS,Game.ts 放置/联机同批），导入全量接收不再截断
    for (const it of c.items.slice(0, CHEST_MAX_ITEMS)) {
      if (!it) { items.push(null); continue; }
      const key = VANILLA_ITEM_KEY_BY_ID[it.id];
      if (key && ITEM_BY_KEY[key] !== undefined) {
        items.push({ id: ITEM_BY_KEY[key], stack: Math.min(999, it.stack) });
      } else {
        bump(itm, it.id);
        items.push(null);
      }
    }
    while (items.length < CHEST_MAX_ITEMS) items.push(null);
    const anchorSheet = TILE_DEFS[type[anchor]]?.vanilla?.sheet ?? -1;
    const locked = vanillaChestIsLocked(anchorSheet, frameX[anchor]) || undefined;
    // ★SW-FX11（2026-09-10）：箱名透传（原版 WF:1660 `writer.Write(chest.name)` 随箱段
    //  持久;WldParser 已读进 WldChest.name,曾在此丢弃）。重命名 UI 未实装（UI.ts:7358
 	//  债）,但导入→存档→导出环零漂移自此成立
    chests.push({ x: c.x, y: c.y, items, locked, name: c.name || undefined });
  }

  // 时间换算（★R16-4 2026-08-24）：Main.time 是逐帧 +1/60 的**小数量纲**
  //  （MN57:1250/1252 dayLength=54000/nightLength=32400,昼起点 4:30AM=time 0）——
  //  昼 0.1875 + time/54000×0.5、夜 0.6875 + time/32400×0.5。旧 `% 1` 只取小数部分
  //  （把 54000 量纲当 0..1 比例）→ 昼档恒落 4:30AM±30 游戏分、**夜档回绕进白天**
  //  （存档时黑夜进游戏变白天,血月/夜行怪判定全错）
  let timeOfDay: number;
  if (wld.dayTime) {
    timeOfDay = 0.1875 + (wld.time / 54000) * 0.5;
  } else {
    timeOfDay = 0.6875 + (wld.time / 32400) * 0.5;
  }
  timeOfDay = timeOfDay % 1;

  // ★物品统一稳定 id 域(2026-09-07):宝箱/挂物家具(含 TE 槽/模特装备染料)三源收口
  //  ——域契约与 serializeSave 一致,loadSaveData/exportWld 的 stable 假设恒真。
  //  未注册 id 归 0(空槽;与 loadSaveData 侧 `?? 0` 同归)。
  const stItem = (id: number): number => (id === 0 ? 0 : (ITEM_STABLE_OF_INTERNAL[id] ?? 0));
  for (const c of chests) for (const it of c.items) if (it) it.id = stItem(it.id);
  for (const f of furnitureSave) for (const it of f.slots) if (it) it.id = stItem(it.id);

  // ★虚化位随档(2026-09-07 终版,五修):wld 流的 inActive 位=原版致动器机制——
  //  「active+inActive」格=玩家用致动器虚化的方块(本仓 flags=1+wire bit5,
  //  渲染 0.3 淡显=原版 DrawInactive 语义),wire 通道直拷即随档保真,
  //  **不进 tileActive 差分**(曾把致动格全标成幽灵 v=1 → flags=0 完全消失,
  //  用户实报「隐藏层不见了」)。v5 幽灵(worldgen 遗留 flags=0+type≠0,不可见)
  //  在 wld 流中无表达,导出侧丢弃(视觉零差异,登记债)。

  // ★IIIII228 FixEndlessRainWorlds legacy 迁移（WorldFile.cs:3299-3312，读档序列
  //  LoadWorld_Version2/3 后同位调用）——v≤317 且 rainTime≥5184000（rainsForAYear
  //  置的永雨值 60×60×24×60=5184000）且种子串不含 rainsForAYear → 清雨三件套
  //  （_tempRaining=false/_tempRainTime=0/_tempMaxRain=0）。vanilla 1.4.4 前
  //  rainTime 单位为 tick、1.4.4 起为秒——5184000t=24h 永雨是旧档遗留假永雨,
  //  非本种子导入即清。种子判定 = header 种子文本 parseSeedChain 并集（本文件
  //  seedFlags 双源并集①源,与 section 权威位②源同口径——rainsForAYear 在位面
  //  二源本应一致,并集宽松侧=不清雨,与原文 Check 命中即 return 对齐）。
  const ewrSeedFlags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(parseSeedChain(wld.seed).flags)) if (v) ewrSeedFlags[k] = true;
  for (const [k, v] of Object.entries(wld.seedFlags ?? {})) if (v) ewrSeedFlags[k] = true;
  const ewrFixRain = wld.version <= 317 && (wld.weather?.rainTime ?? 0) >= 5184000
    && !ewrSeedFlags.rainsForAYear;

  // ★SW-FX35：旅程力量 per-world 段（WldParser.creativePowers,CreativePowerManager.cs:
  //  125-137 帧式）→ header.journeyPowers 落地值。曾整段跳过 → 导入档冻结时间/雨/风/
  //  停止蔓延/难度滑杆/时间倍率全回默认。值域换算（读侧 CreativePowers.cs 同构）：
  //   id 8 ModifyTimeRate：Save 写滑杆缓存 0-1（:972-975）,TargetTimeRate =
  //   round(Remap(cache,0,1,1,24))（:876-878）→ 本仓 journeyTimeRate 存整档,
  //   导入反解 rate=round(1+23·cache)、导出正解 cache=(rate-1)/23。
  //   id 0/9/10/13 bool 直落；id 12 DifficultySlider 滑杆 0-1 原值（本仓
  //   journeyPowers.difficultySlider 同域,serialize.ts 注记「原始 float」）。
  //   ★roundEven：vanilla UpdateInfoFromSliderValueCache 用 .NET Math.Round
  //   （银行家舍入,中点取偶）——JS Math.round 中点恒上取,cache 恰 0.5 时 12/13 分歧。
  const roundEven = (x: number): number => {
    const fl = Math.floor(x), d = x - fl;
    if (d > 0.5) return fl + 1;
    if (d < 0.5) return fl;
    return fl % 2 === 0 ? fl : fl + 1;
  };
  const journeyLanding: Partial<SaveData['header']> = (() => {
    if (!wld.creativePowers.length) return {};
    const pw = new Map<number, number | boolean>();
    for (const p of wld.creativePowers) pw.set(p.id, p.bool !== undefined ? p.bool : (p.num ?? 0));
    const b = (id: number): boolean | undefined => pw.get(id) as boolean | undefined;
    const f = (id: number): number | undefined => pw.get(id) as number | undefined;
    const rate = f(8);
    return {
      journeyFreezeTime: b(0) ?? false,
      journeyTimeRate: rate !== undefined ? roundEven(1 + 23 * Math.min(1, Math.max(0, rate))) : undefined,
      journeyPowers: {
        freezeRain: b(9) ?? false,
        freezeWind: b(10) ?? false,
        stopBiomeSpread: b(13) ?? false,
        difficultySlider: Math.min(1, Math.max(0, f(12) ?? 0)),
      },
    };
  })();

  const save: SaveData = {
    format: 'sandboxworld.save',
    // ★v3(2026-09-07 统一稳定域):产物 tiles/items=稳定 id,读档端(v3 分支做
    //  INTERNAL_OF_STABLE 还原)必须按 v3+ 解释,否则 furniture/chests 的稳定 id
    //  被当内部 id 直读=错件(glowstick 替铁短剑,weapon-rack 测试实证)。曾 v2:
    //  「墙已是原版 id 语义,低于 2 触发旧墙值迁移」——3>2 同样不触发 ✓
    version: 3,
    header: {
      name: wld.title || '导入的地图',
      // ★R16-5：数值种子 = seed 文本经 TranslateSeed 派生（rng.ts:199 与原版
      //  WorldFileData.TranslateSeed 1:1）——旧 header.seed=0 → 洞穴背景四区/树冠
      //  变体等一切 seed 派生视觉与原档不一致
      seed: translateSeed(wld.seed),
      width: w,
      height: h,
      spawn: [wld.spawnX, wld.spawnY],
      dungeonX: wld.dungeonX, dungeonY: wld.dungeonY,
      groundLevel: Math.floor(wld.groundLevel),
      rockLevel: Math.floor(wld.rockLevel),
      // ★SW-FX43：原版 CreationTime ticks→ms 建世界日期真值（曾 Date.now()=导入日;
      //  ticks/10000 = ms;0（<141 旧档）回退导入时刻。f64 精确域:ticks<2^53/1e4 恒成立——
      //  实际 ticks~6.4e17 除后 ~6.4e12 < 2^53 ✓）
      created: wld.creationTime > 0n ? Number(wld.creationTime / 10000n) : Date.now(),
      playTimeMs: 0,
      wldVersion: wld.version,
      // ★SW-FX43：原版 worldId（WF header :1244 写/:1977 读）——loadSaveData 回填
      //  world.worldId,导出 header+footer 同值（LoadFooter :3003-3015 硬校验同值）
      worldId: wld.worldId,
      // ★SW-FX43：caveBackX[3]（WF:1266-1268;原版 RandomizeCaveBackgrounds
      //  WorldGen.cs:8141-8210 独立掷,与 treeX 无派生关系）——曾读位即弃 →
      //  导出按 treeX 派生=导入档漂移（FX33 登记债本刀清偿）
      caveBackX: wld.caveBackX,
      treeX: wld.treeX,
      treeStyle: wld.treeStyle,
      treeTops: wld.treeTops?.length ? wld.treeTops : undefined,
      crimson: wld.isCrimson,
      moonType: wld.moonType,
      // 彩蛋种子旗标回填（双源并集，★IIIIIII18 F-1）：
      //  ① 派生源 = header seed 文本过 parseSeedChain（与新创建世界同一解析层）。
      //     section 位只覆盖九特殊 + dualDungeons/moreLightning/noLightning 五位；
      //     37 枚明文秘种子（`hocus pocus|…` 型密码组）在原版的唯一持久面就是
      //     header 种子串文本（UIWorldCreation.FinishCreatingWorld cs:1004-1008
      //     `join('|')` 协议，含 SetSeedToRandomWithCurrentEvents :423 的
      //     "pumpkinseason|" 前缀与自写重复段），曾只读位即弃 → 秘种子导入整枚丢失。
      //  ② 权威位 = parser 从 section 读出的 wld.seedFlags（vanilla 持久真值）后并。
      //     两源均只落真值（union 即无冲突）；getfixedboi 类组合态由文件位全量
      //     还原（其种子串实存纯数字底种，派生源为空集不干扰）。
      //  仅真值落键；空集保持 undefined（普通世界与旧档缺省同形，零漂移）。
      //  单元测试：tests/wld-secret-seed-import.test.ts（硬等断言）。
      seedFlags: (() => {
        const merged: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parseSeedChain(wld.seed).flags)) if (v) merged[k] = true;
        for (const [k, v] of Object.entries(wld.seedFlags)) if (v) merged[k] = true;
        return Object.keys(merged).length ? merged : undefined;
      })(),
      // 世界难度（WldParser.ts:108-111 gameMode 位；Main.cs:2677）——
      // 0 经典 1 专家 2 大师 3 旅程，loadSaveData 回填 world.difficulty
      difficulty: wld.gameMode,
      // 日晷/月晷快进四件套（WF:2120/2203/2449-2450）——曾整组丢弃
      sundialCooldown: wld.sundialCooldown,
      moondialCooldown: wld.moondialCooldown,
      fastForwardTimeToDawn: wld.fastForwardTimeToDawn,
      fastForwardTimeToDusk: wld.fastForwardTimeToDusk,
      // ★SW-FX35：旅程力量 per-world 段落地（上方 journeyLanding 值域换算）
      ...journeyLanding,
      // ★R16-5：背景样式 13 档全量（setBG 0-12）——曾读位即弃 → 腐化/丛林/雪原/
      //  地狱/蘑菇背景样式全部回退 seed-0 默认
      bgStyles: {
        cave: [...wld.caveBackStyle],
        ice: wld.iceBackStyle, jungle: wld.jungleBackStyle, hell: wld.hellBackStyle,
        mushroom: wld.bgMushroom, underworld: wld.bgUnderworld,
        bg10: wld.bg10, bg11: wld.bg11, bg12: wld.bg12,
        desert: wld.desertBG, ocean: wld.oceanBG,
        // ★P0-2 配套勘误(2026-09-07 红队):WF:2316-2318 的「四区全塞 treeBG1」是
        //  v≤195 else 分支;v≥204 读进 bg10/11/12 即 treeBG2/3/4(WorldGen setBG
        //  同一存储)——映射 [treeBG1, bg10, bg11, bg12](旧写恒 treeBG1×4,四区
        //  森林背景 2-4 区全错)
        forest: [wld.treeBG1, wld.bg10, wld.bg11, wld.bg12],
        // ★SW-FX43：jungleBG 键补齐（WF:1327 setBG(2) 地表丛林背景 0-6）——BG 表
        //  曾缺键（WldHeaderFields :133 登记偏差「无键写 0」）,导入档丛林背景导出即丢。
        //  ★与 BG.jungle（WF:1274 jungleBackStyle 地下丛林）不同族,键名按原版全名
        corrupt: wld.corruptBG, snow: wld.snowBG, hallow: wld.hallowBG, crimson: wld.crimsonBG,
        jungleBG: wld.jungleBG,
      },
    },
    // 拜月教石碑重生倒计时（WF:2185-2192，SaveData 顶层字段）——2026-08-13 前
    // 导入路直接丢弃（回退 86400 缺省）
    cultistDelay: wld.cultistDelay,
    // 旗帜击杀计数（WF:1347/:2210 BannerSystem 段 → SaveData 顶层 bannerKills，
    // loadSaveData 回填 world.bannerKills）——此前 WldParser 读位即弃 → 原版世界
    // 导入后旗击杀计数清零（旗 buff 加成/达标授予丢失）。键域 = banner id，
    // 与自有存档 SaveData.bannerKills 同域（WldParser 仅落非零项）
    bannerKills: wld.bannerKills,
    clock: { timeOfDay, dayCount: 1,
      // 原版 header _temp 三件套（WF:1276-1278）+ moonType（WF:1252）
      bloodMoon: wld.bloodMoon, eclipse: wld.eclipse, moonPhase: wld.moonPhase },
    // ★SW-FX33（2026-09-11）：派对/灯笼夜 header 态透传（WldParser.party/lantern 捕获,
    //  WF:1367-1374/:1387-1390）——曾读位即弃 → 导入档派对进行中（manual/genuine/
    //  cooldown/celebrating 名单）与灯笼夜（cooldown/genuine/manual/next）全丢,再导出
    //  恒写空。celebrating 保持原版 netId 域（与 SaveData.events.partyCelebratingNpcs
    //  契约一致;消费面 Game.eventsApplySave 经 TOWN_NPC_IDS 反查 key）
    events: wld.party || wld.lantern ? {
      partyManual: wld.party?.manual ?? false,
      partyGenuine: wld.party?.genuine || undefined,
      partyCooldown: wld.party?.cooldown ?? 0,
      partyCelebratingNpcs: wld.party?.celebrating.length ? [...wld.party.celebrating] : undefined,
      lanternManual: wld.lantern?.manual ?? false,
      lanternGenuine: wld.lantern?.genuine ?? false,
      lanternNext: wld.lantern?.next ?? false,
      lanternCooldown: wld.lantern?.cooldown ?? 0,
    } : undefined,
    weather: wld.weather ? {
      // ★IIIII228：legacy 永雨迁移（FixEndlessRainWorlds,见上 ewrFixRain）
      raining: ewrFixRain ? false : wld.weather.raining,
      rainTime: ewrFixRain ? 0 : wld.weather.rainTime,
      maxRaining: ewrFixRain ? 0 : wld.weather.maxRaining,
      cloudBGActive: wld.weather.cloudBGActive,
      numClouds: wld.weather.numClouds,
      windSpeedTarget: wld.weather.windSpeedTarget,
      // ★SW-FX43：沙暴四元组真值（WldParser.sandstorm,WF:1375-1378/:2319-2323;
      //  LoadWorld :166-172 回灌 Sandstorm.*）——曾恒全零=导入档沙暴进行中丢失
      sand: { happening: wld.sandstorm.happening, timeLeft: wld.sandstorm.timeLeft,
        severity: wld.sandstorm.severity, intendedSeverity: wld.sandstorm.intendedSeverity },
      slimeRainTime: wld.weather.slimeRainTime ?? 0,
      slimeRain: (wld.weather.slimeRainTime ?? 0) > 0,
    } : undefined,
    // 祭坛/暗影珠计数 + 困难矿锁定选种（WF:1302-1303/1315-1317）——wld 侧曾读了就扔,
    // 与自有存档 SaveData 顶层同位（save/serialize.ts altarCount/savedOreTiers 槽）
    altarCount: wld.altarCount,
    shadowOrbCount: wld.shadowOrbCount,
    savedOreTiers: wld.savedOreTiers,
    // ★SW-FX43：入侵五元组（WF:1306-1309/:1322）+ 流星雨剩余计数（WF:1428）——
    //  曾读位即弃 → 导入世界入侵中断/流星雨中断+再导出归零（SaveData 顶层既有槽）
    invasion: { type: wld.invasion.type, size: wld.invasion.size,
      sizeStart: wld.invasion.sizeStart, x: wld.invasion.x, delay: wld.invasion.delay },
    meteorShowerCount: wld.meteorShowerCount,
    // ★SW-FX11（2026-09-10）：肉前四档替代矿（WF:1394-1397,v>=216）——WldParser 曾读位
    //  即弃 → 醉酒世界 166/167/168/169 导入即丢（军火商钨弹门 Game.ts:34531）
    oreTiersPH: wld.oreTiersPH.copper !== -1 ? wld.oreTiersPH : undefined,
    // ★SW-FX11（2026-09-10）：天界四塔 NPC 段（SavesAndLoads,NPCID.cs:4807）+ 按压
    //  压力板段（WF:3374-3386）——loadSaveData 回填 world.pendingPillarNpcs /
    //  pendingPlatePokes,Game afterWorldLoad 恢复生成/一次性重触发
    pillarNpcs: wld.pillarNpcs.length ? wld.pillarNpcs : undefined,
    pressurePlates: wld.pressurePlates.length ? wld.pressurePlates : undefined,
    // ★SW-FX43（2026-09-12）：wldSnap 快照通道【全仓唯一生产点】（FX33 定谳:
    //  serialize.ts :272 声明、WldExport fieldValue 快照优先消费,本仓此前零生产者）。
    //  ★差量携行裁断（非全字段）：仅收「值静态且建模面无法还原」的字段——活态字段
    //  （boss 旗/时间/入侵/天气）不进快照,游玩后导出=建模现值（全字段钉快照=状态
    //  回退,反面破坏）。本快照随 repo 存档链携行（loadSaveData→World→SaveMeta→
    //  serializeSave→JSON→exportWld writeHeader 快照优先回写）：
    //   seedText        种子原文文本（header.seed 是 translateSeed 数值派生 :870）
    //   worldGenVersion i64 原值（台账导出恒写常量 1395864371201,Main.cs:228;
    //                   字符串域:>2^53 不经 Number）
    //   guid            16B hex（WldExport 曾恒 16 零字节=GUID.Zero）
    //   CreationTime    i64 .NET ticks 字符串域（header.created=ms 派生丢亚毫秒位;
    //                   WF:1254 写/:2020 读）
    //   manifest        原版世界清单串（台账曾恒写 ''——WorldManifest.cs:31-45 容错域）
    //   worldSurface / rockLayer  f64 原值（WF:1279-1280 直存;header.groundLevel/
    //                   rockLevel 曾 floor :875-876——自建世界 live 值本就不 floor）
    //  旧档/自建世界缺省 undefined → WldHeaderFields.get 台账映射回退（零行为变化）。
    //  存量已导入世界原值已弃不可回溯（诚实边界:重导入获得满保真）。
    wldSnap: {
      seedText: wld.seed,
      worldGenVersion: wld.worldGenVersion.toString(),
      guid: wld.guid,
      CreationTime: wld.creationTime.toString(),
      manifest: wld.manifest,
      worldSurface: wld.groundLevel,
      rockLayer: wld.rockLevel,
    } as NonNullable<SaveData['wldSnap']>,
    // ★SW-FX35：TE 三类透传快照 + 城镇房间表 + 图鉴三桶（导入→存档→导出零漂移）
    teSnap: teSnap.length ? teSnap : undefined,
    townRooms: wld.townRooms.length ? wld.townRooms : undefined,
    bestiary: (Object.keys(wld.bestiary.k).length || wld.bestiary.s.length || wld.bestiary.c.length)
      ? wld.bestiary
      : undefined,
    // ★全通道统一稳定 id 域(2026-09-07):SaveData 唯一 id 域=稳定 id(与 serializeSave
    //  产物同域)。此前 tiles/物品 落内部 id,而 loadSaveData/exportWld 按稳定域查表
    //  (INTERNAL_OF_STABLE 二次映射)——导入原版 wld 后类型大面积错位(6400×1800 实测
    //  577 万格错=「贴图乱七八糟/地图反相」的全部根因;小世界测试因早期段
    //  stable≡internal 恒等而伪绿)。统一后读/导两侧契约恒真,无双域判别。
    //  tiles 经 rleTiles stableMap 逐元素映射(游程按 raw 比较不膨胀);物品三源
    //  (宝箱/挂物家具/TE 槽)统一在此收口。
    tiles: bytesToB64(rleTiles({ type, frameX, frameY }, TILE_STABLE_OF_INTERNAL)),
    walls: bytesToB64(rlePairs(wall)),
    liquid: bytesToB64(rlePairs(liquidArr)),
    liquidType: bytesToB64(rlePairs(liquidTypeArr)),
    wire: bytesToB64(rlePairs(wireArr)),
    blocks: bytesToB64(rlePairs(combineHalfSlope(halfArr, slopeArr))),
    paint: bytesToB64(rlePairs(paintArr)),         // 油漆（WF:2571-2574）
    paintWall: bytesToB64(rlePairs(paintWallArr)), // 墙漆（WF:2583-2586）
    coat: bytesToB64(rlePairs(coatArr)),           // 涂层四位（WF:1539-1552）
    // ★explored 故意不写段（= 全 0 迷雾）：原版地图探索数据存在 .wld 伴档 .twld
    // （MapHelper.SaveMap），.wld 本体不含——WldParser 只读 .wld，无从回填，
    // 导入后从头探索（与旧存档行为一致）
    explored: undefined,
    chests,
    // ★七批备案④收尾：334 legacy 武器架持武还原记录（内部 id——本 SaveData 为
    //  v2 内存态，loadSaveData v3=false 同 chests 直读；落盘经 serialize 转稳定 id）
    furniture: furnitureSave.length ? furnitureSave : undefined,
    player: {
      hp: 100,
      x: wld.spawnX * 16 + 8,
      y: (wld.spawnY - 2) * 16,
      inventory: Array(40).fill(null),
      // ★BJ660 件1：bank 桶显式初始化——原版 bank/bank2/bank3/bank4（存钱罐/保险箱/
      //  守护者熔炉/虚空保险库）随 .plr 角色档携行,.wld 本体无 bank 数据 → 导入档
      //  =四空桶各 40 槽（与 Player 类字段初值同形）。此前缺字段=导入 SaveData 的
      //  player 形不完整,储蓄链（applyPlayer 守卫跳过→coinSavingsByBank/layoutVanilla
      //  储蓄行签名）在缺桶玩家态上曾炸 UI 刷新链「reading 'length'」。
      //  applyPlayer 缺省守卫与 Game.coinSavingsByBank `?? []` 兜底保留=旧档/损档双防。
      banks: [Array(40).fill(null), Array(40).fill(null), Array(40).fill(null), Array(40).fill(null)],
      selected: 0,
    },
    // 城镇 NPC（原版 WorldFile town NPC 段）：spriteId→key（bound 型映射并置 bound），
    // 坐标=像素，home=tile。原版 Starter_World 等 wld 自带的已入驻 NPC 此前被丢弃——
    // 读档只剩"向导+五人组"，入住系统重复搬入出生房。
    // ★home 判定三条件（2026-08-31 入住丢失定谳）：
    //  ① homeless 位必须为 false——原版无家者可带正值 homeTile（换人链 WorldGen.cs:
    //     2214-2217、QuickFindHome 失败支 ：5705 均保留旧值，唯 SetDefaults 才置 -1）；
    //  ② 原版 homeTileX/Y 存的是「住房领取锚点」（菜单点击格/QuickFindHome 扫描点），
    //     可落在家具/平台/地板等【房界格】上；本仓 home 约定=站立空格。此差异在
    //     读档侧用 snapSavedHome 归一（Game afterWorldLoad），导入侧原样透传；
    //  ③ -1 兜底（老档/corrupt 防御）。
    npcs: wld.npcs.flatMap((n): NonNullable<SaveData['npcs']> => {
      const entry = TOWN_NPC_KEY_BY_ID[n.spriteId];
      if (!entry) return [];   // 旅商/骷髅商等不落存档的类型跳过
      const hasHome = !n.homeless && n.homeX >= 0 && n.homeY >= 0;
      const home = hasHome ? [n.homeX, n.homeY] as [number, number] : null;
      return [{
        key: entry.key, x: n.x, y: n.y, home, bound: entry.bound, givenName: n.name || undefined,
        // ★SW-FX11（2026-09-10）：微光变体透传（ShimmeredTownNPCs 名单按 NPC type id
        //  索引,WF:1712-1720/:2899-2906;名单含 spriteId 即微光态）——曾读位即弃
        shimmered: wld.shimmered.includes(n.spriteId) || undefined,
        // ★SW-BO1 2026-09-07：流浪清场标透传（原版 v315+ 持久位;仅 SpawnHomelessNPC
        //  生成位会带 true,其余 homeless 者恒 false）
        homelessDespawn: n.homelessDespawn || undefined,
      }];
    }),
    // ★R16-1（2026-08-24）：LoadWorldFlags 全量旗标透传（WldParser.flags ~40 位：
    //  downedBoss 族/downed_ 双键/saved*/入侵四连/四塔 downed+active/lunarApocalypseUp/
    //  DD2 四 bool/史莱姆与城镇 NPC 解锁族/forceHalloween*/XMas*/combatBook/2/
    //  shadowOrbSmashed/spawnMeteor/vampire/infected/teamBasedSpawnsSeed）——
    //  曾硬编码 {downedEyeOfCthulhu:false} → 导入肉后世界=肉前玩法
    // ★R16-2：signs 段文本回填（world.signs 是牌/墓碑共用位置键表——Sign.ReadSign
    //  锚=2×2 左上,与 openSignEditor 反解锚同口径）
    signs: wld.signs.map((sg) => ({ x: sg.x, y: sg.y, text: sg.text })),
    flags: { downedEyeOfCthulhu: false, ...wld.flags },
    // ★SW-BJ45（2026-09-09）：渔夫任务链段透传（SaveData.angler 同形，消费面
    //  save/SaveFile.ts loadSaveData 回填 World.anglerQuest/anglerWhoFinishedToday，
    //  完成旗由 World.reconstructAnglerFinished 于装配尾重构——WorldGen.cs:6781-6784）
    angler: { quest: wld.anglerQuest, whoFinishedToday: wld.anglerWhoFinishedToday },
  };
  const toEntries = (m: Map<number, number>, names: Record<string, string>): CompatEntry[] =>
    [...m.entries()].map(([id, count]) => ({ id, name: names[String(id)] ?? null, count, action: '' }))
      .sort((a, b) => b.count - a.count);
  const report: CompatReport = {
    worldName: wld.title || '导入的地图',
    wldVersion: wld.version,
    size: [w, h],
    tilesDegraded: toEntries(deg, tileNames).map((e) => ({ ...e, action: 'degraded-to-stone' })),
    tilesCleared: toEntries(clr, tileNames).map((e) => ({ ...e, action: 'cleared' })),
    itemsSkipped: toEntries(itm, itemNames).map((e) => ({ ...e, action: 'skipped' })),
  };
  void warnings;
  void chestAt;
  return { save, warnings, report, seedText: wld.seed, gameMode: wld.gameMode };
}

// 全量名称表（vanilla.json 生成时从 TEdit tiles/items.json 提取）
import vanillaJson from '../../public/sprites/vanilla.json';
const vanillaData = vanillaJson as unknown as { tileNames?: Record<string, string>; itemNames?: Record<string, string> };
const vanillaTileNames = vanillaData.tileNames ?? {};
const vanillaItemNames = vanillaData.itemNames ?? {};

/** half + slope → blockType 单字节(原版 Tile.blockType 编码) */
export function combineHalfSlope(half: Uint8Array, slope: Uint8Array): Uint8Array {
  const out = new Uint8Array(half.length);
  for (let i = 0; i < half.length; i++) {
    out[i] = half[i] ? 1 : (slope[i] >= 1 && slope[i] <= 4 ? slope[i] + 1 : 0);
  }
  return out;
}
