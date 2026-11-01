// ★G40-A(bj743a 登记债 D1+D2 清偿,2026-11-01)census 锁:fs 守卫旁路面零命中看守。
//
// BJ743-A 已收口三旁路(fs/promises 别名/URL 形/tools 路由域),但登记两面「零命中
// 暂无实害」的回潮面无锁:
//  · D1:tools/ 域 createRequire 形——`createRequire(...)(...)('node:fs')` 拿原生
//    require 读 src,vitest alias 不达(与 BJ743-A A3 字面 require 面同根)。
//    现状:tools 内 createRequire 仅两处(recon-armorset/extract-monolith-ast),
//    均只 require typescript/esbuild,零 fs 面。
//  · D2:node:fs 回调式 readFile 与 fs.promises 命名空间形——fs-guard-shim 只守
//    readFileSync,fs-promises-shim 只守 node:fs/promises 模块形;`readFile`(cb)
//    与 `X.promises.readFile`(X 为 node:fs 绑定)直通真 fs。tests/ 域零使用。
// 守卫形态=census(出现即红,红字指引改 ESM import 形/守卫面)——与 BJ743-A §4
// require 直读者 census 同 idiom。探测器自带正控夹具(每危险形一例,证探测器活)。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(here, '..');
const TOOLS = join(GAME_ROOT, '..', 'tools');

// ---------------------------------------------------------------------------
// 探测器(纯函数,正控夹具自证)
// ---------------------------------------------------------------------------

/** D1:tools 源内 createRequire 形/字面 require 形获取 fs 的旁路面。
 *  三形:①const N = createRequire(...) 后 N('fs'|'node:fs');②inline 链
 *  createRequire(...)('fs'|'node:fs');③字面 require('fs'|'node:fs')(ESM 内
 *  本非法,vite CJS interop 注入面=BJ743-A A3 同根)。 */
