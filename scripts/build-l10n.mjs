// 构建语言包:tools/l10n/(原版 12 语言 × 7 分片)+ tools/l10n-custom/(自有文案)
// → game/public/l10n/<culture>.json(扁平 { [category]: { [key]: value } })+ index.json
// 并生成 game/src/i18n/idNames.generated.ts(id → 原版常量名,id-maps internal 字段)。
//
// 合并顺序(键级,后者覆盖前者,等价于原版 ReloadLanguage 的"英文兜底→目标语言"语义,
// LanguageManager.cs:102):en 7 分片 → custom en → custom <target> → <target> 7 分片。
// {$Key} 复制构建期展开;含 {? 的键剔除(见 l10n-merge.mjs)。
//
// 用法:node scripts/build-l10n.mjs [--cultures=zh-Hans,en-US] [--skip-idnames]
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLenient, flattenDeep, mergePacks, expandCopyCommands, stripConditionMarkers, validateTable } from './l10n-merge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(here, '..', '..', 'tools');
const L10N = join(TOOLS, 'l10n');
const CUSTOM = join(TOOLS, 'l10n-custom');
const OUT_DIR = join(here, '..', 'public', 'l10n');
const IDMAPS = join(TOOLS, 'id-maps');
const IDNAMES_OUT = join(here, '..', 'src', 'i18n', 'idNames.generated.ts');

// GameCulture.cs:67-121(枚举值 = LegacyId);displayNameKey = 各语言包 Language 类别自带本地化名
export const CULTURES = [
  { name: 'en-US', legacyId: 1, displayNameKey: 'Language.English' },
  { name: 'de-DE', legacyId: 2, displayNameKey: 'Language.German' },
  { name: 'it-IT', legacyId: 3, displayNameKey: 'Language.Italian' },
  { name: 'fr-FR', legacyId: 4, displayNameKey: 'Language.French' },
  { name: 'es-ES', legacyId: 5, displayNameKey: 'Language.Spanish' },
  { name: 'ru-RU', legacyId: 6, displayNameKey: 'Language.Russian' },
  { name: 'zh-Hans', legacyId: 7, displayNameKey: 'Language.Chinese' },
  { name: 'pt-BR', legacyId: 8, displayNameKey: 'Language.Portuguese' },
  { name: 'pl-PL', legacyId: 9, displayNameKey: 'Language.Polish' },
  { name: 'ja-JP', legacyId: 10, displayNameKey: 'Language.Japanese' },
  { name: 'ko-KR', legacyId: 11, displayNameKey: 'Language.Korean' },
  { name: 'zh-Hant', legacyId: 12, displayNameKey: 'Language.ChineseTraditional' },
];

const SHARDS = ['', '.Game', '.Items', '.Legacy', '.NPCs', '.Projectiles', '.Town'];

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--cultures='));
const skipIdnames = args.includes('--skip-idnames');
const selected = onlyArg
  ? onlyArg.slice('--cultures='.length).split(',').map((s) => s.trim()).filter(Boolean)
  : CULTURES.map((c) => c.name);
const selectedCultures = CULTURES.filter((c) => selected.includes(c.name));

function readShards(culture) {
  return SHARDS.map((s) => {
    const f = join(L10N, `${culture}${s}.json`);
    // ★开源仓 clone 修复（2026-11-02）：分片源在仓库外 tools/l10n/（G40 迁移）——
    //   clone 侧无此目录。缺分片时给出可行动指引而非裸路径（曾致 vibe-online
    //   yarn start:analyze 启动即崩）。产物 public/l10n 随仓跟踪,clone 侧勿重建。
    if (!existsSync(f)) {
      throw new Error(
        `缺 l10n 分片: ${f}\n`
        + `  分片源在仓库外 tools/l10n/（开源仓不含——见 C 档可移植注）。\n`
        + `  · clone/部署环境：产物 public/l10n/ 已随仓,无需重建,直接用即可;\n`
        + `    若 vite 侧仍报此错,说明 stale 守卫未生效（升 vite.config.ts l10nAuditAuto）。\n`
        + `  · 开发机：从内部仓同步 tools/l10n/ 分片目录后重跑。`);
    }
    return parseLenient(readFileSync(f, 'utf8'));
  });
}

function readCustom(culture) {
  const f = join(CUSTOM, `${culture}.json`);
  if (!existsSync(f)) return null;
  return flattenDeep(parseLenient(readFileSync(f, 'utf8')));
}

