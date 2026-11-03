// 设置项单例 + KvStore 持久化（M6）。变更通过监听器下发到 Audio/Sfx/UIScale。
import { kvGet, kvSet } from '../save/KvStore';
import { DEFAULT_LANG, detectBrowserLang, normalizeLang } from '../i18n/GameCulture';
import { sanitizeKeybinds, migrateLegacyDefaults, type KeybindAction } from './Keybinds';

/** 小地图边框皮肤全集（MinimapFrameManager.PopulateOptionsAndLoadContent 插入序，
 *  Terraria.GameContent.UI.Minimap/MinimapFrameManager.cs:32-42）。原版 1.4.5.6 的地图
 *  皮肤系统仅此一处——全屏地图固定单张 Images/Map.png 羊皮纸（AssetInitializer.cs:638，
 *  Main.cs:54923），无"全屏地图皮肤"枚举。 */
export const MINIMAP_FRAME_SKINS = [
  'Default', 'Golden', 'Remix', 'Sticks', 'StoneGold', 'TwigLeaf', 'Leaf', 'Retro', 'Valkyrie',
] as const;

export type MinimapFrameSkin = typeof MINIMAP_FRAME_SKINS[number];

/** 皮肤循环纯函数（SelectionHolder.CycleSelection 1:1，Terraria.DataStructures/SelectionHolder.cs）：
 *  取 Dictionary 枚举序中 ActiveSelection 的【前一个】，ActiveSelection 是首个时回绕到末个；
 *  未知键经 SetActiveFrame(string) 未命中 → Options.Values.First() = Default。
 *  注意方向是"倒序循环"，不是顺序 +1。 */
export function cycleMinimapFrame(current: string): MinimapFrameSkin {
  const i = (MINIMAP_FRAME_SKINS as readonly string[]).indexOf(current);
  if (i === -1) return MINIMAP_FRAME_SKINS[0];
  return MINIMAP_FRAME_SKINS[(i - 1 + MINIMAP_FRAME_SKINS.length) % MINIMAP_FRAME_SKINS.length];
}

