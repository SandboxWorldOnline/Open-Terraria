// WorldGen.Check2x2 巨石族支撑完整性校验（Terraria/WorldGen.cs:48811-49232）移植。
// 触发链：邻格变化（KillTile→TileFrameImportant）对 2×2 多格物调 Check2x2；
//   巨石族(Sets.Boulders:195={138,484,664,665,711,712,713,714,715,716} ∪ 654 TNTBarrel)
//   完整性失败时【不落物】——转滚石弹（cs:49171-49235 每型一张 NewProjectile 表）。
// 判定要点（cs:48968-48984 verbatim）：
//   flag = 四格任一缺失/类型不符/帧不符；
//   或：两下格（ax..ax+1, ay+2）均 !SolidTileAllowBottomSlope
//       且 上格（ax..ax+1, ay-1）无 基础箱/假箱/88/470/475 族。
// （★与沙不同：巨石不在 Sets.Falling、GetSandfallProjData 无 case——悬挂的巨石贴图
//   本身是"合法状态"，只有上方有容器遮挡-下方又空时才释放；下方有墙也不计庇护。）
import { TILE_DEFS, PLATFORMS_SHEETS } from '../data/tiles';
import { TileStore } from './TileStore';

/** 结构最小视图：真实 TileStore 或测试 mock 均可注入 */
export type BoulderCellGrid = Pick<TileStore,
  'inBounds' | 'idx' | 'type' | 'flags' | 'frameX' | 'frameY' | 'half' | 'slope' | 'wire'>;


/** 参与完整性校验的 sheet 集（TileFrameImportant 分派全集，cs:86924/87040/87218 三簇并集） */
export const BOULDER_FAMILY_SHEETS: ReadonlySet<number> = new Set([
  138, 484, 654, 664, 665, 711, 712, 713, 714, 715, 716,
]);

/** Check2x2 摧毁时的弹型表（cs:49171-49235 逐 case；654 出生偏移特殊 +8/+8） */
export interface BoulderConvertRow { proj: number; dmg: number }
export const BOULDER_CONVERT_TABLE: Readonly<Record<number, BoulderConvertRow>> = {
  138: { proj: 99, dmg: 70 },     // Boulder
  484: { proj: 727, dmg: 35 },    // CactusBall(仙人掌球)
  654: { proj: 1002, dmg: 400 },  // TNTBarrel（TNT 炸药桶;TileID.cs:1745=654 弹 1002——
                                  //  ★SW-BJ93 债4③ 勘误：旧注「大石柱仙人掌球」名实不符
                                  //  （仙人掌球=484 RollingCactus→727）。出生=WorldGen.cs:49178
                                  //  NewProjectile(…,1002,400,10f,myPlayer)：dmg 400/kb 10、
                                  //  偏移 num2*16+8 / num6*16+8）
  664: { proj: 1013, dmg: 70 },
  665: { proj: 1014, dmg: 70 },
  711: { proj: 1047, dmg: 100 },
  712: { proj: 1048, dmg: 50 },
  713: { proj: 1053, dmg: 70 },
  714: { proj: 1054, dmg: 50 },
  715: { proj: 1055, dmg: 70 },
  716: { proj: 1057, dmg: 70 },
};

/** RollingBoulder 等消费的 proj 映射捷径 */
export const BOULDER_SHEET_TO_PROJ: Readonly<Record<number, number>>
  = Object.fromEntries(Object.entries(BOULDER_CONVERT_TABLE).map(([k, v]) => [Number(k), v.proj]));

/** 上方黑名单：cs:48972 白名单外的容器族防挤压误触发 */
const ABOVE_BLOCK_SHEETS = new Set([21, 467, 88, 441, 468, 470, 475]);
// ↑ 21=BasicChest 集代表/467=Containers2/88=Dressers/441·468=Fake 两族/
//   470·475=(1457 新增防护型);BasicChest 表族内其余样式同属 21。

export interface BoulderAnchorCtx {
  /** 内部 id → 原版 sheet（Game.wiring.sheetOf 同源） */
  sheetOfInternal(internalId: number): number;
  /** KillTile 等价（已含掉落/连锁/监听重入） */
  breakCell(x: number, y: number): void;
  /** 完整性失败回调：anchor 左上格 + 命中的 sheet */
  convert(ax: number, ay: number, sheet: number): void;
}

let _destroying = false;   // cs 全局 destroyObject：递归熔断

