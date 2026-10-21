// Journey 力量菜单（UICreativePowersMenu 的 DOM 版）。
// 标杆 Terraria.GameContent.UI.States/UICreativePowersMenu.cs + CreativePowers.cs：
//   菜单结构 = 主条（复制/研究/时间/天气/个人 + 感染蔓延 toggle + 敌人难度滑杆）
//   + 时间条（冻结 + 黎明/正午/黄昏/午夜 + 时间速度滑杆）
//   + 天气条（风滑杆 + 冻结风 + 雨滑杆 + 冻结雨）+ 个人条（上帝/放置范围/刷怪率滑杆）。
// 数值语义 1:1（滑杆映射/档位/持久化全走 JourneyPowers.ts 纯函数）；
// 视觉为本仓面板风格（横滑杆代原版竖滑杆，偏差登记）。
// 文案直接用原版 CreativePowers.* l10n 键（zh-Hans/en-US 均在 vanilla 包内）。
//
// M8（2026-08-20）：category 1 复制页 = 旅程物品浏览器
//   （UICreativeInfiniteItemsDisplay 1:1：搜索框 + 11 互斥过滤器 + 固定排序链 +
//    虚拟滚动图标网格——过滤/排序/搜索纯逻辑在 JourneyBrowser.ts）。
// M9（2026-08-20）：联机同步——所有力量改动经 net/journeySync.ts 上报服务器权威态；
//   权限门（PowerPermissionLevel）非授权点击拒绝提示；房主面板附权限调节区。
import type { Game } from '../core/Game';
import { Lang } from '../i18n/Lang';
import { getModLoadResult } from '../mods/loader';
import { ITEM_DEFS, VANILLA_ITEM_KEY_BY_ID } from '../data/items';
import {
  JourneyPowersState, targetTimeRate, timeRateSliderOf, strengthOfDifficultySlider,
  spawnRateMultiplier, shouldDisableSpawns, windOfSlider, sliderOfWind,
  TIME_RATE_PRESETS, DIFFICULTY_PRESETS, SPAWN_RATE_PRESETS, WIND_PRESETS, RAIN_PRESETS,
  JOURNEY_POWER_REGISTRY,
} from '../world/JourneyPowers';
import { Clock } from '../world/World';
import { snapshotJourneyWorld } from '../net/journeySync';
import {
  JOURNEY_FILTER_KEYS, FILTER_L10N, runBrowserQuery, browserClickPlan,
  type JourneyFilterKey,
} from './JourneyBrowser';
import { claimUiBlocking, type UiBlockingRelease } from './uiBlockingClaim';   // ★BJ704-G7 件5

/** 复制面板入包授予（★SW-FX15 起承担 shift 臂=TransferToBackpack + 无 UI 兜底；
 *  普点整组上光标走 UI.grantCraftToCursor，见 makeCell/browserClickPlan）——
 *  整组 = maxStack（ItemSlot.cs:749-765 cursorOverride==7 臂经 Player.GetItem
 *  QuickTransferFromSlot 入包——合并/空格全程 maxStack 钳制，溢出落地）。
 *  R24 修复：曾 s.stack+=stack 直加可造 1099/999 超限堆叠入档。
 *  export 供 redblue 回归直测钳制语义 */
export function giveItem(game: Game, internalId: number, stack: number): void {
  const inv = game.player.inv;
  const def = ITEM_DEFS[internalId] as { maxStack?: number } | undefined;
  const want = Math.min(stack, Math.max(1, def?.maxStack ?? 999));
  // ★preferHotbar（2026-09-02 神圣种子 UX 批）：授予先热栏——否则热栏满时新物
  //  落背包尾,玩家手里仍是旧物（两轮行为日志实证）。原版 GetItem 落位序=首选槽
  //  优先族,热栏直落是最近可用近似（光标臂已按原版补齐,见 makeCell 注）。
  const left = inv.add(internalId, want, undefined, undefined, false, true);
  const key = (def as { key?: string } | undefined)?.key;
  if (left > 0 && key) {
    game.spawnDrop(game.player.cx, game.player.cy,
      key, left);   // 溢出落地（GetOrDropItem 尾 RequestNewItem :7202 velocity=null→随机,BJ326）
  }
  game.cb.onInventoryChanged?.();
}

/** 原版 id → 内部 item id（懒建反向表；vanilla id 空间经 vi_ 前缀/vid 字段桥接） */
let vidReverse: Map<number, number> | null = null;
function internalIdOfVid(vid: number): number {
  if (!vidReverse) {
    vidReverse = new Map();
    for (const [idStr, def] of Object.entries(ITEM_DEFS)) {
      const d = def as { vid?: number; key?: string };
      if (d.vid != null) {
        if (!vidReverse.has(d.vid)) vidReverse.set(d.vid, +idStr);
      } else if (d.key) {
        const m = /^vi_(\d+)_/.exec(d.key);
        if (m && !vidReverse.has(+m[1])) vidReverse.set(+m[1], +idStr);
      }
    }
  }
  // ★2026-09-02 哨兵 -1：反查不中返回 -1（非 0）。历史注（方案 A 前）:ITEM_DEFS[0]
  //  曾是合法 def 位,旧 ??0 让魔力水晶(vid 109→def0)在浏览器 mousedown 的 !internalId
  //  门被当「无此物」静默退场。★方案 A（BJ264）重排后 0=空洞位（vi_ 键 def vid 回填
  //  ⑥ 恒在,反查不中=真无此物）,-1 语义不变仍为唯一正确哨兵
  return vidReverse.get(vid) ?? -1;
}

