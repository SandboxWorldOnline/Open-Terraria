// dual-key 注册归一守卫（docs/dual-key-cleanup-plan.md）。
// ★SW-BN1 2026-09-07 终态改写：二期归一化把「同 vid 多 def」清零——
//   banner×290＋f兜底×35＋杂×5 蛇形影子 def 撤注册（键别名到权威驼峰 def,同构
//   SW-BK1 墙族 284 件试点）；蛇形自身双注册 122/217/1507/5359 撤首注册（保 byKey
//   现指向）；4851-4857 宝石橡树自动孤儿 def 跳过（取后注册者=显式件）。
//   ITEM_DEFS 7195→6854、byKey 8109 键零丢失、同 vid 双键对 327→0。
// ★SW-BN4 2026-09-08 锁升级（三期全域收官——BN1 落地后独立探针三视角复算：
//   vid/stable-id/同键多 def 全 0,BJ16 时代「339 组同 stable id 双 def」已清）：
//   ①同 vid 多 def=0（原锁保持）②同键重复注册=0（全域含非 vi_ 键——ITEM_BY_KEY
//   静默覆写类,4851-4857 同族）③同 stable id 多 def=0（BJ16 判词转正为锁,稳定 id
//   表第三视角）④byKey 全 vi_ 键别名一致性域扫（逐键同靶 VANILLA_ITEM_KEY_BY_ID
//   [vid],替代 20 代表抽验;豁免 vi_4143_manacloakstar=唯一无权威反查件,vanilla.json
//   无 vid 4143 的显式手注册）⑤banner 族键基数锁 290＋placeStyle 全域回填锁
//   （权威 def 290/290 placeStyle defined 且 =BANNER_STYLE_BY_VID;类级回填循环
//   items.ts:1268 先于别名块 :1662,权威 def 恒刷到——BN1 前影子件注册序靠后恒漏
//   =285 预存红,已随 BN1 清偿）⑥f 兜底族键基数锁 35。
// 本套件由批次A「字段搬移差异清零」守卫改写为终态守卫：
//   ①同 vid 多 def=0（清理方案第 6 步终态断言转正,永久锁,防双键注册再犯）
//   ②影子键别名解析锁（撤注册不删键——save.test/item-retirement 的蛇形键反查、
//     idNames.generated ITEM_KEY_TO_ID、SpriteAtlas 键映射、SaveFile legacyItemIndex
//     快照键全部依赖键可解析;别名还必须指向权威 def=VANILLA_ITEM_KEY_BY_ID 同靶）
//   ③批次A搬移抽验保留（键全继续解析,断言语义不变）
// 历史沿革：批次A(2026-08-14)锁「驼峰独有字段=0」;288267a5(2026-08-21)VID_SEEN_IDX
//   按 vid 去重+Pascal 别名（对数 1227→611）;SW-BK1(2026-09-06)墙族 284 件试点
//   （611→327,基数守卫 ≥1200→≥600→≥320）;SW-BN1(2026-09-07)余量 341 件撤注册→
//   对数 0——基数守卫与「驼峰独有字段」断言随双键对消失一并退役（285 个 banner 族
//   placeStyle 预存红同批清偿：权威件独有 placeStyle=影子件注册序晚于 bannerStyleClassPs
//   类级回填循环恒未刷到,撤影子 def 后无对可差,且玩家实持权威件带 placeStyle 零行为差）;
//   SW-BN4(2026-09-08)全域三视角多 def=0 复算+锁扩面（本批,BN1 归一化的永久守卫升级,
//   零 items.ts 改动——归一化结构 BANNER_VID_RUNS/SWBN1_MISC5_KEYS/SWBN1_F_FALLBACK_VIDS/
//   4851-4857 跳过支已在盘上,本批仅把抽验级守卫升为全域守卫）。
//   SW-RB8d(2026-09-08)红蓝对抗审计:三重零/域扫 7430/banner 290/f35 独立探针复算全证实;
//   补三锁=①无权威豁免集单点钉（恰 vi_4143_manacloakstar 一件——vanilla.json 全量无
//   vid 4143,邻位 4142/4144 在;ItemID.cs:9832 ManaCloakStar=纯 pickup 件无 SetDefaults
//   case,2026-08-27 手注册未按 6153/4058 惯例回填权威表）②byKey 值域锁（悬空索引防;
//   alias 键 def.key≠键串 1255 件是设计态,勿键面比对）③banner st91 在域锁（关失配
//   比对盲窗:BANNER_VID_RUNS 290 vid ⊆ BANNERS 316 探针实证,段缩即红）。三锁判别力
//   经对象级变异探针验证必红。
import { describe, it, expect } from 'vitest';
import { ITEM_DEFS, ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_STABLE_OF_INTERNAL, VANILLA_VID_NORMALIZE } from '../src/data/items';
import { BANNER_STYLE_BY_VID } from '../src/data/vanillaStyleDrops';

