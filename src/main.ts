// 入口：加载素材/字体/文案 → VUI 主菜单 → 生成/加载世界 → 进入游戏
// 流程编排见 mainFlow.ts；本文件只做装配 + 游戏内键盘/开发者工具接线。
import './workers/procShim';   // ★首导入兜底(见 procShim.ts;worker 侧同款已挂 worldGen.worker)
import { Game } from './core/Game';
import { showSplash } from './ui/Splash';
import { shouldShowAudioGate, showAudioGate } from './ui/AudioGate';
import { mountInstallPrompt } from './ui/InstallPrompt';
import { UI } from './ui/UI';
import { resolveEscapeChain } from './ui/escapeChain';   // SW-BN2 2026-09-07
import { modUiPanelsOpen, modUiCloseTop } from './mods/ui';   // ★刀1:mod UI 面板(ESC 链支)
import { kvHas } from './save/KvStore';
import { preloadPrefs } from './save/PrefsStore';   // ★BJ627 偏好域 IDB 预载（候选 C:IDB 权威+内存缓存）
import { saveGame } from './save/SaveFile';
import { ITEM_BY_KEY , VANILLA_ITEM_KEY_BY_ID , ITEM_DEFS } from './data/items';
import { combatWeapon } from './data/vanillaItemCombat';
import { TILE_BY_KEY, T, TILE_DEFS, WALL_DEFS } from './data/tiles';
import { liveGorePieces } from './entities/GorePiece';
import { parseWldToSave } from './wld/WldImport';
// 调试句柄：页面内直接测 .wld 转换
(window as unknown as { __parseWld?: (b: Uint8Array) => unknown }).__parseWld = parseWldToSave as unknown as (b: Uint8Array) => unknown;
import { SpriteAtlas } from './assets/SpriteAtlas';
import { AudioSystem } from './core/Audio';
import { Sfx } from './core/Sfx';
import type { AudioRecExport } from './debug/AudioRecorder';
import { setDebugPool } from './data/vanillaNpcs';
import { VUI } from './vui/VUI';
import { assetsDownloadIdle, initAssetCache, primeBootAssets, setLazyWorkerPrefetch, warmAllAssets } from './net/AssetCache';
import { prefetchWorldGenWorker } from './workers/WorldGenClient';
import { prefetchSaveWorker } from './workers/SaveClient';
import { prefetchLightWaveWorkers } from './workers/lightWavePrefetch';   // ★2026-09-29 拆出 WorkerGovernance(见该文件头注);light/wave 脚本预热
import { holdForAssetsReady, mountAssetBadge, warnAssetPipelineDown } from './ui/AssetDownloadUI';
import { UITextures } from './vui/assets/UITextures';
import { UIFont } from './vui/draw/UIFont';
import { Lang } from './i18n/Lang';
import { options } from './core/Options';
import { isBound } from './core/Keybinds';
import { VuiDemoState } from './vui/states/VuiDemoState';
import { createFlow } from './mainFlow';
import { startUpdateCheck } from './update/UpdateCheck';
import { mountUpdateBanner } from './update/UpdateBanner';
import type { FlowHandle } from './mainFlow';
import { downloadDebugReport, stackFrameSummary } from './debug/DebugReport';
import { initTileFrameCapture, tileFrameCapture } from './debug/TileFrameCapture';
import { tileAnim, TILE_ANIM_RATE, TILE_ANIM_PITCH, TILE_ANIM_FRAMES } from './render/TileAnim';
import { showFeatureGate } from './ui/QuickGate';
import { showJourneyQuickGate } from './ui/QuickGate';
import { openPlayerListPanel } from './ui/PlayerListPanel';
import { openJourneyPowersPanel } from './ui/JourneyPowersUI';

/** ★SW-FX16 2026-09-10：Shift 组合调试键保留集——这些键在 main.ts/Game.ts 有各自的
 *  Shift 组合臂（F1/F2 像素画·无敌、F3 碰撞盒、F4 迷雾、F5 录制·注记、F10 地图传送）,
 *  Shift 按下时调试臂优先于键位动作（缺省 ToggleCameraMode=F4 ∈ 集保持原行为）。
 *  重绑 ToggleCameraMode 到集外键后 Shift+键 照常触发相机模式（原版触发器无 Shift
 *  概念）。消费点：runKeybindHotkeys 的相机模式门。 */
const SHIFT_DEBUG_RESERVED: ReadonlySet<string> = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F10']);
import { openResearchPanel } from './ui/ResearchUI';
import { installCanvasWatch } from './render/CanvasWatch';
import { browserWheelDeltaYToVanilla } from './render/CaptureMode';   // ★SW-FX50 滚轮符号对齐
import { RemasterRuntime } from './remaster/RemasterRuntime';
import { assetVersion } from './net/AssetCache';
import { RemasterManager } from './remaster/RemasterManager';
import { initResourcePacks, type ResourcePackManager } from './resources/ResourcePackManager';
import { setRemasterBuffIcon, clearIconCache } from './ui/UI';
import { modBuffIconUrl } from './mods/buffs';
import { setModAudioSink, getModWavData } from './mods/hooks';
import { getModLoadResult } from './mods/loader';   // ★模组设置入口门控(loaded>0 才显示)
import { openModSettingsPanel } from './mods/modSettingsPanel';

// canvas 分配哨兵(2026-08-18):出生率 >20/s 持续 10s → console.warn 带出生栈
// (cloudTint 340 张/秒事故的常驻防线;?cwatch=0 静默)。须在 UI/游戏模块
// 构造前装——模块加载期的单例画布不计入,可接受(一次性常量非泄漏面)
installCanvasWatch();
void preloadPrefs();    // ★BJ627 偏好域预载提前起跑（与模块初始化重叠;boot 链首行再 await 兜时序——单飞幂等）
mountInstallPrompt();   // PWA 安装提示条(beforeinstallprompt 捕获;iOS 引导;7 天冷却)

const root = document.getElementById('game-root')!;
const ui = new UI(root);

// ---- ?imglog=1:HTMLImageElement 绘制探针(2026-08-18 trace 残余流定性工具) ----
// 挂 drawImage 计数 wrapper(全 canvas 覆盖)+ 每 5s 报告 TOP 绘制源与
// createImageBitmap 失败统计。headless 无 GPU 压力测不到的路径,用真机跑:
// 打开 http://host/?imglog=1 → 复现操作 → 控制台 [imglog] 行即答案
if (new URLSearchParams(location.search).get('imglog') === '1') {
  const stats = new Map<string, number>();
  const orig = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (img: CanvasImageSource, ...rest: unknown[]) {
    if (img instanceof HTMLImageElement) {
      const k = (img.currentSrc || img.src || '').split('/').slice(-2).join('/').slice(0, 80);
      stats.set(k, (stats.get(k) ?? 0) + 1);
      if (stats.size > 600) stats.clear();
    }
    return (orig as (...a: unknown[]) => ReturnType<typeof orig>).call(this, img, ...rest);
  };
  (window as unknown as { __swImgDraw?: Map<string, number> }).__swImgDraw = stats;
  setInterval(() => {
    const top = [...stats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, v]) => `${k}×${v}`).join('  ') || '(零 Image 绘制)';
    console.log(`[imglog] 5s Image绘制TOP: ${top}`);
  }, 5000);
}

// ---- 调试报告基础设施：错误 ring（F5 报告 errors 段唯一数据源）----
// kind: 0=pageerror 1=unhandledrejection 2=console.error；stack 取帧行（★BJ331 前取首行=消息行,帧全丢）
// ★SW-BM1 2026-09-06（工具链债扩容）：总环 50→300 + fatal 独立环——旧 50 深环在
// 渲染层 warn-once 失修刷屏时会把真错误挤出窗口;分级留存 = kind 0/1（pageerror/
// unhandledrejection,崩溃类）另入 __swErrorsFatal(100) 独立环,console.error 噪声
// 永远逐不出 fatal。内存上限：单条 ≤~850B（msg 500+stack 300+壳）→ 总环 ~255KB +
// fatal ~85KB ≈ 340KB 常驻——F5 报告 errors 段上限 150 条（fatal 全量 ∪ 总环最近,
// 按时间归并）≈ 130KB,对 2.1MB 报告体积增量 <7%,安全
interface SwErrorRecord { t: number; kind: number; msg: string; stack: string | null }
const ERR_RING_CAP = 300;
const ERR_FATAL_RING_CAP = 100;
function pushSwError(kind: number, msg: unknown, stack: string | null | undefined) {
  const w = window as unknown as { __swErrors?: SwErrorRecord[]; __swErrorsFatal?: SwErrorRecord[] };
  if (!Array.isArray(w.__swErrors)) w.__swErrors = [];
  const rec: SwErrorRecord = {
    t: Date.now(), kind,
    msg: String(msg).slice(0, 500),
    // ★BJ331：stack 改取帧行（stackFrameSummary）——曾取首行=消息行与 msg 字段重复,
    //  帧全丢,打包态事故栈只剩一行无从定位
    stack: stackFrameSummary(stack),
  };
  w.__swErrors.push(rec);
  if (w.__swErrors.length > ERR_RING_CAP) w.__swErrors.shift();
  if (kind <= 1) {
    if (!Array.isArray(w.__swErrorsFatal)) w.__swErrorsFatal = [];
    w.__swErrorsFatal.push(rec);
    if (w.__swErrorsFatal.length > ERR_FATAL_RING_CAP) w.__swErrorsFatal.shift();
  }
}
window.addEventListener('error', (e) => pushSwError(0, e.message, e.error instanceof Error ? e.error.stack : null));
window.addEventListener('unhandledrejection', (e) =>
  pushSwError(1, e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : e.reason, e.reason instanceof Error ? e.reason.stack : null));
{
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    const err = args.find((a): a is Error => a instanceof Error);
    pushSwError(2, args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '), err ? err.stack : null);
    origError(...args);
  };
}
// 资源加载失败入警告环(img/audio/script 的 error 事件不触发 console.error,
// 此前 F5 只能靠网络面板;漏抓面补上)
window.addEventListener('error', (e) => {
  const t = e.target as unknown as { src?: string; href?: string } | null;
  const src = t && (t.src || t.href);
  if (src) pushSwWarn(`[资源加载失败] ${String(src).slice(0, 180)}`);
}, true);

