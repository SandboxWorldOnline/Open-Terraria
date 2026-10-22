// 资产预载 UI(2026-08-13):右下角悬浮进度徽标 + 单人游戏门槛弹窗。
// 状态源=src/net/AssetCache(SW 消息驱动)。
// ★像素风(用户要求"要泰拉瑞亚风格"):进度条=原版世界创建进度条 1:1
// (UI_WorldGen_Outer_Corrupt 框贴图 + 570×16 槽 #303030 + 腐化紫填充,
// 规格=UIGenProgressBar.ts 常量);面板底=Inventory_Back13 九宫格乘色
// ((33,15,91)×0.685,与 UI.ts 原版像素面板同源);全程方角/硬边框/像素字体,
// 无圆角无渐变。
import { assetCacheState, assetCacheEnvOff, assetPipelineFailure, assetsComplete, assetsCompleteFast, assetsRetriesExhausted, buildAssetDiagReport, onAssetProgress, readSwTrace, retryAssetCacheInit, swTrace, warmAllAssets, PHASE_LABEL, type AssetCacheState } from '../net/AssetCache';
import { Lang } from '../i18n/Lang';
import { lateImageRetry } from '../assets/lateImageRetry';

/** 原版 packed 色(UIGenProgressBar.ts 同源):corrupt 长条填充 4283888223 */
function packedColor(v: number): string {
  return `rgb(${(v >>> 16) & 255},${(v >>> 8) & 255},${v & 255})`;
}
const BAR_FILL = packedColor(4283888223);   // 腐化紫
const BAR_EMPTY = '#303030';                // 原版空槽色

