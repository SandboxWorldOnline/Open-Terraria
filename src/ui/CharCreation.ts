// 角色创建页（DOM 版；2026-08 二轮重制——页签条恢复原版 10 个一级页签 + 图标贴图直出 +
// 几何 1:1 对齐 UICharacterCreation（Terarria1457 Terraria.GameContent.UI.States，1.4.5.6/7 同构））：
//  · 面板底 = Inventory_Back13 九宫染色（Utils.DrawInvBG :2672-2691，同暂停菜单 invBgDataUrl）
//  · 角色预览 = 面板上方居中（MakeCharPreview :252-270：UICharacter 80×80 Top=-70 悬于面板上沿、
//    characterScale 1.5 → 纸娃娃 40×56 源帧 1.5x = 60×84，脚踩进面板上沿 ~2px）——全页唯一 canvas
//  · 页签条 = UIColoredImageButton 44×44 十连一级平铺（MakeCategoriesBar :732-796）：
//    原版顺序 信息/服装/发型/发色/眼睛/皮肤/衬衫/内衣/裤装/鞋子，Left = id*48（面板内 x10 起，
//    间距 48 = 44 宽 + 4 缝）；底 = CategoryPanel 常态 0.4 暗（_visibilityInactive :17）、
//    悬停 CategoryPanelBorder 金框、选中 CategoryPanelHighlight 亮底（36×36 居中）；
//    条下 UIHorizontalSeparator（Separator1 6×4 边 2 拉伸，宽 475 = 100%-25，:779-788）
//  · 页签图标 = 原版贴图直出（<img> 静态层 / tintedDataUrl 乘色 dataURL 底图层，禁 CSS mask）：
//    UIColoredImageButton.DrawSelf :52-76 层序 = 底板→悬停框→选中框→中贴图→主贴图(乘 _color)，
//    SetColor = SpriteBatch 乘色 → 本仓 canvas multiply 同式：
//      信息 = CharInfo（素贴图）；服装 = ColorCharacter 七帧剪影逐层乘当前七色
//       （:749-763 七层 UIImageFramed + _clothingStylesCategoryButton_OnUpdate :798-806）；
//      发型 = HairStyle_Arrow（中贴图，在下）+ HairStyle_Hair 乘发色（主贴图，在上）；
//      眼睛 = ColorEyeBack（中贴图，在下，:744）+ ColorEye 乘眼色；
//      其余五色钮 = ColorHair/ColorSkin/ColorShirt/ColorUndershirt/ColorPants/ColorShoes 乘当前部位色
//  · 几何（BuildPage :203-247）= 外层 500×384：面板 UIPanel 500×230（Top 50）+ 底部
//    UITextPanel 返回/创建 240×50（50%-10，VAlign 1 Top -45 → 面板下沿 9px）；
//    页签容器高 50（padding-top 4）+ 分隔线（+2）+ 中部容器 160（padding-top 3）
//  · 信息页（MakeInfoMenu :845-935）= 名字条 480×40（UICharacterNameButton CategoryPanel×White*.5）
//    + 竖排四难度钮 188×27.5 ×4（Width 40%-4、Height 1/4 无缝平铺，:886-921 追加序 旅程/经典/中核/硬核）
//    + 右侧描述气泡 280×110（CategoryPanelHighlight×LightGray*.7 :880-890，文案 LegacyMenu.29/30/31
//    + UI.CreativeDescriptionPlayer :949-967；正文 Top 15 左右 padding 20 左对齐）——
//    原版无性别行（性别走服装页签十样式），本仓同删
//  · 服装页（MakeClothStylesMenu :297-311）= UIClothStyleButton 44×80 十连
//    Left = i*46 + (i<5 ? 11 : 29)（男女组间 20px 空档）+ 组下分隔线（宽 442 @y89）+ 复制/粘贴/随机
//  · 发型页（MakeHairstylesMenu :272-304）= UIHairStyleButton 44×44 网格 10 列 46/48 栅格 + 滚动条；
//    下沿翻页箭头（TexturePackButtons 下排两帧）+ 音符随机（本仓语义：箭头=上/下一个发型、音符=随机）
//  · 颜色页（MakeHSLMenu :936-1006）= UIPanel 220×104（Top 10）内三根 HSL 滑杆（行距 30、
//    UIColoredSlider.DrawValueBar :107-164：ColorBar 178×16 @行内(22,18) + 167 枚 ColorBlip 2×8 渐变条
//    @(27,22) + ColorSlider 11×25 滑块中心 @(27+167*v, 26) + 悬停 Slider_Highlight×OurFavoriteColor
//    (255,231,69)；取值矩形 = 杆内缩 (3,4,174,8)）+ 右下 HEX 框 100×32（UIPanel 底
//    PanelBackground×(63,82,151)*.7 + PanelBorder 黑）+ 左下 复制/粘贴/随机三小钮（间距 40）
//  · 缩略图（发型 213 格/外观 10 格）= 纸娃娃管线烘一张 sprite sheet（dataURL）→
//    格子用 CSS background-position 切片（组件本身零 canvas；色变防抖 250ms 重烘）
// 数据流与回调（onCreate/onCancel/dresser 更衣窗/salon 理发窗/priceOf 报价/appearance 字段/
// 剪贴板模板）与旧版一致；探针兼容：根节点保留 .sw-char-panel、名字输入保留
// .sw-char-row input[type=text]、创建按钮保留 [data-act=create]。
import {
  type Appearance, type RGBColor, randomAppearance, DIFFICULTY_INFO,
  VALID_CLOTH_STYLES, CHAR_CREATION_HAIRS, MALE_VARIANTS, FEMALE_VARIANTS,
  hslToRgb, rgbToScaledHsl, scaledLuminosity,
  defaultVoiceVariant, defaultAppearance,
} from '../player/Appearance';
import { cycleVoiceVariant, hurtVoicePlan, autoSwitchVoiceOnGenderFlip } from '../player/PlayerVoice';
import { compositePaperDoll, dollFrame, walkFrame, clearPaperDollCache, variantSheetName } from '../player/PaperDoll';
import { bakeCells, canvasToUrl, isObjectUrl, SingleFlightBake, DelayedMask, BAKE_MASK_DELAY_MS, yieldTask, type BakeOutcome } from './charBake';   // SW-AX1 2026-09-06 / SW-BB1 2026-09-06
import { UITextures } from '../vui/assets/UITextures';
import { Lang } from '../i18n/Lang';
import { ensureVanillaKit, bindKeyboardShift } from './vanillaKit';
import { formatCopper } from './NpcDialog';
import { randomPlayerName } from '../i18n/RandomText';
import { UISfx } from '../vui/UISfx';
import { lateImageRetry, lateImageRetryDefer } from '../assets/lateImageRetry';

export interface CharCreationCallbacks {
  onCreate(a: Appearance): void;
  onCancel(): void;
}

/** 面板形态：
 *  - 默认 = 角色创建（原版 10 一级页签全量）；
 *  - dresser = 梳妆台更衣窗（Main.OpenClothesWindow Main.cs:44886——只改衣服样式与六色，
 *    不含姓名/难度/发型；发型原版归造型师）→ 页签 = 服装 + 六色（无发色）；
 *  - salon = 造型师理发窗（Main.OpenHairWindow Main.cs:44391——快照 oldHairStyle/oldHairColor）
 *    → 页签 = 发型 + 发色，确认=购买（付费改名目走 priceOf 实时显示，GameUI.BuyWithValue）；
 *    priceOf = 当前改动报价（铜币；Main.cs:43198-43211 逐行） */
export interface CharCreationOptions {
  initial?: Appearance;
  dresser?: boolean;
  hairSalon?: boolean;
  priceOf?: (a: Appearance) => number;
}

/** 页签 → 编辑部位（七色页签即部位页：点页签 = 选中该部位，页内三滑杆编辑它的颜色） */
const TAB_PART: Partial<Record<string, keyof Appearance>> = {
  hairColor: 'hairColor', eye: 'eyeColor', skin: 'skinColor', shirt: 'shirtColor',
  undershirt: 'undershirtColor', pants: 'pantsColor', shoes: 'shoeColor',
};

/** 页签悬停提示（UpdateHoverText :1944-1978 的 UI.PlayerCreateCategory* 族） */
const TAB_TIP: Record<string, string> = {
  info: 'UI.PlayerCreateCategoryInfo',
  look: 'UI.PlayerCreateCategoryBodyStyle',
  hair: 'UI.PlayerCreateCategoryHairStyle',
  hairColor: 'UI.PlayerCreateCategoryHairColor',
  eye: 'UI.PlayerCreateCategoryEyeColor',
  skin: 'UI.PlayerCreateCategorySkinColor',
  shirt: 'UI.PlayerCreateCategoryShirtColor',
  undershirt: 'UI.PlayerCreateCategoryUndershirtColor',
  pants: 'UI.PlayerCreateCategoryPantsColor',
  shoes: 'UI.PlayerCreateCategoryShoesColor',
};

/** 页签图标贴图名（Images/UI/CharCreation/*；素材树 terraria-assets/Images/UI/CharCreation
 *  已 1:1 镜像进 public/sprites/vanilla-ui/UI_CharCreation_*.png，md5 同源） */
const TAB_ICON_TEX: Partial<Record<string, string>> = {
  info: 'CharInfo', hair: 'HairStyle_Hair', hairColor: 'ColorHair', eye: 'ColorEye',
  skin: 'ColorSkin', shirt: 'ColorShirt', undershirt: 'ColorUndershirt',
  pants: 'ColorPants', shoes: 'ColorShoes',
};

/** 服装页签七层剪影的层序 = 部位顺序（_clothingStylesCategoryButton_OnUpdate :798-806） */
const LOOK_LAYERS: Array<keyof Appearance> = [
  'hairColor', 'eyeColor', 'skinColor', 'shirtColor', 'undershirtColor', 'pantsColor', 'shoeColor',
];

/** SW-BB1 D4b 2026-09-06: 烘焙前置懒载的调用侧超时。waitUi/ensureUiBatch（共享
 *  核心,SpriteAtlas.ts）无超时且【不动】——超时只作用本面板的 ensure 等待:
 *  全仓 UITextures.ensure/ensureUiBatch/waitUi 消费面仅本文件两处
 *  （ensureBakeSources 阻塞等待 + scheduleVariantPrefetch 后台 fire-and-forget）,
 *  调用侧 race 超时波及面=零。超时视作 miss 继续烘（缺格→missed→retry 链自愈,
 *  ensure 仍在后台跑,贴图晚到由重烘收口）;防「慢源悬挂→单飞永久折叠后续请求」 */
const BAKE_SOURCE_TIMEOUT_MS = 10_000;

// ================= 原版贴图小工具 =================

type Img = HTMLImageElement;
const UI_TEX = (n: string) => `sprites/vanilla-ui/UI_CharCreation_${n}.png`;
const VAN_TEX = (n: string) => `sprites/vanilla/${n}.png`;

const imgPromises = new Map<string, Promise<Img>>();
function loadImg(src: string): Promise<Img> {
  let p = imgPromises.get(src);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      // ★BJ705-G26 件4:终态 onerror 型迟到单发重试（首败不 reject,重启后再败才 reject）
      lateImageRetryDefer(img, src, () => rej(new Error('img load fail: ' + src)));
      img.src = src;
    });
    imgPromises.set(src, p);
  }
  return p;
}

/** 页签/滑杆用贴图缓存（prepareAssets 预载；未就绪时取 null，就绪后重刷） */
const iconImgs = new Map<string, Img>();
function iconImg(name: string): Img | null {
  const img = iconImgs.get(name);
  return img && img.complete && img.naturalWidth ? img : null;
}

/** 白模染色（multiply + destination-in 半透明回贴 = XNA Color*float 同乘 RGBA）→ dataURL。
 *  仅用于生成 CSS 变量/图标底图的静态染色位（面板条/气泡/分隔线/难度钮/页签图标），不落组件 canvas */
const tintDataCache = new Map<string, string>();
function tintedDataUrl(img: Img, r: number, g: number, b: number, aMul = 1): string {
  const key = `${img.src}|${r},${g},${b},${aMul}`;
  const hit = tintDataCache.get(key);
  if (hit) return hit;
  const url = bakeTint(img, 0, 0, img.naturalWidth, img.naturalHeight, r, g, b, aMul);
  tintDataCache.set(key, url);
  return url;
}

/** 帧裁剪版染色（ColorCharacter 七帧剪影逐层乘色用；同缓存键空间） */
function tintedCropDataUrl(img: Img, sx: number, sy: number, sw: number, sh: number,
  r: number, g: number, b: number): string {
  const key = `${img.src}|${sx},${sy},${sw},${sh}|${r},${g},${b}`;
  const hit = tintDataCache.get(key);
  if (hit) return hit;
  const url = bakeTint(img, sx, sy, sw, sh, r, g, b, 1);
  tintDataCache.set(key, url);
  return url;
}

function bakeTint(img: Img, sx: number, sy: number, sw: number, sh: number,
  r: number, g: number, b: number, aMul: number): string {
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingEnabled = false;
  c.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = `rgb(${r},${g},${b})`;
  c.fillRect(0, 0, sw, sh);
  c.globalCompositeOperation = 'destination-in';
  c.globalAlpha = aMul;
  c.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  return cv.toDataURL();
}