// 警告 ring（F5 报告 warnings 段数据源；与错误环分离——告警刷屏不能挤掉真错误）。
// 全量捕获 console.warn：渲染层的 warn-once（如 VanillaTiler 源矩形越界/取帧失败）
// 随手入环，任何模块无需单独接线
const WARN_RING_CAP = 50;
function pushSwWarn(msg: unknown) {
  const w = window as unknown as { __swWarns?: Array<{ t: number; msg: string }> };
  if (!Array.isArray(w.__swWarns)) w.__swWarns = [];
  w.__swWarns.push({ t: Date.now(), msg: String(msg).slice(0, 500) });
  if (w.__swWarns.length > WARN_RING_CAP) w.__swWarns.shift();
}
{
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    pushSwWarn(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
    origWarn(...args);
  };
}

ui.onBestiary = () => flow?.openBestiary(); // 背包面板图鉴按钮（原版 BestiaryMenuButton）
ui.onHousing = () => flow?.openHousing?.(); // 背包面板住房按钮（原版 DrawInterface_33_Housing）
// SW-BN3 2026-09-07：背包面板设置钮 → 暂停/设置浮层（原版 playerInventory 态的
// 设置入口 = DrawInterface_29_SettingsButton Main.cs:46287-46301,clickAction =
// ingameOptionsWindow ? Close : Open :46294-46299 同款 toggle）。
// ★SW-RB8c 2026-09-08 勘误：Open 臂收背包（IngameOptions.cs:70）/Close 臂回背包
// （:108）——原版设置窗与背包两态互斥,「浮层叠于背包」系 BN3 误读
ui.onPauseMenu = () => {
  const g = flow?.game;
  if (!g) return;
  if (pausePanel) {
    closeInGamePause(g);   // Close 臂（:108 回背包）
    return;
  }
  openInGamePause(g);      // Open 臂（:70 收背包）
};
const audio = new AudioSystem();
let atlas: SpriteAtlas | null = null;

let flow: FlowHandle | undefined;

// ---- 音效录制接线（2026-09-03 用户需求：F5 长按录制窗记录音频播放序列，
//      BGM 与 SFX 分列 audioRec.sfx / audioRec.bgm 两环,见 debug/AudioRecorder）----
// 钩子在【事件时刻】经 flow?.game 解析活 Game——换世界/HMR 双实例不钉死旧 Game。
// Sfx.onEvent 是静态钩,覆盖 Game.sfx 与 UISfx 共享单例两实例;菜单实例（UISfx）
// 的事件类带 @ui 后缀（对话按钮/相机快门等游戏内 UI 音可见出身）。
Sfx.onEvent = (k, d, tag) => flow?.game?.audioRec.sfx.log(tag ? `${k}@ui` : k, d);
audio.onEvent = (k, d) => flow?.game?.audioRec.bgm.log(k, d);   // sel/start/stop/fail/ended(ended+无 stoppedByFade=loop 失效哨兵)
let inGame = false;
let pausePanel: HTMLElement | null = null;
/** ★A9:暂停浮层开启前的 uiBlocking 沿(关闭还原非覆写) */
let pauseSavedBlocking = false;

// ★首屏静态读条摘除(见 index.html #sw-boot-static 注):bundle 就绪后由
//   启动幕(#sw-boot-prime)接棒——幕挂载时摘(无缝交接);bypass 路径无幕,
//   在 boot 回调入口即摘(防盖住 splash/快速通道)
const removeStaticBoot = (): void => {
  document.getElementById('sw-boot-static')?.remove();
};

// ---- 动画帧捕获系统（被动聚合恒开 + 长按 F5 录制窗全量）----
// 快照/截图/异常像素小样都要主画布与相机；tick 用渲染端动画时钟。
initTileFrameCapture({
  tick: () => tileAnim.tick,
  canvas: () => {
    const cs = document.querySelectorAll('canvas');
    let best: HTMLCanvasElement | null = null, area = 0;
    cs.forEach((c) => { const a2 = c.width * c.height; if (a2 > area) { area = a2; best = c; } });
    return best;
  },
  camera: () => {
    const g = flow?.game;
    const cam = g ? (g as unknown as { camera?: { x: number; y: number } }).camera : null;
    return cam ? [cam.x, cam.y] : null;
  },
  zoom: () => (flow?.game as unknown as { camera?: { zoom: number } } | undefined)?.camera?.zoom ?? 1,
}, { rate: TILE_ANIM_RATE, pitch: TILE_ANIM_PITCH, frames: TILE_ANIM_FRAMES });

