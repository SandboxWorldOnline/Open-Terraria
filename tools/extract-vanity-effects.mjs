#!/usr/bin/env node
// extract-vanity-effects.mjs — hasVanityEffects 置位面机械提取（★BJ260 S7 漏修#1 根治刀）。
//
// 债面：旧 SOCIAL_VANITY_EFFECTS_VIDS 手抄 4 件（485/497/861/1987=Item.cs 字面 4 处），
// 实际置位面=三 helper 通路 + 全部字面：
//   ① SetDefaults 字面 `hasVanityEffects = true`（1457 :7165/:7308/:11469/:21271/:28802/
//      :30255(悠悠球弦 3293-3308 十六件共站)/:32305/:34740/:38189/:39184/:39688/:40272/
//      :40690/:40699/:40963/:42291/:42989/:43720——18 站 33 vid；另 21 三个/helper 定义行
//      与 :48954 ResetStats=false 非置位站）；
//   ② DefaultToInfoAccessory（:48625 定义内置 true；22 调用点=钟表 15-18/罗盘 393/395/
//      707-709/FishFinder 3036/3037/深度计 3084/GPS 3095/PDA 3099/手机 3102/3118-3123 等）；
//   ③ DefaultToGolfBall（:35445 定义内置 true；15 调用点=4242-4255 十四件+嵌套 default
//      switch 内 3989）；
//   ④ DefaultToMusicBox（:48638 定义内置 true+vanity=true；85 调用点=音乐盒族）。
// 扣除规则（保留旧 van 臂语义）：vanilla vanity=true 且 SW 现库 vanilla-itemstats.json
//   带 van 键的 vid（3581/3929/4563/4762/5075/5076/1987 等）由 itemTooltip 的 !st?.van
//   臂压住 → 从 social 产物扣除。★S7 简报勘误（本刀亲读证据）：音乐盒族 DefaultToMusicBox
//   虽同时置 vanity=true，但【彼时】现库 itemstats 对音乐盒 acc=1 且【无 van 键】（857
//   实测）→ van 臂【不】压住；原版语义 social && !vanity && !hasVanityEffects（Main.cs
//   :20854）对音乐盒=无警示行 → 音乐盒必须留在 social 集（若照 S7「音乐盒族扣除」会造
//   SW 警示/原版无警示的分歧）。故扣除判据=数据面 st.van 实压位，非 vanilla vanity 字面。
// ★BJ744 改判史（2026-10-31）：BJ740-A ACC16 已把音乐盒族 itemstats 修正为
//   {acc:0, van:1}（DefaultToMusicBox Item.cs:48638-48655 亲读：accessory=true +
//   hasVanityEffects=true + vanity=true——旧「acc=1 无 van 键」系提取器漏扫 helper
//   内置位的数据面错误）→ 上段 S7 留集锚【前提灭失】。警示 parity 复核（1457 亲读
//   Main.cs `item.social && !item.vanity && !item.hasVanityEffects`）：音乐盒
//   vanity=true ⇒ !vanity 假 ⇒ 原版无警示行;SW itemTooltip `!st?.van` 臂同拍压制
//   （van=1）⇒ 音乐盒按通用规则从 social 扣除【不再】造成 SW 警示/原版无警示分歧
//   （两压制项 OR 关系,van 臂已独立承载）。留集锚改判双向锚（见下）。
//
// era guard 四要素（docs/era-guard-family.md 处方）：
//   ① SW_ITEM_VER 白名单 {1456,1457,1458}（缺省 1457；1456=SetDefaults1..5 分段全量解析）；
//   ② 输出通道三分离：缺省干跑零写盘（对拍现库）/SW_OUT=<dir> 沙箱/--write-real 逃生门，
//      双旗互斥拒跑；SW_VANITY_JSON 探测注入面与写盘分离（探测 env 已设而 SW_OUT 缺省=拒）；
//      非 1457 禁写真库；
//   ③ 锚 fail-loud：SetDefaults 签名（1456 五分段）/三 helper 定义体逐行锚/字面站行号/
//      通路基数/哨兵 vid 正负面（含 239 负面=vanity 无特效、857 正面=音乐盒、3581 扣除面）
//      ——锚失配 throw 报锚点名退出，禁止静默兜底；
//   ④ 判别力自证：三版交叉（all 集逐 vid 全等）+ 通路基数四轴（18 字面站/33 字面 vid/
//      22 InfoAccessory/15 GolfBall/85 MusicBox）+ 守卫测试变异面（tests/extract-vanity-
//      effects-era-guard.test.ts：摘判定→footgun 复现；毒锚→exit≠0+锚点名）。
//
// 产物：src/data/vanilla-vanity-effects.json（all=原版全集/social=扣除 van 同置件后 SW 消费面；
// _meta 带行号坐标与通路基数供守卫反查）。消费位：src/ui/itemTooltip.ts SOCIAL_VANITY_EFFECTS_VIDS。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // game/
const REPO = resolve(ROOT, '..');                                       // SandboxWorld/
const PRODUCT = join(ROOT, 'src', 'data', 'vanilla-vanity-effects.json');
const ITEMSTATS = join(ROOT, 'src', 'data', 'vanilla-itemstats.json');
const VER_WHITELIST = [1456, 1457, 1458];
const HELPER_EFFECTS = {
  DefaultToInfoAccessory: { hasVanityEffects: true },
  DefaultToGolfBall: { hasVanityEffects: true },
  DefaultToMusicBox: { hasVanityEffects: true, vanity: true },
};
const range = (a, b) => { const r = []; for (let v = a; v <= b; v++) r.push(v); return r; };

