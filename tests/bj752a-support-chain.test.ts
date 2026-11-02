// ★BJ752-A（2026-11-02,issue#39 TF-01~04）：物块/家具支撑幸存链行为锁。
// 架构定谳（原版幸存链全貌,1457 亲读）：
//   触发面 = KillTile/PlaceTile/致动 尾 SquareTileFrame 3×3（WorldGen.cs:81462/
//   :64432/Wiring.cs:3228）+ KillWall 尾 FramesOnKillWall 限定（:60895-60898,
//   TileID.cs:375）,墙铺设（PlaceWall :75740 SquareWallFrame）/油漆零 TileFrame;
//   派发 = TileFrame(:82605) 对 tileFrameImportant 型 → TileFrameImportant(:86241)
//   → Check* 族。通用底锚族（Check3x2 :49617 桌/Check1x2 :43728 椅/Check2x2 :48811/
//   Check2xX :38376/Check4x2 :47817）判据=逐列 SolidTileAllowBottomSlope
//   （active∧(tileSolid∨tileSolidTop)∧(¬topSlope∨平台正帧)∧¬halfBrick∧¬inActive,
//   墙恒不参与）——本仓承载=furnitureBandSurvives（TileAnchorValidator
//   validateAnchorBand,与放置 validateAnchors 同源 evalCell 臂）。专支族=DECOR kind：
//   'banner' 91/'bottletop' 270-698/'sign' 55-573/'anchor5' 723-724/'lever5' 136。
// 本文件锁（每 TF 正例+负例）：
//   TF-01 墙不作地基（桌+墙挖撑必塌/墙-only 必塌/满撑存活）
//   TF-02 平台与合法底坡（桌平台上活/桌底坡3活/半砖杀/铺墙不误拆）
//   TF-03 非 DECOR 顶/侧/墙锚（旗/瓶/物品框/墓碑挖挂点必塌;下方铺墙不误拆;
//        墙锚物品框拆墙塌+换锚梯;锚桩永不塌只换向;开关换向）
//   TF-04 拆除走统一破坏链（存物弹出+记录清账+拴系保持;有物模特存活门）
import { describe, expect, it, vi, afterEach } from 'vitest';
import { World } from '../src/world/World';
import { Game, VANILLA_TILE_FRAME_IMPORTANT, FRAMES_ON_KILL_WALL } from '../src/core/Game';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { VANILLA_ITEM_KEY_BY_ID, ITEM_BY_KEY, ITEM_DEFS } from '../src/data/items';
import { VI } from '../src/data/itemKeys';
import { anchorSpecOf } from '../src/world/TileAnchorValidator';
import { styleDropVid } from '../src/data/vanillaStyleDrops';
import { FURNITURE_TILE_KIND, getFurniture } from '../src/world/FurnitureItems';
import { TrapShot } from '../src/entities/Dart';

const keyOf = (k: string) => {
  const id = TILE_BY_KEY[k];
  expect(id, `def ${k} 应存在`).toBeDefined();
  return id!;
};
const idOfSheet = (s: number) => {
  const id = TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === s);
  expect(id, `sheet ${s} 应有 def`).toBeGreaterThan(0);
  return id;
};

interface Drop { key: string; n: number }

/** Game 壳（同 style-drop-restore supportShell + breakTile 尾段桩）。
 *  wireSurvival() 镜像 Game.ts afterWorldLoad 的两监听（家具单向臂+KillWall 限定
 *  派发 / 3×3 扫）——成因门与真机同式。 */
