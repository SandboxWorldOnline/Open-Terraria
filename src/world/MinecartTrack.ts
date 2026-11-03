// ============================================================================
// 矿车轨道系统 1:1 移植（Terraria 1.4.5.6 Minecart.cs 全量 + Mount.cs 矿车坐骑参数）
// 轨道 tile 314 帧语义（与普通家具完全不同！）：
//   frameX = 前轨连接 ID（0-35，非像素偏移）
//   frameY = 后轨连接 ID（-1 = 无后轨；Uint16 存储为 0xFFFF）
// 每个连接 ID 描述该格轨道左右两侧各自接到邻格的上/平/下（0/1/2）。
// 每格内部按 2px 分 8 个子段（_tileHeight[36][8]），值 = 轨面在格内的像素 Y
// （(8-h)*2 换算），特殊值：-1 墙挡 / -2 弹性挡板 / -3 斜坡起飞端 / -4 开放端。
// ============================================================================
import type { TileStore } from './TileStore';
import { tileAnim } from '../render/TileAnim';
import { TILE_BY_KEY } from '../data/tiles';

export const TRACK_SHEET = 314;
/** 本仓库内部 tile id（v_314_minecart_track）；未注册时 -1 使全部判定安全失败 */
export const TRACK_TILE: number = TILE_BY_KEY['v_314_minecart_track'] ?? -1;

// ---- Minecart.cs 帧族常量 ----
export const TRACK_FRAMES = 36;          // TotalFrames
export const DECOR_LEFT_DOWN = 36;       // LeftDownDecoration
export const DECOR_RIGHT_DOWN = 37;      // RightDownDecoration
export const DECOR_BOUNCY_BUMPER = 38;   // BouncyBumperDecoration
export const DECOR_REGULAR_BUMPER = 39;  // RegularBumperDecoration

// ---- Mount.cs mounts[6]（Minecart 坐骑）参数：坐骑族逐型参数已由 entities/Mounts.ts
//      的 vanilla-mounts.json（Mount.cs 提取）承载，SuperCart 覆写在 entities/Minecart.ts ----
/** Player.cs:27845-27849：boostLeft/Right → trackBoost ∓/± 4（下帧入 vx，钳 ±maxRunSpeed；
 *  Minecart.cs:75 BoosterSpeed） */
export const TRACK_BOOST_DELTA = 4;
/** Player.defaultGravity（1.4.5 = 0.4f）：开放端脱轨的初始下落速度（Minecart.cs:911） */
export const PLAYER_DEFAULT_GRAVITY = 0.4;

// ---- Minecart.Customization.Default ----
export const CART_TEXTURE_WIDTH = 50;                       // MinecartTextureWidth
export const CART_MAGNET_OFFSET = { x: 25, y: 26 };         // MagnetOffset
export const CART_WHEEL_OFFSET = { x: 12, y: 0 };           // WheelOffset

// ---- 结果位（BitsByte 语义，TrackCollision 返回值）----
export const FLAG_ON_TRACK = 0;       // Flag_OnTrack
export const FLAG_BOUNCY_BUMPER = 1;  // Flag_BouncyBumper（撞弹性挡板，水平反弹）
export const FLAG_USED_RAMP = 2;      // Flag_UsedRamp（斜坡起飞）
export const FLAG_HIT_SWITCH = 3;     // Flag_HitSwitch（压板轨道 → Wiring.HitSwitch）
export const FLAG_BOOST_LEFT = 4;     // Flag_BoostLeft
export const FLAG_BOOST_RIGHT = 5;    // Flag_BoostRight

// ---- TrackState（Minecart.cs:9-19）----
const NO_TRACK = -1, ABOVE_TRACK = 0, ON_TRACK = 1, BELOW_TRACK = 2;
const ABOVE_FRONT = 3, ABOVE_BACK = 4, ON_FRONT = 5, ON_BACK = 6;

// ---- 连接值（Minecart.cs:59-65）----
const NO_CONNECTION = -1, TOP = 0, MIDDLE = 1, BOTTOM = 2;
// 子段高度特殊值（Minecart.cs:67-73）
const BUMPER_END = -1, BOUNCY_END = -2, RAMP_END = -3, OPEN_END = -4;

// ---- 轨道类型（Minecart.cs:77-81）----
const TYPE_NORMAL = 0, TYPE_PRESSURE = 1, TYPE_BOOSTER = 2;

// ============================================================================
// Initialize（Minecart.cs:103-547）—— 36 帧连接表 + 8 子段高度表 + 贴图位表
// ============================================================================
const LEFT_CONN = new Int8Array(TRACK_FRAMES).fill(-1);
const RIGHT_CONN = new Int8Array(TRACK_FRAMES).fill(-1);
const TRACK_TYPE = new Int8Array(TRACK_FRAMES);          // 默认 0
const BOOST_LEFT = new Uint8Array(TRACK_FRAMES);         // 默认 false
const TEX_POS: Array<[number, number]> = [];             // 40 项
const TILE_HEIGHT: Int16Array[] = [];                    // 36×8，默认 5
const TRACK_SWITCH_OPTIONS: Array<Int32Array | null> = new Array(64).fill(null);
let FIRST_PRESSURE_FRAME = -1;
let FIRST_LEFT_BOOST_FRAME = -1;
let FIRST_RIGHT_BOOST_FRAME = -1;

function defFrame(
  id: number, l: number, r: number, tex: [number, number],
  heights?: Array<[number, number]>, type = TYPE_NORMAL, boostLeft = false,
): void {
  LEFT_CONN[id] = l; RIGHT_CONN[id] = r;
  TEX_POS[id] = tex;
  TRACK_TYPE[id] = type;
  BOOST_LEFT[id] = boostLeft ? 1 : 0;
  if (heights) for (const [seg, v] of heights) TILE_HEIGHT[id][seg] = v;
}