const VID_RE = /^vi_(\d+)_/;

/** 同 vid 分组（vi_ 键;稳定 id = key 内嵌 vid 派生,分组即注册表拓扑） */
const defsByVid = (() => {
  const m = new Map<number, number[]>();
  ITEM_DEFS.forEach((d, i) => {
    const vm = /^vi_(\d+)_/.exec(d.key);
    if (!vm) return;
    const vid = Number(vm[1]);
    if (!m.has(vid)) m.set(vid, []);
    m.get(vid)!.push(i);
  });
  return m;
})();

/** 同键字符串分组（全域含非 vi_ 键;同键双 def = ITEM_BY_KEY 静默覆写类,4851-4857 同族） */
const defsByKeyStr = (() => {
  const m = new Map<string, number[]>();
  ITEM_DEFS.forEach((_, i) => {
    const k = ITEM_DEFS[i].key;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(i);
  });
  return m;
})();

/** 同 stable id 分组（稳定 id 表第三视角;0=无稳定 id 哨兵不入组） */
const defsByStable = (() => {
  const m = new Map<number, number[]>();
  ITEM_DEFS.forEach((_, i) => {
    const s = ITEM_STABLE_OF_INTERNAL[i];
    if (!s) return;
    if (!m.has(s)) m.set(s, []);
    m.get(s)!.push(i);
  });
  return m;
})();

