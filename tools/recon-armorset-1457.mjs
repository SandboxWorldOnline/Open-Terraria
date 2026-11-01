// recon-armorset-1457 —— 套装判定面三方对账闸门（BJ147 组D）。
// 只读零写入（--fix 除外）。三方：
//   ① 反编译真值 Terarria1457/Terraria.DataStructures/ArmorSetBonuses.cs
//      （Initialize :392-484 = 64 套注册表；Benefits.* :12-386 = 特效体；
//       Builder.Set :87-126 = 单三元组/选项数组笛卡尔积；TryCounting :189-199 =
//       非零位才计数 → legs=0 =「腿位不计」语义；GetCompleteSet :512-531 =
//       SetsContaining[head]→[body] 首命中——本仓单键 flat 模型等价性靠键集互斥证）
//      + Terraria/Item.cs SetDefaults DefaultToHeadgear/Body/Legs（id→槽序补漏机制;
//        5591-5593 渔夫二型槽面 BJ163 已入 itemstats（hs286/bs253/ls241）→ 现补漏
//        0 件,Item.cs :44009-44021 为其源码锚）
//      + Terraria/Player.cs GrantArmorBenefits（:13202-14052 = 单件面 if/switch 全链）。
//   ② 本仓面 src/data/vanillaArmorSets.ts（槽键 85 + 召唤并键 16 + ARMOR_SET_BONUSES_VID
//      vid 键 11）× src/data/vanillaSummonStats.ts（SUMMON_GEAR;SUMMON_SET 已并入单表）
//      × vanilla-itemstats.json × vanilla-accfx.json × Player.ts（统一前内联 vid 面
//      正则提取;统一后为空——两种形态归一化后对拍结果一致,双跑可对拍）。
//   ③ 判级：DRIFT（覆盖套的键集/数值/特效旗与本仓面不符 = 闸门红）/
//      BASELINE（登记债,组A/B/C 移交,不红）/ UNPORTED（原版有仓无,清单移交）。
// 用法：node tools/recon-armorset-1457.mjs            （在 game/ 下,只读对账）
//      node tools/recon-armorset-1457.mjs --fix      （vid 键标记块自动重放重写,先备份）
//      node tools/recon-armorset-1457.mjs --verbose  （逐套/逐 id 明细）
// 退出码：0 = DRIFT=0；1 = 有漂移或结构解析失败。
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const GAME = dirname(fileURLToPath(import.meta.url));       // .../game/tools
const ROOT = join(GAME, '..', '..');                        // SandboxWorld/
const argv = new Set(process.argv.slice(2));
const VERBOSE = argv.has('--verbose');
const FIX = argv.has('--fix');

let driftCount = 0;
const fail = (msg) => { console.error(`  ✗ DRIFT ${msg}`); driftCount++; };
const note = (msg) => console.log(`  · ${msg}`);
const detail = (msg) => { if (VERBOSE) console.log(`      ${msg}`); };
// ★BJ207 崩溃路径收口（2026-09-20,红蓝-N5）：结构解析失败（签名未找到/方法体未闭合/
//   ENOENT 等 throw 族）旧版以裸 Error 栈直接崩——exit 1 能拦但无干净汇总,且 §3 曾因
//   缺翻译行走 tr.lane 未捕获 TypeError 中断全量对账。uncaughtException 兜底=打印
//   CRASH 物证（栈顶 3 行,不吞错）+ 闸门红汇总 + exit 1（fail-closed 不变）。
process.on('uncaughtException', (e) => {
  const s = e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e);
  console.error(`\n  ✗ CRASH ${s.split('\n').slice(0, 3).join('\n    ')}`);
  console.error(`＝＝＝ recon-armorset-1457 ＝＝＝  CRASH 结构解析失败  DRIFT=${driftCount}  ✗ 闸门红`);
  process.exit(1);
});
/** 特效值等价（数组面深等——Snow buffImmune:[46,47] 等;标量走 ===） */
const fxEq = (a, b) => Array.isArray(a) || Array.isArray(b)
  ? JSON.stringify(a) === JSON.stringify(b) : a === b;

/** 取方法体（花括号配平;signature = 方法体内唯一前缀） */
function methodBody(src, signature) {
  const i = src.indexOf(signature);
  if (i < 0) throw new Error(`签名未找到: ${signature}`);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open + 1, j); }
  }
  throw new Error(`方法体未闭合: ${signature}`);
}

// ============================================================
// §1a 反编译 ArmorSetBonuses.cs → 注册表重放
// ============================================================
const csPath = join(ROOT, 'Terarria1457', 'Terraria.DataStructures', 'ArmorSetBonuses.cs');
const cs = readFileSync(csPath, 'utf8');

/** 顶层逗号切分（`{...}`/`[...]` 内逗号不切——Builder.Set(int[],int[],int[]) 数组形） */
function splitTopLevel(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** `new int[N] { a, b }` / `123` → 数组 */
function parseSetArg(raw) {
  const s = raw.trim();
  const arr = s.match(/new\s+int\[\d*\]\s*\{([^}]*)\}/);
  if (arr) return arr[1].split(',').map((x) => parseInt(x.trim(), 10));
  return [parseInt(s, 10)];
}

const initBody = methodBody(cs, 'public static void Initialize()');
const SETS = [];   // { name, textKey, line, triplets:[[h,b,l],...] }（注册序）
{
  const chainRe = /Create\(Benefits\.(\w+),\s*"([^"]+)"(?:,\s*ArmorSetBonus\.PartType\.(\w+))?\)((?:\s*\.Set\(([^)]*)\))*)\s*\.Add\(\)/g;
  for (const m of initBody.matchAll(chainRe)) {
    const [, name, textKey, , setsClause] = m;
    const triplets = [];
    for (const sm of setsClause.matchAll(/\.Set\(([^)]*)\)/g)) {
      const parts = splitTopLevel(sm[1]).map(parseSetArg);   // 顶层逗号切分({} 内逗号保护——int[] 数组形)
      for (const h of parts[0]) for (const b of parts[1]) for (const l of parts[2]) {
        triplets.push([h, b, l]);
      }
    }
    SETS.push({ name, textKey, triplets });
  }
  const addRe = /\bAdd\(Benefits\.(\w+),\s*"([^"]+)"(?:,\s*ArmorSetBonus\.PartType\.(\w+))?,\s*(\d+),\s*(\d+),\s*(\d+)\)/g;
  for (const m of initBody.matchAll(addRe)) {
    SETS.push({ name: m[1], textKey: m[2], triplets: [[+m[4], +m[5], +m[6]]] });   // 组号:1名/2键/3PartType/4-6三元组
  }
  for (const s of SETS) {
    const re = new RegExp(`(Create|Add)\\(Benefits\\.${s.name}\\b`);
    const m = cs.match(re);
    s.line = m && m.index !== undefined ? cs.slice(0, m.index).split('\n').length : -1;
  }
}
console.log(`[1] ArmorSetBonuses.Initialize 重放：${SETS.length} 套 / ${SETS.reduce((n, s) => n + s.triplets.length, 0)} 三元组（Terraria.DataStructures/ArmorSetBonuses.cs）`);
if (SETS.length !== 64) fail(`注册表套数 ${SETS.length} ≠ 64（Initialize 结构变更,先核对反编译树）`);
const dupNames = SETS.map((s) => s.name).filter((n, i, a) => a.indexOf(n) !== i);
if (dupNames.length) fail(`注册表重名：${[...new Set(dupNames)].join(',')}`);

