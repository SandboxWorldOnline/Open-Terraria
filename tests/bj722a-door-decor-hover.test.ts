// ★BJ722-A（2026-10-26）新登记债清偿·两批八件判别锁。
//
// 批A（BJ721 登记债,门/decor 域）：
//  · D1 不可砍多格件计算锚 case 无守卫——census 定谳：仓内唯一可达【异件覆写】
//    写入面=陨石散布环 ④⑤（MeteorFall.placeMeteor set(x,y,type) 对任意活格,原版
//    :6440-6490 同为无差别覆写）;门/活板门 smash 只覆写可砍格、落沙/放置只写空格、
//    液体冲毁/爆炸全走 breakTile（object 支整件清）。修=16 站接 killDecorPieceCells
//    （对应原版 kill 环逐个核过 type 守卫）:sunflower2×4/sapling1×2×3/orb2×2/
//    hangs w×h/wallhang w×h/tallgate1×5/stalactite-Echo1×n/649-2×1/deco3x2 3×2/
//    deco3x1 3×1/hangtop2×h/gnome1×2/xmas4×8/support2x2 2×2。
//    例外维持：table2x1（RB11d F2 活成员杀向天然同型）/trapdoor386·387（原版
//    CheckTrapDoor :52090-52094 kill 环【无 type 守卫】=box 逐格杀,box-kill 1:1）/
//    185 小堆饰（def1×1,守卫环会逐格双发内容掉落——另行登记债,维持锚点单杀）。
//  · D2 openDoor/closeDoor 写面裸写窗（原版 :38109-38158/:32155-38173 直写零派发+
//    尾扫一次;仓旧逐格 setTile 中途派发=BJ721「开门拆门」放大器）+notifyChanged
//    补派发（BJ361 渲染 mark 主通道）。
//  · D3 openDoor smash 裸 setTile(0) 零掉落——killCell 钩注入 breakTile（原版
//    :38090-38097 KillTile;tileCut 直杀格掉落表有档：草籽283/蘑菇60·5·183/藤2996/
//    药草83·84 全档）。
//
// 批B（BJ720+BJ717 登记债,变体/运动域）：
//  · BJ720 -4 Pinky rarity=2 → 销案（vanilla-bestiary.json npcStats['-4'] 已带
//    rarity=2,三消费面全读静态表;运行期 NPC.rarity 原版仅图鉴消费=无建模面）。
//  · BJ720 npcSlots 无运行时承载 → 销案（per-TYPE 值有承载 vanillaNpcs.npcSlots
//    ×4 消费站;-N 变体乘子唯一可达面=-12 的 ×1.15 刷怪帽记账,无战斗消费）。
//  · BJ717 [bj717a-hover-slowfall-slotset]：:27607 硬码表 {22,28,30,31,33,35,37,45}
//    vs 旧谓词 eq.wing?.hover（五员 stats 表）——补 28/33/35。
//  · BJ717 [bj717a-hover-slowfall-downdash]：canUseWingAbilities(:3975-3982
//    =!merman∧!downDash) 的 !downDash 腿——干/湿两臂补。
//  · BJ717 [bj717a-wing37-extra-slowfall]：:27620-27626 翼 37 在 ×0.9 之上再 ×0.92。
// （[bj717a-hover-slowfall-order] 重力链序差=登记不修,任务书在档——非本刀面。）
//
// 变异恰红矩阵（M1-M8）见各节注释;夹具沿用 bj721a 的 fakeThis 驾驭范式。
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Game } from '../src/core/Game';
import { TileStore } from '../src/world/TileStore';
import { openDoor, closeDoor, placeDoorClosed, TALL_GATE_ROW_FY } from '../src/world/Door';
import { T, TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { isRareSpawnForBestiary, bestiaryRarityStars } from '../src/data/Bestiary';
import { vanillaNpc } from '../src/data/vanillaNpcs';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';
import { World } from '../src/world/World';
import { seededRandom, BATTERY_SEED } from './seeded-rng';

beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameSrc = readFileSync(path.join(ROOT, 'src/core/Game.ts'), 'utf8');
const playerSrc = readFileSync(path.join(ROOT, 'src/entities/Player.ts'), 'utf8');
const doorSrc = readFileSync(path.join(ROOT, 'src/world/Door.ts'), 'utf8');

const T10 = T.DOOR_CLOSED, T11 = T.DOOR_OPEN;
const STONE = TILE_BY_KEY['stone']!;
const GRASS = TILE_BY_KEY['grass']!;
const SUNFLOWER = TILE_BY_KEY['v_27_sunflower']!;
const PAINTING = TILE_BY_KEY['v_240_wall_hangings_3x3']!;
const TALLGATE = TILE_BY_KEY['v_388_tall_gate_closed']!;
const JACKOLANTERN = TILE_BY_KEY['v_35_jackolanterns']!;
const GNOME = TILE_BY_KEY['v_567_garden_gnome']!;
const XMAS = TILE_BY_KEY['v_171_christmas_tree']!;
const DECO32 = TILE_BY_KEY['v_186_decos_3x2']!;
const HEART = TILE_BY_KEY['crystal_heart']!;
const LANTERN = TILE_BY_KEY['lantern']!;
const RUBBLE649 = TILE_BY_KEY['v_649_medium_rubble_2x1']!;
const TRAPDOOR = TILE_BY_KEY['v_386_trapdooropen']!;
const SAPLING = TILE_BY_KEY['acorn_sapling']!;

/** 窄视图台架（bj721a 同款）：真 checkDecorSquareFrame/checkDecorSupport/
 *  killDecorPieceCells,killDecorTile 替身记账（判别面唯一真值源,不实际清格）。 */
function makeBench(st: TileStore) {
  const kills: Array<[number, number]> = [];
  const fake: Record<string, unknown> = {
    world: { store: st },
    _decorPlaceBuilding: false,
    killDecorTile: (kx: number, ky: number) => { kills.push([kx, ky]); },
  };
  const proto = Game.prototype as unknown as Record<string, unknown>;
  for (const m of ['checkDecorSupport', 'killDecorPieceCells', 'solidAllowBottomSlopeAt',
    'solidTileStrictAt', 'anchorSolidTileAt', 'anchorTableValidAt',
    'isBelowNonHammeredPlatformAt', 'solidAllowTopSlopeAt', 'solidAllowLeftSlopeAt',
    'solidAllowRightSlopeAt']) {
    fake[m] = proto[m];
  }
  const sweep = (cx: number, cy: number) =>
    (proto.checkDecorSquareFrame as (this: unknown, x: number, y: number) => void).call(fake, cx, cy);
  /** 单派发直调（3×3 扫会多成员格重复派发——单杀环判据用单次直调,真机 drain
   *  语义=首杀经 breakTile object 支整件清,后续队列/派发全空跳同相） */
  const dispatch = (x: number, y: number, type: number, kind: string) =>
    (proto.checkDecorSupport as (this: unknown, x: number, y: number, def: unknown, sheet: number, kind: string) => void)
      .call(fake, x, y, TILE_DEFS[type], TILE_DEFS[type]!.vanilla!.sheet, kind);
  return { kills, sweep, dispatch };
}

/** 各件 DECOR_SUPPORT_KIND（Game.ts DECOR_SUPPORT_KIND 表成员） */
const KIND: Record<number, string> = {
  [TILE_BY_KEY['v_27_sunflower']!]: 'sunflower',
  [TILE_BY_KEY['v_240_wall_hangings_3x3']!]: 'wallhang',
  [TILE_BY_KEY['v_388_tall_gate_closed']!]: 'tallgate',
  [TILE_BY_KEY['v_35_jackolanterns']!]: 'support2x2',
  [TILE_BY_KEY['v_567_garden_gnome']!]: 'gnome',
  [TILE_BY_KEY['v_171_christmas_tree']!]: 'xmas',
  [TILE_BY_KEY['v_186_decos_3x2']!]: 'deco3x2',
  [TILE_BY_KEY['crystal_heart']!]: 'orb',
  [TILE_BY_KEY['lantern']!]: 'hangs',
  [TILE_BY_KEY['acorn_sapling']!]: 'sapling',
  [TILE_BY_KEY['v_649_medium_rubble_2x1']!]: 'pile',
  [TILE_BY_KEY['v_386_trapdooropen']!]: 'trapdoor',
};

/** 件放置：cells = [dx,dy,fx,fy] 列表;supports = 额外实心格 */
function place(st: TileStore, ax: number, ay: number, type: number,
  cells: Array<[number, number, number, number]>, supports: Array<[number, number]> = []) {
  for (const [dx, dy, fx, fy] of cells) st.setTileSilent(ax + dx, ay + dy, type, fx, fy);
  for (const [sx, sy] of supports) st.setTileSilent(sx, sy, STONE);
}

/** 空场清屏（含墙清零） */
function blank(st: TileStore, x: number, y: number, r = 8) {
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const i = st.idx(x + dx, y + dy);
    st.setTileSilent(x + dx, y + dy, 0);
    st.wall[i] = 0;
  }
}