describe('dual-key 归一终态锁（SW-BN1 2026-09-07 落地；SW-BN4 2026-09-08 全域扩面）', () => {
  it('终态：同 vid 多 def = 0（清理方案第 6 步断言,防双键注册再犯）', () => {
    const dups: string[] = [];
    for (const [vid, idxs] of defsByVid) {
      if (idxs.length > 1) dups.push(`vid ${vid}: ${idxs.map((i) => ITEM_DEFS[i].key).join(' | ')}`);
    }
    expect(dups, `同 vid 多 def ${dups.length} 组:\n${dups.join('\n')}`).toEqual([]);
  });

  it('终态：同键重复注册 = 0（全域含非 vi_ 键;同键双 def=ITEM_BY_KEY 静默覆写类）', () => {
    const dups: string[] = [];
    for (const [k, idxs] of defsByKeyStr) {
      if (idxs.length > 1) dups.push(`${k} ×${idxs.length}`);
    }
    expect(dups, `同键重复注册 ${dups.length} 组:\n${dups.join('\n')}`).toEqual([]);
  });

  it('终态：同 stable id 多 def = 0（BJ16「同 stable id 双 def」判词转正为永久锁）', () => {
    const dups: string[] = [];
    for (const [s, idxs] of defsByStable) {
      if (idxs.length > 1) dups.push(`stable ${s}: ${idxs.map((i) => ITEM_DEFS[i].key).join(' | ')}`);
    }
    expect(dups, `同 stable id 多 def ${dups.length} 组:\n${dups.join('\n')}`).toEqual([]);
  });

  // ★SW-RB8b 2026-09-09 补钉：第三锁盲窗——ITEM_STABLE_OF_INTERNAL 构建对缺稳定 id
  //  的 def 只 console.error（items.ts:2121 `[stable-id] item 缺稳定 id`）并留 0,
  //  上方 defsByStable `if (!s) return` 静默跳过 = 「stable 0 多 def」三锁全盲
  //  （构建期日志测试零红）。断言：任何 def 稳定 id 必须非 0（vi_/place_v_/PRIV 三
  //  派生支之一命中）——新键漏表即在此过闸。
  it('终态：stable id 全域可解析 = 0 缺失（SW-RB8b 补第三锁 stable-0 盲窗;★方案 A 恒等域重钉=只查实件,洞位豁免）', () => {
    const missing: string[] = [];
    ITEM_STABLE_OF_INTERNAL.forEach((s, i) => {
      // ★方案 A（BJ264）：恒等域下 STABLE[i]=i,仅 0 号位（空洞,无 def）为 0——
      //   「缺稳定 id 的 def」判据收紧为实件（!ITEM_DEFS[i] 跳洞）;新注册漏表
      //   在 items.ts reorder pass 双射 fail-fast 即炸,本锁保留为读数面终闸。
      if (!s && ITEM_DEFS[i]) missing.push(`#${i} ${ITEM_DEFS[i]?.key ?? '?'}`);
    });
    expect(missing, `缺稳定 id def ${missing.length} 件:\n${missing.join('\n')}`).toEqual([]);
  });

  // ★SW-RB8b 2026-09-09 台账一致性钉：BN1 终态三账（ITEM_DEFS 7195→6854→★BJ69
  //  2026-09-14 6856、byKey 8109→8111 键零丢失、VANILLA_ITEM_KEY_BY_ID 6175→6177
  //  vid——3861/3862 宝藏袋按数据管线注册=atlas-append ①c+自动注册循环,+2 def/+2
  //  键/+2 vid legit 扩容有意识改本钉）；隐式漂移（误注册/批量重放踩踏）在此显形。
  //  ★方案 A（BJ264 2026-09-22）：ITEM_DEFS 重排为 internal≡stable 稀疏域——数组
  //  length=maxStable+1=20754（实件 6856 不变,由 item-retirement D1 闸门钉住）,
  //  三账的第一账改按稀疏长度钉;键账/vid 账不动。
  it('台账一致性：ITEM_DEFS 稀疏长 20754（实件 6856）/ byKey 8111 / 权威反查 6177（BN1 终态三账+方案 A 重钉）', () => {
    expect(ITEM_DEFS.length, 'ITEM_DEFS 稀疏长度漂移（方案 A 台账 20754=maxStable+1）').toBe(20754);
    expect(ITEM_DEFS.filter(Boolean).length, 'ITEM_DEFS 实件数漂移（BN1 台账 6856）').toBe(6856);
    expect(Object.keys(ITEM_BY_KEY).length, 'byKey 键数漂移（BN1 台账 8111）').toBe(8111);
    expect(Object.keys(VANILLA_ITEM_KEY_BY_ID).length, '权威 vid 反查键数漂移（BN1 台账 6177）').toBe(6177);
  });

  it('全域别名一致性域扫：byKey 每个 vi_ 键与 VANILLA_ITEM_KEY_BY_ID[vid] 同靶（SW-BN4,替代代表抽验）', () => {
    const fail: string[] = [];
    const skipped: string[] = [];
    const normalizedAway: string[] = [];
    let swept = 0;
    for (const k of Object.keys(ITEM_BY_KEY)) {
      const m = VID_RE.exec(k);
      if (!m) continue;
      // ★BJ744 改判史：BJ738 P08 SetDefaults vid 归一化（226→227,Item.cs:4195-4212
      //  case 226 共享块 type=227——226 非现役药水）把源 vid 的权威键重定向到目标件
      //  （VANILLA_ITEM_KEY_BY_ID[226]=vi_227_…）,而 vi_226 def 有意保留注册（数组
      //  下标不可删,金鱼掉魂平移事故先例）→ 归一化退位源键单列豁免（有界,新成员
      //  必红——同 4143 豁免 idiom）。
      if (VANILLA_VID_NORMALIZE[Number(m[1])] !== undefined) { normalizedAway.push(k); continue; }
      const aKey = VANILLA_ITEM_KEY_BY_ID[Number(m[1])];
      if (aKey === undefined) { skipped.push(k); continue; }
      swept++;
      if (ITEM_BY_KEY[k] !== ITEM_BY_KEY[aKey]) {
        fail.push(`${k} → def#${ITEM_BY_KEY[k]} ≠ 权威 ${aKey} → def#${ITEM_BY_KEY[aKey]}`);
      }
    }
    expect(normalizedAway, '归一化退位源键集漂移（BJ738 P08 域外新增?）').toEqual([
      'vi_226_LesserRestorationPotion',
    ]);
    expect(fail, `别名失靶 ${fail.length}/${swept} 键:\n${fail.slice(0, 20).join('\n')}`).toEqual([]);
    // ★SW-RB8d 2026-09-08 豁免单点断言：无权威反查 vi_ 键必须恰为 vi_4143_manacloakstar
    //   一件（vanilla.json 无 vid 4143 → 自动循环无 def,2026-08-27 显式手注册;BN4 曾
    //   静默 continue——豁免集无界增长不红。fallback 支复活/新无权威手注册均在此过闸）
    expect(skipped, '无权威反查 vi_ 键集漂移（vi_4143_manacloakstar 外新增?）').toEqual([
      'vi_4143_manacloakstar',
    ]);
    // ★SW-RB8d byKey 值域锁：全键值必须落在 ITEM_DEFS 下标域（悬空索引=消费端 undefined
    //   崩;注意 alias 键 def.key≠键串本身是设计态 1255 件,勿做键面全等比对）
    const oob: string[] = [];
    for (const [k, idx] of Object.entries(ITEM_BY_KEY)) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= ITEM_DEFS.length) oob.push(`${k}→${String(idx)}`);
    }
    expect(oob, `byKey 越界值 ${oob.length} 组:\n${oob.slice(0, 10).join('\n')}`).toEqual([]);
    // 覆盖面地板 = VANILLA_ITEM_KEY_BY_ID vid 数（每 vid 至少 1 个 vi_ 键可扫;
    // 现值 7430 = 6175 vid + 1255 影子/别名键）——别名机制或键空间塌缩即破地板
    expect(swept, '域扫覆盖面塌缩（vi_ 键/权威反查大幅减少?）').toBeGreaterThanOrEqual(
      Object.keys(VANILLA_ITEM_KEY_BY_ID).length,
    );
  });

  it('banner 族终态：键基数 290、0 兜底注册、placeStyle 全域回填（类级循环 BANNER_STYLE_BY_VID 同靶）', () => {
    const keys = Object.keys(ITEM_BY_KEY).filter((k) => /^vi_\d+_banner_b\d+$/.test(k));
    expect(keys, 'banner 影子键基数（BANNER_VID_RUNS 13 段合计;增删段须有意识过闸）').toHaveLength(290);
    const noAuth: string[] = [];
    const psMissing: string[] = [];
    const psMismatch: string[] = [];
    const stMissing: string[] = [];
    for (const k of keys) {
      const vid = Number(VID_RE.exec(k)![1]);
      const aKey = VANILLA_ITEM_KEY_BY_ID[vid];
      if (aKey === undefined) { noAuth.push(k); continue; } // 走兜底注册支=影子 def 复活
      const ps = ITEM_DEFS[ITEM_BY_KEY[k]].placeStyle;
      if (ps === undefined) { psMissing.push(k); continue; }
      const st91 = BANNER_STYLE_BY_VID[vid];
      // ★SW-RB8d：先钉 st91 在域再比对（原 st91!==undefined 条件会把「BANNERS 表丢段」
      //   变成静默跳过=失配比对盲窗;BANNER_VID_RUNS 290 vid ⊆ BANNERS 316 已探针实证）
      if (st91 === undefined) { stMissing.push(k); continue; }
      if (ps !== st91) psMismatch.push(`${k}: ${ps} ≠ ${st91}`);
    }
    expect(noAuth, 'banner 兜底注册必须为 0（290/290 有权威 def;vanilla.json 缺件才走兜底支）').toEqual([]);
    expect(psMissing, 'banner placeStyle 缺失（类级回填循环未刷到权威 def?）').toEqual([]);
    expect(stMissing, 'banner vid 逸出 BANNER_STYLE_BY_VID（vanillaStyleDrops BANNERS 表缩段?）').toEqual([]);
    expect(psMismatch, 'banner placeStyle 与 BANNER_STYLE_BY_VID 失配').toEqual([]);
  });

  it('f 兜底族终态：键基数 35、0 兜底注册（杂 5 键无 _f<vid> 后缀,在下方代表集单独钉）', () => {
    const keys = Object.keys(ITEM_BY_KEY).filter((k) => /^vi_\d+_f\d+$/.test(k));
    expect(keys, 'f 兜底影子键基数（SWBN1_F_FALLBACK_VIDS;增删须有意识过闸）').toHaveLength(35);
    const noAuth = keys.filter((k) => VANILLA_ITEM_KEY_BY_ID[Number(VID_RE.exec(k)![1])] === undefined);
    expect(noAuth, 'f 族兜底注册必须为 0').toEqual([]);
  });

  it('影子键别名解析锁：代表集（撤注册不删键;钉非 _banner_bN/_f<vid> 命名类）', () => {
    // 代表集:banner 首末件/banner-plus 双影子/f兜底(带 tile)/杂5/蛇形自身双注册/宝石橡树同键
    const shadowKeys: ReadonlyArray<readonly [string, number]> = [
      ['vi_1615_banner_b1', 1615], ['vi_2916_banner_b107', 2916], ['vi_5651_banner_b290', 5651],
      ['vi_3392_banner_b188', 3392], ['vi_3392_f3392', 3392], ['vi_3393_f3393', 3393],
      ['vi_2289_f2289', 2289], ['vi_2001_f2001', 2001], ['vi_2613_f2613', 2613],
      ['vi_5573_torch_gods_potion', 5573], ['vi_3823_brand_of_the_inferno', 3823],
      ['vi_4760_sergeants_united_shield', 4760], ['vi_4608_chum_bucket', 4608],
      ['vi_2422_hotline_fishing_hook', 2422],
      ['vi_122_molten_pickaxe', 122], ['vi_217_molten_hamaxe', 217],
      ['vi_1507_spectre_hamaxe', 1507], ['vi_5359_shellphone_spawn', 5359],
      ['vi_4851_GemTreeTopazSeed', 4851], ['vi_4857_GemTreeAmberSeed', 4857],
    ];
    for (const [sKey, sVid] of shadowKeys) {
      const si = ITEM_BY_KEY[sKey];
      expect(si, `影子键 ${sKey} 必须仍可解析（撤注册不删键）`).not.toBeUndefined();
      const aKey = VANILLA_ITEM_KEY_BY_ID[sVid];
      expect(aKey, `vid ${sVid} 必须有权威反查键`).not.toBeUndefined();
      const ai = ITEM_BY_KEY[aKey!];
      // 蛇形自身双注册/宝石橡树同键：sKey===aKey 或 sKey 与权威键同 def
      expect(si, `${sKey} 应与权威 def ${aKey} 同靶（别名机制）`).toBe(ai);
    }
  });

  it('归一后权威面抽验：banner placeStyle/钓饵锚 tile/宝箱 tile 落在唯一 def', () => {
    // banner 族权威件独有 placeStyle（bannerStyleClassPs 类级回填）——别名后从蛇形键
    // 也能取到（影子件撤注册前此断言恒红,SW-BN1 清偿）
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_1615_banner_b1']].placeStyle).toBe(22);   // :19231 placeStyle=22+type-1615
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_5651_banner_b290']].placeStyle).toBe(313); // 1457 Item.cs:44398 DefaultToBanner(313)
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_2001_f2001']].placeStyle).toBe(8);        // 蝶族变体 1+2001-1994
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_2613_f2613']].tile).toBe('chest');        // createTile 21 双源回填
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_4851_GemTreeTopazSeed']].value).toBe(100); // 取后注册者（显式件）
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_4857_GemTreeAmberSeed']].placeStyle).toBe(6);
  });
});

