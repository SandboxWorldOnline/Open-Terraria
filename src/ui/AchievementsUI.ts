// 成就菜单 + 背包提示牌（原版 UIAchievementsMenu / UIAchievementListItem /
// AchievementAdvisor 的 DOM 移植）。
// 语义对照：
//  - 面板半透 Color(33,43,79)*0.8（UIAchievementsMenu BackgroundColor）
//  - 图标：Achievements.png 64px 帧 / 66px 步长 / 每行 8 帧；锁定态 X+528
//    灰阶列块（UIAchievementListItem.cs:57-60）
//  - 边框：Achievement_Borders.png 72×72
//  - 分类过滤行：Achievement_Categories.png 32×32 帧 / 34px 步长 / 上下两行
//    = 选中/未选中（UIToggleImage frame/off Point(34j,0)/(34j,34)，cs:92-95）
//  - 列表序 = 注册序（CreateAchievementsList 同注册表原序）
import type { Game } from '../core/Game';
import { options } from '../core/Options';
import { Lang } from '../i18n/Lang';
import { ACH_CATEGORY } from '../data/vanillaAchievements';
import { modAchDefOf } from '../core/Achievements';   // ★成就域:tooltip 字面回退
import { tintedSliceDataUrl } from './vanillaKit';
import { mouseTextInnerColor } from '../render/Renderer';
import { lateImageRetry } from '../assets/lateImageRetry';

const CATEGORY_NAMES: Record<number, string> = {
  [ACH_CATEGORY.Slayer]: 'Achievements.SlayerCategory',
  [ACH_CATEGORY.Collector]: 'Achievements.CollectorCategory',
  [ACH_CATEGORY.Explorer]: 'Achievements.ExplorerCategory',
  [ACH_CATEGORY.Challenger]: 'Achievements.ChallengerCategory',
  [ACH_CATEGORY.NoCategory]: 'Achievements.NoCategory',
};

