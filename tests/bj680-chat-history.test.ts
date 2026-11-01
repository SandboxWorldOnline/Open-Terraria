// ★BJ680 判别锁:Enter 聊天历史回看(RemadeChatMonitor 1:1)。
// 用户主诉:「原版按回车可以查看历史消息(死亡、npc、事件这些),现在我们好像还没有」
// 锁面(①-⑥ = 任务书验证清单):
//  ① 500 环形池:Insert(0) 头插 + 尾删(RemadeChatMonitor.cs:13,40-53);消息
//    永不按时间删除(时间只淘汰关框态显示)
//  ② 显示期 600 拍(ChatMessageContainer.cs:33)逐拍 -1(:45-52),只作用于
//    「关框态」显示门(CanBeShownWhenChatIsClosed :23;DrawChat :79 门
//    `drawingPlayerChat | CanBeShownWhenChatIsClosed`)——开框全量可显示
//  ③ offset 行级滚动/钳制(Offset :132-135 / ClampMessageIndex :138-175 上界=
//    总行数-showCount)/ ResetOffset(:177-180)
//  ④ 开框窗口=offset 起的 ≤10 视觉行(DrawChat :55-98;折行消息按行数计,
//    窗口切进消息中部=行界区间)——旧消息可回看=用户主诉面
//  ⑤ ↑↓ 键位定谳:裸 ↑/↓=滚消息历史(原版开框态唯一职责,Main.cs:18502-18513;
//    原版无任何「发送历史回溯」机制);本仓 S 级发送历史迁 Ctrl+↑/↓(原版聊天态
//    Ctrl 组合仅 Z/X/C/V/Insert,Main.cs:20212-20231,无冲突);长按 60 行/s
//    =每拍 1 行(keyState 语义,非 OS repeat 近似)
//  ⑥ Enter/Esc 联动:ChatInput 开/关框经 'sw-chat-toggle' 广播、↑/↓ 经
//    'sw-chat-scroll'(sw-ach-toggle 同范式);关框 ResetOffset(Main.cs:18497-18501)
// 测试形态:ChatHistoryModel 纯逻辑面(node 无 DOM,b2b-worldcanvas-retire 先例);
// 视图/接线面走源码锚锁。变异自证面:摘 500 池/摘开框门/摘联动监听应恰红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChatHistoryModel } from '../src/ui/ChatMonitor';

const CHAT_SRC = readFileSync(join(__dirname, '../src/ui/ChatMonitor.ts'), 'utf-8');
const INPUT_SRC = readFileSync(join(__dirname, '../src/ui/ChatInput.ts'), 'utf-8');
const GAME_SRC = readFileSync(join(__dirname, '../src/core/Game.ts'), 'utf-8');

/** 便捷:span 序(走查序=窗口底→顶)映射为 [文本, from-to] */
const windowTexts = (m: ChatHistoryModel, open: boolean): Array<[string, string]> =>
  m.visibleWindowSpans(open).map(s => {
    const e = m.entries[s.idx];
    return [e.text, `${s.from}-${s.to}`];
  });

describe('Issue#34 小键盘回车双接受（XNA Keys.Enter 覆盖双物理键）', () => {
  it('结构锁:开框门与发送门均含 NumpadEnter 分支', () => {
    expect(GAME_SRC).toContain("code === 'NumpadEnter'");
    const CHAT = readFileSync(join(__dirname, '..', 'src', 'ui', 'ChatInput.ts'), 'utf8');
    expect(CHAT).toContain("e.code === 'Enter' || e.code === 'NumpadEnter'");
  });
});

describe('① 池:500 环形(RemadeChatMonitor.cs:13,40-53)', () => {
  it('Insert(0) 头插=新在 entries[0];第 501 条入池,第 1 条被尾删', () => {
    const m = new ChatHistoryModel();
    for (let i = 1; i <= 500; i++) m.addNewMessage(`m${i}`, 255, 255, 255, -1);
    expect(m.entries.length).toBe(500);
    expect(m.entries[0].text).toBe('m500');
    expect(m.entries[499].text).toBe('m1');
    m.addNewMessage('m501', 255, 255, 255, -1);
    expect(m.entries.length).toBe(500);          // 上限恒 500
    expect(m.entries[0].text).toBe('m501');
    expect(m.entries[1].text).toBe('m500');
    expect(m.entries[499].text).toBe('m2');      // 第 1 条被挤出
  });

  it('消息永不按时间删除:tick 过显示期后仍在池内(时间零删除,关框只影响显示)', () => {
    const m = new ChatHistoryModel();
    m.addNewMessage('keep', 255, 255, 255, -1);
    for (let i = 0; i < 700; i++) m.tick();
    expect(m.entries.length).toBe(1);
    expect(m.entries[0].text).toBe('keep');
    expect(m.entries[0].timeLeft).toBe(0);       // 地板 0,无负值回绕
  });
});

