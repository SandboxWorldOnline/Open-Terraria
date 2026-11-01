// ★SW-BJ81 2026-09-14 —— 道具搜索取件规则纯函数（用户规格②⑤⑥）。
// 本面 = FX39 停车坪自创 QoL（main.ts openInGamePause onItemSearch 入口），原版
// 无对应物 = Web 便利档——规格以用户令为准，1457 反编译仅作交互惯例参照。
//
// 规格⑤：点搜出项 = 道具上光标，复用仓内既有合成抓取路径（UI.grantCraftToCursor
// → UI.heldStack 光标持物，markCursorGlow SM2 MouseItem 辉光同款反馈）；落点由
// 玩家放置决定——点物品栏槽 = 放入（SlotActions 路由面），点世界 = 左键使用/放置
// （SW-AZ1 光标镜像槽 58 支）/ 右键丢出（DropSelectedItem 臂），与合成抓取的
// 放置语义全同。
// 规格②：单次取件量恒 1（旧实现可堆叠给 min(maxStack,99) 整组 = 废止）。
// 规格⑥：长按持续 +1——仓内合成面无按住连加先例（证据：craftingGrid.ts/
// modernCrafting.ts 零 setInterval/连抓实现，grep 定谳 2026-09-14），取用户规格
// 档 ~8/s；上限 = 该物品 maxStack（并入钳制走 grantCraftToCursor 既有算式）。
import { canMergeStack } from './SlotActions';
import { ITEM_DEFS, vanillaItemCreateTile, PLACE_CLONE_SUPERSEDED, VANILLA_VID_NORMALIZE } from '../data/items';
import { ITEM_NAME_EN_BY_ID } from '../i18n/idNames.generated';
import { isFunctionalTileItem } from '../world/evolution/PlantRules';

/** 长按连取节奏：125ms/件 ≈ 8 件/s（用户规格档；合成面无先例可抄，见头注） */
export const ITEMSEARCH_GRAB_INTERVAL_MS = 125;

/** 单次取件量（规格②：恒 1） */
export const ITEMSEARCH_GRAB_COUNT = 1;

/** 光标持物形（与 UI.heldStack 同构的只读面） */
export interface CursorStackLike {
  id: number;
  stack: number;
  prefix?: number;
  placeStyle?: number;
  favorited?: boolean;
}

/** 点击搜出项 → 取件计划：
 *  · 光标空 / 同物可并（canMergeStack，★SW-AY1 R1 谓词单源）→ `'cursor'`
 *    （执行器 = UI.grantCraftToCursor：空光标挂 1 / 可并位 +1 / 满叠余量由调用方
 *    落地——合成成品上光标同款）；
 *  · 光标被异型占据 → `'inventory'` 兜底入包。直接覆盖光标 = 静默丢玩家持物
 *    （词缀/收藏/实例样式随光标流转），禁。 */
export function searchGrabPlan(
  held: CursorStackLike | null,
  id: number,
): { to: 'cursor' | 'inventory'; stack: number } {
  const mergeable = !held || canMergeStack(held, { id });
  return mergeable
    ? { to: 'cursor', stack: ITEMSEARCH_GRAB_COUNT }
    : { to: 'inventory', stack: ITEMSEARCH_GRAB_COUNT };
}

// ============================================================================
// ★SW-BJ154 2026-09-19 —— 搜索池构建纯函数（自 UI.ts openItemSearchPanel 摘出单源）。
// 用户实报「道具搜索里的道具不全——史莱姆鞍（2430）没看到」定谳：
//   · 遍历源【无缺】：ITEM_DEFS 6856 def，vid 域 6177 全覆盖零缺席（探针实测
//     missing=0），2430 走桥接批 items.ts:881 注册，池序 464 在池；
//   · 过滤器【不滤 2430】：死条目滤只打「createTile 被 place_v 面覆盖的惰性
//     vi_ 占位」（2040 vid，其方块语义由 place_v 件承载），2430 无 tile 不涉；
//   · 真凶 = 呈现层两刀：①渲染 80 条封顶（entries 序 464 > 80，浏览式打开
//     永远看不到）；②匹配串无族词桥——官方 zh 名「粘鞍」与用户语汇「史莱姆」
//     不通（搜"史莱姆"命中 68 件 Slime 族，唯鞍缺席），官方 tooltip「召唤可
//     骑乘的史莱姆坐骑」含族词但不进匹配串。
// 修法：①匹配串扩桥 = 官方 tooltip 文本（tipOf 注入，零手写映射）；
//   ②渲染面全量虚拟滚动（UI.ts，80 封顶废止——本函数只产出全量池）。
// ============================================================================

