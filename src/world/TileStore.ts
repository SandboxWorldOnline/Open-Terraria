// SoA 多通道平面数组存储。所有热点代码只碰 TypedArray。
import { TILE_DEFS, onTileRegistered } from '../data/tiles';
import { TileOpAction } from '../net/protocol';

/** 液体类型唯一真源(原版 LiquidID +1 编码:Water=0→1/Lava=1→2/Honey=2→3,4=微光)。
 *  ⚠️ 从原版 C# 移植液体判断时**禁止裸写 0/1/2**——必须用本枚举。
 *  血案 2026-08-12:水中箱 pass 照抄 `liquidType()!=0` 判水(原版 Water=0),
 *  本仓库水=1 恒真 → 拒绝采样死循环,世界生成卡"生物群系"。
 *  (grep `liquidType.*=== *0\b|liquidType.*!== *0\b` 可快速排查同类移植错位) */
export const enum LIQUID_TYPE {
  NONE = 0,
  WATER = 1,
  LAVA = 2,
  HONEY = 3,
  SHIMMER = 4,
}

export class TileStore {
  /** ★一百零八审计修:mod 注册的 tile 键→内部 id(装载期填充;生成 pass 解析用) */
  mods: { tileIdByKey: Record<string, number> } = { tileIdByKey: {} };
  readonly w: number;
  readonly h: number;
  readonly type: Uint16Array;
  readonly flags: Uint8Array; // bit0 active bit1 framedDecor占位(预留)
  readonly frameX: Uint16Array;
  readonly frameY: Uint16Array;
  readonly wall: Uint16Array; // 原版 wld 墙 id（0-366）
  readonly liquid: Uint8Array;   // 0-255 液量
  readonly liquidType: Uint8Array; // 取值见 LIQUID_TYPE(原版 +1 编码——照抄 C# liquidType()==0 判水必错,见 LIQUID_TYPE 注释)
  readonly half: Uint8Array;      // halfBrick 位（原版 Tile.cs bTileHeader bit1）：下半 8px 实心
  readonly slope: Uint8Array;     // 坡面 0-4（原版编码；渲染暂未支持，生成期少用）
  readonly wire: Uint8Array;      // 电路位（原版 Tile.cs sTileHeader）：bit0红 bit1蓝 bit2绿 bit3黄 bit4致动器 bit5已致动(inActive)
  /** 方块油漆 id（0-31，原版 Tile.cs:609-617 `color()` = sTileHeader & 0x1F）。
   *  PaintID 全表见 world/Paint.ts；深层漆 13-24 与浅层 1-12 同 RGB，
   *  区别只在渲染覆盖强度（TilePaintSystemV2）。 */
  readonly paint: Uint8Array;
  /** 背景墙油漆 id（0-31，原版 Tile.cs:365-373 `wallColor()` = bTileHeader & 0x1F） */
  readonly paintWall: Uint8Array;
  /** 涂层（Coating）四位：bit 编码 = 存档 header4 位（WorldFile.cs:1539-1552 写 /
   *  :2659-2677 读）——bit1(2)=invisibleBlock bit2(4)=invisibleWall
   *  bit3(8)=fullbrightBlock bit4(16)=fullbrightWall。
   *  原版运行时位在 Tile.cs bTileHeader3 bit5/6/7（:558-607）与 sTileHeader bit15
   *  （:748-762），本仓统一收进单字节通道（同 paint 先例）。物品侧：
   *  4668 夜明涂料 paintCoating=1（Item.cs:38471）→ fullbright 位；
   *  5344 回声涂料 paintCoating=2（Item.cs:42387）→ invisible 位。 */
  readonly coat: Uint8Array;
  /** 显示隐形块/墙（Main.ShouldShowInvisibleBlocksAndWalls，Main.cs:57403-57408
   *  = SceneMetrics.EchoMonolith（657 回声腔激活帧，SceneMetrics.cs:545-549）
   *  ∨ Player.CanSeeInvisibleBlocks（幽灵护目镜 4409 :14080 / 回声腔物品 5345
   *  时装格 :13796））。本仓由 Game 每 tick 装配进 store（渲染/光照/烘焙的
   *  公共分母）；翻转时 Game 负责 chunks.invalidateAll + lighting.dirty */
  showInvisibleBlocks = false;
  // wire 位掩码常量（对应原版 Tile.cs:396-459 的 wire/wire2/wire3/wire4/actuator/inActive）
  static readonly WIRE_RED = 1;
  static readonly WIRE_BLUE = 2;
  static readonly WIRE_GREEN = 4;
  static readonly WIRE_YELLOW = 8;
  static readonly WIRE_ACTUATOR = 16;
  static readonly WIRE_ACTUATED = 32;
  static readonly WIRE_COLORS = 15; // 四色掩码

  // 涂层位掩码（= 存档 header4 位，WorldFile.cs:1539-1552；Tile.cs 运行时位
  // bTileHeader3 bit5/6/7 + sTileHeader bit15 的仓内单字节编码）
  static readonly COAT_INVISIBLE_BLOCK = 2;  // Tile.cs:558-573 invisibleBlock
  static readonly COAT_INVISIBLE_WALL = 4;   // Tile.cs:575-590 invisibleWall
  static readonly COAT_FULLBRIGHT_BLOCK = 8; // Tile.cs:592-607 fullbrightBlock
  static readonly COAT_FULLBRIGHT_WALL = 16; // Tile.cs:748-762 fullbrightWall
  static readonly COAT_BLOCK_MASK = 2 | 8;   // 方块侧两位（KillTile 清位域）
  static readonly COAT_WALL_MASK = 4 | 16;   // 墙侧两位（KillWall 清位域）

