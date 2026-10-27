// ★BJ614（2026-10-10 用户拍板「File System Access 是个不错的方向，可以做为增强选项，
// 先在设置中可启用」+追加「角色存档也要备份」「读档自愈恢复链」）判别测试。
// 全 mock 夹具（FileSystemHandle API node 无——mock picker/句柄/queryPermission/
// write/KvStore 值通道）。锁八面：
//  A. 兼容门+开关流（无 showDirectoryPicker=禁用面;pick 成功落 IDB/取消/异常/kvPutValue
//     失败均不启用）。
//  B. 句柄 IDB round-trip mock（存→读回→状态按 queryPermission 三态落）+ 迟到预取不覆盖
//     新手势态（竞态守卫）。
//  C. 自动写链（启用+granted → write spy 带文件名格式;轮转清理超 3 删最旧且只清本组;
//     index 覆盖档）。
//  D. prompt 态静默跳过（不写+状态 needs-permission;恢复链 prompt=不尝试）。
//  E. 失败降级（写失败 warn+状态 broken;连续 3 败一次性 toast,同一连败段不重报,成功重计）。
//  F. 纯函数（文件名构建/消毒/解析消歧矩阵/轮转纯核/键→备份目标映射）。
//  G. 恢复链（IDB miss+备份有 → kvSet 写回+返回文本/最新档优先/prompt 静默/无备份/角色
//     外观+随身态+双 index 同构/幽灵扫描联动恢复计数）。
//  H. 接线结构锚（mainFlow 四回调接线+loadFromKey 恢复+幽灵联动;WorldStore/CharacterStore
//     钩子;Settings 开关/兼容门/重授权）+ l10n 双语言键全量（BJ371-403 判例:全语言闸）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// ★C档可移植:l10n 源目录(仓库外 tools/l10n-custom,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['tools/l10n-custom'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));


// ---- KvStore 值通道 mock（结构化克隆通道 kvPutValue/kvGetUnknown + kvDelete/kvSet;
//      其余导出透传 actual——本模块不消费） ----
const kvMock = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  getUnknown: undefined as undefined | ((key: string) => Promise<unknown>),
  putValue: undefined as undefined | ((key: string, value: unknown) => Promise<boolean>),
  del: undefined as undefined | ((key: string) => Promise<void>),
  set: undefined as undefined | ((key: string, value: string) => Promise<'local' | 'idb' | 'fail'>),
}));
vi.mock('../src/save/KvStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/save/KvStore')>();
  return {
    ...actual,
    kvGetUnknown: (key: string) => (kvMock.getUnknown ? kvMock.getUnknown(key) : (kvMock.values.get(key) ?? null)),
    kvPutValue: (key: string, value: unknown) => (kvMock.putValue ? kvMock.putValue(key, value) : (kvMock.values.set(key, value), true)),
    kvDelete: (key: string) => (kvMock.del ? kvMock.del(key) : (kvMock.values.delete(key), Promise.resolve())),
    kvSet: (key: string, value: string) => (kvMock.set ? kvMock.set(key, value) : (kvMock.values.set(key, value), Promise.resolve('idb' as const))),
  };
});

// ---- File System Access 夹具（mock 目录/文件句柄——MDN keys()/getFileHandle/
//      createWritable/removeEntry 语义形状） ----
interface FakeFile { name: string; content: string; writes: string[]; }
function fakeDirHandle(name: string, opts: {
  perm?: 'granted' | 'prompt' | 'denied';
  files?: Record<string, string>;         // 初始文件
  subdirs?: string[];
  writeError?: Error;                     // createWritable 即抛（写失败面）
  getFileHandleSpy?: (n: string) => void;
  removeEntrySpy?: (n: string) => void;
} = {}) {
  const files = new Map<string, FakeFile>();
  for (const [k, v] of Object.entries(opts.files ?? {})) files.set(k, { name: k, content: v, writes: [] });
  const subdirs = new Set(opts.subdirs ?? []);
  let perm = opts.perm ?? 'granted';
  let keysError: Error | null = null;
  const h = {
    kind: 'directory' as const,
    name,
    files,
    subdirs,
    setPerm: (p: 'granted' | 'prompt' | 'denied') => { perm = p; },
    setWriteError: (e?: Error) => { opts.writeError = e; },
    setKeysError: (e?: Error) => { keysError = e ?? null; },
    queryPermission: async () => perm,
    requestPermission: async () => perm,
    keys: async function* () {
      if (keysError) throw keysError;
      for (const k of [...files.keys(), ...subdirs]) yield k;
    },
    getFileHandle: async (n: string, o?: { create?: boolean }) => {
      opts.getFileHandleSpy?.(n);
      let f = files.get(n);
      if (!f) {
        if (!o?.create) { const e = new Error('NotFoundError'); (e as { name?: string }).name = 'NotFoundError'; throw e; }
        f = { name: n, content: '', writes: [] };
        files.set(n, f);
      }
      return {
        createWritable: async () => {
          if (opts.writeError) throw opts.writeError;
          return {
            write: async (data: BlobPart) => { f!.writes.push(await new Blob([data]).text()); },
            close: async () => { f!.content = f!.writes.join(''); },
            abort: async () => {},
          };
        },
        // ★Issue#25 改判史：标准 FileSystemFileHandle 形状——无 text() 成员,getFile()→File
        getFile: async () => {
          if (!files.has(n)) { const e = new Error('NotFoundError'); (e as { name?: string }).name = 'NotFoundError'; throw e; }
          return { text: async () => f!.content };
        },
      };
    },
    removeEntry: async (n: string) => {
      opts.removeEntrySpy?.(n);
      if (!files.delete(n) && !subdirs.delete(n)) {
        const e = new Error('NotFoundError'); (e as { name?: string }).name = 'NotFoundError'; throw e;
      }
    },
  };
  return h;
}
type FakeDir = ReturnType<typeof fakeDirHandle>;

