// ★BJ743-A（2026-10-31）守卫旁路三族收口的判别锁——BJ725-F 六相锁（tests/
// mut-read-guard.test.ts）的扩展面。R24 SEV-2 / R23-LOW-4 互证定谳的三个旁路面：
//   ①node:fs/promises：原 alias find=/^(node:)?fs$/ 不匹配 → readFile 直读真盘
//     （sw-bj10/29/30/31/31b/32/49 结构锁读 src 面 ~17 站）——扩 alias + 异步守卫
//     readFileGuarded（五档同构,同步探锁定靶/异步读靶,备份写时序定谳=无须 defer）。
//   ②URL 形：fs-guard-shim 原只拦 string → readFileSync(new URL(...)) 旁路——
//     guardedTargetOf 归一（string/file://URL 同路由,Buffer/fd/非法 URL 原参透传）。
//   ③字面 require('node:fs')：vite 注入原生 require,alias 不达——R24 普查 8 处
//     直读者改 ESM import 形;本文件 §4 census 锁看守回潮（require+readFile 内容
//     读形在非 _ 前缀 tests/ 域=零容忍）。
// 另:customResolver 路由域扩 tools/（id-domain-guard/l10n-audit/recon 等全 src 扫描器
// 经 tests import 进池的读盘竞态面）——§3 结构锁钉 vitest.config.ts 三面。
// 夹具纪律（同 mut-read-guard）：假锁/假备份一律 finally 清场——假锁残留会让真
// withMutation 忙等 15 分钟;src 路由相只用 Options.ts（只读,避开全部变异目标）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import * as fsp from 'node:fs/promises';                 // → fs-promises-shim（①路由相）
import fsDefault from 'node:fs';                          // → fs-guard-shim default 面
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileGuarded, withMutation, _bj725fTestPaths } from './mutation-guard';

const itMut = process.env.SW_BJ743A_MUT === '1' ? it.skip : it;   // 变异子进程跳过变异测试（防递归挂锁）

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const ROUTE_SRC = join(GAME_ROOT, 'src/core/Options.ts');   // 只读路由相用真 src 文件
const TMP_FIXTURE = join(_bj725fTestPaths.ROOT, 'bj743a-fixture.ts');

function fakeLock(file: string, body: { pid: number; kind: 'mutate' | 'read'; at?: number }): void {
  mkdirSync(_bj725fTestPaths.ROOT, { recursive: true });
  writeFileSync(_bj725fTestPaths.lockPathOf(file), JSON.stringify({ ...body, at: body.at ?? Date.now() }), { flag: 'w' });
}
function writeBackup(file: string, content: string): void {
  writeFileSync(_bj725fTestPaths.backupPathOf(file), content);
}

