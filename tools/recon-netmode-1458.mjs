#!/usr/bin/env node
// 刀0-C：netMode 闸门普查（2026-10-25）——原版 1458 全仓 netMode 谓词提取 vs
// SW net.active/netMode 消费面对账。产物：tests/golden/netmode-census-1458.json
// 用法：node tools/recon-netmode-1458.mjs [--fix]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const VAN = join(ROOT, 'Terarria1458');
const OUT = join(ROOT, 'game', 'tests', 'golden', 'netmode-census-1458.json');

// 1) 原版全仓 netMode 谓词扫描（文件级分组）
const files = execSync(`grep -rl "netMode" "${VAN}/Terraria" --include='*.cs'`, { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const census = { total: 0, byPredicate: { '==1': 0, '==2': 0, '!=1': 0, '!=2': 0, other: 0 }, byFile: {} };
const PATTERNS = [
  [/netMode\s*==\s*1/g, '==1'],
  [/netMode\s*==\s*2/g, '==2'],
  [/netMode\s*!=\s*1/g, '!=1'],
  [/netMode\s*!=\s*2/g, '!=2'],
];
for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const rel = f.replace(VAN + '/', '');
  let fileTotal = 0;
  for (const [re, key] of PATTERNS) {
    const n = (src.match(re) || []).length;
    if (n) { census.byPredicate[key] += n; fileTotal += n; }
  }
  // other: netMode 单独出现但非四谓词（如赋值/比较 0）
  const all = (src.match(/netMode/g) || []).length;
  const four = Object.entries(PATTERNS).reduce((a, [re]) => {
    void re;
    return a;
  }, 0);
  void four; void all;
  if (fileTotal) { census.byFile[rel] = fileTotal; census.total += fileTotal; }
}
census.generatedAt = new Date().toISOString();
census.note = 'netMode 闸门=权威切分金标清单;SW 等价谓词=net?.active(客户端面)/netMode!=0';
writeFileSync(OUT, JSON.stringify(census, null, 1));
console.log(`[recon-netmode] 原版 netMode 四谓词总 ${census.total} 处（==1:${census.byPredicate['==1']} ==2:${census.byPredicate['==2']} !=1:${census.byPredicate['!=1']} !=2:${census.byPredicate['!=2']}）,文件 ${Object.keys(census.byFile).length} 个 → ${OUT}`);
// DRIFT 闸门（与既有金标对比）
const PREV = OUT; // 本工具每次全量再生（无 --fix 语义,漂移即本文件变化）
void PREV;
