// 聊天输入框（原版 Enter 开聊语义：Main.cs:18447-18462 DoUpdate_Enter_ToggleChat
// + RemadeChatMonitor 历史窗配套）。
// DOM 底部左侧半透明输入条（项目 DOM UI 范式,同 MultiplayerSelect）;单机/联机同权
// （原版 Enter 门无 netMode 项,Main.cs:18451;BJ680 拆除本仓自加的联机门）。
// 频道：Tab 切换 房间(默认)/世界(跨房全服,服务器 v8 尾部 channel 字节)。
// 键序：Enter 开/发送,Escape 关,Tab 切频道;↑/↓ = 滚聊天消息历史
// （★BJ680 定谳:原版聊天开框态 ↑↓ 唯一职责=chatMonitor.Offset 每拍 ±1 行,
//  Main.cs:18502-18513;原版无任何「发送历史回溯」机制——本仓旧「↑/↓ 翻发送
//  历史」系 S 级自增误占原版键位,已迁 Ctrl+↑/↓;原版聊天态 Ctrl 组合键仅
//  Z/X/C/V/Insert,Main.cs:20212-20231,Ctrl+方向无冲突）。
// 开合联动:开框/关框经 window CustomEvent 'sw-chat-toggle' 广播 → ChatMonitor
// 展开 500 条历史窗/收合+ResetOffset(sw-ach-toggle 同范式);↑/↓ 经
// 'sw-chat-scroll' {delta} 每事件 1 行、长按 60 行/s(=原版每拍 1 行)。
// 点击面板外(blur)关闭。
// ★ Input.keydown 对 INPUT 元素打字自动豁免游戏键位——输入期不触发跳跃等。
import { Lang } from '../i18n/Lang';
import { resolveTouchMode } from '../core/input/touchMode';
import { UISfx } from '../vui/UISfx';

export interface ChatInputOpts {
  /** 发送（text 非空;world=true 世界频道） */
  onSend: (text: string, world: boolean) => void;
}

/** 发送历史上限（环形;S 级聊天历史） */
const HISTORY_MAX = 50;

export class ChatInput {
  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private tag: HTMLSpanElement | null = null;
  private world = false;
  private readonly onSend: ChatInputOpts['onSend'];
  /** 发送历史（新在尾）;histIdx = -1 表示未在历史中（正在打字） */
  private history: string[] = [];
  private histIdx = -1;
  /** 进入历史浏览前正在编辑的草稿（Down 回到底部时恢复,shell 惯例） */
  private draft = '';

  constructor(opts: ChatInputOpts) {
    this.onSend = opts.onSend;
  }

  get isOpen() { return this.root !== null; }

  /** 角落物品点击（Main.cs:40505-40512）：未开则 OpenPlayerChat → AddChatText 在
   *  光标处插入物品 tag（[i:vid]）并同步草稿 */
  insertItemTag(tag: string): void {
    // 程序化插签不受抑制窗（Enter/Esc 关框后 300ms 内点角标曾静默丢标签，审查 P2）
    this.suppressOpenUntil = 0;
    this.open();
    if (!this.input || !this.root) return;
    const el = this.input;
    const s = el.selectionStart ?? el.value.length;
    const e2 = el.selectionEnd ?? s;
    el.value = el.value.slice(0, s) + tag + el.value.slice(e2);
    const np = s + tag.length;
    el.setSelectionRange(np, np);
    this.draft = el.value;      // Esc 收框再开不丢（草稿态同源）
    el.focus();
  }

  /** 重开抑制窗（发送的 Enter 关框后,同一次按键风暴不应立刻重开——双端 Enter 语义） */
  private suppressOpenUntil = 0;
  /** 窗口捕获键监听（开着期间挂在 window capture——不依赖输入框焦点,
   *  消灭焦点目标类玄学;close 时摘除） */
  private winKey: ((e: KeyboardEvent) => void) | null = null;
  /** 软键盘遮挡补偿监听(touch 会话 open 时挂 visualViewport;close 时摘除) */
  private onVvShift: (() => void) | null = null;
  /** 开框态按住的滚动键电平(↑/↓;keyState 等价——interval 每拍按电平出
   *  Offset ±1,Main.cs:18505-18513 if/else if Up 优先语义) */
  private heldScroll = new Set<string>();
  private scrollTimer: number | null = null;
  /** 滚动键松开监听(open 时挂 window capture;close 摘除) */
  private winKeyUp: ((e: KeyboardEvent) => void) | null = null;

