#!/usr/bin/env node
// mod 注册表生成器(2026-10-24 商店基建):遍历 mods/*/mod.json → registry.json。
// 用法:node tools/gen-mod-registry.mjs [modsDir=mods] [--out <path>]
// 单仓 CI merge→构建 swmod→本工具再生索引→部署 CDN(商店三层解耦的索引层)。
// schema v2 字段:minEngine(引擎兼容下限)/category/tags/dependencies。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
// 仓内形态:mod 平铺在根目录(mods-core);Open-Terraria 侧则传 mods/ 实参。
// 缺省=若根有 mod.json 平铺则扫根,否则扫 mods/
const root = resolve('.');
const flat = readdirSync(root, { withFileTypes: true })
  .some(e => e.isDirectory() && existsSync(join(root, e.name, 'mod.json')));
const modsDir = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : (flat ? root : resolve('mods'));
const outIdx = args.indexOf('--out');
// --extra <json>:合并外部条目(calamity 占位/独立 -port 仓发布通道)——
// 商店三层解耦的「多源发布」口:独立仓 CI 构建产物后,把自己的条目
// (含 artifact.sha256)PR 进本仓 extra/ 目录或直接传 --extra 合并。
const extraIdx = args.indexOf('--extra');
const extraPath = extraIdx >= 0 ? args[extraIdx + 1] : null;
const outPath = outIdx >= 0 ? args[outIdx + 1] : join(modsDir, '..', 'registry.json');

const REQUIRED = ['id', 'name', 'version', 'author', 'description', 'minEngine', 'category'];
const mods = [];
for (const ent of readdirSync(modsDir, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  if (ent.name.startsWith('_') || ent.name === 'dist') continue;   // 工作目录/构建产物跳过
  const p = join(modsDir, ent.name, 'mod.json');
  if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  for (const k of REQUIRED) {
    if (j[k] === undefined) { console.error(`[registry] ✗ ${ent.name}/mod.json 缺必填字段 ${k}`); process.exit(1); }
  }
  if (!/^[a-z0-9_]+$/.test(j.id)) { console.error(`[registry] ✗ ${ent.name}: id 须为 [a-z0-9_](商店键域)`); process.exit(1); }
  // icon 校验(商店卡片必需)
  if (!existsSync(join(modsDir, ent.name, 'icon.png'))) console.warn(`[registry] ⚠ ${j.id} 无 icon.png`);
  // swmod 产物哈希(在则登记;CI 构建后重跑本工具补全)
  const swmod = join(modsDir, 'dist', `${j.id}.swmod`);
  const sha = existsSync(swmod)
    ? createHash('sha256').update(readFileSync(swmod)).digest('hex') : null;
  mods.push({
    id: j.id, name: j.name, version: j.version, author: j.author,
    description: j.description, api: j.api, side: j.side,
    minEngine: j.minEngine, category: j.category, tags: j.tags ?? [],
    dependencies: j.dependencies ?? [],
    ...(sha ? { artifact: { file: `${j.id}.swmod`, sha256: sha } } : {}),
  });
}
mods.sort((a, b) => a.id.localeCompare(b.id));
if (extraPath && existsSync(extraPath)) {
  const extra = JSON.parse(readFileSync(extraPath, 'utf8'));
  const ids = new Set(mods.map(m => m.id));
  for (const m of (Array.isArray(extra) ? extra : extra.mods ?? [])) {
    if (ids.has(m.id)) { console.warn('[registry] ⚠ extra 覆盖已有条目: ' + m.id); }
    mods.push(m);
  }
  mods.sort((a, b) => a.id.localeCompare(b.id));
}
const reg = { schema: 2, generatedAt: new Date().toISOString(), mods };
writeFileSync(outPath, JSON.stringify(reg, null, 2) + '\n');
console.log(`[registry] ✓ ${mods.length} mods → ${outPath}`);
