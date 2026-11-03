// 生成期动态 tileSolid（原版 Main.tileSolid 生成期翻转族）统一模块。
//
// 原版 WorldGen 各 pass 会直接写 `Main.tileSolid[id] = true/false`（多数从翻转点到
// 生成结束不还原），生成期的 SolidTile/CanPoundTile 等一切实心查询读的都是这个
// **可变**数组——而非 Main.SetupTileAttribute 的初值。本仓 TILE_DEFS[t].solid 是
// 静态初值语义（运行时碰撞也用它），不能为生成期翻转去改数据；故在此维护一张
// 生成期覆写表，消费端用 isGenSolid / genSolidType 替代裸 `TILE_DEFS[t]?.solid`。
//
// 与 StructureMap（GenState.protectedRects）同属"生成期全局可变状态"，两者互不
// 干扰：本模块只管 tile 实心翻转，结构互斥矩形在 GenState.ts。
//
// ★设计说明（为什么是 Map 而非纯 non-solid Set）：
//  本仓 TILE_DEFS 有两处数据被预翻到"生成末态"（任务约定不可改数据）——
//   - 192 活树叶：Main.cs:10167 初值 true，数据标 false（tiles.ts 注释：LivingTrees
//     pass 尾 cs:15789 翻 false 后按 false 处理）；
//   - 481-483 裂纹砖：Main.cs:7865-7869 初值 true，数据标 false（DungeonCrawler.cs:344
//     起生成期恒 false）。
//  对这两族，原版存在"中途翻回 true"的窗口（192：cs:16324→16694；481-483：
//     SmoothWorld 头 cs:16510 翻 true、尾 cs:16695 翻回 false）。纯 non-solid 集合
//  无法表达 solid=true 覆写，故用 Map<number, boolean>（true 覆写也记）——语义是
//  Main.tileSolid 赋值的逐条重放，比 Set 更忠实且不损任何 Set 能表达的场景。
//
// ★翻转时间线（普通种子，1456 逐行核实；★R31-F1 重锚块见文末——1457 序列级
//   对拍+漂移表+pass 序变更登记；特殊种子专属翻转见文末备案）：
//   cs:11500  Reset          659=false（generateWorld 尾,唯一真正的"生成期初值"翻转）
//   cs:12537  DesertBiome 头 484=false（此后生成期再无 =true，恒非实心到结束）
//   cs:15114  Gems 头        484=false（冗余重放）
//   DC:344    MakeDungeon 头 481/482/483=false（本仓数据已预翻,接线仅存档时间线）
//   cs:15789  LivingTrees 尾 192=false（本仓数据已预翻,同上）
//   cs:15831  Altars 头      484=false（冗余）
//   cs:16212  JungleShrines 尾 137=false → cs:16692 SmoothWorld 尾还原 true
//   cs:16292  SettleLiquids 尾 484=false（冗余）
//   cs:16324  RemoveSurfaceWaterAboveSand 192=true（窗口到 cs:16694）
//   cs:16510  SmoothWorld 头 481-483=true / 尾 cs:16692-95：137=true、190=false、
//             192=false、481-483=false
//   cs:16702  Waterfalls 头 191=false / 尾 cs:16753 还原 true
//   cs:16782  FragileIce     226=false、162=false
//   cs:16944  LifeCrystals 尾 225=false
//   cs:17076  UndergroundHouses 头 226/162/225/190=true / 尾 cs:17220-23 全部=false
//   cs:17459  SpiderCaves 头 379=false / 尾 cs:17521 162=true
//   cs:17813  LihzahrdTemplePart2 头 162=false、226=true / 尾 cs:17816 232=false
//   cs:34530  templePart2() 体内 232=false → cs:34701 函数尾还原 true
//   cs:17821  CaveWalls 头   162=false、226=true、232=false
//   cs:17956  UndergroundJungleTrees 头 379=true（本仓缺该 pass,备案）
//   cs:17997  QuickCleanup 头 137/130=false / 尾 cs:18104-05 还原 true（本仓缺,备案）
//   cs:18773  Traps 头       379=false / 尾 cs:18897 还原 true
//   cs:18906  Piles 头       379/229/190/196/189/717/718/719/202/460/484=false
//   cs:19591  Piles 尾       190/192/196/189/717/718/719/202/225/460/379=true
//             （★229 与 484 不在还原列：229 要等 cs:21022 BeeLarva 才回 true）
//   cs:19628  SpawnPoint 头  379=false / 尾 cs:19731 还原 true
//   cs:21022  BeeLarva 头    229=true / 尾 cs:21047-48 232=true、162=true
//   cs:21331  TileCleanup 头 379=false / 尾 cs:21750 还原 true
//   cs:22306  FinalCleanup 头 484=false（冗余）
//   cs:28257  GrowLivingTree 体内 48=false → cs:28757 函数尾还原 true（无早退路径）
//
// ★特殊种子专属翻转（不接线,备案）：Pots cs:18123/18184、Traps cs:18894、
//   Piles cs:18919（均 noTrapsWorldGen 巨石分支）；LifeCrystals cs:16857（getGoodWorldGen
//   56=false）；SpiderCaves cs:17483/17519（notTheBees 225）；SpreadingGrass
//   cs:18538/18552-53（remixWorldGen）；SettleLiquidsPart2 cs:21057（getGoodWorldGen）。
//   另 Liquid 沉降自带翻转族（Liquid.cs:70/110/140 经 SetBoulderSolidity）属运行时
//   液体模块,不在生成 pass 范围。
//
// ★R31-F1 重锚块（2026-11-02 定谳,1457 序列级对拍——上表与备案的 cs: 行号=1456,
//   T7 worldgen 开工前须逐行重锚 1457,勿凭本表行号直引）：
//   对拍法：全树 tileSolid 翻转面两版提取（字面式 true/false + 变量式 solid/flag/t）
//   按序对拍。判语：翻转集合 1456 ⊂ 1457,差=恰 3 笔 MicroBiomes 增量（见下）,
//   非WorldGen 文件零 diff,余皆纯行号漂移且**非均匀**（分段常数,跳变点即内容迁址）：
//     Reset :11500→:11512（+12）/Piles 头 :18906→:18924（+18）/Piles 尾 :19591→
//     :19609（+18）/BeeLarva :21022→:21040（+18）/TileCleanup :21331→:21704（+373
//     =MicroBiomes 整段 ~354 行搬家的行数）/FinalCleanup :22306→:22338（+32）/
//     GrowLivingTree :28257→:28381（+124）/templePart2 :34530→:34868（+338）。
//   三笔 1457 增量（皆 MicroBiomes 槽前移的伴随面,SpecialSeed/getGood 域,运行时
//   单源零影响——终态两版逐位一致,序列对拍+终态推演双证）：
//     1457 :21075  MicroBiomes 头 56(黑曜石)=true（getGoodWorldGen）——SW 已接线
//               （MicroBiomesPass.ts IIIII220,其注引 1457 cs:21072-21074）
//     1457 :21077  MicroBiomes 头 229=true（!Skyblock.denyAllGeneration,无 getGood
//               门）——SW 未单独接线：真链 BeeLarva 头 :21040 已置 true ⇒ no-op
//               （MicroBiomesPass.ts :640 的 IIIII193 补播是轨段 save/restore 域
//               限定,非 pass 头全局位）
//     1457 :21420  MicroBiomes 尾 56=false（getGoodWorldGen）——SW 已接线
//               （MicroBiomesPass.ts :725）;SettleLiquidsPart2 头 :21430 56=true
//               （getGood）两版同在（1456 :21057,备案在册）,SW 未接线（同 no-op 性质）
//   ★pass 序变更（真语义差,登记 T7 D-②,冻结期内不动）：1457 将 MicroBiomes 从
//   101 位（…TileCleanup→LihzahrdAltar→MicroBiomes→Lilypads）前移 4 槽至 97 位
//   （BeeLarva→**MicroBiomes**→SettleLiquidsPart2→Cactus→TileCleanup→LihzahrdAltar
//   →Lilypads;105-pass 全序对拍仅此一差,1458 同序亲证 :21069）。三笔翻转即此次
//   前移的伴随面（提前进液体沉降窗,须自备 56 实心窗+还原）。SW pass 表
//   （WorldGen.ts '微群系' 槽,注引 cs:21785=1456）=1456 残序——RNG 流在槽 97 起
//   与 1457 分岔,属 053 收敛后的下一道对齐面。
import { TILE_DEFS, SOLID_TOP_SHEETS } from '../../../data/tiles';
import type { TileStore } from '../../TileStore';

