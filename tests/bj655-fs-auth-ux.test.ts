// ★BJ655（2026-10-12 用户实报「Mac 上每次进入都提示本地备份目录要重新授权」）判别测试。
// 定谳链：Chromium FS Access 句柄权限会话级（BJ614 登记债——普通标签页每新会话回落
// 'prompt',仅安装态 PWA 跨会话持久）→ 幽灵扫描/读档恢复链撞 restoreFromBackup 的
// prompt 态 → fsBackupAuthHintFire 会话一次 toast → 每次新会话=每次提示,与设计原意
// （Settings.ts fsBackupBlock:自动链静默跳过+「待重新授权」常驻面,不强弹）相悖。
// 落刀三面：①幽灵/装配恢复链 prompt 静默（onRestoreMiss 零 toast）②读档链 prompt=
// 借点击手势当场 requestPermission（MDN/Chrome 官方:仅用户手势可触发;无手势
// SecurityError）→ 授予=重跑择源恢复+备份链激活;未授/拒绝=静默 ③FsBackupNeedAuth
// toast 退役（主流程/l10n 全语言零残留,设置页状态行为唯一常驻授权提示面）。
// 锁五面：A 幽灵链静默;B 读档链手势授权;C 授予后恢复+备份激活（行为面,真语义 mock
// 句柄）;D 拒绝/忽略/SecurityError 静默+设置页状态机;E 退役面（源+l10n custom+产物）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// ★C档可移植:l10n 源目录(仓库外 tools/l10n-custom,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['tools/l10n-custom'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));


// ---- KvStore 值通道 mock（同 bj614 夹具形状） ----
const kvMock = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
}));
vi.mock('../src/save/KvStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/save/KvStore')>();
  return {
    ...actual,
    kvGetUnknown: (key: string) => (kvMock.values.get(key) ?? null),
    kvPutValue: (key: string, value: unknown) => (kvMock.values.set(key, value), Promise.resolve(true)),
    kvDelete: (key: string) => (kvMock.values.delete(key), Promise.resolve()),
    kvSet: (key: string, value: string) => (kvMock.values.set(key, value), Promise.resolve('idb' as const)),
  };
});

// ---- File System Access 夹具（真语义 mock 句柄：requestPermission=用户对弹窗的
//      应答行为——grant 切 granted/dismiss 保持 prompt/deny 切 denied/throw 模拟无手势
//      SecurityError;queryPermission 恒读当前态） ----
interface FakeFile { name: string; content: string; writes: string[]; }
type Perm = 'granted' | 'prompt' | 'denied';
function fakeAuthDirHandle(name: string, opts: {
  perm?: Perm;
  requestBehavior?: 'grant' | 'dismiss' | 'deny' | 'security-error';
  files?: Record<string, string>;
} = {}) {
  const files = new Map<string, FakeFile>();
  for (const [k, v] of Object.entries(opts.files ?? {})) files.set(k, { name: k, content: v, writes: [] });
  let perm: Perm = opts.perm ?? 'prompt';
  const behavior = opts.requestBehavior ?? 'grant';
  const h = {
    kind: 'directory' as const,
    name,
    files,
    queryPermission: async () => perm,
    requestPermission: async () => {
      if (behavior === 'security-error') {
        const e = new Error('Transient user activation is required');
        (e as { name?: string }).name = 'SecurityError';
        throw e;
      }
      perm = behavior === 'grant' ? 'granted' : behavior === 'deny' ? 'denied' : 'prompt';
      return perm;
    },
    keys: async function* () { for (const k of [...files.keys()]) yield k; },
    getFileHandle: async (n: string, o?: { create?: boolean }) => {
      let f = files.get(n);
      if (!f) {
        if (!o?.create) { const e = new Error('NotFoundError'); (e as { name?: string }).name = 'NotFoundError'; throw e; }
        f = { name: n, content: '', writes: [] };
        files.set(n, f);
      }
      return {
        createWritable: async () => ({
          write: async (data: BlobPart) => { f!.writes.push(await new Blob([data]).text()); },
          close: async () => { f!.content = f!.writes.join(''); },
          abort: async () => {},
        }),
        // ★BJ735 改判史（随 Issue#25,2026-10-27）：夹具旧形=句柄级 text() 幻想接口
        // → 生产码改 (await fh.getFile()).text() 后必抛 TypeError→catch→broken,
        // C1 恢复链全链红。同步标准 FileSystemFileHandle 形状（同 bj614/bj617/bj618）。
        getFile: async () => ({ text: async () => f!.content }),
      };
    },
    removeEntry: async (n: string) => {
      if (!files.delete(n)) { const e = new Error('NotFoundError'); (e as { name?: string }).name = 'NotFoundError'; throw e; }
    },
  };
  return h;
}
type FakeAuthDir = ReturnType<typeof fakeAuthDirHandle>;

