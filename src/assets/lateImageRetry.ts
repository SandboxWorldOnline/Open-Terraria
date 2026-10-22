// ★BJ705-G26 件4（2026-10-22,[fetchAsset-no-backoff-consumers] 页侧清偿——G24 三证
//   注记的「未来刀形状」落地,仍非 SW 级）:DOM 装饰单发消费方「迟到单发重试」helper。
//
// 【病灶域】（sw.js G24 注记普查）:~14 处 DOM 装饰单发 Image 消费方无退避——SW 的
//   fetchAsset 8s 超时兜底是【单发不重试】（SW 级重试=黑洞窗 N→2N 请求风暴,MuG3
//   判例锁死,勿在 SW 加）;首访+TTFB>8s 慢网 → onerror/挂起终态 → 无自然重触发的
//   会话常驻菜单装饰性空白,刷新即愈。本 helper=页侧共享迟到重试:15s 后或
//   visibilitychange（回前台,网络可能已恢复）触发,重启同一 URL 的加载（SW
//   cache-first:期间已落缓存则秒开,否则一次新网络尝试）——单发（每 Image 一次）,
//   命中即经消费方自己的 onload 回填,零消费方回调布线。
//
// 【两型接入】（按消费方 onerror 语义分型,勿混用）:
//   · lateImageRetry(img, url)——挂起型（无 onerror:失败=Promise 永挂/标志位恒假）。
//     注册即武装:15s/visibility 时未就绪 → 重启加载（abort 未决请求无害——无
//     onerror 可误触发）。
//   · lateImageRetryDefer(img, url, onFinalFail)——终态 onerror 型（onerror→resolve/
//     reject 终值）。包装 onerror:首败【不终态】只标记 failed;迟到触发时（必已
//     failed）重启;重启后再败才调 onFinalFail（原终态逻辑原样迁入）。不重启未败
//     的 pending 加载（abort 会误触发 onerror=重启前提前终态;挂死请求由 SW 8s
//     超时兜底转 onerror 进入 failed 态）。
//
// 【纪律】单发（每 Image 恰一次重启）;node 测试环境（无 document）恒 no-op（defer
//   型直接走原终态）;TileHighlight 故意永久负缓存——不接入（sw.js 注记在案）。
export function lateImageRetry(img: HTMLImageElement, url: string, timeoutMs = 15000): void {
  if (typeof document === 'undefined') return;
  arm({ img, url, timeoutMs, restartPending: true });
}

/** 终态 onerror 型接入:替换消费方原 `img.onerror = <终态>` 行（终态逻辑作 onFinalFail 迁入）。 */
export function lateImageRetryDefer(img: HTMLImageElement, url: string,
  onFinalFail: () => void, timeoutMs = 15000): void {
  if (typeof document === 'undefined') { onFinalFail(); return; }   // node 环境无重试面=原终态语义
  const entry = arm({ img, url, timeoutMs, restartPending: false });
  img.onerror = () => {
    if (entry.restarted) { onFinalFail(); return; }   // 重启后再败=终态（原 onerror 语义）
    entry.failed = true;   // 首败:只标记——迟到触发时重启,onload 回填消费方
  };
}

interface LateEntry {
  img: HTMLImageElement;
  url: string;
  restarted: boolean;
  failed: boolean;
  restartPending: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Set<LateEntry>();
let visListener: (() => void) | null = null;

function ensureVisListener(): void {
  if (visListener || typeof document === 'undefined') return;
  visListener = () => {
    if (document.visibilityState !== 'visible') return;   // 回前台才触发（网络可能已恢复）
    for (const e of [...pending]) fire(e);
  };
  document.addEventListener('visibilitychange', visListener);
}

function arm(opts: { img: HTMLImageElement; url: string; timeoutMs: number; restartPending: boolean }): LateEntry {
  const entry: LateEntry = { img: opts.img, url: opts.url, restarted: false, failed: false,
    restartPending: opts.restartPending, timer: null };
  entry.timer = setTimeout(() => fire(entry), opts.timeoutMs);
  pending.add(entry);
  ensureVisListener();
  return entry;
}

function fire(entry: LateEntry): void {
  if (!pending.has(entry)) return;
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  pending.delete(entry);
  if (pending.size === 0 && visListener) {   // 卫生:队列空撤监听
    document.removeEventListener('visibilitychange', visListener);
    visListener = null;
  }
  const { img, url } = entry;
  if (img.complete && img.naturalWidth > 0) return;   // 已就绪（含中途成功）→ 无事
  // defer 型未败不重启（pending 中 abort 会误触发 onerror=重启前提前终态）
  if (!entry.restartPending && !entry.failed) return;
  if (!entry.restarted) {
    entry.restarted = true;
    img.src = url;   // 重启同 URL:SW cache-first（已落缓存秒开）;命中经消费方 onload 回填
  }
}

/** 测试面:当前在途条目数（node 无 document 恒 0）。 */
export function lateImageRetryPendingForTest(): number {
  return pending.size;
}