mkdirSync(OUT_DIR, { recursive: true });

// en 基线(7 分片 + custom en)。同语言分片间的键冲突才是真告警,
// en→target 的"冲突"是翻译 overlay 的预期语义,不报告。
function mergeShards(culture) {
  const { out, conflicts } = mergePacks(readShards(culture));
  return { out, conflicts: conflicts.map((c) => `[${culture}] ${c}`) };
}
const enMerged = mergeShards('en-US');
const customEn = readCustom('en-US');
const enPacks = customEn ? [enMerged.out, customEn] : [enMerged.out];
const enBase = mergePacks(enPacks).out;

const report = { conflicts: enMerged.conflicts, unresolved: [], stripped: [] };
const index = [];

for (const cult of selectedCultures) {
  let table;
  if (cult.name === 'en-US') {
    table = enBase;
  } else {
    const targetMerged = mergeShards(cult.name);
    report.conflicts.push(...targetMerged.conflicts);
    const customTarget = readCustom(cult.name);
    const packs = customTarget ? [enBase, customTarget, targetMerged.out] : [enBase, targetMerged.out];
    table = mergePacks(packs).out;
  }

  const { unresolved } = expandCopyCommands(table);
  report.unresolved.push(...unresolved.map((u) => `[${cult.name}] ${u}`));
  report.stripped.push(...stripConditionMarkers(table).map((r) => `${cult.name}|${r}`));
  // 形状闸门:类别含点/空键/非字符串值 = 裸键类 bug(顶层点分键曾被整键当类别),
  // 构建期直接失败,不产出坏包
  const shapeBad = validateTable(table);
  if (shapeBad.length) {
    throw new Error(`[l10n] ${cult.name} 产物形状违例 ${shapeBad.length} 条:\n  ${shapeBad.slice(0, 10).join('\n  ')}`);
  }

  const text = JSON.stringify(table);
  writeFileSync(join(OUT_DIR, `${cult.name}.json`), text);
  const bytes = Buffer.byteLength(text, 'utf8');
  index.push({ name: cult.name, legacyId: cult.legacyId, displayNameKey: cult.displayNameKey, bytes });
  const cats = Object.keys(table).length;
  const keys = Object.values(table).reduce((n, e) => n + Object.keys(e).length, 0);
  console.log(`build-l10n: ${cult.name} ${cats} 类别 ${keys} 键 ${(bytes / 1024).toFixed(0)}KB`);
}

index.sort((a, b) => a.legacyId - b.legacyId);
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index));

if (report.conflicts.length) console.warn(`[l10n] 同语言分片键冲突 ${report.conflicts.length} 条:\n  ` + report.conflicts.slice(0, 20).join('\n  '));
if (report.stripped.length) console.log(`[l10n] 剥离 {? 条件标记 ${report.stripped.length} 处(涉及类别: ${[...new Set(report.stripped.map((r) => r.replace(/^[^|]*\|/, '').split('.')[0]))].join(', ')})`);
if (report.unresolved.length) console.warn(`[l10n] {$} 未解析引用 ${report.unresolved.length} 条(保留原样):\n  ` + [...new Set(report.unresolved)].slice(0, 20).join('\n  '));

if (skipIdnames) {
  console.log('build-l10n: done');
} else {
  genIdNames();
  console.log('build-l10n: done (含 idNames.generated.ts)');
}

