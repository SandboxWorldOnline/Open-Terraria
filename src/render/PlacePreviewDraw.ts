// ★BJ557（2026-10-07）放置预览幽灵——绘制面（TileObject.DrawPreview 1:1）。
// 状态面在 core/PlacePreview.ts（Game.updateUse 逐帧写）;本文件由 Renderer 世界 pass
// tile 层尾消费（原版 TileDrawing.cs:742-747 = tile pass 最末、实体前的同层序位）。
// 世界坐标直绘（与 drawWaterfalls/drawGrandPreview 同一世界变换域,dest=world px,
// 变换管缩放/重力翻面——勿用 worldToScreen 设备域）。
import { TILE } from '../core/constants';
import { framedCellFrame } from '../world/FurnitureStyle';
import { tileTopOf } from './VanillaTiler';
import type { PlacePreviewData } from '../core/PlacePreview';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 素材面最小接口（SpriteAtlas 结构子集——vframeAt 18px 网格域/ensureVImage 直取域）。 */
export interface PvAtlas {
  vframeAt(sheet: number, fx: number, fy: number):
    { img: CanvasImageSource; sx: number; sy: number; sw: number; sh: number } | null;
  ensureVImage(path: string): CanvasImageSource | null;
}

/** 红格乘色 scratch（BJ54 _hlScr 同款：sprite 贴入 → source-in 纯红 → α0.35 叠画;
 *  XNA premultiplied Color.Red*0.7×0.5 = (89,0,0,89) source-over ≡ 纯红 α0.35）。
 *  工厂可注入（node 单测无 DOM——录制桩替换;运行时缺省 document.createElement）。 */
export interface PvScratch {
  width: number; height: number;
  getContext(): Ctx2D | null;
  source(): CanvasImageSource;
}
export type PvScratchFactory = () => PvScratch | null;

let _pvScr: PvScratch | null = null;

const defaultScratchFactory: PvScratchFactory = () => {
  if (typeof document === 'undefined') return null;   // node 单测防御（运行时恒有 DOM）
  if (!_pvScr) {
    const cv = document.createElement('canvas');
    _pvScr = {
      get width() { return cv.width; },
      set width(v: number) { cv.width = v; },
      get height() { return cv.height; },
      set height(v: number) { cv.height = v; },
      getContext: () => cv.getContext('2d'),
      source: () => cv,
    };
  }
  return _pvScr;
};

/** 逐格绘幽灵。返回实际画格数（判别面——单测以录制 ctx 计数/断言 α 与矩形）。
 *  门序（TileObject.cs:860-968）：cell 值 0（未写/锚带）跳过;1=White×0.5;2=Red×0.35;
 *  dyOff=tileTopOf（与放置渲染同源权威——vanilla DrawYOffset 同域,VanillaTiler
 *  「旧表取自 TileObjectData.DrawYOffset——该字段原版只用于放置预览虚影」判例）。 */
export function drawPlacePreview(ctx: Ctx2D, atlas: PvAtlas, pv: PlacePreviewData,
  scratchFactory: PvScratchFactory = defaultScratchFactory): number {
  let drawn = 0;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (let dy = 0; dy < pv.h; dy++) {
    for (let dx = 0; dx < pv.w; dx++) {
      const v = pv.cells[dy * pv.w + dx];
      if (v !== 1 && v !== 2) continue;
      let fx2: number, fy2: number;
      let src: { img: CanvasImageSource; sx: number; sy: number; sw: number; sh: number } | null;
      let extraX = 0;
      if (pv.pvFrame) {
        // ★BJ629 件5：五锚档族直供帧源（DrawPreview :897-899 命中档帧带切片;
        //  extraX = num13 帧宽居中偏移 :944 `(CoordinateWidth-16)/2`——442 20px 帧=−2px）
        fx2 = pv.pvFrame.fx; fy2 = pv.pvFrame.fy;
        const img = atlas.ensureVImage(`vanilla/Tiles_${pv.sheet}.png`);
        src = img ? { img, sx: fx2, sy: fy2, sw: pv.pvFrame.sw, sh: pv.pvFrame.sh } : null;
        extraX = pv.pvFrame.dx ?? 0;
      } else if (pv.fx !== undefined && pv.fy !== undefined) {
        // 1×1 特例（火把）：22px 步长帧直取（18px 网格 vframeAt 域外）
        fx2 = pv.fx; fy2 = pv.fy;
        const img = atlas.ensureVImage(`vanilla/Tiles_${pv.sheet}.png`);
        src = img ? { img, sx: fx2, sy: fy2, sw: 16, sh: 16 } : null;
      } else {
        // ★BJ754 TF-11（2026-11-02,issue#39）：圣诞树 171 幽灵源 = 16px 紧排网格
        //  （TileObjectData.cs:2168-2170 CoordinateWidth 16+Padding 0;DrawPreview
        //  :893-897 (cw+cp)*i 同式）——放置帧带是裸索引域（PlaceXmasTree_Direct）
        //  不能直接喂 vframeAt,此处按 16px 步长取样（Tiles_171 ≡ Xmas_0 64×128）。
        if (pv.sheet === 171) {
          fx2 = dx * 16; fy2 = dy * 16;
        } else {
          const [bx, by] = framedCellFrame(pv.sheet, pv.fw, pv.style, dx, dy);
          fx2 = bx; fy2 = by;
        }
        src = atlas.vframeAt(pv.sheet, fx2, fy2);   // 落空回退面由调用域 vmeta 缺失=跳过（vanilla 同帧取不到不画）
      }
      if (!src) continue;
      const dyOff = tileTopOf(pv.sheet, fx2, fy2);
      const px = (pv.ax + dx) * TILE + extraX;
      const py = (pv.ay + dy) * TILE + dyOff;
      if (v === 1) {
        ctx.globalAlpha = 0.5;                      // Color.White * 0.5（TileObject.cs:913）
        ctx.drawImage(src.img, src.sx, src.sy, src.sw, src.sh, px, py, src.sw, src.sh);
      } else {
        const scr = scratchFactory();
        if (!scr) continue;
        if (scr.width !== src.sw || scr.height !== src.sh) {
          scr.width = src.sw; scr.height = src.sh;
        }
        const sc = scr.getContext();
        if (!sc) continue;
        sc.globalCompositeOperation = 'source-over';
        sc.clearRect(0, 0, src.sw, src.sh);
        sc.drawImage(src.img, src.sx, src.sy, src.sw, src.sh, 0, 0, src.sw, src.sh);
        sc.globalCompositeOperation = 'source-in';
        sc.fillStyle = 'rgb(255,0,0)';              // Color.Red（:908）
        sc.fillRect(0, 0, src.sw, src.sh);
        ctx.globalAlpha = 0.35;                     // ×0.7（:908）×0.5（:913）
        ctx.drawImage(scr.source(), 0, 0, src.sw, src.sh, px, py, src.sw, src.sh);
      }
      drawn++;
    }
  }
  ctx.restore();
  return drawn;
}
