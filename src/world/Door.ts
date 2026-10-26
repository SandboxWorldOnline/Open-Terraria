// 门帧算法（原版 Tiles_10/11 表竖排布局，WorldGen.OpenDoor L22384 / CloseDoor L15901 反推）：
//   关门 style = 36*(frameX/54) + frameY/54 —— 每列 36 个样式，frameX 只有 0/54 两列；
//   frameX = 变体(0/18/36 三张纹理) + 54*列，frameY = 54*(style%36) + 行内偏移(0/18/36)。
//   开门 frameX = 72*列 + (direction==-1 ? 36 : 0)（%72 后 0/36 为锚点列、18/54 为右侧列）。
// 本项目曾误用 frameX = style*54（横排），越界导致门贴图不可见/错位。
import { TileStore } from './TileStore';
import { T, TILE_BY_KEY, TILE_DEFS, TILE_CUT_SHEETS, IS_A_DRIP_TILE_SHEETS, doorSmashable } from '../data/tiles';

/** 关门锚点帧（顶格）：[frameX, frameY] */
export function doorClosedFrame(style: number, variant = 0): [number, number] {
  return [variant * 18 + 54 * Math.floor(style / 36), 54 * (style % 36)];
}

/** 由任意关门格帧反推 style */
export function doorStyleOf(fx: number, fy: number): number {
  return Math.floor(fx / 54) * 36 + Math.floor(fy / 54);
}

/** 生成期放置整扇关闭门（1×3，锚点在顶格 (x,y)） */
export function placeDoorClosed(st: TileStore, x: number, y: number, style: number, variant = 0): void {
  const [fx, fy] = doorClosedFrame(style, variant);
  for (let dy = 0; dy < 3; dy++) {
    if (st.inBounds(x, y + dy)) st.setTileSilent(x, y + dy, T.DOOR_CLOSED, fx, fy + dy * 18);
  }
}

/** 挖除含 (x,y) 格的整扇门（关门 1×3 / 开门 2×3，帧内偏移 = frame%/格步长）。
 *  返回掉落锚点；非门格返回 null。 */
export function clearDoorAt(st: TileStore, x: number, y: number): [number, number] | null {
  const t = st.get(x, y);
  if (t !== T.DOOR_CLOSED && t !== T.DOOR_OPEN) return null;
  const i = st.idx(x, y);
  const w = t === T.DOOR_OPEN ? 2 : 1;
  const col = Math.floor(st.frameX[i] / 18) % w;
  const row = Math.floor(st.frameY[i] / 18) % 3;
  const ax = x - col, ay = y - row;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < 3; dy++) {
      if (st.inBounds(ax + dx, ay + dy) && st.get(ax + dx, ay + dy) === t) st.setTile(ax + dx, ay + dy, 0);
    }
  }
  return [ax, ay];
}

/** ★BJ722-A D2/D3（2026-10-26）：开关门环境注入（形沿 shiftTallGate opts 范式） */
export interface DoorToggleOpts {
  /** 清位列砍切击杀钩（原版 OpenDoor :38090-38097 KillTile——直杀格的掉落/尘/声
   *  面,Game 侧注入 breakTile）。缺省 = 旧 setTile(0) 近似（纯函数测试面;tileCut
   *  直杀格原版有掉落档——草籽 283/蘑菇 60·5·183/藤 2996/药草 83·84 全档,
   *  GetItemDrops case 3/24/52/62/73/110/201/382/519/528/83/84——缺省=零掉落,
   *  BJ721 登记债 D3,Game 侧注入即清偿;件型掉落不受影响=残格经 Check* 级联） */
  killCell?: (x: number, y: number) => void;
}

/** ★BJ722-A D3：GameHooks 侧 killCell 注入便捷构造（无 breakTile 面回落缺省近似） */
export function doorKillCellOpts(
  breakTile?: (x: number, y: number) => void,
): DoorToggleOpts | undefined {
  return breakTile ? { killCell: breakTile } : undefined;
}

/** 开门（原版 OpenDoor 语义）。direction: 玩家面朝方向 ±1。
 *  返回 false = 目标侧被挡（调用方应换 -direction 重试）。 */