// ---- Benefits.* 特效体 → 本仓字段（机械翻译;行号锚 = ArmorSetBonuses.cs Benefits 段）----
// lane: 缺省 slot=槽键单表 / 'vid'=vid 键单表。base: 登记债（本仓缺面,组A）。summon: 召唤并键面。
const SET_EFFECTS = {
  MetalTier1: { fx: { def: 2 } },                                   // :367-370
  MetalTier2: { fx: { def: 3 } },                                   // :362-365
  Platinum: { fx: { def: 4 } },                                     // :357-360
  Gladiator: { fx: { noKnockback: true } },                         // :329-332
  Ninja: { fx: { move: 0.2 } },                                     // :334-337
  Fossil: { fx: { ammoCost80: true } },                             // :339-342
  Necro: { fx: { critRanged: 10 }, repoName: 'Bone' },              // :344-347
  Wizard: { fx: { critMagic: 10 }, base: ['袍槽键 7 缺(只亮 1282/bs58)', 'legs=0 空腿语义缺(仓 `*` 需腿件在场)'] },  // :304-307
  ShadowScale: { fx: { runAccMul: 1.75, maxRunMul: 1.15, runSlowMul: 1.75 }, base: ['混搭 6 组合槽键缺(纯 2/8 亮)'] },  // :314-317
  BeetleDamage: { lane: 'vid', fx: { beetleOff: true }, note: 'ApplySetBonus_BeetleDamage(Player.cs :16561+)' },   // :324-327
  BeetleDefense: { lane: 'vid', fx: { beetleDef: true }, note: 'ApplySetBonus_BeetleDefense' },                    // :319-322
  Crimson: { lane: 'vid', fx: { crimsonRegen: true } },             // :250-253
  SpectreHealing: { fx: { ghostHeal: true, dmgMagic: -0.4 } },      // :255-259
  SpectreDamage: { fx: { ghostHurt: true } },                       // :261-264
  Meteor: { lane: 'vid', fx: { spaceGun: true } },                  // :266-269
  Frost: { fx: { frostBurn: true, dmgMelee: 0.1, dmgRanged: 0.1 } },// :271-276
  Jungle: { fx: { manaCostOff: 0.16 }, note: '★BJ742-A R20-②：manaCost-=0.16 归加算池（与钴/秘银/精金牌同键形）——旧译乘区键 0.84=「单源等价」自欺式近似,与 223/钴秘银精金并戴即露馅(0.9×0.84≠1-0.06-0.16)' },  // :278-281
  Molten: { fx: { dmgMelee: 0.1, fireWalk: true }, note: 'buffImmune[24] 走 name==="Molten" 特支(Player.ts :2462)' },  // :283-291
  ChlorophyteMelee: { fx: { crystalLeaf: true, endurance: 0.05 } }, // :129-134
  ChlorophyteSummon: { fx: { crystalLeaf: true }, summon: { slot: 2 } },  // :136-141(SUMMON_SET 并键)
  Chlorophyte: { fx: { crystalLeaf: true } },                       // :143-147
  Angler: { fx: { anglerSet: true }, note: '5591-5593 未注册债 BJ163 已销（atlas vanilla.json Captain Hat/Vest/Pants+itemstats 槽+legacyIndex/idNames/l10n 全在;单件 fish:5=活面）' },  // :149-152
  Cactus: { lane: 'vid', fx: { cactusThorns: true } },              // :154-157(getter 收编)
  // ★BJ745 A02（issue#35）：双 lane——vid 键承载 turtleThorns 行为旗（Player.ts
  //  turtleSet getter→反伤 ×2 覆写）+ slotFx 承载 sb 槽键面 endurance 0.15
  //  （ArmorSetBonuses.cs:160 `endurance += 0.15f`→equipStats.enduranceEq→damage
  //  ×(1−endurance)）;thorns=1f 被消费端覆写 2 等价不承载。
  Turtle: { lane: 'vid', fx: { turtleThorns: true }, slotFx: { endurance: 0.15 }, note: 'thorns=1 被消费端覆写 2 等价(Game :39102 turtleSet?2:thorns)' },  // :159-164(getter 收编+槽键 sb 面)
  Palladium: { fx: { onHitRegen: true } },                          // :212-215
  Orichalcum: { fx: { onHitPetal: true } },                         // :217-220
  Titanium: { fx: { titaniumStorm: true } },                        // :222-225
  HallowedSummoner: { fx: { onHitDodge: true }, summon: { slot: 2 } },    // :227-231(SUMMON_SET 并键)
  Hallowed: { fx: { onHitDodge: true } },                           // :233-236
  Solar: { fx: { endurance: 0.12, solar: true, dashType: 3 }, note: 'ApplySetBonus_Solar Player.cs :16481-16537' },  // :37-40
  Vortex: { lane: 'vid', fx: { vortexSet: true } },                 // :42-45
  Nebula: { lane: 'vid', fx: { nebulaSet: true }, base: ['nebulaCD-- 未建模(:47-54)'] },
  Stardust: { summon: { guardian: true }, note: 'ApplySetBonus_Stardust 行为型(守护者)' },  // :56-59
  Tiki: { summon: { slot: 1, whipRange: 0.2 } },                    // :12-16
  Spooky: { summon: { dmg: 0.25 } },                                // :18-21
  Bee: { summon: { dmg: 0.1 }, note: 'Achievement 特支(:26-29)不建模' },  // :23-30
  Spider: { summon: { dmg: 0.12 } },                                // :32-35
  SquireTier2: { summon: { sentry: 1, squireT2: true } },           // :68-72
  ApprenticeTier2: { summon: { sentry: 1, apprenticeT2: true } },   // :74-78
  HuntressTier2: { summon: { sentry: 1, huntressT2: true } },       // :80-84
  MonkTier2: { summon: { sentry: 1, monkT2: true } },               // :86-90
  SquireTier3: { summon: { sentry: 1, squireT3: true, squireT2: true } },        // :92-97
  ApprenticeTier3: { summon: { sentry: 1, apprenticeT3: true, apprenticeT2: true } },  // :99-104
  HuntressTier3: { summon: { sentry: 1, huntressT3: true, huntressT2: true } },  // :106-111
  MonkTier3: { summon: { sentry: 1, monkT3: true, monkT2: true } },              // :113-118
  ObsidianOutlaw: { summon: { dmg: 0.15, whipRange: 0.3, whipSpd: 1 / 1.15 } },  // :120-127
  Shroomite: { lane: 'vid', fx: { shroomiteSet: true } },           // :372-375
  AshWood: { fx: { ashWood: true } },                               // :382-385
  // ★红蓝-M 工具解冻（2026-09-18）：组A/B 已落表 15 套移出 UNPORTED——Benefits 体亲读
  // （行号锚 = ArmorSetBonuses.cs;注册链锚 :396-465）。翻译按仓表既有约定:
  // manaCost 正向折扣池（manaCostOff）/pickSpeed 正速/buffImmune 数组（比较走 fxEq 深等）。
  Wood: { fx: { def: 1 } },                                         // :377-381 statDefense++（链 :396-402 七三元组）
  Pumpkin: { fx: { dmgMelee: 0.1, dmgRanged: 0.1, dmgMagic: 0.1, dmgMinion: 0.1 } },  // :349-356 四伤+10%（Add :411）
  MagicHat: { fx: { mana: 60 } },                                   // :309-312 statManaMax2+=60（legs=0 通配×8 :425-432）
  Snow: { fx: { buffImmune: [46, 47] } },                           // :293-298 buffImmune[46=Frozen][47=Chilled]（笛卡尔 :440）
  Mining: { fx: { pickSpeed: 0.1 } },                               // :299-303 pickSpeed-=0.1→仓正速约定（笛卡尔 :441）
  CobaltCaster: { fx: { manaCostOff: 0.14 } },                      // :166-170 manaCost-=0.14（Add :448）
  CobaltMelee: { fx: { meleeSpd: 0.15 } },                          // :171-175 meleeSpeed+=0.15（Add :449）
  CobaltRanged: { fx: { ammoCost80: true } },                       // :176-180（Add :450）
  MythrilCaster: { fx: { manaCostOff: 0.17 } },                     // :181-185 manaCost-=0.17（Add :451）
  MythrilMelee: { fx: { critMelee: 10 } },                          // :186-190 meleeCrit+=10（Add :452）
  MythrilRanged: { fx: { ammoCost80: true } },                      // :191-195（Add :453）
  AdamantiteCaster: { fx: { manaCostOff: 0.19 } },                  // :196-200 manaCost-=0.19（Add :454）
  AdamantiteMelee: { fx: { meleeSpd: 0.2, move: 0.2 } },            // :201-206 双速+=0.2（Add :455）
  AdamantiteRanged: { fx: { ammoCost75: true } },                   // :207-211（Add :456）
  CrystalAssassin: { fx: { dmgMelee: 0.1, dmgRanged: 0.1, dmgMagic: 0.1, dmgMinion: 0.1,
    critMelee: 10, critRanged: 10, critMagic: 10, dashType: 5 } },  // :238-247 四伤三暴+水晶冲刺（textKey=CrystalNinja :465）
  // ★组C 终盘（2026-09-18）禁戒套移出 UNPORTED——Benefits.Forbidden :61-65 = 纯行为型
  // （setForbidden+UpdateForbiddenSetLock+光照;无数值面）,engine = Player.ts setForbidden
  // 挂点 + entities/ForbiddenSignProj.ts（弹 656 Ancient Storm）
  Forbidden: { fx: { forbidden: true }, note: 'Benefits.Forbidden :61-65 行为型（Player.cs :57434-57670 指令/锁定/瞄准链）' },  // :61-65(:474)
};
// 未移植套显式声明（闸门对「漏移植」保持显式感知;移植后须从本表移除）。
// ★红蓝-M 工具解冻（2026-09-18）：组A/B 15 套（Wood/Pumpkin/MagicHat/Snow/Mining/
// 钴·秘银·精金九套/CrystalAssassin）已全部落表并纳入 §2 对拍——本表归零，
// 对拍面 = 全 64 套（BJ156 落刀正确性自此被本工具持续看护）。
const UNPORTED = new Set();
for (const name of UNPORTED) if (!SETS.some((s) => s.name === name)) fail(`UNPORTED 表含未知名 ${name}`);
for (const s of SETS) {
  if (!UNPORTED.has(s.name) && !SET_EFFECTS[s.name]) fail(`套 ${s.name} 缺特效翻译行（SET_EFFECTS）`);
}

