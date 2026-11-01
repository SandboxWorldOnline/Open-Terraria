/** 音乐盒 style → 物品 vid 全表（WorldGen.cs:43138-43366 GetItemDrop_MusicBoxes 1:1；
 *  与 Item.cs SetDefaults DefaultToMusicBox(placeStyle) 调用点互为逆表）。
 *  style 0-12 → 562+style；13-27 → 1596+style-13；28 起为离散表；越界兜底 576（空盒）。
 *  ★2026-09-03 自 wiring/devices.ts 抽出为叶子数据模块：items.ts 顶层音乐盒循环
 *  读本表,而 devices.ts 的 import 子树回流 items.ts（tiles/Wiring 链）——devices
 *  先于 items 初始化时（Main boot DFS 顺序）items 顶层面读本绑定即 TDZ 炸 boot
 *  （动态 import 抢跑/冷启动序均实测可触发）。纯数据无依赖,叶子化断
 *  items→devices 边,循环序地雷拔除（两消费方:devices 侧 re-export 兼容）。 */
export const MUSIC_BOX_ITEM_BY_STYLE: readonly number[] = [
  562, 563, 564, 565, 566, 567, 568, 569, 570, 571,
  572, 573, 574, 1596, 1597, 1598, 1599, 1600, 1601, 1602,
  1603, 1604, 1605, 1606, 1607, 1608, 1609, 1610, 1963, 1964,
  1965, 2742, 3044, 3235, 3236, 3237, 3370, 3371, 3796, 3869,
  4082, 4078, 4079, 4077, 4080, 4081, 4237, 4356, 4357, 4358,
  4421, 4606, 4979, 4985, 4990, 4991, 4992, 5006, 5014, 5015,
  5016, 5017, 5018, 5019, 5020, 5021, 5022, 5023, 5024, 5025,
  5026, 5027, 5028, 5029, 5030, 5031, 5032, 5033, 5034, 5035,
  5036, 5037, 5038, 5039, 5040, 5044, 5112, 5362, 5578, 5538,
  5579, 5580, 5539, 5581, 5582, 5637, 5638, 5639, 6144, 6145,
  6146,
];

/** ★G36-A D1（BJ740 登记债清偿,2026-10-31）：vid → style 逆表（ApplyMusicBox
 *  Player.cs:16111-16360 的 item.type → musicBox 映射与 MUSIC_BOX_ITEM_BY_STYLE
 *  互逆——表序即 style 号,0-100;576 空盒不在表=不播曲）。消费 = Game 音乐 tick
 *  佩戴扫描（时装配饰槽 13-19,SceneMetrics.AddPlayerEffects :771 玩家值覆盖
 *  地块扫描值）。 */
export const MUSIC_BOX_STYLE_BY_VID: ReadonlyMap<number, number> = new Map(
  MUSIC_BOX_ITEM_BY_STYLE.map((vid, style) => [vid, style] as const),
);
