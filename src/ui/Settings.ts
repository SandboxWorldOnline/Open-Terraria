// 设置面板（DOM，M6）：分栏 音量/界面/游戏/按键绑定 + 返回。
// 主菜单与游戏内（暂停菜单）共用。
// ★资源包/数据栏已摘除（2026-08-27 用户要求）：资源包页 UI 模块（ResourcePackPage）
//   一并删除；数据栏三入口（继续存档/读档/导入 .wld）下线，底层能力仍在
//   （__swFlow 桥 + 世界列表导入）。
// 文案全部走 Lang（M8 语言系统）：原版键（LegacyMenu.*）+ 自有键（Mods.SandboxWorld.*）。
// 语言切换：网格按钮（原版语义=用当前语言显示所有语言名，Language.* 类别），
// 点击后 Lang.setLanguage → 本面板经 Lang.onChange 重建（保留当前分栏）。
import { options, cycleMinimapFrame, cycleQuickTrashMode } from '../core/Options';
import {
  KEYBIND_ACTIONS, bindsOf, assignBinding, resetBinding, resetAllKeybinds,
  keybindActionLabel, keybindCodeLabel, type KeybindAction,
} from '../core/Keybinds';
import { TEAM_COLORS } from '../stats/Pvp';
import { UIScale } from '../vui/draw/UIScale';
import { UISfx } from '../vui/UISfx';
import { Lang } from '../i18n/Lang';
import { modUiPanelsOpen } from '../mods/ui';   // ★D19-F8(a):ESC 双收让位门
import {
  fsBackupSupported, fsBackupStatus, fsBackupDirName, fsBackupPickDirectory,
  fsBackupDisable, fsBackupRequestPermission, onFsBackupStatusChange,
} from '../save/FsBackup';   // ★BJ614 本地备份目录（增强）开关+状态面

export interface SettingsFlow {
  onBack(): void;
  /** ★SW-FX18 成就页入口（IngameOptions.cs:294 OpenAchievements 等价）；
   *  缺省不渲染入口（主菜单直开设置时无成就实例宿主） */
  onAchievements?(): void;
}

const CSS = `
.sw-set-panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 560px; max-width: 96vw; z-index: 25; cursor: auto;
  background: linear-gradient(160deg, #2b3664, #1c2444);
  border: 2px solid #7d92d6; border-radius: 6px; padding: 14px 16px; color: #e8e8f4;
  font-family: "Fusion Pixel 12px", "Microsoft YaHei", sans-serif;
  box-shadow: 0 8px 40px rgba(0,0,0,.6);
}
.sw-set-title { text-align: center; font-size: 18px; color: #ffe8a0; margin-bottom: 10px;
  text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000; }
.sw-set-body { display: flex; gap: 12px; min-height: 260px; }
.sw-set-cats { display: flex; flex-direction: column; gap: 6px; width: 96px; }
.sw-set-cats div {
  padding: 8px 10px; background: #232c52; border: 1px solid #3a4680;
  border-radius: 4px; cursor: pointer; text-align: center;
}
.sw-set-cats div.active { background: #5a6ac0; color: #fff; outline: 1px solid #ffd76e; }
.sw-set-content { flex: 1; background: #1a2140; border: 1px solid #3a4680;
  border-radius: 4px; padding: 12px; display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto; max-height: 60vh; }
.sw-set-row { display: flex; align-items: center; gap: 10px; }
.sw-set-row > span:first-child { width: 88px; color: #c8d0f0; }
.sw-set-row input[type=range] { flex: 1; accent-color: #7d92d6; }
.sw-set-row .val { width: 40px; text-align: right; color: #ffe8a0; }
.sw-set-row input[type=checkbox] { width: 18px; height: 18px; accent-color: #7d92d6; }
.sw-set-btns { display: flex; flex-direction: column; gap: 8px; }
.sw-set-btns button, .sw-set-back {
  background: #3a4680; color: #e8e8f4; border: 1px solid #7d92d6; border-radius: 4px;
  padding: 8px 12px; cursor: pointer; font-family: inherit; text-align: left;
}
.sw-set-btns button:hover, .sw-set-back:hover { background: #4a5aa0; }
.sw-set-footer { display: flex; justify-content: flex-end; margin-top: 12px; }
.sw-set-back { padding: 6px 22px; }
/* 语言选择网格（M8,视觉对齐 sw-wc-opts 互斥选项模式） */
.sw-set-lang-title { color: #ffe8a0; font-size: 14px; }
.sw-set-lang-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.sw-set-lang-grid button {
  background: #232c52; color: #e8e8f4; border: 1px solid #3a4680; border-radius: 4px;
  padding: 7px 10px; cursor: pointer; font-family: inherit; text-align: left;
}
.sw-set-lang-grid button:hover { background: #4a5aa0; }
.sw-set-lang-grid button.active { outline: 1px solid #ffd76e; background: #5a6ac0; }
.sw-set-hint { color:#8a90b8; font-size:12px; }
/* 键位行（M5）：action 名列宽 + 键按钮等宽 + 监听/未绑定态 */
.sw-set-row.sw-kb-row > span:first-child { width: 118px; }
.sw-kb-btn { min-width: 118px; text-align: center; flex: 1; }
.sw-kb-reset { padding: 4px 10px; flex: none; }
.sw-kb-unbound { color: #8a90b8; }
.sw-kb-listening { color: #ffe8a0; outline: 1px solid #ffd76e; }
`;

/** Utils.CycleControlControl_OffOnClickHold（Utils.cs:159-176）一比一——1457 相机
 *  平移档循环（Player.Settings.CyclePanControl_KeyboardAndMouse :379-382）：
 *  Hold(0)→Click(1)→OnAlways(2)→OffAlways(3)→Hold（default 支归 Hold;ButtonControlMode.cs;
 *  入参越界/NaN 钳回 Hold=Options.ts 存档卫门同语义）。纯函数供设置行与单测共用 */
export function cyclePanControlMode(mode: number): number {
  const m = Math.max(0, Math.min(3, Math.round(mode) || 0));
  return (m + 1) % 4;
}

export class SettingsPanel {
  private panel: HTMLElement;
  private content: HTMLElement;
  private cat = 'sound';
  private unsubLang: (() => void) | null = null;
  private fsBackupUnsub: (() => void) | null = null;
  private fsBackupStatusEl: HTMLElement | null = null;

  constructor(parent: HTMLElement, private flow: SettingsFlow) {
    // ★样式幂等守卫(2026-08-29 对齐菜单侧修法):原"getElementById 只建不更"在
    // HMR/长驻页面下新断点 CSS 全部失效(半新半旧难排查的家族性坑)——
    // 改为 id 守卫 + 每次 textContent 重刷
    let styleEl = document.getElementById('sw-set-style') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'sw-set-style';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = CSS;
    this.panel = document.createElement('div');
    this.panel.className = 'sw-set-panel';
    this.panel.innerHTML = `
      <div class="sw-set-title">${Lang.text('LegacyMenu.14')}</div>
      <div class="sw-set-body">
        <div class="sw-set-cats"></div>
        <div class="sw-set-content"></div>
      </div>
      <div class="sw-set-footer"><button class="sw-set-back">${Lang.text('LegacyMenu.6')}</button></div>
    `;
    this.content = this.panel.querySelector('.sw-set-content')!;
    this.buildCats();
    // ★BJ614：备份状态变化（后台连败转 broken/授权流转）→ 面板重建回显;
    // close 必退订（面板每开一建,订阅不退=监听器自捕环家族判例 BJ335/BJ328）
    this.fsBackupUnsub = onFsBackupStatusChange(() => this.build());
    this.panel.querySelector('.sw-set-back')!.addEventListener('click', () => this.close(flow.onBack));
    this.escHandler = (e: KeyboardEvent) => {
      // ★D19-F8(a)(2026-10-13):mod 面板叠开时让位 ESC 链(resolveEscapeChain
      //  closeModPanels 支先收 mod 面板;本 handler 无 stopPropagation 同帧也关=
      //  一次 Esc 双收)——面板开链期本 handler 静默一拍,链下拍自然轮到设置
      //  (modUiCloseTop 收完 mod 面板后 modPanelsOpen=false,下次 Esc 回本 handler)
      if (modUiPanelsOpen()) return;
      if (e.code === 'Escape') this.close(flow.onBack);
    };
    window.addEventListener('keydown', this.escHandler);
    // 语言切换 → 整面板重建(标题/分栏/内容全部重取文案;保留当前分栏)
    this.unsubLang = Lang.onChange(() => this.rebuild());
    parent.appendChild(this.panel);
    this.build();
    UISfx.click();
  }

