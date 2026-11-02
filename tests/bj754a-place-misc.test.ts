// ★BJ754-A（2026-11-02,issue#39）：放置/致动/拴系/重力杂域 TF-09~15 行为锁。
//   判语与源码锚见各 describe 头注；台账 /tmp/recon/bj754a-ledger.md。
//   锚版本：Terarria1457（1458 增量面与本七项无关——SetDefaults/TileObjectData
//   零变更,亲读 1457 全量对勘）。
//   变异恰红口径：本文件的【精确值断言】即变异锁——旧实现值（18 步/default X 向/
//   (style*18,0)/def 足迹/isActive 邻接/碰撞 LUT/仅上格监听）任一回归都会撞红
//   对应断言（例：furnitureStyleBase(81,2) 旧值 [36,0] ≠ 现值 [52,0]）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { TILE_BY_KEY, TILE_DEFS, T } from '../src/data/tiles';
import { VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { TileStore } from '../src/world/TileStore';
import { Wiring } from '../src/world/Wiring';
import { furnitureStyleBase, framedCellFrame } from '../src/world/FurnitureStyle';
import { styleDropVid, styleDropVidOfFrames, styleFromFrame } from '../src/data/vanillaStyleDrops';
import { substyleFootprint, anchorSpecOf } from '../src/world/TileAnchorValidator';
import { anchorStyleOfItem } from '../src/entities/LeashedCritter';
import { vanRuntimeTileSolid } from '../src/world/gen/vanilla/GenSolid';
import { xmasCell } from '../src/world/XmasTree';

const idOfSheet = (s: number): number => {
  const id = TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === s);
  expect(id, `sheet ${s} 应有 def`).toBeGreaterThan(0);
  return id;
};

// ============================================================================
// TF-09 · 珊瑚/贝壳魔杖非 18px 坐标与折行（P1）
//   1457 锚：TileObjectData.cs:4374-4383（81：heights{26}/width24/StyleHorizontal/
//   无 wrap → FullWidth 26 横排）+ :4431-4440（324：width20+pad2=22、WrapLimit 3）；
//   FlexibleTileWand.cs:52-62（275→81 styles0-5 / 2625→324 0-2 / 2626→324 3-5 /
//   4072/4073/4071→324 6-14）；KillTile case 324 :65793-65810（行=frameY/22 五行带）。
// ============================================================================
describe('★BJ754 TF-09：珊瑚 81 / 海贝 324 帧步长与折行（furnitureStyleBase）', () => {
  it('珊瑚 81：横步 26（CoordinateWidth24+pad2）,styles 0-5 无折行 → (26s, 0)', () => {
    expect(furnitureStyleBase(81, 0, 1)).toEqual([0, 0]);
    expect(furnitureStyleBase(81, 1, 1)).toEqual([26, 0]);    // 旧 default 18 步 = [18,0] 恰红
    expect(furnitureStyleBase(81, 2, 1)).toEqual([52, 0]);    // issue#39：三个循环帧应 0/26/52
    expect(furnitureStyleBase(81, 5, 1)).toEqual([130, 0]);
  });
  it('海贝 324：步 22 按 3 列折行——壳 0-2 行0 / 海星 3-5 行1 / 螺 6-14 行2-4', () => {
    expect(furnitureStyleBase(324, 0, 1)).toEqual([0, 0]);
    expect(furnitureStyleBase(324, 2, 1)).toEqual([44, 0]);
    expect(furnitureStyleBase(324, 3, 1)).toEqual([0, 22]);   // 海星样式 3 落 frameY=22 行
    expect(furnitureStyleBase(324, 5, 1)).toEqual([44, 22]);
    expect(furnitureStyleBase(324, 6, 1)).toEqual([0, 44]);   // 雷螺 4072 行2
    expect(furnitureStyleBase(324, 9, 1)).toEqual([0, 66]);   // 夜螺 4073 行3
    expect(furnitureStyleBase(324, 12, 1)).toEqual([0, 88]);  // 玛瑙贝 4071 行4
  });
  it('掉落反推：styleFromFrame[324] = frameY/22 行 + 五行带物品（KillTile case 324）', () => {
    expect(styleFromFrame[324]!(54, 0)).toBe(0);      // 旧错帧 (54,0) 行0 → 掉贝壳（症状面）
    expect(styleFromFrame[324]!(0, 22)).toBe(1);
    expect(styleDropVid(324, 0)).toBe(2625);
    expect(styleDropVid(324, 1)).toBe(2626);
    expect(styleDropVid(324, 2)).toBe(4072);
    expect(styleDropVid(324, 3)).toBe(4073);
    expect(styleDropVid(324, 4)).toBe(4071);
  });
  it('帧⇄掉落 roundtrip：放置帧 → 挖掉还原正确物品（海星 2626 / 玛瑙贝 4071）', () => {
    const starfish = furnitureStyleBase(324, 4, 1);           // 海星样式 4 → (22,22)
    expect(styleDropVidOfFrames(324, starfish[0], starfish[1])).toBe(2626);
    const junonia = furnitureStyleBase(324, 14, 1);           // 玛瑙贝样式 14 → (44,88)
    expect(styleDropVidOfFrames(324, junonia[0], junonia[1])).toBe(4071);
  });
  it('生成侧同构佐证：StructuresPass 珊瑚/贝壳已按 26/22 步写（帧域一致）', () => {
    const src = readFileSync('src/world/gen/vanilla/StructuresPass.ts', 'utf8');
    expect(src).toContain('CORAL, 26 * rng.int(0, 5), 0');
    expect(src).toContain('SEASHELLS, 22 * rng.int(0, 2), 22 * style');
  });
});

