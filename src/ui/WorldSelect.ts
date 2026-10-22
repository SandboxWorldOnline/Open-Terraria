// 世界存档列表（DOM 版 1:1 原版 UIWorldSelect/UIWorldListItem 结构）：
//  容器/标题/列表面板/底部双钮同 UICharacterSelect；行 = 图标位 + 信息 +
//  底缘图标钮 Play/Favorite/Copy + Delete 右下 + 悬停标签。
//  行首世界图标 = 原版 GetSeedIcon 映射 1:1（AWorldListItem.cs:186-201）：
//  "Icon"+(困难?"Hallow":"")+(腐化?"Corruption":"Crimson")+秘密种子后缀
//  （HasCorruption 默认 true=每个世界必有邪恶，无中性森林图标——46 张全集恰配）。
//  多秘密种子轮播（2026-09-03 闭合）：GetIcons（AWorldListItem.cs:129-160）命中的
//  全部种子图标按注册序入列，UICyclingImage（UICyclingImage.cs:16 FramesPerCycle=45，
//  60fps 每帧 ++ → 45t=750ms 换一张）定时轮换 1:1；≥2 图标且非天顶 = 左下角
//  IconMixedSeed 混种徽标（UIWorldListItem.cs:83-93）；天顶世界不走轮播——
//  GetIconElement :172-181 直挂 IconEverythingAnimated 7×16 帧故障动画
//  （UpdateGlitchAnimation :14-33，帧间随机 3t、首帧后停 15-120t，4/8/12 帧边界
//  1/3 概率换 7 变体列）。
import { WorldStore, type WorldMeta } from '../save/WorldStore';
import { refreshStorageStatus } from '../save/StoragePersistence';   // ★BJ611 存储状态行
import { ensureStyle } from './CharSelect';
import { Lang } from '../i18n/Lang';
import { parseSeedChain } from '../world/gen/SeedEasterEggs';   // ★IIIII229 ⑥M1 parseSeed→parseSeedChain（gen 同口径）
import { saveClient } from '../workers/SaveClient';
import { menuToast } from './menuToast';                // ★BJ691 alert→菜单 toast
import { lateImageRetryDefer } from '../assets/lateImageRetry';

export interface WorldSelectFlow {
  onPlay(meta: WorldMeta): void;
  onNew(): void;
  onBack(): void;
  /** 导入世界（.wld / 本仓 .json 存档）——只落库进列表，不进入世界 */
  onImport(file: File): Promise<void>;
}

/** ★BJ694（BJ691b 债②清偿）：世界列表面「活动角色」上下文（原版 UIWorldSelect
 *  排序三前缀层的会话语义,UIWorldSelect.cs:153-158）：
 *  · CanWorldBeJoinedByActivePlayer（:163-168）= 旅程角色↔旅程世界匹配【压倒收藏】;
 *  · HasWorldBeenPlayedByActivePlayer（:170-173）= 该角色玩过此世界（原版=地图档
 *    存在,仓内等价=CharacterMeta.playedWorlds）;
 *  · IsNewlyGenerated（:157 会话旗）——本仓创建流直达游戏不重列表面=不可观测,
 *    登记不建模（世界创建后若未来接入「回列表选难度/种子」流再补）。
 *  缺省 null=无角色上下文（无此两层,退 store 序）。 */
export interface WorldSelectActiveChar {
  difficulty: number;
  playedWorlds?: number[];
}

/** ★BJ694 世界列表显示序（UIWorldSelect.cs:157-158 全序,node 可测单源）：
 *  CanJoin（旅程匹配,压倒收藏）→ [IsNewlyGenerated 会话旗不建模,见上注] → 收藏 →
 *  该角色玩过 → lastPlayed 降序 → 名（zh 音序）→ id。ac=null=store 序原样透传。 */
