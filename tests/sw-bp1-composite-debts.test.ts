// SW-BP1 2026-09-07 —— 合成/物品/royale 剩余债清偿（RB4a 债③④⑦⑧ / BM1 债④ R1 /
// BE1 债①② / RB5a 债①②）守卫矩阵。
// 原版权威（Terarria1457，源码锚随本批刀落，行号见各断言）：
//   · Player.cs:39463-39507            ItemSpace（IsAPickup 恒真臂 :39465-39468；
//                                      uniqueStack 臂 :39469-39471 死码证据结案；
//                                      Cofveve 臂 :39502-39505/:39509-39528 对
//                                      CanTakeItemToPersonalInventory 贡献恒零）
//   · ItemSpaceStatus :246-256         CanTakeItemToPersonalInventory = CanTake && !VoidVault
//   · Player.cs:39873/:39620           GetItem_FillEmptyInventorySlot `inventory[i] = returnItem`
//                                      （整 Item 对象入槽 → favorited 随行；FillAmmo
//                                      空格支 :39620 同式）
//   · Player.cs:39681-39698            GetItem 空槽序：favorited 升序 0..num / 其余降序
//   · Player.cs:5112-5114/:5135-5140   dropItemCheck 关包/向导件 GetOrDropItem 整对象回包
//   · Player.cs:7197-7202              GetOrDropItem 尾 RequestNewItem(base.Center)
//                                      （Item.cs:49659 NewItem(Vector2 center) 写
//                                      worldItem.Center = 生成盒【中心】语义）
//   · CraftingRequests.cs:340          合成成品 = GetOrDropItem（余量落玩家中心）
//   · NearbyChests.cs:44-58            弹体容器段 = 全弹扫 + 按 bank 对象去重（无 break）
//   · Player.cs:40479-40481            PlaceIt 尾奏位次：SpinSmartPlatform →
//                                      UnslopeForSolids → KillGrassForSolids → AutoPaint
//   · Player.cs:40846-40872            PlaceIt_UnslopeForSolids（下邻 topSlope/halfBrick、
//                                      上邻 bottomSlope → SlopeTile 拍平）
//   · Player.cs:40874-40910            PlaceIt_KillGrassForSolids（3×3 草族 3×3 全
//                                      SolidTile → KillTile(fail:true) 原格转化）
//   · WorldGen.cs:64222-64250          KillTile fail 支（草族→0/57/59、苔→1、苔砖→38）
//   · ExtraSpawnPointManager.cs:248-251 specializedConditions 半砖/斜坡×左右岩浆邻拒
// 分层钉法：SlotActions/Inventory 行为面直调 + 源文本结构锁（srcMatch），
// 同 tests/sw-ay1-slot-ledger.test.ts 车道（不读仓外反编译树——原版行号证据落源注释）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Inventory, canFillEmptyAmmoSlot } from '../src/items/Inventory';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_DEFS, ITEM_IS_A_PICKUP } from '../src/data/items';
import {
  canMergeStack, chestCanTakeJustCheck, canTakeToPersonalInventory,
} from '../src/ui/SlotActions';

const src = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
const srcMatch = (re: RegExp, file = '../src/ui/UI.ts'): boolean => re.test(src(file));

const iidOf = (vid: number): number => {
  const id = ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]];
  if (!ITEM_DEFS[id]) throw new Error(`测试钉死前提失效：vid ${vid} 未注册`);
  return id;
};
const WOOD = iidOf(9);            // 木（可并堆基线）
const STONE = iidOf(2);           // 石（异型基线）
const HEART = iidOf(58);          // 心（IsAPickup 恒真臂活体,ItemID.cs:254）
const GEL = iidOf(23);            // 凝胶（NO_AUTO_FILL_AMMO 特殊弹药活体）
const ARROW = iidOf(40);          // 木箭（CanFillEmptyAmmoSlot 真）

// ---- 放置链行为面（Game 壳,ghost-place-swap / sw-be1-platform-autoslope 同款）----
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import type { TileStore } from '../src/world/TileStore';

