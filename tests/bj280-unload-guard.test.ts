// ★BJ280（2026-09-22）页面刷新/关闭存档拦截守卫：
//  · 行为面：src/save/UnloadGuard.ts 纯核直驱——beforeunload 处理器工厂断言
//    preventDefault/returnValue（任务处方测试①②③④对应矩阵）；隐藏兜底判定矩阵。
//  · 结构锁：mainFlow.ts 装配面（enterGame 置位 / 手动保存·回标题清除 / 监听器
//    安装 / 隐藏兜底 / saveAndReload 通道）与 main.ts 横幅接线——mainFlow 依赖
//    全量 DOM 装配不可在 node boot,按 save-binary-deadpath.test.ts 的 codeOf
//    源码锚模式锁死（摘 dirty 置位/摘 handler 变异即爆红）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  unloadGuardShouldBlock,
  makeBeforeUnloadHandler,
  hiddenBackstopShouldSave,
} from '../src/save/UnloadGuard';

const ROOT = resolve(__dirname, '..');
/** 源码剥行注释后取码面（结构锁只禁代码改动,判定注释含词不误伤） */
const codeOf = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/^\s*\/\/.*$/gm, '');

type UnloadEvent = Parameters<ReturnType<typeof makeBeforeUnloadHandler>>[0];
/** 最小事件桩：preventDefault 调用记录 + returnValue 赋值捕获 */
function makeEventStub() {
  const calls: string[] = [];
  const ev = {
    preventDefault: () => { calls.push('preventDefault'); },
    returnValue: undefined as unknown as string,
  };
  return { ev: ev as unknown as UnloadEvent, calls, raw: ev };
}

describe('BJ280 行为面：unloadGuardShouldBlock 判定矩阵', () => {
  it('①进世界 dirty → 拦', () => {
    expect(unloadGuardShouldBlock(true, false)).toBe(true);
  });
  it('②保存链完成清 dirty → 不拦', () => {
    expect(unloadGuardShouldBlock(false, false)).toBe(false);
  });
  it('③标题态（从未 dirty）→ 不拦', () => {
    expect(unloadGuardShouldBlock(false, false)).toBe(false);
  });
  it('④SaveAndQuit 保存屏（quitting,保存链自带确认）→ 不拦', () => {
    expect(unloadGuardShouldBlock(true, true)).toBe(false);
  });
});

describe('BJ280 行为面：beforeunload 处理器（preventDefault + returnValue 两行标准）', () => {
  const handlerOf = (dirty: boolean, quitting: boolean) =>
    makeBeforeUnloadHandler(() => ({ dirty, quitting }));

  it('①dirty 会话：preventDefault 被调 + returnValue=\'\'（原生确认触发）', () => {
    const h = handlerOf(true, false);
    const { ev, calls, raw } = makeEventStub();
    h(ev);
    expect(calls).toContain('preventDefault');
    expect(raw.returnValue).toBe('');
  });

  it('②保存后清 dirty：不 preventDefault（ returnValue 不被写）', () => {
    const h = handlerOf(false, false);
    const { ev, calls, raw } = makeEventStub();
    h(ev);
    expect(calls).toEqual([]);
    expect(raw.returnValue).toBeUndefined();
  });

  it('③标题态：不拦', () => {
    const h = handlerOf(false, false);
    const { ev, calls } = makeEventStub();
    h(ev);
    expect(calls).toEqual([]);
  });

  it('④SaveAndQuit 保存中（dirty+quitting）：不拦——保存链自带确认,BJ144 面不互撕', () => {
    const h = handlerOf(true, true);
    const { ev, calls } = makeEventStub();
    h(ev);
    expect(calls).toEqual([]);
  });

  it('handler 反复触发幂等（连点刷新/多事件源）', () => {
    const h = handlerOf(true, false);
    const a = makeEventStub(); const b = makeEventStub();
    h(a.ev); h(b.ev);
    expect(a.raw.returnValue).toBe('');
    expect(b.raw.returnValue).toBe('');
  });
});