  // tile 变更监听（chunk 缓存 / 光照脏标记 / 液体模拟统一从这里拿事件）
  private listeners: Array<(x: number, y: number) => void> = [];
  /** ★C9d2 光照差量写日志（2026-09-28;?lightdelta=1 灰度时由 LightWorkerLink.bindStore
   *  挂载,null=零开销）:记录两次发送之间的全部 tile 通道变更格（世界索引 y*w+x）。
   *  变更原语内置推送;原版语义直写面（Game.ts CopyPaintAndCoating 族/联机 strip/
   *  netApplyLiquid/hardmode 渐进转化等）不 push——由引擎「内容脏门」兜底全量
   *  （lighting.dirty∨liquidDirty 且日志空）+ 120 tick 锚帧自愈,登记债。
   *  发送侧（LightWorkerLink.send）负责清空。 */
  tileWriteLog: number[] | null = null;
  /** ★BJ322（2026-09-24）：多格件「裸写窗」——置位期间 setTile 跳过 listeners 派发
   *  （netReporter 照常上报）。原版 ShiftTallGate/ShiftTrapdoor 对 w×h 全格直写
   *  tile.type（WorldGen.cs:52215-52219/:51958-51964）【无任何逐格 TileFrame】，写完
   *  才整体 TileFrame 面（:52224-52231）；本仓逐格 setTile 即时派发会把【半写态】交给
   *  Check* 完整性裁决 → killDecorTile 在写循环中途吃掉已写格（机关门右击=残缺贴图
   *  +误掉落物,用户实报）。写方（Door.shiftTallGate 等）try/finally 包裹此窗,写完后
   *  由 afterWrite 钩跑一次完整性面=「写完再评估」原版等价。（与 _decorPlaceBuilding
   *  的差异：那是在 Game 侧按放置操作包整段；此窗在 store 侧按单次多格裸写包,导线/
   *  DoorOpeningHelper/网络重放等无 Game 栈的调用方同享） */
  suppressListeners = false;

  // ---- 多人联机上报钩子（ClientNet 注入；单机为 null 零开销） ----
  /** 本地 tile 变更上报（协议层 TileOp 收集器）。liquid 通道不报（客户端本地模拟） */
  netReporter: ((op: import('../net/protocol').TileOp) => void) | null = null;
  /** 应用远端操作期间置位：上报钩子静默（防回环） */
  netSuppress = false;

  constructor(w: number, h: number, bufs?: import('../workers/protocol').TileBuffers) {
    this.w = w; this.h = h;
    // buffers 注入（worker transfer 重建路径）：直接以移交的 ArrayBuffer 包装 TypedArray，
    // 跳过分配与拷贝。缺省 explored 由调用方（World.fromPacket）补齐
    if (bufs) {
      this.type = new Uint16Array(bufs.type);
      this.flags = new Uint8Array(bufs.flags);
      this.frameX = new Uint16Array(bufs.frameX);
      this.frameY = new Uint16Array(bufs.frameY);
      this.wall = new Uint16Array(bufs.wall);
      this.liquid = new Uint8Array(bufs.liquid);
      this.liquidType = new Uint8Array(bufs.liquidType);
      this.half = new Uint8Array(bufs.half);
      this.slope = new Uint8Array(bufs.slope);
      this.wire = new Uint8Array(bufs.wire);
      // 油漆双通道（旧包可缺省——worker 包版本 <5 无此二数组，全 0 = 无油漆；
      // fromPacket 路径已按 explored 同款兜底补零，此处理论上不会缺，防御性兜底）
      const nBuf = bufs.type.byteLength / 2;
      this.paint = bufs.paint ? new Uint8Array(bufs.paint) : new Uint8Array(nBuf);
      this.paintWall = bufs.paintWall ? new Uint8Array(bufs.paintWall) : new Uint8Array(nBuf);
      // 涂层位通道（旧包可缺省 = 全 0 无涂层，同 paint 兜底）
      this.coat = bufs.coat ? new Uint8Array(bufs.coat) : new Uint8Array(nBuf);
      return;
    }
    const n = w * h;
    this.type = new Uint16Array(n);
    this.flags = new Uint8Array(n);
    this.frameX = new Uint16Array(n);
    this.frameY = new Uint16Array(n);
    this.wall = new Uint16Array(n);
    this.liquid = new Uint8Array(n);
    this.liquidType = new Uint8Array(n);
    this.half = new Uint8Array(n);
    this.slope = new Uint8Array(n);
    this.wire = new Uint8Array(n);
    this.paint = new Uint8Array(n);
    this.paintWall = new Uint8Array(n);
    this.coat = new Uint8Array(n);
  }

  idx(x: number, y: number): number { return y * this.w + x; }

