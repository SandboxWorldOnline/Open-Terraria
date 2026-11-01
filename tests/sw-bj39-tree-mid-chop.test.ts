// ★SW-BJ39（2026-09-09）：砍树不砍根部偏差批（用户实报「不从根部砍会留下这些砍不掉」
// + 追加「理论上不能出现残树桩」）。
//
// 金标链（1457 反编译；1458 同域核对=零差异,diff 仅 dungeon-glass/mana/wings 面）：
//   · 砍击结算 = Player.cs:46120 `WorldGen.KillTile(x,y)`（单格,默认参=带掉落）
//     → KillTile 尾 SquareTileFrame(i,j)（WorldGen.cs:64432）→ TileFrame 3×3 派发
//     case 5 → CheckTree（:87152-87154 → :55045-55256）。
//   · CheckTree 级联方向 = 逐格上行（臂5c :55175-55192 num4==-1 杀失撑干格）;
//     切口以下残桩保留（下方仍有树干/草 → 臂1/5c 存活门通过）,并由臂3（:55125-55139）
//     与臂5d（:55193-55236）重帧为切口风格（无侧接 → (110, fy%66)）。
//   · 枝砍 = 只掉枝（臂5a/5b 只裁枝帧格自身的侧接;干格由臂3/5d 重帧,不杀）。
//   · 掉落账 = KillTile_GetTreeDrops（:66706-66768）逐格：每格 1 木 + bonusWood 骰
//     （genRand.Next(35)<=最近玩家斧力 || Main.rand.Next(3)==0,:66762-66768）;
//     冠/枝标记格（frameX>=22 && frameY>=198,含枝帧 44/66×fy198-242）逐格 50% 附橡实
//     27（TreeTypeDropsAcorns :63621 None/Mushroom/Jungle 不掉）。
// 仓库病灶（修复前探针 scripts/_bj39-tree-chop.mjs 实测 9 pass/4 fail）：
//   F1 枝砍连带杀干（fellTree 侧邻支 s=±1 命中切口行干格）+ 树干族缺席
//      DECOR_SUPPORT_KIND → 干格落入 checkFurnitureSupport 通用家具支撑校验
//      （framed+非 solid 1×1 下方非实心即杀）→ 上段被腰斩;
//   F2 残桩顶格不重帧（陈旧干身帧=悬空残件观感）;
//   F3 橡实只按倒下段顶格掷 1 次（原版逐格掷）。
// 修复：砍伐面单源化到演化域 CheckTree 级联核（WorldEvolution.killTileCascadeAt /
// tileFrameCascadeAt = killFlat→killDropFace→frameDependents 队列,同
// evolution-tree-cascade.test 核心）;Game 'tree'/'treebase' kind 委托。
// 变异证据：修复前同断言在探针 ②③ 组全红（F1/F2/F3 逐条）。
import { describe, it, expect } from 'vitest';
// ★BJ743-A（R24 SEV-2）：src 读改 ESM import 形经 fs-guard-shim 守卫（require 旁路收口）。
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { TILE_BY_KEY, T, TILE_DEFS } from '../src/data/tiles';
import { Game } from '../src/core/Game';
import { WorldEvolution } from '../src/world/evolution/WorldEvolution';

const TREE = T.TREE;                                  // 内部 id 8（sheet 5）
const GRASS = T.GRASS;

interface Shell {
  world: World; chunks: { markDirtyArea: () => void };
  spawnDrop: (x: number, y: number, key: string, n: number) => void;
  spawnParticles: () => void;
  sfx: { play: () => void };
  evolution: WorldEvolution;
  spawnKillDropItem: (vid: number, x: number, y: number, stack: number) => void;
  fellTree: (x: number, y: number) => void;
  fellImportedTree: (x: number, y: number, t: number) => void;
  checkDecorSquareFrame: (x: number, y: number) => void;
  canKillTile: (x: number, y: number) => boolean;
}

function shell(w: World, drops: Array<{ key: string; n: number }>): Shell {
  const g = Object.create(Game.prototype) as unknown as Shell;
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {} };
  g.spawnDrop = (_x, _y, key, n) => { drops.push({ key, n }); };
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

function ground(w: World, cx = 30, gy = 40): World {
  for (let x = 0; x < w.store.w; x++) w.store.setTileSilent(x, gy, GRASS, 0, 0);
  void cx;
  return w;
}

/** 合成树：干列全 (0,0) 体帧 + 顶格冠标记 (22,198)，便于断言重帧目标 (110,0) */
function buildTree(w: World, cx: number, gy: number, h: number): void {
  w.store.setTileSilent(cx, gy, GRASS, 0, 0);
  for (let i = 0; i < h; i++) {
    const y = gy - 1 - i;
    if (i === h - 1) w.store.setTileSilent(cx, y, TREE, 22, 198);
    else w.store.setTileSilent(cx, y, TREE, 0, 0);
  }
}