function buildTables(): void {
  for (let i = 0; i < TRACK_FRAMES; i++) {
    TILE_HEIGHT[i] = new Int16Array(8).fill(5);
  }
  for (let i = 0; i < 40; i++) TEX_POS[i] = [0, 0];

  defFrame(0, NO_CONNECTION, NO_CONNECTION, [0, 0], [[0, OPEN_END], [7, OPEN_END]]);
  defFrame(1, MIDDLE, MIDDLE, [1, 0]);
  defFrame(2, NO_CONNECTION, MIDDLE, [2, 1], [[0, -1], [1, -1], [2, -1], [3, -1]]);
  defFrame(3, MIDDLE, NO_CONNECTION, [3, 1], [[4, -1], [5, -1], [6, -1], [7, -1]]);
  defFrame(4, BOTTOM, MIDDLE, [0, 2], [[0, 1], [1, 2], [2, 3], [3, 3], [4, 4], [5, 4]]);
  defFrame(5, MIDDLE, BOTTOM, [1, 2], [[2, 4], [3, 4], [4, 3], [5, 3], [6, 2], [7, 1]]);
  defFrame(6, MIDDLE, TOP, [0, 1], [[4, 6], [5, 6], [6, 7], [7, 8]]);
  defFrame(7, TOP, MIDDLE, [1, 1], [[0, 8], [1, 7], [2, 6], [3, 6]]);
  defFrame(8, TOP, BOTTOM, [0, 3], [[0, 8], [1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1]]);
  defFrame(9, BOTTOM, TOP, [1, 3], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]]);
  defFrame(10, BOTTOM, NO_CONNECTION, [4, 1], [[0, 1], [1, 2], [2, -1], [3, -1], [4, -1], [5, -1], [6, -1], [7, -1]]);
  defFrame(11, NO_CONNECTION, BOTTOM, [5, 1], [[0, -1], [1, -1], [2, -1], [3, -1], [4, -1], [5, -1], [6, 2], [7, 1]]);
  defFrame(12, TOP, NO_CONNECTION, [6, 1], [[0, 8], [1, 7], [2, 6], [3, -1], [4, -1], [5, -1], [6, -1], [7, -1]]);
  defFrame(13, NO_CONNECTION, TOP, [7, 1], [[0, -1], [1, -1], [2, -1], [3, -1], [4, -1], [5, 6], [6, 7], [7, 8]]);
  defFrame(14, NO_CONNECTION, MIDDLE, [2, 0], [[0, OPEN_END]]);
  defFrame(15, MIDDLE, NO_CONNECTION, [3, 0], [[7, OPEN_END]]);
  defFrame(16, BOTTOM, NO_CONNECTION, [4, 0],
    [[0, 1], [1, 2], [2, RAMP_END], [3, RAMP_END], [4, RAMP_END], [5, RAMP_END], [6, RAMP_END], [7, RAMP_END]]);
  defFrame(17, NO_CONNECTION, BOTTOM, [5, 0],
    [[0, RAMP_END], [1, RAMP_END], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1]]);
  defFrame(18, TOP, NO_CONNECTION, [6, 0],
    [[0, 8], [1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, RAMP_END], [7, RAMP_END]]);
  defFrame(19, NO_CONNECTION, TOP, [7, 0],
    [[0, RAMP_END], [1, RAMP_END], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]]);
  // 20-23：压板轨道（type 1，含端点开放变体）
  defFrame(20, NO_CONNECTION, NO_CONNECTION, [0, 4], [[0, OPEN_END], [7, OPEN_END]], TYPE_PRESSURE);
  defFrame(21, MIDDLE, MIDDLE, [1, 4], undefined, TYPE_PRESSURE);
  defFrame(22, NO_CONNECTION, MIDDLE, [0, 5], [[0, OPEN_END]], TYPE_PRESSURE);
  defFrame(23, MIDDLE, NO_CONNECTION, [1, 5], [[7, OPEN_END]], TYPE_PRESSURE);
  // 24-29：弹性挡板（普通型，-2 子段）
  defFrame(24, NO_CONNECTION, MIDDLE, [2, 2], [[0, BOUNCY_END], [1, BOUNCY_END], [2, BOUNCY_END], [3, BOUNCY_END], [4, BOUNCY_END], [5, BOUNCY_END]]);
  defFrame(25, MIDDLE, NO_CONNECTION, [3, 2], [[2, BOUNCY_END], [3, BOUNCY_END], [4, BOUNCY_END], [5, BOUNCY_END], [6, BOUNCY_END], [7, BOUNCY_END]]);
  defFrame(26, BOTTOM, NO_CONNECTION, [4, 2], [[0, 1], [1, 2], [2, BOUNCY_END], [3, BOUNCY_END], [4, BOUNCY_END], [5, BOUNCY_END], [6, BOUNCY_END], [7, BOUNCY_END]]);
  defFrame(27, NO_CONNECTION, BOTTOM, [5, 2], [[0, BOUNCY_END], [1, BOUNCY_END], [2, BOUNCY_END], [3, BOUNCY_END], [4, BOUNCY_END], [5, BOUNCY_END], [6, 2], [7, 1]]);
  defFrame(28, TOP, NO_CONNECTION, [6, 2], [[0, 8], [1, 7], [2, 6], [3, BOUNCY_END], [4, BOUNCY_END], [5, BOUNCY_END], [6, BOUNCY_END], [7, BOUNCY_END]]);
  defFrame(29, NO_CONNECTION, TOP, [7, 2], [[0, BOUNCY_END], [1, BOUNCY_END], [2, BOUNCY_END], [3, BOUNCY_END], [4, BOUNCY_END], [5, 6], [6, 7], [7, 8]]);
  // 30-35：加速轨道（type 2，左右向）
  defFrame(30, MIDDLE, MIDDLE, [2, 3], undefined, TYPE_BOOSTER, false);
  defFrame(31, MIDDLE, MIDDLE, [3, 3], undefined, TYPE_BOOSTER, true);
  defFrame(32, TOP, BOTTOM, [4, 3], [[0, 8], [1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1]], TYPE_BOOSTER, false);
  defFrame(33, BOTTOM, TOP, [5, 3], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]], TYPE_BOOSTER, true);
  defFrame(34, TOP, BOTTOM, [6, 3], [[0, 8], [1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1]], TYPE_BOOSTER, true);
  defFrame(35, BOTTOM, TOP, [7, 3], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]], TYPE_BOOSTER, false);
  // 装饰帧位（Minecart.cs:429-432）
  TEX_POS[DECOR_LEFT_DOWN] = [0, 6];
  TEX_POS[DECOR_RIGHT_DOWN] = [1, 6];
  TEX_POS[DECOR_REGULAR_BUMPER] = [0, 7];
  TEX_POS[DECOR_BOUNCY_BUMPER] = [1, 7];
  for (let i = 0; i < TEX_POS.length; i++) {
    TEX_POS[i] = [TEX_POS[i][0] * 18, TEX_POS[i][1] * 18];
  }
  // 子段高度换算：(8-h)*2（Minecart.cs:437-447，负值保留特殊语义）
  for (let i = 0; i < TRACK_FRAMES; i++) {
    const arr = TILE_HEIGHT[i];
    for (let s = 0; s < 8; s++) if (arr[s] >= 0) arr[s] = (8 - arr[s]) * 2;
  }
  // _trackSwitchOptions[64]（Minecart.cs:448-518）：邻接位掩码 → 可选帧列表
  const array3 = new Int32Array(TRACK_FRAMES);
  for (let mask = 0; mask < 64; mask++) {
    let count = 0;
    for (let bit = 1, b = 0; bit < 256; bit <<= 1, b++) if ((mask & bit) === bit) count++;
    for (let f = 0; f < TRACK_FRAMES; f++) array3[f] = -1;
    let total = 0;
    for (let f = 0; f < TRACK_FRAMES; f++) {
      let conn = 0;
      switch (LEFT_CONN[f]) {
        case TOP: conn |= 1; break;
        case MIDDLE: conn |= 2; break;
        case BOTTOM: conn |= 4; break;
      }
      switch (RIGHT_CONN[f]) {
        case TOP: conn |= 8; break;
        case MIDDLE: conn |= 0x10; break;
        case BOTTOM: conn |= 0x20; break;
      }
      if (count < 2) { if (mask !== conn) continue; }
      else if (conn === 0 || (mask & conn) !== conn) continue;
      array3[f] = f;
      total++;
    }
    if (total === 0) continue;
    const opts = new Int32Array(total);
    let n = 0;
    for (let f = 0; f < TRACK_FRAMES; f++) if (array3[f] !== -1) opts[n++] = array3[f];
    TRACK_SWITCH_OPTIONS[mask] = opts;
  }
  // 首帧索引（Minecart.cs:519-546）
  FIRST_PRESSURE_FRAME = -1; FIRST_LEFT_BOOST_FRAME = -1; FIRST_RIGHT_BOOST_FRAME = -1;
  for (let f = 0; f < TRACK_FRAMES; f++) {
    switch (TRACK_TYPE[f]) {
      case TYPE_PRESSURE:
        if (FIRST_PRESSURE_FRAME === -1) FIRST_PRESSURE_FRAME = f;
        break;
      case TYPE_BOOSTER:
        if (BOOST_LEFT[f]) { if (FIRST_LEFT_BOOST_FRAME === -1) FIRST_LEFT_BOOST_FRAME = f; }
        else if (FIRST_RIGHT_BOOST_FRAME === -1) FIRST_RIGHT_BOOST_FRAME = f;
        break;
    }
  }
}
buildTables();