export function openDoor(st: TileStore, x: number, y: number, direction: number, opts?: DoorToggleOpts): boolean {
  if (st.get(x, y) !== T.DOOR_CLOSED) return false;
  // ★SW-AS1(2026-09-05):IsLockedDoor 早退（OpenDoor :38027-38030）——神庙锁门
  //  （style 11 段 fy∈[594,646]）拒开。此前仅手动路径有锁拦截（Player.cs:32332
  //  开锁消耗钥匙后 UnlockDoor 出锁区再开门）,DoorOpeningHelper/NPC 直调本函数
  //  会无钥匙开锁门;原版 WorldGen.OpenDoor 自身拒绝。
  if (isLockedDoor(st, x, y)) return false;
  // 锚点行：frameY % 54 === 0
  let ay = y;
  while (st.get(x, ay) === T.DOOR_CLOSED && st.frameY[st.idx(x, ay)] % 54 !== 0) {
    if (--ay < 0) return false;
  }
  if (st.get(x, ay) !== T.DOOR_CLOSED) return false;
  // ★X2-F7(2026-09-04):ValidateTileSquareIsActiveAndOfType(num6,num,1,3,10)
  //  （OpenDoor :38055 调用→:38252-38268）active+type 双验列走查——幽灵门列
  //  （flags=0 残型）拒开（原版头格 :38037 裸读 type 是本相,列验证才查 active）
  for (let dy = 0; dy < 3; dy++) {
    if (!st.inBounds(x, ay + dy) || !st.hasTile(x, ay + dy)
      || st.get(x, ay + dy) !== T.DOOR_CLOSED) return false;
  }
  const ai = st.idx(x, ay);
  const style = doorStyleOf(st.frameX[ai], st.frameY[ai]);
  const col = Math.floor(style / 36), row = style % 36;
  // 目标侧列仅许可砍切格（原版 OpenDoor cs:37698-37715：!tileCut && !=165 && !drip 才失败），
  // 可砍格随后碎掉（:37717-37724 KillTile）。★曾保守要求全空=蛛网堵门永远打不开（偏差）
  const clearX = direction === -1 ? x - 1 : x + 1;
  for (let dy = 0; dy < 3; dy++) {
    const t = st.get(clearX, ay + dy);
    if (t !== 0 && !doorSmashable(t)) return false;
  }
  for (let dy = 0; dy < 3; dy++) {
    if (st.get(clearX, ay + dy) !== 0) {
      // ★BJ722-A D3：KillTile 注入位（:38095）——缺省回落 setTile(0) 近似
      if (opts?.killCell) opts.killCell(clearX, ay + dy);
      else st.setTile(clearX, ay + dy, 0);
    }
  }
  // 开门占 2 列：direction==-1 锚点左移一格、frameX+36（原版 num1/x 逻辑）
  const ax = direction === -1 ? x - 1 : x;
  const baseFx = 72 * col + (direction === -1 ? 36 : 0);
  // ★BJ722-A D2：裸写窗（原版 OpenDoor :38109-38158 六格 active/type/frame 直写,
  //  中途零 TileFrame 派发——仓旧逐格 setTile 中途派发 onTileChanged=BJ721「开门拆门」
  //  的放大器（类型守卫已堵致害面,本窗收口写原子性=对齐债 D2 清偿）。窗后
  //  notifyChanged 补派发（BJ361：渲染 mark 主通道+DECOR/火把/藤全监听族——并入域
  //  2×3 各 3×3 并集 ⊇ 原版尾扫 :38159-38165 4×4 TileFrame 面,幂等复检）
  const touched: Array<[number, number]> = [];
  st.suppressListeners = true;
  try {
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        if (!st.inBounds(ax + dx, ay + dy)) continue;
        st.setTile(ax + dx, ay + dy, T.DOOR_OPEN, baseFx + dx * 18, 54 * row + dy * 18);
        touched.push([ax + dx, ay + dy]);
      }
    }
  } finally {
    st.suppressListeners = false;
  }
  for (const [tx, ty] of touched) st.notifyChanged(tx, ty);
  return true;
}

/** 关门（原版 CloseDoor 语义，点到的可以是开门 2×3 中任意一格）。
 *  blocked = 实体占格判定（原版 Collision.EmptyTile(ignoreTiles:true)：只看玩家/NPC，忽略图格——
 *  关门列此刻还是开门图格）。返回 false = 门位被实体挡住。 */