describe('② 显示期:600 拍,只淘汰关框态显示(ChatMessageContainer.cs:23,33)', () => {
  it('每条 timeLeft=600;tick 全池逐拍 -1(:45-52)', () => {
    const m = new ChatHistoryModel();
    m.addNewMessage('a', 1, 2, 3, -1);
    m.addNewMessage('b', 4, 5, 6, -1);
    expect(m.entries.every(e => e.timeLeft === 600)).toBe(true);
    m.tick();
    expect(m.entries.every(e => e.timeLeft === 599)).toBe(true);
  });

  it('关框态:600 拍后整窗消失;开框态:同条目照常显示(DrawChat :79 门)', () => {
    const m = new ChatHistoryModel();
    m.addNewMessage('gone-when-closed', 255, 255, 255, -1);
    for (let i = 0; i < 600; i++) m.tick();
    expect(m.visibleWindowSpans(false)).toEqual([]);              // 关框=无显示
    expect(m.visibleWindowSpans(true)).toEqual([{ idx: 0, from: 0, to: 0 }]);   // 开框=照常
  });

  it('关框显示门在第 600 拍整点翻转(599 拍仍显示;tick 返回跨期沿供重渲染)', () => {
    const m = new ChatHistoryModel();
    m.addNewMessage('x', 255, 255, 255, -1);
    for (let i = 0; i < 599; i++) m.tick();
    expect(m.visibleWindowSpans(false).length).toBe(1);
    expect(m.tick()).toBe(true);                  // 第 600 拍:跨界沿
    expect(m.visibleWindowSpans(false).length).toBe(0);
    expect(m.tick()).toBe(false);                 // 已 0 不再跨
  });
});

describe('③ offset 行级滚动/钳制/复位(:132-135,:138-175,:177-180)', () => {
  it('↑=+1 向更旧;↓=-1 回新;ResetOffset 归 0', () => {
    const m = new ChatHistoryModel();
    for (let i = 1; i <= 20; i++) m.addNewMessage(`m${i}`, 255, 255, 255, -1);
    m.offset(1); expect(m.offsetLine).toBe(1);
    m.offset(1); expect(m.offsetLine).toBe(2);
    m.offset(-1); expect(m.offsetLine).toBe(1);
    m.resetOffset(); expect(m.offsetLine).toBe(0);
    m.offset(-5); expect(m.offsetLine).toBe(0);   // 下界 0(不越新)
  });

  it('钳制:上界=总行数-showCount(20 行池=10);不足一窗(5 行)=不可滚', () => {
    const m = new ChatHistoryModel();
    for (let i = 1; i <= 20; i++) m.addNewMessage(`m${i}`, 255, 255, 255, -1);
    for (let i = 0; i < 30; i++) m.offset(1);
    expect(m.offsetLine).toBe(10);
    const small = new ChatHistoryModel();
    for (let i = 1; i <= 5; i++) small.addNewMessage(`s${i}`, 255, 255, 255, -1);
    small.offset(3);
    expect(small.offsetLine).toBe(0);
  });

  it('多行消息按视觉行计(LineCount):4 行条目占 4 行滚动粒度', () => {
    const m = new ChatHistoryModel();
    m.addNewMessage('single', 255, 255, 255, -1);            // 1 行
    m.addNewMessage('multi', 255, 255, 255, -1, 4);          // 4 行
    m.addNewMessage('tail', 255, 255, 255, -1);              // 1 行
    expect(m.totalLineCount()).toBe(6);                      // 6 行 < 10 窗 = 不可滚
    m.offset(1); expect(m.offsetLine).toBe(0);
  });
});