/** PowerId 常量（CreativePowerManager.Initialize 注册序 :90-104 = JOURNEY_POWER_REGISTRY id） */
const PID: Record<string, number> = Object.fromEntries(
  JOURNEY_POWER_REGISTRY.map((p) => [p.cls, p.id]),
) as Record<string, number>;

const CSS = `
.sw-jp-panel { pointer-events:auto; position:fixed; left:50%; top:50%;
  transform:translate(-50%,-50%); width:min(480px, 92vw); max-height:82vh;
  background:rgba(33,43,79,0.93); border:2px solid #7d92d6; border-radius:6px;
  color:#e8ecf8; padding:12px; display:flex; flex-direction:column;
  box-shadow:0 0 0 2px rgba(10,14,30,0.8), 0 6px 28px rgba(0,0,0,0.65);
  font-size:13px; z-index:130; }
.sw-jp-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.sw-jp-head .sw-title { flex:1; margin-bottom:0; font-size:15px; }
.sw-jp-strip { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; }
.sw-jp-strip button { margin:0; padding:4px 8px; font-size:12px; flex:none; }
.sw-jp-strip button.sel { background:linear-gradient(#5a6ad0,#3a4aa0); border-color:#8d9cf0; }
.sw-jp-strip button.ton { background:linear-gradient(#3a7a4a,#2a5a38); border-color:#6dcf82; }
.sw-jp-body { overflow-y:auto; display:flex; flex-direction:column; gap:10px; }
.sw-jp-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.sw-jp-row .lbl { min-width:64px; color:#9fb0dd; flex:none; }
.sw-jp-row input[type=range] { flex:1; min-width:120px; margin:0; }
.sw-jp-val { min-width:76px; text-align:right; font-variant-numeric:tabular-nums; flex:none; }
.sw-jp-presets { display:flex; gap:3px; flex:none; }
.sw-jp-presets button { margin:0; padding:2px 6px; font-size:11px; }
.sw-jp-note { font-size:11px; color:#8a97c4; }
/* ---- M8 浏览器（UICreativeInfiniteItemsDisplay 布局 1:1 的 DOM 化）---- */
.sw-jp-search { display:flex; gap:4px; align-items:center; }
.sw-jp-search input { flex:1; margin:0; font-size:12px; padding:4px 8px; }
.sw-jp-search button { margin:0; padding:4px 8px; width:auto; font-size:12px; flex:none; }
.sw-jp-filters { display:flex; flex-wrap:wrap; gap:3px; }
.sw-jp-filters button { margin:0; padding:3px 7px; font-size:11px; flex:none; }
.sw-jp-filters button.sel { background:linear-gradient(#5a6ad0,#3a4aa0); border-color:#8d9cf0; }
.sw-jp-scroll { position:relative; overflow-y:auto; height:264px; flex:none;
  background:rgba(18,24,48,0.55); border:1px solid #39406e; border-radius:4px; }
.sw-jp-spacer { }   /* 高度 = 行数×44（撑滚动条） */
.sw-jp-cells { position:absolute; left:0; top:0; right:0; }
.sw-jp-cell { position:absolute; width:44px; height:44px; margin:0; padding:1px;
  display:flex; align-items:center; justify-content:center; overflow:hidden;
  background:transparent; border:1px solid transparent; border-radius:4px; }
.sw-jp-cell:hover { border-color:#8d9cf0; background:rgba(90,106,208,0.25); }
.sw-jp-cell.partial { opacity:0.45; cursor:default; }   /* 原版 context 34 暗槽 */
.sw-jp-cell.new::after { content:''; position:absolute; inset:0;
  border:1px solid #ffd76a; border-radius:4px; pointer-events:none; }  /* newAndShiny */
.sw-jp-cell canvas { image-rendering:pixelated; }
.sw-jp-cell .fb { font-size:10px; color:#9fb0dd; line-height:1.1; text-align:center;
  overflow:hidden; }
/* ---- M9 权限区（房主）---- */
.sw-jp-perm { display:flex; flex-direction:column; gap:4px; }
.sw-jp-perm-grid { display:flex; flex-wrap:wrap; gap:3px; }
.sw-jp-perm-grid button { margin:0; padding:2px 6px; font-size:11px; flex:none; }
.sw-jp-perm-grid button.l1 { border-color:#c9a94e; }
.sw-jp-perm-grid button.l0 { border-color:#c94e4e; opacity:0.85; }
`;