const CSS = `
.sw-ach-panel { pointer-events:auto; position:fixed; left:50%; top:50%;
  transform:translate(-50%,-50%); width:min(680px, 92vw); max-height:88vh;
  /* 原版 UIAchievementsMenu BackgroundColor = Color(33,43,79)*0.8 */
  background:rgba(33,43,79,0.8); border:2px solid #7d92d6; border-radius:6px;
  color:#e8ecf8; padding:12px; display:flex; flex-direction:column;
  box-shadow:0 0 0 2px rgba(10,14,30,0.8), 0 6px 28px rgba(0,0,0,0.65);
  font-size:14px; z-index:120; }
.sw-ach-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.sw-ach-head .sw-title { margin-bottom:0; flex:1; }
.sw-ach-cat { pointer-events:auto; width:32px; height:32px; border:none; padding:0;
  background:url(sprites/vanilla/Achievement_Categories.png);
  background-size:auto; image-rendering:pixelated; cursor:pointer; flex:none; }
.sw-ach-list { overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:4px; }
.sw-ach-row { pointer-events:auto; display:flex; gap:10px; align-items:center;
  background:rgba(20,26,52,0.55); border-radius:6px; padding:6px; cursor:pointer; }
.sw-ach-row:hover { background:rgba(40,52,100,0.65); }
.sw-ach-row.hl { animation: sw-ach-hl 0.8s ease-in-out 4; }
@keyframes sw-ach-hl {
  0%, 100% { background:rgba(40,52,100,0.65); box-shadow:none; }
  50% { background:rgba(255,215,110,0.35); box-shadow:0 0 14px rgba(255,215,110,0.6); }
}
.sw-ach-icon { position:relative; width:72px; height:72px; flex:none; }
.sw-ach-icon .glyph { position:absolute; left:4px; top:4px; width:64px; height:64px;
  background-image:url(sprites/vanilla/Achievements.png);
  background-repeat:no-repeat; image-rendering:pixelated; }
.sw-ach-icon img.border { position:absolute; left:0; top:0; width:72px; height:72px;
  image-rendering:pixelated; pointer-events:none; }
.sw-ach-info { flex:1; min-width:0; }
.sw-ach-info .nm { font-weight:bold; color:#ffe8a0; }
.sw-ach-row.done .sw-ach-info .nm { color:#8de08d; }
.sw-ach-info .ds { color:#aeb8d8; font-size:12px; margin-top:2px; }
.sw-ach-bar { height:8px; background:#1a1f3a; border-radius:4px; margin-top:5px;
  border:1px solid #444c7a; overflow:hidden; }
.sw-ach-bar .fill { height:100%; background:linear-gradient(90deg,#6a8ae0,#8ad0e0); }
/* ---- 背包提示牌（AchievementAdvisor.DrawOneAchievement 小卡 1:1 框面,★BJ473;
 *      ★BJ500 2026-10-04 用户拍板:原版卡面零文字——DrawCard :136-165 仅三贴图层
 *      无任何字体调用,文案只走 hover 气泡 tooltip（Main.DrawMouseHover :123-134）。
 *      竖式文字卡（2026-09-02「保留」决定）废除;框尺寸对齐原版 scale 三档
 *      （大卡 0.75 Main.cs:41762 / 内联 0.35 :42129 / 设置面板 0.5 :95/:103）。
 *      蓝底圆角盒废除（BJ473 用户实报+截图:入口应为金框方形钮）。
 *      原版卡三层（AchievementAdvisor.cs:136-165,1457=1458 diff 全等）：
 *      ① Achievements.png 暗变体帧（frame.X+=528 :158）→ ② Achievement_Borders
 *      72² 金框 @(−4,−4)×s（金色烘在贴图,:160）→ ③ 悬停描边×OurFavoriteColor
 *      (255,231,69)（Main.cs:886/:163）。未悬停 tint Color(220,220,220,220)(:147)
 *      → 悬停 Color.White。几何由 advisorFrameGeom() 单源写 inline 尺寸 ---- */
.sw-ach-advisor { pointer-events:auto; display:flex; flex-direction:column; align-items:center; gap:4px;
  cursor:pointer; }
.sw-ach-advisor .card { position:relative; display:block; flex:none;
  filter:brightness(0.8627); }   /* 220/255 未悬停灰调（:144-148） */
.sw-ach-advisor .card .glyph { position:absolute;
  background-image:url(sprites/vanilla/Achievements.png);
  background-repeat:no-repeat; image-rendering:pixelated; }
.sw-ach-advisor .card img.border { position:absolute; left:0; top:0; width:100%; height:100%;
  image-rendering:pixelated; pointer-events:none; }
.sw-ach-advisor .card .hov { position:absolute; display:none; background-repeat:no-repeat;
  background-size:100% 100%; image-rendering:pixelated; pointer-events:none; }
.sw-ach-advisor.sw-ach-hov .card { filter:none; }          /* 悬停 → Color.White */
.sw-ach-advisor.sw-ach-hov .card .hov { display:block; }   /* 黄描边显形 */
/* ---- ★BJ500 hover 气泡（原版形态:Main.DrawMouseHover AchievementAdvisor.cs:123-134
 *      → DisplayAndGetFakeItem(StrongRed10) Main.cs:20326-20338 → MouseText("")
 *      → MouseText_DrawItemTooltip :20509）：名称行=成就 FriendlyName,色=
 *      GetItemNameColor(rare=10) rgb(255,40,100)（:20486-20489）;说明行=成就
 *      Description（ToolTip 行,白×mouseTextColor :20539-20542;无统计行——fake item
 *      SetDefaults(0) 全零域 → GetLinesInfo 零行）;底=Utils.DrawInvBG
 *      ×(23,25,81)×0.925（:20585）;跟鼠标（:20379-20394+:20561-20578,JS 写位）。
 *      形态语言（字号/字影/内距）与 UI .sw-tooltip 族同款=仓内 MouseText 家族约定。
 *      body 级挂载:.sw-vinv root 有 transform:scale(K)（UI.layoutVanilla）,其内
 *      fixed 定位会被缩放捕获——气泡必须活在缩放根之外走视口系 ---- */
.sw-ach-tip { position:fixed; display:none; pointer-events:none; z-index:1300;
  padding:9px 13px; font-size:13px; color:#e8e4f0; max-width:280px;
  font-family:"Fusion Pixel 12px","Microsoft YaHei",sans-serif;
  text-shadow:1px 1px 0 rgba(0,0,0,0.85); line-height:1.5; }
.sw-ach-tip .lines { display:inline; }   /* 脉冲 brightness 只作用文字层（同 .sw-tooltip-lines） */
.sw-ach-tip .ds { white-space:pre-line; }   /* 描述自带 \n 同色拆行（itemTooltip.ts:523 同判例） */
`;

