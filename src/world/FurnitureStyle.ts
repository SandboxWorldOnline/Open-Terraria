// 家具样式帧布局权威表(TileObjectData StyleHorizontal/WrapLimit + Tiles_N.png 行带/尺寸双重实证)。
// 返回样式基偏移 [bx, by];物件格内偏移仍按 dx*18/dy*18 叠加。
// 布局来源:
//  42 灯笼:样式竖排 Y 步36;亮灭档 X 0/18(TileLightScanner case 42 实证)
//  33/49 蜡烛/水蜡烛:样式竖排 Y 步22(33 表 36×1412 实测)
//  34 吊灯:样式 Y 行54、wrap37 换列 X+108;亮灭块内 X +54(214×2000 实测)
//  100 烛台:样式竖排 Y 步72(skip2;142×2016 实测);亮灭 X(Wiring :1381)
//  93 灯族:样式竖排 Y 步54、wrap37 换列 X+36(渲染端折算,见 VanillaTiler);亮灭 X 0/18
//  91 旗帜:样式横排 X 步18、wrap111 换行 Y+54(WorldGen.cs:46176 `frameX/18 + 行*111`
//  与 cs:46273-46278 PlaceBanner `fx=style*18, s>=111 → fx-=1998/fy+=54`;12345 金标
//  岛屋 banner style7/9 = f126/f162 实锤。曾误写步54/wrap37(1998/54=37 误读),style7
//  →f378 贴错旗帜)
//  240 墙饰 3×3:横排 X 步54、wrap36 换行(1944×162)
//  241 骨饰 4×3:竖排 Y 步54
//  242 画 6×4:竖排 Y 行72、wrap27 换列 X+108(324×1944)
//  245 画 2×3:横排 X 步36(1152×54)
//  246 画 3×2:竖排 Y 步36(54×1332)
//  其余(桌14/工作台18/钢琴87/雕像105 等 TileObjectData 显式 H):横排 X 步 fw*18
export function furnitureStyleBase(sheet: number, style: number, fw: number): [number, number] {
  switch (sheet) {
    // 19 平台 / 380 花盆箱（WorldGen.PlaceTile case 19/380：`tile.frameY = 18*style`——
    // 材质行在 frameY；frameX 留给 TileFrameImportant 写连接形态，放置时置 0）。
    // 曾落 default（材质误进 frameX）→ 非 0 材质平台贴图错位。Tiles_19 486×1260
    // （27 连接列×70 材质行）实证
    case 19: case 380: return [0, style * 18];
    case 42: return [0, style * 36];
    case 33: case 49: return [0, style * 22];
    case 34: return [Math.floor(style / 37) * 108, (style % 37) * 54];
    // 100 烛台 / 172 水槽（Place2x2 cs:51436-51446 `frameX=k*18, frameY=style*num+l*18`,
    // num=36（172=38）——样式竖排。曾写 100→style*72「skip2 实测」：实为素材空带误读
    // （Tiles_100 2016px=56 带×36,行隙实测 394/610/646/826… 全在 36 带界 −2px）,
    // style≥1 放置帧错带→光照表(TileLightScanner case 100 fy/36)与掉落表
    // （vanillaStyleDrops styleFromFrame[100]=fy/36）全错位;172 同支（38 带宽,
    // 2014=53×38 精确）。掉落侧反函数=vanillaStyleDrops.styleFromFrame
    case 100: return [0, style * 36];
    case 172: return [0, style * 38];
    // 93 灯族（★R12 备案定谳=属实,2026-08-23 修）：原版 1×3 非 1×6——
    //  TileObjectData.cs:2394-2419 Style1xX（Width=1/Height=3/CoordinateHeights{16,16,16},
    //  92 路灯柱才 CopyFrom 后 Height=6）+ Place1xX（WorldGen.cs:39203-39226,num2=3,
    //  `frameY = j*18 + style*54`）+ Wiring.ToggleLamp（Wiring.cs:2954-2975,
    //  SendTileSquare(1,3)+fy 行折 3）。style 带=54：Check1xX（:37802-37819,num=3,
    //  `while(fy>=54) fy-=54` = fy/54）= TileLightScanner case 93 = TileFlames
    //  （:3242-3363 style=frameY/54）= TileDrawing.cs:6518-6520（`num65=frameY/54`）。
    //  存储帧=原版【未折】raw（style*54 可越 2048 表底）——渲染端按 TileDrawing
    //  `num70=frameY/1998 → addFrY-=1998*n / addFrX+=36*n` 折列（VanillaTiler 同式）,
    //  故此处【不】预折（预折进 frameX 会破坏亮灭 X 0/18 门=光照/电线翻转全错）。
    //  掉落侧反函数=vanillaStyleDrops.styleFromFrame[93]=fy/54（GetItemDrop_Lamps :41087）
    case 93: return [0, style * 54];
    case 91: return [(style % 111) * 18, Math.floor(style / 111) * 54];
    case 240: return [(style % 36) * 54, Math.floor(style / 36) * 54];
    case 241: return [0, style * 54];
    case 242: return [Math.floor(style / 27) * 108, (style % 27) * 72];
    case 245: return [style * 36, 0];
    case 246: return [0, style * 36];
    // ★BJ602（2026-10-10）：693/694 洞穴钟乳石 Echo（TileObjectData.cs:4406-4426/:4231-4241
    //  StyleHorizontal=true + StyleWrapLimit=39）——横排 X 步 18（FullWidth=16+2）,
    //  style≥39 折行：frameY = floor(style/39) × FullHeight（StyleLineSkip 缺省 1,
    //  TileObjectStyleModule.cs:29;TileObject.Place :66-75 num4%=wrap/num5=÷wrap×skip）。
    //  FullHeight：693=18（Style1x1 heights{16}+pad2）/694=36（Style1x2 {16,16}+pad2×2）
    //  ——行带恰=CheckStalactiteEcho（WorldGen.cs:39267,派发 :86536-86539）的吊顶/坐地
    //  分界（693 fy<18 吊顶 / 694 fy<36 吊顶,否则坐地）:基样式 0-38=吊顶带（anchorTop）,
    //  子样式 39-77（addSubTileRange :4416/:4240,anchorBottom 坐地）折入第二行带。
    //  MiteyTitey wand（FlexibleTileWand.cs:327-355 AddVariationsWithOffset offset=39）
    //  注入 style≥42 后 default X 向（style*18 不折行）=帧写越带错档+级联判带错杀。
    case 693: return [(style % 39) * 18, Math.floor(style / 39) * 18];
    case 694: return [(style % 39) * 18, Math.floor(style / 39) * 36];
    // 216 烟花火箭 / 572 瓶装魂（S2/D-7 接档 2026-08-23,竖排 1×2 族）：原版
    // Place1x2（cs:47055 `frameY=style*40`,216 CoordinateHeights{16,20}）/
    // Place1x2Top（cs:47084 `frameY=style*36`）——曾落 default X 向（style*18）
    // → 放置帧错带（渲染错档）+ 掉落反推（Check1x2 :43744 fy/40、Check1x2Top
    // :47114 fy/36）恒落 style0（绿/蓝/黄火箭全掉红火箭、瓶装魂全掉光魂）
    case 216: return [0, style * 40];
    case 572: return [0, style * 36];
    // 187 Decos3x2 Group2：Place3x2 原文 `frameX = 54*style`（cs:52185）**无 wrap**
    // ——Tiles_187.png 实宽 1890（35 组），style≥35（活树叶下 47-49/叶顶 50-51,
    // cs:28695/28696）帧写到表宽外。★QQQQQ 定谳：vanilla 金标真值就是越界帧
    // （s22222 织入探针 (1444..1446,227) fx=2646=fy0/18=style49；9293480
    // /tmp/tttt-fr/063.fr 113 格 fx∈[2646,2790] 同证）——渲染按 canvas 越界源矩形
    // 静默（vanilla XNA 夹边采样=边缘杂色，同为"非正常贴图"）。曾按贴图 35 列
    // wrap → style49 写 (756,36) → 恰落入 Check3x2 草地变体转化带 [756,900]
    // （cs:49383）→ SpreadingGrass 级联误转化 187→186（s22222 #73 T187>186×6）。
    case 187: return [style * 54, 0];
    // 15 椅子（TileObjectData :4132-4164 Style1x2、StyleHorizontal=false、
    //  StyleWrapLimit=2、StyleMultiplier=2、PaddingFix(0,2)）：FullHeight=(16+2)+(18+2)+2
    //  =40——style 竖排 Y 步 40（Tiles_15 72×2038 行带 0/40/80…实测；曾误写 38
    //  漏 PaddingFix.Y，每样式偏 2px）；朝向档在 X 0/18（flip +18）。
    //  497 马桶同构（:4167-4184 同参数组；TileDrawing.cs:6344-6350 `tileFrameY/40` 行带）
    case 15: return [0, style * 40];
    case 497: return [0, style * 40];
    // 79 床 / 90 浴缸（Style4x2 同椅子模式：WrapLimit=2、Multiplier=2、H=false）：
    // style 竖排 Y 步 36，朝向档在 X 0/72
    case 79: case 90: return [0, style * 36];
    // 139 八音盒（Item.cs DefaultToMusicBox placeStyle + SceneMetrics.cs:474 读
    //  frameY/36 = 曲目 style）：StyleHorizontal=false 竖排 Y 步 36；开关档 X 0/36
    // （Wiring SwitchMB :50977）。此前走 default X 向 → 唱片全放成曲目 0
    case 139: return [0, style * 36];
    // ★R21 备案修订：default X 向对【竖排/特殊布局】族的盲区清单——已补专属 case 的
    // 有 423 感应器 / 10 门；仍走 default 但布局不符的仅剩 388/389 高门与 617 遗物座
    // （TileObjectData 均 StyleHorizontal=false 竖排，现行物品无 placeStyle>0 实例，
    // 一旦引入多变体须按表补竖排 case，参考 15/79/139 写法）。
    // —— R21 实证 default 盲区并非"仅 388/389/617"：门(10)已有 placeStyle>0 物品流入
    // （石门 vi_4415 style44 等 32 件），感应器 423 与晶塔族 placeStyle 全缺也曾同根。
    // 423 逻辑感应器（PlaceLogicTiles WorldGen.cs:45718-45721 else 支 `frameX=0;
    //  frameY=18*style`——样式档在 Y 轴：0昼/1夜/2玩家上方/3水/4岩浆/5蜂蜜/6任意液；
    //  frameX 留给 TELogicSensor.GetFrame 写 On 态 0/18。曾落 default 写 frameX=style*18
    //  → 自放七件全退化昼档、打掉反推 fy/18 恒返 3613）
    case 423: return [0, style * 18];
    // ★IIIII234（2026-09-09）：逻辑件族余量补齐——PlaceLogicTiles（WorldGen.cs:
    //  45705-45728）else 支对 420/423/424/429/445 一律 `frameX=0; frameY=18*style`：
    //  420 逻辑门：样式档（0=AND/1=OR/2=NAND/3=NOR/4=XOR/5=XNOR,ItemID.cs:8752-8762
    //  placeStyle=type-3603）在 Y 轴,frameX 留给 CheckLogicGate 写输出态 0/18/36
    //  （Wiring.cs:631-653）——曾落 default 写 frameX=style*18 → OR 门(style1)
    //  放出来 frameX=18 =「AND 门已 ON」：渲染错档+真值表全错。
    //  424 分线盒：样式=材质（铜0,placeStyle 仅 0 物品在库）在 Y 轴,frameX=方向档
    //  0/18/36（Wiring.cs:751-768 hitWire 读 frameX/18）——同轴向修正。
    //  429 线缆灯泡：状态位在 frameX（bit 域 per 线色,Wiring.cs case 429 读
    //  frameX/18 的 %2/%4/%8/%16）,style 仅 0 → Y 轴占位与原版同构。
    //  445 像素盒：触发态 frameX 0/18（PixelBoxPass Wiring.cs:531-553）,style 仅 0。
    //  419 灯 = default 即原版（`frameX=style*18; frameY=0`,state 轴恰在 X）。
    case 420: case 424: case 429: case 445: return [0, style * 18];
    // ★BJ753 TF-08（2026-11-02,issue#39）：135 压板 / 428 测重板 = Style1x1 系
    //  【纵向样式】族——TileObjectData.cs:4382-4389 CopyFrom(Style1x1) 后仅覆
    //  CoordinateHeights{18}+Padding 0+yOff2,无 StyleHorizontal 覆写（ctor 缺省
    //  false,TileObjectData.cs:1786）→ TileObject.Place :70-75 竖排
    //  frameY=FullHeight(18)*num、frameX 恒 0。颜色档在 Y：掉落反推 KillTile
    //  case 135/428 读 frameY/18（WorldGen.cs:66089-66090/:65827-65828）同域。曾落 default
    //  X 向（style*18）→ 绿压板 541 放成 (18,0)、粉测重板 3626 放成 (54,0),
    //  挖回全默认色（掉落侧一直读 Y=style0,读写域错置）。
    case 135: case 428: return [0, style * 18];
    // 10 关门（PlaceDoor WorldGen.cs:32070-32090：frameX=54*(style/36)+变体*18、
    //  frameY=54*(style%36)+行*18——每 36 样式换一列，列内 54px 块三档变体。
    //  曾落 default 写 style*18 → 石门(style44)/活木·骨·血肉门等 style>0 全渲染错区+
    //  doorStyleOf 反推错乱污染开关门链。开门 tile11 无放置物品不经此路径）
    case 10: return [54 * Math.floor(style / 36), 54 * (style % 36)];
    // ★SW-FX3（2026-09-09）：雕像 105 行带（TileObjectData.cs:3012-3015 CopyFrom(Style2xX)
    //  + StyleWrapLimit=55——Style2xX=2 宽×3 高、CoordinateWidth 16/Pad 2 ⇒ 全宽
    //  36/全高 54（:2866-2873），55 样式/行换行。Tiles_105 1980×272=55×36 实证同构）。
    //  掉落反推 Check2xX（WorldGen.cs:38542-38545）`fx/36 + (fy/54%3)*55`——
    //  曾落 default X 向（style*36 无换行）→ style≥55（SW-FX3 补档的活木雕像 55-62、
    //  63-75 等 13 件）帧写到第 55 带外=渲染错档+掉落反推 (fy/54%3)*55 恒 0 错档。
    case 105: return [(style % 55) * 36, Math.floor(style / 55) * 54];
    // ★BJ600（2026-10-10）：567 花园侏儒 frameX 步=CoordinateWidth 26+Padding 2=28
    //  （TileObjectData.cs:4222-4227 addTile(567) Style1x2 横排;行帧 0/20 由
    //  framedCellFrame PLACE_ROW_FY[567] 承担）。此前 default 步 18——placeStyle
    //  恒 0 时两端同值无感;BJ600 wand style 注入（Game.tryPlace 回落通用链）后
    //  style∈0-4,18 步=帧写错带（渲染错姿+与 .wld 原生 28 步不一致,CheckGnome
    //  :54416 `frameX/28` 同域佐证）。
    case 567: return [style * 28, 0];
    // ★BJ754 TF-09（2026-11-02,issue#39）：珊瑚 81 / 海贝 324 = FlexibleTileWand 单件
    //  族的【非 18px 步长】帧带——81 = CoordinateWidth 24+pad2 ⇒ FullWidth 26 横排
    //  无 wrap（TileObjectData.cs:4374-4383 heights{26}/width24/StyleHorizontal,
    //  StyleWrapLimit 缺省 0）→ fx=26*style；324 = width20+pad2 ⇒ FullWidth/FullHeight
    //  各 22、StyleWrapLimit=3（:4431-4440）→ 3 列折行：fx=(style%3)*22、
    //  fy=floor(style/3)*22（海星 3-5 落 fy=22 行、螺壳 6-14 落 44/66/88 行）。
    //  生成侧 StructuresPass placeCoral/placeShells 同步 26/22 步（:1918/:1929）
    //  ——运行时 wand 路径曾走 default 18 步（fx=style*18）：珊瑚三帧 0/18/36 应
    //  0/26/52；海星 2626 写 (54,0) 挖回贝壳 2625（掉落侧 KillTile case 324 按行
    //  frameY/22 反推,见 vanillaStyleDrops.styleFromFrame[324] 同批）。
    case 81: return [style * 26, 0];
    case 324: return [(style % 3) * 22, Math.floor(style / 3) * 22];
    default: return [style * fw * 18, 0];
  }
}

