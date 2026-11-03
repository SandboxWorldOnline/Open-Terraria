// 智能光标（Smart Cursor）——原版 1.4.5.6 Terraria.GameContent/SmartCursorHelper.cs 全量移植。
//
// ★2026-09-03 全策略谓词对账（1457 逐点，见 hasTileAt 注释）：vanilla `tile.active()`
// （Tile.cs:591 HasTile 位，含已致动格）与 `nactive()` 两口径已分家——active() 读取点
// 一律 hasTileAt，nactive()/active+!inActive 点保持 activeAt。此前全步以 nactive 代读
// active()，已致动格被当空气（漏标/锚位丢失/致动格可被当空位）。幽灵格（flags=0,
// type≠0，生成期 active(false) 残型）在 active()/nactive() 两口径下同为"不在场"——
// ★但裸 type 读的消费者（EmptyTileCheck :31759 先 active() 后 type、Torch 17×17 去重
// :2837 裸 type）须逐点对原版口径，不适用此句（红蓝对抗 F1 修正 emptyTileCheck）。
//
// 权威源码对照（行号 = Terarria1456 反编译）：
//   - 策略链总调度 SmartCursorLookup            SmartCursorHelper.cs:61-165
//   - 让位集判定 IsHoveringOverAnInteractableTileThatBlocksSmartCursor :183-199
//   - 镐射线  Step_Pickaxe_MineSolids            :2350-2580（Collision.HitLine Collision.cs:782）
//   - 锤      Step_Hammers                       :1536-1723
//   - 斧      Step_Axe                           :2582-2690
//   - 方向锁  GetDesiredDirectionFrom/AllowedForContinuity :1403-1443
//   - 状态机  Main.cs:2074-2084 + Player.cs:28344-28374（TryToToggleSmartCursor）
//   - 渲染    Main.cs:46016-46066（DrawSmartCursor）
//
// 我们的 tile id 与原版 tile id 通过 TILE_DEFS[t].vanilla.sheet 桥接（sheet = 原版 Tiles_N 表 id）；
// 物品原版 id 通过 ITEM_DEFS[i].vid 或 key 前缀 vi_(\d+)_ 反解。
import type { ItemDef } from '../data/items';
import { TILE_DEFS, TILE_BY_KEY, BREAKABLE_WHEN_PLACING_SHEETS, TILE_TABLE_SHEETS, TILE_AXE_SHEETS, TILE_HAMMER_SHEETS, PLATFORMS_SHEETS, BOULDERS_SHEETS, IS_A_TREE_TRUNK_SHEETS, IS_BEAM_SHEETS, NOT_REALLY_SOLID_SHEETS, COMMON_SAPLING_SHEETS, TORCHES_SHEETS } from '../data/tiles';
import type { TileStore } from '../world/TileStore';
import { TileStore as TS } from '../world/TileStore';
import { WALL_HOUSE } from '../world/Housing';
import { canCutTile } from '../world/CanCutTile';
import { canKillTileAt } from '../entities/Mounts';   // ★issue#44-6：WorldGen.CanKillTile 全式单源

// ===================== 原版 TileID.Sets / ItemID.Sets 集合（TileID.cs / ItemID.cs 行号注释） =====================

/** TileID.cs:205 DisableSmartCursor（57 项）——鼠标悬停即让位，交给直接交互 */
const VANILLA_DISABLE_SMART_CURSOR_IDS = [4, 104, 79, 209, 511, 510, 216, 335, 338, 219, 212, 21, 467, 13, 29, 463,
  491, 97, 33, 49, 174, 50, 707, 139, 207, 55, 85, 237, 88, 10, 11, 125, 621, 354, 699, 287, 132, 136, 144, 334,
  386, 387, 411, 389, 388, 425, 441, 468, 494, 573, 464, 642];

/** TileID.cs:201 SmartCursorPickaxePriorityOverride（int 表：12/639/665 → 优先级 1） */
const PICKAXE_PRIORITY_OVERRIDE: Record<number, number> = { 12: 1, 639: 1, 665: 1 };

/** TileID.cs:203 IgnoreSmartCursorPriorityAxe */
const IGNORE_SMART_AXE = new Set([488]);

/** TileID.cs:161 IsATreeTrunk（多格树干族：橡树 5 / 棕榈 72 / 各宝石树 583-589 / 樱花 596 / 柳树 616 / 灰烬树 634） */
// ★BJ182b 收编单源 data/tiles.ts:IS_A_TREE_TRUNK_SHEETS(sheet 域;逐值对拍全等,tests/tile-domain-sentinel §6d)
const IS_A_TREE_TRUNK = IS_A_TREE_TRUNK_SHEETS;

/** TileID.cs:173 CommonSapling（树苗族：普通 20 / 宝石 590 / 樱花 595 / 柳树 615）——★BJ210 收编单源（§6i） */
const COMMON_SAPLING = COMMON_SAPLING_SHEETS;

/** TileID.cs:195 Boulders（巨石族） */
// ★BJ182b 收编单源 data/tiles.ts:BOULDERS_SHEETS(sheet 域;逐值对拍全等,tests/tile-domain-sentinel §6d)
const BOULDERS = BOULDERS_SHEETS;

/** TileID.cs:239 IsBeam（梁族：火把侧锚允许）
 *  ★BJ203 收编单源 data/tiles.ts:IS_BEAM_SHEETS（逐值对拍全等,tests/tile-domain-sentinel §6h） */
const IS_BEAM = IS_BEAM_SHEETS;

/** TileID.cs:243 Platforms（平台族 = tileSolidTop） */
// ★BJ182b 收编单源 data/tiles.ts:PLATFORMS_SHEETS(sheet 域;逐值对拍全等,tests/tile-domain-sentinel §6d)
const PLATFORMS = PLATFORMS_SHEETS;

/** Main.tileTable 全表——★SW-RB11d（2026-09-10）单源化：本地 76 条副本（曾漏
 *  Main.cs:10124-10131 for 循环臂 435-439 五队伍平台）退役，改引 data/tiles.ts
 *  TILE_TABLE_SHEETS 权威表（81 条，上方 import）。行为零差备案：本消费点
 *  （Step_Boulders :917/:921 承重谓词）同句 tileNoAttachType 即拒 435-439
 *  （原版 tileNoAttach 循环臂 Main.cs:10129 同置位），19/427 两副本同有——
 *  单源化只为防再漂移。红蓝对抗 F4 收编面维持 */

/** TileID.cs:405 Torches（tile 级：只有 4,旧注 :401 系行号漂移）——★BJ221 收编单源
 *  data/tiles.ts:TORCHES_SHEETS（§6k） */
const TORCH_TILES = TORCHES_SHEETS;

/** Main.tileNoAttach 全表（Main.cs `tileNoAttach[n] = true` 逐条赋值提取：
 *  :7260-7305 植物盆景族 / :7717-7771 树苗 / :7812-7838 火把与开着的门 / :7939-8007
 *  可割植物与家具 / :8323-8331 高门 / :9890-9900 平台族（427 + 循环 435-439）/ :10258 岩浆石） */
export const TILE_NO_ATTACH_SHEETS: ReadonlySet<number> = new Set([
  568, 569, 570, 580, 620, 572, 564, 565, 593, 594,
  590, 595, 615, 110, 3, 4, 10, 50, 707,
  20, 19, 13, 14, 469, 486, 488, 704, 487, 489, 490, 15, 497, 16, 134, 17, 18, 21, 467, 441,
  468, 27, 114, 86, 87, 88, 89, 90, 101, 102, 94, 95, 96, 97, 98, 99, 91, 92, 93,
  387, 388, 427, 435, 436, 437, 438, 439, 390,
]);

/** TileID.Sets.BreakableWhenPlacing（TileID.cs:383）——放置时被自动顶掉的方块
 *  （唯一权威表 = data/tiles.ts 的 BREAKABLE_WHEN_PLACING_SHEETS，本处只做谓词封装） */

/** TileID.cs:359 NotReallySolid（高门 387/388 与开着的门 10——"看着实心其实能穿"）
 *  ★BJ203 收编单源 data/tiles.ts:NOT_REALLY_SOLID_SHEETS（逐值对拍全等,§6h） */
const NOT_REALLY_SOLID = NOT_REALLY_SOLID_SHEETS;

/** ItemID.cs:80 GrassSeeds（草地种子：草 2/丛林 59/猩红 194? 详见策略内 switch） */
const GRASS_SEED_ITEMS = new Set([62, 59, 2171, 369, 195, 194, 5214]);

/** ItemID.cs:82 Moss（苔藓物品族） */
const MOSS_ITEMS = new Set([4349, 4350, 4351, 4352, 4353, 4354, 4377, 4378, 4389, 5127, 5128]);

/** ItemID.cs:1192 Torches / :1194 WaterTorches（物品级火把族） */
const TORCH_ITEMS = new Set([8, 427, 3004, 523, 433, 429, 974, 1333, 1245, 3114, 430, 3045, 428, 2274, 431, 432,
  4383, 4384, 4385, 4386, 4387, 4388, 5293, 5353]);
const WATER_TORCH_ITEMS = new Set([523, 1333, 4384]);

/** ItemID.cs:254 IsPaintScraper（油漆刮刀）——油漆系统未建，策略 no-op 但集合保留 */
const PAINT_SCRAPER_ITEMS = new Set([1100, 1545]);
const PAINT_BRUSH_ITEMS = new Set([1071, 1543]);
const PAINT_ROLLER_ITEMS = new Set([1072, 1544]);

/** WorldGen.cs:3789 GrowTreeSettings.Profiles（GemCorns 策略档案：全部 TreeHeightMax=12 / SaplingTileType=590） */
const GEM_TREE_PROFILES: Record<number, { treeHeightMax: number; saplingTile: number }> = {
  4851: { treeHeightMax: 12, saplingTile: 590 },
  4852: { treeHeightMax: 12, saplingTile: 590 },
  4853: { treeHeightMax: 12, saplingTile: 590 },
  4854: { treeHeightMax: 12, saplingTile: 590 },
  4855: { treeHeightMax: 12, saplingTile: 590 },
  4856: { treeHeightMax: 12, saplingTile: 590 },
  4857: { treeHeightMax: 12, saplingTile: 590 },
};
/** WorldGen.cs:30461 GemTreeGroundTest = Conversion.Stone(TileID.cs:26) || Conversion.Moss(TileID.cs:38) */
const GEM_TREE_GROUND = new Set([1, 25, 117, 203, 182, 180, 179, 381, 183, 181, 534, 536, 539, 625, 627]);

/** 让位集（导出供测试）：原版 57 项 ∩ 我方已注册 sheet——未注册的 tile 不可能出现在世界里，
 *  即等价于"按我方已实现的交互裁剪"（门 10/11、宝箱 21/467、床 79、拉杆/开关/计时器、
 *  起爆器 411、生命水晶 29、药草 82/83、训练假人、火把 4 等都在原版集内）。 */
export const DISABLE_SMART_CURSOR_SHEETS: ReadonlySet<number> = (() => {
  const registered = new Set<number>();
  for (const d of TILE_DEFS) if (d?.vanilla?.sheet != null) registered.add(d.vanilla.sheet);
  return new Set(VANILLA_DISABLE_SMART_CURSOR_IDS.filter((s) => registered.has(s)));
})();

/** Main.cs:66188 SmartCursorDirectionLocks（上起顺时针 8 方向；箭头帧索引 = 下标） */
export const SMART_CURSOR_DIRECTION_LOCKS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

// ===================== tile sheet 桥 =====================

const SHEET_OF: number[] = new Array(TILE_DEFS.length).fill(-1);
for (let i = 0; i < TILE_DEFS.length; i++) SHEET_OF[i] = TILE_DEFS[i]?.vanilla?.sheet ?? -1;

/** 我方 tile id → 原版 sheet（无映射 -1）。
 *  ★P5 红蓝修正(A-m4):mod tile(注册期追加,越载入期快照长度)live 直读——
 *  伪 sheet≡stable 恒等式使平台连通锁等 sheet 域判定对 mod 平台成立 */
export function sheetOf(t: number): number {
  if (t >= 0 && t < SHEET_OF.length) return SHEET_OF[t];
  const d = TILE_DEFS[t];
  return d?.vanilla?.sheet ?? -1;
}

/** SmartCursorHelper.cs:167-175 UsingSmartCursorWithContinuity：手持放置物
 *  createTile≥0 ∧ TileID.Sets.Platforms——平台连通锁的存活条件（lookup 头 :64
 *  清锁门第三项;★SW-BJ29 2026-09-08 起 lookup/lookupSkipped 共用本单源）。 */
function usingSmartCursorWithContinuity(def: ItemDef | null | undefined): boolean {
  if (def?.tile == null) return false;
  return PLATFORMS.has(sheetOf(TILE_BY_KEY[def.tile] ?? -1));
}

// ===================== 设置（对齐原版 Player.SmartCursorSettings :320-329 + Main.cs:49705） =====================

export interface SmartCursorSettings {
  /** 模式：true=Toggle（默认，Main.cs:66090 cSmartCursorModeIsToggleAndNotHold 默认 true） */
  toggleMode: boolean;
  /** 斧优先级排后（默认 false：斧在镐之前） */
  smartAxeAfterPickaxe: boolean;
  /** 方块智能填充/铺线（默认 false——Player.SmartCursorSettings.SmartBlocksEnabled
   *  是 static bool 无写点，Player.cs:326；R24 勘误：曾标 true） */
  smartBlocksEnabled: boolean;
  /** Hold 模式下使用中松开即关（默认 false——同上 Player.cs:330 static bool；R24 勘误） */
  holdCanReleaseMidUse: boolean;
}

export const DEFAULT_SMART_CURSOR_SETTINGS: SmartCursorSettings = {
  toggleMode: true,
  smartAxeAfterPickaxe: false,
  smartBlocksEnabled: false,   // Player.cs:326
  holdCanReleaseMidUse: false, // Player.cs:330
};

/**
 * ★issue#44-8：controlSmart 电平（原版 1457 TriggersSet.cs:783-796
 * `if (CurrentInputMode != XBoxGamepadUI && !CursorIsBusy) { … p.controlSmart = SmartCursor; }`
 * ——电平本身**无** mouseInterface/界面门；CursorIsBusy 只覆盖环形菜单
 * PlayerInput.cs:436-443）。全屏地图才清零 controlSmart（Player.cs:24998）。
 * 界面门只挂在**切换调用**上（Player.cs:25056-25071）：
 *   `if (UsingGamepad || !mouseInterface || !ItemSlot.Options.DisableLeftShiftTrashCan) TryToToggleSmartCursor(…)`
 *
 * ★红队勘正（2026-11-03，issue#44 复核）：旧注「DisableLeftShiftTrashCan 默认
 * false ⇒ 门恒真」**是误读**——`ItemSlot.cs:28` 明确 `= true`。故桌面非手柄档
 * 门 = `!mouseInterface`，语义是「**光标悬停在任何 UI 上时不切换**」，与「某个
 * 面板是否打开」无关：面板开着但鼠标在世界一侧，原版照常切换；鼠标压在面板/
 * 背包/时间条/天气伞上，原版不切换。`mouseInterface` 由 Main 每帧帧头清零
 * （Main.cs:62758-62759）、悬停 UI 时置位（Main.cs:41729 等）——是本仓
 * `inpOverDomUi() || timeUiHover || weatherUiHover` 的等价面。
 *
 * 本仓 `Input.downAction` 首行 `if (uiBlocking) return false` ⇒ 模态界面内电平
 * 恒 false、切换失效（旧实现的两向偏差：面板内**任意**位置都切不了）。修法：
 * ①未遮挡帧照旧走 downAction；②`uiBlocking` 帧补物理/触摸键裸电平（不含虚拟
 * action 通道——登记债 D-A-2）；③悬停门与全屏地图门按原文门序收口（门关时
 * `updateWanted` 整段不执行，与原版「不调用 TryToToggleSmartCursor」同构）。
 */
export function smartCursorControlSmart(
  downAction: boolean, rawKeyDown: boolean, fullMapOpen: boolean,
): boolean {
  if (fullMapOpen) return false;   // Player.cs:24998 全屏地图清零 controlSmart
  return downAction || rawKeyDown; // 无模式门：Toggle/Hold 读同一电平（:29042-29071）
}

// ===================== 输入上下文 =====================

export interface SmartCursorHeld {
  def: ItemDef | null;
  /** Game 侧工具判定结果（镐/斧/锤，含 vi_ 桥接） */
  tool: { type: 'pick' | 'axe' | 'hammer' | 'sword'; power: number } | null;
}

export interface SmartCursorActor {
  x: number; y: number; w: number; h: number;   // position / width / height（px）
  cx: number; cy: number;                        // Center
  facing: number;                                // direction
}