function mkShell(w: World, drops: Drop[], projs: TrapShot[] = []) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    checkFurnitureSupport: (x: number, y: number) => void;
    checkDecorSquareFrame: (x: number, y: number) => void;
    dispatchWallKillFrame: (x: number, y: number) => void;
    breakTile: (x: number, y: number, byPlayer?: boolean, noItem?: boolean) => void;
    wireSurvival: () => void;
  };
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {}, playWavFile: () => {} };
  g.spawnDrop = (_x: number, _y: number, key: string, n: number) => { drops.push({ key, n }); return null; };
  g.entities = { add: (e: unknown) => { if (e instanceof TrapShot) projs.push(e); }, drops: [], enemies: [], critters: [] };
  g.player = { cx: 0, cy: 0, equipStats: {} };
  g.recLog = () => {};
  g.killTileDropBait = () => {};
  g.dumpChest = () => {};
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
  g.trackTile = 0;
  g.scene = null;
  g.leashed = { netIdsAt: () => [], removeAt: () => {} };
  g.net = null;
  // ★共源装配：与 afterWorldLoad 同一 wireSurvivalChainListeners（成因门单点,
  //  监听语义漂移即测试同步红——M5 变异面由此可观测）
  g.wireSurvival = () => {
    (g as unknown as { wireSurvivalChainListeners(s: unknown): void })
      .wireSurvivalChainListeners(w.store);
  };
  return g;
}

afterEach(() => { vi.restoreAllMocks(); });

// ============ 数据面锁：派发表 + 覆盖普查 ============
describe('BJ752-A 数据面：tileFrameImportant 派发面 + 锚带覆盖普查', () => {
  it('FRAMES_ON_KILL_WALL = TileID.cs:375 全表（20 员,440 重复声明去重）', () => {
    expect([...FRAMES_ON_KILL_WALL].sort((a, b) => a - b)).toEqual([
      4, 55, 132, 136, 240, 241, 242, 245, 246, 334, 395, 425, 440, 471, 510, 511, 573, 630, 631, 723,
    ]);
  });
  it('issue#39 TF-01 的 218 族全量走锚带判定（hasSupport 回落面=空——墙臂/平台臂失效即红）', () => {
    const issue218 = [14, 15, 16, 17, 18, 36, 79, 85, 86, 87, 89, 90, 92, 93, 94, 96, 97, 98, 100, 101, 102, 104, 105, 106, 114, 125, 133, 134, 135, 139, 141, 142, 143, 172, 173, 178, 207, 209, 212, 215, 216, 217, 218, 219, 220, 228, 237, 239, 243, 244, 247, 275, 276, 277, 278, 279, 280, 281, 282, 283, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 316, 317, 318, 319, 320, 335, 337, 338, 339, 349, 354, 355, 356, 358, 359, 360, 361, 362, 363, 364, 376, 377, 378, 390, 391, 392, 393, 394, 405, 406, 410, 411, 412, 413, 414, 443, 452, 453, 455, 456, 457, 463, 464, 466, 469, 480, 486, 487, 489, 490, 491, 493, 494, 497, 499, 505, 506, 509, 520, 521, 522, 523, 524, 525, 526, 527, 532, 533, 538, 542, 543, 544, 545, 547, 548, 550, 551, 553, 554, 555, 556, 558, 559, 560, 564, 565, 568, 569, 570, 580, 582, 594, 598, 599, 600, 601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612, 613, 614, 617, 619, 620, 621, 622, 623, 629, 632, 640, 642, 643, 644, 645, 657, 658, 663, 699, 710, 720, 721, 725, 733, 753];
    const fallback: number[] = [];
    for (const s of issue218) {
      expect(VANILLA_TILE_FRAME_IMPORTANT.has(s), `issue218 sheet ${s} 应在派发面`).toBe(true);
      const d = TILE_DEFS.find((x) => x?.vanilla?.sheet === s);
      expect(d, `sheet ${s} 应有 def`).toBeTruthy();
      const rec = anchorSpecOf(s);
      if (!rec || rec.w !== (d!.w ?? 1) || rec.h !== (d!.h ?? 1)) fallback.push(s);
    }
    // 锚带覆盖=218/218（提取器回归/记录缺员即红）
    expect(fallback).toEqual([]);
  });
  it('表外型恒幸存（宝石 63-68 ∉ tileFrameImportant——原版无幸存语义）', () => {
    for (const s of [63, 64, 65, 66, 67, 68]) {
      expect(VANILLA_TILE_FRAME_IMPORTANT.has(s)).toBe(false);
    }
  });
});

