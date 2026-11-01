// ★SW-BJ154 2026-09-19 —— 道具搜索池全量对齐守卫（用户实报：搜索面"道具不全，
// 史莱姆鞍 Slimy Saddle 2430 没看到"）。
//
// 定谳（BJ154）：遍历源无缺（ITEM_DEFS 6856 def / vid 域 6177 全覆盖，2430 走桥接
// 批 items.ts 注册、池序 464 在池、死条目滤不涉——鞍无 tile）；真凶=呈现层两刀：
//   ①渲染 80 条封顶（池序 464 > 80，浏览式打开永远看不到）；
//   ②匹配串无族词桥（官方 zh 名"粘鞍"不含"史莱姆"，tooltip"召唤可骑乘的史莱姆
//     坐骑"是唯一官方语汇桥）。
// 修法：①匹配串扩官方 tooltip 桥（itemSearch.buildItemSearchPool 单源）；
//   ②渲染面全量虚拟滚动（UI.ts，80 封顶废止）。
//
// 变异证红纪律：摘 tipOf 注入（池桥断）→「史莱姆命中 2430」红；池滤 2430/恢复
// 80 封顶 → 计数与结构锁红（人工变异须爆红后还原）。
//
// ★BJ207 2026-09-20 ——「80 封顶」行为锁（红蓝-N3 MUT-B 判别力补强）：MUT-B 曾以
// view.slice(0,80) 异拼回植封顶 9/9 全绿存活——旧字面锁（shown > 80 /
// …更多结果请细化搜索）只认旧拼法。现 view 构建已单源化（itemSearch.buildItemSearchView,
// BJ207）,封顶可落点收敛为三处,各有一道锁：①view 构建函数内截断 → ④段行为锁
// （合成 >80 池,浏览/查询两模式全长断言）;②UI 赋值表达式异拼（.slice 后缀/中转
// 再截）→ 单源裸调用+裸赋值锚红;③spacer 公式侧截行（Math.min(view.length,80) 族）→
// spacer 公式锚红。三锁并检 ⇒「任何方式产生 ≤80 截断呈现」必红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEM_DEFS, ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, vanillaItemCreateTile } from '../src/data/items';
import { TILE_DEFS, TILE_BY_KEY } from '../src/data/tiles';
import { isFunctionalTileItem } from '../src/world/evolution/PlantRules';
import { ITEM_NAME_BY_ID, TILE_NAME_BY_ID, TILE_NAME_ITEM_BY_SHEET, TILE_NAME_ZH_BY_ID } from '../src/i18n/idNames.generated';
import { buildItemSearchPool, buildItemSearchView, type ItemSearchPoolEntry } from '../src/ui/itemSearch';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const uiSrc = read('src/ui/UI.ts');

// ---- 生产同源 l10n 产物直读（Lang.itemNameByKey/ItemTooltip 的 zh 链终值） ----
const zh = JSON.parse(read('public/l10n/zh-Hans.json')) as {
  ItemName: Record<string, string>;
  ItemTooltip: Record<string, string>;
  MapObject: Record<string, string>;
};
// ★BJ362：nameOf 须与生产 Lang.itemNameByKey 同链——place_v_* 无独立名,走
//  tile sheet → MapObject/TILE_NAME_ZH → placer 物品名（缺此链=克隆名=key,
//  同名克隆退役规则失效,池计数金标虚高）。
const tileNameOf = (sheet: number): string => {
  const internal = TILE_NAME_BY_ID[sheet];
  if (internal && zh.MapObject[internal]) return zh.MapObject[internal];
  const fb = TILE_NAME_ZH_BY_ID[sheet];
  if (fb) return fb;
  const placer = TILE_NAME_ITEM_BY_SHEET[sheet];
  if (placer !== undefined) {
    const iid = ITEM_NAME_BY_ID[Number(placer)];
    if (iid && zh.ItemName[iid]) return zh.ItemName[iid];
  }
  return '';
};
const nameOf = (key: string): string => {
  const m = /^vi_(\d+)_/.exec(key);
  const internal = m ? ITEM_NAME_BY_ID[Number(m[1])] : undefined;
  if (internal && zh.ItemName[internal]) return zh.ItemName[internal];
  if (key.startsWith('place_v_')) {
    const def = ITEM_DEFS[ITEM_BY_KEY[key]];
    const sheet = def?.tile ? TILE_DEFS[TILE_BY_KEY[def.tile]]?.vanilla?.sheet : undefined;
    if (sheet !== undefined) return tileNameOf(sheet);
  }
  return '';
};
const tipOf = (vid: number): string => {
  const internal = ITEM_NAME_BY_ID[vid];
  return (internal && zh.ItemTooltip[internal]) || '';
};

