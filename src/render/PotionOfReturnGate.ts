// 回归药水 4870 返程门纯算面（★BJ738 P01,2026-10-31,issue #28）——
// PotionOfReturnGateHelper.cs + PotionOfReturnHelper.cs + AHoverInteractionChecker.cs
// 1:1 的可测判别层;画布消费端 = Renderer.drawPotionOfReturnGates（render 2c'.2,
// 虚空透镜层 2c'.0/晶塔水晶 2c'.1 之后）,交互消费端 = Game.potionOfReturnGate*。
//
// 定谳锚（Terarria1457 亲读）:
//   · 双锚 = Player.PotionOfReturn{OriginalUse,Home}Position（:2463/:2465）——
//     DoPotionOfReturnTeleportationAndSetTheComebackPoint（:37782-37794）在
//     Spawn(RecallFromItem) 前后各快照一次 Bottom;
//   · 返程 = DoPotionOfReturnReturnToOriginalUsePosition（:37796-37807）：
//     newPos = 原锚 + Size×(−0.5,−1)（即落位后 Bottom 恰回原锚）→ Teleport(newPos,8)
//     （style 8：Item6 双端音,TeleportEffect case 8 无尘臂）+ 双锚清空;
//   · 门命中盒 = PotionOfReturnHelper.TryGetGateHitbox（:10-23）：center =
//     homePosition+(0,−21)、尺寸 24×40（CenteredRectangle）;
//   · 交互 = PotionOfReturnGateInteractionChecker（AHoverInteractionChecker）：
//     射程门=closest point of 命中盒 to player.Center 的 Simple tile 射程
//     （:15-18）;悬停=命中盒含鼠标世界位（:21-22）;DoHoverEffect（:25-28）=
//     noThrow=2 + cursorItemIcon 4870;PerformInteraction（:32）= 返程。
//     右键沿（mouseRight && mouseRightRelease,:44-50）触发并置
//     tileInteractionHappened（压制 NPC 交谈臂）。
//   · 渲染 = ReturnGatePlayerRenderer.DrawReturnGateInWorld：Entry 门（家）=
//     Extra_183、Exit 门（饮用点）= Extra_184（DrawToDrawData :107 `num =
//     (short)(gateType==EntryPoint ? 183 : 184)`）,36×368 帧栅格 = 8 帧×36×46
//     （Frame(1,8)）;帧 = (int)((tileFrameCounter[491]+X+Y)%40)/5,Exit 反序 7−n
//     （ctor :27-37）;顶点色 = Lerp(光照,White,0.5)×opacity（:109-111,本地玩家
//     opacity=1 :74）;回声×3 与 VoidLensHelper 同式（:113-125,色(127,50,127,0)·
//     scale×1.1·轨道 1..3px·α=0.3+0.1·cos）→ 复用 VoidLens.ts 回声纯函数;
//   · 光 = Lighting.AddLight(0.4,0.2,0.9)（Update :36）;尘 = SpawnReturnPortalDust
//     （:40-97,EntryPoint 含 240 号尘支,ExitPoint 双支同型,见下方 spec 注）。
//   · 地图图标 = Main.cs:57317-57370（Extra_173 出口/Extra_175 家门 + 悬停文案
//     GameUI.PotionOfReturn{Exit,Home}Portal）。
//
// 本模块全部为纯函数（无画布/无池/RNG 经形参注入）——判别测试
// tests/bj738a-potion-of-return.test.ts 钉值。

import {
  VOID_LENS_ECHO_PHASES,
  voidLensEchoAlpha, voidLensEchoAngle, voidLensEchoPulse, voidLensEchoRadius,
} from './VoidLens';

/** Extra_183/184 帧栅格：36×368 = 8 帧 × 36×46（Frame(1,8)） */
export const GATE_FW = 36;
export const GATE_FH = 46;
/** 40 tick 循环 = 8 帧 × 5t（与 VoidLens 同计数器 tileFrameCounter[491]） */
export const GATE_FRAME_WRAP = 40;

/** 门贴图心（ReturnGatePlayerRenderer :60-67 + Helper ctor :28）：
 *  锚（Bottom 语义）+(0,−21) 再 Y−2 → 最终 (x, y−23)。 */
export function potionOfReturnGateCenterOf(anchor: { x: number; y: number }): [number, number] {
  return [anchor.x, anchor.y - 23];
}

/** 门命中盒（PotionOfReturnHelper.TryGetGateHitbox :15-23）：
 *  CenteredRectangle(home+(0,−21), (24,40)) → 中心/半宽/半高表示。 */
export function potionOfReturnGateHitbox(home: { x: number; y: number }): {
  cx: number; cy: number; hw: number; hh: number;
} {
  return { cx: home.x, cy: home.y - 21, hw: 12, hh: 20 };
}

/** 命中盒含点（XNA Rectangle.Contains 语义：闭开边界 [x, x+w)） */
export function gateHitboxContains(
  hb: { cx: number; cy: number; hw: number; hh: number }, px: number, py: number,
): boolean {
  return px >= hb.cx - hb.hw && px < hb.cx + hb.hw
    && py >= hb.cy - hb.hh && py < hb.cy + hb.hh;
}

/** 命中盒上离给定点最近的点（Rectangle.ClosestPointInRect——钳到盒内） */
export function gateHitboxClosestPoint(
  hb: { cx: number; cy: number; hw: number; hh: number }, px: number, py: number,
): [number, number] {
  return [
    Math.min(Math.max(px, hb.cx - hb.hw), hb.cx + hb.hw),
    Math.min(Math.max(py, hb.cy - hb.hh), hb.cy + hb.hh),
  ];
}