const CSS = `
.sw-asset-badge, .sw-asset-gate .panel {
  font-family: "Fusion Pixel 12px", "Microsoft YaHei", sans-serif;
}
.sw-asset-badge {
  /* 底部居中(2026-08-24 用户要求):左下版本号/右下署名角标已占位,避让;
     与 LoadingSunflower(底 50px)上下错开不叠 */
  position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 10002;
  display: flex; align-items: center; gap: 8px;
  background: #141028; border: 2px solid #7d92d6;
  box-shadow: 0 0 0 2px #0a0e1e;
  padding: 6px 12px; color: #e8ecf8; font-size: 13px;
  cursor: pointer;
  /* ★常显(2026-08-27 用户改案):不随 --sw-splash-alpha(旧 2026-08-24"渐显入场
     同曲线"已废——splash 挂载即置 0,badge 曾随之隐形再随渐入重现,用户实测
     "耳机页后被隐藏过渡页重现")。出现=向日葵幕骨架,消失=完成淡出(≈过渡页
     收场渐隐)。★transition 不能挂基类;淡出过渡在 unmount 处内联挂 */
  opacity: 1;
  image-rendering: pixelated;
}
.sw-asset-badge:hover { border-color: #ffd76e; }
.sw-asset-badge .spin {
  width: 12px; height: 12px; border: 2px solid #7d92d6; border-top-color: #ffd76e;
  /* steps(8):8 档跳变旋转 = 像素感(非平滑圆角旋转) */
  animation: sw-asset-spin 0.9s steps(8) infinite;
}
@keyframes sw-asset-spin { to { transform: rotate(360deg); } }
.sw-asset-gate {
  position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: rgba(4,6,14,0.82);
}
.sw-asset-gate .panel {
  width: min(680px, 94vw); text-align: center; color: #e8ecf8;
  background-color: #241a4e;                 /* 九宫格贴图就绪前的兜底 */
  background-size: 100% 100%; image-rendering: pixelated;
  border: 2px solid #7d92d6;
  box-shadow: 0 0 0 2px #0a0e1e, 0 10px 32px rgba(0,0,0,0.7);
  padding: 26px 30px 22px;
}
.sw-asset-title {
  font-size: 18px; letter-spacing: 3px;
  text-shadow: 2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000;
}
/* 原版世界创建进度条 1:1(UIGenProgressBar):612×70 Outer 框 + 内槽(20,40,570,16) */
/* 原版世界创建进度条 1:1（UIGenProgressBar 修正版层级,2026-08-27）：
   612×70 逻辑尺寸固定不拉伸；★填充槽先渲染、Outer 外框后画压上（端点装饰
   盖住填充两端=原版 DrawSelf :100-107 序;此前 DOM 反序+100% 100% 拉伸=端点
   装饰变形+被填充盖住）。窄屏整体 transform scale（JS 挂载时算,同
   fitProgressScale 语义）。 */
.sw-asset-barwrap { position: relative; width: 612px; max-width: 100%; height: 70px; margin: 18px auto 6px; transform-origin: top center; }
.sw-asset-barwrap .outer {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: url('sprites/vanilla-ui/UI_WorldGen_Outer_Corrupt.png') 0 0 / 612px 70px no-repeat;
  image-rendering: pixelated;
}
.sw-asset-barwrap .slot {
  position: absolute; left: 3.27%; top: 57.1%; width: 93.1%; height: 22.9%;
  background: ${BAR_EMPTY};
}
.sw-asset-barwrap .slot > div { height: 100%; background: ${BAR_FILL}; transition: width .25s steps(6); }
.sw-asset-pct { font-size: 14px; text-shadow: 2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000; }
.sw-asset-note { font-size: 12px; color: #9fb0e0; margin-top: 10px;
  text-shadow: 1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000; }
.sw-asset-retry {
  margin-top: 14px; background: #3a2a5a; color: #fff; border: 2px solid #7d92d6;
  box-shadow: 0 0 0 2px #0a0e1e; padding: 8px 26px; cursor: pointer;
  font-family: inherit; font-size: 14px;
}
.sw-asset-retry:hover { background: #4a3a7a; }
/* 下载详情面板(点击徽标打开;同 gate 面板语言) */
.sw-asset-panel {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 10003;
  width: min(680px, 94vw); text-align: center; color: #e8ecf8;
  background-color: #241a4e; background-size: 100% 100%; image-rendering: pixelated;
  border: 2px solid #7d92d6; box-shadow: 0 0 0 2px #0a0e1e, 0 10px 32px rgba(0,0,0,0.7);
  padding: 20px 22px 16px;
}
.sw-asset-panel .sw-asset-mb {
  font-size: 16px; margin-top: 4px;
  text-shadow: 2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000;
}
.sw-asset-panel .sw-asset-close {
  margin-top: 12px; background: #3a2a5a; color: #fff; border: 2px solid #7d92d6;
  box-shadow: 0 0 0 2px #0a0e1e; padding: 6px 22px; cursor: pointer;
  font-family: inherit; font-size: 13px;
}
.sw-asset-panel .sw-asset-close:hover { background: #4a3a7a; }
/* 资产诊断面板(手机无 Console 取证:logo 连点5次,2026-08-27;调试工具,文案硬编码不走 l10n) */
.sw-asset-diag {
  position: fixed; inset: 0; z-index: 10020; display: flex; align-items: center; justify-content: center;
  background: rgba(4, 6, 14, 0.92);
}
.sw-asset-diag .diag-wrap {
  width: min(680px, 94vw); height: min(78vh, 720px); display: flex; flex-direction: column;
  background: #10142a; border: 2px solid #7d92d6; box-shadow: 0 0 0 2px #0a0e1e;
  padding: 12px 14px; color: #e8ecf8;
}
.sw-asset-diag .diag-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  font-family: "Fusion Pixel 12px", "Microsoft YaHei", sans-serif; font-size: 14px; }
.sw-asset-diag .diag-bar button {
  background: #3a2a5a; color: #fff; border: 2px solid #7d92d6; padding: 4px 14px;
  cursor: pointer; font-family: inherit; font-size: 13px;
}
.sw-asset-diag .diag-bar button:hover { background: #4a3a7a; }
.sw-asset-diag textarea {
  flex: 1; width: 100%; resize: none; white-space: pre; overflow: auto;
  background: #0a0e1e; color: #cfe0ff; border: 1px solid #33406e;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.45;
}
/* 管线未启用警告弹窗(2026-09-03;同 gate/panel 像素风,z 在详情面板之上/诊断面板之下) */
.sw-asset-pipe {
  position: fixed; inset: 0; z-index: 10012; display: flex; align-items: center; justify-content: center;
  background: rgba(4, 6, 14, 0.86);
}
.sw-asset-pipe .panel {
  width: min(560px, 92vw); text-align: center; color: #e8ecf8;
  background-color: #241a4e; background-size: 100% 100%; image-rendering: pixelated;
  border: 2px solid #7d92d6; box-shadow: 0 0 0 2px #0a0e1e, 0 10px 32px rgba(0, 0, 0, 0.7);
  padding: 22px 26px 18px;
  font-family: "Fusion Pixel 12px", "Microsoft YaHei", sans-serif;
}
.sw-asset-pipe .reason {
  margin: 12px auto 0; max-width: 100%; padding: 8px 10px; text-align: left;
  background: #0a0e1e; border: 1px solid #33406e; color: #ffd76e;
  font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5;
  word-break: break-all; white-space: pre-wrap;
}
.sw-asset-pipe .btnrow { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 16px; }
.sw-asset-pipe button {
  background: #3a2a5a; color: #fff; border: 2px solid #7d92d6;
  box-shadow: 0 0 0 2px #0a0e1e; padding: 8px 20px; cursor: pointer;
  font-family: inherit; font-size: 14px;
}
.sw-asset-pipe button:hover { background: #4a3a7a; }
.sw-asset-pipe button:disabled { opacity: 0.55; cursor: wait; }
.sw-asset-pipe .hint { font-size: 11px; color: #9fb0e0; margin-top: 12px;
  text-shadow: 1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000; }
`;

let styleEl: HTMLStyleElement | null = null;
function ensureStyle(): void {
  if (styleEl || typeof document === 'undefined') return;
  styleEl = document.createElement('style');
  styleEl.id = 'sw-asset-style';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
}

// ---- 原版像素面板底(Inventory_Back13 九宫格 × (33,15,91)×0.685;UI.ts 同源算法) ----

