// 放置物 style→物品掉落还原（审计 docs/audit/item-audit-2026-08-22.md 补 A ⚠️2/⚠️3 批）：
//   ⚠️2 多格 15 族 + 已覆盖同病 3 族 + 1×1 版 6 族——挖掉按帧掉 GetItemDrop_* 真物品
//      （原 R10 place_v_/style0 恒档）；数据层=src/data/vanillaStyleDrops.ts（1456
//      WorldGen.cs GetItemDrop_* 23 函数逐 case 机械转录）
//   ⚠️3 杂项：巨石族失撑→滚石弹（TileFrame no-op break 组 :86409-86428 闭合后
//      goto case 132 :86670 → Check2x2 :86688 派发,⚠️5 勘误:前注 :86672 系 goto 落点行）/
//      座钟授时（SceneMetrics.HasClock
//      → accWatch=3,Player.cs:12593）/瀑布族 8 帧动画（Main.cs:18743-18793）/陶罐顶部
//      杂草 + 南瓜株成长（UpdateWorld :72376-72390）
import { describe, expect, it, vi } from 'vitest';
import { RNG } from '../src/core/rng';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { RollingBoulder } from '../src/entities/RollingBoulder';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { styleDropVid, styleDropVidOfFrames, styleFromFrame, holidayLightVid, pileDecoDropVid, gemLockKeyVid } from '../src/data/vanillaStyleDrops';
import { framedCellFrame, furnitureStyleBase } from '../src/world/FurnitureStyle';
import { VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { ITEM_BY_KEY } from '../src/data/items';
import { scanScene, EMPTY_SCENE } from '../src/world/SceneMetrics';
import { TILE_ANIM_RATE, animFrameIdx, animYOffset, tileAnim } from '../src/render/TileAnim';
import { TrapShot } from '../src/entities/Dart';
import { formatWatchText } from '../src/stats/InfoAccs';
import { WorldEvolution } from '../src/world/evolution/WorldEvolution';

const keyOf = (k: string) => TILE_BY_KEY[k]!;
const idOfSheet = (s: number) => {
  const id = TILE_DEFS.findIndex((d) => d?.vanilla?.sheet === s);
  expect(id, `sheet ${s} 应有 def`).toBeGreaterThan(0);
  return id;
};

// ============ A. 数据层：GetItemDrop_* 逐族两档对拍（1456 行号见表注释） ============
describe('styleDropVid 逐族两档（⚠️2 15 族 + 同病 3 族 + 1×1 版）', () => {
  it('桌 14（GetItemDrop_Tables :42131）：0→32 木 / 1→638 乌木；469 二类 :49445 0→3920', () => {
    expect(styleDropVid(14, 0)).toBe(32);
    expect(styleDropVid(14, 1)).toBe(638);
    expect(styleDropVid(14, 4)).toBe(827);
    expect(styleDropVid(469, 0)).toBe(3920);
    expect(styleDropVid(469, 1)).toBe(3948);
  });

  it('椅 15（GetItemDrop_Chair :42677）0→34 / 1→358 马桶；马桶 497（:42815）0→4096 / 1→4097', () => {
    expect(styleDropVid(15, 0)).toBe(34);
    expect(styleDropVid(15, 1)).toBe(358);
    expect(styleDropVid(497, 0)).toBe(4096);
    expect(styleDropVid(497, 1)).toBe(4097);
  });

  it('烛 33（GetItemDrop_Candles :39766）0→105 铜 / 1→1405 地牢蓝 / 4→2045 珊瑚', () => {
    expect(styleDropVid(33, 0)).toBe(105);
    expect(styleDropVid(33, 1)).toBe(1405);
    expect(styleDropVid(33, 4)).toBe(2045);
  });

  it('吊灯 34（GetItemDrop_Chandeliers :40676）0→106 铜 / 2→108 银；wrap37：style37→3894', () => {
    expect(styleDropVid(34, 0)).toBe(106);
    expect(styleDropVid(34, 2)).toBe(108);
    expect(styleDropVid(34, 37)).toBe(3894);   // 第二 X 列首档（fx/108*37+fy/54）
  });

  it('灯笼 42（GetItemDrop_Lanterns :40873）0→136 链灯 / 1→1390 黄铜', () => {
    expect(styleDropVid(42, 0)).toBe(136);
    expect(styleDropVid(42, 1)).toBe(1390);
  });

  it('钢琴 87（:41298）0→333 / 1→641；梳妆台 88（:49870）0→334 / 1→647', () => {
    expect(styleDropVid(87, 0)).toBe(333);
    expect(styleDropVid(87, 1)).toBe(641);
    expect(styleDropVid(88, 0)).toBe(334);
    expect(styleDropVid(88, 1)).toBe(647);
  });

  it('凳沙发 89（:40211）0→335 / 1→2397；浴缸 90（:42322）0→336 / 1→2073', () => {
    expect(styleDropVid(89, 0)).toBe(335);
    expect(styleDropVid(89, 1)).toBe(2397);
    expect(styleDropVid(90, 0)).toBe(336);
    expect(styleDropVid(90, 1)).toBe(2072);
  });

  it('汤锅 96（Check2x2Style :52430）0→345 / 1→1791 魔锅；烛台 100（:40296）0→349 / 1→2093', () => {
    expect(styleDropVid(96, 0)).toBe(345);
    expect(styleDropVid(96, 1)).toBe(1791);
    expect(styleDropVid(100, 0)).toBe(349);
    expect(styleDropVid(100, 1)).toBe(2092);
  });

  it('书架 101（:40476）0→354 / 1→1414；座钟 104（:40131）0→359 / 1→2237', () => {
    expect(styleDropVid(101, 0)).toBe(354);
    expect(styleDropVid(101, 1)).toBe(1414);
    expect(styleDropVid(104, 0)).toBe(359);
    expect(styleDropVid(104, 1)).toBe(2237);
  });

  it('床 79（GetItemDrop_Beds :39947）0→224 / 1→644 乌木 / 4→920', () => {
    expect(styleDropVid(79, 0)).toBe(224);
    expect(styleDropVid(79, 1)).toBe(644);
    expect(styleDropVid(79, 4)).toBe(920);
  });

  it('墓碑 85（CheckSign :43737-43744）0→321 / 1→1173 / 6→3229', () => {
    expect(styleDropVid(85, 0)).toBe(321);
    expect(styleDropVid(85, 1)).toBe(1173);
    expect(styleDropVid(85, 6)).toBe(3229);
    expect(styleDropVid(85, 10)).toBe(3233);
  });

  it('宝箱 21（GetItemDrop_Chests :41596）0→48 / 1→306 金；二类箱 467 secondType 0→3884 / 1→3885', () => {
    expect(styleDropVid(21, 0)).toBe(48);
    expect(styleDropVid(21, 1)).toBe(306);
    expect(styleDropVid(467, 0)).toBe(3884);
    expect(styleDropVid(467, 1)).toBe(3885);
  });

  it('同病已覆盖族：工作台 18（:42489）0→36 / 1→635；平台 19（:42927）0→94 / 1→631；野餐桌 487（:40287）0→4064', () => {
    expect(styleDropVid(18, 0)).toBe(36);
    expect(styleDropVid(18, 1)).toBe(635);
    expect(styleDropVid(19, 0)).toBe(94);
    expect(styleDropVid(19, 1)).toBe(631);
    expect(styleDropVid(487, 0)).toBe(4064);
    expect(styleDropVid(487, 1)).toBe(4065);
  });

  it('1×1 版：瓶 13（:41265）0→31 / 3→350 粉瓶；矿石条 239（KillTile :65166）0→20 铁 / 1→703 铅 / 22→3467', () => {
    expect(styleDropVid(13, 0)).toBe(31);
    expect(styleDropVid(13, 3)).toBe(350);
    expect(styleDropVid(239, 0)).toBe(20);
    expect(styleDropVid(239, 1)).toBe(703);
    expect(styleDropVid(239, 22)).toBe(3467);
  });

  it('钱币堆 330-333（:64197-64204）→币 71-74；骨块 194（:64652）→154；节日灯 149（:65571）三色', () => {
    expect(styleDropVid(330, 0)).toBe(71);
    expect(styleDropVid(331, 0)).toBe(72);
    expect(styleDropVid(332, 0)).toBe(73);
    expect(styleDropVid(333, 0)).toBe(74);
    expect(styleDropVid(194, 0)).toBe(154);
    expect(holidayLightVid(0)).toBe(596);
    expect(holidayLightVid(18)).toBe(597);
    expect(holidayLightVid(36)).toBe(598);   // ★红蓝-J2 补口（2026-09-18）红灯正向带
    expect(holidayLightVid(54)).toBe(596);   // 反向带同色（fx%54）
    expect(holidayLightVid(72)).toBe(597);
    expect(holidayLightVid(90)).toBe(598);   // ★红灯反向带——六档直锁补齐
    expect(holidayLightVid(9)).toBe(0);      // 域外帧不掉（KillTile case 149 cs:66036-46 dropItem 保 0）
  });

  it('门 10/11（GetDoorItem :69257）0→25 木 / 1→650 乌木 / 11 神庙锁门→0 不掉', () => {
    expect(styleDropVidOfFrames(10, 0, 0)).toBe(25);
    expect(styleDropVidOfFrames(10, 0, 54)).toBe(650);
    expect(styleDropVidOfFrames(11, 0, 594)).toBe(0);   // style 11 锁门段无物品
  });

  it('开门 11 开式反推（❌3,CheckDoorOpen :87093-87094 fy/54+fx/72*36）：fx=108→style37→3941;关门式误反推 73→越界回落 25', () => {
    // 开态 fx=72*列+(direction==-1?36:0)：style37（col=1,row=1）朝左开 → fx=72+36=108,
    // fy=54。关门式 fx/54*36+fy/54=2*36+1=73（越界→pick 回落 Doors[0]=25 木门,掉错材质）;
    // 开式 108/72*36+1=37 → Doors[37]=3941
    expect(styleDropVidOfFrames(11, 108, 54)).toBe(3941);
    expect(styleDropVidOfFrames(10, 108, 54)).toBe(25);                 // 旧恒传 10 的错档直证
    // 朝右开（direction=+1）同 style：fx=72（无 +36 档）→ 两式同值 37
    expect(styleDropVidOfFrames(11, 72, 54)).toBe(3941);
    expect(styleDropVidOfFrames(10, 72, 54)).toBe(3941);
    // style1 乌木门开态（col=0,row=1,fx=0/36）两式同值——恒传 10 只在 col≥1 且朝左开时错
    expect(styleDropVidOfFrames(11, 36, 54)).toBe(650);
  });

  it('全表 vid 均有真实物品键（VANILLA_ITEM_KEY_BY_ID 全覆盖,掉落可实例化）', () => {
    const sheets = [13, 14, 15, 18, 19, 21, 33, 34, 42, 79, 85, 87, 88, 89, 90, 96, 100, 101, 104, 172, 194, 239, 330, 331, 332, 333, 467, 469, 487, 497,
      // S2/D-7 批（2026-08-23）：画族 240/241/242/245/246 + 营火 215 + 炮 209 + 烟花 216 +
      // 天塔柱 410 + 宝石锁 440 + 假容器 441/468 + 模特 470 + 盆栽树 547/548 + 瓶装魂 572 +
      // 圣物底座 617 + 仿制祭坛/珠 695/696 + 宝石火花块 255-268
      209, 215, 216, 240, 241, 242, 245, 246, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268,
      410, 440, 441, 468, 470, 547, 548, 572, 617, 695, 696];
    let checked = 0;
    for (const s of sheets) {
      for (let st = 0; st < 110; st++) {   // 240 有 101 档,上界抬到 110 全覆盖
        const v = styleDropVid(s, st);
        if (v <= 0) continue;
        checked++;
        expect(VANILLA_ITEM_KEY_BY_ID[v], `sheet ${s} style ${st} → vid ${v}`).toBeTruthy();
        expect(ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[v]], `vid ${v} 应有 def`).toBeDefined();
      }
    }
    expect(checked).toBeGreaterThan(1250);   // 旧 30 族 + S2/D-7 新增 ~420 档
  });
});