export function closeDoor(st: TileStore, x: number, y: number, rng: () => number = Math.random, blocked?: (x: number, y: number) => boolean): boolean {
  if (st.get(x, y) !== T.DOOR_OPEN) return false;
  // 锚点行：frameY % 54 === 0
  let ay = y;
  while (st.get(x, ay) === T.DOOR_OPEN && st.frameY[st.idx(x, ay)] % 54 !== 0) {
    if (--ay < 0) return false;
  }
  if (st.get(x, ay) !== T.DOOR_OPEN) return false;
  const fx = st.frameX[st.idx(x, ay)];
  // 原版 switch(frameX % 72)：关门列与开门方向
  let closedX: number;
  switch (fx % 72) {
    case 18: closedX = x - 1; break;   // 点到右侧列 → 锚点在左
    case 36: closedX = x + 1; break;   // direction==-1 的锚点列
    case 54: closedX = x; break;       // direction==-1 的右侧列
    default: closedX = x; break;       // 0：direction==+1 锚点列
  }
  // 关门位实体检查（原版 Collision.EmptyTile(ignoreTiles:true)：图格忽略，只挡实体）
  for (let dy = 0; dy < 3; dy++) {
    if (blocked?.(closedX, ay + dy)) return false;
  }
  // 样式行先取（清格后 frameY 归零；原版关门不重写 frameY，样式行开门/关门一致）
  const col = Math.floor(fx / 72);
  const row = Math.floor(st.frameY[st.idx(x, ay)] / 54) % 36;
  // 清扫区内的【开门图格】清空、关门列稍后重写（原版 :32037-32057:
  // `tile2.type == 11` 才动——l==num2 转关门型,否则 active(false)）。
  // ★曾 3 列无差别 setTile(0):门朝空侧开再关时 sweepR=x+1 越过门自身两列,
  // 把旁贴工作台/墓碑的半边格直接抹掉(用户报"开关门切半贴图",2026-08-14)
  const sweepL = Math.min(closedX, x - 1), sweepR = Math.max(closedX + 1, x + 1);
  // ★BJ722-A D2：裸写窗（原版 CloseDoor :32155-32173 写循环 type=10/active(false)
  //  直写零派发+尾扫 :32185-32189 3×4 TileFrame 一次——仓旧逐格 setTile 中途派发
  //  =BJ322 家族写原子性债;窗后 notifyChanged 补派发（BJ361 渲染 mark+监听全族,
  //  并入域 ⊇ 原版 3×4 尾扫面,幂等）。无 smash 清位（vanilla 关门不砍切）
  const touched: Array<[number, number]> = [];
  st.suppressListeners = true;
  try {
    for (let sx = sweepL; sx <= sweepR; sx++) {
      for (let dy = 0; dy < 3; dy++) {
        if (!st.inBounds(sx, ay + dy)) continue;
        if (st.get(sx, ay + dy) === T.DOOR_OPEN) {
          st.setTile(sx, ay + dy, 0);
          touched.push([sx, ay + dy]);
        }
      }
    }
    const [cfx] = doorClosedFrame(col * 36, Math.floor(rng() * 3));
    for (let dy = 0; dy < 3; dy++) {
      if (!st.inBounds(closedX, ay + dy)) continue;
      st.setTile(closedX, ay + dy, T.DOOR_CLOSED, cfx, 54 * row + dy * 18);
      touched.push([closedX, ay + dy]);
    }
  } finally {
    st.suppressListeners = false;
  }
  for (const [tx, ty] of touched) st.notifyChanged(tx, ty);
  return true;
}

// ================= 高门（Tall Gate 388/389，WorldGen.ShiftTallGate :52175-52231） =================
// 关(388)/开(389) 两张表同布局（18×188）：切换 = 保帧换 type（:52215-52219 只直写
// tile.type,帧不动）；开门声 SoundID 8（:52213）。
// ★2026-09-02 九批（M-2）帧约定归一：CoordinateHeights={18,16,16,16,18}+pad2
// （TileObjectData.cs:2303-2306,addTile(388) :2323;389=FullCopyFrom(388) :2324-2325），
// CoordinateFullHeight=Σ(heights+pad)=94（:1805-1820 Calculate）——行帧=TileObject.Place
// heights+padding 累进（TileObject.cs:96-108 num9）= 0/20/38/56/74。★旧实现在此用
// 「fy%90 /18」行解码（90=5×18）只对本仓旧 18px 步进自洽；frames 归原版后按原版
// heights 递减法（CheckTallGate :52129-52133 同式）解码,两端（放置面/迁移）统一。

/** 高门 CoordinateHeights（TileObjectData.cs:2303）——唯一权威表（Game.ts 同源引用） */
export const TALL_GATE_HEIGHTS: readonly number[] = [18, 16, 16, 16, 18];
/** CoordinateFullHeight = Σ(heights+2) = 94（TileObjectData.cs:1805-1820 Calculate） */
export const TALL_GATE_CFH = TALL_GATE_HEIGHTS.reduce((a, b) => a + b + 2, 0);
/** 行内 frameY 累进（TileObject.Place :96-108 num9 += heights[l]+padding）= 0/20/38/56/74 */
export const TALL_GATE_ROW_FY: readonly number[] = (() => {
  const out: number[] = [0];
  for (let i = 0; i < TALL_GATE_HEIGHTS.length - 1; i++) out.push(out[i] + TALL_GATE_HEIGHTS[i] + 2);
  return out;
})();
/** CheckTallGate/ShiftTallGate 行归一（WorldGen.cs:52129-52133）：frameY%CFH 经
 *  heights 递减 → 行内序号 0..4（负值防御性取正模,原版帧域不产负） */
export function tallGateRowOf(frameY: number): number {
  let row = 0;
  let num = ((frameY % TALL_GATE_CFH) + TALL_GATE_CFH) % TALL_GATE_CFH;
  for (; row < TALL_GATE_HEIGHTS.length && num - TALL_GATE_HEIGHTS[row] >= 0; row++) {
    num -= TALL_GATE_HEIGHTS[row];
  }
  return row;
}