let panelBg: string | null = null;
let panelBgImg: ImageBitmap | HTMLImageElement | null = null;
function ensurePanelBg(panel: HTMLElement): void {
  if (panelBg) { panel.style.backgroundImage = `url(${panelBg})`; return; }
  if (!panelBgImg && typeof Image !== 'undefined') {
    panelBgImg = new Image();
    lateImageRetry(panelBgImg, 'sprites/vanilla/Inventory_Back13.png');   // ★BJ705-G26 件4:迟到单发重试
    panelBgImg.onload = () => {
      try {
        const img = panelBgImg!;
        const t = document.createElement('canvas');
        t.width = img.width; t.height = img.height;
        const tc = t.getContext('2d')!;
        tc.imageSmoothingEnabled = false;
        tc.drawImage(img, 0, 0);
        const d = tc.getImageData(0, 0, t.width, t.height);
        const m = [33 / 255, 15 / 255, 91 / 255, 0.685];
        for (let i = 0; i < d.data.length; i += 4) {
          d.data[i] = Math.round(d.data[i] * m[0]);
          d.data[i + 1] = Math.round(d.data[i + 1] * m[1]);
          d.data[i + 2] = Math.round(d.data[i + 2] * m[2]);
          d.data[i + 3] = Math.round(d.data[i + 3] * m[3]);
        }
        tc.putImageData(d, 0, 0);
        // 九宫格拉伸到面板尺寸(52×52 源:角 10 边 10 心 32)
        const W = 560, H = 300, S = t.width;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d')!;
        x.imageSmoothingEnabled = false;
        const e = 10, cw = S - 20;
        x.drawImage(t, 0, 0, e, e, 0, 0, e, e);
        x.drawImage(t, S - e, 0, e, e, W - e, 0, e, e);
        x.drawImage(t, 0, S - e, e, e, 0, H - e, e, e);
        x.drawImage(t, S - e, S - e, e, e, W - e, H - e, e, e);
        x.drawImage(t, e, 0, cw, e, e, 0, W - 20, e);
        x.drawImage(t, e, S - e, cw, e, e, H - e, W - 20, e);
        x.drawImage(t, 0, e, e, cw, 0, e, e, H - 20);
        x.drawImage(t, S - e, e, e, cw, W - e, e, e, H - 20);
        x.drawImage(t, e, e, cw, cw, e, e, W - 20, H - 20);
        panelBg = c.toDataURL();
        document.querySelectorAll('.sw-asset-gate .panel').forEach((el) => {
          (el as HTMLElement).style.backgroundImage = `url(${panelBg})`;
        });
      } catch { /* canvas 污染等异常 → 保持纯色兜底 */ }
    };
    panelBgImg.src = 'sprites/vanilla/Inventory_Back13.png';
  }
}

// ---- 悬浮徽标 ----

let badgeEl: HTMLElement | null = null;
let badgeUnsub: (() => void) | null = null;
let badgeFading = false;
let badgePending = false;

function fmtPct(s: AssetCacheState): string {
  // zip 模式(有字节账)百分比也按字节——与条宽/MB 文案同源,防三处数字跳变
  if (s.bytesTotal > 0) return `${Math.floor(Math.min(1, s.bytesDone / s.bytesTotal) * 100)}%`;
  return s.total > 0 ? `${Math.floor((s.done / s.total) * 100)}%` : '…';
}
const mb = (b: number): string => (b / 1048576).toFixed(1);
/** 进度主文案:zip 模式(有字节账)用 MB,legacy 回退文件数 */
function fmtProgress(s: AssetCacheState): string {
  return s.bytesTotal > 0
    ? `${mb(s.bytesDone)} MB / ${mb(s.bytesTotal)} MB`
    : `${s.done}/${s.total}`;
}
function phaseText(s: AssetCacheState): string {
  // 相位文案 = Mods.SandboxWorld.AssetDl.*(自制资产管线,原版无对应键)
  if (s.phase === 'done') return Lang.text('Mods.SandboxWorld.AssetDl.Done');
  if (s.phase === 'idle') return Lang.text('Mods.SandboxWorld.AssetDl.Ready');
  return Lang.text(`Mods.SandboxWorld.AssetDl.Phase_${PHASE_LABEL[s.phase as keyof typeof PHASE_LABEL] ?? ''}`);
}

/** 挂载右下角进度徽标(幂等;完成自动淡出)。
 *  initAssetCache 是异步的——showTitle 调用时可能还没 enabled:
 *  订阅一次性等 enabled 翻真再挂 */