// ── ② 输出通道/① 版本白名单 ──────────────────────────────────────────────
const verArg = process.env.SW_ITEM_VER ? Number(process.env.SW_ITEM_VER) : 1457;
if (!VER_WHITELIST.includes(verArg)) {
  console.error(`[extract-vanity-effects] SW_ITEM_VER=${verArg} 不在白名单 {1456,1457,1458}（缺省 1457）→ 拒跑`);
  process.exit(1);
}
const SW_OUT = process.env.SW_OUT;
const WRITE_REAL = process.argv.includes('--write-real');
if (SW_OUT && WRITE_REAL) {
  console.error('[extract-vanity-effects] SW_OUT 与 --write-real 双旗互斥（petai 习语）→ 拒跑');
  process.exit(1);
}
if (process.env.SW_VANITY_JSON && !SW_OUT) {
  console.error('[extract-vanity-effects] 探测 env SW_VANITY_JSON 已设而 SW_OUT 缺省 → 拒跑（g1：探测注入与写盘面分离）');
  process.exit(1);
}
if (WRITE_REAL && verArg !== 1457) {
  console.error(`[extract-vanity-effects] 非 1457（${verArg}）禁写真库（--write-real 拒）；旧基线重放走 SW_OUT 沙箱`);
  process.exit(1);
}

