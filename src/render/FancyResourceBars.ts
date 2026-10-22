// 原版"New"华丽资源条（FancyClassicPlayerResourcesDisplaySet）1:1 移植。
// 标杆：Terarria1456/Terraria.GameContent.UI.ResourceSets/
//   FancyClassicPlayerResourcesDisplaySet.cs（DrawLifeBar :118-168 / DrawManaBar :171-197 /
//   四 Drawer :214-290 / PrepareFields 经 PlayerStatsSnapshot.cs:21-47）
//   ResourceDrawSettings.cs Draw :26-55（逐元素：drawer 取贴图/偏移/缩放，
//   锚点按 OffsetPerDraw + 贴图尺寸×Percentile 推进，原点 = Anchor + 尺寸×Percentile）
// 布局（Main.screenWidth 系，我方 = viewW 同尺）：
//   心条锚点 (sw-300+4, 15)（_drawText 时 y+6）；面板层两行（行距 28，行 2 元素偏移 10）；
//   填充层锚点 +(15,15)、每格推进 2+22px、缩放 = 填充 lerp（GetLerpValue 截断）从中
//   心生长，正在回满那颗叠加 cursorScale-1；生命果颗数 < fruitCount 的格用 Heart_Fill_B。
//   星列锚点 (sw-40, 22)；面板 Star_A/B/C（末格无 Fancy 变体）；填充 Star_Fill 22×24
//   锚点 +(15,16)、每星推进 -2+24px。
// "New"（默认）无文字；"NewWithText" 才画生命文本（DrawLifeBarText :161-169）。
import type { Player } from '../entities/Player';
import { upgradeToBitmap } from '../assets/SpriteAtlas';
import type { FlickerClock } from '../lighting/SkyColor';
import { PixelText } from '../vui/draw/PixelText';
import { Lang } from '../i18n/Lang';
import { lateImageRetry } from '../assets/lateImageRetry';

function loadTex(name: string): HTMLImageElement {
  const img = new Image();
  img.onload = () => upgradeToBitmap(img, (b) => { TEX_UPGRADES[name]?.forEach((s) => s(b)); });
  img.src = `sprites/vanilla-ui/${name}.png`;
  lateImageRetry(img, `sprites/vanilla-ui/${name}.png`);   // ★BJ705-G26 件4:迟到单发重试
  return img;
}
/** name → 持有者替换回调(t 对象字段升级为 bitmap) */
const TEX_UPGRADES: Record<string, Array<(b: ImageBitmap) => void>> = {};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Utils.GetLerpValue(a, b, x, clamped)（分段线性 + 截断） */
const lerpValue = (a: number, b: number, x: number) =>
  b === a ? 0 : clamp((x - a) / (b - a), 0, 1);