// ============ TF-01：背景墙不当作地基 ============
describe('BJ752-A TF-01：桌椅床像 218 族——墙不作地基（Check3x2/Check1x2 墙恒不参与）', () => {
  const TABLE = keyOf('table');
  const CHAIR = keyOf('chair');
  const STONE = idOfSheet(1);

  it('正例：满撑存活（三列石撑,墙有无皆活）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
    }
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, STONE, 0, 0);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) w.store.setWall(10 + dx, 10 + dy, 1);
    g.checkFurnitureSupport(11, 11);
    expect(w.store.get(10, 10)).toBe(TABLE);
    expect(drops).toEqual([]);
  });

  it('负例①（issue 实测主症状）：墙后挖中列支撑 → 整件塌+单掉（旧行为=墙臂保活 6/6 格）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
      w.store.setWall(10 + dx, 10 + dy, 1);   // 家具背后全墙（issue 复现 1 步）
    }
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, STONE, 0, 0);
    w.store.setTile(11, 12, 0);   // 挖中列支撑（监听位换算 = 查 (11,11)）
    g.checkFurnitureSupport(11, 11);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(12, 11)).toBe(0);      // 整件 6 格全清
    expect(drops.map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[32]]);   // 木桌（styleDrop 表）
  });

  it('负例②：墙-only（无任何地基,仅一格墙）也塌（Check3x2 无墙回退）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
    }
    w.store.setWall(11, 11, 1);   // 仅一格墙（issue:「背后仅一格有墙也足以让整桌悬空」）
    g.checkFurnitureSupport(11, 11);
    expect(w.store.get(10, 10)).toBe(0);
    expect(drops.length).toBe(1);
  });

  it('椅（1×2）同判据：墙上挖撑塌+掉椅;平台角对照见 TF-02', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    for (let dy = 0; dy < 2; dy++) w.store.setTileSilent(10, 10 + dy, CHAIR, 0, dy * 18);
    w.store.setWall(10, 10, 1); w.store.setWall(10, 11, 1);
    w.store.setTileSilent(10, 12, STONE, 0, 0);
    w.store.setTile(10, 12, 0);
    g.checkFurnitureSupport(10, 11);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(10, 11)).toBe(0);
    expect(drops.map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[34]]);   // 木椅
  });
});

