// 原版 Wiring.cs(1.4.0.5)一比一移植:四色导线信号传播 + 逻辑门 + 泵 + 传送器 + 致动器。
// 结构与行号对照:
//   updateMech        Wiring.cs:88-161(计时器/引爆器冷却,每 tick 调)
//   hitSwitch         Wiring.cs:163-252(手动/物理触发源)
//   checkMech         Wiring.cs:313-327(陷阱冷却注册,上限 999)
//   xferWater         Wiring.cs:329-377(泵配对液体转移)
//   tripWire          Wiring.cs:379-529(四色 pass 顺序 红→蓝→绿→黄)
//   pixelBoxPass      Wiring.cs:531-553
//   logicGatePass     Wiring.cs:555-591
//   checkLogicGate    Wiring.cs:593-691(六种门 + 故障灯)
//   hitWire           Wiring.cs:693-827(BFS;邻居序 下/上/右/左;分线盒预算)
//   hitWireSingle     Wiring.cs:829-2282(核心 case 在此,其余委托 devices 表)
//   actuate/actuateForced/deActive/reActive  :262-280, :2373-2405
//   massWireOperation :2407-2558(宏伟蓝图 L 形铺线)
// 单机移植:NetMessage/SendData 一律跳过(原版联机同步,无操作)。
import { TileStore } from './TileStore';
import { TILE_DEFS, PREVENTS_ACTUATION_UNDER_SHEETS } from '../data/tiles';
import { canKillTileAt, type KillTileCtx } from '../entities/Mounts';
import { vanRuntimeTileSolid } from './gen/vanilla/GenSolid';   // ★BJ754 TF-13：deActive tileSolid 域

/** 器件分发表(P3 devices.ts 提供):返回 true 表示已处理该 case */
export type DeviceHandler = (w: Wiring, sheet: number, x: number, y: number) => boolean;

// ★2026-09-03 五常量抽出至 data/wiringToolBits.ts（叶子模块,TDZ 断环——items.ts
//  顶层 WIRED_TOOLS 读这组常量而本模块 import 子树回流 items,冷启动序炸 boot）。
import { TOOL_RED, TOOL_GREEN, TOOL_BLUE, TOOL_YELLOW, TOOL_ACTUATOR } from '../data/wiringToolBits';
/** 多色工具模式位(WiresUI.Settings.MultiToolMode)——叶子模块 re-export 兼容 */
export { TOOL_RED, TOOL_GREEN, TOOL_BLUE, TOOL_YELLOW, TOOL_ACTUATOR };
export const TOOL_CUTTER = 32;

const MAX_PUMP = 20;   // Wiring.cs:34(MaxPump=20,填充上限 19)
const MAX_MECH = 1000; // Wiring.cs:41(MaxMech=1000,注册上限 999)

/** TileID.Sets.PreventsActuationUnder（TileID.cs:313）：下方不可被致动器缩入的承载物。
 *  旧表只列宝箱族/祭坛（21/88/467/237），漏音乐盒 26/花盆 77/垃圾桶 470/475/
 *  茶壶 597/饼干 441/望远镜 468。★R20-I6:devices.ts case 130 同表消费（导出）
 *  ★BJ263 收编单源 data/tiles.ts:PREVENTS_ACTUATION_UNDER_SHEETS（逐值对拍全等,§6l） */
export const PREVENTS_ACTUATION_UNDER: ReadonlySet<number> = PREVENTS_ACTUATION_UNDER_SHEETS;

/**
 * 宏伟蓝图 L 形路由格序单源（Wiring.cs MassWireOperationInner :3248-3337 1:1）。
 * 朝向段序：dirFirstVertical=true（玩家朝右 `dir = master.direction == 1`
 * Wiring.cs:3259/:436）=先竖段（x=ps.x 固定,y ps.y→pe.y 开区间）后横段
 * （y=pe.y 固定,x ps.x→pe.x 开区间）+端点 pe;朝左=先横段（y=ps.y）后竖段
 * （x=pe.x）+端点。同行/同列拖拽=一段空转（`i != num4` 首拍即断）=纯直线,
 * 斜拖=L 形（原版本相——预览绘制 Main.cs:32241+ 同段序 flag34=direction==1,
 * 与放置同源）。cells 顺序=原版放置/预览顺序;Renderer.drawGrandPreview 与
 * massWireOperation 单源消费（★BJ613 预览/放置零分歧判据）。
 */
export function grandDesignPath(
  ps: [number, number], pe: [number, number], dirFirstVertical: boolean,
): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  if (dirFirstVertical) {
    const sy = Math.sign(pe[1] - ps[1]);
    for (let y = ps[1]; y !== pe[1]; y += sy) cells.push([ps[0], y]);
    const sx = Math.sign(pe[0] - ps[0]);
    for (let x = ps[0]; x !== pe[0]; x += sx) cells.push([x, pe[1]]);
  } else {
    const sx = Math.sign(pe[0] - ps[0]);
    for (let x = ps[0]; x !== pe[0]; x += sx) cells.push([x, ps[1]]);
    const sy = Math.sign(pe[1] - ps[1]);
    for (let y = ps[1]; y !== pe[1]; y += sy) cells.push([pe[0], y]);
  }
  cells.push([pe[0], pe[1]]);
  return cells;
}

/**
 * 蓝图拖拽 ghost 连接掩码（Main.cs:43621-43640 同码表:上+18 右+36 下+72 左+144）。
 * 邻接判【路径成员】非世界线邻接——原版预览逐格端帽/中段/角点帧即此掩码
 * （Main.cs:32157-32405:start 段向帽/中段 90|180/角 54|108|162|216/端点帽,
 * Projectile_651 帧表 X=掩码×18px 距,288×36=16 掩码列×2 行）。单格=0（孤点帧）。
 */
export function pathConnectionMasks(cells: Array<[number, number]>): Array<number> {
  const set = new Set(cells.map(([x, y]) => `${x},${y}`));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  return cells.map(([x, y]) =>
    (has(x, y - 1) ? 18 : 0) |
    (has(x + 1, y) ? 36 : 0) |
    (has(x, y + 1) ? 72 : 0) |
    (has(x - 1, y) ? 144 : 0));
}