const TILE = 16;
const DIRT = TILE_BY_KEY['dirt']!;
const STONE_T = TILE_BY_KEY['stone']!;
const PLATFORM = TILE_BY_KEY['platform']!;
const STONE_ITEM = ITEM_DEFS.find((d) => d && d.tile === 'stone');   // ★方案 A:守洞

type Shell = { tryPlace(tx: number, ty: number, def: typeof ITEM_DEFS[number]): void };

/** Game 壳：只接 tryPlace 链消费面（余桩=空记录,与 sw-be1 同款） */
function shell(w: World): Shell {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & Shell;
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.sfx = { play: () => {} };
  g.cb = { onInventoryChanged: () => {} };
  g.input = {};
  g.entities = { critters: [], enemies: [], npcs: [], projectiles: [] };
  g.remotePlayerProxies = [];
  g.smartCursor = { wanted: false, showing: false };   // 非智能光标 = SpinSmartPlatform 门关,隔离本批两面
  g.spawnParticles = () => {};
  g.recLog = () => {};
  g.spawnDrop = () => {};
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
  g.player = {
    isGhostPhase: () => false,   // ★刀I补桩(BJ343 EmptyTile 玩家臂判据)
    // 站位：目标带 y=19..21 / x=3..12 在射程盒内（inTileRange）
    cx: 8 * TILE + 8, cy: 16 * TILE + 8, x: 8 * TILE + 2, y: 16 * TILE, w: 12, h: 28,
    facing: 1, useTime: 0, attackSpeedMult: 1, dead: false, gfxOffY: 0,
    buffs: { has: () => false }, equipStats: {},
    // ★SW-FX44：SW-BJ59 后 Game.tryPlace 尾 useTime 走 paintTileSpeed→placeSpeedTileRaw
    // 委托面（Game:22294→Player:3213）——桩锁基态 1（Player.cs:2453 基 1f,无增益）
    placeSpeedTileRaw: () => 1,
    inv: {
      selected: 0,
      slots: [{ id: STONE_ITEM ? ITEM_DEFS.indexOf(STONE_ITEM) : 0, stack: 99 }],
      heldItem: () => (STONE_ITEM ? { id: ITEM_DEFS.indexOf(STONE_ITEM), stack: 99 } : null),
      removeAt: () => {},
      removeHeld: () => {},
    },
  } as unknown as Record<string, unknown>;
  return g;
}

function mkWorld(): { w: World; st: TileStore } {
  const w = new World(40, 40, 7, 'sw-bp1');
  return { w, st: w.store as TileStore };
}

