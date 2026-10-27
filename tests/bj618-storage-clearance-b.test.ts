// ★BJ618 存储链清偿 B 批（BJ616 review 漏网/同族批五件 + BJ617 新登记两条）判别测试。
//  probe 物证 = tests/_bj616-redteam-probe.test.ts（F2/F5/F6/F8 已随本批转正）。
//  A 组（件1 probe F2）：WorldStore quicksave→world.1 迁移写败不再产幽灵槽（写败跳过
//   push+onWriteFail 告警;quicksave 源键不动 → 修复存储后下次首启重试=幂等）。
//  B 组（件2 probe F8）：CharacterStore 数据面（create/update/setState）写败镜像
//   WorldStore——导出兜底回调+create 回滚+三写点抛 CharacterSaveWriteError;saveIndex
//   告警面（BJ611 登记②）收口。
//  C 组（件3 probe F6）：quicksave 三面补齐——恢复面（backupTargetOfKey 映射+覆盖式
//   quicksave.json）/快照面（doSave 写成功链尾）/幽灵扫描面（确认驱逐后单键补测,健康态
//   不补测防全新安装误报）。
//  D 组（件4 probe F5/F6）：删除不清 FS 备份=已删档复活——fsBackupPurgeSnapshots 组
//   清理+双 Store delete/clearState 回调接线+陈旧 lastCharId 失效。
//  E 组（件5 BJ617 登记）：ensureLoaded index 读改 IDB 直读——LS 陈旧 index 不再短路
//   FS 恢复链（resolveLoadText 同族读序倒挂;IDB → onRestoreMiss → LS 三段择源）。
//  垫：fake-IDB + LS 桩真实读写链（与 bj615/bj617/probe 同垫）;FS 面=可写 fake 目录
//   句柄经结构化克隆值通道装载（bj614 同构+createWritable 扩展）;模块级
//   nextId/openFailStreak/句柄态用 vi.resetModules 隔离。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installFakeIdb, type FakeIdbHandle } from './fake-idb-util';

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
const INDEX_KEY_W = 'sandboxworld.worlds.index';
const INDEX_KEY_C = 'sandboxworld.players.index';
const LAST_CHAR_KEY = 'sbw.lastCharId';   // = CharacterStore.LAST_CHAR_ID_KEY / mainFlow.LAST_CHAR_KEY

/** WorldMeta 最小形（ensureLoaded 解析只滤 id:number） */
const wmeta = (id: number, name: string) => ({ id, name, seed: '', w: 1, h: 1, difficulty: 0, evil: -1, createdAt: 0, lastPlayed: 0, playTimeMs: 0, favorite: false });

// ---- FS 夹具 ----
/** 只读 fake 目录（恢复链面;bj617 同构） */
function fakeRoDir(name: string, files: Record<string, string>, perm: 'granted' | 'prompt' | 'denied' = 'granted') {
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
      return { getFile: async () => ({ text: async () => map.get(n) ?? '' }) };   // ★Issue#25 标准句柄形状
    },
    removeEntry: async () => { /* 恢复链不消费 */ },
  };
}