async function loadAssets() {
  atlas = new SpriteAtlas();
  try {
    // ★Maples 退役刀1(2026-10-17):atlas.load()(Maples atlas.json/resources.json/
    // annotations.json 预载)随域退役删除——15 文件全为地形/角色 两前缀,消费面已全删。
    // 菜单首帧所需的 UI 贴图(面板/按钮/光标/logo)在显示主菜单前就位——
    // 否则 vui 懒加载下首帧控件用兜底样式闪一帧。
    // ★UI_ 全量族按子族排除(2026-08-13):素材全量入库后 UI_ 76→397 键,
    //   面板专属子族(图鉴/小地图/世界创建/角色创建/创意/工坊/成就…)只在各自
    //   面板打开时才需要,vui 消费方每帧重查 ensureUiImage 缺图自愈——
    //   收窄到菜单/加载页 chrome,请求 426→~170,零闪烁风险
    // 2026-08-24 HAR 审计收窄（用户报 logo_1..8 菜单白载）：
    //  · 'logo' 前缀整组移除——logo_1..8 是死资产（AssetInitializer 加载后无绘制点）
    //  · 'Inventory_' 前缀移除——Inventory_Back1-15/Tick 全是游戏内背包 UI，菜单
    //    零消费；进游戏后 vui 懒载自愈（首帧 null 下帧补）
    //  · 排除表增补：UI_UI_BossBar/UI_MapPing（游戏内 HUD，绘制路径 vui 懒载）、
    //    UI_TitleLinkButtons（原版标题链接钮，本作无消费方）、
//    UI_Sunflower_Loading（splash 向日葵已改等待期懒载直拉，不走 atlas）
    await atlas.preloadUiPrefix(
      ['UI_', 'Logo'], undefined,
      ['UI_Bestiary', 'UI_Minimap', 'UI_WorldCreation', 'UI_CharCreation',
       'UI_PlayerResourceSets', 'UI_Workshop', 'UI_Creative', 'UI_Wires',
       'UI_DisplaySlots', 'UI_Achievement', 'UI_Craft', 'UI_InfoIcon',
       'UI_Settings', 'UI_Camera', 'UI_UI_BossBar', 'UI_MapPing',
       'UI_TitleLinkButtons', 'UI_Sunflower_Loading'],
    );
  } catch {
    atlas = null; // 素材缺失时回退程序化生成
  }
  (window as unknown as { __swAtlas?: SpriteAtlas | null }).__swAtlas = atlas; // 调试/探针句柄
  // 素材重制热补丁(2026-08-19):已装 pack 在菜单显示前应用——此刻无 chunk 烘焙、
  // 无懒加载竞争,vimages.set 直接覆盖,后继 ensureVImage 的 has 检查命中早退。
  // 失败静默(坏包不阻断启动;面板导入路径有显式报错)
  if (atlas) {
    remasterRuntime = new RemasterRuntime(atlas);
    remasterManager = new RemasterManager(remasterRuntime, () => assetVersion());
    const rt = remasterRuntime;
    // ★mod buff 图标链直挂(P2):无条件初挂(否则零 remaster 包时 mod buff 图标永不
    //  解析;onApplied 重入也走同组合=幂等)。mod 伪 id(9000+)→mod objectURL,
    //  miss 落 remaster/原版
    setRemasterBuffIcon((id) => modBuffIconUrl(id) ?? rt.buffIconUrl(id));
    // ★B6 mod 音效通道 sink(原版 SoundID 键;mod 音频装载=余段)
    setModAudioSink((files, volume, x, y) => {
      const g = (window as unknown as { __swGame?: { playSfxFiles?: (f: string[], v: number, x?: number, y?: number) => void; sfx?: { buffers: Map<string, AudioBuffer>; ensure: () => AudioContext | null; registerModAudio?: (f: string, b: AudioBuffer) => void } } }).__swGame;
      if (!g) return;
      // ★B6 mod 音频:files[0] 在 modWavData 中→decodeAudioData→Sfx.buffers→playFiles
      //  否则透传原版键
      const audioCtx = g.sfx?.ensure?.() ?? null;
      if (audioCtx && files.length > 0) {
        const wavData = getModWavData();
        for (const f of files) {
          const raw = wavData.get(f);
          if (raw !== undefined && !g.sfx!.buffers.has(f)) {
            audioCtx.decodeAudioData(raw.slice()).then((decoded) => {
              g.sfx!.registerModAudio?.(f, decoded);
            }).catch(() => {});
          }
        }
      }
      g.playSfxFiles?.(files, volume, x, y);
    });
    remasterRuntime.onApplied = (info) => {
      // UI 派生缓存:物品图标 dataURL 缓存按物品 id 键不自动失效(Atlas 替换须清);
      // buff 栏直链 <img src> 经钩子取 runtime 的 objectURL 覆盖。
      // 资源包物品图(vanilla/Item_N.png,M13)同须清——vicon 整图直取后旧 dataURL 钉死
      if (info.hasItemAtlas || info.files.some((f) => /^vanilla\/Item_\d+\.png$/.test(f))) clearIconCache();
      // ★mod buff 图标覆盖链(P2):mod 伪 vanillaBuff(9000+)优先命中 objectURL,
      //   miss 落 remaster/原版——原版域零扰动(mod id 不相交)
      setRemasterBuffIcon((id) => modBuffIconUrl(id) ?? rt.buffIconUrl(id));
    };
    try {
      // ★超时保护:IDB v2 升级遇旧标签页持有 v1 连接不让路时 openDb 永久 pending
      // (onversionchange 只对同代码版本生效;生产首次部署旧页在跑旧 bundle)——
      // 素材包是增强不是必需,8s 不到就放弃,绝不阻断启动
      await Promise.race([
        remasterManager.applyInstalled(),
        new Promise<void>((resolve) => setTimeout(resolve, 8000)),
      ]);
    } catch (err) {
      console.warn('[remaster] 启动应用素材包失败(已跳过):', err);
    }
    // ---- 资源包(M13):与 remaster 共享同一注入 runtime(buff 钩子/弹幕覆盖/重烘链
    //      合流);启用包在菜单显示前应用,zip 读不出来时静默降级会话态 ----
    try {
      const rpManager = initResourcePacks(remasterRuntime);
      await Promise.race([
        rpManager.applyInstalled(),
        new Promise<void>((resolve) => setTimeout(resolve, 8000)),
      ]);
      (window as unknown as { __swResourcePacks?: ResourcePackManager }).__swResourcePacks = rpManager;
      // ★桌面 Steam 工坊材质包自动发现(2026-10-12):/resourcepacks-workshop/index.json
      //   (desktop/main.mjs 扫 steamapps/workshop/content/105600/* 含 pack.json 的包)
      //   → 未装包自动导入并启用(订阅=意图;已装按 fileName=workshop_<id> 跳过,
      //   启停权交资源包页)。失败静默跳过(增强不是必需)。
      if ((window as unknown as { sandboxDesktop?: { isShell?: boolean } }).sandboxDesktop?.isShell) {
        try {
          const idx = await fetch('resourcepacks-workshop/index.json').then((r) => r.json()) as {
            packs?: Array<{ id: string; name: string }>;
          };
          for (const p of idx.packs ?? []) {
            try {
              const mark = `workshop_${p.id}.zip`;
              if (rpManager.rows.some((r) => r.fileName === mark)) continue;
              const zip = new Uint8Array(await fetch(`resourcepacks-workshop/${p.id}/pack.zip`).then((r) => r.arrayBuffer()) as unknown as ArrayBuffer);
              const row = await rpManager.importPack(zip, mark);
              await rpManager.setEnabled(row.id, true);
              console.info(`[resourcepacks] 工坊包已导入并启用: ${p.name} (${p.id})`);
            } catch (e) {
              console.warn('[resourcepacks] 工坊包导入失败(跳过):', p?.id, e);
            }
          }
        } catch { /* 无工坊路由=静默 */ }
      }
    } catch (err) {
      console.warn('[resourcepacks] 启动应用资源包失败(已跳过):', err);
    }
    const w = window as unknown as { __swRemaster?: { runtime: RemasterRuntime; manager: RemasterManager } };
    w.__swRemaster = { runtime: remasterRuntime, manager: remasterManager }; // 调试/探针/面板句柄
    // ★mod 贴图注入(2026-10-04):atlas 就绪后、任何 chunk 烘焙前(vimages 键注入,
    //   remaster 同款;失败不阻断启动)。带超时护栏(mod 多/图大不卡启动幕)
    try {
      const { applyModAssets } = await import('./mods/assets');
      await Promise.race([
        applyModAssets(atlas),
        new Promise<void>((resolve) => setTimeout(resolve, 30000)),   // ★B6:8s→30s(全量包 5,700 张解码;并行后常规 3-6s,慢机兜底)
      ]);
      (window as unknown as { __swModsLoaded?: boolean }).__swModsLoaded = true;
    } catch (err) {
      console.warn('[mods] 贴图注入失败(已跳过):', err);
    }
  }
}

/** 素材重制热补丁运行时(main.ts 装配;__swRemaster 暴露) */
let remasterRuntime: RemasterRuntime | null = null;
let remasterManager: RemasterManager | null = null;

/** ★BJ318：虚拟键接线独立函数——g 走形参（入子调用上下文）。曾与 onSheetReplaced
 *  闭包共享 enterGameHooks 作用域:该闭包被 RemasterRuntime（模块单例）长期持有,
 *  其上下文里的 `g` 槽=退世界后钉死最后一局 Game 的残锚（forward-BFS 定谳）。 */
function wireMobileVirtualKeys(g: Game): void {
  // ---- 移动端虚拟 Inventory/Esc 键入口(mobile-adaptation-plan 模块①):触屏系统
  //      列的背包/暂停钮 = input.tapVirtual('Inventory') 虚拟边沿在此转调同一优先
  //      级链。★origin==='virtual' 门防双触发:真实键盘 Escape 既走上方 window
  //      keydown 监听(preventDefault/打字豁免是物理专属),也会派发进
  //      keydownHandlers——不过滤则同一次按键链跑两遍(Esc 开面板→瞬关)。
  //      虚拟沿自带 virtualAction='Inventory',不再经 isBound 反查(code 是绑定
  //      表首个码,重绑后仍一致)
  g.input.keydownHandlers.push((code, ke) => {
    if (ke.origin !== 'virtual') return;
    // action 口(系统列背包/暂停钮):intent 显式携带。SW-BN2 起 intent=触发源形态
    // 'escape'(Esc 键面)/'inventory'(背包钮/其余绑定键)/'pause'(触屏暂停小钮)
    if (ke.virtualAction === 'Inventory') {
      runInventoryEscapeChain(g,
        ke.virtualIntent === 'inventory' ? 'inventory'
          : ke.virtualIntent === 'pause' ? 'pause'
          : ke.virtualIntent === 'escape' ? 'escape'
          : code === 'Escape' ? 'escape' : 'inventory');
      return;
    }
    // code 口直发 Escape(调试脚本/未来控件):归还 Inventory 链 escape 形态
    // (默认绑定表含 Escape;用户清空该绑定时按表不响应=重绑一致)
    if (code === 'Escape' && isBound('Inventory', 'Escape')) {
      runInventoryEscapeChain(g, ke.virtualIntent === 'inventory' ? 'inventory' : 'escape');
    }
  });
}

function enterGameHooks() {
  const g = flow?.game ?? undefined;
  inGame = true;
  (window as unknown as { __swTiles: typeof TILE_BY_KEY }).__swTiles = TILE_BY_KEY;
  (window as unknown as { __swItems: typeof ITEM_BY_KEY }).__swItems = ITEM_BY_KEY;
  (window as unknown as { __swVANILLA_ITEM_KEY_BY_ID: typeof VANILLA_ITEM_KEY_BY_ID }).__swVANILLA_ITEM_KEY_BY_ID = VANILLA_ITEM_KEY_BY_ID;
  (window as unknown as { __swITEM_DEFS: typeof ITEM_DEFS }).__swITEM_DEFS = ITEM_DEFS;
  (window as unknown as { __swCombatWeapon: typeof combatWeapon }).__swCombatWeapon = combatWeapon;
  (window as unknown as { __swSetPool?: (p: number[] | null) => void }).__swSetPool = setDebugPool;
  // gore 池只读视图（模块级 livePool 不经 Game 实例——探针断言气泡族/碎块推进用）
  (window as unknown as { __swGore?: typeof liveGorePieces }).__swGore = liveGorePieces;
  // 素材重制热补丁:运行中替换 tile/wall sheet → ChunkCache 消费登记精确重烘
  // (★禁 invalidateAll——21 万次重解码风暴前科);闭包每次现取 game,换世界安全
  // ★BJ318：本闭包与 keydown 接线共享作用域曾把 `g` 槽带进 RemasterRuntime 长持
  //  上下文——接线已抽独立函数（wireMobileVirtualKeys）,本作用域不再捕获 Game。
  if (remasterRuntime) {
    remasterRuntime.onSheetReplaced = (file) => {
      flow?.game?.chunks?.onSheetReplaced(file);
    };
  }
  if (g) wireMobileVirtualKeys(g);
}

