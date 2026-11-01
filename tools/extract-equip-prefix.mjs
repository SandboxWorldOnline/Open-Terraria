// 从 1457 反编译源码提取两套数据（★BJ183 2026-09-20 基准对齐 1456→1457；
//  legacySrc 早已 1457。重产禁令：pet/light 系 FX48 手补、itemstats/accfx 含后续
//  审计手增条目——全量重产会回退，新增档须走对拍增量合并，见 BJ183 登记债）：
//  1) src/data/vanilla-equip.json —— 物品装备分类（染料/宠物/光源/矿车/坐骑/钩爪）
//     判定规则（ItemSlot.PickItemMovementAction :1197-1248 原版语义）：
//       dye   = GameShaders.Armor.GetShaderIdFromItemId(id)>0（DyeInitializer BindShader 全表）
//       pet   = buffType>0 && Main.vanityPet[buffType] && !lightPet
//       light = buffType>0 && Main.lightPet[buffType]
//       mount = mountType!=-1 && !MountID.Sets.Cart[mountType]
//       cart  = mountType!=-1 && MountID.Sets.Cart[mountType]
//       hook  = mountType==-1 && Main.projHook[shoot]（projHook = Projectile aiStyle==7）
//  2) src/data/vanilla-prefix.json —— 重铸词缀系统（Item.Prefix :489-602）：
//     词缀名（PrefixID.cs 常量 1-97）+ 属性修正（TryGetPrefixStatMultipliersForItem :691-1061
//     switch）+ 传奇档 value 加成（:1043-1060）+ 各武器类可掷池（PrefixLegacy.Prefixes）+
//     物品类集合（PrefixLegacy.ItemSets / ItemID.Sets.CanGetPrefixes）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const ROOT = process.env.SW_PROJECT_ROOT ?? new URL('../../', import.meta.url).pathname.replace(/\/+$/, '');   // ★C档可移植:game/ 父目录(反编译树/TEdit/Calamity 源所在)
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
// --audit（tests/extract-audit 同法）：全量计算但不落盘，stdout 末行输出
// pinned（表达式槽位钉死件）+ 基数供测试与已提交 JSON 比对——双向抓
// "提取器坏"与"数据被重生成坏"。幂等链（extract→patch 两次 md5 一致）另经
// 手工全链验证（2026-08-19：三连跑五产物 md5 全等）。
const AUDIT = process.argv.includes('--audit');
// SW-FX53 2026-09-13: SW_FX53_OUT=<dir> 试产重定向——全部产物改写进指定目录
// （文件名不变）,真文件零触碰;供重产 dry-run 对拍测试与人工审计（禁真写纪律）。
// ★BJ298 2026-09-23 era guard 补缺省干跑臂（docs/era-guard-family.md 四之二续批排期③
//   【降级面】清偿——原「缺省（无 env 无旗）仍写真库」半闸面收口）：
//   · 缺省（无 env 无旗无 AUDIT）= 干跑对拍零写盘：五产物逐件 vs 现库双向路径级 diff
//     ——fresh-only/drift 任一非空 exit 1+物证（现库退化/值漂移）;live-only=【选报】轴
//     loud 打印不拒跑——本器现库领先面系登记的手补（头注:pet/light 系 FX48 手补、
//     itemstats/accfx 审计手增条目）,全量重产会回退 = shops 刻意剥离面同款家族变体;
//   · SW_FX53_OUT=<dir> = 沙箱写（原通道保留）;--write-real = 真库逃生门（新增;与
//     SW_FX53_OUT 双旗互斥;本器锚 1457 固定,非 1457 禁写规则天然满足）。
const WRITE_REAL = process.argv.includes('--write-real');
const FORCE_FULL = process.argv.includes('--force-full');
const OVERWRITE_APPEND_ERA = process.argv.includes('--overwrite-append-era');
const DRY_DIR = process.env.SW_FX53_OUT;
if (DRY_DIR && WRITE_REAL) {
  console.error('[extract-equip-prefix] 拒绝运行：SW_FX53_OUT 与 --write-real 双旗互斥（输出通道必须唯一）。');
  process.exit(1);
}
const PENDING = new Map();   // ★BJ298 缺省干跑臂：路径 → fresh 全文（零写盘,文末对拍/写实库闸）
const writeOut = (p, data) => {
  if (DRY_DIR) { mkdirSync(DRY_DIR, { recursive: true }); writeFileSync(p.replace(/^.*\//, `${DRY_DIR}/`), data); return; }
  PENDING.set(p, data);      // 缺省/--write-real：一律只记,写实库臂经文末对拍闸（防非纯增量洗库）
};
const itemSrc = read('Terarria1457/Terraria/Item.cs');

// ---- Item.cs case 块逐 id 字段扫描（SetDefaults1-5 段）----
// 按花括号深度过滤：仅取物品外层 switch 的 case 段（嵌套 switch(type) 的 case 标签
// 深度更深，必须排除——否则内层标签会冒充外层 id 污染条目，见 extract-itemcombat 教训）。
function methodBodyOf(src, name) {
  const idx = src.indexOf(name);
  if (idx < 0) return '';
  const start = src.indexOf('{', idx);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start + 1, i); }
  }
  return '';
}
/** case 段 → itemId: segmentSource 映射。
 *  关键：case 标签归属【最近一层 switch(type)】——SetDefaults1-5 内有嵌套
 *  switch(type)（如矿车 2343 块），内层标签才是物品 id；switch(其他变量) 的
 *  标签一律不归属（否则会冒充物品 id，见 extract-itemcombat 坑 2）。
 *  ★落空标签组（2026-08-19 线饰品批）：`case A: case B: 共享体`（C# fall-through）
 *  组内【全部】标签映射同一共享体——旧版只记末标签（3293-3308 十二件整体失踪、
 *  3308 独占共享体被嵌套 switch 首个字面污染成 str=27 的根因）。 */
function outerCaseSegments(src) {
  const out = new Map();
  const collect = (body) => {
    const tokRe = /switch\s*\(([^)]*)\)|case (\d+):|default:|[{}]/g;
    const stack = []; // { isType, opened, bodyDepth, labels, segStart }
    let depth = 0;
    let m;
    while ((m = tokRe.exec(body))) {
      const t = m[0];
      if (t.startsWith('switch')) {
        stack.push({ isType: /switch\s*\(\s*type\b/.test(t), opened: false, bodyDepth: -1, labels: [], segStart: 0 });
      } else if (t === '{') {
        depth++;
        const top = stack[stack.length - 1];
        if (top && !top.opened) { top.opened = true; top.bodyDepth = depth; top.segStart = m.index + 1; }
      } else if (t === '}') {
        const top = stack[stack.length - 1];
        if (top && top.opened && depth === top.bodyDepth) {
          const seg = body.slice(top.segStart, m.index);
          if (seg.trim() !== '') for (const id of top.labels) out.set(id, seg);
          stack.pop();
        }
        depth--;
      } else {
        // case / default：到标签时已累积的段非空 = 上一组的真体（写给整组）；
        // 为空 = fall-through 续标（并入当前组等共享体）。default 体不归属任何 id
        //（与旧版一致——default 段的字段是公共兜底，不落在末 case 头上）。
        const top = stack[stack.length - 1];
        if (top && top.opened && top.isType) {
          const seg = body.slice(top.segStart, m.index);
          if (seg.trim() !== '') { for (const id of top.labels) out.set(id, seg); top.labels = []; }
          if (t !== 'default:') top.labels.push(+m[2]);
          top.segStart = m.index + t.length;
        }
      }
    }
  };
  for (const n of [1, 2, 3, 4, 5]) {
    const body = methodBodyOf(src, `private void SetDefaults${n}(`)
      || methodBodyOf(src, `public void SetDefaults${n}(`)
      || methodBodyOf(src, `void SetDefaults${n}(`);
    if (body) collect(body);
  }
  return out;
}
const CASE_SEGMENTS = outerCaseSegments(itemSrc);
/** 段内全部 `switch (type) {...}` 块的花括号匹配跨度（嵌套更深 switch 也按整段跨） */
function typeSwitchSpans(seg) {
  const spans = [];
  const re = /switch\s*\(\s*type\s*\)/g;
  let m;
  while ((m = re.exec(seg))) {
    const brace = seg.indexOf('{', m.index + m[0].length);
    if (brace < 0) break;
    let d = 0, end = -1;
    for (let i = brace; i < seg.length; i++) {
      if (seg[i] === '{') d++;
      else if (seg[i] === '}') { d--; if (d === 0) { end = i; break; } }
    }
    if (end < 0) break;
    spans.push([m.index, end + 1]);
    re.lastIndex = end + 1;
  }
  return spans;
}