/** shiftTallGate 环境注入（★BJ322 2026-09-24,原版 ShiftTallGate 内置臂的外置面） */
export interface ShiftTallGateOpts {
  /** msg19 网络重放臂（MessageBuffer.cs:1320/:1323 `forced:true`）——跳过实体占位门 */
  forced?: boolean;
  /** Collision.EmptyTile(x,y+k,ignoreTiles:true) 占位谓词（占用=true,WorldGen.cs:52206-52212
   *  `!forced && !EmptyTile → return false`;开/关两向同门）。无注入=无门（纯函数测试面） */
  blocked?: (x: number, y: number) => boolean;
  /** Wiring.SkipWire(x,y+j) 臂（:52201-52207,Wiring.running 时导线路径注入） */
  skipCell?: (x: number, y: number) => void;
  /** 尾 TileFrame 面（:52224-52231 x-1..x+1 × y-1..y+h）——写完整列后跑一次完整性/
   *  邻件复检（本仓 checkDecorSquareFrame 扫面）。不注入=不评估（旧行为） */
  afterWrite?: (ax: number, ay: number) => void;
}

/** 切换高门（closing=true 关、false 开）。锚点可为门内任意格；返回锚点坐标或 null。
 *  原版序（WorldGen.cs:52175-52231）：Validate 方格(:52196)→SkipWire(:52201)→
 *  EmptyTile 实体门(:52206,forced 豁免)→Sound 8(:52213)→整列 type 直写(:52215-52219,
 *  帧逐格原样保留)→TileFrame 面(:52224)。★BJ322：整列写包 st.suppressListeners 裸写窗
 *  （原版逐格直写无 TileFrame）,写完经 afterWrite 跑一次完整性=「写完再评估」——
 *  修复右击时半写态被 CheckTallGate 判坏 → killDecorTile 中途吃掉已写格
 *  （残缺贴图+误掉 3240,用户实报）。 */
export function shiftTallGate(
  st: TileStore, x: number, y: number, closing: boolean,
  sfx?: (name: string) => void,
  opts?: ShiftTallGateOpts,
): [number, number] | null {
  const CLOSED = TILE_BY_KEY['v_388_tall_gate_closed'];
  const OPEN = TILE_BY_KEY['v_389_tall_gate_open'];
  if (!CLOSED || !OPEN) return null;
  const from = closing ? OPEN : CLOSED;
  const to = closing ? CLOSED : OPEN;
  const i0 = st.idx(x, y);
  if (st.type[i0] !== from) return null;
  const fy = st.frameY[i0];
  const anchorY = y - tallGateRowOf(fy);   // :52129-52134 heights 递减行归一
  for (let dy = 0; dy < 5; dy++) {
    const ii = st.idx(x, anchorY + dy);
    // ★X2-F7(2026-09-04):ValidateTileSquareIsActiveAndOfType（:38252-38268,
    //  ShiftTallGate :52196 调用）= `!tile.active() || tile.type != type` 双验——
    //  补 active 半边:幽灵门列（flags=0 残型）拒切换（不复活残型）
    if (!st.inBounds(x, anchorY + dy) || !st.hasTile(x, anchorY + dy)
      || st.type[ii] !== from) return null;
  }
  // SkipWire 先于实体门（:52201-52207 → :52206 原版序;失败早退也照跳=原版本相）
  if (opts?.skipCell) {
    for (let dy = 0; dy < 5; dy++) opts.skipCell(x, anchorY + dy);
  }
  // 实体占位门（:52206-52212,开/关两向;EmptyTile(ignoreTiles:true)=只看玩家/NPC）
  if (!opts?.forced && opts?.blocked) {
    for (let dy = 0; dy < 5; dy++) {
      if (opts.blocked(x, anchorY + dy)) return null;
    }
  }
  sfx?.('door_open'); // 高门恒播 SoundID 8 不分开关(ShiftTallGate :52213,★引注修正:旧注 :51786 失真);旧'door'非法名经 as 断言静默失效
  // 整列 type 直写（:52215-52219 `tileSafely.type = type`——帧【逐格】原样保留,
  //  ★不以下击格 frameX 齐化他行;裸写窗内无监听派发=原版无逐格 TileFrame 同相）
  const snap: Array<[number, number]> = [];
  for (let dy = 0; dy < 5; dy++) {
    const ii = st.idx(x, anchorY + dy);
    snap.push([st.frameX[ii], st.frameY[ii]]);
  }
  st.suppressListeners = true;
  try {
    for (let dy = 0; dy < 5; dy++) {
      st.setTile(x, anchorY + dy, to, snap[dy][0], snap[dy][1]);
    }
  } finally {
    st.suppressListeners = false;
  }
  // ★BJ361（2026-09-25）：裸写窗吃掉了监听派发,其中含渲染 mark 主通道（ChunkCache
  //  订阅 onTileChanged→markDirtyAround,ChunkCache.ts:300）——窗后不补派发 = type 已
  //  切换而 chunk 烘焙缓存不失效 = 门开关贴图不变化（用户实报回归,BJ361 探针定谳:
  //  toggle 后门 chunk 零 markDirty）。窗后整件已完整 → 补派发不会半写态判坏（BJ322
  //  窗动机保留）。域=写入的 5 格列（帧逐格原样保留,周边格未被写无需派发）。
  for (let dy = 0; dy < 5; dy++) st.notifyChanged(x, anchorY + dy);
  // 尾 TileFrame 面（:52224-52231）——Game 侧注入 checkDecorSquareFrame 扫面
  opts?.afterWrite?.(x, anchorY);
  return [x, anchorY];
}

