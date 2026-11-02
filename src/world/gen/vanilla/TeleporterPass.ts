// 原版 TeleporterGenerator（★1457 Terraria.GameContent.Generation/TeleporterGenerator.cs
// 全文 259 行 1:1）——"beam me up" 秘密种子旗（SecretSeed.addTeleporters，WorldGen.cs:367
// 注册码 "+URq9gxzcyHxAXVqdwl1fz8wgPYYu0Wx"）的世界传送门放置臂。
//
// 调用位（★1457 WorldGen.cs）：
//   :18128-18134 PotsGraveyardsAndBoulderPiles pass 首段（!Skyblock.denySomeGeneration 门，
//     先于墓园/瓦罐消耗 RNG 流）——普通世界主臂，本仓接在 potPass 墓园段之前；
//   :16700-16705 平滑 pass 尾（SecretSeed.addTeleporters && Skyblock.denySomeGeneration）
//     ——skyblock 变体臂，本仓 worldgen 未实装 skyblock 生成管线，登记不接（生成器
//     本体的 skyblockWorldGen 分支已按 :116-126 备好，接管线时直用）。
//
// 三阶段放置（PlaceTeleporters :40-67）：
//   阶段① flags=None        前 50% 尝试，minDistance=300；
//   阶段② |=ForceSupports   前 75%，minDistance 减半，支撑三格强制铺实（CleanUpSupport）；
//   阶段③ |=ClearTiles      余量，minDistance 三分之一，上空 3×4 清障（ClearAreaAbove）。
//   水中允许是**无条件**的（CanPutTeleporterHere :188 只拒 liquidType>0 = 岩浆/蜂蜜，
//   水 liquidType==0 全阶段可放）。
//
// 本仓等价（备案）：
//   - CanKillTile 取生成语境可达子集（同 TileCleanupPass.cs:162 先例：wall350/上邻
//     树干族/箱罐族；门 10 生成期无锁、235 自身/巨石-箱在候选格不可达，从略）；
//   - dualDungeons 的 InAnyPotentialDungeonBounds（DungeonUtils.cs:2128，GenVars
//     .dungeonGenVars 外接盒）本仓无对应数据结构，按 vampireSeedFinishPass 同款
//     dungeonX±170 带近似（仅 dualDungeons 种子生效，普通世界零分支）；
//   - PlaceTile 走 setTileSilent 直写帧（传送门 235 = 3×1 单样式 frameX=列*18；
//     压板 135 style4 frameY=72——★BJ753 TF-08 域勘正:原版 Place1x1 default 支
//     颜色档在 Y,旧注「frameX=72」系 X 域错置）——生成期无 TileObject 语义差。
import type { TileStore } from '../../TileStore';
import { LIQUID_TYPE } from '../../TileStore';
import type { RNG } from '../../../core/rng';
import type { GenState } from './GenState';
import { TILE_DEFS, TILE_BY_KEY, IS_A_TREE_TRUNK_IDS, WALL_DUNGEON_SHEETS, CLOUDS_IDS } from '../../../data/tiles';
import { idsByVanillaSheet } from './TileRunner';
import { vanGenSolidType } from './GenSolid';

/** sheet(=原版 tile id)→ 内部 id（同 TileCleanupPass.SHEET_TO_INTERNAL 口径） */
const SHEET_TO_INTERNAL = new Map<number, number>();
for (const d of TILE_DEFS) {
  const vs = d.vanilla?.sheet;
  if (vs !== undefined && !SHEET_TO_INTERNAL.has(vs)) SHEET_TO_INTERNAL.set(vs, TILE_BY_KEY[d.key]);
}

const TELEPORTER_SHEET = 235;
const PLATE_SHEET = 135;
/** Main.wallDungeon（Main.cs:10734-10745：{7,8,9,94..99} 地牢砖墙族）——★BJ187
 *  收编 data/tiles.ts:WALL_DUNGEON_SHEETS 单源（9 项逐值全等） */