describe('双键清理批次A：字段搬移抽验（键继续解析,语义保留）', () => {
  it('搬移抽验：挖掘力三件套（tool/axePower）落进注册 def', () => {
    // vi_579_drax：pick 200 + axe 22（VANILLA_TOOL_POWERS 源数据，曾只落在驼峰 def）。
    // 2026-08-22 F1 工具节奏修复：回填循环把 itemCombat 的 speed/useTime/damage/
    // knockback + 三力（pickPower/axePower/hammerPower）一并桥进 tool——此处按
    // Object.asymmetricMatch 抽核心力/节奏字段，不再钉全对象形状
    const drax = ITEM_DEFS[ITEM_BY_KEY['vi_579_drax']];
    expect(drax.tool).toMatchObject({ type: 'pick', power: 200, pickPower: 200, axePower: 22, useTime: 7, speed: 25 });
    expect(drax.axePower).toBe(22);
    // vi_122_molten_pickaxe：pick 100（SW-BN1 后 = 工具力块注册件,tool 经回填全量）
    const molten = ITEM_DEFS[ITEM_BY_KEY['vi_122_molten_pickaxe']];
    expect(molten.tool).toMatchObject({ type: 'pick', power: 100, useTime: 18, speed: 23 });
    // vi_1305_the_axe：hammer 100 + axe 35
    const axe = ITEM_DEFS[ITEM_BY_KEY['vi_1305_the_axe']];
    expect(axe.tool).toMatchObject({ type: 'hammer', power: 100, hammerPower: 100, axePower: 35, useTime: 7 });
    expect(axe.axePower).toBe(35);
  });

  it('搬移抽验：value / wireTool / 锚桩 tile 落进注册 def', () => {
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_109_mana_crystal']].value).toBe(1);
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_1291_life_fruit']].value).toBe(1);
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_509_red_wrench']].wireTool).toEqual({ place: 1 });
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_4379_wyvern_kite']].tile).toBe('v_723_kite_anchor');
    expect(ITEM_DEFS[ITEM_BY_KEY['vi_4375_rat']].tile).toBe('v_724_critter_anchor');
  });
});