/** 审计/测试桥:Initialize 连接表只读快照(Minecart.cs:103-547 产物;
 *  帧链连通性审计器以此为其准基准) */
export function initializeConnTablesForAudit(): { left: number[]; right: number[]; heights: number[][] } {
  return {
    left: [...LEFT_CONN],
    right: [...RIGHT_CONN],
    heights: TILE_HEIGHT.map((h) => [...h]),
  };
}

// ============================================================================
// 存取助手（frameX/frameY 的 Uint16 ↔ int16 语义）
// ============================================================================
export function frontTrack(st: TileStore, i: number): number { return st.frameX[i]; }
export function backTrack(st: TileStore, i: number): number {
  return st.frameY[i] === 0xFFFF ? -1 : st.frameY[i];
}
/** 该格是否为有效轨道格（nactive && type==314 && frameX 合法；Minecart.cs:633） */
export function isTrackCell(st: TileStore, i: number): boolean {
  return TRACK_TILE >= 0 && !!(st.flags[i] & 1) && !(st.wire[i] & 32)   // nactive: active && !inActive
    && st.type[i] === TRACK_TILE && st.frameX[i] < TRACK_FRAMES;
}
export function trackTypeOf(frame: number): number {
  return frame >= 0 && frame < TRACK_FRAMES ? TRACK_TYPE[frame] : -1;
}
export function tileHeightAt(frame: number, seg: number): number {
  return frame >= 0 && frame < TRACK_FRAMES ? TILE_HEIGHT[frame][seg] : 0;
}
export function leftConnOf(frame: number): number {
  return frame >= 0 && frame < TRACK_FRAMES ? LEFT_CONN[frame] : NO_CONNECTION;
}
export function rightConnOf(frame: number): number {
  return frame >= 0 && frame < TRACK_FRAMES ? RIGHT_CONN[frame] : NO_CONNECTION;
}
/** IsPressurePlate（Minecart.cs:549-560）：压板轨道帧 20/21 */
export function isPressureFrame(frameX: number): boolean {
  return frameX === 20 || frameX === 21;
}
/** GetSourceRect（Minecart.cs:1525-1538）：帧 ID → 素材表像素位（16×16）。
 *  加速轨道（type 2）行随 boosterAnimFrame() 滚动；装饰帧 ID(36+) 忽略动画参数 */
export function sourceRectOf(frameID: number, animationFrame = 0): { sx: number; sy: number } | null {
  if (frameID < 0 || frameID >= 40) return null;
  const p = TEX_POS[frameID];
  let sy = p[1];
  if (frameID < TRACK_FRAMES && TRACK_TYPE[frameID] === TYPE_BOOSTER) sy += 18 * animationFrame;
  return { sx: p[0], sy };
}
/** Main.cs:18734-18741：tileFrameCounter[314]>=10 推进、>4 回卷 → 5 帧循环 */
export function boosterAnimFrame(): number {
  return Math.floor(tileAnim.tick / 10) % 5;
}
// DrawLeftDecoration / DrawRightDecoration（Minecart.cs:1448-1464）：下行装饰条件
export function drawLeftDecoration(frameID: number): boolean {
  return frameID >= 0 && frameID < TRACK_FRAMES && LEFT_CONN[frameID] === BOTTOM;
}
export function drawRightDecoration(frameID: number): boolean {
  return frameID >= 0 && frameID < TRACK_FRAMES && RIGHT_CONN[frameID] === BOTTOM;
}
// DrawBumper / DrawBouncyBumper（Minecart.cs:1466-1490）：端挡板条件（上端开放才画）
export function drawBumper(frameID: number): boolean {
  if (frameID < 0 || frameID >= TRACK_FRAMES) return false;
  if (TILE_HEIGHT[frameID][0] !== BUMPER_END) return TILE_HEIGHT[frameID][7] === BUMPER_END;
  return true;
}
export function drawBouncyBumper(frameID: number): boolean {
  if (frameID < 0 || frameID >= TRACK_FRAMES) return false;
  if (TILE_HEIGHT[frameID][0] !== BOUNCY_END) return TILE_HEIGHT[frameID][7] === BOUNCY_END;
  return true;
}

