// 图鉴 UI 面板（DOM）——BJ506 大域对齐刀（2026-10-04）：对照 Terraria.GameContent.UI.States/
// UIBestiaryTest.cs（1457 :1-860 全文亲读定谳；1456 同文件交叉参照）+ UI.Elements/Bestiary/
// 各元素类逐面 1:1（锚号随行）。前一版（M-补齐清单 #2）骨架在、形态自创——本刀按原版栈重排：
//   布局（BuildPage :69-157）：外宽 87.5% max900 min700 / Top180 / 高-220；主 UIPanel 高-90
//   底色 (33,43,79)*0.8 黑框；顶栏 24px=[◀28][▶28][范围面板135 (35,40,83)]…[排序钮114×28]
//   [3][筛选钮114×28][17][搜索栏230]（贴图钮+Wide_Border 悬停框+文字标签）；出口钮 = UI.Back
//   UITextPanel 50%×50 底部居中（MakeExitButton :368-383）；网格区宽 -242 高-4 VAlign1；
//   详情栏 230 宽右侧（高 +12 下垂）；底栏 20px=进度文本(0.8) 叠 ColorBar 滑条 15px
//   （填充 (51,137,255)/底 (35,43,81)，悬停 MouseText 完成度 :183-190）。
//   网格（EntryGrid :37-86 + EntryButton :24-103）：72² 格扇区居中排布；格 = 68² 内盒
//   (OverflowHidden)[Slot_Back→网格底图(原生尺寸居中)→NPC 图标]+左上编号(Top10 Left10
//   scale0.9)+[Slot_Overlay×0.6→Slot_Front]，悬停=[Slot_Selection+Slot_Front 重排+音12
//   :151-170]+MouseText(名字/??? )；锁定=Icon_Locked×0.15（EntryIcon :52-70）。
//   详情页（EntryInfoPage :128-163）：类目序 Nameplate→Portrait→FlavorText→Stats→
//   ItemsFromCatchingNPC→ItemsFromDrops→Misc（GetBestiaryInfoCategory :174-201 枚举序；
//   1457 populator 零 ItemFromCatchingNPC 注册 = 该类目恒空），每类目后 Separator
//   ((89,116,213)*0.9)、末分隔线移除（:151-162）；Stat_Panel(31²,角12条7) 九宫块；
//   头像 193×112（底图 ScaleToFit 拉伸+叠层+Portrait_Front+左上五角星 Stat_Panel 56²，
//   NPCPortraitInfoElement :108-148）；属性卡 = Stat_HP/Knockback/Attack/Defense 四图标
//   (3,0)/(102,0)/(3,35)/(102,35) 值右对齐 + 金币行（value>0 才有：分隔线 y70 + 四币图标
//   y78，NPCStatsReportInfoElement :58-260）；击杀计数 = 旗图(item 321)+数右对齐 30 高块
//   （NPCKillCounterInfoElement :23-89）；掉落行 = 图标+右对掉率（无名字行内文！名字走
//   悬停 item tooltip——本仓以轻量 MouseText 名字近似，全量 tooltip 登记债 B2）。
//   排序弹层（SortingOptionsGrid :37-87）：126 宽右侧列表，可见 7 步，GroupOptionButton
//   114×26 scale0.8，选中 (152,175,235)/未选 InventoryDefaultColor(63,65,151)×0.7，
//   再点同项回退默认步 0=ByUnlockState（:89-115，无高亮、文案"解锁"）。
//   筛选弹层（FilteringOptionsGrid :43-174）：60 钮（ByUnlockState→ByBoss→ByRareCreature→
//   57 环境标签，RegisterFilters populator :493-503 注册序）12/行 32² 间距 2 内边 6；
//   可用性 = ForcedDisplay ?? 存在已解锁命中条目（:193-208），不可用 = Icon_Tags_Shadow
//   帧(0,4)×0.2 且从激活集除名；悬停 MouseText 名称（:210-225）。
//   搜索（UIWrappedSearchBar :44-118 + UISearchBar）：[22²钮+边框悬停][框面板 (35,40,83)
//   +输入+SearchCancel]；空态灰字占位 = UI.PlayerNameSlot（未传 emptyText 的原版默认）；
//   聚焦框变金 (255,231,69)（OnStartTakingInput）。
//   交互：滚轮 = 详情栏滚动（UIBestiaryTest.ScrollWheel :850-854 → UpdateScrollbar；
//   ★原版无滚轮翻页——旧自创面拆除，翻页只走 ◀▶）；筛选/排序/搜索变更【不重置】页偏移
//   （FillBestiarySpaceWithEntries → FixBestiaryRange(+0) 只钳制 :37-46）；选中条目无
//   持久视觉（_selectedEntryButton 写后不读）；详情未选 = 空面板（FillInfoForEntry(null)）。
//   排序链（EntrySorter.Compare）：优先步 → 其余步按注册序兜底（DataStructures/EntrySorter.cs
//   :17-36）；注册序 = UnlockState→BestiaryID→Alphabetical→NetId→Attack→Defense→Coins→
//   HP→Rarity（populator RegisterSortSteps :472-488；1456 :476-486 同序——旧表序错，本刀勘正）。
// 已闭合登记（数据层 → UI 消费，前批）：解锁档/杀数门/creditId 归并/排序 ID 九键/稀有度星/
//   头像背景偏好/装饰叠层/出没环境——语义未动；本刀动：筛选全集 60、排序链、百分比文案、
//   掉落行序、网格卡形态、详情类目序、图鉴编号位、锚点规则（重力 NPC 底锚 -8）。
// 键位：Inventory 键位表动作关闭（默认 Esc+E；capture 阶段拦截防 main.ts 暂停键二次消费）；
//   搜索框聚焦时首按 Esc 仅失焦（UISearchBar ToggleTakingText 语义）。
// 登记债（后续批次）：B2/B3 已于 BJ507 闭合——B2 掉落行悬停全量 item tooltip
//   （Main.HoverItem 面：flow 桥 → UI.showFloatingItemTooltip → buildTooltipHtml
//   BJ407 单源；BestiaryNotes 条件行 Main.cs:21539-21547 随行）；B3 dummy 动画
//   （UnlockableNPCEntryIcon.Update：SimulateFirstHover 首帧 + IsPortrait||IsHovered
//   每帧 FindFrame——详情 Portrait 常驻播放（亲读定谳,非悬停门控）/网格卡悬停播放
//   移开冻结;帧域 = Renderer.bestiaryDummyFrameIdx 折叠引擎）。
import { upgradeToBitmap, USE_BITMAP } from '../assets/SpriteAtlas';
import { Lang } from '../i18n/Lang';
import { NPC_NAME_BY_ID } from '../i18n/idNames.generated';
import { BESTIARY_CREDIT_REDIRECT } from '../data/bestiaryStatics.generated';
import { VANILLA_NPCS } from '../data/vanillaNpcs';
import { NPC_TINT_KA, bestiaryDummyFrameIdx } from '../render/Renderer';
// 负 netID 变体的 color/scale/alpha（SetDefaultsFromNetId L7633-7820；
// public/sprites/vanilla-npcnetid.json，与 VanillaSpawner 同源数据）
import vanillaNetIdJson from '../data/vanilla-npcnetid.json';
const NETID_OV: Record<string, { scale?: number; color?: number[]; alpha?: number }> = vanillaNetIdJson;
// NPCBestiaryDrawOffset 全表（tools/extract-npcbestiaryoffset.mjs ← NPCID.cs 三段合并
// 665 条）：图鉴头像逐 NPC 手调（Boss/巨怪 Scale 缩小 / Position 挪位 / Frame 静态帧 /
// Rotation / CustomTexture 手绘替换图；PortraitScale 仅详情档）。Hide 条目已在
// BESTIARY_HIDE_IDS 排除（GetExclusions 不建条目）
import bstDrawOffsetJson from '../data/vanilla-npcbestiaryoffset.json';
const BST_DRAW_OFFSET: Record<string, {
  scale?: number; portraitScale?: number; position?: number[];
  portraitX?: number; portraitY?: number; rotation?: number; frame?: number; customTexture?: string;
  velocity?: number; wet?: boolean;
}> = bstDrawOffsetJson as Record<string, {
  scale?: number; portraitScale?: number; position?: number[];
  portraitX?: number; portraitY?: number; rotation?: number; frame?: number; customTexture?: string;
  velocity?: number; wet?: boolean;
}>;

/** 图鉴 NPC 染色帧缓存（key = sheet|npcId|帧高——负 id 变体各自成键） */
const bstTintCache = new Map<string, HTMLCanvasElement>();
// 热补丁重烘(2026-08-19 素材重制):染色缓存键 `sheetId|…` 不含贴图身份,
// 替换 NPC sheet 后旧染色帧钉死 → 监听应用事件全清(面板重开即新,量小无压力)
if (typeof document !== 'undefined') {
  document.addEventListener('sw:remaster-applied', () => bstTintCache.clear());
}
/** base 帧 + color 二次绘制合一（Main.cs:24527 + NPC.GetColor；XNA 预乘混合在
 *  预乘空间恒等于单张精灵——premult = a·T·Cc + a·T·ka·(1−a·kc)、
 *  α = 1−(1−a·ka)(1−a·kc)（Renderer.xnaCombined 同式，2026-08-21 同类扫描补齐）。
 *  旧三步 lighter 的 α 钳 1 丢面板背景透出（史莱姆 175 果冻感）且漏 ka 基底衰减。
 *  straight=premult/α 钳 255。在离屏合成完再贴回，α 保留 → 卡片底色透出 */
function bstTintedFrame(
  img: ImageBitmap | HTMLImageElement, sheetId: number, npcId: number, fh: number, colorRGBA: number[],
  frameIdx = 0,
): HTMLCanvasElement | null {
  const key = `${sheetId}|${npcId}|${fh}|${frameIdx}|${colorRGBA.join(',')}|x`;
  const hit = bstTintCache.get(key);
  if (hit) return hit;
  const w = (img as HTMLImageElement).width ?? (img as ImageBitmap).width;
  if (!w) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = fh;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.imageSmoothingEnabled = false;
  cx.drawImage(img, 0, frameIdx * fh, w, fh, 0, 0, w, fh);
  const d = cx.getImageData(0, 0, w, fh);
  // ka = 渲染器经验定标值（Renderer.NPC_TINT_KA 0.55,同源保证图鉴/活体一致）
  const ka = NPC_TINT_KA;
  const kc = (colorRGBA[3] ?? 255) / 255;
  const dd = d.data;
  for (let i = 0; i < dd.length; i += 4) {
    const a = dd[i + 3] / 255;
    if (a === 0) continue;
    const occ = 1 - (1 - a * ka) * (1 - a * kc);
    const baseK = a * ka * (1 - a * kc);
    dd[i] = Math.min(255, (a * dd[i] * (colorRGBA[0] / 255) + baseK * dd[i]) / occ);
    dd[i + 1] = Math.min(255, (a * dd[i + 1] * (colorRGBA[1] / 255) + baseK * dd[i + 1]) / occ);
    dd[i + 2] = Math.min(255, (a * dd[i + 2] * (colorRGBA[2] / 255) + baseK * dd[i + 2]) / occ);
    dd[i + 3] = occ * 255;
  }
  cx.putImageData(d, 0, 0);
  if (bstTintCache.size > 800) { const k0 = bstTintCache.keys().next().value; if (k0 !== undefined) bstTintCache.delete(k0); }   // ★逐条淘汰最旧(勿整表clear,2026-09-07)
  bstTintCache.set(key, c);
  return c;
}

/** 叠层着色（UIBestiaryNPCEntryPortrait :43-54：spriteBatch.Draw(tex, rect, Color)——
 *  XNA 颜色乘算 RGB×c/255、α×c.A/255；Web 直色差同 bstTintedFrame 勘误,预乘空间
 *  恒等单张精灵,逐像素离屏合成）。key = 贴图名|rgba（叠层仅 MapBGOverlay1-9×两色,
 *  缓存天然有界） */
const bstOverlayTintCache = new Map<string, HTMLCanvasElement>();
function bstTintedOverlay(name: string, img: ImageBitmap | HTMLImageElement, rgba: number[]): HTMLCanvasElement {
  const key = `${name}|${rgba.join(',')}`;
  const hit = bstOverlayTintCache.get(key);
  if (hit) return hit;
  const w = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
  const h = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const cx = c.getContext('2d');
  if (cx) {
    cx.imageSmoothingEnabled = false;
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height);
    const dd = d.data;
    const kr = rgba[0] / 255, kg = rgba[1] / 255, kb = rgba[2] / 255, ka = (rgba[3] ?? 255) / 255;
    for (let i = 0; i < dd.length; i += 4) {
      if (dd[i + 3] === 0) continue;
      dd[i] = Math.min(255, dd[i] * kr);
      dd[i + 1] = Math.min(255, dd[i + 1] * kg);
      dd[i + 2] = Math.min(255, dd[i + 2] * kb);
      dd[i + 3] = Math.min(255, dd[i + 3] * ka);
    }
    cx.putImageData(d, 0, 0);
  }
  if (bstOverlayTintCache.size > 64) { const k0 = bstOverlayTintCache.keys().next().value; if (k0 !== undefined) bstOverlayTintCache.delete(k0); }   // ★逐条淘汰最旧(勿整表clear=重分配雪崩,2026-09-07 canvas哨兵案)
  bstOverlayTintCache.set(key, c);
  return c;
}
import { npcValueOf } from '../drops/NpcDrops';
import dropData from '../data/vanilla-npcdrops.json';
import spawnData from '../data/vanilla-bestiary-spawn.json';
import { UISfx } from '../vui/UISfx';
import { isBound } from '../core/Keybinds';
import { bindMouseTextTip, hideMouseTextTip } from './MouseTextTip';   // ★BJ-C4-F3
import { lateImageRetryDefer } from '../assets/lateImageRetry';
import type { SpriteAtlas } from '../assets/SpriteAtlas';
import {
  bestiaryEntries, bestiaryCreditId, UnlockState,
  bestiaryRarityStars, bestiarySortingId, isBossForBestiary, isRareSpawnForBestiary,
  type BestiaryEntryDef, type BestiaryTracker,
} from '../data/Bestiary';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rule = any;

// ============ 纯逻辑（Node 可单测；DOM 渲染只是其消费方） ============

/** UIBestiaryEntryGrid.GetEntriesToShow：单元 72×72（UIBestiaryEntryButton 尺寸） */
export const BST_CELL = 72;

export function bestiaryGridSize(w: number, h: number): { cols: number; rows: number; perPage: number } {
  const cols = Math.max(1, Math.floor(w / BST_CELL));
  const rows = Math.max(1, Math.floor(h / BST_CELL));
  return { cols, rows, perPage: cols * rows };
}

/** UIBestiaryEntryGrid.GetRangeText："{first}-{last} ({total})"，空集 "0-0 (0)" */
export function bestiaryRangeText(atIndex: number, last: number, perPage: number): string {
  const end = Math.min(last, atIndex + perPage);
  const first = Math.min(atIndex + 1, end);
  return `${first}-${end} (${last})`;
}

/** FixBestiaryRange：偏移钳制到 [0, max(0, last - perPage)] */
export function clampBestiaryOffset(atIndex: number, offset: number, last: number, perPage: number): number {
  const max = Math.max(0, last - perPage);
  return Math.min(Math.max(atIndex + offset, 0), max);
}

/** 分页数（探针口径：546 条 / 每页条数 → 页数） */
export function bestiaryPageCount(total: number, perPage: number): number {
  if (perPage <= 0) return 0;
  return Math.ceil(total / perPage);
}

export type BestiarySortKey = 'unlocks' | 'id' | 'bestiaryId' | 'alpha' | 'rarity' | 'attack' | 'defense' | 'coins' | 'hp';
/** SortingSteps 注册序（populator RegisterSortSteps :472-488，1457 与 1456 :476-486 同序）：
 *  Unlocks → BestiaryID → Alphabetical → NetId → Attack → Defense → Coins → HitPoints →
 *  Rarity。★BJ506 勘正：旧表 ['unlocks','id','bestiaryId','alpha','rarity',…] 与两版反编译
 *  均不符（id/bestiaryId 倒置、rarity 错位中部）——本表即 EntrySorter 兜底链顺序 */
export const BESTIARY_SORT_KEYS: BestiarySortKey[] = ['unlocks', 'bestiaryId', 'alpha', 'id', 'attack', 'defense', 'coins', 'hp', 'rarity'];
/** 弹层可见步（HiddenFromSortOptions=false 的 7 步，注册序剔除 unlocks/id 两个隐藏步）；
 *  UI 排序钮右侧文案恒显当前步名（EntrySorter.GetDisplayName，初始 = Steps[0] "解锁"） */
export const BESTIARY_SORT_OPTIONS: BestiarySortKey[] = ['bestiaryId', 'alpha', 'attack', 'defense', 'coins', 'hp', 'rarity'];

export function sortLabel(key: BestiarySortKey): string {
  switch (key) {
    case 'unlocks': return Lang.text('BestiaryInfo.Sort_Unlocks');
    case 'id': return Lang.text('BestiaryInfo.Sort_ID');
    case 'bestiaryId': return Lang.text('BestiaryInfo.Sort_BestiaryID');
    case 'rarity': return Lang.text('BestiaryInfo.Sort_Rarity');
    case 'alpha': return Lang.text('BestiaryInfo.Sort_Alphabetical');
    case 'attack': return Lang.text('BestiaryInfo.Sort_Attack');
    case 'defense': return Lang.text('BestiaryInfo.Sort_Defense');
    case 'coins': return Lang.text('BestiaryInfo.Sort_Coins');
    case 'hp': return Lang.text('BestiaryInfo.Sort_HitPoints');
  }
}

/** Utils.PrettifyPercentDisplay（Utils.cs:1140）1:1：ToString("P{n}") →
 *  TrimEnd('0','%',' ') → TrimEnd('.',' ') → TrimStart('0',' ') → +"%"。
 *  （0.5→"50%"；1→"100%"；0→"%"——尾零/前导零全剥的原版习癖，机械照抄） */
export function prettifyPercentDisplay(v: number, digits = 2): string {
  let s = (v * 100).toFixed(digits);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace(/^[0 ]+/, '');
  return `${s}%`;
}

export interface BestiaryFilter {
  search: string;
  /** 条目类别（本仓自有维度，无原版键；UI 面已按 1:1 拆除，数据层保留供单测/后续批） */
  kind: 'all' | 'enemy' | 'town' | 'critter';
  /** Filters.ByBoss（BestiaryInfo.IsBoss）；UI 走 tags 'boss' 同语义 */
  boss: boolean;
  /** Filters.ByUnlockState（BestiaryInfo.IfUnlocked）；'no' 为反向（本仓补充） */
  unlocked: 'all' | 'yes' | 'no';
  /** 标签筛选激活集（Filters 集身份：'unlocked'/'boss'/'rare' + 出没环境路径键；
   *  EntryFilterer.FitsFilter :37-56 语义 = 激活筛选【OR】合取——命中任一激活筛选即通过，
   *  其余维度（search/kind/boss/unlocked）仍 AND） */
  tags: string[];
}