// ============================================================
// §1b id→槽序（itemstats 权威 + Item.cs DefaultTo* 补漏）
// ============================================================
const itemstats = JSON.parse(readFileSync(join(GAME, '..', 'src', 'data', 'vanilla-itemstats.json'), 'utf8'));
const SLOT_OF = new Map();
for (const [vid, s] of Object.entries(itemstats)) {
  if (s && s.s) SLOT_OF.set(+vid, { hs: s.hs, bs: s.bs, ls: s.ls });
}
{
  const itemCs = readFileSync(join(ROOT, 'Terarria1457', 'Terraria', 'Item.cs'), 'utf8');
  // 锚：case 5591（渔夫二型,itemstats 缺槽的补漏代表）→ 回溯其所在 SetDefaults
  const anchor = itemCs.indexOf('case 5591:');
  if (anchor < 0) throw new Error('Item.cs 未找到 case 5591 锚');
  const sigIdx = itemCs.lastIndexOf('SetDefaults()', anchor);
  const body = methodBody(itemCs, itemCs.slice(sigIdx, sigIdx + 30));
  let curCases = [], itemstatsPatch = 0;
  for (const line of body.split('\n')) {
    const cm = line.match(/^\s*case (\d+):/);
    if (cm) { curCases.push(+cm[1]); continue; }
    if (/^\s*break;\s*$/.test(line)) { curCases = []; continue; }
    const dm = line.match(/DefaultTo(Headgear|Body|Legs)\s*\([^)]*,\s*(\d+)\s*\)/);
    if (dm && curCases.length) {
      const slotKey = dm[1] === 'Headgear' ? 'hs' : dm[1] === 'Body' ? 'bs' : 'ls';
      for (const id of curCases) {
        const rec = SLOT_OF.get(id) ?? {};
        if (rec[slotKey] !== undefined && rec[slotKey] !== +dm[2]) {
          fail(`Item.cs SetDefaults ${id} ${slotKey}=${dm[2]} 与 itemstats ${rec[slotKey]} 冲突`);
        }
        if (rec[slotKey] === undefined) itemstatsPatch++;
        SLOT_OF.set(id, { ...rec, [slotKey]: +dm[2] });
      }
    }
  }
  note(`id→槽：itemstats ${SLOT_OF.size - itemstatsPatch} 件 + Item.cs DefaultTo* 补漏 ${itemstatsPatch} 件（5591-5593=hs286/bs253/ls241 :44009-21）`);
}
const slotKeyOf = (trip) => {
  const [h, b, l] = trip.map((id) => SLOT_OF.get(id));
  const hs = h?.hs, bs = b?.bs, ls = l?.ls;
  if (hs === undefined || bs === undefined) return null;
  // legs=0 =「腿位不计」语义（TryCounting :189-199 非零位才计数）→ `*` 通配
  return trip[2] === 0 ? `${hs}|${bs}|*` : (ls === undefined ? null : `${hs}|${bs}|${ls}`);
};

