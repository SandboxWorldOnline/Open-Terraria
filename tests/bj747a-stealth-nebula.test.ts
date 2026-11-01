// ★BJ747-A（2026-11-01,issue#35 盔甲审计子集）行为锁：潜行截断/互斥 + 星云单位/账。
//   A05：潜行暴击/仇恨 (int) 截断（1457 Player.cs:25971/:26015-18/:26044/:25976——
//        旧 Math.round 四舍五入；星璇首拍 (1−0.96)×20=0.8 截 0，旧 round=1）。
//   A06：持变态刀 3106 时远程潜行暴击互斥（UpdateStealth :25929 if/else-if 链首支——
//        旧 crit 支缺门，星璇满潜行仍 +20 应 0）。
//   A17：星云魔力 counter 每拍 += level（ApplyNebulaBuffMana :19691-19712，UpdateManaRegen
//        :19544 头每拍调，int tick 域）——旧 `+= level*dt` 慢 60 倍；零层清账。
//   A18：星云生命正项入公共再生账（UpdateBuffs :10538-39 lifeRegen += 6×级，DoT 清零
//        面内）+ 负值钳 0（:19220）——中毒期净 0；旧独立直写 hp 绕过清零。
//   变异恰红 M 组在同文件尾（withMutation 统一守卫）。
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { withMutation } from './mutation-guard';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { BuffState, BuffType } from '../src/stats/Buffs';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!] ?? -1;
const DT = 1 / 60;

/** 裸构造 hp=0（Spawn 初始化不在构造内）——fixedUpdate 前须回满，否则 tick2 起走死亡早退 */
const mkPlayer = () => {
  const p = new Player(60 * 16, 90 * 16, new Inventory());
  p.hp = p.maxHp;
  p.mana = 0;
  return p;
};