describe('SW-BJ154 ①搜索池全量对齐（遍历源=全集域,零缺席）', () => {
  const pool = buildItemSearchPool({ nameOf, tipOf });
  const poolVids = new Set(pool.map((e) => e.vid).filter((v): v is number => v !== null));
  const allVids = Object.keys(VANILLA_ITEM_KEY_BY_ID).map(Number);
  const missing = allVids.filter((v) => !poolVids.has(v));

  it('2430 史莱姆鞍在池（用户实报件;遍历源/过滤器均不涉它）', () => {
    const e = pool.find((x) => x.vid === 2430);
    expect(e).toBeDefined();
    expect(e!.key).toBe('vi_2430_slimy_saddle');
    expect(e!.name).toBe('粘鞍');   // 官方 zh 终值（idNames/zh-Hans 同源）
  });

  it('全集 6177 vid 全在池（★BJ362 退位后零缺席;旧「死条目域」=createTile 双源回填前时代语义）', () => {
    // ★BJ362（2026-09-27）金标再生：旧判据「covered ⇒ 死条目」写于 createTile 双源
    //  回填之前——回填后 covered∩vi_ def 全部持有 tile（真可放置），死条目域实测
    //  清零：missing=[]（全集 vid 全在池）。+真件 2040 −退位/同名克隆 → 池 6251。
    //  missing 混入任何 vid = 真漏件（红）。
    // ★BJ744 改判史：BJ738 P08 SetDefaults 归一化退位件（226→227,Item.cs:4195-4212
    //  case 226 共享块首行 type=227——226 非现役药水）不进池（itemSearch.ts
    //  VANILLA_VID_NORMALIZE 门）→ missing 恒 [226]（目标 vid 227 真件在池,双行
    //  =「旧名空功能件」复辟）;除 226 外混入任何 vid 仍=真漏件（红）。
    expect(missing).toEqual([226]);   // 唯一合法缺席=归一化退位件 226（BJ738 P08）
    // 计数恒等式（+1 = 域外件 4143,见下）;2430 必须在池侧
    expect(poolVids.size + missing.length).toBe(allVids.length + 1);
    expect(poolVids.has(2430)).toBe(true);
    // 域外件快照:池 vid 域可比全集多（SW 手写子件）,现仅 4143 法力斗篷星
    // （vanilla.json 素材域外的按需注册件,非玩家常规可得）——新增域外件须有意重锚
    const extra = [...poolVids].filter((v) => !new Set(allVids).has(v));
    expect(extra).toEqual([4143]);
  });

  it('池条目数快照（★BJ362 重锚:4816 + 2040 回填真件回池 − 567 退位克隆 − 38 同名克隆 − 1 归一化退位 = 6250）', () => {
    // 2026-09-19 定值 4816 = 6856 def − 2040 旧判据滤掉的「死 vid」。
    // ★BJ362（2026-09-27）：回填真件 2040 回池 + place_v 克隆退位 567
    //  （items.ts ⑦:唯一真件 509 + 多件族 style0 基件 58;PLACE_CLONE_SUPERSEDED）
    //  + 搜索面同名克隆退役 38（显示名撞已入池真件:人体模型 legacy/武器架 legacy/
    //  垃圾桶/晶莹宝石 off×7/苔藓砖×9/高门 open×2/装饰株族等——放置能力不受影响,
  //  仅搜索面退位）→ 4816 + 2040 − 567 − 38 = 6251。
    //  ★BJ744 改判史：BJ738 P08 归一化退位件 226 出池（见上注）→ −1 = 6250。
    expect(pool.length).toBe(6250);
    expect(ITEM_DEFS.length).toBe(20754);   // ★方案 A:稀疏域数组长=maxStable+1（实件 6856 由 D1 闸门钉）
  });
});

describe('SW-BJ154 ②族词桥（真凶②:官方 zh 名不带族词,tooltip 语汇入搜）', () => {
  const pool = buildItemSearchPool({ nameOf, tipOf });

  it('搜"史莱姆"命中 2430 粘鞍（tooltip"召唤可骑乘的史莱姆坐骑"桥）', () => {
    const e = pool.find((x) => x.vid === 2430)!;
    expect(e.lc).toContain('史莱姆');
    expect(e.lc.includes('史莱姆')).toBe(true);
  });

  it('搜"slimy"/"saddle"命中 2430（英文名桥,BJ81 既有语义不回退）', () => {
    const e = pool.find((x) => x.vid === 2430)!;
    expect(e.lc).toContain('slimy saddle');
  });

  it('无 tipOf 注入时 2430 不命中"史莱姆"（桥判别力自证）', () => {
    const bare = buildItemSearchPool({ nameOf });
    const e = bare.find((x) => x.vid === 2430)!;
    expect(e.lc).not.toContain('史莱姆');
  });
});