export const DEFAULT_BESTIARY_FILTER: BestiaryFilter = { search: '', kind: 'all', boss: false, unlocked: 'all', tags: [] };

export interface BestiaryRow {
  entry: BestiaryEntryDef;
  /** 条目自身 netId（图鉴编号取 bestiarySortingId(entryId)；重复 creditId 归并行各自唯一） */
  entryId: number;
  /** 条目代表 NPC id（图标/属性取自它；归并族取母体） */
  npcId: number;
  state: UnlockState;
  name: string;
  /** 击杀数（kill 来源 creditId 的计数；非击杀条目 0） */
  kills: number;
}

/** creditId → 母体 NPC id（BESTIARY_CREDIT_REDIRECT 归并族取未被重定向者，正 id 优先） */
let repIdCache: Map<string, number> | null = null;
export function bestiaryRepNpcId(creditId: string): number {
  if (!repIdCache) {
    repIdCache = new Map();
    const R = BESTIARY_CREDIT_REDIRECT as Record<number, number>;
    const put = (id: number) => {
      const cid = NPC_NAME_BY_ID[id] ?? String(id);
      if (!repIdCache!.has(cid)) repIdCache!.set(cid, id);
    };
    for (const key of Object.keys(NPC_NAME_BY_ID)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id === 0) continue;
      if (R[id] === undefined && id > 0) put(id);   // 母体（正 id）
    }
    for (const key of Object.keys(NPC_NAME_BY_ID)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id === 0) continue;
      if (R[id] !== undefined) put(R[id]);           // 变体族回填母体
    }
    for (const key of Object.keys(NPC_NAME_BY_ID)) {
      const id = Number(key);
      // 负 netID 变体（史莱姆配色 -1..-10 / 世吞段 -11..-13）代表自身
      if (Number.isInteger(id) && id !== 0) put(id);
    }
  }
  const fallback = Number(creditId);
  return repIdCache.get(creditId) ?? (Number.isFinite(fallback) ? fallback : 0);
}

/** BossBestiaryInfoElement 挂载集（BestiaryEntry.Enemy :37：npc.boss ∨
 *  ShouldBeCountedAsBossForBestiary → Filters.ByBoss）的 creditId 化 */
const BOSS_CREDITS = new Set(
  Object.keys(NPC_NAME_BY_ID)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id !== 0 && isBossForBestiary(id))
    .map(bestiaryCreditId),
);

export function isBossCredit(creditId: string): boolean {
  return BOSS_CREDITS.has(creditId);
}

/** 全条目行化（bestiaryEntries × tracker.unlockState × 名字解析） */
export function bestiaryRows(tracker: BestiaryTracker): BestiaryRow[] {
  const out: BestiaryRow[] = [];
  for (const entry of bestiaryEntries()) {
    let kills = 0;
    for (const s of entry.sources) {
      if (s.t === 'kill') kills = Math.max(kills, tracker.kills.get(s.credit) ?? 0);
    }
    const npcId = bestiaryRepNpcId(entry.creditId);
    const state = tracker.unlockState(entry);
    out.push({
      entry, entryId: entry.id, npcId, kills, state,
      // 未解锁不显示名（原版图标 hover "???"）
      name: state > UnlockState.NotKnown ? npcDisplayName(npcId, entry.creditId) : '???',
    });
  }
  return out;
}

/** 条目显示名：正 id 走 Lang.npcName；负 netID（史莱姆/世吞段变体）Lang.npcName
 *  会取 abs 误命中他者，改按内部名直查；都缺回退 creditId */
export function npcDisplayName(npcId: number, fallback: string): string {
  if (npcId > 0) return Lang.npcName(npcId) ?? fallback;
  const internal = NPC_NAME_BY_ID[npcId];
  if (internal && Lang.has(`NPCName.${internal}`)) return Lang.text(`NPCName.${internal}`);
  return fallback;
}

// ---- 排序（EntrySorter 全链 1:1，DataStructures/EntrySorter.cs :17-36）----
// 优先步 Compare 非零即决；否则其余步按【注册序】逐位兜底（含排在优先步之前的步）。
// ByStat 族经 NPCStatsReportInfoElement 卡读数：城镇/小动物条目（TownNPC/Critter 工厂
// 不挂 stats 卡，BestiaryEntry.cs:61-109）无卡沉底（:155-170 null 分支），敌怪缺表数据按 0。

type StatField = 'lifeMax' | 'damage' | 'defense';
function statCardOf(r: BestiaryRow, f: StatField): number | null {
  // 有卡 = 敌怪条目（Enemy() 工厂 :31 恒 Add stats 卡）；值缺表（37 条无 SetDefaults 提取）记 0
  if (r.entry.kind !== 'enemy') return null;
  const v = VANILLA_NPCS[String(r.npcId)]?.[f];
  return v == null ? 0 : v;
}

function stepCompare(key: BestiarySortKey, a: BestiaryRow, b: BestiaryRow): number {
  switch (key) {
    case 'unlocks':   // ByUnlockState :40-55：解锁态降序（已解锁在前）
      return b.state - a.state;
    case 'bestiaryId': // ByBestiarySortingId :57-86：NpcBestiarySortingId 升序
      return bestiarySortingId(a.npcId) - bestiarySortingId(b.npcId);
    case 'alpha':      // Alphabetical :118-147：本地化名升序
      return a.name.localeCompare(b.name, 'zh');
    case 'id':         // ByNetId :11-38：netId 升序
      return a.npcId - b.npcId;
    case 'attack': case 'defense': case 'hp': case 'coins': {
      // ByStat 族 :149-236：值降序；无卡沉底（x 无卡 y 有 → x 排后）
      const fa: StatField | 'coins' = key === 'attack' ? 'damage' : key === 'defense' ? 'defense' : key === 'hp' ? 'lifeMax' : 'coins';
      const va = fa === 'coins' ? (a.entry.kind === 'enemy' ? npcValueOf(a.npcId) : null) : statCardOf(a, fa);
      const vb = fa === 'coins' ? (b.entry.kind === 'enemy' ? npcValueOf(b.npcId) : null) : statCardOf(b, fa);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return vb - va;
    }
    case 'rarity':     // ByBestiaryRarity :88-116：星数降序
      return bestiaryRarityStars(b.npcId) - bestiaryRarityStars(a.npcId);
  }
}

/** 排序（EntrySorter.Compare 1:1：优先步 → 注册序其余步兜底；List.Sort 稳定序由
 *  尾键 id 缺位时的注册序近似——原版全键平手保持注册序，本表注册序 = 全库序） */
export function sortBestiaryRows(rows: BestiaryRow[], key: BestiarySortKey): void {
  const chain = [key, ...BESTIARY_SORT_KEYS.filter((k) => k !== key)];
  rows.sort((a, b) => {
    for (const k of chain) {
      const c = stepCompare(k, a, b);
      if (c !== 0) return c;
    }
    return a.npcId - b.npcId;
  });
}

/** 筛选（Filters.BySearch/ByUnlockState/ByBoss/ByRareCreature/ByInfoElement；
 *  tags 现含 'unlocked'（ByUnlockState :60-84：解锁>NotKnown）与 'boss'（ByBoss
 *  :118-148：Boss 元素挂载）两种原版键，UI 图标格直接承载） */