// ── 解析器：行态机（switch 栈 + case 连标 + 语句归属最近 case 上下文） ──────
// 反编译形态：case 块顶层语句、嵌套 switch（stringColor 内表/default 内 3988-3989）、
// if 块包语句、switch 兄弟层的 `if (type >= A && type <= B)` / `if (type == N)`
// 区间块（1456 SetDefaults3 :21845 2104-2113 时装族/1457 :30260 3309-3314 派对弹珠族）。
// 归属规则=最近开栈上下文的当前 case 连标【全run】（fallthrough 语义）/区间全体
// （if 不入栈只作悬挂条件；default: 无 vid → 命中落 default 带即 fail-loud 上抛）。
function parseSegments(body, startLine, hits) {
  const lines = body.split('\n');
  const stack = [];                       // { labels: number[], sawStmt, depth, defaultZone, pseudo }
  let depth = 0;                          // 相对 body 首行 brace 深度
  let pending = null;                     // { kind: 'switch'|'range', labels? } —— 首行已见、{ 未落
  const hit = (kind, vids, lineIdx, text) => hits.push({ kind, vids, line: startLine + 1 + lineIdx, text: text.trim() });
  const dbg = process.env.SW_VANITY_DEBUG === '1';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\/\/.*$/, '').trim();
    const top = stack[stack.length - 1] ?? null;
    const inCaseZone = top !== null && depth === top.depth;   // 直接位于栈顶上下文体
    if (inCaseZone && !top.pseudo) {
      const caseM = /^case (-?\d+):$/.exec(line);
      if (caseM) {
        const vid = Number(caseM[1]);
        if (top.sawStmt) { top.labels = [vid]; top.sawStmt = false; }
        else top.labels.push(vid);
        continue;
      }
      if (/^default:$/.test(line)) {
        if (top.sawStmt) { top.labels = []; top.sawStmt = false; top.defaultZone = true; }
        else { top.labels = []; top.defaultZone = true; }
        continue;
      }
    }
    if (/^switch\s*\(/.test(line)) { pending = { kind: 'switch' }; continue; }
    // 区间/单点条件块（switch 兄弟层语义,变量域与 case 等价）
    const rangeM = /^(?:else )?if\s*\(\s*type\s*>=\s*(-?\d+)\s*&&\s*[^)]*type\s*<=\s*(-?\d+)\s*[^)]*\)$/.exec(line);
    const eqM = /^(?:else )?if\s*\(\s*type\s*==\s*(-?\d+)\s*[^)]*\)$/.exec(line);
    if (rangeM) { pending = { kind: 'range', labels: range(Number(rangeM[1]), Number(rangeM[2])) }; continue; }
    if (eqM) { pending = { kind: 'range', labels: [Number(eqM[1])] }; continue; }
    if (line === '{') {
      depth++;
      if (pending !== null) {
        stack.push(pending.kind === 'switch'
          ? { labels: [], sawStmt: false, depth, defaultZone: false, pseudo: false }
          : { labels: pending.labels.slice(), sawStmt: false, depth, defaultZone: false, pseudo: true });
        pending = null;
      }
      continue;
    }
    if (line === '}') {
      depth--;
      if (stack.length && stack[stack.length - 1].depth === depth + 1) {
        stack.pop();                        // 上下文体闭合（未消化的连标作废）
      }
      continue;
    }
    if (line === '') continue;
    if (top !== null && depth === top.depth && !/^(case |default:|switch |\{|\})/.test(line)) {
      top.sawStmt = true;
    }
    // 模式命中归属：最近开栈上下文的当前 case 全 run / 区间全体（if 块内语句同属）
    const vids = top ? (top.labels.length ? top.labels.slice()
      : (top.defaultZone ? ['default'] : [null])) : ['outside'];
    if (dbg && /DefaultToMusicBox\(|DefaultToGolfBall\(|hasVanityEffects = true/.test(line)) {
      console.error(`DBG ${startLine + i} depth=${depth} stack=${stack.length} vid=${vids.join(',')} :: ${line}`);
    }
    if (/hasVanityEffects\s*=\s*true/.test(line)) hit('literal-true', vids, i, raw);
    else if (/hasVanityEffects\s*=\s*false/.test(line)) hit('literal-false', vids, i, raw);
    else if (/\bvanity\s*=\s*true/.test(line)) hit('vanity', vids, i, raw);
    else {
      for (const h of Object.keys(HELPER_EFFECTS)) {
        if (line.includes(`${h}(`)) hit(`call:${h}`, vids, i, raw);
      }
      if (/SetDefaults\s*\(/.test(line)) hit('nested-setdefaults', vids, i, raw);
    }
  }
  return { stackLeft: stack.length, depthLeft: depth };
}

/** 提取方法体（签名 → brace 配平）。锚：签名缺失即 throw（fail-loud ③）。 */
function methodBody(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) throw new Error(`锚断言失败[签名]: ${signature}`);
  const line0 = src.slice(0, at).split('\n').length;
  let i = src.indexOf('{', at);
  let d = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) break; }
  }
  return { body: src.slice(i, j + 1), startLine: line0 };
}