/** 搜索池条目（vid=null = 非 vi_ 条目：legacy/place_v/SW 自有件） */
export interface ItemSearchPoolEntry {
  /** ITEM_DEFS 下标（取件/图标同源） */
  id: number;
  key: string;
  /** 原版 vid（vi_ 前缀提取；非 vi_ 条目 null） */
  vid: number | null;
  /** 显示名（nameOf 产出；缺名回落 key） */
  name: string;
  /** 小写匹配串 = 名 + key + vid + 英文原名 + 官方 tooltip 桥 */
  lc: string;
}

/**
 * 全量搜索池（一次性构建）。
 * @param io.nameOf 物品显示名（生产端 = Lang.itemNameByKey；缺名调用方回落 key）
 * @param io.tipOf  官方 tooltip 文本桥（生产端 = ItemTooltip.<Pascal> l10n；缺省不桥）
 *   ——★BJ154 族词桥：官方 zh 名不带族词的件（粘鞍/史莱姆坐骑）靠 tooltip 语汇
 *   入搜，零手写别名表。
 */
export function buildItemSearchPool(io: {
  nameOf: (key: string) => string;
  tipOf?: (vid: number) => string;
}): ItemSearchPoolEntry[] {
  const coveredSheets = new Set<number>();
  // ★方案 A（BJ264）：ITEM_DEFS 重排后稀疏——for..of 对洞产出 undefined，须 !d 跳过
  for (const d of ITEM_DEFS) {
    if (!d) continue;
    const mp = /^place_v_(\d+)_/.exec(d.key);
    if (mp) coveredSheets.add(Number(mp[1]));
  }
  // ★同 vid 去重（首个 def 胜出,与 ITEM_INTERNAL_OF_STABLE 归一口径一致）：
  //   桥接批 snake 键 + vanilla.json 循环 Pascal 键曾双注册 1246 组（雷管双行
  //   根因,2026-08-21）——存量双条目不删（ITEM_DEFS id=下标不可平移）,显示层滤掉
  // ★place_v 覆盖去重（2026-08-25 用户报"两个阿比盖尔的花/苔藓双行"）:place_v_*
  //   族（可放置）与惰性 vi_ 注册（无 tile 字段=不可放置死条目)同 tile 并存——
  //   vi_ 件的 createTile tile 已被 place_v 覆盖时不进搜索（保留可用 place_v 件）
  //   ★BJ362 判据修正（2026-09-27 用户实报「日晷扔微光不变月晷」）：旧判据写于
  //   createTile 双源回填之前——「惰性 vi_ 无 tile」前提已失效：回填后 covered∩
  //   【有 tile】的 vi_ 件=真可放置+vid/rare/maxStack 全量原版语义,恒胜过 place_v
  //   克隆（vid 恒 undefined → 微光转化/稀有度/原版堆叠全域缺位;物证=用户搜索
  //   只得 place_v_356_enchanted_sundial,扔微光无反应）。故：covered 且【def.tile
  //   已回填】→ 真件入池 + 克隆退位（PLACE_CLONE_SUPERSEDED,items.ts ⑦）；
  //   仅【无 tile】的惰性死条目仍滤（原语义保留）。功能件豁免域不变。
  // ★功能件豁免（2026-09-02 神圣种子第三案真凶）：覆盖去重的本意=滤掉「唯一职能
  //  就是铺那格 tile」的惰性 vi_ 死条目；但草种/法杖/苔藓族的 createTile 虽被
  //  place_v 面板块覆盖,它们在 AssortedThings 里是【转化/消耗】功能件（圣种转
  //  泥土、法杖促草（活跃泥土→草,BJ562 定谳）+收获支、苔藓点石转化——PlantRules
  //  assortedPlaceOk/mossPlaceOk）
  //  ⇒ 曾被整族滤出搜索,用户搜「神圣种子」永远只剩面板块。豁免域=种子/法杖 vid
  //  集 ∪ 苔藓转化面。
  const seenVid = new Set<number>();
  const out: ItemSearchPoolEntry[] = [];
  // ★BJ362 件3（2026-09-27 用户复报「搜索出重复道具」）：克隆的显示名若与已入池
  //  真件同名 → 不进池（直接保证「池内无同名行,除非均为真件」——同名真件对如
  //  橡实/橡实画=原版本相,保留）。vi_ 内部 id 恒小于 place_v/PRIV 段（方案 A 恒等
  //  域:vid<10000 ≤ place 10286+/20000+）,forEach 序保证先收真件名后查克隆。
  //  被隐藏克隆的放置能力不受影响（键发放/世界放置/读档桥均在,仅搜索面退位——
  //  状态变体克隆如晶莹宝石(灭)/高门(开)/苔藓砖族由此同隐蔽,登记边界）。
  const realNames = new Set<string>();
  ITEM_DEFS.forEach((d, id) => {
    // ★BJ362 退位克隆不进池（真件已由 vid 侧入池,防「真件+克隆」双行复辟）
    if (PLACE_CLONE_SUPERSEDED.has(d.key)) return;
    const mv = /^vi_(\d+)_/.exec(d.key);
    const vid = mv ? Number(mv[1]) : null;
    if (vid !== null) {
      if (seenVid.has(vid)) return;
      // ★BJ738 P08：SetDefaults 归一化退位件（226→227）不进池——目标 vid 真件
      //  已由自身入池,双行即「旧名空功能件」复辟（原版 SetDefaults(226) 直转 227）
      if (VANILLA_VID_NORMALIZE[vid] !== undefined) return;
      seenVid.add(vid);
      const ct = vanillaItemCreateTile(vid);
      if (ct !== -1 && coveredSheets.has(ct) && !isFunctionalTileItem(ct) && !d.tile) return;   // 惰性 vi_ 死条目（无 tile=不可放置）
    }
    const name = io.nameOf(d.key) || d.key;
    const en = vid !== null ? (ITEM_NAME_EN_BY_ID[vid] ?? '') : '';
    const tip = vid !== null && io.tipOf ? io.tipOf(vid) : '';
    if (vid === null) {
      // ★BJ362 件3：克隆显示名撞已入池真件名 → 不进池（防同名双行）
      if (realNames.has(name)) return;
    } else {
      realNames.add(name);
    }
    const lc = (name + ' ' + d.key + ' ' + (vid ?? '') + ' ' + en + ' ' + tip).toLowerCase();
    out.push({ id, key: d.key, vid, name, lc });
  });
  return out;
}

