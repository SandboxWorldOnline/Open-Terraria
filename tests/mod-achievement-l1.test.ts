// ★成就域 L1 面守卫(2026-10-22):content/achievements/*.json 声明通道。
//   锚:plan.parseAchievement/achSpecs(键校验/条件 kind 白名单)→ register.
//   collectModAchievement 合流(apply 先于 entry 相位)→ loader 出口
//   buildModAchievementDefs 统一翻译(与 sw.achievement 脚本路径共用 pending)。
//   背景:mod-dev-guide §3.16 曾为文档谎言(装载器零消费该目录——pets/drops/
//   achievements 三假目录案的成就腿),本测=补真后的回归闸;未知 content/ 目录
//   fail-loud 警告同测(pets 假目录腿的防复发闸)。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

class MemStorage {
  reg = '[]';
  zips = new Map<string, Blob>();
  async getRegistry() { return this.reg; }
  async setRegistry(json: string) { this.reg = json; }
  async putZip(id: string, blob: Blob) { this.zips.set(id, blob); return true; }
  async getZip(id: string) { return this.zips.get(id) ?? null; }
  async deleteZip(id: string) { this.zips.delete(id); }
}
const nodeEntryLoader = async (): Promise<unknown> => undefined;

beforeEach(() => vi.resetModules());

const PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

/** 成就 L1 mod 包(npc+item+两成就 JSON;extra 追加/覆盖条目) */
function buildAchModZip(extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    'mod.json': strToU8(JSON.stringify({ id: 'achl1', name: 'achl1', version: '1.0.0', api: 1, side: 'both' })),
    'content/npcs/my_boss.json': strToU8(JSON.stringify({
      key: 'my_boss', name: 'TestBoss', aiStyle: 0, lifeMax: 100, damage: 10, defense: 0,
      width: 16, height: 16, texture: 'npc/b.png',
    })),
    'textures/npc/b.png': PNG,
    'content/items/my_mat.json': strToU8(JSON.stringify({ key: 'my_mat', name: 'Mat', value: 1 })),
    'content/achievements/slay.json': strToU8(JSON.stringify({
      key: 'slay', title: '屠龙者', desc: '击败测试 Boss', category: 0,
      conditions: [{ kind: 'npcKilled', keys: ['my_boss'] }],
    })),
    'content/achievements/hoard.json': strToU8(JSON.stringify({
      key: 'hoard', title: '囤积者',
      conditions: [{ kind: 'itemPickup', keys: [23] }],   // 原版裸 vid 直传
    })),
    ...extra,
  });
}

async function loadZip(
  bytes: Uint8Array,
  entryLoader: (code: Uint8Array) => Promise<unknown> = nodeEntryLoader,
) {
  const { ModStore } = await import('../src/mods/store');
  const { readModPack } = await import('../src/mods/pack');
  const { loadModsPhase1, getModLoadResult } = await import('../src/mods/loader');
  const storage = new MemStorage();
  const store = new ModStore(storage as never);
  await store.install(readModPack(bytes).manifest, bytes);
  await loadModsPhase1(storage, { entryLoader });
  return getModLoadResult()!;
}

describe('成就域 L1:content/achievements/*.json', () => {
  it('JSON 声明全链:装载即翻译(mod 键→分配 id/裸 vid 直传)/引擎通知驱动/图标 job', async () => {
    const bytes = buildAchModZip({
      'content/achievements/iconic.json': strToU8(JSON.stringify({
        key: 'iconic', title: '带图标', icon: 'icons/a.png',
        conditions: [{ kind: 'itemCraft', keys: ['my_mat'] }],
      })),
      'textures/icons/a.png': PNG,
    });
    const result = await loadZip(bytes);
    expect(result.errors).toEqual([]);
    const alloc = result.allocation!;

    const { modAchDefOf } = await import('../src/core/Achievements');
    const { modAchIconJobs } = await import('../src/mods/modAchievements');
    const slay = modAchDefOf('mod_achl1_slay');
    expect(slay?.title).toBe('屠龙者');
    expect(slay?.category).toBe(0);
    expect(slay?.conditions[0]!.ids).toEqual([alloc.npcs.get('mod_achl1_my_boss')]);
    expect(modAchDefOf('mod_achl1_hoard')?.conditions[0]!.ids).toEqual([23]);
    expect(modAchDefOf('mod_achl1_iconic')?.conditions[0]!.ids).toEqual([alloc.items.get('mod_achl1_my_mat')]);
    expect(modAchIconJobs().some((j) => j.fullKey === 'mod_achl1_iconic' && j.texPath === 'icons/a.png')).toBe(true);

    // 引擎通知自动驱动(npcKilled 条件零脚本)
    const { Achievements } = await import('../src/core/Achievements');
    const mem: { s: string | null } = { s: null };
    const a = new Achievements({ load: () => mem.s, save: (j) => { mem.s = j; } });
    a.notifyNPCKilled(alloc.npcs.get('mod_achl1_my_boss')!);
    expect(a.isCompleted('mod_achl1_slay')).toBe(true);
  }, 60_000);

  it('JSON 内同键重复=整批拒载(plan 纪律 fail-fast)', async () => {
    const bytes = buildAchModZip({
      'content/achievements/slay2.json': strToU8(JSON.stringify({
        key: 'slay', title: '撞键', conditions: [{ kind: 'custom' }],
      })),
    });
    const result = await loadZip(bytes);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.modId).toBe('*');
    expect(result.errors[0]!.error).toContain('成就键重复');
  }, 60_000);

  it('JSON+脚本同键=脚本相位 fail-fast 成 mod 级错误(JSON 先入列)', async () => {
    const bytes = buildAchModZip({
      'scripts/main.js': strToU8(
        `export default function main(sw) { sw.achievement('slay', { title: 'X', conditions: [{ kind: 'custom' }] }); }`),
    });
    const execEntry = async (code: Uint8Array): Promise<unknown> => {
      const cjs = new TextDecoder().decode(code).replace(/export\s+default\s+function\s+main/, 'function main');
      // eslint-disable-next-line no-new-func
      return new Function(`${cjs}; return main;`)();
    };
    const result = await loadZip(bytes, execEntry);
    expect(result.errors.some((e) => e.modId === 'achl1' && e.error.includes('重复注册'))).toBe(true);
  }, 60_000);

  it('未知 content/ 子目录 fail-loud 警告(内容被忽略,不再静默)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const bytes = buildAchModZip({
        'content/pets/wisp.json': strToU8(JSON.stringify({ key: 'wisp', proj: 'wisp' })),
      });
      const result = await loadZip(bytes);
      expect(result.errors).toEqual([]);   // 警告不拒载(增强面容错)
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('未识别的 content/pets/ 目录'))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  }, 60_000);
});