// ============ A2. S2 多 style 家族 + D-7（审计 tile-audit-2026-08-23.md,2026-08-23 批） ============
describe('S2/D-7 多 style 家族（画/营火/炮/烟花/天塔柱/宝石锁/假容器/模特/盆栽树/瓶装魂/圣物/仿制/宝石火花）', () => {
  it('画 3×3 240（Check3x3Wall :44751 style=fx/54+fy/54*36）：0→1360 / 22→1440 / 40→1962 / 76→5218 / 100→5929', () => {
    expect(styleDropVidOfFrames(240, 0, 0)).toBe(1360);
    expect(styleDropVidOfFrames(240, 54, 54)).toBe(1856);     // style37=col1+row1*36（显式 case 37）
    expect(styleDropVid(240, 22)).toBe(1440);
    expect(styleDropVid(240, 40)).toBe(1962);
    expect(styleDropVid(240, 76)).toBe(5218);
    expect(styleDropVid(240, 100)).toBe(5929);
  });

  it('画 241 恒掉 1417（Check4x3Wall :45335 无 style 档）/ 画 6×4 242（:45399 27*(fx/108)+fy/72）', () => {
    expect(styleDropVidOfFrames(241, 108, 0)).toBe(1417);
    expect(styleDropVidOfFrames(241, 0, 54)).toBe(1417);
    expect(styleDropVidOfFrames(242, 0, 0)).toBe(1421);
    expect(styleDropVidOfFrames(242, 108, 72)).toBe(2866);   // style28=27*1+1（2865+s-27 档）
    expect(styleDropVid(242, 74)).toBe(5636);
  });

  it('画 2×3 245（fx/36）/ 画 3×2 246（fy/36）：15-18 同掉 5247 / 21-36→5258+', () => {
    expect(styleDropVidOfFrames(245, 72, 0)).toBe(1476);      // style2
    expect(styleDropVid(245, 16)).toBe(5247);                 // 15-18 四档同值
    expect(styleDropVid(245, 31)).toBe(5634);
    expect(styleDropVidOfFrames(246, 0, 72)).toBe(1481);      // style2
    expect(styleDropVid(246, 36)).toBe(5273);
  });

  it('营火 215（GetCampfireItemDrop :50481,KillTile :64497 fx/54）：0→966 / 8→4689 / 15→5357', () => {
    expect(styleDropVidOfFrames(215, 0, 0)).toBe(966);
    expect(styleDropVidOfFrames(215, 432, 18)).toBe(4689);    // style8（命中格 fy=18 同件）
    expect(styleDropVid(215, 15)).toBe(5357);
  });

  it('D-7：炮 209（CheckCannon :51296 fx/72）/ 烟花 216（Check1x2 :43845 fy/40）/ 天塔柱 410（:38601 fx/36）', () => {
    expect(styleDropVidOfFrames(209, 0, 0)).toBe(928);
    expect(styleDropVidOfFrames(209, 216, 18)).toBe(3664);    // style3（4 宽,命中右列 fx=216+18 同档）
    expect(styleDropVidOfFrames(209, 72, 0)).toBe(1337);
    expect(styleDropVidOfFrames(216, 0, 80)).toBe(972);       // style2 蓝火箭
    expect(styleDropVidOfFrames(216, 0, 120)).toBe(973);
    expect(styleDropVidOfFrames(410, 108, 0)).toBe(3539);     // style3
  });

  it('D-7：宝石锁 440 锁体（Check3x3Wall :44917 fx/54）+ 伴生钥匙（gemLockKeyVid fy/54==1 行）', () => {
    expect(styleDropVidOfFrames(440, 0, 0)).toBe(3644);
    expect(styleDropVidOfFrames(440, 324, 0)).toBe(3650);
    expect(gemLockKeyVid(0, 54)).toBe(1526);
    expect(gemLockKeyVid(216, 54)).toBe(1522);                // style4→1522（:44927 case4）
    expect(gemLockKeyVid(0, 0)).toBe(0);                      // 无钥匙变体行不掉钥匙
  });

  it('D-7：假容器 441/468（GetItemDrop_FakeChests :42234 fx/36）——0 表档=原版 -1 无掉落（哨兵 -1）', () => {
    expect(styleDropVidOfFrames(441, 0, 0)).toBe(3665);
    expect(styleDropVidOfFrames(441, 144, 18)).toBe(-1);      // style4 无掉落档
    expect(styleDropVidOfFrames(441, 180, 0)).toBe(-1);       // style5 无掉落档
    expect(styleDropVidOfFrames(441, 252, 0)).toBe(3668);     // style7（3668+s-7 档首档）
    expect(styleDropVidOfFrames(468, 0, 0)).toBe(3886);
    expect(styleDropVidOfFrames(468, 144, 0)).toBe(-1);       // style4 无掉落
    expect(styleDropVidOfFrames(468, 36, 0)).toBe(3887);      // style1
    expect(styleDropVidOfFrames(468, 72, 0)).toBe(3950);      // style2
  });

  it('模特 470（TEDisplayDoll.cs:317 fx/72）/ 盆栽树 547（:53806 fx/36）· 548（:53969 fx/54）', () => {
    expect(styleDropVidOfFrames(470, 0, 0)).toBe(498);
    expect(styleDropVidOfFrames(470, 72, 18)).toBe(1989);     // Womannequin（placeStyle2→fx=72）
    expect(styleDropVidOfFrames(547, 144, 0)).toBe(4434);     // style4
    expect(styleDropVidOfFrames(548, 378, 0)).toBe(4902);     // style7（≥7 段 4902+s-7）
    expect(styleDropVidOfFrames(548, 216, 0)).toBe(4439);     // style4
  });

  it('瓶装魂 572（Check1x2Top :47214 fy/36）/ 圣物底座 617（Check3x4 :50594 fx/54,27→5110）', () => {
    expect(styleDropVidOfFrames(572, 0, 108)).toBe(4698);     // style3
    expect(styleDropVidOfFrames(617, 0, 0)).toBe(4924);
    expect(styleDropVidOfFrames(617, 1458, 0)).toBe(5110);    // style27（fx=27*54）
    expect(styleDropVidOfFrames(617, 108, 0)).toBe(4926);     // style2
  });

  it('仿制祭坛 695（Check3x2 :49892 fx/54）/ 仿制暗影珠 696（CheckOrb :54696 fx/36）', () => {
    expect(styleDropVidOfFrames(695, 0, 0)).toBe(5467);
    expect(styleDropVidOfFrames(695, 54, 18)).toBe(5468);
    expect(styleDropVidOfFrames(696, 0, 0)).toBe(5469);
    expect(styleDropVidOfFrames(696, 36, 18)).toBe(5470);
  });

  it('宝石火花块 255-268（KillTile :65433 on/off 两态同掉 1970+gem,1×1 无 style 档）', () => {
    expect(styleDropVidOfFrames(255, 0, 0)).toBe(1970);
    expect(styleDropVidOfFrames(261, 0, 0)).toBe(1976);
    expect(styleDropVidOfFrames(262, 0, 0)).toBe(1970);
    expect(styleDropVidOfFrames(268, 0, 0)).toBe(1976);
  });

  it('放置基 216/572 竖排改对（Place1x2 cs:47055 fy=style*40 / Place1x2Top cs:47084 fy=style*36）roundtrip', () => {
    for (let s = 0; s < 4; s++) {
      const [fx1, fy1] = framedCellFrame(216, 1, s, 0, 1);
      expect(furnitureStyleBase(216, s, 1)).toEqual([0, s * 40]);
      expect(styleFromFrame[216]!(fx1, fy1)).toBe(s);
      const [fx2, fy2] = framedCellFrame(572, 1, s, 0, 1);
      expect(furnitureStyleBase(572, s, 1)).toEqual([0, s * 36]);
      expect(styleFromFrame[572]!(fx2, fy2)).toBe(s);
    }
    // 画族放置基（既有 case）与掉落反推互为反函数
    for (const s of [0, 22, 40, 76, 100]) {
      const [fx, fy] = framedCellFrame(240, 3, s, 1, 2);
      expect(styleFromFrame[240]!(fx, fy)).toBe(s);
    }
    for (const s of [0, 28, 74]) {
      const [fx, fy] = framedCellFrame(242, 6, s, 3, 2);
      expect(styleFromFrame[242]!(fx, fy)).toBe(s);
    }
  });
});

