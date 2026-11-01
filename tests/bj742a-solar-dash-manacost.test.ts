// ★BJ742-A R20-①/②（2026-10-31 红蓝清偿）：日曜 dashType=3 盾门 + Jungle 魔耗加算池。
//
// 原版锚（Terarria1457 亲读）：
//   · R20-① Player.cs:16549-16553（ApplySetBonus_Solar 尾段）：
//     `bool flag = solarDashing && dashDelay < 0; if ((solarShields > 0) | flag)
//     dashType = 3;` ——0 盾不落 3;item 面 :15166/:15170/:15179 槽序直赋
//     （977/984→1、3097→2,UpdateEquips :25830 先于 UpdateArmorSets :25882）⇒
//     0 盾回落配饰档或 0=无冲刺。旧 Math.max(dash, sb.dashType=3) 恒 3。
//   · R20-② ArmorSetBonuses.cs:278-281（Jungle → player.manaCost -= 0.16f）：
//     全树 manaCost 零乘区（Player.manaCost 单浮点 :1859,ResetEffects :18450 归 1,
//     :11979-:15227 二十余站全 -=）——与 223 大自然恩赐(-0.06)/钴·秘银·精金
//     (-0.14/0.17/0.19) 同池加算;旧乘区 0.84 并戴即露馅 (1-0.06)×0.84≠0.78。
//
// 变异恰红映射：
//   M1 盾门摘除（solarDashGateOk→true）      → S1/S2 红（0 盾白送 dash 3）
//   M2 尾段键 tag18 摘除                      → S3 红（盾翻转拍缓存陈旧）
//   M3 Jungle manaCostOff→manaCostMul 回乘区  → S5/S6 红
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (p: string): string => readFileSync(join(ROOT, 'src', p), 'utf8');
const PT = join(ROOT, 'src', 'entities', 'Player.ts');
const AST = join(ROOT, 'src', 'data', 'vanillaArmorSets.ts');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};
const equipArmor = (p: Player, ...vids: number[]): void => {
  vids.forEach((v, i) => { p.inv.armor[i] = { id: iid(v), stack: 1 }; });
};
const solarPlayer = (): Player => {
  const p = new Player(40 * 16, 54 * 16, new Inventory());
  equipArmor(p, 2763, 2764, 2765);   // Solar Flare 头/胸/腿（:470 Add(2763,2764,2765)）
  return p;
};

// ===================== ① 日曜 dashType=3 盾门（Player.cs:16549-16553） =====================
describe('BJ742-A① 日曜 dash 盾门', () => {
  it('S1 0 盾裸日曜套 → dash=0（无冲刺——旧恒 3 白送 21.9 冲撞+耗盾判定面）', () => {
    const p = solarPlayer();
    expect(p.equipStats.solarSet).toBe(true);
    expect(p.solarShields).toBe(0);
    expect(p.equipStats.dash).toBe(0);
  });

  it('S2 盾门三态：shields 1/3 → dash 3;滑行 flag（solarDashing∧dashDelay<0）→ dash 3', () => {
    const a = solarPlayer();
    a.solarShields = 1;
    expect(a.equipStats.dash).toBe(3);
    const b = solarPlayer();
    b.solarShields = 3;
    expect(b.equipStats.dash).toBe(3);
    // flag 支（:16549）：0 盾但冲撞滑行中 → 保持 3
    const c = solarPlayer();
    c.solarDashing = true;
    c.dashDelay = -1;
    expect(c.equipStats.dash).toBe(3);
    // dashDelay≥0（冷却/就绪）且 0 盾 → 3 不落
    const d = solarPlayer();
    d.solarDashing = true;
    d.dashDelay = 20;
    expect(d.equipStats.dash).toBe(0);
  });

  it('S3 缓存失效合同（equipStatsTailKey tag18）：盾耗/回充/滑行起止翻转拍数值跟随', () => {
    const p = solarPlayer();
    expect(p.equipStats.dash).toBe(0);      // 0 盾缓存
    p.solarShields = 2;                      // 回充一层（180t 一档）
    expect(p.equipStats.dash).toBe(3);      // 键变 → 重算
    p.solarShields = 0;                      // 冲撞命中 ConsumeSolarFlare
    expect(p.equipStats.dash).toBe(0);
    p.solarDashing = true; p.dashDelay = -1; // 冲撞发起拍
    expect(p.equipStats.dash).toBe(3);
    p.dashDelay = 30;                        // 冷却开始（solarDashing 清位拍）
    expect(p.equipStats.dash).toBe(0);
  });

  it('S4 0 盾 + 足具回落配饰档：+977 克盾 → dash 1;+3097 忍者足具 → dash 2（槽序直赋链）', () => {
    const a = solarPlayer();
    a.inv.armor[3] = { id: iid(977), stack: 1 };
    expect(a.equipStats.dash).toBe(1);      // Math.max(1, gate-off 不贡献) = 1
    const b = solarPlayer();
    b.inv.armor[3] = { id: iid(3097), stack: 1 };
    expect(b.equipStats.dash).toBe(2);
    // 有盾时套装覆盖配饰（:16552 直赋语义,聚合链 max 同值）
    const c = solarPlayer();
    c.inv.armor[3] = { id: iid(977), stack: 1 };
    c.solarShields = 1;
    expect(c.equipStats.dash).toBe(3);
  });

  it('S5 水晶刺客 dashType=5 无门（ArmorSetBonuses.cs:247 直赋,非 solar 旗不进门）', () => {
    const p = new Player(40 * 16, 54 * 16, new Inventory());
    equipArmor(p, 4982, 4983, 4984);
    expect(p.equipStats.dash).toBe(5);
  });
});