export class Wiring {
  readonly st: TileStore;
  /** 器件表(P3 注入) */
  device: DeviceHandler | null = null;
  /** 传送器对执行(引擎侧搬迁玩家/敌人;P3 注入) */
  teleportPair: ((a: [number, number], b: [number, number]) => void) | null = null;
  /** 世界地表行(蜥蜴砖致动限制 Wiring.cs:2375) */
  worldSurface = 0;
  /** HitSwitch 触发音钩（vanilla 每支 PlaySound(28)（Wiring.cs:267-375 共 7 处）——
   *  R8-51:压板/测重板/感应器接触触发此前静音;Game 接 sfx.play('tink') */
  /** 世世纪杀花已击败(同上) */
  planteraDowned = false;
  /** SW-K1 2026-09-03:WorldGen.CanKillTile 全式的运行期上下文提供者。原版致动缩入
   *  （Wiring.cs:3227 DeActive）与拨杆 130（:1428）调的是【全函数】CanKillTile(i,j)
   *  （WorldGen.cs:62716-62810,含 Boulders+CheckBoulderChest/IsLockedDoor/case 235
   *  传送器/Chest.CanDestroyChest 四支）——本仓曾只挂上邻保护子件(结构子集,头注
   *  自登记),现整段退役、委托 entities/Mounts.canKillTileAt（与 Game.canKillTile
   *  钻头链同一权威实现）。hardMode(Main.hardMode)与 world.chests 锚格表
   *  （Chest.CanDestroyChest）由 Game 装配期注入 closure 每调用现读(困难模式中途
   *  触发/箱子增删不失步);null(测试/未装配)落 canKillTileAt 缺省口径=非困难+容器恒可毁。
   *  ★登记(SW-L1 2026-09-03 F10 已统一):canKillTileAt 的 active 判据改为裸
   *  active 位(原版 CanKillTile :62729/:62735/:62798 tile.active(),不含致动位,
   *  已致动格仍可杀)——SW-G1 批曾以 TileStore.isActive(nactive) 登记 nuance 待
   *  统一,本批按权威层口径收口 */
  killTileCtxProvider: (() => KillTileCtx) | null = null;

  running = false;                                  // :23
  blockPlayerTeleportationForOneIteration = false;  // :22(测重板抑制传送)
  private currentWireColor = 0;                     // :46(1红 2蓝 3绿 4黄;彩线灯泡用)

  // BFS 状态(:24-27)。点用 idx(y*w+x) 编码。
  private wireSkip = new Set<number>();
  private wireList: number[] = [];      // FIFO(head 指针)
  private wireDir: number[] = [];       // 与 wireList 平行的进入方向 0下 1上 2右 3左
  private toProcess = new Map<number, number>(); // :27 分线盒再访预算

  // 逻辑门(:28-32)
  private gatesCurrent: number[] = [];
  private gatesNext: number[] = [];
  private gatesDone = new Map<number, boolean>();
  private lampsToCheck: number[] = [];
  private pixelBoxTriggers = new Map<number, number>();

  // 传送器对(:33;px 坐标,-1 = 未捕获)与泵(:34-40)
  private tp: Array<[number, number]> = [[-1, -1], [-1, -1]];
  private inPumpX = new Int16Array(MAX_PUMP); private inPumpY = new Int16Array(MAX_PUMP);
  private outPumpX = new Int16Array(MAX_PUMP); private outPumpY = new Int16Array(MAX_PUMP);
  private numInPump = 0; private numOutPump = 0;

  // 炮族全局冷却（Wiring.cs:69-73 静态字段；:147-158 UpdateMech 每 tick 递减）。
  // devices.ts case 209/212 开火时置位（Wiring.cs:1335/1338/1393）
  cannonCoolDown = 0;          // :69 大炮 120
  bunnyCannonCoolDown = 0;     // :71 兔兔炮 480
  snowballCannonCoolDown = 0;  // :73 雪球发射器 15

  // 冷却注册(:41-45)
  private mechX = new Int32Array(MAX_MECH + 1);
  private mechY = new Int32Array(MAX_MECH + 1);
  private mechTime = new Int32Array(MAX_MECH + 1);
  private numMechs = 0;

  constructor(st: TileStore) {
    this.st = st;
  }

  /** 活跃器件冷却数（F5 调试报告只读 numMechs） */
  activeMechCount(): number { return this.numMechs; }

  /** 冷却注册表快照：{x, y, t} 剩余 tick（F5 调试报告 mechDump） */
  mechDump(): Array<{ x: number; y: number; t: number }> {
    const out: Array<{ x: number; y: number; t: number }> = [];
    for (let i = 0; i < this.numMechs; i++) {
      out.push({ x: this.mechX[i], y: this.mechY[i], t: this.mechTime[i] });
    }
    return out;
  }

  /** 传送器捕获对快照（-1 = 未捕获；F5 调试报告） */
  teleportPairs(): Array<[number, number]> {
    return [[...this.tp[0]], [...this.tp[1]]];
  }

  private p2i(x: number, y: number): number { return y * this.st.w + x; }
  private i2x(i: number): number { return i % this.st.w; }
  private i2y(i: number): number { return (i / this.st.w) | 0; }
  private sheetAt(x: number, y: number): number { return this.sheetOf(x, y); }
  /** 该格的原版 tile id(sheet;非 vanilla tile 返回 -1)。器件表按 sheet 分发 */
  sheetOf(x: number, y: number): number {
    if (!this.st.inBounds(x, y)) return -1;
    const d = TILE_DEFS[this.st.type[this.p2i(x, y)]];
    return d?.vanilla?.sheet ?? -1;
  }
  /** 多格器件整体去重(devices.ts 用) */
  skipCell(x: number, y: number): void { this.skipWire(x, y); }

  // ============ UpdateMech(Wiring.cs:88-161)每 tick 调 ============

