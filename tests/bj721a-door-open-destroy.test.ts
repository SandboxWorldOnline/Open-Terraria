// ★BJ721-A（2026-10-25）「某些情况下的木门在被打开时会直接拆除变成掉落物」定谳锁。
//  病灶（v5 探针栈定谳,scripts/_bj721a-door-open-destroy-v5.mjs）：门清位列被可砍
//  多格 DECOR 件（瓦罐 28 等 tileCut 族）占位时——openDoor smash 裸清件占位列 →
//  2×3 开门写面逐格 setTile 中途派发 onTileChanged → checkDecorSquareFrame 3×3 扫
//  到件残格 → checkDecorSupport 完整性判坏 → 旧 killDecorTile(锚格) 无类型守卫 →
//  锚格恰为刚写好的开态门格（≠0 不早退）→ breakTile 落门格 → clearDoorAt 整扇拆+
//  掉落,写循环继续产出孤儿开态残格（地狱房屋 6/30 扇开门即拆,含 style19 黑曜石
//  门——原版 TOD subs{19:[0,0]} 岩浆豁免件被无端销毁）。
//  原版锚：CheckPot :57345-57354 / CheckJunglePlant :48452-48462 /
//  CheckStalactite :39506-39511 等全族击杀环均为 `type==件型 && active()` 逐格守卫。
//  修刀：killDecorPieceCells(ax,ay,w,h,type) 同型守卫击杀环（首格=锚格,完整件行为
//  与旧锚点单杀同相;外件占位格跳过）,接入 8 个可砍多格计算锚 case。
//  判别面：killDecorTile 替身记账——目标格必须 ⊆ 件自身格;门格（开态 2×3 域）绝不
//  入账。变异（任一 case 回退锚点单杀）→ 门格入账即红。
//  夹具几何=真实复现同构：件占门行下两格（y0+1..y0+2）,支撑行在门底行之下（y0+3）
//  ——不堵门清位列（门行 y0..y0+2 须可砍/空）。
// fakeThis 驾驭（全仓 0 处 new Game()——prototype .call 窄视图,bj569 同款）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { Game } from '../src/core/Game';
import { TileStore } from '../src/world/TileStore';
import { openDoor } from '../src/world/Door';
import { T, TILE_BY_KEY } from '../src/data/tiles';

const T10 = T.DOOR_CLOSED, T11 = T.DOOR_OPEN;
const STONE = TILE_BY_KEY['stone']!;
const DIRT = TILE_BY_KEY['dirt'] ?? 1;
const POT = TILE_BY_KEY['pot']!;
const PUMPKIN = TILE_BY_KEY['v_254_pumpkin_plant']!;

/** 合成门道：门列 x 行 y0..y0+2（style/variant），顶/底石；侧件 2×2 占门行下两格
 *  （dir=+1 → 右侧 x+1..x+2；dir=-1 → 左侧 x-2..x-1），件底支撑行（y0+3）实心。 */
function mkFixture(st: TileStore, x: number, y0: number, style: number, variant: number,
  dir: 1 | -1, piece: number) {
  for (let dx = -3; dx <= 4; dx++) for (let dy = -2; dy <= 4; dy++) st.setTileSilent(x + dx, y0 + dy, 0);
  st.setTileSilent(x, y0 - 1, STONE);
  st.setTileSilent(x, y0 + 3, STONE);
  const col = Math.floor(style / 36), row = style % 36;
  const fx = variant + 54 * col;   // variant 传像素值(0/18/36),doorClosedFrame 同式
  for (let dy = 0; dy < 3; dy++) st.setTileSilent(x, y0 + dy, T10, fx, 54 * row + dy * 18);
  // 侧件 2×2（style0 帧）：占门行下两格（顶行 fy=0 在 y0+1）,锚列=门清位列
  const px = dir === 1 ? x + 1 : x - 2;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
    st.setTileSilent(px + dx, y0 + 1 + dy, piece, dx * 18, dy * 18);
  }
  // 件底支撑（y0+3,门底行之下）：pot 要 SolidTile2（石）；pumpkin 要顶坡可+草族（泥 2）
  const ground = piece === PUMPKIN ? DIRT : STONE;
  st.setTileSilent(px, y0 + 3, ground);
  st.setTileSilent(px + 1, y0 + 3, ground);
  return px;
}