// ============ A3. 雕像 105 + 旗帜 91（审计遗留 ❌#5/#6,2026-08-23 1457 全量转录批） ============
describe('雕像 105 + 旗帜 91（❌#5/#6 全量转录）', () => {
  it('雕像 83 档长度断言（StatueStyleToItem :38311 实域 0..82,防转录截断）', () => {
    expect(styleDropVid(105, 0)).toBe(360);
    expect(styleDropVid(105, 82)).toBe(5319);   // 尾档（鸡尾鹦鹉,1.4.5 新）
    expect(styleDropVid(105, 83)).toBe(360);    // 越界首档回落 t[0]（表恰 83 档,素材槽 83..164 空白）
  });

  it('雕像首/中/尾抽查 ≥8 档（StatueStyleToItem :38315-38369 逐 case）', () => {
    expect(styleDropVid(105, 1)).toBe(52);      // case 1 天使（:38318）
    expect(styleDropVid(105, 2)).toBe(438);     // default 首档 星星（:38369）
    expect(styleDropVid(105, 20)).toBe(456);
    expect(styleDropVid(105, 34)).toBe(470);    // 蘑菇（掉落物 createTile=349,原版语义照抄）
    expect(styleDropVid(105, 42)).toBe(478);    // default 尾档 食人鱼
    expect(styleDropVid(105, 43)).toBe(1152);   // 蜥蜴神像（:38321）
    expect(styleDropVid(105, 50)).toBe(2672);   // 鲨鱼（:38342）
    expect(styleDropVid(105, 51)).toBe(3651);   // 松鼠（:38345-38357）
    expect(styleDropVid(105, 62)).toBe(3662);
    expect(styleDropVid(105, 63)).toBe(3708);   // default 63-75（:38360）
    expect(styleDropVid(105, 75)).toBe(3720);
    expect(styleDropVid(105, 76)).toBe(4397);   // 猫头鹰（:38362）
    expect(styleDropVid(105, 77)).toBe(4360);   // 海鸥（:38363）
    expect(styleDropVid(105, 78)).toBe(4342);   // 蜻蜓（:38364）
    expect(styleDropVid(105, 79)).toBe(4466);   // 乌龟（:38365）
    expect(styleDropVid(105, 80)).toBe(5317);   // 金刚鹦鹉（:38366,1.4.5 新）
  });

  it('雕像帧反推（Check2xX :38542-38545 fx/36+(fy/54%3)*55,右列/中行同档）', () => {
    expect(styleDropVidOfFrames(105, 0, 0)).toBe(360);
    expect(styleDropVidOfFrames(105, 18, 0)).toBe(360);     // 右列 fx+18 同档
    expect(styleDropVidOfFrames(105, 1224, 0)).toBe(470);   // style34=34*36
    expect(styleDropVidOfFrames(105, 1836, 0)).toBe(3651);  // style51
    expect(styleDropVidOfFrames(105, 972, 54)).toBe(5319);  // style82=27+55*1
    expect(styleDropVidOfFrames(105, 972, 72)).toBe(5319);  // 中行 fy+18 同组
    expect(styleDropVidOfFrames(105, 0, 108)).toBe(360);    // fy/54=2→槽110 越界（素材空白）回落 t[0]
  });

  it('旗帜 316 档长度断言（CheckBanner :46566-46567 实域 0..315,防转录截断）', () => {
    expect(styleDropVid(91, 0)).toBe(337);
    expect(styleDropVid(91, 315)).toBe(5673);   // 尾档 水弹宝箱怪旗
    expect(styleDropVid(91, 316)).toBe(337);    // 越界首档回落 t[0]（表恰 316 档）
  });

  it('旗帜 22 段首尾抽查（CheckBanner :46568-46654 else-if 链,行号=1457）', () => {
    const segs: Array<[number, number, number, number]> = [
      [0, 3, 337, 340],        // else :46652（337+style）
      [4, 6, 789, 791],        // :46648（785+style）
      [7, 9, 845, 847],        // :46644（838+style）
      [10, 15, 1451, 1456],    // :46636（1441+style）
      [16, 21, 1464, 1469],    // :46640（1448+style,非死码:>=22 先截）
      [22, 108, 1615, 1701],   // :46632（1593+style）
      [109, 206, 2897, 2994],  // :46628（2788+style）
      [207, 269, 3390, 3452],  // :46624（3183+style）
      [270, 271, 3593, 3594],  // :46620（3323+style）
      [272, 272, 3780, 3780],  // :46616（恒值）
      [273, 277, 3789, 3793],  // :46612（3516+style）
      [278, 287, 3837, 3846],  // :46608（3559+style）
      [288, 293, 4541, 4546],  // :46604（4253+style）
      [294, 294, 4602, 4602],  // :46600（恒值）
      [295, 296, 4687, 4688],  // :46596（4392+style）
      [297, 309, 4965, 4977],  // :46592（4668+style）
      [310, 310, 5352, 5352],  // :46588
      [311, 311, 5497, 5497],  // :46584
      [312, 312, 5498, 5498],  // :46580
      [313, 313, 5651, 5651],  // :46576
      [314, 314, 5672, 5672],  // :46572
      [315, 315, 5673, 5673],  // :46568
    ];
    for (const [a, b, va, vb] of segs) {
      expect(styleDropVid(91, a), `旗帜 style ${a}`).toBe(va);
      expect(styleDropVid(91, b), `旗帜 style ${b}`).toBe(vb);
    }
  });

  it('旗帜帧反推（:46566-46567 fx/18+(fy/54)*111,三行同档）', () => {
    expect(styleDropVidOfFrames(91, 0, 0)).toBe(337);
    expect(styleDropVidOfFrames(91, 0, 18)).toBe(337);      // 中行
    expect(styleDropVidOfFrames(91, 0, 36)).toBe(337);      // 底行
    expect(styleDropVidOfFrames(91, 0, 54)).toBe(2899);     // style111=0+111*1→2788+111
    expect(styleDropVidOfFrames(91, 1674, 108)).toBe(5673); // style315=93+111*2
  });

  it('全 83+316 档 vid 均有真实物品键（VANILLA_ITEM_KEY_BY_ID 全覆盖,掉落可实例化=验图）', () => {
    let n = 0;
    for (let s = 0; s <= 82; s++) {
      const v = styleDropVid(105, s);
      expect(v, `雕像 style ${s}`).toBeGreaterThan(0);
      expect(VANILLA_ITEM_KEY_BY_ID[v], `雕像 style ${s} → vid ${v}`).toBeTruthy();
      expect(ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[v]], `vid ${v} 应有 def`).toBeDefined();
      n++;
    }
    for (let s = 0; s <= 315; s++) {
      const v = styleDropVid(91, s);
      expect(v, `旗帜 style ${s}`).toBeGreaterThan(0);
      expect(VANILLA_ITEM_KEY_BY_ID[v], `旗帜 style ${s} → vid ${v}`).toBeTruthy();
      expect(ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[v]], `vid ${v} 应有 def`).toBeDefined();
      n++;
    }
    expect(n).toBe(83 + 316);
  });
});