// ============ TF-02：平台/合法底坡复验误拒 + 铺墙误拆 ============
describe('BJ752-A TF-02：平台与底坡（SolidWithTop/SolidSide 臂）+ 墙事件成因门', () => {
  const TABLE = keyOf('table');
  const STONE = idOfSheet(1);
  const PLATFORM = keyOf('platform');

  it('正例①：桌上平台（3 列 frame0 平台）复验存活（旧 SolidTile2 近似=平台拒）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
    }
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, PLATFORM, 0, 0);
    g.checkFurnitureSupport(11, 11);
    expect(w.store.get(10, 10)).toBe(TABLE);
    expect(drops).toEqual([]);
  });

  it('正例②：底坡 slope3/4 支撑存活（SolidSide bottom 臂 bt{4,5}）', () => {
    for (const sl of [3, 4]) {
      const w = new World(40, 40, 7, 'bj752a');
      const drops: Drop[] = [];
      const g = mkShell(w, drops);
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
        w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
      }
      for (let dx = 0; dx < 3; dx++) {
        w.store.setTileSilent(10 + dx, 12, STONE, 0, 0);
        w.store.slope[w.store.idx(10 + dx, 12)] = sl;
      }
      g.checkFurnitureSupport(11, 11);
      expect(w.store.get(10, 10), `slope${sl} 支撑应活`).toBe(TABLE);
    }
  });

  it('负例：半砖支撑塌（SolidTile/SolidWithTop/SolidSide 全拒 bt1）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
    }
    for (let dx = 0; dx < 3; dx++) {
      w.store.setTileSilent(10 + dx, 12, STONE, 0, 0);
      w.store.half[w.store.idx(10 + dx, 12)] = 1;
    }
    g.checkFurnitureSupport(11, 11);
    expect(w.store.get(10, 10)).toBe(0);
  });

  it('负例③（issue 症状③,监听成因门）：桌上平台 + 家具背后铺墙 → 不拆（旧=误拆掉 32）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
    }
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, PLATFORM, 0, 0);
    // 桌子正下方的平台【背后】放一块背景墙（PlaceWall :75740 SquareWallFrame 零 TileFrame）
    w.store.setWall(11, 12, 1);
    expect(w.store.get(10, 10)).toBe(TABLE);   // 铺墙不触发复验=原版同款
    expect(drops).toEqual([]);
    // 换正下墙格（误拆旧行为的另一形态）+ 平台背后整行铺墙
    for (let dx = 0; dx < 3; dx++) w.store.setWall(10 + dx, 12, 1);
    expect(w.store.get(10, 10)).toBe(TABLE);
    expect(drops).toEqual([]);
  });

  it('对照（KillWall 限定派发,WorldGen.cs:60895）：桌 ∉ FramesOnKillWall → 拆墙不复查', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
      w.store.setWall(10 + dx, 10 + dy, 1);
    }
    // 无地基悬空桌 + 墙后——移除墙（wallKill）：桌 14 不在 FramesOnKillWall → 原版不复查。
    // ①拆家具身后墙（格=(11,11),桌成员格）：单向臂 (x,y-1)=(11,10) 顶格派发时
    //   锚完整性以 ay=9 起算恒败,非成因门兜底——②才是成因门的可观测面：
    w.store.setWall(11, 11, 0);
    expect(w.store.get(10, 10)).toBe(TABLE);
    expect(drops).toEqual([]);
    // ②拆支撑行空格 (11,12) 的墙：wallKill 若误入单向臂/扫（成因门废）→ (11,11)
    //   桌底格完整派发 → 无支撑即塌;原版 KillWall 对 14 无 TileFrame → 幸存
    w.store.setWall(11, 12, 1);
    w.store.setWall(11, 12, 0);
    expect(w.store.get(10, 10)).toBe(TABLE);
    expect(drops).toEqual([]);
    // 其后任一方块写面（tile 成因）触发即塌（TF-01 判据;扰动须入桌 3×3 窗——
    //  支撑行 (11,12) 与桌底行 (11,11) 相邻）
    w.store.setTile(11, 12, STONE, 0, 0);
    expect(w.store.get(10, 10)).toBe(0);
    expect(drops.length).toBe(1);
  });
});