/** switch 体 → { cases: Map<label, body>, def }（case 标签按体深度 0 归属；
 *  组内 fall-through 空体标签并入下一组——与 outerCaseSegments 同法） */
function parseSwitchCases(swBody) {
  const cases = new Map();
  let def = null;
  const tokRe = /case (\d+):|default:|[{}]/g;
  let depth = 0, segStart = 0, m;
  let pending = [];
  const flush = (endIdx) => {
    const body = swBody.slice(segStart, endIdx);
    if (body.trim() === '') return;   // fall-through 续标：pending 保留并入下一组
    for (const L of pending) {
      if (L === 'def') def = body; else cases.set(L, body);
    }
    pending = [];
  };
  while ((m = tokRe.exec(swBody))) {
    const t = m[0];
    if (t.startsWith('case') || t === 'default:') {
      if (depth === 0) {
        flush(m.index);
        pending.push(t === 'default:' ? 'def' : +m[1]);
        segStart = m.index + t.length;
      }
    } else if (t === '{') depth++;
    else if (t === '}') depth--;
  }
  flush(swBody.length);
  return { cases, def };
}

/** 段 → 外层余体 + 嵌套 switch(type) 命中分支拼接（C# 顺序执行语义，
 *  后执行的段覆盖先执行的段；嵌套 switch 无本 id case 且无 default = 空段） */
function caseParts(seg, id) {
  const spans = typeSwitchSpans(seg);
  const parts = [];
  let last = 0;
  for (const [s, e] of spans) {
    parts.push(seg.slice(last, s));
    const brace = seg.indexOf('{', s);
    const { cases, def } = parseSwitchCases(seg.slice(brace + 1, e - 1));
    parts.push(cases.has(id) ? cases.get(id) : (def ?? ''));
    last = e;
  }
  parts.push(seg.slice(last));
  return parts;
}

/** 字段按 id 求值（C# 顺序执行语义）：
 *  外层语句恒执行；嵌套 switch(type) 仅执行命中分支（有本 id 的 case 走 case，
 *  否则 default，二者皆无 = 什么都不执行）；【后执行的段覆盖先执行的段】。
 *  段内取首匹配——`defense=2; if(Variant==Weaker){defense=1}` 这类条件重赋值
 *  只在改写语境生效，取首值才是常观数值（与旧版扫描口径一致）。
 *  ★必要性（2026-08-19 线饰品批）：落空标签组共享体+嵌套 switch 是 SetDefaults
 *  对成组物品逐 id 差异化的标准写法（如 3293-3308 线色 / 3863-3865 头槽 /
 *  3855-3857 宠物 buffType）——首字面匹配会把全组误判第一个值。 */
function resolveCaseField(seg, pattern, id) {
  let val;
  for (const p of caseParts(seg, id)) {
    const m = p.match(new RegExp(pattern));
    if (m) val = m[1] !== undefined ? +m[1] : 1;
  }
  return val;
}

/** 捕获组【原文】按 id 求值（同 resolveCaseField 的段拼接/覆盖语义，但不做
 *  `+m[1]` 数值强转——算式槽位求值需要保留 RHS 表达式原文） */
function resolveCaseRaw(seg, pattern, id) {
  let val;
  for (const p of caseParts(seg, id)) {
    const m = p.match(new RegExp(pattern));
    if (m && m[1] !== undefined) val = m[1];
  }
  return val;
}

/** `type` 算式安全求值：剥离整型强转前缀（`(sbyte)(29 + type - 3468)`）后仅允许
 *  数字字面量、type、四则运算符、括号与空白——含其他标识符（局部变量/字段名，
 *  如 DefaultToHeadgear 辅助体内的 helmetArtID）一律拒绝（undefined，保持漏提），
 *  同时防 new Function 注入。求值失败/非有限值同样拒绝。 */
function evalTypeExpr(expr, id) {
  const cleaned = expr.replace(/\(\s*(?:sbyte|byte|short|ushort|int|uint|long|ulong)\s*\)\s*/g, '').trim();
  if (!/^[\d\s+\-*/().]*\btype\b[\d\s+\-*/().]*$/.test(cleaned)) return undefined;
  try {
    const v = new Function('type', `"use strict";return (${cleaned});`)(id);
    return Number.isFinite(v) ? v : undefined;
  } catch { return undefined; }
}

/** 槽位字段扫描（字面量 + type 算式双模式——wingSlot/headSlot/bodySlot/legSlot 等
 *  槽位字段通用入口，非逐件 hardcode）：
 *  ① `slot = N;` 字面量直取（旧口径原样保留）；
 *  ② `slot = <expr>;` 算式（仅含 type/数字/四则/括号/整型强转）→ 代入当前 id 求值。
 *  两类现存实例（Item.cs SetDefaults case 块）：
 *    :30802 `headSlot = type + 186 - 3372;`（3372/3373 Boss 面具 → 186/187，
 *      ItemID.cs:8283 BossMaskCultist/:8285 BossMaskMoonlord）
 *    :31081 `wingSlot = (sbyte)(29 + type - 3468);`（3468-3471 四件月总前翅膀 →
 *      槽 29-32，ItemID.cs:8475-8481 WingsSolar/Vortex/Nebula/Stardust——
 *      此前槽 29-32 被误判"原版死槽"，实为算式解析缺口）
 *  范围块算式（:21852 Boss 面具 2104-2113 `headSlot = type + 146 - 2104`）不在
 *  case 段内，仍由 tools/patch-vanity-stats.mjs ③ 补。 */
function scanSlotFields(src, field) {
  const out = scanCaseFields(src, [`\\b${field}\\s*=\\s*(\\d+);`]);
  for (const [id, seg] of CASE_SEGMENTS) {
    if (out.has(id)) continue;
    const raw = resolveCaseRaw(seg, `\\b${field}\\s*=\\s*([^;]+);`, id);
    if (raw !== undefined) {
      const v = evalTypeExpr(raw, id);
      if (v !== undefined) out.set(id, v);
    }
  }
  return out;
}