// ---- M6 拍照模式接线（F4）：Input 直连 + DOM HUD 让位 ----
// 原版相机模式激活时界面层从 Capture Manager Check 截断（Main.cs:45584-93）,
// canvas 侧由 Renderer 集成点承担;DOM 侧快捷栏/选中名/buff 栏（原版 Hotbar/
// MouseText/Resource-Buffs 层,均在截断层之后,Main.cs:44244 层序 + :42608 buff
// 跳过）需随激活隐藏——否则快捷栏 fixed@top:0 遮挡相机按钮组且吞点击。
// .sw-camera-hide 用 !important 压过 UI 内联 display（refreshBuffs 每秒重写）
let cameraModeWired = false;
function initCameraModeWiring(game: Game): boolean {
  const cm = game.renderer.captureMode;
  if (!cm.input) cm.input = game.input;   // mouseHeld/rightDown 电平面（render 无右键）
  if (cameraModeWired) return true;
  cameraModeWired = true;
  const style = document.createElement('style');
  style.textContent = '.sw-camera-hide { display: none !important; }';
  document.head.appendChild(style);
  cm.onActiveChange = (active) => {
    const u = ui as unknown as { hotbarEl?: HTMLElement; hotbarNameEl?: HTMLElement; buffBar?: HTMLElement };
    u.hotbarEl?.classList.toggle('sw-camera-hide', active);
    u.hotbarNameEl?.classList.toggle('sw-camera-hide', active);
    u.buffBar?.classList.toggle('sw-camera-hide', active);
    // ★信息栏 DOM 化(2026-09-19):DOM 信息列(?infodom=1 旗开才存在)同链隐藏——
    //  相机模式激活帧 Renderer 在信息列步之前 return,DOM 元素不会自然收起
    game.renderer.infoAccDom?.el.classList.toggle('sw-camera-hide', active);
  };
  return true;
}

// ---- 键盘：背包/暂停/保存 ----
/** 暂停/设置浮层（原版 IngameOptions 等价面）开启：game.paused = true（CanPauseGame
 *  Main.cs:17493 的 ingameOptionsWindow 臂,事件驱动同效——autoPause 臂逐帧重算另见
 *  Game.applyAutoPauseUI,两者是原文析取式 :17496/:17500 的两支）。SW-BN3 2026-09-07
 *  起 Esc 链对齐原版（Player.cs:5026 背包开着 Esc=关背包）,浮层入口=背包内设置钮
 *  （DrawInterface_29_SettingsButton Main.cs:46287-46301）+ 触屏暂停钮 + 死亡态链支。
 *  ★SW-RB8c 2026-09-08 勘误（IngameOptions.cs:66-92 原文）：Open() 首段
 *  `Main.playerInventory = false`（:70）——开浮层【收背包】（BN3「Open 不清背包/
 *  浮层叠于背包」系误读:原版设置窗与背包两态互斥）;收浮层=Close() 置
 *  playerInventory=true（:108）回背包,见 closeInGamePause。 */
function openInGamePause(game: Game): void {
  // ★SW-RB8c：Open 面=收背包（IngameOptions.cs:70;死亡态背包本关=no-op 同相）
  // + autoPause 属主移交（背包臂 :17500 退出→浮层臂 :17496 接管,防旧属主恢复
  // 在浮层期误解暂停）
  game.releaseAutoPauseOwnership();
  if (ui.inventoryOpen) ui.closeInventory();
  game.paused = true;
  pauseSavedBlocking = game.input.uiBlocking;   // ★A9(2026-10-14):沿保存(close 还原非覆写)
  pausePanel = ui.showPause({
    onResume: () => {
      closeInGamePause(game);   // ★SW-RB8c：Close 面=收浮层+回背包（:108）
    },
    onSave: () => flow?.doSave(),
    // onExport(json 档)2026-09-06 用户定案:退出正式 UI,保留 __swFlow.doExportSave()
    // 调试通道(Shift+F5/控制台);世界备份走世界列表的 .wld 导出
    onSettings: () => flow?.openSettings(true),
    // ★模组设置(2026-10-13 用户令):有已装载(启用) mod 才显示;双栏面板叠开于
    //   暂停菜单之上(不摘 pausePanel=关闭回暂停菜单),世界保持暂停
    ...((getModLoadResult()?.loaded.length ?? 0) > 0
      ? { onMods: () => openModSettingsPanel(game) }
      : {}),
    // ★2026-09-14 反馈轮8:暂停菜单摘 住房(原版 EquipPage=1 页签已覆盖)/图鉴(背包
    // 2×2 钮已覆盖);天气/时间/道具搜索收入"开发者选项"子视图(showPause 侧)
    // ★刀 5 停车坪:道具搜索/天气/时间/玩家列表/旅程/研究同迁(vanilla 门控;
    // ★SW-FX39 2026-09-11 起该门=常态路径——vanilla 已是缺省布局,classic 仅存
    // ?invlayout=legacy 回退旗)
    ...(options.data.inventoryLayout === 'vanilla' ? (() => {
      const isJourney = game.player.appearance?.difficulty === 3;
      return {
        onItemSearch: () => { pausePanel = null; game!.paused = false; ui.openItemSearch(); },
        onWeather: () => { pausePanel = null; game!.paused = false; showJourneyQuickGate('weather', () => { game.renderer.weatherPanelOpen = !game.renderer.weatherPanelOpen; }); },
        onTime: () => { pausePanel = null; game!.paused = false; showJourneyQuickGate('time', () => { game.renderer.timePanelOpen = !game.renderer.timePanelOpen; }); },
        ...(game.net?.active ? { onPlayerList: () => { pausePanel = null; game!.paused = false; openPlayerListPanel(game); } } : {}),
        ...(isJourney ? {
          onJourney: () => { pausePanel = null; game!.paused = false; openJourneyPowersPanel(game); },
          onResearch: () => { pausePanel = null; game!.paused = false; openResearchPanel(game); },
        } : {}),
      };
    })() : {}),
    onQuit: () => {
      pausePanel = null;
      game!.paused = false;
      inGame = false;
      flow?.quitToMenu();
    },
  });
}

/** ★SW-RB8c 2026-09-08：浮层收起统一出口（链 closePause 支/onPauseMenu Close 臂/
 *  浮层 Resume 钮三面共用）——原版 IngameOptions.Close()（:99-110,setKey==-1 门）
 *  置 `Main.playerInventory = true`（:108）＝关设置【必回背包】;BN3「Close 不清
 *  playerInventory/只收浮层不动背包」系误读（Open/Close 两端都写 playerInventory:
 *  Open 收 :70/Close 开 :108,两态互斥）。死亡态豁免重开（RB6b:死亡期本仓逐 tick
 *  强收背包,重开=1t 闪窗伪响应;原版死亡态 Close 同置 playerInventory=true 但随即
 *  被死亡 UI 收支,本仓取稳态面,登记）。面板切换出口（onHousing/onItemSearch 等件
 *  停车坪）不经此——SW 自有面板面,原版无对应物。 */
function closeInGamePause(g: Game): void {
  pausePanel?.remove();
  pausePanel = null;
  g.paused = false;
  g.input.uiBlocking = pauseSavedBlocking;   // ★A9:还原非覆写(旧=无条件 false 抹 mod claim)
  if (!g.player.dead) ui.openInventory(true);   // IngameOptions.Close :108（alive 面）
}

/** Inventory/Esc 优先级态机执行器（SW-BN2 2026-09-07：决策核提取到 ui/escapeChain
 *  的 resolveEscapeChain 纯函数——支序/原版锚/用户令分歧全锚在该文件头注,此处只
 *  做状态现采 + 动作落盘。物理键盘/虚拟沿共用此唯一实现,重绑即时跟随绑定表）。
 *  intent 触发源形态（EscapeIntent）：'escape'=物理 Esc 键; 'inventory'=其余
 *  Inventory 绑定键与触屏背包钮; 'pause'=触屏暂停小钮。 */
function runInventoryEscapeChain(game: Game, intent: 'escape' | 'inventory' | 'pause'): void {
  const act = resolveEscapeChain({
    summonOpen: !!game.summonPanel?.open,
    fullMapOpen: game.renderer.fullMap.open,
    // ★RB28-F3：设置面板叠开于暂停浮层（暂停菜单→设置）=IngameOptions 子页面——
    // 链让位 noop,Esc 只走设置面板自身 window handler=关设置回暂停菜单
    settingsOpen: !!document.querySelector('.sw-set-panel'),
    pauseOpen: pausePanel != null,
    npcDialogActive: game.npcDialogActive,
    signDialogActive: ui.signDialogActive,
    // 模态面板（图鉴/研究/成就/旅程/表情/手册等）开着：链让位（原版 inFancyUI 支
    // Player.cs:4987-4989——各面板自带 Esc 关闭监听,此沿不落背包/暂停）
    uiBlocking: game.input.uiBlocking,
    // SW-RB6b 2026-09-07：死亡/幽灵态 → 暂停浮层开关切换（TryOpeningInGameOptions
    // BasedOnInput :17391-17410,UpdateDead :17187 调用——原版此态 Inventory 沿不落
    // ToggleInv,永不开关背包）
    dead: game.player.dead,
    inventoryOpen: ui.inventoryOpen,
    // ★刀1:vui mod 面板开着(Esc 关最上层,不落背包/暂停)
    modPanelsOpen: modUiPanelsOpen(),
  }, intent);
  switch (act) {
    case 'closeSummon':
      game.summonPanel!.close();
      game.input.uiBlocking = false;
      break;
    case 'closeModPanels':
      modUiCloseTop();
      break;
    case 'closeFullMap':
      game.renderer.fullMap.open = false;
      break;
    case 'closePause':
      // 原版 ingameOptionsWindow 支（Player.cs:4978-4986 IngameOptions.Close）：
      // ★SW-RB8c 2026-09-08 勘误：Close() 置 playerInventory=true（IngameOptions.cs
      // :108）＝收浮层+回背包（BN3「只收浮层不动背包」误读已撤;autoPause 开时回包
      // 背包即被 :17500 臂续暂停=原文 :17496→:17500 臂交接同相;链序 pauseOpen 在
      // inventoryOpen 之前,无"Esc↔暂停"死循环）
      closeInGamePause(game);
      break;
    case 'closeNpcDialog':
      // Player.cs:5000-5013 talkNPC 支：先关对话（Shop 级联关,closeNpcDialog
      // →npcShopClose）——★SW-RB8c 2026-09-08 补 :5012 `Main.playerInventory =
      // false` 半边：原版本支【无条件】清 playerInventory（对话开着 Esc=对话+背包
      // 同收）,旧实现只关对话=背包开着对话态 Esc 背包残留。不落暂停。
      // NpcDialog 自身 Esc 捕获监听已拦截物理键,此分支承接虚拟沿（触屏暂停钮/
      // 重绑键）与 dialogNpc 残余态
      game.closeNpcDialog();
      if (ui.inventoryOpen) ui.closeInventory();
      break;
    case 'closeSign':
      ui.closeSignDialog();   // Player.cs:5014-5016 sign 支
      break;
    case 'noop':
      break;                  // uiBlocking 模态让位（escapeChain.ts 头注）
    case 'openPause':
      openInGamePause(game);
      break;
    case 'closeInventory':
      ui.closeInventory();
      break;
    case 'openInventory':
      ui.openInventory();     // Player.cs:5023-5025 OpenInventory
      break;
  }
}