export interface SmartCursorEnv {
  st: TileStore;
  /** MouseWorld（世界 px） */
  mouse: { x: number; y: number };
  actor: SmartCursorActor;
  held: SmartCursorHeld;
  settings: SmartCursorSettings;
  /** tileBoost（放置物加 blockRange；Game 侧与 inTileRange 同公式） */
  tileBoost: number;
  /** ★issue#44-4：Simple.GetRanges 的基础射程（Player.tileRangeX/Y 经射程配饰
   *  +3/+2、工具箱 +1、旅程远置 ×2+8 后，已按 TileReachCheckSettings.cs:28-42
   *  钳 ≤20）。Game 侧传 `this.tileReach(0)`；缺省 5/3 = 无配饰单人基线。
   *  tileRegion 在钳【后】再加 tileBoost（GetTileRegion :53-57 原序）。 */
  reachX?: number;
  reachY?: number;
  /** ★issue#44-6：WorldGen.CanKillTile 全式（1457 WorldGen.cs:62716-62832）——
   *  ForceCursor :2259 / MineSolids :2502 两消费点原以「pick>=0 类型近似」代读，
   *  缺动态拒绝面（上邻树干/箱下/祭坛下/锁门/巨石压箱等）。Game 侧注入带 ctx 的
   *  Game.canKillTile（hardMode + chestDestroyable 宝箱表）；未注入的调用方
   *  （帮工链/测试）回退 entities/Mounts.ts canKillTileAt【同一实现】。 */
  canKillTile?: (x: number, y: number) => boolean;
  /** ★issue#44-3：Main.tileCut 的【内部 id 域】判定。Game 侧注入
   *  `(t) => TILE_CUT.has(t)`（Game.ts:1609 = TILE_CUT_SHEETS 经 TILE_DEFS 平移，
   *  与 data/tiles.ts 权威表同源；IDG-T2 禁 player 面直查 sheet 表）。
   *  缺省回退 `TILE_DEFS[t].decor`（旧近似，仅测试/非 Game 调用方可达）。 */
  tileCut?: (t: number) => boolean;
  /** 多彩扳手/宏伟蓝图当前模式位（TOOL_*；仅 MulticolorWrench 策略用） */
  wireToolMode: number;
  /** EmptyTile 判定的占位实体（玩家 + NPC，px 盒） */
  occupants: Array<{ x: number; y: number; w: number; h: number }>;
  /** Step_Boulders :941-949(1457) 玩家命中盒净空的全玩家列表（原版遍历
   *  Main.player[0..254] 取 active && !dead 者——【只查玩家】，与 occupants
   *  （玩家+敌怪+城镇 NPC，口径来自 Collision.EmptyTile Collision.cs:1361-1376
   *  的双循环）不同；拿 occupants 代读会让敌怪/NPC 错误顶掉巨石候选）。
   *  缺省回退 [actor]（单人即 Main.player[0]；Game 侧 lookup 时玩家必非 dead），
   *  联机态由 Game 侧显式传全玩家列表。 */
  players?: Array<{ x: number; y: number; w: number; h: number }>;
  /** 是否正在按住使用键（controlUseItem）——锁清理与 Hold 模式语义用 */
  controlUseItem: boolean;
  /** 致动魔杖单摆向锁（Player.cs:2599-2601/:47296-47310;Step_ActuationRod
   *  :1506-1512 消费）——锁存期只标 LockSetting 同态格。缺省 false=无锁（与
   *  Player 字段初值同面）;Game 侧每帧传实况。 */
  actuationRodLock?: boolean;
  actuationRodLockSetting?: boolean;
  /** 当前背包油漆 id（SmartCursorHelper.cs:167-181 TryFindingPaintInplayerInventory 的
   *  paintLookup；仅手持刷/滚（1071/1543/1072/1544）时由 FindPaintOrCoating 取值，
   *  刮刀不查——缺省 0 = 三油漆策略目标集恒空，1:1） */
  paintLookup?: number;
  /** 同上的涂层侧（SmartCursorHelper.cs:40 paintCoatingLookup；:177
   *  coatingLookup = item.paintCoating。缺省 0 = 涂层项不参与目标集） */
  coatingLookup?: number;
  /** 钩爪锚点集（SmartCursorHelper.cs:106-115 _grappleTargets：player.grappling 表
   *  各锚 Center 的 tile 坐标）。Step_Pickaxe_MineSolids 射线终点/免挖集用；缺省空集 */
  grappleAnchors?: Pt[];
  /** Main.worldSurface（tile 坐标；本仓 = World.groundLevel 同一标量口径，
   *  Housing.ts:903 / HairDyeColor.ts:42 同源备案）。Step_Pigronata :987(1457)
   *  循环条件 / Step_PumpkinSeeds :1049(1457) 循环内 break 的地表截断线。
   *  缺省 Infinity = 不截断（未接世界态时保持旧行为；Game 侧恒传实况）。 */
  worldSurface?: number;
  /** ★SW-FX27：Player.gravDir 实况（SmartCursorHelper.cs:2435/:2438 num9 档位
   *  修正 + :196 轨道 314 让位门）。缺省 1 = 旧钉值（gd=1 行为逐位不变）；
   *  env.mouse 已是翻转修正后的 MouseWorld（camera.screenToWorld 内置
   *  ReverseGravitySupport，Main.cs:2835-2842），本处无须再自翻。 */
  gravDir?: number;
  /** WorldGen.IsAlchemyPlantHarvestable（WorldGen.cs:66198-66225）所需世界态。
   *  仅 Step_AlchemySeeds 的"成熟药草可覆盖"判定用；缺省按"未到收获期"处理
   *  （等价语义 = 仅 type 84 直接可收）。time 为原版 Main.time 口径：
   *  白天 (timeOfDay-0.25)*54000 / 夜晚 (timeOfDay-0.75 或 +0.25)*32400。 */
  alchemy?: {
    dayTime: boolean; bloodMoon: boolean; moonPhase: number;
    raining: boolean; cloudAlpha: number; time: number;
    worldSurface: number; remixWorld: boolean; maxTilesY: number;
  };
}

interface Pt { x: number; y: number }

// ===================== 格级谓词（Tile.cs / Main.tile* 语义） =====================

const tileSolidType = (t: number): boolean => !!TILE_DEFS[t]?.solid;            // Main.tileSolid
const tileSolidTopType = (t: number): boolean => !!TILE_DEFS[t]?.platform;      // Main.tileSolidTop
/** Main.tileAxe 全表——★BJ158②（2026-09-18）：本地副本 TILE_AXE_SHEETS_SC 拆除,
 *  收编 data/tiles.ts 单源 TILE_AXE_SHEETS（与 SmartSelect 副本同源漂移风险已消除）。
 *  ★2026-09-03 对账翻案：曾以 def.axe>=0 代读——def.axe 是"斧力需求"画像，平台 19
 *  等显式 axe:0 的非斧族格被误判入斧族（ForceCursor 镐支/stepAxe 扫描面失真） */
const tileAxeType = (t: number): boolean => TILE_AXE_SHEETS.has(sheetOf(t)); // Main.tileAxe
/** WorldGen.CanKillTile 全式判定（SmartCursorHelper **两处均按坐标读**：
 *  ForceCursor :2259 `tile.active() && WorldGen.CanKillTile(x, y)` /
 *  MineSolids :2502 `if (!WorldGen.CanKillTile(_targets[m].X, _targets[m].Y))`）。
 *  ★issue#44-6 改判史：旧实现 `(TILE_DEFS[t]?.pick ?? -1) >= 0` 只按类型判，
 *  丢掉 1457 WorldGen.cs:62716-62832 的全部动态拒绝面（上邻树干/箱下/祭坛下/
 *  锁门/传送器顶箱/巨石压箱/容器非空……）→ 智能光标钉在挖不动的格上。
 *  env.canKillTile（Game 注入，带 hardMode/chestDestroyable ctx）优先；
 *  未注入时回退 Mounts.canKillTileAt 同一实现（不造第二套；无 ctx 的最宽近似）。 */
function canKillTileAtEnv(env: SmartCursorEnv, x: number, y: number): boolean {
  if (env.canKillTile) return env.canKillTile(x, y);
  return canKillTileAt(env.st, x, y);
}
const tileFrameImportantType = (t: number): boolean => !!TILE_DEFS[t]?.framed;  // Main.tileFrameImportant
/** Main.tileCut（可割植物）判定。★issue#44-3 改判史：旧实现读
 *  `TILE_DEFS[t].decor`——decor 语义 =「装饰物（不碰撞、任意工具秒清）」，与
 *  Main.tileCut 不等价，两向偏差 78 项（decor 多：树干/绳/梁柱/墓碑/金币堆…）
 *  +22 项（tileCut 独有：蛛网/草簇/苔藓/生命果…）。
 *  权威表 = data/tiles.ts:1180 TILE_CUT_SHEETS（1457 Main.cs:7502-10388 全 41 条
 *  tileCut 赋值提取）。★IDG-T2：player 面新消费禁止直查 sheet 表——Game 侧经
 *  env.tileCut 注入其【内部 id 域】镜像 Game.TILE_CUT（同表派生，TILE_DEFS 注册序）。
 *  缺省回退 decor 仅测试/非 Game 调用方可达：lookup 生产调用点唯一 =
 *  Game.updateSmartCursor；帮工链只用导出核（stepAxeCore/stepMineSolidsCore），
 *  不经本谓词。 */
const tileCutType = (env: SmartCursorEnv, t: number): boolean =>
  env.tileCut ? env.tileCut(t) : !!TILE_DEFS[t]?.decor;

/** Main.cs:46058-46065 方向箭头显示门：锁向下一格须 !active 或可替换块才画
 *  SmartCursorArrow。"可替换" = PlaceThing_IsReplaceableBlock（Player.cs:39094-
 *  39103），本作沿用 tileCutType（Main.tileCut 可割植物）口径；锁向格为实心/家具
 *  等不可覆盖块时返回 false → 调用方传 null，渲染层不画箭头。
 *  越界按"未激活"处理（原版越界 Tile 为空 → !active() → 画；SmartCursor 已钳到
 *  [10, w-10]，锁向 ±1 实际不会越界）。 */
export function smartCursorArrowAllowed(
  st: TileStore, x: number, y: number, dir: Pt,
  /** ★issue#44-3：Main.tileCut 内部 id 域判定；缺省回退旧 decor 近似（测试面） */
  isTileCut?: (t: number) => boolean,
): boolean {
  const nx = x + dir.x, ny = y + dir.y;
  if (!st.inBounds(nx, ny)) return true;
  // Main.cs:47423 `(num2 >= 0 && !tile.active()) || …IsReplaceableBlock`——active() 口径
  if (!hasTileAt(st, nx, ny)) return true;
  const type = st.type[st.idx(nx, ny)];
  const sheet = sheetOf(type);
  // PlaceThing_IsReplaceableBlock（1457 Player.cs:40068-40075）：
  // (!Main.tileCut || 484 || 711) && 非 drip 族 {373-375,461,709} → BreakableWhenPlacing；否则 true。
  // ★issue#44-3：原版 41 条 tileCut 与 decor 不等价——如树苗 sheet20 为 decor 但
  //  ∉ Main.tileCut 且 ∉ BreakableWhenPlacing ⇒ 原版不画箭头（旧实现误画）。
  const cut = isTileCut ? isTileCut(type) : !!TILE_DEFS[type]?.decor;
  if ((!cut || sheet === 484 || sheet === 711)
    && sheet !== 373 && sheet !== 374 && sheet !== 375 && sheet !== 461 && sheet !== 709) {
    return breakableWhenPlacing(sheet);
  }
  return true;
}

const activeAt = (st: TileStore, x: number, y: number): boolean => st.isActive(x, y);
const inActiveAt = (st: TileStore, x: number, y: number): boolean => st.isActuated(x, y);
/** 原版 active()（Tile.cs:591 sTileHeader 0x20 位）= 纯 HasTile 位，**含已致动格**。
 *  ★2026-09-03 全策略谓词对账：SmartCursorHelper.cs 里凡写 `tile.active()` 的读取点
 *  （ForceCursor :2259 / MineShinies :2310 / Axe :2609 / ActuationRod :1518 / Torch :2825 /
 *  Actuators :594 / Walls :1123-1138 / 各放置类候选与锚位 / HitWallSubstep :1336 /
 *  EmptyTile :1364 / IsPlatform :1457 / 让位集 :197 / 箭头门 Main.cs:47423）一律走本谓词——
 *  已致动格在原版仍是"在场格"（可被选中/可作锚/占位）。此前全步误用 activeAt(=nactive)
 *  代读：已致动格被当空气（Ctrl 智能光标漏标/锚位丢失/可把目标放进致动格）。
 *  vanilla 写 nactive() 或 `active() && !inActive()` 的点（StaffOfRegrowth :238 /
 *  GrassSeeds :285 / Moss :353 / AlchemySeeds 地面 :507 / Boulders 支撑 :909 /
 *  MineSolids 射线 :2492 / Collision.HitLine/CanHitWithCheck）才用 activeAt。 */
const hasTileAt = (st: TileStore, x: number, y: number): boolean => st.hasTile(x, y);
/** Main.tileNoAttach（Main.cs:7260-10258 全表，见 TILE_NO_ATTACH_SHEETS）：该方块不可作为附着锚 */
const tileNoAttachType = (sheet: number): boolean => TILE_NO_ATTACH_SHEETS.has(sheet);

/** TileID.Sets.BreakableWhenPlacing（TileID.cs:383）：放置时被自动顶掉的方块 */
const breakableWhenPlacing = (sheet: number): boolean => BREAKABLE_WHEN_PLACING_SHEETS.has(sheet);

/** WorldGen.SolidTile（WorldGen.cs SolidTile(Tile)）:nactive && tileSolid && !tileSolidTop && !half && slope==0 */
function solidTile(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  if (!activeAt(st, x, y) || tileSolidTopType(st.type[i])) return false;
  return tileSolidType(st.type[i]) && st.half[i] === 0 && st.slope[i] === 0;
}

/** WorldGen.SolidTile2（Acorns/GemCorns 用）:active && tileSolid && slope==0 && !half && !inActive */
function solidTile2(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  if (!activeAt(st, x, y)) return false;
  return tileSolidType(st.type[i]) && st.slope[i] === 0 && st.half[i] === 0;
}

/** Collision.EmptyTile（Collision.cs:1361-1376）：ignoreTiles=false 时还要求本格 !active
 *  （:1364-1367）；随后逐占位实体（玩家/NPC）求交。 */
function emptyTile(env: SmartCursorEnv, x: number, y: number, ignoreTiles = false): boolean {
  const st = env.st;
  // Collision.cs:1364 `Main.tile[i,j].active() && !ignoreTiles`——active() 口径（含已致动格）
  if (!ignoreTiles && hasTileAt(st, x, y)) return false;
  const rx = x * 16, ry = y * 16;
  for (const o of env.occupants) {
    if (o.x < rx + 16 && o.x + o.w > rx && o.y < ry + 16 && o.y + o.h > ry) return false;
  }
  return true;
}

/** WorldGen.EmptyTileCheck（WorldGen.cs:31735-31822）1:1：矩形逐格——
 *  ① :31759-31763 `!tile.active() → continue`（★幽灵残型格 flags=0,type≠0 = 空，
 *  曾以裸 type 读当占位——红蓝对抗 F1 证伪批头注"幽灵格不受影响"断言）；
 *  ② :31762-31781 ignoreID switch：-1→占位即 false；11/71→仅同类放行；
 *  ③ ignoreID ∈ CommonSapling（20/590/595/615，:31753-31757 flag）时非同种格按
 *  :31783-31817 植物豁免表放行；④ 其余（含 ignoreType 同族树苗落穿）视为空。 */
const EMPTYTILECHECK_PLANTS = new Set([3, 24, 32, 61, 62, 69, 71, 73, 74, 82, 83, 84,
  110, 113, 184, 201, 233, 352, 485, 529, 530, 637, 655]);
function emptyTileCheck(st: TileStore, x1: number, x2: number, y1: number, y2: number, ignoreType: number): boolean {
  const flag = COMMON_SAPLING.has(ignoreType);          // :31753-31757
  for (let x = x1; x <= x2; x++) {
    for (let y = y1; y <= y2; y++) {
      if (!st.inBounds(x, y)) return false;             // :31750 越界 false
      if (!hasTileAt(st, x, y)) continue;               // :31759 active()
      const sheet = sheetOf(st.type[st.idx(x, y)]);
      if (ignoreType === -1) return false;              // :31764-31766
      if (ignoreType === 11 || ignoreType === 71) {     // :31767-31781
        if (sheet !== ignoreType) return false;
        continue;
      }
      if (flag && !COMMON_SAPLING.has(sheet)) {         // :31783-31785
        if (!EMPTYTILECHECK_PLANTS.has(sheet)) return false;
        continue;
      }
      // 落穿（ignoreType 同族树苗在场/非特判 id）= 视为空
    }
  }
  return true;
}

