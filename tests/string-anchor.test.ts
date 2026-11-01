// 绳锚几何系统测试（绳锚批 2026-08-19）：
//   ① pulley 悬挂吸附 + gfxOffY（FindPulley Player.cs:19355-19460；衰减 :27695-27719；
//      WorldGen.IsRope :70118-70152 绳穿平台支；绳族 tile 数据 Main.cs:9223-9227）
//   ② RotatedRelativePoint 展开式（Player.cs:4063-4089：fullRotation=0 恒等/ gfxOffY
//      平移 / 旋转全式 / num2 坐骑项 rot=0 自消）
//   ③ ApplyItemPositionOffsetFromMount mount 54 持物偏移表（Player.cs:50638-50795：
//      悠悠球行档 2/3/4 / 钓竿 / 非表坐骑归零 / mount52 狼人线起点修正）
//   ④ 组合：骑坐骑持钓竿竿尖起点 ≠ 裸中心（DrawProj_FishingLine :34969-35111 全链，
//      含 gfxOffY 双计原版行为 + (8,8)−(8,8) 抵消）
import { describe, it, expect } from 'vitest';
import { Inventory } from '../src/items/Inventory';
import { Player } from '../src/entities/Player';
import { TileStore } from '../src/world/TileStore';
import { World } from '../src/world/World';
import { TILE_BY_KEY } from '../src/data/tiles';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { fishingPoleTipStart } from '../src/entities/Bobber';
import { MOUNT_DATA } from '../src/entities/Mounts';
import type { GameHooks } from '../src/entities/types';

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];
const ROPE = TILE_BY_KEY['v_213_rope'];
const SILK_ROPE = TILE_BY_KEY['v_365_silk_rope'];
const PLATFORM = TILE_BY_KEY['platform'];   // sheet 19（TileID.Sets.Platforms）
const mkPlayer = (x: number, y: number) => new Player(x, y, new Inventory());
const mkStore = () => new TileStore(60, 60);
/** col=10 行 rows 连续绳柱 */
const ropeColumn = (st: TileStore, rows: number[]) => {
  for (const y of rows) st.setTileSilent(10, y, ROPE);
};
const ride = (p: Player, type: number) => { p.mount.active = true; p.mount.type = type; };
const hold = (p: Player, vid: number) => { p.inv.slots[0] = { id: _iid(vid), stack: 1 }; };