// ============================================================================
// GetNearbyTilesSetLookupIndex（Minecart.cs:1174-1202）：六邻轨道位掩码
// 位序：左上 1 / 左 2 / 左下 4 / 右上 8 / 右 16 / 右下 32
// ============================================================================
export function nearbyMask(st: TileStore, i: number, j: number): number {
  let mask = 0;
  // ★RD-F6（2026-09-04）锚①：六邻轨道位掩码 type 裸读（Minecart.cs:1174-1202
  //  `Main.tile[…]!=null && type == 314`，无 active 门）——幽灵轨道残型照样计入
  //  连接掩码（null 判=本仓 inBounds）。行车带门 isTrackCell（nactive）不在此列。
  const at = (x: number, y: number): boolean =>
    st.inBounds(x, y) && st.type[st.idx(x, y)] === TRACK_TILE;
  if (at(i - 1, j - 1)) mask++;
  if (at(i - 1, j)) mask += 2;
  if (at(i - 1, j + 1)) mask += 4;
  if (at(i + 1, j - 1)) mask += 8;
  if (at(i + 1, j)) mask += 16;
  if (at(i + 1, j + 1)) mask += 32;
  return mask;
}

/** 写回前后轨帧（唯一写入口：保持 type/active 不变，联动渲染/联机）。
 *  ★issue#45（2026-11-03）：改走 setTileFrame（cause='frame'）——原实现调
 *  st.setTile 会无条件派发 listeners,经 3×3 幸存链（checkDecorSquareFrame →
 *  checkFurnitureSupport → frameTrack）自我回写 → 无限递归爆栈。原版 FrameTrack
 *  写帧是裸字段写（Minecart.cs:1143-1160,零事件）,本原语为该语义的 SW 等价
 *  （详见 TileStore.setTileFrame 注）。 */
function writeFrames(st: TileStore, i: number, j: number, front: number, back: number): void {
  st.setTileFrame(i, j, front, back < 0 ? 0xFFFF : back);
}

// ============================================================================
// FrameTrack（Minecart.cs:947-1172）
//   pound=false：按邻接计算应取连接（放置/重 framing）
//   pound=true ：锤击循环切换（Player.cs:45444）
//   mute=true  ：仅轨道格响应（FlipSwitchTrack 对加速轨的翻向用）
// 返回 false = 无法定帧（孤格置默认平轨 / pound 无可切换项）。
// ============================================================================
export function frameTrack(st: TileStore, i: number, j: number, pound = false, mute = false): boolean {
  if (!st.inBounds(i, j)) return false;
  const idx = st.idx(i, j);
  // Minecart.cs:959-962 mute 门（仅 type 检查、不查 active）。原版 FrameTrack 对
  // 非 314 格本身不设防——但全部调用点（WorldGen.cs:86033 case 314 / Player.cs:45444
  // 锤击 / MessageBuffer.cs:1206 / MinecartDiggerHelper.cs:93）都只在 type==314 时进入，
  // 非轨道格绝不会被写帧。这里对齐调用点语义：非 314 格直接返回，不写任何帧
  //（曾在此处对非轨道邻格 writeFrames(0,-1)——frameTrackArea 六邻扫到实心邻块会
  //  把家具/门/宝箱的 frameX/frameY 清成 0/0xFFFF 造成贴图损坏）。
  if (TRACK_TILE < 0 || st.type[idx] !== TRACK_TILE) return false;
  const num = frontTrack(st, idx);          // 当前前轨（可为 -1：刚放置未定型）
  const num2 = backTrack(st, idx);          // 当前后轨
  // Minecart.cs:966：非法前轨按普通型（0）处理——放置首帧 -1 走默认分支
  const num3 = num >= 0 && num < TRACK_FRAMES ? TRACK_TYPE[num] : TYPE_NORMAL;
  let num4 = -1;                            // array 下标（前轨）
  let num5 = -1;                            // array 下标（后轨）
  const array = TRACK_SWITCH_OPTIONS[nearbyMask(st, i, j)];
  if (!array) {
    if (pound) return false;
    writeFrames(st, i, j, 0, -1);
    return false;
  }
  if (!pound) {
    let num6 = -1, num7 = -1;
    let flag = false;
    for (let k = 0; k < array.length; k++) {
      const num8 = array[k];
      if (num2 === array[k]) num5 = k;
      if (trackTypeOf(num8) !== num3) continue;
      if (leftConnOf(num8) === NO_CONNECTION || rightConnOf(num8) === NO_CONNECTION) {
        if (num === array[k]) { num4 = k; flag = true; }
        if (num6 === -1) num6 = k;
      } else {
        if (num === array[k]) { num4 = k; flag = false; }
        if (num7 === -1) num7 = k;
      }
    }
    if (num7 !== -1) {
      if (num4 === -1 || flag) num4 = num7;
    } else {
      if (num4 === -1) {
        // 加速/压板轨无同型全连接项 → 保持现状（Minecart.cs:1032-1038 return false）
        if (num3 === TYPE_BOOSTER) return false;
        if (num3 === TYPE_PRESSURE) return false;
        num4 = num6;
      }
      num5 = -1;
    }
  } else {
    for (let l = 0; l < array.length; l++) {
      if (num === array[l]) num4 = l;
      if (num2 === array[l]) num5 = l;
    }
    let num9 = 0, num10 = 0;
    for (let m = 0; m < array.length; m++) {
      if (trackTypeOf(array[m]) !== num3) continue;
      if (leftConnOf(array[m]) === NO_CONNECTION || rightConnOf(array[m]) === NO_CONNECTION) num10++;
      else num9++;
    }
    if (num9 < 2 && num10 < 2) return false;
    const flag2 = num9 === 0;
    let flag3 = false;
    if (!flag2) {
      // 后轨循环：找下一个连接不同但同型且双侧全连接的项（Minecart.cs:1079-1094）
      while (!flag3) {
        num5++;
        if (num5 >= array.length) { num5 = -1; break; }
        if ((leftConnOf(array[num5]) !== leftConnOf(array[num4]) || rightConnOf(array[num5]) !== rightConnOf(array[num4]))
          && trackTypeOf(array[num5]) === num3
          && leftConnOf(array[num5]) !== NO_CONNECTION && rightConnOf(array[num5]) !== NO_CONNECTION) {
          flag3 = true;
        }
      }
    }
    if (!flag3) {
      // 前轨循环（Minecart.cs:1096-1112；越界回卷后按同型同端型继续找，带安全边界）
      do {
        num4++;
        if (num4 >= array.length) {
          num4 = -1;
          let guard = 0;
          do {
            num4++;
            guard++;
          } while (guard < array.length
            && (trackTypeOf(array[num4]) !== num3
              || ((leftConnOf(array[num4]) === NO_CONNECTION || rightConnOf(array[num4]) === NO_CONNECTION) !== flag2)));
          break;
        }
      } while (trackTypeOf(array[num4]) !== num3
        || ((leftConnOf(array[num4]) === NO_CONNECTION || rightConnOf(array[num4]) === NO_CONNECTION) !== flag2));
    }
  }
  let flag4 = false;
  switch (num4) {
    case -2:
      if (frontTrack(st, idx) !== FIRST_PRESSURE_FRAME) flag4 = true;
      break;
    case -1:
      if (frontTrack(st, idx) !== 0) flag4 = true;
      break;
    default:
      if (num4 >= 0 && num4 < array.length && frontTrack(st, idx) !== array[num4]) flag4 = true;
      break;
  }
  if (num5 === -1) {
    if (backTrack(st, idx) !== -1) flag4 = true;
  } else if (num5 >= 0 && num5 < array.length && backTrack(st, idx) !== array[num5]) {
    flag4 = true;
  }
  switch (num4) {
    case -2: writeFrames(st, i, j, FIRST_PRESSURE_FRAME, num5 >= 0 && num5 < array.length ? array[num5] : -1); break;
    case -1: writeFrames(st, i, j, 0, num5 >= 0 && num5 < array.length ? array[num5] : -1); break;
    default:
      if (num4 >= 0 && num4 < array.length) writeFrames(st, i, j, array[num4], num5 >= 0 && num5 < array.length ? array[num5] : -1);
      break;
  }
  return true;
}

