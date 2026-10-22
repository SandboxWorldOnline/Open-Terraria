// 菜单/游戏流程编排（VUI 版）：主菜单 → 世界生成/读取 → 进游戏 → 退出回菜单。
// main.ts 只做启动装配；本模块持有 Game 生命周期与 VUI/背景的 rAF 驱动。
import { maybeInstallGpuLoggerFromUrl } from './render/GLStats';
import { Game, grantStarterKit } from './core/Game';
import { WorldGenAbortedError } from './world/gen/WorldGen';   // ★IIIII229 ① Esc 中止判别
import { peekSaveDims, worldGenTimeoutMs } from './workers/WorldGenClient';   // ★BJ336 件1 读档超时扩面
import { World } from './world/World';   // 空白世界直通道（导演模式 2026-10-16）
import { UI } from './ui/UI';
import { MobileControls, isTouchDevice, tryFullscreenLandscape } from './ui/MobileControls';
import { resolveTouchMode } from './core/input/touchMode';
import { modUiResync } from './mods/ui';   // ★刀1/R-C-F1:mod UI 宿主重同步(stopMenu 清场沿)
import { AudioSystem } from './core/Audio';
import type { SpriteAtlas } from './assets/SpriteAtlas';
import { loadSave, loadSaveData, playerFromDiskForm } from './save/SaveFile';
import { restoreModTEs } from './mods/tileEntities';   // ★TE 梯队:worker 读档主线程回填
import { isOomLoadError, parseSaveMissingReason, saveMissingToastKey, type SaveMissingReason } from './save/LoadErrors';   // ★BJ318 OOM 判别 + ★BJ605 存档数据缺失族判别/文案映射
import { builderAccDefaults } from './stats/builderAcc';   // ★SW-FX19:builderAccStatus 回填缺省形
import { PlayTimeTracker } from './save/PlayTime';
import { saveClient } from './workers/SaveClient';
import { getEnabledModIds } from './mods/bridge';
import { maybeShowWelcomeAnnounce } from './ui/WelcomeAnnounce';
import { keybindHintLabel, isBound, keybindCodeLabel } from './core/Keybinds';   // SW-BN2 2026-09-07
import { TILE_BY_KEY, TILE_DEFS } from './data/tiles';
import { setupLiquidLab as liquidLab } from '../scripts/liquidlab';
import { kvHas, kvSet, kvIdbStatus, lsGetSafe } from './save/KvStore';   // ★BJ605：+kvIdbStatus 读档报错路径 IDB 态诊断（★BJ617 件2：kvGet 读面随 resolveLoadText 三段择源退役）;★R13-F2：+lsGetSafe LS 安全读垫（resolveLoadText lsRead 注入）
import { makeBeforeUnloadHandler, hiddenBackstopShouldSave } from './save/UnloadGuard';   // ★BJ280 页面卸载拦截纯核
import { WBAKE_ENABLED } from './workers/BakeClient';   // ★C4 烘焙 worker 灰度旗（入场覆盖门分支用）
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID } from './data/items';
import { VI_KEY } from './data/itemKeys';
import { parseWldToSave } from './wld/WldImport';
import { Inventory } from './items/Inventory';
import { VUI } from './vui/VUI';
import { warmAllAssets } from './net/AssetCache';
import { gateAssetsOrRun, mountAssetBadge } from './ui/AssetDownloadUI';
import { TitleMenu } from './ui/TitleMenu';
import { MultiplayerSelect } from './ui/MultiplayerSelect';
import { SettingsPanel } from './ui/Settings';
import { BestiaryPanel } from './ui/BestiaryPanel';
import { CharSelectPanel } from './ui/CharSelect';
import { WorldSelectPanel } from './ui/WorldSelect';
import { WorldCreationPanel, applyHalloweenSeasonSeed } from './ui/WorldCreation';
import { CharCreation } from './ui/CharCreation';
import { UIWorldLoadState } from './vui/states/UIWorldLoadState';
import { MenuBackground } from './render/MenuBackground';
import { CharacterStore } from './save/CharacterStore';
import { WorldStore, WorldSaveWriteError, buildSaveBackupFilename, type WorldMeta } from './save/WorldStore';   // ★BJ605：+WorldSaveWriteError 保存时点告警判别 + 备份文件名（用户明令件）
import { requestStoragePersistence, shouldShowPersistNotice, markPersistNoticeShown, evictNoticeFingerprint, shouldShowEvictNotice, markEvictNoticeShown, scanEvictedSaves, refreshStorageStatus } from './save/StoragePersistence';   // ★BJ611 持久存储申请/预警面/驱逐幽灵检测
import { fsBackupSnapshot, fsBackupIndex, restoreFromBackup, fsBackupRestoreEvicted, fsBackupPurgeSnapshots, setFailToastHandler, resolveLoadText, backupTargetOfKey, fsBackupRequestPermission } from './save/FsBackup';   // ★BJ614 File System Access 本地目录自动备份（增强链）+读档自愈恢复链；★BJ617 件2：读档文本三段择源；★BJ618：quicksave 快照/恢复+删除组清理；★BJ655：读档手势链内当场重新授权
import { acquireSessionLock, worldLockKey, charLockKey, type SessionLock } from './save/SessionLock';   // ★BJ617 件1（用户拍板）：多标签页并发防线=Web Locks 会话锁（同世界/同角色已有会话拒载;不支持=降级放行）
import { prefGet, prefLsLike, prefRemove, prefSet } from './save/PrefsStore';   // ★BJ627 偏好域 IDB 单写（LS 零新写）
import { options } from './core/Options';
import { UIScale } from './vui/draw/UIScale';
import { Lang } from './i18n/Lang';
import { UISfx } from './vui/UISfx';
import type { Appearance } from './player/Appearance';
import { ITEM_DEFS } from './data/items';
import { mountCreditsRollOverlay } from './ui/CreditsRollOverlay';   // IIII232 名单演出
import { dollEquipFromInv } from './render/Renderer';   // ★M 刀：PlayerSegment phantom 盔甲三槽（单源）
import { creditsRoll } from './world/CreditsRoll';

const QUICK_SAVE_KEY = 'sandboxworld.quicksave';
/** 脚本兼容垫片：旧 puppeteer 脚本点 select+button 建世界（M7 清理） */
let legacyShim: HTMLElement | null = null;

export interface FlowHandle {
  showTitle(bgPaused?: boolean): void;
  /** 揭幕解冻菜单背景（main.ts splash.revealBehind 时调——配合 showTitle(true)） */
  resumeMenuBg(): void;
  newWorld(seed: string, w: number, h: number): Promise<void>;
  quickLoad(): Promise<void>;
  importWld(buf: Uint8Array): Promise<void>;
  /** ★BJ144（2026-09-18）：转 async——退出等保存全链落定（原版 SaveAndQuit 语义） */
  quitToMenu(): Promise<void>;
  /** ★BJ144：全链（序列化+quicksave+槽位双 IDB）落定才 resolve;true=数据面全成功 */
  doSave(silent?: boolean): Promise<boolean>;
  /** 导出存档为文件(自有 JSON 格式,与 __swFlow.loadJson 闭环) */
  doExportSave(): void;
  /** ★BJ280：更新横幅「保存后刷新」通道——静默存档全链落定→清卸载拦截态→reload
   *  （存档失败也刷新,BJ144 取舍;拦截态无条件解除=用户明示动作不二次弹窗） */
  saveAndReload(): void;
  openSettings(inGame: boolean): void;
  openBestiary(): void;
  /** 住房面板（背包房屋按钮 B 方案,2026-08-15） */
  openHousing?(): void;
  game: Game | null;
  /** 累计游玩时长（存档口径,ms;SW-BJ5 2026-09-07）——存档/F5 报告统一取此值,
   *  取代会话净时长 playStartNow（两口径混写=重复计费/累计清零家族根因） */
  readonly cumulativePlayMs: number;
}