/** 帧 = (int)((tileFrameCounter[491] + X + Y) % 40) / 5;ExitPoint 反序 7−n
 *  （ctor :30-36;C# 先 (int) 截断再整除 5,正数域=⌊x/5⌋;含世界像素 ⇒ 两门错相）。 */
export function potionOfReturnGateFrameOf(
  tick: number, wx: number, wy: number, isExit: boolean,
): number {
  const n = Math.floor(((tick + wx + wy) % GATE_FRAME_WRAP) / 5);
  return isExit ? 7 - n : n;
}

/** 回声轨道相位/半径/α（Helper DrawToDrawData :113-125 与 VoidLensHelper.cs:87-97
 *  逐字同式——经 VoidLens.ts 单源复用;此处仅再导出组装位）。 */
export const GATE_ECHO_PHASES = VOID_LENS_ECHO_PHASES;
export const gateEchoAlpha = voidLensEchoAlpha;
export const gateEchoAngle = voidLensEchoAngle;
export const gateEchoPulse = voidLensEchoPulse;
export const gateEchoRadius = voidLensEchoRadius;

export interface GateDustSpec {
  type: number;
  x: number; y: number;
  vx: number; vy: number;
  scale: number;
  fadeIn: number;
  /** 尘 240 支（EntryPoint B）置 noLight（noGravity 两支同置;EntryPoint A/Exit 支
   *  置 noLightEmittance——消费端按支置位,与 VoidLens 判例同承载法） */
  noLight: boolean;
  noLightEmittance: boolean;
}

/** SpawnReturnPortalDust（:40-97）1:1——RNG 经 rand 注入（原版 Main.rand 序：
 *  Next(3) 门 → Next(2) 支 → SelectRandom(86,88)/240 → Next(10,21)/Next(5,10)/
 *  NextFloat;本仓调用侧 Math.random 独立流,掷序 1:1 但流不同=既有惯例）。
 *  · 方向向量 = UnitY.RotatedByRandom(2π)×(0.5,1)（组件乘,x 半幅）——position 偏移
 *    用其 SafeNormalize,velocity/Exit 尾距用【未归一】原向量（原文如此）;
 *  · EntryPoint A（Next(2)==0）：尘 86/88、pos=心−n×Next(10,21)、
 *    v=rot(n',π/2)×2（n'=未归一向量）、pos+=v×10、v×=−1、fadeIn=0.5、
 *    noGravity+noLightEmittance;
 *  · EntryPoint B：尘 240、pos=心−n×Next(5,10)、v=rot(n',−π/2)×3、同尾、
 *    noGravity+noLight;
 *  · ExitPoint（A/B 双支同型,:66-97）：尘 86/88、pos=心、v=rot(n',−π/4)×2、
 *    pos+=n'×(20,20)、（无速度反转）、noGravity+noLightEmittance;
 *  · scale=0.5+NextFloat;customData=struct 装箱,Dust.cs :511-589 仅
 *    Player/Projectile/int 三型消费位 ⇒ 普通尘行为,不建模。 */
export function potionOfReturnGateDustSpec(
  cx: number, cy: number, isEntry: boolean, rand: () => number,
): GateDustSpec | null {
  if (rand() >= 1 / 3) return null;                      // :42/:65 Next(3)==0 门
  const branchA = rand() < 0.5;                          // :44/:67 Next(2)==0
  // RotatedByRandom(2π)（rand·2π·2−2π）;UnitY=(0,1) 旋 θ=(−sinθ,cosθ)
  const dir = rand() * Math.PI * 4 - Math.PI * 2;
  const sx0 = -Math.sin(dir) * 0.5, sy0 = Math.cos(dir); // ×(0.5,1) 组件乘
  const nl = Math.hypot(sx0, sy0) || 1;
  const nx = sx0 / nl, ny = sy0 / nl;                    // SafeNormalize（偏移用）
  const mixType = () => (rand() < 0.5 ? 86 : 88);        // SelectRandom(86,88)
  if (isEntry) {
    if (branchA) {
      // rot(v, π/2)=(−y,x)；v=未归一 (sx0,sy0)
      const type = mixType();
      const r = 10 + Math.floor(rand() * 11);            // Next(10,21)
      const vx = -sy0 * 2, vy = sx0 * 2;
      const scale = 0.5 + rand(), fadeIn = 0.5;
      return {
        type,
        x: cx - nx * r + vx * 10, y: cy - ny * r + vy * 10,   // pos+=v×10
        vx: -vx, vy: -vy,                                // v×=−1
        scale, fadeIn, noLight: false, noLightEmittance: true,
      };
    }
    const r = 5 + Math.floor(rand() * 5);                // Next(5,10)
    const vx = sy0 * 3, vy = -sx0 * 3;                   // rot(v,−π/2)=(y,−x)×3
    const scale = 0.5 + rand(), fadeIn = 0.5;
    return {
      type: 240,
      x: cx - nx * r + vx * 10, y: cy - ny * r + vy * 10,
      vx: -vx, vy: -vy,
      scale, fadeIn, noLight: true, noLightEmittance: false,
    };
  }
  // ExitPoint：A/B 双支同型（尘 86/88,pos=心,v=rot(v,−π/4)×2,尾距 +=v'×20,无反转）
  const type = mixType();
  const c = Math.SQRT1_2;                                 // cos(−π/4)=sin(−π/4)=√2/2
  const vx = (sx0 * c + sy0 * c) * 2, vy = (-sx0 * c + sy0 * c) * 2;
  const scale = 0.5 + rand(), fadeIn = 0.5;
  return {
    type,
    x: cx + sx0 * 20, y: cy + sy0 * 20,                   // pos += vector×(20,20)
    vx, vy,
    scale, fadeIn, noLight: false, noLightEmittance: true,
  };
}