/** 可写 fake 目录（快照/清理面:createWritable 采集+removeEntry 记账+keys 抛错注入口） */
function fakeRwDir(name: string, files: Record<string, string> = {}, perm: 'granted' | 'prompt' | 'denied' = 'granted') {
  const map = new Map(Object.entries(files));
  const removed: string[] = [];
  let writeFail: unknown = null;
  let keysFail: unknown = null;
  return {
    map, removed,
    setWriteFail(e: unknown) { writeFail = e; },
    setKeysFail(e: unknown) { keysFail = e; },
    handle: {
      kind: 'directory' as const,
      name,
      queryPermission: async () => perm,
      keys: async function* () {
        if (keysFail) throw keysFail;
        for (const k of [...map.keys()]) yield k;
      },
      getFileHandle: async (n: string, o?: { create?: boolean }) => {
        if (!map.has(n) && !o?.create) {
          const e = new Error('NotFoundError');
          (e as { name?: string }).name = 'NotFoundError';
          throw e;
        }
        return {
          // ★Issue#25 标准句柄形状：getFile()→File（text 在 File 上）;无句柄级 text()
          getFile: async () => ({ text: async () => map.get(n) ?? '' }),
          createWritable: async () => {
            if (writeFail) throw writeFail;
            return {
              write: async (data: BlobPart) => { map.set(n, await new Blob([data]).text()); },
              close: async () => { /* 原子提交面 fake 即时落 */ },
            };
          },
        };
      },
      removeEntry: async (n: string) => {
        if (!map.has(n)) {
          const e = new Error('NotFoundError');
          (e as { name?: string }).name = 'NotFoundError';
          throw e;
        }
        map.delete(n);
        removed.push(n);
      },
    },
  };
}

beforeEach(() => {
  mem.clear();
  idb.map.clear();
  idb.state.failOpen = false;
  idb.dropConnection();
  vi.resetModules();   // nextId/openFailStreak/句柄态全复位（模拟独立标签页/独立会话）
  // FS 兼容门缺省撑起（node 无 showDirectoryPicker=unsupported;快照/恢复/清理面用例
  // 经句柄值通道装载,不走 picker——bj617 同构垫）
  setPicker(async () => { throw new Error('picker not expected in this test'); });
});

// FS 兼容门夹具（FsBackup 读 globalThis.showDirectoryPicker——非 navigator 面）
const origPicker = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
function setPicker(p: unknown): void { (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = p; }
afterEach(() => {
  if (origPicker === undefined) delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  else (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = origPicker;
});

/** 跳过 BJ605 openDb 退避窗（3 连败 → 5s 暂停;恢复 IDB 后的续段用例须越过退避窗） */
async function pastBackoff<T>(fn: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  Date.now = () => realNow() + 6000;
  try { return await fn(); } finally { Date.now = realNow; }
}

// =====================================================================
// A 组 件1（probe F2 转正）：WorldStore 迁移写败不产幽灵槽
// =====================================================================
describe('BJ618 A组 件1：quicksave→world.1 迁移写败（probe F2）', () => {
  it('A1【probe F2 转正】IDB 写败 → meta 不入列（零幽灵）+onWriteFail 告警+quicksave 源键不动;存储修复后下次首启重试成功', async () => {
    mem.set('sandboxworld.quicksave', JSON.stringify({ header: { name: '旧世界', seed: 1, width: 100, height: 100, created: 1700000000000 } }));
    idb.state.failOpen = true;
    idb.dropConnection();
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    let warned = 0;
    s.onWriteFail = () => { warned++; };
    await s.ensureLoaded();
    expect(s.list(), '迁移写败不入列——单档幽灵已封（旧实现 meta 照常入列）').toHaveLength(0);
    expect(idb.map.has('sandboxworld.world.1'), '数据键确实未落库').toBe(false);
    expect(warned, '写败告警回调已发').toBe(1);
    expect(mem.has('sandboxworld.quicksave'), 'quicksave 源键不动（迁移非删源）').toBe(true);
    // 存储修复后下次首启重试（本支幂等——源键在+index 双空即重迁移;resetModules=
    // 新模块态,连带清 BJ605 openDb 退避窗——首轮 3 连败已置 5s 暂停）
    idb.state.failOpen = false;
    idb.dropConnection();
    vi.resetModules();
    const { WorldStore: WS2 } = await import('../src/save/WorldStore');
    const s2 = new WS2();
    await s2.ensureLoaded();
    expect(s2.list(), '重试迁移成功（数据不再滞留幽灵态）').toHaveLength(1);
    expect(s2.list()[0].name).toBe('旧世界');
  });

  it('A2 健康路径不回归：迁移成功照常入列+onWriteFail 零触发+nextId 前移（后续 register=id 2）', async () => {
    mem.set('sandboxworld.quicksave', JSON.stringify({ header: { name: '旧世界', seed: 7, width: 4200, height: 1200, created: 123, playTimeMs: 777 } }));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    let warned = 0;
    s.onWriteFail = () => { warned++; };
    await s.ensureLoaded();
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0]).toMatchObject({ id: 1, name: '旧世界', playTimeMs: 777 });
    expect(warned, '成功路径零告警').toBe(0);
    const m = await s.register({ name: '新世界', seed: 'x', w: 10, h: 10, difficulty: 0, evil: -1 });
    expect(m.id, '迁移成功后 nextId=2（写败支不前移,成功支照旧）').toBe(2);
  });
});