// ============================================================
// ① pulley 悬挂吸附 + gfxOffY（Player.cs:19355-19460）
// ============================================================
describe('FindPulley 悬挂吸附（Player.cs:19355-19460）', () => {
  it('连续绳：X 吸附最近档（居中档）、y 不动、gfxOffY=0、stepSpeed=2.5、vx=0', () => {
    const st = mkStore();
    ropeColumn(st, [20, 21, 22, 23, 24]);
    const p = mkPlayer(160, 336);          // 头格行 =(336−8)/16=20（绳）；中心 170→列 10
    p.inputUp = true;
    p.vx = 2;
    p.findPulley(st);
    // 档位：num5=164(|Δ|4) / num6=158(|Δ|2) / num7=152(|Δ|8) → 居中档 num8=2
    expect(p.pulley).toBe(true);
    expect(p.x).toBe(158);                 // 10*16+8−20/2
    expect(p.pulleyDir).toBe(1);
    expect(p.y).toBe(336);                 // 上(19)非绳但下(21)是绳 → 非孤立 → num3=y
    expect(p.gfxOffY).toBe(0);
    expect(p.stepSpeed).toBe(2.5);
    expect(p.vx).toBe(0);
    expect(p.facing).toBe(1);              // 未改向
  });

  it('右贴档/左贴档：x 更近 ±6 档时 pulleyDir=2 且定 facing', () => {
    const st = mkStore();
    ropeColumn(st, [20, 21, 22, 23, 24]);
    const a = mkPlayer(162, 336);          // |162−164|=2 最近 → num8=1
    a.inputDown = true;
    a.findPulley(st);
    expect(a.x).toBe(164);
    expect(a.pulleyDir).toBe(2);
    expect(a.facing).toBe(1);

    const b = mkPlayer(153, 336);          // |153−152|=1 最近 → num8=3
    b.inputUp = true;
    b.findPulley(st);
    expect(b.x).toBe(152);
    expect(b.pulleyDir).toBe(2);
    expect(b.facing).toBe(-1);
  });

  it('孤立绳格：y 落 num2*16+22、gfxOffY 记录跳变差（:19378/:19421）', () => {
    const st = mkStore();
    st.setTileSilent(10, 20, ROPE);        // 上下邻格均空 → 孤立
    const p = mkPlayer(160, 330);          // 头格行 =(330−8)/16=20
    p.inputUp = true;
    p.findPulley(st);
    expect(p.pulley).toBe(true);
    expect(p.y).toBe(20 * 16 + 22);        // 342
    expect(p.gfxOffY).toBe(330 - 342);     // −12（视觉补偿：渲染锚仍按旧 y）
    expect(p.x).toBe(158);
  });

  it('门：无上/下输入、头格非绳、折叠凳使用中均不进态（:19357/:19363）', () => {
    const st = mkStore();
    ropeColumn(st, [20, 21, 22]);
    const a = mkPlayer(160, 336);          // 无输入
    a.findPulley(st);
    expect(a.pulley).toBe(false);
    const b = mkPlayer(160, 336);          // 头格不在绳上（行 20 非绳的世界）
    b.inputUp = true;
    b.findPulley(new TileStore(60, 60));
    expect(b.pulley).toBe(false);
    const c = mkPlayer(160, 336);
    c.inputUp = true;
    c.stoolInUse = true;                   // portableStoolInfo.IsInUse（:19357）
    c.findPulley(st);
    expect(c.pulley).toBe(false);
  });

  it('gfxOffY 衰减（:27695-27719）：num106×stepSpeed 向 0 收敛、过零截断、钳 ±32', () => {
    const p = mkPlayer(0, 0);
    p.stepSpeed = 2.5;
    p.vx = 0;                              // num106 = 1
    p.gfxOffY = -12;
    p.decayGfxOffY();
    expect(p.gfxOffY).toBe(-9.5);
    p.decayGfxOffY(); p.decayGfxOffY(); p.decayGfxOffY();
    expect(p.gfxOffY).toBe(-2);
    p.decayGfxOffY();                      // −2+2.5=+0.5 → 截断 0
    expect(p.gfxOffY).toBe(0);
    p.gfxOffY = 40;
    p.decayGfxOffY();
    expect(p.gfxOffY).toBe(32);            // 钳上界
    p.gfxOffY = -40;
    p.decayGfxOffY();
    expect(p.gfxOffY).toBe(-32);           // 钳下界
    p.gfxOffY = -12;
    p.vx = 6;                              // num106 = 1+6/3 = 3 → 步长 7.5
    p.decayGfxOffY();
    expect(p.gfxOffY).toBe(-4.5);
  });
});

describe('WorldGen.IsRope（:70118-70152）绳判定', () => {
  it('绳族直判：213/365 均为绳（tileRope Main.cs:9223-9227；365 丝绳数据批补）', () => {
    const st = mkStore();
    st.setTileSilent(10, 20, ROPE);
    st.setTileSilent(11, 20, SILK_ROPE);
    expect(mkPlayer(0, 0).isRopeAt(st, 10, 20)).toBe(true);
    expect(mkPlayer(0, 0).isRopeAt(st, 11, 20)).toBe(true);
  });

  it('绳穿平台：平台格上下邻格皆绳 → 视作绳（GetRopeEnds :70069-70105）', () => {
    const st = mkStore();
    st.setTileSilent(10, 19, ROPE);
    st.setTileSilent(10, 20, PLATFORM);    // sheet 19 平台
    st.setTileSilent(10, 21, ROPE);
    expect(mkPlayer(0, 0).isRopeAt(st, 10, 20)).toBe(true);
    // 只有上绳、下空 → bottomRopeY=-1 → 非绳
    const st2 = mkStore();
    st2.setTileSilent(10, 19, ROPE);
    st2.setTileSilent(10, 20, PLATFORM);
    expect(mkPlayer(0, 0).isRopeAt(st2, 10, 20)).toBe(false);
    // 下方隔一格空 → 扫描在非活跃格 break（:70100-70104）→ 非绳
    const st3 = mkStore();
    st3.setTileSilent(10, 19, ROPE);
    st3.setTileSilent(10, 20, PLATFORM);
    st3.setTileSilent(10, 22, ROPE);       // 21 空
    expect(mkPlayer(0, 0).isRopeAt(st3, 10, 20)).toBe(false);
  });
});