/**
 * 多格 framed 物件【单格】帧（= Game.tryPlace vanilla-style 分支与放置测试共用）：
 *  样式基偏移（furnitureStyleBase）+ 格内 18px 列/行步长；旗帜 91 例外走
 *  SceneMetrics 逆写（tryPlace 原内联逻辑逐字提取，行为不变）。
 *  原版帧语义（TileObject.Place L74-102）：frameY 从顶行 0 向下递增，
 *  dx/dy 为物件内偏移（dx=0,dy=0 即顶行锚格）
 */
/** ★M-2（2026-09-02）：非 18px 行步进族——原版 TileObject.Place 写帧行步进 =
 *  num9 += CoordinateHeights[l] + CoordinatePadding（TileObject.cs:96-108）,绝大多数
 *  族 heights 全 18 时恰为 18px。例外按反编译 heights 表累进：
 *  · 388/389 高门 heights{18,16,16,16,18}+pad2（TileObjectData.cs:2301-2303,
 *    addTile(388) :2323/389=FullCopyFrom :2324-2325）→ 行帧 0/20/38/56/74
 *    （Tiles_388.png 内容带 0-17/20-35/38-53/56-71/74-91 实证同构）。
 *  · 567 花园侏儒 heights{18,18}+pad2（TileObjectData.cs:4222-4224 addTile :4227）
 *    → 行帧 0/20（CheckGnome :54419 `frameY==0 && frameY2==20` 完整性亦按 20 步）。
 *  列向 388/389 无横排 style（frameX 恒 0）;567 frameX 步原版=CoordinateWidth 26+2=28
 *  （:4223）——本仓 placeStyle 恒 0（frameX=0 两端同值）,备案不改。
 */