  updateMech(): void {
    // 炮族全局冷却每 tick 递减（Wiring.cs:147-158）
    if (this.cannonCoolDown > 0) this.cannonCoolDown--;
    if (this.bunnyCannonCoolDown > 0) this.bunnyCannonCoolDown--;
    if (this.snowballCannonCoolDown > 0) this.snowballCannonCoolDown--;
    for (let i = this.numMechs - 1; i >= 0; i--) {
      this.mechTime[i]--;
      const mx = this.mechX[i], my = this.mechY[i];
      // ★R20-B3:原版出界/tile 空当场 _numMechs--（:165-176,不搬运数组=残槽下 tick
      // 重复处理的原版怪癖;仅世界边缘 1 格可达）——我方曾等 mechTime 耗尽
      if (!this.st.inBounds(mx, my)) { this.numMechs--; continue; }
      const sh = this.sheetAt(mx, my);
      // ★R20-B4:原版门是 tile.active()（:178/:214/:219）——被拆的计时器/引爆器若
      // type 幽灵保留（flags=0）不得再走计时/复位分支
      const raw = this.st.flags[this.p2i(mx, my)] !== 0;
      if (raw && sh === 144) {
        const ti = this.p2i(mx, my);
        if (this.st.frameY[ti] === 0) {
          this.mechTime[i] = 0;
        } else {
          // frameX/18 → 周期帧数(:102-120)
          let period = Math.floor(this.st.frameX[ti] / 18);
          period = period === 0 ? 60 : period === 1 ? 180 : period === 2 ? 300 : period === 3 ? 30 : period === 4 ? 15 : 60;
          // IEEERemainder(t, period) === 0(注意负数:IEEERemainder 结果范围 (-p,p])
          const r = this.mechTime[i] - period * Math.round(this.mechTime[i] / period);
          if (r === 0) {
            this.mechTime[i] = 18000;
            this.tripWire(mx, my, 1, 1);
          }
        }
      }
      if (this.mechTime[i] <= 0) {
        if (raw && sh === 144) {
          const ti = this.p2i(mx, my);
          this.st.setTile(mx, my, this.st.type[ti], this.st.frameX[ti], 0);
        }
        if (raw && sh === 411) {
          // 引爆器 2×2 帧复位(:135-151)——★R20-B5:原版对 2×2 四格【无条件】加帧
          // （:231-243 仅 InWorld 门,无同型判定;同格异型 tile 的 frameX 一起改=原版怪癖）
          const ti = this.p2i(mx, my);
          const num1 = Math.floor(this.st.frameX[ti] % 36 / 18);
          const num2 = Math.floor(this.st.frameY[ti] % 36 / 18);
          const tileX = mx - num1, tileY = my - num2;
          let num3 = 36;
          if (this.st.inBounds(tileX, tileY) && this.st.frameX[this.p2i(tileX, tileY)] >= 36) num3 = -36;
          for (let ix = tileX; ix < tileX + 2; ix++) {
            for (let iy = tileY; iy < tileY + 2; iy++) {
              if (!this.st.inBounds(ix, iy)) continue; // :236-243 InWorld(i,j,1)
              const ii = this.p2i(ix, iy);
              this.st.setTile(ix, iy, this.st.type[ii], this.st.frameX[ii] + num3, this.st.frameY[ii]);
            }
          }
        }
        // 数组下移移除(:152-158)
        for (let k = i; k < this.numMechs; k++) {
          this.mechX[k] = this.mechX[k + 1];
          this.mechY[k] = this.mechY[k + 1];
          this.mechTime[k] = this.mechTime[k + 1];
        }
        this.numMechs--;
      }
    }
  }

  // ============ CheckMech(Wiring.cs:313-327)============

  checkMech(i: number, j: number, time: number): boolean {
    for (let k = 0; k < this.numMechs; k++) {
      if (this.mechX[k] === i && this.mechY[k] === j) return false;
    }
    if (this.numMechs >= 999) return false;
    this.mechX[this.numMechs] = i;
    this.mechY[this.numMechs] = j;
    this.mechTime[this.numMechs] = time;
    this.numMechs++;
    return true;
  }

  // ============ HitSwitch(Wiring.cs:163-252)============

  hitSwitchSound?: (x: number, y: number) => void;
  hitSwitch(i: number, j: number): void {
    if (!this.st.inBounds(i, j)) return;
    const sh = this.sheetAt(i, j);
    // ★R20-B7:210 地雷支原版无 PlaySound(28)（:288-291 直落 ExplodeMine,爆音由弹 164 自带）
    if (sh !== 210) this.hitSwitchSound?.(i, j);   // 每支分支都播（:267/:272/:285/:310/:323/:339/:375）
    const ti = this.p2i(i, j);
    // 压板/轨道/感应器/测重板/垫板/高尔夫(:167-171)与宝石锁(:172-176):直接 Trip
    if (sh === 135 || sh === 314 || sh === 423 || sh === 428 || sh === 442 || sh === 476) {
      this.tripWire(i, j, 1, 1);
      return;
    }
    if (sh === 440) { // 宝石锁 3×3
      this.tripWire(i, j, 3, 3);
      return;
    }
    if (sh === 136) { // 开关 frameY 0↔18(:177-182)
      this.st.setTile(i, j, this.st.type[ti], this.st.frameX[ti], this.st.frameY[ti] !== 0 ? 0 : 18);
      this.tripWire(i, j, 1, 1);
      return;
    }
    if (sh === 210) {
      // ★R20-B7(缺失·高):地雷 ExplodeMine(Wiring.cs:288-291)。踩踏路径必经此门
      // （Collision.SwitchTiles :3374 HitSwitch→case 210;导线 :2045 同）——此前无此支
      // = 放置的地雷被踩永不爆。devices.ts case 210 = KillTile(noItem)+弹 164(250 伤)
      this.device?.(this, 210, i, j);
      return;
    }
    if (sh === 443) { // 热喷泉(:183-184)
      this.device?.(this, 443, i, j);
      return;
    }
    if (sh === 144) { // 计时器开/关(:185-196)
      if (this.st.frameY[ti] === 0) {
        this.st.setTile(i, j, this.st.type[ti], this.st.frameX[ti], 18);
        this.checkMech(i, j, 18000);
      } else {
        this.st.setTile(i, j, this.st.type[ti], this.st.frameX[ti], 0);
      }
      return;
    }
    if (sh === 441 || sh === 468) { // 陷阱箱 2×2(:197-208)
      const num1 = Math.floor(this.st.frameX[ti] / 18) * -1;
      const num2 = Math.floor(this.st.frameY[ti] / 18) * -1;
      let num3 = num1 % 4;
      if (num3 < -1) num3 += 2;
      this.tripWire(num3 + i, num2 + j, 2, 2);
      return;
    }
    if (sh === 467) { // 水晶陷阱箱(frameX/36==4 才触发,:209-222)
      if (Math.floor(this.st.frameX[ti] / 36) !== 4) return;
      const num1 = Math.floor(this.st.frameX[ti] / 18) * -1;
      const num2 = Math.floor(this.st.frameY[ti] / 18) * -1;
      let num3 = num1 % 4;
      if (num3 < -1) num3 += 2;
      this.tripWire(num3 + i, num2 + j, 2, 2);
      return;
    }
    if (sh === 132 || sh === 411) { // 拉杆/引爆器 2×2 翻帧(:223-251)
      let delta = 36;
      const num2 = Math.floor(this.st.frameX[ti] / 18) * -1;
      const num3 = Math.floor(this.st.frameY[ti] / 18) * -1;
      let num4 = num2 % 4;
      if (num4 < -1) { num4 += 2; delta = -36; }
      const ax = num4 + i, ay = num3 + j;
      if (this.sheetAt(ax, ay) === 411) this.checkMech(ax, ay, 60);
      for (let ix = ax; ix < ax + 2; ix++) {
        for (let iy = ay; iy < ay + 2; iy++) {
          if (!this.st.inBounds(ix, iy)) continue;
          const ii = this.p2i(ix, iy);
          const s2 = this.sheetAt(ix, iy);
          if (s2 === 132 || s2 === 411) {
            this.st.setTile(ix, iy, this.st.type[ii], this.st.frameX[ii] + delta, this.st.frameY[ii]);
          }
        }
      }
      this.tripWire(ax, ay, 2, 2);
      return;
    }
  }