let cssInjected = false;
function ensureCss(): void {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 图标帧 → CSS background-position（引擎 iconFrameOf：66 步长/8 列/锁定 +528）。
 *  scale<1 时同步缩放整张图集（backgroundSize）——Advisor 小卡 32px 窗用 0.5：
 *  此前 32px 窗不缩放,只裁出 64px 帧的左上 1/4（2026-09-02 用户报填充残缺） */
const ACH_SHEET_W = 1054;   // sprites/vanilla/Achievements.png 实测尺寸
const ACH_SHEET_H = 1186;
function glyphStyle(div: HTMLElement, a: Game['achievements'], name: string, scale = 1): void {
  const f = a.iconFrameOf(name);
  if (!f) return;
  const x = f.locked ? f.x + f.lockedDx : f.x;
  div.style.backgroundPosition = `${-x * scale}px ${-f.y * scale}px`;
  if (scale !== 1) div.style.backgroundSize = `${ACH_SHEET_W * scale}px ${ACH_SHEET_H * scale}px`;
}

// ---- 成就菜单（开关式：再次调用关闭） ----
let openPanel: HTMLElement | null = null;
let openEscHandler: ((e: KeyboardEvent) => void) | null = null;
/** 开合广播（★IIIII245）：window 级 CustomEvent，detail.open=面板现态。
 *  TitleMenu 等独占态消费方监听它做【同步】摘挂——rAF 轮询在 headless 后台标签
 *  会被节流（坑表 B1 同族），开/关还原延迟到下一帧=探针/低帧率机可见闪序。 */
function notifyAchToggle(): void {
  window.dispatchEvent(new CustomEvent('sw-ach-toggle', { detail: { open: !!openPanel } }));
}
/** 当前过滤类别（原版 4 个 UIToggleImage；全关 = 只看未完成? 原版至少留一个开） */
const catOn = [true, true, true, true];

/** ★SW-FX18 2026-09-10 面板宿主结构化（原 Main.cs:112 AchievementsMenu 为全局态，
 *  两个入口喂同一面板：游戏内 = Game（UI.ts 弹窗定位/顾问卡）,标题屏 = 菜单级
 *  成就实例（mainFlow __swAchievements 桥,Main.cs:49733 menuMode 0 第三钮同位）） */
export interface AchievementsHost {
  achievements: import('../core/Achievements').Achievements;
  /** UI 音（menuTick）；标题屏菜单直开可缺省静默 */
  sfx?: { play(name: 'menuTick', vol?: number): void } | null;
}

export function openAchievementsPanel(host: AchievementsHost, focusName?: string): void {
  ensureCss();
  if (openPanel) { closeAchievementsPanel(); return; }
  const a = host.achievements;

  const panel = el('div', 'sw-ach-panel');
  // 头部：标题 + 完成计数 + 关闭
  const head = el('div', 'sw-ach-head');
  head.appendChild(el('div', 'sw-title', Lang.text('UI.Achievements')));
  const count = el('div');
  count.style.cssText = 'font-size:13px; color:#9fb0dd; flex:none;';
  head.appendChild(count);
  const closeBtn = el('button', 'sw-btn');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'margin:0; padding:4px 10px; width:auto; font-size:12px; flex:none;';
  closeBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); closeAchievementsPanel(); });
  head.appendChild(closeBtn);
  panel.appendChild(head);

  // 分类过滤行（Achievement_Categories.png：选中帧上排/未选中下排）
  const catRow = el('div');
  catRow.style.cssText = 'display:flex; gap:4px; margin-bottom:8px;';
  const catBtns: HTMLButtonElement[] = [];
  for (let j = 0; j < 4; j++) {
    const b = el('button', 'sw-ach-cat');
    const frame = (on: boolean) => {
      b.style.backgroundPosition = `${-(j * 34)}px ${-(on ? 0 : 34)}px`;
      b.style.opacity = on ? '1' : '0.55';
    };
    frame(catOn[j]);
    b.title = Lang.text(CATEGORY_NAMES[j]);
    b.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      // 原版 UIToggleImage 群：允许全关（显示空列表）
      catOn[j] = !catOn[j];
      frame(catOn[j]);
      renderList();
    });
    catBtns.push(b);
    catRow.appendChild(b);
  }
  panel.appendChild(catRow);

  const list = el('div', 'sw-ach-list');
  panel.appendChild(list);

  const renderList = () => {
    list.textContent = '';
    let doneN = 0;
    // ★定位模式:重置过滤为全开(保证目标成就不被分类过滤隐藏)
    if (focusName) {
      for (let j = 0; j < 4; j++) catOn[j] = true;
      catBtns.forEach((b, j) => b.style.opacity = '1');
    }
    for (const def of a.defList()) {
      if (a.isCompleted(def.name)) doneN++;
      // 未归类成就（-1，如 GAIN_TORCH_GODS_FAVOR）不受过滤行影响恒显示
      if (def.category >= 0 && !catOn[def.category]) continue;
      const done = a.isCompleted(def.name);
      const row = el('div', 'sw-ach-row' + (done ? ' done' : ''));
      row.dataset.ach = def.name;   // ★定位锚(点击弹窗滚动定位用)
      const icon = el('div', 'sw-ach-icon');
      const glyph = el('div', 'glyph');
      glyphStyle(glyph, a, def.name);
      // ★成就域:mod 图标(blob URL;覆盖 sprite 域定位)
      const modIcon = def.modIconUrl;
      if (modIcon) {
        glyph.style.backgroundImage = `url(${modIcon})`;
        glyph.style.backgroundSize = 'contain';
        glyph.style.backgroundPosition = 'center';
      } else if (def.title !== undefined) {
        // ★R-A-F3(2026-10-14):无 icon 的 mod 成就=清 CSS 默认原版贴图
        //  (glyph 类自带 Achievements.png + 0,0 定位=显示无关首帧)
        glyph.style.backgroundImage = 'none';
      }
      icon.appendChild(glyph);
      const border = el('img') as HTMLImageElement;
      border.className = 'border';
      border.src = 'sprites/vanilla/Achievement_Borders.png';
      border.draggable = false;
      icon.appendChild(border);
      row.appendChild(icon);
      const info = el('div', 'sw-ach-info');
      // ★成就域(2026-10-14):mod 成就字面回退(def.title/desc 直挂;原版域 l10n 不变)
      info.appendChild(el('div', 'nm', def.title ?? Lang.text(`Achievements.${def.name}_Name`)));
      info.appendChild(el('div', 'ds', def.desc ?? Lang.text(`Achievements.${def.name}_Description`)));
      const p = a.progressOf(def.name);
      if (!done && (p.ratio != null || p.totalConds > 1)) {
        const bar = el('div', 'sw-ach-bar');
        const fill = el('div', 'fill');
        const r = p.ratio ?? p.doneConds / p.totalConds;
        fill.style.width = `${Math.round(r * 100)}%`;
        bar.appendChild(fill);
        info.appendChild(bar);
      }
      row.appendChild(info);
      list.appendChild(row);
    }
    count.textContent = `${doneN} / ${a.count}`;
  };
  renderList();
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  // ★IIIII245 z 序修复:必须挂 body 顶层语境,禁挂 .sw-root——
  //   .sw-root 自身 position:fixed+z-index:10(UI.ts)=独立 stacking context,
  //   面板的 z-index:120 只在其内部生效;主菜单 .sw-title-menu(z15)与设置面板
  //   .sw-set-panel(z25)是 #game-root 下平级语境 → 挂 .sw-root 的面板被两者
  //   盖住(用户截图实报"成就面板跑到菜单层之下";探针 elementFromPoint 实证:
  //   交叠区顶层=.sw-title-btn / .sw-set-row)。挂 body 后 120 与各层直接比较:
  //   > 标题菜单 15/角色选择 20/设置 25/图鉴 30/chrome 35/安装条 45/对话层 60,
  //   < 手机操控层 150(操控钮保持可达,与旧挂法相对关系不变)/表情轮盘 1150/
  //   模态遮罩 1200+/音频门·资产诊断 10000+。输入门安全:.sw-ach-panel 已在
  //   domTargets.ts DOM_UI_TARGET_SELECTOR(closest 判定不依赖挂载点)。
  document.body.appendChild(panel);
  openPanel = panel;
  openEscHandler = (e) => { if (e.code === 'Escape') closeAchievementsPanel(); };
  window.addEventListener('keydown', openEscHandler);
  notifyAchToggle();   // ★IIIII245 独占态同步广播（TitleMenu 藏按钮列）
  host.sfx?.play('menuTick', 1);
  // ★滚动定位+高亮(2026-09-07 用户需求:成就解锁弹窗点击→定位到该项并高亮)
  if (focusName) {
    const target = list.querySelector(`[data-ach="${focusName}"]`);
    if (target) {
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('hl');
        setTimeout(() => target.classList.remove('hl'), 3200);
      });
    }
  }
}