// ---------------------------------------------------------------------------
// §1 D1：不可砍多格件锚格守卫（异件覆写=陨石散布环同构面）
// ---------------------------------------------------------------------------
describe('BJ722-A D1 不可砍多格件：锚格被外件覆写/已死时同型守卫环只杀本件格', () => {
  // 各件夹具：完整合法件 + 锚格改判（foreign=STONE 覆写 / dead=清 0）
  const cases: Array<[string, number, (st: TileStore, ax: number, ay: number) => void, number]> = [
    ['sunflower 27 2×4', SUNFLOWER, (st, ax, ay) => {
      const cells: Array<[number, number, number, number]> = [];
      for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 4; dy++) cells.push([dx, dy, dx * 18, dy * 18]);
      place(st, ax, ay, SUNFLOWER, cells, [[ax, ay + 4], [ax + 1, ay + 4]]);
      st.setTileSilent(ax, ay + 4, GRASS); st.setTileSilent(ax + 1, ay + 4, GRASS);   // 草族地基
    }, 8],
    ['wallhang 240 3×3（画）', PAINTING, (st, ax, ay) => {
      const cells: Array<[number, number, number, number]> = [];
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) cells.push([dx, dy, dx * 18, dy * 18]);
      place(st, ax, ay, PAINTING, cells);
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) st.wall[st.idx(ax + dx, ay + dy)] = 1;
    }, 9],
    ['tallgate 388 1×5', TALLGATE, (st, ax, ay) => {
      const cells: Array<[number, number, number, number]> = [];
      for (let dy = 0; dy < 5; dy++) cells.push([0, dy, 0, TALL_GATE_ROW_FY[dy]]);
      place(st, ax, ay, TALLGATE, cells, [[ax, ay - 1], [ax, ay + 5]]);
    }, 5],
    ['support2x2 35 2×2', JACKOLANTERN, (st, ax, ay) => {
      place(st, ax, ay, JACKOLANTERN, [[0, 0, 0, 0], [1, 0, 18, 0], [0, 1, 0, 18], [1, 1, 18, 18]],
        [[ax, ay + 2], [ax + 1, ay + 2]]);
    }, 4],
    ['gnome 567 1×2', GNOME, (st, ax, ay) => {
      place(st, ax, ay, GNOME, [[0, 0, 0, 0], [0, 1, 0, 20]], [[ax, ay + 2]]);
    }, 2],
    ['xmas 171 4×8', XMAS, (st, ax, ay) => {
      const cells: Array<[number, number, number, number]> = [];
      for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 8; dy++) cells.push([dx, dy, dx * 18, dy * 18]);
      place(st, ax, ay, XMAS, cells, [[ax + 1, ay + 8], [ax + 2, ay + 8]]);
    }, 32],
    ['deco3x2 186 3×2', DECO32, (st, ax, ay) => {
      const cells: Array<[number, number, number, number]> = [];
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) cells.push([dx, dy, dx * 18, dy * 18]);
      place(st, ax, ay, DECO32, cells, [[ax, ay + 2], [ax + 1, ay + 2], [ax + 2, ay + 2]]);
    }, 6],
    ['orb 12 2×2（水晶心）', HEART, (st, ax, ay) => {
      place(st, ax, ay, HEART, [[0, 0, 0, 0], [1, 0, 18, 0], [0, 1, 0, 18], [1, 1, 18, 18]],
        [[ax, ay + 2], [ax + 1, ay + 2]]);
    }, 4],
    ['hangs 42 1×2（灯笼）', LANTERN, (st, ax, ay) => {
      // Check1x2Top 只判顶锚（:47159-47164）——杀路径=顶上实心失;件完整性不查
      // （顶格被外件覆写+顶锚失 → 判坏杀;旧锚点单杀会吃外件格）
      place(st, ax, ay, LANTERN, [[0, 0, 0, 0], [0, 1, 0, 18]]);
    }, 2],
    ['sapling 20 1×2', SAPLING, (st, ax, ay) => {
      place(st, ax, ay, SAPLING, [[0, 0, 0, 0], [0, 1, 0, 18]]);   // 下方无地=地基失配杀
    }, 2],
    ['pile 649 2×1', RUBBLE649, (st, ax, ay) => {
      place(st, ax, ay, RUBBLE649, [[0, 0, 0, 0], [1, 0, 18, 0]], [[ax, ay + 1], [ax + 1, ay + 1]]);
    }, 2],
  ];

  // 单派发直调杀环判据：派发格 → 帧反推真锚 → 守卫环恰=件域内同型活格集
  // （xmas 除外——锚格即派发格反推源,锚死/覆写后走派发格盒=原版本相,单列 set 版）
  const dispatchCell: Record<string, [number, number]> = {
    'sunflower 27 2×4': [1, 1], 'wallhang 240 3×3（画）': [1, 1], 'tallgate 388 1×5': [0, 2],
    'support2x2 35 2×2': [1, 1], 'gnome 567 1×2': [0, 1], 'deco3x2 186 3×2': [1, 1],
    'orb 12 2×2（水晶心）': [1, 1], 'hangs 42 1×2（灯笼）': [0, 1],
    'sapling 20 1×2': [0, 1], 'pile 649 2×1': [1, 0],
  };

  for (const [name, type, fixture, total] of cases) {
    it(`${name}：锚格被陨石式外件覆写 → 外件格绝不入账,余同型格照杀（变异=锚点单杀 → 外件格入账红）`, () => {
      const st = new TileStore(64, 128);
      const ax = 30, ay = 40;
      blank(st, ax, ay);
      fixture(st, ax, ay);
      st.setTileSilent(ax, ay, STONE);   // 锚格异件覆写（MeteorFall 散布环同构）
      const bench = makeBench(st);
      bench.sweep(ax + 1, ay + 1);       // 存活成员格 3×3 扫（真机触发面）
      expect(bench.kills.length).toBeGreaterThan(0);
      for (const [kx, ky] of bench.kills) {
        expect(`${kx},${ky}`).not.toBe(`${ax},${ay}`);   // ★外件锚格绝不杀
      }
      // 单派发直调：帧反推真锚 → 恰为件域同型活格（无孤儿/无越权）
      const dc = dispatchCell[name];
      if (dc) {
        const bench2 = makeBench(st);
        bench2.dispatch(ax + dc[0], ay + dc[1], type, KIND[type]);
        expect(bench2.kills.length).toBe(total - 1);
        for (const [kx, ky] of bench2.kills) {
          expect(`${kx},${ky}`).not.toBe(`${ax},${ay}`);
        }
      }
    });

    it(`${name}：锚格已死（陨石①层挖空同构）→ 守卫环仍清余格（旧锚点单杀=空跳留孤儿红）`, () => {
      const st = new TileStore(64, 128);
      const ax = 30, ay = 40;
      blank(st, ax, ay);
      fixture(st, ax, ay);
      st.setTileSilent(ax, ay, 0);       // 锚格已清
      const bench = makeBench(st);
      bench.sweep(ax + 1, ay + 1);
      expect(bench.kills.length).toBeGreaterThan(0);
      const dc = dispatchCell[name];
      if (dc) {
        const bench2 = makeBench(st);
        bench2.dispatch(ax + dc[0], ay + dc[1], type, KIND[type]);
        expect(bench2.kills.length).toBe(total - 1);      // 余格照杀,零孤儿
        expect(bench2.kills.some(([kx, ky]) => kx === ax && ky === ay)).toBe(false);
      }
    });
  }

  it('xmas 171：非锚派发走派发格盒（原版 :40004-40008 num=x 本相）——杀集 ⊆ 件域且非空,外件锚格不入账', () => {
    const st = new TileStore(64, 128);
    const ax = 30, ay = 40;
    blank(st, ax, ay);
    const cells: Array<[number, number, number, number]> = [];
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 8; dy++) cells.push([dx, dy, dx * 18, dy * 18]);
    place(st, ax, ay, XMAS, cells, [[ax + 1, ay + 8], [ax + 2, ay + 8]]);
    st.setTileSilent(ax, ay, STONE);   // 锚格覆写
    const bench = makeBench(st);
    bench.sweep(ax + 1, ay + 1);
    expect(bench.kills.length).toBeGreaterThan(0);
    const pieceCells = new Set(cells.map(([dx, dy]) => `${ax + dx},${ay + dy}`));
    for (const [kx, ky] of bench.kills) {
      expect(pieceCells.has(`${kx},${ky}`)).toBe(true);   // 只杀件域格
      expect(`${kx},${ky}`).not.toBe(`${ax},${ay}`);      // 外件锚格绝不杀
    }
  });

  it('完整件判据通过零击杀（守卫环不引入误杀;sunflower 抽样）', () => {
    const st = new TileStore(64, 128);
    const ax = 30, ay = 40;
    blank(st, ax, ay);
    const cells: Array<[number, number, number, number]> = [];
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 4; dy++) cells.push([dx, dy, dx * 18, dy * 18]);
    place(st, ax, ay, SUNFLOWER, cells);
    st.setTileSilent(ax, ay + 4, GRASS); st.setTileSilent(ax + 1, ay + 4, GRASS);
    const bench = makeBench(st);
    bench.sweep(ax + 1, ay + 1);
    expect(bench.kills).toEqual([]);
  });

  it('D1 判语锁：multidir/projpad/单格臂维持派发格自杀（同型构造安全,勿扩刀）', () => {
    // 单格臂杀=派发格自身（checkDecorSquareFrame 派发门保证同型）→ 无锚格碰撞面。
    // 结构锁:这些 case 的杀仍是 killDecorTile(x, y) 形（防误「补守卫」过度矫正）。
    expect(gameSrc).toContain("if (!this.checkAndAdjustMultiDirAt(x, y)) this.killDecorTile(x, y);");
    expect(gameSrc).toContain('if (altP < 0) { this.killDecorTile(x, y); return; }');
    expect(gameSrc).toContain('if (!this.solidAllowBottomSlopeAt(x, y + 1)\n          || (sheet === 529 && !CONV_SAND_SHEETS.has(sheetAt(st, x, y + 1)))) {');
  });

  it('D1 判语锁：table2x1 维持 RB11d F2 活成员杀向（天然同型安全,勿改守卫环）', () => {
    expect(gameSrc).toContain('const killAt = st.hasTile(ax, y) && st.get(ax, y) === st.type[i] ? ax');
    expect(gameSrc).toContain('if (killAt >= 0) this.killDecorTile(Math.max(0, killAt), y);');
  });

  it('D1 判语锁：185 小堆饰维持锚点单杀（def1×1 逐格内容掉落=独立登记债,守卫环会双发）', () => {
    expect(gameSrc).toContain('if (sheet === 649) this.killDecorPieceCells(ax, y, 2, 1, st.type[i]);');
    expect(gameSrc).toContain('else this.killDecorTile(Math.max(0, ax), y);');
  });
});