// ---- fixedUpdate 桩环境（weapon-stealth-fix 同款：真 World + 地面板 + 死线上方） ----
const W = 200, H = 200;
function makeHooks(player: Player): GameHooks {
  const w = new World(W, H, 7, 'bj747a-fixture');
  for (let x = 0; x < W; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  w.lavaLine = 90;
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => [],
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  return hooks;
}

const mkShroomite = () => {
  const p = mkPlayer();
  p.inv.armor[0] = { id: iid(1546), stack: 1 };
  p.inv.armor[1] = { id: iid(1549), stack: 1 };
  p.inv.armor[2] = { id: iid(1550), stack: 1 };
  return p;
};
const mkVortex = () => {
  const p = mkPlayer();
  p.inv.armor[0] = { id: iid(2757), stack: 1 };
  p.inv.armor[1] = { id: iid(2758), stack: 1 };
  p.inv.armor[2] = { id: iid(2759), stack: 1 };
  return p;
};

// ===========================================================================
// A05：截断（非四舍五入）——审计复算锚：蘑菇矿 stealth=.9348 → Remap=.7392，
// (1−r)×10=2.608 截 2（round=3）；×750=195.6 截 195（round=196）
// ===========================================================================
describe('BJ747-A A05 潜行暴击与仇恨截断', () => {
  it('蘑菇矿 stealth=.9348：额外暴击 2（round=3 判别）、aggro −195（round=−196 判别）', () => {
    const p = mkShroomite();
    p.stealth = 1;
    const base = p.critChance('ranged');
    p.stealth = 0.9348;
    expect(p.critChance('ranged') - base).toBe(2);
    expect(p.aggro).toBe(-195);
  });

  it('星璇逐拍真实衰减：第 1/2/6/7 拍额外暴击 0/1/4/5（issue#35 A05 逐拍表；round=1/2/5/6）', () => {
    const p = mkVortex();
    p.vortexStealthActive = true;
    const hooks = makeHooks(p);
    const base = p.critChance('ranged');        // stealth=1 → 额外 0
    const seq: number[] = [];
    for (let t = 1; t <= 7; t++) {
      p.fixedUpdate(DT, hooks);
      seq.push(p.critChance('ranged') - base);
    }
    expect(seq).toEqual([0, 1, 2, 3, 4, 4, 5]); // 拍 3-5 为 f64 逐拍推演（0.88/0.84/0.80 → 2.4/3.2/4.0）
    // 审计钉的判别拍
    expect([seq[0], seq[1], seq[5], seq[6]]).toEqual([0, 1, 4, 5]);
  });

  it('星璇固定档截断：stealth=.96 → 暴击 +0（0.80…07 截 0；round=1 判别）、aggro −48', () => {
    const p = mkVortex();
    p.vortexStealthActive = true;
    p.stealth = 0.96;
    const base0 = (() => { p.stealth = 1; const c = p.critChance('ranged'); p.stealth = 0.96; return c; })();
    expect(p.critChance('ranged') - base0).toBe(0);
    expect(p.aggro).toBe(-48);
  });

  it('变态刀暴击截断：stealth=.95 → +1（1.5 截 1；round=2 判别）', () => {
    const p = mkPlayer();
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    p.stealth = 1;
    const base = p.critChance('melee');
    p.stealth = 0.95;
    expect(p.critChance('melee') - base).toBe(1);
    // 满潜行端点（30 整）
    p.stealth = 0;
    expect(p.critChance('melee') - base).toBe(30);
  });
});

// ===========================================================================
// A06：持变态刀互斥（远程潜行暴击面）
// ===========================================================================
describe('BJ747-A A06 变态刀互斥远程潜行暴击归零', () => {
  it('星璇套+持刀+满潜行：远程 crit 无 +20（旧缺门=+20）；无刀对照 +20', () => {
    const withKnife = mkVortex();
    withKnife.inv.slots[0] = { id: iid(3106), stack: 1 };
    withKnife.vortexStealthActive = true;
    withKnife.stealth = 0;                       // 满潜行
    const k1 = withKnife.critChance('ranged');
    withKnife.stealth = 1;
    const k0 = withKnife.critChance('ranged');
    expect(k1 - k0).toBe(0);                     // ★互斥：无潜行暴击

    const noKnife = mkVortex();
    noKnife.vortexStealthActive = true;
    noKnife.stealth = 0;
    const n1 = noKnife.critChance('ranged');
    noKnife.stealth = 1;
    const n0 = noKnife.critChance('ranged');
    expect(n1 - n0).toBe(20);                    // 无刀对照：满潜行 +20（:26044）
  });

  it('蘑菇矿同门：持刀时 Remap 轴暴击不吃（伤害/aggro 门既有，crit 面同判）', () => {
    const p = mkShroomite();
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    p.stealth = 0;
    const c1 = p.critChance('ranged');
    p.stealth = 1;
    const c0 = p.critChance('ranged');
    expect(c1 - c0).toBe(0);
  });
});

// ===========================================================================
// A17：星云魔力增益单位（每拍 += level，≥6 回 1；零层清账）
// ===========================================================================
describe('BJ747-A A17 星云魔力增益tick域', () => {
  /** 隔离自然回蓝：manaRegenDelay 钉高（>4 且衰减 1-2/tick 60 拍不穿底）→
   *  flag2/flag3 均 false → 每帧产额 0（:19563-19567 门），mana 净变化=纯星云面 */
  const runTicks = (level: number, ticks: number): number => {
    const p = mkPlayer();
    p.baseMaxMana = 200;                         // 裸构造 20 上限会钳 3 层档（30>20）
    for (let i = 0; i < level; i++) p.nebulaLevelup(2);
    p.mana = 0;
    p.manaRegenDelay = 9999;
    const hooks = makeHooks(p);
    for (let t = 0; t < ticks; t++) p.fixedUpdate(DT, hooks);
    return p.mana;
  };

  it('60 拍 1/2/3 层回蓝 10/20/30（旧 dt 缩放=0/0/0；原版 ApplyNebulaBuffMana）', () => {
    expect(runTicks(1, 60)).toBe(10);
    expect(runTicks(2, 60)).toBe(20);
    expect(runTicks(3, 60)).toBe(30);
  });

  it('level 3 两拍恰回 1（counter 3+3=6 → −6 且 +1，单 if 每拍至多 1）', () => {
    expect(runTicks(3, 1)).toBe(0);
    expect(runTicks(3, 2)).toBe(1);
  });

  it('零层清账：level 1 ×5 拍（counter=5）→ 归零 1 拍 → counter 复位 0（旧悬空）', () => {
    const p = mkPlayer();
    p.nebulaLevelup(2);
    p.mana = 0;
    p.manaRegenDelay = 9999;
    const hooks = makeHooks(p);
    for (let t = 0; t < 5; t++) p.fixedUpdate(DT, hooks);
    expect((p as unknown as { nebulaManaAccum: number }).nebulaManaAccum).toBe(5);
    p.nebula[2] = 0;
    p.fixedUpdate(DT, hooks);
    expect((p as unknown as { nebulaManaAccum: number }).nebulaManaAccum).toBe(0);
  });
});

// ===========================================================================
// A18：星云生命 = 公共再生账正项（DoT 清零面内）+ 负值钳 0
// ===========================================================================
describe('BJ747-A A18 星云生命公共账Buffs面', () => {
  const runHeal = (opts: { poison?: boolean; regen?: boolean; level: number }, ticks: number): number => {
    const b = new BuffState();
    b.nebulaLifeLevel = opts.level;
    if (opts.poison) b.apply(BuffType.Poisoned, 100);
    if (opts.regen) b.apply(BuffType.Regen, 100);
    let heal = 0;
    for (let t = 0; t < ticks; t++) heal += b.tick(DT);
    return heal;
  };

  it('1 层 + 中毒 61 拍 = 0（正项被 DoT 清零 + 负流被钳 0；旧独立账=+3）', () => {
    expect(runHeal({ level: 1, poison: true }, 61)).toBe(0);
  });
  it('1 层无毒 61 拍 = +3；+再生 buff 无毒 = +5（issue#35 A18 控制组）', () => {
    expect(runHeal({ level: 1 }, 61)).toBe(3);
    expect(runHeal({ level: 1, regen: true }, 61)).toBe(5);
  });
  it('3 层无毒 61 拍 = +9（3 HP/s/级）；中毒仍 0', () => {
    expect(runHeal({ level: 3 }, 61)).toBe(9);
    expect(runHeal({ level: 3, poison: true }, 61)).toBe(0);
  });
});

describe('BJ747-A A18 星云生命公共账Player面', () => {
  it('hp=maxHp−50、1 层+中毒 61 拍：hp 净变 0（旧独立直写=+3）', () => {
    const p = mkPlayer();
    p.hp = p.maxHp - 50;
    p.nebulaLevelup(1);
    p.buffs.apply(BuffType.Poisoned, 100);
    const hooks = makeHooks(p);
    for (let t = 0; t < 61; t++) p.fixedUpdate(DT, hooks);
    expect(p.hp).toBe(p.maxHp - 50);
  });
  it('同夹具无毒 61 拍：hp 恰 +3（自然回复 61 拍爬坡<300 档=0，纯星云面）', () => {
    const p = mkPlayer();
    p.hp = p.maxHp - 50;
    p.nebulaLevelup(1);
    const hooks = makeHooks(p);
    for (let t = 0; t < 61; t++) p.fixedUpdate(DT, hooks);
    expect(p.hp).toBe(p.maxHp - 50 + 3);
  });
});

// ===========================================================================
// 变异恰红（M 组）——每刀口摘除/回退必须爆红
// ===========================================================================
const spawnVitest = (filter: string) => spawnSync(
  'npx', ['vitest', 'run', 'tests/bj747a-stealth-nebula.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, SW_BJ747A_MUT: '1' },
  },
);
const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
  withMutation(file, trigger, replacement, () => {
    const r = spawnVitest(filter);
    expect(r.status, `变异须证红: ${replacement.slice(0, 70)}`).not.toBe(0);
    expect(r.stdout).toContain(filter);
  }, { label: `BJ747-A ${filter}` });
};

