// BJ725-A 批A 属性域两登记债清偿判别锁（bj723a 登记债 D1/D2,issue #24 收尾批）：
//   D1 召唤支枯萎序——原版 1457 Player.cs:26232-26238（Update 尾）witheredWeapon
//      四系 ×0.5 在 UpdateEquips(:25830 含坐骑 :25855) 全部加算源聚合【后】才乘;
//      旧 summon 支 ×0.5 在鱼鲨(+0.15)/帕鲁(+0.1)加算之前 = 增益逃过折半
//      （melee/ranged/magic 支序 M01 批已对齐,本批补召唤支）。
//   D2 星璇潜行开关门——原版 :26027-26052 三加成（rangedDamage+0.8/rangedCrit+20/
//      aggro−1200,全 × (1−stealth)）全在 `if (vortexStealthActive)` 块内,关开关
//      后 ≤25t 回升斜坡期即刻归零（移速位 :26046-26047 既有门,三消费位本批补齐
//      ——旧码关开关仍给部分加成）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID } from '../src/data/items';
import { BuffType } from '../src/stats/Buffs';
import { withMutation } from './mutation-guard';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const PLAYER_SRC = join(GAME_ROOT, 'src/entities/Player.ts');
const iid = (vid: number): number => ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]!] ?? -1;
const mkPlayer = () => new Player(0, 0, new Inventory());
const mkVortex = (): Player => {
  const p = mkPlayer();
  p.inv.armor[0] = { id: iid(2757), stack: 1 };
  p.inv.armor[1] = { id: iid(2758), stack: 1 };
  p.inv.armor[2] = { id: iid(2759), stack: 1 };
  return p;
};
const wither = (p: Player) => vi.spyOn(p.buffs, 'has')
  .mockImplementation((t: number) => t === (BuffType.WitheredWeapon as unknown as number));
const spawnVitest = (filter: string) => spawnSync('npx', ['vitest', 'run', filter, '--reporter=basic'],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, BJ725_MUT_SKIP: '1' } });
const itMut = process.env.BJ725_MUT_SKIP === '1' ? it.skip : it;   // 变异子进程跳过变异测试（防递归挂锁）
afterEach(() => vi.restoreAllMocks());

// ================= D1 召唤支枯萎序（:26232-26238） =================
describe('BJ725-A D1：召唤支枯萎 ×0.5 移全加算源后', () => {
  it('D1-1 鱼鲨崽增益被枯萎折半：(1+0.15)×0.5=0.575（旧序 0.5+0.15=0.65）', () => {
    const p = mkPlayer();
    wither(p);
    p.mount.active = true;   // ridingMount=getter(active&&!isCart)
    p.mount.type = 12;
    (p.mount as unknown as { fishronBoost: boolean }).fishronBoost = true;
    expect(p.damageMult('summon')).toBeCloseTo(0.575, 6);
  });
  it('D1-2 帕鲁坐骑同折：(1+0.1)×0.5=0.55（旧序 0.5+0.1=0.6）', () => {
    const p = mkPlayer();
    wither(p);
    p.mount.active = true;   // ridingMount=getter(active&&!isCart)
    p.mount.type = 63;
    expect(p.damageMult('summon')).toBeCloseTo(0.55, 6);
  });
  it('D1-3 melee 支序回归护栏（M01 既有正确序不回退）+ 无枯萎基线', () => {
    const p = mkPlayer();
    wither(p);
    p.mount.active = true;   // ridingMount=getter(active&&!isCart)
    p.mount.type = 12;
    (p.mount as unknown as { fishronBoost: boolean }).fishronBoost = true;
    expect(p.damageMult('melee')).toBeCloseTo(0.575, 6);
    expect(p.damageMult('summon')).toBeCloseTo(0.575, 6);
    const q = mkPlayer();
    q.mount.active = true;   // ridingMount=getter
    q.mount.type = 12;
    (q.mount as unknown as { fishronBoost: boolean }).fishronBoost = true;
    expect(q.damageMult('summon')).toBeCloseTo(1.15, 6);   // 无枯萎不折
  });
  itMut('D1-M1 变异恰红：召唤支枯萎乘区摘除 → 锁红', () => {
    withMutation(PLAYER_SRC,
      'if (this.buffs.has(BuffType.WitheredWeapon)) m *= 0.5;   // 枯萎武器（:26236）',
      '/* BJ725A-M1 变异:召唤支枯萎摘除 */',
      () => {
        const r = spawnVitest('tests/bj725a-stat-domain.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D1-1');
      }, { label: 'BJ725A-M1' });
  });
});

