#!/usr/bin/env node
// 原版网络协议权威对账闸门（recon 工具链新员，2026-10-24）
// 战役：SW 客户端直连原版 1.4.5.8 服务器（定谳档 memory/vanilla-server-interop-scope）。
// 从 Terarria1458 反编译机械提取：①163 消息的读侧 case（MessageBuffer.GetData switch(b)）
// 与写侧 case（NetMessage.SendData 双 switch(msgType)：早退改写开关 + 主序列化开关），
// 含 raw 字节切片+读写操作序列；②NetModule 注册表（注册序即 ID，
// NetworkInitializer.cs）；③帧语义与握手状态机 preamble。
// 任何反编译树替换/手改/未来版本网络面漂移，本闸门当场爆红。
//
// ★帧语义定谳（NetMessage.cs CheckBytes:2548-2570，2026-10-24 rig 实弹复核）：
//   [u16 frameLen LE][u8 msgId][payload]，frameLen=全帧字节数【含 len 头自身 2B】；
//   GetData(start+2, len-2)；整帧推进 len 字节；len<3 非法；读侧 BinaryReader 不按帧
//   定界（len 写短会串帧读越界——rig 探针判例：len=body 恰因字符串读满缓冲侥幸通过）。
//   ⚠ multiplayer-design.md §1.1「对齐原版 [u16 len][u8 msgId]」的 len 语义与原版不同
//   （SW 自有协议 len=body 自洽无碍，互操作时禁止照搬）。
//
// ★写侧结构判例：SendData 含两个 switch(msgType)——早退开关（NetMessage.cs:87，case21
//   可改写 msgType=151/提前 return、case28 可伴生 SendData(23)）+ 主开关（:130）。
//   切片算法：N 层花括号配平（switch 独占行缩进 N；case 标签与 case 块花括号独占
//   N 缩进行；语句永不低于 N+1——反编译风格实测如此，minCases 兜底防切错）。
//
// 用法（game/ 目录下）：
//   node tools/recon-net-1458.mjs            # 校验：重提取与盘上金标比对，DRIFT>0 退出码 1
//   node tools/recon-net-1458.mjs --fix      # 再生并覆写金标（升版本/首冻时用，diff 须人工过目）
//   node tools/recon-net-1458.mjs --verbose  # 打印摘要统计
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd(); // 期望 = game/
const DECOMP = path.join(ROOT, '..', 'Terarria1458');
const MID_CS = path.join(DECOMP, 'Terraria.ID', 'MessageID.cs');
const MB_CS = path.join(DECOMP, 'Terraria', 'MessageBuffer.cs');
const NM_CS = path.join(DECOMP, 'Terraria', 'NetMessage.cs');
const MAIN_CS = path.join(DECOMP, 'Terraria', 'Main.cs');
const NETINIT_CS = path.join(DECOMP, 'Terraria.Initializers', 'NetworkInitializer.cs');
const NETMODULES_DIR = path.join(DECOMP, 'Terraria.GameContent.NetModules');
const GAMECONTENT_DIR = path.join(DECOMP, 'Terraria.GameContent');
const GOLDEN = path.join(ROOT, 'tests', 'golden', 'net-protocol-1458.json');

const FIX = process.argv.includes('--fix') || process.argv.includes('--update');
const VERBOSE = process.argv.includes('--verbose');

function must(cond, msg) {
  if (!cond) { console.error('FATAL: ' + msg); process.exit(2); }
}
for (const f of [MID_CS, MB_CS, NM_CS, MAIN_CS, NETINIT_CS]) {
  must(fs.existsSync(f), `反编译源缺失 ${f}（repo 根应有 Terarria1458/）`);
}

// ---------- ① MessageID 表 ----------
function extractMessageIds() {
  const src = fs.readFileSync(MID_CS, 'utf8');
  const out = {};
  for (const m of src.matchAll(/public const byte (\w+) = (\d+);/g)) {
    must(!(m[2] in out), `MessageID 重复号 ${m[2]}`);
    out[Number(m[2])] = m[1];
  }
  const mc = /public static readonly byte Count = (\d+);/.exec(src);
  must(mc, 'MessageID.Count 未找到');
  return { ids: out, count: Number(mc[1]) };
}