/** XNA Color.Lerp（逐通道 Round） */
const lerpC = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

const VAR_STYLE_ID = 'sw-char-vars';
function injectVars(entries: Array<[string, string]>): void {
  let st = document.getElementById(VAR_STYLE_ID);
  if (!st) {
    st = document.createElement('style');
    st.id = VAR_STYLE_ID;
    document.head.appendChild(st);
  }
  st.textContent = ':root{' + entries.map(([k, v]) => `${k}:${v};`).join('') + '}';
}

/** 页签图标贴图清单（MakeCategoriesBar 引用全量 + UIPanel/滑杆 chrome） */
const ICON_TEX_NAMES = [
  'CharInfo', 'ColorCharacter', 'HairStyle_Hair', 'HairStyle_Arrow', 'ColorEyeBack',
  'ColorEye', 'ColorHair', 'ColorSkin', 'ColorShirt', 'ColorUndershirt', 'ColorPants', 'ColorShoes',
];

/** 按钮 chrome 所需的染色底板 + 图标贴图预载（幂等；完成后给面板盖 ready 章） */
let assetsPromise: Promise<void> | null = null;
function prepareAssets(): Promise<void> {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    const [cat, hl, gray, small, sep, panelBg, panelBorder, sliderHl] = await Promise.all(
      ['CategoryPanel', 'CategoryPanelHighlight', 'PanelGrayscale', 'SmallPanel', 'Separator1',
        'UI_PanelBackground', 'UI_PanelBorder', 'UI_Slider_Highlight']
        .map((n) => loadImg(n.startsWith('UI_')
          ? `sprites/vanilla-ui/${n}.png`
          : UI_TEX(n))));
    await Promise.all(ICON_TEX_NAMES.map(async (n) => {
      try { iconImgs.set(n, await loadImg(UI_TEX(n))); } catch { /* 贴图缺失时图标留空 */ }
    }));
    const v: Array<[string, string]> = [
      ['--cc-catpanel', `url(${UI_TEX('CategoryPanel')})`],
      ['--cc-catborder', `url(${UI_TEX('CategoryPanelBorder')})`],
      ['--cc-cathl', `url(${UI_TEX('CategoryPanelHighlight')})`],
      ['--cc-smallpanel', `url(${UI_TEX('SmallPanel')})`],
      ['--cc-smallborder', `url(${UI_TEX('SmallPanelBorder')})`],
      // 名字条/外观钮：CategoryPanel × White*0.5（UICharacterNameButton.DrawSelf :62）
      ['--cc-namebar', `url(${tintedDataUrl(cat, 255, 255, 255, 0.5)})`],
      // 难度描述气泡：CategoryPanelHighlight × LightGray(211,211,211)*0.7（MakeInfoMenu :889）
      ['--cc-bubble', `url(${tintedDataUrl(hl, Math.round(211 * 0.7), Math.round(211 * 0.7), Math.round(211 * 0.7), 0.7)})`],
      // 页签条下分隔线：Separator1 × Lerp(White,(63,65,151),.85)*.9（MakeCategoriesBar :786）
      ['--cc-sep', `url(${tintedDataUrl(sep, lerpC(255, 63, 0.85), lerpC(255, 65, 0.85), lerpC(255, 151, 0.85), 0.9)})`],
      // UIPanel 底（HEX 框/HSL 面板）：PanelBackground × (63,82,151)*0.7 + PanelBorder 黑（UIPanel.cs:15-16）
      ['--cc-panelbg', `url(${tintedDataUrl(panelBg, Math.round(63 * 0.7), Math.round(82 * 0.7), Math.round(151 * 0.7), 0.7)})`],
      ['--cc-panelborder', `url(${tintedDataUrl(panelBorder, 0, 0, 0, 1)})`],
      // 滑杆悬停亮框：Slider_Highlight × OurFavoriteColor(255,231,69)（Main.cs:886 / UIColoredSlider :159）
      ['--cc-sliderhl', `url(${tintedDataUrl(sliderHl, 255, 231, 69, 1)})`],
    ];
    // 四难度钮：PanelGrayscale × Lerp(Black,color,.8)*.5 / 选中内衬 Lerp(color,White,.7)*.5
    // （UIDifficultyButton.DrawSelf :51-60；颜色表 = DIFFICULTY_INFO 同 UIDifficultyButton 传参）
    DIFFICULTY_INFO.forEach((d, i) => {
      v.push([`--cc-diff${i}`, `url(${tintedDataUrl(gray, lerpC(0, d.color.r, 0.8), lerpC(0, d.color.g, 0.8), lerpC(0, d.color.b, 0.8), 0.5)})`]);
      v.push([`--cc-diff${i}sel`, `url(${tintedDataUrl(gray, lerpC(d.color.r, 255, 0.7), lerpC(d.color.g, 255, 0.7), lerpC(d.color.b, 255, 0.7), 0.5)})`]);
    });
    injectVars(v);
    document.querySelectorAll('.sw-char-panel').forEach((p) => p.classList.add('ready'));
  })();
  return assetsPromise;
}