// =====================================================================
// B 组 件2（probe F8 转正）：CharacterStore 数据面写败收口
// =====================================================================
describe('BJ618 B组 件2：CharacterStore 数据面（create/update/setState）+saveIndex 告警面', () => {
  it('B1【probe F8 转正】create 双写全败 → 抛 CharacterSaveWriteError+回滚幽灵槽+导出兜底回调（旧实现全程静默）', async () => {
    idb.state.failOpen = true;
    idb.dropConnection();
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    const exported: Array<{ name: string; key: string; json: string }> = [];
    s.onWriteFailData = (name, key, json) => exported.push({ name, key, json });
    await expect(s.create({ name: 'X', difficulty: 0 } as never), 'create 写败必须抛（调用方角色创建 UI 可感知）')
      .rejects.toMatchObject({ name: 'CharacterSaveWriteError', dataKey: 'sandboxworld.player.1' });
    expect(s.list(), '回滚：内存 index 不留幽灵槽').toHaveLength(0);
    expect(exported, '自动导出兜底回调已发（用户明令件）').toHaveLength(1);
    expect(exported[0]).toMatchObject({ name: 'X', key: 'sandboxworld.player.1' });
    expect(exported[0].json).toContain('"name":"X"');
    expect([...idb.map.keys()].filter((k) => k.startsWith('sandboxworld.player')), 'IDB 零落库').toEqual([]);
  });

  it('B2 create 失败回滚后会话内可重建（id 烧号不复用=WorldStore 同款）+新实例列表干净', async () => {
    idb.state.failOpen = true;
    idb.dropConnection();
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    await expect(s.create({ name: 'X', difficulty: 0 } as never)).rejects.toThrow();
    idb.state.failOpen = false;
    idb.dropConnection();
    const meta = await pastBackoff(() => s.create({ name: 'Y', difficulty: 1 } as never));
    expect(meta.id, '失败支烧掉 id=1（不复用,WorldStore 删档同哲学）').toBe(2);
    expect(s.list()).toHaveLength(1);
    expect((await s.get(meta.id))?.name).toBe('Y');
    const { CharacterStore: CS2 } = await import('../src/save/CharacterStore');
    const s2 = new CS2();
    await s2.ensureLoaded();
    expect(s2.list(), '新实例真落库').toHaveLength(1);
  });

  it('B3 update 写败 → 抛+index meta 零虚假刷新（数据写先行,写败不改名/难度）+导出兜底', async () => {
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    const meta = await s.create({ name: '旧名', difficulty: 0 } as never);
    idb.state.failOpen = true;
    idb.dropConnection();
    const exported: Array<{ name: string; key: string }> = [];
    s.onWriteFailData = (name, key) => exported.push({ name, key });
    await expect(s.update(meta.id, { name: '新名', difficulty: 2 } as never), 'update 写败必须抛').rejects.toThrow();
    expect(s.list()[0], 'index 基线不虚假刷新（旧实现先改 meta 再写,写败=漂移）').toMatchObject({ name: '旧名', difficulty: 0 });
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ name: '新名', key: `sandboxworld.player.${meta.id}` });
  });

  it('B4 setState 写败 → 抛+导出兜底（stateKey 诊断键;旧实现静默=随身态持久丢失）', async () => {
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    const meta = await s.create({ name: 'X', difficulty: 0 } as never);
    idb.state.failOpen = true;
    idb.dropConnection();
    const exported: Array<{ name: string; key: string }> = [];
    s.onWriteFailData = (name, key) => exported.push({ name, key });
    await expect(s.setState(meta.id, { inventory: [{ netId: 1 }] } as never), 'setState 写败必须抛').rejects.toThrow();
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ name: 'X', key: `sandboxworld.playerstate.${meta.id}` });
  });

  it('B5 saveIndex 写败 → onWriteFail 告警+onIndexWrite 不触发（BJ611 登记②收口——写败不得刷 FS index 备份）;成功路径照旧', async () => {
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    let indexWrites = 0;
    s.onIndexWrite = () => { indexWrites++; };   // 先订阅再 create（成功链 index 写计数）
    const meta = await s.create({ name: 'X', difficulty: 0 } as never);
    expect(indexWrites, '成功路径：create 链 index 写已触发').toBeGreaterThanOrEqual(1);
    idb.state.failOpen = true;
    idb.dropConnection();
    let warned = 0;
    s.onWriteFail = () => { warned++; };
    const before = indexWrites;
    await s.setFavorite(meta.id, true);   // 元数据面 → saveIndex 写败
    expect(warned, 'index 写败告警已发').toBe(1);
    expect(indexWrites, '写败不得触发 onIndexWrite（FS 备份不覆盖陈旧内存态）').toBe(before);
  });
});