const WALL_DUNGEON = WALL_DUNGEON_SHEETS;
/** TileID.Sets.Clouds（★1457 TileID.cs:197：{189,196,460,717,718,719} 云族） */
const CLOUD_TILES = CLOUDS_IDS;   // ★BJ210 收编单源 data/tiles.ts:CLOUDS_IDS（内部 id 域,§6i）
/** TileID.Sets.IsATreeTrunk（TileID.cs:161）——CanKillTile 上邻树干保护门
 *  ★BJ182b 收编单源 data/tiles.ts:IS_A_TREE_TRUNK_IDS(内部 id 域;逐值对拍全等,tests/tile-domain-sentinel §6d) */
const IS_TREE_TRUNK = IS_A_TREE_TRUNK_IDS;
/** cs:62308-62316 上邻保护族（箱 21/祭坛 26/72/77/88/467/488） */
const UP_PROTECT_FAMILY = idsByVanillaSheet(21, 26, 72, 77, 88, 467, 488);
/** TileID.Sets.Boulders（TileID.cs:150 区）——CanKillTile 巨石-箱复核（本仓生成语境
 *  候选格上方为天然地形,CheckBoulderChest 的箱邻接不可达,登记从略） */
const BOULDERS = idsByVanillaSheet(48, 662, 663, 664, 665);

/** SolidTile（WorldGen.cs:70642）：active && tileSolid && !tileSolidTop && !half
 *  && slope==0 && !inActive（越界 = 原版 Main.tile null → true；本仓 false 防边缘） */
function solidTile(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  if (!st.flags[i]) return false;
  if (st.wire[i] & 32) return false;                       // inActive
  const d = TILE_DEFS[st.type[i]];
  if (!d) return false;
  return vanGenSolidType(st.type[i]) && !d.platform && !st.half[i] && st.slope[i] === 0;
}

/** Main.tileSolid[tile.type]（:147 支撑格判据——无 half/slope/inActive 细分） */
function tileSolidType(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  return !!st.flags[i] && vanGenSolidType(st.type[i]);
}

const sheetOf = (id: number): number => TILE_DEFS[id]?.vanilla?.sheet ?? -1;
const framedOf = (id: number): boolean => !!TILE_DEFS[id]?.framed;

/** CanKillTile（WorldGen.cs:62716 生成语境可达子集，见文件头备案） */
function canKillTile(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  if (!st.flags[i]) return false;                          // :62746 !active → false
  if (st.wall[i] === 350) return false;                    // :62748
  if (st.inBounds(x, y - 1)) {
    const up = st.idx(x, y - 1);
    if (st.flags[up]) {
      // ★BJ426（2026-09-23 域错位定谳+落刀）：UP_PROTECT_FAMILY（idsByVanillaSheet 产物）
      //  与 IS_TREE_TRUNK（=IS_A_TREE_TRUNK_IDS 镜像,BJ182b 收编）均为【内部 id 域】表，
      //  曾裸传 sheetOf(...)（sheet 域）→ 两臂全死（758/760 defs 两域撞号仅 2 例,该七值
      //  21/26/72/77/88/467/488 与树干族恰不撞）=CanKillTile 上邻箱/祭坛/树干保护整缺
      //  （传送器清场臂 :183-197 可杀箱下格,原版拒）。修=两表改传内部 id（原版 type 对
      //  type 比较语义）;sh 保留 sheet 域供 323 字面与帧位门（TileCleanupPass/
      //  FinalSeedCleanupPass 同款谓词走 sheet 表=域一致,勿混抄）。
      const tUp = st.type[up];
      const sh = sheetOf(tUp);
      if (UP_PROTECT_FAMILY.has(tUp) && st.type[i] !== tUp) return false;
      if (IS_TREE_TRUNK.has(tUp) || sh === 323) {
        const fx = st.frameX[up], fy = st.frameY[up];
        // 帧位例外（:62282-84 侧枝列放行）
        const sideBranch = (fx === 66 && fy >= 0 && fy <= 44) || (fx === 88 && fy >= 66 && fy <= 110)
          || ((fx === 66 || fx === 88) && fy >= 198 && fy <= 242);
        if (!sideBranch && fy < 198) return false;
        if (sh === 323 && (fx === 66 || fx === 220)) return false;
      }
    }
  }
  void BOULDERS;                                           // 巨石-箱复核登记从略（见上注）
  return true;
}

