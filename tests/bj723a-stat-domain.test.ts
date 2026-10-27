// BJ723-A（issue #24）玩家武器伤害审计·属性聚合域四件——判别锁测试（2026-10-26，
// 标杆 Terarria1457/Terraria/Player.cs，行号为本批亲读实锚，非 issue 快照行号）：
//   S01 饰品伤害词缀 69-72 串联赋值 + 漏召唤——GrantPrefixBenefits :14087-14114
//       melee/ranged/magic/minionDamage 逐系独立 `+= 0.01f..0.04f`。
//       旧码 `dmgMelee += dmgRanged += dmgMagic += x` 右结合串联：远程吃魔法累加值、
//       近战吃远程累加值（5×+4% 实测近战+140%/远程+60%/魔法+20%，应各+20%）、召唤整漏。
//   S06 天界石系漏召唤+10%——skyStoneEffects :13088-13102：四系伤+10%【含
//       minionDamage+=0.1f】+ minionKB+=0.5f + pickSpeed-=0.15f。昼夜八组召唤曾恒 0%。
//   M01 魔力眩晕/过热乘区序——Update :26098-26105：manaSick/manaHeat 两乘区位于
//       UpdateBuffs(:25763)/UpdateEquips(:25830 坐骑 :25855)/UpdateArmorSets(:25882)
//       全部加算源聚合【之后】（枯萎 ×0.5 :26232-26238 又在其后）。旧码先乘后加
//       = 暴怒/食物/星云/坐骑逃过乘区（1+0.10+0.10+0.45 眩晕 0.75 时 1.40，应 1.2375）。
//   R01 潜行加伤当乘数 + other 弹种漏加——:26016 蘑菇矿 `rangedDamage +=
//       (1−Remap(s,1,0.75,1,0))×0.5f` / :26043 星璇 `rangedDamage += (1−s)×0.8f`
//       均为【加算】入远程池；GetWeaponDamageMultiplier :54032-54047 箭/弹/火箭/
//       other 四弹种统一随池消费（:54046 other 裸吃 rangedDamage）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { BuffType } from '../src/stats/Buffs';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!] ?? -1;
const mkPlayer = () => new Player(0, 0, new Inventory());
/** 伤词缀载体（再生手环 49：无任何 dmg fx，词缀面纯净） */
const pfxAcc = (prefix: number) => ({ id: iid(49), stack: 1, prefix });

// ---------------------------------------------------------------------------
// S01 饰品伤害词缀 69-72 四系独立加成（:14087-14114）
// ---------------------------------------------------------------------------
describe('BJ723-A S01：词缀 69-72 四系独立 +1..4%（GrantPrefixBenefits :14087-14114）', () => {
  it('issue 复现闭环：5×+4% 词缀 → 四系各恰 +20%（旧串联码 140%/60%/20%/0%）', () => {
    const p = mkPlayer();
    for (let i = 3; i <= 7; i++) p.inv.armor[i] = pfxAcc(72) as never;
    expect(p.equipStats.dmgMelee).toBeCloseTo(0.20, 6);
    expect(p.equipStats.dmgRanged).toBeCloseTo(0.20, 6);
    expect(p.equipStats.dmgMagic).toBeCloseTo(0.20, 6);
    expect(p.equipStats.minionDmg).toBeCloseTo(0.20, 6);        // 召唤不再漏（:14092）
    expect(p.damageMult('melee')).toBeCloseTo(1.20, 6);
    expect(p.damageMult('summon')).toBeCloseTo(1.20, 6);
  });

  it('69-72 档位逐档：单件各系 +0.01/+0.02/+0.03/+0.04', () => {
    for (const [pfx, v] of [[69, 0.01], [70, 0.02], [71, 0.03], [72, 0.04]] as const) {
      const p = mkPlayer();
      p.inv.armor[3] = pfxAcc(pfx) as never;
      expect(p.equipStats.dmgMelee, `prefix ${pfx}`).toBeCloseTo(v, 6);
      expect(p.equipStats.dmgRanged, `prefix ${pfx}`).toBeCloseTo(v, 6);
      expect(p.equipStats.dmgMagic, `prefix ${pfx}`).toBeCloseTo(v, 6);
      expect(p.equipStats.minionDmg, `prefix ${pfx}`).toBeCloseTo(v, 6);
    }
  });

  it('混档 2×72+1×70 → 四系各 +0.10（旧串联码近战=0.38/远程=0.22/魔法=0.10）', () => {
    const p = mkPlayer();
    p.inv.armor[3] = pfxAcc(72) as never;
    p.inv.armor[4] = pfxAcc(72) as never;
    p.inv.armor[5] = pfxAcc(70) as never;
    expect(p.equipStats.dmgMelee).toBeCloseTo(0.10, 6);
    expect(p.equipStats.dmgRanged).toBeCloseTo(0.10, 6);
    expect(p.equipStats.dmgMagic).toBeCloseTo(0.10, 6);
    expect(p.equipStats.minionDmg).toBeCloseTo(0.10, 6);
  });

  it('结构锁：复合串联赋值已除、四系独立加法在位', () => {
    const src = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '');                                // 注释内引旧码不误伤
    expect(src).not.toMatch(/dmgMelee \+= dmgRanged/);          // 串联形态禁复活
    expect(src).toMatch(/dmgMelee \+= pd; dmgRanged \+= pd; dmgMagic \+= pd; minionDmg \+= pd;/);
  });
});