export function mountAssetBadge(): void {
  if (badgeEl || badgePending || typeof document === 'undefined') return;
  // ★环境性关断不挂(dev 默认无 SW 管线,骨架会永久滞留——2026-08-28 用户实报;
  //   与 doInitAssetCache 的 !PROD/?nosw 门严格同式;?sw 强制测试路径保留)
  if (assetCacheEnvOff()) return;
  const s = assetCacheState();
  if (!s.enabled) {
    if (s.phase !== 'done') {
      badgePending = true;
      // ★骨架即挂(2026-08-27 用户要求:向日葵幕阶段就显示):enabled 未翻真时
      //   state 无字节账,先上 spinner+"资源加载中 · …"骨架;订阅 enabled 翻真
      //   后原地重建换绑正常进度循环
      ensureStyle();
      badgeEl = document.createElement('div');
      badgeEl.className = 'sw-asset-badge';
      badgeEl.innerHTML = '<div class="spin"></div><span class="txt"></span>';
      (badgeEl.querySelector('.txt') as HTMLElement).textContent =
        Lang.text('Mods.SandboxWorld.AssetDl.Loading', '…');
      document.body.appendChild(badgeEl);
      const off = onAssetProgress((st) => {
        if (!st.enabled || !badgeEl) return;
        off();
        badgeEl.remove(); badgeEl = null; badgePending = false;
        mountAssetBadge();   // 正常挂载路径:绑定进度 update 订阅
      });
    }
    return;
  }
  if (s.phase === 'done') return; // 已完成不挂
  // ★完成标志不再免挂(2026-08-27):手机实测 CacheStorage 会被系统驱逐而
  //   localStorage 标志残留——flag 在+缓存缺=正是需要徽标展示补拉进度的场景
  //   (原免挂逻辑曾让补拉全程无进度可见);挂后由 status 回包实测校准,
  //   真完成自然 0.7s 淡出,不构成常驻
  ensureStyle();
  badgeEl = document.createElement('div');
  badgeEl.className = 'sw-asset-badge';
  badgeEl.innerHTML = '<div class="spin"></div><span class="txt"></span>';
  badgeEl.title = Lang.text('Mods.SandboxWorld.AssetDl.BadgeTitle');
  document.body.appendChild(badgeEl);
  badgeEl.addEventListener('click', () => toggleAssetPanel());   // 点开下载详情
  const txt = badgeEl.querySelector('.txt') as HTMLElement;
  const update = (st: AssetCacheState) => {
    if (!badgeEl) return;
    badgeEl.title = `${fmtPct(st)} · ${fmtProgress(st)} · ${phaseText(st)}`;
    // 失败终态(3 轮自动重试后仍有缺):不淡出,常显失败数——菜单上就能看到
    // 异常,不必点单人游戏才发现(2026-08-13 可靠性 review)
    if (st.phase === 'done' && st.failed > 0) {
      txt.textContent = Lang.text('Mods.SandboxWorld.AssetDl.Failed', st.failed);
      return;
    }
    // ★校准前不出百分比(2026-08-28 用户报"暖缓存也闪 0%"):done/total 在 status
    // 回包前只是计划值——此时保持骨架文案"资源加载中 · …";校准后若全缓存命中,
    // phase 立即 'done' 走下方淡出=全程无 0% 闪烁。有真实下载量才显示百分比。
    if (!st.calibrated) {
      txt.textContent = Lang.text('Mods.SandboxWorld.AssetDl.Loading', '…');
      return;
    }
    // ★本地校验/预热阶段有进度也亮出来(2026-08-28 用户要求"有盼头"):
    // status 回包的缓存覆盖度 cached/total——下载开始后由下方下载百分比接管。
    // ★必须让位给完成态(phase done 先行),否则暖缓存永远停在"校验 100%"
    // (2026-08-28 用户实报卡死根因:本校验支曾无 done 门,遮住下方就绪+淡出)
    if (!st.warming && st.phase !== 'done' && typeof st.coveragePct === 'number') {
      txt.textContent = Lang.text('Mods.SandboxWorld.AssetDl.Verify', st.coveragePct);
      return;
    }
    // ★完成态先于百分比渲染(2026-08-28 用户报"暖缓存闪 0%/100%"):全缓存命中时
    // 不得出现任何百分比——显示"就绪"文案并淡出
    if (st.phase === 'done') {
      txt.textContent = Lang.text('Mods.SandboxWorld.AssetDl.Done');
      if (!badgeFading) {
        badgeFading = true;
        badgeEl.style.transition = 'opacity .6s';   // 淡出过渡仅此刻内联挂(基类挂会拖拽渐显变量)
        badgeEl.style.opacity = '0';
        setTimeout(() => { unmountAssetBadge(); }, 700);
      }
      return;
    }
    // 徽标文案"资源加载中 · N% · NNNMB"(2026-08-27 用户要求:百分比后加已下载
    // MB;字节数明细/阶段仍在悬停 tooltip)
    txt.textContent = Lang.text('Mods.SandboxWorld.AssetDl.Loading', fmtPct(st))
      + (st.bytesTotal > 0 ? ` · ${Math.round(st.bytesDone / 1048576)}MB` : '');
  };
  update(s);
  badgeUnsub = onAssetProgress(update);
  // ★轮询兜底(2026-09-09):update 靠 emit 推送——挂载晚于最后一次 emit(骨架换绑/
  //  事件在订阅前已发)时 done 相位永远收不到=badge 永久卡「资源加载中」(用户实报
  //  658s 不消失)。每 2s 实测 assetCacheState(),done 即走同一淡出路径
  const poll = setInterval(() => {
    if (!badgeEl) { clearInterval(poll); return; }
    const st = assetCacheState();
    if (!st.enabled) return;
    if (st.phase === 'done' && !(st.failed > 0)) {
      clearInterval(poll);
      const fake = { ...st };
      update(fake);
    }
  }, 2000);
  const prevUnsub = badgeUnsub;
  badgeUnsub = () => { clearInterval(poll); prevUnsub?.(); };
}

export function unmountAssetBadge(): void {
  badgeUnsub?.(); badgeUnsub = null;
  badgeEl?.remove(); badgeEl = null;
  badgeFading = false;
  closeAssetPanel();   // 徽标淡出后详情面板一并收起
}

// ---- 管线未启用警告弹窗(2026-09-03 用户要求"弹窗警告而不是静默失败") ----
// 背景:prune 发布形态下 sprites/vanilla 全家族只在 SW 分片缓存里,SW 没起来
// (注册失败/激活超时/WebView 无 API/http)的会话以前会静默放行进世界=只有
// 角色 UI 完好、其余全缺的"黑图世界"(线上实锤,部分用户)。弹窗给三条出路:
// 复制诊断(支持回贴给开发者)/重试注册(瞬态失败多数可自愈)/仍要进入(本会话
// 不再打扰)。文案硬编码中文(同单人门槛面板先例,诊断工具不走 l10n)。