/** 生成期实心覆写表：内部 tile id → 当前实心值（未登记 = 用 TILE_DEFS 初值）。 */
const solidOverrides = new Map<number, boolean>();

/** sheet id → 内部 tile id 列表（同一 sheet 可能挂多个内部 id,全部翻转） */
const IDS_BY_SHEET = new Map<number, number[]>();
for (let i = 0; i < TILE_DEFS.length; i++) {
  const s = TILE_DEFS[i]?.vanilla?.sheet;
  if (typeof s !== 'number') continue;
  const list = IDS_BY_SHEET.get(s);
  if (list) list.push(i);
  else IDS_BY_SHEET.set(s, [i]);
}

/** 生成开始清零（对应原版 Main.tileSolid 为进程级静态、每局生成重放同一翻转
 *  时间线；清零保证多次 generateWorld 不携带上一局的残留覆写）。 */
export function resetGenSolid(): void {
  solidOverrides.clear();
}

/** 翻转入口：sheetIds 为**原版 sheet id**（Main.tileSolid 下标），内部 id 经
 *  IDS_BY_SHEET 反查——消费端查 st.type 得内部 id,勿把 sheet id 当内部 id 用
 *  （本仓 liquidType 等编码陷阱同源）。solid=false→记非实心/true→记实心。 */
