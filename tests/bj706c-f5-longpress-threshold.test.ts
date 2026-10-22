// ★BJ706-C（2026-10-22 用户实报「长按 F5 要松开才开始/结束录制,玩家不知道要按
//  多久」）判别锁：长按=按住满 F5_LONGPRESS_MS 当场触发,松手无动作。
//  旧形态=keydown 只记锚、keyup 结算（长按意图憋到松手）;新形态=keydown 起
//  setTimeout 阈值定时器当场调 triggerF5Longpress 并清 f5DownAt（keyup 对已
//  消费态 no-op）,keyup 保留:①短按（阈值内松开→调试报告）②节流兜底（后台标签
//  setTimeout 滞后时 held 已过阈值→当场结算）③blur 取消（手势打断防后台意外
//  开关录制）。main.ts 为浏览器入口不可直接 import——源级结构锁（仓内既有习语）。
//  ★M1 变异：回旧形态（摘定时器）→ §1/§3 红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');

describe('§1 阈值到达即触发（keydown 定时器）', () => {
  it('keydown F5 起 setTimeout(F5_LONGPRESS_MS) 且回调调 triggerF5Longpress 并消费 f5DownAt', () => {
    expect(SRC).toContain('f5LongpressTimer = setTimeout(() => {');
    expect(SRC).toMatch(/setTimeout\(\(\) => \{\s*\n\s*if \(!f5DownAt\) return;/);
    expect(SRC).toContain('f5DownAt = 0;                 // 消费：后续 keyup no-op（长按已当场动作）');
    expect(SRC).toContain('triggerF5Longpress();');
    expect(SRC).toMatch(/f5LongpressTimer = setTimeout[\s\S]{0,200}F5_LONGPRESS_MS\);/);
  });
  it('旧形态零残留：无「keyup 独占结算长按」的 toggle 调用（长按动作已抽出为函数）', () => {
    // triggerF5Longpress 定义恰好一处 + 调用恰两处（keydown 定时器 + keyup 兜底）
    expect((SRC.match(/const triggerF5Longpress/g) ?? []).length).toBe(1);
    expect((SRC.match(/triggerF5Longpress\(\);/g) ?? []).length).toBe(2);
  });
});

describe('§2 keyup 侧三职', () => {
  it('已消费 no-op + 短按报告 + 节流兜底 + 定时器撤销', () => {
    expect(SRC).toContain("e.code !== 'F5' || !f5DownAt) return;");   // 已消费（=0）no-op
    expect(SRC).toContain('clearTimeout(f5LongpressTimer);   // 阈值内松开：撤长按定时器');
    expect(SRC).toMatch(/if \(held < F5_LONGPRESS_MS\) \{\s*\n\s*\/\/ 短按：一键调试报告/);
    expect(SRC).toContain('// 长按节流兜底：后台标签 setTimeout 被浏览器节流滞后');
  });
  it('blur 取消在位（手势打断防后台意外触发）', () => {
    expect(SRC).toMatch(/addEventListener\('blur', \(\) => \{\s*\n\s*clearTimeout\(f5LongpressTimer\);\s*\n\s*f5DownAt = 0;/);
  });
});

describe('§3 长按动作体（录制窗开关+导出下载）仍在', () => {
  it('triggerF5Longpress 内含 toggle/audioRec/导出/下载链', () => {
    const i = SRC.indexOf('const triggerF5Longpress');
    const body = SRC.slice(i, i + 2000);
    expect(body).toContain('rec.toggle()');
    expect(body).toContain('game.audioRec?.toggle()');
    expect(body).toContain('behavior-log-');
  });
});
