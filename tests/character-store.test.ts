// 角色存储 CRUD + Appearance 校验（node 环境需 stub localStorage + fake-IDB——
// ★BJ615 单写方案后 kvSet 恒走 IDB,node 需可写 IDB 垫才能驱动真实读写链）
import { describe, it, expect, beforeEach } from 'vitest';
import { installFakeIdb } from './fake-idb-util';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;
const idb = installFakeIdb();

const { CharacterStore } = await import('../src/save/CharacterStore');
const { validateAppearance, defaultAppearance, randomAppearance, MALE_VARIANTS, FEMALE_VARIANTS, FEMALE_HAIRS, VALID_CLOTH_STYLES } = await import('../src/player/Appearance');

describe('Appearance', () => {
  it('默认值 = 原版色（Player.cs:199-205）', () => {
    const a = defaultAppearance();
    expect(a.hairColor).toEqual({ r: 215, g: 90, b: 55 });
    expect(a.skinColor).toEqual({ r: 255, g: 125, b: 90 });
    expect(a.shirtColor).toEqual({ r: 175, g: 165, b: 140 });
    expect(a.undershirtColor).toEqual({ r: 160, g: 180, b: 215 });
    expect(a.pantsColor).toEqual({ r: 255, g: 230, b: 175 });
    expect(a.shoeColor).toEqual({ r: 160, g: 105, b: 60 });
  });

  it('校验：损坏数据补默认并钳制', () => {
    const a = validateAppearance({ name: 'x'.repeat(50), hair: 9999, difficulty: 9 as 0, hairColor: { r: 300, g: -5, b: 'a' as unknown as number } });
    expect(a.name.length).toBe(20);
    expect(a.hair).toBe(227);          // 钳到上限（1.4.5.6：0 基 0..227）
    expect(a.difficulty).toBe(0);
    expect(a.hairColor).toEqual({ r: 255, g: 0, b: 0 });
    expect(validateAppearance(null)).toEqual(defaultAppearance());
  });

  it('随机外观落在合法范围', () => {
    for (let i = 0; i < 20; i++) {
      const a = randomAppearance();
      expect(a.hair).toBeGreaterThanOrEqual(0);   // 0 基
      expect(a.hair).toBeLessThanOrEqual(227);
      expect(MALE_VARIANTS.includes(a.skinVariant) || FEMALE_VARIANTS.includes(a.skinVariant)).toBe(true);
    }
  });

  // ★SW-RB6c 2026-09-07：randomAppearance 1:1 化守卫（UICharacterCreation.
  // Click_RandomizePlayer :1571/:1572-1575/:1648-1651 + Player.Male setter
  // Player.cs:3397-3407）。旧实现从 VariantOrder 男女表掷取 = 可产出 10/11
  // DisplayDoll（原版随机键面从不产出）,判别力：roll 域含 10/11 即炸。
  it('随机外观变体域 = _validClothStyles 0-9,10/11 DisplayDoll 不可达(:1571)', () => {
    expect(VALID_CLOTH_STYLES).not.toContain(10);
    expect(VALID_CLOTH_STYLES).not.toContain(11);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const a = randomAppearance();
      seen.add(a.skinVariant);
      expect(a.skinVariant, `roll#${i} 掷出 ${a.skinVariant}`).toBeLessThanOrEqual(9);
      // 发型性别校正后变体性别必与发型池一致（Male setter 对翻语义）
      if (FEMALE_HAIRS.has(a.hair)) expect(FEMALE_VARIANTS).toContain(a.skinVariant);
      else expect(MALE_VARIANTS).toContain(a.skinVariant);
      // 语音 = 掷出变体性别 1/2 或 50% 掷 3（:1572-1575）
      expect([1, 2, 3]).toContain(a.voiceVariant);
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);   // 覆盖度抽样：双侧池都出得来
    for (const v of seen) expect(VALID_CLOTH_STYLES).toContain(v);
  });
});

describe('CharacterStore', () => {
  beforeEach(() => { mem.clear(); idb.map.clear(); idb.dropConnection(); });

  it('创建/列表/读取', async () => {
    const s = new CharacterStore();
    const a = defaultAppearance('小明');
    a.difficulty = 2;
    const m = await s.create(a);
    expect(m.name).toBe('小明');
    expect(m.difficulty).toBe(2);
    expect(s.list()).toHaveLength(1);
    const got = await s.get(m.id);
    expect(got?.name).toBe('小明');
    expect(got?.difficulty).toBe(2);
  });

  it('id 单调递增（删除后不复用）', async () => {
    const s = new CharacterStore();
    const m1 = await s.create(defaultAppearance('a'));
    const m2 = await s.create(defaultAppearance('b'));
    expect(m2.id).toBeGreaterThan(m1.id);
    await s.delete(m1.id);
    const m3 = await s.create(defaultAppearance('c'));
    expect(m3.id).toBeGreaterThan(m2.id);
    // ★BJ735 改判史（2026-10-27）：旧 toEqual([m2.id, m3.id]) 隐含「id 升序=显示
    // 序」的同毫秒巧合——list() 第二键=lastPlayed 降序（BJ691b 原版锚 UICharacter
    // Select.cs:146-157 orderby LastPlayed desc）,全量跑高负载下 m2/m3 两次 create
    // 跨毫秒即翻转 [m3,m2]（单跑同毫秒回落名字序恒绿=伪稳时序面,非生产回归）。
    // 本用例主旨=id 单调不复用+已删角色出列;显示序面由 bj691 §1 专锁,此处排序无关化。
    expect(s.list().map((x) => x.id).sort((a, b) => a - b)).toEqual([m2.id, m3.id]);
  });

  // 「复制带『副本』后缀」用例已随 R13-F5 死码清扫一并移除（copy() 零生产调用方
  //  删除;本用例是死码影子——CharSelect 复制钮早已改作导出钮,见 CharSelect 头注）

  it('重载后索引持久（localStorage 模拟）', async () => {
    const s1 = new CharacterStore();
    await s1.create(defaultAppearance('p1'));
    const s2 = new CharacterStore();
    await s2.ensureLoaded(); // list() 同步：先确保索引已载入
    expect(s2.list()).toHaveLength(1);
    expect(s2.list()[0].name).toBe('p1');
  });
});