// =====================================================================
// C 组 件3（probe F6 转正）：quicksave 三面补齐
// =====================================================================
describe('BJ618 C组 件3：quicksave 恢复面/快照面/幽灵扫描面', () => {
  it('C1 恢复面映射+覆盖式固定名：backupTargetOfKey=quicksave;buildFsBackupFilename=quicksave.json（不入轮转解析）', async () => {
    const fb = await import('../src/save/FsBackup');
    expect(fb.backupTargetOfKey('sandboxworld.quicksave'), 'probe F6 旧断言 toBeNull() 已收口').toEqual({ kind: 'quicksave', id: 0 });
    expect(fb.buildFsBackupFilename('quicksave', '任意名', 0, new Date(2026, 9, 10, 12, 34, 56))).toBe('quicksave.json');
    expect(fb.parseFsBackupFilename('quicksave.json'), '覆盖式单档不匹配时间戳轮转解析（轮转面天然 no-op）').toBeNull();
  });

  it('C2 快照面：fsBackupSnapshot(\'quicksave\',…) 落 quicksave.json（内容全量;重复快照覆盖同档）', async () => {
    const dir = fakeRwDir('C2');
    idb.map.set(FS_HANDLE_KEY, dir.handle);
    const fb = await import('../src/save/FsBackup');
    await tick();   // 模块预取装载句柄
    expect(fb.fsBackupStatus()).toBe('ready');
    await fb.fsBackupSnapshot('quicksave', 0, '随意', '{"header":{"name":"草稿"}}');
    expect(dir.map.get('quicksave.json')).toBe('{"header":{"name":"草稿"}}');
    await fb.fsBackupSnapshot('quicksave', 0, '随意', '{"header":{"name":"草稿2"}}');
    expect(dir.map.get('quicksave.json'), '覆盖式：最新草稿即全部').toBe('{"header":{"name":"草稿2"}}');
    expect(dir.removed, '单档不轮转').toEqual([]);
  });

  it('C3 恢复面：restoreFromBackup 读 quicksave.json 写回 IDB（自愈）;resolveLoadText 择源 fs-backup', async () => {
    idb.map.set(FS_HANDLE_KEY, fakeRoDir('C3', { 'quicksave.json': '{"header":{"name":"FS草稿"}}' }));
    const fb = await import('../src/save/FsBackup');
    await tick();
    const r = await fb.restoreFromBackup('sandboxworld.quicksave');
    expect(r).toMatchObject({ ok: true, text: '{"header":{"name":"FS草稿"}}', file: 'quicksave.json' });
    expect(idb.map.get('sandboxworld.quicksave'), '自愈写回 IDB,下次读直命中').toBe('{"header":{"name":"FS草稿"}}');
    // resolveLoadText 择源（上一步自愈已把键写回 IDB——清掉重验 fs-backup 支）
    idb.map.delete('sandboxworld.quicksave');
    vi.resetModules();
    idb.map.set(FS_HANDLE_KEY, fakeRoDir('C3b', { 'quicksave.json': '{"header":{"name":"FS草稿"}}' }));
    const fb2 = await import('../src/save/FsBackup');
    await tick();
    const r2 = await fb2.resolveLoadText('sandboxworld.quicksave', () => '{"header":{"name":"LS草稿"}}');
    expect(r2).toMatchObject({ source: 'fs-backup', text: '{"header":{"name":"FS草稿"}}' });
  });

  it('C4 幽灵扫描面：确认驱逐后 quicksave 缺失补报;健康态/全新安装不补测（防误报）;probe 不可定谳弃检', async () => {
    const sp = await import('../src/save/StoragePersistence');
    // ① 驱逐实锤（world.2 keyMissing）+ quicksave keyMissing → 补报
    const probed1: string[] = [];
    const r1 = await sp.scanEvictedSaves([{ id: 1, name: 'A' }, { id: 2, name: 'B' }], [],
      async (key) => { probed1.push(key); return key === 'sandboxworld.world.1' ? 'present' : 'keyMissing'; });
    expect(r1.evicted).toEqual([
      { kind: 'world', id: 2, name: 'B' },
      { kind: 'quicksave', id: 0, name: 'quicksave' },
    ]);
    // ② 健康态（world 全在）→ quicksave 键缺失不探测、不误报
    const probed2: string[] = [];
    const r2 = await sp.scanEvictedSaves([{ id: 1, name: 'A' }], [],
      async (key) => { probed2.push(key); return 'present'; });
    expect(r2.evicted).toEqual([]);
    expect(probed2, '健康态不补测 quicksave（用户可能从未触发 quicksave 写,缺失≠被清理）').toEqual(['sandboxworld.world.1']);
    // ③ 全新安装（双列空）→ evicted 恒空
    const r3 = await sp.scanEvictedSaves([], [], async () => 'keyMissing');
    expect(r3.evicted).toEqual([]);
    // ④ quicksave probe unavailable（驱逐实锤后）→ 不可定谳弃检
    const r4 = await sp.scanEvictedSaves([{ id: 2, name: 'B' }], [],
      async (key) => (key === 'sandboxworld.quicksave' ? 'unavailable' : 'keyMissing'));
    expect(r4.conclusive).toBe(false);
    expect(r4.evicted).toEqual([]);
  });

  it('C5 mainFlow 接线锚：doSave quicksave 写成功链尾快照+purge 导入在位（结构锚）', () => {
    const s = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(s).toContain("try { void fsBackupSnapshot('quicksave', 0, worldNameNow, json); }");
    expect(s).toContain('fsBackupPurgeSnapshots');
  });
});