let cssInjected = false;
function ensureCss(): void {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

let panel: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
/** 主条当前类别（OpenMainSubCategory 枚举序：1 复制/2 研究/3 时间/4 天气/5 难度/6 个人） */
let category = 0;
/** 面板打开期间注册的清理回调（浏览器滚动监听/延迟刷新定时器） */
let panelCleanup: Array<() => void> = [];

/** M9：研究进度外部变化（队友上报）→ 面板开着则刷新浏览器（Game.onJourneyUnlock 调用） */
export function journeyBrowserNotifyResearchChanged(): void {
  browserRefresh?.();
}
let browserRefresh: (() => void) | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const t = (key: string, fallback: string, ...args: (string | number)[]): string => {
  const v = Lang.text(key, ...args);
  return v === key ? fallback : v;
};

/** 当前倍率/读数行（原版滑杆悬停文本 1:1：xN / 风 mph / 雨 P0） */
function timeRateText(rate: number): string { return `x${rate}`; }
function difficultyText(v: number): string { return `x${v.toFixed(2)}`; }
function spawnRateText(slider: number): string {
  return shouldDisableSpawns(slider)
    ? t('CreativePowers.NPCSpawnRateSliderEnemySpawnsDisabled', '禁用')
    : `x${spawnRateMultiplier(slider).toFixed(2)}`;
}
function windText(wind: number): string {
  const num = Math.trunc(wind * 50);
  if (num < 0) return t('GameUI.EastWind', `（东风 ${Math.abs(num)} mph）`, Math.abs(num));
  if (num > 0) return t('GameUI.WestWind', `（西风 ${num} mph）`, num);
  return t('CreativePowers.WindNone', '无风');
}
function rainText(maxRaining: number): string { return `${Math.round(maxRaining * 100)}%`; }

/** ★A9(2026-10-14)→★BJ704-G7 件5(2026-10-21)：uiBlocking 保存/还原迁栈律单源
 *  (uiBlockingClaim——旧模块级 journeySavedBlocking 非栈式已退役;交错开关序防御,
 *  不可达声明见 uiBlockingClaim.ts 头注) */
let journeyBlockingRelease: UiBlockingRelease | null = null;

export function openJourneyPowersPanel(game: Game): void {
  ensureCss();
  if (panel) { closeJourneyPowersPanel(); return; }
  journeyBlockingRelease = claimUiBlocking(game.input);
  if (category === 0) category = 3;   // 默认开时间页（原版主条无默认选中，UI 取常用页）
  panel = el('div', 'sw-jp-panel');
  const head = el('div', 'sw-jp-head');
  head.appendChild(el('div', 'sw-title', t('Mods.SandboxWorld.JourneyPowers.Title', '力量菜单')));
  const closeBtn = el('button', 'sw-btn', '✕');
  closeBtn.style.cssText = 'margin:0; padding:4px 10px; width:auto; font-size:12px; flex:none;';
  closeBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); closeJourneyPowersPanel(); });
  head.appendChild(closeBtn);
  panel.appendChild(head);
  const strip = el('div', 'sw-jp-strip');
  panel.appendChild(strip);
  const body = el('div', 'sw-jp-body');
  panel.appendChild(body);

  // ---- M9 上报助手（单机 = 纯本地；联机 = 乐观生效 + 上报服务器权威态）----
  const net = () => game.net;
  /** IsAvailableForPlayer 门（CreativePowersHelper :182-197）；拒绝时 toast
     原版仅悬停附注 CantUsePowerBecauseOfNoPermissionFromServer——DOM 以点击反馈近似 */
  const usePower = (cls: string): boolean => {
    const id = PID[cls];
    if (id !== undefined && !game.journeyPowerAvailable(id)) {
      game.cb.onToast?.(t('CreativePowers.CantUsePowerBecauseOfNoPermissionFromServer', '你无权使用此能力'));
      return false;
    }
    return true;
  };
  /** 世界态上报（ASharedSliderPower.PushChange：本端缓存先行 + 服务器广播他人） */
  const pushWorld = (): void => {
    const w = game.world;
    if (w?.isJourney && w.journeyPowers && w.weather) {
      net()?.sendJourneyWorldState(snapshotJourneyWorld(w));
    }
  };
  /** 个人态上报（APerPlayerTogglePower.SyncOnePlayer 语义） */
  const pushPersonal = (jp: JourneyPowersState): void => {
    net()?.sendJourneyPersonalState({
      godmode: jp.godmode,
      farPlacementRange: jp.farPlacementRange,
      spawnRateSlider: jp.spawnRateSlider,
    });
  };

  const render = () => {
    const w = game.world;
    if (!w) return;
    const jp: JourneyPowersState = w.journeyPowers;
    const wx = w.weather;
    strip.textContent = '';
    // ---- 主条（CreateMainPowerStrip :167-213 语义）----
    const cats: Array<[number, string, string]> = [
      [1, t('Mods.SandboxWorld.JourneyPowers.CatDuplicate', '复制'), 'CreativePowers.InfiniteItemsCategory'],
      [2, t('Mods.SandboxWorld.JourneyPowers.CatResearch', '研究'), 'CreativePowers.ResearchItemsCategoryClosed'],
      [3, t('Mods.SandboxWorld.JourneyPowers.CatTime', '时间'), 'CreativePowers.TimeCategory'],
      [4, t('Mods.SandboxWorld.JourneyPowers.CatWeather', '天气'), 'CreativePowers.WeatherCategory'],
      [5, t('Mods.SandboxWorld.JourneyPowers.CatDifficulty', '敌人难度'), 'CreativePowers.DifficultySlider_Closed'],
      [6, t('Mods.SandboxWorld.JourneyPowers.CatPersonal', '个人'), 'CreativePowers.PersonalCategory'],
    ];
    for (const [v, label, hoverKey] of cats) {
      const b = el('button', 'sw-btn' + (category === v ? ' sel' : ''), label);
      b.title = t(hoverKey, label);
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        category = category === v ? 0 : v;   // ToggleCategory：同键再点收起
        game.sfx.play('menuTick', 1);        // SoundID 12（原版按钮通用音）
        render();
      });
      strip.appendChild(b);
    }
    // 感染蔓延 toggle（主条独立按钮，:208）
    const bSpread = el('button', 'sw-btn' + (jp.stopBiomeSpread ? ' ton' : ''),
      jp.stopBiomeSpread
        ? t('CreativePowers.StopBiomeSpread_Enabled', '感染蔓延已禁用')
        : t('CreativePowers.StopBiomeSpread_Disabled', '感染蔓延已启用'));
    bSpread.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (!usePower('StopBiomeSpreadPower')) return;
      jp.stopBiomeSpread = !jp.stopBiomeSpread;
      pushWorld();
      game.sfx.play('menuTick', 1);
      render();
    });
    strip.appendChild(bSpread);

    body.textContent = '';
    // ---- 子页 ----
    if (category === 3) {
      // 时间条（CreateTimePowerStrip :319-337）
      const r1 = el('div', 'sw-jp-row');
      r1.appendChild(el('div', 'lbl', t('CreativePowers.FreezeTime_Description', '停止时间流逝')));
      const bFreeze = el('button', 'sw-btn' + (w.journeyFreezeTime ? ' ton' : ''),
        w.journeyFreezeTime
          ? t('CreativePowers.FreezeTime_Enabled', '时间已经定格')
          : t('CreativePowers.FreezeTime_Disabled', '时间恢复流逝'));
      bFreeze.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (!usePower('FreezeTime')) return;
        w.journeyFreezeTime = !w.journeyFreezeTime;   // 复用 T 键同源状态（勿建第二套）
        pushWorld();
        game.sfx.play('menuTick', 1);
        render();
      });
      r1.appendChild(bFreeze);
      body.appendChild(r1);
      // 四时段按钮（StartDayImmediately 族 :774-864；Main.SkipToTime :64657）
      const r2 = el('div', 'sw-jp-row');
      const times: Array<[string, string, number, boolean, 1 | 2 | 3 | 4]> = [
        ['StartDayImmediately', '黎明', Clock.DAWN, true, 1],
        ['StartNoonImmediately', '正午', 0.5, true, 2],
        ['StartNightImmediately', '黄昏', Clock.DUSK, false, 3],
        ['StartMidnightImmediately', '午夜', 0, false, 4],
      ];
      for (const [key, fb, tod, isDay, which] of times) {
        const b = el('button', 'sw-btn', t(`CreativePowers.${key}`, fb));
        b.title = t(`CreativePowers.${key}_Description`, fb);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          // ASharedButtonPower.RequestUse：空载荷上报——服务器中继全员（含发起端）
          // 各端本地 SkipToTime；单机直跳
          if (!usePower(key)) return;
          if (net()) net()!.sendJourneyTimeSkip(which);
          else game.skipToTime(tod, isDay);   // Main.SkipToTime（:64657-64671）
          game.sfx.play('menuTick', 1);
        });
        r2.appendChild(b);
      }
      body.appendChild(r2);
      // 时间速度滑杆（ModifyTimeRate :866-1005；状态 = world.journeyTimeRate 整数档）
      const r3 = el('div', 'sw-jp-row');
      r3.appendChild(el('div', 'lbl', t('Mods.SandboxWorld.JourneyPowers.TimeSpeed', '时间速度')));
      const presets = el('div', 'sw-jp-presets');
      for (const [k, v] of [['x1', TIME_RATE_PRESETS.x1], ['x12', TIME_RATE_PRESETS.x12], ['x24', TIME_RATE_PRESETS.x24]] as const) {
        const b = el('button', 'sw-btn', k);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (!usePower('ModifyTimeRate')) return;
          w.journeyTimeRate = targetTimeRate(v);   // :931-946 点击档
          pushWorld();
          game.sfx.play('menuTick', 1);
          render();
        });
        presets.appendChild(b);
      }
      r3.appendChild(presets);
      const slider = el('input') as HTMLInputElement;
      slider.type = 'range';
      slider.min = '0'; slider.max = '1'; slider.step = '0.01';
      slider.value = String(timeRateSliderOf(w.journeyTimeRate));
      slider.addEventListener('input', () => {
        // 连续滑杆（UIVerticalSlider 语义）：值 = round(Remap(s,0,1,1,24))
        w.journeyTimeRate = targetTimeRate(+slider.value);
        val.textContent = timeRateText(w.journeyTimeRate);
      });
      slider.addEventListener('change', () => { pushWorld(); game.sfx.play('menuTick', 1); render(); });
      r3.appendChild(slider);
      const val = el('div', 'sw-jp-val', timeRateText(w.journeyTimeRate));
      r3.appendChild(val);
      body.appendChild(r3);
    } else if (category === 4) {
      // 天气条（CreateWeatherPowerStrip :356-374）
      // 风滑杆（ModifyWindDirectionAndStrength :1186-1316）
      const r1 = el('div', 'sw-jp-row');
      r1.appendChild(el('div', 'lbl', t('Mods.SandboxWorld.JourneyPowers.Wind', '风力')));
      const windPresets = el('div', 'sw-jp-presets');
      for (const [k, v] of [
        [t('CreativePowers.WindWest', '西风'), WIND_PRESETS.west],
        [t('CreativePowers.WindNone', '无风'), WIND_PRESETS.none],
        [t('CreativePowers.WindEast', '东风'), WIND_PRESETS.east],
      ] as const) {
        const b = el('button', 'sw-btn', k);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (!usePower('ModifyWindDirectionAndStrength')) return;
          const wind = windOfSlider(v);
          wx.windSpeedTarget = wind;
          wx.windSpeedCurrent = wind;   // :1197 current=target 同置
          pushWorld();
          game.sfx.play('menuTick', 1);
          render();
        });
        windPresets.appendChild(b);
      }
      r1.appendChild(windPresets);
      const slider = el('input') as HTMLInputElement;
      slider.type = 'range';
      slider.min = '0'; slider.max = '1'; slider.step = '0.01';
      slider.value = String(sliderOfWind(wx.windSpeedTarget));   // :1202 GetLerpValue(-0.8,0.8,target)
      slider.addEventListener('input', () => {
        const wind = windOfSlider(+slider.value);
        wx.windSpeedTarget = wind;
        wx.windSpeedCurrent = wind;
        val.textContent = windText(wind);
      });
      slider.addEventListener('change', () => { pushWorld(); game.sfx.play('menuTick', 1); render(); });
      r1.appendChild(slider);
      const val = el('div', 'sw-jp-val', windText(wx.windSpeedTarget));
      r1.appendChild(val);
      const bFreezeWind = el('button', 'sw-btn' + (jp.freezeWind ? ' ton' : ''),
        jp.freezeWind
          ? t('CreativePowers.FreezeWindDirectionAndStrength_Enabled', '风况变化已禁用')
          : t('CreativePowers.FreezeWindDirectionAndStrength_Disabled', '风况变化已启用'));
      bFreezeWind.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (!usePower('FreezeWindDirectionAndStrength')) return;
        jp.freezeWind = !jp.freezeWind;
        pushWorld();
        game.sfx.play('menuTick', 1);
        render();
      });
      r1.appendChild(bFreezeWind);
      body.appendChild(r1);
      // 雨滑杆（ModifyRainPower :1318-1446；GetSliderValueInner = cloudAlpha :1341）
      const r2 = el('div', 'sw-jp-row');
      r2.appendChild(el('div', 'lbl', t('Mods.SandboxWorld.JourneyPowers.Rain', '降雨')));
      const rainPresets = el('div', 'sw-jp-presets');
      for (const [k, v] of [
        [t('CreativePowers.WeatherMonsoon', '雨季'), RAIN_PRESETS.monsoon],
        [t('CreativePowers.WeatherDrizzle', '细雨'), RAIN_PRESETS.drizzle],
        [t('CreativePowers.WeatherClearSky', '晴天'), RAIN_PRESETS.clearSky],
      ] as const) {
        const b = el('button', 'sw-btn', k);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (!usePower('ModifyRainPower')) return;
          applyRainSlider(game, v);
          pushWorld();
          game.sfx.play('menuTick', 1);
          render();
        });
        rainPresets.appendChild(b);
      }
      r2.appendChild(rainPresets);
      const slider2 = el('input') as HTMLInputElement;
      slider2.type = 'range';
      slider2.min = '0'; slider2.max = '1'; slider2.step = '0.01';
      slider2.value = String(wx.cloudAlpha);
      slider2.addEventListener('input', () => {
        applyRainSlider(game, +slider2.value);
        val2.textContent = rainText(wx.cloudAlpha);
      });
      slider2.addEventListener('change', () => { pushWorld(); game.sfx.play('menuTick', 1); render(); });
      r2.appendChild(slider2);
      const val2 = el('div', 'sw-jp-val', rainText(wx.cloudAlpha));
      r2.appendChild(val2);
      const bFreezeRain = el('button', 'sw-btn' + (jp.freezeRain ? ' ton' : ''),
        jp.freezeRain
          ? t('CreativePowers.FreezeRainPower_Enabled', '雨情变化已禁用')
          : t('CreativePowers.FreezeRainPower_Disabled', '雨情变化已启用'));
      bFreezeRain.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (!usePower('FreezeRainPower')) return;
        jp.freezeRain = !jp.freezeRain;
        pushWorld();
        game.sfx.play('menuTick', 1);
        render();
      });
      r2.appendChild(bFreezeRain);
      body.appendChild(r2);
    } else if (category === 5) {
      // 敌人难度滑杆（DifficultySliderPower :1007-1184）
      const r1 = el('div', 'sw-jp-row');
      r1.appendChild(el('div', 'lbl', t('Mods.SandboxWorld.JourneyPowers.Difficulty', '敌人强度')));
      const presets = el('div', 'sw-jp-presets');
      const diffPresets: Array<[string, number]> = [
        [t('UI.Master', '大师'), DIFFICULTY_PRESETS.master],
        [t('UI.Expert', '专家'), DIFFICULTY_PRESETS.expert],
        [t('UI.Normal', '经典'), DIFFICULTY_PRESETS.normal],
        [t('UI.Creative', '旅行'), DIFFICULTY_PRESETS.journey],
      ];
      for (const [label, v] of diffPresets) {
        const b = el('button', 'sw-btn', label);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (!usePower('DifficultySliderPower')) return;
          jp.difficultySlider = v;   // :1055-1077 四档点击
          pushWorld();
          game.sfx.play('menuTick', 1);
          render();
        });
        presets.appendChild(b);
      }
      r1.appendChild(presets);
      const slider = el('input') as HTMLInputElement;
      slider.type = 'range';
      slider.min = '0'; slider.max = '1'; slider.step = '0.01';
      slider.value = String(jp.difficultySlider);
      slider.addEventListener('input', () => {
        jp.difficultySlider = +slider.value;
        val.textContent = difficultyText(strengthOfDifficultySlider(jp.difficultySlider));
      });
      slider.addEventListener('change', () => { pushWorld(); game.sfx.play('menuTick', 1); render(); });
      r1.appendChild(slider);
      const val = el('div', 'sw-jp-val', difficultyText(strengthOfDifficultySlider(jp.difficultySlider)));
      r1.appendChild(val);
      body.appendChild(r1);
      body.appendChild(el('div', 'sw-jp-note',
        t('Mods.SandboxWorld.JourneyPowers.DifficultyNote', '调整敌人的强度')));
    } else if (category === 6) {
      // 个人条（CreatePersonalPowerStrip :339-354）
      const r1 = el('div', 'sw-jp-row');
      r1.appendChild(el('div', 'lbl', t('CreativePowers.Godmode_Description', '获得无敌效果！')));
      const bGod = el('button', 'sw-btn' + (jp.godmode ? ' ton' : ''),
        jp.godmode
          ? t('CreativePowers.Godmode_Enabled', '无敌模式已启用')
          : t('CreativePowers.Godmode_Disabled', '无敌模式已禁用'));
      bGod.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (!usePower('GodmodePower')) return;
        jp.godmode = !jp.godmode;
        pushPersonal(jp);
        game.sfx.play('menuTick', 1);
        render();
      });
      r1.appendChild(bGod);
      body.appendChild(r1);
      const r2 = el('div', 'sw-jp-row');
      r2.appendChild(el('div', 'lbl', t('Mods.SandboxWorld.JourneyPowers.Placement', '放置范围')));
      const bFar = el('button', 'sw-btn' + (jp.farPlacementRange ? ' ton' : ''),
        jp.farPlacementRange
          ? t('CreativePowers.InfinitePlacementRange_Enabled', '扩大放置范围')
          : t('CreativePowers.InfinitePlacementRange_Disabled', '正常放置范围'));
      bFar.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (!usePower('FarPlacementRangePower')) return;
        jp.farPlacementRange = !jp.farPlacementRange;
        pushPersonal(jp);
        game.sfx.play('menuTick', 1);
        render();
      });
      r2.appendChild(bFar);
      body.appendChild(r2);
      // 刷怪率滑杆（SpawnRateSliderPerPlayerPower :1584-1749）
      const r3 = el('div', 'sw-jp-row');
      r3.appendChild(el('div', 'lbl', t('Mods.SandboxWorld.JourneyPowers.SpawnRate', '刷怪率')));
      const presets = el('div', 'sw-jp-presets');
      for (const [k, v] of [['x10', SPAWN_RATE_PRESETS.x10], ['x1', SPAWN_RATE_PRESETS.x1], ['x0', SPAWN_RATE_PRESETS.x0]] as const) {
        const b = el('button', 'sw-btn', k);
        b.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (!usePower('SpawnRateSliderPerPlayerPower')) return;
          jp.spawnRateSlider = v;   // :1683-1698 三档点击
          pushPersonal(jp);
          game.sfx.play('menuTick', 1);
          render();
        });
        presets.appendChild(b);
      }
      r3.appendChild(presets);
      const slider = el('input') as HTMLInputElement;
      slider.type = 'range';
      slider.min = '0'; slider.max = '1'; slider.step = '0.01';
      slider.value = String(jp.spawnRateSlider);
      slider.addEventListener('input', () => {
        jp.spawnRateSlider = +slider.value;
        val.textContent = spawnRateText(jp.spawnRateSlider);
      });
      slider.addEventListener('change', () => { pushPersonal(jp); game.sfx.play('menuTick', 1); render(); });
      r3.appendChild(slider);
      const val = el('div', 'sw-jp-val', spawnRateText(jp.spawnRateSlider));
      r3.appendChild(val);
      body.appendChild(r3);
    } else if (category === 1) {
      // 复制菜单（UICreativeInfiniteItemsDisplay 1:1：搜索 + 过滤 + 排序 + 虚拟滚动）
      buildJourneyBrowser(game, body);
      // M9 权限区（联机 + 房主；原版权限由服务器配置文件承担，此处为房主 UI 直改）
      if (net()?.active && net()!.policy.isHost) buildJourneyPermissions(game, body);
    } else if (category === 2) {
      // 研究入口（复用 ResearchUI）
      const r1 = el('div', 'sw-jp-row');
      const bRes = el('button', 'sw-btn', t('CreativePowers.ResearchItemsCategoryClosed', '打开研究菜单'));
      bRes.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        closeJourneyPowersPanel();
        import('./ResearchUI').then((m) => m.openResearchPanel(game));
      });
      r1.appendChild(bRes);
      body.appendChild(r1);
    }
  };
  render();

  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  (document.querySelector('.sw-root') ?? document.body).appendChild(panel);
  escHandler = (e) => { if (e.code === 'Escape') closeJourneyPowersPanel(); };
  window.addEventListener('keydown', escHandler);
  game.sfx.play('menuTick', 1);
}