export function closeAchievementsPanel(): void {
  openPanel?.remove();
  openPanel = null;
  if (openEscHandler) { window.removeEventListener('keydown', openEscHandler); openEscHandler = null; }
  notifyAchToggle();   // ★IIIII245 关闭也广播（独占态还原；UI.closeAll 路径同享）
}

export function achievementsPanelOpen(): boolean { return !!openPanel; }

// ---- 背包提示牌（AchievementAdvisor：未完成成就小卡，点击开菜单） ----
/** 构建提示牌并返回带 update() 的元素（背包每次 refresh 时刷新显示内容） */
/** 原版 AchievementAdvisor.Initialize 精选序列（1458 与 1456 同序同集，36 项；
 *  序 ≠ AchievementInitializer 注册序——OBTAIN_HAMMER 在 NO_HOBO 前） */
const ADVISOR_ORDER = [
  'TIMBER', 'BENCHED', 'OBTAIN_HAMMER', 'NO_HOBO', 'YOU_CAN_DO_IT', 'OOO_SHINY',
  'HEAVY_METAL', 'MATCHING_ATTIRE', 'HEART_BREAKER', 'I_AM_LOOT', 'HOLD_ON_TIGHT',
  'STAR_POWER', 'EYE_ON_YOU', 'SMASHING_POPPET', 'WHERES_MY_HONEY', 'STING_OPERATION',
  'BONED', 'DUNGEON_HEIST', 'ITS_GETTING_HOT_IN_HERE', 'MINER_FOR_FIRE', 'STILL_HUNGRY',
  'ITS_HARD', 'BEGONE_EVIL', 'EXTRA_SHINY', 'HEAD_IN_THE_CLOUDS', 'BUCKETS_OF_BOLTS',
  'DRAX_ATTAX', 'PHOTOSYNTHESIS', 'GET_A_LIFE', 'THE_GREAT_SOUTHERN_PLANTKILL',
  'TEMPLE_RAIDER', 'LIHZAHRDIAN_IDOL', 'ROBBING_THE_GRAVE', 'OBSESSIVE_DEVOTION',
  'STAR_DESTROYER', 'CHAMPION_OF_TERRARIA',
];

/** 顾问可显卡判定（AchievementAdvisor.HasAvailableCardToDisplay :185-197 等价）。
 *  IsAchievableInWorld 未建模（原版查世界进度门槛,本仓成就无条件可达）=登记偏差;
 *  判据 = 精选序列（Initialize 36 项）中存在未完成。★BJ416 抽单源:卡 update 与
 *  UI.ts 装备列 HasSpace 门（vanillaInvLayout.hasSpaceForInlineAdvisor 入参）同源。 */
