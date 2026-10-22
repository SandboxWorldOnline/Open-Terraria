// 世界创建页（DOM 版，替代 VUI UIWorldCreationState）：
// 世界名/种子 + 大小/难度/邪恶三组选项 + 彩蛋种子图标 + 多层预览图 + 描述。
import { parseSeed, parseSeedChain } from '../world/gen/SeedEasterEggs';   // ★IIIII229 ⑥M1 旗标派生改 parseSeedChain（gen 同口径）
import { isHalloweenDateNow as isHalloweenDateNowVanilla } from '../world/World';   // ★SW-BJ55 单源化
import { randomWorldName } from '../i18n/RandomText';
import { Lang } from '../i18n/Lang';
import { ensureVanillaKit, bindKeyboardShift } from './vanillaKit';
import { UISfx } from '../vui/UISfx';
import { lateImageRetry } from '../assets/lateImageRetry';

export interface WorldCreationFlow {
  onCreate(cfg: { name: string; seed: string; w: number; h: number; /** 尺寸档 0 小/1 中/2 大（SIZES 下标；GenConfig.size 直传，W/H 与之同源派生） */ size: number; difficulty: number; evil: -1 | 0 | 1 }): void;
  onCancel(): void;
}

// 选项 = 键引用(语言切换时重取,不留硬编码文案)。
// label/desc 全用原版键(UI.*),邪恶三项短标签原版无现成键 → 自有键。
interface Opt { labelKey: string; icon: string; descKey: string; }
interface SizeOpt extends Opt { w: number; h: number; }

const SIZES: SizeOpt[] = [
  { labelKey: 'UI.WorldSizeSmall', w: 4200, h: 1200, icon: 'UI_WorldCreation_IconSizeSmall', descKey: 'UI.WorldDescriptionSizeSmall' },
  { labelKey: 'UI.WorldSizeMedium', w: 6400, h: 1800, icon: 'UI_WorldCreation_IconSizeMedium', descKey: 'UI.WorldDescriptionSizeMedium' },
  { labelKey: 'UI.WorldSizeLarge', w: 8400, h: 2400, icon: 'UI_WorldCreation_IconSizeLarge', descKey: 'UI.WorldDescriptionSizeLarge' },
];
const DIFFS: Opt[] = [
  { labelKey: 'UI.Normal', icon: 'UI_WorldCreation_IconDifficultyNormal', descKey: 'UI.WorldDescriptionNormal' },
  { labelKey: 'GameUI.Expert', icon: 'UI_WorldCreation_IconDifficultyExpert', descKey: 'UI.WorldDescriptionExpert' },
  { labelKey: 'UI.Master', icon: 'UI_WorldCreation_IconDifficultyMaster', descKey: 'UI.WorldDescriptionMaster' },
  { labelKey: 'UI.Creative', icon: 'UI_WorldCreation_IconDifficultyCreative', descKey: 'UI.WorldDescriptionCreative' },
];
const EVILS: Array<Opt & { value: -1 | 0 | 1 }> = [
  { labelKey: 'Mods.SandboxWorld.WorldCreation.EvilRandom', icon: 'UI_WorldCreation_IconEvilRandom', descKey: 'UI.WorldDescriptionEvilRandom', value: -1 },
  { labelKey: 'Mods.SandboxWorld.WorldCreation.EvilCorrupt', icon: 'UI_WorldCreation_IconEvilCorruption', descKey: 'UI.WorldDescriptionEvilCorrupt', value: 0 },
  { labelKey: 'Mods.SandboxWorld.WorldCreation.EvilCrimson', icon: 'UI_WorldCreation_IconEvilCrimson', descKey: 'UI.WorldDescriptionEvilCrimson', value: 1 },
];