let pipeEl: HTMLElement | null = null;
let pipeAck = false;   // "仍要进入"已确认——本会话不再重复弹

/** 管线未启用警告。initAssetCache await 完成后调用;enabled 正常时是 no-op。 */
export function warnAssetPipelineDown(): void {
  if (typeof document === 'undefined' || pipeEl || pipeAck) return;
  const fail = assetPipelineFailure();
  if (!fail.down) return;
  // 骨架徽标在管线 down 时永不翻真——摘掉,由本弹窗接管示警(避免双 UI)
  if (badgeEl && badgePending) {
    badgeEl.remove(); badgeEl = null; badgePending = false;
  }
  ensureStyle();
  pipeEl = document.createElement('div');
  pipeEl.className = 'sw-asset-pipe';
  pipeEl.innerHTML = `
    <div class="panel">
      <div class="sw-asset-title" style="font-size:16px;letter-spacing:2px;">⚠ 资源管线未能启动</div>
      <div class="sw-asset-note" style="margin-top:12px;">浏览器资源缓存服务(SW)未就绪,贴图资源无法下载——<br>进入世界后会大面积缺图(仅角色/UI 正常)。建议先重试或反馈诊断信息。</div>
      <div class="reason"></div>
      <div class="btnrow">
        <button data-a="copy">复制诊断信息</button>
        ${fail.transient ? '<button data-a="retry">重试</button>' : ''}
        <button data-a="go">仍要进入</button>
      </div>
      <div class="hint">诊断信息 = 环境/失败原因/缓存清点/最近 300 条资源日志(不含存档与个人信息)</div>
    </div>`;
  document.body.appendChild(pipeEl);
  ensurePanelBg(pipeEl.querySelector('.panel') as HTMLElement);
  (pipeEl.querySelector('.reason') as HTMLElement).textContent = fail.reason || '未知原因(详情见诊断信息)';
  const close = (): void => { pipeEl?.remove(); pipeEl = null; };
  pipeEl.querySelector('[data-a=copy]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget as HTMLElement;
    btn.setAttribute('disabled', '');
    try {
      const report = await buildAssetDiagReport();
      try {
        await navigator.clipboard.writeText(report);
        btn.textContent = '已复制 ✓';
      } catch {
        // 剪贴板 API 不可用(http/权限):回退打开诊断面板手动全选复制
        openAssetDiagPanel();
        btn.textContent = '已打开诊断面板';
      }
    } catch { btn.textContent = '组装诊断失败'; }
    btn.removeAttribute('disabled');
    setTimeout(() => { btn.textContent = '复制诊断信息'; }, 1800);
  });
  pipeEl.querySelector('[data-a=retry]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget as HTMLElement;
    btn.setAttribute('disabled', '');
    btn.textContent = '重试中…';
    swTrace('管线警告弹窗:用户点击重试');
    const ok = await retryAssetCacheInit();
    if (ok) {
      swTrace('管线警告弹窗:重试成功');
      close();
      mountAssetBadge();   // 徽标骨架已摘,重挂走正常进度订阅
    } else {
      btn.textContent = '仍失败';
      btn.removeAttribute('disabled');
      // 失败原因可能已更新——刷新弹窗内的 reason 行
      const r = pipeEl?.querySelector('.reason') as HTMLElement | null;
      if (r) r.textContent = assetPipelineFailure().reason || r.textContent || '';
      setTimeout(() => { btn.textContent = '重试'; }, 1800);
    }
  });
  pipeEl.querySelector('[data-a=go]')?.addEventListener('click', () => {
    pipeAck = true;
    swTrace('管线警告弹窗:用户选择仍要进入');
    close();
  });
}

// ---- 下载详情面板(点击徽标开/关;2026-08-19) ----

let panelEl: HTMLElement | null = null;
let panelUnsub: (() => void) | null = null;

/** 进度条窄屏适配(同 UIGenProgressBar.fitProgressScale 语义):容器宽 <612 时
 *  整体 transform scale(612×70 逻辑尺寸固定,不拉伸不裁切) */
function fitProgressBar(wrap: HTMLElement): void {
  const panel = wrap.closest('.sw-asset-panel, .sw-asset-gate .panel') as HTMLElement | null;
  const avail = Math.max(240, (panel?.clientWidth ?? 612) - 48);
  const k = Math.min(1, avail / 612);
  wrap.style.transform = k < 1 ? `scale(${k})` : '';
}

export function toggleAssetPanel(): void {
  if (panelEl) closeAssetPanel();
  else openAssetPanel();
}

