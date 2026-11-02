// BJ753-A 2026-11-02 issue#39 帧数据/备档域 TF-05~08 四件（P1×2+P2×2）
//
// 定谳链（Terarria1457 亲读,先定谳再动刀）：
//   · TF-05（P2）床右向放置失败：TileObjectData.cs:2001-2008 addBaseTile
//     `baseTile = newTile` 引用携 Alternates（模板 Style4x2 :2552-2567 的 PlaceRight
//     备档 sb=1）;:1697-1715 CopyFrom `_alternates = copy._alternates` 模块引用共享
//     → 床 79（:2607 CopyFrom(Style4x2)）应有右向备档。旧提取器快照只存几何/锚面
//     → bed 79 无 alts（浴缸 90 靠泄漏碰巧正确）→ CanPlace 方向过滤
//     （TileObject.cs:209-212 PlaceLeft+dir1 跳过）后无候选=右向全拒。
//     修=recon-tileobj addBaseTile 备档随快照入册 + CopyFrom 继承（COW 弃置
//     :2100-2102 由 altInherited 旗建模）。
//   · TF-06（P2）椅/浴缸双计翻转：Player.cs:40460-40466 SpinChairs/SpinBedsAndBaths
//     只在 legacy 路（newObjectType==false）调用;椅 15/浴缸 90/床 79/马桶 497 均
//     uccp=true（Style1x2/Style4x2 继承）→ :40085 CustomPlace 路由恒走
//     TileObject.Place（备档 sb 编码右向帧 18/72）,Spin* 永不执行。旧 Game.ts
//     尾段 facing==1 再 +18/+72 = 椅 36/浴缸 144（issue 实测值）。
//     修=撤两尾段（SpinBedsAndBaths 1457 :41162-41168 仅 netMode 同步,无帧写）。
//   · TF-07（P1）椅备档丢 PaddingFix：Calculate :1808-1820
//     styleHeight=Σ(h+cp)+fix.Y——椅 15 fix(0,2)（:4147）FullHeight=40。旧
//     alternateFrameBase 只算 Σ=38 → 右向蒸汽朋克椅 1708（style23）fy=874=23×38
//     （应 920）,挖回收 1706（BarStool）。修=提取器 sty 增 pfx/pfy + 消费面
//     FullWidth/FullHeight 尾加（床 79 fix(0,-2) 同批入册:36 带两路径同值）。
//   · TF-08（P1）压板/测重板颜色写 X：TileObjectData.cs:4382-4389 CopyFrom
//     (Style1x1) 无 StyleHorizontal 覆写（ctor 缺省 false :1786）→ Place :70-75
//     竖排 frameY=18*style;掉落反推 KillTile case 135/428 读 fy/18
//     （WorldGen.cs:66089/:65827）。旧 furnitureStyleBase default X 向
//     → 绿压板 541 放 (18,0) 挖回红 529。修=case 135/428 [0,style*18]。
// 判史：★BJ753（本档）;C14-F2 备档链/帧带数学为前序基座（chooseAnchorFromClickChain/
//   alternateCellFrame）,本刀只补继承提取与 fix 项,不动链评估序。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { ITEM_BY_KEY, ITEM_DEFS, VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { anchorChainOf } from '../src/world/TileAnchorValidator';
import { alternateCellFrame } from '../src/world/TileAnchorValidator';
import { furnitureStyleBase } from '../src/world/FurnitureStyle';
import { Inventory } from '../src/items/Inventory';
import manifestJson from '../src/data/tile-anchors.json';
import goldenJson from './golden/tile-anchor-authority.json';

const STONE = TILE_BY_KEY['stone']!;
const RAW_TILES = (manifestJson as unknown as { v: string; tiles: Record<string, any> }).tiles;

function iidOf(vid: number): number {
  const key = VANILLA_ITEM_KEY_BY_ID[vid];
  expect(key, `vid ${vid} 应有物品`).toBeTruthy();
  return ITEM_BY_KEY[key!]!;
}
function sheetToTid(sheet: number): number {
  return TILE_DEFS.findIndex((d) => d.vanilla?.sheet === sheet);
}

