// ★BJ705-G26 件4:[fetchAsset-no-backoff-consumers] 页侧清偿——DOM 装饰单发消费方
// 「迟到单发重试」helper（G24 三证注记的「未来刀形状」落地,仍非 SW 级）。
// 判别锁（fake timers + 桩 Image/document——node 环境无 DOM 面）:
//   §A 挂起型 lateImageRetry:15s 到点未就绪 → 重启同 URL 单发;中途成功不重启;
//      visibilitychange(回前台) 提前触发;单发不二发;队列空撤监听。
//   §B 终态 onerror 型 lateImageRetryDefer:首败不终态（迟到重启）;重启命中→
//      消费方 onload 回填;重启再败→onFinalFail（原终态语义）;未败不重启
//      （pending abort 防误终态）;node 无 document=直接终态。
//   §C 接线普查:13 消费文件接入锚（TileHighlight 故意不接入;Bestiary 表加载器
//      BST_FAIL_TTL 自愈不接入）。
// 变异恰红:§M 派生（摘重启/摘单发闸/摘 visibility 触发）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type ImgLike = {
  src: string; complete: boolean; naturalWidth: number;
  onload: (() => void) | null; onerror: (() => void) | null;
};

function makeImgState(): { img: ImgLike; sets: number; onloads: number } {
  const st = { img: null as unknown as ImgLike, sets: 0, onloads: 0 };
  st.img = {
    src: '', complete: false, naturalWidth: 0,
    onload: null, onerror: null,
    set src2(v: string) { st.sets++; },
  } as unknown as ImgLike;
  // src setter 计数（直写不触发——用 defineProperty 拦截）
  const target = st.img as unknown as Record<string, unknown>;
  Object.defineProperty(target, 'src', {
    get: () => (target as { _src?: string })._src ?? '',
    set: (v: string) => { (target as { _src?: string })._src = v; st.sets++; },
  });
  return st;
}

describe('BJ705-G26 件4 §A 挂起型 lateImageRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { document?: unknown }).document = {
      visibilityState: 'hidden',
      addEventListener: () => { /* 桩 */ },
      removeEventListener: () => { /* 桩 */ },
    };
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it('A1 15s 到点未就绪 → 重启同 URL 单发;再 15s 不二发', async () => {
    const { lateImageRetry } = await import('../src/assets/lateImageRetry');
    const st = makeImgState();
    st.img.src = 'u.png'; st.sets = 1;   // 消费方首设
    lateImageRetry(st.img as unknown as HTMLImageElement, 'u.png');
    vi.advanceTimersByTime(14999);
    expect(st.sets).toBe(1);             // 未到点不重启
    vi.advanceTimersByTime(1);
    expect(st.sets).toBe(2);             // 15s 重启（同 URL）
    expect(st.img.src).toBe('u.png');
    vi.advanceTimersByTime(60000);
    expect(st.sets).toBe(2);             // 单发（不二发）
  });

  it('A2 中途成功（complete∧naturalWidth>0）→ 不重启', async () => {
    const { lateImageRetry } = await import('../src/assets/lateImageRetry');
    const st = makeImgState();
    lateImageRetry(st.img as unknown as HTMLImageElement, 'u.png');
    st.img.complete = true; st.img.naturalWidth = 64;
    vi.advanceTimersByTime(30000);
    expect(st.sets).toBe(0);             // 就绪 → 到点跳过
  });

  it('A3 visibilitychange 回前台触发（未就绪→重启;单发闸）', async () => {
    let visCb: (() => void) | null = null;
    (globalThis as unknown as { document: unknown }).document = {
      visibilityState: 'visible',
      addEventListener: (_e: string, cb: () => void) => { visCb = cb; },
      removeEventListener: () => { /* 桩 */ },
    };
    const { lateImageRetry, lateImageRetryPendingForTest } = await import('../src/assets/lateImageRetry');
    const st = makeImgState();
    lateImageRetry(st.img as unknown as HTMLImageElement, 'u.png');
    expect(lateImageRetryPendingForTest()).toBe(1);
    visCb!();
    expect(st.sets).toBe(1);             // 回前台即重启
    vi.advanceTimersByTime(30000);
    expect(st.sets).toBe(1);             // 单发
    expect(lateImageRetryPendingForTest()).toBe(0);   // 触发后出队
  });
});

