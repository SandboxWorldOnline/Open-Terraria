// ★C11 存储域清偿（红蓝 R13 findings F1-F8）判别测试——probe 场景转正。
//  A 组（F1）：读序倒挂第五/六面收口——CharacterStore.getState / WorldStore.load 改
//   三段择源 IDB → FS 恢复链 → LS 兜底（旧 kvGet 的 LS 腿以双写时代陈旧副本抢先短路
//   FS 恢复链,BJ617 件2/BJ618 件5/BJ620 件2 同族第五/六面）。
//  B 组（F2）：KvStore 原语层 LS 卫生垫——kvGet/kvHas/kvDelete 裸 LS 面统一 try/catch
//   （LS 抛=「无兜底副本」诚实档,绝不劫持 IDB 主链/炸调用链）;boot 门降级续走+
//   quickSaveExists 预查+删除 UI catch（结构锚）。
//  C 组（F3+F6）：doSave 契约——charState 写并入全链 Promise.all（BJ144「退出等保存
//   完成」字面兑现,quitToMenu 放锁/saveAndReload reload 不再撕 .plr 段写）+
//   「世界已保存」改全链成功才报（quick 成+槽败双 toast 并存病）（结构锚）。
//  D 组（F4）：幽灵扫描文案中性化（「曾被浏览器清理」成因断言→「数据缺失」中性）
//   +playerstate 补进扫描面（外观同缺=驱逐实锤才补测,防新角色合法缺失误报）+
//   fsBackupRestoreEvicted 恢复面 kind 扩 playerstate（l10n 双语+构建产物锁）。
//  E 组（F5）：CharacterStore.copy 死码清扫锁（全库零生产调用方删除+影子用例连坐移除）。
//  F 组（F7）：persist 引用漂移修正锁（三判据引 web.dev 现行表述+驱逐机制引现行 MDN
//   Storage API 章节页）。
//  G 组（F8）：ensureLoaded 迁移门 `!raw` 漏损坏 index 形态——raw 真值但 parse 抛也走
//   迁移;显式空数组（用户删光世界）仍不迁移（原语义保留）。
//  垫：fake-IDB + LS 桩真实读写链（bj615/bj617/bj618 同垫）;LS 抛错面用「一抛就换」
//   夹具;模块级 nextId/openFailStreak/句柄态用 vi.resetModules 隔离。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installFakeIdb, type FakeIdbHandle } from './fake-idb-util';
// ★C档可移植:仓库外依赖(game/ 兄弟目录,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
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

const INDEX_KEY_W = 'sandboxworld.worlds.index';
const INDEX_KEY_C = 'sandboxworld.players.index';
const stateKeyOf = (id: number) => `sandboxworld.playerstate.${id}`;
const dataKeyOf = (id: number) => `sandboxworld.world.${id}`;
const FS_HANDLE_KEY = 'sandboxworld.fsBackup.dir';   // = FsBackup.FS_BACKUP_HANDLE_KEY（模块导入前装,字面量）

/** WorldMeta 最小形（ensureLoaded 解析只滤 id:number;evil 字面量窄化=可直传 WorldMeta 形参） */
const wmeta = (id: number, name: string) => ({ id, name, seed: '', w: 1, h: 1, difficulty: 0, evil: -1 as const, createdAt: 0, lastPlayed: 0, playTimeMs: 0, favorite: false });

/** LS 抛错夹具：临时把 globalThis.localStorage 换成「getItem/removeItem 一抛」桩
 *  （隐私模式/安全策略面）——测毕原样还原,不影响同文件他用例。 */
function withThrowingLs<T>(fn: () => Promise<T>): Promise<T> {
  const orig = (globalThis as unknown as { localStorage: Storage }).localStorage;
  const throwing = {
    getItem: () => { throw new DOMException(' SecurityError: LS 不可用（fake）', 'SecurityError'); },
    setItem: () => { throw new DOMException('SecurityError: LS 不可用（fake）', 'SecurityError'); },
    removeItem: () => { throw new DOMException('SecurityError: LS 不可用（fake）', 'SecurityError'); },
    clear: () => { throw new DOMException('SecurityError: LS 不可用（fake）', 'SecurityError'); },
    key: () => { throw new DOMException('SecurityError: LS 不可用（fake）', 'SecurityError'); },
    get length(): number { throw new DOMException('SecurityError: LS 不可用（fake）', 'SecurityError'); },
  } as unknown as Storage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = throwing;
  return fn().finally(() => { (globalThis as unknown as { localStorage: Storage }).localStorage = orig; });
}