/** tryPlace/breakTile 可驱动面最小桩（shell 形制同 tests/bj602-tile-anchor-gaps.test.ts） */
interface GShell {
  world: World;
  player: Record<string, unknown> & { useTime: number; facing: number };
  smartCursor: { lockedContinuity: null; showing: boolean; x: number; y: number };
  chunks: { markDirtyArea: (...a: unknown[]) => void };
  sfx: { play: (name: string, v?: number, x?: number, y?: number) => void };
  cb: { onInventoryChanged: () => void };
  entities: Record<string, unknown>;
  spawnParticles: (...a: unknown[]) => void;
  spawnDrop: (x: number, y: number, key: string, n: number, vx?: number, vy?: number) => unknown;
  recLog: (...a: unknown[]) => void;
  dumpChest: () => void;
  killTileDropBait: (...a: unknown[]) => void;
  trackTile: number;
  flexWandCycle: number;
  scene: unknown;
  hitTiles: { addDamage: () => number; clear: () => void };
  achievements: unknown;
  tryPlace: (x: number, y: number, def: unknown) => void;
  breakTile: (x: number, y: number, byPlayer?: boolean, noItem?: boolean, pickHit?: boolean) => void;
  checkDecorSquareFrame: (x: number, y: number) => void;
}
function mkShell(heldVid: number, facing: 1 | -1, heldStack = 3,
  at: { x: number; y: number } = { x: 12, y: 19 }): {
  g: GShell; w: World; inv: Inventory; drops: Array<{ key: string; n: number }>;
} {
  const w = new World(48, 48, 7, 'bj753a');
  const inv = new Inventory();
  inv.slots[0] = { id: iidOf(heldVid), stack: heldStack };
  const drops: Array<{ key: string; n: number }> = [];
  const g = Object.create(Game.prototype) as unknown as GShell;
  g.world = w;
  g.smartCursor = { lockedContinuity: null, showing: false, x: 0, y: 0 };
  g.chunks = { markDirtyArea: () => {} };
  g.sfx = { play: () => {} };
  g.cb = { onInventoryChanged: () => {} };
  g.entities = { nextId: 1, add: () => {}, critters: [], drops: [], enemies: [], npcs: [], projectiles: [] };
  g.spawnParticles = () => {};
  g.recLog = () => {};
  g.spawnDrop = (_x, _y, key, n) => { drops.push({ key, n }); return null; };
  g.dumpChest = () => {};
  g.killTileDropBait = () => {};
  g.trackTile = 0;
  g.flexWandCycle = 0;
  g.scene = null;
  g.hitTiles = { addDamage: () => 100, clear: () => {} };
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {}, plantedAcorn: () => {} };
  g.player = {
    placeSpeedTileRaw: () => 1,
    cx: (at.x + 3) * 16 + 8, cy: (at.y - 2) * 16 + 8,   // 站放置域侧上方（射程 5 内,不压足印）
    x: (at.x + 3) * 16 + 2, y: (at.y - 2) * 16 - 6, w: 12, h: 28,
    facing, useTime: 0, usedAmbrosia: false, dead: false, isGhostPhase: () => false,
    buffs: { has: () => false }, equipStats: {},
    inv,
  };
  return { g, w, inv, drops };
}

describe('BJ753-A 数据面（tile-anchors.json 金标钉值,反编译行号锚）', () => {
  it('金标与运行时同拍一致', () => {
    expect(manifestJson.v).toBe('1457');
    expect(goldenJson).toEqual(manifestJson);
  });

  it('TF-05：床 79 承 Style4x2 模板备档（:2607 CopyFrom 继承链）+PF fix 入册', () => {
    const r = RAW_TILES['79'];
    expect(r.alts).toHaveLength(1);
    const alt = r.alts[0];
    expect(alt).toMatchObject({ sb: 1, dir: 'PlaceRight', w: 4, h: 2, ox: 1, oy: 1, uccp: true });
    expect(alt.anchorBottom).toMatchObject({ t: ['SolidTile', 'SolidWithTop', 'SolidSide'], cnt: 4 });
    // 备档脸 = Style4x2 模板快照（hts {16,16} 无 fix → 与基记录发散自带 sty）
    expect(alt.sty).toMatchObject({ hts: [16, 16] });
    expect(alt.sty.pfy).toBeUndefined();
    // 基记录：床自身覆写 hts {16,18}+fix(0,-2)（:2608-2609）→ FullHeight=18+20-2=36
    expect(r.sty).toMatchObject({ sh: true, swl: 2, sls: 1, sm: 2, cw: 16, cp: 2, hts: [16, 18], pfy: -2 });
  });

  it('TF-05 回归锁：浴缸 90 继承不双份（泄漏改正式继承后 alts 内容不变）', () => {
    const r = RAW_TILES['90'];
    expect(r.alts).toHaveLength(1);
    expect(r.alts[0]).toMatchObject({ sb: 1, dir: 'PlaceRight', w: 4, h: 2, ox: 1, oy: 1 });
    expect(r.alts[0].sty).toBeUndefined();          // 未发散 → 消费面承基记录 sty
    expect(r.sty).toMatchObject({ hts: [16, 16] }); // Style4x2 原生 heights（无 fix）
    expect(r.sty.pfy).toBeUndefined();
  });

  it('TF-07：椅 15/马桶 497 sty 带 pfy=2（PaddingFix(0,2) :4147/:4180）', () => {
    expect(RAW_TILES['15'].sty).toMatchObject({ hts: [16, 18], pfy: 2 });
    expect(RAW_TILES['497'].sty).toMatchObject({ hts: [16, 18], pfy: 2 });
    // 邻域无污染：非 fix 族 sty 不带 pfx/pfy（条件入库,52 记录逐字节稳定）
    expect(RAW_TILES['178'].sty).toEqual({ sh: true, swl: 7, sls: 1, sm: 1, cw: 16, cp: 2, hts: [16] });
  });
});