const CSS = `
.sw-wc-panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 620px; max-width: 96vw; z-index: 20; cursor: auto;
  opacity: 0.9;   /* 与 .sw-vsel 选择面板同族 90% 微半透（2026-08-25 用户实报缺） */
  color: #e8e8f4; padding: 10px 4px;
  font-family: "Fusion Pixel 12px", "Microsoft YaHei", sans-serif;
}
.sw-wc-title { text-align: center; font-size: 18px; color: #ffe8a0; margin-bottom: 10px;
  text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; }
.sw-wc-body { display: flex; gap: 14px; }
.sw-wc-main { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.sw-wc-row { display: flex; align-items: center; gap: 8px; }
.sw-wc-row > span { width: 52px; color: #c8d0f0; flex-shrink: 0; }
.sw-wc-row input[type=text] { flex: 1; background: #10142c; border: 1px solid #4a5aa0; color: #fff;
  padding: 6px 8px; border-radius: 4px; font-family: inherit; min-width: 0; }
.sw-wc-rand { background: #232c52; border: 1px solid #3a4680; border-radius: 4px; padding: 4px 8px;
  cursor: pointer; flex-shrink: 0; }
.sw-wc-seedicon { width: 34px; height: 34px; flex-shrink: 0; image-rendering: pixelated; }
/* 天顶种子图标画布（7×16 图集帧 62×60,与 34px 静态图标同视觉盒:34/60 缩放 → 宽 35px） */
.sw-wc-seedicon-cv { width: 35px; height: 34px; flex-shrink: 0; image-rendering: pixelated; }
.sw-wc-rand img { width: 28px; height: 28px; display: block; image-rendering: pixelated; }
.sw-wc-group { display: flex; flex-direction: column; gap: 2px; }
.sw-wc-grouplabel { color: #b8c0e8; font-size: 13px; }
.sw-wc-opts { display: flex; gap: 8px; }
.sw-wc-opt {
  display: flex; align-items: center; gap: 6px; flex: 1; justify-content: center;
  background: rgb(44, 57, 106); border: 2px solid #3e5195;
  padding: 4px 4px; cursor: pointer; font-family: inherit; color: #e8e8f4;
}
.sw-wc-opt img { width: 32px; height: 32px; image-rendering: pixelated; }
.sw-wc-opt:hover { background: rgb(73, 94, 171); border-color: #ffe745; }
.sw-wc-opt.active { outline: 2px solid #ffe745; background: rgb(73, 94, 171); }
.sw-wc-desc { min-height: 34px; color: #9aa2cc; font-size: 12px; }
.sw-wc-side { width: 132px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.sw-wc-preview { width: 120px; height: 120px; image-rendering: pixelated;
  background: #10142c; border: 2px solid #4a5aa0; border-radius: 4px; }
.sw-wc-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
.sw-wc-footer button {
  color: #e8e8f4; padding: 8px 22px; cursor: pointer; font-family: inherit;
  font-size: 15px;
}
/* ---- 手机适配(2026-08-25,加法式覆盖,桌面 ≥1024×768 全不命中)----
   窄屏(≤700,含 640 宽小屏横屏):预览侧栏从右侧列改为叠在主列上方一行
   (column-reverse 保持 DOM 序=侧栏在后),选项钮标签缩号防挤压;
   input 16px 防 iOS 聚焦自动放大。矮横屏(max-height:500):面板内滚兜底 */
@media (max-width: 700px) {
  .sw-wc-body { flex-direction: column-reverse; }
  .sw-wc-side { width: 100%; flex-direction: row; justify-content: center; }
  .sw-wc-opt span { font-size: 13px; }
  .sw-wc-row input[type=text] { font-size: 16px; }
  .sw-wc-panel { translate: 0 var(--kb-shift, 0px); transition: translate .15s; }
}
@media (max-height: 500px) {
  .sw-wc-panel { max-height: 96vh; overflow-y: auto; overscroll-behavior: contain;
    translate: 0 var(--kb-shift, 0px); transition: translate .15s; }
  /* 矮横屏(375-430 高)纵向体量压缩——★保持双列(覆盖 A 档堆叠:矮屏双列更矮,
   * SE 横屏 375 实测堆叠会把邪恶组+footer 折叠出屏),目标全面板一屏放下,
   * overflow-y 仅作极端字号/语言兜底 */
  .sw-wc-body { flex-direction: row; }
  .sw-wc-side { width: 118px; flex-direction: column; }
  .sw-wc-preview { width: 88px; height: 88px; }
  .sw-wc-title { margin-bottom: 4px; font-size: 16px; }
  .sw-wc-main { gap: 5px; }
  .sw-wc-row input[type=text] { padding: 3px 8px; font-size: 16px; }
  .sw-wc-grouplabel { font-size: 12px; }
  .sw-wc-opt { padding: 2px 4px; }
  .sw-wc-opt img { width: 24px; height: 24px; }
  .sw-wc-desc { min-height: 14px; font-size: 11px; }
  .sw-wc-footer { margin-top: 5px; }
  .sw-wc-footer button { padding: 4px 14px; font-size: 14px; }
}
`;