const origPicker = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
function setPicker(p: unknown): void { (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = p; }
afterEach(() => {
  if (origPicker === undefined) delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  else (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = origPicker;
  kvMock.values.clear();
  kvMock.getUnknown = undefined;
  kvMock.putValue = undefined;
  kvMock.del = undefined;
  kvMock.set = undefined;
});

// ---- 模块级状态隔离：每用例 resetModules 后动态导入（模块自带启动预取+单发语义） ----
beforeEach(() => {
  vi.resetModules();
  // 缺省 dummy picker：仅撑起「Chrome 系」兼容门（C-G 组经 kvMock 直接装载句柄,
  // 不走 picker;A 组按需覆盖/删除）
  setPicker(async () => { throw new Error('picker not expected in this test'); });
});
function freshMod(): Promise<typeof import('../src/save/FsBackup')> {
  return import('../src/save/FsBackup');
}

const FROZEN = new Date(2026, 9, 10, 12, 34, 56);   // 20261010_123456

describe.skipIf(EXT_MISSING)('BJ614 A组：兼容门+开关流', () => {
  it('无 showDirectoryPicker（Firefox/Safari 形态）→ supported=false+状态 unsupported（开关禁用依据）', async () => {
    delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    const mod = await freshMod();
    expect(mod.fsBackupSupported()).toBe(false);
    expect(mod.fsBackupStatus()).toBe('unsupported');
  });

  it('pick 成功：句柄入 IDB 值通道+状态 ready（picker mode:readwrite → resolve 即授予）', async () => {
    const dir = fakeDirHandle('MyBackups');
    const picker = vi.fn(async (_opts?: unknown) => dir);
    setPicker(picker);
    const mod = await freshMod();
    expect(await mod.fsBackupPickDirectory()).toBe(true);
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0][0]).toMatchObject({ id: 'sandboxworld-backup', mode: 'readwrite' });
    expect(kvMock.values.get(mod.FS_BACKUP_HANDLE_KEY)).toBe(dir);   // 结构化克隆通道（同对象 round-trip 形）
    expect(mod.fsBackupStatus()).toBe('ready');
  });

  it('pick 用户取消（AbortError）→ false+句柄不落库+开关维持关', async () => {
    const picker = vi.fn(async () => { const e = new Error('abort'); (e as { name?: string }).name = 'AbortError'; throw e; });
    setPicker(picker);
    const mod = await freshMod();
    expect(await mod.fsBackupPickDirectory()).toBe(false);
    expect(kvMock.values.has(mod.FS_BACKUP_HANDLE_KEY)).toBe(false);
    expect(mod.fsBackupStatus()).toBe('off');
  });

  it('pick SecurityError（无手势/跨域）→ false 不抛;kvPutValue 失败（IDB 不可用）→ false 未启用', async () => {
    setPicker(async () => { const e = new Error('sec'); (e as { name?: string }).name = 'SecurityError'; throw e; });
    const mod = await freshMod();
    expect(await mod.fsBackupPickDirectory()).toBe(false);
    expect(mod.fsBackupStatus()).toBe('off');

    kvMock.values.clear();
    setPicker(async () => fakeDirHandle('x'));
    kvMock.putValue = async () => false;   // IDB 写失败
    expect(await mod.fsBackupPickDirectory()).toBe(false);
    expect(mod.fsBackupStatus()).toBe('off');
  });

  it('disable：清句柄+状态 off+IDB 键删除（「关」=无句柄）', async () => {
    setPicker(async () => fakeDirHandle('MyBackups'));
    const mod = await freshMod();
    expect(await mod.fsBackupPickDirectory()).toBe(true);
    await mod.fsBackupDisable();
    expect(kvMock.values.has(mod.FS_BACKUP_HANDLE_KEY)).toBe(false);
    expect(mod.fsBackupStatus()).toBe('off');
  });
});