/** IsTileNearby（WorldGen.cs:8812-8850）：方形邻域扫 type 命中 */
function isTileNearby(st: TileStore, x: number, y: number, sheet: number, distance: number): boolean {
  for (let i = x - distance; i <= x + distance; i++) {
    for (let j = y - distance; j <= y + distance; j++) {
      if (!st.inBounds(i, j)) continue;
      if (st.flags[st.idx(i, j)] && sheetOf(st.type[st.idx(i, j)]) === sheet) return true;
    }
  }
  return false;
}

/** AddWire（WorldGen.cs:58524-58541）：color 0红/1蓝/2绿/3黄 → wire 位 */
function addWire(st: TileStore, x: number, y: number, color: number): void {
  if (!st.inBounds(x, y)) return;
  const bit = color === 0 ? 1 : color === 1 ? 2 : color === 2 ? 4 : 8;
  st.wire[st.idx(x, y)] |= bit;
}

/** AddWireFromPointToPoint（WorldGen.cs:58548-58590）：每迭代三布（起/移 x 后/移 y 后） */
function addWireFromPointToPoint(st: TileStore, x: number, y: number, x2: number, y2: number, color: number): void {
  while (x2 !== x || y2 !== y) {
    addWire(st, x2, y2, color);
    if (x2 > x) x2--;
    if (x2 < x) x2++;
    addWire(st, x2, y2, color);
    if (y2 > y) y2--;
    if (y2 < y) y2++;
    addWire(st, x2, y2, color);
  }
}