/** Collision.InTileBounds */
function inTileBounds(x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

const toWorld = (p: Pt): { x: number; y: number } => ({ x: p.x * 16 + 8, y: p.y * 16 + 8 });
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

/** 扫描型策略公共收尾：取离鼠标最近的候选（SmartCursorHelper 各策略统一模式） */
function nearestOf(targets: Pt[], mouse: { x: number; y: number }): Pt | null {
  if (targets.length === 0) return null;
  let best = -1;
  let point = targets[0];
  for (const t of targets) {
    const w = toWorld(t);
    const d = dist(w.x, w.y, mouse.x, mouse.y);
    if (best === -1 || d < best) { best = d; point = t; }
  }
  return point;
}

// ===================== Collision.HitLine 1:1（Collision.cs:782-979） =====================

export interface HitLineResult { hit: boolean; col: Pt }

/**
 * 镐射线：DDA 从 (x1,y1) 走到 (x2,y2)，返回首个 `tileSolid && !tileSolidTop && !inActive` 的格。
 * ignoreX/ignoreY 是 MineSolids 传入的 `signX*gravDir / -signY*gravDir`（起点一侧的邻居不判）。
 * 返回 hit=false 表示线路上出现越界格；hit=true 且 col==终点表示一路畅通。
 */
export function hitLine(
  st: TileStore, x1: number, y1: number, x2: number, y2: number,
  ignoreX: number, ignoreY: number, ignoreTargets: ReadonlyArray<Pt>,
): HitLineResult {
  let value = Math.max(1, Math.min(x1, st.w - 1));
  let value2 = Math.max(1, Math.min(y1, Math.max(2, st.h - 40)));
  let value3 = Math.max(1, Math.min(x2, st.w - 1));
  let value4 = Math.max(1, Math.min(y2, Math.max(2, st.h - 40)));
  const blocked = (x: number, y: number): boolean => {
    if (!st.inBounds(x, y)) return false;
    const i = st.idx(x, y);
    return !inActiveAt(st, x, y) && activeAt(st, x, y)
      && tileSolidType(st.type[i]) && !tileSolidTopType(st.type[i]);
  };
  const ignored = (x: number, y: number): boolean =>
    ignoreTargets.some((t) => t.x === x && t.y === y);
  const num = Math.abs(value - value3);
  const num2 = Math.abs(value2 - value4);
  if (num === 0 && num2 === 0) return { hit: true, col: { x: value, y: value2 } };
  let num3 = 1, num4 = 1;
  if (num === 0 || num2 === 0) {
    if (num === 0) num3 = 0;
    if (num2 === 0) num4 = 0;
  } else if (num > num2) num3 = num / num2;
  else num4 = num2 / num;
  let num5 = 0, num6 = 0;
  let num7 = value2 < value4 ? 2 : 1;
  let num8 = Math.floor(num), num9 = Math.floor(num2);
  const num10 = Math.sign(value3 - value);
  const num11 = Math.sign(value4 - value2);
  let flag = false, flag2 = false;
  do {
    if (num7 === 2) {
      // 纵向步进（先走 Y）
      num5 += num3;
      let num13 = Math.floor(num5);
      num5 -= num13;
      for (let j = 0; j < num13; j++) {
        if (!ignored(value, value2) && !ignored(value, value2 - 1) && !ignored(value, value2 + 1)) {
          if (ignoreY !== -1 && num11 < 0 && blocked(value, value2 - 1)) return { hit: true, col: { x: value, y: value2 - 1 } };
          if (ignoreY !== 1 && num11 > 0 && blocked(value, value2 + 1)) return { hit: true, col: { x: value, y: value2 + 1 } };
          if (blocked(value, value2)) return { hit: true, col: { x: value, y: value2 } };
        }
        if (num8 === 0 && num9 === 0) { flag = true; break; }
        value += num10; num8--;
        if (num8 === 0 && num9 === 0 && num13 === 1) flag2 = true;
      }
      if (num9 !== 0) num7 = 1;
    } else {
      // 横向步进（先走 X）
      num6 += num4;
      let num12 = Math.floor(num6);
      num6 -= num12;
      for (let i = 0; i < num12; i++) {
        if (!ignored(value, value2) && !ignored(value - 1, value2) && !ignored(value + 1, value2)) {
          if (ignoreX !== -1 && num10 < 0 && blocked(value - 1, value2)) return { hit: true, col: { x: value - 1, y: value2 } };
          if (ignoreX !== 1 && num10 > 0 && blocked(value + 1, value2)) return { hit: true, col: { x: value + 1, y: value2 } };
          if (blocked(value, value2)) return { hit: true, col: { x: value, y: value2 } };
        }
        if (num8 === 0 && num9 === 0) { flag = true; break; }
        value2 += num11; num9--;
        if (num8 === 0 && num9 === 0 && num12 === 1) flag2 = true;
      }
      if (num8 !== 0) num7 = 2;
    }
    if (blocked(value, value2) && !ignored(value, value2)) return { hit: true, col: { x: value, y: value2 } };
  } while (!(flag || flag2));
  return { hit: true, col: { x: value, y: value2 } };
}

// ===================== 手持物语义解析 =====================

/** 物品原版 id（def.vid 优先，vi_NNNN_ key 前缀兜底） */
export function vanillaItemIdOf(def: ItemDef | null | undefined): number | null {
  if (!def) return null;
  if (def.vid != null) return def.vid;
  const m = /^vi_(\d+)_/.exec(def.key);
  return m ? Number(m[1]) : null;
}

/** ★BJ433 导出（帮工链合成 sem 用）：手持物语义画像 */
export interface HeldSemantics {
  vid: number | null;
  pick: number; axe: number; hammer: number;
  createTileSheet: number | null;
  createWall: number | null;
  placeStyle: number;
  /** 背包油漆 id（env.paintLookup；SmartCursorHelper.cs:93 装配） */
  paintLookup: number;
  /** 背包涂层 id（env.coatingLookup；SmartCursorHelper.cs:40 paintCoatingLookup） */
  coatingLookup: number;
}

/** ★BJ433 导出（帮工链合成 sem 用） */
export function heldSemantics(held: SmartCursorHeld, paintLookup = 0, coatingLookup = 0): HeldSemantics {
  const def = held.def;
  const tool = held.tool;
  return {
    vid: vanillaItemIdOf(def),
    pick: tool?.type === 'pick' ? tool.power : 0,
    // 副斧力（Drax 579 等镐+斧双工具 / Hamaxe 锤+斧）：主工具之外再取 def.axePower
    axe: tool?.type === 'axe' ? tool.power : (def?.axePower ?? 0),
    hammer: tool?.type === 'hammer' ? tool.power : 0,
    createTileSheet: def?.tile != null ? sheetOf(TILE_BY_KEY[def.tile] ?? -1) : null,
    createWall: def?.wallId != null ? def.wallId : null,
    placeStyle: def?.placeStyle ?? 0,
    paintLookup,
    coatingLookup,
  };
}

// ===================== BJ433 步核独立化（类方法逐字搬出，类内委托不变形） =====================
//
// 捣蛋猫帮工链（Projectile.cs:52226-52250 TryAssigningHelp）以 IntentionGuesser 陈值
// 快照合成 SmartCursorUsageInfo 直调原版静态步 Step_Axe / Step_Pickaxe_MineSolids——
// 本仓原为类私有方法（实体侧无 SmartCursor 实例可达），提取为导出核：函数体逐字
// 搬移（只用模块级谓词/工具，零 this 消费已核实），类方法变纯委托，lookup 行为不变。

/** :2582-2690 斧步核（类方法 stepAxe 委托 + 帮工链 TryAssigningHelp 共用） */
export function stepAxeCore(
  env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
  set: (x: number, y: number) => void, taken: () => boolean,
): void {
  if (sem.axe <= 0 || taken()) return; // :2590
  const st = env.st;
  let best = -1;
  let bx = -1, by = -1;
  for (let i = reach.x0; i <= reach.x1; i++) {
    for (let j = reach.y0; j <= reach.y1; j++) {
      if (!hasTileAt(st, i, j)) continue; // :2609 tile.active()
      const type = st.get(i, j);
      const sheet = sheetOf(type);
      if (!tileAxeType(type) || IGNORE_SMART_AXE.has(sheet)) continue; // :2604
      let num2 = i, k = j;
      if (IS_A_TREE_TRUNK.has(sheet)) {
        // :2611-2646 多格树干帧校正（左右子块归位到主干列）+ 沿 Y 下到底（树根）
        // ★issue#44-9 改判史：原版 :2623-2651 三个 if 是【逐次重读】Main.tile[num2,k]
        //  （第一个 if 令 num2++ 后，后两个读的是新格）；旧版缓存首次索引，三判都读
        //  原格。原生树帧表下首支命中后的目标格不与后续签名交集（见 test 注证明），
        //  但世界编辑/模组/遗留帧可构造交叉签名 → 按 1:1 逐次重取（零行为代价）。
        if (inTileBounds(num2 + 1, k, reach.x0, reach.y0, reach.x1, reach.y1)) {
          let i2 = st.idx(num2, k);
          if (st.frameY[i2] >= 198 && st.frameX[i2] === 44) num2++;
          i2 = st.idx(num2, k);
          if (st.frameX[i2] === 66 && st.frameY[i2] <= 44) num2++;
          i2 = st.idx(num2, k);
          if (st.frameX[i2] === 44 && st.frameY[i2] >= 132 && st.frameY[i2] <= 176) num2++;
        }
        if (inTileBounds(num2 - 1, k, reach.x0, reach.y0, reach.x1, reach.y1)) {
          let i2 = st.idx(num2, k);
          if (st.frameY[i2] >= 198 && st.frameX[i2] === 66) num2--;
          i2 = st.idx(num2, k);
          if (st.frameX[i2] === 88 && st.frameY[i2] >= 66 && st.frameY[i2] <= 110) num2--;
          i2 = st.idx(num2, k);
          if (st.frameX[i2] === 22 && st.frameY[i2] >= 132 && st.frameY[i2] <= 176) num2--;
        }
        for (; hasTileAt(st, num2, k) && sheetOf(st.get(num2, k)) === sheet // :2653 active()
          && sheetOf(st.get(num2, k + 1)) === sheet
          && inTileBounds(num2, k + 1, reach.x0, reach.y0, reach.x1, reach.y1); k++) { /* 下到底 */ }
      }
      if (sheet === 80) {
        // :2647-2674 仙人掌帧校正 + 下到底
        // ★issue#44-9：同上（原版 :2659-2679 逐次重读；旧版缓存首索引）——仙人掌 ±1 两支
        if (inTileBounds(num2 + 1, k, reach.x0, reach.y0, reach.x1, reach.y1)) {
          let i2 = st.idx(num2, k);
          if (st.frameX[i2] === 54) num2++;
          i2 = st.idx(num2, k);
          if (st.frameX[i2] === 108 && st.frameY[i2] === 36) num2++;
        }
        if (inTileBounds(num2 - 1, k, reach.x0, reach.y0, reach.x1, reach.y1)) {
          let i2 = st.idx(num2, k);
          if (st.frameX[i2] === 36) num2--;
          i2 = st.idx(num2, k);
          if (st.frameX[i2] === 108 && st.frameY[i2] === 18) num2--;
        }
        for (; hasTileAt(st, num2, k) && sheetOf(st.get(num2, k)) === 80 // :2681 active()
          && sheetOf(st.get(num2, k + 1)) === 80
          && inTileBounds(num2, k + 1, reach.x0, reach.y0, reach.x1, reach.y1); k++) { /* 下到底 */ }
      }
      if (sheet === 323 || sheet === 72) {
        // :2675-2680 竹 / 棕榈干下到底
        for (; hasTileAt(st, num2, k) // :2687 active()
          && ((sheetOf(st.get(num2, k)) === 323 && sheetOf(st.get(num2, k + 1)) === 323)
            || (sheetOf(st.get(num2, k)) === 72 && sheetOf(st.get(num2, k + 1)) === 72))
          && inTileBounds(num2, k + 1, reach.x0, reach.y0, reach.x1, reach.y1); k++) { /* 下到底 */ }
      }
      const w = toWorld({ x: num2, y: k });
      const d = dist(w.x, w.y, env.mouse.x, env.mouse.y);
      if (best === -1 || d < best) { best = d; bx = num2; by = k; } // :2681-2687
    }
  }
  if (bx !== -1) set(bx, by);
}

/** :2350-2580 镐步核（类方法 stepMineSolids 委托 + 帮工链共用）。帮工侧 env.actor =
 *  IntentionGuesser 陈值快照（LastPosition/LastWidth/LastCenter/LastDirection）+
 *  现役 player.height/gravDir（:2362-2363 原文：height/gravDir 取自现役 player，
 *  position/Center/width/direction 取自陈值——Projectile.cs:52247 调用形参同构）；
 *  env.grappleAnchors = Projectile._miningHelperPointsToSkip（Projectile.cs:522 声明
 *  后仅 :52247 传参、全树零写点 = 恒空表，帮工侧传 [] 逐字）。 */
export function stepMineSolidsCore(
  env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
  set: (x: number, y: number) => void, taken: () => boolean,
): void {
  if (sem.pick <= 0 || taken()) return; // :2355
  const st = env.st;
  const p = env.actor;
  const gravDir = env.gravDir ?? 1;   // ★SW-FX27：env 实况（原钉 1；providedInfo.player.gravDir :2435/:2438）
  let mouse = { ...env.mouse };
  // :2369-2381 3:1 方向归约（|vx|>3|vy| 纯水平等）
  let vector = { x: mouse.x - p.cx, y: mouse.y - p.cy };
  let signX = Math.sign(vector.x);
  let signY = Math.sign(vector.y);
  if (Math.abs(vector.x) > Math.abs(vector.y) * 3) { signY = 0; mouse.y = p.cy; }
  if (Math.abs(vector.y) > Math.abs(vector.x) * 3) { signX = 0; mouse.x = p.cx; }
  void vector;
  const points: Pt[] = [];
  const endpoints: Pt[] = [];
  const num3 = (signY === -1 && signX !== 0) ? -1 : 1; // :2386-2390
  // :2391-2396 玩家前缘列 / 起始行
  const num4 = Math.floor((p.x + (p.w / 2) + ((p.w / 2 - 1) * signX)) / 16);
  let num5 = Math.floor((p.y + 0.1) / 16);
  if (num3 === -1) num5 = Math.floor((p.y + p.h - 1) / 16);
  const num6 = Math.floor(p.w / 16) + (p.w % 16 !== 0 ? 1 : 0);
  const num7 = Math.floor(p.h / 16) + (p.h % 16 !== 0 ? 1 : 0);
  // :2399-2418 起点集（前缘列 + 必要时底/顶行展开）
  if (signX !== 0) {
    for (let i = 0; i < num7; i++) {
      if (st.inBounds(num4, num5 + i * num3)) points.push({ x: num4, y: num5 + i * num3 });
    }
  }
  if (signY !== 0) {
    for (let j = 0; j < num6; j++) {
      const x = Math.floor(p.x / 16) + j;
      if (st.inBounds(x, num5)) points.push({ x, y: num5 });
    }
  }
  // :2419-2432 鼠标端点（假想玩家前缘/边缘展开）
  const num8 = Math.floor((mouse.x + ((p.w / 2 - 1) * signX)) / 16);
  let num9 = Math.floor((mouse.y + 0.1 - (p.h / 2 + 1)) / 16);
  if (num3 === -1) num9 = Math.floor((mouse.y + (p.h / 2) - 1) / 16);
  // :2435-2441 gravDir 档位修正（★SW-FX27 补 -1 支：倒挂时无水平向 → 端点行
  //   再 +1——倒挂挂顶时假想前缘从盒顶改盒底的同向补偿）
  if (gravDir === -1 && signY === 0) num9++;
  if (gravDir === 1 && signX === 0) num9++;
  if (num9 < 10) num9 = 10;
  if (num9 > st.h - 10) num9 = st.h - 10;
  const num10 = Math.floor(p.w / 16) + (p.w % 16 !== 0 ? 1 : 0);
  const num11 = Math.floor(p.h / 16) + (p.h % 16 !== 0 ? 1 : 0);
  if (num8 >= 40 && num9 >= 40 && num8 < st.w - 40 && num9 < st.h - 40) { // WorldGen.InWorld(,40)
    if (signX !== 0) {
      for (let k = 0; k < num11; k++) {
        if (st.inBounds(num8, num9 + k * num3)) endpoints.push({ x: num8, y: num9 + k * num3 });
      }
    }
    if (signY !== 0) {
      for (let l = 0; l < num10; l++) {
        const x = Math.floor((mouse.x - p.w / 2) / 16) + l;
        if (st.inBounds(x, num9)) endpoints.push({ x, y: num9 });
      }
    }
  }
  // :2466-2488 逐对射线。钩爪锚点集合（SmartCursorHelper.cs:106-115：清表后遍历
  // player.grappling，各锚 Center 取 tile 坐标入 _grappleTargets）——AI_007 实装后
  // 由 Game 侧 env.grappleAnchors 收集；无锚时空集（与原版无钩爪态一致）。
  const grappleTargets: Pt[] = env.grappleAnchors ?? [];
  const targets: Pt[] = [];
  let pi = 0;
  while (pi < points.length && endpoints.length > 0) {
    const item = points[pi];
    const item2 = endpoints[0];
    const r = hitLine(st, item.x, item.y, item2.x, item2.y, signX * gravDir, -signY * gravDir, grappleTargets);
    if (!r.hit) { pi++; endpoints.shift(); continue; }
    if (r.col.x !== item2.x || r.col.y !== item2.y) targets.push(r.col);
    const t = st.get(r.col.x, r.col.y);
    if (!inActiveAt(st, r.col.x, r.col.y) && activeAt(st, r.col.x, r.col.y)
      && tileSolidType(t) && !tileSolidTopType(t)
      && !grappleTargets.some((p) => p.x === r.col.x && p.y === r.col.y)) {
      targets.push(r.col); // :2492-2495（尾臂 !grappleTargets.Contains(col)——红蓝对抗 F3 补）
    }
    pi++;
    endpoints.shift();
  }
  // :2489-2501 CanKillTile 过滤（不查镐力；1457 :2502 `WorldGen.CanKillTile(X, Y)`）
  // ★issue#44-6：按【坐标】读全式——旧版只按类型 pick>=0，树根/箱下/祭坛下的
  // 候选不被剔除 → 光标钉在挖不动的格上。
  const killable = targets.filter((t) => canKillTileAtEnv(env, t.x, t.y));
  if (killable.length > 0) {
    // :2502-2576 择近 = 格中心+8px 到玩家 Center（单人无联机偏移）
    let best = -1;
    let point = killable[0];
    for (const t of killable) {
      const w = toWorld(t);
      const d = dist(w.x, w.y, p.cx, p.cy);
      if (best === -1 || d < best) { best = d; point = t; }
    }
    if (inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y);
    }
  }
}

// ===================== SmartCursor 状态机 + 策略链 =====================

// ★SW-BJ84 2026-09-14 开态跨世界保留：Main.SmartCursorWanted_Mouse 是 Main 的 static 字段
// （Main.cs:2095），全树【直接赋值点】仅 Main.cs:67590（进程启动置 false）与
// Player.cs:25650（SmartCursorLookup 异常复位）——★RB20b note④ 措辞勘误
// （2026-09-15）：原注「全树写点仅 2 处」易误导后车 grep——另有取址翻转站
// Player.cs:25061/:25069 TryToToggleSmartCursor(ref …)（按键切换经 ref 写回,不在
// 「直接赋值」列）;进程内退世界/换世界【保留】开态，进程重启即失；config.json
// 不持久化开态（SaveSettings 只存 SmartCursorToggle 模式键，Main.cs:4199/4422）。本仓每进世界
// 重建 Game 实例（SmartCursor 随之重建），故以模块级变量承载页面（进程）寿命的开态：实例构造
// 时读它作初值，仅 updateWanted 切换拍回写；外部直赋 .wanted（测试/触屏钮 MobileControls:695/
// Game destroy 复位）不回写——与原版「直写 Main.SmartCursorWanted_Mouse 即进程态」的差异由
// 唯一运行时切换入口 updateWanted 承接，直赋点全部是一次性会话管理面，语义互不干扰。
let sessionWanted = false;