// ★SW-RB8b 2026-09-09 判别力矩阵（六行注入,对象级内存变异——零 items.ts 触碰）：
//   把三锁分组算法（与上方模块级 defsByVid/defsByKeyStr/defsByStable 同式）跑在
//   变异副本上,证明三锁非同义反复且各有独占捕获域：
//     行1 同 vid 异键 vi_ 双 def        → 锁1红（锁3同红:vi_ 键 stable=key 内嵌 vid）
//     行2 同键串重复 def                → 锁2红（ITEM_BY_KEY 静默覆写类,4851-4857 同族）
//     行3 place_v_ 同 N 异键双 def      → 仅锁3红（20000+N 派生,vid/键串视角全盲=独占域）
//     行4 vi_ 键×PRIV 键同 stable 双 def → 仅锁3红（跨形态,vid 锁看不见 PRIV 键）
//     行5 stable 0 缺失 def             → 三锁全静默=盲窗（上方 stable-0 补钉锁专捕）
//     行6 vi_ 键 vid 谎报指向他档 def    → 域扫红（有权威反查时）/豁免集钉兜底（无反查时）
//   即「同 vid 分组=key 内嵌 vid 派生,与 stable id 分组会否漏不同形态的重复」的
//   实证回答：vi_ 域内两锁同构冗余,跨形态重复只有锁3可捕,缺派生键只有补钉可捕。
function groupingsOf(defs: ReadonlyArray<{ key: string }>, stable: ReadonlyArray<number>) {
  const byVid = new Map<number, number[]>();
  const byKey = new Map<string, number[]>();
  const byStable = new Map<number, number[]>();
  defs.forEach((d, i) => {
    const vm = /^vi_(\d+)_/.exec(d.key);
    if (vm) {
      const v = Number(vm[1]);
      if (!byVid.has(v)) byVid.set(v, []);
      byVid.get(v)!.push(i);
    }
    if (!byKey.has(d.key)) byKey.set(d.key, []);
    byKey.get(d.key)!.push(i);
    const s = stable[i];
    if (s) {
      if (!byStable.has(s)) byStable.set(s, []);
      byStable.get(s)!.push(i);
    }
  });
  const dupCount = (m: Map<unknown, number[]>): number => [...m.values()].filter((a) => a.length > 1).length;
  return {
    vidDup: dupCount(byVid),
    keyDup: dupCount(byKey),
    stableDup: dupCount(byStable),
  };
}