// ============================================================
// ② RotatedRelativePoint 展开式（Player.cs:4063-4089）
// ============================================================
describe('RotatedRelativePoint（Player.cs:4063-4089）', () => {
  it('fullRotation=0 / gfxOffY=0 → 恒等（无坐骑无旋转 = 原样返回）', () => {
    const p = mkPlayer(100, 200);          // w=20 h=42 → pivot=(110,242)
    expect(p.rotatedRelativePoint(150, 220)).toEqual({ x: 150, y: 220 });
  });

  it('fullRotation=0 / gfxOffY≠0 → 仅 +gfxOffY（num2 坐骑项在 rot=0 自消）', () => {
    const p = mkPlayer(100, 200);
    p.gfxOffY = -7;
    expect(p.rotatedRelativePoint(150, 220)).toEqual({ x: 150, y: 213 });
    // addGfxOffY=false：gfxOffY 经 pivot 与 pos 双含相消（:4070/:4075）
    expect(p.rotatedRelativePoint(150, 220, { addGfxOffY: false })).toEqual({ x: 150, y: 220 });
  });

  it('旋转全式：绕 Bottom+(0,gfxOffY) 旋 rot 后 +(−num2·sin, −num2+num2·cos)', () => {
    const p = mkPlayer(100, 200);
    const r = p.rotatedRelativePoint(150, 220, { rotation: Math.PI / 2 });
    // pivot=(110,242)、num2=4（未骑乘 PlayerOffset=0）、(pos−pivot)=(40,−22)
    // x = 110 + 22 − 4 = 128；y = 242 + 40 − 4 = 278
    expect(r.x).toBeCloseTo(128, 5);
    expect(r.y).toBeCloseTo(278, 5);
    // 矿车（PlayerOffset=8，SetAsMinecart :2720-2726）→ num2=8：
    // x = 110+22−8=124；y = 242+40−8=274（rot=0 时该项自消 → 不影响无旋转锚）
    ride(p, 6);                            // 矿车坐骑
    const r2 = p.rotatedRelativePoint(150, 220, { rotation: Math.PI / 2 });
    expect(r2.x).toBeCloseTo(124, 5);
    expect(r2.y).toBeCloseTo(274, 5);
    expect(p.rotatedRelativePoint(150, 220)).toEqual({ x: 150, y: 220 });
  });

  it('reverseRotation：角取反（:4065）', () => {
    const p = mkPlayer(100, 200);
    const a = p.rotatedRelativePoint(150, 220, { rotation: 0.7 });
    const b = p.rotatedRelativePoint(150, 220, { rotation: -0.7, reverseRotation: true });
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });
});