export interface OptionsData {
  musicVol: number;   // 0..1（默认 = Main.cs:1432 musicVolume = 1f）
  sfxVol: number;     // 0..1
  /** Ambient 环境音轨音量 0..1（Main.ambientVolume，Main.cs:1413 默认 1f；
   *  config.json 键 "VolumeAmbient"，Main.cs:4159/4383）——13+ 环境音独立轨 */
  ambientVol: number; // 0..1
  uiScale: number;    // 0.75..1.5（作用于 UIScale.userScale）
  devMode: boolean;
  lang: string;       // culture 名(如 zh-Hans);兼容旧数字 legacyId(对齐原版 config.json)
  /**
   * 语言是否经设置面板显式选择过（浏览器语言探测的门：首次访问/从未显式选择时
   * 按 navigator.languages 自动匹配一次；显式选择后永久尊重用户选择）。
   * 旧档无此键 = 未显式选择过 → 探测放行（首次升级到本版的老用户也能被正确
   * 切到浏览器语言；之后面板选一次即落盘为 true）。 */
  langExplicit: boolean;
  // 智能光标（对齐原版 Player.SmartCursorSettings + IngameOptions/Main.cs:49705 设置结构）
  smartCursorMode: 'toggle' | 'hold';  // Main.cSmartCursorModeIsToggleAndNotHold（默认 Toggle）
  smartAxeAfterPickaxe: boolean;       // UseSmartAxeAfterSmartPickaxe（默认 false）
  smartBlocksEnabled: boolean;         // Player.SmartCursorSettings.SmartBlocksEnabled（static bool 默认 false，Player.cs:326）
  smartHoldCanReleaseMidUse: boolean;  // SmartCursorSettings.SmartCursorHoldCanReleaseMidUse（static bool 默认 false，Player.cs:330）
  /** Game Zoom（Main.GameZoomTarget，Main.cs:256 默认 1f；config 键 "Zoom"
   *  Main.cs:4284/4575；域 [1,2] 钳 Main.cs:16986-16990/:62953；设置滑条
   *  IngameOptions.cs:521-561 杆值 = zoom-1）。消费：Camera.zoomTarget 基线 */
  gameZoom: number;
  backgrounds: boolean;                // Main.BackgroundEnabled（Main.cs:790，config.json 持久化；默认 true）
  swayInWind: boolean;                 // Main.SettingsEnabled_TilesSwayInWind（图块在风中摆动；默认 true）
  resourceBarStyle: 'classic' | 'fancy'; // 资源条样式（PlayerResourceSetsManager2：'New' Fancy 金框为原版 1.4.4+ 默认 / 'Default' Classic 朴素）
  /** 标题曲风格（★IIIII228 Main.titleMusicStyle,config.json "TitleMusic" 字符串键
   *  Main.cs:4602 默认 Current；Random 每次启动 new UnifiedRandom(DateTime.Ticks).Next(3)
   *  抽档 :4605-4608）。值域 = Current/Old/Console/Random */
  titleMusic: 'current' | 'old' | 'console' | 'random';
  /** 小地图边框皮肤（MinimapFrameManager：config.json "MinimapFrame" 字符串键，默认 Default） */
  minimapFrame: MinimapFrameSkin;
  /** 小地图透明度（Main.mapMinimapAlpha，Main.cs:892 默认 1；MapAlphaUp/Down 键
   *  ±0.015 步进，DrawMap :54961-54968 钳 [0.01,1]。原版不持久化——本仓 Web 便利档持久化） */
  mapMinimapAlpha: number;
  /** 覆盖式地图透明度（Main.mapOverlayAlpha，Main.cs:896 默认 0.35；同上钳/步进） */
  mapOverlayAlpha: number;
  /** 玩家对决开关（Player.hostile 的持久化镜像——原版 hostile 纯会话态不存档;
   *  本仓单机无进服概念,进游戏时从 options 灌入 Player.hostile,便于常开） */
  pvpEnabled: boolean;
  /** 队伍 0-5（Player.team,PlayerTeamID）——镜像角色档 team,UI 可运行时改并回写角色档 */
  pvpTeam: number;
  /** 渲染帧率上限(2026-08-18 原版对齐):原版锁 60fps;0=不锁(跟随显示器 rAF)。
   *  逻辑 tick 恒 60Hz 不受影响(fixedUpdate 累加器);仅 gate 渲染帧 */
  frameCap: number;
  /** 帧模式三态(原版 FrameSkipMode Off/On/Subtle,1457 Main.cs:17129-17197 亲读;
   *  1456 旧锚 :16950-16975):
   *  ★"落后跳帧"在原版是死代码(num3=0 使 successiveSkippedDraws 门永假 :17195-17202),
   *  任何档位都不因渲染落后而跳绘制。★Subtle=确定性节拍对齐(2026-09-28 调度面修复刃
   *  重译):1457 默认 improvedSubtleFrameSkip=true 的真实语义 = EndDraw 忙等钳 60Hz
   *  present 网格(Main.cs:62624-62644),Update 每循环照跑、无绘制抑制——本仓以
   *  时间门移植(★v9.8 根治刀:shouldRender=now-lastRenderAt≥1000/cap-GUARD,k 迁移
   *  退役,FrameBeat.ts 头注 v9.8);旧"0 步进帧 SuppressDraw"译法(:17182-17193,仅 Subtle&&
   *  !improved 旧路径)已退役。Off/On=跟随 rAF 自由渲染(off=逃生门;On 的 XNA
   *  固定时间步 :17133-17137 无 Web 对应物,两态同效)。默认 Subtle(原版同) */
  frameSkipMode: 'off' | 'on' | 'subtle';
  /** 水波质量四档（Main.WaveQuality，Main.cs:405 默认 3）：0=关 1=低 2=中 3=高。
   *  档位门见 WaterShaderData.cs:114-118（>=3 弹幕波/黏度补偿、>=2 玩家+涟漪、
   *  NPC 恒开；0 = WaterDistortion 滤镜整体关闭 SceneState.cs:129）；
   *  config.json 键 "WaveQuality"（Main.cs:4215/4465），读档钳 [0,3]（:4466-4473） */
  waveQuality: number;
  /** 渲染分辨率档(#perf-gpulog 方案A):主画布后备=CSS×此系数;1=原态。
   *  0=自动(饥饿时沿 [1,0.75,0.66,0.5] 阶梯降级,不回升;世界构图经 camera.renderScale
   *  补偿保持不变)。**运行期改值走 Renderer.applyRenderScale**(重建后备+chunk 池) */
  renderScale: number;
  /** 饥饿时是否允许自动降档(GPU starvation lock 联动) */
  renderScaleAuto: boolean;
  /** 渲染模式:gpu=硬件加速(默认);cpu=软渲染(willReadFrequently,零 GPU 预算,
   *  多开/弱 GPU 稳定);auto=GPU 优先,连续崩溃自动切 CPU,稳定 2 分钟回 GPU */
  renderMode: 'gpu' | 'cpu' | 'auto';
  // ---- M5 键位重映射（自定义层；缺 action = DEFAULT_KEYBINDS，见 core/Keybinds.ts）----
  keybinds: Record<string, string[]>;
  // ---- M14 IngameOptions 杂项（IngameOptions.cs:647-848 逐项，注释=原版默认+消费点）----
  /** 激活套装奖励键反转（Main.ReversedUpDownArmorSetBonuses，:647；默认 false）——
   *  消费：Lang 全局替换键 ToggleArmorSetBonusKey（Lang.cs:161 Key.DOWN↔Key.UP），
   *  本仓 Game.afterWorldLoad 的 reversedArmorBonusKey 注入 */
  reversedUpDownArmorSetBonuses: boolean;
  /** 智能门偏好（DoorOpeningHelper.PreferenceSettings，:656；默认 EnabledForEverything，
   *  CyclePreferences :262-276 循环序 Disabled→Enabled→GamepadOnly→Disabled）。
   *  行为 N-A：玩家智能门(走过自动开门)系统未移植，设置先持久化 */
  doorOpeningPreference: 'enabled' | 'gamepadOnly' | 'disabled';
  /** 全物品自动连用（Main.SettingsEnabled_AutoReuseAllItems，:689；默认 false）——
   *  消费：Player.cs:24182 autoReuseAllWeapons；本仓 Game 挥击复用门 */
  autoReuseAllItems: boolean;
  /** 拾取提示（Main.showItemText，:705；默认 true）——消费：PopupText 族；
   *  本仓 Game.showPickupLabel 门 */
  showItemText: boolean;
  /** 建造饰品自动上致动器关断（Main.builderAccStatus[2]==1 档；默认 false = status[2]=0
   *  启用）——加压器 3624 置放覆盖格自动上致动器的开关面。原版开关 UI =
   *  装备区旁 BuilderAcc 图标钮（Main.cs:48162 区，tooltip GameUI.ActuationDeviceOn/Off，
   *  装备 autoActuator 时才出现）；本仓以设置页 toggle 承载（终零波 最小可行版）。
   *  消费：Game.tryPlace 自动致动段（Player.cs:40952 `!autoActuator || builderAccStatus[2]!=0`） */
  builderAutoActuatorDisabled: boolean;
  /** 建造饰品自动喷漆关断（Main.builderAccStatus[3]==1 档；默认 false = status[3]=0 启用）
   *  ——喷漆器族 2216/3061/5126 放置同步上漆的开关面。原版 tooltip
   *  GameUI.PaintSprayerOn/Off（Main.cs:48252 case3）；本仓以设置页 toggle 承载。
   *  消费：Game.tryPlace 自动上漆段（Player.cs:39938 `autoPaint && builderAccStatus[3]==0` 等）
   *  ★SW-FX19（2026-09-10）：[2]/[3] 消费与设置页读写均迁玩家位面
   *  player.builderAccStatus（per-player,.plr 持久化）——本组字段退役保留
   *  （旧全局档兼容 + 设置页无玩家实例时的显示回落），不再被消费面读取。 */
  builderAutoPaintDisabled: boolean;
  /** 事件进度条（Main.invasionProgressMode，:714；Main() 静默初始化=2，非字段 0！）：
   *  0=关 / 1=定时(160t 窗) / 2=开(近场常显)。消费：CheckInvasionProgressDisplay
   *  :46965+DrawInvasionProgress :47077；本仓 Game 入侵条数据源 */
  invasionProgressMode: 0 | 1 | 2;
  /** 放置预览（Main.placementPreview，:727；默认 true）——消费：TileDrawing.cs:742
   *  TileObject.DrawPreview(多格家具放置幽灵)。行为 N-A：对象放置幽灵预览系统
   *  未移植，设置先持久化 */
  placementPreview: boolean;
  /** 突出显示新物品（ItemSlot.Options.HighlightNewItems，:736；默认 true）——消费：
   *  ItemSlot.cs:1995 item.newAndShiny 高亮。行为 N-A：背包 newAndShiny 追踪未移植，
   *  设置先持久化 */
  highlightNewItems: boolean;
  /** 图格网格（Main.MouseShowBuildingGrid，:745；默认 false）——消费：
   *  DrawInterface_6_TileGridOption Main.cs:45634-45671（CursorRadial 鼠标格十字，
   *  站立不动渐显 0.7α/移动>6px 淬灭）；本仓 Renderer.drawBuildingGrid */
  mouseShowBuildingGrid: boolean;
  /** 对话头像偏好（Main.DialoguePortraitPreference，:823；CycleNPCPortraitMode
   *  :39724 循环序 Detailed→CloseUp→FullBodyRetro→Disabled；默认 Detailed）——
   *  消费：DrawNPCPortrait；本仓 NpcDialog（Disabled=不画头像；CloseUp/FullBodyRetro
   *  贴图变体未导入暂渲染 Detailed 形） */
  dialoguePortraitMode: 'detailed' | 'closeUp' | 'fullBodyRetro' | 'disabled';
  /** 悬停文本框（Main.SettingsEnabled_OpaqueBoxBehindTooltips，:848；默认 true）——
   *  消费：物品 tooltip 背板；本仓 UI .sw-tooltip 底色 */
  opaqueBoxBehindTooltips: boolean;
  // ---- ★SW-FX14 2026-09-10 M14 收尾（IngameOptions.cs 普查对账补缺 4 项）----
  /** 悬停控制 Click/Hold（Player.Settings.HoverControl，IngameOptions.cs:671-688；
   *  缺省 Hold = Player.cs:357 静态初值；config.json 键 "HoverControlMode"
   *  Main.cs:4293/:4638）。消费：悬停锁存 tryKeepingHoveringUp/Down（Player.cs:
   *  25452-25484——Click 档锁存驻留/Hold 档每拍双清）+ TryingToHoverUp/Down
   *  取值（:3908-3927）全消费面（翅膀 WingMovement/WingFrame/贴墙靴缓降）。
   *  本仓翼链此前按 Hold 语义直读 inputUp/Down（:4967"保持态近似省略"登记债），
   *  本刀接入锁存后 Click 档成立 */
  hoverControl: 'hold' | 'click';
  /** Boss 血条数字（BigProgressBarSystem.ShowText，IngameOptions.cs:806-812；
   *  静态缺省 true = BigProgressBarSystem.cs:76；原版经 Preferences 键
   *  "ShowBossBarHealthText" 持久化（:74/:118-124 BindTo）+ Main.cs:50774-50778
   *  旧版设置页双入口）。消费：BigProgressBarHelper.DrawHealthText 门
   *  （:57/:123）——本仓 drawBigProgressBar showText 参（BossBars.ts）经
   *  Renderer.drawBossBar 灌入 */
  showBossBarHealthText: boolean;
  /** 背包特效（Main.FlashyEffectsInterface，IngameOptions.cs:833-842；缺省 true =
   *  Main.cs:443；config.json 键 Main.cs:4300/:4443）。★1.4.5.7 全反编译该字段
   *  仅 6 处引用（声明/存/读/两处设置行）——零游戏行为消费方（历史遗留死设置），
   *  1:1 保态不挂行为 */
  flashyEffectsInterface: boolean;
  /** 光照模式（Lighting.Mode，IngameOptions.cs:973-979「视频」组；枚举
   *  Terraria.Graphics.Light/LightMode.cs:White=0/Retro=1/Trippy=2/Color=3，
   *  静态初值 Color = Lighting.cs:19；config.json 键 "LightingMode"
   *  Main.cs:4238/:4490-4495）。循环 = Lighting.NextLightMode（Lighting.cs:169-176
   *  Mode++ 未定义回落 White）= Color→White→Retro→Trippy→Color。
   *  ★行为备案：Color=NewEngine(逐格 RGB) ≙ 本仓 GL 光照图；White/Retro/Trippy
   *  三档走 LegacyLighting 引擎（Lighting.cs:40-54）——legacy 引擎族未移植，
   *  本仓三档暂与 Color 同渲（依赖：照明引擎族移植，登记债） */
  lightMode: 'color' | 'white' | 'retro' | 'trippy';
  // ---- ★BJ508 2026-10-04 冲刺控制档（Player.Settings.DashControl）----
  /** 双击冲刺（Player.Settings.DashControl == DashPreference.AllowDoubleTap；
   *  枚举 Player.cs:347-351 AllowDoubleTap/OnlyThroughHotkeys，静态缺省
   *  AllowDoubleTap = Player.cs:365；config.json 键 "DashControlMode"
   *  Main.cs:4294/:4639；设置页开关 = UIManageControls.cs:653-663 case "sp20"
   *  键盘控制页 Dash 行后一位，文案 UI.DoubleTapDash）。消费：DoCommonDashHandle
   *  :21737 `flag = DashControl == AllowDoubleTap` ——只门双击支（:21749/:21764
   *  `(controlRight && releaseRight) & flag`），Quick Dash 键面（num 支）无此门。
   *  true=AllowDoubleTap（缺省）/false=OnlyThroughHotkeys（只认热键） */
  doubleTapDash: boolean;
  // ---- S 级：自动保存/自动暂停（IngameOptions.cs:619/628）----
  /** 自动保存（Main.autoSave，1457 Main.cs:1214 默认 true，1456 :1196）——
   *  DoUpdate_AutoSave 1457 :19920（1456 :19589）墙钟 600000ms 触发
   *  WorldGen.saveAndPlay */
  autoSave: boolean;
  /** 自动保存间隔（分钟；原版恒 10 分钟不可调，此处为任务要求的 Web 便利扩展档） */
  autoSaveIntervalMin: number;
  /** 自动暂停（Main.autoPause，Main.cs:1298 默认 false——★SW-RB7 2026-09-08 勘误,
   *  曾写 :1280 实为 rainTime;config 键 "AutoPause" Main.cs:4203/:4426）——原版语义="开界面暂停"
   *  （CanPauseGame Main.cs:17493-17508：开背包/牌等界面时逐帧 gamePaused），
   *  非失焦暂停；失焦面归 SettingPlayWhenUnfocused（红队 R3-E2 ②正锚，两者互不
   *  耦合）。本仓消费=Game.applyAutoPauseUI（__swUI.inventoryOpen 逐帧重算）。
   *  ★SW-BN3 2026-09-07：Esc 链对齐原版（背包开着 Esc=关背包 ToggleInv :5026）后,
   *  本开关成为背包态的主暂停路径（"开背包即暂停"）;设置页开关行序紧随自动保存,
   *  与 IngameOptions.cs:628 同位,文案=LegacyMenu.69/70 官译 */
  autoPause: boolean;
  /** 失焦播放（Main.SettingPlayWhenUnfocused，Main.cs:268 默认 false；config.json
   *  键 "PlayWhenUnfocused"，Main.cs:4301/:4444 持久化）。原版消费面（FocusHelper.cs）：
   *  AllowAudioUnfocused :23 → AllowMusic :85-95 失焦取本开关；UpdateFocus :139-141
   *  `wantsToPause = (!IsSelectedApplication && netMode==0) & !本开关`——【游戏暂停】
   *  也由本开关直驱：false=失焦暂停+全静；true=失焦不暂停,sfx 停（PauseSounds
   *  :97-107）+环境音归零（:109）,仅音乐继续（:85-95）。设置行
   *  IngameOptions.cs:637-647（Gameplay 段，紧随 autoPause），文案键
   *  UI.PlayWhenUnfocusedOn/Off（On=开"失焦播放"→暂停文案"关"，反向是原版原文）。
   *  本仓消费=Game.applyFocusPause（失焦游戏暂停）+Sfx 失焦音频闸（分类别：music
   *  开关放行 / sfx 恒停 / ambient 归零） */
  playWhenUnfocused: boolean;
  /** 快速堆叠模式（Player.Settings.StackToChestsPreferredMode，Player.cs:337；
   *  config.json 键 "StackToChestsPreferredMode"（Main.cs:4244/4576 持久化），默认 Quick）。
   *  背包侧"堆叠至附近宝箱"按钮行为：quick=只堆箱内已有类型 / smart=相似物品按
   *  分类层送最匹配箱（QuickStacking.cs:421-440）；右键循环（Main.cs:41297-41301
   *  CycleQuickStackMode + 音效 10 menuOpen） */
  quickStackMode: 'quick' | 'smart';
  /** 手柄右摇杆平移四档（R4-13,PlayerInputProfile.cs:59-61/:227-228——缺省
   *  OnAlways(2)?★键盘缺省 Hold(0)、手柄缺省 OnAlways;本仓单输入轴取键盘档。
   *  运行时四档已 1:1(Game.ts PanControl 段),此键管持久化——曾刷新即丢 */
  panControlMode: number;              // ButtonControlMode.cs 枚举序：0=Hold 1=Click 2=OnAlways 3=OffAlways（★旧注"0=OffAlways..."系误记;消费 Game.ts 平移四档门按此序）
  /** 设置版本号（R4-14,M57:4241 Put("LastLaunchedVersion",325)——迁移按 >= 门;
   *  本仓迁移仍字段嗅探,此键先落语义锚,后续迁移改造消费） */
  settingsVersion: number;
  // ---- 游戏说明书按钮（Web 便利档,原版无对应物）----
  /** 已读过说明书（点过"我知道了"）——红点气泡熄灭;false=气泡闪烁中 */
  manualSeen: boolean;
  /** 永久隐藏说明书（勾选"不再显示"后落真）——按钮整体不建;设置页可重开 */
  manualHidden: boolean;
  /** LoadoutShare 首用提示可见性（Player.Settings.ShowLoadoutShareHint 静态默认 true;
   *  config.json 持久化 M57:4303 Put/:4645 Get;DisableLoadoutShareHint Player.cs:389-393
   *  首次共享置否——R4-14 清偿,曾会话态） */
  showLoadoutShareHint: boolean;
  // ---- 触屏/移动端操控(mobile-adaptation-plan docs/mobile-adaptation-plan.md 模块⑤;
  //      ★隔离纪律:coarse=false 的桌面会话全部不消费——写入面只有 MobileControls/
  //      HudScale 的触屏分支) ----
  /** 触屏摇杆浮动模式(true=左半屏下半热区任意触点即盘心[官方手游习惯];
   *  false=固定底盘+外扩 40px 受理)。消费:MobileControls 摇杆起手判定 */
  touchJoystickFloat: boolean;
  /** 触控按钮透明度 [0.35,1]（CSS 变量 --mbtn-alpha;默认 0.82） */
  touchButtonAlpha: number;
  /** 触控按钮尺寸倍率 [0.8,1.3]（--mbtn-scale;默认 1）——操控层不吃 mobileUiScale,
   *  独立因子才保得住 ≥44pt 最小触达红线 */
  touchButtonSize: number;
  /** 触屏长按时长 ms [200,700]（tooltip 长按预览与槽位拿起共用;Input 世界触摸的
   *  右键交互长按维持 400ms 原语义,P0 末统一接参） */
  touchLongPressMs: number;
  /** 智能光标触屏初值（用户定案 2026-08-28=开启）:isTouchDevice 会话进世界时
   *  赋给 smartCursor.wanted 初值;桌面路径恒 false 不消费。Settings 可改 */
  touchSmartCursorDefault: boolean;
  /** HUD 缩放档:'auto'=按视口判定 D0/T1(iPad)/T2(横屏)/T3(竖屏);t1-t3=手动钉档。
   *  消费:HudScale.ts→data-huds/--huds 与 mobileUiScale() 档位读数 */
  hudScaleMode: 'auto' | 't1' | 't2' | 't3';
  /** HUD 缩放微调 [0.85,1.15]:离散档之上的乘法微调(不做连续缩放——小屏连续值
   *  会露出面板悬空缝隙类缺陷,离散步进可控) */
  hudScaleFactor: number;
  /** 操作模式(2026-08-29 用户需求"默认按设备调整,可手动切换"):
   *  auto=按 pointer:coarse/maxTouchPoints 判定;touch=强制触屏档(虚拟控件层+
   *  紧凑 HUD+世界触摸合成);keyboard=强制键鼠档(整页桌面几何+恢复指针+停用
   *  触摸合成)。消费口唯一=core/input/touchMode.resolveTouchMode */
  touchOpMode: 'auto' | 'touch' | 'keyboard';
  /** ★SW-AY1 #10 快速丢弃三态（IngameOptions menu[223]=Left Shift / menu[224]=
   *  Left Control / menu[253]=Disabled；Main.cs:51444-51466 循环切换。缺省
   *  Left Control = ItemSlot.Options 缺省（ItemSlot.cs:28-30 DLS=true/DQT=false）。
   *  映射消费=SlotActions.quickTrashOptionsOf → UI.altMoveClick AltClickEnv.opts） */
  quickTrashMode: 'leftControl' | 'leftShift' | 'disabled';
  /** ★SW-AZ1 2026-09-06 附近箱参与制作开关（Player.Settings.CraftFromNearbyChests，
   *  Player.cs:355 默认 true；config.json 键 "CraftFromNearbyChests" Main.cs:4297/:4642）。
   *  ★作用域（Recipe.cs:375-407 逐行核实）：false 只旁路【③附近 bank（盒/弹体）+
   *  ④600px 世界箱】；①当前开箱容器（:378-381）与②虚空袋 bank4（:382-385）不受此
   *  开关管。原版开关面 = 制作列表旁 ChestCraft 图标钮（CraftingUI.
   *  DrawCraftFromNearbyChestsToggle CraftingUI.cs，Main.cs:42442；tooltip
   *  GameUI.CraftFromNearbyChestsOn/Off 官译）；本仓设置面落 Settings 页 game 组。
   *  消费：vanillaRecipes.craftSourcesFor 的 nearbyChestsEnabled 门 */
  craftFromNearbyChests: boolean;
  /** ★SW-FX30 刀②(2026-09-11)合成视图切换控制(Player.Settings.CraftingGridControl,
   *  Player.cs:363;config.json 键 "CraftingControlMode" Main.cs:4295/:4640)。
   *  切换钮右键循环(CraftingUI.DrawGridToggle CraftingUI.cs:322-331)。
   *  ★SW-FX41(2026-09-12)缺省回切 Modern:原版缺省 Modern(Player.cs:363),FX30 期
   *  因 modern 窗族未建而缺省 classic(偏差备案);NewCraftingUI 窗族已落地
   *  (UI.ts vinvBuildModernCraft),缺省回切原版值——存量档无此键者取新缺省。
   *  ★BJ83(2026-09-14)修订本键 FX41「已存 classic 档保留用户意志」条款：持久化
   *  classic 未必=用户意志(FX30 窗口期整对象序列化把缺省烤档),load() 尾部一次性
   *  迁移清偿(见 craftingGridControlMigrated)。
   *  ★RB29(2026-09-15)再修订:BJ83 迁移【退役】——迁移无法区分「烤档 classic」与
   *  「用户右键切换钮显式 classic」,用户实报显式 classic 于 BJ83 后首次 load 被无声
   *  翻 modern(回归1;探针 _fx28-guide-regress P0 实证)。BJ83 目标人群(烤档卡宫格)
   *  在 09-14 起的每次 load 已全部迁移+落旗,退役不再伤及;未知归属 classic 档保持
   *  classic=忠实存档(classic 域自 FX30 刀②+BJ85 功能面完满);新档缺省仍 modern。 */
  craftingGridControl: 'classic' | 'modern';
  /** ★2026-09-07 背包布局灰度 flag → ★SW-FX39(2026-09-11)缺省转正:vanilla(原版
   *  1.4.5.7 布局,UI.ts buildVanillaInventoryPanel)为缺省;classic=旧自创布局退居
   *  回退旗——会话覆盖 ?invlayout=legacy(别名,等值 classic;探针/回退直达)或
   *  ?invlayout=classic(历史名,仍收),load() 内改内存不落盘。运行期切换走
   *  options.onChange → rebuildInventoryPanel。退役计划:过渡一个版本后摘
   *  buildInventoryPanel classic 构建器与 legacy/classic URL 旗(见 SW-FX39 报告)。 */
  inventoryLayout: 'classic' | 'vanilla';
  /** ★SW-FX51 退役刀迁移标记：classic→vanilla 一次性迁移已执行（防显式切回被再迁移） */
  inventoryLayoutMigrated?: boolean;
  /** ★BJ83(2026-09-14) FX30 窗口期烤档迁移标记：craftingGridControl classic→modern
   *  一次性迁移已执行（防显式切回被再迁移）——判例同 inventoryLayoutMigrated。
   *  ★RB29(2026-09-15)迁移块退役（见 craftingGridControl 注）：本旗仅余历史档
   *  记账价值,保留字段防旧档键位漂移,不再有写点。 */
  craftingGridControlMigrated?: boolean;
  /** ★BJ305(2026-09-23)帧率显示开关（用户明令新功能,原版无对应物=Web 便利档,缺省关）。
   *  开启后画面底部中央显示实时帧率——消费=Renderer.drawFpsReadout（HUD 绘制相读
   *  本开关门禁,关=零绘制开销）;数据源=Game.fps（最近 60 帧 rAF 均值唯一数据源,
   *  Game.render 每帧按本开关注入 renderer.fpsReadout）。设置行=Settings game 组
   *  渲染帧率上限行后（帧率族相邻） */
  fpsDisplay: boolean;
  /** ★后台继续运行（2026-09-28 用户需求:后台挂机——切后台 rAF 停发=世界冻结的
   *  Web 缺口;原版无对应物=Web 便利档,缺省开）。消费=Game.onPumpMsg 泵门四条件
   *  之一（document.hidden ∧ 本开关 ∧ playWhenUnfocused ∧ !paused → fixedUpdate
   *  驱动+跳过渲染）。与失焦播放独立并存——两开关都开才后台活（失焦播放关=失焦
   *  即自暂停,泵尊重暂停）。off=泵消息忽略=旧行为（回前台首帧大 dt 由既有
   *  elapsed 0.25s 钳兜住）。已知代价=后台挂机即真实 CPU 消耗（用户目的本身）;
   *  Chrome 高负载后台页节流提示可忽略 */
  backgroundRun: boolean;
}