export function advisorHasCard(a: import('../core/Achievements').Achievements): boolean {
  for (const name of ADVISOR_ORDER) {
    if (a.defOf(name) && !a.isCompleted(name)) return true;
  }
  return false;
}

/** ★BJ473 advisor 卡框几何单源（AchievementAdvisor.DrawCard :136-165 对拍）：
 *  图标 64² @原点、金框 72² @(−4,−4)×s、悬停描边 = scale>0.5 ? Thin(76²@−5s)
 *  : Fat(80²@−8s)（:151-156）。悬停命中面 = 图标盒 64²×s（:139 Between(position,
 *  position+frame.Size()*s),框 4s 外圈不触发）。
 *  ★BJ500 尺寸三档对齐原版（旧「两落位均 0.5=QoL」登记偏差废除,2026-10-04 用户
 *  拍板「框没那么小,尺寸对齐原版」）：大卡 0.75（Main.cs:41762 large:true →
 *  AchievementAdvisor.cs:58-62 num=0.75f）、内联小卡 0.35（:42129 large:false —
 *  亲读钉死:内联卡=72²×0.35≈25.2px 框/64²×0.35≈22.4px 图标,原版即如此之小）、
 *  设置面板 0.5（AchievementAdvisor.DrawOptionsPanel :95/:103——本仓无此宿主位,
 *  档位保留供未来接线）。 */
export const ADVISOR_SCALE = 0.5;
export const ADVISOR_SCALE_LARGE = 0.75;
export const ADVISOR_SCALE_INLINE = 0.35;
export interface AdvisorFrameGeom {
  card: number; icon: number; pad: number;
  hover: { size: number; off: number; tex: 'Fat' | 'Thin' };
}
export function advisorFrameGeom(scale: number = ADVISOR_SCALE): AdvisorFrameGeom {
  return {
    card: 72 * scale,
    icon: 64 * scale,
    pad: 4 * scale,
    hover: scale > 0.5
      ? { size: 76 * scale, off: -5 * scale, tex: 'Thin' }
      : { size: 80 * scale, off: -8 * scale, tex: 'Fat' },
  };
}

/** 悬停描边白模双份（Achievement_Borders_MouseHover.png 80²/TSV:14730、
 *  MouseHoverThin 76²/TSV:14731）——×OurFavoriteColor(255,231,69) 预烘 dataURL
 *  （tintedSliceDataUrl FX43 预乘管,CharCreation 滑杆高亮/EmoteMenu 边框同技法）。
 *  档位:scale>0.5 → Thin、≤0.5 → Fat（AchievementAdvisor.cs:151-156）——BJ500 起
 *  大卡 0.75 走 Thin、内联 0.35 走 Fat,两份都要。 */
const ADVISOR_HOVER_TEX = 'sprites/vanilla/Achievement_Borders_MouseHover.png';
const ADVISOR_HOVER_TEX_THIN = 'sprites/vanilla/Achievement_Borders_MouseHoverThin.png';

// ---- ★BJ500 hover 气泡（模块单例,原版 MouseText tooltip 同构=全局单绘态：
//      Main.HoverItem/_mouseTextFakeItem Main.cs:2361/:67659。多宿主卡共用一份,
//      body 级挂载=.sw-vinv root 有 transform:scale(K)（UI.layoutVanilla :8901）,
//      其内 fixed 定位会被缩放坐标捕获——气泡活在缩放根之外走视口系零补偿） ----
let achTipEl: HTMLElement | null = null;
let achTipNameEl: HTMLElement | null = null;
let achTipDescEl: HTMLElement | null = null;
let achTipLinesEl: HTMLElement | null = null;
let achTipVisible = false;
let achTipMX = 0;
let achTipMY = 0;
let achTipHeldGet: (() => boolean) | null = null;   // ★BJ501:光标持物谓词（uiHeldItemRef=mouseItem 语义,非 HeldItem——见 achTipAnchorXY 详注）
let achTipRaf = 0;

/** 气泡底烘（Utils.DrawInvBG :2718-2742 ×(23,25,81)×0.925 Main.cs:20585,九宫 10px
 *  角拉伸）——UI.tooltipBgDataUrl 同式移植（该函数 UI.ts 模块私有,导出委托会造
 *  AchievementsUI↔UI.ts 循环加载,判例备案:同式另烤,公式锚一致）。 */