export function scanToolsCreateRequireFs(src: string): string[] {
  const offenders: string[] = [];
  const lines = src.split('\n');
  const nsIds = new Set<string>();
  lines.forEach((line, i) => {
    const bind = /(?:const|let|var)\s+(\w+)\s*=\s*createRequire\s*\(/.exec(line);
    if (bind) nsIds.add(bind[1]!);
    if (/createRequire\s*\([^)]*\)\s*\(\s*(['"])(?:node:)?fs\1\s*\)/.test(line)) {
      offenders.push(`${i + 1} inline 链 createRequire(...)('fs')`);
    }
    if (/require\s*\(\s*(['"])(?:node:)?fs\1\s*\)/.test(line)) {
      offenders.push(`${i + 1} 字面 require('fs')`);
    }
  });
  if (nsIds.size) {
    const re = new RegExp(`\\b(?:${[...nsIds].map((n) => n.replace(/\$/g, '\\$')).join('|')})\\s*\\(\\s*(['"])(?:node:)?fs\\1\\s*\\)`);
    lines.forEach((line, i) => {
      if (re.test(line)) offenders.push(`${i + 1} createRequire 绑定 require('fs')`);
    });
  }
  return offenders;
}

/** D2:tests 源内 node:fs 回调式 readFile / fs.promises 命名空间形旁路面。
 *  合法形(剥离后再查残):①(await import('node:fs/promises')).readFile(;
 *  ②const X = await import('node:fs/promises') 后 X.readFile(;③static
 *  import { readFile } from 'node:fs/promises'。非法:static import readFile
 *  from 'node:fs';X.promises.readFile((任何路由——fs/promises 模块无 .promises
 *  子面,此形恒指 node:fs 命名空间);剥离后残余裸 readFile。 */
export function scanTestsReadFileBypass(src: string): string[] {
  const offenders: string[] = [];
  // ①静态 import readFile from 裸 fs(解构形,别名亦中——{} 内含 readFile 词)
  if (/import\s*\{[^}]*\breadFile\b[^}]*\}\s*from\s*(['"])(?:node:)?fs\1/.test(src)) {
    offenders.push('静态 import { readFile } from node:fs(回调式直通)');
  }
  // ②.promises.readFile 形(恒 node:fs 命名空间)
  let m: RegExpExecArray | null;
  const promRe = /\.promises\s*\.\s*readFile\s*\(/g;
  while ((m = promRe.exec(src)) !== null) {
    offenders.push(`.promises.readFile( @ char ${m.index}`);
  }
  // ③剥离合法形后查残余裸 readFile(动态 fs/promises 内联/绑定、静态 fs/promises)
  let stripped = src;
  stripped = stripped.replace(/\(?\s*await\s+import\(\s*(['"])node:fs\/promises\1\s*\)\s*\)?\s*\.\s*readFile\s*\(/g, '«OK»');
  const bindRe = /(?:const|let|var)\s+(\w+)\s*=\s*await\s+import\(\s*(['"])node:fs\/promises\2\s*\)/g;
  const boundIds = new Set<string>();
  while ((m = bindRe.exec(stripped)) !== null) boundIds.add(m[1]!);
  for (const id of boundIds) {
    stripped = stripped.replace(new RegExp(`\\b${id}\\s*\\.\\s*readFile\\s*\\(`, 'g'), '«OK»');
  }
  stripped = stripped.replace(/import\s*\{[^}]*\breadFile\b[^}]*\}\s*from\s*(['"])(?:node:)?fs\/promises\1/g, '«OK»');
  stripped = stripped.replace(/import\s+(\w+)\s+from\s*(['"])(?:node:)?fs\/promises\2/g, (full, id: string) => {
    boundIds.add(id);
    return '«OK»';
  });
  // 默认导入绑定 X.readFile( 形(X 为 fs/promises default)
  for (const id of boundIds) {
    stripped = stripped.replace(new RegExp(`\\b${id}\\s*\\.\\s*readFile\\s*\\(`, 'g'), '«OK»');
  }
  // 残余裸 readFile(排除 readFileSync——\b 词界天然排除)
  const resRe = /\breadFile\b/g;
  while ((m = resRe.exec(stripped)) !== null) {
    offenders.push(`残余裸 readFile @ char ${m.index}`);
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// 正控夹具:每危险形一例,证探测器非恒绿
// ---------------------------------------------------------------------------
describe('G40-A census 探测器正控(危险形全数命中)', () => {
  it('D1 探测器:createRequire 绑定/inline 链/字面 require 三形', () => {
    expect(scanToolsCreateRequireFs(
      `import { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\nconst fs = req('node:fs');\n`,
    ).length).toBe(1);
    expect(scanToolsCreateRequireFs(
      `const fs = createRequire(import.meta.url)('fs');\n`,
    ).length).toBe(1);
    const reqLit = String.fromCharCode(114, 101, 113, 117, 105, 114, 101);   // require 七字符
    // ★G40 改判史:正控夹具字符串须写成「不被 BJ743 §4 census 扫中」的拼接形——
    //   两个守卫锁(census 互扫)同仓共存,探测器字面量会被对方的 require 直读扫描命中
    expect(scanToolsCreateRequireFs(
      `const { readFileSync } = ${reqLit}('node:fs');\n`,
    ).length).toBe(1);
    expect(scanToolsCreateRequireFs(
      `const { readFileSync } = ${reqLit}('node:fs');\n`,
    ).length).toBe(1);
    // 阴性:typescript/esbuild 合法 require 不中
    expect(scanToolsCreateRequireFs(
      `const require_ = createRequire(import.meta.url);\nconst ts = require_('typescript');\n`,
    )).toEqual([]);
  });

  it('D2 探测器:静态裸 fs import/.promises 形/绑定后残余 readFile 三形', () => {
    expect(scanTestsReadFileBypass(`import { readFile } from 'node:fs';\n`).length).toBeGreaterThanOrEqual(1);
    // .promises 形双报(形态位+残余裸 readFile 位)——同一行两条红字,非误报
    expect(scanTestsReadFileBypass(`const x = fs.promises.readFile(SRC);\n`).length).toBe(2);
    expect(scanTestsReadFileBypass(
      `const fs = await import('node:fs');\nconst src = fs.readFile(SRC, cb);\n`,
    ).length).toBeGreaterThanOrEqual(1);
    // 阴性:三种守卫面合法形零命中
    expect(scanTestsReadFileBypass(
      `const src = await (await import('node:fs/promises')).readFile('src/core/Game.ts', 'utf8');\n`,
    )).toEqual([]);
    expect(scanTestsReadFileBypass(
      `const fs = await import('node:fs/promises');\nconst src = await fs.readFile('src/core/Game.ts', 'utf8');\n`,
    )).toEqual([]);
    expect(scanTestsReadFileBypass(
      `import { readFile } from 'node:fs/promises';\nimport { readFileSync } from 'node:fs';\n`,
    )).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// census 本体(零命中面看守)
// ---------------------------------------------------------------------------
function walkTools(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkTools(p, out);
    else if (/\.(mjs|ts)$/.test(name.name) && !name.name.startsWith('_')) out.push(p);
  }
  return out;
}

describe('G40-A census:fs 守卫旁路面零命中(bj743a D1+D2 清偿)', () => {
  it('D1:tools/ 非 _ 文件零 createRequire/require 取 fs 面', () => {
    const offenders: string[] = [];
    for (const f of walkTools(TOOLS)) {
      const hits = scanToolsCreateRequireFs(readFileSync(f, 'utf8'));
      for (const h of hits) offenders.push(`${f}:${h}`);
    }
    expect(offenders, `tools/ createRequire 形 fs 旁路回潮(改 ESM import 经 shim,或守卫面扩 shim): ${offenders.join('; ')}`).toEqual([]);
  });

  it('D2:非 _ tests/*.test.ts 零回调式 readFile / fs.promises 命名空间形', () => {
    const offenders: string[] = [];
    for (const f of readdirSync(here)) {
      if (!f.endsWith('.test.ts') || f.startsWith('_')) continue;
      // 本文件与 bj743a-guard-bypass 自含探测器模式串(注释/正则源)=结构性自指,豁免
      if (f === 'g40a-census-locks.test.ts' || f === 'bj743a-guard-bypass.test.ts') continue;
      const hits = scanTestsReadFileBypass(readFileSync(join(here, f), 'utf8'));
      for (const h of hits) offenders.push(`${f}: ${h}`);
    }
    expect(offenders, `tests/ 回调式 readFile / fs.promises 形回潮(改 node:fs/promises ESM import 或 readFileSync 经 shim): ${offenders.join('; ')}`).toEqual([]);
  });
});