export function sortWorldsForChar(
  list: readonly WorldMeta[], ac: WorldSelectActiveChar | null,
): WorldMeta[] {
  if (!ac) return [...list];
  const join = (w: WorldMeta) => (ac.difficulty === 3) === (w.difficulty === 3);
  const played = (w: WorldMeta) => (ac.playedWorlds?.includes(w.id) ?? false);
  return [...list].sort((a, b) =>
    (Number(join(b)) - Number(join(a)))
    || (Number(!!b.favorite) - Number(!!a.favorite))
    || (Number(played(b)) - Number(played(a)))
    || (b.lastPlayed - a.lastPlayed)
    || a.name.localeCompare(b.name, 'zh')
    || (a.id - b.id));
}

const SIZE_LABEL = (m: WorldMeta) => Lang.text(m.w >= 8400 ? 'UI.WorldSizeLarge' : m.w >= 6400 ? 'UI.WorldSizeMedium' : 'UI.WorldSizeSmall');
const DIFF_LABEL = () => [Lang.text('UI.Normal'), Lang.text('GameUI.Expert'), Lang.text('UI.Master'), Lang.text('UI.Creative')];

const BTN_SRC = (n: string): string => `sprites/vanilla-ui/${n}.png`;

/** 触屏(无 hover)设备:行标签无法悬停唤出,构建时预填主行动文案(与 CharSelect
 *  的 TOUCH_LABELS 同源断点 hover:none+pointer:coarse,桌面恒 false 零差异) */
const TOUCH_LABELS = typeof matchMedia === 'function'
  && matchMedia('(hover: none) and (pointer: coarse)').matches;

/** 世界图标贴图名（AWorldListItem.GetIcon :87-126 1:1）：
 *  天顶=Everything(evilVariants:false) → drunk=CorruptionCrimson(evilVariants:false) →
 *  FTW/NotTheBees/Anniversary/DontStarve/Remix/Traps → Skyblock(双 variant:false) →
 *  无后缀基础图标。单值 = GetIcons 列表首项（非轮播消费方兼容口）。
 *  "Icon"+(困难?"Hallow":"")+(腐化?"Corruption":"Crimson")+秘密种子后缀；
 *  drunk 不含邪恶段——"CorruptionCrimson" 即完整后缀（2026-08-24 用户报 404 勘误） */
export function worldIconName(m: WorldMeta): string {
  const f = parseSeedChain(m.seed).flags;
  const hard = m.hardMode ? 'Hallow' : '';
  const evil = m.evil === 1 ? 'Crimson' : 'Corruption';
  // ZenithWorld（AWorldListItem.cs:108-110 GetSeedIcon("Everything", evilVariants:false)）
  if (f.everything) return `UI_Icon${hard}Everything`;
  if (f.drunkWorld) return `UI_Icon${hard}CorruptionCrimson`;
  if (f.getGoodWorld) return `UI_Icon${hard}${evil}FTW`;
  if (f.notTheBees) return `UI_Icon${hard}${evil}NotTheBees`;
  if (f.tenthAnniversary) return `UI_Icon${hard}${evil}Anniversary`;
  if (f.theConstant) return `UI_Icon${hard}${evil}DontStarve`;
  if (f.remix) return `UI_Icon${hard}${evil}Remix`;
  if (f.noTraps) return `UI_Icon${hard}${evil}Traps`;
  if (f.skyblock) return 'UI_IconSkyblock';
  return `UI_Icon${hard}${evil}`;
}

/** 世界图标轮播全集（AWorldListItem.GetIcons :129-160 1:1）：命中的【全部】秘密种子
 *  图标按注册序入列（多秘密种子世界=多图标轮播，UICyclingImage 消费）；一个都不中
 *  = 无后缀基础图标单张。天顶世界 GetIcons 原文不特判（会得 7 张），但
 *  GetIconElement :172-175 对 ZenithWorld 先行短路走故障动画，不进轮播——UI 侧同构 */
