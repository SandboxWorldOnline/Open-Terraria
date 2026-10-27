// 树族砍伐对账（2026-08-17 用户报"海边棕榈树无法砍伐"触发，同日二审扩到全树族）：
//   根因 = v_323 def 缺 axe（默认 -1 → toolCanBreak 斧档 false）。一审连带修：
//   ①原版镐排除门（Player.cs:45039）；②fellImportedTree 棕榈分支；③清格前帧捕获。
//   二审（KillTile_GetTreeDrops :66245-66309 权威核对）连带修：
//   ④宝石树 gemcorn 门在**树顶**标记格（X≥22/Y≥198，growTreeWithSettings cs:30932
//    树顶覆写帧）——一审误查干底格（实际是 132-176 基座帧）→ 真树仍永假；
//   ⑤砍伐范围 = 切口及以上（CheckTree :54598 上行级联），切口以下树桩保留
//    ——旧实现整列连桩清除非原版；
//   ⑥木材种类按基座草族（GetTreeType :63106）：丛林→红木 620/腐化→乌木 619/
//    猩红→阴森木 911/雪原→针叶木 2503/神圣→珍珠木 621/灰烬→灰烬木 5215/
//    蘑菇草 70→50% 发光蘑菇或无——旧实现恒掉普通木材 9；
//   ⑦橡实 = 树冠标记格 50% ×1（TreeTypeDropsAcorns :63140：None/Mushroom/
//    Jungle 不掉）——旧 75%×2-3 非原版；
//   ⑧仙人掌（CheckCactus :54132 级联）：整株倒 + 每格 vi_276——旧 1×1 路径
//    掉 place_v_ 假物品且上方柱悬空。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { TILE_BY_KEY, TILE_DEFS, T } from '../src/data/tiles';
import { canKillTileAt } from '../src/entities/Mounts';   // ★BJ731:tileAboveProtected 退役改锚
import { Game } from '../src/core/Game';
import { VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { WorldEvolution } from '../src/world/evolution/WorldEvolution';

interface FellShell {
  world: World; chunks: { markDirtyArea: () => void };
  spawnDrop: (x: number, y: number, key: string, n: number) => void;
  spawnParticles: () => void;
  fellImportedTree: (x: number, y: number, t: number) => void;
  fellTree: (x: number, y: number) => void;
  fellCactus: (x: number, y: number) => void;
  breakTile: (x: number, y: number, byPlayer?: boolean) => void;
  sfx: { play: () => void }; playSfxFile: () => void;
  evolution: WorldEvolution;
  spawnKillDropItem: (vid: number, x: number, y: number, stack: number) => void;
}

/** 原型壳直调（private 仅编译期；vitest 环境无 DOM 不走构造器）。
 *  ★SW-BJ39：砍伐面统一委托演化域级联（killTileCascadeAt）→ 壳须挂真
 *  WorldEvolution（killDropFace=KillTile_GetTreeDrops 1:1 单源掉落账） */
function shell(w: World, drops: Array<[string, number]>): FellShell {
  const g = Object.create(Game.prototype) as unknown as FellShell;
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {} };
  g.playSfxFile = () => {};
  g.spawnDrop = (_x, _y, key, n) => { drops.push([key, n]); };
  g.evolution = new WorldEvolution({
    store: w.store,
    seed: 7, worldSurface: 40, rockLevel: 200, dungeonX: 60, difficulty: 0,
    flags: {}, crimson: false, isDay: true, raining: false, maxRaining: 0,
    windSpeedCurrent: 0, playerTile: () => null,
    spawnKillDrop: (vid, x, y, stack) => g.spawnKillDropItem(vid, x, y, stack),
    selectedAxePower: () => 35,
  });
  return g;
}

function ground(w: World): World {
  for (let x = 0; x < 60; x++) w.store.setTileSilent(x, 40, 1, 0, 0);
  return w;
}

const PALM = TILE_BY_KEY['v_323_palm_trees'];
const TREE = TILE_BY_KEY['v_5_trees'];
const CAC = TILE_BY_KEY['v_80_cactus'];
const DIRT = TILE_BY_KEY['dirt'];
const JUNGLE_GRASS = TILE_BY_KEY['v_60_jungle_grass_block'];
const SNOW = TILE_BY_KEY['v_147_snow_block'];