/** ★SW-BJ102（2026-09-16）：destroyObject（WorldGen.cs:48973 置位 / :49206 复位）
 *  单飞闸外置口——Check2x2 之外的整件破坏路径（Game 654 TNTBarrel 挖除臂）复用
 *  同一闸：闸内清格监听（scanBoulderFamilyNear→checkBoulderFamily）中途级联被吞，
 *  同件 Spawn 单发（改前实证：挖一格=3×爆炸面+2×幻影弹）。restore 取外层值
 *  （嵌套安全）；isBoulderDestroying 供重入臂判「外层已持闸」。 */
export function isBoulderDestroying(): boolean {
  return _destroying;
}

export function boulderDestroyGuard<T>(fn: () => T): T {
  const outer = _destroying;
  _destroying = true;
  try {
    return fn();
  } finally {
    _destroying = outer;
  }
}

/** PlatformProperTopFrame（WorldGen.cs:70684-70694）：frameX/PlatformFrameWidth()
 *  ∈ [0,7]∪[12,16]∪[25,26]——平台"平顶"连接帧域。PlatformFrameWidth() =
 *  _data[19].CoordinateFullWidth = (CoordinateWidth16+Padding2)×Width1 = 18
 *  （TileObjectData.cs:2131-2140 addTile(19) + Calculate styleWidth 式）。 */
function platformProperTopFrame(frameX: number): boolean {
  const n = Math.floor(frameX / 18);
  return (n >= 0 && n <= 7) || (n >= 12 && n <= 16) || (n >= 25 && n <= 26);
}

/** WorldGen.SolidTileAllowBottomSlope（WorldGen.cs:70698-70716）1:1：
 *  界外（!InWorld）=true；active+(solid|solidTop)+【非顶坡 slope∈{1,2}——例外:
 *  平台且 PlatformProperTopFrame(frameX)】+非半砖+未致动 ⇒ 承放态。
 *  坡域口径：拒顶坡 topSlope{1,2}（Tile.cs:292-299）、收底坡 bottomSlope{3,4}
 *  （Tile.cs:302-309）与平放 0。消费位=Check2x2 巨石下支撑（cs:48968-48984）与
 *  624 侏儒石化脚面（NPC.cs:56446）——单一来源，禁在消费侧复刻坡域 */
export function solidAllowBottomSlope(st: BoulderCellGrid, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return true;   // 原版 !InWorld(i,j) → true（界外算支撑不判坏）
  const i = st.idx(x, y);
  const t = st.type[i];
  // ★幽灵保域（2026-09-03）：active 门补 flags bit0（原版 WorldGen.cs:70710
  //  SolidTileAllowBottomSlope `tile.active() && …`）——幽灵支撑不算承放
  if (t === 0 || (st.flags[i] & 1) === 0) return false;
  const d = TILE_DEFS[t];
  if (!d) return false;
  if (st.half[i]) return false;                       // halfBrick 不算实心（helper 显式排除）
  if (st.wire[i] & TileStore.WIRE_ACTUATED) return false;   // ★inActive 位（cs:70713）——
    // 致动缩入的支撑不算实心 ⇒ 压板/亡命箱致动石栅即释放巨石（R20-I4 判例此处曾错引柜支）
  const sl = st.slope[i] ?? 0;
  // ★坡域对齐（2026-09-04）：旧实现收 slope{0,1,2} 拒{3,4}=坡域整体倒置（把
  //  topSlope 当 bottomSlope）——巨石站不上底坡台地、反悬在顶坡上。原版拒【顶坡】
  //  {1,2}，例外支 = Platforms[type] && PlatformProperTopFrame(frameX)（cs:70711
  //  原文防御臂：平台不坡,防陈旧 slope 位误伤,照抄）
  if ((sl === 1 || sl === 2)
    && !(d.platform === true && platformProperTopFrame(st.frameX[i]))) return false;
  return d.solid === true || d.platform === true;     // main.tileSolid ∪ tileSolidTop
}

/** ★G41-A（bj751a D1,2026-11-02）WorldGen.SolidTileNoPlatforms（WorldGen.cs
 *  :70727-70748）1:1：界外（!InWorld fluff0）=true；active ∧ ¬TileID.Sets.
 *  Platforms{19,427,435-439}（TileID.cs:243 窄集——矿条 239/花箱 380 不在其列
 *  =算墙）∧ (tileSolid∨tileSolidTop) ∧ 未致动 ⇒ 封顶/梯墙面。
 *  消费位=AI_003 flag5 头行封顶（NPC.cs:60443）与跳梯 1-3 级
 *  （:60692/:60694/:60705/:60724）——单一来源,禁在消费侧复刻。
 *  ★与 isSolid 的两差异（bj751a D1 定谳）：①窄集平台【不算】墙（isSolid 的
 *  SOLID_LUT 本就排平台,但旧头行近似 `(solid||platform)&&!(solid&&platform)`
 *  的 platform 支=宽 tileSolidTop 集,把平台也当墙=头顶平台误封顶禁跳）;
 *  ②非平台 solidTop（239 矿条/380 花箱/桌子 14 等）【算】墙（isSolid 放行）。 */