describe('④ 开框窗口=offset 起的 ≤10 行(DrawChat :55-98)', () => {
  it('offset=0:最新 10 条;走查序首项=窗口底行=最新条(新在底)', () => {
    const m = new ChatHistoryModel();
    for (let i = 1; i <= 15; i++) m.addNewMessage(`m${i}`, 255, 255, 255, -1);
    const spans = m.visibleWindowSpans(true);
    expect(spans.length).toBe(10);
    expect(m.entries[spans[0].idx].text).toBe('m15');   // 底=最新
    expect(m.entries[spans[9].idx].text).toBe('m6');    // 顶=第 10 新
  });

  it('offset=5:窗口=m10..m1(旧消息可回看=用户主诉面)', () => {
    const m = new ChatHistoryModel();
    for (let i = 1; i <= 15; i++) m.addNewMessage(`m${i}`, 255, 255, 255, -1);
    m.offset(5);
    const spans = m.visibleWindowSpans(true);
    expect(m.entries[spans[0].idx].text).toBe('m10');
    expect(m.entries[spans[spans.length - 1].idx].text).toBe('m1');
  });

  it('折行条目部分入窗:span 切在行界(from/to 含两端;行级窗口语义)', () => {
    const m = new ChatHistoryModel();
    // 布局(新→旧):multi4(4 行) b4 b3 b2 b1 b0 a2 a1 a0 = 12 行,上界 2
    for (let i = 0; i < 3; i++) m.addNewMessage(`a${i}`, 255, 255, 255, -1);
    for (let i = 0; i < 5; i++) m.addNewMessage(`b${i}`, 255, 255, 255, -1);
    m.addNewMessage('multi4', 255, 255, 255, -1, 4);
    m.offset(2);        // 落在 multi4 第 3 行(行索引 2)
    const texts = windowTexts(m, true);
    expect(texts[0]).toEqual(['multi4', '2-3']);      // 底行=multi4 后 2 行
    expect(texts.slice(1).map(t => t[1])).toEqual(['0-0', '0-0', '0-0', '0-0', '0-0', '0-0', '0-0', '0-0']);   // b4..b0,a2,a1
    expect(texts.length).toBe(9);                     // 2+8=10 行,9 条目
  });

  it('开框+滚动期新消息到达:窗口按行索引锚定(Insert(0)+固定 start=内容向新漂移,原版同构)', () => {
    const m = new ChatHistoryModel();
    for (let i = 1; i <= 12; i++) m.addNewMessage(`m${i}`, 255, 255, 255, -1);
    m.offset(2);   // entries 新在头:跳 2 行(m12,m11)→ 窗底=idx2=m10
    expect(m.entries[m.visibleWindowSpans(true)[0].idx].text).toBe('m10');
    m.addNewMessage('newest', 255, 255, 255, -1);      // Insert(0);start 不补偿
    // 原版 _startChatLine 不随新消息调整:AddNewMessage 不动它(零补偿)
    // → 同 start=2 现跳过 newest+m12 → 窗底=m11:窗口内容向新漂 1 行(原版同构)
    const spans = m.visibleWindowSpans(true);
    expect(spans[0].idx).toBe(2);
    expect(m.entries[spans[0].idx].text).toBe('m11');
  });

  it('关框窗=最新侧未超时条目(旧 10 行浮层行为兼容)', () => {
    const m = new ChatHistoryModel();
    for (let i = 1; i <= 12; i++) m.addNewMessage(`m${i}`, 255, 255, 255, -1);
    const texts = windowTexts(m, false);
    expect(texts.length).toBe(10);
    expect(texts[texts.length - 1][0]).toBe('m3');     // 顶=第 10 新
    expect(texts[0][0]).toBe('m12');                   // 底=最新
  });
});