// ============================================================
// ③ ApplyItemPositionOffsetFromMount（Player.cs:50638-50795）
//    唯一有表坐骑 = 54 迅猛龙（MountID.cs:142；1456 :50638 ≡ 1457 :52019 函数同文）
// ============================================================
describe('mount 54 持物偏移表（Player.cs:50638-50795）', () => {
  it('悠悠球行档：aim −0.75/0.6 阈值分档 2/3/4（:50746-50757 + :35994-36010）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 54);
    hold(p, 3278);                         // 木悠悠球（ItemID.Sets.Yoyo）
    p.facing = 1;
    // aim=0（中档带）→ 行 3 → (8,0)·Directions
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true, aim: 0 }))
      .toEqual({ x: 108, y: 200 });
    // aim=−1.0（上瞄）→ 行 2 → (10,−10)
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true, aim: -1.0 }))
      .toEqual({ x: 110, y: 190 });
    // aim=0.8（下瞄）→ 行 4 → (2,2)
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true, aim: 0.8 }))
      .toEqual({ x: 102, y: 202 });
    // 朝向翻转 → X 项反号（Directions=(direction,gravDir) :3687）
    p.facing = -1;
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true, aim: 0 }))
      .toEqual({ x: 92, y: 200 });
  });

  it('钓竿：动画中恒 (−2,0)·Directions（:50680-50683）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 54);
    hold(p, 2289);                         // 玻璃钢钓竿（fishingPole=5）
    p.facing = 1;
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true }))
      .toEqual({ x: 98, y: 200 });
    p.facing = -1;
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true }))
      .toEqual({ x: 102, y: 200 });
  });

  it('非动画且无 holdStyle → 早退零偏移（:50649-50652）；非表坐骑恒零（:50667）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 54);
    hold(p, 3278);
    expect(p.applyItemPositionOffsetFromMount(100, 200)).toEqual({ x: 100, y: 200 });
    p.useTime = 8;                          // itemAnimation>0 代理（useTime 计窗）
    expect(p.applyItemPositionOffsetFromMount(100, 200, { aim: 0 }))
      .toEqual({ x: 108, y: 200 });
    // 独角兽 10：1456/1457 两版表外坐骑 → 恒零
    ride(p, 10);
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true, aim: 0 }))
      .toEqual({ x: 100, y: 200 });
  });

  it('未骑坐骑 → 直接原样返回（:50640-50643）', () => {
    const p = mkPlayer(100, 200);
    hold(p, 3278);
    expect(p.applyItemPositionOffsetFromMount(100, 200, { itemAnimating: true, aim: 0 }))
      .toEqual({ x: 100, y: 200 });
  });
});

describe('yoyoStringAnchor（Main.cs:27794-27803 悠悠球/配重球线起点）', () => {
  it('无坐骑无 gfxOffY → 玩家盒中心（= 旧 p.cx/p.cy 行为基线）', () => {
    const p = mkPlayer(100, 200);
    expect(p.yoyoStringAnchor()).toEqual({ x: 110, y: 221 });
  });

  it('mount 52 狼人：mountedCenter+(direction*14,−10)（:27795-27798）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 52);
    p.facing = 1;
    expect(p.yoyoStringAnchor()).toEqual({ x: 110 + 14, y: 221 - 10 });
    p.facing = -1;
    expect(p.yoyoStringAnchor()).toEqual({ x: 110 - 14, y: 211 });
  });

  it('gfxOffY 下沉 + mount54 悠悠球档（:27802→:27803 链序）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 54);
    hold(p, 3278);
    p.facing = 1;
    p.gfxOffY = -7;
    // mountedCenter(110,221) → +gfxOffY(214) → mount54 行3 档 (8,0)
    const t = { x: 200, y: 219 };          // 平射目标（aim=0 → 行 3）
    expect(p.yoyoStringAnchor(t, true)).toEqual({ x: 118, y: 214 });
  });

  it('aim 全链：itemAimRotDir 从光标世界位复算行档（参照点 rrp(MountedCenter)−(0,2·gravDir)）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 54);
    hold(p, 3278);
    p.facing = 1;
    // 上瞄（目标在参照点 (110,219) 正上方）→ n21=−π/2 → 行 2 → (10,−10)
    expect(p.yoyoStringAnchor({ x: 110, y: 100 }, true)).toEqual({ x: 120, y: 211 });
    // 下瞄 → n21=+π/2 → 行 4 → (2,2)
    expect(p.yoyoStringAnchor({ x: 110, y: 400 }, true)).toEqual({ x: 112, y: 223 });
  });
});