describe('棕榈树砍伐（tileAxe 族对齐）', () => {
  it('axe 覆盖：原版 tileAxe 16 件全表（Main.cs:7157-7172）', () => {
    const VANILLA = [5, 72, 80, 488, 704, 323, 596, 616, 634, 589, 584, 588, 586, 587, 585, 583];
    const missing = VANILLA.filter((s) => {
      const d = TILE_DEFS.find((t) => t.vanilla?.sheet === s);
      return !d || d.axe == null || d.axe < 0;
    });
    expect(missing, `缺 axe 的 sheet: ${missing}`).toEqual([]);
  });

  it('镐排除门（:45039）：树/棕榈/倒木/仙人掌 pick 不可挖，镐可挖普通块/平台', () => {
    // toolMatchesTile 经 (game as any) 直调——private 仅编译期。
    // 2026-08-17 砍树击打音对齐批：拆成 toolMatchesTile（类型门，查
    // TILE_AXE_SHEETS 原版表）+ tryMine 内 d.pick 通用门槛（镐力不足仍
    // 播击打音不积累）——平台 19 非 tileAxe，镐可挖（曾据 d.axe<0 误拒）
    const g = Object.create(Game.prototype) as unknown as {
      toolMatchesTile(t: number, tool: string): boolean;
    };
    for (const t of [PALM, TREE, CAC, TILE_BY_KEY['v_488_fallen_log'], TILE_BY_KEY['v_704_fallen_log_echo']]) {
      expect(g.toolMatchesTile(t, 'pick'), `sheet ${TILE_DEFS[t].vanilla?.sheet} pick`).toBe(false);
      expect(g.toolMatchesTile(t, 'axe'), `sheet ${TILE_DEFS[t].vanilla?.sheet} axe`).toBe(true);
    }
    expect(g.toolMatchesTile(DIRT, 'pick')).toBe(true);
    expect(g.toolMatchesTile(TILE_BY_KEY['platform'], 'pick')).toBe(true);   // 平台非 tileAxe：镐可拆
    expect(g.toolMatchesTile(TILE_BY_KEY['platform'], 'axe')).toBe(false);  // 斧不可拆（原版）
  });

  it('fellImportedTree 棕榈分支：每干格棕榈木 + 树冠格橡实（帧前捕获）', () => {
    const drops: Array<[string, number]> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    // 5 格棕榈（沙地、真实布局：树冠在上，frameX 88-132）
    w.store.setTileSilent(30, 35, PALM, 88, 0);
    w.store.setTileSilent(30, 36, PALM, 110, 0);
    for (let i = 37; i < 40; i++) w.store.setTileSilent(30, i, PALM, 22, 0);
    shell(w, drops).fellImportedTree(30, 39, PALM);
    const palmWood = drops.filter(([k]) => k.startsWith('vi_2504')).reduce((a, [, n]) => a + n, 0);
    const acorns = drops.filter(([k]) => /^vi_27_/.test(k)).reduce((a, [, n]) => a + n, 0);
    expect(palmWood).toBe(5);          // 每干格 1（棕榈无 bonusWood 掷）
    expect(acorns).toBe(2);            // 树冠两格（88/110 → 88-132 门）
    // 整棵清除
    expect(w.store.get(30, 39)).toBe(0);
  });

  it('切口以下树桩保留（CheckTree :54598 上行级联语义）', () => {
    const drops: Array<[string, number]> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    for (let i = 0; i < 5; i++) w.store.setTileSilent(30, 35 + i, PALM, i < 2 ? 88 + i * 22 : 22, 0);
    shell(w, drops).fellImportedTree(30, 37, PALM);   // 拦腰砍（第 3 格）
    expect(w.store.get(30, 35)).toBe(0);              // 切口及以上清
    expect(w.store.get(30, 37)).toBe(0);
    expect(w.store.get(30, 38)).toBe(PALM);           // 树桩保留
    expect(w.store.get(30, 39)).toBe(PALM);
    const wood = drops.filter(([k]) => k.startsWith('vi_2504')).reduce((a, [, n]) => a + n, 0);
    expect(wood).toBe(3);                             // 只掉倒下段 3 格
  });

  it('宝石树 gemcorn 门在树顶标记格（growTreeWithSettings cs:30932 树顶覆写帧）', () => {
    const GEM = TILE_BY_KEY['v_583_topaz_tree'];
    let gemcorn = 0;
    // 50% 掷骰：跑 12 棵，修复后命中率应 > 0（恒 0 = 回归）
    for (let trial = 0; trial < 12; trial++) {
      const drops: Array<[string, number]> = [];
      const w = ground(new World(40, 60, 30, 'open'));
      w.store.setTileSilent(20, 38, GEM, 22, 198);   // 树顶 = 冠标记帧（22,198）
      w.store.setTileSilent(20, 39, GEM, 0, 132);    // 干底 = 基座帧（132-176 带）
      shell(w, drops).fellImportedTree(20, 39, GEM);
      gemcorn += drops.filter(([k]) => k.includes('4851')).length;
    }
    expect(gemcorn).toBeGreaterThan(0);   // 12 树 50% → P(全空) = 1/4096
  });
});