// ---------------------------------------------------------------------------
// M8 浏览器（UICreativeInfiniteItemsDisplay.BuildInfinitesMenuContents :163-202 +
// UIDynamicItemCollection 视口裁剪 :90-107 的 DOM 等价：44px 槽格 + 只渲染可视行±1）
// ---------------------------------------------------------------------------

/** 槽格边长（UIDynamicItemCollection.sizePerEntryX/Y = 44） */
const CELL = 44;

function buildJourneyBrowser(game: Game, body: HTMLElement): void {
  const research = game.research;
  // 搜索框（UIWrappedSearchBar——空文本 = UI.PlayerNameSlot 原版默认；右键清空→本仓 ✕ 钮）
  const searchRow = el('div', 'sw-jp-search');
  const input = el('input') as HTMLInputElement;
  input.maxLength = 50;   // UISearchBar.MaxInputLength 默认 50
  input.placeholder = t('UI.PlayerNameSlot', '名字：');
  const clearBtn = el('button', 'sw-btn', '✕');
  clearBtn.title = t('Mods.SandboxWorld.JourneyPowers.ClearSearch', '清空');
  searchRow.appendChild(input);
  searchRow.appendChild(clearBtn);
  body.appendChild(searchRow);
  // 过滤器条（UICreativeItemsInfiniteFilteringOptions：40px 按钮横排；互斥单选）
  const filterRow = el('div', 'sw-jp-filters');
  body.appendChild(filterRow);
  const countLine = el('div', 'sw-jp-note');
  body.appendChild(countLine);
  const scroll = el('div', 'sw-jp-scroll');
  const spacer = el('div', 'sw-jp-spacer');
  const cellsLayer = el('div', 'sw-jp-cells');
  scroll.appendChild(spacer);
  scroll.appendChild(cellsLayer);
  body.appendChild(scroll);

  let search: string | null = null;
  let activeFilter: JourneyFilterKey | null = null;   // 原版 UI 互斥单选（:87-99）
  let list: number[] = [];
  let rows = 0;
  const filterButtons = new Map<JourneyFilterKey, HTMLButtonElement>();

  /** 源集 = 全量原版 vid 空间（2026-09-02 用户拍板：道具搜索=开发者模式例外——
   *  原版 ForEachItemWithResearchProgress（ItemsSacrificedUnlocksTracker :48-57）
   *  只列已捐物品,圣种这类未到手道具永远搜不到;本仓面板语义=全部道具可搜可取,
   *  研究进度仍作徽标展示（partial 暗槽态保留）,点击授予不再受研究门约束。
   *  原版纪律本身不动：世界内获取/掉落/商店照旧 1:1）。
   *  ★P6:mod 物品(vid≡30000+ 恒等域)入池——授予链 internalIdOfVid 对 mod vid
   *  identity 成立;名称渲染走既定文本回退。 */
  const sourceVids = (): number[] => {
    const base = Object.keys(VANILLA_ITEM_KEY_BY_ID).map(Number);
    const alloc = getModLoadResult()?.allocation;
    return alloc ? [...base, ...alloc.items.values()] : base;
  };

  const rebuild = () => {
    list = runBrowserQuery(sourceVids(), {
      search,
      activeFilters: activeFilter ? [activeFilter] : [],
    }, research);
    const total = sourceVids().length;
    countLine.textContent = list.length === total
      ? t('Mods.SandboxWorld.JourneyPowers.DuplicateCount', `可复制物品 ${total} 件`, total)
      : t('Mods.SandboxWorld.JourneyPowers.DuplicateFiltered',
        `显示 ${list.length} / ${total} 件`, list.length, total);
    layout();
  };

  let rafPending = false;
  const renderVisible = () => {
    rafPending = false;
    const perLine = Math.max(1, Math.floor(scroll.clientWidth / CELL));
    rows = Math.ceil(list.length / perLine);
    spacer.style.height = `${rows * CELL}px`;
    const st = scroll.scrollTop;
    const first = Math.max(0, Math.floor(st / CELL) - 1);              // 上方多渲染 1 行
    const last = Math.min(rows, Math.ceil((st + scroll.clientHeight) / CELL) + 1);  // 下方 1 行
    cellsLayer.textContent = '';
    for (let row = first; row < last; row++) {
      for (let col = 0; col < perLine; col++) {
        const idx = row * perLine + col;
        if (idx >= list.length) break;
        cellsLayer.appendChild(makeCell(game, list[idx], col * CELL, row * CELL));
      }
    }
  };
  const layout = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(renderVisible);
  };

  // 搜索（OnSearchContentsChanged :556-560——逐字符即时过滤，无防抖）
  input.addEventListener('input', () => {
    search = input.value.trim() === '' ? null : input.value.trim();
    rebuild();
  });
  clearBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    input.value = '';
    search = null;
    rebuild();
    input.focus();
  });
  // 过滤器按钮（singleFilterButtonClick :81-100：点非活动项先 Clear 再 Toggle；
  // 点活动项 = 关闭 → 无活动过滤器）
  for (const key of JOURNEY_FILTER_KEYS) {
    const b = el('button', 'sw-btn', t(FILTER_L10N[key], key));
    b.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      activeFilter = activeFilter === key ? null : key;
      game.sfx.play('menuTick', 1);
      for (const [k2, btn] of filterButtons) {
        btn.classList.toggle('sel', k2 === activeFilter);
      }
      rebuild();
    });
    filterRow.appendChild(b);
    filterButtons.set(key, b);
  }
  const onScroll = () => layout();
  scroll.addEventListener('scroll', onScroll, { passive: true });
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  // 图标懒加载重试（atlas.vicon 未就绪 → 文本兜底；三次延迟刷新覆盖后台解码窗口）
  const timers = [320, 900, 2000].map((ms) =>
    window.setTimeout(() => layout(), ms));
  panelCleanup.push(() => {
    scroll.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    for (const ti of timers) window.clearTimeout(ti);
    browserRefresh = null;
  });
  browserRefresh = rebuild;
  rebuild();
  input.focus();
}