// ============================================================
// ④ 组合：钓线竿尖起点全链（DrawProj_FishingLine :34969-35111）
// ============================================================
describe('fishingPoleTipStart 竿尖起点链（Main.cs:34969-35111）', () => {
  it('裸装：mountedCenter + 逐竿偏移（2289 玻璃钢竿 +43,−36；dir<0 再 −13）', () => {
    const p = mkPlayer(100, 200);
    p.facing = 1;
    // 基点 (110,221) → 竿尖 (110+43, 221−36)=(153,185) → rrp(+8,−8) 无旋转恒等
    expect(fishingPoleTipStart(p, 2289)).toEqual({ x: 153, y: 185 });
    p.facing = -1;
    expect(fishingPoleTipStart(p, 2289)).toEqual({ x: 110 - 43 - 13, y: 185 });
  });

  it('gfxOffY 双计（:34982 + :35111 RotatedRelativePoint addGfxOffY=true 各加一次）', () => {
    const p = mkPlayer(100, 200);
    p.facing = 1;
    p.gfxOffY = -7;
    // 基点 y=221−7=214 → 竿尖 y=214−36=178 → rrp 再 −7 → 171
    const t = fishingPoleTipStart(p, 2289);
    expect(t.x).toBe(153);
    expect(t.y).toBe(221 - 7 - 36 - 7);   // 171：原版同款双计行为
  });

  it('骑迅猛龙持钓竿（动画中）：起点 ≠ 裸中心（mount54 (−2,0) 档生效）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 54);
    hold(p, 2289);
    p.facing = 1;
    p.useTime = 8;                          // itemAnimation>0（8t 抛竿窗）
    const t = fishingPoleTipStart(p, 2289);
    expect(t).toEqual({ x: 153 - 2, y: 185 });
    expect(t.x).not.toBe(110 + 43);         // ≠ 裸中心公式 cx+43
  });

  it('骑迅猛龙收线后（动画窗尽）：mount 档早退 → 回裸中心竿尖', () => {
    const p = mkPlayer(100, 200);
    ride(p, 54);
    hold(p, 2289);
    p.facing = 1;
    p.useTime = 0;
    p.itemAnimTicks = 0;
    expect(fishingPoleTipStart(p, 2289)).toEqual({ x: 153, y: 185 });
  });

  it('矿车骑乘：mountedCenter=Bottom−21−PlayerOffset(8)（Player.cs:3189-3199）', () => {
    const p = mkPlayer(100, 200);
    ride(p, 6);                             // 矿车（SetAsMinecart playerYOffsets=8）
    p.facing = 1;
    p.useTime = 8;
    hold(p, 2289);
    // mountedCenter = (110, 242−21−8)=(110,213)（非盒中心 221）→ 竿尖 (153,177)
    expect(fishingPoleTipStart(p, 2289)).toEqual({ x: 153, y: 213 - 36 });
  });
});

// ============================================================
// 数据面：mount 54 表前置数据（vanilla-mounts.json）
// ============================================================
describe('坐骑数据前置（MOUNT_DATA）', () => {
  it('mount 54 迅猛龙存在且 bodyFrame=0（ApplyItemPositionOffsetFromMount 表宿主）', () => {
    expect(MOUNT_DATA['54']).toBeTruthy();
    expect(MOUNT_DATA['54'].bodyFrame).toBe(0);
  });
});

// ============================================================
// ⑤ fixedUpdate 集成：pulley 进态/维持/离绳（Player.cs:25801-26177 可达子集）
// ============================================================
function makeGame(w: World): GameHooks {
  return {
    world: w, player: null as unknown, enemies: () => [], critters: () => [],
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
  } as unknown as GameHooks;
}
function ropeWorld(): World {
  const w = new World(100, 100, 30, 'open');
  for (let y = 30; y <= 60; y++) w.store.setTileSilent(50, y, ROPE);
  return w;
}
const stepP = (p: Player, game: GameHooks) => p.fixedUpdate(1 / 60, game);