  // ============ TripWire(Wiring.cs:379-529)============

  tripWire(left: number, top: number, width: number, height: number): void {
    this.running = true;
    this.wireList.length = 0;
    this.wireDir.length = 0;
    const st = this.st;
    const pairs: Array<[[number, number], [number, number]]> = [];
    const bits = [TileStore.WIRE_RED, TileStore.WIRE_BLUE, TileStore.WIRE_GREEN, TileStore.WIRE_YELLOW];
    // 四色 pass 顺序固定 红(1)蓝(2)绿(3)黄(4)(:405-508);每色前重置传送器对与泵
    for (let color = 1; color <= 4; color++) {
      this.tp[0] = [-1, -1]; this.tp[1] = [-1, -1];
      this.wireList.length = 0;
      const bit = bits[color - 1];
      for (let x = left; x < left + width; x++) {
        for (let y = top; y < top + height; y++) {
          if (!st.inBounds(x, y)) continue;
          if (st.wire[this.p2i(x, y)] & bit) this.wireList.push(this.p2i(x, y));
        }
      }
      if (this.wireList.length > 0) {
        this.numInPump = 0;
        this.numOutPump = 0;
        this.hitWire(color);
        if (this.numInPump > 0 && this.numOutPump > 0) this.xferWater();
      }
      if (this.tp[0][0] >= 0 && this.tp[1][0] >= 0) pairs.push([[...this.tp[0]], [...this.tp[1]] as [number, number]]);
    }
    this.running = false;
    // 四色收集完的传送器对统一执行(:520-526)
    for (const [a, b] of pairs) this.teleportPair?.(a, b);
    this.pixelBoxPass();
    this.logicGatePass();
  }

  // ============ HitWire BFS(Wiring.cs:693-827)============

  private hitWire(wireType: number): void {
    const st = this.st;
    // 种子:SkipWire + 预算 4 + 方向 0(:695-703)
    this.wireDir.length = 0;
    const n = this.wireList.length;
    for (let k = 0; k < n; k++) {
      const p = this.wireList[k];
      this.skipWireI(p);
      this.toProcess.set(p, 4);
      this.wireDir.push(0);
    }
    this.currentWireColor = wireType;
    let head = 0;
    while (head < this.wireList.length) {
      const key = this.wireList[head];
      const num1 = this.wireDir[head];
      head++;
      const x = this.i2x(key), y = this.i2y(key);
      if (!this.wireSkip.has(key)) this.hitWireSingle(x, y);
      // 邻居顺序:0下 1上 2右 3左(:713-739)
      for (let index1 = 0; index1 < 4; index1++) {
        const X = index1 === 0 ? x : index1 === 1 ? x : index1 === 2 ? x + 1 : x - 1;
        const Y = index1 === 0 ? y + 1 : index1 === 1 ? y - 1 : y;
        if (X < 2 || X >= st.w - 2 || Y < 2 || Y >= st.h - 2) continue; // :740
        const curSheet = this.sheetAt(x, y);
        const nbSheet = this.sheetAt(X, Y);
        // :748-750 邻居是分线盒/像素盒 → 不给预算
        let num2 = 3;
        if (nbSheet === 424 || nbSheet === 445) num2 = 0;
        // :751-768 分线盒方向门控(frameX/18 三态)
        if (curSheet === 424) {
          const mode = Math.floor(st.frameX[this.p2i(x, y)] / 18);
          if (mode === 0) { if (index1 === num1) continue; }
          else if (mode === 1) {
            if (!((num1 === 0 && index1 === 3) || (num1 === 3 && index1 === 0) || (num1 === 1 && index1 === 2) || (num1 === 2 && index1 === 1))) continue;
          } else if (mode === 2) {
            if (!((num1 === 0 && index1 === 2) || (num1 === 2 && index1 === 0) || (num1 === 1 && index1 === 3) || (num1 === 3 && index1 === 1))) continue;
          }
        }
        // :769-780 像素盒仅同向直通,并记录触发值(垂直 2 / 水平 1)
        if (curSheet === 445) {
          if (index1 === num1) {
            const v = (index1 === 0 || index1 === 1) ? 2 : 1;
            this.pixelBoxTriggers.set(key, (this.pixelBoxTriggers.get(key) ?? 0) | v);
          } else continue;
        }
        // :781-799 邻居须带当前色
        const bit = wireType === 1 ? TileStore.WIRE_RED : wireType === 2 ? TileStore.WIRE_BLUE : wireType === 3 ? TileStore.WIRE_GREEN : TileStore.WIRE_YELLOW;
        if (!(st.wire[this.p2i(X, Y)] & bit)) continue;
        // :800-819 预算消耗或入队
        const nb = this.p2i(X, Y);
        const budget = this.toProcess.get(nb);
        if (budget !== undefined) {
          const left2 = budget - 1;
          if (left2 === 0) this.toProcess.delete(nb);
          else this.toProcess.set(nb, left2);
        } else {
          this.wireList.push(nb);
          this.wireDir.push(index1);
          if (num2 > 0) this.toProcess.set(nb, num2);
        }
      }
    }
    this.wireSkip.clear();
    this.toProcess.clear();
  }