// ============================================================
// §2 本仓面装载（TS transpile 直调——数据表零运行时依赖,import type 已擦除）
// ============================================================
const require_ = createRequire(import.meta.url);
function loadTs(rel) {
  const ts = require_('typescript');
  const src = readFileSync(join(GAME, '..', rel), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, () => ({}));
  return m.exports;
}
const armorSets = loadTs('src/data/vanillaArmorSets.ts');
const summonStats = loadTs('src/data/vanillaSummonStats.ts');
const ARMOR_SET_BONUSES = armorSets.ARMOR_SET_BONUSES ?? {};
const VID_TABLE = armorSets.ARMOR_SET_BONUSES_VID ?? null;   // 统一后 vid 面唯一承载
const DD2_PIECE_FX = armorSets.DD2_PIECE_FX ?? {};
const SUMMON_GEAR = summonStats.SUMMON_GEAR ?? {};
const SUMMON_SET = summonStats.SUMMON_SET ?? null;           // 统一前独立表（兼容校验）

// Player.ts 内联 vid 面（统一前形态）——统一后全空
const playerTs = readFileSync(join(GAME, '..', 'src', 'entities', 'Player.ts'), 'utf8');
const LEGACY_VID = [];
{
  const pats = [
    [/if \(hVid === (\d+) && bVid === (\d+) && lVid === (\d+)\) crimsonRegen = true;/, 'crimsonRegen'],
    [/shroomiteSet = \(hVid >= (\d+) && hVid <= (\d+)\) && bVid === (\d+) && lVid === (\d+);/, 'shroomiteSet'],
    [/vortexSet = hVid === (\d+) && bVid === (\d+) && lVid === (\d+);/, 'vortexSet'],
    [/nebulaSet = hVid === (\d+) && bVid === (\d+) && lVid === (\d+);/, 'nebulaSet'],
    [/spaceGun = hVid === (\d+) && bVid === (\d+) && lVid === (\d+);/, 'spaceGun'],
    [/beetleOff = hVid === (\d+) && bVid === (\d+) && lVid === (\d+);/, 'beetleOff'],
    [/beetleDef = hVid === (\d+) && bVid === (\d+) && lVid === (\d+);/, 'beetleDef'],
  ];
  for (const [re, flag] of pats) {
    const m = playerTs.match(re);
    if (!m) continue;
    if (flag === 'shroomiteSet') {
      for (let h = +m[1]; h <= +m[2]; h++) LEGACY_VID.push({ key: `${h}|${m[3]}|${m[4]}`, fx: { shroomiteSet: true } });
    } else LEGACY_VID.push({ key: `${m[1]}|${m[2]}|${m[3]}`, fx: { [flag]: true } });
  }
}
const GETTER_SLOTS = [];
for (const [getter, flag] of [['turtleSet', 'turtleThorns'], ['cactusSet', 'cactusThorns']]) {
  const m = playerTs.match(new RegExp(`get ${getter}[\\s\\S]*?s0\\?\\.hs === (\\d+) && s1\\?\\.bs === (\\d+) && s2\\?\\.ls === (\\d+)`));
  if (m) GETTER_SLOTS.push({ getter, flag, slots: [+m[1], +m[2], +m[3]] });
}

const repoVidEntries = new Map();
for (const [key, entry] of Object.entries(VID_TABLE ?? {})) repoVidEntries.set(key, entry);
for (const { key, fx } of LEGACY_VID) {
  if (repoVidEntries.has(key)) fail(`vid 键 ${key} 单表与 Player.ts 内联双载（统一残留）`);
  else repoVidEntries.set(key, { ...fx, name: `(legacy:${key})` });
}
// 形态判定：UNIFIED = vid 键已入单表导出且 SUMMON_SET 不再独立导出（统一后）。
// 统一前（legacy 形态）：vid 面 = Player.ts 内联 + getter 槽检;召唤面 = SUMMON_SET 独立表——
// 对拍按各形态归一（PENDING-UNIFY 项单独计数,不算 DRIFT）——双跑报告键集一致可对拍。
const UNIFIED = VID_TABLE !== null && SUMMON_SET === null;
console.log(`    形态：${UNIFIED ? 'UNIFIED（单表统一后）' : 'LEGACY（统一前——SUMMON_SET 独立/vid 内联/getter 槽检）'}`);
let pendingUnify = 0;
const pend = (msg) => { pendingUnify++; detail(`PENDING-UNIFY ${msg}`); };

// ============================================================
// §3 套装级对拍
// ============================================================
const SUMMON_FIELDS = ['slot', 'sentry', 'dmg', 'whipRange', 'whipSpd', 'guardian',
  'huntressT2', 'huntressT3', 'squireT2', 'apprenticeT2', 'monkT2',
  'squireT3', 'apprenticeT3', 'monkT3'];
const hasSummonFx = (e) => SUMMON_FIELDS.some((f) => e?.[f] !== undefined);
const isSummonOnly = (e) => e?.summonSetOnly === true;