window.addEventListener('keydown', (e) => {
  const game = flow?.game;
  if (!inGame || !game) return;
  // 输入框内打字不算操作键位（合成搜索框等）：除 Escape 外全部放行给输入框
  const tgt = e.target as HTMLElement | null;
  const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
  if (typing && e.code !== 'Escape') return;
  // ---- Inventory 动作（SW-BN2 2026-09-07 键位表对齐原版：Inventory=Escape
  //      （PlayerInput.cs:2074）,Grapple=E（:2075）——判定在 code 无关处,重绑后
  //      跟随。Esc=开背包,二段=关背包,开关循环（SW-BN3 2026-09-07 对齐原版
  //      ToggleInv :5026,BN2 的「Esc=暂停浮层」用户令分歧已撤销;链细节见
  //      ui/escapeChain.ts 头注）;其余绑定键=背包 toggle）----
  if (isBound('Inventory', e.code)) {
    e.preventDefault();
    // SW-RB6b 2026-09-07：OS 自动重复沿不重触发链（原版 JustPressed.Inventory=
    // 按下沿一发,PlayerInput.cs Triggers.JustPressed 边沿语义;Input.ts keydown
    // 派发已滤 e.repeat,本监听器独立注册须自滤）。
    if (!e.repeat) runInventoryEscapeChain(game, e.code === 'Escape' ? 'escape' : 'inventory');
    return;
  }
  // MapFull（M）等其余键位动作在 Game 的 keydownHandlers 统一派发（M5）——
  // 此处不再重复（曾双派发=开+关抵消）
  // ---- M6 拍照模式（F4，PlayerInput.cs:1926 默认）：CaptureInterface.Update
  //      :982-987 边沿门（死亡/幽灵不可开,再按可关;截图锁定中由
  //      toggleCamera 内 CameraLock 门自拒）。input 直连 = 相机界面需要
  //      mouseHeld/rightDown 电平（render 参数无右键面）;首次按下时绑一次。
  //      ★Shift+F4 = 迷雾消除/恢复切换（下方 case 'F4',首用确认门）,不触发相机模式
  // ★SW-FX16 2026-09-10：Shift 豁免从「全键」收窄到「Shift 组合调试键保留集」
  //  （F1-F5/F10——各键的 Shift 组合臂:Shift+F1/F2 像素画·无敌(Game.ts)、F3 碰撞盒/
  //  F4 迷雾/F5 录制/F10 地图传送）。原版 ToggleCameraMode 触发器无 Shift 概念
  //  （Player.cs 相机模式支直读 trigger）,旧全键豁免让「重绑相机键到非调试键 +
  //  按住 Shift」整类死键。保留集内键保持调试优先(缺省 F4 ∈ 集,缺省行为零变)。----
  if (isBound('ToggleCameraMode', e.code)
    && (!e.shiftKey || !SHIFT_DEBUG_RESERVED.has(e.code)) && initCameraModeWiring(game)) {
    e.preventDefault();
    game.renderer.captureMode.toggleRequest(game.player, game.world);
    return;
  }
  // ---- Shift 组合键（2026-08-28 用户澄清终态）：各键保留各自原功能,仅首次使用
  //  时弹同款确认门（featureGate 按功能分键持久）;★Shift+F10 = 地图点击传送开关,
  //  ★Shift+F2 = 无限生命和魔力（Game.toggleDebugGod）——均不互相顶替 ----
  switch (e.code) {
    case 'KeyS':
      // Ctrl+S 快速存档（原 F6 让位召唤面板后迁入）
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        flow?.doSave();
      }
      break;
    case 'F3':
      // 调试碰撞盒面板迁 Shift+F3（2026-08-20：裸 F3 让位原版 Loadout3 配装热键
      // （PlayerInput.cs:1925），Game 键位派发接管；grep scripts/_*.mjs 零 F3
      // 键引用，无探针破坏）
      if (e.shiftKey) {
        e.preventDefault();
        game.renderer.debugMode = !game.renderer.debugMode;
        ui.toast(game.renderer.debugMode ? '调试面板已开启（碰撞盒高亮）' : '调试面板已关闭');
      }
      break;
    case 'F4':
      // ★SW-BJ15 2026-09-07：Shift+F4 = 全图迷雾消除/恢复（切换式：再按恢复到
      // 消除前的探索快照——World.toggleFullReveal 深拷贝位图快照+版本 bump 整幅
      // 重建；首用确认门;非 Shift F4 = 相机模式（更早分支已 return））
      if (e.shiftKey) {
        e.preventDefault();
        showFeatureGate('fog', '全图迷雾消除（再按可恢复）', () => {
          const revealed = game.world.toggleFullReveal();
          ui.toast(revealed ? '已消除全图迷雾（再按 Shift+F4 恢复）' : '已恢复迷雾快照');
        });
      }
      break;
    case 'F5': {
      // 长按 F5 = 行为录制窗开关（★BJ706-C：按住满 F5_LONGPRESS_MS 当场触发——
      //   旧「keyup 结算」形态玩家不知道要按多久/何时松，长按意图到达即动作，
      //   松手无动作;短按（阈值内松开）仍是一键调试报告）。
      // 短按仍是一键调试报告（报告尾部带 behaviorTail 最近 2000 条事件）。
      // Shift+F5 = 方块标注模式：点击画面直接标记问题格（红圈+序号），再按关闭；
      // 标注会随 F5 报告 tiles.marks 自动带出（含格明细+邻域链）。
      // e.repeat 过滤：长按系统重发 keydown 不重置计时锚
      e.preventDefault();
      if (e.repeat) break;
      if (e.shiftKey) { toggleAnnotate(); break; }  // 不设 f5DownAt → 无定时器,keyup no-op
      f5DownAt = performance.now();
      // 阈值到达即触发（keyup 侧只兜后台标签 setTimeout 节流滞后的情况）
      clearTimeout(f5LongpressTimer);
      f5LongpressTimer = setTimeout(() => {
        if (!f5DownAt) return;        // 已被 keyup 短按结算/blur 取消
        f5DownAt = 0;                 // 消费：后续 keyup no-op（长按已当场动作）
        triggerF5Longpress();
      }, F5_LONGPRESS_MS);
      break;
    }
    case 'F6':
      e.preventDefault();
      // 召唤面板(调试,原版无;原 F6 快速存档挪 Ctrl+S)——首用确认门
      showFeatureGate('summon', '召唤面板', () => game.toggleSummonPanel());
      break;
    case 'F7':
      e.preventDefault();
      // 导线显示——首用确认门（2026-08-28 用户澄清:各键保原功能+确认门）
      showFeatureGate('wires', '导线显示', () => {
        game.forceShowWires = !game.forceShowWires;
        ui.toast(game.forceShowWires ? '导线显示:强制开启' : '导线显示:手持电路工具时');
      });
      break;
    case 'F8':
      e.preventDefault();
      // 怪物生成开关——首用确认门
      showFeatureGate('spawn', '怪物生成开关', () => {
        game.enemySpawnEnabled = !game.enemySpawnEnabled;
        ui.toast(game.enemySpawnEnabled ? '怪物生成已开启' : '怪物生成已关闭（已有怪物不受影响）');
      });
      break;
    case 'F9':
      e.preventDefault();
      // 全画面照亮——首用确认门
      showFeatureGate('bright', '全画面照亮', () => {
        game.renderer.fullbright = !game.renderer.fullbright;
        ui.toast(game.renderer.fullbright ? '已开灯：全画面无暗影' : '已关灯：恢复正常光照');
      });
      break;
    case 'F10':
      e.preventDefault();
      if (e.shiftKey) {
        // ★Shift+F10 = 地图点击传送开关（2026-08-28 用户澄清终态：仅此键承担）——
        //   首用确认门,确认后开合；非 Shift F10 = 鼠标位置传送（保留）
        showFeatureGate('maptp', '地图点击传送', () => {
          game.mapClickTeleportEnabled = !game.mapClickTeleportEnabled;
          ui.toast(game.mapClickTeleportEnabled
            ? '地图点击传送已启用：全屏地图点击选点，再点同一点传送'
            : '地图点击传送已禁用');
        });
      } else {
        // 非组合 F10（鼠标位置传送）已禁用（2026-08-28 用户要求）——原版也无此键
      }
      break;
  }
});