function openAssetPanel(): void {
  if (panelEl || typeof document === 'undefined') return;
  ensureStyle();
  panelEl = document.createElement('div');
  panelEl.className = 'sw-asset-panel';
  panelEl.innerHTML = `
    <div class="sw-asset-title" style="font-size:15px;letter-spacing:2px;">正在下载游戏资源</div>
    <div class="sw-asset-barwrap">
      <div class="outer"></div>
      <div class="slot"><div style="width:0%"></div></div>
    </div>
    <div class="sw-asset-mb"></div>
    <div class="sw-asset-note"></div>
    <button class="sw-asset-retry" style="display:none">重新下载</button>
    <button class="sw-asset-close">关闭</button>`;
  document.body.appendChild(panelEl);
  fitProgressBar(panelEl.querySelector('.sw-asset-barwrap') as HTMLElement);
  ensurePanelBg(panelEl);
  const bar = panelEl.querySelector('.slot > div') as HTMLElement;
  const mbEl = panelEl.querySelector('.sw-asset-mb') as HTMLElement;
  const note = panelEl.querySelector('.sw-asset-note') as HTMLElement;
  const retry = panelEl.querySelector('.sw-asset-retry') as HTMLElement;
  (panelEl.querySelector('.sw-asset-close') as HTMLElement).addEventListener('click', closeAssetPanel);
  retry.addEventListener('click', () => {
    retry.style.display = 'none';
    warmAllAssets(true);
  });
  const update = (st: AssetCacheState): void => {
    if (!panelEl) return;
    bar.style.width = st.bytesTotal > 0
      ? `${Math.min(100, Math.floor((st.bytesDone / st.bytesTotal) * 100))}%`
      : (st.total > 0 ? `${Math.floor((st.done / st.total) * 100)}%` : '0%');
    mbEl.textContent = `${fmtProgress(st)} · ${fmtPct(st)}`;
    note.textContent = st.failed > 0
      ? `下载失败 ${st.failed} 项(点"重新下载"只补缺,已下载部分不会重复下载)`
      : `${phaseText(st)} · 已下载部分不会重复下载`;
    retry.style.display = st.failed > 0 && !st.warming ? '' : 'none';
    if (st.phase === 'done') closeAssetPanel();   // 完成即收起
  };
  update(assetCacheState());
  panelUnsub = onAssetProgress(update);
}

function closeAssetPanel(): void {
  panelUnsub?.(); panelUnsub = null;
  panelEl?.remove(); panelEl = null;
}

// ---- 单人游戏门槛弹窗 ----

let gateEl: HTMLElement | null = null;
let gateUnsub: (() => void) | null = null;

/** 资产未就绪时弹窗等待(实时进度);就绪/完成后执行 action。已就绪直接 action。 */
export function gateAssetsOrRun(action: () => void): void {
  // ★快速路径:上轮完成记录在(门槛真正等的是 SW status 回包的 1-2s keys()
  // 枚举,期间误显示下载中;trace 实证该窗口零实际下载)
  if (assetsCompleteFast()) { action(); return; }
  const s = assetCacheState();
  if (!s.enabled) { action(); return; } // SW 未启用(降级环境)不拦
  if (gateEl) return; // 已在等待
  ensureStyle();
  gateEl = document.createElement('div');
  gateEl.className = 'sw-asset-gate';
  gateEl.innerHTML = `
    <div class="panel">
      <div class="sw-asset-title">正在下载游戏资源</div>
      <div class="sw-asset-barwrap">
        <div class="outer"></div>
        <div class="slot"><div style="width:0%"></div></div>
      </div>
      <div class="sw-asset-pct"></div>
      <div class="sw-asset-note">下载完成后将自动进入(已下载部分不会重复下载)</div>
      <button class="sw-asset-retry" style="display:none">重新下载</button>
    </div>`;
  document.body.appendChild(gateEl);
  fitProgressBar(gateEl.querySelector('.sw-asset-barwrap') as HTMLElement);
  ensurePanelBg(gateEl.querySelector('.panel') as HTMLElement);
  const bar = gateEl.querySelector('.slot > div') as HTMLElement;
  const pct = gateEl.querySelector('.sw-asset-pct') as HTMLElement;
  const retry = gateEl.querySelector('.sw-asset-retry') as HTMLElement;
  retry.addEventListener('click', () => {
    retry.style.display = 'none';
    warmAllAssets(true);  // force:绕过已完成早退守卫,重拉失败项(2026-08-13 review:不绕过则按钮是死的)
  });
  const close = () => {
    gateUnsub?.(); gateUnsub = null;
    gateEl?.remove(); gateEl = null;
  };
  gateUnsub = onAssetProgress((st) => {
    if (!gateEl) return;
    // ★进度条与文案双口径:zip 模式按下载字节(用户感知的"下了多少 MB"),
    // legacy 回退文件数;条宽与文案同源防跳变
    const frac = st.bytesTotal > 0
      ? Math.min(1, st.bytesDone / st.bytesTotal)
      : (st.total > 0 ? st.done / st.total : 0);
    bar.style.width = `${Math.floor(frac * 100)}%`;
    pct.textContent = `${fmtPct(st)} · ${phaseText(st)} · ${fmtProgress(st)}`;
    retry.style.display = st.failed > 0 && !st.warming ? '' : 'none';
    if (assetsComplete()) { close(); action(); }
  });
  pct.textContent = `${fmtPct(s)} · ${phaseText(s)} · ${fmtProgress(s)}`;
  if (s.failed > 0 && !s.warming) retry.style.display = '';
}

// ---- 启动 splash 保持期(2026-08-24) ----

export interface HoldDeps {
  now(): number;
  state(): AssetCacheState;
  completeFast(): boolean;
  complete(): boolean;
  /** 失败终态放行的前置门(缺省=真实现 zipAutoRetries≥5);单测注入 */
  retriesExhausted?(): boolean;
  /** 停滞+warming 时的重启动作(缺省=warmAllAssets(true) 对账续传);单测注入 */
  warm?: () => void;
}