describe('BJ705-G26 件4 §B 终态 onerror 型 lateImageRetryDefer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { document?: unknown }).document = {
      visibilityState: 'hidden',
      addEventListener: () => { /* 桩 */ },
      removeEventListener: () => { /* 桩 */ },
    };
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it('B1 首败不终态→迟到重启→onload 回填;重启再败→onFinalFail', async () => {
    const { lateImageRetryDefer } = await import('../src/assets/lateImageRetry');
    const st = makeImgState();
    let finals = 0;
    let onloadFired = 0;
    st.img.onload = () => { onloadFired++; };   // 消费方自己的 onload（回填面）
    lateImageRetryDefer(st.img as unknown as HTMLImageElement, 'u.png', () => { finals++; });
    const origError = st.img.onerror;
    expect(origError).toBeTruthy();
    origError!();                          // 首败（SW 8s 超时 abort 面）
    expect(finals).toBe(0);                // 不终态
    vi.advanceTimersByTime(15000);
    expect(st.sets).toBe(1);               // 迟到重启
    st.img.complete = true; st.img.naturalWidth = 32;
    st.img.onload!();                      // 重启命中 → 消费方 onload 回填
    expect(onloadFired).toBe(1);           // 回填经消费方自己的 onload（零布线）
    expect(finals).toBe(0);                // 仍无终态
    // 再败路径（新 Image 场景）:重启后再 onerror → 终态
    st.img.complete = false; st.img.naturalWidth = 0;
    st.img.onerror!();
    expect(finals).toBe(1);                // 原终态语义（重启后再败）
  });

  it('B2 未败不重启（pending abort 防误终态面）', async () => {
    const { lateImageRetryDefer } = await import('../src/assets/lateImageRetry');
    const st = makeImgState();
    let finals = 0;
    lateImageRetryDefer(st.img as unknown as HTMLImageElement, 'u.png', () => { finals++; });
    vi.advanceTimersByTime(30000);       // 未 error（pending 中）
    expect(st.sets).toBe(0);             // 不重启（abort 会误触发 onerror）
    expect(finals).toBe(0);
  });

  it('B3 node 无 document → 直接终态（原语义）', async () => {
    delete (globalThis as unknown as { document?: unknown }).document;
    const { lateImageRetryDefer, lateImageRetryPendingForTest } = await import('../src/assets/lateImageRetry');
    const st = makeImgState();
    let finals = 0;
    lateImageRetryDefer(st.img as unknown as HTMLImageElement, 'u.png', () => { finals++; });
    expect(finals).toBe(1);              // 无 DOM 面=原终态直调
    expect(lateImageRetryPendingForTest()).toBe(0);
  });
});

describe('BJ705-G26 件4 §C 接线普查（结构锁）', () => {
  const rd = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('C1 13 消费文件接入（挂起型 9 站/终态型 7 站）;TileHighlight 故意不接入', () => {
    const files = [
      'src/render/ResourceBars.ts', 'src/render/FancyResourceBars.ts', 'src/render/MenuBackground.ts',
      'src/ui/AchievementsUI.ts', 'src/ui/EmoteMenu.ts', 'src/ui/WorldCreation.ts',
      'src/ui/AssetDownloadUI.ts', 'src/ui/CharCreation.ts', 'src/ui/WorldSelect.ts',
      'src/ui/BestiaryPanel.ts', 'src/render/BiomeBackground.ts', 'src/ui/vanillaKit.ts',
      'src/remaster/RemasterRuntime.ts',
    ];
    for (const f of files) {
      expect(rd(f), f).toMatch(/lateImageRetry\(|lateImageRetryDefer\(/);
    }
    expect(rd('src/render/TileHighlight.ts')).not.toContain('lateImageRetry');   // 故意永久负缓存
  });
  it('C2 Bestiary 表加载器不接入（BST_FAIL_TTL 自愈面,勿叠）', () => {
    const s = rd('src/ui/BestiaryPanel.ts');
    expect(s).toContain('BST_FAIL_TTL');
    // bstLoadSheet（表加载器）无 lateImageRetryDefer——只有 bstLoadImg（chrome）接入
    const sheetLoader = s.slice(s.indexOf('bstSheetPending.set(file, q)'), s.indexOf('bstLoadImg'));
    expect(sheetLoader).not.toContain('lateImageRetry');
  });
  it('C3 sw.js G24 注记更新（页侧清偿在案,SW 级结论不变）', () => {
    const sw = rd('public/sw.js');
    expect(sw).toContain('★BJ705-G26 件4（2026-10-22 页侧清偿）');
    expect(sw).toContain('勿在此加重试）不变');
  });
});