  private catLabel(cat: string): string {
    switch (cat) {
      case 'sound': return Lang.text('LegacyMenu.65'); // 音量
      case 'ui': return Lang.text('Mods.SandboxWorld.Settings.Interface');
      case 'game': return Lang.text('Mods.SandboxWorld.Settings.Gameplay');
      case 'touch': return Lang.text('Mods.SandboxWorld.Settings.CatTouch');
      case 'controls': return Lang.menu(222);          // 按键绑定（UIManageControls）
      default: return cat;
    }
  }

  private buildCats() {
    const cats = document.createElement('div');
    cats.className = 'sw-set-cats';
    // 资源包/数据栏已摘（2026-08-27 用户要求）——见文件头注
    // CatTouch 栏已摘（2026-09-14 用户要求；成就入口同批摘除）
    const list = ['sound', 'ui', 'game', 'controls'];
    if (!list.includes(this.cat)) this.cat = 'sound';   // 语言重建保留分栏卫门(残 cat 落回)
    for (const c of list) {
      const div = document.createElement('div');
      div.dataset.cat = c;
      div.textContent = this.catLabel(c);
      div.addEventListener('click', () => { this.cat = c; this.build(); });
      cats.appendChild(div);
    }
    this.panel.querySelector('.sw-set-cats')!.replaceWith(cats);
  }

  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  private close(fn: () => void) {
    if (this.escHandler) window.removeEventListener('keydown', this.escHandler);
    this.cancelRebindListen();
    this.unsubLang?.();
    this.fsBackupUnsub?.();   // ★BJ614：状态订阅退订（防自捕环）
    this.fsBackupUnsub = null;
    this.panel.remove();
    fn();
  }