/** 单格（UICreativeItemGrid.DrawSlot :18-34：fully=context29 亮/部分=34 暗；
 *  悬停/取用清 newly 高亮；partial 不可取） */
function makeCell(game: Game, vid: number, x: number, y: number): HTMLButtonElement {
  const research = game.research;
  const info = research.tryGetSacrificeNumbers(vid);
  const fully = info ? info.have >= info.need : false;
  const newly = research.isNewlyResearched(vid);
  const name = Lang.itemName(vid) ?? `#${vid}`;
  const b = el('button', 'sw-jp-cell'
    + (fully ? '' : ' partial')
    + (newly && fully ? ' new' : ''));
  b.style.left = `${x}px`;
  b.style.top = `${y}px`;
  b.title = fully
    ? name
    : `${name}（${info ? `${Math.min(info.have, info.need)}/${info.need}` : '?'}）`;
  const ar = game.atlas?.vicon(vid);
  if (ar) {
    const c = el('canvas') as HTMLCanvasElement;
    c.width = 36; c.height = 36;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    const s = Math.min(36 / ar.sw, 36 / ar.sh);
    const w = ar.sw * s, h = ar.sh * s;
    cx.drawImage(ar.img, ar.sx, ar.sy, ar.sw, ar.sh, (36 - w) / 2, (36 - h) / 2, w, h);
    b.appendChild(c);
  } else {
    b.appendChild(el('div', 'fb', name.slice(0, 4)));
  }
  b.addEventListener('mouseenter', () => research.clearNewlyResearchedStatus(vid));
  // ★2026-09-02 开发者模式例外（用户拍板）：授予不再受研究门约束（原版 fully 门
  //  与"只列已捐"配套；本仓全量池后 partial 槽也要能取,徽标只作进度展示）
  // ★SW-FX15 点击臂 1:1（browserClickPlan——ItemSlot.cs:1459/:1599-1603/:749-765/:1215-1226）：
  //  普点 = 光标空才整组上光标（音 7 Grab）；光标占用 = 无操作（原版同款不合并）；
  //  Shift 点 = 整组入包（音 12）。OnlyNeedOneInInventory 族（任务鱼等）恒 1 件。
  //  2026-09-02 注「本仓无光标槽」已失效——SW-AZ1 2026-09-06 落了光标持物镜像槽。
  b.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    const internalId = internalIdOfVid(vid);
    if (internalId < 0) return;   // ★-1 哨兵(0=合法 def 位,v 109 魔力水晶)

    const def = ITEM_DEFS[internalId] as { maxStack?: number } | undefined;
    const ui = (window as unknown as { __swUI?: { heldStack: unknown; grantCraftToCursor(id: number, stack: number): number } }).__swUI;
    const plan = browserClickPlan(vid, e.shiftKey, ui ? !!ui.heldStack : false, def?.maxStack ?? 999);
    if (!plan) return;
    if (plan.to === 'cursor' && ui) ui.grantCraftToCursor(internalId, plan.stack);
    else giveItem(game, internalId, plan.stack);   // 无 UI 实例兜底 = 入包（headless/测试）
    game.sfx.play(plan.sound, 1);
  });
  return b;
}