  // ============ HitWireSingle 核心 case(Wiring.cs:829+)============

  private hitWireSingle(x: number, y: number): void {
    const st = this.st;
    const i = this.p2i(x, y);
    const type = st.type[i];
    const sheet = this.sheetAt(x, y);
    // :833-834 先致动(active 检查之前,空格上的致动线也会翻)
    if (st.wire[i] & TileStore.WIRE_ACTUATOR) this.actuateForced(x, y);
    // ★R8-49:原版门是 tile.active()（WR57:1006-1008,switch 前,对全部 case 生效）
    // ——本仓 flags=0 时 type 幽灵保留,残型格(被击杀的器件)须照常短路
    if (st.flags[i] === 0) return;
    // 核心 case(牵扯 Wiring 内部状态),其余全表委托 devices.ts
    switch (sheet) {
      case 144: // 计时器:信号 = 打开并重置计时(:839-843)
        this.hitSwitch(x, y);
        return;
      case 419: { // 逻辑门灯:翻转 + SkipWire + 入队(:1075-1086)
        let d = 18;
        if (st.frameX[i] >= 18) d = -18;
        if (st.frameX[i] === 36) d = 0;
        this.skipWire(x, y);
        st.setTile(x, y, type, st.frameX[i] + d, st.frameY[i]);
        this.lampsToCheck.push(i);
        return;
      }
      case 235: { // 传送器成对捕获(:1251-1271)
        const tx = x - Math.floor(st.frameX[i] / 18);
        if (st.wall[i] === 87 && y > this.worldSurface && !this.planteraDowned) return;
        const halfOff = st.half[i] ? 0.5 : 0;
        if (this.tp[0][0] === -1) { this.tp[0] = [tx, y + halfOff]; return; }
        // ★R20-E2:原版第二槽判等比较的是【不带半砖偏移】的 j（:1567
        // `_teleport[0].Y != j`）——同一块半砖板二次捕获会把两槽填成同点(原版即如此)
        if (this.tp[0][0] === tx && this.tp[0][1] === y) return;
        this.tp[1] = [tx, y + halfOff];
        return;
      }
      case 142: case 143: { // 入水/出水泵 2×2 四格收集(:1793-1863)
        const py = y - Math.floor(st.frameY[i] / 18);
        let px = Math.floor(st.frameX[i] / 18);
        if (px > 1) px -= 2;
        const ox = x - px;
        this.skipWire(ox, py); this.skipWire(ox, py + 1);
        this.skipWire(ox + 1, py); this.skipWire(ox + 1, py + 1);
        const cells: Array<[number, number]> = [[ox, py + 1], [ox + 1, py + 1], [ox, py], [ox + 1, py]];
        if (sheet === 142) {
          for (let k = 0; k < 4 && this.numInPump < 19; k++) {
            this.inPumpX[this.numInPump] = cells[k][0];
            this.inPumpY[this.numInPump] = cells[k][1];
            this.numInPump++;
          }
        } else {
          for (let k = 0; k < 4 && this.numOutPump < 19; k++) {
            this.outPumpX[this.numOutPump] = cells[k][0];
            this.outPumpY[this.numOutPump] = cells[k][1];
            this.numOutPump++;
          }
        }
        return;
      }
      case 429: { // 彩线灯泡:按当前色翻对应位(:1325-1357)
        const q = Math.floor(st.frameX[i] / 18);
        let num53 = 0, on = false;
        switch (this.currentWireColor) {
          case 1: num53 = 18; on = !(q % 2 >= 1); break;
          case 2: num53 = 72; on = !(q % 8 >= 4); break;
          case 3: num53 = 36; on = !(q % 4 >= 2); break;
          case 4: num53 = 144; on = !(q % 16 >= 8); break;
        }
        st.setTile(x, y, type, st.frameX[i] + (on ? num53 : -num53), st.frameY[i]);
        return;
      }
    }
    // 致动后不再吃器件信号(原版各 case 里 actuator 时早退的近似统一处理;
    // 门/传送带/宝石块在原版各自判断,其余器件致动时信号照常——按原版逐 case 已在 devices 内)
    this.device?.(this, sheet, x, y);
  }

  // ============ XferWater(Wiring.cs:329-377)============

  private xferWater(): void {
    const st = this.st;
    for (let a = 0; a < this.numInPump; a++) {
      const i1 = this.inPumpX[a], j1 = this.inPumpY[a];
      if (!st.inBounds(i1, j1)) continue;
      const ii = st.idx(i1, j1);
      let liquid1 = st.liquid[ii];
      if (liquid1 > 0) {
        // ★R8-46:类型按单字节四值精确匹配（WR57:486-501 liquidType()）——双布尔
        // (lava/honey) 比较把微光(4)与水(1)混同:水泵抽走微光、微光泵入水格;
        // 空目标格继承来型（:494 b2=b）;转移后 out.liquidType(b)（:507）
        const typeIn = st.liquidType[ii];
        for (let b = 0; b < this.numOutPump; b++) {
          const i2 = this.outPumpX[b], j2 = this.outPumpY[b];
          if (!st.inBounds(i2, j2)) continue;
          const oi = st.idx(i2, j2);
          const liquid2 = st.liquid[oi];
          if (liquid2 < 255) {
            const typeOut = liquid2 === 0 ? typeIn : st.liquidType[oi];
            if (typeOut === typeIn) {
              let move = liquid1;
              if (move + liquid2 > 255) move = 255 - liquid2;
              st.setLiquid(i2, j2, liquid2 + move, typeIn);
              st.setLiquid(i1, j1, liquid1 - move, st.liquidType[ii] || 1);
              liquid1 = st.liquid[ii];
              if (st.liquid[ii] === 0) break;
            }
          }
        }
      }
    }
  }