export function flipGenSolid(sheetIds: number[], solid: boolean): void {
  for (const sh of sheetIds) {
    const ids = IDS_BY_SHEET.get(sh);
    if (!ids) continue;
    for (const id of ids) solidOverrides.set(id, solid);
  }
}

/** 生成期覆写表快照/回放（隔离重放对拍用：管线时点状态原样搬运,不重演翻转序）。 */
export function snapshotGenSolid(): Map<number, boolean> {
  return new Map(solidOverrides);
}
export function restoreGenSolid(snap: Map<number, boolean>): void {
  solidOverrides.clear();
  for (const [k, v] of snap) solidOverrides.set(k, v);
}

/** 按内部 tile id 查生成期实心值（Main.tileSolid[type] 等价）。 */
export function genSolidType(t: number): boolean {
  const o = solidOverrides.get(t);
  if (o !== undefined) return o;
  return !!TILE_DEFS[t]?.solid;
}

/** 原版 Main.tileSolid=true 而 TILE_DEFS.solid(运行时碰撞)=false 的 9 类 sheet：
 *  19 平台族(Main.cs:7842)/239/380/427/435-439(Echo 族)——vanilla-tilecollision.json
 *  对账差集（这 9 类无生成期翻转记录）。genSolidType() 兜底是 TILE_DEFS.solid
 *  （碰撞语义），凡语义上要读「生成期 Main.tileSolid」的调用方（Pots 首实心门/
 *  PlacePot 地面门、SpreadGrass 3×3 实心扫描等）须经由本包装——尾部清剿批
 *  2026-08-17。 */
export const VAN_TILE_SOLID_EXTRA = new Set([19, 239, 380, 427, 435, 436, 437, 438, 439]);

/** 原版 Main.tileSolidTop 静态表（sheet 域）——DungeonPass ltAllowBottomSlope 同源
 *  表上收单源。生成期零翻转（WorldGen 全树无 =false 写）。消费面=「tileSolid∨
 *  tileSolidTop」第二析取支（SolidTileAllowBottomSlope cs:70706 族），SolidTile/
 *  SolidTile2/AllowTopSlope 均不含 solidTop——勿共用到他处。
 *  ★IIIII229（⑧ 212 章 M2）：DungeonPass:8214 LT_SOLIDTOP_SET 与 DungeonDualLayout
 *  solidAllowBottomSlope 的 `def.vanilla.solidTop===true` 死字段（TILE_DEFS 无该字段,
 *  局部 `as unknown as` 放宽压掉 tsc ⇒ 恒 false）双双收编到此单源。
 *  ★BJ187（2026-09-19）：本表旧值 79 项=逐条赋值提取漏 Main.cs:10125-10131 循环臂
 *  tileSolidTop[435-439]=true（BJ186 登记的真值差#1——「Echo 平台」系台账笔误,实为
 *  队伍平台族 TeamBlockGreen/Blue/Yellow/Pink/WhitePlatform,427=红队平台同族）。
 *  现收编 data/tiles.ts:SOLID_TOP_SHEETS 单源（84 项,程序化对拍全等）——DungeonDualLayout
 *  solidAllowBottomSlope 对 435-439 由恒 false 修正为走平台 half 臂（与 vanilla
 *  `tileSolid∨tileSolidTop` 对齐）。 */