// ============================================================================
// TF-10 · 王朝桌 3×1 子样式（P2）
//   1457 锚：TileObjectData.cs:3187-3191（subTile 25：Height=1/Origin(1,0)/heights{16}）;
//   GetTileData :5127-5162 整记录替换。三面：放置 anchorRec（结构锁）+ 幸存 w/h
//   （行为）+ 破坏盒（结构锁,共用 substyleFootprint）。
// ============================================================================
describe('★BJ754 TF-10：变几何子样式足迹（substyleFootprint 单源）', () => {
  it('王朝桌 14 style25 → 3×1;未命中子样式回落 def 足迹', () => {
    expect(substyleFootprint(14, 25, 3, 2)).toEqual({ w: 3, h: 1 });
    expect(substyleFootprint(14, 0, 3, 2)).toEqual({ w: 3, h: 2 });
    expect(substyleFootprint(14, 26, 3, 2)).toEqual({ w: 3, h: 2 });   // 越界回落基记录
    expect(substyleFootprint(15, 0, 1, 2)).toEqual({ w: 1, h: 2 });    // 椅无子样式
  });
  it('exotic 基记录族整体回落（165 冰凌坐地变体不入表驱动链,BJ602 判语维持）', () => {
    expect(anchorSpecOf(165)).toBeNull();
    expect(substyleFootprint(165, 2, 1, 2)).toEqual({ w: 1, h: 2 });
  });
  it('结构锁：放置 anchorRec 选择/写循环足迹/破坏盒三面消费 substyle 变几何', () => {
    const g = readFileSync('src/core/Game.ts', 'utf8');
    // ① anchorRec IIFE：子样式不回落 sp0（旧 `? sp0 : spSub` 恰红）
    expect(g).toContain('const sp = spSub ?? sp0;');
    expect(g).toContain('sp === sp0 && ((def.w ?? 1) !== sp.w || (def.h ?? 1) !== sp.h)');
    // ② 写循环足迹 = anchorRec 几何优先
    expect(g).toContain('const ow = anchorRec ? anchorRec.w : (def.w ?? 1), oh = anchorRec ? anchorRec.h : (def.h ?? 1);');
    // ③ 幸存面 + ④ 破坏盒走 substyleFootprint
    expect(g.match(/substyleFootprint\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('行为：3×1 王朝桌幸存链——支撑在位活 / 挖支撑整件清+掉 2259（帧反推 style25）', () => {
    const w = new World(40, 40, 7, 'bj754a-dynasty');
    const drops: Array<{ key: string; n: number }> = [];
    const g = mkShell(w, drops);
    const TBL = idOfSheet(14), STONE = idOfSheet(1);
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, STONE, 0, 0);
    // 放置写面同款：3×1（ow/oh=anchorRec 子样式几何）,帧 = style25 基 1350+dx*18
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 11, TBL, 1350 + dx * 18, 0);
    g.checkFurnitureSupport(11, 11);                    // 触发格=物件中列
    for (let dx = 0; dx < 3; dx++) expect(w.store.get(10 + dx, 11)).toBe(TBL);   // 支撑在 → 活
    // 旧 def 3×2 读法在此必红：完整性要求 (10..12, 10..11) 同型 → 上行空格 →
    // 早退不杀（悬空永生镜像面）——本断言组锁的是「3×1 件照常走幸存裁决」。
    w.store.setTile(11, 12, 0);                         // 挖中柱支撑
    g.checkFurnitureSupport(11, 11);
    for (let dx = 0; dx < 3; dx++) expect(w.store.get(10 + dx, 11)).toBe(0);     // 整件清
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[2259], n: 1 }]);        // 掉王朝桌本体
  });
});