/** WorldGen.IsLockedDoor（cs:69248-69255）：门 10 且 frameY∈[594,646]（style 11
 *  神庙锁门段）且 frameX<54（关闭态）——开锁消耗神庙钥匙 1141（Player.cs:32332-32357） */
export function isLockedDoor(st: TileStore, x: number, y: number): boolean {
  const i = st.idx(x, y);
  // WorldGen.cs:69248：type==10(关门表)——原版 tile id 10,此处须比内部 id
  //（door_closed=17）。★曾写 st.type[i]===10：10 是 sheet id,内部 id 空间恒 false
  // → 神庙锁门(PlaceDoor style11, fy=594)开锁链全灭,无钥匙也能开(2026-08-13)。
  return st.type[i] === T.DOOR_CLOSED && st.frameY[i] >= 594 && st.frameY[i] <= 646 && st.frameX[i] < 54;
}

/** WorldGen.UnlockDoor（cs:37613-37640）：向上扫锁段顶格（frameY==594），三格
 *  frameY += 54（移出 [594,646] 锁区 → 变普通可开关门）+ 播 SoundID 22 */
export function unlockDoor(st: TileStore, x: number, y: number, sfx?: (n: string) => void): boolean {
  if (!isLockedDoor(st, x, y)) return false;
  let top = y;
  while (st.frameY[st.idx(x, top)] !== 594) {
    top--;
    if (top <= 0 || st.frameY[st.idx(x, top)] < 594) return false;
  }
  for (let k = top; k <= top + 2; k++) {
    const i = st.idx(x, k);
    st.frameY[i] += 54;
  }
  sfx?.('unlock');
  return true;
}

// ================= 活板门（Trapdoor 386 开/387 关，WorldGen.ShiftTrapdoor :51897-52048） =================
// ★BJ324（2026-09-24）BJ322 登记债清偿：完整移植原版 ShiftTrapdoor 1:1（1457 与 1458
//  两版逐字节全等——WorldGen.cs:51897-52048 / :51905-52056 diff 实测零差异）。
//  病灶（BJ322 定谳）：旧 devices.shiftTrapdoorFlip 一行写对 2×2 开态本身几何残缺
//  （BJ250 帧近似无折翼臂/无 Validate/无尾 TileFrame 面），右键/导线翻转时逐格
//  setTile 即时派发把【半写态】交 CheckTrapDoor 完整性复查中途判坏（探针=半件翻转
//  +掉 3239）。cure=完整移植（单加裸写窗只会把半件翻转变成「判坏整件清」，非治愈）。
//  原版语义（亲读定谳）：
//  · 折翼臂两向：开态 386 是 2×2（帧面 72×36,frameX∈{0,18,36,54},frameY∈{0,18}——
//    PNG 容量实测），styleX=frameX/36 双开向。关门(386→387)按 styleX 定臂：
//    styleX=0 清【顶】行写 387 于【底】行（开向=向上折,关位=底行=原关行）;
//    styleX=1 清【底】行写 387 于【顶】行（开向=向下折,关位=顶行=原关行）。
//    关位行恒=切换前的原关行（锚行不变式:CheckTrapDoor 386 锚行 styleX=0→底行
//    y+1 / styleX=1→顶行 y,:52064-52069——与 387 锚行=本行 :52059-52063 首尾自洽）。
//  · 开门(387→386)方向由【玩家相对高度】定：playerAbove=真 → 折翼向下（远离玩家,
//    开态行 y..y+1,frameX=列*18+36 即 styleX=1）;假 → 向上（行 y-1..y,styleX=0）。
//    :52033 `frameX = num6*18 + playerAbove.ToInt()*36`、行基 :52027
//    `y + num7 - (!playerAbove).ToInt()`。
//  · 无折翼动画：原版 ShiftTrapdoor 全文无动画/计数器面——瞬时 type+帧直写+一声
//    SoundID 8（两向同声,DoorOpen legacy 8;SoundID.cs:39 `DoorOpen = 8`）。
//  · 完整性门序：386 臂 Validate(:51905/:51947)→SkipWire(:51907/:51949)→
//    EmptyTile 实体占位门(:51915/:51957,只查 387 目标行)→Sound→ClearTile→写 387→
//    TileFrame 面(:51925-51929/:51950-51954);387 臂 CanKillTile 门(:51990-51992)→
//    Validate(:51994)→折翼行可砍门(:51998-52002,active 且非 tileCut 且非
//    IsADripTile 拒)→SkipWire(:52004)→Sound(:52010)→砍切 KillTile(:52012-52017)→
//    写 2×2(:52019-52032,逐列 BlockColorAndCoating 缓存+UseBlockColors 还原=开态
//    全体继承关格漆/涂层,Tile.cs:876-886 块侧三字段)→TileFrame 面(:52008-52012 注:
//    实际 :52034-52040)。
//  · 无臂可走尾流:SoundID 9(DoorClosed legacy 9,SoundID.cs:40)+return false
//    (:52045-52047)——臂内失败(false 早退)【不】响声,仅「格非活板门/onlyCloseOrOpen
//    冲突」才落尾流。