// ---- id → 原版常量名映射表生成 ----
function genIdNames() {
  const load = (f) => {
    const p = join(IDMAPS, f);
    if (!existsSync(p)) return {};
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const out = {};
    for (const [id, v] of Object.entries(d)) {
      if (v && typeof v.internal === 'string' && v.internal) out[Number(id)] = v.internal;
    }
    return out;
  };
  const write = (name, map) => {
    // 键一律引号化:projectiles 含负数 id(-65),裸写会是语法错误;
    // 值转义单引号(id-maps en 名含 "Jack 'O Lantern" 等)
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const body = Object.entries(map).map(([id, n]) => `  '${id}': '${esc(n)}',`).join('\n');
    return `export const ${name}: Record<number, string> = {\n${body}\n};\n`;
  };

  const items = load('items.json');
  const npcs = load('npcs.json');
  const buffs = load('buffs.json');
  const projectiles = load('projectiles.json');
  const tiles = load('tiles.json');
  const walls = load('walls.json');

  // ITEM_KEY_TO_ID:items.ts 的 key → vanilla id
  // ① vi_<id>_<slug> 直接取 id;② snake_case key 反推(internal PascalCase→snake)匹配
  const itemsSrc = readFileSync(join(here, '..', 'src', 'data', 'items.ts'), 'utf8');
  const keys = [...itemsSrc.matchAll(/key: '([a-z0-9_]+)'/g)].map((m) => m[1]);
  const internalSnake = new Map();
  for (const n of Object.values(items)) {
    internalSnake.set(n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(), 0);
  }
  const itemKeyToId = {};
  let matched = 0;
  // snake_case 推断失败的人工别名(本仓库 key → 原版物品 id)。
  // 全部有原版对应——名字一律走原版 12 语言译文,避免自造:
  //   platform→WoodPlatform(94) door→WoodenDoor(25) workbench→WorkBench(36) anvil→IronAnvil(35)
  //   mushroom_item→Mushroom(5) suspicious_eye→SuspiciousLookingEye(43)
  //   coin_copper/silver/gold→71/72/73 sandstone_block→Sandstone(3271) hardened_sand_block→HardenedSand(3272)
  //   table→WoodenTable(32) chair→WoodenChair(34) chandelier→CopperChandelier(106) lantern→ChainLantern(136)
  //   corrupt/crimson_grass_seeds→59/2171 minecart_item→Minecart(2343)
  const ITEM_KEY_ALIASES = {
    platform: 94, door: 25, workbench: 36, anvil: 35, mushroom_item: 5, suspicious_eye: 43,
    coin_copper: 71, coin_silver: 72, coin_gold: 73, sandstone_block: 3271, hardened_sand_block: 3272,
    table: 32, chair: 34, chandelier: 106, lantern: 136,
    corrupt_grass_seeds: 59, crimson_grass_seeds: 2171, minecart_item: 2343,
    // 第二批：药水/剑/工具/扳手（全部有原版对应；剑按挥砍阔剑系取 Broadsword）
    heal_potion: 188, agility_potion: 290, regen_potion: 289,
    wood_sword: 24, wood_hammer: 196,
    copper_sword: 3508, iron_sword: 4, silver_sword: 3514, gold_sword: 3520,
    tin_sword: 3502, lead_sword: 3496, tungsten_sword: 3490, platinum_sword: 3484,
    wand_of_sparking: 3069, amethyst_bolt: 739, red_wrench: 509,
    actuator_item: 849, grand_design: 3625, // The Grand Design 的 internal 名即 MulticolorWrench
  };
  for (const k of keys) {
    const vi = k.match(/^vi_(\d+)_/);
    if (vi) {
      const id = Number(vi[1]);
      if (items[id]) { itemKeyToId[k] = id; matched++; }
      continue;
    }
    if (ITEM_KEY_ALIASES[k] !== undefined && items[ITEM_KEY_ALIASES[k]]) {
      itemKeyToId[k] = ITEM_KEY_ALIASES[k]; matched++; continue;
    }
    const id = Number(Object.keys(items).find((id) => items[id].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase() === k));
    if (id) { itemKeyToId[k] = id; matched++; }
  }
  console.log(`[idNames] ITEM_KEY_TO_ID 匹配率 ${matched}/${keys.length}`);

  // TILE_NAME_ITEM_BY_SHEET:方块 sheet → 显示名来源物品 id。
  // 原版语义(1.4.4+):方块无独立显示名(Tiles 分节为空),方块名 = 放置它的物品
  // (Item.createTile 反查,TEdit items.json)。取该 sheet 最小物品 id(基础材质款优先);
  // 个别 sheet 人工指定(12 生命水晶 tile 取 LifeCrystal 29,而非 RepairedLifeCrystal)。
  const teditItemsPath = join(here, '..', '..', 'Terraria-Map-Editor', 'src', 'TEdit.Terraria', 'Data', 'items.json');
  const tileNameItem = {};
  if (existsSync(teditItemsPath)) {
    const teditItems = JSON.parse(readFileSync(teditItemsPath, 'utf8'));
    for (const it of teditItems) {
      if (it.createTile === undefined) continue;
      if (tileNameItem[it.createTile] === undefined || it.id < tileNameItem[it.createTile]) {
        tileNameItem[it.createTile] = it.id;
      }
    }
    const overrides = { 12: 29 }; // Heart → LifeCrystal
    for (const [t, id] of Object.entries(overrides)) tileNameItem[t] = id;
    console.log(`[idNames] TILE_NAME_ITEM_BY_SHEET ${Object.keys(tileNameItem).length} 条`);
  } else {
    console.warn('[idNames] TEdit items.json 缺失,TILE_NAME_ITEM_BY_SHEET 未生成');
  }

  // TILE_NAME_ZH/EN_BY_ID:id-maps 自带的方块 zh/en 名——第③级显示名回退。
  // 仅用于世界生成专属块（树/藤蔓/药草等无放置物品、MapObject 也没有的 tile：
  // 原版对它们没有 UI 显示名，这是唯一权威译名来源）。zh 系用 zh，其余语言英文兜底。
  const tileZh = {}, tileEn = {};
  const tilesRawPath = join(IDMAPS, 'tiles.json');
  if (existsSync(tilesRawPath)) {
    const tilesRaw = JSON.parse(readFileSync(tilesRawPath, 'utf8'));
    for (const [id, v] of Object.entries(tilesRaw)) {
      if (v?.zh) tileZh[id] = v.zh;
      if (v?.en) tileEn[id] = v.en;
    }
    console.log(`[idNames] TILE_NAME_ZH/EN_BY_ID ${Object.keys(tileZh).length}/${Object.keys(tileEn).length} 条`);
  }

  // ITEM_NAME_ZH/EN_BY_ID:id-maps 自带的物品 zh/en 名——l10n ItemName 缺译 id 的兜底
  const itemZh = {}, itemEn = {};
  const itemsRawPath = join(IDMAPS, 'items.json');
  if (existsSync(itemsRawPath)) {
    const itemsRaw = JSON.parse(readFileSync(itemsRawPath, 'utf8'));
    for (const [id, v] of Object.entries(itemsRaw)) {
      if (v?.zh) itemZh[id] = v.zh;
      if (v?.en) itemEn[id] = v.en;
    }
    console.log(`[idNames] ITEM_NAME_ZH/EN_BY_ID ${Object.keys(itemZh).length}/${Object.keys(itemEn).length} 条`);
  }

  // WALL_NAME_ITEM_BY_WALL:墙 sheet → 显示名来源物品 id（Item.createWall 反查,同 tile 语义）
  // + WALL_NAME_ZH/EN_BY_ID（id-maps walls.json 兜底——自然墙无放置物品）
  const wallNameItem = {}, wallZh = {}, wallEn = {};
  if (existsSync(teditItemsPath)) {
    const teditItems2 = JSON.parse(readFileSync(teditItemsPath, 'utf8'));
    for (const it of teditItems2) {
      if (it.createWall === undefined) continue;
      if (wallNameItem[it.createWall] === undefined || it.id < wallNameItem[it.createWall]) {
        wallNameItem[it.createWall] = it.id;
      }
    }
  }
  const wallsRawPath = join(IDMAPS, 'walls.json');
  if (existsSync(wallsRawPath)) {
    const wallsRaw = JSON.parse(readFileSync(wallsRawPath, 'utf8'));
    for (const [id, v] of Object.entries(wallsRaw)) {
      if (v?.zh) wallZh[id] = v.zh;
      if (v?.en) wallEn[id] = v.en;
    }
  }
  console.log(`[idNames] WALL 链 ${Object.keys(wallNameItem).length} placer / ${Object.keys(wallZh).length} zh`);

  const header = `// 本文件由 scripts/build-l10n.mjs 生成,勿手改。来源:tools/id-maps/*.json(1.4.5.6)。\n`;
  const body =
    write('ITEM_NAME_BY_ID', items) +
    write('NPC_NAME_BY_ID', npcs) +
    write('BUFF_NAME_BY_ID', buffs) +
    write('PROJECTILE_NAME_BY_ID', projectiles) +
    write('TILE_NAME_BY_ID', tiles) +
    write('WALL_NAME_BY_ID', walls) +
    write('TILE_NAME_ITEM_BY_SHEET', tileNameItem) +
    write('TILE_NAME_ZH_BY_ID', tileZh) +
    write('TILE_NAME_EN_BY_ID', tileEn) +
    write('ITEM_NAME_ZH_BY_ID', itemZh) +
    write('ITEM_NAME_EN_BY_ID', itemEn) +
    write('WALL_NAME_ITEM_BY_WALL', wallNameItem) +
    write('WALL_NAME_ZH_BY_ID', wallZh) +
    write('WALL_NAME_EN_BY_ID', wallEn) +
    `export const ITEM_KEY_TO_ID: Record<string, number> = ${JSON.stringify(itemKeyToId)};\n`;
  writeFileSync(IDNAMES_OUT, header + body);
}