// ============ B. 帧反推 style（与 furnitureStyleBase 互为反函数） ============
describe('styleFromFrame 反推（放置帧→style roundtrip）', () => {
  it('烛台 100 / 水槽 172 新竖排基（Place2x2 cs:51436 frameY=style*36|38）roundtrip', () => {
    for (let s = 0; s < 8; s++) {
      expect(furnitureStyleBase(100, s, 2)).toEqual([0, s * 36]);
      expect(furnitureStyleBase(172, s, 2)).toEqual([0, s * 38]);
      const [fx, fy] = framedCellFrame(100, 2, s, 1, 1);
      expect(styleFromFrame[100]!(fx, fy)).toBe(s);
      const [fx2, fy2] = framedCellFrame(172, 2, s, 0, 1);
      expect(styleFromFrame[172]!(fx2, fy2)).toBe(s);
    }
  });

  it('横排族（桌 14 fx/54）/ 竖排族（椅 15 fy/40 / 床 79 fy/36）/ 吊灯 34 wrap37 roundtrip', () => {
    for (let s = 0; s < 5; s++) {
      const [tx, ty] = framedCellFrame(14, 3, s, 2, 1);
      expect(styleFromFrame[14]!(tx, ty)).toBe(s);
      const [cx, cy] = framedCellFrame(15, 1, s, 0, 1);
      expect(styleFromFrame[15]!(cx, cy)).toBe(s);
      const [bx, by] = framedCellFrame(79, 4, s, 3, 1);
      expect(styleFromFrame[79]!(bx, by)).toBe(s);
    }
    for (const s of [0, 36, 37, 40, 73]) {
      const [fx, fy] = framedCellFrame(34, 3, s, 1, 2);
      expect(styleFromFrame[34]!(fx, fy)).toBe(s);
    }
  });
});

// ============ C. breakTile 集成（shell 模式,同 vine-cascade） ============
interface Drop { key: string; n: number }
function breakShell(w: World, drops: Drop[]) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    world: World; breakTile: (x: number, y: number, byPlayer?: boolean) => void;
  };
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {} };
  g.spawnDrop = (x: number, y: number, key: string, n: number) => { drops.push({ key, n }); return null; };
  g.recLog = () => {};
  g.dumpChest = () => {};
  g.entities = { add: () => {}, drops: [] };
  g.trackTile = 0;
  g.player = undefined;
  return g as unknown as { breakTile: (x: number, y: number, byPlayer?: boolean) => void };
}