const tid = (w: World, x: number, y: number): number => w.store.get(x, y);
const frame = (w: World, x: number, y: number): string => {
  const i = w.store.idx(x, y);
  return `${w.store.frameX[i]},${w.store.frameY[i]}`;
};
const woodCount = (drops: Array<{ key: string; n: number }>): number =>
  drops.filter((d) => d.key === 'vi_9_Wood').reduce((a, d) => a + d.n, 0);
const acornCount = (drops: Array<{ key: string; n: number }>): number =>
  drops.filter((d) => d.key.startsWith('vi_27_')).reduce((a, d) => a + d.n, 0);

describe('SW-BJ39 ①枝砍：只掉枝，干与整树保留（原版臂5a/5b 只裁枝）', () => {
  it('砍侧枝 → 枝格消失、切口行干格保留、上方整树保留、只掉 1 格枝木', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    buildTree(w, 30, 40, 6);
    const branchY = 37;
    w.store.setTileSilent(29, branchY, TREE, 44, 198);   // 原版贴干枝帧
    shell(w, drops).fellTree(29, branchY);               // 砍枝（非干列）
    expect(tid(w, 29, branchY)).toBe(0);                 // 枝消失
    expect(tid(w, 30, branchY)).toBe(TREE);              // ★F1：干格保留（旧实现连带杀干）
    expect(frame(w, 30, branchY)).toBe('0,0');           // 干格原帧不动
    for (let y = 34; y <= 39; y++) {                     // 上方整树保留（旧实现腰斩悬空）
      expect(tid(w, 30, y), `trunk@${y}`).toBe(TREE);
    }
    expect(woodCount(drops)).toBe(2);                    // 枝木 1 格 ×2（bonusWood 斧骰,壳斧力 35 恒中）
  });

  it('★家具支撑链不再腰斩树干：邻格变化派发 tree kind → CheckTree 存活门放行', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    buildTree(w, 30, 40, 6);
    w.store.setTileSilent(31, 38, TREE, 66, 198);        // 右枝
    const g = shell(w, drops);
    // 模拟树旁格变化后的 SquareTileFrame 3×3 扫（修复前:framed+非solid 1×1
    // 下方非实心 → killDecorTile 腰斩整段）
    g.checkDecorSquareFrame(30, 38);
    for (let y = 34; y <= 39; y++) expect(tid(w, 30, y), `trunk@${y}`).toBe(TREE);
    expect(tid(w, 31, 38)).toBe(TREE);                   // 枝格自身有干接 → 存活
  });
});

describe('SW-BJ39 ②中砍：上段逐格倒 + 残桩保留 + 残桩顶格重帧', () => {
  it('切口以上整段倒（逐格掉木）,切口以下残桩保留,顶格重帧为切口风格 (110,0)', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    buildTree(w, 30, 40, 7);                             // 树 33..39,冠 33
    const cutY = 36;                                     // 中段（离地 3 格）
    shell(w, drops).fellTree(30, cutY);
    // 上段 = 33..36 全清
    for (let y = 33; y <= cutY; y++) expect(tid(w, 30, y), `fallen@${y}`).toBe(0);
    // 残桩 = 37..39 保留
    for (let y = cutY + 1; y <= 39; y++) expect(tid(w, 30, y), `stump@${y}`).toBe(TREE);
    // ★F2：残桩顶格重帧（CheckTree 臂5d :55193 无侧接 → fx=110, fy=fy%66=0）
    expect(frame(w, 30, cutY + 1)).toBe('110,0');
    // 残桩第二格不重帧（上方仍树干接续,num==type → 5d 跳过）
    expect(frame(w, 30, cutY + 2)).toBe('0,0');
    // 账目：倒下段 4 格,每格 1-2 木（bonusWood 斧骰,壳斧力 35 → Next(35)<=35 恒真 = 恒 2）
    expect(woodCount(drops)).toBe(8);                    // 4 格 ×2（:66762-66768）
    // 橡实：冠标记格（22,198）1 颗（TreeTypeDropsAcorns 森林基座可掉,50% 掷）
    expect(acornCount(drops)).toBeLessThanOrEqual(1);
  });

  it('★残桩可再砍（砍不掉回归门）：canKillTile 放行 + 再砍即掉账', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    buildTree(w, 30, 40, 6);
    shell(w, drops).fellTree(30, 37);                    // 先拦腰砍
    drops.length = 0;
    const g = shell(w, drops);
    expect(tid(w, 30, 39)).toBe(TREE);
    expect(g.canKillTile(30, 39)).toBe(true);            // 斧结门（Player.cs:46104）放行
    g.fellTree(30, 39);                                  // 再砍残桩顶格
    expect(tid(w, 30, 39)).toBe(0);
    // ★原版语义（臂1 :55107-55111 fx0|22|44&fy<=130 失地基杀 / 臂5c :55189 失撑杀）：
    // 残桩顶格被砍 → 其下支撑链逐格断（每格照掉账）——残桩不是永久悬桩
    expect(tid(w, 30, 38)).toBe(0);
    expect(tid(w, 30, 40)).toBe(GRASS);                  // 基座草不受牵连
    expect(woodCount(drops)).toBe(4);                    // 2 残格 ×2 bonus
  });

  it('基砍（对照组）：整树倒 + 登记表移除（世界生成树语义）', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    buildTree(w, 30, 40, 5);
    w.trees.push({ x: 30, y: 35, h: 5 });
    shell(w, drops).fellTree(30, 39);
    for (let y = 35; y <= 39; y++) expect(tid(w, 30, y)).toBe(0);
    expect(w.trees.length).toBe(0);
    expect(woodCount(drops)).toBe(10);                   // 5 格 ×2
  });
});