// ============================================================================
// TF-11 · 圣诞树裸索引帧（P2）
//   1457 锚：TileObjectData.cs:2162-2172（171：4×8/Origin(1,7)/HookPlaceOverride=
//   PlaceXmasTree_Direct processedCoordinates）+ WorldGen.cs:39916-39948（锚点格
//   (10,0),其余格 (列,行) 裸索引）+ CheckXmasTree :39998-40036（frameX<10 回推锚）。
// ============================================================================
describe('★BJ754 TF-11：圣诞树 171 放置帧 = 原版裸索引域', () => {
  it('framedCellFrame(171)：锚点格 (10,0) 哨兵,其余格 (列,行) 裸索引', () => {
    expect(framedCellFrame(171, 4, 0, 0, 0)).toEqual([10, 0]);
    expect(framedCellFrame(171, 4, 0, 1, 0)).toEqual([1, 0]);    // 旧 18px = [18,0] 恰红
    expect(framedCellFrame(171, 4, 0, 0, 1)).toEqual([0, 1]);    // 旧 = [0,18] 恰红
    expect(framedCellFrame(171, 4, 0, 3, 7)).toEqual([3, 7]);
  });
  it('xmasCell 双编码：新放置帧（裸索引）与 wld 导入帧同域解码', () => {
    const st = new TileStore(40, 40);
    const XT = idOfSheet(171);
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 8; dy++) {
      const [fx, fy] = framedCellFrame(171, 4, 0, dx, dy);
      st.setTile(20 + dx, 20 + dy, XT, fx, fy);
    }
    expect(xmasCell(st, 20, 20)).toEqual({ ax: 20, ay: 20, col: 0, row: 0 });
    expect(xmasCell(st, 23, 27)).toEqual({ ax: 20, ay: 20, col: 3, row: 7 });
  });
  it('行为：放置产物经 xmas 幸存复验不碎（旧 18px 帧在第二列/行格判坏=放下即碎）', () => {
    const w = new World(40, 40, 7, 'bj754a-xmas');
    const drops: Array<{ key: string; n: number }> = [];
    const g = mkShell(w, drops);
    const XT = idOfSheet(171), STONE = idOfSheet(1);
    w.store.setTileSilent(11, 18, STONE, 0, 0);
    w.store.setTileSilent(12, 18, STONE, 0, 0);       // 中两柱支撑（CheckXmasTree :40032,ax+1/ax+2）
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 8; dy++) {
      const [fx, fy] = framedCellFrame(171, 4, 0, dx, dy);
      w.store.setTileSilent(10 + dx, 10 + dy, XT, fx, fy);
    }
    // checkDecorSquareFrame 等价：物件九宫内逐格派发 xmas 复验（含旧病灶第二列格）
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 8; dy++) g.checkFurnitureSupport(10 + dx, 10 + dy);
    let cells = 0;
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 8; dy++) {
      if (w.store.get(10 + dx, 10 + dy) === XT) cells++;
    }
    expect(cells).toBe(32);                            // 4×8 完整保留（旧=0/32 放下即碎）
    // 失撑对照：挖中柱 → 整树清（幸存裁决仍生效,非「放不出也拆不掉」）
    w.store.setTile(11, 18, 0);
    g.checkFurnitureSupport(11, 10);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(13, 17)).toBe(0);
  });
});