console.log(`\n[2] 套装面对拍（键集/数值/特效旗;槽键 ${Object.keys(ARMOR_SET_BONUSES).length} + vid 键 ${repoVidEntries.size}）`);
const claimedSlotKeys = new Map();   // 槽键 → [套名]（GetCompleteSet 单键模型互斥性证伪）
const unportedReport = [], partialReport = [];
const covCount = { slotFull: 0, vidKeys: 0, summonKeys: 0 };
for (const set of SETS) {
  const name = set.name;
  if (UNPORTED.has(name)) { unportedReport.push(name); continue; }
  const tr = SET_EFFECTS[name];
  if (!tr) continue;   // ★BJ207:缺翻译行已在 §1a 尾 fail 登记（「缺特效翻译行」）——旧版此处
                       // tr.lane 裸 TypeError 中断全量对账;跳过让其余套照常对拍,末尾干净汇总
  const expSlot = new Map(), expVid = new Map();
  for (const trip of set.triplets) {
    if (tr.lane === 'vid') {
      expVid.set(trip.join('|'), trip);
      // ★BJ745 A02：vid 主 lane + slotFx 并道（Turtle endurance sb 面）——槽键照常入
      // expSlot,由 slot lane 环按 slotFx 对拍
      if (tr.slotFx) {
        const sk = slotKeyOf(trip);
        if (sk !== null) expSlot.set(sk, trip);
      }
    } else {
      const key = slotKeyOf(trip);
      if (key === null) { fail(`${name} 三元组 ${trip} 槽真值缺失`); continue; }
      expSlot.set(key, trip);
    }
  }
  // vid lane
  for (const key of expVid.keys()) {
    const got = repoVidEntries.get(key);
    if (!got) {
      if (!UNIFIED && (name === 'Cactus' || name === 'Turtle')) pend(`${name} vid 键 ${key} 未入单表（统一前由 getter 槽检承载）`);
      else fail(`${name} vid 键 ${key} 缺（单表 ARMOR_SET_BONUSES_VID/统一前 Player.ts 内联）`);
      continue;
    }
    for (const [f, v] of Object.entries(tr.fx ?? {})) {
      if (!fxEq(got[f], v)) fail(`${name} vid 键 ${key} 特效 ${f}=${got[f]} ≠ 原版翻译 ${v}`);
    }
    covCount.vidKeys++;
    detail(`${name} vid ${key} ✓`);
  }
  // slot lane（含并键套的 sb 通道面;纯召唤套 tr.fx 空 → 由下方 summon-only 环对拍）
  if (expSlot.size) {
    let present = 0; const missing = [];
    for (const key of expSlot.keys()) {
      if (claimedSlotKeys.has(key)) claimedSlotKeys.get(key).push(name);
      else claimedSlotKeys.set(key, [name]);
      const slotFace = tr.lane === 'vid' ? tr.slotFx : tr.fx;   // ★BJ745 A02：vid 套 sb 面走 slotFx
      if (!slotFace || !Object.keys(slotFace).length) continue;   // 召唤专属套不走 sb 通道检查
      const rec = ARMOR_SET_BONUSES[key];
      if (!rec) { missing.push(key); continue; }
      if (isSummonOnly(rec)) { fail(`${name} 键 ${key} 被标 summonSetOnly（sb 通道漏亮）`); continue; }
      present++;
      for (const [f, v] of Object.entries(slotFace ?? {})) {
        if (!fxEq(rec[f], v)) fail(`${name} ${key} 特效 ${f}=${rec[f]} ≠ 原版翻译 ${v}`);
      }
      if (tr.summon) {
        const src = UNIFIED ? rec : SUMMON_SET?.[key];
        if (!src) { pend(`${name} ${key} 召唤面未并键（统一后须同条目承载）`); }
        else {
          if (UNIFIED && !hasSummonFx(rec)) fail(`${name} ${key} 召唤并键面缺`);
          for (const [f, v] of Object.entries(tr.summon)) {
            if (src[f] !== v) fail(`${name} ${key} 召唤面 ${f}=${src[f]} ≠ 原版 ${v}`);
          }
        }
      } else if (hasSummonFx(rec)) {
        fail(`${name} ${key} 不应有召唤面（原版无此套召唤位——双记风险）`);
      }
      detail(`${name} slot ${key} ✓`);
    }
    if (present === expSlot.size) covCount.slotFull++;
    else if (!tr.base) for (const k of missing) {
      if (!UNIFIED && !tr.fx) pend(`${name} 槽键 ${k} 未入单表（统一前由 SUMMON_SET 承载）`);
      else fail(`${name} 槽键 ${k} 缺（未登记 baseline）`);
    }
    if (missing.length) partialReport.push(`${name}: ${present}/${expSlot.size} 键${tr.base ? `（登记:${tr.base.join(';')}）` : ''} 缺=${missing.join(',')}`);
  }
}
// 召唤专属套（Tiki/Spooky/Bee/Spider/Stardust/DD2×8/ObsidianOutlaw）——键对拍
for (const set of SETS) {
  const tr = SET_EFFECTS[set.name];
  if (!tr?.summon || (tr.fx && Object.keys(tr.fx).length)) continue;
  for (const trip of set.triplets) {
    const key = slotKeyOf(trip);
    if (key === null) { fail(`${set.name} 三元组 ${trip} 槽真值缺失`); continue; }
    const rec = ARMOR_SET_BONUSES[key];
    if (!UNIFIED) { if (!rec) pend(`${set.name} 召唤键 ${key} 未入单表（统一前由 SUMMON_SET 承载）`); }
    else {
      if (!rec) { fail(`${set.name} 召唤键 ${key} 缺`); continue; }
      if (!isSummonOnly(rec)) fail(`${set.name} 召唤键 ${key} 未标 summonSetOnly（setBonus 文本面将误亮）`);
    }
    const src = UNIFIED ? rec : (SUMMON_SET?.[key] ?? rec);
    if (!src) continue;
    for (const [f, v] of Object.entries(tr.summon)) {
      if (src[f] !== v) fail(`${set.name} ${key} 召唤面 ${f}=${src[f]} ≠ 原版 ${v}`);
    }
    if (rec && UNIFIED) covCount.summonKeys++;
    detail(`${set.name} summon ${key} ✓`);
  }
}
for (const [key, names] of claimedSlotKeys) {
  if (names.length > 1) fail(`槽键 ${key} 被多套声明（${names.join(',')}）——flat 单键模型歧义`);
}
// getter 收编等价性：turtle/cactus 槽三元组全碰撞普查（异 vid 同三槽 = vid 化改判定面）
{
  const vidGetterSets = SETS.filter((s) => SET_EFFECTS[s.name]?.lane === 'vid'
    && ['Turtle', 'Cactus'].includes(s.name));
  for (const set of vidGetterSets) {
    const trip = set.triplets[0];
    const fullCollide = [...SLOT_OF.entries()].filter(([vid, s]) =>
      !set.triplets.flat().includes(vid)
      && (s.hs ?? -1) === (SLOT_OF.get(trip[0])?.hs ?? -2)
      && (s.bs ?? -1) === (SLOT_OF.get(trip[1])?.bs ?? -2)
      && (s.ls ?? -1) === (SLOT_OF.get(trip[2])?.ls ?? -2));
    if (fullCollide.length) fail(`${set.name} 槽三元组有异 vid 占用（vid 化改判定面）: ${fullCollide.map((v) => v[0])}`);
    else detail(`${set.name} 槽检→vid 等价（全三元组零碰撞）`);
  }
}
// 统一前 getter 槽键面与 vid 键面一致性（槽键 = 三元组槽值回查）
for (const g of GETTER_SLOTS) {
  const set = SETS.find((s) => SET_EFFECTS[s.name]?.fx?.[g.flag]);
  if (!set) continue;
  const trip = set.triplets[0];
  const expSlots = trip.map((id) => {
    const s = SLOT_OF.get(id);
    return s ? (s.hs ?? s.bs ?? s.ls) : -9;
  });
  if (expSlots.some((v, i) => v !== g.slots[i])) {
    fail(`getter ${g.getter} 槽键 ${g.slots} ≠ ${set.name} 三元组槽值 ${expSlots}`);
  } else detail(`getter ${g.getter} 槽键 ${g.slots.join('/')} = ${set.name} 槽值 ✓`);
}
// SUMMON_SET 兼容形态（统一后若仍独立导出 = 并键残留 → 漂移）
if (SUMMON_SET && UNIFIED) {
  for (const [key, entry] of Object.entries(SUMMON_SET)) {
    const merged = ARMOR_SET_BONUSES[key];
    if (!merged) { fail(`SUMMON_SET 键 ${key} 不在单表（并键残留）`); continue; }
    for (const f of SUMMON_FIELDS) {
      if (entry[f] !== undefined && merged[f] !== entry[f]) fail(`SUMMON_SET ${key} ${f} 与单表不一致`);
    }
  }
}
console.log(`  覆盖：槽键全亮 ${covCount.slotFull} 套 / vid 键 ${covCount.vidKeys} 条 / summonOnly 键 ${covCount.summonKeys} 条 / PENDING-UNIFY ${pendingUnify} 项${UNIFIED ? '' : '（统一后归零）'}`);
for (const u of unportedReport) detail(`UNPORTED ${u}（原版有、仓无——组A 移交）`);
for (const p of partialReport) note(`PARTIAL ${p}`);

