// ★juddersmooth 机械闸(2026-10-10 转正→★2026-10-27 用户令「先禁用」回缺省关,?smooth=1 显式开)
//  (judder smoothing):
//  纯判定表+帧尾序列账面(乒乓捕获/跳槽混合/断流卫生/resize 重建)。node 桩画布
//  (canvasFactory 注入缝);生产 canvasEnv.mkCanvas。像素级等价由实机探针兜底
//  (liquid-render-prepare-cache 先例)。
// 运行:npx vitest run tests/judder-smooth.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  judderMissFrame, judderFrameEnd, judderSmoothSetForTest, judderResetForTest,
  judderClockForTest, judderCanvasFactoryForTest, judderLineSetForTest,
  judderHoldSetForTest, judderStats,
  JUDDER_MISS_RATIO, JUDDER_BLEND_ALPHA,
} from '../src/render/JudderSmooth';

/** 记录桩 ctx(canvas 尺寸可变;drawImage/globalAlpha/setTransform/save/restore 记账;
 *  记账面=主 ctx(混合面);捕获面记账在 stubFactory 的槽 ctx(cap:tag)) */
function recordingCtx(w = 64, h = 64, ext?: string[]) {
  const calls = ext ?? [];
  const canv = {
    width: w, height: h,
    getContext: () => null,
  };
  const ctx = {
    canvas: canv,
    globalAlpha: 1,
    drawImage(src: unknown, _x: number, _y: number) { calls.push(`draw:${(src as { __tag?: string }).__tag ?? '?'}@a${(ctx.globalAlpha as number).toFixed(2)}`); },
    setTransform() { calls.push('setTransform'); },
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    clearRect() { /* 捕获槽清屏(记账噪声,不列) */ },
  };
  return { ctx: ctx as unknown as Parameters<typeof judderFrameEnd>[0], calls, canv };
}

/** 桩画布工厂:每个 (w,h) 新建带 __tag 的独立画布(乒乓槽身份可断言);槽 ctx 的
 *  drawImage 记账 `cap:tag`(捕获事件=写进哪个槽) */
function stubFactory(calls?: string[]) {
  let n = 0;
  return (w: number, h: number) => {
    const tag = `c${++n}`;
    const capCtx = {
      clearRect() {},
      drawImage() { calls?.push(`cap:${tag}`); },
    };
    const c = { __tag: tag, width: w, height: h, getContext: () => capCtx };
    return c as unknown as ReturnType<NonNullable<Parameters<typeof judderCanvasFactoryForTest>[0]>>;
  };
}

const P120 = 1000 / 120;

afterEach(() => {
  judderSmoothSetForTest(false);
  judderResetForTest();
  judderLineSetForTest(1.7);
  judderHoldSetForTest(2000);
  judderClockForTest(() => performance.now());
  judderCanvasFactoryForTest(() => null);
});

describe('judderMissFrame 纯判定表', () => {
  it('120 档:正常抖动 10ms=否/单跳槽 17ms=是/断流 300ms=否/长停顿 75ms(>周期×8)=否/首帧 -1=否/period 0=旁路', () => {
    expect(JUDDER_MISS_RATIO).toBe(1.7);                // ★2026-10-12 用户 A/B 转正(饱和场景 1.5→1.7 更稳)
    expect(judderMissFrame(10, P120)).toBe(false);      // 14.2 线下
    expect(judderMissFrame(17, P120)).toBe(true);       // 单跳槽(16.7 交付间隔)
    expect(judderMissFrame(300, P120)).toBe(false);     // 断流
    expect(judderMissFrame(75, P120)).toBe(false);      // >8×8.33=66.6 长停顿
    expect(judderMissFrame(60, P120)).toBe(true);       // 66.6 线内深跳槽(多槽)
    expect(judderMissFrame(-1, P120)).toBe(false);      // 首帧
    expect(judderMissFrame(17, 0)).toBe(false);         // 跟满/未锚定旁路
    expect(judderMissFrame(17, -1)).toBe(false);
  });
  it('60 档:正常 16.7=否/跳槽 33.3=是(判据随档周期缩放,非绝对量纲)', () => {
    const p = 1000 / 60;
    expect(judderMissFrame(17, p)).toBe(false);
    expect(judderMissFrame(33.3, p)).toBe(true);
  });
});