// ============================================================================
// ★BJ207 2026-09-20 —— 搜索视图构建单源（自 UI.openItemSearchPanel render 摘出）。
// view = 唯一呈现集：BJ154「80 封顶」已废止,任何方式截断（slice(0,80) 异拼/min 平台
// 期/分页族）都会让浏览式打开丢件（BJ154 真凶①重演）。红蓝-N3 MUT-B 曾以
// view.slice(0,80) 异拼回植封顶 9/9 全绿存活——旧字面锁（shown > 80 /
// …更多结果请细化搜索）只认旧拼法;单源化后封顶可落点收敛为三处,各有行为锁看护
// （tests/sw-bj154-itemsearch-pool ④段）：①本函数内截断→合成 >80 池全长断言红;
//  ②UI 赋值表达式异拼→单源裸调用+裸赋值锚红;③spacer 公式侧截行→公式锚红。
// ============================================================================

/**
 * 搜索视图构建（UI render 单源）。
 * @param query 原始输入（trim+小写在本函数内做,UI 侧零本地过滤拼法）
 * @param alias zh 族词软链（翅膀↔翼,UI 侧既有表注入;缺省不桥）
 * @returns view 全量无封顶（query 空 = 浏览模式全池,同一数组直返）;
 *          searched = 是否查询态（计数行「命中 N / M」vs「共 M 件」语义单源）
 */
export function buildItemSearchView(
  pool: ItemSearchPoolEntry[],
  query: string,
  alias?: Record<string, string[]>,
): { view: ItemSearchPoolEntry[]; searched: boolean } {
  const qRaw = query.trim().toLowerCase();
  const qs = [qRaw, ...(alias?.[qRaw] ?? []).map((x) => x.toLowerCase())].filter(Boolean);
  return {
    view: qs.length ? pool.filter((e) => qs.some((q) => e.lc.includes(q))) : pool,
    searched: qs.length > 0,
  };
}