describe.skipIf(EXT_MISSING)('BJ614 B组：句柄 IDB round-trip + 竞态守卫', () => {
  it('round-trip：kvGetUnknown 读回句柄 → 状态按 queryPermission 三态落（granted/prompt/denied）', async () => {
    for (const [perm, want] of [['granted', 'ready'], ['prompt', 'needs-permission'], ['denied', 'broken']] as const) {
      vi.resetModules();
      kvMock.values.clear();
      kvMock.values.set('sandboxworld.fsBackup.dir', fakeDirHandle('MyBackups', { perm }));
      const mod = await freshMod();
      // 模块启动预取自动装载——给微任务一拍 settle
      await new Promise((r) => setTimeout(r, 0));
      expect(mod.fsBackupStatus(), perm).toBe(want);
    }
  });

  it('迟到预取不覆盖新手势态（pick 先行 → 预取结果丢弃）', async () => {
    // 预取在途（人为挂起）→ 期间 pick 落新句柄 → 预取 settle 后不得覆盖
    let release!: (v: unknown) => void;
    kvMock.getUnknown = (key) => {
      if (kvMock.values.has(key)) return Promise.resolve(kvMock.values.get(key));
      return new Promise((res) => { release = res; });
    };
    setPicker(async () => fakeDirHandle('NewPick'));
    const mod = await freshMod();
    expect(await mod.fsBackupPickDirectory()).toBe(true);
    expect(mod.fsBackupStatus()).toBe('ready');
    release(null);   // 迟到预取（空库）settle
    await new Promise((r) => setTimeout(r, 0));
    expect(mod.fsBackupStatus()).toBe('ready');   // 未被覆盖为 off
  });
});

describe.skipIf(EXT_MISSING)('BJ614 C组：自动写链+轮转+index 覆盖档', () => {
  it('启用+granted → write spy 带文件名格式（{名}_{id}_YYYYMMDD_HHmmss.json）+内容全量', async () => {
    const dir = fakeDirHandle('MyBackups');
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    await mod.fsBackupSnapshot('world', 7, 'My World', '{"json":1}', FROZEN);
    const f = dir.files.get('My_World_7_20261010_123456.json');
    expect(f, '文件名=世界名消毒_id_时间戳.json').toBeTruthy();
    expect(f!.content).toBe('{"json":1}');
  });

  it('轮转：分组内超 3 删最旧（新档+最近 2 份保留）;只清本 (kind,id) 组', async () => {
    const removeSpy = vi.fn((n: string) => {});
    const dir = fakeDirHandle('MyBackups', {
      files: {
        // 本组（world,7）：3 旧档 → 写入新档后共 4 份 → 删最旧 1 份
        'Old_7_20250101_000001.json': 'a',
        'Old_7_20250102_000002.json': 'b',
        'Old_7_20250103_000003.json': 'c',
        // 他组（world,8）：不动
        'Other_8_20240101_000004.json': 'd',
        // 角色组：不动
        'Alice_char_1_20240101_000005.json': 'e',
        // index 覆盖档：不匹配快照正则,不动
        'worlds.index.json': 'idx',
      },
      removeEntrySpy: (n) => removeSpy(n),
    });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    await mod.fsBackupSnapshot('world', 7, 'Old', 'new', new Date(2026, 0, 4, 0, 0, 4));
    expect(dir.files.get('Old_7_20260104_000004.json')?.content).toBe('new');
    expect([...removeSpy.mock.calls.map((c) => c[0] as string)]).toEqual(['Old_7_20250101_000001.json']);
    expect(dir.files.has('Old_7_20250102_000002.json')).toBe(true);
    expect(dir.files.has('Old_7_20250103_000003.json')).toBe(true);
    expect(dir.files.has('Other_8_20240101_000004.json')).toBe(true);
    expect(dir.files.has('Alice_char_1_20240101_000005.json')).toBe(true);
    expect(dir.files.has('worlds.index.json')).toBe(true);
  });

  it('index 覆盖档：worlds/players.index.json 恒覆盖（不轮转,永远是最新索引）', async () => {
    const dir = fakeDirHandle('MyBackups', { files: { 'worlds.index.json': '[{"id":1}]' } });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    await mod.fsBackupIndex('worlds', '[{"id":1},{"id":2}]');
    await mod.fsBackupIndex('players', '[{"id":9}]');
    expect(dir.files.get('worlds.index.json')?.content).toBe('[{"id":1},{"id":2}]');
    expect(dir.files.get('players.index.json')?.content).toBe('[{"id":9}]');
  });

  it('角色/随身态快照同构：_char_/_state_ 中缀文件名', async () => {
    const dir = fakeDirHandle('MyBackups');
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    await mod.fsBackupSnapshot('player', 3, 'Alice', '{"appearance":1}', FROZEN);
    await mod.fsBackupSnapshot('playerstate', 3, 'Alice', '{"inv":[]}', FROZEN);
    expect(dir.files.get('Alice_char_3_20261010_123456.json')?.content).toBe('{"appearance":1}');
    expect(dir.files.get('Alice_state_3_20261010_123456.json')?.content).toBe('{"inv":[]}');
  });
});