// ---- M6 拍照模式滚轮门（★SW-FX50 锚修正:1457 分支序=Player.cs:25385-25396
//      `if (Main.mapFullscreen) 缩放 else if (CaptureManager.Instance.Active)
//      Scrolling() else if (!flag7) 背包/热栏`;旧注 :24903-24907 系旧基准行号）:
//      相机模式激活且非全屏地图时,滚轮 = 切换相机模式（CaptureInterface.Scrolling）
//      而非视野缩放。capture 相位拦截：Game 的滚轮消费点在 update 段（先于渲染执行）,
//      渲染端回写清零已晚一帧;地图开着时放行——滚轮归地图缩放（原版分支序）。
//      ★SW-FX50（FX38 剩债1）：pendingWheel ±120/notch = 原版 ScrollWheelDelta 计数
//      语义（上滚为正,PlayerInput.cs:901-902）——旧 +sign(deltaY) 与原版符号相反,
//      经 scrolling()（CaptureInterface.cs:1523 无补偿臂）本不可观测（±2 环绕+ %30
//      归一 ⇒ 终模式只随 notch 奇偶）,仍对齐原版约定防未来量值型消费面踩雷。----
window.addEventListener('wheel', (e) => {
  const g = flow?.game;
  const cm = g?.renderer.captureMode;
  if (!g || !cm?.active) return;
  if (g.renderer.fullMap.open) return;
  cm.pendingWheel += browserWheelDeltaYToVanilla(e.deltaY);
  e.stopPropagation();
}, { capture: true, passive: true });