  // ============ PixelBoxPass(Wiring.cs:531-553)============

  private pixelBoxPass(): void {
    const st = this.st;
    for (const [key, v] of this.pixelBoxTriggers) {
      const x = this.i2x(key), y = this.i2y(key);
      if (!st.inBounds(x, y)) continue;
      const i = this.p2i(x, y);
      // ★R8-47:原版只处理双向触发值 3（WR57:670-680）——单侧 1/2 不翻帧;
      // 曾自造 v===1 水平支致水平单触发被错误归零
      // ★X2-F8(2026-09-04):原版 PixelBoxPass（Wiring.cs:674-76）只写 frameX、
      //  不动 active/type 位——经 setTile 会把幽灵格残型复活成 active（帧写复活
      //  幽灵格）。幽灵格跳过帧写（保守=原版可观测面:inactive 格帧写无效帧不绘制）
      if (v === 3) {
        if (!st.hasTile(x, y)) continue;
        if (st.frameX[i] !== 18) st.setTile(x, y, st.type[i], 18, st.frameY[i]);
        else st.setTile(x, y, st.type[i], 0, st.frameY[i]);
      }
    }
    this.pixelBoxTriggers.clear();
  }

  // ============ LogicGatePass / CheckLogicGate(Wiring.cs:555-691)============

  private logicGatePass(): void {
    if (this.gatesCurrent.length !== 0) return; // 已在级联中
    this.gatesDone.clear();
    let lampHead = 0, gateHead = 0;
    while (this.lampsToCheck.length > lampHead) {
      while (this.lampsToCheck.length > lampHead) {
        const lamp = this.lampsToCheck[lampHead++];
        this.checkLogicGate(this.i2x(lamp), this.i2y(lamp));
      }
      // _GatesNext → _GatesCurrent,逐个 TripWire(递归;_GatesDone 防环)(:567-585)
      const next = this.gatesNext;
      this.gatesNext = [];
      this.gatesCurrent = next;
      gateHead = 0;
      while (this.gatesCurrent.length > gateHead) {
        const key = this.gatesCurrent[gateHead];
        gateHead++;
        if (this.gatesDone.get(key)) continue;
        this.gatesDone.set(key, true);
        this.tripWire(this.i2x(key), this.i2y(key), 1, 1);
      }
      this.gatesCurrent.length = 0; // 原版 Queue Dequeue 排空;残留会让下次级联被早退守卫吞掉
    }
    this.lampsToCheck.length = 0;
    this.gatesDone.clear();
    if (this.blockPlayerTeleportationForOneIteration) {
      this.blockPlayerTeleportationForOneIteration = false;
    }
  }

  /** 触发逻辑门(压板等直接 Poke,P4/P6 用;Wiring.cs:254-260 的单机语义) */
  pokeLogicGate(lampX: number, lampY: number): void {
    this.lampsToCheck.push(this.p2i(lampX, lampY));
    this.logicGatePass();
  }

  private checkLogicGate(lampX: number, lampY: number): void {
    const st = this.st;
    if (!st.inBounds(lampX, lampY)) return;
    for (let y = lampY; y < st.h; y++) {
      if (!st.inBounds(lampX, y)) break;
      const i = this.p2i(lampX, y);
      // ★R8-49:WR57:729-731 `if (!tile.active()) break`——残型格(flags=0)即断
      if (st.flags[i] === 0) break;
      const sh = this.sheetAt(lampX, y);
      if (sh === 420) {
        const wasDone = this.gatesDone.get(i) ?? false;
        const num1 = Math.floor(st.frameY[i] / 18); // 门种类 0-5
        const flag2 = st.frameX[i] === 18;  // 当前输出 ON
        const flag3 = st.frameX[i] === 36;  // 故障输出态
        if (num1 < 0) break;
        // 向上数灯(:614-629)——★R20-C5:原版门是 tile.active()（:729-731）,
        // 残型幽灵灯（flags=0）不计入也不中断计数链
        let num2 = 0, num3 = 0;
        let faulty = false;
        for (let y2 = y - 1; y2 > 0; y2--) {
          const j = this.p2i(lampX, y2);
          if (st.flags[j] !== 0 && this.sheetAt(lampX, y2) === 419) {
            if (st.frameX[j] === 36) { faulty = true; break; }
            num2++;
            if (st.frameX[j] === 18) num3++;
          } else break;
        }
        let out: boolean;
        // 样式→门型权威 = ItemID.cs:8752-8762（物品 3603-3608 placeStyle=type-3603：
        // AND/OR/NAND/NOR/XOR/XNOR）+ en-US Items.json tooltip（XOR="Exactly one…on"/
        // XNOR="Zero or more than one"）。★IIIII234（2026-09-09）勘误：case2/case4
        // 旧注写反（公式本征正确,仅注释错标——行为无变更）。
        switch (num1) { // :631-653
          case 0: out = num2 === num3; break;   // AND（3603 style0）：全亮
          case 1: out = num3 > 0; break;        // OR（3604 style1）：任一亮
          case 2: out = num2 !== num3; break;   // NAND（3605 style2）：非全亮
          case 3: out = num3 === 0; break;      // NOR（3606 style3）：全灭
          case 4: out = num3 === 1; break;      // XOR（3607 style4）：恰一亮
          case 5: out = num3 !== 1; break;      // XNOR（3608 style5）：0 或 ≥2 亮
          default: return;
        }
        const flag6 = !faulty && flag3;                 // 故障存在且门当前 off → 强制不发
        let flag7 = false;                              // 故障灯本轮被翻 → 概率通过
        if (faulty && st.frameX[this.p2i(lampX, lampY)] === 36) flag7 = true;
        // :658 无变化则不动作
        if (!((out !== flag2) || flag6 || flag7)) break;
        st.setTile(lampX, y, st.type[i], out ? 18 : 0, st.frameY[i]);
        if (faulty) st.setTile(lampX, y, st.type[i], 36, st.frameY[i]);
        this.skipWire(lampX, y);
        let fire: boolean = !faulty || flag7;
        // ★R20-C4:原版 flag6 支是无条件覆盖 `flag7 = Main.rand.Next(num2) < num3`
        // （:812-817;前面的 num2==0 早退是死代码）——num2==0(故障灯上无灯)时
        // Next(0)=0<0=false 不发;我方曾以 `flag7 && num2>0` 短路 → num2==0 时照发
        if (flag7) fire = num2 > 0 ? Math.floor(Math.random() * num2) < num3 : false;
        if (flag6) fire = false;
        if (!fire) break;
        if (!wasDone) {
          this.gatesNext.push(i);
          break;
        }
        // 重复输出 = 冒烟反馈(Wiring.cs:683-685;烟雾粒子由 devices 侧近似,此处仅返回)
        break;
      }
      if (sh !== 419) break;
    }
  }

