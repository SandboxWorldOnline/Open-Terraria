// 物品 id 双域纪律守卫（2026-09-18;BJ150 普查 §6 处方——方案 B 哨兵网 grep 臂）。
// 背景:物品 id 双域并存——internal=运行时域(ITEM_DEFS 数组下标)/stable=对外契约域
//   (≡原版 vid + SW 私有段 10000+/place_v 20000+)。11 天内两起同型实害事故:
//   SW-BO1(WldExport 箱侧)与 BJ146(PlrImport 导出侧),病灶同型=「写向文件误用加载向表」
//   且被 stableOf∘netIdOf 自回环恒等掩盖(夹具与断言同表同错=闭环测试全绿)。
//   BJ150 逐点核读:8 个跨边界收口现状全部正确。本守卫把「方向纪律」钉成 grep 闸,
//   防第三起;行为面哨兵=tests/id-domain-sentinel.test.ts(8 收口性质测试)。
//   注:另一张同构双表 tile 域(TILE_STABLE_OF_INTERNAL/TILE_INTERNAL_OF_STABLE,
//   data/tiles.ts:1018)同纪律由本守卫 IDG-6 一并看护。
// 规则(全部只扫【代码面】:行注释/块注释豁免——事故取证注里大量出现表名,是法证
//   资产,豁免面=注释而非代码;字符串面同豁免,动态 string 取值面由 IDG-5 锚+行为哨兵兜底):
//   IDG-1 写向文件禁加载向表:ITEM_INTERNAL_OF_STABLE 不得出现在
//         src/save/serialize.ts、src/wld/WldExport.ts、src/save/PlrImport.ts 代码中
//         (写向只许 ITEM_STABLE_OF_INTERNAL[内部id];PlrImport 导出 vid 恒等门走
//         VANILLA_ITEM_KEY_BY_ID 键链——2026-09-18 netIdOf 已等价改写,见其头注)
//   IDG-2 读向文件禁写向表:ITEM_STABLE_OF_INTERNAL 不得出现在 src/save/SaveFile.ts
//         代码中(读向只许 ITEM_INTERNAL_OF_STABLE.get;v3 legacy 裸下标段走
//         LEGACY_KEY_OF_INTERNAL_V3+ITEM_BY_KEY 键链,禁裸下标——SaveFile.ts:268 注)
//   IDG-3 加载向表禁括号取值:全 src 禁 `ITEM_INTERNAL_OF_STABLE[` / `TILE_INTERNAL_OF_STABLE[`
//         (Map/TypedArray 直取下标=把稳定 id 当内部下标用;tiles 侧 389 别名例外见下)
//   IDG-4 联机域中立:src/net/** 不得出现两族表任一名字(净边界只许 key 串跨越或
//         同域位透传——双端同构建,数值域过线必_self-consistent,表一掺即域混)
//   IDG-5 防空洞锚:守卫对象文件必须存在且代码含既有收口锚——文件改名/收口迁移时
//         守卫必须显式随迁,不得静默变 vacuous:
//           serialize.ts 含 `ITEM_STABLE_OF_INTERNAL[`(写向收口在位)
//           SaveFile.ts  含 `ITEM_INTERNAL_OF_STABLE.get(`(读向收口在位)
//           PlrImport.ts 含 `function stableOf` + `function netIdOf`(两向门在位)
//           WldExport.ts 含 `function encodeTiles` + `export function exportWld`
//   IDG-6 tiles 同构双域同纪律:data/tiles.ts 之外禁出现 TILE_INTERNAL_OF_STABLE 的
//         括号取值(由 IDG-3 覆盖)——wld 域 tile 稳定 id≡vanilla sheet,SaveFile.ts
//         读向同样只许 TILE_INTERNAL_OF_STABLE 括号取值(tiles TypedArray 无 .get,
//         括号即正语义),故 tiles 表不适用 IDG-2;此条仅声明域边界,违规面并入 IDG-3。
// ★IDG-T 组(2026-09-18 BJ154 同族普查案;tile 域双域=internal(TILE_DEFS 注册序,
//   st.type 运行时域) vs sheet(原版 TileID,vanilla.sheet))——与物品域的本质差异:
//   两域数值高度重叠(761 内部 id 中 752 与某 sheet 撞号),错域查询几乎必【命中错项】
//   而非落空(BJ154 火把→生命水晶、影烛 sheet646 裸查内部域 counts→命中虫笼内部
//   646,同型)。物品域裸下标重合率 0/6177=错域恒落空(保守失效),tile 域=危险失效。
//   全仓普查定谳:唯一实害=SceneMetrics.ts 影烛计数(已修);其余 ~90 表全表
//   消费域匹配(平移链/包裹函数/LUT 展开三类习语,见 tests/tile-domain-sentinel)。
//   IDG-T1 防空洞锚:普查钉死的平移链锚必须在位(T_ANCHORS——金属探测器 BJ154 修法
//         /影烛修法/巨石扫描/砍切/照明 LUT 五链)
//   IDG-T2 原始 sheet 表单文件纪律:下列裸 sheet 字面量表只许出现在家文件(白名单
//         二家=lighting 系 def+consumer 对)——跨文件出现=疑似未平移新消费面
//   IDG-T3 命名域纪律:internalIdsOfVanSheets(构建期 sheet→内部平移器)产物禁
//         *_SHEETS 后缀(键是内部 id,域谎名=BJ154 同款误导;AXEARANG_EXTRA_CUT_
//         SHEETS→AXEARANG_EXTRA_CUT_IDS 已改,本条防复发)
// 消费:node tools/id-domain-guard.mjs 直跑(exit 1)/tests/id-domain-guard.test.ts。
//   不挂 vite 插件(编辑 vite.config.ts 会让全部运行中实例重启——项目约定避让)。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