describe('SW-BJ154 ③渲染面全量虚拟滚动（真凶①:80 封顶废止）', () => {
  it('80 条封顶死码不复存在（旧"…更多结果请细化搜索"截断面摘除）', () => {
    expect(uiSrc.includes('shown > 80')).toBe(false);
    expect(uiSrc.includes('…更多结果请细化搜索')).toBe(false);
  });

  it('虚拟滚动三锚:spacer+ResizeObserver 列宽自适应+关面板 disconnect', () => {
    expect(uiSrc).toMatch(/const spacer = el\('div'\);/);
    expect(uiSrc).toMatch(/new ResizeObserver\(\(\) => layout\(\)\)/);
    expect(uiSrc).toMatch(/closeItemSearch\(\) \{[\s\S]{0,400}itemSearchResizeOb\?\.disconnect\(\)/);
  });

  it('BJ81 结构锁不回退:条目按下即取+长按起拍（e.id 同名锚）', () => {
    expect(uiSrc).toMatch(
      /item\.addEventListener\('mousedown', \(ev\) => \{[\s\S]{0,160}this\.itemSearchGrab\(e\.id\);[\s\S]{0,120}this\.startItemSearchGrabRepeat\(e\.id\);/,
    );
    expect(uiSrc).toMatch(/openItemSearchPanel\(\) \{[\s\S]{0,700}this\.openInventory\(true\)/);
  });
});

// ============================================================
// ★BJ207 ④「80 封顶」行为锁（MUT-B 判别力补强:任何方式截断必红,头注见上）
// ============================================================
describe('SW-BJ207 ④「80 封顶」行为锁（view 全量无封顶,三落点并检）', () => {
  const pool = buildItemSearchPool({ nameOf, tipOf });
  /** 合成 >80 池（不依赖 l10n 内容面——注册面变化不虚红,封顶判定纯行为） */
  const big: ItemSearchPoolEntry[] = Array.from({ length: 130 }, (_, i) => ({
    id: i, key: `k${i}`, vid: null, name: `甲件${i}`, lc: `甲件${i} k${i}`,
  }));

  it('行为面①:浏览模式（query 空）=全池零截断（130 件池全长出 view）', () => {
    const r = buildItemSearchView(big, '');
    expect(r.searched).toBe(false);
    expect(r.view.length).toBe(130);   // 任何 slice/min/分页封顶 → 红
  });

  it('行为面①:查询命中 >80 =全量命中零截断（MUT-B slice(0,80) 落点必红）', () => {
    const r = buildItemSearchView(big, '甲件');
    expect(r.searched).toBe(true);
    expect(r.view.length).toBe(130);
  });

  it('行为面①:族词别名桥随 view 构建走（翅膀→翼 单源不回退;无桥不命中=桥判别力）', () => {
    const wing: ItemSearchPoolEntry[] = [{ id: 0, key: 'w0', vid: null, name: '太阳翼', lc: '太阳翼 w0' }];
    expect(buildItemSearchView(wing, '翅膀', { 翅膀: ['翼'] }).view.length).toBe(1);
    expect(buildItemSearchView(wing, '翅膀').view.length).toBe(0);
  });

  it('行为面①:真实池浏览模式 view=全池 6250（★BJ362 重锚;★BJ744 BJ738 P08 −1,与池计数快照同源）', () => {
    expect(buildItemSearchView(pool, '').view.length).toBe(6250);
  });

  it('UI 锚②:view 构建=单源裸调用+裸赋值（.slice 后缀/中转再截等异拼全数破锚）', () => {
    expect(uiSrc).toMatch(
      /const \{ view: vv, searched \} = buildItemSearchView\(pool, input\.value, ALIAS\);\s*\n\s*view = vv;/,
    );
  });

  it('UI 锚③:spacer 总高=ceil(view.length/cols)×行高（公式侧 Math.min 截行破锚）', () => {
    expect(uiSrc).toMatch(
      /const rows = Math\.ceil\(view\.length \/ cols\);\s*\n\s*spacer\.style\.height = `\$\{rows \* \(ROW_H \+ GAP\)\}px`;/,
    );
  });
});