/** ★SW-BJ84 测试/显式流程用：把会话开态清回「进程刚启动」相（Main.cs:67590 静态构造器）。
 *  运行时无需调用——页面刷新即模块重建天然复位（模块寿命=页面寿命）。 */
export function resetSmartCursorSessionState(): void {
  sessionWanted = false;
}

export class SmartCursor {
  // Main.cs:2074-2084
  wanted = sessionWanted; // SmartCursorWanted_Mouse（初值读会话态，★SW-BJ84 见上）
  showing = false;       // SmartCursorShowing
  x = -1; y = -1;        // SmartCursorX/Y
  /** SmartCursorHelper.cs:55-57 方向锁/连通锁（仅 Platforms 写入 :1382-1383） */
  lockedDirection: Pt | null = null;
  lockedContinuity: Pt | null = null;
  private prevSmart = false;

  /** Player.cs:29042-29071 TryToToggleSmartCursor 1:1。
   *  返回 true = 发生按下沿（调用方播音效 12 / menuTick）。
   *  ★红队勘正（2026-11-03）：旧注行号 `:28344-28374` 是 1456 旧档，1457 实锚
   *  29042-29071。
   *  `gateOpen`：原版界面门（Player.cs:25057 `!mouseInterface`）关的是**对
   *  TryToToggleSmartCursor 的整段调用**，不是里面的某一个分支。故门关时本函数
   *  `wanted`/`sessionWanted` **冻结**，但 `prevSmart` 仍须跟随 controlSmart
   *  （原版 `releaseSmart` 的更新在门**外**：Player.cs:25072-25079）——否则
   *  「按住 Ctrl 划过面板再把鼠标移出」会在门开的瞬间补一次本不该有的切换沿。 */
  updateWanted(
    controlSmart: boolean, controlUseItem: boolean, s: SmartCursorSettings, gateOpen = true,
  ): boolean {
    const edge = controlSmart && !this.prevSmart;
    this.prevSmart = controlSmart;
    if (!gateOpen) return false;   // 原版整段 TryToToggleSmartCursor 不执行
    if (s.toggleMode) {
      if (edge) this.wanted = !this.wanted;
      sessionWanted = this.wanted; // ★SW-BJ84 切换拍回写会话态（跨世界保留）
      return edge;
    }
    if (s.holdCanReleaseMidUse) {
      this.wanted = controlSmart;
    } else if (this.wanted) {
      if (!controlSmart && !controlUseItem) this.wanted = false;
    } else {
      this.wanted = controlSmart;
    }
    sessionWanted = this.wanted; // ★SW-BJ84 电平拍回写（Hold 模式松开即归 false，同原版 static 收敛）
    return edge;
  }