// =====================================================================
// D 组 件4（probe F5/F6）：删除不清 FS 备份=已删档复活
// =====================================================================
describe('BJ618 D组 件4：删除面 FS 备份组清理+lastCharId 失效', () => {
  it('D1 fsBackupPurgeSnapshots：只清同 (kind,id) 组,他组保留;目录枚举失败静默吞（增强链不抛）', async () => {
    const dir = fakeRwDir('D1', {
      '世界_7_20261010_000001.json': 'a',
      '世界_7_20261009_000001.json': 'b',
      '世界_8_20261010_000001.json': 'c',
      '角色_char_7_20261010_000001.json': 'd',
      'worlds.index.json': 'e',
    });
    idb.map.set(FS_HANDLE_KEY, dir.handle);
    const fb = await import('../src/save/FsBackup');
    await tick();
    await fb.fsBackupPurgeSnapshots('world', 7);
    expect(dir.removed.sort(), '仅同组两份被清').toEqual(['世界_7_20261009_000001.json', '世界_7_20261010_000001.json']);
    expect([...dir.map.keys()].sort()).toEqual(['worlds.index.json', '世界_8_20261010_000001.json', '角色_char_7_20261010_000001.json']);
    // 枚举失败=静默跳过（绝不抛）
    dir.setKeysFail(new Error('枚举炸'));
    await expect(fb.fsBackupPurgeSnapshots('world', 7)).resolves.toBeUndefined();
    // prompt 态=静默跳过（不为清理打断删除流）
    vi.resetModules();
    idb.map.set(FS_HANDLE_KEY, fakeRwDir('D1b', { '世界_7_20261010_000001.json': 'a' }, 'prompt').handle);
    const fb2 = await import('../src/save/FsBackup');
    await tick();
    await expect(fb2.fsBackupPurgeSnapshots('world', 7)).resolves.toBeUndefined();
  });

  it('D2 WorldStore.delete 成功 → onDeleted(id)（收藏防删早退不触发）;CharacterStore.delete → onDeleted(id,\'all\')', async () => {
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const w = new WS();
    const m1 = await w.register({ name: 'A', seed: 's', w: 1, h: 1, difficulty: 0, evil: -1 });
    const m2 = await w.register({ name: 'B', seed: 's', w: 1, h: 1, difficulty: 0, evil: -1 });
    await w.setFavorite(m2.id, true);
    const deletedW: number[] = [];
    w.onDeleted = (id) => { deletedW.push(id); };
    await w.delete(m1.id);
    expect(deletedW, '普通删除触发组清理回调').toEqual([m1.id]);
    await w.delete(m2.id);
    expect(deletedW, '收藏防删守卫早退——零清理（防误清在玩档备份）').toEqual([m1.id]);
    expect(w.list()).toHaveLength(1);

    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const c = new CS();
    const cm = await c.create({ name: 'X', difficulty: 0 } as never);
    const deletedC: Array<{ id: number; what: string }> = [];
    c.onDeleted = (id, what) => { deletedC.push({ id, what }); };
    await c.delete(cm.id);
    expect(deletedC).toEqual([{ id: cm.id, what: 'all' }]);
  });

  it('D3 CharacterStore.clearState → onDeleted(id,\'state\')（硬核消亡面——防恢复链复活消亡态=复制窗）', async () => {
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const c = new CS();
    const cm = await c.create({ name: 'X', difficulty: 2 } as never);
    await c.setState(cm.id, { inventory: [] } as never);
    const deletedC: Array<{ id: number; what: string }> = [];
    c.onDeleted = (id, what) => { deletedC.push({ id, what }); };
    await c.clearState(cm.id);
    expect(deletedC).toEqual([{ id: cm.id, what: 'state' }]);
  });

  it('D4【probe F5 转正】陈旧 lastCharId 失效：指向被删 id 才清,他角色指针不动', async () => {
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const c = new CS();
    const m1 = await c.create({ name: 'X', difficulty: 0 } as never);
    mem.set(LAST_CHAR_KEY, String(m1.id));
    await c.delete(m1.id);
    expect(mem.has(LAST_CHAR_KEY), '指向被删 id 的 lastCharId 已失效（doSave charContextId 不再以已删 id 复写 state 键）').toBe(false);
    const m2 = await c.create({ name: 'Y', difficulty: 0 } as never);
    mem.set(LAST_CHAR_KEY, '999');   // 指向他角色（可能来自他实例/导入前）
    await c.delete(m2.id);
    expect(mem.get(LAST_CHAR_KEY), '非本 id 指针不误清').toBe('999');
  });

  it('D5 mainFlow 接线锚：双 Store onDeleted → fsBackupPurgeSnapshots（world/player/playerstate 组）', () => {
    const s = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(s).toContain("worldStore.onDeleted = (id) => { void fsBackupPurgeSnapshots('world', id); };");
    expect(s).toContain("if (what === 'all') void fsBackupPurgeSnapshots('player', id);");
    expect(s).toContain("void fsBackupPurgeSnapshots('playerstate', id);");
  });
});