/** 放置后重 framing：自身 + 六邻（破坏/放置都要让邻接轨道重算连接） */
export function frameTrackArea(st: TileStore, i: number, j: number): void {
  frameTrack(st, i, j, false);
  for (const [dx, dy] of [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]] as const) {
    if (st.inBounds(i + dx, j + dy)) frameTrack(st, i + dx, j + dy, false);
  }
}

// ============================================================================
// FlipSwitchTrack（Minecart.cs:1302-1325）：电路信号到达压板/加速轨时翻向
//   type 0：前/后轨互换（分叉换边）
//   type 2：FrameTrack(pound) 循环下一个加速向
// ============================================================================
export function flipSwitchTrack(st: TileStore, i: number, j: number): boolean {
  if (!st.inBounds(i, j)) return false;
  const idx = st.idx(i, j);
  // ★G1谓词批(2026-09-04)：原版 FlipSwitchTrack（Minecart.cs:1302-1306）裸
  // FrontTrack() 无 active/nactive 门——本仓 isTrackCell(nactive) 多排的门对 314
  // 无害（轨道无致动面,actuator 不附着 314,inActive 恒假;幽灵轨道经 ghost 计数
  // 通道另行处理）,注释钉死=有意保留,勿当谓词债清理
  if (!isTrackCell(st, idx)) return false;
  const num = frontTrack(st, idx);
  if (num === -1) return false;
  switch (trackTypeOf(num)) {
    case TYPE_NORMAL: {
      const back = backTrack(st, idx);
      if (back !== -1) {
        writeFrames(st, i, j, back, num);
        return true;
      }
      return false;
    }
    case TYPE_BOOSTER:
      return frameTrack(st, i, j, true, true);
    default:
      return false;
  }
}

// ============================================================================
// PlaceTrack（Minecart.cs:1492-1512）：放置初始帧
//   style 0 普通(-1) / 1 压板 / 2 左加速 / 3 右加速（随后 FrameTrack 定型）
// ============================================================================
export function placeTrack(st: TileStore, i: number, j: number, style: number): void {
  let front = -1;
  switch (style) {
    case 0: front = -1; break;
    case 1: front = FIRST_PRESSURE_FRAME; break;
    case 2: front = FIRST_LEFT_BOOST_FRAME; break;
    case 3: front = FIRST_RIGHT_BOOST_FRAME; break;
  }
  st.setTile(i, j, TRACK_TILE, front < 0 ? 0xFFFF : front, 0xFFFF);
}

/** GetTrackItem（Minecart.cs:1514-1523）：帧 → 原版物品 id（2340/2492/2739） */
export function trackItemId(frame: number): number {
  switch (trackTypeOf(frame)) {
    case TYPE_PRESSURE: return 2492;
    case TYPE_BOOSTER: return 2739;
    default: return 2340;
  }
}

// ============================================================================
// 鼠马车挖掘链（MinecartDiggerHelper.cs 的连接校验/修正段）
// ============================================================================

/** ConvertOffsetYToTrackConnectionValue（Minecart.cs:1609-1617）：Y 偏移 → 连接值。
 *  -1(上方)→TOP 0 / 1(下方)→BOTTOM 2 / 0(平)→MIDDLE 1 */
export function offsetToConn(offsetY: number): number {
  return offsetY === -1 ? TOP : offsetY === 1 ? BOTTOM : MIDDLE;
}

/** GetAreExpectationsForSidesMet（Minecart.cs:1540-1562）：该格当前前轨帧的
 *  左/右连接是否与期望一致。期望值 = Y 偏移（-1/0/1；null = 不校验该侧），
 *  内部经 offsetToConn 换连接值 */