// ============ TF-03：非 DECOR 顶/侧/墙锚物件 ============
describe('BJ752-A TF-03：旗/瓶装族/物品框/墓碑——顶锚与换锚梯（CheckBanner/Check1x2Top/CheckSign）', () => {
  const STONE = idOfSheet(1);

  it('旗 91：天花板上活;挖挂点（3×3 扫方向）→ 整件 3 格塌+掉红旗 337（issue 实测主症状①）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const BANNER = idOfSheet(91);
    w.store.setTileSilent(10, 9, STONE, 0, 0);   // 天花板挂点
    for (let dy = 0; dy < 3; dy++) w.store.setTileSilent(10, 10 + dy, BANNER, 0, dy * 18);
    // 挂点在 → 扰动存活
    w.store.setTile(10, 13, STONE, 0, 0);
    expect(w.store.get(10, 10)).toBe(BANNER);
    // 挖挂点：监听 (x,y-1) 臂不可达（挂点在旗上方）——3×3 扫承接（TF-03 根因）
    w.store.setTile(10, 9, 0);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(10, 12)).toBe(0);   // 整件 3 格清
    expect(drops.map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[337]]);   // 红旗（BANNERS[0],issue 337 号物品）
  });

  it('瓶装族 270（瓶中萤火虫）：挖天花塌+掉 1993;下方铺墙不误拆（issue 症状②成因门）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const BOTTLE = idOfSheet(270);
    w.store.setTileSilent(10, 9, STONE, 0, 0);
    for (let dy = 0; dy < 2; dy++) w.store.setTileSilent(10, 10 + dy, BOTTLE, 0, dy * 18);
    // 挂点在 → 下方铺墙（wallPlace 零 TileFrame）不拆
    w.store.setWall(10, 12, 1);
    expect(w.store.get(10, 10)).toBe(BOTTLE);
    expect(drops).toEqual([]);
    // 挖天花 → 塌 + 掉瓶中萤火虫
    w.store.setTile(10, 9, 0);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(10, 11)).toBe(0);
    const keys = drops.map((d) => d.key);
    expect(keys).toContain('place_v_270_firefly_in_a_bottle');
  });

  it('物品框 395 墙锚（alt4）：四墙全在活;拆墙（wallKill 限定派发）→ 塌（issue 实测④）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const FRAME = idOfSheet(395);
    // alt4（墙锚）帧带：frameX=36*4+18*dx / frameY=18*dy（alternateCellBase 同式）
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, FRAME, 144 + dx * 18, dy * 18);
      w.store.setWall(10 + dx, 10 + dy, 1);
    }
    w.store.setTile(10, 13, STONE, 0, 0);   // 扰动（无地板,纯墙挂）
    expect(w.store.get(10, 10)).toBe(FRAME);
    // 拆任一格墙（wallKill 限定派发,395 ∈ FramesOnKillWall）——CheckSign alt4 门=
    // 四格 wall 全检（:44030）,失一格即换锚梯;无地板/天花/侧邻 → 塌（issue 实测④
    // 「四格墙全部去掉后仍有 4 格」的修复后形态=首格即塌,无孤儿存留）
    w.store.setWall(10, 10, 0);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(11, 11)).toBe(0);
    expect(drops.map((d) => d.key)).toEqual([VI(3270)]);   // def.drop=3270 真物品（CheckSign :44142 等价）
  });

  it('物品框 395 地板锚：挖一列支撑 → 换锚梯落墙（CheckSign 重帧不杀）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const FRAME = idOfSheet(395);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, FRAME, dx * 18, dy * 18);   // alt0 地板锚
      w.store.setWall(10 + dx, 10 + dy, 1);   // 墙在（换锚梯第 5 档可用）
    }
    w.store.setTileSilent(10, 12, STONE, 0, 0);
    w.store.setTileSilent(11, 12, STONE, 0, 0);
    w.store.setTile(10, 12, 0);   // 挖一列（TopEdge 双格门失）
    expect(w.store.get(10, 10)).toBe(FRAME);   // 不杀
    expect(w.store.get(11, 11)).toBe(FRAME);
    // 重帧到 alt4（墙档）：frameX=144+18*dx（CheckSign :44164-44176）
    const i00 = w.store.idx(10, 10), i10 = w.store.idx(11, 10);
    expect(w.store.frameX[i00]).toBe(144);
    expect(w.store.frameX[i10]).toBe(162);
    expect(drops).toEqual([]);
  });

  it('墓碑 85（decor=true 曾整族免检）：挖地板 → 塌+掉墓碑（CheckSign 85 专属地板档）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 墓碑幽灵 1/8 掷不中（R3-6 面不在此锁）
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const TOMB = idOfSheet(85);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TOMB, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 12, STONE, 0, 0);
    w.store.setTileSilent(11, 12, STONE, 0, 0);
    w.store.setTile(10, 12, 0);
    expect(w.store.get(10, 10)).toBe(0);
    expect(drops.map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[styleDropVid(85, 0)]]);
  });

  it('全向派发锁（SquareTileFrame 3×3）：悬空桌在对角格放块即被扫塌（(x,y-1) 单向臂不可达）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const TABLE = idOfSheet(14);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, TABLE, dx * 18, dy * 18);
    }
    // 无支撑悬空（导入态）——对角下左格 (9,12) 放块：PlaceTile 尾 SquareTileFrame(9,12)
    // 3×3 覆盖桌底行 (10,11) → Check3x2 复验塌（单向 (x,y-1) 臂查 (9,11)=空格不可达）
    w.store.setTile(9, 12, idOfSheet(1), 0, 0);
    expect(w.store.get(10, 10)).toBe(0);
    expect(drops.length).toBe(1);
  });

  it('锚桩 723/724（CheckAnchor :54290）：挖地基【永不塌】只换锚向（switchToWallIfInvalid）', () => {
    for (const sheet of [723, 724]) {
      const w = new World(40, 40, 7, 'bj752a');
      const drops: Drop[] = [];
      const g = mkShell(w, drops);
      g.wireSurvival();
      const ANCHOR = idOfSheet(sheet);
      w.store.setTileSilent(10, 11, STONE, 0, 0);
      w.store.setTileSilent(10, 10, ANCHOR, 0, 0);   // 地板档 frameX=0
      w.store.setTile(10, 11, 0);   // 挖地基——无墙无邻
      expect(w.store.get(10, 10), `锚桩 ${sheet} 永不失撑`).toBe(ANCHOR);
      expect(w.store.frameX[w.store.idx(10, 10)]).toBe(4 * 18);   // 无条件落墙档 :54343-54346
      expect(drops).toEqual([]);   // 无 place_v_72x 伪物掉落（TF-04 症状③）
      // 有天花板 → 换天花档（style 1）;扰动须入锚桩 3×3 窗（(10,11) 侧格）——
      //  先落地板档（放置即触发重评）再挖 → 天花档
      w.store.setTileSilent(10, 9, STONE, 0, 0);
      w.store.setTile(10, 11, STONE, 0, 0);
      expect(w.store.frameX[w.store.idx(10, 10)]).toBe(0 * 18);   // 地板档
      w.store.setTile(10, 11, 0);
      expect(w.store.get(10, 10)).toBe(ANCHOR);
      expect(w.store.frameX[w.store.idx(10, 10)]).toBe(1 * 18);
    }
  });

  it('开关 136（case :86270 换向块）：墙档活;拆墙 → 有地板换地板档/全失塌', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const LEVER = idOfSheet(136);
    w.store.setWall(10, 10, 1);
    w.store.setTileSilent(10, 10, LEVER, 54, 0);   // 墙档 frameX=54
    w.store.setTile(10, 13, STONE, 0, 0);
    expect(w.store.get(10, 10)).toBe(LEVER);   // 墙在活
    // 拆墙 + 下方无地板 → 全失杀
    w.store.setWall(10, 10, 0);   // wallKill → 136 ∈ FramesOnKillWall → 'lever5'
    expect(w.store.get(10, 10)).toBe(0);
    // 对照：下方有地板 → 拆墙换地板档（frameX 0）
    const w2 = new World(40, 40, 7, 'bj752a');
    const drops2: Drop[] = [];
    const g2 = mkShell(w2, drops2);
    g2.wireSurvival();
    w2.store.setWall(10, 10, 1);
    w2.store.setTileSilent(10, 11, STONE, 0, 0);
    w2.store.setTileSilent(10, 10, LEVER, 54, 0);
    w2.store.setWall(10, 10, 0);
    expect(w2.store.get(10, 10)).toBe(LEVER);
    expect(w2.store.frameX[w2.store.idx(10, 10)]).toBe(0);
  });
});