/** 扫描字段赋值（field = N;）与辅助方法调用（DefaultToMinecart(N)）。
 *  存在性模式（无捕获组，如 DefaultToInfoAccessory() 辅助族）→ 恒记 1：
 *  1456 的信息饰品 22 件走 DefaultToInfoAccessory(24,18|28)(Item.cs:1561+，内部
 *  DefaultToAccessory :48229 才设 accessory=true)——此前只认字面 `accessory = true;`
 *  全部漏提，导致 statOfInternal null → Inventory.armorAccepts 拒收（装备不了） */
function scanCaseFields(src, patterns) {
  const out = new Map(); // itemId -> 值
  for (const [id, seg] of CASE_SEGMENTS) {
    for (const p of patterns) {
      const v = resolveCaseField(seg, p, id);
      if (v !== undefined) { out.set(id, v); break; }
    }
  }
  return out;
}
const BUFF_TYPE = scanCaseFields(itemSrc, [
  '\\bbuffType\\s*=\\s*(\\d+);',
  // DefaultToVanitypet(projId, buffID)（Item.cs:47549：buffType 赋值在辅助方法内）
  'DefaultToVanitypet\\(\\d+,\\s*(\\d+)\\);',
]);
const MOUNT_TYPE = scanCaseFields(itemSrc, ['\\bmountType\\s*=\\s*(-?\\d+);', 'DefaultToMinecart\\((\\d+)\\);']);
// ★SW-FX53 2026-09-13：算式实参通道（字面通道的 fill-when-undefined 补充——
//  ① DefaultToVanitypet 共享算式块 `DefaultToVanitypet(881 + type - 4797, 284 + type
//  - 4797)`（Item.cs 1456:39417-39440,1458 同值）——boss 宠 21 件 buffType 整缺,
//  equip.json pet/light 由 FX48 手补,重产即回退（vanilla-pets.json 同根因已同批
//  教学解析直出）;② mountType 算式 `44 + type - 4792`（:39414 大师模式坐骑
//  4792-4796）与 `40 + (type - 4785)`（:39364 马鞍 4785-4787）——本刀解出入表,
//  ★注意 equip.mount 数据面 4785-4787/4792-4796 当前在盘缺档（坐骑骑乘面
//  MountID 40-48 移植域另行定谳）,重产落表前须先过坐骑移植面审计（登记债）。
//  evalTypeExpr 白名单拒形参名/局部变量,不可解即沉默。）
for (const [id, seg] of CASE_SEGMENTS) {
  if (!BUFF_TYPE.has(id)) {
    for (const p of caseParts(seg, id)) {
      const m = [...p.matchAll(/DefaultToVanitypet\(([^,]+),\s*([^)]+)\)/g)].pop();
      if (m) {
        const v = evalTypeExpr(m[2], id);
        if (v !== undefined) { BUFF_TYPE.set(id, v); break; }
      }
    }
  }
  if (!MOUNT_TYPE.has(id)) {
    for (const p of caseParts(seg, id)) {
      const m = [...p.matchAll(/\bmountType\s*=\s*([^;]+);/g)].pop();
      if (m) {
        const v = evalTypeExpr(m[1], id);
        if (v !== undefined) { MOUNT_TYPE.set(id, v); break; }
      }
    }
  }
}