describe('breakTile 按帧掉真物品（object 分支 + 1×1 分支 + 门）', () => {
  it('乌木桌 style1（帧=framedCellFrame(14,3,1)）挖掉 → vi_638（曾恒掉 vi_32 木桌）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('table');
    const [fx, fy] = framedCellFrame(14, 3, 1, 0, 0);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, fx + dx * 18, fy + dy * 18);
    }
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, idOfSheet(1));   // 支撑
    g.breakTile(11, 10, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[638], n: 1 }]);
    expect(w.store.get(10, 10)).toBe(0);
  });

  it('金宝箱 style1（fx=36）挖掉 → vi_306（GetItemDrop_Chests :58024 fx/36）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('chest');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, 36 + dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 12, idOfSheet(1));
    w.store.setTileSilent(11, 12, idOfSheet(1));
    g.breakTile(10, 10, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[306], n: 1 }]);
  });

  it('1×1：钨矿条 style3（fx=54）挖掉 → vi_704（KillTile :65166 fx/18）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    w.store.setTileSilent(10, 10, keyOf('v_239_ore_bars'), 54, 0);
    g.breakTile(10, 10, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[704], n: 1 }]);
  });

  it('1×1：地牢蓝烛 style1（fy=22）挖掉 → vi_1405（KillTile :65595 fy/22）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    w.store.setTileSilent(10, 10, keyOf('candle'), 0, 22);
    g.breakTile(10, 10, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[1405], n: 1 }]);
  });

  it('门 style1（fy=54）挖掉 → vi_650 乌木门（GetDoorItem :69257,曾恒掉 vi_25）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('door_closed');
    for (let dy = 0; dy < 3; dy++) w.store.setTileSilent(10, 10 + dy, t, 0, 54 + dy * 18);
    g.breakTile(10, 11, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[650], n: 1 }]);
  });

  it('开门 style37（fx=108 带朝向档 36,fy=54）挖掉 → vi_3941（❌3 开式反推 CheckDoorOpen :87093-87094,曾恒传 10 掉 vi_25）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('door_open');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, 108 + dx * 18, 54 + dy * 18);
    }
    g.breakTile(11, 11, false);   // 右列中格命中（整扇移除,帧取命中格反推）
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[3941], n: 1 }]);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(11, 12)).toBe(0);
  });

  it('TNT 桶 654 挖掉无物品返还（KillTile :66114 no-drop;爆炸链=❌1,见 placement-frame-debt C 段）', () => {
    // ⚠️5 勘误:前注"TileFrame :86427 无 Check"系漏看 goto case 132（:86670）——654 仍进
    // Check2x2（:86688）,挖/毁=整件清+1002 爆炸;本壳 player 未建（cs:48764 门）只锁无返还
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('v_654_tnt_barrel');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, dx * 18, dy * 18);
    }
    g.breakTile(10, 10, false);
    expect(drops).toEqual([]);
    expect(w.store.get(10, 10)).toBe(0);
  });

  // ---- S2/D-7 批（2026-08-23）：新家族 breakTile 端到端 ----
  it('S2：画 3×3 240 style40（fx=216,fy=54）挖掉 → vi_1962（Check3x3Wall :44751,曾掉 place_v_）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('v_240_wall_hangings_3x3');
    const fx = 4 * 54, fy = 54;                     // style40 = col4+row1*36
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, fx + dx * 18, fy + dy * 18);
    }
    g.breakTile(11, 11, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[1962], n: 1 }]);
    expect(w.store.get(10, 10)).toBe(0);
  });

  it('S2：营火 215 style8（fx=432）挖掉 → vi_4689（GetCampfireItemDrop :50481,曾掉 place_v_）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('v_215_campfires');
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, 432 + dx * 18, dy * 18);
    }
    g.breakTile(11, 10, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[4689], n: 1 }]);
  });

  it('S2：宝石火花块 255/262（1×1）挖掉 → vi_1970（KillTile :65433 on/off 两态同档,曾掉 place_v_）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    w.store.setTileSilent(10, 10, keyOf('v_255_amethystgemsparkoff'), 0, 0);
    g.breakTile(10, 10, false);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[1970], n: 1 }]);
    w.store.setTileSilent(12, 10, keyOf('v_262_amethystgemspark'), 0, 0);
    g.breakTile(12, 10, false);
    expect(drops.length).toBe(2);   // on/off 两态同掉 1970（drops 累计两件）
    expect(drops[1].key).toBe(VANILLA_ITEM_KEY_BY_ID[1970]);
  });

  it('D-7：宝石锁 440 style2 带钥匙行（fx=108,fy=54）挖掉 → vi_3646+vi_1525 两件（Check3x3Wall :44917 num7/num8）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('v_440_gemlocks');
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, 108 + dx * 18, 54 + dy * 18);
    }
    g.breakTile(11, 11, false);
    expect(drops.map((d) => d.key).sort()).toEqual(
      [VANILLA_ITEM_KEY_BY_ID[3646], VANILLA_ITEM_KEY_BY_ID[1525]].sort());
    // 无钥匙变体行（fy=0）只掉锁体
    const drops2: Drop[] = [];
    const w2 = new World(40, 40, 7, 'sdr');
    const g2 = breakShell(w2, drops2);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) {
      w2.store.setTileSilent(10 + dx, 10 + dy, t, 108 + dx * 18, dy * 18);
    }
    g2.breakTile(11, 11, false);
    expect(drops2).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[3646], n: 1 }]);
  });

  it('D-7：假容器 441 style4（fx=144）挖掉 → 无掉落（GetItemDrop_FakeChests -1 档哨兵,曾掉 place_v_）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('v_441_fakecontainers');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, 144 + dx * 18, dy * 18);
    }
    g.breakTile(10, 10, false);
    expect(drops).toEqual([]);
    expect(w.store.get(10, 10)).toBe(0);
    // style0 → 3665 真物品
    const drops2: Drop[] = [];
    const w2 = new World(40, 40, 7, 'sdr');
    const g2 = breakShell(w2, drops2);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w2.store.setTileSilent(10 + dx, 10 + dy, t, dx * 18, dy * 18);
    }
    g2.breakTile(10, 10, false);
    expect(drops2).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[3665], n: 1 }]);
  });

  it('D-7：炮 209 style3（fx=216）挖掉 → vi_3664（CheckCannon :51296,曾掉 place_v_）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = breakShell(w, drops);
    const t = keyOf('v_209_cannon');
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 3; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, 216 + dx * 18, dy * 18);
    }
    g.breakTile(12, 11, false);   // 右下格命中（帧取命中格反推,fx/72 档不受列内偏移影响）
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[3664], n: 1 }]);
  });
});

// ============ C2. 审计 E 批（2026-08-23）：22 项 vid + 129/50/51 三缺口 ============
/** E 批 harness：breakShell 之上加「最近一次掉落缓冲 + 可选 Math.random 定值」——
 *  rand 缺省 1=不 mock（自然掷）,传值则 mock 并在 breakTile 后还原 */
let eDrops: Drop[] = [];
function breakE(w: World, rand?: number) {
  eDrops = [];
  const g = breakShell(w, eDrops);
  const spy = rand === undefined ? null : vi.spyOn(Math, 'random').mockReturnValue(rand);
  return {
    breakTile(x: number, y: number, byPlayer = false) {
      try { g.breakTile(x, y, byPlayer); } finally { spy?.mockRestore(); }
    },
  };
}
const dropsOf = (_w?: World): Drop[] => eDrops;

