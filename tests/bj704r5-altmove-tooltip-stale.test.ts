// ★BJ704-R5 P1（2026-10-21 红蓝审查 F6 同族缺口）判别锁。
//  定谳：Shift/Ctrl 替代点击（altMoveClick,mousedown 支）可原地清空/换掉悬停槽
//  （Ctrl 快速回收/Shift 快移/guide 对换）——无边界事件（鼠标未离格）→ 旧气泡
//  残留+跟随臂携之漂移（R5 探针 B2:display block 内容陈旧;B3:+6px 跟随;B4:出槽
//  mouseleave 才自愈）。F6（清偿A-F6,mouseup pickUp 支）只盖了拾取面。原版=
//  ItemSlot.MouseHover 逐帧重评（ItemSlot.cs:3169 起;context 6 桶固定串外,
//  `if (!item.IsAir)` 才置 Main.hoverItemName → 空槽零 tooltip,内容变更当帧
//  重渲染）。修=altMoveClick 成功后按槽新态分流：空→hideCursorTooltip;
//  变（id/词缀/堆数）→重走 showSlotHintTouch 同 enter 路径;门同 F6
//  （tooltipFollowsCursor=只管光标支槽位泡,元素锚气泡不动）。
//  ★变异自证：M1 回退为单行 `altMoveClick(...) return;`（无 before/after 分流）→
//  §1/§3 恰红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');

describe('§1 mousedown 支替代点击后悬停泡分流（M1 位）', () => {
  it('altMoveClick 前取 before、成功后按 after 分流：空→hide/变→重渲染', () => {
    const src = readFileSync(join(GAME, 'src', 'ui', 'UI.ts'), 'utf8');
    // 前置快照在调用前
    expect(src).toContain('const before = this.slotContent(where, i);');
    expect(src.indexOf('const before = this.slotContent(where, i);'))
      .toBeLessThan(src.indexOf('this.altMoveClick(i, where, e.shiftKey, e.ctrlKey, panelOpen)'));
    // 门同 F6（光标支专属;元素锚气泡不进）
    expect(src).toMatch(/if \(this\.tooltipFollowsCursor && this\.tooltip\.style\.display === 'block'\) \{\s*\n\s*const after = this\.slotContent\(where, i\);/);
    // 空槽→隐藏（原版 IsAir 零 tooltip 同相）
    expect(src).toContain('if (!after) this.hideCursorTooltip();');
    // 内容变（id/词缀/堆数）→重走 enter 同路径重渲染
    expect(src).toContain("|| after.stack !== before?.stack) this.showSlotHintTouch(i, where, host);");
  });
  it('旧形零残留：单行裸 return（无分流）形态已清', () => {
    const src = readFileSync(join(GAME, 'src', 'ui', 'UI.ts'), 'utf8');
    expect(src).not.toContain('&& this.altMoveClick(i, where, e.shiftKey, e.ctrlKey, panelOpen)) return;');
  });
});

describe('§2 反编译锚：MouseHover 逐帧重评,空槽零 tooltip', () => {
  it('IsAir 不置 hoverItemName（ItemSlot.cs:3169 起;R5 引 :3174/:3179 为 hoverItemName 置位行族）', () => {
    const van = readFileSync(join(VAN, 'Terraria.UI', 'ItemSlot.cs'), 'utf8');
    const i = van.indexOf('public static void MouseHover(Item[] inv, int context = 0, int slot = 0)');
    expect(i).toBeGreaterThan(-1);
    const block = van.slice(i, i + 900);
    expect(block).toContain('if (!item.IsAir)');
    expect(block).toContain('Main.hoverItemName = item.Name;');
    // context 6（垃圾桶）固定串=唯一 air 例外,与悬停槽链无关
    expect(block).toContain('if (context == 6 && Main.hoverItemName == null)');
  });
});

describe('§3 门平价：与 F6（mouseup pickUp 支）同门', () => {
  it('F6 门在位（heldStack 分流）且新支同用 tooltipFollowsCursor 门', () => {
    const src = readFileSync(join(GAME, 'src', 'ui', 'UI.ts'), 'utf8');
    expect(src).toContain('if (this.heldStack && this.tooltipFollowsCursor');
    expect(src).toContain('this.hideCursorTooltip();');
    // 两处光标支门（F6 mouseup + 本刀 mousedown）
    expect((src.match(/this\.tooltipFollowsCursor && this\.tooltip\.style\.display === 'block'/g) ?? []).length)
      .toBeGreaterThanOrEqual(2);
  });
});