export function areSidesMetForTrack(
  st: TileStore, i: number, j: number,
  expectedLeft: number | null, expectedRight: number | null,
): boolean {
  if (!st.inBounds(i, j)) return false;
  const frame = frontTrack(st, st.idx(i, j));
  if (frame < 0 || frame >= TRACK_FRAMES) return false;
  if (expectedLeft !== null && LEFT_CONN[frame] !== offsetToConn(expectedLeft)) return false;
  if (expectedRight !== null && RIGHT_CONN[frame] !== offsetToConn(expectedRight)) return false;
  return true;
}

/** TryFittingTileOrientation（Minecart.cs:1564-1607）：在邻接掩码可选帧里找
 *  「同轨道型 + 左右连接满足期望」的帧写入前轨；找不到保持原帧。
 *  期望值 = Y 偏移（-1/0/1；null = 不校验该侧）。返回是否改帧 */
export function tryFittingTileOrientation(
  st: TileStore, i: number, j: number,
  expectedLeft: number | null, expectedRight: number | null,
): boolean {
  if (!st.inBounds(i, j)) return false;
  const idx = st.idx(i, j);
  const cur = frontTrack(st, idx);
  if (cur < 0 || cur >= TRACK_FRAMES) return false;
  const options = TRACK_SWITCH_OPTIONS[nearbyMask(st, i, j)];
  if (!options) return false;
  const curType = TRACK_TYPE[cur];
  const wantLeft = expectedLeft !== null ? offsetToConn(expectedLeft) : null;
  const wantRight = expectedRight !== null ? offsetToConn(expectedRight) : null;
  for (let k = 0; k < options.length; k++) {
    const f = options[k];
    if (wantLeft !== null && LEFT_CONN[f] !== wantLeft) continue;   // :1580-1587
    if (wantRight !== null && RIGHT_CONN[f] !== wantRight) continue; // :1588-1595
    if (TRACK_TYPE[f] !== curType) continue;                        // :1596-1600
    if (f === cur) return false;
    writeFrames(st, i, j, f, backTrack(st, idx));
    return true;
  }
  return false;
}

// ============================================================================
// 磁石位（Minecart.cs:1296-1300）：车身贴图参考点 = 位置 + 偏移 + MagnetOffset
// ============================================================================
export function magnetPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: x + width / 2 - CART_TEXTURE_WIDTH / 2 + CART_MAGNET_OFFSET.x,
    y: y + height / 2 + CART_MAGNET_OFFSET.y,
  };
}

/** OnTrack（Minecart.cs:1249-1259）：磁石位所在格是否轨道。
 *  ★RD-F6（2026-09-04）锚②：`Main.tile[num,num2] == null → false; type == 314`——
 *  type 裸读无 active 门（幽灵轨道残型照认=null 判外的唯一门） */
export function onTrack(st: TileStore, x: number, y: number, width: number, height: number): boolean {
  const m = magnetPosition(x, y, width, height);
  const tx = Math.trunc(m.x / 16), ty = Math.trunc(m.y / 16);
  if (!st.inBounds(tx, ty)) return false;
  const i = st.idx(tx, ty);
  return st.type[i] === TRACK_TILE;
}

/** GetOnTrack（Minecart.cs:1204-1247）：右键/R 上轨——吸附到最近有效子段的轨面坐标。
 *  ★RD-F6（2026-09-04）锚③：`if (tile.type != 314) return false`——type 裸读无
 *  active 门（幽灵轨道残型同可吸附）；行车带判定 isTrackCell（nactive,行车带门）
 *  属另一语义面,不在此复用。帧界防御：_tileHeight[36] 原版越界即炸,残型脏帧按
 *  无效处理（与旧行为同,只是不再连带 nactive 门） */
export function getOnTrack(
  st: TileStore, tileX: number, tileY: number,
  x: number, y: number, width: number, height: number,
): { x: number; y: number } | null {
  if (!st.inBounds(tileX, tileY)) return null;
  const ti = st.idx(tileX, tileY);
  if (st.type[ti] !== TRACK_TILE) return null;
  const frame = frontTrack(st, ti);
  if (frame < 0 || frame >= TRACK_FRAMES) return null;
  const m = magnetPosition(x, y, width, height);
  const num = Math.trunc(Math.trunc(m.x) % 16 / 2);
  let num3 = 0, num2 = -1;
  for (let i = num; i < 8; i++) {
    num3 = TILE_HEIGHT[frame][i];
    if (num3 >= 0) { num2 = i; break; }
  }
  if (num2 === -1) {
    for (let i = num - 1; i >= 0; i--) {
      num3 = TILE_HEIGHT[frame][i];
      if (num3 >= 0) { num2 = i; break; }
    }
  }
  if (num2 === -1) return null;
  return {
    x: tileX * 16 + num2 * 2 - CART_MAGNET_OFFSET.x - (width / 2 - CART_TEXTURE_WIDTH / 2),
    y: tileY * 16 + num3 - CART_MAGNET_OFFSET.y - height / 2,
  };
}

// ============================================================================
// TrackCollision（Minecart.cs:562-945）—— 轨道跟随运动学核心 1:1
// 入参 rider 就地变更（Position/Velocity/lastBoost），返回 BitsByte 结果位。
// ============================================================================
export interface TrackRider {
  x: number; y: number;           // 位置（左上角，与玩家/实体同语义）
  vx: number; vy: number;         // 速度
  lastBoostX: number; lastBoostY: number;
}
export interface TrackCollisionHooks {
  /** 落轨音效/火花（MinecartLandingSound + WheelSparks；fallStart 距离门内触发） */
  landing?: (x: number, y: number) => void;
}