  /** ★幽灵格净化(2026-09-07 方案B,全面对齐原版):worldgen 遗留的
   *  active=false+type≠0 格(实测单世界可达 163 万)——原版存档格式对这类格
   *  不写 type(WF:1458-1462 flag 门),「存档→读档」后它们就是空气;原版玩家
   *  永远活在无幽灵世界里。本仓 v5 曾用差分通道跨存读保留它们(「幽灵保域」),
   *  但每一条「裸读 type 不查 active」的运行时路径(替换掉落/矿石闪光/液体重建…)
   *  都是潜在地雷,已累计多起——彻底对齐原版:在读档/生成边界净化(type 清零、
   *  帧置 -1,对齐原版 LoadWorldTiles 非活格行为;wall/liquid/wire/paint 等
   *  flag 外通道按原版语义保留)。返回净化格数。
   *  ★净化语义与 fc98050f 战役(幽灵保域)的关系:保域服务「生成会话内」的
   *  worldgen 对拍(x86 rig 幽灵参与 GERunner/拒绝采样判定)——对拍点在生成
   *  函数内,本净化挂读档/进世界边界,不影响既有金标。 */
  purgeGhostTiles(): number {
    let purged = 0;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      if (!this.flags[i] && this.type[i] !== 0) {
        this.type[i] = 0;
        this.frameX[i] = 65535; this.frameY[i] = 65535;   // -1(原版非活格帧语义,killTile 同款)
        purged++;
      }
    }
    return purged;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** 原版 WorldGen.InWorld(x,y,fluff)（WorldGen.cs:9642-9649）fluff=1 档：
   *  x<1 || x>=w-1 || y<1 || y>=h-1 → false——世界最外一圈恒不受理。
   *  ★A-5 边带语义（2026-09-04）：SolidTile3(i,j)（WorldGen.cs:71005-71013）首门
   *  即本档（坐标重载专属;Tile 重载 SolidTile3(Tile) 无此门,null→false 同面）——
   *  消费位见 Player/Enemy/MinionProj/TileLightScanner 各 SolidTile3 锚。 */
  inWorld1(x: number, y: number): boolean {
    return x >= 1 && y >= 1 && x < this.w - 1 && y < this.h - 1;
  }

  get(x: number, y: number): number { return this.inBounds(x, y) ? this.type[this.idx(x, y)] : 0; }

  isActive(x: number, y: number): boolean {
    // 原版 nactive() = active && !inActive（Tile.cs:242-248/:591-606）：已致动格视为不活跃。
    // ★幽灵保域（2026-09-02）：active 位读 flags bit0——幽灵格（flags=0,type≠0,
    // 原版 active(false) 残型）不算活跃。此前 flags≡(type≠0) 恒等式（finalize
    // 出口净化维持）下省略 flags 读无害，保域后必须显式查位（vanilla
    // SolidTile/TileCollision:2331/液体/寻家等全走 active()）。
    return this.inBounds(x, y) && this.flags[this.idx(x, y)] !== 0
      && (this.wire[this.idx(x, y)] & TileStore.WIRE_ACTUATED) === 0;
  }

  /** 原版 inActive()：致动器翻转后的"缩入地下"态（有 type 但不碰撞不阻挡） */
  isActuated(x: number, y: number): boolean {
    return this.inBounds(x, y) && (this.wire[this.idx(x, y)] & TileStore.WIRE_ACTUATED) !== 0;
  }

  /** 原版 active()（Tile.cs:591-594 sTileHeader 0x20 位）——纯 HasTile 位，含已致动格。
   *  ★幽灵格（flags=0,type≠0——生成期 active(false) 残型，TileCleanupPass/ShimmerPass
   *  等按原版留型）判 false。与 isActive（=nactive()，多排致动位）区分；曾有无位可读时
   *  以 type≠0 代之——幽灵保域批（2026-08-31）破 flags≡(type≠0) 恒等后必须读本位。 */
  hasTile(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.flags[this.idx(x, y)] !== 0;
  }

  isSolid(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false; // 世界外视为空（边缘自由）
    // ★热路径双修(2026-08-19 trace 16:12 剖析:粒子碰撞逐帧调用占主线程 42.7%,
    // 旧版 idx() 乘法×2 + TILE_DEFS 对象查):
    //  ① idx 只算一次 ② 实心判定走 SOLID_LUT(类型 id → 1/0 的 Uint8Array,
    //  免对象查找与属性访问;TILE_DEFS 构建后不变,LUT 同构)
    const i = this.idx(x, y);
    // ★幽灵保域（2026-09-02）：首门=原版 SolidTile(i,j) 的 active()（WorldGen.cs
    //  :70650-70652 `active() && tileSolid[type] && …`）——幽灵格（flags=0,type≠0,
    //  x86 pre 世界 1,471,380 格）非实心不碰撞；此前靠 finalize 出口净化维持
    //  "type≠0⇒active" 恒等式,保域后必须显式查位
    if (this.flags[i] === 0) return false;
    if (this.wire[i] & TileStore.WIRE_ACTUATED) return false; // 已致动不碰撞
    return TileStore.SOLID_LUT[this.type[i]] === 1;
  }

