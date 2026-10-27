// BJ725-F 守卫读判别锁（2026-10-26）——mutation-guard BJ725-F 节的六相语义锁:
// 根治病根 = 并行变异窗内 SRC/readFileSync 结构锁直读盘读到变异态（bj723c-4g 计数锁
// 在 bj725a-whip-magic D1-M1 窗内见 3 报红实锤;单跑全绿）。
// 六相:
//   ①无锁直读 ②他人变异窗→纯净备份 ③read 档持锁者→直读 ④env 旗匹配(变异子进程)
//   →直读变异盘 ⑤备份未写(变异未落盘)→直读 ⑥setupFile patch 全链路由(src 路径
//   经 import { readFileSync } 活绑定进守卫,非 src 透传)
// 夹具纪律:假锁/假备份一律 finally 清场——假锁残留会让真 withMutation 忙等 15 分钟。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSyncGuarded, _bj725fTestPaths } from './mutation-guard';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
// patch 路由相用的真 src 文件（只读,永不写盘;避开全部现存变异目标五文件）
const ROUTE_SRC = join(GAME_ROOT, 'src/core/Options.ts');
const TMP_FIXTURE = join(_bj725fTestPaths.ROOT, 'bj725f-fixture.ts');

function fakeLock(file: string, body: { pid: number; kind: 'mutate' | 'read'; at?: number }): void {
  mkdirSync(_bj725fTestPaths.ROOT, { recursive: true });
  // 夹具文件仅本测试持有(唯一路径/无真变异方),覆写式防崩溃残锁卡下一轮
  writeFileSync(_bj725fTestPaths.lockPathOf(file), JSON.stringify({ ...body, at: body.at ?? Date.now() }), { flag: 'w' });
}
function writeBackup(file: string, content: string): void {
  writeFileSync(_bj725fTestPaths.backupPathOf(file), content);
}

describe('BJ725-F 守卫读六相', () => {
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

  it('① 无锁直读:守卫读返回盘面内容(与裸读逐字节同)', () => {
    expect(readFileSyncGuarded(TMP_FIXTURE, 'utf8')).toBe(readFileSync(TMP_FIXTURE, 'utf8'));
  });

  it('② 他人变异窗 → 读纯净备份(不看变异盘)', () => {
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'mutate' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* pristine */\n');
    expect(readFileSyncGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 0; /* pristine */\n');
  });

  it('③ read 档持锁者(lockTargetFile 只读自证窗) → 直读盘面', () => {
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'read' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* 应被忽略 */\n');
    expect(readFileSyncGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 1;\n');
  });

  it('④ env 旗匹配(变异子进程身份) → 直读变异盘(恰红依赖)', () => {
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'mutate' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* 应被忽略 */\n');
    process.env.SW_MUT_GUARD_HOLDER = '999999';
    expect(readFileSyncGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 1;\n');
  });

  it('⑤ 备份未写(变异未落盘,盘面仍纯净) → 直读', () => {
    // 备份 mtime 真拨旧(utimesSync)——mtime < holder.at-50 即「本轮未写」→ 直读盘面。
    // (回拨锁 at 不行:备份是后写的,mtime 恒新=会被采信——那其实是同拍链等价态,合法)
    fakeLock(TMP_FIXTURE, { pid: 999_999, kind: 'mutate' });
    take(TMP_FIXTURE);
    writeBackup(TMP_FIXTURE, 'export const X = 0; /* 陈旧备份,应被 mtime 门槛拒收 */\n');
    const old = new Date(Date.now() - 300_000);
    utimesSync(_bj725fTestPaths.backupPathOf(TMP_FIXTURE), old, old);
    expect(readFileSyncGuarded(TMP_FIXTURE, 'utf8')).toBe('export const X = 1;\n');
  });

  it('⑥ setupFile patch 全链:src 路径经具名导入活绑定进守卫,非 src 透传', () => {
    // src 文件:假变异锁+新鲜备份 → 具名导入的 readFileSync 应取备份(=已进守卫)
    fakeLock(ROUTE_SRC, { pid: 999_999, kind: 'mutate' });
    take(ROUTE_SRC);
    writeBackup(ROUTE_SRC, '/* bj725f guard-route probe */\n');
    expect(readFileSync(ROUTE_SRC, 'utf8')).toBe('/* bj725f guard-route probe */\n');
    // 非 src 路径:透传(守卫不碰)——本测试夹具自身即非 src(若误拦,②-⑤ 的裸读
    // 对照早已爆红,此处再钉一道)
    expect(readFileSync(TMP_FIXTURE, 'utf8')).toBe('export const X = 1;\n');
  });
});