/** shiftTrapdoor 环境注入（★BJ324 2026-09-24,原版 ShiftTrapdoor 内置臂的外置面;
 *  形状沿 BJ322 shiftTallGate opts 范式） */
export interface ShiftTrapdoorOpts {
  /** msg19 重放臂 onlyCloseOrOpen（MessageBuffer.cs:1314 case2 传 1=只许开[跳过 386 关
   *  臂]/:1317 case3 传 0=只许关[跳过 387 开臂];缺省 -1=两向,右键/导线臂本相） */
  onlyCloseOrOpen?: number;
  /** Wiring.SkipWire 臂（原版门 `Main.netMode != 1 && Wiring.running` :51907/:51949/
   *  :52004——门在调用方:仅导线路径注入,右键臂不注入[旧 shiftTrapdoorFlip 右键也
   *  skipCell=wireSkip 污染下一轮导线判定,本刀随原版门修正]） */
  skipCell?: (x: number, y: number) => void;
  /** Collision.EmptyTile(x,y,ignoreTiles:true) 占位谓词（占用=true）——关门两 case
   *  的 387 目标行逐格双查（:51915-51917 styleX0 底行 / :51957-51959 styleX1 顶行）;
   *  开门臂原版【无】实体门（折翼行只挡图格不挡实体,:51998-52002）。无注入=无门
   *  （纯函数测试面） */
  blocked?: (x: number, y: number) => boolean;
  /** WorldGen.CanKillTile(i,j) 门（:51990-51992 关门件本体可毁检查;无注入=不评估） */
  canKill?: (x: number, y: number) => boolean;
  /** 音效钩：成功=SoundID 8 两向同声（'door_open';:51919/:51961/:52010）,无臂可走
   *  尾流=SoundID 9（'door_close';:52045）。带原版落点像素坐标 */
  sfx?: (name: 'door_open' | 'door_close', px: number, py: number) => void;
  /** 尾 TileFrame 面（:51925-51929 styleX0 关 4×3 / :51950-51954 styleX1 关 4×3 /
   *  :52034-52040 开 4×4）逐格回调——本仓等价=checkDecorSquareFrame 逐格
   *  （幂等,件内任一格评估=整件完整性裁决）。不注入=不评估（旧行为） */
  tileFrame?: (x: number, y: number) => void;
}

/** ValidateTileSquareIsActiveAndOfType（WorldGen.cs:38252-38268）1:1：方格域全部
 *  InWorld+active+type 三验（幽灵格 flags=0 残型拒——X2-F7 同款双验,不复活残型） */
function validateTrapdoorSquare(st: TileStore, x: number, y: number, w: number, h: number, type: number): boolean {
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      if (!st.inBounds(x + i, y + j) || !st.hasTile(x + i, y + j) || st.get(x + i, y + j) !== type) return false;
    }
  }
  return true;
}

/** 格的原版 sheet id（内部 id 域→vanilla sheet, Wiring.sheetOf 同式） */
function cellSheet(st: TileStore, x: number, y: number): number {
  return TILE_DEFS[st.get(x, y)]?.vanilla?.sheet ?? -1;
}

/** 折翼行可砍判据（:51999-52001 `active() && !Main.tileCut[type] && !IsADripTile[type]`）:
 *  返回 true=该格阻塞折翼（拒开） */
function foldRowBlocked(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y) || !st.hasTile(x, y)) return false;
  const sh = cellSheet(st, x, y);
  return !TILE_CUT_SHEETS.has(sh) && !IS_A_DRIP_TILE_SHEETS.has(sh);
}

/** 切换活板门（WorldGen.ShiftTrapdoor :51897-52048 全臂 1:1;x,y 可为件内任意格,
 *  原版 GetTopLeftAndStyles(:52230-52244) 归一语义内联）。playerAbove=玩家中心在
 *  点击格上方（Player.cs:32539 `myY*16 > Center.Y`）。返回是否成功切换。
 *  ★失败早退【无】音效（原版臂内 return false 同相）,仅无臂可走尾流响 SoundID 9。 */