export function trackCollision(
  st: TileStore, r: TrackRider,
  width: number, height: number,
  followDown: boolean, followUp: boolean,
  fallStart: number, trackOnly: boolean,
  hooks: TrackCollisionHooks = {},
): number {
  if (followDown && followUp) { followDown = false; followUp = false; }
  const offX = width / 2 - CART_TEXTURE_WIDTH / 2;
  const offY = height / 2;
  const vector2 = { x: r.x + offX + CART_MAGNET_OFFSET.x, y: r.y + offY + CART_MAGNET_OFFSET.y };
  const vector3 = { x: r.vx, y: r.vy };
  let num = Math.hypot(vector3.x, vector3.y);
  if (num > 0) { vector3.x /= num; vector3.y /= num; }
  const vector4 = { x: vector2.x, y: vector2.y };
  let flag = false;          // 当前格是轨道
  let flag2 = true;          // 首格
  let num4 = -1;             // 上一子段
  let num2 = -1, num3 = -1;  // 上一格坐标
  let tileI = -1;            // 当前格索引
  let trackState: number = NO_TRACK;
  let flag3 = false;         // 压板触发
  let flag4 = false;         // 斜坡起飞
  let flag5 = false;         // 开放端脱轨
  let flag6 = false;         // 端点急停
  const vector5 = { x: 0, y: 0 };
  const vector6 = { x: 0, y: 0 };
  let result = 0;

  while (true) {
    let num5 = Math.trunc(vector4.x / 16);
    let num6 = Math.trunc(vector4.y / 16);
    const q = Math.trunc(vector4.x);
    const num7 = Math.trunc((q % 16) / 2);
    if (flag2) num4 = num7;
    const flag7 = num7 !== num4;
    if ((trackState === ON_BACK || trackState === ON_TRACK || trackState === ON_FRONT) && num5 !== num2) {
      const num8 = trackState !== ON_BACK ? frontTrack(st, tileI) : backTrack(st, tileI);
      const conn = vector3.x < 0 ? leftConnOf(num8) : rightConnOf(num8);
      if (conn === TOP) { num6--; vector4.y -= 2; }
      else if (conn === BOTTOM) { num6++; vector4.y += 2; }
    }
    let trackState2: number = NO_TRACK;
    let flag8 = false;
    if (num5 !== num2 || num6 !== num3) {
      if (flag2) flag2 = false;
      else flag8 = true;
      if (st.inBounds(num5, num6)) {
        tileI = st.idx(num5, num6);
        flag = isTrackCell(st, tileI);
      } else {
        tileI = -1;
        flag = false;
      }
    }
    if (flag) {
      const num9 = frontTrack(st, tileI);
      const num10 = backTrack(st, tileI);
      const num11 = TILE_HEIGHT[num9][num7];
      let trackState3: number = NO_TRACK;
      switch (num11) {
        case OPEN_END:  // -4
          if (trackState === ON_FRONT) {
            if (trackOnly) {
              vector4.x -= vector6.x; vector4.y -= vector6.y;
              num = 0;
              trackState2 = ON_FRONT;
              flag6 = true;
            } else {
              trackState2 = NO_TRACK;
              flag5 = true;
            }
          }
          break;
        case BUMPER_END:  // -1
          if (trackState === ON_FRONT) {
            vector4.x -= vector6.x; vector4.y -= vector6.y;
            num = 0;
            trackState2 = ON_FRONT;
            flag6 = true;
          }
          break;
        case BOUNCY_END: {  // -2
          if (trackState !== ON_FRONT) break;
          if (trackOnly) {
            vector4.x -= vector6.x; vector4.y -= vector6.y;
            num = 0;
            trackState2 = ON_FRONT;
            flag6 = true;
            break;
          }
          if (vector3.x < 0) {
            const num14 = num5 * 16 + (num7 + 1) * 2 - vector4.x;
            vector4.x += num14;
            num += num14 / vector3.x;
          }
          vector3.x = -vector3.x;
          result |= (1 << FLAG_BOUNCY_BUMPER);
          trackState2 = ON_FRONT;
          break;
        }
        case RAMP_END:  // -3：斜坡起飞——水平速度保持，垂直 = |vx|/√2（±45° 旋转）
          if (trackState === ON_FRONT) {
            trackState = NO_TRACK;
            // Minecart.cs:696：vx>0 看 leftConn（==BOTTOM → -45° 上抛，否则 +45° 下抛）；
            // vx<0 镜像看 rightConn
            const rot = r.vx > 0
              ? (leftConnOf(num9) !== BOTTOM ? Math.PI / 4 : -Math.PI / 4)
              : (rightConnOf(num9) !== BOTTOM ? -Math.PI / 4 : Math.PI / 4);
            vector5.x = r.vx * Math.cos(rot);
            vector5.y = r.vx * Math.sin(rot);
            vector5.x = r.vx;
            flag4 = true;
            num = 0;
          }
          break;
        default: {
          const num12 = num6 * 16 + num11;
          if (num5 !== num2 && trackState === NO_TRACK && vector4.y > num12 && vector4.y - num12 < 2) {
            flag8 = false;
            trackState = ABOVE_FRONT;
          }
          const trackState4 = vector4.y < num12 ? ABOVE_TRACK : vector4.y > num12 ? BELOW_TRACK : ON_TRACK;
          if (num10 !== -1) {
            const num13 = num6 * 16 + TILE_HEIGHT[num10][num7];
            trackState3 = vector4.y < num13 ? ABOVE_TRACK : vector4.y > num13 ? BELOW_TRACK : ON_TRACK;
          }
          switch (trackState4) {
            case ON_TRACK:
              trackState2 = trackState3 === ON_TRACK ? ON_TRACK : ON_FRONT;
              break;
            case ABOVE_TRACK:
              trackState2 = trackState3 === ON_TRACK ? ON_BACK
                : trackState3 === BELOW_TRACK ? ABOVE_FRONT
                : trackState3 === ABOVE_TRACK ? ABOVE_TRACK : ABOVE_FRONT;
              break;
            case BELOW_TRACK:
              trackState2 = trackState3 === ON_TRACK ? ON_BACK
                : trackState3 === ABOVE_TRACK ? ABOVE_BACK
                : BELOW_TRACK;
              break;
          }
          break;
        }
      }
    }
    if (!flag8) {
      if (trackState !== trackState2) {
        let flag9 = false;
        if (flag7 || vector3.y > 0) {
          switch (trackState) {
            case ABOVE_TRACK:
              switch (trackState2) {
                case ABOVE_FRONT: trackState2 = ON_BACK; break;
                case ABOVE_BACK: trackState2 = ON_FRONT; break;
                case ABOVE_TRACK: trackState2 = ON_TRACK; break;
              }
              break;
            case ABOVE_FRONT:
              if (trackState2 === BELOW_TRACK) trackState2 = ON_FRONT;
              break;
            case ABOVE_BACK:
              if (trackState2 === BELOW_TRACK) trackState2 = ON_BACK;
              break;
            case ON_FRONT:
              trackState2 = ON_FRONT;
              flag9 = true;
              break;
            case ON_BACK:
              trackState2 = ON_BACK;
              flag9 = true;
              break;
            case ON_TRACK: {
              const front = frontTrack(st, tileI);
              const back = backTrack(st, tileI);
              const num15 = TILE_HEIGHT[front][num7];
              const num16 = back >= 0 ? TILE_HEIGHT[back][num7] : -1;
              trackState2 = followDown
                ? (num15 >= num16 ? ON_FRONT : ON_BACK)
                : (!followUp ? ON_FRONT : (num15 >= num16 ? ON_BACK : ON_FRONT));
              flag9 = true;
              break;
            }
          }
          let num17 = -1;
          switch (trackState2) {
            case ON_TRACK:
            case ON_FRONT:
              num17 = frontTrack(st, tileI);
              break;
            case ON_BACK:
              num17 = backTrack(st, tileI);
              break;
          }
          if (num17 !== -1) {
            if (!flag9 && r.vy > PLAYER_DEFAULT_GRAVITY) {
              const num18 = Math.trunc(r.y / 16);
              if (fallStart < num18 - 1) hooks.landing?.(r.x, r.y);
            }
            if (trackState === ABOVE_FRONT && trackTypeOf(num17) === TYPE_PRESSURE) flag3 = true;
            vector3.y = 0;
            vector4.y = num6 * 16 + TILE_HEIGHT[num17][num7];
          }
        }
      }
    } else if (trackState2 === ON_FRONT || trackState2 === ON_BACK || trackState2 === ON_TRACK) {
      if (flag && trackTypeOf(frontTrack(st, tileI)) === TYPE_PRESSURE) flag3 = true;
      vector3.y = 0;
    }
    if (trackState2 === ON_FRONT) {
      const num19 = frontTrack(st, tileI);
      if (trackTypeOf(num19) === TYPE_BOOSTER && r.lastBoostX === 0 && r.lastBoostY === 0) {
        r.lastBoostX = num5;
        r.lastBoostY = num6;
        if (BOOST_LEFT[num19]) result |= (1 << FLAG_BOOST_LEFT);
        else result |= (1 << FLAG_BOOST_RIGHT);
      }
    }
    num4 = num7;
    trackState = trackState2;
    num2 = num5;
    num3 = num6;
    if (num > 0) {
      // C# 浮点 % 保留被除数符号（负坐标时不归一）——保持 1:1
      const num20 = vector4.x % 2;
      const num21 = vector4.y % 2;
      let num22 = 3, num23 = 3;
      if (vector3.x < 0) num22 = num20 + 0.125;
      else if (vector3.x > 0) num22 = 2 - num20;
      if (vector3.y < 0) num23 = num21 + 0.125;
      else if (vector3.y > 0) num23 = 2 - num21;
      if (num22 === 3 && num23 === 3) break;
      const num24 = Math.abs(num22 / vector3.x);
      const num25 = Math.abs(num23 / vector3.y);
      let num26 = num24 < num25 ? num24 : num25;
      if (num26 > num) {
        vector6.x = vector3.x * num;
        vector6.y = vector3.y * num;
        num = 0;
      } else {
        vector6.x = vector3.x * num26;
        vector6.y = vector3.y * num26;
        num -= num26;
      }
      vector4.x += vector6.x;
      vector4.y += vector6.y;
      continue;
    }
    if (r.lastBoostX !== num2 || r.lastBoostY !== num3) {
      r.lastBoostX = 0;
      r.lastBoostY = 0;
    }
    break;
  }
  if (flag3) result |= (1 << FLAG_HIT_SWITCH);
  if (flag5) {
    r.vx = vector4.x - vector2.x;
    r.vy = PLAYER_DEFAULT_GRAVITY;
  } else if (flag4) {
    result |= (1 << FLAG_USED_RAMP);
    r.vx = vector5.x;
    r.vy = vector5.y;
  } else if (result & (1 << FLAG_BOUNCY_BUMPER)) {
    r.vx = -r.vx;
    r.x = vector4.x - CART_MAGNET_OFFSET.x - offX - r.vx;
    if (vector3.y === 0) r.vy = 0;
  } else {
    if (flag6) r.vx = vector4.x - vector2.x;
    if (vector3.y === 0) r.vy = 0;
  }
  r.y += vector4.y - vector2.y - r.vy;
  r.y = Math.round(r.y * 100) / 100;
  if (trackState === ON_TRACK || trackState === ON_FRONT || trackState === ON_BACK) {
    result |= (1 << FLAG_ON_TRACK);
  }
  return result;
}