let achTipBgImg: HTMLImageElement | null = null;
let achTipBgTinted: HTMLCanvasElement | null = null;
const achTipBgCache = new Map<string, string>();
function achTipBgDataUrl(w: number, h: number): string | null {
  if (typeof Image === 'undefined') return null;
  if (!achTipBgImg) {
    achTipBgImg = new Image();
    achTipBgImg.src = 'sprites/vanilla/Inventory_Back13.png';
    lateImageRetry(achTipBgImg, 'sprites/vanilla/Inventory_Back13.png');   // ★BJ705-G26 件4
  }
  const img = achTipBgImg;
  if (!img.complete || !(img.width > 0)) return null;   // 未就绪(首次悬停竞态)→兜底色,下次悬停现底
  const key = `${Math.max(20, Math.round(w))}x${Math.max(20, Math.round(h))}`;
  const hit = achTipBgCache.get(key);
  if (hit) return hit;
  if (!achTipBgTinted) {
    const t = document.createElement('canvas');
    t.width = img.width; t.height = img.height;
    const tc = t.getContext('2d', { willReadFrequently: true })!;   // getImageData/toDataURL 烘焙,SHM 后备
    tc.imageSmoothingEnabled = false;
    tc.drawImage(img, 0, 0);
    const d = tc.getImageData(0, 0, t.width, t.height);
    const tmul = [23 / 255, 25 / 255, 81 / 255, 0.925];   // 原版真值（Main.cs:20585）
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = Math.round(d.data[i] * tmul[0]);
      d.data[i + 1] = Math.round(d.data[i + 1] * tmul[1]);
      d.data[i + 2] = Math.round(d.data[i + 2] * tmul[2]);
      d.data[i + 3] = Math.round(d.data[i + 3] * tmul[3]);
    }
    tc.putImageData(d, 0, 0);
    achTipBgTinted = t;
  }
  const t = achTipBgTinted, W = t.width, H = t.height;
  const c = document.createElement('canvas');
  c.width = Number(key.split('x')[0]); c.height = Number(key.split('x')[1]);
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
  const url = c.toDataURL('image/png');
  achTipBgCache.set(key, url);
  return url;
}

/** ★BJ501 锚算纯函数（两态判别测试单源;placeAchTip 唯一消费）。
 *  原版 MouseText_DrawItemTooltip 锚,Main.cs:20379-20394+:20561-20578：
 *  X=mouse+14(:20379)+6(ThickMouse 默认档——MouseBorderColor :276 非透明 → :2684
 *  恒开;本仓无该设置建模)+34(光标持物 :20391-20394 !mouseItem.IsAir;★BJ501 定谳:
 *  mouseItem=光标拖拽物≠Player.HeldItem,本仓谓词=uiHeldItemRef/UI.heldStack——
 *  旧刀误喂 inv.heldItem()=HeldItem 语义,游玩期热栏恒有选中物 → +34 恒加,气泡
 *  被推出 34px,用户截图物证)+6(toolTipDistance :411/:20561-20562)+8(悬停文本框
 *  开 :20566);Y=mouse+…+2(:20567)。屏缘钳 margin 18(盒开)/4(关)（:20563/:20568）
 *  在 placeAchTip 落。 */
export function achTipAnchorXY(mx: number, my: number, cursorHeld: boolean, box: boolean): { x: number; y: number } {
  return {
    x: mx + 14 + 6 + (cursorHeld ? 34 : 0) + 6 + (box ? 8 : 0),
    y: my + 14 + 6 + 6 + (box ? 2 : 0),
  };
}

/** 气泡定位（achTipAnchorXY 纯算 + 屏缘钳）。量测先清旧 left/top（SW-TT1 同式:
 *  shrink-to-fit 宽受残留 left 约束会挤窄）。 */
function placeAchTip(): void {
  if (!achTipVisible || !achTipEl) return;
  achTipEl.style.left = '0px';
  achTipEl.style.top = '0px';
  const tw = achTipEl.offsetWidth, th = achTipEl.offsetHeight;
  const box = !!options.data.opaqueBoxBehindTooltips;
  const p = achTipAnchorXY(achTipMX, achTipMY, !!achTipHeldGet?.(), box);
  let x = p.x;
  let y = p.y;
  const margin = box ? 18 : 4;
  if (x + tw + margin > window.innerWidth) x = window.innerWidth - tw - margin;
  if (y + th + margin > window.innerHeight) y = window.innerHeight - th - margin;
  achTipEl.style.left = `${x}px`;
  achTipEl.style.top = `${y}px`;
}

/** 气泡盒底（悬停文本框开关 Main.SettingsEnabled_OpaqueBoxBehindTooltips :249
 *  默认 true,关=无底板纯文字 :20256 支;烘底=终布局后量测,SW-TT1 同序） */
function applyAchTipBg(): void {
  if (!achTipEl) return;
  if (!options.data.opaqueBoxBehindTooltips) {
    achTipEl.style.background = 'transparent';
    return;
  }
  const w = Math.ceil(achTipEl.offsetWidth), h = Math.ceil(achTipEl.offsetHeight);
  const bg = achTipBgDataUrl(w, h);
  achTipEl.style.background = bg ? `url(${bg}) no-repeat` : 'rgba(21,23,75,0.93)';
  // SW-TT1 硬闸:no-repeat 恒钉（宁露 1px 缝,禁默认 repeat 平铺成多块气泡）
}

/** mouseTextColor 文字层脉冲（DoUpdate_AnimateCursorColors :18064-18075,190↔255
 *  三角波 +1/tick;只乘文字色,盒底恒定——UI.startTooltipPulse 同式） */