const LOAD_ITEM = 'ITEM_INTERNAL_OF_STABLE';
const SAVE_ITEM = 'ITEM_STABLE_OF_INTERNAL';
const LOAD_TILE = 'TILE_INTERNAL_OF_STABLE';
const SAVE_TILE = 'TILE_STABLE_OF_INTERNAL';
// IDG-1 写向文件(物品);IDG-2 读向文件
const WRITE_FILES = ['src/save/serialize.ts', 'src/wld/WldExport.ts', 'src/save/PlrImport.ts']
  .map((p) => join(SRC, p.slice(4)));
const READ_FILES = ['src/save/SaveFile.ts'].map((p) => join(SRC, p.slice(4)));
// IDG-5 防空洞锚(文件 → 代码面必须出现的锚串)
const ANCHORS = new Map([
  [join(SRC, 'save/serialize.ts'), [`${SAVE_ITEM}[`]],
  [join(SRC, 'save/SaveFile.ts'), [`${LOAD_ITEM}.get(`]],
  [join(SRC, 'save/PlrImport.ts'), ['function stableOf', 'function netIdOf']],
  [join(SRC, 'wld/WldExport.ts'), ['function encodeTiles', 'export function exportWld']],
]);
// ---- IDG-T1 tile 域平移链防空洞锚(文件 → 代码面必须出现的锚串) ----
const T_ANCHORS = new Map([
  // 金属探测器 BJ154 修法三件套:sheet 键原表+构建期平移循环+输出回译
  [join(SRC, 'world/SceneMetrics.ts'), [
    'ORE_FINDER_PRIORITY_SHEET',
    'SHEET_MAP.get(Number(sheet))',
    'bestOreSheet: bestOreS >= 0',
    'const SHADOW_CANDLE = SHEET_MAP.get(646)',   // 影烛修法(同普查案)
  ]],
  // 探测器输出消费域=sheet+平移器单源+粒子热路径 LUT
  // ★BJ731 随迁（2026-10-27）：明胶水晶修法（v0.1.59,40f93184）把输出名改
  //   oreFinderDisplayName(sheet, fx)（SceneMetrics.ts:323 单源,fx 帧态维:
  //   129 明胶水晶/227 染料植物 baseOption;兜底支 Lang.tileName(sheet) 随迁
  //   SceneMetrics）——本锚自 `Lang.tileName(scene.bestOreSheet)` 随迁新消费形。
  [join(SRC, 'core/Game.ts'), [
    'oreFinderDisplayName(scene.bestOreSheet,',
    'function internalIdsOfVanSheets',
    'const sheetCache = new Int16Array(TILE_DEFS.length).fill(-2)',
  ]],
  // 巨石敌怪扫描:表 sheet 键,消费点内部→sheet 平移后查询
  [join(SRC, 'entities/RollingBoulder.ts'), ['RB_FAIRY_LURE_SHEETS.has(sheet)', 'RB_LURE_PRIORITY[sheet]']],
  // 开门砍切:vanSheet 包裹函数
  [join(SRC, 'world/CanCutTile.ts'), ['vanSheet(st.get']],
  // 照明:sheet 表 init 期展开为内部 id Uint8Array LUT(热路径查询域)
  [join(SRC, 'lighting/TileLightScanner.ts'), ['sheetById[i] = sheet']],
]);
// ---- IDG-T2 裸 sheet 字面量表单文件纪律(表名 → 家文件;白名单多家=def+consumer 对) ----
const T_SHEET_TABLES = [
  ['ORE_FINDER_PRIORITY_SHEET', ['world/SceneMetrics.ts']],
  ['RB_ORE_SHEETS', ['entities/RollingBoulder.ts']],
  ['RB_FAIRY_LURE_SHEETS', ['entities/RollingBoulder.ts']],
  ['RB_LURE_PRIORITY', ['entities/RollingBoulder.ts']],
  ['TILE_NO_FAIL_SHEETS', ['core/Game.ts']],
  ['KILL_TILE_DUST', ['core/Game.ts']],
  ['GRASS_WINDY_SHEETS', ['core/Game.ts']],
  ['BELOW_SHEET_BLOCK', ['world/CanCutTile.ts']],
  ['TREE_SWAY_SHEETS', ['render/WindSway.ts']],
  // lighting 系:表定义(lightTables)+LUT 展开消费(TileLightScanner)两家全记录
  ['TILE_BLOCK_LIGHT_SHEETS', ['lighting/lightTables.ts', 'lighting/TileLightScanner.ts']],
  ['TILE_NO_SUN_LIGHT_SHEETS', ['lighting/lightTables.ts', 'lighting/TileLightScanner.ts']],
  ['FLICKER_SHEETS', ['lighting/lightTables.ts', 'lighting/TileLightScanner.ts']],
  ['MUSHROOM_GLOW_SHEETS', ['lighting/lightTables.ts', 'lighting/TileLightScanner.ts']],
  // ★BJ426-债A(2026-10-01):BJ221 已把定义家迁 data/tiles.ts(lightTables 本地副本拆除,
  //   lightTables.ts:157 注;唯一消费面 TileLightScanner:752 sheet 域)——定义家入清单
  ['ALLOW_LIGHT_IN_WATER_SHEETS', ['data/tiles.ts', 'lighting/lightTables.ts', 'lighting/TileLightScanner.ts']],
  // ★BJ158①/②（2026-09-18）单源收编家族:data/tiles.ts=唯一定义家,其余=已核读消费面
  //  （sheet 域直查消费,均已亲读键域相配）;新消费面须先平移到内部域或走 FORBIDS_SLOPING_IDS
  ['FORBIDS_SLOPING_SHEETS', ['data/tiles.ts', 'core/Game.ts', 'world/gen/vanilla/TrackPass.ts',
    'world/gen/vanilla/FinalCleanupPass.ts', 'world/gen/vanilla/TemplePass.ts']],
  ['TILE_AXE_SHEETS', ['data/tiles.ts', 'core/Game.ts', 'player/SmartCursor.ts', 'player/SmartSelect.ts']],
  ['TILE_HAMMER_SHEETS', ['data/tiles.ts', 'core/Game.ts', 'player/SmartCursor.ts', 'player/SmartSelect.ts']],
  // ★BJ168-债2（2026-09-19）tileCut/BreakableWhenPlacing/TileID.Sets 三表单源收编家族:
  //   data/tiles.ts=唯一定义家;副本(TILE_CUT_FC/PC_TILE_CUT/AV_TILE_CUT/PC_BREAK_PLACE/
  //   AV_BREAK_PLACE 与 IsATreeTrunk×4/Boulders×7/Platforms×8 世界生成面)已拆除——
  //   任何文件再出现这些名字的【定义】即 T2 红(结构锁=无副本可立;家清单内=已核读
  //   sheet 域消费面)。BOULDERS_IDS 为内部域镜像,入清单同样只作防复活锁。
  //   ★BJ426-债A 复核(2026-10-01):旧登记债「Game.ts:1554 同名本地副本 PLATFORMS_SHEETS
  //   未收编」已灭——Game.ts:142 现为 data/tiles.ts 单源 import,盘上无本地副本
  //   (Game.ts:1751 收编注在锚),core/Game.ts 作已核读消费面留驻清单。
  ['TILE_CUT_SHEETS', ['data/tiles.ts', 'core/Game.ts', 'world/TileAnchorValidator.ts',
    'world/gen/vanilla/SurfaceDecorPasses.ts', 'world/evolution/WorldEvolution.ts',
    'entities/RollingBoulder.ts', 'world/gen/vanilla/FinalCleanupPass.ts',
    'world/gen/vanilla/BuriedChestsPass.ts', 'world/gen/vanilla/DesertPass.ts',
    'world/gen/vanilla/DungeonPass.ts', 'world/liquid/LiquidSim.ts',
    // ★BJ426-债A(2026-10-01)转正:Door.ts shiftTrapdoor 折翼行门/砍切臂(cellSheet 平移
    //   sheet 域,≡WorldGen.cs:52001/:52013-52019 tileCut 臂,BJ324 新消费面)
    'world/Door.ts',
    // ★BJ731 转正（2026-10-27）：MysticSnakeCoil mysticSnakeCond/阻挡扫描两处
    //   sheetOf 平移后 TILE_CUT_SHEETS 查询——≡WorldBuilding/Conditions.cs:57-67
    //   `Conditions.MysticSnake.CheckValidity` 读 Main.tileCut[type]（type=原版
    //   tile id=sheet 域）+ :52933-52941 绳阻挡扫同谓词。sheet 域消费合法
    //   （968d867f v0.1.65 落地后漏登记,非新违规）。
    'entities/MysticSnakeCoil.ts']],
  ['BREAKABLE_WHEN_PLACING_SHEETS', ['data/tiles.ts', 'world/TileAnchorValidator.ts',
    'world/gen/vanilla/SurfaceDecorPasses.ts', 'world/evolution/WorldEvolution.ts',
    'entities/RollingBoulder.ts', 'player/SmartCursor.ts',
    'world/gen/vanilla/BuriedChestsPass.ts', 'world/gen/vanilla/DesertPass.ts',
    'world/gen/vanilla/DungeonPass.ts']],
  // ★BJ182b（2026-09-19）收编批:Main.tileTable 单源扩面（76/80 项旧副本族全拆——
  //   FinalCleanup/HalfBrick×2/Piles×2/Traps×2 曾缺 Main.cs:10125-31 循环臂 435-439;
  //   BuriedChests PC_TILE_TABLE 曾缺 280=鸟笼笼族桌面路, BJ168-债2 附录登记本案定谳收编）
  ['TILE_TABLE_SHEETS', ['data/tiles.ts', 'core/Game.ts', 'player/SmartCursor.ts',
    'world/TileAnchorValidator.ts', 'world/gen/vanilla/DungeonPass.ts',
    'world/gen/vanilla/SkyblockPass.ts', 'world/gen/vanilla/SurfaceDecorPasses.ts',
    'world/gen/vanilla/FinalCleanupPass.ts', 'world/gen/vanilla/HalfBrickPass.ts',
    'world/gen/vanilla/PilesPass.ts', 'world/gen/vanilla/TrapsPass.ts',
    'world/gen/vanilla/BuriedChestsPass.ts']],
  ['IS_A_TREE_TRUNK_SHEETS', ['data/tiles.ts', 'world/Torch.ts',
    'world/gen/vanilla/SecretSeedDoEndsPass.ts', 'world/evolution/WorldEvolution.ts',
    'world/gen/vanilla/FinalCleanupPass.ts', 'world/gen/vanilla/MicroBiomesPass.ts',
    'render/RenderAudit.ts', 'core/Game.ts', 'data/grappleHooks.ts',
    'player/SmartCursor.ts', 'world/TreeShake.ts',
    'world/gen/vanilla/FinalSeedCleanupPass.ts', 'world/gen/vanilla/TemplePass.ts',
    'world/gen/vanilla/TileCleanupPass.ts', 'world/gen/vanilla/TrackPass.ts',
    'world/gen/vanilla/TrapsPass.ts', 'world/gen/vanilla/TeleportSpotCheck.ts']],
  // ★BJ203（2026-09-20）TileID.Sets 五表第二收编批:data/tiles.ts=唯一定义家,其余=已
  //   核读 sheet 域消费面（含 lutFromSheets/bySheet 平移习语）——新消费面先平移再查。
  ['ORE_SHEETS', ['data/tiles.ts', 'entities/RollingBoulder.ts', 'world/gen/WorldGen.ts',
    'world/gen/vanilla/FinalSeedCleanupPass.ts', 'world/gen/vanilla/FinishNoTrapsPass.ts',
    'world/gen/vanilla/LivingTreePass.ts', 'world/gen/vanilla/MarbleGranitePass.ts',
    'world/gen/vanilla/NotTheBeesPass.ts', 'world/gen/vanilla/SecretSeedDoEndsPass.ts',
    'world/gen/vanilla/SurfaceDecorPasses.ts', 'world/gen/vanilla/TrapsPass.ts',
    // ★BJ426-债A(2026-10-01)转正:VanillaFraming SETS_ORE=S256([...ORE_SHEETS]) 构建
    //   期 sheet 键 LUT(facade Ore:(t)=>SETS_ORE[t],t=原版 tile.type;BJ210 收编面漏挂)
    'render/VanillaFraming.ts']],
  ['NOT_REALLY_SOLID_SHEETS', ['data/tiles.ts', 'render/RenderAudit.ts', 'world/Torch.ts',
    'player/SmartCursor.ts', 'render/VanillaTiler.ts',
    'world/gen/vanilla/FinalCleanupPass.ts', 'world/gen/vanilla/HalfBrickPass.ts',
    'world/gen/vanilla/TeleportSpotCheck.ts', 'world/gen/vanilla/TrapsPass.ts',
    'world/liquid/LiquidSim.ts',
    // ★BJ426-债A(2026-10-01)转正:Game.ts:1584 anchorSolidBottom 顶锚 !NotReallySolid
    //   臂(d.vanilla?.sheet 域直查,≡TileID.cs:359;§6h 金标已锁表值)
    'core/Game.ts']],
  ['IS_BEAM_SHEETS', ['data/tiles.ts', 'core/Game.ts', 'render/RenderAudit.ts',
    'world/Torch.ts', 'player/SmartCursor.ts',
    'world/gen/vanilla/FinalCleanupPass.ts', 'world/gen/vanilla/TeleportSpotCheck.ts']],
  ['IS_A_DRIP_TILE_SHEETS', ['data/tiles.ts', 'core/Game.ts', 'entities/RollingBoulder.ts',
    'render/WindSway.ts',
    // ★BJ426-债A(2026-10-01)转正:Door.ts 折翼行门/砍切臂(同 TILE_CUT_SHEETS 注)
    'world/Door.ts']],
  ['IS_A_CONTAINER_SHEETS', ['data/tiles.ts', 'wld/WldImport.ts',
    'world/gen/vanilla/TrackPass.ts', 'world/liquid/LiquidSim.ts']],
  ['IS_A_TREE_TRUNK_IDS', ['data/tiles.ts', 'world/gen/vanilla/HalfBrickPass.ts',
    'world/gen/vanilla/TeleporterPass.ts']],
  ['BOULDERS_SHEETS', ['data/tiles.ts', 'world/gen/vanilla/FinalCleanupPass.ts',
    'world/gen/vanilla/BuriedChestsPass.ts', 'world/gen/vanilla/NotTheBeesPass.ts',
    'world/gen/vanilla/SurfaceDecorPasses.ts', 'core/Game.ts', 'player/SmartCursor.ts',
    'world/DungeonDualZones.ts', 'world/spawn/ExtraSpawnsRoyale.ts',
    'world/gen/vanilla/CaveHousePass.ts', 'world/gen/vanilla/DungeonPass.ts',
    'world/gen/vanilla/FinishNoTrapsPass.ts', 'world/gen/vanilla/LivingTreePass.ts',
    'world/gen/vanilla/PilesPass.ts', 'world/gen/vanilla/Spread.ts',
    'world/gen/vanilla/StatuesPass.ts', 'world/gen/vanilla/TemplePass.ts',
    'world/gen/vanilla/TrackPass.ts', 'world/gen/vanilla/TrapsPass.ts']],
  ['BOULDERS_IDS', ['data/tiles.ts', 'world/gen/vanilla/FinalCleanupPass.ts',
    'world/gen/vanilla/BuriedChestsPass.ts', 'world/gen/vanilla/DesertPass.ts',
    'world/gen/vanilla/MicroBiomesPass.ts', 'world/gen/vanilla/CorruptionPass.ts',
    'world/gen/vanilla/BrokenTrapCleanupPass.ts', 'world/gen/vanilla/HalfBrickPass.ts']],
  ['PLATFORMS_SHEETS', ['data/tiles.ts', 'world/Torch.ts',
    'world/gen/vanilla/FinalCleanupPass.ts', 'world/gen/vanilla/BuriedChestsPass.ts',
    'world/evolution/WorldEvolution.ts', 'world/gen/vanilla/SurfaceDecorPasses.ts',
    'core/Game.ts', 'entities/LeashedCritter.ts', 'entities/Player.ts',
    'entities/RollingBoulder.ts', 'player/SmartCursor.ts', 'render/VanillaTiler.ts',
    'ui/JourneyBrowser.ts', 'wld/WldImport.ts', 'world/spawn/SpawnPlacement.ts',
    'world/gen/vanilla/DungeonDualLayout.ts', 'world/gen/vanilla/DungeonEarlyFeatures.ts',
    'world/gen/vanilla/DungeonPass.ts', 'world/gen/vanilla/FinishNoTrapsPass.ts',
    'world/gen/vanilla/HellforgesPass.ts', 'world/gen/vanilla/PilesPass.ts',
    'world/gen/vanilla/StatuesPass.ts', 'world/gen/vanilla/TeleportSpotCheck.ts',
    'world/gen/vanilla/TemplePass.ts', 'world/gen/vanilla/TileCleanupPass.ts',
    'world/gen/vanilla/TrapsPass.ts',
    // ★C14(2026-10-11)转正：world/TileAnchorValidator.ts=CanPlace 移植本体,evalCell
    //   全程 sheet 域消费（SolidWithTop 平台支 BJ624 :183 既有+Platform/
    //   PlatformNonHammered 平台顶备档 C14-F2c/d :337-347）——域一致,补家清单
    //   （违规面 BJ624 即在,C14 只扩同文件同表消费位,首违非 C14）。
    'world/TileAnchorValidator.ts',
    // ★BJ426-债A(2026-10-01)转正两处:
    //   · VanillaFraming SETS_PLATFORMS=S256([...PLATFORMS_SHEETS]) sheet 键 LUT(BJ221 收编面漏挂)
    //   · ClingerStaffWallProj CLINGER_WALL_STOP_SHEETS=[...PLATFORMS_SHEETS,380] 停行集
    //     (sheetAt sheet 域消费,≡Player.cs:49110-49117 弹482 发射侧下扫 Platforms[t]∥t==380)
    'render/VanillaFraming.ts', 'entities/ClingerStaffWallProj.ts',
    // ★BJ731 转正（2026-10-27）：net/vanilla/sections.ts msg42 剖面回放 slope/half
    //   还原支——vanillaType=原版线格式 tile type（=sheet 域本相,全文件线格式域）
    //   ×2 处直查（4667b330 BJ708-720 落地后漏登记,非新违规）。
    'net/vanilla/sections.ts']],
  ['PLATFORMS_IDS', ['data/tiles.ts', 'world/gen/vanilla/CorruptionPass.ts',
    'world/gen/vanilla/QuickCleanupPass.ts', 'world/gen/vanilla/HalfBrickPass.ts']],
];
// ---- IDG-T3 命名域纪律匹配(internalIdsOfVanSheets 产物禁 _SHEETS 后缀) ----
const T3_NAME_LIE = /const\s+([A-Za-z0-9_]*_SHEETS)\s*=\s*internalIdsOfVanSheets\s*[(<]/;

/** 收集目录下全部 .ts 文件(递归) */
function collectTs(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collectTs(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

/** 逐行剔除行注释(// 后段;'://' 非注释);块注释区由调用方按区间豁免 */
function stripLineComment(line) {
  let idx = line.indexOf('//');
  while (idx > 0 && line[idx - 1] === ':') idx = line.indexOf('//', idx + 1);   // 'http://' 类
  return idx >= 0 ? line.slice(0, idx) : line;
}

/** 代码面提取:块注释 /* ... *​/ 区间整段剔除,余下行注释剔除。
 *  ★2026-09-18 升级为 string 感知 lexer:曾因 Game.ts:42288 字符串
 *  `inp.accept = 'image/*'` 被当块注释 opener,其后 ~4000 行(含粒子热路径
 *  sheetOf LUT)整段对守卫失明=漏报向盲区。逐字符状态机:字符串(引号含转义)
 *  /行注释(双斜)/块注释三态;正则字面量含引号的极端形态仍可能漂移,
 *  代价是单文件内注释豁免面局部偏移,锚/漏出规则均多锚冗余,不依赖单点)。 */
function codeSurface(text) {
  // 1) 块注释区间标记(逐字符扫,string 感知;★注释内引号不算字符串开口——
  //    PlrImport.ts:509 取证注含反引号代码串,若在注释内开 string 态会把
  //    注释文本漏成代码面=IDG-1 误报)
  const inBlock = new Uint8Array(text.length);
  let depth = 0;
  let strCh = null;   // 当前所在字符串的引号符,仅 depth===0 时可能非 null
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (depth > 0) {                                // 块注释内:只认闭合,引号/行注释一律注释文本
      if (c === '*' && text[i + 1] === '/') { depth--; inBlock[i] = inBlock[i + 1] = 1; i++; }
      else inBlock[i] = 1;
      continue;
    }
    if (strCh) {
      if (c === '\\') { i++; continue; }            // 转义对整体跳过
      if (c === strCh) strCh = null;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {         // 行注释:本行余段跳过
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') { depth++; inBlock[i] = inBlock[i + 1] = 1; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { strCh = c; continue; }
  }
  // 2) 按行剔除:块注释字符置空(+行注释兜底剔除)
  const lines = text.split('\n');
  let off = 0;
  const out = lines.map((line) => {
    let s = '';
    for (let i = 0; i < line.length; i++) s += inBlock[off + i] ? ' ' : line[i];
    off += line.length + 1;
    return stripLineComment(s);
  });
  return out;
}

/** 在代码面行中查表名出现,返回违规明细 */
function findName(codeLines, name) {
  const hits = [];
  codeLines.forEach((line, i) => {
    let idx = line.indexOf(name);
    while (idx >= 0) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
      idx = line.indexOf(name, idx + name.length);
    }
  });
  return hits;
}

/** 词边界版(BJ426-债A 2026-10-01,T2 家清单判定专用):裸 indexOf 会把
 *  IGNORED_IN_HOUSE_SC|ORE_SHEETS 这样的超名子串误判成整名漏出(Housing.ts 伪报
 *  判例——其全文件零 ORE_SHEETS 消费,词边界 grep 恒落空)。命中两侧任一为
 *  [A-Za-z0-9_$] 即拒。★T_ANCHORS/IDG-1..4 不改用本函数:防空洞锚有意的子串
 *  语义('ORE_FINDER_PRIORITY_SHEET' 须命中 '..._SHEETS' 消费面)勿动。 */
export function findNameBounded(codeLines, name) {
  const wordChar = /[A-Za-z0-9_$]/;
  const hits = [];
  codeLines.forEach((line, i) => {
    let idx = line.indexOf(name);
    while (idx >= 0) {
      const before = idx > 0 ? line[idx - 1] : '';
      const after = idx + name.length < line.length ? line[idx + name.length] : '';
      if (!wordChar.test(before) && !wordChar.test(after)) {
        hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
      }
      idx = line.indexOf(name, idx + name.length);
    }
  });
  return hits;
}

export function auditIdDomains(srcDir = SRC) {
  const violations = [];
  const files = collectTs(srcDir);
  const byPath = new Map(files.map((f) => [f, null]));

  const surfaceOf = (f) => {
    if (!byPath.has(f)) return null;
    if (!byPath.get(f)) byPath.set(f, codeSurface(readFileSync(f, 'utf8')));
    return byPath.get(f);
  };

  // IDG-1 写向文件禁加载向表(物品)
  for (const f of WRITE_FILES) {
    const lines = surfaceOf(f);
    if (!lines) { violations.push({ rule: 'IDG-1', file: f, msg: '写向文件缺失(被改名/移动?)' }); continue; }
    for (const h of findName(lines, LOAD_ITEM)) violations.push({ rule: 'IDG-1', file: f, line: h.line, msg: `写向文件出现加载向表 ${LOAD_ITEM}: ${h.text}` });
  }
  // IDG-2 读向文件禁写向表(物品)
  for (const f of READ_FILES) {
    const lines = surfaceOf(f);
    if (!lines) { violations.push({ rule: 'IDG-2', file: f, msg: '读向文件缺失(被改名/移动?)' }); continue; }
    for (const h of findName(lines, SAVE_ITEM)) violations.push({ rule: 'IDG-2', file: f, line: h.line, msg: `读向文件出现写向表 ${SAVE_ITEM}(裸下标误用面): ${h.text}` });
  }
  // IDG-3 全 src:物品加载向表(Map)禁括号取值——Map['x'] 恒 undefined=静默空物
  //   (TypedArray 的 TILE_INTERNAL_OF_STABLE 括号即正语义,见 IDG-6 注,不适用)。
  for (const f of files) {
    const lines = surfaceOf(f);
    const bracket = `${LOAD_ITEM}[`;
    for (const h of findName(lines, bracket)) {
      violations.push({ rule: 'IDG-3', file: f, line: h.line, msg: `加载向表 ${LOAD_ITEM} 禁括号取值(Map['k'] 恒 undefined,只许 .get/.has): ${h.text}` });
    }
  }
  // IDG-4 联机域中立
  for (const f of files) {
    if (!f.startsWith(join(SRC, 'net'))) continue;
    const lines = surfaceOf(f);
    for (const name of [LOAD_ITEM, SAVE_ITEM, LOAD_TILE, SAVE_TILE]) {
      for (const h of findName(lines, name)) violations.push({ rule: 'IDG-4', file: f, line: h.line, msg: `联机边界出现 id 表 ${name}(域中立被破坏): ${h.text}` });
    }
  }
  // IDG-5 防空洞锚
  for (const [f, anchors] of ANCHORS) {
    if (!byPath.has(f)) { violations.push({ rule: 'IDG-5', file: f, msg: '守卫锚文件缺失(改名/迁移须显式随迁)' }); continue; }
    const lines = surfaceOf(f);
    for (const a of anchors) {
      if (findName(lines, a).length === 0) violations.push({ rule: 'IDG-5', file: f, msg: `防空洞锚失位:代码面找不到 \`${a}\`(收口迁移须随迁本守卫)` });
    }
  }
  // ---- IDG-T:tile 域双域纪律(BJ154 同族普查案) ----
  // IDG-T1 平移链防空洞锚
  for (const [f, anchors] of T_ANCHORS) {
    if (!byPath.has(f)) { violations.push({ rule: 'IDG-T1', file: f, msg: 'tile 域锚文件缺失(改名/迁移须显式随迁)' }); continue; }
    const lines = surfaceOf(f);
    for (const a of anchors) {
      if (findName(lines, a).length === 0) violations.push({ rule: 'IDG-T1', file: f, msg: `tile 域平移链锚失位:代码面找不到 \`${a}\`(修法重构须随迁本守卫)` });
    }
  }
  // IDG-T2 裸 sheet 表跨文件漏出禁令(注释面豁免=codeSurface 已剥;词边界匹配=
  //   BJ426-债A 收编刀,防超名子串伪报——Housing.ts IGNORED_IN_HOUSE_SCORE_SHEETS 判例)
  for (const [name, homes] of T_SHEET_TABLES) {
    const hitFiles = files.filter((f) => findNameBounded(surfaceOf(f), name).length > 0);
    for (const f of hitFiles) {
      const rel = f.slice(SRC.length + 1);
      if (!homes.includes(rel)) {
        violations.push({ rule: 'IDG-T2', file: f, msg: `裸 sheet 表 ${name} 跨文件漏出(家=${homes.join('/')}):新消费面须先平移到内部域或经包裹函数,勿直查 sheet 键表: ${rel}` });
      }
    }
  }
  // IDG-T3 命名域纪律:平移器产物禁 _SHEETS 后缀
  for (const f of files) {
    const lines = surfaceOf(f);
    lines.forEach((line, i) => {
      const m = T3_NAME_LIE.exec(line);
      if (m) violations.push({ rule: 'IDG-T3', file: f, line: i + 1, msg: `internalIdsOfVanSheets 产物 \`${m[1]}\` 禁 _SHEETS 后缀(键=内部 id,域谎名;改 _IDS)` });
    });
  }
  return violations;
}

export function printAudit(violations) {
  if (violations.length === 0) {
    console.log(`[id-domain] IDG-1..5+T1..T3 全绿 ✓(写向/读向/括号/联机中立/防空洞锚/tile 域)`);
    return;
  }
  for (const v of violations) console.error(`[id-domain] ${v.rule} ${v.file}${v.line ? ':' + v.line : ''} — ${v.msg}`);
  console.error(`[id-domain] ${violations.length} 处违例 ✗`);
}

// ---- CLI 直跑 ----
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const v = auditIdDomains();
  printAudit(v);
  process.exit(v.length ? 1 : 0);
}