// ---------------------------------------------------------------------------
// M9 权限区（房主；原版 NetCreativePowerPermissionsModule S→C + 服务器配置文件
// journeypermission_<name>=<level>——本仓房主 UI 直改，语义等价配置行）
// ---------------------------------------------------------------------------

/** 各力量显示键（原版 powerNameKey——CreativePowers.cs 各类） */
const POWER_LABEL_KEY: Record<string, string> = {
  FreezeTime: 'CreativePowers.FreezeTime_Enabled',
  StartDayImmediately: 'CreativePowers.StartDayImmediately',
  StartNoonImmediately: 'CreativePowers.StartNoonImmediately',
  StartNightImmediately: 'CreativePowers.StartNightImmediately',
  StartMidnightImmediately: 'CreativePowers.StartMidnightImmediately',
  GodmodePower: 'CreativePowers.Godmode_Enabled',
  ModifyWindDirectionAndStrength: 'CreativePowers.ModifyWindDirectionAndStrength_Opened',
  ModifyRainPower: 'CreativePowers.ModifyRainPower_Opened',
  ModifyTimeRate: 'CreativePowers.ModifyTimeRate_Opened',
  FreezeRainPower: 'CreativePowers.FreezeRainPower_Enabled',
  FreezeWindDirectionAndStrength: 'CreativePowers.FreezeWindDirectionAndStrength_Enabled',
  FarPlacementRangePower: 'CreativePowers.InfinitePlacementRange_Enabled',
  DifficultySliderPower: 'CreativePowers.DifficultySlider_Opened',
  StopBiomeSpreadPower: 'CreativePowers.StopBiomeSpread_Enabled',
  SpawnRateSliderPerPlayerPower: 'CreativePowers.NPCSpawnRateSlider_Opened',
};