const SEED_ICON: Record<string, string> = {
  everything: 'Seed_Everything', drunkWorld: 'Seed_Drunk', notTheBees: 'Seed_NotTheBees',
  getGoodWorld: 'Seed_ForTheWorthy', theConstant: 'Seed_TheConstant', skyblock: 'Seed_Skyblock',
  tenthAnniversary: 'Seed_Celebration', noTraps: 'Seed_NoTraps', remix: 'Seed_Remix',
};

/** 特殊种子（路线① GetOptionFromSeedText）旗标名→图标键（=SEED_ICON 九位；
 *  ★IIIII215b Chat 音门）。秘密种子（路线② CheckInputForSecretSeed）= flags 里
 *  不在此表的其余旗标名 → menu_accept 一次性解锁音。 */
const SPECIAL_ICON_KEY_BY_FLAG: Record<string, string> = SEED_ICON;

/** 路线①命中判定：flags 含任一特殊种子旗标（parseSeed 对 SPECIAL_OPTIONS 首中即返） */
export function isSpecialSeedText(flags: { everything?: boolean; drunkWorld?: boolean; notTheBees?: boolean; getGoodWorld?: boolean; theConstant?: boolean; skyblock?: boolean; tenthAnniversary?: boolean; noTraps?: boolean; remix?: boolean }): boolean {
  return Object.keys(flags).some((n) => SPECIAL_ICON_KEY_BY_FLAG[n] !== undefined);
}

/** Main.isHalloweenDateNow（★1457 Main.cs:13315-13327）1:1：现实日期万圣窗 =
 *  10 月 10-31 日 ∪ 11 月 1 日。★可注入 now 供测试（vanilla 读 DateTime.Now）。
 *  ★IIIII226 halloweenGen 日期臂（WorldFileData.SetSeedToRandomWithCurrentEvents
 *  WorldFileData.cs:417-425）消费面，落点=mainFlow.createWorldFlow。
 *  ★SW-BJ55：实现收拢为 world/World.ts 单源镜像（checkXMas/checkHalloween
 *  同源同锚,1458 同位零漂移）——本处保留缺省参包装以维持既有导入面。 */
export function isHalloweenDateNow(now: Date = new Date()): boolean {
  return isHalloweenDateNowVanilla(now);
}

/** WorldFileData.SetSeedToRandomWithCurrentEvents（WorldFileData.cs:417-425）的
 *  日期臂（UIWorldCreation.FinishCreatingWorld :984-986 调用面）：创建世界时种子为空
 *  或特殊种子文本 ⇒ 万圣日期窗内给 halloweenGen（pumpkin season）秘种子启用态 +
 *  种子文本前缀 "pumpkinseason|"（vanilla 另把种子重掷为随机——本仓随机种子推导
 *  在 createWorldFlow 的空串缺省位完成，普通输入种子原样保留语义不变）。
 *  非（空 ∪ 特殊）种子或窗外 ⇒ 原样返回（零触碰）。 */
export function applyHalloweenSeasonSeed(seed: string, now: Date = new Date()): string {
  const trimmed = String(seed ?? '').trim();
  // ★IIIII229 ⑥M1：旗标判定改 parseSeedChain（'|' 链并集口径,gen 同口径）
  if (trimmed !== '' && !isSpecialSeedText(parseSeedChain(trimmed).flags)) return trimmed;
  if (!isHalloweenDateNow(now)) return trimmed;
  return 'pumpkinseason|' + trimmed;
}