function startAchTipPulse(): void {
  if (!achTipLinesEl) return;
  cancelAnimationFrame(achTipRaf);
  achTipLinesEl.style.filter = '';
  let last = performance.now();
  let val = 255, dir = -1;
  const step = (now: number): void => {
    if (!achTipVisible) return;
    for (let t = 0; t < Math.round((now - last) / 16.7); t++) {
      val += dir;
      if (val >= 255) { val = 255; dir = -1; }
      if (val <= 190) { val = 190; dir = 1; }
    }
    last = now;
    if (achTipLinesEl) achTipLinesEl.style.filter = `brightness(${(val / 255).toFixed(3)})`;
    achTipRaf = requestAnimationFrame(step);
  };
  achTipRaf = requestAnimationFrame(step);
}

function ensureAchTip(): void {
  if (achTipEl) return;
  const tip = document.createElement('div');
  tip.className = 'sw-ach-tip';
  const lines = document.createElement('div');
  lines.className = 'lines';
  achTipNameEl = document.createElement('div');
  achTipDescEl = document.createElement('div');
  achTipDescEl.className = 'ds';
  lines.appendChild(achTipNameEl);
  lines.appendChild(achTipDescEl);
  tip.appendChild(lines);
  document.body.appendChild(tip);
  achTipEl = tip;
  achTipLinesEl = lines;
}

/** 显气泡（原版形态:名称行=Achievements.{name}_Name ×StrongRed10 色、说明行=
 *  _Description;DrawMouseHover :123-134 每帧重设——本仓 DOM 显隐期一次落内容,
 *  卡面成就变更走 update() 重设） */
function showAchTip(achName: string, mx: number, my: number, heldGet: () => boolean): void {
  ensureAchTip();
  achTipMX = mx;
  achTipMY = my;
  achTipHeldGet = heldGet;
  // ★成就域:mod 字面回退(modAchDefOf=mod defs 表;原版域恒 miss 走 l10n)
  const tipDef = modAchDefOf(achName);
  achTipNameEl!.textContent = tipDef?.title ?? Lang.text(`Achievements.${achName}_Name`);
  achTipDescEl!.textContent = tipDef?.desc ?? Lang.text(`Achievements.${achName}_Description`);
  // 名称行色=GetItemNameColor(ItemRarityColor.StrongRed10=10) → rgb(255,40,100)
  // （Main.cs:20486-20489;mt=255 → num3=1 原生无乘区语义,脉冲走层 filter——UI
  //  .sw-tooltip rareEl 同约定）
  achTipNameEl!.style.color = mouseTextInnerColor(10, 0, 255, null);
  achTipEl!.style.display = 'block';
  achTipVisible = true;
  placeAchTip();
  applyAchTipBg();
  startAchTipPulse();
}

function hideAchTip(): void {
  if (!achTipVisible) return;
  achTipVisible = false;
  achTipHeldGet = null;
  cancelAnimationFrame(achTipRaf);
  if (achTipEl) achTipEl.style.display = 'none';
}

/** ★BJ318：getGame 动态解析——曾直捕 Game 实例,Advisor DOM 卡随 UI 单例跨局
 *  存活（teardownInventoryPanel 只在重建时清）,退世界后 card.update/mousedown
 *  闭包把死 Game 整图钉在 UI 上（forward-BFS 定谳锚之一）。动态解析零滞留。
 *  ★BJ500：scaleOf=宿主档单源(大卡 0.75/内联 0.35/缺省 0.5=设置面板档),update()
 *  逐刷新重估（跨 sw=1000 缩放档随刷新切换,applyGeom 单源重写 inline 尺寸）;
 *  卡面文字卡废除,文案走 hover 气泡（showAchTip,形态见上）。 */