/** 窄视图台架：真 checkDecorSquareFrame/checkDecorSupport/killDecorPieceCells,
 *  killDecorTile 替身记账（判别面唯一真值源,不实际清格）。 */
function makeBench(st: TileStore) {
  const kills: Array<[number, number]> = [];
  const fake: Record<string, unknown> = {
    world: { store: st },
    _decorPlaceBuilding: false,
    killDecorTile: (kx: number, ky: number) => { kills.push([kx, ky]); },
  };
  const proto = Game.prototype as unknown as Record<string, unknown>;
  fake.checkDecorSupport = proto.checkDecorSupport;
  fake.killDecorPieceCells = proto.killDecorPieceCells;
  fake.solidAllowBottomSlopeAt = proto.solidAllowBottomSlopeAt;   // pumpkin 草族支撑臂
  const sweep = (cx: number, cy: number) =>
    (proto.checkDecorSquareFrame as (this: unknown, x: number, y: number) => void).call(fake, cx, cy);
  return { kills, sweep };
}

/** 开门 + 模拟监听派发（openDoor 逐格 setTile 真机内即时触发 onTileChanged →
 *  checkDecorSquareFrame;此处对 smash 清格与写面 9 格补派发=同覆盖域）。 */
function driveOpen(st: TileStore, x: number, y0: number, clickRow: number, dir: 1 | -1) {
  const bench = makeBench(st);
  const ok = openDoor(st, x, y0 + clickRow, dir);
  const ax = dir === -1 ? x - 1 : x;
  for (let dy = 0; dy < 3; dy++) bench.sweep(x + dir, y0 + dy);              // smash 清格派发
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) bench.sweep(ax + dx, y0 + dy);  // 写面派发
  return { ok, kills: bench.kills, ax };
}

