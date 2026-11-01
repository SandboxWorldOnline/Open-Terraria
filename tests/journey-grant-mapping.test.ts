// 旅行道具浏览器授予链映射回归(2026-09-02 神圣种子事件类):
//   搜索命中 vid → internalIdOfVid → giveItem 背包落 def。三环任一歧义都会把
//   「搜到的 A」变成「拿到的 B」。本锁钉死:
//   ①vid→def 解析保真:VANILLA_ITEM_KEY_BY_ID 全量条目经 internalIdOfVid 落到的
//     def 的 vi_vid 与请求 vid 一致(★Pascal/snake 双键属历史别名设计——内容等价
//     且反查指向桥接侧更富 def,故锁 vid 同一性而非字符串全等);
//   ②place_v_* 自制 vid 空间(PRIV_ITEM_STABLE)与原版 vid 无碰撞;
//   ③种子族九员的 createTile 与授予后路由判定一致。
//标杆:src/net/leashedSync.internalIdOfVid(JourneyPowersUI 版同源)。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { languageManager } from '../src/i18n/LanguageManager';
import { ITEM_BY_KEY, ITEM_DEFS, VANILLA_ITEM_KEY_BY_ID, vanillaItemCreateTile, VANILLA_VID_NORMALIZE } from '../src/data/items';
import { GRASS_CONVERT_SHEETS, assortedPlaceOk } from '../src/world/evolution/PlantRules';
import { internalIdOfVid } from '../src/net/leashedSync';

const viVidOf = (key: string): number | null => {
  const m = /^vi_(\d+)_/.exec(key);
  return m ? Number(m[1]) : null;
};

beforeAll(() => {
  // zh 包注入+culture 激活(搜索匹配走 Lang.itemName 的 zh 官方译名)
  languageManager.loadPackJson(JSON.parse(readFileSync('public/l10n/zh-Hans.json', 'utf8')));
  (languageManager as unknown as { activeCulture: unknown }).activeCulture =
    { name: 'zh-Hans', legacyId: 1, displayNameKey: 'Language.Chinese' };
});

describe('JourneyBrowser 授予映射（vid→def 全量）', () => {
  it('①vid→def 解析保真：每个原版条目落到的 def 持同一 vi_vid（别名键不串号）', () => {
    const vids = Object.keys(VANILLA_ITEM_KEY_BY_ID).map(Number);
    const bad: string[] = [];
    expect(vids.length).toBeGreaterThan(1000);          // 原版全量面
    let checked = 0;
    for (const vid of vids) {
      // ★BJ744 改判史：BJ738 P08 SetDefaults 归一化（226→227,Item.cs:4195-4212
      //  case 226 共享块 type=227——226 非现役药水）把 226 权威键重定向 vi_227 →
      //  归一化退位源 vid 豁免（消费端 JourneyPowersUI/itemSearch 均已排除）。
      if (VANILLA_VID_NORMALIZE[vid] !== undefined) continue;
      const wantKey = VANILLA_ITEM_KEY_BY_ID[vid];
      const id = internalIdOfVid(vid);
      const dKey = id >= 0 ? ITEM_DEFS[id]?.key : undefined;   // ★≥0 判(0=合法位)
      // 表内键解析出的 vid 必须等于请求 vid(键可能指向同 vid 的别名 def)
      const keyVid = wantKey ? viVidOf(wantKey) : null;
      if (keyVid !== vid) { bad.push(`TABLE-CROSS vid=${vid} 表键=${wantKey}`); continue; }
      if (id < 0) { bad.push(`MISSING vid=${vid} 表键=${wantKey}`); continue; }
      if (dKey == null) { bad.push(`EMPTY-DEF vid=${vid} 表键=${wantKey}`); continue; }
      const gotVid = viVidOf(dKey);
      if (gotVid !== vid) {
        bad.push(`CROSS vid=${vid} 表键=${wantKey} 落点def=${dKey}`);
        continue;
      }
      checked++;
    }
    if (bad.length) throw new Error(`BAD-MAP ${bad.length}:\n` + bad.slice(0, 40).join('\n'));
  });

  it('②place_v_* 自制 vid 空间不与原版 vid 空间重叠', async () => {
    const vanilla = new Set(Object.keys(VANILLA_ITEM_KEY_BY_ID).map(Number));
    const STABLE = (await import('../src/data/items')).PRIV_ITEM_STABLE as Record<string, number>;
    let nPlace = 0;
    for (const [k, v] of Object.entries(STABLE)) {
      if (!k.startsWith('place_v_')) continue;
      nPlace++;
      expect(vanilla.has(v), `place_v ${k} vid=${v} 撞原版`).toBe(false);
      expect(v >= 10100).toBe(true);                     // 本仓自制段下限带
    }
    expect(nPlace).toBeGreaterThanOrEqual(50);           // 面板物族面规模采样
  });

  it('③种子族九员：createTile(meta) ⇔ 授予后路由判定一致', () => {
    for (const vid of [62, 59, 2171, 369, 195, 194, 5214]) {
      const ct = vanillaItemCreateTile(vid);
      expect(ct, `vid${vid}`).toBeGreaterThan(0);
      expect(GRASS_CONVERT_SHEETS.has(ct)).toBe(true);       // 路由可达
      // 空格恒拒(终止通用链的判据由 Game 层承载;此处锁门函数语义)
      expect(assortedPlaceOk(false, ct, 0, true)).toBe(false);
      expect(assortedPlaceOk(false, ct, -1, false)).toBe(false); // 泥土以外基座拒
    }
    // 法杖二员:促草净效应=活跃泥土（★BJ562 定谳:空格/石/灰砖 PlaceTile(2) 内门恒拒=no-op;
    // 石/灰砖→苔藓=StaffOfRegrowthCheck 死代码 1457 零调用点）
    for (const vid of [213, 5295]) {
      expect(assortedPlaceOk(true, vanillaItemCreateTile(vid), 0, true)).toBe(false);
      expect(assortedPlaceOk(true, vanillaItemCreateTile(vid), 0, false)).toBe(true);
    }
  });
});