// ---- 盔甲/配饰基础数据（装备槽归属 + 防御值）→ vanilla-itemstats.json ----
// 槽位归属：headSlot/bodySlot/legSlot 赋值即对应部位（值是绘制槽序号非部位，仅判有无）。
//   字面量 + type 算式双模式（scanSlotFields——:30802 `type + 186 - 3372` 表达式族）。
// 防御值：`defense = N;` 字面量（269 处全字面量，无表达式/辅助方法）。
// 配饰：`accessory = true;`；vanity=true 的社交配饰 acc:0（可入时装配饰槽、无功能效果）。
const HEAD_SLOT = scanSlotFields(itemSrc, 'headSlot');
const BODY_SLOT = scanSlotFields(itemSrc, 'bodySlot');
const LEGS_SLOT = scanSlotFields(itemSrc, 'legSlot');
// ★BJ163 移交批（2026-09-18）：DefaultTo* 形参直读通道（字面通道的 fill-when-undefined
//  补充;先例 = DefaultToVanitypet 形参直读 / DefaultToMinecart 捕获式）。三辅助
//  DefaultToHeadgear/Body/Legs(w, h, slotID)（Item.cs:48594-48614）在【辅助方法体内】
//  赋 headSlot/bodySlot/legSlot——case 段只有调用点,字面/算式扫描恒漏 → 5588-5590
//  勘探者/5591-5593 渔夫二型/4008 超亮头盔七件无 s 槽位 → statOfInternal 面缺 →
//  Inventory.armorAccepts 恒假（装备不了,BJ163 定谳）。已核全部 7 调用点实参纯字面量
//  （无 type 算式,evalTypeExpr 通道留待出现）;第三参 (\d+) 贪婪回溯=末参直读。
//  1458 对此 7 件零变更（BJ163 已核）。
const SLOT_DEFAULT_TO = [
  ['\\bDefaultToHeadgear\\s*\\([^)]*,\\s*(\\d+)\\)', HEAD_SLOT],
  ['\\bDefaultToBody\\s*\\([^)]*,\\s*(\\d+)\\)', BODY_SLOT],
  ['\\bDefaultToLegs\\s*\\([^)]*,\\s*(\\d+)\\)', LEGS_SLOT],
];
for (const [pat, target] of SLOT_DEFAULT_TO) {
  for (const [vid, slot] of scanCaseFields(itemSrc, [pat])) {
    if (!target.has(vid)) target.set(vid, slot);   // 字面/算式直赋优先,DefaultTo 兜底
  }
}
const HEAD = new Set(HEAD_SLOT.keys());
const BODY = new Set(BODY_SLOT.keys());
const LEGS = new Set(LEGS_SLOT.keys());
const DEFENSE = scanCaseFields(itemSrc, ['\\bdefense\\s*=\\s*(\\d+);']);
// 生命回复（Item.lifeRegen 字段——再生手环族；GrantArmorBenefits :12700 lifeRegen += armorPiece.lifeRegen）
const LIFEREGEN = scanCaseFields(itemSrc, ['\\blifeRegen\\s*=\\s*(\\d+);']);
const ACCESSORY = new Set([
  ...scanCaseFields(itemSrc, ['\\baccessory\\s*=\\s*true;']).keys(),
  // DefaultToInfoAccessory(DefaultToAccessory 内部 accessory=true;Item.cs:48234/:48229)
  ...scanCaseFields(itemSrc, ['\\bDefaultToInfoAccessory\\s*\\(']).keys(),
  ...scanCaseFields(itemSrc, ['\\bDefaultToAccessory\\s*\\(']).keys(),
  // ★BJ740-A ACC16-18（issue #30）：三个辅助函数内置 accessory=true——case 块内
  // 只有调用点,字面量扫描天然漏（同 DefaultToInfoAccessory 形）:
  //   DefaultToMusicBox（Item.cs:48638-48655,101 调用点 562-574/1596-1610/…）
  //   DefaultToVoiceOverrideAccessory（:47786-47800,15 点 215/5484/5485/5499-5509/5534）
  //   DefaultToMonolith（:47762-47769,4 点 5113/5598/5599/5655）
  ...scanCaseFields(itemSrc, ['\\bDefaultToMusicBox\\s*\\(']).keys(),
  ...scanCaseFields(itemSrc, ['\\bDefaultToVoiceOverrideAccessory\\s*\\(']).keys(),
  ...scanCaseFields(itemSrc, ['\\bDefaultToMonolith\\s*\\(']).keys(),
  // 建筑族 4 件:SetDefaults5 default 段区间判断 type>=2214&&type<=2217 →
  // accessory=true（Item.cs:22346-22352;case 标签不落在任何 case 块,扫描不到）
  2214, 2215, 2216, 2217,
  // ★BJ740-A ACC15（issue #30,2026-10-31 定谳=翻案删硬编码）：手机 3124/贝壳手机
  //   5358-5361 的 case 块【确无】accessory/InfoAccessory 辅助调用——1457 亲读
  //   Item.cs:29026-29035（case 3124 仅 useStyle=4/useTime=90 等;邻 case 3123 PDA
  //   :29022-29025 有 DefaultToInfoAccessory——同函数内模式可见,非反编译伪影）;
  //   case 5358-5361（:42506-42540,与 5437 共支）同形无 accessory。原硬编码注释
  //   「游戏内确为可装备信息饰品」系把 RefreshInfoAccsFromItemType 的背包生效面
  //   （:12486-12500 全格扫,与装备无关）误当装备资格——原版 ItemSlot.cs:1444
  //   拒非 accessory,五件真不可装备（线上 3124/5358 误可装,issue #30 ACC15）
]);
const VANITY = new Set([
  ...scanCaseFields(itemSrc, ['\\bvanity\\s*=\\s*true;']).keys(),
  // ★BJ740-A ACC16-18：同三辅助函数内置 vanity=true（DefaultToMusicBox 48654/
  //   VoiceOverride 47794/Monolith 47768）——入 VANITY 使 acc 落 0 档（双旗族）
  ...scanCaseFields(itemSrc, ['\\bDefaultToMusicBox\\s*\\(']).keys(),
  ...scanCaseFields(itemSrc, ['\\bDefaultToVoiceOverrideAccessory\\s*\\(']).keys(),
  ...scanCaseFields(itemSrc, ['\\bDefaultToMonolith\\s*\\(']).keys(),
]);
const STATS = {};
const setStat = (vid, patch) => { STATS[vid] = { ...(STATS[vid] ?? {}), ...patch }; };
for (const [vid, slot] of HEAD_SLOT) setStat(vid, { s: 'h', hs: slot });
for (const [vid, slot] of BODY_SLOT) setStat(vid, { s: 'b', bs: slot });
for (const [vid, slot] of LEGS_SLOT) setStat(vid, { s: 'l', ls: slot });
for (const [vid, def] of DEFENSE) setStat(vid, { def });
for (const [vid, reg] of LIFEREGEN) setStat(vid, { life: reg });
for (const vid of ACCESSORY) setStat(vid, { acc: VANITY.has(vid) ? 0 : 1 });
// 翅膀槽（Item.wingSlot——翅膀是配饰，wingSlot>0 即翅膀；飞行时长/速度查 vanilla-wingstats.json）。
// :31081 `wingSlot = (sbyte)(29 + type - 3468);` 算式族（3468-3471 月总前四翅膀 → 槽 29-32）
// 由 scanSlotFields 算式通道补齐——此前只认字面量时四件仅 acc=1 无 wing（不可飞不可渲染）。
const WING_SLOT = scanSlotFields(itemSrc, 'wingSlot');
for (const [vid, wing] of WING_SLOT) setStat(vid, { wing });
// 悠悠球线（Item.stringColor>0 → yoyoString=true，Player.cs:14170）
const STRING_COLOR = scanCaseFields(itemSrc, ['\\bstringColor\\s*=\\s*(\\d+);']);
// 范围块求值覆写：case 3293-3308 共享体内是【嵌套 switch(type)】（Item.cs:30191-30229：
//   case 3307→27 / 3306→14 / 3308→13 / 3305→28 / default→1+type-3293）——
// 共享体首字面匹配会把全组误判 27，须按嵌套 switch 语义逐 id 求值（case 命中
// 用 case 字面，否则 default 公式代入 type）。
for (const [id, seg] of CASE_SEGMENTS) {
  const swIdx = seg.indexOf('switch (type)');
  if (swIdx < 0) continue;
  const brace = seg.indexOf('{', swIdx);
  let d = 0, end = -1;
  for (let i = brace; i < seg.length; i++) {
    if (seg[i] === '{') d++;
    else if (seg[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  if (end < 0) continue;
  const cases = new Map();
  let defaultExpr = null;
  for (const part of seg.slice(brace + 1, end).split(/(?=case \d+:|default:)/)) {
    const lbl = part.match(/^(case (\d+)|default):/);
    const val = part.match(/stringColor = ([^;]+);/);
    if (!lbl || !val) continue;
    if (lbl[2]) cases.set(+lbl[2], val[1].trim());
    else defaultExpr = val[1].trim();
  }
  if (!cases.size && defaultExpr === null) continue;   // 非线饰品族嵌套 switch 不动
  const expr = cases.get(id) ?? defaultExpr;
  if (expr !== null && expr !== undefined) STRING_COLOR.set(id, +new Function('type', `return ${expr};`)(id));
}
for (const [vid, sc] of STRING_COLOR) setStat(vid, { str: sc });
writeOut(`${ROOT}/game/src/data/vanilla-itemstats.json`, JSON.stringify(STATS));
console.error(`itemstats: ${Object.keys(STATS).length} 件（head ${HEAD.size} body ${BODY.size} legs ${LEGS.size} def ${DEFENSE.size} acc ${ACCESSORY.size} wing ${WING_SLOT.size}）`);

// ---- 翅膀飞行属性（WingStatsInitializer.cs：array[N] = new WingStats(flyTimeVar, flySpeedVar)）----
// 本地变量别名（flyTime*=int 时长 tick、flySpeedOverride*=float 速度）先求值再代入。
{
  const wsSrc = read('Terarria1457/Terraria.Initializers/WingStatsInitializer.cs');
  const locals = {};
  for (const mm of wsSrc.matchAll(/int (flyTime\d*) = (\d+);/g)) locals[mm[1]] = +mm[2];
  for (const mm of wsSrc.matchAll(/float (flySpeedOverride\d*) = ([\d.]+)f;/g)) locals[mm[1]] = parseFloat(mm[2]);
  const WING_STATS = {};
  for (const mm of wsSrc.matchAll(/array\[(\d+)\] = new WingStats\((\w+),\s*(\w+)\);/g)) {
    const t = locals[mm[2]], s = locals[mm[3]];
    if (t !== undefined && s !== undefined) WING_STATS[mm[1]] = { time: t, speed: s };
  }
  writeOut(`${ROOT}/game/src/data/vanilla-wingstats.json`, JSON.stringify(WING_STATS));
  console.error(`wingstats: ${Object.keys(WING_STATS).length} 组（angel=1: ${JSON.stringify(WING_STATS['1'])}）`);
}

// ---- 配饰数值效果子集（Player.ApplyEquipFunctional :13952 switch(type)）→ vanilla-accfx.json ----
// 只提取纯数值赋值模式（可数据驱动生效）；行为型效果（火箭靴飞行/熔岩护身/星星斗篷等）
// 依赖未移植的 Player 子系统，不在本表——后续按系统移植进度扩白名单。
const ACC_PATTERNS = [
  ['life', /lifeRegen \+= (\d+);/],
  ['mana', /statManaMax2 \+= (\d+);/],
  ['def', /statDefense \+= (\d+);/],
  ['move', /moveSpeed \+= ([\d.]+)f;/],
  ['meleeSpd', /meleeSpeed \+= ([\d.]+)f;/],
  ['runSpeed', /accRunSpeed = ([\d.]+)f;/],
  ['dmgMelee', /meleeDamage \+= ([\d.]+)f;/],
  ['dmgRanged', /rangedDamage \+= ([\d.]+)f;/],
  ['dmgMagic', /magicDamage \+= ([\d.]+)f;/],
  ['dmgAll', /allDamage \+= ([\d.]+)f;/],
  ['critMelee', /meleeCrit \+= (\d+);/],
  ['critRanged', /rangedCrit \+= (\d+);/],
  ['critMagic', /magicCrit \+= (\d+);/],
  // 耗魔折扣【加算】池（Player.manaCost 单浮点逐项 -=——2026-09-04 补,此前提取器无此
  // 模式,GrantArmorBenefits 甲件段 4982/1003/2760/2189/1282-1287/4256/2279 的
  // manaCost -= X 面全漏,json 由蓝队批手工补齐并经 tests/accfx-armor-mainstats 钉值）
  ['manaCostOff', /manaCost -= ([\d.]+)f;/],
  // ---- 行为型字段（二轮：跳跃/飞行/免疫/受击触发）----
  ['extraFall', /extraFall \+= (\d+);/],          // 摔伤豁免高度
  ['lavaMax', /lavaMax \+= (\d+);/],              // 岩浆免疫时长（420=7s）
  ['armorPen', /armorPenetration \+= (\d+);/],    // 护甲穿透（鲨鱼牙项链）
  ['rocketBoots', /rocketBoots = \(vanityRocketBoots = (\d)\);/], // 1-5 档飞行
  ['autoJump', /autoJump = true;/],
  ['fireWalk', /fireWalk = true;/],               // 陨石/狱岩灼伤免疫
  ['noKnockback', /noKnockback = true;/],         // 钴蓝盾族
  ['noFallDmg', /noFallDmg = true;/],             // 幸运马掌/气球族
  ['desertBoots', /desertBoots = true;/],
  ['waterWalk', /waterWalk = true;/],
  ['waterWalk2', /waterWalk2 = true;/],
  ['jumpBoost', /jumpBoost = true;/],             // 气球+跳跃组合件
  ['panic', /panic = true;/],                     // 恐慌项链：受击加速
  ['starCloak', /starCloakItem = (?:currentItem|armorPiece);/], // 星星斗篷：受击落星
  ['carpet', /carpet = true;/],                   // 飞毯（水平滑翔，暂存字段）
  // ---- 三轮（冲刺/闪避/蜜蜂）----
  ['dashType', /dashType = (\d);/],               // 1=忍者足具/水晶刺客 2=忍者大师装备
  ['blackBelt', /blackBelt = true;/],             // 10% 闪避（Black Belt :9772）
  ['bees', /honeyCombItem = (?:currentItem|armorPiece);/], // 蜂蜜斗篷/蜂巢背带：受击放蜂
  ['spikedBoots', /spikedBoots (?:\+=|=) (\d);/], // 攀壁钉鞋（忍者大师装备 = 2 / 冰刀族 += 2）
  // ---- 五轮（残余全量）----
  ['flipper', /accFlipper = true;/],              // 脚蹼：游泳提速
  ['jumpSpd', /jumpSpeedBoost \+= ([\d.]+)f;/],   // 跳跃速度提升（蛙腿族）
  ['longInvince', /longInvince = true;/],         // 项链族：无敌帧翻倍
  ['treasureMagnet', /treasureMagnet = true;/],   // 吸附范围
  ['goldRing', /goldRing = true;/],               // 金币吸附
  ['luckyCoin', /hasLuckyCoin = true;/],          // 幸运币：命中掉钱（暂存）
  ['discount', /discountEquipped = true;/],       // 折扣卡：商店 8 折
  ['quiver', /magicQuiver = true;/],              // 魔法箭袋：箭伤 +10%
  ['arrowDmg', /arrowDamageAdditiveStack \+= ([\d.]+)f;/],
  ['ammoSave', /ammoCost80 = true;/],             // 20% 概率不耗弹
  ['huntressSave', /huntressAmmoCost90 = true;/], // 10% 概率不耗弹
  ['kbGlove', /kbGlove = true;/],                 // 力量手套：近战击退翻倍
  ['yoyoString', /yoyoString = true;/],            // 悠悠球线：射程 +
  ['tileSpeed', /equippedAnyTileSpeedAcc = true;/],  // 放置加速（手持可放置非火把时 tileSpeed+0.5，:12604-12610）
  ['wallSpeed', /equippedAnyWallSpeedAcc = true;/],  // 铺墙加速（wallSpeed+0.5 无手持门，:12614-12617）
  ['tileRange', /equippedAnyTileRangeAcc = true;/],  // 工具射程 +
  // ---- 建筑族补批（:12610-12612/:13981/:14720-14746/:14873-14876）----
  ['autoPaint', /autoPaint = true;/],            // 喷漆器：放置自动上漆（:39935 消费）
  ['chiselSpeed', /chiselSpeed = true;/],        // 古凿：pickSpeed-0.25（挖掘冷却 ÷ 4/3）
  ['toolbelt', /blockRange\+\+;/],               // 工具腰带 407：装备生效 blockRange+1（:14873）
  ['skyStone', /skyStoneEffects = true;/],        // 天界石族：全属性复合（:12558）
  ['counterWeight', /counterWeight = \d+;/],      // 配重球（悠悠球命中触发，暂存）
  ['manaMagnet', /manaMagnet = true;/],           // 魔力磁石：魔力星吸附
  ['magicCuffs', /magicCuffs = true;/],           // 魔力手铐：受伤回蓝
  ['manaFlower', /manaFlower = true;/],           // 磁花：耗魔 -8%+魔力不足自动喝蓝
  ['pStone', /pStone = true;/],                   // 贤者之石（药水 CD -25%，暂存）
  // ---- 六轮：花靴（Player.cs:12688 行走生花 + DropBait ×10000 门一并消费）----
  ['flowerBoots', /flowerBoots = true;/],         // 花靴 3017 / 仙灵靴 3993
  // ---- 七轮：冰刀（Player.cs:14542/:14703/:14843/:14846——冰面移动修正 :26237+）----
  ['iceSkate', /iceSkate = true;/],               // 冰刀 950/北极潜水装 1861/沙漠潜水装 1862/泰拉靴 5000
  // ---- 魔力回复直值（:14379-14383 魔力斗篷 982：+20 魔 + 回复双字段）----
  ['manaRegenBonus', /manaRegenBonus \+= (\d+);/],            // 每帧产额加成（UpdateManaRegen :19254）
  ['manaRegenDelayBonus', /manaRegenDelayBonus \+= ([\d.]+)f;/], // 惩罚期额外衰减/tick（:19237）
];
// 跳跃选项多值字段：一个物品可同时授予 Cloud+Sandstorm+Blizzard（三合一瓶 1164）
const JUMP_OPTS_RE = /hasJumpOption_(\w+) = true;/g;
{
  const playerSrc = read('Terarria1457/Terraria/Player.cs');
  const body = methodBodyOf(playerSrc, 'private void ApplyEquipFunctional(');
  const segs = (() => {
    // 复用 outerCaseSegments 的最近 switch(type) 归属（其采集 switch(type) 段）
    const out = new Map();
    const tokRe = /switch\s*\(([^)]*)\)|case (\d+):|default:|[{}]/g;
    const stack = [];
    let depth = 0, m;
    while ((m = tokRe.exec(body))) {
      const t = m[0];
      if (t.startsWith('switch')) stack.push({ isType: /switch\s*\(\s*(?:currentItem\.)?type\b/.test(t), opened: false, bodyDepth: -1, cur: null, segStart: 0, pending: [] });
      else if (t === '{') {
        depth++;
        const top = stack[stack.length - 1];
        if (top && !top.opened) { top.opened = true; top.bodyDepth = depth; top.segStart = m.index + 1; }
      } else if (t === '}') {
        const top = stack[stack.length - 1];
        if (top && top.opened && depth === top.bodyDepth) {
          if (top.isType && top.cur !== null) {
            const segText = body.slice(top.segStart, m.index);
            // ★BJ183 1457 反编译把同体 case 改写成贯穿组（case A: case B: { ... }）——
            // 贯穿组共享体须归属【组内全部 id】,否则只落到末位标签(111/1595/2221
            // mana 族/982-6188-6189 族整缺)。
            for (const id of [...top.pending, top.cur]) out.set(id, segText);
          }
          stack.pop();
        }
        depth--;
      } else {
        const top = stack[stack.length - 1];
        if (top && top.opened && top.isType) {
          if (top.cur !== null) {
            const segText = body.slice(top.segStart, m.index);
            if (segText.trim() === '') {
              top.pending.push(top.cur); // 纯贯穿标签:并入组,等待共享体
            } else {
              for (const id of [...top.pending, top.cur]) out.set(id, segText);
              top.pending = [];
            }
          }
          top.cur = t === 'default:' ? null : +m[2];
          top.segStart = m.index + t.length;
        }
      }
    }
    return out;
  })();
  const ACCFX = {};
  // 段 → 效果对象（白名单单值 + jumpOpts 多值）
  // ★BJ183 1457 反编译在贯穿组体里引入局部量中转（`int num3 = 40; statManaMax2 += num3;`）
  //   ——先归并段内 `int <name> = <lit>;` 常量,再把标识符回代字面量后二次匹配。
  const extractFx = (seg) => {
    const fx = {};
    const consts = new Map();
    // 字面量连 f 后缀一并捕获（float num4 = 0.06f → '0.06f'）——回代后与既有
    // `+= ([\d.]+)f;` 形态模式无缝衔接（1457 :15222-15225 item 223 manaCost 即此形）。
    for (const cm of seg.matchAll(/\b(?:int|float) (\w+) = (-?[\d.]+f?);/g)) consts.set(cm[1], cm[2]);
    let resolved = seg;
    if (consts.size) {
      resolved = seg.replace(/\b(\w+)\b/g, (w) => (consts.has(w) ? consts.get(w) : w));
    }
    for (const [field, re] of ACC_PATTERNS) {
      const mm = seg.match(re) ?? resolved.match(re);
      // 布尔型模式（无捕获组）→ 1；数值型 → parseFloat
      if (mm) fx[field] = mm[1] === undefined ? 1 : parseFloat(mm[1]);
    }
    for (const jm of seg.matchAll(JUMP_OPTS_RE)) {
      fx.jumpOpts = fx.jumpOpts ?? [];
      if (!fx.jumpOpts.includes(jm[1])) fx.jumpOpts.push(jm[1]);
    }
    return fx;
  };
  for (const [vid, seg] of segs) {
    const fx = extractFx(seg);
    if (Object.keys(fx).length) ACCFX[vid] = fx;
  }
  // ---- 旧配饰/盔甲 if-chain（GrantArmorBenefits 的 armorPiece.type == X 数值段 +
  //      ApplyEquipFunctional 内的 currentItem.type == X 数值段——赫麦靴族等老物品在此）----
  {
    const ifRe = (varName) => new RegExp(
      `if \\(${varName}\\.type == (\\d+)([^)]*)\\)\\s*\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}`, 'g');
    for (const [method, varName] of [
      ['private void GrantArmorBenefits(', 'armorPiece'],
      ['private void ApplyEquipFunctional(', 'currentItem'],
    ]) {
      const body = methodBodyOf(playerSrc, method);
      const re = ifRe(varName);
      let m2;
      while ((m2 = re.exec(body))) {
        const cond = `== ${m2[1]}${m2[2]}`;
        const ids = [...cond.matchAll(/== (\d+)/g)].map((x) => +x[1]);
        const seg = m2[3];
        const fx = extractFx(seg);
        if (!Object.keys(fx).length) continue;
        for (const vid of ids) ACCFX[vid] = { ...(ACCFX[vid] ?? {}), ...fx };
      }
    }
  }
  writeOut(`${ROOT}/game/src/data/vanilla-accfx.json`, JSON.stringify(ACCFX));
  console.error(`accfx: ${Object.keys(ACCFX).length} 件配饰数值效果`);
}

// ---- vanityPet / lightPet 初始化表（Main.cs 静态初始化段；★BJ183 1457 行窗 9280-9580,
//      表体实域 :9353-:9438；1456 旧窗 9050-9350 已漂移出表） ----
const mainSrc = read('Terarria1457/Terraria/Main.cs');
const mainLines = mainSrc.split('\n');
const initSeg = mainLines.slice(9280, 9580).join('\n');
const vanityPet = new Set();
const lightPet = new Set();
for (const mm of initSeg.matchAll(/vanityPet\[(\d+)\] = true;/g)) vanityPet.add(+mm[1]);
for (const mm of initSeg.matchAll(/lightPet\[(\d+)\] = true;/g)) lightPet.add(+mm[1]);

// ---- 染料：DyeInitializer BindShader(itemId, ...) 全表（多行调用） ----
// 基础色染料经 LoadBasicColorDye(base) 辅助注册（每基色绑 4 件：base 黑=+12 亮=+31 银=+44，
// DyeInitializer.cs:13-27）；4 参重载直接给 4 个 id（:29 如 2874-2877）。
const dyeSrc = read('Terarria1457/Terraria.Initializers/DyeInitializer.cs');
const dyeIds = new Set();
for (const mm of dyeSrc.matchAll(/BindShader\(\s*(\d+)\s*,/g)) dyeIds.add(+mm[1]);
for (const mm of dyeSrc.matchAll(/LoadBasicColorDye\((\d+),\s*([\d.]+)f/g)) {
  // 单参重载（基色 id）：base / base+12 / base+31 / base+44
  const base = +mm[1];
  for (const id of [base, base + 12, base + 31, base + 44]) dyeIds.add(id);
}
for (const mm of dyeSrc.matchAll(/LoadBasicColorDye\((\d+),\s*(\d+),\s*(\d+),\s*(\d+),/g)) {
  for (const id of [+mm[1], +mm[2], +mm[3], +mm[4]]) dyeIds.add(id);
}

// ---- 矿车 mount id（MountID.Sets.Cart :21） ----
const MOUNT_CART = new Set([6, 13, 11, 15, 16, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 51, 53]);

// ---- 钩爪投射物（projHook = aiStyle==7，Projectile.SetDefaults 扫描产物） ----
const projs = JSON.parse(read('game/src/data/vanilla-projectiles.json'));
const hookProjs = new Set(Object.entries(projs)
  .filter(([, p]) => p.aiStyle === 7).map(([k]) => +k));
// ---- 物品 shoot 表（vanilla-itemcombat.json 提取期已有） ----
const combat = JSON.parse(read('game/src/data/vanilla-itemcombat.json'));

const equip = { dye: [], pet: [], light: [], mount: [], cart: [], hook: [] };
for (const id of dyeIds) equip.dye.push(id);
for (const [itemId, buff] of BUFF_TYPE) {
  if (vanityPet.has(buff) && !lightPet.has(buff)) equip.pet.push(itemId);
  else if (lightPet.has(buff)) equip.light.push(itemId);
}
for (const [itemId, mount] of MOUNT_TYPE) {
  if (mount < 0) continue;
  (MOUNT_CART.has(mount) ? equip.cart : equip.mount).push(itemId);
}
for (const [itemIdStr, c] of Object.entries(combat)) {
  const itemId = +itemIdStr;
  if (MOUNT_TYPE.get(itemId) !== undefined && MOUNT_TYPE.get(itemId) >= 0) continue; // mountType==-1 门
  if (c.shoot !== undefined && hookProjs.has(c.shoot)) equip.hook.push(itemId);
}
for (const k of Object.keys(equip)) equip[k].sort((a, b) => a - b);
writeOut(`${ROOT}/game/src/data/vanilla-equip.json`, JSON.stringify(equip));
console.error(`equip: dye ${equip.dye.length} pet ${equip.pet.length} light ${equip.light.length} ` +
  `mount ${equip.mount.length} cart ${equip.cart.length} hook ${equip.hook.length}`);

// ================= 词缀 =================
const prefixSrc = read('Terarria1457/Terraria.ID/PrefixID.cs');
// 常量名（→ l10n 键 Prefix.<Name>，1-97）
const PREFIX_NAMES = {};
for (const mm of prefixSrc.matchAll(/public const int (\w+) = (\d+);/g)) PREFIX_NAMES[+mm[2]] = mm[1];
// ReducedNaturalChance（:7）
const reduced = (prefixSrc.match(/ReducedNaturalChance = Factory\.CreateBoolSet\(([^)]*)\)/)?.[1] ?? '')
  .split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));

// 属性修正 switch（Item.cs:691-1061）：case 标签组共享体
function methodBody(src, name) {
  const idx = src.indexOf(name);
  if (idx < 0) return '';
  const start = src.indexOf('{', idx);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start + 1, i); }
  }
  return '';
}
const PREFIX_STATS = {};
{
  const body = methodBody(itemSrc, 'public bool TryGetPrefixStatMultipliersForItem');
  // switch (rolledPrefix) { case N: case M: <赋值>; break; ... }
  const swStart = body.indexOf('switch (rolledPrefix)');
  let depth = 0, i = body.indexOf('{', swStart);
  let end = i;
  for (; i < body.length; i++) {
    if (body[i] === '{') depth++;
    else if (body[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const sw = body.slice(body.indexOf('{', swStart) + 1, end);
  // 按 case 标签切段
  const parts = sw.split(/(?=case \d+:)/);
  const F = { dmg: 1, kb: 1, spd: 1, size: 1, shtspd: 1, mcst: 1 };
  for (const part of parts) {
    const labels = [...part.matchAll(/^case (\d+):/gm)].map((mm) => +mm[1]);
    if (!labels.length) continue;
    const st = { dmg: 1, kb: 1, spd: 1, size: 1, shtspd: 1, mcst: 1, crt: 0, tagdmg: 0, arpen: 0 };
    for (const [fname] of Object.entries(F)) {
      const mm = part.match(new RegExp(`\\b${fname} = ([\\d.]+)f?;`));
      if (mm) st[fname] = parseFloat(mm[1]);
    }
    for (const fname of ['crt', 'tagdmg', 'arpen']) {
      const mm = part.match(new RegExp(`\\b${fname} = (\\d+);`));
      if (mm) st[fname] = +mm[1];
    }
    // 无任何修正的 case（纯 1 档）也登记——保持与原版 switch 全集一致
    for (const id of labels) PREFIX_STATS[id] = st;
  }
}
// 传奇档 value 乘档（:1043-1060：固定四组 id）。62-80（配饰词缀）在属性 switch 中无 case
// （纯 value 档位），此处统一补全一档条目。
const TIER = {};
for (const id of [62, 69, 73, 77]) TIER[id] = 1.05;
for (const id of [63, 70, 74, 78, 67]) TIER[id] = 1.1;
for (const id of [64, 71, 75, 79, 66]) TIER[id] = 1.15;
for (const id of [65, 72, 76, 80, 68]) TIER[id] = 1.2;
for (const id of Object.keys(TIER)) {
  PREFIX_STATS[id] = PREFIX_STATS[id]
    ?? { dmg: 1, kb: 1, spd: 1, size: 1, shtspd: 1, mcst: 1, crt: 0, tagdmg: 0, arpen: 0 };
  PREFIX_STATS[id].tier = TIER[id];
}

// ---- 各武器类可掷池 + 物品集合（PrefixLegacy.cs 全量字面量） ----
// ★2026-09-18 重铸域锚 1457（用户实报:6155 闪电之击不可重铸）：1456↔1457 的
// PrefixLegacy.cs 漂移=恰好两行——Magic += 6152,6153,6154,6155,6171,6173；
// Summon += 6148,6149,6161,6164（1458 与 1457 逐字节同文,无增量）。
// 其余 faces（itemSrc/itemidSrc 等）仍锚 1456：1456==1457 已核（PrefixID.cs 全等、
// CanGetPrefixes 行全等）；且盘上 itemstats/accfx/equip 含后续手补增量
// （tests/sw-fx53-extractor-blindspots C3 例外集），全量换锚重跑=禁区（登记债）。
const legacySrc = read('Terarria1457/Terraria.GameContent.Prefixes/PrefixLegacy.cs');
const POOLS = {};
for (const mm of legacySrc.matchAll(/public static int\[\] (\w+) = new int\[\d+\]\s*\{([\d,\s]+)\};/g)) {
  POOLS[mm[1]] = mm[2].split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
}
const SETS = {};
for (const mm of legacySrc.matchAll(/public static bool\[\] (\w+) = Factory\.CreateBoolSet\(([^)]*)\);/g)) {
  SETS[mm[1]] = mm[2].split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
}
// ItemID.Sets.CanGetPrefixes = CreateBoolSet(true, <排除表>)（ItemID.cs:175）
const itemidSrc = read('Terarria1457/Terraria.ID/ItemID.cs');
const cgp = itemidSrc.match(/CanGetPrefixes = Factory\.CreateBoolSet\(([^)]*)\)/)?.[1] ?? '';
const cgpTrue = /^\s*true\b/.test(cgp);
const cgpExcluded = cgp.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));