  /** ★BJ308 严格 SolidTile（WorldGen.SolidTile(int,int,noDoors=false) WorldGen.cs
   *  :70642-70664 全谓词;Tile 重载 :70487-70502 同判据）——isSolid 基础上补实例面
   *  两排除:!halfBrick() ∧ slope()==0。三排除中 !tileSolidTop 已折入 SOLID_LUT
   *  （defs.solid ≡ tileSolid∧!tileSolidTop——tileSolid∩tileSolidTop 平台九件套
   *  {19,239,380,427,435-439} defs solid:false,BJ187 SOLID_TOP_SHEETS 判定单源）。
   *  消费面=液体渲染器门②（TileDrawing.cs:4141-4148 num15=0 悬空门,增强段+浸润带
   *  两处）——曾以宽谓词 isSolid 充数,邻格半砖/坡面格误判实心 → 门②少触发=多画。
   *  其余 isSolid 消费位语义各自锚定,禁盲换本谓词。 */
  isSolidStrict(x: number, y: number): boolean {
    if (!this.isSolid(x, y)) return false;
    const i = this.idx(x, y);
    return this.half[i] === 0 && this.slope[i] === 0;
  }

  /** SolidTile2∩平台九件套单源（Main.cs：19 :8031-8032 / 239 :9797-9798 /
   *  380 :9799-9800 / 427 :10118-10119 / 435-439 循环 :10126-10136——整批
   *  tileSolid=true∧tileSolidTop=true;isSolid 的 SOLID_LUT=defs.solid 把它们
   *  排除在外,本表补差集）。消费面=isSolid2（WorldGen.SolidTile2 1:1）。 */
  static readonly PLATFORM_SOLID2_SHEETS: ReadonlySet<number> = new Set([
    19, 239, 380, 427, 435, 436, 437, 438, 439,
  ]);