export function worldIconNames(m: WorldMeta): string[] {
  const f = parseSeedChain(m.seed).flags;
  const hard = m.hardMode ? 'Hallow' : '';
  const evil = m.evil === 1 ? 'Crimson' : 'Corruption';
  const out: string[] = [];
  if (f.drunkWorld) out.push(`UI_Icon${hard}CorruptionCrimson`);        // evilVariants:false
  if (f.getGoodWorld) out.push(`UI_Icon${hard}${evil}FTW`);
  if (f.notTheBees) out.push(`UI_Icon${hard}${evil}NotTheBees`);
  if (f.tenthAnniversary) out.push(`UI_Icon${hard}${evil}Anniversary`);
  if (f.theConstant) out.push(`UI_Icon${hard}${evil}DontStarve`);
  if (f.remix) out.push(`UI_Icon${hard}${evil}Remix`);
  if (f.noTraps) out.push(`UI_Icon${hard}${evil}Traps`);
  if (f.skyblock) out.push('UI_IconSkyblock');                          // 双 variant:false
  if (out.length > 0) return out;
  out.push(`UI_Icon${hard}${evil}`);
  return out;
}

/** UICyclingImage 换帧周期（UICyclingImage.cs:16 FramesPerCycle=45，逐 Update 帧
 *  ++；游戏 60fps → 45/60s = 750ms 换一张，序 = 列表序回绕） */
export const WORLD_ICON_CYCLE_MS = 750;

/** 完整种子串（WorldFileData.GetFullSeedText 1:1）：
 *  "{尺寸}.{难度+1}.{邪恶}.{秘密种子和}.{seed文本}"——原版种子按钮复制的就是它，
 *  粘贴进世界创建即可复现同参数世界（WorldGen.cs:11095 TryApplyingCopiedSeed）。
 *  尺寸 1/2/3 = 4200×1200/6400×1800/8400×2400；邪恶 1 腐化 2 猩红；
 *  种子和 = drunk1/bees2/ftw4/anniv8/dontstarve16/remix32/notraps64/zenith128/
 *  skyblock256（WorldFileData.GetSerializedSeedsSum :170-210,天顶位 = :201-204） */
export function fullSeedText(m: WorldMeta): string {
  const size = m.w === 4200 && m.h === 1200 ? 1 : m.w === 6400 && m.h === 1800 ? 2 : m.w === 8400 && m.h === 2400 ? 3 : 0;
  const evilNum = m.evil === 0 ? 1 : m.evil === 1 ? 2 : 0;
  const f = parseSeedChain(m.seed).flags;
  let sum = 0;
  if (f.drunkWorld) sum += 1;
  if (f.notTheBees) sum += 2;
  if (f.getGoodWorld) sum += 4;
  if (f.tenthAnniversary) sum += 8;
  if (f.theConstant) sum += 16;
  if (f.remix) sum += 32;
  if (f.noTraps) sum += 64;
  if (f.everything) sum += 128;             // ZenithWorld（WorldFileData.cs:201-204）
  if (f.skyblock) sum += 256;
  return `${size}.${m.difficulty + 1}.${evilNum}.${sum}.${m.seed}`;
}

/** 剪贴板写入（原版 Platform.Get<IClipboard>().Value；clipboard API 失败回退
 *  隐藏 textarea + execCommand——非安全上下文 http 下 clipboard API 不可用） */
function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => copyFallback(text));
  } else {
    copyFallback(text);
  }
}
function copyFallback(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* 无剪贴板环境静默 */ }
  ta.remove();
}

/** ★BJ611 状态行字节格式化（KB/MB/GB 自适应） */
function fmtBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(b / 1024))}KB`;
}

/** 天顶帧图 7×16 帧（IconEverythingAnimated 434×960 → 62×60/帧，UIWorldListItem
 *  _worldIcon 原生贴图尺寸挂载）；同 UI_Bestiary 徽标的小型附加样式（CharSelect
 *  ensureStyle 之外本面板自有的两条例则，幂等注入） */
const WSEL_CSS = `
.sw-vitem-zenith { position:absolute; left:12px; top:50%; transform:translateY(-50%);
  width:62px; height:60px; image-rendering:pixelated; pointer-events:none; }
.sw-vitem-mixed { position:absolute; left:12px; top:calc(50% + 11px);
  width:22px; height:18px; image-rendering:pixelated; pointer-events:none; }
.sw-vsel-storage { text-align:center; font-size:12px; line-height:1.5; opacity:0.75;
  padding:2px 8px 6px; user-select:none; pointer-events:none; }
