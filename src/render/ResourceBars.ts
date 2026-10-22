// 原版经典资源条（ClassicPlayerResourcesDisplaySet）1:1 移植。
// 标杆：Terarria1456/Terraria.GameContent.UI.ResourceSets/ClassicPlayerResourcesDisplaySet.cs
//   DrawLife  L33-124  生命：红心排 + 生命果金心 + "生命 hp/max" 文字
//   DrawMana  L126-182 魔力：右侧竖排星星 + "魔力" 文字
//   Draw      L26-31   UI_ScreenAnchorX = screenWidth - 800（右上角锚定）
// 亮度/缩放脉冲：每颗按 fill 比例取 num5=30+225*fill、num6=fill/4+0.75，
// 当前恢复到的那颗（flag）叠加 Main.cursorScale-1（FlickerClock.cursorScale，
// Main.cs:51896-51905 CursorColor 状态机）。
// 字段映射：statLifeMax→baseMaxHp，statLifeMax2→maxHp（含 buffs.healthBonus），
// statLife→hp，statManaMax2→maxMana，statMana→mana，ghost→dead。
import { upgradeToBitmap } from '../assets/SpriteAtlas';
import type { Player } from '../entities/Player';
import type { FlickerClock } from '../lighting/SkyColor';
import { PixelText } from '../vui/draw/PixelText';
import { Lang } from '../i18n/Lang';
import { lateImageRetry } from '../assets/lateImageRetry';

/** 生命心排布局（DrawLife L43-56 纯逻辑，供单测） */
export function classicLifeLayout(statLifeMax: number, statLifeMax2: number): {
  lifePerHeart: number;  // UIDisplay_LifePerHeart
  hearts: number;        // 总心数 = floor(statLifeMax2 / lifePerHeart)
  golden: number;        // 生命果金心数 = max(0, (statLifeMax-400)/5)（从首颗起消耗）
} {
  let num = Math.floor(statLifeMax / 20);
  let golden = Math.floor((statLifeMax - 400) / 5);
  if (golden < 0) golden = 0;
  let lifePerHeart = 20;
  if (golden > 0) {
    num = Math.floor(statLifeMax / (20 + Math.floor(golden / 4)));
    lifePerHeart = statLifeMax / 20;
  }
  const bonus = statLifeMax2 - statLifeMax; // num3：buff 生命上限增量
  lifePerHeart += bonus / num;
  return { lifePerHeart, hearts: Math.floor(statLifeMax2 / lifePerHeart), golden };
}

/** 懒加载 PNG（sprites/vanilla-ui/ 心/星贴图，22×22/22×24） */
function loadTex(name: string): HTMLImageElement {
  const img = new Image();
  img.onload = () => upgradeToBitmap(img, (b) => { UPG[name]?.forEach((cb) => cb(b)); });
  img.src = `sprites/vanilla-ui/${name}.png`;
  lateImageRetry(img, `sprites/vanilla-ui/${name}.png`);   // ★BJ705-G26 件4:迟到单发重试
  return img;
}
const UPG: Record<string, Array<(b: ImageBitmap) => void>> = {};

export class VanillaResourceBars {
  private heart: ImageBitmap | HTMLImageElement = (() => {
    const el = loadTex('Heart'); UPG['Heart'] = [(b) => { this.heart = b; }]; return el;
  })();
  private heart2: ImageBitmap | HTMLImageElement = (() => {
    const el = loadTex('Heart2'); UPG['Heart2'] = [(b) => { this.heart2 = b; }]; return el;
  })();
  private mana: ImageBitmap | HTMLImageElement = (() => {
    const el = loadTex('Mana'); UPG['Mana'] = [(b) => { this.mana = b; }]; return el;
  })();

  /** 每帧绘制（游戏画布屏幕坐标，CSS px） */
  draw(ctx: CanvasRenderingContext2D, p: Player, viewW: number, flicker: FlickerClock | null) {
    const anchorX = viewW - 800; // L28
    const cursorScale = flicker?.cursorScale ?? 1;
    this.drawLife(ctx, p, anchorX, cursorScale, flicker);
    this.drawMana(ctx, p, anchorX, cursorScale, flicker);
  }