export const VAN_TILE_SOLIDTOP_SHEET_SET = SOLID_TOP_SHEETS;
const SHEET_OF_TYPE = new Int32Array(TILE_DEFS.length).fill(-1);
for (let i = 0; i < TILE_DEFS.length; i++) {
  const s = TILE_DEFS[i]?.vanilla?.sheet;
  if (typeof s === 'number') SHEET_OF_TYPE[i] = s;
}

/** ★BJ754 TF-12/TF-13（2026-11-02,issue#39）：【运行时】Main.tileSolid 谓词（内部
 *  tile id 域）——碰撞 LUT ∪ 九类差集 VAN_TILE_SOLID_EXTRA，再排除两枚「初值 true/
 *  生成·装载收尾后恒 false」：
 *  · 484 滚球仙人掌（Main.cs:7603 初值 true → DesertBiome cs:12537 起恒 false 到结束）；
 *  · 659 以太块（Main.cs:9767 初值 true → 生成/装载收尾 WorldGen.cs:11512 恒 false）。
 *  本仓 TILE_DEFS.solid 钉【初值】口径（192/481-483 同族先例,数据不可改），运行时
 *  语义消费面——普通块四邻依附门（Player.cs:41571-41579 `Main.tileSolid[邻.type]`）
 *  与致动器缩入门（Wiring.cs:3214）——须经本包装，勿裸读 def.solid（碰撞 LUT 漏
 *  九类=误拒）亦勿裸读 vanGenSolidType（生成期覆写表在运行期为空,484/659 会漏排除）。 */
export function vanRuntimeTileSolid(t: number): boolean {
  const sh = SHEET_OF_TYPE[t] ?? -1;
  if (VAN_TILE_SOLID_EXTRA.has(sh)) return true;
  // ★R30-P1（红蓝定谳,2026-11-02）:484/659 排除撤销——旧注「生成·装载收尾恒
  //   false」系**读漏 finally-restore**:GenerateWorld finally → RestoreTemporary
  //   StateChanges（WorldGen.cs:11119 → :22710-22715 Array.Copy(tileSolidBackup)）,
  //   而 tileSolidBackup=Reset() 入口快照（:11140）——Reset 自己的 tileSolid[659]
  //   =false（:11512）与 DesertBiome 的 [484]=false 都写在快照【后】,生成结束
  //   全被还原抹掉 ⇒ 运行时 484=659=true（Main.cs:7603/:9767 初值即终值）。
  //   NotReallySolid={387,388,10} 不含两者=原版可致动/算四邻实心。旧排除曾致:
  //   致动器拒 484/659 + 以太块上放方块被拒（净回归）。
  return !!TILE_DEFS[t]?.solid;
}
export function vanGenSolidType(t: number): boolean {
  if (VAN_TILE_SOLID_EXTRA.has(SHEET_OF_TYPE[t] ?? -1)) return true;
  return genSolidType(t);
}

/** WorldGen.SolidOrSlopedTile（cs:70515-70547）1:1：active && 生成期 tileSolid &&
 *  !tileSolidTop && !inActive——名为 OrSloped 实不查坡/半砖;tileSolidTop 族
 *  （平台 19/239/380/427/435-439=VAN_TILE_SOLID_EXTRA 全集）不计实心。
 *  ★R12-4 消费方：肉后回填泛洪 IsNotSolid 修饰符（Modifiers.cs:563-571）。 */
export function vanSolidOrSloped(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  if (!st.flags[i]) return false;
  if ((st.wire[i] >>> 5) & 1) return false;                       // inActive
  const sh = SHEET_OF_TYPE[st.type[i]] ?? -1;
  if (VAN_TILE_SOLID_EXTRA.has(sh)) return false;                 // tileSolidTop
  return vanGenSolidType(st.type[i]);
}

/** 生成期实心查询（供消费端替代裸 `TILE_DEFS[t]?.solid`）：
 *  active && 生成期 tileSolid。half/slope/platform 等衍生语义由调用方自行叠加
 *  （各 pass 的 SolidTile 近似口径不一,不在此处收敛）。 */
export function isGenSolid(st: TileStore, x: number, y: number): boolean {
  if (!st.inBounds(x, y)) return false;
  const i = st.idx(x, y);
  if (!st.flags[i]) return false;
  return genSolidType(st.type[i]);
}
