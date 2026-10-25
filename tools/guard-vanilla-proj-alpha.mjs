#!/usr/bin/env node
/**
 * ★BJ236 写后自证守卫（2026-09-21）——src/data/vanillaProjAlpha.ts 文件级指纹闸。
 *
 *  债源（BJ228 事故判例）：truncate-then-write 曾把 300 项表整体截短，恢复快照又缺
 *  114 项——运行时普查锁（tests/bj228-getalpha-census.test.ts 键计数）挡不住
 *  「合法解析但缺项/缩表」的静默损伤，文件级指纹必须独立钉死。
 *
 *  断言面（四道，缺一即 exit 1）：
 *   ① wc -l 行数 = PIN_LINES（本文件内钉死常量）；
 *   ② 表闭合 = 文件（trimEnd 后）以 `};` 收尾——截断即爆红；
 *   ③ 表项数 = PIN_ENTRIES=300 且键唯一（与运行时普查锁双保险,文件级解析
 *     不依赖模块加载/bundler 缓存）；
 *   ④ 末项 = PIN_LAST_ID=1110 且值行前缀钉死——尾部追加/删尾即爆红。
 *
 *  重钉流程：合法编辑（补注释/接线登记）后跑
 *      node tools/guard-vanilla-proj-alpha.mjs --re-pin
 *  自动把最新 wc-l 写回本文件 PIN_LINES（--dry 只打印）。重钉 diff 必须只含
 *  PIN_LINES 一行——越界说明编辑破坏了表结构,先修表再重钉。行数之外的三道
 *  （闭合/300 唯一/末项）为结构断言,合法编辑永不变,无需重钉。
 *
 *  用法：node tools/guard-vanilla-proj-alpha.mjs [--re-pin] [--dry] [--file <path>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GUARD_FILE = 'src/data/vanillaProjAlpha.ts';
export const PIN_LINES = 529;
export const PIN_ENTRIES = 300;
export const PIN_LAST_ID = 1110;
/** 末项值前缀钉死（kind/rgba/off 三要素;行尾注释不参与比对） */
export const PIN_LAST_PREFIX = "1110: { kind: 'fixedfade', rgba: [255,255,255,128], off: 1 },";

/**
 * 纯守卫核（CLI 与变异自测共用）。返回 { ok, errors, lineCount, entryCount }。
 * @param {string} text 表文件全文
 * @param {number} [pinLines] 行数钉死值（缺省用本文件 PIN_LINES）
 */
export function guardProjAlpha(text, pinLines = PIN_LINES) {
  const errors = [];
  // ① 行数（wc -l 语义 = 换行符计数）
  const lineCount = (text.match(/\n/g) ?? []).length + (text.endsWith('\n') ? 0 : 1);
  if (lineCount !== pinLines) {
    errors.push(`[wc-l] 行数 ${lineCount} ≠ 钉死值 ${pinLines}（合法编辑请 --re-pin;若未编辑=文件被截断/膨胀）`);
  }
  // ② 表闭合
  const tail = text.replace(/\s+$/, '');
  if (!tail.endsWith('};')) {
    errors.push('[closure] 文件不以 `};` 收尾——表截断（truncate-then-write 事故指纹）');
  }
  // ③ 表项数 + 键唯一（匹配行首两空格 + 数字键 + `: {` 的表项行）
  const entryRe = /^  (\d+): \{/gm;
  const keys = [];
  let m;
  while ((m = entryRe.exec(text)) !== null) keys.push(Number(m[1]));
  const uniq = new Set(keys);
  if (keys.length !== PIN_ENTRIES) {
    errors.push(`[count] 表项数 ${keys.length} ≠ ${PIN_ENTRIES}`);
  }
  if (uniq.size !== keys.length) {
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    errors.push(`[unique] 键重复：${dup}`);
  }
  // ④ 末项钉死
  const lastKey = keys.length > 0 ? keys[keys.length - 1] : -1;
  if (lastKey !== PIN_LAST_ID) {
    errors.push(`[last-key] 末项键 ${lastKey} ≠ ${PIN_LAST_ID}`);
  } else {
    const lastLine = text.split('\n').find((l) => l.trimStart().startsWith(`${PIN_LAST_ID}: {`));
    if (!lastLine || !lastLine.trimStart().startsWith(PIN_LAST_PREFIX)) {
      errors.push(`[last-value] 末项值前缀不匹配：期望 "${PIN_LAST_PREFIX}"`);
    }
  }
  return { ok: errors.length === 0, errors, lineCount, entryCount: keys.length };
}

function main() {
  const args = process.argv.slice(2);
  const rePin = args.includes('--re-pin');
  const dry = args.includes('--dry');
  const fileIdx = args.indexOf('--file');
  const rel = fileIdx >= 0 ? args[fileIdx + 1] : GUARD_FILE;
  const abs = resolve(process.cwd(), rel);
  const text = readFileSync(abs, 'utf8');
  const r = guardProjAlpha(text);
  console.log(`guard ${rel}: lines=${r.lineCount} entries=${r.entryCount}`);
  if (r.ok) {
    console.log('GUARD GREEN');
    return 0;
  }
  if (rePin && r.errors.every((e) => e.startsWith('[wc-l]'))) {
    if (dry) {
      console.log(`DRY: PIN_LINES = ${r.lineCount};`);
    } else {
      const selfPath = fileURLToPath(import.meta.url);
      const self = readFileSync(selfPath, 'utf8');
      const patched = self.replace(/export const PIN_LINES = \d+;/, `export const PIN_LINES = ${r.lineCount};`);
      writeFileSync(selfPath, patched);
      console.log(`RE-PINNED: PIN_LINES ${PIN_LINES} -> ${r.lineCount}（重钉 diff 必须只含本行）`);
    }
    return 0;
  }
  for (const e of r.errors) console.error(`GUARD RED ${e}`);
  return 1;
}

const thisPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisPath) {
  process.exit(main());
}