// ---- F5 长按/短按结算（★BJ706-C：长按=按住满阈值当场触发;keyup 只剩短按结算
//      + 后台标签 setTimeout 节流兜底）----
let f5DownAt = 0;
/** 挂起的长按定时器（keydown 起、keyup/blur 清）——防 blur 期意外触发 */
let f5LongpressTimer = 0 as unknown as ReturnType<typeof setTimeout>;
/** 长按阈值 ms：≥ 此值视为长按（行为录制窗开关），否则短按（调试报告） */
const F5_LONGPRESS_MS = 500;
// 长按手势中途失焦=手势打断,取消挂起定时器（防后台期阈值到达意外开关录制）
window.addEventListener('blur', () => {
  clearTimeout(f5LongpressTimer);
  f5DownAt = 0;
});
/** F5 长按动作：录制窗开关。开=清窗起录;关=导出开窗以来全部事件并下载 */
const triggerF5Longpress = (): void => {
  const game = flow?.game;
  if (!inGame || !flow || !game) return;   // ★SW-BJ5：+!flow 收窄（cumulativePlayMs 直读）
  const rec = game.recorder;
  const recording = rec.toggle();
  game.audioRec?.toggle();   // 音效/BGM 双通道窗同步开合（与主行为窗同 tick 边界）
  if (recording) {
    tileFrameCapture.start();   // 录制窗同步开：快照环/截图环/重烘账本全量
    ui.toast('行为录制中…再长按 F5 结束并保存（含动画帧捕获+音效序列）');
    return;
  }
  const dump = rec.export();
  // 帧捕获全量并入录制 dump（聚合+异常环+快照+截图+重烘账本）
  (dump as unknown as { tileFrames?: unknown }).tileFrames = tileFrameCapture.exportAndStop();
  // 音效录制两通道并入 dump.audio（sfx/bgm 各自 meta+events,见 debug/AudioRecorder）
  const audioDump = game.audioRec?.export() ?? null;
  if (audioDump) (dump as unknown as { tileFrames?: unknown; audio?: AudioRecExport }).audio = audioDump;
  const worldName = dump.meta.worldName.replace(/\s+/g, '_') || 'world';
  const filename = `behavior-log-${worldName}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  let triggered = false;
  try {
    downloadText(filename, JSON.stringify(dump));
    triggered = true;
  } catch { triggered = false; }
  const tr = dump.meta.truncated ? `（风暴淘汰截断，起点已不可达）` : '';
  const au = audioDump ? `；音频 sfx ${audioDump.sfx.meta.eventCount}/bgm ${audioDump.bgm.meta.eventCount}` : '';
  ui.toast(triggered
    ? `行为录制已保存：${filename}（${dump.meta.eventCount} 事件${au}）${tr}`
    : `行为录制 ${dump.meta.eventCount} 事件${au}${tr}（下载被拦截，可从 __swRec.export() 取）`);
};
window.addEventListener('keyup', (e) => {
  const game = flow?.game;
  if (!inGame || !flow || !game || e.code !== 'F5' || !f5DownAt) return;   // ★SW-BJ5：+!flow 收窄；f5DownAt=0=长按已被定时器当场消费
  clearTimeout(f5LongpressTimer);   // 阈值内松开：撤长按定时器
  const held = performance.now() - f5DownAt;
  f5DownAt = 0;
  if (held < F5_LONGPRESS_MS) {
    // 短按：一键调试报告（机器优先 JSON）——尾部带 behaviorTail（常开环形最近
    // 2000 条：出问题后再按 F5 也能拿到事发前的输入/方块/生死序列）
    // + audioTail（音效/BGM 播放序列,sfx 800 / bgm 200 条——错误音效排查时间线）
    const r = downloadDebugReport(game, {
      // SW-BJ5 2026-09-07：累计口径（与世界列表/存档头同义）——旧值=会话净时长,两口径混写曾致排查误判"疑似单会话值"
      playTimeMs: flow.cumulativePlayMs,
      behaviorTail: game.recorder.snapshotTail(2000),
      audioTail: game.audioRec?.tail(800, 200) ?? null,
      tileFrames: tileFrameCapture.exportLight(),
    });
    ui.toast(r.triggered ? `调试报告已生成：${r.filename}` : '调试报告已生成（浏览器拦截下载，可从 __swDebugReport 取）');
    return;
  }
  // 长按节流兜底：后台标签 setTimeout 被浏览器节流滞后,keyup 先到且 held 已过阈值
  // → 当场结算长按（前台常态不达此——定时器已在阈值拍触发并清 f5DownAt）
  triggerF5Longpress();
});

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- 方块标注模式（Shift+F5）：标记问题方块，导出标注 + 地图给开发者 ----
function toggleAnnotate() {
  const game = flow?.game;
  if (!game) return;
  game.annotateMode = !game.annotateMode;
  if (game.annotateMode) {
    ui.showAnnotatePanel({
      onExportMarks: exportMarks,
      onExportMap: exportMap,
      onClear: () => {
        if (!flow?.game) return;
        flow.game.marks = [];
        ui.updateAnnotateCount(0);
      },
      onClose: () => toggleAnnotate(),
      onToggleFix: () => {
        if (!flow?.game) return;
        flow.game.fixTexMode = !flow.game.fixTexMode;
        ui.setFixModeLabel(flow?.game.fixTexMode);
        ui.toast(flow?.game.fixTexMode ? '贴图纠错模式：点击方块打开其贴图表' : '已关闭贴图纠错模式');
      },
      onExportFixes: exportTexFixes,
    });
    ui.updateAnnotateCount(game.marks.length);
    ui.toast('标注模式已开启：点击方块标记问题格（红圈+序号），按 F5 出报告自动携带标注；Shift+F5 关闭');
  } else {
    ui.closeAnnotatePanel();
    ui.toast(game.marks.length ? `标注模式已关闭（${game.marks.length} 个标注保留，F5 报告仍会带出）` : '标注模式已关闭');
  }
}

function exportMarks() {
  const game = flow?.game;
  if (!game) return;
  const g = game;
  const st = g.world.store;
  const marks = g.marks.map((m, i) => {
    const idx = st.idx(m.x, m.y);
    const t = st.type[idx];
    const def = TILE_DEFS[t];
    const nb: Record<string, { key: string | null; fx: number; fy: number } | null> = {};
    const dirs: Array<[string, number, number]> = [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0],
      ['nw', -1, -1], ['ne', 1, -1], ['sw', -1, 1], ['se', 1, 1]];
    for (const [tag, dx, dy] of dirs) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!st.inBounds(nx, ny)) { nb[tag] = null; continue; }
      const ni = st.idx(nx, ny);
      const nt = st.type[ni];
      nb[tag] = nt === 0 ? null : { key: TILE_DEFS[nt]?.key ?? String(nt), fx: st.frameX[ni], fy: st.frameY[ni] };
    }
    let sheetInfo: { sheet: number; name: string; png: string; oob: boolean } | null = null;
    const sheetId = def?.vanilla?.sheet;
    if (sheetId !== undefined && g.renderer.atlas) {
      const meta = g.renderer.atlas.vmeta(sheetId);
      const img = meta ? g.renderer.atlas.vimages.get(meta.sheet) : null;
      if (meta && img) {
        const oob = def!.vanilla!.frame === 'style'
          && (st.frameX[idx] + meta.grid[0] > img.width || st.frameY[idx] + meta.grid[1] > img.height);
        sheetInfo = { sheet: sheetId, name: meta.name, png: `${img.width}×${img.height}`, oob };
      }
    }
    return {
      no: i + 1, x: m.x, y: m.y,
      typeId: t, typeKey: def?.key ?? null, typeName: def?.name ?? null,
      frameX: st.frameX[idx], frameY: st.frameY[idx],
      wall: st.wall[idx],
      liquid: st.liquid[idx], liquidType: st.liquidType[idx],
      wallName: WALL_DEFS[st.wall[idx]]?.name ?? null,
      neighbors: nb, sheetInfo,
    };
  });
  const out = {
    worldName: g.world.name, size: [g.world.w, g.world.h],
    player: { x: Math.floor(g.player.x / 16), y: Math.floor(g.player.y / 16) },
    exportedAt: new Date().toISOString(),
    marks,
  };
  downloadText(`marks-${g.world.name.replace(/\s+/g, '_')}.json`, JSON.stringify(out, null, 2));
  ui.toast(`已导出 ${marks.length} 处标注`);
}

function exportMap() {
  const game = flow?.game;
  if (!game) return;
  const json = saveGameCompat(game);
  downloadText(`map-${game.world.name.replace(/\s+/g, '_')}.json`, json);
  ui.toast('已导出地图存档');
}

function exportTexFixes() {
  const game = flow?.game;
  if (!game) return;
  const fixes = ui.texFixes;
  if (!fixes.length) { ui.toast('还没有记录任何贴图纠错'); return; }
  const out = {
    worldName: game.world.name, size: [game.world.w, game.world.h],
    exportedAt: new Date().toISOString(),
    note: '每条 = 地图坐标处应使用的正确帧偏移（对应 Tiles_N 表的像素偏移）',
    fixes,
  };
  downloadText(`texfix-${game.world.name.replace(/\s+/g, '_')}.json`, JSON.stringify(out, null, 2));
  ui.toast(`已导出 ${fixes.length} 处贴图纠错`);
}

function saveGameCompat(g: Game): string {
  // SW-BJ5 2026-09-07：导出地图档同累计口径（旧值=会话净时长,与槽位/quick 档不一致）；
  // 调用面 exportMap 已有 game 非空门（⇒flow 在场）,此处 `?.` 仅为类型收窄兜 0
  return saveGame(g.world, g.player, flow?.cumulativePlayMs ?? 0, g.townNpcsForSave(), g.eventsForSave(), g.pillarNpcsForSave(), g.pressurePlatesForSave());
}

// 暴露 tile/key 常量给调试控制台
void TILE_BY_KEY; void T; void ITEM_BY_KEY;

// 观察进游戏事件（mainFlow 的 enterGame 发生在 Game 回调里，这里轮询 __swGame 变化）
let lastGameRef: Game | null = null;
setInterval(() => {
  const g = (window as unknown as { __swGame?: Game }).__swGame ?? null;
  if (g && g !== lastGameRef) {
    lastGameRef = g;
    inGame = true;
    enterGameHooks();
  } else if (!g && lastGameRef) {
    lastGameRef = null;
    inGame = false;
  }
}, 250);

// ---- 启动 ----
// ★R13-F2：kvHas 预查拒绝（LS 抛残余/IDB open 链拒绝——原语层已垫 LS,此处兜链上
//  残余）≠不 boot——旧实现无 catch,拒绝=then 不执行=启动链整体不跑=黑屏死路。降级
//  按「无快存档」续走（本 then 不消费返回值,快存档存在性另有 mainFlow 同款预查）。
kvHas('sandboxworld.quicksave').catch((e) => {
  console.warn('[boot] quicksave 存在性预查失败（降级续走 boot）', e);
  return false;
}).then(async () => {
  // ① 音频开启拦截（所有流程前置，2026-08-24 用户要求）：AC 被自动播放策略
  //    挂起 → 纯黑幕+白色耳机图标+两行提示，点击/按键任意位置恢复音频放行；
  //    未拦截（AC running）或调试旁路/探针（navigator.webdriver）直通
  // ② splash（原时序不变）：RE-LOGIC 字样烘在每组 Splash_N_2 前景层（透明底
  //    PNG，透出 back 场景）；vanilla-ui/logo_1..8.png 是死资产不使用。
  //    时序全程 ~10.3s 不快进；资源下载等待 = splashGate 迟解
  // ★BJ627 偏好域预载（module 顶层已起跑,此处 await 兜时序——此后全部同步读
  //    消费面走内存,零闪变;~1-5ms,IDB open+键枚举+命中取值单事务）
  await preloadPrefs();
  // options/语言先行（音频门文案需要 Lang；mainFlow 内 options.load() 幂等）
  await options.load();
  // ★BJ628 l10n 就绪门①（短预算 2.5s）：音频门/资源徽标文案已消费 Lang——弱网
  //  瞬断在此吸收；失败不阻断启动（资产预热期长,②号门在 showTitle 前兜底）
  await Lang.ensureReady(options.data.lang, 2500);
  // ★mod 装载（2026-10-04,docs/mod-loader-design.md §4）：内容注册+id 分配必须在
  //   一切世界/UI 消费之前；贴图注入在 loadAssets 内 atlas 构造后（applyModAssets）。
  //   失败只告警不阻断启动（资源包同款"增强不是必需"哲学；零 mod=零副作用）
  try {
    const { loadModsPhase1, getModLoadResult } = await import('./mods/loader');
    // ★桌面 mods 目录发现(P3):<userData>/mods/*.swmod 经 /mods/index.json 同源
    //   发现→自动安装/版本覆盖/启用(目录=安装真相源;web 版走面板 zip 导入)。
    //   失败静默跳过(目录同步是增强不是必需)
    if ((window as unknown as { sandboxDesktop?: { isShell?: boolean } }).sandboxDesktop?.isShell) {
      try {
        const idx = await fetch('mods/index.json').then((r) => r.json()) as { mods?: string[] };
        const { ModStore } = await import('./mods/store');
        const { readModPack } = await import('./mods/pack');
        const store = new ModStore();
        for (const file of idx.mods ?? []) {
          // ★P4 红蓝修正(D-M2):逐文件 try——单个坏包不中断目录里其余 mod 的同步
          try {
            const buf = await fetch(`mods/${encodeURIComponent(file)}`).then((r) => r.arrayBuffer());
            const bytes = new Uint8Array(buf);
            const pack = readModPack(bytes);
            const rows = await store.listRows();
            const existing = rows.find((r) => r.id === pack.manifest.id);
            if (!existing || existing.version !== pack.manifest.version) {
              // ★2026-10-16 install 语义升级:重装自动保留 existing.enabled(store 内);
              // 首装显式 enabled:true(目录=真相源,自动发现即启用——缺省已改 false)
              await store.install(pack.manifest, bytes, (pack as import("./mods/types").ModPack).iconDataUrl,
                { enabled: true });
            }
            // 同版本已装:不动启停态(用户面板语义权威)
          } catch (err) {
            console.warn(`[mods] 桌面目录文件同步失败(跳过): ${file}`, err);
          }
        }
      } catch (err) {
        console.warn('[mods] 桌面目录同步失败(跳过):', err);
      }
    }
    await loadModsPhase1();
    // ★2026-10-14 用户令:装载错误必上 console(旧=仅模组面板可见,F12 盲——深链
    //  审计案发现 silent 失效无任何线索)。loaded 一行+每错误一行。
    {
      const { getModLoadResult } = await import('./mods/loader');
      const r = getModLoadResult();
      if (r) {
        console.log(`[mods] 装载完成: ${r.loaded.map((m) => m.manifest.id).join(', ') || '(无)'}`);
        for (const e of r.errors) console.warn(`[mods] 装载错误: ${e.modId} ${e.error}`);
      }
    }
    // ★mod 调试句柄（2026-10-04;__swAtlas/__swResourcePacks 同族先例）：
    //   result()=装载结果;install(bytes)=装 .swmod zip 字节(重载生效)。探针用
    ;(window as unknown as { __swMods?: unknown }).__swMods = {
      result: () => getModLoadResult(),
      install: async (bytes: Uint8Array) => {
        const [{ ModStore }, { readModPack }] = await Promise.all([
          import('./mods/store'), import('./mods/pack'),
        ]);
        const pack = readModPack(bytes);
        // ★2026-10-16:首装 enabled:true(探针/自动化路径靠 boot 装载=须启用态;
        //  重装保留既有启停——store.install 语义)
        return new ModStore().install(pack.manifest, bytes, pack.iconDataUrl, { enabled: true });
      },
    };
  } catch (err) {
    console.warn('[mods] 装载失败(已跳过):', err);
  }
  const bootParams0 = new URLSearchParams(location.search);
  const bypassBoot = bootParams0.has('play') || bootParams0.has('quickload') || bootParams0.has('vuidemo');
  if (bypassBoot) removeStaticBoot();   // 旁路无启动幕,回调入口即摘(仅损失数 ms 黑帧差)
  // ★首访资产前置(2026-08-25 用户要求):音频门出现前先把暖缓存跑起来并等标题曲
  //   (Music_50/51,位于 p0 最前,到位即含过渡图族)入缓存——保证点击放行即有声、
  //   过渡时间线有画。dev/?nosw/http 立即跳过;慢网 30s 上限降级放行不卡死。
  //   等待指示=原版 LoadingSunflower 帧动画(UI_Sunflower_Loading.png 52×1007
  //   竖条 19 帧,帧序 :52041-52060 同款 Frame(1,19,0,(帧/3+10)%19),2026-08-25
  //   用户要求替换脉冲点)
  // 懒 worker 预取钩子注入(音频门等待窗口借 SW 回填;见 WorldGenClient/SaveClient 尾注)
  // ★2026-09-28 看门狗治理:light/wave 补齐同款预热——冷模块图取>2s 曾被 warmup
  //  看门狗按墙钟误杀且零重生路径=整会话 40% 主线程墙钟（trace 定谳,见 WorkerGovernance 头注）
  setLazyWorkerPrefetch(() => { prefetchWorldGenWorker(); prefetchSaveWorker(); prefetchLightWaveWorkers(); });
  // ★启动幕生命周期(2026-08-25 用户要求"门后黑屏间隙铺向日葵"):向日葵幕存活至
  //   过渡页三层图挂载(首帧绘出)才交接——覆盖 音频门点击后 → loadAssets → 过渡图
  //   缓存等待 的全部无图窗口,消灭"以为故障黑屏"。z=10000:门(10001)之下、
  //   过渡页(30)之上
  let bootVeil: HTMLElement | null = null;
  if (!bypassBoot) {
    const veil = document.createElement('div');
    veil.id = 'sw-boot-prime';
    veil.innerHTML = `<style>
      #sw-boot-prime { position: fixed; inset: 0; z-index: 10000; background: #000;
        display: flex; align-items: center; justify-content: center; }
    </style><canvas width="52" height="53"></canvas>`;
    document.body.appendChild(veil);
    bootVeil = veil;
    removeStaticBoot();   // 启动幕接管首屏反馈(静态读条使命完成,无缝交接)
    // ★资源指示器提前挂载(2026-08-27 用户要求):从向日葵幕阶段就显示
    //   "资源加载中 · N%"(badge z=10002 浮于本幕 10000 之上),不再等到过渡图
    //   出现才出现——进度覆盖 primeBootAssets 等待窗口。warm 已由
    //   primeBootAssets 内部自启,此处 state 即有字节账可读。
    mountAssetBadge();
    const cv = veil.querySelector('canvas') as HTMLCanvasElement;
    const cctx = cv.getContext('2d')!;
    const sfImg = new Image();
    let sfOk = false;
    sfImg.onload = () => { sfOk = true; };
    sfImg.src = 'sprites/vanilla-ui/UI_Sunflower_Loading.png';   // vanilla-ui 散件常驻,首访即可得
    const sfT0 = performance.now();
    const sfStep = () => {
      if (!veil.isConnected) return;   // 撤除即停
      if (sfOk && sfImg.width > 0) {
        const row = (Math.floor((performance.now() - sfT0) / 50) + 10) % 19;
        cctx.clearRect(0, 0, 52, 53);
        cctx.drawImage(sfImg, 0, row * 53, 52, 53, 0, 0, 52, 53);
      }
      requestAnimationFrame(sfStep);
    };
    requestAnimationFrame(sfStep);
    try { await primeBootAssets(30_000); } catch { /* 降级放行 */ }
    // ★幕不在此撤:继续盖住音频门之后的 loadAssets/过渡图缓存等待间隙
  }
  if (!bypassBoot && shouldShowAudioGate() && (await audio.detectAutoplayBlocked())) {
    await showAudioGate(() => audio.resumeNow());
  }
  // 素材装载与音频门并行（门期间后台预载，点击放行即有图可显）
  const assetsP = loadAssets();
  const splashGate: { resolve: () => void } = { resolve: () => {} };
  const splash = showSplash({
    loading: new Promise<void>((r) => { splashGate.resolve = r; }),
    quick: audio.muted || audio.volume === 0,   // 原版 quickSplash（musicVolume==0）
    canSkip: assetsDownloadIdle,                // 跳过门(2026-08-25):资源下载空闲才允许
  });
  // ★启动幕交接(消灭门后黑屏间隙):轮询至过渡页三层图已挂载(首帧绘出)或过渡页
  //   已收场,才撤向日葵幕。post-prime 缓存必已含过渡图 → 交接在百毫秒级完成
  if (bootVeil) {
    const handoff = setInterval(() => {
      const sp = document.getElementById('sw-splash');
      const back = sp?.querySelector('.back') as HTMLElement | null;
      if ((sp && back && back.style.backgroundImage) || !sp) {
        clearInterval(handoff);
        // ★延迟 500ms 再撤(2026-09-20 用户要求:1000ms 缩半——2026-08-25 原
        //   定 500ms 基础上再延 500 的并存交接,现收紧):向日葵与过渡页并存交接
        setTimeout(() => {
          bootVeil?.remove();
          bootVeil = null;
        }, 500);
      }
    }, 100);
  }
  void audio.play('title');   // ★标题曲随 splash 出现即起（用户要求，非进标题才播；
                              // 音频门/首次手势解锁已保 AC running）
  await assetsP;
  if (atlas) UITextures.setAtlas(atlas);
  // ★BJ628 l10n 就绪门②（全预算,showTitle 前唯一权威闸）：两次 init 全撞弱网瞬断
  //  窗曾放键名直出菜单进主流程（用户实报图 99）；现预算内重试,仍败放行+挂后台
  //  自愈（成功 emit→TitleMenu.renderTexts 等订阅面免刷新自愈）
  await Promise.all([UIFont.load(), Lang.ensureReady(options.data.lang)]);
  VUI.init(root);
  VUI.startLoop(); // 自愈帧循环（HMR 杀不死，看门狗 1s 内重启）
  flow = createFlow(root, atlas, ui, audio);

  // ★自动更新检查(2026-09-07):SW 文档 SWR 的陈旧窗口内页面常驻旧 bundle(用户
  //  此前「要多刷新一两次才是最新」)——探针定期比对部署指纹 build-id.txt,发现
  //  新版本出横幅;点击→静默存档兜底丢进度→reload 一次到位(SWR 已在后台更新缓存)
  // ★BJ144(2026-09-18)：doSave 是异步链,此前同步 location.reload() 把在途保存整段
  //  撕掉(=点更新横幅必丢自上次存档进度)。现先等保存全链落定再 reload;存档失败
  //  也刷新(新版本优先,不因存储故障永久阻塞更新)
  {
    // ★BJ280(2026-09-22)：迁入 flow.saveAndReload()——存档落定后清 beforeunload
    // 拦截态再 reload（否则横幅刷新会被 BJ280 原生确认弹窗二次打断,破坏 BJ144 面）
    const reloadAfterSave = () => (flow ? flow.saveAndReload() : location.reload());
    const banner = mountUpdateBanner(root, reloadAfterSave);
    startUpdateCheck((version) => banner.show(version, reloadAfterSave));
  }

  // M0 验收入口：?vuidemo=1 只跑 VUI 框架演示
  if (bootParams0.has('vuidemo')) {
    splash.done();
    VUI.setState(new VuiDemoState());
    return;
  }

  // 旁路路由：?play[=small|medium|large] 跳过主菜单直接生成世界进游戏
  // （主菜单 UI 改造期间绕行用；也可 ?quickload 直接读快速存档）——调试入口
  // 不陪跑 10.3s 时序，立即收场
  if (bootParams0.has('quickload')) {
    splash.done();
    void flow.quickLoad();
    return;
  }
  if (bootParams0.has('play')) {
    splash.done();
    const sz = bootParams0.get('play') || 'medium';
    const [w, h] = sz === 'small' ? [4200, 1200] : sz === 'large' ? [8400, 2400] : [6400, 1800];
    void flow.newWorld('', w, h);
    return;
  }

  // 菜单在 splash 幕后提前建好（2026-08-24 用户要求）：
  //  ① 版本号/署名角标层(z35) 浮于 splash(z30) 之上——渐显期(1.5s 起)即可见；
  //  ② 渐隐段(num5-num6 起)splash 底转透明——场景淡出直接透出菜单，不渐隐到
  //     黑再跳切揭幕；
  //  ③ 有下载停在 splash 等完（徽标 z40 浮于其上；splashGate 迟解=时序尽转全
  //     暗+向日葵续等，下完才自收场）
  await initAssetCache();
  flow.showTitle(true);        // 菜单+角标文字幕后就位（音乐/预载调用幂等）；★true=
                               // 背景冻结——揭幕前零 tick 零绘制(2026-08-27 用户报:
                               // 过渡图阶段时间空转+加载密集期背后全屏渲染抢算力)
  // ★管线未启用不再静默(2026-09-03 用户要求"SW 没起来弹窗警告+可复制诊断"):
  //   PROD 下 SW 注册失败/激活超时/环境不支持时弹窗(reason/重试/复制诊断/
  //   仍要进入)——prune 发布形态下这种会话 vanilla 全家族贴图必然 404。
  //   调试旗 ?swfail 模拟该链路(dev 亦可触发)。?nosw=显式关闭,不打扰。
  if ((import.meta.env.PROD || bootParams0.has('swfail')) && !bootParams0.has('nosw')) {
    warnAssetPipelineDown();
  }
  warmAllAssets();
  // ★2026-08-27 用户定案:过渡图阶段必须 zip 全量落盘;渐隐(revealBehind)与
  //   "加载完成"门统一等 hold 放行——菜单揭幕时永不缺图。时序尽(10.3s)而
  //   未完成时由 splash 既有路径转全暗+向日葵续等(徽标持续显示进度)。
  //   revealBehind 曾在 hold 前调用:渐隐段把缺图菜单提前透出(用户实测)。
  await holdForAssetsReady({ minMs: 0 });
  flow.resumeMenuBg();         // 揭幕即起播——菜单时间从初始值开始（进主菜单才播动画）
  splash.revealBehind();
  splashGate.resolve();        // 全量完成才解 splash"加载完成"门（时序尽自收场）
  await splash.finished;       // 渐隐到菜单后揭幕
});

// ★BJ724-A 刀2:启动握手信号——index.html 内联看门狗(独立于主包)据此判定
// 「主模块已下载并求值」。置位点=模块执行尾:上面的 kvHas().then 启动链是异步
// 回调不阻塞本行,任何更早的求值失败都会让信号缺席→看门狗 60s 超时出失败提示;
// 模块图任一下载失败另有 script error 自动重试一发(见 index.html #sw-boot-watchdog 注)。
// 幕布消失由游戏自身流程管(静态幕摘除/启动幕交接),本信号只管「主包活着」。
(window as unknown as { __swBooted?: boolean }).__swBooted = true;