describe('⑤ ↑↓ 键位定谳(Main.cs:18502-18513;S 级发送历史迁位)', () => {
  it('裸 ↑/↓=滚消息历史:sw-chat-scroll 事件 + 首按即时/长按 60 行/s 电平驱动', () => {
    expect(INPUT_SRC).toContain("'sw-chat-scroll'");
    expect(INPUT_SRC).toContain('this.heldScroll.add(e.code);');
    expect(INPUT_SRC).toContain('}, 1000 / 60);');     // 每拍 1 行(keyState 语义)
  });

  it('发送历史(S 级)只在 Ctrl+↑/↓ 分支内(裸 ↑↓ 路径零 histIdx 触碰)', () => {
    const ctrlGate = INPUT_SRC.indexOf('if (e.ctrlKey) {');
    expect(ctrlGate).toBeGreaterThan(0);
    // ↑↓ 分支起点(裸键路径)→ ctrlGate 之间不出现任何发送历史浏览
    // (Enter 分支的发送入列/复位 histIdx=-1 不在 ↑↓ 路径上,不在切片内)
    const arrowAt = INPUT_SRC.indexOf("} else if ((e.code === 'ArrowUp' || e.code === 'ArrowDown')");
    expect(arrowAt).toBeGreaterThan(0);
    expect(arrowAt).toBeLessThan(ctrlGate);
    const barePath = INPUT_SRC.slice(arrowAt, ctrlGate);
    expect(barePath).not.toContain('this.histIdx');
    expect(barePath).not.toContain('this.history[');
    // 发送历史浏览本体在 Ctrl 门后(draft 存草稿=浏览入口特征)
    expect(INPUT_SRC.indexOf('this.draft = input.value;')).toBeGreaterThan(ctrlGate);
    // 裸 ↑↓ 分支(定谳注释)在位
    expect(INPUT_SRC.indexOf('Main.cs:18502-18513 开框态唯一')).toBeGreaterThan(0);
  });

  it('Game.ts Enter 门无 netMode 项(单机同权,Main.cs:18451)+ fromEnter 开框声(Main.cs:18453)', () => {
    // ★Issue#34 改判史：Enter 门扩 'Enter'∪'NumpadEnter' 双接受（XNA Keys.Enter
    //   覆盖双物理键;旧锁钉单 'Enter' 字面=小键盘回车开不了聊天的病灶本体）
    // ★BJ744 改判史：BJ742 R22-8 补 Alt 守卫（Main.cs:18449 !LeftAlt&&!RightAlt
    //  ——Alt+Enter=全屏切换组合不开聊;浏览器 e.altKey 电平面=左右 Alt 合一单旗）
    //  ——门串随刀加 `&& !e.altKey` 位（跨行整串锁,保位序）。
    expect(GAME_SRC).toContain("(code === 'Enter' || code === 'NumpadEnter') && !e.altKey\n        && !this.input.uiBlocking && this.spectatingSlot < 0) {");
    expect(GAME_SRC).toContain('this.chatInput.open(true)');
    expect(GAME_SRC).not.toContain("code === 'Enter' && this.net?.active");
    // 单机 Say 本地回显(Main.cs:18545-18548 netMode==0 形态)
    expect(GAME_SRC).toContain('if (!net?.active) {');
    expect(GAME_SRC).toContain('`<${nameSp}> ${text}`');
  });
});

describe('⑥ Enter/Esc 联动(ChatInput ↔ ChatMonitor;几何/常量面)', () => {
  it('ChatInput 开框广播 sw-chat-toggle{open:true};一切关框路径广播 open:false', () => {
    expect(INPUT_SRC).toContain("new CustomEvent('sw-chat-toggle', { detail: { open } })");
    expect(INPUT_SRC).toContain('this.emitToggle(true);');
    expect(INPUT_SRC).toContain('this.emitToggle(false);');
  });

  it('ChatMonitor 监听双事件;关框=ResetOffset(Main.cs:18497-18501 关框期恒 0)', () => {
    expect(CHAT_SRC).toContain("window.addEventListener('sw-chat-toggle', this.onToggle);");
    expect(CHAT_SRC).toContain("window.addEventListener('sw-chat-scroll', this.onScroll);");
    expect(CHAT_SRC).toContain('if (!open) this.model.resetOffset();');
    // clear() 摘监听(退世界 Main.cs:49030-49033;防 world 重入双收)
    expect(CHAT_SRC).toContain("window.removeEventListener('sw-chat-toggle', this.onToggle);");
  });

  it('几何:行高 22(Main.cs:84 num5*22)+ 最新行顶锚 58=容器 bottom:36(58-22)', () => {
    expect(CHAT_SRC).toContain('line-height: 22px');
    expect(CHAT_SRC).toContain('bottom: 36px');
    expect(CHAT_SRC).toContain('left: 88px');
  });

  it('常量面:500 池 / 10 行窗 / 600 拍显示期', () => {
    expect(CHAT_SRC).toContain('MAX_MESSAGES = 500');
    expect(CHAT_SRC).toContain('SHOW_COUNT = 10');
    expect(CHAT_SRC).toContain('SHOW_TICKS = 600');
  });
});