  /** ★BJ-C9-SP（2026-10-09）WorldGen.SolidTile2（WorldGen.cs:70665-70680）1:1：
   *  active ∧ **tileSolid【无 !tileSolidTop 排除——Main.cs:8032 `tileSolid[19]=true`,
   *  平台九件套整批计入,与 SolidTile(:70642 检 `!tileSolidTop`) 的唯一差集】**
   *  ∧ slope()==0 ∧ !halfBrick() ∧ !inActive()。消费面=PickSentryLandingSpot
   *  （Player.cs:50057 三列扫——原版哨杖落点平台即止=哨兵可放平台,旧 isSolid
   *  窄谓词漏平台=蜘蛛女王杖 2366 哨兵落不到平台实报根因）;其余 SolidTile2
   *  域（家具支撑 :45602 等）各自锚定勿盲换。 */
  isSolid2(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.flags[i] === 0) return false;                    // active()
    if (this.wire[i] & TileStore.WIRE_ACTUATED) return false; // !inActive()
    if (this.slope[i] !== 0 || this.half[i] !== 0) return false;  // slope==0 ∧ !halfBrick
    if (TileStore.SOLID_LUT[this.type[i]] === 1) return true; // tileSolid∧!tileSolidTop 族
    return TileStore.PLATFORM_SOLID2_SHEETS.has(
      TILE_DEFS[this.type[i]]?.vanilla?.sheet ?? -1);         // 平台九件套补差集
  }

  /** 实心 LUT(内部类型 id → 1/0;与 TILE_DEFS 同长,模块加载时构建一次;
   *  ★mod tile 扩容(2026-10-14):mod tile 运行期注册后逐 tile 经 onTileRegistered
   *  钩扩容+回填——否则 mod id(762+)越界读 undefined=永非实心,灾厄地形不可踩踏。
   *  readonly 去除:扩容换引用,消费方全走 TileStore.SOLID_LUT 静态属性读取,安全) */
  static SOLID_LUT = (() => {
    const lut = new Uint8Array(TILE_DEFS.length);
    for (let t = 0; t < TILE_DEFS.length; t++) lut[t] = TILE_DEFS[t]?.solid ? 1 : 0;
    return lut;
  })();

  /** 站顶单向面（原版 Collision.TileCollision :2330-2333 的 flag 门：
   *  `flag = tileSolid[type]; if (tileSolidTop[type] && frameY == 0) flag = true`
   *  分两族语义——
   *  ① 平台行为族 = tileSolid∩tileSolidTop 九件套（1457 Main.cs：19 :8031-8032 /
   *    239 :9797-9798 / 380 :9799-9800 / 427 :10118-10119 / 435-439 团队平台五色
   *    :10126-10136 整批 tileSolidTop+tileSolid,TileID.cs:1307-1315;旧注 7841/9568/
   *    9570/9888 系 1.4.4 代行号已废）：19 平台/239 矿锭/380 花盆箱/427-439 团队
   *    平台六色。flag=tileSolid **恒真**——其 frameY 是材质行（PlaceTile case 19/380
   *    `frameY = 18*style`，TileFrameImportant 只重写 frameX 连接形态），**可站与
   *    frameY 无关**。曾把家具的 frameY==0 门套到平台族
   *    → 世界生成放的 13+ 材质平台（CaveHouse/HouseBuilder PlatformStyle）全体穿透。
   *    ★本仓快查分支暂列前四件：五色团队平台各 tile id 单 item 单 placeStyle,
   *    实放 frameY=0 档,经②家具族分支同判可站=行为等价（vanilla TileObjectData.cs
   *    :2150-2162 五色 StyleMultiplier=27 多 style 位——将来引入多 style 摆放须同步
   *    扩快查）;DrownCollision 豁免行消费的静态族表九件套在 stats/TouchDamage.ts
   *    TILE_SOLID_TOP_FAMILY（蓝队 F1 已扩齐）。
   *  ② 家具族（tileSolid=false：桌/铁砧/工作台/钢琴/书架/笼子等）：frameY==0=底行
   *    才可站，上半格（frameY>0）不站。
   *  nactive 门（:2327）：已致动(inActive)的平台/家具顶不可站。
   *  单向性（X 轴/上顶不拦）由消费端保证：TileCollision X/上顶分支不查 isPlatform。
   *  注：SolidCollision(acceptTopSurfaces) :2771 对 Platforms 集合改用
   *  PlatformProperTopFrame(frameX)——该查询路径本仓无消费者，不移植（登记）。 */
  isPlatform(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    // ★幽灵保域（2026-09-02）：active 位首门（原版 TileCollision :2331
    //  `!tile.active() → continue` 的平台支同门）——幽灵平台不可站
    if (this.flags[i] === 0) return false;
    if (this.wire[i] & TileStore.WIRE_ACTUATED) return false;   // nactive()（致动=不可站）
    const d = TILE_DEFS[this.type[i]];
    if (!d?.platform) return false;
    // 平台行为族（tileSolid∩tileSolidTop）：材质行在 frameY，可站与 frameY 无关
    const sheet = d.vanilla?.sheet;
    if (sheet === 19 || sheet === 239 || sheet === 380 || sheet === 427) return true;
    return this.frameY[i] === 0;   // 家具族：底行才可站
  }

  /** ★BJ656（2026-10-12）原版裸 Main.tileSolid[type] 物化（nactive() 门）——
   *  isSolid（SOLID_LUT≡tileSolid∧!tileSolidTop）∪ 平台九件套补差集
   *  （tileSolid∩tileSolidTop 双 true 全集 {19,239,380,427,435-439}——Main.cs
   *  :8031-32/:9797-9800/:10118-10136,PLATFORM_SOLID2_SHEETS 同集）=tileSolid 真表。
   *  消费面=AI_007 城镇 NPC 支撑扫描三站（BJ656 亲读定谳【同式】统一——
   *   ①腾空停走臂B NPC.cs:54771-72 `tileSafely6.liquid>0 || (tileSafely6.nactive()
   *     && Main.tileSolid[tileSafely6.type])`；②坑口停走三列 :54563 同式（无液体臂）；
   *   ③walkPrediction 前视列 :56291 同式——平台经双旗真值本就计入,家具顶（桌14/
   *   椅15/铁砧16/工作台18 等原版 tileSolid=false）不计）。
   *  ★勿与 isPlatform（TileCollision :2330-33 可站顶宽谓词,含家具 frameY==0 顶）
   *  混用——那正是 2026-08-31 walkPrediction 宽化的病根（其注释错锚 SolidOrSloped
   *  TileOrPlatform :53335——该函数实为 FindGoodRestingSpot :53352 找地板谓词,
   *  =tileSolid∧!tileSolidTop ∪ TileID.Sets.Platforms{19,427,435-439},同样不含
   *  家具顶）。 */
  isVanillaTileSolid(x: number, y: number): boolean {
    if (this.isSolid(x, y)) return true;
    if (!this.isActive(x, y)) return false;   // nactive()（active ∧ !inActive）
    return TileStore.PLATFORM_SOLID2_SHEETS.has(
      TILE_DEFS[this.type[this.idx(x, y)]]?.vanilla?.sheet ?? -1);
  }

  /** ★BJ657（2026-10-12）原版 TileID.Sets.Platforms（TileID.cs:243
   *  CreateBoolSet(19,427,435,436,437,438,439)）七件——PLATFORM_SOLID2_SHEETS
   *  九件套的【子集】,差集 {239,380}（tileSolid∩tileSolidTop 双 true 但不在
   *  Platforms）。单源消费=isSolidOrSlopedTileOrPlatform 平台臂;勿与九件套混用
   *  （九件套用于 tileSolid 真表补差,七件用于 FindGoodRestingSpot 地板谓词）。 */
  static readonly TILE_ID_PLATFORMS: ReadonlySet<number> = new Set([
    19, 427, 435, 436, 437, 438, 439,
  ]);

  /** ★BJ657（2026-10-12）NPC.SolidOrSlopedTileOrPlatform（NPC.cs:53335-53343）
   *  1:1 物化：active ∧ (tileSolid∧!tileSolidTop ∨ TileID.Sets.Platforms) ∧
   *  !inActive。★与 isVanillaTileSolid（BJ656 同族）【不同式】——平台臂是七件
   *  子集 TILE_ID_PLATFORMS,非九件套全：239 矿锭架/380 花盆箱 tileSolid∩tileSolidTop
   *  双 true 但不在 Platforms → 原版地板下探不把它们当地板——勿换九件套（重蹈
   *  isPlatform 宽化=BJ656 登记债 D1）;家具顶（桌14/铁砧16/工作台18 等原版
   *  tileSolid=false,isPlatform frameY==0 可站面）同样不当地板（下探须穿透）。
   *  唯一原版消费面=AI_007_FindGoodRestingSpot 地板下探 :53352（本仓两站
   *  findChairSpot/restFloor;椅搜本体 :53363+ 走 CanBeSatOnForNPCs 不经本谓词;
   *  :53363 面是城镇史莱姆/ai0==5 跳过门）。坡面/半砖不排除（原文本无 slope/
   *  halfBrick 门,函数名 Sloped 系历史命名,本仓 isSolid 同不查坡=同式）。 */
  isSolidOrSlopedTileOrPlatform(x: number, y: number): boolean {
    if (this.isSolid(x, y)) return true; // tileSolid∧!tileSolidTop（active∧!inActive 门已含）
    if (!this.hasTile(x, y)) return false;                                 // tile.active()
    if (this.wire[this.idx(x, y)] & TileStore.WIRE_ACTUATED) return false; // !inActive()
    return TileStore.TILE_ID_PLATFORMS.has(
      TILE_DEFS[this.type[this.idx(x, y)]]?.vanilla?.sheet ?? -1);
  }

  /** ★BJ715-A-③（2026-10-25）原版裸 `TileID.Sets.Platforms[type]`——**纯 type 谓词**
   *  （TileID.cs:243 CreateBoolSet(19,427,435-439)）:不看 active/致动/frameY——致动
   *  平台照算地板、家具顶（桌椅砧等 tileSolid=false）永不算。锚=CultistRitual.
   *  CheckFloor 柱判定第二臂（CultistRitual.cs:117 `TileID.Sets.Platforms[
   *  Framing.GetTileSafely(num2,num3).type]`——GetTileSafely 只取 tile 对象读 type,
   *  active 位不进门）,单源消费=RuntimeEvents.cultistCheckFloorPts（bossAI_lunar_misc
   *  ritualCheckFloor 委托同源）。OOB → GetTileSafely 空 tile type 0 ∉ 七件集 = false
   *  同式。★勿与 isPlatform（TileCollision 可站顶宽谓词:active+致动门+家具 frameY==0
   *  顶）/isSolidOrSlopedTileOrPlatform（七件集+active 门）混用——三者皆非本式
   *  （isPlatform 会漏致动平台、多算家具顶,恰是 R18 定谳的域错方向）。 */
  isPlatformsType(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return TileStore.TILE_ID_PLATFORMS.has(
      TILE_DEFS[this.type[this.idx(x, y)]]?.vanilla?.sheet ?? -1);
  }

  onTileChanged(fn: (x: number, y: number) => void) {
    this.listeners.push(fn);
  }

  /** ★BJ361（2026-09-25）：裸写窗后的手动补派发原语——suppressListeners 窗把整批
   *  写入的监听派发一并吃掉,其中含渲染 mark 主通道（ChunkCache 构造期订阅
   *  onTileChanged→markDirtyAround,ChunkCache.ts:300,chunk 烘焙失效唯一口）——
   *  门开关贴图不变化回归即此（用户实报:type 已切换/chunk 缓存不失效=旧 type 像素）。
   *  裸写窗宿主（Door.shiftTallGate/shiftTrapdoor）在窗关闭后对【写入域】逐格补派发:
   *  整件已完整 → Check* 完整性裁决不会判坏（BJ322 半写态病灶不复发）,监听全族
   *  （mark/火把/藤/巨石/家具/DECOR/触发板）恢复原版「逐格直写监听即时派发」语义。 */
  notifyChanged(x: number, y: number): void {
    this.listeners.forEach((fn) => fn(x, y));
  }

  /** 液体变化独立通道：chunk 缓存不订阅（水不入烘焙画布，无需重建），
   *  只有光照订阅（水的光衰减）——避免水流时每帧冲爆 chunk 重建队列造成卡顿 */
  private liquidListeners: Array<(x: number, y: number) => void> = [];
  onLiquidChanged(fn: (x: number, y: number) => void) {
    this.liquidListeners.push(fn);
  }

  /** 唯一的写入入口（生成/导入期可绕过用 setTileSilent） */
  setTile(x: number, y: number, type: number, frameX = 0, frameY = 0) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const wasActive = this.flags[i] !== 0;
    this.type[i] = type;
    this.flags[i] = type !== 0 ? 1 : 0;
    this.frameX[i] = frameX;
    this.frameY[i] = frameY;
    if (type === 0) { this.half[i] = 0; this.slope[i] = 0; } // 挖除清半砖/坡面
    // ★终审 B①（2026-09-04）：KillTile 尾 WorldGen.cs:64431 `tile.type = 0;
    //  tile.inActive(inActive: false);`——破坏清格时复位致动位（wire 色位/致动器
    //  挂件位照原版保留,仅清 inActive）。曾缺此清位 → 已致动格被破坏后重铺新块
    //  继承 WIRE_ACTUATED=生而隐形（原版不存在此态;放置门改裸 active() 后,
    //  豁免件清格路径经此口复位）。生成期 type=0 写入同口径（原版生成写全新 Tile,
    //  inActive 恒 false）。
    if (type === 0) this.wire[i] &= ~TileStore.WIRE_ACTUATED;
    // 油漆随方块清除/铺块重置：
    //   KillTile（WorldGen.cs:63933-63939）active(false)+halfBrick(false)+ClearBlockPaintAndCoating；
    //   PlaceTile（WorldGen.cs:59499-59501）!active() 时 Clear(Tile|TilePaint|Slope)。
    //   即油漆只在 active→active 的替换（草化/转化）中存活
    if (type === 0 || !wasActive) {
      this.paint[i] = 0;
      this.coat[i] &= ~TileStore.COAT_BLOCK_MASK; // ClearBlockPaintAndCoating（Tile.cs:934-939：color/fullbright/invisible 三清，只清方块侧）
    }
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    if (this.netReporter && !this.netSuppress) this.netReporter({ a: TileOpAction.SetTile, x, y, v: type, fx: frameX, fy: frameY });
    // ★BJ322：suppressListeners 窗内跳过监听派发（netReporter 不受影响——联机同步面照常）
    if (!this.suppressListeners) this.listeners.forEach((fn) => fn(x, y));
  }

  /** 运行期改半砖/坡面位（锤子交互用；生成期直接写数组即可） */
  setHalfBrick(x: number, y: number, v: boolean) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.half[i] = v ? 1 : 0;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    if (this.netReporter && !this.netSuppress) this.netReporter({ a: TileOpAction.SetHalfBrick, x, y, v: v ? 1 : 0, fx: 0, fy: 0 });
    this.listeners.forEach((fn) => fn(x, y));
  }

  setSlope(x: number, y: number, s: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.slope[i] = s;
    this.half[i] = 0; // 原版 SlopeTile 无条件 halfBrick(false)（WorldGen.cs:49174），slope=0 复位时同样
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    if (this.netReporter && !this.netSuppress) this.netReporter({ a: TileOpAction.SetSlope, x, y, v: s, fx: 0, fy: 0 });
    this.listeners.forEach((fn) => fn(x, y));
  }

  setTileSilent(x: number, y: number, type: number, frameX = 0, frameY = 0) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.type[i] = type;
    this.flags[i] = type !== 0 ? 1 : 0;
    this.frameX[i] = frameX;
    this.frameY[i] = frameY;
    if (type === 0) { this.half[i] = 0; this.slope[i] = 0; } // 挖除同步清位（防生成期脏残留）
    // ★终审 B①（2026-09-04）：同 setTile——KillTile 尾 :64431 复位 inActive
    if (type === 0) this.wire[i] &= ~TileStore.WIRE_ACTUATED;
    // ★IIIII201（2026-09-03）勘误：清漆/涂层只属 **type===0（KillTile 族,
    //   ClearBlockPaintAndCoating Tile.cs:934-939）**——曾连 !wasActive（新置入空格）
    //   一并清，而 vanilla PlaceTile default 支（WorldGen.cs:60725-60741）只写
    //   active+type(+特例 color)，**不动 paint/coat 位**：extraLiquid 泡泡方块
    //   （cs:1788-1794 全方格 fullbrightBlock(true)）内后置落位的砖/植/滴头因此
    //   丢亮涂层 → DoExtraLiquidFinish 的 fullbright 支（cs:1852-1860）不触发 →
    //   waterpark #105 L=44/T374×2（2026-09-03 实证）。paint 同理保留。
    if (type === 0) {
      this.paint[i] = 0;                          // KillTile 油漆清位
      this.coat[i] &= ~TileStore.COAT_BLOCK_MASK; // ClearBlockPaintAndCoating（Tile.cs:934-939）
    }
    if (this.tileWriteLog) this.tileWriteLog.push(i);
  }

  /** 原版 tile.active(false) 等价：仅失活（清 active 位+half/slope），**保留 type 字段**
   *  ——产生幽灵格（inactive 但 type≠0）。vanilla worldgen 的 cave-carving/KillTile
   *  多数路径走此形态而非硬清 type（Collision.WetCollision/GERunner 等裸读 type 的
   *  消费者依赖此残型）。★2026-08-31 幽灵保域批核心原语。 */
  deactivateTile(x: number, y: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.flags[i] = 0;                            // active(false)
    this.half[i] = 0;                             // halfBrick(false)（KillTile 标准尾）
    this.slope[i] = 0;                            // slope(false)
    this.paint[i] = 0;                            // ClearBlockPaintAndCoating（Tile.cs:934-39）
    this.coat[i] &= ~TileStore.COAT_BLOCK_MASK;
    // type[i] 不动 ← 幽灵格核心语义
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    if (this.netReporter && !this.netSuppress) this.netReporter({ a: TileOpAction.SetTile, x, y, v: 0, fx: 0, fy: 0 });
    this.listeners.forEach((fn) => fn(x, y));
  }

  setWall(x: number, y: number, wall: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const hadWall = this.wall[i] !== 0;
    if (this.wall[i] !== wall) {
      this.wall[i] = wall;
      // 墙漆清位：KillWall（WorldGen.cs:60425-60426）wall=0 后 ClearWallPaintAndCoating；
      // PlaceWall（:75727-75745）本身不清 wallColor——但 KillWall 已保证 wall==0 ⇒ 无漆，
      // 故 0→非0 铺墙时同样归零（保持原版不可达态不变量，见 world/Paint.ts）。
      // ★非0→非0 不在此清漆（H3-3 落点裁决,2026-09-04）：本原语被硬后蔓延
      // （HardmodePass → Convert_ActuallyConvertWall WorldGen.cs:55708-55722 区
      // `theTile.wall = newType` 裸写【保漆】）与世界演化 convWall 复用——清漆臂
      // 落在 ReplaceWall 语义专属调用点（Game.tryPlaceWall 墙替换支,
      // WorldGen.cs:63049-63050 `tile.wall = targetWall; ClearWallPaintAndCoating()`）
      if (wall === 0 || !hadWall) {
        this.paintWall[i] = 0;
        this.coat[i] &= ~TileStore.COAT_WALL_MASK; // ClearWallPaintAndCoating（Tile.cs:941-946）
      }
      if (this.netReporter && !this.netSuppress) this.netReporter({ a: TileOpAction.SetWall, x, y, v: wall, fx: 0, fy: 0 });
      this.listeners.forEach((fn) => fn(x, y));
      if (this.tileWriteLog) this.tileWriteLog.push(i);
    }
  }

  setWallSilent(x: number, y: number, wall: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const hadWall = this.wall[i] !== 0;
    this.wall[i] = wall;
    if (wall === 0 || !hadWall) {
      this.paintWall[i] = 0;                    // 同 setWall 的墙漆清位
      this.coat[i] &= ~TileStore.COAT_WALL_MASK; // ClearWallPaintAndCoating（Tile.cs:941-946）
    }
    if (this.tileWriteLog) this.tileWriteLog.push(i);
  }

  /** 油漆写入（WorldGen.paintTile/paintWall 等价原语）。发 listeners：油漆改变 tile/wall
   *  视觉色 → chunk 画布与小地图都须重建（导线不进烘焙画布故 setWire 不发，此处不同）。
   *  值域 0-31（PaintID），>31 由调用方保证不出现（Item.paint 为 byte） */
  setPaint(x: number, y: number, v: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.paint[i] === v) return;
    this.paint[i] = v & 31;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    this.listeners.forEach((fn) => fn(x, y));
  }

  setPaintSilent(x: number, y: number, v: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.paint[i] === v) return;
    this.paint[i] = v & 31;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
  }

  /** 墙漆写入（WorldGen.paintWall） */
  setPaintWall(x: number, y: number, v: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.paintWall[i] === v) return;
    this.paintWall[i] = v & 31;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    this.listeners.forEach((fn) => fn(x, y));
  }

  setPaintWallSilent(x: number, y: number, v: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.paintWall[i] === v) return;
    this.paintWall[i] = v & 31;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
  }

  /** 涂层位写入（WorldGen.paintCoatTile/paintCoatWall 等价原语的位装配侧）。
   *  发 listeners：涂层改变 tile/wall 渲染（隐形跳过/全亮叠层）→ chunk 须重烘。
   *  mask=要改的位域（COAT_*），bits=该域目标值（0=清除）。 */
  setCoat(x: number, y: number, mask: number, bits: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const v = (this.coat[i] & ~mask) | (bits & mask);
    if (this.coat[i] === v) return;
    this.coat[i] = v;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    this.listeners.forEach((fn) => fn(x, y));
  }

  setCoatSilent(x: number, y: number, mask: number, bits: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const v = (this.coat[i] & ~mask) | (bits & mask);
    if (this.coat[i] === v) return;
    this.coat[i] = v;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
  }

  /** 导线/致动位写入（Wiring 系统）。不发 listeners：导线不进 chunk 烘焙画布，
   *  走 Renderer 动态覆盖层；致动位变化才需要标脏 chunk（调用方负责） */
  setWire(x: number, y: number, bits: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.wire[i] = bits & 63;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    if (this.netReporter && !this.netSuppress) this.netReporter({ a: TileOpAction.SetWire, x, y, v: bits & 63, fx: 0, fy: 0 });
  }

  setWireSilent(x: number, y: number, bits: number) {
    this.setWire(x, y, bits);
  }

  /** 致动器翻转 inActive 态（Wiring.DeActive/ReActive 用）：影响碰撞与渲染，须发 listeners */
  setActuated(x: number, y: number, v: boolean) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const b = v ? (this.wire[i] | TileStore.WIRE_ACTUATED) : (this.wire[i] & ~TileStore.WIRE_ACTUATED);
    if (this.wire[i] === b) return;
    this.wire[i] = b;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    if (this.netReporter && !this.netSuppress) this.netReporter({ a: TileOpAction.SetActuated, x, y, v: v ? 1 : 0, fx: 0, fy: 0 });
    this.listeners.forEach((fn) => fn(x, y));
  }

  setLiquid(x: number, y: number, amount: number, type: number) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const a = Math.max(0, Math.min(255, amount | 0));
    if (this.liquid[i] === a && this.liquidType[i] === type) return;
    this.liquid[i] = a;
    this.liquidType[i] = type;
    if (this.tileWriteLog) this.tileWriteLog.push(i);
    this.liquidListeners.forEach((fn) => fn(x, y));
  }
}

// ★mod tile 实心扩容订阅(见 SOLID_LUT 注;类定义后挂=静态表已就绪):
//  mod tile 运行期注册逐 tile 通知,越界则按 TILE_DEFS.length 重铸换引用。
onTileRegistered((id, d) => {
  if (id >= TileStore.SOLID_LUT.length) {
    const next = new Uint8Array(TILE_DEFS.length);
    next.set(TileStore.SOLID_LUT);
    TileStore.SOLID_LUT = next;
  }
  TileStore.SOLID_LUT[id] = d.solid ? 1 : 0;
});