// ============================================================
// §4 单件面对拍（GrantArmorBenefits → 仓四载体并集）
// ============================================================
const PIECE_FIELD = {
  maxTurrets: 'sentry', manaCost: 'manaCostOff', magicDamage: 'dmgMagic', minionDamage: 'dmgMinion',
  magicCrit: 'critMagic', moveSpeed: 'move', lifeRegen: 'life', meleeDamage: 'dmgMelee',
  meleeCrit: 'critMelee', meleeSpeed: 'meleeSpd', rangedDamage: 'dmgRanged', rangedCrit: 'critRanged',
  statManaMax2: 'mana', aggro: 'aggro', maxMinions: 'slot', whipRangeMultiplier: 'whipRange',
  fishingSkill: 'fish', armorPenetration: 'armorPen',
};
const PIECE_FLAG = new Set(['deadMansSweater', 'accDivingHelm', 'flowerBoots', 'moonLordLegs', 'slowFall', 'canFloatInWater', 'nightVision']);
const PIECE_AMMO = { ammoCost80: 'cost80', huntressAmmoCost90: 'huntress', chloroAmmoCost80: 'chloro', ammoCost75: 'cost75' };

const gabSig = 'private void GrantArmorBenefits(Item armorPiece)';
const gabFull = readFileSync(join(ROOT, 'Terarria1457', 'Terraria', 'Player.cs'), 'utf8');
const gabStart = gabFull.indexOf(gabSig);
const gabBody = methodBody(gabFull, gabSig);
const gabLine = gabFull.slice(0, gabStart).split('\n').length;
console.log(`\n[3] 单件面重放：GrantArmorBenefits :${gabLine}（Terraria/Player.cs）`);

const PIECES = new Map();
const LOCAL_VARS = new Map();   // `int num = 5;` 局部常量（3212 armorPenetration += num）
const addPiece = (id) => { if (!PIECES.has(id)) PIECES.set(id, { fx: {}, flags: new Set(), quirks: new Set() }); return PIECES.get(id); };
function applyStmt(p, stmt) {
  const decl = stmt.match(/^\s*int\s+(\w+)\s*=\s*([\d.]+)\s*;/);
  if (decl) { LOCAL_VARS.set(decl[1], parseFloat(decl[2])); return; }
  // 后缀自增/自减（`maxMinions++;`/`magicCrit++;`——无操作数,通用式 [^;]+ 会失配）
  const inc = stmt.match(/^\s*(\w+)\s*(\+\+|--)\s*;/);
  if (inc) {
    const [, lhs, op] = inc;
    if (PIECE_FIELD[lhs]) { p.fx[PIECE_FIELD[lhs]] = (p.fx[PIECE_FIELD[lhs]] ?? 0) + (op === '++' ? 1 : -1); return; }
    p.quirks.add(stmt.trim()); return;
  }
  const sm = stmt.match(/^\s*(\w+)\s*(\+=|-=|\*=|\+\+|=)\s*([^;]+);/);
  if (!sm) { const c = stmt.match(/^\s*(\w+)\(/); if (c) p.quirks.add(`call:${c[1]}`); return; }
  const [, lhs, op, rhsRaw] = sm;
  if (PIECE_AMMO[lhs] && rhsRaw.trim() === 'true') { p.quirks.add(`ammo:${PIECE_AMMO[lhs]}`); p.fx.ammo = PIECE_AMMO[lhs]; return; }
  if (PIECE_FLAG.has(lhs) && rhsRaw.trim() === 'true') { p.flags.add(lhs); return; }
  const rhsNum = LOCAL_VARS.get(rhsRaw.trim()) ?? parseFloat(rhsRaw);
  if (!Number.isFinite(rhsNum)) { p.quirks.add(`${lhs} ${op} ${rhsRaw.trim()}`); return; }
  if (PIECE_FIELD[lhs] && (op === '+=' || op === '-=')) {
    const v = rhsNum;
    const f = PIECE_FIELD[lhs];
    p.fx[f] = (p.fx[f] ?? 0) + (op === '-=' ? -v : v);
    return;
  }
  if (PIECE_FIELD[lhs] && op === '++') { p.fx[PIECE_FIELD[lhs]] = (p.fx[PIECE_FIELD[lhs]] ?? 0) + 1; return; }
  if (PIECE_FIELD[lhs] && op === '*=') { p.fx[PIECE_FIELD[lhs]] = (p.fx[PIECE_FIELD[lhs]] ?? 1) * parseFloat(rhsRaw); return; }
  if (lhs === 'statDefense' || (lhs === 'lifeRegen' && rhsRaw.includes('armorPiece'))) return;   // itemstats def/life 面
  p.quirks.add(`${lhs} ${op} ${rhsRaw.trim()}`);
}
{
  let curIds = null, depth = 0;
  const buf = [];   // {stmt, rd}——rd = 相对 if 块深度（1=块内直属于 if 的语句;≥2=嵌套条件体→quirk）
  const flush = () => {
    if (curIds) for (const { stmt, rd } of buf) {
      for (const id of curIds) {
        const p = addPiece(id);
        if (rd === 1) applyStmt(p, stmt);
        else p.quirks.add(`nest:${stmt.trim()}`);
      }
    }
    buf.length = 0;
  };
  for (const rawLine of gabBody.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ');
    const ifm = line.match(/if \(armorPiece\.type == ((?:\d+)(?:\s*\|\|\s*armorPiece\.type == \d+)*)\)/);
    const ifm2 = line.match(/if \(armorPiece\.type >= (\d+) && armorPiece\.type <= (\d+)\)/);
    const casem = line.match(/^\s*case (\d+):/);
    if (ifm) { flush(); curIds = ifm[1].match(/\d+/g).map(Number); depth = 0; continue; }
    if (ifm2) { flush(); curIds = []; for (let v = +ifm2[1]; v <= +ifm2[2]; v++) curIds.push(v); depth = 0; continue; }
    if (casem) { flush(); curIds = [+casem[1]]; depth = 0; continue; }
    if (curIds === null) continue;
    const opens = (line.match(/\{/g) ?? []).length, closes = (line.match(/\}/g) ?? []).length;
    if (depth === 0) {
      if (opens > 0) { depth += opens - closes; continue; }        // 块头行
      if (/^\s*break;\s*$/.test(line) || /^\s*}\s*$/.test(line) || /^\s*switch \(.*\)\s*$/.test(line)) { flush(); curIds = null; continue; }
      buf.push({ stmt: line, rd: 1 });
    } else {
      depth += opens - closes;
      if (depth <= 0 && closes > 0) { flush(); depth = 0; curIds = null; continue; }   // ★块闭合先 flush（丢句根因修复）
      buf.push({ stmt: line, rd: depth });   // depth=1=if 块直属语句;≥2=嵌套条件体(238 十周年 maxMinions 等)→ quirk
    }
  }
  flush();
}
note(`单件分支 id 数：${PIECES.size}`);