// ---------- ② switch 切片（N 层花括号配平） ----------
// 返回 [{ids:[...], line, rawLines}]；连续 case 标签（无体）并为同组。
function sliceSwitch(lines, swLineIdx) {
  const m = /^(\t+)switch \((\w+)\)$/.exec(lines[swLineIdx]);
  must(m, `行 ${swLineIdx + 1} 不是 switch 独占行`);
  const N = m[1].length;
  const labelRe = new RegExp(`^\\t{${N}}case (\\d+):$`);
  const defRe = new RegExp(`^\\t{${N}}default:$`);
  const openRe = new RegExp(`^\\t{${N}}\\{$`);
  const closeRe = new RegExp(`^\\t{${N}}\\}$`);
  let depth = 0;
  const out = [];
  let cur = null;
  for (let i = swLineIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (openRe.test(l)) { depth++; continue; }
    if (closeRe.test(l)) { if (--depth <= 0) break; continue; }
    const lm = labelRe.exec(l);
    if (lm) {
      if (cur && cur.rawLines.length === 0) { cur.ids.push(Number(lm[1])); continue; }
      if (cur) out.push(cur);
      cur = { ids: [Number(lm[1])], line: i + 1, rawLines: [] };
      continue;
    }
    if (defRe.test(l)) {
      if (cur) out.push(cur);
      cur = { ids: ['default'], line: i + 1, rawLines: [] };
      continue;
    }
    if (cur) cur.rawLines.push(l);
  }
  if (cur) out.push(cur);
  return out;
}

function extractReaderCases(mbSrc) {
  const lines = mbSrc.split('\n');
  const idx = lines.findIndex((l) => l === '\t\tswitch (b)');
  must(idx >= 0, 'GetData 的 switch(b) 未找到');
  const groups = sliceSwitch(lines, idx);
  must(groups.length >= 100, `读侧 case 组仅 ${groups.length} < 100，疑似切错`);
  return { line: idx + 1, groups };
}