export function shiftTrapdoor(
  st: TileStore, x: number, y: number, playerAbove: boolean,
  opts?: ShiftTrapdoorOpts,
): boolean {
  const OPEN = TILE_BY_KEY['v_386_trapdooropen'];
  const CLOSED = TILE_BY_KEY['v_387_trap_door_closed'];
  if (!OPEN || !CLOSED) return false;
  if (!st.inBounds(x, y)) return false;
  const i0 = st.idx(x, y);
  const t0 = st.type[i0];
  const oc = opts?.onlyCloseOrOpen ?? -1;
  // ref 语义镜像（GetTopLeftAndStyles ref x,y 原版就地改——尾流音坐标消费改后值;
  //  可达路径中仅不可达的 styleX∉{0,1} 分支落尾流时携带改后值）
  let vx = x, vy = y;

  // ============ 386 关臂（:51898-51955,onlyCloseOrOpen!=1 才走） ============
  if (t0 === OPEN && oc !== 1) {
    // GetTopLeftAndStyles(ref x,ref y,2,2,18,18) :51902：styleX=fx/36、styleY=fy/36;
    //   锚归一 x-=fx/18%2、y-=fy/18%2（:52236-52242）
    const fx0 = st.frameX[i0], fy0 = st.frameY[i0];
    const styleX = Math.floor(fx0 / 36);
    const styleY = Math.floor(fy0 / 36);
    const ax = x - (Math.floor(fx0 / 18) % 2);
    const ay = y - (Math.floor(fy0 / 18) % 2);
    vx = ax; vy = ay;
    if (styleX === 0) {
      // Validate 2×2(:51905) → SkipWire 2×2(:51907-51913,失败早退也照跳=先于占位门)
      if (!validateTrapdoorSquare(st, ax, ay, 2, 2, OPEN)) return false;
      opts?.skipCell?.(ax, ay); opts?.skipCell?.(ax, ay + 1);
      opts?.skipCell?.(ax + 1, ay); opts?.skipCell?.(ax + 1, ay + 1);
      // EmptyTile 目标行=底行 ay+1（:51915-51917 `!EmptyTile(x,y+1) || !EmptyTile(x+1,y+1)`）
      if (opts?.blocked && (opts.blocked(ax, ay + 1) || opts.blocked(ax + 1, ay + 1))) return false;
      opts?.sfx?.('door_open', ax * 16 + 16, ay * 16 + 16);   // :51919
      st.suppressListeners = true;
      try {
        for (let i = 0; i < 2; i++) {           // 清顶行（:51921-51927,active+386 才 Clear）
          const ci = st.idx(ax + i, ay);
          if (st.flags[ci] !== 0 && st.type[ci] === OPEN) st.setTile(ax + i, ay, 0);
        }
        for (let j = 0; j < 2; j++) {           // 底行写 387（:51929-51935,frameX=j*18,frameY=styleY*18）
          st.setTile(ax + j, ay + 1, CLOSED, j * 18, styleY * 18);
        }
      } finally { st.suppressListeners = false; }
      // ★BJ361：窗后写入域补派发（渲染 mark 主通道,同 shiftTallGate 注）
      for (let i = 0; i < 2; i++) { st.notifyChanged(ax + i, ay); st.notifyChanged(ax + i, ay + 1); }
      for (let k = -1; k < 3; k++) for (let l = 0; l < 3; l++) {   // TileFace x-1..x+2 × y..y+2(:51937-51943)
        if (st.inBounds(ax + k, ay + l)) opts?.tileFrame?.(ax + k, ay + l);
      }
      return true;
    }
    if (styleX === 1) {
      // Validate(:51947) → SkipWire 行 ay-1..ay(:51949-51955,★原版跳含门外上一行)
      if (!validateTrapdoorSquare(st, ax, ay, 2, 2, OPEN)) return false;
      opts?.skipCell?.(ax, ay - 1); opts?.skipCell?.(ax, ay);
      opts?.skipCell?.(ax + 1, ay - 1); opts?.skipCell?.(ax + 1, ay);
      // EmptyTile 目标行=顶行 ay（:51957-51959）
      if (opts?.blocked && (opts.blocked(ax, ay) || opts.blocked(ax + 1, ay))) return false;
      opts?.sfx?.('door_open', ax * 16 + 16, ay * 16);        // :51961
      st.suppressListeners = true;
      try {
        for (let m = 0; m < 2; m++) {           // 清底行（:51963-51968,无条件 ClearTile——Validate 已保全活）
          st.setTile(ax + m, ay + 1, 0);
        }
        for (let n = 0; n < 2; n++) {           // 顶行写 387（:51970-51976）
          st.setTile(ax + n, ay, CLOSED, n * 18, styleY * 18);
        }
      } finally { st.suppressListeners = false; }
      // ★BJ361：窗后写入域补派发（渲染 mark 主通道,同 shiftTallGate 注）
      for (let m = 0; m < 2; m++) { st.notifyChanged(ax + m, ay); st.notifyChanged(ax + m, ay + 1); }
      for (let k = -1; k < 3; k++) for (let l = -1; l < 2; l++) {  // TileFace x-1..x+2 × y-1..y+1(:51978-51984)
        if (st.inBounds(ax + k, ay + l)) opts?.tileFrame?.(ax + k, ay + l);
      }
      return true;
    }
    // styleX∉{0,1}（72px 帧面不可达）：原版落穿 387 臂检查（type 仍 386 不入）→尾流
  }

  // ============ 387 开臂（:51957-52044,onlyCloseOrOpen!=0 才走） ============
  if (t0 === CLOSED && oc !== 0) {
    // GetTopLeftAndStyles(ref x,ref y,2,1,18,18) :51987——返回值【弃】(无 style 传承);
    //   x-=fx/18%2 归一左列;y-=fy/18%1≡0 行不动（h=1,点击行=关行）
    const fx1 = st.frameX[i0];
    const ax = x - (Math.floor(fx1 / 18) % 2);
    vx = ax;
    // CanKillTile 门（:51990-51992）——活着的 387 格须可毁,否则拒开（静默 false）
    const notKillable = (cx: number) => st.inBounds(cx, y) && st.hasTile(cx, y)
      && st.get(cx, y) === CLOSED && opts?.canKill != null && !opts.canKill(cx, y);
    if (notKillable(ax) || notKillable(ax + 1)) return false;
    // Validate 2×1（:51994）
    if (!validateTrapdoorSquare(st, ax, y, 2, 1, CLOSED)) return false;
    const num3 = playerAbove ? 1 : -1;                       // :51997 折翼行方向
    // 折翼行门（:51998-52002）：活格且非 tileCut 且非 IsADripTile → 拒（实体不挡）
    if (foldRowBlocked(st, ax, y + num3) || foldRowBlocked(st, ax + 1, y + num3)) return false;
    // SkipWire 关行+折翼行四格（:52004-52008）
    opts?.skipCell?.(ax, y); opts?.skipCell?.(ax, y + num3);
    opts?.skipCell?.(ax + 1, y); opts?.skipCell?.(ax + 1, y + num3);
    opts?.sfx?.('door_open', ax * 16 + 16, y * 16);          // :52010
    // 砍切折翼行（:52012-52017 KillTile——tileCut/drip 掉落全 null,openDoor :82 同款
    //  setTile(0) KillTile 近似先例）
    for (let c = 0; c < 2; c++) {
      const cx = ax + c, cy = y + num3;
      if (st.inBounds(cx, cy) && st.hasTile(cx, cy)) {
        const sh = cellSheet(st, cx, cy);
        if (TILE_CUT_SHEETS.has(sh) || IS_A_DRIP_TILE_SHEETS.has(sh)) st.setTile(cx, cy, 0);
      }
    }
    st.suppressListeners = true;
    try {
      for (let col = 0; col < 2; col++) {
        // 逐列先缓存关格块侧漆/涂层（:52020 BlockColorAndCoating,Tile.cs:876-886 块侧
        //  color+fullbrightBlock+invisibleBlock 三字段=本仓 paint+coat 块侧两位）
        const ci = st.idx(ax + col, y);
        const cacheP = st.paint[ci];
        const cacheC = st.coat[ci] & TileStore.COAT_BLOCK_MASK;
        for (let row7 = 0; row7 < 2; row7++) {
          // 行基 :52022 `y + num7 - (!playerAbove).ToInt()`：playerAbove→y..y+1（向下折）
          const wy = y + row7 - (playerAbove ? 0 : 1);
          if (!st.inBounds(ax + col, wy)) continue;
          // :52025-52027 type=386、frameX=col*18+playerAbove.ToInt()*36、frameY=row7*18
          st.setTile(ax + col, wy, OPEN, col * 18 + (playerAbove ? 36 : 0), row7 * 18);
          const wi = st.idx(ax + col, wy);
          st.paint[wi] = cacheP;                              // UseBlockColors(:52029) 块侧还原
          st.coat[wi] = (st.coat[wi] & ~TileStore.COAT_BLOCK_MASK) | cacheC;
        }
      }
    } finally { st.suppressListeners = false; }
    // ★BJ361：窗后写入域补派发（渲染 mark 主通道,同 shiftTallGate 注）——
    // 域=开态写入 2×2（wy 范围随 playerAbove: y..y+1 / y-1..y）
    const wy0 = y - (playerAbove ? 0 : 1);
    for (let col = 0; col < 2; col++) {
      for (let row7 = 0; row7 < 2; row7++) st.notifyChanged(ax + col, wy0 + row7);
    }
    // TileFace x-1..x+2 × y-1..y+2 带基 -(!playerAbove)*2（:52034-52040）：
    //   playerAbove→y-1..y+2 / !playerAbove→y-3..y
    const yOff = playerAbove ? 0 : -2;
    for (let k = -1; k < 3; k++) for (let l = -1; l < 3; l++) {
      if (st.inBounds(ax + k, y + l + yOff)) opts?.tileFrame?.(ax + k, y + l + yOff);
    }
    return true;
  }

  // ============ 无臂可走尾流（:52045-52047）：SoundID 9=DoorClosed + false ============
  opts?.sfx?.('door_close', vx * 16, vy * 16);
  return false;
}