// ============================================================================
// TrackRotation / GetWheelsPositions（Minecart.cs:1261-1285）
// 车身倾角 = 两轮轨面连线角；返回 gfxOffY（车身纵向贴轨偏移）
// ============================================================================
export function trackRotation(
  st: TileStore, x: number, y: number, width: number, height: number,
  followDown: boolean, followUp: boolean, rotation: { v: number },
): number {
  const left = wheelPosition(st, x, y, width, height, followDown, followUp, -CART_WHEEL_OFFSET.x);
  const right = wheelPosition(st, x, y, width, height, followDown, followUp, CART_WHEEL_OFFSET.x);
  const dy = right.y - left.y;
  const dx = right.x - left.x;
  const slope = dx !== 0 ? dy / dx : 0;
  const baseY = left.y + (x - left.x) * slope;
  const subY = (x - Math.trunc(x)) * slope;
  rotation.v = Math.atan2(dy, dx);
  return baseY - y + subY;
}

/** 单轮贴轨点（GetWheelsPositions：trackOnly 碰撞 + 速度偏移） */
function wheelPosition(
  st: TileStore, x: number, y: number, width: number, height: number,
  followDown: boolean, followUp: boolean, wheelDX: number,
): { x: number; y: number } {
  const rider: TrackRider = { x, y, vx: wheelDX, vy: 0, lastBoostX: 0, lastBoostY: 0 };
  trackCollision(st, rider, width, height, followDown, followUp, 0, true);
  return { x: rider.x + rider.vx, y: rider.y + rider.vy };
}