export function createFlow(root: HTMLElement, atlas: SpriteAtlas | null, ui: UI, audio: AudioSystem): FlowHandle {
  let game: Game | null = null;
  let mobile: MobileControls | null = null;
  // 操作模式(touchOpMode 设置页可切)变更 → 即时增删虚拟控件层(auto=默认按设备,
  // touch=强制触屏,keyboard=强制键鼠整页桌面几何)。单订阅(createFlow 一生一次);
  // Input 世界触摸与 HudScale 档位各自读 resolveTouchMode 即席生效
  {
    let lastTouch = resolveTouchMode();
    options.onChange(() => {
      const cur = resolveTouchMode();
      if (cur === lastTouch) return;
      lastTouch = cur;
      if (!game) return;
      mobile?.destroy();
      mobile = cur === 'touch' ? new MobileControls(game, ui.root) : null;
    });
  }
  // ★IIIII232：制作组名单演出 overlay（CreditsRollSky 消费侧）。canPlay =
  // Main.CanPlayCreditsRoll（Main.cs:3223-3232）：!gameMenu && hasCreditsSceneMusicBox
  // （八音盒 5044 Journey's End 生效中 ≙ scene.musicBoxStyle===85，MB_STYLE_TO_MUSIC
  // [85]=89）∪ gameMenu&&menuMode==3000（本仓无名单菜单态,登记债）∪ IsEventOngoing
  mountCreditsRollOverlay(root, {
    canPlay: () => {
      const g = game;
      if (!g) return false;
      return creditsRoll.canPlay(g.scene?.musicBoxStyle === 85, false, 0);
    },
    // ★M 刀 PlayerSegment（Segments.cs:209 CopyVisuals(Main.LocalPlayer)）本仓供给：
    // phantom 皮肤/盔甲 1:1 本地玩家——dollEquipFromInv 单源（displayArmor 时装覆盖
    // + SetMatch 三查同链）。菜单态无本地玩家 → null（演出段窗内不画）
    playerVisual: () => {
      const g = game;
      if (!g || !g.player.appearance) return null;
      return {
        appearance: g.player.appearance,
        equip: dollEquipFromInv(g.player.inv, g.player.appearance),
      };
    },
  });
  // GOING_OLDSCHOOL B1 收口：菜单级成就句柄（标题屏日月拖拽首访即达——
  // 曾只挂 Game.achOnWorldEnter，直载标题屏拿不到句柄）。
  // ★SW-FX18 2026-09-10：句柄 Promise 化——标题菜单"成就"钮（Main.cs:49733
  // menuMode 0 第三钮 Lang.menu[131] → AchievementsMenu 的本仓等价）点击时
  // await 此桥,实例未就绪（动态 import 在途）也不丢点击
  const menuAchievementsReady: Promise<import('./core/Achievements').Achievements> = (async () => {
    const w = window as unknown as { __swAchievements?: unknown };
    if (w.__swAchievements) return w.__swAchievements as import('./core/Achievements').Achievements;
    const { Achievements } = await import('./core/Achievements');
    // ★BJ627：持久面迁 PrefsStore（IDB 单写+内存缓存;同步读接口零改——预载后内存权威）
    const inst = new Achievements(
      { load: () => prefGet('sbw.achievements.v1'), save: (x: string) => prefSet('sbw.achievements.v1', x) },
    );
    w.__swAchievements = inst;
    return inst;
  })();
  /** 成就页开面（标题菜单/设置面板两入口共用——原版双入口喂同一
   *  Main.AchievementsMenu,Main.cs:112 全局态；本仓同面板双宿主）。
   *  ★R-A-F5(2026-10-14):每开面重读 store——旧=menuAchievementsReady 单例
   *  Promise 恒回首次实例,Game 进世界解锁(落盘共享)后回标题再开=本局解锁不可见。
   *  新实例构造零成本(纯 localStorage/IDB 读+defs 快照),mod defs 经
   *  registerModAchievementDefs 模块表在册=ctor 自动并入。 */
  function openMenuAchievements(): void {
    void menuAchievementsReady.then(async () => {
      const { Achievements } = await import('./core/Achievements');
      const ach = new Achievements(
        { load: () => prefGet('sbw.achievements.v1'), save: (x: string) => prefSet('sbw.achievements.v1', x) },
      );
      (window as unknown as { __swAchievements?: unknown }).__swAchievements = ach;
      const m = await import('./ui/AchievementsUI');
      m.openAchievementsPanel({ achievements: ach });
    });
  }
  (window as unknown as { __swAudio?: AudioSystem }).__swAudio = audio; // 探针调试桥
  // #perf-gpulog:gpulog 安装提前到启动装配——菜单期(Game 未构造)也可观测
  // menubg 账本(三开压测:菜单页 GL 崩溃此前无任何观测面)。Game 处重复调用幂等
  maybeInstallGpuLoggerFromUrl();
  // SW-BJ5 2026-09-07：累计游玩时长 = PlayTimeTracker（原版 PlayerFileData._playTime
  // + _timer 语义,见 save/PlayTime.ts 头注）。基线只在会话边界钉死（enterGame 时取
  // 槽位 meta 上次存档终值）+ 读档吸合（存档头优先）+ 失焦折算;存档只读 totalMs(),
  // 对槽位 meta.playTimeMs 的回写【绝不回流进基线】——旧实现 base 每存一次被写回
  // "基线+整段会话已过时长"而下存再整段叠加（自动保存 10min 一发）→ 二次方膨胀,
  // 长挂机会话即世界列表"游玩 109843 分钟"(≈76 天)实报根因。
  const play = new PlayTimeTracker();
  /** 累计游玩时长（vanilla .plr timePlayed 语义 = 全生涯累计）。2026-09-01 审计修过
   *  "会话净时长每局清零",本次（SW-BJ5）修其换来的重复计费:此前 base 直读
   *  currentWorld.playTimeMs,而 worldStore.save 每存一次把它写回累计值（同一对象），
   *  秒表仍从会话起点走 → 膨胀。 */
  function cumulativePlayMs(): number {
    return play.totalMs(Date.now());
  }
  /** 读档吸合（SW-BJ5）：槽位基线取 max(槽位 meta, 存档头)。存档头=最持久真值——
   *  副本/导入落库时 meta 可能落后（0）;quickLoad 会话无槽位,不吸合则该会话每次
   *  存档把快速档 header.playTimeMs 清回"会话净时长"（累计丢失）。 */
  function absorbLoadedPlayMs(save: unknown): void {
    const h = (save as { header?: { playTimeMs?: number } } | null | undefined)?.header?.playTimeMs;
    if (typeof h !== 'number' || !Number.isFinite(h)) return;
    play.absorb(h, Date.now());
    if (currentWorld && h > currentWorld.playTimeMs) currentWorld.playTimeMs = h; // 列表显示即时愈合,下次存档持久化
  }
  // 后台标签不计费（SW-BJ5 2026-09-07）：原版 FocusHelper.AllowCountingPlayerTime
  // （FocusHelper.cs:59-68）只在窗口激活∧非暂停∧非菜单时计数,UpdatePlayTimer
  // （Main.cs:17071）逐帧 Start/Pause;web 等价=visibilitychange 折算/续走
  // （PausePlayTimer=StopPlayTimer 折算语义,续走只重锚不重复计）。
  // 旧实现后台挂机墙钟照走,后台时长整段计入游玩时长（失焦计费缺口）。
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) play.pause(Date.now());
      else play.resume(Date.now());
    });
  }
  /** 程序化素材总包预热（#perf2026-08-28 三批修订）：buildAssets 是确定性全局单例
   *  （~6700 图标画布+全表，同步 ~400-700ms）。★只允许在【进世界路径起点】触发——
   *  与 worker 读档解析/沉降、素材下载并行吃掉；曾挂菜单启动 idle 钩子，实测在这台
   *  弱 GPU 上把 ~7k 张画布后备堆进菜单期 → 光标层上下文被逐（canvas哨兵 streak
   *  ≥100×6窗）+ HealCanvas 空转（2026-08-28 用户实报"菜单页就开始崩"）。fire-
   *  and-forget；Game 构造时 buildAssets 命中热单例（未完成则原地同步补完，语义同旧） */
  /** mainFlow 侧共享 worldGen worker(loadSave/预生成同进程串行:图标作业
   *  天然排在读档之前;Game 自身的 genClient 独立,互不影响) */
  let flowGenClient: import('./workers/WorldGenClient').WorldGenClient | null = null;
  async function sharedGenClient() {
    const { WorldGenClient } = await import('./workers/WorldGenClient');
    flowGenClient ??= new WorldGenClient();
    return flowGenClient;
  }
  let prewarmPromise: Promise<void> | null = null;
  /** 图标包预热(#三开压测批 worker 化):worker 生成图集→注入 AssetGen→物化。
   *  返回 Promise——调用方【必须 await】后再 makeGame(worker 化后定时器任务只
   *  派发异步作业,不 await 则 Game ctor 冷兜底仍会同步跑 legacy 生成,白干)。
   *  内部首个 await(worker spawn)即真异步 → 点击派发先行落屏;会话闩防重复生成 */
  function startAssetPrewarm(): Promise<void> {
    prewarmPromise ??= (async () => {
      try {
        const c = await sharedGenClient();
        const icons = await c.genIcons({ timeoutMs: 30000 });
        const m = await import('./assets/AssetGen');
        m.prepareIconAtlas(icons);
        m.buildAssets();   // 图集 putImageData 一次 + sheets/角色/敌怪(遗留主线程段)
      } catch (e) {
        console.warn('[assetPrewarm] 预热失败(回退主线程同步生成):', String(e).slice(0, 120));
        const m = await import('./assets/AssetGen');
        m.buildAssets();
      }
    })();
    return prewarmPromise;
  }
  let menuBg: MenuBackground | null = null;
  let menuRunning = false;
  let titleMenu: TitleMenu | null = null;
  let devMode = false;
  // IIII225：标题曲种子覆写（Main.cs:12626-12656 gameMenu 选曲支 1:1）——
  // 会话闩 = 最近一次【创建世界】的种子表现旗（cs WorldGen.drunkWorldGen 等生成期旗
  // 只在下次生成 Reset 时清零,读档不改旗 → 读档流不触本闩）。默认 undefined =
  // 本仓 TitleIntro 50（TitleMusicStyle 子系统未建模,50/51 档登记）。
  let lastGenScreenFlags: import('./vui/states/UIWorldLoadState').GenScreenSeedFlags | null = null;
  // ★IIIII228 TitleMusicStyle 细分（Main.cs:153-159 枚举 + :4602-4608 config 解析 +
  //  :12673-12694 选曲支）。Random 档每次启动抽签（cs = new UnifiedRandom(当前 tick)
  //  .Next(3)——本仓 Math.random 同语义）;Current 档「_isAsyncLoadComplete 前 50 /
  //  后 51」以「标题界面是否已交互挂载过」为加载完成近似（boot 首拍=50,此后 51）。
  const titleMusicRandom = Math.floor(Math.random() * 3);   // 0 Current / 1 Old / 2 Console
  let menuLoadDone = false;
  const titleStyleMusicId = (): number => {
    const seed = seedMenuMusicId();
    if (seed !== undefined) return seed;                    // 种子覆写优先（原版同序）
    let style = options.data.titleMusic ?? 'current';
    if (style === 'random') style = (['current', 'old', 'console'] as const)[titleMusicRandom];
    if (style === 'old') return 6;                          // :12688-12690 Old
    if (style === 'console') return 60;                     // :12685-12687 Console
    return menuLoadDone ? 51 : 50;                          // Current：加载带 50 / 完成后 51
  };
  const seedMenuMusicId = (): number | undefined => {
    const f = lastGenScreenFlags;
    if (!f) return undefined;
    if (f.drunkWorldGen) {
      if (f.remixWorldGen) return 70;                   // :12638-12641 remix
      // onlyShimmerOceanWorldsGeneration（Main.cs:2775-2782）= drunk×tenth×!remix
      // ×!everything → !notTheBees（getGoodWorldGen 不在 getter 里,cs 原文无）
      if (f.tenthAnniversaryWorldGen && !f.zenithWorld && !f.notTheBees) return 72;
      if (f.vampireSeed) return 75;                     // :12646-12649
      if (f.notTheBees) return 86;                      // :12650-12653
      return 60;                                        // :12654-12657
    }
    if (f.remixWorldGen) return 8;                      // :12659-12662
    if (f.tenthAnniversaryWorldGen) return 11;          // :12667-12670
    return undefined;
  };
  // 设置项加载 + 下发（M6）
  void options.load();
  options.onChange((d) => {
    audio.setVolume(d.musicVol);
    UISfx.sfx.master = d.sfxVol;
    UISfx.sfx.ambient = d.ambientVol;   // Ambient 环境音轨（Main.ambientVolume）
    UIScale.userScale = d.uiScale;
    devMode = d.devMode;
  });
  let quickSaveExists = false;
  let selectedAppearance: Appearance | null = null;
  /** 当前角色槽位 id（硬核消亡时回写 CharacterStore 用；直载存档/无角色时为 null） */
  let selectedCharId: number | null = null;
  /** 上次游玩角色 id（★BJ627 迁 PrefsStore=IDB 持久;quickLoad/文件导入等无选角
   *  上下文的入口以此续 .plr 语义——否则重载后 quickLoad 走世界内嵌玩家态,该会话
   *  存档不回写随身态 → 箱子搬家+重进角色 = 物品双份(review 2026-08-18 抓出的复制窗) */
  const LAST_CHAR_KEY = 'sbw.lastCharId';
  function charContextId(): number | null {
    if (selectedCharId != null) return selectedCharId;
    try {
      const v = prefGet(LAST_CHAR_KEY);
      return v != null && Number.isFinite(+v) ? +v : null;
    } catch { return null; }
  }
  /** ★BJ694（BJ691b 债②）：世界列表面「活动角色」快照（原版 UIWorldSelect
   *  ActivePlayer 语义:难度匹配层+游玩史层,见 WorldSelectActiveChar 注）。
   *  charStore 未载/index 缺席 → null=无角色域层（调用面安全回退）。 */
  function activeCharSnapshot(): { difficulty: number; playedWorlds?: number[] } | null {
    const cid = charContextId();
    if (cid == null) return null;
    const cm = charStore.list().find((m) => m.id === cid);
    return cm ? { difficulty: cm.difficulty, playedWorlds: cm.playedWorlds } : null;
  }
  function rememberCharId(id: number | null): void {
    if (id == null) return;
    try { prefSet(LAST_CHAR_KEY, String(id)); } catch { /* 隐私模式等 */ }
  }
  // ★BJ617 件1（用户拍板 2026-10-10「干脆就不应该有合并这个功能」）：多标签页并发
  //  防线=Web Locks 会话锁（src/save/SessionLock）——同世界/同角色已有会话拒载;
  //  不支持 locks 的浏览器=降级放行（双开各自覆盖写 last-writer-wins=用户明示接受面）。
  //  持有槽：loadFromKey/createWorldFlow 装入;quitToMenu/载入失败/生成中止释放;
  //  tab 关闭=浏览器自动释放（标准 API 语义,零接线）。
  let heldSessionLocks: { release(): void } | null = null;
  /** 载入会话锁组装：世界键反解 id（world.<id>）取世界锁+charContextId() 取角色锁。
   *  任一 'busy'=他 tab 会话在途 → { ok:false, which }（拒载）;unsupported=降级跳过
   *  （放行）。后半 busy 时先释放已到手的前半（防半持锁泄漏）;全到手才 ok。 */
  async function acquireLoadSessionLocks(key: string): Promise<{ ok: true; held: { release(): void } } | { ok: false; which: 'world' | 'char' }> {
    const held: SessionLock[] = [];
    const releaseAll = (): void => { for (const l of held.splice(0)) l.release(); };
    const wid = /^sandboxworld\.world\.(\d+)$/.exec(key ?? '')?.[1];
    if (wid != null) {
      const w = await acquireSessionLock(worldLockKey(Number(wid)));
      if (w === 'busy') return { ok: false, which: 'world' };
      if (w !== 'unsupported') held.push(w);
    }
    const cid = charContextId();
    if (cid != null) {
      const c = await acquireSessionLock(charLockKey(cid));
      if (c === 'busy') { releaseAll(); return { ok: false, which: 'char' }; }
      if (c !== 'unsupported') held.push(c);
    }
    return { ok: true, held: { release: releaseAll } };
  }
  let currentWorld: WorldMeta | null = null;
  /** ★BJ704-G7 件1：联机建房会话的世界槽位绑定（建房选世界 onPlay 拍记,进房
   *  onJoinRoom 时重置——原版客户端 msg7 收服务器 WorldId 进 ActiveWorldFileData
   *  （MessageBuffer.cs:488）,MapFileName=WorldId → 与本机同源档地图路径重合
   *  （WorldMap.TryGetMapPath :234-252）=联机玩自家世界亦建地图档;本仓消费面=
   *  doSave 的 recordPlayedWorld 绑定（slotMeta 空时回退）。码入房（非建房链）
   *  =undefined → null 不记（房间世界非本机槽位的可靠绑定,判语边界见 doSave 注）。 */
  let joinRoomWorldId: number | null = null;
  const charStore = new CharacterStore();
  const worldStore = new WorldStore();
  // ★BJ605（2026-10-10 线上事故·态B）：index 元数据写失败告警（WorldStore.saveIndex
  //  kvSet 'fail'——元数据丢档不砸数据面，回调而非抛；数据写入面 save/importSlot/
  //  duplicate 失败走 WorldSaveWriteError 抛错，由各调用方 catch 面接 toast）+
  //  ★用户明令件：数据写失败 → 自动导出存档文件下载兜底（手头 json 仍在，落库不成
  //  至少落文件——三旧档数据键消失根因未定谳前的用户级保险）
  worldStore.onWriteFail = () => { ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveFailedStorage')); };
  // ★BJ618 件2：导出兜底提为共享助手（世界/角色数据写败同一面——用户明令件
  //  「本地存档无法成功→自动导出存档提供下载」）
  const exportSaveBackup = (name: string, json: string): void => {
    try {
      const filename = downloadSaveJson(name, json);
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveExportedBackup', filename));
    } catch (e) {
      console.warn('[save] 备份导出失败', e);
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveFailedStorage'));
    }
  };
  worldStore.onWriteFailData = (name, _dk, saveJson) => exportSaveBackup(name, saveJson);
  // ★BJ618 件2：CharacterStore 告警面（镜像 WorldStore——BJ611 登记②收口+probe F8）：
  //  index 写败 toast;create/update/setState 数据写败抛 CharacterSaveWriteError（各
  //  调用方 catch 面感知）+本回调自动导出兜底（用户提示统一由此发出）。
  charStore.onWriteFail = () => { ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveFailedStorage')); };
  charStore.onWriteFailData = (name, _dk, json) => exportSaveBackup(name, json);
  // ★BJ618 件4：删除成功 → FS 备份同组快照清理（防已删世界/角色经恢复链复活+隐私
  //  面;双 index 墓碑由 delete 内 saveIndex→onIndexWrite 重写生效,此处只清数据组）。
  worldStore.onDeleted = (id) => { void fsBackupPurgeSnapshots('world', id); };
  charStore.onDeleted = (id, what) => {
    if (what === 'all') void fsBackupPurgeSnapshots('player', id);
    void fsBackupPurgeSnapshots('playerstate', id);
  };

  // ★BJ614（2026-10-10 用户拍板「File System Access 是个不错的方向,可以做为增强选项,
  //  先在设置中可启用」）：本地目录自动备份接线——存档成功链尾自动快照（世界/角色
  //  外观/随身态 时间戳档各留最近 3 份）+ 双 index 覆盖档（worlds/players.index.json,
  //  恢复场景=索引被驱逐时的重建来源）。角色幸存于 BJ611 驱逐本质是「小档 ≤2MB 双写
  //  localStorage」的运气而非设计（用户点破）——外观/随身态同入备份面。增强链
  //  fire-and-forget,FsBackup 内部全 try-catch 绝不影响主保存链。
  worldStore.onDataWrite = (name, id, json) => { void fsBackupSnapshot('world', id, name, json); };
  worldStore.onIndexWrite = () => { void fsBackupIndex('worlds', JSON.stringify(worldStore.list())); };
  charStore.onDataWrite = (name, id, json) => {
    void fsBackupSnapshot('player', id, name, json);
    void fsBackupIndex('players', JSON.stringify(charStore.list()));
  };
  charStore.onStateWrite = (id, json) => {
    const cm = charStore.list().find((x) => x.id === id);
    void fsBackupSnapshot('playerstate', id, cm?.name ?? 'char', json);
    void fsBackupIndex('players', JSON.stringify(charStore.list()));
  };
  // ★BJ614 连败一次性 toast（连续 3 败 → 目录可能被删/移动;同一连败段只报一次）
  setFailToastHandler(() => { ui.toast(Lang.text('Mods.SandboxWorld.Toast.FsBackupFailStreak')); });
  // ★BJ614 读档自愈恢复链注入（世界/角色/双 index 键通用）：键缺失 → FS 备份目录
  //  最新同键档写回 IDB → 调用方以返回文本续正常链（零旁路）。
  //  ★BJ655（2026-10-12 用户实报「Mac 上每次进入都提示本地备份目录要重新授权」）：
  //  prompt 态改静默——Chromium 句柄权限会话级（BJ614 登记债:普通标签页每新会话
  //  回落 prompt）,本链多在启动装配（BJ611 幽灵扫描/ensureLoaded）触发,每次新会话
  //  都 toast=每次进入都打扰。设计原意（Settings.ts:685 面）=自动链静默跳过+设置页
  //  「待重新授权」常驻态+按钮;恢复幽灵档是增强链非用户显式请求,授权借读档点击
  //  手势当场申请（loadFromKey prompt 分支→fsBackupRequestPermission）。
  const fsBackupRestoreMiss = async (key: string): Promise<string | null> => {
    const r = await restoreFromBackup(key);
    if (r.ok) {
      console.warn('[load] FS 备份恢复命中', key, r.file);
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.FsBackupRestored', r.file));
      return r.text;
    }
    return null;   // ★BJ655：prompt（及一切失败态）静默,授权状态提示面=设置页
  };
  worldStore.onRestoreMiss = fsBackupRestoreMiss;
  charStore.onRestoreMiss = fsBackupRestoreMiss;

  // ★BJ611（2026-10-10 线上事故·Chromium 磁盘紧张驱逐根治面）：持久存储统一申请+
  // 授予态追踪 + 未授予一次性提醒 + 驱逐后首启幽灵档检测（fire-and-forget,不阻断
  // 装配）。事故终因：C 盘仅剩 ~3GB → QuotaManager 整批驱逐 best-effort origin
  // （IDB+Cache API,localStorage 幸存）→ 全部世界数据键消失。此前存档链从未申请
  // persist() 恒 best-effort;申请口=src/save/StoragePersistence.ts（会话一次;
  // AssetCache 素材暖存链既有调用幂等无害）。
  void initStoragePersistenceWatch();
  async function initStoragePersistenceWatch(): Promise<void> {
    const state = await requestStoragePersistence();
    // ② persisted=false 一次性提醒（★BJ627 记忆面迁 PrefsStore=IDB,跨会话只弹
    //    一次;文案含可操作建议=安装为应用/收藏书签提高 Chrome 启发式授权率 +
    //    定期导出备份闭环）
    if (state !== 'granted' && shouldShowPersistNotice(prefLsLike())) {
      markPersistNoticeShown(prefLsLike());
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.StorageNotPersisted'));
    }
    // ③ 幽灵档扫描（驱逐后首启检测）:index 有 meta 而数据键 IDB 缺失且 localStorage
    //    无副本=被清理形态;IDB 打不开=不可定谳弃检。指纹记忆——新增驱逐才再提醒。
    await Promise.all([worldStore.ensureLoaded(), charStore.ensureLoaded()]);
    const scan = await scanEvictedSaves(worldStore.list(), charStore.list());
    if (scan.conclusive && scan.evicted.length > 0) {
      // ★BJ614 幽灵扫描联动：FS 备份启用+granted → 逐键自动恢复被驱逐数据（写回
      //  IDB=原键直读恢复）。放指纹门外——每次首启扫描都尝试（prompt 会话静默跳过,
      //  用户授权后下次首启自动补齐;若在门内会被「已提醒过」一次性吞掉恢复链）。
      const rec = await fsBackupRestoreEvicted(scan.evicted);
      const fp = evictNoticeFingerprint(scan.evicted);
      if (shouldShowEvictNotice(prefLsLike(), fp)) {
        markEvictNoticeShown(prefLsLike(), fp);
        ui.toast(Lang.text('Mods.SandboxWorld.Toast.StorageEvictedNotice', scan.evicted.length));
        // ★BJ614 幽灵提示补「已尝试从本地备份恢复」（成功 N 个=诚实措辞带
        //  「可能落后于最后状态」;尝试无果=补未恢复说明,授权提示走读档链/设置页）
        if (rec.attempted) {
          ui.toast(rec.restored > 0
            ? Lang.text('Mods.SandboxWorld.Toast.StorageEvictedNoticeFsRestored', rec.restored)
            : Lang.text('Mods.SandboxWorld.Toast.StorageEvictedNoticeFsTried'));
        }
      }
    }
    // ④ estimate 快照（存档列表状态行首读;此后存档/列表打开时再采样）。
    //    ★摘除注（2026-10-10 用户实测+明令）：quota 环比骤降预警 toast 链已摘——
    //    M97+ quota 锚磁盘总容量（C 盘剩 3GB 空闲时 quota 仍 10.3GB）,环比抓不到
    //    磁盘变紧;休眠纯核与 re-arm 口见 src/save/StoragePersistence.ts。
    void refreshStorageStatus();
  }

  /** 角色贴图预载（2026-08-28 用户要求“确保角色贴图加载完整再进入世界”）：
   *  按角色档案实际外观预载 Player_ 通道/发型——读档/导入路径 makeGame 时
   *  selectedAppearance 可能为空,preloadSceneAssets 曾按默认 v0 预载 → 首帧
   *  sheetRect 回退 Player_0 初始贴图一闪而过。await 就绪后才 loadWorld */
  async function ensureCharAppearanceFiles(): Promise<void> {
    const g = game;
    if (!g) return;
    const cid = charContextId();
    // ★外观(皮肤变体/发型)持久在 Appearance JSON(charStore.get)——getState 返回的
    //  随身物品态没有这两个字段（2026-08-28 编译错）
    const app = (cid != null ? await charStore.get(cid) : null) ?? selectedAppearance ?? null;
    await g.ensureAppearanceFiles(app);
  }

  // 隐藏文件输入（DOM 能力，VUI 按钮触发）
  // E2E/控制台调试:直接加载存档 JSON 文本(菜单阶段可用,绕过设置面板 file input)
  (window as unknown as { __swLoadJson?: (t: string) => Promise<boolean> }).__swLoadJson = (t: string) => loadFromJson(t);   // ★BJ704-G7 件1:返程成败(探针忽略不受影响)
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  root.appendChild(fileInput);
  const wldInput = document.createElement('input');
  wldInput.type = 'file';
  wldInput.accept = '.wld';
  wldInput.style.display = 'none';
  root.appendChild(wldInput);

  // ---- 游戏进入/退出（沿用 main.ts 既有逻辑） ----

  function enterGame(g: Game) {
    // 防御性拆旧(2026-08-18 泄漏 review):旧 Game 的 rAF 循环靠每帧自注册
    // 存续,running 唯一被关的入口是 destroy()——若上一局未走 quitToMenu 就
    // 直接再进(任何新增直达路径),旧实例连同世界数组/画布/GL 纹理永生叠加。
    // 这里兜底:进入新局前拆掉仍存活的旧实例
    if (game && game !== g && game.running) {
      try { game.destroy(); } catch (e) { console.warn('[mainFlow] 旧实例清理异常(忽略):', e); }
    }
    game = g;
    // ★BJ280（2026-09-22）：进世界即 dirty——onWorldReady 唯一收口（创建/槽位读档/
    //  快速读档/导入/联机加入五路全覆盖）。无逐帧变更追踪（成本高,登记债）,保守
    //  语义=「进世界后未走保存链即 dirty」,宁多拦不漏拦。
    worldDirty = true;
    // Game Zoom 基线（Main.GameZoomTarget 持久化键 "Zoom" Main.cs:4284/4575；
    // 相机在 loadWorld 内已建，onWorldReady 后此处生效——ViewZoomIn/Out 键与
    // 滚轮仍直调 setZoom 动态改，设置页读态优先相机实时值）
    g.setZoom(options.data.gameZoom);
    // 指针图标门桥(DrawInterface_40 :44476 MouseDisplayItem 非空 → 图层隐藏;
    // DrawInterface_38 :44628 拖拽物出现 → 住房光标取消)
    g.uiHeldStack = () => !!ui.heldStack;
    (window as unknown as { __swGame: Game }).__swGame = g;
    (window as unknown as { __swUI: UI }).__swUI = ui; // 探针/控制台直调(成就弹窗预览等)
    // 移动端：虚拟控件层（触屏设备启用；桌面零渲染零影响）——在世界触摸的
    // 用户手势内尝试全屏+横屏锁定（ⓞ 进世界点击即手势；失败静默，⛶ 按钮兜底）
    if (resolveTouchMode() === 'touch') {
      mobile?.destroy();
      mobile = new MobileControls(g, ui.root);
      // 智能光标触屏默认开(2026-08-28 用户定案,touchSmartCursorDefault):toggle
      // 模式下直接置初值——wanted 仅被按下沿翻转,无电平时维持(桌面恒 false 不进);
      // Hold 模式的按住语义由 tick 电平面接管,不灌初值
      if (options.data.touchSmartCursorDefault && options.data.smartCursorMode === 'toggle') {
        g.smartCursor.wanted = true;
      }
      void tryFullscreenLandscape();
    }
    // HMR 双实例检测（F5 调试报告 instance 段）：每次挂载计数 +1，>1 即模块分叉
    (window as unknown as { __swInstanceCount?: number }).__swInstanceCount =
      ((window as unknown as { __swInstanceCount?: number }).__swInstanceCount ?? 0) + 1;

    // E2E/控制台调试:直接加载存档 JSON 文本(绕过设置面板的 file input)
    // (挂模块级而非 enterGame:菜单阶段测试脚本就要用)
    // SW-BJ5 2026-09-07：会话起点=计费锚点（原版 StartPlayTimer,PlayerFileData.cs:159）。
    // 基线钉死为槽位 meta 上次存档终值（新世界/导入=0）——此后存档对 meta 的回写不回流
    play.start(currentWorld?.playTimeMs ?? 0, Date.now());
    // 物品图标后台预取(主菜单不载图标=省 6059 请求;进世界补齐,游戏内显示不变)
    atlas?.prefetchIcons();
    // 全屏地图背景族预取(MapBG* 43 张+卷轴 Map.png——vui 懒加载首次请求要几百 ms,
    // 开图头几帧背景未就绪 → 近黑底色一闪;进世界后台补齐后开图即得羊皮纸)
    atlas?.preloadUiPrefix(['MapBG', 'Map.png']).catch(() => {});
    // ★幕布撤除延后(#三开压测批"就绪瞬间黑一下"):stopMenu(毁菜单幕布+
    // VUI.setState(null) 清加载页)原在 g.start() 前——首帧上屏前的空窗=黑一下。
    // 现世界先在幕布底下渲 2 帧,stopMenu 由 onWorldReady 的 whenFirstPaint 回调执行
    titleMenu?.destroy();
    titleMenu = null;
    ui.game = g;
    ui.initInGame(); // DOM 版游戏内 UI（道具栏/背包/合成/宝箱/Buff）——用户指定 web 技术路线
    // ★幕布期抬 z（2026-10-22「动态背景早退」修复,机制全注见 MenuBackground.
    //  setCurtainMode）：c10e 三画布(positioned z-auto,root 末端)同层树序在后
    //  =画在 z0 幕布之上——首帧即埋掉幕布。z0→5 盖回三画布(HUD z10/DOM 进度
    //  页 290/VUI 300 照旧在上);stopMenu 销毁画布=复位,showTitle 复用沿兜底复位。
    menuBg?.setCurtainMode(true);
    g.start();
    audio.play('main');
  }

  function maybeDev(g: Game) {
    if (!devMode) return;
    g.setupDevMode();
    g.world.explored.fill(1);
    g.world.exploredDirty = null; // 全图变化无脏信息 → 渲染端整幅重建
    g.world.exploredVersion++;
  }

  /** ★R-C-F5(2026-10-14):缺 mod 存档可见警告(loadSaveData 检测→窗口存→此处消费) */
function warnMissingMods(): void {
  const w = window as unknown as { __swMissingModsWarn?: Array<{ id: string; version: string }> };
  const missing = w.__swMissingModsWarn;
  if (!missing?.length) return;
  w.__swMissingModsWarn = undefined;
  ui.toast(Lang.text('Mods.SandboxWorld.Toast.MissingMods', missing.map((m) => `${m.id}@${m.version}`).join(', ')));
}

function makeGame(): Game {
    const g = new Game(root, {
      onWorldReady: () => {
        // ★首帧上屏后再切画面(#三开压测批"就绪瞬间黑一下"):enterGame 先在
        // 加载页【底下】启动世界渲染,whenFirstPaint(2 帧真实上屏)后才撤幕布/
        // 进度页——切换零空窗。3s 兜底防渲染异常时永久卡加载页
        // ★wbake=1 世界入场空白修复刃(2026-09-28):worker 烘焙路径下首烘占位=
        // 透明页区,帧数门只数渲染帧——worker 往返慢于帧数时幕布提前掀开=全视口
        // 瓦片/墙层空白 1-2s(用户实报图36/37)。旗开时 whenFirstPaint(4) 之后链入
        // 「可视视口 chunk 全部落页」覆盖门(内部 3s 保险强制掀幕防永久黑屏);
        // 旗关表达式逐字保留=幕布语义零变化。
        enterGame(g);
        // ★wbake 转正批（2026-09-28 用户拍板「可以转正」+保护令）：渲染期待冻结窗——
        // wbake worker 路径下视口未 covered 期间世界模拟整体冻结（怪/弹幕/生成/伤害
        // 全停,防怪物伤害/悬空掉落/误操作;语义=「渲染未完成则世界时间对该玩家暂停」,
        // vanilla 无此机制=wbake 特有 UX）。开窗成功 → 加载页步骤切「正在渲染世界」
        // （UX 要求①;进度条保持读档终态,窗≤3s）。游玩时长经 onEntryFreeze 回调同步
        // 暂停/续走（冻结期不计费,SW-BJ5 口径）。旗关/worker 降级返回 false=零变化。
        if (g.beginEntryFreeze(3000)) {
          // ★步骤归位+HUD 幕布抑制（2026-09-29 用户令：「把这个 step 挂在进度条的
          //   一项 step,而不是直接出一个遮罩」+「加载幕布期热键栏/Shift 提示不该
          //   出现」）。两刀都只在冻结窗开启沿落（旗关/worker 降级 beginEntryFreeze
          //   =false 整段不进 = wbake=0 逐字节零变化）：
          //  ·步骤文字走【VUI 加载页步骤行】（setProgress 的 header 同位接管,
          //    双进度杆保持读档终态不动;掀幕 stopMenu 清页=步骤随之消失）——不再
          //    另出 .sw-progress 全屏 DOM 遮罩（旧形态在 VUI 页 z300 底下再压一层
          //    85% 暗罩+居中文字=文字浮在进度条装饰上的怪异叠层,用户实报）。
          //    无 VUI 加载页的流（wld 导入/联机,DOM .sw-progress 即其本流加载页）
          //    沿用原位更新语义（该 DOM 页此时就是"进度条"本体,非多余遮罩）。
          //  ·enterGame→initInGame 已建 HUD 树（.sw-root z10）,而幕布=menuBg 画布
          //    （z0,盖游戏画布）+透明 VUI 页（z300）——盖不住 DOM HUD=热键栏/键位
          //    提示浮在幕布上（用户实报②）。挂抑制类（visibility 保布局零重排）,
          //    掀幕同帧摘除=世界+UI 同帧无缝出现（禁闪烁）。
          const renderStep = Lang.text('Mods.SandboxWorld.Progress.RenderingWorld');
          const load = VUI.ui.current;
          if (load instanceof UIWorldLoadState) load.showRenderStep(renderStep);
          else ui.showProgress(renderStep, 1);
          ui.setHudSuppressed(true);
        }
        const entryGate = WBAKE_ENABLED
          ? g.whenFirstPaint(4).then(() => g.whenViewportBaked(3000))   // 4 帧原语义不变,其后追加覆盖门
          : g.whenFirstPaint(4); // 4 帧:tintSkyTex 首烘(~2 帧)也纳入幕布下,切换帧必亮
        void Promise.race([
          entryGate,
          new Promise((r) => setTimeout(r, 3000)),
        ]).then(() => {
          g.endEntryFreeze();   // 冻结终态兜底（正常先由 viewportCovered 解除;幂等）
          ui.hideProgress();
          stopMenu();   // 撤菜单幕布+清 VUI 加载页(世界已上屏,零空窗)
          ui.setHudSuppressed(false);   // ★掀幕同帧放行 HUD（开启沿挂载;幂等,旗关=无类可摘零变化）
          // ★K3 星批 idle 预热（2026-10-01）:首夜帧 ~132ms 尖峰（sprite:precip 惰性
          //  编译+Star_0..3 纹理首传）消解——世界就绪掀幕后的空闲期预编译/预传
          //  （SkyRenderer.prewarmStarBatch:loadTex 触发+就绪预传+GL 层 prewarmPrecip;
          //  失败静默=首夜照旧惰性路径）。rIC 空闲期执行不与首屏渲染争帧;
          //  worker/node 判死守卫在 prewarmStarBatch 内（typeof document）。
          {
            const prewarmStars = (): void => {
              try { g.renderer.sky.prewarmStarBatch(); } catch { /* 预热失败=惰性路径兜底 */ }
            };
            if (typeof requestIdleCallback === 'function') requestIdleCallback(prewarmStars, { timeout: 2000 });
            else setTimeout(prewarmStars, 100);
          }
          // SW-BN2 2026-09-07（用户令#3）：欢迎语键位标注改【活绑表驱动】——曾硬编码
          // "A/D 移动，空格跳跃，E 背包，Esc 暂停"，缺省表对齐原版后 E/背包含义反转
          // 即刻陈旧。四段标签全部经 keybindHintLabel 现读 bindsOf（重绑跟随）；
          // 暂停段=Escape 仍绑在 Inventory 时才给键名（原版暂停浮层无独立 trigger,
          // 本仓 Esc 链 face 派生自该绑定），否则显示"未绑定"。
          ui.toast(Lang.text('Mods.SandboxWorld.Toast.Welcome', g.world.name,
            `${keybindHintLabel('Left')}/${keybindHintLabel('Right')}`,
            keybindHintLabel('Jump'),
            keybindHintLabel('Inventory'),
            isBound('Inventory', 'Escape') ? keybindCodeLabel('Escape')
              : Lang.text('Mods.SandboxWorld.UI.ManualUnbound')));
          // ★缺失 mod 提示（2026-10-04 P3）：存档头 mods vs 当前启用集对账——
          //  缺失=内容已静默降级（stable id ?? 0 兜底），此处给用户可见 toast
          const saveMods = g.world?.saveMods;
          const enabled = getEnabledModIds();
          if (saveMods?.length && enabled) {
            const missing = saveMods.filter((m) => !enabled.includes(m.id));
            if (missing.length > 0) {
              ui.toast(Lang.text('Mods.SandboxWorld.ModsPanel.SaveMissing',
                missing.map((m) => `${m.id} v${m.version}`).join(', ')));
            }
          }
          maybeDev(g); applyAppearance(g); maybeShowWelcomeAnnounce();
        });
      },
      // ★wbake 转正批：冻结窗开/关沿 → 游玩时长计费暂停/续走（原版 UpdatePlayTimer
      // 「非暂停不计」口径,PlayerFileData.cs:147-206;SW-BJ5 计费域）。三路解除
      // （覆盖终态/3s 保险/幕布 race 兜底）全部经 Game.endEntryFreeze 单点触发。
      // 已知边界：冻结窗内 visibilitychange 回前台会先把秒表续走（resume 幂等序）,
      // 残窗 (<3s) 照计——与失焦折算语义同构,登记不修。
      onEntryFreeze: (open) => { if (open) play.pause(Date.now()); else play.resume(Date.now()); },
      onInventoryChanged: () => { g.prefetchInvProjectiles(); g.prefetchInvPlaceableSheets(); ui.refreshAll(); },
      onCraftCursorGlow: (itemId) => ui.markCursorGlow(itemId),
      // 合成成品上光标（CraftItem_GrantItem Main.cs:43329）——余量由 Game 落包/掉落
      grantToCursor: (itemId, stack, prefix) => ui.grantCraftToCursor(itemId, stack, prefix),
      onBuffsChanged: () => ui.refreshBuffs(),
      onBuffsFrame: () => ui.tickBuffLive(),
      // ★SW-BJ157 stackSplit 计时面（RightClick 取件臂按住连取的 60Hz 驱动）
      onStackSplitTick: () => ui.tickStackSplitMain(),
      // 自动保存（Main.autoSave 墙钟到点 → DoUpdate_AutoSave :19589 saveAndPlay）
      // silent=原版自动保存全程静默（:19594 无任何 UI/音效）；手动/退出保存仍提示
      onAutoSave: () => doSave(true),
      // 配装热键切换白闪（GetColorByLoadout :2554-2559；背包按钮同款）
      onLoadoutSwitched: () => ui.flashLoadoutSwitch(),
      // ★Q-F9 快堆槽级 blocked 回执（QuickStacking.cs:360-363 → IndicateBlockedSlot 红脉冲）
      onQuickStackBlockedSlots: (slots) => ui.indicateBlockedSlots(slots),
      // ★SW-FX29 排序色带（ItemSorting.cs:1529/:1639 SetGlow → ItemSlot.cs:2291 hsl 色带
      //  渐隐 300t）——chest=false 背包/弹药格（context 0/2）/true 箱槽（context 4/32/3）
      onSortGlow: (slot, hue, chest) => ui.setSlotGlow(chest ? 'chest' : 'inv', slot, hue),
      onToast: (m) => ui.toast(m),
      onAchievementPopup: (name, title) => ui.achievementPopup(name, title),
      onHousingCursor: (m, keepPanel) => {
        // Game 单发完成/取消 → 面板同步（m=null 自毁,BJ32 关条通道;keepPanel=true
        // =仅摘选中面板保持——分配成功/右键取消原版收口 Main.cs:45931/:45943）
        const p = (window as unknown as { __swHousingPanel?: { cursorChanged: (m: unknown, keepPanel?: boolean) => void } | undefined }).__swHousingPanel;
        p?.cursorChanged(m, keepPanel);
        // vanilla 布局住房页(EquipPage=1)选中态由 game.housingMode 派生且无每帧
        // 重绘点（paintVanillaInvSlots 只挂 refreshAll 族）——Game 侧清态后补重绘
        ui.refreshHousingSelection();
      },
      // 原版 Main.NewText 消息列(Main.cs:64095 → LegacyChatMonitor)；
      // width = NewTextMultiline WidthLimit（广播盒 460px 折行，-1 不限）
      onChat: (t, r, g, b, width) => ui.chatMessage(t, r, g, b, width),
      // 观战启动关全 UI（IngameUIWindows.CloseAll :43017）
      onCloseAllUI: () => ui.closeAll(),
      // NPC 对话系统(SetTalkNPC + GetChat)
      // 角标第 6 参（npcChatCornerItem 值态）透传——曾漏传导致任务鱼图标永不显示
      onNpcDialog: (name, chat, buttons, portrait, vanillaId, cornerItem) => ui.showNpcDialog(name, chat, buttons, portrait, vanillaId, cornerItem),
      onNpcDialogClose: () => ui.closeNpcDialog(),
      onReforgeOpen: () => ui.showReforge(),
      // 向导「制作」（NPCChatText_GuideReverseCrafting :40723）：开背包 +
      // ★刀19 vanilla 布局=原版向导制作菜单（modern 缺省开窗/经典位槽）;
      // classic 布局=自创反查浮层（零变化白名单）
      // ★FX23:openInventory 必须 force——原版 :40724 `playerInventory = true`
      //   【无条件置位】(≠Esc 链 ToggleInv 的开/关翻转;Player.OpenInventory
      //   Player.cs:5071-5075 = force-open)。缺 force=背包已开态点「制作」把
      //   背包翻转关掉,向导态/modern 窗全落在 display:none 面板内 → 用户只见
      //   对话收起、无任何制作 UI(FX23 探针 B8/B9 实锤)
      onGuideCraftOpen: () => {
        ui.openInventory(true);
        if (options.data.inventoryLayout === 'vanilla') ui.openVanillaGuideCraft();
        else ui.openGuideSearch();
      },
      // ★SW-FX30 刀⑦ 合成站右键 focus 钩（Player.cs:33541-33547 → :33555-33561）：
      // classic 支 = OpenCloseFilter（CraftingUI.cs:146-159 开包+网格态+站点过滤）
      onCraftingStationOpen: (f) => ui.openCraftingStationFilter(f),
      onNpcShop: (title, items, copper, happinessMul, medals, medalsTotal) => ui.showNpcShop(title, items, copper, happinessMul, medals, medalsTotal),
      // NPC 快乐度详情浮层（ReportHappiness.Interact）
      onNpcHappiness: (info) => ui.showNpcHappiness(info),
      onReadSign: (text) => ui.showSign(text),
      // 路牌双态对话框（读/编辑/同锚关牌——Player.cs:32231 OpenSign 语义）
      onSignDialog: (x, y, text) => ui.showSignDialog(x, y, text),
      onDayNight: (isDay) => audio.setDayNight(isDay),
      onMusic: (id) => audio.playMusic(id),
      // ★R22 月总召唤倒计时音乐压制（Main.cs:11646-11664 渐熄+曲首硬切）
      onMoonCountdown: (cd, max) => audio.setMoonLordCountdown(cd, max),
      // 硬核角色死亡消亡（Player.cs:38255 HardcoreDeathPenalty）：标记回写角色存档，
      // 重进角色列表即灰显禁入（原版 KillMeForGood :38173+ 直接删 .plr 档）
      onHardcoreDeath: async (appearance) => {
        selectedAppearance = appearance;
        // 清随身态（物品已全数掉落;残留=下一世界复活全套装备的复制窗,2026-08-19
        // 补齐)+ 清 lastCharId（quickLoad 回退不再命中亡者态）
        if (selectedCharId != null) {
          // ★BJ618 件2：update/clearState 写败抛错——catch 面防 unhandled rejection
          //  （提示由 onWriteFailData 导出兜底回调发;消亡标记失败不阻断后续清理）
          try {
            await charStore.update(selectedCharId, appearance);
            await charStore.clearState(selectedCharId);
          } catch (e) { console.warn('[char] 硬核消亡回写失败', e); }
        }
        try { prefRemove('sbw.lastCharId'); } catch { /* 隐私模式 */ }   // ★BJ627 三清（LS 同清防收编复活）
      },
      // 梳妆台更衣窗（Main.OpenClothesWindow Main.cs:43568）：确认后回写角色档 +
      // 在线外观（原版外观随 .plr 档，CancelClothesWindow 取消则回退六色快照）
      onClothesWindow: (appearance) => {
        ui.showClothesWindow(appearance, async (a) => {
          selectedAppearance = a;
          g.player.appearance = a;
          if (typeof a.team === 'number') g.player.team = a.team;
          g.net?.resendAppearance();
          // ★BJ618 件2：update 写败抛错——catch 防 unhandled rejection（提示由
          //  onWriteFailData 导出兜底回调发;失败不弹「已更衣」假提示）
          try {
            if (selectedCharId != null) await charStore.update(selectedCharId, a);
          } catch (e) { console.warn('[char] 更衣回写失败', e); return; }
          ui.toast(Lang.text('Mods.SandboxWorld.ClothesWindow.Changed'));
        });
      },
      // 造型师理发窗（Main.OpenHairWindow Main.cs:43073）：报价/付款走
      // Game.hairRestylePrice/buyHairRestyle（发型 10 金 + 发色 2 金链），
      // BuyHairWindow 成交后回写角色档 + 在线外观（Msg4 SyncPlayer 语义）
      onHairWindow: () => {
        const appearance = g.player.appearance;
        if (!appearance) return;
        ui.showHairWindow(appearance,
          { priceOf: (a) => g.hairRestylePrice(a), buy: (a) => g.buyHairRestyle(a) },
          async (a) => {
            selectedAppearance = a;
            g.player.appearance = a;
            g.net?.resendAppearance();
            try {
              if (selectedCharId != null) await charStore.update(selectedCharId, a);
            } catch (e) { console.warn('[char] 理发回写失败', e); return; }
            ui.toast(Lang.text('Mods.SandboxWorld.ClothesWindow.Changed'));
            g.closeNpcDialog();   // BuyHairWindow :43110 SetTalkNPC(-1)
          },
          () => g.closeNpcDialog());   // CancelHairWindow :43096（造型师 SetTalkNPC(-1)）
      },
    }, atlas);
    // 纸娃娃贴图预载按当前角色外观收窄(545 张全量 → ~30 张);外观本体在
    // onWorldReady 的 applyAppearance 才落位,预载期间读这里
    g.preloadAppearance = selectedAppearance;
    return g;
  }

  // ---- 世界流程 ----

  /** 新世界角色携带（★导演桥补正 2026-10-16 数据事故）：与 createWorldFlow 同段——
   *  已有角色随身态则背包/装备/储物/buff 随角色进世界。__swFlow.newWorld 裸桥曾缺
   *  此段=空 Inventory 玩家进场，一旦触发任何存档（BJ280 卸载守卫/退出即存档/
   *  快速存档），doSave 的 charState 同步会把空 player 写进角色随身档
   *  （sandboxworld.playerstate.<cid>）=「角色物品装备全丢」。 */
  async function carryCharState(g: Game) {
    const cid = charContextId();
    rememberCharId(cid);
    const cs = cid != null ? await charStore.getState(cid) : null;
    if (cs) {
      const sx = g.player.x, sy = g.player.y;
      applyPlayer(g, { ...playerFromDiskForm(cs), x: sx, y: sy });
      applyCharJourney(g, cs);   // 旅程力量玩家侧随身（IPersistentPerPlayerContent）
    }
  }

  async function newWorld(seed: string, w: number, h: number) {
    // ★顺序即正确性(#三开压测批续):先挂进度页与预热,再让出一个宏任务——
    // 预热定时器(0ms)必然先于本函数的续体执行,buildAssets 在【独立 task】跑完;
    // 否则 makeGame 同步构造里 Game ctor 冷兜底 buildAssets(~1.2s)会吃掉整个
    // 点击 EventDispatch(t1547 后续专录 trace 实锤:WorldCreation:151 派发 1232ms)
    ui.showProgress(Lang.text('Mods.SandboxWorld.Progress.GeneratingWorld'), 0.05);
    await startAssetPrewarm();
    const g = makeGame();
    await ensureCharAppearanceFiles();   // 角色贴图就绪再进世界（2026-08-28）
    await g.newWorld(seed || String(Date.now()), w, h, (label, p) => ui.showProgress(Lang.worldgenText(label ?? ''), p));   // label=undefined（粘滞文案）仅此合成探针路径，直收窄空串
    await carryCharState(g);   // ★导演桥补正：角色随身态随角色进新世界（防空玩家存档覆写角色档）
  }

  /** 空白世界直通道（导演模式 2026-10-16）——不走 worldgen 流水线：
   *  构造全零 World + 显式补出生点/地层线 + 出生台座，loadWorld(settled) 秒进。
   *  供导演 mod 测试与自定义地形拍摄（buildScript/fillRect 现画）；真实地形仍走 newWorld。 */
  async function blankWorld(w = 2100, h = 700) {
    ui.showProgress(Lang.text('Mods.SandboxWorld.Progress.GeneratingWorld'), 0.4);
    await startAssetPrewarm();
    const g = makeGame();
    await ensureCharAppearanceFiles();   // 与 newWorld 同链（角色贴图就绪再进世界）
    const world = new World(w | 0, h | 0, 20261016, '空白世界');
    const sx = Math.floor(w / 2), sy = Math.floor(h * 0.3);
    world.spawnX = sx; world.spawnY = sy;
    world.spawnX0 = sx; world.spawnY0 = sy;
    world.groundLevel = Math.floor(h * 0.22);
    world.rockLevel = Math.floor(h * 0.45);
    world.lavaLine = Math.floor(h * 0.82);
    // 出生台座：afterWorldLoad 落位=player 顶 (spawnY-3)*TILE、脚底踩 spawnY 行顶面
    //（Game.ts :7996）——草面(sy)+泥土(sy+1..sy+3)；空白世界脚下无台座即坠落到底
    const dirt = TILE_BY_KEY['dirt'] ?? 1, grass = TILE_BY_KEY['grass'] ?? 3;
    for (let x = sx - 48; x <= sx + 48; x++) {
      world.store.setTile(x, sy, grass);
      for (let y = sy + 1; y <= sy + 3; y++) world.store.setTile(x, y, dirt);
    }
    await g.loadWorld(world, (label, p) => ui.showProgress(Lang.worldgenText(label ?? ''), p), { settled: true });
    await carryCharState(g);   // ★导演桥补正：同 newWorld（防空玩家存档覆写角色档）
  }

  /** 把选中角色的外观应用到玩家（进游戏后调用）。联机时补发 SyncPlayer——
   *  初始两发（PlayerSlot/PlayerSpawn 时刻）都在外观应用前，远端只见默认皮肤 */
  function applyAppearance(g: Game) {
    if (selectedAppearance) {
      g.player.appearance = selectedAppearance;
      if (typeof selectedAppearance.team === 'number') g.player.team = selectedAppearance.team;
      g.net?.resendAppearance();
      // ★SW-RB10b（2026-09-10）：单人读档渔夫任务完成旗重构（WorldGen.cs:6781-6784
      //  playWorldCallBack）。vanilla 时序=LoadPlayer 先于 loadWorld 装配尾、重构时
      //  角色名已就位；本仓倒置（loadWorld→afterWorldLoad 先跑，角色名此刻才落位），
      //  原挂 afterWorldLoad 的重构拿到的是缺省名（appearance 未应用→playerName()
      //  回落 l10n DefaultPlayerName），与名单内真实角色名 Contains 恒 false=旗恒
      //  false（用户实报「持鱼提交不了」的残余半边，BJ45 单测以缺省名作名单项被
      //  掩盖）。幂等；联机不重构（原版走 msg74，Game 方法内自带门）。
      g.reconstructAnglerFinishedOnPlayerNamed();
    }
  }

  async function quickLoad() {
    if (!quickSaveExists) { ui.toast(Lang.text('Mods.SandboxWorld.Toast.NoQuickSave')); return; }
    await loadFromKey(QUICK_SAVE_KEY);
  }

  /** 玩家状态回填（worker/主线程两路共用） */
  function applyPlayer(g: Game, player: ReturnType<typeof loadSaveData>['player']) {
    g.player.hp = player.hp;
    g.player.x = player.x;
    g.player.y = player.y;
    // 上限扩容进度（水晶之心/生命果/魔力水晶；旧档缺省 100/20/20）
    // 永久升级族（旧档缺省全 false）
    const pu = player.permanentUpgrades;
    if (pu) {
      if (pu.extraAccessory !== undefined) g.player.inv.extraAccessory = pu.extraAccessory;
      if (pu.usedAegisCrystal !== undefined) g.player.usedAegisCrystal = pu.usedAegisCrystal;
      if (pu.usedAegisFruit !== undefined) g.player.usedAegisFruit = pu.usedAegisFruit;
      if (pu.usedArcaneCrystal !== undefined) g.player.usedArcaneCrystal = pu.usedArcaneCrystal;
      if (pu.usedGalaxyPearl !== undefined) g.player.luckState.usedGalaxyPearl = pu.usedGalaxyPearl;
      if (pu.usedGummyWorm !== undefined) g.player.usedGummyWorm = pu.usedGummyWorm;
      if (pu.usedAmbrosia !== undefined) g.player.usedAmbrosia = pu.usedAmbrosia;
    }
    if (player.baseMaxHp !== undefined) g.player.baseMaxHp = player.baseMaxHp;
    if (player.baseMaxMana !== undefined) g.player.baseMaxMana = player.baseMaxMana;
    if (player.mana !== undefined) g.player.mana = player.mana;
    // 背包布局迁移（旧 54 槽自创布局 → 原版 58 槽+armor[20]；Inventory.migrateLegacy 判别）
    const mig = Inventory.migrateLegacy(player.inventory);
    g.player.inv.slots = mig.slots;
    if (player.armor) g.player.inv.armor = player.armor.map((it) => it ? { ...it } : null);
    if (player.dye) g.player.inv.dye = player.dye.map((it) => it ? { ...it } : null);
    if (player.trash) g.player.inv.trash = { ...player.trash };
    // 杂项装备/染料 + 三套 Loadout 回填（旧档缺省全空）
    if (player.miscEquips) g.player.inv.miscEquips = player.miscEquips.map((it) => it ? { ...it } : null);
    if (player.miscDyes) g.player.inv.miscDyes = player.miscDyes.map((it) => it ? { ...it } : null);
    if (player.loadouts) {
      for (let k = 0; k < 3; k++) {
        const src = player.loadouts[k];
        if (!src) continue;
        g.player.inv.loadouts[k] = {
          armor: src.armor.map((it) => it ? { ...it } : null),
          dye: src.dye.map((it) => it ? { ...it } : null),
          hide: src.hide ? [...src.hide] : Array(10).fill(false),   // R4-12（旧档缺省 false）
        };
      }
    }
    // 装备族栈消毒（旧档可携带多叠装备——两次入槽门修复前产生；钳 1）
    Inventory.sanitizeEquipStacks(g.player.inv);
    if (player.currentLoadout !== undefined) g.player.inv.currentLoadout = player.currentLoadout;
    g.player.inv.selected = player.selected;
    // 玩家储物×4 回填（29/97/463/491；旧档缺省全空）
    if (player.banks) {
      for (let b = 0; b < 4; b++) {
        const src = player.banks[b] ?? [];
        g.player.banks[b] = src.concat(Array(Math.max(0, 40 - src.length)).fill(null)).slice(0, 40);
      }
    }
    // Buff 槽（PL:53913-53925;Main.buffNoSave 已在序列化侧过滤）
    g.player.buffs.applySaved(player.buffs);
    if (player.taxMoney !== undefined) g.player.taxMoney = player.taxMoney;   // PL:53839
    if (player.golferScoreAccumulated) g.player.golferScoreAccumulated = player.golferScoreAccumulated; // PL:1792
    if (player.deathsPve !== undefined) g.player.deathsPve = player.deathsPve; // PL:53840
    // ★R16-14：PvP 死亡计数/队伍/死亡态+重生计时回填（PL:55444/55411/55558-55562;
    //  旧档缺省 undefined=原版缺省值 0/0/false/0）
    if (player.deathsPvp !== undefined) g.player.deathsPvp = player.deathsPvp;
    if (player.team !== undefined) g.player.team = player.team;
    if (player.dead !== undefined) g.player.dead = player.dead;
    if (player.respawnTimer !== undefined) g.player.respawnTimer = player.respawnTimer;
    if (player.anglerQuestsFinished !== undefined) g.player.anglerQuestsFinished = player.anglerQuestsFinished; // PL:1790
    // 旅程力量·玩家侧（IPersistentPerPlayerContent）已在 loadSaveData 内合并进
    // world.journeyPowers（SaveFile.ts 统一路径），此处无需重复回填
    if (Array.isArray(player.hideInfo)) g.player.hideInfo = player.hideInfo; // PL:776 hideInfo[13]
    // PL:53813-53819 hideVisibleAccessory[10]（配饰格眼睛开关,旧档缺省全 false）
    if (Array.isArray(player.hideVisibleAccessory)) {
      const hv = new Array<boolean>(10).fill(false);
      for (let i = 0; i < 10 && i < player.hideVisibleAccessory.length; i++) hv[i] = !!player.hideVisibleAccessory[i];
      g.player.hideVisibleAccessory = hv;
    }
    if (player.hairDye !== undefined) g.player.hairDye = player.hairDye;   // PL:53805-53808 发色剂 byte（旧档缺省 0）
    if (player.hbLocked !== undefined) g.player.hbLocked = player.hbLocked;               // SW-FX10 债⑪:PL:56268 读
    if (player.enabledSuperCart !== undefined) g.player.enabledSuperCart = player.enabledSuperCart;  // SW-FX10 债⑩:PL:56368 位[1] 读
    // ★SW-FX19：建筑配件开关位回填（PL:56306-56325 读——旧档/缺省=ResetData 形）
    if (Array.isArray(player.builderAccStatus)) {
      const ba = builderAccDefaults();
      for (let i = 0; i < 12 && i < player.builderAccStatus.length; i++) {
        ba[i] = player.builderAccStatus[i] | 0;
      }
      g.player.builderAccStatus = ba;
    }
    // ★SW-FX38b：火把神恩宠解锁旗回灌（Player.unlockedBiomeTorches PL:55895 .plr 读/
    //  :55430 写;原版角色字段随身跨世界,本仓消费面 Game.usingBiomeTorches/TorchGod 挂
    //  world.flags）。单调置位（true 才写,不回退）——从无旗角色进已解锁世界不清旗,
    //  与原版「解锁是一次性永久态」同语义（Game.ts:14425 Torch God 事件置位同门）。
    //  存档侧回填见 SaveFile.buildSave playerData.unlockedBiomeTorches。
    if (player.unlockedBiomeTorches) g.world.flags.unlockedBiomeTorches = true;
    // ★BJ285-②：匠师面包吃旗回灌（Player.ateArtisanBread PL:55899 .plr 读/:55433 写;
    //  原版角色字段随身跨世界,本仓消费面=Game 5326 用途支/旅商股票挂 world.flags）。
    //  单调置位（true 才写,不回退）——存档侧回填见 SaveFile.buildSave
    //  playerData.ateArtisanBread。
    if (player.ateArtisanBread) g.world.flags.ateArtisanBread = true;
    // ★ 读档回填后必须刷 UI：HUD 快捷栏在 makeGame 时以空背包画过一次，
    //   此前不刷新 → 存档道具要等用户点工具栏/开背包才显示
    g.cb.onInventoryChanged();
  }

  /** 角色随身态应用(原版 .plr 语义:背包/装备/储物/buff 等便携字段随角色跨世界;
   *  位置不随身——★进世界恒落出生点(Main.cs:6800 Spawn(SpawningIntoWorld)→
   *  FindSpawn :37133,存档位置不用于落点;世界时间随世界档续),新世界同理)。
   *  无角色态(新角色/旧角色未玩过/角色已删)→ 回退世界档内嵌 player。
   *  备案:①联机房间路径只带外观不带随身态(服务器权威库存是独立系统);
   *  ②journeyPowers 字段随态存储但 applyPlayer 不应用(本仓旅程力量落世界档,
   *  与原版 IPersistentPerPlayerContent 逐角色有别);③硬核消亡走外观标记
   *  (hardcoreDead 灰显禁入)而非删档,残留随身态不可达。 */
  async function applyPlayerWithCharacter(g: Game, worldPlayer: ReturnType<typeof loadSaveData>['player'] | null) {
    const cid = charContextId();
    rememberCharId(cid);
    // Journey 研究按玩家档案持久化（原版 creativeTracker 是 Player 字段随 .plr，
    // Player.cs:777/:55569——R24 修复：曾全局单桶跨角色串档；null=无角色上下文
    // 维持旧共享桶，首个加载角色一次性收编旧桶）
    g.research.usePlayerProfile(cid);
    const cs = cid != null ? await charStore.getState(cid) : null;
    // ★位置恒出生点(loadWorld 的 playerAt 已钉出生点,此处取 g.player 保持同值;
    //  曾以世界档内嵌位置为准——原版 .plr 位置不用于进世界落点,2026-08-24 校正)
    const px = g.player.x;
    const py = g.player.y;
    if (cs) {
      applyPlayer(g, { ...playerFromDiskForm(cs), x: px, y: py });
      applyCharJourney(g, cs);
    } else if (cid != null) {
      // 有角色上下文但无随身态(新角色/从未进过世界)=原版全新 .plr——初始铜三件
      // (原版 Player 初始 inventory:短剑 3507/镐 3509/斧 3506),★不回落世界内嵌
      // player(那是上个存档玩家的状态,回落=选新角色继承他人装备,同 bug 族;
      // 2026-08-26 用户实报"角色 B 拿到角色 A 的装备/血量上限")
      // ★SW-BJ87：与 Game.loadWorld 同源单点——grantStarterKit 逐槽直置（vanilla 锚
      //   UICharacterCreation.cs:1749-1756 见 Game.ts 头注），不再手写三行
      //   ★BJ91 2026-09-15（BJ87 登记债 B）：difficulty 入参随角色——旅程角色（==3）
      //   走旅程支大礼包（UICharacterCreation.cs:1720-1747）；selectedAppearance=
      //   建号外观权威（applyAppearance 落位前后皆可读）。
      grantStarterKit(g.player.inv, selectedAppearance?.difficulty ?? g.player.appearance?.difficulty ?? 0);
      g.player.baseMaxHp = 100; g.player.baseMaxMana = 20;
      g.player.hp = 100; g.player.mana = 20;
      g.cb.onInventoryChanged();
    } else if (worldPlayer) {
      applyPlayer(g, { ...worldPlayer, x: px, y: py });
    }
  }

  /** 角色随身态·玩家侧旅程力量（IPersistentPerPlayerContent 语义补齐）：
   *  上帝模式/扩大放置/刷怪率滑杆随角色走——运行时同存 World.journeyPowers
   *  （JourneyPowers.ts 头注设计位）,存档侧已落 player 段,读侧在此回填 */
  function applyCharJourney(g: Game, cs: ReturnType<typeof loadSaveData>['player']): void {
    const jp = cs.journeyPowers;
    if (!jp) return;
    const w = g.world.journeyPowers;
    if (jp.godmode !== undefined) w.godmode = jp.godmode;
    if (jp.farPlacementRange !== undefined) w.farPlacementRange = jp.farPlacementRange;
    if (jp.spawnRateSlider !== undefined) w.spawnRateSlider = jp.spawnRateSlider;
  }

  /** 旧档无 header.difficulty（本次修复前创建的专家/大师世界）→ 以槽位
   *  WorldMeta.difficulty 回填 world.difficulty；新档以 header 为权威跳过 */
  let difficultyFallback: number | null = null;
  /** 原版 loadWorld 进度文案(WorldFile.cs):tiles=gen[51] "正在加载世界数据: X%"
   *  按列(:2514-2518);settle=gen[27] "正在安置液体 X%" 收敛比例 50-100%(:762);
   *  其余阶段保持自定义 LoadingSave */
  function loadProgressLabel(phase: string, rawP: number): string {
    const p = Number.isFinite(rawP) ? rawP : 0;   // NaN 防御(worker 瞬断/旧缓存事件)
    if (phase === 'tiles') {
      return Lang.text('LegacyWorldGen.51') + ' ' + Math.min(100, Math.floor(p * 100) + 1) + '%';
    }
    if (phase === 'settle') {
      return Lang.text('LegacyWorldGen.27') + ' ' + Math.min(100, Math.floor(50 + p * 50)) + '%';
    }
    return Lang.text('Mods.SandboxWorld.Progress.LoadingSave');
  }

  function applyDifficultyFallback(world: import('./world/World').World, save?: { header?: { difficulty?: number } }) {
    if (difficultyFallback == null || save?.header?.difficulty !== undefined) return;
    world.difficulty = difficultyFallback;
  }

  /** 按 IDB key 读档：主路径 worker 内直读 IDB（免大 JSON 字符串结构化克隆到
   *  worker 的主线程序列化开销——大存档实测秒级 100% CPU）；worker 不可用时
   *  才在主线程走文本择源 fallback（★BJ617 件2 resolveLoadText：IDB→FS 备份→LS 副本）。
   *  ★防重入门(2026-09-07):大世界读档链路含多个 await 窗口(worker 往返/
   *  charStore/资源预热),双触发(双击 Play/探针事件重复)=两条链并行——第二链
   *  makeGame() 重置全局 while 第一链仍引用旧 g,第一链恢复后 g.player 未建即
   *  被 applyPlayer 访问(TypeError: reading 'inv',探针实测)。读档期间拒绝
   *  二次进入,重入静默返回(加载页已在前一链手上)。 */
  let loadFlowBusy = false;
  async function loadFromKey(key: string, opts?: { backToList?: boolean }) {
    if (loadFlowBusy) return;
    loadFlowBusy = true;
    // ★BJ704-G7 件1：单人读档（槽位/quicksave）即新会话——联机建房绑定作废
    //  （防 MP 会话后 quickLoad 携陈旧绑定误记/误写槽位）。
    joinRoomWorldId = null;
    // ★BJ617 件1：载入会话锁（世界锁 world-lock.<id>+角色锁 char-lock.<id>）——
    //  他 tab 会话在途=拒载+toast;quicksave 键无槽位 id 可反解 → 只走角色锁
    //  （quickload 会话 slotMeta=null 不写世界槽位,无世界互踩面）;unsupported=
    //  降级放行（用户接受面,SessionLock 登记）。
    //  ★2026-10-13 UX（用户实报「进世界失败停在空界面只能刷新」）：世界列表路径
    //  （backToList）失败即回世界列表——面板在 onPlay 前已 close,不回退=裸背景
    //  死态;quickload 等其他入口维持原状（标题屏在场,非死态）。
    heldSessionLocks?.release();   // 防御：上一会话清理残留（正常路径 quitToMenu 已清）
    heldSessionLocks = null;
    const backToList = (): void => { if (opts?.backToList) showWorldSelect(); };
    const lockTake = await acquireLoadSessionLocks(key);
    if (!lockTake.ok) {
      loadFlowBusy = false;
      currentWorld = null;   // ★BJ704-G7 件1：会话未开始（同会话锁释放语义）——绑定清零防后续 quickLoad 会话误写该槽
      ui.toast(Lang.text(lockTake.which === 'world'
        ? 'Mods.SandboxWorld.Toast.WorldLockedByOtherTab'
        : 'Mods.SandboxWorld.Toast.CharLockedByOtherTab'));
      backToList();
      return;
    }
    heldSessionLocks = lockTake.held;
    // ★BJ605（2026-10-10 线上事故）：worker 报「存档数据缺失」的分类
    //  （null = WorldGenUnavailable 来路或无分类——toast 走原语义文案）
    let saveMissing: SaveMissingReason | null = null;
    // ★IIIII229（④ 218 章遗留）：读档路 lockBG 接线——vanilla Main.cs:20056-20065
    //   `gameMenu && WorldGen.isGeneratingOrLoadingWorld → lockMenuBGChange=true`
    //   每帧恒置,语义含**读档**（218 批只接了创建流）;loadWorldFlow/loadFromKey/
    //   loadFromJson/importWld 四路全在此补齐（成败同途解锁,与 createWorldFlow
    //   finally 模式一致——背景组重掷在读档期同样冻结）。
    menuBg?.setBGLock(true);
    try {
      startAssetPrewarm();   // #perf2026-08-28:与读档 worker 并行,勿占菜单期表面预算
      // worker 路径：IDB 读取 + JSON 解析 + RLE 解码 + load 模式沉降全在后台
      const client = await sharedGenClient();
      if (await client.probe()) {
        try {
          // ★与创建世界同款 VUI 加载页(原版风 UIWorldLoadState;用户报"读档 UI 还是旧的")
          const loadState = new UIWorldLoadState();
          VUI.setState(loadState);
          // ★BJ336 件1：读档硬超时按世界面积扩面（同 BJ331 worldGenTimeoutMs 同式）。
          //  key 路径客户端无档内容可窥（档体由 worker 内直读 IDB）——尺寸取世界槽位
          //  meta（sandboxworld.world.<id> 键可反解 id;quicksave/异形键无 meta → undefined
          //  回退 worker 客户端 180s 缺省）。meta.w/h 与档内容同源（register 时写定）。
          await worldStore.ensureLoaded();
          const keyMeta = /^sandboxworld\.world\.(\d+)$/.exec(key ?? '');
          const meta = keyMeta
            ? worldStore.list().find((m) => m.id === Number(keyMeta[1]))
            : undefined;
          const { world, player, save } = await client.loadSave({ key }, {
            // ★BJ702 件5（旁获缺陷）:onEvent 以 4 参回调 (phase,label,p,local)（Game
            //  generate 侧 Game.ts 同款 4 参解构）——旧 lambda (phase,p) 把 label
            //  绑给 p,Number.isFinite(字符串)=false → 进度条全程钉 0%+文案钉死。
            onProgress: (phase, _label, p) => loadState.setProgress(loadProgressLabel(phase, p), p),
            ...(meta ? { timeoutMs: worldGenTimeoutMs(meta.w, meta.h) } : {}),
          });
          const g = makeGame();
          await ensureCharAppearanceFiles();   // 角色贴图就绪再进世界（2026-08-28）
          applyDifficultyFallback(world, save as { header?: { difficulty?: number } } | undefined);
          // ★进世界恒出生点(Main.cs:6800 Spawn(SpawningIntoWorld),存档位置不用于落点)
          await g.loadWorld(world, (label, p) => loadState.setProgress(label, 0.8 + p * 0.2), { settled: true, playerAt: { x: world.spawnX * 16, y: world.spawnY * 16 } });
          restoreModTEs(world.store, (save as { teMods?: import('./save/serialize').ModTESaveEntry[] } | undefined)?.teMods);   // ★R-C-F2:worker 域注册表空,主线程回填 TE 实例
          warnMissingMods();   // ★R-C-F5:缺 mod 存档警告 toast(消费 __swMissingModsWarn)
          absorbLoadedPlayMs(save);   // SW-BJ5 2026-09-07：须在 g.loadWorld(触发 enterGame 计费锚)之后,否则 quickLoad 无槽位会话的吸合基线被 start(0) 覆写
          await applyPlayerWithCharacter(g, player as ReturnType<typeof loadSaveData>['player']);
          g.eventsApplySave((save as { events?: never } | undefined)?.events as never);
          return;
        } catch (e) {
          // ★BJ605 catch 判别重构（修复前只放行 WorldGenUnavailable——「存档数据缺失」
          //  被 re-throw 拦死，主线程 fallback 永不可达；★BJ617 件2 后 fallback=
          //  resolveLoadText 三段择源 IDB→FS 备份→LS 副本）：
          //  ①「存档数据缺失」族（worker 分类 idbUnavailable/keyMissing/typeMismatch/
          //    jsonParseFailed——数据面缺口）→ 走主线程择源 fallback（LS 兜底副本救援：
          //    双写时代历史副本；★BJ615 单写后新档只在 IDB。三源皆无才报错）；
          //  ②WorldGenUnavailable（worker 全不可用）→ 原语义走 fallback；
          //  ③其余（loadSaveData 内部解析崩等）fallback 救不了 → 保持 re-throw
          //    走外层 alert 原文案（不吞）。
          saveMissing = parseSaveMissingReason((e as Error | undefined)?.message);
          if (saveMissing) {
            console.warn('[load] worker 报存档数据缺失 → 主线程择源 fallback（FS 备份/LS 副本救援）', (e as Error | undefined)?.message);
          } else if (!(e instanceof (await import('./workers/WorldGenClient')).WorldGenUnavailable)) throw e;
          // worker 失败/存档数据缺失 → 主线程 fallback
        }
      }
      // ★BJ617 件2（BJ616 F2 读序倒挂修复）：读档文本三段择源 resolveLoadText——
      //  ① IDB 现值恒权威直返（健康档绝不咨询 FS——备份回写不得倒灌现值）;
      //  ② IDB miss → FS 备份优先于 LS 兜底副本。旧实现 kvGet 非空即短路恢复链——
      //     双写时代 LS 陈旧副本抢先,用户静默载入旧档（可能远旧于 FS 备份）,再存档
      //     =进度回滚坐实。择新依据：LS 副本冻结于 BJ615 单写升级时点≈很久以前,
      //     FS 备份=BJ614 后每保存刷新=几乎恒新;两版皆无内嵌保存时间戳可比。
      //  ③ FS 恢复链失败 → LS 兜底副本（诚实标注「较旧副本」,仅限有备份面的键;
      //     ★BJ618 件3 起 quicksave 亦有备份面 quicksave.json,同样作陈旧宣称）。
      //  ④ 三源皆空=missing（prompt 授权提示+IDB 态诊断+缺失分类文案,原语义）。
      let resolved = await resolveLoadText(key, () => lsGetSafe(key));   // ★R13-F2：裸 localStorage 直读随 LS 抛（隐私模式）炸读档链——原语层安全垫收口
      // ★BJ655：prompt=句柄在但权限回落会话级（BJ614 登记债:普通标签页每新会话
      //  'prompt',安装态 PWA 除外）。本链由读档点击触发（transient activation 在手;
      //  键盘触发 quickLoad 同为手势;程序化入口无手势=SecurityError→catch 静默）,
      //  在该手势链内当场申请授权——MDN/Chrome 官方（2026-10-12 亲读定谳）：
      //  requestPermission「只能由用户手势触发」「需 transient activation,无手势
      //  SecurityError 拒绝」;链内既有 await（worker 解析/IDB 读）非 activation
      //  消耗型 API 且时长≪5s 窗口。授予 → 重跑择源（FS 备份恢复+备份链当场激活,
      //  设置页状态订阅面同步）;未授/拒绝 → 静默落 missing 面（提示面=设置页
      //  「待重新授权」状态行+按钮,主流程零 toast——BJ655 用户实报收敛）。
      if (resolved.source === 'missing' && resolved.restoreReason === 'prompt'
        && await fsBackupRequestPermission()) {
        resolved = await resolveLoadText(key, () => lsGetSafe(key));
      }
      if (resolved.source === 'fs-backup') {
        // ★BJ614 用户明令「IndexedDB 中找不到要从备份取」：最新同键快照已写回 IDB
        //  （自愈,下次读直命中）→ 以恢复文本续正常读档链 loadFromJson（零旁路;
        //  恢复档诚实标注「可能落后于最后状态」）;prompt 态不强弹（resolveLoadText
        //  仅在真缺 restoreFromBackup 咨询,prompt 随 missing 分支补提示）。
        ui.toast(Lang.text('Mods.SandboxWorld.Toast.FsBackupRestored', resolved.file));   // 文件名进 {0} 槽（onRestoreMiss 恢复链 :338 同款）
        if (!(await loadFromJson(resolved.text))) currentWorld = null;   // ★BJ704-G7 件1：内吞失败同清绑定
        return;
      }
      if (resolved.source === 'ls-fallback') {
        if (backupTargetOfKey(key)) ui.toast(Lang.text('Mods.SandboxWorld.Toast.LoadStaleLocalCopy'));
        if (!(await loadFromJson(resolved.text))) currentWorld = null;   // ★BJ704-G7 件1：同上
        return;
      }
      if (resolved.source === 'missing') {
        heldSessionLocks?.release();   // ★BJ617 件1：载入失败=会话未开始,会话锁即释
        heldSessionLocks = null;
        currentWorld = null;   // ★BJ704-G7 件1：同上——绑定清零
        // ★BJ655：prompt 已在手势链内尝试过 requestPermission（授予则不会落此支）,
        //  此处零 toast——授权状态提示面=设置页「待重新授权」+按钮（常驻,不强弹）。
        // ★BJ605：IDB+FS+LS 三处皆无——IDB 态诊断物证留 console（用户自查/
        //  DevTools 物证请求共同依赖），文案按缺失分类给可操作指引
        //  （存储不可用引导自救 vs 数据真缺失如实告知不可恢复）；
        //  saveMissing=null（WorldGenUnavailable 来路）→ 原语义 SaveLoadFailed 文案。
        void kvIdbStatus(key).then((s) => console.warn('[load] IDB 态诊断', key, s));
        ui.toast(Lang.text(saveMissingToastKey(saveMissing), '存档数据缺失'));
        backToList();   // ★2026-10-13 UX:同锁拒绝——回世界列表防裸背景死态
        return;
      }
      if (!(await loadFromJson(resolved.text))) currentWorld = null;   // 'idb'：健康直读;★BJ704-G7 件1：内吞失败同清绑定
    } catch (e) {
      heldSessionLocks?.release();   // ★BJ617 件1：载入失败（alert 面）=会话未开始,会话锁即释
      heldSessionLocks = null;
      currentWorld = null;   // ★BJ704-G7 件1：同上——绑定清零
      console.error(e);
      ui.hideProgress();
      VUI.setState(null);   // 加载页退场(失败回菜单)
      // ★BJ318（2026-09-23 用户实报「Array buffer allocation failed」）：OOM 族错误
      //  上抛为可操作自救文案（原始技术消息留 console.error——上行的开发排查面不动）
      alert(isOomLoadError(String((e as Error)?.message ?? e))
        ? Lang.text('Mods.SandboxWorld.Toast.LoadOom')
        : Lang.text('Mods.SandboxWorld.Toast.SaveLoadFailed', (e as Error).message));
      backToList();   // ★2026-10-13 UX:异常路径同回世界列表(alert 关闭后裸背景死态同治)
    } finally {
      loadFlowBusy = false;
      menuBg?.setBGLock(false);   // ★IIIII229 ④：读档收场解锁（嵌套 loadFromJson 双解锁幂等）
    }
  }

  /** 返回=成功进世界 true / 失败（内部 alert 已发）false——★BJ704-G7 件1：
   *  loadFromKey 据此在失败时清 currentWorld 会话绑定（loadFromJson 自吞 catch,
   *  调用方此前不可见成败=陈旧绑定面）。 */
  async function loadFromJson(text: string): Promise<boolean> {
    // ★IIIII229（④ 218 章遗留）：读档路 lockBG（Main.cs:20056-20065 isGeneratingOrLoadingWorld
    //   含读档;独立入口（quickLoad/import 兜底）自锁自解,经 loadFromKey 调入时双层
    //   锁/解幂等无害）。
    menuBg?.setBGLock(true);
    try {
      startAssetPrewarm();   // #perf2026-08-28:同 loadFromKey
      // worker 路径：JSON 解析 + RLE 解码 + load 模式沉降全在后台（json 源传入）
      // 加载分段标尺（perf mark，F5 报告/探针经 performance.getEntriesByType 读取）
      const __m = (n: string) => { try { performance.mark(n); } catch { /* 非浏览器环境 */ } };
      __m('load.begin');
      __m('load.prewarm.begin');
      const client = await sharedGenClient();
      __m('load.clientReady');
      if (await client.probe()) {
        try {
          const loadState = new UIWorldLoadState();
          VUI.setState(loadState);
          __m('load.roundtrip.begin');
          // ★BJ336 件1：json 路径客户端持有档全文——头部有界窥取 meta.w/h（★BJ341
          //  键名锚修正：真实头键=width/height（serialize.ts:505 投影），落盘序固定
          //  format,version,header{name,seed,width,height,…}；字符串内引号必转义⇒
          //  首个命中即真头），按面积扩面硬超时（同 worldGenTimeoutMs 同式）；窥取
          //  失败回退 180s 缺省。
          const dims = peekSaveDims(text);
          const { world, player, save } = await client.loadSave({ json: text }, {
            onProgress: (phase, _label, p) => loadState.setProgress(loadProgressLabel(phase, p), p),   // ★BJ702 件5:同 loadFromKey(4 参契约,旧双参把 label 绑给 p=进度条钉 0%)
            ...(dims ? { timeoutMs: worldGenTimeoutMs(dims.w, dims.h) } : {}),
          });
          __m('load.roundtrip.end');
          const g = makeGame();
          await ensureCharAppearanceFiles();   // 角色贴图就绪再进世界（2026-08-28）
          __m('load.makeGame.done');
          applyDifficultyFallback(world, save as { header?: { difficulty?: number } } | undefined);
          // ★进世界恒出生点(Main.cs:6800 Spawn(SpawningIntoWorld),存档位置不用于落点)
          await g.loadWorld(world, (label, p) => loadState.setProgress(label, 0.8 + p * 0.2), { settled: true, playerAt: { x: world.spawnX * 16, y: world.spawnY * 16 } });
          __m('load.loadWorld.done');
          restoreModTEs(world.store, (save as { teMods?: import('./save/serialize').ModTESaveEntry[] } | undefined)?.teMods);   // ★R-C-F2:同 loadFromKey(worker 域注册表空=主线程回填)
          warnMissingMods();   // ★R-C-F5
          absorbLoadedPlayMs(save);   // SW-BJ5 2026-09-07：同 loadFromKey——计费锚(enterGame)之后吸合存档头基线
          await applyPlayerWithCharacter(g, player as ReturnType<typeof loadSaveData>['player']);
          __m('load.player.done');
          g.eventsApplySave((save as { events?: never } | undefined)?.events as never);
          __m('load.end');
          try {
            const e = performance.getEntriesByType('mark').filter((m2) => m2.name.startsWith('load.'));
            for (let i2 = 1; i2 < e.length; i2++)
              console.log(`[load] ${e[i2].name.slice(5)} +${Math.round((e[i2].startTime - e[i2 - 1].startTime))}ms`);
          } catch { /* 只读诊断 */ }
          return true;
        } catch (e) {
          if (!(e instanceof (await import('./workers/WorldGenClient')).WorldGenUnavailable)) throw e;
          // worker 失败 → 主线程 fallback
        }
      }
      // ★BJ336 件1：主线程同步读档回退无看门狗（同线程冻结期任何计时器不可达）——
      //  最小安全网=进点提示（parse/RLE/沉降逐列让帧进度照走,Esc 链不覆盖读档）。
      console.warn('[load] worker 不可用 → 主线程同步读档回退（JSON 解析+RLE+沉降全程主线程,大世界可能数十秒卡顿）');
      const { world, player, data } = loadSave(text);
      applyDifficultyFallback(world, data);
      const g = makeGame();
      await ensureCharAppearanceFiles();   // 角色贴图就绪再进世界（2026-08-28）
      const loadState = new UIWorldLoadState();
      VUI.setState(loadState);
      loadState.setProgress(Lang.text('Mods.SandboxWorld.Progress.LoadingSave'), 0.3);
      await g.loadWorld(world, (label, p) => loadState.setProgress(label, 0.3 + p * 0.6));
      absorbLoadedPlayMs(data);   // SW-BJ5 2026-09-07：主线程回退路径同 worker 路径（data=全量 SaveData,含 header.playTimeMs）
      await applyPlayerWithCharacter(g, player);
      g.eventsApplySave(data.events);
      return true;
    } catch (e) {
      console.error(e);
      ui.hideProgress();
      VUI.setState(null);   // 加载页退场(失败回菜单)
      // ★BJ318（2026-09-23 用户实报「Array buffer allocation failed」）：OOM 族错误
      //  上抛为可操作自救文案（原始技术消息留 console.error——上行的开发排查面不动）
      alert(isOomLoadError(String((e as Error)?.message ?? e))
        ? Lang.text('Mods.SandboxWorld.Toast.LoadOom')
        : Lang.text('Mods.SandboxWorld.Toast.SaveLoadFailed', (e as Error).message));
      return false;   // ★BJ704-G7 件1：内吞失败上抛给调用方（loadFromKey 清绑定用）
    } finally {
      menuBg?.setBGLock(false);   // ★IIIII229 ④：读档收场解锁（成败同途）
    }
  }

  /** 世界名去重（导入/注册共用）：撞名追加 " (2)"、" (3)"… */
  function dedupeWorldName(name: string): string {
    const names = new Set(worldStore.list().map((m) => m.name));
    if (!names.has(name)) return name;
    let i = 2;
    while (names.has(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  /** 世界列表「导入世界」：.wld / 本仓 .json → 只解析落库进列表,不进入世界
   *  （2026-08-27 用户要求;与 importWld 的进世界路径不同,本路径不过 Game——
   *  parseWldToSave 产物 SaveData 经 JSON.stringify 即存储格式,loadSave =
   *  loadSaveData(JSON.parse(json)) 无损回读）。
   *  ★解析/校验/序列化全走 save.worker(2026-08-27 用户报「导入卡住 UI」:
   *  parseWldToSave 主线程同步数秒级,大档 JSON.parse 亦数百 ms)——worker 不可用
   *  内部自动回退主线程同步路径,调用面不变 */
  async function importWorldFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    try {
      await worldStore.ensureLoaded();
      if (lower.endsWith('.json')) {
        const text = await file.text();
        const info = await saveClient.inspectSave(text);
        if (!info.ok || !info.meta) {
          throw new Error(Lang.text('Mods.SandboxWorld.Toast.ImportBadFormat'));
        }
        const m = info.meta;
        const meta = await worldStore.importSlot({
          name: dedupeWorldName(m.name || file.name.replace(/\.json$/i, '')),
          seed: m.seed,
          w: m.w, h: m.h,
          difficulty: m.difficulty,
          evil: m.evil,
          hardMode: m.hardMode,
        }, text, m.playTimeMs);   // SW-BJ5 2026-09-07：存档头累计随数据落库（缺省 0）
        ui.toast(Lang.text('Mods.SandboxWorld.Toast.WorldImported', meta.name));
      } else if (lower.endsWith('.wld')) {
        const buf = new Uint8Array(await file.arrayBuffer());
        saveClient.ensure();
        const r = await saveClient.importWld(buf);
        const meta = await worldStore.importSlot({
          name: dedupeWorldName(r.meta.name || file.name.replace(/\.wld$/i, '')),
          seed: r.meta.seedText || String(r.meta.seedNum ?? ''),
          w: r.meta.w, h: r.meta.h,
          difficulty: r.meta.gameMode,
          evil: r.meta.evil,
          // wld header 无 hardMode 位（进世界路径读的是已载 world.flags）——导入态
          // 缺省=非困难,首次进世界存档时随 meta 原地刷新
          hardMode: false,
        }, r.json);
        ui.toast(Lang.text('Mods.SandboxWorld.Toast.WorldImported', meta.name));
      } else {
        ui.toast(Lang.text('Mods.SandboxWorld.Toast.ImportBadExt'));
      }
    } catch (e) {
      console.error(e);
      // ★BJ605：WorldSaveWriteError=浏览器存储写入失败（importSlot 数据未落库、
      //  幽灵槽已回滚）——可操作自救文案，不吃进 ImportFailed 技术插值
      ui.toast(e instanceof WorldSaveWriteError
        ? Lang.text('Mods.SandboxWorld.Toast.SaveWriteFailed')
        : Lang.text('Mods.SandboxWorld.Toast.ImportFailed', (e as Error).message));
    }
  }

  async function importWld(buf: Uint8Array) {
    menuBg?.setBGLock(true);   // ★IIIII229 ④：读档路 lockBG（本路进世界,同 Main.cs:20056 语义）
    await startAssetPrewarm();   // #perf2026-08-28:同 loadFromKey(wld 转换/沉降段并行)
    // ★宏任务让路:parseWldToSave 同步重活+makeGame 构造必须与预热定时器分 task
    await new Promise((r) => setTimeout(r, 0));
    ui.showProgress(Lang.text('Mods.SandboxWorld.Progress.ParsingWld'), 0.1);
    try {
      const { save, report, seedText, gameMode } = parseWldToSave(buf);
      (window as unknown as { __lastCompatReport?: unknown }).__lastCompatReport = report;
      ui.showProgress(Lang.text('Mods.SandboxWorld.Progress.ConvertingWld'), 0.7);
      const g = makeGame();
      // 直接消费内存 SaveData(2026-08 审计 #3:此前的 stringify→parse 双拷贝
      // 每次导入多出 2×20~50MB 峰值,且让 5 份全图副本并存更久)
      const { world } = loadSaveData(save);
      await g.loadWorld(world, (label, p) => ui.showProgress(label, 0.7 + p * 0.3));
      // ★SW-BJ87：三件套逐槽直置（UICharacterCreation.cs:1749-1756 经典支 =
      //   热键区 [0]短剑/[1]镐/[2]斧；1458:1751-1755 同锚）——曾走 inv.add 落背包尾
      //   （useStyle 缺数据→热栏臂不可达→降序臂，同 Game.loadWorld 面,见
      //   grantStarterKit 头注）。火把 20=导入档补济（非原版经典开局件），保留路由。
      //   ★BJ91 2026-09-15：difficulty 随选中角色（旅程档走旅程支大礼包,同源语义）。
      grantStarterKit(g.player.inv, selectedAppearance?.difficulty ?? g.player.appearance?.difficulty ?? 0);
      g.player.inv.add(ITEM_BY_KEY[VI_KEY.TORCH], 20);
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.WldImported', save.header.name ?? '', save.header.wldVersion ?? 0));
      // 登记世界槽位并持久化：导入不再是一次性的，重进游戏可在世界列表中看到并继续游玩
      await worldStore.ensureLoaded();
      currentWorld = await worldStore.register({
        name: dedupeWorldName(save.header.name), seed: seedText || String(save.header.seed),
        w: save.header.width, h: save.header.height,
        difficulty: gameMode, evil: save.header.crimson ? 1 : 0,
        hardMode: !!(game?.world.flags.hardMode),   // 导入档 header 无此字段,读已载世界(空档兜 false)
      });
      doSave();
      // 兼容报告：有降级/跳过内容时弹窗
      const rpt = (window as unknown as { __lastCompatReport?: import('./ui/UI').CompatReport }).__lastCompatReport;
      if (rpt && (rpt.tilesDegraded.length || rpt.tilesCleared.length || rpt.itemsSkipped.length)) {
        ui.showCompatReport(rpt);
      }
    } catch (e) {
      console.error(e);
      ui.hideProgress();
      alert(Lang.text('Mods.SandboxWorld.Toast.WldImportFailed', (e as Error).message));
    } finally {
      menuBg?.setBGLock(false);   // ★IIIII229 ④：导入收场解锁
    }
  }

  // ---- 菜单 ----

  /** 帧回调注入 VUI 自愈循环（VUI.startLoop 持有 rAF，HMR 杀不死） */
  // ★债A（2026-10-05，「标题期 rAF 不封顶」登记债清偿）：标题态菜单背景 tick 网页端
  //  钳 60fps。定谳=VUI 循环的 frameCap 门（2026-08-29）只在 cap>0 时生效且跟随用户
  //  档——frameCap=0（解锁 vsync 桌面壳/逃生门档）实测标题期 menuBg.tick 585/s、
  //  折算渲染 CPU 76% 单核（探针 _debtab-title-cap-baseline,--disable-frame-rate-limit
  //  合成环境;云/星/菜单背景每拍 ~1.3ms 全在主线程）;cap=120 档同样 135/s 超菜单
  //  所需。菜单动画 60fps 足够（原版本相=60fps 定帧）,钳制只节流步进频次。
  //  平台区分=desktop-shell UNCAPPED rAF 判例：sandboxDesktop.isShell 恒不钳（桌面
  //  壳行为逐字节不变）;?menutickcap=0 逃生门回旧自由步进。
  //  语义=dt 累计器+墙钟门双轨：acc 逐拍累加（被跳帧的 dt 不丢）,墙钟距上次步进
  //  ≥阈值才消费——门判据取墙钟而非 acc 阈值,对 VUI 侧 dt 块尺寸不变（cap=120 档
  //  VUI dt≈7.3ms 块,acc 阈值判据会 3 块并 1 拍=45/s 错拍;墙钟门恒 ~70/s 上限）。
  //  菜单时钟/坠星/云漂全按 dt 折算（tick 内 frames=min(8,dt/16.7)）,推进速度与
  //  不封顶逐位同,仅步进节流;缺省 frameCap=60 档 VUI dt≈16.7ms 每拍必过=逐字节
  //  零变化。acc 钳 150ms=隐藏页回前台大步防雪崩（tick 内 frames≤8 双保险）;
  //  90Hz 解锁 vsync 环境节流到 45/s（dt 仍真,速度不变,cadence 均匀）。
  //  ★阈值容差取 2.5ms（非 frameCap 门的 -1ms 惯例）：高 rAF 拍网格上 hook 调用
  //  间距 ≈阈值/k,容差不足会拍频锁到 k+1 倍（实测 7.33ms 块×阈值15.17 → 14.8ms
  //  二格差 0.37ms 落空 → 恒 3 格 22ms=45/s;14.17 → 恒 2 格 14.8ms≈68/s）——
  //  离散拍网格上 60fps 只能逼近（45~70/s 带）,dt 恒真故速度无差,仅 cadence 抖动。
  const menuTickCapOn = (() => {
    try {
      if ((window as unknown as { sandboxDesktop?: { isShell?: boolean } }).sandboxDesktop?.isShell) return false;
      // ★2026-10-16 用户实报后提频翻转:浏览器缺省钳 60=保守残留——menuTick 全链
      //  dt 归一（frames=dtMs/(1000/60),速度与频率无关）,钳门只把横滚/云/天体
      //  压成 60Hz 步进（120fps 屏=跳步,与游戏内 interp 前同型体感）;桌面壳早已
      //  放开验证。翻转:缺省每 rAF tick（120fps 平滑）,?menutickcap=1 复刻旧行为。
      return new URLSearchParams(location.search).get('menutickcap') === '1';
    } catch { return false; }
  })();
  const MENU_TICK_MIN_MS = 1000 / 60 - 2.5;
  let menuTickAcc = 0;
  let menuTickLastWall = 0;
  VUI.frameHook = (dt) => {
    const bg = menuBg;
    if (!bg) { menuTickAcc = 0; return; }
    if (!menuTickCapOn) { bg.tick(dt); bg.lastDt = dt; return; }
    const nowMs = performance.now();
    menuTickAcc = Math.min(menuTickAcc + dt, 150);
    if (nowMs - menuTickLastWall < MENU_TICK_MIN_MS) return;
    menuTickLastWall = nowMs;
    const consume = menuTickAcc;
    menuTickAcc = 0;
    bg.tick(consume);
    bg.lastDt = consume;
  };

  function stopMenu() {
    menuBg?.destroy();
    menuBg = null;
    legacyShim?.remove();
    legacyShim = null;
    // 进游戏前清空 VUI（游戏内 UI 走 DOM，生成页仍用 VUI）
    // ★红队 R-C-F1:mod UI 宿主现役时回挂(裸 null 摘宿主=世界重载面板失挂);
    // forceClear=保留原无条件清场语义(无面板时清生成页残帧)
    modUiResync(true);
    VUI.clear();
  }

  /** 加入房间（探针桥 + UI 共用语义）：url = ws://host:port/<房间码>[?token=] */
  async function joinRoom(url: string, hostToken = ''): Promise<void> {
    await makeGame().joinNetGame(url, () => {}, hostToken);
    // 访客随身态(.plr 语义接入,2026-08-19):SSC 未随世界下发时以本地角色态起步
    // ——服务器若已在 onWorldReady 链内应用 SSC(netSSCApplied)则跳过,优先级
    // 服务器权威 > 本地角色态 > 默认新角色。物品消费在非 SSC 房为本地权威语义
    const g = game;
    if (g && !g.netSSCApplied) {
      const cid = charContextId();
      const cs = cid != null ? await charStore.getState(cid) : null;
      if (cs) {
        applyPlayer(g, { ...playerFromDiskForm(cs), x: g.player.x, y: g.player.y });
        applyCharJourney(g, cs);
      }
    }
  }

  /** 探针桥：当前世界序列化后向中央服务器建房（返回 {code, hostToken}）。
   *  v8 rules 透传（serverAuth=true = 服务器权威房,世界由 SimHost 计算,建房者亦为访客） */
  async function createRoom(addr: string, opts: { name?: string; public?: boolean; protectTiles?: boolean; protectItems?: boolean; maxPlayers?: number; rules?: Partial<import('./net/protocol').RoomRules> } = {}): Promise<{ code: string; hostToken: string; gmToken?: string; error?: string }> {
    try {
      if (!game) return { error: 'no game', code: '', hostToken: '' };
      game.finishWorldJobs();   // ★PR-async：房主侧世界快照先收口 job（须在 null 门后——
                                  // 曾在门前行,tsc 18047+无游戏实例时裸崩,2026-09-02 收遗留修）
      const { saveGame } = await import('./save/SaveFile');
      await worldStore.ensureLoaded();
      if (!currentWorld) {
        currentWorld = await worldStore.register({
          name: game.world.name, seed: String(game.world.seed), w: game.world.w, h: game.world.h,
          difficulty: 0, evil: game.world.crimson ? 1 : 0,
          hardMode: !!game.world.flags.hardMode,
        });
      }
      const json = saveGame(game.world, game.player, cumulativePlayMs(), game.townNpcsForSave(), game.eventsForSave(), game.pillarNpcsForSave(), game.pressurePlatesForSave());
      if (currentWorld) currentWorld.hardMode = !!game.world.flags.hardMode;   // 图标 Hallow 前缀随肉山刷新
      await worldStore.save(currentWorld, json, cumulativePlayMs());
      const lobbyPort = addr.includes(':') ? parseInt(addr.split(':')[1], 10) : 7778;
      const host = addr.includes(':') ? addr.split(':')[0] : addr;
      const r = await fetch(`http://${host}:${lobbyPort}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: opts.name ?? game.world.name,
          public: opts.public ?? true,
          protectTiles: !!opts.protectTiles,
          protectItems: !!opts.protectItems,
          maxPlayers: opts.maxPlayers,
          rules: opts.rules,
          save: json,
        }),
      });
      const data = await r.json() as { ok: boolean; code?: string; hostToken?: string; gmToken?: string; error?: string };
      if (!data.ok || !data.code || !data.hostToken) return { error: data.error ?? 'bad response', code: '', hostToken: '' };
      return { code: data.code, hostToken: data.hostToken, gmToken: data.gmToken };
    } catch (e) {
      return { error: String((e as Error).message ?? e), code: '', hostToken: '' };
    }
  }

  function showMultiplayerSelect() {
    ui.closeAll();
    titleMenu?.destroy();
    titleMenu = null;
    let panelRoot: HTMLElement | null = null;
    const closePanel = () => { panelRoot?.remove(); panelRoot = null; };
    const panel = new MultiplayerSelect({
      // v3 房间制：onJoinRoom(url, hostToken[, worldId])——url 含 /<房间码>[?token=];
      // worldId=建房链传入的本机世界槽位 id（★BJ704-G7 件1:联机玩自家世界的
      // playedWorlds 绑定;码入房不传=无绑定不记,见 doSave 注边界声明）
      onJoinRoom: (url, hostToken, worldId) => {
        closePanel();
        joinRoomWorldId = worldId ?? null;   // ★BJ704-G7 件1：每次进房重置（码入房=null）
        ui.showProgress(Lang.text('Mods.SandboxWorld.Progress.Connecting'), 0.1);
        const g = makeGame();
        // 连接前应用选中角色：Hello 的玩家名（加入公告"X已加入。"）需要早于世界数据。
        // ★g.player 要到 loadWorld（世界数据到达）才创建——曾在此直接 g.player.appearance=
        // 踩 undefined 崩溃（生产构建加入房间即卡死）。预置联机名供 Hello 兜底,
        // 外观本体由 onWorldReady 的 applyAppearance 落位（含 resendAppearance 补发）
        if (selectedAppearance) {
          (g as unknown as { pendingJoinName?: string }).pendingJoinName
            = (selectedAppearance as { name?: string }).name;
        }
        g.joinNetGame(url, (label, p) => {
          ui.showProgress(label, 0.1 + p * 0.8);
        }, hostToken).then(() => {
          // loadWorld 内部已 onWorldReady（enterGame 由 makeGame 回调完成）
        }, (e) => {
          joinRoomWorldId = null;   // ★BJ704-G7 件1：进房失败=未游玩,绑定作废
          ui.hideProgress();
          ui.toast(`联机失败：${(e as Error).message}`);
          showTitle();
        });
      },
      onBack: () => { closePanel(); showTitle(); },
      // 创建房间资产链(2026-08-25 用户要求,单人式流程):角色选择 → 世界列表 →
      // 选定世界读存档 JSON → then 继续建房。新建世界暂引导去单人创建(备案:
      // worldStore.register 在进游戏后才登记,无"只建不进"的廉价 API)
      onCreateRoomFlow: (then) => {
        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed; inset:0; z-index:22; overflow-y:auto;';
        root.appendChild(holder);
        panelRoot?.style.setProperty('display', 'none');
        const closeFlow = () => { holder.remove(); panelRoot?.style.removeProperty('display'); };
        const pickWorld = () => {
          new WorldSelectPanel(holder, worldStore, {
            onPlay: (meta) => {
              void worldStore.load(meta).then((json) => {
                closeFlow();
                then(json ?? '', meta.name, meta.id);   // ★BJ704-G7 件1：槽位 id 随链下传（进房 onJoinRoom → playedWorlds 绑定）
              });
            },
            onImport: (file) => importWorldFile(file),   // 导入入本地列表(建房选世界同面)
            onNew: () => { ui.toast(Lang.text('Mods.SandboxWorld.MP.CreateWorldInSingle')); },
            onBack: () => closeFlow(),
          }, activeCharSnapshot());
        };
        new CharSelectPanel(holder, charStore, {
          onPlay: (a, id) => {
            selectedAppearance = a;
            selectedCharId = id ?? null;
            pickWorld();   // 世界列表面板后入=覆盖角色列表(各面板自带全屏底)
          },
          onNew: () => {
            new CharCreation(holder, {
              onCreate: async (a) => {
                // ★BJ618 件2：create 写败抛 CharacterSaveWriteError——catch 面感知失败
                //  不续进世界流程（提示由 onWriteFailData 导出兜底回调发）
                try {
                  const meta = await charStore.create(a);
                  selectedAppearance = a;
                  selectedCharId = meta.id;   // ★新角色立即可用 id——曾置 null,读档时
                  pickWorld();                 // charContextId() 回退 localStorage 上一角色 id → 继承其装备/血量(2026-08-26 用户实报)
                } catch (e) { console.warn('[char] 角色创建落库失败', e); }
              },
              onCancel: () => closeFlow(),
            });
          },
          onBack: () => closeFlow(),
        });
      },
      // 加入/创建前需要角色(2026-08-25 用户要求):复用单人角色列表(CharSelectPanel
      // 覆盖层)——★holder 无底色(与单人进角色列表同观感:游戏背景透出);多人面板
      // 覆盖层期间隐藏(否则透出的是面板),返回时恢复——选完 then() 继续动作
      onNeedCharacter: (then) => {
        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed; inset:0; z-index:22; overflow-y:auto;';
        root.appendChild(holder);
        panelRoot?.style.setProperty('display', 'none');
        const closeHolder = () => {
          holder.remove();
          panelRoot?.style.removeProperty('display');
        };
        new CharSelectPanel(holder, charStore, {
          onPlay: (a, id) => {
            closeHolder();
            selectedAppearance = a;
            selectedCharId = id ?? null;
            then();
          },
          onNew: () => {
            new CharCreation(holder, {
              onCreate: async (a) => {
                // ★BJ618 件2：create 写败抛错——catch 面感知失败不续联机流程
                try {
                  const meta = await charStore.create(a);
                  closeHolder();
                  selectedAppearance = a;
                  selectedCharId = meta.id;   // ★新角色 id 立即可用(曾置 null → 读档回退上一角色 id=串档)
                  then();
                } catch (e) { console.warn('[char] 角色创建落库失败', e); }
              },
              onCancel: () => closeHolder(),
            });
          },
          onBack: () => closeHolder(),
        });
      },
    });
    panelRoot = panel.root;
    root.appendChild(panelRoot);
  }

  function showCharacterSelect() {
    VUI.setState(null);
    VUI.clear();
    titleMenu?.destroy();
    titleMenu = null;
    new CharSelectPanel(root, charStore, {
      onPlay: (a, id) => {
        selectedAppearance = a;
        selectedCharId = id ?? null;
        showWorldSelect();
      },
      onNew: () => {
        new CharCreation(root, {
          onCreate: async (a) => {
            // ★BJ618 件2：create 写败抛错——catch 面感知失败不续流程
            try {
              const meta = await charStore.create(a);
              selectedCharId = meta.id;   // ★同上:新角色 id 立即可用(曾置 null=串档)
              showCharacterSelect();
            } catch (e) { console.warn('[char] 角色创建落库失败', e); }
          },
          onCancel: () => showCharacterSelect(),
        });
      },
      onBack: () => showTitle(),
    });
  }

  /** 世界列表（DOM） */
  function showWorldSelect() {
    VUI.setState(null);
    VUI.clear();
    new WorldSelectPanel(root, worldStore, {
      onPlay: (meta) => void loadWorldFlow(meta),
      onImport: (file) => importWorldFile(file),
      onNew: () => {
        // 世界创建页（DOM）
        VUI.setState(null);
        VUI.clear();
        new WorldCreationPanel(root, {
          onCreate: (cfg) => void createWorldFlow(cfg),
          onCancel: () => showWorldSelect(),
        });
      },
      onBack: () => showCharacterSelect(),
    }, activeCharSnapshot());
  }

  /** 从世界槽位读取并进入游戏（worker 内直读 IDB：免大 JSON 字符串主线程读取
   *  + 结构化克隆双开销；fallback 时 worldStore.load 取回全文走 loadFromJson） */
  async function loadWorldFlow(meta: WorldMeta) {
    currentWorld = meta;
    // ★BJ694→★BJ704-G7 件1（R5 登记债①清偿,2026-10-21）：角色×世界游玩史写入位
    //  【迁出】本函数——旧位在 loadFromKey 之前=「尝试即记」（锁拒/存档缺失/OOM
    //  等失败也记;原版失败路径 playWorldCallBack loadFailed→menuMode 200/201
    //  不存不记,WorldGen.cs:6703-6738 亲读）。新位=doSave 玩家保存链（原版地图档
    //  唯写时点 Player.InternalSaveMap :55691←InternalSavePlayer :55355——玩家保存
    //  才建图,「成功进世界∧至少一次保存」;读档失败=永不达保存链=零记）。
    //  绑定=currentWorld(本函数置)/失败路 loadFromKey 三出口+loadFromJson 假返程
    //  清零。
    // 旧档（无 header.difficulty）以槽位 meta 回填世界难度；finally 清防泄漏到
    // 后续 quickLoad/文件导入路径（那些场景 fallback=null 不生效）
    difficultyFallback = meta.difficulty;
    try {
      await loadFromKey(`sandboxworld.world.${meta.id}`, { backToList: true });   // ★2026-10-13 UX:失败回世界列表
    } finally {
      difficultyFallback = null;
    }
  }

  /** 创建新世界：原版生成页（双进度条+实时地图预览）→ 注册槽位 → 进游戏 */
  async function createWorldFlow(cfg: { name: string; seed: string; w: number; h: number; size: number; difficulty: number; evil: -1 | 0 | 1 }) {
    // ★BJ617 件1：新世界 id 全新注册=无跨 tab 世界争用面（不取世界锁）;角色锁照接
    //  （创建会话同样回写 playerstate——同角色双 tab 互踩面同 loadFromKey）。
    heldSessionLocks?.release();   // 防御：上一会话清理残留（正常路径 quitToMenu 已清）
    heldSessionLocks = null;
    {
      const cid0 = charContextId();
      if (cid0 != null) {
        const c = await acquireSessionLock(charLockKey(cid0));
        if (c === 'busy') {
          ui.toast(Lang.text('Mods.SandboxWorld.Toast.CharLockedByOtherTab'));
          showWorldSelect();   // ★2026-10-13 UX:创建面板已 close→回世界列表防裸背景死态
          return;
        }
        if (c !== 'unsupported') heldSessionLocks = { release: () => c.release() };
      }
    }
    // ★IIIII226 halloweenGen 日期臂（vanilla FinishCreatingWorld UIWorldCreation.cs:984-986
    //   → WorldFileData.SetSeedToRandomWithCurrentEvents WorldFileData.cs:417-425）：种子为空
    //   或特殊种子文本时,现实万圣日期窗（Main.isHalloweenDateNow Main.cs:13313-13327）
    //   ⇒ halloweenGen 启用 + 种子文本前缀 "pumpkinseason|"（gen 期南瓜铺面
    //   pumpkinSeasonArm 与存档 seedText 双消费）；窗外/普通种子原样（零触碰）。
    //   空种子随机推导维持本仓原位（String(Date.now())），vanilla 为 SetSeedToRandom。
    const seedFinal = applyHalloweenSeasonSeed(cfg.seed || String(Date.now()));
    // ★IIIII215b：seedText 下传 → 生成屏彩蛋旗标派生（drunk 乱码/蜜蜂文案/FTW 反写/
    //   十周年 HotPink/醉酒帧闪；UI 层私有 UnifiedRandom,零世界 RNG 耦合）；
    //   genSounds=true → 生成流首尾双 MenuOpen（WorldGen.cs:6541/:6551 1:1）。
    //   读档三路（loadFromKey/quickload/导入）不传 seed → 彩蛋全关（原版加载路径同态）。
    // ★IIIII229 ①：Esc 中止链——onAbort 注入 Game.abortWorldGen（loadState 建立时
    //   Game 尚未 makeGame,惰性闭包取;中止请求经 worker 'abortGen'/主线程直置路由）。
    let abortGame: ReturnType<typeof makeGame> | null = null;
    const loadState = new UIWorldLoadState(cfg.evil, {
      seedText: seedFinal, genSounds: true,
      onAbort: () => abortGame?.abortWorldGen(),
    });
    (window as unknown as { __swGenUi?: UIWorldLoadState }).__swGenUi = loadState; // 探针句柄(同 __swMenuBg 判例)
    VUI.setState(loadState);
    // ★IIIII218 生成屏背景动效接线（CXCI §6② 移交三支）：logo remix 倒置摆动/
    //   drunk 自旋缩没/noTraps 巨石 Logo5,6 → TitleMenu；remix 背景漂移+白昼坠星/
    //   drunk 云型强制+云量 → MenuBackground；lockMenuBGChange=true（WorldGen.cs:11161
    //   生成即置 + Main.cs:20051-20053 生成期每帧恒置——背景组重掷冻结）
    titleMenu?.setGenFlags(loadState.screenFlags);
    menuBg?.setGenFlags(loadState.screenFlags);
    // IIII225：生成期起标题曲随种子切（cs gameMenu 选曲支在生成期同样生效——
    // WorldGen.drunkWorldGen 置位后 gameMenu 仍真）。会话闩同步更新。
    lastGenScreenFlags = loadState.screenFlags;
    audio.play('title', titleStyleMusicId());
    menuLoadDone = true;   // ★IIIII228：标题界面已挂载 = 加载完成带结束（Current 50→51 下次起播生效）
    menuBg?.setBGLock(true);
    // ★宏任务让路(#三开压测批续,与 newWorld 同纪律):makeGame 的 Game ctor 冷兜底
    // buildAssets(~1.2s)必须发生在点击 EventDispatch 之外的独立 task——本函数才是
    // 创建 UI 的真实入口(WorldCreationPanel→flow.onCreate),此前补丁打在 legacy
    // newWorld 上未覆盖此处(t1547 专录 trace 实锤 772-1232ms 派发)
    await startAssetPrewarm();
    const g = abortGame = makeGame();   // ★IIIII229 ① 中止路由目标
    // 生成期预览位图 A/B(?wprev=0,2026-08-28 量化:60 passes × ~20 万像素扫描)
    const wantPreview = (() => {
      try { return new URLSearchParams(location.search).get('wprev') !== '0'; } catch { return true; }
    })();
    try {
      await g.newWorld(seedFinal, cfg.w, cfg.h,
        // ★第三参 local=当前原版 pass 段内 Value（GenProgress；undefined=无短条语义路径）
        (label, p, local) => loadState.setProgress(label ?? undefined, p, local),
        {
          name: cfg.name,
          evil: cfg.evil,
          size: cfg.size as import('./world/World').WorldSize, // 尺寸档 0/1/2（generateWorld 按 SIZE_DIMS 派生 W/H）
          difficulty: cfg.difficulty,   // 世界难度 = Main.GameMode（Main.cs:2677；创建 UI 四档）
          ...(wantPreview ? {
            onWorldPartial: (world) => loadState.attachWorld(world), // 主线程 fallback：列扫描预览
            onPreview: (f) => loadState.attachPreview(f),            // worker 路径：位图预览
          } : {}),
        });
    } catch (e) {
      // ★IIIII229 ①：Esc 中止收场（WorldGenAbortedError 判别,真实生成错误原样上抛）——
      //  世界不登记不落库,生成屏退场回菜单（vanilla 中止后 UIWorldLoad 离场同态）。
      if (e instanceof WorldGenAbortedError) {
        heldSessionLocks?.release();   // ★BJ617 件1：生成中止=会话未开始,会话锁即释
        heldSessionLocks = null;
        VUI.setState(null);
        showTitle();   // 回标题（vanilla Esc 中止→UIWorldLoad 离场→menuMode 0）
        return;
      }
      heldSessionLocks?.release();   // ★BJ617 件1：真实生成错误上抛前放锁（不留孤儿持锁）
      heldSessionLocks = null;
      throw e;
    } finally {
      // ★IIIII218 生成流收场还原（成败同途;vanilla FinishWorldGen → ResetWorldSeedFlags
      //  生成旗清零,此刻生成屏仍在场——与原版时序一致,进世界 TitleMenu 随之销毁）。
      //  lockBG 解锁后当夜/当日不再补掷（MenuBackground tick 锁期两旗恒 true 同态）
      titleMenu?.setGenFlags(null);
      menuBg?.setGenFlags(null);
      menuBg?.setBGLock(false);
    }
    // onWorldReady 已进游戏；登记世界槽位并保存初始数据
    const meta = await worldStore.register({
      name: cfg.name, seed: seedFinal, w: cfg.w, h: cfg.h,
      difficulty: cfg.difficulty, evil: cfg.evil,
    });
    currentWorld = meta;
    // 新世界角色携带（原版 .plr）：已有角色随身态 → 背包/装备/储物/buff 随角色
    // 进入新世界（位置钉回出生点）。无角色态 = 新角色，保持原生初始装备
    {
      const cid = charContextId();
      rememberCharId(cid);
      // ★BJ704-G7 件1：游玩史写入位迁 doSave（与 loadWorldFlow 同改;下方 doSave
      //  首存即记——创建流恒达保存链,行为等价零差）
      const cs = cid != null ? await charStore.getState(cid) : null;
      if (cs) {
        const sx = g.player.x, sy = g.player.y;
        applyPlayer(g, { ...playerFromDiskForm(cs), x: sx, y: sy });
        applyCharJourney(g, cs);   // 旅程力量玩家侧随身（IPersistentPerPlayerContent）
      }
    }
    doSave();
  }

  /** 设置面板（★资源包/数据栏已摘 2026-08-27 用户要求;inGame 语义随之退役） */
  function openSettings(_inGame: boolean) {
    // 已开守卫(2026-08-13 泄露 review):无守卫时暂停菜单里重复点"设置"
    // 叠面板,每层多 1 个 window Esc + 1 个 Lang 订阅
    if (document.querySelector('.sw-set-panel')) return;
    new SettingsPanel(root, {
      onBack: () => { /* 面板自毁 */ },
      // ★SW-FX18 成就页入口（IngameOptions.cs:294 DrawLeftSide(Lang.menu[131]) →
      // IngameFancyUI.OpenAchievements 等价）：世界内用 Game 级成就实例,
      // 主菜单直开设置走菜单级桥；面板叠开,设置面板留在下层（原版 SetState 同层叠）
      onAchievements: () => {
        const g = game;
        if (g) import('./ui/AchievementsUI').then((m) => m.openAchievementsPanel({ achievements: g.achievements, sfx: g.sfx }));
        else openMenuAchievements();
      },
    });
  }

  /** 图鉴面板（UIBestiaryTest 1:1 结构：网格分页/筛选排序/条目卡/完成度条）。
   *  打开期间暂停世界并阻断输入；Esc/E 关闭后恢复先前的暂停/阻断态
   *  （从暂停菜单进入时其面板仍叠在下层，关闭即回暂停菜单）。 */
  function openBestiary() {
    if (document.querySelector('.sw-bst')) return;  // 已开守卫(2026-08-13 泄露 review:叠层累积 Esc 捕获)
    const g = game;
    if (!g) return;
    const wasPaused = g.paused;
    const wasBlocking = g.input.uiBlocking;
    g.paused = true;
    g.input.uiBlocking = true;
    new BestiaryPanel(root, {
      getTracker: () => g.world.bestiary,
      atlas,
      isCrimson: () => g.world.crimson,
      // BJ506：掉落行世界难度门（ItemDropBestiaryInfoElement.ShouldShowItem →
      // CanShowItemDropInUI 的 NotExpert/IsExpert/IsMasterMode 条件语义）
      isExpert: () => g.world.isExpert,
      isMaster: () => g.world.isMaster,
      // ★BJ507 B2：掉落行悬停全量 item tooltip（原版 Main.HoverItem 面——
      //  UIBestiaryInfoItemLine.DrawMouseOver → MouseText item 管线;复用
      //  UI.buildTooltipHtml 单源 BJ407,notes = 掉落条件描述行族）
      showItemTooltip: (itemId, anchor, notes) => ui.showFloatingItemTooltip(itemId, anchor, notes),
      hideItemTooltip: () => ui.hideFloatingItemTooltip(),
      // ★BJ-C4-F3：光标持物谓词（mouseItem 语义=UI.heldStack,BJ501 定谳口径）——
      // 图鉴 MouseText 悬停名锚 X+34 臂（Main.cs:20390-20392）消费
      uiHeldItemRef: () => !!ui.heldStack,
      onBack: () => {
        if (!wasPaused) g.paused = false;
        if (!wasBlocking) g.input.uiBlocking = false;
      },
    });
  }

  /** 住房面板（原版背包房屋界面 B 方案）：不暂停世界（要点击世界分配/查询）；
   *  光标态双向同步（面板选择 → game.housingMode;Game 单发完成 → onHousingCursor
   *  → 面板自毁）。右键/Esc = 关面板。
   *  ★2026-08-27：住房图标钮点击时背包面板已由 UI 侧隐藏（不遮挡/不挡移动），
   *  面板关闭 → 回背包；再点住房图标（若可见）= 关面板 toggle。 */
  async function openHousing() {
    const g = game;
    if (!g) return;
    // 再点 = 关面板（destroy → onClosed → 回背包 + 摘图标开态）
    if (document.querySelector('.sw-housing-panel')) {
      (window as unknown as { __swHousingPanel?: { destroy(): void } }).__swHousingPanel?.destroy();
      return;
    }
    // ★SW-BJ32 2026-09-08：F6 召唤面板开着 → 先关（与住房条互斥，见
    //  Game.toggleSummonPanel 同标记注——右上角同域,z-index 99999 会吞住房条点击,
    //  F6 召唤的城镇 NPC 头像点不着 = 分配不生效）。
    if (g.summonPanel?.open) g.toggleSummonPanel();
    const { HousingPanel } = await import('./ui/HousingPanel');
    // 动态 import 间隙防双开（连点/退出竞态）
    if (document.querySelector('.sw-housing-panel') || !game) return;
    const panel = new HousingPanel(g,
      (m) => { g.housingMode = m; },
      () => {
        ui.setHousingOpen(false);
        // 关面板回背包（住房条藏了背包,退出世界路径 game 已 null → 菜单不误开）
        if (game) ui.openInventory();
      });
    panel.canvas.classList.add('sw-housing-panel');
    (window as unknown as { __swHousingPanel?: unknown }).__swHousingPanel = panel;
    ui.setHousingOpen(true);
  }

  function showTitle(bgPaused = false) {
    // ★BJ280：回标题清拦截态（标题界面永不 dirty;覆盖 quitToMenu 保存失败仍退出
    // 的路径——原版失败可离开语义,拦截面随之解除）
    worldDirty = false;
    audio.play('title', titleStyleMusicId());   // IIII225 种子覆写 + IIIII228 TitleMusicStyle 细分
    ui.closeAll();
    // SW 资产预载(仅生产构建):进菜单即按优先级全量后台下载 + 挂右下角进度徽标
    // (warmAll 幂等,SW 侧 keys() 过滤已下载;被系统清理只补缺=自愈)
    warmAllAssets();
    mountAssetBadge();
    if (!menuBg) {
      menuBg = new MenuBackground(root);
      (window as unknown as { __swMenuBg?: MenuBackground }).__swMenuBg = menuBg; // 调试句柄
    }
    // 启动路径(bgPaused=true):菜单挂在 splash 后备场但揭幕前冻结 tick/绘制
    // ——过渡图阶段时间不再空转,加载密集期零渲染负载(2026-08-27 用户报);
    // 回菜单路径(quitToMenu 等)不传参=立即恢复运镜
    menuBg.setPaused(bgPaused);
    // ★幕布期 z 复位（「动态背景早退」修复兜底沿：实例复用时回标题必经此处;
    // 幕布窗内退出(quitToMenu 等)后 z5 若不复位=标题态盖住 legacyShim(z1)）
    menuBg.setCurtainMode(false);
    titleMenu?.destroy();
    titleMenu = new TitleMenu(root, {
      onSinglePlayer: () => gateAssetsOrRun(() => showCharacterSelect()),
      onSettings: () => openSettings(false),
      onAchievements: () => openMenuAchievements(),   // ★SW-FX18（Main.cs:49733 同位）
      onQuit: () => {
        // 退出三态(2026-08-29 用户定案)：桌面壳=原生退出；浏览器=window.close()
        // (脚本打开的窗/单历史标签可关)；关不掉的普通标签页给"告别幕布"兜底
        const sh = (window as unknown as { sandboxDesktop?: { isShell?: boolean; quit?: () => void } }).sandboxDesktop;
        if (sh?.isShell && sh.quit) { sh.quit(); return; }
        window.close();
        if (!window.closed) showFarewellCurtain(root);
      },
      onCredits: () => ui.toast(Lang.text('Mods.SandboxWorld.CreditsLine')),
      onMultiplayer: () => showMultiplayerSelect(),
      // ★素材包入口改挂原版资源包页(2026-10-12 退役裁决):RemasterPanel(sw-remaster-pack
      //  自创格式)退出用户面——原版资源包(Steam 工坊订阅/zip/文件夹)为唯一包形态。
      //  RemotionManager 引擎保留静默应用存量包(已装 remaster 包不失效,导入面关闭)。
      onAssetPacks: () => {
        void import('./ui/ResourcePackPage').then(({ buildResourcePackPage }) => {
          // 遮罩层(居中承载)+ 卡体(素材包页内容)+ 右上关闭——RemasterPanel 同观感
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(4,6,14,.82);'
            + 'display:flex;align-items:center;justify-content:center;';
          const panel = buildResourcePackPage();
          if (!document.getElementById('sw-rp-modal-style')) {
            const st = document.createElement('style');
            st.id = 'sw-rp-modal-style';
            st.textContent = '.sw-rp-modal-close { padding: 5px 12px; border-radius: 3px;'
              + 'border: 1px solid #7d92d6; background: #3a2a5a; color: #fff; cursor: pointer;'
              + 'font-family: inherit; font-size: 13px; }'
              + '.sw-rp-modal-close:hover { background: #4a5aa0; }';
            document.head.appendChild(st);
          }
          // ★关闭钮=卡体容器的【兄弟】(absolute 锚 cardWrap)——不能挂 panel 根:
          //   页面自身 render() 会 innerHTML='' 整表重绘,panel 子节点全被抹
          //   (关闭钮/悬停样式消失,用户实报)。卡片观感由 cardWrap 承担。
          const cardWrap = document.createElement('div');
          cardWrap.style.cssText = 'position:relative;background:#241a4e;border:2px solid #7d92d6;'
            + 'box-shadow:0 0 0 2px #0a0e1e;border-radius:6px;padding:20px 24px;'
            + 'width:min(680px,92vw);max-height:82vh;overflow-y:auto;';
          const close = document.createElement('button');
          close.className = 'sw-rp-modal-close';
          close.textContent = Lang.text('Mods.SandboxWorld.ResourcePacks.Close');
          close.style.cssText = 'position:absolute;top:10px;right:14px;z-index:2;';
          close.addEventListener('click', () => overlay.remove());
          cardWrap.append(panel, close);
          overlay.append(cardWrap);
          root.append(overlay);
        });
      },
      // GOING_OLDSCHOOL B2：日月拖拽 → 菜单时钟跟手（Main.cs:62434-62446 反算 t01）
      //   + sunModY/moonModY 垂直跟手写点（:62430/:62440——画布日/月与 DOM 命中层
      //   同吃 modY，松手后 SkyRenderer 每帧 ×0.999 缓回 :62415-62416）
      onSunMoonGrab: (info) => {
        menuBg?.setClockT(info.time01);
        menuBg?.setCelestialModY(info.dayTime, info.modY);
      },
    });
    installLegacyShim();
  }

  /** 揭幕解冻菜单背景（main.ts 在 splash.revealBehind 时调） */
  function resumeMenuBg(): void {
    menuBg?.setPaused(false);
  }

  /** 旧 puppeteer 脚本兼容垫片：select(尺寸)+button(创建) 隐藏 DOM（M7 移除）。
   *  挂 root 末尾（在天空画布之上）；标题页按钮在屏幕中央不与垫片（左上角）重叠，
   *  querySelector('button') 仍命中垫片——旧探针脚本零修改。 */
  function installLegacyShim() {
    if (legacyShim) return;
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;opacity:0.01;z-index:1;';
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="4200x1200">小</option><option value="6400x1800" selected>中</option><option value="8400x2400">大</option>';
    const btn = document.createElement('button');
    btn.textContent = '创建新世界';
    btn.addEventListener('click', () => {
      const [w, h] = (sel.value || '6400x1800').split('x').map(Number);
      void newWorld('', w, h);
    });
    div.append(sel, btn);
    root.appendChild(div);
    legacyShim = div;
  }

  /** ★BJ144 重复退出闸：保存屏期间 Esc 重开暂停菜单/再点退出等二次触发防双拆台 */
  let quitting = false;
  /** ★BJ280（2026-09-22）会话 dirty：enterGame（onWorldReady 唯一收口）置位;仅
   *  用户确认的保存链（手动保存 Ctrl+S/暂停菜单、保存并退出落定——doSave 非静默档
   *  成功）或回标题清除。自动保存/隐藏兜底走静默档不清位（非用户确认存档点,
   *  宁多拦不漏拦）。 */
  let worldDirty = false;
  /** ★BJ280 doSave 在途标志：visibilitychange 隐藏兜底与在途保存链互斥（防重叠
   *  双链;SaveClient 序列化本串行,但 kvSet/槽位两路 IDB 写会交错）。 */
  let saveInFlight = false;

  // ★BJ280 页面刷新/关闭拦截：dirty 会话 beforeunload 弹【原生】确认（浏览器不
  //  允许自定义文案,不自造弹层——原生框是唯一可靠拦截面）。注册一次;标题态
  //  worldDirty 恒 false 永不拦;SaveAndQuit 保存屏（quitting）不拦（保存链自带
  //  确认,任务处方）。处理器工厂/判定纯核=src/save/UnloadGuard.ts（单测直驱）。
  window.addEventListener('beforeunload',
    makeBeforeUnloadHandler(() => ({ dirty: worldDirty, quitting })));
  // ★BJ280 隐藏兜底（pagehide/visibilitychange 评估结论：pagehide 对异步 IDB 写
  //  过晚不可靠,取 visibilitychange hidden——页面仍存活,worker 序列化+IDB 落盘可
  //  继续完成）：切后台即静默自动保存一次,补 beforeunload 不可靠面（移动端/OS 级
  //  杀页）。静默档不清 dirty;退出链/在途链互斥（hiddenBackstopShouldSave）。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (!hiddenBackstopShouldSave({ dirty: worldDirty, quitting, hasGame: !!game, saveInFlight })) return;
    void doSave(true);
  });
  async function quitToMenu() {
    if (quitting) return;
    quitting = true;
    try {
      // R4-8（WF57:6649 SaveAndQuit 语义）：原版 SaveAndQuit 必入队存档后才断线回菜单
      // ——本仓退出曾不落盘,"退出即存档"预期落空。
      // ★BJ144（2026-09-18 用户实报「保存并退出有时没保存到」）定谳=fire-and-forget：
      //  原版 SaveAndQuit（WorldGen.cs:6649-6667）先入 menuMode=10 保存屏,回调
      //  SaveAndQuitCallBack（:6612-6635）里 Player.SavePlayer+WorldFile.SaveWorld
      //  全部落盘后才 menuMode=0 回标题——【退出等保存完成】。本仓曾同步拆台+后台
      //  存档:标题即现,保存链(worker 序列化+quicksave IDB+槽位 IDB)在后台跑;用户
      //  关标签/刷新/秒点重进世界 → 读到旧槽位甚至整段丢失(探针 _savequit-nrounds:
      //  修前 B 组「退出后立刷」10/10 丢档)。现=保存屏遮罩+冻结世界,doSave 全链
      //  落定再拆台;保存失败 toast 后仍退出(不阻断,同原版失败可离开)
      if (game) {
        game.paused = true;   // 保存期冻结世界（menuMode=10 停 Update 同相;防 await 窗口状态漂出快照）
        showSavingVeil(root);
        try { await doSave(); } catch (e) { console.error('quitToMenu save failed', e); }
        hideSavingVeil();
      }
      mobile?.destroy();
      mobile = null;
      game?.destroy();
      game = null;
      // 外部持有者同步摘引用(2026-08-13 泄露 review):__swGame 不清=旧 Game(整个
      // 世界 store 数十 MB typed array)被 window 挂到下次进游戏才释放;ui.game
      // 由 closeAll→detachGame 摘
      (window as unknown as { __swGame?: Game | null }).__swGame = null;
      currentWorld = null;
      joinRoomWorldId = null;   // ★BJ704-G7 件1：会话终了——联机建房绑定同清（doSave 已在上文落定）
      // ★BJ617 件1：会话锁随退出释放（此点 doSave 全链已落定——先落盘再放锁,
      //  他 tab 的拒载窗覆盖到我们的最终写入为止;tab 关闭另有浏览器自动释放面。
      //  ★R13-F3：charState 写已并入 doSave 全链 Promise.all——本释放位次在 .plr
      //  段 settle 之后,角色锁不再于 charState 在途时提前放手）
      heldSessionLocks?.release();
      heldSessionLocks = null;
      // ★BJ318（2026-09-23 退出链释放审计补刀,须在 game=null 后——面板 onClosed
      //  的 `if (game) ui.openInventory()` 在退出路径不得误开背包）：
      //  ① F6 住房面板挂 document.body 且持 Game 引用（__swHousingPanel）——
      //    不随 ui.closeAll 拆,用户开过面板再退出=死 Game 整图滞留;
      //  ② flowGenClient worker 收刀:worker isolate 堆里上一轮读档的 JSON 字符串/
      //    SaveData/解码中间态大垃圾(百 MB 级)随 isolate 整体释放——下次读档/
      //    图标预热 ensureWorker 懒重建(SW 预取缓存秒开)
      (window as unknown as { __swHousingPanel?: { destroy(): void } | null }).__swHousingPanel?.destroy();
      (window as unknown as { __swHousingPanel?: unknown }).__swHousingPanel = null;
      flowGenClient?.terminate();
      flowGenClient = null;
      // ★BJ328（2026-09-24）：save.worker 常驻单例收刀——terminate + 链槽归零
      //  （isolate 堆内上一轮存档的全图快照/序列化大垃圾随 isolate 释放；下次
      //  doSave/importWld/exportWld ensure() 懒重建，SW 预取秒开）。须在 doSave
      //  全链落定之后（上方 await），无在途作业窗口。
      saveClient.release();
      ui.closeAll();
      showTitle();
    } finally {
      quitting = false;
    }
  }

  function doSave(silent = false): Promise<boolean> {
    if (!game) return Promise.resolve(false);
    saveInFlight = true;   // ★BJ280：隐藏兜底互斥（finally 解除）
    game.finishWorldJobs();   // ★PR-async：job 半程存档=重读档永久丢转化——先 drain 完再序列化
    // 存档序列化走后台 worker(RLE+base64+JSON 全套离主线程;主线程只付一次
    // 全图数组结构化克隆的 memcpy),不可用时 SaveClient 内部回退同步 saveGame
    // ★槽位元数据必须调用帧快照:quitToMenu 在 doSave 返回后【同步】置空
    // game/currentWorld(2026-08-13 泄露 review),而 worldStore 落盘发生在 worker
    // 序列化完成的异步 .then 里——届时再读全局已为 null,「保存并退出」整段
    // worldStore.save 被跳过,世界列表槽位停在最近一次自动保存,重进即回退
    // (2026-08-30 用户报)。序列化输入(world/player 等)经实参同步取值不受影响。
    // ★BJ144(2026-09-18):quitToMenu 已改等全链落定,快照语义仍保留(双重保险)
    const slotMeta = currentWorld;
    const hardModeNow = !!game.world.flags.hardMode;
    const worldNameNow = game.world.name ?? 'world';   // ★BJ605 备份导出用调用帧快照（.then 闭包内 game narrowing 失效+quitToMenu 置空前不可再读全局）
    const playTimeMs = cumulativePlayMs();
    saveClient.ensure();
    // ★BJ144：返回值改为【全链落定】promise——quitToMenu/更新横幅 reload 等
    //  「退出即持久化」消费方 await 到序列化+quicksave+槽位双 IDB 写全部 settle,
    //  不再 fire-and-forget(原版 SaveAndQuit 保存屏语义,WorldGen.cs:6612-6635)
    // ★BJ620 件6-F9（探针 scripts/_bj620-f9-parse-probe.mjs：8400×2400 档主线程
    //  JSON.parse(json).player 12.4ms>10ms 阈）：saveWithPlayer——worker 回传 player
    //  切片（稳定 id 磁盘形,与 json.player 全等）,charState 同步支免整档 21MB parse。
    return saveClient.saveWithPlayer(game.world, game.player, playTimeMs, game.townNpcsForSave(), game.eventsForSave(), game.pillarNpcsForSave(), game.pressurePlatesForSave()).then(async ({ json, player }) => {
      // ★BJ90（2026-09-15）债④死路径移除（BJ71 登记②）：v6 二进制快路径退役——原
      //  kvSetCompat 曾先 kvSetBinary 写二进制副本再 kvSet 同 key 写 JSON,IDB 同 store
      //  串行 → JSON 恒后写覆盖二进制副本（快路径零活跃消费方,评估定谳）;且崩溃窗口
      //  二进制残留是元数据全丢的损毁态（packSaveBinary meta={} → loadSaveData
      //  data.header.width TypeError）。守卫=tests/save-binary-deadpath.test.ts
      // ★BJ620 件3（BJ616 F11）：同链失败面上报去重——quickWrite 'fail' 与 slotWrite
      //  'fail' 双路径旧实现各走一遍 BJ605 兜底=同一 json 下载两次+SaveFailedStorage
      //  弹多条（全败一次保存 2 下载+4 toast）。链内标记位：首个失败面执行导出+告警,
      //  后续面跳过——BJ605 兜底语义不变（至少一次导出+至少一条告警）;slot 面导出经
      //  WorldStore.save 第四参 failNotify（chainFailNotify）进入同一标记。
      const failGate = { exported: false, toasted: false };
      const noteChainSaveFail = (withExport: boolean): void => {
        if (withExport && !failGate.exported) {
          failGate.exported = true;
          try {
            const filename = downloadSaveJson(worldNameNow, json);
            ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveExportedBackup', filename));
          } catch (e2) {
            console.warn('[save] 备份导出失败', e2);
          }
        }
        if (!failGate.toasted) {
          failGate.toasted = true;
          ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveFailedStorage'));
        }
      };
      // slot 面链内去重通知（WorldStore.save 数据写败时优先于全局 onWriteFailData）：
      // 只认领导出+走 exportSaveBackup;SaveFailedStorage 告警由下方 slotWrite .catch
      // 统一发（认领制）——同链双败时 quick 面/槽面合计恰一次导出+一次告警。
      const chainFailNotify = (name: string, _dk: string, j: string): void => {
        if (failGate.exported) return;
        failGate.exported = true;
        exportSaveBackup(name, j);
      };
      const quickWrite = kvSet(QUICK_SAVE_KEY, json).then((where) => {
        if (where === 'fail') {
          // ★BJ605 用户明令件：quicksave 是最后救命稻草，写失败同样自动导出兜底
          //  （json 在手；★BJ620 件3：同链 slotWrite 也败时只导一次/告警一次）
          noteChainSaveFail(true);
        } else {
          quickSaveExists = true; // 同会话存档后 quickLoad 立即可用（此前闭包标志只在建流时查一次）
          // ★BJ618 件3（BJ616 probe F6 转正·快照面）：quicksave 写成功链尾 FS 备份快照
          //  （覆盖式单档 quicksave.json——「最后救命稻草」恰是 BJ614 唯一无备份通道;
          //  fire-and-forget 增强链,FsBackup 内部全吞错）
          try { void fsBackupSnapshot('quicksave', 0, worldNameNow, json); }
          catch (e) { console.warn('[save] quicksave 快照回调异常', e); }
          // ★R13-F6：保存成功提示已移出本支——旧位置 quick 写成即弹「世界已保存」,
          //  槽位写随后败=成功+失败双 toast 并存;现全链 Promise.all settle 后按
          //  failGate 判言统一发（见下方 await 后）。
        }
      }).catch((e) => {
        console.error('kvSet failed', e);
        noteChainSaveFail(false);   // ★BJ620 件3：kvSet 抛弃型失败同链去重（不导出——槽位面成功则档已在库）
      });
      // 多世界槽位（M3）：登记到 WorldStore（slotMeta=退出置空前的调用帧快照）
      // ★BJ144：槽位写失败此前仅 console.error（无提示）——「世界已保存」toast 只由
      //  quicksave 写驱动,槽位静默失败(配额/IDB 不可用)时用户被告知已保存而世界列表
      //  停旧档=「感觉没保存到」第二面。现与 kvSet 同待遇 toast,并纳入全链 settle
      let slotWrite: Promise<void> = Promise.resolve();
      if (slotMeta) {
        slotMeta.hardMode = hardModeNow;
        // ★BJ620 件3：failNotify=chainFailNotify——槽面导出与 quick 面共享同链标记
        slotWrite = worldStore.save(slotMeta, json, playTimeMs, chainFailNotify).catch((e) => {
          console.error('worldStore.save failed', e);
          noteChainSaveFail(false);
        });
      }
      // 角色随身态同步（原版 .plr 语义）：player 段=磁盘稳定 id 形（★BJ620 件6-F9:
      //  worker/同步回退双路径切片直传,与 json.player 全等——旧实现整档 JSON.parse
      //  只为取 player 段,大档 10ms 级主线程停顿）,原样入 CharacterStore——与读侧
      //  playerFromDiskForm 对称。
      // ★R13-F3（BJ144 契约字面兑现）：charState 写入并入全链 Promise.all——旧实现
      //  悬浮 fire-and-forget（.catch 吞 rejection 但 doSave 不等它 settle）,doSave
      //  返回（quitToMenu 放会话锁/saveAndReload 立即 reload）时 charState 写可能
      //  仍在途=撕写（下会话读 state 键缺失/半程 → 回落世界内嵌 player=「背包铜三件」
      //  回退形态）。失败仍不阻断存档（.catch 收面,用户提示由 onWriteFailData 导出
      //  兜底发）——但 settle 必须等到：BJ144「退出等保存完成」含 .plr 段。
      let charWrite: Promise<void> = Promise.resolve();
      {
        const cid = charContextId();   // quickLoad 等无选角上下文会话也回写上次角色
        if (cid != null) {
          // ★BJ704-G7 件1（R5 登记债①清偿,2026-10-21）：角色×世界游玩史记录位=
          //  玩家保存链（原版 1:1 锚：Player.SavePlayer→InternalSavePlayer
          //  :55355 首行 InternalSaveMap :55691——地图档=HasWorldBeenPlayedByActivePlayer
          //  的原版载体（UIWorldSelect.cs:184-188 TryGetMapPath 地图档存在）,唯写
          //  时点即玩家保存;顺序亦同=先图后 .plr）。绑定=slotMeta（单人槽位会话,
          //  调用帧快照）∨ joinRoomWorldId（联机建房会话——原版客户端 msg7 收服务器
          //  WorldId（MessageBuffer.cs:488）,MapFileName=WorldId 与本机同源档重合
          //  =联机玩自家世界亦建图）。quickLoad 会话两绑定皆空=不记（判语销案:
          //  quicksave 无槽位 id 可反解+会话槽位分离设计 lastPlayed/playTimeMs
          //  同不回写,一致面;码入房非建房链=无可靠绑定不记,边界声明）。
          //  旧位=loadWorldFlow 进 loadFromKey 之前（尝试即记:失败也记）已迁出。
          const playedWorldId = slotMeta?.id ?? joinRoomWorldId;
          if (playedWorldId != null) void charStore.recordPlayedWorld(cid, playedWorldId);
          // ★BJ618 件2：setState 写败抛 CharacterSaveWriteError—— rejection 面收进
          //  .catch（旧 try/catch 只能接同步抛）,用户提示由 onWriteFailData 导出兜底发
          charWrite = charStore.setState(cid, player).catch((e) => { console.warn('charState sync failed', e); });
        }
      }
      await Promise.all([quickWrite, slotWrite, charWrite]);
      // ★R13-F6：「世界已保存」改全链成功才报——旧实现 quick 写成即弹（槽位写随后败
      //  =「世界已保存」+「保存失败」双 toast 并存,自相矛盾）。全链 settle 后按同链
      //  失败标记判言（noteChainSaveFail 任一腿失败都置位）;charState 败不计（世界档
      //  已落库）;silent 档（自动保存）仍不弹,失败 toast 亦不受 silent 门控（数据安全
      //  告警,noteChainSaveFail 内发）。
      if (!silent && !failGate.toasted) ui.toast(Lang.text('Mods.SandboxWorld.Toast.Saved'));
      // ★BJ611：保存时点刷新存储状态快照（estimate 预警面;fire-and-forget 不阻塞
      // 存档链——存档列表状态行/警示色读最近快照）
      void refreshStorageStatus();
      // ★BJ280：用户确认存档点（手动保存/保存并退出——非静默链）全链落定 → 解除
      // 拦截态。静默档（自动保存/隐藏兜底/横幅刷新）不清位。
      if (!silent) worldDirty = false;
      return true;
    }).catch((e) => {
      // 回退同步 saveGame 也失败(异常世界状态)——如实报告,不留 unhandled rejection
      console.error('save failed', e);
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveFailedStorage'));
      return false;
    }).finally(() => { saveInFlight = false; });   // ★BJ280：在途标志解除（成败皆清）
  }

  /** ★BJ605 用户明令件（「如果本地存档无法成功，也应当改为自动导出存档提供下载」）：
   *  存档 JSON 兜底下载——a[download]+Blob 程序触发（无需用户交互）。文件名 =
   *  世界名_YYYYMMDD_HHmmss.json（buildSaveBackupFilename 消毒/格式，可单测）。
   *  消费面：WorldStore 数据写失败回调 / quicksave 写失败（doSave）。
   *  返回文件名（toast/日志用）。JSON 单格式最小刀；.wld 双格式登记后续。 */
  function downloadSaveJson(rawName: string, json: string): string {
    const filename = buildSaveBackupFilename(rawName, new Date());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return filename;
  }

  /** 导出存档:同一序列化链(saveClient),产物落盘为 .sbw.json 下载——
   *  与 __swFlow.loadJson / 世界槽位导入互为闭环,便于备份与跨机迁移 */
  function doExportSave() {
    if (!game) return;
    saveClient.ensure();
    // 导出档同链：playTime 一并写累计口径（与槽位/quick 档一致,2026-09-01 审计）
    void saveClient.save(game.world, game.player, cumulativePlayMs(), game.townNpcsForSave(), game.eventsForSave(), game.pillarNpcsForSave(), game.pressurePlatesForSave()).then((json) => {
      const name = (game!.world.name ?? 'world').replace(/\s+/g, '_');
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const filename = `${name}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.sbw.json`;
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.Exported', filename));
    }).catch((e) => {
      console.error('export save failed', e);
      ui.toast(Lang.text('Mods.SandboxWorld.Toast.SaveFailedStorage'));
    });
  }

  /** ★BJ280（2026-09-22）：更新横幅「保存后刷新」专用通道（main.ts reloadAfterSave
   *  迁入）。BJ144 面保持：先静默存档全链落定再 location.reload();本刀追加=落定后
   *  无条件清 worldDirty 再刷新——横幅刷新是用户明示动作,防本刀 beforeunload 拦截
   *  把它二次弹窗打断。存档失败也刷新（BJ144 取舍:新版本优先,不因存储故障阻塞）。 */
  function saveAndReload(): void {
    void (async () => {
      try { await doSave(true); } catch { /* 存档失败也刷新(BJ144) */ }
      worldDirty = false;
      location.reload();
    })();
  }

  // 快速存档存在性预查（★R13-F2：LS/IDB 抛≠装配炸——catch 按无快存档降级,快存档
  //  菜单项自然隐藏;不留 unhandled rejection）
  void kvHas(QUICK_SAVE_KEY).then((v) => { quickSaveExists = v; }).catch((e) => {
    console.warn('[flow] quicksave 存在性预查失败（按无快存档降级）', e);
  });

  // ★BJ318（2026-09-24）：纯注册表调试桥一次性挂载（createFlow 作用域,不含 g 槽）。
  //  曾在 enterGame 内逐局覆写——闭包与 enterGame 作用域共享 `g` 槽,被 window 长持=
  //  每局退世界后死 Game 整图多一份滞留（forward-BFS 锚枚举定谳）。此处桥体不用 g。
  (window as unknown as { __swITEMS?: typeof ITEM_DEFS }).__swITEMS = ITEM_DEFS; // 信息饰品探针:vi_ key → 内部 id
  (window as unknown as { __swTileByKey?: (k: string) => number }).__swTileByKey = (k: string) =>
    (TILE_BY_KEY as Record<string, number>)[k] ?? -1;
  (window as unknown as { __swTileDefById?: (id: number) => unknown }).__swTileDefById = (id: number) => {
    const d = (TILE_DEFS as Array<{ key: string; vanilla?: { sheet: number; frame: string; fw?: number; fh?: number } }>)[id];
    return d ? { key: d.key, sheet: d.vanilla?.sheet, frame: d.vanilla?.frame, fw: d.vanilla?.fw, fh: d.vanilla?.fh } : null;
  };
  // 液体浸润实验台:?liquidlab 参数 / window.__swLiquidLab() 控制台命令——动态解析
  // 模块活实例 `game`（createFlow 作用域,退世界置 null=不钉任何 Game 实例）
  (window as unknown as { __swLiquidLab?: () => void }).__swLiquidLab = () => {
    if (game) liquidLab(game);
  };


  // 调试桥（puppeteer 脚本用）
  (window as unknown as { __swFlow?: unknown }).__swFlow = {
    newWorld: (seed: string, w: number, h: number) => newWorld(seed, w, h),
    blankWorld: (w: number, h: number) => blankWorld(w, h),   // 空白世界直通道（导演/探针：免 worldgen 秒进）
    quickLoad,
    importWld,
    quitToMenu,
    doSave,
    doExportSave,
    saveAndReload,   // ★BJ280：更新横幅通道（main.ts reloadAfterSave 迁入）
    /** ★BJ280 探针/单测桥：卸载拦截 dirty 只读（enterGame 置位/保存链·回标题清除） */
    unloadGuardDirty: () => worldDirty,
    backToTitle: showTitle,
    showCharSelect: () => showCharacterSelect(),   // 探针桥:直达角色选择页
    devMode: () => devMode,
    joinGame: (ip: string) => joinRoom(ip.includes(':') ? `ws://${ip}` : `ws://${ip}:7777`), // 旧桥（直连 URL）
    joinRoom: (url: string, token: string) => joinRoom(url, token), // 探针桥：房间制加入
    createRoom: (addr: string, opts: Record<string, unknown>) => createRoom(addr, opts as never), // 探针桥：建房
    loadJson: (text: string) => loadFromJson(text), // 读自有 json 存档（探针）
    /** 探针桥：直达真实创建流（UIWorldLoadState 双进度条+worker 预览抓帧链路，
     *  与 legacy newWorld 桥的差异=带 ?wprev/opts 全套参数——GenProgress 探针用） */
    createWorldProbe: (cfg?: Record<string, unknown>) => createWorldFlow({
      name: '进度探针', seed: String(424242), w: 4200, h: 1200,
      size: 0, difficulty: 0, evil: -1 as const, ...(cfg ?? {}),
    } as never),
    /** ★D11-M3(2026-10-14):worker 桥释放(热重载沿)——gen/save worker 缓存实例
     *  持旧 mod 映射表;terminate=下次 ensure 惰性重建吃新 provider */
    releaseWorkers: () => {
      flowGenClient?.terminate();
      flowGenClient = null;
      try { saveClient.release(); } catch { /* 已释放 */ }
    },
    itemByKey: (key: string) => ITEM_BY_KEY[key]
      ?? (key.startsWith('vi_') ? undefined : undefined), // 探针桥：物品 id（key=完整定义键）
    /** 探针桥：原版 id → 定义键 → 内部 id（键名卫生批后 roomprobe 等老探针的
     *  裸 'torch' 键已不存在——本桥以 vid 兜底解析，vi_<id> 前缀稳定） */
    itemByVid: (vid: number) => {
      const k = VANILLA_ITEM_KEY_BY_ID[vid];
      return k ? (ITEM_BY_KEY[k] ?? -1) : -1;
    },
    spawnVanillaEnemy: async (id: number, x: number, y: number) => {
      const { Enemy } = await import('./entities/Enemy');
      if (!game) return null;
      const e = Enemy.fromVanilla(id, x, y);
      if (!e) return null;
      game.entities.add(e, 'enemies');
      return { id: e.id, x: e.x, y: e.y, hp: e.hp };
    },
    /** 探针桥：敌对弹幕（原版 Projectile.hostile）——v5 msg27 bit7 链路 + 访客 Damage_EVP 本地结算的 E2E 验证。
     *  grav 默认 0（直飞激光语义；Arrow 类默认 0.3 抛物线会让探针弹坠离目标） */
    spawnHostileProj: async (x: number, y: number, vx: number, vy: number, dmg: number, projId = 9, grav = 0) => {
      const { Arrow } = await import('./entities/Arrow');
      if (!game) return null;
      const p = new Arrow(x, y, vx, vy, dmg, 0, projId, { hostile: true, grav });
      game.entities.add(p, 'projectiles');
      return { id: p.id };
    },
  };

  return {
    showTitle,
    resumeMenuBg,
    newWorld,
    quickLoad,
    importWld,
    quitToMenu,
    doSave,
    doExportSave,
    saveAndReload,   // ★BJ280
    openSettings,
    openBestiary,
    openHousing,
    get game() { return game; },
    get cumulativePlayMs() { return cumulativePlayMs(); },   // SW-BJ5 2026-09-07：存档/调试报告统一累计口径
  } as FlowHandle;
}

/** ★BJ144 保存屏（原版 SaveAndQuit menuMode=10 等价面,2026-09-18）：退出保存期间的
 *  全屏遮罩,阻断交互并告知进行中——doSave 全链落定后由 hideSavingVeil 拆除。 */
function showSavingVeil(root: HTMLElement): void {
  hideSavingVeil();
  const el = document.createElement('div');
  el.id = '__swSavingVeil';
  el.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.72);'
    + 'display:flex;align-items:center;justify-content:center;color:#e8e8e8;'
    + 'font-family:inherit;font-size:20px;letter-spacing:2px;user-select:none;'
    + 'text-shadow:2px 0 0 #000,-2px 0 0 #000,0 2px 0 #000,2px 2px 0 #000;';
  el.textContent = Lang.text('Mods.SandboxWorld.UI.Saving');
  root.appendChild(el);
}

function hideSavingVeil(): void {
  document.getElementById('__swSavingVeil')?.remove();
}

/** 退出告别幕布（浏览器侧 window.close() 被策略拒绝时的兜底,2026-08-29）：
 *  普通标签页不允许脚本关闭,给出可读终态而非无响应的假死按钮。 */
function showFarewellCurtain(root: HTMLElement): void {
  if (document.getElementById('__swFarewell')) return;
  const el = document.createElement('div');
  el.id = '__swFarewell';
  el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.96);'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;'
    + 'color:#e8e8e8;font-family:inherit;user-select:none;';
  const title = document.createElement('div');
  title.textContent = Lang.text('Mods.SandboxWorld.Farewell.Title');
  title.style.cssText = 'font-size:22px;letter-spacing:1px;';
  const hint = document.createElement('div');
  hint.textContent = Lang.text('Mods.SandboxWorld.Farewell.Hint');
  hint.style.cssText = 'font-size:13px;opacity:.65;';
  const btn = document.createElement('button');
  btn.textContent = Lang.text('Mods.SandboxWorld.Farewell.Reload');
  btn.style.cssText = 'margin-top:8px;padding:8px 26px;font-size:14px;cursor:pointer;'
    + 'background:#2b6db3;color:#fff;border:1px solid #4d90d0;border-radius:4px;';
  btn.onclick = () => location.reload();
  el.append(title, hint, btn);
  root.appendChild(el);
}