// ===================== ② Jungle 魔耗加算池（ArmorSetBonuses.cs:278-281） =====================
describe('BJ742-A② Jungle manaCost -= 0.16 加算池', () => {
  it('S6 单套：manaCostOff=0.16、manaCostMul=1（旧乘区 0.84 退役）', () => {
    const p = new Player(40 * 16, 54 * 16, new Inventory());
    equipArmor(p, 228, 229, 230);   // Jungle 头/胸/腿（:438 Set({228,960},{229,961},{230,962})）
    expect(p.equipStats.setBonus?.name).toBe('Jungle');
    expect(p.equipStats.manaCostOff).toBeCloseTo(0.16, 6);
    expect(p.equipStats.manaCostMul).toBe(1);
    // 混搭变体同亮（笛卡尔 2×2×2）
    const q = new Player(40 * 16, 54 * 16, new Inventory());
    equipArmor(q, 960, 961, 962);
    expect(q.equipStats.manaCostOff).toBeCloseTo(0.16, 6);
  });

  it('S7 并戴露馅判别：+223 大自然恩赐（-0.06）→ 0.16+0.06=0.22（旧乘区 0.9×0.84=0.756≠0.78）', () => {
    const p = new Player(40 * 16, 54 * 16, new Inventory());
    equipArmor(p, 228, 229, 230);
    p.inv.armor[3] = { id: iid(223), stack: 1 };
    expect(p.equipStats.manaCostOff).toBeCloseTo(0.22, 6);
    // 消费端终值（(1-0.22)×1 = 0.78 = 原版 1-0.06-0.16）
    expect(1 - p.equipStats.manaCostOff).toBeCloseTo(0.78, 6);
  });

  it('S8 结构锁：表 8 键全落 manaCostOff:0.16;乘区键无原版套装使用者（注释钉死）', () => {
    const src = SRC('data/vanillaArmorSets.ts');
    expect(src.match(/manaCostOff: 0\.16, name: 'Jungle'/g)?.length).toBe(8);
    expect(src).not.toContain("manaCostMul: 0.84, name: 'Jungle'");
    // 盾门结构位（S1 的文本锚——M1 变异位）
    expect(SRC('entities/Player.ts')).toContain('const solarDashGateOk = !sb.solar');
    // 尾段键 tag18 三态输入（M2 变异位）
    expect(SRC('entities/Player.ts')).toContain('mix(18);\n    mix(this.solarShields);');
  });
});

// ===================== ③ 变异恰红（withMutation + sha256 还原对拍） =====================
describe.skipIf(process.env.SW_BJ742A_MUT)('BJ742-A③ 变异自证（三发恰红+逐字节还原）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj742a-solar-dash-manacost.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ742A_MUT: '1' },
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ742A ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    lockTargetFile(file, `BJ742A 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };

  it('M1 盾门摘除（solarDashGateOk→true） → S1/S4 红（0 盾白送 dash 3）', () => {
    mutate(PT,
      'const solarDashGateOk = !sb.solar\n          || this.solarShields > 0 || (this.solarDashing && this.dashDelay < 0);',
      'const solarDashGateOk = true;   // BJ742A-M1',
      'S1 0 盾裸日曜套');
  });

  it('M2 尾段键 tag18 摘除 → S3 红（盾翻转拍缓存陈旧=旧 dash 滞留）', () => {
    mutate(PT,
      'mix(18);\n    mix(this.solarShields);\n    mix(this.solarDashing ? 1 : 0);\n    mix(this.dashDelay < 0 ? 1 : 0);',
      '// BJ742A-M2 tag18 摘除',
      'S3 缓存失效合同');
  });

  it('M3 Jungle 回乘区（manaCostOff→manaCostMul 单键） → S6/S7 红', () => {
    mutate(AST,
      "'8|8|8': { manaCostOff: 0.16, name: 'Jungle' },",
      "'8|8|8': { manaCostMul: 0.84, name: 'Jungle' },",
      'S6 单套：manaCostOff=0.16');
  });
});