function extractVersion(ver, hits) {
  const file = join(REPO, `Terarria${ver}`, 'Terraria', 'Item.cs');
  const src = readFileSync(file, 'utf8');
  const segments = [];
  // 三版同构：SetDefaults1..5 分段（:1388/:12932/:21381/:27660/:35463 三版同线；1456=public
  // 1457/1458=private → 签名锚不含访问修饰符）+ 主入口
  for (const name of ['SetDefaults1', 'SetDefaults2', 'SetDefaults3', 'SetDefaults4', 'SetDefaults5']) {
    segments.push(methodBody(src, `void ${name}(int type)`));
  }
  segments.push(methodBody(src, 'public void SetDefaults(int Type, ItemVariant variant = null)'));
  const vids = new Map();                 // vid -> { hasVanityEffects, vanity, evidence[] }
  const ensure = (v) => {
    if (!vids.has(v)) vids.set(v, { hasVanityEffects: false, vanity: false, evidence: [] });
    return vids.get(v);
  };
  const delegations = [];                 // SetDefaults 递归委托（基址继承面）
  const stationLines = new Set();          // 字面站（去重命中行）=18（3293-3308 共站）
  let prevKind = null;
  for (const seg of segments) {
    const segHits = [];
    const st = parseSegments(seg.body, seg.startLine, segHits);
    if (st.stackLeft !== 0 || st.depthLeft !== 0) {
      throw new Error(`锚断言失败[brace配平]: ${ver} 段解析后 stack=${st.stackLeft} depth=${st.depthLeft}（解析器失配,禁止静默)`);
    }
    for (const h of segHits) {
      // 字面站=去重命中【行】（同一行 16 vid 共站计 1;不同行即不同站,即便两站间无其他命中）
      if (h.kind === 'literal-true') stationLines.add(`${h.line}`);
      for (const vid of h.vids) {
        if (vid === 'default' || vid === null || vid === 'outside') {
          throw new Error(`锚断言失败[归属]: ${ver} line ${h.line} 命中 ${h.kind} 落在无 vid 区（${vid}）→ 解析器需扩`);
        }
        const rec = ensure(vid);
        rec.evidence.push(`${ver}:${h.line}:${h.kind}`);
        if (h.kind === 'literal-true') rec.hasVanityEffects = true;
        else if (h.kind === 'literal-false') {
          throw new Error(`锚断言失败[literal-false]: ${ver} line ${h.line} SetDefaults 内出现显式 false（ResetStats 域外溢）→ 需建模`);
        } else if (h.kind === 'vanity') rec.vanity = true;
        else if (h.kind.startsWith('call:')) {
          for (const [k, eff] of Object.entries(HELPER_EFFECTS)) {
            if (h.kind === `call:${k}`) for (const [f, v] of Object.entries(eff)) rec[f] = v;
          }
        } else if (h.kind === 'nested-setdefaults') {
          // SetDefaults 递归委托（1457 :48922 / 1456 :48525：1803-1807 → 1533+type-1803）
          // ——建模为旗面继承（基址+type-区间起点正则限定,非该形仍 fail-loud）
          const del = /SetDefaults\((\d+)\s*\+\s*type\s*-\s*(\d+)\)/.exec(h.text);
          if (!del || h.vids.length < 2 || Number(del[2]) !== h.vids[0]) {
            throw new Error(`锚断言失败[nested-setdefaults]: ${ver} line ${h.line} 非canonical委托形（${h.text.trim()}）→ 需建模`);
          }
          delegations.push({ from: h.vids.slice(), base: Number(del[1]), line: h.line });
        }
      }
      prevKind = h.kind;
    }
  }
  // 委托解析（不动点,深度护栏）：from[i] ← base+i 的旗面（1457 1803-1807 ← 1533-1537）
  for (let guard = 0; guard < 8 && delegations.length; guard++) {
    let settled = true;
    for (const d of delegations) {
      for (let i = 0; i < d.from.length; i++) {
        const src = vids.get(d.base + i);
        const dst = ensure(d.from[i]);
        if (src && (src.hasVanityEffects || src.vanity)) {
          if (src.hasVanityEffects && !dst.hasVanityEffects) { dst.hasVanityEffects = true; settled = false; }
          if (src.vanity && !dst.vanity) { dst.vanity = true; settled = false; }
          dst.evidence.push(`${ver}:${d.line}:delegate←${d.base + i}`);
        }
      }
    }
    if (settled) break;
  }
  // helper 定义体锚（③）：定义内置旗逐行核
  for (const [name, eff] of Object.entries(HELPER_EFFECTS)) {
    const def = methodBody(src, `public void ${name}(`);
    for (const [f, v] of Object.entries(eff)) {
      const want = `${f} = ${v === true ? 'true' : 'false'}`;
      if (!def.body.includes(want)) throw new Error(`锚断言失败[helper ${name}]: 定义体缺 ${want}`);
    }
  }
  const all = [...vids.entries()].filter(([, r]) => r.hasVanityEffects).map(([v]) => v).sort((a, b) => a - b);
  // 通路基数：站=去重调用行（行号集合）；vid=行归属 vid 数（case 连标共享一行 → vid>站）
  const callLines = (path) => new Set(
    [...vids.values()].flatMap((r) => r.evidence)
      .filter((e) => e.endsWith(`call:${path}`))
      .map((e) => e.split(':')[1]),
  ).size;
  const callVids = (path) => [...vids.values()].filter((r) => r.evidence.some((e) => e.endsWith(`call:${path}`))).length;
  const meta = {
    version: ver,
    file: `Terarria${ver}/Terraria/Item.cs`,
    signatureLine: src.slice(0, src.indexOf('public void SetDefaults(int Type')).split('\n').length,
    literalTrueStations: stationLines.size,
    counts: {
      all: all.length,
      infoAccessoryLines: callLines('DefaultToInfoAccessory'),
      golfBallLines: callLines('DefaultToGolfBall'),
      musicBoxLines: callLines('DefaultToMusicBox'),
      infoAccessoryVids: callVids('DefaultToInfoAccessory'),
      golfBallVids: callVids('DefaultToGolfBall'),
      musicBoxVids: callVids('DefaultToMusicBox'),
    },
  };
  return { all, vids, meta };
}