const KEY = 'sandboxworld.options';

/** ★SW-AY1 #10 Quick Trash 三态全集（menu[224] Left Control / menu[223] Left Shift /
 *  menu[253] Disabled——显示文案键对齐 IngameOptions 循环终态） */
export const QUICK_TRASH_MODES: readonly OptionsData['quickTrashMode'][] =
  ['leftControl', 'leftShift', 'disabled'];

/** Quick Trash 三态循环（IngameOptions Main.cs:51454-51466 1:1：Disabled→
 *  Left Control→Left Shift→Disabled——即本表正序循环；缺省档 Left Control 点一下
 *  到 Left Shift，再点 Disabled，再点回 Left Control） */
export function cycleQuickTrashMode(mode: OptionsData['quickTrashMode']): OptionsData['quickTrashMode'] {
  return QUICK_TRASH_MODES[(QUICK_TRASH_MODES.indexOf(mode) + 1) % QUICK_TRASH_MODES.length];
}

export class OptionsStore {
  data: OptionsData = {
    musicVol: 1,      // Main.cs:1432 musicVolume = 1f（R24 勘误：曾 0.35）
    sfxVol: 1,
    ambientVol: 1,    // Main.cs:1413 ambientVolume = 1f（旧存档无此键走默认）
    uiScale: 1,
    devMode: false,
    pvpEnabled: false,
    // ★BJ695（2026-10-19 用户令「默认帧率上限 120fps」）：缺省 60→120。60Hz 屏
    // 机器=cap≥屏率 ⇒ FrameBeat minK=1 每 vsync 渲一次,行为与 cap=60 逐位全等
    // （无任何变化）;高刷屏渲染力不足机=v5/v6 容量降档（beat 对齐顺延+p50 持续
    // 超载降 k）稳驻 60 档=与旧缺省同效;游戏逻辑 fixedUpdate 恒 60Hz 与渲染解耦
    // （速度零耦合）。已持久化选项的用户不受影响（Object.assign 覆盖缺省）。
    // 缺省 60 系保守残留（interp 已转正缺省开+贴线抖动终局修复后的配套缺省）。
    frameCap: 120,
    frameSkipMode: 'subtle',
    renderScale: 1,
    renderScaleAuto: true,
    renderMode: 'auto',
    waveQuality: 3,   // Main.cs:405 WaveQuality = 3（默认高）
    pvpTeam: 0,
    lang: DEFAULT_LANG,
    langExplicit: false,
    smartCursorMode: 'toggle',
    smartAxeAfterPickaxe: false,
    smartBlocksEnabled: false,        // Player.cs:326 static bool 默认 false（R24 勘误）
    smartHoldCanReleaseMidUse: false, // Player.cs:330 static bool 默认 false（R24 勘误）
    gameZoom: 1,                      // Main.cs:256 默认 1f（★2026-09-08 对齐原版默认;旧 1.25=相机基线遗留,存档已持久化值不受影响）
                                      // 视野补偿档）为既有行为，域钳 [1,2]
    backgrounds: true,
    swayInWind: true,
    resourceBarStyle: 'fancy',
    titleMusic: 'current',
    minimapFrame: 'Default',
    mapMinimapAlpha: 1,      // Main.cs:892
    mapOverlayAlpha: 0.35,   // Main.cs:896
    keybinds: {},
    reversedUpDownArmorSetBonuses: false,   // Main.cs:253
    doorOpeningPreference: 'enabled',       // DoorOpeningHelper.cs:216
    autoReuseAllItems: false,               // Main.cs:241
    showItemText: true,                     // Main.cs:1194
    builderAutoActuatorDisabled: false,     // builderAccStatus[2]=0（启用）
    builderAutoPaintDisabled: false,        // builderAccStatus[3]=0（启用）
    invasionProgressMode: 2,                // Main() 静默初始化 Main.cs:65992
    placementPreview: true,                 // Main.cs:1298
    highlightNewItems: true,                // ItemSlot.cs:31
    mouseShowBuildingGrid: false,           // Main.cs:257
    dialoguePortraitMode: 'detailed',
    opaqueBoxBehindTooltips: true,          // Main.cs:249
    hoverControl: 'hold',                   // ★SW-FX14 Player.cs:357 缺省 Hold
    showBossBarHealthText: true,            // ★SW-FX14 BigProgressBarSystem.cs:76 缺省 true
    flashyEffectsInterface: true,           // ★SW-FX14 Main.cs:443 缺省 true（死设置,见字段注）
    lightMode: 'color',                     // ★SW-FX14 Lighting.cs:19 静态初值 Color
    autoSave: true,                         // Main.cs:1196
    autoSaveIntervalMin: 10,                // 原版 600000ms 恒值
    autoPause: false,                       // Main.cs:1298（RB7 勘误,曾写 1280）
    playWhenUnfocused: false,               // Main.cs:268（失焦全静=原版默认）
    quickStackMode: 'quick',                // Player.Settings.StackToChestsPreferredMode（QuickStackToNearbyChests）
    panControlMode: 0,                      // Hold（PlayerInputProfile.cs:59 键盘缺省）
    settingsVersion: 325,                   // LastLaunchedVersion（M57:4241）
    manualSeen: false,                      // 说明书未读=红点气泡闪烁
    manualHidden: false,                    // 说明书按钮显示中
    showLoadoutShareHint: true,             // Player.Settings.ShowLoadoutShareHint 默认 true（Player.cs:367）
    doubleTapDash: true,                    // ★BJ508 DashControl 缺省 AllowDoubleTap（Player.cs:365）
    // 触屏组(mobile-adaptation-plan 模块⑤;SC 默认开=2026-08-28 用户定案)
    touchJoystickFloat: false,              // 固定罗盘摇杆=2026-08-29 官方截图定案;浮动转可选档
    touchButtonAlpha: 0.82,
    touchButtonSize: 1,
    touchLongPressMs: 380,                  // tooltip/拿起共用(World 触摸右键恒 400)
    touchSmartCursorDefault: true,          // SC 触屏默认开(用户定案)
    hudScaleMode: 'auto',
    hudScaleFactor: 1,
    touchOpMode: 'auto',                    // 默认按设备
    quickTrashMode: 'leftControl',          // ★SW-AY1 #10（ItemSlot.cs:28-30 缺省档）
    craftFromNearbyChests: true,            // ★SW-AZ1 2026-09-06（Player.cs:355 缺省 true）
    craftingGridControl: 'modern',           // ★SW-FX41 缺省回切原版缺省 Modern(Player.cs:363;FX30 偏差备案清偿)
    inventoryLayout: 'vanilla',             // ★SW-FX39(2026-09-11)缺省转正(原版布局;旧自创退 ?invlayout=legacy 回退旗)
    fpsDisplay: false,                      // ★BJ305 帧率显示缺省关（用户明令新功能）
    backgroundRun: true,                    // ★后台继续运行缺省开（2026-09-28 用户需求后台挂机;与 playWhenUnfocused 组合门见 Game 泵域注）
  };
  loaded = false;
  /** ★红队 F1(2026-09-08):?invlayout= 会话覆盖生效中——set() 序列化时把
   *  inventoryLayout 剥回 persistedLayout(存档侧值),覆盖不落盘污染用户选择 */
  private urlOverrideLayout = false;
  /** 存档侧的 inventoryLayout(覆盖前快照;显式 set 本键时更新;null=load 未跑) */
  private persistedLayout: 'classic' | 'vanilla' | null = null;
  private listeners: Array<(d: OptionsData) => void> = [];