// 仓四载体并集（vanilla-accfx 甲件环 / SUMMON_GEAR / DD2_PIECE_FX / 省弹表+aggro+内联 quirk）
const accfx = JSON.parse(readFileSync(join(GAME, '..', 'src', 'data', 'vanilla-accfx.json'), 'utf8'));
const ARMOR_AMMO_SAVE_VID = { 2758: 'cost75', 1002: 'chloro', 1549: 'cost80', 4983: 'huntress', 3804: 'huntress', 3878: 'cost80' };
const AGGRO_ARMOR_PIECE = { 1316: 250, 1317: 250, 1318: 250, 2199: 250, 2201: 400, 2202: 250, 2763: 300, 2764: 300, 2765: 300 };
const PIECE_QUIRK_CARRIERS = {
  238: { dmgMagic: 0.05 },                                  // Player.ts 内联(:151-158 原版;+十周年 maxMinions,登记)
  1546: { critRanged: 5, arrowDamageMul: 1.12 },            // shroomiteType 单源(:2604 crit/:2358 乘区)
  1547: { critRanged: 5, bulletDamageMul: 1.12 },
  1548: { critRanged: 5, rocketDamageMul: 1.12 },
  2367: { fish: 5 }, 2368: { fish: 5 }, 2369: { fish: 5 },
  5591: { fish: 5 }, 5592: { fish: 5 }, 5593: { fish: 5 },  // :2427-2431（BJ163：注册面在,fish:5=活面非死面）
};
const ACCFX_MAP = { dmgMelee: 'dmgMelee', dmgRanged: 'dmgRanged', dmgMagic: 'dmgMagic',
  critMelee: 'critMelee', critRanged: 'critRanged', critMagic: 'critMagic',
  move: 'move', meleeSpd: 'meleeSpd', mana: 'mana', manaCostOff: 'manaCostOff',
  life: 'life', armorPen: 'armorPen', fish: 'fish' };

const pieceCov = { full: 0, partial: [], quirk: [] };
// 单源互斥（Player.ts armorStat 环 :2387-2390 同式）：SUMMON_GEAR 已带的环字段 → accfx 同字段让位记 0
const SG_RING_FIELDS = { dmgMagic: 'dmgMagic', dmgMelee: 'dmgMelee', mana: 'mana',
  lifeRegen: 'life', move: 'move', critRanged: 'critRanged', meleeSpeed: 'meleeSpd',
  manaCostOff: 'manaCostOff' };
for (const [idStr, vp] of [...PIECES].sort((a, b) => a[0] - b[0])) {
  const id = +idStr;
  const repoFx = {};
  const afx = accfx[String(id)];
  const afxFx = {};
  if (afx) for (const [k, v] of Object.entries(ACCFX_MAP)) if (afx[k] !== undefined) afxFx[v] = (afxFx[v] ?? 0) + afx[k];
  const sg = SUMMON_GEAR[id];
  if (sg) for (const [sgk, repok] of Object.entries(SG_RING_FIELDS)) {
    if (sg[sgk] !== undefined) delete afxFx[repok];   // 单源互斥
  }
  Object.assign(repoFx, afxFx);
  if (sg) {
    for (const k of ['slot', 'sentry', 'whipRange']) if (sg[k] !== undefined) repoFx[k] = sg[k];
    if (sg.dmg !== undefined) repoFx.dmgMinion = (repoFx.dmgMinion ?? 0) + sg.dmg;
    for (const [sgk, repok] of Object.entries(SG_RING_FIELDS)) {
      if (sg[sgk] !== undefined) repoFx[repok] = (repoFx[repok] ?? 0) + sg[sgk];
    }
  }
  const dd = DD2_PIECE_FX[id];
  if (dd) {
    for (const k of ['dmgMelee', 'dmgRanged', 'dmgMagic', 'critMelee', 'critRanged', 'critMagic', 'move', 'meleeSpd', 'manaCostOff']) {
      if (dd[k] !== undefined) repoFx[k] = (repoFx[k] ?? 0) + dd[k];
    }
    if (dd.lifeRegen !== undefined) repoFx.life = (repoFx.life ?? 0) + dd.lifeRegen;   // DD2 表字段名 lifeRegen ≡ 环 life
    if (dd.dmgMinion !== undefined) repoFx.dmgMinion = (repoFx.dmgMinion ?? 0) + dd.dmgMinion;
    if (dd.ammoCost80) repoFx.ammo = 'cost80';
    if (dd.huntressAmmoCost90) repoFx.ammo = 'huntress';
  }
  if (ARMOR_AMMO_SAVE_VID[id]) repoFx.ammo = ARMOR_AMMO_SAVE_VID[id];
  if (AGGRO_ARMOR_PIECE[id] !== undefined) repoFx.aggro = (repoFx.aggro ?? 0) + AGGRO_ARMOR_PIECE[id];
  Object.assign(repoFx, PIECE_QUIRK_CARRIERS[id] ?? {});
  const want = { ...vp.fx };
  const missing = [], mismatch = [];
  for (const [f, vRaw] of Object.entries(want)) {
    // 符号约定归一：原版 `manaCost -= X`（负向) ≡ 仓 accfx/SUMMON_GEAR 正向折扣池 X
    const v = f === 'manaCostOff' && vRaw < 0 ? -vRaw : vRaw;
    if (f === 'ammo') { if (repoFx.ammo !== v) mismatch.push(`ammo:${repoFx.ammo}≠${v}`); continue; }
    if (repoFx[f] === undefined) missing.push(`${f}=${v}`);
    else if (Math.abs(repoFx[f] - v) > 1e-9) mismatch.push(`${f}:${repoFx[f]}≠${v}`);
  }
  if (!Object.keys(want).length && !vp.flags.size) { pieceCov.quirk.push(`${id}(${[...vp.quirks].join('/') || '-'}|flags:${[...vp.flags].join('/') || '-'})`); continue; }
  if (!missing.length && !mismatch.length) { pieceCov.full++; detail(`单件 ${id} ✓ ${JSON.stringify(want)}`); }
  else pieceCov.partial.push(`${id} 缺[${missing.join(',')}] 差[${mismatch.join(',')}] quirk[${[...vp.quirks].join('/') || '-'}]`);
}
console.log(`  单件面：全载 ${pieceCov.full} / 值缺或差 ${pieceCov.partial.length} / 旗与未建模 ${pieceCov.quirk.length}`);
for (const p of pieceCov.partial) detail(`PARTIAL ${p}`);
for (const u of pieceCov.quirk) detail(`QUIRK ${u}`);