  /** DrawLife L33-124 */
  private drawLife(
    ctx: CanvasRenderingContext2D, p: Player, anchorX: number,
    cursorScale: number, flicker: FlickerClock | null,
  ) {
    if (p.dead) return; // ghost
    const { lifePerHeart, hearts, golden: golden0 } = classicLifeLayout(p.baseMaxHp, p.maxHp);
    const lph = lifePerHeart;

    // 文字：标签左半 + 数值右半，围绕 500+13*num4 中心对齐（L61-66）
    const label = Lang.has('LegacyInterface.0') ? Lang.text('LegacyInterface.0') : '生命';
    const nums = `${p.hp}/${p.maxHp}`;
    const fullW = PixelText.measure(`${label} ${nums}`);
    const num4 = Math.min(10, Math.floor(p.maxHp / lph));
    const cx = 500 + 13 * num4 + anchorX;
    const c = flicker?.mouseTextColor ?? 255;
    const textColor = { r: c, g: c, b: c, a: c };
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    PixelText.draw(ctx, label, cx - fullW / 2, 6, textColor);
    ctx.textAlign = 'right';
    PixelText.draw(ctx, nums, cx + fullW / 2, 6, textColor);
    ctx.textAlign = prevAlign;

    let golden = golden0; // 原版在绘制循环内递减：先画的用金心（Heart2）
    const tex = this.heart, tex2 = this.heart2;
    if (!(tex.width > 0) || !(tex2.width > 0)) return;
    const W = tex.width, H = tex.height;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 1; i < hearts + 1; i++) {
      let num5 = 255, num6 = 1;
      let flag = false;
      if (p.hp >= i * lph) {
        num5 = 255;
        if (p.hp === i * lph) flag = true;
      } else {
        const num7 = (p.hp - (i - 1) * lph) / lph;
        num5 = Math.max(30, Math.floor(30 + 225 * num7));
        num6 = Math.max(0.75, num7 / 4 + 0.75);
        if (num7 > 0) flag = true;
      }
      if (flag) num6 += cursorScale - 1;
      let num8 = 0, num9 = 0;
      if (i > 10) { num8 -= 260; num9 += 26; } // 第二行（>400 上限时 20 心两排）
      const alpha = num5 * 0.9;
      const px = 500 + 26 * (i - 1) + num8 + anchorX + W / 2;
      const py = 32 + (H - H * num6) / 2 + num9 + H / 2;
      const img = golden > 0 ? (golden--, tex2) : tex;
      this.drawRes(ctx, img, px, py, num6, num5, alpha);
    }
    ctx.restore();
  }

  /** DrawMana L126-181 */
  private drawMana(
    ctx: CanvasRenderingContext2D, p: Player, anchorX: number,
    cursorScale: number, flicker: FlickerClock | null,
  ) {
    if (p.dead || p.maxMana <= 0) return; // ghost / statManaMax2<=0
    const perStar = 20;
    const label = Lang.has('LegacyInterface.2') ? Lang.text('LegacyInterface.2') : '魔力';
    const c = flicker?.mouseTextColor ?? 255;
    const textColor = { r: c, g: c, b: c, a: c };
    let num = 50;
    const labelW = PixelText.measure(label);
    if (labelW >= 45) num = Math.floor(labelW) + 5;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    PixelText.draw(ctx, label, 800 - num + anchorX, 6, textColor);
    ctx.textAlign = prevAlign;

    const tex = this.mana;
    if (!(tex.width > 0)) return;
    const W = tex.width, H = tex.height;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 1; i < Math.floor(p.maxMana / perStar) + 1; i++) {
      let num2 = 255, num3 = 1;
      let flag = false;
      if (p.mana >= i * perStar) {
        num2 = 255;
        if (p.mana === i * perStar) flag = true;
      } else {
        const num4 = (p.mana - (i - 1) * perStar) / perStar;
        num2 = Math.max(30, Math.floor(30 + 225 * num4));
        num3 = Math.max(0.75, num4 / 4 + 0.75);
        if (num4 > 0) flag = true;
      }
      if (flag) num3 += cursorScale - 1;
      const alpha = num2 * 0.9;
      const px = 775 + anchorX;
      const py = 30 + H / 2 + (H - H * num3) / 2 + 28 * (i - 1);
      this.drawRes(ctx, tex, px, py, num3, num2, alpha);
    }
    ctx.restore();
  }

  /** 中心原点 + 缩放 + 亮度/透明度绘制一颗资源图标（等价 spriteBatch.Draw origin=中心） */
  private drawRes(
    ctx: CanvasRenderingContext2D, img: ImageBitmap | HTMLImageElement,
    cx: number, cy: number, scale: number, bright: number, alpha: number,
  ) {
    ctx.save();
    ctx.globalAlpha = alpha / 255;
    ctx.filter = `brightness(${(bright / 255).toFixed(4)})`; // Color(num5,num5,num5,alpha)
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }
}