describe('fixedUpdate 集成：pulley 悬挂（Player.cs:25801-26177）', () => {
  it('按上键进态：X 吸附绳列中心、vx=0；★BJ-C8 重钉：居中档按右沿→侧挂档不离绳（:26350-26354/:26653-26661）', () => {
    const game = makeGame(ropeWorld());
    const p = new Player(800, 50 * 16, new Inventory());   // 中心列 50、头格行 49（绳）
    p.inputUp = true;    // ★BJ737-A：攀爬键=W（inputUp,:26531 controlUp;Space 并设=拒抓+跳离）
    stepP(p, game);
    expect(p.pulley).toBe(true);
    expect(p.pulleyDir).toBe(1);
    expect(p.x).toBe(50 * 16 + 8 - 10);   // 列中心档（|800−798|=2 最近）
    expect(p.vx).toBe(0);
    // ★BJ-C8（R7-F1）旧伪锚「松上键持横移 → 离绳 + vx≈1.08（:25930-25941）」翻正：
    //   居中档（pulleyDir=1）按下沿 = 侧挂档（:26350-26354 flag12）不离绳，X 钉
    //   中心+6·direction（:26653-26661），vx 恒 0（HorizontalMovement 整段不跑 :26366）
    p.inputUp = false;
    p.inputJump = false;
    p.inputX = 1;
    p.inputRight = true;
    stepP(p, game);
    expect(p.pulley).toBe(true);
    expect(p.pulleyDir).toBe(2);
    expect(p.x).toBe(50 * 16 + 8 - 10 + 6);
    expect(p.vx).toBe(0);
  });

  it('孤立绳格：进态 y 落格顶+22 + gfxOffY 跳变差（同 tick 即衰减一次），随后回 0', () => {
    const w = new World(100, 100, 30, 'open');
    w.store.setTileSilent(50, 50, ROPE);                    // 孤立单格绳
    const game = makeGame(w);
    const p = new Player(800, 810, new Inventory());        // 头格行 =(810−8)/16=50
    p.inputUp = true;
    stepP(p, game);
    expect(p.pulley).toBe(true);
    expect(p.y).toBe(50 * 16 + 22);         // 822
    // FindPulley 置 −12 后同 tick 衰减一次（原版 :25805 早于 :27695）：−12+2.5
    expect(p.gfxOffY).toBe(-9.5);
    // 持续按住：维持悬挂（vy 钉 0、y 钉格顶+22）+ gfxOffY 每 tick 衰减回 0
    for (let i = 0; i < 5; i++) { p.inputUp = true; stepP(p, game); }
    expect(p.vy).toBe(0);
    expect(p.y).toBe(822);
    expect(p.pulley).toBe(true);
    expect(p.gfxOffY).toBe(0);              // −9.5 + 4×2.5 过零截断，第 5 tick 恒 0
  });

  it('无上/下输入不进态：绳上 Space 单独不吸附、正常重力穿落（★BJ570 非 pulley 贴绳攀爬态退役）', () => {
    const game = makeGame(ropeWorld());
    const p = new Player(800, 50 * 16, new Inventory());
    p.inputJump = true;    // 仅 Space（攀爬键）——无 inputUp/inputDown
    stepP(p, game);
    expect(p.pulley).toBe(false);
    expect(p.x).toBe(800); // 无吸附
    // ★BJ570（2026-10-08）：原版绳上态=pulley 唯一（:26320 门+:26500 全链 pulley 位内）,
    // Space 单独既不吸附（jumpOnlyHeld 门,台账⑥ 登记）也无非 pulley 攀爬链（branch1
    // 门补 this.pulley）——旧「Space 单独攀爬 vy<0」=原版不存在态,判例随 BJ570 翻正:
    // 落主移动支重力穿落。攀爬入绳须 W/↑（吸附）,吸附后 Space 照常上爬（键面差异）。
    expect(p.vy).toBeGreaterThan(0);
  });
});