  // ============ 致动器(Wiring.cs:262-280, 2373-2405)============

  actuate(i: number, j: number): boolean {
    const st = this.st;
    if (!st.inBounds(i, j)) return false;
    if (!(st.wire[this.p2i(i, j)] & TileStore.WIRE_ACTUATOR)) return false;
    if (st.isActuated(i, j)) this.reActive(i, j);
    else this.deActive(i, j);
    return true;
  }

  actuateForced(i: number, j: number): void {
    if (this.st.isActuated(i, j)) this.reActive(i, j);
    else this.deActive(i, j);
  }

  /** 缩入（Wiring.cs:3222-3251 DeActive 1:1）：蜥蜴砖地表限制 + 不可缩 tile 表 +
   *  上方 PreventsActuationUnder / CanKillTile（:3227 全函数,SW-K1 起委托全式）检查 */
  private deActive(i: number, j: number): void {
    const st = this.st;
    if (!st.inBounds(i, j)) return;
    const t = this.p2i(i, j);
    if (!st.flags[t]) return;
    const sh = this.sheetAt(i, j);
    if (sh === 226 && j > this.worldSurface && !this.planteraDowned) return;
    // flag = tileSolid && !NotReallySolid{387,388,10}；314/379/386-389/476 显式置 false
    // （Wiring.cs:3227-3239；379 boulder 此前漏列）
    // ★BJ754 TF-13（2026-11-02,issue#39）：solid 真值域 = 原版 Main.tileSolid
    //  （Wiring.cs:3214 直读）——平台 19/矿锭 239/种植箱 380/红队平台 427/队伍平台
    //  435-439 九类 tileSolid=true 可致动（vanilla-tilecollision 对账差集）。旧读
    //  TILE_DEFS.solid（运行时碰撞 LUT）漏九类=误拒（issue#39 实测 19/239/380/427/
    //  435-439 wire 恒 16 不置 inActive 位,石块对照 16→48 正常）。经 GenSolid.
    //  vanRuntimeTileSolid 单源（含 484/659 初值口径排除）。
    let solid = vanRuntimeTileSolid(st.type[t]);
    if (sh === 314 || sh === 379 || sh === 386 || sh === 387 || sh === 388 || sh === 389 || sh === 476) solid = false;
    if (sh === 387 || sh === 388 || sh === 10) solid = false; // TileID.Sets.NotReallySolid（TileID.cs:355）
    if (!solid) return;
    // 门（Wiring.cs:3241）：上方未激活，或（上方非 PreventsActuationUnder 且 CanKillTile）
    if (st.inBounds(i, j - 1) && st.flags[this.p2i(i, j - 1)]) {
      const above = this.sheetAt(i, j - 1);
      if (PREVENTS_ACTUATION_UNDER.has(above)) return;
      if (!this.canKillTile(i, j)) return;
    }
    st.setActuated(i, j, true);
    // ★R20-I4(造行为摘除,2026-08-24):原版 DeActive（Wiring.cs:3208-3236）无任何
    // 巨石逻辑。★G1谓词批(2026-09-04)注释勘误：旧文把失撑判据锚在 Check2x2 的
    // type==132 分支（WorldGen.cs:48937-48944 = tileSolid/tileSolidTop/halfBrick/
    // slope 判据——系 132 墓碑族 frameX±72 隐没支）,张冠李戴;巨石(138,Boulders
    // 集)的真实失撑判据在 Check2x2 的 Boulders 分支 = 两列下格
    // `!SolidTileAllowBottomSlope(num2,num6+2) && !SolidTileAllowBottomSlope(+1)`
    // （WorldGen.cs:48878-48892 → :70698-70722,该式【含】!inActive()）——即原版
    // 已致动缩入的支撑格【不】构成支撑,SquareTileFrame 级联会把巨石 KillTile+
    // 弹 99（:49172;memory「巨石Check2x2释放即滚」同证）。旧文"不含 inActive 位→
    // 致动缩入仍算有支撑"系判据锚位错置;R20-I4 摘除已被后续批翻案——
    // BoulderMech.solidAllowBottomSlope 现按 !inActive 排致动支撑（致动即释放
    // 巨石,与原版一致）,本处注释只留勘误记录,旧结论作废。
  }

  /** WorldGen.CanKillTile 全函数门（1457 WorldGen.cs:62716-62810 委托）。
   *  ★R20-I6 起 devices.ts case 130 亦消费（公开）;SW-K1 2026-09-03 前为本文件内
   *  的上邻保护结构子集——原版两处调用（Wiring.cs:1428 拨杆 130/:3227 DeActive）
   *  调的都是全函数，子集缺 Boulders+CheckBoulderChest/IsLockedDoor/case 235/
   *  Chest.CanDestroyChest 四支 → 致动缩入/拨杆可打穿"巨石压箱/锁门/传送器上有物/
   *  非空箱"的保护，与挖掘面（Game.canKillTile）双轨。现整段委托
   *  entities/Mounts.canKillTileAt 同一权威实现，上下文经 killTileCtxProvider 注入 */
  canKillTile(i: number, j: number): boolean {
    return canKillTileAt(this.st, i, j, this.killTileCtxProvider?.() ?? undefined);
  }

  private reActive(i: number, j: number): void {
    this.st.setActuated(i, j, false);
  }

  // ============ SkipWire(Wiring.cs:78-86)============

  private skipWire(x: number, y: number): void { this.wireSkip.add(this.p2i(x, y)); }
  private skipWireI(i: number): void { this.wireSkip.add(i); }

  // ============ 导线放置/移除(WorldGen.cs:34219-34327 语义)============