export function createAchievementAdvisor(getGame: () => Game | null, scaleOf?: () => number): HTMLElement & { update(): void } {
  ensureCss();
  const card = el('div', 'sw-ach-advisor') as unknown as HTMLElement & { update(): void };
  // 三层卡面（DrawCard :157-164 绘制序=叠层次序）：暗变体图标 → 金框 → 悬停描边。
  // inline 尺寸不写死——首帧 update() 按宿主档 applyGeom 定形（BJ500 几何单源）
  const box = el('div', 'card');
  const glyph = el('div', 'glyph');
  const border = document.createElement('img') as HTMLImageElement;
  border.className = 'border';
  border.src = 'sprites/vanilla/Achievement_Borders.png';   // 金框=贴图自带（:41/:160）
  border.draggable = false;
  border.alt = '';
  const hov = el('div', 'hov');
  box.appendChild(glyph);
  box.appendChild(border);
  box.appendChild(hov);
  card.appendChild(box);
  let curScale = -1;
  const hoverUrls: { Fat?: string; Thin?: string } = {};
  const applyGeom = (scale: number): void => {
    const g = advisorFrameGeom(scale);
    box.style.width = `${g.card}px`;
    box.style.height = `${g.card}px`;
    glyph.style.left = `${g.pad}px`;
    glyph.style.top = `${g.pad}px`;
    glyph.style.width = `${g.icon}px`;
    glyph.style.height = `${g.icon}px`;
    hov.style.width = `${g.hover.size}px`;
    hov.style.height = `${g.hover.size}px`;
    hov.style.left = `${g.pad + g.hover.off}px`;   // off 以图标原点计(:163) → 卡坐标 pad+off
    hov.style.top = `${g.pad + g.hover.off}px`;
    const u = hoverUrls[g.hover.tex];
    if (u) hov.style.backgroundImage = `url(${u})`;
  };
  void tintedSliceDataUrl(ADVISOR_HOVER_TEX, 255, 231, 69, 1).then((url) => {
    if (url) {   // 烘失败退化=仅提亮无描边(登记)
      hoverUrls.Fat = url;
      if (curScale >= 0 && advisorFrameGeom(curScale).hover.tex === 'Fat') applyGeom(curScale);   // 异步回填竞态
    }
  });
  void tintedSliceDataUrl(ADVISOR_HOVER_TEX_THIN, 255, 231, 69, 1).then((url) => {
    if (url) {
      hoverUrls.Thin = url;
      if (curScale >= 0 && advisorFrameGeom(curScale).hover.tex === 'Thin') applyGeom(curScale);
    }
  });
  // 悬停谓词 = 图标盒（:139 原版命中面;glyph 即 64²×s 内盒,框 4s 外圈不触发）——
  // 类开关替代整卡 :hover 旧面 + 沿音（DoStatefulTickSound Main.cs:3333-3343）。
  // ★BJ500 气泡同谓词触发（原版 _hoveredCard 置位 ↔ DrawMouseHover 消费 :123-134）；
  // mousemove 驱动跟鼠标（原版 MouseText 每帧重绘,DOM=move 事件重定位;气泡
  // pointer-events:none 不截流——glyph 上的 move 连续可达）
  glyph.addEventListener('mouseenter', (e) => {
    card.classList.add('sw-ach-hov');
    getGame()?.sfx.play('menuTick', 1);
    if (lastBest) {
      // ★BJ501:heldGet=光标持物谓词（Main.mouseItem.IsAir 取反 :20391-20394）=
      //  Game.uiHeldItemRef（UI.heldStack 装配,UI.ts:1530）——旧 inv.heldItem()=
      //  HeldItem 语义（热栏选中物,游玩期恒非空）致 +34 恒加（锚详注见 achTipAnchorXY）
      showAchTip(lastBest, e.clientX, e.clientY,
        () => !!getGame()?.uiHeldItemRef?.());
    }
  });
  glyph.addEventListener('mousemove', (e) => {
    if (!achTipVisible) return;
    achTipMX = e.clientX;
    achTipMY = e.clientY;
    placeAchTip();
  });
  glyph.addEventListener('mouseleave', () => {
    card.classList.remove('sw-ach-hov');
    hideAchTip();
  });
  card.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    hideAchTip();   // ★BJ500:点击=开面板,原版 tooltip 随 _hoveredCard 复位下帧消隐（:63/:68/:80）
    if (e.button !== 0) return;   // 原版仅左键（:68 mouseLeft && mouseLeftRelease）
    const game = getGame();
    if (!game) return;
    // 原版点击 = OpenAchievementsAndGoto(_hoveredCard.achievement)（:71-72）——
    // best=卡面成就,开面板+定位高亮（UI.Achievements goto 通道,音由面板入口自播）
    const a = game.achievements;
    let best: string | null = null;
    for (const name of ADVISOR_ORDER) {
      if (a.defOf(name) && !a.isCompleted(name)) { best = name; break; }
    }
    openAchievementsPanel(game, best ?? undefined);
  });
  let lastBest: string | null = null;
  card.update = () => {
    // Advisor 选择 = 原版 AchievementAdvisor.GetBestCards(1)（1458 同 1456）：
    // 精选序列（AchievementAdvisor.Initialize 36 项，序≠注册序）中首个未完成。
    // IsAchievableInWorld 未建模（原版检查世界进度门槛，本仓成就无条件可达）略。
    if (!card.isConnected) { hideAchTip(); return; }   // 卡被重建/摘除 → 气泡随葬（body 级单例防孤儿）
    const scale = scaleOf ? scaleOf() : ADVISOR_SCALE;   // ★BJ500 宿主档(大卡 0.75/内联 0.35)
    if (scale !== curScale) { curScale = scale; applyGeom(scale); }
    const game = getGame();
    if (!game) { card.style.display = 'none'; hideAchTip(); return; }
    const a = game.achievements;
    if (!advisorHasCard(a)) { card.style.display = 'none'; hideAchTip(); return; }
    let best: string | null = null;
    for (const name of ADVISOR_ORDER) {
      if (a.defOf(name) && !a.isCompleted(name)) { best = name; break; }
    }
    if (!best) { card.style.display = 'none'; hideAchTip(); return; }
    card.style.display = 'flex';
    glyphStyle(glyph, a, best, curScale);   // 暗变体帧（locked 列块 X+528,glyphStyle 单源）
    // 悬停中卡面成就被完成 → 气泡文案随新卡刷新（原版 _hoveredCard 每帧重置 :63/:80）
    if (achTipVisible && best !== lastBest) {
      // ★BJ501:同上——光标持物谓词（mouseItem 语义,非 HeldItem）
      showAchTip(best, achTipMX, achTipMY, () => !!game.uiHeldItemRef?.());
    }
    lastBest = best;
  };
  card.update();
  return card;
}