/** 启动 splash 保持（2026-08-27 用户定案语义:**过渡图阶段必须全量落盘才放行揭幕**;
 *  2026-08-26 为"p0-p8",2026-08-27 收紧为全部 zip 分片——菜单不允许缺图)。
 *  成功放行:phase==='done' 且 failed===0 且 done≥total(worker 真完成终态;
 *  不用 complete() 的 cached 口径——status 回包含壳噪声曾虚高越线)。
 *  失败放行:**失败终态**(failed>0 且 !warming;徽标在菜单继续示警+门槛
 *  "重新下载"兜底)。★2026-08-27 修复:warm 进行中的瞬时条目失败(片重试中,
 *  warming 仍 true)曾命中旧条件 `failed>0` 提前放行揭幕=手机弱网下"资源没
 *  加载完就到主菜单"(用户实测);现必须等 warming 熄灭。
 *  停滞放行:done+bytesDone+phase 三静止达 stallMs(防下载链挂死;150s——
 *  移动网络冷边缘起速慢,60s 曾误放)。
 *  sinceMs = splash 已显示时长(loadAssets 期计入)。轮询 250ms。 */
export function holdForAssetsReady(opts: {
  minMs: number;
  sinceMs?: number;
  /** 进度停滞放行窗(默认 150s):done+bytesDone+phase 三静止达窗即放行。
   *  zip 健康下载 worker 每 200ms/512KB 报字节增量——远快于此窗,不误触发 */
  stallMs?: number;
  deps?: HoldDeps;
}): Promise<void> {
  const { minMs, sinceMs = 0, stallMs = 150_000 } = opts;
  const d = opts.deps ?? {
    now: () => performance.now(),
    state: assetCacheState,
    completeFast: assetsCompleteFast,
    complete: assetsComplete,
    retriesExhausted: assetsRetriesExhausted,
    warm: () => warmAllAssets(true),
  };
  const retriesEx = d.retriesExhausted ?? assetsRetriesExhausted;
  const t0 = d.now();
  const needWait = d.state().enabled;   // 调用点在 await initAssetCache() 之后:
  // enabled=false 已是穷尽重试的降级终态(dev/?nosw/register 三连败)→ 无等待概念
  return new Promise((resolve) => {
    let lastSig = '';
    let lastProgressAt = d.now();
    const finish = (why: string) => {
      swTrace(`hold放行[${why}] 等待${Math.round(d.now() - t0)}ms done=${(d.state() as AssetCacheState).done}/${(d.state() as AssetCacheState).total}`);
      clearInterval(iv); resolve();
    };
    const iv = setInterval(() => {
      const elapsed = sinceMs + (d.now() - t0);
      if (elapsed < minMs) return;
      const s = d.state();
      if (!needWait) { finish('未启用降级'); return; }   // 降级终态:补满 minMs 即放行(无等待概念)
      // 放行只认两条,均以 phase 终态为准(2026-08-27):
      //   ①worker 真完成(phase=done 且 failed=0 且 done≥total)——不用
      //     complete()/done 口径:status 回包的 cached 曾把 done 污染成假满
      //     (用户手机实测 34% 字节进度 30s 内揭幕缺图菜单)
      //   ②失败终态(须自动补拉轮耗尽,轮内 15s/online 会自愈)
      if ((s.phase === 'done' && s.failed === 0 && s.done >= s.total) || (s.failed > 0 && !s.warming && retriesEx())) { finish(s.failed > 0 ? `失败终态(轮耗尽) failed=${s.failed}` : '真完成'); return; }
      // 停滞检测:done/bytesDone/phase 三静止达窗:
      //   warming 中 = 下载链疑似挂死/手机切后台节流 → force 重启对账续传
      //   (2026-08-27 手机实测:锁屏 150s 无增量曾放行揭幕缺图菜单——不再放行)
      //   !warming = 无任何活动是真挂死 → 放行兜底
      const sig = `${s.done}|${s.bytesDone}|${s.phase}`;
      if (sig !== lastSig) { lastSig = sig; lastProgressAt = d.now(); return; }
      if (d.now() - lastProgressAt >= stallMs) {
        if (s.warming) { swTrace(`hold停滞${stallMs}ms(warming)→ force重启对账`); d.warm?.(); lastProgressAt = d.now(); return; }
        finish(`停滞${stallMs}ms(无活动)`);
      }
    }, 250);
  });
}

// ---- 资产诊断面板(2026-08-27;手机无 Console 的取证出口) ----
// 入口:主菜单 logo 连点 5 次(TitleMenu 绑定)。展示 swTrace 环形日志
// (内存本轮 + IDB 上轮[★BJ627 经 PrefsStore],跨刷新可见),textarea 可全选复制。

/** 追加一条到诊断日志(供 UI 层补充上下文,如"logo 连点"本身) */
export function assetDiagNote(msg: string): void {
  swTrace(msg);
}

