// ★BJ617 存储链清偿 A 批（BJ616 review MED 三件）判别测试。probe 物证 =
//  tests/_bj616-redteam-probe.test.ts。
//  A 组（件1 终态·用户拍板 2026-10-10）：多标签页并发防线=Web Locks 会话锁（零合并、
//   零重读——index 合并/nextId 重读面被用户明令否决「合并肯定是有风险的,还有可能
//   引入重复数据导致存档混乱」）。锁语义：支持 navigator.locks=同世界/同角色已有
//   会话拒载（'busy'）;不支持=降级放行（双开各自覆盖写 last-writer-wins=用户明示
//   接受面）。probe F1（双 tab 同 id 碰撞）在锁支持浏览器被「B tab 拒载」预防=本组
//   A2 覆盖;降级浏览器=用户接受面（A6 结构锚标注）。
//  B 组（件2 F2）：读序倒挂——resolveLoadText 三段择源（IDB 现值 → FS 备份 → LS
//   兜底副本）。probe F4 坐实的「LS 陈旧副本短路 FS 恢复链」场景转正：FS 备份胜出
//   （含自愈写回）;FS 不可用才回落 LS。
//  C 组（件3）：l10n 恢复文案被陈旧草稿遮蔽——custom 源 flat 重复键组删除后,嵌套
//   正确版（本地备份语义）在产物胜出;新键（LoadStaleLocalCopy+双锁拒载 toast）双
//   语言在位;mainFlow 传参语义（文件名进 {0} 槽）锚定。
//  垫：fake-IDB + LS 桩真实读写链（与 bj615/world-store/probe 同垫）;FS 面=fake 目录
//   句柄经结构化克隆值通道装载（bj614 同构）;navigator.locks 面=node 可替换全局+
//   fake LockManager（两请求者竞争矩阵）;模块级句柄/warn 态用 vi.resetModules 隔离。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LoadTextResolution } from '../src/save/FsBackup';
import { installFakeIdb, type FakeIdbHandle } from './fake-idb-util';
// ★C档可移植:l10n 源目录(仓库外 tools/l10n-custom,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['tools/l10n-custom'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));


// ---- 共享垫 ----
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;
const idb: FakeIdbHandle = installFakeIdb();
const tick = () => new Promise((r) => setTimeout(r, 0));
const FS_HANDLE_KEY = 'sandboxworld.fsBackup.dir';   // = FsBackup.FS_BACKUP_HANDLE_KEY（装载须先于模块导入,故字面量）

// ---- navigator.locks 夹具（node 22 navigator=getter,defineProperty 可替换;afterEach 还原描述符） ----
const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function setNavigator(v: unknown): void {
  Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true });
}
afterEach(() => { if (navDesc) Object.defineProperty(globalThis, 'navigator', navDesc); });