describe('BJ721-A 开门不拆门：可砍多格 DECOR 件占清位列的同型守卫击杀环', () => {
  // 参数化扫描：门材质 × 变体 × 点击行 × 开向 × 侧件族——「某些情况」全矩阵
  const styles: Array<[number, string]> = [[0, '木门'], [5, 'style5'], [19, '黑曜石门'], [48, 'style48']];
  for (const [style, tag] of styles) {
    for (const variant of [0, 18, 36]) {
      for (const clickRow of [0, 1, 2]) {
        for (const dir of [1, -1] as const) {
          for (const [piece, pname] of [[POT, '瓦罐28'], [PUMPKIN, '南瓜254']] as const) {
            const nm = `${tag} v${variant} r${clickRow} dir${dir} ${pname}`;
            it(`${nm}：开门成 + 门格零击杀 + 件残格照杀`, () => {
              const st = new TileStore(64, 128);
              const x = 30, y0 = 40;
              const px = mkFixture(st, x, y0, style, variant, dir, piece);
              const { ok, kills, ax } = driveOpen(st, x, y0, clickRow, dir);
              // ① 开门成：2×3 全开态、帧面原版式（OpenDoor :38107-38158）
              expect(ok).toBe(true);
              const col = Math.floor(style / 36), row = style % 36;
              const baseFx = 72 * col + (dir === -1 ? 36 : 0);
              for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) {
                const i = st.idx(ax + dx, y0 + dy);
                expect(st.type[i], `${nm} (${ax + dx},${y0 + dy})`).toBe(T11);
                expect(st.frameX[i]).toBe(baseFx + dx * 18);
                expect(st.frameY[i]).toBe(54 * row + dy * 18);
              }
              // ② 判别锁：击杀目标 ⊆ 件自身 2×2 格
              const pieceCells = new Set([0, 1, 2, 3].map(k => `${px + (k % 2)},${y0 + 1 + Math.floor(k / 2)}`));
              expect(kills.length).toBeGreaterThan(0);
              for (const [kx, ky] of kills) {
                expect(pieceCells.has(`${kx},${ky}`), `${nm} 击杀越权 (${kx},${ky})`).toBe(true);
              }
              // ③ 件非占位侧残格被照杀（不 orphan；占位侧已被门覆写为门格）
              const remnantCol = dir === 1 ? px + 1 : px;
              expect(kills.some(([kx]) => kx === remnantCol)).toBe(true);
              // ④ 门域零击杀显式断言（变异=锚点单杀时占位列两门格入账 → 红）
              //    门域=开态 2×3 精确跨度（dir+1 → x..x+1;dir-1 → x-1..x）
              const doorDomain = new Set<string>();
              for (let dx = (dir === 1 ? 0 : -1); dx <= (dir === 1 ? 1 : 0); dx++) {
                for (let dy = 0; dy < 3; dy++) doorDomain.add(`${x + dx},${y0 + dy}`);
              }
              for (const [kx, ky] of kills) {
                expect(doorDomain.has(`${kx},${ky}`), `${nm} 门格被击杀 (${kx},${ky})`).toBe(false);
              }
            });
          }
        }
      }
    }
  }

  it('完整件判据通过零击杀；破完整性后同型守卫环只打残格且锚格先行（完整件行为=旧锚点单杀同相）', () => {
    const st = new TileStore(64, 128);
    const x = 30, y0 = 40;
    const px = mkFixture(st, x, y0, 0, 0, 1, POT);
    const bench = makeBench(st);
    // 完整件（底行支撑完好）→ 判据通过 → 零击杀
    bench.sweep(px + 1, y0 + 1);
    expect(bench.kills).toEqual([]);
    // 破坏完整性（抽走右列）→ 击杀环只打残格；替身不清格 → 去重后恰=左列两格,锚格先行
    st.setTileSilent(px + 1, y0 + 1, 0); st.setTileSilent(px + 1, y0 + 2, 0);
    bench.sweep(px, y0 + 1);
    const uniq = [...new Map(bench.kills.map(k => [`${k[0]},${k[1]}`, k])).values()];
    expect(uniq).toEqual([[px, y0 + 1], [px, y0 + 2]]);
  });

  it('结构锁：8 个可砍多格计算锚 case 均走 killDecorPieceCells + 方法定义在位（防静默回退锚点单杀）', () => {
    expect(typeof (Game.prototype as unknown as Record<string, unknown>).killDecorPieceCells)
      .toBe('function');
    const text = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    // ★BJ722-A D1 后 = 8 可砍 + 12 新接（sunflower/orb/hangs/wallhang/hangtop/deco3x2/
    //  xmas/support2x2 ax,ay 形 + sapling×3/gnome x,top 形——其余新站几何形不同不计入本式）
    const n = (text.match(/killDecorPieceCells\(ax, ay|killDecorPieceCells\(x, top/g) ?? []).length;
    expect(n).toBe(20);
    expect(text).toContain('private killDecorPieceCells(ax: number, ay: number, w: number, h: number, type: number)');
    // ★BJ722-A：新站几何抽钉（防单站静默回退——计数式锁不辨成员）
    expect(text).toContain('killDecorPieceCells(ax, ay, 2, 4, st.type[i]);');            // sunflower 2×4
    expect(text).toContain('killDecorPieceCells(x, ay, 1, 5, st.type[i]);');            // tallgate 1×5
    expect(text).toContain('killDecorPieceCells(x, ay2, 1, n, st.type[i]);');           // stalactite-Echo 1×n
    expect(text).toContain('killDecorPieceCells(ax, ay, 4, 8, st.type[i]);');           // xmas 4×8
    expect(text).toContain('killDecorPieceCells(ax, y, 3, 1, st.type[i]);');            // deco3x1 3×1
    expect(text).toContain('killDecorPieceCells(ax, ay, 2, h, st.type[i]);');           // hangtop 2×h
    // trapdoor 反例锁：CheckTrapDoor :52090-52094 无守卫 box-kill（勿「补」守卫=过度矫正）
    expect(text).toContain('for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) this.killDecorTile(Math.max(0, ax + k), Math.max(0, ay + l));');
  });
});