  private slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) {
    const row = document.createElement('div');
    row.className = 'sw-set-row';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = String(Math.round(get() * 100));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      set(v);
      val.textContent = String(Math.round(v * 100));
    });
    row.append(span, input, val);
    return row;
  }

  private toggle(label: string, get: () => boolean, set: (v: boolean) => void) {
    const row = document.createElement('label');
    row.className = 'sw-set-row';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => set(input.checked));
    row.append(span, input);
    return row;
  }

  /** 双态枚举行（点击在两态间切换；智能光标 Toggle/Hold 模式用）。
   *  ★opts.disabled（v9.11 引入的退役保留面）：选项退役但 UI 保留（存档兼容）——
   *  按钮禁用。★v9.12：frameCap 行解除 disabled（锁帧档恢复），hint 悬停文案改为
   *  可用于未禁用行（移出 disabled 分支——既有调用不传 opts=行为零改动） */
  private modeRow(label: string, _get: () => string, value: () => string, cycle: () => void,
    opts?: { disabled?: boolean; hint?: string }) {
    const row = document.createElement('div');
    row.className = 'sw-set-row';
    const span = document.createElement('span');
    span.textContent = label;
    const btn = document.createElement('button');
    btn.className = 'sw-set-back';
    btn.style.padding = '4px 14px';
    btn.textContent = value();
    if (opts?.disabled) {
      btn.disabled = true;
      btn.style.cursor = 'default';
      btn.style.opacity = '0.55';
    }
    if (opts?.hint) { btn.title = opts.hint; span.title = opts.hint; }
    btn.addEventListener('click', () => { cycle(); btn.textContent = value(); });
    row.append(span, btn);
    return row;
  }

  /** 键位行（UIKeybindingListItem：action 名 + 当前键；点击进入监听，↺ 单项回默认） */
  private keybindRow(action: KeybindAction): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sw-set-row sw-kb-row';
    const span = document.createElement('span');
    span.textContent = keybindActionLabel(action);
    const btn = document.createElement('button');
    btn.className = 'sw-set-back sw-kb-btn';
    const render = (): void => {
      const codes = bindsOf(action);
      btn.textContent = codes.length ? codes.map(keybindCodeLabel).join('/') : Lang.menu(195);
      btn.classList.toggle('sw-kb-unbound', codes.length === 0);
      btn.classList.toggle('sw-kb-listening', false);
    };
    btn.addEventListener('click', () => this.listenRebind(action, btn, render));
    const reset = document.createElement('button');
    reset.className = 'sw-set-back sw-kb-reset';
    reset.textContent = '↺';
    reset.addEventListener('click', () => {
      void options.set('keybinds', resetBinding(options.data.keybinds, action));
      render();
    });
    render();
    row.append(span, btn, reset);
    return row;
  }

  /** 监听下一键（PlayerInput.ListenFor + CheckRebindingProcessKeyboard :1495-1513：
   *  键已在列表→移除（反选解绑）；否则整表替换为该键。Esc/右键取消（SW-BN2 用户令#4：
   *  未绑定 action 同样可点行录入——绑定成功前不写 options,Esc/右键只还原显示）。
   *  capture 阶段拦截：面板 escHandler/main.ts 键盘链/Input 鼠标链全不让位（含
   *  F1-F12 防浏览器快捷） */
  private rebindListener: ((e: KeyboardEvent) => void) | null = null;
  private rebindCancelPointer: ((e: MouseEvent) => void) | null = null;
  private listenRebind(action: KeybindAction, btn: HTMLElement, refresh: () => void): void {
    this.cancelRebindListen();
    btn.textContent = Lang.text('Mods.SandboxWorld.Settings.ListeningKey');
    btn.classList.add('sw-kb-listening');
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;                       // 系统重发不算新键
      this.cancelRebindListen();
      if (e.code === 'Escape') { refresh(); return; }   // 取消
      void options.set('keybinds', assignBinding(options.data.keybinds, action, e.code));
      UISfx.click();                              // 原版绑定成功 SoundID 12 menuTick
      refresh();
    };
    this.rebindListener = onKey;
    window.addEventListener('keydown', onKey, true);
    // 右键取消（SW-BN2 2026-09-07）：监听期右压/菜单键=取消不写绑;捕获相拦截,
    // Input 的 window mousedown（bubble 相）不收到 → 世界右键不误触
    const onCancel = (e: MouseEvent): void => {
      if (e.type === 'mousedown' && e.button !== 2) return;   // 左键照常（点他行换绑等）
      e.preventDefault();
      e.stopImmediatePropagation();
      this.cancelRebindListen();
      refresh();
    };
    this.rebindCancelPointer = onCancel;
    window.addEventListener('mousedown', onCancel, true);
    window.addEventListener('contextmenu', onCancel, true);
  }

  private cancelRebindListen(): void {
    if (this.rebindListener) {
      window.removeEventListener('keydown', this.rebindListener, true);
      this.rebindListener = null;
    }
    if (this.rebindCancelPointer) {
      window.removeEventListener('mousedown', this.rebindCancelPointer, true);
      window.removeEventListener('contextmenu', this.rebindCancelPointer, true);
      this.rebindCancelPointer = null;
    }
  }

  /** 语言选择网格:显示名取各语言包自带的 Language.* 键(原版语义) */
  private langGrid() {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'sw-set-lang-title';
    title.textContent = Lang.text('LegacyMenu.102'); // 选择语言
    const grid = document.createElement('div');
    grid.className = 'sw-set-lang-grid';
    const current = options.data.lang;
    for (const c of Lang.cultures) {
      const b = document.createElement('button');
      const name = Lang.text(c.displayNameKey);
      b.textContent = Lang.has(c.displayNameKey) ? name : c.name;
      if (c.name === current) b.classList.add('active');
      b.addEventListener('click', async () => {
        if (c.name === options.data.lang) return;
        const prev = options.data.lang;
        b.disabled = true;
        // 先写内存值:Lang.setLanguage 的 emit 会触发 rebuild 重建本网格,
        // 高亮读 options.data.lang——后写会拿到旧值,激活态留在上一语言
        options.data.lang = c.name;
        const ok = await Lang.setLanguage(c.name);
        b.disabled = false;
        if (ok) {
          options.data.langExplicit = true;  // 显式选择旗标:此后浏览器语言探测不再覆盖
          await options.set('lang', c.name); // 持久化(值已同步,仅落盘,整包带 langExplicit)
        } else {
          options.data.lang = prev; // 失败回滚
          this.rebuild();
        }
      });
      b.dataset.lang = c.name;
      grid.appendChild(b);
    }
    wrap.append(title, grid);
    const hint = document.createElement('div');
    hint.className = 'sw-set-hint';
    hint.textContent = Lang.text('Mods.SandboxWorld.Settings.FontHint');
    wrap.append(hint);
    return wrap;
  }

  private build() {
    this.panel.querySelectorAll('.sw-set-cats div').forEach((el) => {
      (el as HTMLElement).classList.toggle('active', (el as HTMLElement).dataset.cat === this.cat);
    });
    this.content.innerHTML = '';
    const d = options.data;
    if (this.cat === 'sound') {
      this.content.append(
        this.slider(Lang.text('LegacyMenu.99'), 0, 1, 0.05, () => d.musicVol, (v) => { d.musicVol = v; this.applySound(); void options.set('musicVol', v); }),
        this.slider(Lang.text('LegacyMenu.98'), 0, 1, 0.05, () => d.sfxVol, (v) => { d.sfxVol = v; this.applySound(); void options.set('sfxVol', v); }),
        // Ambient 环境音轨（Main.ambientVolume，config 键 VolumeAmbient；雷声/滴水/
        // 瀑布岩浆流/小动物鸣叫/暴风雪循环等 13+ 环境音独立音量，LegacySoundPlayer.cs:1443）
        // 标签 = LegacyMenu.119（Main.cs:50914 音量三杆同族 98/99/119,原版 12 语言官译;
        // 旧自造 Mods.SandboxWorld.Settings.AmbientVol 仅 zh/en 两译,他语言落英文兜底）
        this.slider(Lang.text('LegacyMenu.119'), 0, 1, 0.05, () => d.ambientVol, (v) => { d.ambientVol = v; this.applySound(); void options.set('ambientVol', v); }),
        // ★IIIII228 标题曲风格（Main.titleMusicStyle,config "TitleMusic" Main.cs:4602；
        //  Current/Old/Console/Random 四档——Random 每启动抽签,Current=加载带 50→51）
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.TitleMusic'),
          () => d.titleMusic,
          () => Lang.text(`Mods.SandboxWorld.Settings.TitleMusic_${d.titleMusic.charAt(0).toUpperCase()}${d.titleMusic.slice(1)}`),
          () => {
            const order = ['current', 'old', 'console', 'random'] as const;
            void options.set('titleMusic', order[(order.indexOf(d.titleMusic) + 1) % order.length]);
          },
        ),
      );
    } else if (this.cat === 'ui') {
      this.content.append(
        // Game Zoom（原版 IngameOptions.cs:521-561「缩放」组：杆值 = zoom-1，域
        // [1.0,2.0]；Main.cs:16986-16990 键调整同钳/:62953 消费。读态优先相机实时
        // zoomTarget（ViewZoomIn/Out 键与滚轮直改相机），写态落 options + 相机。
        // 标签 = GameUI.GameZoom 融合串去值段；步进 0.01 = 原版百分比整数口径）
        this.slider(
          Lang.text('GameUI.GameZoom').replace(/[:：].*$/, ''),
          1, 2, 0.01,
          () => (window as unknown as { __swGame?: { camera?: { zoomTarget: number } } }).__swGame?.camera?.zoomTarget ?? d.gameZoom,
          (v) => {
            void options.set('gameZoom', v);
            (window as unknown as { __swGame?: { setZoom(z: number): void } }).__swGame?.setZoom(v);
          },
        ),
        // ★UI 缩放滑条(2026-09-16 半成品收尾;用户定位置=紧随首项「缩放」之下,
        //  两个缩放语义相邻):Options.uiScale(0.75~1.5)/l10n 标签/应用链
        //  (UIScale.userScale + 背包布局 K=vanillaScaleFor)早已就位,仅面板控件缺位。
        //  set 后须显式 recompute(canvas 面 onResize→recalculate;userScale 裸赋值
        //  不触发)+window resize 事件(DOM 背包面板失效重排,vinvResizeHandler 同
        //  通道);options.set → onChange 下发其余消费方。跨域布局对齐口径:设置→
        //  UI 缩放三环境调同值(见 UiScaleHint)。
        this.slider(
          Lang.text('Mods.SandboxWorld.Settings.UiScale'),
          0.75, 1.5, 0.05,
          () => d.uiScale,
          (v) => {
            void options.set('uiScale', v);
            UIScale.userScale = v;
            UIScale.recompute();
            window.dispatchEvent(new Event('resize'));
          },
        ),
        // 渲染分辨率档(#perf-gpulog 方案A):主画布后备 = CSS×系数;0=自动(饥饿降级)。
        // 改档即重建后备 + chunk 池(GPU 账本可复核:改后 新分配 应有一次尖峰然后归零)
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.RenderScale'),
          () => String(d.renderScale),
          () => d.renderScale === 0 ? Lang.text('Mods.SandboxWorld.Settings.RSAuto') : `${Math.round((d.renderScale as number) * 100)}%`,
          () => {
            const CYCLE = [0, 1, 0.75, 0.66, 0.5] as const;   // 自动→100→75→66→50→自动
            const idx = CYCLE.indexOf(d.renderScale as typeof CYCLE[number]);
            const next = CYCLE[(idx + 1) % CYCLE.length];
            void options.set('renderScale', next).then(() =>
              (window as unknown as { __swGame?: { renderer?: { applyUserRenderScale(): void } } }).__swGame?.renderer?.applyUserRenderScale());
          },
        ),
        // 自动降级开关并入档位'自动'(renderScale=0)——独立 toggle 曾与之语义重复(用户反馈 2026-08-28)
        // 资源条样式（原版 PlayerResourcesDisplaySet 两主样式：'New'=FancyClassic
        // 金框分格（1.4.4+ 默认）/ 'Default'=Classic 朴素心星）。样式名 = 原版键
        // UI.HealthManaStyle_*（Main.cs:49379 同源;旧硬编码中文 12 语言不可译）
        this.modeRow(
          Lang.text('UI.SelectHealthStyle').replace(/:.*/, ''),
          () => d.resourceBarStyle,
          () => Lang.text(d.resourceBarStyle === 'fancy' ? 'UI.HealthManaStyle_New' : 'UI.HealthManaStyle_Default'),
          () => void options.set('resourceBarStyle', d.resourceBarStyle === 'fancy' ? 'classic' : 'fancy'),
        ),
        // 小地图边框皮肤（MinimapFrameManager 9 款；config.json "MinimapFrame" 字符串键；
        // 循环方向 = SelectionHolder.CycleSelection 倒序回绕，cycleMinimapFrame 纯函数）
        this.modeRow(
          Lang.text('UI.SelectMapBorder').replace(/:.*/, ''),
          () => d.minimapFrame,
          () => Lang.text(`UI.MinimapFrame_${d.minimapFrame}`),
          () => { void options.set('minimapFrame', cycleMinimapFrame(d.minimapFrame)); },
        ),
        this.langGrid(),
        // ---- M14 杂项（界面组；IngameOptions.cs:705/846/823）----
        // 拾取提示（:705 Main.showItemText 默认 true；PopupText 拾取飘名链已接）
        this.modeRow(
          Lang.menu(71).replace(/[:：].*$/, ''),
          () => String(d.showItemText),
          () => Lang.menu(d.showItemText ? 71 : 72),
          () => void options.set('showItemText', !d.showItemText),
        ),
        // 悬停文本框（:846 Main.SettingsEnabled_OpaqueBoxBehindTooltips 默认 true；
        // 关=tooltip 无底板纯文字，已接 .sw-tooltip-nobox）
        this.modeRow(
          Lang.text('GameUI.HoverTextBoxesOn').replace(/[:：].*$/, ''),
          () => String(d.opaqueBoxBehindTooltips),
          () => Lang.text(d.opaqueBoxBehindTooltips ? 'GameUI.HoverTextBoxesOn' : 'GameUI.HoverTextBoxesOff'),
          () => void options.set('opaqueBoxBehindTooltips', !d.opaqueBoxBehindTooltips),
        ),
        // 对话头像（:823 Main.DialoguePortraitPreference；CycleNPCPortraitMode :39724
        // 序 Detailed→CloseUp→FullBodyRetro→Disabled。Disabled 已接；中间两态贴图
        // 变体未导入暂渲染 Detailed 形）
        this.modeRow(
          Lang.text('UI.PortraitsDetailed').replace(/[:：].*$/, ''),
          () => d.dialoguePortraitMode,
          () => Lang.text(`UI.Portraits${d.dialoguePortraitMode === 'detailed' ? 'Detailed'
            : d.dialoguePortraitMode === 'closeUp' ? 'CloseUp'
              : d.dialoguePortraitMode === 'fullBodyRetro' ? 'FullBodyRetro' : 'Disabled'}`),
          () => void options.set('dialoguePortraitMode',
            d.dialoguePortraitMode === 'detailed' ? 'closeUp'
              : d.dialoguePortraitMode === 'closeUp' ? 'fullBodyRetro'
                : d.dialoguePortraitMode === 'fullBodyRetro' ? 'disabled' : 'detailed'),
        ),
        // ★SW-FX14 2026-09-10 Boss 血条数字（IngameOptions.cs:806-812 1:1——
        // BigProgressBarSystem.ShowText :76 缺省 true，Preferences 键
        // "ShowBossBarHealthText" :74/:118-124 持久化；旧版设置页双入口
        // Main.cs:50774-50778。消费=Renderer.drawBossBar → drawBigProgressBar
        // showText 参 → DrawHealthText 门 Helper.cs:57/:123）
        this.modeRow(
          Lang.text('UI.ShowBossLifeTextOn').replace(/[:：].*$/, ''),
          () => String(d.showBossBarHealthText),
          () => Lang.text(d.showBossBarHealthText ? 'UI.ShowBossLifeTextOn' : 'UI.ShowBossLifeTextOff'),
          () => void options.set('showBossBarHealthText', !d.showBossBarHealthText),
        ),
        // ★SW-FX14 背包特效（IngameOptions.cs:833-842 1:1——Main.FlashyEffectsInterface
        // :443 缺省 true，config 键 :4300/:4443。★1.4.5.7 全库该字段零行为消费方
        // （仅声明/存/读/两处设置行）= 原版死设置，1:1 保态不挂行为）
        this.modeRow(
          Lang.text('UI.FlashyEffectsInterfaceOn').replace(/[:：].*$/, ''),
          () => String(d.flashyEffectsInterface),
          () => Lang.text(d.flashyEffectsInterface ? 'UI.FlashyEffectsInterfaceOn' : 'UI.FlashyEffectsInterfaceOff'),
          () => void options.set('flashyEffectsInterface', !d.flashyEffectsInterface),
        ),
        // ★SW-FX14 光照模式（IngameOptions.cs:973-979「视频」组 1:1——Lighting.Mode
        // 静态初值 Color（Lighting.cs:19；枚举 Terraria.Graphics.Light/LightMode.cs
        // White=0/Retro=1/Trippy=2/Color=3）；循环 = NextLightMode（Lighting.cs:169-176
        // Mode++ 未定义回落 White）= Color→White→Retro→Trippy→Color；config 键
        // "LightingMode" Main.cs:4238/:4490-4495。★行为备案：Color=NewEngine(逐格
        // RGB)≙本仓 GL 光照图；White/Retro/Trippy 走 LegacyLighting 引擎（Lighting.cs:
        // 40-54）——legacy 引擎族未移植，三档暂与 Color 同渲（依赖：照明引擎族移植）
        this.modeRow(
          Lang.text('UI.LightMode_Color').replace(/[:：].*$/, ''),
          () => d.lightMode,
          () => Lang.text(`UI.LightMode_${d.lightMode.charAt(0).toUpperCase()}${d.lightMode.slice(1)}`),
          () => {
            // NextLightMode 1:1：枚举序 Color(3)→White(0)→Retro(1)→Trippy(2)→Color
            const order = ['color', 'white', 'retro', 'trippy'] as const;
            void options.set('lightMode', order[(order.indexOf(d.lightMode) + 1) % order.length]);
          },
        ),
      );
      const hint = document.createElement('div');
      hint.className = 'sw-set-hint';
      hint.textContent = Lang.text('Mods.SandboxWorld.Settings.UiScaleHint');
      this.content.append(hint);
    } else if (this.cat === 'game') {
      this.content.append(
        // 开发者模式行已摘（2026-09-14 用户要求；devMode 选项面保留走 URL/控制台）
        // 背景 开/关（Main.BackgroundEnabled Main.cs:790，原版视频设置项 Lang.menu[100/101]；
        // 天气阴天渐变 cloudBGAlpha 的门，Game.updateWeather 注入 WeatherCtx.backgroundEnabled）
        this.toggle(Lang.menu(100).replace(/[:：].*$/, ''), () => d.backgrounds, (v) => void options.set('backgrounds', v)),
        // 图块在风中摆动（原版视频设置 SettingsEnabled_TilesSwayInWind；WindSway 系统总门）。
        // 原版行文案 = UI.TilesSwayInWindOn/Off 融合串（IngameOptions.cs:1055），
        // 取 On 支去冒号做标签（同背景开关的 Lang.menu(100) 处理法）
        this.toggle(Lang.text('UI.TilesSwayInWindOn').replace(/[:：].*$/, ''), () => d.swayInWind, (v) => void options.set('swayInWind', v)),
        // 水波质量四档（Main.WaveQuality，IngameOptions.cs:1040-1055：`(q+1)%4` 循环，
        // 文案 = 原版 GameUI.WaveQuality 融合串 + GameUI.QualityOff/Low/Medium/High 官译）
        this.modeRow(
          Lang.text('GameUI.WaveQuality').replace(/[:：].*$/, ''),
          () => String(d.waveQuality),
          () => Lang.text(d.waveQuality === 0 ? 'GameUI.QualityOff'
            : d.waveQuality === 1 ? 'GameUI.QualityLow'
              : d.waveQuality === 2 ? 'GameUI.QualityMedium' : 'GameUI.QualityHigh'),
          () => void options.set('waveQuality', (d.waveQuality + 1) % 4),
        ),
        // 渲染锁帧档(2026-08-18 原版对齐:原版锁 60fps)
        // ★v9.12 恢复可用(2026-10-08 用户产品裁决「宁愿渲染减速也不应帧数反复抖动」,
        //  FrameBeat.ts 头注 v9.12):cap=锁帧档选择{120,90,60,30,不限制},0=跟满档;
        //  锁定档上帧距方差监控自动降档保平滑(std>0.22×档周期 连续 2 窗→逐级降,
        //  升档 6 窗慢速回探,标定见 FrameBeat.ts 头注 v9.12)。v9.11 disabled 退役面
        //  解除;hint 键沿用(l10n 文案已更新)。
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.FrameCap'),
          () => String(d.frameCap),
          () => d.frameCap === 0 ? Lang.text('Mods.SandboxWorld.Settings.FrameCapOff')
            : `${d.frameCap} FPS`,
          () => void options.set('frameCap',
            d.frameCap === 120 ? 90 : d.frameCap === 90 ? 60 : d.frameCap === 60 ? 30
              : d.frameCap === 30 ? 0 : 120),
          { hint: Lang.text('Mods.SandboxWorld.Settings.FrameCapFollowHint') },
        ),
        // ★BJ305(2026-09-23 用户明令新功能,原版无对应物)帧率显示开关(缺省关)——
        //  开启后画面底部中央显示实时帧率(Renderer.drawFpsReadout;数据源 Game.fps
        //  最近 60 帧 rAF 均值唯一数据源)。行范式=本组既有 toggle(背景/风中摆动
        //  同款 checkbox);持久化走 options 通道(KvStore 'sandboxworld.options'),
        //  行位紧随「帧率上限」=帧率族相邻
        this.toggle(Lang.text('Mods.SandboxWorld.Settings.FpsDisplay'), () => d.fpsDisplay, (v) => void options.set('fpsDisplay', v)),
        // 渲染模式三档(2026-08-18):GPU 加速(默认)/CPU 软渲染(零 GPU 预算,
        // 多开稳定)/自动(GPU 优先,崩溃自动切 CPU,稳定回切)
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.RenderMode'),
          () => d.renderMode,
          () => d.renderMode === 'gpu' ? Lang.text('Mods.SandboxWorld.Settings.RenderModeGpu')
            : d.renderMode === 'cpu' ? Lang.text('Mods.SandboxWorld.Settings.RenderModeCpu')
            : Lang.text('Mods.SandboxWorld.Settings.RenderModeAuto'),
          () => void options.set('renderMode', d.renderMode === 'gpu' ? 'cpu' : d.renderMode === 'cpu' ? 'auto' : 'gpu'),
        ),
        // 帧模式三态(原版 FrameSkipMode,1457 Main.cs:17129-17197;1456 旧锚 :16950-16975)
        // 文案=原版 LegacyMenu.247/248/249 拆「标签|档名」(IngameOptions.cs:964
        // Lang.menu[247+FrameSkipMode],枚举 Off/On/Subtle=Enums/FrameSkipMode.cs;
        // zh 跳帧/关/开/隐蔽,en Frame Skip/Off/On/Subtle;2026-09-28 用户令对齐原版)。
        // ★语义锚(2026-09-28 调度面修复刃;2026-10-07 v9.8 根治刀刷新,FrameBeat.ts
        // 头注 v9.8):Subtle=时间门调度(shouldRender=now-lastRenderAt≥1000/cap-GUARD,
        // k 迁移机制退役;干净流恒屏率/超速流跟满稳/render-bound 帧距=帧耗/暂停零振荡;
        // 60Hz 网格地板已废:原版钳 60 是"逻辑=呈现同帧"的速度保全,本仓逻辑
        // 60Hz 解耦后只静默覆盖用户 frameCap,FrameBeat.ts 头注否决注;旧"0 步进帧
        // SuppressDraw"译法已退役);Off/On=自由渲染照画(逻辑 tick
        // 恒 60Hz;On 的 XNA 固定时间步差异 Main.cs:17133-17137 无 Web 对应物,同效),
        // off 档=用户明令逃生门。文案与原版逐字对齐,语义归位后无需改动。
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.FrameSkip'),
          () => d.frameSkipMode,
          () => d.frameSkipMode === 'off' ? Lang.text('Mods.SandboxWorld.Settings.FrameSkipOff')
            : d.frameSkipMode === 'subtle' ? Lang.text('Mods.SandboxWorld.Settings.FrameSkipSubtle')
            : Lang.text('Mods.SandboxWorld.Settings.FrameSkipOn'),
          () => void options.set('frameSkipMode', d.frameSkipMode === 'off' ? 'subtle' : d.frameSkipMode === 'subtle' ? 'on' : 'off'),
        ),
        // 智能光标（原版 IngameOptions :1418 Smart Cursor 段）：模式 Toggle/Hold + 三开关
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.SmartCursorMode'),
          () => d.smartCursorMode,
          () => Lang.text(d.smartCursorMode === 'toggle'
            ? 'Mods.SandboxWorld.Settings.SmartCursorToggle'
            : 'Mods.SandboxWorld.Settings.SmartCursorHold'),
          () => void options.set('smartCursorMode', d.smartCursorMode === 'toggle' ? 'hold' : 'toggle'),
        ),
        this.toggle(Lang.text('Mods.SandboxWorld.Settings.SmartAxeAfterPickaxe'), () => d.smartAxeAfterPickaxe, (v) => void options.set('smartAxeAfterPickaxe', v)),
        this.toggle(Lang.text('Mods.SandboxWorld.Settings.SmartBlocks'), () => d.smartBlocksEnabled, (v) => void options.set('smartBlocksEnabled', v)),
        this.toggle(Lang.text('Mods.SandboxWorld.Settings.SmartHoldRelease'), () => d.smartHoldCanReleaseMidUse, (v) => void options.set('smartHoldCanReleaseMidUse', v)),
        // 建造饰品自动致动（builderAccStatus[2]；★SW-FX19 起读写改走玩家位面
        // player.builderAccStatus（per-player,.plr 持久化 PL:55553-55555）——原版开关
        // =背包左图标列 Main.cs:48275 case2（本仓已建,Settings 行=便捷镜像）；
        // options.builderAutoActuatorDisabled 字段退役保留（旧全局档兼容,不再读写）
        this.toggle(
          `${Lang.text('GameUI.ActuationDeviceOn').replace(/[:：].*$/, '')} / ${Lang.text('GameUI.ActuationDeviceOff').replace(/[:：].*$/, '')}`,
          () => {
            const p = (window as unknown as { __swGame?: { player: { builderAccStatus: number[] } } }).__swGame?.player;
            return (p?.builderAccStatus[2] ?? (d.builderAutoActuatorDisabled ? 1 : 0)) === 0;
          },
          (v) => {
            const p = (window as unknown as { __swGame?: { player: { builderAccStatus: number[] } } }).__swGame?.player;
            if (p) p.builderAccStatus[2] = v ? 0 : 1;
          },
        ),
        // 建造饰品自动喷漆（builderAccStatus[3]——同上,图标列 Main.cs:48252 case3）
        this.toggle(
          `${Lang.text('GameUI.PaintSprayerOn').replace(/[:：].*$/, '')} / ${Lang.text('GameUI.PaintSprayerOff').replace(/[:：].*$/, '')}`,
          () => {
            const p = (window as unknown as { __swGame?: { player: { builderAccStatus: number[] } } }).__swGame?.player;
            return (p?.builderAccStatus[3] ?? (d.builderAutoPaintDisabled ? 1 : 0)) === 0;
          },
          (v) => {
            const p = (window as unknown as { __swGame?: { player: { builderAccStatus: number[] } } }).__swGame?.player;
            if (p) p.builderAccStatus[3] = v ? 0 : 1;
          },
        ),
        // 玩家对决（Player.hostile;原版仅联机显示该 UI——Main.cs:2982 ShouldPVPDraw,
        // 单机常驻为调试便利,联机语义由协议同步压制）。显示态读【实时 player.hostile】
        // （原版会话语义:进服恒 false,与 options 上次设置无关——勿用 options 回显）
        this.toggle(Lang.text('Mods.SandboxWorld.Settings.Pvp'), () => {
          const p = (window as unknown as { __swGame?: { player: { hostile: boolean } } }).__swGame?.player;
          return p ? p.hostile : d.pvpEnabled;
        }, (v) => {
          void options.set('pvpEnabled', v);
          const p = (window as unknown as { __swGame?: { player: import('../entities/Player').Player } }).__swGame?.player;
          if (p) p.hostile = v;
        }),
        // 队伍 0-5（Player.team;点击循环切换,显示色块+序号）
        (() => {
          const row = document.createElement('div');
          row.className = 'sw-set-row';
          const span = document.createElement('span');
          span.textContent = Lang.text('Mods.SandboxWorld.Settings.PvpTeam');
          const btn = document.createElement('button');
          const render = () => {
            const t = Math.max(0, Math.min(5, (window as unknown as { __swGame?: { player: { team: number } } }).__swGame?.player.team ?? d.pvpTeam));
            btn.textContent = `${t} ▮`;
            btn.style.color = TEAM_COLORS[t] ? `rgb(${TEAM_COLORS[t][0]},${TEAM_COLORS[t][1]},${TEAM_COLORS[t][2]})` : '#fff';
          };
          btn.addEventListener('click', () => {
            const gp = (window as unknown as { __swGame?: { player: import('../entities/Player').Player } }).__swGame;
            const next = (((gp?.player.team ?? d.pvpTeam) + 1) % 6);
            void options.set('pvpTeam', next);
            if (gp) gp.player.team = next;
            render();
          });
          render();
          row.append(span, btn);
          return row;
        })(),
        // ---- M14 IngameOptions 杂项（IngameOptions.cs:647-848 逐项；行文案=原版官译）----
        // 自动保存（IngameOptions.cs:619 两版同位 Main.autoSave 默认 true；DoUpdate_AutoSave
        // 1457 :19920（1456 :19589）墙钟触发）
        this.modeRow(
          Lang.menu(67).replace(/[:：].*$/, ''),
          () => String(d.autoSave),
          () => Lang.menu(d.autoSave ? 67 : 68),
          () => void options.set('autoSave', !d.autoSave),
        ),
        // 自动保存间隔（原版恒 600000ms=10min 不可调；任务要求的 Web 便利扩展档）
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.AutoSaveInterval'),
          () => String(d.autoSaveIntervalMin),
          () => Lang.text('Mods.SandboxWorld.Settings.AutoSaveIntervalMin', d.autoSaveIntervalMin),
          () => {
            const steps = [5, 10, 20, 30];
            void options.set('autoSaveIntervalMin', steps[(steps.indexOf(d.autoSaveIntervalMin) + 1) % steps.length] ?? 10);
          },
        ),
        // ★BJ614 本地备份目录（增强,用户拍板「File System Access 做为增强选项,先在
        //  设置中可启用」,缺省关）——开=showDirectoryPicker 选目录（checkbox change=
        //  用户手势 ✓）→ 句柄入 IDB;此后每次存档成功链尾自动快照（世界/角色外观/
        //  随身态 时间戳档各留最近 3 份 + 双 index 覆盖档）。跨会话权限 prompt=自动
        //  链静默跳过+「待重新授权」按钮（不强弹）;Firefox/Safari 无 API=禁用+标注
        this.fsBackupBlock(),
        // 自动暂停（:628 Main.autoPause 默认 false,config 键 "AutoPause"
        // Main.cs:4203/:4426;原版语义=开界面暂停,CanPauseGame Main.cs:17493-17508
        // autoPause 臂 :17500-17504——★非"切 tab 暂停",失焦面归 playWhenUnfocused,
        // 两开关互不耦合。SW-BN3 2026-09-07 起 Esc 链对齐原版（背包开着 Esc=关背包）,
        // 开背包即暂停由本开关承载=背包态主暂停路径;消费 Game.applyAutoPauseUI 逐帧）
        this.modeRow(
          Lang.menu(69).replace(/[:：].*$/, ''),
          () => String(d.autoPause),
          () => Lang.menu(d.autoPause ? 69 : 70),
          () => void options.set('autoPause', !d.autoPause),
        ),
        // 失焦播放（:637-647 Main.SettingPlayWhenUnfocused 默认 false=失焦暂停+全静；
        // 消费 FocusHelper.cs:23/:85-95/:139-141 → 本仓 Game.applyFocusPause（失焦
        // 游戏暂停）+ Sfx 失焦音频闸（music 开关放行/sfx 恒停/ambient 归零分类别）。
        // 行序紧随 autoPause 与原版 Gameplay 段一致。文案键 UI.PlayWhenUnfocusedOn/Off
        // 为原版官译——键名 On/Off 与行内"暂停：开/关"文案反向是原版原文
        // （On=失焦播放,即暂停关））
        this.modeRow(
          Lang.text('UI.PlayWhenUnfocusedOn').replace(/[:：].*$/, ''),
          () => String(d.playWhenUnfocused),
          () => Lang.text(d.playWhenUnfocused ? 'UI.PlayWhenUnfocusedOn' : 'UI.PlayWhenUnfocusedOff'),
          () => void options.set('playWhenUnfocused', !d.playWhenUnfocused),
        ),
        // ★后台继续运行（2026-09-28 用户需求:后台挂机——切后台 rAF 停发=世界冻结
        // 的 Web 缺口;原版无对应物=Web 便利档,缺省开）。消费=Game.onPumpMsg 泵门
        // （document.hidden ∧ 本开关 ∧ 失焦播放 ∧ !paused → fixedUpdate 驱动+跳过
        // 渲染;回前台无缝）。与失焦播放独立并存——两开关都开才后台活,行序紧随
        // 失焦播放（同域相邻）。已知代价=后台挂机即真实 CPU 消耗（用户目的本身）;
        // Chrome 高负载后台页节流提示可忽略
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.BackgroundRun'),
          () => String(d.backgroundRun),
          () => Lang.menu(d.backgroundRun ? 69 : 70),
          () => void options.set('backgroundRun', !d.backgroundRun),
        ),
        // 显示说明书按钮（说明书勾"不再显示"后在此重开；manualHidden 落盘）
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.ShowManual'),
          () => String(!d.manualHidden),
          () => Lang.menu(!d.manualHidden ? 69 : 70),
          () => {
            void options.set('manualHidden', !d.manualHidden);
            (window as unknown as { __swUI?: { refreshManualBtn(): void } }).__swUI?.refreshManualBtn();
          },
        ),
        // 激活套装奖励键上下反转（:647 Main.ReversedUpDownArmorSetBonuses；
        // 消费=Lang 替换键 ToggleArmorSetBonusKey）
        this.modeRow(
          Lang.menu(220).replace(/[:：].*$/, ''),
          () => String(d.reversedUpDownArmorSetBonuses),
          () => Lang.menu(d.reversedUpDownArmorSetBonuses ? 220 : 221),
          () => void options.set('reversedUpDownArmorSetBonuses', !d.reversedUpDownArmorSetBonuses),
        ),
        // 智能门（:656 DoorOpeningHelper.PreferenceSettings；CyclePreferences :262
        // 序 Enabled→GamepadOnly→Disabled。行为 N-A：玩家智能门系统未移植）
        this.modeRow(
          Lang.text('UI.SmartDoorsEnabled').replace(/[:：].*$/, ''),
          () => d.doorOpeningPreference,
          () => Lang.text(d.doorOpeningPreference === 'enabled' ? 'UI.SmartDoorsEnabled'
            : d.doorOpeningPreference === 'gamepadOnly' ? 'UI.SmartDoorsGamepad' : 'UI.SmartDoorsDisabled'),
          () => void options.set('doorOpeningPreference',
            d.doorOpeningPreference === 'enabled' ? 'gamepadOnly'
              : d.doorOpeningPreference === 'gamepadOnly' ? 'disabled' : 'enabled'),
        ),
        // ★SW-FX14 2026-09-10 悬停控制（IngameOptions.cs:671-688 1:1——
        // Player.Settings.HoverControl :357 缺省 Hold，CycleHoverControl :374-377
        // = Utils.CycleControlControl_ClickHold Hold↔Click 两态互换；config 键
        // "HoverControlMode" Main.cs:4293/:4638。消费=Player.updateHoverLatch
        // （Player.cs:25452-25484）+ TryingToHoverUp/Down 取值门（:3908-3927）
        // 全消费面：WingMovement/WingFrame/WingAirLogicTweaks/贴墙靴缓降/羽落）
        this.modeRow(
          Lang.text('UI.HoverControlSettingIsHold').replace(/[:：].*$/, ''),
          () => d.hoverControl,
          () => Lang.text(d.hoverControl === 'click' ? 'UI.HoverControlSettingIsClick' : 'UI.HoverControlSettingIsHold'),
          () => void options.set('hoverControl', d.hoverControl === 'hold' ? 'click' : 'hold'),
        ),
        // 相机平移档（1457 Player.Settings.PanControl_KeyboardAndMouse :359 循环切换
        // CyclePanControl_KeyboardAndMouse :379-382 → Utils.CycleControlControl_OffOnClickHold
        // Utils.cs:159-176：Hold→Click→OnAlways→OffAlways→Hold;ButtonControlMode.cs
        // Hold=0/Click=1/OnAlways=2/OffAlways=3,缺省 Hold。消费=Game 平移四档门
        // （Main.cs:63719-63778）;原版 1457 设置 UI 未挂该行（反编译全库无调用点,
        // 本仓落设置页补 UI 面——档位序/缺省 1:1）,点击即写实时 player.panControlMode
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.PanControl'),
          () => String(d.panControlMode),
          () => Lang.text(['Mods.SandboxWorld.Settings.PanControl_Hold',
            'Mods.SandboxWorld.Settings.PanControl_Click', 'Mods.SandboxWorld.Settings.PanControl_OnAlways',
            'Mods.SandboxWorld.Settings.PanControl_OffAlways'][Math.max(0, Math.min(3, d.panControlMode))]),
          () => {
            const next = cyclePanControlMode(d.panControlMode);   // OffOnClickHold 环
            void options.set('panControlMode', next);
            const gp = (window as unknown as { __swGame?: { player: import('../entities/Player').Player } }).__swGame;
            if (gp) gp.player.panControlMode = next;   // 实时生效（options 拉取只在进图 :5525）
          },
        ),
        // 全物品自动连用（:689 Main.SettingsEnabled_AutoReuseAllItems；Player.cs:24182
        // autoReuseAllWeapons——本仓挥击 canChain 门）
        this.modeRow(
          Lang.text('UI.AutoReuseAllOn').replace(/[:：].*$/, ''),
          () => String(d.autoReuseAllItems),
          () => Lang.text(d.autoReuseAllItems ? 'UI.AutoReuseAllOn' : 'UI.AutoReuseAllOff'),
          () => void options.set('autoReuseAllItems', !d.autoReuseAllItems),
        ),
        // 事件进度条（:714 Main.invasionProgressMode 0/1/2；menu[124+mode] 官译）
        this.modeRow(
          Lang.menu(123).replace(/[:：].*$/, ''),
          () => String(d.invasionProgressMode),
          () => Lang.menu(124 + d.invasionProgressMode),
          () => void options.set('invasionProgressMode', ((d.invasionProgressMode + 1) % 3) as 0 | 1 | 2),
        ),
        // 放置预览（:727 Main.placementPreview；行为 N-A：对象放置幽灵预览未移植）
        this.modeRow(
          Lang.menu(128).replace(/[:：].*$/, ''),
          () => String(d.placementPreview),
          () => Lang.menu(d.placementPreview ? 128 : 129),
          () => void options.set('placementPreview', !d.placementPreview),
        ),
        // 突出显示新物品（:736 ItemSlot.Options.HighlightNewItems；行为 N-A：
        // 背包 newAndShiny 追踪未移植）
        this.modeRow(
          Lang.inter(117).replace(/[:：].*$/, ''),
          () => String(d.highlightNewItems),
          () => Lang.inter(d.highlightNewItems ? 117 : 116),
          () => void options.set('highlightNewItems', !d.highlightNewItems),
        ),
        // 图格网格（:745 Main.MouseShowBuildingGrid；DrawInterface_6_TileGridOption
        // 已接——Renderer.drawBuildingGrid CursorRadial 十字）
        this.modeRow(
          Lang.menu(229).replace(/[:：].*$/, ''),
          () => String(d.mouseShowBuildingGrid),
          () => Lang.menu(d.mouseShowBuildingGrid ? 229 : 230),
          () => void options.set('mouseShowBuildingGrid', !d.mouseShowBuildingGrid),
        ),
        // ★SW-AY1 #10 快速丢弃三态（Main.cs:51444-51466；menu[223] Left Shift /
        // menu[224] Left Control / menu[253] Disabled，缺省 Left Control =
        // ItemSlot.cs:28-30。循环序 Disabled→Left Control→Left Shift→Disabled；
        // 映射消费=SlotActions.quickTrashOptionsOf → AltClickEnv.opts）
        this.modeRow(
          Lang.menu(224).replace(/[:：].*$/, ''),
          () => d.quickTrashMode,
          () => Lang.menu(d.quickTrashMode === 'leftShift' ? 223
            : d.quickTrashMode === 'disabled' ? 253 : 224),
          () => void options.set('quickTrashMode', cycleQuickTrashMode(d.quickTrashMode)),
        ),
        // ★SW-AZ1 2026-09-06 附近箱参与制作开关（Player.Settings.CraftFromNearbyChests
        // Player.cs:355 默认 true；config.json 键 Main.cs:4297/:4642）。行文案 = 自有键
        // Settings.CraftFromNearbyChests（tools/l10n-custom 双语）；开/关态 = 原版官译
        // GameUI.CraftFromNearbyChestsOn/Off（CraftingUI.cs 切换 tooltip 同源）。
        // ★作用域：关=③附近 bank（盒/弹体）+④600px 世界箱整体旁路,①开箱容器/
        // ②虚空袋不受管（Recipe.cs:375-407 逐行核实——vanilla 该开关只包住 :386-397）。
        // 原版开关面在制作列表旁（CraftingUI.DrawCraftFromNearbyChestsToggle）,
        // 本仓落设置页（surface 偏差登记,语义面 1:1）
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.CraftFromNearbyChests'),
          () => String(d.craftFromNearbyChests),
          () => Lang.text(d.craftFromNearbyChests
            ? 'GameUI.CraftFromNearbyChestsOn' : 'GameUI.CraftFromNearbyChestsOff'),
          () => void options.set('craftFromNearbyChests', !d.craftFromNearbyChests),
        ),
        // ★2026-09-07 背包布局灰度 flag → ★SW-FX39(2026-09-11)缺省转正:vanilla=
        //  原版布局(缺省)/classic=旧自创布局退居回退旗(?invlayout=legacy 别名,
        //  过渡一个版本后随 classic 构建器一并退役)。
        //  (UI.ts initInGame 分派;运行期切换 → options.onChange 重建面板)。
        //  会话覆盖 ?invlayout= 优先于本行(Options.load)。
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.InventoryLayout'),
          () => d.inventoryLayout,
          () => Lang.text(d.inventoryLayout === 'vanilla'
            ? 'Mods.SandboxWorld.Settings.InventoryLayoutVanilla'
            : 'Mods.SandboxWorld.Settings.InventoryLayoutClassic'),
          () => void options.set('inventoryLayout',
            d.inventoryLayout === 'vanilla' ? 'classic' : 'vanilla'),
        ),
      );
      // 开发者模式提示已摘(2026-09-14 用户要求,行+提示同批)
      const scHint = document.createElement('div');
      scHint.className = 'sw-set-hint';
      scHint.textContent = Lang.text('Mods.SandboxWorld.Settings.SmartCursorHint');
      this.content.append(scHint);
    } else if (this.cat === 'touch') {
      // ---- 触控(mobile-adaptation-plan docs/mobile-adaptation-plan.md 模块⑤)----
      // 仅触屏会话有实效;桌面显示但写入无消费方(coarse 总闸隔离纪律)
      const d2 = options.data;
      const HUD_MODES = ['auto', 't1', 't2', 't3'] as const;
      const OP_MODES = ['auto', 'touch', 'keyboard'] as const;
      this.content.append(
        // 操作模式(2026-08-29 用户需求):默认按设备;可强制触屏档或键鼠档——
        // 切换即时生效(mainFlow 动态增删控件层/Input 世界触摸门/HudScale 档位
        // 各自读 resolveTouchMode 即席响应,无需重进世界)
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.TouchOpMode'),
          () => '',
          () => Lang.text(`Mods.SandboxWorld.Settings.Op_${d2.touchOpMode}`),
          () => {
            const i = OP_MODES.indexOf(d2.touchOpMode);
            void options.set('touchOpMode', OP_MODES[(i + 1) % OP_MODES.length]);
          },
        ),
        // 摇杆:浮动(官方手游)/固定底盘 二档
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.TouchJoystickFloat'),
          () => '',
          () => Lang.text(d2.touchJoystickFloat
            ? 'Mods.SandboxWorld.Settings.On'
            : 'Mods.SandboxWorld.Settings.Off'),
          () => { void options.set('touchJoystickFloat', !d2.touchJoystickFloat); },
        ),
        // 按钮透明度/尺寸(--mbtn-alpha/--mbtn-scale,MobileControls onChange 订阅直灌)
        this.slider(Lang.text('Mods.SandboxWorld.Settings.TouchBtnAlpha'), 0.35, 1, 0.05,
          () => d2.touchButtonAlpha, (v) => void options.set('touchButtonAlpha', v)),
        this.slider(Lang.text('Mods.SandboxWorld.Settings.TouchBtnSize'), 0.8, 1.3, 0.05,
          () => d2.touchButtonSize, (v) => void options.set('touchButtonSize', v)),
        // 长按时长(tooltip 预览/槽位拿起共用;世界触摸右键交互维持原版 400ms)
        this.slider(Lang.text('Mods.SandboxWorld.Settings.TouchLongPress'), 200, 700, 50,
          () => d2.touchLongPressMs, (v) => void options.set('touchLongPressMs', Math.round(v))),
        // 智能光标触屏初值(仅 toggle 模式生效——Hold 模式语义归电平面)
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.TouchScDefault'),
          () => '',
          () => Lang.text(d2.touchSmartCursorDefault
            ? 'Mods.SandboxWorld.Settings.On'
            : 'Mods.SandboxWorld.Settings.Off'),
          () => { void options.set('touchSmartCursorDefault', !d2.touchSmartCursorDefault); },
        ),
        // HUD 缩放档(auto=视口判定 D0/T1/T2/T3)+微调(离散档上的乘法带)
        this.modeRow(
          Lang.text('Mods.SandboxWorld.Settings.HudScaleMode'),
          () => '',
          () => Lang.text(`Mods.SandboxWorld.Settings.HudTier_${d2.hudScaleMode}`),
          () => {
            const i = HUD_MODES.indexOf(d2.hudScaleMode);
            void options.set('hudScaleMode', HUD_MODES[(i + 1) % HUD_MODES.length]);
            window.dispatchEvent(new Event('resize'));   // 手动钉档即时生效
          },
        ),
        this.slider(Lang.text('Mods.SandboxWorld.Settings.HudScaleFactor'), 0.85, 1.15, 0.05,
          () => d2.hudScaleFactor, (v) => { void options.set('hudScaleFactor', v); window.dispatchEvent(new Event('resize')); }),
      );
    } else if (this.cat === 'controls') {
      // ---- 键位重映射（M5：UIKeybindingListItem 模式——点击监听下一键；
      //      已绑定键反选解绑；Esc 取消；↺ 单项回默认）----
      for (const a of KEYBIND_ACTIONS) this.content.append(this.keybindRow(a));
      // ★BJ508 双击冲刺档（原版 UIManageControls.cs:653-663 case "sp20"——键盘控制页
      //   序在 Dash 绑定行后一位；切 DashControl AllowDoubleTap↔OnlyThroughHotkeys。
      //   消费：DoCommonDashHandle :21737 flag 只门双击支,Quick Dash 键面不受门）
      this.toggle(Lang.text('UI.DoubleTapDash'),
        () => options.data.doubleTapDash,
        (v) => { void options.set('doubleTapDash', v); });
      const btns = document.createElement('div');
      btns.className = 'sw-set-btns';
      const b = document.createElement('button');
      b.className = 'sw-set-back';
      b.style.textAlign = 'center';
      b.textContent = Lang.text('Mods.SandboxWorld.Settings.ResetKeybinds');
      b.addEventListener('click', () => {
        void options.set('keybinds', resetAllKeybinds());
        this.build();
      });
      btns.appendChild(b);
      this.content.append(btns);
      const hint = document.createElement('div');
      hint.className = 'sw-set-hint';
      hint.textContent = Lang.text('Mods.SandboxWorld.Settings.KeybindsHint');
      this.content.append(hint);
      const devHint = document.createElement('div');
      devHint.className = 'sw-set-hint';
      devHint.textContent = Lang.text('Mods.SandboxWorld.Settings.DevKeysHint');
      this.content.append(devHint);
    }
  }

  /** 语言已切换:重建标题/分栏/内容(保留 this.cat) */
  /** ★BJ614 本地备份目录块（增强选项,缺省关）：开关行+状态行+条件按钮
   *  （重新授权/重新选择目录）。状态源=F sBackup 模块（IDB 句柄=唯一真源,无
   *  Options 字段——「关」=无句柄）;后台状态变化经 onFsBackupStatusChange 订阅
   *  整面板重建回显（constructor 订阅/close 退订）。 */
  private fsBackupBlock(): HTMLElement {
    const wrap = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'sw-set-row';
    const span = document.createElement('span');
    span.textContent = Lang.text('Mods.SandboxWorld.Settings.FsBackupDir');
    const input = document.createElement('input');
    input.type = 'checkbox';
    const st = fsBackupStatus();
    input.checked = st === 'ready' || st === 'needs-permission' || st === 'broken';
    if (!fsBackupSupported()) {
      // 兼容门：showDirectoryPicker 不存在（Firefox/Safari）——禁用+标注
      input.disabled = true;
      input.checked = false;
      input.title = Lang.text('Mods.SandboxWorld.Settings.FsBackupUnsupported');
      span.title = input.title;
    } else {
      // change 事件=用户手势：pickDirectory 首个 await 即 picker 调用（模块内不
      // 前置 IDB 读）,保 transient activation;取消/失败 → build 回读真态回落
      input.addEventListener('change', () => {
        void (async () => {
          if (input.checked) await fsBackupPickDirectory();
          else await fsBackupDisable();
        })().finally(() => this.build());
      });
    }
    row.append(span, input);
    const status = document.createElement('div');
    status.className = 'sw-set-hint';
    this.fsBackupStatusEl = status;
    wrap.append(row, status);
    if (fsBackupSupported()) {
      const hint = document.createElement('div');
      hint.className = 'sw-set-hint';
      hint.textContent = Lang.text('Mods.SandboxWorld.Settings.FsBackupHint');
      wrap.append(hint);
    }
    this.renderFsBackupStatus();
    return wrap;
  }

  /** 状态行渲染（同步;目录名异步补齐带旧元素守卫;条件按钮按态挂载） */
  private renderFsBackupStatus(): void {
    const el = this.fsBackupStatusEl;
    if (!el) return;
    el.textContent = '';
    const s = fsBackupStatus();
    if (s === 'unsupported') { el.textContent = Lang.text('Mods.SandboxWorld.Settings.FsBackupUnsupported'); return; }
    if (s === 'off') { el.textContent = Lang.text('Mods.SandboxWorld.Settings.FsBackupStatusOff'); return; }
    if (s === 'ready') {
      el.textContent = Lang.text('Mods.SandboxWorld.Settings.FsBackupStatusReady', '…');
      void fsBackupDirName().then((n) => {
        if (this.fsBackupStatusEl === el && fsBackupStatus() === 'ready') {
          el.textContent = Lang.text('Mods.SandboxWorld.Settings.FsBackupStatusReady', n ?? '…');
        }
      });
      return;
    }
    el.textContent = Lang.text(s === 'needs-permission'
      ? 'Mods.SandboxWorld.Settings.FsBackupStatusAuth' : 'Mods.SandboxWorld.Settings.FsBackupStatusBroken');
    const btn = document.createElement('button');
    btn.className = 'sw-set-back';
    btn.style.padding = '4px 14px';
    btn.style.marginLeft = '8px';
    btn.textContent = Lang.text(s === 'needs-permission'
      ? 'Mods.SandboxWorld.Settings.FsBackupReauth' : 'Mods.SandboxWorld.Settings.FsBackupRepick');
    btn.addEventListener('click', () => {
      void (async () => {
        if (s === 'needs-permission') await fsBackupRequestPermission();   // click=手势
        else await fsBackupPickDirectory();
      })().finally(() => this.build());
    });
    el.append(btn);
  }

  /** 语言已切换:重建标题/分栏/内容(保留 this.cat) */
  private rebuild() {
    (this.panel.querySelector('.sw-set-title') as HTMLElement).textContent = Lang.text('LegacyMenu.14');
    (this.panel.querySelector('.sw-set-back') as HTMLElement).textContent = Lang.text('LegacyMenu.6');
    this.buildCats();
    this.build();
  }

  /** 音量下发（Audio 实例由 main.ts 注入过 options.onChange，这里同步 UISfx） */
  private applySound() {
    // UISfx 共享实例的 master + ambient 双轨
    (UISfx as unknown as { sfx: { master: number; ambient: number } }).sfx.master = options.data.sfxVol;
    (UISfx as unknown as { sfx: { master: number; ambient: number } }).sfx.ambient = options.data.ambientVol;
  }

  private applyUi() {
    UIScale.userScale = options.data.uiScale;
    UIScale.recompute();
  }
}