// ── 三版交叉（④ 判别力）+ 1457 主提取 ───────────────────────────────────
const perVer = {};
const allHits = [];
for (const v of VER_WHITELIST) perVer[v] = extractVersion(v, allHits);
const [a1456, a1457, a1458] = VER_WHITELIST.map((v) => perVer[v].all);
const eq = (x, y) => x.length === y.length && x.every((n, i) => n === y[i]);
if (!eq(a1457, a1458)) {
  console.error('[extract-vanity-effects] 1457↔1458 all 集漂移（1458 SetDefaults 应零变更）→ 拒:',
    a1457.filter((n) => !a1458.includes(n)), '+', a1458.filter((n) => !a1457.includes(n)));
  process.exit(1);
}
if (!eq(a1456, a1457)) {
  console.error('[extract-vanity-effects] 1456↔1457 all 集漂移 → 拒（三版交叉闸）：',
    a1456.filter((n) => !a1457.includes(n)), '+', a1457.filter((n) => !a1456.includes(n)));
  process.exit(1);
}

// ── ③ 哨兵正负面 + 通路基数（④ 判别力自证） ─────────────────────────────
const SENTINELS_IN = [15, 16, 17, 18, 393, 395, 485, 497, 707, 708, 709, 861, 1987, 3036, 3037, 3084,
  3095, 3096, 3099, 3102, 3110, 3118, 3119, 3120, 3121, 3122, 3123, 3293, 3300, 3308, 3581, 3929,
  3989, 4242, 4248, 4255, 4563, 4762, 4874, 5000, 5075, 5076, 5113, 5331, 5452, 5547];
for (const v of SENTINELS_IN) {
  if (!a1457.includes(v)) throw new Error(`锚断言失败[哨兵正面]: vid ${v} 应在 hasVanityEffects 全集`);
}
for (const v of [4, 239]) {
  if (a1457.includes(v)) throw new Error(`锚断言失败[哨兵负面]: vid ${v} 不应在全集（4 无配饰面/239=vanity 无特效）`);
}
const m1457 = perVer[1457].meta;
const CARD = { infoAccessoryLines: 22, golfBallLines: 15, musicBoxLines: 85 };
for (const [k, want] of Object.entries(CARD)) {
  if (m1457.counts[k] !== want) {
    throw new Error(`锚断言失败[通路基数 ${k}]: ${m1457.counts[k]} ≠ ${want}（源码置位面漂移 → 先定谳再扩表）`);
  }
}
// 字面 vid 数=33（18 站中 3293-3308 共站 16 件）
const literalVids = a1457.filter((v) => perVer[1457].vids.get(v).evidence.some((e) => e.endsWith('literal-true')));
if (literalVids.length !== 33) throw new Error(`锚断言失败[字面 vid 数]: ${literalVids.length} ≠ 33`);
if (m1457.literalTrueStations !== 18) throw new Error(`锚断言失败[字面站数]: ${m1457.literalTrueStations} ≠ 18`);