// ---------------------------------------------------------------------------
// S06 天界石族四件（899 昼 / 900 夜 / 1865 / 3110 无门）召唤面（:13088-13102）
// ---------------------------------------------------------------------------
describe('BJ723-A S06：skyStoneEffects 召唤伤/击退/镐速（1457 Player.cs:13088-13102）', () => {
  // 昼夜八组：899=!nightPhase、900=nightPhase（:15531-15535）、1865/3110 无门（:15527-15529）
  const cases = [
    [899, 0.10, 0], [900, 0, 0.10], [1865, 0.10, 0.10], [3110, 0.10, 0.10],
  ] as const;
  for (const [vid, dayDmg, nightDmg] of cases) {
    it(`vid ${vid}：昼 ${dayDmg} / 夜 ${nightDmg}（minionDmg;昼夜八组召唤曾恒 0%）`, () => {
      const pDay = mkPlayer();
      pDay.nightPhase = false;
      pDay.inv.armor[3] = { id: iid(vid), stack: 1 };
      expect(pDay.equipStats.minionDmg).toBeCloseTo(dayDmg, 6);
      expect(pDay.damageMult('summon')).toBeCloseTo(1 + dayDmg, 6);
      const pNight = mkPlayer();
      pNight.nightPhase = true;
      pNight.inv.armor[3] = { id: iid(vid), stack: 1 };
      expect(pNight.equipStats.minionDmg).toBeCloseTo(nightDmg, 6);
      expect(pNight.damageMult('summon')).toBeCloseTo(1 + nightDmg, 6);
    });
  }

  it('同块三补齐：minionKB +0.5（:13101）/ pickSpeedOff +0.15（:13099 折正池）/四系伤 +10%', () => {
    const p = mkPlayer();
    p.inv.armor[3] = { id: iid(1865), stack: 1 };
    expect(p.equipStats.minionKB).toBeCloseTo(0.5, 6);
    expect(p.equipStats.pickSpeedOff).toBeCloseTo(0.15, 6);
    expect(p.equipStats.dmgMelee).toBeCloseTo(0.10, 6);
    expect(p.equipStats.dmgRanged).toBeCloseTo(0.10, 6);
    expect(p.equipStats.dmgMagic).toBeCloseTo(0.10, 6);
  });

  it('结构锁：skyStone 块四系伤同排含召唤 + KB/镐速两行在位', () => {
    const src = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/dmgMelee \+= 0\.1; dmgRanged \+= 0\.1; dmgMagic \+= 0\.1; minionDmg \+= 0\.1;/);
    expect(src).toMatch(/pickSpeedOff \+= 0\.15; minionKB \+= 0\.5;/);
  });
});