export class WorldCreationPanel {
  private panel: HTMLElement;
  private desc: HTMLElement;
  private preview: HTMLCanvasElement;
  private previewCtx: CanvasRenderingContext2D;
  // 模块级:语言切换重建面板时恢复用户选择
  private static lastSel = { size: 0, diff: 0, evil: 0 };   // 默认小世界(2026-08-26 用户要求;会话内仍记忆用户上次选择)
  private sel = { ...WorldCreationPanel.lastSel };

  constructor(parent: HTMLElement, private flow: WorldCreationFlow) {
    ensureVanillaKit();
    // 样式表每次挂载都刷新(★HMR 期守卫只建不更,旧 CSS 驻留吞变更——同 TitleMenu)
    let style = document.getElementById('sw-wc-style') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'sw-wc-style';
      document.head.appendChild(style);
    }
    style.textContent = CSS;
    this.panel = document.createElement('div');
    this.panel.className = 'sw-wc-panel sw-vpanel';
    this.panel.innerHTML = `
      <div class="sw-wc-title">${Lang.text('LegacyMenu.47')}</div>
      <div class="sw-wc-body">
        <div class="sw-wc-main">
          <div class="sw-wc-row"><span>${Lang.text('UI.WorldCreationName')}</span><input type="text" data-f="name" maxlength="27"><button class="sw-wc-rand" data-act="randname" title="${Lang.text('UI.WorldCreationRandomizeNameDescription')}"><img src="sprites/vanilla-ui/UI_WorldCreation_IconRandomName.png"></button></div>
          <div class="sw-wc-row"><span>${Lang.text('UI.WorldCreationSeed')}</span><input type="text" data-f="seed" maxlength="40" placeholder="${Lang.text('UI.WorldCreationSeedEmpty').replace(/^[<：: ]+|[>]+$|\s*[：:]\s*$/g, '')}"><button class="sw-wc-rand" data-act="randseed" title="${Lang.text('UI.WorldCreationRandomizeSeedDescription')}"><img src="sprites/vanilla-ui/UI_WorldCreation_IconRandomSeed.png"></button><img class="sw-wc-seedicon" src="sprites/vanilla-ui/UI_WorldCreation_Seed_Normal.png"><canvas class="sw-wc-seedicon-cv" width="62" height="60" style="display:none"></canvas></div>
          <div class="sw-wc-group"><div class="sw-wc-grouplabel">${Lang.text('UI.WorldCreationSize')}</div><div class="sw-wc-opts" data-g="size"></div></div>
          <div class="sw-wc-group"><div class="sw-wc-grouplabel">${Lang.text('UI.WorldCreationDifficulty')}</div><div class="sw-wc-opts" data-g="diff"></div></div>
          <div class="sw-wc-group"><div class="sw-wc-grouplabel">${Lang.text('UI.WorldCreationEvil')}</div><div class="sw-wc-opts" data-g="evil"></div></div>
          <div class="sw-wc-desc"></div>
        </div>
        <div class="sw-wc-side"><canvas class="sw-wc-preview" width="84" height="84"></canvas></div>
      </div>
      <div class="sw-wc-footer"><button data-act="back" class="sw-vbtn">${Lang.text('UI.Back')}</button><button data-act="create" class="sw-vbtn">${Lang.text('UI.Create')}</button></div>
    `;
    (this.panel.querySelector('[data-f=name]') as HTMLInputElement).value = randomWorldName();
    this.desc = this.panel.querySelector('.sw-wc-desc')!;
    this.preview = this.panel.querySelector('.sw-wc-preview')!;
    this.previewCtx = this.preview.getContext('2d')!;
    this.previewCtx.imageSmoothingEnabled = false;

    // 选项组
    this.buildGroup('size', SIZES);
    this.buildGroup('diff', DIFFS);
    this.buildGroup('evil', EVILS);
    // ★seedIcon 必须先于 refresh() 就位——refreshSeedIcon() 会向它写 .src
    //  （曾挪到下方 randseed 监听器组后,构造器首刷写 undefined.src 崩"创建世界"）
    this.seedIcon = this.panel.querySelector('.sw-wc-seedicon') as unknown as HTMLImageElement;
    this.seedCv = this.panel.querySelector('.sw-wc-seedicon-cv') as unknown as HTMLCanvasElement;
    this.seedCvCtx = this.seedCv.getContext('2d');
    if (this.seedCvCtx) this.seedCvCtx.imageSmoothingEnabled = false;
    this.refresh();