// ── van 同置扣除（数据面实压位；非 vanilla vanity 字面——音乐盒族勘误见头注） ──
const stats = JSON.parse(readFileSync(ITEMSTATS, 'utf8'));
const vanCoSet = a1457.filter((v) => stats[String(v)]?.van === true || stats[String(v)]?.van === 1);
const social = a1457.filter((v) => !vanCoSet.includes(v));
// S7 简报七件扣除面复验（3581/3929/4563/4762/5075/5076/1987——van 臂实压）
for (const v of [3581, 3929, 4563, 4762, 5075, 5076, 1987]) {
  if (!vanCoSet.includes(v)) throw new Error(`锚断言失败[van 同置件]: vid ${v} 现库无 van 键 → 扣除面漂移,需重定谳`);
}
// 音乐盒族双向锚（★BJ744 改判史：S7 留集锚前提灭失——BJ740 ACC16 数据面修正后
// 音乐盒带 van 键,按通用规则扣除;警示 parity 由 van 臂独立承载,见头注）：
//   ①承运面——音乐盒 vid 必须在 all 集（DefaultToMusicBox 通路 85 站 101 vid,
//     M3 判别面:通路旗摘除即红）;
//   ②数据面——音乐盒 vid 必须带 van=1（itemstats 回退/漂移即 fail-loud,需重定谳
//     勿静默;扣除态由通用规则 social=all−vanCoSet 构造性保证,不另设锚=M4 变异
//     「摘扣除判定」须工具自绿的判别设计）。
for (const v of [562, 574, 1596, 1610, 6144]) {
  if (!a1457.includes(v)) throw new Error(`锚断言失败[音乐盒承运]: vid ${v} 不在 all 集 → DefaultToMusicBox 通路失守（85 站 101 vid 承运面）`);
  if (stats[String(v)]?.van !== 1) throw new Error(`锚断言失败[音乐盒 van 臂]: vid ${v} 现库无 van=1 键 → itemstats 数据面漂移（BJ740 ACC16 域）,需重定谳`);
}

const product = {
  _meta: {
    generator: 'tools/extract-vanity-effects.mjs',
    source: 'Terarria{1456,1457,1458}/Terraria/Item.cs SetDefaults 三通路（字面/DefaultToInfoAccessory/DefaultToGolfBall/DefaultToMusicBox）',
    knife: 'BJ260 (2026-09-22) S7 漏修#1 根治',
    deduction: 'social = all − {vids with vanilla-itemstats van 键（van 臂实压位）};音乐盒族随 BJ740 ACC16 van 键落位按通用规则扣除（BJ744 改判史见工具头注）',
    crossCheck: '1456/1457/1458 all 集逐 vid 全等',
    counts: { all: a1457.length, social: social.length, vanCoSet: vanCoSet.length, ...m1457.counts, literalVids: literalVids.length },
    anchorLines: { signature: m1457.signatureLine },
    sentinelProbes: { in: SENTINELS_IN, out: [4, 239] },
  },
  all: a1457,
  social,
};

// ── 输出通道 ─────────────────────────────────────────────────────────────
const serialized = JSON.stringify(product, null, 2) + '\n';
if (SW_OUT) {
  mkdirSync(SW_OUT, { recursive: true });
  const out = join(SW_OUT, 'vanilla-vanity-effects.json');
  writeFileSync(out, serialized);
  console.log(`[extract-vanity-effects] 沙箱写出: ${out}`);
} else if (WRITE_REAL) {
  writeFileSync(PRODUCT, serialized);
  console.log(`[extract-vanity-effects] 真库写出: ${PRODUCT}`);
}
console.log(`[extract-vanity-effects] all=${a1457.length} social=${social.length} vanCoSet=${vanCoSet.length} ` +
  `字面站=${m1457.literalTrueStations}/字面vid=${literalVids.length} infoAcc=${m1457.counts.infoAccessoryLines}站/${m1457.counts.infoAccessoryVids}vid ` +
  `golf=${m1457.counts.golfBallLines}站 musicBox=${m1457.counts.musicBoxLines}站/${m1457.counts.musicBoxVids}vid（三版交叉全等）`);
// 干跑对拍：现库存在时逐 vid diff（零漂移=exit 0）
if (!SW_OUT && !WRITE_REAL && existsSync(PRODUCT)) {
  const cur = JSON.parse(readFileSync(PRODUCT, 'utf8'));
  const curSocial = cur.social ?? [];
  const miss = social.filter((v) => !curSocial.includes(v));
  const extra = curSocial.filter((v) => !social.includes(v));
  if (miss.length || extra.length) {
    console.error(`[extract-vanity-effects] 现库漂移 → exit 1：缺 ${miss} / 多 ${extra}（重产须 --write-real 显式通道）`);
    process.exit(1);
  }
  console.log('[extract-vanity-effects] 干跑对拍：现库 social 集零漂移');
}