export function openAssetDiagPanel(): void {
  if (typeof document === 'undefined' || document.getElementById('sw-asset-diag')) return;
  ensureStyle();
  const el = document.createElement('div');
  el.id = 'sw-asset-diag';
  el.className = 'sw-asset-diag';
  el.innerHTML = `
    <div class="diag-wrap">
      <div class="diag-bar">
        <span>资产诊断 · 最近 300 条(跨刷新持久)</span>
        <button data-a="audit">深度体检</button>
        <button data-a="copy">复制全部</button>
        <button data-a="close">关闭</button>
      </div>
      <textarea readonly spellcheck="false"></textarea>
    </div>`;
  document.body.appendChild(el);
  const ta = el.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = readSwTrace().join('\n') || '(空)';
  ta.scrollTop = ta.scrollHeight;
  // 异步补全量诊断报告(2026-09-03):环境/失败原因/缓存清点/存储配额 +
  // swTrace 尾段——缓存清点 keys() 要 1-2s,先出 trace 再原地替换
  void buildAssetDiagReport().then((rep) => {
    if (!ta.isConnected) return;
    ta.value = rep;
    ta.scrollTop = ta.scrollHeight;
  });
  (el.querySelector('[data-a=close]') as HTMLElement).addEventListener('click', () => el.remove());
  (el.querySelector('[data-a=audit]') as HTMLElement).addEventListener('click', async () => {
    const st = assetCacheState();
    const name = 'sw-assets-v' + st.version;
    const c = await caches.open(name);
    const all = await c.keys();
    let ok = 0, nomatch = 0, html = 0, empty = 0, doc = 0;
    const bad: string[] = [];
    const prog = (i: number) => {
      ta.value = `深度体检 ${name} ${i + 1}/${all.length}\n\nok=${ok} NOMATCH=${nomatch} HTML毒=${html} 空体=${empty} 文档(设计内)=${doc}\n${bad.join('\n')}`;
      ta.scrollTop = 0;
    };
    for (let i = 0; i < all.length; i++) {
      const r = all[i];
      const p = new URL(r.url).pathname;
      try {
        const res = await c.match(r);
        if (!res) { nomatch++; if (bad.length < 300) bad.push(`NOMATCH ${p}`); }
        else {
          // 文档类(/、index.html、.html)是 SW 文档分支的设计内缓存(离线回退
          // 入口,fetch handler 主动 put)——不计 HTML 毒(2026-09-04 误报修正:
          // 首份体检曾把健康的 / 条目报成"HTML毒 1"误导排查)
          if (p === '/' || p.endsWith('.html')) { doc++; continue; }
          const ct = res.headers.get('content-type') || '';
          const blob = await res.blob();
          if (/html/i.test(ct)) { html++; if (bad.length < 300) bad.push(`HTML毒 ${p}`); }
          else if (blob.size === 0) { empty++; if (bad.length < 300) bad.push(`空体 ${p}`); }
          else ok++;
        }
      } catch (e) { nomatch++; if (bad.length < 300) bad.push(`ERR ${p} ${String(e).slice(0, 40)}`); }
      if (i % 400 === 0 || i === all.length - 1) prog(i);
    }
    // 重点抽查(用户报障三样本+空格族)——★三模式 match 对照(2026-09-04):
    //  「体检 keys 原对象命中、页面请求 miss」的 Vary/头匹配差异在此定案
    const spot: string[] = [];
    for (const n of ['sprites/vanilla/Projectile_29.png', 'sprites/vanilla/Gore_61.png',
      'sprites/vanilla/SplashScreens_Splash_6_2.png', 'sprites/vanilla/Backgrounds_Underworld 0.png',
      'sprites/vanilla/Cloud_0.png']) {
      const u = 'https://sandboxworld.online/' + n;
      const mStr = await c.match(u).then((r) => (r ? `${r.status}` : 'MISS')).catch(() => 'ERR');
      const mIgn = await c.match(u, { ignoreVary: true }).then((r) => (r ? `${r.status}` : 'MISS')).catch(() => 'ERR');
      let mReq = 'KEYS无';
      let vary = '(条目无)';
      for (const r of await c.keys()) {
        if (r.url !== u) continue;
        mReq = await c.match(r).then((x) => (x ? `${x.status}` : 'MISS')).catch(() => 'ERR');
        const res0 = await c.match(r);
        if (res0) vary = res0.headers.get('vary') || '(无Vary头)';
        break;
      }
      spot.push(`${n}\n    字符串match=${mStr} | ignVary=${mIgn} | keys原对象=${mReq} | vary=${vary}`);
    }
    ta.value = `深度体检完成 ${name}\n总=${all.length} ok=${ok} NOMATCH=${nomatch} HTML毒=${html} 空体=${empty} 文档(设计内)=${doc}\n` +
      `抽查:\n${spot.join('\n')}\n\n坏条目清单(≤300):\n${bad.join('\n')}\n\n—— 以下为 trace ——\n${readSwTrace().join('\n')}`;
    ta.scrollTop = 0;
  });
  (el.querySelector('[data-a=copy]') as HTMLElement).addEventListener('click', async () => {
    ta.select();
    try {
      await navigator.clipboard.writeText(ta.value);
      (el.querySelector('[data-a=copy]') as HTMLElement).textContent = '已复制 ✓';
    } catch {
      document.execCommand('copy');   // 剪贴板 API 不可用时的老式兜底
      (el.querySelector('[data-a=copy]') as HTMLElement).textContent = '已复制 ✓';
    }
    setTimeout(() => { const b = el.querySelector('[data-a=copy]'); if (b) b.textContent = '复制全部'; }, 1500);
  });
}