export class FancyResourceBars {
  private t: Record<string, ImageBitmap | HTMLImageElement> = {
    heartLeft: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Heart_Left'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Heart_Left'] = [(b) => { this.t['heartLeft'] = b; }]; return el; })(),          // 28×30
    heartMiddle: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Heart_Middle'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Heart_Middle'] = [(b) => { this.t['heartMiddle'] = b; }]; return el; })(),      // 24×30
    heartRight: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Heart_Right'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Heart_Right'] = [(b) => { this.t['heartRight'] = b; }]; return el; })(),        // 26×30
    heartRightFancy: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Heart_Right_Fancy'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Heart_Right_Fancy'] = [(b) => { this.t['heartRightFancy'] = b; }]; return el; })(), // 36×38（末格华丽帽）
    heartFill: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Heart_Fill'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Heart_Fill'] = [(b) => { this.t['heartFill'] = b; }]; return el; })(),          // 22×22
    heartFillHoney: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Heart_Fill_B'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Heart_Fill_B'] = [(b) => { this.t['heartFillHoney'] = b; }]; return el; })(),   // 22×22（生命果金填充）
    heartSingle: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Heart_Single_Fancy'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Heart_Single_Fancy'] = [(b) => { this.t['heartSingle'] = b; }]; return el; })(), // 36×38（单心）
    starTop: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Star_A'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Star_A'] = [(b) => { this.t['starTop'] = b; }]; return el; })(),                // 30×26
    starMiddle: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Star_B'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Star_B'] = [(b) => { this.t['starMiddle'] = b; }]; return el; })(),             // 30×22
    starBottom: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Star_C'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Star_C'] = [(b) => { this.t['starBottom'] = b; }]; return el; })(),             // 30×28
    starSingle: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Star_Single'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Star_Single'] = [(b) => { this.t['starSingle'] = b; }]; return el; })(),        // 30×32
    starFill: (() => { const el = loadTex('UI_PlayerResourceSets_FancyClassic_Star_Fill'); TEX_UPGRADES['UI_PlayerResourceSets_FancyClassic_Star_Fill'] = [(b) => { this.t['starFill'] = b; }]; return el; })(),            // 22×24
  };

  /** 每帧绘制（游戏画布屏幕坐标） */
  draw(ctx: CanvasRenderingContext2D, p: Player, viewW: number, flicker: FlickerClock | null, drawText = false) {
    const ready = Object.values(this.t).every((i) => (i.width > 0) && i.width > 0);
    if (!ready) return;
    const cursorScale = flicker?.cursorScale ?? 1;
    // PrepareFields（PlayerStatsSnapshot.cs:21-47）
    let lifePerSegment = 20;
    let num2 = Math.floor(p.baseMaxHp / 20);
    const fruit = Math.max(0, Math.floor((p.baseMaxHp - 400) / 5));
    if (fruit > 0) {
      num2 = Math.floor(p.baseMaxHp / (20 + Math.floor(fruit / 4)));
      lifePerSegment = p.baseMaxHp / 20;
    }
    const bonus = p.maxHp - p.baseMaxHp;
    if (num2 > 0) lifePerSegment += Math.floor(bonus / num2);
    const heartRow1 = clamp(Math.floor(p.maxHp / lifePerSegment), 0, 10);
    const heartRow2 = clamp(Math.floor((p.maxHp - 200) / lifePerSegment), 0, 10);
    const lastHeartFilling = Math.floor(p.hp / lifePerSegment);
    const lastHeartPanel = heartRow1 + heartRow2 - 1;
    const manaPerStar = 20;
    const starCount = Math.floor(p.maxMana / manaPerStar);
    const lastStarFilling = Math.floor(p.mana / manaPerStar);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // ---- DrawLifeBar ----
    let vx = viewW - 300 + 4;
    let vy = 15 + (drawText ? 6 : 0);
    if (drawText) this.lifeText(ctx, p, vx - 4, vy + 3);
    const drawRow = (count: number, offset: number, ay: number) => {
      if (count <= 0) return;
      const first = offset, last = offset + count - 1;
      // 面板层（HeartPanelDrawer :236-253）
      let ax = vx, ayy = vy + ay;
      for (let idx = first; idx <= last; idx++) {
        let img = this.t.heartLeft, ox = 0, oy = 0;
        if (idx === last && idx === first) { img = this.t.heartSingle; ox = -4; oy = -4; }
        else if (idx === last && last === lastHeartPanel) { img = this.t.heartRightFancy; ox = -8; oy = -4; }
        else if (idx === last) { img = this.t.heartRight; }
        else if (idx !== first) { img = this.t.heartMiddle; }
        ctx.drawImage(img, Math.round(ax + ox), Math.round(ayy + oy));
        ax += img.width; // OffsetPerDrawByTexturePercentile = UnitX
      }
      // 填充层（HeartFillingDrawer :255-270）：锚点 +(15,15)、推进 2+22、缩放从中心。
      // ★ResourceDrawSettings.Draw（:26-55）：OffsetSpriteAnchorByTexturePercentile=(0.5,0.5)
      //  → 精灵**中心**=锚点（spriteBatch origin 语义）——曾把锚点当格子左上再 +11/+12，
      //  填充整体偏右偏下 ~11px = 用户标注"心与边框错位"（2026-08-13 修复）
      let fx = vx + 15, fy = vy + ay + 15;
      for (let idx = first; idx <= last; idx++) {
        const img = idx < fruit ? this.t.heartFillHoney : this.t.heartFill;
        let scale = lerpValue(lifePerSegment * idx, lifePerSegment * (idx + 1), p.hp);
        if (idx === lastHeartFilling && scale > 0) scale += cursorScale - 1;
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, fx - w / 2, fy - h / 2, w, h);
        fx += 2 + 22;
      }
    };
    drawRow(heartRow1, 0, 0);
    drawRow(heartRow2, 10, 28);
    // ---- DrawManaBar（DrawManaBar :171-197）----
    if (p.maxMana > 0 && !p.dead) {
      const sx = viewW - 40, sy = 22;
      // 面板层（StarPanelDrawer :272-289）：顶/中/底，按贴图高度推进
      let px = sx, py = sy;
      for (let i = 0; i < starCount; i++) {
        const first = 0, last = starCount - 1;
        let img = this.t.starTop;
        if (i === last && i === first) img = this.t.starSingle;
        else if (i === last) img = this.t.starBottom;
        else if (i !== first) img = this.t.starMiddle;
        ctx.drawImage(img, Math.round(px), Math.round(py));
        py += img.height;
      }
      // 填充层（StarFillingDrawer :282-290）：锚点 +(15,16)、推进 -2+24、中心缩放。
      // 同心条：精灵中心=锚点（origin 0.5,0.5），不再 +11/+12（2026-08-13 错位修复）
      let fx = sx + 15, fy = sy + 16;
      for (let i = 0; i < starCount; i++) {
        const img = this.t.starFill;
        let scale = lerpValue(manaPerStar * i, manaPerStar * (i + 1), p.mana);
        if (i === lastStarFilling && scale > 0) scale += cursorScale - 1;
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, fx - w / 2, fy - h / 2, w, h);
        fy += -2 + 24;
      }
    }
    ctx.restore();
  }

  /** DrawLifeBarText :161-169（仅 NewWithText） */
  private lifeText(ctx: CanvasRenderingContext2D, p: Player, x: number, y: number) {
    const cx = x + 130, cy = y - 24;
    const label = Lang.has('LegacyInterface.0') ? Lang.text('LegacyInterface.0') : '生命';
    const nums = `${p.hp}/${p.maxHp}`;
    const fullW = PixelText.measure(`${label} ${nums}`);
    const c = 255;
    const prev = ctx.textAlign;
    ctx.textAlign = 'left';
    PixelText.draw(ctx, label, cx - fullW / 2, cy, { r: c, g: c, b: c, a: c });
    ctx.textAlign = 'right';
    PixelText.draw(ctx, nums, cx + fullW / 2, cy, { r: c, g: c, b: c, a: c });
    ctx.textAlign = prev;
  }
}