// ================= D2 星璇三消费位开关门（:26027-26052） =================
describe('BJ725-A D2：星璇潜行三消费位 vortexStealthActive 开关门', () => {
  it('D2-1 关开关：满潜行残态(stealth=0) 三加成全零（旧码 +0.8/+20/−1200）', () => {
    const p = mkVortex();
    p.vortexStealthActive = false;
    p.stealth = 1;
    const baseD = p.damageMult('ranged'), baseC = p.critChance('ranged'), baseA = p.aggro;
    expect(baseD).toBeCloseTo(1.36, 6);                     // 套件 fx 0.36
    p.stealth = 0;                                          // 满潜行残态
    expect(p.damageMult('ranged')).toBe(baseD);
    expect(p.critChance('ranged')).toBe(baseC);
    expect(p.aggro).toBe(baseA);
  });
  it('D2-2 开开关：stealth=0 三加成全量（+0.8/+20/−1200）', () => {
    const p = mkVortex();
    p.vortexStealthActive = true;
    p.stealth = 1;
    const baseC = p.critChance('ranged'), baseA = p.aggro;
    p.stealth = 0;
    expect(p.damageMult('ranged')).toBeCloseTo(2.16, 6);
    expect(p.critChance('ranged') - baseC).toBe(20);
    expect(baseA - p.aggro).toBe(1200);
  });
  it('D2-3 回升斜坡期（关开关,stealth=0.5）即刻归零（旧码 +0.4/+10/−600）', () => {
    const p = mkVortex();
    p.vortexStealthActive = false;
    p.stealth = 1;
    const baseD = p.damageMult('ranged'), baseC = p.critChance('ranged'), baseA = p.aggro;
    p.stealth = 0.5;
    expect(p.damageMult('ranged')).toBe(baseD);
    expect(p.critChance('ranged')).toBe(baseC);
    expect(p.aggro).toBe(baseA);
  });
  it('D2-4 蘑菇矿不吃开关门（无 toggle,Remap 轴照给——防过矫）', () => {
    const p = mkPlayer();
    p.inv.armor[0] = { id: iid(1546), stack: 1 };
    p.inv.armor[1] = { id: iid(1549), stack: 1 };
    p.inv.armor[2] = { id: iid(1550), stack: 1 };
    p.vortexStealthActive = false;                          // 门对蘑菇矿无效应
    p.stealth = 0.5;                                        // Remap 下轴 → 满档 +0.5
    expect(p.damageMult('ranged')).toBeGreaterThan(1.49);
  });
  itMut('D2-M2 变异恰红×3：三门逐一摘除 → 对应锁红', () => {
    const muts: Array<[string, string, string]> = [
      ['(st.vortexSet && this.vortexStealthActive) m += (1 - this.stealth) * 0.8;',
       '(st.vortexSet) m += (1 - this.stealth) * 0.8; /* BJ725A-M2a 变异:伤门摘除 */', 'D2-1'],
      ['(st.vortexSet && this.vortexStealthActive) c += Math.round((1 - this.stealth) * 20);',
       '(st.vortexSet) c += Math.round((1 - this.stealth) * 20); /* BJ725A-M2b 变异:暴门摘除 */', 'D2-1'],
      ['(eqA.vortexSet && this.vortexStealthActive) a = -Math.round(1200 * s1);',
       '(eqA.vortexSet) a = -Math.round(1200 * s1); /* BJ725A-M2c 变异:仇恨门摘除 */', 'D2-1'],
    ];
    for (const [trg, rep, tag] of muts) {
      withMutation(PLAYER_SRC, trg, rep, () => {
        const r = spawnVitest('tests/bj725a-stat-domain.test.ts');
        expect(r.status, `变异须证红: ${tag}`).not.toBe(0);
        expect(r.stdout).toContain('D2-1');   // 三门摘除均破 D2-1（关开关零加成断言）
      }, { label: `BJ725A-M2-${tag}` });
    }
  });
});