// ---------------------------------------------------------------------------
// RB4a 债⑦ canMergeStack placeStyle 位（四路单源同吃）
// ---------------------------------------------------------------------------
describe('★SW-BP1 canMergeStack placeStyle 位（Item.CanStack + 本仓实例样式门,RB4a 债⑦）', () => {
  it('同型同词缀：placeStyle 双侧皆存且不等 → 拒并（敌旗跨样式）', () => {
    expect(canMergeStack({ id: WOOD, prefix: 0, placeStyle: 3 }, { id: WOOD, prefix: 0, placeStyle: 5 })).toBe(false);
    expect(canMergeStack({ id: WOOD, placeStyle: 3 }, { id: WOOD, placeStyle: 3 })).toBe(true);
  });
  it('三元通配语义（=旧 fillRange 内联门逐字等价）：任一侧 undefined 不设门', () => {
    expect(canMergeStack({ id: WOOD, placeStyle: 3 }, { id: WOOD })).toBe(true);
    expect(canMergeStack({ id: WOOD }, { id: WOOD, placeStyle: 3 })).toBe(true);
    expect(canMergeStack({ id: WOOD }, { id: WOOD })).toBe(true);
  });
  it('id/prefix 位不回退（CanStack 词缀面 SW-AY1 R1 原语义）', () => {
    expect(canMergeStack({ id: WOOD }, { id: STONE })).toBe(false);
    expect(canMergeStack({ id: WOOD, prefix: 1 }, { id: WOOD, prefix: 2 })).toBe(false);
  });
  it('chestCanTakeJustCheck placeStyle 随行：JustCheck 门与实刀同判（异样式旗不误报可移入）', () => {
    const chest = [{ id: WOOD, stack: 10, placeStyle: 3 }];
    expect(chestCanTakeJustCheck(chest, WOOD, 999, undefined, 5)).toBe(false);
    expect(chestCanTakeJustCheck(chest, WOOD, 999, undefined, 3)).toBe(true);
    expect(chestCanTakeJustCheck(chest, WOOD, 999, undefined, undefined)).toBe(true);
  });
  it('结构锁：canMergeStack placeStyle 位 + fillRange 不再内联展开 + chestJustCheck 五参', () => {
    expect(srcMatch(/export function canMergeStack\(\s*\n?\s*a: \{ id: number; prefix\?: number; placeStyle\?: number \},/, '../src/ui/SlotActions.ts')).toBe(true);
    expect(srcMatch(/a\.placeStyle !== undefined && b\.placeStyle !== undefined && a\.placeStyle !== b\.placeStyle\) return false;/, '../src/ui/SlotActions.ts')).toBe(true);
    expect(srcMatch(/canMergeStack\(s, \{ id, prefix, placeStyle \}\)/, '../src/items/Inventory.ts')).toBe(true);
    expect(srcMatch(/canMergeStack\(cs, \{ id, prefix, placeStyle \}\)/, '../src/ui/SlotActions.ts')).toBe(true);
    expect(srcMatch(/placeStyle === undefined \|\| s\.placeStyle === undefined \|\| s\.placeStyle === placeStyle/, '../src/items/Inventory.ts')).toBe(false);
    expect(srcMatch(/chestCanTakeJustCheck\(chest\.items, cur\.id, maxStack, cur\.prefix, \(cur as \{ placeStyle\?: number \}\)\.placeStyle\)/)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RB4a 债③ canTakeToPersonalInventory IsAPickup 恒真臂（uniqueStack/Cofveve 结案）
// ---------------------------------------------------------------------------
describe('★SW-BP1 canTakeToPersonalInventory IsAPickup 恒真臂（Player.cs:39465-39468,RB4a 债③）', () => {
  it('pickup 类（心 58）满包态也放行——不占包位,ItemSpace 第一支即 true', () => {
    expect(ITEM_IS_A_PICKUP.has(58)).toBe(true);
    const slots: (Inventory['slots'][number])[] =
      new Array(58).fill(null).map(() => ({ id: STONE, stack: 999, favorited: false }));
    // 满包（全部异型满堆,CanStack 恒假）下普通物 = false
    expect(canTakeToPersonalInventory(slots, WOOD, 999, false, false)).toBe(false);
    // 心：恒真臂先于容量扫 → true
    expect(canTakeToPersonalInventory(slots, HEART, 999, false, false)).toBe(true);
  });
  it('非 pickup 物行为不变（空包 true / 满包 false）', () => {
    expect(canTakeToPersonalInventory(new Array(58).fill(null), WOOD, 999, false, false)).toBe(true);
    const full: (Inventory['slots'][number])[] =
      new Array(58).fill(null).map(() => ({ id: STONE, stack: 999 }));
    expect(canTakeToPersonalInventory(full, WOOD, 999, false, false)).toBe(false);
  });
  it('uniqueStack/Cofveve 两臂证据结案（判语落源注,防回归误补）', () => {
    const sa = src('../src/ui/SlotActions.ts');
    // uniqueStack：1457/1458 全量反编译 zero 写位（1456 唯一写位 DefaultToQuestFish
    // 已于 1457 移除）→ 原版本体死码,不建模
    expect(sa).toContain('uniqueStack 臂（:39469-39471');
    expect(sa).toContain('zero 写位');
    // Cofveve：返回 (true, ItemIsGoingToVoidVault:true) →
    // CanTakeItemToPersonalInventory=false（ItemSpaceStatus :246-256）→ 贡献恒零
    expect(sa).toContain('对本函数返回值贡献恒零');
  });
});

// ---------------------------------------------------------------------------
// RB4a 债④ Inventory.add favorited 随行（关包金边/向导取回,GetItem 整对象语义）
// ---------------------------------------------------------------------------
describe('★SW-BP1 Inventory.add favorited 随行（GetItem_FillEmptyInventorySlot :39873 整 Item 对象,RB4a 债④）', () => {
  it('落新堆携带 favorited（关包光标物归位不丢金边）', () => {
    const inv = new Inventory();
    expect(inv.add(WOOD, 5, undefined, undefined, false, false, true)).toBe(0);
    const stack = inv.slots.find((s) => s?.id === WOOD);
    expect(stack?.favorited).toBe(true);
    expect(stack?.stack).toBe(5);
  });
  it('favorited 件升序落首空格（GetItem :39681-39698 favorited 臂同向）', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: STONE, stack: 1 };               // 0 号被异型占 → 1 号是首空格
    inv.add(WOOD, 1, undefined, undefined, false, false, true);
    expect(inv.slots[1]?.id).toBe(WOOD);
    expect(inv.slots[49]?.id).toBeUndefined();            // 尾格不动
    // ★SW-BN5 2026-09-08 勘误：上注「降序臂被预占=新债移交」已清偿（fillBagArms
    // 三臂+热栏臂 :39671-39680,见 tests/sw-bn5-shop-drop-closeout.test.ts）——
    // 本例 WOOD useStyle 1 现走热栏臂落首空热栏格 1,断言同值零漂移
  });
  it('并入已有收藏堆时堆位收藏保持；普通弹药空格支随行（FillAmmo :39620 整对象）', () => {
    const inv = new Inventory();
    inv.slots[10] = { id: WOOD, stack: 10, favorited: true };
    inv.add(WOOD, 5, undefined, undefined, false, false, true);
    expect(inv.slots[10]!.stack).toBe(15);
    expect(inv.slots[10]!.favorited).toBe(true);
    const inv2 = new Inventory();
    expect(canFillEmptyAmmoSlot(ARROW)).toBe(true);       // 钉死前提：普通箭吃空弹药格
    inv2.add(ARROW, 1, undefined, undefined, false, false, true);
    expect(inv2.slots[54]?.id).toBe(ARROW);
    expect(inv2.slots[54]?.favorited).toBe(true);
  });
  it('GEL 走弹药合并支不入空格（NO_AUTO_FILL_AMMO 面,收藏随行不影响既有门）', () => {
    const inv = new Inventory();
    expect(canFillEmptyAmmoSlot(GEL)).toBe(false);
    const left = inv.add(GEL, 3, undefined, undefined, false, false, true);
    expect(left).toBe(0);                                  // 合并支不收 → 溢出落背包（原版同构）
    const bag = inv.slots.slice(0, 50).find((s) => s?.id === GEL);
    expect(bag?.favorited).toBe(true);
  });
  it('结构锁：add 七参 + favorited 随行写面 + closeInventory/guideSearch 取回随行+cy 落点', () => {
    expect(srcMatch(/add\(id: number, count: number, prefix\?: number, placeStyle\?: number, noCoinMerge = false,\s*\n\s*preferHotbar = false, favorited = false\)/, '../src/items/Inventory.ts')).toBe(true);
    expect(srcMatch(/favorited \? \{ favorited: true \} : \{\}/, '../src/items/Inventory.ts')).toBe(true);
    // 关包归位（dropItemCheck → GetOrDropItem 整对象回包 + RequestNewItem(base.Center)）
    expect(srcMatch(/inv\.add\(h\.id, h\.stack, h\.prefix, h\.placeStyle, false, false, !!h\.favorited\)/)).toBe(true);
    // ★BJ326 速度翻转（undefined,undefined=随机掷）+★BJ390 词缀随行尾参
    expect(srcMatch(/this\.game\.spawnDrop\(p\.cx, p\.cy, hDef\?\.key \?\? '', left, undefined, undefined, h\.placeStyle, h\.prefix\)/)).toBe(true);
    // 向导搜索面板归还（closeGuideSearch 同式）
    expect(srcMatch(/inv\.add\(pl\.id, pl\.stack, pl\.prefix, pl\.placeStyle, false, false, !!pl\.favorited\)/)).toBe(true);
    // 合成溢出/渔获两处玩家中心落点（RB5a 债②;★BJ326 缺省翻转后显式 (0,-2) 退役=随机掷）
    expect(srcMatch(/spawnDrop\(this\.player\.cx, this\.player\.cy, outKey, left\)/, '../src/core/Game.ts')).toBe(true);
    expect(srcMatch(/spawnDrop\(this\.player\.cx, this\.player\.cy, key!, left\)/, '../src/core/Game.ts')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RB4a 债⑧ FlyingPiggyBank 全弹扫（NearbyChests.cs:44-58 无 break）
// ---------------------------------------------------------------------------
describe('★SW-BP1 craftSources 弹体容器支全弹扫+去重（NearbyChests.cs:44-58,RB4a 债⑧）', () => {
  it('结构锁：飞猪循环无 break-after-first；去重经 includes（同一 bank 只入列一次）', () => {
    const game = src('../src/core/Game.ts');
    const from = game.indexOf('const projectileBanks: CraftItemSource[] = [];');
    // ★BJ730 改判史：尾锚旧用裸 '960 Chester → 同 -2 = bank'（当时全文唯一）——
    //  Game.ts 增重（容器宠物悬停 petProbes 面）后 :44004 出现同名注释先于声明位,
    //  indexOf 首中即窗口倒置。改用带 :80561 尾注的循环内唯一样本锚。
    const to = game.indexOf('projectileBanks.push(banksWrapped[0]);   // 960 Chester → 同 -2 = bank（:80561）');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const loop = game.slice(from, to);
    expect(loop).toContain('FlyingPiggyBank');
    expect(loop).toContain('!projectileBanks.includes(banksWrapped[0])');
    expect(loop).not.toContain('break;');   // 原版全弹扫（AI_097 去重是活体互杀,非扫描剪枝）
  });
});

// ---------------------------------------------------------------------------
// BE1 债①② UnslopeForSolids / KillGrassForSolids（Player.cs:40846-40910）
// ---------------------------------------------------------------------------
describe('★SW-BP1 放置实心尾奏 UnslopeForSolids/KillGrassForSolids（BE1 债①②）', () => {
  it('结构锁：两面方法体判据 + 位次（SpinSmartPlatform 后/AutoPaint 前）+ tileSolid 门', () => {
    const game = src('../src/core/Game.ts');
    expect(game).toContain('private placeThingUnslopeForSolids(cx: number, cy: number): void');
    expect(game).toContain('private placeThingKillGrassForSolids(cx: number, cy: number, createSheet: number): void');
    // Unslope 判据（:40852-40871）：下邻 topSlope{1,2}∥halfBrick / 上邻 bottomSlope{3,4}
    expect(game).toContain('st.half[j1] === 1 || st.slope[j1] === 1 || st.slope[j1] === 2');
    expect(game).toContain('st.slope[j2] === 3 || st.slope[j2] === 4');
    // KillGrass 草族表（:40882-40883 平铺表逐 id）+ 3×3 SolidTile 门 + fail 支转化
    expect(game).toContain('new Set([2, 23, 60, 70, 109, 199, 477, 492, 633])');
    expect(game).toContain('if (!this.solidTileStrictAt(k, l)) { flag = false; break; }');
    expect(game).toContain('this.killTileFailTransform(i, j, sheet);');
    // 位次：SpinSmartPlatform 调用点在 Unslope/KillGrass 调用点之前,AutoPaint 更后
    const spinAt = game.indexOf('this.placeThingSpinSmartPlatform(tx, ty);');
    const unslopeAt = game.indexOf('this.placeThingUnslopeForSolids(clickX, clickY)');
    const grassAt = game.indexOf('this.placeThingKillGrassForSolids(clickX, clickY, shSolid)');
    // ★SW-BN5 2026-09-08 伪红勘误（记账层瑕疵顺手清,非本刀语义）：indexOf 首现命中
    //  BJ18 块换段尾奏注释（Game.ts :22580 区「→ PlaceIt_AutoPaintAndActuate…」）,
    //  BJ18 落盘起本锁恒红（既有红,先于 SW-BN5）；lastIndexOf 命中 place-thing 链
    //  真身（:23377 AutoPaint 注）。
    const paintAt = game.lastIndexOf('PlaceIt_AutoPaintAndActuate');
    expect(spinAt).toBeGreaterThan(-1);
    expect(unslopeAt).toBeGreaterThan(spinAt);
    expect(grassAt).toBeGreaterThan(unslopeAt);
    expect(paintAt).toBeGreaterThan(grassAt);
    // tileSolid 门（def.solid ∪ TILE_SOLID_TOP_FAMILY 真表代理）+ 平台排 Unslope 不排 KillGrass
    // ★BJ426（2026-09-23）：TILE_SOLID_TOP_FAMILY=内部 id 域,shSolid=sheet 域——查表前
    //   须经 TILE_INTERNAL_BY_SHEET 平移（旧裸传 shSolid 双向失效,tests/bj426-tile-domain-census 钉死）。
    expect(game).toContain('const tileSolidCreate = !!def.solid || TILE_SOLID_TOP_FAMILY.has(TILE_INTERNAL_BY_SHEET.get(shSolid) ?? -1);');
    expect(game).toContain('if (!PLATFORMS_SHEETS.has(shSolid)) this.placeThingUnslopeForSolids(clickX, clickY);');
  });

  it('行为面：实心放置拍平贴邻坡/半砖（UnslopeForSolids :40852-40871）+ 平台豁免', () => {
    const { w, st } = mkWorld();
    // 每次放置独立壳（一壳一放置,同 sw-be1 口径——放置后 itemTime>0 会拦同 tick 二次）
    // 下邻 topSlope（slope1）+ 上邻 bottomSlope（slope3）+ 下邻 halfBrick（另列）
    st.setTileSilent(8, 21, DIRT); st.slope[st.idx(8, 21)] = 1;
    st.setTileSilent(8, 19, DIRT); st.slope[st.idx(8, 19)] = 3;
    st.setTileSilent(10, 21, DIRT); st.half[st.idx(10, 21)] = 1;
    st.setTileSilent(11, 20, STONE_T);                   // 半砖列横锚（hasSupport 半砖面另案,勿混测）
    shell(w).tryPlace(8, 20, STONE_ITEM!);               // 实心块落 (8,20)
    shell(w).tryPlace(10, 20, STONE_ITEM!);
    expect(st.slope[st.idx(8, 21)]).toBe(0);             // 下邻 topSlope 拍平
    expect(st.slope[st.idx(8, 19)]).toBe(0);             // 上邻 bottomSlope 拍平
    expect(st.half[st.idx(10, 21)]).toBe(0);             // 下邻 halfBrick 拍平
    // 平台豁免（:40848 Platforms[createTile] 不触发拍平——SpinSmartPlatform 专属域）
    st.setTileSilent(12, 21, PLATFORM); st.slope[st.idx(12, 21)] = 1;
    st.setTileSilent(11, 20, STONE_T);                   // 横向支撑
    shell(w).tryPlace(12, 20, STONE_ITEM!);
    expect(st.slope[st.idx(12, 21)]).toBe(1);
  });

  it('行为面：3×3 围实的草族原格转化（KillGrassForSolids :40874-40910→KillTile fail 支）', () => {
    const { w, st } = mkWorld();
    const GRASS = TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === 2);
    expect(GRASS).toBeGreaterThan(0);
    // 正例：草 (6,20) 的 3×3 除目标格 (7,20) 外全石 → 放置后 3×3 全实心 → 草→土
    st.setTileSilent(6, 20, GRASS);
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      if (dx === 1 && dy === 0) continue;                // (7,20) = 放置目标格
      st.setTileSilent(6 + dx, 20 + dy, STONE_T);
    }
    shell(w).tryPlace(7, 20, STONE_ITEM!);
    expect(TILE_DEFS[st.type[st.idx(6, 20)]]?.vanilla?.sheet).toBe(0);   // 草→土（:64228-64231）
    // 反例：草 (4,20) 的 3×3 留一空气 (4,19) → flag 假 → 草不转化
    st.setTileSilent(4, 20, GRASS);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const) {
      st.setTileSilent(4 + dx, 20 + dy, STONE_T);        // (0,-1)=(4,19) 留空气
    }
    shell(w).tryPlace(3, 20, STONE_ITEM!);
    expect(TILE_DEFS[st.type[st.idx(4, 20)]]?.vanilla?.sheet).toBe(2);   // 草保持
  });
});

// ---------------------------------------------------------------------------
// RB5a 债① sheetAllTransparent 头注纠偏（死选项）
// ---------------------------------------------------------------------------
describe('★SW-BP1 sheetAllTransparent 注释纠偏+死选项摘除（RB5a 债①）', () => {
  it('结构锁：全透明检测不再传 getContext options（同画布二次调用必忽略）+ 纠偏注在位', () => {
    const cc = src('../src/ui/CharCreation.ts');
    const m = cc.match(/private async sheetAllTransparent[\s\S]*?getContext\('2d'\)/);
    expect(m).toBeTruthy();                       // options 复入（'2d', {...}）→ 本匹配失配即红
    expect(m![0]).not.toContain('willReadFrequently');
    expect(cc).toContain('SW-BP1 2026-09-07 注释纠偏');
    expect(cc).toContain('options 被忽略');
    // 烘焙目标保持 GPU 的实测权衡锚（:1097/:1151 目标首 getContext 不带选项）
    expect(cc).toContain('烘焙目标保持 GPU 加速');
  });
});

// ---------------------------------------------------------------------------
// BM1 债④ royale R1 坡度臂 + R2/R3/R4 结案锁
// ---------------------------------------------------------------------------
describe('★SW-BP1 royale 域（ExtraSpawnPointManager.cs:248-251 坡度臂,R1-R4 复核）', () => {
  it('R1 坡度臂 1:1：specializedFloorOk 半砖/topSlope×左右岩浆邻拒（本仓 lava=liquidType 2）', () => {
    const r = src('../src/world/spawn/ExtraSpawnsRoyale.ts');
    expect(r).toContain('st.half[mi] === 1 || st.slope[mi] === 1 || st.slope[mi] === 2');
    expect(r).toContain('const lavaAt = (q: number): boolean => q >= 0 && st.liquid[q] > 0 && st.liquidType[q] === 2;');
    expect(r).toContain('if (lavaAt(li) || lavaAt(ri)) return false;');
  });
  it('R2/R3/R4 证据结案锁：settings.remix 恒 false + 候选恒空 + PrepareExtraSpawns 不接（坐标入注）', () => {
    const r = src('../src/world/spawn/ExtraSpawnsRoyale.ts');
    expect(r).toContain('remix: false');
    expect(r).toContain('return [];');
    expect(r).not.toContain('DoAdditionalChangesAroundSpawnIfNeeded(');
    // R2 复核坐标：remixSurfaceLayerLow 仅 GenState 持有（持久化车道）
    expect(src('../src/world/gen/vanilla/TerrainPass.ts')).toContain('gs.remixSurfaceLayerLow = Math.floor(gs.rockLevelLow)');
  });
});