describe('★哨兵 0 撞合法 def 位回归（2026-09-02 review 实锤;方案 A 恒等域重钉 BJ264 2026-09-22）', () => {
  it('vid 109 魔力水晶=ITEM_DEFS[109]（恒等;旧序 0 号位已退役为空洞）:internalIdOfVid 解析=109', () => {
    expect(ITEM_DEFS[0]).toBeUndefined();                    // 方案 A:0 号位=空洞(原版 netID 0 语义)
    expect(ITEM_DEFS[109]?.key).toBe('vi_109_mana_crystal'); // internal≡vid 恒等
    const id = internalIdOfVid(109);
    expect(id).toBe(109);                                    // ≥0 且=vid（未注册 vid 仍归 -1 哨兵）
    expect(ITEM_DEFS[id]?.key).toBe('vi_109_mana_crystal');  // 授予保真
  });
});

describe('★授予热栏落位（2026-09-02 UX 批：热栏满时旧策略落背包尾,玩家手里仍是旧物）', () => {
  const fakeGame = (inv: import('../src/items/Inventory').Inventory) =>
    ({ player: { inv }, cb: { onInventoryChanged() {} } }) as never;

  it('热栏全满+选中槽占用 → 授予落选中槽弹回? 不——落首个空热栏槽;全满才走背包尾', async () => {
    const { Inventory } = await import('../src/items/Inventory');
    const { giveItem } = await import('../src/ui/JourneyPowersUI');
    const inv = new Inventory();
    const seedId = internalIdOfVid(369);
    for (let i = 0; i < 10; i++) inv.slots[i] = { id: seedId === 0 ? 1 : (i === 3 ? seedId : 10000 + i), stack: 99 };
    // 槽 3 预放同 id 半堆 → 合并;其余为别物。选中 5
    inv.slots[3] = { id: seedId, stack: 1 };
    inv.selected = 5;
    giveItem(fakeGame(inv), seedId, 1);
    const s3 = inv.slots[3]!, s5 = inv.slots[5]!;
    // 选中槽 5 为别物(不可吞) → 不覆盖;合并进 3 的半堆
    expect(s5?.id).not.toBe(seedId);
    expect(s3.stack).toBe(2);
  });

  it('热栏有空槽且选中槽占用别物 → 首个空热栏槽落位(不再坠背包尾 10-49)', async () => {
    const { Inventory } = await import('../src/items/Inventory');
    const { giveItem } = await import('../src/ui/JourneyPowersUI');
    const inv = new Inventory();
    const seedId = internalIdOfVid(369);
    for (let i = 0; i < 10; i++) if (i !== 7) inv.slots[i] = { id: 20000 + i, stack: 1 };
    inv.selected = 2;
    giveItem(fakeGame(inv), seedId, 1);
    expect(inv.slots[7]!.id).toBe(seedId);           // 唯一空热栏槽 7
    for (let i = 10; i < 50; i++) expect(inv.slots[i] ?? null).toBeNull(); // 背包尾无坠物(slots 以 null 占位)
  });
});

describe('★复制面板=开发者模式全量池（2026-09-02 用户拍板）', () => {
  it('全量 vid 空间下搜「神圣种子」必命中 vid 369（未研究也可见可取）', async () => {
    const { runBrowserQuery, searchMatches } = await import('../src/ui/JourneyBrowser');
    void searchMatches;
    const vids = Object.keys(VANILLA_ITEM_KEY_BY_ID).map(Number);
    expect(vids.length).toBeGreaterThan(5000);
    const stub = { isNewlyResearched: () => false, isResearched: () => false };
    const out = runBrowserQuery(vids, { search: '神圣种子', activeFilters: [] }, stub);
    expect(out).toContain(369);
    // 面板块不在原版 vid 空间,同名撞车根除后「神圣种子」查询只回落真种子
    for (const v of out) expect(v).toBe(369);
  });
});

describe('★背包道具搜索器覆盖去重豁免（2026-09-02 第三案真凶）', () => {
  it('圣种/草种/法杖/苔藓族不被 place_v 覆盖去重滤掉（isFunctionalTileItem）', async () => {
    const { isFunctionalTileItem } = await import('../src/world/evolution/PlantRules');
    // 种子族 createTile:2/23/59?/60/70/109/199/633/661/662 + 法杖 2 + 苔藓 11 面
    for (const vid of [62, 59, 2171, 369, 195, 194, 5214, 213, 5295]) {
      expect(isFunctionalTileItem(vanillaItemCreateTile(vid)), `vid${vid}`).toBe(true);
    }
    for (const vid of [4349, 4350, 4351, 4352, 4353, 4354, 4377, 4378, 4389, 5127, 5128]) {
      expect(isFunctionalTileItem(vanillaItemCreateTile(vid)), `moss vid${vid}`).toBe(true);
    }
    // 对照:纯铺块死条目（createTile 被 place_v 覆盖且不在功能面）仍应滤除
    expect(isFunctionalTileItem(1)).toBe(false);   // 石块(place_v_1 覆盖,无转化职能)
  });
});