describe('BJ753-A 备档帧带数学（Calculate :1808-1820 全式）', () => {
  it('TF-07：椅备档行带 40（(16+2)+(18+2)+fix2）——右向蒸汽朋克椅 fy=920 非 874', () => {
    const chain = anchorChainOf(15, 23);
    expect(chain).toHaveLength(2);
    const alt = chain[1];
    expect(alt.sb).toBe(1);
    // cell (0,0) = (18, 920)；cell (0,1) = (18, 938)（行步进 hts[0]+cp=18,fix 只入带步）
    expect(alternateCellFrame(alt.rec, alt.sb, 23, 0, 0)).toEqual([18, 920]);
    expect(alternateCellFrame(alt.rec, alt.sb, 23, 0, 1)).toEqual([18, 938]);
    expect(alternateCellFrame(alt.rec, alt.sb, 0, 0, 0)).toEqual([18, 0]);
  });

  it('TF-07 邻件：马桶 497 备档同式（40 带）', () => {
    const chain = anchorChainOf(497, 23);
    expect(alternateCellFrame(chain[1].rec, chain[1].sb, 23, 0, 1)).toEqual([18, 938]);
  });

  it('TF-05：床/浴缸备档带 72 列 36 行（FullWidth=(16+2)*4,FullHeight=36）', () => {
    const bed = anchorChainOf(79, 1)[1];
    expect(alternateCellFrame(bed.rec, bed.sb, 1, 0, 0)).toEqual([72, 36]);
    expect(alternateCellFrame(bed.rec, bed.sb, 1, 3, 1)).toEqual([126, 54]);
    const bath = anchorChainOf(90, 0)[1];
    expect(alternateCellFrame(bath.rec, bath.sb, 0, 0, 0)).toEqual([72, 0]);
    expect(alternateCellFrame(bath.rec, bath.sb, 0, 3, 1)).toEqual([126, 18]);
  });

  it('左向基档回归（placedAlt=null 路）：furnitureStyleBase 15/79/90 维持 40/36 带', () => {
    expect(furnitureStyleBase(15, 23, 1)).toEqual([0, 920]);
    expect(furnitureStyleBase(79, 1, 4)).toEqual([0, 36]);
    expect(furnitureStyleBase(90, 2, 4)).toEqual([0, 72]);
  });

  it('TF-08：压板/测重板纵向样式档（StyleHorizontal=false → Y 带）', () => {
    expect(furnitureStyleBase(135, 1, 1)).toEqual([0, 18]);   // 绿
    expect(furnitureStyleBase(135, 3, 1)).toEqual([0, 54]);   // 棕
    expect(furnitureStyleBase(428, 3, 1)).toEqual([0, 54]);   // 粉测重板
    expect(furnitureStyleBase(428, 0, 1)).toEqual([0, 0]);    // 橙（默认色）
  });
});