describe('judderFrameEnd 帧尾序列(v2 lazy-arming;桩画布账面)', () => {
  afterEach(() => {
    judderSmoothSetForTest(false);
    judderResetForTest();
    judderClockForTest(() => performance.now());
    judderCanvasFactoryForTest(() => null);
  });

  it('逃生门(?smooth=0)=完全旁路(零调用)', () => {
    judderSmoothSetForTest(false);
    const { ctx, calls } = recordingCtx();
    judderFrameEnd(ctx, P120, 100);
    expect(calls).toEqual([]);
  });

  it('period 0(跟满/未锚定)=旁路', () => {
    judderSmoothSetForTest(true);
    const { ctx, calls } = recordingCtx();
    judderFrameEnd(ctx, 0, 100);
    expect(calls).toEqual([]);
  });

  it('★v2 静默期零拷贝:无跳槽帧=全旁路(首版每帧捕获 6.9% 税清除)', () => {
    judderSmoothSetForTest(true);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    for (let i = 0; i < 10; i++) { judderFrameEnd(ctx, P120, t); t += 8; }   // 全程 gap 8 无跳槽
    expect(calls).toEqual([]);                                               // 零捕获零混合
  });

  it('★v2 首跳武装:跳槽帧开始捕获但无混合(首跳吃原价,后续享平滑)', () => {
    judderSmoothSetForTest(true);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    judderFrameEnd(ctx, P120, t);            // 静默:零调用
    expect(calls).toEqual([]);
    t += 17;                                  // 首次跳槽:武装+捕获 c1,无混合
    judderFrameEnd(ctx, P120, t);
    expect(calls).toEqual(['cap:c1']);
    t += 8;                                   // 武装期正常帧:继续捕获(备 prev),无混合
    judderFrameEnd(ctx, P120, t);
    expect(calls).toEqual(['cap:c1', 'cap:c2']);
    t += 17;                                  // 武装期跳槽:混合(c2=上一真帧@α.5)+捕获 c1
    judderFrameEnd(ctx, P120, t);
    expect(calls).toEqual(['cap:c1', 'cap:c2', 'cap:c1', 'save', 'setTransform', 'draw:c2@a0.50', 'restore']);
  });

  it('★v2 静默退役:末次跳槽 2s 后停捕获+prev 清位(再跳槽重新武装不混陈旧帧)', () => {
    judderSmoothSetForTest(true);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);    // 垫底帧(首帧恒 gap=-1 不触发):静默零调用
    expect(calls).toEqual([]);
    t += 17; judderFrameEnd(ctx, P120, t);   // 跳槽:武装 cap c1
    t += 8; judderFrameEnd(ctx, P120, t);    // cap c2
    t += 17; judderFrameEnd(ctx, P120, t);   // 跳槽混 c2
    const afterMiss = t;
    t += 8; judderFrameEnd(ctx, P120, t);    // 武装保持(捕获)
    t = afterMiss + 2001; judderFrameEnd(ctx, P120, t);   // 2s 静默:退役
    const mark = calls.length;                     // 事件总数(混入 blend 不致帧界切歪)
    t += 8; judderFrameEnd(ctx, P120, t);    // 退役后:零调用
    expect(calls.slice(mark)).toEqual([]);
    t += 17; judderFrameEnd(ctx, P120, t);   // 再跳槽:重新武装,prev 已清=只捕获无混合
    expect(calls.slice(mark)).toEqual(['cap:c1']);   // 乒乓槽复用(退役不清槽组,只清 prev)
    expect(calls.filter((c) => c.startsWith('draw:')).length).toBe(1);   // 仍只第一次跳槽混合过
  });

  it('断流(gap>250ms):不混合;武装保持;退役计时不被断流重置', () => {
    judderSmoothSetForTest(true);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);    // 垫底帧:静默零调用
    t += 17; judderFrameEnd(ctx, P120, t);   // 跳槽:武装 cap c1
    t += 300; judderFrameEnd(ctx, P120, t);  // 断流:miss=false,武装保持,捕获 c2
    expect(calls).toEqual(['cap:c1', 'cap:c2']);
    t += 1800; judderFrameEnd(ctx, P120, t); // 距末次跳槽 2.1s:退役(此帧 gap 1800 断流无跳槽)
    const mark = calls.length;
    t += 8; judderFrameEnd(ctx, P120, t);    // 退役后零调用
    expect(calls.slice(mark)).toEqual([]);
  });

  it('resize(武装期 canvas 尺寸变化)=槽组重建,当帧无混合', () => {
    judderSmoothSetForTest(true);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx, canv } = recordingCtx(64, 64, calls);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);    // 垫底帧:静默零调用
    t += 17; judderFrameEnd(ctx, P120, t);   // 跳槽:武装 cap c1
    t += 8; judderFrameEnd(ctx, P120, t);    // cap c2
    canv.width = 128;                         // resize
    t += 17; judderFrameEnd(ctx, P120, t);   // 跳槽但重建:无混合,捕获 c3
    expect(calls.filter((c) => c.includes('@0.50'))).toEqual([]);
    expect(calls[calls.length - 1]).toBe('cap:c3');
  });

  it("★v3' 捕获单 op 化:copy 合成整幅替换（含 α,cap 槽 gco=copy;无独立 clear op）", () => {
    judderSmoothSetForTest(true);
    const calls: string[] = [];
    const gcos: string[] = [];
    judderCanvasFactoryForTest((w, h) => {
      const c = stubFactory(calls)(w, h) as unknown as { getContext: () => { clearRect: () => void; drawImage: () => void; globalCompositeOperation: string } };
      const cap = c.getContext() as { globalCompositeOperation: string };
      Object.defineProperty(cap, 'globalCompositeOperation', {
        get() { return this.__v ?? 'source-over'; },
        set(v: string) { this.__v = v; gcos.push(v); },
      });
      return c as unknown as ReturnType<NonNullable<Parameters<typeof judderCanvasFactoryForTest>[0]>>;
    });
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);    // 垫底(零拷贝)
    t += 17; judderFrameEnd(ctx, P120, t);   // 跳槽:武装+捕获
    expect(gcos.filter((g) => g === 'copy').length).toBe(1);   // copy 单 op 捕获
    expect(gcos.filter((g) => g === 'source-over').length).toBe(1); // 复位
  });

  it('★旋钮① miss 线可调(?smoothline):抬线后边际 gap 不再判跳槽', () => {
    judderSmoothSetForTest(true);
    judderLineSetForTest(1.7);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);        // 垫底
    t += P120 * 1.6;                              // 1.6×周期:旧线(1.5)=跳槽,新线(1.7)=否
    judderFrameEnd(ctx, P120, t);
    expect(calls).toEqual([]);                    // 抬线后零捕获
  });

  it('★旋钮② 武装保持窗可调(?smoothhold):缩短后提前退役', () => {
    judderSmoothSetForTest(true);
    judderHoldSetForTest(300);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);
    t += 17; judderFrameEnd(ctx, P120, t);       // 跳槽:武装
    t += 8; judderFrameEnd(ctx, P120, t);        // 捕获
    t += 400; judderFrameEnd(ctx, P120, t);      // 400ms>300:退役(且 gap>断流阈=不混合)
    const mark = calls.length;
    t += 8; judderFrameEnd(ctx, P120, t);        // 退役后零调用
    expect(calls.slice(mark)).toEqual([]);
  });

  it('★旋钮③ 暂停门:paused=全旁路且 lastMs 不动（恢复帧走断流卫生）', () => {
    judderSmoothSetForTest(true);
    const calls: string[] = [];
    judderCanvasFactoryForTest(stubFactory(calls));
    const { ctx } = recordingCtx(64, 64, calls);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);
    t += 17; judderFrameEnd(ctx, P120, t);       // 武装
    t += 8; judderFrameEnd(ctx, P120, t);        // 捕获
    const mark = calls.length;
    t += 17; judderFrameEnd(ctx, P120, t, true); // 暂停帧:旁路(即使 gap 达跳槽线)
    expect(calls.slice(mark)).toEqual([]);
    t += 17; judderFrameEnd(ctx, P120, t);       // 恢复:gap 自上次实帧 34ms——>断流阈?否(<250)
    // gap=34ms=跳槽但 prev 为 17ms 前捕获=仍有效 → 正常混合
    // （★记账格式='draw:tag@a'+α——includes 匹配 '@a0.50' 带前缀,二犯入档）
    expect(calls.slice(mark).some((c) => c.includes('@a0.50'))).toBe(true);
  });

  it('★计数器:frames/armedFrames/missFrames/blends/armCount 累计', () => {
    judderSmoothSetForTest(true);
    judderCanvasFactoryForTest(stubFactory([]));
    const { ctx } = recordingCtx(64, 64);
    let t = 0;
    t += 8; judderFrameEnd(ctx, P120, t);
    t += 17; judderFrameEnd(ctx, P120, t);       // 跳槽:武装+miss
    t += 17; judderFrameEnd(ctx, P120, t);       // 跳槽:混合
    t += 8; judderFrameEnd(ctx, P120, t);        // 干净
    const s = judderStats();
    expect(s.frames).toBe(4);
    expect(s.armCount).toBe(1);
    expect(s.missFrames).toBe(2);
    expect(s.blends).toBe(1);
    expect(s.armed).toBe(true);
  });
});