// FS 兼容门夹具（FsBackup 读 globalThis.showDirectoryPicker——非 navigator 面）
const origPicker = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
function setPicker(p: unknown): void { (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = p; }

// ---- FS 夹具（bj614 同构最小面：restore 链只消费 queryPermission/keys/getFileHandle/text） ----
function fakeDir(name: string, files: Record<string, string>, perm: 'granted' | 'prompt' | 'denied' = 'granted') {
  const map = new Map(Object.entries(files));
  return {
    kind: 'directory' as const,
    name,
    queryPermission: async () => perm,
    keys: async function* () { for (const k of [...map.keys()]) yield k; },
    getFileHandle: async (n: string, o?: { create?: boolean }) => {
      if (!map.has(n) && !o?.create) {
        const e = new Error('NotFoundError');
        (e as { name?: string }).name = 'NotFoundError';
        throw e;
      }
      return { text: async () => map.get(n) ?? '' };
    },
    removeEntry: async () => { /* restore 链不消费 */ },
  };
}

interface FakeLocks {
  api: { request(name: string, opts: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void> | void): Promise<unknown> };
  isHeld(name: string): boolean;
}
/** fake LockManager：独占锁语义——held 即 busy（cb 以 null 调用即时返回）;到手=cb 悬持
 *  至 release（回调 promise settle 即释放,与 MDN request 语义同形）。 */
function fakeLocks(): FakeLocks {
  const held = new Set<string>();
  return {
    api: {
      request(name: string, _opts: { ifAvailable?: boolean }, cb: (lock: unknown) => Promise<void> | void): Promise<unknown> {
        if (held.has(name)) { void cb(null); return Promise.resolve(null); }
        held.add(name);
        return new Promise<void>((res) => {
          void Promise.resolve(cb({ name, mode: 'exclusive' })).then(() => { held.delete(name); res(); });
        });
      },
    },
    isHeld: (n: string) => held.has(n),
  };
}

beforeEach(() => {
  mem.clear();
  idb.map.clear();
  idb.state.failOpen = false;
  idb.dropConnection();
  vi.resetModules();   // nextId/openDb/句柄态/warn 一次性全复位
  // FS 兼容门缺省撑起（FS 面用例经句柄值通道装载,不走 picker）
  setPicker(async () => { throw new Error('picker not expected in this test'); });
});
afterEach(() => {
  if (origPicker === undefined) delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  else (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = origPicker;
});

/** resolveLoadText 结果窄化（expect 后显式收窄,TS union 不因 expect 收窄） */
function expectSource<T extends LoadTextResolution['source']>(r: LoadTextResolution, s: T): Extract<LoadTextResolution, { source: T }> {
  expect(r.source, `择源应为 ${s}`).toBe(s);
  if (r.source !== s) throw new Error(`unreachable: 实际 ${r.source}`);
  return r as Extract<LoadTextResolution, { source: T }>;
}

// =====================================================================
// A 组 件1（终态）：Web Locks 会话锁——同世界/同角色已有会话拒载;降级放行
// =====================================================================
describe.skipIf(EXT_MISSING)('BJ617 A组 件1：SessionLock Web Locks 会话锁', () => {
  it('A1 键面+兼容门：锁名域前缀防撞名;无 navigator.locks（老 Safari<16.4/非安全上下文）=unsupported 降级', async () => {
    const { worldLockKey, charLockKey, sessionLocksSupported, acquireSessionLock } = await import('../src/save/SessionLock');
    expect(worldLockKey(5)).toBe('sandboxworld.world-lock.5');
    expect(charLockKey(7)).toBe('sandboxworld.char-lock.7');
    setNavigator({});   // navigator 在但 locks 缺失
    expect(sessionLocksSupported()).toBe(false);
    expect(await acquireSessionLock(worldLockKey(5)), '降级面=unsupported（调用方放行）').toBe('unsupported');
    setNavigator(undefined);   // 整个 navigator 缺失（老运行时）同面
    expect(sessionLocksSupported()).toBe(false);
  });

  it('A2【probe F1 场景锁面转正】两请求者竞争：先到者持锁,后到者 busy=拒载（他 tab 会话在途）', async () => {
    const fake = fakeLocks();
    setNavigator({ locks: fake.api });
    const { acquireSessionLock, worldLockKey } = await import('../src/save/SessionLock');
    const a = await acquireSessionLock(worldLockKey(1));
    expect(a, 'tab A 到手').not.toBe('busy');
    expect(fake.isHeld('sandboxworld.world-lock.1')).toBe(true);
    const b = await acquireSessionLock(worldLockKey(1));
    expect(b, 'tab B 拒载（另一标签页正在玩该世界）').toBe('busy');
    // 持锁期间 A 未 release → 锁不放（会话长持,标准 API 语义）
    expect(fake.isHeld('sandboxworld.world-lock.1')).toBe(true);
  });

  it('A3 释放面：release 后他方可立即到手（退出世界回菜单/载入失败路径）;release 幂等', async () => {
    const fake = fakeLocks();
    setNavigator({ locks: fake.api });
    const { acquireSessionLock, worldLockKey } = await import('../src/save/SessionLock');
    const a = await acquireSessionLock(worldLockKey(1));
    if (a === 'busy' || a === 'unsupported') throw new Error('unreachable');
    a.release();
    a.release();   // 幂等（quitToMenu+载入失败双路径防双释异常）
    await tick();
    expect(fake.isHeld('sandboxworld.world-lock.1'), 'release 即放锁').toBe(false);
    const b = await acquireSessionLock(worldLockKey(1));
    expect(b, '释放后 B 可载入').not.toBe('busy');
  });

  it('A4 键域隔离：世界锁×角色锁×不同 id 互不阻塞（同 tab 世界+角色双锁并存）', async () => {
    const fake = fakeLocks();
    setNavigator({ locks: fake.api });
    const { acquireSessionLock, worldLockKey, charLockKey } = await import('../src/save/SessionLock');
    const w = await acquireSessionLock(worldLockKey(1));
    const c = await acquireSessionLock(charLockKey(1));
    const w2 = await acquireSessionLock(worldLockKey(2));
    expect(w).not.toBe('busy');
    expect(c).not.toBe('busy');
    expect(w2).not.toBe('busy');
    // 同 id 世界锁仍互斥（跨键域不串）
    expect(await acquireSessionLock(worldLockKey(1))).toBe('busy');
    expect(await acquireSessionLock(charLockKey(1))).toBe('busy');
  });

  it('A5 mainFlow 接线锚：载入面取双锁+busy 拒载 toast;退出/失败/中止三释放面;创建面角色锁', () => {
    const s = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    // 载入面（loadFromKey）：busy → 拒载 toast+return（loadFlowBusy 复位）
    expect(s).toContain('const lockTake = await acquireLoadSessionLocks(key);');
    expect(s).toContain("if (!lockTake.ok) {");
    expect(s).toContain("'Mods.SandboxWorld.Toast.WorldLockedByOtherTab'");
    expect(s).toContain("'Mods.SandboxWorld.Toast.CharLockedByOtherTab'");
    // 释放三面：missing 分支 / catch / quitToMenu（先落盘再放锁）
    expect(s.match(/heldSessionLocks\?\.release\(\);/g)?.length, 'missing+catch+abort+rethrow+quitToMenu+双防御释放面').toBeGreaterThanOrEqual(5);
    expect(s).toContain('heldSessionLocks = null;\n      currentWorld = null;');   // catch 面（★BJ704-G7 2026-10-21 形随刀更新:锁释放与 console.error 之间插入 currentWorld 绑定清零——语义不变「先放锁」,改判史=初锁直贴 console.error）
    // 创建面：角色锁（新世界 id 全新=无世界争用面）;中止支放锁
    expect(s).toContain('const c = await acquireSessionLock(charLockKey(cid0));');
    // 退出面在 currentWorld=null 之后（doSave 全链落定才放锁——序关系锚,注释剥离留空行不依赖）
    const quitRelease = s.indexOf('heldSessionLocks?.release();', s.indexOf('currentWorld = null;'));
    expect(quitRelease, 'quitToMenu 放锁在 currentWorld=null 之后').toBeGreaterThan(0);
  });

  it('A6 终态结构锚（用户拍板）：WorldStore 零合并零写前重读——index 写入面保持全量覆写（降级浏览器双开=last-writer-wins 接受面）', () => {
    const ws = readFileSync(resolve(__dirname, '../src/save/WorldStore.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(ws, 'index 合并面被用户明令否决——不得回流').not.toContain('mergeRemoteIntoIndex');
    // ★BJ618 件5（BJ617 自登记债清偿）：本锚原形 `not.toContain('kvGetIdb')` 随
    // ensureLoaded 载入读面三段择源（IDB → FS 恢复链 → LS）收窄——用户明令否决的是
    // 【写前重读+合并】面（BJ617 件1 拍板语境）,非载入读面（probe F4 后半同族病）。
    // 锚改形：kvGetIdb 仅限读面（import+ensureLoaded 载入读面+R13-F1 load 数据读面
    // 三处）,写面（saveIndex/register/importSlot/duplicate）零出现=写前重读仍被否决。
    const idbReadLines = ws.split('\n').filter((l) => l.includes('kvGetIdb'));
    expect(idbReadLines.length, 'kvGetIdb 仅读面三处（import/ensureLoaded/load——零写前重读）').toBe(3);
    expect(idbReadLines.join('\n'), '写前重读面仍被否决——写面零 kvGetIdb').not.toMatch(/saveIndex|register\(|importSlot|duplicate/);
    expect(ws).toContain('const meta: WorldMeta = { ...rest, id: nextId++, createdAt: Date.now()');
    expect(ws).toContain('const where = await kvSet(INDEX_KEY, JSON.stringify(this.index));');
    // probe F1 降级面标注：锁不可用环境双 tab 各自 nextId=1 → 数据键碰撞互相覆盖
    // =用户明示接受（「各自开存档后自己覆盖写也没关系」）;锁支持环境由 A2 拒载预防。
  });
});

// =====================================================================
// B 组 件2：读序倒挂修复（probe F4 转正）
// =====================================================================
describe.skipIf(EXT_MISSING)('BJ617 B组 件2：resolveLoadText 三段择源（IDB → FS 备份 → LS 副本）', () => {
  it('B1 IDB 现值恒权威：命中直返,绝不咨询 FS（备份回写不得倒灌健康档）', async () => {
    idb.map.set('sandboxworld.world.1', '{"header":{"name":"IDB现值"}}');
    idb.map.set(FS_HANDLE_KEY, fakeDir('B', { '世界_1_20261010_000001.json': '{"header":{"name":"FS备份"}}' }));
    const mod = await import('../src/save/FsBackup');
    await tick();
    const r = await mod.resolveLoadText('sandboxworld.world.1', () => '{"header":{"name":"LS陈旧"}}');
    const ok = expectSource(r, 'idb');
    expect(ok.text).toBe('{"header":{"name":"IDB现值"}}');
    expect(idb.map.get('sandboxworld.world.1'), 'IDB 现值不得被 FS 备份倒灌覆盖').toBe('{"header":{"name":"IDB现值"}}');
  });

  it('B2【probe F4 转正】IDB miss + LS 陈旧副本 + FS 新备份 → FS 备份胜出（最新档优先+自愈写回 IDB）', async () => {
    mem.set('sandboxworld.world.1', '{"header":{"name":"升级前陈旧档"}}');   // 双写时代 LS 副本（probe F4 同形）
    idb.map.set(FS_HANDLE_KEY, fakeDir('B', {
      '世界_1_20261010_000001.json': '{"header":{"name":"FS新备份"}}',
      '世界_1_20261009_000001.json': '{"header":{"name":"FS旧备份"}}',
    }));
    const mod = await import('../src/save/FsBackup');
    await tick();
    expect(mod.fsBackupStatus(), '前置自证：句柄已装载且 granted').toBe('ready');
    const r = await mod.resolveLoadText('sandboxworld.world.1', () => mem.get('sandboxworld.world.1') ?? null);
    const ok = expectSource(r, 'fs-backup');
    expect(ok.text, 'FS 最新备份优先于 LS 陈旧副本（旧实现 kvGet 非空即短路恢复链）').toBe('{"header":{"name":"FS新备份"}}');
    expect(ok.file).toBe('世界_1_20261010_000001.json');
    expect(idb.map.get('sandboxworld.world.1'), '自愈：恢复链已把备份写回 IDB,下次读直命中').toBe('{"header":{"name":"FS新备份"}}');
  });

  it('B3 FS 未启用（无句柄）→ LS 兜底副本可救（旧用户数据不因读序修复消失）', async () => {
    mem.set('sandboxworld.world.1', '{"header":{"name":"LS副本"}}');
    const mod = await import('../src/save/FsBackup');
    await tick();
    const r = await mod.resolveLoadText('sandboxworld.world.1', () => mem.get('sandboxworld.world.1') ?? null);
    const ok = expectSource(r, 'ls-fallback');
    expect(ok.text).toBe('{"header":{"name":"LS副本"}}');
  });

  it('B4 FS prompt 态（跨会话常态）→ 不强弹不阻塞,LS 兜底副本仍可救', async () => {
    mem.set('sandboxworld.world.1', '{"header":{"name":"LS副本"}}');
    idb.map.set(FS_HANDLE_KEY, fakeDir('B', { '世界_1_20261010_000001.json': '{"header":{"name":"FS备份"}}' }, 'prompt'));
    const mod = await import('../src/save/FsBackup');
    await tick();
    const r = await mod.resolveLoadText('sandboxworld.world.1', () => mem.get('sandboxworld.world.1') ?? null);
    const ok = expectSource(r, 'ls-fallback');
    expect(ok.text).toBe('{"header":{"name":"LS副本"}}');
  });

  it('B5 三源皆空 → missing（带 restoreReason 供 prompt 授权提示分流）', async () => {
    const mod = await import('../src/save/FsBackup');
    await tick();
    const off = await mod.resolveLoadText('sandboxworld.world.9', () => null);
    expect(off).toEqual({ source: 'missing', restoreReason: 'off' });
    // 句柄在+granted 但无同键备份 → no-backup
    vi.resetModules();
    idb.map.set(FS_HANDLE_KEY, fakeDir('B', {}));
    const mod2 = await import('../src/save/FsBackup');
    await tick();
    const nb = await mod2.resolveLoadText('sandboxworld.world.9', () => null);
    expect(nb).toEqual({ source: 'missing', restoreReason: 'no-backup' });
  });

  it('B6 quicksave（无备份面键）：restoreFromBackup unknown-key 即返,LS 兜底不受阻塞', async () => {
    mem.set('sandboxworld.quicksave', '{"header":{"name":"quick"}}');
    idb.map.set(FS_HANDLE_KEY, fakeDir('B', {}));
    const mod = await import('../src/save/FsBackup');
    await tick();
    const r = await mod.resolveLoadText('sandboxworld.quicksave', () => mem.get('sandboxworld.quicksave') ?? null);
    const ok = expectSource(r, 'ls-fallback');
    expect(ok.text).toBe('{"header":{"name":"quick"}}');
  });

  it('B7 mainFlow 接线锚：三段择源装配+陈旧副本诚实标注（仅限有备份面的键）', () => {
    const s = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(s).toContain('let resolved = await resolveLoadText(key, () => lsGetSafe(key));');   // ★R13-F2：lsRead 安全垫化;★BJ655 let=授权后重跑择源
    expect(s).toContain("ui.toast(Lang.text('Mods.SandboxWorld.Toast.FsBackupRestored', resolved.file));");
    expect(s).toContain("if (backupTargetOfKey(key)) ui.toast(Lang.text('Mods.SandboxWorld.Toast.LoadStaleLocalCopy'));");
    // ★BJ655：prompt 手势链内当场授权+FsBackupNeedAuth toast 退役（主流程零 toast）
    expect(s).toContain('&& await fsBackupRequestPermission()) {');
    expect(s).not.toContain('fsBackupAuthHintFire');
    expect(s).not.toContain('FsBackupNeedAuth');
  });
});

// =====================================================================
// C 组 件3：l10n 恢复文案陈旧草稿遮蔽修复
// =====================================================================
describe.skipIf(EXT_MISSING)('BJ617 C组 件3：l10n 陈旧 flat 草稿不再遮蔽嵌套正确版', () => {
  const customRoot = resolve(__dirname, '..', '..', 'tools', 'l10n-custom');
  const builtRoot = resolve(__dirname, '..', 'public', 'l10n');

  /** custom 源内「顶层 flat 点分键 ∩ 嵌套路径」重复键检测（本类事故的结构闸） */
  function flatDupKeys(src: string): string[] {
    const j = JSON.parse(readFileSync(resolve(customRoot, src), 'utf8')) as Record<string, unknown>;
    const nested = new Set<string>();
    (function walk(o: Record<string, unknown>, p: string) {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') walk(v as Record<string, unknown>, `${p}${k}.`);
        else if (p) nested.add(`${p}${k}`);
      }
    })(j, '');
    return Object.keys(j).filter((k) => k.includes('.') && nested.has(k));
  }

  it('C1 custom 源零 flat∩嵌套重复键（zh+en 双语言;旧云备份草稿组 14 键已删）', () => {
    for (const lang of ['zh-Hans.json', 'en-US.json']) {
      expect(flatDupKeys(lang), `${lang} flat 重复键组必须为空（旧草稿胜出根因）`).toEqual([]);
    }
  });

  it('C2 产物核验：恢复 toast=本地备份语义（文件名 {0} 槽）;新键三枚双语言在位', () => {
    const zh = JSON.parse(readFileSync(resolve(builtRoot, 'zh-Hans.json'), 'utf8')) as Record<string, Record<string, string>>;
    const en = JSON.parse(readFileSync(resolve(builtRoot, 'en-US.json'), 'utf8')) as Record<string, Record<string, string>>;
    expect(zh.Mods['SandboxWorld.Toast.FsBackupRestored']).toBe('已从本地备份恢复「{0}」（可能落后于最后状态）。');
    expect(en.Mods['SandboxWorld.Toast.FsBackupRestored']).toBe('Restored "{0}" from the local backup (it may be older than the last state).');
    expect(zh.Mods['SandboxWorld.Toast.LoadStaleLocalCopy'], '件2 陈旧副本诚实标注键').toContain('较旧的本地副本');
    expect(typeof en.Mods['SandboxWorld.Toast.LoadStaleLocalCopy']).toBe('string');
    // 件1 双锁拒载 toast（Web Locks busy 面）
    expect(zh.Mods['SandboxWorld.Toast.WorldLockedByOtherTab']).toContain('其他标签页');
    expect(zh.Mods['SandboxWorld.Toast.CharLockedByOtherTab']).toContain('其他标签页');
    expect(typeof en.Mods['SandboxWorld.Toast.WorldLockedByOtherTab']).toBe('string');
    expect(typeof en.Mods['SandboxWorld.Toast.CharLockedByOtherTab']).toBe('string');
    // 云端计数语法不得回归（旧草稿把文件名塞进 {0} 计数槽的病灶形态）
    expect(zh.Mods['SandboxWorld.Toast.FsBackupRestored']).not.toContain('个存档');
    // 其余同族键随重复组删除回落嵌套正确版
    expect(zh.Mods['SandboxWorld.Settings.FsBackupDir']).toBe('本地备份目录（增强）');
    // ★BJ655：FsBackupNeedAuth toast 退役——主流程 prompt 静默+读档手势链内当场授权,
    //  授权状态提示面=设置页「待重新授权」（键随 toast 面移除,三语言产物零残留）
    expect(zh.Mods['SandboxWorld.Toast.FsBackupNeedAuth']).toBeUndefined();
    expect(en.Mods['SandboxWorld.Toast.FsBackupNeedAuth']).toBeUndefined();
  });

  it('C3 全语言 overlay：非 en/zh 语言经 enBase 兜底可解析（light 抽检,全量闸=l10n-audit）', () => {
    const ja = JSON.parse(readFileSync(resolve(builtRoot, 'ja-JP.json'), 'utf8')) as Record<string, Record<string, string>>;
    expect(typeof ja.Mods['SandboxWorld.Toast.LoadStaleLocalCopy']).toBe('string');
    expect(typeof ja.Mods['SandboxWorld.Toast.WorldLockedByOtherTab']).toBe('string');
    expect(typeof ja.Mods['SandboxWorld.Toast.FsBackupRestored']).toBe('string');
  });

  it('C4 mainFlow 传参语义：两处恢复 toast 均把文件名送进 {0} 槽（ensureLoaded 链+loadFromKey 择源链）', () => {
    const s = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(s).toContain("Lang.text('Mods.SandboxWorld.Toast.FsBackupRestored', r.file)");
    expect(s).toContain("Lang.text('Mods.SandboxWorld.Toast.FsBackupRestored', resolved.file)");
    expect(s, '旧云端计数语法不得回归').not.toContain('云端备份');
  });
});