describe('SW-BJ39 ③橡实逐格门（冠/枝标记格 frameX>=22 && frameY>=198 逐格掷）', () => {
  it('枝帧格（44,198）被砍同掷橡实门（:66712 冠/枝帧同支）', () => {
    let acorns = 0;
    for (let t = 0; t < 24; t++) {
      const drops: Array<{ key: string; n: number }> = [];
      const w = ground(new World(60, 60, 30, 'open'));
      buildTree(w, 30, 40, 6);
      w.store.setTileSilent(29, 37, TREE, 44, 198);      // 枝帧 = 冠帧同门
      shell(w, drops).fellTree(29, 37);
      acorns += acornCount(drops);
    }
    expect(acorns).toBeGreaterThan(0);                   // 24×50% 全空 P=1/16777216
    expect(acorns).toBeLessThanOrEqual(24);
  });
});

describe('SW-BJ39 ④导入树族同核（fellImportedTree 委托同一级联）', () => {
  it('导入普通树（v_5_trees）中砍：上段倒/残桩保留/重帧/逐格账与自有树同', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    const V5 = TILE_BY_KEY['v_5_trees'];
    for (let i = 0; i < 6; i++) {
      const y = 39 - i;
      if (i === 5) w.store.setTileSilent(30, y, V5, 22, 198);
      else w.store.setTileSilent(30, y, V5, 0, 0);
    }
    shell(w, drops).fellImportedTree(30, 37, V5);
    for (let y = 34; y <= 37; y++) expect(tid(w, 30, y), `fallen@${y}`).toBe(0);
    for (let y = 38; y <= 39; y++) expect(tid(w, 30, y), `stump@${y}`).toBe(V5);
    expect(frame(w, 30, 38)).toBe('110,0');
    expect(woodCount(drops)).toBe(8);
  });
});

describe('SW-BJ39 ⑥ DECOR 派发面（邻域变化 → tree kind → tileFrameCascadeAt → CheckTree）', () => {
  // ★SW-RB9b（2026-09-09 审计补）：批次原 8 测只盖 fellTree/fellImportedTree 直调与
  // 「存活」方向——变异试验（撤 DECOR_SUPPORT_KIND `5: 'tree'` 一行）全 72 测仍绿
  // =Game 侧派发接线零判别力（kill 方向盲区）。本组补 DECOR 扫双方向。
  it('★变异证红锚：树基失撑（无登记表路径）→ 3×3 扫过即整树上行坍塌+逐格账', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    buildTree(w, 30, 40, 6);                           // 树 34..39,基座草 (30,40)
    const g = shell(w, drops);
    w.store.setTileSilent(30, 40, 0);                  // 挖基座（静默=模拟外域写不经监听）
    g.checkDecorSquareFrame(30, 40);                   // onTileChanged 3×3 扫等价
    for (let y = 34; y <= 39; y++) {                   // CheckTree 臂1/5c 上行整杀
      expect(tid(w, 30, y), `tree@${y}`).toBe(0);
    }
    expect(woodCount(drops)).toBe(12);                 // 6 格 ×2（壳斧力 35 → bonus 恒真）
  });

  it('存活方向：邻域扫过合法树（基座在）→ 零杀零掉（幂等复检）', () => {
    const drops: Array<{ key: string; n: number }> = [];
    const w = ground(new World(60, 60, 30, 'open'));
    buildTree(w, 30, 40, 6);
    shell(w, drops).checkDecorSquareFrame(30, 40);
    for (let y = 34; y <= 39; y++) expect(tid(w, 30, y), `tree@${y}`).toBe(TREE);
    expect(drops).toEqual([]);
  });
});

describe('SW-BJ39 ⑤变异对照：旧路径断言在新实现下的判别力（红→绿复核）', () => {
  it('行号锚：Game 砍伐面消费 killTileCascadeAt；演化域公共入口在位', () => {
    // ★SW-RB9b→BJ743-A：原 require('node:fs') 内联签名已废——顶部 ESM import 形
    //   经守卫（R24 SEV-2 require 旁路收口）,签名=原生 (p, enc?) => string。
    const game = readFileSync('src/core/Game.ts', 'utf8');
    expect(game).toContain('this.evolution.killTileCascadeAt(x, y);');
    expect(game).toContain("5: 'tree',");
    const evo = readFileSync('src/world/evolution/WorldEvolution.ts', 'utf8');
    expect(evo).toContain('killTileCascadeAt(x: number, y: number): boolean');
    expect(evo).toContain('tileFrameCascadeAt(cx: number, cy: number): void');
    void TILE_DEFS;
  });
});