  /** ★BJ335（2026-09-24）：返回退订函数。本 store 是模块级长存单例,订阅闭包的
   *  context 连着订阅方的作用域链——【每轮重建的订阅方】(UI buildHud/vinv 构建器)
   *  不退订时,旧闭包携整轮 context 岛滞留(快照实测 listeners 数组按轮累积,
   *  每轮游离 vinv 面板 ~400 节点被钉)。返回值旧调用方可忽略,兼容。 */
  onChange(fn: (d: OptionsData) => void): () => void {
    this.listeners.push(fn);
    if (this.loaded) fn(this.data);
    return () => this.removeListener(fn);
  }

  /** 退订(2026-08-29 mobile-adaptation-plan:P0 前 UI 单例长存无退订点;
   *  MobileControls 每世界销毁重建,不退订则旧闭包逐世界累积)。返回退订是否命中 */
  removeListener(fn: (d: OptionsData) => void): boolean {
    const i = this.listeners.indexOf(fn);
    if (i >= 0) { this.listeners.splice(i, 1); return true; }
    return false;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await kvGet(KEY);
      // 浏览器语言探测:仅当「从未显式选过语言」(无持久化设置,或 langExplicit
      // 未置位——含带默认 lang 落盘的老档)时,按 navigator.languages 优先级匹配
      // 注册表 12 语言一次(探测未命中保持 DEFAULT_LANG);设置面板显式选择即置
      // langExplicit=true 落盘,此后永久尊重用户选择不再自动覆盖
      let autoDetectLang = !raw;
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OptionsData> & { frameSkip?: boolean };
        // 迁移:旧布尔 frameSkip(2026-08-18 当天版本)→ 三态
        if (typeof parsed.frameSkip === 'boolean') {
          parsed.frameSkipMode = parsed.frameSkip ? 'on' : 'off';
          delete parsed.frameSkip;
        }
        if (!parsed.langExplicit) autoDetectLang = true;
        Object.assign(this.data, parsed);
      }
      if (autoDetectLang) {
        // 桌面壳 localeHint 优先(2026-08-29 用户定案默认中文;macOS --lang 不可靠)
        // ★2026-09-02 环境守卫:node 单测/worker 无 window——裸读曾 ReferenceError
        //   被 load 的 try/catch 吞掉→后续全部钳制/归一化被静默跳过(r24 zoom+map-skins 双红根因)
        const shellHint = typeof window !== 'undefined'
          ? (window as unknown as { sandboxDesktop?: { localeHint?: string } }).sandboxDesktop?.localeHint
          : undefined;
        const detected = detectBrowserLang(shellHint ? [shellHint] : undefined);
        if (detected) this.data.lang = detected;
      }
      // 语言归一化:旧数字 legacyId → culture 名;非法值落 en-US(对齐原版 LoadSettings)
      this.data.lang = normalizeLang(this.data.lang);
      // 水波质量钳 [0,3]（Main.cs:4466-4473 LoadSettings 同款卫门）
      if (typeof this.data.waveQuality !== 'number'
        || !Number.isFinite(this.data.waveQuality)) this.data.waveQuality = 3;
      this.data.waveQuality = Math.min(3, Math.max(0, Math.round(this.data.waveQuality)));
      // Game Zoom 钳 [1,2]（Main.cs:16986-16990 键调整钳/:62953 消费端钳同款；
      // 旧档无键走默认，NaN/越界回默认）
      if (typeof this.data.gameZoom !== 'number' || !Number.isFinite(this.data.gameZoom)) {
        this.data.gameZoom = 1;
      }
      this.data.gameZoom = Math.min(2, Math.max(1, this.data.gameZoom));
      // R4-13：PanControl 档位钳 [0,3]（PlayerInputProfile.cs:194-201 读回卫门同语义）
      if (typeof this.data.panControlMode !== 'number'
        || !Number.isFinite(this.data.panControlMode)) this.data.panControlMode = 0;
      this.data.panControlMode = Math.min(3, Math.max(0, Math.round(this.data.panControlMode)));
      // 小地图皮肤归一化:存档里的未知/旧键 → Default
      // (SelectionHolder.SetActiveFrame(string) 未命中 → Options.Values.First() = Default)
      if (!(MINIMAP_FRAME_SKINS as readonly string[]).includes(this.data.minimapFrame)) {
        this.data.minimapFrame = 'Default';
      }
      // 地图透明度钳 [0.01,1]（Main.cs:54961-54968/:54999-55006 DrawMap 原地钳同款；
      // 旧档无键走默认，NaN/越界回默认）
      for (const k of ['mapMinimapAlpha', 'mapOverlayAlpha'] as const) {
        const def = k === 'mapMinimapAlpha' ? 1 : 0.35;
        if (typeof this.data[k] !== 'number' || !Number.isFinite(this.data[k])) {
          this.data[k] = def;
        }
        this.data[k] = Math.min(1, Math.max(0.01, this.data[k]));
      }
      // 键位表清洗（未知 action/非字符串项剔除；空表=该 action 无绑定——2026-08-21
      // 起 1:1 原版：反选清空的合法态存活读档，不再回落默认）
      this.data.keybinds = sanitizeKeybinds(this.data.keybinds);
      // ★SW-BN2 2026-09-07 缺省迁移卫门：旧档里"与旧缺省全等"的条目摘除→落新缺省
      // （Inventory=Escape/Grapple=E 对齐 PlayerInput.cs:2074-2075;真自定义不丢）
      this.data.keybinds = migrateLegacyDefaults(this.data.keybinds);
      // M14 枚举归一化（旧档/手改坏值 → 原版默认）
      const DOOR_PREFS = ['enabled', 'gamepadOnly', 'disabled'] as const;
      if (!DOOR_PREFS.includes(this.data.doorOpeningPreference as typeof DOOR_PREFS[number])) {
        this.data.doorOpeningPreference = 'enabled';
      }
      const PORTRAITS = ['detailed', 'closeUp', 'fullBodyRetro', 'disabled'] as const;
      if (!PORTRAITS.includes(this.data.dialoguePortraitMode as typeof PORTRAITS[number])) {
        this.data.dialoguePortraitMode = 'detailed';
      }
      if (typeof this.data.renderScale !== 'number'
        || ![0, 1, 0.75, 0.66, 0.5].includes(this.data.renderScale)) this.data.renderScale = 1;
      if (typeof this.data.renderScaleAuto !== 'boolean') this.data.renderScaleAuto = true;
      if (this.data.invasionProgressMode !== 0 && this.data.invasionProgressMode !== 1) {
        this.data.invasionProgressMode = 2;
      }
      if (!Number.isFinite(this.data.autoSaveIntervalMin) || this.data.autoSaveIntervalMin < 1) {
        this.data.autoSaveIntervalMin = 10;
      }
      if (this.data.quickStackMode !== 'quick' && this.data.quickStackMode !== 'smart') {
        this.data.quickStackMode = 'quick';
      }
      // 建造饰品开关（终零波）：坏值回默认「启用」
      if (typeof this.data.builderAutoActuatorDisabled !== 'boolean') this.data.builderAutoActuatorDisabled = false;
      if (typeof this.data.builderAutoPaintDisabled !== 'boolean') this.data.builderAutoPaintDisabled = false;
      // LoadoutShare 首用提示（R4-14 清偿）：坏值回默认「显示」
      if (typeof this.data.showLoadoutShareHint !== 'boolean') this.data.showLoadoutShareHint = true;
      // ★BJ508 双击冲刺档（DashControl）：坏值回缺省 AllowDoubleTap（Player.cs:365）
      if (typeof this.data.doubleTapDash !== 'boolean') this.data.doubleTapDash = true;
      // 失焦播放（Main.cs:268 默认 false=失焦暂停+全静；坏值回原版默认）
      if (typeof this.data.playWhenUnfocused !== 'boolean') this.data.playWhenUnfocused = false;
      // ---- 触屏字段卫门(mobile-adaptation-plan 模块⑤;坏值回默认防 NaN 入渲染链) ----
      if (typeof this.data.touchButtonAlpha !== 'number'
        || !Number.isFinite(this.data.touchButtonAlpha)) this.data.touchButtonAlpha = 0.82;
      this.data.touchButtonAlpha = Math.min(1, Math.max(0.35, this.data.touchButtonAlpha));
      if (typeof this.data.touchButtonSize !== 'number'
        || !Number.isFinite(this.data.touchButtonSize)) this.data.touchButtonSize = 1;
      this.data.touchButtonSize = Math.min(1.3, Math.max(0.8, this.data.touchButtonSize));
      if (typeof this.data.touchLongPressMs !== 'number'
        || !Number.isFinite(this.data.touchLongPressMs)) this.data.touchLongPressMs = 380;
      this.data.touchLongPressMs = Math.min(700, Math.max(200, Math.round(this.data.touchLongPressMs)));
      if (typeof this.data.touchJoystickFloat !== 'boolean') this.data.touchJoystickFloat = true;
      if (typeof this.data.touchSmartCursorDefault !== 'boolean') this.data.touchSmartCursorDefault = true;
      if (!(['auto', 't1', 't2', 't3'] as const).includes(this.data.hudScaleMode)) {
        this.data.hudScaleMode = 'auto';
      }
      if (typeof this.data.hudScaleFactor !== 'number'
        || !Number.isFinite(this.data.hudScaleFactor)) this.data.hudScaleFactor = 1;
      this.data.hudScaleFactor = Math.min(1.15, Math.max(0.85, this.data.hudScaleFactor));
      if (!(['auto', 'touch', 'keyboard'] as const).includes(this.data.touchOpMode)) {
        this.data.touchOpMode = 'auto';
      }
      // ★SW-AY1 #10 Quick Trash 三态卫门：旧档缺键/坏值 → 原版缺省 Left Control
      if (!QUICK_TRASH_MODES.includes(this.data.quickTrashMode)) {
        this.data.quickTrashMode = 'leftControl';
      }
      // ★SW-AZ1 2026-09-06 附近箱参与制作开关：坏值回原版默认 true（Player.cs:355）
      if (typeof this.data.craftFromNearbyChests !== 'boolean') this.data.craftFromNearbyChests = true;
      // ★SW-FX30 刀② 合成视图切换控制：坏值回原版缺省 Modern（★SW-FX41 回切;
      //  Player.cs:363——FX30 期回 classic 系窗族未建备案,随本刀撤）
      if (this.data.craftingGridControl !== 'classic' && this.data.craftingGridControl !== 'modern') {
        this.data.craftingGridControl = 'modern';
      }
      // ★BJ83(2026-09-14)→★RB29(2026-09-15) FX30 窗口期烤档一次性迁移【已退役】。
      //  BJ83 原文（存档取证）：craftingGridControl 缺省曾为 'classic'（c88f0de9 09-11
      //  FX30）→ 944cb78d 09-12 FX41 翻 'modern'；持久化=整对象序列化（set() 全量
      //  stringify），窗口期内任意一次 set() 都把当时缺省 classic 烤入存档 ⇒ BJ83 于
      //  load() 此处一次性 classic→modern+落旗。RB29 退役定谳（用户实报回归1+
      //  scripts/_fx28-guide-regress.mjs P0 相实证：存档 classic+无旗 → reload 后
      //  control=modern）：①该迁移对存储态无法区分「烤档 classic」与「用户右键切换钮
      //  的显式 classic」（Player.Settings.CraftingGridControl 写点只有右键循环
      //  CraftingUI.cs:322-331 与本仓 Settings 面）——显式选择被无声没收=真回归；
      //  ②BJ83 目标人群（烤档卡 FX30 宫格）在 09-14 起的每次 load 已全部迁移+落旗，
      //  块撤除对已迁移档零影响（幂等已发生过，旗保留）；③classic 域自 FX30 刀②+
      //  BJ85 起功能面完满（经典列表/网格/切换钮/站点三态），未知归属 classic 档保持
      //  classic=忠实存档；④新档缺省仍 modern（上方初值，Player.cs:363），modern 体验
      //  面不变。被 BJ83 翻档的用户恢复路径：右键切换钮一轮即回 classic（本退役后
      //  持久化不再被任何 load 卫门冲写）。
      // ★SW-FX14 2026-09-10 M14 收尾 4 项卫门（坏值回原版缺省——vanilla config 读回
      //  无范围守卫是 enum 裸转产物,实用缺省=初值,此处按缺省收敛）
      if (this.data.hoverControl !== 'hold' && this.data.hoverControl !== 'click') {
        this.data.hoverControl = 'hold';                     // Player.cs:357
      }
      if (typeof this.data.showBossBarHealthText !== 'boolean') this.data.showBossBarHealthText = true;
      if (typeof this.data.flashyEffectsInterface !== 'boolean') this.data.flashyEffectsInterface = true;
      if (!(['color', 'white', 'retro', 'trippy'] as const).includes(this.data.lightMode)) {
        this.data.lightMode = 'color';                       // Lighting.cs:19
      }
      // ★SW-FX39(2026-09-11)缺省转正：坏值回新缺省 vanilla；URL 会话覆盖见 try 外
      //  （★红队 F1 清偿：覆盖值只改内存,落盘通道 set() 序列化时剥回存档侧值
      //  (persistedLayout),否则会话内任意一次 set() 把覆盖值连带写档污染用户选择）。
      //  ★SW-FX51(2026-09-11) 退役刀一次性迁移（用户拍板 vanilla 转正生效于存量档）：
      //  转正前旧缺省 classic 被自动落盘=非用户意志；迁移后经 Settings 显式切回
      //  classic 由 migrated 旗保留（不再二次迁移）。迁移即经 set() 走 saveTimer 落盘。
      if (!this.data.inventoryLayoutMigrated && this.data.inventoryLayout === 'classic') {
        this.data.inventoryLayout = 'vanilla';
        this.data.inventoryLayoutMigrated = true;
        void this.set('inventoryLayoutMigrated', true);
      }
      if (this.data.inventoryLayout !== 'vanilla' && this.data.inventoryLayout !== 'classic') {
        this.data.inventoryLayout = 'vanilla';
      }
      // ★BJ305 帧率显示：坏值回缺省「关」（布尔卫门,同 playWhenUnfocused 等家族判式）
      if (typeof this.data.fpsDisplay !== 'boolean') this.data.fpsDisplay = false;
      // ★后台继续运行（2026-09-28）：坏值回缺省「开」（布尔卫门同族）
      if (typeof this.data.backgroundRun !== 'boolean') this.data.backgroundRun = true;
      this.persistedLayout = this.data.inventoryLayout;
    } catch { /* 无存档用默认 */ }
    // URL 会话覆盖在 try 外执行:kvGet 拒绝(隐私模式)时覆盖仍生效(红队 F7)
    if (this.persistedLayout === null) this.persistedLayout = this.data.inventoryLayout;
    {
      // ★SW-FX39:回退旗面——legacy = classic 别名(旧自创布局退居回退旗后统一叫法;
      //  classic 历史名仍收,灰度期探针/测试零改动)。vanilla=缺省态显式钉回(探针双档复用)。
      const qLayout = typeof location !== 'undefined'
        ? new URLSearchParams(location.search).get('invlayout') : null;
      if (qLayout === 'vanilla' || qLayout === 'classic' || qLayout === 'legacy') {
        this.data.inventoryLayout = qLayout === 'legacy' ? 'classic' : qLayout;
        this.urlOverrideLayout = true;
      }
    }
    this.emit();
  }

  /** 改值并持久化（局部更新）。
   *  ★持久化防抖(2026-08-13 泄露 review):Settings 滑杆 input 事件每像素
   *  一次 set——此前每次 JSON.stringify 全量 + IndexedDB 写,拖动即 IO 风暴。
   *  内存值与 emit 仍即时(所见即所得),落盘合并到停手后 400ms */
  private saveTimer: ReturnType<typeof setTimeout> | 0 = 0;
  async set<K extends keyof OptionsData>(key: K, value: OptionsData[K]) {
    this.data[key] = value;
    // ★红队 F1:显式 set 本键 = 用户意志,更新落盘基准
    if (key === 'inventoryLayout') this.persistedLayout = value as OptionsData['inventoryLayout'];
    this.emit();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = 0;
      // URL 会话覆盖生效中:序列化剥离覆盖键(写回存档侧值,覆盖仅本次会话)
      const persisted = this.persistedLayout;
      const payload: OptionsData = this.urlOverrideLayout && persisted !== null
        ? { ...this.data, inventoryLayout: persisted }
        : this.data;
      kvSet(KEY, JSON.stringify(payload)).catch(() => { /* 存储不可用则仅内存生效 */ });
    }, 400) as unknown as ReturnType<typeof setTimeout>;
  }

  private emit() {
    for (const fn of this.listeners) fn(this.data);
  }
}

export const options = new OptionsStore();