describe('树族二审：KillTile_GetTreeDrops 1:1（:66245-66309）', () => {
  /** 自有树（内部 'tree' id，worldgen/橡实生长主路径）砍基座 */
  function fellOn(groundKey: string, drops: Array<[string, number]>, height = 5): World {
    const w = ground(new World(60, 60, 30, 'open'));
    const gt = groundKey === 'grass' ? T.GRASS : groundKey === 'snow' ? T.SNOW : TILE_BY_KEY[groundKey]!;
    w.store.setTileSilent(30, 40, gt, 0, 0);
    const topY = 40 - height;                      // 基座恒在 40 行，树向上排
    for (let i = 0; i < height; i++) {
      w.store.setTileSilent(30, topY + i, T.TREE, i === 0 ? 22 : 0, i === 0 ? 198 : 0);
    }
    shell(w, drops).fellTree(30, 39);
    return w;
  }

  it('木材种类按基座草族（GetTreeType :63106）', () => {
    const cases: Array<[string, number]> = [
      ['v_60_jungle_grass_block', 620],   // Jungle → Rich Mahogany
      ['v_23_corrupt_grass_block', 619],  // Corrupt → Ebonwood
      ['v_199_crimson_grass_block', 911], // Crimson → Shadewood
      ['v_109_hallowed_grass_block', 621],// Hallowed → Pearlwood
    ];
    for (const [gk, vid] of cases) {
      const drops: Array<[string, number]> = [];
      fellOn(gk, drops);
      const woodKey = VANILLA_ITEM_KEY_BY_ID[vid];
      const woods = drops.filter(([k]) => k === woodKey).reduce((a, [, n]) => a + n, 0);
      const plain = drops.filter(([k]) => /^vi_9_/.test(k)).length;
      expect(woods, `${gk} → item ${vid}`).toBeGreaterThanOrEqual(5);  // 每格 1（bonus 只增不减）
      expect(plain, `${gk} 不应掉普通木材`).toBe(0);
    }
    // 雪原：雪块（tile 147，GetTreeType :63130 Snow → Boreal Wood 2503）
    const snow: Array<[string, number]> = [];
    fellOn('snow', snow);
    expect(snow.filter(([k]) => k === VANILLA_ITEM_KEY_BY_ID[2503]).length).toBeGreaterThan(0);
  });

  it('每格 1 木 + bonusWood 掷骰只增不减（:66306-66308）', () => {
    const drops: Array<[string, number]> = [];
    const w = fellOn('grass', drops, 8);
    const woodKey = VANILLA_ITEM_KEY_BY_ID[9];
    const total = drops.filter(([k]) => k === woodKey).reduce((a, [, n]) => a + n, 0);
    expect(total).toBeGreaterThanOrEqual(8);   // 8 格基线；手持斧力 0 时 bonus≈1/3+1/35
    for (let i = 0; i < 8; i++) expect(w.store.get(30, 32 + i)).toBe(0);
  });

  it('橡实：树冠标记格 50% ×1，蘑菇/丛林/无基座不掉（TreeTypeDropsAcorns :63140）', () => {
    let forestAcorns = 0;
    for (let t = 0; t < 16; t++) {
      const d: Array<[string, number]> = [];
      fellOn('grass', d);
      forestAcorns += d.filter(([k]) => /^vi_27_/.test(k)).reduce((a, [, n]) => a + n, 0);
    }
    expect(forestAcorns).toBeGreaterThan(0);   // 16×50% 全空 P=1/65536
    expect(forestAcorns).toBeLessThanOrEqual(16); // 每棵最多 1 颗（旧实现 2-3 颗必爆）
    for (const gk of ['v_60_jungle_grass_block', 'v_70_mushroom_grass_block']) {
      let acorns = 0;
      for (let t = 0; t < 8; t++) {
        const d: Array<[string, number]> = [];
        fellOn(gk, d);
        acorns += d.filter(([k]) => /^vi_27_/.test(k)).length;
      }
      expect(acorns, `${gk} 不掉橡实`).toBe(0);
    }
  });

  it('蘑菇草地上：每格 50% 发光蘑菇 / 50% 无掉落（:66298-66304）', () => {
    let shrooms = 0, tiles = 0;
    for (let t = 0; t < 6; t++) {
      const d: Array<[string, number]> = [];
      const w = fellOn('v_70_mushroom_grass_block', d);
      shrooms += d.filter(([k]) => k.includes('vi_183')).reduce((a, [, n]) => a + n, 0);
      tiles += w === w ? 5 : 0;
    }
    // 30 格掷 50%：全部为空 P=1/2^30，全部都有也几乎不可能。
    // ★SW-BJ39 重校：bonusWood 骰在树型 switch 之后（WorldGen.cs:66762-66768,
    // :66738 `if (dropItem != 9) return;` 对 tile 5 恒活码——dropItem 此处恒 9），
    // 壳斧力 35 → Next(35)<=35 恒真 → 命中 183 的格 stack 恒 2 → 上限 2×tiles
    expect(shrooms).toBeGreaterThan(0);
    expect(shrooms).toBeLessThan(tiles * 2);
  });

  it('树桩语义：拦腰砍 → 下方保留 + 登记表收缩', () => {
    const d: Array<[string, number]> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    w.store.setTileSilent(30, 40, T.GRASS, 0, 0);
    for (let i = 0; i < 6; i++) w.store.setTileSilent(30, 34 + i, T.TREE, i === 0 ? 22 : 0, i === 0 ? 198 : 0);
    w.trees.push({ x: 30, y: 34, h: 6 });
    shell(w, d).fellTree(30, 37);           // 砍第 4 格
    for (let i = 0; i < 4; i++) expect(w.store.get(30, 34 + i)).toBe(0);
    expect(w.store.get(30, 38)).toBe(T.TREE);   // 树桩 2 格保留
    expect(w.store.get(30, 39)).toBe(T.TREE);
    expect(w.trees).toEqual([{ x: 30, y: 38, h: 2 }]);   // 收缩为树桩段
    const woodKey = VANILLA_ITEM_KEY_BY_ID[9];
    const total = d.filter(([k]) => k === woodKey).reduce((a, [, n]) => a + n, 0);
    expect(total).toBeGreaterThanOrEqual(4);   // 只掉倒下段
  });
});