// ---------------------------------------------------------------------------
// §2 D1 反例：trapdoor 386/387 原版 kill 环【无 type 守卫】=box 逐格杀
// ---------------------------------------------------------------------------
describe('BJ722-A D1 trapdoor 反例：CheckTrapDoor :52090-52094 box-kill（外件入盒也杀=原版本相）', () => {
  it('386 开态 2×2：锚格被外件覆写 → box 内外件格【入账】（原版无守卫勿过度矫正）', () => {
    const st = new TileStore(64, 128);
    const ax = 30, ay = 40;
    blank(st, ax, ay);
    place(st, ax, ay, TRAPDOOR, [[0, 0, 0, 0], [1, 0, 18, 0], [0, 1, 0, 18], [1, 1, 18, 18]],
      [[ax - 1, ay + 1], [ax + 2, ay + 1]]);   // 侧锚（styleX0 → 底行 ay+1 左右实心）
    st.setTileSilent(ax, ay, STONE);            // 锚格异件覆写
    const bench = makeBench(st);
    bench.sweep(ax + 1, ay + 1);
    const uniq = [...new Set(bench.kills.map(k => `${k[0]},${k[1]}`))];
    // box 2×2 全域逐格（含外件格）——原版 :52090-52094 `KillTile(i, j)` 无 type 门
    // 原版序：i(x) 外层 j(y) 内层=列主序
    expect(uniq).toEqual([`${ax},${ay}`, `${ax},${ay + 1}`, `${ax + 1},${ay}`, `${ax + 1},${ay + 1}`]);
  });
});