describe('审计 E 批：单档 vid 直掉 + 帧分档 + 蛛网/书/水晶碎晶（docs/audit/tile-audit-2026-08-23.md 分区 E）', () => {
  it('数据层帧直读三支：书 50 / 水晶碎晶 129 / 熔炉 133', () => {
    expect(styleDropVidOfFrames(50, 90, 0)).toBe(165);    // 水书伪装帧 → Water Bolt
    expect(styleDropVidOfFrames(50, 0, 0)).toBe(149);     // 其余 → Book
    expect(styleDropVidOfFrames(129, 0, 0)).toBe(502);    // 常规晶簇 → Crystal Shard
    expect(styleDropVidOfFrames(129, 324, 0)).toBe(4988); // 大晶簇带 → Gelatin Crystal
    expect(styleDropVidOfFrames(129, 342, 0)).toBe(4988);
    expect(styleDropVidOfFrames(133, 0, 0)).toBe(524);    // 精金熔炉
    expect(styleDropVidOfFrames(133, 54, 0)).toBe(1221);  // 钛金熔炉（fx≥54）
    expect(styleDropVidOfFrames(133, 90, 18)).toBe(1221);
  });

  it('数据层表分档三族：碗 103（fx/36）/ 压板 135（fy/18 七档）/ 计时器 144（fx/18 五档）', () => {
    expect(styleDropVid(103, 0)).toBe(356);
    expect(styleDropVid(103, 1)).toBe(2235);
    expect(styleDropVid(103, 2)).toBe(2242);
    expect(styleDropVid(103, 3)).toBe(2243);
    expect(styleDropVidOfFrames(103, 126, 0)).toBe(2243);   // 右列 fx=36s+18 同档
    expect(styleDropVid(135, 0)).toBe(529);
    expect(styleDropVid(135, 3)).toBe(543);
    expect(styleDropVid(135, 6)).toBe(1151);
    expect(styleDropVidOfFrames(135, 0, 108)).toBe(1151);
    expect(styleDropVid(144, 0)).toBe(583);
    expect(styleDropVid(144, 4)).toBe(4485);
    expect(styleDropVidOfFrames(144, 72, 0)).toBe(4485);
  });

  it('pileDecoDropVid 段直查（Check2x1 case 185 :47180-47232）', () => {
    expect(pileDecoDropVid(576)).toBe(71);   // 铜
    expect(pileDecoDropVid(594)).toBe(71);   // 右列同段
    expect(pileDecoDropVid(612)).toBe(72);   // 银
    expect(pileDecoDropVid(648)).toBe(73);   // 金
    expect(pileDecoDropVid(684)).toBe(181);  // 紫晶
    expect(pileDecoDropVid(864)).toBe(182);  // 钻
    expect(pileDecoDropVid(898)).toBe(182);
    expect(pileDecoDropVid(900)).toBe(0);    // 段外无档
    expect(pileDecoDropVid(0)).toBe(0);      // 苔藓小饰行
  });

  it('1×1 运行时：水晶碎晶 fx=0→502 / fx=324→4988；压板 fy=54→543；计时器 fx=72→4485', () => {
    const w = new World(40, 40, 7, 'e-batch');
    const shard = keyOf('v_129_crystal_shard');
    w.store.setTileSilent(10, 10, shard, 0, 0);
    breakE(w).breakTile(10, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[502]]);
    w.store.setTileSilent(10, 10, shard, 324, 0);
    breakE(w).breakTile(10, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[4988]]);

    const plate = keyOf('v_135_pressure_plates');
    w.store.setTileSilent(12, 10, plate, 0, 54);
    breakE(w).breakTile(12, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[543]]);

    const timer = keyOf('v_144_timers');
    w.store.setTileSilent(14, 10, timer, 72, 0);
    breakE(w).breakTile(14, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[4485]]);
  });

  it('书 50（fx=90 水书帧 → 165,fx=0 → 149）——特判自 object 死支移入共享表（审计 E ❌3）', () => {
    const w = new World(40, 40, 7, 'e-book');
    const book = keyOf('v_50_books');
    w.store.setTileSilent(10, 10, book, 90, 0);
    breakE(w).breakTile(10, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[165]]);
    w.store.setTileSilent(10, 10, book, 0, 0);
    breakE(w).breakTile(10, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[149]]);
  });

  it('蛛网 51：恒掉 150;蛛网墙 62 内 3/4 无掉落（KillTile 门 :63904,审计 E ❌2）', () => {
    const w = new World(40, 40, 7, 'e-web');
    const web = keyOf('v_51_cobweb');
    // 墙外：恒掉
    w.store.setTileSilent(10, 10, web, 0, 0);
    breakE(w).breakTile(10, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[150]]);
    // 墙 62 + 掷中 1/4（random=0 → Next(4)=0）→ 掉
    w.store.setTileSilent(12, 10, web, 0, 0);
    w.store.setWall(12, 10, 62);
    breakE(w, 0).breakTile(12, 10, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[150]]);
    // 墙 62 + Next(4)!=0（random=0.75 → 3）→ 无掉落
    w.store.setTileSilent(14, 10, web, 0, 0);
    w.store.setWall(14, 10, 62);
    breakE(w, 0.75).breakTile(14, 10, false);
    expect(dropsOf(w)).toEqual([]);
  });

  it('object 分支：存钱罐 29→87 / 碗 103 style1→2235 / 熔炉 133 style1→1221', () => {
    const w = new World(40, 40, 7, 'e-obj');
    const pig = keyOf('v_29_piggy_bank');
    for (let dx = 0; dx < 2; dx++) w.store.setTileSilent(10 + dx, 10, pig, dx * 18, 0);
    breakE(w).breakTile(11, 10, false);   // 右列命中
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[87]]);

    const bowl = keyOf('v_103_bowls');
    for (let dx = 0; dx < 2; dx++) w.store.setTileSilent(10 + dx, 12, bowl, 36 + dx * 18, 0);
    breakE(w).breakTile(10, 12, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[2235]]);

    const forge = keyOf('v_133_forges');
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 14 + dy, forge, 54 + dx * 18, dy * 18);
    }
    breakE(w).breakTile(12, 15, false);
    expect(dropsOf(w).map((d) => d.key)).toEqual([VANILLA_ITEM_KEY_BY_ID[1221]]);
  });

  it('小堆饰 185：fy=18 铜段掷串（random=0.99 → 2 恒掷 + 2/3 门掷×2=4 条×99）/ 宝石段 ×3 / fy!=18 无掉落不兜底', () => {
    const w = new World(40, 40, 7, 'e-pile');
    const pile = keyOf('v_185_small_decos');
    w.store.setTileSilent(10, 10, pile, 576, 18);
    breakE(w, 0.99).breakTile(10, 10, false);
    expect(dropsOf(w).length).toBe(4);   // 2 恒掷 + Next(3)!=0 两掷命中（0.99→Next=2）;1/2 以下门掷全未中
    for (const d of dropsOf(w)) { expect(d.key).toBe(VANILLA_ITEM_KEY_BY_ID[71]); expect(d.n).toBe(99); }

    w.store.setTileSilent(12, 10, pile, 684, 18);            // 紫晶段
    breakE(w, 0.99).breakTile(12, 10, false);
    expect(dropsOf(w)).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[181], n: 3 }]);   // Next(1,4)=3

    w.store.setTileSilent(14, 10, pile, 0, 0);               // fy!=18 苔藓行
    breakE(w).breakTile(14, 10, false);
    expect(dropsOf(w)).toEqual([]);                          // 原版无掉落,压 place_v_ 兜底
  });
});

// ============ D. 失撑链：样式掉落 + 非空箱存活门 + 巨石滚石弹 ============
function supportShell(w: World, drops: Drop[], projs: TrapShot[]) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    checkFurnitureSupport: (x: number, y: number) => void;
  };
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.spawnParticles = () => {};
  g.sfx = { play: () => {} };
  g.spawnDrop = (x: number, y: number, key: string, n: number) => { drops.push({ key, n }); return null; };
  g.entities = { add: (e: unknown) => { if (e instanceof TrapShot) projs.push(e); }, drops: [], enemies: [] };
  g.player = {};   // 巨石滚石弹的 !isGeneratingOrLoadingWorld 门近似（cs:48764）
  // ★BJ752-A（2026-11-02）：失撑拆除改走统一破坏链（killDecorPieceCells→breakTile）
  //  ——补 breakTile 头/object 支所需桩（recLog/killTileDropBait/dumpChest/成就窗）
  g.recLog = () => {};
  g.killTileDropBait = () => {};
  g.dumpChest = () => {};
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
  g.trackTile = 0;
  return g as unknown as { checkFurnitureSupport: (x: number, y: number) => void };
}