// ============================================================================
// TF-12 · 普通物块四邻并集（P2）
//   1457 锚：Player.cs:41567-41579（尾 else 支逐字）——四正交邻
//   `active() && (tileSolid ∨ IsBeam{124,561,574-578} ∨ tileRope{213,214,353,365,
//   366,449,450,451,504} ∨ type==314) || 邻.wall>0`,全失回落目标格 wall>0。
// ============================================================================
describe('★BJ754 TF-12：普通块邻接门 = 原版四邻并集（hasSupport 非 framed 支）', () => {
  const mk = () => {
    const w = new World(24, 24, 7, 'bj754a-block');
    const g = Object.create(Game.prototype) as unknown as {
      world: World;
      hasSupport: (x: number, y: number, w: number, h: number, framed?: boolean, onTable?: boolean, sheet?: number) => boolean;
    };
    g.world = w;
    return { w, g, hs: (x: number, y: number) => g.hasSupport(x, y, 1, 1, false, false, 1) };
  };
  it('半砖/坡砖/平台/致动块在下方 → 可放（旧 SolidTile2 底行误拒）', () => {
    const { w, hs } = mk();
    const STONE = idOfSheet(1), PLAT = idOfSheet(19);
    w.store.setTile(10, 11, STONE, 0, 0); w.store.half[w.store.idx(10, 11)] = 1;   // 半砖
    expect(hs(10, 10)).toBe(true);
    w.store.setTile(10, 11, 0); w.store.setTile(10, 11, STONE, 0, 0);
    w.store.slope[w.store.idx(10, 11)] = 3;                                        // 坡砖
    expect(hs(10, 10)).toBe(true);
    w.store.setTile(10, 11, 0); w.store.setTile(10, 11, PLAT, 0, 0);              // 平台（tileSolid=true）
    expect(hs(10, 10)).toBe(true);
    w.store.setTile(10, 11, 0); w.store.setTile(10, 11, STONE, 0, 0);
    w.store.wire[w.store.idx(10, 11)] |= 32;                                       // 已致动（bare active）
    expect(hs(10, 10)).toBe(true);
  });
  it('侧邻致动石块/绳/梁/轨道 → 可放;四邻墙 → 可放;目标格墙兜底 → 可放', () => {
    const { w, hs } = mk();
    const STONE = idOfSheet(1), ROPE = idOfSheet(213), BEAM = idOfSheet(124), TRACK = idOfSheet(314);
    w.store.setTile(11, 10, STONE, 0, 0); w.store.wire[w.store.idx(11, 10)] |= 32;
    expect(hs(10, 10)).toBe(true);                                                 // 旧 isActive(nactive) 误拒
    w.store.setTile(11, 10, 0); w.store.setTile(11, 10, ROPE, 0, 0);
    expect(hs(10, 10)).toBe(true);
    w.store.setTile(11, 10, 0); w.store.setTile(11, 10, BEAM, 0, 0);
    expect(hs(10, 10)).toBe(true);
    w.store.setTile(11, 10, 0); w.store.setTile(11, 10, TRACK, 0, 0);
    expect(hs(10, 10)).toBe(true);
    w.store.setTile(11, 10, 0); w.store.wall[w.store.idx(11, 10)] = 1;             // 四邻墙
    expect(hs(10, 10)).toBe(true);
    w.store.wall[w.store.idx(11, 10)] = 0; w.store.wall[w.store.idx(10, 10)] = 7;  // 目标格墙兜底
    expect(hs(10, 10)).toBe(true);
  });
  it('非实心侧邻（火把/草丛植物/工作台）不构成依附;全空无墙 → 拒（旧任意 isActive 误放行）', () => {
    const { w, hs } = mk();
    const TORCH = idOfSheet(4), PLANTS = idOfSheet(3), WB = idOfSheet(18);
    w.store.setTile(10, 9, TORCH, 0, 0);                                           // 上邻火把
    expect(hs(10, 10)).toBe(false);
    w.store.setTile(10, 9, 0); w.store.setTile(10, 9, PLANTS, 0, 0);               // 上邻草丛（tile 3 植物,非草方块 2）
    expect(hs(10, 10)).toBe(false);
    w.store.setTile(10, 9, 0); w.store.setTile(11, 10, WB, 0, 0);                  // 右邻工作台
    expect(hs(10, 10)).toBe(false);
    w.store.setTile(11, 10, 0);
    expect(hs(10, 10)).toBe(false);                                                // 全空无墙
  });
  it('vanRuntimeTileSolid 域锁：平台九类 true;484/659 初值口径 false;石/门 true', () => {
    for (const sh of [19, 239, 380, 427, 435, 436, 437, 438, 439]) {
      expect(vanRuntimeTileSolid(idOfSheet(sh)), `sheet ${sh}`).toBe(true);
    }
    // ★R30-P1 改判史（2026-11-02）：484/659 运行时=**true**——GenerateWorld
    //   finally→RestoreTemporaryStateChanges 用 Reset 入口快照还原（快照在
    //   [659]=false/:11512 写之前拍下）,生成期翻转全被抹掉；Main.cs:7603/:9767
    //   初值即终值。旧 false 断言系读漏 finally-restore。
    expect(vanRuntimeTileSolid(idOfSheet(484))).toBe(true);
    expect(vanRuntimeTileSolid(idOfSheet(659))).toBe(true);
    expect(vanRuntimeTileSolid(idOfSheet(1))).toBe(true);
    expect(vanRuntimeTileSolid(idOfSheet(10))).toBe(true);      // 关态门 tileSolid[10]=true（Main.cs:8027）
  });
});