describe('SW-RB8b 判别力矩阵（六行注入,内存变异）', () => {
  it('行1-4：三锁各守独占捕获域（行3/4 仅 stable 锁可捕=第三视角独立性实证）', () => {
    // 行1 同 vid 异键 vi_ 双 def
    {
      const defs = [{ key: 'vi_777_alpha' }, { key: 'vi_777_beta' }];
      const g = groupingsOf(defs, [777, 777]);
      expect(g.vidDup).toBe(1);
      expect(g.stableDup).toBe(1);
      expect(g.keyDup).toBe(0);
    }
    // 行2 同键串重复（def 键同串;byKey 后写覆盖前写=静默覆写面）
    {
      const defs = [{ key: 'vi_888_dup' }, { key: 'vi_888_dup' }];
      const g = groupingsOf(defs, [888, 888]);
      expect(g.keyDup).toBe(1);
      expect(g.vidDup).toBe(1);
    }
    // 行3 place_v_ 同 N 异键双 def：键串不同/无 vi_ 前缀 → 只有 stable 视角红
    {
      const defs = [{ key: 'place_v_42_x' }, { key: 'place_v_42_y' }];
      const g = groupingsOf(defs, [20042, 20042]);
      expect(g.stableDup).toBe(1);
      expect(g.vidDup).toBe(0);
      expect(g.keyDup).toBe(0);
    }
    // 行4 vi_ 键 × PRIV 键 同 stable：跨形态,vid 锁对 PRIV 键不可见
    {
      const defs = [{ key: 'vi_901_vishape' }, { key: 'privshape_item' }];
      const g = groupingsOf(defs, [901, 901]);
      expect(g.stableDup).toBe(1);
      expect(g.vidDup).toBe(0);
      expect(g.keyDup).toBe(0);
    }
  });

  it('行5：stable 0 缺失 def 三锁全静默（=stable-0 补钉锁的立锁依据）', () => {
    const defs = [{ key: 'mystery_orphan' }, { key: 'mystery_orphan2' }];
    const g = groupingsOf(defs, [0, 0]);
    expect(g).toEqual({ vidDup: 0, keyDup: 0, stableDup: 0 });
    // 两件异键缺派生 def 并存,任何双 def 锁都不红——上方「stable id 全域可解析」
    // 断言是唯一防线（真实注册表若出现即红）。
  });

  it('行6：vi_ 键 vid 谎报 → 域扫红;无权威反查 → 豁免集单点钉兜底', () => {
    // 有权威反查：vi_56_lies 键值指向 vid 55 的权威 def（vid 56 另有真身键）→ 同靶比对失败
    {
      const defs = [{ key: 'vi_55_auth' }, { key: 'vi_56_auth' }, { key: 'vi_56_lies' }];
      const byKey: Record<string, number> = { vi_55_auth: 0, vi_56_auth: 1, vi_56_lies: 0 };   // 谎报键同靶 55 档
      const auth: Record<number, string> = { 55: 'vi_55_auth', 56: 'vi_56_auth' };
      const fail: string[] = [];
      for (const k of Object.keys(byKey)) {
        const m = /^vi_(\d+)_/.exec(k);
        if (!m) continue;
        const aKey = auth[Number(m[1])];
        if (aKey === undefined) continue;
        if (byKey[k] !== byKey[aKey]) fail.push(k);
      }
      expect(fail).toEqual(['vi_56_lies']);
    }
    // 无权威反查：域扫只能静默 continue → 由豁免集单点断言（恰 vi_4143_manacloakstar）
    // 拦「无界增长」——本仓真实表已钉（上方全域别名一致性域扫尾段）。
  });
});