// ---- Inventory_Back13 九宫面板底（Utils.DrawInvBG；与 UI.ts 暂停菜单同式同染色，
//      此处独立实现——UI.ts 的 invBgDataUrl 模块私有且引它会成环） ----
let invBgImg: Img | null = null;
let invBgTinted: HTMLCanvasElement | null = null;
function invBgEnsure(): Img | null {
  if (typeof Image === 'undefined') return null;
  if (!invBgImg) {
    invBgImg = new Image();
    invBgImg.src = VAN_TEX('Inventory_Back13');
    lateImageRetry(invBgImg, VAN_TEX('Inventory_Back13'));   // ★BJ705-G26 件4
  }
  return invBgImg;
}
function invBgDataUrl(w: number, h: number): string | null {
  const img = invBgEnsure();
  if (!img || !img.complete || !img.naturalWidth) return null;
  if (!invBgTinted) {
    const t = document.createElement('canvas');
    t.width = img.naturalWidth; t.height = img.naturalHeight;
    const tc = t.getContext('2d', { willReadFrequently: true })!;
    tc.imageSmoothingEnabled = false;
    tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, t.width, t.height);
    const tmul = [33 / 255, 15 / 255, 91 / 255, 0.685];   // IngameOptions 面板色（UI.ts 同款真值）
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = Math.round(d.data[i] * tmul[0]);
      d.data[i + 1] = Math.round(d.data[i + 1] * tmul[1]);
      d.data[i + 2] = Math.round(d.data[i + 2] * tmul[2]);
      d.data[i + 3] = Math.round(d.data[i + 3] * tmul[3]);
    }
    tc.putImageData(d, 0, 0);
    invBgTinted = t;
  }
  const t = invBgTinted, W = t.width, H = t.height;
  const c = document.createElement('canvas');
  c.width = Math.max(20, Math.round(w)); c.height = Math.max(20, Math.round(h));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingEnabled = false;
  x.drawImage(t, 0, 0, 10, 10, 0, 0, 10, 10);
  x.drawImage(t, W - 10, 0, 10, 10, c.width - 10, 0, 10, 10);
  x.drawImage(t, 0, H - 10, 10, 10, 0, c.height - 10, 10, 10);
  x.drawImage(t, W - 10, H - 10, 10, 10, c.width - 10, c.height - 10, 10, 10);
  x.drawImage(t, 10, 0, 10, 10, 10, 0, c.width - 20, 10);
  x.drawImage(t, 10, H - 10, 10, 10, 10, c.height - 10, c.width - 20, 10);
  x.drawImage(t, 0, 10, 10, 10, 0, 10, 10, c.height - 20);
  x.drawImage(t, W - 10, 10, 10, 10, c.width - 10, 10, 10, c.height - 20);
  x.drawImage(t, 10, 10, 10, 10, 10, 10, c.width - 20, c.height - 20);
  return c.toDataURL();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function hex(c: RGBColor): string {
  return '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function fromHex(s: string): RGBColor {
  const v = parseInt(s.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** 静态贴图图标层（<img> 直出原版贴图，禁 mask 染色） */
function staticIcon(tex: string, w: number, h: number): HTMLImageElement {
  const img = document.createElement('img');
  img.src = UI_TEX(tex);
  img.draggable = false;
  img.className = 'sw-cc-tabimg';
  img.width = w;
  img.height = h;
  return img;
}

const CSS = `
:where(.sw-char-panel) :where(button) { font-family: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
.sw-char-panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 500px; max-width: 96vw; z-index: 20; cursor: auto;
  /* ★2026-09-16 用户实报(梳妆台更衣窗悬停/点击全死):.sw-root 是 pointer-events:none
     (UI.ts:395 防挡画布),pointer-events 可继承 ⇒ 子面板缺显式 auto 即整体对命中
     测试透明——elementFromPoint(面板任意点)=CANVAS、:hover 不可达、点击漏成世界
     输入(探针 scripts/_wardrobe-hit-test.mjs 定谳:四点全命中画布,面板 computed
     pointer-events=none)。同族先例=NpcDialog.ts:129-131(.sw-npc-dialog 同因同修)。
     标题屏角色创建页不受累:那路挂 mainFlow 根(无 pointer-events:none),只有
     showClothesWindow/showHairWindow 挂 .sw-root 的两形态中招 */
  pointer-events: auto;
  opacity: 0.9;   /* 与 .sw-vsel 选择面板同族 90% 微半透（2026-08-25 用户实报缺） */
  display: flex; flex-direction: column; align-items: center;
  color: #e8e8f4; user-select: none;
  font-family: "Fusion Pixel 12px", "Microsoft YaHei", sans-serif;
  --cc-fit: 1;   /* 手机窄/矮屏整体缩放因子(fitPanel 实测写入;桌面恒 1) */
}
.sw-char-title { font-size: 16px; color: #ffe8a0; margin-bottom: 4px;
  text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; }
/* 角色预览：面板上方居中（MakeCharPreview :252-270，1.5x → 60×84；脚踩面板上沿 ~2px）
   ——全页唯一 canvas（纸娃娃渲染管线） */
.sw-char-preview { width: 60px; height: 84px; image-rendering: pixelated; pointer-events: none;
  margin-bottom: -2px; position: relative; z-index: 1; }
/* Inventory_Back13 九宫面板底（Utils.DrawInvBG）；素材未载时退纯色。
   面板 = 500×230（BuildPage :210-222：UIPanel 500×230 Top 50） */
.sw-char-body {
  width: 500px; height: 230px; box-sizing: border-box; padding: 0 10px 14px;
  background-color: #241a56; background-repeat: no-repeat; background-size: 100% 100%;
  image-rendering: pixelated;
}
/* ---- 图标页签条（UIColoredImageButton 44×44 十连；容器高 50 含 padding-top 4，
        Left = id*48 → 面板内 x10 起、间距 48）---- */
.sw-char-tabs { position: relative; height: 50px; }
.sw-cc-tab { position: absolute; top: 4px; width: 44px; height: 44px; image-rendering: pixelated; }
.sw-cc-tab::before { content: ''; position: absolute; inset: 0; z-index: 0;
  background: var(--cc-catpanel) center / 100% 100% no-repeat; opacity: 0.4; }
.sw-cc-tab:hover::before { opacity: 1; }
.sw-cc-tab::after { content: ''; position: absolute; inset: 0; z-index: 1; opacity: 0;
  background: var(--cc-catborder) center / 100% 100% no-repeat; pointer-events: none; }
.sw-cc-tab:hover::after { opacity: 1; }
.sw-cc-tab .hl { position: absolute; inset: 0; z-index: 2; display: none; pointer-events: none;
  background: var(--cc-cathl) center / 36px 36px no-repeat; }
.sw-cc-tab.active .hl { display: block; }
/* 图标层：静态 <img> 与乘色底图层同位叠放（DrawSelf :52-76 层序 = 中贴图在下、主贴图在上） */
.sw-cc-tabimg { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 3; image-rendering: pixelated; }
.sw-cc-tinted { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 4;
  width: 30px; height: 30px; background-repeat: no-repeat; background-size: 100% 100%;
  image-rendering: pixelated; pointer-events: none; }
/* 页签条下分隔线（UIHorizontalSeparator：Separator1 边 2 拉伸；宽 475 = 100%-25） */
.sw-char-sep { height: 4px; margin-top: 2px; width: calc(100% - 5px); box-sizing: border-box;
  border: 2px solid transparent; border-image: var(--cc-sep) 2 fill stretch; image-rendering: pixelated; }
/* 中部容器（BuildPage :223-231：高 160、padding-top 3） */
.sw-char-content { height: 160px; padding-top: 3px; box-sizing: border-box; position: relative; }
/* ---- 底部宽按钮（UITextPanel：50%-10 × 50px 并排，VAlign 1 Top -45 → 面板下沿 9px）---- */
.sw-char-footer { display: flex; justify-content: space-between; width: 100%; margin-top: 9px; }
.sw-char-footer .sw-vbtn { width: calc(50% - 10px); height: 50px; font-size: 15px; letter-spacing: 2px; }
/* ---- UIPanel 九宫底（PanelBackground × (63,82,151)*.7 + PanelBorder 黑；角 12 条 4）---- */
.sw-cc-panelbg::before, .sw-cc-panelbg::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  border: 12px solid transparent; border-image: var(--cc-panelbg) 12 fill stretch; }
.sw-cc-panelbg::after { border-image: var(--cc-panelborder) 12 fill stretch; }
/* ---- 信息页（MakeInfoMenu :845-935）---- */
.sw-cc-info { position: relative; height: 100%; }
.sw-cc-namebar { position: relative; height: 40px; box-sizing: border-box; flex: none;
  display: flex; align-items: center; gap: 8px; padding: 0 4px 0 10px; cursor: text;
  border: 10px solid transparent; border-image: var(--cc-namebar) 10 fill stretch; }
.sw-cc-namebar::after { content: ''; position: absolute; inset: -10px; pointer-events: none; opacity: 0;
  border: 10px solid transparent; border-image: var(--cc-catborder) 10 fill stretch; }
.sw-cc-namebar:focus-within::after { opacity: 1; }
.sw-cc-namelbl { flex: none; color: #cfd6f4; }
.sw-cc-nameval { position: relative; flex: 1; height: 100%; display: flex; align-items: center; min-width: 0; }
.sw-cc-nameval-text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sw-cc-nameval-text.empty { color: #8b93b8; }
.sw-cc-nameval input[type=text] { position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0; border: none; padding: 0; margin: 0; background: none; cursor: text; }
/* 中段：难度列 188×110（Width 40%-4，VAlign 1）+ 气泡 280×110（Width 60%-8，右缩 4） */
.sw-cc-infolow { position: absolute; left: 0; right: 0; bottom: 0; height: 110px; }
.sw-cc-diffs { position: absolute; left: 0; top: 0; width: 188px; height: 110px;
  display: flex; flex-direction: column; }
/* 底板走 ::before（元素本身无边框）——绝对定位子层(.sel/文字)按 padding box
 *  解析,元素带 border-image 边框会把子层整体挤偏 10px（实测勘误） */
.sw-cc-diff { position: relative; flex: 1; box-sizing: border-box; image-rendering: pixelated; text-align: center; }
.sw-cc-diff::before { content: ''; position: absolute; inset: 0;
  border: 10px solid transparent; border-image: var(--cc-diffbase) 10 fill stretch; }
.sw-cc-diff::after { content: ''; position: absolute; inset: 0; opacity: 0; pointer-events: none;
  border: 10px solid transparent; border-image: var(--cc-catborder) 10 fill stretch; }
.sw-cc-diff:hover::after { opacity: 1; }
/* 选中内衬：UIDifficultyButton num=7(高<30 取 5) → x+5 y+3 w-10 h-10（:56-58） */
.sw-cc-diff .sel { position: absolute; inset: 3px 5px 5px; display: none; pointer-events: none; box-sizing: border-box;
  border: 10px solid transparent; border-image: var(--cc-diffsel) 10 fill stretch; }
.sw-cc-diff.active .sel { display: block; }
.sw-cc-difftxt { position: absolute; left: 0; right: 0; top: 4px; z-index: 1;
  text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; }
/* 描述气泡（UISlicedImage CategoryPanelHighlight×LightGray*.7；正文 Top 15 左右 20、
 *  UIText TextOriginX=0.5 水平居中 :84-85） */
.sw-cc-diffdesc { position: absolute; right: 4px; top: 0; width: 280px; height: 110px; box-sizing: border-box;
  border: 10px solid transparent; border-image: var(--cc-bubble) 10 fill stretch;
  padding: 13px 20px 0; font-size: 12px; line-height: 1.6; color: #fff; text-align: center;
  text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; }
/* ---- 服装页（MakeClothStylesMenu :297-311：44×80 十连 Left=i*46+(i<5?11:29)）---- */
.sw-cc-look { position: relative; height: 100%; }
.sw-cc-styles { position: absolute; left: 0; top: 0; width: 100%; height: 80px; }
.sw-cc-stylebtn { position: absolute; top: 0; width: 44px; height: 80px; image-rendering: pixelated; }
.sw-cc-stylebtn::before { content: ''; position: absolute; inset: 0;
  border: 10px solid transparent; border-image: var(--cc-namebar) 10 fill stretch; }
.sw-cc-stylebtn::after { content: ''; position: absolute; inset: 0; z-index: 2; opacity: 0; pointer-events: none;
  border: 10px solid transparent; border-image: var(--cc-catborder) 10 fill stretch; }
.sw-cc-stylebtn:hover::after { opacity: 1; }
.sw-cc-stylebtn .hl { position: absolute; inset: 3px; z-index: 1; display: none; pointer-events: none; box-sizing: border-box;
  border: 10px solid transparent; border-image: var(--cc-cathl) 10 fill stretch; }
.sw-cc-stylebtn.active .hl { display: block; }
/* 缩略图 = 烘焙 sprite sheet 的 background-position 切片（组件零 canvas） */
.sw-cc-thumb { position: absolute; inset: 0; background-repeat: no-repeat; image-rendering: pixelated; }
.sw-cc-stylebtn .sw-cc-thumb { z-index: 3; }
.sw-cc-looksep { position: absolute; left: 19px; top: 89px; width: 442px; height: 4px; box-sizing: border-box;
  border: 2px solid transparent; border-image: var(--cc-sep) 2 fill stretch;
  image-rendering: pixelated; pointer-events: none; }
.sw-cc-looklow { position: absolute; left: 0; right: 0; top: 106px; display: flex; justify-content: center; align-items: center; gap: 6px; }
/* ---- 语音行（梳妆台更衣窗：循环钮 + 音高滑杆；竖分隔线对齐原版钮间留白）---- */
.sw-cc-vsep { width: 2px; height: 26px; margin: 0 4px; background: rgba(255, 255, 255, 0.18); }
.sw-cc-vlbl { font-size: 12px; color: #dfe6ff; text-shadow: 1px 1px 0 #10142e; white-space: nowrap; }
.sw-cc-voicebtn { position: relative; display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px;
  background: rgba(20, 27, 62, 0.85); border: 1px solid #4a5aa0; border-radius: 3px; cursor: pointer; }
.sw-cc-voicebtn:hover { border-color: #8fa3ff; background: rgba(35, 44, 82, 0.9); }
.sw-cc-voicedot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55); }
.sw-cc-voicename { font-size: 12px; color: #fff; text-shadow: 1px 1px 0 #10142e; white-space: nowrap; }
.sw-cc-voiceslider { width: 110px; height: 14px; accent-color: #8fa3ff; cursor: pointer; }
/* ---- 小方钮（UIColoredImageButton isSmall：SmallPanel 32×32 底，常态 0.4 暗）---- */
.sw-cc-small { position: relative; width: 32px; height: 32px; image-rendering: pixelated; }
.sw-cc-small::before { content: ''; position: absolute; inset: 0; z-index: 0;
  background: var(--cc-smallpanel) center / 100% 100% no-repeat; opacity: 0.4; }
.sw-cc-small:hover::before { opacity: 1; }
.sw-cc-small::after { content: ''; position: absolute; inset: 0; z-index: 1; opacity: 0; pointer-events: none;
  background: var(--cc-smallborder) center / 100% 100% no-repeat; }
.sw-cc-small:hover::after { opacity: 1; }
.sw-cc-small > img { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 3; image-rendering: pixelated; }
/* ---- 发型页（UIHairStyleButton 44×44 网格 + 滚动）---- */
.sw-cc-hair { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; position: relative; }
/* 烘焙等待遮罩(2026-08-27 用户要求"未就绪应有 loading 转圈"):源贴图懒载+纸娃娃
   合成期间盖住网格(首访 hairSheetUrl=null 全空槽=曾像卡死);applySheetUrls 撤除 */
.sw-cc-hair.baking::before {
  content: ''; position: absolute; inset: 0; z-index: 6;
  background: rgba(10, 14, 40, 0.72);
}
.sw-cc-hair.baking::after {
  content: ''; position: absolute; left: 50%; top: 42%; width: 22px; height: 22px;
  margin: -11px 0 0 -11px; z-index: 7;
  border: 3px solid #7d92d6; border-top-color: #ffd76e;
  animation: sw-cc-bakespin 0.9s steps(8) infinite;
}
@keyframes sw-cc-bakespin { to { transform: rotate(360deg); } }
/* SW-AX1 2026-09-06: look 页同链烘焙遮罩(延迟 120ms 挂,快烘不闪)——只盖样式行
   10 格域(0..96px),下沿复制/粘贴/随机钮保持可点;复用 hair 页转圈动画 */
.sw-cc-look.baking::before {
  content: ''; position: absolute; left: 0; top: 0; width: 100%; height: 96px; z-index: 6;
  background: rgba(10, 14, 40, 0.72);
}
.sw-cc-look.baking::after {
  content: ''; position: absolute; left: 50%; top: 40px; width: 22px; height: 22px;
  margin: -11px 0 0 -11px; z-index: 7;
  border: 3px solid #7d92d6; border-top-color: #ffd76e;
  animation: sw-cc-bakespin 0.9s steps(8) infinite;
}
.sw-cc-hairgrid { flex: 1; min-height: 0; overflow-y: auto; display: grid;
  grid-template-columns: repeat(10, 44px); gap: 4px 2px; justify-content: center; align-content: start;
  padding: 2px 14px 8px 2px; scrollbar-width: thin; scrollbar-color: #4a5aa0 rgba(10, 14, 40, 0.6); }
.sw-cc-hairgrid::-webkit-scrollbar { width: 12px; }
.sw-cc-hairgrid::-webkit-scrollbar-track { background: rgba(10, 14, 40, 0.6); }
.sw-cc-hairgrid::-webkit-scrollbar-thumb { background: #4a5aa0; border: 2px solid #232c52; }
.sw-cc-hairbtn { position: relative; width: 44px; height: 44px; image-rendering: pixelated; }
.sw-cc-hairbtn::before { content: ''; position: absolute; inset: 0; z-index: 0;
  background: var(--cc-catpanel) center / 100% 100% no-repeat; opacity: 0.4; }
.sw-cc-hairbtn:hover::before { opacity: 1; }
/* 层序对齐 UIHairStyleButton.DrawSelf :56-76 = 底板(::before) → 选中亮底(.hl，
 *  CategoryPanelHighlight 36×36 不透明圆角块，居中) → 悬停框(::after) → 头像最后画在最上。
 *  亮底必须在头像之下：原版亮块不透明，画在头像上会把缩略图整个盖死（2026-08 实测勘误） */
.sw-cc-hairbtn .hl { position: absolute; inset: 0; z-index: 1; display: none; pointer-events: none;
  background: var(--cc-cathl) center / 36px 36px no-repeat; }
.sw-cc-hairbtn.active .hl { display: block; }
.sw-cc-hairbtn::after { content: ''; position: absolute; inset: 0; z-index: 2; opacity: 0; pointer-events: none;
  background: var(--cc-catborder) center / 100% 100% no-repeat; }
.sw-cc-hairbtn:hover::after { opacity: 1; }
.sw-cc-hairbtn .sw-cc-thumb { z-index: 3; }
.sw-cc-hairlow { flex: none; height: 34px; margin-top: 6px; display: flex; justify-content: center; align-items: center; gap: 12px; }
.sw-cc-arrow { position: relative; width: 32px; height: 32px; image-rendering: pixelated; }
.sw-cc-arrow:hover { outline: 2px solid #ffe745; }
.sw-cc-arrowico { position: absolute; inset: 0; image-rendering: pixelated;
  background-image: url(sprites/vanilla-ui/UI_TexturePackButtons.png); background-repeat: no-repeat; }
/* ---- 颜色页（MakeHSLMenu :936-1006；容器 220 宽居中，滑杆面板 220×104 Top 10）---- */
.sw-cc-color { position: relative; width: 220px; height: 100%; margin: 0 auto; }
.sw-cc-hslpanel { position: absolute; left: 0; top: 10px; width: 220px; height: 104px; }
/* 三根 HSL 滑杆（行距 30；杆 = ColorBar 178×16 @行内(22,18)，渐变条 167×2×8 @(27,22)） */
.sw-cc-slider { position: absolute; left: 0; width: 210px; height: 30px; cursor: pointer; touch-action: none; }
.sw-cc-sliderbar { position: absolute; left: 22px; top: 18px; width: 178px; height: 16px; image-rendering: pixelated;
  background: url(sprites/vanilla/ColorBar.png) 0 0 / 100% 100% no-repeat; }
.sw-cc-sliderhl { position: absolute; left: 22px; top: 18px; width: 178px; height: 16px; image-rendering: pixelated;
  background: var(--cc-sliderhl) 0 0 / 100% 100% no-repeat; opacity: 0; pointer-events: none; }
.sw-cc-slider:hover .sw-cc-sliderhl { opacity: 1; }
.sw-cc-sliderfill { position: absolute; left: 27px; top: 22px; width: 167px; height: 8px; }
/* 滑块 ColorSlider 11×25：中心 @(27+167*v, 26)（DrawValueBar :160-162 origin=中心） */
.sw-cc-sliderknob { position: absolute; top: 13.5px; width: 11px; height: 25px; margin-left: -5.5px;
  image-rendering: pixelated; pointer-events: none; }
/* HEX 框 100×32（UIPanel 底）右下 + 三小钮左下（间距 40） */
.sw-cc-hex { position: absolute; right: 0; bottom: 0; width: 100px; height: 32px; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; letter-spacing: 1px; color: #fff; user-select: text; cursor: text;
  text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; }
.sw-cc-hex > span { position: relative; z-index: 1; }
.sw-cc-colorlow { position: absolute; left: 0; bottom: 0; width: 112px; height: 32px; }
.sw-cc-colorlow .sw-cc-small { position: absolute; bottom: 0; }
/* ---- 手机适配(2026-08-25,加法式覆盖,桌面 ≥1024×768 全不命中)----
   内部全部绝对定位像素常量(页签 48 pitch/发型网格 10 列/滑杆 178),逐元素重排
   回归风险高 → 窄屏(max-width:700)或矮屏(max-height:560,横屏手机 ~390 高)
   整体 transform scale(--cc-fit,JS 按布局尺寸实测);max-width:none 放开 96vw
   让布局恒 500 宽、缩放全权交给 --cc-fit。input 16px 防 iOS 聚焦自动放大。
   translate(独立属性)消费键盘遮挡补偿 --kb-shift(vanillaKit.bindKeyboardShift),
   先于 transform 叠加、互不打架 */
@media (max-width: 700px), (max-height: 560px) {
  .sw-char-panel {
    transform: translate(-50%, -50%) scale(var(--cc-fit));
    transform-origin: center; max-width: none;
    translate: 0 var(--kb-shift, 0px);
    transition: translate .15s;
  }
  .sw-char-panel input[type=text] { font-size: 16px; }
}
`;

export class CharCreation {
  private panel: HTMLElement;          // 根容器（保留 .sw-char-panel 类 = 探针锚点）
  private appearance: Appearance;
  private clipboard: Appearance | null = null;
  /** ★BJ732-A:语音↔性别自动跟随的旧性别追踪(原版 _oldMaleForVoiceAutoSwitch :136
   *  缺省 true;SW 兼更衣窗——构造时按底稿性别初始化,新建路径 default 男=true 同构) */
  private voiceAutoSwitchPrevMale = true;
  private previewCanvas: HTMLCanvasElement;
  private previewCtx: CanvasRenderingContext2D;
  private raf = 0;
  private time = 0;
  private content: HTMLElement;
  private tab = 'info';
  private dresser = false;   // 梳妆台更衣窗形态（服装+六色页签，确认=更改）
  private salon = false;     // 造型师理发窗形态（发型+发色，确认=付费购买）
  private priceOf: ((a: Appearance) => number) | null = null;
  /** 当前颜色页编辑的部位 = 所选颜色页签（原版 _selectedPicker） */
  private colorPart: keyof Appearance = 'hairColor';
  private hsl: [number, number, number] = [0, 0, 0];
  private hexLabel: HTMLElement | null = null;
  private sliderFills: Array<HTMLElement | null> = [null, null, null];
  private sliderKnobs: Array<HTMLElement | null> = [null, null, null];
  /** 页签乘色图标层登记表（贴图 + 部位 + 可选帧裁剪；颜色变化时重烘 dataURL） */
  private tintLayers: Array<{ elm: HTMLElement; tex: string; part: keyof Appearance; crop?: [number, number, number, number] }> = [];
  private iconTintRaf = 0;
  /** 烘焙缩略图 sprite sheet（URL；格子 background-position 切片。
   *  SW-AX1: sheet 由 toDataURL 换 toBlob+objectURL（同步 PNG 编码下放编码线程,
   *  440×968 实测 85ms 主线程阻塞），旧 URL 换新时 revoke（见 setSheetUrl） */
  private hairSheetUrl: string | null = null;
  private lookSheetUrl: string | null = null;
  private sheetTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private lastHex = '';
  // ---- SW-AX1 2026-09-06: 烘焙单飞 + 延迟 loading 态 + 变体预抢 ----
  /** 单飞烘焙调度（randomize 直调 bakeSheets 与 buildLook/buildHair 尾
   *  scheduleSheetBake(0) 双入口在此折叠；同态快照键=不尾随重烘）。
   *  SW-BB1 D1 2026-09-06: 落地账（键同∧洁净=跳过不重烘；不洁/强制通道保自愈）——
   *  runBakeSheets 按 BakeOutcome 回传洁净度,run 异常由单飞侧记不洁 */
  private bakeRunner = new SingleFlightBake(
    () => this.runBakeSheets(),
    () => this.bakeStateKey(),
    () => this.panel.isConnected,
  );
  /** SW-BB1 D1: 重试链强制重烘标记——scheduleThumbRetry 挂上、scheduleSheetBake
   *  消费（走 forceRequest 绕过落地账跳过,防死 sheet 被同键跳过永不自愈） */
  private bakeForceNext = false;
  /** 烘焙 loading 遮罩（延迟 120ms 挂——快烘不闪，慢烘可见；无旧 sheet 的首访立即挂，
   *  保持 2026-08-27 行为）。apply 映射到当前页容器 class，双页都摘防切页残留 */
  private bakeMask = new DelayedMask(BAKE_MASK_DELAY_MS, (on) => {
    for (const sel of ['.sw-cc-hair', '.sw-cc-look']) {
      this.content.querySelector(sel)?.classList.toggle('baking', on);
    }
  });
  /** 变体域预抢只发一次 */
  private sheetPrefetchDone = false;
  /** SW-BB1 D2a: 预抢被后台切走跳过时的 visibilitychange 重武装监听（一次性,
   *  触发即自摘;close 兜底摘除防孤儿监听） */
  private prefetchVisHandler: (() => void) | null = null;

  constructor(private root: HTMLElement, private cb: CharCreationCallbacks, opts: CharCreationOptions = {}) {
    ensureVanillaKit();
    this.dresser = opts.dresser === true;
    this.salon = opts.hairSalon === true;
    this.priceOf = opts.priceOf ?? null;
    this.appearance = opts.initial
      ? { ...structuredClone(opts.initial) }        // 更衣/理发窗：现外观为底稿（确认才生效）
      // ★BJ732-A 改判史（2026-10-27,用户报「受伤音效不是男/女声」）：旧=randomAppearance()
      // 每个新号出生即随机——连带其 50% 掷 voiceVariant=3「其他」（原版
      // Click_RandomizePlayer :1571-1575 仅骰子钮才掷）,用户全程手动建号也会中招且
      // 无从察觉。原版新建=固定默认（UICharacterSelect.cs:111 `new Player()` →
      // Player() 构造器 :56702 skinVariant=0/hair=0/voiceVariant=1 男声/默认色板）——
      // 改 defaultAppearance() 同构。随机外观仍是显式骰子钮（buildLook 随机入口）。
      : defaultAppearance();
    this.voiceAutoSwitchPrevMale = MALE_VARIANTS.includes(this.appearance.skinVariant ?? 0);   // ★BJ732-A:底稿性别初始化 tracker
    // 初始颜色页部位 = 各形态第一个颜色页签（更衣窗六色无发色；理发窗仅发色）
    this.colorPart = this.dresser ? 'eyeColor' : 'hairColor';
    this.syncHslFromPart();

    // 样式表每次挂载都刷新(★HMR 期守卫只建不更,旧 CSS 驻留吞变更——同 TitleMenu)
    let style = document.getElementById('sw-char-style') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'sw-char-style';
      document.head.appendChild(style);
    }
    style.textContent = CSS;

    const title = this.dresser ? Lang.text('Mods.SandboxWorld.ClothesWindow.Title')
      : this.salon ? Lang.text('GameUI.HairStyle') : '';
    this.panel = document.createElement('div');
    this.panel.className = 'sw-char-panel';
    this.panel.innerHTML = `
      ${title ? `<div class="sw-char-title">${title}</div>` : ''}
      <canvas class="sw-char-preview" width="60" height="84"></canvas>
      <div class="sw-char-body">
        <div class="sw-char-tabs"></div>
        <div class="sw-char-sep"></div>
        <div class="sw-char-content"></div>
      </div>
      <div class="sw-char-footer">
        <button class="sw-vbtn" data-act="back"></button>
        <button class="sw-vbtn" data-act="create"></button>
      </div>
    `;
    this.root.appendChild(this.panel);
    this.previewCanvas = this.panel.querySelector('.sw-char-preview')!;
    this.previewCtx = this.previewCanvas.getContext('2d')!;
    this.previewCtx.imageSmoothingEnabled = false;
    this.content = this.panel.querySelector('.sw-char-content')!;
    this.tab = this.dresser ? 'look' : this.salon ? 'hair' : 'info';

    this.buildTabs();
    this.panel.querySelector('[data-act=back]')!.addEventListener('click', () => this.close(this.cb.onCancel));
    this.panel.querySelector('[data-act=create]')!.addEventListener('click', () => {
      // 更衣窗不改姓名/难度/发型；理发窗只改发型+发色（其余全保底稿）
      if (this.dresser && opts.initial) {
        this.appearance.name = opts.initial.name;
        this.appearance.difficulty = opts.initial.difficulty;
        this.appearance.hair = opts.initial.hair;
      } else if (this.salon && opts.initial) {
        this.appearance = { ...structuredClone(opts.initial),
          hair: this.appearance.hair, hairColor: this.appearance.hairColor };
      } else {
        this.appearance.name = (this.appearance.name || '').trim() || Lang.text('Mods.SandboxWorld.CharCreate.Unnamed');
      }
      const a = this.appearance;
      this.close(() => this.cb.onCreate(a));
    });
    this.refreshFooterTexts();
    this.buildContent();
    this.loop();

    // Esc 返回
    this.escHandler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') this.close(this.cb.onCancel);
    };
    window.addEventListener('keydown', this.escHandler);
    this.unsubLang = Lang.onChange(() => this.refreshTexts());
    // 手机窄/矮屏整体等比缩放(--cc-fit;桌面断点外恒 1 逐像素不变)+键盘遮挡补偿
    requestAnimationFrame(() => this.fitPanel());
    window.addEventListener('resize', this.fitPanel);
    window.addEventListener('orientationchange', this.fitPanel);
    window.visualViewport?.addEventListener('resize', this.fitPanel);
    this.unsubKb = bindKeyboardShift(this.panel);

    // 面板底九宫：素材懒加载竞态（首次打开未就绪）时保留兜底纯色，就绪后回补
    requestAnimationFrame(() => this.applyPanelBg());
    const bg = invBgEnsure();
    if (bg && !bg.complete) bg.addEventListener('load', () => this.applyPanelBg(), { once: true });
    // 按钮 chrome 染色底板 + 页签图标贴图就绪 → 盖 ready 章 + 重刷图标/内容
    void prepareAssets().then(() => {
      if (!this.panel.isConnected) return;
      this.panel.classList.add('ready');
      this.refreshColorIcons();
      this.buildContent();
      this.applyPanelBg();
    });
  }

  private unsubLang: (() => void) | null = null;
  private unsubKb: (() => void) | null = null;

  /** 手机窄/矮屏整体等比缩放因子(媒体查询门内消费,见 CSS 尾注):
   *  offsetWidth/Height 是布局尺寸不含 transform → 测量稳定;下限 0.55 防过小。
   *  桌面 ≥断点时 s=min(1, …) ≡ 1,写同值无副作用 */
  private fitPanel = () => {
    const vv = window.visualViewport;
    const s = Math.min(
      1,
      (window.innerWidth - 16) / Math.max(1, this.panel.offsetWidth),
      ((vv?.height ?? window.innerHeight) - 16) / Math.max(1, this.panel.offsetHeight),
    );
    this.panel.style.setProperty('--cc-fit', String(Math.max(0.55, s)));
  };

  // ================= 框架 =================

  /** 页签定义（MakeCategoriesBar :732-768 原版顺序；dresser/salon 按窗口域裁剪） */
  private tabDefs(): Array<{ key: string; part?: keyof Appearance }> {
    if (this.dresser) {
      return [
        { key: 'look' },
        { key: 'eye', part: 'eyeColor' },
        { key: 'skin', part: 'skinColor' },
        { key: 'shirt', part: 'shirtColor' },
        { key: 'undershirt', part: 'undershirtColor' },
        { key: 'pants', part: 'pantsColor' },
        { key: 'shoes', part: 'shoeColor' },
      ];
    }
    if (this.salon) {
      return [
        { key: 'hair' },
        { key: 'hairColor', part: 'hairColor' },
      ];
    }
    return [
      { key: 'info' },
      { key: 'look' },
      { key: 'hair' },
      { key: 'hairColor', part: 'hairColor' },
      { key: 'eye', part: 'eyeColor' },
      { key: 'skin', part: 'skinColor' },
      { key: 'shirt', part: 'shirtColor' },
      { key: 'undershirt', part: 'undershirtColor' },
      { key: 'pants', part: 'pantsColor' },
      { key: 'shoes', part: 'shoeColor' },
    ];
  }

  /** 页签条（图标 = 原版贴图直出：静态 <img> 层 + 乘色 dataURL 底图层，禁 CSS mask）。
   *  全 10 页签按原版 Left=id*48（面板内 x10 起）；更衣/理发窗的短页签组居中（原版该二窗
   *  为独立 legacy UI 无此条，居中为本仓取齐面板中轴的呈现约定） */
  private buildTabs(): void {
    const bar = this.panel.querySelector('.sw-char-tabs')!;
    bar.innerHTML = '';
    this.tintLayers = [];
    const defs = this.tabDefs();
    const fullBar = defs.length >= 10;
    const start = fullBar ? 0 : Math.round((480 - (defs.length * 48 - 4)) / 2);
    defs.forEach((def, i) => {
      const b = el('button', 'sw-cc-tab');
      b.dataset.tab = def.key;
      b.title = Lang.text(TAB_TIP[def.key] ?? def.key);
      b.style.left = `${start + i * 48}px`;    // 面板内 x10 起、间距 48（CreateColorPicker :827-837）
      b.appendChild(el('span', 'hl'));
      if (def.key === 'info') {
        b.appendChild(staticIcon('CharInfo', 30, 30));
      } else if (def.key === 'look') {
        // 七层剪影逐层乘当前七色（:749-763 七帧 UIImageFramed 同位叠放）
        LOOK_LAYERS.forEach((part, fi) => {
          const lay = el('i', 'sw-cc-tinted');
          lay.style.width = '26px';
          lay.style.height = '34px';
          b.appendChild(lay);
          this.tintLayers.push({ elm: lay, tex: 'ColorCharacter', part, crop: [0, fi * 34, 26, 34] });
        });
      } else if (def.key === 'hair') {
        // 中贴图在下（HairStyle_Arrow）、主贴图乘发色在上（DrawSelf :69-76 层序）
        b.appendChild(staticIcon('HairStyle_Arrow', 30, 30));
        const lay = el('i', 'sw-cc-tinted');
        b.appendChild(lay);
        this.tintLayers.push({ elm: lay, tex: 'HairStyle_Hair', part: 'hairColor' });
      } else {
        if (def.key === 'eye') b.appendChild(staticIcon('ColorEyeBack', 30, 30));   // 中贴图（:744）
        const lay = el('i', 'sw-cc-tinted');
        b.appendChild(lay);
        this.tintLayers.push({ elm: lay, tex: TAB_ICON_TEX[def.key]!, part: def.part! });
      }
      b.addEventListener('click', () => {
        if (this.tab === def.key) return;
        this.tab = def.key;
        if (def.part) {                          // 颜色页签 = 选中该部位
          this.colorPart = def.part;
          this.syncHslFromPart();
        }
        UISfx.click();
        this.buildContent();
      });
      bar.appendChild(b);
    });
    this.refreshColorIcons();
  }

  /** 页签/部位乘色图标随当前外观刷新（重烘 30×30 级小图 dataURL；贴图未就绪的格子
   *  留空，由 constructor 的 prepareAssets().then 统一补刷） */
  private refreshColorIcons(): void {
    for (const lay of this.tintLayers) {
      const img = iconImg(lay.tex);
      if (!img) continue;
      const c = this.appearance[lay.part] as RGBColor;
      const url = lay.crop
        ? tintedCropDataUrl(img, lay.crop[0], lay.crop[1], lay.crop[2], lay.crop[3], c.r, c.g, c.b)
        : tintedDataUrl(img, c.r, c.g, c.b);
      lay.elm.style.backgroundImage = `url(${url})`;
    }
  }

  /** 拖色等高频路径的合帧刷新（每帧至多重烘一次图标层） */
  private queueIconTint(): void {
    if (this.iconTintRaf) return;
    this.iconTintRaf = requestAnimationFrame(() => {
      this.iconTintRaf = 0;
      if (this.panel.isConnected) this.refreshColorIcons();
    });
  }

  /** 语言切换：框架文案重取 + 内容区重建（保留 appearance 与页签） */
  private refreshTexts() {
    const title = this.panel.querySelector('.sw-char-title') as HTMLElement | null;
    if (title) {
      title.textContent = this.dresser ? Lang.text('Mods.SandboxWorld.ClothesWindow.Title')
        : Lang.text('GameUI.HairStyle');
    }
    for (const b of Array.from(this.panel.querySelectorAll('.sw-cc-tab')) as HTMLElement[]) {
      b.title = Lang.text(TAB_TIP[b.dataset.tab ?? ''] ?? '');
    }
    this.refreshFooterTexts();
    this.buildContent();
  }

  private refreshFooterTexts() {
    (this.panel.querySelector('[data-act=back]') as HTMLElement).textContent =
      this.dresser || this.salon ? Lang.text('GameUI.Cancel') : Lang.text('UI.Back');
    (this.panel.querySelector('[data-act=create]') as HTMLElement).textContent =
      this.dresser ? Lang.text('GameUI.Change') : this.salon ? '' : Lang.text('UI.Create');
    if (this.salon) this.updateSalonPrice();
  }

  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  /** 走路动画预览循环 */
  private loop = () => {
    this.time += 1 / 60;
    this.drawPreview();
    this.raf = requestAnimationFrame(this.loop);
  };

  /** 预览：面板上方居中（MakeCharPreview :252-270），1.5x = 60×84（原版 UICharacter characterScale） */
  private drawPreview() {
    const ctx = this.previewCtx;
    ctx.clearRect(0, 0, 60, 84);
    const doll = compositePaperDoll(this.appearance);
    if (!doll) return;
    const f = dollFrame(doll, walkFrame(this.time));
    // 双保险（2026-08-24）：缓存条目可能被 tintCache 满清/contextlost 清理释放——
    // detached 位图 drawImage 会抛 InvalidStateError 炸掉 rAF 帧（预览人物消失）
    try {
      if (f.img instanceof ImageBitmap && f.img.width === 0) return;
      ctx.drawImage(f.img, f.sx, f.sy, f.sw, f.sh, 0, 0, 60, 84);
    } catch { /* 本帧跳过，下帧缓存重建后自愈 */ }
  }

  /** 面板底九宫（Utils.DrawInvBG；尺寸固定，打开时合成一次） */
  private applyPanelBg() {
    const body = this.panel.querySelector('.sw-char-body') as HTMLElement | null;
    if (!body || !body.isConnected) return;
    const url = invBgDataUrl(body.offsetWidth, body.offsetHeight);
    if (url) body.style.backgroundImage = `url(${url})`;
  }

  /** fn 可选(public):外部生命周期清理(UI.closeAll/showClothesWindow 守卫,
   *  2026-08-13 泄露 review——孤儿 rAF/keydown/Lang 订阅即源于无法外部关) */
  close(fn?: () => void) {
    cancelAnimationFrame(this.raf);
    if (this.iconTintRaf) cancelAnimationFrame(this.iconTintRaf);
    if (this.sheetTimer) clearTimeout(this.sheetTimer);
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    if (this.prefetchVisHandler) {   // SW-BB1 D2a: 摘预抢重武装监听
      document.removeEventListener('visibilitychange', this.prefetchVisHandler);
      this.prefetchVisHandler = null;
    }
    this.bakeMask.disarm();      // SW-AX1: 摘遮罩+吞尾随重烘
    this.bakeRunner.cancel();
    this.revokeSheetUrls();
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    window.removeEventListener('resize', this.fitPanel);
    window.removeEventListener('orientationchange', this.fitPanel);
    window.visualViewport?.removeEventListener('resize', this.fitPanel);
    this.unsubKb?.();
    this.unsubLang?.();
    this.panel.remove();
    fn?.();
  }

  /** 理发窗购买按钮实时报价（Main.cs:43198-43246：0 改动 = GameUI.Buy「购买」；
   *  >0 = GameUI.BuyWithValue「购买({0})」——数值链在 Game.hairRestylePrice） */
  private updateSalonPrice() {
    const btn = this.panel.querySelector('[data-act=create]') as HTMLElement | null;
    if (!btn) return;
    const price = this.priceOf ? this.priceOf(this.appearance) : 0;
    btn.textContent = price > 0
      ? Lang.text('GameUI.BuyWithValue', formatCopper(price))
      : Lang.text('GameUI.Buy');
  }

  // ================= 内容区 =================

  private buildContent() {
    // 页签高亮
    this.panel.querySelectorAll('.sw-cc-tab').forEach((b) => {
      (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.tab === this.tab);
    });
    if (this.salon) this.updateSalonPrice();
    this.content.innerHTML = '';
    this.sliderFills = [null, null, null];
    this.sliderKnobs = [null, null, null];
    this.hexLabel = null;
    if (this.tab === 'info') this.buildInfo();
    else if (this.tab === 'look') this.buildLook();
    else if (this.tab === 'hair') this.buildHair();
    else this.buildColor();                    // hairColor/eye/skin/shirt/undershirt/pants/shoes
    this.refreshColorIcons();
  }

  /** 缩略图懒加载补画(2026-08-13 枚举 review):纸娃娃贴图晚到会留空白格——
   *  miss 时有界重试当前页;面板已关/用户切走页签即停 */
  private thumbRetry = 0;
  private thumbTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private scheduleThumbRetry(missed: boolean) {
    if (!missed || ++this.thumbRetry > 6 || this.thumbTimer) {
      // 重试链耗尽:撤烘焙遮罩(空槽诚实可见,不永久转圈;SW-AX1 走统一挂/摘)
      this.bakeMask.disarm();
      return;
    }
    // SW-BB1 D1 2026-09-06: 重试链重烘走强制通道(绕过落地账「键同∧洁净」跳过)
    this.bakeForceNext = true;
    this.thumbTimer = setTimeout(() => {
      this.thumbTimer = 0;
      if (!this.content.isConnected) return;                   // 面板已关
      if (this.tab !== 'look' && this.tab !== 'hair') return;  // 用户已切走
      this.buildContent();
    }, 700);
  }

  /** 32×32 小方钮（UIColoredImageButton isSmall：SmallPanel 底 + 原版 20×20 图标） */
  private smallBtn(icon: string, tipKey: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'sw-cc-small');
    b.title = Lang.text(tipKey);
    const img = document.createElement('img');
    img.src = UI_TEX(icon);
    img.draggable = false;
    b.appendChild(img);
    b.addEventListener('click', () => { UISfx.click(); fn(); });
    return b;
  }

  /** 语音箭头钮（TexturePackButtons 下排两帧 32×32——background-position 切片） */
  private arrowBtn(frameCol: 0 | 1, tipKey: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'sw-cc-arrow');
    b.title = Lang.text(tipKey);
    const ico = el('i', 'sw-cc-arrowico');
    ico.style.backgroundPosition = `-${frameCol * 32}px -32px`;
    b.appendChild(ico);
    b.addEventListener('click', () => { UISfx.click(); fn(); });
    return b;
  }

  /** 随机外观（原版 Click_RandomizePlayer :1546；本仓按形态分域：
   *  理发窗只掷发型 / 更衣窗只掷衣服样式+六色 / 创建页全掷） */
  private randomizeAppearance() {
    if (this.salon) {
      this.appearance.hair = CHAR_CREATION_HAIRS[Math.floor(Math.random() * CHAR_CREATION_HAIRS.length)];
      this.syncHslFromPart();
      this.buildContent();
      // buildContent 走发型页复用支=节点重挂滚动归零（DOM 脱离文档即丢 scrollTop）
      // ——随机后把新选中项滚回视野（2026-08-27 用户报）
      if (this.tab === 'hair') this.scrollHairTo(this.appearance.hair, true);
      return;
    }
    if (this.dresser) {
      // 更衣窗的🎲只掷衣服样式+六色（发型/难度保持不动——发型归造型师）
      const r = randomAppearance(this.appearance.name);
      this.appearance.skinVariant = r.skinVariant;
      this.appearance.shirtColor = r.shirtColor;
      this.appearance.undershirtColor = r.undershirtColor;
      this.appearance.pantsColor = r.pantsColor;
      this.appearance.shoeColor = r.shoeColor;
      this.appearance.eyeColor = r.eyeColor;
      this.appearance.skinColor = r.skinColor;
    } else {
      this.appearance = randomAppearance(this.appearance.name);
    }
    this.syncHslFromPart();
    this.queueIconTint();
    this.buildContent();
    // 随机后立即重烘当前页 sheet（buildLook/buildHair 尾部的 scheduleSheetBake(0)
    // 走 setTimeout 异步+retry 链依赖贴图重载——contextlost 清缓存后 retry 期格子
    // 全空（2026-08-24 用户实报）。同步烘一次立即出图，retry 链仍作兜底。
    // SW-AX1: 直调与 scheduleSheetBake(0) 双入口已由 bakeRunner 单飞折叠——
    // 同态快照键下第二轮不再重跑全链（此前每击随机双 ensure/双编码/双 apply）
    void this.bakeSheets();
  }

  // ================= 缩略图 sprite sheet（纸娃娃管线烘一张，格子切片消费） =================

  /** 烘焙前置:串行懒载本页所需的全部纸娃娃源贴图(2026-08-25 用户要求
   *  "懒加载+串行"——先前的"发请求→texReady 不过→重试预算"盲试链在预算耗尽后
   *  = 样式全空不恢复)。await 返回时 texReady 预检必过,烘焙一次成型 */
  private async ensureBakeSources(): Promise<void> {
    const names = new Set<string>();
    const sheets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 10, 11, 12];
    const v = this.appearance.skinVariant;
    for (const s of sheets) {
      // SW-BJ21 2026-09-07:回退源同 CopyVariant 链(5/6/7/9←4←0)——女性子变体
      // 身体通道(3 躯干肤等)烘焙取 Player_4_* 女表,预载须含之(否则门等待→重试)
      names.add(variantSheetName(v, s, (n) => UITextures.has(n)));
      names.add(`Player_0_${s}.png`);   // 女体缺通道的回退源
    }
    names.add(`Player_Hair_${this.appearance.hair + 1}.png`);
    names.add(`Player_HairAlt_${this.appearance.hair + 1}.png`);
    if (this.tab === 'hair') {
      for (const hairId of CHAR_CREATION_HAIRS) {
        names.add(`Player_Hair_${hairId + 1}.png`);
        names.add(`Player_HairAlt_${hairId + 1}.png`);
      }
    }
    // SW-BB1 D4b: 调用侧超时（10s,BAKE_SOURCE_TIMEOUT_MS 注释钉消费面清单与语义）
    let ensureTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        UITextures.ensure([...names]),
        new Promise<void>((resolve) => { ensureTimer = setTimeout(resolve, BAKE_SOURCE_TIMEOUT_MS); }),
      ]);
    } finally {
      clearTimeout(ensureTimer);   // 正路径清掉 race 败者定时器(测试环境不留悬挂句柄)
    }
  }

  /** 烘当前页所需 sheet：发型页 44×44 头像格 ×213 / 外观页 44×80 全身格 ×10。
   *  SW-AX1: 单飞入口——飞行中的重复请求折叠为同一 Promise;请求时快照键与起飞时
   *  同态不尾随重烘（randomize 直调 + buildLook/buildHair 尾 scheduleSheetBake(0)
   *  双入口;此前每击随机白跑第二轮全链） */
  private bakeSheets(): Promise<void> {
    return this.bakeRunner.request();
  }

  /** 烘焙态快照键（单飞折叠判据：sheet 只依赖页签+skinVariant+hair+七色） */
  private bakeStateKey(): string {
    const a = this.appearance;
    return [this.tab, a.skinVariant, a.hair,
      a.hairColor.r, a.hairColor.g, a.hairColor.b,
      a.skinColor.r, a.skinColor.g, a.skinColor.b,
      a.eyeColor.r, a.eyeColor.g, a.eyeColor.b,
      a.shirtColor.r, a.shirtColor.g, a.shirtColor.b,
      a.undershirtColor.r, a.undershirtColor.g, a.undershirtColor.b,
      a.pantsColor.r, a.pantsColor.g, a.pantsColor.b,
      a.shoeColor.r, a.shoeColor.g, a.shoeColor.b,
    ].join('|');
  }

  /** 换 sheet URL（SW-AX1：blob: 旧图回收；dataURL 无需） */
  private setSheetUrl(kind: 'hair' | 'look', url: string): void {
    const prev = kind === 'hair' ? this.hairSheetUrl : this.lookSheetUrl;
    if (kind === 'hair') this.hairSheetUrl = url;
    else this.lookSheetUrl = url;
    if (prev && prev !== url && isObjectUrl(prev)) URL.revokeObjectURL(prev);
  }

  private revokeSheetUrls(): void {
    for (const u of [this.hairSheetUrl, this.lookSheetUrl]) {
      if (u && isObjectUrl(u)) URL.revokeObjectURL(u);
    }
    this.hairSheetUrl = null;
    this.lookSheetUrl = null;
  }

  /** 烘焙主体（单飞内执行）。SW-BB1 D1 2026-09-06: 回传 BakeOutcome 供单飞落地账
   *  记账——'clean'=落地且自检过（同键后续 request 跳过不重烘）/'dirty'=有缺口
   *  （miss/全透明,同键必须重烘=自愈通路）/'noop'=无 sheet 页或中途放弃（不动账） */
  private async runBakeSheets(): Promise<BakeOutcome> {
    if (!this.panel.isConnected) return 'noop';
    await this.ensureBakeSources();
    if (!this.panel.isConnected) return 'noop';
    let outcome: BakeOutcome = 'noop';
    if (this.tab === 'hair') {
      const cols = 10, cell = 44;
      const rows = Math.ceil(CHAR_CREATION_HAIRS.length / cols);
      const cv = document.createElement('canvas');
      cv.width = cols * cell; cv.height = rows * cell;
      // ★SW-BM1 2026-09-06：烘焙目标保持 GPU 加速(绘制路径最快)——但其延迟命令
      //  队列若积到尾部物化点(getImageData/toBlob 发起)一次性冲刷 = 89-273ms 单
      //  长任务(探针 _bm1-cc-cellspike 多轮定谳)。治理 = afterBatch 每批 1×1 读回
      //  放血(见 bakeCells 调用),把冲刷摊进批间协作点
      const g = cv.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      // loading 态（SW-AX1）：无旧图(首访)立即遮罩（2026-08-27 行为保持），
      // 重烘延迟 120ms 挂——快烘不闪、慢烘可见
      this.bakeMask.arm(!this.hairSheetUrl);
      let missed = false;
      // ★分帧合成(2026-08-27 用户报"加载时很卡"):213 次纸娃娃合成曾整段同步阻塞
      //   主线程;bakeCells 批间 yieldTask 让出(MessageChannel 宏任务,无 setTimeout(0)
      //   嵌套 4ms 钳制税) + 批大小按耗时自适应——"不阻塞主线程"底线不回退。
      // ★单帧行模式(SW-AX1 定谳):缩略图只消费第 0 帧头部 40×44——整表合成 20 帧
      //   白烘 19 帧(213 格 ~400ms);rows{0,0} 单帧 = 1/20 合成工作量
      await bakeCells(CHAR_CREATION_HAIRS, (hairId, i) => {
        const doll = compositePaperDoll({ ...this.appearance, hair: hairId }, undefined, { rows: { body: 0, legs: 0 } });
        if (doll) g.drawImage(doll, 0, 0, 40, 44, (i % cols) * cell + 2, Math.floor(i / cols) * cell, 40, 44);
        else missed = true;
      }, {
        shouldAbort: () => !this.panel.isConnected,
        // ★SW-BM1 2026-09-06：逐批放血——1×1 读回强制物化本批命令。旧管线把 ~6000
        //  次 blit 的物化积到尾部自检/toBlob 发起点 = 单次冲刷 89-273ms 长任务;逐批
        //  放血后峰值任务 17-33ms(无 longtask),代价 = 每批 ~20-30ms 固定 GPU sync
        //  计入 wall(hair 总时长 +~50-70ms——总物化功不变,只是从单点摊到批间)。
        //  ★实测分频(累计≥12ms)更差:积量冲刷 63-340ms,弃
        afterBatch: () => { g.getImageData(0, 0, 1, 1); },
      });
      if (!this.panel.isConnected) return 'noop';   // SW-BB1 D1: 中途放弃不动落地账
      if (missed) this.scheduleThumbRetry(true);
      // ★内容自检(2026-08-25 用户实报"随机几次后样式全空")：doll 非 null 但内容全透明
      //   = 源 canvas 被静默清零(显存驱逐类)——空 sheet 挂上缩略图不重烘就永久空槽。
      //   SW-AX1 把检测前移到编码前:全透明直接弃 canvas(免 blob 白造)+清 PaperDoll
      //   缓存+重烘;旧序先 toDataURL/赋 URL 再检,retry rebuild 会把空 sheet 挂上格子
      if (!missed && await this.sheetAllTransparent(cv)) {
        clearPaperDollCache();
        this.scheduleThumbRetry(true);
        return 'dirty';   // SW-BB1 D1: 全透明=不洁落地账(同键重烘通路保留)
      }
      // SW-RB3 2026-09-06: close() 竞态窗收口——本 await(toBlob 编码 10-85ms)期间面板
      // 关闭时 revokeSheetUrls() 已跑过,落地赋值=新 blob 挂到已关面板且永无人回收
      // (唯一回收点是下次 setSheetUrl 换图/close,二者都不会再来)。落地前活性复检,
      // 已关则当场回收并放弃挂载(单飞 catch 兜底,run 正常返回)
      const hairUrl = await canvasToUrl(cv);
      if (!this.panel.isConnected) {
        if (isObjectUrl(hairUrl)) URL.revokeObjectURL(hairUrl);
        return 'noop';
      }
      this.setSheetUrl('hair', hairUrl);
      // SW-BB1 D3: 洁净落地=成功路径,重试计数清零（防「累计 6 次失败后永久停」;
      // missed/全透明=失败不清,保 6 次有界降级语义）;missed 格落地记不洁
      if (!missed) { this.thumbRetry = 0; outcome = 'clean'; }
      else outcome = 'dirty';
    } else if (this.tab === 'look') {
      const cell = 44;
      const cv = document.createElement('canvas');
      cv.width = VALID_CLOTH_STYLES.length * cell; cv.height = 80;
      // ★SW-BM1 2026-09-06：同 hair 支——GPU 目标 + afterBatch 逐批放血
      const g = cv.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      this.bakeMask.arm(!this.lookSheetUrl);
      let missed = false;
      // 单帧行模式同 hair 支（消费面 = dollFrame(doll, IDLE_FRAME) 的第 0 帧 40×56）
      await bakeCells(VALID_CLOTH_STYLES, (styleId, i) => {
        const doll = compositePaperDoll({ ...this.appearance, skinVariant: styleId }, undefined, { rows: { body: 0, legs: 0 } });
        if (doll) g.drawImage(doll, 0, 0, 40, 56, i * cell + 2, 12, 40, 56);
        else missed = true;
      }, {
        shouldAbort: () => !this.panel.isConnected,
        afterBatch: () => { g.getImageData(0, 0, 1, 1); },   // ★SW-BM1 同 hair 支逐批放血
      });
      if (!this.panel.isConnected) return 'noop';   // SW-BB1 D1: 中途放弃不动落地账
      if (missed) this.scheduleThumbRetry(true);
      // ★内容自检(2026-08-25 用户实报"随机几次后样式全空"):doll 非 null 但内容
      //   全透明 = 源 canvas 被静默清零(显存驱逐类,菜单阶段无 Renderer.onLost 扫)
      //   ——空 sheet 一旦挂上缩略图,不重烘就永久空槽。检测到全透明 → 清 PaperDoll
      //   缓存(弃掉可能已死的缓存画布)+ 重烘(retry 链有界,6 次后放弃=降级不卡死)
      if (!missed && await this.sheetAllTransparent(cv)) {
        clearPaperDollCache();
        this.scheduleThumbRetry(true);
        return 'dirty';   // SW-BB1 D1: 全透明=不洁落地账
      }
      // SW-RB3 2026-09-06: 同 hair 支——编码 await 窗内 close() 后落地会泄漏 blob
      const lookUrl = await canvasToUrl(cv);
      if (!this.panel.isConnected) {
        if (isObjectUrl(lookUrl)) URL.revokeObjectURL(lookUrl);
        return 'noop';
      }
      this.setSheetUrl('look', lookUrl);
      // SW-BB1 D3: 同 hair 支——洁净落地清重试计数;missed 格记不洁
      if (!missed) { this.thumbRetry = 0; outcome = 'clean'; }
      else outcome = 'dirty';
    } else {
      // 信息/颜色页无 sheet——只跑 ensure(预览贴图懒载),不动 URL/遮罩/落地账
      return 'noop';
    }
    this.applySheetUrls();
    this.scheduleVariantPrefetch();
    return outcome;
  }

  /** 变体域预抢（SW-AX1,后台一次）：look 页烘 10 样式格需要全部 VALID_CLOTH_STYLES
   *  变体的 Player_{v}_{s},而随机必换变体——此前每次随机都 stall 在新变体懒载
   *  (实测 13-16ms / 9-15 文件)。首烘成功 800ms 后 8 路池后台拉齐（ensureUiBatch
   *  按文件去重合流;产品态 zip warm 全 CacheStorage 命中,冷会话不抢首屏）。
   *  SW-BB1 D2a 2026-09-06: 800ms 到点时若面板在后台(document.hidden),旧码 return
   *  =该面板实例预抢永久跳过（sheetPrefetchDone 已置位）——改为挂一次性
   *  visibilitychange 重武装,回前台且面板仍在时补跑。★内存常驻面不动（RB3 量化
   *  28MB 可接受;LRU 驱逐会伤 atlas.uiimages 共享 Map 的所有消费面,明确不做） */
  private scheduleVariantPrefetch(): void {
    if (this.sheetPrefetchDone) return;
    this.sheetPrefetchDone = true;
    setTimeout(() => {
      if (!this.panel.isConnected) return;
      if (document.hidden) { this.armVariantPrefetchOnVisible(); return; }
      this.runVariantPrefetch();
    }, 800);
  }

  /** SW-BB1 D2a: 回前台重武装（hide→visible 的 visible 边沿才触发,hide 不消耗） */
  private armVariantPrefetchOnVisible(): void {
    if (this.prefetchVisHandler) return;
    const h = () => {
      if (document.hidden) return;   // 切入后台的边沿:不摘钩不消耗
      document.removeEventListener('visibilitychange', h);
      this.prefetchVisHandler = null;
      if (this.panel.isConnected) this.runVariantPrefetch();
    };
    this.prefetchVisHandler = h;
    document.addEventListener('visibilitychange', h);
  }

  private runVariantPrefetch(): void {
    const sheets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 10, 11, 12];
    const names = new Set<string>();
    for (const v of new Set<number>([...VALID_CLOTH_STYLES, ...MALE_VARIANTS, ...FEMALE_VARIANTS])) {
      for (const s of sheets) {
        names.add(variantSheetName(v, s, (n) => UITextures.has(n)));   // SW-BJ21: CopyVariant 链
        names.add(`Player_0_${s}.png`);
      }
    }
    void UITextures.ensure([...names]);
  }

  /** 全透明检测(2026-08-25):采样步进读 α,全 <α16 = 烘焙画了空气(源 canvas
   *  被静默清零)——触发缓存弃置+重烘。正常 sheet 亮像素占比高,误报可忽略。
   *  ★SW-BM1 2026-09-06 协作式分条带:旧版整面一次 getImageData(440×968)在 GPU
   *  加速管线(目标+tint 源均 GPU 化)下 = 主线程命令队列冲刷 89-273ms 单长任务
   *  (探针 _bm1-cc-cellspike 多轮:长任务时间戳与读点/toBlob 发起点逐一重合;
   *  微探针 _bm1-gid-micro H 组:同形态整读 56ms)。修 = ①小体积 tint 源画布
   *  (bakeTint/invBg) 首次 getContext 带 willReadFrequently=CPU 光栅(生效面);
   *  ②本函数 64 行分条带 + 条间 yieldTask 让出 + 首 α>16 早退(判定谓词与步进
   *  同旧版,语义不变;正常 sheet 首条带即早退,全透明病态态才付全扫+让出税)。
   *  ★不读 GPU 对象(合成 doll 画布仍 GPU 化供渲染消费)——读路径零 GPU sync。
   *  ★SW-BP1 2026-09-07 注释纠偏(RB5a 债①)：旧注「①烘焙目标…改 CPU 光栅
   *  (willReadFrequently)」有误——烘焙目标(hair/look sheet,:1097/:1151)按 SW-BM1
   *  实测权衡【保持 GPU 加速】(绘制路径最快,长任务由 afterBatch 逐批 1×1 读回
   *  放血摊销,见 bakeCells 调用点);HTML 规范同一画布首次 getContext 之后再调
   *  getContext 返回既有 context、【options 被忽略】——本函数曾传
   *  {willReadFrequently:true} 属死选项(不会把 GPU 目标降级成 CPU),已移除以免
   *  再误导(行为零变化)。 */
  private async sheetAllTransparent(cv: HTMLCanvasElement): Promise<boolean> {
    const g = cv.getContext('2d');
    if (!g) return false;
    const step = Math.max(4, Math.floor(cv.width / 100) * 4);
    const STRIP = 64;
    for (let y = 0; y < cv.height; y += STRIP) {
      const h = Math.min(STRIP, cv.height - y);
      const d = g.getImageData(0, y, cv.width, h).data;
      for (let i = 3; i < d.length; i += step * 4) {
        if (d[i] > 16) return false;
      }
      if (y + h < cv.height) await yieldTask();   // 条间让出(最后一条免让)
    }
    return true;
  }

  /** 防抖重烘（拖色每帧重烘 213 格太贵——停手 250ms 后一次烘）。
   *  SW-BB1 D1: 自愈/retry 链挂的 bakeForceNext 在此消费——强制通道绕过单飞
   *  落地账跳过;普通防抖重烘仍走 request()（键同∧洁净即复用,不重烘） */
  private scheduleSheetBake(delay = 250): void {
    if (this.sheetTimer) clearTimeout(this.sheetTimer);
    this.sheetTimer = setTimeout(() => {
      this.sheetTimer = 0;
      if (this.bakeForceNext) {
        this.bakeForceNext = false;
        void this.bakeRunner.forceRequest();
      } else {
        void this.bakeSheets();
      }
    }, delay);
  }

  /** 已挂载格子原地换 sheet（不重建网格） */
  private applySheetUrls(): void {
    this.bakeMask.disarm();   // SW-AX1: 统一挂/摘（双页防切页残留）
    if (this.hairSheetUrl) {
      const img = `url(${this.hairSheetUrl})`;
      this.content.querySelectorAll<HTMLElement>('.sw-cc-hairbtn .sw-cc-thumb')
        .forEach((t) => { t.style.backgroundImage = img; });
    }
    if (this.lookSheetUrl) {
      const img = `url(${this.lookSheetUrl})`;
      this.content.querySelectorAll<HTMLElement>('.sw-cc-stylebtn .sw-cc-thumb')
        .forEach((t) => { t.style.backgroundImage = img; });
    }
  }

  // ---- 信息页 ----

  /** 难度描述（UpdateDifficultyDescription :949-967：LegacyMenu.31/30/29 + 旅程专用键） */
  private diffDesc(d: number): string {
    return d === 0 ? Lang.text('LegacyMenu.31')
      : d === 1 ? Lang.text('LegacyMenu.30')
      : d === 2 ? Lang.text('LegacyMenu.29')
      : Lang.text('UI.CreativeDescriptionPlayer');
  }

  private buildInfo() {
    const box = el('div', 'sw-cc-info');
    // 名字条（UICharacterNameButton：480×40 长条 + 左标签 + 值区；输入走隐藏 input 捕获）
    const bar = el('div', 'sw-cc-namebar sw-char-row');
    bar.appendChild(el('span', 'sw-cc-namelbl', Lang.text('UI.PlayerNameSlot')));
    const valWrap = el('div', 'sw-cc-nameval');
    const val = el('span', 'sw-cc-nameval-text');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.value = this.appearance.name;
    input.setAttribute('aria-label', Lang.text('UI.PlayerNameSlot'));
    const syncVal = () => {
      // 空名占位（UICharacterNameButton SetContents(null) → UI.PlayerEmptyName :861）
      val.textContent = this.appearance.name || Lang.text('UI.PlayerEmptyName');
      val.classList.toggle('empty', !this.appearance.name);
    };
    syncVal();
    input.addEventListener('input', () => { this.appearance.name = input.value; syncVal(); });
    valWrap.append(val, input);
    bar.appendChild(valWrap);
    // 随机名（🎲）：取人类城镇 NPC 名字池并集随机（原版无玩家名字池——见 RandomText 注记）
    bar.appendChild(this.smallBtn('Randomize', 'Mods.SandboxWorld.CharCreate.RandomName', () => {
      input.value = randomPlayerName();
      this.appearance.name = input.value;
      syncVal();
    }));
    bar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      input.focus();
    });
    box.appendChild(bar);
    // 中段：竖排四难度钮（上→下 = 旅程/经典/中核/硬核，:886-921 追加序）+ 描述气泡
    // （原版四钮 1/4 高无缝平铺，无性别行——性别走服装页签十样式）
    const low = el('div', 'sw-cc-infolow');
    const diffs = el('div', 'sw-cc-diffs');
    const bubble = el('div', 'sw-cc-diffdesc');
    const diffBtns: HTMLButtonElement[] = [];
    for (const d of [3, 0, 1, 2]) {
      const b = el('button', 'sw-cc-diff');
      b.style.setProperty('--cc-diffbase', `var(--cc-diff${d})`);
      b.style.setProperty('--cc-diffsel', `var(--cc-diff${d}sel)`);
      b.appendChild(el('span', 'sw-cc-difftxt', Lang.text(['UI.Softcore', 'UI.Mediumcore', 'UI.Hardcore', 'UI.Creative'][d])));
      b.appendChild(el('span', 'sel'));
      b.classList.toggle('active', this.appearance.difficulty === d);
      b.addEventListener('click', () => {
        this.appearance.difficulty = d as Appearance['difficulty'];
        diffBtns.forEach((x) => x.classList.toggle('active', x === b));
        bubble.textContent = this.diffDesc(d);
        UISfx.click();
      });
      diffBtns.push(b);
      diffs.appendChild(b);
    }
    bubble.textContent = this.diffDesc(this.appearance.difficulty);
    low.append(diffs, bubble);
    box.appendChild(low);
    this.content.appendChild(box);
  }

  // ---- 服装页 ----

  /** ★BJ732-A:PlayVoicePreview 等价（UICharacterCreation.cs:1518-1528——dummy 玩家
   *  PlayHurtSound 一发,本地 (-1,-1) 无空间化）。原版三消费位:体型钮切换尾/语音循环
   *  钮/滑杆变档;SW 语音钮与滑杆既有 preview 闭包,收编本单源（buildContent 内引用）。 */
  private playVoicePreview(): void {
    const plan = hurtVoicePlan(this.appearance);
    UISfx.sfx.playWavFile(plan.files[Math.floor(Math.random() * plan.files.length)],
      plan.vol, undefined, undefined, plan.pitch);
  }

  private buildLook() {
    const box = el('div', 'sw-cc-look');
    const grid = el('div', 'sw-cc-styles');
    VALID_CLOTH_STYLES.forEach((styleId, i) => {
      const b = el('button', 'sw-cc-stylebtn');
      b.title = Lang.text('Mods.SandboxWorld.CharCreate.StyleId', styleId);
      b.style.left = `${i * 46 + (i < 5 ? 11 : 29)}px`;   // 男女组间 20px 空档（MakeClothStylesMenu :303-309）
      b.classList.toggle('active', this.appearance.skinVariant === styleId);
      // 原版层序：面板 < 高亮 < 人偶（DrawSelf 先于子层 UICharacter）→ hl 在 thumb 前
      b.appendChild(el('span', 'hl'));
      const thumb = el('i', 'sw-cc-thumb');
      thumb.style.backgroundPosition = `-${i * 44}px 0px`;
      if (this.lookSheetUrl) thumb.style.backgroundImage = `url(${this.lookSheetUrl})`;
      b.appendChild(thumb);
      b.addEventListener('click', () => {
        this.appearance.skinVariant = styleId;
        // ★BJ732-A:原版 UpdateSelectedGender（UICharacterCreation.cs:1312-1330,体型
        //  钮 Click_ClothStyle :1290-1299 尾部调用）——性别翻转时语音 1↔2 自动跟随
        //  （switch 无 case3 分支=「其他」声存活）;同性别切换不动语音;尾部恒试听。
        const male = MALE_VARIANTS.includes(styleId);
        this.appearance.voiceVariant = autoSwitchVoiceOnGenderFlip(
          this.appearance.voiceVariant, this.voiceAutoSwitchPrevMale, male) ?? undefined;   // 入参无 null ⇒ 出参 null 不可达,收窄回 Appearance 域
        this.voiceAutoSwitchPrevMale = male;
        this.playVoicePreview();   // 原版 :1312-1330 尾部 PlayVoicePreview（切体型即听当前声部）
        this.buildContent(); UISfx.click();
      });
      grid.appendChild(b);
    });
    if (!this.lookSheetUrl) box.classList.add('baking');   // SW-AX1: 首访烘焙遮罩(同 hair 页)
    box.appendChild(grid);
    // 组下分隔线（:452-460 宽 442 @y89）+ 复制/粘贴/随机外观模板（:405-430）
    box.appendChild(el('i', 'sw-cc-looksep'));
    const low = el('div', 'sw-cc-looklow');
    low.append(
      this.smallBtn('Copy', 'Mods.SandboxWorld.CharCreate.CopyTemplate', () => { this.clipboard = { ...this.appearance }; }),
      this.smallBtn('Paste', 'Mods.SandboxWorld.CharCreate.PasteTemplate', () => {
        if (!this.clipboard) return;
        this.appearance = { ...this.clipboard, name: this.appearance.name };
        this.syncHslFromPart();
        this.queueIconTint();
        this.buildContent();
      }),
      this.smallBtn('Randomize', 'Mods.SandboxWorld.CharCreate.Random', () => this.randomizeAppearance()),
    );
    // ---- 语音行（梳妆台专属：更衣窗语音循环钮 + 音高滑杆,Main.cs:45395-45410/
    // :45429-45458——CycleVoiceStyle 全树唯一调用点在更衣窗,创建页原版无此面）。
    // 切换 = CycleVoiceStyle(+1) 男→女→其他→男;每次切换/滑杆变档经 dummy 玩家
    // PlayHurtSound 预览（:45397-45407/:45449-45455 同式,本地 (-1,-1) 无空间化）
    if (this.dresser) {
      const preview = () => this.playVoicePreview();   // ★BJ732-A:收编类方法单源(原版 PlayVoicePreview 同式)
      const dot = el('i', 'sw-cc-voicedot');
      const name = el('span', 'sw-cc-voicename');
      const vbtn = el('button', 'sw-cc-voicebtn');
      vbtn.title = Lang.text('Mods.SandboxWorld.ClothesWindow.VoiceTip');
      vbtn.append(dot, name);
      const refreshVoice = () => {
        const v = this.appearance.voiceVariant
          ?? defaultVoiceVariant(this.appearance.skinVariant);   // 旧底稿缺省按性别推导(:56393)
        name.textContent = Lang.text(
          v === 1 ? 'Mods.SandboxWorld.ClothesWindow.VoiceMale'
            : v === 2 ? 'Mods.SandboxWorld.ClothesWindow.VoiceFemale'
              : 'Mods.SandboxWorld.ClothesWindow.VoiceOther');
        // PlayerVoiceID.Sets.Colors（ID/PlayerVoiceID.cs:8）：1 靛蓝/2 桃红/3 青柠
        dot.style.background = v === 1 ? '#6495ED' : v === 2 ? '#FF69B4' : '#32CD32';
      };
      refreshVoice();
      vbtn.addEventListener('click', () => {
        this.appearance.voiceVariant = cycleVoiceVariant(this.appearance.voiceVariant);
        refreshVoice();
        preview();
        UISfx.click();
      });
      // 音高滑杆：21 档量化（Round(z*20)/20 → Remap 0..1→-1..1 = 0.1 步进,
      // Main.cs:45440-45451）;变档即预览（原版同款 dummy 试听）
      const slider = document.createElement('input');
      slider.className = 'sw-cc-voiceslider';
      slider.type = 'range';
      slider.min = '-10'; slider.max = '10'; slider.step = '1';
      slider.value = String(Math.round((this.appearance.voicePitchOffset ?? 0) * 10));
      slider.title = Lang.text('Mods.SandboxWorld.ClothesWindow.VoicePitch');
      slider.setAttribute('aria-label', slider.title);
      let lastStep = Number(slider.value);
      slider.addEventListener('input', () => {
        this.appearance.voicePitchOffset = Number(slider.value) / 10;
        if (Number(slider.value) !== lastStep) {
          lastStep = Number(slider.value);
          preview();
        }
      });
      low.append(el('i', 'sw-cc-vsep'), el('span', 'sw-cc-vlbl',
        Lang.text('Mods.SandboxWorld.ClothesWindow.Voice')), vbtn, slider);
    }
    box.appendChild(low);
    this.content.appendChild(box);
    this.scheduleSheetBake(0);
  }

  // ---- 发型页 ----

  private buildHair() {
    // ★网格复用（2026-08-24 用户报"切到发型列表卡一下"）：213 格 DOM 一次性构建，
    //  再入页只更新选中态+重烘贴图（content.innerHTML='' 全量重建=每次切页签卡顿）
    const prev = this.panel.querySelector('.sw-cc-hair') as HTMLElement | null;
    if (prev) {
      this.content.appendChild(prev);
      prev.querySelectorAll('.sw-cc-hairbtn').forEach((b) => {
        b.classList.toggle('active', this.appearance.hair === Number((b as HTMLElement).dataset.hair));
      });
      this.scheduleSheetBake(0);
      return;
    }
    const box = el('div', 'sw-cc-hair');
    const grid = el('div', 'sw-cc-hairgrid');
    const cols = 10;
    CHAR_CREATION_HAIRS.forEach((hairId, i) => {
      const b = el('button', 'sw-cc-hairbtn');
      b.title = Lang.text('Mods.SandboxWorld.CharCreate.HairId', hairId);
      b.dataset.hair = String(hairId);
      b.classList.toggle('active', this.appearance.hair === hairId);
      // 原版层序（UIHairStyleButton.DrawSelf :56-76）：面板 < 选中亮底 < 悬停框 < 头像（最后画，最上）
      b.appendChild(el('span', 'hl'));
      const thumb = el('i', 'sw-cc-thumb');
      thumb.style.backgroundPosition = `-${(i % cols) * 44}px -${Math.floor(i / cols) * 44}px`;
      if (this.hairSheetUrl) thumb.style.backgroundImage = `url(${this.hairSheetUrl})`;
      b.appendChild(thumb);
      b.addEventListener('click', () => { this.setHair(hairId); UISfx.click(); });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    if (!this.hairSheetUrl) box.classList.add('baking');   // 烘焙等待遮罩(转圈)
    // 下沿：上一个 / 随机发型（Randomize 图标；原版该排为语音控件，本仓改派发型域
    // ——2026-08-27 用户报音符 icon 语义错位,改用顶排随机钮同款 UI_CharCreation_Randomize）
    const low = el('div', 'sw-cc-hairlow');
    low.append(
      this.arrowBtn(0, 'Mods.SandboxWorld.CharCreate.PrevHair', () => this.stepHair(-1)),
      this.smallBtn('Randomize', 'Mods.SandboxWorld.CharCreate.RandomHair', () => {
        this.setHair(CHAR_CREATION_HAIRS[Math.floor(Math.random() * CHAR_CREATION_HAIRS.length)], true);
      }),
      this.arrowBtn(1, 'Mods.SandboxWorld.CharCreate.NextHair', () => this.stepHair(1)),
    );
    box.appendChild(low);
    this.content.appendChild(box);
    this.scheduleSheetBake(0);
  }

  private setHair(id: number, scroll = false): void {
    this.appearance.hair = id;
    this.content.querySelectorAll('.sw-cc-hairbtn').forEach((x) => {
      x.classList.toggle('active', Number((x as HTMLElement).dataset.hair) === id);
    });
    if (scroll) this.scrollHairTo(id, true);
    this.queueIconTint();
  }

  private stepHair(dir: 1 | -1): void {
    const list = CHAR_CREATION_HAIRS;
    const idx = list.indexOf(this.appearance.hair);
    const next = idx < 0 ? 0 : (idx + dir + list.length) % list.length;
    this.setHair(list[next], true);
  }

  /** 选中发型滚动定位（2026-08-27 用户报:随机/箭头换选后网格须跟随——随机=居中
   *  滚入;箭头=已可见则不动,滚出视野时贴边滚入）。grid 非定位元素,btn/grid 的
   *  offsetParent 同为 .sw-cc-hair(position:relative),offsetTop 相减即网格内纵位 */
  private scrollHairTo(id: number, center: boolean): void {
    const grid = this.content.querySelector<HTMLElement>('.sw-cc-hairgrid');
    const btn = grid?.querySelector<HTMLElement>(`.sw-cc-hairbtn[data-hair="${id}"]`);
    if (!grid || !btn) return;
    const y = btn.offsetTop - grid.offsetTop;
    const h = btn.offsetHeight, view = grid.clientHeight;
    if (!center && y >= grid.scrollTop && y + h <= grid.scrollTop + view) return;
    const target = center ? y - (view - h) / 2 : y < grid.scrollTop ? y : y + h - view;
    grid.scrollTop = Math.min(Math.max(target, 0), grid.scrollHeight - view);
  }

  // ---- 颜色页（部位 = 当前颜色页签） ----

  /** 取色器 HSL 走原版缩放域（ScaledHslToRgb :2359-2362 l×0.85+0.15 / RgbToScaledHsl
   *  :2364-2369 (l-0.15)/0.85 钳 [0,1]）——滑杆亮度全域映射实际亮度 [0.15,1]，
   *  七取色器色彩域/滑块位置/HEX 读数与原版一致。R24 修复：曾直用未缩放 HSL。 */
  private syncHslFromPart(): void {
    const c = this.appearance[this.colorPart] as RGBColor;
    this.hsl = rgbToScaledHsl(c.r, c.g, c.b);
  }

  private applyHslToPart(): void {
    const [h, s, l] = this.hsl;
    const [r, g, b] = hslToRgb(h, s, scaledLuminosity(l));
    (this.appearance[this.colorPart] as RGBColor) = {
      r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255),
    };
  }

  private buildColor() {
    const box = el('div', 'sw-cc-color');
    // HSL 三滑杆面板（UIPanel 220×104 Top 10；三杆行距 30，全 DOM）
    const panel = el('div', 'sw-cc-hslpanel sw-cc-panelbg');
    const sliders = el('div');
    for (const kind of [0, 1, 2] as const) {
      const track = el('div', 'sw-cc-slider');
      track.style.top = `${3 + kind * 30}px`;
      track.appendChild(el('i', 'sw-cc-sliderbar'));
      track.appendChild(el('i', 'sw-cc-sliderhl'));
      const fill = el('i', 'sw-cc-sliderfill');
      const knob = document.createElement('img');
      knob.src = VAN_TEX('ColorSlider');
      knob.className = 'sw-cc-sliderknob';
      knob.draggable = false;
      track.append(fill, knob);
      this.sliderFills[kind] = fill;
      this.sliderKnobs[kind] = knob;
      this.wireSlider(track, kind);
      sliders.appendChild(track);
    }
    panel.appendChild(sliders);
    box.appendChild(panel);
    // HEX 框（UIPanel 100×32 右下；Click_CopyHex :1337）+ 复制/粘贴/随机（左下间距 40）
    const hexEl = el('div', 'sw-cc-hex');
    hexEl.appendChild(el('span', undefined, 'FFFFFF'));
    hexEl.title = Lang.text('Mods.SandboxWorld.CharCreate.CopyHex');
    this.hexLabel = hexEl;
    hexEl.addEventListener('click', () => this.copyHex());
    box.appendChild(hexEl);
    const low = el('div', 'sw-cc-colorlow');
    const hexBtns: Array<[string, string, () => void]> = [
      ['Copy', 'Mods.SandboxWorld.CharCreate.CopyHex', () => this.copyHex()],
      ['Paste', 'Mods.SandboxWorld.CharCreate.PasteHex', () => void this.pasteHex()],
      ['Randomize', 'Mods.SandboxWorld.CharCreate.RandomColor', () => {
        // 原版随机单色 = HSL 三分量均匀掷（GetRandomColorVector :1794）
        this.hsl = [Math.random(), Math.random(), Math.random()];
        this.applyHslToPart();
        this.redrawColorPage();
      }],
    ];
    hexBtns.forEach(([icon, tip, fn], i) => {
      const b = this.smallBtn(icon, tip, fn);
      b.style.left = `${i * 40}px`;
      low.appendChild(b);
    });
    box.appendChild(low);
    this.content.appendChild(box);
    this.redrawColorPage();
  }

  /** 滑杆渐变色（GetHSLSliderColorAt :1128-1141：三支全走 ScaledHslToRgb——
   *  色相杆 = (t,1,0.5)（实际亮度 0.5×0.85+0.15=0.575）；饱和/亮度杆随当前
   *  HSL 联动，亮度分量同样过 ×0.85+0.15 缩放） */
  private sliderColorAt(kind: 0 | 1 | 2, t: number): RGBColor {
    const [h, s, l] = this.hsl;
    const [r, g, b] = kind === 0 ? hslToRgb(t, 1, scaledLuminosity(0.5))
      : kind === 1 ? hslToRgb(h, t, scaledLuminosity(l))
      : hslToRgb(h, s, scaledLuminosity(t));
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  /** 滑杆/HEX/页签图标/缩略图联动（预览由 rAF 自刷新） */
  private redrawColorPage(): void {
    for (const kind of [0, 1, 2] as const) {
      const fill = this.sliderFills[kind];
      const knob = this.sliderKnobs[kind];
      if (fill) {
        const stops: string[] = [];
        for (let i = 0; i < 167; i++) {
          const c = this.sliderColorAt(kind, i / 167);
          stops.push(`rgb(${c.r},${c.g},${c.b}) ${((i / 166) * 100).toFixed(2)}%`);
        }
        fill.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
      }
      // 滑块中心 x = 27 + 167*v（DrawValueBar :160-162）；CSS margin-left -5.5 已含半宽
      if (knob) knob.style.left = `${(27 + 167 * this.hsl[kind]).toFixed(2)}px`;
    }
    if (this.hexLabel) {
      (this.hexLabel.firstElementChild as HTMLElement).textContent =
        hex(this.appearance[this.colorPart] as RGBColor).toUpperCase();
    }
    this.queueIconTint();
    this.scheduleSheetBake();
  }

  private wireSlider(track: HTMLElement, kind: 0 | 1 | 2): void {
    // 取值矩形 = 杆内缩 (3,4,174,8)（DrawValueBar :150-153）→ value=(localX-3)/174。
    // localX 由 .sw-cc-sliderbar 自身 rect 归一化回本地 178 域:未缩放时 bar.left
    // =track.left+22、width=178 ⇒ 与旧式 (clientX-track.left-22-3)/174 数值严格
    // 相同;面板缩放(--cc-fit)后 rect 随之缩小,直减屏幕像素常数会错位,rect 化
    // 两态通用(knob left=27+167v 与渐变 stops 均为本地域,指针↔滑块保持一致)
    const apply = (e: PointerEvent) => {
      const bar = track.querySelector<HTMLElement>('.sw-cc-sliderbar');
      const rect = (bar ?? track).getBoundingClientRect();
      if (!rect.width) return;
      const localX = ((e.clientX - rect.left) / rect.width) * 178;
      const v = (localX - 3) / 174;
      this.hsl[kind] = Math.max(0, Math.min(1, v));
      this.applyHslToPart();
      this.redrawColorPage();
    };
    track.addEventListener('pointerdown', (e) => {
      try { track.setPointerCapture(e.pointerId); } catch { /* 合成事件无活动指针——拖动仍走 buttons 门 */ }
      apply(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) apply(e);
    });
  }

  private copyHex(): void {
    const t = hex(this.appearance[this.colorPart] as RGBColor).toUpperCase();
    this.lastHex = t;
    try { void navigator.clipboard?.writeText(t); } catch { /* 无权限时 lastHex 兜底 */ }
  }

  private async pasteHex(): Promise<void> {
    let text = this.lastHex;
    try {
      const v = await navigator.clipboard?.readText();
      if (v) text = v;
    } catch { /* 剪贴板权限缺失走 lastHex 兜底 */ }
    const m = /#?([0-9a-fA-F]{6})/.exec(text);
    if (!m) return;
    const c = fromHex('#' + m[1]);
    (this.appearance[this.colorPart] as RGBColor) = c;
    this.syncHslFromPart();
    this.redrawColorPage();
  }
}