describe('BJ753-A Game 级端到端（tryPlace 放置帧 → breakTile 回收）', () => {
  it('TF-05：木床 224 朝右可放置（旧=0 格不消耗）,帧 = 72+18dx/18dy', () => {
    const { g, w, inv } = mkShell(224, 1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(224)]);
    const tid = sheetToTid(79);
    expect(tid).toBeGreaterThan(0);
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 2; dy++) {
      const i = st.idx(11 + dx, 18 + dy);
      expect(st.get(11 + dx, 18 + dy), `bed cell ${dx},${dy}`).toBe(tid);
      expect(st.frameX[i]).toBe(72 + dx * 18);
      expect(st.frameY[i]).toBe(dy * 18);
    }
    expect(inv.slots[0]!.stack).toBe(2);      // 消耗 1（3→2）
  });

  it('TF-05 对照：木床朝左（0+18dx/18dy）不受备档刀影响', () => {
    const { g, w } = mkShell(224, -1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(224)]);
    const tid = sheetToTid(79);
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 2; dy++) {
      const i = st.idx(11 + dx, 18 + dy);
      expect(st.get(11 + dx, 18 + dy)).toBe(tid);
      expect(st.frameX[i]).toBe(dx * 18);
      expect(st.frameY[i]).toBe(dy * 18);
    }
  });

  it('TF-06：木椅 34 朝右 frameX=18（旧=36 双计）,style0 带 0', () => {
    const { g, w } = mkShell(34, 1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(34)]);
    const tid = sheetToTid(15);
    expect(st.get(12, 18)).toBe(tid);
    expect(st.get(12, 19)).toBe(tid);
    expect(st.frameX[st.idx(12, 18)]).toBe(18);
    expect(st.frameY[st.idx(12, 18)]).toBe(0);
    expect(st.frameX[st.idx(12, 19)]).toBe(18);
    expect(st.frameY[st.idx(12, 19)]).toBe(18);
  });

  it('TF-06+07：蒸汽朋克椅 1708（style23）朝右 (18,920)/(18,938),挖回 1708 非 1706', () => {
    const { g, w, drops } = mkShell(1708, 1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(1708)]);
    expect(st.frameX[st.idx(12, 18)]).toBe(18);
    expect(st.frameY[st.idx(12, 18)]).toBe(920);      // 40×23（旧 38×23=874）
    expect(st.frameY[st.idx(12, 19)]).toBe(938);
    g.breakTile(12, 18, true, false, true);
    expect(drops.map((d) => d.key)).toContain(VANILLA_ITEM_KEY_BY_ID[1708]);
    expect(drops.map((d) => d.key)).not.toContain(VANILLA_ITEM_KEY_BY_ID[1706]);
  });

  it('TF-06：浴缸 336 朝右 72+18dx（旧=144 双计）', () => {
    const { g, w } = mkShell(336, 1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(336)]);
    const tid = sheetToTid(90);
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 2; dy++) {
      const i = st.idx(11 + dx, 18 + dy);
      expect(st.get(11 + dx, 18 + dy)).toBe(tid);
      expect(st.frameX[i]).toBe(72 + dx * 18);
      expect(st.frameY[i]).toBe(dy * 18);
    }
  });

  it('TF-06 对照：椅/浴缸朝左维持 0 带', () => {
    const a = mkShell(34, -1);
    for (let x = 6; x < 26; x++) a.w.store.setTileSilent(x, 20, STONE, 0, 0);
    a.g.tryPlace(12, 19, ITEM_DEFS[iidOf(34)]);
    expect(a.w.store.frameX[a.w.store.idx(12, 18)]).toBe(0);
    const b = mkShell(336, -1);
    for (let x = 6; x < 26; x++) b.w.store.setTileSilent(x, 20, STONE, 0, 0);
    b.g.tryPlace(12, 19, ITEM_DEFS[iidOf(336)]);
    expect(b.w.store.frameX[b.w.store.idx(11, 18)]).toBe(0);
    expect(b.w.store.frameX[b.w.store.idx(14, 19)]).toBe(54);
  });

  it('TF-08：绿压板 541 放 (0,18) 挖回绿（旧 (18,0) 挖回红 529）', () => {
    const { g, w, drops } = mkShell(541, 1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(541)]);
    const tid = sheetToTid(135);
    expect(st.get(12, 19)).toBe(tid);
    expect(st.frameX[st.idx(12, 19)]).toBe(0);
    expect(st.frameY[st.idx(12, 19)]).toBe(18);
    g.breakTile(12, 19, true, false, true);
    expect(drops.map((d) => d.key)).toContain(VANILLA_ITEM_KEY_BY_ID[541]);
    expect(drops.map((d) => d.key)).not.toContain(VANILLA_ITEM_KEY_BY_ID[529]);
  });

  it('TF-08：红压板 529 默认档 (0,0) 挖回 529（回归锁）', () => {
    const { g, w, drops } = mkShell(529, 1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(529)]);
    expect(st.frameX[st.idx(12, 19)]).toBe(0);
    expect(st.frameY[st.idx(12, 19)]).toBe(0);
    g.breakTile(12, 19, true, false, true);
    expect(drops.map((d) => d.key)).toContain(VANILLA_ITEM_KEY_BY_ID[529]);
  });

  it('TF-08：粉测重板 3626（style3）放 (0,54) 挖回粉（旧 (54,0) 挖回橙 3630）', () => {
    const { g, w, drops } = mkShell(3626, 1);
    const st = w.store;
    for (let x = 6; x < 26; x++) st.setTileSilent(x, 20, STONE, 0, 0);
    g.tryPlace(12, 19, ITEM_DEFS[iidOf(3626)]);
    const tid = sheetToTid(428);
    expect(st.get(12, 19)).toBe(tid);
    expect(st.frameX[st.idx(12, 19)]).toBe(0);
    expect(st.frameY[st.idx(12, 19)]).toBe(54);
    g.breakTile(12, 19, true, false, true);
    expect(drops.map((d) => d.key)).toContain(VANILLA_ITEM_KEY_BY_ID[3626]);
    expect(drops.map((d) => d.key)).not.toContain(VANILLA_ITEM_KEY_BY_ID[3630]);
  });
});