describe('BJ743-A ①② 异步守卫 readFileGuarded 五档同构（fs/promises 面）', () => {
  const held: string[] = [];
  const take = (f: string): string => { held.push(_bj725fTestPaths.lockPathOf(f)); return _bj725fTestPaths.lockPathOf(f); };

  beforeEach(() => {
    mkdirSync(_bj725fTestPaths.ROOT, { recursive: true });
    writeFileSync(TMP_FIXTURE, 'export const X = 1;\n');
    delete process.env.SW_MUT_GUARD_HOLDER;
  });
  afterEach(() => {
    for (const lp of held) { try { rmSync(lp); } catch { /* 已清 */ } }
    held.length = 0;
    try { rmSync(TMP_FIXTURE); } catch { /* 已清 */ }
    delete process.env.SW_MUT_GUARD_HOLDER;
  });

  it('⑦a 无锁直读:异步守卫读返回盘面内容(与同步裸读逐字节同)', async () => {
    expect(await readFileGuarded(TMP_FIXTURE, 'utf8')).toBe(readFileSync(TMP_FIXTURE, 'utf8'));
  });
  it('⑦b 他人变异窗 → 读纯净备份(不看变异盘;恰红子进程语义不受扰)', async () => {
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'mutate' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* pristine */\n');
    expect(await readFileGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 0; /* pristine */\n');
  });
  it('⑦c read 档持锁者(lockTargetFile 只读自证窗) → 直读盘面', async () => {
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'read' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* 应被忽略 */\n');
    expect(await readFileGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 1;\n');
  });
  it('⑦d env 旗匹配(变异子进程身份) → 直读变异盘(恰红依赖,env 同步判定)', async () => {
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'mutate' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* 应被忽略 */\n');
    process.env.SW_MUT_GUARD_HOLDER = '999999';
    expect(await readFileGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 1;\n');
  });
  it('⑦e 备份未写/陈旧(mtime 门槛拒收) → 直读盘面(变异未落盘=盘面仍纯净)', async () => {
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'mutate' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* 陈旧备份,应被 mtime 门槛拒收 */\n');
    const old = new Date(Date.now() - 300_000);
    utimesSync(_bj725fTestPaths.backupPathOf(TMP_FIXTURE), old, old);
    expect(await readFileGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 1;\n');
  });
});

describe('BJ743-A ①② shim 路由相（import 形经 alias 进守卫;非 src 透传）', () => {
  const held: string[] = [];
  afterEach(() => {
    for (const lp of held) { try { rmSync(lp); } catch { /* 已清 */ } }
    held.length = 0;
    try { rmSync(_bj725fTestPaths.backupPathOf(ROUTE_SRC)); } catch { /* 已清 */ }
    delete process.env.SW_MUT_GUARD_HOLDER;
  });

  it('⑧ fs/promises readFile：string 与 file://URL 形经守卫(假变异窗→读备份)', async () => {
    fakeLock(ROUTE_SRC, { pid: 999_999, kind: 'mutate' });
    held.push(_bj725fTestPaths.lockPathOf(ROUTE_SRC));
    writeBackup(ROUTE_SRC, '/* bj743a fsp-route probe */\n');
    expect((fsp as unknown as { __swFsPromisesShim?: boolean }).__swFsPromisesShim).toBe(true);
    expect(await fsp.readFile(ROUTE_SRC, 'utf8')).toBe('/* bj743a fsp-route probe */\n');
    expect(await fsp.readFile(new URL(`file://${ROUTE_SRC}`), 'utf8')).toBe('/* bj743a fsp-route probe */\n');
    // 非 src 路径：透传（守卫不碰）——本测试夹具自身即非 src
    writeFileSync(TMP_FIXTURE, 'export const X = 7;\n');
    expect(await fsp.readFile(TMP_FIXTURE, 'utf8')).toBe('export const X = 7;\n');
  });
  it('⑨ fs readFileSync：URL 形经守卫;default 导入面同守卫;string 面回归锚', async () => {
    fakeLock(ROUTE_SRC, { pid: 999_999, kind: 'mutate' });
    held.push(_bj725fTestPaths.lockPathOf(ROUTE_SRC));
    writeBackup(ROUTE_SRC, '/* bj743a url-route probe */\n');
    expect(readFileSync(new URL(`file://${ROUTE_SRC}`), 'utf8')).toBe('/* bj743a url-route probe */\n');
    expect(readFileSync(ROUTE_SRC, 'utf8')).toBe('/* bj743a url-route probe */\n');
    // default 导入面（import fs from 'node:fs'）:展开拷贝携守卫 readFileSync
    expect((fsDefault as unknown as { readFileSync: (f: unknown, e: string) => string })
      .readFileSync(ROUTE_SRC, 'utf8')).toBe('/* bj743a url-route probe */\n');
  });
  it('⑩ 非法 URL/Buffer 形原参透传（归一仅用于守卫支——原生抛错语义零漂移）', async () => {
    expect(() => readFileSync(new URL('http://localhost/x.ts'), 'utf8')).toThrow();
    await expect(fsp.readFile(new URL('http://localhost/x.ts'), 'utf8')).rejects.toThrow();
  });
});

describe('BJ743-A ③ 装载通道结构锁（vitest.config.ts alias 三面）', () => {
  it('§3 fs/promises 别名+tools/ 路由域+双 shim EXEMPT 在位', () => {
    const cfg = readFileSync(join(GAME_ROOT, 'vitest.config.ts'), 'utf8');
    expect(cfg).toContain('fs-promises-shim');
    expect(cfg).toContain('PSHIM');
    expect(cfg).toContain('find: /^(node:)?fs\\/promises$/');
    expect(cfg).toContain('ROUTE_DOMAIN = /\\/tests\\/|\\/tools\\//');
    // EXEMPT 双 shim + mutation-guard（防自环）
    expect(cfg).toContain('fs-guard-shim|fs-promises-shim|mutation-guard');
  });
});

describe('BJ743-A ④ require 直读者 census 锁（R24 SEV-2 回潮看守）', () => {
  it('非 _ 前缀 tests/*.test.ts 零 require+readFile 内容读形（旁路面=须 ESM import）', () => {
    // 三种调用形：①require(...fs...).readFile(Sync)( ②{ …readFile(Sync)… } = require(...fs...)
    // ③const N = require(...fs...) 后同文件 N.readFile( —— 均为 alias 不达的原生直通面。
    const files = readdirSync(HERE).filter((f) => f.endsWith('.test.ts') && !f.startsWith('_'));
    const offenders: string[] = [];
    for (const f of files) {
      if (f === 'bj743a-guard-bypass.test.ts') continue;   // 本文件自含模式串（注释/正则源）
      const src = readFileSync(join(HERE, f), 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (/require\(\s*(['"])(?:node:)?fs\1\s*\)\s*\.\s*readFile(?:Sync)?\s*\(/.test(line)) {
          offenders.push(`${f}:${i + 1} 直调形`);
        }
        if (/\{\s*[^}]*\breadFileSync\b[^}]*\}\s*=\s*require\(\s*(['"])(?:node:)?fs\1\s*\)/.test(line)
          || /\{\s*[^}]*\breadFile\b[^}]*\}\s*=\s*require\(\s*(['"])(?:node:)?fs\1\s*\)/.test(line)) {
          offenders.push(`${f}:${i + 1} 解构形`);
        }
        const ns = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*(['"])(?:node:)?fs\2\s*\)/.exec(line);
        if (ns && new RegExp(`\\b${ns[1]}\\.readFile(?:Sync)?\\s*\\(`).test(src)) {
          offenders.push(`${f}:${i + 1} 命名空间形(${ns[1]})`);
        }
      });
    }
    expect(offenders, `require 直读者回潮（改 ESM import 形经 shim）: ${offenders.join('; ')}`).toEqual([]);
  });
});

describe('BJ743-A ⑤ B 面结构锁（棘轮实红两面的防回潮锚）', () => {
  it('§5a calamity 三 walker 排除 golden-oracle;256MB 护栏未动', () => {
    for (const f of ['calamity-merged.test.ts', 'ds-scourge.test.ts', 'weap-roundtrip.test.ts']) {
      const src = readFileSync(join(GAME_ROOT, 'mods/calamity/tests', f), 'utf8');
      expect(src, `${f} 须排除 golden-oracle（452MB oracle 工作档非 mod 交付内容）`).toContain("name === 'golden-oracle'");
    }
    const pack = readFileSync(join(GAME_ROOT, 'src/mods/pack.ts'), 'utf8');
    expect(pack).toContain('256 * 1024 * 1024');   // P5 D-n1 zip 炸弹护栏（本刀明令勿动）
  });
  it('§5b remaster：3861/3862 无矩形独立 PNG → catalog whole 收录（vicon 回退同构）', async () => {
    const vanilla = JSON.parse(readFileSync(join(GAME_ROOT, 'public/sprites/vanilla.json'), 'utf8')) as {
      items: Record<string, { icon: string; ix?: number }>;
    };
    expect(vanilla.items['3861']!.icon).toBe('vanilla/Item_3861.png');
    expect(vanilla.items['3861']!.ix).toBeUndefined();
    expect(vanilla.items['3862']!.icon).toBe('vanilla/Item_3862.png');
    const cat = readFileSync(join(GAME_ROOT, 'src/remaster/AssetCatalog.ts'), 'utf8');
    expect(cat).toContain('layout = \'whole\'');
    expect(cat).toContain('3861/3862');
  });
});

describe('BJ743-A ⑥ 变异恰红（新旁路面守卫的判别性）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj743a-guard-bypass.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000,
      env: { ...process.env, SW_BJ743A_MUT: '1' },   // *_MUT 家族旗:子进程免三 vite 钩子审计
    });

  itMut('M1 fs-promises-shim 守卫路由摘除（readFile 透传）→ ⑧ 路由相红', () => {
    withMutation(join(GAME_ROOT, 'tests/fs-promises-shim.ts'),
      'return p !== null\n    ? readFileGuarded(p, ...args)\n    : (realFsp.readFile as (...a: unknown[]) => Promise<unknown>)(file as string, ...args);',
      'return (realFsp.readFile as (...a: unknown[]) => Promise<unknown>)(file as string, ...args); /* BJ743A-M1 */',
      () => {
        const r = spawnVitest('⑧');
        expect(r.status, '变异须证红: promises 守卫路由摘除').not.toBe(0);
        expect(r.stdout).toContain('⑧');
      }, { label: 'BJ743-A M1' });
  });

  itMut('M2 fs-guard-shim URL 归一摘除（URL 形回退透传,string 面不动）→ ⑨ URL 相红', () => {
    withMutation(join(GAME_ROOT, 'tests/fs-guard-shim.ts'),
      '  const p = guardedTargetOf(file);',
      '  const p = typeof file === \'string\' ? guardedTargetOf(file) : null; /* BJ743A-M2 */',
      () => {
        const r = spawnVitest('⑨');
        expect(r.status, '变异须证红: URL 归一摘除').not.toBe(0);
        expect(r.stdout).toContain('⑨');
      }, { label: 'BJ743-A M2' });
  });
});