describe('checkFurnitureSupport（⚠️2 失撑样式掉落 + ⚠️3 巨石/非空箱）', () => {
  it('乌木桌 style1 失撑 → 整件清除 + vi_638（Check3x2 :49383 失败 → Item.NewItem）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = supportShell(w, drops, []);
    const t = keyOf('table');
    const [fx, fy] = framedCellFrame(14, 3, 1, 0, 0);
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, fx + dx * 18, fy + dy * 18);
    }
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, idOfSheet(1));
    w.store.setTile(11, 12, 0);   // 挖支撑 → onTileChanged(11,12) → 查 (11,11)
    g.checkFurnitureSupport(11, 11);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[638], n: 1 }]);
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(12, 11)).toBe(0);
  });

  it('有支撑的桌不动（复验通过即返回）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = supportShell(w, drops, []);
    const t = keyOf('table');
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, dx * 18, dy * 18);
    }
    for (let dx = 0; dx < 3; dx++) w.store.setTileSilent(10 + dx, 12, idOfSheet(1));
    g.checkFurnitureSupport(11, 11);
    expect(drops).toEqual([]);
    expect(w.store.get(10, 10)).toBe(t);
  });

  it('非空宝箱失撑悬空保留（CheckChest :57979 CanDestroyChest 门,R10 观察#6）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const g = supportShell(w, drops, []);
    const t = keyOf('chest');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 12, idOfSheet(1));
    w.store.setTileSilent(11, 12, idOfSheet(1));
    w.chests.push({ x: 10, y: 10, items: Array(10).fill(null) });
    w.chests[0].items[2] = { id: 1, stack: 3 };
    w.store.setTile(10, 12, 0);
    g.checkFurnitureSupport(10, 11);
    expect(drops).toEqual([]);
    expect(w.store.get(10, 10)).toBe(t);      // 整件保留（悬空）
    expect(w.store.get(11, 11)).toBe(t);
    // 清空后失撑 → 掉落 + 移除
    w.chests[0].items[2] = null;
    g.checkFurnitureSupport(10, 11);
    expect(drops).toEqual([{ key: VANILLA_ITEM_KEY_BY_ID[48], n: 1 }]);
    expect(w.store.get(10, 10)).toBe(0);
  });

  /** ★SW-BJ102 债②（2026-09-16）巨石族支撑/Spawn 单口归一后的运行时台：
   *  真实监听装配（Game afterWorldLoad 双监听同序 scanBoulderFamilyNear→
   *  checkFurnitureSupport(x,y-1)）——巨石 138 族支撑判据=Check2x2 判据② BOTH 柱
   *  SolidTileAllowBottomSlope（WorldGen.cs:48968-48984/1458 :48899,单柱仍在=保留）,
   *  Spawn 单口=convertBoulderRoll（:49171-49235 NewProjectile 位,RollingBoulder）;
   *  旧「家具臂 ANY 柱判据+TrapShot 直发」三口并上面已退役（BJ102 实证挖一格 3 弹）。 */
  function boulderSupportShell(world: World, drops: Drop[], projs: RollingBoulder[], extra?: Record<string, unknown>) {
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
      breakTile: Game['breakTile'];
    };
    g.world = world;
    g.chunks = { markDirtyArea: () => {} };
    g.spawnParticles = () => {};
    g.sfx = { play: () => {} };
    g.spawnDrop = (x: number, y: number, key: string, n: number) => { drops.push({ key, n }); return null; };
    g.recLog = () => {};
    g.dumpChest = () => {};
    g.entities = { add: (e: unknown) => { if (e instanceof RollingBoulder) projs.push(e); }, drops: [], critters: [], enemies: [], npcs: [], projectiles: [], props: [] };
    g.trackTile = 0;
    g.player = { equipStats: {} };
    g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
    if (extra) Object.assign(g, extra);
    world.store.onTileChanged((cx: number, cy: number) => {
      (g as unknown as { scanBoulderFamilyNear(x: number, y: number): void }).scanBoulderFamilyNear(cx, cy);
    });
    world.store.onTileChanged((x: number, y: number) => {
      (g as unknown as { checkFurnitureSupport(x: number, y: number): void }).checkFurnitureSupport(x, y - 1);
    });
    return g as unknown as { breakTile: Game['breakTile']; checkFurnitureSupport: (x: number, y: number) => void };
  }

  it('巨石 138 失撑 → 判据②双柱失 → 2×2 清 + 滚石弹 1 发（Check2x2 :48968-48984/:49171,弹 99 伤 70）,无物品掉落', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const projs: RollingBoulder[] = [];
    const g = boulderSupportShell(w, drops, projs);
    const t = keyOf('v_138_boulder');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 12, idOfSheet(1));
    w.store.setTileSilent(11, 12, idOfSheet(1));
    w.store.setTile(10, 12, 0);   // 挖左下支撑——右柱仍在 ⇒ 判据②不触发=原版保留
    expect(w.store.get(10, 10)).toBe(t);      // ★BJ102：旧 ANY 柱判据在此误塌+误发=偏差已归一
    expect(projs.length).toBe(0);
    w.store.setTile(11, 12, 0);   // 再挖右柱 → 双柱失 → Check2x2 destroy+单发
    expect(w.store.get(10, 10)).toBe(0);
    expect(w.store.get(11, 11)).toBe(0);      // 整件清
    expect(projs.length).toBe(1);
    expect(projs[0]).toBeInstanceOf(RollingBoulder);
    expect(projs[0].dmg).toBe(70);            // Check2x2 :49171 138→99 伤 70
    expect(drops).toEqual([]);                // 原版不掉物品（滚石压人语义）
  });

  it('巨石 712 屎堆失撑 → 伤 50（Check2x2 :49171 逐 sheet 伤害表）；支撑在/单柱失均不触发', () => {
    const w = new World(40, 40, 7, 'sdr');
    const projs: RollingBoulder[] = [];
    const g = boulderSupportShell(w, [], projs);
    const t = keyOf('v_712_poo_boulder');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 12, idOfSheet(1));
    w.store.setTileSilent(11, 12, idOfSheet(1));
    g.checkFurnitureSupport(10, 11);          // 家具臂已退役（巨石早退）——支撑还在零触发
    expect(projs.length).toBe(0);
    w.store.setTile(11, 12, 0);               // 单柱失（右）→ 判据②双柱门不触发
    expect(projs.length).toBe(0);
    expect(w.store.get(10, 10)).toBe(t);
    w.store.setTile(10, 12, 0);               // 双柱失 → destroy+单发
    expect(projs.length).toBe(1);
    expect(projs[0].dmg).toBe(50);
  });

  it('TNT 桶 654 失撑 → 整件清+桶中心 1002 爆炸（❌1:非 Boulders 表走 :48866-48877 逐列支,cs:49178 Spawn→弹首拍 Kill 爆）', () => {
    const w = new World(40, 40, 7, 'sdr');
    const drops: Drop[] = [];
    const projs: RollingBoulder[] = [];
    const blasts: Array<[number, number, number, number, number]> = [];
    const g = boulderSupportShell(w, drops, projs, {
      explodeAt: (tx: number, ty: number, dmg: number, radius: number, _dt: boolean, _hb: unknown, _pen: unknown, projId: number) => {
        blasts.push([tx, ty, dmg, radius, projId]);
      },
      playSfx: () => {}, playSfxFile: () => {}, playSfxWav: () => {}, spawnDust: () => {},
    });
    const t = keyOf('v_654_tnt_barrel');
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 10 + dy, t, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 12, idOfSheet(1));
    w.store.setTileSilent(11, 12, idOfSheet(1));
    g.checkFurnitureSupport(10, 11);          // 支撑还在 → 不爆
    expect(blasts).toEqual([]);
    expect(w.store.get(10, 10)).toBe(t);
    // 桌面（tileTable）也算支撑（:48866-48877 solid||table）→ 仍不爆。
    // ★监听语义下换桌须走静默（setTile 非静默的中间空态即触发逐列支释放）：
    // 静默换桌后直调 checkFurnitureSupport 验「桌=承放」判定面。
    w.store.setTileSilent(10, 12, 0);
    w.store.setTileSilent(10, 12, idOfSheet(14), 0, 0);
    w.store.setTileSilent(11, 12, idOfSheet(14), 18, 0);
    g.checkFurnitureSupport(10, 11);
    expect(blasts).toEqual([]);
    expect(projs.length).toBe(0);
    w.store.setTile(11, 12, 0);               // 挖右桌 → 逐列支失撑 → 清+convert 单发
    expect(w.store.get(10, 10)).toBe(0);      // 整件清
    expect(w.store.get(11, 11)).toBe(0);
    expect(drops).toEqual([]);                // 无物品返还
    expect(projs.length).toBe(1);             // ★BJ102：Spawn 单口=convert（1002 弹）
    expect(projs[0].projId).toBe(1002);
    // 弹首拍 Kill → rbKill1002Face → explodeAt。★SW-J1 2026-09-03：radius 0/
    // destroyTiles=false——1002 不在 Kill_ExplodeTiles 闸门表（P.cs:79027-79030），
    // :79064 为死代码 = 原版 1002 Kill 不炸地形
    (projs[0] as RollingBoulder).fixedUpdate(1 / 60, g as unknown as Parameters<RollingBoulder['fixedUpdate']>[1]);
    expect(blasts).toEqual([[10, 10, 400, 0, 1002]]);   // 桶中心 (168,168)
  });
});