/** 只读 fake 目录（恢复链面;bj617/bj618 同构） */
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
      // ★BJ735 改判史（随 Issue#25,2026-10-27）：夹具旧形=句柄级 text() 幻想接口
      // → 生产码改 (await fh.getFile()).text() 后 restoreFromBackup 必 broken,
      // A6 恢复链择源/D2 fsBackupRestoreEvicted 双红。同步标准句柄形状（同 bj617/bj618）。
      return { getFile: async () => ({ text: async () => map.get(n) ?? '' }) };
    },
    removeEntry: async () => { /* 恢复链不消费 */ },
  };
}

beforeEach(() => {
  mem.clear();
  idb.map.clear();
  idb.state.failOpen = false;
  idb.dropConnection();
  vi.resetModules();   // nextId/openFailStreak/句柄态全复位（模拟独立标签页/独立会话）
  // FS 兼容门缺省撑起（node 无 showDirectoryPicker=unsupported;恢复面用例经句柄值
  // 通道装载,不走 picker——bj618 同构垫）
  setPicker(async () => { throw new Error('picker not expected in this test'); });
});

// FS 兼容门夹具（FsBackup 读 globalThis.showDirectoryPicker——非 navigator 面）
const origPicker = (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
function setPicker(p: unknown): void { (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = p; }
afterEach(() => {
  if (origPicker === undefined) delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  else (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = origPicker;
});

// =====================================================================
// A 组 F1：读序倒挂第五/六面收口（getState / load 三段择源）
// =====================================================================
describe.skipIf(EXT_MISSING)('C11-A F1：getState/load 三段择源 IDB → FS 恢复链 → LS 兜底', () => {
  it('A1 CharacterStore.getState：IDB miss+LS 陈旧副本 → FS 恢复链被咨询并胜出（旧实现 kvGet 命中 LS 即短路）', async () => {
    mem.set(stateKeyOf(3), JSON.stringify({ inventory: [{ v: 'LS陈旧' }] }));
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    const asked: string[] = [];
    s.onRestoreMiss = async (key) => { asked.push(key); return JSON.stringify({ inventory: [{ v: 'FS恢复' }] }); };
    const got = await s.getState(3);
    expect(asked, 'FS 恢复链被咨询（旧实现永不可达=读序倒挂第五面）').toEqual([stateKeyOf(3)]);
    expect(got?.inventory, 'FS 备份新档优先于 LS 陈旧副本（.plr 段同族收口）').toEqual([{ v: 'FS恢复' }]);
  });

  it('A2 getState：FS 恢复链失败（null/抛错）→ LS 兜底保留（旧用户数据不因读序修复消失）', async () => {
    mem.set(stateKeyOf(3), JSON.stringify({ inventory: [{ v: 'LS兜底' }] }));
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s1 = new CS();
    s1.onRestoreMiss = async () => null;
    expect((await s1.getState(3))?.inventory).toEqual([{ v: 'LS兜底' }]);
    const s2 = new CS();
    s2.onRestoreMiss = async () => { throw new Error('恢复炸'); };
    expect((await s2.getState(3))?.inventory).toEqual([{ v: 'LS兜底' }]);
  });

  it('A3 getState：IDB 命中恒权威（FS 恢复链零咨询,健康档不得被恢复链倒灌）', async () => {
    idb.map.set(stateKeyOf(3), JSON.stringify({ inventory: [{ v: 'IDB现值' }] }));
    mem.set(stateKeyOf(3), JSON.stringify({ inventory: [{ v: 'LS陈旧' }] }));
    const { CharacterStore: CS } = await import('../src/save/CharacterStore');
    const s = new CS();
    let asked = 0;
    s.onRestoreMiss = async () => { asked++; return null; };
    expect((await s.getState(3))?.inventory).toEqual([{ v: 'IDB现值' }]);
    expect(asked, 'IDB 命中即权威').toBe(0);
  });

  it('A4 WorldStore.load：IDB miss+LS 陈旧副本 → FS 恢复链被咨询并胜出（旧实现 kvGet 命中 LS 即短路）', async () => {
    mem.set(dataKeyOf(3), '{"stale":"LS陈旧"}');
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    const asked: string[] = [];
    s.onRestoreMiss = async (key) => { asked.push(key); return '{"src":"FS恢复"}'; };
    const text = await s.load({ ...wmeta(3, '世界') });
    expect(asked, 'FS 恢复链被咨询（旧实现永不可达=读序倒挂第六面）').toEqual([dataKeyOf(3)]);
    expect(text, 'FS 备份新档优先于 LS 陈旧副本').toBe('{"src":"FS恢复"}');
  });

  it('A5 WorldStore.load：FS 恢复链失败 → LS 兜底;IDB 命中 → 零咨询', async () => {
    mem.set(dataKeyOf(3), '{"stale":"LS兜底"}');
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s1 = new WS();
    s1.onRestoreMiss = async () => null;
    expect(await s1.load({ ...wmeta(3, '世界') })).toBe('{"stale":"LS兜底"}');
    idb.map.set(dataKeyOf(4), '{"src":"IDB现值"}');
    mem.set(dataKeyOf(4), '{"stale":"LS陈旧"}');
    const s2 = new WS();
    let asked = 0;
    s2.onRestoreMiss = async () => { asked++; return null; };
    expect(await s2.load({ ...wmeta(4, '世界') })).toBe('{"src":"IDB现值"}');
    expect(asked).toBe(0);
  });

  it('A6 消费面集成：duplicate 经新 load 走真恢复链（FS 备份内容成副本源头,LS 陈旧不抢跑）', async () => {
    // 句柄先于模块导入落库（FsBackup 模块级 ensureLoaded 预取一次性）;新模块首注册
    // id 恒 1（nextId 起始）——备份文件名据此确定。
    idb.map.set(FS_HANDLE_KEY, fakeRoDir('A6', { '世界_1_20261010_000001.json': '{"src":"FS备份真身"}' }));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const { restoreFromBackup } = await import('../src/save/FsBackup');
    await tick();
    const s = new WS();
    s.onRestoreMiss = async (key) => {
      const r = await restoreFromBackup(key);   // mainFlow.fsBackupRestoreMiss 同构（恢复+写回 IDB）
      return r.ok ? r.text : null;
    };
    const meta = await s.register({ name: '世界', seed: 's', w: 1, h: 1, difficulty: 0, evil: -1 });
    expect(meta.id).toBe(1);
    mem.set(dataKeyOf(1), '{"stale":"LS陈旧"}');
    idb.map.delete(dataKeyOf(1));   // 模拟驱逐形态：index 在,数据键缺
    const copy = await s.duplicate(meta);
    expect(copy, '副本照常产生').toMatchObject({ id: 2 });
    expect(await s.load(copy!), '副本内容=FS 备份真身（旧实现=LS 陈旧副本抢跑）').toBe('{"src":"FS备份真身"}');
    expect(idb.map.get(dataKeyOf(2)), '副本数据真落库').toBe('{"src":"FS备份真身"}');
  });
});

// =====================================================================
// B 组 F2：KvStore 原语层 LS 卫生垫 + boot 门/预查/删除 UI 收口
// =====================================================================
describe.skipIf(EXT_MISSING)('C11-B F2：LS 卫生垫（隐私模式 LS 抛≠炸链）', () => {
  it('B1 kvDelete：LS removeItem 抛 → 仍 resolves 且 IDB 删除照常执行（旧实现首语句裸删=IDB 删除全跳过=隐私面）', async () => {
    idb.map.set(dataKeyOf(5), '{"data":1}');
    await withThrowingLs(async () => {
      const { kvDelete } = await import('../src/save/KvStore');
      await expect(kvDelete(dataKeyOf(5)), 'LS 抛被垫收,不劫持 IDB 主删链').resolves.toBeUndefined();
    });
    expect(idb.map.has(dataKeyOf(5)), 'IDB 数据键确实被删（已删数据不得经恢复链复活）').toBe(false);
  });

  it('B2 kvGet/kvHas：LS 抛 → 诚实降级档（null/false）不抛（旧实现裸读炸调用链）', async () => {
    idb.state.failOpen = true;
    idb.dropConnection();
    await withThrowingLs(async () => {
      const { kvGet, kvHas, lsGetSafe } = await import('../src/save/KvStore');
      await expect(kvGet(dataKeyOf(5))).resolves.toBeNull();
      await expect(kvHas(dataKeyOf(5))).resolves.toBe(false);
      expect(lsGetSafe('any')).toBeNull();
    });
  });

  it('B3 mainFlow resolveLoadText lsRead/quickSaveExists 预查收口（结构锚）', () => {
    const s = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(s).toContain('() => lsGetSafe(key)');
    expect(s).toContain('void kvHas(QUICK_SAVE_KEY).then((v) => { quickSaveExists = v; }).catch(');
  });

  it('B4 boot 门降级续走（结构锚）：kvHas 预查 catch——LS/IDB 抛≠boot 黑屏死路', () => {
    const s = readFileSync(resolve(__dirname, '../src/main.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(s).toContain("kvHas('sandboxworld.quicksave').catch(");
  });

  it('B5 删除 UI catch（结构锚）：CharSelect/WorldSelect delFn 删除链异常告警面在位', () => {
    const cs = readFileSync(resolve(__dirname, '../src/ui/CharSelect.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const ws = readFileSync(resolve(__dirname, '../src/ui/WorldSelect.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(cs).toContain("Lang.text('Mods.SandboxWorld.CharSelect.DeleteFail'");
    expect(ws).toContain("Lang.text('Mods.SandboxWorld.CharSelect.DeleteFail'");
  });
});

// =====================================================================
// C 组 F3+F6：doSave 契约（charState 并入全链 + 全链成功才报「世界已保存」）
// =====================================================================
describe.skipIf(EXT_MISSING)('C11-C F3+F6：doSave 全链落定契约（结构锚）', () => {
  const flow = () => readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');

  it('C1 charState 写并入全链 Promise.all（BJ144「退出等保存完成」含 .plr 段——quitToMenu 放锁/saveAndReload reload 不再撕写）', () => {
    const s = flow();
    expect(s, 'charState promise 化并纳入等待面').toContain('charWrite = charStore.setState(cid, player).catch(');
    expect(s, '全链三腿 settle').toContain('await Promise.all([quickWrite, slotWrite, charWrite]);');
    expect(s, '旧 fire-and-forget 悬浮形态退役').not.toContain('try { charStore.setState(cid, player).catch(');
  });

  it('C2「世界已保存」改全链成功才报（quick 成+槽败双 toast 并存病——成功提示移出 quickWrite 支,按 failGate 判言）', () => {
    const s = flow();
    expect(s, '成功 toast 在全链 settle 后、按同链失败标记判言').toContain('if (!silent && !failGate.toasted) ui.toast(Lang.text(\'Mods.SandboxWorld.Toast.Saved\'));');
    expect(s, '旧「quick 写成即弹」位置退役').not.toContain("if (!silent) ui.toast(Lang.text('Mods.SandboxWorld.Toast.Saved'));");
  });

  it('C3 quitToMenu 会话锁释放在 charState settle 之后（注释锚——位次由 F3 全链化自动闭合）', () => {
    const s = readFileSync(resolve(__dirname, '../src/mainFlow.ts'), 'utf8');   // 注释锚不剥注释
    expect(s).toContain('★R13-F3：charState 写已并入 doSave 全链');
    // 释放点仍位于 quitToMenu 内 await doSave() 之后（位次锚——release 取末次出现
    // =quitToMenu 段,前段 loadFromKey/载入失败支的 release 在 await doSave 之前）
    const releaseAt = s.lastIndexOf('heldSessionLocks?.release();');
    const awaitSaveAt = s.indexOf('await doSave();');
    expect(releaseAt).toBeGreaterThan(awaitSaveAt);
  });
});

// =====================================================================
// D 组 F4：幽灵扫描文案中性化 + playerstate 扫描面/恢复面
// =====================================================================
describe.skipIf(EXT_MISSING)('C11-D F4：幽灵扫描中性化+playerstate 面', () => {
  it('D1 scanEvictedSaves：外观+随身态双缺（驱逐实锤）→ playerstate 补报;单缺（新角色合法形态）→ 不补测', async () => {
    const sp = await import('../src/save/StoragePersistence');
    // ① 外观缺+随身态缺 → 双报（补测面在位）
    const r1 = await sp.scanEvictedSaves([], [{ id: 7, name: '甲' }],
      async (key) => (key === `sandboxworld.player.${7}` || key === stateKeyOf(7)) ? 'keyMissing' : 'present');
    expect(r1.evicted).toEqual([
      { kind: 'player', id: 7, name: '甲' },
      { kind: 'playerstate', id: 7, name: '甲' },
    ]);
    // ② 外观在+随身态缺（新角色未进过世界/前代角色无随身态=合法）→ 不补测不误报
    const probed2: string[] = [];
    const r2 = await sp.scanEvictedSaves([], [{ id: 8, name: '乙' }],
      async (key) => { probed2.push(key); return key === stateKeyOf(8) ? 'keyMissing' : 'present'; });
    expect(r2.evicted, '随身态单缺≠被清理（quicksave 同款纪律）').toEqual([]);
    expect(probed2, '外观在位时随身态键零探测').toEqual([`sandboxworld.player.${8}`]);
    // ③ 外观缺+随身态在（不可能但防误报）→ 只报外观
    const r3 = await sp.scanEvictedSaves([], [{ id: 9, name: '丙' }],
      async (key) => (key === `sandboxworld.player.${9}`) ? 'keyMissing' : 'present');
    expect(r3.evicted).toEqual([{ kind: 'player', id: 9, name: '丙' }]);
    // ④ playerstate probe unavailable → 不可定谳弃检
    const r4 = await sp.scanEvictedSaves([], [{ id: 7, name: '甲' }],
      async (key) => (key === stateKeyOf(7) ? 'unavailable' : 'keyMissing'));
    expect(r4.conclusive).toBe(false);
    expect(r4.evicted).toEqual([]);
  });

  it('D2 fsBackupRestoreEvicted：kind playerstate → 恢复 sandboxworld.playerstate.<id>（写回 IDB 自愈）', async () => {
    idb.map.set(FS_HANDLE_KEY, fakeRoDir('D2', { '甲_state_9_20261010_000001.json': '{"inventory":[{"v":"FS随身态"}]}' }));
    const fb = await import('../src/save/FsBackup');
    await tick();
    const r = await fb.fsBackupRestoreEvicted([{ kind: 'playerstate', id: 9 }]);
    expect(r, 'attempted+restored 计账').toEqual({ attempted: true, restored: 1 });
    expect(idb.map.get(stateKeyOf(9)), '恢复面写回 IDB=自愈,下次 getState 直命中').toBe('{"inventory":[{"v":"FS随身态"}]}');
  });

  it('D3 文案中性化（l10n 双语+构建产物）：不再断言「曾被浏览器清理/磁盘不足」成因（首存写败同形态≠驱逐）', () => {
    const zh = readFileSync(resolve(__dirname, '../../tools/l10n-custom/zh-Hans.json'), 'utf8');
    const en = readFileSync(resolve(__dirname, '../../tools/l10n-custom/en-US.json'), 'utf8');
    expect(zh).toContain('检测到 {0} 个存档数据缺失（可能因浏览器清理或历史保存失败）');
    expect(zh).not.toContain('曾被浏览器清理');
    expect(en).toContain('possibly browser cleanup or a failed save in the past');
    expect(en).not.toContain('previously cleared by the browser');
    // 构建产物（public/l10n）已随 build-l10n 重放——改源不重建=此锚爆红
    const zhBuilt = readFileSync(resolve(__dirname, '../public/l10n/zh-Hans.json'), 'utf8');
    const enBuilt = readFileSync(resolve(__dirname, '../public/l10n/en-US.json'), 'utf8');
    expect(zhBuilt).toContain('检测到 {0} 个存档数据缺失');
    expect(enBuilt).toContain('possibly browser cleanup or a failed save in the past');
    expect(zhBuilt).toContain('DeleteFail');
  });
});

// =====================================================================
// E 组 F5：copy() 死码清扫锁
// =====================================================================
describe.skipIf(EXT_MISSING)('C11-E F5：CharacterStore.copy 死码清扫（零生产调用方+影子用例连坐）', () => {
  it('E1 copy 方法已删（源+影子测试双锚）', () => {
    const src = readFileSync(resolve(__dirname, '../src/save/CharacterStore.ts'), 'utf8');
    const shadow = readFileSync(resolve(__dirname, '../tests/character-store.test.ts'), 'utf8');
    expect(src, 'copy() 零生产调用方（CharSelect 复制钮已改导出钮）——死码删除').not.toMatch(/async copy\(/);
    expect(shadow, '死码影子用例连坐移除').not.toContain('.copy(');
    expect(src, '清扫判语留档（接线前必须补 catch 面）').toContain('★R13-F5');
  });
});

// =====================================================================
// F 组 F7：persist 引用漂移修正锁
// =====================================================================
describe.skipIf(EXT_MISSING)('C11-F F7：persist 注释引用对齐现行源（三判据→web.dev;驱逐机制→现行 MDN）', () => {
  it('F7 StoragePersistence 头注引现行 web.dev/articles/persistent-storage 与 MDN Storage API 章节页', () => {
    const s = readFileSync(resolve(__dirname, '../src/save/StoragePersistence.ts'), 'utf8');
    expect(s, '三判据现行源（MDN 现行页已不载 Chromium 三启发式）').toContain('web.dev/articles/persistent-storage');
    expect(s, '驱逐机制现行源（MDN Storage API 章节）').toContain('Storage_quotas_and_eviction_criteria');
    expect(s, '旧并写引用退役').not.toContain('MDN "Storage quotas and eviction criteria" + web.dev');
  });
});

// =====================================================================
// G 组 F8：ensureLoaded 迁移门放宽（损坏 index 也走迁移）
// =====================================================================
describe.skipIf(EXT_MISSING)('C11-G F8：迁移门 `!raw` 漏损坏 index 形态', () => {
  it('G1 损坏 index（raw 真值但 parse 抛）+遗留 quicksave → 迁移照走（旧实现门被 raw 真值卡死=迁移面失效）', async () => {
    idb.map.set(INDEX_KEY_W, '{corrupted-index!!!');
    mem.set('sandboxworld.quicksave', JSON.stringify({ header: { name: '遗留世界', seed: 3, width: 100, height: 100, created: 1700000000000 } }));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    await s.ensureLoaded();
    expect(s.list(), '损坏 index 不再封死迁移面').toHaveLength(1);
    expect(s.list()[0]).toMatchObject({ id: 1, name: '遗留世界' });
    expect(idb.map.get(dataKeyOf(1)), '迁移数据真落库').toContain('遗留世界');
  });

  it('G2 显式空数组 index（用户删光世界）+遗留 quicksave → 仍不迁移（原语义保留,不复活已删档）', async () => {
    idb.map.set(INDEX_KEY_W, '[]');
    mem.set('sandboxworld.quicksave', JSON.stringify({ header: { name: '遗留世界', seed: 3, width: 100, height: 100, created: 1700000000000 } }));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    await s.ensureLoaded();
    expect(s.list()).toHaveLength(0);
    expect(idb.map.has(dataKeyOf(1)), '合法空 index 不触发迁移写').toBe(false);
  });

  it('G3 健康 index / 三源皆空 → 迁移面原语义回归（有 index 不迁移;真空且无 quicksave 不动）', async () => {
    idb.map.set(INDEX_KEY_W, JSON.stringify([wmeta(5, '现役')]));
    mem.set('sandboxworld.quicksave', JSON.stringify({ header: { name: '遗留世界', seed: 3, width: 100, height: 100 } }));
    const { WorldStore: WS } = await import('../src/save/WorldStore');
    const s = new WS();
    await s.ensureLoaded();
    expect(s.list().map((m) => m.name)).toEqual(['现役']);
    expect(idb.map.has(dataKeyOf(1)), '有健康 index 不迁移').toBe(false);
    // 全空+无 quicksave：不抛不产档（清盘模拟全新安装）
    idb.map.clear();
    idb.dropConnection();
    mem.clear();
    const s2 = new WS();
    await expect(s2.ensureLoaded()).resolves.toBeUndefined();
    expect(s2.list()).toHaveLength(0);
  });
});