/** 传送门放置 pass 入口（PotsGraveyardsAndBoulderPiles 首段调用位，WorldGen.cs:18128-18134） */
export function runTeleporterPass(
  store: TileStore, rng: RNG, gs: GenState,
  opts: { addTeleporters?: boolean; dualDungeons?: boolean; skyblock?: boolean; spawnX: number; spawnY: number },
): void {
  if (!opts.addTeleporters) return;                        // :18128 秘密种子旗门（普通世界零掷）
  const st = store;
  const W = st.w;
  const underworldLayer = st.h - 200;                      // Main.UnderworldLayer（Main.cs:2863）
  const beachDistance = gs.beachDistance;                  // 380（WorldGen.cs:4102）
  // :18129-18131 num = maxTilesX/4200；pairs = 10×num；attempts = 40000×num
  const scale = W / 4200;
  const pairsToPlace = Math.trunc(10 * scale);
  const totalAttempts = Math.trunc(40000 * scale);
  const minDistanceBase = 300;
  const TELEPORTER = SHEET_TO_INTERNAL.get(TELEPORTER_SHEET) ?? 0;
  const PLATE = SHEET_TO_INTERNAL.get(PLATE_SHEET) ?? 0;
  if (!TELEPORTER) return;                                 // 传送门 tile 未实装（不阻塞）

  let placementFlags = 0;                                  // None=0/ForceSupports=1/ClearTiles=2
  let totalPlaced = 0;
  let wireColor = 1;                                       // :28 起手蓝（1蓝/2绿/3黄轮转）
  let minDistance = minDistanceBase;

  /** ClearTile（:241-249）——setTileSilent(0) 同步清油漆/涂层（Tile.cs:934-939） */
  const clearTileAt = (x: number, y: number): void => {
    if (!st.inBounds(x, y)) return;
    if (st.flags[st.idx(x, y)]) st.setTileSilent(x, y, 0);
  };

  /** PlaceSupport（:226-239）：空/非实心格铺 fallbackType 并清坡 */
  const placeSupport = (x: number, y: number, fallbackSheet: number): void => {
    if (!st.inBounds(x, y)) return;
    const i = st.idx(x, y);
    const wasActive = !!st.flags[i];
    const t = st.type[i];
    const useFallback = !wasActive || !vanGenSolidType(t);
    const type = useFallback ? (SHEET_TO_INTERNAL.get(fallbackSheet) ?? 0) : t;
    st.setTileSilent(x, y, type, 0, 0);
    st.slope[i] = 0;                                       // ClearSlope（Tile.cs:158-163）
    st.half[i] = 0;
  };

  /** CleanUpSupport（:212-224）：锚行清空 + 支撑行三格铺实 */
  const cleanUpSupport = (x: number, y: number): void => {
    clearTileAt(x - 1, y);
    clearTileAt(x, y);
    clearTileAt(x + 1, y);
    const i5 = st.inBounds(x, y + 1) ? st.idx(x, y + 1) : -1;
    const t5ok = i5 >= 0 && !!st.flags[i5] && vanGenSolidType(st.type[i5])
      && !framedOf(st.type[i5]);
    const fallback = t5ok ? sheetOf(st.type[i5]) : 1;      // :220 缺省泥土(1)
    placeSupport(x - 1, y + 1, fallback);
    placeSupport(x, y + 1, fallback);
    placeSupport(x + 1, y + 1, fallback);
  };

  /** ClearAreaAboveTeleporter（:201-210）：上空 3 宽×4 高清障 */
  const clearAreaAbove = (x: number, y: number): void => {
    for (let i = x - 1; i <= x + 1; i++) {
      for (let j = y - 3; j <= y; j++) clearTileAt(i, j);
    }
  };

  /** CanPutTeleporterHere（:154-199） */
  const canPutHere = (tileX: number, tileY: number): boolean => {
    // :156-162 支撑三格 frameImportant 拒
    for (const dx of [-1, 0, 1]) {
      if (st.inBounds(tileX + dx, tileY + 1) && framedOf(st.type[st.idx(tileX + dx, tileY + 1)])) return false;
    }
    // :163-166 非 ForceSupports 阶段要求支撑三格全 SolidTile
    if (!(placementFlags & 1)) {
      for (const dx of [-1, 0, 1]) {
        if (!solidTile(st, tileX + dx, tileY + 1)) return false;
      }
    }
    // :167-170 地牢墙/神庙墙(87/86)/云族支撑拒
    if (st.inBounds(tileX, tileY)) {
      const w = st.wall[st.idx(tileX, tileY)];
      if (WALL_DUNGEON.has(w) || w === 87 || w === 86) return false;
    }
    if (st.inBounds(tileX, tileY + 1) && CLOUD_TILES.has(st.type[st.idx(tileX, tileY + 1)])) return false;
    // :171-174 dualDungeons 潜在地牢外接盒拒（本仓 dungeonX±170 带近似，见文件头备案）
    if (opts.dualDungeons && gs.dungeonX > 0) {
      if (Math.abs(tileX - gs.dungeonX) <= 170) return false;
    }
    // :175-178 出生点 20 曼哈顿距拒
    if (Math.abs(tileX - opts.spawnX) + Math.abs(tileY - opts.spawnY) < 20) return false;
    // :179-182 同类排斥（IsTileNearby 235）
    if (isTileNearby(st, tileX, tileY, TELEPORTER_SHEET, minDistance)) return false;
    // :183-197 上空 3×4：岩浆/蜂蜜拒（**水可放**）、非 ClearTiles 阶段要求全空、
    // ClearTiles 阶段要求可清（CanKillTile）
    for (let i = tileX - 1; i <= tileX + 1; i++) {
      for (let j = tileY - 3; j <= tileY; j++) {
        if (!st.inBounds(i, j)) continue;
        const k = st.idx(i, j);
        if (st.liquid[k] > 0 && st.liquidType[k] !== LIQUID_TYPE.WATER) return false;
        if (st.flags[k] && (!(placementFlags & 2) || !canKillTile(st, i, j))) return false;
      }
    }
    return true;
  };

  /** TryFindTeleporterSpot（:112-152）：掷点 → 下落到首实心 → 门禁复检 */
  const tryFindSpot = (out: { x: number; y: number }): boolean => {
    let x = rng.int(beachDistance, W - beachDistance - 1);        // :114 Next(bd, w-bd)
    let y: number;
    if (opts.skyblock) {                                          // :116-126
      y = totalPlaced === 0 ? 50 : rng.int(50, underworldLayer - 101);
    } else {
      y = rng.int(Math.floor(gs.worldSurface), underworldLayer - 101);   // :129
    }
    if (st.inBounds(x, y) && st.flags[st.idx(x, y)]) return false;       // :131 起点须空气
    let flag = false;                                             // :135 越界旗
    // :136-146 向下找首激活格（tile 变量 = (x, y+1)）
    while (!st.inBounds(x, y + 1) || !st.flags[st.idx(x, y + 1)]) {
      y++;
      if (y > underworldLayer) { flag = true; break; }
    }
    if (flag || !tileSolidType(st, x, y + 1)) return false;       // :147
    out.x = x;
    out.y = y;
    return canPutHere(x, y);                                      // :151
  };

  /** TryPlaceTeleporterPair（:69-110） */
  const tryPlacePair = (): boolean => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    if (!tryFindSpot(a)) return false;
    let num = 500;                                                // :75 第二端重掷上限
    while (!tryFindSpot(b)) {
      num--;
      if (num <= 0) break;
    }
    if (num === 0) return false;
    if (placementFlags & 1) {                                     // :90-94 ForceSupports
      cleanUpSupport(a.x, a.y);
      cleanUpSupport(b.x, b.y);
    }
    if (placementFlags & 2) {                                     // :95-99 ClearTiles
      clearAreaAbove(a.x, a.y);
      clearAreaAbove(b.x, b.y);
    }
    // PlaceTeleporter（:251-257）：235 锚行 3×1 + 压板 135 style4 + 双格导线
    for (const p of [a, b]) {
      for (let dx = 0; dx < 3; dx++) st.setTileSilent(p.x + dx, p.y, TELEPORTER, dx * 18, 0);
      // ★BJ753 TF-08 域勘正（2026-11-02）：压板颜色档在 Y——原版 :254
      //  WorldGen.PlaceTile(x,y-1,135,…,style:4) → case 135 派发 Place1x1
      //  （WorldGen.cs:60621-60630）→ switch default 支 `frameY=18*style`
      //  （:45626-45629;唯 36/144/239 走 frameX=style*18 支）。旧写 (72,0)=X 域
      //  错置（头注「frameX=72」自证同错）——同族 TrapsPass:1409/TemplePass:1334/
      //  MicroBiomesPass:2765 均正确写 Y,此处孤立病灶:渲染错色+KillTile case 135
      //  掉落反推（fy/18 :66089）恒 style0 红板。
      st.setTileSilent(p.x, p.y - 1, PLATE, 0, 4 * 18);           // style 4（:254）
      addWire(st, p.x, p.y - 1, wireColor);                       // :255
      addWire(st, p.x, p.y, wireColor);                           // :256
    }
    addWireFromPointToPoint(st, a.x, a.y, b.x, b.y, wireColor);   // :102
    totalPlaced++;
    wireColor++;                                                  // :104-108 1→2→3→1
    if (wireColor > 3) wireColor = 1;
    return true;
  };

  // ---- PlaceTeleporters 三阶段主循环（:40-67）----
  let i = 0;
  for (placementFlags = 0; i < totalAttempts * 0.5; i++) {
    if (tryPlacePair() && totalPlaced >= pairsToPlace) return;
  }
  placementFlags |= 1;                                            // ForceSupports
  for (minDistance = Math.trunc(minDistanceBase / 2); i < totalAttempts * 0.75; i++) {
    if (tryPlacePair() && totalPlaced >= pairsToPlace) return;
  }
  placementFlags |= 2;                                            // ClearTiles
  for (minDistance = Math.trunc(minDistanceBase / 3); i < totalAttempts; i++) {
    if (tryPlacePair() && totalPlaced >= pairsToPlace) break;
  }
}