  /** @param fromEnter Enter 键开框(Main.cs:18453 播 SoundID 10=Menu_Open;
   *    角标物品点击路径 Main.cs:40505-40512 开框无声——缺省 false) */
  open(fromEnter = false) {
    if (this.root) { this.input?.focus(); return; }
    if (Date.now() < this.suppressOpenUntil) return;
    if (fromEnter) UISfx.menuOpen();
    this.emitToggle(true);   // ChatMonitor 展开历史窗(drawingPlayerChat=true)
    // 触屏会话判定(单一来源):移动端输入框走"≥16px 字号+软键盘补偿"档,
    // 桌面 CSS 面逐字节不变
    const touch = resolveTouchMode() === 'touch';
    const root = document.createElement('div');
    root.className = 'sw-chatbox';   // Input mousedown 不穿透门（body 直挂件不在 .sw-root 内）
    // bottom 8px = 原版输入底板带(TextBack @ y=screenHeight-36,Main.cs:41660,
    // 高 ~28px → 带 [8,36] 自底);旧 64px 曾压住历史窗最新一行(BJ680 对齐拆弹)
    root.style.cssText = `position:fixed;left:12px;bottom:8px;z-index:60;display:flex;gap:6px;align-items:center;`
      + 'background:rgba(20,24,38,0.82);border:1px solid rgba(255,220,120,0.35);border-radius:4px;padding:4px 8px;'
      + 'font:13px ui-monospace,monospace;color:#e8e4d8;'
      + (touch ? 'max-width:calc(100vw - 24px);' : '');
    const tag = document.createElement('span');
    tag.style.cssText = 'color:#ffd76e;white-space:nowrap;';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;   // 服务器 200 字符上限（room.ts Text case 同值）
    input.style.cssText = 'background:transparent;border:none;outline:none;color:#fff;'
      // iOS 聚焦自动放大禁令:输入元素 font-size 必须 ≥16px(touch 会话硬约束)
      + (touch ? 'flex:1;width:auto;min-width:160px;font-size:16px;' : 'width:340px;font:inherit;');
    root.appendChild(tag);
    root.appendChild(input);
    document.body.appendChild(root);
    this.root = root;
    this.input = input;
    this.tag = tag;
    this.refreshTag();
    input.focus();
    // 软键盘遮挡补偿(mobile-adaptation-plan 模块④):iOS 聚焦压缩 visualViewport,
    // 把输入条抬到可视区底缘;桌面/无键盘环境 vv.height≈innerHeight=零位移
    if (touch && window.visualViewport) {
      const vv = window.visualViewport;
      this.onVvShift = () => {
        if (!this.root) return;
        const kbH = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        this.root.style.bottom = `${8 + kbH}px`;
      };
      vv.addEventListener('resize', this.onVvShift);
      vv.addEventListener('scroll', this.onVvShift);
    }
    this.winKey = (e: KeyboardEvent) => {
      // ★Issue#34：小键盘回车同权发送/关框（XNA Keys.Enter 双覆盖;见 Game.ts 开框门注）
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        const text = input.value.trim();
        const world = this.world;
        this.close(true);
        // Main.cs:18549-18553:Enter 在聊天态恒关框 + SoundID 11(Menu_Close,
        // 空文本亦关——与 ChatInput 既有「Enter 关框」一致)
        UISfx.menuClose();
        // 发送历史（S 级）：非空入列,连续重复不堆叠
        if (text && this.history[this.history.length - 1] !== text) {
          this.history.push(text);
          if (this.history.length > HISTORY_MAX) this.history.shift();
        }
        this.histIdx = -1;
        // 发送链走 window 活实例（与 onSend 同义——双路径等价,均经服务器收达验证）
        const g = (window as unknown as { __swGame?: { sendChat?: (t: string, w: boolean) => void } }).__swGame;
        if (text) g?.sendChat?.(text, world);
      } else if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && !e.isComposing && !e.metaKey) {
        // Cmd+↑/↓ 放行(浏览器输入光标到行首/行尾;原版无 Cmd 概念)
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey) {
          // Ctrl+↑/↓:发送历史回溯(S 级自增,BJ680 自裸 ↑/↓ 迁来——原版聊天态
          // Ctrl 组合仅 Z/X/C/V/Insert,Main.cs:20212-20231,Ctrl+方向无冲突)
          if (e.code === 'ArrowUp') {
            if (!this.history.length) return;
            if (this.histIdx === -1) {
              this.draft = input.value;                      // 存草稿
              this.histIdx = this.history.length - 1;
            } else if (this.histIdx > 0) this.histIdx--;
            input.value = this.history[this.histIdx] ?? '';
          } else {
            if (this.histIdx === -1) return;
            this.histIdx++;
            if (this.histIdx >= this.history.length) {       // 越过最新 → 回草稿
              this.histIdx = -1;
              input.value = this.draft;
            } else {
              input.value = this.history[this.histIdx] ?? '';
            }
          }
          return;
        }
        // 裸 ↑/↓:滚聊天消息历史(★BJ680 定谳:Main.cs:18502-18513 开框态唯一
        // 职责=chatMonitor.Offset 每拍 ±1 行)。首按即时 1 行(=原版首拍),
        // 长按经 heldScroll 电平 interval 每拍 1 行(60 行/s);keydown
        // repeat 事件忽略(interval 已覆盖,无 OS 首延迟=原版 keyState 语义)
        if (!e.repeat) {
          this.heldScroll.add(e.code);
          this.emitScrollNow();
          this.ensureScrollTimer();
        }
      } else if (e.code === 'Escape' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
      } else if (e.code === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        this.world = !this.world;
        this.refreshTag();
      }
    };
    window.addEventListener('keydown', this.winKey, true);
    // 滚动键电平维护(松键摘电平;interval 见空自停——keyState 等价)
    this.winKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') this.heldScroll.delete(e.code);
    };
    window.addEventListener('keyup', this.winKeyUp, true);
    input.addEventListener('blur', () => { this.close(); });
  }

  /** 开合广播 → ChatMonitor 历史窗展开/收合(sw-ach-toggle 同范式) */
  private emitToggle(open: boolean): void {
    window.dispatchEvent(new CustomEvent('sw-chat-toggle', { detail: { open } }));
  }

  /** 按当前 heldScroll 电平滚 1 拍(Up 优先=Main.cs:18505-18512 if/else if) */
  private emitScrollNow(): void {
    const delta = this.heldScroll.has('ArrowUp') ? 1
      : this.heldScroll.has('ArrowDown') ? -1 : 0;
    if (delta) window.dispatchEvent(new CustomEvent('sw-chat-scroll', { detail: { delta } }));
  }

  /** 长按连续滚:60Hz interval(=原版每拍 1 行;首按已即时 emitScrollNow) */
  private ensureScrollTimer(): void {
    if (this.scrollTimer != null) return;
    this.scrollTimer = window.setInterval(() => {
      if (!this.root || !this.heldScroll.size) { this.stopScrollTimer(); return; }
      this.emitScrollNow();
    }, 1000 / 60);
  }

  private stopScrollTimer(): void {
    if (this.scrollTimer != null) {
      clearInterval(this.scrollTimer);
      this.scrollTimer = null;
    }
    this.heldScroll.clear();
  }

  private refreshTag() {
    if (!this.tag) return;
    this.tag.textContent = this.world
      ? `[${Lang.text('Mods.SandboxWorld.Chat.ChannelWorld')}]`
      : `[${Lang.text('Mods.SandboxWorld.Chat.ChannelRoom')}]`;
    this.tag.style.color = this.world ? '#ffd76e' : '#9fd8ff';
  }

  /** @param byKey 键盘关闭（Enter/Esc）——置 300ms 重开抑制（防发送键残留事件重开） */
  close(byKey = false) {
    if (!this.root) return;
    if (byKey) this.suppressOpenUntil = Date.now() + 300;
    this.emitToggle(false);   // ChatMonitor 收合 + ResetOffset(Main.cs:18497-18501)
    this.stopScrollTimer();
    if (this.winKey) { window.removeEventListener('keydown', this.winKey, true); this.winKey = null; }
    if (this.winKeyUp) { window.removeEventListener('keyup', this.winKeyUp, true); this.winKeyUp = null; }
    // 软键盘补偿监听摘除(open 时 touch 会话挂入)
    if (this.onVvShift && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.onVvShift);
      window.visualViewport.removeEventListener('scroll', this.onVvShift);
      this.onVvShift = null;
    }
    // ★单飞锁(BJ680 探针定谳):root.remove() 卸载聚焦 input 会同步触发 blur →
    //   blur handler 再入 close()——旧序(先 remove 后摘引用)下再入者仍见
    //   root 非 null,双 remove 抛 NotFoundError 中断 Enter 发送尾(sendChat
    //   永不达)。先摘引用再拆 DOM,再入者 `!this.root` 早退。
    const root = this.root;
    this.root = null;
    this.input = null;
    this.tag = null;
    this.world = false;
    root.remove();
  }
}