// ============================================================================
// TF-13 · 致动器 tileSolid 域（P2）
//   1457 锚：Wiring.cs:3208-3236 DeActive——`flag = Main.tileSolid[type] &&
//   !NotReallySolid[type]` + switch{314,379,386-389,476}→false。九类差集实测
//   （issue#39：19/239/380/427/435-439 wire 恒 16 不置位,石块对照 16→48）。
// ============================================================================
describe('★BJ754 TF-13：致动器 solid 域 = Main.tileSolid（Wiring.deActive）', () => {
  const setup = (sheet: number, x = 10, y = 10) => {
    const world = new World(24, 24, 7, 'bj754a-act');
    const t = idOfSheet(sheet);
    world.store.setTileSilent(x, y, t, 0, 0);
    world.store.wire[world.store.idx(x, y)] |= TileStore.WIRE_ACTUATOR;
    return { world, wr: new Wiring(world.store), t, x, y };
  };
  it('九类 tileSolid 差集可致动（平台/矿锭/种植箱/红队/队伍平台×4）', () => {
    for (const sh of [19, 239, 380, 427, 435, 436, 437, 438, 439]) {
      const { world, wr, x, y } = setup(sh);
      expect(wr.actuate(x, y), `sheet ${sh} actuate 返回`).toBe(true);
      expect(world.store.isActuated(x, y), `sheet ${sh} 应置 inActive 位`).toBe(true);   // 旧碰撞 LUT 恒 false 恰红
    }
  });
  it('石块对照致动;显式禁缩/NotReallySolid 族维持拒（314/476/10）', () => {
    const ok = setup(1);
    ok.wr.actuate(ok.x, ok.y);
    expect(ok.world.store.isActuated(ok.x, ok.y)).toBe(true);
    for (const sh of [314, 476, 10]) {
      const bad = setup(sh);
      bad.wr.actuate(bad.x, bad.y);
      expect(bad.world.store.isActuated(bad.x, bad.y), `sheet ${sh} 不缩`).toBe(false);
    }
  });
});

// ============================================================================
// TF-14 · 拴系小动物 724 二维帧带（P2）
//   1457 锚：TileObjectData.cs:4519-4550（StyleHorizontal+Multiplier5+WrapLimit5 →
//   CalculatePlacementStyle num=类别*5+档,行=类别/列=档）+ TileObject.cs:60-76 +
//   CheckAnchor :54290-54298（frameX/18 反推重定向只写 X）。723 无乘区维持单 X 域。
// ============================================================================
describe('★BJ754 TF-14：724 类别驻 Y 行 / 方向驻 X 列', () => {
  it('类别域（anchorStyleOfItem）：鼠 4375=1 / 萤火虫 1992=4（issue#39 实测对象）', () => {
    expect(anchorStyleOfItem(4375)).toBe(1);
    expect(anchorStyleOfItem(1992)).toBe(4);
    expect(anchorStyleOfItem(1994)).toBe(4);    // 蝶族 flyer 4
  });
  it('结构锁：724 写帧二维式（旧 (anchorStyle*18, 0) 恰红）;723 单 X 域维持', () => {
    const g = readFileSync('src/core/Game.ts', 'utf8');
    expect(g).toContain('st.setTile(tx, ty, tileId, anchorPlaceStyle * 18, anchorStyleOfItem(vid) * 18);');
    expect(g).toContain('st.setTile(tx, ty, tileId, anchorPlaceStyle * 18, 0);');   // 723 臂
  });
  it('帧带表锁：类别1 底锚 (0,18)/墙锚 (72,18);类别4 底锚 (0,72)（原版乘区推演）', () => {
    const band = (category: number, alt: number): [number, number] => [alt * 18, category * 18];
    expect(band(1, 0)).toEqual([0, 18]);    // 老鼠底锚（issue#39 应值;旧实现 (18,0)）
    expect(band(1, 4)).toEqual([72, 18]);   // 老鼠墙锚（旧 (18,0)）
    expect(band(4, 0)).toEqual([0, 72]);    // 萤火虫底锚（旧 (72,0)）
    expect(band(4, 4)).toEqual([72, 72]);   // 萤火虫墙锚（风筝对照 723 (72,0) 不同域）
  });
});