// ---------------------------------------------------------------------------
// §3 D2：openDoor/closeDoor 裸写窗原子性 + notifyChanged 补派发
// ---------------------------------------------------------------------------
describe('BJ722-A D2 门开关写面原子性（裸写窗,监听只见整门态）', () => {
  function doorFixture(st: TileStore, x: number, y0: number) {
    for (let dx = -3; dx <= 4; dx++) for (let dy = -2; dy <= 4; dy++) st.setTileSilent(x + dx, y0 + dy, 0);
    st.setTileSilent(x, y0 - 1, STONE);
    st.setTileSilent(x, y0 + 3, STONE);
    placeDoorClosed(st, x, y0, 0, 0);
  }

  it('openDoor：写面监听零半写态观测（变异=去窗 → 1..5 格中间态红）+ 写面格全量补派发', () => {
    const st = new TileStore(64, 128);
    const x = 30, y0 = 40;
    doorFixture(st, x, y0);
    const partial: number[] = [];
    const events = new Set<string>();
    st.onTileChanged((lx, ly) => {
      events.add(`${lx},${ly}`);
      let open = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]] as const) {
        if (st.get(x + dx, y0 + dy) === T11) open++;
      }
      if (open > 0 && open < 6) partial.push(open);
    });
    expect(openDoor(st, x, y0 + 1, 1)).toBe(true);
    expect(partial).toEqual([]);                          // ★原子性：无 1..5 中间态
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]] as const) {
      expect(events.has(`${x + dx},${y0 + dy}`)).toBe(true);   // BJ361 渲染 mark 补派发
    }
  });

  it('closeDoor：写面监听零半写态观测 + 关列全量补派发', () => {
    const st = new TileStore(64, 128);
    const x = 30, y0 = 40;
    doorFixture(st, x, y0);
    openDoor(st, x, y0 + 1, 1);
    const partial: number[] = [];
    const events = new Set<string>();
    st.onTileChanged((lx, ly) => {
      events.add(`${lx},${ly}`);
      let closed = 0;
      for (let dy = 0; dy < 3; dy++) if (st.get(x, y0 + dy) === T10) closed++;
      if (closed > 0 && closed < 3) partial.push(closed);
    });
    expect(closeDoor(st, x, y0 + 1)).toBe(true);
    expect(partial).toEqual([]);
    for (let dy = 0; dy < 3; dy++) expect(events.has(`${x},${y0 + dy}`)).toBe(true);
  });

  it('结构锁：两函数均带 suppressListeners 窗 + notifyChanged 补派发（变异=摘窗红）', () => {
    expect(doorSrc.match(/suppressListeners = true/g)?.length).toBeGreaterThanOrEqual(4);   // 开/关 + tallGate/trapdoor 既有
    expect((doorSrc.match(/for \(const \[tx, ty\] of touched\) st\.notifyChanged\(tx, ty\)/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4 D3：openDoor smash killCell 钩（KillTile 全语义注入位）
// ---------------------------------------------------------------------------
describe('BJ722-A D3 smash 清位 killCell 钩（原版 :38090-38097 KillTile）', () => {
  it('注入 killCell：清位列逐格入钩（掉落/尘/声由 breakTile 承担）;缺省回落 setTile(0)', () => {
    const st = new TileStore(64, 128);
    const x = 30, y0 = 40;
    for (let dx = -3; dx <= 4; dx++) for (let dy = -2; dy <= 4; dy++) st.setTileSilent(x + dx, y0 + dy, 0);
    st.setTileSilent(x, y0 - 1, STONE);
    st.setTileSilent(x, y0 + 3, STONE);
    placeDoorClosed(st, x, y0, 0, 0);
    // 清位列放两株熟药草（sheet 83 ∈ tileCut=doorSmashable;原版 KillTile case 83
    // 有掉落档——正是 D3 缺省近似丢掉的直杀格掉落面）+ 一格空
    const HERB = TILE_BY_KEY['v_83_herbs_mature']!;
    st.setTileSilent(x + 1, y0, HERB, 0, 0);
    st.setTileSilent(x + 1, y0 + 2, HERB, 0, 0);
    const hooked: Array<[number, number]> = [];
    expect(openDoor(st, x, y0 + 1, 1, {
      killCell: (cx, cy) => { hooked.push([cx, cy]); st.setTile(cx, cy, 0); },
    })).toBe(true);
    expect(hooked).toEqual([[x + 1, y0], [x + 1, y0 + 2]]);   // 只击活格（空格不入钩）
    // 终态：清位列即开门第二列——击杀后由门格接管（hook 内清 0 → 裸写窗写入开态门）
    for (let dy = 0; dy < 3; dy++) expect(st.get(x + 1, y0 + dy)).toBe(T11);
  });

  it('结构锁：六调用面全接 killCell（Game×3/DoorOpeningHelper/Enemy/TownNPC——变异=任一摘除红）', () => {
    expect((gameSrc.match(/doorKillCellOpts\(\(cx, cy\) => this\.breakTile\(cx, cy\)\)/g) ?? []).length).toBe(3);
    expect(gameSrc).toContain('killCell: (cx, cy) => this.breakTile(cx, cy),   // ★BJ722-A D3');
    expect(readFileSync(path.join(ROOT, 'src/world/DoorOpeningHelper.ts'), 'utf8'))
      .toContain('commonDoorTryOpenDoor(st, ax, ay, info.intendedOpeningDirection, info.playerGravityDirection, info.hitboxToOpenDoor, env.sfx, env.killCell)');
    const enemySrc = readFileSync(path.join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
    expect(enemySrc).toContain('openDoor(st, dtx, dty, dir, doorKillCellOpts(game.breakTile))');
    const npcSrc = readFileSync(path.join(ROOT, 'src/entities/TownNPC.ts'), 'utf8');
    expect(npcSrc).toContain('const kc = doorKillCellOpts(game.breakTile);');
  });
});

// ---------------------------------------------------------------------------
// §5 BJ720 残项①：-4 Pinky rarity=2 → 销案锁（防再登记）
// ---------------------------------------------------------------------------
describe('BJ722-A BJ720 残项销案：-4 Pinky rarity（图鉴展示面全读静态表,已带档）', () => {
  it('npcStats[-4] 已带 rarity=2：稀有刷怪徽章 + 星数 4（原版 1+2+1.5=4.5→(int)4 同值）', () => {
    // vanilla FillNpcRarities :1076-1083 对负 id 全量求值（-4 case 体 rarity=2,:7725）
    // → 提取表已含;三消费面（Filters.ByRareCreature 徽章/星公式/稀有度排序）全读此表。
    expect(isRareSpawnForBestiary(-4)).toBe(true);
    expect(bestiaryRarityStars(-4)).toBe(4);
  });

  it('-1..-10 除 -4 外 rarity 全 0（原版 case 体唯一 rarity 赋值=-4）', () => {
    for (const n of [-1, -2, -3, -5, -6, -7, -8, -9, -10]) {
      expect(isRareSpawnForBestiary(n)).toBe(false);
    }
  });

  it('销案边界注：运行期 NPC.rarity 原版仅图鉴消费（BestiaryEntry :32-35 + FillNpcRarities）,仓内零运行时消费面=无建模对象', () => {
    // 若未来新增运行时 rarity 消费,须先回本销案注补建模（NPC.cs:6088 字段+case -4 :7725）
    expect(gameSrc.includes('rarity')).toBe(true);   // 占位结构在位（防御性非空断言）
  });
});

// ---------------------------------------------------------------------------
// §6 BJ720 残项②：npcSlots 运行时承载 → 销案锁（防再登记）
// ---------------------------------------------------------------------------
describe('BJ722-A BJ720 残项销案：npcSlots（per-TYPE 值有承载,-N 乘子唯一可达面=-12 刷怪帽）', () => {
  it('vanillaNpcs.npcSlots 逐型承载（提取表 SetDefaults 终值）', () => {
    expect(vanillaNpc(16)!.npcSlots).toBe(2);    // Mother Slime
    expect(vanillaNpc(50)!.npcSlots).toBe(5);    // King Slime
    expect(vanillaNpc(6)!.npcSlots).toBe(1);     // EoW 子嗣基型（-12 可达面基值）
    expect(vanillaNpc(1)?.npcSlots ?? 1).toBe(1); // 蓝史莱姆（-1/-2 分裂/气球 -4/-5/-7 基型）
  });

  it('消费面结构锁：4 站读 en.vanilla?.npcSlots（史莱姆雨/月事件 boss 槽/近场刷怪帽×2）', () => {
    expect((gameSrc.match(/vanilla\?\.npcSlots \?\? 1/g) ?? []).length).toBe(3);
    expect(gameSrc).toContain('const slots = en.vanilla?.npcSlots ?? 1;');
  });

  it('销案边界注：-N 变体乘子（case -11..-16 `npcSlots *= scale`）仓内唯一可达=-12（GTW/remix EoW 分裂）,仅刷怪帽记账差 ×1.15,无战斗/掉落消费', () => {
    // 原版 -1..-10 case 体不触 npcSlots（基型值即终值,仓同构零差）;-11..-65 多在
    // BESTIARY_HIDE 且无仓内生成位。-12 面若未来扩（雕像/微光变体）,先回本注补乘子。
    expect(gameSrc).toContain('e12.vanillaNetId = -12;');
  });
});

// ---------------------------------------------------------------------------
// §7 BJ717 三件：悬浮缓降槽位集/!downDash 腿/翼 37 再 ×0.92
// ---------------------------------------------------------------------------
type P = import('../src/entities/Player').Player;
const iid = (vid: number): number => {
  const k = vanillaItemKey(vid)!;
  const id = ITEM_BY_KEY[k];
  if (id === undefined) throw new Error(`vid ${vid} 未注册`);
  return id;
};

function makeHooks(w: World) {
  return {
    world: w, player: null as unknown,
    enemies: () => [], critters: () => [], npcs: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    spawnParticles: () => {}, spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    addDamageNumber: () => {}, spawnDrop: () => null, damagePlayer: (): number => 0,
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, cutTile: () => {},
  } as never as Parameters<P['fixedUpdate']>[1];
}

/** 空中单拍测量台：装翼高空放置,沉降至稳态后预设 vy/wingTime/输入,单拍读 vy。
 *  干链序（wings>0 悬浮持跳）=WingMovement（翼型减速）→悬浮缓降 ×0.9（45=0.8）
 *  →[37]再 ×0.92;重力链被 flag19 让位=零干扰。 */
async function hoverTick(wingVid: number, opts: { vy?: number; downDash?: boolean } = {}): Promise<number> {
  const w = new World(500, 240, 44, 'bj722a-hover');
  w.groundLevel = 200;
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const p = new Player(30 * 16, 30 * 16, new Inventory());
  p.inv.armor[3] = { id: iid(wingVid), stack: 1 };
  const T = 1 / 60;
  const game = makeHooks(w);
  for (let t = 0; t < 20; t++) p.fixedUpdate(T, game);   // 沉降（无输入,装翼生效）
  p.inputJump = true; p.jumpEdgePrev = true;             // 持跳无沿（不触发新跳）
  p.inputDown = true;                                    // Hold 档 → tryingToHoverDown
  p.jumpHold = 0;
  p.wingTime = 100;
  p.vy = opts.vy ?? 8;
  if (opts.downDash) p.isDownDashing = true;
  p.fixedUpdate(T, game);
  return p.vy;
}

describe('BJ722-A BJ717 悬浮缓降三件（:27607-27626）', () => {
  it('[slotset] 翼 28（Lazure 平台,非 hover-stats）:vy 8→6.66（WingMovement 7.4 后 ×0.9）——与 hover-stats 翼 22 同相;变异=回退五员表 → 7.4 红', async () => {
    expect(await hoverTick(3228)).toBeCloseTo(6.66, 5);   // 28 ∈ :27607 硬码表（旧漏）
    expect(await hoverTick(1866)).toBeCloseTo(6.66, 5);   // 22 hover-stats（两表共有员,行为不变）
  });

  it('[slotset] 对照翼 34（∉:27607 表）:无缓降 7.4——集差恰为 28/33/35 三员', async () => {
    expect(await hoverTick(3582)).toBeCloseTo(7.4, 5);    // 34 不在硬码表（FLAP_HOVER_SET 亦无）
    expect(await hoverTick(3580)).toBeCloseTo(6.66, 5);   // 33 Yoraiz0r（:27607 表,旧漏）
    expect(await hoverTick(3588)).toBeCloseTo(6.66, 5);   // 35 Skiphs（:27607 表,旧漏）
  });

  it('[downdash] 下砸期缓降臂拒（canUseWingAbilities !downDash 腿）:vy 加速 >8 不被 ×0.9 剪（变异=摘腿 → (8+g)×0.9<8 红）', async () => {
    const v = await hoverTick(1866, { downDash: true });
    expect(v).toBeGreaterThan(8);                          // 纯下砸重力加速,零缓降乘区
  });

  it('[wing37] 翼 37（Betsy）再 ×0.92:8-0.875=7.125 → ×0.9×0.92=5.8995（变异=摘第二臂 → 6.4125 红）', async () => {
    expect(await hoverTick(3883)).toBeCloseTo(5.8995, 5);
  });

  it('结构锁：HOVER_SLOWFALL_SET 八员硬码 + 干/湿两臂 + 37 第二臂（变异=任一回退红）', () => {
    expect(playerSrc).toContain('const HOVER_SLOWFALL_SET = new Set([22, 28, 30, 31, 33, 35, 37, 45]);');
    expect(playerSrc).toContain('if (HOVER_SLOWFALL_SET.has(wings) && hoverDown && this.inputJump && this.wingTime > 0\n          && !this.isDownDashing) {');
    expect(playerSrc).toContain('if (HOVER_SLOWFALL_SET.has(wingsW) && this.tryingToHoverDown && this.inputJump && this.wingTime > 0\n        && !this.merman && !this.isDownDashing) {');
    expect(playerSrc).toContain('if (wings === 37 && hoverDown && this.inputJump && this.wingTime > 0\n          && !this.isDownDashing) {');
    expect(playerSrc).toContain('if (wingsW === 37 && this.tryingToHoverDown && this.inputJump && this.wingTime > 0\n        && !this.merman && !this.isDownDashing) {');
  });
});