  /** 放置某色线;已存在返回 false */
  placeWire(x: number, y: number, colorBit: number): boolean {
    const st = this.st;
    if (!st.inBounds(x, y)) return false;
    const i = st.idx(x, y);
    if (st.wire[i] & colorBit) return false;
    st.setWire(x, y, st.wire[i] | colorBit);
    return true;
  }

  /** KillWire 族与 KillActuator 成功剪断面钩（★BJ607,2026-10-10）——WorldGen.cs:58505
   *  KillActuator / :58605 KillWire / :58635 KillWire2 / :58665 KillWire3 / :58695
   *  KillWire4 五函数同面：SoundEngine.PlaySound(SoundID.Dig=0, i*16, j*16)
   *  （SoundID.cs:22 Dig=0）→ 清位 → `Main.netMode != 1` 侧
   *  Item.NewItem(GetItemSource_FromTileBreak(i,j), i*16, j*16, 16, 16, 530)
   *  （四通道全掉 530=普通线——1457 无彩线物品,853-855=蓝/黄压板/折扣卡,idNames
   *  亲读;KillActuator 掉 849 致动器）×1 + 5×Dust.NewDust((i*16,j*16),16,16,50)。
   *  本仓四条剪线路（剪线钳 510 / 五彩扳手 cutter 位 / 宏伟蓝图 massWireOperation
   *  cutter 支——Wiring.cs:3412-3424 同入 KillWire*）统一经此单源触发;vid 由本域
   *  钉值、Game 侧经 VI() 查 key。null（测试/未装配）=静默清位（旧相位）。 */
  wireKillFx?: (x: number, y: number, vid: number) => void;

  /** 移除某色线;不存在返回 false */
  killWire(x: number, y: number, colorBit: number): boolean {
    const st = this.st;
    if (!st.inBounds(x, y)) return false;
    const i = st.idx(x, y);
    if (!(st.wire[i] & colorBit)) return false;
    st.setWire(x, y, st.wire[i] & ~colorBit);
    this.wireKillFx?.(x, y, 530);
    return true;
  }

  placeActuator(x: number, y: number): boolean {
    const st = this.st;
    if (!st.inBounds(x, y)) return false;
    const i = st.idx(x, y);
    if (st.wire[i] & TileStore.WIRE_ACTUATOR) return false;
    st.setWire(x, y, st.wire[i] | TileStore.WIRE_ACTUATOR);
    return true;
  }

  killActuator(x: number, y: number): boolean {
    const st = this.st;
    if (!st.inBounds(x, y)) return false;
    const i = st.idx(x, y);
    if (!(st.wire[i] & TileStore.WIRE_ACTUATOR)) return false;
    st.setWire(x, y, st.wire[i] & ~TileStore.WIRE_ACTUATOR);
    this.wireKillFx?.(x, y, 849);
    return true;
  }

  // ============ MassWireOperation(Wiring.cs:2407-2558)============

  /**
   * 宏伟蓝图/五彩扳手 L 形批量操作。
   * mode: TOOL_* 位组合;consume 回调返回剩余可用数(false=耗尽),
   * 返回实际消耗 {wire, actuator}。
   * dirFirstVertical: 原版 `dir = player.direction == 1`（Wiring.cs:3259/:436）——
   * ★R20-A11:曾恒 true(先垂直段),玩家朝左时 L 形走向与原版相反
   * canDo: ★BJ569（2026-10-08）逐格 CanDoWireStuffHere（Player.cs:47327-47350,
   * MassWireOperationStep :3353-3356 消费——拒=跳格不中断路由,null 回程同相;
   * 与界外 inBounds 拒同族）
   */
  massWireOperation(
    ps: [number, number], pe: [number, number], mode: number,
    wires: number, actuators: number,
    dirFirstVertical = true,
    canDo?: (x: number, y: number) => boolean,
  ): { wire: number; actuator: number; aborted: boolean } {
    const dir = dirFirstVertical;
    let wireLeft = wires, actuatorLeft = actuators;
    let aborted = false;
    const step = (x: number, y: number): boolean => {
      // 返回 false = 材料耗尽中止
      if (!this.st.inBounds(x, y)) return true;
      if (canDo && !canDo(x, y)) return true;
      const i = this.st.idx(x, y);
      if (!(mode & TOOL_CUTTER)) {
        const order: Array<[number, number]> = [
          [TOOL_RED, TileStore.WIRE_RED], [TOOL_GREEN, TileStore.WIRE_GREEN],
          [TOOL_BLUE, TileStore.WIRE_BLUE], [TOOL_YELLOW, TileStore.WIRE_YELLOW],
        ];
        for (const [m, bit] of order) {
          if (mode & m && !(this.st.wire[i] & bit)) {
            if (wireLeft <= 0) return false;
            wireLeft--;
            this.placeWire(x, y, bit);
          }
        }
        if (mode & TOOL_ACTUATOR && !(this.st.wire[i] & TileStore.WIRE_ACTUATOR)) {
          if (actuatorLeft <= 0) return false;
          actuatorLeft--;
          this.placeActuator(x, y);
        }
      } else {
        if (mode & TOOL_RED) this.killWire(x, y, TileStore.WIRE_RED);
        if (mode & TOOL_GREEN) this.killWire(x, y, TileStore.WIRE_GREEN);
        if (mode & TOOL_BLUE) this.killWire(x, y, TileStore.WIRE_BLUE);
        if (mode & TOOL_YELLOW) this.killWire(x, y, TileStore.WIRE_YELLOW);
        if (mode & TOOL_ACTUATOR) this.killActuator(x, y);
      }
      return true;
    };
    // 第一段/第二段/端点 = grandDesignPath 单源（:2428-2486 三段一体;★BJ613
    // 预览/放置零分歧判据——cell 序=原版放置序,abort 支同原版 flag 双环齐断）
    const cells = grandDesignPath(ps, pe, dir);
    for (let k = 0; k < cells.length - 1 && !aborted; k++) {
      if (!step(cells[k][0], cells[k][1])) aborted = true;
    }
    // 端点(:2485-2486)
    if (!aborted) step(pe[0], pe[1]);
    return { wire: wires - wireLeft, actuator: actuators - actuatorLeft, aborted };
  }
}