    this.panel.querySelector('[data-act=randname]')!.addEventListener('click', () => {
      (this.panel.querySelector('[data-f=name]') as HTMLInputElement).value = randomWorldName();
    });
    this.panel.querySelector('[data-act=randseed]')!.addEventListener('click', () => {
      (this.panel.querySelector('[data-f=seed]') as HTMLInputElement).value = String(Math.floor(Math.random() * 1e9));
      this.refreshSeedIcon();
    });
    (this.panel.querySelector('[data-f=seed]') as HTMLInputElement).addEventListener('input', () => this.refreshSeedIcon());
    this.panel.querySelector('[data-act=back]')!.addEventListener('click', () => this.close(flow.onCancel));
    this.panel.querySelector('[data-act=create]')!.addEventListener('click', () => this.submit());
    this.escHandler = (e: KeyboardEvent) => { if (e.code === 'Escape') this.close(flow.onCancel); };
    window.addEventListener('keydown', this.escHandler);
    this.unsubKb = bindKeyboardShift(this.panel);   // 移动端键盘遮挡补偿
    this.unsubLang = Lang.onChange(() => this.rebuild());
    parent.appendChild(this.panel);
  }

  private unsubLang: (() => void) | null = null;
  private unsubKb: (() => void) | null = null;

  /** 语言切换 → 重建面板(保留 sel/世界名/种子输入) */
  private rebuild() {
    const name = (this.panel.querySelector('[data-f=name]') as HTMLInputElement).value;
    const seed = (this.panel.querySelector('[data-f=seed]') as HTMLInputElement).value;
    WorldCreationPanel.lastSel = { ...this.sel };
    const parent = this.panel.parentElement;
    this.close(() => {});
    if (parent) new WorldCreationPanel(parent, this.flow);
    requestAnimationFrame(() => {
      const p = document.querySelector('.sw-wc-panel');
      if (!p) return;
      (p.querySelector('[data-f=name]') as HTMLInputElement).value = name;
      (p.querySelector('[data-f=seed]') as HTMLInputElement).value = seed;
    });
  }

  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  private buildGroup(g: 'size' | 'diff' | 'evil', opts: Opt[]) {
    const box = this.panel.querySelector(`[data-g=${g}]`)!;
    opts.forEach((o, i) => {
      const b = document.createElement('div');
      b.className = 'sw-wc-opt';
      b.innerHTML = `<img src="sprites/vanilla-ui/${o.icon}.png"><span>${Lang.text(o.labelKey)}</span>`;
      b.addEventListener('click', () => { this.sel[g] = i; this.refresh(); });
      b.addEventListener('mouseenter', () => { this.desc.textContent = Lang.text(o.descKey); });
      box.appendChild(b);
    });
  }

  private refresh() {
    // 高亮
    const mark = (g: 'size' | 'diff' | 'evil', idx: number) => {
      this.panel.querySelectorAll(`[data-g=${g}] .sw-wc-opt`).forEach((el, i) => {
        (el as HTMLElement).classList.toggle('active', i === idx);
      });
    };
    mark('size', this.sel.size); mark('diff', this.sel.diff); mark('evil', this.sel.evil);
    this.desc.textContent = '';
    this.drawPreview();
    this.refreshSeedIcon();
  }

  /** 多层预览图（UIWorldCreationPreview.cs DrawSelf :71-132 1:1：元素 84×84，
   *  边框 (0,0)、内容层 (4,4)——76×76 恰好嵌在 84 边框的 4px 边内。
   *  曾把 120×120 画布按原尺寸画 → 内容层只有 76²、边框 84²，图小框大）。
   *  ★2026-09-03 补缺：背景层 PreviewDifficulty*1（:76-91 Normal1[0/3]/Expert1[1]/
   *  Master1[2]，大师背景=黑日食图——曾整层漏移植"缺太阳"）+ 压暗 tint：专家/大师下
   *  Size/Evil/Bunny 三层乘 Color.DarkGray（:85/:89；XNA 命名色=169/255,见下），
   *  大师兔子层再 ×1.2f=202/255（:125）。canvas 以 brightness(n) 滤镜逐层等价乘色。
   *  已知微账：draw() 闭包按调用快照捕获 tint——跨难度切换时迟到 onload 会以旧 tint
   *  重画一帧级时长（下次选择即纠正,低危不追）。 */
  private previewImgs = new Map<string, ImageBitmap | HTMLImageElement>();
  private drawPreview() {
    const ctx = this.previewCtx;
    ctx.clearRect(0, 0, 84, 84);
    const diff = this.sel.diff;
    const bgKey = ['UI_WorldCreation_PreviewDifficultyNormal1',
      'UI_WorldCreation_PreviewDifficultyExpert1',
      'UI_WorldCreation_PreviewDifficultyMaster1',
      'UI_WorldCreation_PreviewDifficultyNormal1'][diff];
    // XNA Color.DarkGray = (169,169,169,255)（W3C 系命名色,≠0.5!——红蓝对抗 C-F10：
    // 曾按 0.5 写,专家/大师三层比原版暗 ~24%）；*1.2f 逐通道乘后 (byte) 截断
    // → 202/255。canvas brightness(×) 逐通道线性乘同构（Filter Effects sRGB,不动 alpha）
    const tint = (diff === 1 || diff === 2) ? 169 / 255 : 1;          // Color.DarkGray
    const bunnyTint = diff === 2 ? 202 / 255 : tint;                  // DarkGray * 1.2f
    // ★元素必须是 [key, tint] 元组——曾写成裸字符串数组,解构把 'UI_...' 拆成
    //  key='U' → 三层全部查空,预览只剩背景层(2026-09-03 用户实证"层被覆盖")
    const content: Array<[string, number]> = [
      [bgKey, 1],
      [['UI_WorldCreation_PreviewSizeSmall', 'UI_WorldCreation_PreviewSizeMedium', 'UI_WorldCreation_PreviewSizeLarge'][this.sel.size], tint],
      // 同 :200 双 W typo 漏修分支(2026-08-13 枚举 review 实锤)——邪恶层曾 404
      [['UI_WorldCreation_PreviewEvilRandom', 'UI_WorldCreation_PreviewEvilCorruption', 'UI_WorldCreation_PreviewEvilCrimson'][this.sel.evil], tint],
      // 此前误写 UI_WWorldCreation_*(双 W)→ 四个难度层 404,预览缺难度层像"错位"
      [['UI_WorldCreation_PreviewDifficultyNormal2', 'UI_WorldCreation_PreviewDifficultyExpert2', 'UI_WorldCreation_PreviewDifficultyMaster2', 'UI_WorldCreation_PreviewDifficultyCreative2'][diff], bunnyTint],
    ];
    const border = 'UI_WorldCreation_PreviewBorder';
    // 贴图缓存 + 全层重画（onload 乱序到达也不串层）
    const draw = () => {
      ctx.clearRect(0, 0, 84, 84);
      for (const [key, t] of content) {
        const im = this.previewImgs.get(key);
        const ime = im as unknown as HTMLImageElement | undefined;
        if (ime?.complete && ime.width) {
          if (t !== 1) ctx.filter = `brightness(${t})`;  // XNA color tint = 逐通道乘
          ctx.drawImage(ime, 4, 4);
          ctx.filter = 'none';
        }
      }
      const b = this.previewImgs.get(border);
      const be = b as unknown as HTMLImageElement | undefined;
      if (be?.complete && be.width) ctx.drawImage(be, 0, 0);
    };
    for (const key of [...content.map(([k]) => k), border]) {
      if (this.previewImgs.has(key)) continue;
      const im = new Image();
      im.onload = () => draw();
      im.src = `sprites/vanilla-ui/${key}.png`;
      lateImageRetry(im, `sprites/vanilla-ui/${key}.png`);   // ★BJ705-G26 件4
      this.previewImgs.set(key, im);
    }
    draw();
  }

  private seedIcon: ImageBitmap | HTMLImageElement;
  /** 天顶种子图标画布（7×16 故障动画图集裁帧域——静态 <img> 装不下 434×960 图集） */
  private seedCv: HTMLCanvasElement;
  private seedCvCtx: CanvasRenderingContext2D | null = null;
  /** 天顶故障动画 60Hz 定时器（vanilla OnUpdate 等价时钟;close/rebuild 全清） */
  private glitchTimer: ReturnType<typeof setInterval> | null = null;
  /** 天顶图集图（UI_WorldCreation_Seed_Everything.png 434×960=vanilla 全等,懒加载一次） */
  private glitchIm: HTMLImageElement | null = null;
  private glitchState = { variation: 0, frame: 0, counter: 0 };
  /** 上次解析的种子图标键 */
  private lastSeedKey = '';
  /** 上次解析的种子文本——Chat 音「文本变更且命中特殊种子」判定基线（★IIIII215b） */
  private lastSeedText = '';
  /** 会话级已解锁秘密种子旗标名（vanilla SecretSeed._enabled 的面板内镜像,纯 UI 态零 store 写） */
  private enabledSecrets = new Set<string>();
  private refreshSeedIcon() {
    const seed = (this.panel.querySelector('[data-f=seed]') as HTMLInputElement).value.trim();
    const { flags } = parseSeedChain(seed);   // ★IIIII229 ⑥M1:'|' 链并集口径（gen 同口径,多段籽图标/彩蛋不再全灭）
    const key = flags.everything ? 'Seed_Everything'
      : flags.drunkWorld ? 'Seed_Drunk'
      : flags.notTheBees ? 'Seed_NotTheBees'
      : flags.getGoodWorld ? 'Seed_ForTheWorthy'
      : flags.theConstant ? 'Seed_TheConstant'
      : flags.skyblock ? 'Seed_Skyblock'
      : flags.tenthAnniversary ? 'Seed_Celebration'
      : flags.noTraps ? 'Seed_NoTraps'
      : flags.remix ? 'Seed_Remix'
      : flags.vampireSeed ? 'Seed_Secret'   // 秘密种子通用图标（吸血鬼 1.4.5 无专属图标）
      : 'Seed_Normal';
    // ★IIIII215b 两条独立音路（UIWorldCreation.cs :830-845 TextChanged 回调 1:1）：
    //  ① 特殊种子（GetOptionFromSeedText 命中→SelectOption）→ PlaySound(24)=Chat
    //     （SoundID.cs:48）——文本每次变更加命中即播,同文本刷新不重播；
    //  ② 秘密种子（CheckInputForSecretSeed 命中且 !Enabled → SecretSeed.Enable）→
    //     seed._sound=SoundID.MenuAccept（WorldGen.cs:341-379 全员同参,:532-546 Enable
    //     playSound 缺省 true）——每枚种子会话内仅首次解锁播（enabledSecrets 镜像）。
    //  此前实现两路混用（特殊种子误播 menu_accept、同图标键切换重复播）——本批修正。
    if (seed !== this.lastSeedText && isSpecialSeedText(flags)) {
      UISfx.chat();
    }
    for (const name of Object.keys(flags)) {
      const iconKey = SPECIAL_ICON_KEY_BY_FLAG[name];
      if (iconKey !== undefined) continue;  // 路①特殊种子不占解锁位
      if (!this.enabledSecrets.has(name)) {
        this.enabledSecrets.add(name);
        UISfx.menuAccept();
      }
    }
    this.lastSeedText = seed;
    this.lastSeedKey = key;
    // ★IIIII216：Seed_Everything 原版资产 = 434×960 的 7×16 故障动画图集（
    // Terraria.WorldBuilding/WorldSeedOption_Everything.cs:64-94 ProvideUIElement →
    // UIImageFramed(Texture, Texture.Frame(7,16)),逐帧 62×60;1456≡1457≡1458 diff 全等），
    // 本仓 PNG 与 vanilla 源逐字节全等——资产无错,错在渲染面曾把整张图集塞进 34px
    // <img>（=碎条+红精灵错乱,2026-09-08 用户报）。现按 vanilla 裁帧动画：
    if (key === 'Seed_Everything') {
      this.showGlitchIcon();
    } else {
      this.stopGlitchIcon();
      this.seedCv.style.display = 'none';
      const img = this.seedIcon as HTMLImageElement;
      img.style.display = '';
      img.src = `sprites/vanilla-ui/UI_WorldCreation_${key}.png`;
    }
  }

  /** 天顶种子图标 = 7×16 故障动画（与 WorldSelect.buildZenithGlitchIcon 同一套 1:1 门）：
   *  构造即 Frame(7,16) 首帧上屏（vanilla UIImageFramed ctor 帧域），OnUpdate 随机门：
   *  当前帧 0 时阈值掷 15-120,其余帧恒 3t 换帧;落到 4/8/12 帧 1/3 概率换 7 变体列。 */
  private showGlitchIcon() {
    (this.seedIcon as HTMLImageElement).style.display = 'none';
    this.seedCv.style.display = '';
    if (!this.glitchIm) {
      const im = new Image();
      im.onload = () => this.drawGlitchFrame();
      im.src = 'sprites/vanilla-ui/UI_WorldCreation_Seed_Everything.png';
      lateImageRetry(im, 'sprites/vanilla-ui/UI_WorldCreation_Seed_Everything.png');   // ★BJ705-G26 件4
      this.glitchIm = im;
    }
    this.drawGlitchFrame();
    if (this.glitchTimer) return;   // 已在动画中（连续输入保持相位,不重掷 RNG）
    this.glitchTimer = setInterval(() => this.glitchTick(), 1000 / 60);
  }

  private stopGlitchIcon() {
    if (this.glitchTimer) {
      clearInterval(this.glitchTimer);
      this.glitchTimer = null;
    }
  }

  /** WorldSeedOption_Everything.OnUpdate cs:73-92 1:1（threshold 每帧重掷：
   *  Main.rand.Next(min, max+1) 在比较式内联求值 ∈ [min,max] 闭区间） */
  private glitchTick() {
    if (!this.panel.isConnected) {
      this.stopGlitchIcon();   // 面板已拆离（rebuild/close 竞态兜底）→ 自清
      return;
    }
    const s = this.glitchState;
    let min = 3, max = 3;
    if (s.frame === 0) { min = 15; max = 120; }
    const threshold = min + Math.floor(Math.random() * (max - min + 1));
    if (++s.counter >= threshold) {
      s.counter = 0;
      s.frame = (s.frame + 1) % 16;
      if ((s.frame === 4 || s.frame === 8 || s.frame === 12) && Math.floor(Math.random() * 3) === 0) {
        s.variation = Math.floor(Math.random() * 7);
      }
    }
    this.drawGlitchFrame();
  }

  /** SetFrame(7, 16, variation, frame, 0, 0)（cs:91）→ sourceRect(variation*62, frame*60, 62, 60) */
  private drawGlitchFrame() {
    const im = this.glitchIm;
    if (!im?.complete || !im.width || !this.seedCvCtx) return;
    const s = this.glitchState;
    this.seedCvCtx.imageSmoothingEnabled = false;
    this.seedCvCtx.clearRect(0, 0, this.seedCv.width, this.seedCv.height);
    this.seedCvCtx.drawImage(im, s.variation * 62, s.frame * 60, 62, 60, 0, 0, 62, 60);
  }

  private submit() {
    const size = SIZES[this.sel.size];
    const seed = (this.panel.querySelector('[data-f=seed]') as HTMLInputElement).value.trim();
    const name = (this.panel.querySelector('[data-f=name]') as HTMLInputElement).value.trim()
      || parseSeed(seed).specialName || Lang.text('Mods.SandboxWorld.WorldCreation.DefaultName');
    this.close(() => this.flow.onCreate({ name, seed, w: size.w, h: size.h, size: this.sel.size, difficulty: this.sel.diff, evil: EVILS[this.sel.evil].value }));
  }

  private close(fn: () => void) {
    this.stopGlitchIcon();   // 天顶故障动画定时器随面板销毁（IIIII216）
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    this.unsubKb?.();
    this.unsubLang?.();
    this.panel.remove();
    fn();
  }
}