const origPicker = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
function setPicker(p: unknown): void { (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = p; }
beforeEach(() => {
  vi.resetModules();
  setPicker(async () => { throw new Error('picker not expected in this test'); });
});
afterEach(() => {
  if (origPicker === undefined) delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  else (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = origPicker;
  kvMock.values.clear();
});
function freshMod(): Promise<typeof import('../src/save/FsBackup')> {
  return import('../src/save/FsBackup');
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const codeOf = (p: string): string =>
  readFileSync(resolve(__dirname, p), 'utf8').replace(/^\s*\/\/.*$/gm, '');

// =====================================================================
// A+B：mainFlow 结构锁（幽灵链静默 / 读档链手势授权 / toast 退役）
// =====================================================================
describe.skipIf(EXT_MISSING)('BJ655 A组：幽灵/装配恢复链 prompt 静默锁（零 toast）', () => {
  it('A1 fsBackupRestoreMiss prompt 静默：会话提示状态机+auth toast 调用面整体退役', () => {
    const s = codeOf('../src/mainFlow.ts');
    // 状态机+toast 调用面零残留（变异一发：回插 fsBackupAuthHintFire → 本组+退役面恰红）
    expect(s).not.toContain('fsBackupAuthHintShown');
    expect(s).not.toContain('fsBackupAuthHintFire');
    expect(s).not.toContain('FsBackupNeedAuth');
    // 恢复链本体在位：miss 回调零旁路,prompt 落静默 null（提示面=设置页）
    expect(s).toContain('worldStore.onRestoreMiss = fsBackupRestoreMiss;');
    expect(s).toContain('charStore.onRestoreMiss = fsBackupRestoreMiss;');
    expect(s).toContain("ui.toast(Lang.text('Mods.SandboxWorld.Toast.FsBackupRestored', r.file));");
    expect(s).toContain('return null;   // ★BJ655：prompt（及一切失败态）静默,授权状态提示面=设置页');
  });

  it('A2 幽灵扫描联动锚线不动（BJ611 门内恢复链+补提示原文在位）', () => {
    const s = codeOf('../src/mainFlow.ts');
    expect(s).toContain('const rec = await fsBackupRestoreEvicted(scan.evicted);');
    expect(s).toContain("Lang.text('Mods.SandboxWorld.Toast.StorageEvictedNotice', scan.evicted.length)");
    // 幽灵链恢复成功/尝试补提示（granted 态专属,prompt 不达此面）保持
    expect(s).toContain('Mods.SandboxWorld.Toast.StorageEvictedNoticeFsRestored');
    expect(s).toContain('Mods.SandboxWorld.Toast.StorageEvictedNoticeFsTried');
  });
});

describe.skipIf(EXT_MISSING)('BJ655 B组：读档链手势授权锁（prompt=点击链内 requestPermission+重跑择源）', () => {
  it('B1 手势授权块在位：missing∧prompt ∧ await fsBackupRequestPermission → 重跑 resolveLoadText', () => {
    const s = codeOf('../src/mainFlow.ts');
    expect(s).toContain('let resolved = await resolveLoadText(key, () => lsGetSafe(key));');
    expect(s).toContain("if (resolved.source === 'missing' && resolved.restoreReason === 'prompt'");
    expect(s).toContain('&& await fsBackupRequestPermission()) {');
    expect(s).toContain('resolved = await resolveLoadText(key, () => lsGetSafe(key));');
    // fsBackupRequestPermission 须经 FsBackup 导入（设置页按钮同源=同一授权状态机）
    expect(s).toContain('fsBackupRequestPermission } from \'./save/FsBackup\'');
  });

  it('B2 missing 分支零授权 toast（kvIdbStatus 诊断+缺失分类文案原语义不动）', () => {
    const s = codeOf('../src/mainFlow.ts');
    expect(s).toContain('void kvIdbStatus(key).then((s) => console.warn(\'[load] IDB 态诊断\', key, s));');
    expect(s).toContain('ui.toast(Lang.text(saveMissingToastKey(saveMissing), \'存档数据缺失\'));');
    expect(s).not.toContain('FsBackupNeedAuth');
  });
});

// =====================================================================
// C+D：行为面（FsBackup 模块级,真语义 mock 句柄——授予/拒绝/忽略/无手势）
// =====================================================================
describe.skipIf(EXT_MISSING)('BJ655 C组：授予后恢复+备份全链激活（读档手势授权的连锁面）', () => {
  it('C1 prompt → 手势授权 granted → restoreFromBackup 命中写回 IDB + 快照链复活', async () => {
    const dir: FakeAuthDir = fakeAuthDirHandle('MyBackups', {
      perm: 'prompt',
      requestBehavior: 'grant',
      files: { 'W_7_20260101_010101.json': '{"header":{"name":"w7"}}' },
    });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await tick();   // 模块预取（ensureLoaded fire-and-forget）
    expect(mod.fsBackupStatus()).toBe('needs-permission');

    // 授权前：恢复链 prompt 拒答（静默跳过,不尝试）
    expect(await mod.restoreFromBackup('sandboxworld.world.7')).toEqual({ ok: false, reason: 'prompt' });
    expect(kvMock.values.has('sandboxworld.world.7')).toBe(false);

    // 读档点击手势链内：requestPermission granted → 状态 ready（设置页订阅面同步）
    expect(await mod.fsBackupRequestPermission()).toBe(true);
    expect(mod.fsBackupStatus()).toBe('ready');

    // 恢复+备份全链当场激活：恢复命中写回 IDB（自愈）;快照链写通（备份复活）
    const r = await mod.restoreFromBackup('sandboxworld.world.7');
    expect(r).toMatchObject({ ok: true, text: '{"header":{"name":"w7"}}', file: 'W_7_20260101_010101.json' });
    expect(kvMock.values.get('sandboxworld.world.7')).toBe('{"header":{"name":"w7"}}');
    await mod.fsBackupSnapshot('world', 8, 'N', 'json8');
    const wrote = [...dir.files.keys()].filter((n) => n.startsWith('N_8_'));
    expect(wrote).toHaveLength(1);
    expect(wrote[0]).toMatch(/^N_8_\d{8}_\d{6}\.json$/);
  });
});

describe.skipIf(EXT_MISSING)('BJ655 D组：未授/拒绝/无手势 → 静默+设置页状态机（零 toast 面）', () => {
  it('D1 dismiss（prompt 维持）→ false+needs-permission;denied → false+broken', async () => {
    const dir: FakeAuthDir = fakeAuthDirHandle('B', { perm: 'prompt', requestBehavior: 'dismiss', files: {} });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await tick();
    expect(await mod.fsBackupRequestPermission()).toBe(false);
    expect(mod.fsBackupStatus()).toBe('needs-permission');   // 忽略弹窗=状态原地,设置页仍示「待重新授权」
  });

  it('D1b 用户在权限弹窗明确拒绝（denied）→ false+broken（设置页转「重新选择目录」）', async () => {
    const dir: FakeAuthDir = fakeAuthDirHandle('B', { perm: 'prompt', requestBehavior: 'deny', files: {} });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await tick();
    expect(await mod.fsBackupRequestPermission()).toBe(false);
    expect(mod.fsBackupStatus()).toBe('broken');   // denied=权限被吊销 → 重选目录面
  });

  it('D2 无手势（程序化入口）SecurityError → catch 静默 false,状态不被误改', async () => {
    const dir: FakeAuthDir = fakeAuthDirHandle('B', { perm: 'prompt', requestBehavior: 'security-error', files: {} });
    kvMock.values.set('sandboxworld.fsBackup.dir', dir);
    const mod = await freshMod();
    await tick();
    const warns: unknown[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warns.push(a); });
    try {
      expect(await mod.fsBackupRequestPermission()).toBe(false);
      expect(mod.fsBackupStatus()).toBe('needs-permission');   // 状态不被误降级
      expect(warns.some((w) => String((w as unknown[])[0]).includes('requestPermission'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

// =====================================================================
// E：FsBackupNeedAuth toast 退役面（源/l10n custom/构建产物三账）
// =====================================================================
describe.skipIf(EXT_MISSING)('BJ655 E组：FsBackupNeedAuth toast 退役面', () => {
  it('E1 mainFlow 源零引用;设置页授权常驻面（状态行+重授权按钮）仍在', () => {
    expect(codeOf('../src/mainFlow.ts')).not.toContain('FsBackupNeedAuth');
    const st = codeOf('../src/ui/Settings.ts');
    expect(st).toContain('await fsBackupRequestPermission();');   // 重授权按钮（click=手势）
    expect(st).toContain("'Mods.SandboxWorld.Settings.FsBackupStatusAuth'");   // 「待重新授权」状态行（三元跨行,锁键名）
    expect(st).toContain("'Mods.SandboxWorld.Settings.FsBackupReauth'");
  });

  it('E2 l10n custom 源+构建产物全语言零残留（退役键不回流）', () => {
    for (const lang of ['zh-Hans.json', 'en-US.json']) {
      const custom = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'tools', 'l10n-custom', lang), 'utf8')) as Record<string, Record<string, string>>;
      expect(custom.Mods['SandboxWorld.Toast.FsBackupNeedAuth'], `${lang} custom 源`).toBeUndefined();
    }
    for (const lang of ['zh-Hans.json', 'en-US.json', 'ja-JP.json']) {
      const built = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'l10n', lang), 'utf8')) as Record<string, Record<string, string>>;
      expect(built.Mods['SandboxWorld.Toast.FsBackupNeedAuth'], `${lang} 构建产物`).toBeUndefined();
      // 同族活跃键仍在（恢复成功/连败/幽灵补提示不退役）
      expect(typeof built.Mods['SandboxWorld.Toast.FsBackupRestored']).toBe('string');
      expect(typeof built.Mods['SandboxWorld.Toast.FsBackupFailStreak']).toBe('string');
    }
  });
});
