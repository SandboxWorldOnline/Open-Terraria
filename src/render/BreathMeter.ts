// 原版呼吸计（气口气泡 + 岩浆宽限火焰条）1:1 移植。
// 标杆：Terarria1456/Terraria/Main.cs:42824-42932 DrawInterface_Resources_Breath
//   锚点 L42836-42847  Top → (inventory 开 && 屏高<1000 时世界空间 +height-20)
//                        → worldToScreen(含 zoom) → (否则屏幕空间 -100) → /UIScale(本仓恒 1)
//   气泡段 L42858-42886 气泡数 = breathMax/20（默认 200/20=10）；26px 间距，
//                        x 从锚点 -125 起；部分颗 alpha=30+225r（≥30）、
//                        scale=r/4+0.75（≥0.75）；耗尽颗照画（原版无跳过分支）；
//                        y = 锚点 +32 + (22-22*scale)/2（缩小时垂直居中）；
//                        i>10 第二行（x-260, y+26）
//   火焰段 L42900-42932 槽数 = lavaMax/num7（num7=lavaMax/10，整除语义）；
//                        源矩形 quirk：Rectangle(0,0,Bubble.W,Bubble.H)——火焰的
//                        源矩形用 Bubble 尺寸（两张图同为 22×22，视觉无差，照写）
//   flag   L42829-42836 lavaTime<lavaMax 且 (lavaWet 或 breath==breathMax)
//                        → 显示火焰条而非气泡（lavaTime 宽限耗损指示）
// 字段映射：breathMax→breathMax，breath→breath，lavaMax→lavaMaxTotal
//                        （★BJ714-A:配饰 equipStats.lavaMax+坐骑 cartLavaMaxBonus
//                        聚合=原版单帧累计字段现值,含 Hell 车 +420 Mount.cs:5138;
//                        旧 equipStats 单读=骑 Hell 车 grace 窗条不显示），
// lavaTime→lavaImmuneTicks，lavaWet→inLava，ghost→dead。
// 偏差记录：gfxOffY 恒 0（gfxOffY 非零仅来自坐骑绘制偏移——坐骑系统未实装，
// 恒 0 与无坐骑的原版语义一致）；ingameOptionsWindow/InGameUI 分支未移植
// （本仓无该界面）。远端联机玩家不画气泡条**不是偏差**——原版本函数只读
// player[myPlayer]，呼吸计为本地玩家专属 UI（多人下每人只见自己的）。
import type { Player } from '../entities/Player';
import type { Camera } from './Camera';
import type { SpriteAtlas } from '../assets/SpriteAtlas';

/** 满颗判定与部分颗亮度/缩放（L42866-42878 公式，气泡/火焰共用） */
export function slotAlpha(value: number, slot: number, per: number): number {
  if (value >= slot * per) return 255;
  const r = (value - (slot - 1) * per) / per;
  return Math.max(30, Math.floor(30 + 225 * r));
}

/** 部分颗 scale = r/4+0.75（钳 ≥0.75；L42871-42875） */
export function slotScale(value: number, slot: number, per: number): number {
  if (value >= slot * per) return 1;
  const r = (value - (slot - 1) * per) / per;
  return Math.max(0.75, r / 4 + 0.75);
}

/** 第 slot 颗的画点（L42880-42885：26 间距、-125 起点、y=32+垂直居中；>10 第二行） */
export function slotXY(ax: number, ay: number, slot: number, texH: number, scale: number): { x: number; y: number } {
  const rowX = slot > 10 ? -260 : 0;
  const rowY = slot > 10 ? 26 : 0;
  return {
    x: ax + 26 * (slot - 1) + rowX - 125,
    y: ay + 32 + (texH - texH * scale) / 2 + rowY,
  };
}

/** 火焰条槽位数（L42900：num7=lavaMax/10，槽数=lavaMax/num7，整除语义；
 *  lavaMax=420 → 10 槽。lavaMax<10 原版除零/零除，护栏 0） */
export function flameSlots(lavaMax: number): number {
  const per = Math.floor(lavaMax / 10);
  if (per <= 0) return 0;
  return Math.floor(lavaMax / per);
}

/** 火焰条显示门（L42829-42836） */
export function breathFlag(lavaTime: number, lavaMax: number, lavaWet: boolean, breath: number, breathMax: number): boolean {
  return lavaTime < lavaMax && (lavaWet || breath === breathMax);
}

export class VanillaBreathMeter {
  /** 每帧绘制（游戏画布屏幕坐标，CSS px）——Renderer UI pass 调用 */
  draw(
    ctx: CanvasRenderingContext2D, p: Player, cam: Camera, viewH: number,
    atlas: SpriteAtlas | null, invOpen: boolean,
  ) {
    if (p.dead) return; // ghost（L42827 dead 早退）
    const lavaMax = p.lavaMaxTotal;   // ★BJ714-A:聚合读口（原版读 player.lavaMax 含坐骑面）
    const lavaTime = p.lavaImmuneTicks;
    const flag = breathFlag(lavaTime, lavaMax, p.inLava, p.breath, p.breathMax);
    // 锚点 1:1（L42836-42847）：
    //   vector = Top（gfxOffY 恒 0）；inventory 开 && 屏高<1000 → 世界空间 +h-20
    //   （Transform 前，随 zoom 放大）；worldToScreen 后非该分支 → 屏幕 px -100
    const invShift = invOpen && viewH < 1000;
    const wy = p.y + (invShift ? p.h - 20 : 0);
    const [ax, ayRaw] = cam.worldToScreen(p.cx, wy);
    const ay = invShift ? ayRaw : ayRaw - 100;

    const bubble = atlas?.vmisc('vanilla/Bubble.png') ?? null;
    const flame = atlas?.vmisc('vanilla/Flame.png') ?? null;
    if (p.breath < p.breathMax && !flag && bubble) { // L42858
      const slots = Math.floor(p.breathMax / 20);
      for (let i = 1; i < slots + 1; i++) { // 全画，耗尽颗不跳过（alpha 钳 30）
        const a = slotAlpha(p.breath, i, 20);
        const s = slotScale(p.breath, i, 20);
        const { x, y } = slotXY(ax, ay, i, bubble.sh, s);
        ctx.globalAlpha = a / 255; // Color(a,a,a,a)
        ctx.drawImage(bubble.img, bubble.sx, bubble.sy, bubble.sw, bubble.sh,
          x, y, bubble.sw * s, bubble.sh * s);
      }
      ctx.globalAlpha = 1;
    }
    if (lavaTime < lavaMax && flag && flame && bubble) { // L42888
      const per = Math.floor(lavaMax / 10);
      const slots = flameSlots(lavaMax);
      for (let j = 1; j < slots + 1; j++) {
        const a = slotAlpha(lavaTime, j, per);
        const s = slotScale(lavaTime, j, per);
        const { x, y } = slotXY(ax, ay, j, flame.sh, s); // Y 居中按 Flame.Height
        ctx.globalAlpha = a / 255;
        // 源矩形 quirk（L42928）：火焰源矩形取 Bubble 尺寸，照写
        ctx.drawImage(flame.img, flame.sx, flame.sy, bubble.sw, bubble.sh,
          x, y, bubble.sw * s, bubble.sh * s);
      }
      ctx.globalAlpha = 1;
    }
  }
}