describe.skipIf(EXT_MISSING)('BJ614 D组：prompt 态静默跳过', () => {
  it('queryPermission=prompt → 不写目录+状态 needs-permission+失败链不计（跨会话常态,不强弹）', async () => {
    const dir = fakeDirHandle('MyBackups', { perm: 'prompt' });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    await mod.fsBackupSnapshot('world', 7, 'W', 'j', FROZEN);
    expect(dir.files.size).toBe(0);
    expect(mod.fsBackupStatus()).toBe('needs-permission');
    // requestPermission（手势）granted → 恢复 ready
    dir.setPerm('granted');
    expect(await mod.fsBackupRequestPermission()).toBe(true);
    expect(mod.fsBackupStatus()).toBe('ready');
  });

  it('恢复链 prompt 态：不尝试读目录（reason=prompt,原错误文案路径由调用方走）', async () => {
    const dir = fakeDirHandle('MyBackups', { perm: 'prompt', files: { 'W_7_20260101_000001.json': 'x' } });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    const r = await mod.restoreFromBackup('sandboxworld.world.7');
    expect(r).toEqual({ ok: false, reason: 'prompt' });
  });
});

describe.skipIf(EXT_MISSING)('BJ614 E组：失败降级+连败一次性提示', () => {
  it('写失败 → 状态 broken+连续 3 败一次性 toast（同一连败段不重报;成功重计）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const toastSpy = vi.fn();
    const dir = fakeDirHandle('MyBackups');
    dir.setWriteError(new Error('NotFoundError'));
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    mod.setFailToastHandler(toastSpy);
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(mod.fsBackupStatus()).toBe('broken');
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(toastSpy, '连续 3 败 → 一次性 toast').toHaveBeenCalledTimes(1);
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(toastSpy, '同一连败段不重报').toHaveBeenCalledTimes(1);
    // 成功 → 连败重计（再 3 败再报一次）
    dir.setWriteError(undefined);
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(mod.fsBackupStatus()).toBe('ready');
    dir.setWriteError(new Error('gone'));
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(toastSpy, '成功重置后未满 3 败不再报').toHaveBeenCalledTimes(1);
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(toastSpy, '新连败段再报一次').toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it('成功写复位连败计数+状态回 ready;denied=broken（重选目录面）', async () => {
    const dir = fakeDirHandle('MyBackups');
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(mod.fsBackupStatus()).toBe('ready');
    dir.setPerm('denied');
    await mod.fsBackupSnapshot('world', 1, 'W', 'j', FROZEN);
    expect(mod.fsBackupStatus()).toBe('broken');
    expect(await mod.fsBackupRequestPermission()).toBe(false);
  });
});

describe.skipIf(EXT_MISSING)('BJ614 F组：纯函数（文件名/解析消歧/轮转核/键映射）', () => {
  it('buildFsBackupFilename：消毒+空名回退+三类中缀', async () => {
    const mod = await freshMod();
    expect(mod.buildFsBackupFilename('world', 'My World', 7, FROZEN)).toBe('My_World_7_20261010_123456.json');
    expect(mod.buildFsBackupFilename('player', 'Alice', 3, FROZEN)).toBe('Alice_char_3_20261010_123456.json');
    expect(mod.buildFsBackupFilename('playerstate', 'Alice', 3, FROZEN)).toBe('Alice_state_3_20261010_123456.json');
    expect(mod.buildFsBackupFilename('world', 'a/b:c*?', 1, FROZEN)).toBe('a_b_c__1_20261010_123456.json');
    expect(mod.buildFsBackupFilename('world', '', 1, FROZEN)).toBe('world_1_20261010_123456.json');
    expect(mod.buildFsBackupFilename('player', '  ', 2, FROZEN)).toBe('char_char_2_20261010_123456.json');
  });

  it('parseFsBackupFilename 消歧矩阵：时间戳段使三类互斥（名含 _char_/_state_ 的世界不误分类）', async () => {
    const mod = await freshMod();
    expect(mod.parseFsBackupFilename('My_World_7_20261010_123456.json')).toEqual({ kind: 'world', id: 7, stamp: '20261010_123456' });
    expect(mod.parseFsBackupFilename('Alice_char_3_20260101_010101.json')).toEqual({ kind: 'player', id: 3, stamp: '20260101_010101' });
    expect(mod.parseFsBackupFilename('Alice_state_3_20260101_010101.json')).toEqual({ kind: 'playerstate', id: 3, stamp: '20260101_010101' });
    // 世界名 'x_char_5' id 9 → 不得误分类为 player 5
    expect(mod.parseFsBackupFilename('x_char_5_9_20261010_123456.json')).toEqual({ kind: 'world', id: 9, stamp: '20261010_123456' });
    // 世界名 'x_state_2' id 4 → world 4
    expect(mod.parseFsBackupFilename('x_state_2_4_20261010_123456.json')).toEqual({ kind: 'world', id: 4, stamp: '20261010_123456' });
    // 角色名 'y_2' id 4 → player 4
    expect(mod.parseFsBackupFilename('y_2_char_4_20261010_123456.json')).toEqual({ kind: 'player', id: 4, stamp: '20261010_123456' });
    // 角色名 'w_plstate_2' id 6 → player 6
    expect(mod.parseFsBackupFilename('w_plstate_2_char_6_20261010_123456.json')).toEqual({ kind: 'player', id: 6, stamp: '20261010_123456' });
    // index 覆盖档/坏时间戳/无关文件 → null
    expect(mod.parseFsBackupFilename('worlds.index.json')).toBeNull();
    expect(mod.parseFsBackupFilename('My_World_7_20261010_12345.json')).toBeNull();
    expect(mod.parseFsBackupFilename('unrelated.txt')).toBeNull();
  });

  it('pickRotatingOut：新→旧保留 keep 份,其余（含不可解析残档）清除', async () => {
    const mod = await freshMod();
    const names = [
      'W_7_20250101_000001.json',
      'W_7_20250103_000003.json',
      'W_7_20250102_000002.json',
      'W_7_20250104_000004.json',
      'residue.json',
    ];
    expect(mod.pickRotatingOut(names, 3)).toEqual(['W_7_20250101_000001.json', 'residue.json']);
    expect(mod.pickRotatingOut(names, 5)).toEqual([]);
  });

  it('backupTargetOfKey：五类数据键映射（恢复链/幽灵扫描共用;★BJ618 件3 quicksave 入图）', async () => {
    const mod = await freshMod();
    expect(mod.backupTargetOfKey('sandboxworld.world.7')).toEqual({ kind: 'world', id: 7 });
    expect(mod.backupTargetOfKey('sandboxworld.player.3')).toEqual({ kind: 'player', id: 3 });
    expect(mod.backupTargetOfKey('sandboxworld.playerstate.3')).toEqual({ kind: 'playerstate', id: 3 });
    expect(mod.backupTargetOfKey('sandboxworld.worlds.index')).toEqual({ kind: 'index', which: 'worlds' });
    expect(mod.backupTargetOfKey('sandboxworld.players.index')).toEqual({ kind: 'index', which: 'players' });
    // ★BJ618 件3：quicksave 原为未映射（probe F6 三面裸奔物证）——现入图=覆盖式 quicksave.json
    expect(mod.backupTargetOfKey('sandboxworld.quicksave')).toEqual({ kind: 'quicksave', id: 0 });
    expect(mod.backupTargetOfKey('sandboxworld.options')).toBeNull();
  });
});

describe.skipIf(EXT_MISSING)('BJ614 G组：读档自愈恢复链', () => {
  it('IDB miss+备份有 → 最新档读出+kvSet 写回 IDB+返回文本（正常链续跑素材）', async () => {
    const dir = fakeDirHandle('MyBackups', {
      files: {
        'W_7_20250101_000001.json': 'older',
        'W_7_20250102_000002.json': 'newer',
      },
    });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    kvMock.values.delete('sandboxworld.world.7');   // IDB miss 形态
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    const r = await mod.restoreFromBackup('sandboxworld.world.7');
    expect(r).toEqual({ ok: true, text: 'newer', file: 'W_7_20250102_000002.json' });
    expect(kvMock.values.get('sandboxworld.world.7')).toBe('newer');   // 写回 IDB（kvSet 通道）
  });

  it('角色外观/随身态/双 index 同构恢复', async () => {
    const dir = fakeDirHandle('MyBackups', {
      files: {
        'Alice_char_3_20260101_010101.json': '{"appearance":1}',
        'Alice_state_3_20260101_010102.json': '{"inv":[]}',
        'worlds.index.json': '[{"id":7}]',
        'players.index.json': '[{"id":3}]',
      },
    });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    expect(await mod.restoreFromBackup('sandboxworld.player.3')).toMatchObject({ ok: true, text: '{"appearance":1}' });
    expect(await mod.restoreFromBackup('sandboxworld.playerstate.3')).toMatchObject({ ok: true, text: '{"inv":[]}' });
    expect(await mod.restoreFromBackup('sandboxworld.worlds.index')).toMatchObject({ ok: true, text: '[{"id":7}]' });
    expect(await mod.restoreFromBackup('sandboxworld.players.index')).toMatchObject({ ok: true, text: '[{"id":3}]' });
    expect(kvMock.values.get('sandboxworld.players.index')).toBe('[{"id":3}]');
  });

  // ★Issue#25 回归锁（2026-10-27）：标准 FileSystemFileHandle 形状——只有 getFile()/
  // createWritable()（无句柄级 text()）。旧代码 fh.text() 在真机必抛
  // TypeError: fh.text is not a function → catch 转 broken = 备份永不可恢复;旧夹具
  // 照错误接口造 {text} 反而恒绿（幻想接口掩蔽判例）。本用例用最小标准形状钉死。
  it('Issue#25 标准句柄形状恢复：仅 getFile() 的句柄 → 恢复成功（旧码必 broken）', async () => {
    // 最小标准形状：getFileHandle 返回的句柄【只有 getFile】,text() 在 File 上
    const stdDir = {
      kind: 'directory' as const,
      name: 'StdBackups',
      queryPermission: async () => 'granted' as const,
      keys: async function* () { yield 'W_9_20261027_120000.json'; },
      getFileHandle: async (n: string) => ({
        getFile: async () => ({ text: async () => `std-shape:${n}` }),
        // ★刻意不设 text/createWritable——真机形状
      }),
      removeEntry: async () => {},
    };
    kvMock.values.set('sandboxworld.fsBackup.dir', stdDir);
    kvMock.values.delete('sandboxworld.world.9');
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    const r = await mod.restoreFromBackup('sandboxworld.world.9');
    expect(r).toEqual({ ok: true, text: 'std-shape:W_9_20261027_120000.json', file: 'W_9_20261027_120000.json' });
    expect(kvMock.values.get('sandboxworld.world.9')).toBe('std-shape:W_9_20261027_120000.json');
  });

  it('Issue#25 结构锁：FsBackup 源码经 getFile() 取 File 读全文,禁句柄级 text() 复活', () => {
    const src = readFileSync(resolve(__dirname, '..', 'src', 'save', 'FsBackup.ts'), 'utf8');
    expect(src).toContain('await fh.getFile()).text()');
    expect(src).not.toMatch(/fh\.text\(/);
    // 接口面锁：句柄形状声明必须是 getFile 而非 text
    expect(src).toContain('getFile(): Promise<{ text(): Promise<string> }>');
    expect(src).not.toMatch(/^\s*text\(\): Promise<string>;/m);
  });

  it('备份无该键档 → no-backup（原错误文案路径）;句柄目录枚举失败 → broken', async () => {
    const dir = fakeDirHandle('MyBackups', { files: { 'W_8_20250101_000001.json': 'x' } });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    expect(await mod.restoreFromBackup('sandboxworld.world.7')).toEqual({ ok: false, reason: 'no-backup' });

    const deadDir = fakeDirHandle('Gone');
    deadDir.setKeysError(new Error('NotFoundError'));
    kvMock.values.set('sandboxworld.fsBackup.dir', deadDir);
    vi.resetModules();
    const mod2 = await import('../src/save/FsBackup');
    await new Promise((r) => setTimeout(r, 0));
    expect(await mod2.restoreFromBackup('sandboxworld.world.7')).toEqual({ ok: false, reason: 'broken' });
  });

  it('特性未启用（无句柄）→ off;未映射键 → unknown-key（★BJ618 件3:quicksave 已入图走 off）', async () => {
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    expect(await mod.restoreFromBackup('sandboxworld.world.7')).toEqual({ ok: false, reason: 'off' });
    // ★BJ618 件3：quicksave 已映射（原 unknown-key 物证面退役）——未启用态如实报 off
    expect(await mod.restoreFromBackup('sandboxworld.quicksave')).toEqual({ ok: false, reason: 'off' });
    expect(await mod.restoreFromBackup('sandboxworld.options')).toEqual({ ok: false, reason: 'unknown-key' });
  });

  it('kvSet 写回失败（IDB 全面故障）→ broken（调用方走原错误文案,不留半态）', async () => {
    const dir = fakeDirHandle('MyBackups', { files: { 'W_7_20250101_000001.json': 'x' } });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    kvMock.set = async () => 'fail';
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    expect(await mod.restoreFromBackup('sandboxworld.world.7')).toEqual({ ok: false, reason: 'broken' });
    expect(kvMock.values.has('sandboxworld.world.7')).toBe(false);
  });

  it('幽灵扫描联动：被驱逐条目逐键恢复计数;prompt 态 attempted=false（不弹恢复提示）', async () => {
    const dir = fakeDirHandle('MyBackups', {
      files: {
        'W_7_20250101_000001.json': 'w7',
        'Alice_char_3_20260101_010101.json': 'a3',
      },
    });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await new Promise((r) => setTimeout(r, 0));
    expect(await mod.fsBackupRestoreEvicted([
      { kind: 'world' as const, id: 7 },
      { kind: 'player' as const, id: 3 },
      { kind: 'world' as const, id: 9 },   // 无备份
    ])).toEqual({ attempted: true, restored: 2 });
    expect(kvMock.values.get('sandboxworld.world.7')).toBe('w7');
    expect(kvMock.values.get('sandboxworld.player.3')).toBe('a3');

    dir.setPerm('prompt');
    expect(await mod.fsBackupRestoreEvicted([{ kind: 'world' as const, id: 7 }]))
      .toEqual({ attempted: false, restored: 0 });
  });
});

describe.skipIf(EXT_MISSING)('BJ614 H组：接线结构锚+l10n 双语言', () => {
  const codeOf = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/^\s*\/\/.*$/gm, '');

  it('mainFlow：四回调接线/连败 toast/恢复链注入/loadFromKey 恢复/幽灵联动在位', () => {
    const s = codeOf('../src/mainFlow.ts');
    expect(s).toContain("worldStore.onDataWrite = (name, id, json) => { void fsBackupSnapshot('world', id, name, json); };");
    expect(s).toContain("charStore.onStateWrite");
    expect(s).toContain("void fsBackupIndex('worlds', JSON.stringify(worldStore.list()));");
    expect(s).toContain("void fsBackupIndex('players', JSON.stringify(charStore.list()));");
    expect(s).toContain('setFailToastHandler(() => { ui.toast(Lang.text(\'Mods.SandboxWorld.Toast.FsBackupFailStreak\')); });');
    expect(s).toContain('worldStore.onRestoreMiss = fsBackupRestoreMiss;');
    expect(s).toContain('charStore.onRestoreMiss = fsBackupRestoreMiss;');
    // loadFromKey 恢复链（★BJ617 件2 三段择源：IDB 现值 → FS 备份 → LS 副本 → loadFromJson 续跑）
    // ★R13-F2：lsRead 裸 localStorage 直读改原语层安全垫（LS 抛不炸读档链）
    // ★BJ655：prompt=读档点击手势链内当场 requestPermission+重跑择源;FsBackupNeedAuth
    //  toast 全面退役（主流程零 toast,授权状态提示面=设置页「待重新授权」）。
    expect(s).toContain('let resolved = await resolveLoadText(key, () => lsGetSafe(key));');
    expect(s).toContain("if (resolved.source === 'missing' && resolved.restoreReason === 'prompt'");
    expect(s).toContain('&& await fsBackupRequestPermission()) {');
    expect(s).toContain('resolved = await resolveLoadText(key, () => lsGetSafe(key));');
    expect(s).not.toContain('fsBackupAuthHintFire');
    expect(s).not.toContain('FsBackupNeedAuth');
    expect(s).toContain('if (!(await loadFromJson(resolved.text))) currentWorld = null;');   // ★BJ704-G7 2026-10-21 形随刀更新:恢复文本仍续跑 loadFromJson 零旁路（语义不变）,外包成败判定=失败清会话绑定;改判史=初锁裸 await
    // 幽灵扫描联动（BJ611 锚线不得动——扫描外尝试恢复,门内补提示）
    expect(s).toContain('const rec = await fsBackupRestoreEvicted(scan.evicted);');
    expect(s).toContain("Lang.text('Mods.SandboxWorld.Toast.StorageEvictedNotice', scan.evicted.length)");
  });

  it('WorldStore/CharacterStore：写库回调钩子+恢复注入点+index 快照在位', () => {
    const ws = codeOf('../src/save/WorldStore.ts');
    expect(ws).toContain('onDataWrite: ((name: string, id: number, saveJson: string) => void) | null = null;');
    expect(ws).toContain('onIndexWrite: (() => void) | null = null;');
    expect(ws).toContain('onRestoreMiss: ((key: string) => Promise<string | null>) | null = null;');
    expect(ws).toContain('this.onDataWrite?.(meta.name, meta.id, saveJson);');
    expect(ws).toContain('else this.onIndexWrite?.();');
    expect(ws).toContain('raw = await this.onRestoreMiss(INDEX_KEY);');
    const cs = codeOf('../src/save/CharacterStore.ts');
    expect(cs).toContain('onDataWrite: ((name: string, id: number, json: string) => void) | null = null;');
    expect(cs).toContain('onStateWrite: ((id: number, json: string) => void) | null = null;');
    expect(cs).toContain('this.onStateWrite?.(id, json);');
    expect(cs).toContain('this.onDataWrite?.(meta.name, meta.id, JSON.stringify(a));');
    expect(cs).toContain('raw = await this.safeRestoreMiss(stateKey(id));');
  });

  it('Settings：开关块/兼容门/重新授权/重选目录/l10n 行在位', () => {
    const s = codeOf('../src/ui/Settings.ts');
    expect(s).toContain('this.fsBackupBlock(),');
    expect(s).toContain('input.disabled = true;');
    expect(s).toContain("Lang.text('Mods.SandboxWorld.Settings.FsBackupUnsupported')");
    expect(s).toContain('await fsBackupPickDirectory();');
    expect(s).toContain('await fsBackupDisable();');
    expect(s).toContain('await fsBackupRequestPermission();');
    expect(s).toContain('onFsBackupStatusChange(() => this.build())');
    expect(s).toContain('this.fsBackupUnsub?.();');
  });

  it('KvStore：结构化克隆值通道在位（句柄持久化载体）', () => {
    const s = codeOf('../src/save/KvStore.ts');
    expect(s).toContain('export async function kvPutValue(key: string, value: unknown): Promise<boolean>');
    expect(s).toContain('export async function kvGetUnknown(key: string): Promise<unknown>');
  });

  it('l10n 双语言键全量在位（custom 源直读;全语言闸由 l10n-audit 兜）', () => {
    const keys = [
      'Mods.SandboxWorld.Settings.FsBackupDir',
      'Mods.SandboxWorld.Settings.FsBackupUnsupported',
      'Mods.SandboxWorld.Settings.FsBackupStatusOff',
      'Mods.SandboxWorld.Settings.FsBackupStatusReady',
      'Mods.SandboxWorld.Settings.FsBackupStatusAuth',
      'Mods.SandboxWorld.Settings.FsBackupStatusBroken',
      'Mods.SandboxWorld.Settings.FsBackupReauth',
      'Mods.SandboxWorld.Settings.FsBackupRepick',
      'Mods.SandboxWorld.Settings.FsBackupHint',
      'Mods.SandboxWorld.Toast.FsBackupRestored',
      'Mods.SandboxWorld.Toast.FsBackupFailStreak',
      'Mods.SandboxWorld.Toast.StorageEvictedNoticeFsRestored',
      'Mods.SandboxWorld.Toast.StorageEvictedNoticeFsTried',
    ];
    const flat = (src: string): Set<string> => {
      const j = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'tools', 'l10n-custom', src), 'utf8')) as Record<string, unknown>;
      const out = new Set<string>();
      const walk = (o: Record<string, unknown>, p: string): void => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === 'object') walk(v as Record<string, unknown>, `${p}${k}.`);
          else out.add(`${p}${k}`);
        }
      };
      walk(j, '');
      return out;
    };
    for (const lang of ['zh-Hans.json', 'en-US.json']) {
      const has = flat(lang);
      for (const k of keys) expect(has.has(k), `${lang} 缺 ${k}`).toBe(true);
    }
    // （custom 源在仓库根 tools/l10n-custom——game/tests 上一层是 game/,再上一层才是仓库根）
    // 构建产物双语言落键
    for (const lang of ['zh-Hans', 'en-US']) {
      const built = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'l10n', `${lang}.json`), 'utf8')) as Record<string, Record<string, string>>;
      expect(built.Mods?.[keys[0].replace('Mods.', '')], `${lang} 构建产物缺键`).toBeTruthy();
    }
  });
});