describe('仙人掌砍伐（CheckCactus :54132 级联）', () => {
  it('破坏基座 → 整株倒（含侧臂），每格掉仙人掌 276', () => {
    const drops: Array<[string, number]> = [];
    const w = ground(new World(40, 60, 30, 'open'));
    const SAND = TILE_BY_KEY['sand'];
    w.store.setTileSilent(10, 40, SAND, 0, 0);
    for (let i = 0; i < 3; i++) w.store.setTileSilent(10, 37 + i, CAC, 22, 0);
    w.store.setTileSilent(11, 38, CAC, 44, 0);   // 侧臂（下方 39 非仙人掌）
    shell(w, drops).fellCactus(10, 39);
    expect(w.store.get(10, 37)).toBe(0);
    expect(w.store.get(10, 38)).toBe(0);
    expect(w.store.get(10, 39)).toBe(0);
    expect(w.store.get(11, 38)).toBe(0);          // 臂随主干同落
    const cactus = drops.filter(([k]) => k.includes('vi_276')).reduce((a, [, n]) => a + n, 0);
    expect(cactus).toBe(4);                        // 3 干 + 1 臂，无 bonus 掷（确定性）
  });

  it('挖掉脚下沙 → 被 CanKillTile 保护拦（底帽帧 c∈{0,1,4,5}，:62298-62305）', () => {
    const drops: Array<[string, number]> = [];
    const w = ground(new World(40, 60, 30, 'open'));
    const SAND = TILE_BY_KEY['sand'];
    w.store.setTileSilent(10, 40, SAND, 0, 0);
    for (let i = 0; i < 2; i++) w.store.setTileSilent(10, 38 + i, CAC, 22, 0);  // 底帽帧
    shell(w, drops).breakTile(10, 40);             // 破坏沙（非仙人掌本体）→ 拦
    expect(w.store.get(10, 40)).toBe(SAND);        // 沙未被破坏
    expect(w.store.get(10, 39)).toBe(CAC);
    expect(drops.length).toBe(0);
  });

  it('CanKillTile 干族保护：挖树脚下草被拦（:62277-62282），枝/冠帧例外放行', () => {
    // ★BJ731 改判史（2026-10-27）：BJ442（2026-10-03）退役拆除 Game.tileAboveProtected
    //   （CheckTileBreakability==2 部分近似）——保护族收编单源 canKillTileAt
    //   （Mounts.ts,CanKillTile 全式 :62716-62810,Game.canKillTile 私有包装）。
    //   本测自 g.tileAboveProtected 改锚 canKillTileAt(极性取反);六案逐位
    //   对拍等价（干帧/根帧拦,枝/冠/同类型放行）。
    const w = ground(new World(40, 60, 30, 'open'));
    // 普通树干在土上：土(10,40) 上方干帧 (0,0) → 保护（ground() 已铺 40 行土）
    w.store.setTileSilent(10, 39, T.TREE, 0, 0);
    expect(canKillTileAt(w.store, 10, 40)).toBe(false);
    // 冠标记帧（Y≥198 例外）→ 放行
    w.store.setTileSilent(10, 39, T.TREE, 22, 198);
    expect(canKillTileAt(w.store, 10, 40)).toBe(true);
    // 枝帧例外（66, 0-44 / 88, 66-110）→ 放行
    w.store.setTileSilent(10, 39, T.TREE, 66, 22);
    expect(canKillTileAt(w.store, 10, 40)).toBe(true);
    w.store.setTileSilent(10, 39, T.TREE, 88, 88);
    expect(canKillTileAt(w.store, 10, 40)).toBe(true);
    // 根帧（22/44 @132-176）→ 保护（挖根下的格被拦）
    w.store.setTileSilent(10, 39, T.TREE, 44, 154);
    expect(canKillTileAt(w.store, 10, 40)).toBe(false);
    // 同类型（砍干本身）不拦
    w.store.setTileSilent(10, 40, T.TREE, 0, 0);
    expect(canKillTileAt(w.store, 10, 40)).toBe(true);
  });

  it('拦腰砍 → 下方保留', () => {
    const drops: Array<[string, number]> = [];
    const w = ground(new World(40, 60, 30, 'open'));
    const SAND = TILE_BY_KEY['sand'];
    w.store.setTileSilent(10, 40, SAND, 0, 0);
    for (let i = 0; i < 3; i++) w.store.setTileSilent(10, 37 + i, CAC, 22, 0);
    shell(w, drops).fellCactus(10, 38);
    expect(w.store.get(10, 37)).toBe(0);
    expect(w.store.get(10, 38)).toBe(0);
    expect(w.store.get(10, 39)).toBe(CAC);        // 切口以下保留
    expect(drops.filter(([k]) => k.includes('vi_276')).length).toBe(2);
  });

  it('叠臂级联：下臂先死 → 上臂失撑再死（CheckCactus 不动点）', () => {
    const drops: Array<[string, number]> = [];
    const w = ground(new World(40, 60, 30, 'open'));
    const SAND = TILE_BY_KEY['sand'];
    w.store.setTileSilent(10, 40, SAND, 0, 0);
    for (let i = 0; i < 3; i++) w.store.setTileSilent(10, 37 + i, CAC, 22, 0);
    w.store.setTileSilent(11, 38, CAC, 44, 0);   // 下臂（39 非仙人掌）
    w.store.setTileSilent(11, 37, CAC, 66, 0);   // 上臂（叠在 38 上）
    shell(w, drops).fellCactus(10, 39);
    for (let yy = 37; yy <= 39; yy++) {
      expect(w.store.get(10, yy)).toBe(0);
      expect(w.store.get(11, yy)).toBe(0);       // 双臂全落，无悬空
    }
    const cactus = drops.filter(([k]) => k.includes('vi_276')).reduce((a, [, n]) => a + n, 0);
    expect(cactus).toBe(5);                       // 3 干 + 2 臂
  });
});