export function filterBestiaryRows(rows: BestiaryRow[], f: BestiaryFilter): BestiaryRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.kind !== 'all' && r.entry.kind !== f.kind) return false;
    if (f.boss && !isBossCredit(r.entry.creditId)) return false;
    if (f.unlocked === 'yes' && r.state === UnlockState.NotKnown) return false;
    if (f.unlocked === 'no' && r.state > UnlockState.NotKnown) return false;
    // 标签筛选（EntryFilterer.FitsFilter Terraria.DataStructures/EntryFilterer.cs:37-56：
    // ActiveFilters 逐个 FitsFilter，任一命中即过——OR 合取；'unlocked'/'boss'/'rare' =
    // Filters 三专用类，其余=Filters.ByInfoElement 的 `entry.Info.Contains(element)`，
    // 即出没环境注册表含该路径）
    if (f.tags.length) {
      const hit = f.tags.some((t) =>
        t === 'unlocked' ? r.state > UnlockState.NotKnown
          : t === 'boss' ? isBossCredit(r.entry.creditId)
            : t === 'rare' ? isRareSpawnForBestiary(r.npcId)
              : !!SPAWN_BY_NPC[String(r.npcId)]?.includes(t));
      if (!hit) return false;
    }
    // BySearch：未解锁条目不提供搜索串（原版 NamePlate 隐藏）
    if (q && (r.state === UnlockState.NotKnown || !r.name.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** chip 组合语义（2026-08-13 用户报：小动物 × 敌方Boss 可同时选中 → 矛盾组合恒空）。
 *  boss 隶属敌怪维度——与 critter/town 互斥：
 *  - 选 boss 时 kind 归一到 enemy（从 小动物/城镇 切入即自动跳敌怪）
 *  - 选 小动物/城镇 时清 boss（不存在 boss 城镇/boss 小动物）
 *  kind all/enemy 与 boss 自由组合（结果集非空：全部→boss 25 条 / 敌怪→boss 25 条）
 *  ★BJ506：UI 面已拆除 kind/未解锁 chip（原版无此二筛选面），本函数保留 = 数据层
 *  语义桩（bestiary-ui.test.ts 回归面）。 */
export function applyBestiaryChip(
  f: BestiaryFilter,
  chip: 'kind' | 'boss' | 'unlocked' | 'unlockedNo' | 'tag',
  kind?: BestiaryFilter['kind'],
  tagKey?: string,
): BestiaryFilter {
  const nf: BestiaryFilter = { ...f };
  if (chip === 'kind' && kind) {
    nf.kind = kind;
    if (kind !== 'all' && kind !== 'enemy') nf.boss = false;
  } else if (chip === 'boss') {
    nf.boss = !nf.boss;
    if (nf.boss && nf.kind !== 'all' && nf.kind !== 'enemy') nf.kind = 'enemy';
  } else if (chip === 'unlocked') {
    nf.unlocked = nf.unlocked === 'yes' ? 'all' : 'yes';
  } else if (chip === 'tag' && tagKey) {
    // EntryFilterer.ToggleFilter（EntryFilterer.cs:58-67）：在 AvailableFilters 中
    // 查身份，ActiveFilters 含则移除否则加入（ToggleFilter(int) 按索引查，此处按键）
    nf.tags = nf.tags.includes(tagKey) ? nf.tags.filter((t) => t !== tagKey) : [...nf.tags, tagKey];
  } else {
    nf.unlocked = nf.unlocked === 'no' ? 'all' : 'no';
  }
  return nf;
}

// ============ 掉落表展平（ItemDropBestiaryInfoElement） ============

export interface DropLine {
  item: number;
  /** 掉率（0-1；null = 非概率掉落如 noRepeat 池/事件掉落） */
  chance: number | null;
  min: number;
  max: number;
  /** 条件名（Bestiary.ItemDropConditions.<name> 取文案） */
  cond: string | null;
  /** 专家/大师分支标签（世界难度门：CanShowItemDropInUI 语义） */
  tag: string | null;
}

const DROP_ENTRIES: Array<{ npcs?: number[]; global?: boolean; rule: Rule }> = (dropData as any).entries;
const dropRulesByNpc = new Map<number, Rule[]>();
for (const e of DROP_ENTRIES) {
  if (e.global) continue; // 全局规则不计入条目掉落表（原版按条目注册展示）
  for (const n of e.npcs ?? []) {
    let l = dropRulesByNpc.get(n);
    if (!l) dropRulesByNpc.set(n, l = []);
    l.push(e.rule);
  }
}

function pushDrop(out: DropLine[], item: number, chance: number | null, min: number, max: number, cond: string | null, tag: string | null) {
  if (!item) return;
  out.push({ item, chance: chance === null ? null : Math.min(1, chance), min, max, cond, tag });
}

function walkDrop(rule: Rule, out: DropLine[], gate: number, tag: string | null, cond: string | null): void {
  if (!rule || typeof rule !== 'object') return;
  const c = rule.cond?.name ?? cond;
  const num = rule.num ?? 1;
  switch (rule.k) {
    case 'common': case 'rerolls': case 'cond':
    case 'local': case 'perPlayer':
      pushDrop(out, rule.item, gate * (num / (rule.denom ?? 1)), rule.min ?? 1, rule.max ?? 1, c, tag);
      break;
    case 'oneOf':
      for (const id of rule.ids ?? []) pushDrop(out, id, gate * (num / (rule.denom ?? 1)), 1, 1, c, tag);
      break;
    case 'expert': // DropBasedOnExpertMode：normal/expert 双列展示
      walkDrop(rule.normal, out, gate, tag, cond);
      walkDrop(rule.expert, out, gate, 'IsExpert', cond);
      return;
    case 'master':
      walkDrop(rule.def, out, gate, tag, cond);
      walkDrop(rule.master, out, gate, 'IsMasterMode', cond);
      return;
    case 'masterExpert': // master > expert > def
      walkDrop(rule.def, out, gate, tag, cond);
      walkDrop(rule.expert, out, gate, 'IsExpert', cond);
      walkDrop(rule.master, out, gate, 'IsMasterMode', cond);
      return;
    case 'masterCommon':
      pushDrop(out, rule.item, gate, 1, 1, c, 'IsMasterMode');
      break;
    case 'masterAll':
      pushDrop(out, rule.item, gate / (rule.denom ?? 1), 1, 1, c, 'IsMasterMode');
      break;
    case 'bossBag': // 非专家分支 = DropNothing
      pushDrop(out, rule.item, gate, 1, 1, c, 'IsExpert');
      break;
    case 'oneOfRules': // OneFromRulesRule：过 1/denom 后等权取一子树
      for (const r of rule.rules ?? []) walkDrop(r, out, gate / (rule.denom ?? 1), tag, cond);
      return;
    case 'noRepeat': // 不放回抽样池：恒掉 count 件（概率由池构成）
      for (const id of rule.ids ?? []) pushDrop(out, id, null, 1, 1, c, tag);
      break;
    case 'dropOneByOne': // 四塔碎片：12-20 块（参数未数值化，见 NpcDrops.dropOneByOne）
      pushDrop(out, rule.item, gate, 12, 20, c, tag);
      break;
    case 'mechSpawn': // 三王召唤物各 1/2500
      pushDrop(out, 556, gate / 2500, 1, 1, c, tag);
      pushDrop(out, 544, gate / 2500, 1, 1, c, tag);
      pushDrop(out, 557, gate / 2500, 1, 1, c, tag);
      break;
    case 'gate': { // LeadingConditionRule：条件沿 OnSuccess 链下传
      for (const ch of rule.chain ?? []) walkDrop(ch.rule, out, gate, tag, c);
      return;
    }
    case 'nothing': case 'listRef': case 'slimeBody': case 'statueMimic':
      return;
    default:
      return; // 未知 kind 静默跳过（掉落求值运行时另有 warnOnce 兜底）
  }
  for (const ch of rule.chain ?? []) walkDrop(ch.rule, out, gate, tag, cond);
}

/** 展平某 NPC 的掉落规则树 → 展示行。
 *  ★BJ506 两刀：①行序 = 规则注册序（原版逐规则一线，UIBestiaryInfoItemLine 无重排——
 *  旧 chance 降序排序为自创面拆除）；②difficulty 门（0 经典/1 专家/2 大师）：
 *  NotExpert/IsExpert/IsMasterMode 条件的 CanShowItemDropInUI 语义——专家/大师行仅
 *  在对应世界档可见（ItemDropBestiaryInfoElement.ShouldShowItem :31-46） */
export function flattenDropsForNpc(npcId: number, difficulty = 0): DropLine[] {
  const rules = dropRulesByNpc.get(npcId);
  if (!rules) return [];
  const out: DropLine[] = [];
  for (const r of rules) walkDrop(r, out, 1, null, null);
  const seen = new Set<string>();
  const deduped = out.filter((d) => {
    const k = `${d.item}|${d.chance}|${d.min}|${d.max}|${d.cond}|${d.tag}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const gated = deduped.filter((d) =>
    d.tag !== 'IsExpert' || difficulty >= 1);
  return gated.filter((d) => d.tag !== 'IsMasterMode' || difficulty >= 2);
}

/** GetDropInfo 掉率文案（UIBestiaryInfoItemLine :77-101）："P"（=2 位），
 *  <0.001 用 P4；恒 1 → "100%"（PrettifyPercentDisplay 习癖全保留） */
export function dropRateText(chance: number): string {
  if (chance === 1) return '100%';
  return prettifyPercentDisplay(chance, chance < 0.001 ? 4 : 2);
}

function dropTagText(tag: string): string {
  // ★BJ507 B2 键名勘正：产物类别 = Bestiary_ItemDropConditions（嵌套两层压一层,
  //  build-l10n 规则）——旧拼 Bestiary.ItemDropConditions 永不命中 = 文案面死键
  const key = `Bestiary_ItemDropConditions.${tag}`;
  const t = Lang.has(key) ? Lang.text(key) : '';
  return t || tag;
}
function dropCondText(cond: string): string {
  const key = `Bestiary_ItemDropConditions.${cond}`;
  const t = Lang.has(key) ? Lang.text(key) : '';
  return t; // 原版空串条件（NotExpert 等）不显示
}

// ============ 出没环境 + 风味文本 + 头像背景（BestiaryDatabaseNPCsPopulator + BestiaryEntry） ============

type SpawnJson = typeof spawnData;
/** SpawnCondition 静态声明（populator :14-302）。priority = filterIconFrame（标签图标帧，
 *  FilterProviderInfoElement :24-29）；text = DisplayTextPriority（风味回退权重）；
 *  bg/bgColor = 条目头像背景 MapBG 与着色（IBestiaryBackgroundImagePathAndColorProvider） */
interface SpawnConditionDef {
  key?: string;
  priority: number;
  text?: number;
  bg?: string;
  bgColor?: number[];
  overlay?: string;
  overlayColor?: number[];
  hideInPortrait?: boolean;
}
const SPAWN_CONDITIONS = (spawnData as unknown as SpawnJson).conditions as unknown as Record<string, SpawnConditionDef>;
/** FindEntryByNPCID(id).Info.AddRange 注册序（populator :802/:1661，×732） */
export const SPAWN_BY_NPC = (spawnData as unknown as SpawnJson).byNpc as Record<string, string[]>;
/** AddTags 头像背景偏好（populator :515-548）：单条件路径或腐化/猩红双路 */
const BG_PREFERENCE = (spawnData as unknown as SpawnJson).bgPreference as Record<
  string, Array<string | { corrupt: string; crimson: string }>
>;
/** MoonLordPortraitBackgroundProviderBestiaryInfoElement（populator :550-551） */
const MOONLORD_BG_NPC = new Set<number>(
  ((spawnData as unknown as SpawnJson).moonLordBg as number[] | undefined) ?? [],
);

export interface SpawnConditionLine { key: string; label: string; priority: number }

/** 出没环境条目（UIBestiaryEntryInfoPage 按注册序呈现；解锁门 NotKnown 之外恒显，
 *  FilterProviderInfoElement.cs:47-50）。netId 变种（-1..-13）按负 id 直查原表 */
export function bestiarySpawnConditions(npcId: number): SpawnConditionLine[] {
  const paths = SPAWN_BY_NPC[String(npcId)];
  if (!paths) return [];
  return paths.map((p) => {
    const c = SPAWN_CONDITIONS[p];
    const key = c.key ?? '';
    return { key, label: key && Lang.has(key) ? Lang.text(key) : key, priority: c.priority };
  });
}

/** 条目背景偏好路径（BestiaryPortraitBackgroundBasedOnWorldEvil 按 WorldGen.crimson 二选一） */
export function bestiaryBgPreferencePaths(npcId: number, crimson = false): string[] {
  const prefs = BG_PREFERENCE[String(npcId)];
  if (!prefs) return [];
  return prefs.map((p) => (typeof p === 'string' ? p : (crimson ? p.crimson : p.corrupt)));
}

/** 风味文本（BestiaryEntry.cs:42-47 Enemy/TownNPC/Critter 三工厂同构）：
 *  `Bestiary_FlavorText.npc_<NPCName 内部名>`（Language.Exists 门，564 键）；
 *  缺失回退 TryGivingEntryFlavorTextIfItIsMissing（populator:685-714）——头像背景
 *  偏好条件绝对优先（Info 序首个），其余取 DisplayTextPriority 最高者（并列取注册序
 *  后者），映射 `Bestiary_BiomeText.biome_<键名去类别>`。两路都无 → null */
export function bestiaryFlavorText(npcId: number, crimson = false): string | null {
  // ★BJ334(2026-09-24)：负 netID 直查——表（idNames.generated NPC_NAME_BY_ID）本就
  //  含 -1..-65 键（'-3': 'GreenSlime'）;旧 `-npcId` 反转把 -3 打到 3=Zombie,变体
  //  图鉴页风味文本错拿基域键（原版键=Bestiary_FlavorText.npc_GreenSlime）。
  const internal = NPC_NAME_BY_ID[npcId];
  const key = internal ? `Bestiary_FlavorText.npc_${internal}` : '';
  if (key && Lang.has(key)) return Lang.text(key);
  const paths = SPAWN_BY_NPC[String(npcId)] ?? [];
  if (paths.length === 0) return null;
  const pref = bestiaryBgPreferencePaths(npcId, crimson);
  let bestPath: string | null = null;
  if (pref.length) {
    bestPath = paths.find((p) => pref.includes(p)) ?? null;   // Info 序首个命中即 break
  }
  if (!bestPath) {
    let bestPri = -Infinity;
    for (const p of paths) {
      const pri = SPAWN_CONDITIONS[p]?.text ?? 0;   // DisplayTextPriority 默认 0
      if (pri >= bestPri) { bestPri = pri; bestPath = p; }
    }
  }
  const cond = bestPath ? SPAWN_CONDITIONS[bestPath] : null;
  if (!cond?.key) return null;
  const fb = `Bestiary_BiomeText.biome_${cond.key.slice(cond.key.indexOf('.') + 1)}`;
  return Lang.has(fb) ? Lang.text(fb) : null;
}

// ============ 头像背景（MapBG 按出没环境推导） ============

export interface BestiaryPortraitBg {
  /** MapBG 贴图名（public/sprites/vanilla/<name>.png；无出没环境时 null） */
  image: string | null;
  /** 着色 rgba（NPCPortraitInfoElement：有图条件中最后一个带色者胜出） */
  color: [number, number, number, number];
}

/** 条目 Info 中带背景图的提供者（注册序；月总元素由 populator :551 追加在末位） */
interface BgProvider { path: string | null; bg: string; bgColor?: number[] }
function bgProviders(npcId: number): BgProvider[] {
  const out: BgProvider[] = [];
  for (const p of SPAWN_BY_NPC[String(npcId)] ?? []) {
    const c = SPAWN_CONDITIONS[p];
    if (c?.bg) out.push({ path: p, bg: c.bg, bgColor: c.bgColor });
  }
  if (MOONLORD_BG_NPC.has(npcId)) out.push({ path: null, bg: 'MapBG1', bgColor: [0, 0, 0, 255] });
  return out;
}

/** 详情页大头像偏好命中（NPCPortraitInfoElement.cs:56-67 flag2）：偏好条件（AddTags，
 *  世界恶双路按 crimson 取一）命中首个带图提供者。命中时底图锁定且**装饰叠层整批
 *  不画**（:77 `if (!flag2 && ... GetBackgroundOverlayImage() != null)` 短路） */
export function bestiaryPortraitPrefHit(npcId: number, crimson = false): boolean {
  const providers = bgProviders(npcId);
  const pref = bestiaryBgPreferencePaths(npcId, crimson);
  return pref.length > 0 && providers.some((p) => p.path !== null && pref.includes(p.path));
}

/** 详情页大头像背景（NPCPortraitInfoElement.cs:38-81）：偏好条件（AddTags，
 *  世界恶双路按 crimson 取一）命中则锁定其贴图；否则每轮覆写 → 注册序**最后一个**
 *  带图条件。着色 = 有图提供者中最后一个声明 bgColor 者（偏好命中后仍生效） */
export function bestiaryPortraitBackground(npcId: number, crimson = false): BestiaryPortraitBg {
  const providers = bgProviders(npcId);
  let image: string | null = null;
  let color: [number, number, number, number] = [255, 255, 255, 255];
  const prefHit = bestiaryPortraitPrefHit(npcId, crimson);
  const pref = prefHit ? bestiaryBgPreferencePaths(npcId, crimson) : [];
  if (prefHit) image = (providers.find((p) => p.path !== null && pref.includes(p.path)) as BgProvider).bg;  // flag2：偏好锁定
  for (const p of providers) {
    if (!prefHit) image = p.bg;                          // 无偏好：末个胜出
    if (p.bgColor) color = [p.bgColor[0], p.bgColor[1], p.bgColor[2], p.bgColor[3] ?? 255];
  }
  return { image, color };
}

/** 网格条目底图（UIBestiaryEntryButton.TryGettingBackgroundImageProvider :105-127）：
 *  偏好条件优先，否则注册序**首个**带图条件（与大头像的"最后一个"不同）；无着色 */
export function bestiaryGridBackground(npcId: number, crimson = false): string | null {
  const providers = bgProviders(npcId);
  if (!providers.length) return null;
  const pref = bestiaryBgPreferencePaths(npcId, crimson);
  const hit = pref.length ? providers.find((p) => p.path !== null && pref.includes(p.path)) : undefined;
  return (hit ?? providers[0]).bg;
}

// ============ 详情头像装饰叠层（IBestiaryBackgroundOverlayAndColorProvider 消费面） ============
//  NPCPortraitInfoElement.cs:73-84：解锁（>NotKnown）后遍历 Info，收集 GetBackgroundOverlayImage()
//  非 null 的叠层提供者（偏好命中 flag2 时整批跳过），OrderBy(DisplayPriority) 稳定升序；
//  UIBestiaryNPCEntryPortrait.cs:43-54：每层与底图同一目标盒拉伸居中，色 =
//  GetBackgroundOverlayColor() ?? Color.Lerp(Color.White, portraitColor, 0.5f)。

export interface BestiaryPortraitOverlay {
  /** 叠层贴图名（public/sprites/vanilla/MapBGOverlay*.png，原 Images/MapBGOverlay*） */
  overlay: string;
  /** 声明色（null = 绘制侧 Lerp(White, portraitColor, 0.5) 回退） */
  color: [number, number, number, number] | null;
  /** DisplayPriority（SpawnConditionBestiaryOverlayInfoElement 默认 0 / Decorative 1，
   *  NPCPortraitInfoElement.GetSortingValueForElement :105-112） */
  priority: number;
}

/** Visuals.* 装饰挂载推导（populator AddNPCBiomeRelationships_AddDecorations_Automated
 *  :1942-1987 分支结构 1:1——Rain 在册时按 Snow 二分后 **continue**（不落日/月/事件月），
 *  无 Rain 才逐条件独立追加；陨石群系 = Moon+Meteor 双挂）。
 *  derivations 数据表（vanilla-bestiary-spawn.json）是本分支的提取投影 */
export function bestiaryPortraitOverlays(npcId: number): BestiaryPortraitOverlay[] {
  const paths = SPAWN_BY_NPC[String(npcId)] ?? [];
  const has = (p: string) => paths.includes(p);
  const out: BestiaryPortraitOverlay[] = [];
  const push = (path: string) => {
    const c = SPAWN_CONDITIONS[path];
    if (c?.overlay) out.push({ overlay: c.overlay, color: (c.overlayColor as BestiaryPortraitOverlay['color']) ?? null, priority: 1 });
  };
  // Info 内显式叠层提供者（注册序）：SpawnConditionBestiaryOverlayInfoElement 全集 =
  // Events.Rain/:57、Events.Blizzard/:81、Events.Sandstorm/:88——仅 Sandstorm 带
  // MapBGOverlay1（Rain/Blizzard 无 overlayImagePath 实参 → GetBackgroundOverlayImage()
  // ==null 不收集），DisplayPriority 默认 0
  for (const p of paths) {
    const c = SPAWN_CONDITIONS[p];
    if (c?.overlay && p.startsWith('Events.')) {
      out.push({ overlay: c.overlay, color: (c.overlayColor as BestiaryPortraitOverlay['color']) ?? null, priority: 0 });
    }
  }
  // Visuals.* 装饰（SpawnConditionDecorativeOverlayInfoElement，DisplayPriority=1）
  if (has('Events.Rain')) {
    push(has('Biomes.Snow') ? 'Visuals.Blizzard' : 'Visuals.Rain');
  } else {
    if (has('Events.Eclipse')) push('Visuals.EclipseSun');
    if (has('Times.NightTime')) push('Visuals.Moon');
    if (has('Times.DayTime')) push('Visuals.Sun');
    if (has('Invasions.PumpkinMoon')) push('Visuals.PumpkinMoon');
    if (has('Invasions.FrostMoon')) push('Visuals.FrostMoon');
    if (has('Biomes.Meteor')) { push('Visuals.Moon'); push('Visuals.Meteor'); }
  }
  // OrderBy(DisplayPriority) 稳定升序（ Sandstorm 0 < Visuals 1；同 priority 保注册序）
  return out.map((o, i) => [o, i] as const)
    .sort((a, b) => a[0].priority - b[0].priority || a[1] - b[1])
    .map(([o]) => o);
}

// ============ 标签筛选注册表（Filters + UIBestiaryFilteringOptionsGrid） ============
//  RegisterFilters（populator :493-503）注册序：ByUnlockState → ByBoss → ByRareCreature →
//  CommonTags.GetCommonInfoElementsForFilters（:252-311，57 条 ByInfoElement）＝ 60 钮。
//  ★BJ506：旧表 58 项缺 ByUnlockState/ByBoss（被挪去自创 chip 行）——原版它们就是
//  图标格第 1/2 钮（Icon_Tags_Shadow 帧 Frame(16,5,14,3)=62 / (16,5,15,3)=63，
//  Filters.cs:75-83/:139-147）；kind chip 行（全部/敌人/城镇/小动物）与"未解锁"为
//  自创面，原版无此筛选项，UI 已拆除。

export interface BestiaryFilterDef {
  /** 筛选键：'unlocked' = ByUnlockState；'boss' = ByBoss；'rare' = ByRareCreature；
   *  其余 = 出没环境路径（ByInfoElement 的元素身份） */
  key: string;
  /** 悬停名/键名（FilterProviderInfoElement.GetDisplayNameKey / Filters.GetDisplayNameKey） */
  nameKey: string;
  /** Icon_Tags_Shadow 帧号（16×5 帧表；X=frame%16,Y=frame/16）。
   *  -1 = ByRareCreature 专图 Icon_Rank_Light（Filters.cs:107-116 单帧星形） */
  frame: number;
}

/** 筛选全集（Filters 注册序 1:1：ByUnlockState → ByBoss → ByRareCreature → 57 标签；
 *  帧 62/63 = Icon_Tags_Shadow 第 4 行 14/15 列） */
export const BESTIARY_FILTER_DEFS: BestiaryFilterDef[] = [
  { key: 'unlocked', nameKey: 'BestiaryInfo.IfUnlocked', frame: 62 },
  { key: 'boss', nameKey: 'BestiaryInfo.IsBoss', frame: 63 },
  { key: 'rare', nameKey: 'BestiaryInfo.IsRare', frame: -1 },
  ...(((spawnData as unknown as SpawnJson).commonFilters) as string[]).map((p) => ({
    key: p,
    nameKey: SPAWN_CONDITIONS[p]?.key ?? p,
    frame: SPAWN_CONDITIONS[p]?.priority ?? 0,
  })),
];

/** 筛选可用性（UIBestiaryFilteringOptionsGrid.GetIsFilterAvailableForEntries :193-208）：
 *  ForcedDisplay 有值直取（ByUnlockState/BySearch true = 恒可用）；null = 存在【已解锁】
 *  命中条目才可用（不可用钮在原版灰显 Icon_Tags_Shadow 帧(0,4) 且移出 ActiveFilters） */
export function bestiaryFilterAvailable(key: string, rows: BestiaryRow[]): boolean {
  if (key === 'unlocked') return true;   // Filters.ByUnlockState.ForcedDisplay=true（Filters.cs:62）
  for (const r of rows) {
    if (r.state === UnlockState.NotKnown) continue;
    if (key === 'rare') { if (isRareSpawnForBestiary(r.npcId)) return true; continue; }
    if (key === 'boss') { if (isBossCredit(r.entry.creditId)) return true; continue; }
    if (SPAWN_BY_NPC[String(r.npcId)]?.includes(key)) return true;
  }
  return false;
}

// ============ 自愈补画目标（FX37 纯逻辑;scheduleBlankSweep 消费方） ============

/** sweep 扫描格（DOM cell 的纯数据投影） */
export interface BestiarySweepCell { canvas: object | null; creditId: string | null }

/** 自愈补画目标（2026-09-11 FX37 重做）:只收「从未落笔」的画布并按 creditId 反查行。
 *  旧实现逐画布 getImageData 判空=每轮 81+1 张同步 GPU→CPU 读回(实测 22-51ms/次,
 *  每次翻页/筛选/选中后 400ms 必掉 1-2 vsync)——painted 登记面替代;context 丢失面
 *  由各画布 contextlost/contextrestored 监听自愈(创建后首画前同步挂载,无窗口期)。
 *  纯逻辑:Node 可单测(tests/sw-fx37-bestiary-perf.test.ts) */
export function bestiarySweepTargets(
  cells: BestiarySweepCell[],
  rows: BestiaryRow[],
  painted: WeakSet<object>,
): Array<{ canvas: object; npcId: number; unlocked: boolean }> {
  const byCredit = new Map<string, BestiaryRow>();
  for (const w of rows) {
    // ★SW-RB14d：first-wins（≡旧 working.find 语义,测试注「与旧 working.find 等义」
    //  才真成立;Map 直 set 是 last-wins,靠"重复 creditId 行 npcId/state 恒同源"才无差）
    if (!byCredit.has(w.entry.creditId)) byCredit.set(w.entry.creditId, w);
  }
  const out: Array<{ canvas: object; npcId: number; unlocked: boolean }> = [];
  for (const cell of cells) {
    if (!cell.canvas || painted.has(cell.canvas)) continue;
    const r = byCredit.get(cell.creditId ?? '');
    if (r) out.push({ canvas: cell.canvas, npcId: r.npcId, unlocked: r.state > UnlockState.NotKnown });
  }
  return out;
}

/** 未解锁占位贴图（bstLoadSheet 缓存键;FX37 前每格 new Image 重发此 src——
 *  一页 81 锁格=81 次 decode 请求/拍）。测试钉住资产存在(404→负缓存→整面锁格空白) */
export const BST_LOCKED_ICON_SHEET = 'vanilla-ui/UI_Bestiary_Icon_Locked.png';

// ============ DOM 面板 ============

/** 图鉴贴图缓存(2026-08-13,用户报"滚动翻页崩溃"的核心修复):
 *  此前每个格子每次 refresh 都 new Image() 自取 NPC 表/背景图且【结果不回写】
 *  ——trackpad 滚轮风暴下同一张多帧行大表被反复解码,渲染进程压崩。本缓存:
 *  ①命中直回 ②atlas.vimages 已有的直接借 ③在途去重(并发 refresh 共享一次
 *  fetch+decode) ④onerror 负终结(404 也回调,防等待队列无限堆积) ⑤容量上限
 *  LRU 淘汰(引用即成本)。 */
const bstSheetCache = new Map<string, ImageBitmap | HTMLImageElement>();
const bstSheetPending = new Map<string, Array<(img: ImageBitmap | HTMLImageElement | null) => void>>();
/** 404 负缓存(2026-08-13 泄露 review):缺表时此前每次 refresh 都重新 fetch+
 * 解码(pending 去重只挡并发不挡串行)——登记终态,不再重发。
 * ★TTL 化(2026-08-25 同类扫描):原永久 Set=冷缓存窗口一次失败整会话缺图鉴表;
 * 10s 过期重试,暖缓存到位即自愈 */
const bstSheetFailed = new Map<string, number>();
const BST_FAIL_TTL = 10_000;
const BST_SHEET_CACHE_MAX = 160;

function bstLoadSheet(atlas: SpriteAtlas | null, file: string, cb: (img: ImageBitmap | HTMLImageElement | null) => void): void {
  const hit = bstSheetCache.get(file);
  if (hit) { cb(hit); return; }
  const atlasHit = atlas?.vimages.get(file) ?? null;
  if (atlasHit) {
    if (bstSheetCache.size >= BST_SHEET_CACHE_MAX) bstSheetCache.delete(bstSheetCache.keys().next().value as string);
    bstSheetCache.set(file, atlasHit);
    cb(atlasHit);
    return;
  }
  {
    const f = bstSheetFailed.get(file);
    if (f !== undefined) {
      if (Date.now() - f < BST_FAIL_TTL) { cb(null); return; }  // TTL 内:已知失败不重发
      bstSheetFailed.delete(file);                              // 过期:重试(暖缓存到位即自愈)
    }
  }
  let q = bstSheetPending.get(file);
  if (q) { q.push(cb); return; }  // 在途去重:同一张表并发只取一次
  q = [cb];
  bstSheetPending.set(file, q);
  const im = new Image();
  im.onload = () => {
    bstSheetPending.delete(file);
    if (bstSheetCache.size >= BST_SHEET_CACHE_MAX) bstSheetCache.delete(bstSheetCache.keys().next().value as string);
    // bitmap 就绪才入缓存+回调(Image 窗口期每格每帧发 LazyPixelRef,trace⑨)
    // ★SW-RB14d（FX37-F7）：landOnce 终结一次——upgradeToBitmap 首试失败回调
    //  onFail（land(im)）后仍会在 10/20/40s 重试成功再调 onReady（SpriteAtlas
    //  tryBitmapUpgrade 重试链）,旧刀二次 land 会把已落笔回调再触发一遍:
    //  paint() 无 clear（清底职责在 paintWithBg）,α<255 变体（黑史莱姆 120 等）
    //  被二次合成为加深重影。终结=首个到位版本生效（Image 兜底不缺图语义不变）。
    let landed = false;
    const land = (x: ImageBitmap | HTMLImageElement) => {
      if (landed) return;
      landed = true;
      if (bstSheetFailed.has(file)) bstSheetFailed.delete(file);   // 重试成功:撤销负缓存
      if (bstSheetCache.size >= BST_SHEET_CACHE_MAX) bstSheetCache.delete(bstSheetCache.keys().next().value as string);
      bstSheetCache.set(file, x);
      for (const c of q!) c(x);
    };
    upgradeToBitmap(im, (b) => land(b), () => land(im));  // 失败回退 Image=永不缺图
    if (!USE_BITMAP) land(im);
  };
  im.onerror = () => {
    bstSheetPending.delete(file);
    bstSheetFailed.set(file, Date.now());
    for (const c of q!) c(null);   // 负终结:失败也回调(画底色),队列不积压
  };
  im.src = `sprites/${file}`;
}

// ---- 面板 chrome 九宫染色（UIPanel/Stat_Panel/GroupOptionButton/ColorBar 贴图 × 色）----
//  CharCreation tintedDataUrl 同法：贴图乘色 → dataURL → CSS border-image 九宫。
type Img = HTMLImageElement;
const bstChromeCache = new Map<string, string>();
function bstTintDataUrl(img: Img, r: number, g: number, b: number, aMul = 1): string {
  const key = `${img.src}|${r},${g},${b},${aMul}`;
  const hit = bstChromeCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingEnabled = false;
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, cv.width, cv.height);
  const dd = d.data;
  for (let i = 0; i < dd.length; i += 4) {
    dd[i] = Math.min(255, Math.round(dd[i] * (r / 255)));
    dd[i + 1] = Math.min(255, Math.round(dd[i + 1] * (g / 255)));
    dd[i + 2] = Math.min(255, Math.round(dd[i + 2] * (b / 255)));
    dd[i + 3] = Math.min(255, Math.round(dd[i + 3] * aMul));
  }
  c.putImageData(d, 0, 0);
  const url = cv.toDataURL();
  bstChromeCache.set(key, url);
  return url;
}
function bstLoadImg(src: string): Promise<Img> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    // ★BJ705-G26 件4:终态 onerror 型迟到单发重试（chrome 装饰面;表加载器
    // bstLoadSheet 有 BST_FAIL_TTL 负缓存自愈——不接入,勿叠)
    lateImageRetryDefer(img, src, () => rej());
    img.src = src;
  });
}

const CSS = `
.sw-bst { position:fixed; left:0; top:0; width:100vw; height:100vh; z-index:30; cursor:auto;
  background:rgba(0,0,0,0.6); color:#fff; font-family:"Fusion Pixel 12px","Microsoft YaHei",sans-serif; }
.sw-bst * { box-sizing:border-box; }
/* 外容器（BuildPage :72-80）：宽 87.5% max900 min700 / Top180 / 高 100%-220 / 水平居中 */
.sw-bst-outer { position:absolute; left:50%; transform:translateX(-50%); top:180px;
  width:clamp(700px, 87.5vw, 900px); height:calc(100vh - 220px); }
/* 主面板（UIPanel 高-90：底 (33,43,79)*0.8 黑框，角 12 条 4） */
.sw-bst-panel { position:absolute; left:0; top:0; right:0; bottom:90px; }
.sw-bst-panel::before, .sw-bst-panel::after { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-pbg) 12 fill stretch; }
.sw-bst-panel::after { border-image:var(--bst-pborder) 12 fill stretch; }
/* 顶栏 24px（uIElement2 :89-97） */
.sw-bst-top { position:absolute; left:12px; right:12px; top:8px; height:24px; }
.sw-bst-imgbtn { position:absolute; top:-2px; width:28px; height:28px; padding:0; margin:0;
  border:none; background:transparent; background-repeat:no-repeat; background-size:28px 28px;
  image-rendering:pixelated; cursor:pointer; }
.sw-bst-imgbtn::after { content:''; position:absolute; inset:0; opacity:0; pointer-events:none;
  background:var(--bst-btnborder); background-size:28px 28px; image-rendering:pixelated; }
.sw-bst-imgbtn:hover::after { opacity:1; }
.sw-bst-navback { left:0; background-image:var(--bst-btnback); }
.sw-bst-navfwd { left:29px; background-image:var(--bst-btnfwd); }
/* 范围面板（AddBackAndForwardButtons :240-257）：135 宽 (35,40,83)，文本 0.8 居中 */
.sw-bst-range { position:absolute; left:60px; top:0; width:135px; height:24px;
  border:12px solid transparent; border-image:var(--bst-dark) 12 fill stretch;
  display:flex; align-items:center; justify-content:center; font-size:12px; color:#fff; }
/* 排序/筛选宽钮（AddSortAndFilterButtons :260-303）：114×28 贴图 + Wide_Border 悬停 + 左 34 文字 */
.sw-bst-widebtn { position:absolute; top:-2px; width:114px; height:28px; padding:0; margin:0;
  border:none; background:transparent; background-repeat:no-repeat; background-size:114px 28px;
  image-rendering:pixelated; cursor:pointer; color:#fff; }
.sw-bst-widebtn::after { content:''; position:absolute; inset:0; opacity:0; pointer-events:none;
  background:var(--bst-wideborder); background-size:114px 28px; image-rendering:pixelated; }
.sw-bst-widebtn:hover::after { opacity:1; }
.sw-bst-sortbtn { left:auto; right:364px; background-image:var(--bst-btnsort); }
.sw-bst-filterbtn { right:247px; background-image:var(--bst-btnfilter); }
.sw-bst-widebtn span { position:absolute; left:34px; top:2px; height:24px; display:flex;
  align-items:center; font-size:12px; white-space:nowrap; pointer-events:none;
  text-shadow:1px 1px 0 #3f3f3f; max-width:78px; overflow:hidden; }
/* 搜索栏（UIWrappedSearchBar :104-113）：宽 230 右贴齐 = [22² 钮][框面板] */
.sw-bst-search { position:absolute; right:0; top:0; width:230px; height:24px; }
.sw-bst-searchbtn { position:absolute; right:208px; top:1px; width:22px; height:22px; padding:0;
  border:none; background:var(--bst-btnsearch); background-size:22px 22px; background-repeat:no-repeat;
  image-rendering:pixelated; cursor:pointer; }
.sw-bst-searchbtn::after { content:''; position:absolute; inset:0; opacity:0; pointer-events:none;
  background:var(--bst-btnsearchborder); background-size:22px 22px; image-rendering:pixelated; }
.sw-bst-searchbtn:hover::after { opacity:1; }
.sw-bst-searchbox { position:absolute; right:0; top:0; width:206px; height:24px;
  border:12px solid transparent; border-image:var(--bst-dark) 12 fill stretch;
  display:flex; align-items:center; }
.sw-bst-searchbox.focus { border-image:var(--bst-darkgold) 12 fill stretch; }
.sw-bst-searchbox input { flex:1; min-width:0; background:transparent; border:none; outline:none;
  color:#fff; font-family:inherit; font-size:12px; padding:0 0 0 2px; }
.sw-bst-searchbox input::placeholder { color:#999; }
.sw-bst-searchcancel { flex:none; width:24px; height:24px; padding:0; border:none; cursor:pointer;
  background:var(--bst-searchcancel) center/16px 16px no-repeat; image-rendering:pixelated;
  display:none; }
.sw-bst-searchcancel.on { display:block; }
/* 主区（uIElement3 :114-123）：上 24+6 下 20 之间；网格区宽 -242 高 -4；详情 230 右贴 */
.sw-bst-body { position:absolute; left:12px; right:12px; top:38px; bottom:20px; }
.sw-bst-gridwrap { position:absolute; left:0; top:0; bottom:4px; right:242px; }
.sw-bst-grid { position:absolute; inset:0; }
.sw-bst-cell { position:absolute; width:72px; height:72px; transform:translate(-50%,-50%); cursor:pointer; }
.sw-bst-slotin { position:absolute; left:2px; top:2px; width:68px; height:68px; overflow:hidden; }
.sw-bst-lyr { position:absolute; left:-1px; top:-1px; width:70px; height:70px; image-rendering:pixelated; pointer-events:none; }
.sw-bst-lyr-back { z-index:1; }
.sw-bst-ico { position:absolute; left:0; top:0; width:68px; height:68px; z-index:2; }
.sw-bst-lyr-ov { z-index:3; opacity:0.6; }
.sw-bst-lyr-front { z-index:4; }
.sw-bst-lyr-glow { z-index:5; display:none; }
.sw-bst-cell:hover .sw-bst-lyr-ov { display:none; }
.sw-bst-cell:hover .sw-bst-lyr-glow { display:block; }
/* 编号（TryGettingDisplayIndex → UIText 0.9 @ Top10 Left10 :61-71）：左上白字黑描边 */
.sw-bst-idx { position:absolute; left:10px; top:10px; font-size:12px; color:#fff; z-index:6;
  pointer-events:none; text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000; }
/* 详情栏（UIBestiaryEntryInfoPage :28-57）：230 宽，UIPanel chrome (73,94,171)/(89,116,213)，
 * 高 +12 下垂；chrome 走 ::before/::after（滚动在内容视内层——chrome 恒定不随滚）；
 * 列表 padding 2/上下 4、项距 4；滚轮 = 内容视滚动 */
.sw-bst-info { position:absolute; right:0; top:0; bottom:-12px; width:230px; overflow:hidden; }
.sw-bst-info::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-infobg) 12 fill stretch; }
.sw-bst-info::after { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-infoborder) 12 fill stretch; }
.sw-bst-infoview { position:absolute; inset:4px 2px; overflow-y:auto; overflow-x:hidden; }
.sw-bst-infoview::-webkit-scrollbar { width:12px; }
.sw-bst-infoview::-webkit-scrollbar-track { background:transparent; }
.sw-bst-infoview::-webkit-scrollbar-thumb { background:var(--bst-scrollbar) 50% 50%/12px 20px no-repeat; }
/* Nameplate（NamePlateInfoElement :19-31）：24 高行居中 */
.sw-bst-nameplate { height:24px; display:flex; align-items:center; justify-content:center;
  font-size:12px; color:#fff; text-shadow:1px 1px 0 #3f3f3f; word-break:break-all; }
/* Portrait（NPCPortraitInfoElement :21-96）：193×112 左 4；内盒 189×108 OverflowHidden；
 * 星面板 Stat_Panel 56² @(10,6)，5×Icon_Rank 14²（亮 Icon_Rank_Light/暗 Icon_Rank_Dim） */
.sw-bst-portrait { position:relative; width:197px; height:112px; }
.sw-bst-portraitin { position:absolute; left:4px; top:0; width:193px; height:112px; }
.sw-bst-portraitbox { position:absolute; left:2px; top:2px; width:189px; height:108px; overflow:hidden; }
.sw-bst-portraitbox canvas { position:absolute; left:0; top:0; image-rendering:pixelated; }
.sw-bst-pfront { position:absolute; left:0; top:0; width:193px; height:112px; image-rendering:pixelated;
  pointer-events:none; z-index:2; }
.sw-bst-stars { position:absolute; left:10px; top:6px; width:56px; height:56px; z-index:3; }
.sw-bst-stars::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-statpanel) 12 fill stretch; }
.sw-bst-stars img { position:absolute; width:14px; height:14px; image-rendering:pixelated; }
/* Stat_Panel 九宫块（角 12 条 7；底 (43,56,101)）：风味/击杀/出没通用底——chrome 走
 * ::before（子元素绝对定位以盒左上为原点 = 原版 UIElement 坐标系，无 border 位移） */
.sw-bst-spblock { position:relative; margin:0 8px 4px 3px; padding:2px 5px 2px 4px; }
.sw-bst-spblock::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-statpanel) 12 fill stretch; }
.sw-bst-flavor { font-size:11px; line-height:1.5; color:#fff; word-break:break-all; }
/* 属性卡（NPCStatsReportInfoElement :65-259）：图标 96×31 @(3,0)(102,0)(3,35)(102,35)，
 * 值右对 Left=-10（HAlign 1）→ right 10px；金币行 y78 x3/52/100/149 值 right 7px */
.sw-bst-stats { position:relative; height:70px; margin:0 0 4px; }
.sw-bst-stats.hascoins { height:108px; }
.sw-bst-stat { position:absolute; width:96px; height:31px; image-rendering:pixelated; }
.sw-bst-stat span { position:absolute; right:10px; top:0; height:31px; display:flex; align-items:center;
  font-size:12px; color:#fff; text-shadow:1px 1px 0 #3f3f3f; }
.sw-bst-stat-hp { left:3px; top:0; background:var(--bst-stathp); }
.sw-bst-stat-kb { left:102px; top:0; background:var(--bst-statkb); }
.sw-bst-stat-atk { left:3px; top:35px; background:var(--bst-statatk); }
.sw-bst-stat-def { left:102px; top:35px; background:var(--bst-statdef); }
.sw-bst-statcoin { position:absolute; top:78px; width:47px; height:31px; image-rendering:pixelated; }
.sw-bst-statcoin span { position:absolute; right:7px; top:0; height:31px; display:flex; align-items:center;
  font-size:12px; color:#fff; text-shadow:1px 1px 0 #3f3f3f; }
/* 击杀计数（NPCKillCounterInfoElement :23-89）：Stat_Panel 块 30 高右贴（Left -8 HAlign 1
 * → x 3..W-8），旗图+数右对 */
.sw-bst-kills { position:relative; height:30px; margin:0 8px 4px 3px; }
.sw-bst-kills::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-statpanel) 12 fill stretch; }
.sw-bst-kills canvas { position:absolute; left:0; top:2px; width:22px; height:22px; image-rendering:pixelated; }
.sw-bst-kills span { position:absolute; right:5px; top:0; height:30px; display:flex; align-items:center;
  font-size:12px; color:#fff; text-shadow:1px 1px 0 #3f3f3f; }
/* 出没环境行（FilterProviderInfoElement.ProvideUIElement :42-77）：Stat_Panel 块 34 高
 * （Width -14 Left 5 → x 5..W-9），图标 30² 左 5 垂中、文字左 38 scale0.8，悬停 MouseText */
.sw-bst-cond { position:relative; height:34px; margin:0 9px 4px 5px; }
.sw-bst-cond::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-statpanel) 12 fill stretch; }
.sw-bst-cond img { position:absolute; left:5px; top:2px; width:30px; height:30px; image-rendering:pixelated; }
.sw-bst-cond span { position:absolute; left:38px; right:5px; top:0; height:34px; display:flex;
  align-items:center; font-size:11px; color:#fff; text-shadow:1px 1px 0 #3f3f3f; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
/* 掉落行（UIBestiaryInfoItemLine :24-56）：32 高 UIPanel 图标框 (89,116,213)（悬停金框
 * :119-125），尺寸同出没行；图标左 4（PaddingLeft 10 合成）、右对掉率 */
.sw-bst-drop { position:relative; height:32px; margin:0 9px 4px 5px; }
.sw-bst-drop::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-dropblock) 12 fill stretch; }
.sw-bst-drop:hover::before { border-image:var(--bst-drophover) 12 fill stretch; }
.sw-bst-drop canvas { position:absolute; left:6px; top:4px; width:24px; height:24px; image-rendering:pixelated; }
.sw-bst-drop .rt { position:absolute; right:10px; top:-4px; height:32px; display:flex; align-items:center;
  font-size:12px; color:#fff; text-shadow:1px 1px 0 #3f3f3f; }
/* 分隔线（UIHorizontalSeparator：Separator1 6×4 × (89,116,213)*0.9） */
.sw-bst-sep { height:4px; margin:0 2px 4px; background:var(--bst-sep); background-size:100% 4px; }
/* 底栏（FillProgressBottomBar :159-181）：ColorBar 滑条 15 高（splice 左5右4上下4）+
 * 文本 0.8 叠左下（VAlign 1 / TextOrigin 0,0） */
.sw-bst-bottom { position:absolute; left:12px; right:12px; bottom:8px; height:20px; }
.sw-bst-bar { position:absolute; left:0; right:0; bottom:0; height:15px; }
.sw-bst-bar::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:4px solid transparent; border-image:var(--bst-colorbar) 4 4 4 5 fill stretch; }
.sw-bst-bar i { position:absolute; left:5px; right:4px; top:4px; bottom:4px; background:rgb(35,43,81); }
.sw-bst-bar i b { position:absolute; left:0; top:0; bottom:0; width:0%; background:rgb(51,137,255); }
.sw-bst-pct { position:absolute; left:0; bottom:0; font-size:11px; color:#fff; pointer-events:none;
  text-shadow:1px 1px 0 #3f3f3f; }
/* 出口钮（MakeExitButton :368-383）：UITextPanel UI.Back 50%×50 底部居中（Top -25），
 * 悬停 FadedMouseOver：底 (73,94,171) 框 (255,231,69) */
.sw-bst-exit { position:absolute; left:50%; transform:translateX(-50%); bottom:25px;
  width:calc(50% - 10px); height:50px; padding:0; margin:0; cursor:pointer; color:#fff;
  font-family:inherit; font-size:14px; display:flex; align-items:center; justify-content:center;
  border:12px solid transparent; border-image:var(--bst-exitbg) 12 fill stretch; }
.sw-bst-exit:hover { border-image:var(--bst-exithover) 12 fill stretch; }
/* 弹层（OpenOrCloseSorting/FilteringGrid :398-420）：bestiarySpace 整域遮罩 (35,40,83)*0.5；
 * 内面板 chrome 走 ::before/::after（子钮以面板左上为原点：Top 5+28i / 6+34格） */
.sw-bst-pop { position:absolute; inset:0; background:rgba(35,40,83,0.5); z-index:10; }
.sw-bst-pop-panel { position:absolute; top:0; right:118px; width:126px; }
.sw-bst-pop-panel::before { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-popbg) 12 fill stretch; }
.sw-bst-pop-panel::after { content:''; position:absolute; inset:0; pointer-events:none;
  border:12px solid transparent; border-image:var(--bst-popborder) 12 fill stretch; }
.sw-bst-pop-filter { right:0; width:418px; }
.sw-bst-opt { position:absolute; display:block; width:114px; height:26px; padding:0; margin:0;
  left:6px; border:none; cursor:pointer; color:#fff; font-family:inherit; font-size:11px;
  background:transparent; }
.sw-bst-opt .bg { position:absolute; inset:0; border:10px solid transparent;
  border-image:var(--bst-optun) 10 fill stretch; }
.sw-bst-opt.sel .bg { border-image:var(--bst-optsel) 10 fill stretch; }
.sw-bst-opt.dim .bg { border-image:var(--bst-optdim) 10 fill stretch; }
.sw-bst-opt .hborder { position:absolute; inset:0; opacity:0; pointer-events:none;
  border:10px solid transparent; border-image:var(--bst-opthover) 10 fill stretch; }
.sw-bst-opt:hover .hborder { opacity:1; }
.sw-bst-opt span { position:absolute; inset:0 5px; display:flex; align-items:center;
  justify-content:center; pointer-events:none; white-space:nowrap; overflow:hidden; }
.sw-bst-fcell { position:absolute; width:32px; height:32px; padding:0; margin:0; border:none; cursor:pointer;
  background:transparent; }
.sw-bst-fcell .bg { position:absolute; inset:0; border:10px solid transparent;
  border-image:var(--bst-optun) 10 fill stretch; }
.sw-bst-fcell.sel .bg { border-image:var(--bst-optsel) 10 fill stretch; }
.sw-bst-fcell.dim .bg { border-image:var(--bst-optdim) 10 fill stretch; }
.sw-bst-fcell.dim { cursor:default; }
.sw-bst-fcell .hborder { position:absolute; inset:0; opacity:0; pointer-events:none;
  border:10px solid transparent; border-image:var(--bst-opthover) 10 fill stretch; }
.sw-bst-fcell:not(.dim):hover .hborder { opacity:1; }
.sw-bst-fcell img { position:absolute; width:30px; height:30px; image-rendering:pixelated;
  pointer-events:none; }
.sw-bst-fcell.dim img { opacity:0.2; }
/* MouseText 替代悬浮提示（Main.instance.MouseText 名字/完成度/属性名）
   ★BJ-C4-F3：.sw-bst-tip 面退役 → 共享族 .sw-mt-tip（src/ui/MouseTextTip.ts 单源） */
`;

export interface BestiaryPanelFlow {
  getTracker(): BestiaryTracker;
  atlas?: SpriteAtlas | null;
  /** 世界恶取向（BestiaryPortraitBackgroundBasedOnWorldEvil：crimson=true 取猩红路） */
  isCrimson?(): boolean;
  /** 世界难度（掉落行 CanShowItemDropInUI 门：专家/大师行按档显隐） */
  isExpert?(): boolean;
  isMaster?(): boolean;
  /** ★BJ507 B2：掉落行悬停全量 item tooltip（Main.HoverItem 面——
   *  UIBestiaryInfoItemLine.DrawMouseOver :130-134 `Main.HoverItem = _infoDisplayItem;
   *  Main.instance.MouseText("", 0, 0); Main.mouseText = true;` → MouseText 走
   *  item tooltip 全载荷管线。本仓复用 UI.buildTooltipHtml 单源（BJ407）；
   *  notes = 掉落条件描述行族（SetBestiaryNotesOnItemCache :136-151 →
   *  Item.BestiaryNotes → Main.cs:21539-21547 tooltip 末尾逐行追加） */
  showItemTooltip?(itemId: number, anchor: HTMLElement, notes?: string[]): void;
  hideItemTooltip?(): void;
  /** ★BJ-C4-F3：光标持物谓词（mouseItem 语义,UI.heldStack——BJ501 定谳口径）。
   *  MouseText 悬停名锚 X+34 臂（Main.cs:20390-20392 !mouseItem.IsAir）消费 */
  uiHeldItemRef?(): boolean;
  onBack(): void;
}

const UI_BASE = 'sprites/vanilla-ui/';
const VA_BASE = 'sprites/vanilla/';

/** 面板 chrome 染色变量表（九宫贴图 × 原版色；逐项 = [变量名, 源图, 乘色 rgb, α乘]）。
 *  色源：主面板 (33,43,79)*0.8（UIBestiaryTest :85）；范围/搜索框 (35,40,83)（:247-248）；
 *  详情 (73,94,171)/(89,116,213)（:33-34）；Stat_Panel 块底 (43,56,101)（FlavorText :22）；
 *  分隔线 (89,116,213)*0.9（:156）；选项钮 选中 (152,175,235)/未选 InventoryDefaultColor
 *  (63,65,151)*0.7（SortingOptionsGrid :102-106）；不可用 Lerp(Black,un,0.5)*0.7；
 *  进度条填充 (51,137,255)/底 (35,43,81)（:174-175）；滑条框贴图 vanilla/ColorBar；
 *  出口钮 (63,82,151)*0.8 → 悬停 (73,94,171)/(255,231,69)（FadedMouseOver :464-475） */
const CHROME_DEFS: Array<[string, string, string, number[], number?]> = [
  ['--bst-pbg', 'UI_PanelBackground', UI_BASE, [26, 34, 63], 0.8],
  ['--bst-pborder', 'UI_PanelBorder', UI_BASE, [0, 0, 0]],
  ['--bst-infobg', 'UI_PanelBackground', UI_BASE, [73, 94, 171]],
  ['--bst-infoborder', 'UI_PanelBorder', UI_BASE, [89, 116, 213]],
  ['--bst-dark', 'UI_PanelBackground', UI_BASE, [35, 40, 83]],
  ['--bst-darkgold', 'UI_PanelBackground', UI_BASE, [255, 231, 69]],
  ['--bst-statpanel', 'UI_Bestiary_Stat_Panel', UI_BASE, [43, 56, 101]],
  ['--bst-dropblock', 'UI_PanelBackground', UI_BASE, [63, 82, 151], 0.7],
  ['--bst-drophover', 'UI_PanelBorder', UI_BASE, [255, 231, 69]],
  ['--bst-sep', 'UI_CharCreation_Separator1', UI_BASE, [80, 104, 191], 0.9],
  ['--bst-optsel', 'UI_CharCreation_PanelGrayscale', UI_BASE, [152, 175, 235]],
  ['--bst-optun', 'UI_CharCreation_PanelGrayscale', UI_BASE, [44, 45, 105]],
  ['--bst-optdim', 'UI_CharCreation_PanelGrayscale', UI_BASE, [22, 22, 52]],
  ['--bst-opthover', 'UI_CharCreation_CategoryPanelBorder', UI_BASE, [255, 255, 255]],
  ['--bst-exitbg', 'UI_PanelBackground', UI_BASE, [44, 57, 105], 0.8],
  ['--bst-exithover', 'UI_PanelBackground', UI_BASE, [73, 94, 171]],
  ['--bst-popbg', 'UI_PanelBackground', UI_BASE, [65, 84, 153], 0.9],
  ['--bst-popborder', 'UI_PanelBorder', UI_BASE, [80, 104, 191], 0.9],
  ['--bst-stathp', 'UI_Bestiary_Stat_HP', UI_BASE, [255, 255, 255]],
  ['--bst-statkb', 'UI_Bestiary_Stat_Knockback', UI_BASE, [255, 255, 255]],
  ['--bst-statatk', 'UI_Bestiary_Stat_Attack', UI_BASE, [255, 255, 255]],
  ['--bst-statdef', 'UI_Bestiary_Stat_Defense', UI_BASE, [255, 255, 255]],
  ['--bst-colorbar', 'ColorBar', VA_BASE, [255, 255, 255]],
  ['--bst-scrollbar', 'UI_Scrollbar', UI_BASE, [255, 255, 255]],
];
/** <img>/background-image 直贴（不染色） */
const SPRITE_VARS: Array<[string, string, string]> = [
  ['--bst-btnback', 'UI_Bestiary_Button_Back', UI_BASE],
  ['--bst-btnfwd', 'UI_Bestiary_Button_Forward', UI_BASE],
  ['--bst-btnborder', 'UI_Bestiary_Button_Border', UI_BASE],
  ['--bst-btnsort', 'UI_Bestiary_Button_Sorting', UI_BASE],
  ['--bst-btnfilter', 'UI_Bestiary_Button_Filtering', UI_BASE],
  ['--bst-wideborder', 'UI_Bestiary_Button_Wide_Border', UI_BASE],
  ['--bst-btnsearch', 'UI_Bestiary_Button_Search', UI_BASE],
  ['--bst-btnsearchborder', 'UI_Bestiary_Button_Search_Border', UI_BASE],
  ['--bst-searchcancel', 'UI_SearchCancel', UI_BASE],
  ['--bst-ranklight', 'UI_Bestiary_Icon_Rank_Light', UI_BASE],
  ['--bst-rankdim', 'UI_Bestiary_Icon_Rank_Dim', UI_BASE],
];

export class BestiaryPanel {
  private panel: HTMLElement;
  private outer!: HTMLElement;
  private gridWrap!: HTMLElement;
  private gridEl!: HTMLElement;
  private rangeEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private pctEl!: HTMLElement;
  private barFillEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private sortTextEl!: HTMLElement;
  private filterTextEl!: HTMLElement;
  private ro: ResizeObserver | null = null;
  /** RO 稳定居抖定时器(close 时清,防面板关后补刷) */
  private roTimer: ReturnType<typeof setTimeout> | 0 = 0;
  /** 关闭键走键位表（Inventory 动作,与 main.ts 主链 isBound('Inventory') 同源;
   *  原版图鉴在物品栏 UI 链内,随 Inventory 键开合——重绑后跟随）。capture 阶段
   *  拦截防 main.ts 暂停键二次消费。搜索框聚焦时首按 Esc 仅失焦。 */
  private escHandler = (e: KeyboardEvent) => {
    if (document.activeElement === this.searchEl) {
      this.searchEl.blur();
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (isBound('Inventory', e.code)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      this.close();
    }
  };
  private filter: BestiaryFilter = { ...DEFAULT_BESTIARY_FILTER, tags: [] };
  /** 排序步 = EntrySorter._prioritizedStep（int 缺省 0 = Steps[0] = ByUnlockState） */
  private sortKey: BestiarySortKey = 'unlocks';
  /** 弹层当前高亮（_currentSelected，-1 = 无）；再点同项回退默认步 0（_defaultStepIndex） */
  private sortSelected = -1;
  private offset = 0;
  private perPage = 40;
  private working: BestiaryRow[] = [];
  private selected: BestiaryRow | null = null;
  /** 弹层（挂 gridWrap = _bestiarySpace；互斥开合 :398-420） */
  private sortPopEl: HTMLElement | null = null;
  private filterPopEl: HTMLElement | null = null;
  // ★BJ-C4-F3：私有 tipEl 面退役（升格共享族 MouseTextTip 单源,字段随删）

  constructor(private parent: HTMLElement, private flow: BestiaryPanelFlow) {
    if (!document.getElementById('sw-bst-style')) {
      const style = document.createElement('style');
      style.id = 'sw-bst-style';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.panel = document.createElement('div');
    this.panel.className = 'sw-bst';
    this.panel.innerHTML = `
      <div class="sw-bst-outer">
        <div class="sw-bst-panel">
          <div class="sw-bst-top">
            <button class="sw-bst-imgbtn sw-bst-navback" data-nav="-1" title=""></button>
            <button class="sw-bst-imgbtn sw-bst-navfwd" data-nav="1" title=""></button>
            <div class="sw-bst-range">0-0 (0)</div>
            <button class="sw-bst-widebtn sw-bst-sortbtn" data-sortbtn><span data-sorttext></span></button>
            <button class="sw-bst-widebtn sw-bst-filterbtn" data-filterbtn><span data-filtertext></span></button>
            <div class="sw-bst-search">
              <button class="sw-bst-searchbtn" data-searchbtn title=""></button>
              <div class="sw-bst-searchbox" data-searchbox>
                <input type="text" data-search maxlength="50" />
                <button class="sw-bst-searchcancel" data-searchcancel title=""></button>
              </div>
            </div>
          </div>
          <div class="sw-bst-body">
            <div class="sw-bst-gridwrap"><div class="sw-bst-grid"></div></div>
            <div class="sw-bst-info"><div class="sw-bst-infoview"></div></div>
          </div>
          <div class="sw-bst-bottom">
            <div class="sw-bst-bar"><i><b style="width:0%"></b></i></div>
            <div class="sw-bst-pct"></div>
          </div>
        </div>
        <button class="sw-bst-exit"></button>
      </div>
    `;
    this.outer = this.panel.querySelector('.sw-bst-outer')!;
    this.gridWrap = this.panel.querySelector('.sw-bst-gridwrap')!;
    this.gridEl = this.panel.querySelector('.sw-bst-grid')!;
    this.rangeEl = this.panel.querySelector('.sw-bst-range')!;
    this.infoEl = this.panel.querySelector('.sw-bst-infoview')!;
    this.pctEl = this.panel.querySelector('.sw-bst-pct')!;
    this.barFillEl = this.panel.querySelector('.sw-bst-bar b') as HTMLElement;
    this.searchEl = this.panel.querySelector('[data-search]') as HTMLInputElement;
    this.sortTextEl = this.panel.querySelector('[data-sorttext]')!;
    this.filterTextEl = this.panel.querySelector('[data-filtertext]')!;
    const exit = this.panel.querySelector('.sw-bst-exit') as HTMLButtonElement;
    exit.textContent = Lang.text('UI.Back');
    exit.addEventListener('click', () => { UISfx.menuClose(); this.close(); });
    this.panel.querySelectorAll('[data-nav]').forEach((b) => {
      (b as HTMLElement).addEventListener('click', () => this.page(Number((b as HTMLElement).dataset.nav)));
      this.bindTip(b as HTMLElement, () => '');
      this.bindHoverSound(b as HTMLElement);
    });
    this.searchEl.placeholder = Lang.has('UI.PlayerNameSlot') ? Lang.text('UI.PlayerNameSlot') : '';
    this.searchEl.addEventListener('input', () => {
      this.filter.search = this.searchEl.value;
      this.updateSearchCancel();
      this.refresh();
    });
    const box = this.panel.querySelector('[data-searchbox]') as HTMLElement;
    this.searchEl.addEventListener('focus', () => box.classList.add('focus'));    // OnStartTakingInput :208-210
    this.searchEl.addEventListener('blur', () => box.classList.remove('focus'));  // OnEndTakingInput :213-218
    const cancel = this.panel.querySelector('[data-searchcancel]') as HTMLButtonElement;
    cancel.addEventListener('click', () => {
      if (this.searchEl.value) {   // searchCancelButton_OnClick :135-142：有内容=清+音11，无=音12
        this.searchEl.value = '';
        this.filter.search = '';
        this.updateSearchCancel();
        this.refresh();
        UISfx.menuClose();
      } else {
        UISfx.click();
      }
    });
    this.panel.querySelector('[data-sortbtn]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSortPop();
    });
    this.panel.querySelector('[data-filterbtn]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFilterPop();
    });
    // 滚轮 = 详情栏滚动（UIBestiaryTest.ScrollWheel :850-854 → _infoSpace.UpdateScrollbar；
    // ★原版无滚轮翻页——旧自创面拆除，翻页只走 ◀▶ 钮）
    this.panel.addEventListener('wheel', (e) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      this.infoEl.scrollTop += e.deltaY;
    }, { passive: false });
    // capture 阶段拦截：防 main.ts 全局 Esc/E 处理器同时关暂停菜单/背包
    window.addEventListener('keydown', this.escHandler, true);
    if (typeof ResizeObserver !== 'undefined') {
      // ★resize 稳定居抖(2026-08-14,用户报"resize 后头像全消失"):拖拽窗口
      // = 每帧 RO→refresh→replaceChildren+~81 张新 canvas=画布创建风暴→GPU
      // 压力致 context 丢失(canvas 2D 内容不自动恢复)→全透明。150ms 稳定后
      // 只刷一次;rAF 合并保留给滚轮/点击等高频源
      let lastW = -1, lastH = -1;
      this.ro = new ResizeObserver(() => {
        const w = this.gridWrap.clientWidth, h = this.gridWrap.clientHeight;
        if (w === lastW && h === lastH) return;
        if (this.roTimer) clearTimeout(this.roTimer);
        this.roTimer = setTimeout(() => {
          this.roTimer = 0;
          if (w === lastW && h === lastH) return;
          lastW = w; lastH = h;
          this.refresh();
        }, 150) as unknown as ReturnType<typeof setTimeout>;
      });
      this.ro.observe(this.gridWrap);
    }
    this.panel.querySelectorAll('.sw-bst-imgbtn,.sw-bst-widebtn,.sw-bst-searchbtn').forEach((b) => this.bindHoverSound(b as HTMLElement));
    this.bindTip(this.panel.querySelector('.sw-bst-bar')!, () =>
      Lang.text('BestiaryInfo.PercentCollected').replace('{Percent}', prettifyPercentDisplay(this.progressPercent())));   // ShowStats_Completion :183-190
    parent.appendChild(this.panel);
    this.applyChrome();
    this.refresh();
    UISfx.click();
  }

  /** chrome 贴图异步染色 → CSS 变量（BJ506：PanelBackground/PanelBorder/Stat_Panel/
   *  PanelGrayscale/CategoryPanelBorder/Separator1/ColorBar/Scrollbar × 原版色） */
  private applyChrome(): void {
    void (async () => {
      const set = (name: string, url: string) => this.panel.style.setProperty(name, `url(${url})`);
      for (const [name, file, base, rgb, aMul] of CHROME_DEFS) {
        try {
          const img = await bstLoadImg(base + file + '.png');
          set(name, bstTintDataUrl(img, rgb[0], rgb[1], rgb[2], aMul ?? 1));
        } catch { /* 贴图缺 = 底色兜底（CSS 已有面板底色） */ }
      }
      for (const [name, file, base] of SPRITE_VARS) {
        set(name, `${base}${file}.png`);
      }
      this.panel.style.setProperty('--bst-wideborder', `url(${UI_BASE}UI_Bestiary_Button_Wide_Border.png)`);
    })();
  }

  private bindHoverSound(el: HTMLElement): void {
    el.addEventListener('mouseenter', () => UISfx.hover());   // UIImageButton.MouseOver :61 / GroupOptionButton :255（音 12）
  }

  /** MouseText 悬浮提示（面板内轻量替身；随鼠标移动，离开即隐）。
   *  ★BJ-C4-F3（2026-10-06 R4 UI 批清偿）：自创固定偏移（+16/+20,无持物臂、无
   *  屏缘钳）退役 → 委托共享族 MouseTextTip 单源（Renderer.mouseTextAnchor 公式
   *  = Main.MouseTextInner Main.cs:20379-20419 1:1：X=mouse+14+6[ThickMouse 默认档]
   *  +34[光标持物]/Y=mouse+14+6 + 全串盒 40px 屏缘钳）。原版锚:图鉴悬停名/完成度/
   *  属性名/筛选名全走 Main.instance.MouseText（UIBestiaryEntryButton.cs:147/
   *  UIBestiaryFilteringOptionsGrid.cs:223 同面）；heldOnCursor 谓词=BJ501 定谳
   *  mouseItem 语义（flow.uiHeldItemRef → UI.heldStack）。 */
  private bindTip(el: HTMLElement, textFn: () => string): void {
    bindMouseTextTip(el, () => textFn(),
      { heldOnCursor: () => !!this.flow.uiHeldItemRef?.() });
  }
  private hideTip(): void {
    hideMouseTextTip();
  }

  private updateSearchCancel(): void {
    (this.panel.querySelector('[data-searchcancel]') as HTMLElement)?.classList.toggle('on', !!this.searchEl.value);
  }

  // ---- 弹层开合（UIBestiaryTest.OpenOrCloseSortingOptions/FilteringGrid :398-420：
  //      互斥；再点同钮关闭；点遮罩关闭 :422-434/:450-462）----

  private closePops(): void {
    this.sortPopEl?.remove(); this.sortPopEl = null;
    this.filterPopEl?.remove(); this.filterPopEl = null;
    this.hideTip();   // 弹层内钮的悬停提示随层消亡（探针实锤：撤层后 tip 残留）
  }

  private toggleSortPop(): void {
    if (this.sortPopEl) { this.closePops(); return; }
    this.closePops();
    const pop = document.createElement('div');
    pop.className = 'sw-bst-pop';
    pop.addEventListener('click', (e) => { if (e.target === pop) this.closeSortPop(); });   // Click_CloseSortingGrid :450-456
    const panelEl = document.createElement('div');
    panelEl.className = 'sw-bst-pop-panel';
    // 高度 = 可见步数 × 28 + 8（BuildGrid :49-61：num2=26+2，+5+3）
    panelEl.style.height = `${BESTIARY_SORT_OPTIONS.length * 28 + 8}px`;
    pop.appendChild(panelEl);
    BESTIARY_SORT_OPTIONS.forEach((key, i) => {
      // GroupOptionButton<int>(j=Steps 索引)：OptionValue = 注册序真索引；
      // Top = 5 + (26+2)*i（BuildGrid :73），Left 6（Width 114 HAlign 0.5 于 126 面板）
      const stepIndex = BESTIARY_SORT_KEYS.indexOf(key);
      const b = document.createElement('button');
      b.className = 'sw-bst-opt' + (this.sortSelected === stepIndex ? ' sel' : '');
      b.style.top = `${5 + 28 * i}px`;
      b.innerHTML = '<i class="bg"></i><i class="hborder"></i><span></span>';
      (b.querySelector('span') as HTMLElement).textContent = sortLabel(key);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.clickSortOption(stepIndex); });   // ClickOption :89-115（音 12 由 bindHoverSound+click）
      b.addEventListener('mouseenter', () => UISfx.hover());
      panelEl.appendChild(b);
    });
    this.gridWrap.appendChild(pop);
    this.sortPopEl = pop;
    this.filterPopEl = null;
    UISfx.click();
  }
  private closeSortPop(): void {
    this.closePops();
    this.updateBestiaryTexts();   // CloseSortingGrid :458-462 → UpdateBestiaryContents
  }

  private clickSortOption(stepIndex: number): void {
    // ClickOption（UIBestiarySortingOptionsGrid :89-115）：再点同项 → 回退默认步 0
    let num = stepIndex;
    if (num === this.sortSelected) num = 0;   // _defaultStepIndex = 0（ByUnlockState，隐藏步）
    this.sortSelected = num;
    this.sortKey = BESTIARY_SORT_KEYS[num];
    if (this.sortPopEl) {
      for (const el of Array.from(this.sortPopEl.querySelectorAll('.sw-bst-opt'))) el.classList.remove('sel');
      const selIndex = BESTIARY_SORT_OPTIONS.indexOf(this.sortKey);
      if (selIndex >= 0) this.sortPopEl.querySelectorAll('.sw-bst-opt')[selIndex]?.classList.add('sel');
    }
    UISfx.click();
    this.refresh();
  }

  private toggleFilterPop(): void {
    if (this.filterPopEl) { this.closePops(); return; }
    this.closePops();
    const pop = document.createElement('div');
    pop.className = 'sw-bst-pop';
    pop.addEventListener('click', (e) => { if (e.target === pop) this.closeFilterPop(); });   // Click_CloseFilteringGrid :422-428
    const panelEl = document.createElement('div');
    panelEl.className = 'sw-bst-pop-panel sw-bst-pop-filter';
    panelEl.style.height = `${Math.ceil(BESTIARY_FILTER_DEFS.length / 12) * 34 + 10}px`;   // BuildContainer :43-60
    pop.appendChild(panelEl);
    this.filterPopEl = pop;
    this.sortPopEl = null;
    this.gridWrap.appendChild(pop);
    this.buildFilterGrid();
    UISfx.click();
  }
  private closeFilterPop(): void {
    this.closePops();
    this.refresh();   // CloseFilteringGrid :430-434 → UpdateBestiaryContents
  }

  /** UpdateAvailability（UIBestiaryFilteringOptionsGrid.cs:80-150）1:1：
   *  每筛选钮 32²/间距 2/perRow 12（GetDisplaySettings :160-174 钉死 perRow=12）、
   *  图标 30² 左上偏 (1,1)（image Left/Top=-1 + HAlign/VAlign 0.5 合成）；可用性 =
   *  ForcedDisplay ?? 存在已解锁命中条目（不可用钮换 Icon_Tags_Shadow 帧(0,4)×0.2 且
   *  从激活集除名 :119-121）；选中态 UpdateButtonSelections :176-191 */
  private buildFilterGrid(): void {
    const pop = this.filterPopEl;
    if (!pop) return;
    const panelEl = pop.querySelector('.sw-bst-pop-panel') as HTMLElement;
    panelEl.replaceChildren();
    const unlockedRows = bestiaryRows(this.flow.getTracker());
    BESTIARY_FILTER_DEFS.forEach((def, i) => {
      const row = Math.floor(i / 12), col = i % 12;
      const available = bestiaryFilterAvailable(def.key, unlockedRows);
      const active = this.filter.tags.includes(def.key);
      const b = document.createElement('button');
      b.className = 'sw-bst-fcell' + (active ? ' sel' : '') + (available ? '' : ' dim');
      b.style.left = `${6 + col * 34}px`;
      b.style.top = `${6 + row * 34}px`;
      b.innerHTML = '<i class="bg"></i><i class="hborder"></i>';
      if (!available) {
        // UpdateAvailability 不可用臂（UIBestiaryFilteringOptionsGrid.cs:119-121）：
        // `_filterer.ActiveFilters.Remove(bestiaryEntryFilter)`——失效筛选即从激活集
        // 除名（红队R3⑦:曾仅置 disabled,激活 tag 幽灵残留 → 重筛恒吃死集）
        if (active) {
          this.filter = { ...this.filter, tags: this.filter.tags.filter((t) => t !== def.key) };
          this.updateBestiaryTexts();
          this.refresh();
        }
        b.appendChild(this.filterIconImg(-1));   // 帧(0,4) = Icon_Tags_Shadow 末行首帧（:135-141）
      } else {
        // GetImage（Filters.cs:44-52/:75-83/:107-116/:139-147）：ByRareCreature =
        // Icon_Rank_Light 单帧 14² 居中（HAlign/VAlign 0.5 + Left/Top -1 → x 8）；
        // 其余 = Icon_Tags_Shadow 帧 30² @(0,0)（Left/Top -1 + 0.5 对中合成）
        if (def.key === 'rare') {
          const star = document.createElement('img');
          star.alt = '';
          star.src = `${UI_BASE}UI_Bestiary_Icon_Rank_Light.png`;
          star.style.left = '8px';
          star.style.top = '8px';
          star.style.width = '14px';
          star.style.height = '14px';
          b.appendChild(star);
        } else {
          b.appendChild(this.filterIconImg(def.frame));
        }
        this.bindTip(b, () => (Lang.has(def.nameKey) ? Lang.text(def.nameKey) : def.nameKey));   // ShowButtonName :218-225
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.filter = applyBestiaryChip(this.filter, 'tag', undefined, def.key);   // ClickOption :227-236
          this.buildFilterGrid();
          UISfx.click();
          this.refresh();
        });
      }
      panelEl.appendChild(b);
    });
  }

  /** Icon_Tags_Shadow 16×5 帧表 30² 帧裁剪（frame<0 = 不可用灰帧(0,4)；
   *  Info 页出没行同用本裁剪，FilterProviderInfoElement.GetFilterImage :20-34） */
  private filterIconImg(frame: number): HTMLElement {
    const img = document.createElement('img');
    img.alt = '';
    const fx = frame < 0 ? 0 : frame % 16;
    const fy = frame < 0 ? 4 : Math.floor(frame / 16);
    img.style.left = '1px';
    img.style.top = '1px';
    img.style.backgroundImage = `url(${UI_BASE}UI_Bestiary_Icon_Tags_Shadow.png)`;
    img.style.backgroundSize = '480px 150px';
    img.style.backgroundPosition = `${-30 * fx}px ${-30 * fy}px`;
    img.style.backgroundRepeat = 'no-repeat';
    return img;
  }

  /** 文案（UpdateBestiaryContents :436-448 前段）：排序钮右 = 当前步名（EntrySorter
   *  GetDisplayName 恒显，初始 Steps[0]="解锁"）；筛选钮右 = 筛选器（N个）恒显 */
  private updateBestiaryTexts(): void {
    this.sortTextEl.textContent = sortLabel(this.sortKey);
    this.filterTextEl.textContent = Lang.text('BestiaryInfo.Filters').replace('{Count}', String(this.filter.tags.length));
  }

  /** OnOpenPage → UpdateBestiaryContents（FilterEntries → SortEntries → Fill + 进度）。
   *  ★rAF 合并(2026-08-13):滚轮/RO/点击风暴每帧至多重建一次——此前每个 wheel
   *  tick 一次全量重建×每格自取解码 = 渲染进程崩溃(用户报"滚动翻两页就崩")
   *  ★BJ506：筛选/排序/搜索变更不重置页偏移（原版 FixBestiaryRange(+0) 只钳制）。
   *  ★BJ506 序词闸：原版 UpdateBestiaryContents 同步执行（关弹层→清选中→重填），
   *  其后发生的格点击必然落在重填之后；rAF 推迟制造"排队后选中被抹"窗口
   *  （探针实锤：关筛选弹层同帧点格 → selectRow 渲染后 rAF 清空）。selectSeq/
   *  refreshSeq 对序——排队之后发生的选中在 refreshNow 中保留（原版终态=新网格
   *  +该选中；点击行已不在新工作集的边角态 = 详情栏仍显示该条目，与原版
   *  SelectEntryButton 直填语义同）。 */
  private refreshQueued = false;
  private refreshSeq = 0;
  private selectSeq = 0;
  refresh() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    const seq = ++this.refreshSeq;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.refreshNow(seq);
    });
  }

  private refreshNow(seq: number) {
    // ★SW-RB14d（FX37-F5）：网格重建=原版 FillBestiarySpaceWithEntries
    //  （UIBestiaryTest.cs:340-347 `DeselectEntryButton()` 先行——筛选/排序/翻页
    //  全部经此重填,OffsetLibrary :111-115 翻页同）⇒ 重建即清选中,详情栏回空白态
    //  （renderInfo 的 !selected 分支=FillInfoForEntry(null) 同位）。旧刀保旧选中,
    //  筛选后详情栏仍显示已不在工作集的条目 = 1:1 偏差（登记 FX37-F5,本刀清偿）。
    //  ★BJ506 序词闸：排队后发生的选中（selectSeq > seq）保留不抹（见 refresh 注）。
    this.selected = this.selectSeq > seq ? this.selected : null;
    this.updateBestiaryTexts();
    const rows = bestiaryRows(this.flow.getTracker());
    sortBestiaryRows(rows, this.sortKey);
    this.working = filterBestiaryRows(rows, this.filter);
    const { cols, rows: gridRows, perPage } = bestiaryGridSize(this.gridWrap.clientWidth, this.gridWrap.clientHeight);
    this.perPage = perPage;
    this.offset = clampBestiaryOffset(this.offset, 0, this.working.length, perPage);
    this.rangeEl.textContent = bestiaryRangeText(this.offset, this.working.length, perPage);
    void gridRows;
    this.fillGrid();
    this.updateProgress();
    this.renderInfo();
    this.scheduleBlankSweep();
    if (this.filterPopEl) this.buildFilterGrid();   // UpdateBestiaryContents → UpdateAvailability :438
  }

  private progressPercent(): number {
    return this.flow.getTracker().completion().percent;   // GetUnlockProgress :501-517 口径（>NotKnown 计 1）
  }

  /** 自愈补画扫描(2026-08-14,用户报"resize 后头像全消失"):
   *  每次 refresh 后 400ms 补画"从未画上"的画布(drawPortrait 幂等+缓存命中=同步)。
   *  ★FX37 重做(2026-09-11,探针取证):旧版对全部可见画布逐张 getImageData 判空——
   *  81+1 张/次=22-25ms 同步 GPU→CPU 读回,恰在每次翻页/筛选/选中后 400ms 必然
   *  落一帧 16-33ms 的掉 vsync(probe 实测 pages/details 段各 1 次 >20ms 帧,与
   *  getImageData 账面逐段吻合)。改为 painted 登记面:只重试未画上的画布,零读回;
   *  context 丢失面由各画布 contextlost/contextrestored 监听自愈(两处画布均在
   *  创建后、首画前同步挂监听,无"监听前丢失"窗口期;★SW-RB14d 备案:掉落表
   *  itemIcon() 离屏小画布为第三类,不在 sweep 域也无监听=丢_context_后空白至
   *  下次 renderInfo,预存面非本刀引入)。 */
  private sweepTimer: ReturnType<typeof setTimeout> | 0 = 0;
  /** 已实际落笔的画布登记(drawPortrait/drawLockedIcon 各落笔点登记;sweep 只补漏) */
  private painted = new WeakSet<HTMLCanvasElement>();
  /** renderInfo 的大头像参数(sweep 补画用) */
  private infoDraw: { canvas: HTMLCanvasElement; npcId: number; st: number } | null = null;
  private scheduleBlankSweep(): void {
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = 0;
      if (!this.panel.isConnected) return;
      const cells: BestiarySweepCell[] = [...this.gridEl.querySelectorAll('.sw-bst-cell')].map((cell) => ({
        canvas: cell.querySelector('.sw-bst-ico') as HTMLCanvasElement | null,
        creditId: (cell as HTMLElement).dataset.credit ?? null,
      }));
      for (const t of bestiarySweepTargets(cells, this.working, this.painted)) {
        this.drawPortrait(t.canvas as HTMLCanvasElement, t.npcId, 'grid', t.unlocked);
      }
      // 大头像
      if (this.infoDraw && !this.painted.has(this.infoDraw.canvas)) {
        this.drawPortrait(this.infoDraw.canvas, this.infoDraw.npcId, 'portrait', this.infoDraw.st > UnlockState.NotKnown);
      }
    }, 400) as unknown as ReturnType<typeof setTimeout>;
  }

  private page(dir: number) {
    // OffsetLibraryByPages（UIBestiaryEntryGrid :97-115）
    const next = clampBestiaryOffset(this.offset, dir * this.perPage, this.working.length, this.perPage);
    if (next === this.offset) return;  // 边界空滚:offset 不变不重建
    this.offset = next;
    this.refresh();
  }

  /** 网格重填（FillBestiarySpaceWithEntries :37-71 1:1）：72² 格在 (w/72)×(h/72) 扇区
   *  内居中（Left/Top = (k+0.5)/cols、(j+0.5)/rows 百分比 + HAlign/VAlign 0.5）。 */
  private fillGrid() {
    this.gridEl.replaceChildren();
    const { cols, rows } = bestiaryGridSize(this.gridWrap.clientWidth, this.gridWrap.clientHeight);
    const end = Math.min(this.working.length, this.offset + this.perPage);
    let n = 0;
    for (let j = 0; j < rows; j++) {
      for (let k = 0; k < cols; k++) {
        if (n >= end - this.offset) return;
        const r = this.working[this.offset + n];
        n++;
        const cell = document.createElement('div');
        cell.className = 'sw-bst-cell';
        cell.dataset.credit = r.entry.creditId;
        cell.style.left = `${(100 * (k + 0.5)) / cols}%`;
        cell.style.top = `${(100 * (j + 0.5)) / rows}%`;
        // 内盒（EntryButton :30-39）：-4 居中 OverflowHidden；层序 Slot_Back→底图/图标→
        // Slot_Overlay×0.6→Slot_Front，悬停 Swap（MouseOver/MouseOut :151-170）
        cell.innerHTML = `
          <div class="sw-bst-slotin">
            <img class="sw-bst-lyr sw-bst-lyr-back" alt="" src="${UI_BASE}UI_Bestiary_Slot_Back.png" />
            <canvas class="sw-bst-ico" width="68" height="68"></canvas>
          </div>
          <img class="sw-bst-lyr sw-bst-lyr-ov" alt="" src="${UI_BASE}UI_Bestiary_Slot_Overlay.png" />
          <img class="sw-bst-lyr sw-bst-lyr-front" alt="" src="${UI_BASE}UI_Bestiary_Slot_Front.png" />
          <img class="sw-bst-lyr sw-bst-lyr-glow" alt="" src="${UI_BASE}UI_Bestiary_Slot_Selection.png" />
        `;
        // 编号（TryGettingDisplayIndex :132-141 → NPCNetIdBestiaryInfoElement.
        // BestiaryDisplayIndex = ContentSamples.NpcBestiarySortingId[NetId]——
        // ★取条目自身 netId（entryId）：重复 creditId 归并行（Nymph×2/Scarecrow1×10）
        // 各持独立 NetId → 每行编号唯一，与原版 546 全唯一一致）
        const idx = document.createElement('span');
        idx.className = 'sw-bst-idx';
        idx.textContent = String(bestiarySortingId(r.entryId));
        cell.appendChild(idx);
        const canvas = cell.querySelector('.sw-bst-ico') as HTMLCanvasElement;
        // contextlost 韧性(2026-08-14,用户报"resize 后头像全消失"):canvas 2D
        // 内容在 context 丢失后不自动恢复,而本面板只在创建时画一次——preventDefault
        // 允许恢复,restored 时按原参数重画
        // ★SW-RB14d（FX37-F2）：contextlost 同时从登记面除名——preventDefault 只承诺
        //  "可恢复",restore 可能永不来（GPU 压力/上下文配额）;旧刀 painted 恒含 ⇒
        //  sweep 永跳 = 相比旧 getImageData 判空面的自愈力倒退。
        canvas.addEventListener('contextlost', (e) => { e.preventDefault(); this.painted.delete(canvas); });
        canvas.addEventListener('contextrestored', () => {
          this.drawPortrait(canvas, r.npcId, 'grid', r.state > UnlockState.NotKnown);
        });
        // 悬停：音 12 + MouseText(名字/??? )（DrawSelf :143-149 + MouseOver :151-160）
        //  ★BJ507 B3：悬停播动画（UIBestiaryEntryIcon.Update :102-109 网格卡
        //  isPortrait:false → IsHovered 门控）；移开帧冻结（NPC 对象持久,重 hover
        //  从上次帧继续——animT WeakMap 持久）
        cell.addEventListener('mouseenter', () => {
          UISfx.hover();
          this.animAttach(canvas, r.npcId, 'grid', r.state > UnlockState.NotKnown);
        });
        cell.addEventListener('mouseleave', () => this.animDetach(canvas));
        this.bindTip(cell, () => (r.state > UnlockState.NotKnown ? r.name : '???'));
        cell.addEventListener('click', () => this.selectRow(r));   // Click_SelectEntryButton :477-484（无音）
        this.drawPortrait(canvas, r.npcId, 'grid', r.state > UnlockState.NotKnown);
        this.gridEl.appendChild(cell);
      }
    }
  }

  /** 头像 = NPC 表首帧（UnlockableNPCEntryIcon 用整表绘制；DOM 取 frame0 缩放）。
   *  负 netID 变体（史莱姆配色 -1..-10 / 世吞段 -11..-13）无独立贴图文件，
   *  原版共用母体表 → 分别回落 NPC_1 / NPC_14。
   *  ★BJ506 锚点规则 1:1（UnlockableNPCEntryIcon.UpdatePosition :112-123）：
   *    noGravity → Center = 图标盒中心 + Position 偏移；
   *    有重力   → Bottom = 图标盒底中 + (0,-8) + Position 偏移（视觉底=盒底-8）。
   *  绘制中心 = 锚点（DrawNPCDirect 原点 = 碰撞半高，s=1 时视觉底=锚点）；偏移为
   *  原生 px（不再按 size/72 缩放）；溢出交 OverflowHidden 裁剪（原版同，旧钳制拆除）。
   *  底图：网格 = 原生尺寸居中（UIBestiaryEntryButton :40-55 UIImage 无 ScaleToFit）；
   *  详情 = 盒满拉伸（UIBestiaryNPCEntryPortrait :32-40 ScaleToFit）+ bgColor 乘算。
   *  未解锁（NotKnown）：R24 修复——只画 Icon_Locked 锁形图 ×alpha0.15
   *  （UIBestiaryEntryIcon.DrawSelf :52-70 `Color.White*0.15f`），完全不画 NPC 表；
   *  曾画黑影剪影 = 泄露轮廓（brightness0 剪影仍暴露体型/姿态）。
   *  ★BJ507 B3：animFrame = 动画帧（dummy FindFrame 累计次数 t →
   *  bestiaryDummyFrameIdx）——缺省 undefined 落 ov?.frame ?? 0 静态帧（sweep/
   *  contextrestored 补画同静态）。钉帧 NPC（DrawOffset.frame 3 条）调用侧不入
   *  动画集（原版主动画分支 :105-108 else-if 每帧 FindFrame 后覆写回钉帧=静止）。 */
  private drawPortrait(canvas: HTMLCanvasElement, npcId: number, bgMode: 'grid' | 'portrait', unlocked: boolean, animFrame?: number) {
    if (!unlocked) { this.drawLockedIcon(canvas); return; }
    const sheetId = npcId > 0 ? npcId : (npcId >= -10 ? 1 : 14);
    const crimson = this.flow.isCrimson?.() ?? false;
    const bg = bgMode === 'grid'
      ? { image: bestiaryGridBackground(npcId, crimson), color: [255, 255, 255, 255] as number[] }
      : bestiaryPortraitBackground(npcId, crimson);
    const size = canvas.width;
    const boxH = canvas.height;
    const paint = (img: ImageBitmap | HTMLImageElement) => {
      if (!canvas.isConnected) return;  // 上代 refresh 已销毁的画布不画(解码风暴浪费源)
      const ov = BST_DRAW_OFFSET[String(npcId)];
      // ★ frames 查【母体 sheetId】——负 netID 变体（-1..-10 史莱姆配色等）在
      //   vanilla-npcs.json 无独立条目，查 npcId 会缺帧数→整条多帧行当一帧画；
      //   CustomTexture 是单张手绘图（UnlockableNPCEntryIcon :199 原样画、无帧无染色）
      const frames = ov?.customTexture ? 1 : VANILLA_NPCS[String(sheetId)]?.frames ?? 1;
      const iw = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
      const ih = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
      const fh = Math.max(1, Math.floor(ih / frames));   // 碰撞高（未乘 scale）
      // 负 id 变体：netid 表 color/scale/alpha（绿史莱姆 -3=(0,220,40,100) 等）；
      // 正 id：NPC 表自身 color（16 僵尸色等个别非 default）
      const netOv = npcId < 0 ? NETID_OV[String(npcId)] : undefined;
      const colorRGBA = ov?.customTexture ? undefined   // 手绘图不染色（原版 Color.White :199）
        : netOv?.color ?? (npcId > 0 ? VANILLA_NPCS[String(npcId)]?.color : undefined);
      // scale 链（:52-59）：DrawOffset.Scale 覆盖 NPC 自身 → portrait 档 PortraitScale 再覆盖
      let scale = netOv?.scale ?? 1;
      if (ov?.scale != null) scale = ov.scale;
      if (bgMode === 'portrait' && ov?.portraitScale != null) scale = ov.portraitScale;
      const alphaBase = netOv?.alpha ?? 255;
      // ★BJ507 B3：动画帧优先（调用侧已保证钉帧/单帧 NPC 不传）；缺省静态 = 旧形
      const frameIdx = animFrame ?? ov?.frame ?? 0;
      const cx = canvas.getContext('2d');
      if (!cx || !iw) return;
      cx.imageSmoothingEnabled = false;
      // ★不在此 clear（2026-09-03 探针实锤）：此 clearRect 会把 paintWithBg 刚铺的
      //   底图/装饰叠层在 NPC 表晚到重画时整层抹掉——grid/portrait 双档底图恒失。
      //   清底职责归 paintWithBg（合成链起点）；无底图路径在调用侧显式清。
      // ★BJ506 锚点：UpdatePosition :112-123（见函数头注）——偏移原生 px 直接加锚点
      const ox = bgMode === 'portrait' && ov?.portraitX != null ? ov.portraitX : (ov?.position?.[0] ?? 0);
      const oy = bgMode === 'portrait' && ov?.portraitY != null ? ov.portraitY : (ov?.position?.[1] ?? 0);
      const noGrav = !!VANILLA_NPCS[String(npcId)]?.noGravity;
      const w = iw * scale, h = fh * scale;
      const centerX = size / 2 + ox;
      const centerY = noGrav ? boxH / 2 + oy : boxH - 8 - fh / 2 + oy;
      cx.globalAlpha = alphaBase / 255;                // 负 id alpha 变体（-5 黑史莱姆 120）
      const composed = colorRGBA && (colorRGBA[3] ?? 255) > 0
        ? bstTintedFrame(img, sheetId, npcId, fh, colorRGBA, frameIdx)
        : null;
      if (ov?.rotation) {
        cx.save();
        cx.translate(centerX, centerY);
        cx.rotate(ov.rotation);
        if (composed) cx.drawImage(composed, -w / 2, -h / 2, w, h);
        else cx.drawImage(img, 0, frameIdx * fh, iw, fh, -w / 2, -h / 2, w, h);
        cx.restore();
      } else if (composed) cx.drawImage(composed, centerX - w / 2, centerY - h / 2, w, h);   // base+染色离屏合成
      else cx.drawImage(img, 0, frameIdx * fh, iw, fh, centerX - w / 2, centerY - h / 2, w, h);
      cx.globalAlpha = 1;
      // ★SW-RB14d（FX37-F2）：丢_context_期（contextlost 已发、restore 未至）绘制
      //  是静默 no-op,登记=把空白格标"已画"锁死 sweep;守卫后 sweep 持续重试,
      //  contextrestored 重画成功（context 已活）再登记。isContextLost 老引擎缺省=未丢。
      if (!(cx.isContextLost && cx.isContextLost())) this.painted.add(canvas);   // 落笔登记(FX37 sweep 只补"从未画上"的画布)
    };
    const atlas = this.flow.atlas ?? null;
    // 装饰叠层（仅详情档；NPCPortraitInfoElement.cs:73-84 偏好命中 flag2 短路不收集）
    const overlays = bgMode === 'portrait' && !bestiaryPortraitPrefHit(npcId, crimson)
      ? bestiaryPortraitOverlays(npcId)
      : [];
    // 无声明色回退：Color.Lerp(Color.White, portraitColor, 0.5f)（UIBestiaryNPCEntryPortrait :51）
    const ovFallback = [
      Math.round((255 + bg.color[0]) / 2),
      Math.round((255 + bg.color[1]) / 2),
      Math.round((255 + bg.color[2]) / 2),
      Math.round((255 + (bg.color[3] ?? 255)) / 2),
    ];
    // 统一走 bstLoadSheet 缓存(同表并发只取一次/结果回写/失败负终结;
    // 此前 loadBg 每格每次 refresh new Image 且不回写=滚轮风暴解码源)
    // ★BJ506 底图几何：grid = 原生尺寸居中（UIImage 缺省，可被 68² 内盒 OverflowHidden
    //   裁剪，115×65 恰溢出水平——原版同）；portrait = 盒满拉伸（ScaleToFit，色乘算
    //   保留），叠层与底图同盒（:43-54）
    const paintWithBg = (bgImg: ImageBitmap | HTMLImageElement | null, ovs: HTMLCanvasElement[] = []) => {
      const cx = canvas.getContext('2d');
      if (!cx) return;
      cx.imageSmoothingEnabled = false;
      cx.clearRect(0, 0, canvas.width, canvas.height);
      if (bgMode === 'grid') {
        if (bgImg) cx.drawImage(bgImg, (size - bgImg.width) / 2, (boxH - bgImg.height) / 2);
      } else {
        if (bgImg) {
          cx.drawImage(bgImg, 0, 0, size, boxH);   // ScaleToFit = 盒满拉伸（可异形）
          const [r, g, b, a] = bg.color;
          if (r !== 255 || g !== 255 || b !== 255) {
            cx.globalCompositeOperation = 'multiply';
            cx.fillStyle = `rgba(${r},${g},${b},${(a ?? 255) / 255})`;
            cx.fillRect(0, 0, size, boxH);
            cx.globalCompositeOperation = 'source-over';
          }
        }
      }
      // 叠层：与底图同一目标盒（原版同容器 ScaleToFit 拉伸——对位关系 1:1），
      // 色为预着色成品（bstTintedOverlay，声明色 ?? Lerp 回退）
      for (const o of ovs) cx.drawImage(o, 0, 0, size, boxH);
      // ★SW-RB14d（FX37-F1）：此处【不再】登记 painted——旧刀 bg/叠层落地即登记,
      //  若随后 NPC 表 cb(null)（404/负缓存 TTL 终结）成"半画格":底图在、NPC 缺,
      //  painted 恒含 ⇒ sweep 永跳,只能翻页/筛选重建自救。登记权移交终端落笔点
      //  paint()/drawLockedIcon;全失败格保持未登记 = sweep 重试可愈（负缓存 TTL 10s）。
    };
    // 贴图源：CustomTexturePath 手绘图（Images/UI/Bestiary/NPCs/* 扁平化 basename）
    // 替换母体表（UnlockableNPCEntryIcon :74-81/:199——原样画、无帧无染色）
    const ovTex = BST_DRAW_OFFSET[String(npcId)]?.customTexture;
    const texPath = ovTex ? `vanilla/${ovTex}.png` : `vanilla/NPC_${sheetId}.png`;
    // 叠层图装载（bstLoadSheet 同缓存链；全数到齐或负终结才开画,计数器收敛）
    const loadOverlays = (done: (ovs: HTMLCanvasElement[]) => void) => {
      if (!overlays.length) { done([]); return; }
      const out: HTMLCanvasElement[] = [];
      let left = overlays.length;
      for (const o of overlays) {
        bstLoadSheet(atlas, `vanilla/${o.overlay}.png`, (img) => {
          if (img) out.push(bstTintedOverlay(o.overlay, img, o.color ?? ovFallback));
          if (--left === 0) done(out);
        });
      }
    };
    if (bg.image || overlays.length) {
      const startPaint = (bgImg: ImageBitmap | HTMLImageElement | null) => {
        if (!canvas.isConnected) return;
        loadOverlays((ovs) => {
          if (!canvas.isConnected) return;
          paintWithBg(bgImg, ovs);
          // NPC 表到位后叠画（晚到重绘底图/叠层再叠;统一走缓存=同表并发只解码一次）
          bstLoadSheet(atlas, texPath, (img) => {
            if (!img || !canvas.isConnected) return;
            paintWithBg(bgImg, ovs); paint(img);
          });
        });
      };
      if (bg.image) {
        bstLoadSheet(atlas, `vanilla/${bg.image}.png`, (bgImg) => {
          if (!canvas.isConnected) return;
          // 缺底图仍画叠层+NPC（红队R3⑦:原版底图 asset 可缺——UIBestiaryNPCEntry
          // Portrait 构造 :26-35 `if (portraitBackgroundAsset != null)` 才挂底图,
          // 叠层/NPC icon 不依赖底图;曾 !bgImg 早退 = 404 整格空白且 NPC 不画）
          startPaint(bgImg);
        });
      } else {
        startPaint(null);   // 原版底图可缺（UIImage 仅 portraitBackgroundAsset!=null 才挂）而叠层照画
      }
      return;
    }
    bstLoadSheet(atlas, texPath, (img) => {
      if (!img) return;
      const cx = canvas.getContext('2d');
      if (cx) { cx.imageSmoothingEnabled = false; cx.clearRect(0, 0, canvas.width, canvas.height); }
      paint(img);
    });
  }

  // ── ★BJ507 B3：图鉴 dummy 动画引擎（UnlockableNPCEntryIcon 1:1）────────────
  //  原版形态（UnlockableNPCEntryIcon.cs + UIBestiaryEntryIcon.cs 亲读定谳）：
  //  • 构造 = 独立 NPC dummy（IsABestiaryIconDummy=true，ai 全 0）；首次 Update
  //    SimulateFirstHover（:180-191）无条件 FindFrame ×1 → 静态帧 = F(1)（全折叠族 ≡ 帧 0,
  //    与旧静态帧 0 形一致=零回归）。
  //  • 每帧主动画门（:102-109）：`!Frame偏移 && (IsPortrait || IsHovered)` → FindFrame。
  //    ★详情页 Portrait（isPortrait:true）= IsPortrait 恒真 → **动画常驻播放**（打开
  //    详情页即播,非悬停门控——登记定谳与任务书"悬停时播放"假设的差异）；网格卡
  //    （isPortrait:false）= 悬停才播、移开帧冻结（NPC 对象持久 → 重 hover 从上次帧继续）。
  //  • FindFrame 推进速率 = UI Update 每主循环帧（60Hz）——本仓 rAF 走 60Hz 门闸
  //    步进（tickClockSteps 判例：120Hz 屏不加速;长停滞追赶钳 3 步）。
  //  • 钉帧 NPC（DrawOffset.Frame 3 条：4/177/266）走 :105-108 else-if 支 = 每帧
  //    FindFrame 后覆写回钉帧 → 净静止,不入动画集;CustomTexture 单张手绘同静。
  /** 该 NPC 是否可动画（多帧 && 非钉帧 && 非手绘图——钉帧在原版每帧被覆写=净静止） */
  private canAnimateNpc(npcId: number): boolean {
    const ov = BST_DRAW_OFFSET[String(npcId)];
    if (ov?.frame != null || ov?.customTexture) return false;
    const sheetId = npcId > 0 ? npcId : (npcId >= -10 ? 1 : 14);
    return (VANILLA_NPCS[String(sheetId)]?.frames ?? 1) > 1;
  }
  /** FindFrame 累计次数（WeakMap 持久 = 网格卡重 hover 从上次帧继续,原版 NPC
   *  对象持久语义 :103-107）——初值 1 = SimulateFirstHover 的首帧 */
  private animT = new WeakMap<HTMLCanvasElement, number>();
  /** 本帧需 FindFrame 的画布集（Portrait 恒在 = IsPortrait;网格卡 hover 中 = IsHovered） */
  private animLive = new Set<HTMLCanvasElement>();
  private animMeta = new WeakMap<HTMLCanvasElement, { npcId: number; mode: 'grid' | 'portrait'; unlocked: boolean }>();
  private animRaf = 0;
  private animLastTs = 0;
  private animAcc = 0;
  /** 注册进动画集（详情 Portrait 常驻 / 网格卡 mouseenter）。帧冻结复挂 = t 不重置 */
  private animAttach(canvas: HTMLCanvasElement, npcId: number, mode: 'grid' | 'portrait', unlocked: boolean): void {
    if (!unlocked || !this.canAnimateNpc(npcId)) return;
    if (!this.animT.has(canvas)) this.animT.set(canvas, 1);   // SimulateFirstHover 首帧
    this.animMeta.set(canvas, { npcId, mode, unlocked });
    this.animLive.add(canvas);
    this.ensureAnimLoop();
  }
  /** 移出动画集（网格卡 mouseleave——帧冻结在离开时值,画布不清 = 原版 DrawSelf 恒画冻结帧） */
  private animDetach(canvas: HTMLCanvasElement): void {
    this.animLive.delete(canvas);
  }
  private ensureAnimLoop(): void {
    if (this.animRaf) return;
    this.animLastTs = 0;
    this.animAcc = 0;
    const step = (ts: number) => {
      this.animRaf = 0;
      if (!this.panel.isConnected) { this.animLive.clear(); return; }
      if (!this.animLastTs) this.animLastTs = ts;
      this.animAcc += ts - this.animLastTs;
      this.animLastTs = ts;
      let steps = Math.floor(this.animAcc / 16.6667);   // 60Hz 门闸（原版 UI Update = 主循环帧）
      if (steps > 0) this.animAcc -= steps * 16.6667;
      if (steps > 3) steps = 3;   // 长停滞追赶钳 3（tickClockSteps 判例同款）
      if (steps > 0) {
        for (const canvas of this.animLive) {
          if (!canvas.isConnected) { this.animLive.delete(canvas); continue; }
          const meta = this.animMeta.get(canvas);
          if (!meta) { this.animLive.delete(canvas); continue; }
          const t = (this.animT.get(canvas) ?? 1) + steps;
          this.animT.set(canvas, t);
          // 帧参数（bestiaryDummyFrameIdx 折叠域）：aiStyle/vx/wet 全自 DrawOffset+NPC 表
          const ov = BST_DRAW_OFFSET[String(meta.npcId)];
          const sheetId = meta.npcId > 0 ? meta.npcId : (meta.npcId >= -10 ? 1 : 14);
          const frames = VANILLA_NPCS[String(sheetId)]?.frames ?? 1;
          const ai = meta.npcId > 0
            ? VANILLA_NPCS[String(meta.npcId)]?.aiStyle ?? VANILLA_NPCS[String(sheetId)]?.aiStyle ?? 0
            : VANILLA_NPCS[String(sheetId)]?.aiStyle ?? 0;
          const vx = ov?.velocity ?? 0;   // direction 只改 vx 符号（帧序折叠 |vx|）
          const wet = ov?.wet ?? false;
          const f = bestiaryDummyFrameIdx(meta.npcId, ai, t, vx, frames, wet);
          this.drawPortrait(canvas, meta.npcId, meta.mode, meta.unlocked, Math.min(frames - 1, f));
        }
      }
      if (this.animLive.size > 0) this.animRaf = requestAnimationFrame(step);
    };
    this.animRaf = requestAnimationFrame(step);
  }

  /** 未解锁占位：Icon_Locked 锁形图居中 ×alpha0.15（UIBestiaryEntryIcon.DrawSelf
   *  :64-69 `spriteBatch.Draw(_notUnlockedTexture, dimensions.Center(), null,
   *  Color.White * 0.15f, ...)` 1:1——零轮廓泄露；原生尺寸 24×34 scale=1）。
   *  ★FX37(2026-09-11):贴图改走 bstLoadSheet 共享缓存——旧版每格 new Image+重发
   *  src,一页 81 锁格=81 个 Image 元素+81 次 decode 请求,翻页/筛选/选中每拍重发
   *  (fresh:details 段 GC 144ms 的主力);缓存命中=同步直画(原版 _notUnlockedTexture
   *  也是预载一次逐帧重画,语义同)。失败走 bstSheetFailed 负缓存自愈 */
  private drawLockedIcon(canvas: HTMLCanvasElement): void {
    const cx = canvas.getContext('2d');
    if (!cx) return;
    cx.imageSmoothingEnabled = false;
    cx.clearRect(0, 0, canvas.width, canvas.height);
    const size = canvas.width;
    const boxH = canvas.height;
    bstLoadSheet(this.flow.atlas ?? null, BST_LOCKED_ICON_SHEET, (img) => {
      if (!img || !canvas.isConnected) return;
      // 原版 scale=1 原尺寸画（锁图 24×34）——超画布才等比缩
      const iw = (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
      const ih = (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
      const s = Math.min(1, size / iw, boxH / ih);
      const w = iw * s, h = ih * s;
      cx.globalAlpha = 0.15;
      cx.drawImage(img, (size - w) / 2, (boxH - h) / 2, w, h);
      cx.globalAlpha = 1;
      if (!(cx.isContextLost && cx.isContextLost())) this.painted.add(canvas);   // 落笔登记（★SW-RB14d F2 丢_context_守卫,同 paint 注）
    });
  }

  /** 掉落行/击杀旗物品小图标（atlas.vicon 懒载未就绪时仅文字） */
  private itemIcon(itemId: number, size = 22): HTMLCanvasElement | null {
    const atlas = this.flow.atlas ?? null;
    if (!atlas) return null;
    const ar = atlas.vicon(itemId);
    if (!ar) return null;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    const s = Math.min(size / ar.sw, size / ar.sh);
    const w = ar.sw * s, h = ar.sh * s;
    cx.drawImage(ar.img, ar.sx, ar.sy, ar.sw, ar.sh, (size - w) / 2, (size - h) / 2, w, h);
    return c;
  }

  /** 底栏（FillProgressBottomBar :159-181 + UpdateBestiaryContents :444-447）：
   *  文本 = PrettifyPercentDisplay(GetProgressPercent,"P2") 套 PercentCollected；
   *  条填充 = FillPercent×宽（填充 (51,137,255)/底 (35,43,81) 在 CSS/变量层） */
  private updateProgress() {
    const pct = this.progressPercent();
    this.pctEl.textContent = Lang.text('BestiaryInfo.PercentCollected').replace('{Percent}', prettifyPercentDisplay(pct));
    this.barFillEl.style.width = `${Math.min(1, Math.max(0, pct)) * 100}%`;
  }

  /** 右侧详情栏（UIBestiaryEntryInfoPage 1:1）：未选 = 空面板（FillInfoForEntry(null)
   *  :111-119 仅 _list.Clear()）；选中 = 类目序 Nameplate→Portrait→FlavorText→Stats→
   *  ItemsFromCatchingNPC(1457 恒空)→ItemsFromDrops→Misc，每类目后 Separator、末线移除
   *  （AddInfoToList :128-163）；类目内 IBestiaryPrioritizedElement 降序（:142 稳定）。
   *  解锁门：NotKnown 名"???"；≥Stats 风味/属性真值；≥DropsNoRates 掉落行；
   *  ≥DropsWithRates 真掉率（NPCStatsReportInfoElement :60/:125-129、ItemDrop :20-28） */
  private renderInfo() {
    const r = this.selected;
    this.infoEl.replaceChildren();
    this.infoDraw = null;
    if (!r) return;   // FillInfoForEntry(null) = 空面板（原版无占位提示）
    const st = r.state;
    const crimson = this.flow.isCrimson?.() ?? false;
    const list: HTMLElement[] = [];
    const mk = (cls: string): HTMLElement => {
      const d = document.createElement('div');
      d.className = cls;
      list.push(d);
      return d;
    };
    // ── Nameplate（NamePlateInfoElement :19-31）：NotKnown = "???"，24 高行居中 ──
    mk('sw-bst-nameplate').textContent = st > UnlockState.NotKnown ? r.name : '???';
    // ── Portrait（NPCPortraitInfoElement :21-97）：193×112；解锁才铺底图/叠层/星 ──
    {
      const wrapEl = mk('sw-bst-portrait');
      wrapEl.innerHTML = `
        <div class="sw-bst-portraitin"><div class="sw-bst-portraitbox">
          <canvas width="189" height="108"></canvas>
        </div>
        <img class="sw-bst-pfront" alt="" src="${UI_BASE}UI_Bestiary_Portrait_Front.png" /></div>`;
      const canvas = wrapEl.querySelector('canvas') as HTMLCanvasElement;
      canvas.addEventListener('contextlost', (e) => { e.preventDefault(); this.painted.delete(canvas); });
      canvas.addEventListener('contextrestored', () => {
        this.drawPortrait(canvas, r.npcId, 'portrait', st > UnlockState.NotKnown);
      });
      this.infoDraw = { canvas, npcId: r.npcId, st };
      this.drawPortrait(canvas, r.npcId, 'portrait', st > UnlockState.NotKnown);
      // ★BJ507 B3：详情 Portrait = IsPortrait 恒真（UIBestiaryEntryIcon.Update :102-109
      //  `IsPortrait || IsHovered`）→ 动画常驻播放（非悬停门控）；切换选中时旧画布
      //  断连由循环自清（!isConnected 出集）
      this.animAttach(canvas, r.npcId, 'portrait', st > UnlockState.NotKnown);
      if (st > UnlockState.NotKnown) {
        // 五角星（CreateStarsContainer :108-148）：Stat_Panel 56² @(10,6)，
        // 星 14² x=1+10i，亮 = i < NpcBestiaryRarityStars
        const stars = wrapEl.querySelector('.sw-bst-portraitin') as HTMLElement;
        const sp = document.createElement('div');
        sp.className = 'sw-bst-stars';
        const v = bestiaryRarityStars(r.npcId);
        for (let i = 0; i < 5; i++) {
          const img = document.createElement('img');
          img.alt = '';
          img.style.left = `${1 + 10 * i}px`;
          img.style.top = '1px';
          img.src = `${UI_BASE}UI_Bestiary_Icon_Rank_${i < v ? 'Light' : 'Dim'}.png`;
          sp.appendChild(img);
        }
        stars.appendChild(sp);
      }
    }
    // ── FlavorText（FlavorTextBestiaryInfoElement :16-33）：≥Stats，Stat_Panel 块 ──
    if (st >= UnlockState.Stats) {
      const flavor = bestiaryFlavorText(r.npcId, crimson);
      if (flavor) mk('sw-bst-spblock sw-bst-flavor').textContent = flavor;
    }
    // ── Stats（NPCStatsReportInfoElement :58-260 + NPCKillCounterInfoElement）────
    if (st >= UnlockState.PortraitOnly) {
      // 击杀计数（kills ≥ 1 才出，:27-30；无解锁门——kills>0 蕴含已解锁）
      if (r.kills >= 1) {
        const kEl = mk('sw-bst-kills');
        const icon = this.itemIcon(321, 22);   // item 321 旗图（:74-80）
        if (icon) kEl.appendChild(icon);
        const sp = document.createElement('span');
        sp.textContent = String(r.kills);
        kEl.appendChild(sp);
        this.bindTip(kEl, () => Lang.text('BestiaryInfo.Slain'));   // ShowDescription :91-97
      }
      // 属性卡（NotKnown 整卡无；<Stats 值全 "?" :125-129）
      const v = VANILLA_NPCS[String(r.npcId)];
      if (v) {
        const hide = st < UnlockState.Stats;
        const coins = npcValueOf(r.npcId);
        const sEl = mk('sw-bst-stats' + (coins > 0 && !hide ? ' hascoins' : ''));
        const coinTiers = hide ? null : this.coinTiers(coins);
        if (coinTiers) {
          const sepEl = document.createElement('div');   // 金币分隔线（:168-176）
          sepEl.className = 'sw-bst-sep';
          sepEl.style.position = 'absolute';
          sepEl.style.left = '0';
          sepEl.style.right = '0';
          sepEl.style.top = '70px';
          sEl.appendChild(sepEl);
          const coinDefs: Array<[string, string, number, number]> = [
            ['--bst-coinp', 'UI_Bestiary_Stat_Platinum', 3, 0],
            ['--bst-coing', 'UI_Bestiary_Stat_Gold', 52, 0],
            ['--bst-coins', 'UI_Bestiary_Stat_Silver', 100, 1],
            ['--bst-coin1', 'UI_Bestiary_Stat_Copper', 149, 1],
          ];
          coinDefs.forEach(([vn, file, x], ci) => {
            if (coinTiers[ci] === '-') return;   // 空档不画图标（:201-216）
            const cEl = document.createElement('div');
            cEl.className = 'sw-bst-statcoin';
            cEl.style.left = `${x}px`;
            cEl.style.background = `var(${vn}) center/47px 31px no-repeat`;
            const sp = document.createElement('span');
            sp.textContent = coinTiers[ci];
            cEl.appendChild(sp);
            sEl.appendChild(cEl);
            void file;
          });
        }
        const addStat = (cls: string, text: string, tipKey: string) => {
          const s = document.createElement('div');
          s.className = `sw-bst-stat ${cls}`;
          const sp = document.createElement('span');
          sp.textContent = text;
          s.appendChild(sp);
          this.bindTip(s, () => Lang.text(tipKey));   // ShowStats_* :262-292
          sEl.appendChild(s);
        };
        // 击退分档（:124 KnockbackHigh>0.8 / Medium>0.4 / None≤0 / else Low）
        const kbText = hide ? '???'
          : v.knockBackResist > 0.8 ? Lang.text('BestiaryInfo.KnockbackHigh')
            : v.knockBackResist > 0.4 ? Lang.text('BestiaryInfo.KnockbackMedium')
              : !(v.knockBackResist > 0) ? Lang.text('BestiaryInfo.KnockbackNone')
                : Lang.text('BestiaryInfo.KnockbackLow');
        addStat('sw-bst-stat-hp', hide ? '???' : String(v.lifeMax), 'BestiaryInfo.Life');
        addStat('sw-bst-stat-kb', kbText, 'BestiaryInfo.Knockback');
        addStat('sw-bst-stat-atk', hide ? '???' : String(v.damage), 'BestiaryInfo.Attack');
        addStat('sw-bst-stat-def', hide ? '???' : String(v.defense), 'BestiaryInfo.Defense');
      }
    }
    // ── ItemsFromDrops（ItemDropBestiaryInfoElement :17-29 + UIBestiaryInfoItemLine）──
    //  行序 = 规则注册序；世界难度门（专家/大师行 CanShowItemDropInUI）；
    //  ≥DropsNoRates 才出（:20-22）；≥DropsWithRates 真掉率，否则 "???"（:95-99）
    if (st >= UnlockState.DropsNoRates) {
      const difficulty = this.flow.isMaster?.() ? 2 : this.flow.isExpert?.() ? 1 : 0;
      const drops = flattenDropsForNpc(r.npcId, difficulty);
      for (const d of drops) {
        const line = mk('sw-bst-drop');
        const icon = this.itemIcon(d.item, 24);
        if (icon) line.appendChild(icon);
        const rt = document.createElement('span');
        rt.className = 'rt';
        const rangeTxt = d.min !== d.max ? ` (${d.min}-${d.max})` : d.min > 1 ? ` (${d.min})` : '';
        // GetDropInfo 合成式（UIBestiaryInfoItemLine.cs:83-86 stackRange 非空才前拼
        // `stackRange + " " + droprate`；:95-99 ??? 形清 stackRange → 裸 "???"）。
        // ★BJ653：旧式恒 `rangeTxt + " " + rate` = 无段行带前导空格、??? 形带段前缀,
        //  两处均偏离原版合成。前导空格右对齐下不可见=视觉无差;??? 形带段=真差。
        const rateTxt = st >= UnlockState.DropsWithRates && d.chance !== null ? dropRateText(d.chance) : null;
        rt.textContent = rateTxt === null ? '???' : rangeTxt ? `${rangeTxt} ${rateTxt}` : rateTxt;
        line.appendChild(rt);
        // ★BJ507 B2：悬停 = 全量 item tooltip（原版 DrawMouseOver :130-134：
        //  Main.HoverItem = _infoDisplayItem（SetDefaults(itemId) fresh item）+
        //  MouseText("",0,0)+mouseText=true → item tooltip 全载荷管线）——
        //  本仓走 flow 桥 → UI.showFloatingItemTooltip（buildTooltipHtml BJ407 单源,
        //  非槽位锚点 slot 合成 stack1 无词缀 = fresh item 同相）。
        //  notes = 掉落条件描述（SetBestiaryNotesOnItemCache :136-151：每条件
        //  GetConditionDescription 一行 join——本仓 cond/tag 两值域各一行；
        //  ★键名勘正:产物类别 = Bestiary_ItemDropConditions（两层压一层）,旧拼
        //  Bestiary.ItemDropConditions 永不命中 = 文案面死键）。空串条件
        //  （NotExpert 等）不落行 = 原版同相（IsNullOrWhiteSpace 过滤 :141-147）。
        //  MouseOver 音 12（:127-129）+ 金框 = CSS :hover 既有（BJ506）。
        //  本行恒 st≥DropsNoRates = icon+率形 → _hideMouseOver 支（<3 锁形行）不可达。
        const notes: string[] = [];
        const condTxt = d.cond ? dropCondText(d.cond) : '';
        if (condTxt) notes.push(condTxt);
        const tagTxt = d.tag ? dropTagText(d.tag) : '';
        if (tagTxt) notes.push(tagTxt);
        line.addEventListener('mouseenter', () => {
          UISfx.hover();   // MouseOver :127-129（SoundEngine.PlaySound(12)）
          this.flow.showItemTooltip?.(d.item, line, notes.length ? notes : undefined);
        });
        line.addEventListener('mouseleave', () => this.flow.hideItemTooltip?.());
      }
    }
    // ── Misc（SpawnConditionBestiaryInfoElement 族 :42-77）：注册序 Stat_Panel 行 ──
    if (st > UnlockState.NotKnown) {
      for (const c of bestiarySpawnConditions(r.npcId)) {
        const cond = mk('sw-bst-cond');
        cond.appendChild(this.filterIconImg(c.priority));
        const sp = document.createElement('span');
        sp.textContent = c.label;
        cond.appendChild(sp);
        this.bindTip(cond, () => c.label);
      }
    }
    // 每类目后分隔线（:151-160），末类目线移除（:162 _list.Remove(item)）
    const frag = document.createDocumentFragment();
    let pendingSep = false;
    for (const el of list) {
      if (pendingSep) frag.appendChild(this.mkSep());
      frag.appendChild(el);
      pendingSep = true;
    }
    this.infoEl.appendChild(frag);
  }

  private mkSep(): HTMLElement {
    const sep = document.createElement('div');
    sep.className = 'sw-bst-sep';
    return sep;
  }

  /** 金币四档（NPCStatsReportInfoElement :100-120）：铜计值 → 铂/金/银/铜，
   *  空档 "-"（<1 即空，图标不画）；值钳 999/99/99/99 */
  private coinTiers(value: number): string[] {
    const v = Math.floor(value);
    const clampN = (n: number, max: number) => String(Math.min(n, max));
    const plat = v / 1_000_000 >= 1 ? clampN(Math.floor(v / 1_000_000), 999) : '-';
    const gold = v / 10_000 >= 1 ? clampN(Math.floor((v % 1_000_000) / 10_000), 99) : '-';
    const silver = v / 100 >= 1 ? clampN(Math.floor((v % 10_000) / 100), 99) : '-';
    const copper = v >= 1 ? clampN(v % 100, 99) : '-';
    return [plat, gold, silver, copper];
  }

  /** 选中条目（Click_SelectEntryButton → SelectEntryButton，UIBestiaryTest.cs:486-495：
   *  DeselectEntryButton + _infoSpace.FillInfoForEntry——**只重渲详情栏,网格不动**）。
   *  ★FX37(2026-09-11):曾走 refresh() 全量重建——每选一次=81 格画布+~400 节点+
   *  ~330 监听器整体重造(probe ΔNodes 4992/ΔListeners 3924 每 12 击),原版无此面。
   *  ★BJ506：原版无选中持久视觉（_selectedEntryButton 写后不读）——旧 .sel 外描
   *  自创面拆除，选中只填详情栏。 */
  private selectRow(r: BestiaryRow): void {
    // ★SW-RB14d（FX37-F3）：行按 creditId 从 tracker 现取——闭包行 r 是上次
    //  refreshNow 的快照,面板开着时击杀/解锁推进后点击,详情栏会显示旧 kills/
    //  NotKnown 态（原版 FillInfoForEntry 的信息元素 Update 每帧重读 tracker）。
    //  重建网格的刷新路径本就传新行,现取对它们等价。
    //  ★BJ506：selectSeq 推进——排队中 refreshNow 的清选中序词闸据此放行本选中。
    const fresh = bestiaryRows(this.flow.getTracker()).find((w) => w.entry.creditId === r.entry.creditId) ?? r;
    this.selectSeq++;
    this.selected = fresh;
    this.renderInfo();
    this.scheduleBlankSweep();
  }

  close() {
    window.removeEventListener('keydown', this.escHandler, true);
    this.closePops();
    this.hideTip();
    // ★BJ507：动画 rAF 停摆 + 掉落行 tooltip 撤泡（面板关后 tooltip 残留防）
    if (this.animRaf) { cancelAnimationFrame(this.animRaf); this.animRaf = 0; }
    this.animLive.clear();
    this.flow.hideItemTooltip?.();
    if (this.roTimer) { clearTimeout(this.roTimer); this.roTimer = 0; }
    this.ro?.disconnect();
    this.ro = null;
    this.selected = null;
    this.panel.remove();
    this.flow.onBack();
  }
}