// ============================================================
// §5 孤儿键 census
// ============================================================
console.log('\n[4] 孤儿键 census（仓有、原版注册表无）');
const allVanillaSlotKeys = new Set(), allVanillaVidKeys = new Set();
for (const set of SETS) {
  const trOr = SET_EFFECTS[set.name];
  const lane = trOr?.lane ?? 'slot';
  for (const trip of set.triplets) {
    if (lane === 'vid') {
      allVanillaVidKeys.add(trip.join('|'));
      // ★BJ745 A02：slotFx 并道套的槽键入 slot 白名单（Turtle endurance sb 面）
      if (trOr?.slotFx) {
        const sk = slotKeyOf(trip);
        if (sk !== null) allVanillaSlotKeys.add(sk);
      }
    } else {
      const key = slotKeyOf(trip);
      if (key !== null) allVanillaSlotKeys.add(key);
    }
  }
}
// 槽键死键判定：任一非通配段在全表无一件可占据该槽 → 该键运行时永不匹配（保守上界）
const DEAD_ORPHAN_ALLOW = new Set(['205|202|147', '212|206|155']);   // 1.4.4 DD2 双腿变体遗键(ls 147/155 无物件)
for (const key of Object.keys(ARMOR_SET_BONUSES)) {
  if (allVanillaSlotKeys.has(key)) continue;
  const parts = key.split('|');
  const partsRealizable = [0, 1, 2].every((i) => parts[i] === '*'
    || [...SLOT_OF.values()].some((s) => [s.hs, s.bs, s.ls][i] === +parts[i]));
  if (DEAD_ORPHAN_ALLOW.has(key) && !partsRealizable) note(`孤儿槽键 ${key}（1.4.4 DD2 双腿变体遗键,ls 无物件=运行时死键,登记）`);
  else fail(`孤儿槽键 ${key}${partsRealizable ? '（有物件可匹配——判定面污染）' : '（未登记 baseline）'}`);
}
for (const key of repoVidEntries.keys()) {
  if (!allVanillaVidKeys.has(key)) fail(`孤儿 vid 键 ${key}（原版注册表无此三元组）`);
}

// ============================================================
// §6 报告 + --fix
// ============================================================
console.log(`\n[5] 登记债（BASELINE——组A/B/C 移交,本刀不扩键不修值）`);
console.log(unportedReport.length
  ? `  · UNPORTED ${unportedReport.length} 套：${unportedReport.join(', ')}`
  : `  · UNPORTED 0 套（组A/B 15 套 2026-09-18 落表,已全量纳入 §2 对拍——工具解冻）`);
console.log(`  · PARTIAL：${partialReport.join(' / ') || '（无）'}`);
console.log(`  · 单件面 PARTIAL ${pieceCov.partial.length} id + QUIRK ${pieceCov.quirk.length} id（--verbose 明细）`);
console.log(`  · summonOnly 16 键 setBonus 文本面暗（原版亮;仓 85 键既有正确面不含——组A 裁决）`);
console.log(`  · Turtle endurance+0.15 已承载（★BJ745 A02 槽键 sb 面）/ 5591-5593 渔夫二型未注册债已销（BJ163：`);
console.log(`    atlas Captain Hat/Vest/Pants + itemstats 槽 + legacyIndex/idNames/l10n 均在——死面判词作废）`);
console.log(`  · Nebula nebulaCD-- / 238 十周年 maxMinions+1 / moonLordLegs·slowFall·canFloatInWater 旗面（组B/C）`);

if (FIX) {
  console.log('\n[--fix] vid 键标记块自动重放重写（src/data/vanillaArmorSets.ts）');
  const tablePath = join(GAME, '..', 'src', 'data', 'vanillaArmorSets.ts');
  copyFileSync(tablePath, tablePath + '.bak');
  const src = readFileSync(tablePath, 'utf8');
  const beginMark = '// ★BEGIN RECON-ARMORSET-VID';
  const endMark = '// ★END RECON-ARMORSET-VID';
  const begin = src.indexOf(beginMark);
  const end = src.indexOf(endMark);
  if (begin < 0 || end < 0) {
    console.error('  ✗ 未找到 ★BEGIN/★END RECON-ARMORSET-VID 标记块——vid 键须置于标记块内后重跑');
    process.exit(1);
  }
  const lines = [beginMark, '// 由 tools/recon-armorset-1457.mjs --fix 从 ArmorSetBonuses.cs Initialize 重放生成（勿手改）',
    'export const ARMOR_SET_BONUSES_VID: Record<string, ArmorSetBonus> = {'];
  for (const set of SETS) {
    const tr = SET_EFFECTS[set.name];
    if (!tr || tr.lane !== 'vid') continue;
    for (const trip of set.triplets) {
      const fx = Object.entries(tr.fx ?? {}).map(([k, v]) => `${k}: ${v}`).join(', ');
      lines.push(`  '${trip.join('|')}': { ${fx}, name: '${set.name}' },   // ${set.name}（Initialize :${set.line}）`);
    }
  }
  lines.push('};', endMark);
  writeFileSync(tablePath, src.slice(0, begin) + lines.join('\n') + src.slice(end + endMark.length));
  console.log('  已重写（备份 .bak）——复跑本闸门 + npx vitest run tests/armorset-recon-golden.test.ts tests/armorset-path-unify-parity.test.ts');
}
if (!existsSync(join(GAME, '..', 'tests', 'armorset-recon-golden.test.ts'))) {
  note('提示：金标测试 tests/armorset-recon-golden.test.ts 未就位（金标钉死=第三道闸）');
}

console.log(`\n＝＝＝ recon-armorset-1457 ＝＝＝  DRIFT=${driftCount}  ${driftCount === 0 ? '✓ 闸门绿' : '✗ 闸门红'}`);
process.exit(driftCount === 0 ? 0 : 1);