function extractWriterSwitches(nmSrc) {
  const lines = nmSrc.split('\n');
  const sigIdx = lines.findIndex((l) => /^	public static void SendData\(int msgType/.test(l));
  must(sigIdx >= 0, 'SendData 签名未找到');
  let end = lines.length;
  for (let i = sigIdx + 1; i < lines.length; i++) {
    if (/^\t(?:public|private|internal|protected) /.test(lines[i])) { end = i; break; }
  }
  // 候选 = 方法体内全部 switch(msgType)（实测 4 个：2tab 早退 :87 / 3tab 主 :130 /
  // 4tab ×2 嵌套于 case 体 = raw 内容）。目标 = 最浅层唯一(早退) 与 次浅层唯一(主)。
  const cands = [];
  for (let i = sigIdx; i < end; i++) {
    const m = /^(\t+)switch \(msgType\)$/.exec(lines[i]);
    if (!m) continue;
    const groups = sliceSwitch(lines, i);
    if (groups.length >= 2) cands.push({ indent: m[1].length, line: i + 1, groups });
  }
  const minIndent = Math.min(...cands.map((s) => s.indent));
  const early = cands.filter((s) => s.indent === minIndent);
  const main = cands.filter((s) => s.indent === minIndent + 1);
  must(early.length === 1, `最浅层 switch(msgType) 数 ${early.length} ≠ 1`);
  must(main.length === 1, `次浅层 switch(msgType) 数 ${main.length} ≠ 1`);
  return [early[0], main[0]]; // [0]=早退改写开关 [1]=主序列化开关
}

// ---------- ③ case 体特征提取 ----------
function featuresFromRaw(rawLines) {
  const raw = rawLines.map((l) => l.trim()).filter(Boolean).join('\n');
  const ops = [...raw.matchAll(/\breader\.Read([A-Za-z0-9]+)\(/g)].map((m) => 'Read' + m[1]);
  const writes = [...raw.matchAll(/\bwriter\.Write([A-Za-z0-9]*)\((.{0,48})/g)]
    .map((m) => (m[1] ? 'Write' + m[1] : 'Write') + ':' + m[2].trim().replace(/\s+/g, ' '));
  const sends = [...new Set(
    [...raw.matchAll(/\b(?:TrySendData|SendData)\((\d+)/g)].map((m) => Number(m[1]))
  )].sort((a, b) => a - b);
  const netModes = [...new Set([...raw.matchAll(/netMode\s*(?:==|!=)\s*[012]/g)].map((m) => m[0].replace(/\s+/g, '')))];
  const helpers = [...new Set(
    [...raw.matchAll(/\b([A-Za-z_][\w.]*)\(\s*(?:reader|writer)\b/g)].map((m) => m[1])
  )].sort();
  const loops = (raw.match(/\b(?:for|foreach|while)\s*\(/g) || []).length;
  const complex = loops > 2 || /\bswitch\s*\(/.test(raw);
  return { raw, ops, writes, sends, netModes, helpers, loops, complex };
}

// ---------- ④ 握手状态机 preamble（GetData 头部 → switch 前） ----------
function extractServerGatePreamble(mbSrc) {
  const i = mbSrc.indexOf('public void GetData(');
  must(i > 0, 'GetData 未找到');
  const s = mbSrc.indexOf('switch (b)', i);
  must(s > 0, 'GetData 内 switch(b) 未找到');
  return mbSrc.slice(i, s).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// ---------- ⑤ NetModule 注册表 ----------
function extractNetModules() {
  const src = fs.readFileSync(NETINIT_CS, 'utf8');
  const out = [];
  for (const m of src.matchAll(/Register<([\w.]+)>\(\)/g)) {
    const cls = m[1];
    const short = cls.includes('.') ? cls.split('.')[0] : cls;
    let file = null;
    for (const dir of [NETMODULES_DIR, GAMECONTENT_DIR]) {
      const p = path.join(dir, short + '.cs');
      if (fs.existsSync(p)) { file = path.relative(DECOMP, p); break; }
    }
    out.push({ id: out.length, class: cls, file });
  }
  must(out.length === 15, `NetModule 注册数 ${out.length} ≠ 15`);
  return out;
}

// ---------- 组装 ----------
const { ids: msgIds, count: msgCount } = extractMessageIds();
const mbSrc = fs.readFileSync(MB_CS, 'utf8');
const nmSrc = fs.readFileSync(NM_CS, 'utf8');

const readerCases = extractReaderCases(mbSrc);
const writerSwitches = extractWriterSwitches(nmSrc);

const readerById = new Map();
for (const g of readerCases.groups) for (const id of g.ids) readerById.set(id, g);
const writerPreById = new Map();
for (const g of writerSwitches[0].groups) for (const id of g.ids) writerPreById.set(id, g);
const writerById = new Map();
for (const g of writerSwitches[1].groups) for (const id of g.ids) writerById.set(id, g);

const curRelease = Number(/public const int curRelease = (\d+);/.exec(fs.readFileSync(MAIN_CS, 'utf8'))[1]);

const messages = {};
for (const id of Object.keys(msgIds).map(Number).sort((a, b) => a - b)) {
  const r = readerById.has(id) ? featuresFromRaw(readerById.get(id).rawLines) : null;
  const wp = writerPreById.has(id) ? featuresFromRaw(writerPreById.get(id).rawLines) : null;
  const w = writerById.has(id) ? featuresFromRaw(writerById.get(id).rawLines) : null;
  messages[id] = {
    name: msgIds[id],
    readerLine: readerById.has(id) ? readerById.get(id).line : null,
    writerPreLine: writerPreById.has(id) ? writerPreById.get(id).line : null,
    writerLine: writerById.has(id) ? writerById.get(id).line : null,
    readerOps: r ? r.ops : null,
    writerOps: w ? w.writes : null,
    respondsWith: r ? r.sends : null,
    netModeGates: [...new Set([...(r ? r.netModes : []), ...(wp ? wp.netModes : []), ...(w ? w.netModes : [])])],
    helpers: [...new Set([...(r ? r.helpers : []), ...(wp ? wp.helpers : []), ...(w ? w.helpers : [])])].sort(),
    loops: (r ? r.loops : 0) + (wp ? wp.loops : 0) + (w ? w.loops : 0),
    complex: Boolean(r && r.complex) || Boolean(wp && wp.complex) || Boolean(w && w.complex),
    readerRaw: r ? r.raw : null,
    writerPreRaw: wp ? wp.raw : null,
    writerRaw: w ? w.raw : null,
  };
}

const manifest = {
  meta: {
    version: '1458',
    curRelease,
    helloString: 'Terraria' + curRelease,
    messageCount: msgCount,
    framing: {
      format: '[u16 frameLen LE][u8 msgId][payload]',
      frameLenIncludesSelf: true,
      minFrameLen: 3,
      maxFrameLen: 65535,
      anchors: ['NetMessage.cs:2548-2570 CheckBytes', 'NetMessage.cs SendData 头(Position+=2 → 回填)'],
      note: '读侧 BinaryReader 不按帧定界；SW 自有协议 len=body 语义不同,互操作禁止照搬',
    },
    serverHandshakeGate: extractServerGatePreamble(mbSrc),
  },
  netModules: extractNetModules(),
  messages,
};

// ---------- 校验/落盘 ----------
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

const haveReader = Object.values(messages).filter((m) => m.readerRaw).length;
const haveWriter = Object.values(messages).filter((m) => m.writerRaw).length;
const haveWriterPre = Object.values(messages).filter((m) => m.writerPreRaw).length;
const complexN = Object.values(messages).filter((m) => m.complex).length;

if (VERBOSE) {
  console.log(`消息总数 ${msgCount}（MessageID.Count）；读侧 ${haveReader} / 主写侧 ${haveWriter} / 早退写侧 ${haveWriterPre} / complex ${complexN}`);
  console.log(`NetModule 表（注册序即 ID）:`);
  for (const m of manifest.netModules) console.log(`  ${String(m.id).padStart(2)}  ${m.class}${m.file ? '  (' + m.file + ')' : ''}`);
  const gate = manifest.meta.serverHandshakeGate.split('\n').filter((l) => /State|BootPlayer/.test(l));
  console.log('握手门摘要:', gate.slice(0, 5).join(' | '));
}

if (FIX) {
  fs.writeFileSync(GOLDEN, JSON.stringify(manifest, null, 1) + '\n');
  console.log(`已再生金标 ${path.relative(ROOT, GOLDEN)}（${msgCount} 消息 / ${manifest.netModules.length} 模块 / 读${haveReader} 主写${haveWriter} 早退写${haveWriterPre} / complex ${complexN}）`);
  process.exit(0);
}

must(fs.existsSync(GOLDEN), `金标缺失 ${GOLDEN}，先跑 --fix 首冻（diff 人工过目后提交）`);
const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
if (stableStringify(golden) === stableStringify(manifest)) {
  console.log(`DRIFT=0 ✓（${msgCount} 消息 / ${manifest.netModules.length} 模块 / 读${haveReader} 主写${haveWriter} 早退写${haveWriterPre} / complex ${complexN}）`);
  process.exit(0);
}
console.error('DRIFT>0 ✗ 网络协议金标漂移：');
if (stableStringify(golden.meta) !== stableStringify(manifest.meta)) console.error('  - meta/帧语义/握手门 变更');
if (stableStringify(golden.netModules) !== stableStringify(manifest.netModules)) console.error('  - NetModule 注册表变更');
for (const id of Object.keys(manifest.messages)) {
  if (stableStringify(golden.messages?.[id]) !== stableStringify(manifest.messages[id])) {
    console.error(`  - msg ${id} (${manifest.messages[id].name})`);
  }
}
console.error('先定谳再动刀：diff tests/golden/net-protocol-1458.json 确认是反编译树变更还是手改；升版本走 --fix 并人工过目。');
process.exit(1);