export function solidTileNoPlatforms(st: BoulderCellGrid, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return true;   // 原版 !InWorld(i,j) → true（界外算墙）
  const i = st.idx(x, y);
  if ((st.flags[i] & 1) === 0) return false;   // !active()——幽灵/空格不算墙
  if (st.wire[i] & TileStore.WIRE_ACTUATED) return false;
  const d = TILE_DEFS[st.type[i]];
  if (!d) return false;
  if (PLATFORMS_SHEETS.has(d.vanilla?.sheet ?? -1)) return false;   // 窄集排除（TileID.cs:243）
  return d.solid === true || d.platform === true;   // tileSolid ∪ tileSolidTop
}

/**
 * 对成员格 (x,y) 执行 Check2x2 完整性校验。非家族 sheet 直接返回。
 * 与原版一致：从受检格反推锚点；四格必须逐位匹配（含帧）；两个独立判据触发摧毁。
 */
export function checkBoulderFamily(st: BoulderCellGrid, x: number, y: number, ctx: BoulderAnchorCtx): void {
  if (_destroying || !st.inBounds(x, y)) return;
  const i0 = st.idx(x, y);
  const internalType = st.type[i0];
  const type = ctx.sheetOfInternal(internalType);
  if (!BOULDER_FAMILY_SHEETS.has(type)) return;

  // ---- 锚点反推（cs:48824-48843 通用 2×2 公式）----
  let fxo = 0;
  let ax = -Math.trunc(st.frameX[i0] / 18);
  if (ax < -1) { ax += 2; fxo += 36; }
  ax += x;
  // fy 行段：while(fy>=36){fy-=36;row++}; ay=j-row
  let fy = st.frameY[i0];
  let rowOff = 0;
  while (fy >= 36) { fy -= 36; rowOff++; }
  const ay = y - Math.floor(fy / 18);

  // ---- 判据①四格逐位匹配（cs:48845-48860 泛式）----
  let flag = false;
  outer: for (let k = ax; k < ax + 2; k++) {
    for (let l = ay; l < ay + 2; l++) {
      if (!st.inBounds(k, l)) { flag = true; break outer; }
      const ci = st.idx(k, l);
      // ★幽灵保域（2026-09-03）：成员格判据 = 原版 cs:48852
      //  `!tileSafely.active() || type != … || frame…`——幽灵成员格（flags=0）
      // 即完整性失败（原版同态：残型成员不拦截 flag）
      if (st.flags[ci] === 0 || st.type[ci] !== internalType
        || st.frameX[ci] !== (k - ax) * 18 + fxo
        || st.frameY[ci] !== (l - ay) * 18 + rowOff * 36) {
        flag = true; break outer;
      }
    }
  }
  // ---- 判据②巨石专属（cs:48968-48984 verbatim）：上邻黑名单 ∧ 双下格非实心 ----
  if (!flag) {
    const tAboveL = st.inBounds(ax, ay - 1) ? st.type[st.idx(ax, ay - 1)] : 0;
    const tAboveR = st.inBounds(ax + 1, ay - 1) ? st.type[st.idx(ax + 1, ay - 1)] : 0;
    const sAL = tAboveL ? ctx.sheetOfInternal(tAboveL) : 0;
    const sAR = tAboveR ? ctx.sheetOfInternal(tAboveR) : 0;
    const aboveBlocked = ABOVE_BLOCK_SHEETS.has(sAL) || ABOVE_BLOCK_SHEETS.has(sAR);
    if (!aboveBlocked
      && !solidAllowBottomSlope(st, ax, ay + 2)
      && !solidAllowBottomSlope(st, ax + 1, ay + 2)) {
      flag = true;
    }
  }

  if (!flag) return;
  _destroying = true;          // destroyObject=true（cs:48973）
  try {
    for (let m = ax; m < ax + 2; m++) {
      for (let n = ay; n < ay + 2; n++) {
        if (st.inBounds(m, n)) {
          const ci = st.idx(m, n);
          // ★幽灵保域（2026-09-03）：KillTile 仅及活跃成员（原版 cs:48982
          //  `tile5.type == type && tile5.active()`）——幽灵成员格不清除（原版同态,
          //  残型留在原地）
          if (st.type[ci] === internalType && (st.flags[ci] & 1) !== 0) ctx.breakCell(m, n);   // KillTile
        }
      }
    }
    ctx.convert(ax, ay, type);
  } finally {
    _destroying = false;
  }
}