// ============ E. ⚠️3 杂项：瀑布动画 / 座钟授时 / 陶罐杂草 / 南瓜成长 ============
describe('瀑布族 8 帧动画（Main.cs:18743-18793 + TileDrawing.cs:6085-6094 pitch90）', () => {
  it('TILE_ANIM_RATE 五档：326 每 5tick / 327·345·458·459 每 10tick', () => {
    expect(TILE_ANIM_RATE[326]).toBe(5);
    expect(TILE_ANIM_RATE[327]).toBe(10);
    expect(TILE_ANIM_RATE[345]).toBe(10);
    expect(TILE_ANIM_RATE[458]).toBe(10);
    expect(TILE_ANIM_RATE[459]).toBe(10);
  });

  it('8 帧回卷、pitch 90（帧带偏移 = 帧序×90,素材 720px=8 带）', () => {
    tileAnim.tick = 0;
    expect(animFrameIdx(326, 720)).toBe(0);
    tileAnim.tick = 5;
    expect(animFrameIdx(326, 720)).toBe(1);
    expect(animYOffset(326, 720)).toBe(90);
    tileAnim.tick = 40;
    expect(animFrameIdx(326, 720)).toBe(0);      // 40/5=8 → %8 回卷
    tileAnim.tick = 10;
    expect(animFrameIdx(327, 720)).toBe(1);      // 327 每 10tick
    expect(animFrameIdx(326, 720)).toBe(2);      // 326 每 5tick（10/5=2）
    tileAnim.tick = 75;
    expect(animFrameIdx(459, 720)).toBe(7);      // 75/10=7 → 末帧
    tileAnim.tick = 80;
    expect(animFrameIdx(459, 720)).toBe(0);      // >7 回卷
  });
});

describe('座钟授时（⚠️3,SceneMetrics.HasClock → accWatch=3）', () => {
  it('扫描窗内有落地钟 104 → hasClock；无 → false（SceneMetrics.cs:465-467）', () => {
    const w = new World(200, 120, 7, 'clock');
    const clockId = idOfSheet(104);
    w.store.setTileSilent(100, 60, clockId, 0, 0);
    w.store.setTileSilent(101, 60, clockId, 36, 0);
    for (let dy = 1; dy < 5; dy++) {
      w.store.setTileSilent(100, 60 + dy, clockId, 0, dy * 18);
      w.store.setTileSilent(101, 60 + dy, clockId, 36, dy * 18);
    }
    const s = scanScene(w, 100 * 16, 60 * 16, 0);
    expect(s.hasClock).toBe(true);
    // 窗 ±84×±62：(190,60) 窗 x≥106 扫不到 x=100..101 的钟
    const s2 = scanScene(w, 190 * 16, 60 * 16, 0);
    expect(s2.hasClock).toBe(false);
    expect(EMPTY_SCENE.hasClock).toBe(false);
  });

  it('授时精度档（Main.cs:46220-46227）：accWatch 3=真实分 / 1=整点 :00 / 2=半点', () => {
    // Main.time=21600（t=21600/3600-19.5+24=10.5 → 上午 10:30）——level3 真实分 /
    // level1 恒 :00 / level2 半点 :30
    expect(formatWatchText(21600, true, 3)).toContain('10:30');
    expect(formatWatchText(21600, true, 1)).toContain('10:00');
    expect(formatWatchText(21600, true, 2)).toContain('10:30');
    expect(formatWatchText(21200, true, 2)).toContain('10:00');   // 10:23 → 半点档 :00
  });
});

describe('陶罐顶部杂草 + 南瓜株成长（⚠️3,UpdateWorld :72376-72390）', () => {
  const SID = (s: number) => idOfSheet(s);
  function evoOf(w: World): WorldEvolution {
    const host = {
      store: w.store, worldSurface: 12, rockLevel: 18,
      flags: w.flags, crimson: false, isDay: true, raining: false,
      maxRaining: 0, windSpeedCurrent: 0, playerTile: () => null,
      dungeonX: 0, difficulty: 0,
    };
    return new WorldEvolution(host);
  }

  it('陶罐 78 采样：上方空 + 掷中 → 顶部杂草 tile3（PlaceTile(3) frameX=Next(5)*18）', () => {
    const w = new World(40, 40, 7, 'pot');
    const evo = evoOf(w);
    w.store.setTileSilent(10, 20, SID(78), 0, 0);
    const rand = vi.spyOn(RNG.prototype, 'next').mockReturnValue(0.4);   // <0.5 命中 1/2 掷
    (evo as unknown as { overgroundTile: (i: number, j: number, wallDist: number) => void }).overgroundTile(10, 20, 0);
    rand.mockRestore();
    expect(w.store.get(10, 19)).toBe(SID(3));      // 杂草长在罐顶
  });

  it('陶罐上方被占 → 不长；掷未中 → 不长', () => {
    const w = new World(40, 40, 7, 'pot');
    const evo = evoOf(w);
    w.store.setTileSilent(10, 20, SID(78), 0, 0);
    w.store.setTileSilent(10, 19, SID(3), 0, 0);   // 已有杂草
    const rand = vi.spyOn(RNG.prototype, 'next').mockReturnValue(0.4);
    (evo as unknown as { overgroundTile: (i: number, j: number, wallDist: number) => void }).overgroundTile(10, 20, 0);
    rand.mockRestore();
    expect(w.store.get(10, 19)).toBe(SID(3));      // 仍是原杂草（不叠加）
  });

  it('南瓜株 254 GrowPumpkin（cs:52522）：stage0 → 全格 fx+=36；草族支撑门', () => {
    const w = new World(40, 40, 7, 'pumpkin');
    const evo = evoOf(w);
    const t = SID(254);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 18 + dy, t, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 20, SID(2));         // 草支撑
    w.store.setTileSilent(11, 20, SID(2));
    (evo as unknown as { growPumpkin: (i: number, j: number) => void }).growPumpkin(10, 18);
    expect(w.store.frameX[w.store.idx(10, 18)]).toBe(36);   // stage0 → 1
    expect(w.store.frameX[w.store.idx(11, 19)]).toBe(54);   // 右下格 36+18
    // stage4（fx=144）不再长
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 18 + dy, t, 144 + dx * 18, dy * 18);
    }
    (evo as unknown as { growPumpkin: (i: number, j: number) => void }).growPumpkin(10, 18);
    expect(w.store.frameX[w.store.idx(10, 18)]).toBe(144);
  });

  it('南瓜株支撑非草族（泥 53）→ 不长（cs:52552-52556 type∈{2,477,109,492}）', () => {
    const w = new World(40, 40, 7, 'pumpkin');
    const evo = evoOf(w);
    const t = SID(254);
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      w.store.setTileSilent(10 + dx, 18 + dy, t, dx * 18, dy * 18);
    }
    w.store.setTileSilent(10, 20, SID(53));        // 沙——非草族
    w.store.setTileSilent(11, 20, SID(2));
    (evo as unknown as { growPumpkin: (i: number, j: number) => void }).growPumpkin(10, 18);
    expect(w.store.frameX[w.store.idx(10, 18)]).toBe(0);
  });
});