const PLACE_ROW_FY: Record<number, readonly number[]> = {
  388: [0, 20, 38, 56, 74],
  389: [0, 20, 38, 56, 74],
  567: [0, 20],
};
export function framedCellFrame(sheet: number, fw: number, style: number, dx: number, dy: number): [number, number] {
  if (sheet === 91) {
    // ★bannerStyleDomain（⑤巡检，2026-09-03 十三批）：style 入参 = tile 91 帧列
    //  【style 域】直值（类级 placeStyle=原版 Item.placeStyle 直域 Item.cs:19231 等；
    //  kill-drop 实例位的旗种 id 域已在 Game 放置点经 Banners.bannerStyleOf 逆写
    //  +21/跳 311/312）——此处只做 111 列/带换行（= furnitureStyleBase case 91 同式，
    //  与 SceneMetrics.cs:419-441 解码、wld 导入帧、BANNERS 掉落表同域）。
    //  旧实现在此无条件 +21：装饰旗 337-340/789-791/845-847/1451-1469（类级
    //  placeStyle 0-16=style 直域）与破坏回收旗再放置全部被抬高 21 列=错帧+错掉落。
    return [(style % 111) * 18, Math.floor(style / 111) * 54 + dy * 18];
  }
  // ★BJ754 TF-11（2026-11-02,issue#39）：圣诞树 171 = HookPlaceOverride 专案
  //  （TileObjectData.cs:2167 PlaceXmasTree_Direct,processedCoordinates:true——
  //  Place :36-53 走 override 不落通用帧带）——锚点格 (10,0)（哨兵）,其余格写
  //  列/行【裸索引】(dx,dy)（WorldGen.cs:39928-39946）。旧走通用 18px 帧（dx*18）
  //  与幸存面 CheckXmasTree 的裸索引回推（:40006-40010 frameX<10 → x-fx/y-fy）
  //  写读域错置：第二列/行格被判坏件 → 放下即碎（0/32 格+掉回 1873）。style
  //  参数原版忽略（Direct 无 style 消费）,放置后帧与 .wld 导入（copyFrame）同域；
  //  xmasCell 双编码兼容保留（legacy 18px 存档帧解码）。
  if (sheet === 171) {
    return dx === 0 && dy === 0 ? [10, 0] : [dx, dy];
  }
  const [bx, by] = furnitureStyleBase(sheet, style, fw);
  const rows = PLACE_ROW_FY[sheet];
  return [bx + dx * 18, by + (rows ? rows[dy] ?? dy * 18 : dy * 18)];
}