function buildJourneyPermissions(game: Game, body: HTMLElement): void {
  const net = game.net!;
  const box = el('div', 'sw-jp-perm');
  box.appendChild(el('div', 'sw-jp-note', t('Mods.SandboxWorld.JourneyPowers.Permissions', '力量权限（点击切换：所有人 → 仅房主 → 锁定）')));
  const grid = el('div', 'sw-jp-perm-grid');
  box.appendChild(grid);
  body.appendChild(box);
  const levelText = (lv: number): string =>
    lv === 2 ? t('Mods.SandboxWorld.JourneyPowers.PermEveryone', '所有人')
      : lv === 1 ? t('Mods.SandboxWorld.JourneyPowers.PermHost', '仅房主')
        : t('Mods.SandboxWorld.JourneyPowers.PermLocked', '锁定');
  const paint = () => {
    grid.textContent = '';
    for (const p of JOURNEY_POWER_REGISTRY) {
      const lv = net.journeyPermissions[p.id];
      const b = el('button', 'sw-btn'
        + (lv === 1 ? ' l1' : lv === 0 ? ' l0' : ''),
        `${t(POWER_LABEL_KEY[p.cls], p.cls)}：${levelText(lv)}`);
      b.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const next = ((net.journeyPermissions[p.id] + 2) % 3) as 0 | 1 | 2;  // 2→1→0→2
        net.sendJourneyPermission(p.id, next);
        game.sfx.play('menuTick', 1);
        paint();
      });
      grid.appendChild(b);
    }
  };
  paint();
}

/** ModifyRainPower.UpdateInfoFromSliderValueCache（:1327-1337）：
 *  0 → StopRain(instant)；否则 StartRain(instant, slider)（strengthOverride=maxRaining=cloudAlpha） */
function applyRainSlider(game: Game, v: number): void {
  const wx = game.world?.weather;
  if (!wx) return;
  if (v === 0) wx.stopRain(true);
  else wx.startRain(true, v);
}

export function closeJourneyPowersPanel(): void {
  journeyBlockingRelease?.();   // ★BJ704-G7 件5:栈律还原(末出才下写;闭包持开启拍的 input,免 __swGame 重查拍错代实例)
  journeyBlockingRelease = null;
  for (const fn of panelCleanup) fn();
  panelCleanup = [];
  browserRefresh = null;
  panel?.remove();
  panel = null;
  if (escHandler) { window.removeEventListener('keydown', escHandler); escHandler = null; }
}

/** 背包打开时入口按钮可用性（CreativeUI.Draw :98-117：LocalPlayer.difficulty==3 门） */
export function journeyPowersEntryVisible(game: Game): boolean {
  return game.player.appearance?.difficulty === 3;
}