describe('BJ280 行为面：visibilitychange hidden 兜底判定', () => {
  const base = { dirty: true, quitting: false, hasGame: true, saveInFlight: false, autoSaveEnabled: true, mpClient: false };
  it('dirty 会话切后台 → 触发静默自动保存', () => {
    expect(hiddenBackstopShouldSave(base)).toBe(true);
  });
  it('★2026-11-02 用户实报改判：autoSave 关闭 → 兜底不触发（关 tab 不再静默保存）', () => {
    expect(hiddenBackstopShouldSave({ ...base, autoSaveEnabled: false })).toBe(false);
  });
  it('★同刀同族：MP 客户端会话 → 兜底不触发（同步快照勿写本地档;房主照常,原版 netMode==1 永不存世界）', () => {
    expect(hiddenBackstopShouldSave({ ...base, mpClient: true })).toBe(false);
  });
  it('退出保存中（quitting）→ 不并发第二链（BJ144 互斥）', () => {
    expect(hiddenBackstopShouldSave({ ...base, quitting: true })).toBe(false);
  });
  it('在途保存（saveInFlight）→ 不重叠双链', () => {
    expect(hiddenBackstopShouldSave({ ...base, saveInFlight: true })).toBe(false);
  });
  it('标题态（无 game 实例）→ 不保存', () => {
    expect(hiddenBackstopShouldSave({ ...base, hasGame: false })).toBe(false);
  });
  it('已清 dirty（手动保存成功后）→ 不保存', () => {
    expect(hiddenBackstopShouldSave({ ...base, dirty: false })).toBe(false);
  });
});

describe('BJ280 结构锁：mainFlow 装配面（变异靶：摘 dirty 置位/摘 handler 即红）', () => {
  const flow = codeOf('src/mainFlow.ts');

  it('监听器装配：beforeunload handler 工厂以 (worldDirty, quitting) 闭包实参安装', () => {
    expect(flow).toMatch(/window\.addEventListener\('beforeunload',\s*\n?\s*makeBeforeUnloadHandler\(\(\) => \(\{ dirty: worldDirty, quitting \}\)\)\)/);
  });

  it('dirty 置位：enterGame（onWorldReady 唯一收口）内 worldDirty = true', () => {
    const enterGame = flow.match(/function enterGame\(g: Game\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(enterGame).toContain('worldDirty = true;');
  });

  it('dirty 清除三落点：手动保存非静默成功 / 回标题 / saveAndReload', () => {
    // doSave 全链落定处（非静默=用户确认存档点）
    expect(flow).toMatch(/if \(!silent\) worldDirty = false;/);
    // showTitle 头部
    const showTitle = flow.match(/function showTitle\(bgPaused = false\) \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(showTitle).toContain('worldDirty = false;');
    // saveAndReload 通道内无条件清
    const sar = flow.match(/function saveAndReload\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(sar).toContain('worldDirty = false;');
    expect(sar).toContain('location.reload()');
    expect(sar).toContain('doSave(true)');
  });

  it('隐藏兜底：visibilitychange hidden → hiddenBackstopShouldSave 门（含 autoSaveEnabled/mpClient 实参）→ 静默 doSave(true)', () => {
    expect(flow).toMatch(/document\.addEventListener\('visibilitychange'/);
    // 精确序列锚（mainFlow 另有 157 行失焦暂停 visibilitychange,勿误配）
    expect(flow).toMatch(/if \(!hiddenBackstopShouldSave\(\{ dirty: worldDirty, quitting, hasGame: !!game, saveInFlight, autoSaveEnabled: options\.data\.autoSave, mpClient: !!game && !!game\.net\?\.active && !game\.net\.policy\.isHost \}\)\) return;\s*void doSave\(true\);/);
  });

  it('在途互斥：doSave 置 saveInFlight,finally 解除（成败皆清）', () => {
    const doSave = flow.match(/function doSave\(silent = false\): Promise<boolean> \{[\s\S]*?\n  \}/)?.[0] ?? '';
    expect(doSave).toContain('saveInFlight = true;');
    expect(doSave).toContain('saveInFlight = false;');
  });
});

describe('BJ280 结构锁：main.ts 更新横幅接线（BJ144 面兼容）', () => {
  const main = codeOf('src/main.ts');

  it('横幅 reload 迁入 flow.saveAndReload()（存档落定→清拦截态→刷新）', () => {
    expect(main).toMatch(/flow \? flow\.saveAndReload\(\) : location\.reload\(\)/);
  });

  it('旧直刷路径已撤：横幅块不再绕过拦截态自行 doSave+reload', () => {
    expect(main).not.toMatch(/await flow\?\.doSave\(true\)/);
  });
});