// ---------------------------------------------------------------------------
// M01 魔力眩晕/过热乘区序（:26098-26105 在全部加算源之后）
// ---------------------------------------------------------------------------
describe('BJ723-A M01：manaSick/manaHeat 先聚合后乘（1457 Player.cs:26098-26105）', () => {
  /** 基准夹具：暴怒0.10+食物0.10+星云3层0.45（全通用加算源），无装备面 */
  const mkCaster = () => {
    const p = mkPlayer();
    p.buffs.apply(BuffType.Rage, 60);        // 原版 117 暴怒：四系 +10%（:9947）
    p.buffs.apply(BuffType.WellFed3, 60);    // 饕餮：全系 +10%（:11555）
    p.nebula[0] = 3;                         // 星云伤害 3 层 ×15%（:10118-10124）
    return p;
  };

  it('issue 复现①：眩晕 0.75 → 1.65×0.75 = 1.2375（旧先乘后加 = 1.40）', () => {
    const p = mkCaster();
    p.buffs.apply(BuffType.ManaSickness, 5); // 剩 5s 整 = 300t → ×0.75（:10412-10414）
    expect(p.damageMult('magic')).toBeCloseTo(1.2375, 6);
  });

  it('issue 复现②形态：过热乘区同样吃满加算源（fresh 0.15/20s → ×1.15）', () => {
    const p = mkCaster();
    p.tryApplyManaHeat(0.15, 20);            // :52644-52652 登记 + buff 396
    expect(p.manaHeatMult).toBeCloseTo(1.15, 6);
    expect(p.damageMult('magic')).toBeCloseTo(1.65 * 1.15, 6);   // 1.8975（旧码 1×1.15+0.65=1.80）
  });

  it('眩晕×过热可叠乘；MagicPower +20% 同在乘区内（:9669 加算先入池）', () => {
    const p = mkCaster();
    p.buffs.apply(BuffType.MagicPower, 60);
    p.buffs.apply(BuffType.ManaSickness, 5);
    p.tryApplyManaHeat(0.15, 20);
    expect(p.damageMult('magic')).toBeCloseTo((1.65 + 0.2) * 0.75 * 1.15, 6);
  });

  it('枯萎武器 ×0.5 在眩晕/过热【之后】（:26232-26238 晚于 :26100/:26104）', () => {
    const p = mkCaster();
    p.buffs.apply(BuffType.ManaSickness, 5);
    p.buffs.apply(BuffType.WitheredWeapon, 60);
    expect(p.damageMult('magic')).toBeCloseTo(1.65 * 0.75 * 0.5, 6);
  });

  it('召唤面不吃眩晕/过热（:26100/:26104 只乘 magicDamage）', () => {
    const p = mkCaster();
    p.buffs.apply(BuffType.ManaSickness, 5);
    p.tryApplyManaHeat(0.15, 20);
    expect(p.damageMult('summon')).toBeCloseTo(1.65, 6);
  });

  it('结构锁：加算源（星云/食物）→ manaSick/manaHeat 乘 → 枯萎乘 的源序', () => {
    const src = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '');
    // damageMult 泛型支函数体（含 melee/ranged/magic 主链，止于 rangedDamageMult）
    const m = /damageMult\(kind: 'melee'[\s\S]*?\n  rangedDamageMult/.exec(src);
    expect(m).not.toBeNull();
    const body = m![0];
    const iNebula = body.indexOf('m += 0.15 * this.nebula[0]');
    const iSick = body.indexOf('m *= this.buffs.manaSickMagicMult');
    // 枯萎锚从 iSick 起找（summon 支也有一处枯萎乘，序位不参评）
    const iWither = body.indexOf('BuffType.WitheredWeapon)) m *= 0.5', iSick);
    expect(iNebula).toBeGreaterThanOrEqual(0);
    expect(iSick).toBeGreaterThan(iNebula);        // 乘区在加算源之后
    expect(iWither).toBeGreaterThan(iSick);        // 枯萎又在乘区之后
    expect(body).not.toMatch(/magicDmgBonus;\s*m \*=/);   // 旧位（紧随 MagicPower 即乘）禁复活
  });
});