// ============ TF-04：拆除统一破坏链 ============
describe('BJ752-A TF-04：失撑拆除走统一破坏链（存物弹出/记录清账/拴系保持）', () => {
  const STONE = idOfSheet(1);

  it('物品框 395 装铜短剑 3507 失撑 → 短剑+框双掉+furnitureItems 零残留（issue 实测主症状）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const FRAME = idOfSheet(395);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, FRAME, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 12, STONE, 0, 0);
    w.store.setTileSilent(11, 12, STONE, 0, 0);
    // 右键装入铜短剑（3507）——记录面直建（放置链等价,锚=左上 (10,10)）
    const swordKey = VANILLA_ITEM_KEY_BY_ID[3507];
    expect(swordKey).toBeTruthy();
    const swordId = ITEM_BY_KEY[swordKey!];
    w.furnitureItems.push({ x: 10, y: 10, kind: 'item_frame', slots: [{ id: swordId, stack: 1 }] });
    w.store.setTile(10, 12, 0);   // 挖支撑
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(11, 11)).toBe(0);
    const keys = drops.map((d) => d.key);
    expect(keys).toContain(ITEM_DEFS[swordId].key);        // 存物弹出（CheckSign :44063 DropItem）
    expect(keys).toContain(VI(3270));       // 框本体（:44142 Item 3270 等价）
    expect(getFurniture(w.furnitureItems, 'item_frame', 10, 10)).toBeFalsy();   // 零孤儿记录
    expect(keys.filter((k) => k === ITEM_DEFS[swordId].key).length).toBe(1);   // 单发
  });

  it('展示瓶 698 存物失撑（Check1x2Top :47174 先弹）→ 存物+瓶双掉+记录清账', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const JAR = idOfSheet(698);
    w.store.setTileSilent(10, 9, STONE, 0, 0);   // 天花板
    for (let dy = 0; dy < 2; dy++) w.store.setTileSilent(10, 10 + dy, JAR, 0, dy * 18);
    const swordKey = VANILLA_ITEM_KEY_BY_ID[3507]!;
    const swordId = ITEM_BY_KEY[swordKey];
    w.furnitureItems.push({ x: 10, y: 10, kind: 'display_jar', slots: [{ id: swordId, stack: 1 }] });
    w.store.setTile(10, 9, 0);   // 挖天花
    expect(w.store.get(10, 10)).toBe(0);
    const keys = drops.map((d) => d.key);
    expect(keys).toContain(ITEM_DEFS[swordId].key);
    expect(keys).toContain(VI(5472));   // def.drop=5472（Check1x2Top :47199 同值）
    expect(getFurniture(w.furnitureItems, 'display_jar', 10, 10)).toBeFalsy();
  });

  it('有物模特 470 失撑 → 存活（IsBreakable 假=KillTile 头早退,CheckTileBreakability2 同语义）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    g.wireSurvival();
    const DOLL = idOfSheet(470);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, DOLL, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 13, STONE, 0, 0);
    w.store.setTileSilent(11, 13, STONE, 0, 0);
    const swordKey = VANILLA_ITEM_KEY_BY_ID[3507]!;
    const swordId = ITEM_BY_KEY[swordKey];
    w.furnitureItems.push({
      x: 10, y: 10, kind: 'display_doll',
      slots: Array.from({ length: 19 }, (_, i) => (i === 0 ? { id: swordId, stack: 1 } : null)),
    });
    w.store.setTile(10, 13, 0);
    expect(w.store.get(10, 10)).toBe(DOLL);   // 'blocked' → 整件保留
    expect(drops).toEqual([]);
  });

  it('对照（挖掉路既有链保持）：直接破坏装物物品框 = 同弹存物+碎框（两路同源 breakTile）', () => {
    const w = new World(40, 40, 7, 'bj752a');
    const drops: Drop[] = [];
    const g = mkShell(w, drops);
    const FRAME = idOfSheet(395);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, FRAME, dx * 18, dy * 18);
    }
    const swordKey = VANILLA_ITEM_KEY_BY_ID[3507]!;
    const swordId = ITEM_BY_KEY[swordKey];
    w.furnitureItems.push({ x: 10, y: 10, kind: 'item_frame', slots: [{ id: swordId, stack: 1 }] });
    g.breakTile(10, 10, false);   // 首击：两段式 'pop'（KillTile :64168-64175 存物先弹+保留）
    let keys = drops.map((d) => d.key);
    expect(keys).toContain(ITEM_DEFS[swordId].key);
    expect(w.store.get(10, 10)).toBe(FRAME);   // 有物首击保块=原版两段式
    g.breakTile(10, 10, false);   // 次击：空物走 object 支整件碎
    keys = drops.map((d) => d.key);
    expect(getFurniture(w.furnitureItems, 'item_frame', 10, 10)).toBeFalsy();
  });
});