describe('BJ747-A 变异恰红', () => {
  it('M1 A05：星璇暴击截断回退 round → 逐拍序列红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'if (st.vortexSet && this.vortexStealthActive) c += Math.trunc((1 - this.stealth) * 20);',
      'if (st.vortexSet && this.vortexStealthActive) c += Math.round((1 - this.stealth) * 20);',
      'A05 潜行暴击与仇恨截断');
  });
  it('M2 A06：摘互斥门 → 持刀 +20 回归红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'if (!this.heldPsychoKnife) {\n        // 潜行暴击：星璇平铺 (1−s)×20（:26044）；蘑菇矿 Remap 轴 ×10（:26015/:26017）',
      'if (true) {\n        // 潜行暴击：星璇平铺 (1−s)×20（:26044）；蘑菇矿 Remap 轴 ×10（:26015/:26017）',
      'A06 变态刀互斥远程潜行暴击归零');
  });
  it('M3 A17：mana counter 回退 dt 缩放 → 60 拍回蓝图红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'this.nebulaManaAccum += this.nebula[2];',
      'this.nebulaManaAccum += this.nebula[2] * dt;',
      'A17 星云魔力增益tick域');
  });
  it('M4 A18：摘星云生命正项 → 无毒 +3 夹具红（中毒 0 双向不判别）', () => {
    mutate(join(process.cwd(), 'src', 'stats', 'Buffs.ts'),
      'if (this.nebulaLifeLevel > 0) {\n      this.nebulaLifeHealAccum += 3 * this.nebulaLifeLevel * dt;',
      'if (false && this.nebulaLifeLevel > 0) {\n      this.nebulaLifeHealAccum += 3 * this.nebulaLifeLevel * dt;',
      'A18 星云生命公共账Buffs面');
  });
});