// ---------------------------------------------------------------------------
// R01 潜行加伤加算入远程池 + other 弹种随池（:26016/:26043/:54032-54047）
// ---------------------------------------------------------------------------
describe('BJ723-A R01：潜行加伤【加算】入远程池，四弹种统一随池', () => {
  /** 星璇全套（2757/2758/2759，件面 fx 0.16+0.12+0.08=0.36 入池）+ 配饰池 +0.50
   *  （2×491 带 72 词缀 0.19×2 + 3×49 带 72 词缀 0.04×3）→ 池基 1.86 */
  const mkVortexArcher = (): Player => {
    const p = mkPlayer();
    p.inv.armor[0] = { id: iid(2757), stack: 1 };
    p.inv.armor[1] = { id: iid(2758), stack: 1 };
    p.inv.armor[2] = { id: iid(2759), stack: 1 };
    p.inv.armor[3] = { id: iid(491), stack: 1, prefix: 72 };    // 射手纹章 0.15+0.04
    p.inv.armor[4] = { id: iid(491), stack: 1, prefix: 72 };
    p.inv.armor[5] = pfxAcc(72) as never;
    p.inv.armor[6] = pfxAcc(72) as never;
    p.inv.armor[7] = pfxAcc(72) as never;
    p.vortexStealthActive = true;   // ★BJ725-A D2 改判史注：星璇三消费位（damageMult/critChance/aggro）补
    //  vortexStealthActive 开关门后,潜行加成断言须先开开关（原版 :26027-26052 全在块内）
    return p;
  };

  it('issue 复现闭环：满潜行星璇四弹种统一 = 池 1.86+0.8 = 2.66（旧乘数码箭 3.348/other 1.86）', () => {
    const p = mkVortexArcher();
    p.stealth = 1;
    expect(p.damageMult('ranged')).toBeCloseTo(1.86, 6);        // 件面 0.36 + 配饰 0.50
    expect(p.rangedDamageMult('arrow')).toBeCloseTo(1.86, 6);
    expect(p.rangedDamageMult('other')).toBeCloseTo(1.86, 6);
    p.stealth = 0;                                              // 满潜行
    expect(p.damageMult('ranged')).toBeCloseTo(2.66, 6);
    // :54032-54047 四弹种全随池（星璇无蘑菇矿头 → 弹种乘子全 1）
    expect(p.rangedDamageMult('arrow')).toBeCloseTo(2.66, 6);
    expect(p.rangedDamageMult('bullet')).toBeCloseTo(2.66, 6);
    expect(p.rangedDamageMult('rocket')).toBeCloseTo(2.66, 6);
    expect(p.rangedDamageMult('other')).toBeCloseTo(2.66, 6);   // other 不再整漏（:54046）
  });

  it('箭袋 stack 公式：潜行加算在池内、stack 加在池后（:3966 (R+stealth)/M+stack)×M×arrow）', () => {
    const p = mkVortexArcher();
    p.inv.armor[7] = { id: iid(1321), stack: 1 };   // 魔法箭袋 arrowStack +0.1（顶掉一枚词缀件）
    p.stealth = 0;
    // 池 = 1 + 0.36(套件) + 0.46(2×491+72 与 2×72) + 0.8(潜行) = 2.62 → 箭 = 2.62+0.1 = 2.72
    // （旧乘数码 = (1.82+0.1)×1.8 = 3.456）
    expect(p.equipStats.arrowStack).toBeCloseTo(0.1, 6);
    expect(p.rangedDamageMult('arrow')).toBeCloseTo(2.72, 6);
  });

  it('蘑菇矿 Remap 轴 +0.5 加算（:26016）；箭头 ×1.12 乘在池外（:13799）', () => {
    const p = mkPlayer();
    p.inv.armor[0] = { id: iid(1546), stack: 1 };   // 蘑菇矿箭头：arrowDamage ×1.12
    p.inv.armor[1] = { id: iid(1549), stack: 1 };   // 胸 fx dmgRanged +0.13（:13814）
    p.inv.armor[2] = { id: iid(1550), stack: 1 };
    expect(p.equipStats.shroomiteSet).toBe(true);
    p.stealth = 1;
    expect(p.damageMult('ranged')).toBeCloseTo(1.13, 6);
    p.stealth = 0;                                  // Remap(0)=0 → 加算满档 +0.5
    expect(p.damageMult('ranged')).toBeCloseTo(1.63, 6);
    expect(p.rangedDamageMult('bullet')).toBeCloseTo(1.63, 6);  // 弹头不匹配 → ×1
    expect(p.rangedDamageMult('arrow')).toBeCloseTo(1.63 * 1.12, 6);
    expect(p.rangedDamageMult('other')).toBeCloseTo(1.63, 6);
  });

  it('互斥链序：手持变态刀 3106 时远程无潜行加成（:25930 首支吃掉链）', () => {
    const p = mkVortexArcher();
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    p.stealth = 0;
    expect(p.damageMult('ranged')).toBeCloseTo(1.86, 6);        // 不吃星璇 +0.8
    expect(p.damageMult('melee')).toBeCloseTo(4.2, 6);          // 1+0.20(五词缀)+3 变态刀（:25970）
  });

  it('枯萎武器 ×0.5 连潜行段一并折半（:26235 rangedDamage *= 0.5f 在池内）', () => {
    const p = mkVortexArcher();
    p.stealth = 0;
    p.buffs.apply(BuffType.WitheredWeapon, 60);
    expect(p.rangedDamageMult('other')).toBeCloseTo(2.66 * 0.5, 6);
  });

  it('结构锁：池内加算形态在位、乘数形态禁复活', () => {
    const src = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '');
    // damageMult 内：ranged 支 + !heldPsychoKnife 门 + 蘑菇矿/星璇两支加算
    expect(src).toMatch(/kind === 'ranged' && !this\.heldPsychoKnife/);
    expect(src).toMatch(/\(1 - shroomiteStealthRemap\(this\.stealth\)\) \* 0\.5;/);
    expect(src).toMatch(/\(1 - this\.stealth\) \* 0\.8;/);
    // rangedDamageMult 内：独立乘数已除（stealthBonus 标识禁复活）
    const m = /rangedDamageMult\(kind[\s\S]*?\n  \/\*\* 手持变态刀/.exec(src);
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/stealthBonus/);
  });
});