const doc = {
  names: PREFIX_NAMES,
  stats: PREFIX_STATS,
  reduced,
  pools: POOLS,
  itemSets: SETS,
  canGetPrefixesDefault: cgpTrue,
  canGetPrefixesExcluded: cgpExcluded,
};
writeOut(`${ROOT}/game/src/data/vanilla-prefix.json`, JSON.stringify(doc));
console.error(`prefix: ${Object.keys(PREFIX_STATS).length} 条属性 / ${Object.keys(PREFIX_NAMES).length} 名 / 池 ${Object.keys(POOLS).length} / 集合 ${Object.keys(SETS).length}`);

// ---- ★BJ298 缺省干跑对拍闸 / --write-real 闸（banners 同构 deepWash;五产物逐件）----
// 器语义选报/拒双形态（shops 刻意剥离面家族变体）：
//   选报产物 = vanilla-accfx.json / vanilla-itemstats.json——登记手增面（头注:审计手增
//     条目 25+ 件与手增键 lavaRose/dmgMinion/crit* 等,亲核 2026-09-23:1209 live 多 crit*
//     三键、908/4003 多 lavaRose、935 多 dmgMinion——全量重产会回退,新增档须走对拍增量
//     合并,残差 fresh-only 6166/6175/6181/6182 登记 data-cut 债）——任一轴非空只 loud 不拒;
//   拒产物 = vanilla-equip/vanilla-prefix/vanilla-wingstats——fresh-only/drift 非空 exit 1。
if (!DRY_DIR) {
  const 选报 = new Set(['vanilla-accfx.json', 'vanilla-itemstats.json']);
  function deepWash(live, fresh, prefix = '') {
    const w = { liveOnly: [], freshOnly: [], drift: [] };
    const base = prefix || '<root>';
    if (live === null || fresh === null || typeof live !== 'object' || typeof fresh !== 'object') {
      if (JSON.stringify(live) !== JSON.stringify(fresh)) w.drift.push(`${base}: ${JSON.stringify(live)}→${JSON.stringify(fresh)}`);
      return w;
    }
    if (Array.isArray(live) !== Array.isArray(fresh)) {
      w.drift.push(`${base}: 类型漂移 ${Array.isArray(live) ? 'arr' : 'obj'}↔${Array.isArray(fresh) ? 'arr' : 'obj'}`);
      return w;
    }
    const lk = new Set(Object.keys(live));
    const fk = new Set(Object.keys(fresh));
    for (const k of Object.keys(live)) {
      const p = `${prefix}.${k}`;
      if (!fk.has(k)) { w.liveOnly.push(p); continue; }
      const sub = deepWash(live[k], fresh[k], p);
      w.liveOnly.push(...sub.liveOnly); w.freshOnly.push(...sub.freshOnly); w.drift.push(...sub.drift);
    }
    for (const k of Object.keys(fresh)) if (!lk.has(k)) w.freshOnly.push(`${prefix}.${k}`);
    return w;
  }
  const FORCE = FORCE_FULL && OVERWRITE_APPEND_ERA;
  const rejectPaths = [];
  for (const [p, freshJson] of PENDING) {
    const name = p.replace(/^.*\//, '');
    let live = null;
    if (existsSync(p)) { try { live = JSON.parse(readFileSync(p, 'utf8')); } catch { /* 坏损:不拦 */ } }
    if (live === null) { console.error(`[extract-equip-prefix] 现库缺 ${name},跳过该件对拍。`); continue; }
    const wash = deepWash(live, JSON.parse(freshJson));
    const dirty = wash.liveOnly.length + wash.freshOnly.length + wash.drift.length > 0;
    if (WRITE_REAL) {
      // --write-real 闸：任一轴非空即拒（防手增面整洗）,强推须 --force-full --overwrite-append-era
      if (dirty && !FORCE) {
        rejectPaths.push(name);
        console.error(`[extract-equip-prefix] 拒绝 --write-real ${name}：diff 非纯增量（live-only ${wash.liveOnly.length}/fresh-only ${wash.freshOnly.length}/drift ${wash.drift.length}）——先逐值定谳再回写。`);
      } else if (dirty && FORCE) {
        console.error(`[extract-equip-prefix] ★双旗强推 ${name}：原地覆盖（live-only ${wash.liveOnly.length} 处将整洗——选报面被回退自负）。`);
      }
      continue;
    }
    if (选报.has(name)) {
      // 选报产物：任一轴 loud 不拒跑
      if (wash.liveOnly.length) console.error(`[extract-equip-prefix] ${name}：live-only ${wash.liveOnly.length} 处（登记手增面,选报不拒跑）: ${wash.liveOnly.slice(0, 5).join(', ')}`);
      if (wash.freshOnly.length) console.error(`[extract-equip-prefix] ${name}：fresh-only ${wash.freshOnly.length} 处（残差 data-cut 债登记）: ${wash.freshOnly.slice(0, 5).join(', ')}`);
      if (wash.drift.length) console.error(`[extract-equip-prefix] ${name}：drift ${wash.drift.length} 处（live 手增键差异,选报不拒跑）: ${wash.drift.slice(0, 5).join(' | ')}`);
    } else if (wash.freshOnly.length || wash.drift.length) {
      rejectPaths.push(name);
      console.error(`[extract-equip-prefix] ${name}：fresh-only/drift 非空（现库退化缺键型/值漂移）。`);
      if (wash.freshOnly.length) console.error(`  [fresh-only] 重产独有 ${wash.freshOnly.length}: ${wash.freshOnly.slice(0, 6).join(', ')}`);
      if (wash.drift.length) console.error(`  [drift] 值漂移 ${wash.drift.length}: ${wash.drift.slice(0, 6).join(' | ')}`);
    } else if (wash.liveOnly.length) {
      console.error(`[extract-equip-prefix] ${name}：live-only ${wash.liveOnly.length} 处（现库领先=手补面,选报不拒跑）: ${wash.liveOnly.slice(0, 6).join(', ')}`);
    } else {
      console.error(`[extract-equip-prefix] ${name}：双向零差。`);
    }
  }
  if (rejectPaths.length) {
    console.error(`[extract-equip-prefix] ${WRITE_REAL ? '--write-real 拒产' : '干跑对拍拒跑'}：${rejectPaths.join(', ')}——exit 1。处置：逐值定谳（反编译为准）；沙箱试验用 SW_FX53_OUT=<dir>；确需原地强推 --force-full --overwrite-append-era 双旗。`);
    process.exit(1);
  }
  if (WRITE_REAL) {
    for (const [p, freshJson] of PENDING) { mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true }); writeFileSync(p, freshJson); }
    console.error('[extract-equip-prefix] --write-real：五产物已写（真库）。');
  }
}

// ---- 审计出口（--audit）：pinned 钉死件（表达式槽位）+ 基数（stdout 单行 JSON）----
if (AUDIT) {
  console.log(JSON.stringify({
    counts: {
      itemstats: Object.keys(STATS).length,   // patch-vanity 之前（无 van/范围块插入）
      head: HEAD.size, body: BODY.size, legs: LEGS.size,
      acc: ACCESSORY.size, wing: WING_SLOT.size,
    },
    pinned: Object.fromEntries([3372, 3373, 3468, 3469, 3470, 3471]
      .map((id) => [String(id), STATS[id] ?? null])),
  }));
}
