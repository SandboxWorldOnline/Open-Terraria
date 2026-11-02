// 圣诞树装饰（tile 171）1:1（Player.PlaceThing_XMasTreeTops :41053-41136 +
// WorldGen.checkXmasTreeDrop/dropXmasTree/setXmasTree :39239-39500 +
// TileDrawing.DrawXmasTree :3699-3799）。
//
// 帧编码（锚点格 frameY 位段存 4 槽装饰状态）：
//   槽 0 树顶饰（item 1874-1877）位 0-2    值 1/2/4   → 样式 1-4
//   槽 1 花环   （item 1878-1883）位 3-5    值 8/16/32 → 样式 1-6
//   槽 2 彩球   （item 1884-1894）位 6-9    值 64/128/256/512 → 样式 1-11
//   槽 3 串灯   （item 1895-1905）位 10-13  值 1024/2048/4096/8192 → 样式 1-11
//
// 锚点约定双兼容：
//   原版（PlaceXmasTree_Direct :39577-39595）：锚点格 frameX=10（哨兵）、
//     其余格 frameX=列号(1-3)/frameY=行号(1-7) 裸索引；wld 导入即此约定。
//   ★BJ754 TF-11（2026-11-02,issue#39）：本仓放置链已归一原版裸索引域
//    （framedCellFrame case 171——旧 18px 步长写帧与 CheckXmasTree 裸索引回推
//    写读域错置=放下即碎）;下方 18px 解码分支仅为【legacy 存档帧】兼容保留
//    （本刀前放置的树从未存活过放置后复验,存量面≈0,防御性保留）。
import type { TileStore } from './TileStore';

export const XMAS_TREE_SHEET = 171;
export const XMAS_TREE_W = 4;
export const XMAS_TREE_H = 8;
/** 串灯动画（Main.cs:18609-18618：counter>16 推进、回卷 3 → 4 帧循环） */
export const XMAS_LIGHT_FRAMES = 4;

/** 各槽位 frameY 位段的 [起始位, 位宽]（setXmasTree :39439-39500 逐段或/与） */
const SLOT_BITS: ReadonlyArray<readonly [number, number]> = [[0, 3], [3, 3], [6, 4], [10, 4]];

/** 装饰物品 → (槽, 样式)（Player.cs:41060-41120 四段减法）。
 *  1874-1877 树顶饰 / 1878-1883 花环 / 1884-1894 彩球 / 1895-1905 串灯 */
export function xmasDecorOfItem(vid: number): { obj: number; style: number } | null {
  if (vid >= 1874 && vid <= 1877) return { obj: 0, style: vid - 1873 };
  if (vid >= 1878 && vid <= 1883) return { obj: 1, style: vid - 1877 };
  if (vid >= 1884 && vid <= 1894) return { obj: 2, style: vid - 1883 };
  if (vid >= 1895 && vid <= 1905) return { obj: 3, style: vid - 1894 };
  return null;
}

/** 槽样式 → 掉落物品 id（dropXmasTree :39396-39426 四段） */
export function xmasDecorItem(obj: number, style: number): number {
  if (style <= 0) return 0;
  return (obj === 0 ? 1874 : obj === 1 ? 1878 : obj === 2 ? 1884 : 1895) + style - 1;
}

/** 圣诞树任一格 → 锚点与格内偏移。非树格返回 null。
 *  col/row 用于渲染分格取样；ax/ay 用于装饰位段读写 */
export function xmasCell(st: TileStore, x: number, y: number):
{ ax: number; ay: number; col: number; row: number } | null {
  if (!st.inBounds(x, y)) return null;
  const i = st.idx(x, y);
  const t = st.type[i];
  if (t === 0 || !st.flags[i]) return null;
  const fx = st.frameX[i], fy = st.frameY[i];
  if (fx === 10) return { ax: x, ay: y, col: 0, row: 0 };        // 原版锚点哨兵
  if (fx >= 1 && fx <= 3) return { ax: x - fx, ay: y - fy, col: fx, row: fy };  // 原版裸索引
  // 本仓 18px 步长约定；锚点 frameY 可能带装饰位段（非 18 倍数）→ 行向上扫
  const col = Math.min(XMAS_TREE_W - 1, Math.floor(fx / 18));
  let row: number;
  if (fy % 18 === 0) row = Math.min(XMAS_TREE_H - 1, Math.floor(fy / 18));
  else {
    row = 0;
    while (row < XMAS_TREE_H - 1 && st.inBounds(x, y - row - 1)
      && st.type[st.idx(x, y - row - 1)] === t && st.flags[st.idx(x, y - row - 1)]) row++;
  }
  return { ax: x - col, ay: y - row, col, row };
}

/** checkXmasTreeDrop（:39239-39324）：锚点 frameY 解出该槽样式，无装饰返回 -1 */
export function xmasDecorStyle(st: TileStore, ax: number, ay: number, obj: number): number {
  if (!st.inBounds(ax, ay)) return -1;
  const fy = st.frameY[st.idx(ax, ay)];
  const [shift, bits] = SLOT_BITS[obj];
  const mask = (1 << bits) - 1;
  const v = (fy >> shift) & mask;
  return v > 0 ? v : -1;
}

/** setXmasTree（:39430-39500）：写入该槽位段，其余槽位保持原值。
 *  style=0 清空该槽（物品链不会传 0，破坏整树时清理用）。
 *  经 setTile 写回（同型重写不清油漆/半砖，且触发 chunk 重烘焙与联机上报）。
 *  ★X2-F8(2026-09-04)：原版 setXmasTree（WorldGen.cs:39781+）只或/与 frameY 位段、
 *  不动 active/type——经 setTile 会把幽灵锚格残型复活成 active（帧写复活幽灵格）。
 *  幽灵锚跳过（保守=原版可观测面：inactive 格帧写无效） */
export function xmasSetDecor(st: TileStore, ax: number, ay: number, obj: number, style: number): void {
  if (!st.inBounds(ax, ay)) return;
  if (!st.hasTile(ax, ay)) return;
  const i = st.idx(ax, ay);
  const [shift, bits] = SLOT_BITS[obj];
  const mask = ((1 << bits) - 1) << shift;
  const fy = ((st.frameY[i] & ~mask) | ((style << shift) & mask)) & 0xffff;
  st.setTile(ax, ay, st.type[i], st.frameX[i], fy);
}