// ============================================================================
// TF-15 · 受重力物块放置自检（P2）
//   1457 锚：TileFrame :82657（`!Falling[type] || SpawnFallingBlockProjectile(i,j,…)`
//   检查沙格【自身】）+ PlaceTile 尾 SquareTileFrame :60748。监听双臂：
//   (x,y-1) 级联（既有）+ (x,y) 自检（本刀补）。
// ============================================================================
describe('★BJ754 TF-15：下落沙自身格自检（onSandCheck + drainSandQueue）', () => {
  const mk = () => {
    const w = new World(24, 24, 7, 'bj754a-sand');
    const added: unknown[] = [];
    const g = Object.create(Game.prototype) as unknown as {
      world: World; sandQueue: Array<[number, number]>;
      onSandCheck: (x: number, y: number) => void;
      drainSandQueue: () => void;
      entities: { add: (e: unknown) => void };
    };
    g.world = w;
    g.sandQueue = [];
    g.entities = { add: (e) => { added.push(e); } };
    return { w, g, added };
  };
  it('结构锁：监听注册走 onSandCheck（含自检臂+成因门;旧仅 (x,y-1) 内联闭包恰红）', () => {
    const src = readFileSync('src/core/Game.ts', 'utf8');
    expect(src).toContain('if (cause === undefined || cause === \'tile\') this.onSandCheck(x, y);');
    expect(src).not.toContain('this.sandQueue.push([x, y - 1]);\n      }\n    });');   // 旧内联闭包退役
  });
  it('放置悬空沙（借侧邻,下方留空）→ 自身入队 → drain 转 FallingBlock', () => {
    const { w, g, added } = mk();
    const SAND = idOfSheet(53), STONE = idOfSheet(1);
    w.store.setTile(11, 10, STONE, 0, 0);            // 右侧石块（放置依附面,TF-12）
    w.store.setTile(10, 10, SAND, 0, 0);             // 沙落在悬空格
    g.onSandCheck(10, 10);                           // = setTile 监听派发位
    expect(g.sandQueue).toContainEqual([10, 10]);    // 自身格入队（旧恒空=永久悬空）
    g.drainSandQueue();
    expect(w.store.get(10, 10)).toBe(0);             // 转落体
    expect(added.length).toBe(1);                    // FallingBlock 生成恰一次
  });
  it('支撑在位的沙 → 自检 no-op（不重复生成）;挖支撑级联（既有臂）维持', () => {
    const { w, g, added } = mk();
    const SAND = idOfSheet(53), STONE = idOfSheet(1);
    w.store.setTile(10, 11, STONE, 0, 0);
    w.store.setTile(10, 10, SAND, 0, 0);
    g.onSandCheck(10, 10);
    g.drainSandQueue();
    expect(w.store.get(10, 10)).toBe(SAND);          // 支撑在 → 留格
    expect(added.length).toBe(0);
    w.store.setTile(10, 11, 0);                      // 挖地基（对照路径）
    g.onSandCheck(10, 11);                           // = 变化格监听 → 检查其上方
    expect(g.sandQueue).toContainEqual([10, 10]);
    g.drainSandQueue();
    expect(w.store.get(10, 10)).toBe(0);
    expect(added.length).toBe(1);
  });
});

// ============================================================================
// Game 壳（decor-support.test.ts mkShell 同款,本刀幸存面用）
// ============================================================================
interface Drop { key: string; n: number }
function mkShell(w: World, drops: Drop[]) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    world: World;
    checkFurnitureSupport: (x: number, y: number) => void;
  };
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {}, playWavFile: () => {} };
  g.spawnDrop = (_x: number, _y: number, key: string, n: number) => { drops.push({ key, n }); return null; };
  g.recLog = () => {};
  g.dumpChest = () => {};
  g.killTileDropBait = () => {};
  g.entities = { add: () => {}, critters: [], drops: [] };
  g.trackTile = 0;
  g.scene = null;
  g.player = { inv: { countOf: () => 0 }, equipStats: {}, cx: 0, cy: 0 };
  g.evolution = null;
  return g;
}

// 防未用导入告警（T 在 idOfSheet 外的键域断言保留）
void T;
void TILE_BY_KEY;