  /** SmartCursorLookup（SmartCursorHelper.cs:61-165）1:1。 */
  lookup(env: SmartCursorEnv): void {
    this.showing = false; // :63
    const used = this.wanted; // Main.SmartCursorIsUsed = SmartCursorWanted（Main.cs:2962）
    // R4-44（SmartCursorHelper.cs:64/:167-174）：1457 清锁条件补第三项
    // !UsingSmartCursorWithContinuity——连通锁只对【持平台类物品】跨帧存活;
    // 中途切非平台物品再切回,原版锁已被中间帧清掉,本仓曾沿用陈旧锁线
    if (!env.controlUseItem || !used || !usingSmartCursorWithContinuity(env.held.def)) { // :64-68
      this.lockedDirection = null;
      this.lockedContinuity = null;
    }
    if (!used) return; // :69-72

    const st = env.st;
    const sem = heldSemantics(env.held, env.paintLookup ?? 0, env.coatingLookup ?? 0);
    const s = env.settings;
    // :82-87 tileTarget 钳到世界 [10, max-10]
    const raw = { x: Math.floor(env.mouse.x / 16), y: Math.floor(env.mouse.y / 16) };
    const screenX = Math.max(10, Math.min(raw.x, st.w - 10));
    const screenY = Math.max(10, Math.min(raw.y, st.h - 10));
    if (!st.inBounds(screenX, screenY)) return; // :88-91
    // :92 让位集（★SW-FX27：gravDir 实况——314 轨道倒挂不让位）
    const blocks = isHoveringOverAnInteractableTile(st, screenX, screenY, env.gravDir ?? 1);
    // :94-103 可达区 = GetTileRegion(tileBoost)（TileReachCheckSettings.cs:53）。
    // TB（item.tileBoost + 放置物 blockRange）已由 Game 侧并入 env.tileBoost；
    // 基础射程由 env.reachX/Y（Game.tileReach(0)，含配饰/工具箱/旅程）提供——
    // ★issue#44-4：旧实现硬编码 5/3，配饰/旅程下智能光标区比放置判定窄。
    const reach = tileRegion(env.actor, env.tileBoost, st, env.reachX ?? 5, env.reachY ?? 3);
    // :104 让位集命中且鼠标格在可达区内 → 本次不查找
    if (blocks
      && inTileBounds(screenX, screenY, reach.x0, reach.y0, reach.x1, reach.y1)) {
      return;
    }
    let fX = -1, fY = -1;
    // :118-128 斧的插入位置由 SmartAxeAfterPickaxe 决定（默认 false = 斧最优先）
    const steps: Array<() => void> = [];
    if (!s.smartAxeAfterPickaxe) steps.push(() => this.stepAxe(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1));
    steps.push(
      () => this.stepForceCursor(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepMineShinies(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepMineSolids(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
    );
    if (s.smartAxeAfterPickaxe) steps.push(() => this.stepAxe(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1));
    steps.push(
      () => this.stepColoredWrenches(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepMulticolorWrench(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepHammers(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepActuationRod(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepWireCutter(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepPlatforms(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepMinecartTracks(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepWalls(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepPumpkinSeeds(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepGrassSeeds(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepMoss(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepPigronata(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepBoulders(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepTorch(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepLawnMower(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepBlocksFilling(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepBlocksLines(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepPaintRoller(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepPaintBrush(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepPaintScrapper(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepAcorns(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepGemCorns(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepEmptyBuckets(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepActuators(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepAlchemySeeds(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepPlanterBox(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepClayPots(env, sem, reach, screenX, screenY, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
      () => this.stepStaffOfRegrowth(env, sem, reach, (x, y) => { fX = x; fY = y; }, () => fX !== -1),
    );
    for (const step of steps) {
      if (fX !== -1 && fY !== -1) break; // 首个命中独占（:118-156 顺序执行）
      step();
    }
    if (fX !== -1 && fY !== -1) { // :157-162
      this.x = fX;
      this.y = fY;
      this.showing = true;
    }
  }

  /** ★SW-BJ29 2026-09-08：跳过帧的 lookup 头等价（SmartCursorHelper.cs:63-68）。
   *  原版 SmartCursorLookup 每帧【无条件】调用（Player.cs:25641-25645,仅 whoAmI/
   *  相机跟踪两门,无 SmartCursorIsUsed/界面门）,清锁门(:64-68)先于 `!SmartCursorIsUsed`
   *  早退(:69-72)——智能光标【关闭】的帧平台连通锁同样被清（used=false ⇒ 条件恒真,
   *  与 controlUseItem/持物无关）。本仓 Game.updateSmartCursor 在 !wanted/界面遮挡帧
   *  整支跳过 lookup（后续管线本仓刻意不跑,与原版唯一有意的分叉）,曾致置锁
   *  （Step_Platforms :1392-1393,须智能开+持平台）后锁跨模式滞留 → tryPlace 头
   *  TileTargetDesired 门（Player.cs:40032）在 showing 恒 false 下把一切 tile 放置
   *  拦死（用户实报"不开智能光标放不了平台、物块"）。本前奏即补回 :63-68 段;
   *  used 传调用帧 SmartCursorIsUsed 实况:智能关帧恒 false;界面遮挡帧 wanted 仍在
   *  ⇒ 按原文条件消费 controlUseItem+持物平台位（原版该帧会跑整支管线,本仓跳过
   *  ——分叉既有,不在此扩） */
  lookupSkipped(controlUseItem: boolean, used: boolean, heldDef: ItemDef | null): void {
    this.showing = false; // :63
    if (!controlUseItem || !used || !usingSmartCursorWithContinuity(heldDef)) { // :64-68
      this.lockedDirection = null;
      this.lockedContinuity = null;
    }
    // :69-72 `!SmartCursorIsUsed → return`——跳过帧的后续管线本就不运行,同相
  }

  // ===================== 各策略 =====================

  /** :2582-2690 斧：扫 tileAxe → 树干帧校正 → 沿 Y 走到根 → 离鼠标最近
   *  （★BJ433 函数体搬出为 stepAxeCore 导出核,本方法纯委托——lookup 行为不变） */
  private stepAxe(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    stepAxeCore(env, sem, reach, set, taken);
  }

  /** :2229-2268 ForceCursor：鼠标格自身可挖（非实心/平台）且工具门通过 → 钉鼠标格 */
  private stepForceCursor(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (taken()) return;
    const st = env.st;
    const x = Math.floor(env.mouse.x / 16), y = Math.floor(env.mouse.y / 16);
    if (!inTileBounds(x, y, reach.x0, reach.y0, reach.x1, reach.y1)) return;
    const t = st.get(x, y);
    const sheet = sheetOf(t);
    // :2259 `tile.active() && WorldGen.CanKillTile(x, y) && (!Main.tileSolid || tileSolidTop)`
    // ★issue#44-6：坐标全式（含动态拒绝面），旧版只按类型 pick>=0。
    let flag = hasTileAt(st, x, y) && canKillTileAtEnv(env, x, y)
      && (!tileSolidType(t) || tileSolidTopType(t)); // :2259 active()
    if (flag && tileAxeType(t) && sem.axe < 1) flag = false;      // :2250-2253
    if (flag && isHammerTile(sheet) && sem.hammer < 1) flag = false; // :2254-2257
    if (flag && !isHammerTile(sheet) && !tileAxeType(t) && sem.pick < 1) flag = false; // :2258-2261
    if (flag) set(x, y);
  }

  /** :2270-2348 MineShinies：优先级表（12 火把 / 639 / 665）全扫取离鼠标最近 */
  private stepMineShinies(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.pick <= 0 || taken()) return; // :2280
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!hasTileAt(st, i, j)) continue; // :2310 tile.active()（已致动矿仍可选）
        const sheet = sheetOf(st.get(i, j));
        if ((PICKAXE_PRIORITY_OVERRIDE[sheet] ?? 0) > 0) targets.push({ x: i, y: j }); // :2304-2312
      }
    }
    // :2325-2337 原版 `_targets2` 为空集、foreach 空集 = 死代码【不过滤】——全部
    //  priority>0 目标都保留（红蓝对抗 F5：曾按 ≥maxPri 自造过滤，现表全 1 时恒等价、
    //  表内出现非 1 优先级即错删低优目标，按原版删过滤）
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y); // :2341-2345
    }
  }

  /** :2350-2580 MineSolids：3:1 方向归约 → 玩家前缘列 ↔ 鼠标端点逐对射线 → 择近
   *  （★BJ433 函数体搬出为 stepMineSolidsCore 导出核,本方法纯委托——lookup 行为不变） */
  private stepMineSolids(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    stepMineSolidsCore(env, sem, reach, set, taken);
  }

  /** :1879-2030 彩色扳手（红 509/蓝 850/绿 851/黄 3612）：延伸已有同色导线断点一格 */
  private stepColoredWrenches(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid;
    if (vid == null || ![509, 850, 851, 3612].includes(vid) || taken()) return; // :1881
    const st = env.st;
    // :1886-1902 颜色档：509红(1)/850蓝(2)/851绿(3)/3612黄(4)
    const num = vid === 509 ? 1 : vid === 850 ? 2 : vid === 851 ? 3 : 4;
    const wireBit = num === 1 ? TS.WIRE_RED : num === 2 ? TS.WIRE_BLUE : num === 3 ? TS.WIRE_GREEN : TS.WIRE_YELLOW;
    // :1903-1919 鼠标格已有同色线 → 让位（原版 flag=true 时不产生目标）
    const hoverWire = st.inBounds(screenX, screenY) ? st.wire[st.idx(screenX, screenY)] : 0;
    if ((hoverWire & wireBit) !== 0) return;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        if ((st.wire[st.idx(i, j)] & wireBit) === 0) continue;
        // :1931-2006 四向断点延伸
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = i + ox, ny = j + oy;
          if (!st.inBounds(nx, ny)) continue;
          if ((st.wire[st.idx(nx, ny)] & wireBit) === 0) targets.push({ x: nx, y: ny });
        }
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y);
    }
  }

  /** :1724-1877 多彩扳手（3625）：按当前工具模式延伸/剪除 */
  private stepMulticolorWrench(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.vid !== 3625 || taken()) return; // :1726
    const st = env.st;
    const toolMode = env.wireToolMode; // WiresUI.Settings.ToolMode（Game.wireToolMode）
    // ★issue#44-2 改判史：工具位（WiresUI.MultiToolMode：Red=1/Green=2/Blue=4/
    //  Yellow=8；wiringToolBits.ts 同值）与线位（TileStore：WIRE_RED=1/WIRE_BLUE=2/
    //  WIRE_GREEN=4/WIRE_YELLOW=8）两套位序不同。旧版把工具位当线位用（bit2 工具
    //  Green 去查 WIRE_BLUE、bit4 工具 Blue 去查 WIRE_GREEN），蓝/绿单色模式指错色。
    //  正确映射 = 红1→红1、绿2→绿4、蓝4→蓝2、黄8→黄8；序保持原版
    //  flag(红)/flag2(蓝)/flag3(绿)/flag4(黄)（SmartCursorHelper.cs:1764-1768）。
    const bits: Array<[boolean, number]> = [
      [(toolMode & 1) !== 0, TS.WIRE_RED],      // Red
      [(toolMode & 4) !== 0, TS.WIRE_BLUE],     // Blue（工具位 4 → 线位 2）
      [(toolMode & 2) !== 0, TS.WIRE_GREEN],    // Green（工具位 2 → 线位 4）
      [(toolMode & 8) !== 0, TS.WIRE_YELLOW],   // Yellow
    ];
    const cutter = (toolMode & 32) !== 0;
    // :1743-1758 鼠标格已有线组合 → multiToolMode（**工具位域**）：
    //   wire()=红→Red1 / wire2()=蓝→Blue4 / wire3()=绿→Green2 / wire4()=黄→Yellow8。
    //   旧版蓝/绿两支同样互换了工具位（wire2→|=2、wire3→|=4）。
    const hoverWire = st.inBounds(screenX, screenY) ? st.wire[st.idx(screenX, screenY)] : 0;
    let mouseMode = 0;
    if (hoverWire & TS.WIRE_RED) mouseMode |= 1;      // Red
    if (hoverWire & TS.WIRE_BLUE) mouseMode |= 4;     // Blue（线位 2 → 工具位 4）
    if (hoverWire & TS.WIRE_GREEN) mouseMode |= 2;    // Green（线位 4 → 工具位 2）
    if (hoverWire & TS.WIRE_YELLOW) mouseMode |= 8;   // Yellow
    if ((toolMode & ~32) === mouseMode) return;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const w = st.wire[st.idx(i, j)];
        if (cutter) {
          // :1764-1770 剪线模式：已选色有线的格都是目标
          for (const [on, bit] of bits) if (on && (w & bit) !== 0) { targets.push({ x: i, y: j }); break; }
        } else {
          // :1772-1853 铺线模式：延伸每色断点一格
          let any = false;
          for (const [on, bit] of bits) if (on && (w & bit) !== 0) { any = true; break; }
          if (!any) continue;
          for (const [on, bit] of bits) {
            if (!on) continue;
            for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
              const nx = i + ox, ny = j + oy;
              if (!st.inBounds(nx, ny)) continue;
              if ((st.wire[st.idx(nx, ny)] & bit) === 0) targets.push({ x: nx, y: ny });
            }
          }
        }
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y);
    }
  }

  /** :1536-1723 锤：两段。第一段 :1587-1677 逐对 HitLineWall 射线取离玩家 Center 最近
   *  （剔除祭坛 26，:1657-1672）；第二段 :1683-1721 射线无果时全扫可达区内可锤墙
   *  （HitWallSubstep），取离鼠标最近——这是原版既定回退，不是近似。
   *  player.poundRelease=false 的副作用（:1674/:1717）属 Player 锤击状态机，
   *  本类不承载，由挖掘路径按 poundRelease 语义自理。 */
  private stepHammers(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.hammer <= 0 || taken()) return; // :1540/:1683
    const st = env.st;
    const p = env.actor;
    const gravDir = env.gravDir ?? 1;   // ★issue#44-7b：:1608 逆重力档（原钉 1 缺支）
    let mouse = { ...env.mouse };
    // :1542-1554 3:1 方向归约（同 MineSolids）
    const vector = { x: mouse.x - p.cx, y: mouse.y - p.cy };
    let signX = Math.sign(vector.x);
    let signY = Math.sign(vector.y);
    if (Math.abs(vector.x) > Math.abs(vector.y) * 3) { signY = 0; mouse.y = p.cy; }
    if (Math.abs(vector.y) > Math.abs(vector.x) * 3) { signX = 0; mouse.x = p.cx; }
    const num3 = (signY === -1 && signX !== 0) ? -1 : 1;
    const points: Pt[] = [], endpoints: Pt[] = [];
    const num4 = Math.floor((p.x + (p.w / 2) + ((p.w / 2 - 1) * signX)) / 16);
    let num5 = Math.floor((p.y + 0.1) / 16);
    if (num3 === -1) num5 = Math.floor((p.y + p.h - 1) / 16);
    const num6 = Math.floor(p.w / 16) + (p.w % 16 !== 0 ? 1 : 0);
    const num7 = Math.floor(p.h / 16) + (p.h % 16 !== 0 ? 1 : 0);
    if (signX !== 0) for (let i = 0; i < num7; i++) if (st.inBounds(num4, num5 + i * num3)) points.push({ x: num4, y: num5 + i * num3 });
    if (signY !== 0) for (let j = 0; j < num6; j++) { const x = Math.floor(p.x / 16) + j; if (st.inBounds(x, num5)) points.push({ x, y: num5 }); }
    const num8 = Math.floor((mouse.x + ((p.w / 2 - 1) * signX)) / 16);
    let num9 = Math.floor((mouse.y + 0.1 - (p.h / 2 + 1)) / 16);
    if (num3 === -1) num9 = Math.floor((mouse.y + (p.h / 2) - 1) / 16);
    // ★issue#44-7b：SmartCursorHelper.cs:1608-1611 `if (player.gravDir == -1f &&
    //  num2 == 0) num9++;`（num2 = signY）——倒挂且纯水平瞄准时端点行再 +1。
    //  旧版 stepHammers 整支缺该档（stepMineSolids :2435/:2439 两档齐备可对照）。
    if (gravDir === -1 && signY === 0) num9++;
    num9 = Math.max(10, Math.min(num9, st.h - 10));
    const num10 = Math.floor(p.w / 16) + (p.w % 16 !== 0 ? 1 : 0);
    const num11 = Math.floor(p.h / 16) + (p.h % 16 !== 0 ? 1 : 0);
    if (signX !== 0) for (let k = 0; k < num11; k++) if (st.inBounds(num8, num9 + k * num3)) endpoints.push({ x: num8, y: num9 + k * num3 });
    if (signY !== 0) for (let l = 0; l < num10; l++) { const x = Math.floor((mouse.x - p.w / 2) / 16) + l; if (st.inBounds(x, num9)) endpoints.push({ x, y: num9 }); }
    // :1632-1655 逐对 HitLineWall（Collision.cs:1148）：(-1,-1) 双端出队续下一对；
    //  非终点命中先入 targets，再经 HitWallSubstep 复核入 targets（:1649-1652）
    const targets: Pt[] = [];
    let pi = 0;
    while (pi < points.length && endpoints.length > 0) {
      const a = points[pi], b = endpoints[0];
      const col = hitLineWall(st, a.x, a.y, b.x, b.y);
      if (col.x !== -1) {
        if (col.x !== b.x || col.y !== b.y) targets.push(col);
        if (hitWallSubstep(st, col.x, col.y)) targets.push(col);
      }
      pi++;
      endpoints.shift();
    }
    const pick = pickNonAltar(st, targets, (t) => toWorld(t), { x: p.cx, y: p.cy });
    if (pick && inTileBounds(pick.x, pick.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(pick.x, pick.y);
      return;
    }
    // :1683-1721 原版回退段：全扫可达区可锤墙，取离鼠标最近（剔除祭坛 26）
    const targets2: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        if (st.wall[st.idx(i, j)] > 0 && hitWallSubstep(st, i, j)) targets2.push({ x: i, y: j });
      }
    }
    // ★issue#44-7a 改判史：原版 :1555-1564 是【就地改写】 providedInfo.mouse
    //  （`providedInfo.mouse.Y = providedInfo.Center.Y`），故本回退段 :1716 的择近
    //  基准是【已 3:1 归约】的鼠标。旧版此处用未归约 env.mouse，纯水平瞄准时
    //  原始 mouse.y 的噪声会翻转远近排序（实测 (50,102) vs 原版 (50,95)）。
    const pick2 = pickNonAltar(st, targets2, (t) => toWorld(t), mouse);
    if (pick2 && inTileBounds(pick2.x, pick2.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(pick2.x, pick2.y);
    }
  }

  /** :1494-1534 致动魔杖（3620）：已装致动器的实心格取最近 */
  private stepActuationRod(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.vid !== 3620 || taken()) return;
    const st = env.st;
    const lock = env.actuationRodLock ?? false;
    const lockSetting = env.actuationRodLockSetting ?? false;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const w = st.wire[st.idx(i, j)];
        // :1518 tile.active() && tile.actuator() && (!lock || lockSetting==inActive())
        // ——active() 口径：已致动格仍可被魔杖选中（打回活体）。★A-6（2026-09-04）
        // ActuationRodLock 单摆向锁已移植（Player.cs:47296-47310 置位/:18918-18921
        // 左键松开清理）——锁存期只标 LockSetting 同态格,异态格不进目标集。
        if (hasTileAt(st, i, j) && (w & TS.WIRE_ACTUATOR) !== 0
          && (!lock || lockSetting === st.isActuated(i, j))) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :1454-1492 剪线钳（510）：任何导线/致动器格取最近 */
  private stepWireCutter(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.vid !== 510 || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        if (st.wire[st.idx(i, j)] & 31) targets.push({ x: i, y: j }); // :1466 四色线或致动器
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :1323-1388 平台：已有平台边缘沿八方向续一格；写方向锁/连通锁 */
  private stepPlatforms(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const createSheet = sem.createTileSheet;
    if (createSheet == null || !PLATFORMS.has(createSheet) || taken()) return; // :1325
    const st = env.st;
    if (isPlatformSheet(st, screenX, screenY)) return; // 鼠标已在平台上不动
    const targets: Pt[] = [];
    const points: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        // :1335 鼠标指向该格的八方向量化
        const dir = this.getDesiredDirectionFrom({ x: env.mouse.x - (i * 16 + 8), y: env.mouse.y - (j * 16 + 8) });
        let flag = !isPlatformSheet(st, i, j); // :1346
        // ★SW-BJ49 2026-09-09：:1347-1350 臂条件是【flag】——flag 语义=「跳过此源」
        //  （:1351 `if (flag) continue;`）,该臂把「鼠标水平对齐 ∧ 活动格 ∧ 非实心
        //  （草/杂/藤等,WorldGen.SolidTile 口径）∧ 左右任一为平台」的【非平台】格
        //  收编为续铺源（flag=false→不跳过）。曾反写成 `!flag` ⇒ 臂只命中平台格
        //  （flag 已 false,二次置 false=零动作）⇒ 非平台格恒被跳过=平台行中断格
        //  （割草/踩草重铺面）两侧无法智能续铺,原版本相丢失。实报域
        //  "开智能可放/关智能不可放"主根=原版 Step_Platforms 目标重定位面本身
        //  （本臂为该面精度缺口,同批修正）。
        if (flag && dir.y === 0 && hasTileAt(st, i, j) && !solidTile(st, i, j)
          && (isPlatformSheet(st, i - 1, j) || isPlatformSheet(st, i + 1, j))) {
          flag = false;
        }
        if (flag) continue;
        // :1345 对角规则映射 slope（1=右上 2=右下 等：dx==dy→2、dx==-dy→1）
        const slopeKind = dir.x === dir.y ? 2 : dir.x === -dir.y ? 1 : 0;
        if ((slopeKind === 0 || st.slope[st.idx(i, j)] !== slopeKind)
          && (dir.x !== 0 || (!isPlatformSheet(st, i - 1, j + dir.y) && !isPlatformSheet(st, i + 1, j + dir.y)))) {
          const nx = i + dir.x, ny = j + dir.y;
          if (!st.inBounds(nx, ny)) continue;
          const nt = st.get(nx, ny);
          if ((!hasTileAt(st, nx, ny) || tileCutType(env, nt)) && this.allowedForContinuity(nx, ny, 2)) { // :1359 active()
            targets.push({ x: nx, y: ny });
            points.push({ x: dir.x, y: dir.y });
          }
        }
      }
    }
    if (targets.length === 0) return;
    // :1359-1377 离鼠标最近，并列时取"沿锁定方向投影更大"
    let num2 = -1, num3 = -1;
    let point = targets[0], point2 = points[0];
    for (let k = 0; k < targets.length; k++) {
      const t = targets[k], d = points[k];
      const vx = env.mouse.x - (t.x * 16 + 8), vy = env.mouse.y - (t.y * 16 + 8);
      const len = Math.hypot(vx, vy);
      const dot = vx * d.x + vy * d.y;
      if (num2 === -1 || len < num2 || (len === num2 && dot > num3)) {
        num2 = len; num3 = dot; point = t; point2 = d;
      }
    }
    if (inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y);
      this.lockedDirection = { x: point2.x, y: point2.y };   // :1382
      this.lockedContinuity = { x: point.x, y: point.y };    // :1383
    }
  }

  /** :1403-1428 AllowedForContinuity：目标须与连通锁重合或在锁方向步进可达 */
  private allowedForContinuity(x: number, y: number, skipsAllowed: number): boolean {
    const lock = this.lockedContinuity;
    if (!lock) return true;
    let cx = lock.x, cy = lock.y;
    if (x === cx && y === cy) return true;
    const dir = this.lockedDirection;
    if (!dir) return false;
    for (let i = 0; i < skipsAllowed; i++) {
      cx += dir.x; cy += dir.y;
      if (x === cx && y === cy) return true;
    }
    return false;
  }

  /** :1430-1443 八方向量化（锁定方向优先） */
  getDesiredDirectionFrom(offset: { x: number; y: number }): Pt {
    if (this.lockedDirection) return this.lockedDirection;
    let num = Math.atan2(offset.y, offset.x);
    if (num < 0) num += Math.PI * 2;
    const step = Math.PI / 4;
    const ang = Math.floor(((num + step / 2) % (Math.PI * 2)) / step) * step;
    // || 0 归一化 -0（cos(π/2) 浮点残尾 trunc 后会是 -0）
    return { x: Math.trunc(Math.cos(ang) * 1.5) || 0, y: Math.trunc(Math.sin(ang) * 1.5) || 0 };
  }

  /** :1175-1332(1457) 矿车轨道：2340(MinecartTrack)/2739(BoosterTrack) 方向量化主段
   *  + 2492(PressureTrack) 压力轨道独立段（:1277-1331，无方向量化左右各续一格） */
  private stepMinecartTracks(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const st = env.st;
    const p = env.actor;
    // 主段门（:1177(1457)）= 物品 id 2340/2739；我方轨道放置物（place_v_314_*）无 vid
    // → 以 createTile sheet==314 认定。★2492(PressureTrack) 同为 sheet 314 但原版
    // 【不走主段】——须按 vid 先行排除（X1-④ 拆分，原"并入主段"登记债清偿）。
    const isMainTrack = (sem.createTileSheet === 314 && sem.vid !== 2492)
      || sem.vid === 2340 || sem.vid === 2739;
    if (isMainTrack && !taken()) {
      // :1170-1196 主方向判定（±0.5 阈值；斜向组合时水平让位）
      const dx = env.mouse.x - p.cx, dy = env.mouse.y - p.cy;
      const len = Math.hypot(dx, dy) || 1;
      const upDot = -dy / len;
      const up = upDot >= 0.5, down = upDot <= -0.5;
      const rightDot = dx / len;
      let right = rightDot >= 0.5, left = rightDot <= -0.5;
      const upLeft = up && left, upRight = up && right, downLeft = down && left, downRight = down && right;
      if (upLeft || downLeft) left = false;
      if (upRight || downRight) right = false;
      // :1197-1211 鼠标格已在轨道上 → 不动（:1208 active() && type==314——幽灵残型
      //  轨道/已致动轨道都算在场）
      const hoverTrack = hasTileAt(st, screenX, screenY) && sheetOf(st.get(screenX, screenY)) === 314;
      if (!hoverTrack) {
        const targets: Pt[] = [];
        for (let i = reach.x0; i <= reach.x1; i++) {
          for (let j = reach.y0; j <= reach.y1; j++) {
            if (!st.inBounds(i, j) || !hasTileAt(st, i, j) || sheetOf(st.get(i, j)) !== 314) continue; // :1219 active()
            const diag = (ox: number, oy: number): boolean => st.inBounds(i + ox, j + oy)
              && hasTileAt(st, i + ox, j + oy) // :1221-1224 active()
              && sheetOf(st.get(i + ox, j + oy)) === 314;
            const open = (x: number, y: number): boolean => {
              if (!st.inBounds(x, y)) return false;
              const t = st.get(x, y);
              // :1225 等 `!tile.active() || tileCut || BreakableWhenPlacing`
              return !hasTileAt(st, x, y) || tileCutType(env, t) || breakableWhenPlacing(sheetOf(t));
            };
            // :1215-1238 六方向延伸（斜向带让位规则）
            if (upLeft && open(i - 1, j - 1) && !(!diag(1, 1) && diag(1, -1)) && !diag(-1, 1)) targets.push({ x: i - 1, y: j - 1 });
            if (left && open(i - 1, j)) targets.push({ x: i - 1, y: j });
            if (downLeft && open(i - 1, j + 1) && !(!diag(1, -1) && diag(1, 1)) && !diag(-1, -1)) targets.push({ x: i - 1, y: j + 1 });
            if (upRight && open(i + 1, j - 1) && !(!diag(-1, 1) && diag(-1, -1)) && !diag(1, 1)) targets.push({ x: i + 1, y: j - 1 });
            if (right && open(i + 1, j)) targets.push({ x: i + 1, y: j });
            if (downRight && open(i + 1, j + 1) && !(!diag(-1, -1) && diag(-1, 1)) && !diag(1, -1)) targets.push({ x: i + 1, y: j + 1 });
          }
        }
        // :1243-1258 目标上下不可再连轨道（端点，:1259 active() 口径）才入选，取离鼠标最近
        const ends = targets.filter((t) => {
          const above = st.inBounds(t.x, t.y - 1) && hasTileAt(st, t.x, t.y - 1) && sheetOf(st.get(t.x, t.y - 1)) === 314;
          const below = st.inBounds(t.x, t.y + 1) && hasTileAt(st, t.x, t.y + 1) && sheetOf(st.get(t.x, t.y + 1)) === 314;
          return !above && !below;
        });
        const point = nearestOf(ends, env.mouse);
        if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
          set(point.x, point.y);
          return;
        }
      }
    }
    // :1277-1331(1457) 压力轨道（2492）独立段——门 `item.type != 2492 || focused != -1
    //  → return`（仅主段未钉中时参与）。无方向量化：鼠标格已在轨道上（:1282 active()
    //  口径）→ 不产候选；否则扫可达区已有轨道（:1289 active() 口径），左右邻格
    //  空/可割/可顶替（:1294/:1299）入候选，上下均非轨道（:1310，水平端点）者取
    //  离鼠标最近（num5 != -1 由 nearestOf 空集返回 null 等价承担）。
    if (sem.vid === 2492 && !taken()) {
      const hoverTrack = hasTileAt(st, screenX, screenY) && sheetOf(st.get(screenX, screenY)) === 314;
      if (!hoverTrack) {
        const targets: Pt[] = [];
        for (let i = reach.x0; i <= reach.x1; i++) {
          for (let j = reach.y0; j <= reach.y1; j++) {
            if (!st.inBounds(i, j) || !hasTileAt(st, i, j) || sheetOf(st.get(i, j)) !== 314) continue;
            for (const ox of [-1, 1]) {
              const nx = i + ox;
              if (!st.inBounds(nx, j)) continue;
              const nt = st.get(nx, j);
              // :1294/:1299 `!tile.active() || Main.tileCut[tile.type] || TileID.Sets.BreakableWhenPlacing[tile.type]`
              if (!hasTileAt(st, nx, j) || tileCutType(env, nt) || breakableWhenPlacing(sheetOf(nt))) {
                targets.push({ x: nx, y: j });
              }
            }
          }
        }
        // :1308-1321 候选上下均非轨道（:1310 active() 口径）才入选，取离鼠标最近
        const ends = targets.filter((t) => {
          const above = st.inBounds(t.x, t.y - 1) && hasTileAt(st, t.x, t.y - 1) && sheetOf(st.get(t.x, t.y - 1)) === 314;
          const below = st.inBounds(t.x, t.y + 1) && hasTileAt(st, t.x, t.y + 1) && sheetOf(st.get(t.x, t.y + 1)) === 314;
          return !above && !below;
        });
        const point = nearestOf(ends, env.mouse);
        if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
          set(point.x, point.y);
        }
      }
    }
  }

  /** :1099-1163 铺墙：可铺墙格四向有依附，取最近 */
  private stepWalls(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if ((sem.createWall ?? 0) <= 0 || taken()) return; // :1103
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const ii = st.idx(i, j);
        const t = st.type[ii];
        // :1113 本格无墙且（空 / 非实心 / 平台）且与玩家视线可通
        //  （Collision.CanHitWithCheck + NotDoorStand，Collision.cs:492-589 / DelegateMethods.cs:858-869）
        if (st.wall[ii] === 0 && (!hasTileAt(st, i, j) || !tileSolidType(t) || tileSolidTopType(t)) // :1123 active()
          && canHitWithCheck(st, env.actor, env.actor.w, env.actor.h,
            { x: i * 16, y: j * 16 }, 16, 16, (x, y) => notDoorStand(st, x, y))) {
          let flag = false;
          // :1115-1131 四向有 active tile（active() 口径，含已致动）或已有墙 → 可依附
          for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const nx = i + ox, ny = j + oy;
            if (!st.inBounds(nx, ny)) continue;
            const ni = st.idx(nx, ny);
            if (hasTileAt(st, nx, ny) || st.wall[ni] > 0) { flag = true; break; }
          }
          // :1137-1140 开门锚帧格（WorldGen.IsOpenDoorAnchorFrame）不可铺墙
          if (isOpenDoorAnchorFrame(st, i, j)) flag = false;
          if (flag) targets.push({ x: i, y: j });
        }
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :1036-1108(1457) 南瓜种子（createTile 254） */
  private stepPumpkinSeeds(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.createTileSheet !== 254 || taken()) return;
    const ws = env.worldSurface ?? Infinity;
    pumpkinOrBoulderScan(env, reach, set, (st, i, j) => {
      // :1049(1457) `if ((double)j > Main.worldSurface - 2.0) break;`——j 单调递增、
      //  截断线与 i 无关，循环内 break ≡ 该行起整列拒绝（与逐行 false 等价）
      if (j > ws - 2) return false;
      // :1043-1070 草面 2 格宽、无坡无半砖、上方 2×2 无阻挡
      const a = st.inBounds(i, j + 1) ? st.get(i, j + 1) : 0;
      const b = st.inBounds(i + 1, j + 1) ? st.get(i + 1, j + 1) : 0;
      if (!hasTileAt(st, i, j + 1) || !hasTileAt(st, i + 1, j + 1)) return false; // :1054 active()
      // :1058(1457) `tile2.slope() > 0 || tile.slope() > 0 || tile2.halfBrick() || tile.halfBrick()`
      //  ——两块地面格（(i,j+1)/(i+1,j+1)）任一有坡或半砖即拒
      if (st.slope[st.idx(i, j + 1)] > 0 || st.slope[st.idx(i + 1, j + 1)] > 0
        || st.half[st.idx(i, j + 1)] > 0 || st.half[st.idx(i + 1, j + 1)] > 0) return false;
      const grassOk = (t: number): boolean => [2, 477, 109, 492].includes(sheetOf(t));
      if (!grassOk(a) || !grassOk(b)) return false;
      for (let k = i; k <= i + 1; k++) {
        for (let l = j - 1; l <= j; l++) {
          if (!st.inBounds(k, l)) return false;
          const t = st.get(k, l);
          // :1075 active() 口径 + `!WorldGen.CanCutTile(k, l, TileCuttingContext.TilePlacement)`
          //  （WorldGen.cs:88111-24 单源,下格存在 && wall!=350 && 下格 type∉{78,380,579}
          //  && (type!=254||frameX>=144)）。★F6（2026-09-04 蓝队 M24 补遗）：曾以
          //  tileCutType（Main.tileCut decor 表）近似——差记台账撤销：78/380/579 下邻、
          //  回声墙 350、未熟南瓜三域实差全数收编。
          if (hasTileAt(st, k, l) && (tileSolidType(t) || !canCutTile(st, k, l, 'TilePlacement'))) return false;
        }
      }
      return true;
    });
  }

  /** :256-322 草地种子（ItemID.Sets.GrassSeeds） */
  private stepGrassSeeds(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid;
    if (vid == null || !GRASS_SEED_ITEMS.has(vid) || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        // :273-274 八向至少一格暴露；:323 须 active 且未被致动（nactive）
        if (!activeAt(st, i, j) || inActiveAt(st, i, j) || !exposed8(st, i, j)) continue;
        const sheet = sheetOf(st.get(i, j));
        // :278-294 各种子适配的基底
        let ok = false;
        switch (vid) {
          default: ok = sheet === 0; break;                      // 普通草种：泥土
          case 59: case 2171: ok = sheet === 0 || sheet === 59; break; // 丛林草种
          case 194: case 195: ok = sheet === 59; break;
          case 5214: ok = sheet === 57; break;
        }
        if (ok) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :324-369 苔藓（ItemID.Sets.Moss）：暴露的石/泥灰岩面 */
  private stepMoss(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid;
    if (vid == null || !MOSS_ITEMS.has(vid) || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const sheet = sheetOf(st.get(i, j));
        if (!activeAt(st, i, j) || inActiveAt(st, i, j)) continue;
        if (!exposed8(st, i, j)) continue; // :341-342
        // :343 原版谓词 `tile.type == 1 || tile.type == 38`（石 / 苔石）照搬
        if (sheet === 1 || sheet === 38) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :978-1035(1457) 皮纳塔（createTile 454） */
  private stepPigronata(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.createTileSheet !== 454 || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    const ws = env.worldSurface ?? Infinity;
    for (let i = reach.x0; i <= reach.x1; i++) {
      // :987(1457) `j <= reachableEndY && !((double)j > Main.worldSurface - 2.0)`——
      //  地表下（j > worldSurface-2）整列截断
      for (let j = reach.y0; j <= reach.y1 && !(j > ws - 2); j++) {
        if (!st.inBounds(i, j)) continue;
        // :979-1002 顶部一行实心 + 下方 4×3 空
        let flag = true;
        for (let k = i - 2; k <= i + 1; k++) {
          for (let l = j - 1; l <= j + 2; l++) {
            if (!st.inBounds(k, l)) { flag = false; continue; }
            const t = st.get(k, l);
            if (l === j - 1) {
              if (!solidTile(st, k, l)) flag = false;
            } else if (hasTileAt(st, k, l) && (!tileCutType(env, t) || sheetOf(t) === 454)) { // :1002 active()
              flag = false;
            }
          }
        }
        if (flag) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :895-977(1457) 巨石（TileID.Sets.Boulders） */
  private stepBoulders(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const cs = sem.createTileSheet;
    if (cs == null || !BOULDERS.has(cs) || taken()) return;
    pumpkinOrBoulderScan(env, reach, set, (st, i, j) => {
      // :898-925 下方两格 nactive 无坡无半砖、可承重（tileSolid ∪ tileTable 全表
      //  Main.cs:7018-7100 77 条——曾以"TILE_DEFS 已注册"近似=任何件都承重）、
      //  非 tileNoAttach（:921）；上方 2×2 无阻挡。
      for (const ox of [0, 1]) {
        const bx = i + ox, by = j + 1;
        if (!st.inBounds(bx, by) || !activeAt(st, bx, by)) return false;
        const t = st.get(bx, by);
        const sh = sheetOf(t);
        if (st.slope[st.idx(bx, by)] > 0 || st.half[st.idx(bx, by)] > 0) return false;
        if ((!tileSolidType(t) && !TILE_TABLE_SHEETS.has(sh)) || tileNoAttachType(sh)) return false; // :917/:921
      }
      for (let k = i; k <= i + 1; k++) {
        for (let l = j - 1; l <= j; l++) {
          if (!st.inBounds(k, l)) return false;
          const t = st.get(k, l);
          if (hasTileAt(st, k, l) && !tileCutType(env, t)) return false; // :930 active()
        }
      }
      // :936-949(1457) 玩家命中盒净空：32×32 @ (i*16, j*16-16)（= 上方 2×2 格区）
      //  与任一 active && !dead 玩家 Hitbox 相交即拒（首个命中 break ≡ 短路返回）。
      //  原版此处只遍历 Main.player[0..254]，不查敌怪/城镇 NPC——走 players
      //  （缺省 [actor]）而非 occupants（那是 Collision.EmptyTile 的双循环口径）。
      const rx = i * 16, ry = j * 16 - 16;
      for (const pl of (env.players ?? [env.actor])) {
        // XNA Rectangle.Intersects：other.X < Right && X < other.Right && other.Y < Bottom && Y < other.Bottom
        if (pl.x < rx + 32 && rx < pl.x + pl.w && pl.y < ry + 32 && ry < pl.y + pl.h) return false;
      }
      return true;
    });
  }

  /** :2795-2865 火把：合法锚位 + 17×17 去重 + 非水火把避液体，取离鼠标最近 */
  private stepTorch(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid;
    const isTorch = (vid != null && TORCH_ITEMS.has(vid)) || sem.createTileSheet === 4; // 本地 'torch' 支已随退役移除(vi_8 走 vid)
    if (!isTorch || taken()) return; // :2804
    const st = env.st;
    const notWaterTorch = vid == null || !WATER_TORCH_ITEMS.has(vid); // :2809
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const ii = st.idx(i, j);
        const t = st.type[ii];
        // :2815 非水火把避液体；占位格须可替换：非 active、BreakableWhenPlacing、
        //  或可割植物（82/83 药草除外）——TileID.cs:379 表
        if (notWaterTorch && st.liquid[ii] > 0) continue;
        // :2825 占位格被 active 格（active() 口径，含已致动）占据且不可顶替 → 跳过
        if (hasTileAt(st, i, j) && !breakableWhenPlacing(sheetOf(t))
          && (!tileCutType(env, t) || sheetOf(t) === 82 || sheetOf(t) === 83)) continue;
        // :2819-2838 17×17 内已有火把 → 排除
        let near = false;
        outer: for (let k = i - 8; k <= i + 8; k++) {
          for (let l = j - 8; l <= j + 8; l++) {
            if (st.inBounds(k, l) && TORCH_TILES.has(sheetOf(st.get(k, l)))) { near = true; break outer; }
          }
        }
        if (!near && isValidSpotForTorch(st, i, j)) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :2895-2938 割草机（4049）：草/神圣草格取最近 */
  private stepLawnMower(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.vid !== 4049 || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const sheet = sheetOf(st.get(i, j));
        if (hasTileAt(st, i, j) && (sheet === 2 || sheet === 109)) targets.push({ x: i, y: j }); // :2923 active()
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :2692-2793 方块填充（补洞）。注意原版门是"死代码"：第一道 :2694-2697
   *  `if (!SmartBlocksEnabled) return;` 之后，第二道 :2714 的条件首项竟是
   *  `SmartBlocksEnabled ||`（1.4.0.5/1.4.5.6 两个反编译口径一致）——即开关打开时
   *  本策略恒不产生目标，只有 BlocksLines 生效。此处按 1:1 保留该门。 */
  private stepBlocksFilling(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (!env.settings.smartBlocksEnabled) return; // :2694-2697
    if (taken()) return;
    const cs = sem.createTileSheet;
    // :2714 原版死门（见上）：SmartBlocksEnabled 为真即返回
    if (env.settings.smartBlocksEnabled
      || cs == null || !allowNormalBlockPlacement(sem) || !isSolidBlockSheet(cs)) return;
    const st = env.st;
    // :2716-2722 鼠标格已占用/不可达 → 停用（:2725 active() 口径）
    if (hasTileAt(st, screenX, screenY)) return;
    if (!inTileBounds(screenX, screenY, reach.x0, reach.y0, reach.x1, reach.y1)) return;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const t = st.get(i, j);
        if (!hasTileAt(st, i, j) || tileCutType(env, t) || breakableWhenPlacing(sheetOf(t))) { // :2740 active()
          // :2732-2749 四邻实心（非平台）计数 ≥2（:2743-55 active() 口径）
          let n = 0;
          for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const nx = i + ox, ny = j + oy;
            if (!st.inBounds(nx, ny)) continue;
            const nt = st.get(nx, ny);
            if (hasTileAt(st, nx, ny) && tileSolidType(nt) && !tileSolidTopType(nt)) n++;
          }
          if (n >= 2) targets.push({ x: i, y: j });
        }
      }
    }
    if (targets.length === 0) return;
    // :2759-2784 排序：先 |dx| 最小，并列取距离小（Collision.EmptyTile(ignoreTiles:true) 门）
    let num2 = -1;
    let num3 = Infinity;
    let point = targets[0];
    for (const t of targets) {
      if (!emptyTile(env, t.x, t.y, true)) continue;
      const vx = (t.x * 16 + 8) - env.mouse.x;
      const vy = (t.y * 16 + 8) - env.mouse.y;
      const adx = Math.abs(vx);
      const len = Math.hypot(vx, vy);
      let better = false;
      if (adx < num3) better = true;
      if (adx === num3 && (num2 === -1 || len < num2)) better = true;
      if (better) { num2 = len; num3 = adx; point = t; }
    }
    if (num2 !== -1 && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y); // :2786-2790
    }
  }

  /** :809-883 方块铺线：四邻实心 ≥1，纯取最近 */
  private stepBlocksLines(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (!env.settings.smartBlocksEnabled) return; // :812
    if (taken()) return;
    const cs = sem.createTileSheet;
    if (cs == null || !allowNormalBlockPlacement(sem) || !isSolidBlockSheet(cs)) return;
    const st = env.st;
    // :817-825 鼠标格已占用/不可达 → 停用（:828 active() 口径）
    if (hasTileAt(st, screenX, screenY)) return;
    if (!inTileBounds(screenX, screenY, reach.x0, reach.y0, reach.x1, reach.y1)) return;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const t = st.get(i, j);
        if (!hasTileAt(st, i, j) || tileCutType(env, t) || breakableWhenPlacing(sheetOf(t))) { // :843 active()
          // :835-851 四邻任一实心（非平台，:846-58 active() 口径）
          let ok = false;
          for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
            const nx = i + ox, ny = j + oy;
            if (!st.inBounds(nx, ny)) continue;
            const nt = st.get(nx, ny);
            if (hasTileAt(st, nx, ny) && tileSolidType(nt) && !tileSolidTopType(nt)) { ok = true; break; }
          }
          if (ok) targets.push({ x: i, y: j });
        }
      }
    }
    // :860-876 EmptyTile 过滤后取最近
    const open = targets.filter((t) => emptyTile(env, t.x, t.y));
    const point = nearestOf(open, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  // ---- 油漆三策略（SmartCursorHelper.cs:668-807）1:1。涂层位（TileStore.coat）已建，
  //      刮刀四涂层位项（:683-686/:690-692）与刷/滚涂层目标项（:738/:781）全量接入 ----

  /** :668-720 Step_PaintScrapper——扫描可及区，"有方块漆/墙漆/涂层位/长苔藓 184"的格
   *  为目标，取离鼠标最近（:700-712 num2 距离 = 格中心*16+8 到 mouse） */
  private stepPaintScrapper(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid ?? -1;
    if (!PAINT_SCRAPER_ITEMS.has(vid) || taken()) return; // :670 IsPaintScraper + focused!=-1
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const k = st.idx(i, j);
        const active = hasTileAt(st, i, j); // :691 tile.active()
        const coat = st.coat[k];
        let flag = false;
        if (active) { // :681-687
          flag ||= st.paint[k] > 0;                 // tile.color() > 0
          flag ||= sheetOf(st.type[k]) === 184;     // tile.type == 184（长苔藓）
          flag ||= (coat & TS.COAT_FULLBRIGHT_BLOCK) !== 0;  // :686 fullbrightBlock()
          flag ||= (coat & TS.COAT_INVISIBLE_BLOCK) !== 0;   // :687 invisibleBlock()
        }
        if (st.wall[k] > 0) {                       // :688-693
          flag ||= st.paintWall[k] > 0;             // wallColor() > 0
          flag ||= (coat & TS.COAT_FULLBRIGHT_WALL) !== 0;   // :691 fullbrightWall()
          flag ||= (coat & TS.COAT_INVISIBLE_WALL) !== 0;    // :692 invisibleWall()
        }
        if (flag) targets.push({ x: i, y: j });     // :694-697
      }
    }
    const point = nearestOf(targets, env.mouse);     // :700-712
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y);                         // :713-717
    }
  }

  /** :722-765 Step_PaintBrush——手持刷（1071/1543）且背包有油漆/涂层；目标 = active 且
   *  （有漆 ∧ 色不同 ∨ 荧光涂层 ∧ 未置荧光位 ∨ 回声涂层 ∧ 未置隐形位）（:738 位或式）；
   *  取最近 */
  private stepPaintBrush(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid ?? -1;
    // :724 paintLookup==0 && paintCoatingLookup==0 → return
    if (!PAINT_BRUSH_ITEMS.has(vid) || (sem.paintLookup === 0 && sem.coatingLookup === 0) || taken()) return;
    const st = env.st;
    const paintLookup = sem.paintLookup;
    const coatingLookup = sem.coatingLookup;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const k = st.idx(i, j);
        if (!hasTileAt(st, i, j)) continue;                    // :738 tile.active()
        const coat = st.coat[k];
        // :738 (paintLookup!=0 && color()!=paintLookup) | (coating==1 && !fullbrightBlock)
        //      | (coating==2 && !invisibleBlock)
        const flag = (paintLookup !== 0 && st.paint[k] !== paintLookup)
          || (coatingLookup === 1 && (coat & TS.COAT_FULLBRIGHT_BLOCK) === 0)
          || (coatingLookup === 2 && (coat & TS.COAT_INVISIBLE_BLOCK) === 0);
        if (flag) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);     // :745-757
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y);                         // :758-762
    }
  }

  /** :767-807 Step_PaintRoller——手持滚（1072/1544）且背包有油漆/涂层；目标 = 有墙且
   *  墙前无实心遮挡（:781 !active || !tileSolid || tileSolidTop）且（墙色不同 ∨ 涂层
   *  目标位未置）；取最近 */
  private stepPaintRoller(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid ?? -1;
    // :769 paintLookup==0 && paintCoatingLookup==0 → return
    if (!PAINT_ROLLER_ITEMS.has(vid) || (sem.paintLookup === 0 && sem.coatingLookup === 0) || taken()) return;
    const st = env.st;
    const paintLookup = sem.paintLookup;
    const coatingLookup = sem.coatingLookup;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const k = st.idx(i, j);
        const t = st.type[k];
        const active = hasTileAt(st, i, j); // :791 tile.active()
        const coat = st.coat[k];
        // :781 wall>0 && (!active || !tileSolid || tileSolidTop)
        //      && (paintLookup!=0 && wallColor()!=paintLookup | coating==1 && !fullbrightWall
        //          | coating==2 && !invisibleWall)
        if (st.wall[k] > 0
          && (!active || !tileSolidType(t) || tileSolidTopType(t))
          && ((paintLookup !== 0 && st.paintWall[k] !== paintLookup)
            || (coatingLookup === 1 && (coat & TS.COAT_FULLBRIGHT_WALL) === 0)
            || (coatingLookup === 2 && (coat & TS.COAT_INVISIBLE_WALL) === 0))) {
          targets.push({ x: i, y: j });
        }
      }
    }
    const point = nearestOf(targets, env.mouse);     // :787-799
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
      set(point.x, point.y);                         // :800-804
    }
  }

  /** :2032-2157 橡实（item 27）：草面 + 上方净空 + 相邻同类地面 */
  private stepAcorns(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.vid !== 27 || taken()) return; // :2037（reachableStartY<=20 的地表门由 reach 决定）
    const st = env.st;
    if (reach.y0 <= 20) return;
    const NUM1 = 9, NUM2 = 14, NUM3 = 20; // :2034-2036
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j) || !st.inBounds(i, j - 1) || !st.inBounds(i, j + 1)) continue;
        const t = st.get(i, j);
        const below = st.get(i, j + 1);
        // :2055 自身/上方须空（active() 口径；可割植物/可顶替件放行），下方须实心
        if ((hasTileAt(st, i, j) && !tileCutType(env, t) && !breakableWhenPlacing(sheetOf(t)))
          || (hasTileAt(st, i, j - 1) && !tileCutType(env, st.get(i, j - 1))
            && !breakableWhenPlacing(sheetOf(st.get(i, j - 1))))
          || !hasTileAt(st, i, j + 1) || !solidTile2(st, i, j + 1)) continue; // :2065 active()
        // :2059-2060 ±1/±3 内已有树苗（:2069-70 active() 口径）→ 间距门
        const saplingAt = (x: number, y: number): boolean =>
          st.inBounds(x, y) && hasTileAt(st, x, y) && COMMON_SAPLING.has(sheetOf(st.get(x, y)));
        const flag = saplingAt(i - 1, j) || saplingAt(i + 1, j);
        const flag2 = flag || saplingAt(i - 2, j) || saplingAt(i + 2, j) || saplingAt(i - 3, j) || saplingAt(i + 3, j);
        const groundSheet = sheetOf(below);
        let ok = false;
        switch (groundSheet) {
          case 60: // 丛林草：5×14 净空
            if (!flag2 && emptyTileCheck(st, i - 2, i + 2, j - NUM2 + 1, j, 20)) ok = true;
            break;
          case 2: case 23: case 109: case 147: case 199: case 477: case 492: case 633: case 661: case 662:
            if (!flag2 && st.liquid[st.idx(i - 1, j)] === 0 && st.liquid[st.idx(i, j)] === 0
              && st.liquid[st.idx(i + 1, j)] === 0 && emptyTileCheck(st, i - 2, i + 2, j - NUM1 + 1, j, 20)) ok = true;
            break;
          case 53: case 112: case 116: case 234: // 沙族：棕榈
            if (!flag && st.liquid[st.idx(i, j)] === 0 && emptyTileCheck(st, i, i, j - NUM3, j, 20)) ok = true;
            break;
        }
        if (ok) targets.push({ x: i, y: j });
      }
    }
    // :2096-2136 目标下方相邻列必须有同类地面（防孤点）
    const kept = targets.filter((p) => {
      let ok = false;
      for (const l of [-1, 1]) {
        const x = p.x + l, y = p.y + 1;
        if (!st.inBounds(x, y) || !hasTileAt(st, x, y)) continue; // :2113 active()
        if ([2, 23, 53, 60, 109, 112, 116, 147, 199, 234, 477, 492, 633, 661, 662].includes(sheetOf(st.get(x, y)))) ok = true;
      }
      return ok;
    });
    const point = nearestOf(kept, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :2159-2226 宝石橡实（GrowTreeSettings 档案）：石/苔面 + 5×12 净空 */
  private stepGemCorns(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const profile = sem.vid != null ? GEM_TREE_PROFILES[sem.vid] : undefined;
    if (!profile || taken()) return; // :2161
    const st = env.st;
    if (reach.y0 <= 20) return;
    const targets: Pt[] = [];
    const groundOk = (t: number): boolean => GEM_TREE_GROUND.has(sheetOf(t));
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const t = st.get(i, j);
        const below = st.get(i, j + 1);
        // :2189 GroundTest 读裸 type（残型也过，随后 tile3.active() 把幽灵地面挡下——
        //  同序保留）；active() 口径（含已致动格占位）
        if (!groundOk(below) || !hasTileAt(st, i, j + 1) || !solidTile2(st, i, j + 1)) continue;
        if (hasTileAt(st, i, j) && !tileCutType(env, t) && !breakableWhenPlacing(sheetOf(t))) continue; // :2189
        if (hasTileAt(st, i, j - 1) && !tileCutType(env, st.get(i, j - 1))
          && !breakableWhenPlacing(sheetOf(st.get(i, j - 1)))) continue;
        // :2179 ±3 内无树苗（:2189 active() 口径）、无液体、5×TreeHeightMax 净空
        let sapling = false;
        for (const dx of [-3, -2, -1, 1, 2, 3]) {
          const x = i + dx;
          if (st.inBounds(x, j) && hasTileAt(st, x, j) && COMMON_SAPLING.has(sheetOf(st.get(x, j)))) sapling = true;
        }
        if (sapling) continue;
        if (st.liquid[st.idx(i - 1, j)] !== 0 || st.liquid[st.idx(i, j)] !== 0 || st.liquid[st.idx(i + 1, j)] !== 0) continue;
        if (!emptyTileCheck(st, i - 2, i + 2, j - profile.treeHeightMax, j, profile.saplingTile)) continue;
        targets.push({ x: i, y: j });
      }
    }
    // :2185-2205 相邻列须有同类地面
    const kept = targets.filter((p) => {
      for (const l of [-1, 1]) {
        const x = p.x + l, y = p.y + 1;
        if (st.inBounds(x, y) && hasTileAt(st, x, y) && groundOk(st.get(x, y))) return true; // :2202 active()
      }
      return false;
    });
    const point = nearestOf(kept, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :612-666 空桶（205）：液体连通量 >100 的格（我方键 empty_bucket，vid 缺 → 键名兜底） */
  private stepEmptyBuckets(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const vid = sem.vid;
    const isBucket = vid === 205;
    if (!isBucket || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const ii = st.idx(i, j);
        if (st.liquid[ii] <= 0) continue;
        // :628-640 3×3 同类液体总量 >100
        let sum = 0;
        for (let k = i - 1; k <= i + 1; k++) {
          for (let l = j - 1; l <= j + 1; l++) {
            if (!st.inBounds(k, l)) continue;
            const ni = st.idx(k, l);
            if (st.liquidType[ni] === st.liquidType[ii]) sum += st.liquid[ni];
          }
        }
        if (sum > 100) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :572-610 致动器（849）：有导线未装致动器的格取最近 */
  private stepActuators(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    const isActuatorItem = sem.vid === 849;
    if (!isActuatorItem || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const w = st.wire[st.idx(i, j)];
        // :594 四色任一导线 + 未装致动器 + active（active() 口径，已致动格仍可加装）
        if ((w & TS.WIRE_COLORS) !== 0 && (w & TS.WIRE_ACTUATOR) === 0 && hasTileAt(st, i, j)) {
          targets.push({ x: i, y: j });
        }
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :482-570 炼金种子（createTile 82）：各药草适配的盆/土/沙面。
   *  我方药草种子物品放置 sheet 83（v_83_herbs_mature）——82/83 均为我方注册的药草格，
   *  门取两档并集以兼容数据现状（原版仅 82）。 */
  private stepAlchemySeeds(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.createTileSheet !== 82 && sem.createTileSheet !== 83 || taken()) return;
    const st = env.st;
    const style = sem.placeStyle;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const t = st.get(i, j);
        const below = st.get(i, j + 1);
        // :496 可替换 = 非 active / BreakableWhenPlacing（TileID.cs:379）/
        //  可割植物（82/83 药草除外）/ 成熟药草可收（WorldGen.cs:66173）
        const replaceable = !hasTileAt(st, i, j) // :506 active()（含已致动格占位）
          || breakableWhenPlacing(sheetOf(t))
          || (tileCutType(env, t) && sheetOf(t) !== 82 && sheetOf(t) !== 83)
          || isHarvestableHerbWithSeed(st, i, j, env);
        if (!replaceable) continue;
        // :497 下方 nactive（active 且 !inActive）+ 平顶无坡
        if (!activeAt(st, i, j + 1) || inActiveAt(st, i, j + 1)
          || st.half[st.idx(i, j + 1)] !== 0 || st.slope[st.idx(i, j + 1)] !== 0) continue;
        const belowSheet = sheetOf(below);
        const ii = st.idx(i, j);
        const liq = st.liquid[ii];
        const lava = liq > 0 && st.liquidType[ii] === 2; // Tile.lava()
        // :502-546 各样式（草药）适配基质与液体门（原版逐 case 条件照搬）
        const ok = (() => {
          switch (style) {
            case 0: return [78, 380, 2, 477, 109, 492].includes(belowSheet) && liq === 0;
            case 1: return [78, 380, 60].includes(belowSheet) && liq === 0;
            case 2: return [78, 380, 0, 59].includes(belowSheet) && liq === 0;
            case 3: return [78, 380, 203, 199, 23, 25].includes(belowSheet) && liq === 0;
            case 4: return [78, 380, 53, 116].includes(belowSheet) && !(liq > 0 && lava);
            case 5: return [78, 380, 57, 633].includes(belowSheet) && !(liq > 0 && !lava);
            case 6: return [78, 380, 147, 161, 163, 164, 200].includes(belowSheet) && !(liq > 0 && lava);
            default: return false;
          }
        })();
        if (ok) targets.push({ x: i, y: j });
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :427-480 种植盆（createTile 380）：已有盆的左右空位 */
  private stepPlanterBox(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.createTileSheet !== 380 || taken()) return;
    const st = env.st;
    // :431-435 鼠标正悬在已有种植盆上 → 让位（原版不是"鼠标格占用即停"，只认盆本身；
    //  :445 active() 口径）
    // ★issue#44-1 改判史：旧版形参表漏 screenX/screenY，本行两标识符落到 lib.dom 的
    //  全局 `window.screenX/screenY`（浏览器窗口屏幕坐标，恒 (0,0)）→ 让位门恒假，
    //  TS 不报错。补形参（lookup 调用点与 stepClayPots 同口径）。
    if (st.inBounds(screenX, screenY) && hasTileAt(st, screenX, screenY)
      && sheetOf(st.get(screenX, screenY)) === 380) return;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        // :456 盆源格 active() && type==380——幽灵残型盆不作锚
        if (!st.inBounds(i, j) || !hasTileAt(st, i, j) || sheetOf(st.get(i, j)) !== 380) continue;
        // :448-455 盆左右为空/可割/BreakableWhenPlacing → 续放（:458/:462 active() 口径）
        for (const ox of [-1, 1]) {
          const nx = i + ox;
          if (!st.inBounds(nx, j)) continue;
          const nt = st.get(nx, j);
          if (!hasTileAt(st, nx, j) || tileCutType(env, nt) || breakableWhenPlacing(sheetOf(nt))) {
            targets.push({ x: nx, y: j });
          }
        }
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :371-425 陶盆（createTile 78）：空位 + 下方平实心顶 */
  private stepClayPots(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region, screenX: number, screenY: number,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.createTileSheet !== 78 || taken()) return;
    const st = env.st;
    // :378-386 鼠标格占用/不可达 → 停用（:389 active() 口径）
    if (hasTileAt(st, screenX, screenY)) return;
    if (!inTileBounds(screenX, screenY, reach.x0, reach.y0, reach.x1, reach.y1)) return;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        const t = st.get(i, j);
        const below = st.get(i, j + 1);
        // :395 自身空（active() 口径）/可割/BreakableWhenPlacing，下方 nactive 无坡无半砖且实心
        if ((!hasTileAt(st, i, j) || tileCutType(env, t) || breakableWhenPlacing(sheetOf(t)))
          && activeAt(st, i, j + 1) // :405 下方 nactive()（KEEP 口径：active && !inActive）
          && !inActiveAt(st, i, j + 1)
          && st.half[st.idx(i, j + 1)] === 0 && st.slope[st.idx(i, j + 1)] === 0
          && tileSolidType(below)) {
          targets.push({ x: i, y: j });
        }
      }
    }
    // :409-417 EmptyTile(ignoreTiles:true)（只查占位实体）后取最近
    const open = targets.filter((p) => emptyTile(env, p.x, p.y, true));
    const point = nearestOf(open, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }

  /** :214-254 再生法杖（213/5295）：暴露泥土格取最近 */
  private stepStaffOfRegrowth(
    env: SmartCursorEnv, sem: HeldSemantics, reach: Region,
    set: (x: number, y: number) => void, taken: () => boolean,
  ): void {
    if (sem.vid !== 213 && sem.vid !== 5295 || taken()) return;
    const st = env.st;
    const targets: Pt[] = [];
    for (let i = reach.x0; i <= reach.x1; i++) {
      for (let j = reach.y0; j <= reach.y1; j++) {
        if (!st.inBounds(i, j)) continue;
        // :228 泥土(0) 且暴露（四邻或四角有空）
        if (activeAt(st, i, j) && !inActiveAt(st, i, j) && sheetOf(st.get(i, j)) === 0 && exposed8(st, i, j)) {
          targets.push({ x: i, y: j });
        }
      }
    }
    const point = nearestOf(targets, env.mouse);
    if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) set(point.x, point.y);
  }
}

// ===================== 模块级工具 =====================

/** ★BJ433 导出（帮工链扫区用）：x0..x1 闭区间 */
export interface Region { x0: number; y0: number; x1: number; y1: number }

/** TileReachCheckSettings.GetTileRegion（TileReachCheckSettings.cs:53-62）+ clamp 世界
 *  [10,max-10]（SmartCursorHelper.cs:100-103）。
 *  ★issue#44-4：baseX/baseY = GetRanges 输出（Player.tileRangeX/Y 经射程配饰 +3/+2、
 *  工具箱 +1、旅程远置 ×2+8，已钳 ≤20——Game.tileReach(0) 同式）。TB 在钳【后】加
 *  （GetTileRegion :55-57 `x += TB`）——本函数保留该次序；旧实现硬编码 5/3，
 *  配饰/工具箱/旅程下智能光标可达区窄 3/2 格（旅程最多 13/15 格）。 */
function tileRegion(p: SmartCursorActor, tb: number, st: TileStore, baseX = 5, baseY = 3): Region {
  const x = Math.min(20, baseX) + tb;
  const y = Math.min(20, baseY) + tb;
  const LX = Math.floor(p.x / 16) - x;
  const HX = Math.ceil((p.x + p.w) / 16) - 1 + x;
  const LY = Math.floor(p.y / 16) - y;
  const HY = Math.ceil((p.y + p.h) / 16) - 1 + y;
  return {
    x0: Math.max(10, Math.min(LX, st.w - 10)),
    x1: Math.max(10, Math.min(HX, st.w - 10)),
    y0: Math.max(10, Math.min(LY, st.h - 10)),
    y1: Math.max(10, Math.min(HY, st.h - 10)),
  };
}

/** :183-199 让位集（DisableSmartCursor / 轨道 314 且 gravDir=1）——:197 active() 口径。
 *  ★SW-FX27：gravDir 实参（:196 `tile.type == 314 && gravDir == 1f`——倒挂时轨道
 *  不再让位智能光标；缺省 1 = 旧钉值逐位不变） */
function isHoveringOverAnInteractableTile(st: TileStore, x: number, y: number, gravDir = 1): boolean {
  if (!hasTileAt(st, x, y)) return false;
  const sheet = sheetOf(st.get(x, y));
  if (DISABLE_SMART_CURSOR_SHEETS.has(sheet)) return true;
  if (sheet === 314 && gravDir === 1) return true;
  return false;
}

/** Main.tileHammer 全表（Main.cs:7343-7346 共 4 条赋值）：
 *  26 祭坛 / 31 音符块 / 695 / 696——★BJ158②（2026-09-18）：本地副本 HAMMER_TILES
 *  拆除,收编 data/tiles.ts 单源 TILE_HAMMER_SHEETS（与 SmartSelect 副本同源漂移风险已消除） */
function isHammerTile(sheet: number): boolean {
  return TILE_HAMMER_SHEETS.has(sheet);
}

/** Step_Platforms 辅助：格上是平台族 sheet（IsPlatform :1455-1462，active() 口径——
 *  已致动平台在原版仍算平台锚） */
function isPlatformSheet(st: TileStore, x: number, y: number): boolean {
  if (!hasTileAt(st, x, y)) return false;
  return PLATFORMS.has(sheetOf(st.get(x, y)));
}

/** :201-212 AllowNormalBlockPlacementBehaviourForItemType（草种/苔藓物品不参与方块策略） */
function allowNormalBlockPlacement(sem: HeldSemantics): boolean {
  const vid = sem.vid;
  if (vid == null) return true;
  return !(vid === 213 || vid === 5295 || GRASS_SEED_ITEMS.has(vid) || MOSS_ITEMS.has(vid));
}

/** 放置物为实心非平台非框架方块（BlocksFilling/Lines 门 :812/:2709） */
function isSolidBlockSheet(sheet: number): boolean {
  const tileId = sheetToTileId(sheet);
  if (tileId == null) return false;
  const d = TILE_DEFS[tileId];
  return !!d && d.solid && !d.platform && !d.framed;
}

function sheetToTileId(sheet: number): number | null {
  if (sheet < 0) return null;
  const hit = TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === sheet);
  return hit >= 0 ? hit : null;
}

/** WorldGen.IsHarvestableHerbWithSeed（WorldGen.cs:66638-66660）：
 *  type 82 → false；type 84 → true；type 83 → IsAlchemyPlantHarvestable(style=frameX/18, y)。
 *  ★原版是纯 type/frame 函数（无 active 位门）：:506 调用点直接传残型 type/frameX——
 *  幽灵药草也按残型帧判收获期（曾误加 active 门导致漏判）。
 *  env.alchemy 缺省（未接世界态）时 83/84 均按不可收——等价语义 = 只认"非药草"分支，
 *  Game 侧已传入 clock/weather/groundLevel 实况，正常对局不触发该缺省。 */
function isHarvestableHerbWithSeed(st: TileStore, x: number, y: number, env: SmartCursorEnv): boolean {
  if (!st.inBounds(x, y)) return false;
  const sheet = sheetOf(st.get(x, y));
  if (sheet === 82) return false;
  if (sheet !== 83 && sheet !== 84) return false;
  if (sheet === 84) return true;
  const a = env.alchemy;
  if (!a) return false;
  return isAlchemyPlantHarvestable(Math.trunc(st.frameX[st.idx(x, y)] / 18), y, a);
}

/** WorldGen.IsAlchemyPlantHarvestable（WorldGen.cs:66198-66225）：各药草的收获时段门 */
function isAlchemyPlantHarvestable(
  style: number, y: number,
  a: NonNullable<SmartCursorEnv['alchemy']>,
): boolean {
  if (style === 0 && a.dayTime) return true;
  if (style === 1 && !a.dayTime) return true;
  if (style === 3 && !a.dayTime && (a.bloodMoon || a.moonPhase === 0)) return true;
  if (style === 4 && (a.raining || a.cloudAlpha > 0)) return true;
  if (style === 5) {
    let flag = y > a.worldSurface;
    if (a.remixWorld) flag = y < a.maxTilesY - 350;
    if ((!a.raining || flag) && a.time > 40500) return true;
  }
  return false;
}

/** 八向至少一格暴露（GrassSeeds/Moss/StaffOfRegrowth 共用 :273-274/:283-284/:351-352，
 *  `!tile.active()` 口径——已致动邻格在原版仍算"占位"不暴露） */
function exposed8(st: TileStore, x: number, y: number): boolean {
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nx = x + ox, ny = y + oy;
    if (st.inBounds(nx, ny) && !hasTileAt(st, nx, ny)) return true;
  }
  for (const [ox, oy] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
    const nx = x + ox, ny = y + oy;
    if (st.inBounds(nx, ny) && !hasTileAt(st, nx, ny)) return true;
  }
  return false;
}

/** :2877-2903 IsValidSpotForTorch（墙 → 左 → 右 → 下）。
 *  ★原版树干判定 IsTreeType 是裸 type 读（左锚 :2888 对 (x-1,y-1)/(x-1,y+1) 无 active
 *  门，残型树干也算）——本副本仅保留越界守门，不设 active 门。锚格门为 active() 口径。 */
function isValidSpotForTorch(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const ii = st.idx(x, y);
  if (st.wall[ii] > 0) return true; // :2879 有墙即放
  if (TORCH_TILES.has(sheetOf(st.type[ii]))) return false; // :2883 自身是火把（裸 type，同原版）
  const isTreeType = (tx: number, ty: number): boolean => {
    if (!st.inBounds(tx, ty)) return false;
    return IS_A_TREE_TRUNK.has(sheetOf(st.get(tx, ty)));
  };
  // :2887-2888 左：active() 口径；slope 允许（0 或奇数坡）且 实心/梁/连续三格树干
  if (st.inBounds(x - 1, y) && hasTileAt(st, x - 1, y)) {
    const li = st.idx(x - 1, y);
    const lt = st.get(x - 1, y);
    const ls = sheetOf(lt);
    if ((st.slope[li] === 0 || st.slope[li] % 2 !== 1)
      && ((tileSolidType(lt) && !tileNoAttachType(ls) && !tileSolidTopType(lt) && !NOT_REALLY_SOLID.has(ls))
        || IS_BEAM.has(ls)
        || (isTreeType(x - 1, y) && isTreeType(x - 1, y - 1) && isTreeType(x - 1, y + 1)))) {
      return true;
    }
  }
  // :2892-2893 右：active() 口径；slope 允许（0 或偶数坡）
  if (st.inBounds(x + 1, y) && hasTileAt(st, x + 1, y)) {
    const ri = st.idx(x + 1, y);
    const rt = st.get(x + 1, y);
    const rs = sheetOf(rt);
    if ((st.slope[ri] === 0 || st.slope[ri] % 2 !== 0)
      && ((tileSolidType(rt) && !tileNoAttachType(rs) && !tileSolidTopType(rt) && !NOT_REALLY_SOLID.has(rs))
        || IS_BEAM.has(rs)
        || (isTreeType(x + 1, y) && isTreeType(x + 1, y - 1) && isTreeType(x + 1, y + 1)))) {
      return true;
    }
  }
  // :2897-2898 下：active() 口径；slope 0 且非半砖，实心（非平台）或平台
  if (st.inBounds(x, y + 1) && hasTileAt(st, x, y + 1)) {
    const bi = st.idx(x, y + 1);
    const bt = st.get(x, y + 1);
    const bs = sheetOf(bt);
    if (st.slope[bi] === 0 && st.half[bi] === 0
      && ((tileSolidType(bt) && !tileSolidTopType(bt)) || PLATFORMS.has(bs))
      && !NOT_REALLY_SOLID.has(bs)) {
      return true;
    }
  }
  return false;
}

// ===================== Collision.HitLineWall / HitWallSubstep 1:1（Collision.cs:1148-1359） =====================

/**
 * Collision.HitWallSubstep（Collision.cs:1312-1359）：该格墙"还有得锤"。
 *  - wall==0 → false（:1314-1317）
 *  - 房墙（Main.wallHouse，Main.cs 全表）→ flag=true（:1319-1322）
 *  - 否则 3×3 任一邻格（含对角，跳过自身）wall==0 → flag=true（:1325-1334）
 *  - 本格 active 且 flag：八邻全是 active+tileSolid+!tileSolidTop → flag=false
 *    （墙被实心块完全包死，锤不到；:1336-1357）
 * 返回 null 表示原版越界异常（Main.tile[x±1,y±1] 越界 → NullReference/IndexOutOfRange，
 *  HitLineWall 的 catch 吞成 (-1,-1)；此处上层据此短路）。
 */
export function hitWallSubstepCore(st: TileStore, x: number, y: number): boolean | null {
  if (!st.inBounds(x, y)) return null; // 原版 Main.tile[x,y] 越界 → 异常
  const i = st.idx(x, y);
  if (st.wall[i] === 0) return false;
  let flag = false;
  if (WALL_HOUSE.has(st.wall[i])) flag = true;
  if (!flag) {
    for (let k = -1; k < 2; k++) {
      for (let l = -1; l < 2; l++) {
        if (k === 0 && l === 0) continue;
        if (!st.inBounds(x + k, y + l)) return null; // :1329 越界读 → 异常
        if (st.wall[st.idx(x + k, y + l)] === 0) flag = true;
      }
    }
  }
  // :1336 `Main.tile[x,y].active() & flag`——active() 口径（已致动格仍挡墙）
  if (hasTileAt(st, x, y) && flag) {
    let flag2 = true;
    for (let k = -1; k < 2; k++) {
      for (let l = -1; l < 2; l++) {
        if (k === 0 && l === 0) continue;
        if (!st.inBounds(x + k, y + l)) { flag2 = false; continue; } // 越界按"非实心邻"计
        const t = st.type[st.idx(x + k, y + l)];
        // :1346 `!tile.active()` active() 口径
        if (!hasTileAt(st, x + k, y + l) || !tileSolidType(t) || tileSolidTopType(t)) flag2 = false;
      }
    }
    if (flag2) flag = false;
  }
  return flag;
}

/** Step_Hammers 全扫段（SmartCursorHelper.cs:1696）独立调用面：越界一律按 false */
export function hitWallSubstep(st: TileStore, x: number, y: number): boolean {
  return hitWallSubstepCore(st, x, y) === true;
}

/**
 * Collision.HitLineWall（Collision.cs:1148-1310）1:1：DDA 步进找首个 HitWallSubstep 为真的格。
 *  端点钳制 :1154-1185（x∈[1,maxTilesX-1]、y∈[1,maxTilesY-40]）；步比 :1192-1212；
 *  起始分支 :1216-1219（y1<y2 先入 case 2）；剩余计数 :1220-1223。
 *  两段循环体（:1232-1291）交替消耗 num9/num10 累积步进并逐格判 HitWallSubstep——
 *  注意 case 2（:1232-1261）体内沿 X 步进、case 1（:1262-1291）体内沿 Y 步进，
 *  斜线因此走出阶梯足迹；
 *  末尾兜底再判一次（:1293-1301）；flag（计数耗尽）/flag2（恰好 1 步走完）终止（:1303）。
 *  途中读到越界格 = 原版 null tile → 返回 (-1,-1)（:1293-1296 的 catch 等价）。
 *  无命中时返回终点格（:1304）。
 */
export function hitLineWall(st: TileStore, x1: number, y1: number, x2: number, y2: number): Pt {
  let num = Math.max(1, Math.min(x1, st.w - 1));       // :1154-1161
  let num2 = Math.max(1, Math.min(y1, st.h - 40));     // :1170-1177
  const num3 = Math.max(1, Math.min(x2, st.w - 1));    // :1162-1169
  const num4 = Math.max(1, Math.min(y2, st.h - 40));   // :1178-1185
  const num5 = Math.abs(num - num3);                    // :1186
  const num6 = Math.abs(num2 - num4);                   // :1187
  if (num5 === 0 && num6 === 0) return { x: num, y: num2 }; // :1188-1191
  let num7 = 1, num8 = 1;                               // :1192-1193
  if (num5 === 0 || num6 === 0) {                       // :1194-1204
    if (num5 === 0) num7 = 0;
    if (num6 === 0) num8 = 0;
  } else if (num5 > num6) num7 = num5 / num6;           // :1205-1208
  else num8 = num6 / num5;                              // :1209-1212
  let num9 = 0, num10 = 0;                              // :1213-1214
  let num11 = num2 < num4 ? 2 : 1;                      // :1215-1219
  let num12 = Math.trunc(num5), num13 = Math.trunc(num6); // :1220-1221
  const num14 = Math.sign(num3 - num);                  // :1222
  const num15 = Math.sign(num4 - num2);                 // :1223
  let flag = false, flag2 = false;                      // :1224-1225
  do {
    if (num11 === 2) {                                  // :1232-1261（y1<y2 首选；体内沿 X 步进）
      num9 += num7;
      const num17 = Math.trunc(num9);
      num9 -= num17;
      for (let j = 0; j < num17; j++) {
        const r = hitWallSubstepCore(st, num, num2);
        if (r === null) return { x: -1, y: -1 };        // 原版 null tile / 越界异常
        if (r) return { x: num, y: num2 };
        if (num12 === 0 && num13 === 0) { flag = true; break; } // :1244-1248
        num += num14; num12--;                          // :1249
        if (num12 === 0 && num13 === 0 && num17 === 1) flag2 = true; // :1251-1254
      }
      if (num13 !== 0) num11 = 1;                       // :1256-1259
    } else {                                            // :1262-1291（体内沿 Y 步进）
      num10 += num8;
      const num16 = Math.trunc(num10);
      num10 -= num16;
      for (let i = 0; i < num16; i++) {
        const r = hitWallSubstepCore(st, num, num2);
        if (r === null) return { x: -1, y: -1 };
        if (r) return { x: num, y: num2 };
        if (num12 === 0 && num13 === 0) { flag = true; break; }
        num2 += num15; num13--;
        if (num12 === 0 && num13 === 0 && num16 === 1) flag2 = true;
      }
      if (num12 !== 0) num11 = 2;
    }
    if (!st.inBounds(num, num2)) return { x: -1, y: -1 }; // :1293-1296 null tile
    const r2 = hitWallSubstepCore(st, num, num2);
    if (r2 === null) return { x: -1, y: -1 };
    if (r2) return { x: num, y: num2 };                  // :1298-1301
  } while (!(flag || flag2));                            // :1303
  return { x: num, y: num2 };                            // :1304
}

/** 锤目标剔除祭坛（SmartCursorHelper.cs:1662/:1704）：原版谓词 `!tile.active() || tile.type != 26` */
function pickNonAltar(st: TileStore, targets: Pt[], world: (p: Pt) => { x: number; y: number }, ref: { x: number; y: number }): Pt | null {
  let best = -1;
  let point: Pt | null = null;
  for (const t of targets) {
    if (!st.inBounds(t.x, t.y)) continue;
    const i = st.idx(t.x, t.y);
    // :1672/:1714 `!tile.active() || tile.type != 26` → 仅剔"在场祭坛"（active() 口径；
    //  幽灵残型祭坛原版视为可考虑目标）
    if (hasTileAt(st, t.x, t.y) && sheetOf(st.type[i]) === 26) continue;
    const w = world(t);
    const d = dist(w.x, w.y, ref.x, ref.y);
    if (best === -1 || d < best) { best = d; point = t; }
  }
  return point;
}

// ===================== Collision.CanHitWithCheck 1:1（Collision.cs:492-589） =====================

/**
 * DelegateMethods.NotDoorStand（DelegateMethods.cs:858-869）：开着的门（sheet 11）的
 *  "锚帧"（frameX<18 或 ≥54）返回 false（阻挡视线），门体帧（18≤frameX<54）返回 true。
 *  CanHitWithCheck 的 do-while 以它为循环条件——锚帧直接终止循环 → 返回 false。
 */
function notDoorStand(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return true; // 原版 Main.tile[x,y]==null 短路 → true
  const i = st.idx(x, y);
  if (hasTileAt(st, x, y) && sheetOf(st.type[i]) === 11) { // DelegateMethods.cs:860 active()
    const fx = st.frameX[i];
    if (fx >= 18) return fx < 54;
    return false;
  }
  return true;
}

/** WorldGen.IsOpenDoorAnchorFrame（WorldGen.cs:69697-69710）：sheet 11 且 frameX%72
 *  落在锚帧（<18 或 ≥54），active() 口径。Step_Walls 用它排除开门锚位格
 *  （SmartCursorHelper.cs:1142-1145）。 */
export function isOpenDoorAnchorFrame(st: TileStore, x: number, y: number): boolean {
  if (!hasTileAt(st, x, y)) return false;
  const i = st.idx(x, y);
  if (sheetOf(st.type[i]) !== 11) return false;
  const num = st.frameX[i] % 72;
  if (num >= 18) return num >= 54;
  return true;
}

/** 原版 CanHitWithCheck 邻格阻挡谓词（Collision.cs:551/:567）：
 *  active && !inActive && tileSolid && !tileSolidTop && slope==0 && !halfBrick */
function blocksSightFully(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false; // 原版 null tile → 提前 return false
  const i = st.idx(x, y);
  return !inActiveAt(st, x, y) && activeAt(st, x, y)
    && tileSolidType(st.type[i]) && !tileSolidTopType(st.type[i])
    && st.slope[i] === 0 && st.half[i] === 0;
}

/**
 * Collision.CanHitWithCheck（Collision.cs:492-589）1:1：视线逐格走查。
 *  起点/终点取两盒中心格（:494-497），钳制 :498-529；
 *  do-while（:532-578）：每步沿主轴（|dx|>|dy| 走 x，否则走 y）推进一格，
 *  并要求两侧邻格不同时为"完整实心"（:540-566，夹缝不可视）；
 *  到达终点格 → true（:536-539）；落入实心非平台格 → false（:573-576）；
 *  循环条件 = check（Step_Walls 传 NotDoorStand）。
 */
export function canHitWithCheck(
  st: TileStore,
  p1: { x: number; y: number }, w1: number, h1: number,
  p2: { x: number; y: number }, w2: number, h2: number,
  check: (x: number, y: number) => boolean,
): boolean {
  let num = Math.trunc((p1.x + Math.trunc(w1 / 2)) / 16);    // :494
  let num2 = Math.trunc((p1.y + Math.trunc(h1 / 2)) / 16);    // :495
  const num3 = Math.trunc((p2.x + Math.trunc(w2 / 2)) / 16);  // :496
  const num4 = Math.trunc((p2.y + Math.trunc(h2 / 2)) / 16);  // :497
  num = Math.max(1, Math.min(num, st.w - 1));                 // :498-513
  num2 = Math.max(1, Math.min(num2, st.h - 40));
  const cx = Math.max(1, Math.min(num3, st.w - 1));
  const cy = Math.max(1, Math.min(num4, st.h - 40));
  do {
    const num5 = Math.abs(num - cx);                          // :534
    const num6 = Math.abs(num2 - cy);                         // :535
    if (num === cx && num2 === cy) return true;               // :536-539
    if (num5 > num6) {                                        // :540 沿 x 推进
      num += num >= cx ? -1 : 1;
      if (!st.inBounds(num, num2 - 1) || !st.inBounds(num, num2 + 1)) return false; // :543-550
      if (blocksSightFully(st, num, num2 - 1) && blocksSightFully(st, num, num2 + 1)) return false; // :551-554
    } else {                                                  // :556-558 沿 y 推进
      num2 += num2 >= cy ? -1 : 1;
      if (!st.inBounds(num - 1, num2) || !st.inBounds(num + 1, num2)) return false; // :559-566
      if (blocksSightFully(st, num - 1, num2) && blocksSightFully(st, num + 1, num2)) return false; // :567-570
    }
    if (!st.inBounds(num, num2)) return false;                // :571-574
    const i = st.idx(num, num2);
    if (!inActiveAt(st, num, num2) && activeAt(st, num, num2)
      && tileSolidType(st.type[i]) && !tileSolidTopType(st.type[i])) {
      return false;                                           // :575-578
    }
  } while (check(num, num2));                                 // :579
  return false;                                               // :580
}

/** PumpkinSeeds/Boulders 共用收尾（:1077-1096 / :946-965） */
function pumpkinOrBoulderScan(
  env: SmartCursorEnv, reach: Region,
  set: (x: number, y: number) => void,
  pred: (st: TileStore, i: number, j: number) => boolean,
): void {
  const st = env.st;
  const targets: Pt[] = [];
  for (let i = reach.x0; i <= reach.x1; i++) {
    for (let j = reach.y0; j <= reach.y1; j++) {
      if (!st.inBounds(i, j)) continue;
      if (pred(st, i, j)) targets.push({ x: i, y: j });
    }
  }
  const point = nearestOf(targets, env.mouse);
  if (point && inTileBounds(point.x, point.y, reach.x0, reach.y0, reach.x1, reach.y1)) {
    set(point.x, point.y);
  }
}