.sw-vsel-storage.sw-storage-warn { color:#ff7b72; opacity:1; }
`;
let wselStyled = false;
function ensureWorldSelectStyle(): void {
  if (wselStyled || typeof document === 'undefined') return;
  wselStyled = true;
  const style = document.createElement('style');
  style.id = 'sw-vsel-extra-style';
  style.textContent = WSEL_CSS;
  document.head.appendChild(style);
}

export class WorldSelectPanel {
  private panel: HTMLElement;
  private body: HTMLElement;
  private closed = false;
  private fileInput: HTMLInputElement;
  private importBusy = false;
  /** 行内动画定时器（轮播 setInterval / 天顶故障动画 60Hz）——reload 重建与 close
   *  时全清（行 DOM 随 innerHTML='' 丢弃,孤儿 interval 会一直改写死 img.src） */
  private iconTimers = new Set<ReturnType<typeof setInterval>>();

  constructor(parent: HTMLElement, private store: WorldStore, private flow: WorldSelectFlow,
    /** ★BJ694 活动角色上下文（缺省 null=无角色域排序层,见 WorldSelectActiveChar 注） */
    private activeChar: WorldSelectActiveChar | null = null) {
    ensureStyle();
    ensureWorldSelectStyle();
    this.panel = document.createElement('div');
    this.panel.className = 'sw-vsel';
    this.panel.innerHTML = `
      <div class="sw-vsel-title sw-vbtn">${Lang.text('UI.SelectWorld')}</div>
      <div class="sw-vsel-panel sw-vpanel"><div class="sw-vsel-list"></div></div>
      <div class="sw-vsel-storage"></div>
      <div class="sw-vsel-footer">
        <button class="sw-vbtn" data-act="back">${Lang.text('UI.Back')}</button>
        <button class="sw-vbtn" data-act="import">${Lang.text('Mods.SandboxWorld.WorldSelect.Import')}</button>
        <button class="sw-vbtn" data-act="new">${Lang.text('LegacyMenu.47')}</button>
      </div>
    `;
    this.body = this.panel.querySelector('.sw-vsel-list')!;
    this.panel.querySelector('[data-act=back]')!.addEventListener('click', () => this.close(flow.onBack));
    this.panel.querySelector('[data-act=new]')!.addEventListener('click', () => this.close(flow.onNew));
    // 导入世界（自制,原版无此钮）：.wld / 本仓 .json——file input 走隐藏控件,
    // change 后清 value 允许连选同一文件;导入中按钮进 loading 态(文案+禁用)
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.wld';
    this.fileInput.style.display = 'none';
    this.panel.querySelector('[data-act=import]')!.addEventListener('click', () => {
      if (this.importBusy) return;
      this.fileInput.click();
    });
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (f) void this.runImport(f);
    });
    this.panel.appendChild(this.fileInput);
    this.unsubLang = Lang.onChange(() => { void this.reload(); });
    parent.appendChild(this.panel);
    void this.reload();
  }

  /** 导入 loading 态：按钮转「导入中…」+禁用（防重复选文件），完成后刷新列表。
   *  wld 解析是主线程同步重活——先让 loading 文案绘制（rAF 两拍）再开解析 */
  private async runImport(f: File): Promise<void> {
    if (this.importBusy) return;
    this.importBusy = true;
    const btn = this.panel.querySelector('[data-act=import]') as HTMLButtonElement | null;
    const old = btn?.textContent ?? '';
    if (btn) {
      btn.textContent = Lang.text('Mods.SandboxWorld.WorldSelect.Importing');
      btn.disabled = true;
      btn.style.opacity = '0.6';
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await this.flow.onImport(f);
      await this.reload();
    } finally {
      this.importBusy = false;
      if (btn && btn.isConnected) {
        btn.textContent = old;
        btn.disabled = false;
        btn.style.opacity = '';
      }
    }
  }

  private unsubLang: (() => void) | null = null;

  private iconBtn(parent: HTMLElement, src: string, label: string, fn: () => void): HTMLElement {
    // 24px 图标外包 .sw-vico 触控热区层(C 档 padding 6/margin -6 → 36² 热区,
    // 桌面无样式盒尺寸=img 几何零变化);click 挂热区层,img 点击冒泡仍触发
    // 返回热区层供点击后改写本行标签(种子钮复制回显)
    const wrap = document.createElement('span');
    wrap.className = 'sw-vico';
    const img = document.createElement('img');
    img.src = BTN_SRC(src);
    img.title = label;
    img.addEventListener('mouseenter', () => { this.setLabel(wrap, label, false); });
    img.addEventListener('mouseleave', () => { this.setLabel(wrap, '', false); });
    wrap.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    wrap.appendChild(img);
    parent.appendChild(wrap);
    return wrap;
  }

  private setLabel(from: HTMLElement, text: string, del: boolean): void {
    // 标签挂在各自行内——按钮就近锚所在 .sw-vitem 行内取
    // （曾查整个 panel：多行恒中第一行,hover 其它行文字串进首行,2026-08-26 用户报）
    const el = from.closest('.sw-vitem')?.querySelector(del ? '.sw-vitem-del-label' : '.sw-vitem-label');
    if (el) el.textContent = text;
  }

  /** 天顶世界行首图标（AWorldListItem.GetIconElement :172-180 + UpdateGlitchAnimation
   *  :14-33 1:1）：IconEverythingAnimated 7 列变体×16 帧，60fps 逐 Update 帧计数——
   *  当前帧 0 时每帧重掷 15-120 阈值，其余帧恒 3t 换帧；落到 4/8/12 帧时 1/3 概率
   *  （Next(3)==0）换随机变体列（Next(7)）。DOM = 62×60 canvas 按帧位 blit +
   *  60Hz 定时器（游戏帧时钟等价）。 */
  private buildZenithGlitchIcon(): HTMLElement {
    const cv = document.createElement('canvas');
    cv.width = 62; cv.height = 60;
    cv.className = 'sw-vitem-zenith';
    const cx = cv.getContext('2d');
    const img = new Image();
    img.src = BTN_SRC('UI_IconEverythingAnimated');
    let ready = false;
    img.onload = () => { ready = true; };
    let variation = 0;   // _glitchVariation
    let frame = 0;       // _glitchFrame
    let counter = 0;     // _glitchFrameCounter
    const tick = () => {
      // 天顶 60Hz 同门（红队R3⑥）：关闭/已拆离即自清（原仅静默 no-op,句柄悬空）。
      // ★IIIII216：!ready 不属关停条件——首拍(16ms)图集尚未 onload,整钟即被清
      // → 天顶列表图标永久空白（2026-09-08 用户实报）。未就位只跳过本拍等 onload;
      // 404 死路由 onerror 收钟
      if (!cx || this.closed || !this.panel.isConnected) {
        clearInterval(timer);
        this.iconTimers.delete(timer);
        return;
      }
      if (!ready) return;
      let min = 3, max = 3;
      if (frame === 0) { min = 15; max = 120; }
      // 阈值【每帧重掷】（Main.rand.Next(min, max+1) 在比较式内联求值 → [min,max]
      // 闭区间；非每轮固定阈值——分布形状 1:1）
      const threshold = min + Math.floor(Math.random() * (max - min + 1));
      if (++counter >= threshold) {
        counter = 0;
        frame = (frame + 1) % 16;
        if ((frame === 4 || frame === 8 || frame === 12) && Math.floor(Math.random() * 3) === 0) {
          variation = Math.floor(Math.random() * 7);
        }
      }
      cx.imageSmoothingEnabled = false;
      cx.clearRect(0, 0, cv.width, cv.height);
      // SetFrame(7, 16, _glitchVariation, _glitchFrame)（:32-33）
      cx.drawImage(img, variation * 62, frame * 60, 62, 60, 0, 0, 62, 60);
    };
    const timer: ReturnType<typeof setInterval> = setInterval(tick, 1000 / 60);
    // 404/坏图死路自清（不收钟=60Hz 空转;timer 已入 iconTimers,close 侧兜底仍在）
    // ★BJ705-G26 件4:终态 onerror 型迟到单发重试——首败不收钟（迟到重启命中则
    // ready=true 起拍）,重启后再败才收钟（原 404 死路语义保留）
    lateImageRetryDefer(img, BTN_SRC('UI_IconEverythingAnimated'), () => {
      clearInterval(timer);
      this.iconTimers.delete(timer);
    });
    this.iconTimers.add(timer);
    return cv;
  }

  /** ★BJ611 存储状态行（存档列表常驻小字标）：「已用 X / 配额 Y · 持久化:已授予/未授予」。
   *  未授予或近配额 → 警示色（best-effort 存储在磁盘紧张时可被系统整批清理——BJ611
   *  事故面知情）。estimate 采样口之一（启动/保存/本面板每次打开;
   *  refreshStorageStatus 幂等,持久化位走会话一次的 persist() 申请结果）。 */
  private async refreshStorageLine(): Promise<void> {
    const el = this.panel.querySelector('.sw-vsel-storage') as HTMLElement | null;
    if (!el) return;
    const st = await refreshStorageStatus();
    if (!el.isConnected) return;   // close/reload 竞态门（红队R3⑥ 同族）
    if (!st) {
      el.textContent = Lang.text('Mods.SandboxWorld.Storage.StatusUnknown');
      el.classList.remove('sw-storage-warn');
      return;
    }
    const quotaText = st.quota != null ? fmtBytes(st.quota) : Lang.text('Mods.SandboxWorld.Storage.QuotaUnknown');
    const persistedText = Lang.text(st.persisted ? 'Mods.SandboxWorld.Storage.PersistGranted' : 'Mods.SandboxWorld.Storage.PersistNotGranted');
    // ★摘除注（2026-10-10 用户明令）：quota 骤降「↓」角标随预警触发面一并摘除
    // （M97+ quota 锚磁盘总容量,环比失效）——警示色只锚持久化位/静态压力面。
    el.textContent = Lang.text('Mods.SandboxWorld.Storage.StatusLine', fmtBytes(st.usage), quotaText, persistedText);
    el.classList.toggle('sw-storage-warn', !st.persisted || st.pressure !== 'none');
  }

  async reload() {
    await this.store.ensureLoaded();
    // close/reload 竞态门（红队R3⑥）：close 可能在 ensureLoaded 的 await 窗内先行
    // 置 closed + 清定时器 + 拆面板——恢复后若无此门,下方会为已脱离 DOM 的 body
    // 重建行并新建 interval（无人再清的孤儿,永久改写死 img.src）。检查点之后到
    // 函数尾为同步段（无 await）,close 不可能再插入——一道门即封死
    if (this.closed) return;
    for (const t of this.iconTimers) clearInterval(t);   // 上轮行内的轮播/故障动画定时器全清
    this.iconTimers.clear();
    this.body.innerHTML = '';
    // ★BJ691b store 单源基础序（收藏→lastPlayed→名→id）;★BJ694 有活动角色时叠加
    // 原版两前缀层（UIWorldSelect.cs:157-158 序:CanJoin → [IsNewlyGenerated 不建模]
    // → IsFavorite → HasPlayedByActivePlayer → LastPlayed → Name → FileName）——
    // 旅程角色↔旅程世界匹配【压倒收藏】（:163-168 亲读）,玩过史再分层。
    const ac = this.activeChar;
    let list: WorldMeta[] = sortWorldsForChar(this.store.list(), ac);
    for (const meta of list) {
      const el = document.createElement('div');
      el.className = 'sw-vitem sw-vpanel-item';
      const m = meta;
      // 行首世界图标（UIWorldListItem.cs:68 GetIconElement）：天顶世界 = 7×16 帧
      // IconEverythingAnimated 故障动画（UpdateGlitchAnimation 1:1，不走轮播）；
      // 其余 = UICyclingImage（GetIcons 列表按 45t=750ms 轮换，首张=列表[0]）
      let icon: HTMLElement;
      const iconNames = worldIconNames(m);
      if (parseSeedChain(m.seed).flags.everything === true) {
        icon = this.buildZenithGlitchIcon();
      } else {
        const img = document.createElement('img');
        img.className = 'sw-vitem-icon';
        img.alt = '';
        img.src = BTN_SRC(iconNames[0]);
        if (iconNames.length > 1) {
          let idx = 0;
          const timer: ReturnType<typeof setInterval> = setInterval(() => {
            // 竞态自愈门（红队R3⑥）：行已随 close/下轮 reload 拆离 → 自清,
            // 不留孤儿 interval 永久改写脱离 DOM 的 img.src
            if (this.closed || !img.isConnected) {
              clearInterval(timer);
              this.iconTimers.delete(timer);
              return;
            }
            // UICyclingImage.Update :21-33：++frames ≥45 → 复零、++index、尾回绕、SetImage
            idx = (idx + 1) % iconNames.length;
            img.src = BTN_SRC(iconNames[idx]);
          }, WORLD_ICON_CYCLE_MS);
          this.iconTimers.add(timer);
        }
        icon = img;
      }
      // 混种徽标（UIWorldListItem.cs:83-93）：GetIcons ≥2 且非天顶 → 图标左下角
      // IconMixedSeed 22×18（HAlign 0 / VAlign 1 = 与图标盒左下角对齐）
      if (iconNames.length >= 2 && parseSeedChain(m.seed).flags.everything !== true) {
        const badge = document.createElement('img');
        badge.className = 'sw-vitem-mixed';
        badge.alt = '';
        badge.src = BTN_SRC('UI_IconMixedSeed');
        el.appendChild(badge);
      }
      // 信息块（名称 + 规格；★图标位缺数据——见头注偏差登记；布局=行绝对分区
      //  .sw-vitem-info,与角色行同构,按钮区在底缘不再压文本）
      const info = document.createElement('div');
      info.className = 'sw-vitem-info';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = (meta.favorite ? '★ ' : '') + (meta.name || Lang.text('Mods.SandboxWorld.WorldSelect.Unnamed'));
      if (meta.favorite) name.style.color = '#ffe745';
      const sub = document.createElement('div');
      sub.className = 'sub';
      const mins = Math.floor(meta.playTimeMs / 60000);
      sub.textContent = `${SIZE_LABEL(meta)} · ${meta.w}×${meta.h} · ${DIFF_LABEL()[meta.difficulty] ?? '?'} · ${Lang.text('Mods.SandboxWorld.WorldSelect.PlayTimeMins', mins)}`;
      info.append(name, sub);
      // 底缘图标钮（Play/Favorite/Copy；Delete 右下——UIWorldListItem.cs:102-158）
      const btns = document.createElement('div');
      btns.className = 'sw-vitem-btns';
      this.iconBtn(btns, 'UI_ButtonPlay', Lang.text('UI.Play'), () => this.close(() => this.flow.onPlay(m)));
      this.iconBtn(btns, meta.favorite ? 'UI_ButtonFavoriteActive' : 'UI_ButtonFavoriteInactive',
        meta.favorite ? Lang.text('UI.Unfavorite') : Lang.text('UI.Favorite'), async () => {
          await this.store.setFavorite(m.id, !m.favorite);
          await this.reload();
        });
      // 原版按钮序（UIWorldListItem.cs:95-158）：Play/Favorite/Seed/Rename/Delete——
      // 种子钮复制完整种子串（SeedButtonClick :127-131），非"复制世界"
      // ★IIIII243：复制种子=用户输入的干净原文（get fixed boi 这类文本本身就是完整种子,
      //   旗标由文本自携带;fullSeedText 的 1.1.0.255. 前缀是 TryApplyingCopiedSeed 规范
      //   形式,作为 tooltip 信息保留于 fullSeedText 导出,复制不再混入）
      const seedBtn = this.iconBtn(btns, 'UI_ButtonSeed', Lang.text('UI.CopySeed', m.seed), () => {
        copyToClipboard(m.seed);
        this.setLabel(seedBtn, Lang.text('UI.SeedCopied'), false);
      });
      this.iconBtn(btns, 'UI_ButtonRename', Lang.text('UI.Rename'), async () => {
        const name = prompt(Lang.text('UI.Rename'), m.name);
        if (name == null || name.trim() === '') return;
        await this.store.rename(m.id, name.trim());
        await this.reload();
      });
      // 导出钮(2026-09-06 用户需求):下载原版 .wld(自足格式,见 WldExport 头注)
      this.iconBtn(btns, 'UI_CharCreation_Copy', Lang.text('Mods.SandboxWorld.WorldSelect.Export'), async () => {
        try {
          const raw = await this.store.load(meta);
          if (!raw) throw new Error('存档缺失');
          // ★worker 化(2026-09-07 用户报「导出卡一下主线程」):JSON.parse+全图
          //  编码走 save.worker,产物 ArrayBuffer transfer 零拷贝;内部含主线程回退
          const bytes = await saveClient.exportWld(raw);
          const safe = (meta.name || `world${meta.id}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
          const aEl = document.createElement('a');
          aEl.href = url;
          aEl.download = `${safe}.wld`;
          aEl.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) {
          menuToast(Lang.text('Mods.SandboxWorld.CharSelect.ImportFail', String(e instanceof Error ? e.message : e).slice(0, 120)));
        }
      });
      // 删除钮（收藏防删，UIWorldListItem.cs:151-157 原版仅 !IsFavorite 挂
      // 处理器：收藏行禁用态 + 悬停显 UI.CannotDeleteFavorited）
      const del = document.createElement('div');
      del.className = 'sw-vitem-del';
      const delFn: (() => void) | null = m.favorite ? null : async () => {
        if (!confirm(Lang.text('Mods.SandboxWorld.WorldSelect.ConfirmDelete', m.name))) return;
        // ★R13-F2：删除链异常 catch+告警（★BJ691 起 toast,原 alert 习语退役）——
        //  存储面抛不留 unhandled rejection,reload 自存储重读防行显示与实态漂移
        try {
          await this.store.delete(m.id);
        } catch (e) {
          console.warn('[worldSelect] 删除落库失败', e);
          menuToast(Lang.text('Mods.SandboxWorld.CharSelect.DeleteFail', String(e instanceof Error ? e.message : e).slice(0, 120)));
        }
        await this.reload();
      };
      this.iconBtn(del, 'UI_ButtonDelete',
        m.favorite ? Lang.text('UI.CannotDeleteFavorited') : Lang.text('UI.Delete'),
        () => { if (delFn) void delFn(); });
      if (m.favorite) {
        const img = del.querySelector('img');
        if (img) { img.style.opacity = '0.35'; img.style.cursor = 'not-allowed'; }
      }
      const label = document.createElement('div');
      label.className = 'sw-vitem-label';
      if (TOUCH_LABELS) label.textContent = Lang.text('UI.Play');
      const delLabel = document.createElement('div');
      delLabel.className = 'sw-vitem-del-label';
      // 悬停标签入按钮流（跟随末钮）——原钉死 left:182px 是旧 3 钮布局，4 钮后
      // 压住按钮（2026-08-24 用户报）；按钮数角色/世界行不同，钉死必错位
      btns.append(label);
      el.append(icon, info, btns, del, delLabel);
      // 整行点击/双击 = 进入（图标钮已 stopPropagation）
      const enter = () => this.close(() => this.flow.onPlay(m));
      el.addEventListener('click', enter);
      el.addEventListener('dblclick', enter);
      this.body.appendChild(el);
    }
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'sw-vsel-empty';
      empty.textContent = Lang.text('Mods.SandboxWorld.WorldSelect.Empty');
      this.body.appendChild(empty);
    }
    // ★BJ611：存储状态行随每次列表打开/语言切换/导入删除后刷新（estimate 采样口之一）
    void this.refreshStorageLine();
  }

  close(fn?: () => void) {
    // ★防重入门（2026-08-25 用户报偶发竞态）：行同时挂 click+dblclick → enter，
    //   双击时 dblclick 仍派发到已拆离行 → 二次 close 曾重跑 fn——角色行双击即
    //   连建两层世界列表（像素级重叠），点顶层进游戏后底层浮在加载页/游戏画面上
    //   （DOM z-20 在 VUI 画布之上）；本行双击也会并发跑两次 loadWorldFlow。
    if (this.closed) return;
    this.closed = true;
    for (const t of this.iconTimers) clearInterval(t);   // 轮播/故障动画定时器随面板销毁
    this.iconTimers.clear();
    this.unsubLang?.();
    this.panel.remove();
    fn?.();
  }
}