// =====================================================================
// E 组 件5（BJ617 登记）：ensureLoaded index 读面同族病（probe F4 后半）
// =====================================================================
describe('BJ618 E组 件5：ensureLoaded index 三段择源（IDB → FS 恢复链 → LS 副本）', () => {
  it('E1【probe F4 后半转正】WorldStore：IDB miss+LS 陈旧 index → FS 恢复链被咨询并胜出（旧实现 kvGet 命中 LS 即短路）', async () => {
    mem.set(INDEX_KEY_W, JSON.stringify([wmeta(7, '陈旧LS索引')]));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    const asked: string[] = [];
    s.onRestoreMiss = async (key) => { asked.push(key); return JSON.stringify([wmeta(3, 'FS恢复索引')]); };
    await s.ensureLoaded();
    expect(asked, 'FS 恢复链被咨询（旧实现永不可达）').toEqual([INDEX_KEY_W]);
    expect(s.list().map((m) => m.name), 'FS 备份新档优先于 LS 陈旧副本').toEqual(['FS恢复索引']);
  });

  it('E2 CharacterStore 同构：IDB miss+LS 陈旧 → FS 恢复链胜出', async () => {
    mem.set(INDEX_KEY_C, JSON.stringify([{ id: 7, name: '陈旧LS角色', difficulty: 0, createdAt: 0 }]));
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    const asked: string[] = [];
    s.onRestoreMiss = async (key) => { asked.push(key); return JSON.stringify([{ id: 3, name: 'FS恢复角色', difficulty: 0, createdAt: 0 }]); };
    await s.ensureLoaded();
    expect(asked).toEqual([INDEX_KEY_C]);
    expect(s.list().map((m) => m.name)).toEqual(['FS恢复角色']);
  });

  it('E3 IDB 命中恒权威：FS 恢复链零咨询（健康档不得被恢复链倒灌）', async () => {
    idb.map.set(INDEX_KEY_W, JSON.stringify([wmeta(1, 'IDB现值')]));
    mem.set(INDEX_KEY_W, JSON.stringify([wmeta(7, '陈旧LS索引')]));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    let asked = 0;
    s.onRestoreMiss = async () => { asked++; return null; };
    await s.ensureLoaded();
    expect(asked, 'IDB 命中即权威').toBe(0);
    expect(s.list().map((m) => m.name)).toEqual(['IDB现值']);
  });

  it('E4 恢复链不可用（onRestoreMiss null/抛错）→ LS 陈旧副本仍兜底（旧用户数据不因读序修复消失）', async () => {
    mem.set(INDEX_KEY_W, JSON.stringify([wmeta(7, 'LS副本兜底')]));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    s.onRestoreMiss = async () => null;
    await s.ensureLoaded();
    expect(s.list().map((m) => m.name)).toEqual(['LS副本兜底']);
    // 抛错面（恢复链异常=按无 index 继续原语义）
    const s2 = new WS();
    s2.onRestoreMiss = async () => { throw new Error('恢复炸'); };
    await s2.ensureLoaded();
    expect(s2.list().map((m) => m.name)).toEqual(['LS副本兜底']);
  });

  it('E5 三源皆空 → 空 index 不抛（IDB open 失败同面）', async () => {
    idb.state.failOpen = true;
    idb.dropConnection();
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    await expect(s.ensureLoaded()).resolves.toBeUndefined();
    expect(s.list()).toHaveLength(0);
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s2 = new CS();
    await expect(s2.ensureLoaded()).resolves.toBeUndefined();
    expect(s2.list()).toHaveLength(0);
  });
});
